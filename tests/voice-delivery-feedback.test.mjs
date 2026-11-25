import assert from "node:assert/strict";
import { execFile as nodeExecFile } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createHotExtensionServer } from "../src/hot-extension.mjs";
import { createAgentControlServer } from "../src/server.mjs";
import {
  DEFAULT_VOICE_HYDROGEN_MODEL,
  VoiceCallService,
  analyzeWavPcm16Activity,
  estimateSpeechDurationMs,
  minAudibleDurationMs,
  pickPreferredHydrogenModel,
  pickPreferredVoiceModel,
} from "../src/voice-call-service.mjs";
import {
  createVadTurnDetector,
  encodePcm16SamplesToWav,
  enqueueVoiceBroadcastItem,
  estimateVoiceDurationMs,
  evaluateVoicePlaybackOutcome,
  humanizeVoiceDeliveryReason,
  minVoiceAudibleMs,
  normalizeVoiceConfig,
  normalizeVoiceTtsPayload,
  parseVoiceModelSelectionKey,
  renderVoiceCallTranscriptHtml,
  renderVoiceModelSelectOptionsHtml,
  renderVoiceUnheardBannerHtml,
} from "../public/voice-copilot.js";

const MOCK_CODEX_BIN = fileURLToPath(new URL("./helpers/mock-codex-cli.mjs", import.meta.url));
const MOCK_CLAUDE_BIN = fileURLToPath(new URL("./helpers/mock-claude-cli.mjs", import.meta.url));
const MOCK_AGY_BIN = fileURLToPath(new URL("./helpers/mock-agy-cli.mjs", import.meta.url));
const MOCK_EDGE_TTS_BIN = fileURLToPath(new URL("./helpers/mock-edge-tts.mjs", import.meta.url));
const MOCK_MAC_SAY_BIN = fileURLToPath(new URL("./helpers/mock-macos-say.mjs", import.meta.url));
const MOCK_VOICE_ASR_BIN = fileURLToPath(new URL("./helpers/mock-voice-asr.mjs", import.meta.url));

const EMOJI_RE = /\p{Extended_Pictographic}/u;

test("speech duration estimation and min audible threshold", () => {
  assert.ok(estimateSpeechDurationMs("你好") >= 600);
  assert.equal(estimateVoiceDurationMs("正在为你查询示例商城后台进度"), estimateSpeechDurationMs("正在为你查询示例商城后台进度"));
  assert.equal(minAudibleDurationMs(""), 0);
  assert.equal(minVoiceAudibleMs(""), 0);
  assert.ok(minAudibleDurationMs("示例商城后台已经完成构建。") >= 180);


});

test("normalizeVoiceTtsPayload and evaluateVoicePlaybackOutcome catch silent, muted, fake short end, and interruption cases", () => {
  const flatTts = normalizeVoiceTtsPayload({ audioBase64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEA", mimeType: "audio/mpeg", provider: "edge-tts", text: "测试" });
  assert.equal(flatTts.hasAudio, true);
  assert.equal(flatTts.provider, "edge-tts");

  const nestedTts = normalizeVoiceTtsPayload({ utteranceId: "u1", tts: { audioBase64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEA", mimeType: "audio/wav", provider: "macos-say" } });
  assert.equal(nestedTts.hasAudio, true);
  assert.equal(nestedTts.utteranceId, "u1");
  assert.equal(nestedTts.provider, "macos-say");

  const emptyTts = normalizeVoiceTtsPayload({ utteranceId: "u2", spokenReply: "纯文本", tts: { audioBase64: "", mimeType: "", provider: "none" } });
  assert.equal(emptyTts.hasAudio, false);

  const ok = evaluateVoicePlaybackOutcome({ outcome: "ended", text: "当前任务已完成。", playedMs: 1400, started: true, muted: false, volume: 1 });
  assert.equal(ok.status, "played");
  assert.equal(ok.heard, true);

  const fakeShort = evaluateVoicePlaybackOutcome({ outcome: "ended", text: "当前任务已完成，可以查看结果。", playedMs: 15, started: true, muted: false, volume: 1 });
  assert.equal(fakeShort.status, "unheard");
  assert.equal(fakeShort.heard, false);
  assert.equal(fakeShort.reason, "fake_short_end");

  const notStarted = evaluateVoicePlaybackOutcome({ outcome: "ended", text: "测试文本", playedMs: 300, started: false, muted: false, volume: 1 });
  assert.equal(notStarted.heard, false);
  assert.equal(notStarted.reason, "fake_short_end");

  const mutedOut = evaluateVoicePlaybackOutcome({ outcome: "ended", text: "测试文本", playedMs: 1200, started: true, muted: true, volume: 1 });
  assert.equal(mutedOut.heard, false);
  assert.equal(mutedOut.reason, "muted_output");

  const autoplayOut = evaluateVoicePlaybackOutcome({ outcome: "error", reason: "autoplay_blocked", text: "测试文本", playedMs: 0, started: false });
  assert.equal(autoplayOut.heard, false);
  assert.equal(autoplayOut.reason, "autoplay_blocked");
  assert.equal(humanizeVoiceDeliveryReason(autoplayOut.reason), "自动播放受限");

  const earlyInterrupt = evaluateVoicePlaybackOutcome({ outcome: "interrupted", reason: "user_barge_in", text: "这是一段比较长的播报", expectedMs: 3000, playedMs: 250, started: true, priority: "normal" });
  assert.equal(earlyInterrupt.status, "interrupted");
  assert.equal(earlyInterrupt.heard, false);

  const lateNormalInterrupt = evaluateVoicePlaybackOutcome({ outcome: "interrupted", reason: "user_barge_in", text: "这是一段比较长的播报", expectedMs: 3000, playedMs: 1500, started: true, priority: "normal" });
  assert.equal(lateNormalInterrupt.status, "interrupted");
  assert.equal(lateNormalInterrupt.heard, true);

  const lateCriticalInterrupt = evaluateVoicePlaybackOutcome({ outcome: "interrupted", reason: "user_barge_in", text: "待确认权限", expectedMs: 3000, playedMs: 1600, started: true, priority: "critical" });
  assert.equal(lateCriticalInterrupt.status, "interrupted");
  assert.equal(lateCriticalInterrupt.heard, false);
});

test("broadcast priority queue, unheard banner HTML, and transcript delivery chips render cleanly without emojis", () => {
  let queue = [];
  queue = enqueueVoiceBroadcastItem(queue, { id: "n1", text: "任务A完成", priority: "normal", dedupeKey: "done:a" }, 8);
  queue = enqueueVoiceBroadcastItem(queue, { id: "n2", text: "请求审批：git push", priority: "critical", dedupeKey: "req:1" }, 8);
  queue = enqueueVoiceBroadcastItem(queue, { id: "n3", text: "请求审批：git push 更新", priority: "critical", dedupeKey: "req:1" }, 8);
  assert.equal(queue.length, 2);
  assert.equal(queue[0].dedupeKey, "req:1");
  assert.equal(queue[0].priority, "critical");
  assert.equal(queue[0].text, "请求审批：git push 更新");
  assert.equal(queue[1].id, "n1");

  assert.equal(renderVoiceUnheardBannerHtml([]), "");
  const bannerHtml = renderVoiceUnheardBannerHtml([
    { id: "u1", text: "示例商城后台已经完成测试。", reason: "autoplay_blocked" },
  ]);
  assert.match(bannerHtml, /data-voice-replay-all="1"/);
  assert.match(bannerHtml, /data-voice-dismiss-unheard="1"/);
  assert.match(bannerHtml, /自动播放受限/);
  assert.match(bannerHtml, /<svg\b/);
  assert.equal(EMOJI_RE.test(bannerHtml), false);

  const transcriptHtml = renderVoiceCallTranscriptHtml([
    { id: "u1", heardText: "查看进度", spokenReply: "未听到回复", deliveryStatus: "unheard", heard: false, deliveryReason: "fake_short_end" },
    { id: "u2", heardText: "再说一遍", spokenReply: "已正常回复", deliveryStatus: "played", heard: true },
  ]);
  assert.match(transcriptHtml, /is-unheard/);
  assert.match(transcriptHtml, /未正常出声/);
  assert.match(transcriptHtml, /已播报/);
  assert.match(transcriptHtml, /data-voice-replay="u1"/);
  assert.match(transcriptHtml, /data-voice-replay="u2"/);
  assert.equal(EMOJI_RE.test(transcriptHtml), false);
});

test("VoiceCallService synthesizes server macOS say fallback and reports no audio when server TTS is unavailable", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-voice-tts-fallback-"));
  const dataDir = resolve(root, "data");
  await mkdir(dataDir, { recursive: true });
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const fakeHub = {
    async listThreads() { return []; },
    async listProjectGroups() { return []; },
    listPendingRequests() { return []; },
  };

  const restrictedPath = `${dirname(process.execPath)}:/usr/bin:/bin`;

  const withSayService = new VoiceCallService({
    hub: fakeHub,
    dataDir,
    env: {
      HOME: root,
      PATH: restrictedPath,
      EDGE_TTS_BIN: "/nonexistent/edge-tts-bin",
      MACOS_SAY_BIN: MOCK_MAC_SAY_BIN,
    },
  });
  const startSay = await withSayService.startCall({ callId: "say-call-1" });
  assert.equal(startSay.ttsEngine, "macos-say");

  const sayTts = await withSayService.synthesizeSpeech("测试离线语音兜底", { callId: "say-call-1" });
  assert.equal(sayTts.provider, "macos-say");
  assert.equal(sayTts.mimeType, "audio/wav");
  const wavBuf = Buffer.from(sayTts.audioBase64, "base64");
  assert.equal(wavBuf.subarray(0, 4).toString("ascii"), "RIFF");
  assert.ok(wavBuf.length > 100);
  await withSayService.close();

  const browserOnlyService = new VoiceCallService({
    hub: fakeHub,
    dataDir,
    env: {
      HOME: root,
      PATH: restrictedPath,
      EDGE_TTS_BIN: "/nonexistent/edge-tts-bin",
      MACOS_SAY_BIN: "none",
    },
  });
  const startBrowser = await browserOnlyService.startCall({ callId: "browser-call-1" });
  assert.equal(startBrowser.ttsEngine, "none");
  const browserTts = await browserOnlyService.synthesizeSpeech("浏览器朗读兜底", { callId: "browser-call-1" });
  assert.equal(browserTts.provider, "none");
  assert.equal(browserTts.audioBase64, "");
  await browserOnlyService.close();
});

test("Voice delivery ack, status ledger, repeat_last, fake-short-end downgrade, and single auto-compensation work end-to-end", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-voice-e2e-"));
  const codexHome = resolve(root, "codex");
  const claudeHome = resolve(root, "claude");
  const agyCli = resolve(root, "agy-cli");
  const dataDir = resolve(root, "data");
  const appsDir = resolve(root, "apps");
  const projectDir = resolve(root, "示例商城后台");
  await Promise.all([
    mkdir(codexHome, { recursive: true }),
    mkdir(claudeHome, { recursive: true }),
    mkdir(agyCli, { recursive: true }),
    mkdir(dataDir, { recursive: true }),
    mkdir(appsDir, { recursive: true }),
    mkdir(projectDir, { recursive: true }),
  ]);

  const env = {
    ...process.env,
    CODEX_BIN: MOCK_CODEX_BIN,
    CLAUDE_BIN: MOCK_CLAUDE_BIN,
    AGY_BIN: MOCK_AGY_BIN,
    EDGE_TTS_BIN: MOCK_EDGE_TTS_BIN,
    MACOS_SAY_BIN: MOCK_MAC_SAY_BIN,
    VOICE_ASR_BIN: MOCK_VOICE_ASR_BIN,
    AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", label: "Codex 默认", home: codexHome }]),
    AGENT_CONTROL_CLAUDE_CONFIG_DIRS: JSON.stringify([{ id: "default", label: "Claude 默认", home: claudeHome }]),
    AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "cli", label: "Antigravity CLI", home: agyCli, profileType: "cli" }]),
  };

  const srv = await createAgentControlServer({
    port: 0,
    disableRelay: true,
    dataDir,
    appsDir,
    env,
  });
  await srv.start();
  const hot = await createHotExtensionServer({
    port: 0,
    upstreamOrigin: srv.url,
    dataDir,
    env,
  });

  t.after(async () => {
    await Promise.allSettled([hot.close(), srv.close()]);
    await rm(root, { recursive: true, force: true });
  });

  await writeFile(
    resolve(appsDir, "ac-hot.json"),
    JSON.stringify({ id: "ac-hot", name: "Agent Control Hot API", origin: hot.url }),
  );

  // Create target thread for 示例商城后台.
  const createdRes = await fetch(`${srv.url}/api/thread/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "antigravity",
      profileId: "cli",
      cwd: projectDir,
      text: "示例商城后台 初始化 [COMPLETE_NOW]",
      permissionMode: "turbo",
    }),
  });
  assert.equal(createdRes.status, 200);

  const callId = "call-e2e-delivery";
  const startRes = await fetch(`${srv.url}/apps/ac-hot/api/voice/call/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callId }),
  });
  assert.equal(startRes.status, 200);

  // 1. First turn with tts: false keeps empty audio payload while returning utteranceId and expectedMs.
  const turn1Res = await fetch(`${srv.url}/apps/ac-hot/api/voice/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callId, transcriptText: "示例商城后台现在什么进度", mode: "turn", tts: false }),
  });
  assert.equal(turn1Res.status, 200);
  const turn1 = await turn1Res.json();
  assert.ok(turn1.utteranceId);
  assert.ok(turn1.expectedMs >= 600);
  assert.equal(turn1.tts?.audioBase64, "");
  assert.equal(turn1.tts?.provider, "none");

  // 2. Report autoplay_blocked ack and verify call/status reflects 1 unheard utterance.
  const ack1Res = await fetch(`${srv.url}/apps/ac-hot/api/voice/call/ack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callId,
      utteranceId: turn1.utteranceId,
      status: "unheard",
      heard: false,
      playedMs: 0,
      expectedMs: turn1.expectedMs,
      reason: "autoplay_blocked",
      provider: "edge-tts",
      text: turn1.spokenReply,
    }),
  });
  assert.equal(ack1Res.status, 200);

  const status1Res = await fetch(`${srv.url}/apps/ac-hot/api/voice/call/status?callId=${encodeURIComponent(callId)}`);
  assert.equal(status1Res.status, 200);
  const status1 = await status1Res.json();
  assert.equal(status1.unheardCount, 1);
  assert.equal(status1.unheardItems[0].utteranceId, turn1.utteranceId);

  // 3. User says "刚才没听清，再说一遍" -> repeats last unheard reply without creating a new task turn.
  const repeatRes = await fetch(`${srv.url}/apps/ac-hot/api/voice/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callId, transcriptText: "刚才没听清，再说一遍", mode: "turn", tts: false }),
  });
  assert.equal(repeatRes.status, 200);
  const repeatJson = await repeatRes.json();
  assert.equal(repeatJson.executed?.action, "repeat_last");
  assert.ok(repeatJson.replayedUnheardIds.includes(turn1.utteranceId));

  // Ack the repeated utterance as played cleanly -> unheardCount drops to 0.
  const ack2Res = await fetch(`${srv.url}/apps/ac-hot/api/voice/call/ack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callId,
      utteranceId: repeatJson.utteranceId,
      status: "played",
      heard: true,
      playedMs: 1400,
      expectedMs: repeatJson.expectedMs,
      provider: "edge-tts",
      text: repeatJson.spokenReply,
    }),
  });
  assert.equal(ack2Res.status, 200);
  const ack2Json = await ack2Res.json();
  assert.equal(ack2Json.unheardCount, 0);

  // 4. Fake-short-end protection: claiming "played" with playedMs=15 is downgraded to unheard/fake_short_end.
  const turn3Res = await fetch(`${srv.url}/apps/ac-hot/api/voice/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callId, transcriptText: "汇报当前状态", mode: "briefing", tts: false }),
  });
  assert.equal(turn3Res.status, 200);
  const turn3 = await turn3Res.json();

  const fakeAckRes = await fetch(`${srv.url}/apps/ac-hot/api/voice/call/ack`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callId,
      utteranceId: turn3.utteranceId,
      status: "played",
      heard: true,
      playedMs: 15,
      expectedMs: turn3.expectedMs,
      provider: "edge-tts",
      text: turn3.spokenReply,
    }),
  });
  assert.equal(fakeAckRes.status, 200);
  const fakeAckJson = await fakeAckRes.json();
  assert.equal(fakeAckJson.deliveryStatus, "unheard");
  assert.equal(fakeAckJson.heard, false);
  assert.equal(fakeAckJson.reason, "fake_short_end");
  assert.equal(fakeAckJson.unheardCount, 1);

  // 5. Next normal turn passes unheard items to the coordinator for natural merging (no robotic prefix) & clears turn3.
  const turn4Res = await fetch(`${srv.url}/apps/ac-hot/api/voice/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callId, transcriptText: "让 示例商城后台 跑一下检查 [COMPLETE_NOW]", mode: "turn", tts: false }),
  });
  assert.equal(turn4Res.status, 200);
  const turn4 = await turn4Res.json();
  assert.ok(turn4.replayedUnheardIds.includes(turn3.utteranceId));
  assert.equal(turn4.spokenReply.includes("另外补播刚才未听到的提醒"), false);

  // Direct offline TTS route check with preferOffline=true uses macOS say WAV mock.
  const offlineTtsRes = await fetch(`${srv.url}/apps/ac-hot/api/voice/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: "离线兜底语音测试", callId, preferOffline: true, register: false }),
  });
  assert.equal(offlineTtsRes.status, 200);
  const offlineTts = await offlineTtsRes.json();
  assert.equal(offlineTts.provider, "macos-say");
  assert.equal(offlineTts.mimeType, "audio/wav");
  assert.equal(Buffer.from(offlineTts.audioBase64, "base64").subarray(0, 4).toString("ascii"), "RIFF");

  // 6. asyncDispatch returns Batch 1 immediately and updates status.dispatchBatches after Batch 2 settles.
  const asyncTurnRes = await fetch(`${srv.url}/apps/ac-hot/api/voice/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      callId,
      transcriptText: "让 示例商城后台 再跑一轮测试 [COMPLETE_NOW]",
      mode: "turn",
      autoExecute: true,
      asyncDispatch: true,
      tts: false,
    }),
  });
  assert.equal(asyncTurnRes.status, 200);
  const asyncTurn = await asyncTurnRes.json();
  assert.equal(asyncTurn.dispatchPending, true);
  assert.ok(asyncTurn.batchId);
  assert.equal(asyncTurn.executed?.pending, true);
  assert.match(asyncTurn.spokenReply, /正在转达给|示例商城后台/);

  let settledBatch = null;
  for (let i = 0; i < 40; i += 1) {
    const stRes = await fetch(`${srv.url}/apps/ac-hot/api/voice/call/status?callId=${encodeURIComponent(callId)}`);
    assert.equal(stRes.status, 200);
    const stJson = await stRes.json();
    settledBatch = (stJson.dispatchBatches || []).find(
      (b) => b.batchId === asyncTurn.batchId && b.status !== "dispatching",
    );
    if (settledBatch) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(settledBatch, "expected Batch 2 status to settle");
  assert.equal(settledBatch.status, "dispatched");
});

test("asyncDispatch splits fast oral ACK from slow background dispatch, handles 409 queue & error feedback, and caches short TTS phrases", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-voice-async-batch-"));
  const dataDir = resolve(root, "data");
  await mkdir(dataDir, { recursive: true });
  const execFileAsync = promisify(nodeExecFile);
  let edgeTtsCalls = 0;

  let mode = "slow";
  let queuedCount = 0;
  const mockHub = {
    async listThreads() {
      return {
        threads: [
          {
            id: "antigravity:cli:t-fans",
            provider: "antigravity",
            profileId: "cli",
            cwd: "/dev/示例商城后台",
            title: "示例商城后台 联调",
            live: false,
            updatedAt: Date.now(),
          },
        ],
        projectsMeta: {
          "/dev/示例商城后台": { alias: "示例商城后台" },
        },
      };
    },
    async listProvidersAndProfiles() {
      return { profiles: [{ provider: "antigravity", id: "cli", authenticated: true, installed: true }] };
    },
    allPendingRequests() {
      return [];
    },
    async readThread() {
      return null;
    },
    async sendTurn() {
      if (mode === "slow") {
        await new Promise((r) => setTimeout(r, 240));
        return { ok: true };
      }
      if (mode === "conflict") {
        throw Object.assign(new Error("busy"), { status: 409 });
      }
      throw new Error("模型额度不足");
    },
    async queueTurn() {
      queuedCount += 1;
      return { ok: true };
    },
  };

  const emittedEvents = [];
  const svc = new VoiceCallService({
    hub: mockHub,
    dataDir,
    env: {
      ...process.env,
      EDGE_TTS_BIN: MOCK_EDGE_TTS_BIN,
      MACOS_SAY_BIN: MOCK_MAC_SAY_BIN,
      VOICE_ASR_BIN: MOCK_VOICE_ASR_BIN,
      AGY_BIN: MOCK_AGY_BIN,
    },
    execFileImpl: async (cmd, args, opts) => {
      if (String(cmd).includes("mock-edge-tts")) edgeTtsCalls += 1;
      return execFileAsync(cmd, args, opts);
    },
    onEvent: (name, payload) => emittedEvents.push({ name, payload }),
  });

  t.after(async () => {
    await svc.close();
    await rm(root, { recursive: true, force: true });
  });

  const callId = "call-async-unit";
  await svc.startCall({ callId });

  // 1. Slow sendTurn (240ms) should NOT block Batch 1 oral ACK.
  const t0 = Date.now();
  const res1 = await svc.handleTurn({
    callId,
    transcriptText: "让 示例商城后台 跑一下构建",
    autoExecute: true,
    asyncDispatch: true,
    tts: false,
  });
  const elapsedMs = Date.now() - t0;
  assert.ok(elapsedMs < 180, `Batch 1 should return before 240ms sendTurn finishes (got ${elapsedMs}ms)`);
  assert.equal(res1.dispatchPending, true);
  assert.equal(res1.executed.pending, true);
  assert.ok(res1.batchId);
  assert.equal(res1.plan.intent, "send_turn");
  assert.equal(res1.plan.targetThreadId, "antigravity:cli:t-fans");

  for (let i = 0; i < 30; i += 1) {
    if (emittedEvents.some((e) => e.name === "voice_dispatch" && e.payload.batchId === res1.batchId)) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const evt1 = emittedEvents.find((e) => e.name === "voice_dispatch" && e.payload.batchId === res1.batchId)?.payload;
  assert.equal(evt1?.status, "dispatched");
  assert.equal(evt1?.focusThreadId, "antigravity:cli:t-fans");

  // 2. 409 conflict falls back to queueTurn and emits spoken queued notice.
  mode = "conflict";
  const res2 = await svc.handleTurn({
    callId,
    transcriptText: "让 示例商城后台 再检查日志",
    autoExecute: true,
    asyncDispatch: true,
    tts: false,
  });
  for (let i = 0; i < 30; i += 1) {
    if (emittedEvents.some((e) => e.name === "voice_dispatch" && e.payload.batchId === res2.batchId)) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const evt2 = emittedEvents.find((e) => e.name === "voice_dispatch" && e.payload.batchId === res2.batchId)?.payload;
  assert.equal(queuedCount, 1);
  assert.equal(evt2?.status, "queued");
  assert.equal(evt2?.queued, true);
  assert.equal(evt2?.shouldSpeak, true);
  assert.match(evt2?.spokenFeedback || "", /排队/);

  // 3. Downstream error emits critical failure voice_dispatch event.
  mode = "error";
  const res3 = await svc.handleTurn({
    callId,
    transcriptText: "让 示例商城后台 部署测试",
    autoExecute: true,
    asyncDispatch: true,
    tts: false,
  });
  for (let i = 0; i < 30; i += 1) {
    if (emittedEvents.some((e) => e.name === "voice_dispatch" && e.payload.batchId === res3.batchId)) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const evt3 = emittedEvents.find((e) => e.name === "voice_dispatch" && e.payload.batchId === res3.batchId)?.payload;
  assert.equal(evt3?.status, "failed");
  assert.equal(evt3?.priority, "critical");
  assert.equal(evt3?.shouldSpeak, true);
  assert.match(evt3?.spokenFeedback || "", /模型额度不足/);

  // 4. Short-phrase TTS LRU cache avoids invoking edge-tts binary twice for the same short ACK.
  const tts1 = await svc.synthesizeSpeech({ text: "好的，正在处理。", callId, register: false });
  const callsAfterFirst = edgeTtsCalls;
  const tts2 = await svc.synthesizeSpeech({ text: "好的，正在处理。", callId, register: false });
  assert.equal(callsAfterFirst, 1);
  assert.equal(edgeTtsCalls, 1);
  assert.equal(tts1.audioBase64, tts2.audioBase64);
});

test("Voice model routing prioritizes fast Hydrogen over slower Carbon/Orchestrator defaults", async (t) => {
  // 1. pickPreferredHydrogenModel always picks lowest-latency Hydrogen first and never defaults to slow Carbon/Orchestrator.
  assert.equal(
    pickPreferredHydrogenModel([
      { id: "gemini-4-carbon-medium", displayName: "Gemini 4 Carbon (Medium)" },
      { id: "gemini-pro-orchestrator", displayName: "Orchestrator (Carbon)" },
      { id: "gemini-4-hydrogen-high", displayName: "Gemini 4 Hydrogen (High)" },
      { id: "gemini-4-hydrogen-medium", displayName: "Gemini 4 Hydrogen (Medium)" },
      { id: "gemini-4-hydrogen-low", displayName: "Gemini 4 Hydrogen (Low)" },
      { id: "gemini-3.8-flash-low", displayName: "Gemini 3.8 Flash (Low)" },
    ]),
    "gemini-4-hydrogen-low",
  );
  assert.equal(
    pickPreferredHydrogenModel([
      { id: "gemini-pro-orchestrator", displayName: "Orchestrator (Carbon)" },
      { id: "gemini-4-carbon-medium", displayName: "Gemini 4 Carbon (Medium)" },
    ]),
    DEFAULT_VOICE_HYDROGEN_MODEL,
  );
  assert.equal(pickPreferredHydrogenModel([]), DEFAULT_VOICE_HYDROGEN_MODEL);

  // 3. Service execution defaults voice-created threads to fast Hydrogen (low effort), and routes explicit hydrogen turns cleanly.
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-voice-model-route-"));
  const dataDir = resolve(root, "data");
  await mkdir(dataDir, { recursive: true });
  const startedCalls = [];
  const sentTurnCalls = [];

  const mockHub = {
    async listThreads() {
      return {
        threads: [
          {
            id: "antigravity:cli:t-existing",
            provider: "antigravity",
            profileId: "cli",
            cwd: "/dev/demo-shop",
            title: "示例商城后台 旧会话",
            model: "gemini-4-carbon-medium",
            live: false,
            updatedAt: Date.now(),
          },
        ],
        projectsMeta: {
          "/dev/demo-shop": { alias: "示例商城后台" },
        },
      };
    },
    async listProvidersAndProfiles() {
      return {
        profiles: [
          { provider: "codex", id: "default", installed: true, authenticated: true },
          { provider: "antigravity", id: "cli", installed: true, authenticated: true },
        ],
      };
    },
    allPendingRequests() {
      return [];
    },
    async readThread() {
      return null;
    },
    async startThread(args) {
      startedCalls.push(args);
      return {
        thread: {
          id: `antigravity:cli:t-new-${startedCalls.length}`,
          provider: args.provider,
          model: args.model,
        },
      };
    },
    async sendTurn(args) {
      sentTurnCalls.push(args);
      return { ok: true };
    },
  };

  const svc = new VoiceCallService({
    hub: mockHub,
    dataDir,
    env: {
      ...process.env,
      EDGE_TTS_BIN: MOCK_EDGE_TTS_BIN,
      MACOS_SAY_BIN: MOCK_MAC_SAY_BIN,
      VOICE_ASR_BIN: MOCK_VOICE_ASR_BIN,
      AGY_BIN: MOCK_AGY_BIN,
    },
  });
  t.after(async () => {
    await svc.close();
    await rm(root, { recursive: true, force: true });
  });

  const started = await svc.startCall({ callId: "call-model-route" });
  assert.equal(started.dispatchModel, "gemini-4-hydrogen-low");

  // Default create_thread assigns fast gemini-4-hydrogen-low (effort: low), not gemini-pro-orchestrator.
  const createRes = await svc.handleTurn({
    callId: "call-model-route",
    transcriptText: "在示例商城后台新开一个任务排查连接",
    autoExecute: true,
    tts: false,
  });
  assert.equal(createRes.executed.ok, true);
  assert.equal(startedCalls[0]?.provider, "antigravity");
  assert.equal(startedCalls[0]?.model, "gemini-4-hydrogen-low");
  assert.equal(startedCalls[0]?.effort, "low");
  assert.equal(createRes.executed.model, "gemini-4-hydrogen-low");

  // Explicit "用 hydrogen" on existing project thread overrides slow Carbon model on sendTurn with fast Hydrogen.
  const hydrogenTurnRes = await svc.handleTurn({
    callId: "call-model-route",
    transcriptText: "用 hydrogen 让示例商城后台跑一下检查",
    autoExecute: true,
    tts: false,
  });
  assert.equal(hydrogenTurnRes.executed.ok, true);
  assert.equal(sentTurnCalls[0]?.model, "gemini-4-hydrogen-low");
  assert.equal(sentTurnCalls[0]?.effort, "low");

  // Explicit heavy orchestrator request still honored when asked directly.
  await svc.handleTurn({
    callId: "call-model-route",
    transcriptText: "在示例商城后台新开一个协调者 carbon 任务做深度审计",
    autoExecute: true,
    tts: false,
  });
  assert.equal(startedCalls[1]?.provider, "antigravity");
  assert.equal(startedCalls[1]?.model, "gemini-pro-orchestrator");
});

test("VAD and VoiceCallService suppress silence, clicks, ambient noise, and Whisper hallucinations without triggering replies", async (t) => {
  // 1. Hardened VAD rejects single-frame click impulses and low-SNR room noise while keeping clear speech.
  const vad = createVadTurnDetector({
    sampleRate: 16000,
    preRollMs: 200,
    silenceMs: 300,
    minSpeechMs: 200,
    rmsThreshold: 0.018,
    adaptive: true,
    requireSustainedOnset: true,
    minPeakRms: 0.024,
    minSnrRatio: 2.2,
  });
  const roomHum = new Int16Array(1600).fill(350);
  for (let i = 0; i < 8; i += 1) {
    assert.equal(vad.pushSamples(roomHum, 0.008).type, "listening");
  }
  // Single-frame keyboard click / transient (0.035 < 0.065) followed by room hum should NOT trigger speech.
  assert.equal(vad.pushSamples(new Int16Array(1600).fill(1100), 0.035).type, "listening");
  assert.equal(vad.pushSamples(roomHum, 0.008).type, "listening");
  // Sustained low-energy noise barely above onset threshold fails minPeakRms / minSnrRatio and discards quietly.
  assert.equal(vad.pushSamples(new Int16Array(1600).fill(600), 0.019).type, "listening");
  assert.equal(vad.pushSamples(new Int16Array(1600).fill(600), 0.019).type, "speech_start");
  assert.equal(vad.pushSamples(new Int16Array(1600).fill(600), 0.019).type, "recording");
  vad.pushSamples(roomHum, 0.005);
  vad.pushSamples(roomHum, 0.005);
  const lowEnergyDone = vad.pushSamples(roomHum, 0.005);
  assert.equal(lowEnergyDone.type, "discarded_noise");

  // Clear human speech (> 0.024 & > 2.2x noise floor) emits utterance cleanly.
  const clearVoice = new Int16Array(1600).fill(2600);
  assert.equal(vad.pushSamples(clearVoice, 0.05).type, "listening");
  assert.equal(vad.pushSamples(clearVoice, 0.05).type, "speech_start");
  assert.equal(vad.pushSamples(clearVoice, 0.05).type, "recording");
  vad.pushSamples(roomHum, 0.004);
  vad.pushSamples(roomHum, 0.004);
  const speechDone = vad.pushSamples(roomHum, 0.004);
  assert.equal(speechDone.type, "utterance");

  // 3. Service handleTurn suppresses TTS/utterance registration/compensation on silence & ambient chatter, keeps briefing intact.
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-voice-silence-"));
  const dataDir = resolve(root, "data");
  await mkdir(dataDir, { recursive: true });
  let ttsInvocations = 0;
  const execFileAsync = promisify(nodeExecFile);
  const svc = new VoiceCallService({
    hub: {
      async listThreads() { return { threads: [], projectsMeta: {} }; },
      async listProvidersAndProfiles() { return { profiles: [] }; },
      allPendingRequests() { return []; },
      async readThread() { return null; },
    },
    dataDir,
    env: {
      ...process.env,
      EDGE_TTS_BIN: MOCK_EDGE_TTS_BIN,
      MACOS_SAY_BIN: MOCK_MAC_SAY_BIN,
      VOICE_ASR_BIN: MOCK_VOICE_ASR_BIN,
      AGY_BIN: MOCK_AGY_BIN,
    },
    execFileImpl: async (cmd, args, opts) => {
      if (String(cmd).includes("mock-edge-tts") || String(cmd).includes("mock-macos-say")) {
        ttsInvocations += 1;
      }
      return execFileAsync(cmd, args, opts);
    },
  });
  t.after(async () => {
    await svc.close();
    await rm(root, { recursive: true, force: true });
  });

  const callId = "call-silence-guard";
  await svc.startCall({ callId });
  svc.registerUtterance({
    callId,
    utteranceId: "utt-prior-missed",
    text: "之前的提醒内容",
    priority: "normal",
  });
  svc.recordPlaybackFeedback({
    callId,
    utteranceId: "utt-prior-missed",
    status: "unheard",
    reason: "autoplay_blocked",
  });

  for (const noiseText of ["", "嗯", "谢谢观看", "先把窗帘拉上吧"]) {
    const res = await svc.handleTurn({
      callId,
      transcriptText: noiseText,
      mode: "turn",
      tts: true,
    });
    assert.equal(res.noSpeech, true);
    assert.equal(res.spokenReply, "");
    assert.equal(res.utteranceId, "");
    assert.equal(res.tts.provider, "none");
    assert.equal(res.replayedUnheardIds.length, 0);
  }
  assert.equal(ttsInvocations, 0);
  // Missed utterance must still remain intact until real speech occurs.
  assert.equal(svc.getCallDeliveryStatus({ callId }).unheardCount, 1);

  // Explicit briefing button with empty text still speaks normally.
  const briefing = await svc.handleTurn({
    callId,
    transcriptText: "",
    mode: "briefing",
    tts: false,
  });
  assert.equal(Boolean(briefing.noSpeech), false);
  assert.ok(briefing.spokenReply.length > 0);
});

test("Local WAV PCM16 acoustic gate filters silence and ambient noise before calling Gemini or Whisper", async (t) => {
  const shortWav = encodePcm16SamplesToWav(new Int16Array(800).fill(3000), 16000);
  const silentWav = encodePcm16SamplesToWav(new Int16Array(4800), 16000);
  // Weak background hum with a tiny click (peak >= 0.015) but sustained RMS/frame RMS well below speech thresholds.
  const ambientSamples = new Int16Array(4800).fill(80);
  for (let i = 0; i < 6; i += 1) {
    ambientSamples[1000 + i] = 650;
  }
  const ambientWav = encodePcm16SamplesToWav(ambientSamples, 16000);
  const speechSamples = new Int16Array(4800);
  for (let i = 0; i < speechSamples.length; i += 1) {
    speechSamples[i] = Math.round(2400 * Math.sin((2 * Math.PI * 220 * i) / 16000));
  }
  const speechWav = encodePcm16SamplesToWav(speechSamples, 16000);

  const shortRes = analyzeWavPcm16Activity(shortWav);
  assert.equal(shortRes.inspected, true);
  assert.equal(shortRes.hasSpeech, false);
  assert.equal(shortRes.reason, "too_short_audio");

  const silentRes = analyzeWavPcm16Activity(silentWav);
  assert.equal(silentRes.inspected, true);
  assert.equal(silentRes.hasSpeech, false);
  assert.equal(silentRes.reason, "digital_silence");

  const ambientRes = analyzeWavPcm16Activity(ambientWav);
  assert.equal(ambientRes.inspected, true);
  assert.equal(ambientRes.hasSpeech, false);
  assert.equal(ambientRes.reason, "ambient_noise_only");

  const speechRes = analyzeWavPcm16Activity(speechWav);
  assert.equal(speechRes.inspected, true);
  assert.equal(speechRes.hasSpeech, true);
  assert.equal(speechRes.reason, "speech_detected");

  const root = await mkdtemp(resolve(os.tmpdir(), "ac-voice-local-gate-"));
  const dataDir = resolve(root, "data");
  await mkdir(dataDir, { recursive: true });
  let listThreadsCalls = 0;
  let spawnCount = 0;

  const svc = new VoiceCallService({
    hub: {
      async listThreads() {
        listThreadsCalls += 1;
        return { threads: [], projectsMeta: {} };
      },
      async listProvidersAndProfiles() { return { profiles: [] }; },
      allPendingRequests() { return []; },
      async readThread() { return null; },
    },
    dataDir,
    env: {
      ...process.env,
      EDGE_TTS_BIN: MOCK_EDGE_TTS_BIN,
      MACOS_SAY_BIN: MOCK_MAC_SAY_BIN,
      AGY_BIN: MOCK_AGY_BIN,
      VOICE_ASR_BIN: MOCK_VOICE_ASR_BIN,
    },
  });
  t.after(async () => {
    await svc.close();
    await rm(root, { recursive: true, force: true });
  });

  // Override internal startCall detector spy via prototype wrapping on this instance
  const origStartCall = svc.startCall.bind(svc);
  svc.startCall = async (...args) => {
    spawnCount += 1;
    return origStartCall(...args);
  };

  for (const [label, audioBuf, expectedReason] of [
    ["short", shortWav, "too_short_audio"],
    ["silent", silentWav, "digital_silence"],
    ["ambient", ambientWav, "ambient_noise_only"],
  ]) {
    const res = await svc.handleTurn({
      callId: "call-local-gate",
      audioBase64: Buffer.from(audioBuf).toString("base64"),
      audioMimeType: "audio/wav",
      mode: "turn",
      tts: true,
    });
    assert.equal(res.noSpeech, true, `${label} should suppress turn`);
    assert.equal(res.localAudioFiltered, true, `${label} should mark localAudioFiltered`);
    assert.equal(res.silenceReason, expectedReason);
    assert.equal(res.spokenReply, "");
    assert.equal(res.tts.provider, "none");
  }

  // Zero Gemini ACP calls AND zero expensive buildLiveSnapshot calls happened for filtered audio!
  assert.equal(spawnCount, 0);
  assert.equal(listThreadsCalls, 0);

  // transcribeAudio directly also short-circuits locally for silent/ambient WAV before starting ASR worker.
  const asrRes = await svc.transcribeAudio({
    audioBase64: Buffer.from(ambientWav).toString("base64"),
    audioMimeType: "audio/wav",
  });
  assert.equal(asrRes.text, "");
  assert.equal(asrRes.engine, "local-audio-gate");
  assert.equal(asrRes.localAudioFiltered, true);
  assert.equal(asrRes.silenceReason, "ambient_noise_only");

  // Clear real speech WAV DOES pass through the local gate and reaches coordinator/startCall.
  const passRes = await svc.handleTurn({
    callId: "call-local-gate",
    audioBase64: Buffer.from(speechWav).toString("base64"),
    audioMimeType: "audio/wav",
    transcriptText: "",
    mode: "turn",
    tts: false,
  });
  assert.equal(spawnCount, 0);
  assert.equal(passRes.model, DEFAULT_VOICE_HYDROGEN_MODEL);
  assert.equal(listThreadsCalls, 1);
  assert.ok(passRes.ok);
});

test("Voice dispatch distinguishes queued follow-ups vs immediate direct-result or stop-waiting commands", async (t) => {
  const snapshot = {
    projects: [
      {
        cwd: "/dev/demo-shop",
        name: "示例商城后台",
        pinned: true,
        liveCount: 1,
        threads: [
          {
            id: "antigravity:cli:t-fans",
            provider: "antigravity",
            profileId: "cli",
            cwd: "/dev/demo-shop",
            title: "示例商城后台 运行中",
            model: "gemini-4-hydrogen-low",
            live: true,
            updatedAt: Date.now(),
          },
        ],
      },
    ],
    threads: [
      {
        id: "antigravity:cli:t-fans",
        provider: "antigravity",
        profileId: "cli",
        cwd: "/dev/demo-shop",
        title: "示例商城后台 运行中",
        model: "gemini-4-hydrogen-low",
        live: true,
        updatedAt: Date.now(),
      },
    ],
    pendingRequests: [],
    activeThreadId: "antigravity:cli:t-fans",
  };

  // Service-level test: busy thread (409) queues normal follow-ups, but steers/interrupts-and-sends immediate directives.
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-voice-dispatch-mode-"));
  const dataDir = resolve(root, "data");
  await mkdir(dataDir, { recursive: true });
  let busy = true;
  const sentTurns = [];
  const queuedTurns = [];
  const interruptedCalls = [];

  const svc = new VoiceCallService({
    hub: {
      async listThreads() {
        return {
          threads: snapshot.threads,
          projectsMeta: { "/dev/demo-shop": { alias: "示例商城后台", pinned: true } },
        };
      },
      async listProvidersAndProfiles() {
        return { profiles: [{ provider: "antigravity", id: "cli", installed: true, authenticated: true }] };
      },
      allPendingRequests() { return []; },
      async readThread() { return null; },
      async interrupt(args) {
        interruptedCalls.push(args);
        busy = false;
        return { ok: true };
      },
      async sendTurn(args) {
        sentTurns.push(args);
        if (busy) {
          throw Object.assign(new Error("busy"), { status: 409 });
        }
        return { turn: { id: `turn-${sentTurns.length}` }, steered: Boolean(args.steer) };
      },
      async queueTurn(args) {
        queuedTurns.push(args);
        return { entry: { id: `q-${queuedTurns.length}` } };
      },
    },
    dataDir,
    env: {
      ...process.env,
      EDGE_TTS_BIN: MOCK_EDGE_TTS_BIN,
      MACOS_SAY_BIN: MOCK_MAC_SAY_BIN,
      VOICE_ASR_BIN: MOCK_VOICE_ASR_BIN,
      AGY_BIN: MOCK_AGY_BIN,
    },
  });
  t.after(async () => {
    await svc.close();
    await rm(root, { recursive: true, force: true });
  });

  // 1. Regular follow-up while busy -> queued cleanly via queueTurn.
  const normalRes = await svc.handleTurn({
    callId: "call-dispatch-mode",
    transcriptText: "让 示例商城后台 顺便把单测补全",
    autoExecute: true,
    tts: false,
  });
  assert.equal(normalRes.dispatchMode, "queue");
  assert.equal(normalRes.queued, true);
  assert.equal(queuedTurns.length, 1);
  assert.equal(interruptedCalls.length, 0);
  assert.equal(Boolean(sentTurns[0]?.steer), false);

  // 2. Immediate command while busy (even if first steer attempt hits 409) -> interrupts and sends immediately, NEVER queues!
  const immediateRes = await svc.handleTurn({
    callId: "call-dispatch-mode",
    transcriptText: "别等了，直接出结果",
    autoExecute: true,
    tts: false,
  });
  assert.equal(immediateRes.dispatchMode, "immediate");
  assert.equal(immediateRes.queued, false);
  assert.equal(immediateRes.executed.immediate, true);
  assert.equal(immediateRes.executed.interruptedPriorTurn, true);
  assert.equal(interruptedCalls.length, 1);
  assert.equal(interruptedCalls[0]?.threadId, "antigravity:cli:t-fans");
  assert.equal(queuedTurns.length, 1);
  assert.equal(sentTurns.at(-1)?.steer, true);

  // 3. Steer succeeds directly on first call (e.g. Codex turn/steer or Antigravity self-interrupt) -> sent immediately without queued fallback.
  busy = false;
  const steerDirectRes = await svc.handleTurn({
    callId: "call-dispatch-mode",
    transcriptText: "让 示例商城后台 停止等待，直接汇报结论",
    autoExecute: true,
    asyncDispatch: true,
    tts: false,
  });
  assert.equal(steerDirectRes.dispatchMode, "immediate");
  assert.equal(steerDirectRes.executed.dispatchMode, "immediate");
  assert.match(steerDirectRes.executed.summaryTag, /立即发送/);
  for (let i = 0; i < 30; i += 1) {
    const status = svc.getCallDeliveryStatus({ callId: "call-dispatch-mode" });
    const latest = (status.dispatchBatches || []).find((b) => b.batchId === steerDirectRes.batchId);
    if (latest && latest.status !== "dispatching") {
      assert.equal(latest.status, "dispatched");
      assert.equal(latest.dispatchMode, "immediate");
      assert.equal(latest.immediate, true);
      assert.equal(latest.queued, false);
      break;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(queuedTurns.length, 1);
});

test("voice execution tiers: self_simple vs subagent_hydrogen progress vs external_thread milestone and query-only results", async (t) => {
  const snapshot = {
    summary: { runningCount: 2, waitingCount: 0, pendingApprovalCount: 0, idleCount: 1 },
    projects: [
      { cwd: "/dev/demo-shop", name: "示例商城后台", threadCount: 1, runningCount: 1, waitingCount: 0, pendingApprovalCount: 0 },
      { cwd: "/dev/agent-control", name: "Agent Control", threadCount: 1, runningCount: 1, waitingCount: 0, pendingApprovalCount: 0 },
    ],
    threads: [
      {
        id: "antigravity:cli:t-fans",
        provider: "antigravity",
        cwd: "/dev/demo-shop",
        projectName: "示例商城后台",
        title: "小屋 构建与验收",
        status: "running",
        activeTurnId: "turn-fans-0",
      },
      {
        id: "codex:default:t-ac",
        provider: "codex",
        cwd: "/dev/agent-control",
        projectName: "Agent Control",
        title: "中继重连修复",
        status: "running",
        activeTurnId: "turn-ac-0",
      },
    ],
    pendingRequests: [],
  };

  // 2. Service-level verification:
  //    - subagent_hydrogen returns immediate Stage 1 ACK, emits live progress SSE updates, and emits final conclusion.
  //    - external_thread notifies handoff, suppresses unsolicited result bodies on task completion,
  //      emits milestone updates ("完成一个" then "全部完成"), and speaks stored results only when user asks.
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-voice-tiers-"));
  const dataDir = resolve(root, "data");
  await mkdir(dataDir, { recursive: true });
  const events = [];
  const delegatedSent = [];
  const subagentCalls = [];

  const svc = new VoiceCallService({
    hub: {
      async listThreads() {
        return {
          threads: snapshot.threads,
          projectsMeta: {
            "/dev/demo-shop": { alias: "示例商城后台", pinned: true },
            "/dev/agent-control": { alias: "Agent Control", pinned: true },
          },
        };
      },
      async listProvidersAndProfiles() {
        return { profiles: [{ provider: "antigravity", id: "cli", installed: true, authenticated: true }] };
      },
      allPendingRequests() { return []; },
      async readThread() { return null; },
      async sendTurn(args) {
        delegatedSent.push(args);
        return { turn: { id: `turn-delegated-${delegatedSent.length}` } };
      },
      async queueTurn(args) {
        delegatedSent.push({ ...args, queued: true });
        return { entry: { id: `q-${delegatedSent.length}` } };
      },
    },
    dataDir,
    subagentProgressIntervalMs: 55,
    subagentMinFeedbackGapMs: 40,
    onEvent: (eventName, payload) => {
      events.push({ eventName, payload });
    },
    subagentExecutor: async ({ model, instruction, emitProgress }) => {
      subagentCalls.push({ model, instruction });
      emitProgress("Hydrogen 子代理正在检索近期变更与报错上下文。");
      await new Promise((r) => setTimeout(r, 150));
      return "已排查出两处超时配置过短，建议先调高重连超时。";
    },
    env: {
      ...process.env,
      EDGE_TTS_BIN: MOCK_EDGE_TTS_BIN,
      MACOS_SAY_BIN: MOCK_MAC_SAY_BIN,
      VOICE_ASR_BIN: MOCK_VOICE_ASR_BIN,
      AGY_BIN: MOCK_AGY_BIN,
    },
  });
  t.after(async () => {
    await svc.close();
    await rm(root, { recursive: true, force: true });
  });

  // 2a. Heavy self task -> Stage 1 ACK immediately + live progress + final result dispatch.
  const subagentRes = await svc.handleTurn({
    callId: "call-tiers",
    transcriptText: "帮我详细梳理一下这两个项目目前阻塞点和风险清单",
    autoExecute: true,
    asyncDispatch: true,
    tts: false,
  });
  assert.equal(subagentRes.executionTier, "subagent_hydrogen");
  assert.equal(subagentRes.dispatchPending, true);
  assert.ok(subagentRes.batchId);
  assert.match(subagentRes.spokenReply, /Hydrogen|子代理|交给我/);

  // Wait for background Hydrogen subagent + progress events to complete.
  for (let i = 0; i < 40; i += 1) {
    const doneEvt = events.find(
      (e) => e.eventName === "voice_dispatch" && e.payload?.batchId === subagentRes.batchId && e.payload?.status === "dispatched",
    );
    if (doneEvt) break;
    await new Promise((r) => setTimeout(r, 25));
  }

  assert.equal(subagentCalls.length, 1);
  assert.match(subagentCalls[0].model, /hydrogen/i);
  const progressEvents = events.filter((e) => e.eventName === "voice_subagent_progress" && e.payload?.callId === "call-tiers");
  assert.ok(progressEvents.length >= 2, `expected >= 2 subagent progress events, got ${progressEvents.length}`);
  assert.ok(progressEvents.every((e) => e.payload?.shouldSpeak === true && e.payload?.spokenFeedback));

  const subagentDoneEvent = events.find(
    (e) => e.eventName === "voice_dispatch" && e.payload?.batchId === subagentRes.batchId && e.payload?.status === "dispatched",
  );
  assert.ok(subagentDoneEvent);
  assert.equal(subagentDoneEvent.payload.executionTier, "subagent_hydrogen");
  assert.equal(subagentDoneEvent.payload.shouldSpeak, true);
  assert.match(subagentDoneEvent.payload.spokenFeedback, /Hydrogen 子代理有结果了.*两处超时配置过短/);

  // 2b. Verify real ACP Hydrogen subagent execution path (MOCK_AGY_BIN) works cleanly when subagentExecutor is not injected.
  const rootAcp = await mkdtemp(resolve(os.tmpdir(), "ac-voice-subagent-acp-"));
  const dataDirAcp = resolve(rootAcp, "data");
  await mkdir(dataDirAcp, { recursive: true });
  const acpEvents = [];
  const svcAcp = new VoiceCallService({
    hub: {
      async listThreads() { return { threads: snapshot.threads, projectsMeta: {} }; },
      async listProvidersAndProfiles() { return { profiles: [{ provider: "antigravity", id: "cli", installed: true, authenticated: true }] }; },
      allPendingRequests() { return []; },
      async readThread() { return null; },
    },
    dataDir: dataDirAcp,
    onEvent: (eventName, payload) => acpEvents.push({ eventName, payload }),
    env: {
      ...process.env,
      EDGE_TTS_BIN: MOCK_EDGE_TTS_BIN,
      MACOS_SAY_BIN: MOCK_MAC_SAY_BIN,
      VOICE_ASR_BIN: MOCK_VOICE_ASR_BIN,
      AGY_BIN: MOCK_AGY_BIN,
    },
  });
  t.after(async () => {
    await svcAcp.close();
    await rm(rootAcp, { recursive: true, force: true });
  });
  const acpSubRes = await svcAcp.handleTurn({
    callId: "call-acp-sub",
    transcriptText: "帮我深入分析一下这两个任务的优先级",
    autoExecute: true,
    asyncDispatch: true,
    tts: false,
  });
  assert.equal(acpSubRes.executionTier, "subagent_hydrogen");
  for (let i = 0; i < 60; i += 1) {
    const done = acpEvents.find(
      (e) => e.eventName === "voice_dispatch" && e.payload?.batchId === acpSubRes.batchId && e.payload?.status === "dispatched",
    );
    if (done) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const acpDone = acpEvents.find(
    (e) => e.eventName === "voice_dispatch" && e.payload?.batchId === acpSubRes.batchId && e.payload?.status === "dispatched",
  );
  assert.ok(acpDone);
  assert.match(acpDone.payload.spokenFeedback, /Hydrogen 子代理有结果了/);
  assert.match(acpDone.payload.spokenFeedback, /gemini-4-hydrogen[\/-]low/i);

  // 2c. External multi-task delegation -> handoff ACK, silent completion capture, milestone notifications, and on-demand query.
  const ext1 = await svc.handleTurn({
    callId: "call-tiers",
    transcriptText: "让 示例商城后台 检查一下首页样式",
    autoExecute: true,
    asyncDispatch: false,
    tts: false,
  });
  const ext2 = await svc.handleTurn({
    callId: "call-tiers",
    transcriptText: "让 Agent Control 检查一下断线重连逻辑",
    autoExecute: true,
    asyncDispatch: false,
    tts: false,
  });
  assert.equal(ext1.executionTier, "external_thread");
  assert.equal(ext2.executionTier, "external_thread");
  assert.match(ext1.spokenReply, /示例商城后台/);
  assert.match(ext2.spokenReply, /Agent Control/);

  const secretResult1 = "绝密结果AlphaCSS网格已对齐";
  const secretResult2 = "绝密结果Beta心跳重连间隔已缩短到3秒";

  await svc.handleHubEvent("provider_event", {
    type: "turn_completed",
    provider: "antigravity",
    threadId: "antigravity:cli:t-fans",
    lastAgentMessage: secretResult1,
  });

  const milestonesAfterOne = events.filter((e) => e.eventName === "voice_external_milestone");
  assert.equal(milestonesAfterOne.length, 1);
  assert.equal(milestonesAfterOne[0].payload.remainingCount, 1);
  assert.equal(milestonesAfterOne[0].payload.allDone, false);
  assert.equal(milestonesAfterOne[0].payload.shouldSpeak, true);
  assert.match(milestonesAfterOne[0].payload.spokenFeedback, /示例商城后台.*已完成.*还有 1 个/);
  assert.equal(milestonesAfterOne[0].payload.spokenFeedback.includes(secretResult1), false);

  await svc.handleHubEvent("provider_event", {
    type: "turn_completed",
    provider: "codex",
    threadId: "codex:default:t-ac",
    lastAgentMessage: secretResult2,
  });

  const milestonesAfterTwo = events.filter((e) => e.eventName === "voice_external_milestone");
  assert.equal(milestonesAfterTwo.length, 2);
  assert.equal(milestonesAfterTwo[1].payload.remainingCount, 0);
  assert.equal(milestonesAfterTwo[1].payload.allDone, true);
  assert.equal(milestonesAfterTwo[1].payload.shouldSpeak, true);
  assert.match(milestonesAfterTwo[1].payload.spokenFeedback, /全部完成|想听结果随时问我/);
  assert.equal(milestonesAfterTwo[1].payload.spokenFeedback.includes(secretResult2), false);

  // User explicitly asks for results -> self_simple replies with the stored results.
  const consultRes = await svc.handleTurn({
    callId: "call-tiers",
    transcriptText: "刚才那两个任务结果怎么样",
    autoExecute: true,
    asyncDispatch: false,
    tts: false,
  });
  assert.equal(consultRes.executionTier, "self_simple");
  assert.equal(consultRes.plan.intent, "summarize_progress");
  assert.ok(consultRes.spokenReply.includes(secretResult1));
  assert.ok(consultRes.spokenReply.includes(secretResult2));
});

test("Voice model-planned real-cwd subagent, unrelated milestone isolation, and anti-snowball compensation", async (t) => {
  // 2. Real existing projectCwd does not throw ReferenceError: existsSync is not defined,
  //    unrelated threads do not trigger voice_external_milestone, and notice/pending do not snowball.
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-voice-regressions-"));
  const dataDir = resolve(root, "data");
  const realProjDir = resolve(root, "示例商城后台");
  await Promise.all([
    mkdir(dataDir, { recursive: true }),
    mkdir(realProjDir, { recursive: true }),
  ]);
  const events = [];

  const svc = new VoiceCallService({
    hub: {
      async listThreads() {
        return {
          threads: [
            {
              id: "codex:default:t-fans-real",
              provider: "codex",
              cwd: realProjDir,
              title: "家具构建",
              live: true,
              updatedAt: Date.now(),
            },
            {
              id: "codex:default:unrelated-other-task",
              provider: "codex",
              cwd: "/dev/unrelated-repo",
              title: "无关任务",
              live: true,
              updatedAt: Date.now(),
            },
          ],
          projectsMeta: {
            [realProjDir]: { alias: "示例商城后台", pinned: true },
          },
        };
      },
      async listProvidersAndProfiles() {
        return { profiles: [{ provider: "antigravity", id: "cli", installed: true, authenticated: true }] };
      },
      allPendingRequests() { return []; },
      async readThread() { return null; },
      async sendTurn() { return { turn: { id: "turn-1" } }; },
    },
    dataDir,
    onEvent: (eventName, payload) => events.push({ eventName, payload }),
    env: {
      ...process.env,
      EDGE_TTS_BIN: MOCK_EDGE_TTS_BIN,
      MACOS_SAY_BIN: MOCK_MAC_SAY_BIN,
      VOICE_ASR_BIN: MOCK_VOICE_ASR_BIN,
      AGY_BIN: MOCK_AGY_BIN,
    },
  });
  t.after(async () => {
    await svc.close();
    await rm(root, { recursive: true, force: true });
  });

  const callId = "call-regressions";
  await svc.startCall({ callId });

  // Subagent targeting real existing projectCwd succeeds without existsSync ReferenceError.
  const subRes = await svc.handleTurn({
    callId,
    transcriptText: "帮我深入分析一下示例商城后台最近的报错原因",
    autoExecute: true,
    asyncDispatch: true,
    tts: false,
  });
  assert.equal(subRes.executionTier, "subagent_hydrogen");
  let settledSub = null;
  for (let i = 0; i < 60; i += 1) {
    settledSub = events.find(
      (e) => e.eventName === "voice_dispatch" && e.payload?.batchId === subRes.batchId && e.payload?.status !== "dispatching",
    );
    if (settledSub) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(settledSub?.payload?.status, "dispatched", `unexpected subagent error: ${settledSub?.payload?.error || ""}`);

  // Unrelated background thread completion must NOT emit voice_external_milestone.
  await svc.handleHubEvent("provider_event", {
    type: "turn_started",
    threadId: "codex:default:unrelated-other-task",
    cwd: "/dev/unrelated-repo",
  });
  await svc.handleHubEvent("provider_event", {
    type: "turn_completed",
    threadId: "codex:default:unrelated-other-task",
    lastAgentMessage: "无关后台结果",
  });
  assert.equal(events.filter((e) => e.eventName === "voice_external_milestone").length, 0);

  // Delegated thread DOES emit voice_external_milestone with matching callId.
  await svc.handleTurn({
    callId,
    transcriptText: "让示例商城跑一下检查",
    autoExecute: true,
    asyncDispatch: false,
    tts: false,
  });
  await svc.handleHubEvent("provider_event", {
    type: "turn_completed",
    threadId: "codex:default:t-fans-real",
    lastAgentMessage: "检查已全部通过",
  });
  const delegatedMilestones = events.filter((e) => e.eventName === "voice_external_milestone");
  assert.equal(delegatedMilestones.length, 1);
  assert.equal(delegatedMilestones[0].payload.callId, callId);

  // Notice / stale-pending utterances must NOT bleed into next turn's spokenReply;
  // unheard turn reply with pre-existing compensation suffix must NOT nest recursively.
  svc.registerUtterance({
    callId,
    utteranceId: "utt-notice-1",
    text: "后台通知噪音内容",
    source: "notice",
  });
  svc.recordPlaybackFeedback({
    callId,
    utteranceId: "utt-notice-1",
    status: "unheard",
    reason: "autoplay_blocked",
  });
  const afterNoticeTurn = await svc.handleTurn({
    callId,
    transcriptText: "你好",
    tts: false,
  });
  assert.equal(afterNoticeTurn.spokenReply.includes("后台通知噪音内容"), false);
  assert.equal(afterNoticeTurn.replayedUnheardIds.length, 0);

  svc.registerUtterance({
    callId,
    utteranceId: "utt-nested-source",
    text: "主回复内容 另外补播刚才未听到的提醒：更早之前的内容",
    source: "turn",
  });
  svc.recordPlaybackFeedback({
    callId,
    utteranceId: "utt-nested-source",
    status: "unheard",
    reason: "fake_short_end",
  });
  const antiSnowballTurn = await svc.handleTurn({
    callId,
    transcriptText: "你好",
    tts: false,
  });
  assert.equal(antiSnowballTurn.replayedUnheardIds.includes("utt-nested-source"), true);
  assert.equal(antiSnowballTurn.spokenReply.includes("另外补播刚才未听到的提醒"), false);
  assert.equal(antiSnowballTurn.spokenReply.includes("更早之前的内容"), false);
});

test("VoiceCallService supports optional lightweight models (Claude/Codex) without Gemini", async (t) => {
  const dir = await mkdtemp(resolve(os.tmpdir(), "ac-voice-multi-model-"));
  t.after(() => rm(dir, { recursive: true, force: true }));

  assert.equal(
    pickPreferredVoiceModel("claude", [
      { id: "claude-opus-4-6", displayName: "Opus 4.6" },
      { id: "claude-haiku-4-5", displayName: "Haiku 4.5" },
      { id: "claude-sonnet-5-5", displayName: "Sonnet 5.5" },
    ]),
    "claude-sonnet-5-5",
  );
  assert.equal(
    pickPreferredVoiceModel("codex", [
      { id: "gpt-5.4", displayName: "GPT-5.4", isDefault: true },
      { id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" },
      { id: "gpt-6.1-terra", displayName: "GPT-6.1 Terra" },
    ]),
    "gpt-6.1-terra",
  );

  assert.deepEqual(
    parseVoiceModelSelectionKey("codex:default:gpt-6.1-terra"),
    { key: "codex:default:gpt-6.1-terra", voiceProvider: "codex", voiceProfileId: "default", voiceModel: "gpt-6.1-terra" },
  );
  assert.equal(normalizeVoiceConfig({ preferredModelKey: "claude:default:claude-sonnet-5-5" }).preferredModelKey, "claude:default:claude-sonnet-5-5");
  const selectHtml = renderVoiceModelSelectOptionsHtml(
    [
      { key: "auto", label: "自动优选轻量模型" },
      { key: "codex:default:gpt-6.1-terra", label: "Codex · GPT-6.1 Terra (轻量)" },
    ],
    "codex:default:gpt-6.1-terra",
  );
  assert.match(selectHtml, /value="codex:default:gpt-6\.1-terra" selected/);

  const startedThreads = [];
  const events = [];
  let svc;
  const hub = {
    async listThreads() {
      return {
        threads: [
          { id: "codex:default:t-1", provider: "codex", cwd: "/dev/demo", title: "示例项目", live: false, updatedAt: 1000 },
        ],
        projectsMeta: {},
      };
    },
    async listProvidersAndProfiles() {
      return {
        profiles: [
          { provider: "claude", id: "default", label: "Claude 默认", installed: true, authenticated: true },
          { provider: "codex", id: "default", label: "Codex 默认", installed: true, authenticated: true },
        ],
      };
    },
    async listModels(provider) {
      if (provider === "claude") {
        return {
          items: [
            { id: "claude-sonnet-5-5", displayName: "Sonnet 5.5" },
            { id: "claude-haiku-4-5", displayName: "Haiku 4.5" },
          ],
        };
      }
      if (provider === "codex") {
        return {
          items: [
            { id: "gpt-5.4", displayName: "GPT-5.4", isDefault: true },
            { id: "gpt-6.1-terra", displayName: "GPT-6.1 Terra" },
          ],
        };
      }
      return { items: [] };
    },
    async listPendingRequests() {
      return { requests: [] };
    },
    async readThread(threadId) {
      if (threadId === "codex:default:sub-1") {
        return {
          thread: {
            id: threadId,
            turns: [
              {
                id: "turn-1",
                status: "completed",
                items: [{ type: "agentMessage", text: "测试发现是依赖版本不一致导致失败，建议锁定版本号。" }],
              },
            ],
          },
        };
      }
      return { thread: { id: threadId, turns: [] } };
    },
    async startThread(args) {
      startedThreads.push(args);
      const threadId = `${args.provider}:default:sub-1`;
      setTimeout(() => {
        void svc.handleHubEvent("provider_event", {
          type: "turn_completed",
          threadId,
          lastAgentMessage: args.text.includes("<LIVE_CONTROL_SNAPSHOT>")
            ? JSON.stringify({ intent: "subagent_hydrogen", instruction: "帮我深入分析一下刚才为什么失败了", spokenReply: "我先分析已有记录。" })
            : "测试发现是依赖版本不一致导致失败，建议锁定版本号。",
        });
      }, 25);
      return { thread: { id: threadId, model: args.model || "" } };
    },
  };

  svc = new VoiceCallService({
    hub,
    dataDir: dir,
    onEvent: (eventName, payload) => events.push({ eventName, payload }),
    env: {
      ...process.env,
      EDGE_TTS_BIN: "none",
      MACOS_SAY_BIN: "none",
      VOICE_ASR_BIN: MOCK_VOICE_ASR_BIN,
    },
  });
  t.after(() => svc.close());

  // 1. Without Antigravity/Gemini, auto picks Claude Sonnet (low effort) and exposes modelOptions.
  const startedAuto = await svc.startCall({ callId: "call-no-gemini" });
  assert.equal(startedAuto.dispatchProvider, "claude");
  assert.equal(startedAuto.dispatchModel, "claude-sonnet-5-5");
  assert.ok(startedAuto.modelOptions.some((opt) => opt.key === "codex:default:gpt-6.1-terra" && opt.effort === "low"));
  assert.ok(startedAuto.modelOptions.some((opt) => opt.key === "claude:default:claude-sonnet-5-5" && opt.effort === "low"));
  assert.ok(!startedAuto.modelOptions.some((opt) => opt.key === "local:local-rules"));

  // 2. Switching explicitly to Codex GPT-6.1 Terra executes subagent via Codex with low effort without Gemini.
  const startedCodex = await svc.startCall({
    callId: "call-no-gemini",
    voiceProvider: "codex",
    voiceProfileId: "default",
    voiceModel: "gpt-6.1-terra",
  });
  assert.equal(startedCodex.dispatchProvider, "codex");
  assert.equal(startedCodex.dispatchModel, "gpt-6.1-terra");

  const subRes = await svc.handleTurn({
    callId: "call-no-gemini",
    transcriptText: "帮我深入分析一下刚才为什么失败了",
    autoExecute: true,
    asyncDispatch: true,
    tts: false,
  });
  assert.equal(subRes.dispatchPending, true);
  assert.match(subRes.spokenReply, /Codex/);

  for (let i = 0; i < 60; i += 1) {
    if (events.some((e) => e.eventName === "voice_dispatch" && e.payload?.batchId === subRes.batchId && e.payload?.status === "dispatched")) {
      break;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  assert.equal(startedThreads.length, 2);
  assert.equal(startedThreads[0].provider, "codex");
  assert.equal(startedThreads[0].model, "gpt-6.1-terra");
  assert.equal(startedThreads[0].effort, "low");
  assert.equal(startedThreads[1].model, "gpt-6.1-terra");
  assert.equal(startedThreads[1].effort, "low");
  assert.match(startedThreads[0].text, /^\[AC_VOICE_CALL\]/);

  const doneEvt = events.find(
    (e) => e.eventName === "voice_dispatch" && e.payload?.batchId === subRes.batchId && e.payload?.status === "dispatched",
  );
  assert.match(doneEvt?.payload?.spokenFeedback || "", /依赖版本不一致导致失败/);


});
