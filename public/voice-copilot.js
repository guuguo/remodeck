import { isRawToolEchoItem } from "./markdown.js";

export function stripMarkdownForSpeech(input = "", maxChars = 420) {
  let text = String(input || "");
  text = text
    .replace(/<!--\s*GOAL_COMPLETE\s*-->/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/```[\s\S]*?```/g, "，代码部分已省略，")
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

export function base64ToUint8Array(base64) {
  const clean = String(base64 || "").replace(/\s+/g, "");
  if (typeof globalThis.Buffer === "function") {
    return new Uint8Array(globalThis.Buffer.from(clean, "base64"));
  }
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function uint8ArrayToBase64(bytes) {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (typeof globalThis.Buffer === "function") {
    return globalThis.Buffer.from(arr).toString("base64");
  }
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < arr.length; i += chunkSize) {
    binary += String.fromCharCode(...arr.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

export function pcm16Base64ToWavBytes(base64, sampleRate = 24000) {
  const rawPcm = base64ToUint8Array(base64);
  const pcmLength = rawPcm.length - (rawPcm.length % 2);
  const wavBuffer = new ArrayBuffer(44 + pcmLength);
  const view = new DataView(wavBuffer);
  const writeAscii = (offset, str) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcmLength, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, pcmLength, true);

  const out = new Uint8Array(wavBuffer);
  out.set(rawPcm.subarray(0, pcmLength), 44);
  return out;
}

export function computeRmsLevel(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  let validCount = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const raw = Number(samples[i]);
    if (!Number.isFinite(raw)) continue;
    const s = Math.max(-1, Math.min(1, raw));
    sum += s * s;
    validCount += 1;
  }
  if (!validCount) return 0;
  const rms = Math.sqrt(sum / validCount);
  return Number.isFinite(rms) ? Math.min(1, rms) : 0;
}

export function downsampleFloat32ToInt16(float32Samples, inputSampleRate = 48000, targetSampleRate = 16000) {
  if (!float32Samples?.length) return new Int16Array(0);
  const safeSample = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(-1, Math.min(1, n)) : 0;
  };
  if (inputSampleRate <= targetSampleRate) {
    const out = new Int16Array(float32Samples.length);
    for (let i = 0; i < float32Samples.length; i += 1) {
      const clamped = safeSample(float32Samples[i]);
      out[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    }
    return out;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const newLength = Math.floor(float32Samples.length / ratio);
  const out = new Int16Array(newLength);
  let offsetBuffer = 0;
  for (let i = 0; i < newLength; i += 1) {
    const nextOffsetBuffer = Math.min(float32Samples.length, Math.round((i + 1) * ratio));
    let accum = 0;
    let count = 0;
    for (let j = offsetBuffer; j < nextOffsetBuffer; j += 1) {
      accum += safeSample(float32Samples[j]);
      count += 1;
    }
    const avg = count > 0 ? accum / count : safeSample(float32Samples[offsetBuffer]);
    const clamped = Math.max(-1, Math.min(1, avg));
    out[i] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    offsetBuffer = nextOffsetBuffer;
  }
  return out;
}

export function encodePcm16SamplesToWav(int16Samples, sampleRate = 16000) {
  const samples = int16Samples instanceof Int16Array ? int16Samples : new Int16Array(int16Samples || []);
  const pcmBytesLen = samples.length * 2;
  const buf = new ArrayBuffer(44 + pcmBytesLen);
  const view = new DataView(buf);
  const writeAscii = (offset, str) => {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };
  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + pcmBytesLen, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, pcmBytesLen, true);
  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    view.setInt16(offset, samples[i], true);
    offset += 2;
  }
  return new Uint8Array(buf);
}

function concatInt16Chunks(chunks = []) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const merged = new Int16Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.length;
  }
  return merged;
}

// Hands-free call / drive mode: tolerate mid-sentence pauses (people think while driving) and long instructions.
export const CALL_VOICE_VAD_OPTIONS = Object.freeze({
  sampleRate: 16000,
  preRollMs: 600,
  silenceMs: 1600,
  minSpeechMs: 260,
  maxSpeechMs: 30000,
  rmsThreshold: 0.009,
  adaptive: true,
  requireSustainedOnset: true,
  minPeakRms: 0.010,
  minSnrRatio: 1.35,
});

// Merge voice turns that queued up while the previous turn was still processing, so nothing is dropped.
export function mergeQueuedVoiceTurns(turns = [], { gapSamples = 2560 } = {}) {
  const list = Array.isArray(turns) ? turns.filter(Boolean) : [];
  if (list.length <= 1) return list.slice();
  const out = [];
  let audioRun = [];
  const flushAudio = () => {
    if (!audioRun.length) return;
    if (audioRun.length === 1) {
      out.push(audioRun[0]);
    } else {
      out.push({
        ...audioRun[0],
        samples: mergePcm16ChunksWithGap(audioRun.map((t) => t.samples), gapSamples),
        overlapDurationMs: audioRun[0].overlapDurationMs || 0,
        mergedCount: audioRun.length,
      });
    }
    audioRun = [];
  };
  for (const turn of list) {
    if (turn.samples?.length && turn.mode !== "briefing" && !String(turn.transcriptText || "").trim()) {
      audioRun.push(turn);
    } else {
      flushAudio();
      out.push(turn);
    }
  }
  flushAudio();
  return out;
}

export function createVadTurnDetector({
  sampleRate = 16000,
  preRollMs = 320,
  silenceMs = 1050,
  minSpeechMs = 340,
  maxSpeechMs = 22000,
  rmsThreshold = 0.018,
  adaptive = false,
  requireSustainedOnset = false,
  minPeakRms = 0,
  minSnrRatio = 0,
} = {}) {
  const preRollLimit = Math.max(0, Math.round((sampleRate * preRollMs) / 1000));
  const silenceLimit = Math.max(sampleRate * 0.25, Math.round((sampleRate * silenceMs) / 1000));
  const minSpeechLimit = Math.max(sampleRate * 0.12, Math.round((sampleRate * minSpeechMs) / 1000));
  const maxSpeechLimit = Math.max(sampleRate * 2, Math.round((sampleRate * maxSpeechMs) / 1000));
  const triggerHoldSamples = Math.round((sampleRate * 110) / 1000);

  let preRollChunks = [];
  let preRollSamples = 0;
  let speechChunks = [];
  let speechSamples = 0;
  let voicedSamples = 0;
  let silenceSamples = 0;
  let revoiceSamples = 0;
  let currentContiguousVoiced = 0;
  let maxContiguousVoicedSamples = 0;
  let candidateOnsetSamples = 0;
  let peakVoicedRms = 0;
  let voicedRmsSum = 0;
  let voicedChunkCount = 0;
  let inSpeech = false;
  let noiseFloorRms = 0.004;
  const effectiveTriggerHoldSamples = Math.round((sampleRate * (requireSustainedOnset ? 150 : 110)) / 1000);
  const revoiceHoldSamples = Math.round((sampleRate * 100) / 1000);

  const currentOnsetThreshold = () => {
    if (!adaptive) return rmsThreshold;
    const minAdaptiveFloor = requireSustainedOnset ? Math.max(0.008, rmsThreshold * 0.72) : Math.max(0.007, rmsThreshold * 0.6);
    const snrMult = requireSustainedOnset ? 1.8 : 2.4;
    const cap = requireSustainedOnset ? 0.018 : 0.04;
    return Math.max(minAdaptiveFloor, Math.min(cap, Math.max(minAdaptiveFloor, noiseFloorRms * snrMult)));
  };

  const currentHoldThreshold = () => {
    if (!adaptive) return rmsThreshold;
    const baseHold = Math.max(requireSustainedOnset ? 0.0065 : 0.0055, currentOnsetThreshold() * 0.68);
    if (inSpeech && peakVoicedRms > 0.12) {
      return Math.max(baseHold, Math.min(0.045, peakVoicedRms * 0.12));
    }
    return baseHold;
  };

  const reset = () => {
    preRollChunks = [];
    preRollSamples = 0;
    speechChunks = [];
    speechSamples = 0;
    voicedSamples = 0;
    silenceSamples = 0;
    revoiceSamples = 0;
    currentContiguousVoiced = 0;
    maxContiguousVoicedSamples = 0;
    candidateOnsetSamples = 0;
    peakVoicedRms = 0;
    voicedRmsSum = 0;
    voicedChunkCount = 0;
    inSpeech = false;
  };

  const pushPreRoll = (chunk) => {
    preRollChunks.push(chunk);
    preRollSamples += chunk.length;
    while (preRollSamples > preRollLimit && preRollChunks.length > 1) {
      const removed = preRollChunks.shift();
      preRollSamples -= removed.length;
    }
  };

  const emitUtterance = (minSamplesRequired = minSpeechLimit) => {
    const merged = concatInt16Chunks(speechChunks);
    const hadEnoughSpeech = voicedSamples >= minSamplesRequired;
    const avgVoicedRms = voicedChunkCount > 0 ? voicedRmsSum / voicedChunkCount : 0;
    const failsPeak = minPeakRms > 0 && peakVoicedRms < minPeakRms;
    const failsSnr = minSnrRatio > 0
      && noiseFloorRms > 0
      && peakVoicedRms < noiseFloorRms * minSnrRatio
      && avgVoicedRms < noiseFloorRms * minSnrRatio;
    const failsTransient = requireSustainedOnset && (
      maxContiguousVoicedSamples < Math.min(minSamplesRequired, Math.round(sampleRate * 0.16))
    );
    reset();
    if (!merged.length || !hadEnoughSpeech) {
      return { type: "discarded_short", samples: new Int16Array(0), reason: "too_short" };
    }
    if (failsTransient) {
      return { type: "discarded_noise", samples: new Int16Array(0), reason: "transient_noise" };
    }
    if (failsPeak || failsSnr) {
      return { type: "discarded_noise", samples: new Int16Array(0), reason: "low_energy_noise" };
    }
    return { type: "utterance", samples: merged };
  };

  return {
    get isSpeaking() {
      return inSpeech;
    },
    get bufferedSamples() {
      return speechSamples;
    },
    get noiseFloor() {
      return noiseFloorRms;
    },
    get threshold() {
      return inSpeech ? currentHoldThreshold() : currentOnsetThreshold();
    },
    reset,
    flush() {
      if (!inSpeech || !speechChunks.length) {
        reset();
        return { type: "idle", samples: new Int16Array(0) };
      }
      return emitUtterance(Math.round(sampleRate * 0.14));
    },
    pushSamples(int16Chunk, rawRms = 0) {
      const rms = Number.isFinite(Number(rawRms)) ? Math.max(0, Math.min(1, Number(rawRms))) : 0;
      if (!int16Chunk?.length) return { type: "idle", rms };
      const onsetThreshold = currentOnsetThreshold();
      const active = rms >= (inSpeech ? currentHoldThreshold() : onsetThreshold);

      if (!inSpeech) {
        if (adaptive && !active) {
          noiseFloorRms = Math.min(0.014, noiseFloorRms * 0.96 + rms * 0.04);
        }
        pushPreRoll(int16Chunk);
        if (active) {
          candidateOnsetSamples += int16Chunk.length;
          const strongSpikeBypass = requireSustainedOnset ? false : rms >= onsetThreshold * 1.45;
          if (candidateOnsetSamples >= effectiveTriggerHoldSamples || strongSpikeBypass) {
            inSpeech = true;
            speechChunks = [...preRollChunks];
            speechSamples = preRollSamples;
            voicedSamples = candidateOnsetSamples;
            currentContiguousVoiced = candidateOnsetSamples;
            maxContiguousVoicedSamples = candidateOnsetSamples;
            silenceSamples = 0;
            revoiceSamples = 0;
            candidateOnsetSamples = 0;
            peakVoicedRms = rms;
            voicedRmsSum = rms;
            voicedChunkCount = 1;
            preRollChunks = [];
            preRollSamples = 0;
            return { type: "speech_start", rms, bufferedSamples: speechSamples };
          }
        } else {
          candidateOnsetSamples = 0;
        }
        return { type: "listening", rms };
      }

      speechChunks.push(int16Chunk);
      speechSamples += int16Chunk.length;
      if (active) {
        currentContiguousVoiced += int16Chunk.length;
        if (currentContiguousVoiced > maxContiguousVoicedSamples) {
          maxContiguousVoicedSamples = currentContiguousVoiced;
        }
        if (silenceSamples === 0) {
          voicedSamples += int16Chunk.length;
          if (rms > peakVoicedRms) peakVoicedRms = rms;
          voicedRmsSum += rms;
          voicedChunkCount += 1;
        } else {
          revoiceSamples += int16Chunk.length;
          if (revoiceSamples >= revoiceHoldSamples) {
            voicedSamples += revoiceSamples;
            silenceSamples = 0;
            revoiceSamples = 0;
            if (rms > peakVoicedRms) peakVoicedRms = rms;
            voicedRmsSum += rms;
            voicedChunkCount += 1;
          } else {
            silenceSamples += int16Chunk.length;
          }
        }
      } else {
        currentContiguousVoiced = 0;
        revoiceSamples = 0;
        silenceSamples += int16Chunk.length;
      }

      if (speechSamples >= maxSpeechLimit || silenceSamples >= silenceLimit) {
        return emitUtterance(minSpeechLimit);
      }
      return { type: "recording", rms, bufferedSamples: speechSamples };
    },
  };
}

export function mergePcm16ChunksWithGap(chunks = [], gapSamples = 2560) {
  const valid = (Array.isArray(chunks) ? chunks : []).filter((c) => c && c.length > 0);
  if (!valid.length) return new Int16Array(0);
  if (valid.length === 1) return valid[0];
  const gap = Math.max(0, Math.floor(Number(gapSamples) || 0));
  let total = 0;
  for (let i = 0; i < valid.length; i += 1) {
    total += valid[i].length;
    if (i < valid.length - 1) total += gap;
  }
  const out = new Int16Array(total);
  let offset = 0;
  for (let i = 0; i < valid.length; i += 1) {
    out.set(valid[i], offset);
    offset += valid[i].length;
    if (i < valid.length - 1 && gap > 0) {
      offset += gap;
    }
  }
  return out;
}

export function pickPreferredChineseSpeechVoice(voices = []) {
  const zhVoices = (voices || []).filter((v) => /zh|cmn|chinese/i.test(v?.lang || ""));
  if (!zhVoices.length) return null;
  const preferredOrder = [
    (v) => /tingting|meijia|sinji|xiaoxiao|yunxi|yunjian|enhanced|premium|natural|neural/i.test(v?.name || ""),
    (v) => /zh[-_]?cn/i.test(v?.lang || ""),
  ];
  for (const matcher of preferredOrder) {
    const hit = zhVoices.find(matcher);
    if (hit) return hit;
  }
  return zhVoices[0];
}

export function estimateVoiceDurationMs(text = "") {
  const clean = stripMarkdownForSpeech(text, 360);
  if (!clean) return 0;
  const hanCount = (clean.match(/\p{Script=Han}/gu) || []).length;
  const wordCount = (clean.match(/[A-Za-z0-9_]+/g) || []).length;
  const punctCount = (clean.match(/[，。！？；：,.!?;:]/g) || []).length;
  const rawMs = 240 + hanCount * 205 + wordCount * 290 + punctCount * 160;
  return Math.max(600, Math.min(45_000, Math.round(rawMs)));
}

export function minVoiceAudibleMs(text = "") {
  const clean = stripMarkdownForSpeech(text, 360);
  if (!clean) return 0;
  return Math.max(180, Math.min(1100, Math.round(estimateVoiceDurationMs(clean) * 0.22)));
}

export function normalizeVoiceTtsPayload(raw = null) {
  const src = raw && typeof raw === "object" ? raw : {};
  const ttsObj = src.tts && typeof src.tts === "object" ? src.tts : src;
  const audioBase64 = String(ttsObj.audioBase64 || src.audioBase64 || "").trim();
  const mimeType = String(ttsObj.mimeType || src.mimeType || "").trim();
  const provider = String(ttsObj.provider || src.provider || "").trim() || "none";
  const utteranceId = String(src.utteranceId || ttsObj.utteranceId || "").trim();
  const text = String(ttsObj.text || src.text || src.spokenReply || "").trim();
  const rawExpected = Number(ttsObj.expectedMs || src.expectedMs) || 0;
  const expectedMs = rawExpected > 0 ? rawExpected : estimateVoiceDurationMs(text);
  const hasAudio = Boolean(audioBase64 && audioBase64.length > 16);
  return {
    hasAudio,
    audioBase64,
    mimeType,
    provider,
    utteranceId,
    expectedMs,
    text,
  };
}

export const CHAT_REPLY_TTS_STORAGE_KEY = "agentControl.chatReplyTts.v1";

export function loadChatReplyTtsPref(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    if (!storage) return { enabled: false };
    const raw = JSON.parse(storage.getItem(CHAT_REPLY_TTS_STORAGE_KEY) || "null");
    return { enabled: Boolean(raw?.enabled) };
  } catch {
    return { enabled: false };
  }
}

export function saveChatReplyTtsPref(enabled, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  const next = { enabled: Boolean(enabled) };
  try {
    storage?.setItem(CHAT_REPLY_TTS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors cleanly.
  }
  return next;
}

export function extractFinalAssistantMessageFromTurns(turns = [], fallbackText = "") {
  const list = Array.isArray(turns) ? turns : [];
  if (list.length) {
    const lastTurn = list[list.length - 1];
    const turnId = String(lastTurn?.id || "");
    const items = Array.isArray(lastTurn?.items) ? lastTurn.items : [];
    let commentaryFallback = "";
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const item = items[i];
      if (!item || item.type !== "agentMessage" || isRawToolEchoItem(item)) continue;
      const txt = String(item.text || "").trim();
      if (!txt) continue;
      if (item.phase !== "commentary") {
        return { turnId, text: txt };
      }
      if (!commentaryFallback) {
        commentaryFallback = txt;
      }
    }
    const cleanFallback = String(fallbackText || "").trim();
    if (cleanFallback) {
      return { turnId, text: cleanFallback };
    }
    if (commentaryFallback) {
      return { turnId, text: commentaryFallback };
    }
    return { turnId, text: "" };
  }
  return { turnId: "", text: String(fallbackText || "").trim() };
}

const SUMMARY_HEADING_RE = /^(?:#{1,6}\s*|\*\*|【)?\s*(?:总结|小结|结论|完成情况|完成汇总|修改汇总|变更摘要|最终结果|处理结果|Summary|Conclusion|Takeaway|Final\s+Result|Overview)\s*(?:】|\*\*)?\s*[:：]?\s*(.*)$/i;

function trimFromCleanSentenceStart(text = "", maxChars = 260) {
  const clean = String(text || "").trim();
  if (clean.length <= maxChars) return clean;
  const tailWindow = clean.slice(-maxChars);
  const match = tailWindow.match(/[。！？；.!?\n]\s*(.+)$/);
  if (match?.[1] && match[1].trim().length >= Math.min(48, Math.floor(maxChars * 0.25))) {
    return match[1].trim();
  }
  return tailWindow.trim();
}

export function extractReplyClosingSummaryForSpeech(rawInput = "", { maxChars = 260, minTailChars = 80 } = {}) {
  const raw = String(rawInput || "")
    .replace(/<!--[\s\S]*?-->/g, "\n")
    .replace(/```[\s\S]*?```/g, "\n")
    .replace(/^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{0,}:?\s*$/gm, "")
    .trim();
  if (!raw) return "";

  const lines = raw.split(/\r?\n/);
  let lastSummaryLineIdx = -1;
  let inlineSummaryLead = "";
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) continue;
    const m = trimmed.match(SUMMARY_HEADING_RE);
    if (m) {
      // Only treat bare words like "总结" as a section header when it really looks like a heading/bold/colon marker
      const hasMarker = /^(?:#{1,6}\s|\*\*|【)/.test(trimmed) || /[:：]/.test(trimmed) || trimmed.length <= 8;
      if (hasMarker) {
        lastSummaryLineIdx = i;
        inlineSummaryLead = String(m[1] || "").trim();
      }
    }
  }

  if (lastSummaryLineIdx >= 0) {
    const restLines = [
      ...(inlineSummaryLead ? [inlineSummaryLead] : []),
      ...lines.slice(lastSummaryLineIdx + 1),
    ];
    const summaryText = stripMarkdownForSpeech(restLines.join("\n"), maxChars);
    if (summaryText) return summaryText;
  }

  const rawBlocks = raw
    .split(/\n{2,}/)
    .map((block) => stripMarkdownForSpeech(block, maxChars * 2))
    .map((s) => s.replace(/^，?代码部分已省略，?$/g, "").trim())
    .filter(Boolean);

  if (!rawBlocks.length) {
    return stripMarkdownForSpeech(raw, maxChars);
  }

  const fullJoined = rawBlocks.join(" ");
  if (fullJoined.length <= maxChars) {
    return fullJoined;
  }

  const picked = [];
  let totalLen = 0;
  for (let i = rawBlocks.length - 1; i >= 0; i -= 1) {
    const block = rawBlocks[i];
    const nextLen = totalLen ? totalLen + 1 + block.length : block.length;
    if (nextLen > maxChars && totalLen >= minTailChars) {
      break;
    }
    picked.unshift(block);
    totalLen = nextLen;
    if (totalLen >= maxChars) break;
  }

  const tailJoined = picked.join(" ").trim();
  if (tailJoined.length <= maxChars) {
    return tailJoined;
  }
  return trimFromCleanSentenceStart(tailJoined, maxChars);
}

export function resolveHoldTalkGestureState({
  active = false,
  transcribing = false,
  cancelArmed = false,
  isSubmitting = false,
} = {}) {
  if (transcribing || isSubmitting) {
    return {
      stateKey: "transcribing",
      label: "正在识别并发送…",
      isDanger: false,
      isBusy: true,
      disabled: true,
    };
  }
  if (active && cancelArmed) {
    return {
      stateKey: "cancel",
      label: "松开手指 取消发送",
      isDanger: true,
      isBusy: false,
      disabled: false,
    };
  }
  if (active) {
    return {
      stateKey: "recording",
      label: "松开 发送（上滑取消）",
      isDanger: false,
      isBusy: false,
      disabled: false,
    };
  }
  return {
    stateKey: "idle",
    label: "按住 说话",
    isDanger: false,
    isBusy: false,
    disabled: false,
  };
}
