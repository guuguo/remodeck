import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { createAgentControlServer } from "../src/server.mjs";

const MOCK_CODEX_BIN = fileURLToPath(new URL("./helpers/mock-codex-cli.mjs", import.meta.url));
const MOCK_CLAUDE_BIN = fileURLToPath(new URL("./helpers/mock-claude-cli.mjs", import.meta.url));
const MOCK_AGY_BIN = fileURLToPath(new URL("./helpers/mock-agy-cli.mjs", import.meta.url));

function waitFor(predicate, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveWait, rejectWait) => {
    const check = () => {
      const val = predicate();
      if (val) return resolveWait(val);
      if (Date.now() > deadline) return rejectWait(new Error("等待条件超时"));
      setTimeout(check, 25);
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
    } catch {
      // Aborted on cleanup.
    }
  })();

  return {
    events,
    close() {
      controller.abort();
      return pump;
    },
  };
}

async function jsonReq(baseUrl, path, { method = "GET", body } = {}) {
  const res = await fetch(new URL(path, baseUrl), {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  return { status: res.status, data };
}

test("Hub + HTTP/SSE control server coordinates Codex, Claude, and Antigravity end-to-end", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-hub-test-"));
  const dataDir = resolve(root, "data");
  const codexHome = resolve(root, "codex");
  const claudeDir = resolve(root, "claude");
  const agyDir = resolve(root, "agy-cli");
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
    dataDir,
    env: {
      ...process.env,
      CODEX_BIN: MOCK_CODEX_BIN,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: codexHome }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: claudeDir }]),
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "cli", label: "Antigravity CLI", home: agyDir, profileType: "cli" }]),
      AGENT_CONTROL_GROK_HOMES: JSON.stringify([{ id: "default", label: "Grok 默认", home: grokDir }]),
    },
  });
  await srv.start();
  t.after(() => srv.close());

  const sse = await openSseReader(`${srv.url}/api/events`);
  t.after(() => sse.close());
  await waitFor(() => sse.events.find((e) => e.event === "ready"));

  // Health & providers & models & threads.
  const health = await jsonReq(srv.url, "/health");
  assert.equal(health.status, 200);
  assert.equal(health.data.providers.length, 5);

  const models = await jsonReq(srv.url, "/api/models");
  assert.equal(models.status, 200);
  assert.ok(models.data.byProvider.codex.length >= 1);
  assert.ok(models.data.byProvider.claude.length >= 1);
  assert.ok(models.data.byProvider.antigravity.length >= 1);
  assert.ok(models.data.byProvider.grok.length >= 1);

  const quotas = await jsonReq(srv.url, "/api/quotas");
  assert.equal(quotas.status, 200);
  assert.ok(Array.isArray(quotas.data.quotas));
  assert.equal(typeof quotas.data.updatedAt, "number");
  assert.ok(quotas.data.byKey["grok:default"]);

  const telemetry = await jsonReq(srv.url, "/api/telemetry");
  assert.equal(telemetry.status, 200);
  assert.equal(typeof telemetry.data.updatedAt, "number");
  assert.ok(telemetry.data.byProvider.codex);
  assert.ok(telemetry.data.byProvider.claude);
  assert.ok(telemetry.data.byProvider.antigravity);
  assert.ok(telemetry.data.byProvider.grok);

  const threadsRes = await jsonReq(srv.url, "/api/threads");
  assert.equal(threadsRes.status, 200);
  assert.ok(threadsRes.data.threads.some((th) => th.provider === "codex"));
  assert.ok(threadsRes.data.threads.some((th) => th.provider === "antigravity"));

  // Cross-provider collision-free approvals & AskUserQuestion.
  const codexNew = await jsonReq(srv.url, "/api/thread/new", {
    method: "POST",
    body: { provider: "codex", profileId: "default", cwd: root, text: "Codex [REQUEST_APPROVAL]" },
  });
  assert.equal(codexNew.status, 200);

  const claudeNew = await jsonReq(srv.url, "/api/thread/new", {
    method: "POST",
    body: { provider: "claude", profileId: "default", cwd: root, text: "Claude [ASK_USER]" },
  });
  assert.equal(claudeNew.status, 200);

  const agyNew = await jsonReq(srv.url, "/api/thread/new", {
    method: "POST",
    body: { provider: "antigravity", profileId: "cli", cwd: root, text: "Agy [AGY_PERMISSION]" },
  });
  assert.equal(agyNew.status, 200);

  const reqCodex = await waitFor(() =>
    sse.events.find((e) => e.event === "server_request" && e.data.request.provider === "codex")?.data.request,
  );
  const reqClaude = await waitFor(() =>
    sse.events.find((e) => e.event === "server_request" && e.data.request.provider === "claude")?.data.request,
  );
  const reqAgy = await waitFor(() =>
    sse.events.find((e) => e.event === "server_request" && e.data.request.provider === "antigravity")?.data.request,
  );

  // Answer all 3 simultaneously without collisions.
  assert.equal((await jsonReq(srv.url, "/api/approval", {
    method: "POST",
    body: { requestId: reqCodex.id, decision: "accept" },
  })).status, 200);
  assert.equal((await jsonReq(srv.url, "/api/server-request", {
    method: "POST",
    body: {
      requestId: reqClaude.id,
      decision: "accept",
      answers: { [reqClaude.questions[0].id]: { answers: ["集成测试"] } },
    },
  })).status, 200);
  assert.equal((await jsonReq(srv.url, "/api/server-request", {
    method: "POST",
    body: { requestId: reqAgy.id, optionId: "allow_once" },
  })).status, 200);

  await waitFor(() =>
    sse.events.filter((e) => e.event === "server_request_resolved").length >= 3,
  );

  // /goal auto-continuation loop on Claude Code: [GOAL_TWO_STEPS] triggers turn 1 -> auto turn 2 -> completed!
  const goalRes = await jsonReq(srv.url, "/api/thread/new", {
    method: "POST",
    body: {
      provider: "claude",
      profileId: "default",
      cwd: root,
      text: "/goal 测试两轮自动完成 [GOAL_TWO_STEPS]",
      goalMode: true,
    },
  });
  assert.equal(goalRes.status, 200);
  const goalThreadId = goalRes.data.thread.id;
  const completedGoal = await waitFor(() =>
    sse.events.find((e) =>
      e.event === "goal_state"
      && e.data.threadId === goalThreadId
      && e.data.goalState?.status === "completed",
    ),
    10_000,
  );
  assert.equal(completedGoal.data.goalState.turnCount, 2);

  // Queue + Cancel + Auto-drain after interrupting slow turn.
  const slowTurn = await jsonReq(srv.url, "/api/turn", {
    method: "POST",
    body: { threadId: agyNew.data.thread.id, text: "长任务 [SLOW]" },
  });
  assert.equal(slowTurn.status, 200);

  const q1 = await jsonReq(srv.url, "/api/thread/queue", {
    method: "POST",
    body: { threadId: agyNew.data.thread.id, text: "要被取消的排队" },
  });
  const q2 = await jsonReq(srv.url, "/api/thread/queue", {
    method: "POST",
    body: { threadId: agyNew.data.thread.id, text: "继续完成排队消息" },
  });
  assert.equal(q2.data.items.length, 2);

  await jsonReq(srv.url, "/api/thread/queue/cancel", {
    method: "POST",
    body: { threadId: agyNew.data.thread.id, id: q1.data.entry.id },
  });
  const qList = await jsonReq(srv.url, `/api/thread/queue?id=${encodeURIComponent(agyNew.data.thread.id)}`);
  assert.equal(qList.data.items.length, 1);

  await jsonReq(srv.url, "/api/interrupt", {
    method: "POST",
    body: { threadId: agyNew.data.thread.id },
  });
  await waitFor(() =>
    sse.events.find((e) =>
      e.event === "queued_turn_event"
      && e.data.threadId === agyNew.data.thread.id
      && e.data.eventType === "started"
      && e.data.entry?.id === q2.data.entry.id,
    ),
  );

  // Non-intrusive rename and archive.
  await jsonReq(srv.url, "/api/thread/name", {
    method: "POST",
    body: { threadId: claudeNew.data.thread.id, name: "已重命名 Claude" },
  });
  await jsonReq(srv.url, "/api/thread/archive", {
    method: "POST",
    body: { threadId: claudeNew.data.thread.id, archived: true },
  });
  const archivedList = await jsonReq(srv.url, "/api/threads?archived=1");
  const foundArchived = archivedList.data.threads.find((th) => th.id === claudeNew.data.thread.id);
  assert.equal(foundArchived?.name, "已重命名 Claude");
  assert.equal(foundArchived?.title, "已重命名 Claude");
  assert.equal(foundArchived?.archived, true);
});

test("HTTP + SSE server summarizes initial title, updates drifted follow-ups, persists thread-meta.json, and locks manual renames", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-hub-title-"));
  let srv = null;
  let sse = null;
  t.after(async () => {
    await sse?.close().catch(() => {});
    await srv?.close().catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  const dataDir = resolve(root, "data");
  const codexHome = resolve(root, "codex");
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(codexHome, { recursive: true }),
  ]);

  srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    dataDir,
    env: {
      ...process.env,
      CODEX_BIN: MOCK_CODEX_BIN,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: codexHome }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: "[]",
      AGENT_CONTROL_AGY_APP_DATA_DIRS: "[]",
      AGENT_CONTROL_GROK_HOMES: "[]",
    },
  });
  await srv.start();
  sse = await openSseReader(`${srv.url}/api/events`);
  await waitFor(() => sse.events.find((e) => e.event === "ready"));

  const created = await jsonReq(srv.url, "/api/thread/new", {
    method: "POST",
    body: {
      provider: "codex",
      profileId: "default",
      cwd: root,
      text: "请帮我看一下 Claude 项目进度：要求给出各里程碑状态",
    },
  });
  assert.equal(created.status, 200);
  const threadId = created.data.thread.id;
  await waitFor(() =>
    sse.events.find((e) => e.event === "provider_event" && e.data.threadId === threadId && e.data.method === "turn/completed"),
  );

  // Follow-up turns do not auto-rename or overwrite upstream title.
  const contRes = await jsonReq(srv.url, "/api/turn", {
    method: "POST",
    body: { threadId, text: "继续" },
  });
  assert.equal(contRes.status, 200);
  await waitFor(() =>
    sse.events.filter((e) => e.event === "provider_event" && e.data.threadId === threadId && e.data.method === "turn/completed").length >= 2,
  );

  const driftRes = await jsonReq(srv.url, "/api/turn", {
    method: "POST",
    body: {
      threadId,
      text: "优化 Agent Control 的会话标题生成与更新逻辑：当会话后续实际执行的任务与初始标题（例如“Claude 项目进度查询”）发生偏离时，自动重新总结",
    },
  });
  assert.equal(driftRes.status, 200);

  const metaRaw = JSON.parse(await readFile(resolve(dataDir, "thread-meta.json"), "utf8"));
  assert.equal(metaRaw.threads?.[threadId]?.autoTitle || "", "");

  await waitFor(() =>
    sse.events.filter((e) => e.event === "provider_event" && e.data.threadId === threadId && e.data.method === "turn/completed").length >= 3,
  );

  // Manual rename overrides title across both /api/thread and /api/threads and stays fixed.
  const manualRes = await jsonReq(srv.url, "/api/thread/name", {
    method: "POST",
    body: { threadId, name: "手动固定会话标题" },
  });
  assert.equal(manualRes.status, 200);
  const detailAfterManual = await jsonReq(srv.url, `/api/thread?id=${encodeURIComponent(threadId)}`);
  assert.equal(detailAfterManual.data.thread.title, "手动固定会话标题");

  const driftAfterManual = await jsonReq(srv.url, "/api/turn", {
    method: "POST",
    body: { threadId, text: "修复语音通话断线重连失败的问题" },
  });
  assert.equal(driftAfterManual.status, 200);
  assert.equal(driftAfterManual.data.thread?.title, "手动固定会话标题");
  const listAfterManual = await jsonReq(srv.url, "/api/threads");
  assert.equal(listAfterManual.data.threads.find((th) => th.id === threadId)?.title, "手动固定会话标题");

  // Renaming by rawId (without provider:profileId prefix) resolves composite threadId cleanly.
  const rawId = threadId.split(":").slice(2).join(":");
  const rawRenameRes = await jsonReq(srv.url, "/api/thread/name", {
    method: "POST",
    body: { rawId, provider: "codex", name: "Agent 主动命名标题" },
  });
  assert.equal(rawRenameRes.status, 200);
  assert.equal(rawRenameRes.data.threadId, threadId);
  assert.equal(rawRenameRes.data.name, "Agent 主动命名标题");
  const detailAfterRaw = await jsonReq(srv.url, `/api/thread?id=${encodeURIComponent(threadId)}`);
  assert.equal(detailAfterRaw.data.thread.title, "Agent 主动命名标题");

  // Settings switch: default agentAutoTitle is true; disabling skips source:"agent" renames but keeps manual renames working.
  const defaultSettings = await jsonReq(srv.url, "/api/settings");
  assert.equal(defaultSettings.status, 200);
  assert.equal(defaultSettings.data.settings?.agentAutoTitle, true);

  const disableSettings = await jsonReq(srv.url, "/api/settings", {
    method: "POST",
    body: { agentAutoTitle: false },
  });
  assert.equal(disableSettings.status, 200);
  assert.equal(disableSettings.data.settings?.agentAutoTitle, false);

  const skippedAgentRename = await jsonReq(srv.url, "/api/thread/name", {
    method: "POST",
    body: { rawId, provider: "codex", source: "agent", name: "关闭后不应生效" },
  });
  assert.equal(skippedAgentRename.status, 200);
  assert.equal(skippedAgentRename.data.skipped, true);
  assert.equal(skippedAgentRename.data.reason, "agent_auto_title_disabled");
  const detailWhileDisabled = await jsonReq(srv.url, `/api/thread?id=${encodeURIComponent(threadId)}`);
  assert.equal(detailWhileDisabled.data.thread.title, "Agent 主动命名标题");

  const reenableSettings = await jsonReq(srv.url, "/api/settings", {
    method: "POST",
    body: { agentAutoTitle: true },
  });
  assert.equal(reenableSettings.status, 200);
  assert.equal(reenableSettings.data.settings?.agentAutoTitle, true);

  await waitFor(() =>
    sse.events.filter((e) => e.event === "provider_event" && e.data.threadId === threadId && e.data.method === "turn/completed").length >= 4,
  );
});

function rawGet(urlString, headers = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = http.get(urlString, { headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolvePromise({
          status: res.statusCode || 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
        });
      });
      res.on("error", rejectPromise);
    });
    req.on("error", rejectPromise);
  });
}

test("HTTP JSON ETag/304 negotiation, /api/threads internal-field slimming, and non-large Codex tail limit/cursor pagination", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-hub-traffic-"));
  const dataDir = resolve(root, "data");
  const codexHome = resolve(root, "codex");
  await Promise.all([mkdir(dataDir, { recursive: true }), mkdir(codexHome, { recursive: true })]);

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    dataDir,
    env: {
      ...process.env,
      CODEX_BIN: MOCK_CODEX_BIN,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: codexHome }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: "[]",
      AGENT_CONTROL_AGY_APP_DATA_DIRS: "[]",
      AGENT_CONTROL_GROK_HOMES: "[]",
    },
  });
  await srv.start();
  const sse = await openSseReader(`${srv.url}/api/events`);
  t.after(async () => {
    await sse.close().catch(() => {});
    await srv.close().catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });
  await waitFor(() => sse.events.find((e) => e.event === "ready"));

  // Build 4 completed turns in a small Codex thread so tail limit=2 & turn: cursor are exercised.
  const created = await jsonReq(srv.url, "/api/thread/new", {
    method: "POST",
    body: {
      provider: "codex",
      profileId: "default",
      cwd: root,
      text: "第一轮初始化消息",
    },
  });
  assert.equal(created.status, 200);
  const threadId = created.data.thread.id;
  await waitFor(() =>
    sse.events.filter((e) => e.event === "provider_event" && e.data.threadId === threadId && e.data.method === "turn/completed").length >= 1,
  );

  for (let i = 2; i <= 4; i += 1) {
    const turnRes = await jsonReq(srv.url, "/api/turn", {
      method: "POST",
      body: { threadId, text: `第${i}轮增量分页验证消息_` + "填充内容".repeat(40) },
    });
    assert.equal(turnRes.status, 200);
    await waitFor(() =>
      sse.events.filter((e) => e.event === "provider_event" && e.data.threadId === threadId && e.data.method === "turn/completed").length >= i,
    );
  }

  // 1) /api/threads strips heavy internal-only fields and supports ETag + 304
  const threads1 = await rawGet(`${srv.url}/api/threads?archived=0`, { "Accept-Encoding": "gzip" });
  assert.equal(threads1.status, 200);
  const threadsEtag = threads1.headers["etag"];
  assert.match(String(threadsEtag || ""), /^W\/"/);
  const threadsBody1 = threads1.headers["content-encoding"] === "gzip"
    ? gunzipSync(threads1.body).toString("utf8")
    : threads1.body.toString("utf8");
  const parsedThreads = JSON.parse(threadsBody1);
  assert.ok(parsedThreads.threads.length >= 1);
  const sampleRow = parsedThreads.threads.find((th) => th.id === threadId);
  assert.ok(sampleRow);
  assert.equal(Object.hasOwn(sampleRow, "rolloutPath"), false);
  assert.equal(Object.hasOwn(sampleRow, "gitInfo"), false);
  assert.equal(Object.hasOwn(sampleRow, "firstUserText"), false);
  assert.equal(Object.hasOwn(sampleRow, "lastUserText"), false);
  assert.equal(Object.hasOwn(sampleRow, "autoTitle"), false);

  const threads304 = await rawGet(`${srv.url}/api/threads?archived=0`, {
    "Accept-Encoding": "gzip",
    "If-None-Match": threadsEtag,
  });
  assert.equal(threads304.status, 304);
  assert.equal(threads304.body.length, 0);

  // 2) Non-large Codex thread slices to limit=2 and paginates backward via turn: cursor
  const tailRes = await rawGet(`${srv.url}/api/thread?id=${encodeURIComponent(threadId)}&limit=2`, {
    "Accept-Encoding": "gzip",
  });
  assert.equal(tailRes.status, 200);
  assert.equal(tailRes.headers["content-encoding"], "gzip");
  const tailEtag = tailRes.headers["etag"];
  assert.ok(tailEtag);
  const tailJson = JSON.parse(gunzipSync(tailRes.body).toString("utf8"));
  assert.equal(tailJson.thread.turns.length, 2);
  assert.match(String(tailJson.nextCursor || ""), /^turn:\d+$/);

  const olderRes = await rawGet(
    `${srv.url}/api/thread?id=${encodeURIComponent(threadId)}&cursor=${encodeURIComponent(tailJson.nextCursor)}&limit=2`,
    { "Accept-Encoding": "gzip" },
  );
  assert.equal(olderRes.status, 200);
  const olderBody = olderRes.headers["content-encoding"] === "gzip"
    ? gunzipSync(olderRes.body).toString("utf8")
    : olderRes.body.toString("utf8");
  const olderJson = JSON.parse(olderBody);
  assert.equal(olderJson.thread.turns.length, 2);
  assert.equal(olderJson.nextCursor, null);
  assert.notEqual(olderJson.thread.turns[0].id, tailJson.thread.turns[0].id);

  // 3) /api/thread and /api/thread/activity return 304 when unchanged and 200 on new turn
  const tail304 = await rawGet(`${srv.url}/api/thread?id=${encodeURIComponent(threadId)}&limit=2`, {
    "Accept-Encoding": "gzip",
    "If-None-Match": tailEtag,
  });
  assert.equal(tail304.status, 304);
  assert.equal(tail304.body.length, 0);

  const act1 = await rawGet(`${srv.url}/api/thread/activity?id=${encodeURIComponent(threadId)}`, {
    "Accept-Encoding": "gzip",
  });
  assert.equal(act1.status, 200);
  const actEtag = act1.headers["etag"];
  const act304 = await rawGet(`${srv.url}/api/thread/activity?id=${encodeURIComponent(threadId)}`, {
    "Accept-Encoding": "gzip",
    "If-None-Match": actEtag,
  });
  assert.equal(act304.status, 304);
  assert.equal(act304.body.length, 0);

  await jsonReq(srv.url, "/api/turn", {
    method: "POST",
    body: { threadId, text: "第5轮新消息触发ETag失效" },
  });
  await waitFor(() =>
    sse.events.filter((e) => e.event === "provider_event" && e.data.threadId === threadId && e.data.method === "turn/completed").length >= 5,
  );
  const tailAfterNewTurn = await rawGet(`${srv.url}/api/thread?id=${encodeURIComponent(threadId)}&limit=2`, {
    "Accept-Encoding": "gzip",
    "If-None-Match": tailEtag,
  });
  assert.equal(tailAfterNewTurn.status, 200);
  assert.notEqual(tailAfterNewTurn.headers["etag"], tailEtag);
});

test("POST /api/threads/archive batch-archives and unarchives cross-provider threads atomically with SSE events", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-hub-batch-arch-"));
  const dataDir = resolve(root, "data");
  const codexHome = resolve(root, "codex");
  const claudeDir = resolve(root, "claude");
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(codexHome, { recursive: true }),
    mkdir(resolve(claudeDir, "projects"), { recursive: true }),
  ]);

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    dataDir,
    env: {
      ...process.env,
      CODEX_BIN: MOCK_CODEX_BIN,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: codexHome }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", dir: claudeDir }]),
      AGENT_CONTROL_AGY_APP_DATA_DIRS: "[]",
      AGENT_CONTROL_GROK_HOMES: "[]",
    },
  });
  await srv.start();
  const sse = await openSseReader(`${srv.url}/api/events`);
  t.after(async () => {
    await sse.close().catch(() => {});
    await srv.close().catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });
  await waitFor(() => sse.events.find((e) => e.event === "ready"));

  const codexNew = await jsonReq(srv.url, "/api/thread/new", {
    method: "POST",
    body: { provider: "codex", profileId: "default", cwd: root, text: "Codex 派生子任务一" },
  });
  assert.equal(codexNew.status, 200);
  const claudeNew = await jsonReq(srv.url, "/api/thread/new", {
    method: "POST",
    body: { provider: "claude", profileId: "default", cwd: root, text: "Claude 派生子任务二" },
  });
  assert.equal(claudeNew.status, 200);

  const ids = [codexNew.data.thread.id, claudeNew.data.thread.id];
  await waitFor(() =>
    ids.every((id) => sse.events.some((e) => e.event === "provider_event" && e.data.threadId === id && (e.data.method === "turn/completed" || e.data.type === "turn_completed"))),
  );

  const emptyErr = await jsonReq(srv.url, "/api/threads/archive", {
    method: "POST",
    body: { threadIds: [], archived: true },
  });
  assert.equal(emptyErr.status, 400);

  const sseBeforeArchive = sse.events.length;
  const archiveRes = await jsonReq(srv.url, "/api/threads/archive", {
    method: "POST",
    body: { threadIds: ids, archived: true },
  });
  assert.equal(archiveRes.status, 200);
  assert.equal(archiveRes.data.ok, true);
  assert.equal(archiveRes.data.count, 2);
  assert.equal(archiveRes.data.archived, true);

  const batchEvt = await waitFor(() =>
    sse.events.slice(sseBeforeArchive).find((e) => e.event === "threads_archived" && e.data.count === 2 && e.data.archived === true),
  );
  assert.deepEqual(batchEvt.data.threadIds, ids);

  const activeList = await jsonReq(srv.url, "/api/threads?archived=0");
  for (const id of ids) {
    assert.equal(activeList.data.threads.some((th) => th.id === id), false);
  }
  const archivedList = await jsonReq(srv.url, "/api/threads?archived=1");
  for (const id of ids) {
    assert.equal(archivedList.data.threads.some((th) => th.id === id && th.archived === true), true);
  }

  // Verify meta file stores both archived records and batch unarchive restores both Codex and Claude threads.
  const metaJson = JSON.parse(await readFile(resolve(dataDir, "thread-meta.json"), "utf8"));
  for (const id of ids) {
    assert.equal(metaJson.threads?.[id]?.archived, true);
  }

  const sseBeforeRestore = sse.events.length;
  const restoreRes = await jsonReq(srv.url, "/api/threads/archive", {
    method: "POST",
    body: { threadIds: ids, archived: false },
  });
  assert.equal(restoreRes.status, 200);
  assert.equal(restoreRes.data.archived, false);
  await waitFor(() =>
    sse.events.slice(sseBeforeRestore).find((e) => e.event === "threads_archived" && e.data.count === 2 && e.data.archived === false),
  );

  const restoredList = await jsonReq(srv.url, "/api/threads?archived=0");
  for (const id of ids) {
    assert.equal(restoredList.data.threads.some((th) => th.id === id && !th.archived), true);
  }
});

test("GET /api/thread/image returns cacheable 404 without throwing server errors on missing files", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-hub-img-404-"));
  const dataDir = resolve(root, "data");
  const codexHome = resolve(root, "codex");
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(codexHome, { recursive: true }),
  ]);

  const errorLogs = [];
  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    dataDir,
    writeErrorLog: (line) => errorLogs.push(String(line || "")),
    env: {
      ...process.env,
      CODEX_BIN: MOCK_CODEX_BIN,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: codexHome }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: "[]",
      AGENT_CONTROL_AGY_APP_DATA_DIRS: "[]",
      AGENT_CONTROL_GROK_HOMES: "[]",
    },
  });
  await srv.start();
  t.after(async () => {
    await srv.close().catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  const created = await jsonReq(srv.url, "/api/thread/new", {
    method: "POST",
    body: { provider: "codex", profileId: "default", cwd: root, text: "图片 404 测试" },
  });
  assert.equal(created.status, 200);

  const missingUrl = `/api/thread/image?threadId=${encodeURIComponent(created.data.thread.id)}&path=${encodeURIComponent("not-exist-icon128.png")}&w=480&q=68`;
  const missRes = await rawGet(srv.url + missingUrl);
  assert.equal(missRes.status, 404);
  assert.equal(missRes.headers["cache-control"], "private, max-age=60");
  assert.match(missRes.body.toString("utf8"), /图片文件不存在/);
  assert.equal(errorLogs.length, 0);
});

test("POST /api/thread/upload persists pasted files safely and allows thread file preview", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-upload-test-"));
  const dataDir = resolve(root, "data");
  const codexHome = resolve(root, "codex");
  await Promise.all([mkdir(dataDir, { recursive: true }), mkdir(codexHome, { recursive: true })]);

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    dataDir,
    env: {
      ...process.env,
      CODEX_BIN: MOCK_CODEX_BIN,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: codexHome }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: "[]",
      AGENT_CONTROL_AGY_APP_DATA_DIRS: "[]",
      AGENT_CONTROL_GROK_HOMES: "[]",
    },
  });
  await srv.start();
  t.after(async () => {
    await srv.close().catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  const created = await jsonReq(srv.url, "/api/thread/new", {
    method: "POST",
    body: { provider: "codex", profileId: "default", cwd: root, text: "文件粘贴上传测试" },
  });
  assert.equal(created.status, 200);
  const threadId = created.data.thread.id;

  const contentText = "hello pasted file content\n第二行";
  const uploadRes = await jsonReq(srv.url, "/api/thread/upload", {
    method: "POST",
    body: {
      threadId,
      files: [
        { name: "../../需求文档.md", type: "text/markdown", dataBase64: Buffer.from(contentText, "utf8").toString("base64") },
        { name: "需求文档.md", type: "text/markdown", dataBase64: Buffer.from("second", "utf8").toString("base64") },
      ],
    },
  });
  assert.equal(uploadRes.status, 200);
  assert.equal(uploadRes.data.ok, true);
  assert.equal(uploadRes.data.files.length, 2);
  assert.equal(uploadRes.data.files[0].name, "需求文档.md");
  assert.equal(uploadRes.data.files[1].name, "需求文档-1.md");
  assert.ok(uploadRes.data.files[0].path.startsWith(resolve(dataDir, "uploads")));
  assert.equal(await readFile(uploadRes.data.files[0].path, "utf8"), contentText);

  const previewRes = await jsonReq(
    srv.url,
    `/api/thread/file?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(uploadRes.data.files[0].path)}&mode=meta`,
  );
  assert.equal(previewRes.status, 200);
  assert.match(previewRes.data.content, /hello pasted file content/);

  // Long CJK filename, Windows reserved device name, and `#` URL-breaking filename
  const longCjkName = `${"测".repeat(120)}.md`;
  const edgeUploadRes = await jsonReq(srv.url, "/api/thread/upload", {
    method: "POST",
    body: {
      threadId,
      files: [
        { name: longCjkName, type: "text/markdown", dataBase64: Buffer.from("long cjk", "utf8").toString("base64") },
        { name: "CON.txt", type: "text/plain", dataBase64: Buffer.from("reserved", "utf8").toString("base64") },
        { name: "issue#42.md", type: "text/markdown", dataBase64: Buffer.from("hash name", "utf8").toString("base64") },
      ],
    },
  });
  assert.equal(edgeUploadRes.status, 200);
  assert.equal(edgeUploadRes.data.files.length, 3);
  assert.ok(Buffer.byteLength(edgeUploadRes.data.files[0].name, "utf8") <= 200);
  assert.equal(edgeUploadRes.data.files[1].name, "_CON.txt");
  assert.equal(edgeUploadRes.data.files[2].name, "issue_42.md");

  const hashPreviewRes = await jsonReq(
    srv.url,
    `/api/thread/file?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(edgeUploadRes.data.files[2].path)}&mode=meta`,
  );
  assert.equal(hashPreviewRes.status, 200);
  assert.match(hashPreviewRes.data.content, /hash name/);

  // Validation and size limit negative paths
  const emptyRes = await jsonReq(srv.url, "/api/thread/upload", {
    method: "POST",
    body: { threadId, files: [] },
  });
  assert.equal(emptyRes.status, 400);

  const missingDataRes = await jsonReq(srv.url, "/api/thread/upload", {
    method: "POST",
    body: { threadId, files: [{ name: "broken.txt" }] },
  });
  assert.equal(missingDataRes.status, 400);

  const tooManyFiles = Array.from({ length: 11 }, (_, idx) => ({
    name: `f-${idx}.txt`,
    type: "text/plain",
    dataBase64: Buffer.from("x", "utf8").toString("base64"),
  }));
  const tooManyRes = await jsonReq(srv.url, "/api/thread/upload", {
    method: "POST",
    body: { threadId, files: tooManyFiles },
  });
  assert.equal(tooManyRes.status, 400);

  const overSingleRes = await jsonReq(srv.url, "/api/thread/upload", {
    method: "POST",
    body: {
      threadId,
      files: [{ name: "big.bin", type: "application/octet-stream", dataBase64: Buffer.alloc(15 * 1024 * 1024 + 1).toString("base64") }],
    },
  });
  assert.equal(overSingleRes.status, 413);
});
