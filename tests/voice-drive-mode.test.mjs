import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  VoiceCallService,
  buildVoiceAsrPrompt,
} from "../src/voice-call-service.mjs";
import { createVadTurnDetector, encodePcm16SamplesToWav } from "../public/voice-copilot.js";

const SR = 16000;

// Deterministic PRNG so the synthetic road noise is identical on every run.
function lcg(seed = 7) {
  let x = seed >>> 0;
  return () => {
    x = (x * 1664525 + 1013904223) >>> 0;
    return x / 0xffffffff - 0.5;
  };
}

// Low-frequency rumble similar to tyre/engine noise inside a moving car.
function carNoise(ms, { amp = 0.02, seed = 7 } = {}) {
  const rand = lcg(seed);
  const n = Math.round((SR * ms) / 1000);
  const out = new Float32Array(n);
  let lp = 0;
  for (let i = 0; i < n; i += 1) {
    lp = lp * 0.97 + rand() * 0.03;
    out[i] = lp * amp * 18 + Math.sin((2 * Math.PI * 38 * i) / SR) * amp * 0.4;
  }
  return out;
}

// Voiced, syllable-modulated harmonic signal standing in for speech.
function speechLike(ms, { amp = 0.18, f0 = 190 } = {}) {
  const n = Math.round((SR * ms) / 1000);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const t = i / SR;
    const syllable = 0.55 + 0.45 * Math.sin(2 * Math.PI * 4 * t);
    out[i] = amp * syllable * (Math.sin(2 * Math.PI * f0 * t) + 0.5 * Math.sin(2 * Math.PI * f0 * 2 * t));
  }
  return out;
}

function mix(...parts) {
  const len = parts.reduce((s, p) => s + p.length, 0);
  const out = new Float32Array(len);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function overlay(base, top, offset = 0) {
  const out = Float32Array.from(base);
  for (let i = 0; i < top.length && i + offset < out.length; i += 1) out[i + offset] += top[i];
  return out;
}

function toInt16(f32) {
  const out = new Int16Array(f32.length);
  for (let i = 0; i < f32.length; i += 1) out[i] = Math.max(-32768, Math.min(32767, Math.round(f32[i] * 32767)));
  return out;
}

function runVad(f32, opts) {
  const vad = createVadTurnDetector({ sampleRate: SR, ...opts });
  const events = [];
  const frame = 683; // ~2048 frames at 48 kHz after downsampling
  for (let i = 0; i < f32.length; i += frame) {
    const chunk = f32.subarray(i, i + frame);
    let sum = 0;
    for (const v of chunk) sum += v * v;
    const ev = vad.pushSamples(toInt16(chunk), Math.sqrt(sum / chunk.length));
    if (ev.type !== "listening" && ev.type !== "idle") events.push(ev);
  }
  return events;
}

const DRIVE_VAD = {
  preRollMs: 600,
  silenceMs: 1600,
  minSpeechMs: 260,
  maxSpeechMs: 30000,
  rmsThreshold: 0.009,
  adaptive: true,
  requireSustainedOnset: true,
  minPeakRms: 0.010,
  minSnrRatio: 1.35,
};

test("road noise alone never triggers a voice turn", () => {
  const events = runVad(carNoise(8000), DRIVE_VAD);
  assert.equal(events.filter((e) => e.type === "utterance").length, 0);
});

test("a sentence with a mid-sentence pause over road noise stays one utterance in drive mode", () => {
  const noise = carNoise(9000, { seed: 11 });
  const sentence = mix(speechLike(1800), new Float32Array(Math.round(SR * 1.3)), speechLike(1600));
  const signal = overlay(noise, sentence, SR * 1);
  const utterances = runVad(signal, DRIVE_VAD).filter((e) => e.type === "utterance");
  assert.equal(utterances.length, 1);
  // Both halves (3.4 s of speech + the pause) must be in the single segment.
  assert.ok(utterances[0].samples.length / SR >= 4.2, `utterance only ${utterances[0].samples.length / SR}s`);
});

test("ASR prompt carries project hotwords and stays within whisper's prompt budget", () => {
  const prompt = buildVoiceAsrPrompt(["agent-control", "示例商城后台", "agent-control", "x".repeat(60)]);
  assert.match(prompt, /agent-control、示例商城后台/);
  assert.equal(prompt.match(/agent-control/g).length, 1);
  assert.doesNotMatch(prompt, /xxxxx/);
  assert.match(prompt, /Codex/);
  const many = buildVoiceAsrPrompt(Array.from({ length: 80 }, (_, i) => `project-${i}`));
  assert.ok(many.length <= 180, `prompt too long: ${many.length}`);
});

test("transcription sends project hotwords to the ASR worker", async (t) => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-drive-asr-"));
  const hub = {
    listThreads: async () => ({
      threads: [{ id: "codex:w:1", cwd: "/dev/fans-site" }, { id: "codex:w:2", cwd: "/dev/agent-control" }],
      projectsMeta: { "/dev/fans-site": { alias: "示例商城后台" } },
    }),
  };
  const svc = new VoiceCallService({ hub, dataDir: dir, env: {
    ...process.env,
    VOICE_ASR_BIN: fileURLToPath(new URL("./helpers/mock-voice-asr.mjs", import.meta.url)),
    MOCK_VOICE_ASR_ECHO_PROMPT: "1",
    EDGE_TTS_BIN: "none",
    MACOS_SAY_BIN: "none",
  } });
  t.after(async () => { await svc.close(); await rm(dir, { recursive: true, force: true }); });
  const wav = encodePcm16SamplesToWav(toInt16(overlay(carNoise(2500), speechLike(1500), 4000)), SR);
  const res = await svc.transcribeAudio({
    audioBase64: Buffer.from(wav).toString("base64"),
    promptHints: await svc.getAsrPromptHints(),
  });
  assert.match(res.text, /^PROMPT:/);
  assert.match(res.text, /示例商城后台、agent-control/);
});

test("voice turns queued during a slow reply are stitched, never dropped", async () => {
  const { mergeQueuedVoiceTurns } = await import("../public/voice-copilot.js");
  const a = { samples: new Int16Array(1600).fill(1), mode: "turn" };
  const b = { samples: new Int16Array(800).fill(2), mode: "turn" };
  const c = { samples: new Int16Array(400).fill(3), mode: "turn" };
  const merged = mergeQueuedVoiceTurns([a, b, c]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].mergedCount, 3);
  assert.equal(merged[0].samples.length, 1600 + 800 + 400 + 2 * 2560);
  const typed = { transcriptText: "播报进度", mode: "briefing" };
  const mixed = mergeQueuedVoiceTurns([a, typed, b, c]);
  assert.deepEqual(mixed.map((t) => t.mergedCount || 1), [1, 1, 2]);
  assert.equal(mixed[1], typed);
});
