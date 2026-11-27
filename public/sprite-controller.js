import { t } from "./i18n.js";
import { apiGet, apiPost, apiRequest, apiUrl, isDemoMode } from "./api-client.js?v=20261118demo";
import { renderMarkdown } from "./markdown.js?v=20261125err1";
import { replaceHtmlPreservingUiState } from "./dom-preserve.js?v=20261119preserve";
import {
  buildSpriteOpeningBriefing,
  buildSpriteTicketReply,
  buildSpriteTopicBriefing,
  captureSpriteOverviewSnapshot,
  classifySpriteUserInput,
  diffSpriteOverviewEvents,
  loadSpritePrefs,
  askSpriteAssistant,
  appendSpriteTurn,
  buildSpriteContext,
  parseSpriteNdjson,
  submitSpriteDispatch,
  spriteTomorrowAtEight,
  renderSpriteAssistantHtml,
  renderSpriteFullscreenHtml,
  renderSpritePhoneCallHtml,
  saveSpritePrefs,
} from "./sprite-assistant.js?v=20261126modal2";
import {
  base64ToUint8Array,
  CALL_VOICE_VAD_OPTIONS,
  computeRmsLevel,
  createVadTurnDetector,
  downsampleFloat32ToInt16,
  encodePcm16SamplesToWav,
  mergePcm16ChunksWithGap,
  mergeQueuedVoiceTurns,
  pickPreferredChineseSpeechVoice,
  stripMarkdownForSpeech,
  uint8ArrayToBase64,
} from "./voice-copilot.js?v=20261124drive";

const SPRITE_LAST_SEEN_KEY = "agentControl.sprite.lastSeenAt";
const VALID_PHONE_PHASES = new Set(["idle", "listening", "thinking", "speaking"]);
const VALID_VIEW_MODES = new Set(["popover", "fullscreen", "phone"]);

export function createInitialSpriteState() {
  const prefs = loadSpritePrefs();
  return {
    open: false,
    viewMode: "popover", // "popover" | "fullscreen" | "phone"
    prefsOpen: false,
    ttsEnabled: prefs.ttsEnabled,
    modelKey: prefs.modelKey,
    modelOptions: [],
    modelsLoadedAt: 0,
    sessionId: `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    mood: "idle",
    unreadCount: 0,
    toastBubble: null,
    toastTimer: null,
    audioEl: null,
    audioSource: null,
    speechToken: 0,
    ttsQueue: [],
    ttsStreamEnded: false,
    ttsPlayedAny: false,
    ttsDraining: false,
    speakingStartedAt: 0,
    lastSpokenReply: "",
    lastTtsPayload: null,
    thinkingLabel: "",
    messages: [],
    pendingPreview: null,
    pendingArchive: null,
    pendingReorg: null,
    pendingProposal: null,
    scopedTopicId: "",
    scopedTopicName: "",
    busy: false,
    askAbortController: null,
    askSeq: 0,
    recording: false,
    handsFree: false,
    phoneCallActive: false,
    phoneMuted: false,
    phoneAutoExecute: prefs.phoneAutoExecute,
    phoneKeyboardOpen: false,
    phoneStartedAt: 0,
    phoneElapsedSec: 0,
    phoneTimerId: null,
    phonePhase: "idle",
    phoneCallId: "",
    phoneTurnId: "",
    phoneAbortController: null,
    phonePendingTurns: [],
    voiceLevel: 0,
    speechActive: false,
    speaking: false,
    recordElapsedSec: 0,
    prevTtsPref: null,
    transcribing: false,
    micStatus: "idle",
    micError: "",
    micStarting: false,
    micRecoveryCount: 0,
    draft: "",
    turns: [],
    focusStack: [],
    cards: [],
    tour: null,
    continueDrafts: {},
    badgeCursor: {},
    profile: null,
    greetedSession: false,
    prevSnapshot: null,
    mic: {
      audioCtx: null,
      ownsAudioCtx: false,
      micStream: null,
      source: null,
      filterNodes: [],
      processor: null,
      silentGain: null,
      vad: null,
      tickTimer: null,
      watchdogTimer: null,
      probeTimer: null,
      startedAtMs: 0,
      lastLevelUiAt: 0,
      lastAudioFrameAt: 0,
      frameCount: 0,
      maxRms: 0,
      vadDiscards: 0,
      recovering: false,
      trackLabel: "",
      bargeInFrames: 0,
      bargeRing: [],
      pendingOverlap: null,
      queuedSamples: null,
      chunks: [],
      maxTimer: null,
    },
  };
}

/**
 * Encapsulates Sprite assistant chat, fullscreen mode, voice recording,
 * tour/ticket actions, and a single phone-call phase state machine.
 */
export function createSpriteController({
  state,
  getEl,
  getTycoon3d = () => null,
  deps = {},
  fetchImpl = null,
  doc = null,
} = {}) {
  const $ = getEl;
  const getDoc = () => doc || (typeof document !== "undefined" ? document : null);
  const getFetch = () => fetchImpl || (typeof fetch === "function" ? fetch : null);
  const raf = (fn) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 0));

  const {
    apiPostWithHotFallback = (path, body) => apiPost(path, body),
    isBoardViewActive = () => false,
    isOverviewBoardMode = () => false,
    setTopbarMenuOpen = () => {},
    setComposerConfigOpen = () => {},
    setSidebarOpen = () => {},
    showToastBanner = () => {},
    formatActionError = (err, fallback = "操作失败") => String(err?.message || err || fallback),
    buildDispatchAgentContext = () => ({ agentOptions: [] }),
    findOverviewTopicById = () => null,
    renderProjectBoard = () => {},
    refreshTasks = async () => {},
    refreshThreads = async () => {},
    selectThread = async () => {},
    loadMissionOverview = async () => {},
    openProjectBoardView = () => {},
    ensureVoiceAudioUnlocked = () => {},
    playVoiceEarcon = () => {},
    requestVoiceWakeLock = async () => {},
    releaseVoiceWakeLock = async () => {},
    fetchVoiceTtsAudio = async () => null,
    mediaDevices = null,
    AudioContextCtor = null,
  } = deps;

  let spriteTourPending = false;
  let spriteParkVisible = false;

  async function postAssistantJson(path, body) {
    if (fetchImpl && !deps.apiPostWithHotFallback) {
      const res = await fetchImpl(apiUrl(`./${String(path || "").replace(/^\/+/, "")}`), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      if (!res.ok) throw new Error(`请求失败（${res.status}）`);
      return res.json();
    }
    return apiPost(path, body);
  }

  function cancelPendingProposalOnServer(proposal) {
    const id = String(proposal?.id || "").trim();
    if (!id || isDemoMode()) return;
    void postAssistantJson("api/assistant/action", { proposalId: id, cancel: true }).catch(() => {});
  }

  function logSpritePhoneEvent(event, { callId = "", turnId = "", fromPhase = "", toPhase = "", detail = null } = {}) {
    const cid = String(callId || state.sprite.phoneCallId || "").trim();
    const fetchFn = getFetch();
    if (!cid || isDemoMode() || !fetchFn) return;
    void fetchFn(apiUrl("./api/assistant/phone-log"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callId: cid,
        turnId: String(turnId || state.sprite.phoneTurnId || "").trim(),
        event,
        fromPhase,
        toPhase,
        ...(detail !== null && detail !== undefined ? { detail } : {}),
      }),
    }).catch(() => {});
  }

  function transitionPhonePhase(nextPhase, { callId = "", turnId = "", detail = null, force = false } = {}) {
    const target = VALID_PHONE_PHASES.has(nextPhase) ? nextPhase : "idle";
    const prevPhase = state.sprite.phonePhase || "idle";
    state.sprite.phonePhase = target;
    if (state.sprite.phoneCallActive && (force || prevPhase !== target)) {
      logSpritePhoneEvent("state_change", { callId, turnId, fromPhase: prevPhase, toPhase: target, detail });
    }
    return prevPhase;
  }

  function setSpriteViewMode(nextMode, { render = true } = {}) {
    const target = VALID_VIEW_MODES.has(nextMode) ? nextMode : "popover";
    state.sprite.viewMode = target;
    if (render) renderSpriteAssistantMount();
    return target;
  }

  function formatSpriteTimerText(sec = 0) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const m = String(Math.floor(s / 60)).padStart(2, "0");
    const r = String(s % 60).padStart(2, "0");
    return `${m}:${r}`;
  }

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

  function syncTycoon3DPauseForSprite() {
    const t3d = getTycoon3d?.();
    if (!t3d) return;
    const isFs = state.sprite.viewMode === "fullscreen" || state.sprite.viewMode === "phone";
    if (isFs) {
      t3d.pause?.();
    } else if (isBoardViewActive() && state.boardViewMode === "tycoon3d" && !state.scopedProjectCwd) {
      t3d.resume?.();
    }
  }

  function syncVoiceTopbarLiveCallBadge() {
    const btn = $("voiceModeBtn");
    const badge = $("voiceLiveCallBadge");
    const inPhone = state.sprite.viewMode === "phone";
    const active = Boolean(state.sprite.phoneCallActive);
    if (btn) btn.classList.toggle("is-calling", active);
    if (badge) {
      badge.hidden = !(active && !inPhone);
      if (active && !inPhone) {
        badge.textContent = formatSpriteTimerText(state.sprite.phoneElapsedSec);
      }
    }
  }

  async function loadSpriteModelOptions({ force = false } = {}) {
    if (!force && state.sprite.modelOptions.length && Date.now() - state.sprite.modelsLoadedAt < 120_000) {
      return;
    }
    try {
      const res = await apiGet("/api/assistant/models");
      if (Array.isArray(res?.options) && res.options.length) {
        state.sprite.modelOptions = res.options;
        state.sprite.modelsLoadedAt = Date.now();
        renderSpriteAssistantMount();
      }
    } catch {}
  }

  function enterSpriteFullscreen() {
    setTopbarMenuOpen(false);
    setComposerConfigOpen(false);
    state.sprite.open = true;
    state.sprite.unreadCount = 0;
    state.sprite.toastBubble = null;
    void loadSpriteModelOptions();
    if (!state.missionOverview && !state.missionOverviewLoading) {
      void loadMissionOverview({ trigger: "open" });
    }
    setSpriteViewMode("fullscreen");
    raf(() => $("spriteFullscreenInput")?.focus());
  }

  function exitSpriteFullscreen() {
    setSpriteViewMode("popover");
  }

  function exitSpriteOverlayForNavigation() {
    if (state.sprite.viewMode === "fullscreen" || state.sprite.viewMode === "phone") {
      setSpriteViewMode("popover");
    }
  }

  function minimizeSpritePhoneCall() {
    setSpriteViewMode("popover");
    if (state.sprite.phoneCallActive) {
      showToastBanner("小精灵通话已在后台保持", { detail: "点击顶部「小精灵」可随时回到通话界面" });
    }
  }

  async function enterSpritePhoneCall() {
    ensureVoiceAudioUnlocked();
    setTopbarMenuOpen(false);
    setComposerConfigOpen(false);
    state.sprite.open = true;
    state.sprite.unreadCount = 0;
    state.sprite.toastBubble = null;
    if (!state.sprite.phoneCallActive) {
      state.sprite.phoneCallActive = true;
      state.sprite.phoneMuted = false;
      state.sprite.phoneStartedAt = Date.now();
      state.sprite.phoneElapsedSec = 0;
      state.sprite.phonePhase = "listening";
      state.sprite.phoneCallId = `spcall-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      state.sprite.phoneTurnId = "";
      state.sprite.phonePendingTurns = [];
      state.sprite.micRecoveryCount = 0;
      logSpritePhoneEvent("call_start", { callId: state.sprite.phoneCallId, toPhase: "listening" });
      if (state.sprite.phoneTimerId) clearInterval(state.sprite.phoneTimerId);
      state.sprite.phoneTimerId = setInterval(() => {
        if (!state.sprite.phoneCallActive) return;
        const elapsed = Math.floor((Date.now() - state.sprite.phoneStartedAt) / 1000);
        state.sprite.phoneElapsedSec = elapsed;
        const tEl = $("spritePhoneTimer");
        if (tEl) tEl.textContent = formatSpriteTimerText(elapsed);
        const badgeEl = $("voiceLiveCallBadge");
        if (badgeEl && !badgeEl.hidden) badgeEl.textContent = formatSpriteTimerText(elapsed);
      }, 1000);
      state.sprite.phoneTimerId.unref?.();
      void requestVoiceWakeLock();
      const warmCall = deps.apiPostWithHotFallback
        ? apiPostWithHotFallback("api/assistant/call/warm", {})
        : postAssistantJson("api/assistant/call/warm", {});
      void warmCall.then((warm) => {
        if (Array.isArray(warm?.options) && warm.options.length) {
          state.sprite.modelOptions = warm.options;
          state.sprite.modelsLoadedAt = Date.now();
          renderSpriteAssistantMount();
        }
        if (
          Array.isArray(warm?.notices)
          && warm.notices.length > 0
          && state.sprite.phoneCallActive
          && state.sprite.phonePhase === "listening"
          && !state.sprite.speechActive
          && !state.sprite.busy
          && !state.sprite.speaking
          && !state.sprite.transcribing
          && state.sprite.phonePendingTurns.length === 0
        ) {
          const noticeItems = warm.notices.slice(0, 2);
          const briefSpoken = `接通了，先同步一下：${noticeItems.map((n) => n.text).join("；")}。`;
          pushSpriteMessage({
            role: "sprite",
            tone: noticeItems.some((n) => n.kind === "failed") ? "worry" : "good",
            text: briefSpoken,
            spokenText: briefSpoken,
            notices: noticeItems,
          });
        }
      }).catch(() => {});
      setSpriteViewMode("phone");
      await startSpriteMic({ handsFree: true });
    } else {
      setSpriteViewMode("phone");
    }
  }

  async function hangupSpritePhoneCall() {
    const oldCallId = state.sprite.phoneCallId;
    const prevPhase = state.sprite.phonePhase;
    try { state.sprite.phoneAbortController?.abort(); } catch {}
    state.sprite.phoneAbortController = null;
    state.sprite.phoneCallActive = false;
    state.sprite.phoneMuted = false;
    state.sprite.phonePhase = "idle";
    state.sprite.phonePendingTurns = [];
    state.sprite.phoneCallId = "";
    state.sprite.phoneTurnId = "";
    state.sprite.voiceLevel = 0;
    if (state.sprite.phoneTimerId) {
      clearInterval(state.sprite.phoneTimerId);
      state.sprite.phoneTimerId = null;
    }
    stopSpriteSpeech();
    await stopSpriteMic({ submit: false, stopHandsFree: true });
    state.sprite.micStatus = "idle";
    state.sprite.micError = "";
    state.sprite.micRecoveryCount = 0;
    void releaseVoiceWakeLock();
    if (oldCallId) {
      logSpritePhoneEvent("call_end", { callId: oldCallId, fromPhase: prevPhase, toPhase: "idle" });
      void apiPostWithHotFallback("api/voice/call/end", { callId: oldCallId }).catch(() => {});
    }
    setSpriteViewMode(state.sprite.viewMode === "phone" ? "popover" : state.sprite.viewMode);
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

  function renderSpriteAssistantMount() {
    const fsMount = $("spriteFullscreenMount");
    const docObj = getDoc();
    let isFs = state.sprite.viewMode === "fullscreen" || state.sprite.viewMode === "phone";
    const { agentOptions } = buildDispatchAgentContext();
    const excludedAgentKeys = Array.isArray(state.missionOverview?.meta?.dispatchPrefs?.excludedAgentKeys)
      ? state.missionOverview.meta.dispatchPrefs.excludedAgentKeys
      : [];

    if (fsMount) {
      const liveFsInput = $("spriteFullscreenInput");
      if (liveFsInput && docObj?.activeElement === liveFsInput) {
        state.sprite.draft = liveFsInput.value;
      }
      if (isFs) {
        try {
          const prevFsFeed = $("spriteFullscreenFeed");
          const prevPhFeed = $("spritePhoneTranscript");
          const activeFeed = state.sprite.viewMode === "phone" ? prevPhFeed : prevFsFeed;
          const nearBottom = !activeFeed || (activeFeed.scrollHeight - activeFeed.scrollTop - activeFeed.clientHeight <= 32);
          const fsHtml = state.sprite.viewMode === "phone"
            ? renderSpritePhoneCallHtml(state.sprite)
            : renderSpriteFullscreenHtml(state.sprite, { agentOptions, excludedAgentKeys, renderMarkdown });
          const changed = replaceHtmlPreservingUiState(fsMount, fsHtml, {
            skipIds: new Set(["spriteFullscreenFeed", "spritePhoneTranscript"]),
          });
          fsMount.hidden = false;
          if (changed && nearBottom) {
            const nextFeed = state.sprite.viewMode === "phone" ? $("spritePhoneTranscript") : $("spriteFullscreenFeed");
            if (nextFeed) nextFeed.scrollTop = nextFeed.scrollHeight;
          }
        } catch (error) {
          console.error("[sprite] fullscreen render failed:", error);
          state.sprite.viewMode = "popover";
          isFs = false;
          fsMount.hidden = true;
          fsMount._acLastHtml = "";
          try { fsMount.innerHTML = ""; } catch {}
          showToastBanner("小精灵全屏渲染异常，已自动退回", { detail: formatActionError(error), error: true });
        }
      } else {
        fsMount.hidden = true;
        if (fsMount._acLastHtml || fsMount.innerHTML) {
          fsMount._acLastHtml = "";
          fsMount.innerHTML = "";
        }
      }
    }

    syncTycoon3DPauseForSprite();
    syncVoiceTopbarLiveCallBadge();

    const t3d = getTycoon3d?.();
    const mount = $("spriteAssistantMount");
    const is3d = Boolean(isBoardViewActive() && state.boardViewMode === "tycoon3d" && !state.scopedProjectCwd);
    const hasPendingCard = Boolean(
      state.sprite.pendingPreview
      || state.sprite.pendingArchive
      || state.sprite.pendingReorg
      || state.sprite.pendingProposal,
    );
    const badgeCount = state.sprite.unreadCount + (hasPendingCard ? 1 : 0);
    state.sprite.context = buildSpriteContext(findOverviewTopicById(state.sprite.scopedTopicId || state.tycoonSelectedTopicId), state.missionOverview);
    t3d?.setUserBusy?.(is3d && !isFs && (state.sprite.open || state.sprite.busy || state.sprite.recording));
    if (state.sprite.recording) t3d?.setSpriteMood?.("listening");
    const effMood = hasPendingCard ? "coin" : state.sprite.mood;
    if (!t3d?.setSpriteMood) t3d?.syncSpriteState?.({ badgeCount: state.sprite.open ? 0 : badgeCount, mood: effMood });
    if (!mount || !is3d || isFs) {
      if (mount) {
        mount.hidden = true;
        mount._acLastStableHtml = "";
        mount._acLastHtml = "";
        mount.innerHTML = "";
      }
      return;
    }
    mount.hidden = false;

    const hasInspector = Boolean(
      state.tycoonInspectorMode === "unassigned"
      || state.tycoonInspectorMode === "incubator"
      || state.tycoonInspectorMode === "recent_done"
      || state.tycoonInspectorMode === "room"
      || state.tycoonInspectorMode === "cluster"
      || state.tycoonInspectorMode === "directory"
      || state.tycoonSelectedTopicId,
    );
    mount.classList.add("is-3d");
    mount.classList.remove("is-2d", "is-chat", "is-chat-idle");
    mount.classList.toggle("has-inspector", hasInspector);
    mount.classList.toggle("is-open", Boolean(state.sprite.open));

    const liveInput = $("spriteCommandInput");
    if (liveInput && docObj?.activeElement === liveInput) {
      state.sprite.draft = liveInput.value;
    }

    for (const input of mount.querySelectorAll("[data-sprite-continue-message]")) {
      state.sprite.continueDrafts ||= {};
      state.sprite.continueDrafts[input.dataset.spriteContinueMessage] = input.value;
    }
    const wasOpen = Boolean(mount._acSpriteWasOpen);
    const prevToastText = mount._acPrevToastText || "";
    const curToastText = !state.sprite.open && state.sprite.toastBubble?.text ? String(state.sprite.toastBubble.text) : "";
    const enteringOpen = Boolean(state.sprite.open && !wasOpen);
    const enteringToast = Boolean(curToastText && curToastText !== prevToastText);

    mount._acSpriteWasOpen = Boolean(state.sprite.open);
    mount._acPrevToastText = curToastText;

    const msgs = Array.isArray(state.sprite.messages) ? state.sprite.messages : [];
    const lastMsgId = msgs.length ? String(msgs[msgs.length - 1]?.id || msgs.length) : "";
    const isNewMsg = Boolean(lastMsgId && lastMsgId !== mount._acLastMsgId);
    mount._acLastMsgId = lastMsgId;

    const prevFeedEl = $("spriteFeedList");
    const feedWasNearBottom = !prevFeedEl
      || (prevFeedEl.scrollHeight - prevFeedEl.scrollTop - prevFeedEl.clientHeight <= 28);
    const shouldPinFeedToBottom = enteringOpen || isNewMsg || feedWasNearBottom;

    const stableHtml = renderSpriteAssistantHtml(state.sprite, {
      is3dMode: is3d,
      enteringOpen: false,
      enteringToast: false,
      agentOptions,
      excludedAgentKeys,
      renderMarkdown,
    });
    if (!enteringOpen && !enteringToast && mount._acLastStableHtml === stableHtml) {
      return;
    }
    mount._acLastStableHtml = stableHtml;

    const renderHtml = (enteringOpen || enteringToast)
      ? renderSpriteAssistantHtml(state.sprite, {
          is3dMode: is3d,
          enteringOpen,
          enteringToast,
          agentOptions,
          excludedAgentKeys,
          renderMarkdown,
        })
      : stableHtml;

    replaceHtmlPreservingUiState(mount, renderHtml, {
      skipIds: shouldPinFeedToBottom ? new Set(["spriteFeedList"]) : null,
    });

    if (shouldPinFeedToBottom) {
      const feedEl = $("spriteFeedList");
      if (feedEl) {
        feedEl.scrollTop = feedEl.scrollHeight;
      }
    }

    if (enteringOpen || enteringToast) {
      setTimeout(() => {
        for (const animEl of mount.querySelectorAll(".is-entering")) {
          animEl.classList.remove("is-entering");
        }
      }, 220);
    }
  }

  function pushSpriteMessage({
    role = "sprite",
    tone = "idle",
    text = "",
    spokenText = "",
    chips = [],
    popToast = false,
    ttsPayload = null,
    sources = [], links = [], actions = [], notices = [], candidates = [], originalText = "", trace = null, traceSteps = null, executedTag = "",
  } = {}) {
    const cleanText = String(text || "").trim();
    if (!cleanText) return;
    state.sprite.messages.push({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role,
      tone,
      text: cleanText,
      spokenText: String(spokenText || "").trim(),
      chips: Array.isArray(chips) ? chips : [],
      sources, links: Array.isArray(links) ? links : [], actions, notices: Array.isArray(notices) ? notices : [], candidates, originalText, trace, traceSteps, executedTag,
    });
    if (state.sprite.messages.length > 48) {
      state.sprite.messages = state.sprite.messages.slice(-48);
    }
    if (role === "sprite") {
      state.sprite.mood = tone || "idle";
      if (!state.sprite.open && popToast) {
        state.sprite.unreadCount += 1;
        state.sprite.toastBubble = { text: cleanText, tone: tone || "idle" };
        if (state.sprite.toastTimer) clearTimeout(state.sprite.toastTimer);
        state.sprite.toastTimer = setTimeout(() => {
          state.sprite.toastBubble = null;
          state.sprite.toastTimer = null;
          renderSpriteAssistantMount();
        }, 9500);
      }
    }
    renderSpriteAssistantMount();
    if (role === "sprite" && !trace && (state.sprite.ttsEnabled || state.sprite.phoneCallActive) && !ttsPayload?.skipAutoSpeak) {
      void speakSpriteText(spokenText || cleanText, { ttsPayload });
    }
  }

  function syncSpriteWithOverview(overview) {
    if (!overview || !Array.isArray(overview.domains)) return;
    const nextSnap = captureSpriteOverviewSnapshot(overview, state.threads);
    if (!nextSnap) return;
    const onOverviewScreen = isBoardViewActive() && isOverviewBoardMode() && !state.scopedProjectCwd;

    if (!state.sprite.greetedSession && onOverviewScreen) {
      state.sprite.greetedSession = true;
      state.sprite.prevSnapshot = nextSnap;
      const brief = buildSpriteOpeningBriefing(overview, state.threads);
      pushSpriteMessage({
        role: "sprite",
        tone: brief.tone,
        text: brief.text,
        spokenText: brief.spokenText,
        chips: brief.chips,
        popToast: true,
      });
      return;
    }

    if (state.sprite.prevSnapshot) {
      const events = diffSpriteOverviewEvents(state.sprite.prevSnapshot, nextSnap, {
        recentCompletedByThread: state.recentCompletedByThread,
      });
      state.sprite.prevSnapshot = nextSnap;
      if (onOverviewScreen && !state.sprite.phoneCallActive && events.length > 0) {
        for (const ev of events.slice(0, 2)) {
          pushSpriteMessage({
            role: "sprite",
            tone: ev.tone,
            text: ev.text,
            spokenText: ev.spokenText,
            chips: ev.chips,
            popToast: true,
          });
        }
      }
      return;
    }

    state.sprite.prevSnapshot = nextSnap;
  }

  function summonSpriteForTopic(topicId = "") {
    const tp = findOverviewTopicById(topicId);
    if (!tp) {
      toggleSpriteAssistant({ open: true });
      return;
    }
    state.sprite.scopedTopicId = tp.id;
    state.sprite.scopedTopicName = tp.name || tp.id;
    state.sprite.open = true;
    state.sprite.unreadCount = 0;
    state.sprite.toastBubble = null;
    const brief = buildSpriteTopicBriefing(tp);
    pushSpriteMessage({
      role: "sprite",
      tone: brief.tone,
      text: brief.text,
      spokenText: brief.spokenText,
      chips: brief.chips,
    });
    setTimeout(() => $("spriteCommandInput")?.focus(), 30);
  }

  async function requestSpriteArchivePreview({ topicId = "", staleDays = 3 } = {}) {
    const targetId = topicId || state.sprite.scopedTopicId || state.tycoonSelectedTopicId || "";
    if (!targetId) {
      state.sprite.open = true;
      pushSpriteMessage({
        role: "sprite",
        tone: "idle",
        text: "请先点开要整理的产线召唤小精灵，或在指令中说出产线名称（例如：「把国内漫剧过去很久的对话归档总结」）。",
      });
      return;
    }
    const tp = findOverviewTopicById(targetId);
    if (tp) {
      state.sprite.scopedTopicId = tp.id;
      state.sprite.scopedTopicName = tp.name || tp.id;
    }
    state.sprite.open = true;
    state.sprite.busy = true;
    state.sprite.pendingPreview = null;
    renderSpriteAssistantMount();
    try {
      const res = await apiPost("/api/overview/archive-digest", {
        topicId: targetId,
        staleDays,
        confirmOnly: true,
      });
      state.sprite.pendingArchive = {
        topicId: res.topicId || targetId,
        topicName: res.topicName || tp?.name || targetId,
        staleDays: Number(res.staleDays ?? staleDays),
        candidates: Array.isArray(res.candidates) ? res.candidates : [],
        memoryVault: Boolean(res.memoryVault),
      };
      const count = state.sprite.pendingArchive.candidates.length;
      const msg = count > 0
        ? `已在「${state.sprite.pendingArchive.topicName}」筛出 ${count} 条闲置满 ${state.sprite.pendingArchive.staleDays} 天的历史会话。点下方「确认归档」或说「确认」，${state.sprite.pendingArchive.memoryVault ? "我会先把值得长期保留的成果落进共享记忆库，再批量归档。" : "我将批量归档并提炼产线记忆摘要。"}`
        : `「${state.sprite.pendingArchive.topicName}」目前没有闲置满 ${state.sprite.pendingArchive.staleDays} 天的会话，可在预览卡切换「≥1天」。`;
      pushSpriteMessage({
        role: "sprite",
        tone: count > 0 ? "coin" : "idle",
        text: msg,
        spokenText: count > 0 ? `筛出 ${count} 条闲置会话，确认后将归档并提炼产线记忆摘要。` : "当前没有符合天数的闲置会话。",
      });
    } catch (error) {
      pushSpriteMessage({
        role: "sprite",
        tone: "urgent",
        text: `筛选待归档会话失败：${formatActionError(error)}`,
      });
    } finally {
      state.sprite.busy = false;
      renderSpriteAssistantMount();
    }
  }

  async function confirmSpriteArchivePreview() {
    const pending = state.sprite.pendingArchive;
    if (!pending?.topicId || state.sprite.busy) return;
    const ids = (pending.candidates || []).map((c) => c.id).filter(Boolean);
    if (!ids.length) return;
    state.sprite.busy = true;
    renderSpriteAssistantMount();
    try {
      const res = await apiPost("/api/overview/archive-digest", {
        topicId: pending.topicId,
        staleDays: pending.staleDays,
        threadIds: ids,
        preferredModel: state.missionOverview?.meta?.preferredModel || "auto",
        confirmOnly: false,
      });
      state.sprite.pendingArchive = null;
      if (res?.overview) {
        state.missionOverview = res.overview;
      }
      void refreshThreads().catch(() => {});
      const summary = res?.digest?.summary || "";
      const archivedCount = res?.archivedCount || ids.length;
      const toVault = Boolean(res?.digest?.memory);
      const msg = toVault
        ? `已完成！先落记忆再归档了 ${archivedCount} 条历史会话（新会话会通过共享记忆指针检索）：\n${summary}`
        : `已完成！共归档 ${archivedCount} 条历史会话，并已提炼双存「产线归档记忆」（后续新开分身工位将自动继承）：\n${summary}`;
      pushSpriteMessage({
        role: "sprite",
        tone: "work",
        text: msg,
        spokenText: toVault
          ? `已把成果落进记忆库，并归档 ${archivedCount} 条历史会话。`
          : `已成功归档 ${archivedCount} 条历史会话并生成产线记忆摘要，后续新开工单会自动继承。`,
      });
      renderProjectBoard();
    } catch (error) {
      pushSpriteMessage({
        role: "sprite",
        tone: "urgent",
        text: `执行归档总结失败：${formatActionError(error)}`,
      });
    } finally {
      state.sprite.busy = false;
      renderSpriteAssistantMount();
    }
  }

  function handleSpriteActionEvent(sAct, spriteActionBtn) {
    if (sAct === "hud-more") {
      const panel = $("tycoonHudMore");
      panel?.classList.toggle("is-expanded");
      spriteActionBtn?.setAttribute("aria-expanded", String(panel?.classList.contains("is-expanded")));
    } else if (sAct === "open-sidebar") {
      setSidebarOpen(true);
    } else if (sAct === "enter-fullscreen") {
      enterSpriteFullscreen();
    } else if (sAct === "exit-fullscreen") {
      exitSpriteFullscreen();
    } else if (sAct === "enter-phone") {
      void enterSpritePhoneCall();
    } else if (sAct === "minimize-phone") {
      minimizeSpritePhoneCall();
    } else if (sAct === "hangup-phone") {
      void hangupSpritePhoneCall();
    } else if (sAct === "toggle-phone-mute") {
      toggleSpritePhoneMute();
    } else if (sAct === "toggle-phone-keyboard") {
      state.sprite.phoneKeyboardOpen = !state.sprite.phoneKeyboardOpen;
      renderSpriteAssistantMount();
      if (state.sprite.phoneKeyboardOpen) raf(() => $("spritePhoneTextInput")?.focus());
    } else if (sAct === "toggle-phone-auto-exec") {
      state.sprite.phoneAutoExecute = !state.sprite.phoneAutoExecute;
      saveSpritePrefs({ phoneAutoExecute: state.sprite.phoneAutoExecute });
      renderSpriteAssistantMount();
    } else if (sAct === "phone-orb") {
      ensureVoiceAudioUnlocked();
      const micCtx = state.sprite.mic?.audioCtx;
      if (micCtx && micCtx.state !== "running" && typeof micCtx.resume === "function") {
        void micCtx.resume().catch(() => {});
      }
      if (state.sprite.speaking) {
        stopSpriteSpeech();
      } else if (state.sprite.phoneMuted) {
        toggleSpritePhoneMute();
      } else if (
        !state.sprite.recording
        || state.sprite.micStatus === "error"
        || state.sprite.micStatus === "stalled"
      ) {
        teardownSpriteMic();
        state.sprite.recording = false;
        state.sprite.micRecoveryCount = 0;
        void startSpriteMic({ handsFree: true });
      } else if (state.sprite.speechActive && state.sprite.mic.vad) {
        const flushed = state.sprite.mic.vad.flush();
        state.sprite.speechActive = false;
        if (flushed?.samples?.length >= 1600) {
          playVoiceEarcon("heard", state.sprite.mic?.audioCtx || state.voice?.audioCtx);
          void sendSpritePhoneTurn({ samples: flushed.samples });
        }
      } else if (!state.sprite.busy && !state.sprite.transcribing) {
        void sendSpritePhoneTurn({ transcriptText: "简单汇报一下现在园子里最需要我注意的事" });
      }
    } else if (sAct === "phone-replay-or-brief") {
      ensureVoiceAudioUnlocked();
      if (state.sprite.lastSpokenReply) {
        void speakSpriteText(state.sprite.lastSpokenReply, { ttsPayload: state.sprite.lastTtsPayload });
      } else {
        void sendSpritePhoneTurn({ transcriptText: "简单汇报一下现在园子里最需要我注意的事" });
      }
    } else if (sAct === "abort-ask") {
      state.sprite.askSeq += 1;
      if (state.sprite.askAbortController) {
        try { state.sprite.askAbortController.abort(); } catch {}
        state.sprite.askAbortController = null;
      }
      state.sprite.busy = false;
      state.sprite.thinkingLabel = "";
      if (state.sprite.phoneCallActive && !state.sprite.speaking) {
        transitionPhonePhase("listening", { detail: { reason: "abort" } });
      }
      getTycoon3d?.()?.setSpriteMood?.("idle");
      pushSpriteMessage({ role: "sprite", tone: "idle", text: "已停止本次思考。" });
    } else if (sAct === "new-chat") {
      state.sprite.askSeq += 1;
      if (state.sprite.askAbortController) {
        try { state.sprite.askAbortController.abort(); } catch {}
        state.sprite.askAbortController = null;
      }
      state.sprite.busy = false;
      state.sprite.thinkingLabel = "";
      state.sprite.messages = [];
      state.sprite.turns = [];
      cancelPendingProposalOnServer(state.sprite.pendingProposal);
      state.sprite.pendingProposal = null;
      state.sprite.sessionId = `sp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      renderSpriteAssistantMount();
      raf(() => $("spriteFullscreenInput")?.focus());
    } else if (sAct === "confirm-proposal") {
      void confirmSpriteProposal();
    } else if (sAct === "cancel-proposal") {
      cancelPendingProposalOnServer(state.sprite.pendingProposal);
      state.sprite.pendingProposal = null;
      pushSpriteMessage({ role: "sprite", tone: "idle", text: "好的，已取消该操作。" });
    } else if (sAct === "edit-dispatch") {
      state.sprite.draft = state.sprite.pendingPreview?.payload?.text || "";
      state.sprite.pendingPreview = null;
      renderSpriteAssistantMount();
      ($("spriteFullscreenInput") || $("spriteCommandInput"))?.focus();
    } else if (sAct === "load-memory" || sAct === "clear-memory") {
      void apiRequest("/api/assistant/profile", { method: sAct === "clear-memory" ? "DELETE" : "GET" }).then((profile) => {
        state.sprite.profile = sAct === "clear-memory" ? { aliases: {} } : profile;
        renderSpriteAssistantMount();
      }).catch((error) => pushSpriteMessage({ text: formatActionError(error), tone: "worry" }));
    } else if (sAct === "tour-next" || sAct === "tour-skip") {
      if (state.sprite.tour) { state.sprite.tour.index += 1; void showSpriteTourStop(); }
    } else if (sAct === "tour-end") {
      endSpriteTour();
    } else if (sAct === "toggle") {
      toggleSpriteAssistant();
    } else if (sAct === "open") {
      toggleSpriteAssistant({ open: true });
    } else if (sAct === "close") {
      toggleSpriteAssistant({ open: false });
    } else if (sAct === "dismiss-toast") {
      state.sprite.toastBubble = null;
      if (state.sprite.toastTimer) {
        clearTimeout(state.sprite.toastTimer);
        state.sprite.toastTimer = null;
      }
      renderSpriteAssistantMount();
    } else if (sAct === "toggle-dispatch-prefs") {
      state.sprite.prefsOpen = !state.sprite.prefsOpen;
      renderSpriteAssistantMount();
    } else if (sAct === "toggle-tts") {
      const nextTts = !state.sprite.ttsEnabled;
      state.sprite.ttsEnabled = nextTts;
      saveSpritePrefs({ ttsEnabled: nextTts });
      if (!nextTts) stopSpriteSpeech();
      renderSpriteAssistantMount();
      showToastBanner(nextTts ? "已开启小精灵语音播报" : "已静音小精灵语音播报");
    } else if (sAct === "briefing") {
      const brief = buildSpriteOpeningBriefing(state.missionOverview, state.threads);
      pushSpriteMessage({
        role: "sprite",
        tone: brief.tone,
        text: brief.text,
        spokenText: brief.spokenText,
        chips: brief.chips,
      });
    } else if (sAct === "open-call") {
      void toggleSpriteHandsFree();
    } else if (sAct === "mic") {
      ensureVoiceAudioUnlocked();
      void toggleSpriteMic();
    } else if (sAct === "finish-mic") {
      void stopSpriteMic({ submit: true });
    } else if (sAct === "cancel-mic") {
      void stopSpriteMic({ submit: false });
    } else if (sAct === "stop-speech") {
      stopSpriteSpeech();
    } else if (sAct === "clear-scope") {
      state.sprite.scopedTopicId = "";
      state.sprite.scopedTopicName = "";
      renderSpriteAssistantMount();
    } else if (sAct === "confirm-reorg") {
      void confirmSpriteReorgPreview();
    } else if (sAct === "cancel-reorg") {
      state.sprite.pendingReorg = null;
      pushSpriteMessage({ role: "sprite", tone: "idle", text: "好的，已取消本次梦工厂布局调整。" });
    } else if (sAct === "reorg-guide") {
      pushSpriteMessage({
        role: "sprite",
        tone: "idle",
        text: "你可以直接语音或打字告诉我如何调整梦工厂，例如：\n•「把 xxx 改名为 yyy」\n•「把 xxx 移到内容工坊」\n•「把 A 和 B 合并」\n•「删除 xxx 产线」\n•「重新扫描本地仓库」",
      });
    } else if (sAct === "confirm-archive") {
      void confirmSpriteArchivePreview();
    } else if (sAct === "cancel-archive") {
      state.sprite.pendingArchive = null;
      pushSpriteMessage({ role: "sprite", tone: "idle", text: "好的，已取消本次归档操作。" });
    } else if (sAct === "confirm-dispatch") {
      void confirmSpriteDispatchPreview();
    } else if (sAct === "cancel-dispatch") {
      state.sprite.pendingPreview = null;
      pushSpriteMessage({ role: "sprite", tone: "idle", text: "好的，已取消本次派工预览。" });
    }
  }

  function focusSpriteTopic(tid = "") {
    if (!tid) return;
    if (state.sprite.viewMode === "fullscreen" || state.sprite.viewMode === "phone") {
      setSpriteViewMode("popover");
    }
    if (!isBoardViewActive() || state.scopedProjectCwd) {
      state.scopedProjectCwd = "";
      openProjectBoardView();
    }
    const t3d = getTycoon3d?.();
    if (state.boardViewMode === "tycoon3d") {
      state.tycoonSelectedTopicId = tid;
      state.tycoonInspectorMode = "topic";
      void t3d?.spriteVisit?.(tid);
      t3d?.flyToTopic?.(tid);
      renderProjectBoard();
    } else {
      renderProjectBoard();
      const card = getDoc()?.getElementById?.(`mo-topic-${tid}`);
      card?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    }
  }

  function handleSpriteDelegatedClick(e) {
    const openThreadBtn = e.target.closest("[data-board-open-thread]");
    if (openThreadBtn?.dataset.boardOpenThread) {
      e.stopPropagation();
      exitSpriteOverlayForNavigation();
      void selectThread(openThreadBtn.dataset.boardOpenThread, { focusSidebar: true }).catch((error) => {
        showToastBanner("打开会话失败", { detail: formatActionError(error), error: true });
      });
      return true;
    }
    const cardAction = e.target.closest("[data-sprite-card-action]");
    if (cardAction) { void actOnSpriteCard(cardAction.dataset.spriteCardId, cardAction.dataset.spriteCardAction); return true; }
    const answerAction = e.target.closest("[data-sprite-answer-action], [data-sprite-clarify-topic]");
    if (answerAction && !state.sprite.busy) {
      const message = state.sprite.messages.find((entry) => entry.id === (answerAction.dataset.spriteAnswerId || answerAction.dataset.spriteClarifyId));
      if (!message) return true;
      const action = answerAction.dataset.spriteClarifyTopic
        ? { type: "clarify_pick", payload: { alias: message.clarifyAlias, topicId: answerAction.dataset.spriteClarifyTopic } }
        : message.actions[Number(answerAction.dataset.spriteAnswerAction)];
      if (action) {
        if ((action.type === "focus" || action.type === "open_thread") && state.sprite.viewMode === "fullscreen") {
          setSpriteViewMode("popover");
        }
        void runSpriteAnswerAction(action, message).catch((error) => pushSpriteMessage({ text: formatActionError(error), tone: "worry" }));
      }
      return true;
    }
    const spriteActionBtn = e.target.closest("[data-sprite-action]");
    if (spriteActionBtn) {
      e.stopPropagation();
      handleSpriteActionEvent(spriteActionBtn.dataset.spriteAction, spriteActionBtn);
      return true;
    }
    const summonTopicBtn = e.target.closest("[data-sprite-summon-topic]");
    if (summonTopicBtn) {
      e.stopPropagation();
      summonSpriteForTopic(summonTopicBtn.dataset.spriteSummonTopic || "");
      return true;
    }
    const archiveTopicBtn = e.target.closest("[data-sprite-archive-topic]");
    if (archiveTopicBtn) {
      e.stopPropagation();
      void requestSpriteArchivePreview({ topicId: archiveTopicBtn.dataset.spriteArchiveTopic || "", staleDays: 3 });
      return true;
    }
    const archiveDaysBtn = e.target.closest("[data-sprite-archive-days]");
    if (archiveDaysBtn && state.sprite.pendingArchive?.topicId) {
      e.stopPropagation();
      const nextDays = Number.parseInt(archiveDaysBtn.dataset.spriteArchiveDays || "3", 10) || 3;
      void requestSpriteArchivePreview({ topicId: state.sprite.pendingArchive.topicId, staleDays: nextDays });
      return true;
    }
    const topicBriefBtn = e.target.closest("[data-sprite-topic-brief]");
    if (topicBriefBtn) {
      e.stopPropagation();
      summonSpriteForTopic(topicBriefBtn.dataset.spriteTopicBrief || "");
      return true;
    }
    const spriteSayBtn = e.target.closest("[data-sprite-say]");
    if (spriteSayBtn) {
      e.stopPropagation();
      void handleSpriteCommand(spriteSayBtn.dataset.spriteSay || "");
      return true;
    }
    const spriteFocusTopicBtn = e.target.closest("[data-sprite-focus-topic]");
    if (spriteFocusTopicBtn) {
      e.stopPropagation();
      focusSpriteTopic(spriteFocusTopicBtn.dataset.spriteFocusTopic || "");
      return true;
    }
    const spriteQuickPreviewBtn = e.target.closest("[data-sprite-quick-preview]");
    if (spriteQuickPreviewBtn) {
      e.stopPropagation();
      const qText = spriteQuickPreviewBtn.dataset.spriteQuickPreview || "";
      const qTopic = spriteQuickPreviewBtn.dataset.spriteQuickTopic || "";
      pushSpriteMessage({ role: "user", text: qText });
      void requestSpriteDispatchPreview({ instruction: qText, topicId: qTopic });
      return true;
    }
    return false;
  }

  function handleSpriteDelegatedChange(e) {
    const modelSelect = e.target.closest("[data-sprite-model-select]");
    if (modelSelect) {
      state.sprite.modelKey = modelSelect.value || "auto";
      saveSpritePrefs({ modelKey: state.sprite.modelKey });
      renderSpriteAssistantMount();
      return true;
    }
    const spriteInheritCheck = e.target.closest("[data-sprite-toggle-inherit]");
    if (spriteInheritCheck && state.sprite.pendingPreview?.payload) {
      const checked = Boolean(spriteInheritCheck.checked);
      state.dispatchInheritContext = checked;
      state.sprite.pendingPreview.payload.inheritContext = checked;
      renderSpriteAssistantMount();
      return true;
    }
    const spriteExcludeCheck = e.target.closest("[data-sprite-toggle-excluded]");
    if (spriteExcludeCheck) {
      const targetKey = String(spriteExcludeCheck.dataset.spriteToggleExcluded || "").trim();
      if (!targetKey) return true;
      const prev = Array.isArray(state.missionOverview?.meta?.dispatchPrefs?.excludedAgentKeys)
        ? state.missionOverview.meta.dispatchPrefs.excludedAgentKeys
        : [];
      const nextSet = new Set(prev);
      if (spriteExcludeCheck.checked) nextSet.add(targetKey);
      else nextSet.delete(targetKey);
      const excludedAgentKeys = [...nextSet];
      if (state.missionOverview) {
        if (!state.missionOverview.meta) state.missionOverview.meta = {};
        if (!state.missionOverview.meta.dispatchPrefs) state.missionOverview.meta.dispatchPrefs = {};
        state.missionOverview.meta.dispatchPrefs.excludedAgentKeys = excludedAgentKeys;
      }
      state.dispatchPreview = null;
      renderSpriteAssistantMount();
      void apiPost("/api/overview/dispatch-prefs", { excludedAgentKeys }).then((res) => {
        if (res?.overview) state.missionOverview = res.overview;
        renderSpriteAssistantMount();
        renderProjectBoard();
      }).catch((error) => {
        showToastBanner("保存跳过账号设置失败", { detail: formatActionError(error), error: true });
      });
      return true;
    }
    return false;
  }

  function toggleSpriteAssistant({ open = null } = {}) {
    const nextOpen = typeof open === "boolean" ? open : !state.sprite.open;
    state.sprite.open = nextOpen;
    if (nextOpen) {
      if (!state.sprite.scopedTopicId && state.tycoonSelectedTopicId) {
        const selTp = findOverviewTopicById(state.tycoonSelectedTopicId);
        if (selTp) {
          state.sprite.scopedTopicId = selTp.id;
          state.sprite.scopedTopicName = selTp.name || selTp.id;
        }
      }
      state.sprite.unreadCount = 0;
      state.sprite.toastBubble = null;
      if (state.sprite.toastTimer) {
        clearTimeout(state.sprite.toastTimer);
        state.sprite.toastTimer = null;
      }
      if (!state.sprite.messages.length && state.missionOverview) {
        const brief = buildSpriteOpeningBriefing(state.missionOverview, state.threads);
        state.sprite.messages.push({
          id: `init-${Date.now()}`,
          role: "sprite",
          tone: brief.tone,
          text: brief.text,
          chips: brief.chips,
        });
      }
    } else if (state.sprite.recording && !state.sprite.handsFree) {
      void stopSpriteMic({ submit: false });
    }
    renderSpriteAssistantMount();
    if (nextOpen) {
      setTimeout(() => $("spriteCommandInput")?.focus(), 30);
    }
  }

  async function requestSpriteDispatchPreview({ instruction = "", topicId = "", agentKey = "auto", mode = "auto" } = {}) {
    const cleanText = String(instruction || "").trim();
    if (!cleanText) return;
    state.sprite.open = true;
    state.sprite.busy = true;
    renderSpriteAssistantMount();
    try {
      const effectiveAgent = agentKey !== "auto" ? agentKey : (state.dispatchAgentKey || "auto");
      const effectiveModel = effectiveAgent !== "auto" ? (state.dispatchModel || "") : "";
      const payload = {
        text: cleanText,
        topicId: topicId || state.sprite.scopedTopicId || "",
        mode: mode || "auto",
        preferredProvider: "auto",
        agentKey: effectiveAgent,
        model: effectiveModel,
        inheritContext: state.dispatchInheritContext !== false,
      };
      const res = await submitSpriteDispatch(payload);
      if (res?.chatOnly) {
        const replyText = String(res.reply || "我在听，请告诉我你想安排的具体任务或项目。").trim();
        pushSpriteMessage({
          role: "sprite",
          tone: "idle",
          text: replyText,
          spokenText: replyText,
        });
        return;
      }
      const routes = Array.isArray(res?.routes) ? res.routes : [];
      if (!routes.length) {
        pushSpriteMessage({
          role: "sprite",
          tone: "urgent",
          text: "未能匹配到可派工的目标产线，请补充产线名称后再试。",
        });
        return;
      }
      state.sprite.pendingPreview = {
        payload,
        routes,
        aiPlanned: Boolean(res?.aiPlanned),
        aiModel: String(res?.aiModel || "").trim(),
        reply: String(res?.reply || "").trim(),
      };
      renderSpriteAssistantMount();
    } catch (error) {
      pushSpriteMessage({
        role: "sprite",
        tone: "urgent",
        text: `生成派工预览失败：${formatActionError(error)}`,
      });
    } finally {
      state.sprite.busy = false;
      renderSpriteAssistantMount();
    }
  }

  async function confirmSpriteDispatchPreview() {
    const preview = state.sprite.pendingPreview;
    if (!preview?.payload || state.sprite.busy) return;
    const { payload, routes } = preview;
    const chosenAgentKey = payload.agentKey || "auto";
    const missingAgent = routes.some((rt) => !rt.agentKey);
    const mismatched = chosenAgentKey !== "auto" && routes.some((rt) => rt.agentKey !== chosenAgentKey);
    if (missingAgent || mismatched) {
      pushSpriteMessage({
        role: "sprite",
        tone: "urgent",
        text: missingAgent
          ? "已拦截：后台服务还是旧版本（未返回账号归属），请先在版本弹窗点「重启服务」后再派单。"
          : `已拦截：后端解析出的账号与所选「${chosenAgentKey}」不一致，未执行派出。`,
      });
      return;
    }

    state.sprite.busy = true;
    renderSpriteAssistantMount();
    try {
      const res = await submitSpriteDispatch(payload, { confirmed: true, routes });
      state.sprite.pendingPreview = null;
      state.lastDispatchReceipt = res;
      if (res?.overview) {
        state.missionOverview = res.overview;
      }
      void refreshThreads().catch(() => {});
      const dispatched = Array.isArray(res?.dispatched) ? res.dispatched : [];
      if (dispatched.length > 0) {
        const first = dispatched[0];
        getTycoon3d?.()?.triggerDispatchBurst?.(first.topicId || "");
        const msgText = dispatched.length === 1
          ? `已派出员工入驻「${first.topicName}」！任务正在执行中。`
          : `已成功派出 ${dispatched.length} 名并发 AI 员工上岗！`;
        const chips = dispatched
          .filter((d) => d.threadId)
          .slice(0, 2)
          .map((d) => ({ kind: "thread", id: d.threadId, label: `进入：${d.topicName}` }));
        pushSpriteMessage({
          role: "sprite",
          tone: "work",
          text: msgText,
          spokenText: msgText,
          chips,
        });
      }
      renderProjectBoard();
    } catch (error) {
      pushSpriteMessage({
        role: "sprite",
        tone: "urgent",
        text: `派出失败：${formatActionError(error)}`,
      });
    } finally {
      state.sprite.busy = false;
      renderSpriteAssistantMount();
    }
  }

  async function requestSpriteReorgPreview({ instruction = "" } = {}) {
    const cleanText = String(instruction || "").trim();
    if (!cleanText || state.sprite.busy) return;
    state.sprite.busy = true;
    renderSpriteAssistantMount();
    try {
      const res = await apiPost("/api/overview/reorganize", {
        instruction: cleanText,
        confirmOnly: true,
      });
      const ops = Array.isArray(res?.operations) ? res.operations : [];
      if (!ops.length) {
        pushSpriteMessage({
          role: "sprite",
          tone: "idle",
          text: "未识别到需要调整的产线，请换个说法再试。",
        });
        return;
      }
      state.sprite.pendingReorg = {
        instruction: cleanText,
        summary: res.summary || "",
        operations: ops,
      };
      pushSpriteMessage({
        role: "sprite",
        tone: "coin",
        text: `已规划 ${ops.length} 项梦工厂布局调整：${res.summary || ""}。请点下方「确认调整」或直接说「确认」。`,
        spokenText: `已规划 ${ops.length} 项梦工厂布局调整，请确认是否应用。`,
      });
    } catch (error) {
      pushSpriteMessage({
        role: "sprite",
        tone: "urgent",
        text: `布局调整规划失败：${formatActionError(error)}`,
      });
    } finally {
      state.sprite.busy = false;
      renderSpriteAssistantMount();
    }
  }

  async function confirmSpriteReorgPreview() {
    const pending = state.sprite.pendingReorg;
    if (!pending?.operations?.length || state.sprite.busy) return;
    state.sprite.busy = true;
    renderSpriteAssistantMount();
    try {
      const res = await apiPost("/api/overview/reorganize", {
        instruction: pending.instruction || "",
        operations: pending.operations,
        confirmOnly: false,
      });
      state.sprite.pendingReorg = null;
      if (res?.overview) {
        state.missionOverview = res.overview;
        renderProjectBoard();
      }
      pushSpriteMessage({
        role: "sprite",
        tone: "work",
        text: `梦工厂布局已更新（应用 ${res?.appliedCount || pending.operations.length} 项）：${res?.summary || pending.summary}。`,
        spokenText: "梦工厂布局已更新。",
      });
    } catch (error) {
      pushSpriteMessage({
        role: "sprite",
        tone: "urgent",
        text: `应用布局调整失败：${formatActionError(error)}`,
      });
    } finally {
      state.sprite.busy = false;
      renderSpriteAssistantMount();
    }
  }

  async function confirmSpriteProposal() {
    const proposal = state.sprite.pendingProposal;
    if (!proposal || state.sprite.busy) return;
    state.sprite.busy = true;
    state.sprite.thinkingLabel = "正在执行操作…";
    renderSpriteAssistantMount();
    try {
      const res = await postAssistantJson("api/assistant/action", proposal.id ? { proposalId: proposal.id } : proposal);
      state.sprite.pendingProposal = null;
      const summary = res?.summary || "已执行";
      pushSpriteMessage({
        role: "sprite",
        tone: "good",
        text: `好的，${summary}。`,
        spokenText: `好的，${summary}。`,
        executedTag: summary,
      });
      void loadMissionOverview({ trigger: "assistant-action" });
      void refreshThreads().catch(() => {});
    } catch (error) {
      pushSpriteMessage({ role: "sprite", tone: "worry", text: `执行失败：${formatActionError(error)}` });
    } finally {
      state.sprite.busy = false;
      state.sprite.thinkingLabel = "";
      renderSpriteAssistantMount();
    }
  }

  async function applySpriteClientEffect(effect) {
    if (!effect || !effect.type) return;
    if (effect.type === "focus" && effect.topicId) {
      if (state.sprite.viewMode !== "phone") {
        focusSpriteTopic(effect.topicId);
      }
      return;
    }
    if (effect.type === "open_thread" && effect.threadId) {
      if (state.sprite.viewMode === "fullscreen") setSpriteViewMode("popover", { render: false });
      await selectThread(effect.threadId);
      return;
    }
    if (effect.type === "archive_preview") {
      await requestSpriteArchivePreview({ topicId: effect.topicId || "", staleDays: effect.staleDays || 3 });
      return;
    }
    if (effect.type === "reorg_preview" && effect.instruction) {
      await requestSpriteReorgPreview({ instruction: effect.instruction });
    }
  }

  async function requestSpriteAnswer(text) {
    const seq = (state.sprite.askSeq += 1);
    if (state.sprite.askAbortController) {
      try { state.sprite.askAbortController.abort(); } catch {}
    }
    const ac = new AbortController();
    state.sprite.askAbortController = ac;
    state.sprite.busy = true;
    state.sprite.thinkingLabel = "正在翻阅园区与记忆…";
    if (state.sprite.phoneCallActive) transitionPhonePhase("thinking");
    const t3d = getTycoon3d?.();
    t3d?.setSpriteMood?.("thinking");
    renderSpriteAssistantMount();
    const traceSteps = [];
    try {
      const answer = await askSpriteAssistant({
        text,
        contextTopicId: state.sprite.scopedTopicId || state.tycoonSelectedTopicId || undefined,
        history: state.sprite.turns.slice(-12),
        focus: state.sprite.focusStack,
        mode: state.sprite.viewMode === "phone" ? "phone" : "chat",
        modelKey: state.sprite.modelKey || "auto",
        sessionId: state.sprite.sessionId,
        proposalId: state.sprite.pendingProposal?.id || "",
        autoExecute: state.sprite.viewMode === "phone" ? (state.sprite.phoneAutoExecute !== false) : false,
      }, (trace) => {
        if (seq !== state.sprite.askSeq || ac.signal.aborted) return;
        traceSteps.push(trace);
        state.sprite.thinkingLabel = trace.label;
        t3d?.setSpriteMood?.("thinking", { bubble: trace.label });
        renderSpriteAssistantMount();
      }, { signal: ac.signal, ...(fetchImpl ? { fetchImpl } : {}) });
      if (seq !== state.sprite.askSeq || ac.signal.aborted) return;
      if (answer.kind !== "clarify") Object.assign(state.sprite, appendSpriteTurn(state.sprite, text, answer));
      if (answer.proposal) {
        state.sprite.pendingProposal = answer.proposal;
      } else if (answer.clearedProposal) {
        state.sprite.pendingProposal = null;
      }
      pushSpriteMessage({
        text: answer.text,
        spokenText: answer.spokenReply || answer.text,
        sources: answer.sources,
        links: answer.links || [],
        actions: (answer.actions || []).filter((action) => answer.kind !== "clarify" || action.type !== "clarify_pick"),
        notices: Array.isArray(answer.notices) ? answer.notices : [],
        candidates: answer.kind === "clarify" ? answer.candidates : [],
        originalText: text,
        traceSteps: traceSteps.length ? traceSteps : null,
        executedTag: answer.executedAction?.ok ? answer.executedAction.summary : "",
        tone: answer.mood || "report",
      });
      const lastMsg = state.sprite.messages.at(-1);
      if (lastMsg) {
        lastMsg.clarifyAlias = answer.actions?.find((action) => action.type === "clarify_pick")?.payload?.alias || text;
      }
      if (answer.executedAction?.ok) {
        void loadMissionOverview({ trigger: "assistant-action" });
        void refreshThreads().catch(() => {});
      }
      if (answer.clientEffect) {
        await applySpriteClientEffect(answer.clientEffect);
      } else if (answer.focusTopicId && state.boardOpen && state.boardViewMode === "tycoon3d" && state.sprite.viewMode === "popover") {
        void t3d?.spriteVisit?.(answer.focusTopicId);
      }
      t3d?.setSpriteMood?.(answer.mood || "report");
    } catch (error) {
      if (ac.signal.aborted || error?.aborted || error?.name === "AbortError") {
        if (seq === state.sprite.askSeq) {
          pushSpriteMessage({ text: "已停止本次思考。", tone: "idle" });
          t3d?.setSpriteMood?.("idle");
        }
        return;
      }
      if (seq === state.sprite.askSeq) {
        pushSpriteMessage({ text: t("问答暂时不可用：{error}", { error: formatActionError(error) }), tone: "worry" });
        t3d?.setSpriteMood?.("worry");
      }
    } finally {
      if (state.sprite.askAbortController === ac) {
        state.sprite.askAbortController = null;
      }
      if (seq === state.sprite.askSeq) {
        state.sprite.busy = false;
        state.sprite.thinkingLabel = "";
        if (state.sprite.phoneCallActive && !state.sprite.speaking) {
          transitionPhonePhase("listening");
        }
        renderSpriteAssistantMount();
      }
    }
  }

  function openSpriteCards(topicId, type) {
    const topic = findOverviewTopicById(topicId);
    state.sprite.cards = (topic?.assistantSignals?.cards || []).filter((card) => !type || card.type === type);
    state.sprite.continueDrafts = {};
    state.sprite.scopedTopicId = topicId || "";
    state.sprite.scopedTopicName = topic?.name || "";
    toggleSpriteAssistant({ open: true });
  }

  async function actOnSpriteCard(cardId, type) {
    if (state.sprite.busy) return;
    const card = state.sprite.cards.find((entry) => entry.id === cardId)
      || [...(state.missionOverview?.domains?.flatMap((d) => d.topics || []).flatMap((tp) => tp.assistantSignals?.cards || []) || []),
        ...(state.missionOverview?.assistantInbox?.cards || [])].find((entry) => entry.id === cardId);
    if (!card) return;
    if (type === "pin") { await pinThreadAsTicket(card.threadId); return; }
    if (type === "continue") {
      if (!state.sprite.cards.some((entry) => entry.id === cardId)) state.sprite.cards = [card];
      renderSpriteAssistantMount();
      return;
    }
    const input = [...(getDoc()?.querySelectorAll?.("[data-sprite-continue-message]") || [])].find((entry) => entry.dataset.spriteContinueMessage === cardId);
    const message = type === "send_continue" ? (input?.value ?? state.sprite.continueDrafts?.[cardId] ?? "").trim() : undefined;
    if (type === "send_continue" && !message) return;
    state.sprite.busy = true;
    renderSpriteAssistantMount();
    try {
      const result = await apiPost(`/api/assistant/cards/${encodeURIComponent(cardId)}/action`, {
        type: type === "send_continue" ? "continue" : type,
        ...(type === "snooze" ? { until: spriteTomorrowAtEight() } : {}), ...(message ? { message } : {}),
      });
      state.sprite.cards = state.sprite.cards.filter((entry) => entry.id !== cardId);
      const ack = { done: "好，记为完成", park: "先搁着，有新动静再说", snooze: "明早 8 点再提醒你", dismiss: card.ticketId ? "工单已放弃" : "这条以后不再提醒",
        send_continue: "已发回原工位接着做", retry: "已重新唤起定时任务" }[type];
      if (ack) getTycoon3d?.()?.spriteSay?.(t(ack), { proactive: false });
      if (type === "harvest" && result.threadId) await selectThread(result.threadId);
      void loadMissionOverview({ trigger: "assistant-action" });
    } catch (error) { pushSpriteMessage({ text: formatActionError(error), tone: "worry" }); }
    finally { state.sprite.busy = false; renderSpriteAssistantMount(); }
  }

  async function pinThreadAsTicket(threadId) {
    if (!threadId || state.sprite.busy) return;
    state.sprite.busy = true;
    renderSpriteAssistantMount();
    try {
      const { ticket } = await apiPost("/api/assistant/tickets", { threadId });
      const criteria = ticket.criteria?.length ? `\n${ticket.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}` : "";
      pushSpriteMessage({ text: `${t("已钉成任务：{title}", { title: ticket.title })}${ticket.goal ? `\n${t("目标")}：${ticket.goal}` : ""}${criteria}`,
        actions: [{ label: t("改验收：{title}", { title: ticket.title.slice(0, 6) }), type: "ticket_edit", payload: { ticketId: ticket.id } }] });
      state.sprite.cards = state.sprite.cards.map((c) => c.threadId === threadId ? { ...c, ticketId: ticket.id, goal: ticket.goal, criteria: ticket.criteria } : c);
      showToastBanner(t("已钉成任务：{title}", { title: ticket.title }));
      await refreshTasks();
      void loadMissionOverview({ trigger: "assistant-action" });
    } catch (error) {
      showToastBanner(t("钉成任务失败"), { detail: formatActionError(error), error: true });
    } finally { state.sprite.busy = false; renderSpriteAssistantMount(); }
  }

  async function editSpriteTicketCriteria(ticketId) {
    const ticket = (state.missionOverview?.assistantTickets || []).find((tk) => tk.id === ticketId)
      || (state.tasks || []).find((tk) => tk.id === ticketId);
    const next = typeof prompt === "function" ? prompt(t("验收标准，一行一条（留空表示不设）："), (ticket?.criteria || []).join("\n")) : null;
    if (next === null) return;
    const { ticket: saved } = await apiPost(`/api/assistant/tickets/${encodeURIComponent(ticketId)}`, { criteria: next.split(/\n+/).map((c) => c.trim()).filter(Boolean) });
    pushSpriteMessage({ text: t("任务「{title}」的验收标准已更新", { title: saved.title }) });
    await refreshTasks();
    void loadMissionOverview({ trigger: "assistant-action" });
  }

  async function maybeStartSpriteTour() {
    if (!state.missionOverview || spriteTourPending || spriteParkVisible || getDoc()?.hidden) return;
    spriteParkVisible = true;
    const now = new Date();
    let previous = null;
    try { previous = localStorage.getItem(SPRITE_LAST_SEEN_KEY); localStorage.setItem(SPRITE_LAST_SEEN_KEY, now.toISOString()); } catch {}
    const previousAt = new Date(previous || 0);
    const firstToday = previousAt.toDateString() !== now.toDateString();
    if (!firstToday && now - previousAt < 2 * 3600_000) return;
    spriteTourPending = true;
    try {
      const tour = await apiGet(`/api/assistant/tour${previous && now - previousAt >= 2 * 3600_000 ? `?since=${encodeURIComponent(previous)}` : ""}`);
      if (!spriteParkVisible) return;
      if (!tour.stops?.length) {
        const brief = buildSpriteOpeningBriefing(state.missionOverview, state.threads);
        getTycoon3d?.()?.spriteSay?.(brief.text, { proactive: true });
        return;
      }
      state.sprite.tour = { stops: tour.stops, index: 0 };
      await showSpriteTourStop();
    } catch (error) {
      if (!isDemoMode()) pushSpriteMessage({ text: t("巡园暂时不可用：{error}", { error: formatActionError(error) }) });
    } finally { spriteTourPending = false; }
  }

  async function showSpriteTourStop() {
    const tour = state.sprite.tour;
    const stop = tour?.stops[tour.index];
    if (!stop) { endSpriteTour(); return; }
    openSpriteCards(stop.topicId);
    state.sprite.cards = stop.cards || [];
    if (!stop.topicId) state.sprite.scopedTopicName = stop.topicTitle || "";
    renderSpriteAssistantMount();
    const t3d = getTycoon3d?.();
    if (stop.topicId) void t3d?.spriteVisit?.(stop.topicId, { bubble: stop.bubble });
    else t3d?.spriteSay?.(stop.bubble, { proactive: true });
  }

  function endSpriteTour() {
    state.sprite.tour = null;
    state.sprite.cards = [];
    renderSpriteAssistantMount();
  }

  function noteSpriteParkLeave() {
    if (!spriteParkVisible) return;
    spriteParkVisible = false;
    try { localStorage.setItem(SPRITE_LAST_SEEN_KEY, new Date().toISOString()); } catch {}
    getTycoon3d?.()?.setUserBusy?.(false);
  }

  async function runSpriteAnswerAction(action, message) {
    const payload = action.payload || {};
    if (action.type === "focus") { focusSpriteTopic(payload.topicId); return; }
    if (action.type === "open_thread") { await selectThread(payload.threadId); return; }
    if (action.type === "card_action") { await actOnSpriteCard(payload.cardId, payload.action); return; }
    if (action.type === "ticket_edit") { await editSpriteTicketCriteria(payload.ticketId); return; }
    if (action.type === "clarify_pick") {
      await apiPost("/api/assistant/profile/aliases", { alias: payload.alias, topicId: payload.topicId });
      await requestSpriteAnswer(message.originalText);
    }
  }

  async function sendSpritePhoneTurn({
    samples = null,
    transcriptText = "",
    overlapDurationMs = 0,
    overlapBotText = "",
  } = {}) {
    if (!state.sprite.phoneCallActive) return;
    if (samples?.length || String(transcriptText || "").trim()) {
      state.sprite.phonePendingTurns.push({
        samples,
        transcriptText: String(transcriptText || "").trim(),
        overlapDurationMs: Number(overlapDurationMs) || 0,
        overlapBotText: String(overlapBotText || ""),
      });
      state.sprite.phonePendingTurns = mergeQueuedVoiceTurns(state.sprite.phonePendingTurns);
    }
    if (state.sprite.busy || state.sprite.transcribing || state.sprite.speaking || !state.sprite.phonePendingTurns.length) {
      return;
    }
    const turn = state.sprite.phonePendingTurns.shift();
    const hasAudio = Boolean(turn.samples?.length);
    const cleanTranscript = String(turn.transcriptText || "").trim();
    const turnId = `spturn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
    state.sprite.phoneTurnId = turnId;
    if (cleanTranscript) {
      pushSpriteMessage({ role: "user", text: cleanTranscript });
    }
    state.sprite.transcribing = hasAudio && !cleanTranscript;
    state.sprite.busy = !state.sprite.transcribing;
    state.sprite.thinkingLabel = hasAudio ? "正在听清并思考…" : "小精灵正在想…";
    transitionPhonePhase("thinking", {
      turnId,
      detail: { hasAudio, hasTranscript: Boolean(cleanTranscript) },
    });
    renderSpriteAssistantMount();

    const abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
    state.sprite.phoneAbortController = abortController;
    const fetchFn = getFetch();
    try {
      const audioBase64 = hasAudio ? uint8ArrayToBase64(encodePcm16SamplesToWav(turn.samples, 16000)) : "";
      const reqPayload = {
        callId: state.sprite.phoneCallId,
        turnId,
        audioBase64,
        audioMimeType: hasAudio ? "audio/wav" : "",
        transcriptText: cleanTranscript,
        history: state.sprite.turns.slice(-12),
        focus: state.sprite.focusStack,
        contextTopicId: state.sprite.scopedTopicId || state.tycoonSelectedTopicId || undefined,
        modelKey: state.sprite.modelKey || "auto",
        sessionId: state.sprite.sessionId,
        autoExecute: state.sprite.phoneAutoExecute !== false,
        tts: true,
        proposalId: state.sprite.pendingProposal?.id || "",
        ...(turn.overlapDurationMs > 0 ? { overlapDurationMs: turn.overlapDurationMs } : {}),
        ...(turn.overlapBotText ? { overlapBotText: turn.overlapBotText } : {}),
      };

      const handlePhoneAnswer = async (heardTextVal, answerObj, { ttsPayload = null, streamTts = false } = {}) => {
        if (!state.sprite.phoneCallActive) return 0;
        state.sprite.transcribing = false;
        state.sprite.busy = false;
        state.sprite.thinkingLabel = "";
        const heard = String(heardTextVal || cleanTranscript || "").trim();
        if (heard && !cleanTranscript && !state.sprite._phoneTurnHeardPushed) {
          state.sprite._phoneTurnHeardPushed = true;
          pushSpriteMessage({ role: "user", text: heard });
        }
        const answer = answerObj || {};
        if (answer.proposal) {
          state.sprite.pendingProposal = answer.proposal;
        } else if (answer.clearedProposal) {
          state.sprite.pendingProposal = null;
        }
        if (heard && answer.text && answer.kind !== "clarify") {
          Object.assign(state.sprite, appendSpriteTurn(state.sprite, heard, answer));
        }
        if (answer.executedAction?.ok) {
          void loadMissionOverview({ trigger: "assistant-action" });
          void refreshThreads().catch(() => {});
        }
        if (answer.clientEffect) {
          await applySpriteClientEffect(answer.clientEffect);
        }
        const spokenText = answer.spokenReply || answer.text || "我在听。";
        let speechToken = 0;
        if (streamTts) {
          speechToken = beginSpriteSpeechStream(spokenText, { turnId });
        } else {
          transitionPhonePhase("speaking", { turnId });
        }
        pushSpriteMessage({
          role: "sprite",
          tone: answer.mood || "report",
          text: answer.text || answer.spokenReply || "我在听。",
          spokenText,
          sources: answer.sources || [],
          links: answer.links || [],
          actions: answer.actions || [],
          notices: Array.isArray(answer.notices) ? answer.notices : [],
          executedTag: answer.executedAction?.ok ? answer.executedAction.summary : "",
          ttsPayload: streamTts ? { skipAutoSpeak: true } : ttsPayload,
        });
        return speechToken;
      };

      state.sprite._phoneTurnHeardPushed = false;
      if (isDemoMode() || !fetchFn) {
        const res = await apiPostWithHotFallback("api/assistant/voice-turn", reqPayload);
        state.sprite.transcribing = false;
        state.sprite.busy = false;
        state.sprite.thinkingLabel = "";
        if (res?.noSpeech) {
          transitionPhonePhase("listening", { turnId, detail: { reason: "no_speech" } });
          renderSpriteAssistantMount();
          if (state.sprite.phonePendingTurns.length > 0) void sendSpritePhoneTurn();
          return;
        }
        await handlePhoneAnswer(res?.heardText, res?.answer, { ttsPayload: res?.tts || null, streamTts: false });
        return;
      }

      const response = await fetchFn(apiUrl("./api/assistant/voice-turn"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify(reqPayload),
        ...(abortController ? { signal: abortController.signal } : {}),
      });
      if (!response.ok) throw new Error(`语音通话请求失败（${response.status}）`);

      if (!(response.headers.get("content-type") || "").includes("ndjson")) {
        const res = await response.json();
        state.sprite.transcribing = false;
        state.sprite.busy = false;
        state.sprite.thinkingLabel = "";
        if (res?.noSpeech) {
          transitionPhonePhase("listening", { turnId, detail: { reason: "no_speech" } });
          renderSpriteAssistantMount();
          if (state.sprite.phonePendingTurns.length > 0) void sendSpritePhoneTurn();
          return;
        }
        await handlePhoneAnswer(res?.heardText, res?.answer, { ttsPayload: res?.tts || null, streamTts: false });
        return;
      }

      let remainder = "";
      let speechToken = 0;
      let streamNoSpeech = false;
      const consumeEvt = async (evt) => {
        if (!evt || evt.type === "ping" || !state.sprite.phoneCallActive) return;
        if (evt.type === "no_speech") {
          streamNoSpeech = true;
          state.sprite.transcribing = false;
          state.sprite.busy = false;
          state.sprite.thinkingLabel = "";
          transitionPhonePhase("listening", { turnId, detail: { reason: "no_speech" } });
          renderSpriteAssistantMount();
          return;
        }
        if (evt.type === "heard") {
          state.sprite.transcribing = false;
          state.sprite.busy = true;
          transitionPhonePhase("thinking", { turnId });
          state.sprite.thinkingLabel = "小精灵正在想…";
          const heard = String(evt.heardText || cleanTranscript || "").trim();
          if (heard && !cleanTranscript && !state.sprite._phoneTurnHeardPushed) {
            state.sprite._phoneTurnHeardPushed = true;
            pushSpriteMessage({ role: "user", text: heard });
          } else {
            renderSpriteAssistantMount();
          }
          return;
        }
        if (evt.type === "answer") {
          speechToken = await handlePhoneAnswer(evt.heardText, evt.answer, { streamTts: true });
          return;
        }
        if (evt.type === "tts_chunk") {
          if (speechToken) enqueueSpriteTtsChunk(speechToken, evt.tts);
          return;
        }
        if (evt.type === "done") {
          if (speechToken) finishSpriteSpeechStream(speechToken);
          return;
        }
        if (evt.type === "error") {
          throw new Error(evt.message || "语音通话请求失败");
        }
      };

      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const parsed = parseSpriteNdjson(decoder.decode(value, { stream: true }), remainder, false);
            remainder = parsed.remainder;
            for (const evt of parsed.events) await consumeEvt(evt);
          }
          const tailParsed = parseSpriteNdjson(decoder.decode(), remainder, true);
          for (const evt of tailParsed.events) await consumeEvt(evt);
        } finally {
          reader.releaseLock();
        }
      } else {
        const parsed = parseSpriteNdjson(await response.text(), "", true);
        for (const evt of parsed.events) await consumeEvt(evt);
      }

      if (speechToken) finishSpriteSpeechStream(speechToken);
      if (streamNoSpeech && state.sprite.phonePendingTurns.length > 0) {
        void sendSpritePhoneTurn();
      }
    } catch (error) {
      state.sprite.transcribing = false;
      state.sprite.busy = false;
      state.sprite.thinkingLabel = "";
      if (error?.name === "AbortError" || !state.sprite.phoneCallActive) {
        renderSpriteAssistantMount();
        return;
      }
      const prevPhase = state.sprite.phonePhase;
      transitionPhonePhase("listening", { turnId });
      logSpritePhoneEvent("turn_error", { turnId, fromPhase: prevPhase, toPhase: "listening", detail: formatActionError(error) });
      pushSpriteMessage({
        role: "sprite",
        tone: "worry",
        text: `语音通话请求失败：${formatActionError(error)}`,
        ttsPayload: { skipAutoSpeak: true },
      });
    } finally {
      if (abortController && state.sprite.phoneAbortController === abortController) {
        state.sprite.phoneAbortController = null;
      }
    }
  }

  async function handleSpriteCommand(rawInput = "") {
    const text = String(rawInput || "").trim();
    if (!text || state.sprite.busy) return;
    if (state.sprite.viewMode === "phone" && state.sprite.phoneCallActive) {
      state.sprite.draft = "";
      await sendSpritePhoneTurn({ transcriptText: text });
      return;
    }
    state.sprite.open = true;
    state.sprite.draft = "";
    pushSpriteMessage({ role: "user", text });

    if (state.sprite.pendingProposal) {
      if (/^(确认|确定|执行|同意|批准|可以|好的|好|行|没问题|ok|yes)[!！。.,，~～]*$/i.test(text)) {
        await confirmSpriteProposal();
        return;
      }
      if (/^(取消|算了|不要|别|撤回|放弃|no|cancel)[!！。.,，~～]*$/i.test(text)) {
        cancelPendingProposalOnServer(state.sprite.pendingProposal);
        state.sprite.pendingProposal = null;
        pushSpriteMessage({ role: "sprite", tone: "idle", text: "好的，已取消该操作。", spokenText: "好的，已取消该操作。" });
        return;
      }
    }

    const agentCtx = buildDispatchAgentContext();
    const excludedAgentKeys = Array.isArray(state.missionOverview?.meta?.dispatchPrefs?.excludedAgentKeys)
      ? state.missionOverview.meta.dispatchPrefs.excludedAgentKeys
      : [];
    const parsed = classifySpriteUserInput(text, {
      hasPendingPreview: Boolean(state.sprite.pendingPreview),
      hasPendingArchive: Boolean(state.sprite.pendingArchive),
      hasPendingReorg: Boolean(state.sprite.pendingReorg),
      scopedTopicId: state.sprite.scopedTopicId,
      overview: state.missionOverview,
      agentOptions: agentCtx.agentOptions,
      excludedAgentKeys,
    });

    if (parsed.intent === "confirm_reorg") {
      await confirmSpriteReorgPreview();
      return;
    }
    if (parsed.intent === "cancel_reorg") {
      state.sprite.pendingReorg = null;
      pushSpriteMessage({
        role: "sprite",
        tone: "idle",
        text: "好的，已取消本次梦工厂布局调整。",
        spokenText: "已取消本次梦工厂布局调整。",
      });
      return;
    }
    if (parsed.intent === "reorg_preview") {
      await requestSpriteReorgPreview({ instruction: parsed.instruction || text });
      return;
    }

    if (parsed.intent === "confirm_archive") {
      await confirmSpriteArchivePreview();
      return;
    }
    if (parsed.intent === "cancel_archive") {
      state.sprite.pendingArchive = null;
      pushSpriteMessage({
        role: "sprite",
        tone: "idle",
        text: "好的，已取消本次归档操作。",
        spokenText: "已取消本次归档操作。",
      });
      return;
    }
    if (parsed.intent === "archive_preview") {
      await requestSpriteArchivePreview({
        topicId: parsed.topicId,
        staleDays: parsed.staleDays ?? 3,
      });
      return;
    }
    if (parsed.intent === "confirm_preview") {
      await confirmSpriteDispatchPreview();
      return;
    }
    if (parsed.intent === "cancel_preview") {
      state.sprite.pendingPreview = null;
      pushSpriteMessage({
        role: "sprite",
        tone: "idle",
        text: "好的，已取消本次派工预览。",
        spokenText: "已取消本次派工预览。",
      });
      return;
    }
    if (parsed.intent === "query_tickets") {
      const reply = buildSpriteTicketReply(state.missionOverview);
      pushSpriteMessage({ role: "sprite", tone: reply.tone, text: reply.text, spokenText: reply.spokenText, actions: reply.actions });
      return;
    }
    if (parsed.intent === "dispatch_preview") {
      await requestSpriteDispatchPreview({
        instruction: parsed.instruction,
        topicId: parsed.topicId,
        agentKey: parsed.agentKey,
        mode: parsed.mode,
      });
      return;
    }
    await requestSpriteAnswer(text);
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
      pushSpriteAssistantErrorOrNotice(`语音识别失败：${formatActionError(error)}`);
      return false;
    } finally {
      state.sprite.transcribing = false;
      renderSpriteAssistantMount();
    }
  }

  function pushSpriteAssistantErrorOrNotice(msg) {
    pushSpriteMessage({ role: "sprite", tone: "urgent", text: msg, ttsPayload: { skipAutoSpeak: true } });
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
        if (timerEl) timerEl.textContent = formatSpriteTimerText(elapsed);
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

  function bindFullscreenEvents() {
    const fsMountEl = $("spriteFullscreenMount");
    if (!fsMountEl || fsMountEl._acSpriteEventsBound) return;
    fsMountEl._acSpriteEventsBound = true;
    fsMountEl.addEventListener("click", (e) => {
      void handleSpriteDelegatedClick(e);
    });
    fsMountEl.addEventListener("change", (e) => {
      handleSpriteDelegatedChange(e);
    });
    fsMountEl.addEventListener("input", (e) => {
      if (e.target.id === "spriteFullscreenInput") {
        state.sprite.draft = e.target.value;
        e.target.style.height = "auto";
        e.target.style.height = `${Math.min(132, Math.max(24, e.target.scrollHeight))}px`;
      }
    });
    fsMountEl.addEventListener("keydown", (e) => {
      if (e.target.id === "spriteFullscreenInput" && e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        const val = e.target.value.trim();
        if (val) void handleSpriteCommand(val);
      }
    });
    fsMountEl.addEventListener("submit", (e) => {
      if (e.target.id === "spriteFullscreenForm") {
        e.preventDefault();
        const val = $("spriteFullscreenInput")?.value?.trim() || state.sprite.draft || "";
        if (val) void handleSpriteCommand(val);
        return;
      }
      if (e.target.id === "spritePhoneTextForm") {
        e.preventDefault();
        const input = $("spritePhoneTextInput");
        const val = input?.value?.trim() || "";
        if (!val) return;
        input.value = "";
        void sendSpritePhoneTurn({ transcriptText: val });
      }
    });
  }

  return {
    transitionPhonePhase,
    setSpriteViewMode,
    bindFullscreenEvents,
    stopSpriteSpeech,
    enterSpriteFullscreen,
    exitSpriteFullscreen,
    exitSpriteOverlayForNavigation,
    minimizeSpritePhoneCall,
    enterSpritePhoneCall,
    hangupSpritePhoneCall,
    renderSpriteAssistantMount,
    syncSpriteWithOverview,
    handleSpriteDelegatedClick,
    handleSpriteDelegatedChange,
    toggleSpriteAssistant,
    openSpriteCards,
    pinThreadAsTicket,
    maybeStartSpriteTour,
    noteSpriteParkLeave,
    sendSpritePhoneTurn,
    handleSpriteCommand,
    stopSpriteMic,
  };
}
