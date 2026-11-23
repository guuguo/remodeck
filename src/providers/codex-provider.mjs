import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import { formatCompositeThreadId } from "../composite-id.mjs";
import { execFileCrossPlatform } from "../platform.mjs";
import { codexExecutionPolicy } from "../permissions.mjs";
import { cleanPreviewText, displayThreadTitle } from "../thread-display.mjs";
import { visibleControlThreads } from "../thread-access.mjs";
import { readCodexAccount } from "./codex-account.mjs";
import {
  appServerEnvironment,
  appServerExecutable,
  CodexAppServerClient,
  createServerRequestResponse,
  normalizeServerRequest,
} from "./codex-app-server-client.mjs";
import { loadCodexThreadHistory } from "./codex-thread-history.mjs";
import { readRolloutActivitySnapshot } from "./codex-thread-activity.mjs";
import {
  readCodexAutomationNames,
  readCodexQueuedCountsByThread,
  readCodexQueuedItems,
  readIndexedThreadById,
  readIndexedThreads,
} from "./codex-thread-index.mjs";
import { CodexThreadWriterRegistry } from "./codex-thread-writer.mjs";
import { discoverCodexProfiles, readCodexPublicEndpoint } from "./profile-discovery.mjs";

const CODEX_ACTIVE_WRITER_RE = /already has an active writer|\bactive writer\b|thread is busy|already running|turn in progress/i;
const CODEX_STEER_FALLBACK_RE = /thread not found|no active turn|turn.*not.*in progress|turn not found|expectedTurnId/i;
const CODEX_ARCHIVED_RE = /\bis archived\b|codex unarchive\b/i;
const CODEX_ALREADY_UNARCHIVED_RE = /\bnot archived\b|already unarchived|already active/i;
const CODEX_ALREADY_ARCHIVED_RE = /already archived/i;

function normalizeCodexTurnError(error, { steer = false, idleLock = false } = {}) {
  const msg = String(error?.message || error || "").trim();
  if (CODEX_ARCHIVED_RE.test(msg)) {
    return Object.assign(
      new Error(`该会话已在 Codex 中归档，解除归档后即可继续发送（${msg}）`),
      {
        status: 409,
        code: "thread_archived",
        rawMessage: msg,
      },
    );
  }
  if (CODEX_ACTIVE_WRITER_RE.test(msg)) {
    let text;
    if (idleLock) {
      text = `当前会话锁仍被本地 Codex 客户端占用（桌面端可能仍停留在当前会话），请在桌面端切走或关闭该会话后重试（${msg}）`;
    } else if (steer) {
      text = `当前会话正由本地 Codex 客户端执行，控制端无法直接引导插话，请留在排队等待当前轮次完成后自动发送（${msg}）`;
    } else {
      text = `当前会话正被其他任务占用（${msg}）`;
    }
    return Object.assign(
      new Error(text),
      {
        status: 409,
        code: "thread_busy",
        rawMessage: msg,
        idleLock: Boolean(idleLock),
      },
    );
  }
  return error;
}

function toTimestampSeconds(value, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : fallback;
}

function buildCodexInputItems(text, images = []) {
  const items = [];
  for (const image of images || []) {
    if (typeof image === "string" && image) {
      items.push({ type: "image", url: image });
    } else if (image?.dataUrl) {
      items.push({ type: "image", url: image.dataUrl });
    } else if (image?.url) {
      items.push({ type: "image", url: image.url });
    } else if (image?.path) {
      items.push({ type: "localImage", path: image.path });
    }
  }
  if (String(text || "").trim() || !items.length) {
    items.push({ type: "text", text: String(text || "") });
  }
  return items;
}

function shellQuote(value) {
  const str = String(value || "");
  if (/^[A-Za-z0-9_./:-]+$/.test(str)) return str;
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

function applescriptQuote(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export class CodexProvider {
  id = "codex";
  label = "Codex";
  #env;
  #dataDir;
  #profiles = [];
  #clients = new Map();
  #writers = new CodexThreadWriterRegistry();
  #modelsCache = new Map();
  #modelsRefreshInFlight = new Map();
  #rateLimitsByProfile = new Map();
  #resumedThreads = new Set();
  #execFileImpl;
  #onEvent;
  #onServerRequest;

  constructor({
    env = process.env,
    dataDir = "",
    execFileImpl = execFileCrossPlatform,
    onEvent = () => {},
    onServerRequest = () => {},
  } = {}) {
    this.#env = env;
    this.#dataDir = dataDir;
    this.#execFileImpl = execFileImpl;
    this.#onEvent = onEvent;
    this.#onServerRequest = onServerRequest;
  }

  setCallbacks({ onEvent, onServerRequest } = {}) {
    if (onEvent) this.#onEvent = onEvent;
    if (onServerRequest) this.#onServerRequest = onServerRequest;
  }

  async refreshProfiles() {
    const discovered = await discoverCodexProfiles({ env: this.#env, dataDir: this.#dataDir });
    const hasEnvApiKey = Boolean(String(this.#env?.OPENAI_API_KEY || "").trim());
    this.#profiles = await Promise.all(discovered.map(async (profile) => {
      const [account, endpoint] = await Promise.all([
        readCodexAccount(profile.home),
        readCodexPublicEndpoint(profile.home),
      ]);
      const needsLogin = Boolean(
        !account.signedIn
        && !endpoint.endpointHost
        && !hasEnvApiKey
        && (profile.managed || (profile.exists && profile.id !== "default")),
      );
      return {
        ...profile,
        account,
        modelProvider: endpoint.modelProvider || "",
        endpointHost: endpoint.endpointHost || "",
        endpointLabel: endpoint.endpointLabel || "",
        needsLogin,
        loginCommand: `CODEX_HOME=${shellQuote(profile.home)} codex login`,
        installed: Boolean(profile.exists || account.signedIn),
      };
    }));
    return this.#profiles;
  }

  async listProfiles() {
    if (!this.#profiles.length) await this.refreshProfiles();
    return this.#profiles.map((profile) => ({
      ...profile,
      online: Boolean(this.#clients.get(profile.id)?.isConnected),
    }));
  }

  async #getProfile(profileId) {
    const profiles = await this.listProfiles();
    const found = profiles.find((item) => item.id === profileId);
    if (!found) {
      throw Object.assign(new Error(`未知的 Codex 实例配置：${profileId}`), { status: 404 });
    }
    return found;
  }

  async #getClient(profileId) {
    const existing = this.#clients.get(profileId);
    if (existing) return existing;
    const profile = await this.#getProfile(profileId);
    const client = new CodexAppServerClient({
      codexHome: profile.home,
      env: this.#env,
    });
    client.on("notification", (msg) => this.#handleNotification(profileId, msg));
    client.on("serverRequest", (msg) => this.#handleServerRequest(profileId, msg));
    client.on("exit", (info) => {
      this.#resumedThreads.forEach((key) => {
        if (key.startsWith(`${profileId}:`)) this.#resumedThreads.delete(key);
      });
      this.#onEvent({
        type: "provider_exit",
        provider: "codex",
        profileId,
        info,
      });
    });
    this.#clients.set(profileId, client);
    return client;
  }

  #handleNotification(profileId, msg) {
    const method = msg?.method || "";
    const params = msg?.params || {};
    const rawId = params.threadId || params.thread?.id || "";
    const compositeId = rawId ? formatCompositeThreadId("codex", profileId, rawId) : "";

    if (method === "turn/started" && rawId) {
      this.#writers.markActive(rawId, { turnId: params.turn?.id || "" });
    } else if (method === "turn/completed" && rawId) {
      this.#writers.clearActive(rawId, params.turn?.id || "");
    } else if (method === "account/login/completed" || method === "account/updated") {
      this.#modelsCache.delete(profileId);
      this.#modelsRefreshInFlight.delete(profileId);
      this.#rateLimitsByProfile.delete(profileId);
      this.#onEvent({
        type: "profile_auth_updated",
        provider: "codex",
        profileId,
        loginId: params?.loginId || null,
        success: method === "account/login/completed" ? Boolean(params?.success) : true,
        error: params?.error || null,
      });
    } else if (method === "account/rateLimits/updated") {
      const rl = params?.rateLimits || params?.rate_limits || params;
      const byLimit = params?.rateLimitsByLimitId || params?.rate_limits_by_limit_id || null;
      if (rl && typeof rl === "object") {
        this.#rateLimitsByProfile.set(profileId, {
          rateLimits: rl,
          rateLimitsByLimitId: byLimit && typeof byLimit === "object" ? byLimit : null,
          updatedAt: Math.floor(Date.now() / 1000),
          source: "rpc-push",
        });
      }
    }

    this.#onEvent({
      type: "codex_notification",
      provider: "codex",
      profileId,
      rawId,
      threadId: compositeId,
      method,
      params,
    });
  }

  #handleServerRequest(profileId, msg) {
    const normalized = normalizeServerRequest(msg);
    const rawId = normalized.threadId || "";
    this.#onServerRequest({
      ...normalized,
      provider: "codex",
      profileId,
      rawThreadId: rawId,
      threadId: rawId ? formatCompositeThreadId("codex", profileId, rawId) : "",
    });
  }

  respondServerRequest(profileId, rawRequest, input = {}) {
    const client = this.#clients.get(profileId);
    if (!client) {
      throw Object.assign(new Error("Codex 实例客户端未连接"), { status: 409 });
    }
    if (input?.rejectError) {
      client.respondError(rawRequest.rawId, -32000, input.rejectError);
      return { ok: true };
    }
    const payload = input?.payload ?? createServerRequestResponse(rawRequest, input);
    client.respond(rawRequest.rawId, payload);
    return { ok: true };
  }

  #refreshModelsForProfile(profileId = "default") {
    let pending = this.#modelsRefreshInFlight.get(profileId);
    if (!pending) {
      pending = (async () => {
        const client = await this.#getClient(profileId);
        const result = await client.request("model/list", { limit: 100 });
        const items = (result?.data || result?.models || []).map((model) => ({
          id: model.id || model.model,
          model: model.model || model.id,
          displayName: model.displayName || model.model || model.id,
          description: model.description || "",
          provider: "codex",
          profileId,
          isDefault: Boolean(model.isDefault),
          defaultReasoningEffort: model.defaultReasoningEffort || "medium",
          supportedReasoningEfforts: (model.supportedReasoningEfforts || []).map((item) =>
            typeof item === "string" ? item : item.reasoningEffort,
          ).filter(Boolean),
        }));
        const profile = await this.#getProfile(profileId).catch(() => null);
        if (profile?.home) {
          const isRealOpenAiProfile = !profile.endpointHost || String(profile.modelProvider || "").includes("openai");
          const isTempTestHome = String(profile.home).startsWith(os.tmpdir());
          const cachePaths = [resolve(profile.home, "models_cache.json")];
          if (isRealOpenAiProfile && !isTempTestHome) {
            const defaultCodexCache = resolve(this.#env.HOME || os.homedir(), ".codex", "models_cache.json");
            if (defaultCodexCache !== cachePaths[0]) cachePaths.push(defaultCodexCache);
          }
          const existingIds = new Set(items.map((item) => item.id));
          const extra = [];
          for (const cachePath of cachePaths) {
            try {
              const rawCache = JSON.parse(readFileSync(cachePath, "utf8"));
              for (const entry of Array.isArray(rawCache?.models) ? rawCache.models : []) {
                const slug = String(entry?.slug || entry?.id || "").trim();
                if (!slug || existingIds.has(slug) || entry?.visibility !== "list") continue;
                existingIds.add(slug);
                extra.push({
                  id: slug,
                  model: slug,
                  displayName: String(entry.display_name || slug),
                  description: String(entry.description || ""),
                  provider: "codex",
                  profileId,
                  isDefault: false,
                  defaultReasoningEffort: String(entry.default_reasoning_level || "medium"),
                  supportedReasoningEfforts: (entry.supported_reasoning_levels || [])
                    .map((lvl) => (typeof lvl === "string" ? lvl : lvl?.effort))
                    .filter(Boolean),
                });
              }
            } catch {
              // Ignore missing or unreadable models_cache.json.
            }
          }
          if (extra.length) items.unshift(...extra);
        }
        this.#modelsCache.set(profileId, { at: Date.now(), items });
        return items;
      })().finally(() => {
        this.#modelsRefreshInFlight.delete(profileId);
      });
      this.#modelsRefreshInFlight.set(profileId, pending);
    }
    return pending;
  }

  async readRateLimits(profileId = "default", { refresh = false, timeoutMs = 3_000 } = {}) {
    if (!refresh) {
      const cached = this.#rateLimitsByProfile.get(profileId);
      if (cached) return cached;
    }

    const existingClient = this.#clients.get(profileId);
    const shouldQuery = Boolean(existingClient?.isConnected || refresh);
    if (!shouldQuery) return null;

    const profile = await this.#getProfile(profileId).catch(() => null);
    if (!profile?.installed) return null;
    if (profile.endpointHost && !profile.modelProvider?.includes("openai") && profile.modelProvider) {
      // Custom third-party endpoints usually do not expose ChatGPT rate limits.
      if (!existingClient?.isConnected && !refresh) return null;
    }

    let timer;
    try {
      const client = existingClient || await this.#getClient(profileId);
      const res = await Promise.race([
        client.request("account/rateLimits/read", {}),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Codex rateLimits read timeout")), timeoutMs);
          timer.unref?.();
        }),
      ]);
      const rateLimits = res?.rateLimits || res?.rate_limits || null;
      const byLimit = res?.rateLimitsByLimitId || res?.rate_limits_by_limit_id || null;
      if (!rateLimits || typeof rateLimits !== "object") return null;
      const entry = {
        rateLimits,
        rateLimitsByLimitId: byLimit && typeof byLimit === "object" ? byLimit : null,
        updatedAt: Math.floor(Date.now() / 1000),
        source: "rpc",
      };
      this.#rateLimitsByProfile.set(profileId, entry);
      return entry;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async listModels(profileId = "default") {
    const cached = this.#modelsCache.get(profileId);
    if (cached) {
      if (Date.now() - cached.at >= 60_000) {
        void this.#refreshModelsForProfile(profileId).catch(() => {});
      }
      return cached.items;
    }
    return this.#refreshModelsForProfile(profileId);
  }

  async probeProfile(profileId = "default", { timeoutMs = 8_000 } = {}) {
    await this.#getProfile(profileId);
    const started = Date.now();
    this.#modelsCache.delete(profileId);
    this.#modelsRefreshInFlight.delete(profileId);
    let timer;
    try {
      const items = await Promise.race([
        this.listModels(profileId),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Codex 测通超时 (${timeoutMs}ms)`)), timeoutMs);
        }),
      ]);
      return {
        ok: true,
        latencyMs: Math.max(1, Date.now() - started),
        modelCount: Array.isArray(items) ? items.length : 0,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  #resolveCleanThreadPreview(rawThread) {
    const candidates = [
      rawThread.preview,
      rawThread.firstUserText,
      rawThread.firstUserMessage,
      rawThread.lastUserText,
      rawThread.name,
      rawThread.title,
    ];
    for (const candidate of candidates) {
      const clean = cleanPreviewText(candidate, 120);
      if (clean) return clean;
    }
    const hintSources = [...candidates, rawThread.rawPreviewHint];
    const hadImageHint = hintSources.some((c) => /<image\b|Image attachment:\s*true/i.test(String(c || "")))
      || (Array.isArray(rawThread.turns) && rawThread.turns.some((turn) => (
        Array.isArray(turn?.items) && turn.items.some((item) => (
          item?.type === "userMessage"
          && Array.isArray(item.content)
          && item.content.some((part) => part?.type === "localImage" || part?.type === "image")
        ))
      )));
    return hadImageHint ? "[图片]" : "";
  }

  #normalizeThread(profile, rawThread) {
    const rawId = String(rawThread.id || "");
    const preview = this.#resolveCleanThreadPreview(rawThread);
    const cleanRawName = String(rawThread.name || "").trim();
    const cleanRawFirst = String(rawThread.firstUserText || rawThread.firstUserMessage || "").trim();
    const isLegacyTwoPartBracket = /^【[^】｜|]+[｜|][^】｜|]+】/.test(cleanRawName);
    const upstreamCustomTitle = (cleanRawName && cleanRawName !== cleanRawFirst && !isLegacyTwoPartBracket)
      ? cleanRawName
      : "";
    const thread = {
      id: formatCompositeThreadId("codex", profile.id, rawId),
      rawId,
      provider: "codex",
      providerLabel: "Codex",
      profileId: profile.id,
      profileLabel: profile.label,
      name: rawThread.name || "",
      upstreamTitle: rawThread.name || rawThread.title || "",
      ...(upstreamCustomTitle ? { upstreamCustomTitle } : {}),
      firstUserText: rawThread.firstUserText || rawThread.firstUserMessage || "",
      lastUserText: rawThread.lastUserText || "",
      hasFollowUpTurns: Boolean(rawThread.hasFollowUpTurns),
      title: displayThreadTitle({ ...rawThread, preview }),
      preview,
      cwd: rawThread.cwd || os.homedir(),
      createdAt: toTimestampSeconds(rawThread.createdAt),
      updatedAt: toTimestampSeconds(rawThread.updatedAt),
      model: rawThread.model || "",
      reasoningEffort: rawThread.reasoningEffort || "",
      source: rawThread.source || null,
      threadSource: rawThread.threadSource || "",
      rolloutPath: rawThread.rolloutPath || rawThread.path || "",
      archived: Boolean(rawThread.archived),
      live: Boolean(this.#writers.getActive(rawId) || rawThread.live),
      ...(rawThread.livePhase ? { livePhase: String(rawThread.livePhase) } : {}),
      ...(rawThread.liveDetail ? { liveDetail: String(rawThread.liveDetail) } : {}),
      gitInfo: rawThread.gitInfo || null,
      turns: rawThread.turns,
      largeHistory: Boolean(rawThread.largeHistory),
      nativeQueuedCount: Number(rawThread.nativeQueuedCount) || 0,
    };
    return thread;
  }

  async listThreads(profileId, { limit = 300, includeArchived = false } = {}) {
    const profile = await this.#getProfile(profileId);
    let rows = readIndexedThreads(profile.home, { limit, includeArchived });
    if (!rows) {
      const client = await this.#getClient(profileId);
      const res = await client.request("thread/list", { limit, archived: includeArchived });
      rows = res?.data || res?.threads || [];
    }
    const nowSec = Math.floor(Date.now() / 1000);
    const recentCandidates = [];
    for (const row of rows) {
      if (!row?.rolloutPath) continue;
      if (recentCandidates.length >= 16) break;
      const updatedSec = toTimestampSeconds(row.updatedAt);
      if (updatedSec > 0 && (nowSec - updatedSec) <= 15 * 60) {
        recentCandidates.push(row);
      }
    }
    if (recentCandidates.length) {
      await Promise.all(recentCandidates.map(async (row) => {
        const snap = await readRolloutActivitySnapshot(row.rolloutPath).catch(() => null);
        if (snap?.activity?.status === "running") {
          row.live = true;
          row.livePhase = snap.activity.phase || "Codex 执行中";
          row.liveDetail = snap.activity.text || "";
        }
      }));
    }
    const nativeQueuedCounts = readCodexQueuedCountsByThread(profile.home);
    return visibleControlThreads(rows.map((row) => this.#normalizeThread(profile, {
      ...row,
      nativeQueuedCount: nativeQueuedCounts.get(row.id) || row.nativeQueuedCount || 0,
    })));
  }

  async listNativeQueuedTurns(profileId, rawId) {
    const profile = await this.#getProfile(profileId);
    const compositeId = formatCompositeThreadId("codex", profile.id, rawId);
    return readCodexQueuedItems(profile.home, rawId).map((item) => ({ ...item, threadId: compositeId }));
  }

  async resolveThreadContext(profileId, rawId) {
    const profile = await this.#getProfile(profileId);
    const indexed = readIndexedThreadById(profile.home, rawId);
    if (!indexed) return null;
    return {
      cwd: indexed.cwd || os.homedir(),
      rolloutPath: indexed.rolloutPath || indexed.path || "",
    };
  }

  async readThread(profileId, rawId, { cursor = null, detail = "auto", limit = 12 } = {}) {
    const profile = await this.#getProfile(profileId);
    const indexed = readIndexedThreadById(profile.home, rawId);
    const automationNames = readCodexAutomationNames(profile.home);
    const indexedRolloutPath = indexed?.rolloutPath || indexed?.path || "";
    const [{ thread, nextCursor }, preloadedActivitySnapshot] = await Promise.all([
      loadCodexThreadHistory({
        getClient: () => this.#getClient(profileId),
        rawId,
        indexedThread: indexed,
        cursor,
        detail,
        limit,
        automationNames,
      }),
      indexedRolloutPath ? readRolloutActivitySnapshot(indexedRolloutPath) : Promise.resolve(null),
    ]);
    const compositeId = formatCompositeThreadId("codex", profile.id, rawId);
    const nativeQueuedTurns = readCodexQueuedItems(profile.home, rawId)
      .map((item) => ({ ...item, threadId: compositeId }));
    const resolvedRolloutPath = indexedRolloutPath || thread.rolloutPath || thread.path || "";
    const activitySnapshot = (preloadedActivitySnapshot && resolvedRolloutPath === indexedRolloutPath)
      ? preloadedActivitySnapshot
      : await readRolloutActivitySnapshot(resolvedRolloutPath);
    const isLive = Boolean(this.#writers.getActive(rawId) || activitySnapshot?.activity?.status === "running");
    const normalized = this.#normalizeThread(profile, {
      ...indexed,
      ...thread,
      archived: Boolean(indexed?.archived ?? thread?.archived),
      cwd: indexed?.cwd || thread.cwd || "",
      firstUserText: thread.firstUserText || indexed?.firstUserText || "",
      lastUserText: thread.lastUserText || indexed?.lastUserText || "",
      hasFollowUpTurns: Boolean(thread.hasFollowUpTurns || indexed?.hasFollowUpTurns),
      nativeQueuedCount: nativeQueuedTurns.length,
      live: isLive,
      ...(isLive && activitySnapshot?.activity?.phase ? { livePhase: activitySnapshot.activity.phase } : {}),
      ...(isLive && activitySnapshot?.activity?.text ? { liveDetail: activitySnapshot.activity.text } : {}),
    });
    const queueSig = nativeQueuedTurns.map((item) => item.id).join(",");
    const baseCursor = String(activitySnapshot.cursor || "");
    const combinedCursor = queueSig ? `${baseCursor}|q=${queueSig}` : baseCursor;
    return {
      thread: normalized,
      nextCursor,
      activity: activitySnapshot.activity,
      activityCursor: combinedCursor,
      nativeQueuedTurns,
    };
  }

  async getActivity(profileId, rawId, { cursor = null, rolloutPath = "" } = {}) {
    const profile = await this.#getProfile(profileId);
    const compositeId = formatCompositeThreadId("codex", profile.id, rawId);
    let resolvedPath = rolloutPath;
    if (!resolvedPath) {
      const indexed = readIndexedThreadById(profile.home, rawId);
      resolvedPath = indexed?.rolloutPath || "";
    }
    const baseInCursor = typeof cursor === "string" ? cursor.replace(/\|q=.*$/, "") : cursor;
    const snapshot = await readRolloutActivitySnapshot(resolvedPath, baseInCursor);
    const nativeQueuedTurns = readCodexQueuedItems(profile.home, rawId)
      .map((item) => ({ ...item, threadId: compositeId }));
    const queueSig = nativeQueuedTurns.map((item) => item.id).join(",");
    const baseCursor = String(snapshot.cursor || "");
    const combinedCursor = queueSig ? `${baseCursor}|q=${queueSig}` : baseCursor;
    const live = Boolean(this.#writers.getActive(rawId) || snapshot.activity?.status === "running");
    const changed = Boolean(snapshot.changed || (cursor && cursor !== combinedCursor));
    return {
      ...snapshot,
      cursor: combinedCursor,
      changed,
      live,
      nativeQueuedTurns,
    };
  }

  async #ensureThreadResumed(client, profileId, rawId, cwd = "", policy = null) {
    const key = `${profileId}:${rawId}`;
    if (this.#resumedThreads.has(key)) return;
    await client.request("thread/resume", {
      threadId: rawId,
      ...(cwd ? { cwd } : {}),
      ...(policy?.approvalPolicy ? { approvalPolicy: policy.approvalPolicy } : {}),
      ...(policy?.sandbox ? { sandbox: policy.sandbox } : {}),
    });
    this.#resumedThreads.add(key);
  }

  async startThread({
    profileId = "default",
    cwd = os.homedir(),
    text = "",
    images = [],
    model = "",
    effort = "",
    permissionMode = "workspace",
  } = {}) {
    const profile = await this.#getProfile(profileId);
    const client = await this.#getClient(profileId);
    const policy = codexExecutionPolicy(permissionMode);
    const created = await client.request("thread/start", {
      cwd,
      ...(model ? { model } : {}),
      approvalPolicy: policy.approvalPolicy,
      sandbox: policy.sandbox,
    });
    const rawThread = created?.thread || created;
    const rawId = String(rawThread.id || "");
    this.#resumedThreads.add(`${profileId}:${rawId}`);
    const thread = this.#normalizeThread(profile, rawThread);

    if (String(text || "").trim() || (images && images.length)) {
      const sent = await this.sendTurn({
        profileId,
        rawId,
        cwd,
        text,
        images,
        model,
        effort,
        permissionMode,
      });
      return {
        thread: sent.thread || thread,
        turn: sent.turn,
      };
    }
    return { thread, turn: null };
  }

  async forkThread({
    profileId = "default",
    rawId,
    lastTurnId = "",
    cwd = "",
    model = "",
    permissionMode = "workspace",
  } = {}) {
    const profile = await this.#getProfile(profileId);
    const client = await this.#getClient(profileId);
    const policy = codexExecutionPolicy(permissionMode);
    const forked = await client.request("thread/fork", {
      threadId: rawId,
      ...(lastTurnId ? { lastTurnId } : {}),
      ...(cwd ? { cwd } : {}),
      ...(model ? { model } : {}),
      approvalPolicy: policy.approvalPolicy,
      sandbox: policy.sandbox,
    });
    const rawThread = forked?.thread || forked;
    const newRawId = String(rawThread?.id || "");
    if (!newRawId) {
      throw Object.assign(new Error("Codex 未返回分叉后的新会话 ID"), { status: 502 });
    }
    this.#resumedThreads.add(`${profileId}:${newRawId}`);
    return {
      thread: this.#normalizeThread(profile, rawThread),
    };
  }

  async sendTurn({
    profileId = "default",
    rawId,
    cwd = "",
    text = "",
    images = [],
    model = "",
    effort = "",
    permissionMode = "workspace",
    steer = false,
    expectedTurnId = "",
    writerConflictPolicy = "reject",
  } = {}) {
    const profile = await this.#getProfile(profileId);
    const client = await this.#getClient(profileId);
    const policy = codexExecutionPolicy(permissionMode);
    const input = buildCodexInputItems(text, images);

    const indexed = (readIndexedThreads(profile.home, { limit: 400, includeArchived: true }) || [])
      .find((item) => item.id === rawId);
    const resolvedCwd = cwd || indexed?.cwd || "";
    const inMemoryActive = this.#writers.getActive(rawId);

    let activeTurnId = inMemoryActive?.turnId || expectedTurnId || "";
    if (steer && !activeTurnId && inMemoryActive) {
      const read = await this.readThread(profileId, rawId, { detail: "auto" }).catch(() => null);
      const runningTurn = (read?.thread?.turns || []).find((item) => item.status === "inProgress");
      activeTurnId = runningTurn?.id || "";
    }

    if (steer && activeTurnId) {
      let externalBusy = false;
      if (!inMemoryActive && writerConflictPolicy === "reject") {
        const conflict = await this.#writers.detectExternalWriter({
          rolloutPath: indexed?.rolloutPath || "",
        });
        externalBusy = Boolean(conflict.busy);
        if (conflict.busy) {
          throw Object.assign(
            new Error("当前会话正由本地 Codex 客户端执行，控制端无法直接引导插话，请留在排队等待当前轮次完成后自动发送"),
            { status: 409, code: "thread_busy" },
          );
        }
      }

      try {
        await this.#ensureThreadResumed(client, profileId, rawId, resolvedCwd, policy);
      } catch (error) {
        const idleLock = Boolean(!inMemoryActive && !externalBusy);
        throw normalizeCodexTurnError(error, { steer: !idleLock, idleLock });
      }

      let steerRes;
      let shouldFallbackToTurnStart = false;
      try {
        steerRes = await client.request("turn/steer", {
          threadId: rawId,
          expectedTurnId: activeTurnId,
          input,
        });
      } catch (error) {
        const msg = String(error?.message || error || "");
        if (CODEX_STEER_FALLBACK_RE.test(msg)) {
          this.#resumedThreads.delete(`${profileId}:${rawId}`);
          this.#writers.clearActive(rawId, activeTurnId);
          shouldFallbackToTurnStart = true;
        } else {
          const idleLock = Boolean(!inMemoryActive && !externalBusy);
          throw normalizeCodexTurnError(error, { steer: !idleLock, idleLock });
        }
      }
      if (!shouldFallbackToTurnStart) {
        return {
          turn: steerRes?.turn || { id: steerRes?.turnId || activeTurnId, status: "inProgress" },
          steered: true,
        };
      }
    }

    const activeAfterSteerAttempt = this.#writers.getActive(rawId);
    if (steer && activeAfterSteerAttempt) {
      await this.interrupt({ profileId, rawId }).catch(() => {});
      this.#writers.clearActive(rawId, activeAfterSteerAttempt.turnId || "");
    } else if (!steer && activeAfterSteerAttempt && writerConflictPolicy === "reject") {
      throw Object.assign(new Error("当前会话正在运行，请等待完成、插入引导或加入排队"), {
        status: 409,
        code: "thread_busy",
      });
    }

    if (writerConflictPolicy === "reject") {
      const conflict = await this.#writers.detectExternalWriter({
        rolloutPath: indexed?.rolloutPath || "",
      });
      if (conflict.busy) {
        throw Object.assign(new Error(conflict.message || "会话正被本地客户端占用"), {
          status: 409,
          code: conflict.source || "writer_conflict",
        });
      }
    }

    let result;
    try {
      await this.#ensureThreadResumed(client, profileId, rawId, resolvedCwd, policy);
      result = await client.request("turn/start", {
        threadId: rawId,
        input,
        ...(model ? { model } : {}),
        ...(effort ? { effort } : {}),
        approvalPolicy: policy.approvalPolicy,
        sandboxPolicy: policy.sandboxPolicy,
      });
    } catch (error) {
      const msg = String(error?.message || error || "");
      let idleLock = false;
      if (!this.#writers.getActive(rawId) && CODEX_ACTIVE_WRITER_RE.test(msg)) {
        const conflict = await this.#writers.detectExternalWriter({
          rolloutPath: indexed?.rolloutPath || "",
        }).catch(() => ({ busy: false }));
        idleLock = !conflict.busy;
      }
      throw normalizeCodexTurnError(error, { steer: false, idleLock });
    }
    const turn = result?.turn || result || { id: `turn-${Date.now()}`, status: "inProgress" };
    this.#writers.markActive(rawId, { turnId: turn.id || "" });
    return {
      turn,
      thread: this.#normalizeThread(profile, indexed || { id: rawId, cwd }),
    };
  }

  async queueNative({ profileId = "default", rawId, text = "" } = {}) {
    const profile = await this.#getProfile(profileId);
    const env = { ...this.#env, CODEX_HOME: profile.home };
    const { stdout = "" } = await this.#execFileImpl(
      appServerExecutable(env),
      ["queue", "--thread", rawId, "--message", String(text || "")],
      { env, shell: false, timeout: 15_000, maxBuffer: 64 * 1024 },
    );
    const messageId = String(stdout).match(/Queued message\s+(\S+)\s+for thread/i)?.[1] || "";
    return { supported: true, messageId };
  }

  async interrupt({ profileId = "default", rawId, turnId = "" } = {}) {
    const client = await this.#getClient(profileId);
    const resolvedTurnId = turnId || this.#writers.getActive(rawId)?.turnId || "";
    if (!resolvedTurnId) {
      const read = await this.readThread(profileId, rawId, { detail: "auto" }).catch(() => null);
      const active = (read?.thread?.turns || []).find((item) => item.status === "inProgress");
      if (!active?.id) return { ok: true, alreadyIdle: true };
      await client.request("turn/interrupt", { threadId: rawId, turnId: active.id });
      this.#writers.clearActive(rawId, active.id);
      return { ok: true, turnId: active.id };
    }
    await client.request("turn/interrupt", { threadId: rawId, turnId: resolvedTurnId });
    this.#writers.clearActive(rawId, resolvedTurnId);
    return { ok: true, turnId: resolvedTurnId };
  }

  async renameThread(profileId, rawId, name) {
    const client = await this.#getClient(profileId);
    await client.request("thread/name/set", { threadId: rawId, name }).catch((err) => {
      if (err?.code === -32601) return null;
      throw err;
    });
    return { ok: true };
  }

  async archiveThread(profileId, rawId) {
    const key = `${profileId}:${rawId}`;
    this.#resumedThreads.delete(key);
    const client = await this.#getClient(profileId);
    try {
      await client.request("thread/archive", { threadId: rawId });
    } catch (err) {
      if (err?.code !== -32601) throw err;
      const profile = await this.#getProfile(profileId);
      const env = { ...this.#env, CODEX_HOME: profile.home };
      try {
        await this.#execFileImpl(
          appServerExecutable(env),
          ["archive", rawId],
          { env, shell: false, timeout: 15_000, maxBuffer: 64 * 1024 },
        );
      } catch (cliErr) {
        const cliMsg = `${cliErr?.stderr || ""} ${cliErr?.stdout || ""} ${cliErr?.message || ""}`.trim();
        if (!CODEX_ALREADY_ARCHIVED_RE.test(cliMsg)) throw cliErr;
      }
    }
    this.#resumedThreads.delete(key);
    return { ok: true };
  }

  async unarchiveThread(profileId, rawId) {
    const key = `${profileId}:${rawId}`;
    this.#resumedThreads.delete(key);
    const client = await this.#getClient(profileId);
    try {
      await client.request("thread/unarchive", { threadId: rawId });
    } catch (rpcErr) {
      const profile = await this.#getProfile(profileId);
      const env = { ...this.#env, CODEX_HOME: profile.home };
      try {
        await this.#execFileImpl(
          appServerExecutable(env),
          ["unarchive", rawId],
          { env, shell: false, timeout: 15_000, maxBuffer: 64 * 1024 },
        );
      } catch (cliErr) {
        const cliMsg = `${cliErr?.stderr || ""} ${cliErr?.stdout || ""} ${cliErr?.message || ""}`.trim();
        if (CODEX_ALREADY_UNARCHIVED_RE.test(cliMsg)) {
          this.#resumedThreads.delete(key);
          return { ok: true, alreadyUnarchived: true };
        }
        const detail = String(cliErr?.stderr || cliErr?.message || rpcErr?.message || "解除归档失败").trim();
        throw Object.assign(new Error(detail), { status: 502, code: "unarchive_failed", cause: cliErr });
      }
    }
    this.#resumedThreads.delete(key);
    return { ok: true };
  }

  async setNativeGoal(profileId, rawId, enabled, options = {}) {
    const client = await this.#getClient(profileId);
    try {
      const result = await client.request("thread/goal/set", {
        threadId: rawId,
        enabled: Boolean(enabled),
        ...options,
      });
      return { supported: true, goalState: result?.goalState || result };
    } catch (error) {
      if (error?.code === -32601 || /unknown method|not found/i.test(String(error?.message || ""))) {
        return { supported: false };
      }
      throw error;
    }
  }

  async startProfileLogin(profileId = "default", { mode = "oauth", openOnHost = false } = {}) {
    const profile = await this.#getProfile(profileId);
    const loginCommand = `CODEX_HOME=${shellQuote(profile.home)} codex login`;
    const canOpenHost = Boolean(openOnHost && this.#env.AGENT_CONTROL_NO_HOST_OPEN !== "1");

    if (mode === "app") {
      try {
        const child = spawn(appServerExecutable(this.#env), ["app"], {
          env: appServerEnvironment(this.#env, profile.home),
          detached: true,
          stdio: "ignore",
        });
        child.on("error", () => {});
        child.unref();
      } catch {}
      return {
        ok: true,
        provider: "codex",
        profileId,
        mode: "app",
        loginCommand,
        message: "已使用独立实例目录启动 Codex 桌面端，登录或查看后可随时关闭窗口。",
      };
    }

    if (mode === "terminal") {
      let openedTerminal = false;
      if (process.platform === "darwin" && canOpenHost) {
        try {
          await this.#execFileImpl("osascript", [
            "-e",
            `tell application "Terminal" to do script ${applescriptQuote(loginCommand)}`,
            "-e",
            `tell application "Terminal" to activate`,
          ]);
          openedTerminal = true;
        } catch {}
      }
      return {
        ok: true,
        provider: "codex",
        profileId,
        mode: "terminal",
        openedTerminal,
        loginCommand,
      };
    }

    const client = await this.#getClient(profileId);
    const res = await client.request("account/login/start", { type: "chatgpt" });
    const authUrl = String(res?.authUrl || "");
    const loginId = String(res?.loginId || "");
    let openedBrowser = false;
    if (canOpenHost && authUrl && process.platform === "darwin") {
      try {
        await this.#execFileImpl("open", [authUrl]);
        openedBrowser = true;
      } catch {}
    }
    return {
      ok: true,
      provider: "codex",
      profileId,
      mode: "oauth",
      authUrl,
      loginId,
      openedBrowser,
      loginCommand,
    };
  }

  async closeProfile(profileId = "default") {
    this.#modelsCache.delete(profileId);
    this.#modelsRefreshInFlight.delete(profileId);
    this.#rateLimitsByProfile.delete(profileId);
    const client = this.#clients.get(profileId);
    if (client) {
      this.#clients.delete(profileId);
      await client.close().catch(() => {});
    }
  }

  async close() {
    for (const client of this.#clients.values()) {
      await client.close();
    }
    this.#clients.clear();
  }
}
