import { stat } from "node:fs/promises";
import { MemoryVault, resolveEffectiveVaultPath, resolveVaultPath } from "./memory-vault.mjs";
import { AssistantLLM, cleanForSpeech } from "./assistant-llm.mjs";
import { AssistantStore } from "./assistant-store.mjs";
import { TaskStore, buildTaskTree, cleanTaskCriteria } from "./task-store.mjs";
import { createHash, randomUUID } from "node:crypto";
import { normalizeWorkspacePath } from "./platform.mjs";
import { computeTopicSignals, cardSubject, SIGNAL_TYPES, shortText, timestamp, isoTime, threadTail, threadSource, judgeInputOf, automationFailureCard, isCardHandled, isInternalAssistantThread, plainText } from "./assistant-signals.mjs";

export { computeTopicSignals } from "./assistant-signals.mjs";
const topicsOf = (overview) => (overview.domains || []).flatMap((d) => d.topics || []);
const error = (message, status = 400) => Object.assign(new Error(message), { status });
const subjectOf = (text) => text.replace(/(?:做到哪.*|进度.*|卡在哪.*|怎么样.*|怎么解决.*|还有什么.*|呢[？?]?|[？?])$/g, "").replace(/^(?:请问|问一下|那个|这个)/, "").trim() || text;
// Keep the verdict whole and shorten the line name instead (bubble ≤ 18 chars).
const tourBubble = (name, verdict) => {
  const room = 18 - Array.from(verdict).length - 1;
  const chars = Array.from(String(name || ""));
  return `${chars.length > room ? `${chars.slice(0, room - 1).join("")}…` : chars.join("")}：${verdict}`;
};
const normal = (s) => String(s || "").toLowerCase().replace(/[\p{P}\s]/gu, "");
const JUDGE_WINDOW_MS = 14 * 86_400_000;
const JUDGE_RETRY_MS = 30 * 60_000;
const JUDGE_CONCURRENCY = 2;
const threadsOfTopic = (topic) => [...(topic.activeThreads || []), ...(topic.archivedThreads || [])];
const criteriaKey = (criteria = []) => criteria.length ? `#${createHash("sha256").update(criteria.join("\n")).digest("hex").slice(0, 12)}` : "";
function cleanCriteria(value) {
  return cleanTaskCriteria(value);
}
const underPath = (cwd, root) => Boolean(cwd && root && (cwd === root || cwd.startsWith(`${root.replace(/\/+$/, "")}/`)));
const ASSISTANT_PROVIDERS = new Set(["codex", "claude", "antigravity", "grok", "qoder"]);

export const ACTION_RISK_TIERS = Object.freeze({
  direct: Object.freeze(["focus_topic", "open_thread", "archive_preview", "reorg_preview"]),
  toggle: Object.freeze(["continue_thread", "pin_ticket", "update_ticket", "approve_request:decline"]),
  confirm: Object.freeze(["dispatch", "interrupt_thread", "approve_request:accept"]),
});

export function resolveActionRisk(intent = "", action = {}) {
  const cleanIntent = String(intent || "").trim();
  if (ACTION_RISK_TIERS.direct.includes(cleanIntent)) return "direct";
  if (cleanIntent === "approve_request") {
    return action?.decision === "decline" ? "toggle" : "confirm";
  }
  if (ACTION_RISK_TIERS.confirm.includes(cleanIntent)) return "confirm";
  return "toggle";
}

const CHITCHAT_NO_SEARCH_RE = /^(?:你好|您好|在吗|你在吗|喂|哈喽|早|早上好|中午好|下午好|晚上好|晚安|谢谢|多谢|辛苦了|好的|好|好呀|好啊|行|行的|可以|明白|知道了|收到|嗯|嗯嗯|嗯对|对|对的|是的|是|没问题|没毛病|就这么办|不用了|不用|算了|拜拜|再见|听得到吗|能听见吗|再说一遍|啥|什么|哈哈|ok|okay|hi|hello|hey|thanks|thankyou|yes|no)$/i;

export function shouldSearchParkSources(text = "", { topic = null } = {}) {
  if (topic) return true;
  const keyword = subjectOf(String(text || "").trim());
  const normalized = keyword.replace(/[\p{P}\s]/gu, "");
  if (Array.from(normalized).length < 2) return false;
  if (CHITCHAT_NO_SEARCH_RE.test(normalized)) return false;
  return true;
}

function normalizeAssistantProvider(value) {
  const lower = String(value || "").trim().toLowerCase();
  if (!lower || lower === "auto") return "";
  if (lower === "agy") return "antigravity";
  return ASSISTANT_PROVIDERS.has(lower) ? lower : "";
}

function resolveAssistantDispatchAgent(rawAgentKey, availableProfiles = []) {
  const raw = String(rawAgentKey || "").trim();
  const lower = raw.toLowerCase();
  if (!raw || lower === "auto") return { agentKey: "", preferredProvider: "" };

  const profiles = Array.isArray(availableProfiles) ? availableProfiles : [];
  const keyOf = (p) => `${p.provider}:${p.id || "default"}`;

  const exact = profiles.find((p) => keyOf(p) === raw)
    || profiles.find((p) => keyOf(p).toLowerCase() === lower);
  if (exact) return { agentKey: keyOf(exact), preferredProvider: "" };

  const provider = normalizeAssistantProvider(raw);
  if (provider) {
    if (!profiles.length || profiles.some((p) => p.provider === provider)) {
      return { agentKey: "", preferredProvider: provider };
    }
    return { agentKey: provider, preferredProvider: "" };
  }

  if (profiles.length) {
    const aliasMatches = profiles.filter((p) => {
      const candidates = [p?.health?.alias, p?.alias, p?.label, p?.account?.email]
        .map((v) => String(v || "").trim().toLowerCase())
        .filter(Boolean);
      return candidates.includes(lower);
    });
    if (aliasMatches.length === 1) {
      return { agentKey: keyOf(aliasMatches[0]), preferredProvider: "" };
    }
  }

  if (raw.includes(":")) {
    const prefixProv = normalizeAssistantProvider(raw.split(":")[0]);
    if (prefixProv && profiles.some((p) => p.provider === prefixProv)) {
      return { agentKey: "", preferredProvider: prefixProv };
    }
    return { agentKey: raw, preferredProvider: "" };
  }

  return { agentKey: "", preferredProvider: "" };
}

// What the park shows for a 任务: where its latest session stands.
function ticketView(ticket, threads, now) {
  const linked = threads.filter((t) => ticket.threadIds.includes(t.id)).sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
  const latest = linked[0], tail = latest ? latest.assistantTail || threadTail(latest) : null;
  let state = "idle", line = "等工位交付后验收";
  if (!ticket.threadIds?.length) { state = "idle"; line = "尚未关联会话"; }
  else if (!latest) { state = "lost"; line = "暂时找不到关联工位"; }
  else if (latest.pendingCount > 0) { state = "waiting"; line = "工位等你拍板"; }
  else if (latest.live) { state = "running"; line = "工位正在做"; }
  else if (latest.lastError || latest.lastTurnStatus === "failed") { state = "failed"; line = "上一轮出错了"; }
  else if (tail?.judgedBy === "model" && tail.evidence) { state = "passed"; line = `验收通过：${tail.evidence}`; }
  else if (tail?.missing) { state = "missing"; line = `还差：${tail.missing}`; }
  else if (tail?.asking) { state = "asking"; line = `等你回复：${tail.question || "工位在问你"}`; }
  const at = Math.max(timestamp(ticket.updatedAt), ...linked.map((t) => timestamp(t.updatedAt)));
  if (["idle", "missing"].includes(state) && at && now - at >= 3 * 86_400_000) line = `停了 ${Math.floor((now - at) / 86_400_000)} 天 · ${line}`;
  return {
    id: ticket.id,
    parentId: ticket.parentId || "",
    title: ticket.title,
    goal: ticket.goal,
    criteria: ticket.criteria,
    status: ticket.status,
    state,
    line: shortText(line, 60),
    cwd: ticket.cwd || "",
    planRef: ticket.planRef || null,
    threadIds: ticket.threadIds,
    ...(latest ? { threadId: latest.id } : {}),
    createdAt: ticket.createdAt,
    updatedAt: isoTime(at) || ticket.updatedAt,
  };
}

function annotateSubtreeViews(views = []) {
  const roots = buildTaskTree(views);
  const byId = new Map();
  const walk = (nodes) => {
    for (const n of nodes) {
      byId.set(n.id, {
        depth: n.depth,
        childCount: n.childCount || 0,
        childOpenCount: n.childOpenCount || 0,
        childDoneCount: n.childDoneCount || 0,
        hasLiveChild: Boolean(n.hasLiveChild),
        pathTitles: n.pathTitles || [n.title],
      });
      if (n.children?.length) walk(n.children);
    }
  };
  walk(roots);
  const enriched = views.map((v) => ({ ...v, ...(byId.get(v.id) || { depth: 0, childCount: 0, childOpenCount: 0, childDoneCount: 0, hasLiveChild: false, pathTitles: [v.title] }) }));
  return { enriched, tree: buildTaskTree(enriched) };
}

export class AssistantService {
  #tails = new Map();
  #reading = new Set();
  #judgments = null;
  #judgeQueue = [];
  #judgeFailures = new Map();
  #judging = 0;
  #judgedTimer = null;
  #wipCache = new Map();
  #judgeInFlight = new Set();
  #proposals = new Map();
  #dispatchedThreads = new Set();
  #proposalTtlMs = 60_000;
  // `automations` ({ list, run }) is attached by the host once the scheduler exists.
  constructor({ hub, getOverview, dataDir, env = process.env, now = () => Date.now(), vault = null, taskStore = null, llm = null, llmOptions = {}, evidenceBudgetMs = 1500, proposalTtlMs = 60_000, onJudged = null, automations = null, dispatchImpl = null } = {}) {
    this.hub = hub;
    this.getOverview = getOverview;
    this.dataDir = dataDir;
    this.env = env;
    this.now = now;
    this.vault = vault;
    this.taskStore = taskStore || hub?.taskStore || (dataDir ? new TaskStore({ dataDir, now }) : null);
    this.evidenceBudgetMs = evidenceBudgetMs;
    this.#proposalTtlMs = Math.max(5_000, Number(proposalTtlMs) || 60_000);
    this.onJudged = onJudged;
    this.automations = automations;
    this.dispatchImpl = typeof dispatchImpl === "function" ? dispatchImpl : null;
    this.store = new AssistantStore(dataDir);
    this.llm = llm || new AssistantLLM({ dataDir, now, store: this.store, ...llmOptions });
  }

  #pruneProposals() {
    const t = this.now();
    for (const [id, entry] of this.#proposals.entries()) {
      if (!entry || entry.expiresAt <= t) this.#proposals.delete(id);
    }
    while (this.#proposals.size > 200) {
      const oldest = this.#proposals.keys().next().value;
      if (!oldest) break;
      this.#proposals.delete(oldest);
    }
  }

  #registerProposal(proposal, { callKey = "" } = {}) {
    if (!proposal || !proposal.intent) return null;
    this.#pruneProposals();
    const cleanKey = String(callKey || "").trim();
    if (cleanKey) {
      for (const [oldId, oldEntry] of this.#proposals.entries()) {
        if (oldEntry.callKey === cleanKey) this.#proposals.delete(oldId);
      }
    }
    const id = String(proposal.id || `act_${randomUUID().slice(0, 8)}`).trim();
    const risk = proposal.risk || resolveActionRisk(proposal.intent, proposal.payload);
    const routesSummary = Array.isArray(proposal.routesSummary) && proposal.routesSummary.length ? proposal.routesSummary : null;
    const nowMs = this.now();
    this.#proposals.set(id, {
      id,
      callKey: cleanKey,
      intent: proposal.intent,
      risk,
      summary: proposal.summary || "",
      payload: proposal.payload || {},
      routesSummary,
      createdAt: nowMs,
      expiresAt: nowMs + this.#proposalTtlMs,
    });
    return {
      id,
      intent: proposal.intent,
      risk,
      summary: proposal.summary || "",
      ...(routesSummary ? { routes: routesSummary } : {}),
    };
  }

  getPendingProposal(proposalId = "", { callKey = "" } = {}) {
    this.#pruneProposals();
    const id = String(proposalId || "").trim();
    if (!id) return null;
    const entry = this.#proposals.get(id);
    if (!entry) return null;
    const cleanKey = String(callKey || "").trim();
    if (cleanKey && entry.callKey && entry.callKey !== cleanKey) return null;
    return {
      id: entry.id,
      intent: entry.intent,
      risk: entry.risk,
      summary: entry.summary,
      ...(entry.routesSummary ? { routes: entry.routesSummary } : {}),
      expiresAt: entry.expiresAt,
    };
  }

  cancelProposal(proposalId = "") {
    this.#pruneProposals();
    const id = String(proposalId || "").trim();
    const cleared = id ? this.#proposals.delete(id) : false;
    return { ok: true, cleared };
  }

  #rememberDispatchedThread(threadId = "") {
    const id = String(threadId || "").trim();
    if (!id) return;
    this.#dispatchedThreads.delete(id);
    this.#dispatchedThreads.add(id);
    while (this.#dispatchedThreads.size > 500) {
      const oldest = this.#dispatchedThreads.values().next().value;
      if (!oldest) break;
      this.#dispatchedThreads.delete(oldest);
    }
  }

  async #draftDispatchCriteriaAsync(tasks = []) {
    if (!this.taskStore || typeof this.llm?.draftTicket !== "function") return;
    for (const tk of tasks) {
      try {
        const draft = await this.llm.draftTicket({
          title: tk.title,
          ask: tk.goal || tk.title,
          reply: "",
          background: true,
        });
        if (Array.isArray(draft?.criteria) && draft.criteria.length) {
          await this.taskStore.update(tk.id, { criteria: draft.criteria, actor: "assistant" });
          this.#notifyJudged();
        }
      } catch { /* best-effort background criteria drafting */ }
    }
  }

  async #enrichDispatchProposal(proposal) {
    if (!proposal || proposal.intent !== "dispatch" || typeof this.dispatchImpl !== "function") {
      return null;
    }
    const payload = proposal.payload || {};
    const preview = await this.dispatchImpl({
      text: payload.instruction || "",
      topicId: payload.topicId || "",
      mode: payload.mode || "auto",
      preferredProvider: payload.preferredProvider || "auto",
      agentKey: payload.agentKey || "auto",
      confirmOnly: true,
      useAiPlanner: true,
    }).catch(() => null);
    const routes = Array.isArray(preview?.routes) ? preview.routes : [];
    if (!routes.length) return null;
    payload.approvedRoutes = routes;
    const routesSummary = routes.map((r) => ({
      topicId: r.topicId || "",
      topicName: r.topicName || "",
      agentLabel: r.agentLabel || r.provider || "自动匹配",
      segmentText: shortText(r.segmentText || "", 60),
      action: r.action || "spawn_parallel",
    }));
    const shortAgent = (r) => shortText(String(r.agentLabel || r.provider || "自动").replace(/\s*[（(].*?[）)]/g, "").trim(), 16) || "自动";
    const confirmText = routesSummary.length === 1
      ? `准备派给「${routesSummary[0].topicName || "工作区"}」的${shortAgent(routesSummary[0])}处理：${shortText(routesSummary[0].segmentText || payload.instruction, 24)}，确认发吗？`
      : `准备拆 ${routesSummary.length} 路：${routesSummary.map((r, i) => `${i + 1}给「${r.topicName || "工作区"}」的${shortAgent(r)}`).join("，")}，确认发吗？`;
    proposal.summary = confirmText;
    proposal.routesSummary = routesSummary;
    return { proposal, confirmText };
  }

  async handleHubEvent(eventName, payload = {}) {
    if (!this.dataDir) return null;
    if (eventName !== "provider_event" && eventName !== "turn_completed") return null;
    const evt = payload || {};
    const isCodexCompleted = evt.method === "turn/completed";
    const isUnifiedCompleted = evt.type === "turn_completed" || eventName === "turn_completed";
    if (!isCodexCompleted && !isUnifiedCompleted) return null;

    const threadId = String(evt.threadId || "").trim();
    if (!threadId) return null;
    const rawStatus = isCodexCompleted
      ? (evt.params?.turn?.status || "completed")
      : (evt.status || "completed");
    if (rawStatus === "interrupted") return null;

    const meta = this.hub?.listThreadsMeta?.() || {};
    if (meta[threadId]?.internal || isInternalAssistantThread({ id: threadId, title: evt.title, cwd: evt.cwd, internal: evt.internal })) {
      return null;
    }

    const openTickets = await this.openTickets().catch(() => []);
    const matchedTicket = openTickets.find((tk) => Array.isArray(tk.threadIds) && tk.threadIds.includes(threadId)) || null;
    const wasDispatched = this.#dispatchedThreads.has(threadId);
    if (!wasDispatched && !matchedTicket) return null;

    let topicId = matchedTicket?.topicId || "";
    let topicName = "";
    let threadTitle = matchedTicket?.title || meta[threadId]?.customName || String(evt.title || "").trim();
    if (typeof this.getOverview === "function") {
      const overview = await this.getOverview().catch(() => null);
      for (const tp of topicsOf(overview || {})) {
        const th = threadsOfTopic(tp).find((t) => t.id === threadId);
        if (th || (topicId && tp.id === topicId)) {
          if (!topicId) topicId = tp.id;
          topicName = tp.name || "";
          if (th?.title && !matchedTicket?.title) threadTitle = th.title;
          break;
        }
      }
    }

    const label = shortText(threadTitle || topicName || "后台任务", 24);
    const failed = rawStatus === "failed";
    const turnId = String(isCodexCompleted ? (evt.params?.turn?.id || "") : (evt.turnId || evt.turn?.id || "")).trim();
    const dedupeKey = `${matchedTicket?.id || threadId}:${turnId || rawStatus}`;
    const text = failed
      ? `「${label}」执行出错了，可以打开看看`
      : `「${label}」已经跑完了，可以验收`;
    const entry = {
      id: `ntc_${randomUUID().slice(0, 8)}`,
      dedupeKey,
      kind: failed ? "failed" : "completed",
      taskId: matchedTicket?.id || "",
      threadId,
      topicId,
      topicName,
      title: label,
      text,
      createdAt: new Date(this.now()).toISOString(),
      deliveredVoiceAt: "",
      seenAt: "",
    };

    let inserted = false;
    await this.store.update("notices", (rawList) => {
      const list = Array.isArray(rawList) ? rawList : [];
      if (list.some((item) => item?.dedupeKey === dedupeKey)) return list;
      inserted = true;
      return [...list, entry].slice(-50);
    }, []);
    return inserted ? entry : null;
  }

  async popPendingVoiceNotices({ limit = 1 } = {}) {
    if (!this.dataDir) return { notices: [], remainingCount: 0 };
    const cap = Math.max(0, Math.min(10, Number(limit) || 1));
    if (!cap) return { notices: [], remainingCount: 0 };
    const popped = [];
    let remainingCount = 0;
    const nowIso = new Date(this.now()).toISOString();
    await this.store.update("notices", (rawList) => {
      const list = Array.isArray(rawList) ? rawList : [];
      const updated = list.map((item) => {
        if (item && !item.deliveredVoiceAt && popped.length < cap) {
          const nextItem = { ...item, deliveredVoiceAt: nowIso };
          popped.push(nextItem);
          return nextItem;
        }
        return item;
      });
      remainingCount = updated.filter((item) => item && !item.deliveredVoiceAt).length;
      return updated;
    }, []);
    return { notices: popped, remainingCount };
  }

  async listUnreadNotices({ limit = 10 } = {}) {
    if (!this.dataDir) return { notices: [], unreadCount: 0 };
    const cap = Math.max(1, Math.min(50, Number(limit) || 10));
    const rawList = await this.store.read("notices", []);
    const list = Array.isArray(rawList) ? rawList : [];
    const unread = list.filter((n) => n && !n.seenAt);
    return { notices: unread.slice(-cap).reverse(), unreadCount: unread.length };
  }

  async ackNotices(ids = []) {
    if (!this.dataDir) return { ok: true, updatedCount: 0 };
    const idSet = new Set((Array.isArray(ids) ? ids : []).map((x) => String(x || "").trim()).filter(Boolean));
    const nowIso = new Date(this.now()).toISOString();
    let updatedCount = 0;
    await this.store.update("notices", (rawList) => {
      const list = Array.isArray(rawList) ? rawList : [];
      return list.map((item) => {
        if (!item || item.seenAt) return item;
        if (!idSet.size || idSet.has(item.id)) {
          updatedCount += 1;
          return { ...item, seenAt: nowIso };
        }
        return item;
      });
    }, []);
    return { ok: true, updatedCount };
  }

  async memoryVault() {
    if (this.vault) return this.vault;
    const enabled = this.hub?.getSettings?.().sharedMemoryEnabled !== false;
    const explicit = await resolveVaultPath({ dataDir: this.dataDir, env: this.env });
    if (explicit) return new MemoryVault(explicit, { now: () => new Date(this.now()) });
    if (!enabled) return null;
    const fallback = await resolveEffectiveVaultPath({ dataDir: this.dataDir, env: this.env, enabled });
    if (!fallback) return null;
    const st = await stat(fallback).catch(() => null);
    return st?.isDirectory() ? new MemoryVault(fallback, { now: () => new Date(this.now()) }) : null;
  }

  // Reads each idle thread's last message once (cached by fingerprint). A cold
  // start can mean hundreds of transcript reads, so the overview waits at most
  // `evidenceBudgetMs`; unfinished reads keep going in the background and show
  // up on the next overview refresh.
  async readThreadEvidence(threads = []) {
    const meta = this.hub?.listThreadsMeta?.() || {};
    const visible = threads.filter((t) => !t.internal && !meta[t.id]?.internal);
    const canRead = typeof this.hub?.readThread === "function";
    const fingerprintOf = (t) => `${t.updatedAt}:${t.lastTurnStatus || ""}:${t.lastError || ""}`;
    const needsRead = (t) => canRead && !(t.live || t.pendingCount > 0 || t.turns);
    const pending = visible.filter((t) => needsRead(t) && this.#tails.get(t.id)?.fingerprint !== fingerprintOf(t) && !this.#reading.has(t.id));
    if (pending.length) {
      for (const t of pending) this.#reading.add(t.id);
      let next = 0;
      const pool = Promise.all(Array.from({ length: Math.min(6, pending.length) }, async () => {
        while (next < pending.length) {
          const t = pending[next++];
          try {
            const result = await this.hub.readThread(t.id, { limit: 1, detail: "auto" });
            this.#tails.set(t.id, { fingerprint: fingerprintOf(t), tail: threadTail(result?.thread || {}), judgeInput: judgeInputOf(result?.thread || {}), lastError: result?.thread?.lastError || "" });
          } catch { /* unreadable transcript: no evidence */ } finally { this.#reading.delete(t.id); }
        }
      }));
      const budget = Number(this.evidenceBudgetMs);
      if (Number.isFinite(budget) && budget >= 0) {
        let timer;
        await Promise.race([pool, new Promise((resolve) => { timer = setTimeout(resolve, budget); timer.unref?.(); })]);
        clearTimeout(timer);
      } else await pool;
    }
    const ids = new Set(visible.map((t) => t.id));
    for (const id of this.#tails.keys()) if (!ids.has(id)) this.#tails.delete(id);
    const judgments = await this.#loadJudgments();
    const criteriaOf = new Map();
    for (const ticket of await this.openTickets()) for (const id of ticket.threadIds) if (ticket.criteria.length) criteriaOf.set(id, ticket.criteria);
    const toJudge = [];
    const out = visible.map((t) => {
      if (!needsRead(t)) { this.#tails.delete(t.id); return t; }
      const cached = this.#tails.get(t.id);
      if (cached?.fingerprint !== fingerprintOf(t)) return t;
      // A verdict is about this turn against these criteria: editing a 工单's
      // acceptance criteria re-judges its sessions.
      const criteria = criteriaOf.get(t.id) || [];
      const key = `${cached.fingerprint}${criteriaKey(criteria)}`;
      const judged = judgments[t.id]?.fingerprint === key ? judgments[t.id] : null;
      if (!judged && this.#judgeable(t, cached, key)) toJudge.push({ id: t.id, updatedAt: t.updatedAt, base: cached.fingerprint, key, criteria });
      // The model's verdict replaces the wording heuristic; until it arrives
      // (or when no model answers) the heuristic stays as the fallback — except
      // for criteria, which only a model can check.
      const tail = judged ? { ...cached.tail, evidence: judged.verified ? judged.evidence : null, judgedBy: "model", missing: judged.missing || "" }
        : criteria.length && cached.tail ? { ...cached.tail, evidence: null } : cached.tail;
      return { ...t, assistantTail: tail, lastError: t.lastError || cached.lastError };
    });
    if (toJudge.length) void this.#enqueueJudgments(toJudge);
    return out;
  }

  async #loadJudgments() {
    if (!this.#judgments) this.#judgments = await this.store.read("harvest-judgments", {}).catch(() => ({}));
    return this.#judgments;
  }

  #judgeable(t, cached, key) {
    const tail = cached.tail;
    if (!cached.judgeInput || !tail || tail.role !== "assistant" || tail.status !== "completed" || tail.error || tail.asking) return false;
    if (t.live || t.pendingCount > 0 || t.queuedCount > 0 || t.lastError || cached.lastError || t.lastTurnStatus === "failed") return false;
    if (this.now() - timestamp(t.updatedAt) > JUDGE_WINDOW_MS) return false;
    const failed = this.#judgeFailures.get(t.id);
    return !(failed && failed.fingerprint === key && this.now() - failed.at < JUDGE_RETRY_MS);
  }

  async #enqueueJudgments(jobs) {
    if (!await this.llm.available?.()) return;
    // In-flight jobs have left the queue but must not be judged twice.
    const queued = new Set([...this.#judgeQueue.map((job) => `${job.id}:${job.key}`), ...this.#judgeInFlight]);
    const fresh = jobs.filter((job) => !queued.has(`${job.id}:${job.key}`)).sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
    // Newest work first: it is what the park is showing right now.
    this.#judgeQueue.unshift(...fresh);
    while (this.#judging < JUDGE_CONCURRENCY && this.#judgeQueue.length) void this.#judgeNext();
  }

  async #judgeNext() {
    const job = this.#judgeQueue.shift();
    if (!job) return;
    this.#judging++;
    this.#judgeInFlight.add(`${job.id}:${job.key}`);
    try {
      const cached = this.#tails.get(job.id);
      if (cached?.fingerprint !== job.base || !cached.judgeInput) return;
      const verdict = await this.llm.judgeHarvest({ ...cached.judgeInput, criteria: job.criteria });
      if (!verdict) { this.#judgeFailures.set(job.id, { fingerprint: job.key, at: this.now() }); return; }
      this.#judgeFailures.delete(job.id);
      const record = { fingerprint: job.key, ...verdict, at: new Date(this.now()).toISOString() };
      this.#judgments[job.id] = record;
      await this.store.update("harvest-judgments", (all) => {
        const next = { ...all, [job.id]: record };
        const ids = Object.keys(next);
        // Keep the newest verdicts only; old ones are re-judged if they move.
        if (ids.length > 600) ids.sort((a, b) => timestamp(next[a].at) - timestamp(next[b].at)).slice(0, ids.length - 600).forEach((id) => delete next[id]);
        return next;
      }).catch(() => {});
      this.#notifyJudged();
    } finally {
      this.#judgeInFlight.delete(`${job.id}:${job.key}`);
      this.#judging--;
      if (this.#judgeQueue.length) void this.#judgeNext();
    }
  }

  #notifyJudged() {
    if (typeof this.onJudged !== "function" || this.#judgedTimer) return;
    this.#judgedTimer = setTimeout(() => { this.#judgedTimer = null; try { this.onJudged(); } catch { /* listener errors stay local */ } }, 3000);
    this.#judgedTimer.unref?.();
  }

  async idleWip(topics) {
    const vault = await this.memoryVault();
    if (!vault) return [];
    const notePaths = (await vault.listNotes()).filter((rel) => /(?:^|\/)任务-/.test(rel));
    const seen = new Set(notePaths);
    for (const k of this.#wipCache.keys()) {
      if (!seen.has(k)) this.#wipCache.delete(k);
    }
    const wips = [];
    for (const rel of notePaths) {
      const st = await stat(vault.abs(rel)).catch(() => null);
      if (!st?.isFile()) continue;
      const cached = this.#wipCache.get(rel);
      let parsed = null;
      if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
        parsed = cached.entry;
      } else {
        const note = await vault.tryRead(rel);
        if (note && note.meta.kind === "wip") {
          const lines = String(note.body || "").split("\n");
          const sec = (heading) => {
            const idx = lines.findIndex((l) => /^##\s+/.test(l) && l.replace(/^##\s+/, "").trim() === heading);
            if (idx < 0) return "";
            const outLines = [];
            for (let i = idx + 1; i < lines.length; i += 1) {
              if (/^#{1,2}\s+/.test(lines[i])) break;
              outLines.push(lines[i]);
            }
            return outLines.join("\n").trim();
          };
          parsed = {
            rel,
            title: note.meta.title || rel,
            status: note.meta.status || "active",
            updated: note.meta.updated || "",
            scope: note.meta.scope || "",
            state: sec("当前状态"),
            next: sec("下一步"),
          };
        }
        this.#wipCache.set(rel, { mtimeMs: st.mtimeMs, size: st.size, entry: parsed });
      }
      if (!parsed || parsed.status !== "active") continue;
      if (!timestamp(parsed.updated) || this.now() - timestamp(parsed.updated) < 7 * 86_400_000) continue;
      const topic = topics.find((t) => parsed.scope && [t.id, t.memoryScope].includes(parsed.scope));
      if (topic) wips.push({ ...parsed, topicId: topic.id });
    }
    return wips;
  }

  // ---- 任务: sessions & subtasks pinned as persistent work items ----
  async #allTickets() {
    if (!this.taskStore) return {};
    const list = await this.taskStore.list({ status: "all" });
    return Object.fromEntries(list.map((t) => [t.id, t]));
  }

  async openTickets() {
    if (!this.taskStore) return [];
    return this.taskStore.list({ status: "open" });
  }

  async listTickets({ status = "open" } = {}) {
    const all = this.taskStore ? await this.taskStore.list({ status }) : [];
    const overview = await this.getOverview();
    const views = new Map((overview.assistantTickets || []).map((v) => [v.id, v]));
    const mapped = all.sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt)).map((t) => views.get(t.id) || t);
    const { enriched, tree } = annotateSubtreeViews(mapped);
    return { tickets: enriched, tasks: enriched, tree };
  }

  async createTicket({ threadId, title, goal, criteria, parentId = "" } = {}) {
    if (typeof threadId !== "string" || !threadId) throw error("需要要钉成任务的工位");
    if (!parentId) {
      const existing = (await this.openTickets()).find((t) => t.threadIds.includes(threadId));
      if (existing) return { ok: true, existed: true, ticket: existing };
    }
    const overview = await this.getOverview();
    const topics = topicsOf(overview);
    const topic = topics.find((t) => threadsOfTopic(t).some((th) => th.id === threadId));
    const thread = (topic ? threadsOfTopic(topic) : overview.unassignedActive || []).find((th) => th.id === threadId) || {};
    let input = this.#tails.get(threadId)?.judgeInput;
    if (!input && typeof this.hub?.readThread === "function") {
      input = judgeInputOf((await this.hub.readThread(threadId, { limit: 1, detail: "auto" }).catch(() => null))?.thread || {});
    }
    input ||= { title: shortText(thread.title, 80), ask: shortText(thread.preview, 600), reply: "" };
    // The model drafts what the user did not write; the user can edit it later.
    const draft = goal === undefined || criteria === undefined ? await this.llm.draftTicket?.(input) : null;
    const ticket = await this.taskStore.create({
      title: shortText(title || draft?.title || thread.title || input.title || "未命名任务", 60),
      goal: shortText(goal ?? draft?.goal ?? input.ask ?? "", 200),
      criteria: criteria !== undefined ? cleanCriteria(criteria) : draft?.criteria || [],
      topicId: topic?.id || "",
      cwd: thread.cwd || topic?.primaryCwd || "",
      parentId,
      threadIds: [threadId],
      draftedBy: draft ? "model" : "",
      actor: "user",
    });
    await this.hub?.setThreadTask?.(threadId, ticket.id).catch(() => {});
    this.#notifyJudged();
    return { ok: true, ticket };
  }

  async updateTicket(id, { title, goal, criteria, status, parentId, addThreadId, removeThreadId, planRef } = {}) {
    if (!this.taskStore) throw error("任务存储未就绪", 500);
    const next = await this.taskStore.update(id, {
      ...(title !== undefined ? { title } : {}),
      ...(goal !== undefined ? { goal } : {}),
      ...(criteria !== undefined ? { criteria } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
      ...(addThreadId !== undefined ? { addThreadId } : {}),
      ...(removeThreadId !== undefined ? { removeThreadId } : {}),
      ...(planRef !== undefined ? { planRef } : {}),
      actor: "user",
    });
    if (addThreadId) await this.hub?.setThreadTask?.(addThreadId, next.id).catch(() => {});
    if (removeThreadId) await this.hub?.setThreadTask?.(removeThreadId, "").catch(() => {});
    return { ok: true, ticket: next };
  }

  #automationCache = null;
  async #automationTasks() {
    if (typeof this.automations?.list !== "function") return [];
    // Listing scans every instance's task files; the overview refreshes often.
    if (this.#automationCache && this.now() - this.#automationCache.at < 30_000) return this.#automationCache.tasks;
    let tasks = [];
    try { tasks = await this.automations.list(); } catch { /* scheduler unavailable: no automation cards */ }
    this.#automationCache = { at: this.now(), tasks: Array.isArray(tasks) ? tasks : [] };
    return this.#automationCache.tasks;
  }

  async decorateOverview(overview) {
    const topics = topicsOf(overview), now = this.now();
    const [cardState, idleWip, tickets, tasks] = await Promise.all([this.store.read("card-state"), this.idleWip(topics), this.openTickets(), this.#automationTasks()]);
    const automationByThread = new Map(tasks.filter((t) => t.lastThreadId).map((t) => [t.lastThreadId, t.name || t.taskKey]));
    const failedTasks = tasks.filter((t) => t.lastStatus === "error" && t.status !== "PAUSED" && t.taskKey);
    const ticketTopic = new Map(), failureTopic = new Map();
    for (const ticket of tickets) {
      const topic = topics.find((t) => threadsOfTopic(t).some((th) => ticket.threadIds.includes(th.id))) || topics.find((t) => t.id === ticket.topicId);
      ticketTopic.set(ticket.id, topic?.id || "");
    }
    for (const task of failedTasks) {
      const cwds = (task.cwds || []).map((c) => normalizeWorkspacePath(c));
      const topic = topics.find((t) => { const root = normalizeWorkspacePath(t.primaryCwd || ""); return root && cwds.some((c) => underPath(c, root)); });
      failureTopic.set(task.taskKey, topic?.id || "");
    }
    const badges = { alert: 0, harvest: 0, ruin: 0 };
    const signalsFor = (topic) => computeTopicSignals(topic, { now, cardState, idleWip, automationByThread,
      tickets: tickets.filter((tk) => ticketTopic.get(tk.id) === topic.id),
      extraCards: failedTasks.filter((task) => failureTopic.get(task.taskKey) === topic.id).map((task) => automationFailureCard(task, topic.id)) });
    for (const topic of topics) {
      topic.assistantSignals = signalsFor(topic);
      for (const type of SIGNAL_TYPES) badges[type] += topic.assistantSignals.counts[type];
      topic.assistantTickets = tickets.filter((tk) => ticketTopic.get(tk.id) === topic.id).map((tk) => ticketView(tk, threadsOfTopic(topic), now));
    }
    // Scheduled runs started in the home directory and sessions outside every
    // topic still need a place to surface: the park's inbox.
    const inboxTopic = { id: "", name: "定时任务与零散工单", activeThreads: (overview.unassignedActive || []).filter((t) => automationByThread.has(t.id)
      || tickets.some((tk) => !ticketTopic.get(tk.id) && tk.threadIds.includes(t.id))) };
    overview.assistantInbox = signalsFor(inboxTopic);
    for (const type of SIGNAL_TYPES) badges[type] += overview.assistantInbox.counts[type];
    const rawTickets = [...topics.flatMap((t) => (t.assistantTickets || []).map((v) => ({ ...v, topicId: t.id, topicName: t.name }))),
      ...tickets.filter((tk) => !ticketTopic.get(tk.id)).map((tk) => ({ ...ticketView(tk, overview.unassignedActive || [], now), topicId: tk.topicId || "", topicName: "" }))];
    const { enriched: annotatedTickets, tree: taskTree } = annotateSubtreeViews(rawTickets);
    const annotatedById = new Map(annotatedTickets.map((tk) => [tk.id, tk]));
    for (const topic of topics) {
      topic.assistantTickets = (topic.assistantTickets || []).map((v) => annotatedById.get(v.id) || v);
    }
    overview.assistantTickets = annotatedTickets;
    overview.tasks = annotatedTickets;
    overview.assistantTaskTree = taskTree;
    overview.assistantBadges = badges;
    // The compact top-level topic catalogue is consumed separately from domains.
    for (const topic of overview.topics || []) {
      const full = topics.find((t) => t.id === topic.id);
      if (full) Object.assign(topic, { assistantSignals: full.assistantSignals, harvestEvidence: full.harvestEvidence,
        harvestInferred: full.harvestInferred, readyToHarvest: full.readyToHarvest });
    }
    return overview;
  }

  async profile() { return this.store.read("profile", { aliases: {}, updatedAt: null }); }
  async clearProfile() { return this.store.update("profile", () => ({ aliases: {}, updatedAt: new Date(this.now()).toISOString() })); }
  async addAlias({ alias, topicId } = {}) {
    alias = String(alias || "").trim();
    if (!alias || alias.length > 80 || typeof topicId !== "string") throw error("需要有效的别名和产线");
    const overview = await this.getOverview();
    if (!topicsOf(overview).some((t) => t.id === topicId)) throw error("产线不存在", 404);
    const profile = await this.store.update("profile", (p) => ({ aliases: { ...p.aliases, [alias]: topicId }, updatedAt: new Date(this.now()).toISOString() }), { aliases: {} });
    return { ok: true, aliases: profile.aliases };
  }

  resolve(text, topics, profile, { contextTopicId, focus = [], history = [] } = {}) {
    const byId = new Map(topics.map((t) => [t.id, t]));
    const query = normal(text), subject = normal(subjectOf(text));
    const aliases = Object.entries(profile.aliases || {}).sort((a, b) => b[0].length - a[0].length);
    for (const [alias, id] of aliases) if (normal(alias) && query.includes(normal(alias)) && byId.has(id)) return { topic: byId.get(id) };
    const matches = (value) => topics.map((topic) => {
      const names = [topic.name, topic.title, topic.id, ...(Array.isArray(topic.aliases) ? topic.aliases : []), ...(topic.keywords || [])].filter(Boolean).map(normal);
      const score = Math.max(0, ...names.map((name) => value.includes(name) ? 100 + name.length : subject.length >= 2 && name.includes(subject) ? subject.length : 0));
      return { topic, score };
    }).filter((hit) => hit.score > 0).sort((a, b) => b.score - a.score);
    const matched = matches(query);
    if (matched.length === 1) return { topic: matched[0].topic };
    // A short alias may also match a longer configured name. Prefer the
    // complete name only when all shorter matches are contained in that name.
    if (matched[0]?.score >= 100 && matched.slice(1).every((h) => h.score < 100 || normal(matched[0].topic.name).includes(normal(h.topic.name)))) return { topic: matched[0].topic };
    const historyTopics = [];
    for (const turn of history.slice(-6)) {
      for (const topic of topics.filter((t) => normal(turn.text).includes(normal(t.name)))) {
        if (!historyTopics.includes(topic.id)) historyTopics.push(topic.id);
      }
    }
    const ordinal = text.match(/第([一二三四五六123456])个/);
    if (ordinal) {
      const index = "一二三四五六".indexOf(ordinal[1]) >= 0 ? "一二三四五六".indexOf(ordinal[1]) : Number(ordinal[1]) - 1;
      const id = (historyTopics.length ? historyTopics : focus)[index];
      if (byId.has(id)) return { topic: byId.get(id) };
    } else if (!matched.length && /它|这条线|那条线|那个|刚才|^(?:进度|做到哪|卡在哪|继续说|怎么样)/.test(text)) {
      const id = [contextTopicId, ...focus, ...historyTopics.slice().reverse()].find((id) => byId.has(id));
      if (id) return { topic: byId.get(id) };
    } else if (!matched.length && /^(?:做到哪了|进度如何|卡在哪|怎么样)[？?]?$/.test(text) && byId.has(contextTopicId)) {
      return { topic: byId.get(contextTopicId) };
    }
    if (!matched.length && /忘了什么|有哪些|全园|巡园|待拍板|待收菜|有什么没做完|你好|早上好|工单|定时任务/.test(text)) return { global: true };
    return { candidates: (matched.length ? matched.map((h) => h.topic) : topics).slice(0, 2) };
  }

  #buildParkSnapshot(overview, { focusTopicId = "", pendingRequests = [], availableProfiles = [] } = {}) {
    const topics = topicsOf(overview);
    const topicByThread = new Map();
    for (const tp of topics) {
      for (const th of threadsOfTopic(tp)) if (th?.id) topicByThread.set(th.id, tp.name || tp.id);
    }
    const ordered = focusTopicId
      ? [...topics.filter((t) => t.id === focusTopicId), ...topics.filter((t) => t.id !== focusTopicId)]
      : topics;
    const compactTopics = ordered.slice(0, 40).map((t) => ({
      id: t.id,
      name: t.name,
      stage: t.pipeline?.stageLabel || "",
      liveCount: Number(t.liveCount) || 0,
      alertCount: Number(t.assistantSignals?.counts?.alert) || 0,
      harvestCount: Number(t.assistantSignals?.counts?.harvest) || 0,
      ruinCount: Number(t.assistantSignals?.counts?.ruin) || 0,
      progress: shortText(t.summary?.progress || "", 120),
      nextStep: shortText(t.summary?.nextStep || t.bottleneck || "", 100),
      activeThreads: (t.activeThreads || []).filter((th) => !th.internal && !th.isSlice).slice(0, 3).map((th) => ({
        id: th.id,
        title: shortText(th.title || th.preview || "未命名", 80),
        live: Boolean(th.live),
        pendingCount: Number(th.pendingCount) || 0,
        line: shortText(th.assistantTail?.text || threadTail(th)?.text || th.preview || "", 120),
      })),
    }));
    const compactReqs = (pendingRequests || []).slice(0, 8).map((r) => ({
      requestId: r.id,
      threadId: r.threadId || "",
      topicName: topicByThread.get(r.threadId) || "",
      title: shortText(r.title || "", 60),
      question: shortText(r.question || "", 80),
      command: shortText(r.command || "", 80),
    }));
    const openTickets = (overview.assistantTickets || []).slice(0, 12).map((tk) => ({
      id: tk.id,
      parentId: tk.parentId || "",
      title: tk.title,
      path: Array.isArray(tk.pathTitles) ? tk.pathTitles.join(" > ") : tk.title,
      topicId: tk.topicId || "",
      topicName: tk.topicName || "",
      threadId: tk.threadId || "",
      threadCount: (tk.threadIds || []).length,
      childCount: tk.childCount || 0,
      childDoneCount: tk.childDoneCount || 0,
      hasPlan: Boolean(tk.planRef?.threadId),
      goal: shortText(tk.goal || "", 100),
      criteria: tk.criteria || [],
      state: tk.state,
      line: shortText(tk.line || "", 80),
    }));
    const failedAutomations = [...topics.flatMap((t) => t.assistantSignals?.cards || []), ...(overview.assistantInbox?.cards || [])]
      .filter((c) => c.taskKey).slice(0, 5).map((c) => ({ cardId: c.id, taskKey: c.taskKey, title: c.title, line: c.line, topicId: c.topicId || "" }));
    const healthyAgents = (Array.isArray(availableProfiles) ? availableProfiles : []).filter((p) => p?.health?.status !== "unavailable");
    const agentPool = healthyAgents.length ? healthyAgents : (Array.isArray(availableProfiles) ? availableProfiles : []);
    const agents = agentPool.slice(0, 12).map((p) => ({
      agentKey: `${p.provider}:${p.id || "default"}`,
      provider: p.provider,
      label: shortText(p.health?.alias || p.alias || p.label || `${p.provider}:${p.id || "default"}`, 32),
    }));
    return {
      ...(focusTopicId ? { focusTopicId } : {}),
      badges: overview.assistantBadges || {},
      topics: compactTopics,
      pendingRequests: compactReqs,
      openTickets,
      failedAutomations,
      ...(agents.length ? { agents } : {}),
    };
  }

  #validateAndBuildAction(parsed, overview, pendingRequests = [], availableProfiles = []) {
    if (!parsed || !parsed.intent || parsed.intent === "chat") return {};
    const action = parsed.action || {};
    const topics = topicsOf(overview);
    const topicIds = new Set(topics.map((t) => t.id));
    const allThreads = [...topics.flatMap(threadsOfTopic), ...(overview.unassignedActive || [])];
    const allCards = [...topics.flatMap((t) => t.assistantSignals?.cards || []), ...(overview.assistantInbox?.cards || [])];
    const allTickets = overview.assistantTickets || [];
    const findThread = (id) => (typeof id === "string" && id ? allThreads.find((t) => t.id === id) : null);
    const findReq = (id) => (typeof id === "string" && id ? pendingRequests.find((r) => r.id === id) : null);
    const findTicket = (id) => (typeof id === "string" && id ? allTickets.find((tk) => tk.id === id) : null);

    if (parsed.intent === "focus_topic") {
      const tid = topicIds.has(action.topicId) ? action.topicId : (topicIds.has(parsed.focusTopicId) ? parsed.focusTopicId : "");
      return tid ? { clientEffect: { type: "focus", topicId: tid } } : {};
    }
    if (parsed.intent === "open_thread") {
      const th = findThread(action.threadId);
      return th ? { clientEffect: { type: "open_thread", threadId: th.id } } : {};
    }
    if (parsed.intent === "archive_preview") {
      const tid = topicIds.has(action.topicId) ? action.topicId : (topicIds.has(parsed.focusTopicId) ? parsed.focusTopicId : "");
      const staleDays = Number(action.staleDays) > 0 ? Math.min(365, Math.round(Number(action.staleDays))) : 3;
      return { clientEffect: { type: "archive_preview", topicId: tid, staleDays } };
    }
    if (parsed.intent === "reorg_preview") {
      const instruction = shortText(action.instruction || "", 400);
      return instruction ? { clientEffect: { type: "reorg_preview", instruction } } : {};
    }
    if (parsed.intent === "approve_request") {
      const req = findReq(action.requestId);
      const decision = action.decision === "decline" ? "decline" : action.decision === "accept" ? "accept" : "";
      if (!req || !decision) return {};
      return {
        proposal: {
          id: `act_${randomUUID().slice(0, 8)}`,
          intent: "approve_request",
          risk: resolveActionRisk("approve_request", { decision }),
          summary: `${decision === "accept" ? "批准" : "拒绝"}待拍板「${shortText(req.title || req.command || req.id, 30)}」`,
          payload: { intent: "approve_request", requestId: req.id, decision, threadId: req.threadId || "" },
        },
      };
    }
    if (parsed.intent === "continue_thread") {
      const th = findThread(action.threadId);
      if (!th) return {};
      const card = (typeof action.cardId === "string" && allCards.find((c) => c.id === action.cardId))
        || allCards.find((c) => c.threadId === th.id) || null;
      const message = shortText(action.message || "", 500) || "请从当前工位继续推进未完成工作。";
      return {
        proposal: {
          id: `act_${randomUUID().slice(0, 8)}`,
          intent: "continue_thread",
          risk: resolveActionRisk("continue_thread", action),
          summary: `让「${shortText(th.title || th.id, 24)}」续做：${shortText(message, 36)}`,
          payload: { intent: "continue_thread", threadId: th.id, ...(card ? { cardId: card.id } : {}), message },
        },
      };
    }
    if (parsed.intent === "interrupt_thread") {
      const th = findThread(action.threadId);
      if (!th) return {};
      return {
        proposal: {
          id: `act_${randomUUID().slice(0, 8)}`,
          intent: "interrupt_thread",
          risk: resolveActionRisk("interrupt_thread", action),
          summary: `中断「${shortText(th.title || th.id, 28)}」当前执行`,
          payload: { intent: "interrupt_thread", threadId: th.id },
        },
      };
    }
    if (parsed.intent === "pin_ticket") {
      const th = findThread(action.threadId);
      if (!th) return {};
      const criteria = Array.isArray(action.criteria) ? cleanCriteria(action.criteria) : undefined;
      return {
        proposal: {
          id: `act_${randomUUID().slice(0, 8)}`,
          intent: "pin_ticket",
          risk: resolveActionRisk("pin_ticket", action),
          summary: `把「${shortText(action.title || th.title || th.id, 24)}」钉成任务`,
          payload: {
            intent: "pin_ticket",
            threadId: th.id,
            ...(action.title ? { title: shortText(action.title, 40) } : {}),
            ...(action.goal ? { goal: shortText(action.goal, 200) } : {}),
            ...(criteria ? { criteria } : {}),
          },
        },
      };
    }
    if (parsed.intent === "update_ticket") {
      const tk = findTicket(action.ticketId);
      if (!tk) return {};
      const criteria = action.criteria !== undefined ? cleanCriteria(action.criteria) : undefined;
      const status = action.status && ["open", "done", "dropped"].includes(action.status) ? action.status : undefined;
      return {
        proposal: {
          id: `act_${randomUUID().slice(0, 8)}`,
          intent: "update_ticket",
          risk: resolveActionRisk("update_ticket", action),
          summary: `更新任务「${shortText(tk.title, 24)}」`,
          payload: {
            intent: "update_ticket",
            ticketId: tk.id,
            ...(action.goal !== undefined ? { goal: shortText(action.goal, 200) } : {}),
            ...(criteria !== undefined ? { criteria } : {}),
            ...(status ? { status } : {}),
          },
        },
      };
    }
    if (parsed.intent === "dispatch") {
      const instruction = shortText(action.instruction || "", 600);
      if (!instruction) return {};
      const tid = topicIds.has(action.topicId) ? action.topicId : (topicIds.has(parsed.focusTopicId) ? parsed.focusTopicId : "");
      const topicName = tid ? topics.find((t) => t.id === tid)?.name : "";
      const resolvedAgent = resolveAssistantDispatchAgent(action.agentKey, availableProfiles);
      return {
        proposal: {
          id: `act_${randomUUID().slice(0, 8)}`,
          intent: "dispatch",
          risk: resolveActionRisk("dispatch", action),
          summary: topicName ? `向「${topicName}」派工：${shortText(instruction, 36)}` : `派工：${shortText(instruction, 40)}`,
          payload: {
            intent: "dispatch",
            instruction,
            topicId: tid,
            ...(resolvedAgent.agentKey ? { agentKey: resolvedAgent.agentKey } : {}),
            ...(resolvedAgent.preferredProvider ? { preferredProvider: resolvedAgent.preferredProvider } : {}),
            ...(action.mode === "new" ? { mode: "new" } : {}),
          },
        },
      };
    }
    return {};
  }

  async executeProposedAction(input = {}) {
    const rawProposalId = typeof input?.proposalId === "string" ? input.proposalId.trim() : "";
    const actFallbackId = !rawProposalId && typeof input?.id === "string" && /^act_/.test(input.id.trim()) && !input?.payload
      ? input.id.trim()
      : "";
    const proposalId = rawProposalId || actFallbackId;

    if (proposalId && input?.cancel === true) {
      const canceled = this.cancelProposal(proposalId);
      return { ok: true, canceled: canceled.cleared, clearedProposal: true };
    }

    let data;
    if (proposalId) {
      this.#pruneProposals();
      const entry = this.#proposals.get(proposalId);
      if (!entry) {
        throw error("该待确认操作已过期或已执行，请重新说明", 410);
      }
      // Consume immediately before async dispatch so duplicate retries cannot double-execute.
      this.#proposals.delete(proposalId);
      data = { intent: entry.intent, ...(entry.payload || {}) };
    } else {
      data = input?.payload && typeof input.payload === "object"
        ? { intent: input.intent || input.payload.intent, ...input.payload }
        : (input || {});
    }

    const intent = String(data.intent || "").trim();
    if (!intent) throw error("缺少执行动作类型");

    if (intent === "approve_request") {
      const pendingRequests = await Promise.resolve(this.hub?.allPendingRequests?.() || []);
      const req = pendingRequests.find((r) => r.id === data.requestId);
      if (!req) throw error("待拍板请求不存在或已处理", 404);
      const decision = data.decision === "decline" ? "decline" : "accept";
      if (typeof this.hub?.respondToRequest !== "function") throw error("当前不支持语音/助手审批", 409);
      await this.hub.respondToRequest(req.id, { decision });
      return { ok: true, intent, summary: decision === "accept" ? "已批准继续执行" : "已拒绝该请求", threadId: req.threadId || "" };
    }

    if (intent === "continue_thread") {
      const threadId = String(data.threadId || "").trim();
      if (!threadId) throw error("缺少工位 ID");
      const overview = await this.getOverview();
      const allThreads = [...topicsOf(overview).flatMap(threadsOfTopic), ...(overview.unassignedActive || [])];
      const th = allThreads.find((t) => t.id === threadId);
      if (!th) throw error("工位不存在", 404);
      const message = String(data.message || "").trim() || "请从当前工位继续推进未完成工作。";
      if (data.cardId) {
        const res = await this.cardAction(data.cardId, { type: "continue", message });
        return {
          ok: true,
          intent,
          ...(res.queued ? { queued: true } : {}),
          summary: res.queued ? "工位正在运行，已挂到下一轮排队执行" : "已发回原工位继续执行",
          threadId: res.threadId || threadId,
        };
      }
      if (th.live && typeof this.hub?.queueTurn === "function") {
        await this.hub.queueTurn({ threadId, text: message });
        return { ok: true, intent, queued: true, summary: "工位正在运行，已挂到下一轮排队执行", threadId };
      }
      if (typeof this.hub?.sendTurn !== "function") throw error("原工位暂不可续做", 409);
      await this.hub.sendTurn({ threadId, text: message });
      this.#tails.delete(threadId);
      return { ok: true, intent, summary: "已发回原工位继续执行", threadId };
    }

    if (intent === "interrupt_thread") {
      const threadId = String(data.threadId || "").trim();
      if (!threadId) throw error("缺少工位 ID");
      const overview = await this.getOverview();
      const allThreads = [...topicsOf(overview).flatMap(threadsOfTopic), ...(overview.unassignedActive || [])];
      if (!allThreads.some((t) => t.id === threadId)) throw error("工位不存在", 404);
      if (typeof this.hub?.interrupt !== "function") throw error("当前不支持中断工位", 409);
      await this.hub.interrupt({ threadId });
      return { ok: true, intent, summary: "已发送中断指令", threadId };
    }

    if (intent === "pin_ticket") {
      const res = await this.createTicket({
        threadId: data.threadId,
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.goal !== undefined ? { goal: data.goal } : {}),
        ...(data.criteria !== undefined ? { criteria: data.criteria } : {}),
      });
      return { ok: true, intent, summary: `已钉成任务「${res.ticket.title}」`, ticket: res.ticket, threadId: data.threadId };
    }

    if (intent === "update_ticket") {
      const ticketId = String(data.ticketId || "").trim();
      if (!ticketId) throw error("缺少任务 ID");
      const res = await this.updateTicket(ticketId, {
        ...(data.goal !== undefined ? { goal: data.goal } : {}),
        ...(data.criteria !== undefined ? { criteria: data.criteria } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      });
      return { ok: true, intent, summary: `已更新任务「${res.ticket.title}」`, ticket: res.ticket };
    }

    if (intent === "dispatch") {
      if (typeof this.dispatchImpl !== "function") throw error("派工通道暂不可用", 409);
      const instruction = String(data.instruction || "").trim();
      if (!instruction && (!Array.isArray(data.approvedRoutes) || !data.approvedRoutes.length)) {
        throw error("缺少派工指令");
      }
      const approvedRoutes = Array.isArray(data.approvedRoutes) && data.approvedRoutes.length ? data.approvedRoutes : null;
      const res = await this.dispatchImpl({
        text: instruction,
        topicId: data.topicId || "",
        mode: data.mode || "auto",
        preferredProvider: data.preferredProvider || "auto",
        agentKey: data.agentKey || "auto",
        confirmOnly: false,
        useAiPlanner: false,
        ...(approvedRoutes ? { approvedRoutes } : {}),
      });
      const dispatched = Array.isArray(res?.dispatched) ? res.dispatched : [];
      const taskIds = [];
      const leafTasks = [];
      if (dispatched.length) {
        for (const item of dispatched) {
          if (item?.threadId) this.#rememberDispatchedThread(item.threadId);
        }
        if (this.taskStore) {
          let parentId = "";
          if (dispatched.length > 1) {
            const parent = await this.taskStore.create({
              title: shortText(instruction, 40) || "语音派工任务",
              goal: shortText(instruction, 200),
              criteria: [],
              topicId: data.topicId || dispatched[0]?.topicId || "",
              cwd: dispatched[0]?.cwd || "",
              threadIds: [],
              draftedBy: "assistant",
              actor: "assistant",
            }).catch(() => null);
            if (parent?.id) {
              parentId = parent.id;
              taskIds.push(parent.id);
            }
          }
          for (const item of dispatched) {
            const tid = String(item?.threadId || "").trim();
            const title = shortText(item?.segmentText || item?.threadTitle || instruction, 40) || "派工子任务";
            const goal = shortText(item?.segmentText || instruction, 200);
            const createdTask = await this.taskStore.create({
              title,
              goal,
              criteria: [],
              topicId: item?.topicId || data.topicId || "",
              cwd: item?.cwd || "",
              parentId,
              threadIds: tid ? [tid] : [],
              draftedBy: "assistant",
              actor: "assistant",
            }).catch(() => null);
            if (createdTask?.id) {
              taskIds.push(createdTask.id);
              leafTasks.push(createdTask);
              if (tid) await this.hub?.setThreadTask?.(tid, createdTask.id).catch(() => {});
            }
          }
          if (leafTasks.length) {
            void this.#draftDispatchCriteriaAsync(leafTasks);
          }
        }
      }
      const first = dispatched[0];
      const summary = dispatched.length > 1
        ? `已拆 ${dispatched.length} 路派出${taskIds.length ? "并建账" : ""}`
        : first
          ? `已派出到「${first.topicName || data.topicId || "产线"}」${taskIds.length ? "并建账" : ""}`
          : "已完成派工";
      return {
        ok: true,
        intent,
        summary,
        threadId: first?.threadId || "",
        topicId: first?.topicId || data.topicId || "",
        dispatched,
        taskIds,
      };
    }

    throw error(`不支持的助手动作：${intent}`);
  }

  #resolveAnswerLinks({
    answerText = "",
    chatRes = null,
    records = [],
    topics = [],
    overview = {},
    extraThreads = [],
    focusTopicId = "",
    topic = null,
    executedAction = null,
    proposal = null,
    usedModel = false,
  } = {}) {
    const topicById = new Map(topics.map((t) => [t.id, t]));
    const threadById = new Map();
    const threadTopicId = new Map();
    const registerThread = (th, tid = "") => {
      if (!th?.id || th.internal) return;
      const existing = threadById.get(th.id);
      if (!existing || (!existing.title && th.title)) threadById.set(th.id, th);
      if (tid && !threadTopicId.has(th.id)) threadTopicId.set(th.id, tid);
      else if (th.topicId && !threadTopicId.has(th.id)) threadTopicId.set(th.id, th.topicId);
    };
    for (const tp of topics) {
      for (const th of threadsOfTopic(tp)) registerThread(th, tp.id);
    }
    for (const th of overview.unassignedActive || []) registerThread(th, th.topicId || "");
    for (const th of extraThreads || []) registerThread(th, th.topicId || "");
    for (const r of records) {
      const s = r?.source;
      if (s?.threadId && !threadById.has(s.threadId)) {
        registerThread({ id: s.threadId, title: String(s.label || "").replace(/^工位·/, ""), updatedAt: s.at || 0 }, s.topicId || "");
      }
    }
    const ticketById = new Map((overview.assistantTickets || []).map((tk) => [tk.id, tk]));
    const recordThreadIds = new Set(records.map((r) => r?.source?.threadId).filter(Boolean));
    const effectiveFocusId = (focusTopicId && topicById.has(focusTopicId)) ? focusTopicId : (topic?.id || "");
    const answerStr = String(answerText || "");
    const lowerAnswer = answerStr.toLowerCase();
    const claimedSpans = [];

    const findTermInAnswer = (rawTerm) => {
      const clean = String(rawTerm || "").trim().replace(/\s+/g, " ");
      if (!clean) return null;
      const chars = Array.from(clean);
      const variants = chars.length > 40 ? [clean, chars.slice(0, 40).join("").trim()] : [clean];
      for (const v of variants) {
        if (!v) continue;
        const lowerV = v.toLowerCase();
        let from = 0;
        while (from < lowerAnswer.length) {
          const idx = lowerAnswer.indexOf(lowerV, from);
          if (idx < 0) break;
          const end = idx + v.length;
          if (!claimedSpans.some(([s, e]) => idx < e && end > s)) {
            return { index: idx, end, matchText: answerStr.slice(idx, end) };
          }
          from = idx + 1;
        }
      }
      return null;
    };

    const byKey = new Map();
    const upsertLink = (kind, id, { label = "", matchText = "", textIndex = Number.MAX_SAFE_INTEGER, refOrder = 999, topicId = "", topicName = "" } = {}) => {
      if (!id) return;
      const key = `${kind}:${id}`;
      const prev = byKey.get(key);
      if (prev) {
        if (!prev.matchText && matchText) prev.matchText = matchText;
        if (textIndex < prev.textIndex) prev.textIndex = textIndex;
        if (refOrder < prev.refOrder) prev.refOrder = refOrder;
        return;
      }
      byKey.set(key, {
        kind,
        id,
        label: shortText(label || id, 60),
        matchText: matchText || "",
        textIndex,
        refOrder,
        ...(topicId ? { topicId } : {}),
        ...(topicName ? { topicName } : {}),
      });
    };

    const addThreadById = (tid, refOrder = 999) => {
      const th = threadById.get(tid);
      if (!th) return false;
      const tTopicId = threadTopicId.get(tid) || "";
      const tTopic = tTopicId ? topicById.get(tTopicId) : null;
      const rawTitle = String(th.title || th.preview || "").trim();
      const hit = Array.from(rawTitle).length >= 3 && !/^未命名(?:会话)?$/.test(rawTitle) ? findTermInAnswer(rawTitle) : null;
      if (hit) claimedSpans.push([hit.index, hit.end]);
      upsertLink("thread", tid, {
        label: rawTitle || th.id,
        matchText: hit?.matchText || "",
        textIndex: hit ? hit.index : Number.MAX_SAFE_INTEGER,
        refOrder,
        topicId: tTopic?.id || tTopicId,
        topicName: tTopic?.name || "",
      });
      return true;
    };

    const addTopicById = (tid, refOrder = 999) => {
      const tp = topicById.get(tid);
      if (!tp) return false;
      const hit = Array.from(String(tp.name || "").trim()).length >= 2 ? findTermInAnswer(tp.name) : null;
      if (hit) claimedSpans.push([hit.index, hit.end]);
      upsertLink("topic", tp.id, {
        label: tp.name,
        matchText: hit?.matchText || "",
        textIndex: hit ? hit.index : Number.MAX_SAFE_INTEGER,
        refOrder,
      });
      return true;
    };

    let orderSeq = 0;
    const actionThreadId = executedAction?.threadId || proposal?.payload?.threadId || chatRes?.action?.threadId || "";
    if (actionThreadId) addThreadById(actionThreadId, orderSeq++);
    const actionTopicId = executedAction?.topicId || proposal?.payload?.topicId || "";
    if (actionTopicId) addTopicById(actionTopicId, orderSeq++);

    const resolveSourceRef = (src, order) => {
      if (!src) return;
      if (src.threadId) addThreadById(src.threadId, order);
      else if (src.ticketId) {
        const tk = ticketById.get(src.ticketId);
        if (tk?.threadId) addThreadById(tk.threadId, order);
        else if (tk?.topicId) addTopicById(tk.topicId, order);
      } else if (src.topicId) addTopicById(src.topicId, order);
    };

    for (const ref of chatRes?.refs || []) {
      const sMatch = String(ref).match(/^S(\d+)$/i);
      if (sMatch) {
        resolveSourceRef(records[Number(sMatch[1]) - 1]?.source, orderSeq++);
      } else if (threadById.has(ref)) {
        addThreadById(ref, orderSeq++);
      } else if (topicById.has(ref)) {
        addTopicById(ref, orderSeq++);
      } else if (ticketById.has(ref)) {
        const tk = ticketById.get(ref);
        if (tk?.threadId) addThreadById(tk.threadId, orderSeq++);
        else if (tk?.topicId) addTopicById(tk.topicId, orderSeq++);
      }
    }

    if (!usedModel) {
      for (const m of answerStr.matchAll(/\[S(\d+)\]/g)) {
        resolveSourceRef(records[Number(m[1]) - 1]?.source, orderSeq++);
      }
    }

    const sortedThreads = [...threadById.values()]
      .filter((th) => {
        const title = String(th.title || "").trim();
        return Array.from(title).length >= 3 && !/^未命名(?:会话)?$/.test(title);
      })
      .sort((a, b) => {
        const lenDiff = Array.from(String(b.title).trim()).length - Array.from(String(a.title).trim()).length;
        if (lenDiff !== 0) return lenDiff;
        const aFocus = effectiveFocusId && threadTopicId.get(a.id) === effectiveFocusId ? 1 : 0;
        const bFocus = effectiveFocusId && threadTopicId.get(b.id) === effectiveFocusId ? 1 : 0;
        if (bFocus !== aFocus) return bFocus - aFocus;
        const aRec = recordThreadIds.has(a.id) ? 1 : 0;
        const bRec = recordThreadIds.has(b.id) ? 1 : 0;
        if (bRec !== aRec) return bRec - aRec;
        return timestamp(b.updatedAt) - timestamp(a.updatedAt);
      });

    for (const th of sortedThreads) {
      if (byKey.has(`thread:${th.id}`)) continue;
      const hit = findTermInAnswer(th.title);
      if (!hit) continue;
      claimedSpans.push([hit.index, hit.end]);
      const tTopicId = threadTopicId.get(th.id) || "";
      const tTopic = tTopicId ? topicById.get(tTopicId) : null;
      upsertLink("thread", th.id, {
        label: String(th.title).trim(),
        matchText: hit.matchText,
        textIndex: hit.index,
        refOrder: 100 + orderSeq++,
        topicId: tTopic?.id || tTopicId,
        topicName: tTopic?.name || "",
      });
    }

    const sortedTopics = [...topics]
      .filter((t) => Array.from(String(t.name || "").trim()).length >= 2)
      .sort((a, b) => Array.from(String(b.name).trim()).length - Array.from(String(a.name).trim()).length);

    for (const tp of sortedTopics) {
      if (byKey.has(`topic:${tp.id}`)) continue;
      const hit = findTermInAnswer(tp.name);
      if (!hit) continue;
      claimedSpans.push([hit.index, hit.end]);
      upsertLink("topic", tp.id, {
        label: tp.name,
        matchText: hit.matchText,
        textIndex: hit.index,
        refOrder: 200 + orderSeq++,
      });
    }

    if (effectiveFocusId) addTopicById(effectiveFocusId, 300 + orderSeq++);

    const rankCmp = (a, b) => {
      if (a.kind !== b.kind) return a.kind === "thread" ? -1 : 1;
      if (a.textIndex !== b.textIndex) return a.textIndex - b.textIndex;
      return a.refOrder - b.refOrder;
    };
    return [...byKey.values()].sort(rankCmp).slice(0, 5).map(({ textIndex: _ti, refOrder: _ro, ...item }) => item);
  }

  async ask(input = {}, { onTrace = () => {}, onSpokenReply = null, signal = null } = {}) {
    const abortErr = () => Object.assign(new Error("已停止本次思考"), { name: "AbortError", aborted: true, status: 499 });
    if (signal?.aborted) throw abortErr();
    if (typeof input.text !== "string") throw error("text 必须是问题文本");
    const text = String(input.text || "").trim();
    if (!text || text.length > 4000) throw error("问题不能为空且不超过 4000 字");
    if (input.history && (!Array.isArray(input.history) || input.history.length > 12 || input.history.some((h) => !["user", "assistant"].includes(h.role) || typeof h.text !== "string" || h.text.length > 4000))) throw error("history 最多 12 条 user/assistant 消息");
    if (input.focus && (!Array.isArray(input.focus) || input.focus.some((id) => typeof id !== "string"))) throw error("focus 必须是产线 ID 数组");
    const mode = input.mode === "phone" ? "phone" : "chat";
    const modelKey = typeof input.modelKey === "string" && input.modelKey.trim() ? input.modelKey.trim() : "auto";
    const sessionId = typeof input.sessionId === "string" ? input.sessionId.trim() : "";
    const callKey = sessionId || String(input.callId || "").trim();
    const rawProposalId = String(input.proposalId || input.pendingProposal?.id || "").trim();
    const activePending = rawProposalId ? this.getPendingProposal(rawProposalId, { callKey }) : null;
    const autoExecute = Boolean(input.autoExecute);
    const hasModel = Boolean(await this.llm.available?.());
    if (signal?.aborted) throw abortErr();
    const [overview, pendingRequests, providerInfo] = await Promise.all([
      this.getOverview(),
      Promise.resolve(this.hub?.allPendingRequests?.() || []),
      typeof this.hub?.listProvidersAndProfiles === "function"
        ? Promise.resolve(this.hub.listProvidersAndProfiles()).catch(() => null)
        : Promise.resolve(null),
    ]);
    const availableProfiles = (Array.isArray(providerInfo?.profiles) ? providerInfo.profiles : []).filter((p) => (
      p
      && p.provider
      && p.installed !== false
      && !p.health?.disabled
      && p.account?.signedIn !== false
    ));
    if (signal?.aborted) throw abortErr();
    const topics = topicsOf(overview), profile = await this.profile();
    const resolved = this.resolve(text, topics, profile, input);
    const trace = [];
    const emit = async (step, label, count) => { const item = { step, label, count }; trace.push(item); await onTrace(item); };
    await emit("resolve", resolved.topic ? `认出你说的是「${resolved.topic.name}」` : hasModel ? "整合全园状态与上下文" : resolved.global ? "查看全园信号" : "需要确认你说的产线", resolved.topic ? 1 : 0);
    // Offline fallback still asks which line when ambiguous; with a live model
    // the assistant can answer general chats and reason over the full park.
    if (resolved.candidates && !hasModel) {
      const candidates = resolved.candidates.map((t) => ({ topicId: t.id, title: t.name }));
      const clarifyText = candidates.length ? `你说的是${candidates.map((c) => `「${c.title}」`).join("还是")}？\n（未经模型整理）` : "还没有可查询的产线。\n（未经模型整理）";
      return { kind: "clarify", text: clarifyText, spokenReply: cleanForSpeech(clarifyText),
        sources: [], links: [], actions: candidates.map((c) => ({ label: c.title, type: "clarify_pick", payload: { alias: subjectOf(text), topicId: c.topicId } })), candidates, usedModel: false, mood: "waiting", trace };
    }
    const topic = resolved.topic || null;
    const contextTopic = !topic && input.contextTopicId ? topics.find((t) => t.id === input.contextTopicId) || null : null;
    const selected = topic ? [topic] : topics.slice(0, 8);
    const records = [], keys = new Set(), extraThreads = [];
    const add = (source, body) => {
      const key = `${source.kind}:${source.ticketId || source.threadId || source.sha || source.path || source.topicId}`;
      if (keys.has(key)) return;
      keys.add(key); records.push({ source, text: shortText(body || source.label, 300) });
    };
    // Pinned 任务 come first: they are what the user said matters.
    for (const tk of (overview.assistantTickets || []).filter((v) => !topic || v.topicId === topic.id).slice(0, 6)) {
      const pathLabel = Array.isArray(tk.pathTitles) && tk.pathTitles.length > 1 ? tk.pathTitles.join(" › ") : tk.title;
      add({ kind: "ticket", label: shortText(`任务·${pathLabel}`, 60), ticketId: tk.id, ...(tk.topicId ? { topicId: tk.topicId } : {}), ...(tk.threadId ? { threadId: tk.threadId } : {}), ...(isoTime(tk.updatedAt) ? { at: isoTime(tk.updatedAt) } : {}) },
        `目标：${tk.goal || "未写"}\n验收标准：${tk.criteria?.length ? tk.criteria.join("；") : "未定"}\n现状：${tk.line}`);
    }
    for (const t of selected) {
      if (t.summary?.progress) add({ kind: "summary", label: `产线摘要·${t.name}`, topicId: t.id, ...(isoTime(t.summary.updatedAt) ? { at: isoTime(t.summary.updatedAt) } : {}) }, `${t.summary.progress}\n下一步：${t.summary.nextStep || "未记录"}`);
      const recent = [...(t.activeThreads || []), ...(t.archivedThreads || [])].filter((th) => !th.internal && !th.isSlice).sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt)).slice(0, 3);
      for (const th of recent) add(threadSource(th, t.id), threadTail(th)?.text || th.preview || th.title);
      for (const card of t.assistantSignals?.cards || []) {
        for (const source of card.sources.filter((s) => s.kind === "thread")) add(source, card.line);
      }
    }
    const searchKeyword = subjectOf(text);
    const shouldSearch = shouldSearchParkSources(text, { topic });
    const vaultHitsPromise = shouldSearch
      ? this.memoryVault().then((vault) => (vault ? vault.search(searchKeyword, { scope: topic?.memoryScope || topic?.id || "", limit: 8 }).catch(() => []) : []))
      : Promise.resolve([]);
    if (shouldSearch && typeof this.hub?.searchThreads === "function") {
      const query = /上次|之前|历史|怎么解决/.test(text) ? searchKeyword : (topic?.name || searchKeyword);
      const result = await this.hub.searchThreads({ query, cwd: topic?.primaryCwd || "", archived: "all", limit: 8 }).catch(() => ({ threads: [] }));
      for (const th of (result.threads || []).filter((t) => !t.internal).slice(0, 8)) {
        extraThreads.push(th);
        add(threadSource(th, topic?.id || th.topicId), th.searchMatch?.matchSnippet || threadTail(th)?.text || th.preview);
      }
    }
    if (signal?.aborted) throw abortErr();
    const emitKind = async (step, kind, label) => { const count = records.filter((r) => r.source.kind === kind).length; if (count) await emit(step, `${label} ${count} 条`, count); };
    await emitKind("tickets", "ticket", "对了任务");
    await emitKind("threads", "thread", "翻了相关工位");
    for (const t of selected) for (const commit of (t.gitSnapshot?.commits || []).slice(0, 3)) {
      const sha = typeof commit === "string" ? commit.match(/^[a-f0-9]+/i)?.[0] : commit.sha;
      if (sha) add({ kind: "commit", label: `提交 ${sha.slice(0, 8)}`, sha, topicId: t.id, path: t.gitSnapshot.cwd || t.primaryCwd }, typeof commit === "string" ? commit : commit.message);
    }
    await emitKind("commits", "commit", "看了提交");
    for (const t of selected) for (const card of t.assistantSignals?.cards || []) for (const source of card.sources.filter((s) => s.kind === "wip")) add(source, card.line);
    const vaultMemoryHits = [];
    const hits = await vaultHitsPromise;
    for (const hit of hits) {
      if (hit.kind === "wip") {
        add({ kind: "wip", label: `任务卡·${shortText(hit.rel, 48)}`, path: hit.rel, ...(topic ? { topicId: topic.id } : {}) }, hit.snippet);
      } else {
        vaultMemoryHits.push(hit);
      }
    }
    await emitKind("wip", "wip", "查到任务卡");
    for (const hit of vaultMemoryHits) {
      add({ kind: "memory", label: `记忆·${shortText(hit.rel, 48)}`, path: hit.rel, ...(topic ? { topicId: topic.id } : {}) }, hit.snippet);
    }
    await emitKind("memory", "memory", "查到记忆");
    await emit("compose", "整理回复", records.length);
    if (signal?.aborted) throw abortErr();
    const sources = records.map((r) => r.source);
    const cards = [...selected.flatMap((t) => t.assistantSignals?.cards || []), ...(topic ? [] : overview.assistantInbox?.cards || [])].sort((a, b) => SIGNAL_TYPES.indexOf(a.type) - SIGNAL_TYPES.indexOf(b.type) || timestamp(a.since) - timestamp(b.since));
    const first = cards[0];
    let conclusion = first ? `${topic?.name || selected.find((t) => t.id === first.topicId)?.name}：${first.line}`
      : topic?.summary?.progress ? `${topic.name}：${shortText(topic.summary.progress, 220)}` : topic ? `${topic.name}：现有记录不足以确认停在哪。` : `当前有 ${overview.assistantBadges?.alert || 0} 项待拍板、${overview.assistantBadges?.harvest || 0} 项待收菜、${overview.assistantBadges?.ruin || 0} 项久未推进。`;
    const conclusionSource = first ? sources.findIndex((s) => first.sources.some((fs) => fs.kind === s.kind && (fs.threadId ? fs.threadId === s.threadId : fs.path === s.path))) : sources.findIndex((s) => s.kind === "summary" && s.topicId === topic?.id);
    if (conclusionSource >= 0) conclusion += ` [S${conclusionSource + 1}]`;
    const evidenceLines = records.slice(0, 3).map((r, i) => `${r.source.label}：${shortText(r.text, 180)} [S${i + 1}]`);
    let answerText = [conclusion, ...evidenceLines].join("\n"), spokenReply = "", usedModel = false;
    let focusTopicId = topic?.id || "";
    let mood = first?.type === "harvest" ? "good" : first ? "worry" : "report";
    let clientEffect = null, proposal = null, executedAction = null, chatRes = null, clearedProposal = false;

    if (hasModel) {
      let remaining = 5500;
      const evidenceSources = records.map((r, i) => {
        const body = shortText(r.text, Math.max(0, Math.min(300, remaining)));
        remaining -= Array.from(body).length;
        return {
          id: `S${i + 1}`,
          kind: r.source.kind,
          label: shortText(r.source.label, 60),
          ...(r.source.threadId ? { threadId: r.source.threadId } : {}),
          ...(r.source.topicId ? { topicId: r.source.topicId } : {}),
          ...(r.source.ticketId ? { ticketId: r.source.ticketId } : {}),
          text: body,
        };
      });
      const conversation = (input.history || []).slice(-8).map((h) => ({ role: h.role, text: shortText(h.text, 400) })).filter((h) => h.text);
      const park = this.#buildParkSnapshot(overview, { focusTopicId: topic?.id || contextTopic?.id || "", pendingRequests, availableProfiles });
      chatRes = typeof this.llm.chat === "function"
        ? await this.llm.chat({
          question: shortText(text, 600),
          conversation,
          park,
          sources: evidenceSources,
          mode,
          modelKey,
          sessionId,
          allowActions: true,
          speechTiming: input.speechTiming || null,
          pendingProposal: activePending ? { id: activePending.id, intent: activePending.intent, risk: activePending.risk, summary: activePending.summary } : null,
          onSpokenReply,
          signal,
        })
        : null;
      if (signal?.aborted) throw abortErr();
      if (chatRes) {
        answerText = chatRes.reply;
        spokenReply = chatRes.spokenReply;
        usedModel = true;
        if (chatRes.focusTopicId && topics.some((t) => t.id === chatRes.focusTopicId)) {
          focusTopicId = chatRes.focusTopicId;
        }
        if (chatRes.mood) mood = chatRes.mood;

        if (activePending && chatRes.proposalAction === "confirm") {
          clearedProposal = true;
          try {
            executedAction = await this.executeProposedAction({ proposalId: activePending.id });
            if (!answerText || /^(?:好|好的|确认|收到|没问题)[。！!]?$/.test(answerText)) {
              answerText = `好的，${executedAction.summary || "已经执行"}。`;
              spokenReply = cleanForSpeech(answerText, 240);
            }
          } catch (err) {
            executedAction = { ok: false, intent: activePending.intent, error: err?.message || "执行失败" };
            const failNote = `不过执行时遇到了问题：${executedAction.error}`;
            answerText = `${answerText}\n\n${failNote}`;
            spokenReply = cleanForSpeech(`${spokenReply} ${failNote}`, 240);
          }
        } else if (activePending && chatRes.proposalAction === "cancel") {
          this.cancelProposal(activePending.id);
          clearedProposal = true;
        } else {
          if (activePending && chatRes.proposalAction === "amend") {
            this.cancelProposal(activePending.id);
            clearedProposal = true;
          }
          const validated = this.#validateAndBuildAction(chatRes, overview, pendingRequests, availableProfiles);
          if (validated.clientEffect) clientEffect = validated.clientEffect;
          if (validated.proposal) {
            const shouldAutoExec = autoExecute && validated.proposal.risk === "toggle";
            if (shouldAutoExec) {
              try {
                executedAction = await this.executeProposedAction(validated.proposal);
              } catch (err) {
                executedAction = { ok: false, intent: validated.proposal.intent, error: err?.message || "执行失败" };
                const failNote = `不过执行时遇到了问题：${executedAction.error}`;
                answerText = `${answerText}\n\n${failNote}`;
                spokenReply = cleanForSpeech(`${spokenReply} ${failNote}`, 240);
              }
            } else {
              if (validated.proposal.intent === "dispatch") {
                const enriched = await this.#enrichDispatchProposal(validated.proposal);
                if (enriched?.confirmText && mode === "phone") {
                  answerText = enriched.confirmText;
                  spokenReply = cleanForSpeech(enriched.confirmText, 240);
                }
              }
              proposal = this.#registerProposal(validated.proposal, { callKey });
              if (proposal) clearedProposal = false;
            }
          }
        }
      } else if (records.length && typeof this.llm.complete === "function") {
        if (signal?.aborted) throw abortErr();
        const composed = await this.llm.complete({ evidence: { question: shortText(text, 300), sources: evidenceSources, ...(conversation.length ? { conversation } : {}) }, signal });
        if (signal?.aborted) throw abortErr();
        if (composed) { answerText = composed; usedModel = true; }
      }
    }
    if (!usedModel) answerText += "\n（未经模型整理）";
    if (!spokenReply) spokenReply = cleanForSpeech(answerText, 240);
    const links = this.#resolveAnswerLinks({
      answerText,
      chatRes,
      records,
      topics,
      overview,
      extraThreads,
      focusTopicId,
      topic,
      executedAction,
      proposal,
      usedModel,
    });
    const actions = [];
    const effectiveFocus = focusTopicId ? topics.find((t) => t.id === focusTopicId) : topic;
    const primaryThreadLink = links.find((l) => l.kind === "thread");
    const fallbackTopicThread = !primaryThreadLink && topic ? sources.find((s) => s.threadId && (!s.topicId || s.topicId === topic.id)) : null;
    const primaryThreadId = primaryThreadLink?.id || fallbackTopicThread?.threadId || "";
    if (effectiveFocus) actions.push({ label: "查看产线", type: "focus", payload: { topicId: effectiveFocus.id } });
    if (primaryThreadId) actions.push({ label: "打开工位", type: "open_thread", payload: { threadId: primaryThreadId } });
    if (first && !proposal && !executedAction) {
      actions.push({ label: first.type === "harvest" ? "收菜" : first.threadId ? "续做" : "稍后", type: "card_action",
        payload: { cardId: first.id, action: first.type === "harvest" ? "harvest" : first.threadId ? "continue" : "snooze" } });
    }
    return {
      kind: "answer",
      text: answerText,
      spokenReply,
      sources,
      links,
      actions: actions.slice(0, 3),
      ...(focusTopicId ? { focusTopicId } : {}),
      ...(clientEffect ? { clientEffect } : {}),
      ...(proposal ? { proposal } : {}),
      ...(clearedProposal ? { clearedProposal: true } : {}),
      ...(executedAction ? { executedAction } : {}),
      mood,
      usedModel,
      trace,
    };
  }

  async cardAction(id, { type, until, reason, message } = {}) {
    if (!["continue", "harvest", "snooze", "park", "done", "dismiss", "retry"].includes(type)) throw error("不支持的任务动作");
    if (type === "snooze" && (!timestamp(until) || timestamp(until) <= this.now())) throw error("稍后时间必须在未来");
    const overview = await this.getOverview();
    const subject = cardSubject(id);
    const cards = [...topicsOf(overview).flatMap((t) => t.assistantSignals?.cards || []), ...(overview.assistantInbox?.cards || [])];
    // The card may have changed type or already been hidden since the client
    // rendered it; bookkeeping actions still apply to the same subject.
    let card = cards.find((c) => c.id === id) || cards.find((c) => cardSubject(c.id) === subject);
    const ticketId = card?.ticketId || subject.match(/^ticket:(.+)$/)?.[1] || "";
    const ticket = ticketId ? (await this.#allTickets())[ticketId] : null;
    if (!card && ticket) card = { id, ticketId, threadId: ticket.threadIds.at(-1), title: ticket.title, goal: ticket.goal, criteria: ticket.criteria, line: ticket.goal };
    if (!card && /^auto:./.test(subject)) card = { id, taskKey: subject.slice(5) };
    if (!card && !subject.includes(":wip:") && ["continue", "harvest"].includes(type)) card = { id, threadId: subject };
    if (!card && !/^(alert|harvest|ruin):./.test(id)) throw error("任务不存在或已处理", 404);
    if (!card) card = { id };
    if (["continue", "harvest"].includes(type) && !card.threadId) throw error("该任务没有原工位");
    if (type === "retry") {
      if (!card.taskKey) throw error("这张卡不是定时任务");
      if (typeof this.automations?.run !== "function") throw error("定时任务暂不可重试", 409);
      await this.automations.run(card.taskKey);
      this.#automationCache = null;
    }
    let queued = false;
    if (type === "continue") {
      const allThreads = [...topicsOf(overview).flatMap(threadsOfTopic), ...(overview.unassignedActive || [])];
      const targetThread = allThreads.find((t) => t.id === card.threadId);
      const criteria = ticket?.criteria || [];
      // A 任务 with acceptance criteria continues as a goal: the session keeps
      // going until it can show each criterion met.
      const text = ticket
        ? [message ? String(message) : `继续推进任务「${ticket.title}」。${card.line ? `当前记录：${card.line}` : ""}`, ticket.goal ? `任务目标：${ticket.goal}` : "",
          criteria.length ? `验收标准：\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n逐条做到并给出实证（命令输出、测试结果或可打开的产物）后再结束。` : ""].filter(Boolean).join("\n")
        : String(message || `继续上次的工作。当前记录：${card.line}。请从原工位接着推进。`);
      if (targetThread?.live && typeof this.hub?.queueTurn === "function") {
        await this.hub.queueTurn({ threadId: card.threadId, text, ...(criteria.length ? { goalMode: true } : {}) });
        queued = true;
      } else {
        if (typeof this.hub?.sendTurn !== "function") throw error("原工位暂不可续做", 409);
        await this.hub.sendTurn({ threadId: card.threadId, text, ...(criteria.length ? { goalMode: true } : {}) });
        this.#tails.delete(card.threadId);
      }
    }
    // Accepting or closing a 工单's card settles the 工单 itself.
    if (ticket?.status === "open" && ["harvest", "done", "dismiss"].includes(type)) await this.updateTicket(ticket.id, { status: type === "dismiss" ? "dropped" : "done" });
    await this.store.update("card-state", (states) => ({ ...states, [subject]: { type, at: new Date(this.now()).toISOString(),
      ...(type === "snooze" ? { until: new Date(timestamp(until)).toISOString() } : {}), ...(reason ? { reason: String(reason).slice(0, 500) } : {}) } }));
    return { ok: true, card, ...(card.threadId ? { threadId: card.threadId } : {}), ...(queued ? { queued: true } : {}) };
  }

  async tour({ since = "" } = {}) {
    if (since && !timestamp(since)) throw error("since 必须是有效时间");
    const overview = await this.getOverview();
    const stops = [];
    for (const topic of topicsOf(overview)) {
      const cards = (topic.assistantSignals?.cards || []).filter((c) => !since || timestamp(c.since) > timestamp(since));
      if (!cards.length) continue;
      const mark = SIGNAL_TYPES.find((type) => cards.some((c) => c.type === type));
      stops.push({ topicId: topic.id, topicTitle: topic.name, mark,
        bubble: tourBubble(topic.name, mark === "alert" ? "等你拍板" : mark === "harvest" ? "有成品待验收" : "有任务久未推进"), cards });
    }
    const inbox = (overview.assistantInbox?.cards || []).filter((c) => !since || timestamp(c.since) > timestamp(since));
    if (inbox.length) {
      const mark = SIGNAL_TYPES.find((type) => inbox.some((c) => c.type === type));
      stops.push({ topicId: "", topicTitle: "定时任务", mark, bubble: tourBubble("定时任务", mark === "alert" ? "有任务没跑成" : mark === "harvest" ? "有结果待验收" : "有任务久未推进"), cards: inbox });
    }
    stops.sort((a, b) => SIGNAL_TYPES.indexOf(a.mark) - SIGNAL_TYPES.indexOf(b.mark)
      || Math.min(...a.cards.filter((c) => c.type === a.mark).map((c) => timestamp(c.since))) - Math.min(...b.cards.filter((c) => c.type === b.mark).map((c) => timestamp(c.since))));
    return { generatedAt: new Date(this.now()).toISOString(), badges: overview.assistantBadges, stops: stops.slice(0, 5), more: Math.max(0, stops.length - 5) };
  }
}
