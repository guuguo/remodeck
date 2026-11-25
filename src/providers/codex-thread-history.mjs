import { open, stat } from "node:fs/promises";
import {
  collapseSilentHeartbeatTurns,
  normalizeCodexAgentMessageItem,
  normalizeCodexUserMessageItem,
} from "../codex-input-clean.mjs";
import { decodeTailCursor, readLargeThreadPreview } from "./codex-large-preview.mjs";

export const LARGE_THREAD_BYTES = 2 * 1024 * 1024;
const ACTIVITY_SCAN_BYTES = 256 * 1024;

function parseTurnRolloutMeta(chunk) {
  const times = new Map();
  const contexts = new Map();
  for (const line of chunk.split("\n")) {
    const hasStarted = line.includes('"task_started"');
    const hasContext = line.includes('"turn_context"');
    if (!hasStarted && !hasContext) continue;
    try {
      const record = JSON.parse(line);
      const payload = record?.payload;
      if (!payload || typeof payload !== "object") continue;
      if (hasStarted && record?.type === "event_msg" && payload.type === "task_started" && payload.turn_id) {
        const startedAt = Number(payload.started_at) || Math.floor(Date.parse(record.timestamp || "") / 1000);
        if (Number.isFinite(startedAt) && startedAt > 0) times.set(payload.turn_id, startedAt);
      } else if (hasContext && record?.type === "turn_context" && payload.turn_id) {
        const model = String(payload.model || "").trim();
        const effort = String(payload.effort || payload.reasoning_effort || "").trim().toLowerCase();
        if (model || effort) {
          contexts.set(payload.turn_id, { model, effort });
        }
      }
    } catch {
      // Ignore malformed trailing lines.
    }
  }
  return { times, contexts };
}

export async function readRecentRolloutTurnMeta(rolloutPath, maxBytes = ACTIVITY_SCAN_BYTES) {
  if (!rolloutPath) return { times: new Map(), contexts: new Map() };
  let file;
  try {
    file = await open(rolloutPath, "r");
    const { size } = await file.stat();
    const start = Math.max(0, size - maxBytes);
    const buf = Buffer.allocUnsafe(size - start);
    if (buf.length) await file.read(buf, 0, buf.length, start);
    return parseTurnRolloutMeta(buf.toString("utf8"));
  } catch {
    return { times: new Map(), contexts: new Map() };
  } finally {
    await file?.close().catch(() => {});
  }
}

export async function readRecentRolloutTurnTimes(rolloutPath, maxBytes = ACTIVITY_SCAN_BYTES) {
  const meta = await readRecentRolloutTurnMeta(rolloutPath, maxBytes);
  return meta.times;
}

function normalizeCodexTurns(turns = [], automationNames = null) {
  if (!Array.isArray(turns)) return turns;
  return turns.map((turn, idx) => {
    if (!turn || !Array.isArray(turn.items)) {
      return turn ? { ...turn, _sourceIndex: idx } : turn;
    }
    return {
      ...turn,
      _sourceIndex: idx,
      items: turn.items.map((item) => {
        if (item?.type === "userMessage") {
          return normalizeCodexUserMessageItem(item, { automationNames });
        }
        if (item?.type === "agentMessage") {
          return normalizeCodexAgentMessageItem(item, { automationNames });
        }
        if (item?.type === "Extension" || item?.type === "extension") {
          const rawDuration = Number(item.durationMs ?? item.duration_ms);
          const durationMs = Number.isFinite(rawDuration) && rawDuration > 0 ? rawDuration : null;
          return {
            type: "mcpToolCall",
            id: item.id || "",
            status: item.status || "completed",
            tool: item.kind || item.tool || "extension",
            ...(durationMs ? { durationMs, arguments: { duration_ms: durationMs } } : {}),
          };
        }
        return item;
      }),
    };
  });
}

function stripTurnSourceIndexes(turns = []) {
  return turns.map((turn) => {
    if (!turn || typeof turn !== "object") return turn;
    const { _sourceIndex: _si, _firstSourceIndex: _fsi, ...cleanTurn } = turn;
    return cleanTurn;
  });
}

export async function loadCodexThreadHistory({
  client = null,
  getClient = null,
  rawId,
  indexedThread = null,
  cursor = null,
  detail = "auto",
  limit = 12,
  largeBytesThreshold = LARGE_THREAD_BYTES,
  automationNames = null,
} = {}) {
  const rolloutPath = indexedThread?.rolloutPath || indexedThread?.path || "";
  let fileSize = 0;
  if (rolloutPath) {
    try {
      fileSize = (await stat(rolloutPath)).size;
    } catch {
      fileSize = 0;
    }
  }

  const endOffset = cursor ? decodeTailCursor(cursor) : null;
  const forcePreview = Boolean(endOffset !== null) || (detail !== "full" && fileSize >= largeBytesThreshold);

  if (forcePreview && rolloutPath && fileSize > 0) {
    const preview = await readLargeThreadPreview(rolloutPath, {
      endOffset,
      limit,
      automationNames,
    });
    const baseThread = indexedThread || {
      id: rawId,
      preview: "",
      cwd: "",
      createdAt: 0,
      updatedAt: 0,
      model: "",
      reasoningEffort: "",
    };
    return {
      thread: {
        ...baseThread,
        id: rawId,
        turns: stripTurnSourceIndexes(preview.turns),
        largeHistory: true,
      },
      nextCursor: preview.nextCursor,
    };
  }

  const activeClient = client || (typeof getClient === "function" ? await getClient() : null);
  if (!activeClient) {
    throw new Error("Codex 客户端不可用");
  }
  const [result, preloadedMeta] = await Promise.all([
    activeClient.request("thread/read", {
      threadId: rawId,
      includeTurns: true,
    }),
    rolloutPath ? readRecentRolloutTurnMeta(rolloutPath) : Promise.resolve(null),
  ]);
  const thread = result?.thread || result || { id: rawId, turns: [] };
  if (Array.isArray(thread.turns)) {
    thread.turns = normalizeCodexTurns(thread.turns, automationNames);
  }
  const resolvedRolloutPath = thread.path || thread.rolloutPath || rolloutPath;
  if (Array.isArray(thread.turns) && resolvedRolloutPath) {
    const meta = (preloadedMeta && resolvedRolloutPath === rolloutPath)
      ? preloadedMeta
      : await readRecentRolloutTurnMeta(resolvedRolloutPath);
    for (const turn of thread.turns) {
      if (!turn.startedAt && meta.times.has(turn.id)) {
        turn.startedAt = meta.times.get(turn.id);
      }
      const ctx = meta.contexts.get(turn.id);
      if (ctx) {
        if (!turn.model && ctx.model) turn.model = ctx.model;
        if (!turn.effort && ctx.effort) turn.effort = ctx.effort;
      }
    }
  }
  if (detail !== "full" && Array.isArray(thread.turns)) {
    const allTurns = thread.turns;
    let end = allTurns.length;
    if (typeof cursor === "string" && cursor.startsWith("turn:")) {
      const parsedEnd = Number(cursor.slice(5));
      if (Number.isFinite(parsedEnd)) {
        end = Math.min(allTurns.length, Math.max(0, Math.trunc(parsedEnd)));
      }
    }
    const collapsed = collapseSilentHeartbeatTurns(allTurns.slice(0, end));
    const lim = Math.max(1, Number(limit) || 12);
    if (end < allTurns.length || collapsed.length > lim || collapsed.length !== end) {
      const startCollapsed = Math.max(0, collapsed.length - lim);
      const sliced = collapsed.slice(startCollapsed);
      const firstSourceIdx = Number.isInteger(sliced[0]?._firstSourceIndex)
        ? sliced[0]._firstSourceIndex
        : (Number.isInteger(sliced[0]?._sourceIndex) ? sliced[0]._sourceIndex : startCollapsed);
      const hasOlder = firstSourceIdx > 0;
      return {
        thread: {
          ...thread,
          turns: stripTurnSourceIndexes(sliced),
          ...(hasOlder ? { largeHistory: true } : {}),
        },
        nextCursor: hasOlder ? `turn:${firstSourceIdx}` : null,
      };
    }
    thread.turns = stripTurnSourceIndexes(collapsed);
  } else if (Array.isArray(thread.turns)) {
    thread.turns = stripTurnSourceIndexes(thread.turns);
  }
  return {
    thread,
    nextCursor: null,
  };
}
