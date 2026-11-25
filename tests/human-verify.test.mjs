import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { HumanVerifyManager, isLoopbackRefreshUrl } from "../src/human-verify.mjs";
import { createAgentControlServer } from "../src/server.mjs";

const MOCK_CODEX_BIN = fileURLToPath(new URL("./helpers/mock-codex-cli.mjs", import.meta.url));
const MOCK_CLAUDE_BIN = fileURLToPath(new URL("./helpers/mock-claude-cli.mjs", import.meta.url));
const MOCK_AGY_BIN = fileURLToPath(new URL("./helpers/mock-agy-cli.mjs", import.meta.url));

function waitFor(predicate, timeoutMs = 6_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveWait, rejectWait) => {
    const check = () => {
      const val = predicate();
      if (val) return resolveWait(val);
      if (Date.now() > deadline) return rejectWait(new Error("等待条件超时"));
      setTimeout(check, 20);
    };
    check();
  });
}

async function openSseReader(url) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  assert.equal(response.status, 200);
  const events = [];
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const pump = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        while (true) {
          const sep = buffer.indexOf("\n\n");
          if (sep < 0) break;
          const block = buffer.slice(0, sep);
          buffer = buffer.slice(sep + 2);
          let eventName = "message";
          let dataRaw = "";
          for (const line of block.split("\n")) {
            if (line.startsWith("event:")) eventName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataRaw += line.slice(5).trim();
          }
          if (dataRaw) {
            try {
              events.push({ event: eventName, data: JSON.parse(dataRaw) });
            } catch {}
          }
        }
      }
    } catch {}
  })();

  return {
    events,
    close() {
      controller.abort();
      return pump;
    },
  };
}

async function createTestServer(t, extraOpts = {}) {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-hv-test-"));
  const dataDir = resolve(root, "data");
  const codexHome = resolve(root, "codex");
  const claudeDir = resolve(root, "claude");
  const agyDir = resolve(root, "agy");
  const grokDir = resolve(root, "grok");
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(codexHome, { recursive: true }),
    mkdir(claudeDir, { recursive: true }),
    mkdir(resolve(claudeDir, "projects"), { recursive: true }),
    mkdir(agyDir, { recursive: true }),
    mkdir(grokDir, { recursive: true }),
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    disableTunnel: true,
    disableUpdateCheck: true,
    disableTelemetry: true,
    dataDir,
    env: {
      ...process.env,
      CODEX_BIN: MOCK_CODEX_BIN,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_DISABLE_AUTOMATIONS: "1",
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: codexHome }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: claudeDir }]),
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "cli", label: "Antigravity CLI", home: agyDir, profileType: "cli" }]),
      AGENT_CONTROL_GROK_HOMES: JSON.stringify([{ id: "default", label: "Grok 默认", home: grokDir }]),
    },
    humanVerifyOptions: { disableNativeHud: true },
    ...extraOpts,
  });
  await srv.start();
  t.after(() => srv.close());
  return { root, dataDir, srv };
}

test("HumanVerifyManager rejects non-loopback refreshUrl and kills spawned native HUD on submit/cancel", async (t) => {
  assert.equal(isLoopbackRefreshUrl("http://127.0.0.1:43320/captcha"), true);
  assert.equal(isLoopbackRefreshUrl("http://localhost:8080/cap"), true);
  assert.equal(isLoopbackRefreshUrl("https://evil.example.com/cap"), false);
  assert.equal(isLoopbackRefreshUrl("http://192.168.1.2/cap"), false);

  const tmp = await mkdtemp(resolve(os.tmpdir(), "ac-hv-unit-"));
  const fakeBin = resolve(tmp, "ac-verify-hud");
  await writeFile(fakeBin, "#!/bin/sh\n", "utf8");
  t.after(() => rm(tmp, { recursive: true, force: true }));

  const spawned = [];
  const mgr = new HumanVerifyManager({
    dataDir: tmp,
    platform: "darwin",
    nativeHudBinPath: fakeBin,
    spawnImpl(bin, args) {
      const child = new EventEmitter();
      child.bin = bin;
      child.args = args;
      child.signals = [];
      child.killed = false;
      child.kill = (sig) => {
        child.signals.push(sig);
        child.killed = true;
      };
      spawned.push(child);
      return child;
    },
  });
  mgr.setTargetOrigin("http://127.0.0.1:43310");

  await assert.rejects(
    () => mgr.create({ title: "bad", refreshUrl: "https://evil.example.com/refresh" }),
    /回环/,
  );

  const created = await mgr.create({
    title: "测试验证码",
    fields: [{ name: "code", label: "验证码", type: "text", required: true }],
    meta: { uuid: "u1" },
  });
  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].args, ["--url", "http://127.0.0.1:43310", "--id", created.item.id]);

  const cancelled = mgr.cancel(created.item.id, { reason: "cancelled", submittedBy: "web" });
  assert.equal(cancelled.ok, true);
  assert.deepEqual(spawned[0].signals, ["SIGTERM"]);
  const outcome = await created.wait();
  assert.equal(outcome.ok, false);
  assert.equal(outcome.status, "cancelled");
  mgr.close();
});

test("Server HTTP + SSE supports long-poll submit, refresh, cancel, and client disconnect without leaking secrets", async (t) => {
  // Tiny loopback captcha mock server
  let refreshCount = 0;
  const mockCapServer = http.createServer((req, res) => {
    refreshCount += 1;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        ok: true,
        captcha: {
          uuid: `uuid_${refreshCount}`,
          img: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        },
      }),
    );
  });
  await new Promise((resolveListen) => mockCapServer.listen(0, "127.0.0.1", resolveListen));
  const capPort = mockCapServer.address().port;
  t.after(() => new Promise((resolveClose) => mockCapServer.close(resolveClose)));

  const { srv } = await createTestServer(t);
  const sse = await openSseReader(`${srv.url}/api/events`);
  t.after(() => sse.close());
  await waitFor(() => sse.events.find((e) => e.event === "ready"));

  // 1. Long-poll create + refresh + submit
  const waitReqPromise = fetch(`${srv.url}/api/human-verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "示例后台验证",
      subtitle: "输入结果",
      source: "测试脚本",
      imageDataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      refreshUrl: `http://127.0.0.1:${capPort}/captcha`,
      meta: { uuid: "uuid_0" },
      fields: [
        { name: "code", label: "验证码", type: "text", required: true },
        { name: "password", label: "密码", type: "password", required: true },
      ],
      wait: true,
    }),
  }).then((r) => r.json());

  const createdEvt = await waitFor(() => sse.events.find((e) => e.event === "human_verify_created"));
  const hvId = createdEvt.data.id;
  assert.equal(createdEvt.data.canRefresh, true);
  assert.equal(createdEvt.data.refreshUrl, undefined);

  // Refresh updates image & uuid
  const refRes = await fetch(`${srv.url}/api/human-verify/${hvId}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).then((r) => r.json());
  assert.equal(refRes.ok, true);
  assert.equal(refRes.item.meta.uuid, "uuid_1");
  await waitFor(() => sse.events.find((e) => e.event === "human_verify_updated" && e.data.meta?.uuid === "uuid_1"));

  // Submit with password & verify SSE does NOT leak secrets
  const subRes = await fetch(`${srv.url}/api/human-verify/${hvId}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      values: { code: " 42 ", password: "super-secret-password" },
      submittedBy: "macos-hud",
    }),
  }).then((r) => r.json());
  assert.equal(subRes.ok, true);

  const callerOutcome = await waitReqPromise;
  assert.equal(callerOutcome.ok, true);
  assert.equal(callerOutcome.value, "42");
  assert.deepEqual(callerOutcome.values, { code: "42", password: "super-secret-password" });
  assert.equal(callerOutcome.meta.uuid, "uuid_1");

  const resolvedEvt = await waitFor(() => sse.events.find((e) => e.event === "human_verify_resolved" && e.data.id === hvId));
  assert.equal(resolvedEvt.data.status, "submitted");
  assert.equal(JSON.stringify(sse.events).includes("super-secret-password"), false);

  // 2. Client disconnect auto-cancels pending challenge
  const abortCtrl = new AbortController();
  const pendingDisconnect = fetch(`${srv.url}/api/human-verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: abortCtrl.signal,
    body: JSON.stringify({ title: "断连自动取消测试", wait: true }),
  }).catch(() => {});

  const createdEvt2 = await waitFor(() =>
    sse.events.find((e) => e.event === "human_verify_created" && e.data.title === "断连自动取消测试"),
  );
  abortCtrl.abort();
  await pendingDisconnect;
  const resolvedEvt2 = await waitFor(() =>
    sse.events.find((e) => e.event === "human_verify_resolved" && e.data.id === createdEvt2.data.id),
  );
  assert.equal(resolvedEvt2.data.status, "disconnected");

  const listAfter = await fetch(`${srv.url}/api/human-verify`).then((r) => r.json());
  assert.deepEqual(listAfter.items, []);
});

test("Server blocks remote creation (403) when auth required while permitting authorized submit", async (t) => {
  const { srv } = await createTestServer(t, { requireAuth: true });
  const sessionToken = await srv.tunnelAuth.redeemConnectToken(srv.tunnelAuth.browserToken);
  assert.ok(sessionToken);
  const authHeaders = {
    "Content-Type": "application/json",
    Cookie: `${srv.tunnelAuth.cookieName()}=${encodeURIComponent(sessionToken)}`,
  };

  // Authenticated remote client without local manage permission gets 403 on create
  const blockedCreate = await fetch(`${srv.url}/api/human-verify`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ title: "should block" }),
  });
  assert.equal(blockedCreate.status, 403);

  // Authorized remote client CAN submit a challenge created by local host
  const created = await srv.humanVerify.create({ title: "远端提交测试", wait: false });
  const subRes = await fetch(`${srv.url}/api/human-verify/${created.item.id}/submit`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ value: "88" }),
  }).then((r) => r.json());
  assert.equal(subRes.ok, true);
  const outcome = await created.wait();
  assert.equal(outcome.ok, true);
  assert.equal(outcome.value, "88");
  assert.equal(outcome.submittedBy, "remote");
});
