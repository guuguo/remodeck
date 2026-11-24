import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile, chmod } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import { analyzeWavPcm16Activity, VoiceCallService } from "../src/voice-call-service.mjs";
import {
  computeRmsLevel,
  createVadTurnDetector,
  downsampleFloat32ToInt16,
  encodePcm16SamplesToWav,
  renderVoiceCallTranscriptHtml,
} from "../public/voice-copilot.js";

const snapshot = {
  activeThreadId: "codex:default:work",
  threads: [{ id: "codex:default:work", title: "当前任务", cwd: "/dev/demo", live: true }],
  projects: [],
  pendingRequests: [],
};
const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");

test("final browser recognition is retained while a previous voice turn is processing", () => {
  const source = appSource.match(/function startBrowserSpeechRecognitionPipeline\(\) \{[\s\S]*?\n\}/)?.[0];
  const sent = [];
  let recognizer;
  const status = { textContent: "免提聆听中" };
  const state = { voice: { callActive: true, isMuted: false, isSpeaking: false, isProcessing: true, asrAvailable: false } };
  const start = vm.runInNewContext(`(${source})`, {
    window: { SpeechRecognition: class { constructor() { recognizer = this; } start() {} } },
    state,
    $: () => status,
    renderVoiceCallUi() {},
    sendVoiceTurnToMac: (input) => sent.push(input.transcriptText),
  });
  assert.equal(start(), true);
  recognizer.onresult({ resultIndex: 0, results: [Object.assign([{ transcript: "任务怎么停了" }], { isFinal: true })] });
  assert.deepEqual(sent, ["任务怎么停了"]);
  recognizer.onerror({ error: "not-allowed" });
  assert.equal(state.voice.isMuted, true);
  assert.match(status.textContent, /权限/);
});

test("voice playback does not fall back to phone speech synthesis when server audio is missing", async () => {
  const source = appSource.match(/async function playVoiceTtsResult\([\s\S]*?\n\}\n/)?.[0];
  let browserCalls = 0;
  let unheard = false;
  const play = vm.runInNewContext(`(${source})`, {
    state: { voice: { callActive: true, backendMissing: true } },
    stripMarkdownForSpeech: (text) => text,
    normalizeVoiceTtsPayload: () => ({ hasAudio: false, provider: "none", expectedMs: 1000 }),
    nextVoiceUtteranceId: () => "utt-1",
    updateVoiceTranscriptEntry() {},
    renderVoiceCallUi() {},
    scheduleVoiceListenResume() {},
    speakWithBrowserFallback: async () => { browserCalls += 1; return { outcome: "error" }; },
    evaluateVoicePlaybackOutcome: () => ({ heard: false, reason: "speech_unavailable", playedMs: 0 }),
    markUtteranceUnheard() { unheard = true; },
    reportVoicePlaybackAck() {},
  });
  await play({ spokenReply: "任务状态已更新" });
  assert.equal(browserCalls, 0);
  assert.equal(unheard, true);
});

test("voice turns received during processing are submitted once in chronological order", async () => {
  const source = appSource.match(/async function sendVoiceTurnToMac\([\s\S]*?\n\}\n/)?.[0];
  const sent = [];
  const state = { voice: { callActive: true, isProcessing: true, isSpeaking: false, pendingVoiceTurns: [] } };
  const send = vm.runInNewContext(`(${source})`, {
    state,
    setTimeout: () => 1,
    clearVoiceProcessingStageTimer() {},
    clearApprovalVoiceReminder() {},
    renderVoiceCallUi() {},
    scheduleVoiceListenResume() {},
    voiceSelectionPayload: () => ({}),
    mergeQueuedVoiceTurns: (turns) => turns,
    playVoiceEarcon() {},
    apiPostWithHotFallback: async (_, body) => { sent.push(body.transcriptText); return { noSpeech: true }; },
  });
  await send({ transcriptText: "第一句" });
  await send({ transcriptText: "第二句" });
  assert.equal(state.voice.pendingVoiceTurns.length, 2);
  assert.deepEqual(sent, []);
  state.voice.isProcessing = false;
  await send();
  await send();
  assert.deepEqual(sent, ["第一句", "第二句"]);
  assert.equal(state.voice.pendingVoiceTurns.length, 0);
});

test("listen resume drains pending speech without clearing an utterance already being recorded", () => {
  const source = appSource.match(/function scheduleVoiceListenResume\(\) \{[\s\S]*?\n\}/)?.[0];
  let timer;
  let sends = 0;
  let resets = 0;
  const state = { voice: { callActive: true, isRecording: false, pendingVoiceTurns: [{}], vadDetector: { reset() { resets += 1; } } } };
  const resume = vm.runInNewContext(`(${source})`, {
    state,
    clearVoiceResumeTimer() {},
    resumeVoiceAudioContextIfNeeded() {},
    renderVoiceCallUi() {},
    setTimeout: (handler) => { timer = handler; },
    sendVoiceTurnToMac() { sends += 1; },
  });
  resume();
  timer();
  assert.equal(sends, 1);
  state.voice.isRecording = true;
  resume();
  timer();
  assert.equal(sends, 1);
  assert.equal(resets, 0);
});

test("turn-taking playback completes even when background noise or user speech arrives during reply", async () => {
  const source = appSource.match(/async function sendVoiceTurnToMac\([\s\S]*?\n\}\n/)?.[0];
  const state = { voice: { callActive: true, isSpeaking: false, isRecording: false, pendingVoiceTurns: [] } };
  let played = 0;
  let unheardCalled = 0;
  const send = vm.runInNewContext(`(${source})`, {
    state,
    setTimeout: () => 1,
    clearVoiceProcessingStageTimer() {},
    clearApprovalVoiceReminder() {},
    renderVoiceCallUi() {},
    scheduleVoiceListenResume() {},
    voiceSelectionPayload: () => ({}),
    mergeQueuedVoiceTurns: (turns) => turns,
    playVoiceEarcon() {},
    apiPostWithHotFallback: async () => {
      state.voice.isRecording = true;
      return { heardText: "第一句", spokenReply: "第一句的回答" };
    },
    nextVoiceUtteranceId: () => "utt-1",
    normalizeVoiceTtsPayload: () => ({ hasAudio: true, audioBase64: "AAAA", provider: "edge-tts" }),
    appendVoiceTranscriptEntry() {},
    fetchVoiceTtsAudio: async () => null,
    playVoiceTtsResult: async () => {
      played += 1;
      state.voice.isSpeaking = false;
    },
    markUtteranceUnheard: () => { unheardCalled += 1; },
    reportVoicePlaybackAck() {},
    estimateVoiceDurationMs: () => 1000,
  });
  await send({ transcriptText: "第一句" });
  assert.equal(played, 1);
  assert.equal(unheardCalled, 0);
});

test("turn-taking capture buffers speech during AI playback without interrupting and merges with post-playback speech", async () => {
  const onProcSource = appSource.match(/processor\.onaudioprocess = \(ev\) => \{\s*const nowMs = Date\.now\(\);[\s\S]*?\n    \};/)?.[0];
  const overlapHelpersSource = [
    appSource.match(/function clearVoiceOverlapFlushTimer\(\) \{[\s\S]*?\n\}/)?.[0],
    appSource.match(/function resetVoiceOverlapBuffer\(\) \{[\s\S]*?\n\}/)?.[0],
    appSource.match(/function submitMergedOverlapBuffer\([\s\S]*?\n\}/)?.[0],
    appSource.match(/function scheduleVoiceOverlapFlush\([\s\S]*?\n\}/)?.[0],
  ].join("\n\n");
  assert.ok(onProcSource);
  assert.ok(overlapHelpersSource);

  const { createVadTurnDetector, mergePcm16ChunksWithGap } = await import("../public/voice-copilot.js");
  const processor = {};
  const sent = [];
  const aborts = [];
  const state = {
    voice: {
      callActive: true,
      isProcessing: false,
      isSpeaking: true,
      isRecording: false,
      isMuted: false,
      currentBotText: "当前项目正在运行测试。",
      overlapActiveSamples: 0,
      overlapBuffer: { chunks: [], sampleCount: 0, botText: "", flushTimer: null },
    },
  };
  let currentRms = 0;
  let frameTag = 0;
  const detector = createVadTurnDetector({
    sampleRate: 16000,
    preRollMs: 600,
    silenceMs: 760,
    minSpeechMs: 260,
    rmsThreshold: 0.009,
    adaptive: true,
    requireSustainedOnset: true,
    minPeakRms: 0.010,
    minSnrRatio: 1.35,
  });

  const ctxScope = {
    processor,
    state,
    ctx: { sampleRate: 16000 },
    detector,
    mergePcm16ChunksWithGap,
    computeRmsLevel: () => currentRms,
    downsampleFloat32ToInt16: (input) => {
      const out = new Int16Array(input.length);
      out.fill(frameTag);
      return out;
    },
    encodePcm16SamplesToWav: (samples) => samples,
    sendVoiceTurnToMac: (input) => sent.push(input),
    stopVoicePlayback: (opts) => aborts.push(opts),
    renderVoiceCallUi() {},
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(`${overlapHelpersSource}\n${onProcSource}`, ctxScope);

  const makeEvent = (len = 1024) => ({ inputBuffer: { getChannelData: () => new Float32Array(len) } });

  // 1. AI 播报期间用户开口说话（中等音量 0.022，过去被 0.035 硬门限抹零，现在必须完整录下且绝不打断播报）
  currentRms = 0.022;
  for (let i = 1; i <= 6; i += 1) {
    frameTag = i;
    processor.onaudioprocess(makeEvent(1024));
  }
  assert.equal(aborts.length, 0);
  assert.equal(state.voice.isSpeaking, true);
  assert.equal(state.voice.isRecording, true);
  assert.equal(sent.length, 0);

  // 2. 播报期间用户讲完前半句并短暂停顿，进入 overlapBuffer 而非立即发请求
  currentRms = 0.001;
  frameTag = 0;
  for (let i = 0; i < 14; i += 1) {
    processor.onaudioprocess(makeEvent(1024));
  }
  assert.equal(aborts.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(state.voice.overlapBuffer.chunks.length, 1);
  assert.equal(state.voice.overlapBuffer.botText, "当前项目正在运行测试。");

  // 3. AI 播报结束后用户继续补充后半句，合并为一个完整 WAV 提交并携带 overlapDurationMs 与 overlapBotText
  state.voice.isSpeaking = false;
  currentRms = 0.025;
  for (let i = 0; i < 5; i += 1) {
    frameTag = 100;
    processor.onaudioprocess(makeEvent(1024));
  }
  currentRms = 0.001;
  frameTag = 0;
  for (let i = 0; i < 14; i += 1) {
    processor.onaudioprocess(makeEvent(1024));
  }

  assert.equal(sent.length, 1);
  assert.ok(sent[0].overlapDurationMs > 0);
  assert.equal(sent[0].overlapBotText, "当前项目正在运行测试。");
  const submitted = Array.from(sent[0].samples);
  assert.ok(submitted.includes(1), "should preserve speech buffered during AI playback");
  assert.ok(submitted.includes(100), "should append speech spoken after AI playback");
});

test("stop inquiries use the chosen model in plan mode without interrupting user tasks", async (t) => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-voice-query-"));
  const calls = [];
  let interrupts = 0;
  let finish;
  const completion = new Promise((resolve) => { finish = resolve; });
  const svc = new VoiceCallService({
    dataDir: dir,
    env: {
      AGY_BIN: fileURLToPath(new URL("./helpers/mock-agy-cli.mjs", import.meta.url)),
      VOICE_ASR_BIN: fileURLToPath(new URL("./helpers/mock-voice-asr.mjs", import.meta.url)),
    },
    hub: {
      listThreads: async () => ({ threads: snapshot.threads, projectsMeta: {} }),
      listProvidersAndProfiles: async () => ({ profiles: [{ provider: "codex", id: "default", installed: true, authenticated: true }] }),
      listModels: async () => [{ id: "gpt-5.4-mini", displayName: "GPT-5.4 Mini" }],
      allPendingRequests: () => [],
      startThread: async (input) => { calls.push(input); return { thread: { id: "codex:default:analysis" } }; },
      readThread: async () => ({ thread: { turns: [{ status: "completed", items: [{ type: "agentMessage", text: calls.length === 1 ? JSON.stringify({ intent: "subagent_hydrogen", instruction: "你为什么停止运行了我的任务", spokenReply: "我先检查已有记录。" }) : "现有记录不足以确认停止原因，没有更改任务。" }] }] } }),
      interrupt: async () => { interrupts += 1; },
      sendTurn: async () => { throw new Error("must not send commands to user tasks"); },
    },
    onEvent: (name, payload) => { if (name === "voice_dispatch") finish(payload); },
  });
  t.after(async () => { await svc.close(); await rm(dir, { recursive: true, force: true }); });
  const result = await svc.handleTurn({
    callId: "call-query",
    transcriptText: "你为什么停止运行了我的任务",
    activeThreadId: snapshot.activeThreadId,
    voiceProvider: "codex",
    voiceModel: "gpt-5.4-mini",
    voiceProfileId: "default",
    tts: false,
  });
  assert.equal(result.plan.intent, "subagent_hydrogen");
  assert.equal(result.model, "gpt-5.4-mini");
  assert.equal(result.asrEngine, "");
  const timeout = setTimeout(() => finish({ status: "timeout" }), 4000);
  const batch = await completion;
  clearTimeout(timeout);
  assert.equal(batch.status, "dispatched");
  assert.equal(batch.model, "gpt-5.4-mini");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].model, "gpt-5.4-mini");
  assert.equal(calls[0].permissionMode, "plan");
  assert.match(calls[1].text, /不得停止、恢复、派发任务/);
  assert.equal(interrupts, 0);
});

test("voice transcript renders actionTag when spokenReply is empty and resolveVoiceTarget skips unavailable profiles", async (t) => {
  const html = renderVoiceCallTranscriptHtml([
    { id: "u-1", heardText: "背景测试句", spokenReply: "", actionTag: "模型判定无需操作" },
  ]);
  assert.match(html, /背景测试句/);
  assert.match(html, /模型判定无需操作/);

  const dir = await mkdtemp(join(os.tmpdir(), "ac-voice-target-"));
  const svc = new VoiceCallService({
    dataDir: dir,
    hub: {
      listProvidersAndProfiles: async () => ({
        profiles: [
          { provider: "antigravity", id: "desktop", installed: true, authenticated: true, health: { status: "unavailable" } },
          { provider: "claude", id: "default", installed: true, authenticated: false, health: { status: "unavailable" } },
          { provider: "codex", id: "default", installed: true, account: { signedIn: true }, health: { status: "unknown" } },
          { provider: "grok", id: "work", installed: true, authenticated: true, health: { status: "healthy" } },
        ],
      }),
      listModels: async () => [],
    },
  });
  t.after(async () => { await svc.close(); await rm(dir, { recursive: true, force: true }); });
  const target = await svc.resolveVoiceTarget({ callId: "auto-pick" });
  assert.equal(target.provider, "codex");
  assert.equal(target.profileId, "default");
});

test("car turn-signal clicks never false-trigger VAD and never prevent post-speech segmentation", () => {
  const vad = createVadTurnDetector({
    sampleRate: 16000,
    preRollMs: 320,
    silenceMs: 760,
    minSpeechMs: 260,
    maxSpeechMs: 14000,
    rmsThreshold: 0.013,
    adaptive: true,
    requireSustainedOnset: true,
    minPeakRms: 0.015,
    minSnrRatio: 1.8,
  });

  // 2048 samples at 48kHz downsampled to 16kHz is ~683 samples (~42.7ms per chunk)
  const chunkSamples = 683;
  const ambientChunk = new Int16Array(chunkSamples).fill(260);
  const clickChunk = new Int16Array(chunkSamples).fill(1500);
  const voiceChunk = new Int16Array(chunkSamples).fill(900);

  // Simulate 20 cycles of periodic turn-signal clicks (1 click every ~470ms, 11 chunks/cycle)
  for (let cycle = 0; cycle < 20; cycle += 1) {
    assert.notEqual(vad.pushSamples(clickChunk, 0.045).type, "speech_start");
    for (let k = 0; k < 10; k += 1) {
      const ev = vad.pushSamples(ambientChunk, 0.008);
      assert.notEqual(ev.type, "speech_start");
      assert.notEqual(ev.type, "utterance");
    }
  }
  assert.equal(vad.isSpeaking, false);

  // Now speak normally for ~600ms (14 chunks at rms=0.026)
  let sawStart = false;
  for (let i = 0; i < 14; i += 1) {
    const ev = vad.pushSamples(voiceChunk, 0.026);
    if (ev.type === "speech_start") sawStart = true;
  }
  assert.equal(sawStart, true);
  assert.equal(vad.isSpeaking, true);

  // Pause after speaking while turn-signal click fires once in the middle of the ~800ms silence window
  let utteranceEvent = null;
  for (let i = 0; i < 20; i += 1) {
    const isClick = i === 10;
    const ev = isClick
      ? vad.pushSamples(clickChunk, 0.045)
      : vad.pushSamples(ambientChunk, 0.008);
    if (ev.type === "utterance") {
      utteranceEvent = ev;
      break;
    }
  }
  assert.ok(utteranceEvent, "expected post-speech silence to segment even with mid-pause click");
});

test("analyzeWavPcm16Activity rejects transient click-only WAVs while allowing continuous speech WAVs", () => {
  // 1200ms WAV at 16kHz with road floor + two isolated 40ms high-amplitude clicks (~640 samples each)
  const clickSamples = new Int16Array(19200).fill(120);
  for (let i = 2000; i < 2640; i += 1) clickSamples[i] = 6000;
  for (let i = 10000; i < 10640; i += 1) clickSamples[i] = 6000;
  const clickWav = encodePcm16SamplesToWav(clickSamples, 16000);
  const clickCheck = analyzeWavPcm16Activity(clickWav);
  assert.equal(clickCheck.inspected, true);
  assert.equal(clickCheck.hasSpeech, false);
  assert.equal(clickCheck.reason, "transient_clicks_only");

  // 1000ms WAV at 16kHz with 300ms continuous speech segment (4800 samples)
  const speechSamples = new Int16Array(16000).fill(120);
  for (let i = 3200; i < 8000; i += 1) speechSamples[i] = 2400;
  const speechWav = encodePcm16SamplesToWav(speechSamples, 16000);
  const speechCheck = analyzeWavPcm16Activity(speechWav);
  assert.equal(speechCheck.inspected, true);
  assert.equal(speechCheck.hasSpeech, true);
});

test("voice-asr-worker filters Whisper hallucinations and accepts normal commands", () => {
  const workerPath = fileURLToPath(new URL("../src/voice-asr-worker.py", import.meta.url));
  const pyScript = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("voice_asr_worker", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
out = {
  "h1": mod.extract_valid_whisper_text({"segments": [{"text": "请不吝点赞 订阅 转发 打赏 打赏 打赏 打赏", "no_speech_prob": 0.4, "avg_logprob": -0.3, "compression_ratio": 1.8}]})[0],
  "h2": mod.extract_valid_whisper_text({"segments": [{"text": "请不吝点赞 订阅 转发 打赏支持明镜与点点栏目", "no_speech_prob": 0.2, "avg_logprob": -0.2, "compression_ratio": 1.4}]})[0],
  "h3": mod.extract_valid_whisper_text({"segments": [{"text": "嗯嗯嗯", "no_speech_prob": 0.71, "avg_logprob": -0.4, "compression_ratio": 1.2}]})[0],
  "ok": mod.extract_valid_whisper_text({"segments": [{"text": "帮我看一下 agent-control 现在的进度", "no_speech_prob": 0.08, "avg_logprob": -0.22, "compression_ratio": 1.15}]})[0],
  "split": mod.extract_valid_whisper_text({"segments": [
    {"start": 0.1, "end": 1.1, "text": "先看下日志", "no_speech_prob": 0.05, "avg_logprob": -0.2, "compression_ratio": 1.1},
    {"start": 1.5, "end": 2.6, "text": "然后修掉", "no_speech_prob": 0.05, "avg_logprob": -0.2, "compression_ratio": 1.1}
  ]}, 1.3),
}
print(json.dumps(out, ensure_ascii=False))
`;
  const raw = execFileSync("python3", ["-c", pyScript, workerPath], { encoding: "utf8" });
  const parsed = JSON.parse(raw);
  assert.equal(parsed.h1, "");
  assert.equal(parsed.h2, "");
  assert.equal(parsed.h3, "");
  assert.equal(parsed.ok, "帮我看一下 agent-control 现在的进度");
  assert.deepEqual(parsed.split, ["先看下日志然后修掉", "先看下日志", "然后修掉"]);
});

test("Silero VAD rejects car road-hum + turn-signal clicks and app.js wires 100-7200Hz bandpass filters", () => {
  assert.match(appSource, /highpass\.frequency\.value\s*=.*100/);
  assert.match(appSource, /lowpass\.frequency\.value\s*=.*7200/);
  assert.match(appSource, /state\.voice\.filterNodes/);
  assert.match(appSource, /state\.voice\.silentGainNode\s*=\s*silentGain/);

  const pyBin = "/opt/homebrew/bin/python3.12";
  const workerPath = fileURLToPath(new URL("../src/voice-asr-worker.py", import.meta.url));
  const pyCheck = `
import importlib.util, json, sys
import numpy as np
try:
    from silero_vad import load_silero_vad, get_speech_timestamps
except Exception:
    print(json.dumps({"skipped": True}))
    sys.exit(0)
spec = importlib.util.spec_from_file_location("voice_asr_worker", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
vad_model = load_silero_vad()
t = np.linspace(0, 1.5, 24000, endpoint=False, dtype=np.float32)
# 80Hz road hum + 3 turn-signal clicks (40ms bursts)
sig = 0.012 * np.sin(2 * np.pi * 80 * t)
for start_idx in (4000, 11500, 19000):
    sig[start_idx:start_idx + 640] += 0.15 * np.sin(2 * np.pi * 1200 * t[start_idx:start_idx + 640])
has_voice, sliced, mapped_overlap_sec = mod.filter_speech_with_silero(sig.astype(np.float32), vad_model, get_speech_timestamps)
print(json.dumps({"skipped": False, "has_voice": bool(has_voice), "samples": int(sliced.size), "mapped_overlap_sec": float(mapped_overlap_sec)}))
`;
  const raw = execFileSync(pyBin, ["-c", pyCheck, workerPath], { encoding: "utf8" });
  const parsed = JSON.parse(raw);
  if (!parsed.skipped) {
    assert.equal(parsed.has_voice, false);
    assert.equal(parsed.samples, 0);
  }
});

test("loud speech never locks RMS or VAD at max, recovers over AGC tail noise, and accepts follow-up speech", () => {
  // 1. Non-finite / clipped filter samples never produce Infinity or NaN RMS
  const corruptFrame = new Float32Array([0.5, Infinity, -Infinity, NaN, 2.5, -3.0]);
  const safeRms = computeRmsLevel(corruptFrame);
  assert.equal(Number.isFinite(safeRms), true);
  assert.equal(safeRms <= 1 && safeRms >= 0, true);
  const downsampled = downsampleFloat32ToInt16(corruptFrame, 48000, 16000);
  assert.equal(downsampled.length, 2);

  // 2. Loud speech (RMS 0.62) followed by elevated AGC/cabin tail (RMS 0.028) still segments cleanly within silenceMs
  const detector = createVadTurnDetector({
    sampleRate: 16000,
    preRollMs: 320,
    silenceMs: 760,
    minSpeechMs: 260,
    maxSpeechMs: 14000,
    rmsThreshold: 0.013,
    adaptive: true,
    requireSustainedOnset: true,
    minPeakRms: 0.015,
    minSnrRatio: 1.8,
  });
  const chunk = new Int16Array(640); // 40ms @ 16kHz
  chunk.fill(16000);

  let started = false;
  for (let i = 0; i < 15; i += 1) {
    const evt = detector.pushSamples(chunk, 0.62);
    if (evt.type === "speech_start") started = true;
  }
  assert.equal(started, true);

  let emittedFirst = false;
  // 22 * 40ms = 880ms > 760ms silenceMs, with AGC elevated tail 0.028 (which previously exceeded 0.0216 cap and hung!)
  const tailChunk = new Int16Array(640);
  tailChunk.fill(700);
  for (let i = 0; i < 22; i += 1) {
    const evt = detector.pushSamples(tailChunk, 0.028);
    if (evt.type === "utterance") {
      emittedFirst = true;
      break;
    }
  }
  assert.equal(emittedFirst, true);
  assert.equal(detector.isSpeaking, false);

  // 3. Subsequent normal-volume speech (RMS 0.06) is still accepted immediately afterwards
  let secondStarted = false;
  let emittedSecond = false;
  const normalChunk = new Int16Array(640);
  normalChunk.fill(2000);
  for (let i = 0; i < 12; i += 1) {
    const evt = detector.pushSamples(normalChunk, 0.06);
    if (evt.type === "speech_start") secondStarted = true;
  }
  assert.equal(secondStarted, true);
  const quietChunk = new Int16Array(640);
  for (let i = 0; i < 22; i += 1) {
    const evt = detector.pushSamples(quietChunk, 0.004);
    if (evt.type === "utterance") {
      emittedSecond = true;
      break;
    }
  }
  assert.equal(emittedSecond, true);
});

test("edge-tts resident worker starts on startCall, serves synthesizeSpeech, and shuts down on endCall", async (t) => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-edge-resident-"));
  const markerPidFile = join(dir, "worker.pid");
  const fakePython = join(dir, "fake-python");
  const fakeEdgeCli = join(dir, "edge-tts");

  // Fake python binary ignores worker script path and implements the NDJSON edge-tts worker contract.
  await writeFile(fakePython, `#!/bin/sh
node -e '
const fs = require("fs");
const readline = require("readline");
fs.writeFileSync(${JSON.stringify(markerPidFile)}, String(process.pid));
process.stdout.write(JSON.stringify({ ready: true }) + "\\n");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const req = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    id: req.id,
    ok: true,
    audioBase64: Buffer.from("ID3RESIDENT").toString("base64"),
    mimeType: "audio/mpeg",
  }) + "\\n");
});
process.on("SIGTERM", () => process.exit(0));
'
`, "utf8");
  await chmod(fakePython, 0o755);

  await writeFile(fakeEdgeCli, `#!${fakePython} -E\n`, "utf8");
  await chmod(fakeEdgeCli, 0o755);

  const svc = new VoiceCallService({
    hub: {
      listThreads: async () => ({ threads: [], projectsMeta: {} }),
      listProvidersAndProfiles: async () => ({ profiles: [] }),
    },
    dataDir: dir,
    env: {
      ...process.env,
      EDGE_TTS_BIN: fakeEdgeCli,
      MACOS_SAY_BIN: "/nonexistent/say",
      VOICE_ASR_BIN: fileURLToPath(new URL("./helpers/mock-voice-asr.mjs", import.meta.url)),
      AGY_BIN: fileURLToPath(new URL("./helpers/mock-agy-cli.mjs", import.meta.url)),
    },
  });
  t.after(async () => {
    await svc.close();
    await rm(dir, { recursive: true, force: true });
  });

  await svc.startCall({ callId: "call-resident-1" });
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      await readFile(markerPidFile, "utf8");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  const pid = Number((await readFile(markerPidFile, "utf8")).trim());
  assert.ok(pid > 0);

  const tts = await svc.synthesizeSpeech({ callId: "call-resident-1", text: "常驻测试", register: false });
  assert.equal(tts.provider, "edge-tts");
  assert.equal(Buffer.from(tts.audioBase64, "base64").toString("ascii"), "ID3RESIDENT");

  svc.endCall({ callId: "call-resident-1" });
  await new Promise((r) => setTimeout(r, 150));
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false);
});

test("Kokoro-82M resident worker serves offline TTS fallback and shuts down on endCall", async (t) => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-kokoro-resident-"));
  const markerPidFile = join(dir, "kokoro.pid");
  const fakeKokoro = join(dir, "fake-kokoro");

  await writeFile(fakeKokoro, `#!/bin/sh
node -e '
const fs = require("fs");
const readline = require("readline");
fs.writeFileSync(${JSON.stringify(markerPidFile)}, String(process.pid));
process.stdout.write(JSON.stringify({ ready: true }) + "\\n");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const req = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    id: req.id,
    ok: true,
    audioBase64: Buffer.from("RIFFKOKORO").toString("base64"),
    mimeType: "audio/wav",
  }) + "\\n");
});
process.on("SIGTERM", () => process.exit(0));
'
`, "utf8");
  await chmod(fakeKokoro, 0o755);

  const svc = new VoiceCallService({
    hub: {
      listThreads: async () => ({ threads: [], projectsMeta: {} }),
      listProvidersAndProfiles: async () => ({ profiles: [] }),
    },
    dataDir: dir,
    env: {
      ...process.env,
      EDGE_TTS_BIN: "/nonexistent/edge-tts",
      MACOS_SAY_BIN: "/nonexistent/say",
      VOICE_KOKORO_BIN: fakeKokoro,
      VOICE_ASR_BIN: fileURLToPath(new URL("./helpers/mock-voice-asr.mjs", import.meta.url)),
      AGY_BIN: fileURLToPath(new URL("./helpers/mock-agy-cli.mjs", import.meta.url)),
    },
  });
  t.after(async () => {
    await svc.close();
    await rm(dir, { recursive: true, force: true });
  });

  await svc.startCall({ callId: "call-kokoro-1" });
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      await readFile(markerPidFile, "utf8");
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 25));
    }
  }
  const pid = Number((await readFile(markerPidFile, "utf8")).trim());
  assert.ok(pid > 0);

  const tts = await svc.synthesizeSpeech({ callId: "call-kokoro-1", text: "Kokoro 离线测试", register: false });
  assert.equal(tts.provider, "kokoro");
  assert.equal(tts.mimeType, "audio/wav");
  assert.equal(Buffer.from(tts.audioBase64, "base64").toString("ascii"), "RIFFKOKORO");

  svc.endCall({ callId: "call-kokoro-1" });
  await new Promise((r) => setTimeout(r, 150));
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false);
});

test("VoiceCallService persists full-pipeline diagnostics to logs/voice-turns.jsonl", async (t) => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-voice-diag-log-"));
  const svc = new VoiceCallService({
    hub: {
      listThreads: async () => ({ threads: [], projectsMeta: {} }),
      listProvidersAndProfiles: async () => ({ profiles: [] }),
    },
    dataDir: dir,
    env: {
      ...process.env,
      EDGE_TTS_BIN: "/nonexistent/edge-tts",
      MACOS_SAY_BIN: "/nonexistent/say",
      VOICE_ASR_BIN: fileURLToPath(new URL("./helpers/mock-voice-asr.mjs", import.meta.url)),
      AGY_BIN: fileURLToPath(new URL("./helpers/mock-agy-cli.mjs", import.meta.url)),
    },
  });
  t.after(async () => {
    await svc.close();
    await rm(dir, { recursive: true, force: true });
  });

  await svc.startCall({ callId: "call-diag-1" });
  const res = await svc.handleTurn({
    callId: "call-diag-1",
    transcriptText: "播报当前进度",
    mode: "briefing",
    tts: false,
  });
  svc.recordPlaybackFeedback({
    callId: "call-diag-1",
    utteranceId: res.utteranceId,
    status: "played",
    playedMs: 1200,
    expectedMs: res.expectedMs,
    provider: "edge-tts",
  });
  svc.endCall({ callId: "call-diag-1" });
  await svc.close();

  const logRaw = await readFile(join(dir, "logs", "voice-turns.jsonl"), "utf8");
  const rows = logRaw.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(rows.some((r) => r.type === "call_start" && r.callId === "call-diag-1"), true);
  const turnRow = rows.find((r) => r.type === "turn_result" && r.callId === "call-diag-1");
  assert.ok(turnRow);
  assert.equal(typeof turnRow.llmMs, "number");
  assert.equal(typeof turnRow.ttsBytes, "number");
  assert.equal(rows.some((r) => r.type === "playback_feedback" && r.utteranceId === res.utteranceId && r.heard === true), true);
  assert.equal(rows.some((r) => r.type === "call_end" && r.callId === "call-diag-1"), true);
});
