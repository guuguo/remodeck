import { stripCodexPromptWrappers } from "./codex-input-clean.mjs";

export const DEFAULT_THREAD_TOOL_TEXT_CHARS = 24 * 1024;

export function truncateToolTextForRead(str, maxChars) {
  if (typeof str !== "string" || str.length <= maxChars) return str;
  const cleaned = str
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{256,}/gi, "[图片Base64已省略]")
    .replace(/"data"\s*:\s*"[A-Za-z0-9+/=\s]{4096,}"/g, '"data":"[Base64已省略]"');
  if (cleaned.length <= maxChars) return cleaned;
  return `${cleaned.slice(0, maxChars)}…[已省略 ${cleaned.length - maxChars} 字符]`;
}

function extractUserRequestTag(text) {
  const match = String(text || "").match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
  return match ? match[1] : text;
}

const CLAUDE_SYS_NOTIF_PREFIX_RE = /\[SYSTEM NOTIFICATION - NOT USER INPUT\](?:[^\n]*\n?){0,6}?(?=\s*<task-notification\b|\s*$)/gi;
const CLAUDE_INVISIBLE_NOISE_RE = /<(system-reminder|local-command-caveat|local-command-stdout|local-command-stderr|command-name|command-message|command-args|side-sessions-event|tools-used-before-summary)\b[^>]*>[\s\S]*?<\/\1>/gi;
const CLAUDE_TASK_NOTIFICATION_RE = /<task-notification\b[^>]*>([\s\S]*?)<\/task-notification>/gi;
const CLAUDE_CROSS_SESSION_RE = /(?:^|\n)[ \t]*Another Claude session sent a message:\s*\n?<cross-session-message\b[^>]*>[\s\S]*?<\/cross-session-message>|<cross-session-message\b[^>]*>[\s\S]*?<\/cross-session-message>/gi;

const TASK_NOTIF_STATUS_LABEL = {
  completed: "已完成",
  failed: "失败",
  error: "失败",
  stopped: "已停止",
  cancelled: "已取消",
  canceled: "已取消",
  interrupted: "已中断",
  running: "运行中",
  in_progress: "运行中",
};

function readXmlTagText(body = "", tag = "") {
  const m = String(body || "").match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
}

/**
 * Extract a compact one-line preview when a Claude thread only contains
 * <task-notification> or <cross-session-message> system events.
 */
export function extractClaudeEventPreview(value = "") {
  const raw = String(value || "");
  const taskMatch = raw.match(/<task-notification\b[^>]*>([\s\S]*?)<\/task-notification>/i);
  if (taskMatch) {
    const inner = taskMatch[1] || "";
    const status = readXmlTagText(inner, "status").toLowerCase();
    const summary = readXmlTagText(inner, "summary") || readXmlTagText(inner, "task-id");
    const statusLabel = TASK_NOTIF_STATUS_LABEL[status] || status;
    const prefix = statusLabel ? `后台任务 · ${statusLabel}` : "后台任务";
    return summary ? `${prefix}：${summary}` : prefix;
  }
  const crossMatch = raw.match(/<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/i);
  if (crossMatch) {
    const attrs = crossMatch[1] || "";
    const fromMatch = attrs.match(/\bfrom-name\s*=\s*(?:"([^"]*)"|'([^']*)')/i);
    const fromName = (fromMatch ? (fromMatch[1] ?? fromMatch[2] ?? "") : "").trim();
    const body = String(crossMatch[2] || "").replace(/\s+/g, " ").trim();
    const prefix = fromName ? `跨会话消息（${fromName}）` : "跨会话消息";
    return body ? `${prefix}：${body}` : prefix;
  }
  return "";
}

/**
 * Strip invisible Claude system-injected tags while preserving line breaks and
 * structured event tags (<task-notification>, <bash-input>, <cross-session-message>)
 * so the frontend can render rich cards for them.
 */
export function stripClaudeInvisibleNoise(value = "") {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(CLAUDE_SYS_NOTIF_PREFIX_RE, "")
    .replace(CLAUDE_INVISIBLE_NOISE_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripPromptNoise(value) {
  let text = extractUserRequestTag(String(value || ""));
  text = stripCodexPromptWrappers(text);
  text = text
    .replace(/<\/?USER_REQUEST>/gi, " ")
    .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, " ")
    .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, " ")
    .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, " ")
    .replace(CLAUDE_SYS_NOTIF_PREFIX_RE, " ")
    .replace(CLAUDE_TASK_NOTIFICATION_RE, " ")
    .replace(CLAUDE_CROSS_SESSION_RE, " ")
    .replace(CLAUDE_INVISIBLE_NOISE_RE, " ")
    .replace(/<bash-stdout\b[^>]*>[\s\S]*?<\/bash-stdout>/gi, " ")
    .replace(/<bash-stderr\b[^>]*>[\s\S]*?<\/bash-stderr>/gi, " ")
    .replace(/<bash-input\b[^>]*>([\s\S]*?)<\/bash-input>/gi, " $1 ")
    .replace(/<skills_instructions>[\s\S]*?<\/skills_instructions>/gi, " ")
    .replace(/<permissions instructions[\s\S]*?<\/permissions instructions>/gi, " ")
    .replace(/<multi_agent_[^>]*>[\s\S]*?<\/multi_agent_[^>]*>/gi, " ")
    .replace(/<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/gi, " ")
    .replace(/<external_codex_apps_[^>]*>[\s\S]*?<\/external_codex_apps_[^>]*>/gi, " ")
    .replace(/<codex_apps_[^>]*>[\s\S]*?<\/codex_apps_[^>]*>/gi, " ")
    .replace(/^# AGENTS\.md instructions[\s\S]*$/m, " ")
    .replace(/\[Request interrupted by user[^\]]*\]/gi, " ")
    .replace(/!\[([^\]\n]*)\]\(\s*(?:<[^>\n]+>|(?:[^()\n]|\([^()\n]*\))*)\s*\)/g, (_, alt) => (alt ? String(alt).trim() : "[图片]"))
    .replace(/!\[([^\]\n]*)\]\(\s*(?:<[^>\n]*|(?:\/|[A-Za-z]:\\|https?:|file:)[^)\n]*)$/, (_, alt) => (alt ? String(alt).trim() : "[图片]"))
    .replace(/\[([^\]\n]+)\]\(\s*(?:<[^>\n]+>|(?:[^()\n]|\([^()\n]*\))*)\s*\)/g, "$1")
    .replace(/\[([^\]\n]+)\]\(\s*(?:<(?:\/|[A-Za-z]:\\|https?:|file:)[^>\n]*|(?:\/|[A-Za-z]:\\|https?:|file:)[^)\n]*)$/, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return text;
}

export function cleanPreviewText(value, maxLength = 120) {
  const text = stripPromptNoise(value);
  if (!text) return "";
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

export function displayThreadTitle(thread, maxLength = 88) {
  const candidates = [
    thread?.customName,
    thread?.name,
    thread?.title,
    cleanPreviewText(thread?.preview, maxLength),
  ];
  for (const candidate of candidates) {
    const clean = stripPromptNoise(candidate);
    if (clean) {
      return clean.length > maxLength ? `${clean.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…` : clean;
    }
  }
  return "新会话";
}

function extractUserMessageText(item) {
  if (!item || item.type !== "userMessage") return "";
  if (typeof item.text === "string" && item.text.trim()) return item.text;
  const content = Array.isArray(item.content) ? item.content : [];
  return content
    .filter((block) => block && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n");
}

function extractTurnUserText(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const texts = items
    .filter((it) => it?.type === "userMessage")
    .map((it) => extractUserMessageText(it))
    .filter(Boolean);
  return stripPromptNoise(texts.join("\n"));
}

function turnPrimaryReply(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i];
    if (it?.type === "agentMessage" && it.phase !== "commentary" && String(it.text || "").trim()) {
      return String(it.text).trim();
    }
  }
  return "";
}

/**
 * 将内存运行中 turn 合并进已落盘的历史 turns，避免同一条用户输入渲染出双气泡。
 */
export function mergeActiveTurnIntoHistory(turns = [], active = null, { liveItemSuffix = "live" } = {}) {
  const list = Array.isArray(turns) ? [...turns] : [];
  if (!active || !active.turnId || list.some((t) => t?.id === active.turnId)) {
    return list;
  }

  const activeReply = String(active.lastText || "").trim();
  const activeUserText = stripPromptNoise(active.userText || "");
  const lastTurn = list[list.length - 1];
  const lastUserText = lastTurn ? extractTurnUserText(lastTurn) : "";
  const lastTurnHasCompletedReply = Array.isArray(lastTurn?.items) && lastTurn.items.some((it) => {
    if (it?.type !== "agentMessage" || it.phase === "commentary") return false;
    const text = String(it.text || "").trim();
    return Boolean(text) && text !== activeReply;
  });

  const prevCompletedTurn = list.length >= 2 ? list[list.length - 2] : null;
  const prevCompletedReply = prevCompletedTurn ? turnPrimaryReply(prevCompletedTurn) : "";
  const isStaleEchoOfPrevTurn = Boolean(
    activeReply.length >= 20
    && prevCompletedReply
    && activeReply === prevCompletedReply,
  );

  if (lastTurn && activeUserText && lastUserText === activeUserText && !lastTurnHasCompletedReply) {
    const nextItems = Array.isArray(lastTurn.items) ? [...lastTurn.items] : [];
    const hasSameLiveReply = activeReply && nextItems.some(
      (it) => it?.type === "agentMessage"
        && it.phase !== "commentary"
        && String(it.text || "").trim() === activeReply,
    );
    if (activeReply && !hasSameLiveReply && !isStaleEchoOfPrevTurn) {
      nextItems.push({
        type: "agentMessage",
        id: `${active.turnId}:${liveItemSuffix}`,
        text: active.lastText,
        phase: "final_answer",
      });
    }
    list[list.length - 1] = {
      ...lastTurn,
      status: "inProgress",
      startedAt: lastTurn.startedAt || active.startedAt,
      items: nextItems,
    };
    return list;
  }

  // Never append a stale completed/earlier active turn below a newer turn in history.
  const lastTurnHasNewerTimestamp = Boolean(
    Number(active.startedAt) > 0
    && Number(lastTurn?.startedAt) > 0
    && Number(active.startedAt) + 2 < Number(lastTurn.startedAt),
  );
  const earlierTurnMatchesPrompt = Boolean(
    activeUserText
    && lastUserText
    && activeUserText !== lastUserText
    && list.slice(0, -1).some((t) => extractTurnUserText(t) === activeUserText),
  );
  const earlierTurnHasExactReply = Boolean(
    activeReply
    && list.slice(0, -1).some((t) => turnPrimaryReply(t) === activeReply),
  );
  if (lastTurnHasNewerTimestamp || earlierTurnMatchesPrompt || earlierTurnHasExactReply) {
    return list;
  }

  const lastTurnReply = lastTurn ? turnPrimaryReply(lastTurn) : "";
  const isEchoOfLastCompletedTurn = Boolean(
    activeReply.length >= 20
    && lastTurnReply
    && activeReply === lastTurnReply,
  );

  const liveItems = [];
  if (active.userText) {
    liveItems.push({
      type: "userMessage",
      id: `user-${active.turnId}`,
      content: [{ type: "text", text: active.userText }],
    });
  }
  if (active.lastText && !isEchoOfLastCompletedTurn) {
    liveItems.push({
      type: "agentMessage",
      id: `${active.turnId}:${liveItemSuffix}`,
      text: active.lastText,
      phase: "final_answer",
    });
  }
  list.push({
    id: active.turnId,
    status: "inProgress",
    startedAt: active.startedAt,
    items: liveItems,
  });
  return list;
}
