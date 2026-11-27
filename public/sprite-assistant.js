import { iconSvg } from "./icons.js";
import { apiUrl, apiPost, isDemoMode } from "./api-client.js";
import { t } from "./i18n.js";

export const SPRITE_PREFS_STORAGE_KEY = "agentControl.spritePrefs.v1";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function loadSpritePrefs(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    const raw = JSON.parse(storage?.getItem?.(SPRITE_PREFS_STORAGE_KEY) || "null");
    const modelKey = typeof raw?.modelKey === "string" && raw.modelKey.trim() ? raw.modelKey.trim() : "auto";
    return {
      ttsEnabled: Boolean(raw?.ttsEnabled),
      modelKey,
      phoneAutoExecute: raw?.phoneAutoExecute !== false,
    };
  } catch {
    return { ttsEnabled: false, modelKey: "auto", phoneAutoExecute: true };
  }
}

export function saveSpritePrefs(patch = {}, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  const next = {
    ...loadSpritePrefs(storage),
    ...(patch && typeof patch === "object" ? patch : {}),
  };
  next.ttsEnabled = Boolean(next.ttsEnabled);
  next.modelKey = typeof next.modelKey === "string" && next.modelKey.trim() ? next.modelKey.trim() : "auto";
  next.phoneAutoExecute = next.phoneAutoExecute !== false;
  try {
    storage?.setItem?.(SPRITE_PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export function renderSpriteAvatarSvg({ mood = "idle", size = 32 } = {}) {
  const eyeColor = mood === "urgent"
    ? "#fda4af"
    : mood === "coin"
      ? "#fde047"
      : "#67e8f9";
  const coreStop1 = mood === "urgent"
    ? "#fb7185"
    : mood === "coin"
      ? "#fbbf24"
      : "#38bdf8";
  const coreStop2 = mood === "urgent"
    ? "#e11d48"
    : mood === "coin"
      ? "#d97706"
      : "#2563eb";
  return `
    <svg class="sprite-avatar-svg is-${escapeHtml(mood)}" width="${Number(size) || 32}" height="${Number(size) || 32}" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="spBody_${escapeHtml(mood)}" x1="8" y1="6" x2="32" y2="34" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="${coreStop1}"/>
          <stop offset="100%" stop-color="${coreStop2}"/>
        </linearGradient>
      </defs>
      <ellipse cx="20" cy="7" rx="7.5" ry="2.3" stroke="#fbbf24" stroke-width="1.8" opacity="0.92"/>
      <path d="M9 19C4.2 14.5 3.5 22.5 8.8 24.8" fill="rgba(125,211,252,0.35)" stroke="#7dd3fc" stroke-width="1.2" stroke-linecap="round"/>
      <path d="M31 19C35.8 14.5 36.5 22.5 31.2 24.8" fill="rgba(125,211,252,0.35)" stroke="#7dd3fc" stroke-width="1.2" stroke-linecap="round"/>
      <circle cx="20" cy="21.5" r="10.5" fill="url(#spBody_${escapeHtml(mood)})" stroke="rgba(255,255,255,0.55)" stroke-width="1.2"/>
      <rect x="13" y="17.5" width="14" height="6.8" rx="3.4" fill="#0f172a" opacity="0.88"/>
      <circle cx="16.8" cy="20.9" r="1.55" fill="${eyeColor}"/>
      <circle cx="23.2" cy="20.9" r="1.55" fill="${eyeColor}"/>
      <circle cx="20" cy="34.8" r="2.2" fill="${coreStop1}" opacity="0.55"/>
    </svg>
  `.trim();
}

export function captureSpriteOverviewSnapshot(overview, threads = []) {
  if (!overview || !Array.isArray(overview.domains)) return null;
  const flatTopics = overview.domains.flatMap((d) => d.topics || []);
  const harvestTopics = new Map();
  const threadTopicById = new Map();

  for (const tp of flatTopics) {
    if (tp?.pipeline?.readyToHarvest) {
      harvestTopics.set(tp.id, {
        id: tp.id,
        name: tp.name || tp.id,
        nextStep: tp.nextStep || tp.bottleneck || "",
        evidence: tp.harvestEvidence || null,
        count: tp.assistantSignals?.counts?.harvest || 1,
      });
    }
    for (const th of tp?.activeThreads || []) {
      if (th?.id) threadTopicById.set(th.id, tp.name || tp.id);
    }
  }

  const radar = overview.radar || {};
  const pendingByThread = new Map();
  for (const pt of radar.pendingThreads || []) {
    if (!pt?.id) continue;
    pendingByThread.set(pt.id, {
      id: pt.id,
      title: pt.title || "未命名会话",
      topicName: threadTopicById.get(pt.id) || pt.projectName || "工位",
      pendingCount: Number(pt.pendingCount) || 1,
    });
  }
  for (const th of threads || []) {
    if (!th?.id || !(th.pendingCount > 0)) continue;
    if (!pendingByThread.has(th.id)) {
      pendingByThread.set(th.id, {
        id: th.id,
        title: th.title || "未命名会话",
        topicName: threadTopicById.get(th.id) || "工位",
        pendingCount: Number(th.pendingCount) || 1,
      });
    }
  }

  const liveThreadIds = new Set();
  for (const lt of radar.liveThreads || []) {
    if (lt?.id) liveThreadIds.add(lt.id);
  }
  const threadMetaById = new Map();
  for (const th of threads || []) {
    if (!th?.id) continue;
    if (th.live) liveThreadIds.add(th.id);
    threadMetaById.set(th.id, {
      id: th.id,
      title: th.title || "未命名会话",
      topicName: threadTopicById.get(th.id) || "",
      live: Boolean(th.live),
      lastError: String(th.lastError || ""),
    });
  }
  for (const tp of flatTopics) {
    for (const th of tp?.activeThreads || []) {
      if (!th?.id) continue;
      if (th.live) liveThreadIds.add(th.id);
      if (!threadMetaById.has(th.id)) {
        threadMetaById.set(th.id, {
          id: th.id,
          title: th.title || "未命名会话",
          topicName: tp.name || "",
          live: Boolean(th.live),
          lastError: String(th.lastError || ""),
        });
      }
    }
  }

  return {
    harvestTopics,
    pendingByThread,
    liveThreadIds,
    threadMetaById,
  };
}

export function buildSpriteOpeningBriefing(overview, threads = []) {
  const topics = overview?.domains?.flatMap((d) => d.topics || []) || [];
  const snap = captureSpriteOverviewSnapshot(overview, threads);
  // Same order as the park tour: oldest open work order of the type first.
  const firstWith = (type) => {
    const since = (tp) => Math.min(...(tp.assistantSignals?.cards || []).filter((c) => c.type === type).map((c) => Date.parse(c.since) || Infinity), Infinity);
    return topics.filter((tp) => tp.assistantSignals?.counts?.[type] > 0).sort((a, b) => since(a) - since(b))[0];
  };
  const alert = firstWith("alert");
  const harvest = firstWith("harvest") || topics.find((tp) => tp.pipeline?.readyToHarvest);
  const ruin = firstWith("ruin");
  const oldest = [...topics].sort((a, b) => topicActivityAt(a) - topicActivityAt(b))[0];
  const pending = snap && [...snap.pendingByThread.values()][0];
  const topic = alert || (pending && topics.find((tp) => tp.activeThreads?.some((th) => th.id === pending.id))) || harvest || ruin || oldest;
  const tone = alert || pending ? "urgent" : harvest ? "coin" : ruin ? "worry" : "idle";
  const text = alert || pending
    ? t("{name}还在等你拍板，先给它一句话？", { name: topic?.name || pending.topicName })
    : harvest ? t("{name}有菜可收，先验一下这轮产出？", { name: harvest.name })
      : ruin ? t("{name}上次停下还没收尾，接着做还是先搁着？", { name: ruin.name })
      : oldest ? t("园子很太平，最久没动的是{name}，去看看？", { name: oldest.name })
        : t("园区暂时没有工单，等产线有动静我再报。");
  return { tone, text, spokenText: text, chips: topic ? [{ kind: "topic", id: topic.id, label: t("去看看") }] : [],
    stats: snap ? t("{count} 名 AI 员工正在运转", { count: snap.liveThreadIds.size }) : "" };
}

function topicActivityAt(topic) {
  const times = [topic.updatedAt, topic.lastActivityAt, ...(topic.activeThreads || []).map((th) => th.updatedAt)];
  return Math.max(0, ...times.map((value) => Number(value) || Date.parse(value) || 0));
}

// Chunk parser keeps incomplete lines, including CRLF split across network chunks.
export function parseSpriteNdjson(chunk, remainder = "", final = false) {
  const lines = (remainder + chunk).split("\n");
  const rest = final ? "" : lines.pop();
  const events = lines.filter((line) => line.trim()).map((line) => JSON.parse(line));
  return { events, remainder: rest };
}

export function appendSpriteTurn(session = {}, text, answer) {
  return {
    turns: [...(session.turns || []), { role: "user", text }, { role: "assistant", text: answer.text || "" }].slice(-6),
    focusStack: answer.focusTopicId
      ? [answer.focusTopicId, ...(session.focusStack || []).filter((id) => id !== answer.focusTopicId)]
      : [...(session.focusStack || [])],
  };
}

export async function askSpriteAssistant(body, onTrace, { fetchImpl = globalThis.fetch, demo = isDemoMode(), post = apiPost, signal = null, timeoutMs = 65_000 } = {}) {
  if (demo) {
    const answer = await post("/api/assistant/ask", body);
    for (const trace of answer?.trace || []) onTrace(trace);
    return answer;
  }
  const innerController = new AbortController();
  const idleTimeoutMs = Math.max(5_000, Number(timeoutMs) || 65_000);
  const maxTimeoutMs = Math.max(idleTimeoutMs, 95_000);
  let timedOutReason = "";
  let idleTimer = null;
  const resetIdleTimer = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOutReason = "timeout";
      innerController.abort();
    }, idleTimeoutMs);
  };
  const totalTimer = setTimeout(() => {
    timedOutReason = "timeout";
    innerController.abort();
  }, maxTimeoutMs);
  const onExternalAbort = () => {
    timedOutReason = "aborted";
    innerController.abort();
  };
  if (signal) {
    if (signal.aborted) onExternalAbort();
    else signal.addEventListener("abort", onExternalAbort, { once: true });
  }
  resetIdleTimer();
  try {
    const response = await fetchImpl(apiUrl("./api/assistant/ask"), {
      method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify(body),
      signal: innerController.signal,
    });
    if (!response.ok) throw new Error(t("问答请求失败（{status}）", { status: response.status }));
    if (!(response.headers.get("content-type") || "").includes("ndjson")) {
      const answer = await response.json();
      for (const trace of answer.trace || []) onTrace(trace);
      return answer;
    }
    let remainder = "", answer = null;
    const consume = (chunk, final = false) => {
      const parsed = parseSpriteNdjson(chunk, remainder, final);
      remainder = parsed.remainder;
      for (const event of parsed.events) {
        if (event.type === "ping") { resetIdleTimer(); continue; }
        if (event.type === "trace") { resetIdleTimer(); onTrace(event); }
        if (event.type === "error") throw new Error(event.message || t("检索失败"));
        if (event.type === "answer") answer = event;
      }
    };
    if (response.body?.getReader) {
      const reader = response.body.getReader(), decoder = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          resetIdleTimer();
          consume(decoder.decode(value, { stream: true }));
        }
        consume(decoder.decode(), true);
      } finally { reader.releaseLock(); }
    } else consume(await response.text(), true);
    if (!answer) throw new Error(t("没有收到回答，请重试。"));
    return answer;
  } catch (err) {
    if (timedOutReason === "timeout") {
      throw new Error(t("小精灵思考超时，请重试或切换轻量模型。"));
    }
    if (timedOutReason === "aborted" || signal?.aborted) {
      const abortErr = new Error(t("已停止本次思考"));
      abortErr.name = "AbortError";
      abortErr.aborted = true;
      throw abortErr;
    }
    throw err;
  } finally {
    clearTimeout(idleTimer);
    clearTimeout(totalTimer);
    if (signal) signal.removeEventListener("abort", onExternalAbort);
  }
}

export function submitSpriteDispatch(payload, { confirmed = false, routes = [], post = apiPost } = {}) {
  return post("/api/overview/dispatch", { ...payload, confirmOnly: !confirmed,
    ...(confirmed ? { approvedRoutes: routes } : { useAiPlanner: true }) });
}

export function spriteTomorrowAtEight(now = new Date()) {
  const next = new Date(now);
  next.setDate(next.getDate() + 1);
  next.setHours(8, 0, 0, 0);
  return next.toISOString();
}

export function buildSpriteContext(topic, overview) {
  const name = topic?.name;
  const badges = overview?.assistantBadges || {};
  const signal = topic?.assistantSignals?.top;
  const prompts = { alert: "问{name}：等你拍板的是哪一步？或者说‘派工…’", harvest: "问{name}：这轮收菜的依据是什么？或者说‘派工…’", ruin: "问{name}：上次停在哪？或者说‘派工…’" };
  const primary = signal === "alert" ? "去拍板" : signal === "harvest" ? "去收菜" : "接着做";
  return {
    placeholder: name ? t(prompts[signal] || "问{name}：做到哪了？卡在哪？或者说‘派工…’", { name }) : t("问我任何产线的进度，或者说‘派工…’"),
    quick: name ? [t("做到哪了"), t("卡在哪"), t(primary), t("历史")]
      : [badges.alert ? t("去拍板") : "", badges.harvest ? t("去收菜") : "", badges.ruin ? t("我忘了什么") : "", t("汇报进展")].filter(Boolean),
  };
}

function renderSources(sources = []) {
  return sources.map((source) => source.threadId
    ? renderSpriteChipHtml({ kind: "thread", id: source.threadId, label: source.label })
    : source.topicId ? renderSpriteChipHtml({ kind: "topic", id: source.topicId, label: source.label })
      : `<span class="sprite-source-label">${escapeHtml(source.label)}</span>`).join("");
}

export function renderSpriteWorkCard(card, { busy = false, continueMessage } = {}) {
  const retry = (card.actions || []).includes("retry");
  const action = retry ? "retry" : card.type === "harvest" ? "harvest" : card.threadId ? "continue" : "";
  const message = continueMessage ?? t("接着上次停下的地方继续：{line}", { line: card.line });
  const button = (type, label) => `<button type="button" data-sprite-card-id="${escapeHtml(card.id)}" data-sprite-card-action="${type}" ${busy ? "disabled" : ""}>${t(label)}</button>`;
  const tags = [card.ticketId ? `<span class="sprite-card-tag is-ticket">${t("任务")}</span>` : "", card.originLabel ? `<span class="sprite-card-tag">${escapeHtml(card.originLabel)}</span>` : ""].join("");
  const ticket = card.ticketId ? `${card.goal ? `<p class="sprite-card-goal">${t("目标")}：${escapeHtml(card.goal)}</p>` : ""}${card.criteria?.length
    ? `<ol class="sprite-card-criteria">${card.criteria.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ol>` : `<p class="sprite-card-goal is-muted">${t("还没定验收标准")}</p>`}` : "";
  const primary = action === "retry" ? button("retry", "重试") : action === "harvest" ? button("harvest", "收菜") : action === "continue" ? button("send_continue", "续做") : "";
  return `<article class="sprite-work-card"><div class="sprite-card-head"><strong>${escapeHtml(card.title)}</strong>${tags}</div><p>${escapeHtml(card.line)}</p>${ticket}
    <div class="sprite-msg-chips">${renderSources(card.sources)}</div>
    ${action === "continue" ? `<textarea data-sprite-continue-message="${escapeHtml(card.id)}" aria-label="${t("续做语")}">${escapeHtml(message)}</textarea>` : ""}
    <div class="sprite-card-actions">${primary}${button("snooze", "稍后")}${retry ? "" : button("park", "搁置")}
${retry ? "" : button("done", "完成")}${!retry && !card.ticketId && card.threadId ? button("pin", "钉成任务") : ""}<button type="button" class="sprite-card-quiet" data-sprite-card-id="${escapeHtml(card.id)}" data-sprite-card-action="dismiss" ${busy ? "disabled" : ""}>${t(card.ticketId ? "放弃任务" : "不用提醒")}</button></div></article>`;
}

function buildSpriteTaskTreeFallback(tickets = []) {
  const byId = new Map(tickets.map((tk) => [tk.id, { ...tk, children: [] }]));
  const roots = [];
  for (const node of byId.values()) {
    if (node.parentId && node.parentId !== node.id && byId.has(node.parentId)) {
      byId.get(node.parentId).children.push(node);
    } else {
      roots.push(node);
    }
  }
  const flat = [];
  const walk = (nodes, depth) => {
    for (const n of nodes) {
      flat.push({ ...n, depth });
      if (n.children?.length) walk(n.children, depth + 1);
    }
  };
  walk(roots, 0);
  return flat;
}

// 任务 list for the local「我的任务」intent: rendered as a tree so parent/child hierarchy stays clear.
export function buildSpriteTicketReply(overview) {
  const tickets = Array.isArray(overview?.assistantTickets) ? overview.assistantTickets : [];
  if (!tickets.length) {
    return { tone: "idle", text: t("还没有任务。在会话顶栏「更多」里点「钉成任务」，或在提醒卡上点「钉成任务」。"), spokenText: t("还没有任务。"), actions: [] };
  }
  const treeFlat = buildSpriteTaskTreeFallback(tickets);
  const lines = treeFlat.slice(0, 8).map((tk, i) => {
    const indent = tk.depth > 0 ? `${"  ".repeat(Math.min(3, tk.depth))}└─ ` : `${i + 1}. `;
    const topicPrefix = tk.topicName && tk.depth === 0 ? `「${tk.topicName}」` : "";
    const criteriaSuffix = tk.criteria?.length ? `（${t("验收标准 {count} 条", { count: tk.criteria.length })}）` : "";
    return `${indent}${topicPrefix}${tk.title}：${tk.line}${criteriaSuffix}`;
  });
  const actions = treeFlat.slice(0, 3).flatMap((tk) => [
    ...(tk.threadId ? [{ label: t("打开：{title}", { title: tk.title.slice(0, 8) }), type: "open_thread", payload: { threadId: tk.threadId } }] : []),
    { label: t("改验收：{title}", { title: tk.title.slice(0, 6) }), type: "ticket_edit", payload: { ticketId: tk.id } },
  ]);
  return { tone: tickets.some((tk) => ["waiting", "failed"].includes(tk.state)) ? "urgent" : "idle",
    text: `${t("共 {count} 项进行中的任务：", { count: tickets.length })}\n${lines.join("\n")}`,
    spokenText: t("共有 {count} 项任务，第一项：{line}", { count: tickets.length, line: `${treeFlat[0].title}，${treeFlat[0].line}` }), actions: actions.slice(0, 6) };
}

export function buildSpriteTopicBriefing(topic, nowSec = Math.floor(Date.now() / 1000)) {
  if (!topic) {
    return { tone: "idle", text: "已就绪，请直接下达产线指令。", spokenText: "已就绪。", chips: [] };
  }
  const active = (topic.activeThreads || []).filter((t) => !t.isSlice);
  const older = topic.archivedThreads || [];
  const liveCount = active.filter((t) => t.live).length;
  const staleCount = [...active, ...older].filter((t) => {
    if (t.live || (t.pendingCount || 0) > 0 || t.pinned || t.goalState?.active) return false;
    const u = Number(t.updatedAt) > 1e11 ? Math.floor(Number(t.updatedAt) / 1000) : Number(t.updatedAt || 0);
    return !u || (nowSec - u) >= 3 * 86400;
  }).length;
  const digest = topic.archiveDigest;

  const parts = [`已聚焦「${topic.name}」`];
  if (liveCount > 0) parts.push(`${liveCount} 工位运转`);
  else parts.push(`${active.length} 近期工位`);

  if (staleCount > 0) {
    parts.push(`${staleCount} 条久远对话待归档`);
  }
  if (digest?.summary) {
    parts.push(`已沉淀 ${digest.totalArchivedDigested || 0} 条记忆`);
  }

  const chips = [];
  if (staleCount > 0) {
    chips.push({ kind: "archive_preview", topicId: topic.id, label: `归档 ${staleCount} 条久远对话并总结` });
  }
  if (topic.summary?.nextStep) {
    chips.push({ kind: "preview", topicId: topic.id, text: topic.summary.nextStep, label: "派工推进下一步" });
  }
  if (topic.metrics?.syncPrompt) {
    chips.push({ kind: "preview", topicId: topic.id, text: topic.metrics.syncPrompt, label: "派单全量采数" });
  }

  return {
    tone: staleCount > 0 ? "coin" : "idle",
    text: parts.join(" · "),
    spokenText: `已进入${topic.name}产线管家，${staleCount > 0 ? `有 ${staleCount} 条历史会话可归档提炼摘要。` : "请下达指令。"}`,
    chips: chips.slice(0, 3),
  };
}

export function buildSpriteQueryReply(kind, overview, threads = []) {
  const snap = captureSpriteOverviewSnapshot(overview, threads);
  if (!snap) {
    return { tone: "idle", text: "产线数据还在加载中，请稍候。", spokenText: "产线数据还在加载中。", chips: [] };
  }
  if (kind === "query_pending") {
    const list = Array.from(snap.pendingByThread.values());
    if (!list.length) {
      return {
        tone: "idle",
        text: "目前没有需要拍板确认的工位，大家都在顺畅推进。",
        spokenText: "目前没有需要拍板确认的工位。",
        chips: [],
      };
    }
    const names = list.slice(0, 3).map((x) => `「${x.topicName} · ${x.title}」`).join("、");
    return {
      tone: "urgent",
      text: `当前共 ${list.length} 个待拍板工位：${names}。点击下方按钮可直接跳转处理：`,
      spokenText: `当前共有 ${list.length} 个工位待你拍板，包括 ${list[0].topicName}。`,
      chips: list.slice(0, 3).map((x) => ({ kind: "thread", id: x.id, label: `${x.topicName}: ${x.title.slice(0, 12)}` })),
    };
  }
  if (kind === "query_harvest") {
    const list = Array.from(snap.harvestTopics.values());
    if (!list.length) {
      return {
        tone: "idle",
        text: "暂时还没有标记为准收菜的产线，可以先推进临门一脚主线。",
        spokenText: "暂时还没有准收菜产线。",
        chips: [],
      };
    }
    const names = list.slice(0, 3).map((x) => `「${x.name}」`).join("、");
    return {
      tone: "coin",
      text: list.map((tp) => `「${tp.name}」${tp.evidence ? t("有 {count} 筐可收（依据：{evidence}）", { count: tp.count, evidence: tp.evidence }) : t("看阶段快能收菜了（推测）")}`).join("；"),
      spokenText: `共有 ${list.length} 条准收菜产线，包括 ${list[0].name}。`,
      chips: list.slice(0, 3).map((x) => (
        x.nextStep
          ? { kind: "preview", topicId: x.id, text: x.nextStep, label: `派工收尾：${x.name}` }
          : { kind: "topic", id: x.id, label: `查看：${x.name}` }
      )),
    };
  }
  return buildSpriteOpeningBriefing(overview, threads);
}

export function diffSpriteOverviewEvents(prevSnap, nextSnap, { recentCompletedByThread = null } = {}) {
  if (!prevSnap || !nextSnap) return [];
  const events = [];

  for (const [id, item] of nextSnap.pendingByThread.entries()) {
    if (!prevSnap.pendingByThread.has(id)) {
      events.push({
        type: "pending",
        tone: "urgent",
        text: `待拍板提醒：「${item.topicName}」工位（${item.title}）需要你确认授权！`,
        spokenText: `${item.topicName}工位需要你拍板确认。`,
        chips: [{ kind: "thread", id, label: `去拍板：${item.title.slice(0, 14)}` }],
      });
    }
  }

  for (const [topicId, tp] of nextSnap.harvestTopics.entries()) {
    if (!prevSnap.harvestTopics.has(topicId)) {
      events.push({
        type: "harvest",
        tone: "coin",
        text: `「${tp.name}」${tp.evidence ? t("有 {count} 筐可收（依据：{evidence}）", { count: tp.count, evidence: tp.evidence }) : t("看阶段快能收菜了（推测）")}`,
        spokenText: `好消息，${tp.name}已进入准收菜阶段。`,
        chips: [{ kind: "topic", id: topicId, label: `查看：${tp.name}` }],
      });
    }
  }

  for (const prevLiveId of prevSnap.liveThreadIds) {
    if (!nextSnap.liveThreadIds.has(prevLiveId)) {
      const meta = nextSnap.threadMetaById.get(prevLiveId) || prevSnap.threadMetaById.get(prevLiveId);
      const recent = recentCompletedByThread?.get?.(prevLiveId);
      const isFailed = Boolean(recent?.status === "error" || meta?.lastError);
      const prefix = meta?.topicName ? `「${meta.topicName}」` : "";
      const title = meta?.title || "工位会话";
      if (isFailed) {
        const errBrief = String(meta?.lastError || recent?.summary || "执行中断").slice(0, 48);
        events.push({
          type: "failed",
          tone: "urgent",
          text: `工位异常：${prefix}${title} 执行失败（${errBrief}）。`,
          spokenText: `注意，${meta?.topicName || title}工位执行出现异常。`,
          chips: [{ kind: "thread", id: prevLiveId, label: `排查：${title.slice(0, 12)}` }],
        });
      } else if (meta) {
        events.push({
          type: "completed",
          tone: "work",
          text: `工位完工：${prefix}${title} 跑完一轮，等你收菜。`,
          spokenText: `${meta?.topicName || title}工位跑完一轮，等你收菜。`,
          chips: [{ kind: "thread", id: prevLiveId, label: `验收：${title.slice(0, 12)}` }],
        });
      }
    }
  }

  return events;
}

export function classifySpriteUserInput(rawText, {
  hasPendingPreview = false,
  hasPendingArchive = false,
  hasPendingReorg = false,
  scopedTopicId = "",
  overview = null,
  agentOptions = [],
  excludedAgentKeys = [],
} = {}) {
  const text = String(rawText || "").trim();
  if (!text) return { intent: "empty" };

  if (hasPendingReorg) {
    if (/^(确认|确定|确认调整|执行|应用|可以|好的|好|行|没问题|ok|yes)[!！。.,，~～]*$/i.test(text)) {
      return { intent: "confirm_reorg" };
    }
    if (/^(取消|算了|不要|不改了|撤回|放弃|no|cancel)[!！。.,，~～]*$/i.test(text)) {
      return { intent: "cancel_reorg" };
    }
  }

  if (hasPendingArchive) {
    if (/^(确认|确定|确认归档|归档|开始归档|执行|可以|好的|好|行|没问题|ok|yes)[!！。.,，~～]*$/i.test(text)) {
      return { intent: "confirm_archive" };
    }
    if (/^(取消|算了|不要|不归档|撤回|放弃|no|cancel)[!！。.,，~～]*$/i.test(text)) {
      return { intent: "cancel_archive" };
    }
  }

  if (hasPendingPreview) {
    if (/^(确认|确定|确认派出|派出|派工|执行|立即派出|发吧|可以|好的|好|行|没问题|ok|yes|走起)[!！。.,，~～]*$/i.test(text)) {
      return { intent: "confirm_preview" };
    }
    if (/^(取消|算了|不要|不派了|撤回|放弃|no|cancel)[!！。.,，~～]*$/i.test(text)) {
      return { intent: "cancel_preview" };
    }
  }

  if (/^(汇报|汇报进展|进展|当前进展|进度|播报|播报进度|盘点|总结|情况|现在什么情况|谁在忙|在忙什么)[?？!！。.~～]*$/i.test(text)) {
    return { intent: "briefing" };
  }
  if (/^(谁待拍板|待拍板|待确认|审批|有什么要确认|待批示|谁等我确认)[?？!！。.~～]*$/i.test(text)) {
    return { intent: "query_pending" };
  }
  if (/^(准收菜|收菜|临门一脚|能收菜|哪些能收菜|哪些能变现)[?？!！。.~～]*$/i.test(text)) {
    return { intent: "query_harvest" };
  }
  if (/^(工单|我的工单|看工单|工单列表|有哪些工单|工单进度|工单怎么样了|任务|我的任务|看任务|任务列表|有哪些任务|任务进度|任务树)[?？!！。.~～]*$/i.test(text)) {
    return { intent: "query_tickets" };
  }

  let matchedTopicId = "";
  const allTopics = Array.isArray(overview?.topics) ? overview.topics : overview?.domains?.flatMap((d) => d.topics || []) || [];
  for (const tp of allTopics) {
    const cleanName = String(tp?.name || "").trim();
    if (cleanName && cleanName.length >= 2 && text.includes(cleanName)) {
      matchedTopicId = tp.id;
      break;
    }
  }
  const effectiveTopicId = matchedTopicId || scopedTopicId || "";

  // Archive + summarize intent (e.g., "把过去很久的对话归档并总结", "归档闲置超过5天的会话", "清理历史对话")
  if (/(归档|清理|收起|整理).*(对话|会话|历史|闲置|久远|摘要|总结)|(历史|闲置|久远).*(归档|总结|摘要)|^归档(总结|历史|闲置)?[!！。.~～]*$/i.test(text)) {
    const dayMatch = text.match(/(\d+)\s*天/);
    const staleDays = dayMatch ? Math.max(0, Math.min(365, Number.parseInt(dayMatch[1], 10))) : 3;
    return {
      intent: "archive_preview",
      topicId: effectiveTopicId,
      staleDays,
    };
  }

  // Blueprint / Dream Factory layout correction intent
  if (
    /(重新扫描|重扫|重新发现|恢复默认发现|清空重扫)/.test(text)
    || /(改名为|重命名为|移到|移动到|归入|挪到|调整到|合并成|合并为|合并到)/.test(text)
    || /(和|与|跟).{1,24}合并/.test(text)
    || /^(?:请|帮我)?(?:删除|移除|去掉|隐藏|不要).{1,24}(?:产线|项目)$/.test(text)
    || /(调整|纠偏|重排|整理|重构).{0,8}(梦工厂|产线|布局|房区|蓝图)/.test(text)
  ) {
    return {
      intent: "reorg_preview",
      instruction: text,
    };
  }

  if (!/^(?:小精灵[,，\s]*)?(?:请|帮我|麻烦)?\s*(?:自动)?(?:派工(?!是什么|记录|历史|怎么)|派单(?!是什么|记录|历史|怎么)|让.{1,40}去|开(?:个|一个)?工位.{0,8}做|dispatch\b|assign\b)/i.test(text)) return { intent: "ask", text, topicId: effectiveTopicId };

  // Natural language dispatch extraction
  let agentKey = "auto";
  const lower = text.toLowerCase();
  const excludedSet = new Set(Array.isArray(excludedAgentKeys) ? excludedAgentKeys : []);
  const isExcludedOpt = (o) => Boolean(o?.excluded || excludedSet.has(o?.key));
  const pickProvider = (prov) => {
    const activeHit = (agentOptions || []).find((o) => o.provider === prov && !isExcludedOpt(o));
    if (activeHit) return activeHit.key;
    const hit = (agentOptions || []).find((o) => o.provider === prov);
    return hit ? hit.key : "auto";
  };
  if (/\b(antigravity|agy)\b/i.test(lower)) {
    agentKey = pickProvider("antigravity");
  } else if (/\bclaude\b/i.test(lower)) {
    const specific = (agentOptions || []).find(
      (o) => o.provider === "claude" && o.label && lower.includes(o.label.toLowerCase()),
    );
    agentKey = specific ? specific.key : pickProvider("claude");
  } else if (/\bcodex\b/i.test(lower)) {
    agentKey = pickProvider("codex");
  }

  const mode = /(新开分身|强制新开|新建工位|新开一个工位|并发新开)/.test(text) ? "new" : "auto";

  const cleanedInstruction = text
    .replace(/^(小精灵[,，\s]*)?(请|帮我|麻烦)?(自动)?(派单|派工|召唤员工|下达指令)[：:\s,]*/i, "")
    .trim() || text;

  return {
    intent: "dispatch_preview",
    instruction: cleanedInstruction,
    topicId: effectiveTopicId,
    agentKey,
    mode,
  };
}

function renderSpriteChipHtml(chip) {
  if (!chip) return "";
  if (chip.kind === "thread" && chip.id) {
    return `<button type="button" class="sprite-msg-chip" data-board-open-thread="${escapeHtml(chip.id)}">${escapeHtml(chip.label || "打开会话")} →</button>`;
  }
  if (chip.kind === "topic" && chip.id) {
    return `<button type="button" class="sprite-msg-chip" data-sprite-focus-topic="${escapeHtml(chip.id)}">${escapeHtml(chip.label || "定位产线")}</button>`;
  }
  if (chip.kind === "archive_preview" && chip.topicId) {
    return `<button type="button" class="sprite-msg-chip is-accent" data-sprite-archive-topic="${escapeHtml(chip.topicId)}">${iconSvg("archive", { size: 11 })}<span>${escapeHtml(chip.label || "归档并提炼摘要")}</span></button>`;
  }
  if (chip.kind === "preview" && chip.text) {
    return `<button type="button" class="sprite-msg-chip is-accent" data-sprite-quick-preview="${escapeHtml(chip.text)}" data-sprite-quick-topic="${escapeHtml(chip.topicId || "")}">${iconSvg("bolt", { size: 11 })}<span>${escapeHtml(chip.label || "生成派工预览")}</span></button>`;
  }
  return "";
}

function renderPendingReorgCardHtml(pendingReorg, busy = false) {
  if (!pendingReorg || !Array.isArray(pendingReorg.operations) || !pendingReorg.operations.length) return "";
  const ops = pendingReorg.operations;
  const typeTag = {
    rename: "改名",
    move: "换房区",
    merge: "合并",
    remove: "移除",
    rescan: "重扫",
    update_desc: "改简介",
  };
  return `
    <div class="sprite-preview-card is-reorg-preview" role="region" aria-label="梦工厂布局纠偏预览">
      <div class="sprite-preview-head">
        <strong>${iconSvg("layers", { size: 12 })} 梦工厂布局调整方案（${ops.length} 项）</strong>
      </div>
      <div class="sprite-preview-routes">
        ${ops.map((op) => `
          <div class="sprite-preview-route">
            <div class="sprite-preview-line1">
              <span class="sprite-route-act is-spawn">${escapeHtml(typeTag[op.type] || op.type)}</span>
              <strong class="sprite-route-topic">${escapeHtml(op.label || op.type)}</strong>
            </div>
          </div>
        `).join("")}
      </div>
      <div class="sprite-preview-actions">
        <span class="sprite-preview-hint">确认后写入本地产线配置，可点确认或说「确认」</span>
        <div class="sprite-preview-btns">
          <button type="button" class="mo-ctrl-btn sprite-btn-cancel" data-sprite-action="cancel-reorg" ${busy ? "disabled" : ""}>取消</button>
          <button type="button" class="btn-primary btn-xs sprite-btn-confirm" data-sprite-action="confirm-reorg" ${busy ? "disabled" : ""}>
            ${iconSvg("check", { size: 11 })}<span>${busy ? "应用中…" : "确认调整"}</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderPendingArchiveCardHtml(pendingArchive, busy = false) {
  if (!pendingArchive || !pendingArchive.topicId) return "";
  const candidates = Array.isArray(pendingArchive.candidates) ? pendingArchive.candidates : [];
  const days = Number(pendingArchive.staleDays ?? 3);
  return `
    <div class="sprite-preview-card is-archive-preview" role="region" aria-label="待归档会话预览">
      <div class="sprite-preview-head">
        <strong>${iconSvg("archive", { size: 12 })} 归档总结预览 ·「${escapeHtml(pendingArchive.topicName || pendingArchive.topicId)}」（${candidates.length} 条）</strong>
        <div class="sprite-archive-days">
          ${[1, 3, 7].map((d) => `
            <button
              type="button"
              class="sprite-day-pill ${days === d ? "is-active" : ""}"
              data-sprite-archive-days="${d}"
              ${busy ? "disabled" : ""}
            >≥${d}天</button>
          `).join("")}
        </div>
      </div>
      ${candidates.length ? `
        <div class="sprite-preview-routes">
          ${candidates.slice(0, 12).map((c) => `
            <div class="sprite-preview-route">
              <div class="sprite-preview-line1">
                <span class="sprite-route-act is-spawn">${c.idleDays}天前</span>
                <strong class="sprite-route-topic">${escapeHtml(c.title)}</strong>
              </div>
              ${c.preview ? `<div class="sprite-preview-reason">${escapeHtml(c.preview)}</div>` : ""}
            </div>
          `).join("")}
          ${candidates.length > 12 ? `<div class="sprite-preview-reason">…以及其余 ${candidates.length - 12} 条闲置历史会话</div>` : ""}
        </div>
        <div class="sprite-preview-reason">${pendingArchive.memoryVault
          ? `确认后先读取会话内容，把事实 / 决策 / 经验 / 未完成任务落进共享记忆库（<code>项目/${escapeHtml(pendingArchive.topicId)}/</code>），再批量归档`
          : `确认后批量归档并提炼「产线归档摘要」，双存至面板与 <code>.agent-context.${escapeHtml(pendingArchive.topicId)}.md</code>`}</div>
      ` : `
        <div class="sprite-preview-reason">当前没有闲置满 ${days} 天的未置顶会话，可点右上角切换「≥1天」查看。</div>
      `}
      <div class="sprite-preview-actions">
        <span class="sprite-preview-hint">${candidates.length ? "可点确认，或说「确认」" : "无匹配项"}</span>
        <div class="sprite-preview-btns">
          <button type="button" class="mo-ctrl-btn sprite-btn-cancel" data-sprite-action="cancel-archive" ${busy ? "disabled" : ""}>取消</button>
          <button type="button" class="btn-primary btn-xs sprite-btn-confirm" data-sprite-action="confirm-archive" ${busy || !candidates.length ? "disabled" : ""}>
            ${iconSvg("archive", { size: 11 })}<span>${busy ? "归档提炼中…" : `确认归档 (${candidates.length})`}</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderPendingPreviewCardHtml(pendingPreview, busy = false) {
  if (!pendingPreview || !Array.isArray(pendingPreview.routes) || !pendingPreview.routes.length) return "";
  const routes = pendingPreview.routes;
  const chosenModel = pendingPreview.payload?.model || "";
  const inheritEnabled = pendingPreview.payload?.inheritContext !== false;
  const anySpawnHasDigest = routes.some((rt) => rt.action === "spawn_parallel" && rt.hasTopicDigest);
  const aiPlanned = Boolean(pendingPreview.aiPlanned);
  const aiModel = String(pendingPreview.aiModel || "").trim();

  return `
    <div class="sprite-preview-card" role="region" aria-label="待确认派工预览">
      <div class="sprite-preview-head">
        <strong>${iconSvg("split", { size: 12 })} 派工预览（共 ${routes.length} 单 · 待你确认）</strong>
        ${aiPlanned ? `<span class="sprite-ai-badge" title="${escapeHtml(aiModel ? `由 ${aiModel} 规划` : "由 AI 规划")}">AI 分配${aiModel ? ` · ${escapeHtml(aiModel)}` : ""}</span>` : ""}
      </div>
      <div class="sprite-preview-routes">
        ${routes.map((rt) => {
          const actLabel = rt.action === "reuse_clean" ? "复用干净工位" : "新开并发分身";
          const agentLabel = rt.agentLabel || rt.providerLabel || rt.provider || "自动匹配账号";
          const modelBase = rt.model || chosenModel || "账号默认模型";
          const modelLabel = rt.effort ? `${modelBase} · ${rt.effort}` : modelBase;
          const diffLabel = rt.taskDifficultyLabel || "";
          const taskBrief = String(rt.segmentText || "").trim();
          return `
            <div class="sprite-preview-route">
              <p class="sprite-dispatch-confirm">${escapeHtml(t("我理解为：让 {agent} 在 {topic}（{station}）做 {task}，这样派吗？", { agent: agentLabel, topic: rt.topicName || t("未指定产线"), station: rt.action === "reuse_clean" ? t("原工位") : t("新工位"), task: taskBrief || pendingPreview.payload?.text || "" }))}</p>
              <div class="sprite-preview-line1">
                <span class="sprite-route-act ${rt.action === "reuse_clean" ? "is-reuse" : "is-spawn"}">${escapeHtml(actLabel)}</span>
                <strong class="sprite-route-topic">${escapeHtml(rt.topicName || "未指定产线")}</strong>
                ${diffLabel ? `<span class="mo-inherit-pill">${escapeHtml(diffLabel)}</span>` : ""}
                ${rt.action === "spawn_parallel" && rt.hasTopicDigest && inheritEnabled ? `<span class="mo-inherit-pill">继承归档记忆</span>` : ""}
              </div>
              ${taskBrief ? `<div class="sprite-route-task">${escapeHtml(taskBrief)}</div>` : ""}
              <div class="sprite-preview-meta">
                <span>账号：<strong>${escapeHtml(agentLabel)}</strong></span>
                <span>模型：<strong>${escapeHtml(modelLabel)}</strong></span>
              </div>
              ${(rt.agentReason || rt.reason) ? `<div class="sprite-preview-reason">${escapeHtml([rt.agentReason, rt.reason].filter(Boolean).join(" · "))}</div>` : ""}
            </div>
          `;
        }).join("")}
      </div>
      ${anySpawnHasDigest ? `
        <label class="sprite-inherit-row">
          <input type="checkbox" data-sprite-toggle-inherit="1" ${inheritEnabled ? "checked" : ""} ${busy ? "disabled" : ""} />
          <span>新开分身自动注入该产线的历史归档摘要（复用工位不重复注入）</span>
        </label>
      ` : ""}
      <div class="sprite-preview-actions">
        <span class="sprite-preview-hint">可点右侧按钮，或语音说「确认」</span>
        <div class="sprite-preview-btns">
          <button type="button" class="mo-ctrl-btn sprite-btn-cancel" data-sprite-action="edit-dispatch" ${busy ? "disabled" : ""}>${t("修改")}</button>
          <button type="button" class="btn-primary btn-xs sprite-btn-confirm" data-sprite-action="confirm-dispatch" ${busy ? "disabled" : ""}>
            ${iconSvg("send", { size: 11 })}<span>${busy ? "派出中…" : "确认派出"}</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

function formatVoiceElapsed(sec = 0) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const r = String(s % 60).padStart(2, "0");
  return `${m}:${r}`;
}

function renderSpriteDispatchPrefsDrawerHtml({
  prefsOpen = false,
  agentOptions = [],
  excludedAgentKeys = [],
  busy = false,
} = {}) {
  if (!prefsOpen) return "";
  const excludedSet = new Set(Array.isArray(excludedAgentKeys) ? excludedAgentKeys : []);
  return `
    <div class="sprite-prefs-drawer" role="region" aria-label="默认跳过分派账号">
      <div class="sprite-prefs-head">
        <div>
          <strong>自动派单默认跳过</strong>
          <span>手动指定时仍可选用</span>
        </div>
        <button type="button" class="mo-ctrl-btn sprite-prefs-done" data-sprite-action="toggle-dispatch-prefs">完成</button>
      </div>
      ${agentOptions.length ? `
        <div class="sprite-prefs-list">
          ${agentOptions.map((opt) => {
            const checked = excludedSet.has(opt.key);
            return `
              <label class="sprite-prefs-item ${checked ? "is-excluded" : ""}">
                <input
                  type="checkbox"
                  data-sprite-toggle-excluded="${escapeHtml(opt.key)}"
                  ${checked ? "checked" : ""}
                  ${busy ? "disabled" : ""}
                />
                <span class="sprite-prefs-provider">${escapeHtml(opt.providerLabel || opt.provider || "")}</span>
                <span class="sprite-prefs-label">${escapeHtml(opt.label || opt.key)}</span>
                ${checked ? `<span class="sprite-prefs-badge">已跳过</span>` : ""}
              </label>
            `;
          }).join("")}
        </div>
      ` : `<div class="sprite-prefs-empty">暂未检测到已登录的可用账号</div>`}
    </div>
  `;
}

function renderSpriteModelSelectHtml(modelOptions = [], selectedKey = "auto", { id = "", busy = false } = {}) {
  const list = Array.isArray(modelOptions) && modelOptions.length
    ? modelOptions
    : [{ key: "auto", label: t("自动优选模型") }];
  const hasSelected = list.some((opt) => opt.key === selectedKey);
  const effectiveKey = hasSelected ? selectedKey : list[0].key;
  return `<select ${id ? `id="${escapeHtml(id)}"` : ""} class="sprite-model-select" data-sprite-model-select="1" ${busy ? "disabled" : ""} aria-label="${t("选择小精灵对话模型")}">${list.map((opt) => `<option value="${escapeHtml(opt.key)}"${opt.key === effectiveKey ? " selected" : ""}>${escapeHtml(opt.shortLabel || opt.label || opt.key)}</option>`).join("")}</select>`;
}

function renderPendingProposalCardHtml(pendingProposal, busy = false) {
  if (!pendingProposal || !pendingProposal.summary) return "";
  const routes = Array.isArray(pendingProposal.routes) ? pendingProposal.routes : [];
  const routesHtml = routes.length > 1
    ? `<div class="sprite-preview-routes">${routes.map((r, i) => `
        <div class="sprite-preview-route">
          <div class="sprite-preview-line1">
            <span class="sprite-route-act is-spawn">${i + 1}</span>
            <strong class="sprite-route-topic">${escapeHtml(r.topicName || "工作区")}</strong>
            <span class="mo-inherit-pill">${escapeHtml(r.agentLabel || "自动匹配")}</span>
          </div>
          ${r.segmentText ? `<div class="sprite-preview-reason">${escapeHtml(r.segmentText)}</div>` : ""}
        </div>
      `).join("")}</div>`
    : "";
  return `
    <div class="sprite-preview-card is-proposal-card" role="region" aria-label="待确认执行动作">
      <div class="sprite-preview-head">
        <strong>${iconSvg("bolt", { size: 12 })} ${t("我将为你执行以下操作")}</strong>
      </div>
      <p class="sprite-dispatch-confirm">${escapeHtml(pendingProposal.summary)}</p>
      ${routesHtml}
      <div class="sprite-preview-actions">
        <span class="sprite-preview-hint">${t("可点确认，或直接说「确认」")}</span>
        <div class="sprite-preview-btns">
          <button type="button" class="mo-ctrl-btn sprite-btn-cancel" data-sprite-action="cancel-proposal" ${busy ? "disabled" : ""}>${t("取消")}</button>
          <button type="button" class="btn-primary btn-xs sprite-btn-confirm" data-sprite-action="confirm-proposal" ${busy ? "disabled" : ""}>
            ${iconSvg("check", { size: 11 })}<span>${busy ? t("执行中…") : t("确认执行")}</span>
          </button>
        </div>
      </div>
    </div>
  `;
}

const BLOCKED_INLINE_LINK_TAGS = new Set(["a", "button", "pre", "script", "style", "textarea", "select"]);

export function linkifySpriteAnswerHtml(html, links = []) {
  const list = Array.isArray(links) ? links : [];
  if (!html || !list.length) return String(html || "");
  const entries = [];
  const byLower = new Map();
  for (const item of list) {
    if (!item?.id || !["thread", "topic"].includes(item.kind)) continue;
    const rawTerm = String(item.matchText || item.label || "").trim();
    const minLen = item.kind === "topic" ? 2 : 3;
    if (Array.from(rawTerm).length < minLen) continue;
    const escaped = escapeHtml(rawTerm);
    const lower = escaped.toLowerCase();
    if (!byLower.has(lower)) {
      byLower.set(lower, item);
      entries.push({ item, escaped });
    }
  }
  if (!entries.length) return String(html);
  entries.sort((a, b) => b.escaped.length - a.escaped.length);
  const pattern = new RegExp(entries.map((e) => e.escaped.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
  const parts = String(html).split(/(<[^>]+>)/g);
  const blockedStack = [];
  return parts.map((part) => {
    if (!part) return "";
    if (part.startsWith("<") && part.endsWith(">")) {
      const closeMatch = part.match(/^<\/\s*([a-z0-9-]+)\b/i);
      if (closeMatch) {
        const tag = closeMatch[1].toLowerCase();
        const idx = blockedStack.lastIndexOf(tag);
        if (idx >= 0) blockedStack.splice(idx, 1);
      } else if (!/\/>$/.test(part)) {
        const openMatch = part.match(/^<\s*([a-z0-9-]+)\b/i);
        if (openMatch) {
          const tag = openMatch[1].toLowerCase();
          if (BLOCKED_INLINE_LINK_TAGS.has(tag)) blockedStack.push(tag);
        }
      }
      return part;
    }
    if (blockedStack.length > 0) return part;
    return part.replace(pattern, (matched) => {
      const item = byLower.get(matched.toLowerCase());
      if (!item) return matched;
      if (item.kind === "thread") {
        return `<button type="button" class="sprite-inline-link is-thread" data-board-open-thread="${escapeHtml(item.id)}" title="${escapeHtml(t("打开会话：{label}", { label: item.label || matched }))}">${matched}<span class="sprite-inline-arrow" aria-hidden="true">↗</span></button>`;
      }
      return `<button type="button" class="sprite-inline-link is-topic" data-sprite-focus-topic="${escapeHtml(item.id)}" title="${escapeHtml(t("查看产线：{label}", { label: item.label || matched }))}">${matched}<span class="sprite-inline-arrow" aria-hidden="true">↗</span></button>`;
    });
  }).join("");
}

function renderSpriteLinksBarHtml(links = []) {
  const list = Array.isArray(links) ? links : [];
  if (!list.length) return "";
  return `<div class="sprite-msg-links">${list.map((link) => (
    link.kind === "thread"
      ? renderSpriteChipHtml({ kind: "thread", id: link.id, label: t("打开会话：{label}", { label: link.label || link.id }) })
      : renderSpriteChipHtml({ kind: "topic", id: link.id, label: t("查看产线：{label}", { label: link.label || link.id }) })
  )).join("")}</div>`;
}

export function renderSpriteMessageHtml(m, renderMarkdown = null) {
  const isUser = m.role === "user";
  const rawBodyHtml = isUser
    ? escapeHtml(m.text || "")
    : (typeof renderMarkdown === "function" ? renderMarkdown(m.text || "") : escapeHtml(m.text || "").replace(/\n/g, "<br>"));
  const linkedBodyHtml = isUser ? rawBodyHtml : linkifySpriteAnswerHtml(rawBodyHtml, m.links);
  const bodyHtml = isUser
    ? `<div class="sprite-msg-text">${linkedBodyHtml}</div>`
    : `<div class="sprite-msg-text ${typeof renderMarkdown === "function" ? "md-body" : ""}">${linkedBodyHtml}</div>`;
  const links = Array.isArray(m.links) ? m.links : [];
  const linksBarHtml = isUser ? "" : renderSpriteLinksBarHtml(links);
  const sources = Array.isArray(m.sources) ? m.sources : [];
  const hasTrace = Boolean((Array.isArray(m.traceSteps) && m.traceSteps.length) || m.trace);
  const lastTraceLabel = Array.isArray(m.traceSteps) && m.traceSteps.length
    ? (m.traceSteps.at(-1)?.label || "已检索上下文")
    : (m.trace?.label || "参考上下文");
  const traceSummary = sources.length ? `${lastTraceLabel}（${t("参考 {count} 条上下文", { count: sources.length })}）` : lastTraceLabel;
  let traceHtml = "";
  let inlineSourcesHtml = "";
  if (hasTrace) {
    traceHtml = `<details class="sprite-trace"><summary>${escapeHtml(traceSummary)}</summary>${
      Array.isArray(m.traceSteps) && m.traceSteps.length
        ? `<ul class="sprite-trace-list">${m.traceSteps.map((tr) => `<li>${escapeHtml(tr.label)}</li>`).join("")}</ul>`
        : ""
    }${sources.length ? `<div class="sprite-msg-chips">${renderSources(sources)}</div>` : ""}</details>`;
  } else if (sources.length) {
    if (links.length || sources.length > 4) {
      traceHtml = `<details class="sprite-trace"><summary>${escapeHtml(t("参考上下文（{count} 条）", { count: sources.length }))}</summary><div class="sprite-msg-chips">${renderSources(sources)}</div></details>`;
    } else {
      inlineSourcesHtml = `<div class="sprite-msg-chips">${renderSources(sources)}</div>`;
    }
  }
  const visibleActions = Array.isArray(m.actions)
    ? m.actions
      .map((action, index) => ({ action, index }))
      .filter(({ action }) => {
        if (!links.length) return true;
        if (action.type === "open_thread" && links.some((l) => l.kind === "thread" && l.id === action.payload?.threadId)) return false;
        if (action.type === "focus" && links.some((l) => l.kind === "topic" && l.id === action.payload?.topicId)) return false;
        return true;
      })
    : [];
  const notices = Array.isArray(m.notices) ? m.notices : [];
  const noticesHtml = !isUser && notices.length
    ? `<div class="sprite-msg-notices">${notices.map((n) => `
        <div class="sprite-msg-notice-item">
          <span>${escapeHtml(n.text || n.title || "")}</span>
          ${n.threadId ? `<button type="button" class="sprite-inline-link is-thread" data-board-open-thread="${escapeHtml(n.threadId)}" title="${escapeHtml(t("打开会话：{label}", { label: n.title || n.threadId }))}">${escapeHtml(n.title || "打开工位")}<span class="sprite-inline-arrow" aria-hidden="true">↗</span></button>` : ""}
        </div>
      `).join("")}</div>`
    : "";
  return `
    <div class="sprite-msg is-${escapeHtml(m.role || "sprite")} ${m.tone ? `tone-${escapeHtml(m.tone)}` : ""}">
      ${bodyHtml}
      ${m.executedTag ? `<div class="sprite-executed-tag">${iconSvg("check", { size: 11 })}<span>${escapeHtml(m.executedTag)}</span></div>` : ""}
      ${noticesHtml}
      ${linksBarHtml}
      ${traceHtml}
      ${inlineSourcesHtml}
      ${visibleActions.length ? `<div class="sprite-answer-actions">${visibleActions.map(({ action, index }) => `<button type="button" data-sprite-answer-id="${escapeHtml(m.id)}" data-sprite-answer-action="${index}">${escapeHtml(action.label)}</button>`).join("")}</div>` : ""}
      ${m.candidates?.length ? `<div class="sprite-answer-actions">${m.candidates.slice(0, 2).map((candidate) => `<button type="button" data-sprite-clarify-id="${escapeHtml(m.id)}" data-sprite-clarify-topic="${escapeHtml(candidate.topicId)}">${escapeHtml(candidate.title)}</button>`).join("")}</div>` : ""}
      ${Array.isArray(m.chips) && m.chips.length ? `<div class="sprite-msg-chips">${m.chips.map(renderSpriteChipHtml).join("")}</div>` : ""}
    </div>
  `;
}

export function renderSpriteAssistantHtml(spriteState = {}, {
  is3dMode = false,
  enteringOpen = false,
  enteringToast = false,
  agentOptions = [],
  excludedAgentKeys = [],
  renderMarkdown = null,
} = {}) {
  const {
    open = false,
    prefsOpen = false,
    ttsEnabled = false,
    mood = "idle",
    unreadCount = 0,
    toastBubble = null,
    messages = [],
    pendingPreview = null,
    pendingArchive = null,
    pendingReorg = null,
    pendingProposal = null,
    scopedTopicId = "",
    scopedTopicName = "",
    busy = false,
    thinkingLabel = "",
    recording = false,
    handsFree = false,
    speechActive = false,
    speaking = false,
    recordElapsedSec = 0,
    transcribing = false,
    draft = "",
  } = spriteState;

  const hasPendingCard = Boolean(pendingPreview || pendingArchive || pendingReorg || pendingProposal);
  const effectiveMood = hasPendingCard ? "coin" : mood;
  const badgeCount = unreadCount + (hasPendingCard ? 1 : 0);

  const showVoiceBar = Boolean(recording || handsFree || transcribing || speaking);
  const voiceBarStateCls = transcribing
    ? "is-transcribing"
    : speaking
      ? "is-speaking"
      : speechActive
        ? "is-speech"
        : recording
          ? "is-listening"
          : "is-standby";
  const voiceStatusLabel = transcribing
    ? "正在识别语音…"
    : speaking
      ? (handsFree ? "正在播报 · 开口自动打断" : "小精灵播报中…")
      : speechActive
        ? "正在收听人声…"
        : handsFree
          ? "免提收听中 · 直接开口说话"
          : "正在收听 · 说完自动发送";

  const voiceBarHtml = showVoiceBar ? `
    <div id="spriteVoiceBar" class="sprite-voice-bar ${voiceBarStateCls}" role="status" aria-live="polite">
      <div class="sprite-vbar-main">
        <span class="sprite-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
        <span class="sprite-vbar-text">${escapeHtml(voiceStatusLabel)}</span>
        ${(recording && !transcribing && !speaking) ? `<span id="spriteVoiceTimer" class="sprite-vbar-timer">${formatVoiceElapsed(recordElapsedSec)}</span>` : ""}
      </div>
      <div class="sprite-vbar-actions">
        ${speaking ? `
          <button type="button" class="sprite-vbar-btn" data-sprite-action="stop-speech">打断播报</button>
        ` : ""}
        ${handsFree ? `
          <button type="button" class="sprite-vbar-btn is-hangup" data-sprite-action="open-call">结束免提</button>
        ` : (recording && !transcribing ? `
          <button type="button" class="sprite-vbar-btn" data-sprite-action="cancel-mic">取消</button>
          <button type="button" class="sprite-vbar-btn is-done" data-sprite-action="finish-mic">说完了</button>
        ` : "")}
      </div>
    </div>
  ` : "";

  return `
    <div class="sprite-assistant-wrap ${open ? "is-open" : "is-closed"} ${is3dMode ? "is-3d-host" : "is-2d-host"}">
      ${!open && toastBubble?.text ? `
        <div class="sprite-toast-bubble is-${escapeHtml(toastBubble.tone || "idle")}${enteringToast ? " is-entering" : ""}" role="status">
          <button type="button" class="sprite-toast-body" data-sprite-action="open">
            <span class="sprite-toast-text">${escapeHtml(toastBubble.text)}</span>
          </button>
          <button type="button" class="sprite-toast-close" data-sprite-action="dismiss-toast" aria-label="关闭提醒">×</button>
        </div>
      ` : ""}

      ${open ? `
        <section class="sprite-popover-card${enteringOpen ? " is-entering" : ""}${recording || handsFree ? " is-voice-live" : ""}" aria-label="面板小精灵助手">
          <div class="sprite-drawer-handle" data-sprite-drawer-handle="1" aria-hidden="true"></div>
          <header class="sprite-pop-head">
            <div class="sprite-pop-brand">
              ${renderSpriteAvatarSvg({ mood: effectiveMood, size: 24 })}
              <div class="sprite-pop-titles">
                <strong>${scopedTopicId ? `小精灵 · ${escapeHtml(scopedTopicName || scopedTopicId)}` : "小精灵总管"}</strong>
                ${busy ? `<span>${escapeHtml(thinkingLabel || "正在思考…")}</span>` : ""}
              </div>
            </div>
            <div class="sprite-pop-tools">
              ${scopedTopicId ? `
                <button type="button" class="sprite-scope-clear" data-sprite-action="clear-scope" title="切回全厂视角">全厂 ×</button>
              ` : ""}
              <button
                type="button"
                class="sprite-icon-btn ${prefsOpen ? "is-active" : ""}"
                data-sprite-action="toggle-dispatch-prefs"
                title="${excludedAgentKeys.length ? `已默认跳过 ${excludedAgentKeys.length} 个账号（点击设置）` : "设置自动派单默认跳过的账号"}"
                aria-pressed="${prefsOpen ? "true" : "false"}"
              >${iconSvg("settings", { size: 13 })}</button>
              <button
                type="button"
                class="sprite-icon-btn ${ttsEnabled ? "is-active" : ""}"
                data-sprite-action="toggle-tts"
                title="${ttsEnabled ? "语音播报已开启（点击静音）" : "语音播报已关闭（点击开启自动朗读）"}"
                aria-pressed="${ttsEnabled ? "true" : "false"}"
              >${iconSvg(ttsEnabled ? "speaker" : "speaker-off", { size: 13 })}</button>
              <button type="button" class="sprite-icon-btn" data-sprite-action="enter-fullscreen" title="全屏展开小精灵 AI 助手">
                ${iconSvg("maximize", { size: 13 })}
              </button>
              <button
                type="button"
                class="sprite-icon-btn sprite-handsfree-btn ${handsFree ? "is-active is-handsfree" : ""}"
                data-sprite-action="enter-phone"
                title="开启全屏豆包式实时语音电话"
              >
                ${iconSvg("radio", { size: 13 })}<span class="sprite-handsfree-label">${t("电话")}</span>
              </button>
              <button type="button" class="sprite-icon-btn" data-sprite-action="close" title="收起小精灵">
                ${iconSvg("close", { size: 13 })}
              </button>
            </div>
          </header>

          ${renderSpriteDispatchPrefsDrawerHtml({ prefsOpen, agentOptions, excludedAgentKeys, busy })}
          ${prefsOpen ? `<div class="sprite-memory"><strong>${t("小精灵记忆")}</strong><button data-sprite-action="load-memory">${t("查看别名")}</button><button data-sprite-action="clear-memory">${t("一键清空")}</button>${spriteState.profile ? `<ul>${Object.entries(spriteState.profile.aliases || {}).map(([alias, id]) => `<li>${escapeHtml(alias)} → ${escapeHtml(id)}</li>`).join("") || t("暂无别名")}</ul>` : ""}</div>` : ""}

          <div id="spriteFeedList" class="sprite-feed">
            ${messages.length ? messages.slice(-10).map((m) => renderSpriteMessageHtml(m, renderMarkdown)).join("") : `
              <div class="sprite-msg is-sprite">
                <div class="sprite-msg-text">随时和我聊方案、问园区进展、查任务树，或点右上角「电话」直接语音通话。</div>
              </div>
            `}
            ${busy ? `<div class="sprite-fs-thinking is-popover" role="status"><span class="sprite-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="sprite-thinking-text">${escapeHtml(thinkingLabel || "小精灵正在思考…")}</span><button type="button" class="sprite-thinking-stop" data-sprite-action="abort-ask">${t("停止")}</button></div>` : ""}
          </div>

          ${spriteState.tour ? `<nav class="sprite-tour-controls"><strong>${escapeHtml(spriteState.tour.stops[spriteState.tour.index]?.topicTitle || "")}</strong><button data-sprite-action="tour-next">${t("下一站")}</button><button data-sprite-action="tour-skip">${t("跳过")}</button><button data-sprite-action="tour-end">${t("结束")}</button></nav>` : ""}
          <div class="sprite-work-cards">${(spriteState.cards || []).map((card) => renderSpriteWorkCard(card, { ...spriteState, continueMessage: spriteState.continueDrafts?.[card.id] })).join("")}</div>
          ${renderPendingProposalCardHtml(pendingProposal, busy)}
          ${renderPendingReorgCardHtml(pendingReorg, busy)}
          ${renderPendingArchiveCardHtml(pendingArchive, busy)}
          ${renderPendingPreviewCardHtml(pendingPreview, busy)}

          <div class="sprite-quick-row">${(spriteState.context?.quick || [t("汇报进展")]).map((label) => `<button type="button" class="sprite-quick-chip" data-sprite-say="${escapeHtml(label)}">${escapeHtml(label)}</button>`).join("")}${scopedTopicId ? `<button class="sprite-quick-chip" data-sprite-archive-topic="${escapeHtml(scopedTopicId)}">${t("归档历史")}</button>` : ""}</div>

          ${voiceBarHtml}

          <form id="spriteCommandForm" class="sprite-input-row">
            <button
              type="button"
              class="sprite-mic-btn ${recording ? "is-recording" : ""} ${speechActive ? "is-speech" : ""} ${handsFree ? "is-handsfree" : ""} ${transcribing ? "is-transcribing" : ""}"
              data-sprite-action="mic"
              title="${handsFree ? "免提连续收听中（点击立即提交当前语音或结束免提）" : recording ? "正在收听（说完停顿自动发送，或点击立即识别）" : "点击开始语音对话"}"
              ${transcribing || busy ? "disabled" : ""}
            >${iconSvg(transcribing ? "clock" : "mic", { size: 14 })}</button>
            <input
              id="spriteCommandInput"
              type="text"
              class="sprite-cmd-input"
              value="${escapeHtml(draft)}"
              placeholder="${escapeHtml(recording ? t("正在收听语音，也可随时打字发送…") : hasPendingCard ? t("说「确认」执行，或输入新指令…") : spriteState.context?.placeholder || t("问我任何产线的进度，或者说‘派工…’"))}"
              ${busy ? "disabled" : ""}
            />
            <button type="submit" class="btn-primary btn-xs sprite-send-btn" ${busy || transcribing ? "disabled" : ""}>
              ${iconSvg("send", { size: 12 })}
            </button>
          </form>
        </section>
      ` : ""}

      <button
        type="button"
        class="sprite-avatar-trigger is-${escapeHtml(effectiveMood)} ${recording || handsFree ? "is-recording" : ""}"
        data-sprite-action="toggle"
        title="召唤面板小精灵助手（汇报进展 / 归档总结 / 语音派单）"
        aria-expanded="${open ? "true" : "false"}"
      >
        ${renderSpriteAvatarSvg({ mood: effectiveMood, size: 34 })}
        <span class="sprite-trigger-label">${handsFree ? "免提收听中" : recording ? "收听中…" : (scopedTopicId ? escapeHtml((scopedTopicName || "小精灵").slice(0, 6)) : "小精灵")}</span>
        ${badgeCount > 0 && !open ? `<span class="sprite-unread-badge">${badgeCount > 9 ? "9+" : badgeCount}</span>` : ""}
      </button>
    </div>
  `;
}

export function renderSpriteFullscreenHtml(spriteState = {}, {
  agentOptions = [],
  excludedAgentKeys = [],
  renderMarkdown = null,
} = {}) {
  const {
    prefsOpen = false,
    ttsEnabled = false,
    mood = "idle",
    messages = [],
    pendingPreview = null,
    pendingArchive = null,
    pendingReorg = null,
    pendingProposal = null,
    scopedTopicId = "",
    scopedTopicName = "",
    busy = false,
    thinkingLabel = "",
    recording = false,
    speechActive = false,
    speaking = false,
    transcribing = false,
    draft = "",
    modelOptions = [],
    modelKey = "auto",
    phoneCallActive = false,
  } = spriteState;

  const hasPendingCard = Boolean(pendingPreview || pendingArchive || pendingReorg || pendingProposal);
  const effectiveMood = hasPendingCard ? "coin" : mood;
  const starters = [
    "今天园子里最需要我盯什么？",
    "帮我梳理一下当前所有任务进度",
    "我想拆一个新功能的实现方案，帮我理理思路",
  ];

  return `
    <section class="sprite-fs-shell" role="dialog" aria-modal="true" aria-label="${t("小精灵 AI 助手")}">
      <header class="sprite-fs-head">
        <div class="sprite-fs-brand">
          <button type="button" class="icon-btn mobile-only topbar-menu-btn" data-sprite-action="open-sidebar" aria-label="打开会话菜单">${iconSvg("menu", { size: 16 })}</button>
          ${renderSpriteAvatarSvg({ mood: effectiveMood, size: 30 })}
          <div class="sprite-fs-titles">
            <strong>${scopedTopicId ? `${t("小精灵")} · ${escapeHtml(scopedTopicName || scopedTopicId)}` : t("小精灵 AI 助手")}</strong>
            <span>${busy ? escapeHtml(thinkingLabel || "正在思考…") : (scopedTopicId ? "已聚焦当前产线，同时掌握全园状态" : "全能个人助理 · 懂你全部产线、任务与记忆")}</span>
          </div>
          ${scopedTopicId ? `<button type="button" class="sprite-scope-clear" data-sprite-action="clear-scope" title="切回全园视角">全园 ×</button>` : ""}
        </div>
        <div class="sprite-fs-tools">
          ${renderSpriteModelSelectHtml(modelOptions, modelKey, { id: "spriteFsModelSelect", busy })}
          <button type="button" class="sprite-icon-btn ${prefsOpen ? "is-active" : ""}" data-sprite-action="toggle-dispatch-prefs" title="偏好与别名记忆">${iconSvg("settings", { size: 14 })}</button>
          <button type="button" class="sprite-icon-btn ${ttsEnabled ? "is-active" : ""}" data-sprite-action="toggle-tts" title="${ttsEnabled ? "关闭自动朗读" : "开启自动朗读"}">${iconSvg(ttsEnabled ? "speaker" : "speaker-off", { size: 14 })}</button>
          <button type="button" class="mo-ctrl-btn" data-sprite-action="new-chat">${t("新对话")}</button>
          <button type="button" class="sprite-fs-phone-btn ${phoneCallActive ? "is-live" : ""}" data-sprite-action="enter-phone">
            ${iconSvg("radio", { size: 14 })}<span>${phoneCallActive ? t("回到通话") : t("打语音电话")}</span>
          </button>
          <button type="button" class="sprite-icon-btn" data-sprite-action="exit-fullscreen" title="收起小精灵">
            ${iconSvg("minimize", { size: 14 })}
          </button>
        </div>
      </header>

      ${prefsOpen ? `<div class="sprite-fs-drawer-wrap">${renderSpriteDispatchPrefsDrawerHtml({ prefsOpen, agentOptions, excludedAgentKeys, busy })}<div class="sprite-memory"><strong>${t("小精灵记忆")}</strong><button data-sprite-action="load-memory">${t("查看别名")}</button><button data-sprite-action="clear-memory">${t("一键清空")}</button>${spriteState.profile ? `<ul>${Object.entries(spriteState.profile.aliases || {}).map(([alias, id]) => `<li>${escapeHtml(alias)} → ${escapeHtml(id)}</li>`).join("") || t("暂无别名")}</ul>` : ""}</div></div>` : ""}

      <div id="spriteFullscreenFeed" class="sprite-fs-feed">
        <div class="sprite-fs-feed-inner">
          ${messages.length ? messages.slice(-40).map((m) => renderSpriteMessageHtml(m, renderMarkdown)).join("") : `
            <div class="sprite-fs-welcome">
              ${renderSpriteAvatarSvg({ mood: "idle", size: 54 })}
              <h2>${t("你好，我是小精灵")}</h2>
              <p>可以像豆包一样自由聊天、出主意、拆方案；问到项目时我会看全园产线、任务树和记忆，有事也能直接帮你批准、续做或派单。</p>
              <div class="sprite-fs-starters">
                ${starters.map((q) => `<button type="button" class="sprite-fs-starter" data-sprite-say="${escapeHtml(q)}">${escapeHtml(q)}</button>`).join("")}
                <button type="button" class="sprite-fs-starter is-phone" data-sprite-action="enter-phone">${iconSvg("radio", { size: 13 })}<span>${t("打语音电话")}（免提对话）</span></button>
              </div>
            </div>
          `}
          ${busy ? `<div class="sprite-fs-thinking" role="status"><span class="sprite-thinking-dots" aria-hidden="true"><i></i><i></i><i></i></span><span class="sprite-thinking-text">${escapeHtml(thinkingLabel || "小精灵正在思考…")}</span><button type="button" class="sprite-thinking-stop" data-sprite-action="abort-ask">${t("停止")}</button></div>` : ""}
        </div>
      </div>

      ${(spriteState.tour || spriteState.cards?.length || hasPendingCard) ? `
        <div class="sprite-fs-cards">
          ${spriteState.tour ? `<nav class="sprite-tour-controls"><strong>${escapeHtml(spriteState.tour.stops[spriteState.tour.index]?.topicTitle || "")}</strong><button data-sprite-action="tour-next">${t("下一站")}</button><button data-sprite-action="tour-skip">${t("跳过")}</button><button data-sprite-action="tour-end">${t("结束")}</button></nav>` : ""}
          <div class="sprite-work-cards">${(spriteState.cards || []).map((card) => renderSpriteWorkCard(card, { ...spriteState, continueMessage: spriteState.continueDrafts?.[card.id] })).join("")}</div>
          ${renderPendingProposalCardHtml(pendingProposal, busy)}
          ${renderPendingReorgCardHtml(pendingReorg, busy)}
          ${renderPendingArchiveCardHtml(pendingArchive, busy)}
          ${renderPendingPreviewCardHtml(pendingPreview, busy)}
        </div>
      ` : ""}

      ${(recording || transcribing || speaking) ? `
        <div class="sprite-fs-voice-strip">
          <span class="sprite-wave" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>
          <span>${transcribing ? "正在识别语音…" : speaking ? "正在朗读回复…" : speechActive ? "正在收听你说话…" : "正在听…说完自动发送"}</span>
          ${speaking ? `<button type="button" class="sprite-vbar-btn" data-sprite-action="stop-speech">停止朗读</button>` : ""}
          ${recording && !transcribing ? `<button type="button" class="sprite-vbar-btn" data-sprite-action="cancel-mic">取消</button><button type="button" class="sprite-vbar-btn is-done" data-sprite-action="finish-mic">说完了</button>` : ""}
        </div>
      ` : ""}

      <form id="spriteFullscreenForm" class="sprite-fs-composer">
        <div class="sprite-fs-composer-inner">
          <button
            type="button"
            class="sprite-mic-btn ${recording ? "is-recording" : ""} ${speechActive ? "is-speech" : ""} ${transcribing ? "is-transcribing" : ""}"
            data-sprite-action="mic"
            title="${recording ? "点击立即识别发送" : "语音输入"}"
            ${transcribing || busy ? "disabled" : ""}
          >${iconSvg(transcribing ? "clock" : "mic", { size: 16 })}</button>
          <textarea
            id="spriteFullscreenInput"
            class="sprite-fs-textarea"
            rows="1"
            placeholder="${escapeHtml(recording ? "正在收听语音…" : hasPendingCard ? "输入「确认」执行，或继续聊…" : "问我任何事、聊方案，或者让我处理园区任务…")}"
            ${busy ? "disabled" : ""}
          >${escapeHtml(draft)}</textarea>
          <button type="submit" class="btn-primary sprite-fs-send-btn" ${busy || transcribing ? "disabled" : ""} aria-label="发送">
            ${iconSvg("send", { size: 15 })}
          </button>
        </div>
      </form>
    </section>
  `;
}

export function renderSpritePhoneCallHtml(spriteState = {}) {
  const {
    mood = "idle",
    messages = [],
    pendingProposal = null,
    phoneMuted = false,
    phoneAutoExecute = true,
    phoneKeyboardOpen = false,
    phoneElapsedSec = 0,
    phonePhase = "listening",
    speechActive = false,
    speaking = false,
    transcribing = false,
    busy = false,
    thinkingLabel = "",
    voiceLevel = 0,
    micStatus = "idle",
    micError = "",
    modelOptions = [],
    modelKey = "auto",
    lastSpokenReply = "",
  } = spriteState;

  const isThinking = Boolean(busy || transcribing || phonePhase === "thinking");
  const isSpeaking = Boolean(speaking || phonePhase === "speaking");
  const isHearing = Boolean(speechActive && !phoneMuted && !isThinking && !isSpeaking);
  const isMicProblem = !phoneMuted && (micStatus === "error" || micStatus === "stalled" || micStatus === "silent");
  const orbClass = phoneMuted
    ? "is-muted"
    : isSpeaking
      ? "is-speaking"
      : isThinking
        ? "is-thinking"
        : isHearing
          ? "is-hearing"
          : isMicProblem
            ? "is-muted"
            : "is-listening";
  const orbMood = phoneMuted || (isMicProblem && !isSpeaking && !isThinking) ? "idle" : isSpeaking ? (mood === "urgent" || mood === "worry" ? "worry" : "good") : isThinking ? "thinking" : isHearing ? "listening" : "idle";
  const statusTitle = phoneMuted
    ? "麦克风已静音"
    : isSpeaking
      ? "小精灵正在回复"
      : isThinking
        ? (transcribing ? "正在听清你的话…" : (thinkingLabel || "小精灵正在想…"))
        : isHearing
          ? "正在听你说…"
          : micStatus === "starting"
            ? "正在启动麦克风…"
            : micStatus === "error"
              ? "麦克风未就绪"
              : micStatus === "stalled"
                ? "未收到麦克风音频"
                : micStatus === "silent"
                  ? "暂未检测到麦克风声音"
                  : "随时开口说话";
  const statusHint = phoneMuted
    ? "点下方「开麦」或打开键盘打字"
    : isSpeaking
      ? "直接开口即可随时打断我"
      : isThinking
        ? "稍等一秒，马上接话"
        : isHearing
          ? "像平时打电话一样自然对话就行"
          : micStatus === "starting"
            ? "请稍候，首次使用可能需要确认系统麦克风权限"
            : micStatus === "error"
              ? (micError || "点中间光球重试，或在系统设置中开启麦克风权限")
              : micStatus === "stalled"
                ? (micError || "点中间光球重连麦克风，或改用底部键盘打字")
                : micStatus === "silent"
                  ? (micError || "请检查 Mac 麦克风权限或系统默认输入设备")
                  : "像平时打电话一样自然对话就行";

  const recentTurns = messages.filter((m) => !m.trace).slice(-6);

  return `
    <section id="spritePhoneShell" class="sprite-phone-shell ${orbClass}" role="dialog" aria-modal="true" aria-label="${t("小精灵电话")}" style="--voice-level: ${Number(voiceLevel || 0).toFixed(2)}">
      <header class="sprite-phone-head">
        <div class="sprite-phone-id">
          <button type="button" class="icon-btn mobile-only topbar-menu-btn" data-sprite-action="open-sidebar" aria-label="打开会话菜单">${iconSvg("menu", { size: 16 })}</button>
          <span class="sprite-phone-dot ${phoneMuted ? "is-muted" : "is-live"}" aria-hidden="true"></span>
          <strong>${t("小精灵电话")}</strong>
          <span id="spritePhoneTimer" class="sprite-phone-timer">${formatVoiceElapsed(phoneElapsedSec)}</span>
          ${renderSpriteModelSelectHtml(modelOptions, modelKey, { id: "spritePhoneModelSelect" })}
        </div>
        <div class="sprite-phone-head-actions">
          <button
            type="button"
            class="sprite-phone-pill ${phoneAutoExecute ? "is-on" : ""}"
            data-sprite-action="toggle-phone-auto-exec"
            title="${phoneAutoExecute ? "电话中明确指令直接执行（点击改为写前先确认）" : "写操作先问你确认再执行（点击改为免确认直发）"}"
          >${phoneAutoExecute ? t("免确认直发") : t("写前先确认")}</button>
          <button type="button" class="sprite-phone-pill" data-sprite-action="enter-fullscreen">${t("文字记录")}</button>
          <button type="button" class="sprite-phone-pill" data-sprite-action="minimize-phone" title="收起回到园区或对话页，通话保持连接">${t("收起")}</button>
        </div>
      </header>

      <div class="sprite-phone-stage">
        <div class="sprite-phone-orb-wrap">
          <button type="button" id="spritePhoneOrb" class="sprite-phone-orb ${orbClass}" data-sprite-action="phone-orb" aria-label="语音通话控制球">
            <span class="sprite-phone-ring r1" aria-hidden="true"></span>
            <span class="sprite-phone-ring r2" aria-hidden="true"></span>
            <span class="sprite-phone-ring r3" aria-hidden="true"></span>
            <span class="sprite-phone-orb-core">${renderSpriteAvatarSvg({ mood: orbMood, size: 74 })}</span>
          </button>
        </div>

        <div class="sprite-phone-status">
          <h2>${escapeHtml(statusTitle)}</h2>
          <p>${escapeHtml(statusHint)}</p>
        </div>

        <div id="spritePhoneTranscript" class="sprite-phone-transcript">
          ${recentTurns.length ? recentTurns.map((m) => `
            <div class="sprite-phone-line is-${escapeHtml(m.role || "sprite")}">
              <span class="sprite-phone-who">${m.role === "user" ? "你" : "精灵"}</span>
              <div class="sprite-phone-bubble">
                <span>${escapeHtml(m.role === "user" ? m.text : (m.spokenText || m.text || ""))}</span>
                ${m.executedTag ? `<em class="sprite-phone-tag">${escapeHtml(m.executedTag)}</em>` : ""}
              </div>
            </div>
          `).join("") : `
            <div class="sprite-phone-empty">电话已接通。你可以问“今天园子里有什么要盯的”、聊任何技术或产品想法，或者直接让我帮你批准、派工、查任务。</div>
          `}
        </div>

        ${pendingProposal ? `
          <div class="sprite-phone-proposal">
            <div class="sprite-phone-proposal-main">
              <div class="sprite-phone-proposal-text">待确认：${escapeHtml(pendingProposal.summary)}</div>
              ${Array.isArray(pendingProposal.routes) && pendingProposal.routes.length > 1 ? `
                <div class="sprite-phone-proposal-routes">${pendingProposal.routes.map((r, i) => `<span class="sprite-phone-route-pill">${i + 1}. ${escapeHtml(r.topicName || "工作区")} · ${escapeHtml(r.agentLabel || "自动")}</span>`).join("")}</div>
              ` : ""}
            </div>
            <div class="sprite-phone-proposal-btns">
              <button type="button" class="btn-primary btn-sm" data-sprite-action="confirm-proposal" ${busy ? "disabled" : ""}>${t("确认执行")}</button>
              <button type="button" class="btn-secondary btn-sm" data-sprite-action="cancel-proposal" ${busy ? "disabled" : ""}>${t("取消")}</button>
            </div>
          </div>
        ` : ""}

        ${phoneKeyboardOpen ? `
          <form id="spritePhoneTextForm" class="sprite-phone-text-row">
            <input id="spritePhoneTextInput" type="text" class="sprite-phone-text-input" placeholder="打字插话或发指令给小精灵…" ${busy ? "disabled" : ""} />
            <button type="submit" class="btn-primary btn-sm" ${busy ? "disabled" : ""}>发送</button>
          </form>
        ` : ""}
      </div>

      <footer class="sprite-phone-dock">
        <button type="button" class="sprite-phone-dock-btn ${phoneMuted ? "is-active" : ""}" data-sprite-action="toggle-phone-mute">
          <span class="sprite-phone-dock-circle">${iconSvg(phoneMuted ? "speaker-off" : "mic", { size: 20 })}</span>
          <span>${phoneMuted ? t("开麦") : t("静音")}</span>
        </button>
        <button type="button" class="sprite-phone-dock-btn ${phoneKeyboardOpen ? "is-active" : ""}" data-sprite-action="toggle-phone-keyboard">
          <span class="sprite-phone-dock-circle">${iconSvg("keyboard", { size: 20 })}</span>
          <span>${t("键盘")}</span>
        </button>
        <button type="button" class="sprite-phone-dock-btn is-hangup" data-sprite-action="hangup-phone">
          <span class="sprite-phone-dock-circle">${iconSvg("close", { size: 22 })}</span>
          <span>${t("挂断")}</span>
        </button>
        <button type="button" class="sprite-phone-dock-btn" data-sprite-action="phone-replay-or-brief">
          <span class="sprite-phone-dock-circle">${iconSvg("speaker", { size: 20 })}</span>
          <span>${lastSpokenReply ? t("重播") : t("播进展")}</span>
        </button>
      </footer>
    </section>
  `;
}
