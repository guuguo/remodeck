import {
  base64ToUint8Array,
  CALL_VOICE_VAD_OPTIONS,
  computeRmsLevel,
  createVadTurnDetector,
  downsampleFloat32ToInt16,
  encodePcm16SamplesToWav,
  mergePcm16ChunksWithGap,
  pickPreferredChineseSpeechVoice,
  stripMarkdownForSpeech,
  uint8ArrayToBase64,
} from "./voice-copilot.js?v=20261124drive";

/**
 * Owns Sprite text-to-speech playback queue and microphone capture / VAD / bandpass pipeline.
 */
export function createSpriteAudioPipeline({
  state,
  getEl,
  deps = {},
  callbacks = {},
} = {}) {
  const $ = getEl;
  const {
    apiPostWithHotFallback = async () => ({}),
    formatActionError = (err, fallback = "操作失败") => String(err?.message || err || fallback),
    loadMissionOverview = async () => {},
    ensureVoiceAudioUnlocked = () => {},
    playVoiceEarcon = () => {},
    fetchVoiceTtsAudio = async () => null,
    mediaDevices = null,
    AudioContextCtor = null,
  } = deps;

  const {
    renderSpriteAssistantMount = () => {},
    pushSpriteMessage = () => {},
    toggleSpriteAssistant = () => {},
    handleSpriteCommand = async () => {},
    transitionPhonePhase = () => {},
    logSpritePhoneEvent = () => {},
    sendSpritePhoneTurn = async () => {},
    formatTimerText = (sec = 0) => String(sec),
  } = callbacks;

  function stopSpriteSpeech({ resetPhase = true } = {}) {
    const wasSpeaking = Boolean(state.sprite.speaking);
    state.sprite.speechToken = (state.sprite.speechToken || 0) + 1;
    state.sprite.ttsQueue = [];
    state.sprite.ttsStreamEnded = true;
    state.sprite.ttsDraining = false;
    state.sprite.speaking = false;
    state.sprite.speakingStartedAt = 0;
    if (state.sprite.audioSource) {
      try {
        state.sprite.audioSource.onended = null;
        state.sprite.audioSource.stop();
        state.sprite.audioSource.disconnect();
      } catch {}
      state.sprite.audioSource = null;
    }
    if (state.sprite.audioEl) {
      try {
        state.sprite.audioEl.pause();
        state.sprite.audioEl.src = "";
      } catch {}
      state.sprite.audioEl = null;
    }
    try {
      if (typeof speechSynthesis !== "undefined") {
        speechSynthesis.cancel();
      }
    } catch {}
    if (resetPhase && state.sprite.phoneCallActive) {
      transitionPhonePhase(state.sprite.busy || state.sprite.transcribing ? "thinking" : "listening");
    }
    if (wasSpeaking) {
      renderSpriteAssistantMount();
    }
  }

  async function playSpriteBufferViaWebAudio(tts) {
    const ctx = state.voice?.audioCtx;
    if (!ctx || ctx.state === "closed" || typeof ctx.decodeAudioData !== "function" || !tts?.audioBase64) {
      return false;
    }
    try {
      if (ctx.state === "suspended" || ctx.state === "interrupted") {
        await Promise.race([ctx.resume().catch(() => {}), new Promise((r) => setTimeout(r, 900))]);
      }
      if (ctx.state !== "running") return false;
      const bytes = base64ToUint8Array(tts.audioBase64);
      const rawCopy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const audioBuffer = await ctx.decodeAudioData(rawCopy);
      if (!audioBuffer || !(audioBuffer.duration > 0) || !state.sprite.speaking) return false;
      return await new Promise((resolve) => {
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        state.sprite.audioSource = source;
        let done = false;
        const finish = (ok) => {
          if (done) return;
          done = true;
          if (state.sprite.audioSource === source) state.sprite.audioSource = null;
          try { source.disconnect(); } catch {}
          resolve(ok);
        };
        source.onended = () => finish(true);
        try {
          source.start(0);
        } catch {
          finish(false);
        }
      });
    } catch {
      return false;
    }
  }

  function clearSpriteSpeakingState() {
    if (!state.sprite.speaking) return;
    state.sprite.speaking = false;
    state.sprite.speakingStartedAt = 0;
    state.sprite.ttsDraining = false;
    if (state.sprite.phoneCallActive) {
      transitionPhonePhase(state.sprite.busy || state.sprite.transcribing ? "thinking" : "listening");
    }
    renderSpriteAssistantMount();
    if (state.sprite.phoneCallActive && state.sprite.phonePendingTurns.length > 0 && !state.sprite.busy && !state.sprite.transcribing) {
      void sendSpritePhoneTurn();
    }
  }

  async function playSingleSpriteTtsPayload(tts, token) {
    if (!tts?.audioBase64 || token !== state.sprite.speechToken || !state.sprite.speaking) return false;
    const startedAt = Date.now();
    logSpritePhoneEvent("playback_start", { detail: { provider: tts.provider || "", bytes: tts.audioBase64.length } });
    const playedWebAudio = await playSpriteBufferViaWebAudio(tts);
    if (playedWebAudio) {
      logSpritePhoneEvent("playback_end", { detail: { mode: "webaudio", ms: Date.now() - startedAt } });
      return true;
    }
    if (token !== state.sprite.speechToken || !state.sprite.speaking) return false;
    if (typeof Audio !== "undefined") {
      try {
        const mime = tts.mimeType || "audio/mp3";
        const audio = new Audio(`data:${mime};base64,${tts.audioBase64}`);
        audio.playsInline = true;
        state.sprite.audioEl = audio;
        const ok = await new Promise((resolve) => {
          let settled = false;
          const done = (val) => {
            if (settled) return;
            settled = true;
            if (state.sprite.audioEl === audio) state.sprite.audioEl = null;
            resolve(val);
          };
          audio.addEventListener("ended", () => done(true), { once: true });
          audio.addEventListener("error", () => done(false), { once: true });
          audio.play().catch(() => done(false));
        });
        if (ok) {
          logSpritePhoneEvent("playback_end", { detail: { mode: "html_audio", ms: Date.now() - startedAt } });
          return true;
        }
      } catch {
        state.sprite.audioEl = null;
      }
    }
    logSpritePhoneEvent("playback_error", { detail: { provider: tts.provider || "", ms: Date.now() - startedAt } });
    return false;
  }

  function speakViaBrowserSynthesis(text, onDone) {
    try {
      if (typeof speechSynthesis !== "undefined" && typeof SpeechSynthesisUtterance !== "undefined") {
        const u = new SpeechSynthesisUtterance(text);
        const v = pickPreferredChineseSpeechVoice(speechSynthesis.getVoices?.() || []);
        if (v) u.voice = v;
        u.lang = "zh-CN";
        u.onend = onDone;
        u.onerror = onDone;
        speechSynthesis.speak(u);
        return true;
      }
    } catch {}
    return false;
  }

  function beginSpriteSpeechStream(text = "", { turnId = "" } = {}) {
    if (!state.sprite.ttsEnabled && !state.sprite.phoneCallActive) return 0;
    const clean = stripMarkdownForSpeech(text, 240);
    if (!clean) return 0;
    stopSpriteSpeech({ resetPhase: false });
    const token = (state.sprite.speechToken || 0) + 1;
    state.sprite.speechToken = token;
    state.sprite.speaking = true;
    state.sprite.speakingStartedAt = Date.now();
    state.sprite.lastSpokenReply = clean;
    state.sprite.ttsQueue = [];
    state.sprite.ttsStreamEnded = false;
    state.sprite.ttsPlayedAny = false;
    state.sprite.ttsDraining = false;
    if (state.sprite.phoneCallActive) {
      transitionPhonePhase("speaking", { turnId });
    }
    renderSpriteAssistantMount();
    return token;
  }

  async function drainSpriteTtsQueue(token) {
    if (state.sprite.ttsDraining || token !== state.sprite.speechToken || !state.sprite.speaking) return;
    state.sprite.ttsDraining = true;
    try {
      while (token === state.sprite.speechToken && state.sprite.speaking) {
        const nextItem = state.sprite.ttsQueue?.shift();
        if (!nextItem) break;
        if (nextItem.tts?.audioBase64) {
          const ok = await playSingleSpriteTtsPayload(nextItem.tts, token);
          if (ok) state.sprite.ttsPlayedAny = true;
        }
      }
    } finally {
      state.sprite.ttsDraining = false;
    }
    if (token !== state.sprite.speechToken || !state.sprite.speaking) return;
    if (state.sprite.ttsQueue?.length) {
      void drainSpriteTtsQueue(token);
      return;
    }
    if (state.sprite.ttsStreamEnded) {
      if (!state.sprite.ttsPlayedAny && state.sprite.lastSpokenReply) {
        if (speakViaBrowserSynthesis(state.sprite.lastSpokenReply, () => {
          if (token === state.sprite.speechToken) clearSpriteSpeakingState();
        })) {
          return;
        }
      }
      clearSpriteSpeakingState();
    }
  }

  function enqueueSpriteTtsChunk(token, tts) {
    if (!token || token !== state.sprite.speechToken || !state.sprite.speaking) return;
    if (tts?.audioBase64) {
      state.sprite.lastTtsPayload = tts;
      state.sprite.ttsQueue ||= [];
      state.sprite.ttsQueue.push({ tts });
      void drainSpriteTtsQueue(token);
    }
  }

  function finishSpriteSpeechStream(token) {
    if (!token || token !== state.sprite.speechToken) return;
    state.sprite.ttsStreamEnded = true;
    if (!state.sprite.ttsDraining && (!state.sprite.ttsQueue || !state.sprite.ttsQueue.length)) {
      void drainSpriteTtsQueue(token);
    }
  }

  async function speakSpriteText(text = "", { ttsPayload = null } = {}) {
    const token = beginSpriteSpeechStream(text);
    if (!token) return;
    const clean = state.sprite.lastSpokenReply;
    const tts = ttsPayload?.audioBase64 ? ttsPayload : await fetchVoiceTtsAudio({ text: clean });
    if (token !== state.sprite.speechToken || !state.sprite.speaking) return;
    if (tts?.audioBase64) {
      enqueueSpriteTtsChunk(token, tts);
    }
    finishSpriteSpeechStream(token);
  }

  function teardownSpriteMic() {
    const mic = state.sprite.mic;
    if (mic.maxTimer) {
      clearTimeout(mic.maxTimer);
      mic.maxTimer = null;
    }
    if (mic.tickTimer) {
      clearInterval(mic.tickTimer);
      mic.tickTimer = null;
    }
    if (mic.watchdogTimer) {
      clearInterval(mic.watchdogTimer);
      mic.watchdogTimer = null;
    }
    if (mic.probeTimer) {
      clearTimeout(mic.probeTimer);
      mic.probeTimer = null;
    }
    if (mic.processor) {
      try {
        mic.processor.onaudioprocess = null;
        mic.processor.disconnect?.();
      } catch {}
    }
    try { mic.silentGain?.disconnect?.(); } catch {}
    if (Array.isArray(mic.filterNodes)) {
      for (const node of mic.filterNodes) {
        try { node?.disconnect?.(); } catch {}
      }
    }
    try { mic.source?.disconnect?.(); } catch {}
    if (mic.micStream) {
      for (const track of mic.micStream.getTracks?.() || []) {
        try {
          track.onended = null;
          track.onmute = null;
          track.onunmute = null;
          track.stop?.();
        } catch {}
      }
    }
    if (mic.audioCtx && mic.ownsAudioCtx === true && mic.audioCtx !== state.voice?.audioCtx) {
      try { void mic.audioCtx.close?.(); } catch {}
    }
    mic.processor = null;
    mic.silentGain = null;
    mic.filterNodes = [];
    mic.source = null;
    mic.micStream = null;
    mic.audioCtx = null;
    mic.ownsAudioCtx = false;
    mic.vad = null;
    mic.bargeInFrames = 0;
    mic.bargeRing = [];
    mic.queuedSamples = null;
    mic.lastAudioFrameAt = 0;
    mic.frameCount = 0;
    mic.maxRms = 0;
    mic.vadDiscards = 0;
    mic.recovering = false;
    mic.trackLabel = "";
    state.sprite.speechActive = false;
    state.sprite.recordElapsedSec = 0;
  }

  async function transcribeSpritePcmSamples(samples) {
    if (!samples || samples.length < 1600) return false;
    state.sprite.transcribing = true;
    renderSpriteAssistantMount();
    try {
      const wavBytes = encodePcm16SamplesToWav(samples, 16000);
      const res = await apiPostWithHotFallback("api/voice/transcribe", {
        audioBase64: uint8ArrayToBase64(wavBytes),
        audioMimeType: "audio/wav",
      });
      const recognized = String(res?.text || "").trim();
      state.sprite.transcribing = false;
      renderSpriteAssistantMount();
      if (recognized) {
        await handleSpriteCommand(recognized);
        return true;
      }
      if (!state.sprite.handsFree) {
        pushSpriteMessage({ role: "sprite", tone: "idle", text: "没有识别到清晰人声，可以再说一次或直接打字。" });
      }
      return false;
    } catch (error) {
      state.sprite.transcribing = false;
      pushSpriteMessage({ role: "sprite", tone: "urgent", text: `语音识别失败：${formatActionError(error)}`, ttsPayload: { skipAutoSpeak: true } });
      return false;
    } finally {
      state.sprite.transcribing = false;
      renderSpriteAssistantMount();
    }
  }

  async function stopSpriteMic({ submit = true, stopHandsFree = false, explicitSamples = null } = {}) {
    if (stopHandsFree && state.sprite.handsFree) {
      state.sprite.handsFree = false;
      if (typeof state.sprite.prevTtsPref === "boolean") {
        state.sprite.ttsEnabled = state.sprite.prevTtsPref;
        state.sprite.prevTtsPref = null;
      }
    }
    const wasRecording = state.sprite.recording;
    state.sprite.recording = false;

    let merged = explicitSamples;
    const vadFlushed = state.sprite.mic.vad?.flush?.();
    const chunks = state.sprite.mic.chunks;
    state.sprite.mic.chunks = [];
    teardownSpriteMic();
    state.sprite.micStatus = "idle";
    state.sprite.micError = "";

    if (!wasRecording && !merged) {
      renderSpriteAssistantMount();
      return;
    }

    if (!merged && submit) {
      if (vadFlushed?.samples?.length >= 1600) {
        merged = vadFlushed.samples;
      } else {
        const totalLen = chunks.reduce((s, c) => s + c.length, 0);
        if (totalLen >= 1600) {
          merged = new Int16Array(totalLen);
          let offset = 0;
          for (const chunk of chunks) {
            merged.set(chunk, offset);
            offset += chunk.length;
          }
        } else if (totalLen > 0 && !stopHandsFree) {
          renderSpriteAssistantMount();
          pushSpriteMessage({ role: "sprite", tone: "idle", text: "录音太短没听清，再按一下麦克风告诉我吧。" });
          return;
        }
      }
    }

    renderSpriteAssistantMount();
    if (submit && merged && merged.length >= 1600) {
      await transcribeSpritePcmSamples(merged);
    }
  }

  async function startSpriteMic({ handsFree = false } = {}) {
    if (state.sprite.recording) {
      if (handsFree && !state.sprite.handsFree) {
        if (state.sprite.prevTtsPref === null) {
          state.sprite.prevTtsPref = state.sprite.ttsEnabled;
        }
        state.sprite.ttsEnabled = true;
        state.sprite.handsFree = true;
        if (state.sprite.mic.maxTimer) {
          clearTimeout(state.sprite.mic.maxTimer);
          state.sprite.mic.maxTimer = null;
        }
        renderSpriteAssistantMount();
      }
      return;
    }
    if (state.sprite.micStarting) return;

    ensureVoiceAudioUnlocked();
    if (!handsFree) {
      stopSpriteSpeech();
    }

    const mediaDevicesObj = mediaDevices || (typeof navigator !== "undefined" ? navigator.mediaDevices : null);
    if (!mediaDevicesObj?.getUserMedia) {
      state.sprite.micStatus = "error";
      state.sprite.micError = "当前环境未开放麦克风权限";
      logSpritePhoneEvent("mic_error", { detail: { reason: "no_media_devices" } });
      pushSpriteMessage({ role: "sprite", tone: "urgent", text: "当前环境未开放麦克风权限，可在桌面客户端系统设置中授权麦克风，或直接打字发送。", ttsPayload: { skipAutoSpeak: true } });
      renderSpriteAssistantMount();
      return;
    }
    const sharedCtx = state.voice?.audioCtx && state.voice.audioCtx.state !== "closed" ? state.voice.audioCtx : null;
    const AudioCtx = AudioContextCtor || (typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext)) || null;
    if (!sharedCtx && !AudioCtx) {
      state.sprite.micStatus = "error";
      state.sprite.micError = "当前浏览器不支持音频采集";
      logSpritePhoneEvent("mic_error", { detail: { reason: "no_audio_context" } });
      pushSpriteMessage({ role: "sprite", tone: "urgent", text: "当前浏览器不支持音频采集，请直接打字提问。", ttsPayload: { skipAutoSpeak: true } });
      renderSpriteAssistantMount();
      return;
    }

    if (handsFree) {
      if (state.sprite.prevTtsPref === null) {
        state.sprite.prevTtsPref = state.sprite.ttsEnabled;
      }
      state.sprite.ttsEnabled = true;
      state.sprite.handsFree = true;
    } else {
      state.sprite.handsFree = false;
    }

    const ownsAudioCtx = !sharedCtx;
    let ctx = null;
    try {
      ctx = sharedCtx || new AudioCtx();
    } catch (ctxErr) {
      state.sprite.handsFree = false;
      state.sprite.micStatus = "error";
      state.sprite.micError = ctxErr?.message || "无法初始化音频上下文";
      logSpritePhoneEvent("mic_error", { detail: { reason: "audio_context_init", message: String(ctxErr?.message || "") } });
      pushSpriteMessage({ role: "sprite", tone: "urgent", text: `麦克风启动失败：${state.sprite.micError}`, ttsPayload: { skipAutoSpeak: true } });
      renderSpriteAssistantMount();
      return;
    }
    if ((ctx.state === "suspended" || ctx.state === "interrupted") && typeof ctx.resume === "function") {
      void ctx.resume().catch(() => {});
    }

    state.sprite.micStarting = true;
    state.sprite.micStatus = "starting";
    state.sprite.micError = "";
    renderSpriteAssistantMount();

    try {
      const preferredConstraints = {
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      };
      let stream = null;
      try {
        stream = await mediaDevicesObj.getUserMedia(preferredConstraints);
      } catch (gumErr) {
        const errName = String(gumErr?.name || "");
        if (
          errName === "OverconstrainedError"
          || errName === "ConstraintNotSatisfiedError"
          || errName === "NotReadableError"
          || errName === "AbortError"
        ) {
          stream = await mediaDevicesObj.getUserMedia({ audio: true });
        } else {
          throw gumErr;
        }
      }

      if ((state.sprite.viewMode === "phone" && !state.sprite.phoneCallActive) || (handsFree && !state.sprite.handsFree)) {
        for (const t of stream?.getTracks?.() || []) {
          try { t.stop?.(); } catch {}
        }
        if (ownsAudioCtx) {
          try { void ctx.close?.(); } catch {}
        }
        state.sprite.micStatus = "idle";
        state.sprite.micError = "";
        return;
      }

      if ((ctx.state === "suspended" || ctx.state === "interrupted") && typeof ctx.resume === "function") {
        let resumeTimer = null;
        await Promise.race([
          ctx.resume().catch(() => {}),
          new Promise((r) => {
            resumeTimer = setTimeout(r, 900);
            resumeTimer.unref?.();
          }),
        ]);
        if (resumeTimer) clearTimeout(resumeTimer);
      }

      if ((state.sprite.viewMode === "phone" && !state.sprite.phoneCallActive) || (handsFree && !state.sprite.handsFree)) {
        for (const t of stream?.getTracks?.() || []) {
          try { t.stop?.(); } catch {}
        }
        if (ownsAudioCtx) {
          try { void ctx.close?.(); } catch {}
        }
        state.sprite.micStatus = "idle";
        state.sprite.micError = "";
        return;
      }

      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(2048, 1, 1);
      const silentGain = ctx.createGain();
      silentGain.gain.value = 0;

      const filterNodes = [];
      if (typeof ctx.createBiquadFilter === "function") {
        const sr = Number(ctx.sampleRate) || 48000;
        const nyquist = sr * 0.5;
        const highpass = ctx.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = Math.min(100, Math.max(40, nyquist * 0.08));
        highpass.Q.value = 0.707;
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = "lowpass";
        lowpass.frequency.value = Math.min(7200, Math.max(1200, Math.floor(nyquist * 0.9)));
        lowpass.Q.value = 0.707;
        source.connect(highpass);
        highpass.connect(lowpass);
        lowpass.connect(processor);
        filterNodes.push(highpass, lowpass);
      } else {
        source.connect(processor);
      }
      processor.connect(silentGain);
      silentGain.connect(ctx.destination);

      const vad = createVadTurnDetector(
        handsFree || state.sprite.phoneCallActive
          ? { ...CALL_VOICE_VAD_OPTIONS, silenceMs: 1150, minSpeechMs: 220, minPeakRms: 0.0085 }
          : {
              sampleRate: 16000,
              silenceMs: 1100,
              minSpeechMs: 280,
              maxSpeechMs: 22000,
              rmsThreshold: 0.016,
              adaptive: true,
              requireSustainedOnset: true,
            },
      );

      const mic = state.sprite.mic;
      const primaryTrack = stream?.getAudioTracks?.()?.[0] || null;
      const trackLabel = String(primaryTrack?.label || "").trim();

      mic.chunks = [];
      mic.vad = vad;
      mic.startedAtMs = Date.now();
      mic.lastLevelUiAt = 0;
      mic.lastAudioFrameAt = Date.now();
      mic.frameCount = 0;
      mic.maxRms = 0;
      mic.vadDiscards = 0;
      mic.recovering = false;
      mic.trackLabel = trackLabel;
      mic.bargeInFrames = 0;
      mic.bargeRing = [];
      mic.pendingOverlap = null;
      mic.queuedSamples = null;
      state.sprite.recordElapsedSec = 0;
      state.sprite.speechActive = false;

      const triggerMicRecovery = (reason = "stalled") => {
        if (!state.sprite.recording || state.sprite.mic.processor !== processor || mic.recovering) return;
        if (!(state.sprite.phoneCallActive || state.sprite.handsFree)) return;
        if (state.sprite.phoneCallActive && state.sprite.phoneMuted) return;
        if ((state.sprite.micRecoveryCount || 0) >= 2) {
          state.sprite.micStatus = "stalled";
          state.sprite.micError = "未收到麦克风音频流，点中间光球重试或检查系统麦克风权限";
          renderSpriteAssistantMount();
          return;
        }
        mic.recovering = true;
        state.sprite.micRecoveryCount = (state.sprite.micRecoveryCount || 0) + 1;
        logSpritePhoneEvent("mic_recover", { detail: { reason, attempt: state.sprite.micRecoveryCount } });
        const recoverTimer = setTimeout(() => {
          if (state.sprite.mic.processor !== processor) return;
          const shouldRestart = state.sprite.recording
            && (state.sprite.phoneCallActive || state.sprite.handsFree)
            && !(state.sprite.phoneCallActive && state.sprite.phoneMuted);
          teardownSpriteMic();
          state.sprite.recording = false;
          if (shouldRestart) {
            void startSpriteMic({ handsFree: true });
          }
        }, 180);
        recoverTimer.unref?.();
      };

      processor.onaudioprocess = (ev) => {
        if (!state.sprite.recording) return;
        if (state.sprite.phoneCallActive && state.sprite.phoneMuted) return;
        const now = Date.now();
        mic.lastAudioFrameAt = now;
        mic.frameCount += 1;

        const input = ev.inputBuffer?.getChannelData?.(0);
        if (!input?.length) return;
        let hasCorruptSample = false;
        for (let i = 0; i < input.length; i += 64) {
          if (!Number.isFinite(input[i])) {
            hasCorruptSample = true;
            break;
          }
        }
        if (hasCorruptSample) {
          triggerMicRecovery("corrupt_samples");
          return;
        }

        const rms = computeRmsLevel(input);
        if (rms > mic.maxRms) mic.maxRms = rms;
        if (rms > 0) {
          if (mic.frameCount >= 12) {
            state.sprite.micRecoveryCount = 0;
          }
          if (state.sprite.micStatus === "stalled" || state.sprite.micStatus === "silent") {
            state.sprite.micStatus = "ready";
            state.sprite.micError = "";
            renderSpriteAssistantMount();
          }
        }

        if (now - mic.lastLevelUiAt >= 65) {
          mic.lastLevelUiAt = now;
          const norm = Math.min(1, Math.max(0.06, rms * 11.5));
          state.sprite.voiceLevel = norm;
          const barEl = $("spriteVoiceBar");
          if (barEl) barEl.style.setProperty("--voice-level", norm.toFixed(2));
          const phoneShell = $("spritePhoneShell");
          if (phoneShell) phoneShell.style.setProperty("--voice-level", norm.toFixed(2));
        }

        const pcm16 = downsampleFloat32ToInt16(input, ctx.sampleRate || 48000, 16000);
        const assistantBusy = state.sprite.transcribing || state.sprite.busy;

        if (state.sprite.speaking) {
          mic.bargeRing.push({ pcm16, rms });
          while (mic.bargeRing.length > 24) mic.bargeRing.shift();
          if (rms >= 0.045) {
            mic.bargeInFrames += 1;
            if (mic.bargeInFrames >= 3) {
              mic.bargeInFrames = 0;
              const overlapDurationMs = state.sprite.speakingStartedAt ? Math.max(0, Date.now() - state.sprite.speakingStartedAt) : 0;
              const overlapBotText = state.sprite.lastSpokenReply || "";
              mic.pendingOverlap = { overlapDurationMs, overlapBotText };
              logSpritePhoneEvent("barge_in", { fromPhase: "speaking", toPhase: "listening", detail: { overlapDurationMs } });
              stopSpriteSpeech();
              vad.reset();
              for (const frame of mic.bargeRing) vad.pushSamples(frame.pcm16, frame.rms);
              mic.bargeRing = [];
            }
          } else {
            mic.bargeInFrames = 0;
          }
          return;
        }
        mic.bargeRing = [];

        if (!assistantBusy && mic.queuedSamples?.length) {
          const queued = mic.queuedSamples;
          mic.queuedSamples = null;
          void transcribeSpritePcmSamples(queued);
          return;
        }

        if (!state.sprite.handsFree && mic.chunks.length < 450) {
          mic.chunks.push(pcm16);
        }

        const vadEv = vad.pushSamples(pcm16, rms);
        if (vadEv.type === "speech_start") {
          if (!state.sprite.speechActive) {
            state.sprite.speechActive = true;
            renderSpriteAssistantMount();
          }
        } else if (vadEv.type === "utterance" && vadEv.samples?.length >= 1600) {
          state.sprite.speechActive = false;
          if (state.sprite.phoneCallActive) {
            mic.chunks = [];
            playVoiceEarcon("heard", ctx);
            const overlap = mic.pendingOverlap || {};
            mic.pendingOverlap = null;
            void sendSpritePhoneTurn({ samples: vadEv.samples, ...overlap });
          } else if (state.sprite.handsFree) {
            mic.chunks = [];
            playVoiceEarcon("heard", ctx);
            if (state.sprite.transcribing || state.sprite.busy) {
              mic.queuedSamples = mic.queuedSamples?.length
                ? mergePcm16ChunksWithGap([mic.queuedSamples, vadEv.samples], 2560)
                : vadEv.samples;
            } else {
              void transcribeSpritePcmSamples(vadEv.samples);
            }
          } else {
            void stopSpriteMic({ submit: true, explicitSamples: vadEv.samples });
          }
        } else if (vadEv.type === "discarded_short" || vadEv.type === "discarded_noise") {
          mic.vadDiscards += 1;
          if (state.sprite.speechActive) {
            state.sprite.speechActive = false;
            renderSpriteAssistantMount();
          }
        }
      };

      mic.audioCtx = ctx;
      mic.ownsAudioCtx = ownsAudioCtx;
      mic.micStream = stream;
      mic.source = source;
      mic.filterNodes = filterNodes;
      mic.processor = processor;
      mic.silentGain = silentGain;
      state.sprite.recording = true;
      state.sprite.micStatus = "ready";
      state.sprite.micError = "";

      logSpritePhoneEvent("mic_ready", {
        detail: {
          sampleRate: Number(ctx.sampleRate) || 0,
          ctxState: String(ctx.state || ""),
          reusedCtx: !ownsAudioCtx,
          trackLabel,
          trackMuted: Boolean(primaryTrack?.muted),
          trackReadyState: String(primaryTrack?.readyState || ""),
        },
      });

      if (primaryTrack) {
        primaryTrack.onended = () => {
          triggerMicRecovery("track_ended");
        };
      }

      mic.tickTimer = setInterval(() => {
        if (!state.sprite.recording) return;
        const elapsed = Math.floor((Date.now() - mic.startedAtMs) / 1000);
        state.sprite.recordElapsedSec = elapsed;
        const timerEl = $("spriteVoiceTimer");
        if (timerEl) timerEl.textContent = formatTimerText(elapsed);
      }, 1000);
      mic.tickTimer.unref?.();

      mic.probeTimer = setTimeout(() => {
        mic.probeTimer = null;
        if (!state.sprite.recording || state.sprite.mic.processor !== processor) return;
        if (state.sprite.phoneCallActive && state.sprite.phoneMuted) return;
        logSpritePhoneEvent("mic_probe", {
          detail: {
            frames: mic.frameCount,
            maxRms: Number(mic.maxRms.toFixed(5)),
            vadDiscards: mic.vadDiscards,
            ctxState: String(ctx.state || ""),
            trackMuted: Boolean(primaryTrack?.muted),
            trackReadyState: String(primaryTrack?.readyState || ""),
            trackLabel: mic.trackLabel,
          },
        });
        if (mic.frameCount === 0) {
          if (typeof ctx.resume === "function") void ctx.resume().catch(() => {});
          state.sprite.micStatus = "stalled";
          state.sprite.micError = "未收到麦克风音频流，点中间光球重试或检查系统麦克风权限";
          renderSpriteAssistantMount();
        } else if (mic.frameCount >= 12 && mic.maxRms === 0 && !state.sprite.speaking) {
          state.sprite.micStatus = "silent";
          state.sprite.micError = "麦克风已连接但持续无声音输入，请检查 Mac 系统设置中的麦克风权限或输入设备";
          renderSpriteAssistantMount();
        }
      }, 2500);
      mic.probeTimer.unref?.();

      mic.watchdogTimer = setInterval(() => {
        if (!state.sprite.recording || state.sprite.mic.processor !== processor) return;
        if (state.sprite.phoneCallActive && state.sprite.phoneMuted) return;
        if ((ctx.state === "suspended" || ctx.state === "interrupted") && typeof ctx.resume === "function") {
          void ctx.resume().catch(() => {});
        }
        if (state.sprite.speaking || mic.recovering) return;
        if (!(state.sprite.phoneCallActive || state.sprite.handsFree)) return;
        const now = Date.now();
        if (now - mic.startedAtMs < 2400) return;
        const trackDead = Boolean(stream?.getAudioTracks?.().some((t) => t.readyState === "ended"));
        const idleMs = mic.lastAudioFrameAt > 0 ? now - mic.lastAudioFrameAt : now - mic.startedAtMs;
        if (trackDead || idleMs > 2200) {
          if ((state.sprite.micRecoveryCount || 0) >= 2) {
            if (state.sprite.micStatus !== "stalled") {
              state.sprite.micStatus = "stalled";
              state.sprite.micError = "未收到麦克风音频流，点中间光球重试或检查系统麦克风权限";
              renderSpriteAssistantMount();
            }
            return;
          }
          if (typeof ctx.resume === "function" && ctx.state !== "running") {
            void ctx.resume().catch(() => {});
          }
          const preFrameCount = mic.frameCount;
          const checkTimer = setTimeout(() => {
            if (!state.sprite.recording || state.sprite.mic.processor !== processor || mic.recovering) return;
            const newFrameArrived = mic.frameCount > preFrameCount;
            const stillTrackDead = Boolean(stream?.getAudioTracks?.().some((t) => t.readyState === "ended"));
            if (!newFrameArrived || stillTrackDead) {
              triggerMicRecovery(stillTrackDead ? "watchdog_track_ended" : "watchdog_idle");
            }
          }, 400);
          checkTimer.unref?.();
        }
      }, 1200);
      mic.watchdogTimer.unref?.();

      if (!state.sprite.handsFree) {
        mic.maxTimer = setTimeout(() => {
          void stopSpriteMic({ submit: true });
        }, 25000);
        mic.maxTimer.unref?.();
      }
      renderSpriteAssistantMount();
    } catch (error) {
      if (ownsAudioCtx && !state.sprite.mic.audioCtx) {
        try { void ctx?.close?.(); } catch {}
      }
      teardownSpriteMic();
      state.sprite.recording = false;
      state.sprite.handsFree = false;
      state.sprite.micStatus = "error";
      state.sprite.micError = error?.message || "请检查麦克风权限";
      logSpritePhoneEvent("mic_error", {
        detail: {
          name: String(error?.name || ""),
          message: String(error?.message || ""),
        },
      });
      renderSpriteAssistantMount();
      pushSpriteMessage({ role: "sprite", tone: "urgent", text: `麦克风启动失败：${error?.message || "请检查权限"}`, ttsPayload: { skipAutoSpeak: true } });
    } finally {
      state.sprite.micStarting = false;
    }
  }

  async function toggleSpriteHandsFree() {
    if (state.sprite.handsFree) {
      stopSpriteSpeech();
      await stopSpriteMic({ submit: false, stopHandsFree: true });
      return;
    }
    ensureVoiceAudioUnlocked();
    state.sprite.micRecoveryCount = 0;
    if (!state.sprite.open) {
      toggleSpriteAssistant({ open: true });
    }
    if (!state.missionOverview && !state.missionOverviewLoading) {
      void loadMissionOverview({ trigger: "open" });
    }
    await startSpriteMic({ handsFree: true });
  }

  async function toggleSpriteMic() {
    if (state.sprite.transcribing || state.sprite.busy) return;
    if (state.sprite.handsFree) {
      if (state.sprite.speechActive && state.sprite.mic.vad) {
        const flushed = state.sprite.mic.vad.flush();
        state.sprite.speechActive = false;
        if (flushed?.samples?.length >= 1600) {
          await transcribeSpritePcmSamples(flushed.samples);
          return;
        }
      }
      await toggleSpriteHandsFree();
      return;
    }
    if (state.sprite.recording) {
      await stopSpriteMic({ submit: true });
      return;
    }
    await startSpriteMic({ handsFree: false });
  }

  function toggleSpritePhoneMute() {
    if (!state.sprite.phoneCallActive) return;
    const nextMuted = !state.sprite.phoneMuted;
    state.sprite.phoneMuted = nextMuted;
    if (nextMuted) {
      state.sprite.speechActive = false;
      state.sprite.voiceLevel = 0;
      state.sprite.mic.vad?.reset?.();
    } else {
      ensureVoiceAudioUnlocked();
      if (!state.sprite.recording) {
        void startSpriteMic({ handsFree: true });
      }
    }
    renderSpriteAssistantMount();
  }

  return {
    stopSpriteSpeech,
    beginSpriteSpeechStream,
    enqueueSpriteTtsChunk,
    finishSpriteSpeechStream,
    speakSpriteText,
    teardownSpriteMic,
    startSpriteMic,
    stopSpriteMic,
    toggleSpriteHandsFree,
    toggleSpriteMic,
    toggleSpritePhoneMute,
  };
}
