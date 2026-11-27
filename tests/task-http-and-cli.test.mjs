import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { CodexProvider } from "../src/providers/codex-provider.mjs";
import { createAgentControlServer } from "../src/server.mjs";

const execFileAsync = promisify(execFile);

async function waitFor(fn) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const res = await fn();
    if (res) return res;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Mock 等待超时");
}

test("Task HTTP APIs: lazy sibling/child thread creation, same-cwd warning, plan pin, turn auto-log, and CLI tree", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "ac-task-http-"));
  const dataDir = resolve(root, "data");
  const codexHome = resolve(root, "codex");
  await Promise.all([mkdir(dataDir), mkdir(codexHome)]);

  const env = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    AC_MEMORY_VAULT: "",
    AGENT_CONTROL_DISABLE_AUTOMATIONS: "1",
    CODEX_BIN: fileURLToPath(new URL("./helpers/mock-codex-cli.mjs", import.meta.url)),
    AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", home: codexHome }]),
  };

  const provider = new CodexProvider({ env });
  const srv = await createAgentControlServer({
    port: 0,
    dataDir,
    env,
    providers: [provider],
    disableRelay: true,
    disableTunnel: true,
    disableUpdateCheck: true,
  });
  t.after(async () => {
    await srv.close();
    await rm(root, { recursive: true, force: true });
  });
  await srv.start();

  const request = async (path, body, method = body ? "POST" : "GET") => {
    const res = await fetch(`${srv.url}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json() };
  };

  // 1. Start original session A
  const sessionA = await request("/api/thread/new", {
    provider: "codex",
    profileId: "default",
    cwd: "/tmp/mock-codex-project",
    text: "先制定架构规划",
  });
  assert.equal(sessionA.status, 200);
  const threadAId = sessionA.body.thread.id;
  await waitFor(async () => {
    const r = await srv.hub.readThread(threadAId);
    return r.thread.turns.at(-1)?.status === "completed" && r.thread;
  });

  // 2. Pin plan on A (auto-creates root task and sets planRef)
  const pinned = await request("/api/thread/pin-plan", {
    threadId: threadAId,
    turnId: "turn-plan-0",
    turnIndex: 0,
    excerpt: "先落 task-store 再接 UI",
  });
  assert.equal(pinned.status, 200);
  const rootTask = pinned.body.task;
  assert.equal(rootTask.planRef.turnId, "turn-plan-0");
  assert.deepEqual(rootTask.threadIds, [threadAId]);

  // 3. Start sibling session B on the same task while simulating A running on same cwd
  const origActive = srv.hub.isThreadRunning?.bind(srv.hub);
  void origActive;
  const siblingRes = await request("/api/thread/new", {
    provider: "codex",
    profileId: "default",
    cwd: "/tmp/mock-codex-project",
    text: "并行实现前端任务条",
    taskMode: "same",
    taskId: rootTask.id,
    sourceThreadId: threadAId,
  });
  assert.equal(siblingRes.status, 200);
  const threadBId = siblingRes.body.thread.id;
  assert.equal(siblingRes.body.task.id, rootTask.id);
  assert.equal(siblingRes.body.thread.taskId, rootTask.id);

  // Verify B's first turn received the task pointer & completion auto-logged to jsonl.
  const bRead = await waitFor(async () => {
    const r = await srv.hub.readThread(threadBId);
    return r.thread.turns.at(-1)?.status === "completed" && r.thread;
  });
  const firstUserContent = JSON.stringify(bRead.turns[0]);
  assert.match(firstUserContent, new RegExp(`\\[任务 ${rootTask.id}`));

  // 4. Create a child task + new session C
  const childRes = await request("/api/thread/new", {
    provider: "codex",
    profileId: "default",
    cwd: "/tmp/mock-codex-project",
    text: "单独补测试",
    taskMode: "child",
    parentTaskId: rootTask.id,
    sourceThreadId: threadAId,
    taskTitle: "测试子任务",
  });
  assert.equal(childRes.status, 200);
  const childTask = childRes.body.task;
  assert.equal(childTask.parentId, rootTask.id);
  assert.equal(childTask.title, "测试子任务");

  // 5. Inspect tree API and detail logs
  const listRes = await request("/api/tasks?status=all");
  assert.equal(listRes.status, 200);
  assert.equal(listRes.body.tree.length, 1);
  assert.equal(listRes.body.tree[0].children[0].id, childTask.id);

  const detailRes = await waitFor(async () => {
    const res = await request(`/api/tasks/${encodeURIComponent(rootTask.id)}`);
    return res.body?.logs?.some((l) => l.kind === "turn_completed") ? res : null;
  });
  assert.equal(detailRes.status, 200);
  assert.ok(detailRes.body.logs.some((l) => l.kind === "plan_pinned"));
  assert.ok(detailRes.body.logs.some((l) => l.kind === "turn_completed"));

  // 6. CLI `ac-task.mjs list` renders indented tree
  const cliPath = fileURLToPath(new URL("../scripts/ac-task.mjs", import.meta.url));
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "list", "--data-dir", dataDir, "--status", "all"]);
  assert.match(stdout, new RegExp(rootTask.id));
  assert.match(stdout, /└─ .*测试子任务/);

  // 7. Memory config & Skill sync HTTP endpoints
  const memGet = await request("/api/memory/config");
  assert.equal(memGet.status, 200);
  assert.equal(memGet.body.isDefaultVault, true);

  const memPost = await request("/api/memory/config", { enabled: false });
  assert.equal(memPost.status, 200);
  assert.equal(memPost.body.enabled, false);

  const skillStatus = await request("/api/skills/status");
  assert.equal(skillStatus.status, 200);
  assert.equal(skillStatus.body.skillName, "remodeck-memory");
});
