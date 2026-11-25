import { createReadStream, existsSync } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import { basename, dirname, resolve } from "node:path";
import readline from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { formatCompositeThreadId } from "./composite-id.mjs";
import {
  parseCodexHeartbeatAgentReply,
  stripCodexPromptWrappers,
} from "./codex-input-clean.mjs";
import { isInternalVoiceCallThread } from "./thread-access.mjs";
import {
  cleanPreviewText,
  displayThreadTitle,
  stripClaudeInvisibleNoise,
  stripPromptNoise,
} from "./thread-display.mjs";
import { decodeWorkspaceUri } from "./providers/antigravity-history.mjs";
import { decodeSlugFallback } from "./providers/claude-history.mjs";
import { decodeGrokCwdSlug, parseGrokTimestampSeconds, stripGrokInjectedUserInfo } from "./providers/grok-history.mjs";

export const MAX_MESSAGE_CHARS = 4000;
export const MAX_MESSAGES_PER_THREAD = 200;
export const SEARCH_INDEX_SCHEMA_VERSION = 1;

const MAX_RAW_JSONL_LINE_CHARS = 4 * 1024 * 1024;
const HEAD_MESSAGE_KEEP = 20;
const TAIL_MESSAGE_KEEP = MAX_MESSAGES_PER_THREAD - HEAD_MESSAGE_KEEP;

function parseEpochSeconds(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const text = String(value || "").trim().replace(" ", "T");
  if (!text) return fallback;
  if (/^\d+$/.test(text)) {
    const num = Number(text);
    return num > 1e12 ? Math.floor(num / 1000) : Math.floor(num);
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : fallback;
}

export function normalizeIndexedMessageText(raw) {
  const text = String(raw || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\f\v]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return "";
  return text.length > MAX_MESSAGE_CHARS ? text.slice(0, MAX_MESSAGE_CHARS) : text;
}

export function capThreadMessages(messages = []) {
  const deduped = [];
  for (const item of messages || []) {
    if (!item || typeof item !== "object") continue;
    const role = item.role === "assistant" ? "assistant" : "user";
    const body = normalizeIndexedMessageText(item.body);
    if (!body) continue;
    const prev = deduped[deduped.length - 1];
    if (prev && prev.role === role && prev.body === body) {
      if (Number(item.updatedAt) > prev.updatedAt) prev.updatedAt = Number(item.updatedAt);
      continue;
    }
    deduped.push({
      role,
      body,
      updatedAt: Number(item.updatedAt) || 0,
    });
  }
  if (deduped.length <= MAX_MESSAGES_PER_THREAD) {
    return deduped;
  }
  return [
    ...deduped.slice(0, HEAD_MESSAGE_KEEP),
    ...deduped.slice(-TAIL_MESSAGE_KEEP),
  ];
}

export function extractMatchSnippet(text, terms = [], { beforeChars = 24, afterChars = 64 } = {}) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const termList = (Array.isArray(terms) ? terms : [terms])
    .map((t) => String(t || "").trim().toLowerCase())
    .filter(Boolean);

  let matchIndex = -1;
  let matchLen = 0;
  if (termList.length > 0) {
    const lower = clean.toLowerCase();
    for (const term of termList) {
      const idx = lower.indexOf(term);
      if (idx >= 0 && (matchIndex < 0 || idx < matchIndex)) {
        matchIndex = idx;
        matchLen = term.length;
      }
    }
  }

  const maxLen = Math.max(24, beforeChars + afterChars + matchLen);
  if (matchIndex < 0) {
    return clean.length > maxLen ? `${clean.slice(0, maxLen).trimEnd()}…` : clean;
  }

  const start = Math.max(0, matchIndex - beforeChars);
  const end = Math.min(clean.length, matchIndex + matchLen + afterChars);
  let snippet = clean.slice(start, end).trim();
  if (start > 0) snippet = `…${snippet}`;
  if (end < clean.length) snippet = `${snippet}…`;
  return snippet;
}

async function streamJsonlLines(filePath, onLine) {
  const stream = createReadStream(filePath, {
    encoding: "utf8",
    highWaterMark: 128 * 1024,
  });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      if (!line) continue;
      await onLine(line);
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

async function statFileSafe(filePath) {
  if (!filePath) return null;
  const info = await stat(filePath).catch(() => null);
  return info?.isFile() ? info : null;
}

function isInjectedCodexUserText(text) {
  return /^(?:# AGENTS\.md instructions\b|<environment_context\b|<recommended_plugins\b|<skills_instructions\b|<permissions instructions\b|<collaboration_mode\b|<multi_agent_|<external_codex_apps_|<codex_apps_|<heartbeat\b)/i.test(
    String(text || "").trimStart(),
  );
}

function extractCodexContentText(payload) {
  if (typeof payload?.content === "string") return payload.content.trim();
  return (Array.isArray(payload?.content) ? payload.content : [])
    .filter((item) => ["input_text", "output_text", "text"].includes(item?.type) && typeof item?.text === "string")
    .map((item) => item.text)
    .join("\n")
    .trim();
}

function cleanCodexUserText(rawText) {
  if (!rawText || isInjectedCodexUserText(rawText)) return "";
  if (String(rawText).trimStart().startsWith("[AGENT_CONTROL_PING]")) return "";
  const unwrapped = stripCodexPromptWrappers(rawText);
  if (!unwrapped) return "";
  const cleaned = stripPromptNoise(unwrapped);
  if (!cleaned || cleaned.startsWith("[AGENT_CONTROL_PING]")) return "";
  return cleaned;
}

function cleanCodexAssistantText(rawText) {
  const str = String(rawText || "").trim();
  if (!str) return "";
  const hb = parseCodexHeartbeatAgentReply(str, { allowIncomplete: false });
  if (hb) {
    return [hb.extraText, hb.message].filter(Boolean).join("\n\n").trim();
  }
  return str;
}

async function readCodexSessionMetaHead(filePath) {
  let fh;
  try {
    fh = await open(filePath, "r");
    const buf = Buffer.allocUnsafe(8192);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    const firstLine = buf.subarray(0, bytesRead).toString("utf8").split("\n")[0] || "";
    if (!firstLine.includes('"session_meta"')) return null;
    const record = JSON.parse(firstLine);
    if (record?.type === "session_meta" && record.payload) {
      return record.payload;
    }
  } catch {
    // Ignore unreadable header.
  } finally {
    await fh?.close().catch(() => {});
  }
  return null;
}

async function walkJsonlRecursive(rootDir, out = []) {
  const entries = await readdir(rootDir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = resolve(rootDir, entry.name);
    if (entry.isDirectory()) {
      await walkJsonlRecursive(full, out);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      out.push(full);
    }
  }
  return out;
}

export async function extractCodexRolloutMessages(filePath) {
  const messages = [];
  let meta = null;
  let firstUserText = "";
  let lastUserText = "";
  let createdAt = 0;
  let updatedAt = 0;

  try {
    await streamJsonlLines(filePath, (line) => {
      if (line.length > MAX_RAW_JSONL_LINE_CHARS) return;
      const maybeRelevant = (
        line.includes('"user_message"')
        || line.includes('"agent_message"')
        || line.includes('"UserMessage"')
        || line.includes('"AgentMessage"')
        || (line.includes('"response_item"') && line.includes('"message"'))
        || line.includes('"session_meta"')
      );
      if (!maybeRelevant) return;

      let record;
      try {
        record = JSON.parse(line);
      } catch {
        return;
      }
      if (!record || typeof record !== "object") return;
      const ts = parseEpochSeconds(record.timestamp);
      if (ts > 0) {
        if (!createdAt || ts < createdAt) createdAt = ts;
        if (ts > updatedAt) updatedAt = ts;
      }

      const payload = record.payload;
      if (record.type === "session_meta" && payload && typeof payload === "object") {
        meta = payload;
        return;
      }

      let role = "";
      let rawText = "";
      if (record.type === "event_msg" && payload && typeof payload === "object") {
        if (payload.type === "user_message" && typeof payload.message === "string") {
          role = "user";
          rawText = payload.message;
        } else if (payload.type === "agent_message" && typeof payload.message === "string") {
          role = "assistant";
          rawText = payload.message;
        } else if (payload.type === "item_completed" && payload.item?.type === "UserMessage") {
          role = "user";
          rawText = extractCodexContentText(payload.item);
        } else if (payload.type === "item_completed" && payload.item?.type === "AgentMessage") {
          role = "assistant";
          rawText = extractCodexContentText(payload.item);
        }
      } else if (record.type === "response_item" && payload?.type === "message") {
        if (payload.role === "user") {
          role = "user";
          rawText = extractCodexContentText(payload);
        } else if (payload.role === "assistant") {
          role = "assistant";
          rawText = extractCodexContentText(payload);
        }
      }

      if (!role || !rawText) return;
      const body = role === "user" ? cleanCodexUserText(rawText) : cleanCodexAssistantText(rawText);
      if (!body) return;
      if (role === "user") {
        if (!firstUserText) firstUserText = body;
        lastUserText = body;
      }
      messages.push({ role, body, updatedAt: ts });
    });
  } catch {
    return { meta: null, firstUserText: "", lastUserText: "", createdAt: 0, updatedAt: 0, messages: [] };
  }

  return {
    meta,
    firstUserText,
    lastUserText,
    createdAt,
    updatedAt,
    messages: capThreadMessages(messages),
  };
}

function buildCodexDescriptorFromDbRow(row, profile, fileStat) {
  const rawId = String(row?.id || "").trim();
  if (!rawId) return null;
  if (String(row?.thread_source || "").toLowerCase() === "subagent") return null;
  const sourceVal = typeof row?.source === "string" && row.source.startsWith("{")
    ? (() => { try { return JSON.parse(row.source); } catch { return null; } })()
    : row?.source;
  if (sourceVal && typeof sourceVal === "object" && Object.keys(sourceVal).some((k) => k.toLowerCase().startsWith("subagent"))) {
    return null;
  }
  const cwd = String(row?.cwd || "").trim() || os.homedir();
  const cleanTitle = stripCodexPromptWrappers(row?.title || "");
  const cleanFirst = stripCodexPromptWrappers(row?.first_user_message || "");
  const cleanPreview = stripCodexPromptWrappers(row?.preview || "");
  const preview = cleanPreviewText(cleanPreview || cleanFirst || cleanTitle || "", 120);
  const title = displayThreadTitle({ name: row?.name || "", title: cleanTitle, preview });
  if (isInternalVoiceCallThread({ cwd, title, preview })) return null;
  const rolloutPath = String(row?.rollout_path || "").trim();
  return {
    threadId: formatCompositeThreadId("codex", profile.profileId, rawId),
    provider: "codex",
    profileId: profile.profileId,
    profileLabel: profile.profileLabel || "Codex",
    rawId,
    title,
    preview,
    cwd,
    createdAt: parseEpochSeconds(row?.created_at),
    updatedAt: parseEpochSeconds(row?.updated_at),
    archived: Boolean(row?.archived),
    sourcePath: rolloutPath,
    mtimeMs: fileStat ? Number(fileStat.mtimeMs) || 0 : 0,
    fileSize: fileStat ? Number(fileStat.size) || 0 : 0,
  };
}

export async function scanCodexProfileFiles(profile) {
  const codexHome = String(profile?.home || "").trim();
  if (!codexHome) return [];
  const dbPath = resolve(codexHome, "state_5.sqlite");
  if (existsSync(dbPath)) {
    let db = null;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      const rows = db.prepare(`
        SELECT id, rollout_path, created_at, updated_at, source, cwd, title, archived,
               first_user_message, thread_source, preview, name
        FROM threads
        ORDER BY updated_at DESC
      `).all();
      const stats = await Promise.all(
        rows.map((row) => statFileSafe(String(row?.rollout_path || "").trim())),
      );
      const descriptors = [];
      for (let i = 0; i < rows.length; i += 1) {
        const desc = buildCodexDescriptorFromDbRow(rows[i], profile, stats[i]);
        if (desc) descriptors.push(desc);
      }
      return descriptors;
    } catch {
      // Fall back to filesystem scan if SQLite index is unreadable.
    } finally {
      try { db?.close(); } catch {}
    }
  }

  const sessionsDir = resolve(codexHome, "sessions");
  if (!existsSync(sessionsDir)) return [];
  const files = await walkJsonlRecursive(sessionsDir);
  const descriptors = [];
  for (const filePath of files) {
    const info = await statFileSafe(filePath);
    if (!info) continue;
    const headMeta = await readCodexSessionMetaHead(filePath);
    if (headMeta?.source && typeof headMeta.source === "object"
      && Object.keys(headMeta.source).some((k) => k.toLowerCase().startsWith("subagent"))) {
      continue;
    }
    const base = basename(filePath, ".jsonl");
    const uuidMatch = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
    const rawId = String(headMeta?.id || uuidMatch?.[1] || base).trim();
    if (!rawId) continue;
    const cwd = String(headMeta?.cwd || "").trim() || os.homedir();
    if (isInternalVoiceCallThread({ cwd })) continue;
    descriptors.push({
      threadId: formatCompositeThreadId("codex", profile.profileId, rawId),
      provider: "codex",
      profileId: profile.profileId,
      profileLabel: profile.profileLabel || "Codex",
      rawId,
      title: "",
      preview: "",
      cwd,
      createdAt: parseEpochSeconds(headMeta?.timestamp) || Math.floor((info.birthtimeMs || info.mtimeMs) / 1000),
      updatedAt: Math.floor(info.mtimeMs / 1000),
      archived: false,
      sourcePath: filePath,
      mtimeMs: Number(info.mtimeMs) || 0,
      fileSize: Number(info.size) || 0,
      needsTitleFromExtract: true,
    });
  }
  return descriptors;
}

function stripLargeBase64InClaudeLine(line) {
  if (line.length <= 16_384) return line;
  return line
    .replace(/"data"\s*:\s*"[A-Za-z0-9+/=\s]{4096,}"/g, '"data":""')
    .replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=\s]{4096,}/gi, "");
}

function extractClaudeTextParts(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && typeof part === "object" && part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

function isPureClaudeToolResult(content) {
  return Array.isArray(content) && content.length > 0 && content.every((part) => part?.type === "tool_result");
}

export async function extractClaudeJsonlMessages(filePath, { fallbackCwd = "" } = {}) {
  const messages = [];
  const assistantIndexByMsgId = new Map();
  let cwd = "";
  let relocatedCwd = "";
  let customTitle = "";
  let agentName = "";
  let lastPrompt = "";
  let firstUserText = "";
  let lastUserText = "";
  let createdAt = 0;
  let updatedAt = 0;
  let hasConversation = false;

  try {
    await streamJsonlLines(filePath, (rawLine) => {
      const maybeRelevant = (
        rawLine.includes('"user"')
        || rawLine.includes('"assistant"')
        || rawLine.includes('"custom-title"')
        || rawLine.includes('"agent-name"')
        || rawLine.includes('"last-prompt"')
        || rawLine.includes('"relocated"')
      );
      if (!maybeRelevant) return;

      const parseTarget = stripLargeBase64InClaudeLine(rawLine);
      if (parseTarget.length > MAX_RAW_JSONL_LINE_CHARS) return;

      let entry;
      try {
        entry = JSON.parse(parseTarget);
      } catch {
        return;
      }
      if (!entry || typeof entry !== "object") return;
      if (entry.cwd && !cwd) cwd = String(entry.cwd);
      const ts = parseEpochSeconds(entry.timestamp);
      if (ts > 0) {
        if (!createdAt || ts < createdAt) createdAt = ts;
        if (ts > updatedAt) updatedAt = ts;
      }

      if (entry.type === "relocated" && entry.relocatedCwd) {
        relocatedCwd = String(entry.relocatedCwd).trim();
        return;
      }
      if (entry.type === "custom-title" && entry.customTitle) {
        customTitle = String(entry.customTitle).trim();
        return;
      }
      if (entry.type === "agent-name" && entry.agentName) {
        agentName = String(entry.agentName).trim();
        return;
      }
      if (entry.type === "last-prompt" && entry.lastPrompt) {
        lastPrompt = String(entry.lastPrompt).trim();
        return;
      }

      if (entry.type === "user" && !entry.isMeta) {
        const content = entry.message?.content;
        if (isPureClaudeToolResult(content)) return;
        hasConversation = true;
        const rawText = extractClaudeTextParts(content);
        const isCompactEntry = Boolean(entry.isCompactSummary)
          || /^\s*This session is being continued from a previous conversation that ran out of context\./i.test(rawText);
        if (isCompactEntry) return;
        const withoutInvisible = stripClaudeInvisibleNoise(rawText);
        if (!withoutInvisible) return;
        const cleaned = stripPromptNoise(withoutInvisible);
        if (!cleaned) return;
        if (!firstUserText) firstUserText = cleaned;
        lastUserText = cleaned;
        messages.push({ role: "user", body: cleaned, updatedAt: ts });
        return;
      }

      if (entry.type === "assistant") {
        hasConversation = true;
        const msg = entry.message || {};
        const text = extractClaudeTextParts(msg.content);
        const normalized = normalizeIndexedMessageText(text);
        if (!normalized) return;
        const msgKey = String(msg.id || "").trim();
        if (msgKey && assistantIndexByMsgId.has(msgKey)) {
          const prevIdx = assistantIndexByMsgId.get(msgKey);
          const existing = messages[prevIdx];
          if (existing && existing.role === "assistant") {
            if (normalized.startsWith(existing.body) || normalized.length >= existing.body.length) {
              existing.body = normalized;
            } else if (!existing.body.includes(normalized)) {
              existing.body = normalizeIndexedMessageText(`${existing.body}\n${normalized}`);
            }
            if (ts > existing.updatedAt) existing.updatedAt = ts;
            return;
          }
        }
        if (msgKey) assistantIndexByMsgId.set(msgKey, messages.length);
        messages.push({ role: "assistant", body: normalized, updatedAt: ts });
      }
    });
  } catch {
    return { skip: true, messages: [] };
  }

  if (!hasConversation && !customTitle && !lastPrompt) {
    return { skip: true, messages: [] };
  }
  if (
    firstUserText.trim().startsWith("[AGENT_CONTROL_PING]")
    || lastPrompt.trim().startsWith("[AGENT_CONTROL_PING]")
  ) {
    return { skip: true, messages: [] };
  }

  const resolvedCwd = relocatedCwd || cwd || fallbackCwd || os.homedir();
  const preview = cleanPreviewText(
    lastPrompt || lastUserText || firstUserText || customTitle || agentName || "",
    120,
  );
  const title = displayThreadTitle({ name: customTitle || agentName || "", preview });
  if (isInternalVoiceCallThread({ cwd: resolvedCwd, title, preview })) {
    return { skip: true, messages: [] };
  }

  return {
    skip: false,
    cwd: resolvedCwd,
    title,
    preview,
    createdAt,
    updatedAt,
    messages: capThreadMessages(messages),
  };
}

async function collectClaudeProjectFiles(configDir, seenIds, profile, filterFn, descriptors) {
  const projectsDir = resolve(configDir, "projects");
  const slugs = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
  for (const slugEntry of slugs) {
    if (!slugEntry.isDirectory()) continue;
    const slugPath = resolve(projectsDir, slugEntry.name);
    const files = await readdir(slugPath, { withFileTypes: true }).catch(() => []);
    for (const fileEntry of files) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith(".jsonl")) continue;
      const rawId = basename(fileEntry.name, ".jsonl");
      if (!rawId || seenIds.has(rawId)) continue;
      if (!filterFn(rawId)) continue;
      const fullPath = resolve(slugPath, fileEntry.name);
      const info = await statFileSafe(fullPath);
      if (!info) continue;
      seenIds.add(rawId);
      const fallbackCwd = decodeSlugFallback(slugEntry.name) || os.homedir();
      descriptors.push({
        threadId: formatCompositeThreadId("claude", profile.profileId, rawId),
        provider: "claude",
        profileId: profile.profileId,
        profileLabel: profile.profileLabel || "Claude Code",
        rawId,
        title: "",
        preview: "",
        cwd: fallbackCwd,
        fallbackCwd,
        createdAt: Math.floor((info.birthtimeMs || info.mtimeMs) / 1000),
        updatedAt: Math.floor(info.mtimeMs / 1000),
        archived: false,
        sourcePath: fullPath,
        mtimeMs: Number(info.mtimeMs) || 0,
        fileSize: Number(info.size) || 0,
      });
    }
  }
}

export async function scanClaudeProfileFiles(profile, { claimedIds = null, excludedIds = null } = {}) {
  const historyDir = String(profile?.historyDir || profile?.home || "").trim();
  const cliDir = String(profile?.cliConfigDir || profile?.home || "").trim();
  const claimedSet = claimedIds ? new Set(claimedIds) : (Array.isArray(profile?.claimedIds) ? new Set(profile.claimedIds) : null);
  const excludedSet = excludedIds ? new Set(excludedIds) : (Array.isArray(profile?.excludedIds) ? new Set(profile.excludedIds) : null);

  const filterHistoryId = (rawId) => {
    if (claimedSet && !claimedSet.has(rawId)) return false;
    if (excludedSet && excludedSet.has(rawId)) return false;
    return true;
  };

  const descriptors = [];
  const seenIds = new Set();
  if (historyDir && existsSync(historyDir)) {
    await collectClaudeProjectFiles(historyDir, seenIds, profile, filterHistoryId, descriptors);
  }
  if (cliDir && resolve(cliDir) !== resolve(historyDir || "") && existsSync(cliDir)) {
    await collectClaudeProjectFiles(cliDir, seenIds, profile, () => true, descriptors);
  }
  return descriptors;
}

export async function extractAntigravityTranscriptMessages(filePath) {
  const messages = [];
  let firstUserText = "";
  let lastUserText = "";
  let createdAt = 0;
  let updatedAt = 0;

  try {
    await streamJsonlLines(filePath, (line) => {
      if (line.length > MAX_RAW_JSONL_LINE_CHARS) return;
      if (!line.includes('"USER_INPUT"') && !line.includes('"PLANNER_RESPONSE"')) return;
      let step;
      try {
        step = JSON.parse(line);
      } catch {
        return;
      }
      if (!step || typeof step !== "object") return;
      const ts = parseEpochSeconds(step.created_at);
      if (ts > 0) {
        if (!createdAt || ts < createdAt) createdAt = ts;
        if (ts > updatedAt) updatedAt = ts;
      }
      if (step.type === "USER_INPUT") {
        if (step.source && step.source !== "USER_EXPLICIT") return;
        const cleaned = stripPromptNoise(step.content || "");
        if (!cleaned) return;
        if (!firstUserText) firstUserText = cleaned;
        lastUserText = cleaned;
        messages.push({ role: "user", body: cleaned, updatedAt: ts });
      } else if (step.type === "PLANNER_RESPONSE" && typeof step.content === "string") {
        const cleaned = normalizeIndexedMessageText(step.content);
        if (!cleaned) return;
        messages.push({ role: "assistant", body: cleaned, updatedAt: ts });
      }
    });
  } catch {
    return { firstUserText: "", lastUserText: "", createdAt: 0, updatedAt: 0, messages: [] };
  }

  return {
    firstUserText,
    lastUserText,
    createdAt,
    updatedAt,
    messages: capThreadMessages(messages),
  };
}

export async function scanAntigravityProfileFiles(profile) {
  const appDataDir = String(profile?.home || "").trim();
  if (!appDataDir) return [];
  const profileType = String(profile?.profileType || profile?.id || profile?.profileId || "desktop");
  const dbPath = resolve(appDataDir, "conversation_summaries.db");

  if (existsSync(dbPath)) {
    let db = null;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      const rows = db.prepare(`
        SELECT conversation_id, title, preview, step_count, last_modified_time,
               workspace_uris, source, parent_conversation_id
        FROM conversation_summaries
        ORDER BY last_modified_time DESC
      `).all();

      const candidates = [];
      for (const row of rows) {
        const id = String(row?.conversation_id || "").trim();
        if (!id) continue;
        if (row.parent_conversation_id && String(row.parent_conversation_id).trim()) continue;
        if (profileType === "desktop" && row.source === "CORTEX_TRAJECTORY_SOURCE_CLI") {
          if (!existsSync(resolve(appDataDir, "brain", id))) continue;
        }
        const cwd = decodeWorkspaceUri(row.workspace_uris) || os.homedir();
        const preview = cleanPreviewText(row.preview || row.title || "", 120);
        const title = displayThreadTitle({ name: row.title || "", title: row.title || "", preview });
        if (isInternalVoiceCallThread({ cwd, title, preview })) continue;
        const transcriptPath = resolve(appDataDir, "brain", id, ".system_generated", "logs", "transcript.jsonl");
        candidates.push({ row, id, cwd, title, preview, transcriptPath });
      }

      const stats = await Promise.all(candidates.map((c) => statFileSafe(c.transcriptPath)));
      return candidates.map((c, idx) => {
        const info = stats[idx];
        const ts = parseEpochSeconds(c.row.last_modified_time);
        return {
          threadId: formatCompositeThreadId("antigravity", profile.profileId, c.id),
          provider: "antigravity",
          profileId: profile.profileId,
          profileLabel: profile.profileLabel || "Antigravity",
          rawId: c.id,
          title: c.title,
          preview: c.preview,
          cwd: c.cwd,
          createdAt: ts,
          updatedAt: ts,
          archived: false,
          sourcePath: info ? c.transcriptPath : "",
          mtimeMs: info ? Number(info.mtimeMs) || 0 : 0,
          fileSize: info ? Number(info.size) || 0 : 0,
        };
      });
    } catch {
      // Fall back to scanning brain/*/transcript.jsonl.
    } finally {
      try { db?.close(); } catch {}
    }
  }

  const brainDir = resolve(appDataDir, "brain");
  const entries = await readdir(brainDir, { withFileTypes: true }).catch(() => []);
  const descriptors = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const rawId = entry.name;
    const transcriptPath = resolve(brainDir, rawId, ".system_generated", "logs", "transcript.jsonl");
    const info = await statFileSafe(transcriptPath);
    if (!info) continue;
    const ts = Math.floor(info.mtimeMs / 1000);
    descriptors.push({
      threadId: formatCompositeThreadId("antigravity", profile.profileId, rawId),
      provider: "antigravity",
      profileId: profile.profileId,
      profileLabel: profile.profileLabel || "Antigravity",
      rawId,
      title: "",
      preview: "",
      cwd: os.homedir(),
      createdAt: Math.floor((info.birthtimeMs || info.mtimeMs) / 1000),
      updatedAt: ts,
      archived: false,
      sourcePath: transcriptPath,
      mtimeMs: Number(info.mtimeMs) || 0,
      fileSize: Number(info.size) || 0,
      needsTitleFromExtract: true,
    });
  }
  return descriptors;
}

function isSyntheticGrokHelperPrompt(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith("为下面这条用户消息起一个简短会话标题")
    || trimmed.startsWith("[AGENT_CONTROL_PING]")
  );
}

function extractGrokTextFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => (typeof block === "string" ? block : (typeof block?.text === "string" ? block.text : "")))
    .filter(Boolean)
    .join("\n");
}

export async function extractGrokChatMessages(sessionDir, { cwdSlug = "", rawId = "" } = {}) {
  const summaryPath = resolve(sessionDir, "summary.json");
  const chatPath = resolve(sessionDir, "chat_history.jsonl");
  let summaryJson = null;
  const sumRaw = await readFile(summaryPath, "utf8").catch(() => "");
  if (sumRaw) {
    try {
      summaryJson = JSON.parse(sumRaw);
    } catch {
      summaryJson = null;
    }
  }

  const rawGeneratedTitle = String(summaryJson?.generated_title || "").trim();
  const rawSessionSummary = String(summaryJson?.session_summary || "").trim();
  if (isSyntheticGrokHelperPrompt(rawGeneratedTitle)) {
    return { skip: true, messages: [] };
  }

  const messages = [];
  let firstUserText = "";
  let lastUserText = "";
  let minTs = 0;
  let maxTs = 0;
  let hasConversation = Boolean(summaryJson?.num_chat_messages && Number(summaryJson.num_chat_messages) > 0);

  if (existsSync(chatPath)) {
    try {
      await streamJsonlLines(chatPath, (line) => {
        if (line.length > MAX_RAW_JSONL_LINE_CHARS) return;
        if (!line.includes('"user"') && !line.includes('"assistant"')) return;
        if (line.includes('"type":"reasoning"') || line.includes('"type": "reasoning"')) return;
        if (line.includes('"type":"tool_result"') || line.includes('"type": "tool_result"')) return;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          return;
        }
        if (!entry || typeof entry !== "object") return;
        const ts = parseGrokTimestampSeconds(entry.timestamp || entry.created_at);
        if (ts > 0) {
          if (!minTs || ts < minTs) minTs = ts;
          if (ts > maxTs) maxTs = ts;
        }
        if (entry.type === "user" && !entry.synthetic_reason) {
          const text = stripGrokInjectedUserInfo(extractGrokTextFromContent(entry.content));
          if (!text) return;
          hasConversation = true;
          if (!firstUserText) firstUserText = text;
          lastUserText = text;
          messages.push({ role: "user", body: text, updatedAt: ts });
        } else if (entry.type === "assistant" && typeof entry.content === "string") {
          hasConversation = true;
          const cleaned = normalizeIndexedMessageText(entry.content);
          if (!cleaned) return;
          messages.push({ role: "assistant", body: cleaned, updatedAt: ts });
        }
      });
    } catch {
      // Continue with summary metadata if chat_history.jsonl is transiently unreadable.
    }
  }

  if (isSyntheticGrokHelperPrompt(firstUserText) || isSyntheticGrokHelperPrompt(lastUserText)) {
    return { skip: true, messages: [] };
  }
  if (!hasConversation && !rawGeneratedTitle && !rawSessionSummary) {
    return { skip: true, messages: [] };
  }

  const sessionId = String(summaryJson?.info?.id || rawId).trim() || rawId;
  const cwd = String(summaryJson?.info?.cwd || summaryJson?.git_root_dir || decodeGrokCwdSlug(cwdSlug) || "").trim() || os.homedir();
  const preview = cleanPreviewText(lastUserText || firstUserText || rawSessionSummary || rawGeneratedTitle || "", 120);
  const title = displayThreadTitle({ name: rawGeneratedTitle || rawSessionSummary || "", preview });
  if (isInternalVoiceCallThread({ cwd, title, preview })) {
    return { skip: true, messages: [] };
  }

  return {
    skip: false,
    rawId: sessionId,
    cwd,
    title,
    preview,
    createdAt: parseGrokTimestampSeconds(summaryJson?.created_at) || minTs,
    updatedAt: Math.max(parseGrokTimestampSeconds(summaryJson?.last_active_at || summaryJson?.updated_at), maxTs),
    messages: capThreadMessages(messages),
  };
}

export async function scanGrokProfileFiles(profile) {
  const grokHome = String(profile?.home || profile?.grokHome || "").trim();
  if (!grokHome) return [];
  const sessionsDir = resolve(grokHome, "sessions");
  const level1 = await readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  if (!level1.length) return [];

  const candidateDirs = [];
  for (const d1 of level1) {
    if (!d1.isDirectory()) continue;
    const p1 = resolve(sessionsDir, d1.name);
    const level2 = await readdir(p1, { withFileTypes: true }).catch(() => []);
    if (level2.some((item) => item.isFile() && (item.name === "summary.json" || item.name === "chat_history.jsonl"))) {
      candidateDirs.push({ sessionDir: p1, cwdSlug: "", rawId: d1.name });
      continue;
    }
    for (const d2 of level2) {
      if (!d2.isDirectory()) continue;
      candidateDirs.push({ sessionDir: resolve(p1, d2.name), cwdSlug: d1.name, rawId: d2.name });
    }
  }

  const descriptors = [];
  for (const item of candidateDirs) {
    const chatPath = resolve(item.sessionDir, "chat_history.jsonl");
    const sumPath = resolve(item.sessionDir, "summary.json");
    const [chatStat, sumStat] = await Promise.all([statFileSafe(chatPath), statFileSafe(sumPath)]);
    if (!chatStat && !sumStat) continue;
    const mtimeMs = Math.max(chatStat?.mtimeMs || 0, sumStat?.mtimeMs || 0);
    const fileSize = (chatStat?.size || 0) + (sumStat?.size || 0);
    descriptors.push({
      threadId: formatCompositeThreadId("grok", profile.profileId, item.rawId),
      provider: "grok",
      profileId: profile.profileId,
      profileLabel: profile.profileLabel || "Grok",
      rawId: item.rawId,
      sessionDir: item.sessionDir,
      cwdSlug: item.cwdSlug,
      title: "",
      preview: "",
      cwd: decodeGrokCwdSlug(item.cwdSlug) || os.homedir(),
      createdAt: Math.floor(((sumStat?.birthtimeMs || chatStat?.birthtimeMs || mtimeMs)) / 1000),
      updatedAt: Math.floor(mtimeMs / 1000),
      archived: false,
      sourcePath: chatStat ? chatPath : sumPath,
      mtimeMs: Number(mtimeMs) || 0,
      fileSize: Number(fileSize) || 0,
    });
  }
  return descriptors;
}

function extractQoderTurnMessages(thread) {
  const messages = [];
  for (const turn of Array.isArray(thread?.turns) ? thread.turns : []) {
    const turnTs = Number(turn?.completedAt || turn?.startedAt || thread?.updatedAt) || 0;
    for (const item of Array.isArray(turn?.items) ? turn.items : []) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "userMessage") {
        const text = typeof item.text === "string"
          ? item.text
          : (Array.isArray(item.content) ? item.content.filter((c) => typeof c?.text === "string").map((c) => c.text).join("\n") : "");
        const cleaned = stripPromptNoise(text);
        if (cleaned) messages.push({ role: "user", body: cleaned, updatedAt: turnTs });
      } else if (item.type === "agentMessage" && typeof item.text === "string") {
        const cleaned = normalizeIndexedMessageText(item.text);
        if (cleaned) messages.push({ role: "assistant", body: cleaned, updatedAt: turnTs });
      }
    }
  }
  return capThreadMessages(messages);
}

export async function scanQoderThreads(dataDir, profile = { profileId: "default", profileLabel: "Qoder CLI" }) {
  const cleanDir = String(dataDir || "").trim();
  if (!cleanDir) return [];
  const qoderPath = resolve(cleanDir, "qoder-threads.json");
  const info = await statFileSafe(qoderPath);
  if (!info) return [];
  let parsed;
  try {
    parsed = JSON.parse(await readFile(qoderPath, "utf8"));
  } catch {
    return [];
  }
  const list = Array.isArray(parsed?.threads) ? parsed.threads : [];
  const descriptors = [];
  for (const thread of list) {
    const rawId = String(thread?.rawId || thread?.id || "").trim();
    if (!rawId) continue;
    const cwd = String(thread?.cwd || "").trim() || os.homedir();
    const preview = cleanPreviewText(thread?.preview || "", 120);
    const title = displayThreadTitle({ ...thread, preview });
    if (isInternalVoiceCallThread({ cwd, title, preview })) continue;
    descriptors.push({
      threadId: formatCompositeThreadId("qoder", profile.profileId || "default", rawId),
      provider: "qoder",
      profileId: profile.profileId || "default",
      profileLabel: profile.profileLabel || "Qoder CLI",
      rawId,
      title,
      preview,
      cwd,
      createdAt: Number(thread?.createdAt) || 0,
      updatedAt: Number(thread?.updatedAt) || 0,
      archived: Boolean(thread?.archived),
      sourcePath: `${qoderPath}#${rawId}`,
      mtimeMs: Number(info.mtimeMs) || 0,
      fileSize: Number(info.size) || 0,
      inlineMessages: extractQoderTurnMessages(thread),
    });
  }
  return descriptors;
}

export async function extractMessagesForDescriptor(desc) {
  if (!desc) return { skip: true, messages: [] };
  if (desc.provider === "qoder") {
    return {
      skip: false,
      title: desc.title,
      preview: desc.preview,
      cwd: desc.cwd,
      createdAt: desc.createdAt,
      updatedAt: desc.updatedAt,
      messages: Array.isArray(desc.inlineMessages) ? desc.inlineMessages : [],
    };
  }
  if (desc.provider === "codex") {
    if (!desc.sourcePath) {
      return {
        skip: false,
        title: desc.title,
        preview: desc.preview,
        cwd: desc.cwd,
        createdAt: desc.createdAt,
        updatedAt: desc.updatedAt,
        messages: [],
      };
    }
    const extracted = await extractCodexRolloutMessages(desc.sourcePath);
    const preview = desc.preview || cleanPreviewText(extracted.lastUserText || extracted.firstUserText || "", 120);
    const title = desc.title || displayThreadTitle({ preview });
    return {
      skip: false,
      title,
      preview,
      cwd: desc.cwd || extracted.meta?.cwd || os.homedir(),
      createdAt: desc.createdAt || extracted.createdAt,
      updatedAt: Math.max(desc.updatedAt || 0, extracted.updatedAt || 0),
      messages: extracted.messages,
    };
  }
  if (desc.provider === "claude") {
    if (!desc.sourcePath) return { skip: true, messages: [] };
    const extracted = await extractClaudeJsonlMessages(desc.sourcePath, { fallbackCwd: desc.fallbackCwd || desc.cwd });
    if (extracted.skip) return { skip: true, messages: [] };
    return {
      skip: false,
      title: extracted.title || desc.title,
      preview: extracted.preview || desc.preview,
      cwd: extracted.cwd || desc.cwd,
      createdAt: extracted.createdAt || desc.createdAt,
      updatedAt: Math.max(desc.updatedAt || 0, extracted.updatedAt || 0),
      messages: extracted.messages,
    };
  }
  if (desc.provider === "antigravity") {
    if (!desc.sourcePath) {
      return {
        skip: false,
        title: desc.title,
        preview: desc.preview,
        cwd: desc.cwd,
        createdAt: desc.createdAt,
        updatedAt: desc.updatedAt,
        messages: [],
      };
    }
    const extracted = await extractAntigravityTranscriptMessages(desc.sourcePath);
    const preview = desc.preview || cleanPreviewText(extracted.lastUserText || extracted.firstUserText || "", 120);
    const title = desc.title || displayThreadTitle({ preview });
    return {
      skip: false,
      title,
      preview,
      cwd: desc.cwd,
      createdAt: desc.createdAt || extracted.createdAt,
      updatedAt: Math.max(desc.updatedAt || 0, extracted.updatedAt || 0),
      messages: extracted.messages,
    };
  }
  if (desc.provider === "grok") {
    const sessionDir = desc.sessionDir || (desc.sourcePath ? dirname(desc.sourcePath) : "");
    if (!sessionDir) return { skip: true, messages: [] };
    const extracted = await extractGrokChatMessages(sessionDir, { cwdSlug: desc.cwdSlug || "", rawId: desc.rawId });
    if (extracted.skip) return { skip: true, messages: [] };
    return {
      skip: false,
      title: extracted.title || desc.title,
      preview: extracted.preview || desc.preview,
      cwd: extracted.cwd || desc.cwd,
      createdAt: extracted.createdAt || desc.createdAt,
      updatedAt: Math.max(desc.updatedAt || 0, extracted.updatedAt || 0),
      messages: extracted.messages,
    };
  }
  return { skip: true, messages: [] };
}

export async function findSingleThreadDescriptor(profile, rawId, dataDir = "") {
  const cleanId = String(rawId || "").trim();
  if (!profile || !cleanId) return null;
  if (profile.provider === "codex") {
    const all = await scanCodexProfileFiles(profile);
    return all.find((item) => item.rawId === cleanId) || null;
  }
  if (profile.provider === "claude") {
    for (const dir of [profile.historyDir || profile.home, profile.cliConfigDir]) {
      if (!dir) continue;
      const projectsDir = resolve(dir, "projects");
      const slugs = await readdir(projectsDir, { withFileTypes: true }).catch(() => []);
      for (const slugEntry of slugs) {
        if (!slugEntry.isDirectory()) continue;
        const fullPath = resolve(projectsDir, slugEntry.name, `${cleanId}.jsonl`);
        const info = await statFileSafe(fullPath);
        if (!info) continue;
        const fallbackCwd = decodeSlugFallback(slugEntry.name) || os.homedir();
        return {
          threadId: formatCompositeThreadId("claude", profile.profileId, cleanId),
          provider: "claude",
          profileId: profile.profileId,
          profileLabel: profile.profileLabel || "Claude Code",
          rawId: cleanId,
          title: "",
          preview: "",
          cwd: fallbackCwd,
          fallbackCwd,
          createdAt: Math.floor((info.birthtimeMs || info.mtimeMs) / 1000),
          updatedAt: Math.floor(info.mtimeMs / 1000),
          archived: false,
          sourcePath: fullPath,
          mtimeMs: Number(info.mtimeMs) || 0,
          fileSize: Number(info.size) || 0,
        };
      }
    }
    return null;
  }
  if (profile.provider === "antigravity") {
    const appDataDir = String(profile.home || "").trim();
    const dbPath = resolve(appDataDir, "conversation_summaries.db");
    const transcriptPath = resolve(appDataDir, "brain", cleanId, ".system_generated", "logs", "transcript.jsonl");
    const info = await statFileSafe(transcriptPath);
    if (existsSync(dbPath)) {
      let db = null;
      try {
        db = new DatabaseSync(dbPath, { readOnly: true });
        const row = db.prepare(`
          SELECT conversation_id, title, preview, step_count, last_modified_time,
                 workspace_uris, source, parent_conversation_id
          FROM conversation_summaries
          WHERE conversation_id = ?
          LIMIT 1
        `).get(cleanId);
        if (row && !row.parent_conversation_id) {
          const cwd = decodeWorkspaceUri(row.workspace_uris) || os.homedir();
          const preview = cleanPreviewText(row.preview || row.title || "", 120);
          const title = displayThreadTitle({ name: row.title || "", title: row.title || "", preview });
          if (isInternalVoiceCallThread({ cwd, title, preview })) return null;
          const ts = parseEpochSeconds(row.last_modified_time);
          return {
            threadId: formatCompositeThreadId("antigravity", profile.profileId, cleanId),
            provider: "antigravity",
            profileId: profile.profileId,
            profileLabel: profile.profileLabel || "Antigravity",
            rawId: cleanId,
            title,
            preview,
            cwd,
            createdAt: ts,
            updatedAt: ts,
            archived: false,
            sourcePath: info ? transcriptPath : "",
            mtimeMs: info ? Number(info.mtimeMs) || 0 : 0,
            fileSize: info ? Number(info.size) || 0 : 0,
          };
        }
      } catch {
        // Ignore DB fallback errors.
      } finally {
        try { db?.close(); } catch {}
      }
    }
    if (info) {
      const ts = Math.floor(info.mtimeMs / 1000);
      return {
        threadId: formatCompositeThreadId("antigravity", profile.profileId, cleanId),
        provider: "antigravity",
        profileId: profile.profileId,
        profileLabel: profile.profileLabel || "Antigravity",
        rawId: cleanId,
        title: "",
        preview: "",
        cwd: os.homedir(),
        createdAt: Math.floor((info.birthtimeMs || info.mtimeMs) / 1000),
        updatedAt: ts,
        archived: false,
        sourcePath: transcriptPath,
        mtimeMs: Number(info.mtimeMs) || 0,
        fileSize: Number(info.size) || 0,
      };
    }
    return null;
  }
  if (profile.provider === "grok") {
    const all = await scanGrokProfileFiles(profile);
    return all.find((item) => item.rawId === cleanId) || null;
  }
  if (profile.provider === "qoder") {
    const all = await scanQoderThreads(dataDir || profile.dataDir, profile);
    return all.find((item) => item.rawId === cleanId) || null;
  }
  return null;
}

export async function scanAllProfileDescriptors(profiles = [], dataDir = "") {
  const all = [];
  const seenThreadIds = new Set();
  for (const profile of profiles || []) {
    if (!profile || !profile.provider) continue;
    let list = [];
    if (profile.provider === "codex") {
      list = await scanCodexProfileFiles(profile);
    } else if (profile.provider === "claude") {
      list = await scanClaudeProfileFiles(profile);
    } else if (profile.provider === "antigravity") {
      list = await scanAntigravityProfileFiles(profile);
    } else if (profile.provider === "grok") {
      list = await scanGrokProfileFiles(profile);
    } else if (profile.provider === "qoder") {
      list = await scanQoderThreads(dataDir || profile.dataDir, profile);
    }
    for (const item of list) {
      if (!item?.threadId || seenThreadIds.has(item.threadId)) continue;
      seenThreadIds.add(item.threadId);
      all.push(item);
    }
  }
  return all;
}
