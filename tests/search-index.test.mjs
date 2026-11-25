import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { handleDemoApiRequest } from "../public/demo-fixtures.js";
import {
  buildProjectGroups,
  renderHighlightedTextHtml,
  renderProjectBoardHtml,
  renderSidebarThreadListHtml,
  splitSearchTerms,
} from "../public/project-board.js";
import {
  MAX_MESSAGES_PER_THREAD,
  MAX_MESSAGE_CHARS,
  capThreadMessages,
  extractAntigravityTranscriptMessages,
  extractClaudeJsonlMessages,
  extractCodexRolloutMessages,
  extractGrokChatMessages,
  extractMatchSnippet,
  normalizeIndexedMessageText,
  scanAntigravityProfileFiles,
  scanClaudeProfileFiles,
  scanCodexProfileFiles,
  scanGrokProfileFiles,
  scanQoderThreads,
} from "../src/search-extractors.mjs";
import { SearchIndexService } from "../src/search-index.mjs";
import { createAgentControlServer } from "../src/server.mjs";
import { createThreadMetaStore } from "../src/thread-meta-store.mjs";

const MOCK_CODEX_BIN = fileURLToPath(new URL("./helpers/mock-codex-cli.mjs", import.meta.url));
const MOCK_CLAUDE_BIN = fileURLToPath(new URL("./helpers/mock-claude-cli.mjs", import.meta.url));
const MOCK_AGY_BIN = fileURLToPath(new URL("./helpers/mock-agy-cli.mjs", import.meta.url));

function makeCodexDb(dbPath, rows = []) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    DROP TABLE IF EXISTS threads;
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      rollout_path TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      source TEXT,
      model_provider TEXT,
      cwd TEXT,
      title TEXT,
      sandbox_policy TEXT,
      approval_mode TEXT,
      tokens_used INTEGER,
      has_user_event INTEGER,
      archived INTEGER DEFAULT 0,
      first_user_message TEXT,
      model TEXT,
      reasoning_effort TEXT,
      thread_source TEXT,
      preview TEXT,
      name TEXT,
      git_sha TEXT,
      git_branch TEXT,
      git_origin_url TEXT
    )
  `);
  const ins = db.prepare(`
    INSERT INTO threads (id, rollout_path, created_at, updated_at, source, cwd, title, archived, first_user_message, thread_source, preview, name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const r of rows) {
    ins.run(
      r.id,
      r.rolloutPath || "",
      r.createdAt || 1700000000,
      r.updatedAt || 1700000100,
      r.source || "cli",
      r.cwd || "/Users/alice/demo-app",
      r.title || "",
      r.archived ? 1 : 0,
      r.firstUserMessage || "",
      r.threadSource || "user",
      r.preview || "",
      r.name || "",
    );
  }
  db.close();
}

function makeAgySummaryDb(dbPath, rows = []) {
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
    )
  `);
  const ins = db.prepare(`
    INSERT INTO conversation_summaries (
      conversation_id, title, preview, step_count, last_modified_time,
      workspace_uris, status, source, parent_conversation_id, not_fully_idle, killed, app_data_dir
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, '')
  `);
  for (const r of rows) {
    ins.run(
      r.id,
      r.title || "",
      r.preview || "",
      r.stepCount ?? 2,
      r.lastModifiedTime || "2026-11-20T10:00:00Z",
      JSON.stringify([`file://${r.cwd || "/Users/alice/demo-app"}`]),
      "DONE",
      r.source || "CORTEX_TRAJECTORY_SOURCE_CLI",
      r.parentConversationId || "",
    );
  }
  db.close();
}

test("search-extractors clean noise, deduplicate turns, and enforce message caps across all 5 providers", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-search-ext-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  // 1) Codex rollout + fallback scanner
  const codexHome = resolve(root, "codex");
  const codexRolloutDir = resolve(codexHome, "sessions", "2026", "11", "20");
  await mkdir(codexRolloutDir, { recursive: true });
  const codexRollout = resolve(codexRolloutDir, "rollout-codex-1.jsonl");
  await writeFile(codexRollout, [
    JSON.stringify({ type: "session_meta", timestamp: "2026-11-20T10:00:00Z", payload: { id: "codex-1", cwd: "/Users/alice/demo-app" } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-11-20T10:00:01Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions for /Users/alice\nSecretSystemRule" }] } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-11-20T10:00:02Z", payload: { type: "user_message", message: "<environment_context>hidden</environment_context>" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-11-20T10:00:03Z", payload: { type: "user_message", message: "排查 WebSocket 断线重连问题" } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-11-20T10:00:03Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "排查 WebSocket 断线重连问题" }] } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-11-20T10:00:04Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "已经定位心跳超时导致重连失败。" }] } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-11-20T10:00:04Z", payload: { type: "agent_message", message: "已经定位心跳超时导致重连失败。" } }),
  ].join("\n") + "\n", "utf8");

  const codexRes = await extractCodexRolloutMessages(codexRollout);
  assert.equal(codexRes.messages.length, 2);
  assert.deepEqual(codexRes.messages.map((m) => [m.role, m.body]), [
    ["user", "排查 WebSocket 断线重连问题"],
    ["assistant", "已经定位心跳超时导致重连失败。"],
  ]);

  const codexFallbackDescs = await scanCodexProfileFiles({ provider: "codex", profileId: "default", home: codexHome });
  assert.equal(codexFallbackDescs.length, 1);
  assert.equal(codexFallbackDescs[0].rawId, "codex-1");

  // 2) Claude JSONL with base64 image + text, isMeta, pure tool_result, and compact summary
  const claudeHome = resolve(root, "claude");
  const claudeSlug = resolve(claudeHome, "projects", "-Users-alice-shop");
  await mkdir(claudeSlug, { recursive: true });
  const claudeFile = resolve(claudeSlug, "claude-1.jsonl");
  const hugeBase64 = "A".repeat(20_000);
  await writeFile(claudeFile, [
    JSON.stringify({ type: "user", isMeta: true, timestamp: "2026-11-20T09:00:00Z", cwd: "/Users/alice/shop", message: { content: "MetaNoiseToken" } }),
    JSON.stringify({ type: "user", isCompactSummary: true, timestamp: "2026-11-20T09:00:01Z", message: { content: "CompactSummaryToken" } }),
    JSON.stringify({ type: "user", timestamp: "2026-11-20T09:00:02Z", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ToolOutputNoise" }] } }),
    JSON.stringify({
      type: "user",
      timestamp: "2026-11-20T09:00:05Z",
      cwd: "/Users/alice/shop",
      message: {
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: hugeBase64 } },
          { type: "text", text: "看下这张订单详情截图怎么处理" },
        ],
      },
    }),
    JSON.stringify({
      type: "assistant",
      timestamp: "2026-11-20T09:00:10Z",
      message: {
        id: "msg-1",
        content: [
          { type: "thinking", thinking: "InternalThoughtShouldSkip" },
          { type: "text", text: "建议加上幂等校验并限制重试间隔。" },
        ],
      },
    }),
  ].join("\n") + "\n", "utf8");

  const claudeRes = await extractClaudeJsonlMessages(claudeFile, { fallbackCwd: "/Users/alice/shop" });
  assert.equal(claudeRes.skip, false);
  assert.equal(claudeRes.messages.length, 2);
  assert.equal(claudeRes.messages[0].body, "看下这张订单详情截图怎么处理");
  assert.equal(claudeRes.messages[1].body, "建议加上幂等校验并限制重试间隔。");
  const claudeDescs = await scanClaudeProfileFiles({ provider: "claude", profileId: "default", home: claudeHome });
  assert.equal(claudeDescs.length, 1);

  // 3) Antigravity compact transcript only (never transcript_full.jsonl) + skip subagent
  const agyHome = resolve(root, "agy");
  const agyLogs = resolve(agyHome, "brain", "agy-1", ".system_generated", "logs");
  await mkdir(agyLogs, { recursive: true });
  await writeFile(resolve(agyLogs, "transcript.jsonl"), [
    JSON.stringify({ type: "USER_INPUT", source: "USER_EXPLICIT", created_at: "2026-11-20T11:00:00Z", content: "<USER_REQUEST>\n实现 A股行情限流器\n</USER_REQUEST>" }),
    JSON.stringify({ type: "USER_INPUT", source: "SYSTEM", created_at: "2026-11-20T11:00:01Z", content: "ImplicitSystemInput" }),
    JSON.stringify({ type: "PLANNER_RESPONSE", created_at: "2026-11-20T11:00:05Z", content: "已使用令牌桶算法限制并发发送频率。" }),
  ].join("\n") + "\n", "utf8");
  await writeFile(resolve(agyLogs, "transcript_full.jsonl"), JSON.stringify({ type: "PLANNER_RESPONSE", content: "FullOnlyLeakToken" }) + "\n", "utf8");
  makeAgySummaryDb(resolve(agyHome, "conversation_summaries.db"), [
    { id: "agy-1", title: "行情限流任务", cwd: "/Users/alice/quant-demo" },
    { id: "agy-sub", title: "子代理任务", cwd: "/Users/alice/quant-demo", parentConversationId: "agy-1" },
  ]);

  const agyDescs = await scanAntigravityProfileFiles({ provider: "antigravity", profileId: "cli", profileType: "cli", home: agyHome });
  assert.equal(agyDescs.length, 1);
  assert.equal(agyDescs[0].rawId, "agy-1");
  const agyRes = await extractAntigravityTranscriptMessages(agyDescs[0].sourcePath);
  assert.equal(agyRes.messages.length, 2);
  assert.equal(agyRes.messages[0].body, "实现 A股行情限流器");
  assert.equal(agyRes.messages[1].body, "已使用令牌桶算法限制并发发送频率。");

  // 4) Grok sessions (strip <user_info>/<rules>, ignore reasoning/encrypted_content & title helper)
  const grokHome = resolve(root, "grok");
  const grokReal = resolve(grokHome, "sessions", "%2FUsers%2Falice%2Fdemo", "grok-1");
  const grokHelper = resolve(grokHome, "sessions", "%2F", "grok-helper");
  await mkdir(grokReal, { recursive: true });
  await mkdir(grokHelper, { recursive: true });
  await writeFile(resolve(grokReal, "summary.json"), JSON.stringify({
    info: { id: "grok-1", cwd: "/Users/alice/demo" },
    generated_title: "离线缓存方案",
    created_at: "2026-11-20T08:00:00Z",
    updated_at: "2026-11-20T08:05:00Z",
  }), "utf8");
  await writeFile(resolve(grokReal, "chat_history.jsonl"), [
    JSON.stringify({ type: "user", prompt_index: 0, content: [{ type: "text", text: "<user_info>secret</user_info><rules>IgnoreRule</rules><user_query>如何压缩离线缓存体积</user_query>" }] }),
    JSON.stringify({ type: "reasoning", encrypted_content: "EncryptedShouldSkip", summary: [{ text: "ThinkingSkip" }] }),
    JSON.stringify({ type: "assistant", content: "只存纯正文消息表，跳过倒排索引即可控制在 40MB 以内。" }),
  ].join("\n") + "\n", "utf8");
  await writeFile(resolve(grokHelper, "summary.json"), JSON.stringify({
    info: { id: "grok-helper", cwd: "/" },
    generated_title: "为下面这条用户消息起一个简短会话标题",
  }), "utf8");

  const grokDescs = await scanGrokProfileFiles({ provider: "grok", profileId: "default", home: grokHome });
  assert.equal(grokDescs.length, 2);
  const grokRealRes = await extractGrokChatMessages(grokReal, { cwdSlug: "%2FUsers%2Falice%2Fdemo", rawId: "grok-1" });
  assert.equal(grokRealRes.skip, false);
  assert.equal(grokRealRes.messages.length, 2);
  assert.equal(grokRealRes.messages[0].body, "如何压缩离线缓存体积");
  const grokHelperRes = await extractGrokChatMessages(grokHelper, { cwdSlug: "%2F", rawId: "grok-helper" });
  assert.equal(grokHelperRes.skip, true);

  // 5) Qoder threads
  const qoderDataDir = resolve(root, "data");
  await mkdir(qoderDataDir, { recursive: true });
  await writeFile(resolve(qoderDataDir, "qoder-threads.json"), JSON.stringify({
    version: 1,
    threads: [{
      rawId: "q-1",
      cwd: "/Users/alice/qoder-proj",
      preview: "Qoder 打包检查",
      createdAt: 1700000000,
      updatedAt: 1700000200,
      turns: [{
        id: "qt-1",
        items: [
          { type: "userMessage", content: [{ type: "text", text: "检查构建签名参数" }] },
          { type: "agentMessage", text: "签名证书路径校验通过。" },
        ],
      }],
    }],
  }), "utf8");
  const qoderDescs = await scanQoderThreads(qoderDataDir);
  assert.equal(qoderDescs.length, 1);
  assert.equal(qoderDescs[0].inlineMessages.length, 2);

  // 6) Normalization, 4000-char cap, 200-message cap, and snippet extraction
  const longText = "x".repeat(5000);
  assert.equal(normalizeIndexedMessageText(longText).length, MAX_MESSAGE_CHARS);
  const manyMsgs = Array.from({ length: 240 }, (_, i) => ({ role: i % 2 === 0 ? "user" : "assistant", body: `msg-${i}` }));
  const capped = capThreadMessages(manyMsgs);
  assert.equal(capped.length, MAX_MESSAGES_PER_THREAD);
  assert.equal(capped[0].body, "msg-0");
  assert.equal(capped[19].body, "msg-19");
  assert.equal(capped[20].body, "msg-60");
  assert.equal(capped[199].body, "msg-239");

  const snippet = extractMatchSnippet("前面是一段铺垫文字用于说明背景，这里包含核心关键词 缓存分片校验 并且后面还有一段详细解释。", ["分片"]);
  assert.ok(snippet.includes("分片"));
});

test("SearchIndexService indexes incrementally in worker, handles short CJK / multi-word AND / LIKE escapes, and closes cleanly", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-search-svc-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const dataDir = resolve(root, "data");
  const codexHome = resolve(root, "codex");
  const agyHome = resolve(root, "agy");
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(resolve(codexHome, "sessions"), { recursive: true }),
    mkdir(resolve(agyHome, "brain", "agy-thread-1", ".system_generated", "logs"), { recursive: true }),
  ]);

  const rollout1 = resolve(codexHome, "sessions", "c1.jsonl");
  await writeFile(rollout1, [
    JSON.stringify({ type: "event_msg", timestamp: "2026-11-20T10:00:00Z", payload: { type: "user_message", message: "请把 WebSocket 网关的 100% 进度逻辑改掉" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-11-20T10:00:05Z", payload: { type: "agent_message", message: "已优化断线重连和 token_bucket 限流策略。" } }),
  ].join("\n") + "\n", "utf8");

  const rollout2 = resolve(codexHome, "sessions", "c2.jsonl");
  await writeFile(rollout2, [
    JSON.stringify({ type: "event_msg", timestamp: "2026-11-20T11:00:00Z", payload: { type: "user_message", message: "帮我看一下 C端 订单自动取消有没有风险" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-11-20T11:00:10Z", payload: { type: "agent_message", message: "建议先评估优惠券核销的风控策略。" } }),
  ].join("\n") + "\n", "utf8");

  makeCodexDb(resolve(codexHome, "state_5.sqlite"), [
    { id: "c1", rolloutPath: rollout1, cwd: "/Users/alice/gateway", title: "网关改造", updatedAt: 1700000100 },
    { id: "c2", rolloutPath: rollout2, cwd: "/Users/alice/shop-bot", title: "订单策略讨论", updatedAt: 1700000200 },
  ]);

  await writeFile(resolve(agyHome, "brain", "agy-thread-1", ".system_generated", "logs", "transcript.jsonl"), [
    JSON.stringify({ type: "USER_INPUT", source: "USER_EXPLICIT", created_at: "2026-11-20T12:00:00Z", content: "设计一个多智能体调度器" }),
    JSON.stringify({ type: "PLANNER_RESPONSE", created_at: "2026-11-20T12:00:06Z", content: "可以通过队列和审批隔离来保障并发安全。" }),
  ].join("\n") + "\n", "utf8");
  makeAgySummaryDb(resolve(agyHome, "conversation_summaries.db"), [
    { id: "agy-thread-1", title: "调度器架构", cwd: "/Users/alice/gateway", lastModifiedTime: "2026-11-20T12:00:06Z" },
  ]);

  const metaStore = createThreadMetaStore({ filePath: resolve(dataDir, "thread-meta.json") });
  await metaStore.load();
  await metaStore.setProjectMeta("/Users/alice/shop-bot", { alias: "示例商城" });

  const profiles = [
    { provider: "codex", profileId: "default", profileLabel: "Codex 默认", home: codexHome },
    { provider: "antigravity", profileId: "cli", profileType: "cli", profileLabel: "Agy CLI", home: agyHome },
  ];

  const service = new SearchIndexService({
    dataDir,
    metaStore,
    getProfileDescriptors: async () => profiles,
    sweepIntervalMs: 0,
  });
  t.after(() => service.close());

  const firstSync = await service.syncNow();
  assert.equal(firstSync.ready, true);
  assert.equal(firstSync.indexedThreads, 3);
  assert.equal(firstSync.updatedCount, 3);

  // Unchanged incremental sync should skip parsing all files
  const secondSync = await service.syncNow();
  assert.equal(secondSync.updatedCount, 0);
  assert.equal(secondSync.removedCount, 0);

  // 2-char CJK search
  const shortZh = service.search({ query: "订单" });
  assert.equal(shortZh.hits.length, 1);
  assert.equal(shortZh.hits[0].thread.id, "codex:default:c2");
  assert.equal(shortZh.hits[0].searchMatch.matchRole, "user");
  assert.ok(shortZh.hits[0].searchMatch.matchSnippet.includes("订单"));

  // Case-insensitive English search
  const wsHits = service.search({ query: "websocket" });
  assert.equal(wsHits.hits.length, 1);
  assert.equal(wsHits.hits[0].thread.id, "codex:default:c1");

  // Multi-word AND across project alias + body text across messages
  const crossHits = service.search({
    query: "示例商城 风控",
    projectsMeta: metaStore.listProjects(),
  });
  assert.equal(crossHits.hits.length, 1);
  assert.equal(crossHits.hits[0].thread.id, "codex:default:c2");
  assert.ok(crossHits.hits[0].searchMatch.matchSnippet.includes("风控"));

  // LIKE wildcard escaping (% and _)
  const pctHits = service.search({ query: "100%" });
  assert.equal(pctHits.hits.length, 1);
  assert.equal(pctHits.hits[0].thread.id, "codex:default:c1");

  const underHits = service.search({ query: "token_bucket" });
  assert.equal(underHits.hits.length, 1);
  assert.equal(underHits.hits[0].thread.id, "codex:default:c1");

  // Bare '%' must NOT match all rows
  const barePctHits = service.search({ query: "%" });
  assert.equal(barePctHits.hits.length, 1);

  // Provider filter
  const agyOnly = service.search({ query: "调度", provider: "antigravity" });
  assert.equal(agyOnly.hits.length, 1);
  assert.equal(agyOnly.hits[0].thread.id, "antigravity:cli:agy-thread-1");
  assert.equal(service.search({ query: "调度", provider: "codex" }).hits.length, 0);

  // Append new message to rollout1 and bump mtime/size -> incremental re-index picks it up
  await writeFile(rollout1, [
    JSON.stringify({ type: "event_msg", timestamp: "2026-11-20T10:00:00Z", payload: { type: "user_message", message: "请把 WebSocket 网关的 100% 进度逻辑改掉" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-11-20T10:00:05Z", payload: { type: "agent_message", message: "已优化断线重连和 token_bucket 限流策略。" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-11-20T10:05:00Z", payload: { type: "user_message", message: "顺便检查一下增量同步暗号 DeltaSyncToken" } }),
  ].join("\n") + "\n", "utf8");
  const futureDate = new Date(Date.now() + 5000);
  await utimes(rollout1, futureDate, futureDate);

  const thirdSync = await service.syncNow();
  assert.equal(thirdSync.updatedCount, 1);
  const deltaHits = service.search({ query: "DeltaSyncToken" });
  assert.equal(deltaHits.hits.length, 1);
  assert.equal(deltaHits.hits[0].thread.id, "codex:default:c1");

  // Remove c2 from upstream db -> removed from index
  makeCodexDb(resolve(codexHome, "state_5.sqlite"), [
    { id: "c1", rolloutPath: rollout1, cwd: "/Users/alice/gateway", title: "网关改造", updatedAt: 1700000100 },
  ]);
  const fourthSync = await service.syncNow();
  assert.equal(fourthSync.removedCount, 1);
  assert.equal(service.search({ query: "订单" }).hits.length, 0);

  await service.close();
});

test("HTTP GET /api/threads/search searches history content, honors live rename & archive, and strips local file paths", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-search-http-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const dataDir = resolve(root, "data");
  const codexHome = resolve(root, "codex");
  const claudeDir = resolve(root, "claude");
  const agyDir = resolve(root, "agy-cli");
  const grokDir = resolve(root, "grok");
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(resolve(codexHome, "sessions"), { recursive: true }),
    mkdir(resolve(claudeDir, "projects"), { recursive: true }),
    mkdir(agyDir, { recursive: true }),
    mkdir(grokDir, { recursive: true }),
  ]);

  const rolloutPath = resolve(codexHome, "sessions", "http-c1.jsonl");
  await writeFile(rolloutPath, [
    JSON.stringify({ type: "event_msg", timestamp: "2026-11-20T10:00:00Z", payload: { type: "user_message", message: "今天排查一下支付回调超时" } }),
    JSON.stringify({ type: "event_msg", timestamp: "2026-11-20T10:00:08Z", payload: { type: "agent_message", message: "已确认是签名校验耗时过长导致网关超时。" } }),
  ].join("\n") + "\n", "utf8");
  makeCodexDb(resolve(codexHome, "state_5.sqlite"), [
    { id: "http-c1", rolloutPath, cwd: "/Users/alice/payments", title: "日常巡检", updatedAt: 1700000500 },
  ]);

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
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
  });
  await srv.start();
  t.after(() => srv.close());

  await srv.hub.syncSearchIndexNow();

  const res1 = await fetch(`${srv.url}/api/threads/search?q=${encodeURIComponent("签名校验")}`);
  assert.equal(res1.status, 200);
  const body1 = await res1.json();
  assert.equal(body1.ok, true);
  assert.equal(body1.threads.length, 1);
  assert.equal(body1.threads[0].id, "codex:default:http-c1");
  assert.equal(body1.threads[0].searchMatch.matchRole, "assistant");
  assert.ok(body1.threads[0].searchMatch.matchSnippet.includes("签名校验"));
  assert.equal("rolloutPath" in body1.threads[0], false);
  assert.equal("path" in body1.threads[0], false);
  assert.equal("sourcePath" in body1.threads[0], false);

  // Rename immediately searchable (title + body AND)
  await srv.hub.renameThread("codex:default:http-c1", "账单对账任务");
  const resRenamed = await fetch(`${srv.url}/api/threads/search?q=${encodeURIComponent("账单对账 签名校验")}`);
  const bodyRenamed = await resRenamed.json();
  assert.equal(bodyRenamed.threads.length, 1);
  assert.equal(bodyRenamed.threads[0].title, "账单对账任务");

  // Archive immediately filters archived=0 vs archived=1
  await srv.hub.archiveThread("codex:default:http-c1", true);
  const activeRes = await (await fetch(`${srv.url}/api/threads/search?q=${encodeURIComponent("签名校验")}&archived=0`)).json();
  assert.equal(activeRes.threads.length, 0);
  const archivedRes = await (await fetch(`${srv.url}/api/threads/search?q=${encodeURIComponent("签名校验")}&archived=1`)).json();
  assert.equal(archivedRes.threads.length, 1);
  assert.equal(archivedRes.threads[0].archived, true);
});

test("frontend search helpers support multi-word AND, remote snippet merging, safe <mark> highlighting, and demo search", async () => {
  assert.deepEqual(splitSearchTerms("  网关   限流  网关 "), ["网关", "限流"]);

  const highlighted = renderHighlightedTextHtml("<script>alert('限流')</script> 限流处理", "限流");
  assert.ok(!highlighted.includes("<script>"));
  assert.ok(highlighted.includes("&lt;script&gt;"));
  assert.ok(highlighted.includes('<mark class="search-hit-mark">限流</mark>'));

  const remoteThread = {
    id: "claude:default:old-1",
    provider: "claude",
    profileId: "default",
    profileLabel: "Claude",
    cwd: "/Users/alice/demo-app",
    title: "早期排查任务",
    preview: "普通预览",
    updatedAt: 1700000000,
    live: false,
  };
  const matchesById = new Map([
    [remoteThread.id, {
      matchSource: "content",
      matchRole: "assistant",
      matchSnippet: "…定位到 网关 限流接口触发阈值…",
      matchCount: 3,
    }],
  ]);

  const groups = buildProjectGroups([
    {
      id: "codex:default:meta-1",
      provider: "codex",
      profileId: "default",
      cwd: "/Users/alice/demo-app",
      title: "修复 网关 登录与限流同步",
      preview: "已完成登录态检查",
      updatedAt: 1700000100,
      live: false,
    },
    remoteThread,
  ], {
    searchText: "网关 限流",
    searchMatchesByThread: matchesById,
  });

  assert.equal(groups.length, 1);
  assert.equal(groups[0].threads.length, 2);

  const sidebarHtml = renderSidebarThreadListHtml(groups, {
    searchText: "网关 限流",
    searchLoading: true,
    searchIndexStatus: { indexing: true, indexedThreads: 10, totalThreads: 25 },
  });
  assert.ok(sidebarHtml.includes("AI: …定位到"));
  assert.ok(sidebarHtml.includes('<mark class="search-hit-mark">网关</mark>'));
  assert.ok(sidebarHtml.includes('<mark class="search-hit-mark">限流</mark>'));
  assert.ok(sidebarHtml.includes("3 处"));
  assert.ok(sidebarHtml.includes("后台建立历史正文索引中（10/25）…"));

  const boardHtml = renderProjectBoardHtml({
    groups,
    allGroups: groups,
    searchText: "网关 限流",
  });
  assert.ok(boardHtml.includes('<mark class="search-hit-mark">限流</mark>'));
  assert.ok(boardHtml.includes("AI: …定位到"));

  const demoRes = await handleDemoApiRequest("api/threads/search?q=" + encodeURIComponent("阶段汇报"));
  assert.equal(demoRes.ok, true);
  assert.ok(demoRes.threads.length >= 1);
  assert.ok(demoRes.threads[0].searchMatch.matchSnippet.includes("阶段汇报"));
});
