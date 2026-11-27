import { appendFile, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const DEFAULT_RETENTION_HOURS = 24;
const DEFAULT_MAX_LOG_BYTES = 5 * 1024 * 1024;
const DAILY_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function formatDateFolder(ms = Date.now()) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function safeSegment(value, fallback = "unknown") {
  const clean = String(value || "").trim().replace(/[^a-zA-Z0-9._-]+/g, "_");
  return clean || fallback;
}

function extFromMime(mimeType = "", fallback = "bin") {
  const lower = String(mimeType || "").toLowerCase();
  if (lower.includes("wav")) return "wav";
  if (lower.includes("mpeg") || lower.includes("mp3")) return "mp3";
  if (lower.includes("ogg")) return "ogg";
  if (lower.includes("webm")) return "webm";
  if (lower.includes("aac") || lower.includes("mp4") || lower.includes("m4a")) return "m4a";
  return fallback;
}

/**
 * Persists structured Sprite phone call logs and user/AI audio recordings,
 * with automatic daily cleanup that retains recordings for at least 24 hours.
 */
export class SpritePhoneArchive {
  #dataDir;
  #retentionMs;
  #maxLogBytes;
  #logQueue = Promise.resolve();
  #cleanupTimer = null;

  constructor({
    dataDir = "",
    retentionHours = DEFAULT_RETENTION_HOURS,
    maxLogBytes = DEFAULT_MAX_LOG_BYTES,
  } = {}) {
    this.#dataDir = dataDir ? String(dataDir) : "";
    const hours = Number.isFinite(Number(retentionHours)) ? Math.max(24, Number(retentionHours)) : DEFAULT_RETENTION_HOURS;
    this.#retentionMs = hours * 3600_000;
    this.#maxLogBytes = Math.max(64 * 1024, Number(maxLogBytes) || DEFAULT_MAX_LOG_BYTES);
  }

  get logPath() {
    return this.#dataDir ? resolve(this.#dataDir, "logs", "sprite-phone.jsonl") : "";
  }

  get recordingsDir() {
    return this.#dataDir ? resolve(this.#dataDir, "voice-recordings") : "";
  }

  logEvent(entry = {}) {
    if (!this.#dataDir) return Promise.resolve();
    const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`;
    const target = this.logPath;
    this.#logQueue = this.#logQueue.then(async () => {
      await mkdir(dirname(target), { recursive: true });
      const info = await stat(target).catch(() => null);
      if (info && info.size > this.#maxLogBytes) {
        await rename(target, `${target}.prev`).catch(() => {});
      }
      await appendFile(target, line, { encoding: "utf8", mode: 0o600 });
    }).catch(() => {});
    return this.#logQueue;
  }

  async saveAudio({
    callId = "",
    turnId = "",
    role = "user",
    index = 0,
    audioBase64 = "",
    mimeType = "audio/wav",
    nowMs = Date.now(),
  } = {}) {
    if (!this.#dataDir || !audioBase64) return null;
    try {
      const buf = Buffer.from(String(audioBase64), "base64");
      if (!buf.length) return null;
      const dateDir = formatDateFolder(nowMs);
      const safeCall = safeSegment(callId, "no-call");
      const safeTurn = safeSegment(turnId, `turn-${nowMs}`);
      const ext = extFromMime(mimeType, role === "user" ? "wav" : "mp3");
      const suffix = role === "ai" ? `ai-${Number(index) || 0}` : "user";
      const filePath = resolve(this.recordingsDir, dateDir, safeCall, `${safeTurn}-${suffix}.${ext}`);
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, buf, { mode: 0o600 });
      return { path: filePath, bytes: buf.length, mimeType: String(mimeType || "") };
    } catch {
      return null;
    }
  }

  async cleanupExpiredRecordings({ nowMs = Date.now() } = {}) {
    if (!this.#dataDir) return { deletedFiles: 0, deletedDirs: 0 };
    const root = this.recordingsDir;
    const cutoffMs = nowMs - this.#retentionMs;
    let deletedFiles = 0;
    let deletedDirs = 0;

    const dateEntries = await readdir(root, { withFileTypes: true }).catch(() => []);
    for (const dateEntry of dateEntries) {
      if (!dateEntry.isDirectory()) continue;
      const datePath = resolve(root, dateEntry.name);
      const callEntries = await readdir(datePath, { withFileTypes: true }).catch(() => []);
      let dateRemaining = 0;

      for (const callEntry of callEntries) {
        const callPath = resolve(datePath, callEntry.name);
        if (!callEntry.isDirectory()) {
          const info = await stat(callPath).catch(() => null);
          if (info && info.mtimeMs <= cutoffMs) {
            await rm(callPath, { force: true }).catch(() => {});
            deletedFiles += 1;
          } else {
            dateRemaining += 1;
          }
          continue;
        }
        const files = await readdir(callPath, { withFileTypes: true }).catch(() => []);
        let callRemaining = 0;
        for (const f of files) {
          const filePath = resolve(callPath, f.name);
          const info = await stat(filePath).catch(() => null);
          if (info && info.mtimeMs <= cutoffMs) {
            await rm(filePath, { force: true, recursive: true }).catch(() => {});
            deletedFiles += 1;
          } else {
            callRemaining += 1;
          }
        }
        if (callRemaining === 0) {
          await rm(callPath, { recursive: true, force: true }).catch(() => {});
          deletedDirs += 1;
        } else {
          dateRemaining += 1;
        }
      }

      if (dateRemaining === 0) {
        await rm(datePath, { recursive: true, force: true }).catch(() => {});
        deletedDirs += 1;
      }
    }

    if (deletedFiles > 0 || deletedDirs > 0) {
      void this.logEvent({
        stage: "cleanup",
        event: "recordings_pruned",
        deletedFiles,
        deletedDirs,
        retentionHours: this.#retentionMs / 3600_000,
      });
    }
    return { deletedFiles, deletedDirs };
  }

  startCleanupTimer() {
    if (this.#cleanupTimer || !this.#dataDir) return;
    void this.cleanupExpiredRecordings().catch(() => {});
    this.#cleanupTimer = setInterval(() => {
      void this.cleanupExpiredRecordings().catch(() => {});
    }, DAILY_CLEANUP_INTERVAL_MS);
    this.#cleanupTimer.unref?.();
  }

  close() {
    if (this.#cleanupTimer) {
      clearInterval(this.#cleanupTimer);
      this.#cleanupTimer = null;
    }
  }
}
