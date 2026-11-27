import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import http from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { WebSocket, WebSocketServer } from "ws";

const DEFAULT_PORT = Number(process.env.PORT || 8080);
const DEFAULT_MAX_BODY_BYTES = 28 * 1024 * 1024;
const STREAM_REQUEST_THRESHOLD_BYTES = 64 * 1024;
const STREAM_REQUEST_CHUNK_BYTES = 32 * 1024;
const RELAY_WS_HIGH_WATER_MARK = 256 * 1024;
const RELAY_WS_LOW_WATER_MARK = 64 * 1024;

async function sendWsJsonWithBackpressure(ws, payload, isStillActive = () => true) {
  if (ws.readyState !== WebSocket.OPEN || !isStillActive()) return false;
  while (ws.readyState === WebSocket.OPEN && ws.bufferedAmount > RELAY_WS_HIGH_WATER_MARK && isStillActive()) {
    await new Promise((resolveWait) => {
      const timer = setTimeout(resolveWait, 15);
      timer.unref?.();
    });
    if (ws.bufferedAmount <= RELAY_WS_LOW_WATER_MARK) break;
  }
  if (ws.readyState !== WebSocket.OPEN || !isStillActive()) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (!a.length || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function hashToken(value) {
  return createHash("sha256").update(String(value || "")).digest("hex");
}

function relayAcceptsGzip(headerValue) {
  const raw = String(headerValue || "").toLowerCase();
  if (!raw) return false;
  for (const part of raw.split(",")) {
    const segments = part.trim().split(";").map((s) => s.trim()).filter(Boolean);
    if (segments[0] !== "gzip") continue;
    const qSeg = segments.find((s) => s.startsWith("q="));
    if (qSeg) {
      const qVal = Number(qSeg.slice(2));
      if (Number.isFinite(qVal) && qVal <= 0) return false;
    }
    return true;
  }
  return false;
}

function sendJson(response, status, payload, extraHeaders = {}) {
  if (response.headersSent || response.writableEnded || response.destroyed) return;
  const req = response?.req || null;
  const raw = Buffer.from(JSON.stringify(payload), "utf8");
  const useGzip = status !== 204
    && status !== 304
    && raw.length >= 1024
    && relayAcceptsGzip(req?.headers?.["accept-encoding"]);
  const body = useGzip ? gzipSync(raw, { level: 6 }) : raw;
  const isHead = String(req?.method || "GET").toUpperCase() === "HEAD";
  response.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": String(body.length),
    "X-Content-Type-Options": "nosniff",
    Vary: "Accept-Encoding",
    ...(useGzip ? { "Content-Encoding": "gzip" } : {}),
    ...extraHeaders,
  });
  response.end(isHead ? undefined : body);
}

function parseCookies(headerValue) {
  const out = {};
  for (const part of String(headerValue || "").split(";")) {
    const idx = part.indexOf("=");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (name) out[name] = decodeURIComponent(val);
  }
  return out;
}

function sessionCookieName(instanceId) {
  return `ac_session_${String(instanceId || "").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
}

async function readBodyBuffer(request, maxBytes = DEFAULT_MAX_BODY_BYTES) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > maxBytes) {
      throw Object.assign(new Error("请求体过大"), { status: 413 });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function offlineHtml(instanceId) {
  const safeId = String(instanceId || "").replace(/[<>&"']/g, "");
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="3" />
  <title>RemoDeck · 等待主机上线</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; background: #0d1117; color: #e6edf3; display: grid; place-items: center; min-height: 100vh; padding: 24px; }
    .card { max-width: 420px; width: 100%; background: #161b22; border: 1px solid #30363d; border-radius: 16px; padding: 24px; box-sizing: border-box; text-align: center; }
    h1 { font-size: 18px; margin: 0 0 10px; }
    p { font-size: 14px; color: #8b949e; line-height: 1.6; margin: 0 0 16px; }
    code { font-family: ui-monospace, monospace; background: #0d1117; padding: 2px 6px; border-radius: 6px; }
    button { background: #238636; color: #fff; border: 0; border-radius: 10px; padding: 10px 16px; font-size: 14px; cursor: pointer; }
  </style>
</head>
<body>
  <div class="card">
    <h1>控制主机暂时离线</h1>
    <p>实例 <code>${safeId}</code> 正在尝试重新连接中继，页面将每 3 秒自动刷新。</p>
    <button type="button" onclick="location.reload()">立即重试</button>
  </div>
</body>
</html>`;
}

function unauthorizedHtml() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RemoDeck · 需要重新扫码配对</title>
  <style>
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif; background: #0d1117; color: #e6edf3; display: grid; place-items: center; min-height: 100vh; padding: 24px; }
    .card { max-width: 420px; width: 100%; background: #161b22; border: 1px solid #30363d; border-radius: 16px; padding: 24px; box-sizing: border-box; text-align: center; }
    h1 { font-size: 18px; margin: 0 0 10px; }
    p { font-size: 14px; color: #8b949e; line-height: 1.6; margin: 0; }
  </style>
</head>
<body>
  <div class="card">
    <h1>登录已失效或未配对</h1>
    <p>请在 Mac 本机打开 RemoDeck 控制台，重新扫描远程访问二维码。</p>
  </div>
</body>
</html>`;
}

export function createRelayServer({
  port = DEFAULT_PORT,
  host = "0.0.0.0",
  relayKey = process.env.RELAY_KEY || "",
  publicUrl = process.env.RELAY_PUBLIC_URL || "",
  dataPath = process.env.RELAY_DATA_PATH || "",
  heartbeatIntervalMs = 20_000,
  requestTimeoutMs = 90_000,
} = {}) {
  const effectiveRelayKey = String(relayKey || "").trim();
  const state = {
    version: 1,
    invites: {},
    hosts: {},
  };
  const liveSockets = new Map();
  const pendingHttpRequests = new Map();
  let stateWriteChain = Promise.resolve();

  const loadState = async () => {
    if (!dataPath) return;
    try {
      const parsed = JSON.parse(await readFile(dataPath, "utf8"));
      if (parsed && typeof parsed === "object") {
        state.invites = parsed.invites && typeof parsed.invites === "object" ? { ...parsed.invites } : {};
        state.hosts = parsed.hosts && typeof parsed.hosts === "object" ? { ...parsed.hosts } : {};
      }
    } catch {
      // Fresh state file.
    }
  };

  const persistState = async () => {
    if (!dataPath) return;
    const payload = JSON.stringify(state, null, 2);
    stateWriteChain = stateWriteChain.then(async () => {
      await mkdir(dirname(dataPath), { recursive: true, mode: 0o700 });
      const tmp = `${dataPath}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmp, `${payload}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tmp, dataPath);
    });
    return stateWriteChain;
  };

  const resolvedPublicOrigin = (request) => {
    if (publicUrl) return publicUrl.replace(/\/+$/, "");
    const proto = String(request.headers["x-forwarded-proto"] || "http").split(",")[0].trim() || "http";
    const reqHost = String(request.headers["x-forwarded-host"] || request.headers.host || `127.0.0.1:${port}`).split(",")[0].trim();
    return `${proto}://${reqHost}`;
  };

  const isSecureRequest = (request) => {
    if (publicUrl.startsWith("https://")) return true;
    const proto = String(request.headers["x-forwarded-proto"] || "").split(",")[0].trim().toLowerCase();
    return proto === "https" || Boolean(request.socket?.encrypted);
  };

  const requireAdminKey = (request) => {
    if (!effectiveRelayKey) {
      throw Object.assign(new Error("RELAY_KEY 未配置"), { status: 503 });
    }
    const provided = request.headers["x-relay-key"] || "";
    if (!constantTimeEqual(provided, effectiveRelayKey)) {
      throw Object.assign(new Error("管理密钥无效"), { status: 403 });
    }
  };

  const cancelPendingForHost = (instanceId, reason = "主机连接已断开") => {
    for (const [reqId, pending] of [...pendingHttpRequests.entries()]) {
      if (pending.instanceId !== instanceId) continue;
      pendingHttpRequests.delete(reqId);
      clearTimeout(pending.timer);
      if (!pending.response.headersSent) {
        sendJson(pending.response, 502, { error: { code: "host_disconnected", message: reason } });
      } else if (!pending.response.writableEnded) {
        pending.response.end();
      }
    }
  };

  const authenticateHost = (instanceId, hostSecret) => {
    const hostRecord = state.hosts[instanceId];
    if (!hostRecord || hostRecord.revoked) return null;
    if (!constantTimeEqual(hashToken(hostSecret), hostRecord.hostSecretHash)) return null;
    return hostRecord;
  };

  const server = http.createServer(async (request, response) => {
    try {
      const origin = resolvedPublicOrigin(request);
      const url = new URL(request.url || "/", origin);
      const pathname = url.pathname;

      if (pathname === "/health" && request.method === "GET") {
        sendJson(response, 200, {
          ok: true,
          service: "agent-control-relay",
          onlineHosts: liveSockets.size,
          totalHosts: Object.values(state.hosts).filter((item) => !item.revoked).length,
        });
        return;
      }

      if (pathname === "/admin/invites" && request.method === "POST") {
        requireAdminKey(request);
        const raw = await readBodyBuffer(request, 64 * 1024);
        let body = {};
        if (raw.length) body = JSON.parse(raw.toString("utf8"));
        const code = randomBytes(12).toString("base64url");
        state.invites[code] = {
          label: String(body.label || "").trim().slice(0, 80),
          createdAt: Date.now(),
          usedAt: null,
          usedByInstanceId: null,
        };
        await persistState();
        sendJson(response, 201, {
          inviteCode: code,
          label: state.invites[code].label,
          createdAt: state.invites[code].createdAt,
        });
        return;
      }

      if (pathname === "/relay/register" && request.method === "POST") {
        const raw = await readBodyBuffer(request, 64 * 1024);
        const body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
        const inviteCode = String(body.inviteCode || "").trim();
        const invite = state.invites[inviteCode];
        if (!invite || invite.usedAt) {
          sendJson(response, 403, { error: { code: "invalid_invite", message: "邀请码无效或已被使用" } });
          return;
        }
        const instanceId = String(body.instanceId || randomBytes(6).toString("hex"))
          .replace(/[^a-zA-Z0-9_-]/g, "")
          .slice(0, 48) || randomBytes(6).toString("hex");
        const label = String(body.label || invite.label || "Mac").trim().slice(0, 80);
        const hostSecret = randomBytes(24).toString("base64url");
        const browserToken = randomBytes(24).toString("base64url");

        invite.usedAt = Date.now();
        invite.usedByInstanceId = instanceId;
        state.hosts[instanceId] = {
          instanceId,
          label,
          hostSecretHash: hashToken(hostSecret),
          browserTokenHash: hashToken(browserToken),
          sessionHashes: [],
          revoked: false,
          createdAt: Date.now(),
        };
        await persistState();
        const pairUrl = `${origin}/connect/${encodeURIComponent(instanceId)}/${encodeURIComponent(browserToken)}`;
        sendJson(response, 200, {
          instanceId,
          label,
          hostSecret,
          browserToken,
          pairUrl,
          relayUrl: origin,
        });
        return;
      }

      if (pathname === "/relay/revoke" && request.method === "POST") {
        const raw = await readBodyBuffer(request, 64 * 1024);
        const body = raw.length ? JSON.parse(raw.toString("utf8")) : {};
        const instanceId = String(body.instanceId || "").trim();
        const hostRecord = state.hosts[instanceId];
        const hasAdminKey = effectiveRelayKey && constantTimeEqual(request.headers["x-relay-key"], effectiveRelayKey);
        const hasHostSecret = hostRecord && constantTimeEqual(hashToken(body.hostSecret || request.headers["x-host-secret"]), hostRecord.hostSecretHash);
        if (!hasAdminKey && !hasHostSecret) {
          sendJson(response, 403, { error: { message: "无权撤销该主机凭证" } });
          return;
        }
        if (hostRecord) {
          hostRecord.revoked = true;
          hostRecord.sessionHashes = [];
          await persistState();
        }
        const ws = liveSockets.get(instanceId);
        if (ws) {
          ws.close(4003, "revoked");
          liveSockets.delete(instanceId);
        }
        cancelPendingForHost(instanceId, "主机凭证已撤销");
        sendJson(response, 200, { ok: true, instanceId });
        return;
      }

      const connectMatch = pathname.match(/^\/connect\/([^/]+)\/([^/]+)\/?$/);
      if (connectMatch && request.method === "GET") {
        const instanceId = decodeURIComponent(connectMatch[1]);
        const browserToken = decodeURIComponent(connectMatch[2]);
        const hostRecord = state.hosts[instanceId];
        if (!hostRecord || hostRecord.revoked || !constantTimeEqual(hashToken(browserToken), hostRecord.browserTokenHash)) {
          response.writeHead(403, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
          response.end(unauthorizedHtml());
          return;
        }
        const sessionToken = randomBytes(24).toString("base64url");
        hostRecord.sessionHashes = [...(hostRecord.sessionHashes || []).slice(-15), hashToken(sessionToken)];
        await persistState();
        const cookieParts = [
          `${sessionCookieName(instanceId)}=${encodeURIComponent(sessionToken)}`,
          `Path=/i/${encodeURIComponent(instanceId)}/`,
          "HttpOnly",
          "SameSite=Strict",
          "Max-Age=2592000",
        ];
        if (isSecureRequest(request)) cookieParts.push("Secure");
        response.writeHead(302, {
          "Set-Cookie": cookieParts.join("; "),
          Location: `/i/${encodeURIComponent(instanceId)}/`,
          "Cache-Control": "no-store",
        });
        response.end();
        return;
      }

      const instanceBareMatch = pathname.match(/^\/i\/([^/]+)$/);
      if (instanceBareMatch) {
        response.writeHead(302, { Location: `${pathname}/${url.search}` });
        response.end();
        return;
      }

      const instanceMatch = pathname.match(/^\/i\/([^/]+)(\/.*)$/);
      if (instanceMatch) {
        const instanceId = decodeURIComponent(instanceMatch[1]);
        const forwardPath = `${instanceMatch[2]}${url.search}`;
        const hostRecord = state.hosts[instanceId];
        const cookies = parseCookies(request.headers.cookie);
        const sessionToken = cookies[sessionCookieName(instanceId)];
        const sessionHash = sessionToken ? hashToken(sessionToken) : "";
        const authed = Boolean(
          hostRecord
          && !hostRecord.revoked
          && sessionHash
          && (hostRecord.sessionHashes || []).some((item) => constantTimeEqual(item, sessionHash)),
        );
        if (!authed) {
          const acceptsHtml = String(request.headers.accept || "").includes("text/html") && forwardPath === "/";
          if (acceptsHtml) {
            response.writeHead(401, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
            response.end(unauthorizedHtml());
          } else {
            sendJson(response, 401, { error: { code: "unauthorized", message: "会话未认证，请重新扫码配对" } });
          }
          return;
        }

        const ws = liveSockets.get(instanceId);
        if (!ws || ws.readyState !== WebSocket.OPEN) {
          const acceptsSse = String(request.headers.accept || "").includes("text/event-stream") || instanceMatch[2] === "/api/events";
          if (acceptsSse) {
            response.writeHead(200, {
              "Content-Type": "text/event-stream; charset=utf-8",
              "Cache-Control": "no-cache, no-store",
            });
            response.write(`retry: 2000\nevent: host_offline\ndata: ${JSON.stringify({ offline: true, instanceId })}\n\n`);
            response.end();
            return;
          }
          const acceptsHtml = String(request.headers.accept || "").includes("text/html") && instanceMatch[2] === "/";
          if (acceptsHtml) {
            response.writeHead(503, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
            response.end(offlineHtml(instanceId));
            return;
          }
          sendJson(response, 503, { error: { code: "host_offline", message: "Mac 控制主机当前离线，正在等待重连" } });
          return;
        }

        const body = request.method === "GET" || request.method === "HEAD"
          ? Buffer.alloc(0)
          : await readBodyBuffer(request);
        const requestId = randomUUID();
        const isSse = instanceMatch[2] === "/api/events" || String(request.headers.accept || "").includes("text/event-stream");
        const timeoutMs = isSse ? 0 : requestTimeoutMs;
        const timer = timeoutMs > 0
          ? setTimeout(() => {
              const pending = pendingHttpRequests.get(requestId);
              if (!pending) return;
              pendingHttpRequests.delete(requestId);
              if (!response.headersSent) {
                sendJson(response, 504, { error: { code: "gateway_timeout", message: "主机响应超时" } });
              } else if (!response.writableEnded) {
                response.end();
              }
            }, timeoutMs)
          : null;
        timer?.unref?.();

        pendingHttpRequests.set(requestId, { instanceId, response, timer });
        const cleanup = () => {
          const pending = pendingHttpRequests.get(requestId);
          if (!pending) return;
          pendingHttpRequests.delete(requestId);
          clearTimeout(pending.timer);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "http_request_abort", requestId }));
          }
        };
        request.once("aborted", cleanup);
        response.once("close", cleanup);

        const forwardHeaders = { ...request.headers };
        delete forwardHeaders.cookie;
        delete forwardHeaders.host;
        if (ws.supportsStreamV1 && body.length > STREAM_REQUEST_THRESHOLD_BYTES) {
          const isStillActive = () => pendingHttpRequests.has(requestId);
          const started = await sendWsJsonWithBackpressure(ws, {
            type: "http_request_start",
            requestId,
            method: request.method,
            path: forwardPath,
            headers: forwardHeaders,
            totalBytes: body.length,
          }, isStillActive);
          if (!started) return;
          for (let offset = 0; offset < body.length; offset += STREAM_REQUEST_CHUNK_BYTES) {
            const slice = body.subarray(offset, offset + STREAM_REQUEST_CHUNK_BYTES);
            const ok = await sendWsJsonWithBackpressure(ws, {
              type: "http_request_chunk",
              requestId,
              chunkBase64: slice.toString("base64"),
            }, isStillActive);
            if (!ok) return;
          }
          await sendWsJsonWithBackpressure(ws, {
            type: "http_request_end",
            requestId,
          }, isStillActive);
          return;
        }
        ws.send(JSON.stringify({
          type: "http_request",
          requestId,
          method: request.method,
          path: forwardPath,
          headers: forwardHeaders,
          bodyBase64: body.length ? body.toString("base64") : "",
        }));
        return;
      }

      sendJson(response, 404, { error: { message: "中继路由不存在" } });
    } catch (error) {
      sendJson(response, Number(error?.status) || 500, {
        error: { message: error?.message || "中继服务异常" },
      });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
    if (url.pathname !== "/relay/host") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const instanceId = String(request.headers["x-instance-id"] || url.searchParams.get("instanceId") || "").trim();
    const hostSecret = String(request.headers["x-host-secret"] || url.searchParams.get("hostSecret") || "").trim();
    const hostRecord = authenticateHost(instanceId, hostSecret);
    if (!hostRecord) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }
    const caps = String(request.headers["x-relay-caps"] || "");
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, { instanceId, hostRecord, caps });
    });
  });

  wss.on("connection", (ws, { instanceId, hostRecord, caps = "" }) => {
    const previous = liveSockets.get(instanceId);
    if (previous && previous !== ws) {
      try { previous.close(4000, "replaced"); } catch {}
    }
    liveSockets.set(instanceId, ws);
    ws.isAlive = true;
    ws.supportsStreamV1 = String(caps || "")
      .split(",")
      .map((s) => s.trim())
      .includes("stream-v1");

    ws.send(JSON.stringify({
      type: "registered",
      instanceId,
      label: hostRecord.label,
    }));

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", (raw) => {
      ws.isAlive = true;
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong", ts: Date.now() }));
        return;
      }
      const pending = pendingHttpRequests.get(msg.requestId);
      if (!pending) return;

      if (msg.type === "http_response_head") {
        clearTimeout(pending.timer);
        if (!pending.response.headersSent && !pending.response.destroyed) {
          const headers = { ...(msg.headers || {}) };
          delete headers["set-cookie"];
          delete headers["transfer-encoding"];
          pending.response.writeHead(Number(msg.status) || 200, headers);
        }
      } else if (msg.type === "http_response_chunk") {
        if (!pending.response.writableEnded && !pending.response.destroyed && msg.chunkBase64) {
          pending.response.write(Buffer.from(msg.chunkBase64, "base64"));
        }
      } else if (msg.type === "http_response_end") {
        pendingHttpRequests.delete(msg.requestId);
        clearTimeout(pending.timer);
        if (!pending.response.writableEnded && !pending.response.destroyed) {
          pending.response.end();
        }
      } else if (msg.type === "http_response_error") {
        pendingHttpRequests.delete(msg.requestId);
        clearTimeout(pending.timer);
        if (!pending.response.headersSent) {
          sendJson(pending.response, Number(msg.status) || 502, {
            error: { message: msg.message || "本地控制服务响应失败" },
          });
        } else if (!pending.response.writableEnded) {
          pending.response.end();
        }
      }
    });

    ws.on("close", () => {
      if (liveSockets.get(instanceId) === ws) {
        liveSockets.delete(instanceId);
        cancelPendingForHost(instanceId, "主机连接已断开");
      }
    });
  });

  const heartbeat = setInterval(() => {
    for (const [instanceId, ws] of [...liveSockets.entries()]) {
      if (ws.isAlive === false) {
        liveSockets.delete(instanceId);
        try { ws.terminate(); } catch {}
        cancelPendingForHost(instanceId, "主机心跳超时");
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }, heartbeatIntervalMs);
  heartbeat.unref?.();

  let actualPort = port;
  return {
    server,
    get port() {
      return actualPort;
    },
    get url() {
      return `http://127.0.0.1:${actualPort}`;
    },
    async start() {
      await loadState();
      await new Promise((resolveStart, rejectStart) => {
        server.once("error", rejectStart);
        server.listen(port, host, () => {
          server.off("error", rejectStart);
          const addr = server.address();
          actualPort = typeof addr === "object" && addr ? addr.port : port;
          resolveStart();
        });
      });
      return this;
    },
    async close() {
      clearInterval(heartbeat);
      for (const ws of liveSockets.values()) {
        try { ws.close(); } catch {}
      }
      liveSockets.clear();
      for (const pending of pendingHttpRequests.values()) {
        clearTimeout(pending.timer);
        try {
          if (!pending.response.writableEnded && !pending.response.destroyed) {
            pending.response.end();
          }
        } catch {}
      }
      pendingHttpRequests.clear();
      await new Promise((resolveClose) => wss.close(resolveClose));
      server.closeIdleConnections?.();
      server.closeAllConnections?.();
      await new Promise((resolveClose) => server.close(resolveClose));
      await stateWriteChain.catch(() => {});
    },
  };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const relay = createRelayServer();
  await relay.start();
  process.stdout.write(`Agent Control Relay listening on ${relay.url}\n`);
  const shutdown = async () => {
    await relay.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
