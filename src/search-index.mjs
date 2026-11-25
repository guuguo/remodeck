import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { parseCompositeThreadId } from "./composite-id.mjs";
import { extractMatchSnippet } from "./search-extractors.mjs";
import { normalizeProjectCwd } from "./thread-meta-store.mjs";
import { isInternalAssistantThread } from "./assistant-signals.mjs";

const WORKER_FILE = fileURLToPath(new URL("./search-index-worker.mjs", import.meta.url));
const MAX_SEARCH_TERMS = 6;
const SINGLE_DIRTY_DEBOUNCE_MS = 1500;

export function searchIndexDbPath(dataDir) {
  return resolve(String(dataDir || ""), "search-index.sqlite");
}

function escapeLikePattern(term) {
  return `%${String(term || "").replace(/[\\%_]/g, "\\$&")}%`;
}

export function splitSearchTerms(query) {
  const seen = new Set();
  const terms = [];
  for (const part of String(query || "").trim().split(/\s+/)) {
    const clean = part.trim();
    if (!clean) continue;
    const lower = clean.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    terms.push(clean);
    if (terms.length >= MAX_SEARCH_TERMS) break;
  }
  return terms;
}

function buildAliasMatchedCwdsByTerm(terms, projectsMeta = {}) {
  const entries = Object.entries(projectsMeta || {});
  return terms.map((term) => {
    const lower = term.toLowerCase();
    const cwds = [];
    for (const [cwd, meta] of entries) {
      const alias = String(meta?.alias || "").trim().toLowerCase();
      if (alias && alias.includes(lower)) {
        cwds.push(cwd);
      }
    }
    return cwds;
  });
}

function buildMetaTermCondition(term, aliasCwds = []) {
  const pat = escapeLikePattern(term);
  const parts = [
    "t.title LIKE ? ESCAPE '\\'",
    "t.preview LIKE ? ESCAPE '\\'",
    "t.cwd LIKE ? ESCAPE '\\'",
  ];
  const params = [pat, pat, pat];
  if (aliasCwds.length > 0) {
    const placeholders = aliasCwds.map(() => "?").join(", ");
    parts.push(`t.cwd IN (${placeholders})`);
    params.push(...aliasCwds);
  }
  return {
    sql: `(${parts.join(" OR ")})`,
    params,
  };
}

function evaluateMetaMatchFlags(row, terms, aliasCwdsByTerm, metaStore) {
  const applied = metaStore?.applyToThread
    ? metaStore.applyToThread({
        id: row.thread_id,
        provider: row.provider,
        profileId: row.profile_id,
        profileLabel: row.profile_label,
        rawId: row.raw_id,
        title: row.title,
        preview: row.preview,
        cwd: row.cwd,
        updatedAt: row.updated_at,
        createdAt: row.created_at,
        archived: Boolean(row.archived),
      })
    : {
        id: row.thread_id,
        provider: row.provider,
        profileId: row.profile_id,
        profileLabel: row.profile_label,
        rawId: row.raw_id,
        title: row.title,
        preview: row.preview,
        cwd: row.cwd,
        updatedAt: row.updated_at,
        createdAt: row.created_at,
        archived: Boolean(row.archived),
      };
  const hay = [
    applied.title || "",
    applied.preview || "",
    applied.cwd || "",
    applied.provider || "",
    applied.profileLabel || "",
  ].join(" ").toLowerCase();

  let allMatched = terms.length > 0;
  let anyMatched = false;
  for (let i = 0; i < terms.length; i += 1) {
    const lower = terms[i].toLowerCase();
    const aliasHit = aliasCwdsByTerm[i]?.includes(applied.cwd);
    if (hay.includes(lower) || aliasHit) {
      anyMatched = true;
    } else {
      allMatched = false;
    }
  }
  return { applied, allMatched, anyMatched };
}

/**
 * Coordinates the background SQLite search index worker and runs fast read-only queries.
 */
export class SearchIndexService {
  #dataDir;
  #getProfileDescriptors;
  #metaStore;
  #enabled;
  #autoStartDelayMs;
  #sweepIntervalMs;
  #worker = null;
  #readDb = null;
  #closed = false;
  #started = false;
  #startupTimer = null;
  #sweepTimer = null;
  #singleDirtyTimers = new Map();
  #syncInFlight = null;
  #nextRequestId = 1;
  #pendingRequests = new Map();
  #status = {
    ready: false,
    indexing: false,
    indexedThreads: 0,
    totalThreads: 0,
    lastSyncAt: 0,
    lastError: "",
  };

  constructor({
    dataDir = "",
    getProfileDescriptors = async () => [],
    metaStore = null,
    enabled = true,
    autoStartDelayMs = 1500,
    sweepIntervalMs = 60_000,
  } = {}) {
    this.#dataDir = String(dataDir || "").trim();
    this.#getProfileDescriptors = getProfileDescriptors;
    this.#metaStore = metaStore;
    this.#enabled = Boolean(enabled && this.#dataDir);
    this.#autoStartDelayMs = Math.max(0, Number(autoStartDelayMs) || 0);
    this.#sweepIntervalMs = Math.max(0, Number(sweepIntervalMs) || 0);
  }

  getStatus() {
    return { ...this.#status };
  }

  start() {
    if (!this.#enabled || this.#closed || this.#started) return;
    this.#started = true;
    if (this.#autoStartDelayMs === 0) {
      void this.syncNow().catch(() => {});
    } else {
      this.#startupTimer = setTimeout(() => {
        this.#startupTimer = null;
        void this.syncNow().catch(() => {});
      }, this.#autoStartDelayMs);
      this.#startupTimer.unref?.();
    }
    if (this.#sweepIntervalMs > 0) {
      this.#sweepTimer = setInterval(() => {
        if (this.#closed || this.#syncInFlight) return;
        void this.syncNow().catch(() => {});
      }, this.#sweepIntervalMs);
      this.#sweepTimer.unref?.();
    }
  }

  #ensureWorker() {
    if (this.#closed || !this.#enabled) return null;
    if (this.#worker) return this.#worker;
    const worker = new Worker(WORKER_FILE);
    worker.unref?.();
    worker.on("message", (msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "progress") {
        this.#status.indexing = Boolean(msg.indexing);
        this.#status.indexedThreads = Number(msg.indexedThreads) || 0;
        this.#status.totalThreads = Number(msg.totalThreads) || 0;
        return;
      }
      if (msg.type === "sync_done") {
        this.#status.ready = true;
        this.#status.indexing = false;
        this.#status.indexedThreads = Number(msg.indexedThreads) || 0;
        this.#status.totalThreads = Number(msg.totalThreads) || 0;
        this.#status.lastSyncAt = Math.floor(Date.now() / 1000);
        this.#status.lastError = "";
        const pending = this.#pendingRequests.get(msg.requestId);
        if (pending) {
          this.#pendingRequests.delete(msg.requestId);
          pending.resolve(msg);
        }
        return;
      }
      if (msg.type === "sync_error") {
        this.#status.indexing = false;
        this.#status.lastError = String(msg.message || "索引同步失败");
        const pending = this.#pendingRequests.get(msg.requestId);
        if (pending) {
          this.#pendingRequests.delete(msg.requestId);
          pending.reject(new Error(this.#status.lastError));
        }
        return;
      }
      if (msg.type === "sync_single_done") {
        const pending = this.#pendingRequests.get(msg.requestId);
        if (pending) {
          this.#pendingRequests.delete(msg.requestId);
          pending.resolve(msg);
        }
      }
    });
    worker.on("error", (err) => {
      this.#status.indexing = false;
      this.#status.lastError = err?.message || String(err);
      for (const pending of this.#pendingRequests.values()) {
        pending.reject(err);
      }
      this.#pendingRequests.clear();
      this.#worker = null;
    });
    worker.on("exit", () => {
      if (this.#worker === worker) {
        this.#worker = null;
      }
      for (const pending of this.#pendingRequests.values()) {
        pending.reject(new Error("搜索索引工作线程已退出"));
      }
      this.#pendingRequests.clear();
    });
    this.#worker = worker;
    return worker;
  }

  async syncNow() {
    if (!this.#enabled || this.#closed) return this.getStatus();
    if (this.#syncInFlight) return this.#syncInFlight;
    const run = (async () => {
      const worker = this.#ensureWorker();
      if (!worker) return this.getStatus();
      const [profiles] = await Promise.all([
        this.#getProfileDescriptors(),
        this.#metaStore?.load?.().catch(() => {}),
      ]);
      if (this.#closed) return this.getStatus();
      const metaOverrides = this.#metaStore?.listThreads?.() || {};
      this.#status.indexing = true;
      const requestId = this.#nextRequestId++;
      const res = await new Promise((resolveReq, rejectReq) => {
        this.#pendingRequests.set(requestId, { resolve: resolveReq, reject: rejectReq });
        worker.postMessage({
          type: "sync_all",
          requestId,
          profiles,
          dataDir: this.#dataDir,
          metaOverrides,
        });
      });
      return {
        ...this.getStatus(),
        updatedCount: Number(res?.updatedCount) || 0,
        removedCount: Number(res?.removedCount) || 0,
      };
    })().finally(() => {
      if (this.#syncInFlight === run) {
        this.#syncInFlight = null;
      }
    });
    this.#syncInFlight = run;
    return run;
  }

  markThreadDirty(compositeId) {
    if (!this.#enabled || this.#closed) return;
    const id = String(compositeId || "").trim();
    if (!id) return;
    const prevTimer = this.#singleDirtyTimers.get(id);
    if (prevTimer) clearTimeout(prevTimer);
    const timer = setTimeout(() => {
      this.#singleDirtyTimers.delete(id);
      void this.#syncSingleNow(id).catch(() => {});
    }, SINGLE_DIRTY_DEBOUNCE_MS);
    timer.unref?.();
    this.#singleDirtyTimers.set(id, timer);
  }

  async #syncSingleNow(compositeId) {
    if (!this.#enabled || this.#closed) return;
    let parsed;
    try {
      parsed = parseCompositeThreadId(compositeId);
    } catch {
      return;
    }
    const profiles = await this.#getProfileDescriptors().catch(() => []);
    const profile = profiles.find((p) => p.provider === parsed.provider && p.profileId === parsed.profileId);
    if (!profile) return;
    const worker = this.#ensureWorker();
    if (!worker) return;
    await this.#metaStore?.load?.().catch(() => {});
    const metaOverride = this.#metaStore?.get?.(compositeId) || null;
    const requestId = this.#nextRequestId++;
    await new Promise((resolveReq, rejectReq) => {
      this.#pendingRequests.set(requestId, { resolve: resolveReq, reject: rejectReq });
      worker.postMessage({
        type: "sync_single",
        requestId,
        profile,
        rawId: parsed.rawId,
        dataDir: this.#dataDir,
        metaOverride,
      });
    }).catch(() => {});
  }

  updateThreadMeta(compositeId, patch = {}) {
    if (!this.#enabled || this.#closed || !compositeId) return;
    if (!existsSync(searchIndexDbPath(this.#dataDir)) && !this.#worker) return;
    const worker = this.#ensureWorker();
    if (!worker) return;
    worker.postMessage({
      type: "update_meta",
      dataDir: this.#dataDir,
      threadId: String(compositeId),
      patch,
    });
  }

  #openReadDb() {
    if (!this.#enabled || this.#closed) return null;
    const dbPath = searchIndexDbPath(this.#dataDir);
    if (!existsSync(dbPath)) return null;
    if (this.#readDb) return this.#readDb;
    try {
      const db = new DatabaseSync(dbPath, { readOnly: true });
      db.exec("PRAGMA busy_timeout = 1000;");
      this.#readDb = db;
      return db;
    } catch {
      return null;
    }
  }

  #closeReadDb() {
    if (!this.#readDb) return;
    try {
      this.#readDb.close();
    } catch {
      // Ignore close error.
    }
    this.#readDb = null;
  }

  #runSearchQuery(db, {
    terms,
    provider = "",
    profileId = "",
    archived = "0",
    cwd = "",
    limit = 60,
    projectsMeta = {},
  }) {
    const scopeParts = [];
    const scopeParams = [];
    if (provider && provider !== "all") {
      scopeParts.push("t.provider = ?");
      scopeParams.push(provider);
    }
    if (profileId && profileId !== "all") {
      scopeParts.push("t.profile_id = ?");
      scopeParams.push(profileId);
    }
    if (cwd) {
      const normCwd = normalizeProjectCwd(cwd) || cwd;
      if (normCwd !== cwd) {
        scopeParts.push("(t.cwd = ? OR t.cwd = ?)");
        scopeParams.push(normCwd, cwd);
      } else {
        scopeParts.push("t.cwd = ?");
        scopeParams.push(normCwd);
      }
    }
    const metaThreadsMap = this.#metaStore?.listThreads?.() || {};
    const memArchivedIds = [];
    const memCustomTitleMatchedIds = [];
    const lowerTerms = terms.map((t) => t.toLowerCase());
    for (const [tid, metaItem] of Object.entries(metaThreadsMap)) {
      if (!tid || !metaItem || typeof metaItem !== "object") continue;
      if (metaItem.archived === true) memArchivedIds.push(tid);
      const customLower = String(metaItem.customName || "").trim().toLowerCase();
      if (customLower && lowerTerms.some((t) => customLower.includes(t))) {
        memCustomTitleMatchedIds.push(tid);
      }
    }

    const hasUnarchivedOverrides = Boolean(this.#metaStore?.hasUnarchivedOverrides?.());
    if (archived === "0" && !hasUnarchivedOverrides) {
      scopeParts.push("t.archived = 0");
    } else if (archived === "1") {
      if (memArchivedIds.length > 0 && memArchivedIds.length <= 200) {
        scopeParts.push(`(t.archived = 1 OR t.thread_id IN (${memArchivedIds.map(() => "?").join(", ")}))`);
        scopeParams.push(...memArchivedIds);
      } else if (memArchivedIds.length === 0) {
        scopeParts.push("t.archived = 1");
      }
    }
    const scopeSql = scopeParts.length ? scopeParts.join(" AND ") : "1=1";
    const aliasCwdsByTerm = buildAliasMatchedCwdsByTerm(terms, projectsMeta);

    const byThread = new Map();
    const ensureEntry = (row, fromCustomMeta = false) => {
      let entry = byThread.get(row.thread_id);
      if (!entry) {
        entry = {
          row,
          singleMsgMatched: false,
          hasContentMatch: false,
          fromCustomMeta: Boolean(fromCustomMeta),
          bestMsgRole: "",
          bestMsgBody: "",
          matchCount: 0,
        };
        byThread.set(row.thread_id, entry);
      }
      return entry;
    };

    // 1) Fast pass: single message contains ALL terms (ordered newest first).
    const msgConds = terms.map(() => "m.body LIKE ? ESCAPE '\\'").join(" AND ");
    const msgParams = [...scopeParams, ...terms.map(escapeLikePattern), Math.max(limit * 10, 600)];
    const msgRows = db.prepare(`
      SELECT m.thread_id, m.role, m.body, m.updated_at AS msg_updated_at,
             t.provider, t.profile_id, t.profile_label, t.raw_id,
             t.title, t.preview, t.cwd, t.created_at, t.updated_at, t.archived
      FROM indexed_messages m
      JOIN indexed_threads t ON t.thread_id = m.thread_id
      WHERE ${scopeSql} AND ${msgConds}
      ORDER BY m.updated_at DESC, m.id DESC
      LIMIT ?
    `).all(...msgParams);

    for (const row of msgRows) {
      const entry = ensureEntry(row);
      entry.singleMsgMatched = true;
      entry.hasContentMatch = true;
      entry.matchCount += 1;
      if (!entry.bestMsgBody) {
        entry.bestMsgRole = row.role;
        entry.bestMsgBody = row.body;
      }
    }

    // 2) Metadata matches & cross-message/cross-field AND matches on indexed_threads.
    const metaOrContentParts = [];
    const metaOrContentParams = [];
    if (terms.length === 1) {
      const metaCond = buildMetaTermCondition(terms[0], aliasCwdsByTerm[0]);
      metaOrContentParts.push(metaCond.sql);
      metaOrContentParams.push(...metaCond.params);
    } else {
      for (let i = 0; i < terms.length; i += 1) {
        const metaCond = buildMetaTermCondition(terms[i], aliasCwdsByTerm[i]);
        metaOrContentParts.push(
          `(${metaCond.sql} OR EXISTS (SELECT 1 FROM indexed_messages m WHERE m.thread_id = t.thread_id AND m.body LIKE ? ESCAPE '\\'))`,
        );
        metaOrContentParams.push(...metaCond.params, escapeLikePattern(terms[i]));
      }
    }

    const threadRows = db.prepare(`
      SELECT t.thread_id, t.provider, t.profile_id, t.profile_label, t.raw_id,
             t.title, t.preview, t.cwd, t.created_at, t.updated_at, t.archived
      FROM indexed_threads t
      WHERE ${scopeSql} AND ${metaOrContentParts.join(" AND ")}
      ORDER BY t.updated_at DESC
      LIMIT ?
    `).all(...scopeParams, ...metaOrContentParams, Math.max(limit * 4, 240));

    // If a single-term query hit the message row cap across few threads, catch remaining threads via EXISTS.
    if (terms.length === 1 && msgRows.length >= Math.max(limit * 10, 600) && byThread.size < limit) {
      const extraRows = db.prepare(`
        SELECT t.thread_id, t.provider, t.profile_id, t.profile_label, t.raw_id,
               t.title, t.preview, t.cwd, t.created_at, t.updated_at, t.archived
        FROM indexed_threads t
        WHERE ${scopeSql}
          AND EXISTS (SELECT 1 FROM indexed_messages m WHERE m.thread_id = t.thread_id AND m.body LIKE ? ESCAPE '\\')
        ORDER BY t.updated_at DESC
        LIMIT ?
      `).all(...scopeParams, escapeLikePattern(terms[0]), Math.max(limit * 2, 120));
      for (const row of extraRows) {
        if (!byThread.has(row.thread_id)) {
          const entry = ensureEntry(row);
          entry.singleMsgMatched = true;
          entry.hasContentMatch = true;
          entry.matchCount = 1;
        }
      }
    }

    for (const row of threadRows) {
      ensureEntry(row);
    }

    if (memCustomTitleMatchedIds.length > 0) {
      for (let i = 0; i < memCustomTitleMatchedIds.length; i += 200) {
        const chunk = memCustomTitleMatchedIds.slice(i, i + 200);
        const placeholders = chunk.map(() => "?").join(", ");
        const customRows = db.prepare(`
          SELECT t.thread_id, t.provider, t.profile_id, t.profile_label, t.raw_id,
                 t.title, t.preview, t.cwd, t.created_at, t.updated_at, t.archived
          FROM indexed_threads t
          WHERE ${scopeSql} AND t.thread_id IN (${placeholders})
        `).all(...scopeParams, ...chunk);
        for (const row of customRows) {
          ensureEntry(row, true);
        }
      }
    }

    // Fetch a snippet message for cross-message/cross-field hits that weren't in Step 1.
    const anyTermCond = terms.map(() => "body LIKE ? ESCAPE '\\'").join(" OR ");
    const anyTermParams = terms.map(escapeLikePattern);
    const findSnippetStmt = db.prepare(`
      SELECT role, body
      FROM indexed_messages
      WHERE thread_id = ? AND (${anyTermCond})
      ORDER BY updated_at DESC, id DESC
      LIMIT 1
    `);
    const hasMsgTermStmt = db.prepare(`
      SELECT 1 AS ok
      FROM indexed_messages
      WHERE thread_id = ? AND body LIKE ? ESCAPE '\\'
      LIMIT 1
    `);

    const ranked = [];
    for (const entry of byThread.values()) {
      const { applied, allMatched, anyMatched } = evaluateMetaMatchFlags(
        entry.row,
        terms,
        aliasCwdsByTerm,
        this.#metaStore,
      );
      if (isInternalAssistantThread(applied)) continue;
      if (archived === "0" && applied.archived) continue;
      if (archived === "1" && !applied.archived) continue;

      if (entry.fromCustomMeta && !allMatched) {
        const metaHay = [
          applied.title || "",
          applied.preview || "",
          applied.cwd || "",
          applied.provider || "",
          applied.profileLabel || "",
        ].join(" ").toLowerCase();
        let allTermsSatisfied = true;
        for (let i = 0; i < terms.length; i += 1) {
          const inMeta = metaHay.includes(lowerTerms[i]) || Boolean(aliasCwdsByTerm[i]?.includes(applied.cwd));
          if (inMeta) continue;
          const inMsg = Boolean(hasMsgTermStmt.get(entry.row.thread_id, escapeLikePattern(terms[i])));
          if (!inMsg) {
            allTermsSatisfied = false;
            break;
          }
        }
        if (!allTermsSatisfied) continue;
      }

      if (!entry.bestMsgBody) {
        const hitMsg = findSnippetStmt.get(entry.row.thread_id, ...anyTermParams);
        if (hitMsg?.body) {
          entry.hasContentMatch = true;
          entry.bestMsgRole = hitMsg.role;
          entry.bestMsgBody = hitMsg.body;
          entry.matchCount = Math.max(1, entry.matchCount);
        }
      }

      if (!entry.hasContentMatch && !allMatched) {
        continue;
      }

      const rank = entry.singleMsgMatched
        ? (anyMatched ? 4 : 3)
        : (allMatched ? 2 : 1);
      const matchSource = entry.hasContentMatch
        ? (anyMatched ? "both" : "content")
        : "meta";
      const matchSnippet = entry.bestMsgBody
        ? extractMatchSnippet(entry.bestMsgBody, terms)
        : "";

      ranked.push({
        thread: applied,
        rank,
        updatedAt: Number(applied.updatedAt) || 0,
        searchMatch: {
          matchSource,
          matchRole: entry.bestMsgRole || "",
          matchSnippet,
          matchCount: entry.matchCount || (matchSource === "meta" ? 1 : 0),
        },
      });
    }

    ranked.sort((a, b) => (b.rank - a.rank) || (b.updatedAt - a.updatedAt));
    return ranked.slice(0, Math.max(1, Number(limit) || 60));
  }

  search({
    query = "",
    provider = "",
    profileId = "",
    archived = "0",
    cwd = "",
    limit = 60,
    projectsMeta = {},
  } = {}) {
    const terms = splitSearchTerms(query);
    if (!terms.length || !this.#enabled || this.#closed) {
      return { query: String(query || ""), terms, hits: [], indexStatus: this.getStatus() };
    }

    if (!this.#status.ready && !this.#syncInFlight) {
      void this.syncNow().catch(() => {});
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const db = this.#openReadDb();
      if (!db) {
        return { query: String(query || ""), terms, hits: [], indexStatus: this.getStatus() };
      }
      try {
        const hits = this.#runSearchQuery(db, {
          terms,
          provider,
          profileId,
          archived,
          cwd,
          limit,
          projectsMeta,
        });
        return { query: String(query || ""), terms, hits, indexStatus: this.getStatus() };
      } catch {
        this.#closeReadDb();
      }
    }

    return { query: String(query || ""), terms, hits: [], indexStatus: this.getStatus() };
  }

  async close() {
    this.#closed = true;
    if (this.#startupTimer) {
      clearTimeout(this.#startupTimer);
      this.#startupTimer = null;
    }
    if (this.#sweepTimer) {
      clearInterval(this.#sweepTimer);
      this.#sweepTimer = null;
    }
    for (const timer of this.#singleDirtyTimers.values()) {
      clearTimeout(timer);
    }
    this.#singleDirtyTimers.clear();
    this.#closeReadDb();

    for (const pending of this.#pendingRequests.values()) {
      pending.reject(new Error("搜索索引服务已关闭"));
    }
    this.#pendingRequests.clear();

    const worker = this.#worker;
    this.#worker = null;
    if (worker) {
      try {
        worker.postMessage({ type: "close" });
      } catch {
        // Ignore post errors on closing worker.
      }
      await worker.terminate().catch(() => {});
    }
  }
}
