import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { isMainThread, parentPort } from "node:worker_threads";
import { normalizeProjectCwd } from "./thread-meta-store.mjs";
import {
  SEARCH_INDEX_SCHEMA_VERSION,
  extractMessagesForDescriptor,
  findSingleThreadDescriptor,
  scanAllProfileDescriptors,
} from "./search-extractors.mjs";

const SYNC_BATCH_SIZE = 10;
const EXTRACT_CONCURRENCY = 4;

function isCorruptionError(error) {
  const msg = String(error?.message || error?.errstr || "").toLowerCase();
  return msg.includes("malformed")
    || msg.includes("corrupt")
    || msg.includes("not a database")
    || error?.errcode === 11
    || error?.errcode === 26;
}

function removeDbFiles(dbPath) {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(`${dbPath}${suffix}`, { force: true });
    } catch {
      // Ignore cleanup failures.
    }
  }
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  const versionRow = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (String(versionRow?.value || "") !== String(SEARCH_INDEX_SCHEMA_VERSION)) {
    db.exec(`
      DROP TABLE IF EXISTS indexed_messages;
      DROP TABLE IF EXISTS indexed_threads;
      CREATE TABLE indexed_threads (
        thread_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        profile_label TEXT NOT NULL DEFAULT '',
        raw_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        preview TEXT NOT NULL DEFAULT '',
        cwd TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        source_path TEXT NOT NULL DEFAULT '',
        mtime_ms REAL NOT NULL DEFAULT 0,
        file_size INTEGER NOT NULL DEFAULT 0,
        indexed_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX idx_indexed_threads_updated ON indexed_threads(updated_at DESC);
      CREATE INDEX idx_indexed_threads_provider ON indexed_threads(provider, updated_at DESC);
      CREATE TABLE indexed_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        seq INTEGER NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0,
        body TEXT NOT NULL
      );
      CREATE INDEX idx_indexed_messages_thread ON indexed_messages(thread_id);
      CREATE INDEX idx_indexed_messages_updated ON indexed_messages(updated_at DESC);
      INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', '${SEARCH_INDEX_SCHEMA_VERSION}');
    `);
  }
}

/**
 * Open (or recover/initialize) the writable SQLite search index database.
 */
export function openSearchIndexWriteDb(dbPath) {
  mkdirSync(dirname(dbPath), { recursive: true, mode: 0o700 });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let db = null;
    try {
      db = new DatabaseSync(dbPath);
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = 3000;
        PRAGMA temp_store = MEMORY;
      `);
      initSchema(db);
      return db;
    } catch (error) {
      try { db?.close(); } catch {}
      if (attempt === 0 && isCorruptionError(error)) {
        removeDbFiles(dbPath);
        continue;
      }
      throw error;
    }
  }
  throw new Error("无法打开搜索索引数据库");
}

function applyMetaOverride(desc, extracted, metaOverride) {
  const customName = String(metaOverride?.customName || "").trim();
  const title = customName || extracted?.title || desc?.title || "";
  const preview = extracted?.preview || desc?.preview || "";
  const rawCwd = String(metaOverride?.cwd || extracted?.cwd || desc?.cwd || "").trim();
  const cwd = normalizeProjectCwd(rawCwd) || rawCwd;
  const archived = metaOverride && Object.hasOwn(metaOverride, "archived") && metaOverride.archived !== null && metaOverride.archived !== undefined
    ? Boolean(metaOverride.archived)
    : Boolean(desc?.archived);
  const createdAt = Number(extracted?.createdAt || desc?.createdAt) || 0;
  const updatedAt = Math.max(Number(extracted?.updatedAt) || 0, Number(desc?.updatedAt) || 0);
  return { title, preview, cwd, archived: archived ? 1 : 0, createdAt, updatedAt };
}

function upsertThreadsAndMessages(db, records = [], nowSec = Math.floor(Date.now() / 1000)) {
  if (!records.length) return;
  const upsertThreadStmt = db.prepare(`
    INSERT INTO indexed_threads (
      thread_id, provider, profile_id, profile_label, raw_id,
      title, preview, cwd, updated_at, created_at, archived,
      source_path, mtime_ms, file_size, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(thread_id) DO UPDATE SET
      provider = excluded.provider,
      profile_id = excluded.profile_id,
      profile_label = excluded.profile_label,
      raw_id = excluded.raw_id,
      title = excluded.title,
      preview = excluded.preview,
      cwd = excluded.cwd,
      updated_at = excluded.updated_at,
      created_at = excluded.created_at,
      archived = excluded.archived,
      source_path = excluded.source_path,
      mtime_ms = excluded.mtime_ms,
      file_size = excluded.file_size,
      indexed_at = excluded.indexed_at
  `);
  const deleteMsgsStmt = db.prepare("DELETE FROM indexed_messages WHERE thread_id = ?");
  const insertMsgStmt = db.prepare(`
    INSERT INTO indexed_messages (thread_id, role, seq, updated_at, body)
    VALUES (?, ?, ?, ?, ?)
  `);

  db.exec("BEGIN");
  try {
    for (const item of records) {
      const { desc, resolved, messages } = item;
      upsertThreadStmt.run(
        desc.threadId,
        desc.provider,
        desc.profileId,
        desc.profileLabel || "",
        desc.rawId,
        resolved.title,
        resolved.preview,
        resolved.cwd,
        resolved.updatedAt,
        resolved.createdAt,
        resolved.archived,
        desc.sourcePath || "",
        Number(desc.mtimeMs) || 0,
        Number(desc.fileSize) || 0,
        nowSec,
      );
      if (Array.isArray(messages)) {
        deleteMsgsStmt.run(desc.threadId);
        for (let i = 0; i < messages.length; i += 1) {
          const msg = messages[i];
          insertMsgStmt.run(
            desc.threadId,
            msg.role,
            i,
            Number(msg.updatedAt) || resolved.updatedAt,
            msg.body,
          );
        }
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function updateMetadataOnlyRows(db, rows = []) {
  if (!rows.length) return;
  const stmt = db.prepare(`
    UPDATE indexed_threads
    SET title = ?, preview = ?, cwd = ?, updated_at = ?, archived = ?, profile_label = ?
    WHERE thread_id = ?
  `);
  db.exec("BEGIN");
  try {
    for (const item of rows) {
      stmt.run(
        item.title,
        item.preview,
        item.cwd,
        item.updatedAt,
        item.archived,
        item.profileLabel || "",
        item.threadId,
      );
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

function deleteRemovedThreads(db, threadIds = []) {
  if (!threadIds.length) return;
  const delMsgs = db.prepare("DELETE FROM indexed_messages WHERE thread_id = ?");
  const delThread = db.prepare("DELETE FROM indexed_threads WHERE thread_id = ?");
  db.exec("BEGIN");
  try {
    for (const id of threadIds) {
      delMsgs.run(id);
      delThread.run(id);
    }
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch {}
    throw error;
  }
}

async function mapLimited(items, concurrency, fn) {
  const results = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (idx < items.length) {
      const current = idx;
      idx += 1;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Execute one incremental full-scan sync pass against the SQLite search database.
 */
export async function runSearchIndexSyncPass({
  db,
  profiles = [],
  dataDir = "",
  metaOverrides = {},
  onProgress = null,
} = {}) {
  const descriptors = await scanAllProfileDescriptors(profiles, dataDir);
  const existingRows = db.prepare(`
    SELECT thread_id, profile_label, title, preview, cwd, updated_at, archived, source_path, mtime_ms, file_size
    FROM indexed_threads
  `).all();
  const existingById = new Map();
  for (const row of existingRows) {
    existingById.set(row.thread_id, row);
  }

  const activeIds = new Set();
  const toParse = [];
  const metaOnlyUpdates = [];
  let unchangedCount = 0;

  for (const desc of descriptors) {
    activeIds.add(desc.threadId);
    const prev = existingById.get(desc.threadId);
    const sameFile = Boolean(
      prev
      && prev.source_path === (desc.sourcePath || "")
      && Math.abs(Number(prev.mtime_ms || 0) - Number(desc.mtimeMs || 0)) < 0.5
      && Number(prev.file_size || 0) === Number(desc.fileSize || 0),
    );
    if (sameFile) {
      unchangedCount += 1;
      const resolved = applyMetaOverride(desc, null, metaOverrides?.[desc.threadId]);
      const nextTitle = resolved.title || prev.title || "";
      const nextPreview = resolved.preview || prev.preview || "";
      const nextCwd = resolved.cwd || prev.cwd || "";
      const nextUpdatedAt = Math.max(resolved.updatedAt, Number(prev.updated_at) || 0);
      const nextArchived = resolved.archived;
      const nextLabel = desc.profileLabel || prev.profile_label || "";
      if (
        nextTitle !== prev.title
        || nextPreview !== prev.preview
        || nextCwd !== prev.cwd
        || nextUpdatedAt !== Number(prev.updated_at)
        || nextArchived !== Number(prev.archived)
        || nextLabel !== prev.profile_label
      ) {
        metaOnlyUpdates.push({
          threadId: desc.threadId,
          profileLabel: nextLabel,
          title: nextTitle,
          preview: nextPreview,
          cwd: nextCwd,
          updatedAt: nextUpdatedAt,
          archived: nextArchived,
        });
      }
      continue;
    }
    toParse.push(desc);
  }

  if (metaOnlyUpdates.length) {
    updateMetadataOnlyRows(db, metaOnlyUpdates);
  }

  const totalThreads = descriptors.length;
  let indexedSoFar = unchangedCount;
  let updatedCount = 0;
  const skippedIds = new Set();

  if (onProgress) {
    onProgress({
      indexedThreads: indexedSoFar,
      totalThreads,
      indexing: toParse.length > 0,
    });
  }

  for (let offset = 0; offset < toParse.length; offset += SYNC_BATCH_SIZE) {
    const batch = toParse.slice(offset, offset + SYNC_BATCH_SIZE);
    const extractedList = await mapLimited(batch, EXTRACT_CONCURRENCY, async (desc) => {
      const extracted = await extractMessagesForDescriptor(desc);
      return { desc, extracted };
    });

    const readyRecords = [];
    for (const { desc, extracted } of extractedList) {
      if (extracted.skip) {
        skippedIds.add(desc.threadId);
        continue;
      }
      const resolved = applyMetaOverride(desc, extracted, metaOverrides?.[desc.threadId]);
      readyRecords.push({
        desc,
        resolved,
        messages: extracted.messages,
      });
    }

    if (readyRecords.length) {
      upsertThreadsAndMessages(db, readyRecords);
      updatedCount += readyRecords.length;
    }

    indexedSoFar += batch.length;
    await new Promise((resolveYield) => setImmediate(resolveYield));
    if (onProgress) {
      onProgress({
        indexedThreads: Math.min(indexedSoFar, totalThreads),
        totalThreads,
        indexing: offset + SYNC_BATCH_SIZE < toParse.length,
      });
    }
  }

  const toRemove = [];
  for (const existingId of existingById.keys()) {
    if (!activeIds.has(existingId) || skippedIds.has(existingId)) {
      toRemove.push(existingId);
    }
  }
  if (toRemove.length) {
    deleteRemovedThreads(db, toRemove);
  }

  const finalCountRow = db.prepare("SELECT COUNT(*) AS c FROM indexed_threads").get();
  const finalIndexedThreads = Number(finalCountRow?.c) || 0;
  try {
    db.exec("PRAGMA wal_checkpoint(PASSIVE)");
  } catch {
    // Non-fatal if a reader holds a snapshot.
  }

  return {
    indexedThreads: finalIndexedThreads,
    totalThreads: Math.max(0, totalThreads - skippedIds.size),
    updatedCount,
    removedCount: toRemove.length,
  };
}

/**
 * Re-index a single thread synchronously after turn completion.
 */
export async function syncSingleThreadRecord({
  db,
  profile,
  rawId,
  dataDir = "",
  metaOverride = null,
} = {}) {
  const desc = await findSingleThreadDescriptor(profile, rawId, dataDir);
  if (!desc) return { updated: false };
  const extracted = await extractMessagesForDescriptor(desc);
  if (extracted.skip) {
    deleteRemovedThreads(db, [desc.threadId]);
    return { updated: false, removed: true };
  }
  const resolved = applyMetaOverride(desc, extracted, metaOverride);
  upsertThreadsAndMessages(db, [{ desc, resolved, messages: extracted.messages }]);
  return { updated: true, threadId: desc.threadId };
}

/**
 * Patch cached title/archived/cwd metadata for an already indexed thread.
 */
export function updateThreadMetaRecord(db, threadId, patch = {}) {
  const cleanId = String(threadId || "").trim();
  if (!cleanId) return false;
  const row = db.prepare("SELECT title, archived, cwd FROM indexed_threads WHERE thread_id = ?").get(cleanId);
  if (!row) return false;
  const nextTitle = Object.hasOwn(patch, "title") ? String(patch.title || "").trim() : row.title;
  const nextArchived = Object.hasOwn(patch, "archived") ? (patch.archived ? 1 : 0) : row.archived;
  const rawCwd = Object.hasOwn(patch, "cwd") && patch.cwd ? String(patch.cwd).trim() : row.cwd;
  const nextCwd = normalizeProjectCwd(rawCwd) || rawCwd;
  db.prepare(`
    UPDATE indexed_threads
    SET title = ?, archived = ?, cwd = ?
    WHERE thread_id = ?
  `).run(nextTitle, nextArchived, nextCwd, cleanId);
  return true;
}

if (!isMainThread && parentPort) {
  let db = null;
  let currentDbPath = "";
  let opChain = Promise.resolve();

  const ensureDb = (dataDir) => {
    const dbPath = resolve(String(dataDir), "search-index.sqlite");
    if (!db || currentDbPath !== dbPath) {
      try { db?.close(); } catch {}
      currentDbPath = dbPath;
      db = openSearchIndexWriteDb(dbPath);
    }
    return db;
  };

  const resetOnCorrupt = (dataDir) => {
    const dbPath = resolve(String(dataDir), "search-index.sqlite");
    try { db?.close(); } catch {}
    db = null;
    removeDbFiles(dbPath);
    currentDbPath = dbPath;
    db = openSearchIndexWriteDb(dbPath);
    return db;
  };

  parentPort.on("message", (msg) => {
    if (!msg || typeof msg !== "object") return;
    opChain = opChain
      .catch(() => {})
      .then(async () => {
        if (msg.type === "close") {
          try { db?.close(); } catch {}
          db = null;
          parentPort.postMessage({ type: "closed" });
          process.exit(0);
        }

        if (msg.type === "sync_all") {
          try {
            let activeDb = ensureDb(msg.dataDir);
            let res;
            try {
              res = await runSearchIndexSyncPass({
                db: activeDb,
                profiles: msg.profiles || [],
                dataDir: msg.dataDir || "",
                metaOverrides: msg.metaOverrides || {},
                onProgress: (prog) => {
                  parentPort.postMessage({ type: "progress", requestId: msg.requestId, ...prog });
                },
              });
            } catch (err) {
              if (!isCorruptionError(err)) throw err;
              activeDb = resetOnCorrupt(msg.dataDir);
              res = await runSearchIndexSyncPass({
                db: activeDb,
                profiles: msg.profiles || [],
                dataDir: msg.dataDir || "",
                metaOverrides: msg.metaOverrides || {},
                onProgress: (prog) => {
                  parentPort.postMessage({ type: "progress", requestId: msg.requestId, ...prog });
                },
              });
            }
            parentPort.postMessage({
              type: "sync_done",
              requestId: msg.requestId,
              ...res,
            });
          } catch (error) {
            parentPort.postMessage({
              type: "sync_error",
              requestId: msg.requestId,
              message: error?.message || String(error),
            });
          }
          return;
        }

        if (msg.type === "sync_single") {
          try {
            const activeDb = ensureDb(msg.dataDir);
            const res = await syncSingleThreadRecord({
              db: activeDb,
              profile: msg.profile,
              rawId: msg.rawId,
              dataDir: msg.dataDir || "",
              metaOverride: msg.metaOverride || null,
            });
            parentPort.postMessage({
              type: "sync_single_done",
              requestId: msg.requestId,
              ...res,
            });
          } catch (error) {
            parentPort.postMessage({
              type: "sync_single_done",
              requestId: msg.requestId,
              updated: false,
              error: error?.message || String(error),
            });
          }
          return;
        }

        if (msg.type === "update_meta") {
          try {
            if (msg.dataDir) {
              const activeDb = ensureDb(msg.dataDir);
              updateThreadMetaRecord(activeDb, msg.threadId, msg.patch || {});
            }
          } catch {
            // Non-fatal metadata update failure.
          }
        }
      });
  });
}
