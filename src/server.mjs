import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  getCompressedImagePreview,
  lookupFileMimeType,
  readPreviewableFileMeta,
} from "./file-preview.mjs";
import {
  acceptsGzip,
  GZIP_MIN_BYTES,
  isCompressibleContentType,
  matchesIfNoneMatch,
  sendJson,
} from "./http-response.mjs";
import { defaultDataDir, ensureInstanceIdentity } from "./instance-identity.mjs";
import { listLanUrls } from "./lan-network.mjs";
import { listLocalApps, LOCAL_APPS_DIR, proxyLocalApp } from "./local-apps.mjs";
import {
  execFileCrossPlatform,
  expandHomePath,
  isSubpathOrEqual,
  normalizeWorkspacePath,
  pickNativeDirectory,
} from "./platform.mjs";
import { ProviderHub } from "./provider-hub.mjs";
import { listSlashCommands } from "./slash-commands.mjs";
import {
  isDirectLoopbackRequest,
  isHttpsForwardedRequest,
  isLoopbackSocketAddress,
  QuickTunnelManager,
  TailscaleFunnelManager,
  TunnelAuthGateway,
} from "./quick-tunnel.mjs";
import { RemoteBridge } from "./remote-bridge.mjs";
import { logRequestError } from "./request-logging.mjs";
import { acquireRuntimeLease } from "./runtime-lease.mjs";
import { AutomationScheduler } from "./automation-scheduler.mjs";
import { defaultVaultPath, MemoryVault, resolveEffectiveVaultPath, resolveVaultPath, writeMemoryConfig } from "./memory-vault.mjs";
import { MissionOverviewService } from "./mission-overview-service.mjs";
import { SpritePhoneArchive } from "./sprite-phone-archive.mjs";

function splitSpeechSegments(text = "") {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const rawParts = clean.match(/[^。！？；.!?\n]+[。！？；.!?\n]*/g) || [clean];
  const segments = [];
  for (const part of rawParts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (segments.length > 0 && Array.from(segments[segments.length - 1]).length < 8) {
      segments[segments.length - 1] = `${segments[segments.length - 1]} ${trimmed}`.trim();
    } else if (segments.length > 1 && Array.from(trimmed).length < 8) {
      segments[segments.length - 1] = `${segments[segments.length - 1]} ${trimmed}`.trim();
    } else {
      segments.push(trimmed);
    }
  }
  return segments.length ? segments : [clean];
}
import { getSkillSyncStatus, installSkill, uninstallSkill } from "./skill-sync.mjs";
import { buildTaskTree, TaskStore } from "./task-store.mjs";
import { UpdateService } from "./update-service.mjs";
import { createUsagePing } from "./usage-ping.mjs";
import { VoiceCallService } from "./voice-call-service.mjs";
import { HumanVerifyManager } from "./human-verify.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, "..", "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024;

async function readJsonBody(request, maxBytes = MAX_JSON_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw Object.assign(new Error("请求体过大"), { status: 413 });
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("请求 JSON 格式无效"), { status: 400 });
  }
}

async function serveStaticFile(response, urlPath, publicDir = PUBLIC_DIR, request = null) {
  let clean = decodeURIComponent(urlPath.split("?")[0] || "/");
  if (clean === "/") clean = "/index.html";
  const resolved = resolve(publicDir, `.${clean}`);
  if (!isSubpathOrEqual(publicDir, resolved)) {
    sendJson(response, 403, { error: { message: "禁止访问路径" } });
    return;
  }
  const info = await stat(resolved).catch(() => null);
  if (!info?.isFile()) {
    sendJson(response, 404, { error: { message: "静态资源不存在" } });
    return;
  }
  const ext = extname(resolved).toLowerCase();
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  const hasVersionParam = /[?&]v=[^&]+/.test(String(request?.url || urlPath || ""));
  const noStore = ext === ".html" || ((ext === ".js" || ext === ".mjs" || ext === ".css") && !hasVersionParam);
  const cacheControl = noStore ? "no-store" : "private, no-cache";
  const etag = `W/"${info.size}-${Math.trunc(info.mtimeMs)}"`;
  if (matchesIfNoneMatch(request?.headers?.["if-none-match"], etag)) {
    response.writeHead(304, {
      "Cache-Control": cacheControl,
      ETag: etag,
      Vary: "Accept-Encoding",
      "X-Content-Type-Options": "nosniff",
    });
    response.end();
    return;
  }
  const content = await readFile(resolved);
  const useGzip = content.length >= GZIP_MIN_BYTES
    && isCompressibleContentType(mime)
    && acceptsGzip(request?.headers?.["accept-encoding"]);
  const body = useGzip ? gzipSync(content, { level: 6 }) : content;
  const isHead = String(request?.method || "GET").toUpperCase() === "HEAD";
  response.writeHead(200, {
    "Content-Type": mime,
    "Cache-Control": cacheControl,
    ETag: etag,
    Vary: "Accept-Encoding",
    "Content-Length": String(body.length),
    ...(useGzip ? { "Content-Encoding": "gzip" } : {}),
    "X-Content-Type-Options": "nosniff",
  });
  response.end(isHead ? undefined : body);
}

export async function createAgentControlServer({
  port = Number(process.env.PORT ?? 43310),
  host = process.env.HOST || "127.0.0.1",
  env = process.env,
  dataDir = defaultDataDir(env),
  appsDir = dataDir ? resolve(dataDir, "apps") : LOCAL_APPS_DIR,
  publicDir = PUBLIC_DIR,
  disableRelay = env.AGENT_CONTROL_DISABLE_RELAY === "1",
  disableTunnel = env.AGENT_CONTROL_DISABLE_TUNNEL === "1",
  disableUpdateCheck = env.AGENT_CONTROL_DISABLE_AUTO_UPDATE === "1",
  disableTelemetry = disableUpdateCheck,
  requireAuth = env.AGENT_CONTROL_REQUIRE_AUTH === "1",
  providers = null,
  hub: customHub = null,
  remoteBridgeOptions = null,
  updateServiceOptions = null,
  humanVerifyOptions = null,
  revealFileImpl = null,
  pickDirectoryImpl = null,
  writeErrorLog,
} = {}) {
  const identity = await ensureInstanceIdentity({ dataDir });
  const sseClients = new Set();
  const broadcastSse = (eventName, payload) => {
    const chunk = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of [...sseClients]) {
      if (res.writableEnded || res.destroyed) {
        sseClients.delete(res);
        continue;
      }
      res.write(chunk);
    }
  };
  let hubRef = null;
  const projectTaskToVault = async (task, logs, { parentTitle = "", childTitles = [] } = {}) => {
    if (!dataDir) return;
    const enabled = hubRef ? hubRef.getSettings?.().sharedMemoryEnabled !== false : true;
    if (!enabled) return;
    const vaultRoot = await resolveEffectiveVaultPath({ env, dataDir, enabled });
    if (!vaultRoot) return;
    const vault = new MemoryVault(vaultRoot);
    const scope = await vault.resolveTopic({ topic: task.topicId, cwd: task.cwd }).catch(() => "");
    await vault.projectTask(task, logs, { scope: scope || task.topicId || "", parentTitle, childTitles });
  };
  const taskStore = customHub?.taskStore || (dataDir ? new TaskStore({
    dataDir,
    onChange: (evt) => broadcastSse("task_updated", evt),
    projectToVault: projectTaskToVault,
  }) : null);
  const hub = customHub || new ProviderHub({ env, dataDir, providers, taskStore });
  hubRef = hub;
  await hub.init();

  const voiceService = new VoiceCallService({
    hub,
    env,
    dataDir,
    onEvent: (eventName, payload) => broadcastSse(eventName, payload),
  });

  const overviewService = new MissionOverviewService({
    hub,
    env,
    dataDir,
    broadcast: (eventName, payload) => broadcastSse(eventName, payload),
    assistantOptions: { taskStore },
  });
  overviewService.voiceService = voiceService;

  const unsubscribeHub = hub.subscribe((eventName, payload) => {
    broadcastSse(eventName, payload);
    void voiceService.handleHubEvent?.(eventName, payload);
    void overviewService.assistant?.handleHubEvent?.(eventName, payload);
  });

  const bridgeInternalToken = randomBytes(32).toString("hex");
  const bridgeInternalTokenBuf = Buffer.from(bridgeInternalToken);
  const hasValidBridgeToken = (request) => {
    if (!isLoopbackSocketAddress(request.socket?.remoteAddress)) return false;
    const raw = request.headers?.["x-ac-bridge-token"];
    if (!raw || Array.isArray(raw)) return false;
    const candidateBuf = Buffer.from(String(raw));
    return candidateBuf.length === bridgeInternalTokenBuf.length
      && timingSafeEqual(candidateBuf, bridgeInternalTokenBuf);
  };

  const bridge = new RemoteBridge({
    ...(remoteBridgeOptions || {}),
    dataDir,
    instanceId: identity.instanceId,
    label: identity.label,
    disabled: disableRelay,
    internalAuthToken: bridgeInternalToken,
    onStateChange: (snapshot) => broadcastSse("remote_status", { ...snapshot, pairUrl: "" }),
  });
  await bridge.load();

  const tunnelAuth = new TunnelAuthGateway({
    dataDir,
    instanceId: identity.instanceId,
  });
  await tunnelAuth.load();

  const quickTunnel = new QuickTunnelManager({
    env,
    authGateway: tunnelAuth,
    disabled: disableTunnel,
    onStateChange: (snapshot) => broadcastSse("tunnel_status", snapshot),
  });

  const tailscaleFunnel = new TailscaleFunnelManager({
    env,
    authGateway: tunnelAuth,
    disabled: disableTunnel,
  });

  let closeServerResources = null;
  const effectiveEnv = Number(port) > 0 ? { ...env, PORT: String(port) } : env;
  const updateService = new UpdateService({
    dataDir,
    env: effectiveEnv,
    ...(updateServiceOptions || {}),
    canAutoUpdateIdle: async () => {
      if (typeof updateServiceOptions?.canAutoUpdateIdle === "function") {
        return updateServiceOptions.canAutoUpdateIdle();
      }
      const voiceStatus = voiceService.getCallDeliveryStatus?.({ callId: "" });
      if (voiceStatus?.activeCount > 0) return false;
      const tel = await hub.getTelemetry().catch(() => null);
      if (Number(tel?.totals?.runningCount || 0) > 0) return false;
      return (hub.allQueuedTurns()?.length || 0) === 0;
    },
    onUnattendedRestart: async () => {
      await closeServerResources?.();
    },
    onStatusChange: (snap) => broadcastSse("update_status", snap),
  });
  await updateService.load();

  const automationScheduler = new AutomationScheduler({
    hub,
    dataDir,
    onEvent: (eventName, payload) => broadcastSse(eventName, payload),
  });
  await automationScheduler.load();
  // The park assistant surfaces failed scheduled runs and can retry them.
  overviewService.assistant.automations = { list: () => automationScheduler.listTasks(), run: (taskKey) => automationScheduler.runNow(taskKey) };

  const humanVerify = new HumanVerifyManager({
    dataDir,
    env,
    onEvent: (eventName, payload) => broadcastSse(eventName, payload),
    ...(humanVerifyOptions || {}),
  });

  const spritePhoneArchive = new SpritePhoneArchive({ dataDir });
  spritePhoneArchive.startCleanupTimer();

  const heartbeat = setInterval(() => {
    for (const res of [...sseClients]) {
      if (res.writableEnded || res.destroyed) {
        sseClients.delete(res);
        continue;
      }
      res.write(": ping\n\n");
    }
  }, 20_000);
  heartbeat.unref?.();

  let actualPort = port;
  let leaseHandle = null;
  let lastKnownRemoteFallbackUrl = "";

  const normalizeFallbackUrl = (rawUrl) => {
    const text = String(rawUrl || "").trim();
    if (!text) return "";
    try {
      const parsed = new URL(text);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return "";
    }
  };

  const resolveRemoteFallbackUrl = () => {
    if (lastKnownRemoteFallbackUrl) return lastKnownRemoteFallbackUrl;
    const remoteSnap = bridge.statusSnapshot();
    if (remoteSnap.connected && remoteSnap.relayUrl) {
      return `${String(remoteSnap.relayUrl).replace(/\/+$/, "")}/i/${encodeURIComponent(identity.instanceId)}/`;
    }
    if (tunnelAuth.fixedPublicUrl) {
      return `${String(tunnelAuth.fixedPublicUrl).replace(/\/+$/, "")}/`;
    }
    const tunnelSnap = quickTunnel.statusSnapshot();
    if (tunnelSnap.publicUrl) {
      return `${String(tunnelSnap.publicUrl).replace(/\/+$/, "")}/`;
    }
    return "";
  };

  const getLanStatusSnapshot = () => ({
    ...listLanUrls({ port: actualPort, host }),
    fallbackUrl: resolveRemoteFallbackUrl(),
  });

  const server = http.createServer(async (request, response) => {
    const requestId = randomUUID().slice(0, 8);
    const context = {
      requestId,
      method: request.method || "GET",
      path: request.url || "/",
      startedAt: Date.now(),
      threadId: "",
    };

    try {
      const origin = `http://${request.headers.host || `${host}:${actualPort}`}`;
      const url = new URL(request.url || "/", origin);
      const pathname = url.pathname;

      const directLoopback = isDirectLoopbackRequest(request);
      const trustedBridge = hasValidBridgeToken(request);
      const tunnelAuthed = tunnelAuth.isAuthenticatedRequest(request);
      const isAuthorized = trustedBridge || (!requireAuth && directLoopback) || tunnelAuthed;
      const canManageRemote = !requireAuth && directLoopback;

      const connectMatch = pathname.match(/^\/connect\/([^/]+)\/?$/);
      if (connectMatch && (request.method === "GET" || request.method === "HEAD")) {
        let decodedToken = "";
        try {
          decodedToken = decodeURIComponent(connectMatch[1]);
        } catch {
          decodedToken = "";
        }
        const sessionToken = await tunnelAuth.redeemConnectToken(decodedToken);
        if (!sessionToken) {
          response.writeHead(403, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          response.end(request.method === "HEAD" ? undefined : tunnelAuth.unauthorizedHtml("配对链接无效或已重置，请在本机控制台重新扫码。"));
          return;
        }
        const secureSuffix = isHttpsForwardedRequest(request) ? "; Secure" : "";
        const nextThread = String(url.searchParams.get("thread") || "").trim();
        const redirectLocation = nextThread ? `/?thread=${encodeURIComponent(nextThread)}` : "/";
        response.writeHead(302, {
          Location: redirectLocation,
          "Cache-Control": "no-store",
          "Set-Cookie": `${tunnelAuth.cookieName()}=${encodeURIComponent(sessionToken)}; Path=/; Max-Age=${30 * 24 * 3600}; HttpOnly; SameSite=Lax${secureSuffix}`,
          "X-Content-Type-Options": "nosniff",
        });
        response.end();
        return;
      }

      if (pathname === "/health" && request.method === "GET") {
        if (!isAuthorized) {
          sendJson(response, 200, {
            ok: true,
            service: "agent-control",
            authRequired: true,
          }, { requestId });
          return;
        }
        const providerSummary = await hub.listProvidersAndProfiles();
        const remoteSnap = bridge.statusSnapshot();
        sendJson(response, 200, {
          ok: true,
          service: "agent-control",
          instanceId: identity.instanceId,
          label: identity.label,
          url: `http://${host}:${actualPort}`,
          ...providerSummary,
          remote: canManageRemote ? remoteSnap : { ...remoteSnap, pairUrl: "" },
          tunnel: quickTunnel.statusSnapshot({ includeSecrets: canManageRemote }),
          lan: getLanStatusSnapshot(),
          update: updateService.statusSnapshot(),
        }, { requestId });
        return;
      }

      if (!isAuthorized) {
        const isHtmlRequest = (request.method === "GET" || request.method === "HEAD")
          && !pathname.startsWith("/api/")
          && (pathname === "/" || pathname === "/index.html" || String(request.headers.accept || "").includes("text/html"));
        if (isHtmlRequest) {
          response.writeHead(401, {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
          });
          response.end(request.method === "HEAD" ? undefined : tunnelAuth.unauthorizedHtml());
          return;
        }
        sendJson(response, 401, {
          error: {
            code: "unauthorized",
            message: "未授权访问：请在本机控制台打开「手机远程」扫码配对连接",
          },
        }, { requestId });
        return;
      }

      if (pathname.startsWith("/apps/")) {
        const handled = await proxyLocalApp(request, response, url, appsDir, {
          instanceId: identity.instanceId,
        });
        if (handled) return;
      }

      if (pathname === "/api/providers" && request.method === "GET") {
        const providerSummary = await hub.listProvidersAndProfiles();
        sendJson(response, 200, {
          ...providerSummary,
          instanceId: identity.instanceId,
          label: identity.label,
        }, { requestId });
        return;
      }

      if (pathname === "/api/cli/status" && request.method === "GET") {
        const cliStatus = await hub.getCliStatus();
        sendJson(response, 200, { cliStatus }, { requestId });
        return;
      }

      if (pathname === "/api/cli/check" && request.method === "POST") {
        await readJsonBody(request).catch(() => ({}));
        const cliStatus = await hub.checkCliUpdates({ force: true });
        sendJson(response, 200, { cliStatus }, { requestId });
        return;
      }

      if (pathname === "/api/cli/upgrade" && request.method === "POST") {
        const body = await readJsonBody(request);
        const provider = String(body.provider || "").trim();
        if (!provider) {
          sendJson(response, 400, { error: { code: "BAD_REQUEST", message: "provider 不能为空" } }, { requestId });
          return;
        }
        const result = await hub.upgradeCli(provider, { force: body.force !== false });
        const cliStatus = await hub.getCliStatus();
        sendJson(response, 200, { ...result, cliStatus }, { requestId });
        return;
      }

      if (pathname === "/api/cli/install" && request.method === "POST") {
        const body = await readJsonBody(request);
        const provider = String(body.provider || "").trim();
        if (!provider) {
          sendJson(response, 400, { error: { code: "BAD_REQUEST", message: "provider 不能为空" } }, { requestId });
          return;
        }
        const result = body.upgrade
          ? await hub.upgradeCli(provider, { force: body.force !== false })
          : await hub.repairCli(provider, { force: body.force !== false });
        const cliStatus = await hub.getCliStatus();
        sendJson(response, 200, { ...result, cliStatus }, { requestId });
        return;
      }

      if (pathname === "/api/quotas" && request.method === "GET") {
        const refresh = url.searchParams.get("refresh") === "1" || url.searchParams.get("refresh") === "true";
        const quotaSummary = await hub.listQuotas({ refresh });
        sendJson(response, 200, {
          ...quotaSummary,
          instanceId: identity.instanceId,
          label: identity.label,
        }, { requestId });
        return;
      }

      if (pathname === "/api/quotas/refresh" && request.method === "POST") {
        await readJsonBody(request).catch(() => ({}));
        const quotaSummary = await hub.listQuotas({ refresh: true });
        sendJson(response, 200, {
          ...quotaSummary,
          instanceId: identity.instanceId,
          label: identity.label,
        }, { requestId });
        return;
      }

      if (pathname === "/api/executions" && request.method === "GET") {
        sendJson(response, 200, hub.getExecutionStats({
          days: Number(url.searchParams.get("days") ?? 7),
          provider: url.searchParams.get("provider") || "all",
        }), { requestId });
        return;
      }

      if (pathname === "/api/telemetry" && request.method === "GET") {
        const telemetry = await hub.getTelemetry();
        sendJson(response, 200, {
          ...telemetry,
          instanceId: identity.instanceId,
          label: identity.label,
        }, { requestId });
        return;
      }

      if (pathname === "/api/models" && request.method === "GET") {
        const provider = url.searchParams.get("provider") || "";
        const profileId = url.searchParams.get("profileId") || "";
        const models = await hub.listModels({ provider, profileId });
        sendJson(response, 200, models, { requestId });
        return;
      }

      if (pathname === "/api/slash-commands" && request.method === "GET") {
        const provider = url.searchParams.get("provider") || "";
        const cwd = url.searchParams.get("cwd") || "";
        const query = url.searchParams.get("q") || "";
        const items = await listSlashCommands({ provider, cwd, query });
        sendJson(response, 200, { ok: true, provider, items }, { requestId });
        return;
      }

      if (pathname === "/api/threads" && request.method === "GET") {
        const provider = url.searchParams.get("provider") || "";
        const profileId = url.searchParams.get("profileId") || "";
        const archived = url.searchParams.get("archived") || "0";
        const limit = Number(url.searchParams.get("limit") || 300);
        const result = await hub.listThreads({ provider, profileId, archived, limit });
        const slimThreads = Array.isArray(result?.threads)
          ? result.threads.map(({
            rolloutPath: _rp,
            path: _p,
            gitInfo: _git,
            firstUserText: _fut,
            lastUserText: _lut,
            autoTitle: _at,
            autoTitleSourceSig: _ats,
            autoTitleIsDrift: _atd,
            ...rest
          }) => rest)
          : [];
        sendJson(response, 200, { ...result, threads: slimThreads }, { requestId });
        return;
      }

      if (pathname === "/api/threads/search" && request.method === "GET") {
        const query = url.searchParams.get("q") || "";
        const provider = url.searchParams.get("provider") || "";
        const profileId = url.searchParams.get("profileId") || "";
        const archived = url.searchParams.get("archived") || "0";
        const cwd = url.searchParams.get("cwd") || "";
        const limit = Math.max(1, Math.min(150, Number(url.searchParams.get("limit") || 60)));
        const result = await hub.searchThreads({ query, provider, profileId, archived, cwd, limit });
        const slimThreads = Array.isArray(result?.threads)
          ? result.threads.map(({
            rolloutPath: _rp,
            path: _p,
            sourcePath: _sp,
            gitInfo: _git,
            firstUserText: _fut,
            lastUserText: _lut,
            autoTitle: _at,
            autoTitleSourceSig: _ats,
            autoTitleIsDrift: _atd,
            ...rest
          }) => rest)
          : [];
        sendJson(response, 200, {
          ok: true,
          query: result.query,
          terms: result.terms,
          threads: slimThreads,
          indexStatus: result.indexStatus,
        }, { requestId });
        return;
      }

      if (pathname === "/api/projects/meta" && request.method === "GET") {
        sendJson(response, 200, { projectsMeta: hub.listProjectsMeta() }, { requestId });
        return;
      }

      if (pathname === "/api/project/meta" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await hub.updateProjectMeta(body.cwd, {
          ...(Object.hasOwn(body, "pinned") ? { pinned: body.pinned } : {}),
          ...(Object.hasOwn(body, "alias") ? { alias: body.alias } : {}),
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/overview" && request.method === "GET") {
        const trigger = url.searchParams.get("trigger") || "view";
        const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
        const result = await overviewService.getOverview({ trigger, force });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/assistant/ask" && request.method === "POST") {
        const body = await readJsonBody(request);
        const streaming = String(request.headers.accept || "").includes("application/x-ndjson");
        const abortController = new AbortController();
        const onDisconnect = () => {
          if (!response.writableEnded) abortController.abort();
        };
        request.once("aborted", onDisconnect);
        response.once("close", onDisconnect);
        const writeLine = (value) => {
          if (response.writableEnded || response.destroyed || abortController.signal.aborted) return;
          if (!response.headersSent) {
            response.writeHead(200, { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache", "X-Accel-Buffering": "no" });
          }
          response.write(`${JSON.stringify(value)}\n`);
        };
        let heartbeatTimer = null;
        if (streaming) {
          heartbeatTimer = setInterval(() => {
            if (response.headersSent && !response.writableEnded && !abortController.signal.aborted) {
              writeLine({ type: "ping", ts: Date.now() });
            }
          }, 8_000);
          heartbeatTimer.unref?.();
        }
        try {
          const result = await overviewService.assistant.ask(body, {
            onTrace: streaming ? (item) => writeLine({ type: "trace", ...item }) : undefined,
            signal: abortController.signal,
          });
          if (abortController.signal.aborted || response.writableEnded || response.destroyed) return;
          if (streaming) {
            const { trace: _trace, ...answer } = result;
            writeLine({ type: "answer", ...answer });
            response.end();
          } else sendJson(response, 200, result, { requestId });
        } catch (error) {
          if (abortController.signal.aborted || error?.aborted || error?.name === "AbortError") {
            if (response.headersSent && !response.writableEnded) response.end();
            return;
          }
          if (!response.headersSent) throw error;
          writeLine({ type: "error", message: error.message || "检索失败" });
          response.end();
        } finally {
          clearInterval(heartbeatTimer);
          request.removeListener("aborted", onDisconnect);
          response.removeListener("close", onDisconnect);
        }
        return;
      }

      if (pathname === "/api/assistant/tour" && request.method === "GET") {
        sendJson(response, 200, await overviewService.assistant.tour({ since: url.searchParams.get("since") || "" }), { requestId });
        return;
      }
      if (pathname === "/api/assistant/profile" && ["GET", "DELETE"].includes(request.method)) {
        const result = request.method === "DELETE" ? await overviewService.assistant.clearProfile() : await overviewService.assistant.profile();
        sendJson(response, 200, result, { requestId });
        return;
      }
      if (pathname === "/api/assistant/profile/aliases" && request.method === "POST") {
        sendJson(response, 200, await overviewService.assistant.addAlias(await readJsonBody(request)), { requestId });
        return;
      }
      if (pathname === "/api/assistant/tickets" && ["GET", "POST"].includes(request.method)) {
        const result = request.method === "POST" ? await overviewService.assistant.createTicket(await readJsonBody(request))
          : await overviewService.assistant.listTickets({ status: url.searchParams.get("status") || "open" });
        sendJson(response, 200, result, { requestId });
        return;
      }
      const assistantTicket = pathname.match(/^\/api\/assistant\/tickets\/([^/]+)$/);
      if (assistantTicket && request.method === "POST") {
        sendJson(response, 200, await overviewService.assistant.updateTicket(decodeURIComponent(assistantTicket[1]), await readJsonBody(request)), { requestId });
        return;
      }

      if (pathname === "/api/tasks" && request.method === "GET") {
        const status = url.searchParams.get("status") || "open";
        const topicId = url.searchParams.get("topicId") || "";
        const cwd = url.searchParams.get("cwd") || "";
        const threadId = url.searchParams.get("threadId") || "";
        const { tasks } = await overviewService.assistant.listTickets({ status });
        let filtered = tasks;
        if (topicId) filtered = filtered.filter((t) => t.topicId === topicId);
        if (cwd) {
          const norm = normalizeWorkspacePath(cwd);
          filtered = filtered.filter((t) => normalizeWorkspacePath(t.cwd || "") === norm);
        }
        if (threadId) filtered = filtered.filter((t) => (t.threadIds || []).includes(threadId));
        sendJson(response, 200, { tasks: filtered, tree: buildTaskTree(filtered) }, { requestId });
        return;
      }

      if (pathname === "/api/tasks" && request.method === "POST") {
        if (!taskStore) throw Object.assign(new Error("任务存储未就绪"), { status: 500 });
        const body = await readJsonBody(request);
        const initialThreads = Array.isArray(body.threadIds) ? [...body.threadIds] : [];
        if (body.sourceThreadId && !initialThreads.includes(body.sourceThreadId)) {
          initialThreads.unshift(String(body.sourceThreadId).trim());
        }
        const task = await taskStore.create({
          title: body.title,
          goal: body.goal || "",
          criteria: body.criteria ?? [],
          parentId: body.parentId || "",
          topicId: body.topicId || "",
          cwd: body.cwd ? normalizeWorkspacePath(expandHomePath(String(body.cwd), env)) : "",
          threadIds: initialThreads,
          actor: "user",
        });
        for (const tid of task.threadIds) {
          await hub.setThreadTask?.(tid, task.id).catch(() => {});
        }
        sendJson(response, 200, { ok: true, task }, { requestId });
        return;
      }

      const taskPlanMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/plan$/);
      if (taskPlanMatch && request.method === "POST") {
        if (!taskStore) throw Object.assign(new Error("任务存储未就绪"), { status: 500 });
        const id = decodeURIComponent(taskPlanMatch[1]);
        const body = await readJsonBody(request);
        const task = await taskStore.pinPlan(id, {
          threadId: body.threadId,
          turnId: body.turnId || "",
          turnIndex: Number.isInteger(Number(body.turnIndex)) ? Number(body.turnIndex) : -1,
          excerpt: body.excerpt || "",
          actor: "user",
        });
        await hub.setThreadTask?.(body.threadId, task.id).catch(() => {});
        sendJson(response, 200, { ok: true, task }, { requestId });
        return;
      }

      const taskLogMatch = pathname.match(/^\/api\/tasks\/([^/]+)\/log$/);
      if (taskLogMatch && request.method === "POST") {
        if (!taskStore) throw Object.assign(new Error("任务存储未就绪"), { status: 500 });
        const id = decodeURIComponent(taskLogMatch[1]);
        const body = await readJsonBody(request);
        const entry = await taskStore.appendLog(id, {
          kind: body.kind || "agent_log",
          actor: body.actor || "user",
          threadId: body.threadId || "",
          text: body.text || "",
        });
        sendJson(response, 200, { ok: true, entry }, { requestId });
        return;
      }

      const taskItemMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskItemMatch && request.method === "GET") {
        if (!taskStore) throw Object.assign(new Error("任务存储未就绪"), { status: 500 });
        const id = decodeURIComponent(taskItemMatch[1]);
        const task = await taskStore.get(id);
        if (!task) throw Object.assign(new Error("任务不存在"), { status: 404 });
        const [ancestors, children, logs, listed] = await Promise.all([
          taskStore.getAncestors(id),
          taskStore.getChildren(id),
          taskStore.readLogs(id, { limit: Number(url.searchParams.get("limit")) || 50 }),
          hub.listThreads({ archived: "all", limit: 200 }).catch(() => ({ threads: [] })),
        ]);
        const threadById = new Map((listed.threads || []).map((t) => [t.id, t]));
        const threads = task.threadIds.map((tid) => threadById.get(tid) || { id: tid, title: tid, missing: true });
        sendJson(response, 200, { task, ancestors, children, logs, threads }, { requestId });
        return;
      }

      if (taskItemMatch && request.method === "POST") {
        const id = decodeURIComponent(taskItemMatch[1]);
        const result = await overviewService.assistant.updateTicket(id, await readJsonBody(request));
        sendJson(response, 200, { ok: true, task: result.ticket }, { requestId });
        return;
      }

      if (pathname === "/api/thread/pin-plan" && request.method === "POST") {
        if (!taskStore) throw Object.assign(new Error("任务存储未就绪"), { status: 500 });
        const body = await readJsonBody(request);
        const threadId = String(body.threadId || "").trim();
        if (!threadId) throw Object.assign(new Error("缺少会话 ID"), { status: 400 });
        context.threadId = threadId;
        let task = null;
        if (body.taskId) {
          task = await taskStore.get(body.taskId);
        }
        if (!task) {
          const metaTaskId = hub.listThreadsMeta?.()?.[threadId]?.taskId;
          task = (metaTaskId ? await taskStore.get(metaTaskId) : null) || await taskStore.findByThreadId(threadId);
        }
        if (!task) {
          const readRes = await hub.readThread(threadId, { limit: 1, detail: "auto" }).catch(() => null);
          const th = readRes?.thread || {};
          const fallbackTitle = String(body.taskTitle || th.title || th.name || body.excerpt || "规划任务").replace(/\s+/g, " ").trim().slice(0, 48);
          task = await taskStore.create({
            title: fallbackTitle,
            cwd: th.cwd || "",
            threadIds: [threadId],
            actor: "user",
          });
        }
        task = await taskStore.pinPlan(task.id, {
          threadId,
          turnId: body.turnId || "",
          turnIndex: Number.isInteger(Number(body.turnIndex)) ? Number(body.turnIndex) : -1,
          excerpt: body.excerpt || "",
          actor: "user",
        });
        await hub.setThreadTask?.(threadId, task.id).catch(() => {});
        sendJson(response, 200, { ok: true, task }, { requestId });
        return;
      }

      if (pathname === "/api/memory/config" && request.method === "GET") {
        const enabled = hub.getSettings().sharedMemoryEnabled !== false;
        const explicit = await resolveVaultPath({ env, dataDir });
        const effective = await resolveEffectiveVaultPath({ env, dataDir, enabled });
        sendJson(response, 200, {
          enabled,
          vaultPath: explicit === defaultVaultPath(dataDir) ? "" : explicit,
          envVaultPath: env?.AC_MEMORY_VAULT || "",
          effectiveVaultPath: effective,
          defaultVaultPath: defaultVaultPath(dataDir),
          isDefaultVault: !explicit && !env?.AC_MEMORY_VAULT,
        }, { requestId });
        return;
      }

      if (pathname === "/api/memory/config" && request.method === "POST") {
        const body = await readJsonBody(request);
        if (Object.hasOwn(body || {}, "enabled")) {
          await hub.setSettings({ sharedMemoryEnabled: Boolean(body.enabled) });
        }
        if (Object.hasOwn(body || {}, "vaultPath")) {
          const rawVault = String(body.vaultPath || "").trim();
          const expanded = rawVault ? expandHomePath(rawVault, env) : "";
          await writeMemoryConfig(dataDir, { vaultPath: expanded });
        }
        const enabled = hub.getSettings().sharedMemoryEnabled !== false;
        const explicit = await resolveVaultPath({ env, dataDir });
        const effective = await resolveEffectiveVaultPath({ env, dataDir, enabled });
        sendJson(response, 200, {
          ok: true,
          enabled,
          vaultPath: explicit,
          effectiveVaultPath: effective,
          defaultVaultPath: defaultVaultPath(dataDir),
          isDefaultVault: !explicit && !env?.AC_MEMORY_VAULT,
        }, { requestId });
        return;
      }

      if (pathname === "/api/skills/status" && request.method === "GET") {
        sendJson(response, 200, await getSkillSyncStatus(), { requestId });
        return;
      }

      if (pathname === "/api/skills/sync" && request.method === "POST") {
        const body = await readJsonBody(request);
        const action = String(body?.action || "install").trim();
        const clients = Array.isArray(body?.clients) ? body.clients : undefined;
        const result = action === "uninstall"
          ? await uninstallSkill({ ...(clients ? { clients } : {}) })
          : await installSkill({ ...(clients ? { clients } : {}), force: Boolean(body?.force) });
        sendJson(response, 200, { ok: true, ...result }, { requestId });
        return;
      }
      const assistantCardAction = pathname.match(/^\/api\/assistant\/cards\/([^/]+)\/action$/);
      if (assistantCardAction && request.method === "POST") {
        sendJson(response, 200, await overviewService.assistant.cardAction(decodeURIComponent(assistantCardAction[1]), await readJsonBody(request)), { requestId });
        return;
      }

      if (pathname === "/api/assistant/models" && request.method === "GET") {
        sendJson(response, 200, await voiceService.listVoiceModelOptions(), { requestId });
        return;
      }

      if (pathname === "/api/assistant/action" && request.method === "POST") {
        sendJson(response, 200, await overviewService.assistant.executeProposedAction(await readJsonBody(request)), { requestId });
        return;
      }

      if (pathname === "/api/assistant/notices" && request.method === "GET") {
        const limit = Number(url.searchParams.get("limit") || 10);
        sendJson(response, 200, await overviewService.assistant.listUnreadNotices({ limit }), { requestId });
        return;
      }

      if (pathname === "/api/assistant/notices/ack" && request.method === "POST") {
        const body = await readJsonBody(request);
        sendJson(response, 200, await overviewService.assistant.ackNotices(body.ids), { requestId });
        return;
      }

      if (pathname === "/api/assistant/call/warm" && request.method === "POST") {
        const [warm, popped] = await Promise.all([
          voiceService.warmAssistantCall(),
          overviewService.assistant.popPendingVoiceNotices({ limit: 2 }).catch(() => ({ notices: [], remainingCount: 0 })),
        ]);
        sendJson(response, 200, {
          ...warm,
          notices: popped.notices || [],
          remainingNoticeCount: popped.remainingCount || 0,
        }, { requestId });
        return;
      }

      if (pathname === "/api/assistant/phone-log" && request.method === "POST") {
        const body = await readJsonBody(request);
        await spritePhoneArchive.logEvent({
          stage: "client",
          requestId,
          callId: String(body.callId || "").trim(),
          turnId: String(body.turnId || "").trim(),
          event: String(body.event || "state_change").trim(),
          fromPhase: String(body.fromPhase || "").trim(),
          toPhase: String(body.toPhase || "").trim(),
          detail: body.detail && typeof body.detail === "object" ? body.detail : String(body.detail || "").slice(0, 200),
        });
        sendJson(response, 200, { ok: true }, { requestId });
        return;
      }

      if (pathname === "/api/assistant/voice-turn" && request.method === "POST") {
        const body = await readJsonBody(request);
        const wantsNdjson = String(request.headers.accept || "").includes("application/x-ndjson");
        const audioBase64 = String(body.audioBase64 || "").trim();
        const callId = String(body.callId || "").trim();
        const turnId = String(body.turnId || "").trim() || `spturn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const turnStartedAt = Date.now();
        let heardText = String(body.transcriptText || "").trim();
        let asrResult = null;
        let ndjsonStarted = false;
        let ndjsonPing = null;
        const userAudioTask = audioBase64
          ? spritePhoneArchive.saveAudio({
              callId,
              turnId,
              role: "user",
              audioBase64,
              mimeType: body.audioMimeType || "audio/wav",
            })
          : Promise.resolve(null);
        const writeNdjson = (obj) => {
          if (response.destroyed || response.writableEnded) return false;
          response.write(`${JSON.stringify(obj)}\n`);
          return true;
        };
        const ensureNdjson = () => {
          if (!wantsNdjson || ndjsonStarted) return;
          ndjsonStarted = true;
          response.writeHead(200, {
            "Content-Type": "application/x-ndjson; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            ...(requestId ? { "X-Request-Id": requestId } : {}),
          });
          ndjsonPing = setInterval(() => {
            writeNdjson({ type: "ping" });
          }, 8000);
          ndjsonPing.unref?.();
        };

        try {
          if (wantsNdjson) ensureNdjson();
          if (audioBase64 && !heardText) {
            const asrStartedAt = Date.now();
            asrResult = await voiceService.transcribeAudio({
              audioBase64,
              audioMimeType: body.audioMimeType || "audio/wav",
              language: body.language || "zh",
              promptHints: await voiceService.getAsrPromptHints(),
              overlapMs: Number(body.overlapDurationMs) || 0,
            });
            const asrMs = Date.now() - asrStartedAt;
            const userAudioMeta = await userAudioTask;
            const isNoSpeech = Boolean(asrResult?.noSpeech || !String(asrResult?.text || "").trim());
            void spritePhoneArchive.logEvent({
              stage: "asr",
              event: "asr_done",
              requestId,
              callId,
              turnId,
              asrMs,
              noSpeech: isNoSpeech,
              silenceReason: asrResult?.silenceReason || (isNoSpeech ? "no_speech" : ""),
              localAudioFiltered: Boolean(asrResult?.localAudioFiltered),
              asrEngine: asrResult?.engine || "",
              heardText: String(asrResult?.text || "").trim().slice(0, 300),
              userAudioPath: userAudioMeta?.path || "",
              userAudioBytes: userAudioMeta?.bytes || 0,
            });
            if (isNoSpeech) {
              const noSpeechPayload = {
                ok: true,
                noSpeech: true,
                turnId,
                silenceReason: asrResult?.silenceReason || "no_speech",
                localAudioFiltered: Boolean(asrResult?.localAudioFiltered),
                asrEngine: asrResult?.engine || "",
                heardText: "",
              };
              if (wantsNdjson) {
                writeNdjson({ type: "no_speech", ...noSpeechPayload });
                response.end();
              } else {
                sendJson(response, 200, noSpeechPayload, { requestId });
              }
              return;
            }
            heardText = String(asrResult.text || "").trim();
          } else if (heardText) {
            void spritePhoneArchive.logEvent({
              stage: "asr",
              event: "transcript_input",
              requestId,
              callId,
              turnId,
              heardText: heardText.slice(0, 300),
            });
          }
          if (!heardText) {
            const emptyPayload = { ok: true, noSpeech: true, turnId, silenceReason: "empty_input", heardText: "" };
            if (wantsNdjson) {
              writeNdjson({ type: "no_speech", ...emptyPayload });
              response.end();
            } else {
              sendJson(response, 200, emptyPayload, { requestId });
            }
            return;
          }

          if (wantsNdjson) {
            writeNdjson({ type: "heard", turnId, heardText, asrEngine: asrResult?.engine || "" });
          }

          const wantTts = body.tts !== false;
          const llmStartedAt = Date.now();
          const overlapMs = Math.max(0, Math.round(Number(body.overlapDurationMs) || 0));
          const callKey = String(body.sessionId || callId || "").trim();
          const proposalId = String(body.proposalId || body.pendingProposal?.id || "").trim();
          const pendingEntry = proposalId
            ? overviewService.assistant.getPendingProposal(proposalId, { callKey })
            : null;
          const fastConfirmRe = /^(?:确认|确定|好|好的|好呀|好啊|行|行的|可以|执行|同意|批准|发吧|发|做吧|开工|派吧|对|对的|是的|是|嗯|嗯嗯|嗯对|没问题|没毛病|就这么办|yes|ok|okay|confirm)[!！。.,，~～]*$/i;
          const fastCancelRe = /^(?:取消|算了|不要|别|别发|别派|不用了|不用|放弃|不执行|停|cancel|no)[!！。.,，~～]*$/i;

          let prefetchedTts = null;
          let spokenReadyMs = 0;
          let firstTtsChunkMs = 0;
          let prefetchedTtsHit = false;
          let answer = null;

          if (pendingEntry && overlapMs === 0 && fastConfirmRe.test(heardText)) {
            let executedAction = null;
            let replyText = "";
            let mood = "good";
            try {
              executedAction = await overviewService.assistant.executeProposedAction({ proposalId: pendingEntry.id });
              replyText = `好的，${executedAction.summary || "已经执行"}。`;
            } catch (err) {
              executedAction = { ok: false, intent: pendingEntry.intent || "", error: err?.message || "执行失败" };
              replyText = `执行没有成功：${executedAction.error}`;
              mood = "worry";
            }
            answer = { kind: "answer", text: replyText, spokenReply: replyText, executedAction, clearedProposal: true, usedModel: true, sources: [], actions: [], mood };
          } else if (pendingEntry && overlapMs === 0 && fastCancelRe.test(heardText)) {
            overviewService.assistant.cancelProposal(pendingEntry.id);
            const replyText = "好的，已经取消，不执行刚才的操作。";
            answer = { kind: "answer", text: replyText, spokenReply: replyText, clearedProposal: true, usedModel: true, sources: [], actions: [], mood: "idle" };
          } else if (proposalId && !pendingEntry && overlapMs === 0 && fastConfirmRe.test(heardText)) {
            const replyText = "刚才那个待确认操作已经过期或已经执行过了，需要的话请重新告诉我。";
            answer = { kind: "answer", text: replyText, spokenReply: replyText, clearedProposal: true, usedModel: true, sources: [], actions: [], mood: "idle" };
          } else if (proposalId && !pendingEntry && overlapMs === 0 && fastCancelRe.test(heardText)) {
            const replyText = "好的，已经取消。";
            answer = { kind: "answer", text: replyText, spokenReply: replyText, clearedProposal: true, usedModel: true, sources: [], actions: [], mood: "idle" };
          } else {
            const speechTiming = (overlapMs > 0 || asrResult?.duringPlaybackText)
              ? {
                  overlapDurationMs: overlapMs,
                  overlapBotText: String(body.overlapBotText || "").trim(),
                  duringPlaybackText: String(asrResult?.duringPlaybackText || "").trim() || (overlapMs > 0 ? heardText : ""),
                  afterPlaybackText: String(asrResult?.afterPlaybackText || "").trim(),
                }
              : null;
            const onSpokenReply = (wantsNdjson && wantTts)
              ? (earlyText) => {
                  const cleanEarly = String(earlyText || "").trim();
                  if (!cleanEarly || prefetchedTts) return;
                  spokenReadyMs = Date.now() - llmStartedAt;
                  const segments = splitSpeechSegments(cleanEarly);
                  if (!segments.length) return;
                  const tasks = segments.map((seg) =>
                    voiceService.synthesizeSpeech({ text: seg, callId, source: "turn", register: false })
                      .catch(() => ({ audioBase64: "", mimeType: "", provider: "none", text: seg, expectedMs: 0 })),
                  );
                  prefetchedTts = { text: cleanEarly, segments, tasks };
                }
              : null;
            answer = await overviewService.assistant.ask({
              text: heardText,
              history: body.history,
              focus: body.focus,
              contextTopicId: body.contextTopicId,
              mode: "phone",
              modelKey: body.modelKey || "auto",
              sessionId: body.sessionId || callId,
              callId,
              proposalId: pendingEntry?.id || "",
              autoExecute: Boolean(body.autoExecute),
              ...(speechTiming ? { speechTiming } : {}),
            }, { onSpokenReply });
          }

          if (answer && !answer.proposal) {
            const poppedNotices = await overviewService.assistant.popPendingVoiceNotices({ limit: 1 }).catch(() => ({ notices: [], remainingCount: 0 }));
            if (poppedNotices.notices.length) {
              answer.notices = poppedNotices.notices;
              const noticePhrase = `顺便说一下，${poppedNotices.notices[0].text}。`;
              const baseSpoken = String(answer.spokenReply || answer.text || "").trim();
              answer.spokenReply = baseSpoken ? `${baseSpoken} ${noticePhrase}` : noticePhrase;
            }
          }

          const llmMs = Date.now() - llmStartedAt;
          const spokenText = String(answer?.spokenReply || answer?.text || "").trim();
          void spritePhoneArchive.logEvent({
            stage: "llm",
            event: "llm_done",
            requestId,
            callId,
            turnId,
            llmMs,
            ...(spokenReadyMs > 0 ? { spokenReadyMs } : {}),
            modelKey: body.modelKey || "auto",
            usedModel: Boolean(answer?.usedModel),
            mood: answer?.mood || "",
            hasProposal: Boolean(answer?.proposal),
            executedAction: answer?.executedAction?.intent || "",
            replyLen: String(answer?.text || "").length,
            spokenLen: spokenText.length,
          });
          if (response.destroyed || response.writableEnded || Boolean(response.socket?.destroyed)) {
            void spritePhoneArchive.logEvent({
              stage: "tts",
              event: "client_disconnected",
              requestId,
              callId,
              turnId,
              totalTurnMs: Date.now() - turnStartedAt,
            });
            return;
          }

          if (wantsNdjson) {
            writeNdjson({ type: "answer", turnId, heardText, asrEngine: asrResult?.engine || "", answer });
            if (wantTts && spokenText && !response.destroyed) {
              const ttsStartedAt = Date.now();
              const usePrefetch = Boolean(prefetchedTts && prefetchedTts.text === spokenText);
              prefetchedTtsHit = usePrefetch;
              const segments = usePrefetch ? prefetchedTts.segments : splitSpeechSegments(spokenText);
              const total = segments.length;
              const synthTasks = usePrefetch
                ? prefetchedTts.tasks
                : segments.map((seg) =>
                    voiceService.synthesizeSpeech({ text: seg, callId, source: "turn", register: false })
                      .catch(() => ({ audioBase64: "", mimeType: "", provider: "none", text: seg, expectedMs: 0 })),
                  );
              const aiAudioPaths = [];
              let totalTtsBytes = 0;
              let lastProvider = "none";
              for (let i = 0; i < total; i += 1) {
                if (response.destroyed || response.writableEnded) break;
                const chunkTts = await synthTasks[i];
                if (chunkTts?.provider) lastProvider = chunkTts.provider;
                if (chunkTts?.audioBase64) {
                  const savedAi = await spritePhoneArchive.saveAudio({
                    callId,
                    turnId,
                    role: "ai",
                    index: i,
                    audioBase64: chunkTts.audioBase64,
                    mimeType: chunkTts.mimeType || "audio/mp3",
                  });
                  if (savedAi) {
                    aiAudioPaths.push(savedAi.path);
                    totalTtsBytes += savedAi.bytes;
                  }
                }
                if (!firstTtsChunkMs) firstTtsChunkMs = Date.now() - turnStartedAt;
                writeNdjson({ type: "tts_chunk", index: i, total, text: segments[i], tts: chunkTts });
              }
              void spritePhoneArchive.logEvent({
                stage: "tts",
                event: "tts_done",
                requestId,
                callId,
                turnId,
                ttsMs: Date.now() - ttsStartedAt,
                totalTurnMs: Date.now() - turnStartedAt,
                ...(spokenReadyMs > 0 ? { spokenReadyMs } : {}),
                ...(firstTtsChunkMs > 0 ? { firstTtsChunkMs } : {}),
                prefetchedTtsHit,
                provider: lastProvider,
                segments: total,
                aiAudioPaths,
                totalBytes: totalTtsBytes,
              });
            }
            writeNdjson({ type: "done", turnId });
            response.end();
            return;
          }

          const ttsStartedAt = Date.now();
          const tts = wantTts && spokenText
            ? await voiceService.synthesizeSpeech({ text: spokenText, callId, source: "turn", register: false }).catch(() => ({ audioBase64: "", mimeType: "", provider: "none", text: spokenText, expectedMs: 0 }))
            : { audioBase64: "", mimeType: "", provider: "none", text: spokenText, expectedMs: 0 };
          const savedAi = tts?.audioBase64
            ? await spritePhoneArchive.saveAudio({
                callId,
                turnId,
                role: "ai",
                index: 0,
                audioBase64: tts.audioBase64,
                mimeType: tts.mimeType || "audio/mp3",
              })
            : null;
          if (wantTts && spokenText) {
            void spritePhoneArchive.logEvent({
              stage: "tts",
              event: "tts_done",
              requestId,
              callId,
              turnId,
              ttsMs: Date.now() - ttsStartedAt,
              totalTurnMs: Date.now() - turnStartedAt,
              provider: tts?.provider || "none",
              segments: 1,
              aiAudioPaths: savedAi ? [savedAi.path] : [],
              totalBytes: savedAi?.bytes || 0,
            });
          }
          sendJson(response, 200, {
            ok: true,
            noSpeech: false,
            turnId,
            heardText,
            asrEngine: asrResult?.engine || "",
            answer,
            tts,
          }, { requestId });
          return;
        } catch (err) {
          void spritePhoneArchive.logEvent({
            stage: "error",
            event: "turn_error",
            requestId,
            callId,
            turnId,
            totalTurnMs: Date.now() - turnStartedAt,
            message: err?.message || "语音通话请求失败",
          });
          if (wantsNdjson && ndjsonStarted) {
            writeNdjson({ type: "error", message: err?.message || "语音通话请求失败" });
            response.end();
            return;
          }
          throw err;
        } finally {
          if (ndjsonPing) clearInterval(ndjsonPing);
        }
      }

      if (pathname === "/api/overview/refresh" && request.method === "POST") {
        const body = await readJsonBody(request);
        await overviewService.triggerRefresh({
          force: true,
          preferredModel: body.preferredModel || "",
          cooldownMinutes: Number(body.cooldownMinutes) || 0,
        });
        const result = await overviewService.getOverview({ trigger: "view", force: false });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/overview/assign" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.assignThreadTopic(
          body.threadId || "",
          body.topicId || "",
          body.stageTag || "",
        );
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/overview/topic" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.upsertTopic(body);
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/overview/sync" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.syncProjects({
          clearExisting: Boolean(body.clearExisting),
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/overview/spark" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.handleSparkAction(body);
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/overview/focus" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.toggleBossFocus(body.topicId || "");
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/overview/metrics" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.upsertTopicMetrics(body);
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/overview/dispatch-prefs" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.updateDispatchPrefs({
          strategy: body.strategy || "",
          providerOrder: Array.isArray(body.providerOrder) ? body.providerOrder : null,
          excludedAgentKeys: Array.isArray(body.excludedAgentKeys) ? body.excludedAgentKeys : null,
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/overview/dispatch" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.dispatchTask({
          text: body.text || "",
          topicId: body.topicId || "",
          cwdOverride: body.cwdOverride || "",
          mode: body.mode || "auto",
          preferredProvider: body.preferredProvider || "auto",
          agentKey: body.agentKey || "auto",
          model: body.model || "",
          effort: body.effort || "",
          priorityStrategy: body.priorityStrategy || "",
          providerOrder: Array.isArray(body.providerOrder) ? body.providerOrder : null,
          excludedAgentKeys: Array.isArray(body.excludedAgentKeys) ? body.excludedAgentKeys : null,
          remember: body.remember !== false,
          confirmOnly: Boolean(body.confirmOnly),
          sparkId: body.sparkId || "",
          inheritContext: body.inheritContext !== false,
          useAiPlanner: Boolean(body.useAiPlanner),
          approvedRoutes: Array.isArray(body.approvedRoutes) ? body.approvedRoutes : null,
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/overview/archive-digest" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.archiveAndSummarizeTopic({
          topicId: body.topicId || "",
          staleDays: body.staleDays ?? 3,
          confirmOnly: Boolean(body.confirmOnly),
          threadIds: Array.isArray(body.threadIds) ? body.threadIds : null,
          preferredModel: body.preferredModel || "auto",
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/overview/context" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.upsertTopicArchiveContext({
          topicId: body.topicId || "",
          summary: body.summary || "",
          clear: Boolean(body.clear),
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/overview/reorganize" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.planAndApplyBlueprintEdit({
          instruction: body.instruction || "",
          confirmOnly: body.confirmOnly !== false,
          operations: Array.isArray(body.operations) ? body.operations : null,
          preferredModel: body.preferredModel || "auto",
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/profile/probe" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await hub.probeProfiles({
          provider: body.provider || "",
          profileId: body.profileId || "",
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/profile/meta" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await hub.updateProfileMeta({
          provider: body.provider || "",
          profileId: body.profileId || "",
          ...(Object.hasOwn(body, "disabled") ? { disabled: Boolean(body.disabled) } : {}),
          ...(Object.hasOwn(body, "alias") ? { alias: body.alias } : {}),
          ...(Object.hasOwn(body, "codexExecMode") ? { codexExecMode: Boolean(body.codexExecMode) } : {}),
          ...(Object.hasOwn(body, "codexExecSuggested") ? { codexExecSuggested: Boolean(body.codexExecSuggested) } : {}),
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/profile/create" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await hub.createProfile({
          provider: body.provider || "",
          name: body.name || "",
          customHome: body.customHome || "",
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/profile/delete" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await hub.deleteProfile({
          provider: body.provider || "",
          profileId: body.profileId || "",
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/profile/login" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await hub.startProfileLogin({
          provider: body.provider || "",
          profileId: body.profileId || "",
          mode: body.mode || "",
          openOnHost: body.openOnHost !== false,
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/thread" && request.method === "GET") {
        const threadId = url.searchParams.get("id") || "";
        context.threadId = threadId;
        const cursor = url.searchParams.get("cursor") || null;
        const detail = url.searchParams.get("detail") || "auto";
        const limit = Number(url.searchParams.get("limit") || 20);
        const result = await hub.readThread(threadId, { cursor, detail, limit });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/thread/image" && (request.method === "GET" || request.method === "HEAD")) {
        const threadId = url.searchParams.get("threadId") || "";
        const rawPath = url.searchParams.get("path") || "";
        const maxDimParam = url.searchParams.get("w");
        const qualityParam = url.searchParams.get("q");
        const rawMode = url.searchParams.get("raw") === "1" || url.searchParams.get("raw") === "true";
        context.threadId = threadId;
        let resolved;
        try {
          resolved = await hub.resolveThreadImageFile(threadId, rawPath);
        } catch (err) {
          if (Number(err?.status) === 404) {
            const payloadBuf = Buffer.from(JSON.stringify({
              error: {
                code: err?.code || null,
                message: err?.message || "图片文件不存在",
              },
            }), "utf8");
            response.writeHead(404, {
              "Cache-Control": "private, max-age=60",
              "Content-Type": "application/json; charset=utf-8",
              "Content-Length": String(payloadBuf.length),
              "X-Content-Type-Options": "nosniff",
              ...(requestId ? { "X-Request-Id": requestId } : {}),
            });
            response.end(request.method === "HEAD" ? undefined : payloadBuf);
            return;
          }
          throw err;
        }
        const out = await getCompressedImagePreview(resolved.filePath, {
          size: resolved.size,
          mtimeMs: resolved.mtimeMs,
          mimeType: resolved.mimeType,
          maxDim: maxDimParam ? Number(maxDimParam) : 1280,
          quality: qualityParam ? Number(qualityParam) : 74,
          raw: rawMode,
        });
        const etag = `W/"${out.size}-${Math.trunc(out.mtimeMs)}-${out.compressed ? 1 : 0}"`;
        const commonHeaders = {
          "Cache-Control": "private, max-age=600, stale-while-revalidate=3600",
          ETag: etag,
          "X-Original-Bytes": String(out.originalSize || resolved.size),
          "X-Compressed": out.compressed ? "1" : "0",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; img-src 'self'",
        };
        if (matchesIfNoneMatch(request?.headers?.["if-none-match"], etag)) {
          response.writeHead(304, commonHeaders);
          response.end();
          return;
        }
        const content = await readFile(out.filePath);
        response.writeHead(200, {
          ...commonHeaders,
          "Content-Type": out.mimeType,
          "Content-Length": String(content.length),
        });
        response.end(request.method === "HEAD" ? undefined : content);
        return;
      }

      if (pathname === "/api/thread/file" && (request.method === "GET" || request.method === "HEAD")) {
        const threadId = url.searchParams.get("threadId") || "";
        const rawPath = url.searchParams.get("path") || "";
        const mode = url.searchParams.get("mode") || "meta";
        const download = url.searchParams.get("download") === "1" || url.searchParams.get("download") === "true";
        context.threadId = threadId;
        const resolved = await hub.resolveThreadOutputFile(threadId, rawPath);
        if (mode !== "raw") {
          const meta = await readPreviewableFileMeta(resolved.filePath, { size: resolved.size });
          sendJson(response, 200, {
            ...meta,
            threadId,
            displayPath: resolved.displayPath,
            startLine: resolved.startLine,
            endLine: resolved.endLine,
            mtimeMs: resolved.mtimeMs,
          }, { requestId });
          return;
        }

        const mime = resolved.mimeType || lookupFileMimeType(resolved.filePath);
        const isActiveDocMime = /^(?:text\/html|application\/xhtml\+xml|image\/svg\+xml|application\/xml|text\/xml|application\/javascript)/i.test(mime);
        const totalSize = resolved.size;
        const etag = `W/"${totalSize}-${Math.trunc(resolved.mtimeMs)}"`;
        const securityHeaders = {
          "Content-Type": mime,
          "Cache-Control": "private, max-age=120",
          "Accept-Ranges": "bytes",
          ETag: etag,
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": isActiveDocMime
            ? "sandbox; default-src 'none'"
            : "default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
          ...(download ? { "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(resolved.name)}` } : {}),
        };

        const rangeHeader = String(request.headers?.range || "").trim();
        if (!rangeHeader && matchesIfNoneMatch(request?.headers?.["if-none-match"], etag)) {
          response.writeHead(304, securityHeaders);
          response.end();
          return;
        }

        let start = 0;
        let end = Math.max(0, totalSize - 1);
        let statusCode = 200;
        if (rangeHeader && totalSize > 0) {
          const rangeMatch = rangeHeader.match(/^bytes=(\d*)-(\d*)$/i);
          if (!rangeMatch || (rangeMatch[1] === "" && rangeMatch[2] === "")) {
            response.writeHead(416, { "Content-Range": `bytes */${totalSize}`, "X-Content-Type-Options": "nosniff" });
            response.end();
            return;
          }
          if (rangeMatch[1] === "") {
            const suffixLen = Math.max(0, Number(rangeMatch[2]) || 0);
            start = Math.max(0, totalSize - suffixLen);
            end = totalSize - 1;
          } else {
            start = Number(rangeMatch[1]);
            end = rangeMatch[2] !== "" ? Math.min(totalSize - 1, Number(rangeMatch[2])) : totalSize - 1;
          }
          if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= totalSize || end < start) {
            response.writeHead(416, { "Content-Range": `bytes */${totalSize}`, "X-Content-Type-Options": "nosniff" });
            response.end();
            return;
          }
          statusCode = 206;
          securityHeaders["Content-Range"] = `bytes ${start}-${end}/${totalSize}`;
        }

        const contentLen = totalSize === 0 ? 0 : (end - start + 1);
        securityHeaders["Content-Length"] = String(contentLen);
        response.writeHead(statusCode, securityHeaders);
        if (request.method === "HEAD" || contentLen === 0) {
          response.end();
          return;
        }
        await new Promise((resolveStream, rejectStream) => {
          const rs = createReadStream(resolved.filePath, { start, end });
          const onClose = () => {
            rs.destroy();
            resolveStream();
          };
          request.once("close", onClose);
          rs.on("error", (err) => {
            request.off("close", onClose);
            rejectStream(err);
          });
          rs.on("end", () => {
            request.off("close", onClose);
            resolveStream();
          });
          rs.pipe(response);
        });
        return;
      }

      if (pathname === "/api/thread/reveal" && request.method === "POST") {
        if (!canManageRemote) {
          sendJson(response, 403, { error: { code: "LOCAL_ONLY", message: "仅支持在本机控制台打开访达" } }, { requestId });
          return;
        }
        const body = await readJsonBody(request);
        const threadId = String(body?.threadId || "").trim();
        const rawPath = String(body?.path || "").trim();
        context.threadId = threadId;
        const resolved = await hub.resolveThreadOutputFile(threadId, rawPath);
        if (revealFileImpl) {
          await revealFileImpl(resolved.filePath);
        } else if (process.platform === "darwin") {
          await execFileCrossPlatform("open", ["-R", resolved.filePath], { timeout: 5000 });
        } else if (process.platform === "win32") {
          await execFileCrossPlatform("explorer.exe", [`/select,${resolved.filePath}`], { timeout: 5000 }).catch((err) => {
            if (Number(err?.code) !== 1) throw err;
          });
        } else {
          await execFileCrossPlatform("xdg-open", [dirname(resolved.filePath)], { timeout: 5000 });
        }
        sendJson(response, 200, { ok: true, path: resolved.filePath }, { requestId });
        return;
      }

      if (pathname === "/api/fs/pick-directory" && request.method === "POST") {
        if (!canManageRemote) {
          sendJson(response, 403, { error: { code: "LOCAL_ONLY", message: "仅支持在本机控制台选择文件夹" } }, { requestId });
          return;
        }
        const body = await readJsonBody(request).catch(() => ({}));
        const initialDir = String(body?.initialDir || "").trim();
        const picked = pickDirectoryImpl
          ? await pickDirectoryImpl({ initialDir })
          : await pickNativeDirectory({ initialDir, env });
        const rawPath = typeof picked === "string" ? picked : String(picked?.path || "");
        const cleanPath = rawPath.trim() ? normalizeWorkspacePath(rawPath) : "";
        const canceled = typeof picked === "object" && picked !== null && "canceled" in picked
          ? Boolean(picked.canceled || !cleanPath)
          : !cleanPath;
        sendJson(response, 200, { ok: true, canceled, path: cleanPath }, { requestId });
        return;
      }

      if (pathname === "/api/thread/activity" && request.method === "GET") {
        const threadId = url.searchParams.get("id") || "";
        context.threadId = threadId;
        const cursor = url.searchParams.get("cursor") || null;
        const result = await hub.getActivity(threadId, { cursor });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/thread/new" && request.method === "POST") {
        const body = await readJsonBody(request);
        const text = String(body.text ?? body.prompt ?? "");
        const rawCwd = String(body.cwd || "").trim();
        const expandedCwd = rawCwd ? expandHomePath(rawCwd, env) : "";
        const result = await hub.startThread({
          provider: body.provider || "codex",
          profileId: body.profileId || "default",
          cwd: expandedCwd,
          text,
          images: Array.isArray(body.images) ? body.images : [],
          model: body.model || "",
          effort: body.effort || "",
          permissionMode: body.permissionMode || "workspace",
          runMode: body.runMode || "normal",
          goalMode: Boolean(body.goalMode),
          ...(body.taskId ? { taskId: String(body.taskId) } : {}),
          ...(body.parentTaskId ? { parentTaskId: String(body.parentTaskId) } : {}),
          ...(body.sourceThreadId ? { sourceThreadId: String(body.sourceThreadId) } : {}),
          ...(body.taskTitle ? { taskTitle: String(body.taskTitle) } : {}),
          ...(body.taskMode ? { taskMode: String(body.taskMode) } : {}),
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/thread/prefs" && request.method === "POST") {
        const body = await readJsonBody(request);
        context.threadId = body.threadId || "";
        const result = await hub.updateThreadPrefs(body.threadId, {
          model: body.model || "",
          effort: typeof body.effort === "string" ? body.effort : "",
          permissionMode: body.permissionMode || "",
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/turn" && request.method === "POST") {
        const body = await readJsonBody(request);
        context.threadId = body.threadId || "";
        const text = String(body.text ?? body.prompt ?? "");
        const result = await hub.sendTurn({
          threadId: body.threadId,
          cwd: body.cwd || "",
          text,
          images: Array.isArray(body.images) ? body.images : [],
          model: body.model || "",
          effort: body.effort || "",
          permissionMode: body.permissionMode || "",
          steer: Boolean(body.steer),
          expectedTurnId: body.expectedTurnId || "",
          runMode: body.runMode || "normal",
          goalMode: Boolean(body.goalMode),
          writerConflictPolicy: body.writerConflictPolicy || "reject",
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/thread/queue" && request.method === "GET") {
        const threadId = url.searchParams.get("id") || "";
        context.threadId = threadId;
        sendJson(response, 200, {
          threadId,
          items: await hub.listQueuedTurns(threadId),
        }, { requestId });
        return;
      }

      if (pathname === "/api/thread/queue/entry" && request.method === "GET") {
        const threadId = url.searchParams.get("threadId") || "";
        const entryId = url.searchParams.get("id") || "";
        context.threadId = threadId;
        const result = await hub.getQueuedTurnEntry(threadId, entryId);
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/thread/queue" && request.method === "POST") {
        const body = await readJsonBody(request);
        context.threadId = body.threadId || "";
        const result = await hub.queueTurn({
          threadId: body.threadId,
          text: String(body.text ?? body.prompt ?? ""),
          images: Array.isArray(body.images) ? body.images : [],
          model: body.model || "",
          effort: body.effort || "",
          permissionMode: body.permissionMode || "workspace",
          goalMode: Boolean(body.goalMode),
          preferNative: Boolean(body.preferNative),
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/thread/queue/update" && request.method === "POST") {
        const body = await readJsonBody(request);
        context.threadId = body.threadId || "";
        const result = await hub.updateQueuedTurn(body.threadId, body.id, {
          ...(Object.hasOwn(body, "text") || Object.hasOwn(body, "prompt")
            ? { text: String(body.text ?? body.prompt ?? "") }
            : {}),
          ...(Object.hasOwn(body, "images") ? { images: Array.isArray(body.images) ? body.images : [] } : {}),
          ...(Object.hasOwn(body, "model") ? { model: body.model || "" } : {}),
          ...(Object.hasOwn(body, "effort") ? { effort: body.effort || "" } : {}),
          ...(Object.hasOwn(body, "permissionMode") ? { permissionMode: body.permissionMode || "workspace" } : {}),
          ...(Object.hasOwn(body, "goalMode") ? { goalMode: Boolean(body.goalMode) } : {}),
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/thread/queue/cancel" && request.method === "POST") {
        const body = await readJsonBody(request);
        context.threadId = body.threadId || "";
        const result = await hub.cancelQueuedTurn(body.threadId, body.id);
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/thread/queue/steer" && request.method === "POST") {
        const body = await readJsonBody(request);
        context.threadId = body.threadId || "";
        const result = await hub.steerQueuedTurn(body.threadId, body.id, {
          expectedTurnId: body.expectedTurnId || "",
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/thread/goal" && request.method === "POST") {
        const body = await readJsonBody(request);
        context.threadId = body.threadId || "";
        const result = await hub.setGoalMode(body.threadId, {
          enabled: body.enabled !== false,
          maxTurns: body.maxTurns,
          model: body.model || "",
          effort: body.effort || "",
          permissionMode: body.permissionMode || "workspace",
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/interrupt" && request.method === "POST") {
        const body = await readJsonBody(request);
        context.threadId = body.threadId || "";
        const result = await hub.interrupt({
          threadId: body.threadId,
          turnId: body.turnId || "",
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/settings" && request.method === "GET") {
        sendJson(response, 200, { settings: hub.getSettings() }, { requestId });
        return;
      }

      if (pathname === "/api/settings" && request.method === "POST") {
        const body = await readJsonBody(request);
        const settings = await hub.setSettings(body || {});
        sendJson(response, 200, { ok: true, settings }, { requestId });
        return;
      }

      if (pathname === "/api/thread/name" && request.method === "POST") {
        const body = await readJsonBody(request);
        const rawSource = String(body.source || "user").trim().toLowerCase();
        const source = rawSource === "agent" || rawSource === "domain" ? rawSource : "user";
        const action = String(body.action || "set").trim().toLowerCase() === "append" ? "append" : "set";
        if (source === "agent" && hub.getSettings().agentAutoTitle === false) {
          sendJson(response, 200, { ok: true, skipped: true, reason: "agent_auto_title_disabled" }, { requestId });
          return;
        }
        let threadId = String(body.threadId || "").trim();
        const rawId = String(body.rawId || "").trim();
        if (!threadId || !threadId.includes(":")) {
          threadId = await hub.resolveCompositeThreadId({
            rawId: rawId || threadId,
            provider: body.provider || "",
            cwd: body.cwd || "",
          });
        }
        context.threadId = threadId;
        const result = await hub.renameThread(threadId, body.name, {
          source,
          action,
          suffix: body.suffix || "",
          lock: Boolean(body.lock),
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (["/api/thread/fork", "/api/thread/continue"].includes(pathname) && request.method === "POST") {
        const body = await readJsonBody(request);
        context.threadId = body.threadId || "";
        const result = await hub.forkThread({
          threadId: body.threadId,
          targetProvider: body.targetProvider || "",
          targetProfileId: body.targetProfileId || "",
          model: body.model || "",
          effort: body.effort || "",
          ...(body.upToTurnIndex !== undefined && body.upToTurnIndex !== null ? { upToTurnIndex: Number(body.upToTurnIndex) } : {}),
          ...(body.upToTurnId ? { upToTurnId: String(body.upToTurnId) } : {}),
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/thread/pin" && request.method === "POST") {
        const body = await readJsonBody(request);
        context.threadId = body.threadId || "";
        const result = await hub.pinThread(body.threadId, body.pinned !== false);
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/thread/archive" && request.method === "POST") {
        const body = await readJsonBody(request);
        context.threadId = body.threadId || "";
        const result = await hub.archiveThread(body.threadId, body.archived !== false);
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/thread/unarchive" && request.method === "POST") {
        const body = await readJsonBody(request);
        context.threadId = body.threadId || "";
        const result = await hub.archiveThread(body.threadId, false);
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/threads/archive" && request.method === "POST") {
        const body = await readJsonBody(request);
        const threadIds = Array.isArray(body.threadIds)
          ? body.threadIds
          : (body.threadId ? [body.threadId] : []);
        const result = await hub.archiveThreads(threadIds, body.archived !== false);
        sendJson(response, 200, result, { requestId });
        return;
      }

      if ((pathname === "/api/approval" || pathname === "/api/server-request") && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await hub.respondToRequest(body.requestId, body);
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/voice/call/models" && request.method === "GET") {
        const result = await voiceService.listVoiceModelOptions();
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/voice/call/start" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await voiceService.startCall({
          callId: body.callId || "",
          callScope: body.callScope || "",
          activeThreadId: body.activeThreadId || "",
          voiceProvider: body.voiceProvider || "",
          voiceModel: body.voiceModel || "",
          voiceProfileId: body.voiceProfileId || "",
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/voice/call" && request.method === "POST") {
        const body = await readJsonBody(request);
        const mode = String(body.mode || "turn").trim();
        const hasInput = Boolean(body.audioBase64 || String(body.transcriptText || "").trim() || mode === "briefing");
        if (!hasInput) {
          sendJson(response, 400, { error: { message: "未收到语音音频或文本指令" } }, { requestId });
          return;
        }
        const result = await voiceService.handleTurn({
          callId: body.callId || "",
          callScope: body.callScope || "",
          audioBase64: body.audioBase64 || "",
          audioMimeType: body.audioMimeType || "audio/wav",
          transcriptText: body.transcriptText || "",
          activeThreadId: body.activeThreadId || "",
          voiceProvider: body.voiceProvider || "",
          voiceModel: body.voiceModel || "",
          voiceProfileId: body.voiceProfileId || "",
          mode,
          autoExecute: body.autoExecute !== false,
          asyncDispatch: Boolean(body.asyncDispatch),
          tts: body.tts !== false,
          overlapDurationMs: Number(body.overlapDurationMs) || 0,
          overlapBotText: body.overlapBotText || "",
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/voice/call/end" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = voiceService.endCall({ callId: body.callId || "" });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/voice/call/ack" && request.method === "POST") {
        const body = await readJsonBody(request);
        if (!String(body.callId || "").trim() && !String(body.utteranceId || "").trim()) {
          sendJson(response, 400, { error: { message: "缺少通话 ID 或播报 ID" } }, { requestId });
          return;
        }
        const result = voiceService.recordPlaybackFeedback({
          callId: body.callId || "",
          utteranceId: body.utteranceId || "",
          status: body.status || "",
          reason: body.reason || "",
          provider: body.provider || "",
          playedMs: Number(body.playedMs) || 0,
          expectedMs: Number(body.expectedMs) || 0,
          spokenText: body.spokenText || body.text || "",
          source: body.source || "notice",
          priority: body.priority || "normal",
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/voice/call/status" && request.method === "GET") {
        const callId = url.searchParams.get("callId") || "";
        const result = voiceService.getCallDeliveryStatus({ callId });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/voice/tts" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await voiceService.synthesizeSpeech({
          text: body.text || "",
          voice: body.voice || undefined,
          callId: body.callId || "",
          utteranceId: body.utteranceId || "",
          source: body.source || "notice",
          priority: body.priority || "normal",
          preferOffline: Boolean(body.preferOffline),
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/voice/transcribe" && request.method === "POST") {
        const body = await readJsonBody(request);
        const audioBase64 = String(body.audioBase64 || "").trim();
        if (!audioBase64) {
          sendJson(response, 400, { error: { message: "未收到音频数据" } }, { requestId });
          return;
        }
        const result = await voiceService.transcribeAudio({
          audioBase64,
          audioMimeType: body.audioMimeType || "audio/wav",
          language: body.language || "zh",
          promptHints: await voiceService.getAsrPromptHints(),
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/events" && request.method === "GET") {
        let clientClosed = false;
        request.on("close", () => {
          clientClosed = true;
          sseClients.delete(response);
        });
        response.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-store",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
          "X-Content-Type-Options": "nosniff",
        });
        const remoteSnap = bridge.statusSnapshot();
        const initial = {
          instanceId: identity.instanceId,
          label: identity.label,
          pendingRequests: hub.allPendingRequests(),
          pendingHumanVerifications: humanVerify.listPending(),
          queuedTurns: hub.allQueuedTurns(),
          telemetry: await hub.getTelemetry().catch(() => null),
          remote: canManageRemote ? remoteSnap : { ...remoteSnap, pairUrl: "" },
          tunnel: quickTunnel.statusSnapshot({ includeSecrets: canManageRemote }),
          lan: getLanStatusSnapshot(),
          update: updateService.statusSnapshot(),
        };
        if (clientClosed || response.writableEnded) return;
        response.write(`retry: 2000\n\nevent: ready\ndata: ${JSON.stringify(initial)}\n\n`);
        sseClients.add(response);
        return;
      }

      if (pathname === "/api/tunnel" && request.method === "GET") {
        const status = await quickTunnel.status({
          includeQr: canManageRemote,
          includeSecrets: canManageRemote,
        });
        sendJson(response, 200, { ...status, canManage: canManageRemote }, { requestId });
        return;
      }

      if (pathname === "/api/tunnel/start" && request.method === "POST") {
        if (!canManageRemote) {
          sendJson(response, 403, { error: { code: "forbidden", message: "仅限在本机控制台开启或管理隧道" } }, { requestId });
          return;
        }
        await readJsonBody(request);
        const status = await quickTunnel.start();
        sendJson(response, 200, { ...status, canManage: true }, { requestId });
        return;
      }

      if (pathname === "/api/tunnel/stop" && request.method === "POST") {
        if (!canManageRemote) {
          sendJson(response, 403, { error: { code: "forbidden", message: "仅限在本机控制台开启或管理隧道" } }, { requestId });
          return;
        }
        await readJsonBody(request);
        const status = await quickTunnel.stop();
        sendJson(response, 200, { ...status, canManage: true }, { requestId });
        return;
      }

      if (pathname === "/api/tunnel/rotate" && request.method === "POST") {
        if (!canManageRemote) {
          sendJson(response, 403, { error: { code: "forbidden", message: "仅限在本机控制台开启或管理隧道" } }, { requestId });
          return;
        }
        await readJsonBody(request);
        const status = await quickTunnel.rotate();
        const fixedTunnel = await tailscaleFunnel.status({ includeQr: true, includeSecrets: true });
        sendJson(response, 200, { ...status, fixedTunnel, canManage: true }, { requestId });
        return;
      }

      if (pathname === "/api/tunnel/fixed-pair" && request.method === "POST") {
        if (!canManageRemote) {
          sendJson(response, 403, { error: { code: "forbidden", message: "仅限在本机控制台配置固定链接配对" } }, { requestId });
          return;
        }
        const body = await readJsonBody(request);
        await tunnelAuth.setFixedPublicUrl(body.publicUrl || "");
        const fixedTunnel = await tailscaleFunnel.status({ includeQr: true, includeSecrets: true });
        sendJson(response, 200, { ...fixedTunnel, canManage: true }, { requestId });
        return;
      }

      if (pathname === "/api/tunnel/tailscale/start" && request.method === "POST") {
        if (!canManageRemote) {
          sendJson(response, 403, { error: { code: "forbidden", message: "仅限在本机控制台开启或管理隧道" } }, { requestId });
          return;
        }
        await readJsonBody(request);
        const fixedTunnel = await tailscaleFunnel.start();
        sendJson(response, 200, { ...fixedTunnel, canManage: true }, { requestId });
        return;
      }

      if (pathname === "/api/tunnel/tailscale/stop" && request.method === "POST") {
        if (!canManageRemote) {
          sendJson(response, 403, { error: { code: "forbidden", message: "仅限在本机控制台开启或管理隧道" } }, { requestId });
          return;
        }
        await readJsonBody(request);
        const fixedTunnel = await tailscaleFunnel.stop();
        sendJson(response, 200, { ...fixedTunnel, canManage: true }, { requestId });
        return;
      }

      if (pathname === "/api/remote" && request.method === "GET") {
        const status = await bridge.status({ includeQr: canManageRemote });
        if (!canManageRemote) {
          status.pairUrl = "";
          delete status.qrDataUrl;
        }
        const [tunnel, fixedTunnel] = await Promise.all([
          quickTunnel.status({
            includeQr: canManageRemote,
            includeSecrets: canManageRemote,
          }),
          canManageRemote
            ? tailscaleFunnel.status({ includeQr: true, includeSecrets: true })
            : Promise.resolve({ fixedPublicUrl: "", pairUrl: "" }),
        ]);
        sendJson(response, 200, {
          ...status,
          canManage: canManageRemote,
          tunnel: { ...tunnel, canManage: canManageRemote },
          fixedTunnel: { ...fixedTunnel, canManage: canManageRemote },
          lan: getLanStatusSnapshot(),
        }, { requestId });
        return;
      }

      if (pathname === "/api/remote/lan-switch" && request.method === "POST") {
        const body = await readJsonBody(request);
        const normalizedFallback = normalizeFallbackUrl(body.fallbackUrl);
        if (normalizedFallback) {
          lastKnownRemoteFallbackUrl = normalizedFallback;
        }
        const lan = getLanStatusSnapshot();
        if (!lan.enabled || !lan.primaryUrl) {
          sendJson(response, 409, {
            error: {
              code: "lan_unavailable",
              message: !lan.enabled
                ? "当前服务仅监听本机回环地址，请以 HOST=0.0.0.0 或重启后台服务后再试"
                : "未检测到可用的局域网 IPv4 地址",
            },
          }, { requestId });
          return;
        }
        if (!tunnelAuth.browserToken) await tunnelAuth.load();
        const threadId = String(body.threadId || "").trim();
        const threadSuffix = threadId ? `?thread=${encodeURIComponent(threadId)}` : "";
        const connectUrl = `${lan.primaryUrl}/connect/${encodeURIComponent(tunnelAuth.browserToken)}${threadSuffix}`;
        sendJson(response, 200, {
          ok: true,
          lan,
          connectUrl,
        }, { requestId });
        return;
      }

      if (pathname === "/api/remote/pair" && request.method === "POST") {
        if (!canManageRemote) {
          sendJson(response, 403, { error: { code: "forbidden", message: "仅限在本机控制台修改远程中继配对" } }, { requestId });
          return;
        }
        const body = await readJsonBody(request);
        const status = await bridge.pair(body);
        sendJson(response, 200, { ...status, canManage: true }, { requestId });
        return;
      }

      if (pathname === "/api/remote/unpair" && request.method === "POST") {
        if (!canManageRemote) {
          sendJson(response, 403, { error: { code: "forbidden", message: "仅限在本机控制台修改远程中继配对" } }, { requestId });
          return;
        }
        const status = await bridge.unpair();
        sendJson(response, 200, { ...status, canManage: true }, { requestId });
        return;
      }

      if (pathname === "/api/apps" && request.method === "GET") {
        const apps = await listLocalApps(appsDir, { instanceId: identity.instanceId });
        sendJson(response, 200, { apps }, { requestId });
        return;
      }

      if (pathname === "/api/update" && request.method === "GET") {
        sendJson(response, 200, updateService.statusSnapshot(), { requestId });
        return;
      }

      if (pathname === "/api/update/check" && request.method === "POST") {
        await readJsonBody(request);
        const status = await updateService.checkForUpdates({ silent: false });
        sendJson(response, 200, status, { requestId });
        return;
      }

      if (pathname === "/api/update/config" && request.method === "POST") {
        const body = await readJsonBody(request);
        const status = await updateService.configure(body);
        sendJson(response, 200, status, { requestId });
        return;
      }

      if (pathname === "/api/update/apply" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await updateService.applyUpdate({ reason: body?.reason || "manual" });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/update/restart" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await updateService.restartService({ reason: body?.reason || "manual" });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/update/desktop" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await updateService.applyDesktopUpdate({
          reason: body?.reason || "manual",
          relaunchIfRunning: body?.relaunchIfRunning !== false,
          openAfterBuild: typeof body?.openAfterBuild === "boolean" ? body.openAfterBuild : undefined,
        });
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/automations" && request.method === "GET") {
        const snapshot = await automationScheduler.getSnapshot();
        sendJson(response, 200, snapshot, { requestId });
        return;
      }

      if (pathname === "/api/automations/toggle" && request.method === "POST") {
        const body = await readJsonBody(request);
        const snapshot = await automationScheduler.configure({
          ...(typeof body?.enabled === "boolean" ? { enabled: body.enabled } : {}),
          ...(body?.taskKey ? { taskKey: body.taskKey } : {}),
          ...(typeof body?.managed === "boolean" ? { managed: body.managed } : {}),
        });
        sendJson(response, 200, snapshot, { requestId });
        return;
      }

      if (pathname === "/api/automations/run" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await automationScheduler.runNow(body?.taskKey || "");
        sendJson(response, 200, result, { requestId });
        return;
      }

      if (pathname === "/api/automations/custom" && request.method === "POST") {
        const body = await readJsonBody(request);
        const snapshot = await automationScheduler.saveCustomTask(body || {});
        sendJson(response, 200, snapshot, { requestId });
        return;
      }

      if (pathname === "/api/automations/delete" && request.method === "POST") {
        const body = await readJsonBody(request);
        const snapshot = await automationScheduler.deleteTask(body?.taskKey || body?.id || "");
        sendJson(response, 200, snapshot, { requestId });
        return;
      }

      if (pathname === "/api/human-verify" && request.method === "GET") {
        sendJson(response, 200, { ok: true, items: humanVerify.listPending() }, { requestId });
        return;
      }

      if (pathname === "/api/human-verify" && request.method === "POST") {
        if (!canManageRemote) {
          sendJson(response, 403, { error: { code: "forbidden", message: "仅限在本机控制台发起动态验证" } }, { requestId });
          return;
        }
        const body = await readJsonBody(request);
        const created = await humanVerify.create(body);
        if (body.wait === false) {
          sendJson(response, 200, { ok: true, item: created.item }, { requestId });
          return;
        }
        let finished = false;
        const onClientDisconnect = () => {
          if (finished || response.writableFinished || body.keepAliveOnDisconnect === true) return;
          humanVerify.cancel(created.item.id, { reason: "disconnected" });
        };
        request.on("aborted", onClientDisconnect);
        response.on("close", onClientDisconnect);
        const outcome = await created.wait();
        finished = true;
        request.off("aborted", onClientDisconnect);
        response.off("close", onClientDisconnect);
        if (!response.writableEnded && !response.destroyed) {
          sendJson(response, 200, outcome, { requestId });
        }
        return;
      }

      const hvActionMatch = pathname.match(/^\/api\/human-verify\/([^/]+)(?:\/(submit|cancel|refresh))?\/?$/);
      if (hvActionMatch) {
        const hvId = decodeURIComponent(hvActionMatch[1]);
        const hvAction = hvActionMatch[2] || "";
        if (!hvAction && request.method === "GET") {
          const item = humanVerify.get(hvId);
          if (!item) {
            sendJson(response, 404, { error: { code: "not_found", message: "验证请求不存在或已结束" } }, { requestId });
            return;
          }
          sendJson(response, 200, { ok: true, item }, { requestId });
          return;
        }
        if (hvAction === "submit" && request.method === "POST") {
          const body = await readJsonBody(request);
          const result = humanVerify.submit(hvId, {
            value: body.value,
            values: body.values,
            submittedBy: body.submittedBy || (canManageRemote ? "web" : "remote"),
          });
          sendJson(response, 200, result, { requestId });
          return;
        }
        if (hvAction === "cancel" && request.method === "POST") {
          const body = await readJsonBody(request);
          const result = humanVerify.cancel(hvId, {
            reason: body.reason || "cancelled",
            submittedBy: body.submittedBy || (canManageRemote ? "web" : "remote"),
          });
          sendJson(response, 200, result, { requestId });
          return;
        }
        if (hvAction === "refresh" && request.method === "POST") {
          await readJsonBody(request);
          const item = await humanVerify.refresh(hvId);
          sendJson(response, 200, { ok: true, item }, { requestId });
          return;
        }
      }

      if (pathname.startsWith("/api/")) {
        sendJson(response, 404, { error: { message: "API 路由不存在" } }, { requestId });
        return;
      }

      if (request.method === "GET" || request.method === "HEAD") {
        await serveStaticFile(response, request.url || pathname, publicDir, request);
        return;
      }

      sendJson(response, 405, { error: { message: "不支持的请求方法" } }, { requestId });
    } catch (error) {
      logRequestError(context, error, {
        ...(writeErrorLog ? { write: writeErrorLog } : {}),
      });
      sendJson(response, Number(error?.status) || 500, {
        error: {
          code: error?.code || null,
          message: error?.message || "Agent Control 服务处理失败",
        },
      }, { requestId });
    }
  });

  const usagePing = createUsagePing({
    dataDir,
    instanceId: identity.instanceId,
    env,
    disabled: disableTelemetry,
  });

  const closeResources = async () => {
    clearInterval(heartbeat);
    humanVerify.close();
    automationScheduler.close();
    updateService.close();
    usagePing.close();
    unsubscribeHub();
    for (const res of [...sseClients]) {
      try { res.end(); } catch {}
    }
    sseClients.clear();
    await Promise.allSettled([
      quickTunnel.close(),
      bridge.close(),
      voiceService.close(),
      spritePhoneArchive.close(),
      hub.close(),
      taskStore?.flush?.(),
    ]);
    await leaseHandle?.release().catch(() => {});
    server.closeIdleConnections?.();
    await new Promise((resolveClose) => server.close(() => resolveClose()));
  };
  closeServerResources = closeResources;

  return {
    server,
    hub,
    taskStore,
    bridge,
    quickTunnel,
    tunnelAuth,
    updateService,
    overviewService,
    humanVerify,
    identity,
    get port() {
      return actualPort;
    },
    get url() {
      return `http://${host}:${actualPort}`;
    },
    async start() {
      await new Promise((resolveStart, rejectStart) => {
        server.once("error", rejectStart);
        server.listen(port, host, () => {
          server.off("error", rejectStart);
          const addr = server.address();
          actualPort = typeof addr === "object" && addr ? addr.port : port;
          resolveStart();
        });
      });
      const localOrigin = `http://${host}:${actualPort}`;
      quickTunnel.setTargetOrigin(localOrigin);
      tailscaleFunnel.setTargetOrigin(localOrigin);
      bridge.setTargetOrigin(localOrigin);
      humanVerify.setTargetOrigin(localOrigin);
      bridge.connect();
      if (!disableUpdateCheck) {
        updateService.start();
      }
      usagePing.start();
      if (!env.AGENT_CONTROL_DISABLE_AUTOMATIONS) {
        automationScheduler.start();
      }
      hub.startSearchIndex?.();
      leaseHandle = await acquireRuntimeLease({
        dataDir,
        host,
        port: actualPort,
        instanceId: identity.instanceId,
        label: identity.label,
      });
      return this;
    },
    async close() {
      await closeResources();
    },
  };
}

const entryArg = process.argv[1] ? resolve(process.argv[1]) : "";
const entrySelf = resolve(fileURLToPath(import.meta.url));
const isMain = Boolean(
  entryArg
  && (process.platform === "win32" ? entryArg.toLowerCase() === entrySelf.toLowerCase() : entryArg === entrySelf),
);
if (isMain) {
  try {
    const control = await createAgentControlServer();
    await control.start();
    process.stdout.write(`Agent Control listening at ${control.url} (instance=${control.identity.instanceId})\n`);
    const shutdown = async () => {
      await control.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  } catch (err) {
    const port = process.env.PORT || "43310";
    const host = process.env.HOST || "127.0.0.1";
    const dataDir = defaultDataDir(process.env);
    let hint = "请检查下方错误详情与最近日志。";
    if (err?.code === "EADDRINUSE") {
      hint = `端口 ${port} 已被占用，可设置 PORT=43315 后重启服务。`;
    } else if (err?.code === "EACCES") {
      hint = `无权监听 ${host}:${port}（Windows 常见于 Hyper-V/WSL2 保留端口段），可改用 PORT=43315 重试。`;
    }
    process.stderr.write([
      `[Agent Control 启动失败] ${err?.message || err}`,
      `排查提示: ${hint}`,
      `数据目录: ${dataDir}`,
      `日志目录: ${resolve(dataDir, "logs")}`,
      err?.stack ? `堆栈:\n${err.stack}` : "",
      "",
    ].filter(Boolean).join("\n"));
    process.exit(1);
  }
}
