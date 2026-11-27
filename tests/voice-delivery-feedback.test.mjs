import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_VOICE_HYDROGEN_MODEL,
  VoiceCallService,
  analyzeWavPcm16Activity,
  estimateSpeechDurationMs,
  pickPreferredHydrogenModel,
  pickPreferredVoiceModel,
} from "../src/voice-call-service.mjs";
import {
  createVadTurnDetector,
  encodePcm16SamplesToWav,
  estimateVoiceDurationMs,
  minVoiceAudibleMs,
  normalizeVoiceTtsPayload,
} from "../public/voice-copilot.js";

const MOCK_EDGE_TTS_BIN = fileURLToPath(new URL("./helpers/mock-edge-tts.mjs", import.meta.url));
const MOCK_MAC_SAY_BIN = fileURLToPath(new URL("./helpers/mock-macos-say.mjs", import.meta.url));
const MOCK_VOICE_ASR_BIN = fileURLToPath(new URL("./helpers/mock-voice-asr.mjs", import.meta.url));

test("speech duration estimation and min audible threshold", () => {
  assert.ok(estimateSpeechDurationMs("你好") >= 600);
  assert.equal(estimateVoiceDurationMs("正在为你查询示例商城后台进度"), estimateSpeechDurationMs("正在为你查询示例商城后台进度"));
  assert.equal(minVoiceAudibleMs(""), 0);
  assert.ok(minVoiceAudibleMs("示例商城后台已经完成构建。") >= 180);
});

test("normalizeVoiceTtsPayload normalizes flat and nested TTS payloads", () => {
  const flatTts = normalizeVoiceTtsPayload({ audioBase64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEA", mimeType: "audio/mpeg", provider: "edge-tts", text: "测试" });
  assert.equal(flatTts.hasAudio, true);
  assert.equal(flatTts.provider, "edge-tts");

  const nestedTts = normalizeVoiceTtsPayload({ utteranceId: "u1", tts: { audioBase64: "UklGRiQAAABXQVZFZm10IBAAAAABAAEA", mimeType: "audio/wav", provider: "macos-say" } });
  assert.equal(nestedTts.hasAudio, true);
  assert.equal(nestedTts.utteranceId, "u1");
  assert.equal(nestedTts.provider, "macos-say");

  const emptyTts = normalizeVoiceTtsPayload({ utteranceId: "u2", spokenReply: "纯文本", tts: { audioBase64: "", mimeType: "", provider: "none" } });
  assert.equal(emptyTts.hasAudio, false);
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

  const sayTts = await withSayService.synthesizeSpeech("测试离线语音兜底", { register: false });
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
  const browserTts = await browserOnlyService.synthesizeSpeech("浏览器朗读兜底", { register: false });
  assert.equal(browserTts.provider, "none");
  assert.equal(browserTts.audioBase64, "");
  await browserOnlyService.close();
});

test("Voice model selection helpers prefer low-latency Hydrogen and lightweight Claude/Codex models", () => {
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
});

test("VAD suppresses transient click impulses and low-SNR room noise while keeping clear speech", () => {
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
  assert.equal(vad.pushSamples(new Int16Array(1600).fill(1100), 0.035).type, "listening");
  assert.equal(vad.pushSamples(roomHum, 0.008).type, "listening");
  assert.equal(vad.pushSamples(new Int16Array(1600).fill(600), 0.019).type, "listening");
  assert.equal(vad.pushSamples(new Int16Array(1600).fill(600), 0.019).type, "speech_start");
  assert.equal(vad.pushSamples(new Int16Array(1600).fill(600), 0.019).type, "recording");
  vad.pushSamples(roomHum, 0.005);
  vad.pushSamples(roomHum, 0.005);
  const lowEnergyDone = vad.pushSamples(roomHum, 0.005);
  assert.equal(lowEnergyDone.type, "discarded_noise");

  const clearVoice = new Int16Array(1600).fill(2600);
  assert.equal(vad.pushSamples(clearVoice, 0.05).type, "listening");
  assert.equal(vad.pushSamples(clearVoice, 0.05).type, "speech_start");
  assert.equal(vad.pushSamples(clearVoice, 0.05).type, "recording");
  vad.pushSamples(roomHum, 0.004);
  vad.pushSamples(roomHum, 0.004);
  const speechDone = vad.pushSamples(roomHum, 0.004);
  assert.equal(speechDone.type, "utterance");
});

test("Local WAV PCM16 acoustic gate filters silence and ambient noise before calling ASR", async (t) => {
  const shortWav = encodePcm16SamplesToWav(new Int16Array(800).fill(3000), 16000);
  const silentWav = encodePcm16SamplesToWav(new Int16Array(4800), 16000);
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
  const svc = new VoiceCallService({
    hub: {
      async listThreads() { return { threads: [], projectsMeta: {} }; },
      async listProvidersAndProfiles() { return { profiles: [] }; },
      allPendingRequests() { return []; },
    },
    dataDir,
    env: {
      ...process.env,
      EDGE_TTS_BIN: MOCK_EDGE_TTS_BIN,
      MACOS_SAY_BIN: MOCK_MAC_SAY_BIN,
      VOICE_ASR_BIN: MOCK_VOICE_ASR_BIN,
    },
  });
  t.after(async () => {
    await svc.close();
    await rm(root, { recursive: true, force: true });
  });

  const asrRes = await svc.transcribeAudio({
    audioBase64: Buffer.from(ambientWav).toString("base64"),
    audioMimeType: "audio/wav",
  });
  assert.equal(asrRes.text, "");
  assert.equal(asrRes.engine, "local-audio-gate");
  assert.equal(asrRes.localAudioFiltered, true);
  assert.equal(asrRes.silenceReason, "ambient_noise_only");
});
