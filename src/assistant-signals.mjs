import { normalizeWorkspacePath } from "./platform.mjs";

export const SIGNAL_TYPES = ["alert", "harvest", "ruin"];
const DAY = 86_400_000;
export function isInternalAssistantThread(thread = {}) {
  return Boolean(thread.internal || /(?:^|\/)overview-worker(?:\/|$)/i.test(String(thread.cwd || "").replace(/\\/g, "/"))
    || /^\[MISSION_OVERVIEW_WORKER\]/i.test(thread.title || "") || /^\[MISSION_OVERVIEW_WORKER\]/i.test(thread.preview || ""));
}
export const shortText = (value, size) => Array.from(String(value || "").replace(/\s+/g, " ").trim()).slice(0, size).join("");
export function timestamp(value) {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? (n < 1e12 ? n * 1000 : n) : (Date.parse(value) || 0);
}
export const isoTime = (value) => timestamp(value) ? new Date(timestamp(value)).toISOString() : undefined;

// Strip the markdown syntax that leaks into one-line card text.
export function plainText(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/gm, "")
    .replace(/(\*\*|__|~~|`)/g, "")
    .replace(/\s+/g, " ").trim();
}

const ASKING_RE = /[?？]\s*$|请选择|要不要|是否需要|请确认|which (?:one|option)|would you/i;
const TAIL_TEXT_LIMIT = 200;
const DELIVERY_RE = /已完成|已修复|已生成|已导出|已交付|已实现|已上线|已发布|产出|交付物|完成了|\b(?:implemented|delivered|exported|fixed|completed)\b/i;

// Pick the sentence that carries the point (delivery claim / closing question)
// instead of the message's opening pleasantries.
function sentences(text) {
  const parts = String(text || "").split(/\n+/).map(plainText).filter(Boolean)
    .flatMap((line) => line.split(/(?<=[。！？!?；;])\s*/)).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const part of parts) {
    // "已上线并验证通过：" introduces the next line; keep them together.
    if (out.length && /[:：]$/.test(out.at(-1))) out[out.length - 1] += part;
    else out.push(part);
  }
  return out.filter((x) => x.length >= 4);
}
const sentenceWith = (text, re) => sentences(text).find((x) => re.test(x)) || "";
const lastAsking = (text) => sentences(text).reverse().find((x) => ASKING_RE.test(x) || /[?？]$/.test(x)) || "";

function harvestTextEvidence(raw) {
  const text = String(raw || "").trim();
  if (!text || /[?？]\s*$|请选择|要不要|是否需要|请确认|等你确认|等待确认|尚未|未(?:全部)?通过|未完成|未验收|未验证|暂缓|失败|报错|\b(?:failed|not completed|not passed|not verified)\b/i.test(text)) return null;
  const delivery = DELIVERY_RE.test(text);
  const review = /验收(?:已)?(?:通过|完成)|已验收|验证.*(?:通过|成功)|测试.*(?:通过|成功)|检查.*通过|全部通过|\b(?:tests? passed|verified|validation passed|reviewed)\b/i.test(text);
  return delivery && review ? shortText(sentenceWith(text, DELIVERY_RE) || plainText(text), 160) : null;
}

// List previews often contain the first user request. Only transcript messages
// establish who spoke last; tool output and reasoning never count as delivery.
// The full message is classified once here and only a short excerpt is kept,
// so overview payloads stay small.
const isChatItem = (item) => ["agentMessage", "userMessage"].includes(item?.type) || ["assistant", "user"].includes(item?.role);
const itemRole = (item) => item.type === "agentMessage" ? "assistant" : item.type === "userMessage" ? "user" : item.role;
const itemText = (item) => String(item.text || (Array.isArray(item.content)
  ? item.content.filter((p) => p.type === "text" || p.type === "input_text" || p.type === "output_text").map((p) => p.text || "").join("\n") : item.content) || "");

// What the harvest judge reads: the request that opened the last turn and the
// final reply, both as plain text and bounded so prompts stay small.
export function judgeInputOf(thread = {}) {
  const items = (thread.turns?.at(-1)?.items || []).filter(isChatItem);
  const reply = [...items].reverse().find((item) => itemRole(item) === "assistant");
  if (!reply) return null;
  const ask = items.find((item) => itemRole(item) === "user");
  const clip = (text, size) => { const chars = Array.from(plainText(text)); return chars.length > size ? `${chars.slice(0, size / 2).join("")}…${chars.slice(-size / 2).join("")}` : chars.join(""); };
  return { title: shortText(thread.title, 80), ask: ask ? clip(itemText(ask), 600) : "", reply: clip(itemText(reply), 2400) };
}

export function threadTail(thread = {}) {
  const turn = thread.turns?.at(-1);
  if (!turn) return thread.assistantTail || null;
  const message = [...(turn.items || [])].reverse().find(isChatItem);
  if (!message) return null;
  const role = itemRole(message);
  const text = itemText(message);
  return { role, text: shortText(plainText(text), TAIL_TEXT_LIMIT), status: turn.status || "", error: Boolean(turn.error),
    asking: ASKING_RE.test(text.trim()), question: ASKING_RE.test(text.trim()) ? shortText(lastAsking(text), 80) : "",
    evidence: harvestTextEvidence(text) };
}

export function isAskingTail(tail) {
  return Boolean(tail && (typeof tail.asking === "boolean" ? tail.asking : ASKING_RE.test(String(tail.text || "").trim())));
}

export function harvestEvidenceForThread(thread = {}) {
  const tail = threadTail(thread);
  if (thread.internal || thread.live || thread.pendingCount > 0 || thread.queuedCount > 0 || thread.lastError || thread.lastTurnStatus === "failed"
    || !tail || tail.role !== "assistant" || tail.error || tail.status !== "completed") return null;
  return tail.evidence !== undefined ? tail.evidence : harvestTextEvidence(tail.text);
}

export function threadSource(thread, topicId) {
  return { kind: "thread", label: shortText(`工位·${thread.title || "未命名"}`, 60), threadId: thread.id, topicId,
    ...(isoTime(thread.updatedAt) ? { at: isoTime(thread.updatedAt) } : {}) };
}

function titleKey(title) {
  return String(title || "").toLowerCase().replace(/(?:\s*[（(]?(?:续|继续|分支|fork|continue)[）)]?\s*\d*)+$/g, "").replace(/[\p{P}\p{Z}\s]/gu, "");
}
function similar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (Math.min(a.length, b.length) < 4) return false;
  const grams = (s) => new Set(Array.from({ length: s.length - 1 }, (_, i) => s.slice(i, i + 2)));
  const x = grams(a), y = grams(b);
  return [...x].filter((g) => y.has(g)).length / new Set([...x, ...y]).size >= 0.7;
}

// Card ids carry the signal type, but handling is about the subject (a thread or
// a task card): a thread that flips from harvest to ruin must stay handled.
export function cardSubject(id = "") {
  return String(id).replace(/^(alert|harvest|ruin):/, "");
}

export function isCardHandled(card, cardState = {}, now = Date.now()) {
  const state = cardState[cardSubject(card.id)] || cardState[card.id];
  if (!state) return false;
  if (state.type === "snooze") return timestamp(state.until) > now;
  if (state.type === "dismiss") return true;
  // Park / done / harvest hide the card until the subject moves again.
  if (["park", "done", "harvest"].includes(state.type)) return timestamp(card.since) <= timestamp(state.at);
  return false;
}

export function computeTopicSignals(topic, { now = Date.now(), cardState = {}, idleWip = [] } = {}) {
  const groups = [];
  const seen = new Set();
  const threads = [...(topic.activeThreads || []), ...(topic.archivedThreads || [])]
    .filter((t) => t?.id && !t.internal && !t.isSlice && !t.archived)
    .sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
  for (const t of threads) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    const cwd = normalizeWorkspacePath(t.cwd || ""), key = titleKey(t.title);
    const group = groups.find((g) => cwd && g.cwd === cwd && similar(g.key, key));
    if (group) group.threads.push(t);
    else groups.push({ cwd, key, threads: [t] });
  }
  const candidates = [];
  for (const group of groups) {
    // The latest workstation describes the current state of a merged task.
    const t = group.threads[0], tail = threadTail(t), at = timestamp(t.updatedAt);
    let type, line;
    if (t.pendingCount > 0 || ["awaiting_approval", "awaiting_user", "waiting_user", "waiting_for_user", "pending", "needs_confirmation"].includes(t.livePhase)) {
      type = "alert"; line = "工位待审批或待用户确认";
    } else if (harvestEvidenceForThread(t)) {
      type = "harvest"; line = harvestEvidenceForThread(t);
    } else if (!t.live && at && now - at >= 3 * DAY && tail?.role === "assistant"
      && isAskingTail(tail)) {
      type = "ruin"; line = tail.question || lastAsking(tail.text) || plainText(tail.text);
    }
    if (!type || !at) continue;
    candidates.push({ id: `${type}:${t.id}`, topicId: topic.id, type, title: shortText(t.title, 24), line: shortText(line, 40),
      since: isoTime(at), threadId: t.id, relatedCount: group.threads.length,
      sources: group.threads.map((th) => threadSource(th, topic.id)),
      actions: type === "harvest" ? ["harvest", "continue", "snooze"] : ["continue", "snooze", "park"] });
  }
  for (const wip of idleWip) {
    const at = timestamp(wip.updated);
    if (!at || now - at < 7 * DAY || wip.status !== "active" || wip.topicId !== topic.id) continue;
    candidates.push({ id: `ruin:${topic.id}:wip:${wip.rel}`, topicId: topic.id, type: "ruin", title: shortText(wip.title, 24),
      line: shortText(wip.state || "active 任务卡已至少 7 天未更新", 40), since: isoTime(at),
      sources: [{ kind: "wip", label: `任务卡·${shortText(wip.title, 30)}`, topicId: topic.id, path: wip.rel, at: isoTime(at) }],
      actions: ["snooze", "park", "done"] });
  }
  const counts = { alert: 0, harvest: 0, ruin: 0 };
  const cards = candidates.sort((a, b) => SIGNAL_TYPES.indexOf(a.type) - SIGNAL_TYPES.indexOf(b.type) || timestamp(a.since) - timestamp(b.since))
    .filter((card) => {
      if (isCardHandled(card, cardState, now)) return false;
      if (counts[card.type] >= 3) return false;
      counts[card.type]++;
      return true;
    });
  const ruins = cards.filter((c) => c.type === "ruin");
  return { top: SIGNAL_TYPES.find((type) => counts[type]) || null, counts,
    ruinDays: ruins.length ? Math.floor(Math.max(...ruins.map((c) => now - timestamp(c.since))) / DAY) : null, cards };
}
