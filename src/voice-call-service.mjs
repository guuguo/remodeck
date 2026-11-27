import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDataDir } from "./instance-identity.mjs";
import {
  execFileCrossPlatform,
  providerCandidatePaths,
  resolveExecutableCrossPlatform,
} from "./platform.mjs";
import { cleanPreviewText } from "./thread-display.mjs";
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
const MAX_CALL_STATES = 12;
const MAX_UTTERANCES_PER_CALL = 24;
const UNHEARD_TTL_MS = 180_000;
const STALE_PENDING_MS = 15_000;
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

export function minAudibleDurationMs(text = "") {
  const clean = stripSpeechNoise(text, 360);
  if (!clean) return 0;
  return Math.max(180, Math.min(1100, Math.round(estimateSpeechDurationMs(clean) * 0.22)));
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

function parseCoordinatorJson(rawText = "", fallbackTranscript = "") {
  const raw = String(rawText || "").trim();
  const candidates = [];
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (unfenced) candidates.push(unfenced);
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const rawDispatchMode = String(parsed.dispatchMode || "").trim().toLowerCase();
        const rawTier = String(parsed.executionTier || "").trim();
        const intentVal = String(parsed.intent || "").trim();
        if (!["no_speech", "wake_ping", "summarize_progress", "open_thread", "open_project", "subagent_hydrogen", "send_turn", "create_thread", "approve_request", "interrupt_thread", "repeat_last"].includes(intentVal)) continue;
        if (intentVal !== "no_speech" && !String(parsed.spokenReply || "").trim()) continue;
        const inferredTier = ["self_simple", "subagent_hydrogen", "external_thread"].includes(rawTier)
          ? rawTier
          : intentVal === "subagent_hydrogen"
            ? "subagent_hydrogen"
            : ["send_turn", "create_thread", "interrupt_thread"].includes(intentVal)
              ? "external_thread"
              : "self_simple";
        return {
          heardText: String(parsed.heardText || fallbackTranscript || "").trim(),
          intent: intentVal,
          noSpeech: intentVal === "no_speech",
          silenceReason: intentVal === "no_speech" ? "model_no_speech" : "",
          explicitFastHydrogen: Boolean(parsed.explicitFastHydrogen),
          executionTier: inferredTier,
          targetProjectCwd: String(parsed.targetProjectCwd || "").trim(),
          targetThreadId: String(parsed.targetThreadId || "").trim(),
          provider: String(parsed.provider || "").trim(),
          model: String(parsed.model || "").trim(),
          dispatchMode: rawDispatchMode === "immediate" || rawDispatchMode === "queue" ? rawDispatchMode : "",
          instruction: String(parsed.instruction || "").trim(),
          requestId: String(parsed.requestId || "").trim(),
          decision: String(parsed.decision || "").trim(),
          spokenReply: stripSpeechNoise(parsed.spokenReply || "", 360),
        };
      }
    } catch {
      // Try next extraction candidate.
    }
  }

  throw new Error("语音理解模型返回的 JSON 格式无效，未执行任何操作，请重试。");
}

function normalizeVoiceCallScope(callScope = "", activeThreadId = "") {
  const raw = String(callScope || "").trim().toLowerCase();
  if (raw === "thread" && String(activeThreadId || "").trim()) return "thread";
  return "global";
}

function parseThreadScopedCoordinatorJson(rawText = "", fallbackTranscript = "", {
  activeThreadId = "",
  activeProjectCwd = "",
  defaultRequestId = "",
} = {}) {
  const raw = String(rawText || "").trim();
  const candidates = [];
  const unfenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  if (unfenced) candidates.push(unfenced);
  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      const actionRaw = String(parsed.action || parsed.intent || "").trim().toLowerCase();
      const spokenReply = stripSpeechNoise(parsed.spokenReply || "", 360);
      const heardText = String(parsed.heardText || fallbackTranscript || "").trim();
      const instruction = String(parsed.instruction || "").trim();
      const decisionRaw = String(parsed.decision || "").trim().toLowerCase();

      if (actionRaw === "no_speech") {
        return {
          heardText: "",
          intent: "no_speech",
          noSpeech: true,
          silenceReason: "model_no_speech",
          explicitFastHydrogen: false,
          executionTier: "self_simple",
          targetProjectCwd: activeProjectCwd,
          targetThreadId: activeThreadId,
          provider: "",
          model: "",
          dispatchMode: "",
          instruction: "",
          requestId: "",
          decision: "",
          spokenReply: "",
        };
      }
      if (!spokenReply) continue;

      if (actionRaw === "reply" || actionRaw === "summarize_progress" || actionRaw === "wake_ping") {
        return {
          heardText,
          intent: "summarize_progress",
          noSpeech: false,
          silenceReason: "",
          explicitFastHydrogen: false,
          executionTier: "self_simple",
          targetProjectCwd: activeProjectCwd,
          targetThreadId: activeThreadId,
          provider: "",
          model: "",
          dispatchMode: "",
          instruction: "",
          requestId: "",
          decision: "",
          spokenReply,
        };
      }
      if (actionRaw === "repeat_last") {
        return {
          heardText,
          intent: "repeat_last",
          noSpeech: false,
          silenceReason: "",
          explicitFastHydrogen: false,
          executionTier: "self_simple",
          targetProjectCwd: activeProjectCwd,
          targetThreadId: activeThreadId,
          provider: "",
          model: "",
          dispatchMode: "",
          instruction: "",
          requestId: "",
          decision: "",
          spokenReply,
        };
      }
      if (actionRaw === "interrupt" || actionRaw === "interrupt_thread") {
        return {
          heardText,
          intent: "interrupt_thread",
          noSpeech: false,
          silenceReason: "",
          explicitFastHydrogen: false,
          executionTier: "external_thread",
          targetProjectCwd: activeProjectCwd,
          targetThreadId: activeThreadId,
          provider: "",
          model: "",
          dispatchMode: "",
          instruction: "",
          requestId: "",
          decision: "",
          spokenReply,
        };
      }
      if (actionRaw === "approve" || actionRaw === "approve_request") {
        return {
          heardText,
          intent: "approve_request",
          noSpeech: false,
          silenceReason: "",
          explicitFastHydrogen: false,
          executionTier: "self_simple",
          targetProjectCwd: activeProjectCwd,
          targetThreadId: activeThreadId,
          provider: "",
          model: "",
          dispatchMode: "",
          instruction: "",
          requestId: String(parsed.requestId || defaultRequestId || "").trim(),
          decision: decisionRaw === "decline" ? "decline" : "accept",
          spokenReply,
        };
      }
      if (actionRaw === "send" || actionRaw === "queue" || actionRaw === "steer" || actionRaw === "send_turn") {
        const dispatchMode = actionRaw === "steer" || String(parsed.dispatchMode || "").toLowerCase() === "immediate"
          ? "immediate"
          : "queue";
        return {
          heardText,
          intent: "send_turn",
          noSpeech: false,
          silenceReason: "",
          explicitFastHydrogen: false,
          executionTier: "external_thread",
          targetProjectCwd: activeProjectCwd,
          targetThreadId: activeThreadId,
          provider: String(parsed.provider || "").trim(),
          model: String(parsed.model || "").trim(),
          dispatchMode,
          instruction: instruction || heardText,
          requestId: "",
          decision: "",
          spokenReply,
        };
      }
    } catch {
      // Try next candidate.
    }
  }
  return parseCoordinatorJson(rawText, fallbackTranscript);
}

function matchDeterministicThreadShortcut(transcriptText = "", snapshot = {}) {
  const clean = String(transcriptText || "").trim().replace(/[。！？!?.，,、\s]+$/g, "").trim();
  if (!clean || clean.length > 10) return null;
  if (/^(?:再说一遍|重播|重播一遍|没听清|重复一遍)$/.test(clean)) {
    return {
      heardText: transcriptText,
      intent: "repeat_last",
      noSpeech: false,
      silenceReason: "",
      explicitFastHydrogen: false,
      executionTier: "self_simple",
      targetProjectCwd: snapshot.activeProjectCwd || "",
      targetThreadId: snapshot.activeThreadId || "",
      provider: "",
      model: "",
      dispatchMode: "",
      instruction: "",
      requestId: "",
      decision: "",
      spokenReply: "好的，再给你播报一遍。",
    };
  }
  const activeLive = Boolean(snapshot?.currentThread?.live);
  if (activeLive && /^(?:停一下|停止执行|先停下|先停一下|别跑了|中断任务)$/.test(clean)) {
    return {
      heardText: transcriptText,
      intent: "interrupt_thread",
      noSpeech: false,
      silenceReason: "",
      explicitFastHydrogen: false,
      executionTier: "external_thread",
      targetProjectCwd: snapshot.activeProjectCwd || "",
      targetThreadId: snapshot.activeThreadId || "",
      provider: "",
      model: "",
      dispatchMode: "",
      instruction: "",
      requestId: "",
      decision: "",
      spokenReply: "好的，马上停止当前对话任务。",
    };
  }
  return null;
}

function extractCompactRecentTurns(turns = [], maxTurns = 6) {
  const slice = (Array.isArray(turns) ? turns : []).slice(-maxTurns);
  return slice.map((turn, idx) => {
    const users = [];
    const replies = [];
    for (const item of turn?.items || []) {
      if (!item || typeof item !== "object") continue;
      if (item.type === "userMessage") {
        const txt = (item.content || [])
          .filter((p) => p?.type === "text" && typeof p.text === "string")
          .map((p) => p.text.trim())
          .filter(Boolean)
          .join(" ");
        if (txt) users.push(cleanPreviewText(txt, 220));
      } else if (item.type === "agentMessage" && item.text) {
        replies.push(cleanPreviewText(String(item.text), 320));
      }
    }
    return {
      turnIndex: idx,
      status: turn?.status || "completed",
      user: users.join(" / "),
      assistant: replies.length ? replies[replies.length - 1] : "",
    };
  }).filter((t) => t.user || t.assistant);
}

function pickLatestAssistantText(threadReadResult) {
  const turns = threadReadResult?.thread?.turns || [];
  for (let i = turns.length - 1; i >= 0; i -= 1) {
    const items = Array.isArray(turns[i]?.items) ? turns[i].items : [];
    for (let j = items.length - 1; j >= 0; j -= 1) {
      const item = items[j];
      if (!item || item.type !== "agentMessage" || !item.text) continue;
      if (item.phase === "commentary") continue;
      if (String(item.text).trim()) return String(item.text).trim();
    }
  }
  return "";
}

function pickLatestAssistantSnippet(threadReadResult) {
  return stripSpeechNoise(pickLatestAssistantText(threadReadResult), 160);
}

function normCwd(cwd = "") {
  const raw = String(cwd || "").trim().replace(/\\/g, "/");
  if (!raw || raw === "/") return raw;
  return raw.replace(/\/+$/, "");
}

// Resolve only identifiers chosen by the model; never infer a target from spoken text.
export function resolveVoicePlanTarget(plan = {}, snapshot = {}) {
  const projects = snapshot.projects || [];
  const threads = snapshot.threads || projects.flatMap((p) =>
    (p.threads || []).map((t) => ({ ...t, cwd: p.cwd })));
  const thread = plan.targetThreadId ? threads.find((t) => t.id === plan.targetThreadId) : null;
  let project = plan.targetProjectCwd
    ? projects.find((p) => normCwd(p.cwd) === normCwd(plan.targetProjectCwd))
    : (thread ? projects.find((p) => normCwd(p.cwd) === normCwd(thread.cwd)) : null);
  let fallbackCwd = "";
  if (!project && plan.targetProjectCwd) {
    const matchedThreadByCwd = threads.find((t) => normCwd(t.cwd) === normCwd(plan.targetProjectCwd));
    if (matchedThreadByCwd?.cwd) {
      fallbackCwd = matchedThreadByCwd.cwd;
    }
  }
  const resolvedCwd = project?.cwd || fallbackCwd || thread?.cwd || "";
  const valid = (!plan.targetThreadId || Boolean(thread))
    && (!plan.targetProjectCwd || Boolean(project || fallbackCwd))
    && (!thread || !resolvedCwd || normCwd(thread.cwd) === normCwd(resolvedCwd));
  return { project, thread, cwd: resolvedCwd, threadId: thread?.id || "", valid };
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

function normalizeVoiceMatchKey(text = "") {
  return String(text || "").toLowerCase().replace(/[\s\-_.·・/\\]+/g, "");
}

// When the model fails to pick a valid target, offer the user a short spoken choice instead of an error.
export function suggestVoiceTargetCandidates(plan = {}, snapshot = {}, { limit = 3 } = {}) {
  const projects = (snapshot.projects || []).filter((p) => p?.cwd);
  if (!projects.length) return { unique: null, candidates: [] };
  const hintCwd = normCwd(plan.targetProjectCwd || "");
  const hintBase = hintCwd ? normalizeVoiceMatchKey(basename(hintCwd)) : "";
  const spoken = normalizeVoiceMatchKey(`${plan.heardText || ""} ${plan.instruction || ""}`);
  const scored = projects.map((p, index) => {
    const keys = [p.alias, p.name, basename(p.cwd)].map(normalizeVoiceMatchKey).filter((k) => k.length >= 2);
    let score = 0;
    if (hintBase && keys.includes(hintBase)) score = 100;
    else if (hintBase && keys.some((k) => k.includes(hintBase) || hintBase.includes(k))) score = 60;
    if (score < 100 && spoken && keys.some((k) => spoken.includes(k))) score = Math.max(score, 80);
    return { project: p, score, index };
  });
  const matched = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || a.index - b.index);
  const strongest = matched.filter((s) => s.score === matched[0]?.score);
  // Only an exact name the model itself chose is auto-resolved; spoken-text matches are asked back.
  if (strongest.length === 1 && strongest[0].score >= 100) {
    return { unique: strongest[0].project, candidates: [strongest[0].project] };
  }
  const pool = matched.length ? matched : scored;
  return { unique: null, candidates: pool.slice(0, limit).map((s) => s.project) };
}

export function buildVoiceClarifyQuestion(candidates = []) {
  const names = candidates.map((p) => String(p?.alias || p?.name || basename(p?.cwd || "")).trim()).filter(Boolean);
  if (!names.length) return "要交给哪个项目做？说项目名就行。";
  if (names.length === 1) return `是交给${names[0]}吗？`;
  return `是${names.slice(0, -1).join("、")}，还是${names[names.length - 1]}？`;
}

// Keep in-car replies to about two short sentences so one answer never runs past ~8 seconds of audio.
export function clampVoiceSpokenReply(text = "", { maxChars = 60 } = {}) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  const sentences = clean.match(/[^。！？!?；;]+[。！？!?；;]?/g) || [clean];
  let out = "";
  for (const s of sentences) {
    if (out && (out + s).length > maxChars) break;
    out += s;
    if (out.length >= maxChars) break;
  }
  if (out.length > maxChars) {
    out = `${out.slice(0, maxChars - 1).replace(/[，,、\s]+$/, "")}…`;
  }
  return out.trim();
}

export class VoiceCallService {
  #hub;
  #env;
  #dataDir;
  #workspaceDir;
  #utterancesDir;
  #execFile;
  #onEvent;
  #client = null;
  #clientAppDataDir = "";
  #initClientPromise = null;
  #modelsCache = null;
  #hubModelsCache = new Map();
  #calls = new Map();
  #callStates = new Map();
  #ttsCache = new Map();
  #pendingDispatchPromises = new Set();
  #activeSessionTurn = new Map();
  #activeSubagentSessions = new Map();
  #pendingSubagentThreads = new Map();
  #turnQueue = Promise.resolve();
  #subagentProgressIntervalMs = 18_000;
  #subagentMinFeedbackGapMs = 12_000;
  #subagentExecutor = null;
  #asrChild = null;
  #asrReadyPromise = null;
  #asrStdoutBuf = "";
  #asrPending = new Map();
  #asrHotwordNames = [];
  #asrHotwordUpdatedAt = 0;
  #edgeTtsChild = null;
  #edgeTtsReadyPromise = null;
  #edgeTtsStdoutBuf = "";
  #edgeTtsPending = new Map();
  #kokoroChild = null;
  #kokoroReadyPromise = null;
  #kokoroStdoutBuf = "";
  #kokoroPending = new Map();
  #diagLogQueue = Promise.resolve();
  #closed = false;

  #appendVoiceDiagLog(entry = {}) {
    if (!this.#dataDir) return;
    const line = `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`;
    const logPath = resolve(this.#dataDir, "logs", "voice-turns.jsonl");
    this.#diagLogQueue = this.#diagLogQueue.then(async () => {
      await mkdir(dirname(logPath), { recursive: true });
      const info = await stat(logPath).catch(() => null);
      if (info && info.size > 2 * 1024 * 1024) {
        await rename(logPath, `${logPath}.prev`).catch(() => {});
      }
      await appendFile(logPath, line, { encoding: "utf8", mode: 0o600 });
    }).catch(() => {});
  }

  constructor({
    hub,
    env = process.env,
    dataDir = defaultDataDir(env),
    execFileImpl = execFileCrossPlatform,
    onEvent = null,
    subagentProgressIntervalMs = 18_000,
    subagentMinFeedbackGapMs = 12_000,
    subagentExecutor = null,
  } = {}) {
    this.#hub = hub;
    this.#env = env;
    this.#dataDir = dataDir;
    this.#workspaceDir = resolve(dataDir, "voice-call");
    this.#utterancesDir = resolve(this.#workspaceDir, "utterances");
    this.#execFile = execFileImpl;
    this.#onEvent = typeof onEvent === "function" ? onEvent : null;
    this.#subagentProgressIntervalMs = Math.max(50, Number(subagentProgressIntervalMs) || 18_000);
    this.#subagentMinFeedbackGapMs = Math.max(20, Number(subagentMinFeedbackGapMs) || 12_000);
    this.#subagentExecutor = typeof subagentExecutor === "function" ? subagentExecutor : null;
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
    callId = "",
    voiceProvider = "",
    voiceModel = "",
    voiceProfileId = "",
    _installedProfiles = null,
    _modelsByProvider = null,
  } = {}) {
    const callPref = callId ? this.#callStates.get(callId)?.voicePref : null;
    const requestedProvider = String(voiceProvider || callPref?.voiceProvider || this.#env?.AGENT_CONTROL_VOICE_PROVIDER || "").trim().toLowerCase();
    const requestedModel = String(voiceModel || callPref?.voiceModel || this.#env?.AGENT_CONTROL_VOICE_MODEL || "").trim();
    // Migrate saved preferences from the removed local-rule mode.
    const legacyLocal = requestedProvider === "local" || requestedModel === "local-rules";
    const rawProvider = legacyLocal ? "auto" : requestedProvider;
    const rawModel = legacyLocal ? "" : requestedModel;
    const rawProfileId = String(voiceProfileId || callPref?.voiceProfileId || "").trim();

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

  async #resolveTaskModelAndEffort({
    provider = "",
    requestedModel = "",
    explicitFastHydrogen = false,
  } = {}) {
    const cleanModel = String(requestedModel || "").trim();
    if (provider && provider !== "antigravity") {
      return { model: cleanModel, effort: "" };
    }
    if (cleanModel && !explicitFastHydrogen && !/hydrogen/i.test(cleanModel)) {
      return { model: cleanModel, effort: "" };
    }
    const fastModel = await this.resolveHydrogenModel().catch(() => DEFAULT_VOICE_HYDROGEN_MODEL);
    const model = fastModel || DEFAULT_VOICE_HYDROGEN_MODEL;
    const effort = /\b(low|fast|lite)\b|-low\b/i.test(model) ? "low" : "";
    return { model, effort };
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
          const sub = this.#activeSubagentSessions.get(sessionId);
          if (sub && text) sub.text += text;
          return;
        }
        const sub = this.#activeSubagentSessions.get(sessionId);
        if (sub && update.sessionUpdate === "tool_call") {
          const rawTitle = String(update.title || "").trim();
          const looksNoisy = /[\/\\]/.test(rawTitle) || /^(?:pending|running|in_progress|completed|failed|error|ok|done|success)$/i.test(rawTitle);
          const title = !looksNoisy ? stripSpeechNoise(rawTitle, 48) : "";
          const minGap = Math.max(this.#subagentMinFeedbackGapMs, 12_000);
          if (title && title !== sub.lastPhase && Date.now() - sub.lastProgressAt >= minGap) {
            sub.lastPhase = title;
            sub.lastProgressAt = Date.now();
            sub.step += 1;
            sub.emitProgress?.(`Hydrogen 子代理正在处理：${title}`);
          }
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
    if (this.#callStates.size > MAX_CALL_STATES) {
      const sortedStates = [...this.#callStates.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);
      while (sortedStates.length > MAX_CALL_STATES) {
        const [evictId] = sortedStates.shift();
        this.#callStates.delete(evictId);
      }
    }
  }

  #ensureCallState(callId) {
    const cleanCallId = String(callId || "").trim() || "default-call";
    let state = this.#callStates.get(cleanCallId);
    if (!state) {
      state = {
        callId: cleanCallId,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        utterances: [],
        dispatchBatches: [],
        delegatedTasks: new Map(),
        observedLiveThreads: new Map(),
        completedResults: [],
        announcedMilestoneKeys: new Set(),
      };
      this.#callStates.set(cleanCallId, state);
      this.#trimCallCache();
    } else {
      state.lastUsedAt = Date.now();
    }
    return state;
  }

  registerUtterance({
    callId = "",
    utteranceId = "",
    text = "",
    source = "turn",
    intent = "",
    priority = "normal",
    provider = "none",
    replacesUtteranceIds = [],
  } = {}) {
    const cleanText = stripSpeechNoise(text, 360);
    const cleanCallId = String(callId || "").trim();
    const id = String(utteranceId || "").trim() || `utt-${randomUUID().slice(0, 10)}`;
    const now = Date.now();
    const expectedMs = estimateSpeechDurationMs(cleanText);
    const minMs = minAudibleDurationMs(cleanText);
    if (!cleanCallId || !cleanText) {
      return {
        utteranceId: id,
        callId: cleanCallId,
        text: cleanText,
        expectedMs,
        minAudibleMs: minMs,
      };
    }
    const callState = this.#ensureCallState(cleanCallId);
    const existing = callState.utterances.find((u) => u.utteranceId === id);
    const normalizedPriority = priority === "critical" ? "critical" : "normal";
    const replaces = Array.isArray(replacesUtteranceIds)
      ? replacesUtteranceIds.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    if (existing) {
      existing.text = cleanText;
      existing.source = String(source || existing.source || "turn");
      existing.intent = String(intent || existing.intent || "");
      existing.priority = normalizedPriority;
      existing.provider = String(provider || existing.provider || "none");
      existing.expectedMs = expectedMs;
      existing.minAudibleMs = minMs;
      existing.updatedAt = now;
      existing.attempts += 1;
      if (replaces.length) {
        existing.replacesUtteranceIds = [...new Set([...(existing.replacesUtteranceIds || []), ...replaces])];
      }
      return existing;
    }
    const record = {
      utteranceId: id,
      callId: cleanCallId,
      text: cleanText,
      source: String(source || "turn"),
      intent: String(intent || ""),
      priority: normalizedPriority,
      createdAt: now,
      updatedAt: now,
      deliveryStatus: "pending",
      heard: false,
      reason: "",
      provider: String(provider || "none"),
      playedMs: 0,
      expectedMs,
      minAudibleMs: minMs,
      attempts: 1,
      compensatedInTurn: false,
      replacesUtteranceIds: replaces,
    };
    callState.utterances.push(record);
    if (callState.utterances.length > MAX_UTTERANCES_PER_CALL) {
      callState.utterances = callState.utterances.slice(-MAX_UTTERANCES_PER_CALL);
    }
    return record;
  }

  getUnheardUtterances(callId = "", { nowMs = Date.now(), includeStalePending = false } = {}) {
    const cleanCallId = String(callId || "").trim();
    if (!cleanCallId) return [];
    const callState = this.#callStates.get(cleanCallId);
    if (!callState) return [];
    return callState.utterances.filter((rec) => {
      if (rec.heard || rec.compensatedInTurn) return false;
      if (nowMs - rec.createdAt > UNHEARD_TTL_MS) return false;
      if (rec.deliveryStatus === "unheard" || rec.deliveryStatus === "interrupted") {
        return true;
      }
      if (includeStalePending && rec.deliveryStatus === "pending" && nowMs - rec.createdAt >= STALE_PENDING_MS) {
        return true;
      }
      return false;
    });
  }

  recordPlaybackFeedback({
    callId = "",
    utteranceId = "",
    status = "",
    reason = "",
    provider = "",
    playedMs = 0,
    expectedMs = 0,
    spokenText = "",
    source = "notice",
    priority = "normal",
  } = {}) {
    let cleanCallId = String(callId || "").trim();
    const cleanId = String(utteranceId || "").trim();
    if (!cleanCallId && cleanId) {
      for (const cs of this.#callStates.values()) {
        if (cs.utterances.some((u) => u.utteranceId === cleanId)) {
          cleanCallId = cs.callId;
          break;
        }
      }
    }
    if (!cleanCallId) {
      throw Object.assign(new Error("缺少通话 ID"), { status: 400 });
    }
    const callState = this.#ensureCallState(cleanCallId);
    let rec = cleanId ? callState.utterances.find((u) => u.utteranceId === cleanId) : null;
    if (!rec) {
      if (cleanId || String(spokenText || "").trim()) {
        rec = this.registerUtterance({
          callId: cleanCallId,
          utteranceId: cleanId || undefined,
          text: spokenText || "语音提醒",
          source,
          priority,
          provider: provider || "browser",
        });
      } else {
        rec = callState.utterances[callState.utterances.length - 1] || null;
      }
    }
    if (!rec) {
      return {
        ok: true,
        callId: cleanCallId,
        utteranceId: cleanId,
        deliveryStatus: "unknown",
        heard: false,
        reason: "not_found",
        shouldRetryTts: false,
        unheardCount: 0,
        unheardItems: [],
      };
    }

    const rawStatus = String(status || "").trim().toLowerCase();
    const normalizedStatus = rawStatus === "failed" ? "unheard" : rawStatus;
    const cleanReason = String(reason || "").trim();
    const cleanPlayedMs = Math.max(0, Number(playedMs) || 0);
    const effExpectedMs = Math.max(rec.expectedMs || 0, Number(expectedMs) || 0, estimateSpeechDurationMs(rec.text));
    const minAudible = rec.minAudibleMs || minAudibleDurationMs(rec.text);

    rec.updatedAt = Date.now();
    if (provider) rec.provider = String(provider);
    if (cleanPlayedMs > 0) rec.playedMs = cleanPlayedMs;
    if (effExpectedMs > 0) rec.expectedMs = effExpectedMs;

    if (normalizedStatus === "played") {
      if (cleanReason === "muted_output") {
        rec.deliveryStatus = "unheard";
        rec.heard = false;
        rec.reason = "muted_output";
      } else if (cleanPlayedMs > 0 && cleanPlayedMs < minAudible) {
        rec.deliveryStatus = "unheard";
        rec.heard = false;
        rec.reason = "fake_short_end";
      } else {
        rec.deliveryStatus = "played";
        rec.heard = true;
        rec.reason = "";
        for (const oldId of rec.replacesUtteranceIds || []) {
          const oldRec = callState.utterances.find((u) => u.utteranceId === oldId);
          if (oldRec) {
            oldRec.heard = true;
            oldRec.compensatedInTurn = true;
            oldRec.updatedAt = rec.updatedAt;
          }
        }
      }
    } else if (normalizedStatus === "interrupted") {
      const ratio = effExpectedMs > 0 ? cleanPlayedMs / effExpectedMs : 0;
      rec.deliveryStatus = "interrupted";
      if (cleanReason === "user_barge_in" && ratio >= 0.45 && rec.priority !== "critical") {
        rec.heard = true;
        rec.reason = cleanReason;
      } else {
        rec.heard = false;
        rec.reason = cleanReason || "interrupted_early";
      }
    } else {
      rec.deliveryStatus = "unheard";
      rec.heard = false;
      rec.reason = cleanReason || "playback_failed";
    }

    const unheardItems = this.getUnheardUtterances(cleanCallId);
    this.#appendVoiceDiagLog({
      type: "playback_feedback",
      callId: cleanCallId,
      utteranceId: rec.utteranceId,
      deliveryStatus: rec.deliveryStatus,
      heard: rec.heard,
      reason: rec.reason,
      provider: rec.provider,
      playedMs: rec.playedMs,
      expectedMs: rec.expectedMs,
    });
    return {
      ok: true,
      callId: cleanCallId,
      utteranceId: rec.utteranceId,
      deliveryStatus: rec.deliveryStatus,
      heard: rec.heard,
      reason: rec.reason,
      shouldRetryTts: !rec.heard && rec.deliveryStatus === "unheard" && rec.attempts < 2,
      unheardCount: unheardItems.length,
      unheardItems: unheardItems.map((u) => ({
        utteranceId: u.utteranceId,
        text: u.text,
        source: u.source,
        priority: u.priority,
        deliveryStatus: u.deliveryStatus,
        reason: u.reason,
        createdAt: u.createdAt,
      })),
    };
  }

  getCallDeliveryStatus({ callId = "" } = {}) {
    const cleanCallId = String(callId || "").trim();
    if (!cleanCallId) {
      return { ok: true, callId: "", unheardCount: 0, unheardItems: [], recentUtterances: [] };
    }
    const callState = this.#callStates.get(cleanCallId);
    const unheardItems = this.getUnheardUtterances(cleanCallId);
    const recentUtterances = (callState?.utterances || []).slice(-10).map((u) => ({
      utteranceId: u.utteranceId,
      text: u.text,
      source: u.source,
      intent: u.intent,
      priority: u.priority,
      deliveryStatus: u.deliveryStatus,
      heard: u.heard,
      reason: u.reason,
      provider: u.provider,
      playedMs: u.playedMs,
      expectedMs: u.expectedMs,
      createdAt: u.createdAt,
      updatedAt: u.updatedAt,
    }));
    return {
      ok: true,
      callId: cleanCallId,
      unheardCount: unheardItems.length,
      unheardItems: unheardItems.map((u) => ({
        utteranceId: u.utteranceId,
        text: u.text,
        source: u.source,
        priority: u.priority,
        deliveryStatus: u.deliveryStatus,
        reason: u.reason,
        createdAt: u.createdAt,
      })),
      recentUtterances,
      dispatchBatches: [...(callState?.dispatchBatches || [])],
      delegatedTasks: [...(callState?.delegatedTasks?.values() || [])],
      completedResults: [...(callState?.completedResults || [])],
    };
  }

  async #warmCoordinatorSession(callId, dispatchModel) {
    const client = await this.#ensureClient();
    let entry = this.#calls.get(callId);
    if (!entry) {
      const created = await client.newSession({ cwd: this.#workspaceDir });
      const sessionId = String(created?.sessionId || "");
      if (!sessionId) throw new Error("Antigravity 未返回语音通话会话 ID");
      await client.configureSession(sessionId, {
        model: dispatchModel,
        effort: "low",
        permissionMode: "plan",
      });
      entry = {
        callId,
        sessionId,
        model: dispatchModel,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
      };
      this.#calls.set(callId, entry);
      this.#trimCallCache();
    } else {
      entry.lastUsedAt = Date.now();
    }
    return entry;
  }

  /**
   * @deprecated 旧通话协调者仅作兼容冻结；新单入口语音通话统一由
   * `POST /api/assistant/voice-turn` + `AssistantService` 承担，禁止继续新增功能。
   */
  async startCall({
    callId = "",
    callScope = "",
    activeThreadId = "",
    voiceProvider = "",
    voiceModel = "",
    voiceProfileId = "",
  } = {}) {
    const cleanCallId = String(callId || "").trim() || `call-${randomUUID().slice(0, 8)}`;
    const callState = this.#ensureCallState(cleanCallId);
    const effectiveScope = normalizeVoiceCallScope(callScope, activeThreadId);
    callState.callScope = effectiveScope;
    if (activeThreadId) callState.activeThreadId = String(activeThreadId).trim();
    if (effectiveScope === "thread" && activeThreadId) {
      void this.#hub?.readThread?.(activeThreadId, { limit: 6 }).catch(() => null);
    }
    if (voiceProvider || voiceModel || voiceProfileId) {
      callState.voicePref = {
        voiceProvider: String(voiceProvider || "").trim(),
        voiceModel: String(voiceModel || "").trim(),
        voiceProfileId: String(voiceProfileId || "").trim(),
      };
    } else if (!callState.voicePref) {
      callState.voicePref = { voiceProvider: "", voiceModel: "", voiceProfileId: "" };
    }
    const activePref = callState.voicePref;
    const hasExplicitAsrBin = Boolean(String(this.#env?.VOICE_ASR_BIN || "").trim());
    const agyBinName = basename(agyExecutable(this.#env) || "");
    const isMockAgy = agyBinName.includes("mock-agy");
    let model = "";
    let dispatchModel = DEFAULT_VOICE_HYDROGEN_MODEL;
    let dispatchProvider = "antigravity";
    let dispatchProfileId = "";
    let dispatchLabel = "Hydrogen";
    let modelOptions = [];
    let selectedVoiceOption = (activePref.voiceProvider && !["auto", "local"].includes(activePref.voiceProvider) && activePref.voiceModel
          ? `${activePref.voiceProvider}:${activePref.voiceProfileId || "default"}:${activePref.voiceModel}`
          : "auto");
    let asrAvailable = true;
    let asrEngine = hasExplicitAsrBin ? "mock-whisper" : "mlx-whisper";
    let warmed = false;
    let warning = "";

    const catalogPromise = Promise.race([
      this.listVoiceModelOptions(activePref).catch(() => null),
      new Promise((resolveTimeout) => setTimeout(() => resolveTimeout(null), 2500)),
    ]);

    if (!isMockAgy || hasExplicitAsrBin) {
      const canWhisper = this.#hasLocalWhisperRuntime();
      if (!canWhisper) {
        model = "browser-speech";
        asrAvailable = false;
        asrEngine = "browser";
        warmed = true;
        const catalog = await catalogPromise;
        if (catalog?.resolved) {
          dispatchProvider = catalog.resolved.provider;
          dispatchProfileId = catalog.resolved.profileId;
          dispatchModel = catalog.resolved.model;
          dispatchLabel = catalog.resolved.shortLabel;
          selectedVoiceOption = catalog.resolved.selectionKey || selectedVoiceOption;
        }
        modelOptions = catalog?.options || [];
      } else {
        model = hasExplicitAsrBin ? "mock-whisper" : "mlx-whisper";
        const asrWarmPromise = this.#ensureAsrWorker();
        asrWarmPromise.catch(() => {});
        let asrWarmResult = "ok";
        try {
          const [warmOutcome, catalog] = await Promise.all([
            Promise.race([
              asrWarmPromise.then(() => "ok"),
              new Promise((resolveWarm) => setTimeout(() => resolveWarm("timeout"), 3_500)),
            ]),
            catalogPromise,
          ]);
          asrWarmResult = warmOutcome;
          if (catalog?.resolved) {
            dispatchProvider = catalog.resolved.provider;
            dispatchProfileId = catalog.resolved.profileId;
            dispatchModel = catalog.resolved.model;
            dispatchLabel = catalog.resolved.shortLabel;
            selectedVoiceOption = catalog.resolved.selectionKey || selectedVoiceOption;
          }
          modelOptions = catalog?.options || [];
          warmed = asrWarmResult === "ok";
          if (dispatchProvider === "antigravity" && dispatchModel) {
            void this.#warmCoordinatorSession(cleanCallId, dispatchModel).catch(() => null);
          }
          if (asrWarmResult === "timeout") {
            warning = "本地语音识别正在加载，稍候片刻即可使用";
          }
        } catch (error) {
          asrAvailable = false;
          asrEngine = "browser";
          model = "browser-speech";
          warning = error?.message || "本地 Whisper 暂不可用，已切换浏览器/文本识别模式";
          const catalog = await catalogPromise;
          if (catalog?.resolved) {
            dispatchProvider = catalog.resolved.provider;
            dispatchProfileId = catalog.resolved.profileId;
            dispatchModel = catalog.resolved.model;
            dispatchLabel = catalog.resolved.shortLabel;
            selectedVoiceOption = catalog.resolved.selectionKey || selectedVoiceOption;
          }
          modelOptions = catalog?.options || [];
        }
      }
    } else {
      const catalog = await catalogPromise;
      if (catalog?.resolved) {
        dispatchProvider = catalog.resolved.provider;
        dispatchProfileId = catalog.resolved.profileId;
        dispatchModel = catalog.resolved.model;
        dispatchLabel = catalog.resolved.shortLabel;
        selectedVoiceOption = catalog.resolved.selectionKey || selectedVoiceOption;
      } else {
        dispatchModel = await this.resolveHydrogenModel();
      }
      modelOptions = catalog?.options || [];
      model = dispatchModel;
      asrEngine = "multimodal-acp";
      if (dispatchProvider === "antigravity") {
        try {
          await this.#warmCoordinatorSession(cleanCallId, dispatchModel);
          warmed = true;
        } catch (error) {
          warning = error?.message || "Hydrogen 预热暂不可用";
        }
      } else {
        warmed = true;
      }
    }

    const ttsBin = resolveEdgeTtsExecutable(this.#env);
    if (ttsBin && this.#resolveEdgeTtsPython(ttsBin)) {
      void this.#ensureEdgeTtsWorker(ttsBin).catch(() => {});
    }
    if (this.#hasLocalKokoroRuntime()) {
      void this.#ensureKokoroWorker().catch(() => {});
    }
    const sayBin = resolveMacSayExecutable(this.#env);
    callState.resolvedTarget = {
      provider: dispatchProvider,
      profileId: dispatchProfileId,
      model: dispatchModel,
      shortLabel: dispatchLabel,
    };
    const startResult = {
      ok: true,
      callId: cleanCallId,
      callScope: effectiveScope,
      model,
      dispatchProvider,
      dispatchProfileId,
      dispatchModel,
      dispatchLabel,
      selectedVoiceOption,
      modelOptions,
      asrAvailable,
      asrEngine,
      warmed,
      ttsEngine: ttsBin ? "edge-tts" : (sayBin ? "macos-say" : "none"),
      ...(warning ? { warning } : {}),
    };
    this.#appendVoiceDiagLog({
      type: "call_start",
      callId: cleanCallId,
      callScope: effectiveScope,
      activeThreadId: String(activeThreadId || "").trim(),
      dispatchProvider,
      dispatchModel,
      asrEngine,
      ttsEngine: startResult.ttsEngine,
      warmed,
      ...(warning ? { warning } : {}),
    });
    return startResult;
  }

  endCall({ callId = "" } = {}) {
    const cleanCallId = String(callId || "").trim();
    if (cleanCallId) {
      this.#calls.delete(cleanCallId);
      this.#callStates.delete(cleanCallId);
      this.#appendVoiceDiagLog({ type: "call_end", callId: cleanCallId });
    }
    if (this.#calls.size === 0 && this.#callStates.size === 0) {
      this.#resetEdgeTtsWorker("通话已结束");
      this.#resetKokoroWorker("通话已结束");
    }
    return { ok: true, callId: cleanCallId };
  }

  async buildThreadScopedSnapshot({ activeThreadId = "", callId = "" } = {}) {
    const cleanThreadId = String(activeThreadId || "").trim();
    if (!cleanThreadId) {
      return this.buildLiveSnapshot({ activeThreadId: "", callId });
    }
    const cleanCallId = String(callId || "").trim();
    const callState = cleanCallId ? this.#callStates.get(cleanCallId) : null;
    const [readRes, activityRes, allPending] = await Promise.all([
      this.#hub.readThread(cleanThreadId, { limit: 6 }).catch(() => null),
      typeof this.#hub.getActivity === "function"
        ? this.#hub.getActivity(cleanThreadId).catch(() => null)
        : Promise.resolve(null),
      Promise.resolve(this.#hub.allPendingRequests?.() || []),
    ]);
    const thread = readRes?.thread;
    if (!thread) {
      return this.buildLiveSnapshot({ activeThreadId: cleanThreadId, callId });
    }
    const cwd = String(thread.cwd || "").trim() || os.homedir();
    const projectName = basename(cwd) || cwd;
    const threadPending = allPending
      .filter((r) => r.threadId === cleanThreadId)
      .slice(0, 4)
      .map((r) => ({
        requestId: r.id,
        threadId: r.threadId,
        provider: r.provider,
        projectCwd: cwd,
        projectName,
        title: String(r.title || "").slice(0, 80),
        question: String(r.question || "").slice(0, 80),
        command: String(r.command || "").slice(0, 80),
      }));
    const live = Boolean(activityRes?.live || thread.live);
    const queuedCount = Number(activityRes?.queuedCount ?? readRes?.queuedTurns?.length ?? 0) || 0;
    const recentTurns = extractCompactRecentTurns(thread.turns || [], 6);
    const activeThreadReply = pickLatestAssistantSnippet(readRes);
    const slimThread = {
      id: cleanThreadId,
      cwd,
      title: String(thread.title || thread.name || "当前对话").slice(0, 64),
      provider: thread.provider || cleanThreadId.split(":")[0] || "",
      model: String(thread.model || ""),
      live,
      queuedCount,
      pendingCount: threadPending.length,
      goalActive: Boolean(thread.goalState?.active),
      livePhase: cleanPreviewText(activityRes?.phase || "", 80),
      liveThought: cleanPreviewText(activityRes?.streaming?.thought || "", 160),
    };
    return {
      callScope: "thread",
      activeThreadId: cleanThreadId,
      activeProjectCwd: cwd,
      activeThreadReply,
      currentThread: slimThread,
      recentTurns,
      availableProfiles: [],
      pendingRequests: threadPending,
      projects: [{
        cwd,
        name: projectName,
        alias: "",
        pinned: false,
        liveCount: live ? 1 : 0,
        pendingCount: threadPending.length,
        updatedAt: Number(thread.updatedAt) || 0,
        threads: [slimThread],
      }],
      completedResults: [...(callState?.completedResults || [])].filter((r) => !r.threadId || r.threadId === cleanThreadId),
      delegatedTasks: [...(callState?.delegatedTasks?.values() || [])].filter((t) => !t.threadId || t.threadId === cleanThreadId),
      threads: [slimThread],
    };
  }

  async buildLiveSnapshot({ activeThreadId = "", callId = "" } = {}) {
    const [threadsPayload, providersPayload] = await Promise.all([
      this.#hub.listThreads({ archived: "0", limit: 80 }),
      this.#hub.listProvidersAndProfiles(),
    ]);
    const threads = threadsPayload?.threads || [];
    const threadById = new Map(threads.map((t) => [t.id, t]));
    const projectsMeta = threadsPayload?.projectsMeta || {};
    const cleanCallId = String(callId || "").trim();
    const callState = cleanCallId ? this.#callStates.get(cleanCallId) : null;
    const pendingRequests = await Promise.resolve(this.#hub.allPendingRequests?.() || []);
    const pendingByThread = new Map();
    for (const req of pendingRequests) {
      if (!req.threadId) continue;
      pendingByThread.set(req.threadId, (pendingByThread.get(req.threadId) || 0) + 1);
    }

    const byCwd = new Map();
    for (const t of threads) {
      const cwd = String(t.cwd || "").trim() || os.homedir();
      let group = byCwd.get(cwd);
      if (!group) {
        const meta = projectsMeta[cwd] || {};
        group = {
          cwd,
          name: meta.alias || basename(cwd) || cwd,
          alias: meta.alias || "",
          pinned: Boolean(meta.pinned),
          liveCount: 0,
          pendingCount: 0,
          updatedAt: Number(t.updatedAt) || 0,
          threads: [],
        };
        byCwd.set(cwd, group);
      }
      const reqCount = pendingByThread.get(t.id) || 0;
      if (t.live) group.liveCount += 1;
      group.pendingCount += reqCount;
      if ((t.updatedAt || 0) > group.updatedAt) group.updatedAt = t.updatedAt || 0;
      if (group.threads.length < 4) {
        group.threads.push({
          id: t.id,
          title: String(t.title || t.name || "新会话").slice(0, 64),
          provider: t.provider,
          model: String(t.model || ""),
          live: Boolean(t.live),
          pendingCount: reqCount,
          goalActive: Boolean(t.goalState?.active),
          preview: cleanPreviewText(t.preview || "", 80),
        });
      }
    }

    for (const [cwd, meta] of Object.entries(projectsMeta)) {
      if (!meta?.pinned || byCwd.has(cwd)) continue;
      byCwd.set(cwd, {
        cwd,
        name: meta.alias || basename(cwd) || cwd,
        alias: meta.alias || "",
        pinned: true,
        liveCount: 0,
        pendingCount: 0,
        updatedAt: 0,
        threads: [],
      });
    }

    const activeThreadCwd = activeThreadId ? normCwd(threadById.get(activeThreadId)?.cwd || "") : "";
    const isInternalScratchCwd = (dir) => {
      const normalized = String(dir || "").replace(/\\/g, "/");
      return normalized.includes("/.gemini/antigravity/brain/")
        || normalized.includes("/Claude/scratch-workspaces/");
    };

    const projects = [...byCwd.values()]
      .filter((p) => !isInternalScratchCwd(p.cwd) || (activeThreadCwd && normCwd(p.cwd) === activeThreadCwd))
      .sort((a, b) => {
        const aIsActive = Boolean(activeThreadCwd && normCwd(a.cwd) === activeThreadCwd);
        const bIsActive = Boolean(activeThreadCwd && normCwd(b.cwd) === activeThreadCwd);
        if (aIsActive !== bIsActive) return aIsActive ? -1 : 1;
        if (b.pendingCount !== a.pendingCount) return b.pendingCount - a.pendingCount;
        if (b.liveCount !== a.liveCount) return b.liveCount - a.liveCount;
        if (Boolean(b.pinned) !== Boolean(a.pinned)) return b.pinned ? -1 : 1;
        return (b.updatedAt || 0) - (a.updatedAt || 0);
      })
      .slice(0, 24);
    this.#asrHotwordNames = projects.map((p) => p.alias || p.name);
    this.#asrHotwordUpdatedAt = Date.now();

    let activeThreadReply = "";
    if (activeThreadId) {
      const readRes = await this.#hub.readThread(activeThreadId, { limit: 4 }).catch(() => null);
      activeThreadReply = pickLatestAssistantSnippet(readRes);
    }

    return {
      activeThreadId: activeThreadId || "",
      activeThreadReply,
      availableProfiles: (providersPayload?.profiles || [])
        .filter((p) => p.installed && !p.health?.disabled && p.health?.status !== "unavailable")
        .map((p) => ({
          provider: p.provider,
          profileId: p.id,
          label: p.label,
          authenticated: p.authenticated !== false,
        })),
      pendingRequests: pendingRequests.slice(0, 8).map((r) => {
        const thread = threadById.get(r.threadId);
        const cwd = String(r.cwd || thread?.cwd || "").trim();
        const group = cwd ? byCwd.get(cwd) : null;
        return {
          requestId: r.id,
          threadId: r.threadId,
          provider: r.provider,
          projectCwd: cwd,
          projectName: group?.alias || group?.name || (cwd ? basename(cwd) : ""),
          title: String(r.title || "").slice(0, 80),
          question: String(r.question || "").slice(0, 80),
          command: String(r.command || "").slice(0, 80),
        };
      }),
      projects,
      completedResults: [...(callState?.completedResults || [])],
      delegatedTasks: [...(callState?.delegatedTasks?.values() || [])],
      ...(callState?.pendingClarification && Date.now() - callState.pendingClarification.askedAt < 180_000
        ? { pendingClarification: callState.pendingClarification }
        : {}),
      threads: threads.map(({ id, cwd, title, provider, model, live }) => ({ id, cwd, title, provider, model, live })),
    };
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
      void this.#ensureEdgeTtsWorker(ttsBin).catch(() => {});
    }
    if (this.#hasLocalKokoroRuntime()) {
      void this.#ensureKokoroWorker().catch(() => {});
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

    let finalUttId = cleanUttId;
    let expectedMs = estimateSpeechDurationMs(cleanText);
    if (register && (cleanCallId || cleanUttId)) {
      if (cleanCallId) {
        const callState = this.#callStates.get(cleanCallId);
        const existing = cleanUttId ? callState?.utterances.find((u) => u.utteranceId === cleanUttId) : null;
        if (existing) {
          existing.provider = provider;
          existing.updatedAt = Date.now();
          if (preferOffline || existing.deliveryStatus === "unheard") {
            existing.attempts += 1;
          }
          finalUttId = existing.utteranceId;
          expectedMs = existing.expectedMs;
        } else {
          const rec = this.registerUtterance({
            callId: cleanCallId,
            utteranceId: cleanUttId,
            text: cleanText,
            source,
            priority,
            provider,
          });
          finalUttId = rec.utteranceId;
          expectedMs = rec.expectedMs;
        }
      } else {
        finalUttId = cleanUttId || `utt-${randomUUID().slice(0, 10)}`;
      }
    }

    return {
      audioBase64,
      mimeType,
      provider,
      text: cleanText,
      utteranceId: finalUttId,
      expectedMs,
    };
  }

  async #runVoiceCoordinator({ callId, target, promptText, timeoutMs = VOICE_PROMPT_TIMEOUT_MS, signal = null, onDelta = null }) {
    if (signal?.aborted) {
      throw Object.assign(new Error("请求已取消"), { name: "AbortError", aborted: true });
    }
    if (target.provider !== "antigravity") {
      return this.#runHubVoicePrompt({ target, text: promptText });
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
      void this.#ensureAsrWorker().catch(() => {});
    }
    const ttsBin = resolveEdgeTtsExecutable(this.#env);
    if (ttsBin && this.#resolveEdgeTtsPython(ttsBin)) {
      void this.#ensureEdgeTtsWorker(ttsBin).catch(() => {});
    }
    if (this.#hasLocalKokoroRuntime()) {
      void this.#ensureKokoroWorker().catch(() => {});
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

  #buildSpeechTimingLines(speechTiming = null, transcriptText = "") {
    if (!speechTiming || !(Number(speechTiming.overlapDurationMs) > 0 || speechTiming.duringPlaybackText)) {
      return [];
    }
    const duringText = String(speechTiming.duringPlaybackText || "").trim();
    const afterText = String(speechTiming.afterPlaybackText || "").trim();
    const botText = String(speechTiming.overlapBotText || "").trim();
    const payload = {
      overlapDurationMs: Number(speechTiming.overlapDurationMs) || 0,
      ...(botText ? { aiWasSpeakingText: botText } : {}),
      ...(duringText ? { userSpokeDuringAiPlayback: duringText } : {}),
      ...(afterText ? { userSpokeAfterAiPlayback: afterText } : {}),
      fullTranscript: transcriptText,
    };
    return [
      "说明：用户这次语音是从「AI 播报期间的缓冲收听」无缝拼接「播报结束后的继续讲话」得到的完整识别结果。",
      "请把播报期间和播报之后的两段话连贯起来理解用户完整意图；如果 `userSpokeDuringAiPlayback` 内容与 `aiWasSpeakingText` 高度重合且明显只是外放回声，则忽略回声部分，仅响应用户的真实提问或指令。",
      `<SPEECH_TIMING_CONTEXT>${JSON.stringify(payload)}</SPEECH_TIMING_CONTEXT>`,
    ];
  }

  #buildThreadScopedCoordinatorPrompt({
    snapshot,
    transcriptText = "",
    mode = "turn",
    unheardUtterances = [],
    lastUtterance = null,
    speechTiming = null,
  }) {
    const contextPayload = {
      thread: snapshot.currentThread || null,
      recentTurns: snapshot.recentTurns || [],
      pendingRequests: snapshot.pendingRequests || [],
      completedResults: snapshot.completedResults || [],
    };
    const lines = [
      `${VOICE_CALL_TAG} 你是【当前对话专属】极速语音副驾。只围绕下方这一个当前会话服务，以最快速度回答或把任务交给当前会话。`,
      "决策规则（三选一，绝不调用工具）：",
      "1. 能直接根据 <CURRENT_THREAD_CONTEXT> 回答的追问、解释、总结、方案讨论、进展询问、闲聊，一律设 action=\"reply\"，由你直接用 1~2 句精炼短口语回答（控制 3~6 秒播完，方便一来一回连续对话）。",
      "2. 需要修改代码、读取未展示文件、运行命令/测试、继续推进具体实现的任务，交给当前会话执行：若当前会话空闲或允许排队设 action=\"send\"（或 \"queue\"）；只有用户明确说“别等了/停下重做/立即改/直接插话”才设 action=\"steer\"。instruction 写清楚整理后的书面任务指令，spokenReply 用 1 句简短口语确认已交给当前对话。",
      "3. 明确同意/拒绝当前会话待确认请求设 action=\"approve\" 且 decision=\"accept\" 或 \"decline\"；明确要求停止当前运行任务设 action=\"interrupt\"；要求重播设 action=\"repeat_last\"；纯背景杂音/乱码设 action=\"no_speech\" 且 spokenReply=\"\"。",
      "4. spokenReply 严禁念出路径、斜杠、代码块、Markdown 符号或长 ID。只输出唯一合法 JSON：",
      "{\"heardText\":\"用户原话\",\"action\":\"reply|send|queue|steer|approve|interrupt|repeat_last|no_speech\",\"instruction\":\"\",\"decision\":\"\",\"spokenReply\":\"简短自然中文口语\"}",
      "<CURRENT_THREAD_CONTEXT>",
      JSON.stringify(contextPayload),
      "</CURRENT_THREAD_CONTEXT>",
      `<LAST_REPLY>${JSON.stringify(lastUtterance ? { text: lastUtterance.text, intent: lastUtterance.intent } : null)}</LAST_REPLY>`,
    ];
    if (Array.isArray(unheardUtterances) && unheardUtterances.length > 0) {
      lines.push("若下方 <UNHEARD> 中有刚才未播完的内容，且对用户依然重要（未被本次新话覆盖），请把核心信息与本次新回复自然融合成一句连贯的口语一起说出，严禁使用“另外补播刚才未听到的提醒”等生硬套话。");
      lines.push(`<UNHEARD>${JSON.stringify(unheardUtterances.map((u) => ({ text: u.text })))}</UNHEARD>`);
    }
    lines.push(...this.#buildSpeechTimingLines(speechTiming, transcriptText));
    if (mode === "briefing") {
      lines.push("用户点击【播报最新进度】：用 1~2 句口语播报当前对话最新进展或结果，action=\"reply\"。");
    } else if (transcriptText) {
      lines.push(`用户说：${transcriptText}`);
    }
    return lines.join("\n");
  }

  /**
   * @deprecated 旧通话协调者提示词构造，已冻结；新对话逻辑请维护 `src/assistant-llm.mjs`。
   */
  #buildCoordinatorPrompt({
    snapshot,
    transcriptText = "",
    mode = "turn",
    unheardUtterances = [],
    lastUtterance = null,
    speechTiming = null,
  }) {
    const rules = [
      `${VOICE_CALL_TAG} 你是运行在用户本机 Agent Control 里的实时语音通话副驾。`,
      "用户在手机上通过语音电话与你连续对话，经常一边忙或开车一边听进度、找项目或口头给某个智能体下达任务。",
      "严格规则：",
      "1. 依据完整原话、上下文和控制快照理解语义、指代、否定、疑问、转述及同音误识别，由你决定意图、目标、模型与排队方式。严禁调用工具、执行命令、读写文件或直接操作任务；只返回计划，由控制台执行。",
      "2. 只能从下方实时控制快照 JSON 中挑选真实存在的 `cwd`、`threads[].id`、`pendingRequests[].requestId`，绝不编造。",
      "3. 先判断指令复杂度与归属：（a）简单查询/打开项目/审批/重播/唤醒由你自己直接完成，`executionTier` 设为 `self_simple`；（b）你自己可做但需要较长耗时分析/排查/梳理/总结上下文/对比方案的任务，`intent` 设为 `subagent_hydrogen`、`executionTier` 设为 `subagent_hydrogen`；（c）需要交由其他项目或会话执行的任务，`intent` 设为 `send_turn`（或 `create_thread`）、`executionTier` 设为 `external_thread`（若用户要求直接出结果、给结论、停止等待、别等了、立即发送或别排队，`dispatchMode` 设为 `immediate`，否则设为 `queue`）；若仅停止任务设 `interrupt_thread`；若用户没听清要求再说一遍，设 `intent` 为 `repeat_last`。",
      "询问原因、否认授权、引用别人说的话，均不等于要求执行其中的动作。比如询问为什么停止任务，应只读解释记录，不能再次停止任务。自然问答、闲聊咨询或询问你当前使用的是什么模型/为何没回答时，必须设 intent=summarize_progress、executionTier=self_simple 并直接礼貌回答（严禁当成 no_speech 忽略）；无法确定指代或操作范围时，先口头询问，intent=summarize_progress，不得猜选第一个任务或审批。操作目标必须复制快照中完整的 ID/CWD；新建任务必须指定项目，停止任务必须指定单个会话，审批必须指定 requestId 和明确 decision。",
      "只有明确并非面向你的背景电视声/环境旁白或无意义识别乱码才设 intent=no_speech、spokenReply 留空；只要用户明确在与语音助手对话提问（哪怕只问你是什么模型、在吗、为什么不说话），一律正常回复，不得设为 no_speech。repeat_last 应根据最近播报和未听到的记录重新组织回复。provider/model 只在用户明确要求切换任务执行模型时填写；否则保留已有会话配置。",
      "4. `spokenReply` 用 1~2 句简短自然的电话口语回复（用户多半在开车，先说结论，不超过 40 个汉字，3~6 秒内播完；细节等用户追问再说），绝不念出文件路径、斜杠、代码块、长 ID 或 Markdown 符号；若 `executionTier` 为 `external_thread`，告知已交付给对应会话处理即可，不要念出未完成或冗余长文。",
      "若快照含 `pendingClarification`，说明你上一轮刚问过用户要交给哪个项目：用户这次多半是在回答项目名（可能有同音误识别），请从 `candidateCwds` 或 `projects` 中选定目标，并沿用其中的 `instruction` 完成原来的派发意图。",
      "5. 最终回复必须且只能输出一个合法 JSON 对象，格式如下：",
      '{"heardText":"听到的用户原话","intent":"no_speech|wake_ping|summarize_progress|open_thread|open_project|subagent_hydrogen|send_turn|create_thread|approve_request|interrupt_thread|repeat_last","executionTier":"self_simple|subagent_hydrogen|external_thread","targetProjectCwd":"","targetThreadId":"","provider":"","model":"","dispatchMode":"immediate|queue","instruction":"","requestId":"","decision":"accept|decline|","spokenReply":"用于电话朗读的简短自然中文回复"}',
      "",
      "<LIVE_CONTROL_SNAPSHOT>",
      JSON.stringify(snapshot),
      "</LIVE_CONTROL_SNAPSHOT>",
      `<LAST_REPLY>\n${JSON.stringify(lastUtterance ? { text: lastUtterance.text, intent: lastUtterance.intent } : null)}\n</LAST_REPLY>`,
    ];

    if (Array.isArray(unheardUtterances) && unheardUtterances.length > 0) {
      rules.push("若下方 <UNHEARD_PREVIOUS_REPLIES> 中存在刚才未播完或被打断的内容，且对当前仍然重要（未被用户本次新话覆盖或取消），请将其核心意思与用户这次的新问题/指令自然融合成一句连贯、自然的电话口语回复；严禁使用“另外补播刚才未听到的提醒”等生硬机械套话。");
      rules.push("<UNHEARD_PREVIOUS_REPLIES>");
      rules.push(JSON.stringify(unheardUtterances.map((u) => ({
        utteranceId: u.utteranceId,
        text: u.text,
        reason: u.reason,
      }))));
      rules.push("</UNHEARD_PREVIOUS_REPLIES>");
    }

    rules.push(...this.#buildSpeechTimingLines(speechTiming, transcriptText));

    if (mode === "briefing") {
      rules.push("用户点击了【播报最新进度】：请用 1~2 句电话口语总结当前最需要关注的待确认请求、运行中任务与最新进展，heardText 填 \"播报当前任务进度\"，intent 填 \"summarize_progress\"。");
    } else if (transcriptText) {
      rules.push(`用户补充输入：${transcriptText}`);
    }
    return rules.join("\n");
  }

  #emitEvent(eventName, payload) {
    if (typeof this.#onEvent === "function") {
      try {
        this.#onEvent(eventName, payload);
      } catch {}
    }
  }

  #upsertDispatchBatch(callId, batchRecord) {
    if (!callId || !batchRecord?.batchId) return;
    const callState = this.#ensureCallState(callId);
    if (!Array.isArray(callState.dispatchBatches)) {
      callState.dispatchBatches = [];
    }
    const idx = callState.dispatchBatches.findIndex((b) => b.batchId === batchRecord.batchId);
    if (idx >= 0) {
      callState.dispatchBatches[idx] = { ...callState.dispatchBatches[idx], ...batchRecord };
    } else {
      callState.dispatchBatches.push(batchRecord);
      if (callState.dispatchBatches.length > 20) {
        callState.dispatchBatches = callState.dispatchBatches.slice(-20);
      }
    }
  }

  #prepareDispatchAction(plan, snapshot, { activeThreadId = "", callId = "" } = {}) {
    const intent = plan.intent || "summarize_progress";
    if (intent === "no_speech" || plan?.noSpeech) {
      return {
        needsBackground: false,
        immediateResult: {
          ok: true,
          action: "no_speech",
          executionTier: "self_simple",
          noSpeech: true,
          summaryTag: "",
        },
      };
    }
    if (intent === "repeat_last") {
      return {
        needsBackground: false,
        immediateResult: {
          ok: true,
          action: "repeat_last",
          executionTier: "self_simple",
          summaryTag: "已重播语音",
        },
      };
    }
    let fuzzy = resolveVoicePlanTarget(plan, snapshot);
    const needsTarget = ["open_project", "open_thread", "send_turn", "create_thread", "interrupt_thread"].includes(intent);
    if (!fuzzy.valid || (needsTarget && !fuzzy.threadId && !fuzzy.cwd)) {
      const suggestion = intent === "interrupt_thread"
        ? { unique: null, candidates: [] }
        : suggestVoiceTargetCandidates(plan, snapshot);
      if (suggestion.unique) {
        plan.targetProjectCwd = suggestion.unique.cwd;
        plan.targetThreadId = "";
        fuzzy = resolveVoicePlanTarget(plan, snapshot);
      }
      if (!fuzzy.valid || (needsTarget && !fuzzy.threadId && !fuzzy.cwd)) {
        const callState = callId ? this.#ensureCallState(callId) : null;
        if (callState && suggestion.candidates.length) {
          callState.pendingClarification = {
            intent,
            instruction: String(plan.instruction || plan.heardText || "").slice(0, 400),
            candidateCwds: suggestion.candidates.map((p) => p.cwd),
            askedAt: Date.now(),
          };
        }
        return { needsBackground: false, immediateResult: {
          ok: false, action: intent, summaryTag: "目标未确认",
          overrideReply: intent === "interrupt_thread"
            ? "要停哪个任务？说项目名就行。"
            : buildVoiceClarifyQuestion(suggestion.candidates),
        } };
      }
    }
    if (callId && this.#callStates.get(callId)?.pendingClarification) {
      this.#callStates.get(callId).pendingClarification = null;
    }
    const resolvedProject = fuzzy.project;
    const resolvedThreadId = fuzzy.threadId || "";
    const resolvedCwd = fuzzy.cwd || "";
    const targetName = resolvedProject?.name || (resolvedCwd ? basename(resolvedCwd) : "当前对话");

    if (intent === "subagent_hydrogen") {
      const taskText = plan.instruction || plan.heardText || "";
      const callState = callId ? this.#callStates.get(callId) : null;
      const voicePref = callState?.voicePref || {};
      const resolvedProv = callState?.resolvedTarget?.provider || "";
      const fallbackProv = VOICE_LIGHT_PROVIDER_PRIORITY.find((p) =>
        (snapshot?.availableProfiles || []).some((prof) => prof.provider === p && prof.authenticated !== false),
      ) || "";
      const prefProv = String(plan.provider || resolvedProv || voicePref.voiceProvider || fallbackProv || "").trim().toLowerCase();
      const useHydrogenNaming = !prefProv || prefProv === "auto" || prefProv === "antigravity";
      const subagentLabel = useHydrogenNaming ? "Hydrogen 子代理" : `${voiceProviderDisplayName(prefProv)} 轻量助手`;
      return {
        needsBackground: true,
        alwaysAsync: true,
        pendingMeta: {
          action: "subagent_hydrogen",
          executionTier: "subagent_hydrogen",
          provider: prefProv || (useHydrogenNaming ? "antigravity" : ""),
          model: voicePref.voiceModel || callState?.resolvedTarget?.model || "",
          focusThreadId: resolvedThreadId || "",
          focusProjectCwd: resolvedCwd || "",
          projectName: targetName,
          summaryTag: `${subagentLabel}处理中`,
          ackReply: useHydrogenNaming
            ? "好，这个要花点时间，我让 Hydrogen 子代理去查，有结果告诉你。"
            : `好，我让${subagentLabel}去整理，有结果告诉你。`,
        },
        execute: async ({ batchId = "", utteranceId = "", emitProgress = () => {} } = {}) => {
          const res = await this.#runHydrogenSubagent({
            callId,
            batchId,
            utteranceId,
            instruction: taskText,
            snapshot,
            activeThreadId: resolvedThreadId || activeThreadId || snapshot.activeThreadId || "",
            projectCwd: resolvedCwd,
            preferredProvider: plan.provider || voicePref.voiceProvider || "",
            preferredModel: plan.model || voicePref.voiceModel || "",
            preferredProfileId: voicePref.voiceProfileId || "",
            emitProgress,
          });
          const resProvider = String(res.provider || "antigravity").toLowerCase();
          const resLabel = resProvider === "antigravity"
            ? "Hydrogen 子代理"
            : `${voiceProviderDisplayName(resProvider)} 子代理`;
          const spokenSummary = stripSpeechNoise(res.summary || "已完成分析。", 220);
          if (callId && spokenSummary) {
            this.#recordCompletedResult(callId, {
              threadId: `subagent:${batchId || randomUUID().slice(0, 8)}`,
              projectCwd: resolvedCwd,
              projectName: resLabel,
              title: stripSpeechNoise(taskText, 40) || "子代理分析",
              status: "completed",
              lastResultSummary: spokenSummary,
              source: "subagent_hydrogen",
            });
          }
          return {
            ok: true,
            action: "subagent_hydrogen",
            executionTier: "subagent_hydrogen",
            focusThreadId: resolvedThreadId || "",
            focusProjectCwd: resolvedCwd,
            provider: resProvider,
            model: res.model || DEFAULT_VOICE_HYDROGEN_MODEL,
            summaryTag: `${resLabel}已完成`,
            spokenFeedback: `${resLabel}有结果了：${spokenSummary}`,
            shouldSpeak: true,
            priority: "normal",
          };
        },
      };
    }

    if (intent === "open_thread" && resolvedThreadId) {
      return {
        needsBackground: false,
        immediateResult: {
          ok: true,
          action: "open_thread",
          focusThreadId: resolvedThreadId,
          focusProjectCwd: resolvedCwd,
          summaryTag: "已定位到对话",
        },
      };
    }

    if (intent === "open_project" && (resolvedCwd || resolvedThreadId)) {
      const topThreadId = fuzzy.thread?.id || resolvedProject?.threads?.[0]?.id || "";
      return {
        needsBackground: false,
        immediateResult: {
          ok: true,
          action: resolvedCwd ? "open_project" : "open_thread",
          focusThreadId: topThreadId || resolvedThreadId,
          focusProjectCwd: resolvedCwd,
          summaryTag: `已切到 ${resolvedProject?.name || basename(resolvedCwd || "项目")}`,
        },
      };
    }

    if (intent === "approve_request") {
      const targetReq = snapshot.pendingRequests.find((r) => r.requestId === plan.requestId);
      if (!targetReq || !["accept", "decline"].includes(plan.decision)) {
        return {
          needsBackground: false,
          immediateResult: {
            ok: false,
            action: "approve_request",
            summaryTag: "暂无待确认请求",
            overrideReply: "模型未明确选定有效的审批请求和决定，请补充确认。",
          },
        };
      }
      const decision = plan.decision === "decline" ? "decline" : "accept";
      const focusThreadId = targetReq.threadId || resolvedThreadId;
      const focusProjectCwd = targetReq.projectCwd || resolvedCwd;
      return {
        needsBackground: true,
        pendingMeta: {
          action: "approve_request",
          decision,
          focusThreadId,
          focusProjectCwd,
          projectName: targetReq.projectName || targetName,
          summaryTag: decision === "decline" ? "正在拒绝审批" : "正在批准继续",
          ackReply: decision === "decline" ? "好的，正在拒绝这条待确认请求。" : "好的，正在批准继续执行。",
        },
        execute: async () => {
          await this.#hub.respondToRequest(targetReq.requestId, { decision });
          return {
            ok: true,
            action: "approve_request",
            decision,
            focusThreadId,
            focusProjectCwd,
            summaryTag: decision === "decline" ? "已拒绝审批请求" : "已批准继续执行",
            spokenFeedback: decision === "decline" ? "已拒绝该审批请求。" : "已批准，任务将继续运行。",
            shouldSpeak: false,
          };
        },
      };
    }

    if (intent === "interrupt_thread" && resolvedThreadId) {
      return {
        needsBackground: true,
        pendingMeta: {
          action: "interrupt_thread",
          focusThreadId: resolvedThreadId,
          focusProjectCwd: resolvedCwd,
          projectName: targetName,
          summaryTag: "正在中断任务",
          ackReply: "好的，正在停止当前任务。",
        },
        execute: async () => {
          await this.#hub.interrupt({ threadId: resolvedThreadId });
          return {
            ok: true,
            action: "interrupt_thread",
            focusThreadId: resolvedThreadId,
            focusProjectCwd: resolvedCwd,
            summaryTag: "已中断任务",
            spokenFeedback: "任务已停止。",
            shouldSpeak: false,
          };
        },
      };
    }

    if (intent === "interrupt_thread") {
      return {
        needsBackground: false,
        immediateResult: {
          ok: false,
          action: "interrupt_thread",
          summaryTag: "暂无运行任务",
          overrideReply: "目前没有正在运行的任务。",
        },
      };
    }

    if (intent === "send_turn") {
      const text = plan.instruction || plan.heardText;
      if (!text) {
        return {
          needsBackground: false,
          immediateResult: { ok: false, action: "send_turn", summaryTag: "指令为空" },
        };
      }
      if (!resolvedThreadId && resolvedCwd) {
        return {
          needsBackground: true,
          pendingMeta: {
            action: "create_thread",
            executionTier: "external_thread",
            focusThreadId: "",
            focusProjectCwd: resolvedCwd,
            projectName: targetName,
            summaryTag: `正在为 ${targetName} 新建并派发`,
            ackReply: `好的，正在为 ${targetName} 新建任务并派发。`,
          },
          execute: async ({ batchId = "" } = {}) => {
            const created = await this.#startBestThread({
              provider: plan.provider,
              model: plan.model,
              explicitFastHydrogen: Boolean(plan.explicitFastHydrogen),
              cwd: resolvedCwd,
              text,
              snapshot,
            });
            const createdId = created?.thread?.id || "";
            if (callId && createdId) {
              this.#registerDelegatedTask(callId, {
                threadId: createdId,
                projectCwd: resolvedCwd,
                projectName: targetName,
                title: created?.thread?.title || targetName,
                instruction: text,
                batchId,
                queued: false,
              });
            }
            return {
              ok: true,
              action: "create_thread",
              executionTier: "external_thread",
              focusThreadId: createdId,
              focusProjectCwd: resolvedCwd,
              model: created?.thread?.model || "",
              summaryTag: "已新开任务并派发",
              spokenFeedback: `${targetName} 新任务已启动，正在运行。`,
              shouldSpeak: false,
            };
          },
        };
      }
      if (!resolvedThreadId) {
        return {
          needsBackground: false,
          immediateResult: { ok: false, action: "send_turn", summaryTag: "未找到目标对话" },
        };
      }
      const targetProvider = fuzzy.thread?.provider
        || (resolvedThreadId.includes(":") ? resolvedThreadId.split(":")[0] : "");
      const existingThreadModel = String(fuzzy.thread?.model || "").trim();
      const shouldOverrideTurnModel = targetProvider === "antigravity"
        && (Boolean(plan.explicitFastHydrogen) || Boolean(plan.model) || !existingThreadModel);
      const explicitPlanMode = plan.dispatchMode === "immediate" || plan.dispatchMode === "queue" ? plan.dispatchMode : "";
      const dispatchMode = explicitPlanMode || "queue";
      const isImmediate = dispatchMode === "immediate";
      return {
        needsBackground: true,
        pendingMeta: {
          action: "send_turn",
          executionTier: "external_thread",
          dispatchMode,
          immediate: isImmediate,
          focusThreadId: resolvedThreadId,
          focusProjectCwd: resolvedCwd,
          projectName: targetName,
          summaryTag: isImmediate ? `正在立即发送给 ${targetName}` : `正在派发给 ${targetName}`,
          ackReply: isImmediate
            ? `好的，正在立即发送给 ${targetName}，不排队。`
            : `好的，正在转达给 ${targetName} 处理。`,
        },
        execute: async ({ batchId = "" } = {}) => {
          let turnModelOpts = {};
          if (shouldOverrideTurnModel) {
            const resolvedTurn = await this.#resolveTaskModelAndEffort({
              provider: targetProvider,
              requestedModel: plan.model,
              explicitFastHydrogen: Boolean(plan.explicitFastHydrogen),
            });
            if (resolvedTurn.model) {
              turnModelOpts = {
                model: resolvedTurn.model,
                ...(resolvedTurn.effort ? { effort: resolvedTurn.effort } : {}),
              };
            }
          }
          if (isImmediate) {
            try {
              const sendRes = await this.#hub.sendTurn({
                threadId: resolvedThreadId,
                text,
                permissionMode: "turbo",
                writerConflictPolicy: "reject",
                steer: true,
                ...turnModelOpts,
              });
              if (callId && resolvedThreadId) {
                this.#registerDelegatedTask(callId, {
                  threadId: resolvedThreadId,
                  projectCwd: resolvedCwd,
                  projectName: targetName,
                  title: fuzzy.thread?.title || targetName,
                  instruction: text,
                  batchId,
                  queued: false,
                });
              }
              return {
                ok: true,
                action: "send_turn",
                executionTier: "external_thread",
                dispatchMode: "immediate",
                immediate: true,
                steered: Boolean(sendRes?.steered),
                queued: false,
                focusThreadId: resolvedThreadId,
                focusProjectCwd: resolvedCwd,
                model: turnModelOpts.model || existingThreadModel,
                summaryTag: sendRes?.steered ? `已即时插入引导 (${targetName})` : `已立即发送给 ${targetName}`,
                spokenFeedback: "",
                shouldSpeak: false,
              };
            } catch (error) {
              if (Number(error?.status) === 409 && typeof this.#hub.interrupt === "function") {
                await this.#hub.interrupt({ threadId: resolvedThreadId }).catch(() => {});
                let retryErr = error;
                for (const delayMs of [60, 140, 260]) {
                  await new Promise((r) => setTimeout(r, delayMs));
                  try {
                    await this.#hub.sendTurn({
                      threadId: resolvedThreadId,
                      text,
                      permissionMode: "turbo",
                      writerConflictPolicy: "reject",
                      steer: true,
                      ...turnModelOpts,
                    });
                    if (callId && resolvedThreadId) {
                      this.#registerDelegatedTask(callId, {
                        threadId: resolvedThreadId,
                        projectCwd: resolvedCwd,
                        projectName: targetName,
                        title: fuzzy.thread?.title || targetName,
                        instruction: text,
                        batchId,
                        queued: false,
                      });
                    }
                    return {
                      ok: true,
                      action: "send_turn",
                      executionTier: "external_thread",
                      dispatchMode: "immediate",
                      immediate: true,
                      interruptedPriorTurn: true,
                      queued: false,
                      focusThreadId: resolvedThreadId,
                      focusProjectCwd: resolvedCwd,
                      model: turnModelOpts.model || existingThreadModel,
                      summaryTag: `已停止等待并立即发送给 ${targetName}`,
                      spokenFeedback: "",
                      shouldSpeak: false,
                    };
                  } catch (err) {
                    retryErr = err;
                    if (Number(err?.status) !== 409) throw err;
                  }
                }
                throw retryErr;
              }
              throw error;
            }
          }
          try {
            await this.#hub.sendTurn({
              threadId: resolvedThreadId,
              text,
              permissionMode: "turbo",
              writerConflictPolicy: "reject",
              ...turnModelOpts,
            });
            if (callId && resolvedThreadId) {
              this.#registerDelegatedTask(callId, {
                threadId: resolvedThreadId,
                projectCwd: resolvedCwd,
                projectName: targetName,
                title: fuzzy.thread?.title || targetName,
                instruction: text,
                batchId,
                queued: false,
              });
            }
            return {
              ok: true,
              action: "send_turn",
              executionTier: "external_thread",
              dispatchMode: "queue",
              immediate: false,
              queued: false,
              focusThreadId: resolvedThreadId,
              focusProjectCwd: resolvedCwd,
              model: turnModelOpts.model || existingThreadModel,
              summaryTag: `已发送给 ${targetName}`,
              spokenFeedback: "",
              shouldSpeak: false,
            };
          } catch (error) {
            if (Number(error?.status) === 409) {
              await this.#hub.queueTurn({
                threadId: resolvedThreadId,
                text,
                permissionMode: "turbo",
                ...turnModelOpts,
              });
              if (callId && resolvedThreadId) {
                this.#registerDelegatedTask(callId, {
                  threadId: resolvedThreadId,
                  projectCwd: resolvedCwd,
                  projectName: targetName,
                  title: fuzzy.thread?.title || targetName,
                  instruction: text,
                  batchId,
                  queued: true,
                });
              }
              return {
                ok: true,
                action: "send_turn",
                executionTier: "external_thread",
                dispatchMode: "queue",
                immediate: false,
                queued: true,
                focusThreadId: resolvedThreadId,
                focusProjectCwd: resolvedCwd,
                model: turnModelOpts.model || existingThreadModel,
                summaryTag: "已加入排队，结束后自动执行",
                spokenFeedback: `${targetName} 当前会话正忙，已加入排队，上一轮完成后会自动执行。`,
                shouldSpeak: true,
              };
            }
            throw error;
          }
        },
      };
    }

    if (intent === "create_thread") {
      const text = plan.instruction || plan.heardText;
      return {
        needsBackground: true,
        pendingMeta: {
          action: "create_thread",
          executionTier: "external_thread",
          focusThreadId: "",
          focusProjectCwd: resolvedCwd,
          projectName: targetName,
          summaryTag: "正在新建任务",
          ackReply: `好的，正在 ${targetName} 新建任务。`,
        },
        execute: async ({ batchId = "" } = {}) => {
          const created = await this.#startBestThread({
            provider: plan.provider,
            model: plan.model,
            explicitFastHydrogen: Boolean(plan.explicitFastHydrogen),
            cwd: resolvedCwd,
            text,
            snapshot,
          });
          const createdId = created?.thread?.id || "";
          if (callId && createdId) {
            this.#registerDelegatedTask(callId, {
              threadId: createdId,
              projectCwd: resolvedCwd,
              projectName: targetName,
              title: created?.thread?.title || targetName,
              instruction: text,
              batchId,
              queued: false,
            });
          }
          return {
            ok: true,
            action: "create_thread",
            executionTier: "external_thread",
            focusThreadId: createdId,
            focusProjectCwd: resolvedCwd,
            model: created?.thread?.model || "",
            summaryTag: "已新建任务",
            spokenFeedback: `${targetName} 新任务已创建并开始运行。`,
            shouldSpeak: false,
          };
        },
      };
    }

    const hasExplicitTarget = Boolean(plan.targetThreadId || plan.targetProjectCwd);
    return {
      needsBackground: false,
      immediateResult: {
        ok: true,
        action: "summarize_progress",
        executionTier: "self_simple",
        focusThreadId: hasExplicitTarget ? (fuzzy.threadId || "") : "",
        focusProjectCwd: hasExplicitTarget ? (fuzzy.cwd || "") : "",
        summaryTag: hasExplicitTarget && fuzzy.threadId ? "已定位并播报进展" : "",
      },
    };
  }

  async #executeDispatchAction(plan, snapshot, { activeThreadId = "", callId = "" } = {}) {
    const prepared = this.#prepareDispatchAction(plan, snapshot, { activeThreadId, callId });
    if (!prepared.needsBackground) {
      return prepared.immediateResult;
    }
    return prepared.execute({ callId });
  }

  #startBackgroundDispatchBatch({
    callId = "",
    batchId = "",
    utteranceId = "",
    pendingMeta = {},
    execute,
  }) {
    const initialBatch = {
      batchId,
      callId,
      utteranceId,
      status: "dispatching",
      action: pendingMeta.action || "send_turn",
      executionTier: pendingMeta.executionTier || "external_thread",
      dispatchMode: pendingMeta.dispatchMode || "",
      immediate: Boolean(pendingMeta.immediate),
      focusThreadId: pendingMeta.focusThreadId || "",
      focusProjectCwd: pendingMeta.focusProjectCwd || "",
      projectName: pendingMeta.projectName || "",
      summaryTag: pendingMeta.summaryTag || "后台处理中",
      spokenFeedback: "",
      shouldSpeak: false,
      queued: false,
      priority: "normal",
      error: "",
      updatedAt: Date.now(),
    };
    this.#upsertDispatchBatch(callId, initialBatch);

    let subagentStep = 0;
    const emitProgress = (progressText, extra = {}) => {
      if (this.#closed) return;
      const cleanFeedback = stripSpeechNoise(progressText || "", 180);
      if (!cleanFeedback) return;
      subagentStep += 1;
      const evt = {
        callId,
        batchId,
        utteranceId,
        status: "running",
        action: initialBatch.action,
        executionTier: initialBatch.executionTier,
        step: subagentStep,
        summaryTag: extra.summaryTag || "Hydrogen 子代理进展",
        spokenFeedback: cleanFeedback,
        shouldSpeak: true,
        priority: "normal",
        updatedAt: Date.now(),
      };
      this.#upsertDispatchBatch(callId, {
        ...initialBatch,
        status: "running",
        summaryTag: evt.summaryTag,
        updatedAt: evt.updatedAt,
      });
      this.#emitEvent("voice_subagent_progress", evt);
    };

    const taskPromise = (async () => {
      try {
        const result = await execute({ batchId, utteranceId, emitProgress });
        const completedBatch = {
          ...initialBatch,
          status: result?.queued ? "queued" : "dispatched",
          action: result?.action || initialBatch.action,
          executionTier: result?.executionTier || initialBatch.executionTier,
          dispatchMode: result?.dispatchMode || initialBatch.dispatchMode || "",
          immediate: result?.immediate ?? initialBatch.immediate,
          interruptedPriorTurn: Boolean(result?.interruptedPriorTurn),
          steered: Boolean(result?.steered),
          focusThreadId: result?.focusThreadId || initialBatch.focusThreadId,
          focusProjectCwd: result?.focusProjectCwd || initialBatch.focusProjectCwd,
          model: result?.model || "",
          summaryTag: result?.summaryTag || initialBatch.summaryTag,
          spokenFeedback: stripSpeechNoise(result?.spokenFeedback || "", 260),
          shouldSpeak: Boolean(result?.shouldSpeak && result?.spokenFeedback),
          queued: Boolean(result?.queued),
          priority: result?.priority || "normal",
          error: "",
          updatedAt: Date.now(),
        };
        this.#upsertDispatchBatch(callId, completedBatch);
        this.#emitEvent("voice_dispatch", completedBatch);
        return completedBatch;
      } catch (error) {
        const errMsg = stripSpeechNoise(error?.message || "请稍后再试", 100);
        const failedBatch = {
          ...initialBatch,
          status: "failed",
          summaryTag: "执行失败",
          spokenFeedback: `后台执行未成功：${errMsg}`,
          shouldSpeak: true,
          priority: "critical",
          error: error?.message || "执行调度失败",
          updatedAt: Date.now(),
        };
        this.#upsertDispatchBatch(callId, failedBatch);
        this.#emitEvent("voice_dispatch", failedBatch);
        return failedBatch;
      }
    })();

    this.#pendingDispatchPromises.add(taskPromise);
    taskPromise.finally(() => {
      this.#pendingDispatchPromises.delete(taskPromise);
    });
    return taskPromise;
  }

  #registerDelegatedTask(callId, {
    threadId = "",
    projectCwd = "",
    projectName = "",
    title = "",
    instruction = "",
    batchId = "",
    queued = false,
  } = {}) {
    const cleanCallId = String(callId || "").trim();
    const cleanThreadId = String(threadId || "").trim();
    if (!cleanCallId || !cleanThreadId) return;
    const state = this.#ensureCallState(cleanCallId);
    state.delegatedTasks.set(cleanThreadId, {
      threadId: cleanThreadId,
      projectCwd: String(projectCwd || "").trim(),
      projectName: String(projectName || "").trim() || (projectCwd ? basename(projectCwd) : "外部会话"),
      title: String(title || projectName || "任务").slice(0, 64),
      instruction: String(instruction || "").trim(),
      batchId: String(batchId || "").trim(),
      status: queued ? "queued" : "running",
      waveActive: true,
      dispatchedAt: Date.now(),
      completedAt: 0,
      lastResultSummary: "",
    });
  }

  #recordCompletedResult(callId, entry) {
    const cleanCallId = String(callId || "").trim();
    if (!cleanCallId || !entry) return;
    const state = this.#callStates.get(cleanCallId);
    if (!state) return;
    const cleanThreadId = String(entry.threadId || "").trim();
    state.completedResults = [
      entry,
      ...(state.completedResults || []).filter((item) => !cleanThreadId || item.threadId !== cleanThreadId),
    ].slice(0, 12);
  }

  async #runHubVoiceSubagent({
    target,
    instruction = "",
    snapshot = {},
    threadSnippet = "",
    targetCwd = "",
  }) {
    const compactProjects = (snapshot?.projects || []).slice(0, 6).map((p) => ({
      name: p.alias || p.name,
      liveCount: p.liveCount,
      pendingCount: p.pendingCount,
      threads: (p.threads || []).slice(0, 2).map((t) => ({
        title: t.title,
        live: t.live,
        preview: t.preview,
      })),
    }));
    const subPrompt = [
      `${VOICE_CALL_TAG} 你是 Agent Control 的语音后台只读分析助手（${target.displayName}）。`,
      "只分析下面提供的控制快照与会话摘录，不调用工具或系统命令，不得停止、恢复、派发任务或批准请求。用户问为什么停止是询问原因，不是停止指令；记录不足就直说无法确定原因，不得猜测。",
      "输出要求：用 2~4 句自然流畅的中文电话口语给出清晰结论与建议，不要包含 Markdown 符号、代码块或文件路径斜杠。",
      `用户请求：${instruction}`,
      ...(threadSnippet ? [`当前聚焦会话最近输出：${threadSnippet}`] : []),
      `<CONTEXT_SNAPSHOT>\n${JSON.stringify({ projects: compactProjects, pendingRequests: snapshot?.pendingRequests || [] })}\n</CONTEXT_SNAPSHOT>`,
    ].join("\n");

    const raw = await this.#runHubVoicePrompt({ target, text: subPrompt, cwd: targetCwd });
    return { provider: target.provider, model: target.model, summary: stripSpeechNoise(raw, 260) || "已完成分析整理。" };
  }

  async #runHubVoicePrompt({ target, text, cwd = "" }) {
    if (typeof this.#hub?.startThread !== "function") throw new Error("当前模型不支持语音理解请求，未执行任何操作。");
    const targetCwd = cwd || this.#workspaceDir;
    await mkdir(targetCwd, { recursive: true }).catch(() => {});
    const started = await this.#hub.startThread({
      provider: target.provider,
      profileId: target.profileId || "default",
      cwd: targetCwd,
      model: target.model || undefined,
      effort: target.effort || "low",
      text,
      permissionMode: "plan",
    });

    const createdThreadId = String(started?.thread?.id || "").trim();
    if (!createdThreadId) {
      throw new Error(`${target.displayName} 子代理未返回会话 ID`);
    }

    let summary = "";
    await new Promise((resolveDone, rejectDone) => {
      let settled = false;
      const cleanup = () => {
        clearTimeout(timeoutTimer);
        clearInterval(pollTimer);
        this.#pendingSubagentThreads.delete(createdThreadId);
      };
      const finish = (text) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolveDone(String(text || "").trim());
      };
      const fail = (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectDone(err);
      };

      const timeoutTimer = setTimeout(() => {
        fail(new Error(`${target.displayName} 子代理分析超时`));
      }, 45_000);

      const pollTimer = setInterval(async () => {
        if (settled || this.#closed) {
          fail(new Error("语音服务已关闭"));
          return;
        }
        if (typeof this.#hub?.readThread !== "function") return;
        const readRes = await this.#hub.readThread(createdThreadId, { limit: 4 }).catch(() => null);
        const latestThread = readRes?.thread;
        const turns = Array.isArray(latestThread?.turns) ? latestThread.turns : [];
        const lastTurn = turns[turns.length - 1];
        if (lastTurn && lastTurn.status && lastTurn.status !== "inProgress" && lastTurn.status !== "running") {
          if (lastTurn.status === "failed" || lastTurn.status === "interrupted") {
            fail(new Error("语音模型请求未完成"));
            return;
          }
          const snippet = pickLatestAssistantText(readRes);
          if (snippet || lastTurn.status === "completed") {
            finish(snippet || "已完成分析整理。");
          }
        }
      }, 900);
      pollTimer.unref?.();

      this.#pendingSubagentThreads.set(createdThreadId, {
        resolve: finish,
        reject: fail,
      });
    }).then((text) => {
      summary = text;
    });

    return summary;
  }

  async #runHydrogenSubagent({
    callId = "",
    batchId = "",
    utteranceId = "",
    instruction = "",
    snapshot = {},
    activeThreadId = "",
    projectCwd = "",
    preferredProvider = "",
    preferredModel = "",
    preferredProfileId = "",
    emitProgress = () => {},
  } = {}) {
    const target = await this.resolveVoiceTarget({
      callId,
      voiceProvider: preferredProvider,
      voiceModel: preferredModel,
      voiceProfileId: preferredProfileId,
    });
    const model = target.model || DEFAULT_VOICE_HYDROGEN_MODEL;
    const effort = target.effort || resolveVoiceEffort(target.provider, model);
    const targetCwd = projectCwd && existsSync(projectCwd) ? projectCwd : this.#workspaceDir;
    let threadSnippet = "";
    if (activeThreadId && typeof this.#hub?.readThread === "function") {
      const threadRes = await this.#hub.readThread(activeThreadId, { limit: 6 }).catch(() => null);
      threadSnippet = pickLatestAssistantSnippet(threadRes);
    }

    const progressPrefix = target.provider === "antigravity"
      ? "Hydrogen 子代理进展"
      : `${target.shortLabel} 进展`;
    const stepMessages = [
      "正在收集相关会话与上下文信息",
      "正在深入分析并整理结论，很快给你结果",
      "正在核对细节与关键要点，马上完成",
    ];
    let lastTickAt = Date.now();
    let tickStep = 0;
    const progressTimer = setInterval(() => {
      if (this.#closed) return;
      if (Date.now() - lastTickAt < this.#subagentMinFeedbackGapMs) return;
      lastTickAt = Date.now();
      const msg = stepMessages[Math.min(tickStep, stepMessages.length - 1)];
      tickStep += 1;
      emitProgress(`${progressPrefix}：${msg}。`);
    }, this.#subagentProgressIntervalMs);

    try {
      if (this.#subagentExecutor) {
        const out = await this.#subagentExecutor({
          callId,
          batchId,
          utteranceId,
          instruction,
          provider: target.provider,
          model,
          effort,
          cwd: targetCwd,
          snapshot,
          threadSnippet,
          emitProgress: (msg) => {
            lastTickAt = Date.now();
            emitProgress(msg);
          },
        });
        return {
          provider: target.provider,
          model,
          summary: String(out?.summary || out?.text || out || "").trim(),
        };
      }

      if (target.provider !== "antigravity") {
        return await this.#runHubVoiceSubagent({
          target,
          instruction,
          snapshot,
          threadSnippet,
          targetCwd,
        });
      }

      const client = await this.#ensureClient();
      const created = await client.newSession({ cwd: targetCwd });
      const sessionId = String(created?.sessionId || "");
      if (!sessionId) throw new Error("Hydrogen 子代理未返回会话 ID");
      await client.configureSession(sessionId, {
        model,
        ...(effort ? { effort } : {}),
        permissionMode: "plan",
      });

      const subBuffer = {
        callId,
        batchId,
        utteranceId,
        text: "",
        lastPhase: "",
        lastProgressAt: Date.now(),
        step: 0,
        emitProgress: (msg) => {
          lastTickAt = Date.now();
          emitProgress(msg);
        },
      };
      this.#activeSubagentSessions.set(sessionId, subBuffer);

      const compactProjects = (snapshot?.projects || []).slice(0, 6).map((p) => ({
        name: p.alias || p.name,
        liveCount: p.liveCount,
        pendingCount: p.pendingCount,
        threads: (p.threads || []).slice(0, 2).map((t) => ({
          title: t.title,
          live: t.live,
          preview: t.preview,
        })),
      }));
      const subPrompt = [
        "[AC_VOICE_SUBAGENT] 你是 Agent Control 的语音后台分析子代理（Hydrogen）。",
        "只分析下面提供的控制快照与会话摘录，不调用工具或系统命令，不得停止、恢复、派发任务或批准请求。用户问为什么停止是询问原因，不是停止指令；记录不足就直说无法确定原因，不得猜测。",
        "输出要求：用 2~4 句自然流畅的中文电话口语给出清晰结论与建议，不要包含 Markdown 符号、代码块或文件路径斜杠。",
        `用户请求：${instruction}`,
        ...(threadSnippet ? [`当前聚焦会话最近输出：${threadSnippet}`] : []),
        `<CONTEXT_SNAPSHOT>\n${JSON.stringify({ projects: compactProjects, pendingRequests: snapshot?.pendingRequests || [] })}\n</CONTEXT_SNAPSHOT>`,
      ].join("\n");

      let timeoutTimer;
      try {
        await Promise.race([
          client.sendPrompt(sessionId, [{ type: "text", text: subPrompt }]),
          new Promise((_, reject) => {
            timeoutTimer = setTimeout(() => reject(new Error("Hydrogen 子代理分析超时")), 45_000);
          }),
        ]);
      } finally {
        clearTimeout(timeoutTimer);
        this.#activeSubagentSessions.delete(sessionId);
      }

      const finalText = stripSpeechNoise(subBuffer.text || "", 260) || "已完成分析整理。";
      return { provider: "antigravity", model, summary: finalText };
    } finally {
      clearInterval(progressTimer);
    }
  }

  async handleHubEvent(eventName, payload) {
    if (this.#closed) return;
    if (eventName !== "provider_event" && eventName !== "turn_completed" && eventName !== "turn_started") {
      return;
    }
    const evt = payload || {};
    const threadId = String(evt.threadId || "").trim();
    if (!threadId) return;

    const isCodexStarted = evt.method === "turn/started";
    const isUnifiedStarted = evt.type === "turn_started" || eventName === "turn_started";
    const isCodexCompleted = evt.method === "turn/completed";
    const isUnifiedCompleted = evt.type === "turn_completed" || eventName === "turn_completed";

    if (isCodexStarted || isUnifiedStarted) {
      for (const state of this.#callStates.values()) {
        const delegated = state.delegatedTasks?.get(threadId);
        if (delegated) {
          delegated.status = "running";
          delegated.waveActive = true;
        }
      }
      return;
    }

    if (!isCodexCompleted && !isUnifiedCompleted) return;

    const rawStatus = isCodexCompleted
      ? (evt.params?.turn?.status || "completed")
      : (evt.status || "completed");
    const turnId = String(isCodexCompleted ? (evt.params?.turn?.id || "") : (evt.turnId || evt.turn?.id || "")).trim();
    let resultText = String(
      evt.lastAgentMessage
      || evt.params?.turn?.lastAgentMessage
      || "",
    ).trim();

    if (!resultText && typeof this.#hub?.readThread === "function") {
      const readRes = await this.#hub.readThread(threadId, { limit: 4 }).catch(() => null);
      resultText = pickLatestAssistantText(readRes);
    }
    const cleanResultSummary = stripSpeechNoise(resultText, 240);

    const subagentWaiter = this.#pendingSubagentThreads.get(threadId);
    if (subagentWaiter) {
      if (rawStatus === "failed") {
        subagentWaiter.reject(new Error(evt.error || "语音后台分析子代理执行失败"));
      } else {
        subagentWaiter.resolve(resultText || "");
      }
    }

    for (const state of this.#callStates.values()) {
      const delegated = state.delegatedTasks?.get(threadId);
      if (!delegated) continue;
      const dedupeKey = `milestone:${state.callId}:${threadId}:${turnId || `${rawStatus}:${Math.floor(Date.now() / 1000)}`}`;
      if (state.announcedMilestoneKeys?.has(dedupeKey)) continue;
      state.announcedMilestoneKeys?.add(dedupeKey);
      if (state.announcedMilestoneKeys && state.announcedMilestoneKeys.size > 100) {
        const firstKey = state.announcedMilestoneKeys.values().next().value;
        if (firstKey) state.announcedMilestoneKeys.delete(firstKey);
      }

      const label = delegated.projectName || delegated.title || "外部会话";
      delegated.status = rawStatus;
      delegated.completedAt = Date.now();
      delegated.lastResultSummary = cleanResultSummary;

      if (rawStatus === "interrupted") {
        delegated.waveActive = false;
        continue;
      }

      this.#recordCompletedResult(state.callId, {
        threadId,
        projectCwd: delegated.projectCwd || "",
        projectName: label,
        title: delegated.title || label,
        status: rawStatus,
        lastResultSummary: cleanResultSummary,
        completedAt: Date.now(),
        source: "external_thread",
      });

      const activeWaveItems = [];
      for (const item of state.delegatedTasks?.values() || []) {
        if (item.waveActive) activeWaveItems.push(item);
      }
      const remainingCount = activeWaveItems.filter(
        (item) => item.threadId !== threadId && (item.status === "running" || item.status === "queued"),
      ).length;
      const waveTotal = Math.max(1, activeWaveItems.length);
      const failed = rawStatus === "failed";

      // 对外派会话：绝不主动朗读详细结果内容，仅播报单个完成/全部完成里程碑
      let spokenFeedback = "";
      if (remainingCount > 0) {
        spokenFeedback = failed
          ? `「${label}」执行失败，还有 ${remainingCount} 个其他会话任务正在进行。`
          : `「${label}」已完成，还有 ${remainingCount} 个其他会话任务正在进行。`;
      } else {
        for (const item of activeWaveItems) {
          item.waveActive = false;
        }
        if (waveTotal > 1) {
          spokenFeedback = failed
            ? `「${label}」执行失败，本轮 ${waveTotal} 个其他会话任务已全部结束，需要听详情可以问我。`
            : `「${label}」已完成，本轮 ${waveTotal} 个其他会话任务已全部完成，需要听结果随时问我。`;
        } else {
          spokenFeedback = failed
            ? `「${label}」的任务执行失败，想了解详情随时问我。`
            : `「${label}」的任务已完成，想听结果随时问我。`;
        }
      }

      this.#emitEvent("voice_external_milestone", {
        callId: state.callId,
        threadId,
        turnId,
        projectName: label,
        status: rawStatus,
        remainingCount,
        totalCount: waveTotal,
        allDone: remainingCount === 0,
        resultStored: Boolean(cleanResultSummary),
        summaryTag: remainingCount === 0 ? "外部任务已全部完成" : "外部任务完成一个",
        spokenFeedback,
        shouldSpeak: true,
        priority: failed ? "critical" : "normal",
        dedupeKey,
        updatedAt: Date.now(),
      });
    }
  }

  async #startBestThread({
    provider = "",
    model = "",
    explicitFastHydrogen = false,
    cwd = "",
    text = "",
    snapshot,
  }) {
    const available = Array.isArray(snapshot?.availableProfiles) ? snapshot.availableProfiles : [];
    const fallbackAutoProvider = VOICE_LIGHT_PROVIDER_PRIORITY.find((prov) =>
      available.some((p) => p.provider === prov && p.authenticated !== false),
    ) || VOICE_LIGHT_PROVIDER_PRIORITY.find((prov) =>
      available.some((p) => p.provider === prov),
    ) || available.find((p) => p.authenticated !== false)?.provider
      || available[0]?.provider
      || "antigravity";
    const cleanProvider = ["antigravity", "codex", "claude", "grok"].includes(provider)
      ? provider
      : fallbackAutoProvider;
    const candidates = available.filter((p) => p.provider === cleanProvider);
    const chosenProfile = candidates.find((p) => p.authenticated !== false)
      || candidates[0]
      || available.find((p) => p.authenticated !== false)
      || available[0];
    const finalProvider = chosenProfile?.provider || cleanProvider;
    const finalProfileId = chosenProfile?.profileId || (finalProvider === "antigravity" ? "cli" : "default");
    const { model: resolvedModel, effort: resolvedEffort } = await this.#resolveTaskModelAndEffort({
      provider: finalProvider,
      requestedModel: model,
      explicitFastHydrogen: Boolean(explicitFastHydrogen),
    });
    return this.#hub.startThread({
      provider: finalProvider,
      profileId: finalProfileId,
      cwd,
      model: resolvedModel,
      ...(resolvedEffort ? { effort: resolvedEffort } : {}),
      text,
      permissionMode: "turbo",
    });
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

  #resetEdgeTtsWorker(reason = "Edge TTS 常驻进程已关闭") {
    if (this.#edgeTtsChild) {
      const child = this.#edgeTtsChild;
      this.#edgeTtsChild = null;
      try { child.kill("SIGTERM"); } catch {}
    }
    this.#edgeTtsReadyPromise = null;
    this.#edgeTtsStdoutBuf = "";
    for (const [, pending] of this.#edgeTtsPending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.#edgeTtsPending.clear();
  }

  #ensureEdgeTtsWorker(ttsBin = "") {
    if (this.#closed) {
      return Promise.reject(Object.assign(new Error("语音服务已关闭"), { status: 503 }));
    }
    if (this.#edgeTtsReadyPromise && this.#edgeTtsChild && !this.#edgeTtsChild.killed) {
      return this.#edgeTtsReadyPromise;
    }
    const pythonBin = this.#resolveEdgeTtsPython(ttsBin || resolveEdgeTtsExecutable(this.#env));
    if (!pythonBin) {
      return Promise.reject(new Error("未检测到 Edge TTS Python 环境"));
    }

    this.#edgeTtsReadyPromise = new Promise((resolveReady, rejectReady) => {
      const moduleDir = dirname(fileURLToPath(import.meta.url));
      const workerScript = resolve(moduleDir, "voice-edge-tts-worker.py");
      let settledReady = false;
      const readyTimer = setTimeout(() => {
        if (!settledReady) {
          settledReady = true;
          this.#resetEdgeTtsWorker("Edge TTS 常驻进程启动超时");
          rejectReady(new Error("Edge TTS 常驻进程启动超时"));
        }
      }, 10_000);

      let child;
      try {
        child = spawn(pythonBin, [workerScript], {
          env: { ...this.#env },
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        clearTimeout(readyTimer);
        rejectReady(error);
        return;
      }

      this.#edgeTtsChild = child;
      let stderrTail = "";

      child.stderr.on("data", (chunk) => {
        stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-600);
      });

      child.stdout.on("data", (chunk) => {
        this.#edgeTtsStdoutBuf += chunk.toString("utf8");
        while (true) {
          const nl = this.#edgeTtsStdoutBuf.indexOf("\n");
          if (nl === -1) break;
          const line = this.#edgeTtsStdoutBuf.slice(0, nl).trim();
          this.#edgeTtsStdoutBuf = this.#edgeTtsStdoutBuf.slice(nl + 1);
          if (!line) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (Object.hasOwn(msg, "ready") && !settledReady) {
            settledReady = true;
            clearTimeout(readyTimer);
            if (msg.ready) {
              resolveReady(child);
            } else {
              this.#resetEdgeTtsWorker(msg.error || "Edge TTS 初始化失败");
              rejectReady(new Error(msg.error || "Edge TTS 初始化失败"));
            }
            continue;
          }
          const reqId = String(msg?.id || "");
          if (reqId && this.#edgeTtsPending.has(reqId)) {
            const pending = this.#edgeTtsPending.get(reqId);
            this.#edgeTtsPending.delete(reqId);
            clearTimeout(pending.timer);
            if (msg.ok) {
              pending.resolve(msg);
            } else {
              pending.reject(new Error(msg.error || "Edge TTS 合成失败"));
            }
          }
        }
      });

      child.on("error", (err) => {
        clearTimeout(readyTimer);
        if (!settledReady) {
          settledReady = true;
          rejectReady(err);
        }
        this.#resetEdgeTtsWorker(err?.message || "Edge TTS 进程启动失败");
      });

      child.on("exit", (code, signal) => {
        clearTimeout(readyTimer);
        const reason = stderrTail.trim() || `Edge TTS 进程退出 (${code ?? signal ?? "unknown"})`;
        if (!settledReady) {
          settledReady = true;
          rejectReady(new Error(reason));
        }
        this.#resetEdgeTtsWorker(reason);
      });
    });

    return this.#edgeTtsReadyPromise;
  }

  async #synthesizeViaEdgeTtsWorker({ ttsBin = "", text = "", voice = DEFAULT_VOICE_TTS_NAME, rate = "+8%" } = {}) {
    const child = await this.#ensureEdgeTtsWorker(ttsBin);
    const reqId = `tts-${randomUUID().slice(0, 10)}`;
    const payload = JSON.stringify({ id: reqId, text, voice, rate }) + "\n";
    return new Promise((resolveDone, rejectDone) => {
      const timer = setTimeout(() => {
        this.#edgeTtsPending.delete(reqId);
        this.#resetEdgeTtsWorker("Edge TTS 合成超时");
        rejectDone(new Error("Edge TTS 合成超时"));
      }, EDGE_TTS_TIMEOUT_MS);
      this.#edgeTtsPending.set(reqId, { resolve: resolveDone, reject: rejectDone, timer });
      try {
        child.stdin.write(payload);
      } catch (err) {
        clearTimeout(timer);
        this.#edgeTtsPending.delete(reqId);
        rejectDone(err);
      }
    });
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

  #resetKokoroWorker(reason = "Kokoro 常驻进程已关闭") {
    if (this.#kokoroChild) {
      const child = this.#kokoroChild;
      this.#kokoroChild = null;
      try { child.kill("SIGTERM"); } catch {}
    }
    this.#kokoroReadyPromise = null;
    this.#kokoroStdoutBuf = "";
    for (const [, pending] of this.#kokoroPending) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
    }
    this.#kokoroPending.clear();
  }

  #ensureKokoroWorker() {
    if (this.#closed) {
      return Promise.reject(Object.assign(new Error("语音服务已关闭"), { status: 503 }));
    }
    if (this.#kokoroReadyPromise && this.#kokoroChild && !this.#kokoroChild.killed) {
      return this.#kokoroReadyPromise;
    }

    this.#kokoroReadyPromise = new Promise((resolveReady, rejectReady) => {
      const explicitBin = String(this.#env?.VOICE_KOKORO_BIN || "").trim();
      const moduleDir = dirname(fileURLToPath(import.meta.url));
      const workerScript = resolve(moduleDir, "voice-kokoro-tts-worker.py");
      const cmd = explicitBin || (this.#env?.VOICE_PYTHON_BIN || "/opt/homebrew/bin/python3.12");
      const args = explicitBin ? [] : [workerScript];

      let settledReady = false;
      const readyTimer = setTimeout(() => {
        if (!settledReady) {
          settledReady = true;
          this.#resetKokoroWorker("Kokoro 启动超时");
          rejectReady(new Error("Kokoro 启动超时"));
        }
      }, 45_000);

      let child;
      try {
        child = spawn(cmd, args, {
          env: {
            ...this.#env,
            HF_HUB_OFFLINE: "1",
            TRANSFORMERS_OFFLINE: "1",
          },
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        clearTimeout(readyTimer);
        rejectReady(error);
        return;
      }

      this.#kokoroChild = child;
      let stderrTail = "";

      child.stderr.on("data", (chunk) => {
        stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-600);
      });

      child.stdout.on("data", (chunk) => {
        this.#kokoroStdoutBuf += chunk.toString("utf8");
        while (true) {
          const nl = this.#kokoroStdoutBuf.indexOf("\n");
          if (nl === -1) break;
          const line = this.#kokoroStdoutBuf.slice(0, nl).trim();
          this.#kokoroStdoutBuf = this.#kokoroStdoutBuf.slice(nl + 1);
          if (!line) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (Object.hasOwn(msg, "ready") && !settledReady) {
            settledReady = true;
            clearTimeout(readyTimer);
            if (msg.ready) {
              resolveReady(child);
            } else {
              this.#resetKokoroWorker(msg.error || "Kokoro 初始化失败");
              rejectReady(new Error(msg.error || "Kokoro 初始化失败"));
            }
            continue;
          }
          const reqId = String(msg?.id || "");
          if (reqId && this.#kokoroPending.has(reqId)) {
            const pending = this.#kokoroPending.get(reqId);
            this.#kokoroPending.delete(reqId);
            clearTimeout(pending.timer);
            if (msg.ok) {
              pending.resolve(msg);
            } else {
              pending.reject(new Error(msg.error || "Kokoro 合成失败"));
            }
          }
        }
      });

      child.on("error", (err) => {
        clearTimeout(readyTimer);
        if (!settledReady) {
          settledReady = true;
          rejectReady(err);
        }
        this.#resetKokoroWorker(err?.message || "Kokoro 进程启动失败");
      });

      child.on("exit", (code, signal) => {
        clearTimeout(readyTimer);
        const reason = stderrTail.trim() || `Kokoro 进程退出 (${code ?? signal ?? "unknown"})`;
        if (!settledReady) {
          settledReady = true;
          rejectReady(new Error(reason));
        }
        this.#resetKokoroWorker(reason);
      });
    });

    return this.#kokoroReadyPromise;
  }

  async #synthesizeViaKokoroWorker({ text = "", voice = "zf_xiaoxiao", speed = 1.06 } = {}) {
    const child = await this.#ensureKokoroWorker();
    const reqId = `kokoro-${randomUUID().slice(0, 10)}`;
    const payload = JSON.stringify({ id: reqId, text, voice, speed }) + "\n";
    return new Promise((resolveDone, rejectDone) => {
      const timer = setTimeout(() => {
        this.#kokoroPending.delete(reqId);
        this.#resetKokoroWorker("Kokoro 合成超时");
        rejectDone(new Error("Kokoro 合成超时"));
      }, 20_000);
      this.#kokoroPending.set(reqId, { resolve: resolveDone, reject: rejectDone, timer });
      try {
        child.stdin.write(payload);
      } catch (err) {
        clearTimeout(timer);
        this.#kokoroPending.delete(reqId);
        rejectDone(err);
      }
    });
  }

  #resetAsrWorker(reason = "语音识别进程已退出") {
    const child = this.#asrChild;
    this.#asrChild = null;
    this.#asrReadyPromise = null;
    this.#asrStdoutBuf = "";
    if (child && !child.killed) {
      try { child.kill("SIGTERM"); } catch {}
    }
    for (const [reqId, pending] of this.#asrPending.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.#asrPending.delete(reqId);
    }
  }

  #ensureAsrWorker() {
    if (this.#closed) {
      return Promise.reject(Object.assign(new Error("语音服务已关闭"), { status: 503 }));
    }
    if (this.#asrReadyPromise && this.#asrChild && !this.#asrChild.killed) {
      return this.#asrReadyPromise;
    }

    this.#asrReadyPromise = new Promise((resolveReady, rejectReady) => {
      const explicitBin = String(this.#env?.VOICE_ASR_BIN || process.env.VOICE_ASR_BIN || "").trim();
      const moduleDir = dirname(fileURLToPath(import.meta.url));
      const workerScript = resolve(moduleDir, "voice-asr-worker.py");
      const cmd = explicitBin || (this.#env?.VOICE_PYTHON_BIN || "/opt/homebrew/bin/python3.12");
      const args = explicitBin ? [] : [workerScript];

      let settledReady = false;
      const readyTimer = setTimeout(() => {
        if (!settledReady) {
          settledReady = true;
          this.#resetAsrWorker("本地 Whisper 启动超时");
          rejectReady(new Error("本地 Whisper 启动超时"));
        }
      }, 45_000);

      let child;
      try {
        child = spawn(cmd, args, {
          env: {
            ...this.#env,
            HF_HUB_OFFLINE: "1",
            TRANSFORMERS_OFFLINE: "1",
          },
          windowsHide: true,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        clearTimeout(readyTimer);
        rejectReady(error);
        return;
      }

      this.#asrChild = child;
      let stderrTail = "";

      child.stderr.on("data", (chunk) => {
        stderrTail = `${stderrTail}${chunk.toString("utf8")}`.slice(-800);
      });

      child.stdout.on("data", (chunk) => {
        this.#asrStdoutBuf += chunk.toString("utf8");
        while (true) {
          const nl = this.#asrStdoutBuf.indexOf("\n");
          if (nl === -1) break;
          const line = this.#asrStdoutBuf.slice(0, nl).trim();
          this.#asrStdoutBuf = this.#asrStdoutBuf.slice(nl + 1);
          if (!line) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (Object.hasOwn(msg, "ready") && !settledReady) {
            settledReady = true;
            clearTimeout(readyTimer);
            if (msg.ready) {
              resolveReady(child);
            } else {
              this.#resetAsrWorker(msg.error || "本地语音识别初始化失败");
              rejectReady(new Error(msg.error || "本地语音识别初始化失败"));
            }
            continue;
          }
          const reqId = String(msg?.id || "");
          if (reqId && this.#asrPending.has(reqId)) {
            const pending = this.#asrPending.get(reqId);
            this.#asrPending.delete(reqId);
            clearTimeout(pending.timer);
            if (msg.ok) {
              pending.resolve(msg);
            } else {
              pending.reject(new Error(msg.error || "语音识别失败"));
            }
          }
        }
      });

      child.on("error", (err) => {
        clearTimeout(readyTimer);
        if (!settledReady) {
          settledReady = true;
          rejectReady(err);
        }
        this.#resetAsrWorker(err?.message || "语音识别进程启动失败");
      });

      child.on("exit", (code, signal) => {
        clearTimeout(readyTimer);
        const reason = stderrTail.trim() || `语音识别进程退出 (${code ?? signal ?? "unknown"})`;
        if (!settledReady) {
          settledReady = true;
          rejectReady(new Error(reason));
        }
        this.#resetAsrWorker(reason);
      });
    });

    return this.#asrReadyPromise;
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
      const child = await this.#ensureAsrWorker();
      const reqId = randomUUID();
      const result = await new Promise((resolveReq, rejectReq) => {
        const timer = setTimeout(() => {
          this.#asrPending.delete(reqId);
          this.#resetAsrWorker("语音识别超时");
          rejectReq(new Error("语音识别超时"));
        }, 35_000);
        this.#asrPending.set(reqId, {
          resolve: resolveReq,
          reject: rejectReq,
          timer,
        });
        child.stdin.write(`${JSON.stringify({
          id: reqId,
          audioPath,
          language,
          ...(Number(overlapMs) > 0 ? { overlapMs: Math.round(Number(overlapMs)) } : {}),
          ...(promptHints ? { prompt: promptHints } : {}),
        })}\n`);
      });
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

  /**
   * @deprecated 旧通话协调者回合入口，已冻结不再扩展；请统一使用
   * `POST /api/assistant/voice-turn` + `AssistantService`。
   */
  async handleTurn({
    callId = "",
    callScope = "",
    audioBase64 = "",
    audioMimeType = "audio/wav",
    transcriptText = "",
    activeThreadId = "",
    voiceProvider = "",
    voiceModel = "",
    voiceProfileId = "",
    mode = "turn",
    autoExecute = true,
    asyncDispatch = false,
    tts = true,
    overlapDurationMs = 0,
    overlapBotText = "",
  } = {}) {
    const cleanCallId = String(callId || "").trim() || `call-${randomUUID().slice(0, 8)}`;
    const callState = this.#ensureCallState(cleanCallId);
    const effectiveThreadId = String(activeThreadId || callState.activeThreadId || "").trim();
    const effectiveScope = normalizeVoiceCallScope(callScope || callState.callScope || "", effectiveThreadId);
    callState.callScope = effectiveScope;
    if (effectiveThreadId) callState.activeThreadId = effectiveThreadId;
    if (voiceProvider || voiceModel || voiceProfileId) {
      callState.voicePref = {
        voiceProvider: String(voiceProvider || "").trim(),
        voiceModel: String(voiceModel || "").trim(),
        voiceProfileId: String(voiceProfileId || "").trim(),
      };
    }
    const cleanAudio = String(audioBase64 || "").replace(/^data:[^;]+;base64,/, "").trim();
    const cleanTranscript = String(transcriptText || "").trim();
    const rawAsrBin = String(this.#env?.VOICE_ASR_BIN || "").trim();
    const hasExplicitAsrBin = Boolean(rawAsrBin);
    const asrBinName = basename(rawAsrBin);
    const agyBinName = basename(agyExecutable(this.#env) || "");
    const isMockAgy = agyBinName.includes("mock-agy");
    const isMockAsr = asrBinName.includes("mock-voice-asr");

    const buildLocalNoSpeechPayload = ({
      silenceReason = "no_speech",
      ignoredText = "",
      model = "local-audio-gate",
      usedFallback = false,
      localAudioFiltered = false,
      audioMetrics = null,
      pendingCount = 0,
      liveProjectCount = 0,
    } = {}) => {
      this.#appendVoiceDiagLog({
        type: "turn_filtered",
        callId: cleanCallId,
        callScope: effectiveScope,
        silenceReason,
        localAudioFiltered,
        ignoredText: String(ignoredText || "").slice(0, 80),
        ...(audioMetrics ? { audioMetrics } : {}),
      });
      return {
      ok: true,
      noSpeech: true,
      localAudioFiltered,
      silenceReason,
      ...(audioMetrics ? { audioMetrics } : {}),
      callId: cleanCallId,
      model,
      usedFallback,
      heardText: "",
      ignoredText,
      spokenReply: "",
      utteranceId: "",
      expectedMs: 0,
      replayedUnheardIds: [],
      unheardCount: this.getUnheardUtterances(cleanCallId).length,
      batchId: "",
      dispatchPending: false,
      plan: {
        heardText: "",
        ignoredText,
        noSpeech: true,
        silenceReason,
        intent: "no_speech",
        targetProjectCwd: "",
        targetThreadId: "",
        provider: "",
        model: "",
        instruction: "",
        requestId: "",
        decision: "",
        spokenReply: "",
      },
      executed: { ok: true, action: "no_speech", noSpeech: true, summaryTag: "" },
      tts: { audioBase64: "", mimeType: "", provider: "none" },
      snapshotSummary: {
        pendingCount,
        liveProjectCount,
      },
    };
    };

    if (mode !== "briefing") {
      if (!cleanAudio && !cleanTranscript) {
        return buildLocalNoSpeechPayload({
          silenceReason: "empty_input",
          model: "local-filter",
          localAudioFiltered: false,
        });
      }
      if (cleanAudio && !cleanTranscript) {
        const audioBuf = Buffer.from(cleanAudio, "base64");
        if (audioBuf.length < 64) {
          return buildLocalNoSpeechPayload({
            silenceReason: "too_short_audio",
            model: "local-audio-gate",
            localAudioFiltered: true,
          });
        }
        const wavCheck = analyzeWavPcm16Activity(audioBuf, {
          allowLegacyZeroMockStub: isMockAgy || isMockAsr,
        });
        if (wavCheck.inspected && !wavCheck.hasSpeech) {
          return buildLocalNoSpeechPayload({
            silenceReason: wavCheck.reason,
            model: "local-audio-gate",
            localAudioFiltered: true,
            audioMetrics: {
              durationMs: wavCheck.durationMs,
              rms: wavCheck.rms,
              peak: wavCheck.peak,
              maxFrameRms: wavCheck.maxFrameRms,
            },
          });
        }
      }
    }

    const rawUnheard = this.getUnheardUtterances(cleanCallId, { includeStalePending: false });
    const unheardUtterances = rawUnheard
      .filter((u) => ["turn", "briefing", "approval"].includes(String(u?.source || "turn")))
      .map((u) => ({
        ...u,
        text: stripSpeechNoise(
          String(u.text || "").replace(/\s*另外补播刚才未听到的提醒：[\s\S]*$/, "").trim(),
          140,
        ),
      }))
      .filter((u) => Boolean(u.text));
    const unheardById = new Map(rawUnheard.map((u) => [u.utteranceId, u]));
    const lastUtterance = [...callState.utterances].reverse().find((u) => String(u?.text || "").trim()) || null;

    let heard = cleanTranscript;
    let engineLabel = "";
    const overlapMs = Math.max(0, Math.round(Number(overlapDurationMs) || 0));
    const cleanOverlapBotText = String(overlapBotText || "").trim();
    const snapshotPromise = effectiveScope === "thread"
      ? this.buildThreadScopedSnapshot({ activeThreadId: effectiveThreadId, callId: cleanCallId })
      : this.buildLiveSnapshot({ activeThreadId: effectiveThreadId, callId: cleanCallId });
    const asrStartedAt = Date.now();
    const asrPromise = (cleanAudio && !heard && (!isMockAgy || hasExplicitAsrBin))
      ? this.transcribeAudio({
        audioBase64: cleanAudio,
        audioMimeType,
        overlapMs,
        promptHints: await this.getAsrPromptHints({ pendingSnapshot: snapshotPromise }),
      })
      : Promise.resolve(null);

    const [snapshot, asr] = await Promise.all([snapshotPromise, asrPromise]);
    const asrMs = asr ? Math.max(0, Date.now() - asrStartedAt) : 0;
    let duringPlaybackText = "";
    let afterPlaybackText = "";
    if (asr) {
      heard = String(asr.text || "").trim();
      duringPlaybackText = String(asr.duringPlaybackText || "").trim();
      afterPlaybackText = String(asr.afterPlaybackText || "").trim();
      engineLabel = asr.engine || "";
      if (!heard && mode !== "briefing") return buildLocalNoSpeechPayload({
        silenceReason: asr.silenceReason || "empty_transcript", model: engineLabel,
        localAudioFiltered: Boolean(asr.localAudioFiltered), pendingCount: snapshot.pendingRequests.length,
        liveProjectCount: snapshot.projects.filter((p) => p.liveCount > 0).length,
      });
    }
    const speechTiming = (overlapMs > 0 || duringPlaybackText)
      ? {
          overlapDurationMs: overlapMs,
          overlapBotText: cleanOverlapBotText,
          duringPlaybackText: duringPlaybackText || (overlapMs > 0 ? heard : ""),
          afterPlaybackText,
        }
      : null;

    const isThreadScoped = effectiveScope === "thread" && snapshot.callScope === "thread" && Boolean(snapshot.activeThreadId);
    const shortcutPlan = (isThreadScoped && mode !== "briefing")
      ? matchDeterministicThreadShortcut(heard, snapshot)
      : null;

    let plan;
    let model = "local-shortcut";
    let llmMs = 0;
    if (shortcutPlan) {
      plan = shortcutPlan;
    } else {
      const llmStartedAt = Date.now();
      const target = await this.resolveVoiceTarget({ callId: cleanCallId });
      callState.resolvedTarget = target;
      const promptText = isThreadScoped
        ? this.#buildThreadScopedCoordinatorPrompt({
          snapshot,
          transcriptText: heard,
          mode,
          unheardUtterances,
          lastUtterance,
          speechTiming,
        })
        : this.#buildCoordinatorPrompt({
          snapshot,
          transcriptText: heard,
          mode,
          unheardUtterances,
          lastUtterance,
          speechTiming,
        });
      let rawResponse = "";
      try {
        rawResponse = await this.#runVoiceCoordinator({ callId: cleanCallId, target, promptText });
        plan = isThreadScoped
          ? parseThreadScopedCoordinatorJson(rawResponse, heard, {
            activeThreadId: snapshot.activeThreadId,
            activeProjectCwd: snapshot.activeProjectCwd,
            defaultRequestId: snapshot.pendingRequests?.[0]?.requestId || "",
          })
          : parseCoordinatorJson(rawResponse, heard);
        llmMs = Math.max(0, Date.now() - llmStartedAt);
      } catch (err) {
        llmMs = Math.max(0, Date.now() - llmStartedAt);
        this.#appendVoiceDiagLog({
          type: "turn_error",
          callId: cleanCallId,
          callScope: effectiveScope,
          heardText: heard.slice(0, 120),
          asrEngine: engineLabel,
          asrMs,
          llmMs,
          model: target.model,
          error: err?.message || "语音协调失败",
          rawSnippet: String(rawResponse || "").slice(0, 280),
        });
        throw err;
      }
      model = target.model;
    }
    const usedFallback = false;

    if (plan?.noSpeech || plan?.intent === "no_speech") {
      return buildLocalNoSpeechPayload({
        silenceReason: plan.silenceReason || "no_speech",
        ignoredText: heard,
        model,
        usedFallback,
        localAudioFiltered: false,
        pendingCount: snapshot.pendingRequests.length,
        liveProjectCount: snapshot.projects.filter((p) => p.liveCount > 0).length,
      });
    }

    const executionTier = plan.executionTier;
    const utteranceId = `utt-${randomUUID().slice(0, 10)}`;
    let executed = { ok: true, action: plan.intent, executionTier, summaryTag: "" };
    let pendingDispatchStart = null;
    let batchId = "";

    if (autoExecute && !usedFallback) {
      const prepared = this.#prepareDispatchAction(plan, snapshot, { activeThreadId: effectiveThreadId, callId: cleanCallId });
      if (asyncDispatch || prepared.alwaysAsync) {
        if (!prepared.needsBackground) {
          executed = prepared.immediateResult;
          if (executed.overrideReply) {
            plan.spokenReply = executed.overrideReply;
          }
        } else {
          batchId = `batch-${randomUUID().slice(0, 10)}`;
          if (prepared.pendingMeta?.ackReply && (!plan.spokenReply || prepared.pendingMeta?.action === "subagent_hydrogen")) {
            plan.spokenReply = prepared.pendingMeta.ackReply;
          }
          executed = {
            ok: true,
            pending: true,
            batchId,
            action: prepared.pendingMeta.action,
            executionTier: prepared.pendingMeta.executionTier || executionTier,
            ...(prepared.pendingMeta.provider ? { provider: prepared.pendingMeta.provider } : {}),
            dispatchMode: prepared.pendingMeta.dispatchMode || "",
            immediate: Boolean(prepared.pendingMeta.immediate),
            focusThreadId: prepared.pendingMeta.focusThreadId,
            focusProjectCwd: prepared.pendingMeta.focusProjectCwd,
            summaryTag: prepared.pendingMeta.summaryTag,
          };
          pendingDispatchStart = {
            callId: cleanCallId,
            batchId,
            utteranceId,
            pendingMeta: prepared.pendingMeta,
            execute: prepared.execute,
          };
        }
      } else {
        try {
          executed = prepared.needsBackground
            ? await prepared.execute({ callId: cleanCallId })
            : prepared.immediateResult;
          if (executed.overrideReply) {
            plan.spokenReply = executed.overrideReply;
          }
        } catch (error) {
          executed = {
            ok: false,
            action: plan.intent,
            executionTier,
            error: error?.message || "执行调度失败",
            summaryTag: "执行失败",
          };
          plan.spokenReply = `操作未成功：${stripSpeechNoise(error?.message || "请稍后再试", 120)}`;
        }
      }
    }

    let replacesUtteranceIds = [];
    if (plan.intent === "repeat_last") {
      replacesUtteranceIds = rawUnheard.map((u) => u.utteranceId);
      for (const u of rawUnheard) {
        u.compensatedInTurn = true;
      }
    } else if (unheardUtterances.length > 0 && !shortcutPlan) {
      replacesUtteranceIds = unheardUtterances.map((u) => u.utteranceId);
      for (const u of unheardUtterances) {
        const orig = unheardById.get(u.utteranceId);
        if (orig) orig.compensatedInTurn = true;
      }
      if (!String(plan.spokenReply || "").trim()) {
        const fallbackMissed = unheardUtterances.find((u) => u.priority === "critical")
          || unheardUtterances[unheardUtterances.length - 1];
        if (fallbackMissed?.text) {
          plan.spokenReply = fallbackMissed.text;
        }
      }
    }

    if (mode !== "briefing" && plan.intent !== "repeat_last") {
      plan.spokenReply = clampVoiceSpokenReply(plan.spokenReply, { maxChars: 60 });
    }

    const utterancePriority = (plan.intent === "approve_request" || (snapshot.pendingRequests?.length > 0 && plan.intent === "summarize_progress"))
      ? "critical"
      : "normal";
    const ttsStartedAt = Date.now();
    const speechResult = tts
      ? await this.synthesizeSpeech({
          text: plan.spokenReply,
          callId: cleanCallId,
          utteranceId,
          source: mode === "briefing" ? "briefing" : "turn",
          priority: utterancePriority,
          register: false,
        })
      : {
          audioBase64: "",
          mimeType: "",
          provider: "none",
          text: plan.spokenReply,
          utteranceId,
          expectedMs: estimateSpeechDurationMs(plan.spokenReply),
        };
    const ttsMs = tts ? Math.max(0, Date.now() - ttsStartedAt) : 0;

    const uttRecord = this.registerUtterance({
      callId: cleanCallId,
      utteranceId: speechResult.utteranceId || utteranceId,
      text: plan.spokenReply,
      source: mode === "briefing" ? "briefing" : "turn",
      intent: plan.intent,
      priority: utterancePriority,
      provider: speechResult.provider,
      replacesUtteranceIds,
    });
    const currentUnheard = this.getUnheardUtterances(cleanCallId);

    if (pendingDispatchStart) {
      this.#startBackgroundDispatchBatch({
        ...pendingDispatchStart,
        utteranceId: uttRecord.utteranceId,
      });
    }

    this.#appendVoiceDiagLog({
      type: "turn_result",
      callId: cleanCallId,
      utteranceId: uttRecord.utteranceId,
      callScope: effectiveScope,
      heardText: String(plan.heardText || "").slice(0, 120),
      intent: plan.intent,
      model,
      asrEngine: cleanAudio ? engineLabel : "",
      asrMs,
      llmMs,
      ttsMs,
      ttsProvider: speechResult.provider,
      ttsBytes: speechResult.audioBase64 ? Buffer.byteLength(speechResult.audioBase64, "base64") : 0,
      spokenReplyLen: String(plan.spokenReply || "").length,
      ...(overlapMs > 0 ? { overlapDurationMs: overlapMs } : {}),
      ...(duringPlaybackText ? { duringPlaybackText: duringPlaybackText.slice(0, 80) } : {}),
      ...(afterPlaybackText ? { afterPlaybackText: afterPlaybackText.slice(0, 80) } : {}),
      dispatchPending: Boolean(pendingDispatchStart),
    });

    return {
      ok: true,
      callId: cleanCallId,
      callScope: effectiveScope,
      model,
      asrEngine: cleanAudio ? engineLabel : "",
      usedFallback,
      heardText: plan.heardText,
      spokenReply: plan.spokenReply,
      utteranceId: uttRecord.utteranceId,
      expectedMs: uttRecord.expectedMs,
      replayedUnheardIds: replacesUtteranceIds,
      unheardCount: currentUnheard.length,
      batchId,
      dispatchPending: Boolean(pendingDispatchStart),
      executionTier: executed?.executionTier || executionTier,
      dispatchMode: executed?.dispatchMode || plan?.dispatchMode || "",
      queued: Boolean(executed?.queued),
      plan,
      executed,
      tts: {
        audioBase64: speechResult.audioBase64,
        mimeType: speechResult.mimeType,
        provider: speechResult.provider,
      },
      snapshotSummary: {
        pendingCount: snapshot.pendingRequests.length,
        liveProjectCount: snapshot.projects.filter((p) => p.liveCount > 0).length,
      },
    };
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
    if (this.#pendingDispatchPromises.size > 0) {
      await Promise.allSettled([...this.#pendingDispatchPromises]);
    }
    this.#calls.clear();
    this.#callStates.clear();
    this.#ttsCache.clear();
    this.#activeSessionTurn.clear();
    this.#activeSubagentSessions.clear();
    for (const waiter of this.#pendingSubagentThreads.values()) {
      waiter.reject(new Error("语音通话服务已关闭"));
    }
    this.#pendingSubagentThreads.clear();
    this.#resetAsrWorker("语音通话服务已关闭");
    this.#resetEdgeTtsWorker("语音通话服务已关闭");
    this.#resetKokoroWorker("语音通话服务已关闭");
    await this.#diagLogQueue;
    if (this.#client) {
      await this.#client.close().catch(() => {});
      this.#client = null;
    }
  }
}
