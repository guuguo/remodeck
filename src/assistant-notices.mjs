import { randomUUID } from "node:crypto";
import { isInternalAssistantThread, shortText } from "./assistant-signals.mjs";

const topicsOf = (overview) => (overview?.domains || []).flatMap((d) => d.topics || []);
const threadsOfTopic = (topic) => [...(topic?.activeThreads || []), ...(topic?.archivedThreads || [])];

/**
 * Tracks assistant-dispatched threads, persists completion/failure notices on hub events,
 * and serves unread/voice-pending notification queries.
 */
export class AssistantNoticeTracker {
  #dispatchedThreads = new Set();
  #ctx;

  constructor(ctx = {}) {
    this.#ctx = ctx;
  }

  rememberDispatchedThread(threadId = "") {
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

  async handleHubEvent(eventName, payload = {}) {
    const dataDir = this.#ctx.getDataDir?.();
    if (!dataDir) return null;
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

    const hub = this.#ctx.getHub?.();
    const meta = hub?.listThreadsMeta?.() || {};
    if (meta[threadId]?.internal || isInternalAssistantThread({ id: threadId, title: evt.title, cwd: evt.cwd, internal: evt.internal })) {
      return null;
    }

    const openTickets = await (this.#ctx.openTickets?.() || Promise.resolve([])).catch(() => []);
    const matchedTicket = openTickets.find((tk) => Array.isArray(tk.threadIds) && tk.threadIds.includes(threadId)) || null;
    const wasDispatched = this.#dispatchedThreads.has(threadId);
    if (!wasDispatched && !matchedTicket) return null;

    let topicId = matchedTicket?.topicId || "";
    let topicName = "";
    let threadTitle = matchedTicket?.title || meta[threadId]?.customName || String(evt.title || "").trim();
    const getOverview = this.#ctx.getOverview;
    if (typeof getOverview === "function") {
      const overview = await Promise.resolve(getOverview()).catch(() => null);
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
      createdAt: new Date(this.#ctx.now()).toISOString(),
      deliveredVoiceAt: "",
      seenAt: "",
    };

    const store = this.#ctx.getStore?.();
    let inserted = false;
    await store.update("notices", (rawList) => {
      const list = Array.isArray(rawList) ? rawList : [];
      if (list.some((item) => item?.dedupeKey === dedupeKey)) return list;
      inserted = true;
      return [...list, entry].slice(-50);
    }, []);
    return inserted ? entry : null;
  }

  async popPendingVoiceNotices({ limit = 1 } = {}) {
    if (!this.#ctx.getDataDir?.()) return { notices: [], remainingCount: 0 };
    const cap = Math.max(0, Math.min(10, Number(limit) || 1));
    if (!cap) return { notices: [], remainingCount: 0 };
    const popped = [];
    let remainingCount = 0;
    const nowIso = new Date(this.#ctx.now()).toISOString();
    const store = this.#ctx.getStore?.();
    await store.update("notices", (rawList) => {
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
    if (!this.#ctx.getDataDir?.()) return { notices: [], unreadCount: 0 };
    const cap = Math.max(1, Math.min(50, Number(limit) || 10));
    const store = this.#ctx.getStore?.();
    const rawList = await store.read("notices", []);
    const list = Array.isArray(rawList) ? rawList : [];
    const unread = list.filter((n) => n && !n.seenAt);
    return { notices: unread.slice(-cap).reverse(), unreadCount: unread.length };
  }

  async ackNotices(ids = []) {
    if (!this.#ctx.getDataDir?.()) return { ok: true, updatedCount: 0 };
    const idSet = new Set((Array.isArray(ids) ? ids : []).map((x) => String(x || "").trim()).filter(Boolean));
    const nowIso = new Date(this.#ctx.now()).toISOString();
    let updatedCount = 0;
    const store = this.#ctx.getStore?.();
    await store.update("notices", (rawList) => {
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
}
