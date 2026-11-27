import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import {
  AutomationScheduler,
  computeNextRunAtMs,
  discoverClaudeScheduledTasks,
  discoverCodexAutomations,
  formatRruleHuman,
  parseRrule,
} from "../src/automation-scheduler.mjs";

test("RRULE parsing, human formatting, and next-run calculation work cleanly", () => {
  assert.deepEqual(parseRrule("RRULE:FREQ=HOURLY;INTERVAL=1;BYMINUTE=0"), {
    freq: "HOURLY",
    interval: 1,
    byMinute: 0,
    byHour: null,
    byDay: [],
    count: null,
  });
  assert.equal(formatRruleHuman("FREQ=DAILY;BYHOUR=9;BYMINUTE=0"), "每天 09:00");
  assert.equal(formatRruleHuman("FREQ=MINUTELY;INTERVAL=30"), "每 30 分钟");
  assert.equal(formatRruleHuman("FREQ=WEEKLY;BYDAY=FR;BYHOUR=10;BYMINUTE=0;COUNT=1"), "周五 10:00 (单次)");

  const last = new Date(2026, 10, 17, 9, 0, 0, 0).getTime();
  assert.equal(
    computeNextRunAtMs("FREQ=DAILY;BYHOUR=9;BYMINUTE=0", { lastRunAtMs: last }),
    new Date(2026, 10, 18, 9, 0, 0, 0).getTime(),
  );
  assert.equal(
    computeNextRunAtMs("FREQ=WEEKLY;BYDAY=FR;BYHOUR=10;BYMINUTE=0;COUNT=1", { lastRunAtMs: last }),
    0,
  );
});

test("RRULE time lists keep five-minute heartbeats across both hours", () => {
  const time = (day, hour, minute, second = 0) =>
    new Date(2026, 10, day, hour, minute, second).getTime();
  const rule = "FREQ=DAILY;BYHOUR=12,13;BYMINUTE=0,5,10,15,20,25,30,35,40,45,50,55;BYSECOND=0";
  assert.equal(computeNextRunAtMs(rule, { lastRunAtMs: time(22, 12, 0, 16) }), time(22, 12, 5));
  assert.equal(computeNextRunAtMs(rule, { lastRunAtMs: time(22, 12, 55) }), time(22, 13, 0));
  assert.equal(computeNextRunAtMs(rule, { lastRunAtMs: time(22, 13, 55) }), time(23, 12, 0));
  assert.match(formatRruleHuman(rule), /BYHOUR=12,13;BYMINUTE=0,5,10/);

  const weeklyRule = rule.replace("FREQ=DAILY", "FREQ=WEEKLY;BYDAY=SU");
  assert.equal(computeNextRunAtMs(weeklyRule, { lastRunAtMs: time(22, 12, 55) }), time(22, 13, 0));
  assert.equal(computeNextRunAtMs(weeklyRule, { lastRunAtMs: time(22, 13, 55) }), time(29, 12, 0));

  const hourlyRule = "FREQ=HOURLY;INTERVAL=2;BYMINUTE=45,15";
  assert.equal(computeNextRunAtMs(hourlyRule, { lastRunAtMs: time(22, 12, 15) }), time(22, 12, 45));
  assert.equal(computeNextRunAtMs(hourlyRule, { lastRunAtMs: time(22, 12, 45) }), time(22, 14, 15));
});

test("AutomationScheduler discovers Codex/Claude tasks, avoids duplicate runs when native ran, and wakes overdue tasks", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-automations-"));
  const codexHome = resolve(dir, "codex-home");
  const claudeHome = resolve(dir, "claude-home");
  const dataDir = resolve(dir, "data");
  const projDir = resolve(dir, "proj");
  await Promise.all([
    mkdir(resolve(codexHome, "sqlite"), { recursive: true }),
    mkdir(resolve(codexHome, "automations", "daily-brief"), { recursive: true }),
    mkdir(resolve(claudeHome, "scheduled-tasks", "weekly-audit"), { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(projDir, { recursive: true }),
  ]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const nowMs = Date.now();
  const db = new DatabaseSync(resolve(codexHome, "sqlite", "codex.db"));
  db.exec(`
    CREATE TABLE automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      next_run_at INTEGER,
      last_run_at INTEGER,
      cwds TEXT NOT NULL DEFAULT '[]',
      rrule TEXT NOT NULL DEFAULT 'FREQ=HOURLY;INTERVAL=24;BYMINUTE=0',
      model TEXT,
      reasoning_effort TEXT,
      kind TEXT NOT NULL DEFAULT 'cron',
      target_thread_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  const ins = db.prepare(`
    INSERT INTO automations (id, name, prompt, status, next_run_at, last_run_at, cwds, rrule, model, reasoning_effort, kind, target_thread_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // 1) Overdue & native app has NOT run yet -> should be triggered by Agent Control.
  ins.run(
    "due-job",
    "每天巡检",
    "检查昨天日志是否有报错",
    "ACTIVE",
    nowMs - 120_000,
    nowMs - 86_400_000,
    JSON.stringify([projDir]),
    "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
    "gpt-5.4",
    "medium",
    "cron",
    "",
    nowMs - 86_400_000,
    nowMs - 86_400_000,
  );
  // 2) Already executed by native Codex app in current window -> must skip!
  ins.run(
    "native-ran-job",
    "已由原端跑过",
    "无需重复触发",
    "ACTIVE",
    nowMs - 60_000,
    nowMs - 10_000,
    JSON.stringify([projDir]),
    "FREQ=HOURLY;INTERVAL=1;BYMINUTE=0",
    "gpt-5.4",
    "low",
    "cron",
    "",
    nowMs - 86_400_000,
    nowMs - 10_000,
  );
  // 3) Paused job -> discovered but NOT triggered automatically.
  ins.run(
    "paused-job",
    "暂停中的任务",
    "手动才会触发",
    "PAUSED",
    nowMs - 60_000,
    0,
    JSON.stringify([projDir]),
    "FREQ=HOURLY;INTERVAL=1",
    "gpt-5.4",
    "medium",
    "cron",
    "",
    nowMs - 86_400_000,
    nowMs - 86_400_000,
  );
  db.close();

  await writeFile(
    resolve(claudeHome, "scheduled-tasks", "weekly-audit", "SKILL.md"),
    "---\nname: weekly-audit\ndescription: 每周日志巡检\n---\n请检查近期异常记录。\n",
    "utf8",
  );

  const codexItems = discoverCodexAutomations({ id: "default", label: "Codex 默认", home: codexHome });
  assert.equal(codexItems.length, 3);
  const claudeItems = discoverClaudeScheduledTasks({ id: "default", label: "Claude 默认", home: claudeHome });
  assert.equal(claudeItems.length, 1);

  const started = [];
  const events = [];
  const hub = {
    async listProvidersAndProfiles() {
      return {
        profiles: [
          { provider: "codex", id: "default", label: "Codex 默认", home: codexHome, installed: true },
          { provider: "claude", id: "default", label: "Claude 默认", home: claudeHome, installed: true },
        ],
      };
    },
    async startThread(args) {
      started.push(args);
      return { thread: { id: `${args.provider}:${args.profileId}:thr-${started.length}` } };
    },
  };

  const scheduler = new AutomationScheduler({
    hub,
    dataDir,
    onEvent: (eventName, payload) => events.push({ eventName, payload }),
  });
  await scheduler.load();

  const tick1 = await scheduler.tick({ nowMs });
  assert.equal(tick1.ran.length, 1);
  assert.equal(tick1.ran[0].taskKey, "codex:default:due-job");
  assert.equal(started.length, 1);
  assert.equal(started[0].cwd, projDir);
  assert.equal(started[0].text, "检查昨天日志是否有报错");
  assert.ok(events.some((e) => e.eventName === "automation_run" && e.payload?.taskKey === "codex:default:due-job"));

  // Immediate second tick must NOT re-trigger due-job (debounced + persisted).
  const tick2 = await scheduler.tick({ nowMs: nowMs + 5_000 });
  assert.equal(tick2.ran.length, 0);
  assert.equal(started.length, 1);

  // Manual runNow works even on PAUSED task.
  const manualRes = await scheduler.runNow("codex:default:paused-job", { nowMs: nowMs + 6_000 });
  assert.equal(manualRes.ok, true);
  assert.equal(started.length, 2);

  // Creating and triggering a custom multi-agent scheduled task works cleanly.
  const customSnap = await scheduler.saveCustomTask({
    action: "create",
    id: "custom-claude",
    name: "Claude 巡检",
    provider: "claude",
    cwd: projDir,
    prompt: "汇总今日进展",
    rrule: "FREQ=MINUTELY;INTERVAL=30",
  });
  assert.ok(customSnap.tasks.some((item) => item.id === "custom-claude" && item.managed));

  const customRun = await scheduler.runNow("custom:claude:custom-claude", { nowMs: nowMs + 7_000 });
  assert.equal(customRun.ok, true);
  assert.equal(started[2].provider, "claude");
  assert.equal(started[2].text, "汇总今日进展");

  // Deleting custom task removes it; deleting native task hides it non-invasively.
  const afterDelCustom = await scheduler.deleteTask("custom:claude:custom-claude");
  assert.equal(afterDelCustom.tasks.some((item) => item.id === "custom-claude"), false);
  const afterDelNative = await scheduler.deleteTask("codex:default:paused-job");
  assert.equal(afterDelNative.tasks.some((item) => item.taskKey === "codex:default:paused-job"), false);

  scheduler.close();
});

test("AutomationScheduler auto-unarchives archived target sessions, falls back to new session in original cwd when unarchive fails, and rethrows non-archived errors", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-automations-unarchive-"));
  const codexHome = resolve(dir, "codex-home");
  const dataDir = resolve(dir, "data");
  const projDir = resolve(dir, "maofan-proj");
  await Promise.all([
    mkdir(resolve(codexHome, "sqlite"), { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(projDir, { recursive: true }),
  ]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const nowMs = Date.now();
  const db = new DatabaseSync(resolve(codexHome, "sqlite", "codex.db"));
  db.exec(`
    CREATE TABLE automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      next_run_at INTEGER,
      last_run_at INTEGER,
      cwds TEXT NOT NULL DEFAULT '[]',
      rrule TEXT NOT NULL DEFAULT 'FREQ=DAILY;BYHOUR=3;BYMINUTE=0',
      model TEXT,
      reasoning_effort TEXT,
      kind TEXT NOT NULL DEFAULT 'heartbeat',
      target_thread_id TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.prepare(`
    INSERT INTO automations (id, name, prompt, status, next_run_at, last_run_at, cwds, rrule, model, reasoning_effort, kind, target_thread_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "hb-archived",
    "猫番缺书找源与评估",
    "每天处理猫番高频无结果搜索的找源与评估",
    "ACTIVE",
    nowMs - 60_000,
    nowMs - 86_400_000,
    "[]",
    "FREQ=DAILY;BYHOUR=3;BYMINUTE=0",
    "gpt-6.1-sol",
    "medium",
    "heartbeat",
    "raw-hb-1",
    nowMs - 86_400_000,
    nowMs - 86_400_000,
  );
  db.close();

  const threadState = new Map([
    ["codex:default:raw-hb-1", { id: "codex:default:raw-hb-1", cwd: projDir, archived: true, live: false }],
  ]);
  const calls = { archive: [], send: [], start: [] };
  let mode = "proactive-ok";

  const hub = {
    async listProvidersAndProfiles() {
      return {
        profiles: [
          { provider: "codex", id: "default", label: "Codex 默认", home: codexHome, installed: true },
        ],
      };
    },
    async readThread(id) {
      const th = threadState.get(id);
      return th ? { thread: { ...th } } : null;
    },
    async archiveThread(id, archived) {
      calls.archive.push({ id, archived });
      if (mode === "unarchive-fail") {
        throw Object.assign(new Error("native unarchive failed"), { status: 502, code: "unarchive_failed" });
      }
      const th = threadState.get(id);
      if (th) th.archived = Boolean(archived);
      return { ok: true, threadId: id, archived: Boolean(archived) };
    },
    async sendTurn(args) {
      calls.send.push(args);
      if (mode === "reactive-ok" && calls.archive.length === 0) {
        throw Object.assign(
          new Error(`session ${args.threadId} is archived. Run \`codex unarchive\` first.`),
          { status: 409, code: "thread_archived" },
        );
      }
      if (mode === "quota-error") {
        throw Object.assign(new Error("429 usage_limit_reached"), { status: 429, code: "usage_limit_reached" });
      }
      const th = threadState.get(args.threadId);
      if (th?.archived) {
        throw Object.assign(new Error("still archived"), { status: 409, code: "thread_archived" });
      }
      return { thread: { id: args.threadId }, turn: { id: "turn-1" } };
    },
    async startThread(args) {
      calls.start.push(args);
      const newId = `codex:default:raw-hb-new-${calls.start.length}`;
      threadState.set(newId, { id: newId, cwd: args.cwd, archived: false, live: false });
      return { thread: { id: newId }, turn: { id: "turn-new-1" } };
    },
  };

  const scheduler = new AutomationScheduler({ hub, dataDir });
  await scheduler.load();

  // 1) Proactive unarchive when readThread already sees archived: true
  const res1 = await scheduler.runNow("codex:default:hb-archived", { nowMs });
  assert.equal(res1.ok, true);
  assert.equal(res1.threadId, "codex:default:raw-hb-1");
  assert.equal(res1.unarchived, true);
  assert.equal(res1.fallbackNewThread, false);
  assert.deepEqual(calls.archive, [{ id: "codex:default:raw-hb-1", archived: false }]);
  assert.equal(calls.send.length, 1);
  assert.equal(calls.start.length, 0);

  // 2) Reactive unarchive + single retry when readThread had stale archived: false
  calls.archive.length = 0;
  calls.send.length = 0;
  calls.start.length = 0;
  mode = "reactive-ok";
  const res2 = await scheduler.runNow("codex:default:hb-archived", { nowMs: nowMs + 1_000 });
  assert.equal(res2.ok, true);
  assert.equal(res2.threadId, "codex:default:raw-hb-1");
  assert.equal(res2.unarchived, true);
  assert.equal(res2.fallbackNewThread, false);
  assert.deepEqual(calls.archive, [{ id: "codex:default:raw-hb-1", archived: false }]);
  assert.equal(calls.send.length, 2);
  assert.equal(calls.start.length, 0);

  // 3) Unrelated error (e.g. quota 429) must rethrow cleanly without unarchive or new thread fallback
  calls.archive.length = 0;
  calls.send.length = 0;
  calls.start.length = 0;
  mode = "quota-error";
  await assert.rejects(
    scheduler.runNow("codex:default:hb-archived", { nowMs: nowMs + 2_000 }),
    /429 usage_limit_reached/,
  );
  assert.equal(calls.archive.length, 0);
  assert.equal(calls.send.length, 1);
  assert.equal(calls.start.length, 0);

  // 4) When target is archived and unarchive fails, fall back to startThread preserving existing.thread.cwd,
  // and bind subsequent runs to the new threadId.
  calls.archive.length = 0;
  calls.send.length = 0;
  calls.start.length = 0;
  mode = "unarchive-fail";
  threadState.get("codex:default:raw-hb-1").archived = true;
  const res4 = await scheduler.runNow("codex:default:hb-archived", { nowMs: nowMs + 3_000 });
  assert.equal(res4.ok, true);
  assert.equal(res4.unarchived, false);
  assert.equal(res4.fallbackNewThread, true);
  assert.equal(res4.threadId, "codex:default:raw-hb-new-1");
  assert.equal(calls.archive.length, 1);
  assert.equal(calls.send.length, 0);
  assert.equal(calls.start.length, 1);
  assert.equal(calls.start[0].cwd, projDir);
  assert.match(calls.start[0].text, /<heartbeat>/);

  // Next run after fallback should target raw-hb-new-1 directly (persisted even across scheduler reload)
  const reloaded = new AutomationScheduler({ hub, dataDir });
  await reloaded.load();
  calls.archive.length = 0;
  calls.send.length = 0;
  calls.start.length = 0;
  mode = "proactive-ok";
  const res5 = await reloaded.runNow("codex:default:hb-archived", { nowMs: nowMs + 4_000 });
  assert.equal(res5.ok, true);
  assert.equal(res5.threadId, "codex:default:raw-hb-new-1");
  assert.equal(res5.fallbackNewThread, false);
  assert.equal(calls.archive.length, 0);
  assert.equal(calls.send.length, 1);
  assert.equal(calls.send[0].threadId, "codex:default:raw-hb-new-1");
  assert.equal(calls.start.length, 0);

  reloaded.close();
  scheduler.close();
});

test("saveCustomTask supports editing provider, profile, model, and effort while migrating overrides safely", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-automations-edit-"));
  const dataDir = resolve(dir, "data");
  await mkdir(dataDir, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const started = [];
  const hub = {
    async listProvidersAndProfiles() {
      return {
        profiles: [
          { provider: "codex", id: "codex", label: "Codex 默认", installed: true },
          { provider: "claude", id: "claude-work", label: "Claude 工作号", installed: true },
        ],
      };
    },
    async startThread(args) {
      started.push(args);
      return { thread: { id: `${args.provider}:${args.profileId}:thread-1` } };
    },
  };

  const scheduler = new AutomationScheduler({ hub, dataDir });
  await scheduler.load();

  const createdSnap = await scheduler.saveCustomTask({
    name: "每日巡检",
    provider: "codex",
    profileId: "codex",
    model: "gpt-5.4",
    reasoningEffort: "medium",
    rrule: "FREQ=DAILY;BYHOUR=21;BYMINUTE=15",
    prompt: "执行巡检",
  });
  const createdTask = createdSnap.tasks.find((item) => item.name === "每日巡检");
  assert.ok(createdTask);
  assert.equal(createdTask.model, "gpt-5.4");
  assert.equal(createdTask.reasoningEffort, "medium");

  // Simulate an override state (e.g. paused + prior runCount)
  await scheduler.configure({ taskKey: createdTask.taskKey, managed: false });

  // Edit the same task to switch provider/profile/model/effort
  const updatedSnap = await scheduler.saveCustomTask({
    id: createdTask.id,
    name: "每日巡检（Claude）",
    provider: "claude",
    profileId: "claude-work",
    model: "claude-sonnet-4-6",
    reasoningEffort: "high",
    rrule: "FREQ=DAILY;BYHOUR=21;BYMINUTE=15",
    prompt: "执行巡检 v2",
  });
  const updatedTask = updatedSnap.tasks.find((item) => item.id === createdTask.id);
  assert.ok(updatedTask);
  assert.equal(updatedTask.taskKey, `custom:claude:${createdTask.id}`);
  assert.equal(updatedTask.provider, "claude");
  assert.equal(updatedTask.profileId, "claude-work");
  assert.equal(updatedTask.profileLabel, "Claude 工作号");
  assert.equal(updatedTask.model, "claude-sonnet-4-6");
  assert.equal(updatedTask.reasoningEffort, "high");
  assert.equal(updatedTask.createdAtMs, createdTask.createdAtMs);
  assert.equal(updatedTask.managed, false);

  await scheduler.runNow(updatedTask.taskKey);
  assert.equal(started.length, 1);
  assert.equal(started[0].provider, "claude");
  assert.equal(started[0].profileId, "claude-work");
  assert.equal(started[0].model, "claude-sonnet-4-6");
  assert.equal(started[0].effort, "high");

  scheduler.close();
});
