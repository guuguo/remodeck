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

// List previews often contain the first user request. Only transcript messages
// establish who spoke last; tool output and reasoning never count as delivery.
export function threadTail(thread = {}) {
  const turn = thread.turns?.at(-1);
  if (!turn) return thread.assistantTail || null;
  const message = [...(turn.items || [])].reverse().find((item) =>
    ["agentMessage", "userMessage"].includes(item?.type) || ["assistant", "user"].includes(item?.role));
  if (!message) return null;
  const role = message.type === "agentMessage" ? "assistant" : message.type === "userMessage" ? "user" : message.role;
  const text = message.text || (Array.isArray(message.content)
    ? message.content.filter((p) => p.type === "text" || p.type === "input_text" || p.type === "output_text").map((p) => p.text || "").join("\n") : message.content) || "";
  return { role, text: String(text), status: turn.status || "", error: Boolean(turn.error) };
}

export function harvestEvidenceForThread(thread = {}) {
  const tail = threadTail(thread);
  if (thread.internal || thread.live || thread.pendingCount > 0 || thread.queuedCount > 0 || thread.lastError || thread.lastTurnStatus === "failed"
    || !tail || tail.role !== "assistant" || tail.error || tail.status !== "completed") return null;
  const text = tail.text.trim();
  if (!text || /[?？]\s*$|请选择|要不要|是否需要|请确认|等你确认|等待确认|尚未|未(?:全部)?通过|未完成|未验收|未验证|失败|报错|\b(?:failed|not completed|not passed|not verified)\b/i.test(text)) return null;
  const delivery = /已完成|已修复|已生成|已导出|已交付|已实现|已上线|已发布|产出|交付物|完成了|\b(?:implemented|delivered|exported|fixed|completed)\b/i.test(text);
  const review = /验收(?:已)?(?:通过|完成)|已验收|验证.*(?:通过|成功)|测试.*(?:通过|成功)|检查.*通过|全部通过|\b(?:tests? passed|verified|validation passed|reviewed)\b/i.test(text);
  return delivery && review ? shortText(text, 160) : null;
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
      && /[?？]\s*$|请选择|要不要|是否需要|请确认|which (?:one|option)|would you/i.test(tail.text.trim())) {
      type = "ruin"; line = tail.text;
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
      const state = cardState[card.id];
      if (state && (["park", "done", "dismiss", "harvest"].includes(state.type) || (state.type === "snooze" && timestamp(state.until) > now))) return false;
      if (counts[card.type] >= 3) return false;
      counts[card.type]++;
      return true;
    });
  const ruins = cards.filter((c) => c.type === "ruin");
  return { top: SIGNAL_TYPES.find((type) => counts[type]) || null, counts,
    ruinDays: ruins.length ? Math.floor(Math.max(...ruins.map((c) => now - timestamp(c.since))) / DAY) : null, cards };
}
