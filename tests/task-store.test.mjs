import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { MemoryVault } from "../src/memory-vault.mjs";
import { buildTaskTree, flattenTaskTree, TaskStore } from "../src/task-store.mjs";

test("TaskStore builds strict trees, rejects self/cycle parents, and computes subtree rollups", async (t) => {
  const dataDir = await mkdtemp(join(os.tmpdir(), "ac-task-store-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const store = new TaskStore({ dataDir });
  const root = await store.create({ title: "重构导出管道", goal: "统一三端导出", cwd: "/work/demo" });
  const childA = await store.create({ title: "服务端分片", parentId: root.id });
  const grandChild = await store.create({ title: "并发锁测试", parentId: childA.id });
  assert.equal(childA.cwd, "/work/demo", "child inherits cwd from parent");

  await assert.rejects(() => store.create({ title: "坏任务", parentId: "tk_missing" }), /父任务不存在/);
  await assert.rejects(() => store.update(root.id, { parentId: root.id }), /自己的父任务/);
  await assert.rejects(() => store.update(root.id, { parentId: grandChild.id }), /循环/);

  await store.update(grandChild.id, { status: "done" });
  const tree = await store.list({ status: "all", tree: true });
  assert.equal(tree.length, 1);
  assert.equal(tree[0].childCount, 2);
  assert.equal(tree[0].childDoneCount, 1);
  assert.equal(tree[0].childOpenCount, 1);
  assert.deepEqual(flattenTaskTree(tree).map((n) => [n.depth, n.title]), [
    [0, "重构导出管道"],
    [1, "服务端分片"],
    [2, "并发锁测试"],
  ]);
  assert.deepEqual((await store.getAncestors(grandChild.id)).map((a) => a.id), [root.id, childA.id]);
});

test("TaskStore migrates legacy assistant/tickets.json once on first load", async (t) => {
  const dataDir = await mkdtemp(join(os.tmpdir(), "ac-task-migrate-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  await mkdir(resolve(dataDir, "assistant"), { recursive: true });
  await writeFile(resolve(dataDir, "assistant", "tickets.json"), JSON.stringify({
    tk_legacy1: {
      id: "tk_legacy1",
      title: "旧工单迁移验证",
      goal: "保持兼容",
      criteria: ["迁移后可读"],
      topicId: "demo",
      threadIds: ["codex:default:t1"],
      status: "open",
      createdAt: "2026-11-25T10:00:00.000Z",
      updatedAt: "2026-11-25T10:00:00.000Z",
    },
  }));

  const store = new TaskStore({ dataDir });
  const loaded = await store.get("tk_legacy1");
  assert.ok(loaded);
  assert.equal(loaded.title, "旧工单迁移验证");
  assert.equal(loaded.parentId, "");
  assert.deepEqual(loaded.threadIds, ["codex:default:t1"]);
  const persisted = JSON.parse(await readFile(resolve(dataDir, "tasks.json"), "utf8"));
  assert.ok(persisted.tasks.tk_legacy1);
});

test("TaskStore concurrent appendLog and MemoryVault concurrent projectTask never lose writes", async (t) => {
  const dataDir = await mkdtemp(join(os.tmpdir(), "ac-task-conc-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const vault = new MemoryVault(join(dataDir, "memory"));
  const store = new TaskStore({
    dataDir,
    projectToVault: async (task, logs, meta) => {
      await vault.projectTask(task, logs, { scope: "demo", ...meta });
    },
  });

  const task = await store.create({ title: "并发任务日志", threadIds: ["codex:default:a"] });
  await store.pinPlan(task.id, {
    threadId: "codex:default:a",
    turnId: "turn-1",
    turnIndex: 0,
    excerpt: "先建任务存储，再接并发日志",
  });

  await Promise.all(
    Array.from({ length: 12 }, (_, idx) => store.appendLog(task.id, {
      kind: "agent_log",
      actor: "agent",
      threadId: idx % 2 === 0 ? "codex:default:a" : "claude:default:b",
      text: `并发进展 #${idx + 1}`,
    })),
  );
  await store.flush();

  const logs = await store.readLogs(task.id, { limit: 50 });
  const agentLogs = logs.filter((l) => l.kind === "agent_log");
  assert.equal(agentLogs.length, 12);
  const projected = await vault.read(`项目/demo/任务-${task.id}.md`);
  assert.equal(projected.meta.kind, "task");
  assert.equal(projected.meta.taskId, task.id);
  assert.match(projected.body, /并发进展 #12/);
  assert.match(projected.body, /先建任务存储/);
});

test("buildTaskTree handles orphan parentId safely without dropping nodes", () => {
  const tree = buildTaskTree([
    { id: "tk_a", parentId: "tk_deleted", title: "孤儿任务", status: "open", updatedAt: "2026-11-26T00:00:00Z" },
    { id: "tk_b", parentId: "tk_a", title: "子任务", status: "open", updatedAt: "2026-11-26T00:01:00Z" },
  ]);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, "tk_a");
  assert.equal(tree[0].children[0].id, "tk_b");
});
