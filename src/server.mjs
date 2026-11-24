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
import { execFileCrossPlatform, isSubpathOrEqual } from "./platform.mjs";
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
import { MissionOverviewService } from "./mission-overview-service.mjs";
import { UpdateService } from "./update-service.mjs";
import { createUsagePing } from "./usage-ping.mjs";
import { VoiceCallService } from "./voice-call-service.mjs";

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
  revealFileImpl = null,
  writeErrorLog,
} = {}) {
  const identity = await ensureInstanceIdentity({ dataDir });
  const hub = customHub || new ProviderHub({ env, dataDir, providers });
  await hub.init();
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
  });

  const unsubscribeHub = hub.subscribe((eventName, payload) => {
    broadcastSse(eventName, payload);
    void voiceService.handleHubEvent?.(eventName, payload);
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
  const updateService = new UpdateService({
    ...(updateServiceOptions || {}),
    dataDir,
    env,
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
        const result = await hub.startThread({
          provider: body.provider || "codex",
          profileId: body.profileId || "default",
          cwd: body.cwd || "",
          text,
          images: Array.isArray(body.images) ? body.images : [],
          model: body.model || "",
          effort: body.effort || "",
          permissionMode: body.permissionMode || "workspace",
          runMode: body.runMode || "normal",
          goalMode: Boolean(body.goalMode),
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
        if (String(body.source || "").trim().toLowerCase() === "agent" && hub.getSettings().agentAutoTitle === false) {
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
        const result = await hub.renameThread(threadId, body.name);
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
      hub.close(),
    ]);
    await leaseHandle?.release().catch(() => {});
    server.closeIdleConnections?.();
    await new Promise((resolveClose) => server.close(() => resolveClose()));
  };
  closeServerResources = closeResources;

  return {
    server,
    hub,
    bridge,
    quickTunnel,
    tunnelAuth,
    updateService,
    overviewService,
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
      bridge.connect();
      if (!disableUpdateCheck) {
        updateService.start();
      }
      usagePing.start();
      if (!env.AGENT_CONTROL_DISABLE_AUTOMATIONS) {
        automationScheduler.start();
      }
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
