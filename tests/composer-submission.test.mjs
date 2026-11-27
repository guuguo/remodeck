import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderQueuedTurnsPanelHtml, resolveComposerSubmission, submitComposerRequest } from "../public/composer-mode.js";
import { isIgnorableTurnError, normalizeProfileHealth } from "../src/profile-health.mjs";
import { ProviderHub } from "../src/provider-hub.mjs";

test("页面未识别运行态时，thread_busy 转入排队并保留图片与参数", async () => {
  const payload = {
    threadId: "codex:default:busy-thread",
    text: "下一步",
    images: [{ name: "image.jpg", dataUrl: "data:image/jpeg;base64,AA==" }],
    model: "gpt-6.1",
    effort: "high",
    permissionMode: "workspace",
    goalMode: true,
  };
  const calls = [];
  const queued = { items: [{ id: "queued-1", text: payload.text }] };
  const post = async (path, body, options) => {
    calls.push({ path, body, options });
    if (path === "api/turn") throw Object.assign(new Error("当前会话正在运行"), { status: 409, code: "thread_busy" });
    return queued;
  };
  const options = { timeoutMs: 60_000 };
  assert.deepEqual(await submitComposerRequest(post, { action: "turn", payload, options }), { action: "queue", result: queued });
  assert.deepEqual(calls, [
    { path: "api/turn", body: { ...payload, steer: false }, options },
    { path: "api/thread/queue", body: payload, options },
  ]);
});

test("正常发送、主动排队和插话保留原请求，其他错误不自动重发", async () => {
  const payload = { threadId: "codex:default:thread", text: "继续" };
  for (const action of ["turn", "queue", "steer"]) {
    const calls = [];
    const result = { ok: true };
    assert.deepEqual(await submitComposerRequest(async (path, body) => {
      calls.push({ path, body });
      return result;
    }, { action, payload }), { action, result });
    assert.deepEqual(calls, [{
      path: action === "queue" ? "api/thread/queue" : "api/turn",
      body: action === "queue" ? payload : { ...payload, steer: action === "steer" },
    }]);
  }
  for (const [action, code, status, msg] of [
    ["turn", "writer_conflict", 409, "会话正被本地客户端占用"],
    ["turn", "rpc_error", 500, "thread 01a178b2 already has an active writer"],
  ]) {
    const queued = { items: [{ id: "q-writer", text: payload.text }] };
    const calls = [];
    const res = await submitComposerRequest(async (path, body) => {
      calls.push({ path, body });
      if (path === "api/turn") {
        throw Object.assign(new Error(msg), { code, status });
      }
      return queued;
    }, { action, payload });
    assert.deepEqual(res, { action: "queue", result: queued });
    assert.equal(calls.length, 2);
  }
  assert.equal(isIgnorableTurnError(new Error("thread 01a178b2 already has an active writer")), true);
  assert.equal(
    normalizeProfileHealth({ status: "unavailable", detail: "thread 01a178b2 already has an active writer" }).status,
    "unknown",
  );
  for (const [action, code, status] of [["turn", "timeout", 504], ["steer", "thread_busy", 409]]) {
    let count = 0;
    const error = Object.assign(new Error(code), { code, status });
    await assert.rejects(submitComposerRequest(async () => {
      count += 1;
      throw error;
    }, { action, payload }), (err) => err === error);
    assert.equal(count, 1);
  }
});

test("Codex Mock 协议的忙碌错误转入控制端队列，前一轮结束后自动发送", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-composer-queue-"));
  const codexHome = resolve(root, "codex");
  await mkdir(codexHome);
  const hub = new ProviderHub({
    dataDir: resolve(root, "data"),
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      CODEX_BIN: fileURLToPath(new URL("./helpers/mock-codex-cli.mjs", import.meta.url)),
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", home: codexHome }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: "[]",
      AGENT_CONTROL_AGY_APP_DATA_DIRS: "[]",
      AGENT_CONTROL_GROK_HOMES: "[]",
    },
  });
  t.after(async () => {
    await hub.close();
    await rm(root, { recursive: true, force: true });
  });
  await hub.init();
  const started = await hub.startThread({ provider: "codex", cwd: root, text: "当前任务 [SLOW]" });
  const payload = {
    threadId: started.thread.id,
    text: "完成后处理这条消息",
    images: [{ name: "image.png", dataUrl: "data:image/png;base64,AA==" }],
  };
  const submitted = await submitComposerRequest((path, body) => path === "api/turn"
    ? hub.sendTurn(body)
    : hub.queueTurn(body), { action: "turn", payload });
  assert.equal(submitted.action, "queue");
  assert.equal(submitted.result.items.length, 1);
  assert.equal(submitted.result.items[0].imageCount, 1);
  await hub.interrupt({ threadId: started.thread.id });
  const deadline = Date.now() + 5_000;
  let delivered = false;
  while (Date.now() < deadline) {
    const read = await hub.readThread(started.thread.id);
    delivered = read.thread.turns.some((turn) => turn.status === "completed"
      && turn.items.some((item) => item.type === "userMessage"
        && JSON.stringify(item).includes(payload.text)));
    if (delivered) break;
    await new Promise((done) => setTimeout(done, 25));
  }
  assert.ok(delivered, "排队消息应在前一轮结束后通过 Mock CLI 执行完成");
  assert.equal((await hub.listQueuedTurns(started.thread.id)).length, 0);
});

test("编辑排队消息模式：返回 update_queue 动作且高亮编辑中的条目", () => {
  const sub = resolveComposerSubmission({
    hasActiveThread: true,
    isRunning: true,
    isSubmitting: false,
    isEditingQueue: true,
    mode: "queue",
    text: "补充图片说明",
    imageCount: 1,
  });
  assert.deepEqual(sub, { action: "update_queue", canSubmit: true, buttonLabel: "保存更新" });

  const emptySub = resolveComposerSubmission({
    hasActiveThread: true,
    isRunning: true,
    isSubmitting: false,
    isEditingQueue: true,
    mode: "queue",
    text: "   ",
    imageCount: 0,
  });
  assert.deepEqual(emptySub, { action: "noop", canSubmit: false, buttonLabel: "保存更新" });

  const html = renderQueuedTurnsPanelHtml([
    { id: "q-1", position: 1, text: "第一条", imageCount: 1, source: "control", canCancel: true },
    { id: "q-2", position: 2, text: "第二条", imageCount: 0, source: "control", canCancel: true },
  ], { editingId: "q-1" });
  assert.match(html, /class="queued-item\s+[^"]*is-editing"/);
  assert.match(html, /编辑中/);
});
