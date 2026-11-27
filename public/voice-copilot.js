import { iconSvg, providerIconSvg } from "./icons.js";
import { compactEffortBadgeLabel, providerVisualMeta } from "./instance-switcher.js";
import { humanizeLiveActivity } from "./live-state.js";
import { escapeHtml, isRawToolEchoItem } from "./markdown.js";

export const VOICE_CONFIG_STORAGE_KEY = "agentControl.voiceCallPrefs.v2";

export const DEFAULT_VOICE_CONFIG = Object.freeze({
  autoBroadcastEvents: true,
  handsFreeVad: true,
  preferredModelKey: "auto",
});

export function normalizeVoiceConfig(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const savedKey = String(src.preferredModelKey || "").trim();
  const preferredModelKey = savedKey === "local" || savedKey === "local:local-rules" ? "auto" : (savedKey || "auto");
  return {
    autoBroadcastEvents: src.autoBroadcastEvents !== false,
    handsFreeVad: src.handsFreeVad !== false,
    preferredModelKey,
  };
}

export function parseVoiceModelSelectionKey(selectionKey = "auto") {
  const key = String(selectionKey || "").trim();
  if (!key || ["auto", "local", "local:local-rules"].includes(key)) {
    return { key: "auto", voiceProvider: "auto", voiceProfileId: "", voiceModel: "" };
  }
  const firstColon = key.indexOf(":");
  if (firstColon < 0) {
    return { key, voiceProvider: key, voiceProfileId: "", voiceModel: "" };
  }
  const provider = key.slice(0, firstColon).trim();
  const rest = key.slice(firstColon + 1);
  const secondColon = rest.indexOf(":");
  if (secondColon < 0) {
    return { key, voiceProvider: provider, voiceProfileId: "", voiceModel: rest.trim() };
  }
  return {
    key,
    voiceProvider: provider,
    voiceProfileId: rest.slice(0, secondColon).trim(),
    voiceModel: rest.slice(secondColon + 1).trim(),
  };
}

export function renderVoiceModelSelectOptionsHtml(options = [], selectedKey = "auto") {
  const list = Array.isArray(options) && options.length
    ? options
    : [
        { key: "auto", label: "自动优选轻量模型" },
      ];
  const hasSelected = list.some((opt) => opt.key === selectedKey);
  const effectiveKey = hasSelected ? selectedKey : list[0].key;
  return list.map((opt) => {
    const sel = opt.key === effectiveKey ? " selected" : "";
    const title = opt.description ? ` title="${escapeHtml(opt.description)}"` : "";
    return `<option value="${escapeHtml(opt.key)}"${sel}${title}>${escapeHtml(opt.label || opt.key)}</option>`;
  }).join("");
}

export function loadVoiceConfig(storage = typeof localStorage !== "undefined" ? localStorage : null) {
  try {
    if (!storage) return { ...DEFAULT_VOICE_CONFIG };
    const raw = storage.getItem(VOICE_CONFIG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_CONFIG };
    return normalizeVoiceConfig(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_VOICE_CONFIG };
  }
}

export function saveVoiceConfig(patch = {}, storage = typeof localStorage !== "undefined" ? localStorage : null) {
  const next = normalizeVoiceConfig({ ...loadVoiceConfig(storage), ...patch });
  try {
    storage?.setItem(VOICE_CONFIG_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors cleanly.
  }
  return next;
}

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

export function buildLocalProgressBriefing({
  groups = [],
  activeThread = null,
  pendingRequests = [],
} = {}) {
  const parts = [];
  if (pendingRequests.length) {
    const first = pendingRequests[0];
    parts.push(`当前有 ${pendingRequests.length} 个任务等待你确认。第一条是：${stripMarkdownForSpeech(first.title || first.command || "权限审批", 80)}。`);
  }

  const runningGroups = (groups || []).filter((g) => g.liveCount > 0);
  const pinnedGroups = (groups || []).filter((g) => g.pinned);
  const focusList = [];
  const seen = new Set();
  for (const g of [...runningGroups, ...pinnedGroups]) {
    if (seen.has(g.cwd)) continue;
    seen.add(g.cwd);
    focusList.push(g);
    if (focusList.length >= 4) break;
  }

  if (focusList.length) {
    const summaries = focusList.map((g) => {
      const topThread = g.threads[0];
      const status = g.pendingCount > 0
        ? "等待你确认"
        : g.liveCount > 0
          ? `${g.liveCount} 个任务正在执行`
          : "当前空闲";
      const snippet = topThread ? stripMarkdownForSpeech(topThread.preview || topThread.title, 70) : "";
      return `${g.name}${status}${snippet ? `，最新进展是：${snippet}` : ""}`;
    });
    parts.push(summaries.join("；") + "。");
  } else if (groups.length) {
    const top = groups[0];
    parts.push(`最近活跃项目是 ${top.name}，共 ${top.threads.length} 个会话。`);
  }

  if (activeThread) {
    const turns = Array.isArray(activeThread.turns) ? activeThread.turns : [];
    let latestReply = "";
    for (let i = turns.length - 1; i >= 0 && !latestReply; i -= 1) {
      const items = Array.isArray(turns[i]?.items) ? turns[i].items : [];
      let fallbackCommentary = "";
      for (let j = items.length - 1; j >= 0; j -= 1) {
        const item = items[j];
        if (!item || item.type !== "agentMessage" || !item.text || isRawToolEchoItem(item)) continue;
        if (item.phase !== "commentary") {
          latestReply = stripMarkdownForSpeech(item.text, 140);
          break;
        }
        if (!fallbackCommentary) {
          fallbackCommentary = stripMarkdownForSpeech(item.text, 140);
        }
      }
      if (!latestReply && fallbackCommentary) {
        latestReply = fallbackCommentary;
      }
    }
    if (latestReply) {
      parts.push(`当前打开的对话《${stripMarkdownForSpeech(activeThread.title || "当前任务", 36)}》最新回复是：${latestReply}`);
    }
  }

  if (!parts.length) {
    return "目前没有检测到活跃或待确认的智能体任务，你可以随时说项目名称来打开对话或新建任务。";
  }
  return parts.join(" ");
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

export function formatCallDuration(totalSeconds = 0) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const rem = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  return hrs > 0 ? `${hrs}:${pad(mins)}:${pad(rem)}` : `${pad(mins)}:${pad(rem)}`;
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

export function evaluateVoicePlaybackOutcome({
  outcome = "ended",
  text = "",
  playedMs = 0,
  expectedMs = 0,
  started = false,
  muted = false,
  volume = 1,
  reason = "",
  priority = "normal",
} = {}) {
  const cleanPlayedMs = Math.max(0, Math.round(Number(playedMs) || 0));
  const effExpectedMs = Math.max(Number(expectedMs) || 0, estimateVoiceDurationMs(text));
  const minAudible = minVoiceAudibleMs(text);
  const cleanReason = String(reason || "").trim();

  if (muted || Number(volume) <= 0.01) {
    return {
      status: "unheard",
      heard: false,
      reason: "muted_output",
      playedMs: cleanPlayedMs,
      expectedMs: effExpectedMs,
    };
  }

  if (outcome === "interrupted") {
    const ratio = effExpectedMs > 0 ? cleanPlayedMs / effExpectedMs : 0;
    if (cleanReason === "user_barge_in" && started && ratio >= 0.45 && priority !== "critical") {
      return {
        status: "interrupted",
        heard: true,
        reason: cleanReason,
        playedMs: cleanPlayedMs,
        expectedMs: effExpectedMs,
      };
    }
    return {
      status: "interrupted",
      heard: false,
      reason: cleanReason || "interrupted_early",
      playedMs: cleanPlayedMs,
      expectedMs: effExpectedMs,
    };
  }

  if (outcome !== "ended") {
    return {
      status: "unheard",
      heard: false,
      reason: cleanReason || "playback_failed",
      playedMs: cleanPlayedMs,
      expectedMs: effExpectedMs,
    };
  }

  if (!started || cleanPlayedMs < minAudible) {
    return {
      status: "unheard",
      heard: false,
      reason: "fake_short_end",
      playedMs: cleanPlayedMs,
      expectedMs: effExpectedMs,
    };
  }

  return {
    status: "played",
    heard: true,
    reason: "",
    playedMs: cleanPlayedMs,
    expectedMs: effExpectedMs,
  };
}

export function humanizeVoiceDeliveryReason(reason = "") {
  const r = String(reason || "").trim();
  if (r === "autoplay_blocked") return "自动播放受限";
  if (r === "muted_output") return "静音未出声";
  if (r === "fake_short_end") return "未正常出声";
  if (r === "stalled" || r === "speech_timeout") return "播报超时中断";
  if (r === "speech_unavailable") return "无可用语音引擎";
  if (r === "interrupted_early" || r === "superseded" || r === "user_barge_in") return "未播完";
  return "语音未播成";
}

export function enqueueVoiceBroadcastItem(queue = [], item = {}, maxItems = 8) {
  const list = Array.isArray(queue) ? queue.map((x) => ({ ...x })) : [];
  const cleanText = stripMarkdownForSpeech(item?.text || "", 300);
  if (!cleanText) return list;
  const priority = item?.priority === "critical" ? "critical" : "normal";
  const dedupeKey = String(item?.dedupeKey || "").trim();
  const entry = {
    id: String(item?.id || "").trim() || `notice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    text: cleanText,
    priority,
    source: String(item?.source || "notice").trim() || "notice",
    actionTag: String(item?.actionTag || "实时提醒").trim() || "实时提醒",
    dedupeKey,
    createdAt: Number(item?.createdAt) || Date.now(),
  };

  const existingIdx = dedupeKey ? list.findIndex((x) => x.dedupeKey === dedupeKey) : -1;
  if (existingIdx >= 0) {
    list[existingIdx] = {
      ...list[existingIdx],
      ...entry,
      createdAt: list[existingIdx].createdAt,
    };
  } else {
    list.push(entry);
  }

  const critical = list.filter((x) => x.priority === "critical");
  const normal = list.filter((x) => x.priority !== "critical");
  return [...critical, ...normal].slice(0, Math.max(1, Number(maxItems) || 8));
}

export function buildVoiceLiveProgressItems({
  groups = [],
  threads = [],
  pendingRequests = [],
  liveActivityByThread = new Map(),
  recentCompletedByThread = new Map(),
  activeThreadId = "",
  nowMs = Date.now(),
  maxItems = 6,
} = {}) {
  const groupByCwd = new Map((groups || []).map((g) => [g.cwd, g]));
  const threadList = threads?.length ? threads : (groups || []).flatMap((g) => g.threads || []);
  const reqByThread = new Map();
  for (const req of pendingRequests || []) {
    if (!req?.threadId || reqByThread.has(req.threadId)) continue;
    reqByThread.set(req.threadId, req);
  }

  const scored = [];
  const seenThread = new Set();
  for (const t of threadList) {
    if (!t?.id || seenThread.has(t.id)) continue;
    seenThread.add(t.id);
    const group = groupByCwd.get(t.cwd);
    const pendingReq = reqByThread.get(t.id) || null;
    const liveEntry = liveActivityByThread?.get ? liveActivityByThread.get(t.id) : null;
    const doneEntry = recentCompletedByThread?.get ? recentCompletedByThread.get(t.id) : null;
    const recentDone = Boolean(doneEntry && nowMs - (doneEntry.at || 0) <= 5 * 60 * 1000);

    const isPending = Boolean(pendingReq || (t.pendingCount || 0) > 0);
    const isLive = Boolean(t.live || liveEntry?.status === "running");
    const isPinned = Boolean(group?.pinned);
    const isActive = t.id === activeThreadId;

    if (!isPending && !isLive && !recentDone && !isPinned && !isActive && scored.length >= maxItems) {
      continue;
    }

    let status = "idle";
    let priority = 0;
    let phaseText = stripMarkdownForSpeech(t.preview || "空闲", 54) || "空闲";

    if (isPending) {
      status = "pending";
      priority = 400;
      phaseText = stripMarkdownForSpeech(pendingReq?.title || pendingReq?.command || "等待你确认", 54) || "等待确认";
    } else if (isLive) {
      status = "live";
      priority = 300;
      if (liveEntry) {
        const human = humanizeLiveActivity(liveEntry, { isStreamingText: Boolean(liveEntry.isStreamingText) });
        phaseText = human.phase || "正在运行…";
      } else {
        phaseText = `${providerVisualMeta(t.provider).short} 正在运行…`;
      }
    } else if (recentDone) {
      status = doneEntry.status === "failed" ? "error" : "done";
      priority = 200;
      phaseText = doneEntry.status === "failed"
        ? `执行失败${doneEntry.summary ? `：${stripMarkdownForSpeech(doneEntry.summary, 42)}` : ""}`
        : `刚刚完成${doneEntry.summary ? `：${stripMarkdownForSpeech(doneEntry.summary, 42)}` : ""}`;
    } else {
      priority = (isPinned ? 120 : 0) + (isActive ? 60 : 0);
    }

    if (isActive) priority += 20;
    if (isPinned) priority += 10;

    const goalBadge = t.goalState?.active
      ? `${Number(t.goalState.turnCount ?? t.goalState.turnsUsed) || 1}/${Number(t.goalState.maxTurns) || 20}`
      : "";

    scored.push({
      threadId: t.id,
      projectCwd: t.cwd,
      projectName: group?.name || t.cwd?.split("/").pop() || "项目",
      title: String(t.title || t.name || "新会话"),
      provider: t.provider,
      effortBadge: compactEffortBadgeLabel(t.reasoningEffort || ""),
      status,
      priority,
      phaseText,
      goalBadge,
      pendingRequest: pendingReq,
      updatedAt: Number(t.updatedAt) || 0,
    });
  }

  return scored
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.updatedAt - a.updatedAt;
    })
    .slice(0, maxItems);
}

export function renderVoiceLiveProgressHtml(items = []) {
  if (!items.length) {
    return `<div class="voice-progress-empty">暂无活跃任务，直接输入即可派发</div>`;
  }
  return items.map((item) => {
    const pv = providerVisualMeta(item.provider);
    const statusMap = {
      pending: { dot: "is-pending", badge: "待确认" },
      live: { dot: "is-live", badge: "运行中" },
      done: { dot: "is-done", badge: "刚完成" },
      error: { dot: "is-error", badge: "出错" },
      idle: { dot: "is-idle", badge: "空闲" },
    };
    const st = statusMap[item.status] || statusMap.idle;
    const tipText = [item.projectName, pv.short, item.title, item.phaseText].filter(Boolean).join(" · ");
    return `
      <div class="voice-progress-pill is-${escapeHtml(item.status)}" data-voice-progress-thread="${escapeHtml(item.threadId)}" title="${escapeHtml(tipText)}">
        <span class="voice-progress-dot ${st.dot}" aria-hidden="true"></span>
        <span class="voice-progress-pill-project">${escapeHtml(item.projectName)}</span>
        <span class="voice-progress-pill-sep" aria-hidden="true">·</span>
        <span class="voice-progress-pill-title">${escapeHtml(item.title || st.badge)}</span>
        ${item.goalBadge ? `<span class="voice-progress-goal">${iconSvg("target", { size: 11 })} ${escapeHtml(item.goalBadge)}</span>` : ""}
        <span class="voice-progress-pill-badge">${escapeHtml(st.badge)}</span>
        ${item.pendingRequest ? `
          <span class="voice-progress-pill-actions">
            <button type="button" class="btn-primary btn-xs" data-voice-approve="${escapeHtml(item.pendingRequest.id)}" data-voice-decision="accept" title="批准">${iconSvg("check", { size: 11 })}</button>
            <button type="button" class="btn-danger btn-xs" data-voice-approve="${escapeHtml(item.pendingRequest.id)}" data-voice-decision="decline" title="拒绝">${iconSvg("close", { size: 11 })}</button>
          </span>
        ` : ""}
      </div>
    `;
  }).join("");
}

export function renderVoiceUnheardBannerHtml(unheardItems = []) {
  const list = Array.isArray(unheardItems) ? unheardItems.filter((item) => String(item?.text || "").trim()) : [];
  if (!list.length) return "";
  const latest = list[list.length - 1];
  const reasonText = latest?.reason ? `（${humanizeVoiceDeliveryReason(latest.reason)}）` : "";
  const snippet = stripMarkdownForSpeech(latest.text, 64);
  const titleText = list.length > 1
    ? `有 ${list.length} 条语音未听到${reasonText}：${snippet}`
    : `上一条语音未播报成功${reasonText}：${snippet}`;
  return `
    <div class="voice-unheard-banner-inner" role="status" aria-live="polite">
      <span class="voice-unheard-icon" aria-hidden="true">${iconSvg("warning", { size: 15 })}</span>
      <span class="voice-unheard-text">${escapeHtml(titleText)}</span>
      <div class="voice-unheard-actions">
        <button type="button" class="btn-primary btn-xs" data-voice-replay-all="1">${iconSvg("speaker", { size: 12 })} <span>立即补播</span></button>
        <button type="button" class="icon-btn voice-unheard-dismiss" data-voice-dismiss-unheard="1" title="忽略未听提醒" aria-label="忽略未听提醒">${iconSvg("close", { size: 12 })}</button>
      </div>
    </div>
  `;
}

function renderVoiceDeliveryChipHtml(entry) {
  const status = String(entry?.deliveryStatus || "").trim();
  if (!status) return "";
  if (status === "queued") {
    return `<span class="voice-turn-delivery-chip is-queued">${iconSvg("clock", { size: 11 })} 待播报</span>`;
  }
  if (status === "playing") {
    return `<span class="voice-turn-delivery-chip is-playing">${iconSvg("speaker", { size: 11 })} 播报中</span>`;
  }
  if (status === "played") {
    return `<span class="voice-turn-delivery-chip is-played">${iconSvg("check", { size: 11 })} 已播报</span>`;
  }
  if (status === "interrupted") {
    if (entry?.heard) {
      return `<span class="voice-turn-delivery-chip is-interrupted">${iconSvg("pause", { size: 11 })} 已打断</span>`;
    }
    const label = entry?.deliveryReason ? humanizeVoiceDeliveryReason(entry.deliveryReason) : "未播完";
    return `<span class="voice-turn-delivery-chip is-unheard">${iconSvg("warning", { size: 11 })} ${escapeHtml(label)}</span>`;
  }
  if (status === "unheard" || status === "failed") {
    const label = humanizeVoiceDeliveryReason(entry?.deliveryReason || "");
    return `<span class="voice-turn-delivery-chip is-unheard">${iconSvg("warning", { size: 11 })} ${escapeHtml(label)}</span>`;
  }
  return `<span class="voice-turn-delivery-chip is-pending">${iconSvg("clock", { size: 11 })} 待确认出声</span>`;
}

export function renderVoiceCallTranscriptHtml(entries = []) {
  const list = (entries || []).slice(-4);
  if (!list.length) {
    return `
      <div class="voice-transcript-placeholder">
        开车免提语音总控已就绪：直接开口说“现在什么进度？”、“让控制台跑一下测试”或“批准请求”（支持可选轻量模型，不依赖 Gemini 也能用）。
      </div>
    `;
  }
  return list.map((entry) => {
    const isUnheard = entry.deliveryStatus === "unheard"
      || entry.deliveryStatus === "failed"
      || (entry.deliveryStatus === "interrupted" && !entry.heard);
    const deliveryChip = renderVoiceDeliveryChipHtml(entry);
    const replayBtn = entry.id && entry.deliveryStatus !== "playing"
      ? `<button type="button" class="voice-turn-replay-btn${isUnheard ? " is-urgent" : ""}" data-voice-replay="${escapeHtml(entry.id)}" title="重新播报这一句">${iconSvg("speaker", { size: 11 })} <span>重播</span></button>`
      : "";
    return `
      <div class="voice-call-turn${isUnheard ? " is-unheard" : ""}">
        ${entry.heardText ? `<div class="voice-turn-user"><span class="voice-turn-tag">你</span><span>${escapeHtml(entry.heardText)}</span></div>` : ""}
        ${entry.spokenReply ? `
          <div class="voice-turn-ai">
            <span class="voice-turn-tag is-ai">H₂</span>
            <div class="voice-turn-ai-body">
              <span>${escapeHtml(entry.spokenReply)}</span>
              ${entry.actionTag ? `<span class="voice-turn-action-chip">${iconSvg("bolt", { size: 11 })} ${escapeHtml(entry.actionTag)}</span>` : ""}
              ${deliveryChip}
              ${replayBtn}
            </div>
          </div>
        ` : (entry.actionTag ? `
          <div class="voice-turn-ai">
            <span class="voice-turn-tag is-ai">H₂</span>
            <div class="voice-turn-ai-body">
              <span class="voice-turn-action-chip">${iconSvg("bolt", { size: 11 })} ${escapeHtml(entry.actionTag)}</span>
            </div>
          </div>
        ` : "")}
      </div>
    `;
  }).join("");
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
