import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDataDir } from "./instance-identity.mjs";
import { NdjsonWorkerClient } from "./ndjson-worker-client.mjs";
import {
  execFileCrossPlatform,
  providerCandidatePaths,
  resolveExecutableCrossPlatform,
} from "./platform.mjs";
import {
  agyExecutable,
  AntigravityAcpClient,
  createAcpPermissionResponse,
  DEFAULT_AGY_MODEL,
  FALLBACK_AGY_MODELS,
  listAgyModelsFromCli,
  normalizeAcpPermissionRequest,
} from "./providers/antigravity-acp-client.mjs";
import { discoverAntigravityProfiles } from "./providers/profile-discovery.mjs";

export const VOICE_CALL_TAG = "[AC_VOICE_CALL]";
export const DEFAULT_VOICE_TTS_NAME = "zh-CN-XiaoxiaoNeural";
export const DEFAULT_VOICE_HYDROGEN_MODEL = "gemini-4-hydrogen-low";
export const DEFAULT_VOICE_CLAUDE_MODEL = "claude-sonnet-5-5";
export const DEFAULT_VOICE_CODEX_MODEL = "gpt-6.1-terra";
const MAX_ACTIVE_CALL_SESSIONS = 6;
const MODEL_CACHE_TTL_MS = 120_000;
const EDGE_TTS_TIMEOUT_MS = 6_500;
const VOICE_PROMPT_TIMEOUT_MS = 60_000;

export function resolveEdgeTtsExecutable(env = process.env, {
  platform = process.platform,
  homeDir = os.homedir(),
} = {}) {
  return resolveExecutableCrossPlatform({
    envVar: "EDGE_TTS_BIN",
    candidates: providerCandidatePaths("edge-tts", { env, homeDir, platform }),
    binaryName: "edge-tts",
    env,
    platform,
    strictExplicit: true,
  }) || "";
}

export function resolveMacSayExecutable(env = process.env, {
  platform = process.platform,
} = {}) {
  const explicit = String(env?.MACOS_SAY_BIN ?? "").trim();
  if (explicit) {
    if (/^(?:none|0|false)$/i.test(explicit)) return "";
    return resolveExecutableCrossPlatform({
      envVar: "MACOS_SAY_BIN",
      strictExplicit: true,
      env,
      platform,
    }) || "";
  }
  if (platform !== "darwin") return "";
  return resolveExecutableCrossPlatform({
    candidates: ["/usr/bin/say"],
    binaryName: "say",
    env,
    platform,
  }) || "";
}

export function stripSpeechNoise(input = "", maxChars = 360) {
  let text = String(input || "")
    .replace(/<!--\s*GOAL_COMPLETE\s*-->/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "，代码部分已略，")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~>|]/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\b(?:antigravity|codex|claude|grok):[a-z0-9_-]+:[a-z0-9_-]+\b/gi, "")
    .replace(/(?:\/[\w.@+-]+){2,}/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (text.length > maxChars) {
    text = `${text.slice(0, maxChars).trim()}…`;
  }
  return text;
}

export function estimateSpeechDurationMs(text = "") {
  const clean = stripSpeechNoise(text, 360);
  if (!clean) return 0;
  const hanCount = (clean.match(/\p{Script=Han}/gu) || []).length;
  const wordCount = (clean.match(/[A-Za-z0-9_]+/g) || []).length;
  const punctCount = (clean.match(/[，。！？；：,.!?;:]/g) || []).length;
  const rawMs = 240 + hanCount * 205 + wordCount * 290 + punctCount * 160;
  return Math.max(600, Math.min(45_000, Math.round(rawMs)));
}

export function pickPreferredHydrogenModel(models = [], preferredOverride = "") {
  const override = String(preferredOverride || "").trim();
  if (override) return override;
  const list = (Array.isArray(models) ? models : [])
    .map((m) => (typeof m === "string"
      ? { id: m.trim(), text: m.trim().toLowerCase(), effort: "" }
      : {
          id: String(m?.id || m?.model || "").trim(),
          text: `${m?.id || ""} ${m?.model || ""} ${m?.baseModel || ""} ${m?.displayName || ""}`.toLowerCase(),
          effort: String(m?.defaultReasoningEffort || "").toLowerCase(),
        }))
    .filter((m) => Boolean(m.id));
  const isSlowFamily = (m) => /(orchestrator|carbon|opus)/i.test(m.text);
  const matchers = [
    (m) => m.id === DEFAULT_VOICE_HYDROGEN_MODEL,
    (m) => m.text.includes("hydrogen") && (m.effort === "low" || /\b(low|fast|lite)\b|-low\b/.test(m.text)),
    (m) => m.text.includes("hydrogen") && !/\b(medium|high|xhigh)\b|-(medium|high|xhigh)\b/.test(m.text),
    (m) => m.text.includes("hydrogen") && (m.effort === "medium" || /\bmedium\b|-medium\b/.test(m.text)),
    (m) => m.id === "gemini-3.8-flash-low",
    (m) => /\b(flash|argon)\b/.test(m.text) && (m.effort === "low" || /\b(low|fast|lite)\b|-low\b/.test(m.text)),
    (m) => m.text.includes("hydrogen") && !/\bxhigh\b|-xhigh\b/.test(m.text),
    (m) => m.text.includes("hydrogen"),
    (m) => /\bflash\b/.test(m.text),
    (m) => !isSlowFamily(m) && (m.effort === "low" || /-(low|fast|lite)\b/.test(m.text)),
  ];
  for (const matcher of matchers) {
    const hit = list.find(matcher);
    if (hit?.id) {
      if (hit.id === "gemini-4-hydrogen") return DEFAULT_VOICE_HYDROGEN_MODEL;
      return hit.id;
    }
  }
  return DEFAULT_VOICE_HYDROGEN_MODEL;
}

export const VOICE_LIGHT_PROVIDER_PRIORITY = Object.freeze(["antigravity", "claude", "codex", "grok"]);

function voiceModelScoreForProvider(provider, item) {
  const id = String(item?.id || item?.model || "").trim().toLowerCase();
  const text = `${id} ${item?.displayName || ""} ${item?.description || ""}`.toLowerCase();
  const effort = String(item?.defaultReasoningEffort || "").toLowerCase();
  if (provider === "antigravity") {
    if (id === DEFAULT_VOICE_HYDROGEN_MODEL) return 1000;
    if (text.includes("hydrogen") && (effort === "low" || /\b(low|fast|lite)\b|-low\b/.test(text))) return 900;
    if (text.includes("hydrogen")) return 820;
    if (/\bflash\b|\bargon\b/.test(text)) return 760;
    if (/(orchestrator|carbon|opus)/.test(text)) return 200;
    return 500;
  }
  if (provider === "claude") {
    if (id === "claude-sonnet-5-5") return 980;
    if (id === "claude-sonnet-4-6") return 960;
    if (id === "claude-sonnet-4-5") return 950;
    if (text.includes("sonnet")) return 930;
    if (text.includes("haiku")) return 820;
    if (/\b(fast|mini|flash|lite)\b/.test(text)) return 780;
    if (text.includes("opus") || text.includes("fable")) return 250;
    return 450;
  }
  if (provider === "codex") {
    if (id === "gpt-6.1-terra") return 990;
    if (text.includes("6.1") && text.includes("terra")) return 980;
    if (text.includes("terra")) return 940;
    if (/\bmini\b/.test(text) && !text.includes("preview")) return 880;
    if (/\b(mini|spark|nano|fast|lite)\b/.test(text)) return 850;
    if (effort === "low") return 760;
    if (item?.isDefault) return 680;
    if (/\bmax\b|\bxhigh\b|\bpro\b/.test(text)) return 300;
    return 500;
  }
  if (provider === "grok") {
    if (/\b(mini|fast|lite|small)\b/.test(text)) return 900;
    if (item?.isDefault) return 700;
    return 500;
  }
  return item?.isDefault ? 600 : 400;
}

export function pickPreferredVoiceModel(provider, models = [], preferredOverride = "") {
  const override = String(preferredOverride || "").trim();
  if (override) return override;
  const prov = String(provider || "").trim().toLowerCase();
  if (prov === "antigravity") return pickPreferredHydrogenModel(models, "");
  const list = (Array.isArray(models) ? models : [])
    .map((m) => (typeof m === "string"
      ? { id: m.trim(), displayName: m.trim(), description: "", defaultReasoningEffort: "", isDefault: false }
      : {
          id: String(m?.id || m?.model || "").trim(),
          displayName: String(m?.displayName || m?.model || m?.id || "").trim(),
          description: String(m?.description || ""),
          defaultReasoningEffort: String(m?.defaultReasoningEffort || ""),
          isDefault: Boolean(m?.isDefault),
        }))
    .filter((m) => Boolean(m.id));
  if (list.length > 0) {
    const ranked = [...list].sort((a, b) => voiceModelScoreForProvider(prov, b) - voiceModelScoreForProvider(prov, a));
    return ranked[0].id;
  }
  if (prov === "claude") return DEFAULT_VOICE_CLAUDE_MODEL;
  if (prov === "codex") return DEFAULT_VOICE_CODEX_MODEL;
  if (prov === "grok") return "grok-3-mini";
  return "";
}

function resolveVoiceEffort(provider, model = "") {
  const prov = String(provider || "").trim().toLowerCase();
  if (prov === "claude" || prov === "codex") {
    return "low";
  }
  const cleanModel = String(model || "").trim();
  if (prov === "antigravity") {
    return /\b(low|fast|lite)\b|-low\b/i.test(cleanModel) ? "low" : "";
  }
  return /\b(low|fast|lite|mini|spark)\b|-low\b/i.test(cleanModel) ? "low" : "";
}

function voiceProviderDisplayName(provider) {
  switch (String(provider || "").toLowerCase()) {
    case "antigravity":
      return "Antigravity";
    case "codex":
      return "Codex";
    case "claude":
      return "Claude";
    case "grok":
      return "Grok";
    default:
      return String(provider || "AI");
  }
}

function formatVoiceModelShortName(provider, model) {
  const prov = String(provider || "").toLowerCase();
  const raw = String(model || "").trim();
  if (!raw) return voiceProviderDisplayName(prov);
  if (/hydrogen/i.test(raw)) return "Hydrogen";
  if (/^gpt-6\.1-terra$/i.test(raw)) return "GPT-6.1 Terra";
  if (/sonnet/i.test(raw)) {
    const m = raw.match(/sonnet[-_ ]?(\d+(?:[-.]\d+)?)/i);
    return m ? `Sonnet ${m[1].replace(/-/g, ".")}` : "Sonnet";
  }
  if (/haiku/i.test(raw)) {
    const m = raw.match(/haiku[-_ ]?(\d+(?:[-.]\d+)?)/i);
    return m ? `Haiku ${m[1].replace(/-/g, ".")}` : "Haiku";
  }
  return raw.replace(/^gemini-\d+(?:\.\d+)?-/i, "");
}

function parseVoiceSelectionKey(selectionKey = "auto") {
  const key = String(selectionKey || "").trim();
  if (!key || ["auto", "local", "local:local-rules"].includes(key)) {
    return { voiceProvider: "", voiceProfileId: "", voiceModel: "" };
  }
  const firstColon = key.indexOf(":");
  if (firstColon < 0) return { voiceProvider: key, voiceProfileId: "", voiceModel: "" };
  const voiceProvider = key.slice(0, firstColon).trim();
  const rest = key.slice(firstColon + 1);
  const secondColon = rest.indexOf(":");
  if (secondColon < 0) return { voiceProvider, voiceProfileId: "", voiceModel: rest.trim() };
  return { voiceProvider, voiceProfileId: rest.slice(0, secondColon).trim(), voiceModel: rest.slice(secondColon + 1).trim() };
}

function extensionForAudioMime(mimeType = "") {
  const low = String(mimeType || "").toLowerCase();
  if (low.includes("mpeg") || low.includes("mp3")) return "mp3";
  if (low.includes("mp4") || low.includes("m4a") || low.includes("aac")) return "m4a";
  if (low.includes("ogg")) return "ogg";
  if (low.includes("webm")) return "webm";
  return "wav";
}

export function analyzeWavPcm16Activity(
  audioInput,
  {
    minDurationMs = 140,
    minPeak = 0.008,
    minRms = 0.0028,
    minMaxFrameRms = 0.008,
    frameMs = 20,
    allowLegacyZeroMockStub = false,
  } = {},
) {
  let buf;
  if (Buffer.isBuffer(audioInput)) {
    buf = audioInput;
  } else if (audioInput instanceof Uint8Array) {
    buf = Buffer.from(audioInput.buffer, audioInput.byteOffset, audioInput.byteLength);
  } else {
    const clean = String(audioInput || "").replace(/^data:[^;]+;base64,/, "").trim();
    if (!clean) {
      return {
        inspected: true,
        hasSpeech: false,
        reason: "empty_audio",
        durationMs: 0,
        sampleCount: 0,
        sampleRate: 0,
        channels: 0,
        rms: 0,
        peak: 0,
        maxFrameRms: 0,
      };
    }
    buf = Buffer.from(clean, "base64");
  }

  if (buf.length < 44) {
    const isWavHeader = buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE";
    if (isWavHeader || buf.length < 64) {
      return {
        inspected: true,
        hasSpeech: false,
        reason: "too_short_audio",
        durationMs: 0,
        sampleCount: 0,
        sampleRate: 0,
        channels: 0,
        rms: 0,
        peak: 0,
        maxFrameRms: 0,
      };
    }
    return { inspected: false, hasSpeech: true, reason: "non_wav_container" };
  }

  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    return { inspected: false, hasSpeech: true, reason: "non_wav_container" };
  }

  let audioFormat = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataEnd = -1;

  let offset = 12;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString("ascii", offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    const bodyStart = offset + 8;
    const paddedSize = chunkSize + (chunkSize % 2);
    if (chunkId === "fmt " && bodyStart + 16 <= buf.length) {
      audioFormat = buf.readUInt16LE(bodyStart);
      channels = buf.readUInt16LE(bodyStart + 2);
      sampleRate = buf.readUInt32LE(bodyStart + 4);
      bitsPerSample = buf.readUInt16LE(bodyStart + 14);
    } else if (chunkId === "data") {
      dataStart = bodyStart;
      dataEnd = Math.min(buf.length, bodyStart + chunkSize);
      break;
    }
    if (paddedSize <= 0 && chunkSize === 0) {
      offset = bodyStart;
    } else {
      offset = bodyStart + paddedSize;
    }
  }

  if (dataStart < 0 || dataEnd <= dataStart) {
    return {
      inspected: true,
      hasSpeech: false,
      reason: "empty_audio",
      durationMs: 0,
      sampleCount: 0,
      sampleRate,
      channels,
      rms: 0,
      peak: 0,
      maxFrameRms: 0,
    };
  }

  if (audioFormat !== 1 || bitsPerSample !== 16 || sampleRate <= 0 || channels <= 0) {
    return { inspected: false, hasSpeech: true, reason: "non_pcm16_wav" };
  }

  const totalSamples = Math.floor((dataEnd - dataStart) / 2);
  const frameCount = Math.floor(totalSamples / channels);
  if (frameCount <= 0) {
    return {
      inspected: true,
      hasSpeech: false,
      reason: "empty_audio",
      durationMs: 0,
      sampleCount: 0,
      sampleRate,
      channels,
      rms: 0,
      peak: 0,
      maxFrameRms: 0,
    };
  }

  const durationMs = Math.round((frameCount / sampleRate) * 1000);
  const windowMs = Math.max(1, Number(frameMs) || 20);
  const samplesPerWindow = Math.max(1, Math.round((sampleRate * channels * windowMs) / 1000));
  let peak = 0;
  let sumSq = 0;
  let winSumSq = 0;
  let winCount = 0;
  let maxFrameRms = 0;
  const frameRmsList = [];

  for (let i = 0; i < totalSamples; i += 1) {
    const sample = buf.readInt16LE(dataStart + i * 2) / 32768;
    const abs = Math.abs(sample);
    if (abs > peak) peak = abs;
    const sq = sample * sample;
    sumSq += sq;
    winSumSq += sq;
    winCount += 1;
    if (winCount >= samplesPerWindow) {
      const frameRms = Math.sqrt(winSumSq / winCount);
      frameRmsList.push(frameRms);
      if (frameRms > maxFrameRms) maxFrameRms = frameRms;
      winSumSq = 0;
      winCount = 0;
    }
  }
  if (winCount > 0) {
    const frameRms = Math.sqrt(winSumSq / winCount);
    frameRmsList.push(frameRms);
    if (frameRms > maxFrameRms) maxFrameRms = frameRms;
  }
  const rms = Math.sqrt(sumSq / totalSamples);

  if (allowLegacyZeroMockStub && peak === 0 && frameCount === 1600 && sampleRate === 16000 && channels === 1) {
    return {
      inspected: true,
      hasSpeech: true,
      isLegacyMockStub: true,
      reason: "legacy_mock_stub",
      durationMs,
      sampleCount: frameCount,
      sampleRate,
      channels,
      rms: 0,
      peak: 0,
      maxFrameRms: 0,
    };
  }

  if (durationMs < minDurationMs) {
    return {
      inspected: true,
      hasSpeech: false,
      reason: "too_short_audio",
      durationMs,
      sampleCount: frameCount,
      sampleRate,
      channels,
      rms,
      peak,
      maxFrameRms,
    };
  }
  if (peak < minPeak) {
    return {
      inspected: true,
      hasSpeech: false,
      reason: "digital_silence",
      durationMs,
      sampleCount: frameCount,
      sampleRate,
      channels,
      rms,
      peak,
      maxFrameRms,
    };
  }
  if (rms < minRms || maxFrameRms < minMaxFrameRms) {
    return {
      inspected: true,
      hasSpeech: false,
      reason: "ambient_noise_only",
      durationMs,
      sampleCount: frameCount,
      sampleRate,
      channels,
      rms,
      peak,
      maxFrameRms,
    };
  }

  if (durationMs >= 320 && frameRmsList.length > 0) {
    const sorted = [...frameRmsList].sort((a, b) => a - b);
    const p25 = sorted[Math.floor(sorted.length * 0.25)] || 0;
    const voiceFrameThr = Math.max(minMaxFrameRms, Math.min(0.015, p25 * 2.0));
    let maxContiguousWindows = 0;
    let curContiguous = 0;
    for (const v of frameRmsList) {
      if (v >= voiceFrameThr) {
        curContiguous += 1;
        if (curContiguous > maxContiguousWindows) maxContiguousWindows = curContiguous;
      } else {
        curContiguous = 0;
      }
    }
    if (maxContiguousWindows * windowMs < 100) {
      return {
        inspected: true,
        hasSpeech: false,
        reason: "transient_clicks_only",
        durationMs,
        sampleCount: frameCount,
        sampleRate,
        channels,
        rms,
        peak,
        maxFrameRms,
      };
    }
  }

  return {
    inspected: true,
    hasSpeech: true,
    reason: "speech_detected",
    durationMs,
    sampleCount: frameCount,
    sampleRate,
    channels,
    rms,
    peak,
    maxFrameRms,
  };
}

const VOICE_ASR_BASE_HOTWORDS = ["Codex", "Claude", "Antigravity", "Gemini", "RemoDeck", "会话", "项目", "撤回", "继续", "派给"];

// Whisper initial_prompt biases decoding toward these spellings (project names are the usual misses).
export function buildVoiceAsrPrompt(projectNames = [], { maxChars = 180 } = {}) {
  const seen = new Set();
  const names = [];
  for (const raw of projectNames) {
    const name = String(raw || "").trim();
    const key = name.toLowerCase();
    if (!name || name.length > 32 || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  const head = "普通话语音对话，";
  const tail = `常用词：${VOICE_ASR_BASE_HOTWORDS.join("、")}。`;
  let projectPart = "";
  for (const name of names) {
    const next = projectPart ? `${projectPart}、${name}` : name;
    if (head.length + `项目有：${next}。`.length + tail.length > maxChars) break;
    projectPart = next;
  }
  return `${head}${projectPart ? `项目有：${projectPart}。` : ""}${tail}`;
}

export class VoiceCallService {
  #hub;
  #env;
  #dataDir;
  #workspaceDir;
  #utterancesDir;
  #execFile;
  #client = null;
  #clientAppDataDir = "";
  #initClientPromise = null;
  #modelsCache = null;
  #hubModelsCache = new Map();
  #calls = new Map();
  #ttsCache = new Map();
  #activeSessionTurn = new Map();
  #turnQueue = Promise.resolve();
  #asrHotwordNames = [];
  #asrHotwordUpdatedAt = 0;
  #asrWorker;
  #edgeTtsWorker;
  #kokoroWorker;
  #closed = false;

  constructor({
    hub,
    env = process.env,
    dataDir = defaultDataDir(env),
    execFileImpl = execFileCrossPlatform,
  } = {}) {
    this.#hub = hub;
    this.#env = env;
    this.#dataDir = dataDir;
    this.#workspaceDir = resolve(dataDir, "voice-call");
    this.#utterancesDir = resolve(this.#workspaceDir, "utterances");
    this.#execFile = execFileImpl;
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    this.#edgeTtsWorker = new NdjsonWorkerClient({
      label: "Edge TTS 常驻进程",
      readyTimeoutMs: 10_000,
      defaultRequestTimeoutMs: EDGE_TTS_TIMEOUT_MS,
      stderrLimit: 600,
      isClosed: () => this.#closed,
      resolveLaunch: (ttsBin) => {
        const cleanBin = ttsBin || resolveEdgeTtsExecutable(this.#env);
        const pythonBin = this.#resolveEdgeTtsPython(cleanBin);
        if (!pythonBin) {
          throw new Error("未检测到 Edge TTS Python 环境");
        }
        return {
          cmd: pythonBin,
          args: [resolve(moduleDir, "voice-edge-tts-worker.py")],
          env: { ...this.#env },
        };
      },
    });
    this.#kokoroWorker = new NdjsonWorkerClient({
      label: "Kokoro",
      readyTimeoutMs: 45_000,
      defaultRequestTimeoutMs: 20_000,
      stderrLimit: 600,
      isClosed: () => this.#closed,
      resolveLaunch: () => {
        const explicitBin = String(this.#env?.VOICE_KOKORO_BIN || "").trim();
        const workerScript = resolve(moduleDir, "voice-kokoro-tts-worker.py");
        const cmd = explicitBin || (this.#env?.VOICE_PYTHON_BIN || "/opt/homebrew/bin/python3.12");
        return {
          cmd,
          args: explicitBin ? [] : [workerScript],
          env: {
            ...this.#env,
            HF_HUB_OFFLINE: "1",
            TRANSFORMERS_OFFLINE: "1",
          },
        };
      },
    });
    this.#asrWorker = new NdjsonWorkerClient({
      label: "本地 Whisper",
      readyTimeoutMs: 45_000,
      defaultRequestTimeoutMs: 35_000,
      stderrLimit: 800,
      isClosed: () => this.#closed,
      resolveLaunch: () => {
        const explicitBin = String(this.#env?.VOICE_ASR_BIN || process.env.VOICE_ASR_BIN || "").trim();
        const workerScript = resolve(moduleDir, "voice-asr-worker.py");
        const cmd = explicitBin || (this.#env?.VOICE_PYTHON_BIN || "/opt/homebrew/bin/python3.12");
        return {
          cmd,
          args: explicitBin ? [] : [workerScript],
          env: {
            ...this.#env,
            HF_HUB_OFFLINE: "1",
            TRANSFORMERS_OFFLINE: "1",
          },
        };
      },
    });
  }

  async resolveHydrogenModel() {
    const override = String(this.#env?.AGENT_CONTROL_VOICE_MODEL || "").trim();
    if (override) return override;
    if (!this.#modelsCache || Date.now() - this.#modelsCache.at > MODEL_CACHE_TTL_MS) {
      let items = [];
      try {
        items = await listAgyModelsFromCli({
          env: this.#env,
          execFileImpl: this.#execFile,
        });
      } catch {
        items = [];
      }
      if (Array.isArray(items) && items.length > 0) {
        this.#modelsCache = { at: Date.now(), items };
      } else {
        return pickPreferredHydrogenModel([...FALLBACK_AGY_MODELS]);
      }
    }
    return pickPreferredHydrogenModel(this.#modelsCache.items);
  }

  #hasLocalWhisperRuntime() {
    const explicitBin = String(this.#env?.VOICE_ASR_BIN || process.env.VOICE_ASR_BIN || "").trim();
    if (explicitBin) return true;
    if (process.platform !== "darwin") return false;
    const pyBin = String(this.#env?.VOICE_PYTHON_BIN || "").trim();
    if (pyBin) return existsSync(pyBin);
    return existsSync("/opt/homebrew/bin/python3.12") || existsSync("/usr/bin/python3");
  }

  async #listModelsForProviderSafe(provider) {
    const prov = String(provider || "").trim().toLowerCase();
    const cached = this.#hubModelsCache.get(prov);
    if (cached && Date.now() - cached.at < MODEL_CACHE_TTL_MS) {
      return cached.items;
    }
    let items = [];
    if (prov === "antigravity") {
      try {
        items = await Promise.race([
          listAgyModelsFromCli({ env: this.#env, execFileImpl: this.#execFile }),
          new Promise((res) => setTimeout(() => res([]), 1500)),
        ]);
      } catch {
        items = [];
      }
      if (!Array.isArray(items) || !items.length) {
        items = [...FALLBACK_AGY_MODELS];
      }
    } else if (typeof this.#hub?.listModels === "function") {
      try {
        const res = await Promise.race([
          this.#hub.listModels(prov),
          new Promise((res) => setTimeout(() => res(null), 1500)),
        ]);
        items = Array.isArray(res?.items) ? res.items : (Array.isArray(res) ? res : []);
      } catch {
        items = [];
      }
    }
    if (items.length > 0) {
      this.#hubModelsCache.set(prov, { at: Date.now(), items });
    }
    return items;
  }

  async #getInstalledVoiceProfiles() {
    if (typeof this.#hub?.listProvidersAndProfiles === "function") {
      try {
        const payload = await this.#hub.listProvidersAndProfiles();
        const profiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
        return profiles.filter((p) => p?.installed !== false && !p?.health?.disabled && p?.health?.status !== "unavailable");
      } catch {}
    }
    const agyProfiles = await discoverAntigravityProfiles({ env: this.#env }).catch(() => []);
    return agyProfiles.filter((p) => p?.installed !== false && !p?.health?.disabled);
  }

  async listVoiceModelOptions({
    voiceProvider = "",
    voiceModel = "",
    voiceProfileId = "",
  } = {}) {
    const installedProfiles = await this.#getInstalledVoiceProfiles();
    const byProvider = new Map();
    for (const p of installedProfiles) {
      const prov = String(p?.provider || "").toLowerCase();
      if (!prov || !VOICE_LIGHT_PROVIDER_PRIORITY.includes(prov)) continue;
      if (!byProvider.has(prov)) byProvider.set(prov, []);
      byProvider.get(prov).push(p);
    }

    const availableProviders = VOICE_LIGHT_PROVIDER_PRIORITY.filter((prov) => byProvider.has(prov));
    const modelsEntries = await Promise.all(
      availableProviders.map(async (prov) => [prov, await this.#listModelsForProviderSafe(prov)]),
    );
    const modelsByProvider = new Map(modelsEntries);

    const options = [
      {
        key: "auto",
        provider: "auto",
        profileId: "",
        model: "",
        label: "自动优选轻量模型",
        shortLabel: "自动轻量",
        description: "优先使用本机已登录的低延迟模型（Hydrogen / Claude Sonnet 低思考 / GPT-6.1 Terra 低思考）",
      },
    ];

    for (const prov of availableProviders) {
      const profiles = byProvider.get(prov) || [];
      const chosenProfile = profiles.find((p) => p.authenticated !== false) || profiles[0];
      const profileId = chosenProfile?.id || (prov === "antigravity" ? "cli" : "default");
      const rawModels = modelsByProvider.get(prov) || [];
      const preferredModelId = pickPreferredVoiceModel(prov, rawModels, "");
      const deduped = [];
      const seenIds = new Set();

      if (preferredModelId) {
        const hit = rawModels.find((m) => (m?.id || m?.model) === preferredModelId);
        seenIds.add(preferredModelId);
        deduped.push({
          id: preferredModelId,
          displayName: hit?.displayName || formatVoiceModelShortName(prov, preferredModelId),
          isLight: true,
          effort: resolveVoiceEffort(prov, preferredModelId),
        });
      }
      const ranked = [...rawModels].sort((a, b) => voiceModelScoreForProvider(prov, b) - voiceModelScoreForProvider(prov, a));
      for (const m of ranked) {
        const id = String(m?.id || m?.model || "").trim();
        if (!id || seenIds.has(id)) continue;
        seenIds.add(id);
        deduped.push({
          id,
          displayName: m?.displayName || formatVoiceModelShortName(prov, id),
          isLight: voiceModelScoreForProvider(prov, m) >= 750,
          effort: resolveVoiceEffort(prov, id) || String(m?.defaultReasoningEffort || ""),
        });
        if (deduped.length >= 6) break;
      }

      if (!deduped.length) {
        const fallbackId = pickPreferredVoiceModel(prov, [], "");
        if (fallbackId) {
          deduped.push({
            id: fallbackId,
            displayName: formatVoiceModelShortName(prov, fallbackId),
            isLight: true,
            effort: "low",
          });
        }
      }

      const provName = voiceProviderDisplayName(prov);
      for (const item of deduped) {
        const key = `${prov}:${profileId}:${item.id}`;
        const shortName = formatVoiceModelShortName(prov, item.id);
        options.push({
          key,
          provider: prov,
          profileId,
          model: item.id,
          effort: item.effort || "",
          isLight: Boolean(item.isLight),
          label: `${provName} · ${item.displayName}${item.isLight ? " (轻量)" : ""}`,
          shortLabel: prov === "antigravity" && /hydrogen/i.test(item.id)
            ? "Hydrogen"
            : `${provName} · ${shortName}`,
        });
      }
    }

    const resolved = await this.resolveVoiceTarget({
      voiceProvider,
      voiceModel,
      voiceProfileId,
      _installedProfiles: installedProfiles,
      _modelsByProvider: modelsByProvider,
    });

    return {
      options,
      resolved,
    };
  }

  async resolveVoiceTarget({
    voiceProvider = "",
    voiceModel = "",
    voiceProfileId = "",
    _installedProfiles = null,
    _modelsByProvider = null,
  } = {}) {
    const requestedProvider = String(voiceProvider || this.#env?.AGENT_CONTROL_VOICE_PROVIDER || "").trim().toLowerCase();
    const requestedModel = String(voiceModel || this.#env?.AGENT_CONTROL_VOICE_MODEL || "").trim();
    // Migrate saved preferences from the removed local-rule mode.
    const legacyLocal = requestedProvider === "local" || requestedModel === "local-rules";
    const rawProvider = legacyLocal ? "auto" : requestedProvider;
    const rawModel = legacyLocal ? "" : requestedModel;
    const rawProfileId = String(voiceProfileId || "").trim();

    const installedProfiles = _installedProfiles || await this.#getInstalledVoiceProfiles();
    const hasProviderList = installedProfiles.length > 0;

    const pickProfileFor = (prov) => {
      const candidates = installedProfiles.filter((p) => String(p?.provider || "").toLowerCase() === prov);
      if (rawProfileId) {
        const exact = candidates.find((p) => p.id === rawProfileId);
        if (exact) return exact;
      }
      return candidates.find((p) => p.authenticated !== false) || candidates[0] || null;
    };

    const getModelsFor = async (prov) => {
      if (_modelsByProvider?.has(prov)) return _modelsByProvider.get(prov);
      return this.#listModelsForProviderSafe(prov);
    };

    if (rawProvider && rawProvider !== "auto") {
      const prof = pickProfileFor(rawProvider);
      const models = await getModelsFor(rawProvider);
      const chosenModel = rawProvider === "antigravity"
        ? (rawModel || await this.resolveHydrogenModel().catch(() => DEFAULT_VOICE_HYDROGEN_MODEL))
        : pickPreferredVoiceModel(rawProvider, models, rawModel);
      const effort = resolveVoiceEffort(rawProvider, chosenModel);
      const shortName = formatVoiceModelShortName(rawProvider, chosenModel);
      return {
        selectionKey: `${rawProvider}:${prof?.id || rawProfileId || "default"}:${chosenModel}`,
        provider: rawProvider,
        profileId: prof?.id || rawProfileId || (rawProvider === "antigravity" ? "cli" : "default"),
        model: chosenModel,
        effort,
        shortLabel: rawProvider === "antigravity" && /hydrogen/i.test(chosenModel) ? "Hydrogen" : `${voiceProviderDisplayName(rawProvider)} · ${shortName}`,
        displayName: `${voiceProviderDisplayName(rawProvider)} (${shortName})`,
      };
    }

    if (rawModel) {
      const inferredProvider = /claude|haiku|sonnet|opus/i.test(rawModel)
        ? "claude"
        : (/gpt|codex|terra|o1|o3|o4|spark/i.test(rawModel) ? "codex" : (/grok/i.test(rawModel) ? "grok" : "antigravity"));
      const prof = pickProfileFor(inferredProvider);
      const effort = resolveVoiceEffort(inferredProvider, rawModel);
      const shortName = formatVoiceModelShortName(inferredProvider, rawModel);
      return {
        selectionKey: `${inferredProvider}:${prof?.id || "default"}:${rawModel}`,
        provider: inferredProvider,
        profileId: prof?.id || (inferredProvider === "antigravity" ? "cli" : "default"),
        model: rawModel,
        effort,
        shortLabel: inferredProvider === "antigravity" && /hydrogen/i.test(rawModel) ? "Hydrogen" : `${voiceProviderDisplayName(inferredProvider)} · ${shortName}`,
        displayName: `${voiceProviderDisplayName(inferredProvider)} (${shortName})`,
      };
    }

    // "auto": pick best available authenticated lightweight provider
    const hasExplicitOrMockAgy = basename(agyExecutable(this.#env) || "").includes("mock-agy");
    if (hasProviderList) {
      const isKnownAuthed = (p) => p?.authenticated === true || (p?.authenticated !== false && p?.account?.signedIn === true);
      const isNotUnavailable = (p) => p?.health?.status !== "unavailable" && p?.health?.available !== false;
      const pickAutoCandidate = (predicate) => {
        for (const prov of VOICE_LIGHT_PROVIDER_PRIORITY) {
          const candidates = installedProfiles.filter((p) => String(p?.provider || "").toLowerCase() === prov);
          const healthyMatch = candidates.find((p) => p.health?.status === "healthy" && predicate(p));
          if (healthyMatch) return { prov, prof: healthyMatch };
          const matched = candidates.find(predicate);
          if (matched) return { prov, prof: matched };
        }
        return null;
      };
      const picked = pickAutoCandidate((p) => isKnownAuthed(p) && isNotUnavailable(p))
        || pickAutoCandidate((p) => isKnownAuthed(p))
        || pickAutoCandidate((p) => p.authenticated !== false && isNotUnavailable(p))
        || pickAutoCandidate((p) => p.authenticated !== false)
        || pickAutoCandidate(() => true);
      if (picked) {
        const { prov, prof } = picked;
        const models = await getModelsFor(prov);
        const chosenModel = prov === "antigravity"
          ? await this.resolveHydrogenModel().catch(() => DEFAULT_VOICE_HYDROGEN_MODEL)
          : pickPreferredVoiceModel(prov, models, "");
        const effort = resolveVoiceEffort(prov, chosenModel);
        const shortName = formatVoiceModelShortName(prov, chosenModel);
        return {
          selectionKey: "auto",
          provider: prov,
          profileId: prof.id || (prov === "antigravity" ? "cli" : "default"),
          model: chosenModel,
          effort,
          shortLabel: prov === "antigravity" && /hydrogen/i.test(chosenModel) ? "Hydrogen" : `${voiceProviderDisplayName(prov)} · ${shortName}`,
          displayName: `${voiceProviderDisplayName(prov)} (${shortName})`,
        };
      }
    }

    if (hasExplicitOrMockAgy || typeof this.#hub?.listProvidersAndProfiles !== "function") {
      const model = await this.resolveHydrogenModel().catch(() => DEFAULT_VOICE_HYDROGEN_MODEL);
      return {
        selectionKey: "auto",
        provider: "antigravity",
        profileId: "cli",
        model,
        effort: /\b(low|fast|lite)\b|-low\b/i.test(model) ? "low" : "",
        shortLabel: "Hydrogen",
        displayName: "Antigravity (Hydrogen)",
      };
    }

    throw Object.assign(new Error("未找到可用的语音理解模型，请选择已登录的模型。未执行任何语音控制操作。"), { status: 503 });
  }

  async #resolveAgyAppDataDir() {
    if (this.#clientAppDataDir) return this.#clientAppDataDir;
    const profiles = await discoverAntigravityProfiles({ env: this.#env }).catch(() => []);
    const usable = profiles.filter((p) => p.installed !== false && p.authenticated !== false);
    const chosen = usable.find((p) => p.id === "desktop")
      || usable[0]
      || profiles.find((p) => p.installed !== false && p.id === "desktop")
      || profiles.find((p) => p.installed !== false)
      || profiles[0];
    this.#clientAppDataDir = chosen?.home || "";
    return this.#clientAppDataDir;
  }

  async #ensureClient() {
    if (this.#closed) {
      throw Object.assign(new Error("语音通话服务已关闭"), { status: 503 });
    }
    if (this.#client?.isConnected) return this.#client;
    if (this.#initClientPromise) return this.#initClientPromise;

    this.#initClientPromise = (async () => {
      await mkdir(this.#utterancesDir, { recursive: true });
      const appDataDir = await this.#resolveAgyAppDataDir();
      const client = new AntigravityAcpClient({
        appDataDir,
        env: this.#env,
      });

      client.on("serverRequest", (msg) => {
        if (msg?.method !== "session/request_permission") return;
        const normalized = normalizeAcpPermissionRequest(msg);
        client.respond(
          normalized.rawId,
          createAcpPermissionResponse(normalized, { decision: "decline" }),
        );
      });

      client.on("sessionUpdate", (params) => {
        const sessionId = String(params?.sessionId || "");
        const update = params?.update || {};
        if (!sessionId) return;
        if (update.sessionUpdate === "agent_message_chunk") {
          const text = update.content?.text || "";
          const buf = this.#activeSessionTurn.get(sessionId);
          if (buf && text) {
            buf.text += text;
            try { buf.onDelta?.(text, buf.text); } catch {}
          }
          return;
        }
      });

      client.on("exit", () => {
        if (this.#client === client) {
          this.#client = null;
          this.#calls.clear();
        }
      });

      await client.ensureReady();
      this.#client = client;
      return client;
    })().finally(() => {
      this.#initClientPromise = null;
    });

    return this.#initClientPromise;
  }

  #trimCallCache() {
    if (this.#calls.size > MAX_ACTIVE_CALL_SESSIONS) {
      const sorted = [...this.#calls.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
      while (sorted.length > MAX_ACTIVE_CALL_SESSIONS) {
        const [evictId] = sorted.shift();
        this.#calls.delete(evictId);
      }
    }
  }

  async synthesizeSpeech(input = {}, maybeOpts = {}) {
    const opts = typeof input === "string" ? { ...(maybeOpts || {}), text: input } : (input || {});
    const {
      text = "",
      voice = DEFAULT_VOICE_TTS_NAME,
      callId = "",
      utteranceId = "",
      source = "notice",
      priority = "normal",
      preferOffline = false,
      register = true,
    } = opts;
    const cleanText = stripSpeechNoise(text, 360);
    const cleanCallId = String(callId || "").trim();
    const cleanUttId = String(utteranceId || "").trim();
    if (!cleanText) {
      return {
        audioBase64: "",
        mimeType: "",
        provider: "none",
        text: "",
        utteranceId: cleanUttId,
        expectedMs: 0,
      };
    }

    let audioBase64 = "";
    let mimeType = "";
    let provider = "none";
    const ttsBin = resolveEdgeTtsExecutable(this.#env);
    if (ttsBin && this.#resolveEdgeTtsPython(ttsBin)) {
      void this.#edgeTtsWorker.ensureReady(ttsBin).catch(() => {});
    }
    if (this.#hasLocalKokoroRuntime()) {
      void this.#kokoroWorker.ensureReady().catch(() => {});
    }
    const sayBin = resolveMacSayExecutable(this.#env);
    const cacheKey = cleanText.length <= 120
      ? `${String(voice || DEFAULT_VOICE_TTS_NAME)}|${ttsBin}|${sayBin}|${preferOffline ? "off" : "auto"}|${cleanText}`
      : "";
    const cached = cacheKey ? this.#ttsCache.get(cacheKey) : null;
    if (cached) {
      audioBase64 = cached.audioBase64;
      mimeType = cached.mimeType;
      provider = cached.provider;
    }

    const preferKokoroPrimary = String(this.#env?.AGENT_CONTROL_TTS_ENGINE || "").trim().toLowerCase() === "kokoro";
    if (!audioBase64 && preferKokoroPrimary && this.#hasLocalKokoroRuntime()) {
      try {
        const kokoroRes = await this.#synthesizeViaKokoroWorker({ text: cleanText });
        if (kokoroRes?.audioBase64) {
          audioBase64 = kokoroRes.audioBase64;
          mimeType = kokoroRes.mimeType || "audio/wav";
          provider = "kokoro";
        }
      } catch {
        // Fall through to Edge TTS / macOS say.
      }
    }

    if (!audioBase64 && !preferOffline && ttsBin) {
      const workerPy = this.#resolveEdgeTtsPython(ttsBin);
      if (workerPy) {
        try {
          const workerRes = await this.#synthesizeViaEdgeTtsWorker({
            ttsBin,
            text: cleanText,
            voice: String(voice || DEFAULT_VOICE_TTS_NAME),
            rate: "+8%",
          });
          if (workerRes?.audioBase64) {
            audioBase64 = workerRes.audioBase64;
            mimeType = workerRes.mimeType || "audio/mpeg";
            provider = "edge-tts";
          }
        } catch {
          // Fall back to one-shot edge-tts CLI below.
        }
      }
      if (!audioBase64) {
        await mkdir(this.#utterancesDir, { recursive: true });
        const outPath = resolve(this.#utterancesDir, `tts-${randomUUID()}.mp3`);
        try {
          await this.#execFile(
            ttsBin,
            [
              "--voice",
              String(voice || DEFAULT_VOICE_TTS_NAME),
              "--rate=+8%",
              "--text",
              cleanText,
              "--write-media",
              outPath,
            ],
            {
              env: this.#env,
              cwd: this.#workspaceDir,
              shell: false,
              timeout: EDGE_TTS_TIMEOUT_MS,
              maxBuffer: 128 * 1024,
            },
          );
          const mp3Buf = await readFile(outPath);
          if (mp3Buf.length > 0) {
            audioBase64 = mp3Buf.toString("base64");
            mimeType = "audio/mpeg";
            provider = "edge-tts";
          }
        } catch {
          // Fall through to offline macOS say or browser synthesis.
        } finally {
          await unlink(outPath).catch(() => {});
        }
      }
    }

    if (!audioBase64 && this.#hasLocalKokoroRuntime()) {
      try {
        const kokoroRes = await this.#synthesizeViaKokoroWorker({ text: cleanText });
        if (kokoroRes?.audioBase64) {
          audioBase64 = kokoroRes.audioBase64;
          mimeType = kokoroRes.mimeType || "audio/wav";
          provider = "kokoro";
        }
      } catch {
        // Fall through to macOS say below.
      }
    }

    if (!audioBase64) {
      const sayBin = resolveMacSayExecutable(this.#env);
      if (sayBin) {
        await mkdir(this.#utterancesDir, { recursive: true });
        const outWavPath = resolve(this.#utterancesDir, `say-${randomUUID()}.wav`);
        const preferredVoice = String(this.#env?.MACOS_SAY_VOICE || "Tingting").trim();
        try {
          const runSay = async (voiceArgs = []) => {
            await this.#execFile(
              sayBin,
              [
                ...voiceArgs,
                "--file-format=WAVE",
                "--data-format=LEI16@22050",
                "-o",
                outWavPath,
                cleanText,
              ],
              {
                env: this.#env,
                cwd: this.#workspaceDir,
                shell: false,
                timeout: EDGE_TTS_TIMEOUT_MS,
                maxBuffer: 128 * 1024,
              },
            );
          };
          const voiceCandidates = [
            preferredVoice,
            "Shelley (中文（中国大陆）)",
            "Sandy (中文（中国大陆）)",
            "Flo (中文（中国大陆）)",
            "Meijia",
            "Sinji",
          ].filter((v, idx, arr) => v && arr.indexOf(v) === idx);
          let synthesized = false;
          for (const candidate of voiceCandidates) {
            try {
              await runSay(["-v", candidate]);
              synthesized = true;
              break;
            } catch {
              // Try next Chinese voice candidate.
            }
          }
          if (!synthesized) {
            await runSay([]);
          }
          const wavBuf = await readFile(outWavPath).catch(() => Buffer.alloc(0));
          if (wavBuf.length > 0) {
            audioBase64 = wavBuf.toString("base64");
            mimeType = "audio/wav";
            provider = "macos-say";
          }
        } catch {
          // Leave audio empty so the client reports an unheard reply.
        } finally {
          await unlink(outWavPath).catch(() => {});
        }
      }
    }

    if (cacheKey && audioBase64) {
      this.#ttsCache.set(cacheKey, { audioBase64, mimeType, provider });
      if (this.#ttsCache.size > 36) {
        const oldestKey = this.#ttsCache.keys().next().value;
        if (oldestKey) this.#ttsCache.delete(oldestKey);
      }
    }

    return {
      audioBase64,
      mimeType,
      provider,
      text: cleanText,
      utteranceId: cleanUttId,
      expectedMs: estimateSpeechDurationMs(cleanText),
    };
  }

  async #runVoiceCoordinator({ callId, target, promptText, timeoutMs = VOICE_PROMPT_TIMEOUT_MS, signal = null, onDelta = null }) {
    if (signal?.aborted) {
      throw Object.assign(new Error("请求已取消"), { name: "AbortError", aborted: true });
    }
    if (target.provider !== "antigravity") {
      throw new Error("仅支持复用 Antigravity 预热会话");
    }
    const client = await this.#ensureClient();
    if (signal?.aborted) {
      throw Object.assign(new Error("请求已取消"), { name: "AbortError", aborted: true });
    }
    let entry = this.#calls.get(callId);
    if (!entry || entry.model !== target.model) {
      const created = await client.newSession({ cwd: this.#workspaceDir });
      if (!created?.sessionId) throw new Error("语音理解模型未返回会话 ID");
      await client.configureSession(created.sessionId, {
        model: target.model, effort: target.effort || "low", permissionMode: "plan",
      });
      entry = { callId, sessionId: created.sessionId, model: target.model, createdAt: Date.now() };
      this.#calls.set(callId, entry);
      this.#trimCallCache();
    }
    entry.lastUsedAt = Date.now();
    return this.#runSerializedPrompt(entry.sessionId, promptText, { timeoutMs, signal, callId, onDelta });
  }

  // Reuses a warm Antigravity ACP session for the sprite assistant when healthy;
  // other providers fall through to ephemeral CLI execution in MissionOverviewService.
  async completeAssistantChat({ sessionId = "", system = "", prompt = "", modelKey = "auto", timeoutMs = 25_000, signal = null, onDelta = null } = {}) {
    if (signal?.aborted) return null;
    const sel = parseVoiceSelectionKey(modelKey);
    const target = await this.resolveVoiceTarget(sel).catch(() => null);
    if (!target || target.provider !== "antigravity" || signal?.aborted) return null;
    const agyBinName = basename(agyExecutable(this.#env) || "");
    if (!agyBinName || agyBinName.includes("mock-agy")) return null;
    const promptText = system ? `${system}\n\n${prompt}` : prompt;
    const callId = `assistant:${String(sessionId || "default").trim().slice(0, 48)}`;
    return this.#runVoiceCoordinator({ callId, target, promptText, timeoutMs, signal, onDelta });
  }

  async warmAssistantCall() {
    const canWhisper = this.#hasLocalWhisperRuntime();
    if (canWhisper) {
      void this.#asrWorker.ensureReady().catch(() => {});
    }
    const ttsBin = resolveEdgeTtsExecutable(this.#env);
    if (ttsBin && this.#resolveEdgeTtsPython(ttsBin)) {
      void this.#edgeTtsWorker.ensureReady(ttsBin).catch(() => {});
    }
    if (this.#hasLocalKokoroRuntime()) {
      void this.#kokoroWorker.ensureReady().catch(() => {});
    }
    const [catalog] = await Promise.all([
      Promise.race([
        this.listVoiceModelOptions().catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 2000)),
      ]),
      this.getAsrPromptHints().catch(() => ""),
    ]);
    const sayBin = resolveMacSayExecutable(this.#env);
    return {
      ok: true,
      asrAvailable: canWhisper,
      ttsEngine: ttsBin ? "edge-tts" : (sayBin ? "macos-say" : "none"),
      options: catalog?.options || [],
      resolved: catalog?.resolved || null,
    };
  }

  #resolveEdgeTtsPython(ttsBin = "") {
    const clean = String(ttsBin || "").trim();
    if (!clean || !existsSync(clean)) return "";
    try {
      const head = readFileSync(clean, "utf8").slice(0, 256);
      const firstLine = head.split(/\r?\n/, 1)[0] || "";
      const match = firstLine.match(/^#!\s*([^\s]+)/);
      if (!match?.[1]) return "";
      const interp = match[1];
      if (!/python/i.test(basename(interp))) return "";
      if (interp === "/usr/bin/env") {
        const parts = firstLine.slice(2).trim().split(/\s+/);
        return parts[1] && /python/i.test(parts[1]) ? parts[1] : "";
      }
      return existsSync(interp) ? interp : "";
    } catch {
      return "";
    }
  }

  #synthesizeViaEdgeTtsWorker({ ttsBin = "", text = "", voice = DEFAULT_VOICE_TTS_NAME, rate = "+8%" } = {}) {
    return this.#edgeTtsWorker.request(
      { text, voice, rate },
      {
        idPrefix: "tts-",
        timeoutMs: EDGE_TTS_TIMEOUT_MS,
        timeoutMessage: "Edge TTS 合成超时",
        errorMessage: "Edge TTS 合成失败",
        launchArg: ttsBin,
      },
    );
  }

  #hasLocalKokoroRuntime() {
    const explicitBin = String(this.#env?.VOICE_KOKORO_BIN || "").trim();
    if (explicitBin && existsSync(explicitBin)) return true;
    const pyBin = String(this.#env?.VOICE_PYTHON_BIN || "/opt/homebrew/bin/python3.12").trim();
    if (!existsSync(pyBin)) return false;
    const explicitDir = String(this.#env?.VOICE_KOKORO_MODEL_DIR || "").trim();
    if (explicitDir && existsSync(explicitDir)) return true;
    const home = String(this.#env?.HOME || os.homedir()).trim();
    return existsSync(resolve(home, ".cache", "huggingface", "hub", "models--mlx-community--Kokoro-82M-bf16", "snapshots"));
  }

  #synthesizeViaKokoroWorker({ text = "", voice = "zf_xiaoxiao", speed = 1.06 } = {}) {
    return this.#kokoroWorker.request(
      { text, voice, speed },
      {
        idPrefix: "kokoro-",
        timeoutMs: 20_000,
        timeoutMessage: "Kokoro 合成超时",
        errorMessage: "Kokoro 合成失败",
      },
    );
  }

  async getAsrPromptHints({ pendingSnapshot = null } = {}) {
    const stale = Date.now() - this.#asrHotwordUpdatedAt > 120_000;
    if (stale && pendingSnapshot) {
      // A live snapshot is already listing threads and refreshes the hotword cache itself;
      // reuse it instead of issuing a second listThreads call.
      const refresh = Promise.resolve(pendingSnapshot).catch(() => {});
      await Promise.race([refresh, new Promise((r) => setTimeout(r, this.#asrHotwordNames.length ? 0 : 400))]);
    } else if (stale && typeof this.#hub?.listThreads === "function") {
      const refresh = Promise.resolve(this.#hub.listThreads({ archived: "0", limit: 80 }))
        .then((payload) => {
          const meta = payload?.projectsMeta || {};
          const byCwd = new Map();
          for (const t of payload?.threads || []) {
            const cwd = String(t.cwd || "").trim();
            if (!cwd || byCwd.has(cwd)) continue;
            byCwd.set(cwd, meta[cwd]?.alias || basename(cwd));
          }
          this.#asrHotwordNames = [...byCwd.values()].slice(0, 24);
          this.#asrHotwordUpdatedAt = Date.now();
        })
        .catch(() => {});
      // Never let hotword lookup add noticeable latency to recognition.
      await Promise.race([refresh, new Promise((r) => setTimeout(r, this.#asrHotwordNames.length ? 0 : 400))]);
    }
    return buildVoiceAsrPrompt(this.#asrHotwordNames);
  }

  async transcribeAudio({
    audioBase64 = "",
    audioMimeType = "audio/wav",
    language = "zh",
    promptHints = "",
    overlapMs = 0,
  } = {}) {
    const cleanAudio = String(audioBase64 || "").replace(/^data:[^;]+;base64,/, "").trim();
    if (!cleanAudio) {
      return { ok: true, text: "", engine: "none", durationMs: 0, noSpeech: true, silenceReason: "empty_audio" };
    }
    const buf = Buffer.from(cleanAudio, "base64");
    if (buf.length < 64) {
      return { ok: true, text: "", engine: "none", durationMs: 0, noSpeech: true, silenceReason: "too_short_audio" };
    }
    const asrBinName = basename(String(this.#env?.VOICE_ASR_BIN || "").trim());
    const isMockAsr = asrBinName.includes("mock-voice-asr");
    const wavCheck = analyzeWavPcm16Activity(buf, { allowLegacyZeroMockStub: isMockAsr });
    if (wavCheck.inspected && !wavCheck.hasSpeech) {
      return {
        ok: true,
        text: "",
        engine: "local-audio-gate",
        durationMs: wavCheck.durationMs,
        noSpeech: true,
        localAudioFiltered: true,
        silenceReason: wavCheck.reason,
      };
    }

    await mkdir(this.#utterancesDir, { recursive: true });
    const ext = extensionForAudioMime(audioMimeType);
    const audioPath = resolve(this.#utterancesDir, `asr-${randomUUID()}.${ext}`);
    await writeFile(audioPath, buf);

    try {
      const result = await this.#asrWorker.request(
        {
          audioPath,
          language,
          ...(Number(overlapMs) > 0 ? { overlapMs: Math.round(Number(overlapMs)) } : {}),
          ...(promptHints ? { prompt: promptHints } : {}),
        },
        {
          timeoutMs: 35_000,
          timeoutMessage: "语音识别超时",
          errorMessage: "语音识别失败",
        },
      );
      const text = String(result?.text || "").trim();
      const duringPlaybackText = String(result?.duringPlaybackText || "").trim();
      const afterPlaybackText = String(result?.afterPlaybackText || "").trim();
      return {
        ok: true,
        text,
        duringPlaybackText,
        afterPlaybackText,
        engine: String(result?.engine || "mlx-whisper"),
        durationMs: Number(result?.durationMs) || 0,
        ...(result?.noSpeech || !text
          ? {
              noSpeech: true,
              silenceReason: String(result?.silenceReason || result?.reason || (!text ? "empty_transcript" : "no_speech")),
            }
          : {}),
      };
    } finally {
      await unlink(audioPath).catch(() => {});
    }
  }

  #runSerializedPrompt(sessionId, promptText, { timeoutMs = VOICE_PROMPT_TIMEOUT_MS, signal = null, callId = "", onDelta = null } = {}) {
    if (signal?.aborted) {
      return Promise.reject(Object.assign(new Error("请求已取消"), { name: "AbortError", aborted: true }));
    }
    const effectiveTimeoutMs = Math.max(1_000, Number(timeoutMs) || VOICE_PROMPT_TIMEOUT_MS);
    const exec = async () => {
      if (signal?.aborted) {
        throw Object.assign(new Error("请求已取消"), { name: "AbortError", aborted: true });
      }
      const client = await this.#ensureClient();
      const buffer = { text: "", onDelta: typeof onDelta === "function" ? onDelta : null };
      this.#activeSessionTurn.set(sessionId, buffer);
      let timer;
      let onAbort = null;
      let timedOutOrAborted = false;
      try {
        await Promise.race([
          client.sendPrompt(sessionId, [{ type: "text", text: promptText }]),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              timedOutOrAborted = true;
              reject(new Error("Hydrogen 语音协调超时"));
            }, effectiveTimeoutMs);
            timer.unref?.();
            if (signal) {
              onAbort = () => {
                timedOutOrAborted = true;
                reject(Object.assign(new Error("请求已取消"), { name: "AbortError", aborted: true }));
              };
              if (signal.aborted) onAbort();
              else signal.addEventListener("abort", onAbort, { once: true });
            }
          }),
        ]);
        return buffer.text;
      } catch (err) {
        if (timedOutOrAborted) {
          void client.cancel(sessionId).catch(() => {});
          client.abortSessionPrompt(sessionId, err?.message || "Hydrogen 会话超时或已取消");
          if (callId) this.#calls.delete(callId);
        }
        throw err;
      } finally {
        clearTimeout(timer);
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
        this.#activeSessionTurn.delete(sessionId);
      }
    };
    const next = this.#turnQueue.then(exec, exec);
    this.#turnQueue = next.catch(() => {});
    if (!signal) return next;
    return new Promise((resolve, reject) => {
      const abortEarly = () => reject(Object.assign(new Error("请求已取消"), { name: "AbortError", aborted: true }));
      if (signal.aborted) {
        abortEarly();
        return;
      }
      signal.addEventListener("abort", abortEarly, { once: true });
      next.then(
        (val) => {
          signal.removeEventListener("abort", abortEarly);
          resolve(val);
        },
        (err) => {
          signal.removeEventListener("abort", abortEarly);
          reject(err);
        },
      );
    });
  }

  async close() {
    this.#closed = true;
    this.#calls.clear();
    this.#ttsCache.clear();
    this.#activeSessionTurn.clear();
    this.#asrWorker.reset("语音服务已关闭");
    this.#edgeTtsWorker.reset("语音服务已关闭");
    this.#kokoroWorker.reset("语音服务已关闭");
    if (this.#client) {
      await this.#client.close().catch(() => {});
      this.#client = null;
    }
  }
}
