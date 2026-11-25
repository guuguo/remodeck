import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { ProviderHub } from "../src/provider-hub.mjs";

test("ProviderHub forkThread truncates following turns and materializes with clean prefix on first message", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-fork-test-"));
  const homes = Object.fromEntries(["codex", "claude", "agy"].map((p) => [p, resolve(root, p)]));
  await Promise.all(Object.values(homes).map((p) => mkdir(p, { recursive: true })));
  const bin = (name) => fileURLToPath(new URL(`./helpers/mock-${name}-cli.mjs`, import.meta.url));
  const hub = new ProviderHub({
    dataDir: resolve(root, "data"),
    enableQueueDrain: false,
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      CODEX_BIN: bin("codex"),
      CLAUDE_BIN: bin("claude"),
      AGY_BIN: bin("agy"),
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", home: homes.codex }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", home: homes.claude }]),
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "cli", home: homes.agy, profileType: "cli" }]),
      AGENT_CONTROL_GROK_HOMES: "[]",
    },
  });
  t.after(async () => {
    await hub.close();
    await rm(root, { recursive: true, force: true });
  });
  await hub.init();

  const waitDone = async (threadId, expectedTurns) => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const res = await hub.readThread(threadId, { detail: "full", limit: 20 });
      const turns = res?.thread?.turns || [];
      if (turns.length >= expectedTurns && turns.every((turn) => turn.status !== "inProgress" && turn.status !== "running")) {
        return res;
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`Timed out waiting for ${expectedTurns} turns on ${threadId}`);
  };

  const started = await hub.startThread({
    provider: "claude",
    profileId: "default",
    cwd: root,
    text: "第一轮问题 [COMPLETE_NOW]",
  });
  await waitDone(started.thread.id, 1);
  await hub.sendTurn({
    threadId: started.thread.id,
    cwd: root,
    text: "第二轮问题（分叉时应丢弃） [COMPLETE_NOW]",
  });
  await waitDone(started.thread.id, 2);

  // Fork from turn index 0 (drop turn 1)
  const forked = await hub.forkThread({
    threadId: started.thread.id,
    upToTurnIndex: 0,
  });
  assert.equal(forked.ok, true);
  assert.equal(forked.native, false);
  assert.match(forked.thread.name, /\(分叉\)$/);

  const draftRead = await hub.readThread(forked.thread.id, { detail: "full" });
  assert.equal(draftRead.thread.turns.length, 1);
  assert.match(JSON.stringify(draftRead.thread.turns[0]), /第一轮问题/);
  assert.doesNotMatch(JSON.stringify(draftRead.thread.turns), /第二轮问题/);

  const listed = await hub.listThreads({ provider: "claude" });
  assert.equal(listed.threads.some((item) => item.id === forked.thread.id), true);

  // Send first new turn on the forked thread -> materializes into a real thread with prefix kept
  const sent = await hub.sendTurn({
    threadId: forked.thread.id,
    cwd: root,
    text: "沿着第一轮继续聊 [COMPLETE_NOW]",
  });
  assert.ok(sent.redirectedThreadId);
  const finalRead = await waitDone(sent.redirectedThreadId, 2);
  assert.equal(finalRead.thread.turns.length, 2);
  assert.match(JSON.stringify(finalRead.thread.turns[0]), /第一轮问题/);
  assert.match(JSON.stringify(finalRead.thread.turns[1]), /沿着第一轮继续聊/);
  assert.doesNotMatch(JSON.stringify(finalRead.thread.turns[1]), /AC_FORK_CONTEXT_START/);
});

test("换 Agent 通过 HTTP 新建独立接续会话，保留目录与上下文并使用目标模型/思考", async (t) => {
  const { createAgentControlServer } = await import("../src/server.mjs");
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-continue-test-"));
  const bin = (name) => fileURLToPath(new URL(`./helpers/mock-${name}-cli.mjs`, import.meta.url));
  const env = { ...process.env, HOME: root, USERPROFILE: root,
    CODEX_BIN: bin("codex"), CLAUDE_BIN: bin("claude"), AGY_BIN: bin("agy"), QODER_BIN: bin("qoder"),
    AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", home: resolve(root, "codex") }]),
    AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "work", label: "工作账号", home: resolve(root, "claude") }]),
    AGENT_CONTROL_AGY_APP_DATA_DIRS: "[]", AGENT_CONTROL_GROK_HOMES: "[]", AGENT_CONTROL_DISABLE_AUTOMATIONS: "1" };
  await Promise.all(["codex", "claude", "project"].map((name) => mkdir(resolve(root, name), { recursive: true })));
  const server = await createAgentControlServer({ port: 0, env, dataDir: resolve(root, "data"), disableRelay: true, disableTunnel: true, disableUpdateCheck: true });
  await server.start();
  t.after(async () => { await server.close(); await rm(root, { recursive: true, force: true }); });
  const { hub } = server;
  const original = await hub.startThread({ provider: "codex", profileId: "default", cwd: resolve(root, "project"),
    model: "gpt-6.1-sol", effort: "high", permissionMode: "safe", text: "尚未完成的原项目任务 [REQUEST_APPROVAL]" });
  const postFork = async (fields) => {
    const response = await fetch(`${server.url}/api/thread/continue`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ threadId: original.thread.id, ...fields }) });
    return { status: response.status, data: await response.json() };
  };
  const payload = { targetProvider: "claude", targetProfileId: "work", model: "claude-sonnet-4-6", effort: "medium" };
  const result = await postFork(payload);
  assert.equal(result.status, 200);
  assert.equal(result.data.native, false);
  const fork = result.data.thread;
  assert.match(fork.id, /^claude:work:fork-/);
  assert.equal(fork.profileLabel, "工作账号");
  assert.equal(fork.cwd, resolve(root, "project"));
  assert.equal(fork.model, payload.model);
  assert.equal(fork.reasoningEffort, payload.effort);
  assert.equal(fork.permissionMode, "safe");
  assert.match(fork.name, /Claude Code 接续/);
  assert.equal((await hub.getActivity(original.thread.id)).live, true);
  assert.equal((await hub.getActivity(fork.id)).live, false);
  assert.match(JSON.stringify((await hub.readThread(fork.id, { detail: "full" })).thread.turns), /尚未完成的原项目任务/);
  assert.equal((await postFork({ ...payload, targetProfileId: "missing" })).status, 400);
  await hub.updateProfileMeta({ provider: "claude", profileId: "work", disabled: true });
  assert.equal((await postFork(payload)).status, 400);
  await hub.updateProfileMeta({ provider: "claude", profileId: "work", disabled: false });
  const sameAgent = await postFork({ targetProvider: "codex", targetProfileId: "default", model: "gpt-6.1-terra", effort: "low" });
  assert.equal(sameAgent.status, 200);
  assert.equal(sameAgent.data.native, false);
  assert.equal(sameAgent.data.thread.model, "gpt-6.1-terra");
  assert.equal(sameAgent.data.thread.reasoningEffort, "low");
  const sent = await hub.sendTurn({ threadId: fork.id, text: "接着核对工作区 [COMPLETE_NOW]" });
  assert.match(sent.redirectedThreadId, /^claude:work:/);
  let read;
  for (let i = 0; i < 100; i++) {
    read = await hub.readThread(sent.redirectedThreadId, { detail: "full" });
    if (read.thread.turns.length === 2 && read.thread.turns[1].status === "completed") break;
    await new Promise((done) => setTimeout(done, 25));
  }
  assert.equal(read.thread.turns.length, 2);
  assert.equal(read.thread.turns[1].status, "completed");
  assert.equal(read.thread.model, payload.model);
  assert.equal(read.thread.reasoningEffort, payload.effort);
  assert.equal(await realpath(read.thread.cwd), await realpath(resolve(root, "project")));
  assert.match(JSON.stringify(read.thread.turns[0]), /尚未完成的原项目任务/);
  assert.match(JSON.stringify(read.thread.turns[1]), /接着核对工作区/);
  assert.doesNotMatch(JSON.stringify(read.thread.turns[1]), /AC_FORK_CONTEXT_START/);
  assert.equal((await hub.getActivity(original.thread.id)).live, true);

  // Stale fork draft IDs transparently redirect to the materialized thread after first send.
  const staleRead = await hub.readThread(fork.id, { detail: "full" });
  assert.equal(staleRead.thread.id, sent.redirectedThreadId);
  const staleAct = await hub.getActivity(fork.id);
  assert.equal(typeof staleAct.live, "boolean");
  const staleSent = await hub.sendTurn({ threadId: fork.id, text: "第二次跟进 [COMPLETE_NOW]" });
  assert.equal(staleSent.redirectedThreadId, sent.redirectedThreadId);
  assert.equal(staleSent.forkedFromId, fork.id);
});
