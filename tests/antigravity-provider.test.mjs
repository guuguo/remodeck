import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_AGY_MODEL,
  parseAgyModelsOutput,
  resolveAgyAcpLaunch,
  splitAntigravityModelEffort,
} from "../src/providers/antigravity-acp-client.mjs";
import {
  ANTIGRAVITY_STALE_LIVE_AGE_MS,
  ANTIGRAVITY_TERMINAL_STEP_GRACE_MS,
  countAntigravityNativeQueuedMessages,
  decodeAntigravityErrorStepPayload,
  decodeAntigravityStepPayload,
  decodeWorkspaceUri,
  isAntigravityDiskLive,
  isPendingAskQuestionInSteps,
  parseAntigravityContextUsage,
  parseAntigravityTranscript,
  readAntigravityIndexedThreads,
  readAntigravityLiveActivity,
  readAntigravityQueuedMessages,
  readAntigravityTailErrorSync,
  readAntigravityThreadHistory,
  resolveAntigravityRootConversationId,
} from "../src/providers/antigravity-history.mjs";
import { AntigravityProvider, isTransientAntigravityAuth401Error } from "../src/providers/antigravity-provider.mjs";
import { discoverAntigravityProfiles } from "../src/providers/profile-discovery.mjs";
import { CodexProvider } from "../src/providers/codex-provider.mjs";
import { readCodexQueuedCountsByThread, readCodexQueuedItems } from "../src/providers/codex-thread-index.mjs";
import { ProviderHub } from "../src/provider-hub.mjs";
import { queuedTurnsPath } from "../src/queued-turns.mjs";

const MOCK_AGY_BIN = fileURLToPath(new URL("./helpers/mock-agy-cli.mjs", import.meta.url));

function waitFor(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolveWait, rejectWait) => {
    const check = () => {
      const value = predicate();
      if (value) return resolveWait(value);
      if (Date.now() > deadline) return rejectWait(new Error("等待条件超时"));
      setTimeout(check, 20);
    };
    check();
  });
}

test("resolveAgyAcpLaunch keeps --app-data-dir and --gemini-dir relative to HOME", () => {
  const cliLaunch = resolveAgyAcpLaunch({
    appDataDir: "/Users/tester/.gemini/antigravity-cli",
    homeDir: "/Users/tester",
    env: { PATH: "/usr/bin", CLAUDECODE: "1" },
  });
  assert.deepEqual(cliLaunch.args, ["acp", "--stdio", "--app-data-dir", "antigravity-cli"]);
  assert.equal(cliLaunch.cwd, "/Users/tester");
  assert.equal(cliLaunch.env.CLAUDECODE, undefined);

  const desktopLaunch = resolveAgyAcpLaunch({
    appDataDir: "/Users/tester/.gemini/antigravity",
    homeDir: "/Users/tester",
    env: {},
  });
  assert.deepEqual(desktopLaunch.args, ["acp", "--stdio", "--app-data-dir", "antigravity"]);

  const skipPermLaunch = resolveAgyAcpLaunch({
    appDataDir: "/Users/tester/.gemini/antigravity",
    homeDir: "/Users/tester",
    env: {},
    skipPermissions: true,
  });
  assert.deepEqual(skipPermLaunch.args, [
    "acp", "--stdio", "--dangerously-skip-permissions", "--app-data-dir", "antigravity",
  ]);

  const customUnderHome = resolveAgyAcpLaunch({
    appDataDir: "/Users/tester/.custom-agy/profile1",
    homeDir: "/Users/tester",
    env: {},
  });
  assert.deepEqual(customUnderHome.args, [
    "acp", "--stdio", "--gemini-dir", ".custom-agy", "--app-data-dir", "profile1",
  ]);

  const externalTmp = resolveAgyAcpLaunch({
    appDataDir: "/var/tmp/ac-agy-prov-123/desktop",
    homeDir: "/Users/tester",
    env: {},
  });
  assert.deepEqual(externalTmp.args, [
    "acp", "--stdio", "--gemini-dir", "ac-agy-prov-123", "--app-data-dir", "desktop",
  ]);
  assert.equal(externalTmp.env.HOME, "/var/tmp");
  assert.equal(externalTmp.cwd, "/var/tmp");
});

test("antigravity-history decodes workspace URIs, deduplicates CLI rows, cleans tags, and reads transcript_full", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-agy-hist-"));
  const desktopDir = resolve(dir, "antigravity");
  await mkdir(desktopDir, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const db = new DatabaseSync(resolve(desktopDir, "conversation_summaries.db"));
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      step_count INTEGER,
      last_modified_time TEXT,
      workspace_uris TEXT,
      status TEXT,
      source TEXT,
      parent_conversation_id TEXT,
      not_fully_idle INTEGER,
      killed INTEGER,
      app_data_dir TEXT
    );
  `);
  const insert = db.prepare(`
    INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  assert.equal(
    decodeWorkspaceUri(["file:///Users/demo", "file:///workspace/demo/agent-control"]),
    "/workspace/demo/agent-control",
  );
  assert.equal(
    decodeWorkspaceUri([
      "file:///Users/demo",
      "file:///workspace/demo/agent-control",
      "file:///workspace/demo/demo-app",
    ]),
    "/workspace/demo/demo-app",
  );
  assert.equal(
    decodeWorkspaceUri(["file:///Users/demo"]),
    "/Users/demo",
  );

  const encodedUri = JSON.stringify(["file:///Users/demo", "file:///workspace/demo/%E4%B8%AD%E6%96%87"]);
  insert.run("conv-desktop-1", "中文工作区会话", "摘要", 4, "2026-11-14 02:00:00+00:00", encodedUri, "", "", "", 0, 0, "");
  insert.run("conv-cli-mirrored", "CLI镜像会话", "镜像", 2, "2026-11-14 02:01:00+00:00", encodedUri, "", "CORTEX_TRAJECTORY_SOURCE_CLI", "", 0, 0, "");
  insert.run("conv-subagent", "子代理", "子代理", 2, "2026-11-14 02:02:00+00:00", encodedUri, "", "", "conv-desktop-1", 0, 0, "");
  db.close();

  const indexed = readAntigravityIndexedThreads(desktopDir, { profileType: "desktop" });
  assert.equal(indexed.length, 2); // conv-cli-mirrored without local brain folder filtered out
  const main = indexed.find((item) => item.id === "conv-desktop-1");
  assert.equal(main.cwd, "/workspace/demo/中文");
  assert.equal(indexed.find((item) => item.id === "conv-subagent")?.threadSource, "subagent");

  const logsDir = resolve(desktopDir, "brain", "conv-desktop-1", ".system_generated", "logs");
  await mkdir(logsDir, { recursive: true });
  const compactSteps = [
    {
      step_index: 0,
      type: "USER_INPUT",
      created_at: "2026-11-14T02:00:00Z",
      content: "<USER_REQUEST>\n实现完整测试\n</USER_REQUEST>\n<ADDITIONAL_METADATA>ignored</ADDITIONAL_METADATA>",
    },
    {
      step_index: 1,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-14T02:00:02Z",
      thinking: "分析需求",
      tool_calls: [{ name: "run_command", args: { CommandLine: "npm test", Cwd: "/tmp" } }],
      content: "截断片段\n<truncated 12598 bytes>",
      truncated_fields: ["content"],
    },
    {
      step_index: 2,
      type: "GENERIC",
      status: "DONE",
      created_at: "2026-11-14T02:00:03Z",
      content: "精简工具输出",
      truncated_fields: ["content"],
    },
  ];
  const fullSteps = [
    compactSteps[0],
    {
      ...compactSteps[1],
      content: "完整无截断回复内容",
      truncated_fields: undefined,
    },
    {
      ...compactSteps[2],
      content: "完整超长命令输出内容",
      truncated_fields: undefined,
    },
  ];
  await writeFile(resolve(logsDir, "transcript.jsonl"), compactSteps.map((s) => JSON.stringify(s)).join("\n") + "\n");
  await writeFile(resolve(logsDir, "transcript_full.jsonl"), fullSteps.map((s) => JSON.stringify(s)).join("\n") + "\n");

  const autoHist = await readAntigravityThreadHistory(desktopDir, "conv-desktop-1", { detail: "auto" });
  assert.equal(autoHist.thread.turns.length, 1);
  assert.equal(autoHist.thread.turns[0].items[0].content[0].text, "实现完整测试");
  assert.equal(autoHist.thread.turns[0].items[2].type, "commandExecution");
  assert.equal(autoHist.thread.turns[0].items[2].aggregatedOutput, "精简工具输出");
  assert.equal(autoHist.thread.turns[0].items[3].text, "完整无截断回复内容");

  const fullHist = await readAntigravityThreadHistory(desktopDir, "conv-desktop-1", { detail: "full" });
  assert.equal(fullHist.thread.turns[0].items[2].aggregatedOutput, "完整超长命令输出内容");
  assert.equal(fullHist.thread.turns[0].items[3].text, "完整无截断回复内容");
});

test("antigravity-history disambiguates colliding step_index turns, transcript_full entries, and ignores enter_plan_mode", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-agy-collide-"));
  const desktopDir = resolve(dir, "antigravity");
  const logsDir = resolve(desktopDir, "brain", "conv-collide-1", ".system_generated", "logs");
  await mkdir(logsDir, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const compactSteps = [
    {
      step_index: 2609,
      type: "USER_INPUT",
      source: "USER_EXPLICIT",
      created_at: "2026-11-15T02:23:47Z",
      content: "第一轮任务：显示额度开关",
    },
    {
      step_index: 2610,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-15T02:24:10Z",
      tool_calls: [
        { name: "enter_plan_mode", args: { reason: "hand back" } },
      ],
      content: "第一轮摘要\n<truncated 120 bytes>",
      truncated_fields: ["content"],
    },
    {
      step_index: 2609,
      type: "USER_INPUT",
      source: "USER_EXPLICIT",
      created_at: "2026-11-15T02:37:43Z",
      content: "第二轮任务：简化顶部监控",
    },
    {
      step_index: 2610,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-15T02:46:41Z",
      tool_calls: [
        { name: "read_file", args: { Path: "/tmp/a.js" } },
      ],
      content: "第二轮摘要\n<truncated 220 bytes>",
      truncated_fields: ["content"],
    },
  ];
  const fullSteps = [
    compactSteps[0],
    {
      ...compactSteps[1],
      content: "第一轮完整汇总：已完成额度开关",
      truncated_fields: undefined,
    },
    compactSteps[2],
    {
      ...compactSteps[3],
      content: "第二轮完整汇总：已完成顶部 UI 简化",
      truncated_fields: undefined,
    },
  ];

  await writeFile(resolve(logsDir, "transcript.jsonl"), compactSteps.map((s) => JSON.stringify(s)).join("\n") + "\n");
  await writeFile(resolve(logsDir, "transcript_full.jsonl"), fullSteps.map((s) => JSON.stringify(s)).join("\n") + "\n");

  const hist = await readAntigravityThreadHistory(desktopDir, "conv-collide-1", { detail: "auto" });
  assert.equal(hist.thread.turns.length, 2);
  assert.notEqual(hist.thread.turns[0].id, hist.thread.turns[1].id);
  const firstReply = hist.thread.turns[0].items.find((it) => it.type === "agentMessage")?.text;
  const secondReply = hist.thread.turns[1].items.find((it) => it.type === "agentMessage")?.text;
  assert.equal(firstReply, "第一轮完整汇总：已完成额度开关");
  assert.equal(secondReply, "第二轮完整汇总：已完成顶部 UI 简化");
  assert.equal(
    hist.thread.turns[0].items.some((it) => it.tool === "enter_plan_mode"),
    false,
  );
});

test("AntigravityProvider handles dual profiles, replay suppression, model/thought split, permission, and cancel", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-agy-prov-"));
  const desktopDir = resolve(dir, "desktop");
  const cliDir = resolve(dir, "cli");
  await mkdir(desktopDir, { recursive: true });
  await mkdir(cliDir, { recursive: true });
  let provider = null;
  t.after(async () => {
    await provider?.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });

  assert.deepEqual(splitAntigravityModelEffort("gemini-4-carbon-high"), {
    baseModel: "gemini-4-carbon",
    effort: "high",
  });

  const deltas = [];
  const serverRequests = [];
  const completions = [];

  provider = new AntigravityProvider({
    env: {
      ...process.env,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([
        { id: "desktop", label: "Antigravity 桌面", home: desktopDir, profileType: "desktop" },
        { id: "cli", label: "Antigravity CLI", home: cliDir, profileType: "cli" },
      ]),
    },
    onEvent: (evt) => {
      if (evt.type === "stream_delta") deltas.push(evt);
      if (evt.type === "turn_completed") completions.push(evt);
    },
    onServerRequest: (req) => serverRequests.push(req),
  });

  const profiles = await provider.listProfiles();
  assert.equal(profiles.length, 2);

  const models = await provider.listModels("cli");
  const carbon = models.find((m) => m.id === "gemini-4-carbon");
  assert.ok(carbon);
  assert.equal(carbon.displayName, "Gemini 4 Carbon");
  assert.deepEqual(carbon.supportedReasoningEfforts, ["medium", "high"]);
  const hydrogen = models.find((m) => m.id === "gemini-4-hydrogen");
  assert.ok(hydrogen);
  assert.equal(hydrogen.displayName, "Gemini 4 Hydrogen");
  assert.deepEqual(hydrogen.supportedReasoningEfforts, ["low", "medium"]);
  assert.equal(models.filter((m) => m.id.startsWith("gemini-4-carbon")).length, 1);
  assert.equal(models.filter((m) => m.id.startsWith("gemini-4-hydrogen")).length, 1);
  const orchestrator = models.find((m) => m.id === DEFAULT_AGY_MODEL);
  assert.equal(orchestrator?.displayName, "Orchestrator (Carbon)");
  assert.equal(orchestrator?.isDefault, true);
  assert.equal(models.filter((m) => m.isDefault).length, 1);

  const parsedCustom = parseAgyModelsOutput([
    "gemini-4-carbon-high Gemini 4 Carbon (High)",
    "gemini-4-carbon-low Gemini 4 Carbon (Low)",
    "gemini-4-hydrogen-medium Gemini 4 Hydrogen (Medium)",
    "gemini-4-hydrogen-xhigh Gemini 4 Hydrogen (XHigh)",
    "gemini-pro-orchestrator Orchestrator (Carbon)",
  ].join("\n"));
  assert.equal(parsedCustom.length, 3);
  assert.equal(parsedCustom.find((m) => m.id === "gemini-pro-orchestrator")?.isDefault, true);
  assert.equal(parsedCustom.find((m) => m.id === "gemini-4-carbon")?.isDefault, false);
  assert.deepEqual(parsedCustom.find((m) => m.id === "gemini-4-carbon")?.supportedReasoningEfforts, ["low", "high"]);
  assert.equal(parsedCustom.find((m) => m.id === "gemini-4-hydrogen")?.defaultReasoningEffort, "medium");
  assert.deepEqual(parsedCustom.find((m) => m.id === "gemini-4-hydrogen")?.supportedReasoningEfforts, ["medium", "xhigh"]);

  const listed = await provider.listThreads("cli");
  assert.ok(listed.some((th) => th.id === "antigravity:cli:agy-seed-session-1"));

  const defaultStarted = await provider.startThread({
    profileId: "cli",
    cwd: dir,
    text: "使用默认协调者模型",
  });
  assert.equal(defaultStarted.thread.model, "gemini-pro-orchestrator");
  const c0 = await waitFor(() => completions.length >= 1 && completions[0]);
  assert.match(c0.lastAgentMessage, /gemini-pro-orchestrator/);

  // Continue historical session -> triggers session/load first -> replay chunks MUST be suppressed!
  await provider.sendTurn({
    profileId: "cli",
    rawId: "agy-seed-session-1",
    cwd: "/tmp/mock-agy-project",
    text: "测试模型切换",
    model: "claude-opus-5-5-medium",
  });
  const c1 = await waitFor(() => completions.length >= 2 && completions[1]);
  assert.equal(c1.status, "completed");
  assert.match(c1.lastAgentMessage, /claude-opus-5-5\/medium/);
  assert.ok(!deltas.some((d) => d.delta.includes("HISTORICAL_REPLAY_SHOULD_BE_SUPPRESSED")));

  // Permission request (workspace mode -> emits serverRequest for manual approval).
  const started = await provider.startThread({
    profileId: "desktop",
    cwd: dir,
    text: "触发 [AGY_PERMISSION]",
  });
  const perm = await waitFor(() => serverRequests.find((r) => r.kind === "acpPermission"));
  provider.respondServerRequest("desktop", perm, { optionId: "allow_once" });
  const c2 = await waitFor(() => completions.length >= 3 && completions[2]);
  assert.match(c2.lastAgentMessage, /allow_once/);

  // Turbo permission mode -> auto-approves [AGY_PERMISSION] without emitting manual serverRequest!
  const beforeReqCount = serverRequests.length;
  const turboStarted = await provider.startThread({
    profileId: "desktop",
    cwd: dir,
    text: "Turbo 自动授权 [AGY_PERMISSION]",
    permissionMode: "turbo",
  });
  const cTurbo = await waitFor(() => completions.length >= 4 && completions[3]);
  assert.equal(cTurbo.status, "completed");
  assert.match(cTurbo.lastAgentMessage, /allow_always/);
  assert.equal(serverRequests.length, beforeReqCount);
  assert.equal(turboStarted.thread.permissionMode, "turbo");

  // Slow turn -> session/cancel.
  await provider.sendTurn({
    profileId: "desktop",
    rawId: started.thread.rawId,
    cwd: dir,
    text: "慢任务 [SLOW]",
  });
  await provider.interrupt({ profileId: "desktop", rawId: started.thread.rawId });
  const c3 = await waitFor(() => completions.length >= 5 && completions[4]);
  assert.equal(c3.status, "interrupted");
});

function plannerStep(stepIndex, ctxTokens) {
  return JSON.stringify({
    step_index: stepIndex,
    source: "MODEL",
    type: "PLANNER_RESPONSE",
    status: "DONE",
    input_tokens: 2_000,
    cache_read_tokens: ctxTokens - 2_000,
    output_tokens: 500,
    content: "ok",
  });
}

test("parseAntigravityContextUsage measures growth since the last native compaction", () => {
  const fresh = parseAntigravityContextUsage([plannerStep(0, 30_000), plannerStep(1, 52_000)].join("\n"));
  assert.equal(fresh.source, "tokens");
  assert.equal(fresh.baselineTokens, 30_000);
  assert.equal(fresh.growthTokens, 22_000);

  const afterCheckpoint = parseAntigravityContextUsage([
    plannerStep(0, 30_000),
    plannerStep(1, 510_000),
    JSON.stringify({ step_index: 2, source: "SYSTEM", type: "CHECKPOINT", input_tokens: 510_000, content: "# Resuming from a compaction" }),
    plannerStep(3, 46_000),
    plannerStep(4, 120_000),
  ].join("\n"));
  assert.equal(afterCheckpoint.checkpoints, 1);
  assert.equal(afterCheckpoint.currentTokens, 120_000);
  assert.equal(afterCheckpoint.growthTokens, 74_000);

  const justCompacted = parseAntigravityContextUsage([
    plannerStep(0, 400_000),
    JSON.stringify({ step_index: 1, source: "SYSTEM", type: "CHECKPOINT", content: "summary" }),
  ].join("\n"));
  assert.equal(justCompacted.growthTokens, 0);

  const noTokens = parseAntigravityContextUsage(JSON.stringify({ type: "GENERIC", content: "x".repeat(53_000) }));
  assert.equal(noTokens.source, "bytes");
  assert.ok(noTokens.growthTokens >= 9_900 && noTokens.growthTokens <= 10_100);
});

test("AntigravityProvider auto-compacts before sending once context growth crosses the threshold", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-agy-compact-"));
  const home = resolve(dir, "cli");
  const rawId = "agy-seed-session-1";
  const logsDir = resolve(home, "brain", rawId, ".system_generated", "logs");
  await mkdir(logsDir, { recursive: true });
  const promptLog = resolve(dir, "prompts.jsonl");
  let provider = null;
  t.after(async () => {
    await provider?.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(resolve(logsDir, "transcript.jsonl"), `${[plannerStep(0, 40_000), plannerStep(1, 110_000)].join("\n")}\n`);

  const deltas = [];
  const completions = [];
  provider = new AntigravityProvider({
    env: {
      ...process.env,
      AGY_BIN: MOCK_AGY_BIN,
      MOCK_AGY_PROMPT_LOG: promptLog,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([
        { id: "cli", label: "Antigravity CLI", home, profileType: "cli" },
      ]),
    },
    onEvent: (evt) => {
      if (evt.type === "stream_delta") deltas.push(evt);
      if (evt.type === "turn_completed") completions.push(evt);
    },
  });
  const readPrompts = async () => (await readFile(promptLog, "utf8").catch(() => ""))
    .split("\n").filter(Boolean).map((line) => JSON.parse(line).text);

  // Disabled -> no compaction even though growth (70K) exceeds the threshold.
  await provider.sendTurn({
    profileId: "cli", rawId, cwd: dir, text: "关闭时直接发送",
    autoCompact: { enabled: false, thresholdTokens: 60_000 },
  });
  await waitFor(() => completions.length >= 1);
  assert.deepEqual(await readPrompts(), ["关闭时直接发送"]);

  // Enabled -> /compact runs first, its output stays out of the user's turn.
  const res = await provider.sendTurn({
    profileId: "cli", rawId, cwd: dir, text: "压缩后继续",
    autoCompact: { enabled: true, thresholdTokens: 60_000 },
  });
  assert.equal(res.autoCompact?.growthTokens, 70_000);
  const done = await waitFor(() => completions.length >= 2 && completions[1]);
  assert.equal(done.status, "completed");
  assert.deepEqual((await readPrompts()).slice(1), ["/compact", "压缩后继续"]);
  assert.ok(!String(done.lastAgentMessage || "").includes("COMPACT_SUMMARY_SHOULD_NOT_LEAK"));
  assert.ok(!deltas.some((d) => String(d.delta || "").includes("COMPACT_SUMMARY_SHOULD_NOT_LEAK")));

  // Cooldown: transcript has not been rewritten yet, but we must not compact again in a loop.
  await provider.sendTurn({
    profileId: "cli", rawId, cwd: dir, text: "冷却期内不重复压缩",
    autoCompact: { enabled: true, thresholdTokens: 60_000 },
  });
  await waitFor(() => completions.length >= 3);
  assert.deepEqual((await readPrompts()).slice(3), ["冷却期内不重复压缩"]);
});

test("AntigravityProvider skips auto-compact for steer/control commands and applies cooldown on failed compact", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-agy-compact-guard-"));
  const home = resolve(dir, "cli");
  const rawId = "agy-seed-session-1";
  const logsDir = resolve(home, "brain", rawId, ".system_generated", "logs");
  await mkdir(logsDir, { recursive: true });
  const promptLog = resolve(dir, "prompts.jsonl");
  let provider = null;
  t.after(async () => {
    await provider?.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });
  await writeFile(resolve(logsDir, "transcript.jsonl"), `${[plannerStep(0, 40_000), plannerStep(1, 130_000)].join("\n")}\n`);

  const completions = [];
  provider = new AntigravityProvider({
    env: {
      ...process.env,
      AGY_BIN: MOCK_AGY_BIN,
      MOCK_AGY_PROMPT_LOG: promptLog,
      MOCK_AGY_FAIL_COMPACT: "1",
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([
        { id: "cli", label: "Antigravity CLI", home, profileType: "cli" },
      ]),
    },
    onEvent: (evt) => {
      if (evt.type === "turn_completed") completions.push(evt);
    },
  });
  const readPrompts = async () => (await readFile(promptLog, "utf8").catch(() => ""))
    .split("\n").filter(Boolean).map((line) => JSON.parse(line).text);

  // Control commands & steer must bypass pre-turn auto-compact even above threshold.
  const clearRes = await provider.sendTurn({
    profileId: "cli", rawId, cwd: dir, text: "/clear",
    autoCompact: { enabled: true, thresholdTokens: 60_000 },
  });
  assert.equal(clearRes.autoCompact, undefined);
  await waitFor(() => completions.length >= 1);

  const steerRes = await provider.sendTurn({
    profileId: "cli", rawId, cwd: dir, text: "中途纠正一下",
    steer: true,
    autoCompact: { enabled: true, thresholdTokens: 60_000 },
  });
  assert.equal(steerRes.autoCompact, undefined);
  await waitFor(() => completions.length >= 2);
  assert.deepEqual(await readPrompts(), ["/clear", "中途纠正一下"]);

  // Normal prompt triggers /compact, /compact fails -> still sends user prompt & records cooldown.
  const firstFailCompact = await provider.sendTurn({
    profileId: "cli", rawId, cwd: dir, text: "失败压缩后继续发送",
    autoCompact: { enabled: true, thresholdTokens: 60_000 },
  });
  assert.equal(firstFailCompact.autoCompact?.growthTokens, 90_000);
  const done1 = await waitFor(() => completions.length >= 3 && completions[2]);
  assert.equal(done1.status, "completed");

  const nextInCooldown = await provider.sendTurn({
    profileId: "cli", rawId, cwd: dir, text: "失败后冷却期内跳过压缩",
    autoCompact: { enabled: true, thresholdTokens: 60_000 },
  });
  assert.equal(nextInCooldown.autoCompact, undefined);
  const done2 = await waitFor(() => completions.length >= 4 && completions[3]);
  assert.equal(done2.status, "completed");
  assert.deepEqual((await readPrompts()).slice(2), ["/compact", "失败压缩后继续发送", "失败后冷却期内跳过压缩"]);
});

test("parseAntigravityTranscript folds GENERIC tool output onto tool items and suppresses plan-handoff/system noise", () => {
  const lines = [
    JSON.stringify({
      step_index: 0,
      type: "USER_INPUT",
      source: "USER_EXPLICIT",
      created_at: "2026-11-14T08:00:00Z",
      content: "<USER_REQUEST>\n精简手机端过程汇报\n</USER_REQUEST>",
    }),
    JSON.stringify({
      step_index: 1,
      type: "USER_INPUT",
      source: "SYSTEM",
      created_at: "2026-11-14T08:00:01Z",
      content: "[plan review due] hidden system prompt",
    }),
    JSON.stringify({
      step_index: 2,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-14T08:00:02Z",
      thinking: "Inspect UI renderer first.",
      tool_calls: [
        { name: "read_file", args: { Path: "\"/tmp/repo/public/markdown.js\"" } },
        { name: "edit_file", args: { Path: "\"/workspace/demo/agent-control/src/server.mjs\"", Replacement: "\"console.log('ok')\"" } },
        { name: "exit_plan_mode", args: { plan: "# Internal handoff" } },
        { name: "run_command", args: { CommandLine: "\"npm test\"", Cwd: "\"/tmp/repo\"" } },
      ],
    }),
    JSON.stringify({
      step_index: 3,
      type: "GENERIC",
      status: "DONE",
      content: "Created At: 2026-11-14T08:00:02+08:00\nCompleted At: 2026-11-14T08:00:03+08:00\nShowing lines 1-50 of 289\nexport function renderTurnHtml() {}",
    }),
    JSON.stringify({
      step_index: 4,
      type: "GENERIC",
      status: "DONE",
      content: "Created At: 2026-11-14T08:00:03+08:00\nCompleted At: 2026-11-14T08:00:04+08:00\nMade 1 replacement in /workspace/demo/agent-control/src/server.mjs",
    }),
    JSON.stringify({
      step_index: 5,
      type: "GENERIC",
      status: "DONE",
      content: "Created At: 2026-11-14T08:00:04+08:00\nCompleted At: 2026-11-14T08:00:05+08:00\nPlan mode is off.",
    }),
    JSON.stringify({
      step_index: 6,
      type: "GENERIC",
      status: "DONE",
      content: "Created At: 2026-11-14T08:00:04+08:00\nCompleted At: 2026-11-14T08:00:05+08:00\nCommand exited with code 0\nAll tests passed",
    }),
    JSON.stringify({
      step_index: 7,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-14T08:00:06Z",
      content: "已完成精简并通过测试。",
    }),
  ];

  const parsed = parseAntigravityTranscript(lines, { rawId: "conv-noise-free" });
  assert.equal(parsed.turns.length, 1);
  const items = parsed.turns[0].items;
  assert.equal(items.filter((it) => it.type === "userMessage").length, 1);
  assert.equal(items.some((it) => String(it.id || "").startsWith("agy-gen-")), false);
  assert.equal(items.some((it) => it.type === "mcpToolCall" && it.tool === "exit_plan_mode"), false);

  const readTool = items.find((it) => it.type === "mcpToolCall" && it.tool === "read_file");
  assert.ok(readTool);
  assert.equal(readTool.arguments.Path, "/tmp/repo/public/markdown.js");
  assert.match(readTool.result?.content?.[0]?.text || "", /^Showing lines 1-50/);

  const fileEdit = items.find((it) => it.type === "fileChange");
  assert.ok(fileEdit);
  assert.equal(fileEdit.changes[0].path, "/workspace/demo/agent-control/src/server.mjs");

  const cmd = items.find((it) => it.type === "commandExecution");
  assert.ok(cmd);
  assert.equal(cmd.command, "npm test");
  assert.equal(cmd.aggregatedOutput, "Command exited with code 0\nAll tests passed");

  const finalMsg = items.find((it) => it.type === "agentMessage");
  assert.equal(finalMsg?.phase, "final_answer");
  assert.equal(finalMsg?.text, "已完成精简并通过测试。");
});

test("AntigravityProvider.readThread deduplicates in-progress user prompt already written to transcript", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-agy-dedupe-"));
  const cliDir = resolve(dir, "cli");
  await mkdir(cliDir, { recursive: true });
  let provider = null;
  t.after(async () => {
    await provider?.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });

  const completions = [];
  provider = new AntigravityProvider({
    env: {
      ...process.env,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([
        { id: "cli", label: "Antigravity CLI", home: cliDir, profileType: "cli" },
      ]),
    },
    onEvent: (evt) => {
      if (evt.type === "turn_completed") completions.push(evt);
    },
  });

  const started = await provider.startThread({
    profileId: "cli",
    cwd: dir,
    text: "排查双气泡 [SLOW]",
  });

  // Simulate transcript.jsonl already containing the flushed USER_INPUT step while the turn is still running.
  const logsDir = resolve(cliDir, "brain", started.thread.rawId, ".system_generated", "logs");
  await mkdir(logsDir, { recursive: true });
  await writeFile(
    resolve(logsDir, "transcript.jsonl"),
    `${JSON.stringify({
      step_index: 0,
      type: "USER_INPUT",
      source: "USER_EXPLICIT",
      created_at: new Date().toISOString(),
      content: "<USER_REQUEST>\n排查双气泡 [SLOW]\n</USER_REQUEST>",
    })}\n`,
  );

  const liveRead = await provider.readThread("cli", started.thread.rawId, { limit: 20 });
  assert.equal(liveRead.thread.turns.length, 1);
  assert.equal(liveRead.thread.turns[0].status, "inProgress");
  assert.equal(liveRead.thread.turns[0].items.filter((it) => it.type === "userMessage").length, 1);

  await provider.interrupt({ profileId: "cli", rawId: started.thread.rawId });
  await waitFor(() => completions.length >= 1);
});

test("Antigravity single-step tool errors (missing file, invalid line range, patch mismatch) localize cleanly without failing turn and hydrate truncated tool_calls", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-agy-tool-errs-"));
  const cliDir = resolve(dir, "cli");
  const convId = "conv-step-errs-1";
  const logsDir = resolve(cliDir, "brain", convId, ".system_generated", "logs");
  await mkdir(logsDir, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const compactSteps = [
    {
      step_index: 0,
      type: "USER_INPUT",
      source: "USER_EXPLICIT",
      created_at: "2026-11-14T11:17:00Z",
      content: "<USER_REQUEST>\n继续推进漫剧生产平台联调\n</USER_REQUEST>",
    },
    {
      step_index: 1,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-14T11:17:01Z",
      tool_calls: [
        { name: "read_file", args: { Path: "\"/workspace/demo/studio/tools/demo_studio/server.py\"" } },
        { name: "read_file", args: { Path: "\"/workspace/demo/studio/tools/demo_studio/backend/compiler.py\"" } },
      ],
    },
    {
      step_index: 2,
      type: "GENERIC",
      status: "DONE",
      created_at: "2026-11-14T11:17:02Z",
      content: "Created At: 2026-11-14T19:17:01+08:00\nCompleted At: 2026-11-14T19:17:01+08:00\nShowing lines 1-400 of 620\n# server.py",
    },
    {
      step_index: 3,
      type: "GENERIC",
      status: "ERROR",
      created_at: "2026-11-14T11:17:02Z",
      content: "Created At: 2026-11-14T19:17:01+08:00\nCompleted At: 2026-11-14T19:17:01+08:00\nEncountered error in step execution: file does not exist",
    },
    {
      step_index: 4,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-14T11:17:03Z",
      tool_calls: [],
      truncated_fields: ["tool_calls"],
    },
    {
      step_index: 5,
      type: "GENERIC",
      status: "ERROR",
      created_at: "2026-11-14T11:17:03Z",
      content: "Created At: 2026-11-14T19:17:03+08:00\nCompleted At: 2026-11-14T19:17:03+08:00\nEncountered error in step execution: invalid line range: StartLine 101 is greater than EndLine 100",
    },
    {
      step_index: 6,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-14T11:17:04Z",
      tool_calls: [
        { name: "edit_file", args: { Path: "\"/workspace/demo/studio/tools/demo_studio/backend/storage.py\"", Target: "\"old\"", Replacement: "\"new\"" } },
      ],
    },
    {
      step_index: 7,
      type: "GENERIC",
      status: "ERROR",
      created_at: "2026-11-14T11:17:04Z",
      content: "Created At: 2026-11-14T19:17:04+08:00\nCompleted At: 2026-11-14T19:17:04+08:00\nEncountered error in step execution: target content not found in the file; the Target must exactly match existing file text",
    },
    {
      step_index: 8,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-14T11:17:05Z",
      content: "已改用 validators.py 与 storage.py 完成处理。",
    },
  ];

  const fullSteps = compactSteps.map((s) => (
    s.step_index === 4
      ? {
          step_index: 4,
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: s.created_at,
          tool_calls: [
            { name: "read_file", args: { Path: "\"/workspace/demo/studio/tools/demo_studio/backend/validators.py\"", StartLine: 101, EndLine: 100 } },
          ],
        }
      : s
  ));

  await writeFile(resolve(logsDir, "transcript.jsonl"), compactSteps.map((s) => JSON.stringify(s)).join("\n") + "\n");
  await writeFile(resolve(logsDir, "transcript_full.jsonl"), fullSteps.map((s) => JSON.stringify(s)).join("\n") + "\n");

  // Default detail: "auto" must automatically restore truncated_fields: ["tool_calls"] so file path is preserved.
  const hist = await readAntigravityThreadHistory(cliDir, convId, { detail: "auto", limit: 20 });
  assert.equal(hist.thread.turns.length, 1);
  const turn = hist.thread.turns[0];
  assert.equal(turn.status, "completed");
  assert.equal(turn.error, null);

  const compilerItem = turn.items.find((it) => it.type === "mcpToolCall" && it.arguments?.Path?.endsWith("compiler.py"));
  assert.ok(compilerItem);
  assert.equal(compilerItem.status, "failed");
  assert.equal(compilerItem.error?.message, "文件不存在：compiler.py");
  assert.equal(compilerItem.error?.recoverable, true);

  const validatorsItem = turn.items.find((it) => it.type === "mcpToolCall" && it.arguments?.Path?.endsWith("validators.py"));
  assert.ok(validatorsItem);
  assert.equal(validatorsItem.status, "failed");
  assert.equal(validatorsItem.error?.message, "行号范围无效（第 101–100 行）：validators.py");

  const storageEdit = turn.items.find((it) => it.type === "fileChange" && it.changes?.[0]?.path?.endsWith("storage.py"));
  assert.ok(storageEdit);
  assert.equal(storageEdit.status, "failed");
  assert.equal(storageEdit.error?.message, "补丁内容未匹配：storage.py");

  const finalMsg = turn.items.find((it) => it.type === "agentMessage" && it.phase === "final_answer");
  assert.equal(finalMsg?.text, "已改用 validators.py 与 storage.py 完成处理。");
});

test("readAntigravityLiveActivity, getActivity, and readThread track live disk progress and completion transitions", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-agy-live-"));
  const desktopDir = resolve(dir, "desktop");
  const cliDir = resolve(dir, "cli");
  await mkdir(desktopDir, { recursive: true });
  await mkdir(cliDir, { recursive: true });
  t.after(() => rm(dir, { recursive: true, force: true }));

  const convId = "conv-live-progress-1";
  const db = new DatabaseSync(resolve(desktopDir, "conversation_summaries.db"));
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      step_count INTEGER,
      last_modified_time TEXT,
      workspace_uris TEXT,
      status TEXT,
      source TEXT,
      parent_conversation_id TEXT,
      not_fully_idle INTEGER,
      killed INTEGER,
      app_data_dir TEXT
    );
  `);
  db.prepare(`
    INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    convId,
    "桌面实时进度检查",
    "桌面实时进度检查",
    3,
    "2026-11-14T21:00:00Z",
    JSON.stringify(["file:///tmp/mock-agy-project"]),
    "RUNNING",
    "",
    "",
    1,
    0,
    "",
  );

  const logsDir = resolve(desktopDir, "brain", convId, ".system_generated", "logs");
  await mkdir(logsDir, { recursive: true });
  const liveSteps = [
    {
      step_index: 0,
      type: "USER_INPUT",
      source: "USER_EXPLICIT",
      created_at: "2026-11-14T21:00:00Z",
      content: "<USER_REQUEST>\n检查桌面实时进展\n</USER_REQUEST>",
    },
    {
      step_index: 1,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-14T21:00:02Z",
      thinking: "先执行测试验证当前改动",
      tool_calls: [
        { name: "run_command", args: { CommandLine: "npm test", toolSummary: "Unit test run" } },
      ],
    },
  ];
  await writeFile(resolve(logsDir, "transcript.jsonl"), liveSteps.map((s) => JSON.stringify(s)).join("\n") + "\n");

  const directLive = await readAntigravityLiveActivity(desktopDir, convId, { profileType: "desktop" });
  assert.equal(directLive.live, true);
  assert.equal(directLive.phase, "正在执行命令…");
  assert.match(directLive.detail, /Unit test run/);
  assert.match(directLive.lastThought, /先执行测试验证当前改动/);

  const provider = new AntigravityProvider({
    env: {
      ...process.env,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([
        { id: "desktop", label: "Antigravity 桌面", home: desktopDir, profileType: "desktop" },
        { id: "cli", label: "Antigravity CLI", home: cliDir, profileType: "cli" },
      ]),
    },
  });
  t.after(() => provider.close());

  const act1 = await provider.getActivity("desktop", convId);
  assert.equal(act1.live, true);
  assert.equal(act1.changed, true);
  assert.equal(act1.activity?.phase, "正在执行命令…");
  assert.match(act1.activity?.text || "", /Unit test run/);

  const actUnchanged = await provider.getActivity("desktop", convId, { cursor: act1.cursor });
  assert.equal(actUnchanged.live, true);
  assert.equal(actUnchanged.changed, false);

  const liveRead = await provider.readThread("desktop", convId, { limit: 12 });
  assert.equal(liveRead.thread.live, true);
  assert.equal(liveRead.thread.turns.at(-1)?.status, "inProgress");

  // Transition session to idle + final response on disk.
  db.prepare(`
    UPDATE conversation_summaries
    SET status = 'IDLE', not_fully_idle = 0, step_count = 4, last_modified_time = '2026-11-14T21:00:10Z'
    WHERE conversation_id = ?
  `).run(convId);
  db.close();

  const completedSteps = [
    ...liveSteps,
    {
      step_index: 2,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-14T21:00:08Z",
      content: "所有测试已通过。",
    },
  ];
  await writeFile(resolve(logsDir, "transcript.jsonl"), completedSteps.map((s) => JSON.stringify(s)).join("\n") + "\n");

  const actDone = await provider.getActivity("desktop", convId, { cursor: act1.cursor });
  assert.equal(actDone.live, false);
  assert.equal(actDone.changed, true);

  const doneRead = await provider.readThread("desktop", convId, { limit: 12 });
  assert.equal(doneRead.thread.live, false);
  assert.equal(doneRead.thread.turns.at(-1)?.status, "completed");
});

function encodePbVarint(num) {
  let n = BigInt(num);
  const bytes = [];
  while (n >= 0x80n) {
    bytes.push(Number((n & 0x7fn) | 0x80n));
    n >>= 7n;
  }
  bytes.push(Number(n));
  return Buffer.from(bytes);
}

function encodePbLenField(fieldNo, payload) {
  const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload), "utf8");
  return Buffer.concat([encodePbVarint((fieldNo << 3) | 2), encodePbVarint(buf.length), buf]);
}

function encodeAgyQueuedStepPayload({ text = "", media = [] } = {}) {
  const parts = [];
  if (text) {
    parts.push(encodePbLenField(2, text));
    parts.push(encodePbLenField(3, encodePbLenField(1, text)));
  }
  for (const m of media) {
    const mediaParts = [];
    if (m.mimeType) mediaParts.push(encodePbLenField(1, m.mimeType));
    if (m.name) mediaParts.push(encodePbLenField(4, m.name));
    if (m.uri) mediaParts.push(encodePbLenField(5, m.uri));
    if (m.rawBytes) mediaParts.push(encodePbLenField(6, m.rawBytes));
    parts.push(encodePbLenField(9, Buffer.concat(mediaParts)));
  }
  return encodePbLenField(19, Buffer.concat(parts)).toString("base64");
}

test("antigravity-history and AntigravityProvider parse undelivered protobuf queued messages and skip system/read entries", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-agy-queue-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const desktopDir = resolve(root, "desktop");
  const convId = "conv-native-queue-1";
  const messagesDir = resolve(desktopDir, "brain", convId, ".system_generated", "messages");
  const undeliveredDir = resolve(messagesDir, "undelivered");
  const logsDir = resolve(desktopDir, "brain", convId, ".system_generated", "logs");
  await Promise.all([
    mkdir(undeliveredDir, { recursive: true }),
    mkdir(logsDir, { recursive: true }),
  ]);

  const db = new DatabaseSync(resolve(desktopDir, "conversation_summaries.db"));
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      step_count INTEGER,
      last_modified_time TEXT,
      workspace_uris TEXT,
      status TEXT,
      source TEXT,
      parent_conversation_id TEXT,
      not_fully_idle INTEGER,
      killed INTEGER,
      app_data_dir TEXT
    );
  `);
  db.prepare(`
    INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    convId,
    "测试桌面原生队列",
    "测试桌面原生队列",
    2,
    "2026-11-15T00:01:00Z",
    JSON.stringify(["file:///tmp/mock-queue-proj"]),
    "RUNNING",
    "",
    "",
    1,
    0,
    "",
  );
  db.close();
  await writeFile(resolve(logsDir, "transcript.jsonl"), "");

  // Include non-UTF8 PNG binary in Media field 6 to confirm binary bytes do not leak into extracted text.
  const payload1 = encodeAgyQueuedStepPayload({
    text: "<USER_REQUEST>\n带图片的桌面排队指令\n</USER_REQUEST>",
    media: [{
      mimeType: "image/png",
      name: "shot.png",
      uri: "/tmp/shot.png",
      rawBytes: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe]),
    }],
  });
  const payload2 = encodeAgyQueuedStepPayload({ text: "第二条纯文本排队" });
  const payloadRead = encodeAgyQueuedStepPayload({ text: "已被标记 read 的消息" });

  const decodedDirect = decodeAntigravityStepPayload(payload1);
  assert.equal(decodedDirect.text, "带图片的桌面排队指令");
  assert.equal(decodedDirect.images.length, 1);
  assert.equal(decodedDirect.images[0].name, "shot.png");

  await writeFile(resolve(messagesDir, "msg-1.json"), JSON.stringify({
    id: "msg-1",
    recipient: convId,
    sender: "user",
    timestamp: "2026-11-15T00:01:01.000Z",
    stepPayload: payload1,
  }));
  await writeFile(resolve(messagesDir, "msg-2.json"), JSON.stringify({
    id: "msg-2",
    recipient: convId,
    sender: "user",
    timestamp: "2026-11-15T00:01:05.000Z",
    stepPayload: payload2,
  }));
  await writeFile(resolve(messagesDir, "msg-sys.json"), JSON.stringify({
    id: "msg-sys",
    recipient: convId,
    sender: "system",
    hideFromUser: true,
    timestamp: "2026-11-15T00:01:06.000Z",
    content: "内部系统提示不应展示",
  }));
  await writeFile(resolve(messagesDir, "msg-read.json"), JSON.stringify({
    id: "msg-read",
    recipient: convId,
    sender: "user",
    timestamp: "2026-11-15T00:01:00.000Z",
    stepPayload: payloadRead,
  }));
  await writeFile(resolve(messagesDir, "read.json"), JSON.stringify({ "msg-read": true }));

  await writeFile(resolve(undeliveredDir, "msg-1"), "");
  await writeFile(resolve(undeliveredDir, "msg-2"), "");
  await writeFile(resolve(undeliveredDir, "msg-sys"), "");
  await writeFile(resolve(undeliveredDir, "msg-read"), "");

  assert.equal(countAntigravityNativeQueuedMessages(desktopDir, convId), 2);
  const queued = await readAntigravityQueuedMessages(desktopDir, convId, { profileType: "desktop" });
  assert.equal(queued.length, 2);
  assert.equal(queued[0].id, "msg-1");
  assert.equal(queued[0].text, "带图片的桌面排队指令");
  assert.equal(queued[0].imageCount, 1);
  assert.equal(queued[0].sourceLabel, "桌面端队列");
  assert.equal(queued[0].canCancel, false);
  assert.equal(queued[1].id, "msg-2");
  assert.equal(queued[1].text, "第二条纯文本排队");

  const provider = new AntigravityProvider({
    env: {
      ...process.env,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([
        { id: "desktop", label: "Antigravity 桌面", home: desktopDir, profileType: "desktop" },
      ]),
    },
  });
  t.after(() => provider.close());

  const list = await provider.listThreads("desktop");
  assert.equal(list[0].nativeQueuedCount, 2);

  const readRes = await provider.readThread("desktop", convId, { limit: 12 });
  assert.equal(readRes.thread.nativeQueuedCount, 2);
  assert.equal(readRes.nativeQueuedTurns.length, 2);
  assert.equal(readRes.nativeQueuedTurns[0].threadId, `antigravity:desktop:${convId}`);

  const act1 = await provider.getActivity("desktop", convId);
  assert.equal(act1.nativeQueuedTurns.length, 2);
  const actSame = await provider.getActivity("desktop", convId, { cursor: act1.cursor });
  assert.equal(actSame.changed, false);

  await rm(resolve(undeliveredDir, "msg-1"));
  await writeFile(resolve(messagesDir, "read.json"), JSON.stringify({ "msg-read": true, "msg-1": true }));

  const actAfter = await provider.getActivity("desktop", convId, { cursor: act1.cursor });
  assert.equal(actAfter.changed, true);
  assert.equal(actAfter.nativeQueuedTurns.length, 1);
  assert.equal(actAfter.nativeQueuedTurns[0].id, "msg-2");
});

test("CodexProvider and codex-thread-index read native queue_1.sqlite items and update activity cursor", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-codex-queue-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const codexHome = resolve(root, "codex");
  await mkdir(codexHome, { recursive: true });

  const threadId = "codex-native-q-1";
  const rolloutPath = resolve(codexHome, "rollout-1.jsonl");
  await writeFile(rolloutPath, JSON.stringify({ type: "session_meta", payload: { id: threadId } }) + "\n");

  const stateDb = new DatabaseSync(resolve(codexHome, "state_5.sqlite"));
  stateDb.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      source TEXT,
      model_provider TEXT,
      cwd TEXT,
      title TEXT,
      archived INTEGER,
      first_user_message TEXT,
      model TEXT,
      reasoning_effort TEXT,
      thread_source TEXT,
      preview TEXT,
      name TEXT,
      git_sha TEXT,
      git_branch TEXT,
      git_origin_url TEXT
    );
  `);
  stateDb.prepare(`
    INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    threadId,
    rolloutPath,
    1794668000,
    1794668100,
    "cli",
    "openai",
    root,
    "Codex 队列会话",
    0,
    "Codex 队列会话",
    "gpt-5.4",
    "high",
    "cli",
    "Codex 队列会话",
    "Codex 队列会话",
    "",
    "",
    "",
  );
  stateDb.close();

  const queueDb = new DatabaseSync(resolve(codexHome, "queue_1.sqlite"));
  queueDb.exec(`
    CREATE TABLE queued_items (
      id TEXT PRIMARY KEY NOT NULL,
      thread_id TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      queue_order INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );
  `);
  queueDb.prepare(`
    INSERT INTO queued_items VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "cq-1",
    threadId,
    JSON.stringify({
      input: [
        { type: "text", text: "先检查报错截图" },
        { type: "local_image", path: "/tmp/err-shot.png" },
      ],
    }),
    1,
    1794668200000,
    1794668200000,
  );
  queueDb.prepare(`
    INSERT INTO queued_items VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    "cq-2",
    threadId,
    JSON.stringify({ text: "再补齐单元测试" }),
    2,
    1794668205000,
    1794668205000,
  );
  queueDb.close();

  const counts = readCodexQueuedCountsByThread(codexHome);
  assert.equal(counts.get(threadId), 2);
  const directItems = readCodexQueuedItems(codexHome, threadId);
  assert.equal(directItems.length, 2);
  assert.equal(directItems[0].text, "先检查报错截图");
  assert.equal(directItems[0].imageCount, 1);
  assert.equal(directItems[0].images[0].name, "err-shot.png");
  assert.equal(directItems[0].sourceLabel, "Codex 队列");

  const provider = new CodexProvider({
    env: {
      ...process.env,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: codexHome }]),
    },
  });
  t.after(() => provider.close());

  const threads = await provider.listThreads("default");
  assert.equal(threads[0].nativeQueuedCount, 2);
  const nativeTurns = await provider.listNativeQueuedTurns("default", threadId);
  assert.equal(nativeTurns.length, 2);
  assert.equal(nativeTurns[0].threadId, `codex:default:${threadId}`);

  const act1 = await provider.getActivity("default", threadId);
  assert.equal(act1.nativeQueuedTurns.length, 2);
  const actSame = await provider.getActivity("default", threadId, { cursor: act1.cursor });
  assert.equal(actSame.changed, false);

  const qWrite = new DatabaseSync(resolve(codexHome, "queue_1.sqlite"));
  qWrite.prepare("DELETE FROM queued_items WHERE id = ?").run("cq-1");
  qWrite.close();

  const actAfter = await provider.getActivity("default", threadId, { cursor: act1.cursor });
  assert.equal(actAfter.changed, true);
  assert.equal(actAfter.nativeQueuedTurns.length, 1);
  assert.equal(actAfter.nativeQueuedTurns[0].id, "cq-2");
});

test("ProviderHub persists control queue, merges native + control queues, and defers delivery until external live and native queue clear", async (t) => {
  const dataDir = await mkdtemp(resolve(os.tmpdir(), "ac-hub-queue-"));
  let hub1 = null;
  let hub2 = null;
  t.after(async () => {
    await hub1?.close().catch(() => {});
    await hub2?.close().catch(() => {});
    await rm(dataDir, { recursive: true, force: true });
  });

  const rawId = "conv-hub-q-1";
  const compositeId = `antigravity:desktop:${rawId}`;
  let externalLive = true;
  let nativeTurns = [{
    id: "native-q-1",
    threadId: compositeId,
    createdAt: 1794668300,
    text: "桌面端先排队的任务",
    model: "",
    effort: "",
    permissionMode: "",
    goalMode: false,
    imageCount: 1,
    images: [{ name: "ref.png", mimeType: "image/png", path: "/tmp/ref.png" }],
    source: "antigravity-desktop",
    sourceLabel: "桌面端队列",
    canCancel: false,
    position: 1,
  }];
  const deliveries = [];

  const fakeAgy = {
    id: "antigravity",
    async refreshProfiles() {},
    async listProfiles() {
      return [{ id: "desktop", provider: "antigravity", label: "Antigravity 桌面", installed: true }];
    },
    async listThreads() {
      return [{
        id: compositeId,
        rawId,
        provider: "antigravity",
        profileId: "desktop",
        profileLabel: "Antigravity 桌面",
        title: "外部运行中会话",
        cwd: dataDir,
        updatedAt: 1794668300,
        live: externalLive,
        nativeQueuedCount: nativeTurns.length,
      }];
    },
    async listNativeQueuedTurns() {
      return nativeTurns;
    },
    async getActivity() {
      return {
        cursor: `${externalLive ? 1 : 0}:q=${nativeTurns.map((x) => x.id).join(",")}`,
        changed: false,
        live: externalLive,
        activity: externalLive ? { status: "running", phase: "桌面端执行中" } : null,
        nativeQueuedTurns: nativeTurns,
      };
    },
    async readThread() {
      return {
        thread: {
          id: compositeId,
          rawId,
          provider: "antigravity",
          profileId: "desktop",
          cwd: dataDir,
          live: externalLive,
          nativeQueuedCount: nativeTurns.length,
          turns: [],
        },
        activityCursor: "base-cur",
        nativeQueuedTurns: nativeTurns,
      };
    },
    async sendTurn(args) {
      deliveries.push(args.text);
      return { turn: { id: `turn-${deliveries.length}` } };
    },
  };

  hub1 = new ProviderHub({ dataDir, providers: [fakeAgy] });
  await hub1.init();

  const qRes = await hub1.queueTurn({
    threadId: compositeId,
    text: "控制端排队的第二条",
    goalMode: true,
  });
  assert.equal(qRes.items.length, 2);
  assert.equal(qRes.items[0].id, "native-q-1");
  assert.equal(qRes.items[0].canCancel, false);
  assert.equal(qRes.items[1].source, "control");
  assert.equal(qRes.items[1].sourceLabel, "控制端队列");
  assert.equal(qRes.items[1].goalMode, true);
  assert.equal(qRes.items[1].canCancel, true);
  assert.equal(qRes.items[1].position, 2);

  const listBefore = await hub1.listThreads({ provider: "antigravity" });
  assert.equal(listBefore.threads[0].queuedCount, 2);

  await new Promise((r) => setTimeout(r, 150));
  assert.equal(deliveries.length, 0);
  await hub1.close();

  // Confirm queued-turns.json was written and survives restart into hub2.
  const persistedRaw = JSON.parse(await (await import("node:fs/promises")).readFile(queuedTurnsPath(dataDir), "utf8"));
  assert.equal(persistedRaw.entries.length, 1);

  hub2 = new ProviderHub({ dataDir, providers: [fakeAgy] });
  await hub2.init();

  const restored = await hub2.listQueuedTurns(compositeId);
  assert.equal(restored.length, 2);
  assert.equal(restored[1].text, "控制端排队的第二条");

  // External live cleared, but native queue still non-empty -> still must defer control turn.
  externalLive = false;
  await waitFor(() => false, 150).catch(() => {});
  assert.equal(deliveries.length, 0);

  // Native queue finishes too -> control turn now auto-delivers via retry timer.
  nativeTurns = [];
  await waitFor(() => deliveries.length === 1 && hub2.allQueuedTurns().length === 0, 4_500);
  assert.equal(deliveries[0], "控制端排队的第二条");
  const finalQueue = await hub2.listQueuedTurns(compositeId);
  assert.equal(finalQueue.length, 0);
  await hub2.close();
});

test("stale not_fully_idle expires automatically on disk and unblocks queued turns", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-agy-stale-live-"));
  const desktopDir = resolve(root, "desktop");
  const logsDir = resolve(desktopDir, "brain", "conv-stale-1", ".system_generated", "logs");
  await mkdir(logsDir, { recursive: true });
  let provider = null;
  let hub = null;
  t.after(async () => {
    await hub?.close().catch(() => {});
    await provider?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  const nowMs = Date.now();
  const staleAt = new Date(nowMs - ANTIGRAVITY_STALE_LIVE_AGE_MS - 60_000);
  const terminalAt = new Date(nowMs - ANTIGRAVITY_TERMINAL_STEP_GRACE_MS - 15_000);

  assert.equal(isAntigravityDiskLive({ flaggedLive: false, updatedAtMs: nowMs, nowMs }), false);
  assert.equal(isAntigravityDiskLive({ flaggedLive: true, updatedAtMs: staleAt.getTime(), transcriptMtimeMs: staleAt.getTime(), nowMs }), false);
  assert.equal(isAntigravityDiskLive({ flaggedLive: true, updatedAtMs: staleAt.getTime(), transcriptMtimeMs: nowMs - 5_000, nowMs }), true);

  const db = new DatabaseSync(resolve(desktopDir, "conversation_summaries.db"));
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      step_count INTEGER,
      last_modified_time TEXT,
      workspace_uris TEXT,
      status TEXT,
      source TEXT,
      parent_conversation_id TEXT,
      not_fully_idle INTEGER,
      killed INTEGER,
      app_data_dir TEXT
    );
  `);
  const insert = db.prepare(`INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  insert.run(
    "conv-stale-1",
    "重启中断的任务",
    "重启中断的任务",
    4,
    staleAt.toISOString(),
    JSON.stringify([root]),
    "RUNNING",
    "",
    "",
    1,
    0,
    "",
  );
  insert.run(
    "conv-terminal-1",
    "已出结果未落库的任务",
    "已出结果未落库的任务",
    3,
    terminalAt.toISOString(),
    JSON.stringify([root]),
    "RUNNING",
    "",
    "",
    1,
    0,
    "",
  );
  db.close();

  const staleTranscriptPath = resolve(logsDir, "transcript.jsonl");
  await writeFile(staleTranscriptPath, [
    JSON.stringify({
      step_index: 0,
      type: "USER_INPUT",
      source: "USER_EXPLICIT",
      created_at: staleAt.toISOString(),
      content: "重启服务端",
    }),
    JSON.stringify({
      step_index: 1,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: staleAt.toISOString(),
      tool_calls: [{ name: "run_command", args: { CommandLine: "launchctl kickstart" } }],
    }),
  ].join("\n") + "\n");
  await utimes(staleTranscriptPath, staleAt, staleAt);

  const termLogsDir = resolve(desktopDir, "brain", "conv-terminal-1", ".system_generated", "logs");
  await mkdir(termLogsDir, { recursive: true });
  const termTranscriptPath = resolve(termLogsDir, "transcript.jsonl");
  await writeFile(termTranscriptPath, [
    JSON.stringify({
      step_index: 0,
      type: "USER_INPUT",
      source: "USER_EXPLICIT",
      created_at: terminalAt.toISOString(),
      content: "查一下状态",
    }),
    JSON.stringify({
      step_index: 1,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: terminalAt.toISOString(),
      content: "服务健康检查已全部通过。",
    }),
  ].join("\n") + "\n");
  await utimes(termTranscriptPath, terminalAt, terminalAt);

  const indexed = readAntigravityIndexedThreads(desktopDir, { profileType: "desktop", nowMs });
  assert.equal(indexed.find((x) => x.id === "conv-stale-1")?.live, false);

  const staleDiskLive = await readAntigravityLiveActivity(desktopDir, "conv-stale-1", { profileType: "desktop", nowMs });
  assert.equal(staleDiskLive.live, false);
  assert.equal(staleDiskLive.phase, "");

  const termDiskLive = await readAntigravityLiveActivity(desktopDir, "conv-terminal-1", { profileType: "desktop", nowMs });
  assert.equal(termDiskLive.live, false);

  provider = new AntigravityProvider({
    env: {
      ...process.env,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([
        { id: "desktop", label: "Antigravity 桌面", home: desktopDir, profileType: "desktop" },
      ]),
    },
  });
  const staleAct = await provider.getActivity("desktop", "conv-stale-1");
  assert.equal(staleAct.live, false);
  assert.equal(staleAct.activity, null);

  const staleRead = await provider.readThread("desktop", "conv-stale-1", { limit: 10 });
  assert.equal(staleRead.thread.live, false);
  assert.equal(staleRead.thread.turns.at(-1)?.status, "completed");

  // Verify ProviderHub queue is NOT blocked by the stale not_fully_idle row.
  const dataDir = resolve(root, "hub-data");
  hub = new ProviderHub({ dataDir, providers: [provider] });
  await hub.init();

  await hub.queueTurn({
    threadId: "antigravity:desktop:conv-stale-1",
    text: "排队补发测试",
  });
  // Wait for queue timer (~1.5s) to drain because stale not_fully_idle yields live=false.
  const deadline = Date.now() + 4_500;
  let remaining = 1;
  while (Date.now() < deadline) {
    const items = await hub.listQueuedTurns("antigravity:desktop:conv-stale-1");
    remaining = items.length;
    if (remaining === 0) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.equal(remaining, 0);
});

test("ProviderHub detects topic drift on historical Antigravity sessions whose DB title stayed frozen on turn 1", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-agy-drift-"));
  const desktopDir = resolve(root, "antigravity");
  const dataDir = resolve(root, "hub-data");
  const logsDir = resolve(desktopDir, "brain", "conv-drift-1", ".system_generated", "logs");
  await Promise.all([
    mkdir(logsDir, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
  ]);

  const db = new DatabaseSync(resolve(desktopDir, "conversation_summaries.db"));
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      step_count INTEGER,
      last_modified_time TEXT,
      workspace_uris TEXT,
      status TEXT,
      source TEXT,
      parent_conversation_id TEXT,
      not_fully_idle INTEGER,
      killed INTEGER,
      app_data_dir TEXT
    );
  `);
  db.prepare(`INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    "conv-drift-1",
    "Claude 项目进度查询",
    "已更新脚本并验证",
    6,
    "2026-11-15 02:00:00+00:00",
    JSON.stringify([`file://${root}`]),
    "IDLE",
    "",
    "",
    0,
    0,
    "",
  );
  db.close();

  await writeFile(resolve(logsDir, "transcript.jsonl"), [
    JSON.stringify({
      step_index: 0,
      type: "USER_INPUT",
      source: "USER_EXPLICIT",
      created_at: "2026-11-15T01:00:00Z",
      content: "帮我查询一下 Claude 项目的进度",
    }),
    JSON.stringify({
      step_index: 1,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-15T01:01:00Z",
      content: "当前 Claude 进度正常。",
    }),
    JSON.stringify({
      step_index: 2,
      type: "USER_INPUT",
      source: "USER_EXPLICIT",
      created_at: "2026-11-15T01:10:00Z",
      content: "优化 Agent Control 的会话标题生成与更新逻辑：当会话后续实际执行的任务与初始标题（例如“Claude 项目进度查询”）发生偏离时，自动重新总结",
    }),
    JSON.stringify({
      step_index: 3,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-15T01:12:00Z",
      content: "已更新标题逻辑。",
    }),
    JSON.stringify({
      step_index: 4,
      type: "USER_INPUT",
      source: "USER_EXPLICIT",
      created_at: "2026-11-15T01:15:00Z",
      content: "跑一下测试",
    }),
  ].join("\n") + "\n", "utf8");

  const provider = new AntigravityProvider({
    env: {
      ...process.env,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([
        { id: "desktop", label: "Antigravity 桌面", home: desktopDir, profileType: "desktop" },
      ]),
    },
  });
  const hub = new ProviderHub({ dataDir, providers: [provider], enableQueueDrain: false });
  t.after(async () => {
    await hub.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  await hub.init();

  const listed = await hub.listThreads({ provider: "antigravity" });
  const item = listed.threads.find((th) => th.id === "antigravity:desktop:conv-drift-1");
  assert.equal(item?.title, "Claude 项目进度查询");

  const detail = await hub.readThread("antigravity:desktop:conv-drift-1");
  assert.equal(detail.thread.title, "Claude 项目进度查询");
});

test("discoverAntigravityProfiles converges to single Antigravity profile while preserving legacy cli read fallback", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-agy-single-"));
  const homeBoth = resolve(root, "home-both");
  const desktopDir = resolve(homeBoth, ".gemini", "antigravity");
  const cliDir = resolve(homeBoth, ".gemini", "antigravity-cli");
  await mkdir(desktopDir, { recursive: true });
  await mkdir(resolve(cliDir, "brain", "legacy-conv-1", ".system_generated", "logs"), { recursive: true });

  const homeCliOnly = resolve(root, "home-cli-only");
  await mkdir(resolve(homeCliOnly, ".gemini", "antigravity-cli"), { recursive: true });

  let provider = null;
  t.after(async () => {
    await provider?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  const bothProfiles = await discoverAntigravityProfiles({ env: {}, home: homeBoth });
  assert.equal(bothProfiles.length, 1);
  assert.equal(bothProfiles[0].id, "desktop");
  assert.equal(bothProfiles[0].label, "Antigravity");

  const cliOnlyProfiles = await discoverAntigravityProfiles({ env: {}, home: homeCliOnly });
  assert.equal(cliOnlyProfiles.length, 1);
  assert.equal(cliOnlyProfiles[0].id, "cli");
  assert.equal(cliOnlyProfiles[0].label, "Antigravity");

  const db = new DatabaseSync(resolve(cliDir, "conversation_summaries.db"));
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      step_count INTEGER,
      last_modified_time TEXT,
      workspace_uris TEXT,
      status TEXT,
      source TEXT,
      parent_conversation_id TEXT,
      not_fully_idle INTEGER,
      killed INTEGER,
      app_data_dir TEXT
    );
  `);
  db.prepare("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    "legacy-conv-1",
    "旧版 CLI 历史会话",
    "保留旧历史可读",
    2,
    new Date().toISOString(),
    JSON.stringify([`file://${homeBoth}`]),
    "DONE",
    "USER",
    "",
    0,
    0,
    cliDir,
  );
  db.close();
  await writeFile(
    resolve(cliDir, "brain", "legacy-conv-1", ".system_generated", "logs", "transcript.jsonl"),
    [
      JSON.stringify({ step_index: 0, type: "USER_INPUT", source: "USER_EXPLICIT", content: "检查旧会话", created_at: new Date().toISOString() }),
      JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", status: "DONE", content: "已兼容读取。", created_at: new Date().toISOString() }),
    ].join("\n"),
  );

  provider = new AntigravityProvider({
    env: {
      ...process.env,
      HOME: homeBoth,
      USERPROFILE: homeBoth,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: "",
    },
  });

  const listedProfiles = await provider.listProfiles();
  assert.equal(listedProfiles.length, 1);
  assert.equal(listedProfiles[0].id, "desktop");

  const legacyDetail = await provider.readThread("cli", "legacy-conv-1");
  assert.equal(legacyDetail.thread.id, "antigravity:cli:legacy-conv-1");
  assert.equal(legacyDetail.thread.title, "旧版 CLI 历史会话");
});

test("Antigravity subagent permissions route to parent thread, inherit turbo, and clear on hub.interrupt", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-agy-subperm-"));
  const dataDir = resolve(root, "data");
  const desktopDir = resolve(root, "agy-desktop");
  await mkdir(dataDir, { recursive: true });
  await mkdir(desktopDir, { recursive: true });

  const dbPath = resolve(desktopDir, "conversation_summaries.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      step_count INTEGER,
      last_modified_time TEXT,
      workspace_uris TEXT,
      status TEXT,
      source TEXT,
      parent_conversation_id TEXT,
      not_fully_idle INTEGER,
      killed INTEGER,
      app_data_dir TEXT
    );
  `);
  db.close();

  const provider = new AntigravityProvider({
    env: {
      ...process.env,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([
        { id: "desktop", label: "Antigravity", home: desktopDir, profileType: "desktop" },
      ]),
    },
  });
  const hub = new ProviderHub({ dataDir, providers: [provider], enableQueueDrain: false });
  const completions = [];
  hub.subscribe((event, data) => {
    if (event === "provider_event" && data?.type === "turn_completed") {
      completions.push(data);
    }
  });
  t.after(async () => {
    await hub.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  await hub.init();

  const started = await hub.startThread({
    provider: "antigravity",
    profileId: "desktop",
    cwd: root,
  });
  const parentThreadId = started.thread.id;
  const parentRawId = started.thread.rawId;

  const dbWrite = new DatabaseSync(dbPath);
  const insert = dbWrite.prepare("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
  const nowIso = new Date().toISOString();
  insert.run(parentRawId, "父会话", "", 1, nowIso, JSON.stringify([`file://${root}`]), "RUNNING", "USER", "", 1, 0, desktopDir);
  insert.run("sub-perm-1", "子代理任务", "", 1, nowIso, JSON.stringify([`file://${root}`]), "RUNNING", "SUBAGENT", parentRawId, 1, 0, desktopDir);
  insert.run("sub-perm-2", "子代理任务2", "", 1, nowIso, JSON.stringify([`file://${root}`]), "RUNNING", "SUBAGENT", parentRawId, 1, 0, desktopDir);
  dbWrite.close();

  assert.equal(resolveAntigravityRootConversationId(desktopDir, "sub-perm-1"), parentRawId);

  await hub.sendTurn({
    threadId: parentThreadId,
    text: "[AGY_SUBAGENT_PERMISSION:sub-perm-1]",
    permissionMode: "workspace",
  });
  const pending1 = await waitFor(() => {
    const items = hub.pendingRequestsForThread(parentThreadId);
    return items.length === 1 ? items[0] : null;
  });
  assert.match(pending1.title, /^\[子代理\]/);
  await hub.respondToRequest(pending1.id, { decision: "accept" });
  const done1 = await waitFor(() => completions.find((c) => c.threadId === parentThreadId && c.lastAgentMessage.includes("allow_once")));
  assert.equal(done1.status, "completed");

  await hub.sendTurn({
    threadId: parentThreadId,
    text: "[AGY_SUBAGENT_PERMISSION:sub-perm-2]",
    permissionMode: "turbo",
  });
  const done2 = await waitFor(() => completions.find((c) => c.threadId === parentThreadId && c.lastAgentMessage.includes("allow_always")));
  assert.equal(done2.status, "completed");
  assert.equal(hub.allPendingRequests().length, 0);

  await hub.sendTurn({
    threadId: parentThreadId,
    text: "[AGY_SUBAGENT_PERMISSION:sub-perm-1]",
    permissionMode: "workspace",
  });
  await waitFor(() => hub.pendingRequestsForThread(parentThreadId).length === 1);
  await hub.interrupt({ threadId: parentThreadId });
  assert.equal(hub.pendingRequestsForThread(parentThreadId).length, 0);
});

test("AntigravityProvider force-releases hung session/cancel, recovers steer, and suppresses 45s post-interrupt disk live bounce", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-agy-hang-"));
  const desktopDir = resolve(root, "agy-desktop");
  await mkdir(desktopDir, { recursive: true });
  let provider = null;
  t.after(async () => {
    await provider?.close().catch(() => {});
    await rm(root, { recursive: true, force: true });
  });

  const events = [];
  provider = new AntigravityProvider({
    env: {
      ...process.env,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([
        { id: "desktop", label: "Antigravity", home: desktopDir, profileType: "desktop" },
      ]),
    },
    onEvent: (ev) => events.push(ev),
  });

  const { thread } = await provider.startThread({ profileId: "desktop", cwd: root });
  const rawId = thread.rawId;
  const dbPath = resolve(desktopDir, "conversation_summaries.db");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      step_count INTEGER,
      last_modified_time TEXT,
      workspace_uris TEXT,
      status TEXT,
      source TEXT,
      parent_conversation_id TEXT,
      not_fully_idle INTEGER,
      killed INTEGER,
      app_data_dir TEXT
    );
  `);
  db.prepare("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    rawId,
    "长耗时中断恢复测试",
    "",
    1,
    new Date().toISOString(),
    JSON.stringify([`file://${root}`]),
    "RUNNING",
    "USER",
    "",
    1,
    0,
    desktopDir,
  );
  db.close();
  const logDir = resolve(desktopDir, "brain", rawId, ".system_generated", "logs");
  await mkdir(logDir, { recursive: true });
  const transcriptPath = resolve(logDir, "transcript.jsonl");
  await writeFile(
    transcriptPath,
    JSON.stringify({
      step_index: 0,
      type: "PLANNER_RESPONSE",
      status: "RUNNING",
      thinking: "正在排查问题…",
      created_at: new Date().toISOString(),
    }) + "\n",
  );

  await provider.sendTurn({ profileId: "desktop", rawId, cwd: root, text: "[HANG_CANCEL]" });
  const liveBefore = await provider.getActivity("desktop", rawId);
  assert.equal(liveBefore.live, true);

  const intRes = await provider.interrupt({
    profileId: "desktop",
    rawId,
    waitMs: 120,
    forceRelease: true,
  });
  assert.equal(intRes.forceReleased, true);

  const actAfter = await provider.getActivity("desktop", rawId);
  assert.equal(actAfter.live, false);
  const readAfter = await provider.readThread("desktop", rawId);
  assert.equal(readAfter.thread.live, false);

  await provider.sendTurn({ profileId: "desktop", rawId, cwd: root, text: "恢复后首条消息" });
  await waitFor(() => events.some((ev) => ev.type === "turn_completed" && ev.status === "completed" && String(ev.lastAgentMessage || "").includes("恢复后首条消息")));

  await provider.sendTurn({ profileId: "desktop", rawId, cwd: root, text: "[HANG_CANCEL]" });
  await provider.sendTurn({ profileId: "desktop", rawId, cwd: root, text: "插话强切恢复", steer: true });
  await waitFor(() => events.some((ev) => ev.type === "turn_completed" && ev.status === "completed" && String(ev.lastAgentMessage || "").includes("插话强切恢复")));

  const futureSec = (Date.now() + 3_000) / 1000;
  await writeFile(
    transcriptPath,
    JSON.stringify({
      step_index: 1,
      type: "PLANNER_RESPONSE",
      status: "RUNNING",
      thinking: "外部桌面端新回合恢复运行",
      created_at: new Date().toISOString(),
    }) + "\n",
  );
  await utimes(transcriptPath, futureSec, futureSec);
  const actResumed = await provider.getActivity("desktop", rawId);
  assert.equal(actResumed.live, true);
});

test("parseAntigravityTranscript hides image-only XML wrappers and readAntigravityLiveActivity clears stale thought on terminal planner wait", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-agy-xml-"));
  const desktopDir = resolve(root, "agy-desktop");
  const rawId = "conv-img-xml-1";
  const logDir = resolve(desktopDir, "brain", rawId, ".system_generated", "logs");
  await mkdir(logDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const transcriptPath = resolve(logDir, "transcript.jsonl");
  const mediaPath = resolve(root, "shot.jpg");
  await writeFile(
    transcriptPath,
    [
      JSON.stringify({
        step_index: 0,
        type: "USER_INPUT",
        source: "USER_EXPLICIT",
        created_at: new Date().toISOString(),
        media: [{ uri: mediaPath }],
        content: `${mediaPath}\n\n<USER_REQUEST>\n\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe user has uploaded 1 image(s)\n</ADDITIONAL_METADATA>\n<USER_SETTINGS_CHANGE>\nThe user changed setting Model Selection\n</USER_SETTINGS_CHANGE>`,
      }),
      JSON.stringify({
        step_index: 1,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        thinking: "旧的思考内容不应残留在最终答复下方",
        content: "已发起子代理排查，等待汇总结果。",
        created_at: new Date().toISOString(),
      }),
    ].join("\n") + "\n",
  );

  const rawLines = (await readFile(transcriptPath, "utf8")).split("\n");
  const parsed = parseAntigravityTranscript(rawLines);
  assert.equal(parsed.turns.length, 1);
  const userContent = parsed.turns[0].items[0].content;
  assert.deepEqual(userContent, [{ type: "localImage", path: mediaPath }]);

  const act = await readAntigravityLiveActivity(desktopDir, rawId, {
    indexedThread: { id: rawId, live: true, stepCount: 2, updatedAt: Math.floor(Date.now() / 1000) },
  });
  assert.equal(act.live, true);
  assert.equal(act.lastThought, "");
  assert.equal(act.phase, "等待子代理或后台任务完成…");
});

test("AntigravityProvider isolates --dangerously-skip-permissions ACP client for turbo/full and handles background wakeup permissions", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-agy-bgperm-"));
  const desktopDir = resolve(dir, "desktop");
  await mkdir(desktopDir, { recursive: true });
  let provider = null;
  t.after(async () => {
    await provider?.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });

  const serverRequests = [];
  const completions = [];
  provider = new AntigravityProvider({
    env: {
      ...process.env,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([
        { id: "desktop", label: "Antigravity 桌面", home: desktopDir, profileType: "desktop" },
      ]),
    },
    onEvent: (evt) => {
      if (evt.type === "turn_completed") completions.push(evt);
    },
    onServerRequest: (req) => serverRequests.push(req),
  });

  const bgOutPath = resolve(dir, "bg-wakeup.txt");
  const turboStarted = await provider.startThread({
    profileId: "desktop",
    cwd: dir,
    text: `[AGY_BG_WAKEUP_PERMISSION][OUT:${bgOutPath}]`,
    permissionMode: "turbo",
  });
  assert.equal(turboStarted.thread.permissionMode, "turbo");
  const cTurbo = await waitFor(() => completions.length >= 1 && completions[0]);
  assert.equal(cTurbo.status, "completed");

  let bgContent = "";
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    bgContent = await readFile(bgOutPath, "utf8").catch(() => "");
    if (bgContent) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(bgContent, "bg_approved:allow_always:true");
  assert.equal(serverRequests.length, 0);

  const wsStarted = await provider.startThread({
    profileId: "desktop",
    cwd: dir,
    text: "工作区手动确认 [AGY_PERMISSION]",
    permissionMode: "workspace",
  });
  const perm = await waitFor(() => serverRequests.find((r) => r.kind === "acpPermission"));
  assert.equal(wsStarted.thread.permissionMode, "workspace");
  provider.respondServerRequest("desktop", perm, { optionId: "allow_once" });
  const cWs = await waitFor(() => completions.length >= 2 && completions[1]);
  assert.equal(cWs.status, "completed");
  assert.match(cWs.lastAgentMessage, /allow_once/);
});

test("readAntigravityLiveActivity stays live past terminal grace while async task or schedule timer is unresolved", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-agy-pending-async-"));
  const desktopDir = resolve(root, "agy-desktop");
  const rawId = "conv-pending-async-1";
  const logDir = resolve(desktopDir, "brain", rawId, ".system_generated", "logs");
  await mkdir(logDir, { recursive: true });
  t.after(() => rm(root, { recursive: true, force: true }));

  const nowMs = Date.now();
  const stalePastGraceMs = nowMs - 90_000;
  const atIso = new Date(stalePastGraceMs).toISOString();
  const transcriptPath = resolve(logDir, "transcript.jsonl");

  const baseSteps = [
    JSON.stringify({
      step_index: 10,
      type: "GENERIC",
      status: "RUNNING",
      created_at: atIso,
      content: `Tool is running as a background task with task id: ${rawId}/task-10\nTask Description: npm test full suite`,
    }),
    JSON.stringify({
      step_index: 11,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: atIso,
      tool_calls: [{
        name: "schedule",
        args: {
          DurationSeconds: 180,
          TimerCondition: `${rawId}/task-10`,
          Prompt: "检查测试任务状态",
        },
      }],
    }),
    JSON.stringify({
      step_index: 12,
      type: "GENERIC",
      status: "RUNNING",
      created_at: atIso,
      content: `Tool is running as a background task with task id: ${rawId}/task-11\nTask Description: Timer: 3m, Prompt: 检查测试任务状态`,
    }),
    JSON.stringify({
      step_index: 13,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: atIso,
      content: "正在等待后台测试与定时器结果，完成后汇报。",
    }),
  ];
  await writeFile(transcriptPath, `${baseSteps.join("\n")}\n`, "utf8");
  await utimes(transcriptPath, new Date(stalePastGraceMs), new Date(stalePastGraceMs));

  const indexed = {
    id: rawId,
    live: true,
    stepCount: 14,
    updatedAt: Math.floor(stalePastGraceMs / 1000),
  };

  // Even 90s (>30s terminalStepGraceMs) after the interim reply, unresolved task + schedule must keep live=true.
  const waitingAct = await readAntigravityLiveActivity(desktopDir, rawId, {
    indexedThread: indexed,
    nowMs,
  });
  assert.equal(waitingAct.live, true);
  assert.equal(waitingAct.phase, "等待子代理或后台任务完成…");
  assert.match(waitingAct.detail, /Timer: 3m/);
  assert.match(waitingAct.detail, /已执行 14 步/);

  // Arrival of SYSTEM_MESSAGE from task-10 resolves both task-10 and its TimerCondition-linked schedule task-11.
  const afterDoneSteps = [
    ...baseSteps,
    JSON.stringify({
      step_index: 14,
      type: "SYSTEM_MESSAGE",
      status: "DONE",
      created_at: atIso,
      content: `[Message] sender=${rawId}/task-10 priority=MESSAGE_PRIORITY_HIGH content=Task finished`,
    }),
    JSON.stringify({
      step_index: 15,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: atIso,
      content: "全部测试已完成并交付。",
    }),
  ];
  await writeFile(transcriptPath, `${afterDoneSteps.join("\n")}\n`, "utf8");
  await utimes(transcriptPath, new Date(stalePastGraceMs), new Date(stalePastGraceMs));

  const settledAct = await readAntigravityLiveActivity(desktopDir, rawId, {
    indexedThread: indexed,
    nowMs,
  });
  assert.equal(settledAct.live, false);

  // Server restart notice must also clear any earlier unresolved background tasks/timers.
  const afterRestartSteps = [
    ...baseSteps,
    JSON.stringify({
      step_index: 14,
      type: "SYSTEM_MESSAGE",
      status: "DONE",
      created_at: atIso,
      content: "[Notice] All your subagents and background tasks have been stopped due to server restart.",
    }),
    JSON.stringify({
      step_index: 15,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: atIso,
      content: "服务重启已记录。",
    }),
  ];
  await writeFile(transcriptPath, `${afterRestartSteps.join("\n")}\n`, "utf8");
  await utimes(transcriptPath, new Date(stalePastGraceMs), new Date(stalePastGraceMs));

  const restartedAct = await readAntigravityLiveActivity(desktopDir, rawId, {
    indexedThread: indexed,
    nowMs,
  });
  assert.equal(restartedAct.live, false);
});

test("antigravity-history captures per-turn models (including dual-model switches) and thread model", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-agy-models-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const rawId = "agy-models-session-1";
  const logsDir = resolve(dir, "brain", rawId, ".system_generated", "logs");
  await mkdir(logsDir, { recursive: true });
  const lines = [
    JSON.stringify({
      step_index: 0,
      type: "USER_INPUT",
      source: "USER_EXPLICIT",
      status: "DONE",
      created_at: "2026-11-16T08:00:00Z",
      content: "先用规划模型拆解，再交给执行模型",
    }),
    JSON.stringify({
      step_index: 1,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-16T08:00:02Z",
      model: "gemini-pro-orchestrator",
      tool_calls: [{ id: "tc-1", name: "run_command", args: { CommandLine: "npm run check" } }],
    }),
    JSON.stringify({
      step_index: 2,
      type: "GENERIC",
      status: "DONE",
      created_at: "2026-11-16T08:00:04Z",
      content: "Syntax OK",
    }),
    JSON.stringify({
      step_index: 3,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-16T08:00:06Z",
      model: "gemini-4-hydrogen-low",
      content: "已完成检查并交回成果。",
    }),
  ];
  await writeFile(resolve(logsDir, "transcript.jsonl"), `${lines.join("\n")}\n`, "utf8");

  const parsed = parseAntigravityTranscript(lines, { rawId });
  assert.equal(parsed.turns.length, 1);
  assert.equal(parsed.turns[0].model, "gemini-4-hydrogen-low");
  assert.deepEqual(parsed.turns[0].models, ["gemini-pro-orchestrator", "gemini-4-hydrogen-low"]);

  const loaded = await readAntigravityThreadHistory(dir, rawId);
  assert.equal(loaded.thread.model, "gemini-4-hydrogen-low");
  assert.deepEqual(loaded.thread.turns[0].models, ["gemini-pro-orchestrator", "gemini-4-hydrogen-low"]);
});

test("AntigravityProvider slims acp_tool_update payloads and suppresses idle late session/update broadcasts", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-agy-sse-slim-"));
  const desktopDir = resolve(dir, "desktop");
  await mkdir(desktopDir, { recursive: true });
  let provider = null;
  t.after(async () => {
    await provider?.close().catch(() => {});
    await rm(dir, { recursive: true, force: true });
  });

  const allEvents = [];
  provider = new AntigravityProvider({
    env: {
      ...process.env,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([
        { id: "desktop", label: "Antigravity 桌面", home: desktopDir, profileType: "desktop" },
      ]),
    },
    onEvent: (evt) => allEvents.push(evt),
  });

  const startedLarge = await provider.startThread({
    profileId: "desktop",
    cwd: dir,
    text: "测试大工具更新裁剪 [LARGE_TOOL_UPDATE]",
  });
  await waitFor(() =>
    allEvents.find((e) => e.type === "turn_completed" && e.rawId === startedLarge.thread.rawId),
  );
  const slimToolEvt = allEvents.find(
    (e) => e.type === "acp_tool_update" && e.rawId === startedLarge.thread.rawId && e.update?.toolCallId === "tc-large-1",
  );
  assert.ok(slimToolEvt);
  assert.equal(slimToolEvt.update.title, "读取桌面大图");
  assert.ok(String(slimToolEvt.update.status || "").length <= 601);
  assert.equal(Object.hasOwn(slimToolEvt.update, "rawOutput"), false);
  assert.equal(Object.hasOwn(slimToolEvt.update, "rawInput"), false);
  assert.equal(Object.hasOwn(slimToolEvt.update, "content"), false);
  assert.equal(Object.hasOwn(slimToolEvt.update, "locations"), false);

  const startedStale = await provider.startThread({
    profileId: "desktop",
    cwd: dir,
    text: "测试空闲回放抑制 [STALE_AFTER_DONE]",
  });
  await waitFor(() =>
    allEvents.find((e) => e.type === "turn_completed" && e.rawId === startedStale.thread.rawId),
  );
  // Wait long enough for mock-agy-cli's 40ms post-turn session/update burst to arrive.
  await new Promise((r) => setTimeout(r, 140));
  assert.equal(
    allEvents.some((e) => JSON.stringify(e).includes("STALE_IDLE_")),
    false,
  );
});

test("Antigravity ask_question parses questions, emits userInput request on readThread, formats follow-up answer, and renders cleanly", async (t) => {
  const { parseAntigravityTranscript, extractPendingAskQuestionFromTurns } = await import("../src/providers/antigravity-history.mjs");
  const { renderTurnHtml } = await import("../public/markdown.js");

  const root = await mkdtemp(resolve(os.tmpdir(), "ac-agy-ask-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const agyHome = resolve(root, ".gemini", "antigravity");
  const rawId = "conv-ask-1";
  const logsDir = resolve(agyHome, "brain", rawId, ".system_generated", "logs");
  await mkdir(logsDir, { recursive: true });
  const questionsJson = JSON.stringify([
    {
      is_multi_select: false,
      question: "设计树第 1 题：活跃时间窗怎么划定？",
      options: ["(Recommended) 近 7 天活跃优先", "全量近 30 天"],
    },
  ]);
  const lines = [
    JSON.stringify({ step_index: 1, type: "USER_INPUT", status: "DONE", created_at: "2026-11-18T06:28:26Z", content: "/grill-me 面板功能" }),
    JSON.stringify({
      step_index: 2,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-18T06:28:27Z",
      thinking: "Thinking...",
      tool_calls: [{ name: "ask_question", args: { questions: questionsJson } }],
    }),
  ];
  await writeFile(resolve(logsDir, "transcript.jsonl"), `${lines.join("\n")}\n`, "utf8");

  const parsed = parseAntigravityTranscript(lines);
  assert.equal(parsed.turns.length, 1);
  const pending = extractPendingAskQuestionFromTurns(parsed.turns);
  assert.ok(pending);
  assert.equal(pending.questions.length, 1);
  assert.equal(pending.questions[0].options.length, 2);

  const html = renderTurnHtml(parsed.turns[0], { showIncompleteSummaryHint: true });
  assert.match(html, /设计树第 1 题/);
  assert.match(html, /近 7 天活跃优先/);
  assert.doesNotMatch(html, /本轮停在工具执行步/);

  const requests = [];
  const provider = new AntigravityProvider({
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      AGY_BIN: fileURLToPath(new URL("./helpers/mock-agy-cli.mjs", import.meta.url)),
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "desktop", home: agyHome }]),
    },
    onServerRequest: (req) => requests.push(req),
  });
  t.after(() => provider.close());

  await provider.readThread("desktop", rawId, { detail: "full" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].kind, "userInput");
  assert.equal(requests[0].questions[0].question, "设计树第 1 题：活跃时间窗怎么划定？");

  const res = provider.respondServerRequest("desktop", requests[0], {
    decision: "accept",
    answers: { q_0: { answers: ["(Recommended) 近 7 天活跃优先"] } },
  });
  assert.equal(res.ok, true);
  assert.equal(res.followUpText, "(Recommended) 近 7 天活跃优先");
});

test("ProviderHub pins explicit creation cwd against Antigravity multi-workspace DB drift across list, read, send, and reload", async (t) => {
  const { threadMetaPath } = await import("../src/thread-meta-store.mjs");
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-pin-cwd-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const dataDir = resolve(root, "data");
  const projectA = resolve(root, "project-a");
  const driftedRepo = resolve(root, "zzz-other-repo");
  const sentTurns = [];
  const storedThreads = new Map();

  const createMockAgyProvider = () => ({
    id: "antigravity",
    async listProfiles() {
      return [{ id: "desktop", provider: "antigravity", label: "Antigravity", installed: true }];
    },
    async listThreads() {
      return [...storedThreads.values()];
    },
    async startThread({ profileId = "desktop", cwd = "", text = "" } = {}) {
      const rawId = `conv-${storedThreads.size + 1}`;
      const actualCwd = cwd || driftedRepo;
      // Simulate upstream Antigravity DB reporting multi-workspace sorted URI (driftedRepo) on subsequent reads
      storedThreads.set(rawId, {
        id: `antigravity:${profileId}:${rawId}`,
        rawId,
        provider: "antigravity",
        profileId,
        cwd: driftedRepo,
        title: text || "新会话",
        updatedAt: Math.floor(Date.now() / 1000),
      });
      return {
        thread: {
          id: `antigravity:${profileId}:${rawId}`,
          rawId,
          provider: "antigravity",
          profileId,
          cwd: actualCwd,
          title: text || "新会话",
          updatedAt: Math.floor(Date.now() / 1000),
        },
        turn: { id: "turn-1", status: "completed" },
      };
    },
    async readThread(_profileId, rawId) {
      const entry = storedThreads.get(rawId);
      return {
        thread: { ...entry, cwd: driftedRepo, turns: [] },
        nextCursor: null,
      };
    },
    async sendTurn({ profileId = "desktop", rawId, cwd = "", text = "" } = {}) {
      sentTurns.push({ profileId, rawId, cwd, text });
      const entry = storedThreads.get(rawId);
      return {
        turn: { id: "turn-2", status: "completed" },
        thread: { ...entry, cwd: driftedRepo },
      };
    },
  });

  const hub1 = new ProviderHub({
    dataDir,
    providers: [createMockAgyProvider()],
    enableQueueDrain: false,
  });
  await hub1.init();

  // 1. Thread created under explicit project-a stays pinned to project-a
  const createdPinned = await hub1.startThread({
    provider: "antigravity",
    profileId: "desktop",
    cwd: projectA,
    text: "客户问题分析",
  });
  assert.equal(createdPinned.thread.cwd, projectA);

  // 2. Thread created with blank cwd does NOT get a pinned cwd override
  const createdGlobal = await hub1.startThread({
    provider: "antigravity",
    profileId: "desktop",
    cwd: "",
    text: "全局默认会话",
  });

  const listed1 = await hub1.listThreads({ provider: "antigravity" });
  const listedPinned = listed1.threads.find((th) => th.id === createdPinned.thread.id);
  const listedGlobal = listed1.threads.find((th) => th.id === createdGlobal.thread.id);
  assert.equal(listedPinned?.cwd, projectA);
  assert.equal(listedGlobal?.cwd, driftedRepo);

  const readRes = await hub1.readThread(createdPinned.thread.id);
  assert.equal(readRes.thread.cwd, projectA);

  await hub1.sendTurn({ threadId: createdPinned.thread.id, text: "follow up" });
  assert.equal(sentTurns.length, 1);
  assert.equal(sentTurns[0].cwd, projectA);

  await hub1.close();

  const metaRaw = JSON.parse(await readFile(threadMetaPath(dataDir), "utf8"));
  assert.equal(metaRaw.threads[createdPinned.thread.id]?.cwd, projectA);
  assert.equal(metaRaw.threads[createdGlobal.thread.id]?.cwd, undefined);

  // 3. Reloading a fresh ProviderHub preserves pinned cwd from thread-meta.json
  const hub2 = new ProviderHub({
    dataDir,
    providers: [createMockAgyProvider()],
    enableQueueDrain: false,
  });
  await hub2.init();
  const listed2 = await hub2.listThreads({ provider: "antigravity" });
  assert.equal(listed2.threads.find((th) => th.id === createdPinned.thread.id)?.cwd, projectA);
  await hub2.close();
});

test("readAntigravityThreadHistory merges step_type=17 ERROR_MESSAGE from conversation sqlite db", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-agy-errstep-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const convId = "conv-errstep-quota-1";
  const logsDir = resolve(dir, "brain", convId, ".system_generated", "logs");
  const convDir = resolve(dir, "conversations");
  await mkdir(logsDir, { recursive: true });
  await mkdir(convDir, { recursive: true });

  const transcriptSteps = [
    {
      step_index: 0,
      type: "USER_INPUT",
      source: "USER_EXPLICIT",
      status: "DONE",
      created_at: "2026-11-24T06:54:12Z",
      content: "<USER_REQUEST>\n你继续做\n</USER_REQUEST>",
    },
    {
      step_index: 1,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-24T06:54:12Z",
      model: "claude-opus-5-5-medium",
      tool_calls: [{ name: "run_command", args: { CommandLine: "git status", toolSummary: "Check status" } }],
    },
    {
      step_index: 2,
      type: "GENERIC",
      status: "DONE",
      created_at: "2026-11-24T06:54:17Z",
      content: "Command exited with code 0.",
    },
    // step_index 3 is omitted from transcript.jsonl by Antigravity (ERROR_MESSAGE only in conversations/<id>.db)
    {
      step_index: 4,
      type: "USER_INPUT",
      source: "USER_EXPLICIT",
      status: "DONE",
      created_at: "2026-11-24T06:54:27Z",
      content: "<USER_REQUEST>\n继续\n</USER_REQUEST>",
    },
    // step_index 5 is omitted from transcript.jsonl as well
  ];
  await writeFile(resolve(logsDir, "transcript.jsonl"), transcriptSteps.map((s) => JSON.stringify(s)).join("\n") + "\n");

  const encodeErrorStep = ({ message, model, tsSec }) => {
    const errInfoJson = JSON.stringify({
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      reason: "QUOTA_EXHAUSTED",
      metadata: { model },
    });
    const f24_3 = Buffer.concat([
      encodePbLenField(1, message),
      encodePbLenField(2, `RESOURCE_EXHAUSTED (code 429): ${message}`),
      encodePbLenField(10, errInfoJson),
    ]);
    const f24 = encodePbLenField(3, f24_3);
    const payload = Buffer.concat([
      encodePbVarint((1 << 3) | 0), encodePbVarint(17),
      encodePbLenField(24, f24),
    ]);
    const tsBuf = Buffer.concat([encodePbVarint((1 << 3) | 0), encodePbVarint(tsSec)]);
    const metadata = encodePbLenField(1, tsBuf);
    return { payload, metadata };
  };

  const db = new DatabaseSync(resolve(convDir, `${convId}.db`));
  db.exec(`
    CREATE TABLE steps (
      idx INTEGER PRIMARY KEY,
      step_type INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 0,
      metadata BLOB,
      step_payload BLOB
    );
  `);
  const insert = db.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)");
  const err3 = encodeErrorStep({
    message: "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 26h41m11s.",
    model: "claude-opus-5-5-medium",
    tsSec: 1795503258,
  });
  const err5 = encodeErrorStep({
    message: "Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 26h41m1s.",
    model: "claude-opus-5-5-medium",
    tsSec: 1795503268,
  });
  insert.run(3, 17, 3, err3.metadata, err3.payload);
  insert.run(5, 17, 3, err5.metadata, err5.payload);
  db.close();

  const hist = await readAntigravityThreadHistory(dir, convId, { detail: "auto", limit: 20 });
  assert.equal(hist.thread.turns.length, 2);
  assert.equal(hist.thread.turns[0].status, "failed");
  assert.match(hist.thread.turns[0].error?.message || "", /Individual quota reached.*26h41m11s/);
  assert.equal(hist.thread.turns[1].status, "failed");
  assert.match(hist.thread.turns[1].error?.message || "", /Individual quota reached.*26h41m1s/);
  assert.equal(hist.thread.turns[1].model, "claude-opus-5-5-medium");
});

test("isPendingAskQuestionInSteps detects unresolved ask_question across parallel tools and clears on answer", () => {
  const userStep = { step_index: 1, type: "USER_INPUT", source: "USER_EXPLICIT", status: "DONE", content: "hi" };
  const askOnly = {
    step_index: 2,
    type: "PLANNER_RESPONSE",
    status: "DONE",
    tool_calls: [{ name: "ask_question", args: { questions: "[]" } }],
  };
  assert.equal(isPendingAskQuestionInSteps([userStep, askOnly]), true);

  const parallelTools = {
    step_index: 2,
    type: "PLANNER_RESPONSE",
    status: "DONE",
    tool_calls: [
      { name: "update_steps", args: {} },
      { name: "ask_question", args: { questions: "[]" } },
    ],
  };
  const firstGenericDone = { step_index: 3, type: "GENERIC", status: "DONE", content: "OK" };
  assert.equal(isPendingAskQuestionInSteps([userStep, parallelTools, firstGenericDone]), true);

  const runningGeneric = { step_index: 3, type: "GENERIC", status: "RUNNING", content: "Waiting..." };
  assert.equal(isPendingAskQuestionInSteps([userStep, askOnly, runningGeneric]), true);

  const answeredGeneric = { step_index: 3, type: "GENERIC", status: "DONE", content: "Created At: ...\nA1: 1" };
  assert.equal(isPendingAskQuestionInSteps([userStep, askOnly, answeredGeneric]), false);

  const nextUser = { step_index: 3, type: "USER_INPUT", source: "USER_EXPLICIT", status: "DONE", content: "选 1" };
  assert.equal(isPendingAskQuestionInSteps([userStep, askOnly, nextUser]), false);
});

test("Antigravity live ask_question clears fake live state, emits card on hub.readThread, ignores pagination, and clears after desktop answer", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-agy-ask-live-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const desktopDir = resolve(root, "desktop");
  const dataDir = resolve(root, "data");
  const convId = "conv-ask-live-1";
  const logsDir = resolve(desktopDir, "brain", convId, ".system_generated", "logs");
  await mkdir(logsDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  const nowIso = new Date().toISOString();
  const db = new DatabaseSync(resolve(desktopDir, "conversation_summaries.db"));
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      step_count INTEGER,
      last_modified_time TEXT,
      workspace_uris TEXT,
      status TEXT,
      source TEXT,
      parent_conversation_id TEXT,
      not_fully_idle INTEGER,
      killed INTEGER,
      app_data_dir TEXT
    );
  `);
  db.prepare(`
    INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    convId,
    "提问卡片测试",
    "提问卡片测试",
    6,
    nowIso,
    JSON.stringify(["file:///tmp/mock-agy-project"]),
    "CASCADE_RUN_STATUS_IDLE",
    "",
    "",
    1,
    0,
    "",
  );
  db.close();

  const questionsJson = JSON.stringify([
    {
      is_multi_select: false,
      question: "hotmail 限额了，接下来希望怎么继续？",
      options: [
        "(Recommended) 切到本机 iCloud 账号继续",
        "挂定时任务等重置",
        "直接由当前模型接手",
      ],
    },
  ]);

  const initialSteps = [
    { step_index: 1, type: "USER_INPUT", source: "USER_EXPLICIT", status: "DONE", created_at: nowIso, content: "帮我继续" },
    { step_index: 2, type: "PLANNER_RESPONSE", status: "DONE", created_at: nowIso, tool_calls: [{ name: "run_command", args: { CommandLine: "ls", toolSummary: "Check dir" } }] },
  ];
  const transcriptPath = resolve(logsDir, "transcript.jsonl");
  await writeFile(transcriptPath, initialSteps.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");

  const provider = new AntigravityProvider({
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "desktop", label: "Antigravity", home: desktopDir, profileType: "desktop" }]),
    },
  });
  const hub = new ProviderHub({
    dataDir,
    providers: [provider],
    enableQueueDrain: false,
  });
  await hub.init();
  t.after(() => hub.close());

  const compositeId = `antigravity:desktop:${convId}`;
  const act1 = await provider.getActivity("desktop", convId);
  assert.equal(act1.live, true);

  // Transition transcript to pending ask_question while DB still keeps not_fully_idle = 1
  const askSteps = [
    ...initialSteps,
    { step_index: 3, type: "GENERIC", status: "DONE", created_at: nowIso, content: "ok" },
    { step_index: 4, type: "USER_INPUT", source: "USER_EXPLICIT", status: "DONE", created_at: nowIso, content: "再看看" },
    { step_index: 5, type: "PLANNER_RESPONSE", status: "DONE", created_at: nowIso, tool_calls: [{ name: "ask_question", args: { questions: questionsJson } }] },
  ];
  await writeFile(transcriptPath, askSteps.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");
  const nextMtime = new Date(Date.now() + 2000);
  await utimes(transcriptPath, nextMtime, nextMtime);

  const directLive = await readAntigravityLiveActivity(desktopDir, convId, { profileType: "desktop" });
  assert.equal(directLive.live, false);
  assert.equal(directLive.pendingAskQuestion, true);
  assert.equal(directLive.phase, "");

  const indexedList = readAntigravityIndexedThreads(desktopDir, { profileType: "desktop" });
  assert.equal(indexedList.find((item) => item.id === convId)?.live, false);

  const act2 = await provider.getActivity("desktop", convId, { cursor: act1.cursor });
  assert.equal(act2.live, false);
  assert.equal(act2.changed, true);

  const readLatest = await hub.readThread(compositeId, { limit: 12 });
  assert.equal(readLatest.thread.live, false);
  assert.equal(readLatest.pendingRequests.length, 1);
  assert.equal(readLatest.pendingRequests[0].kind, "userInput");
  assert.equal(readLatest.pendingRequests[0].questions[0].options.length, 3);

  const readOlderPage = await hub.readThread(compositeId, { cursor: "turn:1", limit: 1 });
  assert.equal(readOlderPage.pendingRequests.length, 1);

  // Simulate user answering in Antigravity Desktop
  const answeredSteps = [
    ...askSteps,
    { step_index: 6, type: "GENERIC", status: "DONE", created_at: nowIso, content: "Created At: ...\nA1: 1" },
  ];
  await writeFile(transcriptPath, answeredSteps.map((s) => JSON.stringify(s)).join("\n") + "\n", "utf8");
  const mtime3 = new Date(Date.now() + 4000);
  await utimes(transcriptPath, mtime3, mtime3);

  const readAfterDesktopAnswer = await hub.readThread(compositeId, { limit: 12 });
  assert.equal(readAfterDesktopAnswer.pendingRequests.length, 0);
});

test("Antigravity ask_question supports leading text, dedupes identical signature, and avoids re-emitting right after answer", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-agy-ask-dedupe-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const desktopDir = resolve(root, "desktop");
  const dataDir = resolve(root, "data");
  const convId = "conv-ask-dedupe-1";
  const logsDir = resolve(desktopDir, "brain", convId, ".system_generated", "logs");
  await mkdir(logsDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  const nowIso = new Date().toISOString();
  const questionsJson = JSON.stringify([
    {
      is_multi_select: false,
      question: "请选择执行方案",
      options: ["方案 A", "方案 B"],
    },
  ]);
  const lines = [
    JSON.stringify({ step_index: 1, type: "USER_INPUT", source: "USER_EXPLICIT", status: "DONE", created_at: nowIso, content: "开始" }),
    JSON.stringify({
      step_index: 2,
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: nowIso,
      content: "以下是前置说明文字，随后请求确认：",
      tool_calls: [{ name: "ask_question", args: { questions: questionsJson } }],
    }),
  ];
  await writeFile(resolve(logsDir, "transcript.jsonl"), `${lines.join("\n")}\n`, "utf8");

  const provider = new AntigravityProvider({
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "desktop", label: "Antigravity", home: desktopDir, profileType: "desktop" }]),
    },
  });
  const hub = new ProviderHub({
    dataDir,
    providers: [provider],
    enableQueueDrain: false,
  });
  await hub.init();
  t.after(() => hub.close());
  const hubEvents = [];
  hub.subscribe((event, payload) => hubEvents.push({ event, payload }));

  const compositeId = `antigravity:desktop:${convId}`;
  const res1 = await hub.readThread(compositeId, { limit: 12 });
  assert.equal(res1.pendingRequests.length, 1);
  assert.equal(res1.pendingRequests[0].questions[0].question, "请选择执行方案");

  // Responding via card clears it and immediately reading before transcript writes GENERIC must not bounce it back
  await hub.respondToRequest(res1.pendingRequests[0].id, {
    decision: "accept",
    answers: { q_0: { answers: ["方案 A"] } },
  });
  const resAfterAnswer = await hub.readThread(compositeId, { limit: 12 });
  assert.equal(resAfterAnswer.pendingRequests.length, 0);
  await waitFor(() => hubEvents.some((e) => e.event === "provider_event" && e.payload?.type === "turn_completed"));

  // Dedupe identical askSignature emitted with different itemId (e.g. ACP toolCallId vs transcript itemId)
  const dedupeEvents = [];
  let hubCallbacks = null;
  const mockProvider = {
    id: "antigravity",
    setCallbacks(cbs) { hubCallbacks = cbs; },
    async listProfiles() { return [{ id: "desktop", provider: "antigravity", label: "Antigravity", installed: true }]; },
    async listThreads() { return []; },
    async readThread(_profileId, rawId) {
      return { thread: { id: `antigravity:desktop:${rawId}`, rawId, provider: "antigravity", profileId: "desktop", turns: [] } };
    },
    async sendTurn({ rawId }) {
      return { turn: { id: "turn-manual", status: "inProgress" }, thread: { id: `antigravity:desktop:${rawId}`, rawId, provider: "antigravity", profileId: "desktop" } };
    },
  };
  const dedupeDataDir = resolve(root, "data-dedupe");
  await mkdir(dedupeDataDir, { recursive: true });
  const hub2 = new ProviderHub({ dataDir: dedupeDataDir, providers: [mockProvider], enableQueueDrain: false });
  await hub2.init();
  t.after(() => hub2.close());
  hub2.subscribe((event, payload) => dedupeEvents.push({ event, payload }));

  const sharedSig = JSON.stringify([["请选择执行方案", false, ["方案 A", "方案 B"]]]);
  hubCallbacks.onServerRequest({
    id: "agy-ask-conv-1-tc-acp",
    rawId: "agy-ask-conv-1-tc-acp",
    askSignature: sharedSig,
    provider: "antigravity",
    profileId: "desktop",
    rawThreadId: "conv-1",
    threadId: "antigravity:desktop:conv-1",
    kind: "userInput",
    isPromptFollowUp: true,
    questions: [{ id: "q_0", header: "问题 1", question: "请选择执行方案", options: [{ label: "方案 A" }, { label: "方案 B" }] }],
  });
  hubCallbacks.onServerRequest({
    id: "agy-ask-conv-1-agy-2-tool-0",
    rawId: "agy-ask-conv-1-agy-2-tool-0",
    askSignature: sharedSig,
    provider: "antigravity",
    profileId: "desktop",
    rawThreadId: "conv-1",
    threadId: "antigravity:desktop:conv-1",
    kind: "userInput",
    isPromptFollowUp: true,
    questions: [{ id: "q_0", header: "问题 1", question: "请选择执行方案", options: [{ label: "方案 A" }, { label: "方案 B" }] }],
  });
  assert.equal(hub2.pendingRequestsForThread("antigravity:desktop:conv-1").length, 1);

  // Manual sendTurn clears pending follow-up card
  await hub2.sendTurn({ threadId: "antigravity:desktop:conv-1", text: "方案 A" });
  assert.equal(hub2.pendingRequestsForThread("antigravity:desktop:conv-1").length, 0);
  assert.ok(dedupeEvents.some((e) => e.event === "server_request_resolved" && e.payload?.threadId === "antigravity:desktop:conv-1"));
});

function buildTestErrorStepBlob({
  userMessage = "",
  shortError = "",
  fullError = "",
  fallbackError = "",
  model = "",
  reason = "",
  tsSec = Math.floor(Date.now() / 1000),
} = {}) {
  const errFields = [];
  if (userMessage) errFields.push(encodePbLenField(1, userMessage));
  if (shortError) errFields.push(encodePbLenField(2, shortError));
  if (fullError) errFields.push(encodePbLenField(3, fullError));
  if (fallbackError) errFields.push(encodePbLenField(9, fallbackError));
  if (model || reason) {
    errFields.push(encodePbLenField(10, JSON.stringify({
      "@type": "type.googleapis.com/google.rpc.ErrorInfo",
      ...(reason ? { reason } : {}),
      ...(model ? { metadata: { model } } : {}),
    })));
  }
  const f24 = encodePbLenField(3, Buffer.concat(errFields));
  const payload = Buffer.concat([
    encodePbVarint((1 << 3) | 0), encodePbVarint(17),
    encodePbLenField(24, f24),
  ]);
  const tsBuf = Buffer.concat([encodePbVarint((1 << 3) | 0), encodePbVarint(tsSec)]);
  const metadata = encodePbLenField(1, tsBuf);
  return { payload, metadata };
}

test("decodeAntigravityErrorStepPayload exposes f2/f3 details without duplicating 429 text and clears recovered retry errors", async (t) => {
  const step401 = buildTestErrorStepBlob({
    userMessage: "Agent execution terminated due to error.",
    shortError: "UNAUTHENTICATED (code 401): Request had invalid authentication credentials.",
    fullError: "HTTP 401 Unauthorized\n{\"error\":{\"code\":401,\"status\":\"UNAUTHENTICATED\"}}",
    tsSec: 1795577313,
  });
  const decoded401 = decodeAntigravityErrorStepPayload(step401.payload, step401.metadata);
  assert.equal(
    decoded401?.message,
    "Agent execution terminated due to error.\nUNAUTHENTICATED (code 401): Request had invalid authentication credentials.",
  );
  assert.equal(decoded401?.shortError, "UNAUTHENTICATED (code 401): Request had invalid authentication credentials.");
  assert.match(decoded401?.detail || "", /HTTP 401 Unauthorized/);
  assert.equal(decoded401?.isRetryAttempt, false);

  const step429 = buildTestErrorStepBlob({
    userMessage: "Individual quota reached. Resets in 2h.",
    shortError: "RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 2h.",
    model: "claude-opus-5-5-medium",
    reason: "QUOTA_EXHAUSTED",
    tsSec: 1795577320,
  });
  const decoded429 = decodeAntigravityErrorStepPayload(step429.payload, step429.metadata);
  assert.equal(decoded429?.message, "RESOURCE_EXHAUSTED (code 429): Individual quota reached. Resets in 2h.");
  assert.equal(decoded429?.reason, "QUOTA_EXHAUSTED");

  const stepRetry = buildTestErrorStepBlob({
    shortError: "API error (attempt 1): stream reading error: unexpected EOF",
    tsSec: 1795577325,
  });
  const decodedRetry = decodeAntigravityErrorStepPayload(stepRetry.payload, stepRetry.metadata);
  assert.equal(decodedRetry?.isRetryAttempt, true);

  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-agy-errdetail-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const convId = "conv-err-recover-1";
  const logsDir = resolve(dir, "brain", convId, ".system_generated", "logs");
  const convDir = resolve(dir, "conversations");
  await mkdir(logsDir, { recursive: true });
  await mkdir(convDir, { recursive: true });

  const transcriptSteps = [
    { step_index: 0, type: "USER_INPUT", source: "USER_EXPLICIT", status: "DONE", created_at: "2026-11-25T03:00:00Z", content: "第一轮重试后恢复" },
    { step_index: 1, type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-11-25T03:00:01Z", thinking: "先试试" },
    // step 2 in DB is retry error
    { step_index: 3, type: "PLANNER_RESPONSE", status: "DONE", created_at: "2026-11-25T03:00:10Z", content: "网络抖动后已恢复并完成。" },
    { step_index: 4, type: "USER_INPUT", source: "USER_EXPLICIT", status: "DONE", created_at: "2026-11-25T03:28:00Z", content: "继续第二轮" },
    // step 5 in DB is fatal 401
  ];
  await writeFile(resolve(logsDir, "transcript.jsonl"), `${transcriptSteps.map((s) => JSON.stringify(s)).join("\n")}\n`);

  const db = new DatabaseSync(resolve(convDir, `${convId}.db`));
  db.exec(`
    CREATE TABLE steps (
      idx INTEGER PRIMARY KEY,
      step_type INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 0,
      metadata BLOB,
      step_payload BLOB
    );
  `);
  const insert = db.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)");
  insert.run(2, 17, 3, stepRetry.metadata, stepRetry.payload);
  insert.run(5, 17, 3, step401.metadata, step401.payload);
  db.close();

  const hist = await readAntigravityThreadHistory(dir, convId, { detail: "auto", limit: 20 });
  assert.equal(hist.thread.turns.length, 2);
  assert.equal(hist.thread.turns[0].status, "completed");
  assert.equal(hist.thread.turns[0].error, null);
  assert.equal(hist.thread.turns[1].status, "failed");
  assert.match(hist.thread.turns[1].error?.message || "", /Agent execution terminated due to error\.\nUNAUTHENTICATED \(code 401\)/);
  assert.match(hist.thread.turns[1].error?.detail || "", /HTTP 401 Unauthorized/);
});

test("readAntigravityTailErrorSync and readAntigravityIndexedThreads track tail step_type=17 across trailing SYSTEM_MESSAGE and clear on recovery", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-agy-tailerr-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const convId = "conv-tail-err-1";
  const logsDir = resolve(dir, "brain", convId, ".system_generated", "logs");
  const convDir = resolve(dir, "conversations");
  await mkdir(logsDir, { recursive: true });
  await mkdir(convDir, { recursive: true });

  const nowIso = new Date().toISOString();
  const sumDb = new DatabaseSync(resolve(dir, "conversation_summaries.db"));
  sumDb.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      step_count INTEGER,
      last_modified_time TEXT,
      workspace_uris TEXT,
      status TEXT,
      source TEXT,
      parent_conversation_id TEXT,
      not_fully_idle INTEGER,
      killed INTEGER,
      app_data_dir TEXT
    );
  `);
  sumDb.prepare("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    convId,
    "尾步报错测试",
    "尾步报错测试",
    4,
    nowIso,
    JSON.stringify(["file:///tmp/mock-agy-project"]),
    "CASCADE_RUN_STATUS_IDLE",
    "",
    "",
    0,
    0,
    "",
  );
  sumDb.close();

  await writeFile(
    resolve(logsDir, "transcript.jsonl"),
    [
      JSON.stringify({ step_index: 0, type: "USER_INPUT", source: "USER_EXPLICIT", status: "DONE", created_at: nowIso, content: "跑一下" }),
      JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", status: "DONE", created_at: nowIso, content: "正在处理" }),
    ].join("\n") + "\n",
  );

  const err401 = buildTestErrorStepBlob({
    userMessage: "Agent execution terminated due to error.",
    shortError: "UNAUTHENTICATED (code 401): invalid_token",
    fullError: "HTTP 401 Unauthorized",
    tsSec: Math.floor(Date.now() / 1000),
  });
  const convDbPath = resolve(convDir, `${convId}.db`);
  const db = new DatabaseSync(convDbPath);
  db.exec(`
    CREATE TABLE steps (
      idx INTEGER PRIMARY KEY,
      step_type INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 0,
      metadata BLOB,
      step_payload BLOB
    );
  `);
  const insert = db.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)");
  insert.run(0, 14, 3, Buffer.alloc(0), Buffer.alloc(0));
  insert.run(1, 15, 3, Buffer.alloc(0), Buffer.alloc(0));
  insert.run(2, 17, 3, err401.metadata, err401.payload);
  insert.run(3, 101, 3, Buffer.alloc(0), Buffer.alloc(0));
  db.close();

  const tail1 = readAntigravityTailErrorSync(dir, convId);
  assert.equal(tail1?.stepIndex, 2);
  assert.match(tail1?.shortError || "", /UNAUTHENTICATED \(code 401\)/);

  const list1 = readAntigravityIndexedThreads(dir, { profileType: "desktop" });
  const item1 = list1.find((x) => x.id === convId);
  assert.equal(item1?.lastTurnStatus, "failed");
  assert.match(item1?.lastError || "", /UNAUTHENTICATED \(code 401\)/);

  const db2 = new DatabaseSync(convDbPath);
  db2.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)").run(
    4, 15, 3, Buffer.alloc(0), Buffer.alloc(0),
  );
  db2.close();
  const futureTime = new Date(Date.now() + 2000);
  await utimes(convDbPath, futureTime, futureTime);

  assert.equal(readAntigravityTailErrorSync(dir, convId), null);
  const list2 = readAntigravityIndexedThreads(dir, { profileType: "desktop" });
  const item2 = list2.find((x) => x.id === convId);
  assert.equal(item2?.lastTurnStatus, undefined);
  assert.equal(item2?.lastError, undefined);
});

test("AntigravityProvider.sendTurn emits failed turn_completed when ACP exits end_turn after writing tail step_type=17", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-agy-send-tailerr-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const desktopDir = resolve(root, "desktop");
  const dataDir = resolve(root, "data");
  const convId = "conv-send-tailerr-1";
  const logsDir = resolve(desktopDir, "brain", convId, ".system_generated", "logs");
  const convDir = resolve(desktopDir, "conversations");
  await Promise.all([
    mkdir(logsDir, { recursive: true }),
    mkdir(convDir, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
  ]);

  const nowIso = new Date().toISOString();
  const sumDb = new DatabaseSync(resolve(desktopDir, "conversation_summaries.db"));
  sumDb.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      step_count INTEGER,
      last_modified_time TEXT,
      workspace_uris TEXT,
      status TEXT,
      source TEXT,
      parent_conversation_id TEXT,
      not_fully_idle INTEGER,
      killed INTEGER,
      app_data_dir TEXT
    );
  `);
  sumDb.prepare("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
    convId,
    "发送尾部报错检测",
    "发送尾部报错检测",
    2,
    nowIso,
    JSON.stringify(["file:///tmp/mock-agy-project"]),
    "CASCADE_RUN_STATUS_IDLE",
    "",
    "",
    0,
    0,
    "",
  );
  sumDb.close();

  await writeFile(
    resolve(logsDir, "transcript.jsonl"),
    [
      JSON.stringify({ step_index: 0, type: "USER_INPUT", source: "USER_EXPLICIT", status: "DONE", created_at: nowIso, content: "初始化" }),
      JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", status: "DONE", created_at: nowIso, content: "就绪" }),
    ].join("\n") + "\n",
  );

  const convDbPath = resolve(convDir, `${convId}.db`);
  const convDb = new DatabaseSync(convDbPath);
  convDb.exec(`
    CREATE TABLE steps (
      idx INTEGER PRIMARY KEY,
      step_type INTEGER NOT NULL DEFAULT 0,
      status INTEGER NOT NULL DEFAULT 0,
      metadata BLOB,
      step_payload BLOB
    );
  `);
  convDb.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)").run(0, 14, 3, Buffer.alloc(0), Buffer.alloc(0));
  convDb.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)").run(1, 15, 3, Buffer.alloc(0), Buffer.alloc(0));
  convDb.close();

  const provider = new AntigravityProvider({
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "desktop", label: "Antigravity", home: desktopDir, profileType: "desktop" }]),
    },
  });
  const hub = new ProviderHub({ dataDir, providers: [provider], enableQueueDrain: false });
  await hub.init();
  t.after(() => hub.close());

  const events = [];
  hub.subscribe((event, payload) => events.push({ event, payload }));
  const compositeId = `antigravity:desktop:${convId}`;

  await hub.setSettings({ agyAutoRetryAuth401: false });
  await hub.sendTurn({ threadId: compositeId, text: "[AGY_PERMISSION]" });
  const req = await waitFor(() => hub.pendingRequestsForThread(compositeId)[0]);

  const err401 = buildTestErrorStepBlob({
    userMessage: "Agent execution terminated due to error.",
    shortError: "UNAUTHENTICATED (code 401): invalid_token",
    fullError: "HTTP 401 Unauthorized",
    tsSec: Math.floor(Date.now() / 1000) + 1,
  });
  const convDb2 = new DatabaseSync(convDbPath);
  convDb2.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)").run(
    2, 17, 3, err401.metadata, err401.payload,
  );
  convDb2.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)").run(
    3, 101, 3, Buffer.alloc(0), Buffer.alloc(0),
  );
  convDb2.close();
  const bumpTime = new Date(Date.now() + 2000);
  await utimes(convDbPath, bumpTime, bumpTime);

  await hub.respondToRequest(req.id, { decision: "acceptForSession" });
  const doneEvt = await waitFor(() => events.find((e) => e.event === "provider_event" && e.payload?.type === "turn_completed"));
  assert.equal(doneEvt.payload.status, "failed");
  assert.equal(doneEvt.payload.stopReason, "error");
  assert.match(doneEvt.payload.error?.message || "", /UNAUTHENTICATED \(code 401\)/);

  const listed = await hub.listThreads({ provider: "antigravity" });
  const threadRow = listed.threads.find((t) => t.id === compositeId);
  assert.equal(threadRow?.lastTurnStatus, "failed");
  assert.match(threadRow?.lastError || "", /UNAUTHENTICATED \(code 401\)/);
});

test("agyAutoRetryAuth401 setting persists and AntigravityProvider auto-continues once on transient 401 without looping", async (t) => {
  assert.equal(
    isTransientAntigravityAuth401Error({
      message: "Agent execution terminated due to error.\nUNAUTHENTICATED (code 401): Request had invalid authentication credentials.",
      detail: 'Www-Authenticate: Bearer realm="https://accounts.google.com/", error="invalid_token"',
    }),
    true,
  );
  assert.equal(isTransientAntigravityAuth401Error({ message: "RESOURCE_EXHAUSTED (code 429): Individual quota reached." }), false);
  assert.equal(isTransientAntigravityAuth401Error({ message: "INVALID_ARGUMENT (code 400): bad media" }), false);
  assert.equal(isTransientAntigravityAuth401Error({ message: "You are not logged into Antigravity." }), false);

  const root = await mkdtemp(resolve(os.tmpdir(), "ac-agy-retry401-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const desktopDir = resolve(root, "desktop");
  const dataDir = resolve(root, "data");
  const promptLog = resolve(root, "prompts.jsonl");
  const convRecover = "conv-retry401-ok";
  const convStillFail = "conv-retry401-fail";

  const setupConv = async (convId, title) => {
    const logsDir = resolve(desktopDir, "brain", convId, ".system_generated", "logs");
    const convDir = resolve(desktopDir, "conversations");
    await Promise.all([
      mkdir(logsDir, { recursive: true }),
      mkdir(convDir, { recursive: true }),
    ]);
    const nowIso = new Date().toISOString();
    const sdb = new DatabaseSync(resolve(desktopDir, "conversation_summaries.db"));
    sdb.prepare("INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      convId, title, title, 2, nowIso, JSON.stringify(["file:///tmp/mock-agy-project"]),
      "CASCADE_RUN_STATUS_IDLE", "", "", 0, 0, "",
    );
    sdb.close();
    await writeFile(
      resolve(logsDir, "transcript.jsonl"),
      [
        JSON.stringify({ step_index: 0, type: "USER_INPUT", source: "USER_EXPLICIT", status: "DONE", created_at: nowIso, content: "初始化" }),
        JSON.stringify({ step_index: 1, type: "PLANNER_RESPONSE", status: "DONE", created_at: nowIso, content: "就绪" }),
      ].join("\n") + "\n",
    );
    const dbPath = resolve(convDir, `${convId}.db`);
    const db = new DatabaseSync(dbPath);
    db.exec(`
      CREATE TABLE steps (
        idx INTEGER PRIMARY KEY,
        step_type INTEGER NOT NULL DEFAULT 0,
        status INTEGER NOT NULL DEFAULT 0,
        metadata BLOB,
        step_payload BLOB
      );
    `);
    db.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)").run(0, 14, 3, Buffer.alloc(0), Buffer.alloc(0));
    db.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)").run(1, 15, 3, Buffer.alloc(0), Buffer.alloc(0));
    db.close();
    return dbPath;
  };

  await mkdir(desktopDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  // Recreate summary db inside desktopDir properly after mkdir
  const sumDbPath = resolve(desktopDir, "conversation_summaries.db");
  const initSum = new DatabaseSync(sumDbPath);
  initSum.exec(`
    CREATE TABLE IF NOT EXISTS conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT,
      preview TEXT,
      step_count INTEGER,
      last_modified_time TEXT,
      workspace_uris TEXT,
      status TEXT,
      source TEXT,
      parent_conversation_id TEXT,
      not_fully_idle INTEGER,
      killed INTEGER,
      app_data_dir TEXT
    );
  `);
  initSum.close();

  const dbPathOk = await setupConv(convRecover, "401 重试成功测试");
  const dbPathFail = await setupConv(convStillFail, "401 重试仍失败测试");

  const provider = new AntigravityProvider({
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      AGY_BIN: MOCK_AGY_BIN,
      MOCK_AGY_PROMPT_LOG: promptLog,
      MOCK_AGY_ASK_PERMISSION_ON_CONTINUE: "1",
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "desktop", label: "Antigravity", home: desktopDir, profileType: "desktop" }]),
    },
  });
  const hub = new ProviderHub({ dataDir, providers: [provider], enableQueueDrain: false });
  await hub.init();
  t.after(() => hub.close());

  assert.equal(hub.getSettings().agyAutoRetryAuth401, true);
  await hub.setSettings({ agyAutoRetryAuth401: false });
  assert.equal(hub.getSettings().agyAutoRetryAuth401, false);
  await hub.setSettings({ agyAutoRetryAuth401: true });
  assert.equal(hub.getSettings().agyAutoRetryAuth401, true);

  const directEvents = [];
  const directPending = [];
  const directProvider = new AntigravityProvider({
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      AGY_BIN: MOCK_AGY_BIN,
      MOCK_AGY_PROMPT_LOG: promptLog,
      MOCK_AGY_ASK_PERMISSION_ON_CONTINUE: "1",
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "desktop", label: "Antigravity", home: desktopDir, profileType: "desktop" }]),
    },
    onEvent: (evt) => directEvents.push(evt),
    onServerRequest: (req) => directPending.push(req),
  });
  t.after(() => directProvider.close());

  // Case A: transient 401 followed by recovery after auto-continue
  await directProvider.sendTurn({
    profileId: "desktop",
    rawId: convRecover,
    cwd: root,
    text: "[AGY_PERMISSION]",
    autoRetryAuth401: { enabled: true, delayMs: 120 },
  });
  const reqA1 = await waitFor(() => directPending.shift());
  const errA = buildTestErrorStepBlob({
    userMessage: "Agent execution terminated due to error.",
    shortError: "UNAUTHENTICATED (code 401): invalid_token",
    fullError: "HTTP 401 Unauthorized",
    tsSec: Math.floor(Date.now() / 1000) + 1,
  });
  const dbA = new DatabaseSync(dbPathOk);
  dbA.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)").run(2, 17, 3, errA.metadata, errA.payload);
  dbA.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)").run(3, 101, 3, Buffer.alloc(0), Buffer.alloc(0));
  dbA.close();
  await utimes(dbPathOk, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
  directProvider.respondServerRequest("desktop", reqA1, { decision: "accept" });

  const reqA2 = await waitFor(() => directPending.shift());
  const dbA2 = new DatabaseSync(dbPathOk);
  dbA2.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)").run(4, 15, 3, Buffer.alloc(0), Buffer.alloc(0));
  dbA2.close();
  await utimes(dbPathOk, new Date(Date.now() + 4000), new Date(Date.now() + 4000));
  directProvider.respondServerRequest("desktop", reqA2, { decision: "accept" });

  const doneA = await waitFor(() => directEvents.find((e) => e.rawId === convRecover && e.type === "turn_completed"));
  assert.equal(doneA.status, "completed");

  // Case B: persistent 401 retries at most once and emits failed turn_completed
  await directProvider.sendTurn({
    profileId: "desktop",
    rawId: convStillFail,
    cwd: root,
    text: "[AGY_PERMISSION]",
    autoRetryAuth401: { enabled: true, delayMs: 120 },
  });
  const reqB1 = await waitFor(() => directPending.shift());
  const errB1 = buildTestErrorStepBlob({
    userMessage: "Agent execution terminated due to error.",
    shortError: "UNAUTHENTICATED (code 401): invalid_token",
    fullError: "HTTP 401 Unauthorized",
    tsSec: Math.floor(Date.now() / 1000) + 1,
  });
  const dbB = new DatabaseSync(dbPathFail);
  dbB.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)").run(2, 17, 3, errB1.metadata, errB1.payload);
  dbB.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)").run(3, 101, 3, Buffer.alloc(0), Buffer.alloc(0));
  dbB.close();
  await utimes(dbPathFail, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
  directProvider.respondServerRequest("desktop", reqB1, { decision: "accept" });

  const reqB2 = await waitFor(() => directPending.shift());
  const errB2 = buildTestErrorStepBlob({
    userMessage: "Agent execution terminated due to error.",
    shortError: "UNAUTHENTICATED (code 401): invalid_token",
    fullError: "HTTP 401 Unauthorized (retry)",
    tsSec: Math.floor(Date.now() / 1000) + 2,
  });
  const dbB2 = new DatabaseSync(dbPathFail);
  dbB2.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)").run(4, 17, 3, errB2.metadata, errB2.payload);
  dbB2.prepare("INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)").run(5, 101, 3, Buffer.alloc(0), Buffer.alloc(0));
  dbB2.close();
  await utimes(dbPathFail, new Date(Date.now() + 4000), new Date(Date.now() + 4000));
  directProvider.respondServerRequest("desktop", reqB2, { decision: "accept" });

  const doneB = await waitFor(() => directEvents.find((e) => e.rawId === convStillFail && e.type === "turn_completed"));
  assert.equal(doneB.status, "failed");
  assert.match(doneB.error?.message || "", /UNAUTHENTICATED \(code 401\)/);

  const loggedPrompts = (await readFile(promptLog, "utf8"))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    loggedPrompts.filter((p) => p.sessionId === convRecover).map((p) => p.text),
    ["[AGY_PERMISSION]", "继续"],
  );
  assert.deepEqual(
    loggedPrompts.filter((p) => p.sessionId === convStillFail).map((p) => p.text),
    ["[AGY_PERMISSION]", "继续"],
  );
});
