import { MemoryVault, resolveVaultPath } from "./memory-vault.mjs";
import { AssistantLLM } from "./assistant-llm.mjs";
import { AssistantStore } from "./assistant-store.mjs";
import { computeTopicSignals, SIGNAL_TYPES, shortText, timestamp, isoTime, threadTail, threadSource } from "./assistant-signals.mjs";

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

export class AssistantService {
  #tails = new Map();
  #reading = new Set();
  constructor({ hub, getOverview, dataDir, env = process.env, now = () => Date.now(), vault = null, llm = null, llmOptions = {}, evidenceBudgetMs = 1500 } = {}) {
    this.hub = hub;
    this.getOverview = getOverview;
    this.dataDir = dataDir;
    this.env = env;
    this.now = now;
    this.vault = vault;
    this.evidenceBudgetMs = evidenceBudgetMs;
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
            this.#tails.set(t.id, { fingerprint: fingerprintOf(t), tail: threadTail(result?.thread || {}), lastError: result?.thread?.lastError || "" });
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
    return visible.map((t) => {
      if (!needsRead(t)) { this.#tails.delete(t.id); return t; }
      const cached = this.#tails.get(t.id);
      return cached?.fingerprint === fingerprintOf(t) ? { ...t, assistantTail: cached.tail, lastError: t.lastError || cached.lastError } : t;
    });
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

  async decorateOverview(overview) {
    const topics = topicsOf(overview);
    const [cardState, idleWip] = await Promise.all([this.store.read("card-state"), this.idleWip(topics)]);
    const badges = { alert: 0, harvest: 0, ruin: 0 };
    for (const topic of topics) {
      topic.assistantSignals = computeTopicSignals(topic, { now: this.now(), cardState, idleWip });
      for (const type of SIGNAL_TYPES) badges[type] += topic.assistantSignals.counts[type];
    }
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
    if (!matched.length && /忘了什么|有哪些|全园|巡园|待拍板|待收菜|有什么没做完|你好|早上好/.test(text)) return { global: true };
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
      const key = `${source.kind}:${source.threadId || source.sha || source.path || source.topicId}`;
      if (keys.has(key)) return;
      keys.add(key); records.push({ source, text: shortText(body || source.label, 300) });
    };
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
    const cards = selected.flatMap((t) => t.assistantSignals?.cards || []).sort((a, b) => SIGNAL_TYPES.indexOf(a.type) - SIGNAL_TYPES.indexOf(b.type) || timestamp(a.since) - timestamp(b.since));
    const first = cards[0];
    let conclusion = first ? `${topic?.name || selected.find((t) => t.id === first.topicId)?.name}：${first.line}`
      : topic?.summary?.progress ? `${topic.name}：${shortText(topic.summary.progress, 220)}` : topic ? `${topic.name}：现有记录不足以确认停在哪。` : `当前有 ${overview.assistantBadges?.alert || 0} 项待拍板、${overview.assistantBadges?.harvest || 0} 项待收菜、${overview.assistantBadges?.ruin || 0} 项久未推进。`;
    const conclusionSource = first ? sources.findIndex((s) => first.sources.some((fs) => fs.kind === s.kind && (fs.threadId ? fs.threadId === s.threadId : fs.path === s.path))) : sources.findIndex((s) => s.kind === "summary" && s.topicId === topic?.id);
    if (conclusionSource >= 0) conclusion += ` [S${conclusionSource + 1}]`;
    const evidenceLines = records.slice(0, 3).map((r, i) => `${r.source.label}：${shortText(r.text, 180)} [S${i + 1}]`);
    let answerText = [conclusion, ...evidenceLines].join("\n"), usedModel = false;
    // Unchanged single-topic progress and garden inventory are rule-answerable.
    if (topic && /上次|之前|历史|怎么解决|为什么/.test(text) && records.length) {
      let remaining = 5500;
      const evidence = { question: shortText(text, 300), sources: records.map((r, i) => {
        const body = shortText(r.text, Math.max(0, Math.min(300, remaining)));
        remaining -= Array.from(body).length;
        return { id: `S${i + 1}`, label: shortText(r.source.label, 60), text: body };
      }) };
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
    if (!["continue", "harvest", "snooze", "park", "done", "dismiss"].includes(type)) throw error("不支持的工单动作");
    if (type === "snooze" && (!timestamp(until) || timestamp(until) <= this.now())) throw error("稍后时间必须在未来");
    const overview = await this.getOverview();
    const card = topicsOf(overview).flatMap((t) => t.assistantSignals?.cards || []).find((c) => c.id === id);
    if (!card) throw error("工单不存在或已处理", 404);
    if (["continue", "harvest"].includes(type) && !card.threadId) throw error("该工单没有原工位");
    if (type === "continue") {
      if (typeof this.hub?.sendTurn !== "function") throw error("原工位暂不可续做", 409);
      await this.hub.sendTurn({ threadId: card.threadId, text: String(message || `继续上次的工作。当前记录：${card.line}。请从原工位接着推进。`) });
      this.#tails.delete(card.threadId);
    }
    await this.store.update("card-state", (states) => ({ ...states, [id]: { type, at: new Date(this.now()).toISOString(),
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
    stops.sort((a, b) => SIGNAL_TYPES.indexOf(a.mark) - SIGNAL_TYPES.indexOf(b.mark)
      || Math.min(...a.cards.filter((c) => c.type === a.mark).map((c) => timestamp(c.since))) - Math.min(...b.cards.filter((c) => c.type === b.mark).map((c) => timestamp(c.since))));
    return { generatedAt: new Date(this.now()).toISOString(), badges: overview.assistantBadges, stops: stops.slice(0, 5), more: Math.max(0, stops.length - 5) };
  }
}
