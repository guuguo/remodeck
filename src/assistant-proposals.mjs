import { randomUUID } from "node:crypto";
import { shortText } from "./assistant-signals.mjs";
import { cleanTaskCriteria } from "./task-store.mjs";

const ASSISTANT_PROVIDERS = new Set(["codex", "claude", "antigravity", "grok", "qoder"]);
const topicsOf = (overview) => (overview?.domains || []).flatMap((d) => d.topics || []);
const threadsOfTopic = (topic) => [...(topic?.activeThreads || []), ...(topic?.archivedThreads || [])];
const error = (message, status = 400) => Object.assign(new Error(message), { status });

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

export function normalizeAssistantProvider(value) {
  const lower = String(value || "").trim().toLowerCase();
  if (!lower || lower === "auto") return "";
  if (lower === "agy") return "antigravity";
  return ASSISTANT_PROVIDERS.has(lower) ? lower : "";
}

export function resolveAssistantDispatchAgent(rawAgentKey, availableProfiles = []) {
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

/**
 * Owns risk classification, pending proposal cache, action validation, dispatch enrichment,
 * and execution of confirmed/auto-executed assistant actions.
 */
export class AssistantProposalManager {
  #proposals = new Map();
  #proposalTtlMs;
  #ctx;

  constructor({ proposalTtlMs = 60_000, ...ctx } = {}) {
    this.#proposalTtlMs = Math.max(5_000, Number(proposalTtlMs) || 60_000);
    this.#ctx = ctx;
  }

  pruneProposals() {
    const t = this.#ctx.now();
    for (const [id, entry] of this.#proposals.entries()) {
      if (!entry || entry.expiresAt <= t) this.#proposals.delete(id);
    }
    while (this.#proposals.size > 200) {
      const oldest = this.#proposals.keys().next().value;
      if (!oldest) break;
      this.#proposals.delete(oldest);
    }
  }

  registerProposal(proposal, { callKey = "" } = {}) {
    if (!proposal || !proposal.intent) return null;
    this.pruneProposals();
    const cleanKey = String(callKey || "").trim();
    if (cleanKey) {
      for (const [oldId, oldEntry] of this.#proposals.entries()) {
        if (oldEntry.callKey === cleanKey) this.#proposals.delete(oldId);
      }
    }
    const id = String(proposal.id || `act_${randomUUID().slice(0, 8)}`).trim();
    const risk = proposal.risk || resolveActionRisk(proposal.intent, proposal.payload);
    const routesSummary = Array.isArray(proposal.routesSummary) && proposal.routesSummary.length ? proposal.routesSummary : null;
    const nowMs = this.#ctx.now();
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
    this.pruneProposals();
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
    this.pruneProposals();
    const id = String(proposalId || "").trim();
    const cleared = id ? this.#proposals.delete(id) : false;
    return { ok: true, cleared };
  }

  async draftDispatchCriteriaAsync(tasks = []) {
    const taskStore = this.#ctx.getTaskStore?.();
    const llm = this.#ctx.getLlm?.();
    if (!taskStore || typeof llm?.draftTicket !== "function") return;
    for (const tk of tasks) {
      try {
        const draft = await llm.draftTicket({
          title: tk.title,
          ask: tk.goal || tk.title,
          reply: "",
          background: true,
        });
        if (Array.isArray(draft?.criteria) && draft.criteria.length) {
          await taskStore.update(tk.id, { criteria: draft.criteria, actor: "assistant" });
          this.#ctx.notifyJudged?.();
        }
      } catch { /* best-effort background criteria drafting */ }
    }
  }

  async enrichDispatchProposal(proposal) {
    const dispatchImpl = this.#ctx.getDispatchImpl?.();
    if (!proposal || proposal.intent !== "dispatch" || typeof dispatchImpl !== "function") {
      return null;
    }
    const payload = proposal.payload || {};
    const preview = await dispatchImpl({
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

  validateAndBuildAction(parsed, overview, pendingRequests = [], availableProfiles = []) {
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
      const criteria = Array.isArray(action.criteria) ? cleanTaskCriteria(action.criteria) : undefined;
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
      const criteria = action.criteria !== undefined ? cleanTaskCriteria(action.criteria) : undefined;
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
      this.pruneProposals();
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

    const hub = this.#ctx.getHub?.();
    if (intent === "approve_request") {
      const pendingRequests = await Promise.resolve(hub?.allPendingRequests?.() || []);
      const req = pendingRequests.find((r) => r.id === data.requestId);
      if (!req) throw error("待拍板请求不存在或已处理", 404);
      const decision = data.decision === "decline" ? "decline" : "accept";
      if (typeof hub?.respondToRequest !== "function") throw error("当前不支持语音/助手审批", 409);
      await hub.respondToRequest(req.id, { decision });
      return { ok: true, intent, summary: decision === "accept" ? "已批准继续执行" : "已拒绝该请求", threadId: req.threadId || "" };
    }

    if (intent === "continue_thread") {
      const threadId = String(data.threadId || "").trim();
      if (!threadId) throw error("缺少工位 ID");
      const overview = await this.#ctx.getOverview();
      const allThreads = [...topicsOf(overview).flatMap(threadsOfTopic), ...(overview.unassignedActive || [])];
      const th = allThreads.find((t) => t.id === threadId);
      if (!th) throw error("工位不存在", 404);
      const message = String(data.message || "").trim() || "请从当前工位继续推进未完成工作。";
      if (data.cardId) {
        const res = await this.#ctx.cardAction(data.cardId, { type: "continue", message });
        return {
          ok: true,
          intent,
          ...(res.queued ? { queued: true } : {}),
          summary: res.queued ? "工位正在运行，已挂到下一轮排队执行" : "已发回原工位继续执行",
          threadId: res.threadId || threadId,
        };
      }
      if (th.live && typeof hub?.queueTurn === "function") {
        await hub.queueTurn({ threadId, text: message });
        return { ok: true, intent, queued: true, summary: "工位正在运行，已挂到下一轮排队执行", threadId };
      }
      if (typeof hub?.sendTurn !== "function") throw error("原工位暂不可续做", 409);
      await hub.sendTurn({ threadId, text: message });
      this.#ctx.clearThreadTail?.(threadId);
      return { ok: true, intent, summary: "已发回原工位继续执行", threadId };
    }

    if (intent === "interrupt_thread") {
      const threadId = String(data.threadId || "").trim();
      if (!threadId) throw error("缺少工位 ID");
      const overview = await this.#ctx.getOverview();
      const allThreads = [...topicsOf(overview).flatMap(threadsOfTopic), ...(overview.unassignedActive || [])];
      if (!allThreads.some((t) => t.id === threadId)) throw error("工位不存在", 404);
      if (typeof hub?.interrupt !== "function") throw error("当前不支持中断工位", 409);
      await hub.interrupt({ threadId });
      return { ok: true, intent, summary: "已发送中断指令", threadId };
    }

    if (intent === "pin_ticket") {
      const res = await this.#ctx.createTicket({
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
      const res = await this.#ctx.updateTicket(ticketId, {
        ...(data.goal !== undefined ? { goal: data.goal } : {}),
        ...(data.criteria !== undefined ? { criteria: data.criteria } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      });
      return { ok: true, intent, summary: `已更新任务「${res.ticket.title}」`, ticket: res.ticket };
    }

    if (intent === "dispatch") {
      const dispatchImpl = this.#ctx.getDispatchImpl?.();
      if (typeof dispatchImpl !== "function") throw error("派工通道暂不可用", 409);
      const instruction = String(data.instruction || "").trim();
      if (!instruction && (!Array.isArray(data.approvedRoutes) || !data.approvedRoutes.length)) {
        throw error("缺少派工指令");
      }
      const approvedRoutes = Array.isArray(data.approvedRoutes) && data.approvedRoutes.length ? data.approvedRoutes : null;
      const res = await dispatchImpl({
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
      const taskStore = this.#ctx.getTaskStore?.();
      if (dispatched.length) {
        for (const item of dispatched) {
          if (item?.threadId) this.#ctx.rememberDispatchedThread?.(item.threadId);
        }
        if (taskStore) {
          let parentId = "";
          if (dispatched.length > 1) {
            const parent = await taskStore.create({
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
            const createdTask = await taskStore.create({
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
              if (tid) await hub?.setThreadTask?.(tid, createdTask.id).catch(() => {});
            }
          }
          if (leafTasks.length) {
            void this.draftDispatchCriteriaAsync(leafTasks);
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
}
