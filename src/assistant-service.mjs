import { MemoryVault, resolveVaultPath } from "./memory-vault.mjs";
import { AssistantLLM } from "./assistant-llm.mjs";
import { AssistantStore } from "./assistant-store.mjs";
import { createHash, randomUUID } from "node:crypto";
import { normalizeWorkspacePath } from "./platform.mjs";
import { computeTopicSignals, cardSubject, SIGNAL_TYPES, shortText, timestamp, isoTime, threadTail, threadSource, judgeInputOf, automationFailureCard, isCardHandled } from "./assistant-signals.mjs";

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
const TICKET_STATUSES = ["open", "done", "dropped"];
const threadsOfTopic = (topic) => [...(topic.activeThreads || []), ...(topic.archivedThreads || [])];
const criteriaKey = (criteria = []) => criteria.length ? `#${createHash("sha256").update(criteria.join("\n")).digest("hex").slice(0, 12)}` : "";
function cleanCriteria(value) {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n+|[；;]/) : null;
  if (!list || list.some((c) => typeof c !== "string")) throw error("验收标准必须是文本列表");
  const out = list.map((c) => shortText(c.replace(/^\s*(?:\d+[.、)]|[-*•])\s*/, ""), 120)).filter(Boolean);
  if (out.length > 8) throw error("验收标准最多 8 条");
  return out;
}
const underPath = (cwd, root) => Boolean(cwd && root && (cwd === root || cwd.startsWith(`${root.replace(/\/+$/, "")}/`)));

// What the park shows for a 工单: where its latest session stands.
function ticketView(ticket, threads, now) {
  const linked = threads.filter((t) => ticket.threadIds.includes(t.id)).sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt));
  const latest = linked[0], tail = latest ? latest.assistantTail || threadTail(latest) : null;
  let state = "idle", line = "等工位交付后验收";
  if (!latest) { state = "lost"; line = "暂时找不到关联工位"; }
  else if (latest.pendingCount > 0) { state = "waiting"; line = "工位等你拍板"; }
  else if (latest.live) { state = "running"; line = "工位正在做"; }
  else if (latest.lastError || latest.lastTurnStatus === "failed") { state = "failed"; line = "上一轮出错了"; }
  else if (tail?.judgedBy === "model" && tail.evidence) { state = "passed"; line = `验收通过：${tail.evidence}`; }
  else if (tail?.missing) { state = "missing"; line = `还差：${tail.missing}`; }
  else if (tail?.asking) { state = "asking"; line = `等你回复：${tail.question || "工位在问你"}`; }
  const at = Math.max(timestamp(ticket.updatedAt), ...linked.map((t) => timestamp(t.updatedAt)));
  if (["idle", "missing"].includes(state) && at && now - at >= 3 * 86_400_000) line = `停了 ${Math.floor((now - at) / 86_400_000)} 天 · ${line}`;
  return { id: ticket.id, title: ticket.title, goal: ticket.goal, criteria: ticket.criteria, status: ticket.status, state, line: shortText(line, 60),
    threadIds: ticket.threadIds, ...(latest ? { threadId: latest.id } : {}), createdAt: ticket.createdAt, updatedAt: isoTime(at) || ticket.updatedAt };
}

export class AssistantService {
  #tails = new Map();
  #reading = new Set();
  #judgments = null;
  #judgeQueue = [];
  #judgeFailures = new Map();
  #judging = 0;
  #judgedTimer = null;
  #tickets = null;
  #judgeInFlight = new Set();
  // `automations` ({ list, run }) is attached by the host once the scheduler exists.
  constructor({ hub, getOverview, dataDir, env = process.env, now = () => Date.now(), vault = null, llm = null, llmOptions = {}, evidenceBudgetMs = 1500, onJudged = null, automations = null } = {}) {
    this.hub = hub;
    this.getOverview = getOverview;
    this.dataDir = dataDir;
    this.env = env;
    this.now = now;
    this.vault = vault;
    this.evidenceBudgetMs = evidenceBudgetMs;
    this.onJudged = onJudged;
    this.automations = automations;
    this.store = new AssistantStore(dataDir);
    this.llm = llm || new AssistantLLM({ dataDir, now, store: this.store, ...llmOptions });
  }

  async memoryVault() {
    if (this.vault) return this.vault;
    const root = await resolveVaultPath({ dataDir: this.dataDir, env: this.env });
    return root ? new MemoryVault(root, { now: () => new Date(this.now()) }) : null;
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
    const wips = await vault.listWip({ status: "active" });
    const out = [];
    for (const wip of wips) {
      if (!timestamp(wip.updated) || this.now() - timestamp(wip.updated) < 7 * 86_400_000) continue;
      const note = await vault.tryRead(wip.rel);
      const scope = note?.meta?.scope;
      const topic = topics.find((t) => scope && [t.id, t.memoryScope].includes(scope));
      if (topic) out.push({ ...wip, topicId: topic.id });
    }
    return out;
  }

  // ---- 工单: sessions pinned as persistent work items ----
  async #allTickets() {
    if (!this.#tickets) this.#tickets = await this.store.read("tickets", {}).catch(() => ({}));
    return this.#tickets;
  }

  async openTickets() {
    return Object.values(await this.#allTickets()).filter((t) => t.status === "open");
  }

  async #saveTicket(ticket) {
    this.#tickets = await this.store.update("tickets", (all) => ({ ...all, [ticket.id]: ticket }), {});
    return ticket;
  }

  async listTickets({ status = "open" } = {}) {
    const all = Object.values(await this.#allTickets()).filter((t) => status === "all" || t.status === status);
    const overview = await this.getOverview();
    const views = new Map((overview.assistantTickets || []).map((v) => [v.id, v]));
    return { tickets: all.sort((a, b) => timestamp(b.updatedAt) - timestamp(a.updatedAt)).map((t) => views.get(t.id) || t) };
  }

  async createTicket({ threadId, title, goal, criteria } = {}) {
    if (typeof threadId !== "string" || !threadId) throw error("需要要钉成工单的工位");
    const existing = (await this.openTickets()).find((t) => t.threadIds.includes(threadId));
    if (existing) return { ok: true, existed: true, ticket: existing };
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
    const at = new Date(this.now()).toISOString();
    const ticket = { id: `tk_${randomUUID().slice(0, 8)}`, title: shortText(title || draft?.title || thread.title || input.title || "未命名工单", 40),
      goal: shortText(goal ?? draft?.goal ?? input.ask ?? "", 200), criteria: criteria !== undefined ? cleanCriteria(criteria) : draft?.criteria || [],
      topicId: topic?.id || "", threadIds: [threadId], status: "open", draftedBy: draft ? "model" : "", createdAt: at, updatedAt: at };
    await this.#saveTicket(ticket);
    this.#notifyJudged();
    return { ok: true, ticket };
  }

  async updateTicket(id, { title, goal, criteria, status, addThreadId } = {}) {
    const ticket = (await this.#allTickets())[id];
    if (!ticket) throw error("工单不存在", 404);
    if (status !== undefined && !TICKET_STATUSES.includes(status)) throw error("工单状态只能是 open/done/dropped");
    const at = new Date(this.now()).toISOString();
    const next = { ...ticket, ...(title !== undefined ? { title: shortText(title, 40) || ticket.title } : {}),
      ...(goal !== undefined ? { goal: shortText(goal, 200) } : {}), ...(criteria !== undefined ? { criteria: cleanCriteria(criteria) } : {}),
      ...(typeof addThreadId === "string" && addThreadId && !ticket.threadIds.includes(addThreadId) ? { threadIds: [...ticket.threadIds, addThreadId] } : {}),
      ...(status !== undefined ? { status, ...(status === "open" ? { closedAt: undefined } : { closedAt: at }) } : {}), updatedAt: at };
    await this.#saveTicket(next);
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
    overview.assistantTickets = [...topics.flatMap((t) => (t.assistantTickets || []).map((v) => ({ ...v, topicId: t.id, topicName: t.name }))),
      ...tickets.filter((tk) => !ticketTopic.get(tk.id)).map((tk) => ({ ...ticketView(tk, overview.unassignedActive || [], now), topicId: "", topicName: "" }))];
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

  async ask(input = {}, { onTrace = () => {} } = {}) {
    if (typeof input.text !== "string") throw error("text 必须是问题文本");
    const text = String(input.text || "").trim();
    if (!text || text.length > 4000) throw error("问题不能为空且不超过 4000 字");
    if (input.history && (!Array.isArray(input.history) || input.history.length > 6 || input.history.some((h) => !["user", "assistant"].includes(h.role) || typeof h.text !== "string" || h.text.length > 4000))) throw error("history 最多 6 条 user/assistant 消息");
    if (input.focus && (!Array.isArray(input.focus) || input.focus.some((id) => typeof id !== "string"))) throw error("focus 必须是产线 ID 数组");
    const overview = await this.getOverview();
    const topics = topicsOf(overview), profile = await this.profile();
    const resolved = this.resolve(text, topics, profile, input);
    const trace = [];
    const emit = async (step, label, count) => { const item = { step, label, count }; trace.push(item); await onTrace(item); };
    await emit("resolve", resolved.topic ? `认出你说的是「${resolved.topic.name}」` : resolved.global ? "查看全园信号" : "需要确认你说的产线", resolved.topic ? 1 : 0);
    if (resolved.candidates) {
      const candidates = resolved.candidates.map((t) => ({ topicId: t.id, title: t.name }));
      return { kind: "clarify", text: candidates.length ? `你说的是${candidates.map((c) => `「${c.title}」`).join("还是")}？\n（未经模型整理）` : "还没有可查询的产线。\n（未经模型整理）",
        sources: [], actions: candidates.map((c) => ({ label: c.title, type: "clarify_pick", payload: { alias: subjectOf(text), topicId: c.topicId } })), candidates, usedModel: false, mood: "waiting", trace };
    }
    const topic = resolved.topic, selected = topic ? [topic] : topics;
    const records = [], keys = new Set();
    const add = (source, body) => {
      const key = `${source.kind}:${source.ticketId || source.threadId || source.sha || source.path || source.topicId}`;
      if (keys.has(key)) return;
      keys.add(key); records.push({ source, text: shortText(body || source.label, 300) });
    };
    // Pinned 工单 come first: they are what the user said matters.
    for (const tk of (overview.assistantTickets || []).filter((v) => !topic || v.topicId === topic.id).slice(0, 6)) {
      add({ kind: "ticket", label: shortText(`工单·${tk.title}`, 60), ticketId: tk.id, ...(tk.topicId ? { topicId: tk.topicId } : {}), ...(tk.threadId ? { threadId: tk.threadId } : {}), ...(isoTime(tk.updatedAt) ? { at: isoTime(tk.updatedAt) } : {}) },
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
    if (typeof this.hub?.searchThreads === "function") {
      const query = /上次|之前|历史|怎么解决/.test(text) ? subjectOf(text) : (topic?.name || text);
      const result = await this.hub.searchThreads({ query, cwd: topic?.primaryCwd || "", archived: "all", limit: 8 }).catch(() => ({ threads: [] }));
      for (const th of (result.threads || []).filter((t) => !t.internal).slice(0, 8)) add(threadSource(th, topic?.id || th.topicId), th.searchMatch?.matchSnippet || threadTail(th)?.text || th.preview);
    }
    const emitKind = async (step, kind, label) => { const count = records.filter((r) => r.source.kind === kind).length; if (count) await emit(step, `${label} ${count} 条`, count); };
    await emitKind("tickets", "ticket", "对了工单");
    await emitKind("threads", "thread", "翻了相关工位");
    for (const t of selected) for (const commit of (t.gitSnapshot?.commits || []).slice(0, 3)) {
      const sha = typeof commit === "string" ? commit.match(/^[a-f0-9]+/i)?.[0] : commit.sha;
      if (sha) add({ kind: "commit", label: `提交 ${sha.slice(0, 8)}`, sha, topicId: t.id, path: t.gitSnapshot.cwd || t.primaryCwd }, typeof commit === "string" ? commit : commit.message);
    }
    await emitKind("commits", "commit", "看了提交");
    for (const t of selected) for (const card of t.assistantSignals?.cards || []) for (const source of card.sources.filter((s) => s.kind === "wip")) add(source, card.line);
    await emitKind("wip", "wip", "查到任务卡");
    const vault = await this.memoryVault();
    if (vault) {
      const hits = await vault.search(subjectOf(text), { scope: topic?.memoryScope || topic?.id || "", limit: 8 });
      for (const hit of hits) {
        const kind = hit.kind === "wip" ? "wip" : "memory";
        // WIP evidence is collected before its trace; other task-card hits are
        // already represented by idleWip and are not relabelled as memories.
        if (kind === "wip") continue;
        add({ kind, label: `记忆·${shortText(hit.rel, 48)}`, path: hit.rel, ...(topic ? { topicId: topic.id } : {}) }, hit.snippet);
      }
    }
    await emitKind("memory", "memory", "查到记忆");
    await emit("compose", "依据出处整理回答", records.length);
    const sources = records.map((r) => r.source);
    const cards = [...selected.flatMap((t) => t.assistantSignals?.cards || []), ...(topic ? [] : overview.assistantInbox?.cards || [])].sort((a, b) => SIGNAL_TYPES.indexOf(a.type) - SIGNAL_TYPES.indexOf(b.type) || timestamp(a.since) - timestamp(b.since));
    const first = cards[0];
    let conclusion = first ? `${topic?.name || selected.find((t) => t.id === first.topicId)?.name}：${first.line}`
      : topic?.summary?.progress ? `${topic.name}：${shortText(topic.summary.progress, 220)}` : topic ? `${topic.name}：现有记录不足以确认停在哪。` : `当前有 ${overview.assistantBadges?.alert || 0} 项待拍板、${overview.assistantBadges?.harvest || 0} 项待收菜、${overview.assistantBadges?.ruin || 0} 项久未推进。`;
    const conclusionSource = first ? sources.findIndex((s) => first.sources.some((fs) => fs.kind === s.kind && (fs.threadId ? fs.threadId === s.threadId : fs.path === s.path))) : sources.findIndex((s) => s.kind === "summary" && s.topicId === topic?.id);
    if (conclusionSource >= 0) conclusion += ` [S${conclusionSource + 1}]`;
    const evidenceLines = records.slice(0, 3).map((r, i) => `${r.source.label}：${shortText(r.text, 180)} [S${i + 1}]`);
    let answerText = [conclusion, ...evidenceLines].join("\n"), usedModel = false;
    // Every answer with evidence goes through the model; the template above is
    // the fallback when no model channel answers or the reply is ungrounded.
    if (records.length) {
      let remaining = 5500;
      const evidence = { question: shortText(text, 300), sources: records.map((r, i) => {
        const body = shortText(r.text, Math.max(0, Math.min(300, remaining)));
        remaining -= Array.from(body).length;
        return { id: `S${i + 1}`, label: shortText(r.source.label, 60), text: body };
      }) };
      // Earlier turns let the model follow「它」「然后呢」; they are not sources.
      const conversation = (input.history || []).slice(-4).map((h) => ({ role: h.role, text: shortText(h.text, 200) })).filter((h) => h.text);
      if (conversation.length) evidence.conversation = conversation;
      const composed = await this.llm.complete({ evidence });
      if (composed) { answerText = composed; usedModel = true; }
    }
    if (!usedModel) answerText += "\n（未经模型整理）";
    const actions = [];
    if (topic) actions.push({ label: "查看产线", type: "focus", payload: { topicId: topic.id } });
    const thread = sources.find((s) => s.threadId);
    if (thread) actions.push({ label: "打开工位", type: "open_thread", payload: { threadId: thread.threadId } });
    if (first) actions.push({ label: first.type === "harvest" ? "收菜" : first.threadId ? "续做" : "稍后", type: "card_action",
      payload: { cardId: first.id, action: first.type === "harvest" ? "harvest" : first.threadId ? "continue" : "snooze" } });
    return { kind: "answer", text: answerText, sources, actions: actions.slice(0, 3), ...(topic ? { focusTopicId: topic.id } : {}),
      mood: first?.type === "harvest" ? "good" : first ? "worry" : "report", usedModel, trace };
  }

  async cardAction(id, { type, until, reason, message } = {}) {
    if (!["continue", "harvest", "snooze", "park", "done", "dismiss", "retry"].includes(type)) throw error("不支持的工单动作");
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
    if (!card && !/^(alert|harvest|ruin):./.test(id)) throw error("工单不存在或已处理", 404);
    if (!card) card = { id };
    if (["continue", "harvest"].includes(type) && !card.threadId) throw error("该工单没有原工位");
    if (type === "retry") {
      if (!card.taskKey) throw error("这张卡不是定时任务");
      if (typeof this.automations?.run !== "function") throw error("定时任务暂不可重试", 409);
      await this.automations.run(card.taskKey);
      this.#automationCache = null;
    }
    if (type === "continue") {
      if (typeof this.hub?.sendTurn !== "function") throw error("原工位暂不可续做", 409);
      const criteria = ticket?.criteria || [];
      // A 工单 with acceptance criteria continues as a goal: the session keeps
      // going until it can show each criterion met.
      const text = ticket
        ? [message ? String(message) : `继续推进工单「${ticket.title}」。${card.line ? `当前记录：${card.line}` : ""}`, ticket.goal ? `工单目标：${ticket.goal}` : "",
          criteria.length ? `验收标准：\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n逐条做到并给出实证（命令输出、测试结果或可打开的产物）后再结束。` : ""].filter(Boolean).join("\n")
        : String(message || `继续上次的工作。当前记录：${card.line}。请从原工位接着推进。`);
      await this.hub.sendTurn({ threadId: card.threadId, text, ...(criteria.length ? { goalMode: true } : {}) });
      this.#tails.delete(card.threadId);
    }
    // Accepting or closing a 工单's card settles the 工单 itself.
    if (ticket?.status === "open" && ["harvest", "done", "dismiss"].includes(type)) await this.updateTicket(ticket.id, { status: type === "dismiss" ? "dropped" : "done" });
    await this.store.update("card-state", (states) => ({ ...states, [subject]: { type, at: new Date(this.now()).toISOString(),
      ...(type === "snooze" ? { until: new Date(timestamp(until)).toISOString() } : {}), ...(reason ? { reason: String(reason).slice(0, 500) } : {}) } }));
    return { ok: true, card, ...(card.threadId ? { threadId: card.threadId } : {}) };
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
