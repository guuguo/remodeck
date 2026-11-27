import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { createGzip } from "node:zlib";
import QRCode from "qrcode";
import { WebSocket } from "ws";
import {
  acceptsGzip,
  GZIP_MIN_BYTES,
  isCompressibleContentType,
  mergeVaryHeader,
} from "./http-response.mjs";
import { defaultDataDir } from "./instance-identity.mjs";
import { sanitizeProxyHeaders } from "./local-apps.mjs";
import { defaultPlatformHostLabel } from "./platform.mjs";

const DEFAULT_HEARTBEAT_INTERVAL_MS = 12_000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 30_000;
const DEFAULT_RESPONSE_CHUNK_BYTES = 32 * 1024;
const DEFAULT_WS_HIGH_WATER_MARK = 256 * 1024;
const DEFAULT_WS_LOW_WATER_MARK = 64 * 1024;
const MAX_STREAMED_REQUEST_BYTES = 28 * 1024 * 1024;
const MAX_RECONNECT_DELAY_MS = 15_000;

export function relayAuthPath(dataDir = defaultDataDir()) {
  return resolve(dataDir, "relay-auth.json");
}

function relayWsUrl(httpUrl) {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/relay/host";
  url.search = "";
  url.hash = "";
  return url.toString();
}

export class RemoteBridge {
  #dataDir;
  #targetOrigin;
  #instanceId;
  #label;
  #disabled;
  #auth = null;
  #ws = null;
  #reconnectTimer = null;
  #heartbeatTimer = null;
  #reconnectAttempt = 0;
  #closed = false;
  #state = "unpaired";
  #lastError = "";
  #lastConnectedAt = null;
  #inFlightAborts = new Map();
  #incomingRequestStreams = new Map();
  #onStateChange;
  #internalAuthToken = "";
  #heartbeatIntervalMs;
  #heartbeatTimeoutMs;
  #responseChunkBytes;
  #wsHighWaterMark;
  #wsLowWaterMark;

  constructor({
    dataDir = defaultDataDir(),
    targetOrigin = "",
    instanceId = "",
    label = "",
    disabled = false,
    internalAuthToken = "",
    heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
    heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS,
    responseChunkBytes = DEFAULT_RESPONSE_CHUNK_BYTES,
    wsHighWaterMark = DEFAULT_WS_HIGH_WATER_MARK,
    wsLowWaterMark = DEFAULT_WS_LOW_WATER_MARK,
    onStateChange = () => {},
  } = {}) {
    this.#dataDir = dataDir;
    this.#targetOrigin = targetOrigin;
    this.#instanceId = instanceId;
    this.#label = label;
    this.#disabled = Boolean(disabled);
    this.#internalAuthToken = String(internalAuthToken || "");
    this.#heartbeatIntervalMs = Math.max(20, Number(heartbeatIntervalMs) || DEFAULT_HEARTBEAT_INTERVAL_MS);
    this.#heartbeatTimeoutMs = Math.max(
      this.#heartbeatIntervalMs * 2,
      Number(heartbeatTimeoutMs) || DEFAULT_HEARTBEAT_TIMEOUT_MS,
    );
    this.#responseChunkBytes = Math.max(4 * 1024, Number(responseChunkBytes) || DEFAULT_RESPONSE_CHUNK_BYTES);
    this.#wsHighWaterMark = Math.max(16 * 1024, Number(wsHighWaterMark) || DEFAULT_WS_HIGH_WATER_MARK);
    this.#wsLowWaterMark = Math.min(
      this.#wsHighWaterMark,
      Math.max(4 * 1024, Number(wsLowWaterMark) || DEFAULT_WS_LOW_WATER_MARK),
    );
    this.#onStateChange = onStateChange;
  }

  setTargetOrigin(origin) {
    this.#targetOrigin = origin;
  }

  async load() {
    if (this.#disabled) {
      this.#state = "disabled";
      return null;
    }
    try {
      const parsed = JSON.parse(await readFile(relayAuthPath(this.#dataDir), "utf8"));
      if (parsed?.relayUrl && parsed?.instanceId && parsed?.hostSecret && parsed?.pairUrl) {
        this.#auth = parsed;
        this.#state = "disconnected";
        return parsed;
      }
    } catch {
      this.#auth = null;
      this.#state = "unpaired";
    }
    return null;
  }

  async #saveAuth(auth) {
    const filePath = relayAuthPath(this.#dataDir);
    await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, `${JSON.stringify(auth, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, filePath);
    this.#auth = auth;
  }

  #emitState() {
    this.#onStateChange(this.statusSnapshot());
  }

  statusSnapshot() {
    return {
      disabled: this.#disabled,
      paired: Boolean(this.#auth),
      connected: this.#state === "connected",
      state: this.#state,
      relayUrl: this.#auth?.relayUrl || "",
      instanceId: this.#auth?.instanceId || this.#instanceId,
      label: this.#auth?.label || this.#label,
      pairUrl: this.#auth?.pairUrl || "",
      lastError: this.#lastError,
      lastConnectedAt: this.#lastConnectedAt,
    };
  }

  async status({ includeQr = false } = {}) {
    const base = this.statusSnapshot();
    if (includeQr && base.pairUrl) {
      base.qrDataUrl = await QRCode.toDataURL(base.pairUrl, { margin: 1, width: 260 });
    }
    return base;
  }

  async pair({ relayUrl, inviteCode, label } = {}) {
    if (this.#disabled) {
      throw Object.assign(new Error("当前实例禁用了远程中继"), { status: 400 });
    }
    const cleanUrl = String(relayUrl || "").trim().replace(/\/+$/, "");
    const cleanCode = String(inviteCode || "").trim();
    if (!cleanUrl || !cleanCode) {
      throw Object.assign(new Error("请填写中继地址和邀请码"), { status: 400 });
    }
    const response = await fetch(new URL("/relay/register", cleanUrl), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inviteCode: cleanCode,
        instanceId: this.#instanceId,
        label: String(label || this.#label || defaultPlatformHostLabel()).trim(),
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw Object.assign(new Error(payload?.error?.message || `配对失败（HTTP ${response.status}）`), {
        status: response.status >= 400 && response.status < 500 ? response.status : 502,
      });
    }
    await this.#saveAuth({
      relayUrl: payload.relayUrl || cleanUrl,
      instanceId: payload.instanceId,
      label: payload.label,
      hostSecret: payload.hostSecret,
      browserToken: payload.browserToken,
      pairUrl: payload.pairUrl,
      pairedAt: Date.now(),
    });
    this.#reconnectAttempt = 0;
    this.#lastError = "";
    this.connect();
    return this.status({ includeQr: true });
  }

  async unpair() {
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#stopHeartbeat();
    this.#incomingRequestStreams.clear();
    if (this.#auth?.relayUrl && this.#auth?.instanceId && this.#auth?.hostSecret) {
      await fetch(new URL("/relay/revoke", this.#auth.relayUrl), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          instanceId: this.#auth.instanceId,
          hostSecret: this.#auth.hostSecret,
        }),
      }).catch(() => {});
    }
    this.#auth = null;
    if (this.#ws) {
      try { this.#ws.close(1000, "unpaired"); } catch {}
      this.#ws = null;
    }
    await unlink(relayAuthPath(this.#dataDir)).catch(() => {});
    this.#state = this.#disabled ? "disabled" : "unpaired";
    this.#lastError = "";
    this.#emitState();
    return this.statusSnapshot();
  }

  #stopHeartbeat() {
    clearInterval(this.#heartbeatTimer);
    this.#heartbeatTimer = null;
  }

  async #waitForWsDrain(ws, signal) {
    while (
      ws.readyState === WebSocket.OPEN
      && ws.bufferedAmount > this.#wsHighWaterMark
      && !signal?.aborted
    ) {
      await new Promise((resolveWait) => {
        const timer = setTimeout(resolveWait, 15);
        timer.unref?.();
      });
      if (ws.bufferedAmount <= this.#wsLowWaterMark) break;
    }
  }

  async #sendWsJson(ws, payload, signal) {
    if (ws.readyState !== WebSocket.OPEN || signal?.aborted) return false;
    if (ws.bufferedAmount > this.#wsHighWaterMark) {
      await this.#waitForWsDrain(ws, signal);
    }
    if (ws.readyState !== WebSocket.OPEN || signal?.aborted) return false;
    ws.send(JSON.stringify(payload));
    return true;
  }

  connect() {
    if (this.#closed || this.#disabled || !this.#auth || !this.#targetOrigin) return;
    if (this.#ws && (this.#ws.readyState === WebSocket.OPEN || this.#ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#stopHeartbeat();
    this.#state = "connecting";
    this.#emitState();

    const ws = new WebSocket(relayWsUrl(this.#auth.relayUrl), {
      headers: {
        "x-instance-id": this.#auth.instanceId,
        "x-host-secret": this.#auth.hostSecret,
        "x-relay-caps": "stream-v1",
      },
    });
    this.#ws = ws;
    let openedAt = 0;
    let lastInboundAt = Date.now();

    ws.on("open", () => {
      openedAt = Date.now();
      lastInboundAt = openedAt;
      this.#reconnectAttempt = 0;
      this.#state = "connected";
      this.#lastError = "";
      this.#lastConnectedAt = openedAt;
      this.#emitState();

      this.#stopHeartbeat();
      this.#heartbeatTimer = setInterval(() => {
        if (this.#ws !== ws || ws.readyState !== WebSocket.OPEN) {
          this.#stopHeartbeat();
          return;
        }
        if (Date.now() - lastInboundAt > this.#heartbeatTimeoutMs) {
          this.#lastError = "中继心跳超时，正在重连";
          try { ws.terminate(); } catch {}
          return;
        }
        try { ws.ping(); } catch {}
        if (ws.bufferedAmount <= this.#wsHighWaterMark) {
          try { ws.send(JSON.stringify({ type: "ping", ts: Date.now() })); } catch {}
        }
      }, this.#heartbeatIntervalMs);
      this.#heartbeatTimer.unref?.();
    });

    ws.on("pong", () => {
      lastInboundAt = Date.now();
    });

    ws.on("message", (raw) => {
      lastInboundAt = Date.now();
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (msg.type === "pong" || msg.type === "registered") {
        return;
      }
      if (msg.type === "http_request") {
        void this.#handleHttpRequest(ws, msg);
      } else if (msg.type === "http_request_start" && msg.requestId) {
        this.#incomingRequestStreams.set(msg.requestId, {
          meta: msg,
          chunks: [],
          totalBytes: 0,
        });
      } else if (msg.type === "http_request_chunk" && msg.requestId) {
        const stream = this.#incomingRequestStreams.get(msg.requestId);
        if (!stream) return;
        const buf = msg.chunkBase64 ? Buffer.from(msg.chunkBase64, "base64") : Buffer.alloc(0);
        stream.totalBytes += buf.length;
        if (stream.totalBytes > MAX_STREAMED_REQUEST_BYTES) {
          this.#incomingRequestStreams.delete(msg.requestId);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "http_response_error",
              requestId: msg.requestId,
              status: 413,
              message: "请求体过大，请减少图片数量后重试",
            }));
          }
          return;
        }
        if (buf.length) stream.chunks.push(buf);
      } else if (msg.type === "http_request_end" && msg.requestId) {
        const stream = this.#incomingRequestStreams.get(msg.requestId);
        if (!stream) return;
        this.#incomingRequestStreams.delete(msg.requestId);
        const bodyBuffer = stream.chunks.length ? Buffer.concat(stream.chunks) : Buffer.alloc(0);
        void this.#handleHttpRequest(ws, { ...stream.meta, bodyBuffer });
      } else if (msg.type === "http_request_abort" && msg.requestId) {
        this.#incomingRequestStreams.delete(msg.requestId);
        const controller = this.#inFlightAborts.get(msg.requestId);
        if (controller) controller.abort();
      }
    });

    ws.on("error", (error) => {
      this.#lastError = error?.message || "中继连接错误";
    });

    ws.on("close", (code, reason) => {
      if (this.#ws === ws) {
        this.#ws = null;
        this.#stopHeartbeat();
      }
      this.#incomingRequestStreams.clear();
      for (const controller of this.#inFlightAborts.values()) controller.abort();
      this.#inFlightAborts.clear();
      if (this.#closed || !this.#auth) return;
      if (code === 4003) {
        this.#state = "revoked";
        this.#lastError = `凭证已被撤销（${String(reason || "4003")}）`;
        this.#emitState();
        return;
      }
      if (openedAt > 0 && Date.now() - openedAt >= 10_000) {
        this.#reconnectAttempt = 0;
      }
      this.#state = "disconnected";
      this.#emitState();
      const delayMs = Math.min(MAX_RECONNECT_DELAY_MS, 300 * (2 ** Math.min(6, this.#reconnectAttempt++)));
      this.#reconnectTimer = setTimeout(() => {
        this.#reconnectTimer = null;
        this.connect();
      }, delayMs);
      this.#reconnectTimer.unref?.();
    });
  }

  async #sendChunkedBytes(ws, requestId, value, signal) {
    const chunkLimit = this.#responseChunkBytes;
    for (let offset = 0; offset < value.length; offset += chunkLimit) {
      const slice = value.subarray(offset, offset + chunkLimit);
      const sent = await this.#sendWsJson(ws, {
        type: "http_response_chunk",
        requestId,
        chunkBase64: Buffer.from(slice.buffer, slice.byteOffset, slice.byteLength).toString("base64"),
      }, signal);
      if (!sent) return false;
    }
    return true;
  }

  async #handleHttpRequest(ws, msg) {
    const requestId = msg.requestId;
    const abortController = new AbortController();
    this.#inFlightAborts.set(requestId, abortController);
    try {
      const targetUrl = new URL(msg.path || "/", this.#targetOrigin);
      const headers = sanitizeProxyHeaders(msg.headers || {});
      const clientAcceptsGzip = acceptsGzip(headers["accept-encoding"]);
      delete headers["content-length"];
      headers["accept-encoding"] = "identity";
      if (this.#internalAuthToken) {
        headers["x-ac-bridge-token"] = this.#internalAuthToken;
      }
      const bodyBuffer = Buffer.isBuffer(msg.bodyBuffer)
        ? msg.bodyBuffer
        : (msg.bodyBase64 ? Buffer.from(msg.bodyBase64, "base64") : undefined);
      const upstream = await fetch(targetUrl, {
        method: msg.method || "GET",
        headers,
        body: bodyBuffer && bodyBuffer.length ? bodyBuffer : undefined,
        redirect: "manual",
        signal: abortController.signal,
      });

      const responseHeaders = sanitizeProxyHeaders(Object.fromEntries(upstream.headers), { response: true });
      const hadUpstreamEncoding = Boolean(upstream.headers.get("content-encoding"));
      delete responseHeaders["content-encoding"];
      if (hadUpstreamEncoding) {
        delete responseHeaders["content-length"];
      }

      const methodUpper = String(msg.method || "GET").toUpperCase();
      const contentType = upstream.headers.get("content-type") || "";
      const canCompress = Boolean(
        clientAcceptsGzip
        && methodUpper !== "HEAD"
        && upstream.status !== 204
        && upstream.status !== 304
        && upstream.body
        && isCompressibleContentType(contentType)
      );

      if (!canCompress) {
        const headSent = await this.#sendWsJson(ws, {
          type: "http_response_head",
          requestId,
          status: upstream.status,
          headers: responseHeaders,
        }, abortController.signal);
        if (!headSent) return;

        if (upstream.body) {
          const reader = upstream.body.getReader();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (ws.readyState !== WebSocket.OPEN || abortController.signal.aborted) break;
            if (!value?.length) continue;
            const sent = await this.#sendChunkedBytes(ws, requestId, value, abortController.signal);
            if (!sent) break;
          }
        }
        await this.#sendWsJson(ws, { type: "http_response_end", requestId }, abortController.signal);
        return;
      }

      const reader = upstream.body.getReader();
      const buffered = [];
      let bufferedBytes = 0;
      let reachedEof = false;
      while (bufferedBytes < GZIP_MIN_BYTES) {
        const { done, value } = await reader.read();
        if (done) {
          reachedEof = true;
          break;
        }
        if (value?.length) {
          buffered.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
          bufferedBytes += value.length;
        }
      }

      responseHeaders["vary"] = mergeVaryHeader(responseHeaders["vary"]);
      if (reachedEof && bufferedBytes < GZIP_MIN_BYTES) {
        const rawSmall = buffered.length ? Buffer.concat(buffered) : Buffer.alloc(0);
        responseHeaders["content-length"] = String(rawSmall.length);
        const headSent = await this.#sendWsJson(ws, {
          type: "http_response_head",
          requestId,
          status: upstream.status,
          headers: responseHeaders,
        }, abortController.signal);
        if (!headSent) return;
        if (rawSmall.length) {
          const sent = await this.#sendChunkedBytes(ws, requestId, rawSmall, abortController.signal);
          if (!sent) return;
        }
        await this.#sendWsJson(ws, { type: "http_response_end", requestId }, abortController.signal);
        return;
      }

      responseHeaders["content-encoding"] = "gzip";
      delete responseHeaders["content-length"];
      const headSent = await this.#sendWsJson(ws, {
        type: "http_response_head",
        requestId,
        status: upstream.status,
        headers: responseHeaders,
      }, abortController.signal);
      if (!headSent) {
        await reader.cancel().catch(() => {});
        return;
      }

      async function* sourceChunks() {
        for (const chunk of buffered) {
          if (chunk.length) yield chunk;
        }
        if (reachedEof) return;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value?.length) {
            yield Buffer.from(value.buffer, value.byteOffset, value.byteLength);
          }
        }
      }

      const sourceStream = Readable.from(sourceChunks());
      const gzipStream = createGzip({ level: 6 });
      sourceStream.on("error", (err) => {
        if (!gzipStream.destroyed) gzipStream.destroy(err);
      });
      sourceStream.pipe(gzipStream);

      const onAbort = () => {
        try { sourceStream.destroy(); } catch {}
        try { gzipStream.destroy(); } catch {}
        void reader.cancel().catch(() => {});
      };
      abortController.signal.addEventListener("abort", onAbort, { once: true });
      try {
        for await (const compressedChunk of gzipStream) {
          if (ws.readyState !== WebSocket.OPEN || abortController.signal.aborted) break;
          if (!compressedChunk?.length) continue;
          const sent = await this.#sendChunkedBytes(ws, requestId, compressedChunk, abortController.signal);
          if (!sent) break;
        }
      } finally {
        abortController.signal.removeEventListener("abort", onAbort);
        if (!sourceStream.destroyed) sourceStream.destroy();
        if (!gzipStream.destroyed) gzipStream.destroy();
      }
      await this.#sendWsJson(ws, { type: "http_response_end", requestId }, abortController.signal);
    } catch (error) {
      if (!abortController.signal.aborted && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "http_response_error",
          requestId,
          status: 502,
          message: error?.message || "本地控制服务请求失败",
        }));
      }
    } finally {
      this.#inFlightAborts.delete(requestId);
    }
  }

  async close() {
    this.#closed = true;
    clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#stopHeartbeat();
    this.#incomingRequestStreams.clear();
    for (const controller of this.#inFlightAborts.values()) controller.abort();
    this.#inFlightAborts.clear();
    if (this.#ws) {
      const ws = this.#ws;
      this.#ws = null;
      await new Promise((resolveClose) => {
        ws.once("close", resolveClose);
        try { ws.close(1000, "shutdown"); } catch { resolveClose(); }
      });
    }
  }
}
