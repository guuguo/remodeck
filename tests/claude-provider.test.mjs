import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ClaudeSessionHistoryIndex, parseClaudeJsonlTranscript, readClaudeThreadHistory } from "../src/providers/claude-history.mjs";
import { ClaudeProvider } from "../src/providers/claude-provider.mjs";
import { ProviderHub } from "../src/provider-hub.mjs";
import { isRecoverableToolExecutionError } from "../src/tool-errors.mjs";

const MOCK_CLAUDE_BIN = fileURLToPath(new URL("./helpers/mock-claude-cli.mjs", import.meta.url));

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

test("claude-history parses tool_use/tool_result/custom-title and filters noisy records", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-claude-hist-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const projDir = resolve(dir, "projects", "-tmp-demo");
  await mkdir(projDir, { recursive: true });
  const sessionId = "11111111-1111-4111-8111-111111111111";
  const jsonlLines = [
    JSON.stringify({ type: "file-history-snapshot", snapshot: {} }),
    JSON.stringify({ type: "atis-latch", data: {} }),
    JSON.stringify({
      type: "user",
      uuid: "u-meta",
      isMeta: true,
      cwd: "/tmp/demo",
      timestamp: "2026-11-14T01:00:00Z",
      message: { role: "user", content: "系统注入技能说明不应当做标题" },
    }),
    JSON.stringify({
      type: "user",
      uuid: "u-1",
      cwd: "/tmp/demo",
      gitBranch: "main",
      timestamp: "2026-11-14T01:00:01Z",
      message: { role: "user", content: "运行测试并读取 README" },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "a-1",
      timestamp: "2026-11-14T01:00:02Z",
      message: {
        id: "msg-1",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [
          { type: "thinking", thinking: "准备运行 npm test" },
          { type: "tool_use", id: "tool-bash-1", name: "Bash", input: { command: "npm test" } },
          { type: "tool_use", id: "tool-edit-1", name: "Edit", input: { file_path: "README.md", new_string: "updated" } },
        ],
      },
    }),
    JSON.stringify({
      type: "user",
      uuid: "u-res-1",
      timestamp: "2026-11-14T01:00:03Z",
      message: {
        role: "user",
        content: [
          { type: "tool_result", tool_use_id: "tool-bash-1", content: "All tests pass", is_error: false },
          { type: "tool_result", tool_use_id: "tool-edit-1", content: "Edited", is_error: false },
        ],
      },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "a-2",
      timestamp: "2026-11-14T01:00:04Z",
      message: {
        id: "msg-2",
        role: "assistant",
        model: "claude-sonnet-4-6",
        content: [{ type: "text", text: "已经完成测试和文档更新。" }],
      },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "a-sidechain",
      isSidechain: true,
      timestamp: "2026-11-14T01:00:05Z",
      message: {
        id: "msg-sidechain",
        role: "assistant",
        model: "claude-haiku-4-5-20251001",
        content: [{ type: "text", text: "subagent response" }],
      },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "a-synthetic",
      timestamp: "2026-11-14T01:00:06Z",
      message: {
        id: "msg-synthetic",
        role: "assistant",
        model: "<synthetic>",
        content: [{ type: "text", text: "Compacted" }],
      },
    }),
    JSON.stringify({ type: "custom-title", customTitle: "自定义 Claude 标题" }),
  ];
  await writeFile(resolve(projDir, `${sessionId}.jsonl`), `${jsonlLines.join("\n")}\n`, "utf8");

  const index = new ClaudeSessionHistoryIndex();
  const list = await index.listSessions(dir);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, sessionId);
  assert.equal(list[0].name, "自定义 Claude 标题");
  assert.equal(list[0].cwd, "/tmp/demo");
  assert.equal(list[0].model, "claude-sonnet-4-6");

  const parsed = parseClaudeJsonlTranscript(jsonlLines, { rawId: sessionId });
  assert.equal(parsed.model, "claude-sonnet-4-6");
  assert.equal(parsed.turns.length, 1);
  const items = parsed.turns[0].items;
  assert.equal(items[0].type, "userMessage");
  assert.equal(items[1].type, "reasoning");
  assert.equal(items[2].type, "commandExecution");
  assert.equal(items[2].aggregatedOutput, "All tests pass");
  assert.equal(items[3].type, "fileChange");
  assert.equal(items[4].type, "agentMessage");

  const toolImageParsed = parseClaudeJsonlTranscript([
    JSON.stringify({
      type: "user",
      uuid: "u-img-res",
      timestamp: "2026-11-14T01:50:00Z",
      message: { role: "user", content: "截一张图" },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "a-img-res",
      timestamp: "2026-11-14T01:50:01Z",
      message: {
        id: "msg-img-res",
        role: "assistant",
        content: [{ type: "tool_use", id: "tool-shot-1", name: "screenshot", input: {} }],
      },
    }),
    JSON.stringify({
      type: "user",
      uuid: "u-img-res-2",
      timestamp: "2026-11-14T01:50:02Z",
      message: {
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: "tool-shot-1",
          content: [
            { type: "text", text: "截图完成" },
            { type: "image", source: { type: "base64", media_type: "image/png", data: "I".repeat(50_000) } },
          ],
          is_error: false,
        }],
      },
    }),
  ], { rawId: "shot-1" });
  const shotItem = toolImageParsed.turns[0].items.find((it) => it.id === "tool-shot-1");
  assert.equal(shotItem?.result?.content?.[0]?.text, "截图完成\n[图片Base64已省略]");

  const multiStep = parseClaudeJsonlTranscript([
    JSON.stringify({
      type: "user",
      uuid: "u-multi",
      timestamp: "2026-11-14T02:00:00Z",
      message: { role: "user", content: "检查日志再总结" },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "a-multi-1",
      timestamp: "2026-11-14T02:00:01Z",
      message: {
        id: "msg-multi-1",
        role: "assistant",
        content: [
          { type: "text", text: "先读取文件看看" },
          { type: "tool_use", id: "t-read-1", name: "Read", input: { file_path: "app.js" } },
        ],
      },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "a-multi-2",
      timestamp: "2026-11-14T02:00:03Z",
      message: {
        id: "msg-multi-2",
        role: "assistant",
        content: [{ type: "text", text: "最终排查汇总" }],
      },
    }),
  ], { rawId: sessionId });
  const multiAgents = multiStep.turns[0].items.filter((it) => it.type === "agentMessage");
  assert.equal(multiAgents.length, 2);
  assert.equal(multiAgents[0].phase, "commentary");
  assert.equal(multiAgents[1].phase, "final_answer");
});

test("ClaudeProvider streams deltas, handles tool approval & AskUserQuestion, and interrupts via SIGINT", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-claude-prov-"));
  const claudeDir = resolve(dir, ".claude");
  await mkdir(claudeDir, { recursive: true });

  const deltas = [];
  const serverRequests = [];
  const completions = [];

  const provider = new ClaudeProvider({
    env: {
      ...process.env,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: claudeDir }]),
    },
    onEvent: (evt) => {
      if (evt.type === "stream_delta") deltas.push(evt);
      if (evt.type === "turn_completed") completions.push(evt);
    },
    onServerRequest: (req) => serverRequests.push(req),
  });
  t.after(async () => {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  });

  const created = await provider.startThread({
    profileId: "default",
    cwd: dir,
    text: "打招呼并流式输出",
  });
  await waitFor(() => completions.find((e) => e.threadId === created.thread.id));
  assert.ok(deltas.some((d) => d.kind === "text"));
  assert.ok(deltas.some((d) => d.kind === "reasoning"));

  // Tool approval via control_request -> control_response.
  await provider.sendTurn({
    profileId: "default",
    rawId: created.thread.rawId,
    cwd: dir,
    text: "测试 [CLAUDE_APPROVAL]",
  });
  const approval = await waitFor(() => serverRequests.find((r) => r.toolName === "Bash"));
  provider.respondServerRequest("default", approval, { decision: "accept" });
  const c2 = await waitFor(() => completions.length >= 2 && completions[1]);
  assert.match(c2.lastAgentMessage, /allow/);

  // AskUserQuestion via control_request -> control_response.
  await provider.sendTurn({
    profileId: "default",
    rawId: created.thread.rawId,
    cwd: dir,
    text: "测试 [ASK_USER]",
  });
  const askReq = await waitFor(() => serverRequests.find((r) => r.kind === "userInput"));
  assert.equal(askReq.questions[0].header, "实现方式");
  provider.respondServerRequest("default", askReq, {
    answers: { [askReq.questions[0].id]: { answers: ["集成测试"] } },
  });
  const c3 = await waitFor(() => completions.length >= 3 && completions[2]);
  assert.match(c3.lastAgentMessage, /集成测试/);

  // Interrupt slow turn with SIGINT.
  await provider.sendTurn({
    profileId: "default",
    rawId: created.thread.rawId,
    cwd: dir,
    text: "慢测试 [SLOW]",
  });
  await provider.interrupt({ rawId: created.thread.rawId });
  const c4 = await waitFor(() => completions.length >= 4 && completions[3]);
  assert.equal(c4.status, "interrupted");
});

test("ClaudeProvider.listModels dynamically reads local model-catalog and settings.json with 5.5 defaults", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-claude-models-"));
  const claudeDir = resolve(dir, ".claude");
  await mkdir(claudeDir, { recursive: true });

  await writeFile(resolve(claudeDir, "settings.json"), JSON.stringify({
    modelSettings: {
      "claude-opus-5-6": { autoCompactWindow: 500000 },
    },
  }), "utf8");

  const provider = new ClaudeProvider({
    env: {
      ...process.env,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: claudeDir }]),
    },
  });
  t.after(async () => {
    await provider.close();
    await rm(dir, { recursive: true, force: true });
  });

  const fallbackModels = await provider.listModels("default");
  assert.ok(fallbackModels.some((m) => m.id === "claude-sonnet-5-5" && m.isDefault === true));
  assert.ok(fallbackModels.some((m) => m.id === "claude-opus-5-5" && m.section === "main"));
  assert.ok(fallbackModels.some((m) => m.id === "claude-fable-5-2" && m.supportedReasoningEfforts.includes("xhigh")));
  assert.ok(fallbackModels.some((m) => m.id === "claude-opus-5-6" && m.displayName === "Claude Opus 5.6"));

  const catalogDir = resolve(claudeDir, "cache", "model-catalog");
  await mkdir(catalogDir, { recursive: true });
  await writeFile(resolve(catalogDir, "test-cc.json"), JSON.stringify({
    version: 2,
    fetchedAt: Date.now(),
    catalog: {
      surface: "cc",
      config: {
        id: "cc",
        models: [
          {
            id: "claude-opus-5-5",
            name: "Opus 5.5",
            section: "main",
            description: "Complex engineering",
            runtime: { effort_levels: ["low", "medium", "high", "xhigh", "max"], default_effort: "medium" },
          },
          {
            id: "claude-sonnet-5-5",
            name: "Sonnet 5.5",
            section: "main",
            description: "Efficient default",
            runtime: { effort_levels: ["low", "medium", "high", "xhigh", "max"], default_effort: "medium" },
          },
          {
            id: "claude-fable-5-2",
            name: "Fable 5.2",
            section: "main",
            runtime: { effort_levels: ["low", "medium", "high", "xhigh", "max"], default_effort: "medium" },
          },
          {
            id: "claude-sonnet-4-6",
            name: "Sonnet 4.6",
            section: "overflow",
            runtime: { effort_levels: ["low", "medium", "high", "max"], default_effort: "high" },
          },
        ],
      },
      state: {
        model: "claude-sonnet-5-5",
        thinking_by_model: [
          { id: "claude-opus-5-5", thinking: { type: "effort", effort: "high" } },
        ],
      },
    },
  }), "utf8");

  const catalogModels = await provider.listModels("default");
  const opus = catalogModels.find((m) => m.id === "claude-opus-5-5");
  const sonnet = catalogModels.find((m) => m.id === "claude-sonnet-5-5");
  const fable = catalogModels.find((m) => m.id === "claude-fable-5-2");
  const legacy = catalogModels.find((m) => m.id === "claude-sonnet-4-6");

  assert.equal(opus?.displayName, "Claude Opus 5.5");
  assert.equal(opus?.defaultReasoningEffort, "high");
  assert.ok(opus?.supportedReasoningEfforts.includes("xhigh"));
  assert.equal(sonnet?.displayName, "Claude Sonnet 5.5");
  assert.equal(sonnet?.isDefault, true);
  assert.equal(fable?.displayName, "Claude Fable 5.2");
  assert.equal(legacy?.section, "overflow");
});

test("claude-history exposes firstUserText/lastUserText for drift detection and readThread avoids falling back to 新会话", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-claude-drift-"));
  const claudeDir = resolve(dir, ".claude");
  const projDir = resolve(claudeDir, "projects", "-tmp-drift");
  await mkdir(projDir, { recursive: true });

  const sessionId = "sess-claude-drift-1";
  const lines = [
    JSON.stringify({
      type: "user",
      uuid: "u-1",
      cwd: "/tmp/drift",
      timestamp: "2026-11-15T01:00:00Z",
      message: { role: "user", content: "Claude 项目进度查询" },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "a-1",
      timestamp: "2026-11-15T01:00:05Z",
      message: { id: "m-1", role: "assistant", model: "claude-sonnet-4-6", content: [{ type: "text", text: "已查询当前进度" }] },
    }),
    JSON.stringify({
      type: "user",
      uuid: "u-2",
      cwd: "/tmp/drift",
      timestamp: "2026-11-15T01:05:00Z",
      message: { role: "user", content: "优化 Agent Control 的会话标题生成与更新逻辑" },
    }),
    JSON.stringify({
      type: "user",
      uuid: "u-3",
      cwd: "/tmp/drift",
      timestamp: "2026-11-15T01:06:00Z",
      message: { role: "user", content: "跑一下测试" },
    }),
  ];
  await writeFile(resolve(projDir, `${sessionId}.jsonl`), `${lines.join("\n")}\n`, "utf8");

  const index = new ClaudeSessionHistoryIndex();
  const list = await index.listSessions(claudeDir);
  assert.equal(list.length, 1);
  assert.equal(list[0].firstUserText, "Claude 项目进度查询");
  assert.equal(list[0].lastUserText, "优化 Agent Control 的会话标题生成与更新逻辑");
  assert.equal(list[0].hasFollowUpTurns, true);

  const parsed = parseClaudeJsonlTranscript(lines, { rawId: sessionId });
  assert.equal(parsed.firstUserText, "Claude 项目进度查询");
  assert.equal(parsed.lastUserText, "优化 Agent Control 的会话标题生成与更新逻辑");
  assert.equal(parsed.hasFollowUpTurns, true);
  assert.ok(parsed.preview);

  const provider = new ClaudeProvider({
    env: {
      ...process.env,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: claudeDir }]),
    },
  });
  const hub = new ProviderHub({ dataDir: resolve(dir, "hub-data"), providers: [provider], enableQueueDrain: false });
  t.after(async () => {
    await hub.close();
    await rm(dir, { recursive: true, force: true });
  });
  await hub.init();

  const read = await hub.readThread(`claude:default:${sessionId}`);
  assert.notEqual(read.thread.title, "新会话");
  assert.equal(read.thread.title, "跑一下测试");
});

test("claude-history prefers real entry.cwd/relocatedCwd over lossy slug fallback and spawn ENOENT stays failed", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-claude-cwd-"));
  const claudeDir = resolve(dir, ".claude");
  const realWorkspace = resolve(dir, "workspace demo");
  const relocatedWorkspace = resolve(dir, "workspace relocated");
  const slugDir = resolve(claudeDir, "projects", "-nonexistent-lossy---------slug");
  await Promise.all([
    mkdir(realWorkspace, { recursive: true }),
    mkdir(relocatedWorkspace, { recursive: true }),
    mkdir(slugDir, { recursive: true }),
  ]);
  let hub = null;
  let badBinHub = null;
  t.after(async () => {
    await badBinHub?.close().catch(() => {});
    await hub?.close().catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });

  const sid1 = "sess-cwd-real-1";
  await writeFile(resolve(slugDir, `${sid1}.jsonl`), [
    JSON.stringify({
      type: "user",
      uuid: "u-1",
      cwd: realWorkspace,
      timestamp: "2026-11-15T01:00:00Z",
      message: { role: "user", content: "测试真实目录" },
    }),
  ].join("\n") + "\n", "utf8");

  const sid2 = "sess-cwd-relocated-2";
  await writeFile(resolve(slugDir, `${sid2}.jsonl`), [
    JSON.stringify({
      type: "user",
      uuid: "u-1",
      cwd: realWorkspace,
      timestamp: "2026-11-15T01:00:00Z",
      message: { role: "user", content: "测试迁移目录" },
    }),
    JSON.stringify({
      type: "relocated",
      relocatedCwd: relocatedWorkspace,
      sessionId: sid2,
    }),
  ].join("\n") + "\n", "utf8");

  const index = new ClaudeSessionHistoryIndex();
  const h1 = await readClaudeThreadHistory(claudeDir, sid1, { index });
  const h2 = await readClaudeThreadHistory(claudeDir, sid2, { index });
  assert.equal(h1.thread.cwd, realWorkspace);
  assert.equal(h2.thread.cwd, relocatedWorkspace);

  // spawn ENOENT must never be classified as a recoverable single-step tool error.
  assert.equal(isRecoverableToolExecutionError("spawn /opt/homebrew/bin/claude ENOENT"), false);
  assert.equal(isRecoverableToolExecutionError({ message: "spawn claude ENOENT", syscall: "spawn claude" }), false);
  assert.equal(isRecoverableToolExecutionError("ENOENT: no such file or directory, open '/tmp/x'"), true);

  // ProviderHub + ClaudeProvider should succeed on sid1 (resolved to realWorkspace) instead of failing on lossy slug.
  const events = [];
  hub = new ProviderHub({
    env: {
      ...process.env,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: claudeDir }]),
      AGENT_CONTROL_CODEX_HOMES: "[]",
    },
    dataDir: resolve(dir, "hub-data"),
    enableQueueDrain: false,
  });
  await hub.init();
  hub.subscribe((evt, data) => {
    if (evt === "provider_event") events.push(data);
  });

  const sent = await hub.sendTurn({
    threadId: `claude:default:${sid1}`,
    text: "继续执行",
    permissionMode: "turbo",
  });
  assert.equal(sent.thread.cwd, realWorkspace);
  const done = await waitFor(() => events.find((e) => e.type === "turn_completed" && e.rawId === sid1));
  assert.equal(done.status, "completed");

  await assert.rejects(
    () => hub.sendTurn({
      threadId: `claude:default:${sid1}`,
      cwd: resolve(dir, "definitely-missing-dir"),
      text: "测试缺失目录",
    }),
    /工作目录不存在/,
  );

  // If spawning the Claude binary fails with ENOENT, ProviderHub must keep status="failed" (not recover to completed).
  const badBinEvents = [];
  badBinHub = new ProviderHub({
    env: {
      ...process.env,
      CLAUDE_BIN: resolve(dir, "missing-claude-bin"),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: claudeDir }]),
      AGENT_CONTROL_CODEX_HOMES: "[]",
    },
    dataDir: resolve(dir, "hub-data-bad-bin"),
    enableQueueDrain: false,
  });
  await badBinHub.init();
  badBinHub.subscribe((evt, data) => {
    if (evt === "provider_event") badBinEvents.push(data);
  });
  await badBinHub.sendTurn({
    threadId: `claude:default:${sid1}`,
    text: "测试缺失 CLI",
    permissionMode: "turbo",
  });
  const badDone = await waitFor(() => badBinEvents.find((e) => e.type === "turn_completed" && e.rawId === sid1));
  assert.equal(badDone.status, "failed");
  assert.match(badDone.error?.message || "", /ENOENT/);
});

test("claude readThread and getActivity stay live when external session is busy or subagents write", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-claude-ext-live-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const claudeDir = resolve(dir, "claude");
  const slugDir = resolve(claudeDir, "projects", "-tmp-ext-proj");
  const sessionsDir = resolve(claudeDir, "sessions");
  const sessionId = "22222222-2222-4222-8222-222222222222";
  const subagentsDir = resolve(slugDir, sessionId, "subagents");
  await mkdir(subagentsDir, { recursive: true });
  await mkdir(sessionsDir, { recursive: true });

  const jsonlPath = resolve(slugDir, `${sessionId}.jsonl`);
  await writeFile(jsonlPath, [
    JSON.stringify({
      type: "user",
      uuid: "u-1",
      cwd: "/tmp/ext-proj",
      timestamp: "2026-11-15T15:33:25.000Z",
      message: { role: "user", content: "跑两个子代理任务" },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "a-1",
      timestamp: "2026-11-15T15:33:44.000Z",
      message: {
        id: "msg-1",
        role: "assistant",
        content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "ls" } }],
      },
    }),
    JSON.stringify({
      type: "user",
      uuid: "u-tool-1",
      timestamp: "2026-11-15T15:33:45.000Z",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool-1", content: "ok" }],
      },
    }),
  ].join("\n") + "\n", "utf8");

  // Backdate main JSONL beyond the 15s file-mtime window to simulate a >15s silent thinking/tool pause.
  const staleAt = new Date(Date.now() - 60_000);
  await utimes(jsonlPath, staleAt, staleAt);

  const sessionMetaPath = resolve(sessionsDir, `${process.pid}.json`);
  await writeFile(sessionMetaPath, JSON.stringify({
    pid: process.pid,
    sessionId,
    cwd: "/tmp/ext-proj",
    entrypoint: "claude-desktop",
    status: "busy",
    updatedAt: Date.now(),
  }), "utf8");

  const provider = new ClaudeProvider({
    env: {
      ...process.env,
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: claudeDir }]),
    },
  });

  const opened = await provider.readThread("default", sessionId);
  assert.equal(opened.thread.live, true);
  assert.equal(opened.activity?.status, "running");

  const actBusy = await provider.getActivity("default", sessionId, { cursor: opened.activityCursor });
  assert.equal(actBusy.live, true);
  assert.equal(actBusy.changed, false);
  assert.equal(actBusy.activity?.status, "running");

  // Transition external desktop session to idle -> must flip live=false and changed=true immediately.
  await writeFile(sessionMetaPath, JSON.stringify({
    pid: process.pid,
    sessionId,
    cwd: "/tmp/ext-proj",
    entrypoint: "claude-desktop",
    status: "idle",
    updatedAt: Date.now(),
  }), "utf8");

  const actIdle = await provider.getActivity("default", sessionId, { cursor: actBusy.cursor });
  assert.equal(actIdle.live, false);
  assert.equal(actIdle.changed, true);
  assert.equal(actIdle.activity, null);

  // When a background subagent writes JSONL recently, liveness must also stay true even if session JSON is idle.
  const subFile = resolve(subagentsDir, "agent-sub1.jsonl");
  await writeFile(subFile, `${JSON.stringify({ type: "assistant", message: { role: "assistant", content: [] } })}\n`, "utf8");

  const actSub = await provider.getActivity("default", sessionId, { cursor: actIdle.cursor });
  assert.equal(actSub.live, true);
  assert.equal(actSub.changed, true);
  assert.equal(actSub.activity?.status, "running");

  const reopenedSub = await provider.readThread("default", sessionId);
  assert.equal(reopenedSub.thread.live, true);
});

test("claudeEnvironment preserves default keychain path and Cockpit desktop instances match email or report CLI未登录", async (t) => {
  const { claudeEnvironment } = await import("../src/providers/claude-runner.mjs");
  const { classifyProfileError } = await import("../src/profile-health.mjs");

  const fakeHome = await mkdtemp(resolve(os.tmpdir(), "ac-claude-multi-"));
  t.after(() => rm(fakeHome, { recursive: true, force: true }));

  const defaultClaudeDir = resolve(fakeHome, ".claude");
  const desktopDefaultDir = resolve(fakeHome, "Library", "Application Support", "Claude");
  const desktopHotmailDir = resolve(fakeHome, ".cockpit_tools", "instances", "claude", "06c986e6");
  const cockpitDir = resolve(fakeHome, ".antigravity_cockpit");
  const histSessId = "hist-desktop-0001";
  const projDir = resolve(defaultClaudeDir, "projects", "-tmp-proj");
  const hotmailClaimsDir = resolve(desktopHotmailDir, "claude-code-sessions", "acct-hot", "org-hot");

  await Promise.all([
    mkdir(projDir, { recursive: true }),
    mkdir(desktopDefaultDir, { recursive: true }),
    mkdir(hotmailClaimsDir, { recursive: true }),
    mkdir(cockpitDir, { recursive: true }),
  ]);

  // Verify default config dir omits CLAUDE_CONFIG_DIR so macOS Keychain keeps standard service lookup.
  const baseEnv = { HOME: fakeHome, USERPROFILE: fakeHome, CLAUDECODE: "1" };
  const defaultEnv = claudeEnvironment(baseEnv, defaultClaudeDir, { platform: "darwin" });
  assert.equal(defaultEnv.CLAUDE_CONFIG_DIR, undefined);
  assert.equal(defaultEnv.CLAUDECODE, undefined);

  const customDir = resolve(fakeHome, ".claude-claude-hotmail");
  const customEnv = claudeEnvironment(baseEnv, customDir, { platform: "darwin" });
  assert.equal(customEnv.CLAUDE_CONFIG_DIR, customDir);

  await writeFile(resolve(projDir, `${histSessId}.jsonl`), `${JSON.stringify({
    type: "user",
    uuid: "u-h1",
    cwd: "/tmp/proj",
    timestamp: "2026-11-16T01:00:00Z",
    message: { role: "user", content: "桌面历史会话" },
  })}\n`, "utf8");

  await writeFile(resolve(hotmailClaimsDir, "local_hot.json"), JSON.stringify({
    cliSessionId: histSessId,
    lastAssistantCliSessionId: histSessId,
  }), "utf8");

  await writeFile(resolve(cockpitDir, "claude_accounts.json"), JSON.stringify({
    accounts: [
      { id: "acct_icloud", email: "user@icloud.com", plan_type: "Free", account_uuid: "acct-ic", organization_uuid: "org-ic" },
      { id: "acct_hotmail", email: "user@hotmail.com", plan_type: "Pro", account_uuid: "acct-hot", organization_uuid: "org-hot" },
    ],
  }), "utf8");

  await writeFile(resolve(cockpitDir, "claude_instances.json"), JSON.stringify({
    defaultSettings: {
      bindAccountId: "acct_icloud",
      followLocalAccount: false,
    },
    instances: [
      {
        id: "inst-hot",
        name: "claude hotmail",
        userDataDir: desktopHotmailDir,
        bindAccountId: "acct_hotmail",
      },
    ],
  }), "utf8");

  // 1. Default CLI logged out -> both instances report CLI未登录 with actionable terminal instructions (zero tokens).
  const testEnv = {
    ...process.env,
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    CLAUDE_BIN: MOCK_CLAUDE_BIN,
  };
  delete testEnv.CLAUDE_CONFIG_DIR;
  await writeFile(resolve(defaultClaudeDir, ".mock-probe-error"), "CLI_LOGGED_OUT", "utf8");
  await mkdir(customDir, { recursive: true });
  await writeFile(resolve(customDir, ".mock-probe-error"), "CLI_LOGGED_OUT", "utf8");
  const providerLoggedOut = new ClaudeProvider({
    env: testEnv,
  });
  t.after(() => providerLoggedOut.close());

  const profilesOut = await providerLoggedOut.listProfiles();
  const pDefOut = profilesOut.find((p) => p.id === "default");
  const pHotOut = profilesOut.find((p) => p.id === "claude-hotmail");
  assert.ok(pDefOut && pHotOut);
  assert.equal(pHotOut.historyDir, defaultClaudeDir);
  assert.equal(pHotOut.cliConfigDir, resolve(fakeHome, ".claude-claude-hotmail"));

  await assert.rejects(() => providerLoggedOut.probeProfile("default"), (err) => {
    const health = classifyProfileError(err);
    assert.equal(health.shortReason, "CLI未登录");
    assert.match(health.detail, /claude auth login --email user@icloud\.com/);
    return true;
  });

  await assert.rejects(() => providerLoggedOut.probeProfile("claude-hotmail"), (err) => {
    assert.match(err.message, /执行 CLAUDE_CONFIG_DIR=~\/\.claude-claude-hotmail claude auth login --email user@hotmail\.com/);
    return true;
  });

  // 2. User runs `claude auth login` as hotmail in default CLI -> hotmail instance auto-matches and passes probe!
  await rm(resolve(defaultClaudeDir, ".mock-probe-error"), { force: true });
  await writeFile(resolve(defaultClaudeDir, ".mock-auth-status.json"), JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    email: "user@hotmail.com",
  }), "utf8");

  const providerHotmailAuthed = new ClaudeProvider({
    env: testEnv,
  });
  t.after(() => providerHotmailAuthed.close());

  const profilesIn = await providerHotmailAuthed.listProfiles();
  const pHotIn = profilesIn.find((p) => p.id === "claude-hotmail");
  assert.equal(pHotIn?.cliConfigDir, defaultClaudeDir);
  assert.equal(pHotIn?.historyDir, defaultClaudeDir);

  const hotProbeOk = await providerHotmailAuthed.probeProfile("claude-hotmail");
  assert.equal(hotProbeOk.ok, true);
  assert.equal(hotProbeOk.email, "user@hotmail.com");

  await assert.rejects(() => providerHotmailAuthed.probeProfile("default"), (err) => {
    assert.match(err.message, /不一致.*user@icloud\.com/);
    return true;
  });

  // Desktop history owned by hotmail remains readable despite dedicated/default CLI configDir split.
  const hotThreads = await providerHotmailAuthed.listThreads("claude-hotmail");
  assert.ok(hotThreads.some((th) => th.rawId === histSessId));

  // An existing CLI profile for the same desktop account is reusable without moving credentials.
  const existingCliDir = resolve(fakeHome, ".claude-work");
  await mkdir(resolve(existingCliDir, "projects"), { recursive: true });
  await writeFile(resolve(existingCliDir, ".mock-auth-status.json"), JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    email: "user@hotmail.com",
  }), "utf8");
  await writeFile(resolve(defaultClaudeDir, ".mock-probe-error"), "CLI_LOGGED_OUT", "utf8");
  await mkdir(customDir, { recursive: true });
  await writeFile(resolve(customDir, ".mock-probe-error"), "CLI_LOGGED_OUT", "utf8");
  const providerExistingCli = new ClaudeProvider({ env: testEnv });
  t.after(() => providerExistingCli.close());
  const existingProfiles = await providerExistingCli.listProfiles();
  assert.equal(existingProfiles.find((p) => p.id === "claude-hotmail")?.cliConfigDir, existingCliDir);
  assert.equal(existingProfiles.find((p) => p.id === "default")?.cliConfigDir, defaultClaudeDir);
  assert.equal((await providerExistingCli.probeProfile("claude-hotmail")).email, "user@hotmail.com");
  await assert.rejects(() => providerExistingCli.probeProfile("default"), /CLI未登录/);
});

test("claude-history keeps structured <task-notification>/<cross-session-message>/<bash-input> clean in previews while preserving turn structure", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-claude-xml-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const projDir = resolve(dir, "projects", "-tmp-xml");
  await mkdir(projDir, { recursive: true });
  const sid1 = "sess-xml-mixed-1";
  const notifText = [
    "[SYSTEM NOTIFICATION - NOT USER INPUT]",
    "This is an automated background-task event, NOT a message from the user.",
    "",
    "<task-notification>",
    "<task-id>b3zgdt09y</task-id>",
    "<tool-use-id>toolu_01BWcnFBjKKrphcxpLYCXmC6</tool-use-id>",
    "<status>stopped</status>",
    "<summary>Background shell command didn't finish before the previous session ended</summary>",
    "<note>No completion record was found for it in the previous session.\nCheck the output file.</note>",
    "</task-notification>",
  ].join("\n");

  const lines1 = [
    JSON.stringify({
      type: "user",
      uuid: "u-real-1",
      cwd: "/tmp/xml",
      timestamp: "2026-11-16T01:00:00Z",
      message: { role: "user", content: "<system-reminder>internal</system-reminder>\n排查后台任务状态\n保留第二行" },
    }),
    JSON.stringify({
      type: "user",
      uuid: "u-notif-1",
      timestamp: "2026-11-16T01:00:05Z",
      message: { role: "user", content: notifText },
    }),
    JSON.stringify({
      type: "user",
      uuid: "u-cross-1",
      timestamp: "2026-11-16T01:00:08Z",
      message: {
        role: "user",
        content: 'Another Claude session sent a message:\n<cross-session-message from="local_abc" from-name="示例商城评估">\n已上线\n</cross-session-message>',
      },
    }),
    JSON.stringify({
      type: "last-prompt",
      lastPrompt: notifText,
      sessionId: sid1,
    }),
  ];
  await writeFile(resolve(projDir, `${sid1}.jsonl`), `${lines1.join("\n")}\n`, "utf8");

  const sid2 = "sess-xml-notif-only-2";
  await writeFile(resolve(projDir, `${sid2}.jsonl`), [
    JSON.stringify({
      type: "user",
      uuid: "u-only-notif",
      cwd: "/tmp/xml",
      timestamp: "2026-11-16T02:00:00Z",
      message: { role: "user", content: notifText },
    }),
  ].join("\n") + "\n", "utf8");

  const index = new ClaudeSessionHistoryIndex();
  const list = await index.listSessions(dir);
  const s1 = list.find((item) => item.id === sid1);
  const s2 = list.find((item) => item.id === sid2);
  assert.ok(s1 && s2);
  assert.doesNotMatch(s1.preview, /<task-notification|SYSTEM NOTIFICATION|<cross-session-message/);
  assert.equal(s1.preview, "排查后台任务状态 保留第二行");
  assert.equal(s1.firstUserText, "排查后台任务状态 保留第二行");
  assert.equal(s1.lastUserText, "排查后台任务状态 保留第二行");

  assert.doesNotMatch(s2.preview, /<task-notification|<task-id|SYSTEM NOTIFICATION/);
  assert.match(s2.preview, /^后台任务 · 已停止：Background shell command didn't finish/);

  const parsed1 = parseClaudeJsonlTranscript(lines1, { rawId: sid1 });
  assert.equal(parsed1.preview, "排查后台任务状态 保留第二行");
  assert.equal(parsed1.turns.length, 3);
  const firstTurnText = parsed1.turns[0].items[0].content[0].text;
  assert.equal(firstTurnText, "排查后台任务状态\n保留第二行");
  const notifTurnText = parsed1.turns[1].items[0].content[0].text;
  assert.doesNotMatch(notifTurnText, /SYSTEM NOTIFICATION - NOT USER INPUT/);
  assert.match(notifTurnText, /<task-notification>\n<task-id>b3zgdt09y<\/task-id>/);
});

test("claude-history attaches per-turn primary model while ignoring sidechain overrides", () => {
  const parsed = parseClaudeJsonlTranscript([
    JSON.stringify({
      type: "user",
      uuid: "u-1",
      cwd: "/tmp/m",
      timestamp: "2026-11-16T08:10:00Z",
      message: { role: "user", content: "分析问题" },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "a-1",
      timestamp: "2026-11-16T08:10:03Z",
      message: { id: "m-1", model: "claude-opus-5-5", content: [{ type: "text", text: "主模型结论" }] },
    }),
    JSON.stringify({
      type: "assistant",
      uuid: "a-side",
      isSidechain: true,
      timestamp: "2026-11-16T08:10:04Z",
      message: { id: "m-side", model: "claude-haiku-4-5", content: [{ type: "text", text: "子任务" }] },
    }),
  ], { rawId: "sess-model-check" });

  assert.equal(parsed.model, "claude-opus-5-5");
  assert.equal(parsed.turns.length, 1);
  assert.equal(parsed.turns[0].model, "claude-opus-5-5");
});

test("claude-provider readThread preserves file mtime updatedAt consistent with listThreads", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-claude-mtime-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const projDir = resolve(dir, "projects", "-tmp-mtime-demo");
  await mkdir(projDir, { recursive: true });
  const sessionId = "22222222-2222-4222-8222-222222222222";
  const filePath = resolve(projDir, `${sessionId}.jsonl`);
  await writeFile(
    filePath,
    [
      JSON.stringify({
        type: "user",
        uuid: "u-1",
        cwd: "/tmp/mtime-demo",
        timestamp: "2026-11-16T08:00:00Z",
        message: { role: "user", content: "检查未读状态同步" },
      }),
      JSON.stringify({
        type: "assistant",
        uuid: "a-1",
        timestamp: "2026-11-16T08:00:05Z",
        message: { id: "m-1", role: "assistant", model: "claude-sonnet-4-6", content: [{ type: "text", text: "已完成" }] },
      }),
      JSON.stringify({ type: "last-prompt", lastPrompt: "检查未读状态同步" }),
    ].join("\n") + "\n",
    "utf8",
  );
  const laterSec = Math.floor(Date.parse("2026-11-16T08:05:00Z") / 1000);
  await utimes(filePath, laterSec, laterSec);

  const provider = new ClaudeProvider({
    env: {
      ...process.env,
      HOME: dir,
      USERPROFILE: dir,
      CLAUDE_CONFIG_DIR: dir,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
    },
  });
  const listed = await provider.listThreads("default", { limit: 20 });
  const listedItem = listed.find((item) => item.rawId === sessionId);
  assert.ok(listedItem);
  assert.equal(listedItem.updatedAt, laterSec);

  const detail = await provider.readThread("default", sessionId, { limit: 20 });
  assert.equal(detail.thread.updatedAt, laterSec);
});

test("discoverClaudeProfiles merges Cockpit desktop dedicated CLI dirs without creating duplicate -2 profiles", async (t) => {
  const fakeHome = await mkdtemp(resolve(os.tmpdir(), "ac-claude-dedup-"));
  t.after(() => rm(fakeHome, { recursive: true, force: true }));

  const defaultClaudeDir = resolve(fakeHome, ".claude");
  const defaultDesktopDir = resolve(fakeHome, "Library", "Application Support", "Claude");
  const desktopHotmailDir = resolve(fakeHome, ".cockpit_tools", "instances", "claude", "06c986e6");
  const cockpitDir = resolve(fakeHome, ".antigravity_cockpit");
  const dedicatedHotmailDir = resolve(fakeHome, ".claude-claude-hotmail");
  const altDefaultDir = resolve(fakeHome, ".claude-default");
  const workCliDir = resolve(fakeHome, ".claude-work");

  const histDeskId = "hist-desk-1";
  const cliSessId = "cli-sess-1";
  const deskProjDir = resolve(defaultClaudeDir, "projects", "-tmp-proj");
  const hotmailClaimsDir = resolve(desktopHotmailDir, "claude-code-sessions", "acct-hot", "org-hot");
  const dedicatedProjDir = resolve(dedicatedHotmailDir, "projects", "-tmp-cli");

  await Promise.all([
    mkdir(deskProjDir, { recursive: true }),
    mkdir(defaultDesktopDir, { recursive: true }),
    mkdir(hotmailClaimsDir, { recursive: true }),
    mkdir(cockpitDir, { recursive: true }),
    mkdir(dedicatedProjDir, { recursive: true }),
    mkdir(resolve(dedicatedHotmailDir, "sessions"), { recursive: true }),
    mkdir(resolve(altDefaultDir, "projects"), { recursive: true }),
    mkdir(resolve(workCliDir, "projects"), { recursive: true }),
  ]);

  await writeFile(resolve(deskProjDir, `${histDeskId}.jsonl`), `${JSON.stringify({
    type: "user",
    uuid: "u-d1",
    cwd: "/tmp/proj",
    timestamp: "2026-11-16T01:00:00Z",
    message: { role: "user", content: "桌面版历史会话" },
  })}\n`, "utf8");

  await writeFile(resolve(hotmailClaimsDir, "local_hot.json"), JSON.stringify({
    cliSessionId: histDeskId,
    lastAssistantCliSessionId: histDeskId,
  }), "utf8");

  await writeFile(resolve(dedicatedProjDir, `${cliSessId}.jsonl`), `${JSON.stringify({
    type: "user",
    uuid: "u-c1",
    cwd: "/tmp/cli",
    timestamp: "2026-11-16T02:00:00Z",
    message: { role: "user", content: "专属 CLI 会话" },
  })}\n`, "utf8");

  await writeFile(resolve(dedicatedHotmailDir, ".mock-auth-status.json"), JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    email: "user@hotmail.com",
  }), "utf8");

  await writeFile(resolve(altDefaultDir, ".mock-auth-status.json"), JSON.stringify({
    loggedIn: true,
    authMethod: "claude.ai",
    email: "user@icloud.com",
  }), "utf8");

  await writeFile(resolve(cockpitDir, "claude_accounts.json"), JSON.stringify({
    accounts: [
      { id: "acct_icloud", email: "user@icloud.com", plan_type: "Free", account_uuid: "acct-ic", organization_uuid: "org-ic" },
      { id: "acct_hotmail", email: "user@hotmail.com", plan_type: "Pro", account_uuid: "acct-hot", organization_uuid: "org-hot" },
    ],
  }), "utf8");

  await writeFile(resolve(cockpitDir, "claude_instances.json"), JSON.stringify({
    defaultSettings: {
      bindAccountId: "acct_icloud",
      followLocalAccount: false,
    },
    instances: [
      {
        id: "inst-hot",
        name: "claude hotmail",
        userDataDir: desktopHotmailDir,
        bindAccountId: "acct_hotmail",
      },
    ],
  }), "utf8");

  const testEnv = {
    ...process.env,
    HOME: fakeHome,
    USERPROFILE: fakeHome,
    CLAUDE_BIN: MOCK_CLAUDE_BIN,
  };
  delete testEnv.CLAUDE_CONFIG_DIR;

  const provider = new ClaudeProvider({ env: testEnv });
  t.after(() => provider.close());

  const profiles = await provider.listProfiles();
  assert.deepEqual(profiles.map((p) => p.id), ["default", "claude-hotmail", "work"]);

  const hotmailProfile = profiles.find((p) => p.id === "claude-hotmail");
  assert.equal(hotmailProfile?.isDesktopInstance, true);
  assert.equal(hotmailProfile?.dedicatedCliConfigDir, dedicatedHotmailDir);
  assert.equal(hotmailProfile?.cliConfigDir, dedicatedHotmailDir);
  assert.equal(hotmailProfile?.historyDir, defaultClaudeDir);

  const defaultProfile = profiles.find((p) => p.id === "default");
  assert.equal(defaultProfile?.cliConfigDir, altDefaultDir);

  const hotmailThreads = await provider.listThreads("claude-hotmail");
  assert.ok(hotmailThreads.some((th) => th.rawId === histDeskId));
  assert.ok(hotmailThreads.some((th) => th.rawId === cliSessId));
});

test("ClaudeProvider captures rate_limit_event from CLI stream-json & probe, persists across restart", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-claude-rl-"));
  const claudeDir = resolve(dir, ".claude");
  const dataDir = resolve(dir, "data");
  await Promise.all([
    mkdir(claudeDir, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
  ]);
  t.after(() => rm(dir, { recursive: true, force: true }));

  const rlEvents = [];
  const completions = [];
  const env = {
    ...process.env,
    CLAUDE_BIN: MOCK_CLAUDE_BIN,
    AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: claudeDir }]),
  };

  const provider = new ClaudeProvider({
    env,
    dataDir,
    onEvent: (evt) => {
      if (evt.type === "rate_limit_updated") rlEvents.push(evt);
      if (evt.type === "turn_completed") completions.push(evt);
    },
  });

  const created = await provider.startThread({
    profileId: "default",
    cwd: dir,
    text: "测试 [RATE_LIMIT] 事件采集",
  });
  await waitFor(() => completions.find((e) => e.threadId === created.thread.id));
  await waitFor(() => rlEvents.length >= 1);

  const cached = await provider.readRateLimits("default");
  assert.equal(cached?.fiveHour?.utilization, 0.75);
  assert.equal(cached?.sevenDay?.utilization, 0.34);
  assert.equal(cached?.source, "claude-cli-stream");
  await provider.close();

  // Verify persistence survives provider restart and probeClaudeProfile captures new sample.
  const futureReset5h = Math.floor(Date.now() / 1000) + 7200;
  const futureReset7d = Math.floor(Date.now() / 1000) + 86400 * 5;
  await writeFile(resolve(claudeDir, ".mock-rate-limit.json"), JSON.stringify({
    status: "allowed",
    resetsAt: futureReset5h,
    rateLimitType: "five_hour",
    unifiedWindows: {
      five_hour: { utilization: 0.4, resetsAt: futureReset5h, status: "allowed" },
      seven_day: { utilization: 0.5, resetsAt: futureReset7d, status: "allowed" },
    },
  }), "utf8");

  const completions2 = [];
  const provider2 = new ClaudeProvider({
    env,
    dataDir,
    onEvent: (evt) => {
      if (evt.type === "turn_completed") completions2.push(evt);
    },
  });
  t.after(() => provider2.close());
  const reloaded = await provider2.readRateLimits("default");
  assert.equal(reloaded?.fiveHour?.utilization, 0.75);
  assert.equal(reloaded?.sevenDay?.utilization, 0.34);

  // Subsequent CLI turn updates cached limits from .mock-rate-limit.json.
  await provider2.sendTurn({
    profileId: "default",
    rawId: created.thread.rawId,
    cwd: dir,
    text: "第二轮刷新额度",
  });
  await waitFor(() => completions2.length >= 1);
  const afterTurn2 = await provider2.readRateLimits("default");
  assert.equal(afterTurn2?.fiveHour?.utilization, 0.4);
  assert.equal(afterTurn2?.sevenDay?.utilization, 0.5);
});
