import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createRelayServer } from "../relay/relay-server.mjs";
import { readAntigravityIndexedThreadById } from "../src/providers/antigravity-history.mjs";
import {
  antigravityModeId,
  claudePermissionMode,
  codexExecutionPolicy,
  isTurboPermissionMode,
  PERMISSION_MODES,
} from "../src/permissions.mjs";
import { createGoalController } from "../src/goal-controller.mjs";
import { resolveAutoProfileAliases, suggestFallbackDistinctAliases } from "../src/profile-auto-alias.mjs";
import { classifyProfileError, normalizeProfileHealth, sortProfilesByHealth } from "../src/profile-health.mjs";
import { mergeActiveTurnIntoHistory } from "../src/thread-display.mjs";
import { ProviderHub } from "../src/provider-hub.mjs";
import { createThreadMetaStore } from "../src/thread-meta-store.mjs";
import { createAgentControlServer } from "../src/server.mjs";
import {
  DEFAULT_VOICE_HYDROGEN_MODEL,
} from "../src/voice-call-service.mjs";
import { createHotExtensionServer, mergeUpstreamLiveThreadState } from "../src/hot-extension.mjs";
import { apiGet, apiUrl, clearApiEtagCache, isHostOfflineError } from "../public/api-client.js";
import {
  extractGoalDirective,
  renderQueuedTurnsPanelHtml,
  resolveComposerSubmission,
  shouldAllowSendButtonClick,
  shouldSubmitPromptOnEnter,
} from "../public/composer-mode.js";
import { bindFollowIntent } from "../public/live-state.js";
import {
  extractSelectDescriptor,
  renderCustomSelectMenuHtml,
  renderCustomSelectTriggerInnerHtml,
} from "../public/custom-select.js";
import {
  computeScaledDimensions,
  estimateDataUrlBytes,
  formatByteSize,
  shouldKeepOriginalImageDataUrl,
  validateImageBatchBudget,
} from "../public/image-attachment.js";
import {
  capOversizedThreadInlineImages,
  capOversizedThreadToolOutputs,
  sanitizeEventForSse,
  summarizeQueuedTurnEntry,
} from "../src/provider-hub.mjs";
import {
  buildSelectableTelemetryItems,
  CLIENT_FALLBACK_MODELS,
  compactEffortBadgeLabel,
  compactModelBadgeLabel,
  compactProfileChipText,
  compactThreadSourceChip,
  ensurePreferredModelInList,
  findFailoverCandidateProfile,
  formatProfileIdentityHint,
  formatQuotaResetRelative,
  formatTokensPerSec,
  normalizeUiPermissionMode,
  permissionModeDisplayLabel,
  permissionVisualMeta,
  pickBestAvailableProfile,
  pickDefaultModelForProvider,
  profileHealthVisualMeta,
  profileOptionLabel,
  providerDisplayName,
  providerVisualMeta,
  renderAgentTelemetryBarHtml,
  renderInstanceManagerListHtml,
  renderProfilePillsHtml,
  renderProviderPillsHtml,
  renderQuotaOverviewHtml,
  resolveDistinctProfileChipText,
  resolveModelsForProvider,
  resolveVisibleTelemetryKeys,
  sortProfilesByAvailability,
  summarizeTelemetryMobileBadge,
  UI_PERMISSION_MODES,
} from "../public/instance-switcher.js";
import { humanizeLiveActivity, mergeLiveActivity, summarizeToolUseActivity } from "../public/live-state.js";
import {
  clearFailedThreadImages,
  dedupeAdjacentTurns,
  formatCompactPath,
  formatToolExecutionError,
  isRawToolEchoItem,
  isRecoverableToolErrorText,
  isStreamingTextAlreadyPersisted,
  isThreadImageFailed,
  markThreadImageFailed,
  normalizeTurnForRender,
  renderMarkdown,
  renderTurnHtml,
  summarizeProcessItems,
  turnEndsWithProcessGroup,
  unwrapToolText,
} from "../public/markdown.js";
import {
  THREAD_EXPAND_STEP,
  buildProjectGroups,
  compactThreadErrorSummary,
  computeProjectGroupSelectionState,
  dedupeThreadPreview,
  isSameProjectCwd,
  isThreadFailed,
  isUserHomeCwd,
  normalizeProjectCwd,
  partitionSidebarProjectGroups,
  projectBaseName,
  renderBatchActionBarHtml,
  renderProjectBoardHtml,
  renderProjectTaskStripHtml,
  renderSidebarThreadListHtml,
  resolveProjectGroupCollapsed,
  suggestFocusProjects,
} from "../public/project-board.js";
import { renderServerRequestCard } from "../public/server-request-ui.js";
import {
  buildReleaseVersionTabs,
  renderReleaseHeadline,
  renderReleaseNotesCardHtml,
  resolveReleaseNotesBucket,
} from "../public/release-notes.js";
import {
  createVadTurnDetector,
  downsampleFloat32ToInt16,
  encodePcm16SamplesToWav,
  extractFinalAssistantMessageFromTurns,
  extractReplyClosingSummaryForSpeech,
  loadChatReplyTtsPref,
  pcm16Base64ToWavBytes,
  resolveHoldTalkGestureState,
  saveChatReplyTtsPref,
  stripMarkdownForSpeech,
  uint8ArrayToBase64,
} from "../public/voice-copilot.js";

const MOCK_CODEX_BIN = fileURLToPath(new URL("./helpers/mock-codex-cli.mjs", import.meta.url));
const MOCK_CLAUDE_BIN = fileURLToPath(new URL("./helpers/mock-claude-cli.mjs", import.meta.url));
const MOCK_AGY_BIN = fileURLToPath(new URL("./helpers/mock-agy-cli.mjs", import.meta.url));
const MOCK_EDGE_TTS_BIN = fileURLToPath(new URL("./helpers/mock-edge-tts.mjs", import.meta.url));
const MOCK_VOICE_ASR_BIN = fileURLToPath(new URL("./helpers/mock-voice-asr.mjs", import.meta.url));

test("apiUrl preserves relay instance prefix and builds clean relative paths", () => {
  assert.equal(
    apiUrl("/api/threads?archived=0", "https://relay.example.com/i/mac01/"),
    "https://relay.example.com/i/mac01/api/threads?archived=0",
  );
  assert.equal(
    apiUrl("api/events", "http://127.0.0.1:43310/"),
    "http://127.0.0.1:43310/api/events",
  );
  assert.equal(isHostOfflineError({ status: 503 }), true);
  assert.equal(isHostOfflineError({ code: "host_offline" }), true);
});

test("composer-mode and live-state helpers compute actions and monotonic updates", () => {
  assert.deepEqual(resolveComposerSubmission({ hasActiveThread: true, isSubmitting: true, text: "hi" }), {
    action: "busy",
    canSubmit: false,
    buttonLabel: "发送中…",
  });
  assert.equal(resolveComposerSubmission({ hasActiveThread: false, text: "hi" }).action, "new");
  assert.equal(resolveComposerSubmission({ hasActiveThread: true, isRunning: false, text: "hi" }).action, "turn");
  assert.equal(resolveComposerSubmission({ hasActiveThread: true, isRunning: true, mode: "queue", text: "hi" }).action, "queue");
  assert.equal(resolveComposerSubmission({ hasActiveThread: true, isRunning: true, mode: "steer", text: "hi" }).action, "steer");

  assert.deepEqual(extractGoalDirective("/goal 完成所有重构"), {
    hasDirective: true,
    cleanedText: "完成所有重构",
  });

  const terminal = { turnId: "t1", status: "completed", phase: "已完成" };
  const merged = mergeLiveActivity(terminal, { turnId: "t1", status: "running", phase: "旧进度" });
  assert.equal(merged.status, "completed");
});

test("markdown, turn renderer, and server-request UI support all 3 agents cleanly without XSS", () => {
  const md = renderMarkdown("# 标题\n<script>alert(1)</script>\n\n已完成\n<!-- GOAL_COMPLETE -->");
  assert.doesNotMatch(md, /<script>/);
  assert.match(md, /&lt;script&gt;/);
  assert.doesNotMatch(md, /GOAL_COMPLETE/);

  const turnHtml = renderTurnHtml({
    id: "turn-1",
    items: [
      { type: "userMessage", content: [{ type: "text", text: "测试输入" }] },
      { type: "agentMessage", text: "执行完毕 <!-- GOAL_COMPLETE -->", phase: "final_answer" },
    ],
  }, { agentLabel: providerDisplayName("claude") });
  assert.match(turnHtml, /Claude Code/);
  assert.match(turnHtml, /目标已达成/);

  const cmdCard = renderServerRequestCard({
    id: "codex:default:1",
    provider: "codex",
    kind: "command",
    command: "ls -la",
    availableDecisions: ["accept", "decline"],
  });
  assert.match(cmdCard, /Codex/);
  assert.match(cmdCard, /允许一次/);

  const acpCard = renderServerRequestCard({
    id: "antigravity:cli:2",
    provider: "antigravity",
    kind: "acpPermission",
    title: "Antigravity 请求授权",
    options: [
      { optionId: "allow_once", name: "Allow Once", kind: "allow_once" },
      { optionId: "reject_once", name: "Reject Once", kind: "reject_once" },
    ],
  });
  assert.match(acpCard, /data-option-id="allow_once"/);

  const askCard = renderServerRequestCard({
    id: "claude:default:3",
    provider: "claude",
    kind: "userInput",
    questions: [{
      id: "q1",
      header: "确认",
      question: "继续吗？",
      options: [{ label: "是", description: "立即继续" }],
    }],
  });
  assert.match(askCard, /Claude Code/);
  assert.match(askCard, /提交回答/);

  assert.equal(pickDefaultModelForProvider([{ id: "m1", provider: "codex", isDefault: true }], "codex")?.id, "m1");
  const claudeFallback = resolveModelsForProvider({}, [], "claude");
  assert.equal(pickDefaultModelForProvider(claudeFallback, "claude")?.id, "claude-sonnet-5-5");
  assert.deepEqual(
    claudeFallback.filter((m) => m.section === "main").map((m) => m.id),
    ["claude-opus-5-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-haiku-5-5"],
  );
});

test("relay mobile send flow delivers Antigravity turns, returns explicit errors, and serves no-store UI assets", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-mobile-relay-"));
  const dataDir = resolve(root, "data");
  await mkdir(dataDir, { recursive: true });

  const relay = createRelayServer({
    port: 0,
    relayKey: "mobile-test-key",
    dataPath: resolve(root, "relay-state.json"),
  });
  await relay.start();

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: false,
    dataDir,
    env: {
      ...process.env,
      CODEX_BIN: MOCK_CODEX_BIN,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: resolve(root, "codex") }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: resolve(root, "claude") }]),
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "cli", label: "Antigravity CLI", home: resolve(root, "agy-cli"), profileType: "cli" }]),
    },
  });
  await srv.start();
  t.after(async () => {
    await srv.close();
    await relay.close();
    await rm(root, { recursive: true, force: true });
  });

  const invite = await (await fetch(`${relay.url}/admin/invites`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Relay-Key": "mobile-test-key" },
    body: JSON.stringify({ label: "手机测试" }),
  })).json();
  const pairData = await (await fetch(`${srv.url}/api/remote/pair`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ relayUrl: relay.url, inviteCode: invite.inviteCode, label: "手机测试" }),
  })).json();

  // Wait until WebSocket tunnel connects.
  for (let i = 0; i < 40; i += 1) {
    const h = await (await fetch(`${relay.url}/health`)).json();
    if (h.onlineHosts === 1) break;
    await new Promise((r) => setTimeout(r, 50));
  }

  const connectRes = await fetch(pairData.pairUrl, { redirect: "manual" });
  assert.equal(connectRes.status, 302);
  const cookieHeader = (connectRes.headers.get("set-cookie") || "").split(";")[0];
  const basePrefix = `${relay.url}/i/${srv.identity.instanceId}/`;

  // Static UI assets served with Cache-Control: no-store and mobile composer elements.
  const htmlRes = await fetch(apiUrl("", basePrefix), { headers: { Cookie: cookieHeader } });
  assert.equal(htmlRes.status, 200);
  assert.equal(htmlRes.headers.get("cache-control"), "no-store");
  const html = await htmlRes.text();
  assert.match(html, /id="composerStatus"/);
  assert.match(html, /id="composerConfigBtn"/);
  assert.match(html, /id="composerConfigPopover"/);
  assert.match(html, /id="topbarMoreBtn"/);
  assert.match(html, /id="sendBtn"/);
  assert.match(html, /id="projectBoard"/);
  assert.match(html, /id="projectTaskStrip"/);
  assert.match(html, /id="voiceModeBtn"/);
  assert.match(html, /id="spriteFullscreenMount"/);
  assert.match(html, /id="newModelSelect"/);

  const provRes = await fetch(apiUrl("api/providers", basePrefix), { headers: { Cookie: cookieHeader } });
  assert.equal(provRes.status, 200);
  const provPayload = await provRes.json();
  assert.equal(provPayload.defaultProvider, "antigravity");

  const metaRes = await fetch(apiUrl("api/project/meta", basePrefix), {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      cwd: "/tmp/mock-agy-project",
      pinned: true,
      alias: "示例商城",
    }),
  });
  assert.equal(metaRes.status, 200);
  const metaJson = await metaRes.json();
  assert.equal(metaJson.projectsMeta["/tmp/mock-agy-project"]?.pinned, true);
  assert.equal(metaJson.projectsMeta["/tmp/mock-agy-project"]?.alias, "示例商城");

  const threadsRes = await fetch(apiUrl("api/threads", basePrefix), { headers: { Cookie: cookieHeader } });
  const threadsJson = await threadsRes.json();
  assert.equal(threadsJson.projectsMeta?.["/tmp/mock-agy-project"]?.alias, "示例商城");

  const jsRes = await fetch(apiUrl("app.js", basePrefix), { headers: { Cookie: cookieHeader } });
  assert.equal(jsRes.status, 200);
  assert.equal(jsRes.headers.get("cache-control"), "no-store");

  // Sending to Antigravity session over relay succeeds (200) instead of failing with absolute path error.
  const turnRes = await fetch(apiUrl("api/turn", basePrefix), {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      threadId: "antigravity:cli:agy-seed-session-1",
      text: "手机端发送验证",
      model: "gemini-pro-orchestrator",
      effort: "high",
      permissionMode: "workspace",
    }),
  });
  assert.equal(turnRes.status, 200);
  const turnPayload = await turnRes.json();
  assert.equal(turnPayload.turn?.status, "inProgress");

  // Error responses over relay are returned explicitly as structured JSON (never silent 200).
  const badRes = await fetch(apiUrl("api/turn", basePrefix), {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ threadId: "invalid-id", text: "触发错误" }),
  });
  assert.ok(badRes.status >= 400);
  const badJson = await badRes.json();
  assert.ok(badJson.error?.message);

  // Switching an active thread with a pending permission request to Turbo via /api/thread/prefs auto-approves immediately!
  const permNewRes = await fetch(apiUrl("api/thread/new", basePrefix), {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      provider: "antigravity",
      profileId: "cli",
      cwd: root,
      text: "需要授权 [AGY_PERMISSION]",
      permissionMode: "workspace",
    }),
  });
  assert.equal(permNewRes.status, 200);
  const permThreadId = (await permNewRes.json()).thread.id;

  // Wait until pending request appears on thread read.
  const deadline = Date.now() + 4000;
  let pendingCount = 0;
  while (Date.now() < deadline) {
    const thRes = await fetch(apiUrl(`api/thread?id=${encodeURIComponent(permThreadId)}`, basePrefix), {
      headers: { Cookie: cookieHeader },
    });
    const thJson = await thRes.json();
    pendingCount = (thJson.pendingRequests || []).length;
    if (pendingCount > 0) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.equal(pendingCount, 1);

  const prefsRes = await fetch(apiUrl("api/thread/prefs", basePrefix), {
    method: "POST",
    headers: {
      Cookie: cookieHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      threadId: permThreadId,
      model: "gemini-4-carbon-high",
      permissionMode: "turbo",
    }),
  });
  assert.equal(prefsRes.status, 200);
  const prefsJson = await prefsRes.json();
  assert.equal(prefsJson.autoApprovedCount, 1);
  assert.equal(prefsJson.prefs.permissionMode, "turbo");
  assert.equal(prefsJson.prefs.model, "gemini-4-carbon-high");
});

test("project-board and voice-copilot modules prioritize pinned projects, match voice targets, and build valid WAV", async () => {
  const threads = [
    {
      id: "codex:default:t-home",
      provider: "codex",
      profileId: "default",
      profileLabel: "默认",
      title: "临时提问",
      preview: "看个报错",
      cwd: "/Users/demo",
      updatedAt: 300,
    },
    {
      id: "antigravity:cli:t-demo-1",
      provider: "antigravity",
      profileId: "cli",
      profileLabel: "CLI",
      title: "家具透视修复",
      preview: "完成布局朝向检查",
      cwd: "/workspace/demo/demo-app",
      updatedAt: 200,
      live: true,
    },
    {
      id: "claude:default:t-demo-2",
      provider: "claude",
      profileId: "default",
      profileLabel: "默认",
      title: "登录接口联调",
      preview: "等待确认权限",
      cwd: "/workspace/demo/demo-app",
      updatedAt: 150,
    },
    {
      id: "antigravity:cli:t-ctrl-1",
      provider: "antigravity",
      profileId: "cli",
      profileLabel: "CLI",
      title: "Agent Control <script>XSS</script>",
      preview: "语音模式改造",
      cwd: "/workspace/demo/agent-control",
      updatedAt: 250,
    },
  ];
  const pendingRequests = [{
    id: "claude:default:req-1",
    threadId: "claude:default:t-demo-2",
    title: "允许运行 npm test",
  }];
  const projectsMeta = {
    "/workspace/demo/demo-app": { pinned: true, alias: "示例小屋" },
  };

  const groups = buildProjectGroups(threads, { pendingRequests, projectsMeta });
  assert.equal(groups[0].cwd, "/workspace/demo/demo-app");
  assert.equal(groups[0].pinned, true);
  assert.equal(groups[0].name, "示例小屋");
  assert.equal(groups[0].threads[0].id, "antigravity:cli:t-demo-1"); // Strictly sorted by updatedAt (200 > 150), not pending status.
  assert.equal(groups[1].cwd, "/Users/demo"); // Unpinned groups strictly follow latestUpdatedAt (300 > 250).
  assert.equal(groups[2].cwd, "/workspace/demo/agent-control");
  assert.equal(suggestFocusProjects(groups).some((g) => g.isHomeDir), false);

  const boardHtml = renderProjectBoardHtml({ groups, allGroups: groups, pendingRequests });
  assert.match(boardHtml, /ac-icon-star-filled/);
  assert.match(boardHtml, /我关注的项目/);
  assert.match(boardHtml, /示例小屋/);
  assert.doesNotMatch(boardHtml, /<script>XSS<\/script>/);

  const stripHtml = renderProjectTaskStripHtml({
    projectGroup: groups[0],
    activeThreadId: "antigravity:cli:t-demo-1",
  });
  assert.match(stripHtml, /示例小屋/);
  assert.match(stripHtml, /家具透视修复/);
  assert.match(stripHtml, /登录接口联调/);
  assert.match(stripHtml, /strip-status-dot is-antigravity is-live/);
  assert.match(stripHtml, /strip-status-dot is-claude is-pending/);
  const idleStripHtml = renderProjectTaskStripHtml({
    projectGroup: groups.find((g) => g.cwd === "/workspace/demo/agent-control"),
    activeThreadId: "antigravity:cli:t-ctrl-1",
  });
  assert.match(idleStripHtml, /strip-status-dot is-antigravity is-done/);

  // Speech sanitization.
  assert.equal(
    stripMarkdownForSpeech("请查看 [server.mjs](file:///a/b/c) ```js\nconst x=1;\n``` <!-- GOAL_COMPLETE -->"),
    "请查看 server.mjs ，代码部分已省略，",
  );

  // PCM16 -> WAV encapsulation & VAD turn detection.
  const pcmSample = Buffer.from([0x00, 0x10, 0x00, 0x20, 0x00, 0x30, 0x00, 0x40]).toString("base64");
  const wav = pcm16Base64ToWavBytes(pcmSample, 24000);
  assert.equal(Buffer.from(wav.slice(0, 4)).toString("ascii"), "RIFF");
  assert.equal(Buffer.from(wav.slice(8, 12)).toString("ascii"), "WAVE");
  assert.equal(wav.length, 52);

  const downsampled = downsampleFloat32ToInt16(new Float32Array(960).fill(0.25), 48000, 16000);
  assert.equal(downsampled.length, 320);

  const vad = createVadTurnDetector({
    sampleRate: 16000,
    preRollMs: 120,
    silenceMs: 300,
    minSpeechMs: 150,
    rmsThreshold: 0.018,
  });
  // Silence pre-roll
  assert.equal(vad.pushSamples(new Int16Array(1600), 0.002).type, "listening");
  // Speech onset (two chunks >= 110ms)
  const loudChunk = new Int16Array(1600).fill(6000);
  assert.equal(vad.pushSamples(loudChunk, 0.08).type, "speech_start");
  assert.equal(vad.pushSamples(loudChunk, 0.08).type, "recording");
  // Trailing silence >= silenceMs triggers utterance
  assert.equal(vad.pushSamples(new Int16Array(1600), 0.001).type, "recording");
  assert.equal(vad.pushSamples(new Int16Array(1600), 0.001).type, "recording");
  const uttered = vad.pushSamples(new Int16Array(1600), 0.001);
  assert.equal(uttered.type, "utterance");
  const utteredWav = encodePcm16SamplesToWav(uttered.samples, 16000);
  assert.equal(Buffer.from(utteredWav.slice(0, 4)).toString("ascii"), "RIFF");
  assert.equal(Buffer.from(utteredWav.slice(8, 12)).toString("ascii"), "WAVE");
});

test("model fallback selector and turbo permission helpers never leave UI selectors empty or locked", () => {
  assert.ok(PERMISSION_MODES.includes("turbo"));
  assert.equal(isTurboPermissionMode("turbo"), true);
  assert.equal(isTurboPermissionMode("workspace"), false);
  assert.deepEqual(codexExecutionPolicy("turbo"), {
    approvalPolicy: "never",
    sandbox: "danger-full-access",
    sandboxPolicy: { type: "dangerFullAccess" },
  });
  assert.equal(claudePermissionMode("turbo"), "bypassPermissions");
  assert.equal(antigravityModeId("turbo"), "auto");

  assert.equal(UI_PERMISSION_MODES[0].value, "turbo");
  assert.equal(normalizeUiPermissionMode("", "turbo"), "turbo");
  assert.equal(normalizeUiPermissionMode("turbo"), "turbo");
  assert.match(permissionModeDisplayLabel("turbo"), /Turbo/);

  // Even when /api/models has not responded yet, resolveModelsForProvider supplies full Antigravity models with Carbon Orchestrator default.
  const agyFallback = resolveModelsForProvider({}, [], "antigravity");
  assert.ok(agyFallback.length >= 4);
  const def = pickDefaultModelForProvider(agyFallback, "antigravity");
  assert.equal(def?.id, "gemini-pro-orchestrator");
  assert.equal(def?.displayName, "Orchestrator (Carbon)");

  const claudeFallback = resolveModelsForProvider({}, [], "claude");
  assert.ok(claudeFallback.some((m) => m.id === "claude-sonnet-5-5" && m.isDefault));
  assert.ok(claudeFallback.some((m) => m.id === "claude-opus-5-5"));
  assert.ok(claudeFallback.some((m) => m.id === "claude-fable-5-2"));

  const preserved = ensurePreferredModelInList(claudeFallback, "claude", "claude-opus-5-6");
  assert.equal(preserved[0]?.id, "claude-opus-5-6");
  const rejectedCrossClaude = ensurePreferredModelInList(claudeFallback, "claude", "gpt-5.4");
  assert.equal(rejectedCrossClaude.some((m) => m.id === "gpt-5.4"), false);
  const codexFallback = resolveModelsForProvider({}, [], "codex");
  const rejectedCrossCodex = ensurePreferredModelInList(codexFallback, "codex", "claude-opus-5-5");
  assert.equal(rejectedCrossCodex.some((m) => m.id === "claude-opus-5-5"), false);
});

test("UI noise reduction collapses process items, filters legacy agy-gen echoes, and humanizes live activity", () => {
  assert.equal(isRawToolEchoItem({ type: "agentMessage", id: "agy-gen-12", text: "Showing lines 1-10", phase: "commentary" }), true);
  assert.equal(
    isRawToolEchoItem({
      type: "agentMessage",
      id: "other-1",
      phase: "commentary",
      text: "Created At: 2026-11-14T08:00:00+08:00\nShowing lines 1-50 of 100",
    }),
    true,
  );
  assert.equal(isRawToolEchoItem({ type: "mcpToolCall", tool: "exit_plan_mode" }), true);
  assert.equal(isRawToolEchoItem({ type: "agentMessage", id: "agy-msg-1", text: "正常回复", phase: "final_answer" }), false);

  assert.equal(
    unwrapToolText('"\\"File ../../workspace/demo/agent-control/src/server.mjs\\""'),
    "workspace/demo/agent-control/src/server.mjs",
  );
  assert.equal(
    formatCompactPath('"/workspace/demo/agent-control/src/server.mjs"'),
    "src/server.mjs",
  );

  const compactSummary = summarizeProcessItems([
    { type: "reasoning", content: ["internal thought"] },
    { type: "mcpToolCall", tool: "read_file", arguments: { Path: '"/repo/public/app.js"' } },
    { type: "mcpToolCall", tool: "edit_file", arguments: { Path: '"/repo/public/markdown.js"' } },
    { type: "commandExecution", command: '"npm test"' },
  ]);
  assert.equal(compactSummary, "已执行 · 改动 markdown.js · 命令 1 次");

  const repeatedItems = [
    { type: "userMessage", content: [{ type: "text", text: "帮我优化界面" }] },
    { type: "reasoning", content: ["English internal chain of thought"] },
    { type: "mcpToolCall", tool: "read_file", arguments: { Path: '"/workspace/demo/agent-control/public/app.js"' }, status: "completed" },
    { type: "mcpToolCall", tool: "read_file", arguments: { Path: '"/workspace/demo/agent-control/public/markdown.js"' }, status: "completed" },
    { type: "agentMessage", id: "agy-gen-3", phase: "commentary", text: "Created At: 2026-11-14\nShowing lines 1-200 of 500" },
    { type: "mcpToolCall", tool: "exit_plan_mode", arguments: { plan: "hidden" }, status: "completed" },
    { type: "agentMessage", id: "agy-msg-4", phase: "commentary", text: "先检查前端渲染模块，再合并展示。" },
  ];
  for (let n = 0; n < 4; n += 1) {
    repeatedItems.push({
      type: "fileChange",
      status: "completed",
      changes: [{ path: '"/workspace/demo/agent-control/public/app.js"', kind: "modify", diff: `"const hugeDiff${n} = ${"x".repeat(500)};"` }],
    });
    repeatedItems.push({
      type: "mcpToolCall",
      tool: "edit_file",
      status: "completed",
      arguments: { TargetFile: '"/workspace/demo/agent-control/src/server.mjs"' },
    });
  }
  repeatedItems.push(
    { type: "commandExecution", command: '"npm test"', status: "completed", aggregatedOutput: "19/19 passed" },
    { type: "agentMessage", id: "agy-msg-5", phase: "final_answer", text: "已完成精简，过程收起为单条摘要 <!-- GOAL_COMPLETE -->" },
  );

  const rendered = renderTurnHtml({
    id: "turn-compact",
    status: "completed",
    items: repeatedItems,
  }, { agentLabel: "Antigravity" });

  assert.doesNotMatch(rendered, /过程汇报/);
  assert.doesNotMatch(rendered, /Showing lines 1-200/);
  assert.doesNotMatch(rendered, /exit_plan_mode/);
  assert.doesNotMatch(rendered, /<details[^>]*\bopen\b/);
  assert.doesNotMatch(rendered, /\/workspace\//);
  assert.doesNotMatch(rendered, /const hugeDiff/);
  assert.equal((rendered.match(/class="process-summary-box"/g) || []).length, 1);
  assert.equal((rendered.match(/public\/app\.js/g) || []).length, 1);
  assert.equal((rendered.match(/src\/server\.mjs/g) || []).length, 1);
  assert.match(rendered, /已执行 · 改动 app\.js、server\.mjs · 命令 1 次/);
  assert.match(rendered, /4 处/);
  assert.match(rendered, /查阅<\/span>\s*<span class="process-note-text">app\.js、markdown\.js/);
  assert.match(rendered, /内部推理记录（共 1 段，按需展开）/);
  assert.match(rendered, /已完成精简，过程收起为单条摘要/);
  assert.match(rendered, /目标已达成/);

  assert.deepEqual(
    humanizeLiveActivity({ phase: "File ../../workspace/demo/agent-control/public/app.js", text: "completed" }),
    { phase: "正在处理 app.js…", detail: "" },
  );
  assert.deepEqual(
    humanizeLiveActivity({ phase: "read_file", text: "in_progress" }),
    { phase: "正在查阅文件…", detail: "" },
  );
  assert.deepEqual(
    humanizeLiveActivity({ phase: "Check git status", text: "completed" }),
    { phase: "正在检查代码…", detail: "" },
  );
  assert.deepEqual(
    humanizeLiveActivity({ phase: "准备工具 edit_file", text: "in_progress" }),
    { phase: "正在修改代码…", detail: "" },
  );
  assert.deepEqual(
    humanizeLiveActivity({ phase: "Codex 执行中", text: "处理中" }),
    { phase: "Codex 执行中", detail: "处理中" },
  );
  assert.deepEqual(
    humanizeLiveActivity({ phase: "read_file", text: "in_progress" }, { isStreamingText: true }),
    { phase: "正在生成回复…", detail: "" },
  );
  assert.deepEqual(
    summarizeToolUseActivity({ name: "Bash", input: { command: "npm test\necho done" } }),
    { phase: "正在执行命令…", text: "npm test" },
  );
  assert.deepEqual(
    summarizeToolUseActivity({ name: "Read", input: { file_path: "/tmp/demo/public/app.js" } }),
    { phase: "正在查阅 app.js…", text: "" },
  );
  assert.deepEqual(
    summarizeToolUseActivity({ name: "Edit", input: { file_path: "/tmp/demo/src/server.mjs" } }),
    { phase: "正在修改 server.mjs…", text: "" },
  );
  assert.deepEqual(
    summarizeToolUseActivity({ name: "Grep", input: { pattern: "tool_use" } }),
    { phase: "正在检索代码…", text: "tool_use" },
  );

  // Speech reply extraction skips legacy agy-gen-* raw tool output.
  const finalMsg = extractFinalAssistantMessageFromTurns([
    {
      items: [
        { type: "agentMessage", id: "agy-msg-ok", phase: "final_answer", text: "已收敛工具输出" },
        { type: "agentMessage", id: "agy-gen-99", phase: "commentary", text: "Created At: 2026-11-14 Showing lines 1-800" },
      ],
    },
  ]);
  assert.match(finalMsg.text, /已收敛工具输出/);
  assert.doesNotMatch(finalMsg.text, /Showing lines/);
});

test("formatTokensPerSec and renderAgentTelemetryBarHtml render 4-agent HUD, 5h/weekly windows, deduped accounts, and drawer jump pills", () => {
  assert.equal(formatTokensPerSec(0), "0");
  assert.equal(formatTokensPerSec(12.34), "12.3");
  assert.equal(formatTokensPerSec(128.6), "129");

  const nowSec = 1_794_680_000;
  const profiles = [
    {
      key: "antigravity:desktop",
      provider: "antigravity",
      id: "desktop",
      label: "Antigravity 桌面",
      installed: true,
      account: { email: "bob.w@gmail.com" },
      quota: {
        status: "ok",
        accountLabel: "bob.w@gmail.com",
        windows: {
          fiveHour: { id: "gemini-5h", windowKind: "five_hour", label: "Gemini 5h", remainingPercent: 100 },
          weekly: { id: "gemini-weekly", windowKind: "weekly", label: "Gemini 周", remainingPercent: 100 },
          thirdPartyFiveHour: { id: "3p-5h", windowKind: "third_party_5h", label: "3P 5h", remainingPercent: 95 },
        },
        buckets: [],
      },
    },
    {
      key: "antigravity:cli",
      provider: "antigravity",
      id: "cli",
      label: "Antigravity CLI",
      installed: true,
      account: { email: "bob.w@gmail.com" },
      quota: {
        status: "ok",
        accountLabel: "bob.w@gmail.com",
        windows: {
          fiveHour: { id: "gemini-5h", windowKind: "five_hour", label: "Gemini 5h", remainingPercent: 100 },
          weekly: { id: "gemini-weekly", windowKind: "weekly", label: "Gemini 周", remainingPercent: 100 },
        },
        buckets: [],
      },
    },
    {
      key: "codex:default",
      provider: "codex",
      id: "default",
      label: "Codex Pro",
      installed: true,
      account: { email: "pro@example.com" },
      quota: {
        status: "warn",
        windows: {
          fiveHour: { id: "5h", windowKind: "five_hour", label: "5h 窗口", remainingPercent: 84 },
          weekly: { id: "weekly", windowKind: "weekly", label: "周限额", remainingPercent: 67, resetsAt: nowSec + 7200 },
        },
        buckets: [
          { id: "credits", windowKind: "credits", label: "积分", remainingPercent: null, detail: "积分 38591" },
        ],
      },
    },
    {
      key: "claude:default",
      provider: "claude",
      id: "default",
      label: "Claude Code",
      installed: true,
      quota: {
        status: "exhausted",
        windows: {
          fiveHour: { id: "claude-5h", windowKind: "five_hour", label: "5h 窗口", remainingPercent: 0, resetsAt: nowSec + 3600 },
          weekly: { id: "claude-7d", windowKind: "weekly", label: "周限额", remainingPercent: 72 },
        },
        buckets: [],
      },
    },
    {
      key: "grok:cockpit-1",
      provider: "grok",
      id: "cockpit-1",
      label: "SuperGrok",
      installed: true,
      quota: {
        status: "ok",
        buckets: [
          { id: "billing", windowKind: "subscription", label: "订阅额度", remainingPercent: 84 },
          { id: "build", windowKind: "other", label: "Grok Build", remainingPercent: 87 },
        ],
      },
    },
    {
      key: "grok:default",
      provider: "grok",
      id: "default",
      label: "Grok 默认",
      installed: true,
      quota: { status: "unavailable", headline: "仅有本地历史" },
    },
  ];

  const telemetry = {
    updatedAt: nowSec,
    totals: { runningCount: 3, queuedCount: 1, tokensPerSec: 42.5 },
    byProvider: {
      codex: {
        provider: "codex",
        runningCount: 2,
        queuedCount: 0,
        tokensPerSec: 30.2,
        activeThreads: [{ id: "codex:default:t-1", title: "重构调度器" }],
      },
      claude: { provider: "claude", runningCount: 0, queuedCount: 1, tokensPerSec: 0, activeThreads: [] },
      antigravity: {
        provider: "antigravity",
        runningCount: 1,
        queuedCount: 0,
        tokensPerSec: 12.3,
        activeThreads: [{ id: "antigravity:desktop:c-1", title: "生成看板" }],
      },
      grok: { provider: "grok", runningCount: 0, queuedCount: 0, tokensPerSec: 0, activeThreads: [] },
    },
  };

  const compactHtml = renderAgentTelemetryBarHtml(profiles, telemetry, { expanded: false, nowSec });
  assert.match(compactHtml, /2 运行/);
  assert.match(compactHtml, /30\.2 tok\/s/);
  assert.match(compactHtml, /12\.3 tok\/s/);
  assert.match(compactHtml, /1 排队/);
  assert.match(compactHtml, /5h/);
  assert.match(compactHtml, /周/);
  assert.match(compactHtml, /telemetry-weekly-fill" style="width:67%"/);
  assert.doesNotMatch(compactHtml, /5h 84%/);
  assert.doesNotMatch(compactHtml, /积分|38591/);
  assert.doesNotMatch(compactHtml, /仅有本地历史/);
  assert.doesNotMatch(compactHtml, /data-telemetry-jump-thread/);

  const expandedHtml = renderAgentTelemetryBarHtml(profiles, telemetry, {
    expanded: true,
    providerFilter: "codex",
    nowSec,
  });
  assert.match(expandedHtml, /data-telemetry-jump-thread="codex:default:t-1"/);
  assert.match(expandedHtml, /重构调度器/);
  assert.match(expandedHtml, /data-telemetry-jump-thread="antigravity:desktop:c-1"/);
  assert.match(expandedHtml, /data-telemetry-filter-provider="codex"/);
  assert.match(expandedHtml, /取消筛选/);
});

test("dual Claude instances, selectable telemetry picker, identity hints, and mobile topbar summary work cleanly", () => {
  const nowSec = 1_794_680_000;
  assert.equal(formatProfileIdentityHint({ account: { email: "alice@example.com" } }), "alic...com");
  assert.equal(formatProfileIdentityHint({ account: { email: "bob@example.com" } }), "bob...com");
  assert.equal(formatProfileIdentityHint({ account: { email: "carol1990@gmail.com" } }), "caro...com");

  const profiles = [
    {
      key: "antigravity:desktop",
      provider: "antigravity",
      id: "desktop",
      label: "Antigravity 桌面",
      installed: true,
      account: { email: "agy@example.com" },
      quota: { status: "ok", accountLabel: "agy@example.com", windows: { fiveHour: { remainingPercent: 100 } }, buckets: [] },
    },
    {
      key: "antigravity:cli",
      provider: "antigravity",
      id: "cli",
      label: "Antigravity CLI",
      installed: true,
      account: { email: "agy@example.com" },
      quota: { status: "ok", accountLabel: "agy@example.com", windows: { fiveHour: { remainingPercent: 100 } }, buckets: [] },
    },
    {
      key: "codex:default",
      provider: "codex",
      id: "default",
      label: "Codex 默认",
      installed: true,
      account: { email: "codex-a@example.com" },
      quota: { status: "ok", windows: { fiveHour: { remainingPercent: 88 }, weekly: { remainingPercent: 60 } }, buckets: [] },
    },
    {
      key: "codex:codex",
      provider: "codex",
      id: "codex",
      label: "Codex · personal",
      installed: true,
      account: { email: "codex-b@example.com" },
      quota: { status: "ok", windows: { fiveHour: { remainingPercent: 95 }, weekly: { remainingPercent: 70 } }, buckets: [] },
    },
    {
      key: "claude:default",
      provider: "claude",
      id: "default",
      label: "Claude 默认",
      installed: true,
      account: { email: "alice@example.com" },
      quota: { status: "ok", planLabel: "Max", windows: { fiveHour: { remainingPercent: 92 }, weekly: { remainingPercent: 21 } }, buckets: [] },
    },
    {
      key: "claude:claude-hotmail",
      provider: "claude",
      id: "claude-hotmail",
      label: "claude hotmail",
      installed: true,
      account: { email: "bob@example.com" },
      quota: {
        statusTone: "exhausted",
        planLabel: "Pro",
        windows: {
          fiveHour: { remainingPercent: 0, resetsAt: nowSec + 3600 },
          weekly: { remainingPercent: 28 },
        },
        buckets: [],
      },
    },
    {
      key: "grok:work",
      provider: "grok",
      id: "work",
      label: "Grok · work",
      installed: true,
      authenticated: true,
      quota: { status: "ok", buckets: [{ id: "billing", windowKind: "subscription", label: "订阅额度", remainingPercent: 80 }] },
    },
    {
      key: "grok:default",
      provider: "grok",
      id: "default",
      label: "Grok 默认",
      installed: true,
      authenticated: false,
      quota: { status: "unavailable", headline: "仅有本地历史" },
    },
  ];

  const items = buildSelectableTelemetryItems(profiles);
  // Antigravity desktop+cli share account -> deduplicated; both Codex & both Claude instances stay distinct.
  assert.deepEqual(
    items.map((i) => ({ key: i.key, defaultVisible: i.defaultVisible })),
    [
      { key: "codex:default", defaultVisible: true },
      { key: "codex:codex", defaultVisible: true },
      { key: "claude:default", defaultVisible: true },
      { key: "claude:claude-hotmail", defaultVisible: true },
      { key: "antigravity:desktop", defaultVisible: true },
      { key: "grok:work", defaultVisible: true },
      { key: "grok:default", defaultVisible: false },
    ],
  );

  // Newly added defaultVisible instances appear automatically even with persisted prefs.
  const upgradedVisible = resolveVisibleTelemetryKeys(items, {
    selectedKeys: ["codex:default", "claude:default"],
    knownKeys: ["codex:default", "claude:default", "antigravity:desktop", "grok:work", "grok:default"],
  });
  assert.deepEqual(upgradedVisible, ["codex:default", "codex:codex", "claude:default", "claude:claude-hotmail"]);

  const telemetry = {
    updatedAt: nowSec,
    byProvider: {
      codex: { provider: "codex", runningCount: 1, queuedCount: 0, tokensPerSec: 18.2, activeThreads: [] },
      claude: { provider: "claude", runningCount: 1, queuedCount: 1, tokensPerSec: 22.4, activeThreads: [] },
      antigravity: { provider: "antigravity", runningCount: 0, queuedCount: 0, tokensPerSec: 0, activeThreads: [] },
      grok: { provider: "grok", runningCount: 0, queuedCount: 0, tokensPerSec: 0, activeThreads: [] },
    },
    byProfile: {
      "codex:default": { key: "codex:default", runningCount: 0, queuedCount: 0, tokensPerSec: 0, activeThreads: [] },
      "codex:codex": { key: "codex:codex", runningCount: 1, queuedCount: 0, tokensPerSec: 18.2, activeThreads: [] },
      "claude:default": { key: "claude:default", runningCount: 0, queuedCount: 0, tokensPerSec: 0, activeThreads: [] },
      "claude:claude-hotmail": { key: "claude:claude-hotmail", runningCount: 1, queuedCount: 1, tokensPerSec: 22.4, activeThreads: [] },
      "antigravity:desktop": { key: "antigravity:desktop", runningCount: 0, queuedCount: 0, tokensPerSec: 0, activeThreads: [] },
      "grok:work": { key: "grok:work", runningCount: 0, queuedCount: 0, tokensPerSec: 0, activeThreads: [] },
    },
  };

  const fullBar = renderAgentTelemetryBarHtml(profiles, telemetry, { pickerOpen: true, nowSec });
  assert.match(fullBar, /Codex · personal/);
  assert.match(fullBar, /Claude · example/);
  assert.match(fullBar, /claude hotmail \(bob\.\.\.com\)/);
  assert.match(fullBar, /class="telemetry-provider-glyph is-claude is-running"/);
  assert.doesNotMatch(fullBar, /class="telemetry-card-id">\s*<span class="telemetry-live-dot/);
  assert.match(fullBar, /92%/);
  assert.match(fullBar, /21%/);
  assert.match(fullBar, /28%/);
  assert.match(fullBar, /22\.4 tok\/s/);
  assert.match(fullBar, /data-telemetry-pick-key="claude:claude-hotmail"/);
  assert.match(fullBar, /data-telemetry-mobile-close/);

  // Compact mode by default only renders active/in-use items; expanded mode shows full subset grid & picker count.
  const subsetCompactBar = renderAgentTelemetryBarHtml(profiles, telemetry, {
    visibleKeys: ["claude:default", "claude:claude-hotmail"],
    activeProvider: "claude",
    activeProfileId: "claude-hotmail",
    nowSec,
  });
  assert.match(subsetCompactBar, /is-compact/);
  assert.match(subsetCompactBar, /data-telemetry-item-key="claude:claude-hotmail"/);
  assert.match(subsetCompactBar, /telemetry-overflow-pill[\s\S]*?\+1 运行</);
  assert.doesNotMatch(subsetCompactBar, /data-telemetry-item-key="claude:default"/);
  assert.doesNotMatch(subsetCompactBar, /data-telemetry-item-key="codex:default"/);
  assert.doesNotMatch(subsetCompactBar, /data-telemetry-item-key="grok:work"/);

  const subsetBar = renderAgentTelemetryBarHtml(profiles, telemetry, {
    visibleKeys: ["claude:default", "claude:claude-hotmail"],
    expanded: true,
    nowSec,
  });
  assert.match(subsetBar, /data-telemetry-item-key="claude:default"/);
  assert.match(subsetBar, /data-telemetry-item-key="claude:claude-hotmail"/);
  assert.doesNotMatch(subsetBar, /data-telemetry-item-key="codex:default"/);
  assert.doesNotMatch(subsetBar, /data-telemetry-item-key="grok:work"/);
  assert.match(subsetBar, /ac-icon-settings/);
  assert.match(subsetBar, /显示 \(2\/7\)/);

  const badge = summarizeTelemetryMobileBadge(profiles, telemetry, null, { nowSec });
  assert.equal(badge.text, "2运行");
  assert.equal(badge.dotClass, "is-running");

  const idleExhaustedBadge = summarizeTelemetryMobileBadge(
    profiles,
    {
      ...telemetry,
      byProvider: {
        codex: { runningCount: 0, queuedCount: 0, tokensPerSec: 0 },
        claude: { runningCount: 0, queuedCount: 0, tokensPerSec: 0 },
        antigravity: { runningCount: 0, queuedCount: 0, tokensPerSec: 0 },
        grok: { runningCount: 0, queuedCount: 0, tokensPerSec: 0 },
      },
    },
    null,
    { nowSec },
  );
  assert.equal(idleExhaustedBadge.text, "额度");
  assert.equal(idleExhaustedBadge.dotClass, "is-danger");
});

test("telemetry bar deduplicates cloned quota buckets and keeps default view ultra-compact for active agents", () => {
  const nowSec = 1_794_710_000;
  // Simulate HTTP JSON serialization where quota.windows.* and quota.buckets[*] are distinct object instances.
  const clonedProfiles = [
    {
      key: "codex:default",
      provider: "codex",
      id: "default",
      label: "Codex · 163",
      installed: true,
      account: { email: "user@163.com" },
      quota: {
        status: "ok",
        windows: {
          weekly: { id: "primary", windowKind: "weekly", label: "周限额", remainingPercent: 67 },
        },
        buckets: [
          { id: "primary", windowKind: "weekly", label: "周限额", remainingPercent: 67 },
          { id: "credits", windowKind: "credits", label: "积分", remainingPercent: null, detail: "38900" },
        ],
      },
    },
    {
      key: "claude:default",
      provider: "claude",
      id: "default",
      label: "Claude · icloud",
      installed: true,
      account: { email: "user@icloud.com" },
      quota: {
        statusTone: "exhausted",
        windows: {
          fiveHour: { id: "five_hour", windowKind: "five_hour", label: "5h 窗口", remainingPercent: null, detail: "充足" },
          weekly: { id: "seven_day", windowKind: "weekly", label: "周限额", remainingPercent: 0 },
        },
        buckets: [
          { id: "five_hour", windowKind: "five_hour", label: "5h 窗口", remainingPercent: null, detail: "充足" },
          { id: "seven_day", windowKind: "weekly", label: "周限额", remainingPercent: 0 },
        ],
      },
    },
    {
      key: "antigravity:desktop",
      provider: "antigravity",
      id: "desktop",
      label: "Antigravity 桌面",
      installed: true,
      quota: {
        status: "ok",
        windows: {
          fiveHour: { id: "agy-5h", windowKind: "five_hour", label: "Gemini 5h", remainingPercent: 98 },
          weekly: { id: "agy-w", windowKind: "weekly", label: "Gemini 周", remainingPercent: 78 },
        },
        buckets: [
          { id: "agy-5h", windowKind: "five_hour", label: "Gemini 5h", remainingPercent: 98 },
          { id: "agy-w", windowKind: "weekly", label: "Gemini 周", remainingPercent: 78 },
        ],
      },
    },
    {
      key: "grok:work",
      provider: "grok",
      id: "work",
      label: "Grok · work",
      installed: true,
      authenticated: true,
      quota: {
        status: "ok",
        buckets: [
          { id: "billing", windowKind: "billing", label: "订阅额度", remainingPercent: 84 },
          { id: "build", windowKind: "build", label: "Grok Build", remainingPercent: 87 },
          { id: "product", windowKind: "product", label: "Grok Product 8", remainingPercent: 97 },
        ],
      },
    },
  ];

  const telemetry = {
    updatedAt: nowSec,
    byProvider: {
      codex: { runningCount: 0, queuedCount: 0, tokensPerSec: 0, activeThreads: [] },
      claude: { runningCount: 0, queuedCount: 0, tokensPerSec: 0, activeThreads: [] },
      antigravity: {
        runningCount: 3,
        queuedCount: 1,
        tokensPerSec: 54.1,
        activeThreads: [{ id: "antigravity:desktop:9e1678cb", title: "Remote Control" }],
      },
      grok: { runningCount: 0, queuedCount: 0, tokensPerSec: 0, activeThreads: [] },
    },
  };

  // Default collapsed bar shows only running/current active items cleanly on one strip.
  const compactBar = renderAgentTelemetryBarHtml(clonedProfiles, telemetry, {
    expanded: false,
    activeProvider: "codex",
    activeProfileId: "default",
    nowSec,
  });
  assert.match(compactBar, /is-compact/);
  assert.match(compactBar, /data-telemetry-item-key="antigravity:desktop"/);
  assert.match(compactBar, /data-telemetry-item-key="codex:default"/);
  assert.doesNotMatch(compactBar, /data-telemetry-item-key="claude:default"/);
  assert.doesNotMatch(compactBar, /data-telemetry-item-key="grok:work"/);
  assert.doesNotMatch(compactBar, /5h 98%/);
  assert.match(compactBar, /telemetry-weekly-fill" style="width:78%"/);
  assert.match(compactBar, /telemetry-weekly-fill" style="width:67%"/);

  // Expanded bar renders full grid and drawer with ZERO duplicate 周限额 / 5h 窗口 chips.
  const expandedBar = renderAgentTelemetryBarHtml(clonedProfiles, telemetry, {
    expanded: true,
    nowSec,
  });
  assert.match(expandedBar, /is-expanded/);
  assert.match(expandedBar, /Product 8/);
  assert.doesNotMatch(expandedBar, /Produc<\/span>/);
  assert.doesNotMatch(expandedBar, /telemetry-chip-k">周限额<\/span>/);
  assert.doesNotMatch(expandedBar, /telemetry-chip-k">5h 窗口<\/span>/);
  assert.match(expandedBar, /充足/);
  assert.doesNotMatch(expandedBar, />5h<\/span><span class="telemetry-chip-v">0%/);
  assert.doesNotMatch(expandedBar, /telemetry-drawer-grid|telemetry-drawer-card/);
  assert.match(expandedBar, /telemetry-card-filter/);
});

test("compact mobile visual helpers and index.html preserve all existing IDs and asset version alignment", async () => {
  assert.equal(compactModelBadgeLabel("Orchestrator (Carbon)"), "Carbon");
  assert.equal(compactModelBadgeLabel("gemini-pro-orchestrator"), "Carbon");
  assert.equal(compactModelBadgeLabel("Gemini 4 Carbon (High)"), "Carbon H");
  assert.equal(compactModelBadgeLabel("Gemini 4 Carbon (Medium)"), "Carbon M");
  assert.equal(compactModelBadgeLabel("Claude Opus 5.5 (Medium)"), "Opus 5.5");
  assert.equal(compactModelBadgeLabel("Claude Sonnet 4.6"), "Sonnet 4.6");
  assert.equal(compactModelBadgeLabel("Claude Fable 5.2"), "Fable 5.2");
  assert.equal(compactModelBadgeLabel("claude-haiku-4-5-20251001"), "Haiku 4.5");
  assert.equal(compactModelBadgeLabel("gpt-5.4"), "GPT-5.4");
  assert.equal(compactModelBadgeLabel("gpt-5.3-codex"), "5.3 Codex");

  assert.equal(compactEffortBadgeLabel("high"), "H");
  assert.equal(compactEffortBadgeLabel("xhigh"), "XH");
  assert.equal(compactEffortBadgeLabel(""), "");

  const turboMeta = permissionVisualMeta("turbo");
  assert.equal(turboMeta.value, "turbo");
  assert.equal(turboMeta.iconName, "bolt");
  assert.match(turboMeta.icon, /<svg[^>]*ac-icon-bolt/);
  assert.equal(turboMeta.shortLabel, "Turbo");
  assert.equal(turboMeta.tone, "turbo");
  assert.equal(turboMeta.label, "Turbo（自动批准）");

  assert.equal(permissionVisualMeta("plan").tone, "plan");
  assert.equal(providerVisualMeta("antigravity").glyph, "");
  assert.match(providerVisualMeta("antigravity").iconSvg, /<svg[^>]*is-antigravity/);
  assert.equal(providerVisualMeta("codex").glyph, "");
  assert.match(providerVisualMeta("codex").iconSvg, /<svg[^>]*is-codex/);
  assert.equal(providerVisualMeta("claude").glyph, "");
  assert.match(providerVisualMeta("claude").iconSvg, /<svg[^>]*is-claude/);

  const indexPath = fileURLToPath(new URL("../public/index.html", import.meta.url));
  const html = await readFile(indexPath, "utf8");
  const versionMatch = html.match(/name="ac-ui-version" content="([^"]+)"/);
  assert.ok(versionMatch?.[1], "index.html should declare ac-ui-version");
  const uiVersion = versionMatch[1];
  assert.ok(html.includes(`href="./app.css?v=${uiVersion}"`));
  assert.ok(html.includes(`href="./project-workspace.css?v=${uiVersion}"`));
  assert.ok(html.includes(`src="./app.js?v=${uiVersion}"`));
  const workspaceCss = await readFile(fileURLToPath(new URL("../public/project-workspace.css", import.meta.url)), "utf8");
  assert.match(workspaceCss, /\.thread-status-dot\.is-agent-marker\.is-done\s*\{[^}]*border:\s*0;/);
  assert.match(workspaceCss, /\.thread-status-dot\.is-agent-marker\.is-done\.is-recent\s*\{[^}]*border:\s*1\.5px solid #4c8dff;/);
  assert.doesNotMatch(html, /id="composerProbeProfilesBtn"/);
  assert.match(html, /id="telemetryTopbarBtn"[^>]*hidden/);
  assert.match(html, /id="activeProjectCrumb"[^>]*hidden/);
  assert.match(html, /id="agentQuotaStrip"[^>]*hidden/);
  assert.match(html, /id="projectTaskStrip"[^>]*hidden/);
  assert.match(html, /<footer id="composerArea" class="composer-area" hidden>/);

  for (const requiredId of [
    "menuBtn",
    "topbarTelemetrySlot",
    "telemetryTopbarBtn",
    "telemetryTopbarDot",
    "telemetryTopbarText",
    "providerTabs",
    "agentQuotaStrip",
    "agentTelemetryBar",
    "topbarConnDot",
    "activeProviderBadge",
    "activeProfileBadge",
    "activeProjectCrumb",
    "activeTitle",
    "activeCwd",
    "activeGoalBadge",
    "boardToggleBtn",
    "boardAttentionDot",
    "voiceModeBtn",
    "interruptBtn",
    "topbarMoreBtn",
    "topbarMoreMenu",
    "goalToggleBtn",
    "renameThreadBtn",
    "toggleThreadImagesBtn",
    "archiveThreadBtn",
    "refreshThreadBtn",
    "liveBanner",
    "livePhaseText",
    "liveDetailText",
    "composerProviderSelect",
    "composerProfileSelect",
    "composerProfilePills",
    "cfgChipProfileText",
    "newModalTitle",
    "newProviderPills",
    "newProviderSelect",
    "newModalProbeProfilesBtn",
    "newProfilePills",
    "modelSelect",
    "effortSelect",
    "permissionSelect",
    "imageUploadBtn",
    "composerVoiceBtn",
    "composerGoalBtn",
    "composerConfigBtn",
    "composerConfigPopover",
    "composerArchivedBanner",
    "runningSubmitMode",
    "sendBtn",
    "remoteActiveDot",
    "tunnelStateText",
    "startTunnelBtn",
    "rotateTunnelBtn",
    "stopTunnelBtn",
    "tunnelQrWrap",
    "tunnelQrImg",
    "tunnelPairUrlInput",
    "copyTunnelUrlBtn",
    "tunnelMissingBox",
    "tunnelInstallCmdCode",
    "relayAdvancedSection",
    "sidebarFooterBar",
    "sidebarUpdateBtn",
    "openUpdateModalBtn",
    "updateModal",
    "updateStatePill",
    "updateTabNotesBadge",
    "updateTabSettingsBadge",
    "updateTabCliBadge",
    "updateReleaseNotesSection",
    "updateReleaseNotesBody",
    "updateDesktopInfo",
    "autoCheckUpdateToggle",
    "autoUpdateToggle",
    "autoUpdateDesktopToggle",
    "agentAutoTitleToggle",
    "autoUpdateCliToggle",
    "agyAutoCompactToggle",
    "agyAutoCompactTokensSelect",
    "agyAutoRetryAuth401Toggle",
    "cliUpdateCard",
    "checkCliUpdatesBtn",
    "cliVersionsList",
    "updatePendingSection",
    "updatePendingDetails",
    "restartServiceBtn",
    "applyDesktopUpdateBtn",
    "checkUpdateBtn",
    "applyUpdateBtn",
  ]) {
    assert.match(html, new RegExp(`id="${requiredId}"`), `missing required DOM id: ${requiredId}`);
  }
  assert.doesNotMatch(
    html,
    /<label\b[^>]*>(?:(?!<\/label>)[\s\S])*?<select\s+id="agyAutoCompactTokensSelect"/,
    "agyAutoCompactTokensSelect must not be nested inside a checkbox <label>",
  );

  assert.equal(normalizeProjectCwd("C:\\dev\\agent-control\\"), "C:\\dev\\agent-control");
  assert.equal(normalizeProjectCwd("C:/"), "C:\\");
  assert.equal(normalizeProjectCwd("\\\\nas\\share\\repo\\"), "\\\\nas\\share\\repo");
  assert.equal(isUserHomeCwd("C:\\Users\\Alice"), true);
  assert.equal(isUserHomeCwd("/Users/alice"), true);
  assert.equal(isUserHomeCwd("/home/alice"), true);
  assert.equal(projectBaseName("C:\\Users\\Alice"), "个人主目录 (~)");
  assert.equal(projectBaseName("C:\\dev\\agent-control\\"), "agent-control");
  assert.equal(projectBaseName("C:\\"), "C:\\");
  assert.equal(projectBaseName("\\\\nas\\share\\repo\\"), "repo");

  const providerPillsHtml = renderProviderPillsHtml({
    selectedProvider: "codex",
    profiles: [
      { id: "desktop", provider: "antigravity", health: { status: "healthy" } },
      { id: "default", provider: "codex", health: { status: "healthy" } },
      { id: "default", provider: "claude", health: { status: "cooldown" } },
    ],
  });
  assert.match(providerPillsHtml, /data-select-provider="antigravity"[^>]*aria-checked="false"/);
  assert.match(providerPillsHtml, /class="provider-pill-btn is-selected"[^>]*data-select-provider="codex"[^>]*aria-checked="true"/);
  assert.match(providerPillsHtml, /data-select-provider="claude"[^>]*aria-checked="false"/);
  assert.match(providerPillsHtml, /data-select-provider="grok"[^>]*aria-checked="false"/);
  assert.match(providerPillsHtml, /profile-status-dot is-healthy/);
  assert.match(providerPillsHtml, /profile-status-dot is-cooldown/);
});

test("mergeActiveTurnIntoHistory and dedupeAdjacentTurns avoid duplicate live user bubbles without merging distinct repeated turns", () => {
  const inProgressSamePrompt = mergeActiveTurnIntoHistory(
    [{
      id: "agy-step-10",
      status: "completed",
      items: [
        { type: "userMessage", id: "u-10", content: [{ type: "text", text: "<USER_REQUEST>\n实现测通功能\n</USER_REQUEST>" }] },
      ],
    }],
    {
      turnId: "agy-turn-live-1",
      userText: "实现测通功能",
      lastText: "正在分析",
      startedAt: 1000,
    },
  );
  assert.equal(inProgressSamePrompt.length, 1);
  assert.equal(inProgressSamePrompt[0].status, "inProgress");
  assert.equal(inProgressSamePrompt[0].items.filter((it) => it.type === "userMessage").length, 1);
  assert.equal(inProgressSamePrompt[0].items.some((it) => it.type === "agentMessage" && it.text === "正在分析"), true);

  // Sending the same short word ("继续") after a completed turn must keep 2 separate turns.
  const distinctRepeat = mergeActiveTurnIntoHistory(
    [{
      id: "agy-step-11",
      status: "completed",
      items: [
        { type: "userMessage", id: "u-11", content: [{ type: "text", text: "继续" }] },
        { type: "agentMessage", id: "a-11", text: "上一轮已完成答复", phase: "final_answer" },
      ],
    }],
    {
      turnId: "agy-turn-live-2",
      userText: "继续",
      lastText: "",
      startedAt: 2000,
    },
  );
  assert.equal(distinctRepeat.length, 2);

  // Frontend fallback dedupeAdjacentTurns mirrors the same guarantee for running duplicate tails.
  const frontMerged = dedupeAdjacentTurns([
    {
      id: "agy-step-20",
      status: "completed",
      items: [{ type: "userMessage", content: [{ type: "text", text: "手机端测试输入" }] }],
    },
    {
      id: "agy-turn-uuid",
      status: "inProgress",
      items: [
        { type: "userMessage", content: [{ type: "text", text: "手机端测试输入" }] },
        { type: "agentMessage", text: "好的，收到", phase: "final_answer" },
      ],
    },
  ]);
  assert.equal(frontMerged.length, 1);
  assert.equal(frontMerged[0].items.filter((it) => it.type === "userMessage").length, 1);
  assert.equal(frontMerged[0].items.some((it) => it.text === "好的，收到"), true);

  const frontDistinct = dedupeAdjacentTurns([
    {
      id: "agy-step-21",
      status: "completed",
      items: [
        { type: "userMessage", content: [{ type: "text", text: "继续" }] },
        { type: "agentMessage", text: "上一轮回答", phase: "final_answer" },
      ],
    },
    {
      id: "agy-turn-uuid-2",
      status: "inProgress",
      items: [{ type: "userMessage", content: [{ type: "text", text: "继续" }] }],
    },
  ]);
  assert.equal(frontDistinct.length, 2);
});

test("running turns never duplicate previous turn summary at bottom across streaming reconciliation, hot-extension, or turn merging", () => {
  const prevSummary = "第一轮任务已经全部排查完毕，修改了 server.mjs 并验证测试全部通过。";
  const turnsWithRunningTail = [
    {
      id: "agy-step-10",
      status: "completed",
      startedAt: 1000,
      items: [
        { type: "userMessage", id: "u-10", content: [{ type: "text", text: "排查登录超时的原因" }] },
        { type: "agentMessage", id: "agy-msg-10", text: prevSummary, phase: "final_answer" },
      ],
    },
    {
      id: "agy-step-20",
      status: "inProgress",
      startedAt: 2000,
      items: [
        { type: "userMessage", id: "u-20", content: [{ type: "text", text: "继续修复手机端列表样式" }] },
        { type: "mcpToolCall", id: "tool-20", tool: "read_file", arguments: { path: "public/app.css" }, status: "completed" },
      ],
    },
  ];

  // 1. Stale streamingText matching an earlier completed turn (exact or >=24-char slice) is detected as persisted,
  // while synthetic live reply items (:agent / :live) and genuine new streaming text are NOT suppressed.
  assert.equal(isStreamingTextAlreadyPersisted(turnsWithRunningTail, prevSummary), true);
  assert.equal(isStreamingTextAlreadyPersisted(turnsWithRunningTail, "修改了 server.mjs 并验证测试全部通过。"), true);
  assert.equal(isStreamingTextAlreadyPersisted([
    ...turnsWithRunningTail.slice(0, 1),
    {
      ...turnsWithRunningTail[1],
      items: [
        ...turnsWithRunningTail[1].items,
        { type: "agentMessage", id: "agy-turn-20:agent", text: "正在生成新回复", phase: "final_answer" },
      ],
    },
  ], "正在生成新回复"), false);

  // 2. renderTurnHtml with hideSyntheticLiveReply suppresses synthetic :agent / :live bubble while #streamingTurn streams.
  const hiddenLiveHtml = renderTurnHtml(
    {
      id: "agy-step-20",
      status: "inProgress",
      items: [
        { type: "userMessage", id: "u-20", content: [{ type: "text", text: "继续" }] },
        { type: "agentMessage", id: "agy-turn-20:agent", text: "重复的流式回复", phase: "final_answer" },
      ],
    },
    { hideSyntheticLiveReply: true },
  );
  assert.doesNotMatch(hiddenLiveHtml, /重复的流式回复/);

  // 3. mergeActiveTurnIntoHistory refuses to append a stale active turn below a newer turn.
  const mergedWithoutStaleActive = mergeActiveTurnIntoHistory(turnsWithRunningTail, {
    turnId: "agy-turn-old-10",
    userText: "排查登录超时的原因",
    lastText: prevSummary,
    startedAt: 1000,
  });
  assert.equal(mergedWithoutStaleActive.length, 2);
  assert.equal(mergedWithoutStaleActive[1].id, "agy-step-20");

  // 3b. New live turn before execution starts must not echo the previous completed turn's reply.
  const newTurnWithStaleEcho = mergeActiveTurnIntoHistory(
    [turnsWithRunningTail[0]],
    {
      turnId: "agy-turn-new-21",
      userText: "继续优化自动命名规则",
      lastText: prevSummary,
      startedAt: 1200,
    },
  );
  assert.equal(newTurnWithStaleEcho.length, 2);
  assert.equal(newTurnWithStaleEcho[1].items.some((it) => it.type === "agentMessage"), false);

  const dedupedEchoLiveTurn = dedupeAdjacentTurns([
    turnsWithRunningTail[0],
    {
      id: "agy-turn-new-21",
      status: "inProgress",
      items: [
        { type: "userMessage", content: [{ type: "text", text: "继续优化自动命名规则" }] },
        { type: "agentMessage", text: prevSummary, phase: "final_answer" },
      ],
    },
  ]);
  assert.equal(dedupedEchoLiveTurn.length, 2);
  assert.equal(dedupedEchoLiveTurn[1].items.some((it) => it.type === "agentMessage"), false);

  // 4. mergeUpstreamLiveThreadState refuses to append stale lastUpstream turn below [Turn N, Turn N+1].
  const upstreamMerged = mergeUpstreamLiveThreadState(
    {
      thread: {
        id: "antigravity:desktop:abc",
        live: true,
        turns: turnsWithRunningTail,
      },
    },
    {
      thread: {
        id: "antigravity:desktop:abc",
        live: true,
        turns: [
          {
            id: "agy-turn-stale-10",
            status: "inProgress",
            startedAt: 1000,
            items: [
              { type: "userMessage", content: [{ type: "text", text: "排查登录超时的原因" }] },
              { type: "agentMessage", text: prevSummary, phase: "final_answer" },
            ],
          },
        ],
      },
      activity: { status: "running" },
    },
  );
  assert.equal(upstreamMerged.thread.turns.length, 2);
  assert.equal(upstreamMerged.thread.turns[1].id, "agy-step-20");

  // 5. dedupeAdjacentTurns removes trailing duplicate turn already completed earlier above current running turn.
  const deduped = dedupeAdjacentTurns([
    ...turnsWithRunningTail,
    {
      id: "agy-turn-dup-10",
      status: "inProgress",
      startedAt: 1000,
      items: [
        { type: "userMessage", id: "u-dup", content: [{ type: "text", text: "排查登录超时的原因" }] },
        { type: "agentMessage", id: "a-dup", text: prevSummary, phase: "final_answer" },
      ],
    },
  ]);
  assert.equal(deduped.length, 2);
  assert.equal(deduped[1].id, "agy-step-20");

  // 6. dedupeAdjacentTurns keeps distinct turns even if turn.id collides across checkpoints when prompt or reply differs.
  const preservedCollision = dedupeAdjacentTurns([
    {
      id: "agy-step-2609",
      status: "completed",
      items: [
        { type: "userMessage", id: "u-old", content: [{ type: "text", text: "老问题" }] },
        { type: "mcpToolCall", id: "t-old", tool: "read_file", arguments: { path: "a.js" }, status: "completed" },
      ],
    },
    {
      id: "agy-step-2611",
      status: "completed",
      items: [{ type: "userMessage", id: "u-mid", content: [{ type: "text", text: "中间问题" }] }],
    },
    {
      id: "agy-step-2609",
      status: "completed",
      items: [
        { type: "userMessage", id: "u-new", content: [{ type: "text", text: "新问题" }] },
        { type: "agentMessage", id: "a-new", text: "新任务的完整汇总", phase: "final_answer" },
      ],
    },
  ]);
  assert.equal(preservedCollision.length, 3);
  assert.equal(preservedCollision[2].items[1].text, "新任务的完整汇总");

  // 7. renderTurnHtml displays clear status hints on process-only finished turns, and omits when summary exists or still running.
  const processOnlyTurn = {
    id: "agy-proc-1",
    status: "completed",
    items: [
      { type: "userMessage", id: "u-p1", content: [{ type: "text", text: "查日志" }] },
      { type: "mcpToolCall", id: "t-p1", tool: "read_file", arguments: { path: "a.js" }, status: "completed" },
    ],
  };
  const supersededHtml = renderTurnHtml(processOnlyTurn, {
    showIncompleteSummaryHint: true,
    supersededByNextTurn: true,
    suppressRunning: true,
  });
  assert.match(supersededHtml, /已由后续新消息接续处理/);

  const stalledTailHtml = renderTurnHtml(processOnlyTurn, {
    showIncompleteSummaryHint: true,
    supersededByNextTurn: false,
    suppressRunning: true,
  });
  assert.match(stalledTailHtml, /本轮停在工具执行步/);

  const runningHtml = renderTurnHtml({ ...processOnlyTurn, status: "inProgress" }, {
    showIncompleteSummaryHint: true,
    supersededByNextTurn: false,
    forceRunning: true,
  });
  assert.doesNotMatch(runningHtml, /本轮停在工具执行步/);

  const completedWithReplyHtml = renderTurnHtml({
    ...processOnlyTurn,
    items: [
      ...processOnlyTurn.items,
      { type: "agentMessage", id: "a-p1", text: "正常汇总内容", phase: "final_answer" },
    ],
  }, {
    showIncompleteSummaryHint: true,
    supersededByNextTurn: false,
    suppressRunning: true,
  });
  assert.doesNotMatch(completedWithReplyHtml, /本轮停在工具执行步/);
  assert.doesNotMatch(completedWithReplyHtml, /已由后续新消息接续处理/);
});

test("profile health classification, sorting, failover, and visual pills handle multi-instance availability cleanly", () => {
  const rateErr = classifyProfileError("HTTP 429 usage_limit exceeded");
  assert.equal(rateErr.status, "cooldown");
  assert.equal(rateErr.shortReason, "限额冷却");

  const authErr = classifyProfileError("401 unauthorized invalid api key");
  assert.equal(authErr.status, "unavailable");
  assert.equal(authErr.shortReason, "鉴权失效");

  const netErr = classifyProfileError("fetch failed ECONNREFUSED 502 Bad Gateway");
  assert.equal(netErr.status, "unavailable");
  assert.equal(netErr.shortReason, "线路不通");

  const expiredCooldown = normalizeProfileHealth({
    status: "cooldown",
    cooldownUntil: Math.floor(Date.now() / 1000) - 10,
  });
  assert.equal(expiredCooldown.status, "unknown");

  const profiles = [
    {
      id: "bad",
      key: "codex:bad",
      provider: "codex",
      label: "Codex 默认",
      installed: true,
      endpointLabel: "relay-a.example.com",
      health: { status: "unavailable", reasonCode: "auth", shortReason: "鉴权失效", detail: "<script>bad</script>" },
    },
    {
      id: "slow",
      key: "codex:slow",
      provider: "codex",
      label: "Codex · slow",
      installed: true,
      endpointLabel: "官方",
      health: { status: "healthy", latencyMs: 420 },
    },
    {
      id: "fast",
      key: "codex:fast",
      provider: "codex",
      label: "Codex · fast",
      installed: true,
      account: { signedIn: true, email: "guo@example.com" },
      health: { status: "healthy", latencyMs: 95 },
    },
    {
      id: "cool",
      key: "codex:cool",
      provider: "codex",
      label: "Codex · cool",
      installed: true,
      health: { status: "cooldown", shortReason: "限额冷却" },
    },
  ];

  const backSorted = sortProfilesByHealth(profiles);
  assert.deepEqual(backSorted.map((p) => p.id), ["fast", "slow", "cool", "bad"]);

  const uiSorted = sortProfilesByAvailability(profiles);
  assert.deepEqual(uiSorted.map((p) => p.id), ["fast", "slow", "cool", "bad"]);
  assert.equal(pickBestAvailableProfile(profiles, "bad")?.id, "fast");
  assert.equal(findFailoverCandidateProfile(profiles, "codex", "bad")?.id, "fast");
  assert.equal(profileHealthVisualMeta(profiles[2]).badgeText, "95ms");
  assert.match(profileOptionLabel(profiles[2]), /95ms/);
  assert.doesNotMatch(profileOptionLabel(profiles[2]), /🟢|🟡|🔴/);
  assert.equal(compactProfileChipText(profiles[3]), "cool");

  const html = renderProfilePillsHtml(profiles, {
    selectedId: "bad",
    probingKeys: new Set(["codex:slow"]),
    activeLocked: true,
  });
  assert.match(html, /data-probe-profile="fast"/);
  assert.match(html, /data-relay-profile="fast"/);
  assert.match(html, /测通中…/);
  assert.doesNotMatch(html, /<script>bad<\/script>/);
});

test("multi-instance public endpoint extraction, manual /api/profile/probe, and /api/profile/meta work with zero token cost", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-multi-prof-"));
  const dataDir = resolve(root, "data");
  const codexBad = resolve(root, "codex-default");
  const codexOk = resolve(root, "codex-backup");
  const claudeBad = resolve(root, "claude-default");
  const claudeOk = resolve(root, "claude-alt");
  const agyCli = resolve(root, "agy-cli");
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(codexBad, { recursive: true }),
    mkdir(codexOk, { recursive: true }),
    mkdir(claudeBad, { recursive: true }),
    mkdir(claudeOk, { recursive: true }),
    mkdir(agyCli, { recursive: true }),
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(
    resolve(codexBad, "config.toml"),
    'model_provider = "relay"\n[model_providers.relay]\nbase_url = "https://relay-a.example.com/v1?token=secret-url-param"\n',
  );
  await writeFile(resolve(codexBad, ".mock-probe-error"), "429 usage_limit exceeded");
  await writeFile(resolve(codexOk, "auth.json"), JSON.stringify({ tokens: { access_token: "sk-must-not-leak" } }));

  await writeFile(
    resolve(claudeBad, "settings.json"),
    JSON.stringify({
      env: {
        ANTHROPIC_BASE_URL: "https://claude-mirror.example.com/api",
        ANTHROPIC_AUTH_TOKEN: "secret-should-never-leak",
      },
    }),
  );
  await writeFile(resolve(claudeBad, ".mock-probe-error"), "401 unauthorized invalid api key");

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    dataDir,
    env: {
      ...process.env,
      CODEX_BIN: MOCK_CODEX_BIN,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([
        { id: "default", label: "Codex · 主力", home: codexBad },
        { id: "backup", label: "Codex · 备用", home: codexOk },
      ]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([
        { id: "default", label: "Claude · 镜像", home: claudeBad },
        { id: "alt", label: "Claude · 直连", home: claudeOk },
      ]),
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([
        { id: "cli", label: "Antigravity CLI", home: agyCli, profileType: "cli" },
      ]),
    },
  });
  await srv.start();
  t.after(() => srv.close());

  const initialProvRes = await fetch(`${srv.url}/api/providers`);
  assert.equal(initialProvRes.status, 200);
  const initialProv = await initialProvRes.json();
  const initialDump = JSON.stringify(initialProv);
  assert.doesNotMatch(initialDump, /secret-should-never-leak/);
  assert.doesNotMatch(initialDump, /sk-must-not-leak/);
  assert.doesNotMatch(initialDump, /secret-url-param/);

  const cBadInit = initialProv.profiles.find((p) => p.key === "codex:default");
  const clBadInit = initialProv.profiles.find((p) => p.key === "claude:default");
  assert.equal(cBadInit?.endpointLabel, "relay-a.example.com");
  assert.equal(clBadInit?.endpointLabel, "claude-mirror.example.com");

  // Manual probe on Codex -> bad marks cooldown, backup marks healthy & sorts first!
  const codexProbeRes = await fetch(`${srv.url}/api/profile/probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "codex" }),
  });
  assert.equal(codexProbeRes.status, 200);
  const codexProbeJson = await codexProbeRes.json();
  const codexProfiles = codexProbeJson.profiles.filter((p) => p.provider === "codex");
  assert.deepEqual(codexProfiles.map((p) => p.id), ["backup", "default"]);
  assert.equal(codexProfiles[0].health.status, "healthy");
  assert.ok(codexProfiles[0].health.latencyMs >= 1);
  assert.equal(codexProfiles[1].health.status, "cooldown");
  assert.equal(codexProfiles[1].health.shortReason, "限额冷却");

  // Manual probe on Claude -> bad marks unavailable/auth, alt marks healthy & sorts first!
  const claudeProbeRes = await fetch(`${srv.url}/api/profile/probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "claude" }),
  });
  assert.equal(claudeProbeRes.status, 200);
  const claudeProbeJson = await claudeProbeRes.json();
  const claudeProfiles = claudeProbeJson.profiles.filter((p) => p.provider === "claude");
  assert.deepEqual(claudeProfiles.map((p) => p.id), ["alt", "default"]);
  assert.equal(claudeProfiles[0].health.status, "healthy");
  assert.equal(claudeProfiles[1].health.status, "unavailable");
  assert.equal(claudeProfiles[1].health.shortReason, "鉴权失效");

  // Disable claude:alt manually -> sorted after cooldown/unavailable until re-enabled.
  const disableRes = await fetch(`${srv.url}/api/profile/meta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "claude", profileId: "alt", disabled: true, alias: "工作号" }),
  });
  assert.equal(disableRes.status, 200);
  const disabledJson = await disableRes.json();
  const disabledAlt = disabledJson.profiles.find((p) => p.key === "claude:alt");
  assert.equal(disabledAlt?.health?.disabled, true);
  assert.equal(disabledAlt?.health?.alias, "工作号");

  // Probe ping sessions must never pollute /api/threads list.
  const threadsRes = await fetch(`${srv.url}/api/threads`);
  const threadsJson = await threadsRes.json();
  assert.equal(
    (threadsJson.threads || []).some((th) => String(th.preview || th.title || "").includes("AGENT_CONTROL_PING")),
    false,
  );
});

test("hot-extension proxy routes (/api/voice/tts, /api/profile/probe, /api/thread, /api/models) work end-to-end with zero tokens", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-voice-e2e-"));
  const dataDir = resolve(root, "data");
  const appsDir = resolve(root, "apps");
  const agyCli = resolve(root, "agy-cli");
  const codexHome = resolve(root, "codex-default");
  const claudeHome = resolve(root, "claude-default");
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(appsDir, { recursive: true }),
    mkdir(agyCli, { recursive: true }),
    mkdir(codexHome, { recursive: true }),
    mkdir(claudeHome, { recursive: true }),
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));

  const env = {
    ...process.env,
    CODEX_BIN: MOCK_CODEX_BIN,
    CLAUDE_BIN: MOCK_CLAUDE_BIN,
    AGY_BIN: MOCK_AGY_BIN,
    EDGE_TTS_BIN: MOCK_EDGE_TTS_BIN,
    AGENT_CONTROL_CODEX_HOMES: JSON.stringify([
      { id: "default", label: "Codex 默认", home: codexHome },
    ]),
    AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([
      { id: "default", label: "Claude 默认", home: claudeHome },
    ]),
    AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([
      { id: "cli", label: "Antigravity CLI", home: agyCli, profileType: "cli" },
    ]),
  };

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    dataDir,
    appsDir,
    env,
  });
  await srv.start();
  t.after(() => srv.close());

  const hot = await createHotExtensionServer({
    port: 0,
    upstreamOrigin: srv.url,
    dataDir,
    env,
  });
  t.after(() => hot.close());

  await writeFile(
    resolve(appsDir, "ac-hot.json"),
    JSON.stringify({
      id: "ac-hot",
      name: "Agent Control Hot API",
      origin: hot.url,
    }),
  );

  // 1. Create an active Antigravity thread so VoiceCallService can dispatch to it.
  const createdRes = await fetch(`${srv.url}/api/thread/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "antigravity",
      profileId: "cli",
      cwd: "/tmp/mock-agy-project",
      text: "初始化语音被控会话 [COMPLETE_NOW]",
      permissionMode: "turbo",
    }),
  });
  assert.equal(createdRes.status, 200);

  // 2. Warm up assistant voice call channel and synthesize TTS via hot-extension proxy.
  const warmRes = await fetch(`${srv.url}/api/assistant/call/warm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ modelKey: "auto" }),
  });
  assert.equal(warmRes.status, 200);
  const warmJson = await warmRes.json();
  assert.equal(warmJson.ok, true);
  assert.equal(warmJson.resolved?.model, "gemini-4-hydrogen-low");

  // 3. Synthesize Edge TTS MP3 through hot-extension proxy (/apps/ac-hot/api/voice/tts).
  const ttsRes = await fetch(`${srv.url}/apps/ac-hot/api/voice/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "测试通过，热更新语音合成正常。" }),
  });
  assert.equal(ttsRes.status, 200);
  const ttsJson = await ttsRes.json();
  assert.equal(ttsJson.provider, "edge-tts");
  const mp3Header = Buffer.from(ttsJson.audioBase64, "base64").subarray(0, 3).toString("ascii");
  assert.equal(mp3Header, "ID3");

  // 4. Probe profiles through /apps/ac-hot/api/profile/probe and confirm health persistence.
  const hotProbeRes = await fetch(`${srv.url}/apps/ac-hot/api/profile/probe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: "antigravity" }),
  });
  assert.equal(hotProbeRes.status, 200);
  const hotProbeJson = await hotProbeRes.json();
  assert.equal(hotProbeJson.defaultProvider, "antigravity");
  assert.equal(hotProbeJson.profiles.find((p) => p.key === "antigravity:cli")?.health?.status, "healthy");

  // 5. Internal [AC_VOICE_CALL] session must remain filtered out of /api/threads.
  const listRes = await fetch(`${srv.url}/api/threads`);
  const listJson = await listRes.json();
  assert.equal(
    (listJson.threads || []).some((th) => String(th.title || th.preview || th.cwd || "").includes("[AC_VOICE_CALL]") || String(th.cwd || "").includes("/voice-call")),
    false,
  );

  // 6. Hot-extension GET /apps/ac-hot/api/thread repairs Antigravity history with compiler.py step error.
  const convErrId = "conv-hot-err-1";
  const errLogsDir = resolve(agyCli, "brain", convErrId, ".system_generated", "logs");
  await mkdir(errLogsDir, { recursive: true });
  await writeFile(
    resolve(errLogsDir, "transcript.jsonl"),
    [
      JSON.stringify({
        step_index: 0,
        type: "USER_INPUT",
        source: "USER_EXPLICIT",
        created_at: "2026-11-14T11:17:00Z",
        content: "排查编译文件",
      }),
      JSON.stringify({
        step_index: 1,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-14T11:17:01Z",
        tool_calls: [
          { name: "read_file", args: { Path: "\"/workspace/demo/studio/tools/demo_studio/server.py\"" } },
          { name: "read_file", args: { Path: "\"/workspace/demo/studio/tools/demo_studio/backend/compiler.py\"" } },
        ],
      }),
      JSON.stringify({
        step_index: 2,
        type: "GENERIC",
        status: "DONE",
        content: "Created At: 2026-11-14T19:17:01+08:00\nCompleted At: 2026-11-14T19:17:01+08:00\nShowing lines 1-400 of 600",
      }),
      JSON.stringify({
        step_index: 3,
        type: "GENERIC",
        status: "ERROR",
        content: "Created At: 2026-11-14T19:17:01+08:00\nCompleted At: 2026-11-14T19:17:01+08:00\nEncountered error in step execution: file does not exist",
      }),
      JSON.stringify({
        step_index: 4,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        content: "已改读 validators.py 继续完成。",
      }),
    ].join("\n") + "\n",
  );
  const hotThreadRes = await fetch(`${srv.url}/apps/ac-hot/api/thread?id=${encodeURIComponent(`antigravity:cli:${convErrId}`)}&limit=12`);
  assert.equal(hotThreadRes.status, 200);
  const hotThreadJson = await hotThreadRes.json();
  assert.equal(hotThreadJson.thread?.turns?.length, 1);
  assert.equal(hotThreadJson.thread.turns[0].status, "completed");
  assert.equal(hotThreadJson.thread.turns[0].error, null);
  const hotFailedRead = hotThreadJson.thread.turns[0].items.find((it) => it.arguments?.Path?.endsWith("compiler.py"));
  assert.equal(hotFailedRead?.error?.message, "文件不存在：compiler.py");

  // 7. Hot-extension /apps/ac-hot/api/models returns 200 model list, and transcript cache + indexed point-lookup stay consistent.
  const hotModelsRes = await fetch(`${srv.url}/apps/ac-hot/api/models`);
  assert.equal(hotModelsRes.status, 200);
  const hotModelsJson = await hotModelsRes.json();
  assert.ok(Array.isArray(hotModelsJson.data) && hotModelsJson.data.length > 0);
  assert.ok(Array.isArray(hotModelsJson.byProvider?.antigravity) && hotModelsJson.byProvider.antigravity.length > 0);

  const summaryDb = new DatabaseSync(resolve(agyCli, "conversation_summaries.db"));
  summaryDb.exec(`
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
  summaryDb.prepare(`
    INSERT INTO conversation_summaries (
      conversation_id, title, preview, step_count, last_modified_time,
      workspace_uris, status, source, parent_conversation_id, not_fully_idle, killed, app_data_dir
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    convErrId,
    "排查编译文件",
    "排查编译文件",
    5,
    "2026-11-14T19:17:02Z",
    JSON.stringify(["file:///tmp/mock-agy-project"]),
    "IDLE",
    "CORTEX_TRAJECTORY_SOURCE_CLI",
    "",
    0,
    0,
    agyCli,
  );
  summaryDb.close();

  const indexedById = readAntigravityIndexedThreadById(agyCli, convErrId, { profileType: "cli" });
  assert.equal(indexedById?.id, convErrId);
  assert.equal(indexedById?.title, "排查编译文件");
  assert.equal(indexedById?.cwd, "/tmp/mock-agy-project");

  const hotThreadCachedRes = await fetch(`${srv.url}/apps/ac-hot/api/thread?id=${encodeURIComponent(`antigravity:cli:${convErrId}`)}&limit=12`);
  assert.equal(hotThreadCachedRes.status, 200);
  const hotThreadCachedJson = await hotThreadCachedRes.json();
  assert.deepEqual(hotThreadCachedJson.thread.turns, hotThreadJson.thread.turns);
});

test("single-step tool failures never trigger turn-error red banner or stop /goal", async (t) => {
  assert.equal(isRecoverableToolErrorText("Encountered error in step execution: file does not exist"), true);
  assert.equal(
    formatToolExecutionError(
      "Created At: 2026-11-14T19:17:01+08:00\nCompleted At: 2026-11-14T19:17:01+08:00\nEncountered error in step execution: file does not exist",
      { filePath: "/repo/backend/compiler.py" },
    ),
    "文件不存在：compiler.py",
  );

  // Simulate legacy PID 20023 payload: failed status + raw Created At / Encountered error in step execution banner,
  // with parallel [server.py, compiler.py], 1 successful agy-gen-* echo, and subsequent validators.py read.
  const legacyTurn = {
    id: "agy-step-0",
    status: "failed",
    error: {
      message: "Created At: 2026-11-14T19:17:01+08:00\nCompleted At: 2026-11-14T19:17:01+08:00\nEncountered error in step execution: file does not exist",
    },
    items: [
      { type: "userMessage", content: [{ type: "text", text: "续跑漫剧生产平台" }] },
      { type: "mcpToolCall", id: "agy-2-tool-0", tool: "read_file", arguments: { Path: "/repo/server.py" }, status: "completed" },
      { type: "mcpToolCall", id: "agy-2-tool-1", tool: "read_file", arguments: { Path: "/repo/backend/compiler.py" }, status: "completed" },
      { type: "agentMessage", id: "agy-gen-3", text: "Created At: 2026-11-14T19:17:01+08:00\nShowing lines 1-400 of 620", phase: "commentary" },
      { type: "mcpToolCall", id: "agy-5-tool-0", tool: "read_file", arguments: { Path: "/repo/backend/validators.py" }, status: "completed" },
      { type: "agentMessage", id: "agy-gen-6", text: "Created At: 2026-11-14T19:17:02+08:00\nShowing lines 1-200 of 200", phase: "commentary" },
      { type: "agentMessage", id: "agy-msg-7", phase: "final_answer", text: "已在 validators.py 找到编译逻辑。" },
    ],
  };

  const normalized = normalizeTurnForRender(legacyTurn);
  assert.equal(normalized.status, "completed");
  assert.equal(normalized.error, null);
  const matchedCompiler = normalized.items.find((it) => it.id === "agy-2-tool-1");
  assert.equal(matchedCompiler?.status, "failed");
  assert.equal(matchedCompiler?.error?.message, "文件不存在：compiler.py");

  const renderedMissing = renderTurnHtml(legacyTurn, { agentLabel: "Antigravity" });
  assert.doesNotMatch(renderedMissing, /class="turn-error"/);
  assert.doesNotMatch(renderedMissing, /Created At:/);
  assert.doesNotMatch(renderedMissing, /Encountered error in step execution/);
  assert.match(renderedMissing, /文件不存在：compiler\.py/);

  const rangeAndPatchHtml = renderTurnHtml({
    id: "turn-range-patch",
    status: "completed",
    error: null,
    items: [
      { type: "userMessage", content: [{ type: "text", text: "修复行号和补丁" }] },
      {
        type: "mcpToolCall",
        id: "t-range",
        tool: "read_file",
        arguments: { Path: "/repo/validators.py" },
        status: "failed",
        error: { message: "Created At: 2026-11-14T18:00:00+08:00\nEncountered error in step execution: invalid line range: StartLine 101 is greater than EndLine 100" },
      },
      {
        type: "fileChange",
        id: "t-patch",
        status: "failed",
        changes: [{ path: "/repo/storage.py", kind: "modify", diff: "" }],
        error: { message: "Encountered error in step execution: target content not found in the file; the Target must exactly match existing file text" },
      },
      { type: "agentMessage", phase: "final_answer", text: "已重新定位行号并更新 storage.py。" },
    ],
  });
  assert.doesNotMatch(rangeAndPatchHtml, /class="turn-error"/);
  assert.doesNotMatch(rangeAndPatchHtml, /Encountered error in step execution/);
  assert.match(rangeAndPatchHtml, /行号范围无效（第 101–100 行）：validators\.py/);
  assert.match(rangeAndPatchHtml, /补丁内容未匹配：storage\.py/);

  // GoalController must NOT stop /goal on recoverable single-step tool errors.
  const goalDir = await mkdtemp(resolve(os.tmpdir(), "ac-goal-toolerr-"));
  t.after(() => rm(goalDir, { recursive: true, force: true }));
  const goalCtrl = createGoalController({ filePath: resolve(goalDir, "goal-states.json") });
  const tid = "antigravity:cli:conv-goal-test";
  await goalCtrl.arm(tid, { maxTurns: 5 });

  for (const errMsg of [
    "Created At: 2026-11-14T19:17:01+08:00\nEncountered error in step execution: file does not exist",
    "Encountered error in step execution: invalid line range: StartLine 101 is greater than EndLine 100",
    "target content not found in the file; the Target must exactly match existing file text",
  ]) {
    const evalRes = await goalCtrl.evaluateAfterTurn(tid, {
      lastAgentMessage: "继续推进中",
      error: { message: errMsg },
    });
    assert.equal(evalRes.action, "continue");
    assert.equal(evalRes.state.active, true);
  }
});

test("pending badge zeroing, live-progress feed rendering, ASCII detail banner, and Turbo persistence work together", async (t) => {
  // 1. pendingRequestsSynced zeroes out stale thread.pendingCount when pendingRequests is empty.
  const staleThreads = [{
    id: "antigravity:cli:stale-1",
    provider: "antigravity",
    profileId: "cli",
    profileLabel: "CLI",
    title: "修复 QQ 助手私信丢弃问题",
    cwd: "/Users/demo",
    updatedAt: 500,
    pendingCount: 1,
    live: true,
  }];
  const syncedGroups = buildProjectGroups(staleThreads, {
    pendingRequests: [],
    pendingRequestsSynced: true,
  });
  assert.equal(syncedGroups[0].pendingCount, 0);
  assert.equal(syncedGroups[0].threads[0].pendingCount, 0);
  const stripNoPending = renderProjectTaskStripHtml({
    projectGroup: syncedGroups[0],
    activeThreadId: "antigravity:cli:stale-1",
  });
  assert.doesNotMatch(stripNoPending, /is-pending/);
  assert.doesNotMatch(stripNoPending, /strip-pending-badge/);

  // 2. humanizeLiveActivity preserves real ASCII command/file details while filtering raw noise tokens.
  const cmdLive = humanizeLiveActivity({
    status: "running",
    phase: "正在执行命令…",
    text: "pytest tests/test_dm.py -q",
  });
  assert.equal(cmdLive.phase, "正在执行命令…");
  assert.equal(cmdLive.detail, "pytest tests/test_dm.py -q");

  const noiseLive = humanizeLiveActivity({
    status: "running",
    phase: "正在执行命令…",
    text: "in_progress",
  });
  assert.equal(noiseLive.detail, "");

  // 3. renderTurnHtml hides .live-progress-feed when completed, and renders visible steps + cmd snippet + thought when running.
  const sampleItems = [
    { type: "userMessage", content: [{ type: "text", text: "跑单测" }] },
    { type: "reasoning", summary: ["先查看 tenant_scope.py 再跑 pytest 验证修复"] },
    { type: "mcpToolCall", tool: "read_file", arguments: { Path: "/repo/tenant_scope.py" }, status: "completed" },
    { type: "commandExecution", command: "pytest tests/test_dm.py -q", status: "inProgress", aggregatedOutput: "line1\nline2\nline3\n2 passed in 0.41s" },
  ];
  const completedHtml = renderTurnHtml({ id: "t-done", status: "completed", items: sampleItems });
  assert.doesNotMatch(completedHtml, /class="live-progress-feed"/);

  const runningHtml = renderTurnHtml({ id: "t-live", status: "inProgress", items: sampleItems });
  assert.match(runningHtml, /<details class="process-summary-box is-live">/);
  assert.doesNotMatch(runningHtml, /<details[^>]*\bopen\b/);
  assert.match(runningHtml, /class="live-progress-feed"/);
  assert.match(runningHtml, /tenant_scope\.py/);
  assert.match(runningHtml, /pytest tests\/test_dm\.py -q/);
  assert.match(runningHtml, /class="live-cmd-snippet">line2\nline3\n2 passed in 0\.41s<\/pre>/);
  assert.match(runningHtml, /class="live-thought-preview"/);

  // Force-running also renders live feed even if serialized turn.status was not updated yet.
  const forcedHtml = renderTurnHtml({ id: "t-force", status: "completed", items: sampleItems }, { forceRunning: true });
  assert.match(forcedHtml, /class="live-progress-feed"/);

  // Unified process-card container + chronological order + bottom live frontier assertions.
  assert.match(runningHtml, /<div class="process-card is-live">\s*<details class="process-summary-box is-live">/);
  assert.match(completedHtml, /<div class="process-card">\s*<details class="process-summary-box">/);
  const runningFeed = runningHtml.slice(runningHtml.indexOf('<div class="live-progress-feed"'));
  assert.ok(
    runningFeed.indexOf('class="live-thought-preview"') < runningFeed.indexOf("pytest tests/test_dm.py -q"),
    "earlier reasoning must appear chronologically above subsequent running command",
  );
  assert.match(runningFeed, /class="live-progress-row is-active-frontier">[\s\S]*class="live-frontier-dot"[\s\S]*pytest tests\/test_dm\.py -q/);
  assert.doesNotMatch(runningFeed, /data-live-frontier="1"[^>]*>\s*<span class="live-frontier-dot"[^>]*><\/span>\s*<span class="tool-kind">思考中/);

  // Streaming liveThought overrides stale reasoning and pins a single live frontier at the bottom after completed commands.
  const completedCmdItems = [
    { type: "userMessage", content: [{ type: "text", text: "继续提交" }] },
    { type: "reasoning", summary: ["旧思考片段"] },
    { type: "commandExecution", command: "bsk cooperate sync --session eppu", status: "completed", aggregatedOutput: "CHECK: done" },
  ];
  const withLiveThoughtHtml = renderTurnHtml(
    { id: "t-live-thought", status: "inProgress", items: completedCmdItems },
    { forceRunning: true, liveThought: "正在校验标题、非儿童向勾选与展示所有字段..." },
  );
  assert.equal((withLiveThoughtHtml.match(/class="process-card is-live"/g) || []).length, 1);
  assert.equal((withLiveThoughtHtml.match(/class="live-thought-preview"/g) || []).length, 1);
  const liveThoughtFeed = withLiveThoughtHtml.slice(withLiveThoughtHtml.indexOf('<div class="live-progress-feed"'));
  assert.doesNotMatch(liveThoughtFeed, /旧思考片段/);
  assert.match(withLiveThoughtHtml, /内部推理记录（共 2 段，按需展开）/);
  assert.ok(
    liveThoughtFeed.indexOf("bsk cooperate sync --session eppu") < liveThoughtFeed.indexOf('data-live-frontier="1"'),
    "completed commands must appear above bottom streaming thought frontier",
  );
  assert.match(liveThoughtFeed, /<div class="live-thought-preview" data-live-frontier="1">[\s\S]*class="live-frontier-dot"[\s\S]*思考中[\s\S]*正在校验标题/);

  // Fresh running turn with only userMessage + liveThought renders unified process-card directly inside turn.
  const freshLiveHtml = renderTurnHtml(
    { id: "t-fresh", status: "inProgress", items: [{ type: "userMessage", content: [{ type: "text", text: "hi" }] }] },
    { forceRunning: true, liveThought: "先定位关键模块" },
  );
  assert.match(freshLiveHtml, /<div class="process-card is-live">[\s\S]*<div class="live-thought-preview" data-live-frontier="1">[\s\S]*先定位关键模块/);

  // Fresh running turn with only userMessage + livePhase (no tools, no thought) renders phase once without duplicate empty summary box.
  const phaseOnlyHtml = renderTurnHtml(
    { id: "t-phase-only", status: "inProgress", items: [{ type: "userMessage", content: [{ type: "text", text: "改好了吗" }] }] },
    { forceRunning: true, livePhase: "正在理解指令… · 第 1051 步" },
  );
  assert.equal((phaseOnlyHtml.match(/正在理解指令… · 第 1051 步/g) || []).length, 1);
  assert.doesNotMatch(phaseOnlyHtml, /class="process-summary-box/);
  assert.match(phaseOnlyHtml, /<div class="process-card is-live">[\s\S]*<div class="live-frontier-status" data-live-frontier="1">[\s\S]*正在理解指令… · 第 1051 步/);

  // suppressRunning demotes an inProgress turn to static completed card once streaming reply takes over.
  const suppressedHtml = renderTurnHtml(
    { id: "t-suppressed", status: "inProgress", items: completedCmdItems },
    { suppressRunning: true },
  );
  assert.doesNotMatch(suppressedHtml, /is-live/);
  assert.doesNotMatch(suppressedHtml, /live-progress-feed/);

  assert.equal(turnEndsWithProcessGroup({ items: completedCmdItems }), true);
  assert.equal(turnEndsWithProcessGroup({
    items: [
      ...completedCmdItems,
      { type: "agentMessage", phase: "final_answer", text: "已经处理完成" },
    ],
  }), false);

  // 4. End-to-end Turbo persistence: initial turbo setting auto-approves follow-up turns even when permissionMode is omitted.
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-turbo-persist-"));
  const dataDir = resolve(root, "data");
  const appsDir = resolve(root, "apps");
  const agyCli = resolve(root, "agy-cli");
  const codexHome = resolve(root, "codex-default");
  const claudeHome = resolve(root, "claude-default");
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(appsDir, { recursive: true }),
    mkdir(agyCli, { recursive: true }),
    mkdir(codexHome, { recursive: true }),
    mkdir(claudeHome, { recursive: true }),
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    dataDir,
    appsDir,
    env: {
      ...process.env,
      CODEX_BIN: MOCK_CODEX_BIN,
      CLAUDE_BIN: MOCK_CLAUDE_BIN,
      AGY_BIN: MOCK_AGY_BIN,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: codexHome }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: claudeHome }]),
      AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "cli", label: "Antigravity CLI", home: agyCli, profileType: "cli" }]),
    },
  });
  await srv.start();
  t.after(() => srv.close());

  const sseCtrl = new AbortController();
  const eventsRes = await fetch(`${srv.url}/api/events`, { signal: sseCtrl.signal });
  assert.equal(eventsRes.status, 200);
  const reader = eventsRes.body.getReader();
  const decoder = new TextDecoder();
  let sseBuf = "";
  const seenServerRequests = [];
  const seenCompletions = [];
  const pumpEvents = (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        sseBuf += decoder.decode(value, { stream: true });
        let sep;
        while ((sep = sseBuf.indexOf("\n\n")) !== -1) {
          const rawEvt = sseBuf.slice(0, sep);
          sseBuf = sseBuf.slice(sep + 2);
          let evtName = "message";
          const dataLines = [];
          for (const line of rawEvt.split("\n")) {
            if (line.startsWith("event:")) evtName = line.slice(6).trim();
            else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
          }
          if (!dataLines.length) continue;
          const payload = JSON.parse(dataLines.join("\n"));
          if (evtName === "server_request") seenServerRequests.push(payload);
          if (evtName === "provider_event" && payload.type === "turn_completed") {
            seenCompletions.push(payload);
          }
        }
      }
    } catch {
      // Aborted during teardown.
    }
  })();
  t.after(async () => {
    sseCtrl.abort();
    await reader.cancel().catch(() => {});
    await pumpEvents;
  });

  const startRes = await fetch(`${srv.url}/api/thread/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "antigravity",
      profileId: "cli",
      cwd: "/tmp/mock-agy-project",
      text: "初始化 Turbo 会话",
      permissionMode: "turbo",
    }),
  });
  assert.equal(startRes.status, 200);
  const startJson = await startRes.json();
  const tid = startJson.thread.id;
  assert.equal(startJson.thread.permissionMode, "turbo");

  // Wait for Turn 1 to finish before starting Turn 2.
  const t1Deadline = Date.now() + 4000;
  while (Date.now() < t1Deadline && !seenCompletions.some((c) => c.threadId === tid)) {
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(seenCompletions.some((c) => c.threadId === tid), "expected Turn 1 completion");

  // Follow-up turn omits permissionMode (like queue/goal/voice continuations); mock requests permission via [AGY_PERMISSION].
  const followRes = await fetch(`${srv.url}/api/turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      threadId: tid,
      text: "执行敏感步骤 [AGY_PERMISSION]",
    }),
  });
  assert.equal(followRes.status, 200);

  // Wait for Turn 2 completion event and verify backend auto-approved with allow_always and zero server_request cards.
  const t2Deadline = Date.now() + 5000;
  let permCompletion = null;
  while (Date.now() < t2Deadline) {
    permCompletion = seenCompletions.find((c) => c.threadId === tid && String(c.lastAgentMessage || "").includes("Antigravity 授权结果:"));
    if (permCompletion) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.ok(permCompletion, "expected follow-up [AGY_PERMISSION] turn to auto-approve and finish");
  assert.match(permCompletion.lastAgentMessage, /allow_always|allow_once/);
  assert.equal(seenServerRequests.length, 0);

  const finalThreadRes = await fetch(`${srv.url}/api/thread?id=${encodeURIComponent(tid)}&limit=10`);
  assert.equal(finalThreadRes.status, 200);
  const finalThreadJson = await finalThreadRes.json();
  assert.deepEqual(finalThreadJson.pendingRequests, []);
  assert.equal(finalThreadJson.thread.pendingCount, 0);
});

test("sidebar hierarchy, preview deduplication, completed blue dots, and minimal micro-tags", () => {
  // 1. dedupeThreadPreview removes exact & truncated ellipsis duplicates while keeping meaningful continuations.
  assert.equal(
    dedupeThreadPreview("Remote Control Codex Project Design", "Remote Control Codex Project Design"),
    "",
  );
  assert.equal(
    dedupeThreadPreview("任务：继续推进「漫剧生产平台」 ...", "任务：继续推进「漫剧生产平台」这个项目，不要停"),
    "这个项目，不要停",
  );
  assert.equal(
    dedupeThreadPreview("任务：继续推进「漫剧生产平台」 ...", "任务：继续推进「漫剧生产平台」"),
    "",
  );
  assert.equal(
    dedupeThreadPreview("修复 QQ 助手私信", "已定位 tenant_scope.py 根因"),
    "已定位 tenant_scope.py 根因",
  );
  assert.equal(
    dedupeThreadPreview("AgentCtrl·优化会话标题生成与更新逻辑", "优化会话标题生成与更新逻辑"),
    "",
  );
  assert.equal(
    dedupeThreadPreview("语音对话功能优化失效反馈", "好了吗"),
    "",
  );
  assert.equal(
    dedupeThreadPreview("弄一个PC的简单包装", "Bug Report And Screenshot"),
    "",
  );

  // 2. compactThreadSourceChip shows full account attribution only when multi-profile attribution is needed, and drops it on single-profile or profileFilter.
  const profiles = [
    { provider: "antigravity", id: "desktop", label: "Antigravity 桌面", installed: true },
    { provider: "antigravity", id: "cli", label: "Antigravity CLI", installed: true },
    { provider: "codex", id: "codex", label: "Codex · codex", installed: true },
  ];
  const agyDesktopAllChip = compactThreadSourceChip(
    { provider: "antigravity", profileId: "desktop", profileLabel: "Antigravity 桌面" },
    { providerFilter: "all", profiles },
  );
  assert.equal(agyDesktopAllChip?.glyph, "");
  assert.equal(agyDesktopAllChip?.text, "桌面");
  assert.equal(agyDesktopAllChip?.tone, "antigravity");
  assert.equal(agyDesktopAllChip?.title, "Antigravity · Antigravity 桌面");

  const codexAllChip = compactThreadSourceChip(
    { provider: "codex", profileId: "codex", profileLabel: "Codex · codex" },
    { providerFilter: "all", profiles },
  );
  assert.equal(codexAllChip, null);

  assert.deepEqual(
    compactThreadSourceChip({ provider: "antigravity", profileId: "desktop", profileLabel: "Antigravity 桌面" }, { providerFilter: "antigravity", profiles }),
    { glyph: "", text: "桌面", tone: "antigravity", title: "Antigravity · Antigravity 桌面" },
  );
  const codexFilteredChip = compactThreadSourceChip({ provider: "codex", profileId: "codex", profileLabel: "Codex · codex" }, { providerFilter: "codex", profiles });
  assert.equal(codexFilteredChip, null);
  assert.equal(
    compactThreadSourceChip({ provider: "antigravity", profileId: "desktop", profileLabel: "Antigravity 桌面" }, { providerFilter: "antigravity", profileFilter: "antigravity:desktop", profiles }),
    null,
  );

  // 2b. Multi-account Codex profiles show full account attribution on both default and secondary accounts.
  const dualCodexProfiles = [
    {
      provider: "codex",
      id: "default",
      label: "Codex 默认",
      installed: true,
      account: { signedIn: true, email: "carol1990@gmail.com" },
    },
    {
      provider: "codex",
      id: "guuguo",
      label: "Codex · guuguo",
      installed: true,
      account: { signedIn: true, email: "alice@qq.com" },
    },
  ];
  assert.equal(compactProfileChipText(dualCodexProfiles[0]), "carol1990");
  assert.equal(compactProfileChipText(dualCodexProfiles[1]), "guuguo");

  const dualDefaultCodexTabChip = compactThreadSourceChip(
    { provider: "codex", profileId: "default", profileLabel: "Codex 默认" },
    { providerFilter: "codex", profiles: dualCodexProfiles },
  );
  assert.equal(dualDefaultCodexTabChip?.text, "carol·Gmail");
  assert.equal(dualDefaultCodexTabChip?.tone, "codex");
  assert.match(dualDefaultCodexTabChip?.title || "", /carol1990@gmail\.com/);

  const dualWorkCodexTabChip = compactThreadSourceChip(
    { provider: "codex", profileId: "guuguo", profileLabel: "Codex · guuguo" },
    { providerFilter: "codex", profiles: dualCodexProfiles },
  );
  assert.equal(dualWorkCodexTabChip?.text, "alice·QQ");

  const dualDefaultAllChip = compactThreadSourceChip(
    { provider: "codex", profileId: "default", profileLabel: "Codex 默认" },
    { providerFilter: "all", profiles: dualCodexProfiles },
  );
  assert.equal(dualDefaultAllChip?.text, "carol·Gmail");

  const dualBoardHtml = renderProjectBoardHtml({
    groups: [
      {
        cwd: "/tmp/proj",
        name: "proj",
        rawName: "proj",
        pinned: true,
        pendingCount: 0,
        liveCount: 0,
        threads: [
          { id: "codex:default:t1", provider: "codex", profileId: "default", profileLabel: "Codex 默认", title: "任务一", updatedAt: 1000 },
          { id: "codex:guuguo:t2", provider: "codex", profileId: "guuguo", profileLabel: "Codex · guuguo", title: "任务二", updatedAt: 999 },
        ],
      },
    ],
    profiles: dualCodexProfiles,
  });
  assert.match(dualBoardHtml, /carol1990/);
  assert.match(dualBoardHtml, /guuguo/);

  // 3. renderSidebarThreadListHtml distinguishes project headers & child tree rail, hides duplicate preview,
  //    renders live radar dot + completed blue dot, and folds groups > 8 items.
  const nowSec = Math.floor(Date.now() / 1000);
  const sampleThreads = [
    {
      id: "antigravity:desktop:live-1",
      provider: "antigravity",
      profileId: "desktop",
      profileLabel: "Antigravity 桌面",
      cwd: "/workspace/demo/studio",
      title: "Remote Control Codex Project Design",
      preview: "Remote Control Codex Project Design",
      live: true,
      queuedCount: 1,
      updatedAt: nowSec - 10,
    },
    {
      id: "antigravity:desktop:done-1",
      provider: "antigravity",
      profileId: "desktop",
      profileLabel: "Antigravity 桌面",
      cwd: "/workspace/demo/studio",
      title: "故事设定与数据整理",
      preview: "故事设定与数据整理",
      live: false,
      updatedAt: nowSec - 180,
    },
  ];
  for (let i = 2; i <= 11; i += 1) {
    sampleThreads.push({
      id: `codex:codex:done-${i}`,
      provider: "codex",
      profileId: "codex",
      profileLabel: "Codex · codex",
      cwd: "/workspace/demo/studio",
      title: `历史任务 ${i}`,
      preview: `历史任务 ${i}`,
      live: false,
      updatedAt: nowSec - 600 - i * 60,
    });
  }
  const groups = buildProjectGroups(sampleThreads, {
    projectsMeta: { "/workspace/demo/studio": { pinned: true } },
  });
  const liveMap = new Map([["antigravity:desktop:live-1", { phase: "正在执行命令", detail: "npm test" }]]);
  const unreadMap = new Map([["codex:codex:done-2", { status: "completed", summary: "刚跑完", at: nowSec * 1000 }]]);
  const sidebarHtml = renderSidebarThreadListHtml(groups, {
    activeThreadId: "antigravity:desktop:done-1",
    profiles,
    liveActivityByThread: liveMap,
    recentCompletedByThread: unreadMap,
  });

  assert.match(sidebarHtml, /class="project-group-head"/);
  assert.match(sidebarHtml, /class="project-group-items"/);
  assert.match(sidebarHtml, /class="thread-status-dot is-live is-agent-live is-agent-marker is-antigravity"[^>]*><svg class="ac-icon ac-provider-icon is-antigravity"/);
  assert.match(sidebarHtml, /class="thread-status-dot is-done is-recent is-agent-marker is-codex"[^>]*><svg class="ac-icon ac-provider-icon is-codex"/);
  assert.match(sidebarHtml, /class="thread-item[^"]*is-recent-done" data-thread-id="codex:codex:done-2"/);
  assert.match(sidebarHtml, /class="thread-status-dot is-done is-agent-marker is-(?:antigravity|codex)"/);
  assert.match(sidebarHtml, /class="thread-item-sub is-live-sub"[^>]*>正在执行命令 · npm test</);
  const idleRowWithTags = sidebarHtml.match(/<button[^>]*data-thread-id="antigravity:desktop:done-1"[^>]*>([\s\S]*?)<\/button>/)?.[1] || "";
  assert.ok(idleRowWithTags);
  assert.doesNotMatch(idleRowWithTags, /thread-item-secondary/);
  assert.match(idleRowWithTags, /thread-item-right[\s\S]*thread-micro-tag is-text-only is-antigravity"[^>]*>桌面<\/span>[\s\S]*thread-item-time/);
  const liveRow = sidebarHtml.match(/<button[^>]*data-thread-id="antigravity:desktop:live-1"[^>]*>([\s\S]*?)<\/button>/)?.[1] || "";
  assert.ok(liveRow);
  assert.match(liveRow, /class="thread-status-dot is-live is-agent-live is-agent-marker is-antigravity"[^>]*><svg class="ac-icon ac-provider-icon is-antigravity"/);
  assert.doesNotMatch(liveRow, /thread-item-time|刚刚/);
  assert.ok(liveRow.indexOf("thread-item-tags") > liveRow.indexOf("thread-item-sub"));
  assert.match(liveRow, /class="thread-item-secondary">\s*<span class="thread-item-sub[^>]*>[^<]*<\/span>\s*<span class="thread-item-tags">/);
  assert.match(liveRow.slice(liveRow.indexOf("thread-item-tags")), /thread-queued-pill[\s\S]*thread-micro-tag is-text-only is-antigravity"[^>]*>桌面<\/span>/);

  // Single-account live Codex thread shows animated Codex glyph at left and omits redundant right-side agent chip.
  const singleCodexLiveGroups = buildProjectGroups([
    {
      id: "codex:codex:running-only",
      provider: "codex",
      profileId: "codex",
      profileLabel: "Codex · codex",
      cwd: "/workspace/demo/codex-only",
      title: "Codex 独立运行任务",
      live: true,
      updatedAt: nowSec - 5,
    },
  ], {
    projectsMeta: { "/workspace/demo/codex-only": { pinned: true } },
  });
  const singleCodexLiveHtml = renderSidebarThreadListHtml(singleCodexLiveGroups, {
    profiles: [{ provider: "codex", id: "codex", label: "Codex · codex", installed: true }],
    autoFoldProjects: false,
    nowMs: nowSec * 1000,
  });
  assert.match(singleCodexLiveHtml, /class="thread-status-dot is-live is-agent-live is-agent-marker is-codex"[^>]*><svg class="ac-icon ac-provider-icon is-codex"/);
  assert.doesNotMatch(singleCodexLiveHtml, /class="thread-micro-tag/);
  const readSidebarHtml = renderSidebarThreadListHtml(groups, {
    activeThreadId: "codex:codex:done-2",
    profiles,
    recentCompletedByThread: new Map(),
  });
  const readRow = readSidebarHtml.match(/<button[^>]*data-thread-id="codex:codex:done-2"[^>]*>([\s\S]*?)<\/button>/)?.[1] || "";
  assert.match(readRow, /class="thread-status-dot is-done is-agent-marker is-codex"/);
  assert.doesNotMatch(readRow, /is-recent/);
  assert.match(readRow, /thread-item-time/);
  // Duplicate title "故事设定与数据整理" must appear once (only as title, not duplicated in .thread-item-sub).
  assert.equal((sidebarHtml.match(/故事设定与数据整理/g) || []).length, 1);
  // Massive group > 8 folds cleanly with an expand button for the remaining 4 items.
  assert.match(sidebarHtml, /data-sidebar-expand-cwd="\/workspace\/demo\/studio"/);
  assert.match(sidebarHtml, /展开其余 4 条会话/);

  // Compact sidebar hides static gray preview lines when idle, keeps live phase, and restores matching preview during search.
  const idleWithPreviewThreads = [
    {
      id: "antigravity:desktop:idle-clean",
      provider: "antigravity",
      profileId: "desktop",
      profileLabel: "Antigravity 桌面",
      cwd: "/workspace/demo/agent-control",
      title: "语音对话功能优化失效反馈",
      preview: "额外旧副标题关键词",
      live: false,
      updatedAt: nowSec - 60,
    },
  ];
  const idleGroups = buildProjectGroups(idleWithPreviewThreads);
  const idleSidebarHtml = renderSidebarThreadListHtml(idleGroups, { profiles, nowMs: nowSec * 1000 });
  assert.doesNotMatch(idleSidebarHtml, /额外旧副标题关键词/);
  assert.doesNotMatch(idleSidebarHtml, /class="thread-item-sub"/);

  const searchGroups = buildProjectGroups(idleWithPreviewThreads, { searchText: "旧副标题" });
  const searchSidebarHtml = renderSidebarThreadListHtml(searchGroups, {
    profiles,
    nowMs: nowSec * 1000,
    searchText: "旧副标题",
  });
  assert.match(searchSidebarHtml, /class="thread-item-sub "[^>]*>额外<mark class="search-hit-mark">旧副标题<\/mark>关键词</);
});

test("markdown renders GFM tables, headerless pipe tables, alerts, task lists, nested lists, math, details, copyable code, and blocks XSS", () => {
  const input = [
    "# 一级标题",
    "##### 五级标题",
    "###### 六级标题",
    "",
    "| 集数 | 类型 | 时长 |",
    "| :--- | :---: | ---: |",
    "| `ep34` | **免费** | 58s |",
    "| ep35 | [链接](https://example.com/a) | ~~62s~~ |",
    "",
    "| ep34 | 充电专属 X1 | 蚊子咬的 / 晚上对账 |",
    "| ep37 | 免费 F3 | 回流小红盒 |",
    "",
    "---",
    "",
    "3. 从三开始",
    "4. 第四项",
    "   - 子项 tenant_scope.py 下划线不斜体",
    "   - *真斜体* 与 ~~删除线~~",
    "",
    "- [x] 已完成任务 <kbd>Cmd+K</kbd>",
    "- [ ] 待处理任务 [详情](<file:///workspace/demo/test dir/doc.md>)",
    "",
    "> 多行引用第一行",
    "> 多行引用第二行",
    "",
    "> [!WARNING]",
    "> 注意检查 `agent-control` 配置",
    "",
    "> [!NOTE]",
    "> 参考 [坏链接](javascript:alert(1)) 与 <script>alert(2)</script>",
    "",
    "<details>",
    "<summary>展开细节 <b>安全</b><script>xss()</script></summary>",
    "",
    "内部段落与 $x^2 + y^2$，以及价格 $100 到 $200 不变",
    "",
    "</details>",
    "",
    "$$",
    "E = mc^2",
    "$$",
    "",
    "````markdown",
    "```js",
    "console.log('<img src=x onerror=alert(1)>');",
    "```",
    "````",
    "",
    "<truncated 12598 bytes>",
    "",
    "<img src=x onerror=alert(3)>",
  ].join("\n");

  const html = renderMarkdown(input);

  // Headings & HR
  assert.match(html, /<h1>一级标题<\/h1>/);
  assert.match(html, /<h5>五级标题<\/h5>/);
  assert.match(html, /<h6>六级标题<\/h6>/);
  assert.match(html, /<hr class="md-hr"\s*\/?>/);

  // GFM table with alignments + headerless pipe table fallback
  assert.match(html, /<div class="md-table-wrap"><table class="md-table"><thead><tr><th[^>]*text-align:\s*left[^>]*>集数<\/th><th[^>]*text-align:\s*center[^>]*>类型<\/th><th[^>]*text-align:\s*right[^>]*>时长<\/th><\/tr><\/thead>/);
  assert.match(html, /<td style="text-align:left"><code>ep34<\/code><\/td><td style="text-align:center"><strong>免费<\/strong><\/td>/);
  assert.match(html, /<del>62s<\/del>/);
  assert.match(html, /<table class="md-table is-headless"><tbody>/);
  assert.match(html, /<td>ep34<\/td><td>充电专属 X1<\/td>/);

  // Ordered start=3, nested ul, underscore identifier preservation
  assert.match(html, /<ol start="3">/);
  assert.match(html, /tenant_scope\.py/);
  assert.doesNotMatch(html, /tenant<em>scope/);
  assert.match(html, /<em>真斜体<\/em>/);

  // Task lists & kbd & file link with spaces
  assert.match(html, /class="md-task-item is-checked"/);
  assert.match(html, /class="md-checkbox is-checked"/);
  assert.match(html, /<kbd class="md-kbd">Cmd\+K<\/kbd>/);
  assert.match(html, /class="md-file-link"/);
  assert.match(html, /href="file:\/\/\/workspace\/demo\/test(?:%20| )dir\/doc\.md"/);

  // Multi-line blockquote & GFM alerts
  assert.match(html, /<blockquote>[\s\S]*多行引用第一行[\s\S]*多行引用第二行[\s\S]*<\/blockquote>/);
  assert.match(html, /class="md-alert is-warning"/);
  assert.match(html, /class="md-alert is-note"/);

  // Details, math vs currency, 4-backtick fenced code block with copy button, truncated note
  assert.match(html, /<details class="md-details"><summary>/);
  assert.match(html, /class="md-math-inline"[^>]*>x\^2 \+ y\^2</);
  assert.match(html, /价格 \$100 到 \$200 不变/);
  assert.match(html, /<div class="md-math-block">[\s\S]*E = mc\^2[\s\S]*<\/div>/);
  assert.match(html, /class="md-code-block"[\s\S]*class="md-code-head"[\s\S]*class="md-code-lang"[^>]*>markdown<[\s\S]*data-copy-code/);
  assert.match(html, /console\.log\(&#39;&lt;img src=x onerror=alert\(1\)&gt;&#39;\);/);
  assert.match(html, /class="md-truncated-note"/);

  // Strict XSS prevention
  assert.doesNotMatch(html, /<script>/i);
  assert.doesNotMatch(html, /javascript:/i);
  assert.doesNotMatch(html, /<img[^>]*onerror=/i);
  assert.match(html, /&lt;img src=x onerror=alert\(3\)&gt;/);
});

test("projects and threads stay sorted strictly by updatedAt without live, goal, or pending jumping", () => {
  const baseThreads = [
    { id: "codex:default:p1-new", provider: "codex", profileId: "default", cwd: "/tmp/proj-a", title: "A 新", updatedAt: 500, live: false },
    { id: "codex:default:p1-old", provider: "codex", profileId: "default", cwd: "/tmp/proj-a", title: "A 旧", updatedAt: 100, live: false },
    { id: "claude:default:p2-mid", provider: "claude", profileId: "default", cwd: "/tmp/proj-b", title: "B 中", updatedAt: 400, live: false },
    { id: "antigravity:cli:p3-pin", provider: "antigravity", profileId: "cli", cwd: "/tmp/proj-pin", title: "置顶旧", updatedAt: 50, live: false },
    { id: "codex:default:home-latest", provider: "codex", profileId: "default", cwd: "/Users/demo", title: "主目录最新", updatedAt: 600, live: false },
  ];
  const projectsMeta = { "/tmp/proj-pin": { pinned: true } };

  const idleGroups = buildProjectGroups(baseThreads, { projectsMeta });
  const expectedProjectOrder = ["/tmp/proj-pin", "/Users/demo", "/tmp/proj-a", "/tmp/proj-b"];
  assert.deepEqual(idleGroups.map((g) => g.cwd), expectedProjectOrder);
  assert.deepEqual(idleGroups[2].threads.map((t) => t.id), ["codex:default:p1-new", "codex:default:p1-old"]);

  // Flipping live, goalState, and pendingRequests on older items must not reorder groups or threads.
  const activeThreads = baseThreads.map((t) => {
    if (t.id === "codex:default:p1-old") return { ...t, live: true, goalState: { active: true } };
    if (t.id === "claude:default:p2-mid") return { ...t, live: true, goalState: { active: true } };
    return t;
  });
  const activeGroups = buildProjectGroups(activeThreads, {
    projectsMeta,
    pendingRequests: [{ id: "req-old", threadId: "codex:default:p1-old", title: "确认操作" }],
  });
  assert.deepEqual(activeGroups.map((g) => g.cwd), expectedProjectOrder);
  assert.deepEqual(activeGroups[2].threads.map((t) => t.id), ["codex:default:p1-new", "codex:default:p1-old"]);

  // Project Board uses one unified recent section without jumping projects into "进行中".
  const boardHtml = renderProjectBoardHtml({ groups: activeGroups, allGroups: activeGroups });
  assert.match(boardHtml, /ac-icon-folder/);
  assert.match(boardHtml, /最近项目/);
  assert.doesNotMatch(boardHtml, /进行中/);
});

test("sidebar auto-expands busy projects, collapses idle ones with manual-expand hold TTL, and hides stale projects and threads until clicked", () => {
  const nowSec = 1_794_700_000;
  const nowMs = nowSec * 1000;
  const H = 3600;
  const profiles = [{ key: "codex:default", provider: "codex", id: "default", label: "Codex" }];

  const threads = [
    // 1. Pinned stale project (30h old) must remain visible in primary list and not hidden in stale bucket
    { id: "codex:default:pin-1", provider: "codex", profileId: "default", cwd: "/tmp/pinned-old", title: "置顶历史项目", updatedAt: nowSec - 30 * H, live: false },
    // 2. Busy project (>= 2 recent live threads) -> auto-expanded, keeps recent threads & folds > 12h threads
    { id: "codex:default:busy-live-1", provider: "codex", profileId: "default", cwd: "/tmp/busy-proj", title: "进行中一号", updatedAt: nowSec - 30, live: true },
    { id: "codex:default:busy-live-2", provider: "codex", profileId: "default", cwd: "/tmp/busy-proj", title: "进行中二号", updatedAt: nowSec - 120, live: true },
    { id: "codex:default:busy-recent-done", provider: "codex", profileId: "default", cwd: "/tmp/busy-proj", title: "近期已完成", updatedAt: nowSec - 2 * H, live: false },
    { id: "codex:default:busy-stale-1", provider: "codex", profileId: "default", cwd: "/tmp/busy-proj", title: "较早会话甲", updatedAt: nowSec - 20 * H, live: false },
    { id: "codex:default:busy-stale-2", provider: "codex", profileId: "default", cwd: "/tmp/busy-proj", title: "较早会话乙", updatedAt: nowSec - 24 * H, live: false },
    // 3. Single-live background project (1 live thread) -> stays collapsed by default
    { id: "codex:default:one-live", provider: "codex", profileId: "default", cwd: "/tmp/one-live-proj", title: "单挂起任务", updatedAt: nowSec - 600, live: true },
    // 4. Recent idle project (3h old) -> visible in primary list, collapsed by default
    { id: "codex:default:idle-recent", provider: "codex", profileId: "default", cwd: "/tmp/idle-recent-proj", title: "最近空闲会话", updatedAt: nowSec - 3 * H, live: false },
    // 5. Stale idle projects (25h & 40h old) -> hidden under "较早未进行的项目" by default
    { id: "codex:default:stale-a-1", provider: "codex", profileId: "default", cwd: "/tmp/stale-proj-a", title: "旧项目甲一", updatedAt: nowSec - 25 * H, live: false },
    { id: "codex:default:stale-a-2", provider: "codex", profileId: "default", cwd: "/tmp/stale-proj-a", title: "旧项目甲二", updatedAt: nowSec - 26 * H, live: false },
    { id: "codex:default:stale-a-3", provider: "codex", profileId: "default", cwd: "/tmp/stale-proj-a", title: "旧项目甲三", updatedAt: nowSec - 28 * H, live: false },
    { id: "codex:default:stale-b-1", provider: "codex", profileId: "default", cwd: "/tmp/stale-proj-b", title: "旧项目乙一", updatedAt: nowSec - 40 * H, live: false },
  ];

  const groups = buildProjectGroups(threads, {
    projectsMeta: { "/tmp/pinned-old": { pinned: true } },
  });

  // Strict updatedAt ordering preserved (busy-proj -> one-live-proj -> idle-recent-proj -> stale-proj-a -> stale-proj-b after pinned)
  assert.deepEqual(
    groups.map((g) => g.cwd),
    ["/tmp/pinned-old", "/tmp/busy-proj", "/tmp/one-live-proj", "/tmp/idle-recent-proj", "/tmp/stale-proj-a", "/tmp/stale-proj-b"],
  );

  // Default sidebar rendering
  const defaultHtml = renderSidebarThreadListHtml(groups, { profiles, nowMs });
  assert.match(defaultHtml, /class="project-group has-live" data-cwd="\/tmp\/busy-proj"/);
  assert.doesNotMatch(defaultHtml, /class="project-group[^"]*is-collapsed" data-cwd="\/tmp\/busy-proj"/);
  assert.match(defaultHtml, /class="project-group has-live is-collapsed" data-cwd="\/tmp\/one-live-proj"/);
  assert.match(defaultHtml, /class="project-group is-collapsed" data-cwd="\/tmp\/idle-recent-proj"/);
  // Busy group hides >12h threads and labels them as stale
  assert.match(defaultHtml, /近期已完成/);
  assert.doesNotMatch(defaultHtml, /较早会话甲/);
  assert.match(defaultHtml, /data-sidebar-expand-cwd="\/tmp\/busy-proj"[\s\S]*?展开其余 2 条较早会话/);
  // Stale projects (>18h) are tucked behind "较早未进行的项目" button
  assert.match(defaultHtml, /data-sidebar-stale-projects="expand"[\s\S]*?较早未进行的项目[\s\S]*?>2</);
  assert.doesNotMatch(defaultHtml, /data-cwd="\/tmp\/stale-proj-a"/);

  // Expanding stale threads inside busy-proj shows all threads and collapse button even when total <= 8
  const expandedThreadsHtml = renderSidebarThreadListHtml(groups, {
    profiles,
    nowMs,
    expandedSidebarGroups: new Set(["/tmp/busy-proj"]),
  });
  assert.match(expandedThreadsHtml, /较早会话甲/);
  assert.match(expandedThreadsHtml, /data-sidebar-collapse-cwd="\/tmp\/busy-proj"[\s\S]*?收起较早会话/);

  // Manual-expand TTL: held open within 30 minutes, auto-collapsed after 30 minutes
  const idleGroup = groups.find((g) => g.cwd === "/tmp/idle-recent-proj");
  const withinTtlPrefs = { "/tmp/idle-recent-proj": { action: "expand", updatedAt: nowMs - 10 * 60 * 1000 } };
  const expiredTtlPrefs = { "/tmp/idle-recent-proj": { action: "expand", updatedAt: nowMs - 31 * 60 * 1000 } };
  assert.equal(resolveProjectGroupCollapsed(idleGroup, { sidebarFoldPrefs: withinTtlPrefs, nowMs }), false);
  assert.equal(resolveProjectGroupCollapsed(idleGroup, { sidebarFoldPrefs: expiredTtlPrefs, nowMs }), true);

  // Expanding stale projects + manually clicking into an all-stale project guarantees min 2 fallback threads
  const openedStaleHtml = renderSidebarThreadListHtml(groups, {
    profiles,
    nowMs,
    showStaleProjects: true,
    sidebarFoldPrefs: { "/tmp/stale-proj-a": { action: "expand", updatedAt: nowMs - 60_000 } },
  });
  assert.match(openedStaleHtml, /data-sidebar-stale-projects="collapse"[\s\S]*?收起较早未进行的项目/);
  assert.match(openedStaleHtml, /data-cwd="\/tmp\/stale-proj-a"/);
  assert.match(openedStaleHtml, /旧项目甲一/);
  assert.match(openedStaleHtml, /旧项目甲二/);
  assert.doesNotMatch(openedStaleHtml, /旧项目甲三/);
  assert.match(openedStaleHtml, /data-sidebar-expand-cwd="\/tmp\/stale-proj-a"[\s\S]*?展开其余 1 条较早会话/);

  // Clicking a pending group stays auto-expanded; partition fallback keeps at least minVisibleProjects when all groups are stale
  const onlyStale = groups.filter((g) => g.cwd.startsWith("/tmp/stale-proj"));
  const partitioned = partitionSidebarProjectGroups(onlyStale, { nowMs, minVisibleProjects: 2 });
  assert.equal(partitioned.primaryGroups.length, 2);
  assert.equal(partitioned.staleGroups.length, 0);
});

test("sidebar and project board expand older threads progressively in steps of 10 with inline collapse", () => {
  assert.equal(THREAD_EXPAND_STEP, 10);
  const nowSec = 1_794_800_000;
  const nowMs = nowSec * 1000;
  const H = 3600;
  const cwd = "/tmp/customer-issues";
  const profiles = [{ key: "codex:default", provider: "codex", id: "default", label: "Codex" }];

  // Build 4 fresh threads (2 live + 2 recent idle) + 30 stale threads = 34 total (matches screenshot scenario).
  const threads = [
    { id: "codex:default:f-1", provider: "codex", profileId: "default", cwd, title: "近期运行一", updatedAt: nowSec - 10, live: true },
    { id: "codex:default:f-2", provider: "codex", profileId: "default", cwd, title: "近期运行二", updatedAt: nowSec - 20, live: true },
    { id: "codex:default:f-3", provider: "codex", profileId: "default", cwd, title: "近期完成三", updatedAt: nowSec - 1200, live: false },
    { id: "codex:default:f-4", provider: "codex", profileId: "default", cwd, title: "近期完成四", updatedAt: nowSec - 2400, live: false },
    ...Array.from({ length: 30 }, (_, idx) => ({
      id: `codex:default:old-${idx + 1}`,
      provider: "codex",
      profileId: "default",
      cwd,
      title: `较早会话-${idx + 1}`,
      updatedAt: nowSec - (20 + idx) * H,
      live: false,
    })),
  ];
  const groups = buildProjectGroups(threads);

  const countRenderedThreads = (html) => (html.match(/data-thread-id="/g) || []).length;

  // Step 0: only 4 fresh visible, expand button shows "展开 10 条较早会话（剩余 30 条）", no collapse button yet.
  const step0Html = renderSidebarThreadListHtml(groups, { profiles, nowMs });
  assert.equal(countRenderedThreads(step0Html), 4);
  assert.match(step0Html, /data-sidebar-expand-cwd="\/tmp\/customer-issues"[\s\S]*?展开 10 条较早会话（剩余 30 条）/);
  assert.doesNotMatch(step0Html, /data-sidebar-collapse-cwd="\/tmp\/customer-issues"/);

  // Step 1: 4 + 10 = 14 visible, button shows "继续展开 10 条较早会话（剩余 20 条）" + inline collapse button.
  const step1Html = renderSidebarThreadListHtml(groups, {
    profiles,
    nowMs,
    expandedSidebarGroups: new Map([[cwd, 10]]),
  });
  assert.equal(countRenderedThreads(step1Html), 14);
  assert.match(step1Html, /较早会话-10/);
  assert.doesNotMatch(step1Html, /较早会话-11/);
  assert.match(step1Html, /sidebar-more-row/);
  assert.match(step1Html, /继续展开 10 条较早会话（剩余 20 条）/);
  assert.match(step1Html, /data-sidebar-collapse-cwd="\/tmp\/customer-issues"[^>]*>收起<\/button>/);

  // Step 2: 4 + 20 = 24 visible, remaining is 10 (<= 10) -> "展开其余 10 条较早会话" + inline collapse button.
  const step2Html = renderSidebarThreadListHtml(groups, {
    profiles,
    nowMs,
    expandedSidebarGroups: new Map([[cwd, 20]]),
  });
  assert.equal(countRenderedThreads(step2Html), 24);
  assert.match(step2Html, /较早会话-20/);
  assert.doesNotMatch(step2Html, /较早会话-21/);
  assert.match(step2Html, /展开其余 10 条较早会话/);
  assert.match(step2Html, /data-sidebar-collapse-cwd="\/tmp\/customer-issues"[^>]*>收起<\/button>/);

  // Step 3: all 34 visible, expand button gone, full collapse button shown.
  const step3Html = renderSidebarThreadListHtml(groups, {
    profiles,
    nowMs,
    expandedSidebarGroups: new Map([[cwd, 30]]),
  });
  assert.equal(countRenderedThreads(step3Html), 34);
  assert.doesNotMatch(step3Html, /data-sidebar-expand-cwd="\/tmp\/customer-issues"/);
  assert.match(step3Html, /data-sidebar-collapse-cwd="\/tmp\/customer-issues"[\s\S]*?收起较早会话/);

  // Project board card (28 tasks) expands progressively: 4 -> 14 -> 24 -> 28.
  const boardGroups = buildProjectGroups(threads.slice(0, 28));
  const countBoardTasks = (html) => (html.match(/data-board-open-thread="/g) || []).length;

  const board0 = renderProjectBoardHtml({ groups: boardGroups, allGroups: boardGroups, profiles });
  assert.equal(countBoardTasks(board0), 4);
  assert.match(board0, /展开 10 个任务（剩余 24 个）/);
  assert.doesNotMatch(board0, /data-collapse-project-cwd=/);
  assert.match(board0, /data-open-project-window="\/tmp\/customer-issues"/);

  const boardScoped = renderProjectBoardHtml({
    groups: boardGroups,
    allGroups: boardGroups,
    profiles,
    allowOpenProjectWindow: false,
  });
  assert.doesNotMatch(boardScoped, /data-open-project-window=/);

  const sidebarWithWindowBtn = renderSidebarThreadListHtml(boardGroups, { profiles, nowMs });
  assert.match(sidebarWithWindowBtn, /data-open-project-window="\/tmp\/customer-issues"/);
  const sidebarScoped = renderSidebarThreadListHtml(boardGroups, {
    profiles,
    nowMs,
    allowOpenProjectWindow: false,
  });
  assert.doesNotMatch(sidebarScoped, /data-open-project-window=/);
  assert.equal(isSameProjectCwd("/tmp/demo/", "/tmp/demo"), true);
  assert.equal(isSameProjectCwd("C:\\Users\\Alice\\Proj\\", "c:/users/alice/proj"), true);
  assert.equal(isSameProjectCwd("/tmp/a", "/tmp/b"), false);

  const board1 = renderProjectBoardHtml({
    groups: boardGroups,
    allGroups: boardGroups,
    profiles,
    expandedProjects: new Map([[cwd, 10]]),
  });
  assert.equal(countBoardTasks(board1), 14);
  assert.match(board1, /board-expand-tasks-row/);
  assert.match(board1, /继续展开 10 个任务（剩余 14 个）/);
  assert.match(board1, /data-collapse-project-cwd="\/tmp\/customer-issues"/);

  const board2 = renderProjectBoardHtml({
    groups: boardGroups,
    allGroups: boardGroups,
    profiles,
    expandedProjects: new Map([[cwd, 20]]),
  });
  assert.equal(countBoardTasks(board2), 24);
  assert.match(board2, /展开其余 4 个任务/);

  const board3 = renderProjectBoardHtml({
    groups: boardGroups,
    allGroups: boardGroups,
    profiles,
    expandedProjects: new Map([[cwd, 30]]),
  });
  assert.equal(countBoardTasks(board3), 28);
  assert.doesNotMatch(board3, /data-expand-project-cwd=/);
  assert.match(board3, /收起部分任务/);
});

test("image-attachment calculates bytes, scales oversized images cleanly, keeps small PNGs, and enforces batch budgets", () => {
  const rawBuf = Buffer.alloc(1024, 0x42);
  const dataUrl1k = `data:image/png;base64,${rawBuf.toString("base64")}`;
  assert.equal(estimateDataUrlBytes(dataUrl1k), 1024);
  assert.equal(estimateDataUrlBytes(`data:image/jpeg;base64,${Buffer.alloc(1025, 0x41).toString("base64")}`), 1025);

  assert.equal(formatByteSize(512), "512 B");
  assert.equal(formatByteSize(180 * 1024), "180 KB");
  assert.equal(formatByteSize(1.5 * 1024 * 1024), "1.5 MB");

  assert.deepEqual(computeScaledDimensions(1200, 900, 1600), { width: 1200, height: 900, scaled: false });
  assert.deepEqual(computeScaledDimensions(4000, 3000, 1600), { width: 1600, height: 1200, scaled: true });
  assert.deepEqual(computeScaledDimensions(1080, 3200, 1600), { width: 540, height: 1600, scaled: true });

  // Small sharp PNG / SVG passes through untouched; HEIC or large PNG forces canvas JPEG transcoding.
  assert.equal(shouldKeepOriginalImageDataUrl({ mimeType: "image/png", byteLength: 180 * 1024, scaled: false }), true);
  assert.equal(shouldKeepOriginalImageDataUrl({ mimeType: "image/svg+xml", byteLength: 300 * 1024, scaled: false }), true);
  assert.equal(shouldKeepOriginalImageDataUrl({ mimeType: "image/png", byteLength: 180 * 1024, scaled: true }), false);
  assert.equal(shouldKeepOriginalImageDataUrl({ mimeType: "image/png", byteLength: 900 * 1024, scaled: false }), false);
  assert.equal(shouldKeepOriginalImageDataUrl({ mimeType: "image/heic", byteLength: 120 * 1024, scaled: false }), false);

  const okBudget = validateImageBatchBudget(
    [{ byteLength: 400 * 1024 }, { byteLength: 450 * 1024 }],
    400 * 1024,
  );
  assert.equal(okBudget.ok, true);

  const singleTooBig = validateImageBatchBudget([], 1800 * 1024);
  assert.equal(singleTooBig.ok, false);
  assert.match(singleTooBig.message, /单张图片/);

  const totalTooBig = validateImageBatchBudget(
    [{ byteLength: 1200 * 1024 }, { byteLength: 1200 * 1024 }],
    400 * 1024,
  );
  assert.equal(totalTooBig.ok, false);
  assert.match(totalTooBig.message, /总大小超出/);

  const tooMany = validateImageBatchBudget(Array.from({ length: 6 }, () => ({ byteLength: 100 * 1024 })), 100 * 1024);
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.message, /最多附加 6 张/);
});

test("provider-hub summarizes queued images, strips huge base64 from SSE broadcasts, and caps oversized legacy history", () => {
  const bigBase64 = "A".repeat(400_000);
  const bigDataUrl = `data:image/jpeg;base64,${bigBase64}`;

  // summarizeQueuedTurnEntry strips dataUrl without mutating original entry.
  const queueEntry = {
    id: "q-1",
    threadId: "claude:default:t-1",
    createdAt: 1700000000,
    text: "请分析截图",
    images: [{ name: "shot.jpg", dataUrl: bigDataUrl }],
    model: "claude-opus-4-6",
    effort: "medium",
    permissionMode: "turbo",
    goalMode: false,
    position: 1,
  };
  const queueSummary = summarizeQueuedTurnEntry(queueEntry);
  assert.equal(queueSummary.imageCount, 1);
  assert.deepEqual(queueSummary.images, [{ name: "shot.jpg", omitted: true }]);
  assert.equal(queueEntry.images[0].dataUrl, bigDataUrl);

  // sanitizeEventForSse removes large inline base64 across Claude turn_started, Codex notifications, and queued_turn_event.
  const claudeEvt = sanitizeEventForSse("provider_event", {
    type: "turn_started",
    threadId: "claude:default:t-1",
    turn: {
      id: "turn-1",
      items: [{
        type: "userMessage",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: bigBase64 } },
          { type: "text", text: "看图" },
        ],
      }],
    },
  });
  assert.equal(claudeEvt.turn.items[0].content[0].path, "[图片] 附件图片");
  assert.equal(claudeEvt.turn.items[0].content[1].text, "看图");

  const codexEvt = sanitizeEventForSse("provider_event", {
    type: "codex_notification",
    threadId: "codex:default:t-2",
    method: "turn/started",
    params: {
      turn: {
        id: "turn-2",
        items: [{
          type: "userMessage",
          content: [{ type: "image", url: bigDataUrl }, { type: "text", text: "修图" }],
        }],
      },
    },
  });
  assert.equal(codexEvt.params.turn.items[0].content[0].path, "[图片] 附件图片");
  assert.equal(codexEvt.params.turn.items[0].content[1].text, "修图");

  const smallEvt = sanitizeEventForSse("provider_event", {
    type: "stream_delta",
    threadId: "claude:default:t-1",
    kind: "text",
    delta: "hello",
  });
  assert.equal(smallEvt.delta, "hello");

  // acp_tool_update strips large rawOutput/content/rawInput/locations and truncates oversized status.
  const longStatus = `执行详情:${"Z".repeat(900)}`;
  const acpUpdateEvt = sanitizeEventForSse("provider_event", {
    type: "acp_tool_update",
    threadId: "antigravity:desktop:t-acp-1",
    update: {
      sessionUpdate: "tool_call_update",
      toolCallId: "tc-99",
      title: "读取截图文件",
      kind: "read",
      status: longStatus,
      rawOutput: `data:image/png;base64,${"Q".repeat(60_000)}`,
      rawInput: { huge: "W".repeat(50_000) },
      content: [{ type: "image", data: "E".repeat(50_000) }],
      locations: [{ path: "/tmp/a.png" }],
    },
  });
  assert.equal(acpUpdateEvt.update.toolCallId, "tc-99");
  assert.equal(acpUpdateEvt.update.title, "读取截图文件");
  assert.equal(acpUpdateEvt.update.kind, "read");
  assert.ok(acpUpdateEvt.update.status.length <= 601);
  assert.equal(Object.hasOwn(acpUpdateEvt.update, "rawOutput"), false);
  assert.equal(Object.hasOwn(acpUpdateEvt.update, "rawInput"), false);
  assert.equal(Object.hasOwn(acpUpdateEvt.update, "content"), false);
  assert.equal(Object.hasOwn(acpUpdateEvt.update, "locations"), false);

  // Non-userMessage items (mcpToolCall / tool_result) strip base64 images and truncate huge tool outputs, while preserving agentMessage.
  const toolItemEvt = sanitizeEventForSse("provider_event", {
    type: "codex_notification",
    threadId: "codex:default:t-tool",
    method: "item/completed",
    params: {
      item: {
        type: "mcpToolCall",
        id: "mcp-1",
        result: {
          content: [
            { type: "image", source: { type: "base64", media_type: "image/png", data: bigBase64 } },
            { type: "text", text: "X".repeat(40_000) },
          ],
          output: `ok ${"Y".repeat(40_000)}`,
        },
        aggregatedOutput: `log ${"L".repeat(40_000)}`,
      },
    },
  });
  assert.equal(toolItemEvt.params.item.result.content[0].path, "[图片] 附件图片");
  assert.match(toolItemEvt.params.item.result.content[1].text, /已省略/);
  assert.match(toolItemEvt.params.item.result.output, /已省略/);
  assert.match(toolItemEvt.params.item.aggregatedOutput, /已省略/);

  const claudeToolResultEvt = sanitizeEventForSse("provider_event", {
    type: "tool_result",
    threadId: "claude:default:t-tr",
    toolResult: {
      type: "tool_result",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: bigBase64 } },
        { type: "text", text: "R".repeat(40_000) },
      ],
    },
  });
  assert.equal(claudeToolResultEvt.toolResult.content[0].path, "[图片] 附件图片");
  assert.match(claudeToolResultEvt.toolResult.content[1].text, /已省略/);

  // capOversizedThreadInlineImages preserves newest compact images and omits older/oversized ones across both userMessage and tool results.
  const compactDataUrl = `data:image/jpeg;base64,${"B".repeat(300_000)}`;
  const hugeLegacyUrl = `data:image/png;base64,${"C".repeat(2_500_000)}`;
  const toolBigUrl = `data:image/png;base64,${"D".repeat(250_000)}`;
  const rawThread = {
    id: "claude:default:t-hist",
    turns: [
      {
        id: "t-old",
        items: [
          { type: "userMessage", content: [{ type: "image", url: compactDataUrl }] },
          { type: "mcpToolCall", result: { content: [{ type: "image", url: toolBigUrl }] } },
        ],
      },
      {
        id: "t-huge",
        items: [{ type: "userMessage", content: [{ type: "image", url: hugeLegacyUrl }] }],
      },
      {
        id: "t-new",
        items: [{ type: "userMessage", content: [{ type: "image", url: compactDataUrl }] }],
      },
    ],
  };
  const capped = capOversizedThreadInlineImages(rawThread, {
    maxSingleDataUrlChars: 1_000_000,
    maxTotalDataUrlChars: 450_000,
  });
  // Newest compact image stays intact; oversized single image and over-budget older/tool images are omitted.
  assert.equal(capped.turns[2].items[0].content[0].url, compactDataUrl);
  assert.match(capped.turns[1].items[0].content[0].path, /已省略原图/);
  assert.match(capped.turns[0].items[1].result.content[0].path, /已省略原图/);
  assert.match(capped.turns[0].items[0].content[0].path, /已省略原图/);
  // Original thread object was not mutated.
  assert.equal(rawThread.turns[1].items[0].content[0].url, hugeLegacyUrl);
  assert.equal(rawThread.turns[0].items[1].result.content[0].url, toolBigUrl);

  // capOversizedThreadToolOutputs strips JSON-wrapped base64 and huge tool text without touching user/agent messages.
  const jsonWrappedImg = JSON.stringify({
    type: "image",
    source: { type: "base64", data: "E".repeat(60_000) },
  });
  const longAgentText = "Z".repeat(40_000);
  const rawToolThread = {
    id: "claude:default:t-tool-cap",
    turns: [
      {
        id: "t-1",
        items: [
          { type: "userMessage", content: [{ type: "text", text: longAgentText }] },
          { type: "mcpToolCall", tool: "screenshot", result: { content: [{ type: "text", text: jsonWrappedImg }] } },
          { type: "commandExecution", command: "cat big.log", aggregatedOutput: "L".repeat(50_000) },
          { type: "agentMessage", text: longAgentText },
        ],
      },
    ],
  };
  const cappedTools = capOversizedThreadToolOutputs(rawToolThread, { maxToolTextChars: 1000 });
  assert.equal(cappedTools.turns[0].items[0].content[0].text, longAgentText);
  assert.equal(cappedTools.turns[0].items[3].text, longAgentText);
  assert.match(cappedTools.turns[0].items[1].result.content[0].text, /Base64已省略/);
  assert.ok(cappedTools.turns[0].items[1].result.content[0].text.length < 1000);
  assert.match(cappedTools.turns[0].items[2].aggregatedOutput, /已省略/);
  assert.ok(cappedTools.turns[0].items[2].aggregatedOutput.length < 1100);
  assert.equal(rawToolThread.turns[0].items[1].result.content[0].text, jsonWrappedImg);
});

test("renderQueuedTurnsPanelHtml renders multi-line items, source tags, media badges, readonly native hints, and collapsible header", () => {
  assert.equal(renderQueuedTurnsPanelHtml([]), "");

  const items = [
    {
      id: "native-1",
      position: 1,
      text: "第一行桌面端指令\n第二行详细补充说明",
      source: "antigravity-desktop",
      sourceLabel: "桌面端队列",
      imageCount: 2,
      goalMode: false,
      canCancel: false,
    },
    {
      id: "ctrl-2",
      position: 2,
      text: "等待前一条完成再自动执行",
      source: "control",
      sourceLabel: "控制端队列",
      imageCount: 0,
      goalMode: true,
      canCancel: true,
    },
  ];

  const expandedHtml = renderQueuedTurnsPanelHtml(items, { collapsed: false });
  assert.match(expandedHtml, /排队消息/);
  assert.match(expandedHtml, /queued-panel-count">2</);
  assert.match(expandedHtml, /当前轮次完成后自动发送/);
  assert.match(expandedHtml, /data-queue-toggle="1"/);
  assert.match(expandedHtml, /桌面端队列/);
  assert.match(expandedHtml, /ac-icon-image[^>]*>[\s\S]*?<\/svg>\s*2/);
  assert.match(expandedHtml, />只读</);
  assert.doesNotMatch(expandedHtml, /data-queue-steer="native-1"/);
  assert.doesNotMatch(expandedHtml, /data-queue-edit="native-1"/);
  assert.doesNotMatch(expandedHtml, /data-queue-cancel="native-1"/);
  assert.match(expandedHtml, /控制端队列/);
  assert.match(expandedHtml, /ac-icon-target[^>]*>[\s\S]*?<\/svg>\s*Goal/);
  assert.match(expandedHtml, /data-queue-steer="ctrl-2"[\s\S]*?ac-icon-steer[^>]*>[\s\S]*?<\/svg>\s*<span>引导<\/span>/);
  assert.match(expandedHtml, /data-queue-edit="ctrl-2"/);
  assert.match(expandedHtml, /data-queue-cancel="ctrl-2"/);

  const collapsedHtml = renderQueuedTurnsPanelHtml(items, { collapsed: true });
  assert.match(collapsedHtml, /▾ 展开/);
  assert.doesNotMatch(collapsedHtml, /queued-panel-list/);
});

test("sidebar, project board, and task strip surface 排队 N micro-badges and retain stale queued threads", () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const profiles = [{ id: "desktop", provider: "antigravity", label: "Antigravity 桌面" }];
  const cwd = "/workspace/demo/agent-control";
  const threads = [
    {
      id: "antigravity:desktop:recent-1",
      provider: "antigravity",
      profileId: "desktop",
      profileLabel: "Antigravity 桌面",
      cwd,
      title: "活跃排查会话",
      preview: "活跃排查会话",
      live: true,
      queuedCount: 0,
      updatedAt: nowSec - 30,
    },
    {
      id: "antigravity:desktop:stale-queued-2",
      provider: "antigravity",
      profileId: "desktop",
      profileLabel: "Antigravity 桌面",
      cwd,
      title: "十天前但仍挂着排队的会话",
      preview: "十天前但仍挂着排队的会话",
      live: false,
      queuedCount: 2,
      updatedAt: nowSec - 86400 * 10,
    },
  ];

  const groups = buildProjectGroups(threads, {
    projectsMeta: { [cwd]: { pinned: true } },
  });
  const sidebarHtml = renderSidebarThreadListHtml(groups, {
    activeThreadId: "antigravity:desktop:recent-1",
    profiles,
    nowMs: nowSec * 1000,
    staleThreadAgeSec: 86400 * 2,
  });
  assert.match(sidebarHtml, /十天前但仍挂着排队的会话/);
  assert.match(sidebarHtml, /thread-queued-pill"[^>]*>排队 2</);

  const boardHtml = renderProjectBoardHtml({
    groups,
    activeThreadId: "antigravity:desktop:recent-1",
  });
  assert.match(boardHtml, /board-status-pill is-queued"[^>]*>排队 2</);

  const stripHtml = renderProjectTaskStripHtml({
    projectGroup: groups[0],
    activeThreadId: "antigravity:desktop:recent-1",
  });
  assert.match(stripHtml, /thread-queued-pill"[^>]*>排队 2</);
});

test("Grok visual metadata, quota strip formatting, and profile ranking integrate cleanly", () => {
  const grokMeta = providerVisualMeta("grok");
  assert.equal(grokMeta.id, "grok");
  assert.equal(grokMeta.glyph, "");
  assert.match(grokMeta.iconSvg, /<svg[^>]*is-grok/);
  assert.equal(grokMeta.tone, "grok");
  assert.equal(providerDisplayName("grok"), "Grok");

  assert.equal(compactModelBadgeLabel("grok-4.7-build-fast"), "Grok 4.7F");
  assert.equal(compactModelBadgeLabel("grok-4.7"), "Grok 4.7");

  const grokChip = compactThreadSourceChip({
    provider: "grok",
    profileId: "cockpit-0957",
    profileLabel: "Grok · work",
  });
  assert.equal(grokChip?.tone, "grok");
  assert.equal(grokChip?.text, "work");

  const nowSec = 1_795_000_000;
  assert.equal(formatQuotaResetRelative(nowSec + 1800, nowSec), "30分后重置");
  assert.equal(formatQuotaResetRelative(nowSec + 7200, nowSec), "2小时后重置");
  assert.equal(formatQuotaResetRelative(nowSec - 10, nowSec), "");

  const profiles = [
    {
      id: "default",
      key: "grok:default",
      provider: "grok",
      label: "Grok 默认",
      installed: true,
      authenticated: false,
      quota: { statusTone: "unknown", summaryText: "仅历史" },
    },
    {
      id: "cockpit-1",
      key: "grok:cockpit-1",
      provider: "grok",
      label: "Grok · work",
      installed: true,
      authenticated: true,
      quota: {
        planLabel: "SuperGrok",
        accountLabel: "grok@example.com",
        statusTone: "ok",
        summaryText: "余 84%",
        primary: { id: "grok-billing", label: "订阅额度", remainingPercent: 84, resetsAt: nowSec + 5400 },
        buckets: [
          { id: "grok-billing", label: "订阅额度", remainingPercent: 84, resetsAt: nowSec + 5400 },
          { id: "product-build", label: "Grok Build", remainingPercent: 87, resetsAt: null },
        ],
      },
    },
    {
      id: "default",
      key: "claude:default",
      provider: "claude",
      label: "Claude 默认",
      installed: true,
      quota: {
        planLabel: "Pro",
        statusTone: "exhausted",
        summaryText: "5h 耗尽",
        primary: { id: "five_hour", label: "5h 窗口", remainingPercent: 0, resetsAt: nowSec + 2400 },
        buckets: [{ id: "five_hour", label: "5h 窗口", remainingPercent: 0, resetsAt: nowSec + 2400 }],
      },
    },
  ];

  const sortedGrok = sortProfilesByAvailability(profiles.filter((p) => p.provider === "grok"));
  assert.equal(sortedGrok[0].id, "cockpit-1");
  assert.match(profileOptionLabel(profiles[1]), /余 84%/);

  const compactHtml = renderQuotaOverviewHtml(profiles, { expanded: false, nowSec });
  assert.match(compactHtml, /余 84%/);
  assert.match(compactHtml, /5h 耗尽/);
  // Unauthenticated secondary Grok history profile hidden in compact strip when authenticated profile exists
  assert.doesNotMatch(compactHtml, /Grok 默认/);

  const expandedHtml = renderQuotaOverviewHtml(profiles, { expanded: true, nowSec });
  assert.match(expandedHtml, /SuperGrok/);
  assert.match(expandedHtml, /Grok Build/);
  assert.match(expandedHtml, /40分后重置/);
});

test("zero pictographic UI emojis, hidden redundant topbar chrome, and overflow telemetry capsule", async () => {
  const indexHtml = await readFile(fileURLToPath(new URL("../public/index.html", import.meta.url)), "utf8");
  const strippedHtml = indexHtml.replace(/<script[\s\S]*?<\/script>/g, "");
  assert.equal(/\p{Extended_Pictographic}/u.test(strippedHtml), false, "index.html should not contain UI emojis");
  assert.match(indexHtml, /id="activeProjectCrumb"[^>]*hidden/);
  assert.match(indexHtml, /id="telemetryTopbarBtn"[^>]*hidden/);
  assert.match(indexHtml, /id="composerVoiceBtn"/);

  const profiles = [
    {
      id: "default",
      key: "claude:default",
      provider: "claude",
      label: "Claude 默认",
      installed: true,
      authenticated: true,
      quota: {
        statusTone: "ok",
        summaryText: "余 90%",
        primary: { id: "five_hour", label: "5h", remainingPercent: 90 },
        buckets: [{ id: "five_hour", label: "5h", remainingPercent: 90 }],
      },
    },
    {
      id: "codex",
      key: "codex:codex",
      provider: "codex",
      label: "Codex 备用",
      installed: true,
      authenticated: true,
      quota: {
        statusTone: "ok",
        summaryText: "余 80%",
        primary: { id: "five_hour", label: "5h", remainingPercent: 80 },
        buckets: [{ id: "five_hour", label: "5h", remainingPercent: 80 }],
      },
    },
  ];
  const nowSec = Math.floor(Date.now() / 1000);
  const telemetry = {
    updatedAt: nowSec,
    byProvider: {
      claude: { provider: "claude", runningCount: 0, queuedCount: 0, tokensPerSec: 0 },
      codex: { provider: "codex", runningCount: 2, queuedCount: 1, tokensPerSec: 12 },
    },
    byProfile: {
      "claude:default": { key: "claude:default", runningCount: 0, queuedCount: 0, tokensPerSec: 0 },
      "codex:codex": { key: "codex:codex", runningCount: 2, queuedCount: 1, tokensPerSec: 12 },
    },
  };
  const compactBarHtml = renderAgentTelemetryBarHtml(profiles, telemetry, {
    visibleKeys: ["claude:default"],
    activeProvider: "claude",
    activeProfileId: "default",
    nowSec,
  });
  assert.match(compactBarHtml, /telemetry-overflow-pill[\s\S]*?\+2 运行 · \+1 排队</);

  const renderedChunks = [
    compactBarHtml,
    renderQuotaOverviewHtml(profiles, { expanded: true, nowSec }),
    renderQueuedTurnsPanelHtml([{ id: "q1", position: 1, text: "跑单测", source: "control", imageCount: 1, goalMode: true }]),
  ];
  for (const chunk of renderedChunks) {
    assert.equal(/\p{Extended_Pictographic}/u.test(chunk), false, `rendered UI contains emoji: ${chunk.slice(0, 120)}`);
    assert.match(chunk, /<svg class="ac-icon/);
  }
});

test("adaptive VAD adapts threshold in quiet environment", () => {
  const vad = createVadTurnDetector({
    sampleRate: 16000,
    preRollMs: 120,
    silenceMs: 300,
    minSpeechMs: 150,
    rmsThreshold: 0.024,
    adaptive: true,
  });
  const baseThreshold = vad.threshold;
  const quiet = new Int16Array(1600);
  for (let i = 0; i < 12; i += 1) {
    assert.equal(vad.pushSamples(quiet, 0.002).type, "listening");
  }
  assert.ok(vad.noiseFloor < 0.004);
  assert.ok(vad.threshold <= baseThreshold);

  const softSpeech = new Int16Array(1600).fill(2200);
  assert.equal(vad.pushSamples(softSpeech, 0.025).type, "speech_start");
  assert.equal(vad.pushSamples(softSpeech, 0.025).type, "recording");
  assert.equal(vad.pushSamples(quiet, 0.001).type, "recording");
  assert.equal(vad.pushSamples(quiet, 0.001).type, "recording");
  assert.equal(vad.pushSamples(quiet, 0.001).type, "utterance");


});

test("local Whisper ASR worker endpoint /api/voice/transcribe executes without tokens", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-local-voice-"));
  let srv = null;
  t.after(async () => {
    await srv?.close().catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });
  const dataDir = resolve(root, "data");
  const agyCli = resolve(root, "agy-cli");
  const codexHome = resolve(root, "codex");
  const claudeHome = resolve(root, "claude");
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(agyCli, { recursive: true }),
    mkdir(codexHome, { recursive: true }),
    mkdir(claudeHome, { recursive: true }),
  ]);

  const env = {
    ...process.env,
    CODEX_BIN: MOCK_CODEX_BIN,
    CLAUDE_BIN: MOCK_CLAUDE_BIN,
    AGY_BIN: MOCK_AGY_BIN,
    EDGE_TTS_BIN: MOCK_EDGE_TTS_BIN,
    VOICE_ASR_BIN: MOCK_VOICE_ASR_BIN,
    MOCK_VOICE_ASR_TEXT: "让 示例商城后台 跑一下检查",
    AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: codexHome }]),
    AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: claudeHome }]),
    AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "cli", label: "Antigravity CLI", home: agyCli, profileType: "cli" }]),
  };

  srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    dataDir,
    env,
  });
  await srv.start();

  const wavBase64 = uint8ArrayToBase64(encodePcm16SamplesToWav(new Int16Array(1600), 16000));

  // Missing audio returns 400.
  const emptyAsrRes = await fetch(`${srv.url}/api/voice/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(emptyAsrRes.status, 400);

  // /api/voice/transcribe returns local ASR text.
  const asrRes = await fetch(`${srv.url}/api/voice/transcribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioBase64: wavBase64, audioMimeType: "audio/wav" }),
  });
  assert.equal(asrRes.status, 200);
  const asrJson = await asrRes.json();
  assert.equal(asrJson.ok, true);
  assert.equal(asrJson.text, "让 示例商城后台 跑一下检查");
  assert.equal(asrJson.engine, "mock-whisper");
});

test("telemetry toggle stops propagation across re-render and places desktop compact slot inside topbar-actions", async () => {
  const [appJs, indexHtml, appCss] = await Promise.all([
    readFile(fileURLToPath(new URL("../public/app.js", import.meta.url)), "utf8"),
    readFile(fileURLToPath(new URL("../public/index.html", import.meta.url)), "utf8"),
    readFile(fileURLToPath(new URL("../public/app.css", import.meta.url)), "utf8"),
  ]);

  assert.match(
    appJs,
    /if\s*\(\s*e\.target\.closest\(\s*"\[data-telemetry-toggle\]"\s*\)\s*\)\s*\{\s*e\.stopPropagation\(\)/,
    "telemetry toggle must stopPropagation before innerHTML re-render detaches clicked target",
  );
  assert.match(appJs, /\$\("topbarTelemetrySlot"\)\?\.addEventListener\("click",\s*handleTelemetryBarClick\)/);
  assert.match(appJs, /\$\("agentTelemetryBar"\)\?\.addEventListener\("click",\s*handleTelemetryBarClick\)/);

  const actionsIdx = indexHtml.indexOf('class="topbar-actions"');
  const slotIdx = indexHtml.indexOf('id="topbarTelemetrySlot"');
  const boardBtnIdx = indexHtml.indexOf('id="boardToggleBtn"');
  assert.ok(actionsIdx > 0 && slotIdx > actionsIdx);
  assert.ok(boardBtnIdx > indexHtml.indexOf('id="sidebar"') && boardBtnIdx < indexHtml.indexOf('</aside>'));
  assert.equal((indexHtml.match(/id="boardToggleBtn"/g) || []).length, 1);
  assert.match(indexHtml, /class="sidebar-actions">[\s\S]*?id="newThreadBtn"[\s\S]*?id="boardToggleBtn"[\s\S]*?id="remoteModalBtn"/);
  assert.match(indexHtml, /id="boardToggleBtn"[^>]*class="[^"]*sidebar-view-btn/);
  assert.match(appCss, /\.local-apps-strip\s*\{[^}]*flex-direction:\s*row;/);
  assert.match(appCss, /\.local-app-open-mark\s*\{/);
  assert.doesNotMatch(indexHtml, /id="topbarLocalAppsBox"/);
  const localAppsStripCode = appJs.match(/const strip = \$\("localAppsStrip"\);[\s\S]*?const remoteSec = \$\("remoteLocalAppsSection"\);/)?.[0] || "";
  assert.ok(localAppsStripCode);
  assert.doesNotMatch(localAppsStripCode, /data-icon="film"/);
  assert.match(localAppsStripCode, /class="local-app-open-mark"/);
  assert.match(appJs, /\$\("boardToggleBtn"\)\.addEventListener\("click",\s*\(\) => openProjectBoardView\(\)\)/);

  assert.match(appCss, /@media\s*\(min-width:\s*961px\)[\s\S]*?\.agent-telemetry-bar:not\(\.is-expanded\)\s*\{\s*display:\s*none\s*!important;/);
  assert.match(appCss, /@media\s*\(max-width:\s*960px\)[\s\S]*?\.topbar-telemetry-slot\s*\{\s*display:\s*none\s*!important;/);
});

test("spawn ENOENT is never treated as recoverable and failed turn reload preserves status banner", async () => {
  assert.equal(isRecoverableToolErrorText("spawn /opt/homebrew/bin/claude ENOENT"), false);
  assert.equal(isRecoverableToolErrorText({ message: "spawn /usr/local/bin/claude ENOENT", syscall: "spawn /usr/local/bin/claude" }), false);
  assert.equal(isRecoverableToolErrorText("ENOENT: no such file or directory, open '/tmp/foo.txt'"), true);

  const appJs = await readFile(fileURLToPath(new URL("../public/app.js", import.meta.url)), "utf8");
  assert.match(appJs, /async function selectThread\(compositeId,\s*\{\s*focusScroll = true,\s*preserveStatus = false,\s*newThreadCwd = null\s*\}\s*=\s*\{\}\)/);
  assert.match(appJs, /preserveStatus:\s*isFailed/);
  assert.match(appJs, /reloadActiveThreadAfterTurnCompletion\(\{[\s\S]*?turnId:\s*evt\.turnId \|\| ""/);
});

test("image-only user turns strip Antigravity XML wrappers and single-profile chips avoid redundant desktop labels", async () => {
  const html = renderTurnHtml({
    id: "turn-img-only",
    status: "completed",
    items: [
      {
        type: "userMessage",
        id: "user-img-1",
        content: [
          { type: "image", url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==" },
          {
            type: "text",
            text: "/tmp/uploaded_media_1.jpg\n\n<USER_REQUEST>\n\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nuploaded 1 image\n</ADDITIONAL_METADATA>\n<USER_SETTINGS_CHANGE>\nModel Selection changed\n</USER_SETTINGS_CHANGE>",
          },
        ],
      },
      {
        type: "agentMessage",
        id: "agent-img-1",
        text: "收到截图，已定位问题。",
      },
    ],
  }, { threadKey: "antigravity:desktop:t1" });

  assert.match(html, /class="msg-images"/);
  assert.doesNotMatch(html, /USER_REQUEST|ADDITIONAL_METADATA|USER_SETTINGS_CHANGE/);
  assert.match(html, /收到截图，已定位问题。/);

  const singleAgyProfiles = [
    { provider: "antigravity", id: "desktop", label: "Antigravity", installed: true },
    { provider: "codex", id: "default", label: "Codex", installed: true },
  ];
  const chip = compactThreadSourceChip(
    { provider: "antigravity", profileId: "desktop", profileLabel: "Antigravity" },
    { providerFilter: "all", profiles: singleAgyProfiles },
  );
  assert.equal(chip, null);
  assert.equal(compactProfileChipText({ provider: "antigravity", id: "desktop", label: "Antigravity" }), "桌面");

  const appJs = await readFile(fileURLToPath(new URL("../public/app.js", import.meta.url)), "utf8");
  assert.match(appJs, /function scheduleSseReconnect\(\)/);
  assert.match(appJs, /let pendingReloadCompositeId = "";/);
  assert.match(appJs, /const isBusyConflict = errStatus === 409/);
  assert.match(appJs, /function activeThreadLastTurnHasFinalReply\(thread\)/);
});

test("apiGet ETag cache reuses 304 payloads safely and versioned static assets use private no-cache with 304", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-ui-etag-"));
  const dataDir = resolve(root, "data");
  const codexHome = resolve(root, "codex");
  await Promise.all([mkdir(dataDir, { recursive: true }), mkdir(codexHome, { recursive: true })]);
  clearApiEtagCache();
  t.after(async () => {
    clearApiEtagCache();
    await rm(root, { recursive: true, force: true }).catch(() => {});
  });

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    dataDir,
    env: {
      ...process.env,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: codexHome }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: "[]",
      AGENT_CONTROL_AGY_APP_DATA_DIRS: "[]",
      AGENT_CONTROL_GROK_HOMES: "[]",
    },
  });
  await srv.start();
  t.after(() => srv.close());

  const first = await apiGet(`${srv.url}/api/projects/meta`);
  assert.deepEqual(first.projectsMeta, {});
  first.projectsMeta.mutated = true;

  const second = await apiGet(`${srv.url}/api/projects/meta`);
  assert.deepEqual(second.projectsMeta, {});

  await fetch(`${srv.url}/api/project/meta`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd: "/tmp/proj-etag", pinned: true, alias: "测试别名" }),
  });

  const third = await apiGet(`${srv.url}/api/projects/meta`);
  assert.equal(third.projectsMeta?.["/tmp/proj-etag"]?.alias, "测试别名");

  const unversionedRes = await fetch(`${srv.url}/app.js`);
  assert.equal(unversionedRes.status, 200);
  assert.equal(unversionedRes.headers.get("cache-control"), "no-store");

  const versionedRes = await fetch(`${srv.url}/app.js?v=20261116a`);
  assert.equal(versionedRes.status, 200);
  assert.equal(versionedRes.headers.get("cache-control"), "private, no-cache");
  const versionedEtag = versionedRes.headers.get("etag");
  assert.ok(versionedEtag);

  const versioned304 = await fetch(`${srv.url}/app.js?v=20261116a`, {
    headers: { "If-None-Match": versionedEtag },
  });
  assert.equal(versioned304.status, 304);
  assert.equal((await versioned304.text()).length, 0);
});

test("project and thread batch selection renders tristate controls, idle picker, and mounts cleanly in UI", async () => {
  const nowSec = Math.floor(Date.now() / 1000);
  const groups = buildProjectGroups([
    { id: "codex:default:t1", provider: "codex", profileId: "default", cwd: "/tmp/proj-a", title: "子代理任务1", updatedAt: nowSec - 10, live: false },
    { id: "codex:default:t2", provider: "codex", profileId: "default", cwd: "/tmp/proj-a", title: "运行中主任务", updatedAt: nowSec - 5, live: true },
    { id: "claude:default:t3", provider: "claude", profileId: "default", cwd: "/tmp/proj-b", title: "已完结任务3", updatedAt: nowSec - 20, live: false },
  ]);

  assert.deepEqual(computeProjectGroupSelectionState(groups[0], new Set()), {
    total: 2,
    selectedCount: 0,
    checked: false,
    partial: false,
  });
  assert.deepEqual(computeProjectGroupSelectionState(groups[0], new Set(["codex:default:t1"])), {
    total: 2,
    selectedCount: 1,
    checked: false,
    partial: true,
  });
  assert.deepEqual(computeProjectGroupSelectionState(groups[1], new Set(["claude:default:t3"])), {
    total: 1,
    selectedCount: 1,
    checked: true,
    partial: false,
  });

  const normalSidebar = renderSidebarThreadListHtml(groups, { nowMs: nowSec * 1000, autoFoldProjects: false });
  assert.doesNotMatch(normalSidebar, /class="batch-check/);

  const selectedSet = new Set(["codex:default:t1", "claude:default:t3"]);
  const batchSidebar = renderSidebarThreadListHtml(groups, {
    nowMs: nowSec * 1000,
    autoFoldProjects: false,
    selectionMode: true,
    selectedThreadIds: selectedSet,
  });
  assert.match(batchSidebar, /project-group[^"]*is-batch-mode is-batch-partial/);
  assert.match(batchSidebar, /project-group[^"]*is-batch-mode is-batch-checked/);
  assert.match(batchSidebar, /data-batch-fold-cwd="\/tmp\/proj-a"/);
  assert.match(batchSidebar, /thread-item[^"]*is-batch-checked[^"]*" data-thread-id="codex:default:t1" aria-pressed="true"/);

  const batchBoard = renderProjectBoardHtml({
    groups,
    allGroups: groups,
    selectionMode: true,
    selectedThreadIds: selectedSet,
  });
  assert.match(batchBoard, /data-board-action="toggle-batch-select">[\s\S]*?退出多选/);
  assert.match(batchBoard, /data-batch-project-cwd="\/tmp\/proj-a"/);
  assert.match(batchBoard, /board-batch-ratio">已选 1\/2</);
  assert.match(batchBoard, /board-task-row[^"]*is-batch-checked[^"]*"[\s\S]*?data-board-open-thread="codex:default:t1"/);

  const archiveBar = renderBatchActionBarHtml({
    selectedCount: 2,
    totalVisibleCount: 3,
    idleVisibleCount: 2,
    archivedView: false,
  });
  assert.equal(/\p{Extended_Pictographic}/u.test(archiveBar), false);
  assert.match(archiveBar, /已选 <strong>2<\/strong> 项/);
  assert.match(archiveBar, /data-batch-action="select-idle"[^>]*>选空闲 \(2\)</);
  assert.match(archiveBar, /data-batch-action="submit-archive"[^>]*>[\s\S]*?归档 \(2\)/);

  const restoreBar = renderBatchActionBarHtml({
    selectedCount: 2,
    totalVisibleCount: 2,
    idleVisibleCount: 0,
    archivedView: true,
  });
  assert.doesNotMatch(restoreBar, /data-batch-action="select-idle"/);
  assert.match(restoreBar, /data-batch-action="submit-archive"[^>]*>[\s\S]*?恢复 \(2\)/);

  const indexHtml = await readFile(fileURLToPath(new URL("../public/index.html", import.meta.url)), "utf8");
  assert.match(indexHtml, /<div class="sidebar-filter-row">[\s\S]*?id="providerTabs"[\s\S]*?id="sidebarBatchSelectBtn"[\s\S]*?<\/div>/);
  assert.doesNotMatch(indexHtml, /id="profileFilter"|id="threadSearch"|id="archivedToggle"|class="sidebar-filters"/);
  assert.match(indexHtml, /id="sidebarBatchSelectBtn"/);
  assert.match(indexHtml, /id="sidebarBatchBar"/);
  assert.match(indexHtml, /id="boardBatchBar"/);
  assert.match(indexHtml, /id="imagePreviewModal"/);
  assert.match(indexHtml, /id="imagePreviewLoadRawBtn"/);
  assert.match(indexHtml, /id="filePreviewModal"/);
  const appJs = await readFile(fileURLToPath(new URL("../public/app.js", import.meta.url)), "utf8");
  assert.doesNotMatch(appJs, /\$\(["'](?:profileFilter|threadSearch|archivedToggle)["']\)/);
  assert.match(appJs, /function bindLongPressMultiSelect\(/);
  assert.match(appJs, /api\/threads\/archive/);
  assert.match(appJs, /function openImagePreviewModal\(/);
  assert.match(appJs, /function openFilePreviewModal\(/);
});

test("renderTurnHtml and renderMarkdown format Codex image tags, Files mentioned headers, question replies, and local skill links cleanly", () => {
  const imgTurnHtml = renderTurnHtml({
    id: "turn-codex-img",
    status: "completed",
    items: [
      {
        type: "userMessage",
        id: "u-img",
        content: [
          {
            type: "text",
            text: '<image name=[Image #1] path="demo-studio/assets/hero.png">\n</image>\n<image name=[Image #2] path="demo-studio/assets/npc.png">\n</image>\n使用 [$demo-image-gen](/Users/demo/.agents/skills/demo-image-gen/SKILL.md) 参考 [规范文档](/Users/demo/docs/spec.md) 生成分镜。',
          },
        ],
      },
    ],
  }, {
    agentLabel: "Codex",
    threadId: "codex:codex:01a1e255-c9fe-7241-afc3-b4e9904f7bc3",
  });

  assert.doesNotMatch(imgTurnHtml, /&lt;image|&lt;\/image/);
  assert.match(imgTurnHtml, /class="msg-images"/);
  assert.match(imgTurnHtml, /class="msg-image" src="\.\/api\/thread\/image\?threadId=codex%3Acodex%3A01a1e255-c9fe-7241-afc3-b4e9904f7bc3&amp;path=demo-studio%2Fassets%2Fhero\.png&amp;w=480&amp;q=68"/);
  assert.match(imgTurnHtml, /data-preview-raw="\.\/api\/thread\/image\?threadId=codex%3Acodex%3A01a1e255-c9fe-7241-afc3-b4e9904f7bc3&amp;path=demo-studio%2Fassets%2Fhero\.png&amp;raw=1"/);
  assert.match(imgTurnHtml, /hero\.png/);
  assert.match(imgTurnHtml, /npc\.png/);
  assert.match(imgTurnHtml, /class="md-skill-chip"[^>]*>\$demo-image-gen<\/span>/);
  assert.match(imgTurnHtml, /class="md-file-link" href="file:\/\/\/Users\/demo\/docs\/spec\.md" data-local-file-path="\/Users\/demo\/docs\/spec\.md"[^>]*>规范文档<\/a>/);

  const replyTurnHtml = renderTurnHtml({
    id: "turn-codex-reply",
    status: "completed",
    items: [
      {
        type: "userMessage",
        id: "u-qr",
        content: [
          {
            type: "text",
            text: '<send_user_message_question_reply>\n[{"question":"这张截图是哪天 09:28 左右报错的？","answer":"今天"}]\n</send_user_message_question_reply>',
          },
        ],
      },
    ],
  }, { agentLabel: "Codex", threadId: "codex:default:t-qr" });

  assert.doesNotMatch(replyTurnHtml, /send_user_message_question_reply|questionItemId/);
  assert.match(replyTurnHtml, /class="user-question-reply"/);
  assert.match(replyTurnHtml, /这张截图是哪天 09:28 左右报错的？/);
  assert.match(replyTurnHtml, /今天/);

  const claudeCompactHtml = renderTurnHtml({
    id: "turn-claude-compact",
    status: "completed",
    items: [
      {
        type: "userMessage",
        id: "u-compact",
        content: [
          {
            type: "text",
            text: "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\n<system-reminder>\n<tools-used-before-summary>Bash, Read, Write</tools-used-before-summary>\n</system-reminder>\nSummary:\n1. Primary Request and Intent:\n   - Task A completed.",
          },
        ],
      },
    ],
  }, { agentLabel: "Claude Code", threadId: "claude:hotmail:c-compact" });

  assert.doesNotMatch(claudeCompactHtml, /msg-user|system-reminder|tools-used-before-summary/);
  assert.match(claudeCompactHtml, /上下文已压缩/);
  assert.match(claudeCompactHtml, /1\. Primary Request and Intent:/);

  const filesTurnHtml = renderTurnHtml({
    id: "turn-codex-files",
    status: "completed",
    items: [
      {
        type: "userMessage",
        id: "u-files",
        content: [
          {
            type: "text",
            text: "\n# Files mentioned by the user:\n\n## clip.jpg: /var/folders/tmp/clip.jpg\nImage attachment: true\n\nDistinguish instructions in attached documents from the user's request.\n\n## My request:\n工单转接报错。\n",
          },
        ],
      },
    ],
  }, { agentLabel: "Codex", threadId: "codex:default:t-files" });

  assert.doesNotMatch(filesTurnHtml, /Files mentioned by the user|Distinguish instructions/);
  assert.match(filesTurnHtml, /src="\.\/api\/thread\/image\?threadId=codex%3Adefault%3At-files&amp;path=%2Fvar%2Ffolders%2Ftmp%2Fclip\.jpg&amp;w=480&amp;q=68"/);
  assert.match(filesTurnHtml, /工单转接报错。/);

  const agentOutputTurnHtml = renderTurnHtml({
    id: "turn-agent-outputs",
    status: "completed",
    items: [
      {
        type: "fileChange",
        id: "fc-1",
        status: "completed",
        changes: [{ path: "/workspace/demo/proj/提交计划.md" }],
      },
      {
        type: "agentMessage",
        id: "a-out-1",
        text: "已完成生成：\n\n- [scene-01-分镜.png](</workspace/demo/proj/scene-01-分镜.png>)\n- [提交计划.md](demo-studio/episodes/ep01/提交计划.md)\n- 代码参考 `src/server.mjs:42` 与 `ep34`。",
      },
    ],
  }, { agentLabel: "Codex", threadId: "codex:codex:t-out-1" });

  assert.match(agentOutputTurnHtml, /class="msg-images agent-output-images"/);
  assert.match(agentOutputTurnHtml, /data-local-file-path="demo-studio\/episodes\/ep01\/提交计划\.md"/);
  assert.match(agentOutputTurnHtml, /class="md-code-file" data-local-file-path="src\/server\.mjs" data-local-file-line="42"/);
  assert.match(agentOutputTurnHtml, /<code>ep34<\/code>/);
  assert.match(agentOutputTurnHtml, /src="\.\/api\/thread\/image\?threadId=codex%3Acodex%3At-out-1&amp;path=%2Fworkspace%2Fdemo%2Fproj%2Fscene-01-%E5%88%86%E9%95%9C\.png&amp;w=480&amp;q=68"/);

  assert.match(renderMarkdown("查看 [脚本](file:///workspace/demo/a.js)"), /class="md-file-link"/);

  // Negative cache skips re-emitting <img> tags for thread images that previously returned 404.
  clearFailedThreadImages();
  try {
    const missingSrc = "./api/thread/image?threadId=codex%3Acodex%3At-out-1&path=missing-icon128.png&w=480&q=68";
    assert.equal(isThreadImageFailed(missingSrc), false);
    markThreadImageFailed("https://example.invalid/i/abc/api/thread/image?threadId=codex%3Acodex%3At-out-1&path=missing-icon128.png&w=480&q=68");
    markThreadImageFailed("./api/thread/image?threadId=codex%3Acodex%3At-out-1&path=missing-inline.png&w=960&q=70");
    markThreadImageFailed("./api/thread/image?threadId=codex%3Acodex%3At-out-1&path=missing-user.png&w=480&q=68");
    assert.equal(isThreadImageFailed(missingSrc), true);
    assert.equal(isThreadImageFailed("./api/thread/image?threadId=codex%3Acodex%3At-out-1&path=missing-icon128.png&w=960&q=70"), true);

    const brokenTurnHtml = renderTurnHtml({
      id: "turn-broken-img",
      status: "completed",
      items: [
        {
          type: "userMessage",
          id: "u-broken-1",
          content: [{ type: "text", text: '<image name=[Image #1] path="missing-user.png">\n</image>\n看图' }],
        },
        {
          type: "agentMessage",
          id: "a-broken-1",
          text: "缺失缩略图 `missing-icon128.png` 以及 内联![图标](missing-inline.png)",
        },
      ],
    }, { agentLabel: "Codex", threadId: "codex:codex:t-out-1" });
    assert.doesNotMatch(brokenTurnHtml, /<img[^>]+(?:missing-icon128|missing-inline|missing-user)\.png/);
    assert.match(brokenTurnHtml, /class="msg-file-chip"[^>]*>[\s\S]*?missing-user\.png/);
    assert.match(brokenTurnHtml, /class="msg-file-chip"[^>]*>[\s\S]*?missing-icon128\.png/);
    assert.match(brokenTurnHtml, /class="md-file-link"[^>]*missing-inline\.png/);
  } finally {
    clearFailedThreadImages();
  }
});

test("renderTurnHtml, cleanStreamingAgentText, and markdown bare URLs handle heartbeats, pasted files, ambient context, and fullwidth punctuation", async () => {
  const {
    cleanStreamingAgentText,
    dedupeAdjacentTurns,
    renderMarkdown,
    renderTurnHtml,
  } = await import("../public/markdown.js");

  // 1. Bare URL stops cleanly before CJK fullwidth comma/text and Markdown emphasis delimiters
  const urlHtml = renderMarkdown("后台https://fanqienovel.com/main/writer/chapter-manage/7662800007338134553，台账");
  assert.match(urlHtml, /href="https:\/\/fanqienovel\.com\/main\/writer\/chapter-manage\/7662800007338134553"/);
  assert.match(urlHtml, />https:\/\/fanqienovel\.com\/main\/writer\/chapter-manage\/7662800007338134553<\/a>，台账/);

  const boldTrialHtml = renderMarkdown("试跑链接: **https://demo.example.com/16/** (实测)");
  assert.match(
    boldTrialHtml,
    /试跑链接: <strong><a href="https:\/\/demo\.example\.com\/16\/" target="_blank" rel="noopener noreferrer">https:\/\/demo\.example\.com\/16\/<\/a><\/strong> \(实测\)/,
  );

  const boldRootHtml = renderMarkdown("原站保留: **https://demo.example.com/** (HTTP/2 200)");
  assert.match(
    boldRootHtml,
    /原站保留: <strong><a href="https:\/\/demo\.example\.com\/" target="_blank" rel="noopener noreferrer">https:\/\/demo\.example\.com\/<\/a><\/strong> \(HTTP\/2 200\)/,
  );

  const adjacentBoldHtml = renderMarkdown("**https://demo.example.com/16/**(实测)和**https://demo.example.com/**测试");
  assert.match(
    adjacentBoldHtml,
    /<strong><a href="https:\/\/demo\.example\.com\/16\/" target="_blank" rel="noopener noreferrer">https:\/\/demo\.example\.com\/16\/<\/a><\/strong>\(实测\)和<strong><a href="https:\/\/demo\.example\.com\/" target="_blank" rel="noopener noreferrer">https:\/\/demo\.example\.com\/<\/a><\/strong>测试/,
  );

  assert.match(
    renderMarkdown("*https://demo.example.com/*"),
    /<em><a href="https:\/\/demo\.example\.com\/" target="_blank" rel="noopener noreferrer">https:\/\/demo\.example\.com\/<\/a><\/em>/,
  );
  assert.match(
    renderMarkdown("***https://demo.example.com/***"),
    /<strong><em><a href="https:\/\/demo\.example\.com\/" target="_blank" rel="noopener noreferrer">https:\/\/demo\.example\.com\/<\/a><\/em><\/strong>/,
  );
  assert.match(
    renderMarkdown("~~https://demo.example.com/~~"),
    /<del><a href="https:\/\/demo\.example\.com\/" target="_blank" rel="noopener noreferrer">https:\/\/demo\.example\.com\/<\/a><\/del>/,
  );
  assert.match(
    renderMarkdown("__https://demo.example.com/__"),
    /<strong><a href="https:\/\/demo\.example\.com\/" target="_blank" rel="noopener noreferrer">https:\/\/demo\.example\.com\/<\/a><\/strong>/,
  );
  assert.match(
    renderMarkdown("_https://demo.example.com/_"),
    /<em><a href="https:\/\/demo\.example\.com\/" target="_blank" rel="noopener noreferrer">https:\/\/demo\.example\.com\/<\/a><\/em>/,
  );
  assert.match(
    renderMarkdown("(**https://demo.example.com/16/**)"),
    /\(<strong><a href="https:\/\/demo\.example\.com\/16\/" target="_blank" rel="noopener noreferrer">https:\/\/demo\.example\.com\/16\/<\/a><\/strong>\)/,
  );
  assert.match(
    renderMarkdown("**(https://demo.example.com/16/)**"),
    /<strong>\(<a href="https:\/\/demo\.example\.com\/16\/" target="_blank" rel="noopener noreferrer">https:\/\/demo\.example\.com\/16\/<\/a>\)<\/strong>/,
  );
  assert.match(
    renderMarkdown("**https://en.wikipedia.org/wiki/A*_search_algorithm**"),
    /<strong><a href="https:\/\/en\.wikipedia\.org\/wiki\/A\*_search_algorithm" target="_blank" rel="noopener noreferrer">https:\/\/en\.wikipedia\.org\/wiki\/A\*_search_algorithm<\/a><\/strong>/,
  );
  assert.match(
    renderMarkdown("https://example.com/~user/file_name"),
    /<a href="https:\/\/example\.com\/~user\/file_name" target="_blank" rel="noopener noreferrer">https:\/\/example\.com\/~user\/file_name<\/a>/,
  );
  assert.match(
    renderMarkdown("(https://en.wikipedia.org/wiki/Function_(mathematics))"),
    /\(<a href="https:\/\/en\.wikipedia\.org\/wiki\/Function_\(mathematics\)" target="_blank" rel="noopener noreferrer">https:\/\/en\.wikipedia\.org\/wiki\/Function_\(mathematics\)<\/a>\)/,
  );
  assert.doesNotMatch(renderMarkdown("*https://*"), /<a href=/);

  // 2. Consecutive DONT_NOTIFY heartbeats collapse cleanly without raw XML or fake "你" bubble; NOTIFY stays visible with tag
  const silentHbPrompt = "<heartbeat>\n  <automation_id>automation-8</automation_id>\n  <current_time_iso>2026-11-16T04:14:15.535Z</current_time_iso>\n  <instructions>\nAsia/Taipei每天12:00—13:59随机续发番茄《发错给总裁》三章。\n</instructions>\n</heartbeat>";
  const silentHbReply = "<heartbeat>\n  <automation_id>automation-8</automation_id>\n  <decision>DONT_NOTIFY</decision>\n  <message>今日三章已全部提交并记录，无需补发。</message>\n</heartbeat>";
  const notifyHbReply = "<heartbeat>\n  <automation_id>automation-8</automation_id>\n  <decision>NOTIFY</decision>\n  <message>今日第126—128章已提交。</message>\n</heartbeat>";

  const collapsed = dedupeAdjacentTurns([
    {
      id: "hb-1",
      status: "completed",
      startedAt: 1794800000,
      completedAt: 1794800005,
      items: [
        { type: "userMessage", id: "u-1", content: [{ type: "text", text: silentHbPrompt }] },
        { type: "agentMessage", id: "a-1", text: silentHbReply },
      ],
    },
    {
      id: "hb-2",
      status: "completed",
      startedAt: 1794800300,
      completedAt: 1794800305,
      items: [
        { type: "userMessage", id: "u-2", content: [{ type: "text", text: silentHbPrompt }] },
        { type: "agentMessage", id: "a-2", text: silentHbReply },
      ],
    },
    {
      id: "hb-notify",
      status: "completed",
      startedAt: 1794800600,
      completedAt: 1794800610,
      items: [
        { type: "userMessage", id: "u-3", content: [{ type: "text", text: silentHbPrompt }], heartbeat: { automationId: "automation-8", automationName: "番茄每天随机续发三章", currentTimeIso: "2026-11-16T04:14:15.535Z", instructions: "每天续发三章" } },
        { type: "agentMessage", id: "a-3", text: "今日第126—128章已提交。", heartbeat: { automationId: "automation-8", automationName: "番茄每天随机续发三章", decision: "NOTIFY", notify: true, message: "今日第126—128章已提交。" } },
      ],
    },
  ]);

  assert.equal(collapsed.length, 2);
  assert.equal(collapsed[0].quietHeartbeatGroup.count, 2);

  const quietHtml = renderTurnHtml(collapsed[0], { agentLabel: "Codex", threadId: "codex:codex:t-hb" });
  assert.doesNotMatch(quietHtml, /&lt;heartbeat|&lt;automation_id|&lt;decision|msg-role">你</);
  assert.match(quietHtml, /class="heartbeat-quiet-card heartbeat-disclosure"/);
  assert.match(quietHtml, /连续 2 次无变更/);
  assert.match(quietHtml, /今日三章已全部提交并记录，无需补发。/);

  const notifyHtml = renderTurnHtml(collapsed[1], { agentLabel: "Codex", threadId: "codex:codex:t-hb" });
  assert.doesNotMatch(notifyHtml, /&lt;heartbeat|msg-role">你</);
  assert.match(notifyHtml, /class="msg-row msg-automation-trigger"/);
  assert.match(notifyHtml, /番茄每天随机续发三章/);
  assert.match(notifyHtml, /class="heartbeat-notify-tag"/);
  assert.match(notifyHtml, /今日第126—128章已提交。/);

  assert.equal(cleanStreamingAgentText("<heartbeat>\n  <automation_id>automation-8</automation_id>\n  <decision>NOTIFY</decision>\n  <message>正在提交第129章"), "正在提交第129章");
  assert.equal(cleanStreamingAgentText(notifyHbReply), "今日第126—128章已提交。");

  // 3. Pasted file with colon inside quoted label + ambient browser context + &#x20;
  const pastedTurnHtml = renderTurnHtml({
    id: "turn-pasted",
    status: "completed",
    items: [
      {
        type: "userMessage",
        id: "u-pasted",
        content: [
          {
            type: "text",
            text: '# Files pasted by the user:\n\n## "# 客户支持-张工 11-10 上午 10:09 … - Project: 工单系统": /workspace/demo/attachments/0acd/已粘贴的文本.txt\n\n## My request:\n&#x20;继续查。',
          },
        ],
      },
    ],
  }, { agentLabel: "Codex", threadId: "codex:codex:t-pasted" });
  assert.doesNotMatch(pastedTurnHtml, /Files pasted by the user|&amp;#x20;/);
  assert.match(pastedTurnHtml, /class="msg-file-chip is-clickable" data-local-file-path="\/workspace\/demo\/attachments\/0acd\/已粘贴的文本\.txt"/);
  assert.match(pastedTurnHtml, />已粘贴的文本\.txt</);
  assert.match(pastedTurnHtml, /继续查。/);

  const ambientTurnHtml = renderTurnHtml({
    id: "turn-ambient",
    status: "completed",
    items: [
      {
        type: "userMessage",
        id: "u-amb",
        content: [
          {
            type: "text",
            text: '<in-app-browser-context source="ambient-ui-state">\n# In app browser:\n- Current URL: http://127.0.0.1:8878/gu/house\n</in-app-browser-context>\n## My request:\n看看小屋是不是有 bug',
          },
        ],
      },
    ],
  }, { agentLabel: "Codex", threadId: "codex:codex:t-amb" });
  assert.doesNotMatch(ambientTurnHtml, /in-app-browser-context|ambient-ui-state|My request/);
  assert.match(ambientTurnHtml, /看看小屋是不是有 bug/);
});

test("macOS native desktop wrapper files include WKWebView, local networking, and desktop scripts", async () => {
  const pkg = JSON.parse(await readFile(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"));
  assert.equal(pkg.scripts["desktop:build"], "bash desktop/macos/build-app.sh");
  assert.equal(pkg.scripts["desktop:install"], "bash desktop/macos/build-app.sh --install");

  const plist = await readFile(fileURLToPath(new URL("../desktop/macos/Info.plist", import.meta.url)), "utf8");
  assert.match(plist, /<key>CFBundleIdentifier<\/key>\s*<string>com\.guuguo\.agent-control\.desktop<\/string>/);
  assert.match(plist, /<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/);
  assert.match(plist, /<key>NSMicrophoneUsageDescription<\/key>/);

  const swiftSource = await readFile(fileURLToPath(new URL("../desktop/macos/AgentControl.swift", import.meta.url)), "utf8");
  assert.match(swiftSource, /WKWebView/);
  assert.match(swiftSource, /com\.guuguo\.agent-control/);
  assert.match(swiftSource, /runJavaScriptConfirmPanelWithMessage/);
  assert.match(swiftSource, /requestMediaCapturePermissionFor/);

  for (const installerFile of ["install.sh", "uninstall.sh", "install.ps1", "uninstall.ps1"]) {
    const content = await readFile(fileURLToPath(new URL(`../${installerFile}`, import.meta.url)), "utf8");
    assert.ok(content.length > 100, `${installerFile} should be non-empty`);
    assert.match(content, /43310|AgentControl|agent-control/);
  }
  const installSh = await readFile(fileURLToPath(new URL("../install.sh", import.meta.url)), "utf8");
  assert.match(installSh, /--remote/);
  assert.match(installSh, /cloudflare\|tailscale\|named\|relay\|local/);
  assert.match(installSh, /handle_remote\(\)/);
  const installPs1 = await readFile(fileURLToPath(new URL("../install.ps1", import.meta.url)), "utf8");
  assert.match(installPs1, /"cloudflare", "tailscale", "named", "relay", "local"/);
  const indexHtmlForRemote = await readFile(fileURLToPath(new URL("../public/index.html", import.meta.url)), "utf8");
  assert.match(indexHtmlForRemote, /id="fixedTunnelSection"/);
  assert.match(indexHtmlForRemote, /id="startTsFunnelBtn"/);
  assert.match(indexHtmlForRemote, /id="fixedPublicUrlInput"/);
});

test("renderTurnHtml renders Claude <task-notification>, <cross-session-message>, and <bash-input> as clean cards without raw XML or XSS", async () => {
  const { renderTurnHtml } = await import("../public/markdown.js");

  const stoppedTurnHtml = renderTurnHtml({
    id: "turn-claude-stopped",
    status: "completed",
    items: [
      {
        type: "userMessage",
        id: "u-stopped",
        content: [
          {
            type: "text",
            text: "<task-notification> <task-id>b3zgdt09y</task-id> <tool-use-id>toolu_01BWcnFBjKKrphcxpLYCXmC6</tool-use-id> <status>stopped</status> <summary>Background shell command didn't finish before the previous session ended</summary> <note>No completion record was found for it in the previous session. Check the output file for partial results before assuming it completed.</note> </task-notification>",
          },
        ],
      },
    ],
  }, { agentLabel: "Claude Code", threadId: "claude:default:t-1" });

  assert.doesNotMatch(stoppedTurnHtml, /&lt;task-notification|&lt;task-id|&lt;tool-use-id|msg-role">你</);
  assert.match(stoppedTurnHtml, /class="msg-row msg-task-notification"/);
  assert.match(stoppedTurnHtml, /class="task-notif-badge is-warn"/);
  assert.match(stoppedTurnHtml, /后台任务 · 已停止/);
  assert.match(stoppedTurnHtml, /Background shell command didn&#39;t finish before the previous session ended/);
  assert.match(stoppedTurnHtml, /No completion record was found for it in the previous session/);
  assert.match(stoppedTurnHtml, /<code class="task-notif-id">b3zgdt09y<\/code>/);

  const completedWithFileAndXss = renderTurnHtml({
    id: "turn-claude-done",
    status: "completed",
    items: [
      {
        type: "userMessage",
        id: "u-done",
        content: [
          {
            type: "text",
            text: [
              "[SYSTEM NOTIFICATION - NOT USER INPUT]",
              "This is an automated background-task event, NOT a message from the user.",
              "",
              "<task-notification>",
              "<task-id>task-99</task-id>",
              "<status>completed</status>",
              "<summary>构建 &lt;script&gt;alert(1)&lt;/script&gt; <script>alert(1)</script> 完成</summary>",
              "<output-file>/tmp/claude-out/build.log</output-file>",
              "<result>生成了 **2** 个产物</result>",
              "<usage><duration_ms>4250</duration_ms><tool_uses>5</tool_uses></usage>",
              "</task-notification>",
              "请继续下一步",
            ].join("\n"),
          },
        ],
      },
    ],
  }, { agentLabel: "Claude Code", threadId: "claude:default:t-1" });

  assert.doesNotMatch(completedWithFileAndXss, /<script>|SYSTEM NOTIFICATION - NOT USER INPUT/);
  assert.match(completedWithFileAndXss, /class="task-notif-badge is-ok"/);
  assert.match(completedWithFileAndXss, /后台任务 · 已完成/);
  assert.match(completedWithFileAndXss, /4\.3s/);
  assert.match(completedWithFileAndXss, /data-local-file-path="\/tmp\/claude-out\/build\.log"/);
  assert.match(completedWithFileAndXss, /生成了 <strong>2<\/strong> 个产物/);
  assert.match(completedWithFileAndXss, /msg-role">你<[\s\S]*请继续下一步/);

  const crossAndBashHtml = renderTurnHtml({
    id: "turn-claude-cross-bash",
    status: "completed",
    items: [
      {
        type: "userMessage",
        id: "u-cross",
        content: [
          {
            type: "text",
            text: 'Another Claude session sent a message:\n<cross-session-message from="local_123" from-name="示例商城管理后台评估">\n已部署 **prod**\n</cross-session-message>\n<bash-input>git status -s</bash-input><bash-stdout>\u001b[32mM README.md\u001b[0m</bash-stdout><bash-stderr></bash-stderr>',
          },
        ],
      },
    ],
  }, { agentLabel: "Claude Code", threadId: "claude:default:t-1" });

  assert.doesNotMatch(crossAndBashHtml, /&lt;cross-session-message|&lt;bash-input|msg-role">你</);
  assert.match(crossAndBashHtml, /class="msg-row msg-cross-session"/);
  assert.match(crossAndBashHtml, /示例商城管理后台评估/);
  assert.match(crossAndBashHtml, /<strong>prod<\/strong>/);
  assert.match(crossAndBashHtml, /class="msg-row msg-claude-bash"/);
  assert.match(crossAndBashHtml, /\$ git status -s/);
  assert.match(crossAndBashHtml, /M README\.md/);
});

test("renderTurnHtml renders per-turn model badges, inline interrupted resume button, and Claude copy-login button", async () => {
  const { formatTurnModelBadge, renderTurnHtml } = await import("../public/markdown.js");

  assert.deepEqual(
    formatTurnModelBadge({
      models: ["gemini-pro-orchestrator", "gemini-4-hydrogen-low"],
    }),
    {
      label: "Carbon → Hydrogen L",
      title: "gemini-pro-orchestrator → gemini-4-hydrogen-low",
    },
  );
  assert.deepEqual(
    formatTurnModelBadge({ model: "gpt-6.1-sol", effort: "high" }),
    {
      label: "GPT-6.1-SOL · H",
      title: "gpt-6.1-sol (high)",
    },
  );
  assert.deepEqual(
    formatTurnModelBadge({}, "claude-opus-5-5", "medium"),
    {
      label: "Opus 5.5 · M",
      title: "claude-opus-5-5 (medium)",
    },
  );
  assert.equal(formatTurnModelBadge({}), null);

  const interruptedToolTurnHtml = renderTurnHtml({
    id: "turn-interrupted-tool",
    status: "completed",
    models: ["gemini-pro-orchestrator", "gemini-4-hydrogen-high"],
    items: [
      { type: "userMessage", id: "u-int", content: [{ type: "text", text: "重构下状态吗" }] },
      { type: "commandExecution", id: "cmd-int", command: "npm run check", status: "completed" },
    ],
  }, {
    agentLabel: "Antigravity",
    threadId: "antigravity:desktop:t-int",
    showIncompleteSummaryHint: true,
    supersededByNextTurn: false,
  });

  assert.match(interruptedToolTurnHtml, /class="process-model-pill"[^>]*>Carbon → Hydrogen H<\/span>/);
  assert.match(interruptedToolTurnHtml, /class="turn-resume-inline-btn" data-resume-interrupted-turn="1">▶ 继续执行<\/button>/);

  const goalSuspendedHtml = renderTurnHtml({
    id: "turn-goal-suspended",
    status: "completed",
    model: "claude-opus-5-5",
    items: [
      { type: "userMessage", id: "u-goal", content: [{ type: "text", text: "跑完全部验收" }] },
      { type: "commandExecution", id: "cmd-goal", command: "npm test", status: "completed" },
    ],
  }, {
    agentLabel: "Claude Code",
    threadId: "claude:default:t-goal",
    showIncompleteSummaryHint: true,
    supersededByNextTurn: false,
    goalSuspended: true,
  });
  assert.match(goalSuspendedHtml, /class="process-model-pill"[^>]*>Opus 5\.5<\/span>/);
  assert.match(goalSuspendedHtml, /data-resume-interrupted-turn="1">▶ 恢复 Goal<\/button>/);

  const agentReplyHtml = renderTurnHtml({
    id: "turn-reply-model",
    status: "completed",
    model: "claude-sonnet-5-5",
    effort: "medium",
    items: [
      { type: "userMessage", id: "u-rep", content: [{ type: "text", text: "你好" }] },
      { type: "agentMessage", id: "a-rep", text: "已处理完成", phase: "final_answer" },
    ],
  }, {
    agentLabel: "Claude Code",
    threadId: "claude:default:t-rep",
  });
  assert.match(agentReplyHtml, /<span class="msg-role">Claude Code<\/span>\s*<span class="turn-model-tag"[^>]*>Sonnet 5\.5 · M<\/span>/);

  const pillsHtml = renderProfilePillsHtml([
    {
      id: "claude-hotmail",
      provider: "claude",
      label: "Claude · claude hotmail",
      account: { signedIn: true, email: "bob@hotmail.com", planType: "Pro" },
      health: {
        status: "unavailable",
        reasonCode: "auth",
        shortReason: "CLI未登录",
        detail: "CLI未登录：请执行 CLAUDE_CONFIG_DIR=~/.claude-claude-hotmail claude auth login --email bob@hotmail.com",
      },
    },
    {
      id: "default",
      provider: "codex",
      label: "Codex 默认",
      account: { signedIn: true, email: "codex@example.com" },
      health: { status: "available" },
    },
  ]);
  assert.match(pillsHtml, /data-copy-login-cmd="CLAUDE_CONFIG_DIR=~\/\.claude-claude-hotmail claude auth login --email bob@hotmail\.com"[^>]*>复制登录<\/button>/);
});

test("multi-profile colliding handles auto-disambiguate to distinct short aliases with lightweight AI and fallback", async (t) => {
  const samePrefixProfiles = [
    {
      key: "claude:default",
      provider: "claude",
      id: "default",
      label: "Claude 默认",
      installed: true,
      account: { signedIn: true, email: "bob@icloud.com" },
    },
    {
      key: "claude:claude-hotmail",
      provider: "claude",
      id: "claude-hotmail",
      label: "Claude 默认",
      installed: true,
      account: { signedIn: true, email: "bob@hotmail.com" },
    },
  ];
  assert.equal(resolveDistinctProfileChipText(samePrefixProfiles[0], samePrefixProfiles), "iCloud");
  assert.equal(resolveDistinctProfileChipText(samePrefixProfiles[1], samePrefixProfiles), "Hotmail");
  const icloudChip = compactThreadSourceChip(
    { provider: "claude", profileId: "default", profileLabel: "Claude 默认" },
    { providerFilter: "all", profiles: samePrefixProfiles },
  );
  const hotmailChip = compactThreadSourceChip(
    { provider: "claude", profileId: "claude-hotmail", profileLabel: "Claude 默认" },
    { providerFilter: "all", profiles: samePrefixProfiles },
  );
  assert.equal(icloudChip?.text, "iCloud");
  assert.equal(hotmailChip?.text, "Hotmail");

  assert.deepEqual(suggestFallbackDistinctAliases(samePrefixProfiles), {
    "claude:default": "iCloud",
    "claude:claude-hotmail": "Hotmail",
  });

  // Explicit alias is preserved while colliding unnamed sibling still gets AI alias.
  const aiResult = await resolveAutoProfileAliases({
    providerId: "claude",
    profiles: [
      { ...samePrefixProfiles[0], health: { alias: "自用苹果" } },
      samePrefixProfiles[1],
    ],
    callLightweightAi: async () => JSON.stringify({
      "claude:claude-hotmail": "微软号",
    }),
  });
  assert.equal(aiResult.source, "ai");
  assert.deepEqual(aiResult.aliases, { "claude:claude-hotmail": "微软号" });

  // ProviderHub schedules lightweight AI naming for colliding multi-profiles and persists aliases cleanly without overwriting user alias.
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-auto-alias-"));
  t.after(async () => rm(dir, { recursive: true, force: true }).catch(() => {}));
  const metaStore = createThreadMetaStore({ filePath: resolve(dir, "thread-meta.json") });
  await metaStore.load();
  await metaStore.setProfileMeta("codex:guuguo", { alias: "guuguo自用" });

  const mockClaude = {
    id: "claude",
    label: "Claude Code",
    setCallbacks() {},
    async listProfiles() {
      return samePrefixProfiles.map((p) => ({ ...p }));
    },
  };
  const mockCodex = {
    id: "codex",
    label: "Codex",
    setCallbacks() {},
    async listProfiles() {
      return [
        { key: "codex:default", provider: "codex", id: "default", label: "Codex 默认", installed: true, account: { email: "bob@gmail.com" } },
        { key: "codex:guuguo", provider: "codex", id: "guuguo", label: "Codex · guuguo", installed: true, account: { email: "alice@qq.com" } },
      ];
    },
  };
  const aiCalls = [];
  const hub = new ProviderHub({
    dataDir: dir,
    metaStore,
    providers: [mockClaude, mockCodex],
    enableQueueDrain: false,
    callLightweightProfileAi: async ({ providerId, profiles }) => {
      aiCalls.push({ providerId, keys: profiles.map((p) => p.key || `${p.provider}:${p.id}`) });
      if (providerId === "claude") {
        return '{"claude:default":"果云号","claude:claude-hotmail":"微软号"}';
      }
      if (providerId === "codex") {
        return '{"codex:default":"谷歌主"}';
      }
      return null;
    },
  });
  await hub.init();
  const initial = await hub.listProvidersAndProfiles();
  assert.equal(initial.profiles.find((p) => p.key === "claude:default")?.health?.alias, "iCloud");
  assert.equal(initial.profiles.find((p) => p.key === "claude:claude-hotmail")?.health?.alias, "Hotmail");
  assert.equal(initial.profiles.find((p) => p.key === "codex:guuguo")?.health?.alias, "guuguo自用");

  await new Promise((r) => setTimeout(r, 40));
  const afterAi = await hub.listProvidersAndProfiles();
  assert.equal(afterAi.profiles.find((p) => p.key === "claude:default")?.health?.alias, "果云号");
  assert.equal(afterAi.profiles.find((p) => p.key === "claude:claude-hotmail")?.health?.alias, "微软号");
  assert.equal(afterAi.profiles.find((p) => p.key === "codex:guuguo")?.health?.alias, "guuguo自用");
  assert.equal(afterAi.profiles.find((p) => p.key === "codex:default")?.health?.alias, "谷歌主");
  assert.equal(aiCalls.length, 2);
  await hub.close();
});

test("queued turn steer endpoint delivers directly with images/goal and preserves entry on send failure", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-queue-steer-"));
  t.after(async () => rm(dir, { recursive: true, force: true }).catch(() => {}));

  let failSteer = false;
  const sentPayloads = [];
  const mockProvider = {
    id: "antigravity",
    label: "Antigravity",
    setCallbacks() {},
    async listProfiles() {
      return [{ id: "desktop", label: "Antigravity 桌面", installed: true }];
    },
    async listThreads() {
      return {
        threads: [{ id: "t-steer-1", title: "排队列引导", cwd: dir, live: true, updatedAt: 1000 }],
        nextCursor: null,
      };
    },
    async readThread() {
      return {
        thread: {
          id: "antigravity:desktop:t-steer-1",
          rawId: "t-steer-1",
          provider: "antigravity",
          profileId: "desktop",
          title: "排队列引导",
          cwd: dir,
          live: true,
          turns: [{ id: "turn-active-1", status: "inProgress", items: [] }],
        },
        nextCursor: null,
      };
    },
    async sendTurn(payload) {
      sentPayloads.push(payload);
      if (failSteer) {
        throw Object.assign(new Error("当前通道临时繁忙"), { status: 409, code: "thread_busy" });
      }
      return { turn: { id: "turn-active-1", status: "inProgress" }, steered: Boolean(payload.steer) };
    },
  };

  const hub = new ProviderHub({
    dataDir: dir,
    providers: [mockProvider],
    enableQueueDrain: false,
  });
  const srv = await createAgentControlServer({ hub, host: "127.0.0.1", port: 0, disableRelay: true, dataDir: dir });
  await hub.init();
  await srv.start();
  t.after(async () => {
    await srv.close();
    await hub.close();
  });

  const baseUrl = srv.url;
  const headers = { "Content-Type": "application/json" };
  const threadId = "antigravity:desktop:t-steer-1";

  const enqueueRes = await fetch(`${baseUrl}/api/thread/queue`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      threadId,
      text: "先顺着改好按钮高度",
      images: [{ name: "shot.png", dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==" }],
      permissionMode: "turbo",
      goalMode: true,
    }),
  });
  assert.equal(enqueueRes.status, 200);
  const enqueued = await enqueueRes.json();
  const entryId = enqueued.entry?.id;
  assert.ok(entryId);
  assert.equal(enqueued.items.length, 1);

  // If sendTurn rejects during steer, queued item remains preserved.
  failSteer = true;
  const failedRes = await fetch(`${baseUrl}/api/thread/queue/steer`, {
    method: "POST",
    headers,
    body: JSON.stringify({ threadId, id: entryId }),
  });
  assert.equal(failedRes.status, 409);
  const stillQueued = await hub.listQueuedTurns(threadId);
  assert.equal(stillQueued.length, 1);
  assert.equal(stillQueued[0].id, entryId);

  // Retry succeeds: item is delivered with steer=true + goalMode + images and removed from queue.
  failSteer = false;
  const okRes = await fetch(`${baseUrl}/api/thread/queue/steer`, {
    method: "POST",
    headers,
    body: JSON.stringify({ threadId, id: entryId, expectedTurnId: "turn-active-1" }),
  });
  assert.equal(okRes.status, 200);
  const steeredJson = await okRes.json();
  assert.equal(steeredJson.ok, true);
  assert.equal(steeredJson.steered, true);
  assert.equal(steeredJson.items.length, 0);
  assert.equal(sentPayloads.length, 2);
  assert.equal(sentPayloads[1].steer, true);
  assert.equal(sentPayloads[1].text, "先顺着改好按钮高度");
  assert.equal(sentPayloads[1].images.length, 1);
  assert.equal(sentPayloads[1].permissionMode, "turbo");
  const threadReadRes = await fetch(`${baseUrl}/api/thread?id=${encodeURIComponent(threadId)}`);
  assert.equal(threadReadRes.status, 200);
  const threadReadJson = await threadReadRes.json();
  assert.equal(threadReadJson.thread?.goalState?.active, true);
});

test("custom-select descriptors and toolbar controls enforce unified 28px height without XSS or emojis", async () => {
  const permDesc = extractSelectDescriptor({
    id: "permissionSelect",
    disabled: false,
    hidden: false,
    value: "turbo",
    title: "选择权限",
    options: [
      { value: "turbo", textContent: "Turbo（自动批准）", selected: true },
      { value: "safe", textContent: "只读 / <script>alert(1)</script>", selected: false },
    ],
  });
  assert.equal(permDesc.variant, "permission");
  assert.equal(permDesc.toneClass, "is-tone-turbo");
  const triggerHtml = renderCustomSelectTriggerInnerHtml(permDesc);
  assert.match(triggerHtml, /ac-icon-bolt/);
  assert.match(triggerHtml, /<span class="ac-select-label">Turbo<\/span>/);
  assert.match(triggerHtml, /ac-icon-chevron-down/);

  const menuHtml = renderCustomSelectMenuHtml(permDesc);
  assert.match(menuHtml, /data-ac-option-value="turbo"[^>]*aria-selected="true"/);
  assert.match(menuHtml, /Turbo（自动批准）/);
  assert.match(menuHtml, /ac-icon-check/);
  assert.doesNotMatch(menuHtml, /<script>/);
  assert.match(menuHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);

  const appCss = await readFile(fileURLToPath(new URL("../public/app.css", import.meta.url)), "utf8");
  assert.match(appCss, /\.composer-icon-btn\s*\{[^}]*height:\s*28px;/);
  assert.match(appCss, /\.composer-toolbar #composerGoalBtn\s*\{[^}]*height:\s*28px;/);
  assert.match(appCss, /\.composer-toolbar #sendBtn\s*\{[^}]*height:\s*28px;/);
  assert.match(appCss, /\.ac-select-trigger\s*\{[^}]*height:\s*28px;/);
});

test("slim subtle dark scrollbars and PC-only draggable sidebar resizer stay wired across HTML/CSS/JS", async () => {
  const [indexHtml, appCss, appJs] = await Promise.all([
    readFile(fileURLToPath(new URL("../public/index.html", import.meta.url)), "utf8"),
    readFile(fileURLToPath(new URL("../public/app.css", import.meta.url)), "utf8"),
    readFile(fileURLToPath(new URL("../public/app.js", import.meta.url)), "utf8"),
  ]);

  assert.match(appCss, /\*::-webkit-scrollbar\s*\{[^}]*width:\s*5px;\s*height:\s*5px;/);
  assert.match(appCss, /\*::-webkit-scrollbar-track,\s*\*::-webkit-scrollbar-corner\s*\{\s*background:\s*transparent;/);
  assert.match(appCss, /\.local-apps-strip::-webkit-scrollbar\s*\{\s*display:\s*none;/);

  assert.match(indexHtml, /<\/aside>\s*<div[^>]*id="sidebarResizer"[^>]*class="sidebar-resizer"/);
  assert.match(appCss, /\.sidebar-resizer\s*\{[^}]*cursor:\s*col-resize;/);
  assert.match(appCss, /@media\s*\(max-width:\s*960px\)\s*\{[\s\S]*\.sidebar-resizer\s*\{\s*display:\s*none\s*!important;\s*\}/);

  assert.match(appJs, /SIDEBAR_WIDTH_PREF_KEY\s*=\s*"agentControl\.sidebarWidth\.v1"/);
  assert.match(appJs, /function bindSidebarResizer\(\)/);
  assert.match(appJs, /setProperty\("--sidebar-width",\s*`\$\{clamped\}px`\)/);
});

test("deferred viewport image loading, anti-snapback upward wheel handling, and incremental turn diffing prevent offscreen image loading and scroll jumps", async () => {
  const deferredTurnHtml = renderTurnHtml({
    id: "t-defer-img",
    status: "completed",
    items: [
      {
        type: "userMessage",
        content: [
          { type: "image", path: "assets/shot.png", name: "shot.png" },
          { type: "text", text: "请看这张图" },
        ],
      },
      {
        type: "agentMessage",
        text: "内嵌预览：![内嵌](assets/inline.png)\n\n导出结果：`assets/out.png`",
      },
    ],
  }, {
    agentLabel: "Antigravity",
    threadId: "antigravity:desktop:t-defer",
    deferImages: true,
  });

  assert.doesNotMatch(deferredTurnHtml, /<img[^>]*\ssrc=/);
  assert.match(deferredTurnHtml, /class="msg-image is-deferred-image" data-lazy-src="\.\/api\/thread\/image\?threadId=antigravity%3Adesktop%3At-defer&amp;path=assets%2Fshot\.png&amp;w=480&amp;q=68"/);
  assert.match(deferredTurnHtml, /class="md-inline-img is-deferred-image" data-lazy-src="\.\/api\/thread\/image\?threadId=antigravity%3Adesktop%3At-defer&amp;path=assets%2Finline\.png&amp;w=960&amp;q=70"/);
  assert.match(deferredTurnHtml, /class="msg-image is-deferred-image" data-lazy-src="\.\/api\/thread\/image\?threadId=antigravity%3Adesktop%3At-defer&amp;path=assets%2Fout\.png&amp;w=480&amp;q=68"/);
  assert.match(deferredTurnHtml, /data-preview-src="\.\/api\/thread\/image\?threadId=antigravity%3Adesktop%3At-defer&amp;path=assets%2Fshot\.png&amp;w=1280&amp;q=75"/);
  assert.match(deferredTurnHtml, /class="msg-image-deferred-lead"/);
  assert.match(deferredTurnHtml, /class="msg-reveal-thread-images-btn" data-reveal-thread-images="1"/);
  assert.match(deferredTurnHtml, /class="md-inline-img-wrap is-deferred"[\s\S]*?data-reveal-inline-img="1"/);

  // In-memory data URL attachments render eagerly even when network preview deferImages is active.
  const dataUrlTurnHtml = renderTurnHtml({
    id: "t-inline-data-img",
    status: "completed",
    items: [{
      type: "userMessage",
      content: [{ type: "image", url: "data:image/png;base64,iVBORw0KGgo=", name: "mem.png" }],
    }],
  }, {
    agentLabel: "Antigravity",
    threadId: "antigravity:desktop:t-defer",
    deferImages: true,
  });
  assert.match(dataUrlTurnHtml, /<img class="msg-image" src="data:image\/png;base64,iVBORw0KGgo="/);
  assert.doesNotMatch(dataUrlTurnHtml, /data-reveal-thread-images/);

  const listeners = new Map();
  const fakeViewport = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      listeners.set(type, list.filter((f) => f !== fn));
    },
  };
  let paused = 0;
  let settled = 0;
  const unbind = bindFollowIntent(fakeViewport, {
    pause: () => { paused += 1; },
    settle: () => { settled += 1; },
  });
  try {
    for (const fn of listeners.get("wheel") || []) {
      fn({ deltaY: -12 });
    }
    assert.equal(paused, 1);
    assert.equal(settled, 0);

    for (const fn of listeners.get("keyup") || []) {
      fn({ key: "End" });
    }
    assert.equal(settled, 0);
  } finally {
    unbind();
  }

  const [appJs, appCss] = await Promise.all([
    readFile(fileURLToPath(new URL("../public/app.js", import.meta.url)), "utf8"),
    readFile(fileURLToPath(new URL("../public/app.css", import.meta.url)), "utf8"),
  ]);
  assert.match(appJs, /function syncTurnListIncremental\(/);
  assert.match(appJs, /function patchTurnBlockInPlace\(/);
  assert.match(appJs, /function hydrateRevealedDeferredImages\(/);
  assert.match(appJs, /revealedDeferredImageSrcs/);
  assert.match(appJs, /REVEALED_IMAGE_CACHE_LIMIT/);
  assert.match(appJs, /function setThreadImagesUnlocked\(/);
  assert.match(appJs, /if\s*\(\s*!isThreadImagesUnlocked\(\)\s*\)\s*return;/);
  assert.match(appJs, /resetDeferredImageObserver\(\{\s*resetRevealed:\s*false\s*\}\)/);
  assert.match(appJs, /function captureViewportAnchor\(/);
  assert.match(appJs, /function restoreViewportAnchor\(/);
  assert.match(appJs, /rootMargin:\s*"0px"/);
  assert.match(appCss, /\.messages-viewport\s*\{[^}]*overflow-anchor:\s*auto;/);
  assert.match(appCss, /#streamingTurn\s*\{[^}]*overflow-anchor:\s*none;/);
  assert.match(appCss, /\.msg-image\.is-deferred-image\s*\{\s*display:\s*none;/);
  assert.match(appCss, /\.msg-reveal-thread-images-btn\s*\{/);
  assert.match(appCss, /\.md-inline-img-trigger\s*\{/);
});

test("captureViewportAnchor, restoreViewportAnchor, and turn open-key preservation distinguish duplicate turn IDs across forked threads", async () => {
  const vm = await import("node:vm");
  const appJs = await readFile(fileURLToPath(new URL("../public/app.js", import.meta.url)), "utf8");
  const openKeysSrc = appJs.slice(
    appJs.indexOf("function captureTurnListOpenKeys("),
    appJs.indexOf("function activeDisplayTurns("),
  );
  const anchorSrc = appJs.slice(
    appJs.indexOf("function captureViewportAnchor("),
    appJs.indexOf("function parseTurnBlockElement("),
  );

  let turnListEl = null;
  const {
    captureTurnListOpenKeys,
    restoreTurnListOpenKeys,
    captureViewportAnchor,
    restoreViewportAnchor,
  } = vm.runInNewContext(`${openKeysSrc}\n${anchorSrc}\n({ captureTurnListOpenKeys, restoreTurnListOpenKeys, captureViewportAnchor, restoreViewportAnchor });`, {
    state: { autoFollow: false },
    $: (id) => (id === "turnList" ? turnListEl : null),
    Map,
    Set,
    Number,
    Math,
  });

  const makeMockBlock = (turnId, docTop, height, vp, { children = [], detailsOpen = false } = {}) => {
    const details = [{ open: detailsOpen }];
    const block = {
      docTop,
      height,
      parentElement: null,
      children: [],
      getAttribute: (attr) => (attr === "data-turn-id" ? turnId : null),
      querySelectorAll: () => details,
      getBoundingClientRect: () => ({
        top: block.docTop - vp.scrollTop,
        bottom: block.docTop + block.height - vp.scrollTop,
        height: block.height,
      }),
      _details: details,
    };
    block.children = children.map((c) => {
      const child = {
        docTop: c.docTop,
        height: c.height,
        parentElement: block,
        getBoundingClientRect: () => ({
          top: child.docTop - vp.scrollTop,
          bottom: child.docTop + child.height - vp.scrollTop,
          height: child.height,
        }),
      };
      return child;
    });
    return block;
  };

  const mountBlocks = (listEl, blocks) => {
    for (const prev of listEl.children) prev.parentElement = null;
    listEl.children = blocks;
    for (const b of blocks) b.parentElement = listEl;
  };

  const vp = {
    scrollTop: 50150,
    getBoundingClientRect: () => ({ top: 0, bottom: 800, height: 800 }),
  };
  turnListEl = { hidden: false, children: [] };

  const buildForkedDom = (extraTopShift = 0, prependOlderSameId = false) => {
    const blocks = [];
    if (prependOlderSameId) {
      blocks.push(makeMockBlock("agy-step-0", 0, 2000, vp));
    }
    const baseOffset = prependOlderSameId ? 2000 : 0;
    blocks.push(makeMockBlock("agy-step-0", baseOffset + 0, 1000, vp));
    for (let i = 1; i < 58; i += 1) {
      blocks.push(makeMockBlock(`agy-step-${i * 40}`, baseOffset + i * 850, 800, vp));
    }
    const childTurnTop = baseOffset + 50000 + extraTopShift;
    blocks.push(
      makeMockBlock("agy-step-0", childTurnTop, 600, vp, {
        children: [
          { docTop: childTurnTop, height: 100 },
          { docTop: childTurnTop + 100, height: 500 },
        ],
      }),
    );
    return blocks;
  };

  // 场景 A：用户停留在索引 58（子会话首轮，data-turn-id="agy-step-0"），原 DOM 节点仍挂载时不得跳回索引 0
  const initialBlocks = buildForkedDom(0);
  mountBlocks(turnListEl, initialBlocks);
  const anchorMounted = captureViewportAnchor(vp);
  assert.equal(anchorMounted.turnId, "agy-step-0");
  assert.equal(anchorMounted.childIdx, 1);
  assert.equal(anchorMounted.occurrenceFromEnd, 0);
  initialBlocks[58].docTop += 40;
  initialBlocks[58].children[1].docTop += 40;
  restoreViewportAnchor(vp, anchorMounted);
  assert.equal(vp.scrollTop, 50190);

  // 场景 B：整表重建（blockEl 已脱离 turnListEl）时按 occurrenceFromEnd 精确区分索引 58 与索引 0
  vp.scrollTop = 50150;
  mountBlocks(turnListEl, buildForkedDom(0));
  const anchorForChild = captureViewportAnchor(vp);
  const rebuiltBlocks = buildForkedDom(120);
  mountBlocks(turnListEl, rebuiltBlocks);
  restoreViewportAnchor(vp, anchorForChild);
  assert.equal(vp.scrollTop, 50270);

  vp.scrollTop = 20;
  const anchorForTop = captureViewportAnchor(vp);
  assert.equal(anchorForTop.occurrenceFromEnd, 1);
  const rebuiltTopShift = buildForkedDom(0);
  rebuiltTopShift[0].docTop += 30;
  mountBlocks(turnListEl, rebuiltTopShift);
  restoreViewportAnchor(vp, anchorForTop);
  assert.equal(vp.scrollTop, 50);

  // 场景 C：顶部加载更早历史（前置新增一个 agy-step-0）导致整表重建，原索引 58 仍稳在原位置
  vp.scrollTop = 50150;
  mountBlocks(turnListEl, buildForkedDom(0));
  const anchorBeforePrepend = captureViewportAnchor(vp);
  const prependedBlocks = buildForkedDom(0, true);
  mountBlocks(turnListEl, prependedBlocks);
  restoreViewportAnchor(vp, anchorBeforePrepend);
  assert.equal(vp.scrollTop, 52150);

  // 场景 D：captureTurnListOpenKeys / restoreTurnListOpenKeys 不会在同名 agy-step-0 块之间串扰 <details>
  const blocksWithDetails = [
    makeMockBlock("agy-step-0", 0, 500, vp, { detailsOpen: false }),
    makeMockBlock("agy-step-0", 500, 500, vp, { detailsOpen: true }),
  ];
  const openKeys = captureTurnListOpenKeys(blocksWithDetails, 0);
  const freshBlocks = [
    makeMockBlock("agy-step-0", 0, 500, vp, { detailsOpen: false }),
    makeMockBlock("agy-step-0", 500, 500, vp, { detailsOpen: false }),
  ];
  restoreTurnListOpenKeys(freshBlocks, openKeys, 0);
  assert.equal(freshBlocks[0]._details[0].open, false);
  assert.equal(freshBlocks[1]._details[0].open, true);
});

test("expanded telemetry cards show reset dates inline without duplicate drawer grid, and distinct owners keep account handle priority", async (t) => {
  const nowSec = Math.floor(new Date("2026-11-16T10:00:00").getTime() / 1000);
  const sameDayResetSec = Math.floor(new Date("2026-11-16T18:30:00").getTime() / 1000);
  const futureDateResetSec = Math.floor(new Date("2026-11-21T09:00:00").getTime() / 1000);

  const html = renderAgentTelemetryBarHtml([
    {
      key: "codex:codex",
      provider: "codex",
      id: "codex",
      label: "Codex · guuguo自用",
      installed: true,
      authenticated: true,
      account: { email: "alice@qq.com" },
      health: { alias: "alice·QQ" },
      quota: {
        status: "ok",
        windows: {
          fiveHour: { remainingPercent: 72, resetsAt: sameDayResetSec },
          weekly: { remainingPercent: 94, resetsAt: futureDateResetSec },
        },
        buckets: [],
      },
    },
  ], {}, { expanded: true, nowSec });

  assert.match(html, /<span class="telemetry-chip-v">72%<\/span><time[^>]*>8小时30分后重置<\/time>/);
  assert.match(html, /title="[^"]*18:30"/);
  assert.match(html, /<span class="telemetry-chip-v">94%<\/span><time[^>]*>4天23小时后重置<\/time>/);
  assert.match(html, /title="[^"]*11\/21/);
  assert.doesNotMatch(html, /telemetry-drawer-grid|telemetry-drawer-card/);

  assert.deepEqual(
    suggestFallbackDistinctAliases([
      { key: "codex:codex", provider: "codex", id: "codex", label: "Codex · guuguo自用", installed: true, account: { email: "alice@qq.com" } },
      { key: "codex:default", provider: "codex", id: "default", label: "Codex 默认", installed: true, account: { email: "carol1990@163.com" } },
    ]),
    {
      "codex:codex": "alice·QQ",
      "codex:default": "carol·163",
    },
  );

  assert.deepEqual(
    suggestFallbackDistinctAliases([
      { key: "grok:cockpit-1", provider: "grok", id: "cockpit-1", label: "Grok · guuguo", installed: true, account: { email: "alice@qq.com" } },
      { key: "grok:default", provider: "grok", id: "default", label: "Grok 默认", installed: true, account: { email: "" } },
    ]),
    {
      "grok:cockpit-1": "alice·QQ",
      "grok:default": "默认",
    },
  );

  // Stale v1 auto aliases (e.g. QQ / 163 / 热邮) upgrade cleanly to v2 without overwriting manual aliases.
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-alias-upgrade-"));
  t.after(async () => rm(dir, { recursive: true, force: true }).catch(() => {}));
  const metaStore = createThreadMetaStore({ filePath: resolve(dir, "thread-meta.json") });
  await metaStore.load();
  await metaStore.setProfileMeta("codex:codex", { alias: "QQ", autoAliasSource: "ai", autoAliasSignature: "v1-old" });
  await metaStore.setProfileMeta("codex:default", { alias: "163", autoAliasSource: "ai", autoAliasSignature: "v1-old" });
  await metaStore.setProfileMeta("claude:default", { alias: "手动留名", autoAliasSource: "manual" });

  const mockCodex = {
    id: "codex",
    label: "Codex",
    setCallbacks() {},
    async listProfiles() {
      return [
        { id: "codex", label: "Codex · guuguo自用", installed: true, account: { email: "alice@qq.com" } },
        { id: "default", label: "Codex 默认", installed: true, account: { email: "carol1990@163.com" } },
      ];
    },
  };
  const mockClaude = {
    id: "claude",
    label: "Claude Code",
    setCallbacks() {},
    async listProfiles() {
      return [
        { id: "default", label: "Claude 默认", installed: true, account: { email: "bob@icloud.com" } },
        { id: "claude-hotmail", label: "Claude · hotmail", installed: true, account: { email: "bob@hotmail.com" } },
      ];
    },
  };
  const hub = new ProviderHub({
    dataDir: dir,
    metaStore,
    providers: [mockCodex, mockClaude],
    enableQueueDrain: false,
    callLightweightProfileAi: async ({ providerId }) => {
      if (providerId === "codex") return '{"codex:codex":"alice·QQ","codex:default":"carol·163"}';
      if (providerId === "claude") return '{"claude:claude-hotmail":"Hotmail"}';
      return null;
    },
  });
  await hub.init();
  let list = await hub.listProvidersAndProfiles();
  for (let i = 0; i < 20; i += 1) {
    if (list.profiles.find((p) => p.key === "claude:claude-hotmail")?.health?.alias === "Hotmail") break;
    await new Promise((r) => setTimeout(r, 25));
    list = await hub.listProvidersAndProfiles();
  }
  assert.equal(list.profiles.find((p) => p.key === "codex:codex")?.health?.alias, "alice·QQ");
  assert.equal(list.profiles.find((p) => p.key === "codex:default")?.health?.alias, "carol·163");
  assert.equal(list.profiles.find((p) => p.key === "claude:default")?.health?.alias, "手动留名");
  assert.equal(list.profiles.find((p) => p.key === "claude:claude-hotmail")?.health?.alias, "Hotmail");
  await hub.close();
});

test("restarted ProviderHub prioritizes interrupted inflight turns ahead of queued turns without auto-resuming manual interrupts", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-inflight-resume-"));
  t.after(async () => rm(dir, { recursive: true, force: true }).catch(() => {}));

  const createMockHubEnv = ({ unfinishedOnRead = true } = {}) => {
    const sent = [];
    const interrupted = [];
    let emit = () => {};
    let readCount = 0;
    const mockProvider = {
      id: "antigravity",
      label: "Antigravity",
      setCallbacks({ onEvent }) {
        emit = onEvent || (() => {});
      },
      async listProfiles() {
        return [{ id: "desktop", label: "Antigravity", installed: true }];
      },
      async getActivity() {
        return { live: false, nativeQueuedTurns: [] };
      },
      async readThread(profileId, rawId) {
        readCount += 1;
        return {
          thread: {
            id: `antigravity:${profileId}:${rawId}`,
            provider: "antigravity",
            profileId,
            rawId,
            title: "老二重构任务",
            cwd: dir,
            live: false,
            turns: unfinishedOnRead
              ? [{
                  id: "turn-1",
                  status: "inProgress",
                  items: [
                    { type: "userMessage", content: [{ type: "text", text: "重构登录流程并验证测试" }] },
                    { type: "mcpToolCall", tool: "edit_file", status: "completed" },
                  ],
                }]
              : [{
                  id: "turn-1",
                  status: "completed",
                  items: [
                    { type: "userMessage", content: [{ type: "text", text: "重构登录流程并验证测试" }] },
                    { type: "agentMessage", text: "已完成并验证通过。" },
                  ],
                }],
          },
          nextCursor: null,
        };
      },
      async sendTurn({ profileId, rawId, text }) {
        const turnId = `turn-sent-${sent.length + 1}`;
        sent.push({ profileId, rawId, text, turnId });
        return { turn: { id: turnId }, thread: { id: `antigravity:${profileId}:${rawId}`, title: "老二重构任务", cwd: dir } };
      },
      async interrupt({ rawId }) {
        interrupted.push(rawId);
        return { ok: true };
      },
    };
    const hub = new ProviderHub({
      dataDir: dir,
      providers: [mockProvider],
      enableQueueDrain: true,
    });
    return {
      hub,
      sent,
      interrupted,
      getReadCount: () => readCount,
      emitCompleted(rawId, turnId, lastAgentMessage = "断点恢复完成") {
        emit({
          type: "turn_completed",
          provider: "antigravity",
          profileId: "desktop",
          threadId: `antigravity:desktop:${rawId}`,
          turnId,
          status: "completed",
          lastAgentMessage,
        });
      },
    };
  };

  // 1. 服务重启前：t-laoer 正在执行原始任务，同时排着一条新任务 Q1。
  const run1 = createMockHubEnv({ unfinishedOnRead: true });
  await run1.hub.init();
  await run1.hub.sendTurn({ threadId: "antigravity:desktop:t-laoer", cwd: dir, text: "重构登录流程并验证测试" });
  await run1.hub.queueTurn({ threadId: "antigravity:desktop:t-laoer", text: "后续新排队任务 Q1" });
  // 模拟服务突然重启（不触发 turn_completed）
  await run1.hub.close();

  // 2. 重启后的新服务实例：应先发出断点优先恢复，且不得先发 Q1。
  const run2 = createMockHubEnv({ unfinishedOnRead: true });
  await run2.hub.init();
  for (let i = 0; i < 40 && run2.sent.length < 1; i += 1) {
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.equal(run2.sent.length, 1);
  assert.match(run2.sent[0].text, /服务重启后自动断点恢复/);
  assert.doesNotMatch(run2.sent[0].text, /后续新排队任务 Q1/);

  // 断点恢复任务跑完之后，Q1 才按序自动触发。
  run2.emitCompleted("t-laoer", run2.sent[0].turnId, "刚才中断步骤已完成");
  for (let i = 0; i < 40 && run2.sent.length < 2; i += 1) {
    await new Promise((r) => setTimeout(r, 40));
  }
  assert.equal(run2.sent.length, 2);
  assert.equal(run2.sent[1].text, "后续新排队任务 Q1");

  // 若是手动点中断，再重启绝不自动续跑。
  await run2.hub.interrupt({ threadId: "antigravity:desktop:t-laoer" });
  await run2.hub.close();

  const run3 = createMockHubEnv({ unfinishedOnRead: true });
  await run3.hub.init();
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(run3.sent.length, 0);
  await run3.hub.close();
});

test("queued turns support fetching full images via /entry and updating in place without losing position or attachments", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-queue-edit-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const mockProvider = {
    name: "antigravity",
    async init() {},
    async close() {},
    onEvent() {
      return () => {};
    },
    getProfiles() {
      return [{ id: "desktop", label: "Agy", ready: true }];
    },
    getModels() {
      return [{ id: "model-1", label: "Model 1" }];
    },
    async listThreads() {
      return [{ id: "antigravity:desktop:t-edit-1", title: "编辑排队测试", cwd: dir, updatedAt: 1 }];
    },
    async readThread() {
      return { thread: { id: "antigravity:desktop:t-edit-1", title: "编辑排队测试", cwd: dir, turns: [] }, nextCursor: null };
    },
    async sendTurn() {
      return { turn: { id: "turn-1", status: "inProgress" } };
    },
  };

  const hub = new ProviderHub({
    dataDir: dir,
    providers: [mockProvider],
    enableQueueDrain: false,
  });
  const srv = await createAgentControlServer({ hub, host: "127.0.0.1", port: 0, disableRelay: true, dataDir: dir });
  await hub.init();
  await srv.start();
  t.after(async () => {
    await srv.close();
    await hub.close();
  });

  const baseUrl = srv.url;
  const headers = { "Content-Type": "application/json" };
  const threadId = "antigravity:desktop:t-edit-1";
  const imgDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const img2DataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

  const q1Res = await fetch(`${baseUrl}/api/thread/queue`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      threadId,
      text: "第一条原排队",
      images: [{ name: "first.png", dataUrl: imgDataUrl }],
      goalMode: true,
    }),
  });
  assert.equal(q1Res.status, 200);
  const q1Json = await q1Res.json();
  const q1Id = q1Json.entry?.id;
  assert.ok(q1Id);

  const q2Res = await fetch(`${baseUrl}/api/thread/queue`, {
    method: "POST",
    headers,
    body: JSON.stringify({ threadId, text: "第二条占位" }),
  });
  assert.equal(q2Res.status, 200);

  // 普通列表接口应继续脱敏（不带 dataUrl），但保留 imageCount
  const listRes = await fetch(`${baseUrl}/api/thread/queue?id=${encodeURIComponent(threadId)}`);
  assert.equal(listRes.status, 200);
  const listJson = await listRes.json();
  assert.equal(listJson.items.length, 2);
  assert.equal(listJson.items[0].imageCount, 1);
  assert.equal(listJson.items[0].images[0].omitted, true);
  assert.equal(listJson.items[0].images[0].dataUrl, undefined);

  // /api/thread/queue/entry 应返回完整原图 dataUrl，且不从队列移除
  const entryRes = await fetch(`${baseUrl}/api/thread/queue/entry?threadId=${encodeURIComponent(threadId)}&id=${encodeURIComponent(q1Id)}`);
  assert.equal(entryRes.status, 200);
  const entryJson = await entryRes.json();
  assert.equal(entryJson.entry.id, q1Id);
  assert.equal(entryJson.entry.position, 1);
  assert.equal(entryJson.entry.images.length, 1);
  assert.equal(entryJson.entry.images[0].name, "first.png");
  assert.equal(entryJson.entry.images[0].dataUrl, imgDataUrl);
  assert.equal((await hub.listQueuedTurns(threadId)).length, 2);

  // /api/thread/queue/update 应原位更新第 1 条且保持 position === 1 排在第二条前面
  const updateRes = await fetch(`${baseUrl}/api/thread/queue/update`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      threadId,
      id: q1Id,
      text: "第一条修改后",
      images: [
        { name: "first.png", dataUrl: imgDataUrl },
        { name: "second.jpg", dataUrl: img2DataUrl },
      ],
      goalMode: false,
    }),
  });
  assert.equal(updateRes.status, 200);
  const updateJson = await updateRes.json();
  assert.equal(updateJson.items.length, 2);
  assert.equal(updateJson.items[0].id, q1Id);
  assert.equal(updateJson.items[0].position, 1);
  assert.equal(updateJson.items[0].text, "第一条修改后");
  assert.equal(updateJson.items[0].imageCount, 2);
  assert.equal(updateJson.items[0].goalMode, false);
  assert.equal(updateJson.items[1].text, "第二条占位");
  assert.equal(updateJson.items[1].position, 2);

  const entryAfterRes = await fetch(`${baseUrl}/api/thread/queue/entry?threadId=${encodeURIComponent(threadId)}&id=${encodeURIComponent(q1Id)}`);
  assert.equal(entryAfterRes.status, 200);
  const entryAfterJson = await entryAfterRes.json();
  assert.deepEqual(entryAfterJson.entry.images, [
    { name: "first.png", dataUrl: imgDataUrl },
    { name: "second.jpg", dataUrl: img2DataUrl },
  ]);

  // 不存在的队列项返回 404 queued_turn_not_found
  const missingRes = await fetch(`${baseUrl}/api/thread/queue/update`, {
    method: "POST",
    headers,
    body: JSON.stringify({ threadId, id: "missing-id", text: "不会写入" }),
  });
  assert.equal(missingRes.status, 404);
  const missingJson = await missingRes.json();
  assert.equal(missingJson.error?.code, "queued_turn_not_found");
});

test("markThreadRead prevents reconcileThreadStatusTrackers and syncThreadSummaryIntoList from re-marking opened thread unread", async () => {
  const appSource = await readFile(resolve(process.cwd(), "public/app.js"), "utf8");
  const syncFnSource = appSource.match(/function syncThreadSummaryIntoList\(thread\) \{[\s\S]*?\n\}/)?.[0];
  const markReadFnSource = appSource.match(/function markThreadRead\(threadId, updatedAtSec = 0\) \{[\s\S]*?\n\}/)?.[0];
  const reconcileFnSource = appSource.match(/function reconcileThreadStatusTrackers\(prevThreads = \[\], nextThreads = \[\]\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(syncFnSource, "syncThreadSummaryIntoList should exist");
  assert.ok(markReadFnSource, "markThreadRead should exist");
  assert.ok(reconcileFnSource, "reconcileThreadStatusTrackers should exist");

  const threadId = "claude:default:22222222-2222-4222-8222-222222222222";
  const laterSec = Math.floor(Date.now() / 1000) - 30;
  const earlierSec = laterSec - 120;
  const ctx = {
    state: {
      activeThreadId: threadId,
      boardOpen: false,
      threads: [{ id: threadId, provider: "claude", updatedAt: laterSec, live: false, preview: "已完成" }],
      recentCompletedByThread: new Map([[threadId, { status: "completed", summary: "已完成", at: Date.now(), updatedAt: laterSec }]]),
      liveActivityByThread: new Map(),
    },
    threadReadState: { initialized: true, seenById: {}, unreadById: { [threadId]: { status: "completed", at: Date.now(), updatedAt: laterSec } } },
    persistThreadReadState: () => {},
    stripMarkdownForSpeech: (text) => String(text || ""),
    mergeLiveActivity: (prev, patch) => ({ ...prev, ...patch }),
    providerDisplayName: () => "Claude Code",
    document: { visibilityState: "visible" },
  };
  const fn = new Function(
    "state",
    "threadReadState",
    "persistThreadReadState",
    "stripMarkdownForSpeech",
    "mergeLiveActivity",
    "providerDisplayName",
    "document",
    `${syncFnSource}\n${markReadFnSource}\n${reconcileFnSource}\nreturn { syncThreadSummaryIntoList, markThreadRead, reconcileThreadStatusTrackers };`,
  );
  const helpers = fn(
    ctx.state,
    ctx.threadReadState,
    ctx.persistThreadReadState,
    ctx.stripMarkdownForSpeech,
    ctx.mergeLiveActivity,
    ctx.providerDisplayName,
    ctx.document,
  );

  // 点击打开会话后，即使详情接口返回更早的 updatedAt，也不应把列表时间倒退
  const cleared = helpers.markThreadRead(threadId, laterSec);
  assert.equal(cleared, true);
  assert.equal(ctx.state.recentCompletedByThread.has(threadId), false);
  helpers.syncThreadSummaryIntoList({ id: threadId, updatedAt: earlierSec, live: false });
  assert.equal(ctx.state.threads[0].updatedAt, laterSec);

  // 即使 prev.updatedAt 曾偏小，切走后列表刷新返回已读过的 laterSec，也不应再次标回未读
  ctx.state.activeThreadId = "codex:codex:other-thread";
  const prevThreads = [{ id: threadId, provider: "claude", updatedAt: earlierSec, live: false, preview: "已完成" }];
  const nextThreads = [{ id: threadId, provider: "claude", updatedAt: laterSec, live: false, preview: "已完成" }];
  helpers.reconcileThreadStatusTrackers(prevThreads, nextThreads);
  assert.equal(ctx.state.recentCompletedByThread.has(threadId), false);
  assert.equal(Boolean(ctx.threadReadState.unreadById[threadId]), false);
});

test("instance manager UI renders pending login, Codex client launch, Claude terminal login, and managed removal cleanly without emojis", () => {
  const needsLoginMeta = profileHealthVisualMeta({
    id: "work-alt",
    provider: "codex",
    installed: true,
    needsLogin: true,
  });
  assert.equal(needsLoginMeta.status, "needs_login");
  assert.equal(needsLoginMeta.badgeText, "待登录");
  assert.equal(needsLoginMeta.available, false);

  const profiles = [
    {
      id: "default",
      key: "codex:default",
      provider: "codex",
      label: "Codex 默认",
      home: "/Users/demo/.codex",
      installed: true,
      account: { signedIn: true, email: "main@example.com" },
      health: { status: "healthy", latencyMs: 120 },
    },
    {
      id: "work-alt",
      key: "codex:work-alt",
      provider: "codex",
      label: "Codex · 备用工作号",
      home: "/data/instances/codex/work-alt",
      managed: true,
      installed: true,
      needsLogin: true,
      account: { signedIn: false },
      health: { status: "unknown" },
    },
    {
      id: "claude-alt",
      key: "claude:claude-alt",
      provider: "claude",
      label: "Claude · 团队号",
      home: "/data/instances/claude/claude-alt",
      cliConfigDir: "/data/instances/claude/claude-alt",
      managed: true,
      installed: true,
      needsLogin: true,
      loginCommand: "CLAUDE_CONFIG_DIR=/data/instances/claude/claude-alt claude auth login",
      health: { status: "unknown" },
    },
  ];

  const codexMgrHtml = renderInstanceManagerListHtml(profiles, { provider: "codex" });
  assert.equal(/\p{Extended_Pictographic}/u.test(codexMgrHtml), false);
  assert.match(codexMgrHtml, /data-login-profile="work-alt"[^>]*data-login-mode="oauth"[^>]*>浏览器登录<\/button>/);
  assert.match(codexMgrHtml, /data-login-profile="work-alt"[^>]*data-login-mode="app"[^>]*>开客户端<\/button>/);
  assert.match(codexMgrHtml, /data-delete-profile="work-alt"/);
  assert.doesNotMatch(codexMgrHtml, /data-delete-profile="default"/);
  assert.match(codexMgrHtml, /托管多开/);
  assert.match(codexMgrHtml, /本机发现/);

  const claudeMgrHtml = renderInstanceManagerListHtml(profiles, { provider: "claude" });
  assert.equal(/\p{Extended_Pictographic}/u.test(claudeMgrHtml), false);
  assert.match(claudeMgrHtml, /data-login-profile="claude-alt"[^>]*data-login-mode="terminal"[^>]*>终端登录<\/button>/);
  assert.match(claudeMgrHtml, /data-copy-login-cmd="CLAUDE_CONFIG_DIR=\/data\/instances\/claude\/claude-alt claude auth login"/);
  assert.match(claudeMgrHtml, /data-delete-profile="claude-alt"/);

  const pillsHtml = renderProfilePillsHtml(profiles.filter((p) => p.provider === "codex"), {
    selectedId: "default",
    allowManageButton: true,
    provider: "codex",
  });
  assert.match(pillsHtml, /data-login-profile="work-alt"[^>]*>去登录<\/button>/);
  assert.match(pillsHtml, /data-open-instance-modal="codex"/);
});

test("light theme mode defaults to system preference and toggles manually on top logo without pictographic emojis", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../public/app.css", import.meta.url), "utf8");
  const wsCss = await readFile(new URL("../public/project-workspace.css", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

  assert.match(html, /id="themeToggleBtn"/);
  assert.match(html, /id="sseStatusDot"/);
  assert.match(html, /id="themeToggleIcon"/);
  assert.match(html, /prefers-color-scheme:\s*light/);
  assert.match(html, /ac-theme-mode/);

  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(css, /color-scheme:\s*light;/);
  assert.match(wsCss, /:root\[data-theme="light"\]/);

  assert.match(appSource, /const THEME_STORAGE_KEY\s*=\s*"ac-theme-mode"/);
  assert.match(appSource, /function toggleThemeMode\(/);
  assert.match(appSource, /matchMedia\("\(prefers-color-scheme: light\)"\)/);

  const { iconSvg } = await import("../public/icons.js");
  const sunSvg = iconSvg("sun", { size: 12 });
  const moonSvg = iconSvg("moon", { size: 12 });
  const monitorSvg = iconSvg("monitor", { size: 12 });
  assert.match(sunSvg, /<svg/);
  assert.match(moonSvg, /<svg/);
  assert.match(monitorSvg, /<svg/);
  assert.equal(/\p{Extended_Pictographic}/u.test(sunSvg + moonSvg + monitorSvg), false);
});

test("pasted file URIs and absolute paths format as markdown file links and render clickable", async () => {
  const {
    formatPastedFileMarkdownLink,
    formatClipboardFilesAsMarkdownLinks,
    renderMarkdown,
  } = await import("../public/markdown.js");

  assert.equal(
    formatPastedFileMarkdownLink("/Users/demo/project/README.md"),
    "[README.md](file:///Users/demo/project/README.md)",
  );
  assert.equal(
    formatPastedFileMarkdownLink('"/Volumes/External SSD/dev/project/case.md"'),
    "[case.md](<file:///Volumes/External SSD/dev/project/case.md>)",
  );
  assert.equal(
    formatPastedFileMarkdownLink("file:///Users/demo/My%20Docs/plan.md#L12"),
    "[plan.md](<file:///Users/demo/My Docs/plan.md#L12>)",
  );
  assert.equal(
    formatClipboardFilesAsMarkdownLinks({
      uriList: "# comment\nfile:///Users/demo/a.txt\nfile:///Users/demo/shot.png",
      plainText: "a.txt",
    }),
    "[a.txt](file:///Users/demo/a.txt)",
  );
  assert.equal(
    formatClipboardFilesAsMarkdownLinks({
      plainText: "请看这段普通文本 /Users/demo/a.txt 说明",
    }),
    "",
  );
  assert.equal(
    formatClipboardFilesAsMarkdownLinks({
      plainText: "[a.txt](file:///Users/demo/a.txt)",
    }),
    "",
  );

  const rendered = renderMarkdown("[case.md](<file:///Volumes/External SSD/dev/project/case.md>)");
  assert.match(rendered, /class="md-file-link"/);
  assert.match(rendered, /data-local-file-path="\/Volumes\/External SSD\/dev\/project\/case\.md"/);
});

test("compactModelBadgeLabel automatically formats future Orchestrator and Gemini codenames without hardcoding", async () => {
  const { compactModelBadgeLabel } = await import("../public/instance-switcher.js");
  const { formatTurnModelBadge } = await import("../public/markdown.js");
  assert.equal(compactModelBadgeLabel("Orchestrator (Neon)"), "Neon");
  assert.equal(compactModelBadgeLabel("Orchestrator (Cobalt)"), "Cobalt");
  assert.equal(compactModelBadgeLabel("Orchestrator (Argon)"), "Argon");
  assert.equal(compactModelBadgeLabel("gemini-pro-orchestrator-neon"), "Neon");
  assert.equal(compactModelBadgeLabel("gemini-pro-orchestrator-argon"), "Argon");
  assert.equal(compactModelBadgeLabel("gemini-pro-orchestrator-cobalt"), "Cobalt");
  assert.equal(compactModelBadgeLabel("Gemini 4.5 Plasma (High)"), "Plasma H");
  assert.equal(compactModelBadgeLabel("gemini-4-neon-xhigh"), "Neon XH");
  assert.equal(compactModelBadgeLabel("gemini-3.8-flash"), "3.8 Flash");
  assert.equal(compactModelBadgeLabel("gemini-3.8-flash-low"), "3.8 Flash L");
  assert.equal(compactModelBadgeLabel("gpt-6.2-astra"), "GPT-6.2-ASTRA");
  assert.equal(compactModelBadgeLabel("gpt-6.1-terra"), "GPT-6.1-TERRA");
  assert.equal(compactModelBadgeLabel("gpt-6.3-nova"), "GPT-6.3-NOVA");
  assert.deepEqual(
    formatTurnModelBadge({ model: "gemini-pro-orchestrator-neon" }),
    { label: "Neon", title: "gemini-pro-orchestrator-neon" },
  );
  assert.deepEqual(
    formatTurnModelBadge({ models: ["gemini-pro-orchestrator-neon", "gemini-4-hydrogen-high"] }),
    { label: "Neon → Hydrogen H", title: "gemini-pro-orchestrator-neon → gemini-4-hydrogen-high" },
  );
  assert.deepEqual(
    formatTurnModelBadge({ model: "gemini-3.8-flash-low" }),
    { label: "3.8 Flash L", title: "gemini-3.8-flash-low" },
  );
  assert.deepEqual(
    formatTurnModelBadge({ model: "gpt-6.2-astra", effort: "high" }),
    { label: "GPT-6.2-ASTRA · H", title: "gpt-6.2-astra (high)" },
  );
  assert.equal(compactModelBadgeLabel("gemini-flash-worker-agy"), "Flash Worker");
  assert.equal(compactModelBadgeLabel("GPT-OSS 120B"), "GPT-OSS 120B");
  assert.equal(compactModelBadgeLabel("gpt-oss-120b"), "GPT-OSS 120B");
  assert.deepEqual(
    formatTurnModelBadge({ models: ["gemini-pro-orchestrator-neon", "gemini-flash-worker-agy"] }),
    { label: "Neon → Flash Worker", title: "gemini-pro-orchestrator-neon → gemini-flash-worker-agy" },
  );

  const agyClientModels = CLIENT_FALLBACK_MODELS.antigravity;
  assert.equal(agyClientModels.find((m) => m.isDefault)?.id, "gemini-pro-orchestrator");
  for (const id of ["gemini-pro-orchestrator-neon", "gemini-4-neon", "claude-sonnet-5-5", "gemini-3.8-flash", "gpt-oss-120b"]) {
    assert.ok(agyClientModels.some((m) => m.id === id), `missing fallback model ${id}`);
  }

  const ignoredWorker = ensurePreferredModelInList(agyClientModels, "antigravity", "gemini-flash-worker-agy");
  assert.equal(ignoredWorker.some((m) => m.id === "gemini-flash-worker-agy"), false);
  const keptGptOss = ensurePreferredModelInList(
    agyClientModels.filter((m) => m.id !== "gpt-oss-120b"),
    "antigravity",
    "gpt-oss-120b",
  );
  assert.equal(keptGptOss[0]?.id, "gpt-oss-120b");
  const synthOrch = ensurePreferredModelInList(agyClientModels, "antigravity", "gemini-pro-orchestrator-cobalt");
  assert.equal(synthOrch[0]?.id, "gemini-pro-orchestrator-cobalt");
  assert.equal(synthOrch[0]?.displayName, "Orchestrator (Cobalt)");
  assert.deepEqual(synthOrch[0]?.supportedReasoningEfforts, []);
});

test("renderMarkdown and mermaid-renderer render Mermaid diagrams with streaming safety, caching, theme sync, and error fallback", async () => {
  const { existsSync, readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const { renderMarkdown } = await import("../public/markdown.js");
  const {
    detectMermaidDiagramLabel,
    buildMermaidInitConfig,
    extractMermaidErrorMessage,
    hydrateMermaidBlocks,
    prepareMermaidSvgForPreview,
    resetMermaidRenderCache,
  } = await import("../public/mermaid-renderer.js");

  assert.equal(existsSync(resolve(process.cwd(), "public/vendor/mermaid.min.js")), true);
  const htmlSnapshot = readFileSync(resolve(process.cwd(), "public/index.html"), "utf8");
  assert.match(htmlSnapshot, /id="imagePreviewSvgHost"/);
  assert.match(htmlSnapshot, /id="imagePreviewZoomOutBtn"/);
  assert.match(htmlSnapshot, /id="imagePreviewZoomInBtn"/);

  const rawMermaidSvg = '<svg id="ac-mermaid-1" width="100%" style="max-width: 1554px;" viewBox="0 0 1554 1007"><style>#ac-mermaid-1 .node{fill:#111;}</style><defs><marker id="ac-mermaid-1_point" /></defs><path marker-end="url(#ac-mermaid-1_point)" /></svg>';
  const preview = prepareMermaidSvgForPreview(rawMermaidSvg, { previewId: "ac-mermaid-preview-99" });
  assert.equal(preview.viewWidth, 1554);
  assert.equal(preview.viewHeight, 1007);
  assert.equal(preview.previewId, "ac-mermaid-preview-99");
  assert.doesNotMatch(preview.svg, /ac-mermaid-1(?![0-9])/);
  assert.match(preview.svg, /id="ac-mermaid-preview-99"/);
  assert.match(preview.svg, /#ac-mermaid-preview-99 \.node/);
  assert.match(preview.svg, /id="ac-mermaid-preview-99_point"/);
  assert.match(preview.svg, /url\(#ac-mermaid-preview-99_point\)/);
  assert.match(preview.svg, /width="1554"\s+height="1007"/);
  assert.match(preview.svg, /aspect-ratio:\s*1554 \/ 1007/);
  assert.doesNotMatch(preview.svg, /max-width:\s*1554px/);

  // Diagram type labels & config
  assert.equal(detectMermaidDiagramLabel("%% comment\nflowchart TD\n  A --> B"), "流程图");
  assert.equal(detectMermaidDiagramLabel("sequenceDiagram\n  A->>B: hi"), "时序图");
  assert.equal(buildMermaidInitConfig("dark").securityLevel, "strict");
  assert.equal(buildMermaidInitConfig("dark").suppressErrorRendering, true);
  assert.equal(buildMermaidInitConfig("light").theme, "default");
  assert.equal(buildMermaidInitConfig("dark").theme, "dark");
  assert.equal(extractMermaidErrorMessage(new Error("Parse error\non line 2")), "Parse error on line 2");

  // Closed mermaid block renders structured placeholder + escaped source + zero emojis
  const closedHtml = renderMarkdown("```mermaid\nflowchart TD\n  A[\"<script>xss</script>\"] --> B\n```");
  assert.match(closedHtml, /class="md-code-block md-mermaid-block"/);
  assert.match(closedHtml, /data-mermaid-state="pending"/);
  assert.match(closedHtml, /data-mermaid-view="diagram"/);
  assert.match(closedHtml, />Mermaid · 流程图</);
  assert.match(closedHtml, /data-mermaid-toggle="1"/);
  assert.match(closedHtml, /data-mermaid-zoom="1" hidden/);
  assert.match(closedHtml, /<pre class="md-pre md-mermaid-source" data-lang="mermaid" hidden>/);
  assert.equal(closedHtml.includes("<script>"), false);
  assert.equal(closedHtml.includes("&lt;script&gt;"), true);
  assert.equal(/\p{Extended_Pictographic}/u.test(closedHtml), false);

  // Streaming (unclosed) mermaid block stays in source view without rendering broken partial SVG
  const streamingHtml = renderMarkdown("```mermaid\nflowchart TD\n  A --> B");
  assert.match(streamingHtml, /data-mermaid-state="streaming"/);
  assert.match(streamingHtml, /data-mermaid-view="source"/);
  assert.match(streamingHtml, /<div class="md-mermaid-stage" data-mermaid-stage hidden>/);

  // Hydration with mock mermaidRuntime + lightweight DOM stub
  const makeBlock = (codeText, { state = "pending", view = "diagram" } = {}) => {
    const stageEl = { innerHTML: "", hidden: view === "source" };
    const sourceEl = { hidden: view !== "source" };
    const errorEl = { hidden: true, textContent: "" };
    const toggleBtn = { hidden: state === "streaming", disabled: false, textContent: view === "source" ? "图表" : "源码", attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
    const zoomBtn = { hidden: true };
    const codeEl = { textContent: codeText };
    return {
      isConnected: true,
      dataset: { mermaidState: state, mermaidView: view, mermaidTheme: "" },
      _stage: stageEl,
      _source: sourceEl,
      _error: errorEl,
      _toggle: toggleBtn,
      _zoom: zoomBtn,
      querySelector(sel) {
        if (sel === "[data-mermaid-stage]") return stageEl;
        if (sel === "pre.md-mermaid-source") return sourceEl;
        if (sel === "[data-mermaid-error]") return errorEl;
        if (sel === "[data-mermaid-toggle]") return toggleBtn;
        if (sel === "[data-mermaid-zoom]") return zoomBtn;
        if (sel === "pre > code") return codeEl;
        return null;
      },
    };
  };

  resetMermaidRenderCache();
  let initCalls = [];
  let renderCalls = 0;
  const mockRuntime = {
    initialize(cfg) { initCalls.push(cfg.theme); },
    async render(id, src) {
      renderCalls += 1;
      if (src.includes("BROKEN")) throw new Error("Syntax error in graph");
      return { svg: `<svg id="${id}" data-theme="${initCalls[initCalls.length - 1]}"><g></g></svg>` };
    },
  };

  const bGood = makeBlock("flowchart TD\n  A --> B");
  const bStream = makeBlock("flowchart TD\n  A -->", { state: "streaming", view: "source" });
  const bBad = makeBlock("flowchart TD\n  BROKEN");
  const stubRoot = { querySelectorAll: () => [bGood, bStream, bBad] };

  const sum1 = await hydrateMermaidBlocks(stubRoot, { mermaidRuntime: mockRuntime, theme: "dark" });
  assert.equal(sum1.rendered, 1);
  assert.equal(sum1.skipped, 1);
  assert.equal(sum1.errors, 1);
  assert.equal(renderCalls, 2);
  assert.equal(bGood.dataset.mermaidState, "rendered");
  assert.equal(bGood.dataset.mermaidTheme, "dark");
  assert.match(bGood._stage.innerHTML, /<svg/);
  assert.equal(bGood._stage.hidden, false);
  assert.equal(bGood._source.hidden, true);
  assert.equal(bGood._zoom.hidden, false);

  assert.equal(bBad.dataset.mermaidState, "error");
  assert.equal(bBad.dataset.mermaidView, "source");
  assert.equal(bBad._source.hidden, false);
  assert.equal(bBad._error.hidden, false);
  assert.match(bBad._error.textContent, /Syntax error in graph/);

  // Cache hit when rendering another block with identical source & theme
  const bGoodDup = makeBlock("flowchart TD\n  A --> B");
  const sumCache = await hydrateMermaidBlocks({ querySelectorAll: () => [bGoodDup] }, { mermaidRuntime: mockRuntime, theme: "dark" });
  assert.equal(sumCache.cached, 1);
  assert.equal(sumCache.rendered, 0);
  assert.equal(renderCalls, 2);

  // Theme switch triggers re-render cleanly
  const sumLight = await hydrateMermaidBlocks({ querySelectorAll: () => [bGood] }, { forceThemeSync: true, mermaidRuntime: mockRuntime, theme: "light" });
  assert.equal(sumLight.rendered, 1);
  assert.equal(bGood.dataset.mermaidTheme, "light");
  assert.match(bGood._stage.innerHTML, /data-theme="default"/);
});

test("release-notes UI renders multi-dimensional version tabs, category filters, and concise copy without emojis", async () => {
  const esc = (s) => String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  assert.equal(renderReleaseHeadline({ version: "0.2.3", title: "v0.2.3 图表直出与统计升级", summary: "一句话" }), "图表直出与统计升级");
  assert.equal(renderReleaseHeadline({ title: "", summary: "只有总结" }), "只有总结");

  const multiSnap = {
    hasUpdate: true,
    remoteVersion: "0.2.4",
    releaseNotes: {
      pendingSource: "release_notes",
      pending: [{
        id: "v0.2.4",
        version: "0.2.4",
        date: "2026-11-20",
        title: "v0.2.4 人话版更新说明上线",
        summary: "把技术提交翻译成清晰功能清单。",
        items: [
          { category: "new", categoryLabel: "新增", title: "版本亮点卡片", detail: "普通用户一眼看懂本次改了什么。" },
          { category: "fix", categoryLabel: "修复", title: "", detail: "解决弹窗标题过长换行的错位。" },
        ],
      }],
      current: {
        id: "v0.2.3",
        version: "0.2.3",
        date: "2026-11-19",
        title: "图表直出与解归档",
        summary: "全面提升可用性。",
        items: [{ category: "new", categoryLabel: "新增", title: "Mermaid 渲染", detail: "直接画流程图。" }],
      },
      recent: [
        {
          id: "v0.2.3",
          version: "0.2.3",
          date: "2026-11-19",
          title: "图表直出与解归档",
          summary: "全面提升可用性。",
          items: [{ category: "new", categoryLabel: "新增", title: "Mermaid 渲染", detail: "直接画流程图。" }],
        },
        {
          id: "v0.2.2",
          version: "0.2.2",
          date: "2026-11-16",
          title: "语音交互升级",
          items: [{ category: "improve", categoryLabel: "优化", title: "", detail: "响应更快" }],
        },
      ],
    },
  };

  const tabs = buildReleaseVersionTabs(multiSnap);
  assert.deepEqual(tabs.map((t) => [t.key, t.label]), [
    ["pending", "待更新 v0.2.4"],
    ["v0.2.3", "当前 v0.2.3"],
    ["v0.2.2", "v0.2.2"],
  ]);

  const updateHtml = renderReleaseNotesCardHtml(multiSnap, { escapeHtml: esc });
  assert.match(updateHtml, /data-notes-version="pending"/);
  assert.match(updateHtml, /待更新 v0\.2\.4/);
  assert.match(updateHtml, /当前 v0\.2\.3/);
  assert.match(updateHtml, /data-notes-category="all"/);
  assert.match(updateHtml, /update-notes-badge is-new">新增</);
  assert.match(updateHtml, /update-notes-badge is-fix">修复</);
  assert.match(updateHtml, /人话版更新说明上线/);
  // Date should appear once (deduped header) and title shouldn't repeat v0.2.4 prefix
  assert.equal((updateHtml.match(/2026-11-20/g) || []).length, 1);
  assert.doesNotMatch(updateHtml, /class="update-notes-hero-title">v0\.2\.4/);
  assert.equal(/\p{Extended_Pictographic}/u.test(updateHtml), false);

  // Switching category filter narrows items cleanly
  const fixOnlyHtml = renderReleaseNotesCardHtml(multiSnap, { escapeHtml: esc, selectedCategory: "fix" });
  assert.match(fixOnlyHtml, /解决弹窗标题过长换行的错位/);
  assert.doesNotMatch(fixOnlyHtml, /版本亮点卡片/);

  // Switching version tab displays history entry
  const historyHtml = renderReleaseNotesCardHtml(multiSnap, { escapeHtml: esc, selectedVersionKey: "v0.2.2" });
  assert.match(historyHtml, /语音交互升级/);
  assert.match(historyHtml, /响应更快/);

  const fallbackHtml = renderReleaseNotesCardHtml({
    hasUpdate: true,
    remoteVersion: "",
    releaseNotes: {
      pendingSource: "commits_fallback",
      pending: [{
        version: "",
        date: "2026-11-20",
        title: "最新代码更新",
        summary: "",
        items: [{ category: "improve", categoryLabel: "优化", title: "", detail: "提升响应速度" }],
      }],
    },
  }, { escapeHtml: esc });
  assert.match(fallbackHtml, /按提交记录自动整理/);

  const indexHtml = await readFile(fileURLToPath(new URL("../public/index.html", import.meta.url)), "utf8");
  assert.match(indexHtml, /data-update-tab="notes"/);
  assert.match(indexHtml, /data-update-tab="settings"/);
  assert.match(indexHtml, /data-update-tab="cli"/);

  const releaseNotesMd = await readFile(fileURLToPath(new URL("../RELEASE_NOTES.md", import.meta.url)), "utf8");
  assert.match(releaseNotesMd, /^# Agent Control 更新说明/m);
  assert.equal(/\p{Extended_Pictographic}/u.test(releaseNotesMd), false);

  const releaseNotesEnMd = await readFile(fileURLToPath(new URL("../RELEASE_NOTES.en.md", import.meta.url)), "utf8");
  assert.match(releaseNotesEnMd, /^# Agent Control Release Notes/m);
  assert.equal(/\p{Extended_Pictographic}/u.test(releaseNotesEnMd), false);

  const bilingualSnap = {
    ...multiSnap,
    releaseNotes: {
      ...multiSnap.releaseNotes,
      locales: {
        zh: multiSnap.releaseNotes,
        en: {
          pendingSource: "release_notes",
          pending: [{
            id: "v0.2.4",
            version: "0.2.4",
            date: "2026-11-20",
            title: "v0.2.4 Bilingual Release Notes",
            summary: "Clear takeaways for English UI users.",
            items: [
              { category: "new", categoryLabel: "New", title: "Release Card", detail: "See what changed at a glance." },
              { category: "fix", categoryLabel: "Fixed", title: "", detail: "Prevented header wrapping on mobile." },
            ],
          }],
          current: {
            id: "v0.2.3",
            version: "0.2.3",
            date: "2026-11-19",
            title: "Diagrams & Unarchive",
            summary: "Usability polish.",
            items: [{ category: "new", categoryLabel: "New", title: "Mermaid", detail: "Render diagrams inline." }],
          },
          recent: [{
            id: "v0.2.3",
            version: "0.2.3",
            date: "2026-11-19",
            title: "Diagrams & Unarchive",
            summary: "Usability polish.",
            items: [{ category: "new", categoryLabel: "New", title: "Mermaid", detail: "Render diagrams inline." }],
          }],
        },
      },
    },
  };

  assert.equal(resolveReleaseNotesBucket(bilingualSnap, "en")?.current?.title, "Diagrams & Unarchive");
  assert.equal(resolveReleaseNotesBucket(bilingualSnap, "zh-CN")?.current?.title, "图表直出与解归档");
  const enTabs = buildReleaseVersionTabs(bilingualSnap, { locale: "en" });
  assert.deepEqual(enTabs.map((t) => [t.key, t.label]), [
    ["pending", "Update v0.2.4"],
    ["v0.2.3", "Current v0.2.3"],
  ]);
  const enHtml = renderReleaseNotesCardHtml(bilingualSnap, { escapeHtml: esc, locale: "en" });
  assert.match(enHtml, /Update v0\.2\.4/);
  assert.match(enHtml, /Current v0\.2\.3/);
  assert.match(enHtml, /update-notes-badge is-new">New</);
  assert.match(enHtml, /update-notes-badge is-fix">Fixed</);
  assert.match(enHtml, /Bilingual Release Notes/);
  assert.match(enHtml, /<span>All<\/span>/);
  assert.equal(/\p{Extended_Pictographic}/u.test(enHtml), false);

  // Graceful fallback to default notes when locales.en is absent
  const fallbackEnTabs = buildReleaseVersionTabs(multiSnap, { locale: "en" });
  assert.equal(fallbackEnTabs[0].label, "Update v0.2.4");
  const fallbackEnHtml = renderReleaseNotesCardHtml(multiSnap, { escapeHtml: esc, locale: "en" });
  assert.match(fallbackEnHtml, /update-notes-badge is-new">New</);
});

test("mobile hold-to-talk composer bar and topbar reply-summary TTS helpers work cleanly", async () => {
  const mem = new Map();
  const storage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
  };
  assert.equal(loadChatReplyTtsPref(storage).enabled, false);
  saveChatReplyTtsPref(true, storage);
  assert.equal(loadChatReplyTtsPref(storage).enabled, true);
  mem.set("agentControl.chatReplyTts.v1", "{bad-json");
  assert.equal(loadChatReplyTtsPref(storage).enabled, false);

  assert.deepEqual(resolveHoldTalkGestureState({}), {
    stateKey: "idle",
    label: "按住 说话",
    isDanger: false,
    isBusy: false,
    disabled: false,
  });
  assert.equal(resolveHoldTalkGestureState({ active: true }).stateKey, "recording");
  assert.equal(resolveHoldTalkGestureState({ active: true, cancelArmed: true }).stateKey, "cancel");
  assert.equal(resolveHoldTalkGestureState({ active: false, transcribing: true }).stateKey, "transcribing");

  const turns = [
    {
      id: "turn-1",
      items: [
        { type: "agentMessage", phase: "commentary", text: "先检查目录结构…" },
        {
          type: "agentMessage",
          text: [
            "我已经检查了三个核心模块并修复了竞态问题：",
            "",
            "```js",
            "const ok = await runCheck();",
            "```",
            "",
            "1. 修复了连接池泄漏并补齐超时保护；",
            "2. 调整了缓存刷新时机，避免并发抖动；",
            "3. 新增了回归单测覆盖边界输入。",
            "",
            "### 总结",
            "本次已完成连接池修复与回归验证，全部 24 项单测通过，可直接上线体验。",
          ].join("\n"),
        },
      ],
    },
  ];
  const extracted = extractFinalAssistantMessageFromTurns(turns);
  assert.equal(extracted.turnId, "turn-1");
  const summaryFromHeading = extractReplyClosingSummaryForSpeech(extracted.text, { maxChars: 200 });
  assert.equal(summaryFromHeading, "本次已完成连接池修复与回归验证，全部 24 项单测通过，可直接上线体验。");

  const longUnheaded = [
    "第一段详细背景说明：这里排查了初始化顺序、模块加载链路、事件订阅生命周期以及大量日志上下文，确保没有遗漏任何前置依赖和潜在副作用，同时核对了所有关联配置文件的默认值与降级逻辑。",
    "",
    "```bash",
    "npm test",
    "```",
    "",
    "第二段详细实现过程：我们在适配器层补充了幂等守卫，并对异步回调增加了取消令牌校验，防止旧轮次状态覆盖新轮次视图，确保高并发切换会话时界面始终稳定一致。",
    "",
    "以上改动已全部验证通过，你可以直接在手机端按住说话体验新交互。",
  ].join("\n");
  const tailSummary = extractReplyClosingSummaryForSpeech(longUnheaded, { maxChars: 140, minTailChars: 24 });
  assert.match(tailSummary, /以上改动已全部验证通过/);
  assert.doesNotMatch(tailSummary, /第一段详细背景说明/);
  assert.doesNotMatch(tailSummary, /代码部分已省略/);

  const indexHtml = await readFile(fileURLToPath(new URL("../public/index.html", import.meta.url)), "utf8");
  const appCss = await readFile(fileURLToPath(new URL("../public/app.css", import.meta.url)), "utf8");
  assert.match(indexHtml, /id="chatTtsToggleBtn"[^>]*class="[^"]*chat-tts-toggle-btn[^"]*"[^>]*hidden/);
  assert.doesNotMatch(indexHtml, /id="chatTtsToggleBtn"[^>]*class="[^"]*mobile-only[^"]*"/);
  const submitGroupMatch = indexHtml.match(/<div class="composer-submit-group">([\s\S]*?)<\/div>/);
  assert.ok(submitGroupMatch?.[1], "composer-submit-group should exist");
  const voiceIdx = submitGroupMatch[1].indexOf('id="composerVoiceBtn"');
  const sendIdx = submitGroupMatch[1].indexOf('id="sendBtn"');
  assert.ok(voiceIdx >= 0 && sendIdx > voiceIdx, "composerVoiceBtn should sit immediately before sendBtn on the right");
  assert.match(indexHtml, /id="composerHoldBar"[^>]*hidden/);
  assert.match(indexHtml, /id="composerHoldTalkBtn"/);
  assert.match(indexHtml, /id="composerHoldKeyboardBtn"/);
  assert.match(appCss, /\.composer-hold-talk-btn\s*\{[\s\S]*?touch-action:\s*none;/);
});

test("mobile composer guards prevent soft-keyboard dismiss or Return key from auto-updating queued tasks", () => {
  assert.equal(shouldSubmitPromptOnEnter({ key: "Enter", isMobileTouch: false }), true);
  assert.equal(shouldSubmitPromptOnEnter({ key: "Enter", shiftKey: true, isMobileTouch: false }), false);
  assert.equal(shouldSubmitPromptOnEnter({ key: "Enter", isComposing: true, isMobileTouch: false }), false);
  assert.equal(shouldSubmitPromptOnEnter({ key: "Enter", keyCode: 229, isMobileTouch: false }), false);
  assert.equal(shouldSubmitPromptOnEnter({ key: "Enter", isMobileTouch: true }), false);

  assert.equal(
    shouldAllowSendButtonClick({
      isMobileTouch: false,
      isEditingQueue: true,
      nowMs: 1000,
      lastKeyboardCollapseAtMs: 950,
      lastPromptBlurAtMs: 950,
      pointerDownAtMs: 0,
      pointerDownHadRecentCollapse: true,
      clickDetail: 0,
    }),
    true,
  );

  assert.equal(
    shouldAllowSendButtonClick({
      isMobileTouch: true,
      isEditingQueue: true,
      nowMs: 1000,
      lastKeyboardCollapseAtMs: 920,
      lastPromptBlurAtMs: 910,
      pointerDownAtMs: 890,
      pointerDownHadRecentCollapse: false,
      clickDetail: 1,
    }),
    true,
  );

  assert.equal(
    shouldAllowSendButtonClick({
      isMobileTouch: true,
      isEditingQueue: true,
      nowMs: 1600,
      lastKeyboardCollapseAtMs: 1000,
      lastPromptBlurAtMs: 1000,
      pointerDownAtMs: 1560,
      pointerDownHadRecentCollapse: false,
      clickDetail: 1,
    }),
    true,
  );

  assert.equal(
    shouldAllowSendButtonClick({
      isMobileTouch: true,
      isEditingQueue: false,
      nowMs: 1200,
      lastKeyboardCollapseAtMs: 1050,
      lastPromptBlurAtMs: 0,
      pointerDownAtMs: 0,
      clickDetail: 1,
    }),
    false,
  );

  assert.equal(
    shouldAllowSendButtonClick({
      isMobileTouch: true,
      isEditingQueue: false,
      nowMs: 1200,
      lastKeyboardCollapseAtMs: 0,
      lastPromptBlurAtMs: 1050,
      pointerDownAtMs: 0,
      clickDetail: 1,
    }),
    false,
  );

  assert.equal(
    shouldAllowSendButtonClick({
      isMobileTouch: true,
      isEditingQueue: true,
      nowMs: 5000,
      lastKeyboardCollapseAtMs: 0,
      lastPromptBlurAtMs: 0,
      pointerDownAtMs: 0,
      clickDetail: 1,
    }),
    false,
  );

  assert.equal(
    shouldAllowSendButtonClick({
      isMobileTouch: true,
      isEditingQueue: true,
      nowMs: 1300,
      lastKeyboardCollapseAtMs: 1000,
      lastPromptBlurAtMs: 980,
      pointerDownAtMs: 1220,
      pointerDownHadRecentCollapse: true,
      clickDetail: 1,
    }),
    false,
  );
});

test("renderTurnHtml renders multiline turn-error with expandable raw detail and inline retry button only on latest turn", () => {
  const errTurn = {
    id: "turn-err-401",
    status: "failed",
    error: {
      message: "Agent execution terminated due to error.\nUNAUTHENTICATED (code 401): invalid_token",
      detail: "HTTP 401 Unauthorized\n{\"error\":{\"code\":401}}",
    },
    items: [
      { type: "userMessage", id: "u-err-1", content: [{ type: "text", text: "继续提交" }] },
    ],
  };

  const latestHtml = renderTurnHtml(errTurn, {
    agentLabel: "Antigravity",
    threadId: "antigravity:desktop:t-err-1",
    supersededByNextTurn: false,
  });
  assert.match(latestHtml, /class="turn-error-main"[^>]*>Agent execution terminated due to error\.\nUNAUTHENTICATED \(code 401\): invalid_token<\/div>/);
  assert.match(latestHtml, /<button type="button" class="turn-resume-inline-btn is-error-retry" data-resume-interrupted-turn="1">▶ 重试继续<\/button>/);
  assert.match(latestHtml, /<details class="turn-error-details"><summary>查看原始错误详情<\/summary><pre class="turn-error-pre">HTTP 401 Unauthorized/);

  const goalHtml = renderTurnHtml(errTurn, {
    agentLabel: "Antigravity",
    threadId: "antigravity:desktop:t-err-1",
    supersededByNextTurn: false,
    goalSuspended: true,
  });
  assert.match(goalHtml, /data-resume-interrupted-turn="1">▶ 恢复 Goal<\/button>/);

  const oldHtml = renderTurnHtml(errTurn, {
    agentLabel: "Antigravity",
    threadId: "antigravity:desktop:t-err-1",
    supersededByNextTurn: true,
  });
  assert.doesNotMatch(oldHtml, /data-resume-interrupted-turn="1"/);
  assert.match(oldHtml, /<details class="turn-error-details">/);
});

test("sidebar, project board, and task strip highlight failed threads with red error badges, summaries, and top banner", () => {
  const nowSec = 1_795_590_000;
  const cwd = "/tmp/demo-err-proj";
  const failedThread = {
    id: "antigravity:desktop:err-1",
    provider: "antigravity",
    profileId: "desktop",
    cwd,
    title: "Play Store Link Request",
    preview: "正在填写商店设置",
    live: false,
    lastTurnStatus: "failed",
    lastError: "Agent execution terminated due to error.\nUNAUTHENTICATED (code 401): invalid_token",
    lastErrorAt: nowSec - 60,
    updatedAt: nowSec - 86400 * 3,
  };
  const okThread = {
    id: "antigravity:desktop:ok-1",
    provider: "antigravity",
    profileId: "desktop",
    cwd,
    title: "正常任务",
    preview: "已完成",
    live: false,
    updatedAt: nowSec - 30,
  };

  assert.equal(isThreadFailed(failedThread), true);
  assert.equal(isThreadFailed({ ...failedThread, live: true }), false);
  assert.equal(compactThreadErrorSummary(failedThread), "UNAUTHENTICATED (code 401): invalid_token");

  const groups = buildProjectGroups([okThread, failedThread], {
    projectsMeta: { [cwd]: { alias: "图片翻译" } },
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].errorCount, 1);

  const partitioned = partitionSidebarProjectGroups(groups, { nowMs: nowSec * 1000 });
  assert.equal(partitioned.primaryGroups.length, 1);
  assert.equal(partitioned.staleGroups.length, 0);

  const sidebarHtml = renderSidebarThreadListHtml(groups, {
    activeThreadId: okThread.id,
    nowMs: nowSec * 1000,
    staleThreadAgeSec: 3600,
  });
  assert.match(sidebarHtml, /project-group[^"]*has-error/);
  assert.match(sidebarHtml, /group-stat-pill is-error"[^>]*>报错 1<\/span>/);
  assert.match(sidebarHtml, /thread-item[^"]*is-error/);
  assert.match(sidebarHtml, /thread-status-dot is-error is-agent-marker/);
  assert.match(sidebarHtml, /thread-error-pill"[^>]*>报错<\/span>/);
  assert.match(sidebarHtml, /thread-item-sub is-error-sub"[^>]*>UNAUTHENTICATED \(code 401\): invalid_token<\/span>/);

  const boardHtml = renderProjectBoardHtml({
    groups,
    activeThreadId: okThread.id,
  });
  assert.match(boardHtml, /board-attention-banner is-error/);
  assert.match(boardHtml, /有 1 个任务因报错中断/);
  assert.match(boardHtml, /board-status-pill is-error"[^>]*>报错 1<\/span>/);
  assert.match(boardHtml, /board-status-pill is-error"[^>]*>报错中断<\/span>/);
  assert.match(boardHtml, /board-task-row[^"]*is-error/);
  assert.match(boardHtml, /board-task-preview is-error"[^>]*>UNAUTHENTICATED \(code 401\): invalid_token<\/div>/);

  const stripHtml = renderProjectTaskStripHtml({
    projectGroup: groups[0],
    activeThreadId: okThread.id,
  });
  assert.match(stripHtml, /strip-task-pill[^"]*is-error/);
  assert.match(stripHtml, /strip-status-dot[^"]*is-error/);
  assert.match(stripHtml, /thread-error-pill"[^>]*>报错<\/span>/);
});
