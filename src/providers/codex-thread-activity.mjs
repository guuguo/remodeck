import { open } from "node:fs/promises";

const MAX_TAIL_BYTES = 256 * 1024;
const CODEX_RUNNING_INFER_WINDOW_MS = 180_000;
const CODEX_STALE_RUNNING_GUARD_MS = 15 * 60 * 1000;

function extractReasoningSummaryText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.text === "string" && payload.text.trim()) return payload.text.trim();
  if (Array.isArray(payload.summary)) {
    const joined = payload.summary
      .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
      .filter(Boolean)
      .join(" ");
    if (joined) return joined;
  }
  return "";
}

function extractResponseMessageText(payload) {
  if (!payload || typeof payload !== "object") return "";
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message.trim();
  if (Array.isArray(payload.content)) {
    const joined = payload.content
      .map((part) => (typeof part?.text === "string" ? part.text.trim() : ""))
      .filter(Boolean)
      .join(" ");
    if (joined) return joined;
  }
  return "";
}

function formatCompactDurationMs(rawMs) {
  const ms = Number(rawMs);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSec = ms / 1000;
  if (totalSec < 60) {
    const rounded = Math.round(totalSec * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
  }
  const mins = Math.floor(totalSec / 60);
  const secs = Math.round(totalSec % 60);
  if (secs === 60) return `${mins + 1}m`;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function parseSleepDurationMs(rawArgs) {
  if (!rawArgs) return 0;
  let obj = rawArgs;
  if (typeof rawArgs === "string") {
    try {
      obj = JSON.parse(rawArgs);
    } catch {
      const m = rawArgs.match(/"(?:duration_ms|durationMs)"\s*:\s*(\d+)/);
      return m ? Number(m[1]) || 0 : 0;
    }
  }
  const val = Number(obj?.duration_ms ?? obj?.durationMs);
  return Number.isFinite(val) && val > 0 ? val : 0;
}

function phaseFromCompletedItem(item) {
  const itemType = String(item?.type || "");
  if (itemType === "Reasoning") return "思考中";
  if (itemType === "CommandExecution") return "执行命令";
  if (itemType === "AgentMessage") return "生成回复";
  if (itemType === "UserMessage") return "已收到指令";
  if (itemType === "Extension" && item?.kind === "clock.sleep") return "等待完成";
  return "Codex 执行中";
}

function summarizeRolloutActivity(lines, { mtimeMs = 0, nowMs = Date.now() } = {}) {
  let turnId = "";
  let status = "idle";
  let phase = "";
  let text = "";
  let updatedAt = 0;
  let sawExplicitStarted = false;
  let sawTerminal = false;
  let sawActivityAfterTerminal = false;
  let tailPhase = "";
  let tailText = "";

  for (const line of lines) {
    if (!line.trim()) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const ts = Math.floor((Date.parse(record?.timestamp || "") || Date.now()) / 1000);
    updatedAt = Math.max(updatedAt, ts);
    const payload = record?.payload || {};

    if (record?.type === "token_usage_record") {
      if (record.turn_id) turnId = record.turn_id;
      if (!sawTerminal) sawActivityAfterTerminal = true;
      continue;
    }

    if (record?.type === "response_item") {
      const pType = String(payload.type || "");
      if (!pType) continue;
      sawTerminal = false;
      sawActivityAfterTerminal = true;
      if (pType === "reasoning") {
        tailPhase = "思考中";
        const snippet = extractReasoningSummaryText(payload);
        tailText = snippet ? snippet.slice(-240) : "";
      } else if (pType === "function_call" || pType === "custom_tool_call") {
        const rawName = String(payload.name || "").trim();
        const rawNs = String(payload.namespace || "").trim();
        const fullName = rawName.includes(".") ? rawName : (rawNs ? `${rawNs}.${rawName}` : rawName);
        const rawArgs = typeof payload.input === "string"
          ? payload.input
          : (typeof payload.arguments === "string" ? payload.arguments : "");
        if (fullName === "clock.sleep" || (rawName === "sleep" && !rawNs)) {
          const durMs = parseSleepDurationMs(payload.arguments ?? payload.input);
          const durLabel = formatCompactDurationMs(durMs);
          const recordTsMs = Date.parse(record?.timestamp || "");
          let elapsedMs = Number.isFinite(recordTsMs) && nowMs > recordTsMs ? nowMs - recordTsMs : 0;
          if (durMs > 0 && elapsedMs > durMs) elapsedMs = durMs;
          const elapsedLabel = elapsedMs >= 1000 ? formatCompactDurationMs(elapsedMs) : "";
          tailPhase = durLabel ? `定时等待 ${durLabel}` : "定时等待中";
          tailText = elapsedLabel && durLabel
            ? `已等待 ${elapsedLabel} / ${durLabel}`
            : (elapsedLabel ? `已等待 ${elapsedLabel}` : (durLabel ? `clock.sleep · 计划等待 ${durLabel}` : "clock.sleep"));
        } else {
          tailPhase = fullName ? `调用 ${fullName}` : "执行工具";
          tailText = rawArgs.replace(/\s+/g, " ").trim().slice(0, 180);
        }
      } else if (pType === "function_call_output" || pType === "custom_tool_call_output") {
        tailPhase = "处理工具结果";
        tailText = "";
      } else if (pType === "agent_message" || (pType === "message" && payload.role === "assistant")) {
        tailPhase = "生成回复";
        const msgSnippet = extractResponseMessageText(payload);
        tailText = msgSnippet ? msgSnippet.slice(-240) : "";
      }
      continue;
    }

    if (record?.type !== "event_msg") continue;

    if (payload.type === "task_started") {
      turnId = payload.turn_id || turnId;
      status = "running";
      phase = "思考与规划";
      text = "";
      tailPhase = "";
      tailText = "";
      sawExplicitStarted = true;
      sawTerminal = false;
      sawActivityAfterTerminal = true;
    } else if (payload.type === "user_message") {
      turnId = "";
      status = "running";
      phase = "已收到指令";
      text = "";
      tailPhase = "";
      tailText = "";
      sawExplicitStarted = true;
      sawTerminal = false;
      sawActivityAfterTerminal = true;
    } else if (payload.type === "agent_reasoning") {
      status = "running";
      phase = "思考中";
      text = String(payload.text || payload.delta || "").slice(-240);
      tailPhase = "";
      tailText = "";
      sawExplicitStarted = true;
      sawTerminal = false;
      sawActivityAfterTerminal = true;
    } else if (payload.type === "exec_command_begin") {
      status = "running";
      phase = "执行命令";
      text = Array.isArray(payload.command) ? payload.command.join(" ") : String(payload.command || "");
      tailPhase = "";
      tailText = "";
      sawExplicitStarted = true;
      sawTerminal = false;
      sawActivityAfterTerminal = true;
    } else if (payload.type === "exec_command_end") {
      phase = "命令已结束";
      tailPhase = "";
      tailText = "";
      if (!sawTerminal) sawActivityAfterTerminal = true;
    } else if (payload.type === "agent_message") {
      phase = "生成回复";
      text = String(payload.message || "").slice(-240);
      tailPhase = "";
      tailText = "";
      if (!sawTerminal) sawActivityAfterTerminal = true;
    } else if (payload.type === "item_completed") {
      if (payload.turn_id) turnId = payload.turn_id;
      sawTerminal = false;
      sawActivityAfterTerminal = true;
      tailPhase = phaseFromCompletedItem(payload.item);
      tailText = payload.item?.command ? String(payload.item.command).slice(0, 180) : "";
    } else if (payload.type === "token_count") {
      if (!sawTerminal) sawActivityAfterTerminal = true;
    } else if (payload.type === "task_complete" && (!turnId || !payload.turn_id || payload.turn_id === turnId)) {
      status = "completed";
      phase = "已完成";
      sawExplicitStarted = false;
      sawTerminal = true;
      sawActivityAfterTerminal = false;
      tailPhase = "";
      tailText = "";
    } else if (payload.type === "turn_aborted" && (!turnId || !payload.turn_id || payload.turn_id === turnId)) {
      status = "interrupted";
      phase = "已中断";
      sawExplicitStarted = false;
      sawTerminal = true;
      sawActivityAfterTerminal = false;
      tailPhase = "";
      tailText = "";
    }
  }

  const fileAgeMs = mtimeMs > 0 ? Math.max(0, nowMs - mtimeMs) : 0;
  if (status === "running" && sawExplicitStarted) {
    if (mtimeMs > 0 && fileAgeMs > CODEX_STALE_RUNNING_GUARD_MS) {
      status = "idle";
      phase = "";
    } else if (tailPhase) {
      phase = tailPhase;
      text = tailText;
    } else if (!text && tailText) {
      text = tailText;
    }
  } else if (!sawTerminal && sawActivityAfterTerminal && mtimeMs > 0 && fileAgeMs <= CODEX_RUNNING_INFER_WINDOW_MS) {
    status = "running";
    phase = tailPhase || phase || "Codex 执行中";
    text = tailPhase ? tailText : (tailText || text);
  }

  return { turnId, status, phase, text, updatedAt };
}

export async function readRolloutActivitySnapshot(rolloutPath, previousCursor = null, { nowMs = Date.now() } = {}) {
  if (!rolloutPath) {
    return { cursor: "0", changed: false, activity: null };
  }
  let file;
  try {
    file = await open(rolloutPath, "r");
    const { size, mtimeMs } = await file.stat();
    const cursor = String(size);
    const start = Math.max(0, size - MAX_TAIL_BYTES);
    const buf = Buffer.allocUnsafe(size - start);
    if (buf.length) await file.read(buf, 0, buf.length, start);
    const lines = buf.toString("utf8").split("\n");
    if (start > 0) lines.shift();
    const activity = summarizeRolloutActivity(lines, { mtimeMs, nowMs });
    return { cursor, changed: !previousCursor || previousCursor !== cursor, activity };
  } catch {
    return { cursor: previousCursor || "0", changed: false, activity: null };
  } finally {
    await file?.close().catch(() => {});
  }
}
