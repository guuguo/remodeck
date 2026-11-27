import http from "node:http";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { sendJson } from "./http-response.mjs";
import { defaultDataDir } from "./instance-identity.mjs";
import { MissionOverviewService } from "./mission-overview-service.mjs";
import { ProviderHub } from "./provider-hub.mjs";
import { visibleControlThreads } from "./thread-access.mjs";
import { VoiceCallService } from "./voice-call-service.mjs";

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

async function fetchUpstreamJson(upstreamOrigin, path, { method = "GET", body = null, timeoutMs = 15_000 } = {}) {
  const url = new URL(path, upstreamOrigin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetch(url, {
      method,
      headers: body !== null ? { "Content-Type": "application/json" } : undefined,
      body: body !== null ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let parsed = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: text };
      }
    }
    if (!res.ok) {
      const msg = parsed?.error?.message || `上游服务返回 HTTP ${res.status}`;
      const error = Object.assign(new Error(msg), {
        status: res.status,
        code: parsed?.error?.code || "",
      });
      throw error;
    }
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPendingRequestsFromUpstreamSse(upstreamOrigin, timeoutMs = 600) {
  const url = new URL("/api/events", upstreamOrigin);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetch(url, {
      headers: { Accept: "text/event-stream" },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) return [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const blocks = buf.split("\n\n");
      buf = blocks.pop() || "";
      for (const block of blocks) {
        const lines = block.split("\n");
        let eventName = "message";
        const dataLines = [];
        for (const line of lines) {
          if (line.startsWith("event:")) eventName = line.slice(6).trim();
          else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        if (eventName === "ready" && dataLines.length) {
          const payload = JSON.parse(dataLines.join("\n"));
          controller.abort();
          return Array.isArray(payload?.pendingRequests) ? payload.pendingRequests : [];
        }
      }
    }
    return [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

function tailUserTextOfTurn(turn) {
  for (const it of Array.isArray(turn?.items) ? turn.items : []) {
    if (it?.type !== "userMessage") continue;
    const text = Array.isArray(it.content)
      ? it.content.filter((b) => b?.type === "text" && b.text).map((b) => b.text).join("\n")
      : String(it.text || "");
    if (text.trim()) return text.trim();
  }
  return "";
}

export function mergeUpstreamLiveThreadState(localPayload, upstreamPayload) {
  if (!upstreamPayload?.thread) return localPayload;
  const localThread = localPayload?.thread || {};
  const upstreamThread = upstreamPayload.thread;
  const localTurns = Array.isArray(localThread.turns) ? [...localThread.turns] : [];
  const upstreamTurns = Array.isArray(upstreamThread.turns) ? upstreamThread.turns : [];

  const liveRunning = Boolean(upstreamPayload.activity?.status === "running" || upstreamThread.live);
  const lastUpstream = upstreamTurns[upstreamTurns.length - 1];
  if (
    lastUpstream
    && (lastUpstream.status === "inProgress" || lastUpstream.status === "running" || (liveRunning && /^agy-turn-/.test(String(lastUpstream.id || ""))))
  ) {
    const lastLocal = localTurns[localTurns.length - 1];
    const upUser = tailUserTextOfTurn(lastUpstream);
    const locUser = tailUserTextOfTurn(lastLocal);
    const alreadyById = Boolean(lastUpstream.id && localTurns.some((t) => t?.id === lastUpstream.id));
    const olderThanLastLocal = Boolean(
      Number(lastUpstream.startedAt) > 0
      && Number(lastLocal?.startedAt) > 0
      && Number(lastUpstream.startedAt) + 2 < Number(lastLocal.startedAt),
    );
    const matchesEarlierLocalTurn = Boolean(
      upUser
      && locUser
      && upUser !== locUser
      && localTurns.slice(0, -1).some((t) => tailUserTextOfTurn(t) === upUser),
    );
    if (!alreadyById && !olderThanLastLocal && !matchesEarlierLocalTurn) {
      const localHasFinal = Boolean(
        lastLocal?.items?.some((it) => it?.type === "agentMessage" && it.phase !== "commentary" && String(it.text || "").trim()),
      );
      if (!lastLocal || (upUser && locUser && upUser !== locUser) || localHasFinal) {
        localTurns.push(lastUpstream);
      } else {
        const mergedItems = [...(lastLocal.items || [])];
        for (const it of lastUpstream.items || []) {
          if (!it || it.type === "userMessage") continue;
          mergedItems.push(it);
        }
        localTurns[localTurns.length - 1] = {
          ...lastLocal,
          status: "inProgress",
          items: mergedItems,
        };
      }
    }
  }

  const goalState = upstreamPayload.goalState ?? upstreamThread.goalState ?? localPayload.goalState;
  return {
    ...localPayload,
    thread: {
      ...localThread,
      ...(upstreamThread.title ? { title: upstreamThread.title } : {}),
      ...(upstreamThread.name ? { name: upstreamThread.name } : {}),
      ...(upstreamThread.model ? { model: upstreamThread.model } : {}),
      ...(upstreamThread.reasoningEffort ? { reasoningEffort: upstreamThread.reasoningEffort } : {}),
      ...(upstreamThread.permissionMode ? { permissionMode: upstreamThread.permissionMode } : {}),
      ...(goalState ? { goalState } : {}),
      live: Boolean(liveRunning || localThread.live),
      turns: localTurns,
    },
    activity: upstreamPayload.activity ?? localPayload.activity ?? null,
    pendingRequests: upstreamPayload.pendingRequests ?? localPayload.pendingRequests ?? [],
    queuedTurns: upstreamPayload.queuedTurns ?? localPayload.queuedTurns ?? [],
    goalState,
  };
}
export function createUpstreamHubAdapter({ upstreamOrigin, probeHub, fetchImpl } = {}) {
  const doJson = fetchImpl
    ? async (path, opts) => fetchImpl(path, opts)
    : (path, opts) => fetchUpstreamJson(upstreamOrigin, path, opts);

  return {
    async listThreads({ archived = "0", limit = 80 } = {}) {
      const q = new URLSearchParams({ archived: String(archived), limit: String(limit) });
      const payload = await doJson(`/api/threads?${q.toString()}`);
      return {
        ...payload,
        threads: visibleControlThreads(payload?.threads || []),
      };
    },
    async listProvidersAndProfiles() {
      return probeHub.listProvidersAndProfiles();
    },
    async allPendingRequests() {
      return fetchImpl
        ? await doJson("/api/pending-requests").catch(() => [])
        : await fetchPendingRequestsFromUpstreamSse(upstreamOrigin);
    },
    async readThread(threadId, { limit = 4 } = {}) {
      const q = new URLSearchParams({ id: String(threadId || ""), limit: String(limit) });
      return doJson(`/api/thread?${q.toString()}`);
    },
    async sendTurn(args = {}) {
      return doJson("/api/turn", { method: "POST", body: args });
    },
    async queueTurn(args = {}) {
      return doJson("/api/thread/queue", { method: "POST", body: args });
    },
    async startThread(args = {}) {
      return doJson("/api/thread/new", { method: "POST", body: args });
    },
    async interrupt(args = {}) {
      return doJson("/api/interrupt", { method: "POST", body: args });
    },
    async respondToRequest(requestId, input = {}) {
      return doJson("/api/approval", {
        method: "POST",
        body: { requestId, ...input },
      });
    },
  };
}

export async function createHotExtensionServer({
  port = Number(process.env.HOT_EXT_PORT ?? 43311),
  host = process.env.HOT_EXT_HOST || "127.0.0.1",
  upstreamOrigin = process.env.AGENT_CONTROL_UPSTREAM || "http://127.0.0.1:43310",
  env = process.env,
  dataDir = defaultDataDir(env),
  providers = null,
  probeHub: customProbeHub = null,
  voiceServiceOptions = {},
} = {}) {
  const probeHub = customProbeHub || new ProviderHub({ env, dataDir, providers, enableQueueDrain: false });
  await probeHub.init();

  const upstreamHub = createUpstreamHubAdapter({
    upstreamOrigin,
    probeHub,
  });

  const voiceService = new VoiceCallService({
    hub: upstreamHub,
    env,
    dataDir,
    ...voiceServiceOptions,
  });

  const overviewService = new MissionOverviewService({
    hub: upstreamHub,
    env,
    dataDir,
  });

  let actualPort = port;
  const server = http.createServer(async (request, response) => {
    try {
      const origin = `http://${request.headers.host || `${host}:${actualPort}`}`;
      const url = new URL(request.url || "/", origin);
      const pathname = url.pathname;

      if ((pathname === "/health" || pathname === "/") && request.method === "GET") {
        const providerSummary = await probeHub.listProvidersAndProfiles();
        sendJson(response, 200, {
          ok: true,
          service: "agent-control-hot-extension",
          upstreamOrigin,
          ...providerSummary,
        });
        return;
      }

      if (pathname === "/api/providers" && request.method === "GET") {
        const providerSummary = await probeHub.listProvidersAndProfiles();
        sendJson(response, 200, providerSummary);
        return;
      }

      if (pathname === "/api/quotas" && request.method === "GET") {
        const refresh = url.searchParams.get("refresh") === "1" || url.searchParams.get("refresh") === "true";
        const quotaSummary = await probeHub.listQuotas({ refresh });
        sendJson(response, 200, quotaSummary);
        return;
      }

      if (pathname === "/api/quotas/refresh" && request.method === "POST") {
        const quotaSummary = await probeHub.listQuotas({ refresh: true });
        sendJson(response, 200, quotaSummary);
        return;
      }

      if (pathname === "/api/telemetry" && request.method === "GET") {
        const telemetry = await probeHub.getTelemetry();
        sendJson(response, 200, telemetry);
        return;
      }

      if (pathname === "/api/models" && request.method === "GET") {
        const provider = url.searchParams.get("provider") || "";
        const profileId = url.searchParams.get("profileId") || "";
        const models = await probeHub.listModels({ provider, profileId });
        sendJson(response, 200, models);
        return;
      }

      if (pathname === "/api/thread" && request.method === "GET") {
        const id = url.searchParams.get("id") || "";
        const cursor = url.searchParams.get("cursor") || null;
        const detail = url.searchParams.get("detail") || "auto";
        const limit = Number(url.searchParams.get("limit") || 20);
        const queryPath = `/api/thread?${url.searchParams.toString()}`;
        if (!id.startsWith("antigravity:")) {
          const upstreamOnly = await fetchUpstreamJson(upstreamOrigin, queryPath);
          sendJson(response, 200, upstreamOnly);
          return;
        }
        if (cursor) {
          const pagedPayload = await probeHub.readThread(id, { cursor, detail, limit });
          sendJson(response, 200, pagedPayload);
          return;
        }
        const upstreamQuery = `/api/thread?id=${encodeURIComponent(id)}&limit=1&detail=compact`;
        const [upstreamPayload, localPayload] = await Promise.all([
          fetchUpstreamJson(upstreamOrigin, upstreamQuery, { timeoutMs: 1_500 }).catch(() => null),
          probeHub.readThread(id, { cursor, detail, limit }),
        ]);
        const merged = mergeUpstreamLiveThreadState(localPayload, upstreamPayload);
        sendJson(response, 200, merged);
        return;
      }

      if (pathname === "/api/profile/probe" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await probeHub.probeProfiles({
          provider: body.provider || "",
          profileId: body.profileId || "",
        });
        sendJson(response, 200, result);
        return;
      }

      if (pathname === "/api/profile/meta" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await probeHub.updateProfileMeta({
          provider: body.provider || "",
          profileId: body.profileId || "",
          ...(Object.hasOwn(body, "disabled") ? { disabled: Boolean(body.disabled) } : {}),
          ...(Object.hasOwn(body, "alias") ? { alias: body.alias } : {}),
        });
        sendJson(response, 200, result);
        return;
      }

      if (pathname === "/api/profile/create" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await probeHub.createProfile({
          provider: body.provider || "",
          name: body.name || "",
          customHome: body.customHome || "",
        });
        sendJson(response, 200, result);
        return;
      }

      if (pathname === "/api/profile/delete" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await probeHub.deleteProfile({
          provider: body.provider || "",
          profileId: body.profileId || "",
        });
        sendJson(response, 200, result);
        return;
      }

      if (pathname === "/api/profile/login" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await probeHub.startProfileLogin({
          provider: body.provider || "",
          profileId: body.profileId || "",
          mode: body.mode || "",
          openOnHost: body.openOnHost !== false,
        });
        sendJson(response, 200, result);
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
        sendJson(response, 200, result);
        return;
      }

      if (pathname === "/api/overview" && request.method === "GET") {
        const trigger = url.searchParams.get("trigger") || "view";
        const force = url.searchParams.get("force") === "1" || url.searchParams.get("force") === "true";
        const result = await overviewService.getOverview({ trigger, force });
        sendJson(response, 200, result);
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
        sendJson(response, 200, result);
        return;
      }

      if (pathname === "/api/overview/assign" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.assignThreadTopic(
          body.threadId || "",
          body.topicId || "",
          body.stageTag || "",
        );
        sendJson(response, 200, result);
        return;
      }

      if (pathname === "/api/overview/topic" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.upsertTopic(body);
        sendJson(response, 200, result);
        return;
      }

      if (pathname === "/api/overview/sync" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.syncProjects({
          clearExisting: Boolean(body.clearExisting),
        });
        sendJson(response, 200, result);
        return;
      }

      if (pathname === "/api/overview/spark" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.handleSparkAction(body);
        sendJson(response, 200, result);
        return;
      }

      if (pathname === "/api/overview/focus" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.toggleBossFocus(body.topicId || "");
        sendJson(response, 200, result);
        return;
      }

      if (pathname === "/api/overview/metrics" && request.method === "POST") {
        const body = await readJsonBody(request);
        const result = await overviewService.upsertTopicMetrics(body);
        sendJson(response, 200, result);
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
          remember: body.remember !== false,
          confirmOnly: Boolean(body.confirmOnly),
          sparkId: body.sparkId || "",
          inheritContext: body.inheritContext !== false,
          useAiPlanner: Boolean(body.useAiPlanner),
          approvedRoutes: Array.isArray(body.approvedRoutes) ? body.approvedRoutes : null,
        });
        sendJson(response, 200, result);
        return;
      }

      if (pathname === "/api/voice/transcribe" && request.method === "POST") {
        const body = await readJsonBody(request);
        const audioBase64 = String(body.audioBase64 || "").trim();
        if (!audioBase64) {
          sendJson(response, 400, { error: { message: "未收到音频数据" } });
          return;
        }
        const result = await voiceService.transcribeAudio({
          audioBase64,
          audioMimeType: body.audioMimeType || "audio/wav",
          language: body.language || "zh",
        });
        sendJson(response, 200, result);
        return;
      }

      sendJson(response, 404, { error: { message: "热扩展接口不存在" } });
    } catch (error) {
      const status = Number(error?.status) || 500;
      sendJson(response, status, {
        error: {
          message: error?.message || "热扩展内部错误",
          code: error?.code || "",
        },
      });
    }
  });

  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(port, host, resolveListen);
  });
  actualPort = server.address().port;

  return {
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    probeHub,
    voiceService,
    async close() {
      await voiceService.close();
      await probeHub.close();
      await new Promise((resolveClose) => server.close(resolveClose));
    },
  };
}

const isEntrypoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  const hotServer = await createHotExtensionServer();
  process.stdout.write(`agent-control hot extension listening at ${hotServer.url}\n`);
  void hotServer.probeHub.listModels().catch(() => {});
  const shutdown = async () => {
    await hotServer.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
