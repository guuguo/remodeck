import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRelayServer } from "../relay/relay-server.mjs";
import {
  extractQuickTunnelUrl,
  isDirectLoopbackRequest,
  isTunnelConnectionRegistered,
  normalizeFixedPublicUrl,
  parseTailscaleStatusJson,
  resolveCloudflaredExecutable,
  resolveTailscaleExecutable,
} from "../src/quick-tunnel.mjs";
import { createAgentControlServer } from "../src/server.mjs";

const MOCK_CODEX_BIN = fileURLToPath(new URL("./helpers/mock-codex-cli.mjs", import.meta.url));
const MOCK_CLAUDE_BIN = fileURLToPath(new URL("./helpers/mock-claude-cli.mjs", import.meta.url));
const MOCK_AGY_BIN = fileURLToPath(new URL("./helpers/mock-agy-cli.mjs", import.meta.url));
const MOCK_CLOUDFLARED_BIN = fileURLToPath(new URL("./helpers/mock-cloudflared-cli.mjs", import.meta.url));

function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveWait, rejectWait) => {
    const check = async () => {
      try {
        const val = await predicate();
        if (val) return resolveWait(val);
      } catch {}
      if (Date.now() > deadline) return rejectWait(new Error("等待条件超时"));
      setTimeout(check, 25);
    };
    void check();
  });
}

function rawHttpGet(baseUrl, path, headers = {}) {
  const target = new URL(path, baseUrl);
  return new Promise((resolveReq, rejectReq) => {
    const req = http.request({
      hostname: target.hostname,
      port: target.port,
      path: `${target.pathname}${target.search}`,
      method: "GET",
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        resolveReq({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });
    req.on("error", rejectReq);
    req.end();
  });
}

test("quick-tunnel unit helpers: URL extraction, loopback detection, and binary resolution", () => {
  const mixedLog = [
    "2026-11-14 INF Requesting version from https://api.trycloudflare.com",
    "2026-11-14 INF +------------------------------------------------------------+",
    "2026-11-14 INF |  https://bright-panda-42.trycloudflare.com/                |",
  ].join("\n");
  assert.equal(extractQuickTunnelUrl(mixedLog), "https://bright-panda-42.trycloudflare.com");
  assert.equal(
    extractQuickTunnelUrl("INF AGENT_CONTROL_TUNNEL_URL=http://127.0.0.1:51234/"),
    "http://127.0.0.1:51234",
  );
  assert.equal(extractQuickTunnelUrl("only https://api.trycloudflare.com here"), "");

  assert.equal(
    isTunnelConnectionRegistered("2026-11-14 INF Registered tunnel connection connIndex=0 location=lax01 protocol=http2"),
    true,
  );
  assert.equal(
    isTunnelConnectionRegistered("INF AGENT_CONTROL_TUNNEL_URL=http://127.0.0.1:51234"),
    true,
  );
  assert.equal(
    isTunnelConnectionRegistered("2026-11-14 INF | https://bright-panda-42.trycloudflare.com |"),
    false,
  );

  assert.equal(
    isDirectLoopbackRequest({ socket: { remoteAddress: "127.0.0.1" }, headers: { host: "127.0.0.1:43310" } }),
    true,
  );
  assert.equal(
    isDirectLoopbackRequest({ socket: { remoteAddress: "::1" }, headers: { host: "localhost:43310" } }),
    true,
  );
  assert.equal(
    isDirectLoopbackRequest({ socket: { remoteAddress: "::ffff:127.0.0.1" }, headers: { host: "[::1]:43310" } }),
    true,
  );
  assert.equal(
    isDirectLoopbackRequest({ socket: { remoteAddress: "127.0.0.1" }, headers: { host: "evil-rebind.example.com" } }),
    false,
  );
  assert.equal(
    isDirectLoopbackRequest({
      socket: { remoteAddress: "127.0.0.1" },
      headers: { host: "127.0.0.1:43310", "Cf-Connecting-Ip": "203.0.113.42" },
    }),
    false,
  );
  assert.equal(
    isDirectLoopbackRequest({
      socket: { remoteAddress: "127.0.0.1" },
      headers: { host: "127.0.0.1:43310", "X-Forwarded-For": "198.51.100.2" },
    }),
    false,
  );

  // Explicit nonexistent CLOUDFLARED_BIN must NOT fall back to system /opt/homebrew/bin/cloudflared.
  assert.equal(resolveCloudflaredExecutable({ CLOUDFLARED_BIN: "/nonexistent/cloudflared-missing" }), null);
  assert.equal(resolveCloudflaredExecutable({ CLOUDFLARED_BIN: MOCK_CLOUDFLARED_BIN }), MOCK_CLOUDFLARED_BIN);
});

test("Quick Tunnel end-to-end: gateway auth, DNS-rebinding block, /health redaction, SSE, rotate & stop", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-quick-tunnel-"));
  const dataDir = resolve(root, "data");
  await mkdir(dataDir, { recursive: true });

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    dataDir,
    env: {
      ...process.env,
      CODEX_BIN: MOCK_CODEX_BIN,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
      AGY_BIN: MOCK_AGY_BIN,
      CLOUDFLARED_BIN: MOCK_CLOUDFLARED_BIN,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: resolve(root, "codex") }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: resolve(root, "claude") }]),
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "cli", label: "Antigravity CLI", home: resolve(root, "agy"), profileType: "cli" }]),
    },
  });
  await srv.start();
  t.after(async () => {
    await srv.close();
    await rm(root, { recursive: true, force: true });
  });

  // 1. Direct loopback works without auth.
  const localThreads = await fetch(`${srv.url}/api/threads`);
  assert.equal(localThreads.status, 200);
  const localHealth = await fetch(`${srv.url}/health`);
  assert.equal(localHealth.status, 200);
  const localHealthJson = await localHealth.json();
  assert.equal(localHealthJson.instanceId, srv.identity.instanceId);

  // DNS rebinding Host rejected even from 127.0.0.1 socket.
  const rebindRes = await rawHttpGet(srv.url, "/api/threads", { Host: "evil-rebind.example.com" });
  assert.equal(rebindRes.status, 401);

  // 2. Start quick tunnel from loopback console.
  const startRes = await fetch(`${srv.url}/api/tunnel/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(startRes.status, 200);
  const startData = await startRes.json();
  assert.equal(startData.state, "running");
  assert.match(startData.publicUrl, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.match(startData.pairUrl, /\/connect\/[A-Za-z0-9_-]+$/);
  assert.match(startData.qrDataUrl, /^data:image\/png;base64,/);

  const tunnelUrl = startData.publicUrl;

  // 3. Unauthenticated tunnel requests blocked / redacted.
  const unauthHtml = await fetch(`${tunnelUrl}/`, { headers: { Accept: "text/html" } });
  assert.equal(unauthHtml.status, 401);
  assert.match(await unauthHtml.text(), /本地鉴权网关/);

  const unauthApi = await fetch(`${tunnelUrl}/api/threads`);
  assert.equal(unauthApi.status, 401);
  const unauthApiJson = await unauthApi.json();
  assert.equal(unauthApiJson.error.code, "unauthorized");

  const spoofBridge = await fetch(`${tunnelUrl}/api/threads`, {
    headers: { "X-AC-Bridge-Token": "forged-token" },
  });
  assert.equal(spoofBridge.status, 401);

  const tunHealth = await fetch(`${tunnelUrl}/health`);
  assert.equal(tunHealth.status, 200);
  const tunHealthJson = await tunHealth.json();
  assert.deepEqual(tunHealthJson, { ok: true, service: "agent-control", authRequired: true });
  assert.equal("instanceId" in tunHealthJson, false);
  assert.equal("pairUrl" in tunHealthJson, false);

  const badConnect = await fetch(`${tunnelUrl}/connect/wrong-token`, { redirect: "manual" });
  assert.equal(badConnect.status, 403);

  // 4. Scan pairing URL -> 302 redirect + HttpOnly SameSite=Lax cookie.
  const connectRes = await fetch(startData.pairUrl, { redirect: "manual" });
  assert.equal(connectRes.status, 302);
  assert.equal(connectRes.headers.get("location"), "/");
  const setCookie = connectRes.headers.get("set-cookie") || "";
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  const cookieHeader = setCookie.split(";")[0];

  // 5. Authenticated tunnel access succeeds, but remote management & secrets stay blocked.
  const authedHome = await fetch(`${tunnelUrl}/`, { headers: { Cookie: cookieHeader } });
  assert.equal(authedHome.status, 200);
  assert.match(await authedHome.text(), /RemoteDeck/);

  const authedThreads = await fetch(`${tunnelUrl}/api/threads`, { headers: { Cookie: cookieHeader } });
  assert.equal(authedThreads.status, 200);
  const authedThreadsJson = await authedThreads.json();
  assert.ok(Array.isArray(authedThreadsJson.threads));

  const sseAbort = new AbortController();
  const sseRes = await fetch(`${tunnelUrl}/api/events`, {
    headers: { Cookie: cookieHeader, Accept: "text/event-stream" },
    signal: sseAbort.signal,
  });
  assert.equal(sseRes.status, 200);
  const sseReader = sseRes.body.getReader();
  const sseDecoder = new TextDecoder();
  let sseText = "";
  let readyMatch = null;
  while (!(readyMatch = sseText.match(/event: ready\r?\ndata: ([^\r\n]+)\r?\n\r?\n/))) {
    const chunk = await sseReader.read();
    if (chunk.done) break;
    sseText += sseDecoder.decode(chunk.value, { stream: true });
  }
  assert.match(sseText, /event: ready/);
  assert.ok(readyMatch, "expected complete SSE ready event frame");
  const readyPayload = JSON.parse(readyMatch[1].trim());
  assert.equal(readyPayload.tunnel.pairUrl, "");
  assert.equal(readyPayload.remote.pairUrl, "");
  sseAbort.abort();
  await sseReader.cancel().catch(() => {});

  const remoteTunnelStatus = await (await fetch(`${tunnelUrl}/api/tunnel`, { headers: { Cookie: cookieHeader } })).json();
  assert.equal(remoteTunnelStatus.canManage, false);
  assert.equal(remoteTunnelStatus.pairUrl, "");
  assert.equal("qrDataUrl" in remoteTunnelStatus, false);

  const remoteRelayStatus = await (await fetch(`${tunnelUrl}/api/remote`, { headers: { Cookie: cookieHeader } })).json();
  assert.equal(remoteRelayStatus.canManage, false);
  assert.equal(remoteRelayStatus.pairUrl, "");

  for (const forbiddenPath of ["/api/tunnel/rotate", "/api/tunnel/stop", "/api/remote/pair"]) {
    const forbiddenRes = await fetch(`${tunnelUrl}${forbiddenPath}`, {
      method: "POST",
      headers: { Cookie: cookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(forbiddenRes.status, 403, `${forbiddenPath} must be 403 via tunnel`);
  }

  // 6. Rotate on Mac invalidates old mobile session immediately.
  const rotateRes = await fetch(`${srv.url}/api/tunnel/rotate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(rotateRes.status, 200);
  const rotateData = await rotateRes.json();
  assert.notEqual(rotateData.pairUrl, startData.pairUrl);
  assert.match(rotateData.qrDataUrl, /^data:image\/png;base64,/);

  const revokedThreads = await fetch(`${tunnelUrl}/api/threads`, { headers: { Cookie: cookieHeader } });
  assert.equal(revokedThreads.status, 401);

  // Re-pair with rotated URL -> 200 again.
  const reconnectRes = await fetch(rotateData.pairUrl, { redirect: "manual" });
  assert.equal(reconnectRes.status, 302);
  const newCookie = (reconnectRes.headers.get("set-cookie") || "").split(";")[0];
  const reauthedThreads = await fetch(`${tunnelUrl}/api/threads`, { headers: { Cookie: newCookie } });
  assert.equal(reauthedThreads.status, 200);

  // 7. Stop tunnel on Mac stops child proxy and revokes sessions.
  const stopRes = await fetch(`${srv.url}/api/tunnel/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(stopRes.status, 200);
  const stopData = await stopRes.json();
  assert.equal(stopData.state, "stopped");
  assert.equal(stopData.publicUrl, "");
  assert.equal(srv.tunnelAuth.isAuthenticatedRequest({
    headers: { cookie: newCookie },
  }), false);
});

test("Quick Tunnel missing binary returns clean diagnostic without falling back", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-tunnel-missing-"));
  const dataDir = resolve(root, "data");
  await mkdir(dataDir, { recursive: true });

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    dataDir,
    env: {
      ...process.env,
      CODEX_BIN: MOCK_CODEX_BIN,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
      AGY_BIN: MOCK_AGY_BIN,
      CLOUDFLARED_BIN: "/nonexistent/cloudflared-binary",
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: resolve(root, "codex") }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: resolve(root, "claude") }]),
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "cli", label: "Antigravity CLI", home: resolve(root, "agy"), profileType: "cli" }]),
    },
  });
  await srv.start();
  t.after(async () => {
    await srv.close();
    await rm(root, { recursive: true, force: true });
  });

  const statusJson = await (await fetch(`${srv.url}/api/tunnel`)).json();
  assert.equal(statusJson.installed, false);
  assert.equal(statusJson.canManage, true);

  const startRes = await fetch(`${srv.url}/api/tunnel/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(startRes.status, 400);
  const startErr = await startRes.json();
  assert.equal(startErr.error.code, "cloudflared_missing");
  assert.match(startErr.error.message, /brew install cloudflared/);
});

test("RemoteBridge remains authorized via internal bridge token even when X-Forwarded-For / Cf-Connecting-Ip headers exist", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-relay-xff-"));
  const dataDir = resolve(root, "data");
  await mkdir(dataDir, { recursive: true });

  const relay = createRelayServer({
    port: 0,
    relayKey: "xff-test-relay-key",
    dataPath: resolve(root, "relay-state.json"),
  });
  await relay.start();

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: false,
    disableTunnel: true,
    dataDir,
    env: {
      ...process.env,
      CODEX_BIN: MOCK_CODEX_BIN,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: resolve(root, "codex") }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: resolve(root, "claude") }]),
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "cli", label: "Antigravity CLI", home: resolve(root, "agy"), profileType: "cli" }]),
    },
  });
  await srv.start();
  t.after(async () => {
    await srv.close();
    await relay.close();
    await rm(root, { recursive: true, force: true });
  });

  const inviteRes = await fetch(`${relay.url}/admin/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Relay-Key": "xff-test-relay-key" },
    body: JSON.stringify({ label: "XFF Mac" }),
  });
  const { inviteCode } = await inviteRes.json();

  const pairRes = await fetch(`${srv.url}/api/remote/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relayUrl: relay.url, inviteCode, label: "XFF Mac" }),
  });
  const pairData = await pairRes.json();

  await waitFor(async () => {
    const s = await (await fetch(`${srv.url}/api/remote`)).json();
    return s.connected ? s : null;
  });

  const connectRes = await fetch(pairData.pairUrl, { redirect: "manual" });
  assert.equal(connectRes.status, 302);
  const cookieHeader = (connectRes.headers.get("set-cookie") || "").split(";")[0];

  const proxiedProviders = await fetch(`${relay.url}/i/${srv.identity.instanceId}/api/providers`, {
    headers: {
      Cookie: cookieHeader,
      "X-Forwarded-For": "198.51.100.7",
      "Cf-Connecting-Ip": "198.51.100.7",
    },
  });
  assert.equal(proxiedProviders.status, 200);
  const proxiedJson = await proxiedProviders.json();
  assert.equal(proxiedJson.providers.length, 5);
});

test("Fixed URL pairing (Cloudflare Named Tunnel) and Tailscale Funnel endpoints enforce gateway security", async (t) => {
  assert.equal(normalizeFixedPublicUrl("https://agent.example.com/"), "https://agent.example.com");
  assert.throws(() => normalizeFixedPublicUrl("ftp://agent.example.com"), /https/);
  assert.throws(() => normalizeFixedPublicUrl("https://user:pass@agent.example.com"), /账号密码/);
  assert.deepEqual(
    parseTailscaleStatusJson(JSON.stringify({ BackendState: "Running", Self: { DNSName: "demo-mac.tailnet.ts.net.", Online: true } })),
    { backendState: "Running", dnsName: "demo-mac.tailnet.ts.net", online: true },
  );
  assert.equal(resolveTailscaleExecutable({ TAILSCALE_BIN: "/nonexistent/tailscale-missing" }), null);

  const root = await mkdtemp(resolve(os.tmpdir(), "ac-fixed-tunnel-"));
  const dataDir = resolve(root, "data");
  await mkdir(dataDir, { recursive: true });
  const mockTailscale = resolve(root, "mock-tailscale.mjs");
  const stateFile = resolve(root, "ts-funnel.txt");
  await writeFile(mockTailscale, `#!/usr/bin/env node
import { existsSync, rmSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
const statePath = ${JSON.stringify(stateFile)};
if (args[0] === "status" && args[1] === "--json") {
  process.stdout.write(JSON.stringify({ BackendState: "Running", Self: { DNSName: "demo-mac.tailnet.ts.net.", Online: true } }));
  process.exit(0);
}
if (args[0] === "funnel" && args[1] === "status") {
  process.stdout.write(existsSync(statePath) ? '{"AllowFunnel":{"demo-mac.tailnet.ts.net:443":true}}' : "{}");
  process.exit(0);
}
if (args[0] === "funnel" && args[1] === "--bg") {
  writeFileSync(statePath, args[2] || "43310", "utf8");
  process.exit(0);
}
if (args[0] === "funnel" && args.includes("off")) {
  rmSync(statePath, { force: true });
  process.exit(0);
}
`, "utf8");
  await chmod(mockTailscale, 0o755);

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    dataDir,
    env: {
      ...process.env,
      CODEX_BIN: MOCK_CODEX_BIN,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
      AGY_BIN: MOCK_AGY_BIN,
      CLOUDFLARED_BIN: "/nonexistent/cloudflared",
      TAILSCALE_BIN: mockTailscale,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: resolve(root, "codex") }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: resolve(root, "claude") }]),
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "cli", label: "Antigravity CLI", home: resolve(root, "agy"), profileType: "cli" }]),
    },
  });
  await srv.start();
  t.after(async () => {
    await srv.close();
    await rm(root, { recursive: true, force: true });
  });

  // 1. Named Tunnel fixed URL pairing generates QR & pairUrl gated by local loopback.
  const remoteUnauthAttempt = await rawHttpGet(srv.url, "/api/tunnel/fixed-pair", {
    Host: "agent.example.com",
    "X-Forwarded-For": "203.0.113.10",
  });
  assert.equal(remoteUnauthAttempt.status, 401);

  const fixedRes = await fetch(`${srv.url}/api/tunnel/fixed-pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ publicUrl: "https://agent.example.com/" }),
  });
  assert.equal(fixedRes.status, 200);
  const fixedJson = await fixedRes.json();
  assert.equal(fixedJson.fixedPublicUrl, "https://agent.example.com");
  assert.match(fixedJson.pairUrl, /^https:\/\/agent\.example\.com\/connect\/[A-Za-z0-9_-]+$/);
  assert.match(fixedJson.qrDataUrl, /^data:image\/png;base64,/);

  // Remote requests are blocked without cookie, allowed after redeeming /connect/<token>.
  const blockedNamed = await rawHttpGet(srv.url, "/api/providers", {
    Host: "agent.example.com",
    "X-Forwarded-Proto": "https",
    "X-Forwarded-For": "203.0.113.10",
  });
  assert.equal(blockedNamed.status, 401);

  const connectPath = new URL(fixedJson.pairUrl).pathname;
  const pairedNamed = await rawHttpGet(srv.url, connectPath, {
    Host: "agent.example.com",
    "X-Forwarded-Proto": "https",
    "X-Forwarded-For": "203.0.113.10",
  });
  assert.equal(pairedNamed.status, 302);
  const cookieHeader = String(pairedNamed.headers["set-cookie"]?.[0] || "").split(";")[0];
  assert.match(cookieHeader, /^ac_tunnel_/);

  const authedNamed = await rawHttpGet(srv.url, "/api/providers", {
    Host: "agent.example.com",
    "X-Forwarded-Proto": "https",
    "X-Forwarded-For": "203.0.113.10",
    Cookie: cookieHeader,
  });
  assert.equal(authedNamed.status, 200);

  // Paired remote browsers still cannot mutate fixed-tunnel or Tailscale settings (403).
  const remoteManageForbidden = await fetch(`${srv.url}/api/tunnel/fixed-pair`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Host: "agent.example.com",
      "X-Forwarded-For": "203.0.113.10",
      Cookie: cookieHeader,
    },
    body: JSON.stringify({ publicUrl: "https://attacker.example.com" }),
  });
  assert.equal(remoteManageForbidden.status, 403);

  // 2. Tailscale Funnel start & stop updates fixedPublicUrl and revokes old session cookie.
  const tsStartRes = await fetch(`${srv.url}/api/tunnel/tailscale/start`, { method: "POST", body: "{}" });
  assert.equal(tsStartRes.status, 200);
  const tsStart = await tsStartRes.json();
  assert.equal(tsStart.installed, true);
  assert.equal(tsStart.active, true);
  assert.equal(tsStart.fixedPublicUrl, "https://demo-mac.tailnet.ts.net");
  assert.match(tsStart.pairUrl, /^https:\/\/demo-mac\.tailnet\.ts\.net\/connect\//);

  const tsStopRes = await fetch(`${srv.url}/api/tunnel/tailscale/stop`, { method: "POST", body: "{}" });
  assert.equal(tsStopRes.status, 200);
  const tsStop = await tsStopRes.json();
  assert.equal(tsStop.active, false);
  assert.equal(tsStop.fixedPublicUrl, "");

  const revokedNamed = await rawHttpGet(srv.url, "/api/providers", {
    Host: "demo-mac.tailnet.ts.net",
    "X-Forwarded-Proto": "https",
    "X-Forwarded-For": "203.0.113.10",
    Cookie: cookieHeader,
  });
  assert.equal(revokedNamed.status, 401);
});
