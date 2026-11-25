import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { decodeFileUri, isUserHomePath } from "../platform.mjs";
import { isInternalVoiceCallThread } from "../thread-access.mjs";
import { cleanPreviewText, stripPromptNoise } from "../thread-display.mjs";
import { extractUserPromptsFromTurns, isContinuationOrControlPrompt } from "../thread-title.mjs";
import {
  extractToolTargetPath,
  formatToolExecutionError,
  stripStepEchoPrefix,
} from "../tool-errors.mjs";

export function antigravitySummaryDbPath(appDataDir) {
  return resolve(appDataDir, "conversation_summaries.db");
}

const MAX_QUEUED_MSG_CACHE = 64;
const parsedQueuedMsgCache = new Map();
const MAX_TRANSCRIPT_PROMPT_HINT_CACHE = 500;
const transcriptPromptHintCache = new Map();
const MAX_TAIL_ERROR_CACHE = 300;
const tailErrorCache = new Map();
const AGY_PROMPT_HINT_TAIL_BYTES = 32 * 1024;

function setBoundedLruCache(map, maxEntries, key, value) {
  if (map.has(key)) {
    map.delete(key);
  } else if (map.size >= maxEntries) {
    const oldestKey = map.keys().next().value;
    if (oldestKey !== undefined) map.delete(oldestKey);
  }
  map.set(key, value);
}

function setTranscriptPromptHintCache(key, value) {
  setBoundedLruCache(transcriptPromptHintCache, MAX_TRANSCRIPT_PROMPT_HINT_CACHE, key, value);
}

function readAntigravityPromptHintsSync(appDataDir, rawId, { updatedAt = 0, stepCount = 0 } = {}) {
  const cleanId = String(rawId || "").trim();
  if (!appDataDir || !cleanId) return null;
  const compactPath = resolve(appDataDir, "brain", cleanId, ".system_generated", "logs", "transcript.jsonl");
  let st;
  try {
    st = statSync(compactPath);
    if (!st.isFile() || st.size <= 0) return null;
  } catch {
    return null;
  }

  const cacheKey = `${appDataDir}|${cleanId}`;
  const cached = transcriptPromptHintCache.get(cacheKey);
  if (
    cached
    && cached.mtimeMs === st.mtimeMs
    && cached.size === st.size
    && cached.updatedAt === updatedAt
    && cached.stepCount === stepCount
  ) {
    setTranscriptPromptHintCache(cacheKey, cached);
    return cached.hints;
  }

  let raw = "";
  let offset = 0;
  try {
    if (st.size <= AGY_PROMPT_HINT_TAIL_BYTES) {
      raw = readFileSync(compactPath, "utf8");
    } else {
      offset = Math.max(0, st.size - AGY_PROMPT_HINT_TAIL_BYTES);
      const len = st.size - offset;
      const fd = openSync(compactPath, "r");
      try {
        const buf = Buffer.allocUnsafe(len);
        const bytesRead = readSync(fd, buf, 0, len, offset);
        raw = buf.subarray(0, bytesRead).toString("utf8");
      } finally {
        closeSync(fd);
      }
      const nl = raw.indexOf("\n");
      raw = nl >= 0 ? raw.slice(nl + 1) : "";
    }
  } catch {
    return null;
  }

  let firstUserText = "";
  let lastUserText = "";
  let lastSubstantiveUserText = "";
  let userCount = 0;
  let hasLaterStep = false;
  const tailSteps = [];

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    let step;
    try {
      step = JSON.parse(line);
    } catch {
      continue;
    }
    if (!step || typeof step !== "object") continue;
    tailSteps.push(step);
    if (step.type !== "USER_INPUT") continue;
    if (step.source && step.source !== "USER_EXPLICIT") continue;
    const text = stripPromptNoise(step.content || "");
    if (!text) continue;
    userCount += 1;
    if (Number(step.step_index) > 0) hasLaterStep = true;
    if (offset === 0 && !firstUserText) firstUserText = text;
    lastUserText = text;
    if (!isContinuationOrControlPrompt(text)) {
      lastSubstantiveUserText = text;
    }
  }

  const hints = {
    firstUserText,
    lastUserText: lastSubstantiveUserText || lastUserText,
    hasFollowUpTurns: Boolean(userCount > 1 || hasLaterStep),
    hasPendingAskQuestion: isPendingAskQuestionInSteps(tailSteps),
  };
  setTranscriptPromptHintCache(cacheKey, {
    mtimeMs: st.mtimeMs,
    size: st.size,
    updatedAt,
    stepCount,
    hints,
  });
  return hints;
}

function getCachedQueuedMsg(cacheKey) {
  if (!parsedQueuedMsgCache.has(cacheKey)) return null;
  const value = parsedQueuedMsgCache.get(cacheKey);
  parsedQueuedMsgCache.delete(cacheKey);
  parsedQueuedMsgCache.set(cacheKey, value);
  return value;
}

function setCachedQueuedMsg(cacheKey, value) {
  if (parsedQueuedMsgCache.has(cacheKey)) {
    parsedQueuedMsgCache.delete(cacheKey);
  } else if (parsedQueuedMsgCache.size >= MAX_QUEUED_MSG_CACHE) {
    const oldestKey = parsedQueuedMsgCache.keys().next().value;
    if (oldestKey !== undefined) parsedQueuedMsgCache.delete(oldestKey);
  }
  parsedQueuedMsgCache.set(cacheKey, value);
}

function readProtobufVarint(buf, offset) {
  let result = 0n;
  let shift = 0n;
  let pos = offset;
  while (pos < buf.length && shift < 64n) {
    const byte = buf[pos++];
    result |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      return { value: result, nextOffset: pos };
    }
    shift += 7n;
  }
  return null;
}

function iterProtobufFields(buf) {
  const fields = [];
  let pos = 0;
  while (pos < buf.length) {
    const tagRes = readProtobufVarint(buf, pos);
    if (!tagRes) break;
    pos = tagRes.nextOffset;
    const tag = Number(tagRes.value);
    const fieldNo = tag >>> 3;
    const wireType = tag & 7;
    if (fieldNo <= 0) break;
    if (wireType === 0) {
      const valRes = readProtobufVarint(buf, pos);
      if (!valRes) break;
      pos = valRes.nextOffset;
    } else if (wireType === 1) {
      if (pos + 8 > buf.length) break;
      pos += 8;
    } else if (wireType === 5) {
      if (pos + 4 > buf.length) break;
      pos += 4;
    } else if (wireType === 2) {
      const lenRes = readProtobufVarint(buf, pos);
      if (!lenRes) break;
      const len = Number(lenRes.value);
      pos = lenRes.nextOffset;
      if (!Number.isSafeInteger(len) || len < 0 || pos + len > buf.length) break;
      fields.push({ fieldNo, wireType, bytes: buf.subarray(pos, pos + len) });
      pos += len;
    } else {
      break;
    }
  }
  return fields;
}

function decodeProtobufTimestampSeconds(buf) {
  if (!buf?.length) return 0;
  let pos = 0;
  while (pos < buf.length) {
    const tagRes = readProtobufVarint(buf, pos);
    if (!tagRes) break;
    pos = tagRes.nextOffset;
    const tag = Number(tagRes.value);
    const fieldNo = tag >>> 3;
    const wireType = tag & 7;
    if (fieldNo <= 0) break;
    if (wireType === 0) {
      const valRes = readProtobufVarint(buf, pos);
      if (!valRes) break;
      pos = valRes.nextOffset;
      if (fieldNo === 1) {
        const sec = Number(valRes.value);
        if (Number.isFinite(sec) && sec > 0) return sec;
      }
    } else if (wireType === 1) {
      if (pos + 8 > buf.length) break;
      pos += 8;
    } else if (wireType === 5) {
      if (pos + 4 > buf.length) break;
      pos += 4;
    } else if (wireType === 2) {
      const lenRes = readProtobufVarint(buf, pos);
      if (!lenRes) break;
      const len = Number(lenRes.value);
      pos = lenRes.nextOffset;
      if (!Number.isSafeInteger(len) || len < 0 || pos + len > buf.length) break;
      pos += len;
    } else {
      break;
    }
  }
  return 0;
}

export function decodeAntigravityErrorStepPayload(payloadBuf, metadataBuf = null) {
  const buf = Buffer.isBuffer(payloadBuf) ? payloadBuf : (payloadBuf ? Buffer.from(payloadBuf) : null);
  if (!buf?.length) return null;
  let userMessage = "";
  let shortError = "";
  let fullError = "";
  let fallbackError = "";
  let model = "";
  let reason = "";
  for (const topField of iterProtobufFields(buf)) {
    if (topField.fieldNo !== 24) continue;
    for (const errContainer of iterProtobufFields(topField.bytes)) {
      if (errContainer.fieldNo !== 3) continue;
      for (const errField of iterProtobufFields(errContainer.bytes)) {
        if (errField.fieldNo === 1 && !userMessage) {
          userMessage = errField.bytes.toString("utf8").trim();
        } else if (errField.fieldNo === 2 && !shortError) {
          shortError = errField.bytes.toString("utf8").trim();
        } else if (errField.fieldNo === 3 && !fullError) {
          fullError = errField.bytes.toString("utf8").trim();
        } else if (errField.fieldNo === 9 && !fallbackError) {
          fallbackError = errField.bytes.toString("utf8").trim();
        } else if (errField.fieldNo === 10 && (!model || !reason)) {
          try {
            const detailJson = JSON.parse(errField.bytes.toString("utf8"));
            if (!model && detailJson?.metadata?.model) model = String(detailJson.metadata.model).trim();
            if (!reason && detailJson?.reason) reason = String(detailJson.reason).trim();
          } catch {
            // Ignore non-JSON detail entry.
          }
        }
      }
    }
  }
  const primaryDetail = shortError || fallbackError;
  let message = "";
  if (userMessage && primaryDetail) {
    message = primaryDetail.toLowerCase().includes(userMessage.toLowerCase())
      ? primaryDetail
      : `${userMessage}\n${primaryDetail}`;
  } else {
    message = userMessage
      || primaryDetail
      || (fullError ? (fullError.split(/\r?\n/)[0]?.trim() || "") : "");
  }
  if (!message) return null;
  const isRetryAttempt = !userMessage && /^API error \(attempt \d+\):/i.test(primaryDetail);
  const detail = fullError && fullError !== message && fullError !== primaryDetail
    ? fullError.slice(0, 4000)
    : "";
  let createdAtSec = 0;
  const meta = Buffer.isBuffer(metadataBuf) ? metadataBuf : (metadataBuf ? Buffer.from(metadataBuf) : null);
  if (meta?.length) {
    for (const mf of iterProtobufFields(meta)) {
      if (mf.fieldNo === 1) {
        createdAtSec = decodeProtobufTimestampSeconds(mf.bytes);
        if (createdAtSec > 0) break;
      }
    }
  }
  return {
    message,
    shortError: primaryDetail || message,
    userMessage,
    detail,
    model,
    reason,
    isRetryAttempt,
    createdAt: createdAtSec > 0 ? new Date(createdAtSec * 1000).toISOString() : "",
    createdAtSec,
  };
}

export function readAntigravityTailErrorSync(appDataDir, rawId) {
  const cleanId = String(rawId || "").trim();
  if (!appDataDir || !cleanId) return null;
  const dbPath = resolve(appDataDir, "conversations", `${cleanId}.db`);
  let dbSt;
  try {
    dbSt = statSync(dbPath);
    if (!dbSt.isFile() || dbSt.size <= 0) return null;
  } catch {
    return null;
  }
  let walMtimeMs = 0;
  let walSize = 0;
  try {
    const walSt = statSync(`${dbPath}-wal`);
    if (walSt.isFile()) {
      walMtimeMs = Number(walSt.mtimeMs || 0);
      walSize = Number(walSt.size || 0);
    }
  } catch {
    // Ignore missing WAL file.
  }

  const cacheKey = `${appDataDir}|${cleanId}`;
  const cached = tailErrorCache.get(cacheKey);
  if (
    cached
    && cached.dbMtimeMs === dbSt.mtimeMs
    && cached.dbSize === dbSt.size
    && cached.walMtimeMs === walMtimeMs
    && cached.walSize === walSize
  ) {
    setBoundedLruCache(tailErrorCache, MAX_TAIL_ERROR_CACHE, cacheKey, cached);
    return cached.value ? { ...cached.value } : null;
  }

  let db;
  try {
    db = new DatabaseSync(dbPath, { open: true, readOnly: true });
    const rows = db.prepare(
      "SELECT idx, step_type, metadata, step_payload FROM steps ORDER BY idx DESC LIMIT 6",
    ).all();
    let tailErr = null;
    for (const row of rows) {
      const stepType = Number(row?.step_type);
      if (stepType === 101) continue;
      if (stepType === 17) {
        const decoded = decodeAntigravityErrorStepPayload(row?.step_payload, row?.metadata);
        if (decoded?.message) {
          tailErr = {
            stepIndex: Number(row.idx),
            message: decoded.message,
            shortError: decoded.shortError,
            detail: decoded.detail,
            model: decoded.model,
            reason: decoded.reason,
            isRetryAttempt: decoded.isRetryAttempt,
            createdAt: decoded.createdAt,
            createdAtSec: decoded.createdAtSec,
          };
        }
      }
      break;
    }
    setBoundedLruCache(tailErrorCache, MAX_TAIL_ERROR_CACHE, cacheKey, {
      dbMtimeMs: dbSt.mtimeMs,
      dbSize: dbSt.size,
      walMtimeMs,
      walSize,
      value: tailErr,
    });
    return tailErr ? { ...tailErr } : null;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close errors.
    }
  }
}

function readAntigravityErrorSteps(appDataDir, rawId) {
  const dbPath = resolve(appDataDir, "conversations", `${rawId}.db`);
  if (!existsSync(dbPath)) return [];
  let db;
  try {
    db = new DatabaseSync(dbPath, { open: true, readOnly: true });
    const rows = db.prepare(
      "SELECT idx, metadata, step_payload FROM steps WHERE step_type = 17 ORDER BY idx ASC",
    ).all();
    const out = [];
    for (const row of rows) {
      const decoded = decodeAntigravityErrorStepPayload(row?.step_payload, row?.metadata);
      if (!decoded?.message) continue;
      out.push({
        step_index: Number(row.idx),
        type: "ERROR_MESSAGE",
        status: "ERROR",
        created_at: decoded.createdAt || "",
        content: decoded.message,
        shortError: decoded.shortError || "",
        detail: decoded.detail || "",
        isRetryAttempt: Boolean(decoded.isRetryAttempt),
        ...(decoded.model ? { model: decoded.model } : {}),
      });
    }
    return out;
  } catch {
    return [];
  } finally {
    try {
      db?.close();
    } catch {
      // Ignore close errors.
    }
  }
}

function decodeAntigravityMediaField(bytes) {
  let mimeType = "";
  let name = "";
  let uri = "";
  for (const field of iterProtobufFields(bytes)) {
    if (field.fieldNo === 1) {
      mimeType = field.bytes.toString("utf8").trim();
    } else if (field.fieldNo === 4) {
      name = field.bytes.toString("utf8").trim();
    } else if (field.fieldNo === 5) {
      uri = field.bytes.toString("utf8").trim();
    }
    // fieldNo === 6 carries raw image bytes; intentionally skip decoding.
  }
  if (!mimeType && !uri && !name) return null;
  if (mimeType && !mimeType.startsWith("image/")) return null;
  return {
    name: name || "图片",
    mimeType,
    path: uri,
  };
}

/**
 * Decode Antigravity queued message stepPayload (base64 Protobuf wire-format).
 * Extracts text and attached image metadata while skipping embedded raw bytes.
 */
export function decodeAntigravityStepPayload(base64Payload) {
  const clean = String(base64Payload || "").trim();
  if (!clean) return { text: "", images: [] };
  let buf;
  try {
    buf = Buffer.from(clean, "base64");
  } catch {
    return { text: "", images: [] };
  }
  if (!buf.length) return { text: "", images: [] };

  const primaryTexts = [];
  const chunkTexts = [];
  const images = [];

  for (const topField of iterProtobufFields(buf)) {
    if (topField.fieldNo !== 19) continue;
    for (const subField of iterProtobufFields(topField.bytes)) {
      if (subField.fieldNo === 2) {
        const value = subField.bytes.toString("utf8");
        if (value) primaryTexts.push(value);
      } else if (subField.fieldNo === 3) {
        for (const chunkField of iterProtobufFields(subField.bytes)) {
          if (chunkField.fieldNo === 1) {
            const value = chunkField.bytes.toString("utf8");
            if (value) chunkTexts.push(value);
          }
        }
      } else if (subField.fieldNo === 9) {
        const media = decodeAntigravityMediaField(subField.bytes);
        if (media) images.push(media);
      }
    }
  }

  const rawText = primaryTexts.join("\n").trim() || chunkTexts.join("").trim();
  const text = stripPromptNoise(rawText).trim();
  return { text, images };
}

function antigravityMessagesDir(appDataDir, rawId) {
  const cleanId = String(rawId || "").trim();
  if (!appDataDir || !cleanId) return "";
  return resolve(appDataDir, "brain", cleanId, ".system_generated", "messages");
}

function parseAntigravityMessageRecord(rawJson, msgId, mtimeMs, size, msgPath, profileType) {
  if (!rawJson || typeof rawJson !== "object") return null;
  if (rawJson.hideFromUser === true) return null;
  if (rawJson.sender && rawJson.sender !== "user") return null;

  const cacheKey = `${msgPath}:${Math.floor(mtimeMs)}:${size}`;
  let decoded = getCachedQueuedMsg(cacheKey);
  if (!decoded) {
    if (typeof rawJson.stepPayload === "string" && rawJson.stepPayload.trim()) {
      decoded = decodeAntigravityStepPayload(rawJson.stepPayload);
    } else {
      const rawContent = stripPromptNoise(String(rawJson.content || "")).trim();
      decoded = { text: rawContent, images: [] };
    }
    setCachedQueuedMsg(cacheKey, decoded);
  }

  const images = Array.isArray(decoded.images) ? decoded.images : [];
  const text = String(decoded.text || "").trim();
  if (!text && images.length === 0) return null;

  const parsedTsMs = Date.parse(String(rawJson.timestamp || "").trim());
  const createdAtMs = Number.isFinite(parsedTsMs) ? parsedTsMs : mtimeMs;
  const createdAt = Math.floor(createdAtMs / 1000);
  const isCli = profileType === "cli";

  return {
    id: String(rawJson.id || msgId),
    createdAt,
    createdAtMs,
    text,
    model: "",
    effort: "",
    permissionMode: "",
    goalMode: false,
    imageCount: images.length,
    images,
    source: isCli ? "antigravity-cli" : "antigravity-desktop",
    sourceLabel: isCli ? "CLI 队列" : "桌面端队列",
    canCancel: false,
  };
}

/**
 * Synchronously count undelivered user queued messages for listThreads badges.
 */
export function countAntigravityNativeQueuedMessages(appDataDir, rawId) {
  const messagesDir = antigravityMessagesDir(appDataDir, rawId);
  if (!messagesDir) return 0;
  const undeliveredDir = resolve(messagesDir, "undelivered");
  let names;
  try {
    names = readdirSync(undeliveredDir);
  } catch {
    return 0;
  }
  const candidateIds = names.filter((name) => name && !name.startsWith("."));
  if (!candidateIds.length) return 0;

  let readMap = null;
  try {
    const rawRead = readFileSync(resolve(messagesDir, "read.json"), "utf8");
    const parsedRead = JSON.parse(rawRead);
    if (parsedRead && typeof parsedRead === "object") readMap = parsedRead;
  } catch {
    readMap = null;
  }

  let count = 0;
  for (const msgId of candidateIds) {
    if (readMap?.[msgId] === true) continue;
    const msgPath = resolve(messagesDir, `${msgId}.json`);
    try {
      const st = statSync(msgPath);
      if (!st.isFile()) continue;
      const raw = JSON.parse(readFileSync(msgPath, "utf8"));
      if (raw?.hideFromUser === true || (raw?.sender && raw.sender !== "user")) continue;
      count += 1;
    } catch {
      // Ignore transient or missing message JSON files.
    }
  }
  return count;
}

/**
 * Asynchronously read ordered undelivered user messages for a conversation.
 */
export async function readAntigravityQueuedMessages(appDataDir, rawId, { profileType = "desktop" } = {}) {
  const messagesDir = antigravityMessagesDir(appDataDir, rawId);
  if (!messagesDir) return [];
  const undeliveredDir = resolve(messagesDir, "undelivered");
  let names;
  try {
    names = await readdir(undeliveredDir);
  } catch {
    return [];
  }
  const candidateIds = names.filter((name) => name && !name.startsWith("."));
  if (!candidateIds.length) return [];

  let readMap = null;
  try {
    const rawRead = await readFile(resolve(messagesDir, "read.json"), "utf8");
    const parsedRead = JSON.parse(rawRead);
    if (parsedRead && typeof parsedRead === "object") readMap = parsedRead;
  } catch {
    readMap = null;
  }

  const items = [];
  for (const msgId of candidateIds) {
    if (readMap?.[msgId] === true) continue;
    const msgPath = resolve(messagesDir, `${msgId}.json`);
    try {
      const st = await stat(msgPath);
      if (!st.isFile()) continue;
      const rawJson = JSON.parse(await readFile(msgPath, "utf8"));
      const parsed = parseAntigravityMessageRecord(
        rawJson,
        msgId,
        st.mtimeMs,
        st.size,
        msgPath,
        profileType,
      );
      if (parsed) items.push(parsed);
    } catch {
      // Ignore transient or malformed message files.
    }
  }

  items.sort((a, b) => (a.createdAtMs - b.createdAtMs) || a.id.localeCompare(b.id));
  return items.map(({ createdAtMs: _ignored, ...rest }, index) => ({
    ...rest,
    position: index + 1,
  }));
}

export const ANTIGRAVITY_STALE_LIVE_AGE_MS = 10 * 60 * 1000;
export const ANTIGRAVITY_TERMINAL_STEP_GRACE_MS = 30 * 1000;

function parseTimestampMs(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? value : value * 1000;
  }
  const text = String(value || "").trim().replace(" ", "T");
  if (!text) return fallback;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseTimestampSeconds(value, fallback = 0) {
  const ms = parseTimestampMs(value, NaN);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : fallback;
}

export function isAntigravityDiskLive({
  flaggedLive = false,
  updatedAtMs = 0,
  transcriptMtimeMs = 0,
  nowMs = Date.now(),
  staleLiveAgeMs = ANTIGRAVITY_STALE_LIVE_AGE_MS,
} = {}) {
  if (!flaggedLive) return false;
  const maxAge = Number(staleLiveAgeMs);
  if (!Number.isFinite(maxAge) || maxAge <= 0) return true;
  const lastDiskMs = Math.max(Number(updatedAtMs) || 0, Number(transcriptMtimeMs) || 0);
  if (lastDiskMs <= 0) return true;
  return (nowMs - lastDiskMs) <= maxAge;
}

function isTerminalAntigravityPlannerStep(step) {
  if (!step || step.type !== "PLANNER_RESPONSE" || step.status === "RUNNING") return false;
  const tools = (Array.isArray(step.tool_calls) ? step.tool_calls : [])
    .filter((tc) => tc?.name && tc.name !== "exit_plan_mode" && tc.name !== "enter_plan_mode");
  if (tools.length > 0) return false;
  if (Array.isArray(step.truncated_fields) && step.truncated_fields.includes("tool_calls")) return false;
  return typeof step.content === "string" && step.content.trim().length > 0;
}

export function decodeWorkspaceUri(workspaceUrisRaw, { homeDir = os.homedir() } = {}) {
  let list = [];
  if (Array.isArray(workspaceUrisRaw)) {
    list = workspaceUrisRaw;
  } else if (typeof workspaceUrisRaw === "string" && workspaceUrisRaw.trim()) {
    try {
      const parsed = JSON.parse(workspaceUrisRaw);
      if (Array.isArray(parsed)) list = parsed;
      else if (typeof parsed === "string") list = [parsed];
      else list = [workspaceUrisRaw];
    } catch {
      list = [workspaceUrisRaw];
    }
  }
  const paths = list.map(decodeFileUri).filter(Boolean);
  if (!paths.length) return "";
  for (let i = paths.length - 1; i >= 0; i -= 1) {
    if (!isUserHomePath(paths[i], homeDir)) {
      return paths[i];
    }
  }
  return paths[0];
}

function mapIndexedRowToThread(row, appDataDir, profileType = "desktop", {
  nowMs = Date.now(),
  staleLiveAgeMs = ANTIGRAVITY_STALE_LIVE_AGE_MS,
} = {}) {
  const id = String(row?.conversation_id || "").trim();
  if (!id) return null;
  // Desktop DB mirrors antigravity-cli sessions under source = CORTEX_TRAJECTORY_SOURCE_CLI; filter if brain folder isn't owned here.
  if (profileType === "desktop" && row.source === "CORTEX_TRAJECTORY_SOURCE_CLI") {
    const localBrain = resolve(appDataDir, "brain", id);
    if (!existsSync(localBrain)) return null;
  }
  const cwd = decodeWorkspaceUri(row.workspace_uris) || os.homedir();
  if (isInternalVoiceCallThread({ cwd, title: row.title, preview: row.preview })) {
    return null;
  }
  const flaggedLive = Boolean(row.not_fully_idle && !row.killed);
  const updatedAtMs = parseTimestampMs(row.last_modified_time);
  let live = flaggedLive;
  if (flaggedLive && updatedAtMs > 0 && (nowMs - updatedAtMs) > staleLiveAgeMs) {
    let transcriptMtimeMs = 0;
    try {
      const compactPath = resolve(appDataDir, "brain", id, ".system_generated", "logs", "transcript.jsonl");
      const cst = statSync(compactPath);
      if (cst?.isFile()) transcriptMtimeMs = cst.mtimeMs;
    } catch {
      transcriptMtimeMs = 0;
    }
    live = isAntigravityDiskLive({
      flaggedLive,
      updatedAtMs,
      transcriptMtimeMs,
      nowMs,
      staleLiveAgeMs,
    });
  }
  const isSubagent = Boolean(row.parent_conversation_id && String(row.parent_conversation_id).trim());
  return {
    id,
    title: String(row.title || ""),
    name: String(row.title || ""),
    preview: cleanPreviewText(row.preview || row.title || "", 120),
    cwd,
    updatedAt: parseTimestampSeconds(row.last_modified_time),
    createdAt: parseTimestampSeconds(row.last_modified_time),
    stepCount: Number(row.step_count) || 0,
    threadSource: isSubagent ? "subagent" : "user",
    parentConversationId: row.parent_conversation_id || "",
    live,
    nativeQueuedCount: countAntigravityNativeQueuedMessages(appDataDir, id),
  };
}

export function readAntigravityIndexedThreadById(appDataDir, rawId, {
  profileType = "desktop",
  nowMs = Date.now(),
  staleLiveAgeMs = ANTIGRAVITY_STALE_LIVE_AGE_MS,
} = {}) {
  const cleanId = String(rawId || "").trim();
  if (!cleanId) return null;
  const dbPath = antigravitySummaryDbPath(appDataDir);
  if (!existsSync(dbPath)) return null;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const sql = `
      SELECT
        conversation_id,
        title,
        preview,
        step_count,
        last_modified_time,
        workspace_uris,
        status,
        source,
        parent_conversation_id,
        not_fully_idle,
        killed,
        app_data_dir
      FROM conversation_summaries
      WHERE conversation_id = ?
      LIMIT 1
    `;
    const row = db.prepare(sql).get(cleanId);
    if (!row) return null;
    const mapped = mapIndexedRowToThread(row, appDataDir, profileType, { nowMs, staleLiveAgeMs });
    if (!mapped) return null;
    if (mapped.threadSource !== "subagent" && (mapped.stepCount >= 2 || mapped.live)) {
      const hints = readAntigravityPromptHintsSync(appDataDir, mapped.id, {
        updatedAt: mapped.updatedAt,
        stepCount: mapped.stepCount,
      });
      if (hints) {
        if (hints.firstUserText) mapped.firstUserText = hints.firstUserText;
        if (hints.lastUserText) mapped.lastUserText = hints.lastUserText;
        if (hints.hasFollowUpTurns) mapped.hasFollowUpTurns = true;
        if (hints.hasPendingAskQuestion) mapped.live = false;
      }
    }
    if (mapped.threadSource !== "subagent" && !mapped.live) {
      const tailErr = readAntigravityTailErrorSync(appDataDir, mapped.id);
      if (tailErr?.message) {
        mapped.lastTurnStatus = "failed";
        mapped.lastError = tailErr.shortError || tailErr.message;
        mapped.lastErrorAt = tailErr.createdAtSec || mapped.updatedAt;
      }
    }
    return mapped;
  } finally {
    db.close();
  }
}

export const readAntigravitySingleThreadSummary = readAntigravityIndexedThreadById;

export function resolveAntigravityRootConversationId(appDataDir, rawId, { maxDepth = 8 } = {}) {
  const startId = String(rawId || "").trim();
  if (!appDataDir || !startId) return startId;
  const dbPath = antigravitySummaryDbPath(appDataDir);
  if (!existsSync(dbPath)) return startId;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const stmt = db.prepare("SELECT parent_conversation_id FROM conversation_summaries WHERE conversation_id = ? LIMIT 1");
    let current = startId;
    const visited = new Set();
    for (let depth = 0; depth < maxDepth; depth += 1) {
      if (!current || visited.has(current)) break;
      visited.add(current);
      const row = stmt.get(current);
      const parentId = String(row?.parent_conversation_id || "").trim();
      if (!parentId || parentId === current || visited.has(parentId)) break;
      current = parentId;
    }
    return current || startId;
  } catch {
    return startId;
  } finally {
    db.close();
  }
}

function cleanLiveSingleLine(value, maxLen = 72) {
  const clean = String(value || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > maxLen ? `${clean.slice(0, maxLen).trim()}…` : clean;
}

function shortLivePathLabel(rawPath) {
  const clean = String(rawPath || "").replace(/^file:\/\//i, "").replace(/^["']+|["']+$/g, "").trim();
  if (!clean) return "";
  const parts = clean.split(/[/\\]+/).filter((seg) => seg && seg !== "." && seg !== "..");
  return parts.length ? parts[parts.length - 1] : "";
}

function describeAgyToolCall(tc) {
  const name = String(tc?.name || "").trim();
  const args = unwrapToolArgs(tc?.args);
  const targetPath = extractToolTargetPath(name, args);
  const shortFile = shortLivePathLabel(targetPath);
  if (/^(?:run_command|exec_command|Bash|bash)$/i.test(name)) {
    const summary = cleanLiveSingleLine(args.toolSummary || args.CommandLine || args.command || "", 72);
    return {
      phase: "正在执行命令…",
      detail: summary,
      label: summary || shortFile || "命令",
    };
  }
  if (/^(?:edit_file|write_file|write_to_file|replace_file_content|multi_replace_file_content|multi_edit)$/i.test(name)) {
    return {
      phase: shortFile ? `正在修改 ${shortFile}…` : "正在修改代码…",
      detail: "",
      label: shortFile || "修改代码",
    };
  }
  if (/^(?:read_file|view_file|list_dir|view_file_outline|view_code_item)$/i.test(name)) {
    return {
      phase: shortFile ? `正在查阅 ${shortFile}…` : "正在查阅文件…",
      detail: "",
      label: shortFile || "查阅文件",
    };
  }
  if (/grep|glob|find_by_name|search/i.test(name)) {
    const q = cleanLiveSingleLine(args.Query || args.query || args.Pattern || args.SearchPath || "", 60);
    return {
      phase: "正在检索代码…",
      detail: q,
      label: q || "检索代码",
    };
  }
  return {
    phase: name ? `正在调用 ${name}` : "正在执行操作…",
    detail: cleanLiveSingleLine(args.toolSummary || "", 60),
    label: name || "工具调用",
  };
}

async function readTranscriptTailSteps(compactPath, maxBytes = 32768) {
  const st = await stat(compactPath).catch(() => null);
  if (!st?.isFile()) return { stat: null, steps: [] };
  if (st.size <= 0) return { stat: st, steps: [] };

  let text = "";
  if (st.size <= maxBytes) {
    text = await readFile(compactPath, "utf8").catch(() => "");
  } else {
    const fh = await open(compactPath, "r").catch(() => null);
    if (fh) {
      try {
        const readLen = Math.min(maxBytes, st.size);
        const offset = Math.max(0, st.size - readLen);
        const buf = Buffer.allocUnsafe(readLen);
        const { bytesRead } = await fh.read(buf, 0, readLen, offset);
        const raw = buf.subarray(0, bytesRead).toString("utf8");
        const firstNewline = offset > 0 ? raw.indexOf("\n") : -1;
        text = firstNewline >= 0 ? raw.slice(firstNewline + 1) : raw;
      } finally {
        await fh.close().catch(() => {});
      }
    }
  }

  const steps = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      steps.push(JSON.parse(line));
    } catch {
      // Ignore truncated/incomplete JSON line.
    }
  }
  return { stat: st, steps };
}

function cleanAsyncTaskDescription(rawDesc = "") {
  const clean = String(rawDesc || "").trim();
  if (!clean) return "后台任务进行中";
  if (/^Timer:/i.test(clean)) {
    return cleanLiveSingleLine(clean.replace(/,?\s*Prompt:.*$/i, ""), 48) || "Timer 等待中";
  }
  return cleanLiveSingleLine(clean, 48) || "后台任务进行中";
}

function collectPendingAntigravityAsyncWork(steps) {
  const pending = new Map();
  const pendingSchedules = [];
  const pendingSubagentRoles = [];

  for (const step of steps) {
    if (!step || typeof step !== "object") continue;

    if (step.type === "PLANNER_RESPONSE") {
      const toolCalls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
      for (const tc of toolCalls) {
        if (!tc || typeof tc !== "object") continue;
        const name = String(tc.name || "");
        const args = unwrapToolArgs(tc.args);
        if (name === "schedule") {
          pendingSchedules.push({ timerCondition: String(args.TimerCondition || "").trim() });
        } else if (name === "invoke_subagent") {
          pendingSubagentRoles.push(cleanLiveSingleLine(args.Role || args.TypeName || "子代理", 36));
        } else if (name === "manage_task") {
          if (String(args.Action || "") === "kill" && args.TaskId) {
            const target = String(args.TaskId).trim();
            for (const key of pending.keys()) {
              if (key === target || key.endsWith(`/${target}`)) {
                pending.delete(key);
              }
            }
          }
        } else if (name === "manage_subagents") {
          const action = String(args.Action || "");
          if (action === "kill_all") {
            for (const [key, entry] of pending.entries()) {
              if (entry.kind === "subagent") pending.delete(key);
            }
          } else if (action === "kill" && Array.isArray(args.ConversationIds)) {
            for (const cid of args.ConversationIds) {
              pending.delete(String(cid || "").trim());
            }
          }
        }
      }
      continue;
    }

    if (step.type === "GENERIC") {
      const content = String(step.content || "");
      if (step.status === "RUNNING") {
        const taskMatch = /background task with task id:\s*([^\s\r\n]+)/i.exec(content);
        const descMatch = /Task Description:\s*([^\r\n]+)/i.exec(content);
        const rawDesc = descMatch?.[1] || "";
        const sched = /^Timer:/i.test(rawDesc) && pendingSchedules.length ? pendingSchedules.shift() : null;
        const key = taskMatch?.[1] || `step-${step.step_index ?? pending.size}`;
        pending.set(key, {
          kind: "task",
          label: cleanAsyncTaskDescription(rawDesc),
          timerCondition: sched?.timerCondition || "",
        });
      } else if (pendingSubagentRoles.length > 0) {
        const subMatch = /"conversationId"\s*:\s*"([0-9a-f-]{8,})"/i.exec(content)
          || /\bconversationId:\s*([0-9a-f-]{8,})/i.exec(content);
        if (subMatch?.[1]) {
          const role = pendingSubagentRoles.shift();
          pending.set(subMatch[1], {
            kind: "subagent",
            label: role ? `子代理 ${role}` : "子代理执行中",
            timerCondition: "",
          });
        }
      }
      continue;
    }

    if (step.type === "SYSTEM_MESSAGE") {
      const content = String(step.content || "");
      if (/subagents and background tasks have been stopped/i.test(content)) {
        pending.clear();
        pendingSchedules.length = 0;
        pendingSubagentRoles.length = 0;
        continue;
      }
      const senderMatch = /\bsender=([^\s\r\n]+)/.exec(content);
      if (senderMatch?.[1]) {
        const senderId = senderMatch[1];
        pending.delete(senderId);
        for (const [key, entry] of pending.entries()) {
          if (entry.timerCondition === senderId || (senderId !== "system" && entry.timerCondition === "any")) {
            pending.delete(key);
          }
        }
      }
    }
  }

  const values = [...pending.values()];
  return {
    hasPending: values.length > 0,
    count: values.length,
    latestLabel: values.length ? values[values.length - 1].label : "",
  };
}

export async function readAntigravityLiveActivity(appDataDir, rawId, {
  indexedThread = null,
  profileType = "desktop",
  nowMs = Date.now(),
  staleLiveAgeMs = ANTIGRAVITY_STALE_LIVE_AGE_MS,
  terminalStepGraceMs = ANTIGRAVITY_TERMINAL_STEP_GRACE_MS,
} = {}) {
  const cleanId = String(rawId || "").trim();
  const summary = indexedThread || (cleanId
    ? readAntigravityIndexedThreadById(appDataDir, cleanId, { profileType, nowMs, staleLiveAgeMs })
    : null);
  const compactPath = cleanId
    ? resolve(appDataDir, "brain", cleanId, ".system_generated", "logs", "transcript.jsonl")
    : "";
  const [{ stat: st, steps }, nativeQueuedTurns] = await Promise.all([
    compactPath
      ? readTranscriptTailSteps(compactPath)
      : Promise.resolve({ stat: null, steps: [] }),
    cleanId
      ? readAntigravityQueuedMessages(appDataDir, cleanId, { profileType })
      : Promise.resolve([]),
  ]);

  let lastThought = "";
  let lastPlanner = null;
  let lastEffective = null;
  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    if (step.type === "USER_INPUT" && step.source && step.source !== "USER_EXPLICIT") continue;
    if (step.type === "USER_INPUT" || step.type === "PLANNER_RESPONSE" || step.type === "GENERIC") {
      lastEffective = step;
    }
    if (step.type === "USER_INPUT" && step.source === "USER_EXPLICIT") {
      lastThought = "";
    }
    if (step.type === "PLANNER_RESPONSE") {
      lastPlanner = step;
      if (typeof step.thinking === "string" && step.thinking.trim()) {
        lastThought = step.thinking.trim().slice(-800);
      }
    }
  }

  const pendingAsync = collectPendingAntigravityAsyncWork(steps);
  const pendingAskQuestion = isPendingAskQuestionInSteps(steps);
  const terminalPlanner = isTerminalAntigravityPlannerStep(lastEffective);
  if (terminalPlanner || pendingAskQuestion) {
    lastThought = "";
  }

  const transcriptMtimeMs = st?.mtimeMs ? Number(st.mtimeMs) : 0;
  const summaryUpdatedMs = Number(summary?.updatedAt) > 0 ? Number(summary.updatedAt) * 1000 : 0;
  let live = pendingAskQuestion
    ? false
    : isAntigravityDiskLive({
      flaggedLive: Boolean(summary?.live),
      updatedAtMs: summaryUpdatedMs,
      transcriptMtimeMs,
      nowMs,
      staleLiveAgeMs,
    });
  if (live && terminalPlanner && !pendingAsync.hasPending) {
    const lastDiskMs = Math.max(summaryUpdatedMs, transcriptMtimeMs);
    if (lastDiskMs > 0 && (nowMs - lastDiskMs) > terminalStepGraceMs) {
      live = false;
    }
  }

  let phase = "";
  let detail = "";
  if (live) {
    const plannerTools = (Array.isArray(lastPlanner?.tool_calls) ? lastPlanner.tool_calls : [])
      .filter((tc) => tc?.name && tc.name !== "exit_plan_mode" && tc.name !== "enter_plan_mode");
    const lastToolDesc = plannerTools.length
      ? describeAgyToolCall(plannerTools[plannerTools.length - 1])
      : null;

    if (lastEffective?.type === "PLANNER_RESPONSE") {
      if (terminalPlanner) {
        phase = "等待子代理或后台任务完成…";
        const stepPart = summary?.stepCount ? `已执行 ${summary.stepCount} 步` : "";
        detail = pendingAsync.latestLabel
          ? (stepPart ? `${pendingAsync.latestLabel} · ${stepPart}` : pendingAsync.latestLabel)
          : stepPart;
      } else if (lastToolDesc) {
        phase = lastToolDesc.phase;
        detail = lastToolDesc.detail;
      } else if (Array.isArray(lastEffective.truncated_fields) && lastEffective.truncated_fields.includes("tool_calls")) {
        phase = "正在执行工具…";
        detail = summary?.stepCount ? `已执行 ${summary.stepCount} 步` : "";
      } else if (lastEffective.thinking || lastEffective.status === "RUNNING" || !String(lastEffective.content || "").trim()) {
        phase = "正在思考分析…";
        detail = summary?.stepCount ? `已执行 ${summary.stepCount} 步` : "";
      }
    } else if (lastEffective?.type === "GENERIC") {
      phase = "正在思考下一步…";
      const stepPart = summary?.stepCount ? `第 ${summary.stepCount} 步` : "";
      if (lastToolDesc?.label) {
        detail = stepPart ? `已完成 ${lastToolDesc.label} · ${stepPart}` : `已完成 ${lastToolDesc.label}`;
      } else if (summary?.stepCount) {
        detail = `已执行 ${summary.stepCount} 步`;
      }
    } else if (lastEffective?.type === "USER_INPUT") {
      phase = "正在理解指令…";
      detail = summary?.stepCount ? `第 ${summary.stepCount} 步` : "";
    }

    if (!phase) {
      phase = "Antigravity 执行中";
      detail = summary?.stepCount ? `已执行 ${summary.stepCount} 步` : "";
    }
  }

  const statMtimeSec = st?.mtimeMs ? Math.floor(st.mtimeMs / 1000) : 0;
  const updatedAt = Math.max(Number(summary?.updatedAt) || 0, statMtimeSec);
  const queueSig = nativeQueuedTurns.map((item) => item.id).join(",");
  const cursor = `${live ? 1 : 0}:${st?.size || 0}:${Math.floor(st?.mtimeMs || 0)}:${summary?.stepCount || 0}:${summary?.updatedAt || 0}:q=${queueSig}:ask=${pendingAskQuestion ? 1 : 0}`;

  return {
    live,
    pendingAskQuestion,
    cursor,
    updatedAt,
    stepCount: Number(summary?.stepCount) || 0,
    phase,
    detail,
    lastThought,
    nativeQueuedTurns,
  };
}

export function readAntigravityIndexedThreads(appDataDir, {
  profileType = "desktop",
  limit = 300,
  nowMs = Date.now(),
  staleLiveAgeMs = ANTIGRAVITY_STALE_LIVE_AGE_MS,
} = {}) {
  const dbPath = antigravitySummaryDbPath(appDataDir);
  if (!existsSync(dbPath)) return null;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const sql = `
      SELECT
        conversation_id,
        title,
        preview,
        step_count,
        last_modified_time,
        workspace_uris,
        status,
        source,
        parent_conversation_id,
        not_fully_idle,
        killed,
        app_data_dir
      FROM conversation_summaries
      ORDER BY last_modified_time DESC
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(Math.max(1, Number(limit) || 300) * 2);
    const results = [];
    let hintProbed = 0;
    for (const row of rows) {
      const mapped = mapIndexedRowToThread(row, appDataDir, profileType, { nowMs, staleLiveAgeMs });
      if (!mapped) continue;
      if (mapped.threadSource !== "subagent" && (mapped.stepCount >= 1 || mapped.live) && (mapped.live || hintProbed < 80)) {
        if (!mapped.live) hintProbed += 1;
        if (mapped.stepCount >= 2 || mapped.live) {
          const hints = readAntigravityPromptHintsSync(appDataDir, mapped.id, {
            updatedAt: mapped.updatedAt,
            stepCount: mapped.stepCount,
          });
          if (hints) {
            if (hints.firstUserText) mapped.firstUserText = hints.firstUserText;
            if (hints.lastUserText) mapped.lastUserText = hints.lastUserText;
            if (hints.hasFollowUpTurns) mapped.hasFollowUpTurns = true;
            if (hints.hasPendingAskQuestion) mapped.live = false;
          }
        }
        if (!mapped.live) {
          const tailErr = readAntigravityTailErrorSync(appDataDir, mapped.id);
          if (tailErr?.message) {
            mapped.lastTurnStatus = "failed";
            mapped.lastError = tailErr.shortError || tailErr.message;
            mapped.lastErrorAt = tailErr.createdAtSec || mapped.updatedAt;
          }
        }
      }
      results.push(mapped);
      if (results.length >= limit) break;
    }
    return results;
  } finally {
    db.close();
  }
}

function unwrapToolValue(value) {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return value;
}

function unwrapToolArgs(rawArgs) {
  if (!rawArgs || typeof rawArgs !== "object" || Array.isArray(rawArgs)) return {};
  const out = {};
  for (const [k, v] of Object.entries(rawArgs)) {
    out[k] = unwrapToolValue(v);
  }
  return out;
}

export function normalizeAntigravityAskQuestions(rawArgs) {
  let raw = rawArgs;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    raw = raw.questions ?? raw.Questions ?? raw;
  }
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q, idx) => {
      if (!q || typeof q !== "object") return null;
      const question = String(q.question || q.prompt || "").trim();
      const rawOpts = Array.isArray(q.options) ? q.options : [];
      const options = rawOpts
        .map((opt) => {
          if (typeof opt === "string") return { label: opt.trim(), description: "" };
          if (!opt || typeof opt !== "object") return null;
          const label = String(opt.label || opt.name || opt.value || "").trim();
          return label ? { label, description: String(opt.description || "").trim() } : null;
        })
        .filter(Boolean);
      if (!question && !options.length) return null;
      return {
        id: String(q.id || `q_${idx}`),
        header: String(q.header || `问题 ${idx + 1}`),
        question,
        multiSelect: Boolean(q.is_multi_select ?? q.multiSelect),
        isOther: q.isOther !== false,
        options,
      };
    })
    .filter(Boolean);
}

export function extractPendingAskQuestionFromTurns(turns = []) {
  if (!Array.isArray(turns) || !turns.length) return null;
  const lastTurn = turns[turns.length - 1];
  const items = Array.isArray(lastTurn?.items) ? lastTurn.items : [];
  if (!items.length) return null;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const item = items[i];
    if (!item || typeof item !== "object") continue;
    if (item.type === "userMessage") return null;
    if (item.type === "agentMessage" && item.phase !== "commentary" && String(item.text || "").trim()) {
      return null;
    }
    if (item.type === "mcpToolCall" && item.tool === "ask_question") {
      if (item.result || item.error) return null;
      const questions = Array.isArray(item.questions) && item.questions.length
        ? item.questions
        : normalizeAntigravityAskQuestions(item.arguments);
      if (!questions.length) return null;
      return {
        turnId: String(lastTurn.id || ""),
        itemId: String(item.id || ""),
        questions,
      };
    }
  }
  return null;
}

export function isPendingAskQuestionInSteps(steps = []) {
  if (!Array.isArray(steps) || !steps.length) return false;
  let pendingAskToolIdx = -1;
  let genericCountAfterPlanner = 0;

  for (const step of steps) {
    if (!step || typeof step !== "object") continue;
    const type = String(step.type || "");
    if (type === "USER_INPUT") {
      if (step.source && step.source !== "USER_EXPLICIT") continue;
      pendingAskToolIdx = -1;
      genericCountAfterPlanner = 0;
      continue;
    }
    if (type === "ERROR_MESSAGE") {
      pendingAskToolIdx = -1;
      genericCountAfterPlanner = 0;
      continue;
    }
    if (type === "PLANNER_RESPONSE") {
      pendingAskToolIdx = -1;
      genericCountAfterPlanner = 0;
      if (step.status !== "RUNNING" && step.status !== "ERROR") {
        const toolCalls = Array.isArray(step.tool_calls) ? step.tool_calls : [];
        pendingAskToolIdx = toolCalls.findIndex((tc) => tc?.name === "ask_question");
      }
      continue;
    }
    if (type === "GENERIC" && pendingAskToolIdx >= 0) {
      const slot = genericCountAfterPlanner;
      genericCountAfterPlanner += 1;
      if (slot === pendingAskToolIdx) {
        const hasDoneOutput = step.status !== "RUNNING" && Boolean(stripToolEchoHeader(step.content || step.error || ""));
        if (step.status === "ERROR" || hasDoneOutput) {
          pendingAskToolIdx = -1;
        }
      }
    }
  }

  return pendingAskToolIdx >= 0;
}

function mapToolCallToItem(toolCall, stepIndex, toolIdx, defaultStatus = "completed") {
  const name = String(toolCall?.name || "tool");
  const args = unwrapToolArgs(toolCall?.args);
  const id = String(toolCall?.id || `agy-${stepIndex}-tool-${toolIdx}`);
  if (name === "ask_question") {
    const questions = normalizeAntigravityAskQuestions(args);
    return {
      type: "mcpToolCall",
      id,
      server: "antigravity",
      tool: "ask_question",
      arguments: args,
      ...(questions.length ? { questions } : {}),
      status: defaultStatus,
      result: null,
      error: null,
    };
  }
  if (name === "run_command" || name === "Bash" || name === "exec_command") {
    return {
      type: "commandExecution",
      id,
      command: String(args.CommandLine || args.command || ""),
      cwd: String(args.Cwd || args.cwd || ""),
      status: defaultStatus,
      aggregatedOutput: "",
    };
  }
  if (name === "write_to_file" || name === "replace_file_content" || name === "multi_replace_file_content" || name === "edit_file" || name === "write_file") {
    return {
      type: "fileChange",
      id,
      status: defaultStatus,
      changes: [{
        path: String(args.TargetFile || args.Path || args.path || ""),
        kind: name.includes("write") ? "add" : "modify",
        diff: String(args.ReplacementContent || args.Replacement || args.CodeContent || args.Content || "").slice(0, 600),
      }],
    };
  }
  return {
    type: "mcpToolCall",
    id,
    server: "antigravity",
    tool: name,
    arguments: args,
    status: defaultStatus,
    result: null,
    error: null,
  };
}

function stripToolEchoHeader(text) {
  return String(text || "")
    .replace(/^(?:(?:Created At|Completed At):[^\n]*(?:\n|$))+/i, "")
    .trim();
}

function isAntigravityStepTurnOpen(step) {
  if (!step || typeof step !== "object") return false;
  if (step.type === "USER_INPUT" || step.type === "GENERIC") return true;
  if (step.type === "PLANNER_RESPONSE") {
    if (step.status === "RUNNING") return true;
    const toolCalls = Array.isArray(step.tool_calls)
      ? step.tool_calls.filter((tc) => tc?.name && tc.name !== "exit_plan_mode")
      : [];
    if (toolCalls.length > 0) return true;
    if (!String(step.content || "").trim()) return true;
    return false;
  }
  return false;
}

function exactTranscriptStepKey(step) {
  if (!step || typeof step !== "object" || step.step_index === undefined) return "";
  return `${step.step_index}|${step.type || ""}|${step.created_at || ""}`;
}

function parseAntigravityTranscriptInternal(lines, { rawId = "", fullLinesMap = null, detail = "full", extraSteps = [] } = {}) {
  const steps = [];
  const seenIndexes = new Set();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      steps.push(parsed);
      if (Number.isInteger(Number(parsed?.step_index))) {
        seenIndexes.add(Number(parsed.step_index));
      }
    } catch {
      // Ignore partial line.
    }
  }
  if (Array.isArray(extraSteps) && extraSteps.length > 0) {
    let inserted = false;
    for (const extra of extraSteps) {
      if (!extra || typeof extra !== "object") continue;
      const idxNum = Number(extra.step_index);
      if (Number.isInteger(idxNum) && seenIndexes.has(idxNum)) continue;
      steps.push(extra);
      if (Number.isInteger(idxNum)) seenIndexes.add(idxNum);
      inserted = true;
    }
    if (inserted) {
      steps.sort((a, b) => {
        const ai = Number.isFinite(Number(a?.step_index)) ? Number(a.step_index) : Number.MAX_SAFE_INTEGER;
        const bi = Number.isFinite(Number(b?.step_index)) ? Number(b.step_index) : Number.MAX_SAFE_INTEGER;
        return ai - bi;
      });
    }
  }

  const turns = [];
  let currentTurn = null;
  let pendingToolTargets = [];
  let lastEffectiveStep = null;
  let lastModel = "";
  const usedTurnIds = new Set();
  const allocUniqueTurnId = (baseId, lineIdx) => {
    const cleanBase = baseId || `agy-turn-${turns.length + 1}`;
    const uniqueId = usedTurnIds.has(cleanBase) ? `${cleanBase}-${lineIdx}` : cleanBase;
    usedTurnIds.add(uniqueId);
    return uniqueId;
  };

  const ensureTurn = (seed, ts, lineIdx = turns.length + 1) => {
    if (!currentTurn) {
      currentTurn = {
        id: allocUniqueTurnId(seed, lineIdx),
        items: [],
        status: "completed",
        error: null,
        startedAt: ts || null,
        completedAt: ts || null,
        durationMs: null,
        model: "",
        models: [],
      };
      turns.push(currentTurn);
      pendingToolTargets = [];
    }
    return currentTurn;
  };

  for (let idx = 0; idx < steps.length; idx += 1) {
    let step = steps[idx];
    const exactKey = exactTranscriptStepKey(step);
    const exactMatch = exactKey && fullLinesMap?.get(exactKey);
    const indexMatch = !exactMatch ? fullLinesMap?.get(step?.step_index) : null;
    const fullStep = exactMatch || (
      indexMatch && (!step.created_at || !indexMatch.created_at || indexMatch.created_at === step.created_at)
        ? indexMatch
        : null
    );
    if (Array.isArray(step?.truncated_fields) && step.truncated_fields.length && fullStep) {
      if (detail === "full") {
        step = fullStep;
      } else {
        const patched = { ...step };
        if (step.truncated_fields.includes("tool_calls") && Array.isArray(fullStep?.tool_calls)) {
          patched.tool_calls = fullStep.tool_calls;
        }
        if (
          step.truncated_fields.includes("content")
          && fullStep?.content !== undefined
          && (
            step.type === "PLANNER_RESPONSE"
            || step.type === "USER_INPUT"
            || (step.type === "GENERIC" && step.status === "ERROR")
          )
        ) {
          patched.content = fullStep.content;
        }
        step = patched;
      }
    }
    const ts = parseTimestampSeconds(step?.created_at);
    const type = String(step?.type || "");

    if (type === "USER_INPUT") {
      if (step.source && step.source !== "USER_EXPLICIT") continue;
      const rawUserText = String(step.content || "").trim();
      const hasPromptWrapper = /<(?:USER_REQUEST|ADDITIONAL_METADATA|USER_SETTINGS_CHANGE|environment_context|system-reminder)\b/i.test(rawUserText);
      const cleanText = stripPromptNoise(rawUserText);
      const displayText = cleanText || (hasPromptWrapper ? "" : rawUserText);
      const content = [];
      if (Array.isArray(step.media)) {
        for (const m of step.media) {
          if (m?.uri) content.push({ type: "localImage", path: m.uri });
        }
      }
      if (displayText) {
        content.push({ type: "text", text: displayText });
      } else if (content.length === 0) {
        content.push({ type: "text", text: "" });
      }
      currentTurn = {
        id: allocUniqueTurnId(`agy-step-${step.step_index ?? idx}`, idx),
        items: [{
          type: "userMessage",
          id: `agy-user-${step.step_index ?? idx}`,
          content,
        }],
        status: "completed",
        error: null,
        startedAt: ts || null,
        completedAt: ts || null,
        durationMs: null,
        model: "",
        models: [],
      };
      turns.push(currentTurn);
      pendingToolTargets = [];
      lastEffectiveStep = step;
      continue;
    }

    if (type === "PLANNER_RESPONSE") {
      const turn = ensureTurn(`agy-step-${step.step_index ?? idx}`, ts, idx);
      const stepModel = String(step.model || "").trim();
      if (stepModel) {
        turn.model = stepModel;
        if (!Array.isArray(turn.models)) turn.models = [];
        if (!turn.models.includes(stepModel)) turn.models.push(stepModel);
        lastModel = stepModel;
      }
      const stepStatus = step.status === "RUNNING" ? "inProgress" : (step.status === "ERROR" ? "failed" : "completed");
      if (stepStatus === "inProgress") {
        turn.status = "inProgress";
        turn.error = null;
      } else if (stepStatus === "completed" && (turn.status === "inProgress" || turn.status === "failed")) {
        turn.status = "completed";
        turn.error = null;
      }

      if (step.thinking) {
        turn.items.push({
          type: "reasoning",
          id: `agy-think-${step.step_index ?? idx}`,
          summary: [],
          content: [String(step.thinking).slice(0, 3000)],
        });
      }
      if (Array.isArray(step.tool_calls)) {
        step.tool_calls.forEach((tc, toolIdx) => {
          if (tc?.name === "exit_plan_mode" || tc?.name === "enter_plan_mode") {
            pendingToolTargets.push({ type: "ignored" });
            return;
          }
          const mapped = mapToolCallToItem(tc, step.step_index ?? idx, toolIdx, stepStatus === "inProgress" ? "inProgress" : "completed");
          turn.items.push(mapped);
          pendingToolTargets.push(mapped);
        });
      }
      if (step.content) {
        turn.items.push({
          type: "agentMessage",
          id: `agy-msg-${step.step_index ?? idx}`,
          text: String(step.content),
          phase: Array.isArray(step.tool_calls) && step.tool_calls.length ? "commentary" : "final_answer",
        });
      }
      if (ts > 0) turn.completedAt = ts;
      lastEffectiveStep = step;
      continue;
    }

    if (type === "ERROR_MESSAGE") {
      const turn = ensureTurn(`agy-step-${step.step_index ?? idx}`, ts, idx);
      const stepModel = String(step.model || "").trim();
      if (stepModel) {
        if (!turn.model) turn.model = stepModel;
        if (!Array.isArray(turn.models)) turn.models = [];
        if (!turn.models.includes(stepModel)) turn.models.push(stepModel);
        lastModel = stepModel;
      }
      const errText = String(step.content || "").trim();
      if (errText) {
        turn.status = "failed";
        turn.error = {
          message: errText,
          ...(step.shortError ? { shortError: step.shortError } : {}),
          ...(step.detail ? { detail: step.detail } : {}),
          ...(step.isRetryAttempt ? { retryAttempt: true } : {}),
        };
      }
      if (ts > 0) turn.completedAt = ts;
      lastEffectiveStep = step;
      continue;
    }

    if (type === "GENERIC") {
      const turn = ensureTurn(`agy-step-${step.step_index ?? idx}`, ts, idx);
      const rawErrorSource = String(step.content || step.error || "");
      const cleanedText = stripToolEchoHeader(rawErrorSource);
      const status = String(step.status || "");
      if (pendingToolTargets.length > 0) {
        const target = pendingToolTargets.shift();
        const filePath = extractToolTargetPath(target?.tool || target?.type, target?.arguments, target?.changes);
        if (target?.type === "commandExecution") {
          if (status === "ERROR") {
            target.status = "failed";
            const cleanErr = stripStepEchoPrefix(cleanedText);
            if (cleanErr) target.aggregatedOutput = cleanErr.slice(-2400);
            else if (cleanedText) target.aggregatedOutput = cleanedText.slice(-2400);
            target.error = {
              message: formatToolExecutionError(rawErrorSource, { filePath, toolName: "run_command" }),
              recoverable: true,
            };
          } else if (cleanedText) {
            target.aggregatedOutput = cleanedText.slice(-2400);
          }
        } else if (target?.type === "mcpToolCall") {
          if (status === "ERROR") {
            const friendlyMsg = formatToolExecutionError(rawErrorSource, { filePath, toolName: target.tool });
            target.status = "failed";
            target.error = { message: friendlyMsg, path: filePath, recoverable: true };
            target.result = {
              content: [{ type: "text", text: filePath ? `${friendlyMsg} (${filePath})` : friendlyMsg }],
            };
          } else if (cleanedText) {
            target.result = { content: [{ type: "text", text: cleanedText.slice(0, 500) }] };
          }
        } else if (target?.type === "fileChange") {
          if (status === "ERROR") {
            const friendlyMsg = formatToolExecutionError(rawErrorSource, { filePath, toolName: target.type });
            target.status = "failed";
            target.error = { message: friendlyMsg, path: filePath, recoverable: true };
          }
        }
      } else if (status === "ERROR") {
        const fallbackTarget = [...turn.items].reverse().find((item) => (
          item
          && ((item.type === "mcpToolCall" && !item.result && !item.error)
            || (item.type === "fileChange" && !item.error))
        ));
        const filePath = fallbackTarget
          ? extractToolTargetPath(fallbackTarget.tool || fallbackTarget.type, fallbackTarget.arguments, fallbackTarget.changes)
          : "";
        const friendlyMsg = formatToolExecutionError(rawErrorSource, {
          filePath,
          toolName: fallbackTarget?.tool || fallbackTarget?.type || "step_tool",
        });
        if (fallbackTarget) {
          fallbackTarget.status = "failed";
          fallbackTarget.error = { message: friendlyMsg, path: filePath, recoverable: true };
          if (fallbackTarget.type === "mcpToolCall") {
            fallbackTarget.result = {
              content: [{ type: "text", text: filePath ? `${friendlyMsg} (${filePath})` : friendlyMsg }],
            };
          }
        } else {
          turn.items.push({
            type: "mcpToolCall",
            id: `agy-step-err-${step.step_index ?? idx}`,
            server: "antigravity",
            tool: "step_tool",
            arguments: {},
            status: "failed",
            result: null,
            error: { message: friendlyMsg, recoverable: true },
          });
        }
      }
      if (ts > 0) turn.completedAt = ts;
      lastEffectiveStep = step;
    }
  }

  return {
    id: rawId,
    turns,
    lastTurnOpen: isAntigravityStepTurnOpen(lastEffectiveStep),
    model: lastModel,
  };
}

export function parseAntigravityTranscript(lines, {
  rawId = "",
  fullLinesMap = null,
  detail = "full",
  isThreadLive = false,
} = {}) {
  const { id, turns, lastTurnOpen } = parseAntigravityTranscriptInternal(lines, {
    rawId,
    fullLinesMap,
    detail,
  });
  if (isThreadLive && lastTurnOpen && turns.length > 0) {
    turns[turns.length - 1].status = "inProgress";
  }
  return { id, turns };
}

const MAX_PARSED_TRANSCRIPT_CACHE = 16;
const parsedTranscriptCache = new Map();

function extractStepIndexesNeededFromFull(compactLines) {
  const needed = new Set();
  for (const line of compactLines) {
    if (!line.trim() || !line.includes("truncated_fields")) continue;
    try {
      const step = JSON.parse(line);
      if (!Array.isArray(step?.truncated_fields) || step.step_index === undefined) continue;
      const needsTools = step.truncated_fields.includes("tool_calls");
      const needsErrContent = step.type === "GENERIC" && step.status === "ERROR" && step.truncated_fields.includes("content");
      const needsMsgContent = (step.type === "PLANNER_RESPONSE" || step.type === "USER_INPUT")
        && step.truncated_fields.includes("content");
      if (needsTools || needsErrContent || needsMsgContent) {
        needed.add(Number(step.step_index));
      }
    } catch {
      // Ignore malformed line.
    }
  }
  return needed;
}

export async function readAntigravityThreadHistory(appDataDir, rawId, {
  indexedThread = null,
  cursor = null,
  detail = "auto",
  limit = 30,
  isThreadLive = false,
} = {}) {
  const logsDir = resolve(appDataDir, "brain", rawId, ".system_generated", "logs");
  const compactPath = resolve(logsDir, "transcript.jsonl");
  const fullPath = resolve(logsDir, "transcript_full.jsonl");
  const convDbPath = resolve(appDataDir, "conversations", `${rawId}.db`);
  const convDbWalPath = `${convDbPath}-wal`;
  const normalizedDetail = detail === "full" ? "full" : "auto";
  const cacheKey = `${compactPath}|${normalizedDetail}|v4`;

  const [compactStat, fullStat, dbStat, walStat] = await Promise.all([
    stat(compactPath).catch(() => null),
    stat(fullPath).catch(() => null),
    stat(convDbPath).catch(() => null),
    stat(convDbWalPath).catch(() => null),
  ]);

  let parsedTurns = null;
  let lastTurnOpen = false;
  let lastModel = "";
  if (compactStat?.isFile()) {
    const fullMtimeMs = fullStat?.isFile() ? fullStat.mtimeMs : 0;
    const fullSize = fullStat?.isFile() ? fullStat.size : 0;
    const dbMtimeMs = dbStat?.isFile() ? dbStat.mtimeMs : 0;
    const dbSize = dbStat?.isFile() ? dbStat.size : 0;
    const walMtimeMs = walStat?.isFile() ? walStat.mtimeMs : 0;
    const walSize = walStat?.isFile() ? walStat.size : 0;
    const cached = parsedTranscriptCache.get(cacheKey);
    if (
      cached
      && cached.compactMtimeMs === compactStat.mtimeMs
      && cached.compactSize === compactStat.size
      && cached.fullMtimeMs === fullMtimeMs
      && cached.fullSize === fullSize
      && cached.dbMtimeMs === dbMtimeMs
      && cached.dbSize === dbSize
      && cached.walMtimeMs === walMtimeMs
      && cached.walSize === walSize
    ) {
      parsedTranscriptCache.delete(cacheKey);
      parsedTranscriptCache.set(cacheKey, cached);
      parsedTurns = cached.turns;
      lastTurnOpen = Boolean(cached.lastTurnOpen);
      lastModel = String(cached.model || "");
    } else {
      const compactText = await readFile(compactPath, "utf8").catch(() => "");
      if (compactText) {
        const compactLines = compactText.split("\n");
        const neededStepIndexes = normalizedDetail === "full"
          ? null
          : extractStepIndexesNeededFromFull(compactLines);

        let fullLinesMap = null;
        if (fullStat?.isFile() && (normalizedDetail === "full" || (neededStepIndexes && neededStepIndexes.size > 0))) {
          const fullText = await readFile(fullPath, "utf8").catch(() => "");
          if (fullText) {
            fullLinesMap = new Map();
            for (const line of fullText.split("\n")) {
              if (!line.trim()) continue;
              if (normalizedDetail !== "full") {
                const headIdxMatch = line.slice(0, 64).match(/^\{\s*"step_index"\s*:\s*(\d+)\b/);
                if (headIdxMatch && !neededStepIndexes.has(Number(headIdxMatch[1]))) {
                  continue;
                }
              }
              try {
                const parsedLine = JSON.parse(line);
                if (parsedLine?.step_index !== undefined) {
                  const exactKey = exactTranscriptStepKey(parsedLine);
                  if (exactKey) fullLinesMap.set(exactKey, parsedLine);
                  if (!fullLinesMap.has(parsedLine.step_index)) {
                    fullLinesMap.set(parsedLine.step_index, parsedLine);
                  }
                }
              } catch {
                // Ignore partial line.
              }
            }
          }
        }

        const errorSteps = dbStat?.isFile() ? readAntigravityErrorSteps(appDataDir, rawId) : [];
        const parsed = parseAntigravityTranscriptInternal(compactLines, {
          rawId,
          fullLinesMap,
          detail: normalizedDetail,
          extraSteps: errorSteps,
        });
        parsedTurns = parsed.turns;
        lastTurnOpen = parsed.lastTurnOpen;
        lastModel = String(parsed.model || "");
        if (parsedTranscriptCache.size >= MAX_PARSED_TRANSCRIPT_CACHE) {
          const oldestKey = parsedTranscriptCache.keys().next().value;
          if (oldestKey !== undefined) parsedTranscriptCache.delete(oldestKey);
        }
        parsedTranscriptCache.set(cacheKey, {
          compactMtimeMs: compactStat.mtimeMs,
          compactSize: compactStat.size,
          fullMtimeMs,
          fullSize,
          dbMtimeMs,
          dbSize,
          walMtimeMs,
          walSize,
          turns: parsedTurns,
          lastTurnOpen,
          model: lastModel,
        });
      }
    }
  }
  if (!parsedTurns) parsedTurns = [];

  const allUserPrompts = extractUserPromptsFromTurns(parsedTurns);
  const fullFirstUser = allUserPrompts[0] || "";
  let fullLastUser = allUserPrompts[allUserPrompts.length - 1] || "";
  for (let i = allUserPrompts.length - 1; i >= 0; i -= 1) {
    if (!isContinuationOrControlPrompt(allUserPrompts[i])) {
      fullLastUser = allUserPrompts[i];
      break;
    }
  }
  const hasFollowUpTurns = allUserPrompts.length > 1;

  const totalTurns = parsedTurns.length;
  const maxTurns = Math.max(1, Number(limit) || 30);
  let end = totalTurns;
  if (cursor && String(cursor).startsWith("turn:")) {
    const parsedEnd = Number(String(cursor).slice("turn:".length));
    if (Number.isInteger(parsedEnd) && parsedEnd >= 0) end = Math.min(totalTurns, parsedEnd);
  }
  const start = Math.max(0, end - maxTurns);
  const slicedTurns = parsedTurns.slice(start, end).map((turn) => ({
    ...turn,
    items: Array.isArray(turn.items) ? [...turn.items] : [],
  }));
  if (!cursor && Boolean(isThreadLive || indexedThread?.live) && lastTurnOpen && slicedTurns.length > 0) {
    slicedTurns[slicedTurns.length - 1].status = "inProgress";
  }
  return {
    thread: {
      ...(indexedThread || {}),
      id: rawId,
      cwd: indexedThread?.cwd || os.homedir(),
      model: lastModel || indexedThread?.model || "",
      firstUserText: fullFirstUser || indexedThread?.firstUserText || "",
      lastUserText: fullLastUser || indexedThread?.lastUserText || "",
      hasFollowUpTurns: Boolean(hasFollowUpTurns || indexedThread?.hasFollowUpTurns),
      turns: slicedTurns,
      largeHistory: start > 0,
    },
    nextCursor: start > 0 ? `turn:${start}` : null,
  };
}

// Bytes-per-token fallback used only when a transcript carries no token usage fields.
const AGY_TRANSCRIPT_BYTES_PER_TOKEN = 5.3;
const MAX_CONTEXT_USAGE_CACHE = 64;
const contextUsageCache = new Map();

/**
 * Estimate how much live context an Antigravity conversation has accumulated since
 * its last native compaction (CHECKPOINT step). Uses the real `input_tokens +
 * cache_read_tokens` of PLANNER_RESPONSE steps; the post-compaction baseline (system
 * prompt + summary, typically ~45-50K) is subtracted so thresholds measure growth.
 * Read-only: only parses the transcript.jsonl written by Antigravity itself.
 */
export async function readAntigravityContextUsage(appDataDir, rawId) {
  const cleanId = String(rawId || "").trim();
  if (!appDataDir || !cleanId) return null;
  const path = resolve(appDataDir, "brain", cleanId, ".system_generated", "logs", "transcript.jsonl");
  const st = await stat(path).catch(() => null);
  if (!st?.isFile() || st.size <= 0) return null;
  const cacheKey = `${appDataDir}|${cleanId}`;
  const cached = contextUsageCache.get(cacheKey);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return { ...cached.usage };
  const raw = await readFile(path, "utf8").catch(() => "");
  const usage = parseAntigravityContextUsage(raw);
  if (contextUsageCache.size >= MAX_CONTEXT_USAGE_CACHE) {
    contextUsageCache.delete(contextUsageCache.keys().next().value);
  }
  contextUsageCache.set(cacheKey, { size: st.size, mtimeMs: st.mtimeMs, usage });
  return { ...usage };
}

export function parseAntigravityContextUsage(raw = "") {
  let baselineTokens = 0;
  let currentTokens = 0;
  let bytesSinceCheckpoint = 0;
  let stepsSinceCheckpoint = 0;
  let checkpoints = 0;
  for (const line of String(raw || "").split("\n")) {
    if (!line) continue;
    const isCheckpoint = line.includes("\"CHECKPOINT\"");
    const isPlanner = line.includes("\"PLANNER_RESPONSE\"");
    if (!isCheckpoint && !isPlanner) {
      bytesSinceCheckpoint += line.length + 1;
      continue;
    }
    let step;
    try {
      step = JSON.parse(line);
    } catch {
      continue;
    }
    if (step?.type === "CHECKPOINT") {
      checkpoints += 1;
      baselineTokens = 0;
      currentTokens = 0;
      bytesSinceCheckpoint = 0;
      stepsSinceCheckpoint = 0;
      continue;
    }
    bytesSinceCheckpoint += line.length + 1;
    if (step?.type !== "PLANNER_RESPONSE") continue;
    stepsSinceCheckpoint += 1;
    const ctx = (Number(step.input_tokens) || 0) + (Number(step.cache_read_tokens) || 0);
    if (ctx <= 0) continue;
    if (!baselineTokens) baselineTokens = ctx;
    currentTokens = ctx;
  }
  const hasTokens = currentTokens > 0;
  const growthTokens = hasTokens
    ? Math.max(0, currentTokens - baselineTokens)
    : Math.round(bytesSinceCheckpoint / AGY_TRANSCRIPT_BYTES_PER_TOKEN);
  return {
    source: hasTokens ? "tokens" : "bytes",
    currentTokens,
    baselineTokens,
    growthTokens,
    bytesSinceCheckpoint,
    stepsSinceCheckpoint,
    checkpoints,
  };
}
