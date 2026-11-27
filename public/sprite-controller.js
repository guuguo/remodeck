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
  submitSpriteDispatch,
  spriteTomorrowAtEight,
  renderSpriteAssistantHtml,
  renderSpriteFullscreenHtml,
  renderSpritePhoneCallHtml,
  saveSpritePrefs,
} from "./sprite-assistant.js?v=20261126modal2";
import { createSpriteAudioPipeline } from "./sprite-audio-pipeline.js?v=20261127split1";
import { createSpritePhoneController } from "./sprite-phone-controller.js?v=20261127split1";

const SPRITE_LAST_SEEN_KEY = "agentControl.sprite.lastSeenAt";

function formatSpriteTimerText(sec = 0) {
  const s = Math.max(0, Math.floor(Number(sec) || 0));
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const r = String(s % 60).padStart(2, "0");
  return `${m}:${r}`;
}

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
 * Encapsulates Sprite assistant chat, tour/ticket actions, and delegates
 * audio capture/TTS and phone/fullscreen orchestration to sibling modules.
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
  const raf = (fn) => (typeof requestAnimationFrame === "function" ? requestAnimationFrame(fn) : setTimeout(fn, 0));

  const {
    isBoardViewActive = () => false,
    isOverviewBoardMode = () => false,
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
  } = deps;

  let spriteTourPending = false;
  let spriteParkVisible = false;
  let phone = null;

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

  const audio = createSpriteAudioPipeline({
    state,
    getEl,
    deps,
    callbacks: {
      renderSpriteAssistantMount: () => renderSpriteAssistantMount(),
      pushSpriteMessage: (msg) => pushSpriteMessage(msg),
      toggleSpriteAssistant: (opts) => toggleSpriteAssistant(opts),
      handleSpriteCommand: (val) => handleSpriteCommand(val),
      transitionPhonePhase: (next, opts) => phone?.transitionPhonePhase(next, opts),
      logSpritePhoneEvent: (ev, opts) => phone?.logSpritePhoneEvent(ev, opts),
      sendSpritePhoneTurn: (opts) => phone?.sendSpritePhoneTurn(opts),
      formatTimerText: formatSpriteTimerText,
    },
  });

  phone = createSpritePhoneController({
    state,
    getEl,
    getTycoon3d,
    deps,
    audio,
    fetchImpl,
    callbacks: {
      renderSpriteAssistantMount: () => renderSpriteAssistantMount(),
      pushSpriteMessage: (msg) => pushSpriteMessage(msg),
      applySpriteClientEffect: (effect) => applySpriteClientEffect(effect),
      handleSpriteDelegatedClick: (e) => handleSpriteDelegatedClick(e),
      handleSpriteDelegatedChange: (e) => handleSpriteDelegatedChange(e),
      handleSpriteCommand: (val) => handleSpriteCommand(val),
      postAssistantJson,
      formatTimerText: formatSpriteTimerText,
    },
  });

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

    phone.syncTycoon3DPauseForSprite();
    phone.syncVoiceTopbarLiveCallBadge();

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
      void audio.speakSpriteText(spokenText || cleanText, { ttsPayload });
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
      phone.enterSpriteFullscreen();
    } else if (sAct === "exit-fullscreen") {
      phone.exitSpriteFullscreen();
    } else if (sAct === "enter-phone") {
      void phone.enterSpritePhoneCall();
    } else if (sAct === "minimize-phone") {
      phone.minimizeSpritePhoneCall();
    } else if (sAct === "hangup-phone") {
      void phone.hangupSpritePhoneCall();
    } else if (sAct === "toggle-phone-mute") {
      audio.toggleSpritePhoneMute();
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
        audio.stopSpriteSpeech();
      } else if (state.sprite.phoneMuted) {
        audio.toggleSpritePhoneMute();
      } else if (
        !state.sprite.recording
        || state.sprite.micStatus === "error"
        || state.sprite.micStatus === "stalled"
      ) {
        audio.teardownSpriteMic();
        state.sprite.recording = false;
        state.sprite.micRecoveryCount = 0;
        void audio.startSpriteMic({ handsFree: true });
      } else if (state.sprite.speechActive && state.sprite.mic.vad) {
        const flushed = state.sprite.mic.vad.flush();
        state.sprite.speechActive = false;
        if (flushed?.samples?.length >= 1600) {
          playVoiceEarcon("heard", state.sprite.mic?.audioCtx || state.voice?.audioCtx);
          void phone.sendSpritePhoneTurn({ samples: flushed.samples });
        }
      } else if (!state.sprite.busy && !state.sprite.transcribing) {
        void phone.sendSpritePhoneTurn({ transcriptText: "简单汇报一下现在园子里最需要我注意的事" });
      }
    } else if (sAct === "phone-replay-or-brief") {
      ensureVoiceAudioUnlocked();
      if (state.sprite.lastSpokenReply) {
        void audio.speakSpriteText(state.sprite.lastSpokenReply, { ttsPayload: state.sprite.lastTtsPayload });
      } else {
        void phone.sendSpritePhoneTurn({ transcriptText: "简单汇报一下现在园子里最需要我注意的事" });
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
        phone.transitionPhonePhase("listening", { detail: { reason: "abort" } });
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
      if (!nextTts) audio.stopSpriteSpeech();
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
      void audio.toggleSpriteHandsFree();
    } else if (sAct === "mic") {
      ensureVoiceAudioUnlocked();
      void audio.toggleSpriteMic();
    } else if (sAct === "finish-mic") {
      void audio.stopSpriteMic({ submit: true });
    } else if (sAct === "cancel-mic") {
      void audio.stopSpriteMic({ submit: false });
    } else if (sAct === "stop-speech") {
      audio.stopSpriteSpeech();
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
      phone.setSpriteViewMode("popover");
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
      phone.exitSpriteOverlayForNavigation();
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
          phone.setSpriteViewMode("popover");
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
      void audio.stopSpriteMic({ submit: false });
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
      if (state.sprite.viewMode === "fullscreen") phone.setSpriteViewMode("popover", { render: false });
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
    if (state.sprite.phoneCallActive) phone.transitionPhonePhase("thinking");
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
          phone.transitionPhonePhase("listening");
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

  async function handleSpriteCommand(rawInput = "") {
    const text = String(rawInput || "").trim();
    if (!text || state.sprite.busy) return;
    if (state.sprite.viewMode === "phone" && state.sprite.phoneCallActive) {
      state.sprite.draft = "";
      await phone.sendSpritePhoneTurn({ transcriptText: text });
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

  return {
    transitionPhonePhase: phone.transitionPhonePhase,
    setSpriteViewMode: phone.setSpriteViewMode,
    bindFullscreenEvents: phone.bindFullscreenEvents,
    stopSpriteSpeech: audio.stopSpriteSpeech,
    enterSpriteFullscreen: phone.enterSpriteFullscreen,
    exitSpriteFullscreen: phone.exitSpriteFullscreen,
    exitSpriteOverlayForNavigation: phone.exitSpriteOverlayForNavigation,
    minimizeSpritePhoneCall: phone.minimizeSpritePhoneCall,
    enterSpritePhoneCall: phone.enterSpritePhoneCall,
    hangupSpritePhoneCall: phone.hangupSpritePhoneCall,
    renderSpriteAssistantMount,
    syncSpriteWithOverview,
    handleSpriteDelegatedClick,
    handleSpriteDelegatedChange,
    toggleSpriteAssistant,
    openSpriteCards,
    pinThreadAsTicket,
    maybeStartSpriteTour,
    noteSpriteParkLeave,
    sendSpritePhoneTurn: phone.sendSpritePhoneTurn,
    handleSpriteCommand,
    stopSpriteMic: audio.stopSpriteMic,
  };
}
