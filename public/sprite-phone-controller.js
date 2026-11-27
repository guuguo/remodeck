import { apiGet, apiUrl, isDemoMode } from "./api-client.js?v=20261118demo";
import { appendSpriteTurn, parseSpriteNdjson } from "./sprite-assistant.js?v=20261126modal2";
import { encodePcm16SamplesToWav, mergeQueuedVoiceTurns, uint8ArrayToBase64 } from "./voice-copilot.js?v=20261124drive";

const VALID_PHONE_PHASES = new Set(["idle", "listening", "thinking", "speaking"]);
const VALID_VIEW_MODES = new Set(["popover", "fullscreen", "phone"]);

/**
 * Owns Sprite fullscreen overlay and phone call phase state machine, streaming turn loop, and lifecycle.
 */
export function createSpritePhoneController({
  state,
  getEl,
  getTycoon3d = () => null,
  deps = {},
  audio = {},
  callbacks = {},
  fetchImpl = null,
} = {}) {
  const $ = getEl;
  const getFetch = () => fetchImpl || (typeof fetch === "function" ? fetch : null);
  const raf = (fn) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 0));

  const {
    apiPostWithHotFallback = async () => ({}),
    isBoardViewActive = () => false,
    setTopbarMenuOpen = () => {},
    setComposerConfigOpen = () => {},
    showToastBanner = () => {},
    formatActionError = (err, fallback = "操作失败") => String(err?.message || err || fallback),
    refreshThreads = async () => {},
    loadMissionOverview = async () => {},
    ensureVoiceAudioUnlocked = () => {},
    requestVoiceWakeLock = async () => {},
    releaseVoiceWakeLock = async () => {},
  } = deps;

  const {
    renderSpriteAssistantMount = () => {},
    pushSpriteMessage = () => {},
    applySpriteClientEffect = async () => {},
    handleSpriteDelegatedClick = () => false,
    handleSpriteDelegatedChange = () => false,
    handleSpriteCommand = async () => {},
    postAssistantJson = async () => ({}),
    formatTimerText = (sec = 0) => String(sec),
  } = callbacks;

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
        badge.textContent = formatTimerText(state.sprite.phoneElapsedSec);
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
        if (tEl) tEl.textContent = formatTimerText(elapsed);
        const badgeEl = $("voiceLiveCallBadge");
        if (badgeEl && !badgeEl.hidden) badgeEl.textContent = formatTimerText(elapsed);
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
      await audio.startSpriteMic({ handsFree: true });
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
    audio.stopSpriteSpeech();
    await audio.stopSpriteMic({ submit: false, stopHandsFree: true });
    state.sprite.micStatus = "idle";
    state.sprite.micError = "";
    state.sprite.micRecoveryCount = 0;
    void releaseVoiceWakeLock();
    if (oldCallId) {
      logSpritePhoneEvent("call_end", { callId: oldCallId, fromPhase: prevPhase, toPhase: "idle" });
    }
    setSpriteViewMode(state.sprite.viewMode === "phone" ? "popover" : state.sprite.viewMode);
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
          speechToken = audio.beginSpriteSpeechStream(spokenText, { turnId });
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
          if (speechToken) audio.enqueueSpriteTtsChunk(speechToken, evt.tts);
          return;
        }
        if (evt.type === "done") {
          if (speechToken) audio.finishSpriteSpeechStream(speechToken);
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

      if (speechToken) audio.finishSpriteSpeechStream(speechToken);
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
    logSpritePhoneEvent,
    transitionPhonePhase,
    setSpriteViewMode,
    syncTycoon3DPauseForSprite,
    syncVoiceTopbarLiveCallBadge,
    bindFullscreenEvents,
    enterSpriteFullscreen,
    exitSpriteFullscreen,
    exitSpriteOverlayForNavigation,
    minimizeSpritePhoneCall,
    enterSpritePhoneCall,
    hangupSpritePhoneCall,
    sendSpritePhoneTurn,
  };
}
