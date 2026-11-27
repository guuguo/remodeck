import { t } from "./i18n.js";
import { apiGet, apiPost, apiRequest, apiUrl, isDemoMode } from "./api-client.js?v=20261118demo";
import {
  findTaskForThread,
  getTaskAncestors,
  renderTaskStripHtml,
  renderTaskTreeModalHtml,
  shouldShowTaskStrip,
} from "./task-tree.js?v=20261126task1";
import { initHumanVerifyOverlay } from "./human-verify.js?v=20261125hv1";
import {
  autoPreviewThreadImages,
  isLocalOrLanHostname,
  isLoopbackHostname,
} from "./image-preview-policy.js?v=20261120lan";
import {
  computeDefaultHiddenProviderTabs,
  hasSavedProviderTabsPref,
  loadHiddenProviderTabs,
  saveHiddenProviderTabs,
  renderProviderTabsHtml,
  renderProviderTabsSettingsHtml,
  visibleProviderFilter,
} from "./provider-tabs.js?v=20261118tabs";
import { renderExecutionStatsHtml } from "./execution-stats.js?v=20261119speed";
import { hydrateMermaidBlocks, prepareMermaidSvgForPreview } from "./mermaid-renderer.js?v=20261119mermaidzoom";
import {
  buildReleaseVersionTabs,
  renderReleaseHeadline,
  renderReleaseNotesCardHtml,
  resolveReleaseNotesBucket,
} from "./release-notes.js?v=20261119updhub";
import {
  extractGoalDirective,
  renderQueuedTurnsPanelHtml,
  resolveComposerSubmission,
  shouldAllowSendButtonClick,
  shouldSubmitPromptOnEnter,
  submitComposerRequest,
} from "./composer-mode.js?v=20261119mobilequeue1";
import {
  closeCustomSelectMenu,
  initComposerCustomSelects,
  syncAllCustomSelects,
} from "./custom-select.js?v=20261117qoder";
import { hydrateDeclarativeIcons, iconSvg, providerIconSvg } from "./icons.js?v=20261118views";
import {
  cleanClipboardTextForPastedImages,
  compressImageFileForUpload,
  estimateDataUrlBytes,
  filterFilesNeedingUpload,
  formatByteSize,
  partitionDataTransferFiles,
  stripAttachedImagePaths,
  stripCoveredFileNamesFromText,
  validateImageBatchBudget,
} from "./image-attachment.js?v=20261127filepaste";
import {
  abbreviateMiddleText,
  buildSelectableTelemetryItems,
  compactEffortBadgeLabel,
  compactModelBadgeLabel,
  compactProfileChipText,
  compactProfileDisplayLabel,
  ensurePreferredModelInList,
  filterProfilesByProvider,
  findFailoverCandidateProfile,
  hasElapsedQuotaReset,
  normalizeUiPermissionMode,
  permissionModeDisplayLabel,
  permissionVisualMeta,
  pickBestAvailableProfile,
  pickDefaultModelForProvider,
  profileHealthVisualMeta,
  profileOptionLabel,
  providerDisplayName,
  providerShortBadge,
  providerVisualMeta,
  renderAgentTelemetryBarHtml,
  renderInstanceManagerListHtml,
  renderProfilePillsHtml,
  renderProviderPillsHtml,
  renderQuotaOverviewHtml,
  resolveAntigravityModelSelection,
  resolveDistinctProfileChipText,
  resolveModelsForProvider,
  resolveVisibleTelemetryKeys,
  sortProfilesByAvailability,
  summarizeTelemetryMobileBadge,
} from "./instance-switcher.js?v=20261127a";
import { bindFollowIntent, humanizeLiveActivity, mergeLiveActivity, summarizeToolUseActivity } from "./live-state.js?v=20261120claude";
import {
  cleanStreamingAgentText,
  dedupeAdjacentTurns,
  escapeHtml,
  formatClipboardFilesAsMarkdownLinks,
  formatPastedFileMarkdownLink,
  formatToolExecutionError,
  formatTurnModelBadge,
  isRecoverableToolErrorText,
  isStreamingTextAlreadyPersisted,
  isThreadImageFailed,
  markThreadImageFailed,
  renderMarkdown,
  renderMessageCopyButton,
  renderTurnHtml,
  turnEndsWithProcessGroup,
} from "./markdown.js?v=20261127a";
import {
  SIDEBAR_MANUAL_HOLD_MS,
  THREAD_EXPAND_STEP,
  buildProjectGroups,
  compactThreadErrorSummary,
  computeProjectGroupSelectionState,
  isSameProjectCwd,
  isSidebarManualPrefActive,
  isThreadFailed,
  normalizeProjectCwd,
  projectBaseName,
  renderBatchActionBarHtml,
  renderProjectBoardHtml,
  renderProjectTaskStripHtml,
  renderSidebarThreadListHtml,
  resolveProjectGroupCollapsed,
} from "./project-board.js?v=20261125a";
import {
  collectNewThreadCwdOptions,
  formatCwdParts,
  looksLikeDirectoryPath,
  normalizeDraftCwdInput,
  renderNewThreadCwdListHtml,
} from "./new-thread-cwd.js?v=20261125cwd1";
import { renderMissionOverviewHtml, renderTycoonHudHtml } from "./mission-overview.js?v=20261127a";
import { createTycoon3DWorld } from "./tycoon-3d.js?v=20261127a";
import {
  createInitialSpriteState,
  createSpriteController,
} from "./sprite-controller.js?v=20261126ctrl2";
import {
  captureSubtreeUiState,
  replaceHtmlPreservingUiState,
  restoreSubtreeUiState,
} from "./dom-preserve.js?v=20261119preserve";
import { collectUserInputAnswers, syncServerRequestCards, syncUserInputQuestion } from "./server-request-ui.js?v=20261117qoder";
import {
  applySlashCommandSelection,
  filterSlashCommands,
  parseSlashTrigger,
  renderSlashMenuHtml,
} from "./slash-commands.js?v=20261117qoder";
import {
  downsampleFloat32ToInt16,
  encodePcm16SamplesToWav,
  extractFinalAssistantMessageFromTurns,
  extractReplyClosingSummaryForSpeech,
  loadChatReplyTtsPref,
  normalizeVoiceTtsPayload,
  resolveHoldTalkGestureState,
  saveChatReplyTtsPref,
  stripMarkdownForSpeech,
  uint8ArrayToBase64,
} from "./voice-copilot.js?v=20261124drive";

const $ = (id) => document.getElementById(id);

const PERM_PREF_KEY = "agentControl.permissionMode.v1";
const THREAD_PREFS_KEY = "agentControl.threadPrefs.v1";
const MODELS_CACHE_KEY = "agentControl.modelsCache.v3";
const THREADS_CACHE_KEY = "agentControl.threadsCache.v1";
const SIDEBAR_FOLD_PREFS_KEY = "agentControl.sidebarFold.v1";
const TELEMETRY_VISIBLE_PREFS_KEY = "agentControl.telemetryVisibleKeys.v1";
const THREAD_READ_STATE_KEY = "agentControl.threadReadState.v1";
const SIDEBAR_WIDTH_PREF_KEY = "agentControl.sidebarWidth.v1";
const DEFAULT_SIDEBAR_WIDTH = 312;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 560;

function loadThreadReadState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(THREAD_READ_STATE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") {
      return { initialized: false, seenById: {}, unreadById: {} };
    }
    return {
      initialized: Boolean(parsed.initialized),
      seenById: parsed.seenById && typeof parsed.seenById === "object" ? { ...parsed.seenById } : {},
      unreadById: parsed.unreadById && typeof parsed.unreadById === "object" ? { ...parsed.unreadById } : {},
    };
  } catch {
    return { initialized: false, seenById: {}, unreadById: {} };
  }
}

const threadReadState = loadThreadReadState();

function persistThreadReadState() {
  try {
    const seenEntries = Object.entries(threadReadState.seenById || {})
      .filter(([id, ts]) => id && Number(ts) > 0)
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .slice(0, 400);
    threadReadState.seenById = Object.fromEntries(seenEntries);
    const cutoffMs = Date.now() - 7 * 24 * 3600 * 1000;
    const unreadEntries = Object.entries(threadReadState.unreadById || {})
      .filter(([id, entry]) => id && entry && Number(entry.at || 0) >= cutoffMs)
      .sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0))
      .slice(0, 120);
    threadReadState.unreadById = Object.fromEntries(unreadEntries);
    localStorage.setItem(THREAD_READ_STATE_KEY, JSON.stringify(threadReadState));
  } catch {}
}

function buildInitialRecentCompletedMap() {
  const map = new Map();
  for (const [id, entry] of Object.entries(threadReadState.unreadById || {})) {
    if (!id || !entry || typeof entry !== "object") continue;
    map.set(id, {
      status: entry.status || "completed",
      summary: String(entry.summary || ""),
      at: Number(entry.at) || Date.now(),
      updatedAt: Number(entry.updatedAt) || 0,
    });
  }
  return map;
}

function loadTelemetryVisiblePrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(TELEMETRY_VISIBLE_PREFS_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    if (!Array.isArray(parsed.selectedKeys)) return null;
    return {
      selectedKeys: parsed.selectedKeys.map((k) => String(k || "")).filter(Boolean),
      knownKeys: Array.isArray(parsed.knownKeys)
        ? parsed.knownKeys.map((k) => String(k || "")).filter(Boolean)
        : [],
    };
  } catch {
    return null;
  }
}

function saveTelemetryVisiblePrefs(prefs) {
  try {
    if (!prefs) {
      localStorage.removeItem(TELEMETRY_VISIBLE_PREFS_KEY);
    } else {
      localStorage.setItem(TELEMETRY_VISIBLE_PREFS_KEY, JSON.stringify(prefs));
    }
  } catch {
    // Ignore storage failures in private browsing.
  }
}

function loadCachedModels() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MODELS_CACHE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    return {
      allModels: Array.isArray(parsed.allModels) ? parsed.allModels : [],
      modelsByProvider: parsed.modelsByProvider && typeof parsed.modelsByProvider === "object"
        ? parsed.modelsByProvider
        : {},
    };
  } catch {
    return null;
  }
}

function saveCachedModels(allModels, modelsByProvider) {
  try {
    localStorage.setItem(MODELS_CACHE_KEY, JSON.stringify({
      allModels: Array.isArray(allModels) ? allModels : [],
      modelsByProvider: modelsByProvider && typeof modelsByProvider === "object" ? modelsByProvider : {},
      updatedAt: Date.now(),
    }));
  } catch {}
}

function loadCachedThreads() {
  if (isDemoMode()) return null;
  try {
    const parsed = JSON.parse(sessionStorage.getItem(THREADS_CACHE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    return {
      threads: Array.isArray(parsed.threads) ? parsed.threads : [],
      projectsMeta: parsed.projectsMeta && typeof parsed.projectsMeta === "object" ? parsed.projectsMeta : {},
    };
  } catch {
    return null;
  }
}

function saveCachedThreads(threads, projectsMeta) {
  if (isDemoMode()) return;
  try {
    const compactThreads = (Array.isArray(threads) ? threads : []).slice(0, 120).map((t) => ({
      id: t.id,
      title: t.title,
      name: t.name,
      preview: t.preview,
      cwd: t.cwd,
      provider: t.provider,
      profileId: t.profileId,
      profileLabel: t.profileLabel,
      updatedAt: t.updatedAt,
      live: Boolean(t.live),
      goalState: t.goalState || null,
      pendingCount: t.pendingCount || 0,
      queuedCount: t.queuedCount || 0,
      pinned: Boolean(t.pinned),
    }));
    sessionStorage.setItem(THREADS_CACHE_KEY, JSON.stringify({
      threads: compactThreads,
      projectsMeta: projectsMeta && typeof projectsMeta === "object" ? projectsMeta : {},
      updatedAt: Date.now(),
    }));
  } catch {}
}

function loadDefaultPermissionMode() {
  try {
    return normalizeUiPermissionMode(localStorage.getItem(PERM_PREF_KEY), "turbo");
  } catch {
    return "turbo";
  }
}

function saveDefaultPermissionMode(mode) {
  const clean = normalizeUiPermissionMode(mode, "turbo");
  try {
    localStorage.setItem(PERM_PREF_KEY, clean);
  } catch {}
  return clean;
}

const NEW_THREAD_PREFS_KEY = "agentControl.newThreadPrefs.v1";

function getNewThreadPrefs(provider) {
  try {
    return JSON.parse(localStorage.getItem(NEW_THREAD_PREFS_KEY) || "{}")[provider] || {};
  } catch { return {}; }
}

function saveNewThreadPrefs(provider, patch) {
  try {
    const prefs = JSON.parse(localStorage.getItem(NEW_THREAD_PREFS_KEY) || "{}");
    prefs[provider] = { ...prefs[provider], ...patch };
    localStorage.setItem(NEW_THREAD_PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

function loadThreadPrefsMap() {
  try {
    const parsed = JSON.parse(localStorage.getItem(THREAD_PREFS_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function getLocalThreadPrefs(threadId) {
  if (!threadId) return null;
  const map = loadThreadPrefsMap();
  const raw = map[threadId];
  if (!raw || typeof raw !== "object") return null;
  if (!raw.modelExplicit && raw.model) {
    const copy = { ...raw };
    delete copy.model;
    return copy;
  }
  return raw;
}

function saveLocalThreadPrefs(threadId, patch = {}) {
  if (!threadId) return;
  try {
    const map = loadThreadPrefsMap();
    map[threadId] = {
      ...(map[threadId] || {}),
      ...patch,
      updatedAt: Date.now(),
    };
    const keys = Object.keys(map);
    if (keys.length > 200) {
      keys
        .sort((a, b) => (map[a]?.updatedAt || 0) - (map[b]?.updatedAt || 0))
        .slice(0, keys.length - 200)
        .forEach((k) => delete map[k]);
    }
    localStorage.setItem(THREAD_PREFS_KEY, JSON.stringify(map));
  } catch {}
}

function loadSidebarFoldState(nowMs = Date.now()) {
  const sidebarFoldPrefs = {};
  const expandedThreadsAt = {};
  const expandedSidebarGroups = new Map();
  let showStaleProjects = false;
  let staleProjectsOpenedAt = 0;
  try {
    const parsed = JSON.parse(localStorage.getItem(SIDEBAR_FOLD_PREFS_KEY) || "null");
    if (parsed && typeof parsed === "object") {
      if (parsed.groups && typeof parsed.groups === "object") {
        for (const [cwd, pref] of Object.entries(parsed.groups)) {
          if (cwd && isSidebarManualPrefActive(pref, nowMs, SIDEBAR_MANUAL_HOLD_MS)) {
            sidebarFoldPrefs[cwd] = {
              action: pref.action,
              updatedAt: Number(pref.updatedAt),
            };
          }
        }
      }
      if (parsed.expandedThreads && typeof parsed.expandedThreads === "object") {
        for (const [cwd, val] of Object.entries(parsed.expandedThreads)) {
          const ts = typeof val === "object" && val ? Number(val.updatedAt) : Number(val);
          const rawCount = typeof val === "object" && val ? Number(val.count) : THREAD_EXPAND_STEP;
          const count = Number.isFinite(rawCount) && rawCount > 0
            ? Math.max(THREAD_EXPAND_STEP, Math.floor(rawCount))
            : THREAD_EXPAND_STEP;
          if (cwd && Number.isFinite(ts) && ts > 0 && (nowMs < ts || (nowMs - ts) < SIDEBAR_MANUAL_HOLD_MS)) {
            expandedThreadsAt[cwd] = ts;
            expandedSidebarGroups.set(cwd, count);
          }
        }
      }
      const staleTs = Number(parsed.staleProjectsOpenedAt || 0);
      if (Number.isFinite(staleTs) && staleTs > 0 && (nowMs < staleTs || (nowMs - staleTs) < SIDEBAR_MANUAL_HOLD_MS)) {
        showStaleProjects = true;
        staleProjectsOpenedAt = staleTs;
      }
    }
  } catch {}
  return {
    sidebarFoldPrefs,
    expandedThreadsAt,
    expandedSidebarGroups,
    showStaleProjects,
    staleProjectsOpenedAt,
  };
}

function saveSidebarFoldState() {
  if (state.scopedProjectCwd) return;
  try {
    const trimEntries = (obj, tsSelector, limit = 120) => {
      const entries = Object.entries(obj || {});
      if (entries.length <= limit) return Object.fromEntries(entries);
      return Object.fromEntries(
        entries
          .sort((a, b) => (Number(tsSelector(b[1])) || 0) - (Number(tsSelector(a[1])) || 0))
          .slice(0, limit),
      );
    };
    const expandedThreadsPayload = {};
    for (const [cwd, ts] of Object.entries(trimEntries(state.expandedThreadsAt, (v) => v))) {
      expandedThreadsPayload[cwd] = {
        count: Math.max(THREAD_EXPAND_STEP, Math.floor(Number(state.expandedSidebarGroups?.get?.(cwd)) || THREAD_EXPAND_STEP)),
        updatedAt: Number(ts) || Date.now(),
      };
    }
    localStorage.setItem(SIDEBAR_FOLD_PREFS_KEY, JSON.stringify({
      groups: trimEntries(state.sidebarFoldPrefs, (v) => v?.updatedAt),
      expandedThreads: expandedThreadsPayload,
      staleProjectsOpenedAt: state.showStaleProjects ? (Number(state.staleProjectsOpenedAt) || Date.now()) : 0,
    }));
  } catch {}
}

function pruneExpiredSidebarPrefs(nowMs = Date.now()) {
  let changed = false;
  for (const [cwd, pref] of Object.entries(state.sidebarFoldPrefs || {})) {
    if (!isSidebarManualPrefActive(pref, nowMs, SIDEBAR_MANUAL_HOLD_MS)) {
      delete state.sidebarFoldPrefs[cwd];
      changed = true;
    }
  }
  for (const [cwd, tsRaw] of Object.entries(state.expandedThreadsAt || {})) {
    const ts = Number(tsRaw);
    if (!Number.isFinite(ts) || ts <= 0 || (nowMs >= ts && (nowMs - ts) >= SIDEBAR_MANUAL_HOLD_MS)) {
      delete state.expandedThreadsAt[cwd];
      state.expandedSidebarGroups.delete(cwd);
      changed = true;
    }
  }
  if (state.showStaleProjects) {
    const staleTs = Number(state.staleProjectsOpenedAt || 0);
    if (!Number.isFinite(staleTs) || staleTs <= 0 || (nowMs >= staleTs && (nowMs - staleTs) >= SIDEBAR_MANUAL_HOLD_MS)) {
      state.showStaleProjects = false;
      state.staleProjectsOpenedAt = 0;
      changed = true;
    }
  }
  if (changed) saveSidebarFoldState();
  return changed;
}

function setSidebarGroupManualPref(cwd, action, nowMs = Date.now()) {
  const cleanCwd = normalizeProjectCwd(cwd) || "默认工作区";
  if (action !== "expand" && action !== "collapse") return;
  state.sidebarFoldPrefs[cleanCwd] = { action, updatedAt: nowMs };
  state.collapsedGroups.delete(cleanCwd);
  if (action === "collapse") {
    state.expandedSidebarGroups.delete(cleanCwd);
    delete state.expandedThreadsAt[cleanCwd];
  }
  saveSidebarFoldState();
}

const initialModelsCache = loadCachedModels();
const initialSidebarFold = loadSidebarFoldState();

const state = {
  providers: [],
  profiles: [],
  modelsByProvider: initialModelsCache?.modelsByProvider || {},
  allModels: initialModelsCache?.allModels || [],
  defaultProvider: "antigravity",
  defaultProfileId: "cli",
  defaultPermissionMode: loadDefaultPermissionMode(),
  threads: [],
  projectsMeta: {},
  warnings: [],
  cliStatus: {},
  providerFilter: "all",
  hiddenProviderTabs: loadHiddenProviderTabs(),
  profileFilter: "all",
  quotaExpanded: false,
  quotaRefreshing: false,
  telemetry: null,
  executionStats: null,
  executionStatsDays: 7,
  executionStatsProvider: "all",
  executionStatsLoading: false,
  executionStatsError: "",
  telemetryExpanded: false,
  telemetryVisiblePrefs: loadTelemetryVisiblePrefs(),
  telemetryPickerOpen: false,
  mobileTelemetryOpen: false,
  searchText: "",
  sidebarSearchText: "",
  sidebarRemoteSearch: createRemoteSearchBucket(),
  boardRemoteSearch: createRemoteSearchBucket(),
  showArchived: false,
  lastUnarchiveContext: null,
  unarchivingThreadId: "",
  codexExecSuggestedProfiles: new Set(),
  codexExecTogglingProfileKey: "",
  showAllProjects: false,
  expandedProjects: new Map(),
  expandedSidebarGroups: initialSidebarFold.expandedSidebarGroups,
  sidebarFoldPrefs: initialSidebarFold.sidebarFoldPrefs,
  expandedThreadsAt: initialSidebarFold.expandedThreadsAt,
  showStaleProjects: initialSidebarFold.showStaleProjects,
  staleProjectsOpenedAt: initialSidebarFold.staleProjectsOpenedAt,
  boardOpen: true,
  boardViewMode: (() => {
    try {
      if (isDemoMode()) {
        const demoView = new URLSearchParams(location.search).get("view");
        return demoView === "folders" || demoView === "overview" || demoView === "tycoon3d" ? demoView : "tycoon3d";
      }
      const saved = localStorage.getItem("ac-board-view-mode-v3");
      return saved === "folders" || saved === "overview" || saved === "tycoon3d" ? saved : "tycoon3d";
    } catch {
      return "tycoon3d";
    }
  })(),
  missionOverview: null,
  missionOverviewLoading: false,
  expandedOverviewTopics: new Set(),
  expandedOverviewArchives: new Set(),
  expandedOverviewContexts: new Set(),
  expandedOverviewMetrics: new Set(),
  overviewAssignThreadId: "",
  editingMetricsTopicId: "",
  editingContextTopicId: "",
  overviewDomainFilter: "all",
  immersiveOverview: false,
  tycoonSelectedTopicId: "",
  tycoonInspectorMode: "",
  tycoonInspectorRoomId: "",
  tycoonInspectorClusterOnly: false,
  tycoonInspectorBack: null,
  selectedSubProjectByTopic: {},
  overviewSyncingProjects: false,
  tycoonQuestCollapsed: (() => {
    try {
      return localStorage.getItem("ac-tycoon-quest-collapsed") !== "0";
    } catch {
      return true;
    }
  })(),
  tycoonDispatchConfigOpen: false,
  tycoonMobileDockOpen: false,
  overviewShowChilled: false,
  dispatchDraft: "",
  dispatchTopicId: "",
  dispatchMode: "auto",
  dispatchInheritContext: true,
  dispatchAgentKey: "auto",
  dispatchModel: "",
  dispatchSparkId: "",
  dispatchBusy: false,
  dispatchPreview: null,
  lastDispatchReceipt: null,
  sprite: createInitialSpriteState(),
  initialThreadLoading: false,
  activeThreadId: "",
  activeThread: null,
  newThreadCwd: null,
  newThreadCwdPickerOpen: false,
  newThreadCwdPickerQuery: "",
  newThreadCwdPickerIndex: 0,
  newThreadCwdPickerOptions: [],
  newThreadCwdPickingLocal: false,
  newThreadTaskDraft: null,
  pendingScrollToTurn: null,
  tasks: [],
  tasksLoaded: false,
  tasksModalStatus: "open",
  tasksModalQuery: "",
  tasksSelectedId: "",
  tasksCollapsedIds: new Set(),
  tasksDetailLogs: [],
  tasksBindPickerId: "",
  memoryConfig: null,
  skillSyncStatus: null,
  nextCursor: null,
  liveActivity: null,
  activityCursor: "",
  streamingText: "",
  streamingThought: "",
  streamingTurnId: "",
  pendingRequests: [],
  pendingRequestsSynced: false,
  queuedTurns: [],
  queuedPanelCollapsed: false,
  editingQueueItem: null,
  slashCatalogByKey: new Map(),
  slashMenuOpen: false,
  slashMenuItems: [],
  slashMenuIndex: 0,
  slashTrigger: null,
  slashManualOpen: false,
  slashFetchSeq: 0,
  images: [],
  imageProcessingCount: 0,
  fileUploadingCount: 0,
  composerGoal: false,
  isSubmitting: false,
  composerStatusTimer: null,
  autoFollow: true,
  sseConnected: false,
  eventSource: null,
  collapsedGroups: new Set(),
  lastModelProvider: "",
  userPickedDraftModel: false,
  topbarMenuOpen: false,
  composerConfigOpen: false,
  toastTimer: null,
  toastActive: false,
  probingProfileKeys: new Set(),
  instanceManagerProvider: "codex",
  lastFailoverContext: null,
  liveActivityByThread: new Map(),
  recentCompletedByThread: buildInitialRecentCompletedMap(),
  useHotExtension: false,
  hotExtensionRoutes: new Set(),
  remoteStatus: null,
  tunnelStatus: null,
  lanInfo: null,
  tunnelBusy: false,
  fixedTunnelStatus: null,
  fixedTunnelBusy: false,
  updateStatus: null,
  updateChecking: false,
  updateApplying: false,
  desktopUpdating: false,
  updateModalTab: "notes",
  updateNotesVersionKey: "",
  updateNotesCategory: "all",
  localApps: [],
  scopedProjectCwd: typeof location !== "undefined"
    ? normalizeProjectCwd(new URL(location.href).searchParams.get("project") || "")
    : "",
  batchSelect: {
    active: false,
    selectedIds: new Set(),
    submitting: false,
    lastTouchedThreadId: "",
  },
  voice: {
    audioCtx: null,
    webAudioUnlocked: false,
    wakeLock: null,
  },
  dictation: {
    active: false,
    transcribing: false,
    holdMode: false,
    pointerDown: false,
    pointerId: null,
    startY: 0,
    cancelArmed: false,
    holdToken: 0,
    stream: null,
    micStream: null,
    audioCtx: null,
    source: null,
    processor: null,
    chunks: [],
    maxTimer: null,
  },
  chatTts: {
    enabled: loadChatReplyTtsPref().enabled,
    speaking: false,
    loading: false,
    audioEl: null,
    audioUnlocked: false,
    playToken: 0,
    lastSpokenKey: "",
  },
};

function toHotExtensionPath(path) {
  const clean = String(path || "").replace(/^\/+/, "");
  return clean.startsWith("apps/ac-hot/") ? clean : `apps/ac-hot/${clean}`;
}

function routeBaseOfPath(path) {
  return String(path || "").replace(/^\/+/, "").split("?")[0];
}

async function apiGetWithHotFallback(path) {
  const routeKey = routeBaseOfPath(path);
  if (state.hotExtensionRoutes.has(routeKey)) {
    try {
      return await apiGet(toHotExtensionPath(path));
    } catch (hotErr) {
      if (Number(hotErr?.status) !== 404 && Number(hotErr?.status) !== 502) throw hotErr;
      state.hotExtensionRoutes.delete(routeKey);
    }
  }
  try {
    return await apiGet(path);
  } catch (error) {
    if (Number(error?.status) !== 404) throw error;
    const res = await apiGet(toHotExtensionPath(path));
    state.hotExtensionRoutes.add(routeKey);
    return res;
  }
}

async function apiPostWithHotFallback(path, body) {
  const routeKey = routeBaseOfPath(path);
  if (state.hotExtensionRoutes.has(routeKey)) {
    try {
      return await apiPost(toHotExtensionPath(path), body);
    } catch (hotErr) {
      if (Number(hotErr?.status) !== 404 && Number(hotErr?.status) !== 502) throw hotErr;
      state.hotExtensionRoutes.delete(routeKey);
    }
  }
  try {
    return await apiPost(path, body);
  } catch (error) {
    if (Number(error?.status) !== 404) throw error;
    const res = await apiPost(toHotExtensionPath(path), body);
    state.hotExtensionRoutes.add(routeKey);
    return res;
  }
}

async function fetchThreadRead(path) {
  return apiGetWithHotFallback(path);
}

function isInternalVoiceThreadClient(thread) {
  if (!thread) return false;
  const cwd = String(thread.cwd || "").replace(/\\/g, "/");
  if (cwd.endsWith("/voice-call") || cwd.includes("/voice-call/")) return true;
  const title = String(thread.title || thread.name || "");
  const preview = String(thread.preview || "");
  return title.includes("[AC_VOICE_CALL]") || preview.includes("[AC_VOICE_CALL]");
}

function isBoardViewActive() {
  if (state.initialThreadLoading && state.activeThreadId) return false;
  return Boolean(state.boardOpen || (!state.activeThread && state.newThreadCwd === null));
}

function syncWorkspaceVisibility() {
  const onBoard = isBoardViewActive();
  $("appShell")?.classList.toggle("is-board-open", onBoard);
  const composer = $("composerArea");
  if (composer) composer.hidden = onBoard;
  if (onBoard) {
    setComposerConfigOpen(false);
    stopChatReplySpeech();
    if (state.dictation.active || state.dictation.pointerDown) {
      state.dictation.pointerDown = false;
      void stopComposerDictation({ submit: false });
    }
    if ($("turnList")) $("turnList").hidden = true;
    if ($("streamingTurn")) $("streamingTurn").hidden = true;
    if ($("loadOlderWrap")) $("loadOlderWrap").hidden = true;
    if ($("pendingRequestsDock")) $("pendingRequestsDock").hidden = true;
    if ($("queuedTurnsBar")) $("queuedTurnsBar").hidden = true;
  }
  renderChatTtsButton();
  renderBatchActionBars();
}

function formatRelativeTime(epochSeconds) {
  const ts = Number(epochSeconds || 0);
  if (!ts) return "";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

function buildProjectWindowUrl(cwd) {
  const url = new URL(location.href);
  url.searchParams.delete("thread");
  const cleanCwd = normalizeProjectCwd(cwd);
  if (cleanCwd) url.searchParams.set("project", cleanCwd);
  else url.searchParams.delete("project");
  return url.toString();
}

function openProjectWindow(cwd) {
  const cleanCwd = normalizeProjectCwd(cwd);
  if (!cleanCwd) return;
  const urlStr = buildProjectWindowUrl(cleanCwd);
  const win = window.open(urlStr, "_blank", "popup,width=1280,height=840");
  if (!win) {
    window.open(urlStr, "_blank");
  }
}

const DEFAULT_DOCUMENT_TITLE = typeof document !== "undefined"
  ? (document.title || "RemoDeck · 多智能体远程控制台")
  : "RemoDeck · 多智能体远程控制台";

function syncScopedDocumentTitle() {
  if (typeof document === "undefined") return;
  const failedCount = (state.threads || []).filter((t) => isThreadFailed(t, state.recentCompletedByThread)).length;
  const prefix = failedCount > 0 ? `[!${failedCount} 报错] ` : "";
  if (state.scopedProjectCwd) {
    const meta = state.projectsMeta?.[state.scopedProjectCwd]
      || Object.entries(state.projectsMeta || {}).find(([k]) => isSameProjectCwd(k, state.scopedProjectCwd))?.[1];
    const projName = meta?.alias || projectBaseName(state.scopedProjectCwd) || "项目";
    document.title = `${prefix}${projName} · RemoDeck`;
    return;
  }
  document.title = `${prefix}${DEFAULT_DOCUMENT_TITLE}`;
}

function createRemoteSearchBucket() {
  return {
    query: "",
    scopeKey: "",
    loading: false,
    threads: [],
    matchesById: new Map(),
    indexStatus: null,
    debounceTimer: null,
    pollTimer: null,
    abortController: null,
    pollAttempts: 0,
  };
}

function currentSearchScopeKey() {
  return `${state.providerFilter || "all"}|${state.showArchived ? 1 : 0}|${state.scopedProjectCwd || ""}`;
}

function isRemoteSearchAligned(bucket, searchText) {
  const trimmed = String(searchText || "").trim();
  return Boolean(
    trimmed
    && bucket
    && bucket.query === trimmed
    && bucket.scopeKey === currentSearchScopeKey(),
  );
}

function getRemoteSearchTarget(targetKey) {
  if (targetKey === "sidebar") {
    return {
      bucket: state.sidebarRemoteSearch,
      getQuery: () => String(state.sidebarSearchText || ""),
      render: () => renderThreadList(),
    };
  }
  return {
    bucket: state.boardRemoteSearch,
    getQuery: () => String(state.searchText || ""),
    render: () => renderProjectBoard(),
  };
}

async function executeRemoteSearch(targetKey, trimmedQuery, scopeKey) {
  const { bucket, getQuery, render } = getRemoteSearchTarget(targetKey);
  if (String(getQuery() || "").trim() !== trimmedQuery || currentSearchScopeKey() !== scopeKey) {
    return;
  }
  if (bucket.abortController) {
    bucket.abortController.abort();
  }
  const controller = new AbortController();
  bucket.abortController = controller;
  bucket.loading = true;
  render();

  const params = new URLSearchParams({
    q: trimmedQuery,
    archived: state.showArchived ? "1" : "0",
    limit: "60",
  });
  if (state.providerFilter && state.providerFilter !== "all") {
    params.set("provider", state.providerFilter);
  }
  if (state.scopedProjectCwd) {
    params.set("cwd", state.scopedProjectCwd);
  }

  try {
    const res = await apiGet(`api/threads/search?${params.toString()}`, {
      signal: controller.signal,
      useEtagCache: false,
    });
    if (bucket.abortController !== controller) return;
    if (String(getQuery() || "").trim() !== trimmedQuery || currentSearchScopeKey() !== scopeKey) return;
    const foundThreads = (res?.threads || []).filter((t) => !isInternalVoiceThreadClient(t));
    bucket.loading = false;
    bucket.threads = foundThreads;
    bucket.matchesById = new Map(
      foundThreads
        .filter((t) => t?.id && t.searchMatch)
        .map((t) => [t.id, t.searchMatch]),
    );
    bucket.indexStatus = res?.indexStatus || null;
    render();

    if (bucket.indexStatus?.indexing && bucket.pollAttempts < 20) {
      bucket.pollAttempts += 1;
      clearTimeout(bucket.pollTimer);
      bucket.pollTimer = setTimeout(() => {
        bucket.pollTimer = null;
        if (String(getQuery() || "").trim() === trimmedQuery && currentSearchScopeKey() === scopeKey) {
          void executeRemoteSearch(targetKey, trimmedQuery, scopeKey);
        }
      }, 1500);
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
    if (bucket.abortController === controller) {
      bucket.loading = false;
      render();
    }
  }
}

function scheduleRemoteSearch(targetKey, rawQuery, { immediate = false } = {}) {
  const { bucket } = getRemoteSearchTarget(targetKey);
  clearTimeout(bucket.debounceTimer);
  bucket.debounceTimer = null;
  clearTimeout(bucket.pollTimer);
  bucket.pollTimer = null;

  const trimmed = String(rawQuery || "").trim();
  if (!trimmed) {
    if (bucket.abortController) {
      bucket.abortController.abort();
      bucket.abortController = null;
    }
    bucket.query = "";
    bucket.scopeKey = "";
    bucket.loading = false;
    bucket.threads = [];
    bucket.matchesById = new Map();
    bucket.indexStatus = null;
    bucket.pollAttempts = 0;
    return;
  }

  const scopeKey = currentSearchScopeKey();
  if (bucket.query !== trimmed || bucket.scopeKey !== scopeKey) {
    if (bucket.abortController) {
      bucket.abortController.abort();
      bucket.abortController = null;
    }
    bucket.query = trimmed;
    bucket.scopeKey = scopeKey;
    bucket.threads = [];
    bucket.matchesById = new Map();
    bucket.pollAttempts = 0;
  }
  bucket.loading = true;
  const delayMs = immediate ? 0 : 200;
  bucket.debounceTimer = setTimeout(() => {
    bucket.debounceTimer = null;
    void executeRemoteSearch(targetKey, trimmed, scopeKey);
  }, delayMs);
}

function getProjectGroups({ ignoreFilters = false, includeSearch = true, searchText = undefined, remoteSearch = undefined } = {}) {
  const effectiveSearch = searchText !== undefined
    ? searchText
    : ((ignoreFilters || !includeSearch) ? "" : state.searchText);
  const trimmedSearch = String(effectiveSearch || "").trim();
  const alignedRemote = (!ignoreFilters && includeSearch && trimmedSearch && isRemoteSearchAligned(remoteSearch, trimmedSearch))
    ? remoteSearch
    : null;
  let sourceThreads = state.threads;
  if (alignedRemote && alignedRemote.threads?.length) {
    const existingIds = new Set(state.threads.map((t) => t?.id).filter(Boolean));
    const extras = alignedRemote.threads.filter(
      (t) => t?.id && !existingIds.has(t.id) && !isInternalVoiceThreadClient(t),
    );
    if (extras.length) {
      sourceThreads = [...state.threads, ...extras];
    }
  }
  const groups = buildProjectGroups(sourceThreads, {
    pendingRequests: state.pendingRequests,
    pendingRequestsSynced: state.pendingRequestsSynced,
    projectsMeta: state.projectsMeta,
    searchText: effectiveSearch,
    searchMatchesByThread: alignedRemote?.matchesById || null,
    providerFilter: ignoreFilters ? "all" : state.providerFilter,
    profileFilter: "all",
    recentCompletedByThread: state.recentCompletedByThread,
  });
  if (state.scopedProjectCwd) {
    return groups.filter((g) => isSameProjectCwd(g.cwd, state.scopedProjectCwd));
  }
  return groups;
}

function syncThreadsPendingCounts() {
  const counts = new Map();
  for (const req of state.pendingRequests) {
    if (!req?.threadId) continue;
    counts.set(req.threadId, (counts.get(req.threadId) || 0) + 1);
  }
  for (const t of state.threads) {
    if (!t?.id) continue;
    t.pendingCount = counts.get(t.id) || 0;
    t.pendingCountSynced = true;
  }
  if (state.activeThread?.id) {
    state.activeThread.pendingCount = counts.get(state.activeThread.id) || 0;
    state.activeThread.pendingCountSynced = true;
  }
}

function syncThreadSummaryIntoList(thread) {
  if (!thread?.id) return;
  const target = state.threads.find((t) => t.id === thread.id);
  if (!target) return;
  if (typeof thread.live === "boolean") {
    target.live = thread.live;
    if (thread.live) {
      target.lastTurnStatus = "";
      target.lastError = "";
      target.lastErrorAt = 0;
    }
  }
  if (typeof thread.queuedCount === "number") target.queuedCount = thread.queuedCount;
  if (typeof thread.lastTurnStatus === "string") target.lastTurnStatus = thread.lastTurnStatus;
  if (typeof thread.lastError === "string") target.lastError = thread.lastError;
  if (typeof thread.lastErrorAt === "number") target.lastErrorAt = thread.lastErrorAt;
  if (Number(thread.updatedAt) > Number(target.updatedAt || 0)) {
    target.updatedAt = Number(thread.updatedAt);
  }
  if (thread.title) target.title = thread.title;
  if (thread.preview) target.preview = thread.preview;
}

function defaultProviderValue() {
  return state.defaultProvider || "antigravity";
}

function defaultNewThreadProvider() {
  if (state.providerFilter && state.providerFilter !== "all") {
    return state.providerFilter;
  }
  return state.activeThread?.provider || defaultProviderValue();
}

function setProviderFilter(nextFilter = "all") {
  state.providerFilter = visibleProviderFilter(nextFilter || "all", state.hiddenProviderTabs);
  syncProfileSelectors();
  if (String(state.sidebarSearchText || "").trim()) {
    scheduleRemoteSearch("sidebar", state.sidebarSearchText, { immediate: true });
  }
  if (String(state.searchText || "").trim()) {
    scheduleRemoteSearch("board", state.searchText, { immediate: true });
  }
  renderThreadList();
  if (isBoardViewActive()) {
    renderProjectBoard();
  }
}

function renderProviderTabs() {
  replaceHtmlPreservingUiState($("providerTabs"), renderProviderTabsHtml(state.hiddenProviderTabs, state.providerFilter));
  replaceHtmlPreservingUiState($("providerTabsSettingsMenu"), renderProviderTabsSettingsHtml(state.hiddenProviderTabs));
}

function defaultProfileForProvider(provider) {
  const list = filterProfilesByProvider(state.profiles, provider);
  const preferred = provider === state.defaultProvider
    ? state.defaultProfileId
    : (provider === "antigravity" ? "cli" : "");
  return pickBestAvailableProfile(list, preferred)?.id || (provider === "antigravity" ? "cli" : "default");
}

function setTopbarMenuOpen(open) {
  const next = Boolean(open);
  state.topbarMenuOpen = next;
  if (next) state.composerConfigOpen = false;
  $("topbarMoreMenu")?.classList.toggle("is-open", next);
  $("topbarMoreBtn")?.setAttribute("aria-expanded", next ? "true" : "false");
  $("composerConfigPopover")?.classList.toggle("is-open", state.composerConfigOpen);
  $("composerConfigBtn")?.setAttribute("aria-expanded", state.composerConfigOpen ? "true" : "false");
}

function setComposerConfigOpen(open) {
  const next = Boolean(open);
  state.composerConfigOpen = next;
  if (next) state.topbarMenuOpen = false;
  if (!next) closeCustomSelectMenu();
  $("composerConfigPopover")?.classList.toggle("is-open", next);
  $("composerConfigBtn")?.setAttribute("aria-expanded", next ? "true" : "false");
  $("topbarMoreMenu")?.classList.toggle("is-open", state.topbarMenuOpen);
  $("topbarMoreBtn")?.setAttribute("aria-expanded", state.topbarMenuOpen ? "true" : "false");
}

function setSidebarOpen(open) {
  if (open) {
    setTopbarMenuOpen(false);
    setComposerConfigOpen(false);
  }
  const sidebar = $("sidebar");
  const backdrop = $("sidebarBackdrop");
  sidebar.classList.toggle("is-open", open);
  backdrop.hidden = !open;
}

function syncConnectionDots(mode = "connecting") {
  const clsSuffix = mode === "connected" ? "is-connected" : mode === "error" ? "is-error" : "is-connecting";
  const sidebarDot = $("sseStatusDot");
  if (sidebarDot) sidebarDot.className = `brand-dot ${clsSuffix}`;
  const topDot = $("topbarConnDot");
  if (topDot) {
    topDot.className = `topbar-conn-dot ${clsSuffix}`;
    topDot.title = mode === "connected" ? "实时连接正常" : mode === "error" ? "连接异常或离线" : "正在连接…";
  }
}

function showToastBanner(message, { detail = "", sticky = false, error = false } = {}) {
  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
    state.toastTimer = null;
  }
  state.toastActive = true;
  const banner = $("liveBanner");
  banner.classList.remove("is-ambient");
  banner.classList.toggle("is-error", Boolean(error));
  $("livePhaseText").textContent = message;
  $("liveDetailText").textContent = detail;
  banner.hidden = false;
  if (!sticky) {
    state.toastTimer = setTimeout(() => {
      state.toastTimer = null;
      state.toastActive = false;
      renderLiveBanner();
    }, 3500);
  }
}

function clearComposerStatus() {
  if (state.composerStatusTimer) {
    clearTimeout(state.composerStatusTimer);
    state.composerStatusTimer = null;
  }
  state.lastFailoverContext = null;
  state.lastUnarchiveContext = null;
  const el = $("composerStatus");
  if (!el) return;
  el.hidden = true;
  el.className = "composer-status";
  el.innerHTML = "";
}

function setComposerStatus(kind, message, { autoClearMs = 0, failoverContext = null, unarchiveContext = null } = {}) {
  const el = $("composerStatus");
  if (!el) return;
  if (state.composerStatusTimer) {
    clearTimeout(state.composerStatusTimer);
    state.composerStatusTimer = null;
  }
  const cleanMsg = String(message || "").trim();
  if (!cleanMsg) {
    clearComposerStatus();
    return;
  }
  state.lastFailoverContext = kind === "error" ? failoverContext : null;
  state.lastUnarchiveContext = kind === "error" ? unarchiveContext : null;
  const cls = ["composer-status"];
  if (kind === "error") cls.push("is-error");
  else if (kind === "success") cls.push("is-success");
  else cls.push("is-pending");
  el.className = cls.join(" ");
  let actionHtml = "";
  if (kind === "error" && unarchiveContext?.threadId) {
    actionHtml = `<button type="button" class="status-unarchive-btn" data-unarchive-retry-trigger>解除归档并重发</button>`;
  } else if (kind === "error" && failoverContext?.altProfile) {
    const altMeta = profileHealthVisualMeta(failoverContext.altProfile);
    const altLabel = failoverContext.altProfile.health?.alias
      || failoverContext.altProfile.label
      || failoverContext.altProfile.id;
    actionHtml = `<button type="button" class="status-failover-btn" data-failover-trigger><span class="profile-status-dot ${escapeHtml(altMeta.dotClass)}" aria-hidden="true"></span>切到 ${escapeHtml(altLabel)} 继续</button>`;
  }
  el.innerHTML = `<span class="composer-status-text">${escapeHtml(cleanMsg)}</span>`
    + actionHtml
    + (kind === "error" ? `<button type="button" class="composer-status-close" data-dismiss-composer-status aria-label="关闭提示">${iconSvg("close", { size: 12 })}</button>` : "");
  el.hidden = false;
  if (autoClearMs > 0) {
    state.composerStatusTimer = setTimeout(() => {
      state.composerStatusTimer = null;
      clearComposerStatus();
    }, autoClearMs);
  }
}

function formatActionError(error, fallback = "操作失败") {
  if (error?.status === 401 || error?.code === "unauthorized") {
    return "远程登录凭证已失效，请在本机控制台重新扫码配对";
  }
  return error?.message || fallback;
}

function isCodexOfficialClientErrorText(errorOrText) {
  if (!errorOrText) return false;
  if (typeof errorOrText === "string") {
    return /only allows codex official clients/i.test(errorOrText);
  }
  return [
    errorOrText.message,
    errorOrText.additionalDetails,
    errorOrText.detail,
    errorOrText.error?.message,
    errorOrText.error?.additionalDetails,
  ].some((part) => /only allows codex official clients/i.test(String(part || "")));
}

function isActiveThreadRunning() {
  if (!state.activeThread) return false;
  const actStatus = state.liveActivity?.status;
  if (actStatus === "running" || actStatus === "inProgress") return true;
  if (actStatus && actStatus !== "running" && actStatus !== "inProgress") return false;
  if (state.activeThread.live) return true;
  const turns = state.activeThread.turns || [];
  return turns[turns.length - 1]?.status === "inProgress";
}

function currentComposerProvider() {
  if (state.activeThread?.provider) return state.activeThread.provider;
  return $("composerProviderSelect").value || defaultProviderValue();
}

function currentComposerProfileId() {
  if (state.activeThread?.profileId) return state.activeThread.profileId;
  return $("composerProfileSelect").value || defaultProfileForProvider(currentComposerProvider());
}

function syncProfileSelectors() {
  renderProviderTabs();
  state.profileFilter = "all";

  const providerSelect = $("composerProviderSelect");
  const newProviderSelect = $("newProviderSelect");
  const providerOpts = ["antigravity", "codex", "claude", "grok", "qoder"].map((id) =>
    `<option value="${id}">${escapeHtml(providerDisplayName(id))}</option>`,
  ).join("");
  const prevCompProvider = providerSelect.dataset.initialized ? providerSelect.value : defaultProviderValue();
  const prevNewProvider = newProviderSelect.dataset.initialized ? newProviderSelect.value : defaultProviderValue();
  providerSelect.innerHTML = providerOpts;
  newProviderSelect.innerHTML = providerOpts;
  const hasActiveThread = Boolean(state.activeThread);
  providerSelect.value = state.activeThread?.provider || prevCompProvider || defaultProviderValue();
  providerSelect.dataset.initialized = "1";
  providerSelect.disabled = hasActiveThread;
  providerSelect.hidden = hasActiveThread;
  newProviderSelect.value = prevNewProvider || defaultProviderValue();
  newProviderSelect.dataset.initialized = "1";

  syncComposerProfileSelect();
  syncNewProviderPills();
  syncNewProfileSelect();
  syncNewModelSelect();
  syncPermissionSelectors();
  syncCfgFieldVisibility();
  renderComposerConfigChip();
  renderQuotaStrip();
  syncAllCustomSelects();
}

const CLIENT_TELEMETRY_WINDOW_MS = 6000;
const clientStreamSamplesByProvider = new Map();
const clientStreamSamplesByProfile = new Map();
let clientTelemetryDecayTimer = null;
let telemetryRefreshTimer = null;
let telemetryRenderScheduled = false;

function estimateClientTokens(text = "") {
  const s = String(text || "");
  if (!s) return 0;
  let cjk = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s.charCodeAt(i) > 0x2e80) cjk += 1;
  }
  const other = s.length - cjk;
  return Math.max(1, Math.round(cjk * 0.72 + other * 0.28));
}

function pruneClientSampleMap(sampleMap, nowMs) {
  const cutoff = nowMs - CLIENT_TELEMETRY_WINDOW_MS;
  for (const [key, arr] of sampleMap.entries()) {
    const kept = arr.filter((s) => s.at >= cutoff);
    if (kept.length) sampleMap.set(key, kept);
    else sampleMap.delete(key);
  }
}

function pruneClientStreamSamples(nowMs = Date.now()) {
  pruneClientSampleMap(clientStreamSamplesByProvider, nowMs);
  pruneClientSampleMap(clientStreamSamplesByProfile, nowMs);
  if (!clientStreamSamplesByProvider.size && !clientStreamSamplesByProfile.size && clientTelemetryDecayTimer) {
    clearInterval(clientTelemetryDecayTimer);
    clientTelemetryDecayTimer = null;
  }
}

function computeClientStreamTpsFromMap(sampleMap, key, nowMs = Date.now()) {
  const arr = sampleMap.get(key);
  if (!arr?.length) return 0;
  const cutoff = nowMs - CLIENT_TELEMETRY_WINDOW_MS;
  let tokens = 0;
  let earliest = nowMs;
  for (const s of arr) {
    if (s.at < cutoff) continue;
    tokens += s.tokens;
    if (s.at < earliest) earliest = s.at;
  }
  if (tokens <= 0) return 0;
  const elapsedSec = Math.max(1.2, (nowMs - earliest) / 1000);
  return Math.round((tokens / elapsedSec) * 10) / 10;
}

function scheduleTelemetryBarRender() {
  if (telemetryRenderScheduled) return;
  telemetryRenderScheduled = true;
  requestAnimationFrame(() => {
    telemetryRenderScheduled = false;
    renderAgentTelemetryBar();
  });
}

function pushClientSample(sampleMap, key, nowMs, tokens) {
  const arr = sampleMap.get(key) || [];
  arr.push({ at: nowMs, tokens });
  if (arr.length > 240) arr.splice(0, arr.length - 240);
  sampleMap.set(key, arr);
}

function extractProfileKeyFromThreadId(threadId = "") {
  const parts = String(threadId || "").split(":");
  if (parts.length < 2) return "";
  const prov = String(parts[0] || "").trim().toLowerCase();
  const profId = String(parts[1] || "").trim();
  if (!prov || !profId) return "";
  return `${prov}:${profId}`;
}

function recordClientStreamDelta(provider, delta, threadId = "") {
  const prov = String(provider || "").trim().toLowerCase();
  const tokens = estimateClientTokens(delta);
  if (!prov || tokens <= 0) return;
  const nowMs = Date.now();
  pushClientSample(clientStreamSamplesByProvider, prov, nowMs, tokens);
  const pKey = extractProfileKeyFromThreadId(threadId);
  if (pKey) {
    pushClientSample(clientStreamSamplesByProfile, pKey, nowMs, tokens);
  }
  if (!clientTelemetryDecayTimer) {
    clientTelemetryDecayTimer = setInterval(() => {
      pruneClientStreamSamples(Date.now());
      renderAgentTelemetryBar();
    }, 1000);
  }
  scheduleTelemetryBarRender();
}

function buildMergedTelemetrySnapshot(nowMs = Date.now()) {
  pruneClientStreamSamples(nowMs);
  const base = state.telemetry?.byProvider ? state.telemetry : null;
  const byProvider = {};
  let runningCount = 0;
  let queuedCount = 0;
  let tokensPerSec = 0;

  for (const prov of ["codex", "claude", "antigravity", "grok", "qoder"]) {
    const serverStat = base?.byProvider?.[prov] || {};
    const liveThreadsFallback = base
      ? []
      : state.threads.filter((t) => t.provider === prov && t.live);
    const activeThreads = Array.isArray(serverStat.activeThreads) && serverStat.activeThreads.length
      ? serverStat.activeThreads
      : liveThreadsFallback.map((t) => ({ id: t.id, title: t.title || t.name || t.id }));
    const provRunning = base
      ? Number(serverStat.runningCount || 0)
      : liveThreadsFallback.length;
    const provQueued = base
      ? Number(serverStat.queuedCount || 0)
      : state.threads.filter((t) => t.provider === prov && Number(t.queuedCount || 0) > 0)
        .reduce((acc, t) => acc + Number(t.queuedCount || 0), 0);
    const clientTps = computeClientStreamTpsFromMap(clientStreamSamplesByProvider, prov, nowMs);
    const provTps = Math.max(Number(serverStat.tokensPerSec || 0), clientTps);

    byProvider[prov] = {
      provider: prov,
      runningCount: provRunning,
      queuedCount: provQueued,
      tokensPerSec: Math.round(provTps * 10) / 10,
      activeThreads,
    };
    runningCount += provRunning;
    queuedCount += provQueued;
    tokensPerSec += byProvider[prov].tokensPerSec;
  }

  const byProfile = {};
  const profileKeys = new Set(Object.keys(base?.byProfile || {}));
  for (const p of state.profiles || []) {
    if (p?.key) profileKeys.add(p.key);
    else if (p?.provider && p?.id) profileKeys.add(`${p.provider}:${p.id}`);
  }
  for (const pKey of clientStreamSamplesByProfile.keys()) {
    profileKeys.add(pKey);
  }
  for (const pKey of profileKeys) {
    const serverProf = base?.byProfile?.[pKey] || null;
    const [prov, profId] = pKey.split(":");
    const prefix = `${pKey}:`;
    const liveFallback = base
      ? []
      : state.threads.filter((t) => t.live && String(t.id || "").startsWith(prefix));
    const profThreads = Array.isArray(serverProf?.activeThreads) && serverProf.activeThreads.length
      ? serverProf.activeThreads
      : liveFallback.map((t) => ({ id: t.id, title: t.title || t.name || t.id }));
    const profRunning = base && serverProf
      ? Number(serverProf.runningCount || 0)
      : liveFallback.length;
    const profQueued = base && serverProf
      ? Number(serverProf.queuedCount || 0)
      : state.threads.filter((t) => Number(t.queuedCount || 0) > 0 && String(t.id || "").startsWith(prefix))
        .reduce((acc, t) => acc + Number(t.queuedCount || 0), 0);
    const clientProfTps = computeClientStreamTpsFromMap(clientStreamSamplesByProfile, pKey, nowMs);
    const profTps = Math.max(Number(serverProf?.tokensPerSec || 0), clientProfTps);
    byProfile[pKey] = {
      key: pKey,
      provider: serverProf?.provider || prov || "",
      profileId: serverProf?.profileId || profId || "",
      runningCount: profRunning,
      queuedCount: profQueued,
      tokensPerSec: Math.round(profTps * 10) / 10,
      activeThreads: profThreads,
    };
  }

  return {
    updatedAt: base?.updatedAt || nowMs,
    totals: {
      runningCount,
      queuedCount,
      tokensPerSec: Math.round(tokensPerSec * 10) / 10,
    },
    byProvider,
    byProfile,
  };
}

function applyTelemetrySnapshot(snap) {
  if (!snap || typeof snap !== "object" || !snap.byProvider) return;
  state.telemetry = snap;
  renderAgentTelemetryBar();
}

async function refreshTelemetry() {
  try {
    const res = await apiGetWithHotFallback("api/telemetry");
    if (res?.byProvider) {
      applyTelemetrySnapshot(res);
    }
  } catch {
    // Ignore transient telemetry polling failures; SSE push keeps recovering.
  }
}

function scheduleTelemetryRefresh(delayMs = 150) {
  if (telemetryRefreshTimer) clearTimeout(telemetryRefreshTimer);
  telemetryRefreshTimer = setTimeout(() => {
    telemetryRefreshTimer = null;
    void refreshTelemetry();
  }, Math.max(50, Number(delayMs) || 150));
}

async function refreshExecutionStats() {
  if (state.executionStatsLoading) return;
  state.executionStatsLoading = true;
  state.executionStatsError = "";
  renderAgentTelemetryBar();
  try {
    const params = new URLSearchParams({ days: String(state.executionStatsDays), provider: state.executionStatsProvider });
    state.executionStats = await apiGet(`api/executions?${params}`);
  } catch (error) {
    state.executionStatsError = Number(error?.status) === 404
      ? "当前后台尚未启用执行统计，重启服务后开始采样。"
      : `读取统计失败：${formatActionError(error)}`;
  } finally {
    state.executionStatsLoading = false;
    renderAgentTelemetryBar();
  }
}

let telemetryHeroAnim = null;
let telemetryClosing = false;

function cancelTelemetryHeroAnim() {
  if (telemetryHeroAnim) {
    try { telemetryHeroAnim.cancel(); } catch {}
    telemetryHeroAnim = null;
  }
  telemetryClosing = false;
}

function getTelemetryHeroAnchorEl(preferredEl = null) {
  if (typeof document === "undefined") return null;
  const desktopSlot = $("topbarTelemetrySlot");
  const isNarrow = typeof window !== "undefined" && window.innerWidth <= 960;
  const preferredPill = preferredEl?.closest?.(".telemetry-compact-items, .telemetry-compact-pill, #topbarTelemetrySlot, #telemetryTopbarBtn");
  if (preferredPill && desktopSlot?.contains(preferredPill)) return preferredPill;
  if (!isNarrow && desktopSlot && !desktopSlot.hidden) {
    return desktopSlot.querySelector(".telemetry-compact-items") || desktopSlot;
  }
  const bar = $("agentTelemetryBar");
  return bar?.querySelector(".telemetry-compact-items") || $("telemetryTopbarBtn") || desktopSlot || bar || null;
}

function syncTelemetryPopoverAnchor(el, anchorEl) {
  if (!el || !anchorEl || typeof window === "undefined") return;
  if (window.innerWidth <= 960) {
    el.style.removeProperty("--telemetry-popover-top");
    el.style.removeProperty("--telemetry-popover-right");
    return;
  }
  const rect = anchorEl.getBoundingClientRect?.();
  if (!rect || rect.width <= 0) return;
  const top = Math.max(50, Math.round(rect.bottom + 8));
  const right = Math.max(12, Math.round(window.innerWidth - rect.right));
  el.style.setProperty("--telemetry-popover-top", `${top}px`);
  el.style.setProperty("--telemetry-popover-right", `${right}px`);
}

function openTelemetryPopover(preferredAnchor = null) {
  const el = $("agentTelemetryBar");
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 960;
  const anchorEl = isMobile ? null : getTelemetryHeroAnchorEl(preferredAnchor);
  const fromRect = anchorEl?.getBoundingClientRect?.() || null;
  cancelTelemetryHeroAnim();
  state.telemetryExpanded = true;
  if (isMobile) {
    state.mobileTelemetryOpen = true;
  }
  syncTelemetryPopoverAnchor(el, anchorEl);
  renderAgentTelemetryBar();
  void refreshExecutionStats();
  if (!el || el.hidden || typeof el.animate !== "function") return;
  if (isMobile) {
    telemetryHeroAnim = el.animate([
      {
        transformOrigin: "top center",
        transform: "translate3d(0, -8px, 0) scale(0.97)",
        opacity: 0,
      },
      {
        transformOrigin: "top center",
        transform: "translate3d(0, 0, 0) scale(1)",
        opacity: 1,
      },
    ], {
      duration: 180,
      easing: "cubic-bezier(0.22, 1, 0.36, 1)",
    });
    telemetryHeroAnim.onfinish = () => {
      telemetryHeroAnim = null;
    };
    return;
  }
  if (!fromRect || fromRect.width <= 0 || fromRect.height <= 0) return;
  const toRect = el.getBoundingClientRect?.();
  if (!toRect || toRect.width <= 0 || toRect.height <= 0) return;
  const dx = fromRect.left - toRect.left;
  const dy = fromRect.top - toRect.top;
  const sx = Math.max(0.16, Math.min(1, fromRect.width / toRect.width));
  const sy = Math.max(0.08, Math.min(1, fromRect.height / toRect.height));
  telemetryHeroAnim = el.animate([
    {
      transformOrigin: "top left",
      transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`,
      opacity: 0.35,
    },
    {
      transformOrigin: "top left",
      transform: "translate3d(0, 0, 0) scale(1, 1)",
      opacity: 1,
    },
  ], {
    duration: 220,
    easing: "cubic-bezier(0.22, 1, 0.36, 1)",
  });
  telemetryHeroAnim.onfinish = () => {
    telemetryHeroAnim = null;
  };
}

function closeTelemetryPopover(preferredAnchor = null) {
  if (!state.telemetryExpanded && !state.telemetryPickerOpen && !state.mobileTelemetryOpen) return;
  const el = $("agentTelemetryBar");
  const backdrop = $("telemetryBackdrop");
  const isMobile = typeof window !== "undefined" && window.innerWidth <= 960;
  const anchorEl = isMobile ? null : getTelemetryHeroAnchorEl(preferredAnchor);
  const canAnimate = Boolean(
    el
    && !el.hidden
    && typeof el.animate === "function"
    && (isMobile || anchorEl)
    && typeof window !== "undefined"
  );
  const fromRect = canAnimate && !isMobile ? el.getBoundingClientRect?.() : null;
  const toRect = canAnimate && !isMobile ? anchorEl?.getBoundingClientRect?.() : null;

  cancelTelemetryHeroAnim();
  state.telemetryExpanded = false;
  state.telemetryPickerOpen = false;
  state.mobileTelemetryOpen = false;

  if (canAnimate && isMobile) {
    telemetryClosing = true;
    if (backdrop) {
      backdrop.classList.remove("is-open");
      backdrop.hidden = true;
    }
    $("topbarTelemetrySlot")?.classList.remove("is-popover-open");
    const anim = el.animate([
      {
        transformOrigin: "top center",
        transform: "translate3d(0, 0, 0) scale(1)",
        opacity: 1,
      },
      {
        transformOrigin: "top center",
        transform: "translate3d(0, -6px, 0) scale(0.97)",
        opacity: 0,
      },
    ], {
      duration: 140,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      fill: "forwards",
    });
    telemetryHeroAnim = anim;
    anim.onfinish = () => {
      if (telemetryHeroAnim === anim) telemetryHeroAnim = null;
      telemetryClosing = false;
      try { anim.cancel(); } catch {}
      renderAgentTelemetryBar();
    };
    return;
  }

  if (canAnimate && fromRect && toRect && fromRect.width > 0 && fromRect.height > 0 && toRect.width > 0 && toRect.height > 0) {
    telemetryClosing = true;
    if (backdrop) {
      backdrop.classList.remove("is-open");
      backdrop.hidden = true;
    }
    $("topbarTelemetrySlot")?.classList.remove("is-popover-open");
    const dx = toRect.left - fromRect.left;
    const dy = toRect.top - fromRect.top;
    const sx = Math.max(0.16, Math.min(1, toRect.width / fromRect.width));
    const sy = Math.max(0.08, Math.min(1, toRect.height / fromRect.height));
    const anim = el.animate([
      {
        transformOrigin: "top left",
        transform: "translate3d(0, 0, 0) scale(1, 1)",
        opacity: 1,
      },
      {
        transformOrigin: "top left",
        transform: `translate3d(${dx}px, ${dy}px, 0) scale(${sx}, ${sy})`,
        opacity: 0,
      },
    ], {
      duration: 185,
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
      fill: "forwards",
    });
    telemetryHeroAnim = anim;
    anim.onfinish = () => {
      if (telemetryHeroAnim === anim) telemetryHeroAnim = null;
      telemetryClosing = false;
      try { anim.cancel(); } catch {}
      renderAgentTelemetryBar();
    };
    return;
  }

  renderAgentTelemetryBar();
}

function renderAgentTelemetryBar() {
  const el = $("agentTelemetryBar");
  const desktopSlot = $("topbarTelemetrySlot");
  const backdrop = $("telemetryBackdrop");
  const merged = buildMergedTelemetrySnapshot();
  const items = buildSelectableTelemetryItems(state.profiles);
  const visibleKeys = resolveVisibleTelemetryKeys(items, state.telemetryVisiblePrefs);
  summarizeTelemetryMobileBadge(state.profiles, merged, visibleKeys);

  const topbarBtn = $("telemetryTopbarBtn");
  const isDetailOpen = Boolean(state.telemetryExpanded || state.telemetryPickerOpen);
  if (isDetailOpen && !state.executionStats && !state.executionStatsError && !state.executionStatsLoading) void refreshExecutionStats();
  if (topbarBtn) {
    topbarBtn.hidden = true;
    topbarBtn.setAttribute("aria-hidden", "true");
    topbarBtn.classList.toggle("is-open", isDetailOpen || Boolean(state.mobileTelemetryOpen));
    topbarBtn.setAttribute("aria-expanded", isDetailOpen ? "true" : "false");
  }

  const activeProvider = state.activeThread?.provider || $("composerProviderSelect")?.value || "";
  const activeProfileId = state.activeThread?.profileId || $("composerProfileSelect")?.value || "";
  const compactSlotHtml = renderAgentTelemetryBarHtml(state.profiles, merged, {
    providerFilter: state.providerFilter,
    expanded: false,
    refreshing: state.quotaRefreshing,
    visibleKeys,
    pickerOpen: false,
    activeProvider,
    activeProfileId,
  });

  if (desktopSlot) {
    replaceHtmlPreservingUiState(desktopSlot, compactSlotHtml);
    desktopSlot.hidden = !compactSlotHtml;
    desktopSlot.classList.toggle("is-popover-open", isDetailOpen);
  }

  if (backdrop) {
    const showBackdrop = Boolean(isDetailOpen && !telemetryClosing);
    backdrop.hidden = !showBackdrop;
    backdrop.classList.toggle("is-open", showBackdrop);
  }

  if (telemetryClosing) return;

  const liveHtml = isDetailOpen
    ? renderAgentTelemetryBarHtml(state.profiles, merged, {
        providerFilter: state.providerFilter,
        expanded: state.telemetryExpanded,
        refreshing: state.quotaRefreshing,
        visibleKeys,
        pickerOpen: state.telemetryPickerOpen,
        activeProvider,
        activeProfileId,
      })
    : compactSlotHtml;
  const statsHtml = isDetailOpen
    ? renderExecutionStatsHtml(state.executionStats, {
        days: state.executionStatsDays,
        provider: state.executionStatsProvider,
        loading: state.executionStatsLoading,
        error: state.executionStatsError,
      })
    : "";

  if (!el) return;
  const hasAny = Boolean(liveHtml || statsHtml);
  if (!hasAny) {
    el._acLastHtml = "";
    el.innerHTML = "";
  } else if (isDetailOpen) {
    let liveSec = el.querySelector(":scope > .telemetry-live-section");
    let statsSec = el.querySelector(":scope > .telemetry-stats-section");
    if (!liveSec || !statsSec) {
      el._acLastHtml = "__split__";
      el.innerHTML = `<div class="telemetry-live-section"></div><div class="telemetry-stats-section"></div>`;
      liveSec = el.querySelector(":scope > .telemetry-live-section");
      statsSec = el.querySelector(":scope > .telemetry-stats-section");
    }
    replaceHtmlPreservingUiState(liveSec, liveHtml);
    replaceHtmlPreservingUiState(statsSec, statsHtml);
  } else {
    replaceHtmlPreservingUiState(el, liveHtml);
  }
  el.hidden = !hasAny;
  el.classList.toggle("is-expanded", Boolean(hasAny && isDetailOpen));
  el.classList.toggle("is-mobile-open", Boolean(hasAny && (state.mobileTelemetryOpen || isDetailOpen)));
  if (isDetailOpen) syncTelemetryPopoverAnchor(el, getTelemetryHeroAnchorEl());
}

function renderQuotaStrip() {
  const el = $("agentQuotaStrip");
  if (el) {
    el.innerHTML = "";
    el.hidden = true;
  }
  renderAgentTelemetryBar();
}

let lastAutoQuotaRefreshAt = 0;
let quotaAutoRefreshInFlight = false;
let quotaAutoRefreshTick = 0;

async function refreshQuotasSilent({ refresh = false } = {}) {
  if (state.quotaRefreshing || quotaAutoRefreshInFlight || document.visibilityState === "hidden") return;
  const nowMs = Date.now();
  if ((nowMs - lastAutoQuotaRefreshAt) < 30_000) return;
  quotaAutoRefreshInFlight = true;
  lastAutoQuotaRefreshAt = nowMs;
  try {
    const qs = refresh ? "?refresh=1" : "";
    let res = await apiGet(`api/quotas${qs}`);
    if ((!Array.isArray(res?.quotas) || !res.quotas.length) && state.useHotExtension) {
      res = await apiGet(`apps/ac-hot/api/quotas${qs}`).catch(() => res);
    }
    const byKey = res?.byKey && typeof res.byKey === "object" ? res.byKey : null;
    if (byKey && Array.isArray(state.profiles) && state.profiles.length) {
      state.profiles = state.profiles.map((p) => {
        const key = p.key || `${p.provider}:${p.id}`;
        return byKey[key] ? { ...p, quota: byKey[key] } : p;
      });
      syncProfileSelectors();
      renderTopbarAndControls();
      renderQuotaStrip();
    }
  } catch {
    // Preserve current quota view if background refresh fails transiently.
  } finally {
    quotaAutoRefreshInFlight = false;
  }
}

async function refreshQuotasManual() {
  if (state.quotaRefreshing) return;
  state.quotaRefreshing = true;
  lastAutoQuotaRefreshAt = Date.now();
  renderQuotaStrip();
  try {
    let res = await apiPost("api/quotas/refresh", {});
    if ((!Array.isArray(res?.quotas) || !res.quotas.length) && state.useHotExtension) {
      res = await apiPost("apps/ac-hot/api/quotas/refresh", {}).catch(() => res);
    }
    const byKey = res?.byKey && typeof res.byKey === "object" ? res.byKey : null;
    if (byKey && Array.isArray(state.profiles) && state.profiles.length) {
      state.profiles = state.profiles.map((p) => {
        const key = p.key || `${p.provider}:${p.id}`;
        return byKey[key] ? { ...p, quota: byKey[key] } : p;
      });
      syncProfileSelectors();
      renderTopbarAndControls();
    } else {
      await refreshProviders();
    }
  } catch (err) {
    showToastBanner("刷新额度失败", { detail: formatActionError(err), error: true });
  } finally {
    state.quotaRefreshing = false;
    renderQuotaStrip();
  }
}

function syncComposerProfileSelect() {
  const select = $("composerProfileSelect");
  const provider = currentComposerProvider();
  const rawList = filterProfilesByProvider(state.profiles, provider);
  const list = sortProfilesByAvailability(rawList);
  const prev = select.value;
  select.innerHTML = (list.length ? list : [{ id: defaultProfileForProvider(provider), label: "默认" }])
    .map((p) => `<option value="${escapeHtml(p.id)}" data-compact-label="${escapeHtml(resolveDistinctProfileChipText(p, list))}">${escapeHtml(profileOptionLabel(p))}</option>`)
    .join("");
  if (state.activeThread?.profileId) {
    select.value = state.activeThread.profileId;
  } else if ([...select.options].some((o) => o.value === prev)) {
    select.value = prev;
  } else {
    select.value = defaultProfileForProvider(provider);
  }
  const hasActiveThread = Boolean(state.activeThread);
  select.disabled = hasActiveThread;
  select.hidden = list.length === 0;

  const pillsEl = $("composerProfilePills");
  if (pillsEl) {
    pillsEl.innerHTML = renderProfilePillsHtml(list, {
      selectedId: select.value,
      probingKeys: state.probingProfileKeys,
      activeLocked: hasActiveThread,
      allowManageButton: true,
      provider,
    });
  }
  renderCodexCompatBanner();

  syncCfgFieldVisibility();
  renderComposerConfigChip();
  syncAllCustomSelects();
}

function syncNewProviderPills() {
  const pillsEl = $("newProviderPills");
  if (!pillsEl) return;
  const provider = $("newProviderSelect")?.value || defaultNewThreadProvider();
  pillsEl.innerHTML = renderProviderPillsHtml({
    selectedProvider: provider,
    profiles: state.profiles,
  });
}

function selectNewModalProvider(nextProvider) {
  const select = $("newProviderSelect");
  if (!select || !nextProvider) return;
  if (![...select.options].some((o) => o.value === nextProvider)) return;
  select.value = nextProvider;
  syncNewProviderPills();
  syncNewProfileSelect();
  void refreshModelsForProfile(nextProvider, $("newProfileSelect")?.value || "");
}

function syncNewProfileSelect() {
  const provider = $("newProviderSelect").value || defaultProviderValue();
  const list = sortProfilesByAvailability(filterProfilesByProvider(state.profiles, provider));
  const select = $("newProfileSelect");
  const prev = select.value;
  select.innerHTML = (list.length ? list : [{ id: defaultProfileForProvider(provider), label: "默认" }])
    .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(profileOptionLabel(p))}</option>`)
    .join("");
  if ([...select.options].some((o) => o.value === prev && !list.find((p) => p.id === prev)?.health?.disabled)) {
    select.value = prev;
  } else {
    select.value = defaultProfileForProvider(provider);
  }
  const pillsEl = $("newProfilePills");
  if (pillsEl) {
    pillsEl.innerHTML = renderProfilePillsHtml(list, {
      selectedId: select.value,
      probingKeys: state.probingProfileKeys,
      activeLocked: false,
      allowManageButton: true,
      provider,
    });
  }
  const addBtn = $("newModalAddProfileBtn");
  if (addBtn) {
    addBtn.hidden = provider !== "codex" && provider !== "claude";
  }
  const probeBtn = $("newModalProbeProfilesBtn");
  if (probeBtn) {
    const anyProbing = list.some((p) => state.probingProfileKeys.has(p.key || `${p.provider}:${p.id}`));
    probeBtn.disabled = anyProbing || !list.length;
    probeBtn.innerHTML = anyProbing ? "测通中…" : `${iconSvg("bolt", { size: 11 })}<span>测通</span>`;
  }
  syncNewModelSelect();
}

function renderModelOptionsHtml(models = []) {
  const renderOption = (m) =>
    `<option value="${escapeHtml(m.id || m.model)}">${escapeHtml(m.displayName || m.model || m.id)}</option>`;
  const mainItems = models.filter((m) => m?.section !== "overflow");
  const overflowItems = models.filter((m) => m?.section === "overflow");
  if (mainItems.length && overflowItems.length) {
    return `<optgroup label="主力模型">${mainItems.map(renderOption).join("")}</optgroup>`
      + `<optgroup label="更多版本">${overflowItems.map(renderOption).join("")}</optgroup>`;
  }
  return models.map(renderOption).join("");
}

function syncNewModelSelect(preferredModel = "") {
  const modelSelect = $("newModelSelect");
  if (!modelSelect) return;
  const provider = $("newProviderSelect").value || defaultProviderValue();
  preferredModel ||= getNewThreadPrefs(provider).model || "";
  const rawModels = resolveModelsForProvider(state.modelsByProvider, state.allModels, provider);
  const models = ensurePreferredModelInList(rawModels, provider, preferredModel);
  if (!models.length) {
    modelSelect.innerHTML = `<option value="">默认模型</option>`;
    return;
  }
  modelSelect.innerHTML = renderModelOptionsHtml(models);
  const selected = pickDefaultModelForProvider(models, provider, preferredModel);
  if (selected) modelSelect.value = selected.id || selected.model;
}

function effectivePermissionModeForThread(threadId = state.activeThreadId, threadObj = state.activeThread) {
  const localPref = getLocalThreadPrefs(threadId);
  return normalizeUiPermissionMode(
    localPref?.permissionMode || threadObj?.permissionMode || state.defaultPermissionMode || "turbo",
    "turbo",
  );
}

function syncPermissionSelectors() {
  const permSelect = $("permissionSelect");
  if (permSelect) {
    const effective = effectivePermissionModeForThread();
    permSelect.disabled = false;
    permSelect.hidden = false;
    permSelect.value = effective;
    permSelect.classList.toggle("is-turbo", effective === "turbo");
  }
  const newPermSelect = $("newPermissionSelect");
  if (newPermSelect && !$("newThreadModal")?.open) {
    newPermSelect.value = normalizeUiPermissionMode(state.defaultPermissionMode || "turbo", "turbo");
  }
  renderComposerConfigChip();
  syncAllCustomSelects();
}

function syncModelAndEffortSelectors() {
  const provider = currentComposerProvider();
  const modelSelect = $("modelSelect");
  const effortSelect = $("effortSelect");
  const keepDraftModel = !state.activeThread && state.lastModelProvider === provider && state.userPickedDraftModel;
  const localPref = getLocalThreadPrefs(state.activeThreadId);
  const preferredModel = localPref?.model
    || state.activeThread?.model
    || (keepDraftModel ? modelSelect.value : "")
    || (!state.activeThreadId ? getNewThreadPrefs(provider).model : "")
    || "";
  const rawModels = resolveModelsForProvider(state.modelsByProvider, state.allModels, provider);
  const models = ensurePreferredModelInList(rawModels, provider, preferredModel);
  state.lastModelProvider = provider;

  modelSelect.disabled = false;
  modelSelect.hidden = false;

  if (!models.length) {
    modelSelect.innerHTML = `<option value="">默认模型</option>`;
    effortSelect.hidden = true;
    effortSelect.disabled = true;
    syncCfgFieldVisibility();
    renderComposerConfigChip();
    syncAllCustomSelects();
    return;
  }

  modelSelect.innerHTML = renderModelOptionsHtml(models);

  const selected = pickDefaultModelForProvider(models, provider, preferredModel);
  if (selected) modelSelect.value = selected.id || selected.model;

  syncEffortSelectForModel(selected);
  syncCfgFieldVisibility();
  renderComposerConfigChip();
  syncAllCustomSelects();
}

function normalizeEffortOptionValue(item) {
  if (!item) return "";
  if (typeof item === "string") {
    const trimmed = item.trim();
    return trimmed === "[object Object]" ? "" : trimmed;
  }
  if (typeof item === "object") {
    return normalizeEffortOptionValue(item.reasoningEffort ?? item.id ?? item.value ?? "");
  }
  return "";
}

function syncEffortSelectForModel(selected) {
  const effortSelect = $("effortSelect");
  const efforts = (selected?.supportedReasoningEfforts || [])
    .map(normalizeEffortOptionValue)
    .filter(Boolean);
  const effortLabels = { low: "低思考", medium: "中思考", high: "高思考", xhigh: "超高思考", max: "最高思考" };
  if (!efforts.length) {
    effortSelect.innerHTML = `<option value="">默认强度</option>`;
    effortSelect.value = "";
    effortSelect.disabled = true;
    effortSelect.hidden = true;
    syncCfgFieldVisibility();
    renderComposerConfigChip();
    syncAllCustomSelects();
    return;
  }
  effortSelect.hidden = false;
  effortSelect.disabled = false;
  effortSelect.innerHTML = efforts.map((e) =>
    `<option value="${escapeHtml(e)}">${escapeHtml(effortLabels[e] || e)}</option>`,
  ).join("");
  const localPref = getLocalThreadPrefs(state.activeThreadId);
  const legacyModelEffort = resolveAntigravityModelSelection(
    localPref?.model || state.activeThread?.model || "",
  ).effort;
  const preferredEffort = normalizeEffortOptionValue(localPref?.effort)
    || normalizeEffortOptionValue(state.activeThread?.reasoningEffort)
    || (!state.activeThreadId ? normalizeEffortOptionValue(getNewThreadPrefs(currentComposerProvider()).effort) : "")
    || normalizeEffortOptionValue(legacyModelEffort)
    || normalizeEffortOptionValue(selected?.defaultReasoningEffort)
    || "medium";
  if (efforts.includes(preferredEffort)) effortSelect.value = preferredEffort;
  syncCfgFieldVisibility();
  renderComposerConfigChip();
  syncAllCustomSelects();
}

function syncCfgFieldVisibility() {
  for (const id of ["composerProviderSelect", "effortSelect"]) {
    const el = $(id);
    const field = el?.closest(".cfg-field");
    if (field) field.hidden = Boolean(el.hidden);
  }
  const profileField = $("composerProfileField");
  if (profileField) {
    const provider = currentComposerProvider();
    const list = filterProfilesByProvider(state.profiles, provider);
    profileField.hidden = list.length === 0;
  }
}

function renderComposerConfigChip() {
  const btn = $("composerConfigBtn");
  if (!btn) return;
  const permMode = $("permissionSelect")?.value || effectivePermissionModeForThread() || "turbo";
  const permMeta = permissionVisualMeta(permMode);
  const provider = currentComposerProvider();
  const profileId = currentComposerProfileId();
  const providerProfiles = filterProfilesByProvider(state.profiles, provider);
  const activeProfile = providerProfiles.find((p) => p.id === profileId) || null;
  const profMeta = activeProfile ? profileHealthVisualMeta(activeProfile) : null;
  const hasProfileIssue = Boolean(profMeta && profMeta.status !== "unknown" && profMeta.status !== "healthy");
  const showProfileTag = Boolean(
    activeProfile && (providerProfiles.length >= 2 || hasProfileIssue || String(activeProfile.health?.alias || "").trim()),
  );
  const profileTag = showProfileTag ? resolveDistinctProfileChipText(activeProfile, providerProfiles) : "";

  const modelSelect = $("modelSelect");
  const rawModel = modelSelect?.selectedOptions?.[0]?.textContent || modelSelect?.value || "";
  const modelShort = compactModelBadgeLabel(rawModel);
  const effortSelect = $("effortSelect");
  const effortShort = (!effortSelect || effortSelect.hidden)
    ? ""
    : compactEffortBadgeLabel(effortSelect.value || "");
  const goalActive = Boolean(state.composerGoal || state.activeThread?.goalState?.active);

  btn.className = `composer-config-chip mobile-only tone-${permMeta.tone}`;
  btn.title = `权限: ${permMeta.label}${activeProfile ? ` · 实例: ${profileOptionLabel(activeProfile)}` : ""} · 模型: ${rawModel || "默认"}${effortShort ? ` · 思考: ${effortShort}` : ""}${goalActive ? " · Goal 开启" : ""}`;

  const permIconEl = $("cfgChipPermIcon");
  if (permIconEl) permIconEl.innerHTML = permMeta.icon;
  const profTextEl = $("cfgChipProfileText");
  if (profTextEl) {
    profTextEl.textContent = profileTag;
    profTextEl.hidden = !profileTag;
    profTextEl.className = `cfg-chip-profile${profMeta ? ` ${profMeta.dotClass}` : ""}`;
  }
  const modelEl = $("cfgChipModelText");
  if (modelEl) modelEl.textContent = modelShort;
  const effortEl = $("cfgChipEffortText");
  if (effortEl) {
    effortEl.textContent = effortShort;
    effortEl.hidden = !effortShort;
  }
  const goalDotEl = $("cfgChipGoalDot");
  if (goalDotEl) goalDotEl.hidden = !goalActive;
}

function autoResizePromptInput() {
  const input = $("promptInput");
  if (!input) return;
  input.style.height = "auto";
  if (!input.value) {
    input.style.height = "";
    return;
  }
  const maxHeight = window.innerWidth <= 960 ? 116 : 180;
  const nextHeight = Math.min(maxHeight, Math.max(36, input.scrollHeight));
  input.style.height = `${nextHeight}px`;
}

function syncBoardAttentionDot() {
  syncScopedDocumentTitle();
  const dot = $("boardAttentionDot");
  if (!dot) return;
  const failedCount = (state.threads || []).filter((t) => isThreadFailed(t, state.recentCompletedByThread)).length;
  const hasPending = state.pendingRequests.length > 0;
  const hasOtherLive = state.threads.some(
    (t) => t.id !== state.activeThreadId && (t.live || t.turns?.[t.turns.length - 1]?.status === "inProgress"),
  );
  if (failedCount > 0) {
    dot.hidden = false;
    dot.className = "btn-attention-dot is-error";
    dot.title = hasPending
      ? `有 ${failedCount} 个任务报错中断，${state.pendingRequests.length} 项待确认`
      : `有 ${failedCount} 个任务报错中断`;
  } else if (hasPending) {
    dot.hidden = false;
    dot.className = "btn-attention-dot is-pending";
    dot.title = `有 ${state.pendingRequests.length} 项待确认请求`;
  } else if (hasOtherLive) {
    dot.hidden = false;
    dot.className = "btn-attention-dot is-live";
    dot.title = "有后台任务运行中";
  } else {
    dot.hidden = true;
    dot.className = "btn-attention-dot";
  }
}

function renderBatchActionBars() {
  const sidebarBar = $("sidebarBatchBar");
  const boardBar = $("boardBatchBar");
  const toggleBtn = $("sidebarBatchSelectBtn");
  if (toggleBtn) {
    toggleBtn.classList.toggle("is-active", Boolean(state.batchSelect.active));
    toggleBtn.textContent = state.batchSelect.active ? "退出" : "多选";
  }
  if (!state.batchSelect.active) {
    if (sidebarBar) {
      sidebarBar.hidden = true;
      sidebarBar.innerHTML = "";
    }
    if (boardBar) {
      boardBar.hidden = true;
      boardBar.innerHTML = "";
    }
    return;
  }
  const groups = getProjectGroups({ includeSearch: isBoardViewActive() });
  const visibleThreads = groups.flatMap((g) => g.threads || []);
  const idleVisibleCount = visibleThreads.filter((t) => !t.live && !(t.pendingCount > 0)).length;
  const barHtml = renderBatchActionBarHtml({
    selectedCount: state.batchSelect.selectedIds.size,
    totalVisibleCount: visibleThreads.length,
    idleVisibleCount,
    archivedView: Boolean(state.showArchived),
    submitting: Boolean(state.batchSelect.submitting),
  });
  if (sidebarBar) {
    sidebarBar.hidden = false;
    sidebarBar.innerHTML = barHtml;
  }
  const onBoard = isBoardViewActive();
  if (boardBar) {
    boardBar.hidden = !onBoard;
    boardBar.innerHTML = onBoard ? barHtml : "";
  }
}

function enterBatchSelectMode({ threadId = "", projectCwd = "" } = {}) {
  state.batchSelect.active = true;
  if (threadId) {
    state.batchSelect.selectedIds.add(threadId);
    state.batchSelect.lastTouchedThreadId = threadId;
  } else if (projectCwd) {
    const group = getProjectGroups().find((g) => g.cwd === projectCwd);
    for (const t of group?.threads || []) {
      if (t?.id) state.batchSelect.selectedIds.add(t.id);
    }
    state.batchSelect.lastTouchedThreadId = "";
  }
  renderThreadList();
  renderProjectBoard();
  renderBatchActionBars();
}

function exitBatchSelectMode() {
  if (!state.batchSelect.active && !state.batchSelect.selectedIds.size) return;
  state.batchSelect.active = false;
  state.batchSelect.submitting = false;
  state.batchSelect.selectedIds.clear();
  state.batchSelect.lastTouchedThreadId = "";
  renderThreadList();
  renderProjectBoard();
  renderBatchActionBars();
}

function toggleBatchThreadSelection(threadId, { shiftKey = false } = {}) {
  const cleanId = String(threadId || "").trim();
  if (!cleanId) return;
  if (shiftKey && state.batchSelect.lastTouchedThreadId) {
    const orderedIds = getProjectGroups().flatMap((g) => (g.threads || []).map((t) => t.id));
    const fromIdx = orderedIds.indexOf(state.batchSelect.lastTouchedThreadId);
    const toIdx = orderedIds.indexOf(cleanId);
    if (fromIdx >= 0 && toIdx >= 0) {
      const start = Math.min(fromIdx, toIdx);
      const end = Math.max(fromIdx, toIdx);
      for (let i = start; i <= end; i += 1) {
        if (orderedIds[i]) state.batchSelect.selectedIds.add(orderedIds[i]);
      }
      state.batchSelect.lastTouchedThreadId = cleanId;
      renderThreadList();
      renderProjectBoard();
      renderBatchActionBars();
      return;
    }
  }
  if (state.batchSelect.selectedIds.has(cleanId)) {
    state.batchSelect.selectedIds.delete(cleanId);
  } else {
    state.batchSelect.selectedIds.add(cleanId);
  }
  state.batchSelect.lastTouchedThreadId = cleanId;
  renderThreadList();
  renderProjectBoard();
  renderBatchActionBars();
}

function toggleBatchProjectSelection(cwd) {
  const group = getProjectGroups().find((g) => g.cwd === cwd);
  if (!group?.threads?.length) return;
  const selState = computeProjectGroupSelectionState(group, state.batchSelect.selectedIds);
  for (const t of group.threads) {
    if (!t?.id) continue;
    if (selState.checked) state.batchSelect.selectedIds.delete(t.id);
    else state.batchSelect.selectedIds.add(t.id);
  }
  state.batchSelect.lastTouchedThreadId = "";
  renderThreadList();
  renderProjectBoard();
  renderBatchActionBars();
}

function pruneBatchSelection() {
  if (!state.batchSelect.active || !state.batchSelect.selectedIds.size) return;
  const loadedIds = new Set((state.threads || []).map((t) => t.id).filter(Boolean));
  let changed = false;
  for (const id of [...state.batchSelect.selectedIds]) {
    if (!loadedIds.has(id)) {
      state.batchSelect.selectedIds.delete(id);
      changed = true;
    }
  }
  if (state.batchSelect.lastTouchedThreadId && !loadedIds.has(state.batchSelect.lastTouchedThreadId)) {
    state.batchSelect.lastTouchedThreadId = "";
  }
  if (changed) renderBatchActionBars();
}

async function executeBatchArchive() {
  if (state.batchSelect.submitting) return;
  const ids = [...state.batchSelect.selectedIds];
  if (!ids.length) return;
  const nextArchived = !state.showArchived;
  if (nextArchived) {
    const byId = new Map((state.threads || []).map((t) => [t.id, t]));
    const liveCount = ids.filter((id) => Boolean(byId.get(id)?.live)).length;
    if (liveCount > 0) {
      const ok = window.confirm(`所选 ${ids.length} 个会话中有 ${liveCount} 个正在运行，确定一并归档吗？`);
      if (!ok) return;
    }
  }
  state.batchSelect.submitting = true;
  renderBatchActionBars();
  try {
    await apiPostWithHotFallback("api/threads/archive", {
      threadIds: ids,
      archived: nextArchived,
    });
    if (nextArchived && !state.showArchived && ids.includes(state.activeThreadId)) {
      await selectThread("");
    }
    exitBatchSelectMode();
    await refreshThreads();
    showToastBanner(nextArchived ? `已归档 ${ids.length} 个会话` : `已恢复 ${ids.length} 个会话`);
  } catch (error) {
    state.batchSelect.submitting = false;
    renderBatchActionBars();
    const errMsg = formatActionError(error, nextArchived ? "批量归档失败" : "批量恢复失败");
    setComposerStatus("error", errMsg);
    showToastBanner("批量操作失败", { detail: errMsg, error: true });
  }
}

function handleBatchActionClick(action) {
  if (!action || state.batchSelect.submitting) return;
  if (action === "exit") {
    exitBatchSelectMode();
    return;
  }
  if (action === "clear-all") {
    state.batchSelect.selectedIds.clear();
    state.batchSelect.lastTouchedThreadId = "";
    renderThreadList();
    renderProjectBoard();
    renderBatchActionBars();
    return;
  }
  if (action === "select-all" || action === "select-idle") {
    const visibleThreads = getProjectGroups().flatMap((g) => g.threads || []);
    const targets = action === "select-idle"
      ? visibleThreads.filter((t) => !t.live && !(t.pendingCount > 0))
      : visibleThreads;
    for (const t of targets) {
      if (t?.id) state.batchSelect.selectedIds.add(t.id);
    }
    renderThreadList();
    renderProjectBoard();
    renderBatchActionBars();
    return;
  }
  if (action === "submit-archive") {
    void executeBatchArchive();
  }
}

function bindLongPressMultiSelect(containerEl, resolveTarget) {
  if (!containerEl) return;
  const LONG_PRESS_MS = 420;
  const MOVE_CANCEL_PX = 10;
  let timerId = null;
  let activePointerId = null;
  let startX = 0;
  let startY = 0;
  let suppressClickUntil = 0;

  const clearPending = () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
    activePointerId = null;
  };

  containerEl.addEventListener("pointerdown", (e) => {
    if (state.batchSelect.active) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest(
      "[data-new-in-cwd], [data-alias-cwd], [data-toggle-pin-cwd], [data-batch-fold-cwd], [data-sidebar-expand-cwd], [data-sidebar-collapse-cwd], [data-sidebar-stale-projects], [data-expand-project-cwd], [data-collapse-project-cwd], [data-board-action], input, select, textarea, a",
    )) {
      return;
    }
    const target = resolveTarget(e.target);
    if (!target) return;
    clearPending();
    activePointerId = e.pointerId;
    startX = Number(e.clientX) || 0;
    startY = Number(e.clientY) || 0;
    timerId = setTimeout(() => {
      timerId = null;
      activePointerId = null;
      suppressClickUntil = Date.now() + 850;
      try { navigator.vibrate?.(18); } catch {}
      enterBatchSelectMode(target);
    }, LONG_PRESS_MS);
  }, { passive: true });

  containerEl.addEventListener("pointermove", (e) => {
    if (!timerId || (activePointerId !== null && e.pointerId !== activePointerId)) return;
    const dx = Math.abs((Number(e.clientX) || 0) - startX);
    const dy = Math.abs((Number(e.clientY) || 0) - startY);
    if (dx > MOVE_CANCEL_PX || dy > MOVE_CANCEL_PX) {
      clearPending();
    }
  }, { passive: true });

  containerEl.addEventListener("pointerup", clearPending, { passive: true });
  containerEl.addEventListener("pointercancel", clearPending, { passive: true });
  containerEl.addEventListener("wheel", clearPending, { passive: true });
  containerEl.addEventListener("scroll", clearPending, { passive: true, capture: true });

  containerEl.addEventListener("click", (e) => {
    if (Date.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickUntil = 0;
    }
  }, true);

  containerEl.addEventListener("contextmenu", (e) => {
    if ((state.batchSelect.active || timerId || Date.now() < suppressClickUntil) && resolveTarget(e.target)) {
      e.preventDefault();
    }
  });
}

function toggleSidebarGroupCollapse(cwd) {
  if (!cwd) return;
  const nowMs = Date.now();
  pruneExpiredSidebarPrefs(nowMs);
  const group = getProjectGroups().find((g) => g.cwd === cwd);
  const currentlyCollapsed = group
    ? resolveProjectGroupCollapsed(group, {
      activeThreadId: state.activeThreadId,
      hasQuery: Boolean(String(state.searchText || "").trim()),
      collapsedGroups: state.collapsedGroups,
      sidebarFoldPrefs: state.sidebarFoldPrefs,
      nowMs,
      liveActivityByThread: state.liveActivityByThread,
    })
    : state.collapsedGroups.has(cwd);
  state.collapsedGroups.delete(cwd);
  setSidebarGroupManualPref(cwd, currentlyCollapsed ? "expand" : "collapse", nowMs);
  renderThreadList();
}

let activeThreadContextMenu = null;

function closeThreadContextMenu() {
  if (activeThreadContextMenu) {
    activeThreadContextMenu.remove();
    activeThreadContextMenu = null;
  }
}

function localFileManagerName() {
  const plat = `${navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || ""}`.toLowerCase();
  if (plat.includes("win")) return "资源管理器";
  if (plat.includes("linux") && !plat.includes("android")) return "文件管理器";
  return "访达";
}

function openLocalFileContextMenu(threadId, filePath, clientX = 0, clientY = 0, anchorEl = null) {
  closeThreadContextMenu();
  const cleanPath = String(filePath || "").trim();
  if (!cleanPath) return;
  const cleanThreadId = String(threadId || "").trim();
  const managerName = localFileManagerName();

  const menu = document.createElement("div");
  menu.className = "thread-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    ${cleanThreadId ? `<button type="button" class="thread-context-menu-item" data-file-menu-action="reveal">${iconSvg("folder", { size: 14 })}<span>在${escapeHtml(managerName)}中显示</span></button>` : ""}
    <button type="button" class="thread-context-menu-item" data-file-menu-action="copy">${iconSvg("clipboard", { size: 14 })}<span>拷贝文件路径</span></button>
  `;
  const mountParent = anchorEl?.closest?.("dialog[open]") || document.body;
  mountParent.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const maxX = Math.max(8, window.innerWidth - rect.width - 8);
  const maxY = Math.max(8, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.min(Math.max(8, clientX), maxX)}px`;
  menu.style.top = `${Math.min(Math.max(8, clientY), maxY)}px`;
  activeThreadContextMenu = menu;

  const cleanup = () => {
    document.removeEventListener("pointerdown", onDismiss, true);
    document.removeEventListener("keydown", onDismiss, true);
    window.removeEventListener("scroll", onDismiss, true);
  };
  const onDismiss = (ev) => {
    if (activeThreadContextMenu !== menu) {
      cleanup();
      return;
    }
    if (ev.type === "keydown" && ev.key !== "Escape") return;
    if (ev.type === "pointerdown" && menu.contains(ev.target)) return;
    if (ev.type === "keydown" && ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
    }
    closeThreadContextMenu();
    cleanup();
  };
  document.addEventListener("pointerdown", onDismiss, true);
  document.addEventListener("keydown", onDismiss, true);
  window.addEventListener("scroll", onDismiss, true);

  menu.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-file-menu-action]");
    if (!btn) return;
    const action = btn.dataset.fileMenuAction;
    closeThreadContextMenu();
    cleanup();
    if (action === "reveal" && cleanThreadId) {
      try {
        await apiPost("api/thread/reveal", { threadId: cleanThreadId, path: cleanPath });
      } catch (error) {
        showToastBanner(`打开${managerName}失败`, { detail: formatActionError(error, `无法在${managerName}中定位该文件`), error: true });
      }
    } else if (action === "copy") {
      const copied = await copyTextToClipboard(cleanPath);
      showToastBanner(copied ? "已复制文件路径" : "复制文件路径失败", {
        detail: cleanPath,
        error: !copied,
      });
    }
  });
}

async function forkThreadAction(threadId, { upToTurnIndex = null, upToTurnId = "" } = {}) {
  if (!threadId) return;
  try {
    setComposerStatus("pending", "正在分叉会话…");
    const res = await apiPost("api/thread/fork", {
      threadId,
      ...(Number.isInteger(upToTurnIndex) && upToTurnIndex >= 0 ? { upToTurnIndex } : {}),
      ...(upToTurnId ? { upToTurnId } : {}),
    });
    await refreshThreads();
    if (res?.thread?.id) {
      await selectThread(res.thread.id);
    }
    setComposerStatus("success", "已分叉为新会话", { autoClearMs: 2600 });
    showToastBanner("已创建分叉会话", {
      detail: Number.isInteger(upToTurnIndex) && upToTurnIndex >= 0
        ? "已保留至当前轮次，后续对话已舍弃"
        : (res?.thread?.title || res?.thread?.name || "新会话"),
    });
  } catch (error) {
    const errMsg = formatActionError(error, "分叉会话失败");
    setComposerStatus("error", `分叉失败：${errMsg}`);
    showToastBanner("分叉失败", { detail: errMsg, error: true });
  }
}

function selectedContinueProfile() {
  return state.profiles.find((profile) => `${profile.provider}:${profile.id}` === $("continueAgentSelect").value);
}

function syncContinueThreadEffort() {
  const profile = selectedContinueProfile();
  if (!profile) return;
  const models = resolveModelsForProvider(state.modelsByProvider, state.allModels, profile.provider);
  const model = models.find((item) => (item.id || item.model) === $("continueModelSelect").value);
  const efforts = (model?.supportedReasoningEfforts || []).map(normalizeEffortOptionValue).filter(Boolean);
  const select = $("continueEffortSelect");
  const labels = { low: "低思考", medium: "中思考", high: "高思考", xhigh: "超高思考", max: "最高思考" };
  select.innerHTML = efforts.length
    ? efforts.map((effort) => `<option value="${escapeHtml(effort)}">${escapeHtml(labels[effort] || effort)}</option>`).join("")
    : '<option value="">默认强度</option>';
  select.disabled = !efforts.length;
  const preferred = getNewThreadPrefs(profile.provider).effort;
  select.value = efforts.includes(preferred) ? preferred : (model?.defaultReasoningEffort || efforts[0] || "");
}

function syncContinueThreadModels(preferredModel = "") {
  const profile = selectedContinueProfile();
  if (!profile) return;
  const models = resolveModelsForProvider(state.modelsByProvider, state.allModels, profile.provider);
  const select = $("continueModelSelect");
  select.innerHTML = models.length ? renderModelOptionsHtml(models) : '<option value="">默认模型</option>';
  const selected = pickDefaultModelForProvider(models, profile.provider, preferredModel || getNewThreadPrefs(profile.provider).model);
  if (selected) select.value = selected.id || selected.model;
  syncContinueThreadEffort();
}

async function refreshContinueThreadModels() {
  const profile = selectedContinueProfile();
  const submit = $("continueThreadSubmitBtn");
  submit.disabled = !profile;
  if (!profile) return;
  syncContinueThreadModels();
  submit.disabled = true;
  await refreshModelsForProfile(profile.provider, profile.id);
  if ($("continueAgentSelect").value === `${profile.provider}:${profile.id}`) {
    syncContinueThreadModels($("continueModelSelect").value);
    submit.disabled = false;
  }
}

function openContinueThreadModal(threadId) {
  const thread = state.threads.find((item) => item.id === threadId);
  if (!thread) return;
  const modal = $("continueThreadModal");
  modal.dataset.threadId = threadId;
  $("continueThreadSource").textContent = `接续：${thread.title || thread.name || "原会话"}`;
  $("continueThreadError").hidden = true;
  const profiles = state.profiles.filter((profile) => profile.installed && !profile.health?.disabled);
  $("continueAgentSelect").innerHTML = profiles.length ? profiles.map((profile) =>
    `<option value="${escapeHtml(`${profile.provider}:${profile.id}`)}">${escapeHtml(`${providerDisplayName(profile.provider)} · ${profile.label || profile.id}`)}</option>`,
  ).join("") : '<option value="">暂无已安装的 Agent</option>';
  const preferred = profiles.find((profile) => profile.provider !== thread.provider) || profiles[0];
  if (preferred) $("continueAgentSelect").value = `${preferred.provider}:${preferred.id}`;
  $("continueModelSelect").innerHTML = '<option value="">默认模型</option>';
  $("continueEffortSelect").innerHTML = '<option value="">默认强度</option>';
  modal.showModal();
  void refreshContinueThreadModels();
}

function openThreadContextMenu(threadId, clientX = 0, clientY = 0) {
  closeThreadContextMenu();
  const thread = state.threads.find((t) => t.id === threadId);
  if (!thread) return;

  const menu = document.createElement("div");
  menu.className = "thread-context-menu";
  menu.setAttribute("role", "menu");
  menu.innerHTML = `
    <button type="button" class="thread-context-menu-item" data-menu-action="fork">${iconSvg("fork", { size: 14 })}<span>分叉会话</span></button>
    <button type="button" class="thread-context-menu-item" data-menu-action="continue-agent">${iconSvg("refresh", { size: 14 })}<span>换 Agent 继续</span></button>
    <button type="button" class="thread-context-menu-item" data-menu-action="rename">${iconSvg("edit", { size: 14 })}<span>重命名</span></button>
    <button type="button" class="thread-context-menu-item" data-menu-action="pin">${iconSvg("pin", { size: 14 })}<span>${thread.pinned ? "取消项目内置顶" : "在当前项目置顶"}</span></button>
    <button type="button" class="thread-context-menu-item" data-menu-action="archive">${iconSvg("archive", { size: 14 })}<span>${thread.archived ? "解除归档" : "归档会话"}</span></button>
  `;
  document.body.appendChild(menu);
  const rect = menu.getBoundingClientRect();
  const maxX = Math.max(8, window.innerWidth - rect.width - 8);
  const maxY = Math.max(8, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.min(Math.max(8, clientX), maxX)}px`;
  menu.style.top = `${Math.min(Math.max(8, clientY), maxY)}px`;
  activeThreadContextMenu = menu;

  const onDismiss = (ev) => {
    if (ev.type === "keydown" && ev.key !== "Escape") return;
    if (ev.type === "pointerdown" && menu.contains(ev.target)) return;
    closeThreadContextMenu();
    document.removeEventListener("pointerdown", onDismiss, true);
    document.removeEventListener("keydown", onDismiss, true);
    window.removeEventListener("scroll", onDismiss, true);
  };
  document.addEventListener("pointerdown", onDismiss, true);
  document.addEventListener("keydown", onDismiss, true);
  window.addEventListener("scroll", onDismiss, true);

  menu.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("[data-menu-action]");
    if (!btn) return;
    const action = btn.dataset.menuAction;
    closeThreadContextMenu();
    document.removeEventListener("pointerdown", onDismiss, true);
    document.removeEventListener("keydown", onDismiss, true);
    window.removeEventListener("scroll", onDismiss, true);

    if (action === "fork") {
      await forkThreadAction(threadId);
    } else if (action === "continue-agent") {
      openContinueThreadModal(threadId);
    } else if (action === "rename") {
      const next = prompt("输入新的会话标题：", thread.title || thread.name || "");
      if (!next || !next.trim()) return;
      try {
        await apiPost("api/thread/name", { threadId, name: next.trim() });
        await refreshThreads();
        if (state.activeThreadId === threadId) await selectThread(threadId, { focusScroll: false });
      } catch (error) {
        showToastBanner("重命名失败", { detail: formatActionError(error), error: true });
      }
    } else if (action === "pin") {
      try {
        await apiPost("api/thread/pin", { threadId, pinned: !thread.pinned });
        await refreshThreads();
      } catch (error) {
        showToastBanner("置顶设置失败", { detail: formatActionError(error), error: true });
      }
    } else if (action === "archive") {
      const nextArchived = !thread.archived;
      try {
        await apiPost("api/thread/archive", { threadId, archived: nextArchived });
        await refreshThreads();
        if (state.activeThreadId === threadId && nextArchived && !state.showArchived) {
          await selectThread("");
        }
      } catch (error) {
        showToastBanner("归档失败", { detail: formatActionError(error), error: true });
      }
    }
  });
}

let cliMaintenancePollTimer = 0;
const dismissedCliBannerProviders = new Set();

function renderCliMaintenanceBanner() {
  const el = $("cliMaintenanceBanner");
  if (!el) return;
  const items = Object.values(state.cliStatus || {}).filter(
    (item) => (
      item
      && !item.cliInstalled
      && !dismissedCliBannerProviders.has(item.provider)
      && ["installing", "missing_auto", "error", "missing_manual"].includes(item.status)
    ),
  );
  if (!items.length) {
    el.hidden = true;
    el.innerHTML = "";
    if (cliMaintenancePollTimer) {
      clearTimeout(cliMaintenancePollTimer);
      cliMaintenancePollTimer = 0;
    }
    return;
  }

  el.hidden = false;
  el.innerHTML = items.map((item) => {
    const isBusy = item.status === "installing" || item.status === "missing_auto";
    const isError = item.status === "error";
    const label = escapeHtml(item.label || item.provider);
    const statusText = isBusy
      ? `后台安装 ${label} 中…`
      : isError
        ? `${label} 安装失败`
        : `${label} 未安装`;
    const descText = !isBusy ? escapeHtml(item.lastError || item.manualHint || "") : "";
    const actionHtml = !isBusy && item.autoInstallable
      ? `<button type="button" class="cli-maintenance-retry" data-cli-retry="${escapeHtml(item.provider)}">重试</button>`
      : "";
    const dismissHtml = `<button type="button" class="cli-maintenance-dismiss" data-cli-dismiss="${escapeHtml(item.provider)}" title="隐藏提示" aria-label="隐藏提示">×</button>`;
    const progressHtml = isBusy ? `<div class="cli-maintenance-progress" aria-hidden="true"></div>` : "";
    return `<div class="cli-maintenance-item">
      <div class="cli-maintenance-row">
        <span class="cli-maintenance-title">${statusText}</span>
        <span class="cli-maintenance-actions">${actionHtml}${dismissHtml}</span>
      </div>
      ${progressHtml}
      ${descText ? `<div class="cli-maintenance-desc">${descText}</div>` : ""}
    </div>`;
  }).join("");

  const hasBusy = items.some((item) => item.status === "installing" || item.status === "missing_auto");
  if (hasBusy && !cliMaintenancePollTimer) {
    cliMaintenancePollTimer = setTimeout(async () => {
      cliMaintenancePollTimer = 0;
      try {
        const res = await apiGet("api/cli/status");
        if (res?.cliStatus) {
          state.cliStatus = res.cliStatus;
          renderCliMaintenanceBanner();
          const stillBusy = Object.values(state.cliStatus).some((i) => !i?.cliInstalled && (i?.status === "installing" || i?.status === "missing_auto"));
          if (!stillBusy) void refreshProviders();
        }
      } catch {}
    }, 2500);
  }
}

function renderThreadList() {
  const listEl = $("threadList");
  const warningsEl = $("threadWarnings");
  if (state.warnings.length) {
    warningsEl.hidden = false;
    warningsEl.textContent = state.warnings.map((w) => `${w.provider}/${w.profileId}: ${w.message}`).join("；");
  } else {
    warningsEl.hidden = true;
  }

  const nowMs = Date.now();
  pruneExpiredSidebarPrefs(nowMs);
  const sidebarSearch = String(state.sidebarSearchText || "");
  const activeRemote = isRemoteSearchAligned(state.sidebarRemoteSearch, sidebarSearch)
    ? state.sidebarRemoteSearch
    : null;
  const groups = getProjectGroups({ searchText: sidebarSearch, remoteSearch: activeRemote });
  const sidebarHtml = renderSidebarThreadListHtml(groups, {
    activeThreadId: state.activeThreadId,
    collapsedGroups: state.collapsedGroups,
    expandedSidebarGroups: state.expandedSidebarGroups,
    sidebarFoldPrefs: state.sidebarFoldPrefs,
    autoFoldProjects: !state.scopedProjectCwd,
    showStaleProjects: state.showStaleProjects || Boolean(state.scopedProjectCwd),
    nowMs,
    providerFilter: state.providerFilter,
    profileFilter: "all",
    profiles: state.profiles,
    liveActivityByThread: state.liveActivityByThread,
    recentCompletedByThread: state.recentCompletedByThread,
    searchText: sidebarSearch,
    searchLoading: Boolean(sidebarSearch.trim() && state.sidebarRemoteSearch?.loading),
    searchIndexStatus: sidebarSearch.trim() ? (state.sidebarRemoteSearch?.indexStatus || null) : null,
    selectionMode: state.batchSelect.active,
    selectedThreadIds: state.batchSelect.selectedIds,
    allowOpenProjectWindow: !state.scopedProjectCwd,
  });
  syncScopedDocumentTitle();
  replaceHtmlPreservingUiState(listEl, sidebarHtml);

  // Populate recent CWDs datalist for modal.
  const cwds = groups.map((g) => g.cwd).filter(Boolean).slice(0, 24);
  const cwdsHtml = cwds.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
  const datalistEl = $("recentCwdsList");
  if (datalistEl && datalistEl._acLastHtml !== cwdsHtml) {
    datalistEl._acLastHtml = cwdsHtml;
    datalistEl.innerHTML = cwdsHtml;
  }
  syncBoardAttentionDot();
  renderBatchActionBars();
}

let tycoon3dInstance = null;

function isOverviewBoardMode(mode = state.boardViewMode) {
  return mode === "tycoon3d" || mode === "overview";
}

function syncImmersiveDeckBodyClass() {
  if (typeof document === "undefined" || !document.body) return;
  const boardVisible = isBoardViewActive() && !state.scopedProjectCwd;
  const active = Boolean(
    boardVisible
    && isOverviewBoardMode()
    && state.immersiveOverview,
  );
  const is3d = Boolean(boardVisible && state.boardViewMode === "tycoon3d");
  document.body.classList.toggle("is-immersive-overview", active);
  document.body.classList.toggle("is-tycoon3d-active", is3d);
}

function buildDispatchAgentContext() {
  const profiles = (state.profiles || []).filter((p) => (
    p
    && p.provider
    && p.installed !== false
    && !p.health?.disabled
    && p.account?.signedIn !== false
  ));
  const describe = (p) => {
    const name = String(p.health?.alias || p.label || p.id || "").trim();
    const email = String(p.account?.email || "").trim();
    return email && !name.includes(email) ? `${name}（${email}）` : name;
  };
  const excludedAgentKeys = Array.isArray(state.missionOverview?.meta?.dispatchPrefs?.excludedAgentKeys)
    ? state.missionOverview.meta.dispatchPrefs.excludedAgentKeys
    : [];
  const excludedSet = new Set(excludedAgentKeys);
  const agentOptions = profiles.map((p) => {
    const key = `${p.provider}:${p.id || "default"}`;
    return {
      key,
      provider: p.provider,
      providerLabel: providerDisplayName(p.provider),
      label: describe(p),
      excluded: excludedSet.has(key),
    };
  });
  const byKey = new Map(agentOptions.map((o) => [o.key, o]));

  // Preview what "auto" will resolve to for the targeted production line (mirrors backend priority).
  let autoResolvedLabel = "";
  const topics = (state.missionOverview?.domains || []).flatMap((d) => d.topics || []);
  const tp = state.dispatchTopicId ? topics.find((t) => t.id === state.dispatchTopicId) : null;
  if (tp) {
    if (tp.agentPref && byKey.has(tp.agentPref) && !excludedSet.has(tp.agentPref)) {
      autoResolvedLabel = `${byKey.get(tp.agentPref).label}（上次所选）`;
    } else {
      const hitKey = (tp.agentAffinity || []).find((k) => byKey.has(k) && !excludedSet.has(k));
      autoResolvedLabel = hitKey ? `${byKey.get(hitKey).label}（项目历史）` : "全局默认账号";
    }
  }

  let modelOptions = [];
  const isAuto = !state.dispatchAgentKey || state.dispatchAgentKey === "auto";
  if (!isAuto) {
    const provider = state.dispatchAgentKey.split(":")[0];
    modelOptions = resolveModelsForProvider(state.modelsByProvider, state.allModels, provider)
      .map((m) => ({ id: m.id || m.model, label: m.displayName || m.model || m.id }))
      .filter((m) => m.id);
  }

  return {
    agentOptions,
    dispatchAgentKey: isAuto ? "auto" : state.dispatchAgentKey,
    autoResolvedLabel,
    modelOptions,
    dispatchModel: isAuto ? "" : state.dispatchModel,
  };
}

function ensureTycoon3DMounted(boardEl) {
  let viewportEl = $("tycoon3dViewport");
  let hudEl = $("tycoonHudLayer");
  let spriteMountEl = $("spriteAssistantMount");
  if (!viewportEl || !hudEl || !boardEl.contains(viewportEl)) {
    tycoon3dInstance?.dispose?.();
    tycoon3dInstance = null;
    boardEl._acLastHtml = "";
    boardEl.innerHTML = `
      <div id="tycoon3dViewport" class="tycoon3d-viewport"></div>
      <div id="tycoonHudLayer" class="tycoon-hud-layer"></div>
      <div id="spriteAssistantMount" class="sprite-assistant-mount is-3d"></div>
    `;
    viewportEl = $("tycoon3dViewport");
    hudEl = $("tycoonHudLayer");
    spriteMountEl = $("spriteAssistantMount");
    tycoon3dInstance = createTycoon3DWorld(viewportEl, {
      onSelectTopic: (topicId) => {
        state.sprite.scopedTopicId = topicId;
        state.sprite.scopedTopicName = findOverviewTopicById(topicId)?.name || topicId;
        state.tycoonSelectedTopicId = topicId;
        state.tycoonInspectorMode = "topic";
        state.tycoonInspectorRoomId = "";
        state.tycoonInspectorClusterOnly = false;
        state.tycoonInspectorBack = null;
        renderProjectBoard();
      },
      onSelectCluster: (roomId) => {
        const nextRoom = roomId || "all";
        state.overviewDomainFilter = nextRoom;
        state.tycoonInspectorMode = "cluster";
        state.tycoonInspectorRoomId = nextRoom;
        state.tycoonInspectorClusterOnly = true;
        state.tycoonSelectedTopicId = "";
        state.tycoonInspectorBack = null;
        renderProjectBoard();
      },
      onSelectRoom: (roomId) => {
        const nextRoom = roomId || "all";
        state.overviewDomainFilter = nextRoom;
        state.tycoonSelectedTopicId = "";
        state.tycoonInspectorClusterOnly = false;
        state.tycoonInspectorBack = null;
        if (nextRoom === "all") {
          state.tycoonInspectorMode = "";
          state.tycoonInspectorRoomId = "";
        } else {
          state.tycoonInspectorMode = "room";
          state.tycoonInspectorRoomId = nextRoom;
        }
        renderProjectBoard();
      },
      onSelectIncubator: () => {
        state.tycoonInspectorMode = "incubator";
        state.tycoonInspectorRoomId = "";
        state.tycoonInspectorClusterOnly = false;
        state.tycoonInspectorBack = null;
        state.tycoonSelectedTopicId = "";
        renderProjectBoard();
      },
      onSignalBadgeClick: (topicId, type) => openSpriteCards(topicId, type),
      onSpriteBubbleClick: (topicId) => openSpriteCards(topicId),
      onSelectSprite: () => {
        toggleSpriteAssistant({ open: true });
      },
      onClearSelection: () => {
        if (state.tycoonInspectorMode || state.tycoonSelectedTopicId) {
          state.tycoonInspectorMode = "";
          state.tycoonInspectorRoomId = "";
          state.tycoonInspectorClusterOnly = false;
          state.tycoonInspectorBack = null;
          state.tycoonSelectedTopicId = "";
          renderProjectBoard();
        }
      },
    });
  } else if (!spriteMountEl || !boardEl.contains(spriteMountEl)) {
    spriteMountEl = document.createElement("div");
    spriteMountEl.id = "spriteAssistantMount";
    spriteMountEl.className = "sprite-assistant-mount is-3d";
    boardEl.appendChild(spriteMountEl);
  }
  return { viewportEl, hudEl, spriteMountEl };
}

function ensureOverview2DMounted(boardEl) {
  let deckMountEl = $("moDeckMount");
  if (!deckMountEl || !boardEl.contains(deckMountEl)) {
    boardEl._acLastHtml = "";
    boardEl.innerHTML = `<div id="moDeckMount" class="mo-deck-mount"></div>`;
    deckMountEl = $("moDeckMount");
  }
  return { deckMountEl };
}

function renderProjectBoard() {
  const boardEl = $("projectBoard");
  if (!boardEl) return;
  const shouldShowBoard = isBoardViewActive();
  syncImmersiveDeckBodyClass();
  if (!shouldShowBoard || state.boardViewMode !== "tycoon3d" || state.scopedProjectCwd) noteSpriteParkLeave();
  if (!shouldShowBoard) {
    tycoon3dInstance?.pause?.();
    if (state.sprite.recording || state.sprite.handsFree) {
      void stopSpriteMic({ submit: false, stopHandsFree: true });
    }
    stopSpriteSpeech();
    boardEl.hidden = true;
    renderBatchActionBars();
    return;
  }

  const preserveIds = new Set(["boardSearchInput", "moDispatchInput", "moSparkInput"]);
  const activeInputId = preserveIds.has(document.activeElement?.id) ? document.activeElement.id : "";
  const activeInputEl = activeInputId ? document.activeElement : null;
  const selStart = activeInputEl ? activeInputEl.selectionStart : null;
  const selEnd = activeInputEl ? activeInputEl.selectionEnd : null;
  const savedSparkVal = $("moSparkInput")?.value || "";

  const boardSearch = String(state.searchText || "");
  const activeBoardRemote = isRemoteSearchAligned(state.boardRemoteSearch, boardSearch)
    ? state.boardRemoteSearch
    : null;
  const groups = getProjectGroups({ remoteSearch: activeBoardRemote });
  const allGroups = getProjectGroups({ ignoreFilters: true });
  boardEl.hidden = false;

  if (state.boardViewMode === "tycoon3d" && !state.scopedProjectCwd) {
    if (!state.missionOverview && !state.missionOverviewLoading) {
      void loadMissionOverview({ trigger: "open" });
    }
    const { hudEl } = ensureTycoon3DMounted(boardEl);
    const spriteFsActive = state.sprite.viewMode === "fullscreen" || state.sprite.viewMode === "phone";
    if (!spriteFsActive) tycoon3dInstance?.resume?.();
    tycoon3dInstance?.sync?.(state.missionOverview, {
      searchText: state.searchText,
      selectedTopicId: state.tycoonSelectedTopicId,
      domainFilter: state.overviewDomainFilter,
      selectedClusterRoomId: (state.tycoonInspectorMode === "cluster" || state.tycoonInspectorMode === "room")
        ? state.tycoonInspectorRoomId
        : "",
    });
    if (hudEl) {
      const nextHudHtml = renderTycoonHudHtml(state.missionOverview, {
        activeThreadId: state.activeThreadId,
        searchText: state.searchText,
        loading: state.missionOverviewLoading,
        expandedTopics: state.expandedOverviewTopics,
        expandedArchives: state.expandedOverviewArchives,
        expandedContexts: state.expandedOverviewContexts,
        assignOpenThreadId: state.overviewAssignThreadId,
        editingMetricsTopicId: state.editingMetricsTopicId,
        editingContextTopicId: state.editingContextTopicId,
        expandedMetricsTopics: state.expandedOverviewMetrics,
        allowResume: Boolean(state.activeThread),
        domainFilter: state.overviewDomainFilter,
        immersive: state.immersiveOverview,
        selectedTopicId: state.tycoonSelectedTopicId,
        inspectorMode: state.tycoonInspectorMode,
        inspectorRoomId: state.tycoonInspectorRoomId,
        inspectorClusterOnly: state.tycoonInspectorClusterOnly,
        inspectorBack: state.tycoonInspectorBack,
        selectedSubProjectByTopic: state.selectedSubProjectByTopic,
        syncingProjects: state.overviewSyncingProjects,
        questCollapsed: state.tycoonQuestCollapsed,
        dispatchConfigOpen: state.tycoonDispatchConfigOpen,
        mobileDockOpen: state.tycoonMobileDockOpen,
        showChilledSparks: state.overviewShowChilled,
        dispatchDraft: state.dispatchDraft,
        dispatchTopicId: state.dispatchTopicId,
        dispatchMode: state.dispatchMode,
        dispatchInheritContext: state.dispatchInheritContext,
        dispatchBusy: state.dispatchBusy,
        dispatchPreview: state.dispatchPreview,
        lastDispatchReceipt: state.lastDispatchReceipt,
        dispatchAgent: buildDispatchAgentContext(),
        recentCompletedByThread: state.recentCompletedByThread,
      });
      replaceHtmlPreservingUiState(hudEl, nextHudHtml);
    }
    if (savedSparkVal && $("moSparkInput")) {
      $("moSparkInput").value = savedSparkVal;
    }
    syncSpriteWithOverview(state.missionOverview);
    void maybeStartSpriteTour();
    renderSpriteAssistantMount();
  } else if (state.boardViewMode === "overview" && !state.scopedProjectCwd) {
    if (tycoon3dInstance) {
      tycoon3dInstance.dispose();
      tycoon3dInstance = null;
    }
    if (state.sprite.recording || state.sprite.handsFree) {
      void stopSpriteMic({ submit: false, stopHandsFree: true });
    }
    stopSpriteSpeech();
    if (!state.missionOverview && !state.missionOverviewLoading) {
      void loadMissionOverview({ trigger: "open" });
    }
    const boardSnap = captureSubtreeUiState(boardEl);
    const { deckMountEl } = ensureOverview2DMounted(boardEl);
    const nextOverviewHtml = renderMissionOverviewHtml(state.missionOverview, {
      activeThreadId: state.activeThreadId,
      searchText: state.searchText,
      loading: state.missionOverviewLoading,
      expandedTopics: state.expandedOverviewTopics,
      expandedArchives: state.expandedOverviewArchives,
      expandedContexts: state.expandedOverviewContexts,
      assignOpenThreadId: state.overviewAssignThreadId,
      editingMetricsTopicId: state.editingMetricsTopicId,
      editingContextTopicId: state.editingContextTopicId,
      expandedMetricsTopics: state.expandedOverviewMetrics,
      selectedSubProjectByTopic: state.selectedSubProjectByTopic,
      syncingProjects: state.overviewSyncingProjects,
      allowResume: Boolean(state.activeThread),
      domainFilter: state.overviewDomainFilter,
      immersive: state.immersiveOverview,
      showChilledSparks: state.overviewShowChilled,
      dispatchDraft: state.dispatchDraft,
      dispatchTopicId: state.dispatchTopicId,
      dispatchMode: state.dispatchMode,
      dispatchInheritContext: state.dispatchInheritContext,
      dispatchBusy: state.dispatchBusy,
      dispatchPreview: state.dispatchPreview,
      lastDispatchReceipt: state.lastDispatchReceipt,
      dispatchAgent: buildDispatchAgentContext(),
      recentCompletedByThread: state.recentCompletedByThread,
    });
    replaceHtmlPreservingUiState(deckMountEl, nextOverviewHtml);
    if (boardSnap?.rootTop > 0) boardEl.scrollTop = boardSnap.rootTop;
    if (savedSparkVal && $("moSparkInput")) {
      $("moSparkInput").value = savedSparkVal;
    }
  } else {
    if (tycoon3dInstance) {
      tycoon3dInstance.dispose();
      tycoon3dInstance = null;
    }
    if (state.sprite.recording || state.sprite.handsFree) {
      void stopSpriteMic({ submit: false, stopHandsFree: true });
    }
    stopSpriteSpeech();
    const nextBoardHtml = renderProjectBoardHtml({
      groups,
      allGroups,
      pendingRequests: state.pendingRequests,
      showAllProjects: state.showAllProjects,
      expandedProjects: state.expandedProjects,
      activeThreadId: state.activeThreadId,
      searchText: state.searchText,
      searchLoading: Boolean(boardSearch.trim() && state.boardRemoteSearch?.loading),
      searchIndexStatus: boardSearch.trim() ? (state.boardRemoteSearch?.indexStatus || null) : null,
      selectionMode: state.batchSelect.active,
      selectedThreadIds: state.batchSelect.selectedIds,
      profiles: state.profiles,
      recentCompletedByThread: state.recentCompletedByThread,
      allowOpenProjectWindow: !state.scopedProjectCwd,
    });
    replaceHtmlPreservingUiState(boardEl, nextBoardHtml);
  }

  if (activeInputId) {
    const nextInput = $(activeInputId);
    if (nextInput) {
      nextInput.focus({ preventScroll: true });
      if (typeof selStart === "number" && typeof selEnd === "number") {
        try {
          nextInput.setSelectionRange(selStart, selEnd);
        } catch {}
      }
    }
  }
  renderBatchActionBars();
}

function activeThreadTask() {
  if (!state.activeThreadId) return null;
  const metaTaskId = state.activeThread?.taskId || state.threads.find((t) => t.id === state.activeThreadId)?.taskId || "";
  if (metaTaskId) {
    const byId = state.tasks.find((tk) => tk.id === metaTaskId);
    if (byId) return byId;
  }
  return findTaskForThread(state.tasks, state.activeThreadId, { includeClosed: false })
    || findTaskForThread(state.tasks, state.activeThreadId, { includeClosed: true });
}

function updateTasksBadges() {
  const openCount = (state.tasks || []).filter((tk) => tk.status === "open").length;
  for (const el of [$("tasksCountBadge"), $("topbarMenuTasksBadge")]) {
    if (!el) continue;
    el.hidden = openCount <= 0;
    el.textContent = openCount > 99 ? "99+" : String(openCount);
  }
}

async function refreshTasks() {
  try {
    const res = await apiGet("api/tasks?status=all", { useEtagCache: false });
    if (Array.isArray(res?.tasks)) {
      state.tasks = res.tasks;
      state.tasksLoaded = true;
      updateTasksBadges();
      renderProjectTaskStrip();
      renderTopbarAndControls();
      if ($("tasksModal")?.open) renderTasksModal();
    }
  } catch {
    // Keep existing cached task list on transient network errors.
  }
}

async function loadTaskDetailLogs(taskId) {
  if (!taskId) {
    state.tasksDetailLogs = [];
    return;
  }
  try {
    const res = await apiGet(`api/tasks/${encodeURIComponent(taskId)}?limit=40`, { useEtagCache: false });
    state.tasksDetailLogs = Array.isArray(res?.logs) ? res.logs : [];
    if ($("tasksModal")?.open && state.tasksSelectedId === taskId) {
      renderTasksModal();
    }
  } catch {
    state.tasksDetailLogs = [];
  }
}

function renderTasksModal() {
  const body = $("tasksModalBody");
  if (!body) return;
  const modal = $("tasksModal");
  if (modal) {
    for (const btn of modal.querySelectorAll("[data-tasks-status]")) {
      btn.classList.toggle("is-active", btn.dataset.tasksStatus === state.tasksModalStatus);
    }
  }
  const threadsById = new Map((state.threads || []).map((t) => [t.id, t]));
  if (state.activeThread?.id) threadsById.set(state.activeThread.id, state.activeThread);
  body.innerHTML = renderTaskTreeModalHtml({
    tasks: state.tasks || [],
    selectedTaskId: state.tasksSelectedId,
    detailLogs: state.tasksDetailLogs || [],
    threadsById,
    statusFilter: state.tasksModalStatus || "open",
    query: state.tasksModalQuery || "",
    collapsedIds: state.tasksCollapsedIds,
    bindPickerTaskId: state.tasksBindPickerId || "",
  });
}

async function openTasksModal(selectedTaskId = "") {
  setTopbarMenuOpen(false);
  setComposerConfigOpen(false);
  const modal = $("tasksModal");
  if (!modal) return;
  if (selectedTaskId) state.tasksSelectedId = selectedTaskId;
  else if (!state.tasksSelectedId) {
    const currentTask = activeThreadTask();
    if (currentTask) state.tasksSelectedId = currentTask.id;
  }
  if (!state.tasksLoaded) await refreshTasks();
  if (!state.tasksSelectedId && state.tasks.length) {
    state.tasksSelectedId = state.tasks.find((t) => t.status === "open")?.id || state.tasks[0].id;
  }
  renderTasksModal();
  if (!modal.open) modal.showModal();
  if (state.tasksSelectedId) {
    void loadTaskDetailLogs(state.tasksSelectedId);
  }
}

async function startLinkedThreadDraft({
  mode = "same",
  taskId = "",
  parentTaskId = "",
  sourceThreadId = "",
  cwd = "",
  taskTitle = "",
} = {}) {
  if ($("tasksModal")?.open) $("tasksModal").close();
  const effectiveSource = sourceThreadId || state.activeThreadId || "";
  const sourceThread = state.threads.find((t) => t.id === effectiveSource) || state.activeThread || null;
  const resolvedCwd = cwd || sourceThread?.cwd || state.newThreadCwd || "";
  const existingTask = taskId
    ? state.tasks.find((t) => t.id === taskId)
    : (parentTaskId ? state.tasks.find((t) => t.id === parentTaskId) : activeThreadTask());
  state.newThreadTaskDraft = {
    mode,
    taskId: mode === "same" ? (taskId || existingTask?.id || "") : "",
    parentTaskId: mode === "child" ? (parentTaskId || existingTask?.id || "") : "",
    sourceThreadId: effectiveSource,
    taskTitle: taskTitle || (mode === "same" ? (existingTask?.title || sourceThread?.title || "") : ""),
    parentTitle: mode === "child" ? (existingTask?.title || sourceThread?.title || "") : "",
    cwd: resolvedCwd,
  };
  await openNewThreadModal({
    cwd: resolvedCwd,
    provider: sourceThread?.provider || defaultNewThreadProvider(),
    preserveTaskDraft: true,
  });
}

async function jumpToTaskPlan(taskId) {
  const task = (state.tasks || []).find((t) => t.id === taskId);
  if (!task) return;
  const targetThreadId = task.planRef?.threadId || task.threadIds?.[0] || "";
  if (!targetThreadId) {
    showToastBanner("该任务暂无可跳转的会话");
    return;
  }
  if ($("tasksModal")?.open) $("tasksModal").close();
  await selectThread(targetThreadId, {
    focusScroll: false,
    scrollToTurnId: task.planRef?.turnId || "",
    scrollToTurnIndex: Number.isInteger(task.planRef?.turnIndex) ? task.planRef.turnIndex : -1,
  });
}

async function pinTurnAsPlanAction({ threadId, turnId = "", turnIndex = -1, excerpt = "" } = {}) {
  if (!threadId) return;
  try {
    const cleanExcerpt = String(excerpt || "").replace(/\s+/g, " ").trim().slice(0, 140);
    const res = await apiPost("api/thread/pin-plan", {
      threadId,
      turnId,
      turnIndex,
      excerpt: cleanExcerpt,
    });
    if (res?.task) {
      await refreshTasks();
      showToastBanner(`已将此回复设为「${res.task.title}」规划锚点`);
    }
  } catch (error) {
    showToastBanner("设置规划锚点失败", { detail: formatActionError(error), error: true });
  }
}

function renderProjectTaskStrip() {
  const stripEl = $("projectTaskStrip");
  if (!stripEl) return;
  if (isBoardViewActive()) {
    stripEl.hidden = true;
    stripEl.innerHTML = "";
    return;
  }
  const draft = state.newThreadTaskDraft;
  const task = draft ? (state.tasks.find((t) => t.id === (draft.taskId || draft.parentTaskId)) || null) : activeThreadTask();
  if (!shouldShowTaskStrip({ task, draftContext: draft })) {
    stripEl.hidden = true;
    stripEl.classList.remove("is-single-task");
    stripEl.innerHTML = "";
    return;
  }

  const threadsById = new Map((state.threads || []).map((t) => [t.id, t]));
  if (state.activeThread?.id) threadsById.set(state.activeThread.id, state.activeThread);
  const ancestors = task ? getTaskAncestors(state.tasks || [], task.id) : [];
  const children = task ? (state.tasks || []).filter((t) => t.parentId === task.id) : [];

  const siblingIds = new Set(task?.threadIds || []);
  if (draft?.sourceThreadId) siblingIds.add(draft.sourceThreadId);
  const siblingThreads = [...siblingIds].map((id) => threadsById.get(id) || { id, title: id, missing: true });

  let liveCwdWarning = "";
  if (draft) {
    const draftCwd = normalizeProjectCwd(draft.cwd || state.newThreadCwd || "");
    const liveSibling = siblingThreads.find((th) => (
      th && !th.missing && th.live && draftCwd && normalizeProjectCwd(th.cwd || "") === draftCwd
    ));
    if (liveSibling) {
      liveCwdWarning = `兄弟会话「${liveSibling.title || liveSibling.id}」正在同目录运行`;
    }
  }

  stripEl.hidden = false;
  stripEl.classList.add("is-single-task");
  stripEl.innerHTML = renderTaskStripHtml({
    task,
    ancestors,
    children,
    siblingThreads,
    activeThreadId: state.activeThreadId || "",
    draftContext: draft,
    liveCwdWarning,
  });
}

function renderActiveHeading(title, cwd, { editableCwd = false } = {}) {
  const titleEl = $("activeTitle");
  titleEl.textContent = title;
  titleEl.title = title;
  const cwdEl = $("activeCwd");
  const cwdBtn = $("newThreadCwdBtn");
  const cwdTextEl = $("newThreadCwdText");
  const rawCwd = String(cwd || "");
  const splitAt = Math.max(rawCwd.lastIndexOf("/"), rawCwd.lastIndexOf("\\"));
  const cwdHtml = splitAt >= 0 && splitAt < rawCwd.length - 1
    ? `<span class="active-cwd-prefix">${escapeHtml(rawCwd.slice(0, splitAt + 1))}</span><span class="active-cwd-leaf">${escapeHtml(rawCwd.slice(splitAt + 1))}</span>`
    : escapeHtml(rawCwd);

  if (cwdEl) {
    cwdEl.hidden = Boolean(editableCwd);
    cwdEl.title = rawCwd;
    cwdEl.setAttribute("aria-label", rawCwd);
    cwdEl.innerHTML = cwdHtml;
  }
  if (cwdBtn) {
    cwdBtn.hidden = !editableCwd;
    if (editableCwd) {
      const displayLabel = rawCwd || "选择工作目录（默认主目录）";
      cwdBtn.classList.toggle("is-empty", !rawCwd);
      cwdBtn.title = rawCwd ? `${rawCwd}（点击切换工作目录）` : "点击选择或切换新会话的工作目录";
      cwdBtn.setAttribute("aria-label", displayLabel);
      if (cwdTextEl) {
        if (rawCwd) {
          const parts = typeof formatCwdParts === "function" ? formatCwdParts(rawCwd) : { prefix: "", leaf: rawCwd };
          const innerHtml = parts.prefix
            ? `<span class="active-cwd-prefix">${escapeHtml(parts.prefix)}</span><span class="active-cwd-leaf">${escapeHtml(parts.leaf)}</span>`
            : escapeHtml(parts.leaf || rawCwd);
          cwdTextEl.innerHTML = `<code class="new-thread-cwd-code">${innerHtml}</code>`;
        } else {
          cwdTextEl.textContent = "选择工作目录（默认主目录）";
        }
      }
    } else if (state.newThreadCwdPickerOpen && typeof closeNewThreadCwdPicker === "function") {
      closeNewThreadCwdPicker();
    }
  }
}

function renderTopbarAndControls() {
  const thread = state.activeThread || (state.initialThreadLoading && state.activeThreadId
    ? (state.threads.find((t) => t.id === state.activeThreadId) || null)
    : null);
  const topbar = $("topbar");
  const provBadge = $("activeProviderBadge");
  const profBadge = $("activeProfileBadge");
  const projectCrumb = $("activeProjectCrumb");
  const goalBadge = $("activeGoalBadge");
  const goalBtn = $("goalToggleBtn");
  const interruptBtn = $("interruptBtn");
  const renameBtn = $("renameThreadBtn");
  const toggleImgBtn = $("toggleThreadImagesBtn");
  const archiveBtn = $("archiveThreadBtn");
  const boardBtn = $("boardToggleBtn");
  const moreDot = $("topbarMoreDot");
  const moreProjCard = $("topbarMoreProjectCard");

  boardBtn?.setAttribute("aria-pressed", isBoardViewActive() ? "true" : "false");

  if (!thread) {
    topbar?.classList.remove("is-running");
    provBadge.hidden = true;
    profBadge.hidden = true;
    if (projectCrumb) projectCrumb.hidden = true;
    goalBadge.hidden = true;
    goalBtn.hidden = true;
    interruptBtn.hidden = true;
    renameBtn.hidden = true;
  if ($("pinTicketBtn")) $("pinTicketBtn").hidden = true;
  if ($("newSiblingThreadBtn")) $("newSiblingThreadBtn").hidden = true;
  if ($("newChildTaskThreadBtn")) $("newChildTaskThreadBtn").hidden = true;
  if ($("linkExistingTaskBtn")) $("linkExistingTaskBtn").hidden = true;
    if (toggleImgBtn) toggleImgBtn.hidden = true;
    archiveBtn.hidden = true;
    if (moreDot) moreDot.hidden = !state.updateStatus?.hasUpdate;
    if (moreProjCard) moreProjCard.hidden = true;
    const isNewDraft = state.newThreadCwd !== null && !state.boardOpen;
    topbar?.classList.toggle("is-new-thread-draft", isNewDraft);
    renderActiveHeading(
      isNewDraft ? "新会话" : "项目与多任务总控",
      isNewDraft ? state.newThreadCwd : "选择关注项目或点击语音说话直达对话",
      { editableCwd: isNewDraft },
    );
    syncBoardAttentionDot();
    syncWorkspaceVisibility();
    renderLiveBanner();
    renderCodexCompatBanner();
    renderProjectTaskStrip();
    renderComposerControls();
    return;
  }

  const running = isActiveThreadRunning();
  topbar?.classList.toggle("is-running", running);
  topbar?.classList.remove("is-new-thread-draft");

  const meta = providerVisualMeta(thread.provider);
  const activeProfile = state.profiles.find((p) => p.provider === thread.provider && p.id === thread.profileId) || null;
  const scopedProfiles = filterProfilesByProvider(state.profiles, thread.provider).filter((p) => p?.installed !== false);
  const profVisual = activeProfile ? profileHealthVisualMeta(activeProfile) : null;
  const profileLabel = activeProfile
    ? profileOptionLabel(activeProfile)
    : compactProfileDisplayLabel(thread.profileLabel || thread.profileId || "", thread.provider);
  const compactProfileText = activeProfile
    ? resolveDistinctProfileChipText(activeProfile, scopedProfiles)
    : abbreviateMiddleText(
        String(thread.profileLabel || thread.profileId || "")
          .replace(/^(Antigravity|Codex|Claude\s*Code|Claude|Grok)\s*[·:/\-]?\s*/i, "")
          .trim(),
        { head: 3, tail: 3, maxLen: 8 },
      );
  provBadge.hidden = false;
  provBadge.className = `provider-badge is-${thread.provider}`;
  provBadge.innerHTML = `<span class="provider-glyph" aria-hidden="true">${providerIconSvg(thread.provider, { size: 12 })}</span><span class="provider-text">${escapeHtml(meta.short)}</span>`;
  provBadge.title = `${meta.label}${profileLabel ? ` · ${profileLabel}` : ""}`;

  const hasProfAlert = Boolean(profVisual && profVisual.status !== "unknown" && profVisual.status !== "healthy");
  const hasProfAlias = Boolean(String(activeProfile?.health?.alias || "").trim());
  const hideRedundantProfBadge = scopedProfiles.length <= 1 && !hasProfAlert && !hasProfAlias;
  if (hideRedundantProfBadge || !compactProfileText) {
    profBadge.hidden = true;
    profBadge.textContent = "";
    profBadge.className = "profile-badge";
  } else {
    profBadge.hidden = false;
    profBadge.textContent = compactProfileText;
    profBadge.className = `profile-badge${profVisual ? ` ${profVisual.dotClass}` : ""}`;
    profBadge.title = `当前实例：${profileLabel}（点击查看全部实例健康状态、手动测通或同目录接力）`;
  }

  const cwdKey = normalizeProjectCwd(thread.cwd);
  const projMeta = state.projectsMeta[cwdKey] || {};
  const isPinned = Boolean(projMeta.pinned);
  if (projectCrumb) {
    projectCrumb.hidden = true;
    projectCrumb.setAttribute("aria-hidden", "true");
    projectCrumb.textContent = "";
    projectCrumb.classList.remove("is-pinned");
  }

  renderActiveHeading(thread.title || "新会话", thread.cwd || "", { editableCwd: false });

  const goalActive = Boolean(thread.goalState?.active);
  goalBadge.hidden = !goalActive;
  goalBadge.classList.remove("is-active", "is-done");
  if (goalActive) {
    const turnCount = thread.goalState?.turnCount || 1;
    const maxTurns = thread.goalState?.maxTurns || 20;
    goalBadge.innerHTML = `${iconSvg("target", { size: 11 })}<span>${turnCount}/${maxTurns}</span>`;
    goalBadge.classList.add("is-active");
    goalBadge.title = `Goal 自动推进中 (${turnCount}/${maxTurns})，点击可切换`;
  } else if (thread.goalState?.status === "completed") {
    goalBadge.hidden = false;
    goalBadge.innerHTML = `${iconSvg("target", { size: 11 })}${iconSvg("check", { size: 11 })}`;
    goalBadge.classList.add("is-done");
    goalBadge.title = "Goal 已达成";
  }

  if (moreDot) moreDot.hidden = !(goalActive || state.updateStatus?.hasUpdate);

  if (moreProjCard) {
    moreProjCard.hidden = !thread.cwd;
    const pinBtn = $("topbarPinProjectBtn");
    if (pinBtn) {
      pinBtn.innerHTML = `${isPinned ? iconSvg("star-filled", { size: 12 }) : iconSvg("star", { size: 12 })}<span>${isPinned ? "已关注" : "关注项目"}</span>`;
      pinBtn.classList.toggle("is-pinned", isPinned);
    }
    const cwdEl = $("topbarMoreCwd");
    if (cwdEl) cwdEl.textContent = thread.cwd || "";
  }

  goalBtn.hidden = false;
  goalBtn.textContent = goalActive ? "关闭 Goal" : "开启 Goal";

  interruptBtn.hidden = !running;
  renameBtn.hidden = false;
  const pinTicketBtn = $("pinTicketBtn");
  const currentTask = activeThreadTask();
  if (pinTicketBtn) {
    const pinned = Boolean(currentTask) || (state.missionOverview?.assistantTickets || []).some((tk) => tk.threadIds?.includes(thread.id));
    pinTicketBtn.hidden = Boolean(thread.internal);
    pinTicketBtn.textContent = pinned ? "已是任务" : "钉成任务";
    pinTicketBtn.disabled = pinned;
  }
  if ($("newSiblingThreadBtn")) $("newSiblingThreadBtn").hidden = Boolean(thread.internal);
  if ($("newChildTaskThreadBtn")) $("newChildTaskThreadBtn").hidden = Boolean(thread.internal);
  if ($("linkExistingTaskBtn")) $("linkExistingTaskBtn").hidden = Boolean(thread.internal);
  if (toggleImgBtn) {
    toggleImgBtn.hidden = false;
    toggleImgBtn.textContent = isThreadImagesUnlocked(thread.id) ? "收起本会话预览图" : "加载本会话预览图";
  }
  archiveBtn.hidden = false;
  archiveBtn.textContent = thread.archived ? "解除归档" : "归档";

  syncBoardAttentionDot();
  syncWorkspaceVisibility();
  renderLiveBanner();
  renderCodexCompatBanner();
  renderProjectTaskStrip();
  renderComposerControls();
  renderComposerArchivedBanner();
}

function activeCodexProfileForBanner() {
  if (isBoardViewActive()) return null;
  const thread = state.activeThread || (state.initialThreadLoading && state.activeThreadId
    ? (state.threads.find((t) => t.id === state.activeThreadId) || null)
    : null);
  let profileId = "";
  if (thread) {
    if (thread.provider !== "codex") return null;
    profileId = String(thread.profileId || defaultProfileForProvider("codex") || "default").trim();
  } else if (state.newThreadCwd !== null) {
    if (currentComposerProvider() !== "codex") return null;
    profileId = String(currentComposerProfileId() || defaultProfileForProvider("codex") || "default").trim();
  } else {
    return null;
  }
  if (!profileId) return null;
  const profile = state.profiles.find((p) => p.provider === "codex" && p.id === profileId) || null;
  return { profileId, profile };
}

function renderCodexCompatBanner() {
  const banner = $("codexCompatBanner");
  if (!banner) return;
  const target = activeCodexProfileForBanner();
  if (!target) {
    banner.hidden = true;
    banner.className = "codex-compat-banner";
    banner.innerHTML = "";
    return;
  }
  const { profileId, profile } = target;
  const execEnabled = Boolean(profile?.health?.codexExecMode);
  const suggested = Boolean(
    profile?.health?.codexExecSuggested
    || profile?.health?.reasonCode === "official_client_only"
    || state.codexExecSuggestedProfiles.has(profileId),
  );
  if (!execEnabled && !suggested) {
    banner.hidden = true;
    banner.className = "codex-compat-banner";
    banner.innerHTML = "";
    return;
  }
  const busy = state.codexExecTogglingProfileKey === `codex:${profileId}`;
  const hasActiveThread = Boolean(state.activeThread);
  banner.hidden = false;
  banner.className = `codex-compat-banner${execEnabled ? " is-active" : ""}`;
  const text = execEnabled
    ? (hasActiveThread
      ? "已开启原生 codex exec 兼容模式（旧会话可能沿用原来源标识，如仍 403 请点右侧新会话重试；暂不支持运行中插话与交互审批）"
      : "已开启原生 codex exec 兼容模式（走官方非交互子命令；暂不支持运行中插话与交互审批）")
    : "检测到当前 Codex 通道限制仅允许官方 CLI（403），可开启原生 codex exec 兼容模式重试";
  const newThreadBtnHtml = (execEnabled && hasActiveThread)
    ? `<button type="button" class="codex-compat-new-btn" data-codex-exec-new-thread="1" data-profile-id="${escapeHtml(profileId)}">新会话重试</button>`
    : "";
  const dismissHtml = execEnabled
    ? ""
    : `<button type="button" class="codex-compat-dismiss" data-codex-exec-dismiss="1" data-profile-id="${escapeHtml(profileId)}" aria-label="收起兼容提示" title="收起提示">${iconSvg("close", { size: 12 })}</button>`;
  banner.innerHTML = `
    <span class="codex-compat-banner-copy">${escapeHtml(text)}</span>
    <span class="codex-compat-banner-actions">
      ${newThreadBtnHtml}
      <button type="button" class="codex-compat-switch" role="switch" aria-checked="${execEnabled ? "true" : "false"}" data-codex-exec-toggle="1" data-profile-id="${escapeHtml(profileId)}" ${busy ? "disabled" : ""}>
        <span class="codex-compat-switch-track" aria-hidden="true"></span>
        <span>codex exec 兼容</span>
      </button>
      ${dismissHtml}
    </span>
  `;
}

function renderLiveBanner() {
  const banner = $("liveBanner");
  if (state.toastActive) {
    banner.classList.remove("is-ambient");
    return;
  }
  const running = isActiveThreadRunning();
  if (!running) {
    banner.classList.remove("is-error", "is-ambient");
    banner.hidden = true;
    return;
  }
  // When actively following an open chat thread, live streaming progress is already shown inline below messages.
  if (!state.boardOpen && state.autoFollow && state.activeThread) {
    banner.classList.remove("is-error", "is-ambient");
    banner.hidden = true;
    return;
  }
  banner.classList.remove("is-error");
  banner.hidden = false;
  const { phase, detail } = humanizeLiveActivity(state.liveActivity, {
    isStreamingText: Boolean(state.streamingText),
  });
  const isAmbient = !detail && (/执行中$/.test(phase) || (Boolean(state.streamingText) && phase === "正在生成回复…"));
  banner.classList.toggle("is-ambient", isAmbient);
  $("livePhaseText").textContent = phase;
  $("liveDetailText").textContent = detail;
}

function currentInlineLivePhase() {
  if (!isActiveThreadRunning()) return "";
  const { phase, detail } = humanizeLiveActivity(state.liveActivity, {
    isStreamingText: Boolean(state.streamingText),
  });
  if (!phase && !detail) return "";
  return detail && detail !== phase ? `${phase} · ${detail}` : (phase || detail || "");
}

function captureTurnListOpenKeys(blocks, startIdx = 0) {
  const keys = new Set();
  const seenFromEnd = new Map();
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (!block) continue;
    const baseKey = block.getAttribute("data-turn-id") || `idx:${startIdx + i}`;
    const occFromEnd = seenFromEnd.get(baseKey) || 0;
    seenFromEnd.set(baseKey, occFromEnd + 1);
    const turnKey = `${baseKey}#${occFromEnd}`;
    const boxes = block.querySelectorAll(".process-summary-box, .heartbeat-disclosure, .live-cmd-output-details");
    for (let b = 0; b < boxes.length; b += 1) {
      if (boxes[b].open) keys.add(`${turnKey}:${b}`);
    }
  }
  return keys;
}

function restoreTurnListOpenKeys(blocks, openKeys, startIdx = 0) {
  if (!openKeys || !openKeys.size) return;
  const seenFromEnd = new Map();
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (!block) continue;
    const baseKey = block.getAttribute("data-turn-id") || `idx:${startIdx + i}`;
    const occFromEnd = seenFromEnd.get(baseKey) || 0;
    seenFromEnd.set(baseKey, occFromEnd + 1);
    const turnKey = `${baseKey}#${occFromEnd}`;
    const boxes = block.querySelectorAll(".process-summary-box, .heartbeat-disclosure, .live-cmd-output-details");
    for (let b = 0; b < boxes.length; b += 1) {
      if (openKeys.has(`${turnKey}:${b}`)) boxes[b].open = true;
    }
  }
}

function activeDisplayTurns() {
  if (!state.activeThread || state.boardOpen) return [];
  return dedupeAdjacentTurns(Array.isArray(state.activeThread.turns) ? state.activeThread.turns : []);
}

let deferredImageObserver = null;
let renderedTurnHtmlCache = [];
let renderedThreadCacheId = "";
let deferredObserveRafId = 0;
const REVEALED_IMAGE_CACHE_LIMIT = 600;
const revealedDeferredImageSrcs = new Set();
const threadImageVisibility = new Map();

function rememberRevealedImageSrc(src = "") {
  const clean = String(src || "").trim();
  if (!clean) return;
  if (revealedDeferredImageSrcs.has(clean)) {
    revealedDeferredImageSrcs.delete(clean);
  } else if (revealedDeferredImageSrcs.size >= REVEALED_IMAGE_CACHE_LIMIT) {
    const oldest = revealedDeferredImageSrcs.values().next().value;
    if (oldest !== undefined) revealedDeferredImageSrcs.delete(oldest);
  }
  revealedDeferredImageSrcs.add(clean);
}

function isThreadImagesUnlocked(threadId = state.activeThread?.id || state.activeThreadId || "") {
  const clean = String(threadId || "").trim();
  return Boolean(clean && (threadImageVisibility.get(clean) ?? autoPreviewThreadImages({
    hostname: location.hostname,
    finePointer: matchMedia("(pointer: fine)").matches,
  })));
}

function syncThreadImagesUnlockedClass() {
  const unlocked = isThreadImagesUnlocked();
  $("turnList")?.classList.toggle("is-images-unlocked", unlocked);
  $("streamingTurn")?.classList.toggle("is-images-unlocked", unlocked);
}

function setThreadImagesUnlocked(threadId, unlocked) {
  const cleanTid = String(threadId || "").trim();
  if (!cleanTid) return;
  if (unlocked) {
    threadImageVisibility.set(cleanTid, true);
    syncThreadImagesUnlockedClass();
    renderTopbarAndControls();
    scheduleDeferredImagesObservation($("messagesViewport"));
    return;
  }
  threadImageVisibility.set(cleanTid, false);
  const encodedTid = encodeURIComponent(cleanTid);
  for (const src of [...revealedDeferredImageSrcs]) {
    if (src.includes(`threadId=${encodedTid}`) || src.includes(cleanTid)) {
      revealedDeferredImageSrcs.delete(src);
    }
  }
  resetDeferredImageObserver({ resetRevealed: false });
  resetTurnListRenderCache();
  renderTopbarAndControls();
  renderActiveMessages();
}

function resetTurnListRenderCache() {
  renderedTurnHtmlCache = [];
  renderedThreadCacheId = "";
}

function resetDeferredImageObserver({ resetRevealed = true } = {}) {
  if (deferredObserveRafId) {
    cancelAnimationFrame(deferredObserveRafId);
    deferredObserveRafId = 0;
  }
  if (deferredImageObserver) {
    deferredImageObserver.disconnect();
    deferredImageObserver = null;
  }
  if (resetRevealed) {
    revealedDeferredImageSrcs.clear();
  }
}

function markCardImageDeferredState(img, { deferred = false } = {}) {
  img.classList.toggle("is-deferred-image", deferred);
  const card = img.closest(".msg-image-card");
  if (card) {
    card.classList.toggle("is-deferred", deferred);
    if (!deferred) {
      const btn = card.querySelector(".msg-image-btn");
      if (btn?.dataset.previewCaption) {
        btn.title = `点击放大预览：${btn.dataset.previewCaption}`;
      }
    }
  }
  const inlineWrap = img.closest(".md-inline-img-wrap");
  if (inlineWrap) {
    inlineWrap.classList.toggle("is-deferred", deferred);
  }
}

function markCardImageBroken(img) {
  markCardImageDeferredState(img, { deferred: false });
  const inlineWrap = img.closest(".md-inline-img-wrap");
  const targetInline = inlineWrap || (img.classList.contains("md-inline-img") ? img : null);
  if (targetInline) {
    const replacement = document.createElement("span");
    replacement.className = "msg-file-chip";
    replacement.title = img.dataset.previewCaption || img.getAttribute("alt") || "";
    replacement.innerHTML = `${iconSvg("image", { size: 12 })}<span>${escapeHtml(img.getAttribute("alt") || "图片")}</span>`;
    targetInline.replaceWith(replacement);
    return;
  }
  const card = img.closest(".msg-image-card");
  if (!card) return;
  card.classList.add("is-broken");
  const fallback = card.querySelector(".msg-file-chip.is-fallback");
  if (fallback) fallback.hidden = false;
}

function hydrateRevealedDeferredImages(containerEl) {
  if (!containerEl) return;
  const imgs = containerEl.querySelectorAll("img[data-lazy-src]");
  for (const img of imgs) {
    const lazySrc = img.dataset.lazySrc || "";
    if (!lazySrc) continue;
    if (isThreadImageFailed(lazySrc)) {
      delete img.dataset.lazySrc;
      revealedDeferredImageSrcs.delete(lazySrc);
      markCardImageBroken(img);
      continue;
    }
    if (!revealedDeferredImageSrcs.has(lazySrc)) continue;
    delete img.dataset.lazySrc;
    img.src = lazySrc;
    markCardImageDeferredState(img, { deferred: false });
  }
}

function activateDeferredImage(img) {
  if (!(img instanceof HTMLImageElement)) return;
  const lazySrc = img.dataset.lazySrc || "";
  if (!lazySrc) return;
  delete img.dataset.lazySrc;
  deferredImageObserver?.unobserve(deferredImageObservationTarget(img));
  if (isThreadImageFailed(lazySrc)) {
    revealedDeferredImageSrcs.delete(lazySrc);
    markCardImageBroken(img);
    return;
  }
  rememberRevealedImageSrc(lazySrc);

  const vp = $("messagesViewport");
  const beforeRect = vp ? img.getBoundingClientRect() : null;
  const finishLoad = () => {
    img.removeEventListener("load", onLoad);
    img.removeEventListener("error", onError);
    markCardImageDeferredState(img, { deferred: false });
    if (!vp) return;
    if (state.autoFollow) {
      scrollViewportIfFollowing();
    } else if (beforeRect) {
      const vpRect = vp.getBoundingClientRect();
      if (beforeRect.bottom <= vpRect.top + 8) {
        const afterHeight = img.getBoundingClientRect().height;
        const delta = afterHeight - beforeRect.height;
        if (Math.abs(delta) >= 1) {
          vp.scrollTop += delta;
        }
      }
    }
  };
  const onLoad = () => finishLoad();
  const onError = () => {
    img.removeEventListener("load", onLoad);
    img.removeEventListener("error", onError);
    markThreadImageFailed(lazySrc);
    revealedDeferredImageSrcs.delete(lazySrc);
    markCardImageBroken(img);
  };
  img.addEventListener("load", onLoad, { once: true });
  img.addEventListener("error", onError, { once: true });
  img.src = lazySrc;
  if (img.complete && img.naturalWidth > 0) {
    finishLoad();
  }
}

function isImageWithinViewport(img, vp) {
  if (!img || !vp) return false;
  const vpRect = vp.getBoundingClientRect();
  const rect = img.getBoundingClientRect();
  if (vpRect.width <= 0 || vpRect.height <= 0 || (rect.width <= 0 && rect.height <= 0)) {
    return false;
  }
  return rect.bottom > vpRect.top && rect.top < vpRect.bottom && rect.right > vpRect.left && rect.left < vpRect.right;
}

function deferredImageObservationTarget(img) {
  return img.closest(".msg-image-card, .md-inline-img-wrap") || img;
}

function ensureDeferredImageObserver() {
  const vp = $("messagesViewport");
  if (!vp || typeof IntersectionObserver !== "function") return null;
  if (!deferredImageObserver) {
    deferredImageObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting && entry.intersectionRatio <= 0) continue;
          activateDeferredImage(entry.target.querySelector("img[data-lazy-src]") || entry.target);
        }
      },
      {
        root: vp,
        rootMargin: "0px",
        threshold: 0.01,
      },
    );
  }
  return deferredImageObserver;
}

function scheduleDeferredImagesObservation(rootEl = $("messagesViewport")) {
  if (!rootEl) return;
  syncThreadImagesUnlockedClass();
  hydrateRevealedDeferredImages(rootEl);
  if (!isThreadImagesUnlocked()) return;
  if (deferredObserveRafId) {
    cancelAnimationFrame(deferredObserveRafId);
  }
  deferredObserveRafId = requestAnimationFrame(() => {
    deferredObserveRafId = 0;
    if (!isThreadImagesUnlocked()) return;
    const vp = $("messagesViewport");
    const imgs = rootEl.querySelectorAll("img[data-lazy-src]");
    if (!imgs.length) return;
    const observer = ensureDeferredImageObserver();
    if (!observer) {
      for (const img of imgs) {
        if (isImageWithinViewport(deferredImageObservationTarget(img), vp)) {
          activateDeferredImage(img);
        }
      }
      return;
    }
    for (const img of imgs) {
      if (revealedDeferredImageSrcs.has(img.dataset.lazySrc || "")) {
        activateDeferredImage(img);
        continue;
      }
      if (img.dataset.lazyObserved === "1") continue;
      img.dataset.lazyObserved = "1";
      observer.observe(deferredImageObservationTarget(img));
    }
  });
}

function captureViewportAnchor(vp) {
  if (!vp || state.autoFollow) return null;
  const turnListEl = $("turnList");
  if (!turnListEl || turnListEl.hidden || !turnListEl.children.length) return null;
  const vpRect = vp.getBoundingClientRect();
  if (vpRect.height <= 0) return null;
  const blocks = turnListEl.children;
  for (let i = 0; i < blocks.length; i += 1) {
    const el = blocks[i];
    const rect = el.getBoundingClientRect();
    if (rect.height <= 0) continue;
    const turnId = el.getAttribute("data-turn-id") || "";
    if (!turnId || rect.bottom <= vpRect.top + 4) continue;
    let childIdx = -1;
    let childEl = null;
    let offsetTop = rect.top - vpRect.top;
    if (rect.top < vpRect.top - 24 && el.children.length > 0) {
      for (let c = 0; c < el.children.length; c += 1) {
        const cRect = el.children[c].getBoundingClientRect();
        if (cRect.height > 0 && cRect.bottom > vpRect.top + 4) {
          childIdx = c;
          childEl = el.children[c];
          offsetTop = cRect.top - vpRect.top;
          break;
        }
      }
    }
    let occurrenceFromEnd = 0;
    for (let j = i + 1; j < blocks.length; j += 1) {
      if ((blocks[j].getAttribute("data-turn-id") || "") === turnId) {
        occurrenceFromEnd += 1;
      }
    }
    return { turnId, childIdx, childEl, offsetTop, blockEl: el, occurrenceFromEnd };
  }
  return null;
}

function restoreViewportAnchor(vp, anchor) {
  if (!vp || !anchor || state.autoFollow) return;
  const turnListEl = $("turnList");
  if (!turnListEl || turnListEl.hidden) return;
  const vpRect = vp.getBoundingClientRect();
  let target = null;
  if (
    anchor.blockEl
    && anchor.blockEl.parentElement === turnListEl
    && (anchor.blockEl.getAttribute("data-turn-id") || "") === anchor.turnId
  ) {
    target = anchor.blockEl;
  } else {
    const matches = [];
    for (const el of turnListEl.children) {
      if ((el.getAttribute("data-turn-id") || "") === anchor.turnId) {
        matches.push(el);
      }
    }
    if (matches.length === 1) {
      target = matches[0];
    } else if (matches.length > 1) {
      const occFromEnd = Math.max(0, Number(anchor.occurrenceFromEnd) || 0);
      const targetIdx = Math.max(0, Math.min(matches.length - 1, matches.length - 1 - occFromEnd));
      target = matches[targetIdx];
    }
  }
  if (!target) return;
  const anchorEl = (anchor.childEl && anchor.childEl.parentElement === target)
    ? anchor.childEl
    : ((anchor.childIdx >= 0 && target.children[anchor.childIdx]) ? target.children[anchor.childIdx] : target);
  const nextOffsetTop = anchorEl.getBoundingClientRect().top - vpRect.top;
  const delta = nextOffsetTop - anchor.offsetTop;
  if (Math.abs(delta) >= 1) {
    vp.scrollTop += delta;
  }
}

function parseTurnBlockElement(html) {
  const tpl = document.createElement("template");
  tpl.innerHTML = String(html || "").trim();
  const block = tpl.content.firstElementChild;
  if (block) {
    for (const child of block.children) {
      child._acRawHtml = child.outerHTML;
    }
    hydrateRevealedDeferredImages(block);
  }
  return block;
}

function stampRawChildHtmls(containerEl) {
  if (!containerEl) return;
  for (const child of containerEl.children) {
    child._acRawHtml = child.outerHTML;
  }
}

function patchNodeWithSameClassOrTag(existingNode, nextNode) {
  const rawNext = nextNode._acRawHtml || nextNode.outerHTML;
  if (existingNode._acRawHtml === rawNext) return false;
  if (
    existingNode.classList.contains("process-card")
    && nextNode.classList.contains("process-card")
  ) {
    existingNode.className = nextNode.className;
    const prevSummary = existingNode.querySelector(":scope > .process-summary-box");
    const nextSummary = nextNode.querySelector(":scope > .process-summary-box");
    const prevFeed = existingNode.querySelector(":scope > .live-progress-feed");
    const nextFeed = nextNode.querySelector(":scope > .live-progress-feed");
    if (prevSummary && nextSummary) {
      const nextSumRaw = nextSummary.outerHTML;
      if (prevSummary._acRawHtml !== nextSumRaw) {
        const uiSnap = captureSubtreeUiState(prevSummary);
        nextSummary._acRawHtml = nextSumRaw;
        hydrateRevealedDeferredImages(nextSummary);
        prevSummary.replaceWith(nextSummary);
        restoreSubtreeUiState(nextSummary, uiSnap, { restoreFocus: false });
      }
      if (prevFeed && nextFeed) {
        const nextFeedRaw = nextFeed.outerHTML;
        if (prevFeed._acRawHtml !== nextFeedRaw) {
          const feedSnap = captureSubtreeUiState(prevFeed);
          nextFeed._acRawHtml = nextFeedRaw;
          prevFeed.replaceWith(nextFeed);
          restoreSubtreeUiState(nextFeed, feedSnap, { restoreFocus: false });
        }
      } else if (!prevFeed && nextFeed) {
        nextFeed._acRawHtml = nextFeed.outerHTML;
        existingNode.appendChild(nextFeed);
      } else if (prevFeed && !nextFeed) {
        prevFeed.remove();
      }
      existingNode._acRawHtml = rawNext;
      return true;
    }
  }
  const nodeSnap = captureSubtreeUiState(existingNode);
  nextNode._acRawHtml = rawNext;
  hydrateRevealedDeferredImages(nextNode);
  existingNode.replaceWith(nextNode);
  restoreSubtreeUiState(nextNode, nodeSnap, { restoreFocus: false });
  return true;
}

function patchTurnBlockInPlace(existingBlock, nextHtml, turnIndex = 0) {
  const nextBlock = parseTurnBlockElement(nextHtml);
  if (!existingBlock || !nextBlock) return false;
  existingBlock.className = nextBlock.className;
  const nextTurnId = nextBlock.getAttribute("data-turn-id") || "";
  if (nextTurnId) existingBlock.setAttribute("data-turn-id", nextTurnId);

  const openKeys = captureTurnListOpenKeys([existingBlock], turnIndex);
  const existingChildren = Array.from(existingBlock.children);
  const nextChildren = Array.from(nextBlock.children);
  const common = Math.min(existingChildren.length, nextChildren.length);
  for (let i = 0; i < common; i += 1) {
    patchNodeWithSameClassOrTag(existingChildren[i], nextChildren[i]);
  }
  for (let i = common; i < nextChildren.length; i += 1) {
    hydrateRevealedDeferredImages(nextChildren[i]);
    existingBlock.appendChild(nextChildren[i]);
  }
  for (let i = existingChildren.length - 1; i >= nextChildren.length; i -= 1) {
    existingChildren[i].remove();
  }
  restoreTurnListOpenKeys([existingBlock], openKeys, turnIndex);
  return true;
}

function syncTurnListIncremental(turnListEl, threadId, turns) {
  const nextHtmls = turns.map((turn, idx) => renderTurnHtml(turn, buildTurnRenderOptions(turns, idx)));
  const sameThread = renderedThreadCacheId === threadId;
  const prevLen = renderedTurnHtmlCache.length;
  const nextLen = nextHtmls.length;

  // 头部加载更早历史时，若现有尾部序列与新列表末尾一致，仅在顶部前置新增回合，不重建下方可见节点与图片。
  if (
    sameThread
    && prevLen > 0
    && nextLen > prevLen
    && turnListEl.children.length === prevLen
  ) {
    const prependCount = nextLen - prevLen;
    let suffixMatches = true;
    for (let i = 0; i < prevLen; i += 1) {
      if (renderedTurnHtmlCache[i] !== nextHtmls[prependCount + i]) {
        suffixMatches = false;
        break;
      }
    }
    if (suffixMatches) {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < prependCount; i += 1) {
        const el = parseTurnBlockElement(nextHtmls[i]);
        if (el) frag.appendChild(el);
      }
      turnListEl.insertBefore(frag, turnListEl.firstChild);
      renderedTurnHtmlCache = nextHtmls;
      return;
    }
  }

  if (
    !sameThread
    || prevLen === 0
    || turnListEl.children.length !== prevLen
  ) {
    const openKeys = sameThread ? captureTurnListOpenKeys(turnListEl.querySelectorAll(":scope > .turn-block"), 0) : null;
    turnListEl.innerHTML = nextHtmls.join("");
    for (const block of turnListEl.children) {
      stampRawChildHtmls(block);
    }
    hydrateRevealedDeferredImages(turnListEl);
    if (openKeys && openKeys.size) {
      restoreTurnListOpenKeys(turnListEl.querySelectorAll(":scope > .turn-block"), openKeys, 0);
    }
    renderedThreadCacheId = threadId;
    renderedTurnHtmlCache = nextHtmls;
    return;
  }

  const commonLen = Math.min(prevLen, nextLen);
  for (let i = 0; i < commonLen; i += 1) {
    if (renderedTurnHtmlCache[i] === nextHtmls[i]) continue;
    const existingEl = turnListEl.children[i];
    if (!patchTurnBlockInPlace(existingEl, nextHtmls[i], i)) {
      const openKeys = captureTurnListOpenKeys([existingEl], i);
      const replacement = parseTurnBlockElement(nextHtmls[i]);
      if (existingEl && replacement) {
        existingEl.replaceWith(replacement);
        restoreTurnListOpenKeys([replacement], openKeys, i);
      }
    }
  }

  if (nextLen > prevLen) {
    const frag = document.createDocumentFragment();
    for (let i = prevLen; i < nextLen; i += 1) {
      const el = parseTurnBlockElement(nextHtmls[i]);
      if (el) frag.appendChild(el);
    }
    turnListEl.appendChild(frag);
  } else if (prevLen > nextLen) {
    while (turnListEl.children.length > nextLen) {
      turnListEl.lastElementChild?.remove();
    }
  }

  renderedThreadCacheId = threadId;
  renderedTurnHtmlCache = nextHtmls;
}

function buildTurnRenderOptions(turns, idx) {
  const agentLabel = providerDisplayName(state.activeThread?.provider);
  const running = isActiveThreadRunning();
  const isLastTurn = idx === turns.length - 1;
  const hasStreamingReply = Boolean(state.streamingText);
  const turnRunning = isLastTurn && running && !hasStreamingReply;
  const targetTurn = turns[idx];
  const foldCompletedThoughtIntoLastProcess = Boolean(
    isLastTurn
    && hasStreamingReply
    && state.streamingThought
    && turnEndsWithProcessGroup(targetTurn),
  );
  return {
    agentLabel,
    threadId: state.activeThread?.id || state.activeThreadId || "",
    turnIndex: idx,
    forceRunning: turnRunning,
    suppressRunning: !turnRunning,
    liveThought: turnRunning ? state.streamingThought : "",
    livePhase: turnRunning ? currentInlineLivePhase() : "",
    trailingThought: foldCompletedThoughtIntoLastProcess ? state.streamingThought : "",
    hideSyntheticLiveReply: Boolean(isLastTurn && hasStreamingReply),
    showIncompleteSummaryHint: true,
    supersededByNextTurn: !isLastTurn,
    hasExternalStreamingReply: Boolean(isLastTurn && hasStreamingReply),
    fallbackModel: state.activeThread?.model || "",
    fallbackEffort: state.activeThread?.reasoningEffort || "",
    goalSuspended: Boolean(isLastTurn && state.activeThread?.goalState?.active),
    deferImages: true,
  };
}

const scheduledMermaidRoots = new Set();
let mermaidHydrationRaf = 0;
let mermaidHydrationForceTheme = false;

function scheduleMermaidHydration(root = document, { forceThemeSync = false } = {}) {
  const targetRoot = root || (typeof document !== "undefined" ? document : null);
  if (!targetRoot) return;
  if (forceThemeSync) mermaidHydrationForceTheme = true;
  if (scheduledMermaidRoots.has(targetRoot) && mermaidHydrationRaf) return;
  scheduledMermaidRoots.add(targetRoot);
  if (mermaidHydrationRaf) return;
  const flush = () => {
    mermaidHydrationRaf = 0;
    const roots = Array.from(scheduledMermaidRoots);
    scheduledMermaidRoots.clear();
    const forceTheme = mermaidHydrationForceTheme;
    mermaidHydrationForceTheme = false;
    for (const r of roots) {
      if (typeof r?.querySelectorAll !== "function") continue;
      if (r?.isConnected === false) continue;
      void hydrateMermaidBlocks(r, { forceThemeSync: forceTheme }).catch(() => {});
    }
  };
  if (typeof requestAnimationFrame === "function") {
    mermaidHydrationRaf = requestAnimationFrame(flush);
  } else {
    mermaidHydrationRaf = 1;
    queueMicrotask(flush);
  }
}

function syncLiveTurnFrontier() {
  if (state.streamingText || !isActiveThreadRunning()) {
    renderStreamingTurn();
    return;
  }
  const turns = activeDisplayTurns();
  const turnListEl = $("turnList");
  if (!turns.length || !turnListEl || turnListEl.hidden || turnListEl.children.length !== turns.length) {
    if (turns.length) {
      renderActiveMessages();
    } else {
      renderStreamingTurn();
    }
    return;
  }
  const vp = $("messagesViewport");
  const anchor = captureViewportAnchor(vp);
  const lastIdx = turns.length - 1;
  const lastBlock = turnListEl.lastElementChild;
  if (!lastBlock) {
    renderActiveMessages();
    return;
  }
  const nextLastHtml = renderTurnHtml(turns[lastIdx], buildTurnRenderOptions(turns, lastIdx));
  if (renderedTurnHtmlCache[lastIdx] !== nextLastHtml) {
    if (!patchTurnBlockInPlace(lastBlock, nextLastHtml, lastIdx)) {
      const openKeys = captureTurnListOpenKeys([lastBlock], lastIdx);
      const replacement = parseTurnBlockElement(nextLastHtml);
      if (replacement) {
        lastBlock.replaceWith(replacement);
        restoreTurnListOpenKeys([replacement], openKeys, lastIdx);
      } else {
        lastBlock.outerHTML = nextLastHtml;
        if (turnListEl.lastElementChild) {
          restoreTurnListOpenKeys([turnListEl.lastElementChild], openKeys, lastIdx);
        }
      }
    }
    if (renderedTurnHtmlCache.length === turns.length) {
      renderedTurnHtmlCache[lastIdx] = nextLastHtml;
    }
  }
  renderStreamingTurn({ preserveAnchor: false });
  if (state.autoFollow) {
    scrollViewportIfFollowing();
  } else {
    restoreViewportAnchor(vp, anchor);
  }
  scheduleDeferredImagesObservation(vp);
  scheduleMermaidHydration(vp);
}

function renderStreamingTurn({ preserveAnchor = true } = {}) {
  const el = $("streamingTurn");
  if (!el) return;
  if (isBoardViewActive()) {
    el.hidden = true;
    el._acLastHtml = "";
    el.innerHTML = "";
    return;
  }
  const vp = $("messagesViewport");
  const anchor = preserveAnchor ? captureViewportAnchor(vp) : null;
  const turns = activeDisplayTurns();
  if (!state.streamingText && turns.length > 0 && isActiveThreadRunning()) {
    el.hidden = true;
    el._acLastHtml = "";
    el.innerHTML = "";
    if (anchor) restoreViewportAnchor(vp, anchor);
    return;
  }
  if (!state.streamingText && !state.streamingThought) {
    el.hidden = true;
    el._acLastHtml = "";
    el.innerHTML = "";
    if (anchor) restoreViewportAnchor(vp, anchor);
    return;
  }
  el.hidden = false;
  const agentLabel = providerDisplayName(state.activeThread?.provider || currentComposerProvider());
  const streamBadge = formatTurnModelBadge({
    model: state.activeThread?.model || $("modelSelect")?.value || "",
    effort: state.activeThread?.reasoningEffort || ($("effortSelect")?.hidden ? "" : $("effortSelect")?.value || ""),
  });
  const streamModelPillHtml = streamBadge?.label
    ? `<span class="process-model-pill" title="${escapeHtml(streamBadge.title || streamBadge.label)}">${escapeHtml(streamBadge.label)}</span>`
    : "";
  const parts = [];
  const hasStreamingReply = Boolean(state.streamingText);
  const thoughtAlreadyFolded = Boolean(
    hasStreamingReply
    && state.streamingThought
    && turns.length > 0
    && turnEndsWithProcessGroup(turns[turns.length - 1]),
  );
  if (state.streamingThought && !thoughtAlreadyFolded) {
    const thoughtLabel = hasStreamingReply ? "已完成思考分析" : "执行过程 · 正在思考分析";
    const compactThought = state.streamingThought.replace(/\s+/g, " ").trim();
    const thoughtTail = compactThought.length > 180 ? `…${compactThought.slice(-180).trim()}` : compactThought;
    if (hasStreamingReply) {
      parts.push(`
        <div class="process-card">
          <details class="process-summary-box">
            <summary>
              <span class="process-summary-dot"></span>
              <span class="process-summary-text">${thoughtLabel}</span>
              ${streamModelPillHtml}
              <span class="process-summary-hint">查看推理</span>
            </summary>
            <div class="process-summary-body">
              <div class="tool-body md-body">${renderMarkdown(state.streamingThought, { deferImages: true })}</div>
            </div>
          </details>
        </div>
      `);
    } else {
      const liveThoughtPreviewHtml = thoughtTail
        ? `<div class="live-progress-feed" aria-live="polite"><div class="live-thought-preview" data-live-frontier="1"><span class="live-frontier-dot" aria-hidden="true"></span><span class="tool-kind">思考中</span><span class="live-thought-text">${escapeHtml(thoughtTail)}</span></div></div>`
        : "";
      parts.push(`
        <div class="process-card is-live">
          <details class="process-summary-box is-live">
            <summary>
              <span class="process-summary-dot"></span>
              <span class="process-summary-text">${thoughtLabel}</span>
              ${streamModelPillHtml}
              <span class="process-summary-hint">查看推理</span>
            </summary>
            <div class="process-summary-body">
              <div class="tool-body md-body">${renderMarkdown(state.streamingThought, { deferImages: true })}</div>
            </div>
          </details>
          ${liveThoughtPreviewHtml}
        </div>
      `);
    }
  }
  if (state.streamingText) {
    const streamThreadId = state.activeThread?.id || state.activeThreadId || "";
    const cleanStreamText = cleanStreamingAgentText(state.streamingText);
    parts.push(`
      <div class="msg-row msg-agent">
        <div class="msg-meta">
          <span class="msg-role">${escapeHtml(agentLabel)}</span>
          ${streamBadge?.label ? `<span class="turn-model-tag" title="${escapeHtml(streamBadge.title || streamBadge.label)}">${escapeHtml(streamBadge.label)}</span>` : ""}
          <span class="phase-tag is-streaming"><span class="live-frontier-dot" aria-hidden="true"></span>正在回复…</span>
          ${renderMessageCopyButton(cleanStreamText)}
        </div>
        <div class="msg-bubble agent-bubble md-body">${renderMarkdown(cleanStreamText, { threadId: streamThreadId, deferImages: true })}</div>
      </div>
    `);
  }
  const streamHtml = parts.join("");
  if (replaceHtmlPreservingUiState(el, streamHtml, { restoreFocus: false })) {
    hydrateRevealedDeferredImages(el);
  }
  if (state.autoFollow) {
    scrollViewportIfFollowing();
  } else if (anchor) {
    restoreViewportAnchor(vp, anchor);
  }
  scheduleDeferredImagesObservation(el);
  scheduleMermaidHydration(el);
}

function renderActiveMessages() {
  const thread = state.activeThread;
  const turnListEl = $("turnList");
  const loadOlderWrap = $("loadOlderWrap");
  const vp = $("messagesViewport");

  syncWorkspaceVisibility();
  renderProjectBoard();
  renderProjectTaskStrip();

  if (state.initialThreadLoading && state.activeThreadId && !thread) {
    turnListEl.hidden = false;
    loadOlderWrap.hidden = true;
    $("streamingTurn").hidden = true;
    return;
  }

  if (!thread || state.boardOpen) {
    turnListEl.hidden = true;
    turnListEl.innerHTML = "";
    resetTurnListRenderCache();
    resetDeferredImageObserver({ resetRevealed: false });
    loadOlderWrap.hidden = true;
    $("streamingTurn").hidden = true;
    $("streamingTurn")._acLastHtml = "";
    if (!state.boardOpen && !thread) {
      renderStreamingTurn();
    }
    return;
  }

  const anchor = captureViewportAnchor(vp);
  turnListEl.hidden = false;
  loadOlderWrap.hidden = !state.nextCursor;
  const turns = dedupeAdjacentTurns(Array.isArray(thread.turns) ? thread.turns : []);
  syncTurnListIncremental(turnListEl, thread.id || state.activeThreadId || "", turns);
  renderStreamingTurn({ preserveAnchor: false });
  if (state.pendingScrollToTurn && state.pendingScrollToTurn.threadId === (thread.id || state.activeThreadId || "")) {
    const targetInfo = state.pendingScrollToTurn;
    state.pendingScrollToTurn = null;
    requestAnimationFrame(() => applyPendingTurnScroll(targetInfo));
  } else if (state.autoFollow) {
    scrollViewportIfFollowing();
  } else {
    restoreViewportAnchor(vp, anchor);
  }
  scheduleDeferredImagesObservation(vp);
  scheduleMermaidHydration(vp);
}

function applyPendingTurnScroll({ turnId = "", turnIndex = -1 } = {}) {
  const turnListEl = $("turnList");
  if (!turnListEl) return;
  let btn = null;
  if (turnId) {
    btn = [...turnListEl.querySelectorAll("[data-pin-plan-turn-id]")].find((el) => el.dataset.pinPlanTurnId === turnId) || null;
  }
  if (!btn && Number.isInteger(turnIndex) && turnIndex >= 0) {
    btn = turnListEl.querySelector(`[data-pin-plan-turn-index="${turnIndex}"]`);
  }
  const target = btn?.closest(".msg-row") || btn?.closest(".turn-block") || (turnIndex >= 0 ? turnListEl.querySelectorAll(".turn-block")?.[turnIndex] : null);
  if (!target) return;
  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.remove("is-plan-highlight");
  void target.offsetWidth;
  target.classList.add("is-plan-highlight");
  setTimeout(() => target.classList.remove("is-plan-highlight"), 2600);
}

function renderPendingRequests() {
  const dock = $("pendingRequestsDock");
  const list = state.pendingRequests.filter((r) => !state.activeThreadId || r.threadId === state.activeThreadId);
  syncBoardAttentionDot();
  if (isBoardViewActive() || !list.length) {
    dock.hidden = true;
    dock.innerHTML = "";
    return;
  }
  dock.hidden = false;
  syncServerRequestCards(dock, list);
}

function activeEditingQueueItem() {
  const edit = state.editingQueueItem;
  if (!edit || !state.activeThreadId || edit.threadId !== state.activeThreadId) return null;
  return edit;
}

function renderComposerEditBanner() {
  const banner = $("composerEditBanner");
  if (!banner) return;
  const edit = activeEditingQueueItem();
  if (!edit) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }
  const pos = Math.max(1, Number(edit.position) || 1);
  banner.hidden = false;
  banner.innerHTML = `
    <span class="composer-edit-banner-label">正在编辑排队 #${pos}</span>
    <span class="composer-edit-banner-tip">保存后保留原排位</span>
    <button type="button" class="composer-edit-banner-cancel" data-cancel-queue-edit="1">取消编辑</button>
  `;
}

function renderComposerArchivedBanner() {
  const banner = $("composerArchivedBanner");
  if (!banner) return;
  const thread = state.activeThread;
  if (!thread || !thread.archived || isBoardViewActive()) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }
  const busy = state.unarchivingThreadId === thread.id;
  banner.hidden = false;
  banner.innerHTML = `
    <span class="composer-archived-banner-label">当前会话已归档，继续对话前需先解除归档</span>
    <button type="button" class="composer-unarchive-btn" data-unarchive-active-thread ${busy ? "disabled" : ""}>${busy ? "解除中…" : "解除归档"}</button>
  `;
}

function clearQueueEditState({ restoreDraft = false } = {}) {
  const prev = state.editingQueueItem;
  state.editingQueueItem = null;
  if (restoreDraft && prev && prev.threadId === state.activeThreadId) {
    const input = $("promptInput");
    if (input) input.value = String(prev.prevDraftText || "");
    state.images = Array.isArray(prev.prevImages) ? [...prev.prevImages] : [];
    state.composerGoal = Boolean(prev.prevGoal);
    renderComposerImages();
  }
  renderComposerEditBanner();
  renderQueuedTurns();
  renderComposerControls();
}

function renderQueuedTurns() {
  const bar = $("queuedTurnsBar");
  const items = state.queuedTurns || [];
  if (isBoardViewActive() || !items.length) {
    bar.hidden = true;
    bar._acLastHtml = "";
    bar.innerHTML = "";
    return;
  }
  bar.hidden = false;
  const queuedHtml = renderQueuedTurnsPanelHtml(items, {
    collapsed: state.queuedPanelCollapsed,
    editingId: activeEditingQueueItem()?.id || "",
  });
  if (bar._acLastHtml !== queuedHtml) {
    bar._acLastHtml = queuedHtml;
    bar.innerHTML = queuedHtml;
  }
}

function applyActiveQueuedTurns(threadId, items = []) {
  if (!threadId) return;
  const next = Array.isArray(items) ? items : [];
  const target = state.threads.find((t) => t.id === threadId);
  const countChanged = target ? (target.queuedCount || 0) !== next.length : false;
  syncThreadSummaryIntoList({ id: threadId, queuedCount: next.length });

  if (threadId === state.activeThreadId) {
    const activeEdit = activeEditingQueueItem();
    const matchedEditEntry = activeEdit ? next.find((q) => q.id === activeEdit.id) : null;
    if (activeEdit && !matchedEditEntry) {
      state.editingQueueItem = null;
      renderComposerEditBanner();
      renderComposerControls();
      setComposerStatus("info", "原排队消息已自动发送或取消，当前编辑内容保留在输入框", { autoClearMs: 4500 });
    } else if (activeEdit && matchedEditEntry && matchedEditEntry.position && matchedEditEntry.position !== activeEdit.position) {
      activeEdit.position = matchedEditEntry.position;
      renderComposerEditBanner();
    }

    const editingIdNow = activeEditingQueueItem()?.id || "";
    const prevSig = (state.queuedTurns || [])
      .map((q) => `${q.id}:${q.text || ""}:${q.imageCount || 0}:${q.source || ""}:${q.goalMode ? 1 : 0}:${q.updatedAt || ""}`)
      .join("|") + `#${editingIdNow}`;
    const nextSig = next
      .map((q) => `${q.id}:${q.text || ""}:${q.imageCount || 0}:${q.source || ""}:${q.goalMode ? 1 : 0}:${q.updatedAt || ""}`)
      .join("|") + `#${editingIdNow}`;
    if (state.activeThread) {
      state.activeThread.queuedCount = next.length;
    }
    state.queuedTurns = next;
    if (prevSig !== nextSig) {
      renderQueuedTurns();
    }
  }
  if (countChanged) {
    renderThreadList();
    renderProjectTaskStrip();
    renderProjectBoard();
  }
}

function renderComposerImages() {
  const wrap = $("composerImages");
  if (!state.images.length) {
    wrap.hidden = true;
    wrap.innerHTML = "";
    return;
  }
  wrap.hidden = false;
  wrap.innerHTML = state.images.map((img, idx) => {
    const caption = img?.name || `图片 ${idx + 1}`;
    const info = [img.width && img.height ? `${img.width} × ${img.height}` : "", formatByteSize(img.byteLength || estimateDataUrlBytes(img.dataUrl))].filter(Boolean).join(" · ");
    return `
      <div class="composer-img-chip" title="${escapeHtml(caption)}">
        <button type="button" class="composer-img-thumb" data-preview-src="${escapeHtml(img.dataUrl)}" data-preview-caption="${escapeHtml(caption)}" aria-label="预览图片 ${escapeHtml(caption)}">
          <img src="${escapeHtml(img.dataUrl)}" alt="${escapeHtml(caption)}" />
          <span class="composer-img-details"><span class="composer-img-name">图片 ${idx + 1}</span><span class="composer-img-info">${escapeHtml(info)}</span></span>
        </button>
        <button type="button" class="composer-img-remove" data-remove-img="${idx}" aria-label="移除图片">${iconSvg("close", { size: 11 })}</button>
      </div>
    `;
  }).join("");
}

const PREVIEW_RASTER_RE = /\.(?:png|jpe?g|webp|gif)$/i;

function resolveImagePreviewLocalPath(src) {
  try {
    const url = new URL(src, location.href);
    const imageEndpoint = new URL("./api/thread/image", location.href);
    const fileEndpoint = new URL("./api/thread/file", location.href);
    if (url.origin !== imageEndpoint.origin || ![imageEndpoint.pathname, fileEndpoint.pathname].includes(url.pathname)) return "";
    const path = url.searchParams.get("path") || "";
    if (path.startsWith("/")) return path.startsWith("//") ? "" : path;
    if (!path || path.startsWith("~") || /^[a-z][a-z0-9+.-]*:/i.test(path)) return "";
    const threadId = url.searchParams.get("threadId");
    const thread = state.activeThread?.id === threadId
      ? state.activeThread
      : state.threads.find((item) => item.id === threadId);
    return thread?.cwd?.startsWith("/") ? `${thread.cwd.replace(/\/$/, "")}/${path}` : "";
  } catch { return ""; }
}

function ensureImagePreviewSvgHost() {
  let svgHost = $("imagePreviewSvgHost");
  if (svgHost) return svgHost;
  const stage = $("imagePreviewStage");
  if (!stage) return null;
  svgHost = document.createElement("div");
  svgHost.id = "imagePreviewSvgHost";
  svgHost.className = "image-preview-svg-host";
  svgHost.hidden = true;
  stage.appendChild(svgHost);
  return svgHost;
}

function openImagePreviewModal(src, caption = "", rawSrc = "") {
  const modal = $("imagePreviewModal");
  const img = $("imagePreviewImg");
  const svgHost = $("imagePreviewSvgHost");
  const capEl = $("imagePreviewCaption");
  const metaEl = $("imagePreviewMeta");
  const loadRawBtn = $("imagePreviewLoadRawBtn");
  const rawLink = $("imagePreviewOpenRaw");
  const revealBtn = $("imagePreviewRevealBtn");
  if (!modal || !img || !src) return;

  const isCompressedUrl = !src.startsWith("data:") && /[?&]w=\d+/i.test(src) && !/[?&]raw=1/i.test(src);
  const resolvedRaw = rawSrc || "";
  const localPath = resolveImagePreviewLocalPath(resolvedRaw || src);
  let revealThreadId = state.activeThread?.id || state.activeThreadId || "";
  let revealPath = localPath;
  try {
    const parsedUrl = new URL(resolvedRaw || src, location.href);
    revealThreadId = parsedUrl.searchParams.get("threadId") || revealThreadId;
    const paramPath = parsedUrl.searchParams.get("path");
    if (paramPath && localPath) revealPath = paramPath;
  } catch {}
  state.imagePreview = { svgMode: false, src, rawSrc: resolvedRaw, caption, showingRaw: !isCompressedUrl, scale: 1, tx: 0, ty: 0, revealThreadId, revealPath };
  modal.classList.remove("is-svg-preview");

  if (svgHost) {
    svgHost.hidden = true;
    svgHost.innerHTML = "";
    svgHost.style.transform = "";
    svgHost.classList.remove("is-zoomed", "is-dragging");
  }
  img.hidden = false;

  for (const target of [img, capEl]) {
    if (!target) continue;
    if (localPath) target.dataset.localFilePath = localPath;
    else delete target.dataset.localFilePath;
  }
  img.src = src;
  img.alt = caption || "图片预览";
  img.style.transform = "";
  img.classList.remove("is-zoomed", "is-dragging");
  const zoomBtn = $("imagePreviewZoomBtn");
  const zoomOutBtn = $("imagePreviewZoomOutBtn");
  const zoomInBtn = $("imagePreviewZoomInBtn");
  if (zoomBtn) {
    zoomBtn.hidden = true;
    zoomBtn.textContent = "100%";
  }
  if (zoomOutBtn) zoomOutBtn.hidden = true;
  if (zoomInBtn) zoomInBtn.hidden = true;
  if (capEl) capEl.textContent = caption || "图片预览";
  if (metaEl) {
    metaEl.hidden = src.startsWith("data:");
    metaEl.textContent = isCompressedUrl ? "省流压缩" : "原图";
  }
  if (loadRawBtn) {
    const canUpgradeRaw = Boolean(isCompressedUrl && resolvedRaw && resolvedRaw !== src);
    loadRawBtn.hidden = !canUpgradeRaw;
    loadRawBtn.disabled = false;
    loadRawBtn.textContent = "加载原图";
  }
  if (rawLink) {
    const targetHref = resolvedRaw || src;
    if (targetHref.startsWith("data:")) {
      rawLink.hidden = true;
      rawLink.setAttribute("href", "#");
    } else {
      rawLink.hidden = false;
      rawLink.setAttribute("href", targetHref);
    }
  }
  if (revealBtn) {
    const canReveal = Boolean(localPath && revealThreadId && (typeof isLoopbackHostname === "function" ? isLoopbackHostname(location.hostname) : false));
    revealBtn.hidden = !canReveal;
    revealBtn.disabled = false;
  }
  if (!modal.open && typeof modal.showModal === "function") {
    modal.showModal();
  }
}

function openMermaidPreviewModal(svgHtml, caption = "Mermaid 图表") {
  try {
    const modal = $("imagePreviewModal");
    const img = $("imagePreviewImg");
    const svgHost = ensureImagePreviewSvgHost();
    const capEl = $("imagePreviewCaption");
    const metaEl = $("imagePreviewMeta");
    const loadRawBtn = $("imagePreviewLoadRawBtn");
    const rawLink = $("imagePreviewOpenRaw");
    const zoomBtn = $("imagePreviewZoomBtn");
    const zoomOutBtn = $("imagePreviewZoomOutBtn");
    const zoomInBtn = $("imagePreviewZoomInBtn");
    if (!modal || !svgHost || !svgHtml) return;

    const prepared = prepareMermaidSvgForPreview(svgHtml);
    state.imagePreview = { svgMode: true, src: "", rawSrc: "", caption, showingRaw: true, scale: 1, tx: 0, ty: 0 };
    modal.classList.add("is-svg-preview");

    if (img) {
      img.hidden = true;
      img.removeAttribute("src");
      img.style.transform = "";
      img.classList.remove("is-zoomed", "is-dragging");
    }
    svgHost.innerHTML = prepared.svg;
    svgHost.hidden = false;
    svgHost.style.transform = "";
    svgHost.classList.remove("is-zoomed", "is-dragging");
    if (zoomOutBtn) zoomOutBtn.hidden = false;
    if (zoomBtn) {
      zoomBtn.hidden = false;
      zoomBtn.textContent = "100%";
    }
    if (zoomInBtn) zoomInBtn.hidden = false;
    if (capEl) capEl.textContent = caption || "Mermaid 图表";
    if (metaEl) metaEl.hidden = true;
    if (loadRawBtn) loadRawBtn.hidden = true;
    if (rawLink) {
      rawLink.hidden = true;
      rawLink.setAttribute("href", "#");
    }
    const revealBtn = $("imagePreviewRevealBtn");
    if (revealBtn) revealBtn.hidden = true;
    if (!modal.open && typeof modal.showModal === "function") {
      modal.showModal();
    }
  } catch (error) {
    showToastBanner("图表放大预览失败", { detail: error?.message || "请重试或切换源码查看", error: true });
  }
}

function renderFileCodeLinesHtml(content = "", { startLine = null, endLine = null } = {}) {
  const lines = String(content || "").replace(/\r\n?/g, "\n").split("\n");
  if (lines.length > 4000) {
    return `<pre class="file-preview-pre">${escapeHtml(content)}</pre>`;
  }
  const hiStart = Number(startLine) > 0 ? Number(startLine) : 0;
  const hiEnd = Number(endLine) >= hiStart && hiStart > 0 ? Number(endLine) : hiStart;
  return `
    <div class="file-code-lines">
      ${lines.map((ln, idx) => {
        const lineNo = idx + 1;
        const isHi = hiStart > 0 && lineNo >= hiStart && lineNo <= hiEnd;
        return `<div class="file-code-row${isHi ? " is-highlight" : ""}" data-line-no="${lineNo}"><span class="file-line-no">${lineNo}</span><span class="file-line-code">${escapeHtml(ln || " ")}</span></div>`;
      }).join("")}
    </div>
  `;
}

function renderFilePreviewBody(meta, { threadId = "", rawMode = false } = {}) {
  const bodyEl = $("filePreviewBody");
  if (!bodyEl || !meta) return;
  const targetLine = meta.startLine || 0;
  if (meta.kind === "markdown" && !rawMode) {
    bodyEl.innerHTML = `<div class="file-preview-md md-body">${renderMarkdown(meta.content || "", { threadId, basePath: meta.displayPath || meta.requestPath || "" })}</div>`;
    scheduleMermaidHydration(bodyEl);
    return;
  }
  if (meta.kind === "video") {
    const src = `./api/thread/file?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(meta.requestPath || meta.displayPath || meta.name)}&mode=raw`;
    bodyEl.innerHTML = `<div class="file-preview-media-wrap"><video class="file-preview-video" controls playsinline preload="metadata" src="${escapeHtml(src)}"></video></div>`;
    return;
  }
  if (meta.kind === "audio") {
    const src = `./api/thread/file?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(meta.requestPath || meta.displayPath || meta.name)}&mode=raw`;
    bodyEl.innerHTML = `<div class="file-preview-media-wrap"><audio class="file-preview-audio" controls preload="metadata" src="${escapeHtml(src)}"></audio></div>`;
    return;
  }
  if (meta.kind === "pdf") {
    const src = `./api/thread/file?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(meta.requestPath || meta.displayPath || meta.name)}&mode=raw`;
    bodyEl.innerHTML = `
      <div class="file-preview-media-wrap is-pdf">
        <div class="file-preview-pdf-bar"><a class="btn-secondary btn-xs" href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer">在新标签页查看完整 PDF</a></div>
        <iframe class="file-preview-pdf" src="${escapeHtml(src)}" title="${escapeHtml(meta.name || "PDF 预览")}"></iframe>
      </div>
    `;
    return;
  }
  if (meta.kind === "binary") {
    bodyEl.innerHTML = `<div class="file-preview-empty">二进制文件（${escapeHtml(formatByteSize(meta.size || 0))}），请点击右上角「下载」到本地查看。</div>`;
    return;
  }
  const truncBanner = meta.truncated
    ? `<div class="file-preview-trunc-note">文件较大，仅展示前 ${escapeHtml(formatByteSize(256 * 1024))} 内容（完整文件请点右上角下载）。</div>`
    : "";
  bodyEl.innerHTML = `${truncBanner}${renderFileCodeLinesHtml(meta.content || "", { startLine: meta.startLine, endLine: meta.endLine })}`;
  if (targetLine > 0) {
    const targetRow = bodyEl.querySelector(`[data-line-no="${targetLine}"]`);
    targetRow?.scrollIntoView?.({ block: "center" });
  }
}

async function openFilePreviewModal(threadId, filePath, lineAnchor = null) {
  const cleanThreadId = String(threadId || "").trim();
  const cleanPath = String(filePath || "").trim();
  if (!cleanThreadId || !cleanPath) return;

  if (PREVIEW_RASTER_RE.test(cleanPath)) {
    const base = `./api/thread/image?threadId=${encodeURIComponent(cleanThreadId)}&path=${encodeURIComponent(cleanPath)}`;
    openImagePreviewModal(`${base}&w=1280&q=75`, cleanPath, `${base}&raw=1`);
    return;
  }

  const modal = $("filePreviewModal");
  const nameEl = $("filePreviewName");
  const pathEl = $("filePreviewPath");
  const metaEl = $("filePreviewMeta");
  const toggleBtn = $("filePreviewToggleRawBtn");
  const copyBtn = $("filePreviewCopyBtn");
  const dlBtn = $("filePreviewDownloadBtn");
  const revealBtn = $("filePreviewRevealBtn");
  const bodyEl = $("filePreviewBody");
  if (!modal || !bodyEl) return;

  const baseName = cleanPath.split(/[\\/]/).filter(Boolean).pop() || cleanPath;
  if (nameEl) nameEl.textContent = baseName;
  if (pathEl) pathEl.textContent = lineAnchor ? `${cleanPath}#L${lineAnchor}` : cleanPath;
  if (metaEl) metaEl.hidden = true;
  if (toggleBtn) toggleBtn.hidden = true;
  if (copyBtn) copyBtn.hidden = true;
  if (dlBtn) {
    dlBtn.hidden = false;
    dlBtn.setAttribute("href", `./api/thread/file?threadId=${encodeURIComponent(cleanThreadId)}&path=${encodeURIComponent(cleanPath)}&mode=raw&download=1`);
  }
  if (revealBtn) {
    const canReveal = Boolean(cleanThreadId && cleanPath && (typeof isLoopbackHostname === "function" ? isLoopbackHostname(location.hostname) : false));
    revealBtn.hidden = !canReveal;
    revealBtn.disabled = false;
  }
  bodyEl.innerHTML = `<div class="file-preview-empty">正在读取文件内容…</div>`;
  state.filePreview = { threadId: cleanThreadId, path: cleanPath, meta: null, rawMode: false };
  if (!modal.open && typeof modal.showModal === "function") {
    modal.showModal();
  }

  try {
    const refWithLine = lineAnchor ? `${cleanPath}#L${lineAnchor}` : cleanPath;
    const res = await apiGet(`api/thread/file?threadId=${encodeURIComponent(cleanThreadId)}&path=${encodeURIComponent(refWithLine)}`);
    const meta = {
      ...res,
      requestPath: cleanPath,
      startLine: Number(res?.startLine) || (Number(lineAnchor) || null),
      endLine: Number(res?.endLine) || (Number(lineAnchor) || null),
    };
    state.filePreview = { threadId: cleanThreadId, path: cleanPath, meta, rawMode: false };
    if (nameEl && meta.name) nameEl.textContent = meta.name;
    if (pathEl) {
      const shown = meta.displayPath || cleanPath;
      pathEl.textContent = meta.startLine ? `${shown}#L${meta.startLine}` : shown;
    }
    if (metaEl) {
      const parts = [String(meta.language || meta.kind || "").toUpperCase(), formatByteSize(meta.size || 0)];
      if (meta.lineCount) parts.push(`${meta.lineCount} 行`);
      metaEl.textContent = parts.filter(Boolean).join(" · ");
      metaEl.hidden = false;
    }
    if (toggleBtn) {
      toggleBtn.hidden = meta.kind !== "markdown";
      toggleBtn.textContent = "源码";
    }
    if (copyBtn) {
      copyBtn.hidden = !meta.content;
      copyBtn.textContent = "复制";
    }
    renderFilePreviewBody(meta, { threadId: cleanThreadId, rawMode: false });
  } catch (error) {
    const msg = formatActionError(error, "读取文件失败");
    bodyEl.innerHTML = `<div class="file-preview-error">无法预览该文件：${escapeHtml(msg)}</div>`;
  }
}

function renderComposerControls() {
  const running = isActiveThreadRunning();
  const modeSelect = $("runningSubmitMode");
  modeSelect.hidden = !running;
  const sub = resolveComposerSubmission({
    hasActiveThread: Boolean(state.activeThreadId),
    isRunning: running,
    isSubmitting: state.isSubmitting,
    isEditingQueue: Boolean(activeEditingQueueItem()),
    mode: modeSelect.value,
    text: $("promptInput").value,
    imageCount: state.images.length,
  });
  const sendBtn = $("sendBtn");
  if ((state.imageProcessingCount > 0 || state.fileUploadingCount > 0) && !state.isSubmitting) {
    sendBtn.textContent = state.fileUploadingCount > 0 ? "上传文件…" : "处理图片…";
    sendBtn.disabled = true;
    sendBtn.setAttribute("aria-busy", "true");
  } else {
    sendBtn.textContent = sub.buttonLabel;
    sendBtn.disabled = !sub.canSubmit;
    sendBtn.setAttribute("aria-busy", state.isSubmitting ? "true" : "false");
  }
  const promptInput = $("promptInput");
  promptInput.readOnly = state.isSubmitting;
  promptInput.setAttribute(
    "enterkeyhint",
    isMobileTouchComposer() ? "enter" : (activeEditingQueueItem() ? "done" : "send"),
  );
  $("composerGoalBtn").setAttribute("aria-pressed", state.composerGoal ? "true" : "false");
  const imgBadge = $("imageCountBadge");
  if (imgBadge) {
    imgBadge.textContent = String(state.images.length || "");
    imgBadge.hidden = state.images.length === 0;
  }
  const holdImgBadge = $("holdImageCountBadge");
  if (holdImgBadge) {
    holdImgBadge.textContent = String(state.images.length || "");
    holdImgBadge.hidden = state.images.length === 0;
  }
  renderComposerDictationUi();
  renderComposerConfigChip();
  autoResizePromptInput();
  syncAllCustomSelects();
}

function closeSlashCommandMenu() {
  state.slashMenuOpen = false;
  state.slashManualOpen = false;
  state.slashTrigger = null;
  state.slashMenuItems = [];
  state.slashMenuIndex = 0;
  const menu = $("slashCommandMenu");
  if (menu) {
    menu.hidden = true;
    menu.innerHTML = "";
  }
  $("composerSlashBtn")?.setAttribute("aria-expanded", "false");
}

function renderSlashCommandMenu() {
  const menu = $("slashCommandMenu");
  if (!menu) return;
  if (!state.slashMenuOpen || !state.slashMenuItems.length) {
    menu.hidden = true;
    menu.innerHTML = "";
    $("composerSlashBtn")?.setAttribute("aria-expanded", "false");
    return;
  }
  menu.hidden = false;
  menu.innerHTML = renderSlashMenuHtml(state.slashMenuItems, state.slashMenuIndex);
  $("composerSlashBtn")?.setAttribute("aria-expanded", "true");
  const activeEl = menu.querySelector(".slash-command-item.is-active");
  activeEl?.scrollIntoView({ block: "nearest" });
}

async function fetchSlashCatalogForContext({ provider = "", cwd = "", query = "" } = {}) {
  const cleanProvider = String(provider || currentComposerProvider() || "antigravity").trim().toLowerCase();
  const cleanCwd = String(cwd || state.activeThread?.cwd || "").trim();
  const cleanQuery = String(query || "").trim();
  const key = `${cleanProvider}::${cleanCwd}::${cleanQuery}`;
  const cached = state.slashCatalogByKey.get(key);
  if (cached && (Date.now() - cached.at) < 15_000) {
    return cached.items;
  }
  const params = new URLSearchParams({ provider: cleanProvider });
  if (cleanCwd) params.set("cwd", cleanCwd);
  if (cleanQuery) params.set("q", cleanQuery);
  const res = await apiGet(`api/slash-commands?${params.toString()}`).catch(() => null);
  const items = Array.isArray(res?.items) ? res.items : [];
  if (items.length || !cleanQuery) {
    state.slashCatalogByKey.set(key, { at: Date.now(), items });
  }
  return items;
}

async function updateSlashCommandMenu({ manual = false } = {}) {
  const input = $("promptInput");
  if (!input) return;
  const text = input.value || "";
  const cursor = input.selectionStart ?? text.length;
  const trigger = parseSlashTrigger(text, cursor);

  if (!trigger && !manual && !state.slashManualOpen) {
    if (state.slashMenuOpen) closeSlashCommandMenu();
    return;
  }
  if (!trigger && state.slashManualOpen && text.trim()) {
    // Manual open while user continues typing non-slash text: close if cursor is not on a slash token.
    closeSlashCommandMenu();
    return;
  }

  state.slashTrigger = trigger;
  if (manual) state.slashManualOpen = true;
  const query = trigger?.query || "";
  const provider = currentComposerProvider();
  const cwd = state.activeThread?.cwd || "";
  const seq = ++state.slashFetchSeq;

  // Immediate render from pinned cache when available
  const pinnedCached = state.slashCatalogByKey.get(`${provider}::${cwd}::`)?.items;
  if (pinnedCached && pinnedCached.length) {
    const quick = filterSlashCommands(pinnedCached, query);
    if (quick.length) {
      state.slashMenuItems = quick;
      state.slashMenuIndex = 0;
      state.slashMenuOpen = true;
      renderSlashCommandMenu();
    }
  }

  const fetched = await fetchSlashCatalogForContext({ provider, cwd, query });
  if (seq !== state.slashFetchSeq) return;
  const finalItems = filterSlashCommands(fetched, query);
  if (!finalItems.length) {
    closeSlashCommandMenu();
    return;
  }
  state.slashMenuItems = finalItems;
  state.slashMenuIndex = 0;
  state.slashMenuOpen = true;
  renderSlashCommandMenu();
}

function applySlashMenuChoice(index) {
  const item = state.slashMenuItems[index];
  const input = $("promptInput");
  if (!item || !input) return;
  const applied = applySlashCommandSelection(input.value || "", item, state.slashTrigger);
  input.value = applied.text;
  closeSlashCommandMenu();
  renderComposerControls();
  input.focus();
  if (typeof input.setSelectionRange === "function") {
    input.setSelectionRange(applied.cursorPos, applied.cursorPos);
  }
}

function scrollViewportIfFollowing() {
  if (!state.autoFollow) return;
  const vp = $("messagesViewport");
  vp.scrollTop = vp.scrollHeight;
}

async function refreshProviders() {
  let resolvedProv = await apiGet("api/providers");
  let hasHealthMeta = Array.isArray(resolvedProv?.profiles)
    && resolvedProv.profiles.some((p) => p?.health && typeof p.health.status === "string");
  if (!hasHealthMeta) {
    try {
      const hotProv = await apiGet("apps/ac-hot/api/providers");
      if (Array.isArray(hotProv?.profiles) && hotProv.profiles.length) {
        resolvedProv = hotProv;
        state.useHotExtension = true;
        hasHealthMeta = resolvedProv.profiles.some((p) => p?.health && typeof p.health.status === "string");
      }
    } catch {
      // Main server already serves providers natively.
    }
  }
  state.providers = resolvedProv.providers || [];
  state.profiles = resolvedProv.profiles || [];
  const agyAvailable = state.profiles.find((p) => p.installed && !p.health?.disabled && p.provider === "antigravity" && p.id === "desktop")
    || state.profiles.find((p) => p.installed && !p.health?.disabled && p.provider === "antigravity");
  state.defaultProvider = resolvedProv.defaultProvider || "antigravity";
  if (!hasHealthMeta && agyAvailable) {
    state.defaultProvider = "antigravity";
    state.defaultProfileId = agyAvailable.id || "desktop";
  } else {
    state.defaultProfileId = resolvedProv.defaultProfileId || (state.defaultProvider === "antigravity" ? (agyAvailable?.id || "desktop") : "default");
  }
  if (resolvedProv.label) $("hostBadge").textContent = resolvedProv.label;
  state.cliStatus = resolvedProv.cliStatus || {};
  renderCliMaintenanceBanner();
  if (!hasSavedProviderTabsPref()) {
    state.hiddenProviderTabs = computeDefaultHiddenProviderTabs(state.profiles);
    state.providerFilter = visibleProviderFilter(state.providerFilter, state.hiddenProviderTabs);
  }
  syncProfileSelectors();
}

async function refreshModels() {
  const modelsRes = await apiGetWithHotFallback("api/models");
  state.allModels = modelsRes?.data || [];
  state.modelsByProvider = modelsRes?.byProvider || {};
  saveCachedModels(state.allModels, state.modelsByProvider);
  syncModelAndEffortSelectors();
  renderComposerControls();
}

async function refreshModelsForProfile(provider, profileId) {
  if (provider !== "claude" || !profileId) return;
  try {
    const res = await apiGetWithHotFallback(
      `api/models?provider=${encodeURIComponent(provider)}&profileId=${encodeURIComponent(profileId)}`,
    );
    const items = Array.isArray(res?.data) ? res.data : [];
    if (!items.length) return;
    state.modelsByProvider = {
      ...(state.modelsByProvider || {}),
      [provider]: items,
    };
    state.allModels = [
      ...(Array.isArray(state.allModels) ? state.allModels.filter((m) => m.provider !== provider) : []),
      ...items,
    ];
    saveCachedModels(state.allModels, state.modelsByProvider);
    syncModelAndEffortSelectors();
    syncNewModelSelect($("newModelSelect")?.value || "");
    syncAutomationModelAndEffortSelects($("autoModelSelect")?.value || "", $("autoEffortSelect")?.value || "");
    renderComposerControls();
  } catch {
    // Preserve existing model list if profile refresh fails.
  }
}

async function refreshProvidersAndModels() {
  await Promise.all([
    refreshProviders(),
    refreshModels(),
  ]);
}

function markThreadUnread(threadId, { status = "completed", summary = "", updatedAt = 0 } = {}) {
  if (!threadId) return;
  const entry = {
    status: status || "completed",
    summary: stripMarkdownForSpeech(summary || "", 80),
    at: Date.now(),
    updatedAt: Number(updatedAt) || Math.floor(Date.now() / 1000),
  };
  state.recentCompletedByThread.set(threadId, entry);
  threadReadState.unreadById[threadId] = entry;
  persistThreadReadState();
}

function markThreadRead(threadId, updatedAtSec = 0) {
  if (!threadId) return false;
  const hadUnread = state.recentCompletedByThread.has(threadId) || Boolean(threadReadState.unreadById[threadId]);
  state.recentCompletedByThread.delete(threadId);
  delete threadReadState.unreadById[threadId];
  const prevSeen = Number(threadReadState.seenById[threadId] || 0);
  const nextSeen = Math.max(Math.floor(Date.now() / 1000), Number(updatedAtSec) || 0, prevSeen);
  if (hadUnread || nextSeen > prevSeen) {
    threadReadState.seenById[threadId] = nextSeen;
    persistThreadReadState();
  }
  return hadUnread;
}

const lastNotifiedFailureByThread = new Map();

function notifyBackgroundThreadFailure(thread, errMsg = "") {
  const threadId = String(thread?.id || "").trim();
  if (!threadId) return;
  const rawErr = String(errMsg || thread?.lastError || "").trim();
  const compactMsg = compactThreadErrorSummary({ ...thread, lastError: rawErr });
  const errAt = Number(thread?.lastErrorAt || 0);
  const prev = lastNotifiedFailureByThread.get(threadId);
  const nowMs = Date.now();
  if (prev) {
    if (errAt > 0 && prev.errAt === errAt) return;
    if ((nowMs - prev.atMs) < 20_000) return;
  }
  lastNotifiedFailureByThread.set(threadId, { errAt: errAt || prev?.errAt || 0, atMs: nowMs });
  if (lastNotifiedFailureByThread.size > 200) {
    const oldestKey = lastNotifiedFailureByThread.keys().next().value;
    if (oldestKey !== undefined) lastNotifiedFailureByThread.delete(oldestKey);
  }
  const title = String(thread?.title || "后台任务").trim() || "后台任务";
  showToastBanner(`任务报错中断：${title}`, { detail: compactMsg, error: true });
  try {
    if (
      typeof Notification !== "undefined"
      && Notification.permission === "granted"
      && typeof document !== "undefined"
      && document.visibilityState === "hidden"
    ) {
      const notif = new Notification(`任务报错中断：${title}`, {
        body: compactMsg,
        tag: `ac-fail-${threadId}`,
      });
      notif.onclick = () => {
        try {
          window.focus();
          void selectThread(threadId, { preserveStatus: true });
        } catch {}
      };
    }
  } catch {}
}

function reconcileThreadStatusTrackers(prevThreads = [], nextThreads = []) {
  const prevById = new Map((Array.isArray(prevThreads) ? prevThreads : []).map((t) => [t.id, t]));
  const nowSec = Math.floor(Date.now() / 1000);
  const checkFailed = (item) => (
    typeof isThreadFailed === "function"
      ? isThreadFailed(item)
      : Boolean(item && !item.live && !(item.pendingCount > 0) && (item.lastTurnStatus === "failed" || String(item.lastError || "").trim()))
  );
  const formatErrSummary = (item) => (
    typeof compactThreadErrorSummary === "function"
      ? compactThreadErrorSummary(item)
      : String(item?.lastError || "执行报错中断").trim().slice(0, 88)
  );
  const isForegroundActive = (tid) => (
    tid === state.activeThreadId
    && !state.boardOpen
    && (typeof document === "undefined" || document.visibilityState !== "hidden")
  );
  let touched = false;

  for (const t of Array.isArray(nextThreads) ? nextThreads : []) {
    if (!t?.id) continue;
    const updatedAt = Number(t.updatedAt || 0);
    if (t.live) {
      if (state.recentCompletedByThread.delete(t.id) || threadReadState.unreadById[t.id]) {
        delete threadReadState.unreadById[t.id];
        touched = true;
      }
      const prevAct = state.liveActivityByThread.get(t.id) || {};
      if (t.livePhase || t.liveDetail) {
        const nextAct = mergeLiveActivity(prevAct, {
          status: "running",
          phase: t.livePhase || prevAct.phase || "",
          text: t.liveDetail ?? prevAct.text ?? "",
        });
        nextAct.isStreamingText = Boolean(prevAct.isStreamingText);
        state.liveActivityByThread.set(t.id, nextAct);
      } else if (!prevAct.status) {
        state.liveActivityByThread.set(t.id, { status: "running", phase: `${providerDisplayName(t.provider)} 执行中` });
      }
      continue;
    }

    state.liveActivityByThread.delete(t.id);
    const prev = prevById.get(t.id);
    const seenAt = Number(threadReadState.seenById[t.id] || 0);
    const finishedFromLive = Boolean(prev?.live);
    const updatedSincePrev = Boolean(prev && updatedAt > Number(prev.updatedAt || 0) && (!seenAt || updatedAt > seenAt));
    const updatedSinceSeen = Boolean(seenAt > 0 && updatedAt > seenAt);
    const freshOnInitialLoad = Boolean(
      !threadReadState.initialized
      && !seenAt
      && updatedAt > 0
      && (nowSec - updatedAt) <= 10 * 60,
    );
    const isFailed = checkFailed(t);
    const prevFailed = Boolean(prev && checkFailed(prev));
    const curErrAt = Number(t.lastErrorAt || 0);
    const prevErrAt = Number(prev?.lastErrorAt || 0);
    const newlyFailed = isFailed && (
      (prev && (!prevFailed || (curErrAt > 0 && curErrAt > prevErrAt)))
      || (!prev && prevById.size > 0 && updatedAt > 0 && (nowSec - updatedAt) <= 10 * 60)
    );

    if (finishedFromLive || updatedSincePrev || updatedSinceSeen || freshOnInitialLoad || newlyFailed) {
      if (isForegroundActive(t.id)) {
        markThreadRead(t.id, updatedAt);
      } else {
        const entry = {
          status: isFailed ? "failed" : "completed",
          summary: isFailed ? formatErrSummary(t) : stripMarkdownForSpeech(t.preview || "", 80),
          at: Date.now(),
          updatedAt: updatedAt || nowSec,
        };
        state.recentCompletedByThread.set(t.id, entry);
        threadReadState.unreadById[t.id] = entry;
        touched = true;
        if (newlyFailed && typeof notifyBackgroundThreadFailure === "function") {
          notifyBackgroundThreadFailure(t, t.lastError);
        }
      }
    } else if (!seenAt && updatedAt > 0) {
      threadReadState.seenById[t.id] = updatedAt;
      touched = true;
    }
  }

  if (!threadReadState.initialized && Array.isArray(nextThreads) && nextThreads.length > 0) {
    threadReadState.initialized = true;
    touched = true;
  }
  if (touched) {
    persistThreadReadState();
  }
}

let refreshThreadsPromise = null;
let refreshThreadsArchivedKey = "";

async function refreshThreads() {
  const archivedKey = state.showArchived ? "1" : "0";
  if (refreshThreadsPromise && refreshThreadsArchivedKey === archivedKey) {
    return refreshThreadsPromise;
  }
  const runPromise = (async () => {
    const res = await apiGet(`api/threads?archived=${archivedKey}`);
    if ((state.showArchived ? "1" : "0") !== archivedKey) return;
    const prevThreads = state.threads;
    state.threads = (res.threads || []).filter((t) => !isInternalVoiceThreadClient(t));
    if (!state.showArchived) {
      reconcileThreadStatusTrackers(prevThreads, state.threads);
    }
    if (state.pendingRequestsSynced) {
      syncThreadsPendingCounts();
    }
    state.projectsMeta = res.projectsMeta || state.projectsMeta || {};
    state.warnings = res.warnings || [];
    if (!state.showArchived) {
      saveCachedThreads(state.threads, state.projectsMeta);
    }
    pruneBatchSelection();
    if (String(state.sidebarSearchText || "").trim() && !isRemoteSearchAligned(state.sidebarRemoteSearch, state.sidebarSearchText)) {
      scheduleRemoteSearch("sidebar", state.sidebarSearchText, { immediate: true });
    }
    if (String(state.searchText || "").trim() && !isRemoteSearchAligned(state.boardRemoteSearch, state.searchText)) {
      scheduleRemoteSearch("board", state.searchText, { immediate: true });
    }
    renderThreadList();
    renderProjectBoard();
    renderProjectTaskStrip();
  })();
  refreshThreadsPromise = runPromise;
  refreshThreadsArchivedKey = archivedKey;
  try {
    return await runPromise;
  } finally {
    if (refreshThreadsPromise === runPromise) {
      refreshThreadsPromise = null;
      refreshThreadsArchivedKey = "";
    }
  }
}

function activeThreadLastTurnHasMatchingThought(thread, liveThought = "") {
  const cleanLive = String(liveThought || "").replace(/\s+/g, " ").trim();
  if (!cleanLive) return false;
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const lastTurn = turns[turns.length - 1];
  const items = Array.isArray(lastTurn?.items) ? lastTurn.items : [];
  const tail = cleanLive.slice(-60);
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i];
    if (it?.type !== "reasoning") continue;
    const raw = (
      (Array.isArray(it.content) && it.content.length ? it.content.join(" ") : "")
      || (Array.isArray(it.summary) && it.summary.length ? it.summary.join(" ") : "")
      || it.text
      || ""
    ).replace(/\s+/g, " ").trim();
    if (raw && (raw === cleanLive || (tail.length >= 16 && raw.includes(tail)))) return true;
  }
  return false;
}

function activeThreadLastTurnHasReasoning(thread) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const lastTurn = turns[turns.length - 1];
  if (!lastTurn || !Array.isArray(lastTurn.items)) return false;
  return lastTurn.items.some((it) => (
    it?.type === "reasoning"
    && Boolean(
      (Array.isArray(it.content) ? it.content.join("") : "")
      || (Array.isArray(it.summary) ? it.summary.join("") : "")
      || it.text
      || ""
    )
  ));
}

function activeThreadLastTurnHasFinalReply(thread) {
  const turns = Array.isArray(thread?.turns) ? thread.turns : [];
  const lastTurn = turns[turns.length - 1];
  const items = Array.isArray(lastTurn?.items) ? lastTurn.items : [];
  if (!items.length) return false;
  const lastItem = items[items.length - 1];
  return lastItem?.type === "agentMessage"
    && lastItem?.phase !== "commentary"
    && Boolean(String(lastItem?.text || "").trim());
}

function reconcileStreamingStateWithThread(thread, streamingPayload = null, activityPayload = null) {
  if (!thread?.live) {
    state.streamingText = "";
    state.streamingThought = "";
    state.streamingTurnId = "";
    return;
  }

  const incomingTurnId = String(streamingPayload?.turnId || activityPayload?.turnId || "").trim();
  if (incomingTurnId && state.streamingTurnId && incomingTurnId !== state.streamingTurnId) {
    state.streamingText = "";
    state.streamingThought = "";
  }
  if (incomingTurnId) {
    state.streamingTurnId = incomingTurnId;
  }

  if (streamingPayload && typeof streamingPayload === "object") {
    const serverText = String(streamingPayload.text || "");
    if (!serverText) {
      state.streamingText = "";
    } else if (!state.streamingText || incomingTurnId) {
      state.streamingText = serverText;
    }

    const lastTurnDone = activeThreadLastTurnHasFinalReply(thread);
    if (lastTurnDone) {
      state.streamingThought = "";
    } else if (!streamingPayload.thought && state.streamingThought && activeThreadLastTurnHasMatchingThought(thread, state.streamingThought)) {
      state.streamingThought = "";
    } else if (!state.streamingThought && streamingPayload.thought && !activeThreadLastTurnHasReasoning(thread)) {
      state.streamingThought = String(streamingPayload.thought);
    }
  }

  if (state.streamingText && isStreamingTextAlreadyPersisted(thread.turns, state.streamingText)) {
    state.streamingText = "";
  }
}

function mergeReloadedTurns(existingTurns, latestTurns) {
  const existing = Array.isArray(existingTurns) ? existingTurns : [];
  const latest = Array.isArray(latestTurns) ? latestTurns : [];
  if (!existing.length) return latest;
  if (!latest.length) return existing;
  // 匹配时需同时校验前缀与整段重叠，避免分叉会话存在重复 turn ID（如 agy-step-0）时反复拼接继承历史。
  const isEphemeralTurnId = (id) => {
    const clean = String(id || "");
    return clean.startsWith("optimistic-turn-") || /^(?:agy|claude|grok)-turn-/.test(clean);
  };
  let existingPersistedLen = existing.length;
  while (existingPersistedLen > 0 && isEphemeralTurnId(existing[existingPersistedLen - 1]?.id)) {
    existingPersistedLen -= 1;
  }
  const firstLatestId = latest[0]?.id;
  if (firstLatestId) {
    let bestEi = -1;
    let bestMatched = 0;
    for (let ei = existing.length - 1; ei >= 0; ei -= 1) {
      if (existing[ei]?.id !== firstLatestId) continue;
      if (ei + latest.length < existingPersistedLen) continue;
      const overlapLen = Math.min(existing.length - ei, latest.length);
      let valid = true;
      let matched = 0;
      for (let k = 0; k < overlapLen; k += 1) {
        const existingId = existing[ei + k]?.id;
        const latestId = latest[k]?.id;
        if (existingId && latestId && existingId === latestId) {
          matched += 1;
          continue;
        }
        if (isEphemeralTurnId(existingId)) {
          continue;
        }
        valid = false;
        break;
      }
      if (valid && matched > bestMatched) {
        bestMatched = matched;
        bestEi = ei;
      }
    }
    if (bestEi >= 0) {
      return [...existing.slice(0, bestEi), ...latest];
    }
  }
  // 从尾部向前匹配重叠起点，避免分叉继承历史或复用 turn ID 时从头部误删中间轮次。
  for (let li = 0; li < latest.length; li += 1) {
    const latestId = latest[li]?.id;
    if (!latestId) continue;
    for (let ei = existing.length - 1; ei >= 0; ei -= 1) {
      if (existing[ei]?.id === latestId) {
        return [...existing.slice(0, ei), ...latest];
      }
    }
  }
  return latest;
}

let activeThreadReloadInFlight = false;
let activeThreadReloadPromise = null;
let activeThreadReloadTimer = null;
let pendingReloadCompositeId = "";
let lastActiveThreadReloadDoneAt = 0;

function scheduleActiveThreadReload(compositeId, delayMs = 900) {
  if (!compositeId || compositeId !== state.activeThreadId) return;
  if (activeThreadReloadTimer) clearTimeout(activeThreadReloadTimer);
  activeThreadReloadTimer = setTimeout(() => {
    activeThreadReloadTimer = null;
    if (state.activeThreadId === compositeId) {
      void reloadActiveThreadProgress(compositeId);
    }
  }, delayMs);
}

async function reloadActiveThreadProgress(compositeId) {
  if (!compositeId || state.activeThreadId !== compositeId) return;
  if (activeThreadReloadInFlight) {
    pendingReloadCompositeId = compositeId;
    return activeThreadReloadPromise;
  }
  if (activeThreadReloadTimer) {
    clearTimeout(activeThreadReloadTimer);
    activeThreadReloadTimer = null;
  }
  pendingReloadCompositeId = "";
  activeThreadReloadInFlight = true;
  const runPromise = (async () => {
    try {
      const prevTurns = Array.isArray(state.activeThread?.turns) ? state.activeThread.turns : [];
      const prevTail = prevTurns.length ? prevTurns[prevTurns.length - 1] : null;
      const preserveFailedTail = state.liveActivity?.status === "failed" && prevTail?.status === "failed";
      const persistedPrevCount = prevTurns.filter((t) => t?.id && !String(t.id).startsWith("optimistic-turn-")).length;
      const useTailLimit = persistedPrevCount >= 2;
      let res = await fetchThreadRead(
        `api/thread?id=${encodeURIComponent(compositeId)}&limit=${useTailLimit ? 2 : 12}`,
        compositeId,
      );
      if (state.activeThreadId !== compositeId || !res?.thread) return;

      const prevIds = new Set(prevTurns.map((t) => t?.id).filter(Boolean));
      let latestTurns = Array.isArray(res.thread.turns) ? res.thread.turns : [];
      let hasIdOverlap = latestTurns.some((t) => t?.id && prevIds.has(t.id));
      if (useTailLimit && !hasIdOverlap && res.nextCursor) {
        res = await fetchThreadRead(
          `api/thread?id=${encodeURIComponent(compositeId)}&limit=12`,
          compositeId,
        );
        if (state.activeThreadId !== compositeId || !res?.thread) return;
        latestTurns = Array.isArray(res.thread.turns) ? res.thread.turns : [];
        hasIdOverlap = latestTurns.some((t) => t?.id && prevIds.has(t.id));
      }

      let mergedTurns = mergeReloadedTurns(state.activeThread?.turns, latestTurns);
      if (!res.thread.live && preserveFailedTail && prevTail) {
        const hasSameOrFailedTail = mergedTurns.some((t) => t?.id && t.id === prevTail.id)
          || mergedTurns[mergedTurns.length - 1]?.status === "failed";
        if (!hasSameOrFailedTail) {
          mergedTurns = [...mergedTurns, prevTail];
        }
      }
      state.activeThread = {
        ...res.thread,
        turns: mergedTurns,
      };
      if (!hasIdOverlap) {
        state.nextCursor = res.nextCursor || null;
      }
      if (res.activityCursor) state.activityCursor = res.activityCursor;
      state.queuedTurns = Array.isArray(res.queuedTurns) ? res.queuedTurns : (state.queuedTurns || []);
      if (state.activeThread) {
        state.activeThread.queuedCount = state.queuedTurns.length;
      }

      if (res.thread.live) {
        state.liveActivity = res.activity
          ? mergeLiveActivity(state.liveActivity, res.activity)
          : (state.liveActivity?.status === "running" ? state.liveActivity : { status: "running" });
        reconcileStreamingStateWithThread(state.activeThread, res.streaming || null, res.activity || null);
      } else {
        if (!preserveFailedTail) {
          state.liveActivity = { status: "completed" };
        }
        reconcileStreamingStateWithThread(state.activeThread, null, null);
      }

      const other = state.pendingRequests.filter((r) => r.threadId !== compositeId);
      state.pendingRequests = [...other, ...(res.pendingRequests || [])];
      state.pendingRequestsSynced = true;
      syncThreadsPendingCounts();
      syncThreadSummaryIntoList(state.activeThread);
      lastActiveThreadReloadDoneAt = Date.now();

      if (effectivePermissionModeForThread(compositeId, state.activeThread) === "turbo") {
        void autoApproveTurboRequestsForThread(compositeId);
      }

      renderThreadList();
      renderProjectBoard();
      renderProjectTaskStrip();
      renderTopbarAndControls();
      renderActiveMessages();
      renderPendingRequests();
      renderQueuedTurns();
    } catch {
      // Ignore transient polling/reload errors so background polling stays resilient.
    } finally {
      activeThreadReloadInFlight = false;
      activeThreadReloadPromise = null;
      const nextPendingId = pendingReloadCompositeId;
      pendingReloadCompositeId = "";
      if (nextPendingId && nextPendingId === state.activeThreadId) {
        scheduleActiveThreadReload(nextPendingId, 60);
      }
    }
  })();
  activeThreadReloadPromise = runPromise;
  return runPromise;
}

async function reloadActiveThreadAfterTurnCompletion({
  threadId = "",
  turnId = "",
  turnStatus = "completed",
  errorMessage = "",
  errorDetail = "",
  lastAgentMessage = "",
} = {}) {
  if (!threadId || state.activeThreadId !== threadId) return;
  const isFailed = turnStatus === "failed";
  const existingTurns = Array.isArray(state.activeThread?.turns) ? state.activeThread.turns : [];
  const tailTurn = existingTurns.length ? existingTurns[existingTurns.length - 1] : null;
  const matchingTurn = turnId
    ? [...existingTurns].reverse().find((t) => t?.id === turnId)
    : null;
  const failedTurnSnapshot = isFailed
    ? (matchingTurn || ((tailTurn && (tailTurn.status === "inProgress" || tailTurn.status === "running")) ? tailTurn : null))
    : null;

  const persistedCount = existingTurns.filter((t) => t?.id && !String(t.id).startsWith("optimistic-turn-")).length;
  if (state.activeThread?.id === threadId && persistedCount >= 2) {
    if (!isFailed) {
      clearComposerStatus();
    }
    if (activeThreadReloadPromise) {
      await activeThreadReloadPromise.catch(() => {});
    }
    if (state.activeThreadId !== threadId) return;
    await reloadActiveThreadProgress(threadId).catch(() => {});
    renderAgentTelemetryBar();
  } else {
    await selectThread(threadId, {
      focusScroll: state.autoFollow,
      preserveStatus: isFailed,
    }).catch(() => {});
  }

  if (!isFailed && state.activeThreadId === threadId && state.activeThread) {
    maybeSpeakCompletedTurnSummary({
      threadId,
      turnId,
      fallbackText: lastAgentMessage,
    });
  }

  if (!isFailed || state.activeThreadId !== threadId || !state.activeThread) return;
  state.liveActivity = { status: "failed", ...(turnId ? { turnId } : {}) };
  const turns = Array.isArray(state.activeThread.turns) ? state.activeThread.turns : [];
  const reloadedTail = turns.length ? turns[turns.length - 1] : null;
  if (failedTurnSnapshot) {
    const alreadySaved = turns.some((t) => t?.id && t.id === failedTurnSnapshot.id)
      || reloadedTail?.status === "failed";
    if (!alreadySaved) {
      state.activeThread.turns = [
        ...turns,
        {
          ...failedTurnSnapshot,
          status: "failed",
          error: {
            message: errorMessage || "执行失败",
            ...(errorDetail ? { detail: errorDetail } : {}),
          },
        },
      ];
      renderActiveMessages();
    }
  }
  renderLiveBanner();
}

function focusThreadInSidebar(threadId) {
  if (!threadId) return false;
  const listEl = $("threadList");
  if (!listEl) return false;
  const target = Array.from(listEl.querySelectorAll("[data-thread-id]")).find(
    (el) => el.dataset.threadId === threadId,
  );
  if (!target) return false;
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.classList.remove("is-focus-flash");
  void target.offsetWidth;
  target.classList.add("is-focus-flash");
  clearTimeout(target._focusFlashTimer);
  target._focusFlashTimer = setTimeout(() => {
    target.classList.remove("is-focus-flash");
  }, 1600);
  return true;
}

async function selectThread(compositeId, { focusScroll = true, preserveStatus = false, newThreadCwd = null } = {}) {
  const preserveTaskDraft = Boolean(arguments[1]?.preserveTaskDraft);
  const scrollToTurnId = String(arguments[1]?.scrollToTurnId || "");
  const scrollToTurnIndex = Number.isInteger(arguments[1]?.scrollToTurnIndex) ? arguments[1].scrollToTurnIndex : -1;
  const shouldFocusSidebar = Boolean(compositeId && (arguments[1]?.focusSidebar || state.boardOpen));
  closeCustomSelectMenu();
  if (!preserveTaskDraft && (compositeId || newThreadCwd === null)) {
    state.newThreadTaskDraft = null;
  }
  if (compositeId && (scrollToTurnId || (Number.isInteger(scrollToTurnIndex) && scrollToTurnIndex >= 0))) {
    state.pendingScrollToTurn = { threadId: compositeId, turnId: scrollToTurnId, turnIndex: scrollToTurnIndex };
  } else if (compositeId !== state.activeThreadId) {
    state.pendingScrollToTurn = null;
  }
  if (!preserveStatus) {
    clearComposerStatus();
  }
  if (activeThreadReloadTimer) {
    clearTimeout(activeThreadReloadTimer);
    activeThreadReloadTimer = null;
  }
  const prevThreadId = state.activeThreadId;
  const wasDifferentThread = compositeId !== prevThreadId;
  if (wasDifferentThread && state.editingQueueItem) {
    clearQueueEditState({ restoreDraft: state.editingQueueItem.threadId === prevThreadId });
  }
  if (wasDifferentThread) {
    closeSlashCommandMenu();
    state.composerGoal = false;
    stopChatReplySpeech();
    if (state.dictation.active || state.dictation.pointerDown) {
      state.dictation.pointerDown = false;
      void stopComposerDictation({ submit: false });
    }
  }
  state.activeThreadId = compositeId;
  if (compositeId !== prevThreadId) {
    state.queuedPanelCollapsed = false;
  }
  state.newThreadCwd = compositeId ? null : newThreadCwd;
  state.boardOpen = !compositeId && newThreadCwd === null;
  if (wasDifferentThread || newThreadCwd !== null) {
    exitSpriteOverlayForNavigation();
  }
  state.autoFollow = state.pendingScrollToTurn ? false : focusScroll;
  state.userPickedDraftModel = false;
  state.activityCursor = "";
  state.streamingText = "";
  state.streamingThought = "";
  state.streamingTurnId = "";
  lastActiveThreadReloadDoneAt = 0;

  const url = new URL(location.href);
  if (compositeId) url.searchParams.set("thread", compositeId);
  else url.searchParams.delete("thread");
  history.replaceState(null, "", url.toString());

  if (!compositeId) {
    state.initialThreadLoading = false;
    state.activeThread = null;
    state.nextCursor = null;
    state.liveActivity = null;
    state.queuedTurns = [];
    syncProfileSelectors();
    syncModelAndEffortSelectors();
    renderThreadList();
    renderTopbarAndControls();
    renderAgentTelemetryBar();
    renderActiveMessages();
    renderPendingRequests();
    renderQueuedTurns();
    return;
  }

  const cachedSummary = state.threads.find((t) => t.id === compositeId);
  const clearedUnreadOnOpen = markThreadRead(compositeId, cachedSummary?.updatedAt || 0);
  if (cachedSummary?.cwd) {
    if (shouldFocusSidebar) state.collapsedGroups?.delete?.(cachedSummary.cwd);
    setSidebarGroupManualPref(cachedSummary.cwd, "expand");
  }
  if (shouldFocusSidebar && state.providerFilter && state.providerFilter !== "all" && cachedSummary?.provider && state.providerFilter !== cachedSummary.provider) {
    state.providerFilter = "all";
    renderProviderTabs();
    syncProfileSelectors();
  }

  const isSwitchingThread = compositeId !== prevThreadId || !state.activeThread;
  if (!isSwitchingThread && (clearedUnreadOnOpen || shouldFocusSidebar)) {
    renderThreadList();
  }
  if (isSwitchingThread) {
    resetTurnListRenderCache();
    resetDeferredImageObserver({ resetRevealed: false });
    state.activeThread = null;
    state.nextCursor = null;
    state.queuedTurns = [];
    state.liveActivity = cachedSummary?.live ? { status: "running" } : null;
    state.initialThreadLoading = true;
    const turnListEl = $("turnList");
    if (turnListEl) {
      turnListEl.hidden = false;
      turnListEl.innerHTML = `<div class="empty-state" style="text-align:center;color:var(--text-muted);">正在加载会话…</div>`;
    }
    syncProfileSelectors();
    syncModelAndEffortSelectors();
    renderThreadList();
    renderTopbarAndControls();
    renderActiveMessages();
    renderPendingRequests();
    renderQueuedTurns();
    setSidebarOpen(false);
  }
  if (shouldFocusSidebar) {
    requestAnimationFrame(() => {
      if (!focusThreadInSidebar(compositeId) && state.sidebarSearchText) {
        state.sidebarSearchText = "";
        scheduleRemoteSearch("sidebar", "");
        const searchInput = $("sidebarSearchInput");
        if (searchInput) searchInput.value = "";
        const clearBtn = $("sidebarSearchClearBtn");
        if (clearBtn) clearBtn.hidden = true;
        renderThreadList();
        requestAnimationFrame(() => focusThreadInSidebar(compositeId));
      }
    });
  }

  let res;
  try {
    res = await fetchThreadRead(
      `api/thread?id=${encodeURIComponent(compositeId)}&limit=12`,
      compositeId,
    );
  } finally {
    if (state.activeThreadId === compositeId && isSwitchingThread) {
      state.initialThreadLoading = false;
    }
  }
  if (state.activeThreadId !== compositeId) return;
  lastActiveThreadReloadDoneAt = Date.now();
  state.activeThread = res.thread;
  if (wasDifferentThread && !res.thread?.live) {
    syncCurrentThreadSpokenBaseline(state.activeThread);
  }
  state.nextCursor = res.nextCursor || null;
  state.activityCursor = res.activityCursor || "";
  state.liveActivity = res.activity || (res.thread?.live ? { status: "running" } : null);
  state.queuedTurns = Array.isArray(res.queuedTurns) ? res.queuedTurns : [];
  if (state.activeThread) {
    state.activeThread.queuedCount = state.queuedTurns.length;
  }

  reconcileStreamingStateWithThread(state.activeThread, res.streaming || null, res.activity || null);

  // Merge thread-level pending requests into global state.
  const other = state.pendingRequests.filter((r) => r.threadId !== compositeId);
  state.pendingRequests = [...other, ...(res.pendingRequests || [])];
  state.pendingRequestsSynced = true;
  syncThreadsPendingCounts();
  syncThreadSummaryIntoList(res.thread);
  markThreadRead(compositeId, res.thread?.updatedAt || 0);
  if (res.thread?.cwd) {
    setSidebarGroupManualPref(res.thread.cwd, "expand");
  }

  syncProfileSelectors();
  syncModelAndEffortSelectors();
  if (effectivePermissionModeForThread(compositeId, state.activeThread) === "turbo") {
    void autoApproveTurboRequestsForThread(compositeId).then((count) => {
      if (count > 0) {
        setComposerStatus("success", "已按 Turbo 模式自动批准待确认操作", { autoClearMs: 3000 });
      }
    });
  }
  renderThreadList();
  renderProjectBoard();
  renderProjectTaskStrip();
  renderTopbarAndControls();
  renderAgentTelemetryBar();
  renderActiveMessages();
  renderPendingRequests();
  renderQueuedTurns();
  setSidebarOpen(false);
}

async function loadOlderMessages() {
  if (!state.activeThreadId || !state.nextCursor) return;
  const vp = $("messagesViewport");
  const prevHeight = vp.scrollHeight;
  const res = await fetchThreadRead(
    `api/thread?id=${encodeURIComponent(state.activeThreadId)}&cursor=${encodeURIComponent(state.nextCursor)}&limit=25`,
    state.activeThreadId,
  );
  const olderTurns = res.thread?.turns || [];
  state.activeThread.turns = [...olderTurns, ...(state.activeThread.turns || [])];
  state.nextCursor = res.nextCursor || null;
  state.autoFollow = false;
  renderActiveMessages();
  vp.scrollTop = vp.scrollHeight - prevHeight;
}

async function copyTextToClipboard(text) {
  const value = String(text || "");
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

async function handleSend({ overrideText = null, clearDraft = true, forceGoal = false, includeComposerImages = false } = {}) {
  if (state.isSubmitting) return;
  if (state.imageProcessingCount > 0) {
    setComposerStatus("error", "图片正在压缩处理中，请稍候再发送", { autoClearMs: 2500 });
    return;
  }
  if (state.fileUploadingCount > 0) {
    setComposerStatus("error", "文件正在上传中，请稍候再发送", { autoClearMs: 2500 });
    return;
  }
  if (state.chatTts.enabled) {
    unlockChatReplySpeechAudio();
  }
  const input = $("promptInput");
  const isOverride = typeof overrideText === "string";
  const useLiveImages = !isOverride || includeComposerImages;
  const rawText = isOverride ? overrideText : input.value;
  const { hasDirective, cleanedText } = extractGoalDirective(rawText);
  const goalMode = Boolean(forceGoal || state.composerGoal || hasDirective);
  const text = hasDirective && cleanedText ? rawText : rawText;

  const running = isActiveThreadRunning();
  const editingQueue = !isOverride ? activeEditingQueueItem() : null;
  const sub = resolveComposerSubmission({
    hasActiveThread: Boolean(state.activeThreadId),
    isRunning: running,
    isSubmitting: false,
    isEditingQueue: Boolean(editingQueue),
    mode: $("runningSubmitMode").value,
    text,
    imageCount: useLiveImages ? state.images.length : 0,
  });
  if (!sub.canSubmit) {
    setComposerStatus("error", "请输入指令或添加图片后再发送", { autoClearMs: 2500 });
    return;
  }

  const savedImages = useLiveImages ? [...state.images] : [];
  const cleanImages = savedImages.map((img, idx) => ({
    name: img?.name || `image-${idx + 1}.jpg`,
    dataUrl: img?.dataUrl || "",
  })).filter((img) => Boolean(img.dataUrl));
  const requestTimeoutMs = cleanImages.length ? 60_000 : 35_000;
  const model = $("modelSelect").value || "";
  const effort = $("effortSelect").hidden ? "" : ($("effortSelect").value || "");
  const permissionMode = normalizeUiPermissionMode($("permissionSelect").value || state.defaultPermissionMode || "turbo", "turbo");
  state.defaultPermissionMode = saveDefaultPermissionMode(permissionMode);
  if (state.activeThreadId) {
    saveLocalThreadPrefs(state.activeThreadId, { model, effort, permissionMode });
  }

  const resetDraftIfNeeded = () => {
    if (clearDraft) {
      input.value = "";
      state.images = [];
      renderComposerImages();
      return;
    }
    if (includeComposerImages && state.images.length) {
      state.images = [];
      renderComposerImages();
    }
  };

  state.isSubmitting = true;
  state.autoFollow = true;
  setComposerConfigOpen(false);
  setTopbarMenuOpen(false);
  setComposerStatus(
    "pending",
    sub.action === "new"
      ? "正在创建会话并发送指令…"
      : (sub.action === "update_queue" ? "正在保存排队消息…" : "正在发送指令…"),
  );
  renderComposerControls();

  try {
    if (sub.action === "new") {
      const provider = currentComposerProvider();
      const profileId = currentComposerProfileId();
      const draftTask = state.newThreadTaskDraft;
      const created = await apiPost("api/thread/new", {
        provider,
        profileId,
        text,
        images: cleanImages,
        cwd: state.newThreadCwd || "",
        model,
        effort,
        permissionMode,
        goalMode,
        ...(draftTask ? {
          taskId: draftTask.taskId || "",
          parentTaskId: draftTask.parentTaskId || "",
          sourceThreadId: draftTask.sourceThreadId || "",
          taskTitle: draftTask.taskTitle || "",
          taskMode: draftTask.mode || "",
        } : {}),
      }, { timeoutMs: requestTimeoutMs });
      state.newThreadTaskDraft = null;
      saveNewThreadPrefs(provider, { model, effort });
      resetDraftIfNeeded();
      state.composerGoal = false;
      await Promise.all([
        refreshThreads(),
        draftTask ? refreshTasks() : Promise.resolve(),
      ]);
      if (created?.thread?.id) {
        saveLocalThreadPrefs(created.thread.id, { model, effort, permissionMode });
        await selectThread(created.thread.id);
      }
      setComposerStatus("success", "会话已创建并发送指令", { autoClearMs: 3000 });
      return;
    }

    if (sub.action === "update_queue" && editingQueue) {
      const updated = await apiPost("api/thread/queue/update", {
        threadId: state.activeThreadId,
        id: editingQueue.id,
        text,
        images: cleanImages,
        model,
        effort,
        permissionMode,
        goalMode,
      }, { timeoutMs: requestTimeoutMs });
      state.editingQueueItem = null;
      resetDraftIfNeeded();
      state.composerGoal = false;
      renderComposerEditBanner();
      applyActiveQueuedTurns(state.activeThreadId, updated.items || state.queuedTurns);
      renderQueuedTurns();
      renderComposerControls();
      setComposerStatus("success", "已更新排队消息（保留原排位）", { autoClearMs: 3000 });
      showToastBanner("已更新排队消息", { detail: text ? text.slice(0, 60) : `${cleanImages.length} 张图片` });
      return;
    }

    const submitted = await submitComposerRequest(apiPost, {
      action: sub.action,
      payload: {
        threadId: state.activeThreadId,
        text,
        images: cleanImages,
        model,
        effort,
        permissionMode,
        goalMode,
        expectedTurnId: state.liveActivity?.turnId || "",
      },
      options: { timeoutMs: requestTimeoutMs },
    });
    if (submitted.action === "queue") {
      const qRes = submitted.result;
      resetDraftIfNeeded();
      state.composerGoal = false;
      applyActiveQueuedTurns(state.activeThreadId, qRes.items || state.queuedTurns);
      renderQueuedTurns();
      setComposerStatus("success", "已加入排队，等待当前轮次完成后发送", { autoClearMs: 3000 });
      showToastBanner("已加入排队", { detail: text.slice(0, 60) });
      return;
    }

    const turnRes = submitted.result;
    resetDraftIfNeeded();
    state.composerGoal = false;
    if (turnRes?.redirectedThreadId && turnRes.redirectedThreadId !== state.activeThreadId) {
      const nextThreadId = turnRes.redirectedThreadId;
      saveLocalThreadPrefs(nextThreadId, { model, effort, permissionMode });
      state.threads = state.threads.filter((t) => t.id !== state.activeThreadId);
      state.activeThreadId = nextThreadId;
      if (state.activeThread) {
        state.activeThread.id = nextThreadId;
        state.activeThread.isForkDraft = false;
      }
      if (turnRes.thread) syncThreadSummaryIntoList(turnRes.thread);
    }
    const autoCompactGrowthK = turnRes?.autoCompact
      ? Math.max(1, Math.round((Number(turnRes.autoCompact.growthTokens) || 0) / 1000))
      : 0;
    if (state.activeThread) {
      const optimisticTurnId = turnRes?.turn?.id || turnRes?.turnId || `optimistic-turn-${Date.now()}`;
      const userContent = [
        ...cleanImages.map((img) => ({ type: "image", name: img.name || "", url: img.dataUrl })),
        ...(String(text || "").trim() ? [{ type: "text", text }] : []),
      ];
      if (!Array.isArray(state.activeThread.turns)) state.activeThread.turns = [];
      const tailTurn = state.activeThread.turns[state.activeThread.turns.length - 1];
      if (sub.action === "steer" && tailTurn && (tailTurn.status === "inProgress" || tailTurn.status === "running")) {
        tailTurn.items = [
          ...(Array.isArray(tailTurn.items) ? tailTurn.items : []),
          { type: "userMessage", id: `user-steer-${Date.now()}`, content: userContent },
        ];
      } else {
        state.streamingText = "";
        state.streamingThought = "";
        state.streamingTurnId = optimisticTurnId;
        if (tailTurn?.id !== optimisticTurnId) {
          state.activeThread.turns.push({
            id: optimisticTurnId,
            status: "inProgress",
            startedAt: Math.floor(Date.now() / 1000),
            items: [{ type: "userMessage", id: `user-${optimisticTurnId}`, content: userContent }],
          });
        }
      }
      if (turnRes?.thread?.title) {
        state.activeThread.title = turnRes.thread.title;
        state.activeThread.name = turnRes.thread.name || turnRes.thread.title;
      }
      state.activeThread.live = true;
      syncThreadSummaryIntoList({
        id: state.activeThreadId,
        live: true,
        ...(turnRes?.thread?.title ? { title: turnRes.thread.title, name: turnRes.thread.name || turnRes.thread.title } : {}),
      });
      state.liveActivity = mergeLiveActivity(state.liveActivity, {
        turnId: optimisticTurnId,
        status: "running",
        phase: turnRes?.autoCompact
          ? `自动压缩上下文（已增长 ~${autoCompactGrowthK}K）…`
          : `${providerDisplayName(state.activeThread.provider)} 执行中`,
      });
      renderThreadList();
      renderTopbarAndControls();
      renderActiveMessages();
    }
    scheduleActiveThreadReload(state.activeThreadId, 450);
    if (turnRes?.autoCompact) {
      const thresholdK = Math.max(1, Math.round((Number(turnRes.autoCompact.thresholdTokens) || 60000) / 1000));
      setComposerStatus("pending", `上下文增长超过 ${thresholdK}K，正先 /compact 压缩后继续执行…`, { autoClearMs: 5000 });
      showToastBanner("自动压缩上下文", {
        detail: `已增长 ~${autoCompactGrowthK}K tokens，压缩完成后自动续发`,
      });
    } else {
      setComposerStatus(
        "success",
        sub.action === "steer" ? "插话引导已发送" : "指令已发送，等待响应…",
        { autoClearMs: 2800 },
      );
    }
  } catch (error) {
    input.value = rawText;
    state.images = savedImages;
    renderComposerImages();
    const errMsg = formatActionError(error, "请求发送失败");
    const errStatus = Number(error?.status || 0);
    const errCode = String(error?.code || "");
    if (sub.action === "update_queue" && (errStatus === 404 || errCode === "queued_turn_not_found")) {
      state.editingQueueItem = null;
      renderComposerEditBanner();
      renderQueuedTurns();
      setComposerStatus("info", "原排队消息已自动发送或取消，当前编辑内容已保留在输入框", { autoClearMs: 5000 });
      return;
    }
    const isBusyConflict = errStatus === 409
      || errCode === "thread_busy"
      || errCode === "writer_conflict"
      || errCode === "codex_app_running"
      || /already has an active writer|\bactive writer\b|正在运行|占用/.test(errMsg);
    const isArchivedError = errCode === "thread_archived"
      || /\bis archived\b|codex unarchive\b|已在 Codex 中归档|先解除归档/i.test(errMsg);
    if (isArchivedError && state.activeThreadId && state.activeThread && !state.activeThread.archived) {
      state.activeThread.archived = true;
      renderTopbarAndControls();
    }
    const failedProvider = state.activeThread?.provider || currentComposerProvider();
    const failedProfileId = state.activeThread?.profileId || currentComposerProfileId();
    if (failedProvider === "codex" && failedProfileId && isCodexOfficialClientErrorText(errMsg)) {
      state.codexExecSuggestedProfiles.add(failedProfileId);
      renderCodexCompatBanner();
    }
    const altProfile = (!isBusyConflict && !isArchivedError)
      ? findFailoverCandidateProfile(state.profiles, failedProvider, failedProfileId)
      : null;
    const failoverContext = altProfile ? {
      provider: failedProvider,
      altProfile,
      cwd: state.activeThread?.cwd || state.newThreadCwd || "",
      text,
      images: savedImages,
      model,
      effort,
      permissionMode,
      goalMode,
    } : null;
    const unarchiveContext = (isArchivedError && state.activeThreadId)
      ? { threadId: state.activeThreadId }
      : null;
    setComposerStatus("error", `发送失败：${errMsg}`, { failoverContext, unarchiveContext });
    showToastBanner("发送失败", { detail: errMsg, error: true });
    void refreshProvidersAndModels().catch(() => {});
  } finally {
    state.isSubmitting = false;
    renderComposerControls();
  }
}

async function unarchiveThreadAndOptionallyResend(threadId, { retrySend = false } = {}) {
  if (!threadId || state.unarchivingThreadId) return;
  state.unarchivingThreadId = threadId;
  renderComposerArchivedBanner();
  setComposerStatus("pending", retrySend ? "正在解除归档并重新发送…" : "正在解除归档…");
  try {
    await apiPost("api/thread/archive", { threadId, archived: false });
    if (state.activeThread?.id === threadId) {
      state.activeThread.archived = false;
    }
    const item = state.threads.find((t) => t.id === threadId);
    if (item) item.archived = false;
    state.unarchivingThreadId = "";
    renderTopbarAndControls();
    renderComposerArchivedBanner();
    void refreshThreads().catch(() => {});
    if (retrySend) {
      clearComposerStatus();
      await handleSend();
    } else {
      setComposerStatus("success", "已解除归档，可以继续发送消息", { autoClearMs: 3200 });
      showToastBanner("已解除归档");
    }
  } catch (error) {
    state.unarchivingThreadId = "";
    renderComposerArchivedBanner();
    const errMsg = formatActionError(error, "解除归档失败");
    setComposerStatus("error", `解除归档失败：${errMsg}`);
    showToastBanner("解除归档失败", { detail: errMsg, error: true });
  }
}

function buildFailoverContextForProvider(provider, failedProfileId, overrideText = "") {
  const altProfile = findFailoverCandidateProfile(state.profiles, provider, failedProfileId);
  if (!altProfile) return null;
  return {
    provider,
    altProfile,
    cwd: state.activeThread?.cwd || "",
    text: overrideText || $("promptInput")?.value || "",
    images: [...(state.images || [])],
    model: $("modelSelect")?.value || "",
    effort: $("effortSelect")?.hidden ? "" : ($("effortSelect")?.value || ""),
    permissionMode: normalizeUiPermissionMode($("permissionSelect")?.value || state.defaultPermissionMode || "turbo", "turbo"),
    goalMode: Boolean(state.composerGoal),
  };
}

function applyProfileSnapshotPayload(payload = {}) {
  if (Array.isArray(payload.providers)) state.providers = payload.providers;
  if (Array.isArray(payload.profiles)) state.profiles = payload.profiles;
  if (payload.defaultProvider) state.defaultProvider = payload.defaultProvider;
  if (payload.defaultProfileId) state.defaultProfileId = payload.defaultProfileId;
  if (payload.cliStatus && typeof payload.cliStatus === "object") {
    state.cliStatus = payload.cliStatus;
    renderCliMaintenanceBanner();
  }
  if (!hasSavedProviderTabsPref()) {
    state.hiddenProviderTabs = computeDefaultHiddenProviderTabs(state.profiles);
    state.providerFilter = visibleProviderFilter(state.providerFilter, state.hiddenProviderTabs);
  }
  syncProfileSelectors();
  renderTopbarAndControls();
  renderThreadList();
  renderInstanceManagerModal();
}

async function relayThreadWithProfile(altProfile, context = {}) {
  if (!altProfile?.id || !altProfile?.provider) return;
  const text = String(context.text ?? $("promptInput")?.value ?? "");
  const savedImages = Array.isArray(context.images) ? context.images : [...state.images];
  const cleanImages = savedImages.map((img, idx) => ({
    name: img?.name || `image-${idx + 1}.jpg`,
    dataUrl: img?.dataUrl || "",
  })).filter((img) => Boolean(img.dataUrl));
  const model = context.model ?? ($("modelSelect")?.value || "");
  const effort = context.effort ?? ($("effortSelect")?.hidden ? "" : ($("effortSelect")?.value || ""));
  const permissionMode = normalizeUiPermissionMode(
    context.permissionMode || $("permissionSelect")?.value || state.defaultPermissionMode || "turbo",
    "turbo",
  );
  const goalMode = Boolean(context.goalMode ?? state.composerGoal);
  const cwd = context.cwd || state.activeThread?.cwd || state.newThreadCwd || "";

  setComposerConfigOpen(false);
  if (!text.trim() && !cleanImages.length) {
    await openNewThreadModal({
      cwd,
      provider: altProfile.provider,
      model,
    });
    const newSelect = $("composerProfileSelect");
    if (newSelect && [...newSelect.options].some((o) => o.value === altProfile.id)) {
      newSelect.value = altProfile.id;
      syncComposerProfileSelect();
    }
    setComposerStatus("success", `已切换到 ${altProfile.label || altProfile.id}，输入指令即可在同目录开始`, { autoClearMs: 3200 });
    return;
  }

  state.isSubmitting = true;
  setComposerStatus("pending", `正在切到 ${altProfile.label || altProfile.id} 继续执行…`);
  renderComposerControls();
  try {
    const created = await apiPost("api/thread/new", {
      provider: altProfile.provider,
      profileId: altProfile.id,
      cwd,
      text,
      images: cleanImages,
      model,
      effort,
      permissionMode,
      goalMode,
    }, { timeoutMs: cleanImages.length ? 60_000 : 35_000 });
    if ($("promptInput")) $("promptInput").value = "";
    state.images = [];
    renderComposerImages();
    await refreshThreads();
    if (created?.thread?.id) {
      saveLocalThreadPrefs(created.thread.id, { model, effort, permissionMode });
      await selectThread(created.thread.id);
    }
    setComposerStatus("success", `已切到 ${altProfile.label || altProfile.id} 继续执行`, { autoClearMs: 3200 });
  } catch (error) {
    const errMsg = formatActionError(error, "切换实例继续失败");
    setComposerStatus("error", `切换失败：${errMsg}`);
    showToastBanner("切换实例失败", { detail: errMsg, error: true });
  } finally {
    state.isSubmitting = false;
    renderComposerControls();
  }
}

async function triggerProfileProbe({ provider, profileId = "" } = {}) {
  const cleanProvider = String(provider || "").trim();
  if (!cleanProvider) return;
  const targets = filterProfilesByProvider(state.profiles, cleanProvider)
    .filter((p) => !profileId || p.id === profileId);
  const addedKeys = targets.map((p) => p.key || `${cleanProvider}:${p.id}`);
  if (!addedKeys.length && profileId) addedKeys.push(`${cleanProvider}:${profileId}`);
  for (const key of addedKeys) state.probingProfileKeys.add(key);
  syncComposerProfileSelect();
  syncNewProviderPills();
  syncNewProfileSelect();

  try {
    const res = await apiPostWithHotFallback("api/profile/probe", {
      provider: cleanProvider,
      profileId,
    });
    applyProfileSnapshotPayload(res);
    const results = Array.isArray(res.results) ? res.results : [];
    const okCount = results.filter((r) => r.ok).length;
    const summary = results.length === 1
      ? (results[0].ok
        ? `测通成功 (${results[0].latencyMs ? `${results[0].latencyMs}ms` : "可用"})`
        : `测通失败：${results[0].error || "暂不可用"}`)
      : `${providerDisplayName(cleanProvider)} 测通完成：${okCount}/${results.length} 个可用`;
    setComposerStatus(okCount > 0 ? "success" : "error", summary, { autoClearMs: 3500 });
  } catch (error) {
    // 兼容尚未重启的旧版本地守护进程（/api/profile/probe 返回 404 时降级用 GET /api/models 探测）。
    if (error?.status === 404) {
      let okCount = 0;
      const nowSec = Math.floor(Date.now() / 1000);
      for (const target of targets) {
        const started = Date.now();
        try {
          await apiGet(`api/models?provider=${encodeURIComponent(cleanProvider)}&profileId=${encodeURIComponent(target.id)}`);
          okCount += 1;
          target.health = {
            ...(target.health || {}),
            status: "healthy",
            shortReason: "",
            detail: "",
            latencyMs: Math.max(1, Date.now() - started),
            checkedAt: nowSec,
          };
        } catch (err) {
          target.health = {
            ...(target.health || {}),
            status: "unavailable",
            shortReason: /429|limit|quota/i.test(err?.message || "") ? "限额冷却" : "暂不可用",
            detail: err?.message || "检测失败",
            latencyMs: null,
            checkedAt: nowSec,
          };
        }
      }
      syncProfileSelectors();
      setComposerStatus(
        okCount > 0 ? "success" : "error",
        `已实时校验模型列表 (${okCount}/${targets.length} 可用)；重载 Mac 守护进程后可启用完整 Claude 测通与状态持久化`,
        { autoClearMs: 4200 },
      );
      return;
    }
    const errMsg = formatActionError(error, "测通失败");
    setComposerStatus("error", `测通失败：${errMsg}`);
  } finally {
    for (const key of addedKeys) state.probingProfileKeys.delete(key);
    syncComposerProfileSelect();
    syncNewProfileSelect();
  }
}

async function toggleProfileDisabled({ provider, profileId, disabled } = {}) {
  try {
    const res = await apiPostWithHotFallback("api/profile/meta", {
      provider,
      profileId,
      disabled: Boolean(disabled),
    });
    applyProfileSnapshotPayload(res);
    setComposerStatus("success", disabled ? "已停用该实例" : "已重新启用该实例", { autoClearMs: 2200 });
  } catch (error) {
    setComposerStatus("error", `更新实例状态失败：${formatActionError(error)}`);
  }
}

async function toggleCodexExecMode(profileId, enabled) {
  const cleanId = String(profileId || "").trim();
  if (!cleanId) return;
  const key = `codex:${cleanId}`;
  if (state.codexExecTogglingProfileKey === key) return;
  state.codexExecTogglingProfileKey = key;
  renderCodexCompatBanner();
  try {
    const res = await apiPost("api/profile/meta", {
      provider: "codex",
      profileId: cleanId,
      codexExecMode: Boolean(enabled),
    });
    state.codexExecTogglingProfileKey = "";
    applyProfileSnapshotPayload(res);
    if (enabled) {
      showToastBanner("已开启原生 codex exec 兼容模式", {
        detail: "请重新发送重试；如当前旧会话仍 403，请点顶部「新会话重试」新开会话",
      });
    } else {
      showToastBanner("已切回默认 Codex app-server 模式");
    }
  } catch (error) {
    state.codexExecTogglingProfileKey = "";
    renderCodexCompatBanner();
    showToastBanner("切换兼容模式失败", { detail: formatActionError(error), error: true });
  }
}

async function startNewCodexExecThreadFromActive(profileId) {
  const cleanId = String(profileId || "").trim();
  const thread = state.activeThread;
  const cwd = thread?.cwd || state.newThreadCwd || "";
  const model = thread?.model || "";
  let promptText = String($("promptInput")?.value || "").trim();
  if (!promptText && Array.isArray(thread?.turns) && thread.turns.length) {
    const failedTurn = [...thread.turns].reverse().find((t) => t?.status === "failed");
    const targetTurn = failedTurn || thread.turns[thread.turns.length - 1];
    const userItem = (targetTurn?.items || []).find((item) => item?.type === "userMessage");
    if (userItem) {
      if (Array.isArray(userItem.content)) {
        promptText = userItem.content
          .map((part) => (typeof part?.text === "string" ? part.text : ""))
          .filter(Boolean)
          .join("\n")
          .trim();
      } else if (typeof userItem.text === "string") {
        promptText = userItem.text.trim();
      }
    }
  }
  await openNewThreadModal({
    cwd,
    provider: "codex",
    model,
    promptText,
  });
  if (cleanId) {
    const sel = $("composerProfileSelect");
    if (sel && [...sel.options].some((o) => o.value === cleanId)) {
      sel.value = cleanId;
      syncComposerProfileSelect();
    }
  }
  showToastBanner("已切换到 codex exec 新会话", {
    detail: promptText ? "已带入待发内容，直接发送即可" : "直接输入内容发送即可",
  });
}

function dismissCodexCompatBanner(profileId) {
  const cleanId = String(profileId || "").trim();
  if (!cleanId) return;
  state.codexExecSuggestedProfiles.delete(cleanId);
  renderCodexCompatBanner();
  void apiPost("api/profile/meta", {
    provider: "codex",
    profileId: cleanId,
    codexExecSuggested: false,
  }).then((res) => applyProfileSnapshotPayload(res)).catch(() => {});
}

function renderInstanceLoginGuide(guide = null) {
  const box = $("instLoginGuide");
  if (!box) return;
  if (!guide) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const authUrl = String(guide.authUrl || "").trim();
  const cmd = String(guide.loginCommand || "").trim();
  const title = guide.title || "登录引导";
  const detail = guide.detail || "";
  box.hidden = false;
  box.innerHTML = `
    <div><strong>${escapeHtml(title)}</strong>${detail ? ` — ${escapeHtml(detail)}` : ""}</div>
    ${cmd ? `<code class="inst-login-guide-cmd">${escapeHtml(cmd)}</code>` : ""}
    <div class="inst-login-guide-actions">
      ${authUrl ? `<a class="btn-primary btn-xs" href="${escapeHtml(authUrl)}" target="_blank" rel="noopener noreferrer">打开登录页</a>` : ""}
      ${authUrl ? `<button type="button" class="btn-secondary btn-xs" data-copy-login-cmd="${escapeHtml(authUrl)}">复制登录链接</button>` : ""}
      ${cmd ? `<button type="button" class="btn-secondary btn-xs" data-copy-login-cmd="${escapeHtml(cmd)}">复制终端命令</button>` : ""}
      ${guide.provider && guide.profileId ? `<button type="button" class="btn-secondary btn-xs" data-probe-profile="${escapeHtml(guide.profileId)}" data-probe-provider="${escapeHtml(guide.provider)}">我已登录，立即测通</button>` : ""}
    </div>
  `;
}

function renderInstanceManagerModal() {
  const modal = $("instanceManagerModal");
  if (!modal?.open) return;
  const cleanProvider = state.instanceManagerProvider === "claude" ? "claude" : "codex";
  for (const tab of document.querySelectorAll("#instProviderTabs [data-inst-provider]")) {
    const active = tab.dataset.instProvider === cleanProvider;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  }
  const nameInput = $("instNameInput");
  if (nameInput) {
    nameInput.placeholder = cleanProvider === "claude"
      ? "例如：Claude 备用号 / 团队号"
      : "例如：Codex 备用号 / 工作号";
  }
  const listEl = $("instanceManagerList");
  if (listEl) {
    listEl.innerHTML = renderInstanceManagerListHtml(state.profiles, {
      provider: cleanProvider,
      probingKeys: state.probingProfileKeys,
    });
  }
}

function openInstanceManagerModal(provider = "") {
  const fallback = currentComposerProvider();
  const resolved = (provider === "claude" || provider === "codex")
    ? provider
    : (fallback === "claude" ? "claude" : "codex");
  state.instanceManagerProvider = resolved;
  renderInstanceLoginGuide(null);
  const modal = $("instanceManagerModal");
  if (modal && !modal.open) {
    modal.showModal();
  }
  renderInstanceManagerModal();
  $("instNameInput")?.focus();
}

async function triggerProfileLogin({ provider = "", profileId = "", mode = "" } = {}) {
  const cleanProvider = String(provider || "").trim().toLowerCase();
  const cleanProfileId = String(profileId || "").trim();
  if (!cleanProvider || !cleanProfileId) return;
  const resolvedMode = mode || (cleanProvider === "codex" ? "oauth" : "terminal");
  try {
    setComposerStatus("pending", `正在为 ${cleanProfileId} 发起登录…`);
    const res = await apiPostWithHotFallback("api/profile/login", {
      provider: cleanProvider,
      profileId: cleanProfileId,
      mode: resolvedMode,
      openOnHost: true,
    });
    if (res?.mode === "oauth" && res?.authUrl) {
      renderInstanceLoginGuide({
        provider: cleanProvider,
        profileId: cleanProfileId,
        authUrl: res.authUrl,
        loginCommand: res.loginCommand || "",
        title: res.openedBrowser ? "已在浏览器打开独立实例 OAuth 登录页" : "已生成独立实例 OAuth 登录链接",
        detail: "在浏览器完成授权后，RemoDeck 会自动接管并在后台保持在线；授权后即可关闭浏览器窗口。",
      });
      showToastBanner(
        res.openedBrowser ? "已打开独立登录页" : "已生成独立登录链接",
        { detail: "完成账号登录后将自动同步接管状态，之后无需保留浏览器或桌面客户端" },
      );
      setComposerStatus("success", "已发起独立实例登录，请在浏览器完成授权", { autoClearMs: 4200 });
    } else if (res?.mode === "app") {
      renderInstanceLoginGuide({
        provider: cleanProvider,
        profileId: cleanProfileId,
        loginCommand: res.loginCommand || "",
        title: "已以独立隔离目录启动 Codex 桌面端",
        detail: "完成登录或配置后可直接关闭桌面端窗口，RemoDeck 会在后台持续控制该实例。",
      });
      showToastBanner("已拉起独立 Codex 客户端", {
        detail: "登录或操作完成后可随时关闭客户端窗口",
      });
      setComposerStatus("success", "已启动独立 Codex 桌面端", { autoClearMs: 3200 });
    } else {
      renderInstanceLoginGuide({
        provider: cleanProvider,
        profileId: cleanProfileId,
        loginCommand: res?.loginCommand || "",
        title: res?.openedTerminal ? "已在终端启动独立登录命令" : "请在 Mac 终端执行独立登录命令",
        detail: "完成终端登录授权后即可关闭终端窗口，点右侧「立即测通」即可启用。",
      });
      if (!res?.openedTerminal && res?.loginCommand) {
        await copyTextToClipboard(res.loginCommand);
      }
      showToastBanner(
        res?.openedTerminal ? "已在终端开启独立登录" : "已复制独立登录命令",
        { detail: "授权完成后可关闭终端，由 RemoDeck 直接调度" },
      );
      setComposerStatus("success", "已准备好独立终端登录引导", { autoClearMs: 3500 });
    }
  } catch (error) {
    const errMsg = formatActionError(error, "发起登录失败");
    setComposerStatus("error", `发起登录失败：${errMsg}`);
    showToastBanner("发起登录失败", { detail: errMsg, error: true });
  }
}

async function handleCreateManagedProfile({ loginImmediately = true } = {}) {
  const provider = state.instanceManagerProvider === "claude" ? "claude" : "codex";
  const nameInput = $("instNameInput");
  const homeInput = $("instCustomHomeInput");
  const name = String(nameInput?.value || "").trim();
  const customHome = String(homeInput?.value || "").trim();
  if (!name) {
    nameInput?.focus();
    showToastBanner("请填写实例名称", { error: true });
    return;
  }
  const createBtn = $("instCreateAndLoginBtn");
  const createOnlyBtn = $("instCreateOnlyBtn");
  if (createBtn) createBtn.disabled = true;
  if (createOnlyBtn) createOnlyBtn.disabled = true;
  try {
    const res = await apiPostWithHotFallback("api/profile/create", {
      provider,
      name,
      customHome,
    });
    applyProfileSnapshotPayload(res);
    if (nameInput) nameInput.value = "";
    if (homeInput) homeInput.value = "";
    if (res?.created?.id && $("newThreadModal")?.open && $("newProviderSelect")?.value === provider) {
      $("newProfileSelect").value = res.created.id;
      syncNewProfileSelect();
    }
    showToastBanner(`已创建多开实例「${res?.created?.name || name}」`, {
      detail: loginImmediately ? "正在启动独立登录流程…" : "可随时点击「去登录」绑定账号",
    });
    if (loginImmediately && res?.created?.id) {
      await triggerProfileLogin({
        provider,
        profileId: res.created.id,
        mode: provider === "codex" ? "oauth" : "terminal",
      });
    }
  } catch (error) {
    const errMsg = formatActionError(error, "创建实例失败");
    showToastBanner("创建多开实例失败", { detail: errMsg, error: true });
  } finally {
    if (createBtn) createBtn.disabled = false;
    if (createOnlyBtn) createOnlyBtn.disabled = false;
  }
}

async function handleDeleteManagedProfile({ provider = "", profileId = "" } = {}) {
  if (!provider || !profileId) return;
  try {
    const res = await apiPostWithHotFallback("api/profile/delete", { provider, profileId });
    applyProfileSnapshotPayload(res);
    showToastBanner("已移除托管多开实例", { detail: "本地目录中的历史会话文件已保留" });
  } catch (error) {
    const errMsg = formatActionError(error, "移除实例失败");
    showToastBanner("移除实例失败", { detail: errMsg, error: true });
  }
}

function removePendingRequestById(reqId) {
  if (!reqId) return;
  state.pendingRequests = state.pendingRequests.filter((r) => r.id !== reqId);
  state.pendingRequestsSynced = true;
  syncThreadsPendingCounts();
  renderPendingRequests();
  renderThreadList();
  renderProjectBoard();
  renderProjectTaskStrip();
}

async function autoApprovePendingRequest(req) {
  if (!req?.id || req.kind === "userInput") return false;
  try {
    if (req.kind === "acpPermission") {
      const opt = (req.options || []).find((o) => o.kind === "allow_always")
        || (req.options || []).find((o) => o.kind === "allow_once")
        || req.options?.[0];
      await apiPost("api/server-request", {
        requestId: req.id,
        ...(opt?.optionId ? { optionId: opt.optionId } : { decision: "acceptForSession" }),
      });
    } else {
      await apiPost("api/approval", { requestId: req.id, decision: "acceptForSession" });
    }
    removePendingRequestById(req.id);
    return true;
  } catch (err) {
    if (Number(err?.status) === 404) {
      removePendingRequestById(req.id);
    }
    return false;
  }
}

async function autoApproveTurboRequestsForThread(threadId) {
  if (!threadId) return 0;
  const targets = state.pendingRequests.filter((r) => r.threadId === threadId && r.kind !== "userInput");
  let count = 0;
  for (const req of targets) {
    const ok = await autoApprovePendingRequest(req);
    if (ok) count += 1;
  }
  return count;
}

let sseReconnectTimer = null;
let sseReconnectAttempt = 0;
let sseNeedsResync = false;

function clearSseReconnectTimer() {
  if (sseReconnectTimer) {
    clearTimeout(sseReconnectTimer);
    sseReconnectTimer = null;
  }
}

function scheduleSseReconnect() {
  if (sseReconnectTimer) return;
  const delayMs = Math.min(12_000, 1_200 * Math.pow(1.6, Math.min(sseReconnectAttempt, 5)));
  sseReconnectAttempt += 1;
  sseReconnectTimer = setTimeout(() => {
    sseReconnectTimer = null;
    if (document.visibilityState !== "hidden") {
      connectEvents();
    }
  }, delayMs);
}

function resyncStateAfterSseReconnect() {
  if (!sseNeedsResync) return;
  sseNeedsResync = false;
  state.executionStats = null;
  void refreshThreads().catch(() => {});
  if (state.telemetryExpanded || state.telemetryPickerOpen) {
    void refreshExecutionStats();
  }
  if (state.activeThreadId && !isBoardViewActive() && !state.initialThreadLoading) {
    scheduleActiveThreadReload(state.activeThreadId, 80);
  }
}

function formatCodexWaitDurationMs(rawMs) {
  const ms = Number(rawMs);
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSec = ms / 1000;
  if (totalSec < 60) {
    const rounded = Math.round(totalSec * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
  }
  const mins = Math.floor(totalSec / 60);
  const secs = Math.round(totalSec % 60);
  if (secs === 60) return `${mins + 1}m`;
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function describeCodexNotificationItemActivity(item) {
  if (!item || typeof item !== "object") return null;
  const lowerType = String(item.type || "").trim().toLowerCase();
  if (lowerType === "reasoning") {
    return { phase: "思考中", text: "", isToolItem: false };
  }
  if (lowerType === "agentmessage") {
    return null;
  }
  if (lowerType === "extension" || lowerType === "mcptoolcall") {
    const name = String(item.kind || item.tool || "").trim();
    const args = item.arguments && typeof item.arguments === "object" ? item.arguments : {};
    if (/^(?:clock\.)?sleep$/i.test(name)) {
      const dur = formatCodexWaitDurationMs(item.durationMs ?? item.duration_ms ?? args.duration_ms ?? args.durationMs);
      return {
        phase: dur ? `定时等待 ${dur}` : "定时等待中",
        text: dur ? `clock.sleep · 计划等待 ${dur}` : "clock.sleep",
        isToolItem: true,
      };
    }
    return {
      phase: name ? `调用 ${name}` : "执行工具",
      text: "",
      isToolItem: true,
    };
  }
  if (lowerType === "commandexecution") {
    const cmd = Array.isArray(item.command) ? item.command.join(" ") : String(item.command || "").trim();
    return {
      phase: "执行命令",
      text: cmd.length > 80 ? `${cmd.slice(0, 80).trim()}…` : cmd,
      isToolItem: true,
    };
  }
  if (lowerType === "filechange") {
    return { phase: "正在修改代码…", text: "", isToolItem: true };
  }
  if (lowerType === "websearch") {
    return { phase: "正在检索…", text: "", isToolItem: true };
  }
  return null;
}

let humanVerifyOverlay = null;

function getHumanVerifyOverlay() {
  if (!humanVerifyOverlay) {
    humanVerifyOverlay = initHumanVerifyOverlay();
  }
  return humanVerifyOverlay;
}

function connectEvents() {
  clearSseReconnectTimer();
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  syncConnectionDots("connecting");
  if (isDemoMode()) {
    import("./demo-fixtures.js").then(({ createDemoEventSource }) => {
      const demoEs = createDemoEventSource();
      bindEventSourceListeners(demoEs);
    });
    return;
  }
  const es = new EventSource(apiUrl("api/events"));
  bindEventSourceListeners(es);
}

function bindEventSourceListeners(es) {
  state.eventSource = es;

  es.addEventListener("open", () => {
    state.sseConnected = true;
    sseReconnectAttempt = 0;
    clearSseReconnectTimer();
    clearLanFallbackTimer();
    syncConnectionDots("connected");
    if (state.toastActive && !state.toastTimer && $("liveBanner")?.classList.contains("is-error")) {
      state.toastActive = false;
      renderLiveBanner();
    }
    resyncStateAfterSseReconnect();
  });

  es.addEventListener("ready", (ev) => {
    state.sseConnected = true;
    sseReconnectAttempt = 0;
    clearSseReconnectTimer();
    clearLanFallbackTimer();
    syncConnectionDots("connected");
    if (state.toastActive && !state.toastTimer && $("liveBanner")?.classList.contains("is-error")) {
      state.toastActive = false;
      renderLiveBanner();
    }
    resyncStateAfterSseReconnect();
    const data = JSON.parse(ev.data || "{}");
    if (Array.isArray(data.pendingRequests)) {
      state.pendingRequests = data.pendingRequests;
      state.pendingRequestsSynced = true;
      syncThreadsPendingCounts();
      renderPendingRequests();
      renderThreadList();
      renderProjectBoard();
      renderProjectTaskStrip();
      const turboThreadIds = new Set(
        data.pendingRequests
          .filter((req) => req?.threadId && req.kind !== "userInput")
          .map((req) => req.threadId),
      );
      for (const tid of turboThreadIds) {
        const threadObj = state.threads.find((t) => t.id === tid)
          || (state.activeThreadId === tid ? state.activeThread : null);
        if (effectivePermissionModeForThread(tid, threadObj) === "turbo") {
          void autoApproveTurboRequestsForThread(tid);
        }
      }
    }
    if (data.telemetry) applyTelemetrySnapshot(data.telemetry);
    if (data.remote) state.remoteStatus = data.remote;
    if (data.tunnel) state.tunnelStatus = data.tunnel;
    if (data.lan) applyLanInfo(data.lan);
    if (data.update) applyUpdateStatusSnapshot(data.update, { fromReconnectReady: true });
    if (Array.isArray(data.pendingHumanVerifications)) {
      getHumanVerifyOverlay().syncList(data.pendingHumanVerifications);
    }
    clearLanFallbackTimer();
    syncRemoteButtonIndicator();
  });

  es.addEventListener("human_verify_created", (ev) => {
    try {
      const item = JSON.parse(ev.data || "{}");
      getHumanVerifyOverlay().upsert(item);
    } catch {}
  });

  es.addEventListener("human_verify_updated", (ev) => {
    try {
      const item = JSON.parse(ev.data || "{}");
      getHumanVerifyOverlay().upsert(item);
    } catch {}
  });

  es.addEventListener("human_verify_resolved", (ev) => {
    try {
      const info = JSON.parse(ev.data || "{}");
      getHumanVerifyOverlay().remove(info.id);
    } catch {}
  });

  es.addEventListener("update_status", (ev) => {
    try {
      const snap = JSON.parse(ev.data || "{}");
      applyUpdateStatusSnapshot(snap);
    } catch {}
  });

  es.addEventListener("automation_status", (ev) => {
    try {
      const snap = JSON.parse(ev.data || "{}");
      state.automationsSnapshot = snap;
      renderAutomationsModal(snap);
    } catch {}
  });

  es.addEventListener("automation_run", (ev) => {
    try {
      const info = JSON.parse(ev.data || "{}");
      if (info.reason === "scheduled" && info.name && !info.error) {
        showToastBanner(`定时任务已自动唤起：${info.name}`);
      }
      if ($("automationsModal")?.open) {
        void refreshAutomations().catch(() => {});
      }
    } catch {}
  });

  es.addEventListener("remote_status", (ev) => {
    try {
      const snap = JSON.parse(ev.data || "{}");
      state.remoteStatus = snap;
      syncRemoteButtonIndicator();
      if ($("remoteModal")?.open) {
        void openRemoteModal({ silentOpen: true });
      }
    } catch {}
  });

  es.addEventListener("tunnel_status", (ev) => {
    try {
      const snap = JSON.parse(ev.data || "{}");
      state.tunnelStatus = snap;
      syncRemoteButtonIndicator();
      if ($("remoteModal")?.open) {
        void openRemoteModal({ silentOpen: true });
      }
    } catch {}
  });

  es.addEventListener("host_offline", () => {
    state.sseConnected = false;
    syncConnectionDots("error");
    showToastBanner("控制主机暂时离线", { detail: "正在等待重连…", sticky: true, error: true });
    setComposerStatus("error", "控制主机暂时离线，请稍候重试");
  });

  let threadListLiveRenderTimer = null;
  const scheduleThreadListLiveRender = () => {
    if (threadListLiveRenderTimer) return;
    threadListLiveRenderTimer = setTimeout(() => {
      threadListLiveRenderTimer = null;
      renderThreadList();
    }, 120);
  };

  const updateThreadLiveTracker = (threadId, patch) => {
    if (!threadId) return;
    if (patch?.status === "running") {
      syncThreadSummaryIntoList({ id: threadId, live: true, lastTurnStatus: "", lastError: "", lastErrorAt: 0 });
    }
    const prev = state.liveActivityByThread.get(threadId) || {};
    const merged = mergeLiveActivity(prev, patch);
    merged.isStreamingText = Boolean(patch.isStreamingText ?? prev.isStreamingText);
    state.liveActivityByThread.set(threadId, merged);
    state.recentCompletedByThread.delete(threadId);
    if (threadReadState.unreadById[threadId]) {
      delete threadReadState.unreadById[threadId];
      persistThreadReadState();
    }
    if (
      prev.status !== merged.status
      || prev.phase !== merged.phase
      || prev.text !== merged.text
      || Boolean(prev.isStreamingText) !== merged.isStreamingText
    ) {
      scheduleThreadListLiveRender();
    }
  };

  const markThreadLiveCompleted = (threadId, status, summary = "") => {
    if (!threadId) return;
    state.liveActivityByThread.delete(threadId);
    const isVisibleActive = threadId === state.activeThreadId && !state.boardOpen && document.visibilityState !== "hidden";
    if (isVisibleActive) {
      markThreadRead(threadId);
    } else {
      markThreadUnread(threadId, { status, summary });
    }
  };

  es.addEventListener("server_request", (ev) => {
    const { request } = JSON.parse(ev.data || "{}");
    if (!request?.id) return;
    const threadObj = state.threads.find((t) => t.id === request.threadId)
      || (state.activeThreadId === request.threadId ? state.activeThread : null);
    if (request.threadId && request.kind !== "userInput" && effectivePermissionModeForThread(request.threadId, threadObj) === "turbo") {
      void autoApprovePendingRequest(request);
      return;
    }
    if (!state.pendingRequests.some((r) => r.id === request.id)) {
      state.pendingRequests.push(request);
    }
    state.pendingRequestsSynced = true;
    syncThreadsPendingCounts();
    renderPendingRequests();
    renderThreadList();
    renderProjectBoard();
    renderProjectTaskStrip();
  });

  es.addEventListener("thread_prefs_updated", (ev) => {
    const { threadId, prefs } = JSON.parse(ev.data || "{}");
    if (!threadId || !prefs) return;
    const target = state.threads.find((t) => t.id === threadId);
    if (target) {
      if (prefs.model) target.model = prefs.model;
      if (prefs.reasoningEffort) target.reasoningEffort = prefs.reasoningEffort;
      if (prefs.permissionMode) target.permissionMode = prefs.permissionMode;
      if (Object.hasOwn(prefs, "pinned")) target.pinned = Boolean(prefs.pinned);
    }
    if (threadId === state.activeThreadId && state.activeThread) {
      if (prefs.model) state.activeThread.model = prefs.model;
      if (prefs.reasoningEffort) state.activeThread.reasoningEffort = prefs.reasoningEffort;
      if (prefs.permissionMode) state.activeThread.permissionMode = prefs.permissionMode;
      if (Object.hasOwn(prefs, "pinned")) state.activeThread.pinned = Boolean(prefs.pinned);
      syncModelAndEffortSelectors();
      syncPermissionSelectors();
    }
    if (Object.hasOwn(prefs, "pinned")) {
      renderThreadList();
      renderProjectBoard();
      renderProjectTaskStrip();
    }
  });

  es.addEventListener("server_request_resolved", (ev) => {
    const { requestId } = JSON.parse(ev.data || "{}");
    removePendingRequestById(requestId);
  });

  es.addEventListener("project_meta_updated", (ev) => {
    const data = JSON.parse(ev.data || "{}");
    if (data.projectsMeta && typeof data.projectsMeta === "object") {
      state.projectsMeta = data.projectsMeta;
      renderThreadList();
      renderTopbarAndControls();
      renderProjectBoard();
      renderProjectTaskStrip();
    }
  });

  es.addEventListener("task_updated", () => {
    void refreshTasks();
  });

  es.addEventListener("overview_updated", (ev) => {
    try {
      const data = JSON.parse(ev.data || "{}");
      if (data && Array.isArray(data.domains)) {
        state.missionOverview = data;
        state.missionOverviewLoading = false;
        if (isBoardViewActive() && isOverviewBoardMode()) {
          renderProjectBoard();
        }
      }
    } catch {}
  });

  es.addEventListener("goal_state", (ev) => {
    const { threadId, goalState } = JSON.parse(ev.data || "{}");
    if (threadId === state.activeThreadId && state.activeThread) {
      state.activeThread.goalState = goalState;
      renderTopbarAndControls();
    }
    const target = state.threads.find((t) => t.id === threadId);
    if (target) {
      target.goalState = goalState;
      renderThreadList();
    }
  });

  es.addEventListener("queued_turn_event", (ev) => {
    const data = JSON.parse(ev.data || "{}");
    if (!data.threadId) return;
    const nextItems = Array.isArray(data.queuedTurns) ? data.queuedTurns : [];
    if (data.threadId === state.activeThreadId) {
      applyActiveQueuedTurns(data.threadId, nextItems);
      renderQueuedTurns();
      if (data.eventType === "failed") {
        const msg = data.error?.message || "排队消息执行失败";
        setComposerStatus("error", `排队发送失败：${msg}`);
        showToastBanner("排队发送失败", { detail: msg, error: true });
        if (data.entry?.text && !$("promptInput").value.trim()) {
          $("promptInput").value = data.entry.text;
          renderComposerControls();
        }
      } else if (data.eventType === "started") {
        state.streamingText = "";
        state.streamingThought = "";
        state.streamingTurnId = "";
        void selectThread(state.activeThreadId, { focusScroll: state.autoFollow }).catch(() => {});
      }
    } else {
      applyActiveQueuedTurns(data.threadId, nextItems);
    }
  });

  es.addEventListener("settings_updated", (ev) => {
    try {
      const { settings } = JSON.parse(ev.data || "{}");
      if (!settings || typeof settings !== "object") return;
      const titleEl = $("agentAutoTitleToggle");
      if (titleEl && Object.hasOwn(settings, "agentAutoTitle")) {
        titleEl.checked = settings.agentAutoTitle !== false;
      }
      const cliEl = $("autoUpdateCliToggle");
      if (cliEl && Object.hasOwn(settings, "autoUpdateCli")) {
        cliEl.checked = settings.autoUpdateCli !== false;
      }
      const compactEl = $("agyAutoCompactToggle");
      if (compactEl && Object.hasOwn(settings, "agyAutoCompact")) {
        compactEl.checked = settings.agyAutoCompact !== false;
      }
      const retry401El = $("agyAutoRetryAuth401Toggle");
      if (retry401El && Object.hasOwn(settings, "agyAutoRetryAuth401")) {
        retry401El.checked = settings.agyAutoRetryAuth401 !== false;
      }
      const sharedMemEl = $("sharedMemoryToggle");
      if (sharedMemEl && Object.hasOwn(settings, "sharedMemoryEnabled")) {
        sharedMemEl.checked = settings.sharedMemoryEnabled !== false;
      }
      const compactTokensEl = $("agyAutoCompactTokensSelect");
      if (compactTokensEl) {
        if (settings.agyAutoCompactTokens) {
          const value = String(settings.agyAutoCompactTokens);
          if (![...compactTokensEl.options].some((opt) => opt.value === value)) {
            compactTokensEl.append(new Option(`${Math.round(Number(value) / 1000)}K`, value));
          }
          compactTokensEl.value = value;
        }
        compactTokensEl.disabled = settings.agyAutoCompact === false;
      }
      updateSettingsTabBadge();
    } catch {}
  });

  es.addEventListener("thread_renamed", (ev) => {
    const { threadId, name } = JSON.parse(ev.data || "{}");
    const target = state.threads.find((t) => t.id === threadId);
    if (target) {
      target.name = name;
      target.title = name;
    }
    if (state.activeThreadId === threadId && state.activeThread) {
      state.activeThread.name = name;
      state.activeThread.title = name;
      renderTopbarAndControls();
    }
    renderThreadList();
    renderProjectBoard();
    renderProjectTaskStrip();
  });

  es.addEventListener("thread_archived", (ev) => {
    try {
      const data = JSON.parse(ev.data || "{}");
      if (state.activeThread && data?.threadId && state.activeThread.id === data.threadId) {
        state.activeThread.archived = Boolean(data.archived);
        renderTopbarAndControls();
      }
    } catch {}
    void refreshThreads();
  });

  es.addEventListener("threads_archived", (ev) => {
    try {
      const data = JSON.parse(ev.data || "{}");
      const ids = Array.isArray(data?.threadIds) ? data.threadIds : [];
      if (state.activeThread && state.activeThreadId && ids.includes(state.activeThreadId)) {
        state.activeThread.archived = Boolean(data.archived);
        renderTopbarAndControls();
      }
    } catch {}
    void refreshThreads();
  });

  es.addEventListener("agent_telemetry", (ev) => {
    try {
      const snap = JSON.parse(ev.data || "{}");
      if (snap?.byProvider) applyTelemetrySnapshot(snap);
    } catch {}
  });

  es.addEventListener("profiles_updated", (ev) => {
    try {
      const data = JSON.parse(ev.data || "{}");
      applyProfileSnapshotPayload(data);
    } catch {}
  });

  es.addEventListener("profile_auth_updated", (ev) => {
    try {
      const data = JSON.parse(ev.data || "{}");
      if (data?.success) {
        renderInstanceLoginGuide(null);
        renderInstanceManagerModal();
        showToastBanner("实例已完成登录并由后台接管", {
          detail: `${providerDisplayName(data.provider)} · ${data.profileId} 现可关闭外部窗口直接使用`,
        });
      } else if (data?.error) {
        showToastBanner("实例登录未完成", { detail: String(data.error), error: true });
      }
    } catch {}
  });

  es.addEventListener("provider_event", (ev) => {
    const evt = JSON.parse(ev.data || "{}");
    if (!evt.threadId) return;

    if (evt.type === "codex_notification") {
      const { method, params } = evt;
      if (method === "turn/started") {
        updateThreadLiveTracker(evt.threadId, {
          turnId: params?.turn?.id || "",
          status: "running",
          phase: "Codex 执行中",
          isStreamingText: false,
        });
      } else if (method === "item/started") {
        const itemDesc = describeCodexNotificationItemActivity(params?.item);
        if (itemDesc) {
          updateThreadLiveTracker(evt.threadId, {
            status: "running",
            phase: itemDesc.phase,
            text: itemDesc.text,
            isStreamingText: false,
          });
        }
      } else if (method === "item/agentMessage/delta" || method === "codex/event/agent_message_content_delta") {
        updateThreadLiveTracker(evt.threadId, { status: "running", isStreamingText: true });
      } else if (method === "error" && evt.profileId && isCodexOfficialClientErrorText(params?.error)) {
        state.codexExecSuggestedProfiles.add(evt.profileId);
        if (evt.threadId === state.activeThreadId) renderCodexCompatBanner();
      } else if (method === "turn/completed") {
        const recoverableCodexErr = params?.turn?.status === "failed" && isRecoverableToolErrorText(params?.turn?.error);
        markThreadLiveCompleted(
          evt.threadId,
          recoverableCodexErr ? "completed" : (params?.turn?.status || "completed"),
          params?.turn?.lastAgentMessage || "",
        );
      }
    } else if (evt.type === "turn_started") {
      updateThreadLiveTracker(evt.threadId, {
        turnId: evt.turn?.id || "",
        status: "running",
        phase: `${providerDisplayName(evt.provider)} 执行中`,
        isStreamingText: false,
      });
    } else if (evt.type === "stream_item_start") {
      if (evt.blockType === "thinking") {
        updateThreadLiveTracker(evt.threadId, {
          status: "running",
          phase: `${providerDisplayName(evt.provider)} 思考中…`,
          text: "",
          isStreamingText: false,
        });
      } else if (evt.blockType === "tool_use") {
        updateThreadLiveTracker(evt.threadId, {
          status: "running",
          phase: `准备工具 ${evt.toolName || ""}`,
          text: "",
          isStreamingText: false,
        });
      } else if (evt.blockType === "text") {
        updateThreadLiveTracker(evt.threadId, {
          status: "running",
          phase: `${providerDisplayName(evt.provider)} 回复中…`,
          text: "",
          isStreamingText: true,
        });
      }
    } else if (evt.type === "stream_delta") {
      if (evt.kind === "text") {
        updateThreadLiveTracker(evt.threadId, {
          status: "running",
          phase: `${providerDisplayName(evt.provider)} 回复中…`,
          text: "",
          isStreamingText: true,
        });
      } else if (evt.kind === "reasoning") {
        updateThreadLiveTracker(evt.threadId, {
          status: "running",
          phase: `${providerDisplayName(evt.provider)} 思考中…`,
          text: "",
          isStreamingText: false,
        });
      } else if (evt.kind === "toolInput") {
        updateThreadLiveTracker(evt.threadId, {
          status: "running",
          phase: `准备工具 ${evt.toolName || ""}`,
          text: "",
          isStreamingText: false,
        });
      }
    } else if (evt.type === "tool_use") {
      const toolSummary = summarizeToolUseActivity(evt.toolUse);
      updateThreadLiveTracker(evt.threadId, {
        status: "running",
        phase: toolSummary.phase,
        text: toolSummary.text,
        isStreamingText: false,
      });
    } else if (evt.type === "tool_result") {
      updateThreadLiveTracker(evt.threadId, {
        status: "running",
        phase: `${providerDisplayName(evt.provider)} 思考中…`,
        text: "",
        isStreamingText: false,
      });
    } else if (evt.type === "acp_tool_update") {
      const rawToolText = String(evt.update?.status || "");
      const friendlyToolText = isRecoverableToolErrorText(rawToolText)
        ? formatToolExecutionError(rawToolText, { filePath: evt.update?.title || "" })
        : rawToolText;
      const prevPhase = state.liveActivityByThread.get(evt.threadId)?.phase || "";
      updateThreadLiveTracker(evt.threadId, {
        status: "running",
        phase: evt.update?.title || prevPhase || "正在执行工具…",
        text: friendlyToolText,
      });
    } else if (evt.type === "turn_completed") {
      const recoverableTurnErr = evt.status === "failed" && isRecoverableToolErrorText(evt.error);
      markThreadLiveCompleted(
        evt.threadId,
        recoverableTurnErr ? "completed" : (evt.status || "completed"),
        evt.lastAgentMessage || "",
      );
    }

    if (evt.threadId === state.activeThreadId) {
      if (evt.type === "codex_notification") {
        const { method, params } = evt;
        if (method === "turn/started") {
          state.streamingText = "";
          state.streamingThought = "";
          state.streamingTurnId = params?.turn?.id || "";
          state.liveActivity = mergeLiveActivity(state.liveActivity, {
            turnId: state.streamingTurnId,
            status: "running",
            phase: "Codex 执行中",
          });
          renderTopbarAndControls();
          renderStreamingTurn();
        } else if (method === "item/started") {
          const itemDesc = describeCodexNotificationItemActivity(params?.item);
          if (itemDesc) {
            if (itemDesc.isToolItem) {
              state.streamingThought = "";
            }
            state.liveActivity = mergeLiveActivity(state.liveActivity, {
              status: "running",
              phase: itemDesc.phase,
              text: itemDesc.text,
            });
            renderLiveBanner();
            syncLiveTurnFrontier();
            if (itemDesc.isToolItem) {
              scheduleActiveThreadReload(state.activeThreadId, 350);
            }
          }
        } else if (method === "item/completed") {
          const itemType = String(params?.item?.type || "").toLowerCase();
          if (itemType && itemType !== "agentmessage" && itemType !== "reasoning") {
            scheduleActiveThreadReload(state.activeThreadId, 250);
          }
        } else if (method === "item/agentMessage/delta" || method === "codex/event/agent_message_content_delta") {
          clearComposerStatus();
          const deltaTurnId = String(params?.turnId || params?.msg?.turn_id || "").trim();
          if (deltaTurnId && state.streamingTurnId && deltaTurnId !== state.streamingTurnId) {
            state.streamingText = "";
            state.streamingThought = "";
          }
          if (deltaTurnId) state.streamingTurnId = deltaTurnId;
          const wasEmpty = !state.streamingText;
          state.streamingText += String(params?.delta || params?.msg?.delta || "");
          if (wasEmpty) {
            renderLiveBanner();
            renderActiveMessages();
          } else renderStreamingTurn();
        } else if (method === "item/reasoning/summaryTextDelta") {
          clearComposerStatus();
          state.streamingThought += String(params?.delta || "");
          syncLiveTurnFrontier();
        } else if (method === "error") {
          if (evt.profileId && isCodexOfficialClientErrorText(params?.error)) {
            state.codexExecSuggestedProfiles.add(evt.profileId);
            renderCodexCompatBanner();
          }
        } else if (method === "turn/completed") {
          state.streamingText = "";
          state.streamingThought = "";
          if (state.activeThread) state.activeThread.live = false;
          syncThreadSummaryIntoList({ id: evt.threadId, live: false });
          const rawErrMsg = params?.turn?.error?.message || "";
          const recoverableErr = isRecoverableToolErrorText(params?.turn?.error || rawErrMsg);
          const turnStatus = recoverableErr && params?.turn?.status === "failed"
            ? "completed"
            : (params?.turn?.status || "completed");
          state.liveActivity = { status: turnStatus };
          if (turnStatus === "failed") {
            const msg = rawErrMsg || "执行失败";
            if (evt.profileId && isCodexOfficialClientErrorText(params?.turn?.error || msg)) {
              state.codexExecSuggestedProfiles.add(evt.profileId);
              renderCodexCompatBanner();
            }
            const errAt = Math.floor(Date.now() / 1000);
            syncThreadSummaryIntoList({
              id: evt.threadId,
              live: false,
              lastTurnStatus: "failed",
              lastError: String(params?.turn?.error?.shortError || msg),
              lastErrorAt: errAt,
            });
            renderThreadList();
            const failoverContext = buildFailoverContextForProvider(evt.provider, evt.profileId);
            setComposerStatus("error", `执行失败：${msg}`, { failoverContext });
            showToastBanner("执行失败", { detail: msg, error: true });
          } else {
            syncThreadSummaryIntoList({ id: evt.threadId, live: false, lastTurnStatus: "", lastError: "", lastErrorAt: 0 });
          }
          void reloadActiveThreadAfterTurnCompletion({
            threadId: evt.threadId || state.activeThreadId,
            turnId: params?.turn?.id || "",
            turnStatus,
            errorMessage: rawErrMsg || "执行失败",
            errorDetail: params?.turn?.error?.detail || "",
            lastAgentMessage: params?.turn?.lastAgentMessage || "",
          });
          void refreshThreads().catch(() => {});
        }
      } else {
        if (evt.type === "turn_started") {
          state.streamingText = "";
          state.streamingThought = "";
          state.streamingTurnId = evt.turn?.id || "";
          state.liveActivity = mergeLiveActivity(state.liveActivity, {
            turnId: state.streamingTurnId,
            status: "running",
            phase: `${providerDisplayName(evt.provider)} 执行中`,
          });
          renderTopbarAndControls();
          renderStreamingTurn();
          scheduleActiveThreadReload(state.activeThreadId, 450);
          scheduleTelemetryRefresh(150);
        } else if (evt.type === "stream_item_start") {
          clearComposerStatus();
          if (evt.turnId && state.streamingTurnId && evt.turnId !== state.streamingTurnId) {
            state.streamingText = "";
            state.streamingThought = "";
          }
          if (evt.turnId) state.streamingTurnId = evt.turnId;
          if (evt.blockType === "thinking") {
            state.liveActivity = mergeLiveActivity(state.liveActivity, {
              status: "running",
              phase: `${providerDisplayName(evt.provider)} 思考中…`,
              text: "",
            });
            renderLiveBanner();
            syncLiveTurnFrontier();
          } else if (evt.blockType === "tool_use") {
            state.liveActivity = mergeLiveActivity(state.liveActivity, {
              status: "running",
              phase: `准备工具 ${evt.toolName || ""}`,
              text: "",
            });
            renderLiveBanner();
            syncLiveTurnFrontier();
          }
        } else if (evt.type === "stream_delta") {
          clearComposerStatus();
          if (evt.turnId && state.streamingTurnId && evt.turnId !== state.streamingTurnId) {
            state.streamingText = "";
            state.streamingThought = "";
          }
          if (evt.turnId) {
            state.streamingTurnId = evt.turnId;
          }
          if (evt.provider && evt.delta) {
            recordClientStreamDelta(evt.provider, evt.delta, evt.threadId || "");
          }
          if (evt.kind === "text") {
            const wasEmpty = !state.streamingText;
            state.streamingText += String(evt.delta || "");
            if (wasEmpty) {
              state.liveActivity = mergeLiveActivity(state.liveActivity, {
                status: "running",
                phase: `${providerDisplayName(evt.provider)} 回复中…`,
                text: "",
              });
              renderLiveBanner();
              renderActiveMessages();
            } else {
              renderStreamingTurn();
            }
          } else if (evt.kind === "reasoning") {
            state.streamingThought += String(evt.delta || "");
            state.liveActivity = mergeLiveActivity(state.liveActivity, {
              status: "running",
              phase: `${providerDisplayName(evt.provider)} 思考中…`,
              text: "",
            });
            renderLiveBanner();
            syncLiveTurnFrontier();
          } else if (evt.kind === "toolInput") {
            const hadStreamingText = Boolean(state.streamingText);
            state.streamingText = "";
            state.streamingThought = "";
            state.liveActivity = mergeLiveActivity(state.liveActivity, {
              status: "running",
              phase: `准备工具 ${evt.toolName || ""}`,
              text: "",
            });
            renderLiveBanner();
            if (hadStreamingText) renderActiveMessages();
            else syncLiveTurnFrontier();
            scheduleActiveThreadReload(state.activeThreadId, 500);
          } else {
            renderStreamingTurn();
          }
        } else if (evt.type === "tool_use") {
          const hadStreamingText = Boolean(state.streamingText);
          state.streamingText = "";
          state.streamingThought = "";
          const toolSummary = summarizeToolUseActivity(evt.toolUse);
          state.liveActivity = mergeLiveActivity(state.liveActivity, {
            status: "running",
            phase: toolSummary.phase,
            text: toolSummary.text,
          });
          renderLiveBanner();
          if (hadStreamingText) renderActiveMessages();
          else syncLiveTurnFrontier();
          scheduleActiveThreadReload(state.activeThreadId, 350);
        } else if (evt.type === "tool_result") {
          state.liveActivity = mergeLiveActivity(state.liveActivity, {
            status: "running",
            phase: `${providerDisplayName(evt.provider)} 思考中…`,
            text: "",
          });
          renderLiveBanner();
          syncLiveTurnFrontier();
          scheduleActiveThreadReload(state.activeThreadId, 250);
        } else if (evt.type === "acp_tool_update") {
          const rawToolText = String(evt.update?.status || "");
          const friendlyToolText = isRecoverableToolErrorText(rawToolText)
            ? formatToolExecutionError(rawToolText, { filePath: evt.update?.title || "" })
            : rawToolText;
          const prevPhase = state.liveActivity?.phase || "";
          const hadStreamingText = Boolean(state.streamingText);
          state.streamingText = "";
          state.streamingThought = "";
          state.liveActivity = mergeLiveActivity(state.liveActivity, {
            status: "running",
            phase: evt.update?.title || prevPhase || "正在执行工具…",
            text: friendlyToolText,
          });
          renderLiveBanner();
          if (hadStreamingText) renderActiveMessages();
          else syncLiveTurnFrontier();
          scheduleActiveThreadReload(state.activeThreadId, 750);
        } else if (evt.type === "turn_completed") {
          state.streamingText = "";
          state.streamingThought = "";
          if (state.activeThread) state.activeThread.live = false;
          syncThreadSummaryIntoList({ id: evt.threadId, live: false });
          const rawErrMsg = evt.error?.message || "";
          const recoverableErr = isRecoverableToolErrorText(evt.error || rawErrMsg);
          const turnStatus = recoverableErr && evt.status === "failed"
            ? "completed"
            : (evt.status || "completed");
          state.liveActivity = { status: turnStatus };
          if (turnStatus === "failed") {
            const msg = rawErrMsg || "执行失败";
            const errAt = Math.floor(Date.now() / 1000);
            syncThreadSummaryIntoList({
              id: evt.threadId,
              live: false,
              lastTurnStatus: "failed",
              lastError: String(evt.error?.shortError || msg),
              lastErrorAt: errAt,
            });
            renderThreadList();
            const failoverContext = buildFailoverContextForProvider(evt.provider, evt.profileId);
            setComposerStatus("error", `执行失败：${msg}`, { failoverContext });
            showToastBanner("执行失败", { detail: msg, error: true });
          } else {
            syncThreadSummaryIntoList({ id: evt.threadId, live: false, lastTurnStatus: "", lastError: "", lastErrorAt: 0 });
          }
          void reloadActiveThreadAfterTurnCompletion({
            threadId: evt.threadId || state.activeThreadId,
            turnId: evt.turnId || "",
            turnStatus,
            errorMessage: rawErrMsg || "执行失败",
            errorDetail: evt.error?.detail || "",
            lastAgentMessage: evt.lastAgentMessage || "",
          });
          void refreshThreads().catch(() => {});
          scheduleTelemetryRefresh(200);
        }
      }
    } else if (evt.type === "turn_started" || evt.type === "turn_completed" || evt.method === "turn/started" || evt.method === "turn/completed") {
      if (evt.type === "turn_started" || evt.method === "turn/started") {
        syncThreadSummaryIntoList({ id: evt.threadId, live: true, lastTurnStatus: "", lastError: "", lastErrorAt: 0 });
        renderThreadList();
        renderProjectBoard();
      } else {
        const rawErr = evt.type === "turn_completed" ? evt.error : evt.params?.turn?.error;
        const rawStatus = evt.type === "turn_completed" ? evt.status : evt.params?.turn?.status;
        const rawErrMsg = String(rawErr?.shortError || rawErr?.message || "").trim();
        const recoverableErr = rawStatus === "failed" && isRecoverableToolErrorText(rawErr || rawErrMsg);
        if (rawStatus === "failed" && !recoverableErr) {
          const existing = state.threads.find((t) => t.id === evt.threadId);
          const errAt = Math.floor(Date.now() / 1000);
          const errText = rawErrMsg || "执行失败";
          syncThreadSummaryIntoList({
            id: evt.threadId,
            live: false,
            lastTurnStatus: "failed",
            lastError: errText,
            lastErrorAt: errAt,
          });
          renderThreadList();
          renderProjectBoard();
          notifyBackgroundThreadFailure(
            existing
              ? { ...existing, lastError: errText, lastErrorAt: errAt }
              : { id: evt.threadId, title: "后台任务", lastError: errText, lastErrorAt: errAt },
            errText,
          );
        } else {
          syncThreadSummaryIntoList({ id: evt.threadId, live: false, lastTurnStatus: "", lastError: "", lastErrorAt: 0 });
        }
      }
      void refreshThreads();
      scheduleTelemetryRefresh(150);
    }
  });

  es.addEventListener("error", () => {
    if (state.eventSource !== es) return;
    state.sseConnected = false;
    sseNeedsResync = true;
    syncConnectionDots("error");
    if (es.readyState === EventSource.CLOSED) {
      es.close();
      state.eventSource = null;
      scheduleSseReconnect();
    }
    scheduleLanFallbackCheck();
  });
}

const UPDATE_RESTART_FLAG_KEY = "agentControl.restartingForUpdate";

function formatUpdateTimestamp(msOrSec) {
  const num = Number(msOrSec);
  if (!Number.isFinite(num) || num <= 0) return "尚未检查";
  const ms = num > 1e12 ? num : num * 1000;
  try {
    return new Date(ms).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "刚刚";
  }
}

function updateStateLabel(snap) {
  if (!snap) return "待检查";
  if (snap.updating || snap.restartPending || snap.phase === "pulling" || snap.phase === "installing" || snap.phase === "building_desktop" || snap.phase === "restarting") {
    if (snap.phase === "restarting") return "重启中";
    if (snap.phase === "building_desktop") return "编桌面";
    if (snap.phase === "installing") return "装依赖";
    return "更新中";
  }
  if (snap.desktopUpdating || state.desktopUpdating) return "更新壳子";
  if (snap.checking || snap.phase === "checking") return "检查中";
  if (snap.updateState === "available") return `有 ${snap.behindCount || 1} 个更新`;
  if (snap.updateState === "diverged") return "分支分叉";
  if (snap.desktopApp?.installed && snap.desktopApp?.needsUpdate) return "壳子待更新";
  if (snap.updateState === "up_to_date") return "已是最新";
  return "本地模式";
}

function renderUpdateIndicators() {
  const snap = state.updateStatus;
  const desktopNeedsUpdate = Boolean(snap?.desktopApp?.installed && snap?.desktopApp?.needsUpdate);
  const hasRepoUpdate = Boolean(snap?.hasUpdate);
  const hasUpdate = hasRepoUpdate || desktopNeedsUpdate;
  const isBusy = Boolean(
    state.updateChecking
    || state.updateApplying
    || state.desktopUpdating
    || snap?.checking
    || snap?.updating
    || snap?.desktopUpdating
    || snap?.restartPending,
  );
  const verText = snap
    ? `v${snap.packageVersion || "0.1.0"}${snap.localShortSha ? ` · ${snap.localShortSha}` : ""}`
    : "v0.1.0";

  const sidebarBtn = $("sidebarUpdateBtn");
  const sidebarDot = $("sidebarUpdateDot");
  const sidebarVer = $("sidebarUpdateVersion");
  const sidebarBadge = $("sidebarUpdateBadge");
  const sidebarAuto = $("sidebarAutoUpdateTag");
  const menuBadge = $("topbarMenuUpdateBadge");
  const moreDot = $("topbarMoreDot");

  if (sidebarVer) sidebarVer.textContent = verText;
  if (sidebarBtn) {
    sidebarBtn.classList.toggle("has-update", hasUpdate);
    if (hasRepoUpdate) {
      sidebarBtn.title = `发现新版本 (${snap.behindCount || 1} 个提交)，点击查看详情并一键更新`;
    } else if (desktopNeedsUpdate) {
      sidebarBtn.title = snap.desktopApp?.reason || "检测到桌面 App 壳子待更新，点击查看并同步";
    } else {
      sidebarBtn.title = `当前版本 ${verText}，点击检查或配置自动更新`;
    }
  }
  if (sidebarDot) {
    const dotState = desktopNeedsUpdate && !hasRepoUpdate ? "available" : (snap?.updateState || "unknown");
    const stateCls = isBusy ? "is-busy" : `is-${dotState}`;
    sidebarDot.className = `update-indicator-dot ${stateCls}`;
  }
  if (sidebarBadge) {
    sidebarBadge.hidden = !hasUpdate && !isBusy;
    if (isBusy) {
      sidebarBadge.textContent = state.desktopUpdating || snap?.desktopUpdating ? "编桌面" : "更新中";
    } else if (hasRepoUpdate) {
      sidebarBadge.textContent = snap?.behindCount > 1 ? `更新 ${snap.behindCount}` : "有更新";
    } else if (desktopNeedsUpdate) {
      sidebarBadge.textContent = "壳待更";
    }
  }
  if (sidebarAuto) {
    sidebarAuto.hidden = !snap?.autoUpdateEnabled;
  }
  if (menuBadge) {
    menuBadge.hidden = !hasUpdate;
    menuBadge.textContent = hasRepoUpdate ? (snap?.behindCount > 1 ? String(snap.behindCount) : "新") : "壳";
  }
  if (moreDot) {
    const goalActive = Boolean(!state.boardOpen && state.activeThread?.goalState?.active);
    moreDot.hidden = !(goalActive || hasUpdate);
  }
}

function syncUpdateModalTabs() {
  const modal = $("updateModal");
  if (!modal) return;
  const activeTab = ["notes", "settings", "cli"].includes(state.updateModalTab)
    ? state.updateModalTab
    : "notes";
  state.updateModalTab = activeTab;
  for (const btn of modal.querySelectorAll("[data-update-tab]")) {
    const isAct = btn.getAttribute("data-update-tab") === activeTab;
    btn.classList.toggle("is-active", isAct);
    btn.setAttribute("aria-selected", isAct ? "true" : "false");
  }
  for (const panel of modal.querySelectorAll("[data-update-panel]")) {
    panel.hidden = panel.getAttribute("data-update-panel") !== activeTab;
  }
}

function updateSettingsTabBadge() {
  const badge = $("updateTabSettingsBadge");
  if (!badge) return;
  const ids = [
    "autoCheckUpdateToggle",
    "autoUpdateToggle",
    "autoUpdateDesktopToggle",
    "agentAutoTitleToggle",
    "autoUpdateCliToggle",
    "agyAutoCompactToggle",
    "agyAutoRetryAuth401Toggle",
    "sharedMemoryToggle",
  ];
  const els = ids.map((id) => $(id)).filter(Boolean);
  if (!els.length) {
    badge.textContent = "";
    return;
  }
  const enabledCount = els.filter((el) => Boolean(el.checked)).length;
  badge.textContent = `${enabledCount}/${els.length}`;
}

function currentUiLocale() {
  return window.AgentControlI18n?.getLocale?.() || document.documentElement?.lang || "zh-CN";
}

function renderUpdateReleaseNotesBody() {
  const snap = state.updateStatus;
  const releaseNotesSec = $("updateReleaseNotesSection");
  const releaseNotesBody = $("updateReleaseNotesBody");
  if (!releaseNotesSec || !releaseNotesBody) return;
  const locale = currentUiLocale();
  const tabs = buildReleaseVersionTabs(snap, { locale });
  if (state.updateNotesVersionKey && !tabs.some((t) => t.key === state.updateNotesVersionKey)) {
    state.updateNotesVersionKey = "";
  }
  const notesHtml = renderReleaseNotesCardHtml(snap, {
    escapeHtml,
    selectedVersionKey: state.updateNotesVersionKey,
    selectedCategory: state.updateNotesCategory,
    locale,
  });
  releaseNotesSec.hidden = !notesHtml;
  releaseNotesSec.classList.toggle("is-has-update", Boolean(snap?.hasUpdate && notesHtml));
  releaseNotesBody.innerHTML = notesHtml;
}

function renderUpdateModal() {
  const snap = state.updateStatus;
  const pill = $("updateStatePill");
  const currentEl = $("updateCurrentInfo");
  const remoteEl = $("updateRemoteInfo");
  const desktopEl = $("updateDesktopInfo");
  const statusEl = $("updateActionStatus");
  const dirtyEl = $("updateDirtyWarning");
  const releaseNotesSec = $("updateReleaseNotesSection");
  const notesBadge = $("updateTabNotesBadge");
  const autoCheckEl = $("autoCheckUpdateToggle");
  const autoUpdateEl = $("autoUpdateToggle");
  const autoDesktopEl = $("autoUpdateDesktopToggle");
  const pendingSec = $("updatePendingSection");
  const pendingDetailsEl = $("updatePendingDetails");
  const pendingCountEl = $("updatePendingCount");
  const pendingListEl = $("updatePendingList");
  const desktopBtn = $("applyDesktopUpdateBtn");
  const restartBtn = $("restartServiceBtn");
  const checkBtn = $("checkUpdateBtn");
  const applyBtn = $("applyUpdateBtn");

  const desktopInfo = snap?.desktopApp || null;
  const desktopNeedsUpdate = Boolean(desktopInfo?.installed && desktopInfo?.needsUpdate);
  const label = updateStateLabel(snap);
  const isBusy = Boolean(
    state.updateChecking
    || state.updateApplying
    || state.desktopUpdating
    || snap?.checking
    || snap?.updating
    || snap?.desktopUpdating
    || snap?.restartPending,
  );
  if (pill) {
    pill.textContent = label;
    pill.className = `tunnel-state-pill${(snap?.hasUpdate || desktopNeedsUpdate) ? " is-warn" : (snap?.updateState === "up_to_date" ? " is-ok" : "")}`;
  }

  if (currentEl) {
    if (!snap) {
      currentEl.innerHTML = `<span class="update-hero-sub">正在读取版本信息…</span>`;
    } else {
      const shaLabel = snap.localShortSha
        ? `${escapeHtml(snap.branch || "main")} @ <code>${escapeHtml(snap.localShortSha)}</code>`
        : "非 Git 部署";
      const uiTitleAttr = snap.uiVersion ? ` title="UI 资源版本 ${escapeHtml(snap.uiVersion)}"` : "";
      const timePart = snap.lastCheckedAt ? `${formatUpdateTimestamp(snap.lastCheckedAt)} 检查` : "尚未检查";
      const modePart = snap.managedService ? "后台托管" : "直启";
      currentEl.innerHTML = `
        <div class="update-hero-main">
          <span class="update-hero-ver"${uiTitleAttr}>v${escapeHtml(snap.packageVersion || "0.1.0")}</span>
          <span class="update-hero-sha">${shaLabel}</span>
        </div>
        <div class="update-hero-sub">
          <span>${escapeHtml(timePart)} · ${modePart}</span>
        </div>
      `;
    }
  }

  const locale = currentUiLocale();
  const activeNotes = resolveReleaseNotesBucket(snap, locale) || snap?.releaseNotes || null;

  if (remoteEl) {
    if (snap?.isGitRepo && snap?.remoteUrl && snap?.hasUpdate) {
      remoteEl.hidden = false;
      const remoteVer = snap.remoteVersion ? `v${escapeHtml(snap.remoteVersion)}` : (snap.remoteShortSha ? escapeHtml(snap.remoteShortSha) : "新版");
      const headline = renderReleaseHeadline(activeNotes?.pending?.[0] || activeNotes?.remote);
      remoteEl.innerHTML = `
        <span class="update-remote-pill">发现新版 ${remoteVer} · 落后 ${snap.behindCount || 1} 提交</span>
        ${headline ? `<span class="update-remote-topic" title="${escapeHtml(headline)}">${escapeHtml(headline)}</span>` : ""}
      `;
    } else {
      remoteEl.hidden = true;
      remoteEl.innerHTML = "";
    }
  }

  if (desktopEl) {
    if (desktopInfo?.supported) {
      desktopEl.hidden = false;
      if (desktopInfo.installed) {
        const tagClass = desktopInfo.needsUpdate ? "is-warn" : "is-ok";
        const tagText = desktopInfo.needsUpdate ? "壳子待更新" : "壳子已同步";
        const verStr = `v${escapeHtml(desktopInfo.installedVersion || "未知")}${desktopInfo.installedBuildNumber ? ` (#${escapeHtml(desktopInfo.installedBuildNumber)})` : ""}`;
        const shortInstalled = desktopInfo.installedHash ? desktopInfo.installedHash.slice(0, 7) : "";
        const shortExpected = desktopInfo.expectedHash ? desktopInfo.expectedHash.slice(0, 7) : "";
        const hashLabel = shortInstalled
          ? (shortExpected && shortInstalled !== shortExpected ? `指纹 ${shortInstalled} → ${shortExpected}` : `指纹 ${shortInstalled}`)
          : "旧壳无指纹";
        const statusDesc = desktopInfo.needsUpdate ? `源码已变动，${hashLabel}` : hashLabel;
        desktopEl.innerHTML = `
          <div class="update-hero-tile-head">
            <span class="update-tile-label">桌面 App</span>
            <span class="update-desktop-tag ${tagClass}">${tagText}</span>
          </div>
          <div class="update-hero-main">
            <span class="update-hero-ver">${verStr}</span>
          </div>
          <div class="update-hero-sub" title="${escapeHtml(desktopInfo.reason || statusDesc)}">
            <span>${escapeHtml(statusDesc)}</span>
          </div>
        `;
      } else {
        desktopEl.innerHTML = `
          <div class="update-hero-tile-head">
            <span class="update-tile-label">桌面 App</span>
            <span class="update-desktop-tag">未安装</span>
          </div>
          <div class="update-hero-main">
            <span class="update-hero-ver is-muted">尚未安装</span>
          </div>
          <div class="update-hero-sub" title="${escapeHtml(desktopInfo.reason || "")}">
            <span>点击下方「构建桌面 App」即可安装</span>
          </div>
        `;
      }
    } else {
      desktopEl.hidden = true;
      desktopEl.innerHTML = "";
    }
  }

  renderUpdateReleaseNotesBody();

  if (notesBadge) {
    if (snap?.hasUpdate) {
      notesBadge.textContent = snap.remoteVersion ? `v${snap.remoteVersion}` : "有新版";
      notesBadge.className = "update-tab-badge is-warn";
    } else if (activeNotes?.current?.version || snap?.packageVersion) {
      notesBadge.textContent = `v${activeNotes?.current?.version || snap.packageVersion}`;
      notesBadge.className = "update-tab-badge";
    } else {
      notesBadge.textContent = "";
      notesBadge.className = "update-tab-badge";
    }
  }

  if (autoCheckEl && snap) autoCheckEl.checked = Boolean(snap.autoCheckEnabled);
  if (autoUpdateEl && snap) autoUpdateEl.checked = Boolean(snap.autoUpdateEnabled);
  if (autoDesktopEl && snap) {
    autoDesktopEl.checked = snap.autoUpdateDesktopApp !== false;
    autoDesktopEl.disabled = Boolean(desktopInfo && !desktopInfo.supported);
  }
  updateSettingsTabBadge();
  syncUpdateModalTabs();

  if (statusEl) {
    const desktopActive = Boolean(state.desktopUpdating || snap?.desktopUpdating || snap?.desktopPhase === "error");
    const msg = (desktopActive && snap?.desktopMessage)
      ? snap.desktopMessage
      : (snap?.phaseMessage || snap?.lastError || (snap?.desktopPhase === "done" ? snap?.desktopMessage : "") || "");
    if (msg) {
      const isErr = (desktopActive && snap?.desktopPhase === "error")
        || snap?.phase === "error"
        || (snap?.lastError && !snap?.hasUpdate);
      statusEl.hidden = false;
      statusEl.className = `composer-status ${isErr ? "is-error" : (snap?.restartPending || snap?.desktopPhase === "done" ? "is-success" : "is-pending")}`;
      statusEl.textContent = msg;
    } else {
      statusEl.hidden = true;
      statusEl.textContent = "";
    }
  }

  if (dirtyEl) {
    if (snap?.dirty) {
      dirtyEl.hidden = false;
      const sampleList = Array.isArray(snap.dirtySample) ? snap.dirtySample : [];
      const sampleHint = sampleList.length
        ? `（如 ${sampleList.slice(0, 2).map((f) => `<code>${escapeHtml(f)}</code>`).join("、")}${sampleList.length > 2 ? " 等" : ""}）`
        : "";
      dirtyEl.title = sampleList.join(", ");
      dirtyEl.innerHTML = `本地有 ${snap.dirtyCount || 1} 项未提交修改${sampleHint}，已锁定在线拉取。`;
    } else if (snap?.desktopRebuildSuggested && !desktopInfo?.needsUpdate) {
      dirtyEl.hidden = false;
      dirtyEl.title = "";
      dirtyEl.innerHTML = `本次更新包含桌面外壳改动，可点击下方「更新桌面 App」同步重建。`;
    } else {
      dirtyEl.hidden = true;
      dirtyEl.title = "";
      dirtyEl.innerHTML = "";
    }
  }

  if (pendingSec && pendingCountEl && pendingListEl) {
    const commits = Array.isArray(snap?.pendingCommits) ? snap.pendingCommits : [];
    pendingSec.hidden = commits.length === 0;
    pendingCountEl.textContent = `${commits.length} 条提交`;
    if (pendingDetailsEl) {
      const hasStructuredNotes = Boolean(
        activeNotes?.pendingSource === "release_notes"
        || activeNotes?.pendingSource === "changelog",
      );
      const notesShown = Boolean(releaseNotesSec && !releaseNotesSec.hidden);
      pendingDetailsEl.open = !hasStructuredNotes && !notesShown;
    }
    pendingListEl.innerHTML = commits.map((c) => `
      <li class="update-pending-item">
        <span class="update-pending-sha">${escapeHtml(c.sha || "")}</span>
        <span class="update-pending-subject">${escapeHtml(c.subject || "")}</span>
      </li>
    `).join("");
  }

  if (desktopBtn) {
    const menuWrap = $("desktopUpdateMenuWrap");
    const openLabelEl = $("desktopUpdateOpenLabel");
    const silentLabelEl = $("desktopUpdateSilentLabel");
    const showDesktopBtn = Boolean(desktopInfo?.supported && (desktopInfo?.installed || desktopInfo?.canBuild));
    if (menuWrap) menuWrap.hidden = !showDesktopBtn;
    desktopBtn.hidden = !showDesktopBtn;
    desktopBtn.disabled = !showDesktopBtn || !desktopInfo?.canBuild || isBusy;
    if (!showDesktopBtn || !desktopInfo?.canBuild || isBusy) {
      setDesktopUpdateMenuOpen(false);
    }
    const verb = !desktopInfo?.installed
      ? "构建"
      : (desktopInfo?.needsUpdate ? "更新" : "重编");
    if (state.desktopUpdating || snap?.desktopUpdating) desktopBtn.textContent = "编译 App 中…";
    else desktopBtn.textContent = `${verb}桌面 App`;
    if (openLabelEl) openLabelEl.textContent = `${verb}并打开桌面 App`;
    if (silentLabelEl) silentLabelEl.textContent = `仅${verb}，不自动打开`;
  }

  if (restartBtn) {
    restartBtn.disabled = isBusy;
    restartBtn.textContent = snap?.restartPending ? "重启服务中…" : "重启服务";
  }
  if (checkBtn) {
    checkBtn.disabled = isBusy;
    checkBtn.textContent = state.updateChecking || snap?.checking ? "检查中…" : "立即检查";
  }
  if (applyBtn) {
    const canApply = Boolean(snap?.canApply) && !isBusy;
    applyBtn.disabled = !canApply;
    if (snap?.updating || state.updateApplying) applyBtn.textContent = "正在更新…";
    else if (snap?.restartPending) applyBtn.textContent = "重启服务中…";
    else if (snap?.hasUpdate) applyBtn.textContent = `一键更新 (${snap.behindCount || 1})`;
    else applyBtn.textContent = "已是最新";
  }
}

function applyUpdateStatusSnapshot(snap, { fromReconnectReady = false } = {}) {
  if (!snap || typeof snap !== "object") return;
  const prevHasUpdate = Boolean(state.updateStatus?.hasUpdate);
  state.updateStatus = snap;
  renderUpdateIndicators();
  if ($("updateModal")?.open) {
    renderUpdateModal();
  }

  if (fromReconnectReady) {
    try {
      const rawPending = sessionStorage.getItem(UPDATE_RESTART_FLAG_KEY);
      if (rawPending) {
        const parsed = JSON.parse(rawPending);
        const currentMeta = document.querySelector('meta[name="ac-ui-version"]')?.getAttribute("content") || "";
        const shaChanged = parsed?.prevSha && snap.localSha && parsed.prevSha !== snap.localSha;
        const uiChanged = snap.uiVersion && currentMeta && snap.uiVersion !== currentMeta;
        const manualRestart = Boolean(parsed?.manualRestart);
        if (!snap.updating && !snap.restartPending && (shaChanged || uiChanged || manualRestart)) {
          sessionStorage.removeItem(UPDATE_RESTART_FLAG_KEY);
          if (uiChanged && !($("promptInput")?.value || "").trim() && !state.editingQueueItem && !state.images.length) {
            location.reload();
            return;
          }
          showToastBanner(manualRestart ? "后台服务已重启完成" : "RemoDeck 已更新完成", {
            detail: snap.localShortSha ? `当前版本 ${snap.localShortSha}` : "服务已重新启动",
          });
        }
      }
    } catch {
      try { sessionStorage.removeItem(UPDATE_RESTART_FLAG_KEY); } catch {}
    }
  } else if (!prevHasUpdate && snap.hasUpdate && snap.behindCount > 0) {
    showToastBanner("发现 RemoDeck 新版本", {
      detail: `领先 ${snap.behindCount} 个提交，点击右上角菜单或侧栏底部即可一键更新`,
    });
  } else if (!state.updateStatus?.desktopApp?.needsUpdate && snap.desktopApp?.installed && snap.desktopApp?.needsUpdate) {
    showToastBanner("检测到桌面 App 壳子待更新", {
      detail: snap.desktopApp?.reason || "点击侧栏版本或右上角菜单可一键同步编译",
    });
  }
}

async function refreshUpdateStatus() {
  const snap = await apiGet("api/update");
  applyUpdateStatusSnapshot(snap);
  return snap;
}

async function triggerCheckUpdates() {
  if (state.updateChecking || state.updateApplying) return;
  state.updateChecking = true;
  renderUpdateIndicators();
  if ($("updateModal")?.open) renderUpdateModal();
  try {
    const snap = await apiPost("api/update/check", {}, { timeoutMs: 30_000 });
    applyUpdateStatusSnapshot(snap);
    if (snap.hasUpdate) {
      showToastBanner("检测到新版本", { detail: `共 ${snap.behindCount || 1} 条更新可用` });
    } else if (snap.updateState === "up_to_date") {
      showToastBanner("当前已是最新版本", { detail: snap.localShortSha ? `Commit ${snap.localShortSha}` : "" });
    }
  } catch (error) {
    const errMsg = formatActionError(error, "检查更新失败");
    showToastBanner("检查更新失败", { detail: errMsg, error: true });
    if (state.updateStatus) {
      state.updateStatus = { ...state.updateStatus, lastError: errMsg, phase: "error", phaseMessage: errMsg };
    }
  } finally {
    state.updateChecking = false;
    renderUpdateIndicators();
    if ($("updateModal")?.open) renderUpdateModal();
  }
}

async function saveUpdateConfig(patch) {
  try {
    const snap = await apiPost("api/update/config", patch);
    applyUpdateStatusSnapshot(snap);
    showToastBanner("更新设置已保存", {
      detail: snap.autoUpdateEnabled ? "已开启闲时自动更新" : (snap.autoCheckEnabled ? "已开启定期自动检测" : "已关闭自动检查"),
    });
  } catch (error) {
    showToastBanner("保存更新设置失败", { detail: formatActionError(error), error: true });
    renderUpdateModal();
  }
}

async function triggerApplyUpdate() {
  if (state.updateApplying || state.desktopUpdating || state.updateStatus?.restartPending) return;
  const anyRunning = Number(state.telemetry?.totals?.runningCount || 0) > 0;
  if (anyRunning && !window.confirm("当前仍有智能体正在运行，立即更新并重启服务会中断活跃流式输出。确定现在更新吗？")) {
    return;
  }
  state.updateApplying = true;
  if (state.updateStatus) {
    try {
      sessionStorage.setItem(UPDATE_RESTART_FLAG_KEY, JSON.stringify({
        prevSha: state.updateStatus.localSha || "",
        prevUiVersion: document.querySelector('meta[name="ac-ui-version"]')?.getAttribute("content") || "",
      }));
    } catch {}
  }
  renderUpdateIndicators();
  renderUpdateModal();
  try {
    const res = await apiPost("api/update/apply", { reason: "manual" }, { timeoutMs: 240_000 });
    if (res?.status) applyUpdateStatusSnapshot(res.status);
    showToastBanner(res?.updated ? "正在更新并重启服务" : "当前已是最新版本", {
      detail: res?.message || "",
    });
  } catch (error) {
    try { sessionStorage.removeItem(UPDATE_RESTART_FLAG_KEY); } catch {}
    const errMsg = formatActionError(error, "一键更新失败");
    showToastBanner("更新失败", { detail: errMsg, error: true });
    if (state.updateStatus) {
      state.updateStatus = { ...state.updateStatus, phase: "error", phaseMessage: errMsg, lastError: errMsg };
    }
  } finally {
    state.updateApplying = false;
    renderUpdateIndicators();
    if ($("updateModal")?.open) renderUpdateModal();
  }
}

async function triggerRestartService() {
  if (state.updateApplying || state.desktopUpdating || state.updateStatus?.restartPending) return;
  const anyRunning = Number(state.telemetry?.totals?.runningCount || 0) > 0;
  if (anyRunning && !window.confirm("当前仍有智能体正在运行，立即重启服务会中断活跃流式输出。确定现在重启吗？")) {
    return;
  }
  try {
    sessionStorage.setItem(UPDATE_RESTART_FLAG_KEY, JSON.stringify({
      manualRestart: true,
      prevSha: state.updateStatus?.localSha || "",
      prevUiVersion: document.querySelector('meta[name="ac-ui-version"]')?.getAttribute("content") || "",
    }));
  } catch {}
  try {
    const res = await apiPost("api/update/restart", { reason: "manual" }, { timeoutMs: 15_000 });
    if (res?.status) applyUpdateStatusSnapshot(res.status);
    showToastBanner("正在重启后台服务", {
      detail: res?.message || "页面将在服务恢复后自动重连",
    });
  } catch (error) {
    try { sessionStorage.removeItem(UPDATE_RESTART_FLAG_KEY); } catch {}
    const errMsg = Number(error?.status) === 404
      ? "当前后台进程尚未加载重启接口，请先在终端执行一次 restart"
      : formatActionError(error, "重启失败");
    if (state.updateStatus) {
      state.updateStatus = { ...state.updateStatus, phase: "error", phaseMessage: errMsg, lastError: errMsg };
    }
    showToastBanner("重启服务失败", { detail: errMsg, error: true });
  } finally {
    renderUpdateIndicators();
    if ($("updateModal")?.open) renderUpdateModal();
  }
}

function setDesktopUpdateMenuOpen(open) {
  const menu = $("desktopUpdateMenu");
  const btn = $("applyDesktopUpdateBtn");
  if (!menu || !btn) return;
  const nextOpen = Boolean(open) && !btn.disabled && !btn.hidden;
  menu.hidden = !nextOpen;
  btn.setAttribute("aria-expanded", nextOpen ? "true" : "false");
}

async function triggerDesktopAppUpdate({ openAfterBuild = true } = {}) {
  if (state.desktopUpdating || state.updateApplying || state.updateStatus?.restartPending) return;
  setDesktopUpdateMenuOpen(false);
  state.desktopUpdating = true;
  renderUpdateIndicators();
  if ($("updateModal")?.open) renderUpdateModal();
  try {
    const res = await apiPost("api/update/desktop", {
      reason: "manual",
      relaunchIfRunning: Boolean(openAfterBuild),
      openAfterBuild: Boolean(openAfterBuild),
    }, { timeoutMs: 240_000 });
    if (res?.status) applyUpdateStatusSnapshot(res.status);
    showToastBanner("桌面 App 壳子已更新", {
      detail: res?.message || (openAfterBuild ? "桌面 App 已重新构建并正在打开" : "桌面 App 已重新构建（未自动打开）"),
    });
  } catch (error) {
    const errMsg = formatActionError(error, "更新桌面 App 失败");
    showToastBanner("桌面 App 更新失败", { detail: errMsg, error: true });
    if (state.updateStatus) {
      state.updateStatus = { ...state.updateStatus, desktopPhase: "error", desktopMessage: errMsg };
    }
  } finally {
    state.desktopUpdating = false;
    renderUpdateIndicators();
    if ($("updateModal")?.open) renderUpdateModal();
  }
}

function formatAutomationTimeLabel(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n) || n <= 0) return "—";
  try {
    return new Date(n).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return "—";
  }
}

function syncAutomationProfileSelect(preferredProfileId = "") {
  const provider = $("autoProviderSelect")?.value || "codex";
  const select = $("autoProfileSelect");
  if (!select) return;
  const list = sortProfilesByAvailability(filterProfilesByProvider(state.profiles, provider));
  const prev = preferredProfileId || select.value;
  select.innerHTML = (list.length ? list : [{ id: defaultProfileForProvider(provider), label: "默认" }])
    .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(profileOptionLabel(p))}</option>`)
    .join("");
  if (prev && [...select.options].some((o) => o.value === prev)) {
    select.value = prev;
  } else {
    select.value = defaultProfileForProvider(provider);
  }
}

function syncAutomationEffortSelect(selectedModelObj = null, preferredEffort = "") {
  const effortSelect = $("autoEffortSelect");
  if (!effortSelect) return;
  const effortLabels = { low: "低思考", medium: "中思考", high: "高思考", xhigh: "超高思考", max: "最高思考" };
  const efforts = (selectedModelObj?.supportedReasoningEfforts || [])
    .map(normalizeEffortOptionValue)
    .filter(Boolean);
  const cleanPreferred = normalizeEffortOptionValue(preferredEffort);
  if (cleanPreferred && !efforts.includes(cleanPreferred)) {
    efforts.push(cleanPreferred);
  }
  if (!efforts.length) {
    effortSelect.innerHTML = `<option value="">默认强度</option>`;
    effortSelect.value = "";
    effortSelect.disabled = true;
    return;
  }
  effortSelect.disabled = false;
  effortSelect.innerHTML = [
    `<option value="">默认强度</option>`,
    ...efforts.map((e) => `<option value="${escapeHtml(e)}">${escapeHtml(effortLabels[e] || e)}</option>`),
  ].join("");
  effortSelect.value = cleanPreferred && efforts.includes(cleanPreferred) ? cleanPreferred : "";
}

function syncAutomationModelAndEffortSelects(preferredModel = "", preferredEffort = "") {
  const provider = $("autoProviderSelect")?.value || "codex";
  const modelSelect = $("autoModelSelect");
  if (!modelSelect) return;
  const rawModels = resolveModelsForProvider(state.modelsByProvider, state.allModels, provider);
  const models = ensurePreferredModelInList(rawModels, provider, preferredModel);
  modelSelect.innerHTML = `<option value="">跟随默认模型</option>${renderModelOptionsHtml(models)}`;
  if (preferredModel && [...modelSelect.options].some((o) => o.value === preferredModel)) {
    modelSelect.value = preferredModel;
  } else {
    modelSelect.value = "";
  }
  const selectedObj = models.find((m) => (m.id || m.model) === modelSelect.value) || null;
  syncAutomationEffortSelect(selectedObj, preferredEffort);
}

function syncAutomationScheduleInputs(rrule = "") {
  const scheduleSelect = $("autoScheduleSelect");
  const customField = $("autoScheduleCustomField");
  const customInput = $("autoScheduleCustomInput");
  if (!scheduleSelect) return;
  const trimmed = String(rrule || "").trim();
  const hasPreset = trimmed && [...scheduleSelect.options].some((o) => o.value === trimmed && o.value !== "__custom__");
  if (!trimmed) {
    scheduleSelect.value = "FREQ=DAILY;BYHOUR=9;BYMINUTE=0";
    if (customField) customField.hidden = true;
    if (customInput) customInput.value = "";
    return;
  }
  if (hasPreset) {
    scheduleSelect.value = trimmed;
    if (customField) customField.hidden = true;
    if (customInput) customInput.value = "";
  } else {
    scheduleSelect.value = "__custom__";
    if (customField) customField.hidden = false;
    if (customInput) customInput.value = trimmed;
  }
}

function resetAutomationForm() {
  $("automationCreateForm")?.reset();
  if ($("autoTaskIdInput")) $("autoTaskIdInput").value = "";
  if ($("automationCreateSummary")) {
    $("automationCreateSummary").textContent = "+ 新建通用定时任务（支持 Codex / Claude / Antigravity / Grok）";
  }
  if ($("autoSubmitBtn")) $("autoSubmitBtn").textContent = "保存并启用托管";
  if ($("autoCancelEditBtn")) $("autoCancelEditBtn").hidden = true;
  if ($("autoProviderSelect")) $("autoProviderSelect").value = "codex";
  syncAutomationProfileSelect();
  syncAutomationModelAndEffortSelects();
  syncAutomationScheduleInputs();
}

function startEditAutomationTask(task) {
  if (!task) return;
  if ($("autoTaskIdInput")) $("autoTaskIdInput").value = task.id || "";
  if ($("autoNameInput")) $("autoNameInput").value = task.name || "";
  const providerSelect = $("autoProviderSelect");
  const nextProvider = task.provider || "codex";
  if (providerSelect && [...providerSelect.options].some((o) => o.value === nextProvider)) {
    providerSelect.value = nextProvider;
  }
  syncAutomationProfileSelect(task.profileId || "");
  syncAutomationModelAndEffortSelects(task.model || "", task.reasoningEffort || "");
  syncAutomationScheduleInputs(task.rrule || "");
  if ($("autoCwdInput")) $("autoCwdInput").value = task.cwds?.[0] || "";
  if ($("autoPromptInput")) $("autoPromptInput").value = task.prompt || "";
  if ($("automationCreateSummary")) {
    $("automationCreateSummary").textContent = `编辑定时任务：${task.name || task.id}`;
  }
  if ($("autoSubmitBtn")) $("autoSubmitBtn").textContent = "保存修改";
  if ($("autoCancelEditBtn")) $("autoCancelEditBtn").hidden = false;
  const details = $("automationCreateDetails");
  if (details) {
    details.open = true;
    details.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  void refreshModelsForProfile(nextProvider, $("autoProfileSelect")?.value || "");
}

function renderAutomationsModal(snapshot = state.automationsSnapshot) {
  const badge = $("automationsSummaryBadge");
  const toggle = $("automationsGlobalToggle");
  const listEl = $("automationsList");
  const menuBadge = $("topbarMenuAutomationsBadge");
  const snap = snapshot || { enabled: true, tasks: [], summary: { total: 0, managedCount: 0 } };
  const managedCount = Number(snap.summary?.managedCount || 0);
  if (menuBadge) {
    menuBadge.hidden = managedCount <= 0;
    menuBadge.textContent = String(managedCount);
  }
  if (toggle) toggle.checked = snap.enabled !== false;
  if (badge) {
    badge.textContent = snap.enabled === false
      ? "后台托管已暂停"
      : `已托管 ${managedCount} / ${snap.summary?.total || 0}`;
  }
  if (!listEl) return;
  const tasks = Array.isArray(snap.tasks) ? snap.tasks : [];
  if (!tasks.length) {
    listEl.innerHTML = `<div class="empty-state">暂未在本机发现定时任务，可点击上方「+ 新建通用定时任务」创建。</div>`;
    return;
  }
  listEl.innerHTML = tasks.map((task) => {
    const pv = providerVisualMeta(task.provider);
    const sourceBadge = task.source === "agent-control" ? `自建 · ${pv.short}` : `${pv.short} 原生`;
    const statusPill = task.running
      ? `<span class="board-status-pill is-live">执行中</span>`
      : task.managed
        ? `<span class="board-status-pill is-live">托管中</span>`
        : `<span class="board-status-pill">未托管</span>`;
    const lastRunHtml = task.effectiveLastRunAtMs
      ? `<span>上次：${escapeHtml(formatAutomationTimeLabel(task.effectiveLastRunAtMs))}${task.lastStatus === "error" ? ` (失败: ${escapeHtml(task.lastError || "")})` : ""}</span>`
      : "";
    const nextRunHtml = task.nextRunAtMs
      ? `<span>下次：${escapeHtml(formatAutomationTimeLabel(task.nextRunAtMs))}</span>`
      : "";
    const modelLabel = task.model
      ? `${task.model}${task.reasoningEffort ? ` (${task.reasoningEffort})` : ""}`
      : "默认模型";
    const profileMetaHtml = task.source === "agent-control" && task.profileLabel && task.profileId !== "default" && task.profileLabel !== task.provider
      ? `<span>实例：${escapeHtml(task.profileLabel)}</span>`
      : "";
    const modelMetaHtml = `<span>模型：${escapeHtml(modelLabel)}</span>`;
    const threadBtn = task.lastThreadId
      ? `<button type="button" class="btn-secondary btn-xs" data-auto-open-thread="${escapeHtml(task.lastThreadId)}">查看会话</button>`
      : "";
    const editBtn = task.source === "agent-control"
      ? `<button type="button" class="btn-secondary btn-xs" data-auto-edit="${escapeHtml(task.taskKey || task.id)}">编辑</button>`
      : "";
    const delBtn = `<button type="button" class="btn-secondary btn-xs" data-auto-delete="${escapeHtml(task.taskKey || task.id)}">删除</button>`;
    return `
      <div class="automation-item">
        <div class="automation-item-top">
          <div class="automation-item-title-wrap">
            <span class="thread-micro-tag is-${escapeHtml(pv.tone)}">${pv.iconSvg || ""}${escapeHtml(sourceBadge)}</span>
            <strong class="automation-item-name">${escapeHtml(task.name || task.id)}</strong>
            ${statusPill}
          </div>
          <div class="automation-item-actions">
            ${threadBtn}
            ${editBtn}
            <button type="button" class="btn-primary btn-xs" data-auto-run="${escapeHtml(task.taskKey)}"${task.running ? " disabled" : ""}>立即执行</button>
            <button type="button" class="btn-secondary btn-xs" data-auto-toggle="${escapeHtml(task.taskKey)}" data-auto-next-managed="${task.managed ? "0" : "1"}">${task.managed ? "暂停托管" : "开启托管"}</button>
            ${delBtn}
          </div>
        </div>
        <div class="automation-item-meta">
          ${profileMetaHtml}
          ${modelMetaHtml}
          <span>周期：${escapeHtml(task.scheduleLabel || "手动触发")}</span>
          ${nextRunHtml}
          ${lastRunHtml}
          ${task.cwds?.[0] ? `<span title="${escapeHtml(task.cwds[0])}">目录：${escapeHtml(projectBaseName(task.cwds[0]))}</span>` : ""}
        </div>
        ${task.prompt ? `<div class="automation-item-prompt">${escapeHtml(task.prompt)}</div>` : ""}
      </div>
    `;
  }).join("");
}

async function refreshAutomations() {
  const snap = await apiGet("api/automations");
  state.automationsSnapshot = snap;
  renderAutomationsModal(snap);
  return snap;
}

async function openAutomationsModal() {
  setTopbarMenuOpen(false);
  setComposerConfigOpen(false);
  const modal = $("automationsModal");
  if (!modal) return;
  if (!$("autoTaskIdInput")?.value) {
    resetAutomationForm();
  }
  renderAutomationsModal();
  if (!modal.open) modal.showModal();
  try {
    await refreshAutomations();
  } catch (error) {
    const bar = $("automationsStatusBar");
    if (bar) {
      bar.hidden = false;
      bar.className = "composer-status is-error";
      bar.textContent = formatActionError(error, "加载定时任务失败");
    }
  }
}

async function renderCliVersionsInModal(cliStatus = null) {
  const listEl = $("cliVersionsList");
  const cliBadge = $("updateTabCliBadge");
  const statusMap = cliStatus || (await apiGet("api/cli/status").then((r) => r?.cliStatus).catch(() => null)) || {};
  const entries = Object.values(statusMap).filter((item) => item?.updatable);

  if (cliBadge) {
    const upgradableCount = entries.filter((item) => Boolean(item?.updateAvailable)).length;
    if (upgradableCount > 0) {
      cliBadge.textContent = `可升 ${upgradableCount}`;
      cliBadge.className = "update-tab-badge is-warn";
    } else if (entries.length > 0) {
      cliBadge.textContent = String(entries.length);
      cliBadge.className = "update-tab-badge";
    } else {
      cliBadge.textContent = "";
      cliBadge.className = "update-tab-badge";
    }
  }

  if (!listEl) return;
  if (!entries.length) {
    listEl.innerHTML = `<div class="update-hero-sub">暂无可检测的 CLI 工具</div>`;
    return;
  }
  listEl.innerHTML = entries.map((item) => {
    const ver = item.installedVersion ? `v${item.installedVersion}` : (item.cliInstalled ? "已安装" : "未安装");
    const sourceLabel = (item.installSource === "homebrew-cask" || item.installSource === "homebrew-formula")
      ? "Homebrew"
      : (item.installSource === "npm" ? "npm" : "");
    const verText = sourceLabel ? `${ver} · ${sourceLabel}` : ver;
    const tagCls = item.updateAvailable ? "is-warn" : (item.cliInstalled ? "is-ok" : "");
    const tagLabel = item.updateAvailable
      ? `可升级 v${item.latestVersion || ""}`
      : (item.latestVersion ? "已最新" : (item.cliInstalled ? "已安装" : "未安装"));
    const actionBtn = item.updateAvailable
      ? `<button type="button" class="btn-primary btn-xs" data-cli-upgrade="${escapeHtml(item.provider)}"${item.installing ? " disabled" : ""}>${item.installing ? "升级中…" : "升级"}</button>`
      : "";
    const errorMsg = item.lastError
      ? String(item.lastError).split(/\r?\n/)[0].slice(0, 140)
      : "";
    const errorHtml = errorMsg
      ? `<div class="cli-version-error" title="${escapeHtml(item.lastError)}">${escapeHtml(errorMsg)}</div>`
      : "";
    return `
      <div class="cli-card">
        <div class="cli-card-head">
          <span class="cli-card-name">${escapeHtml(item.label || item.provider)}</span>
          <span class="update-desktop-tag ${tagCls}">${escapeHtml(tagLabel)}</span>
        </div>
        <div class="cli-card-meta">
          <span class="cli-card-ver" title="${escapeHtml(item.executable || item.manualHint || "")}">${escapeHtml(verText)}</span>
          ${actionBtn}
        </div>
        ${errorHtml}
      </div>
    `;
  }).join("");
}

async function openUpdateModal() {
  setTopbarMenuOpen(false);
  setComposerConfigOpen(false);
  const modal = $("updateModal");
  if (!modal) return;
  if (state.updateStatus?.hasUpdate) {
    state.updateModalTab = "notes";
    state.updateNotesVersionKey = "";
    state.updateNotesCategory = "all";
  }
  renderUpdateModal();
  if (!modal.open) modal.showModal();
  try {
    await Promise.all([
      refreshUpdateStatus(),
      apiGet("api/settings").then((res) => {
        const titleEl = $("agentAutoTitleToggle");
        if (titleEl && res?.settings) {
          titleEl.checked = res.settings.agentAutoTitle !== false;
        }
        const cliEl = $("autoUpdateCliToggle");
        if (cliEl && res?.settings) {
          cliEl.checked = res.settings.autoUpdateCli !== false;
        }
        const compactEl = $("agyAutoCompactToggle");
        if (compactEl && res?.settings) {
          compactEl.checked = res.settings.agyAutoCompact !== false;
        }
        const retry401El = $("agyAutoRetryAuth401Toggle");
        if (retry401El && res?.settings) {
          retry401El.checked = res.settings.agyAutoRetryAuth401 !== false;
        }
        const sharedMemEl = $("sharedMemoryToggle");
        if (sharedMemEl && res?.settings) {
          sharedMemEl.checked = res.settings.sharedMemoryEnabled !== false;
        }
        const compactTokensEl = $("agyAutoCompactTokensSelect");
        if (compactTokensEl && res?.settings?.agyAutoCompactTokens) {
          const value = String(res.settings.agyAutoCompactTokens);
          if (![...compactTokensEl.options].some((opt) => opt.value === value)) {
            compactTokensEl.append(new Option(`${Math.round(Number(value) / 1000)}K`, value));
          }
          compactTokensEl.value = value;
          compactTokensEl.disabled = res.settings.agyAutoCompact === false;
        }
        updateSettingsTabBadge();
      }).catch(() => {}),
      renderCliVersionsInModal(),
      loadMemoryAndSkillSettings(),
    ]);
  } catch {
    // Keep existing modal content when status check is transient.
  }
}

function renderSkillSyncStatus(status) {
  const container = $("skillSyncTargets");
  if (!container) return;
  const targets = Array.isArray(status?.targets) ? status.targets : [];
  if (!targets.length) {
    container.innerHTML = `<span class="task-muted">未检测到可同步客户端</span>`;
    return;
  }
  const names = { claude: "Claude Code", codex: "Codex", antigravity: "Antigravity" };
  container.innerHTML = targets.map((item) => {
    const label = item.upToDate ? "已同步" : (item.conflict ? "有同名未托管目录" : (item.installed ? "需更新" : "未安装"));
    const cls = item.upToDate ? "is-ok" : (item.conflict ? "is-warn" : "is-idle");
    return `<span class="skill-sync-pill ${cls}" title="${escapeHtml(item.path || "")}">${escapeHtml(names[item.client] || item.client)}：${escapeHtml(label)}</span>`;
  }).join("");
}

async function loadMemoryAndSkillSettings() {
  try {
    const [memCfg, skillStatus] = await Promise.all([
      apiGet("api/memory/config", { useEtagCache: false }),
      apiGet("api/skills/status", { useEtagCache: false }),
    ]);
    state.memoryConfig = memCfg;
    state.skillSyncStatus = skillStatus;
    const sharedMemEl = $("sharedMemoryToggle");
    if (sharedMemEl && memCfg) sharedMemEl.checked = memCfg.enabled !== false;
    const vaultInput = $("memoryVaultPathInput");
    if (vaultInput && memCfg) vaultInput.value = memCfg.vaultPath || "";
    const hintEl = $("memoryVaultEffectiveHint");
    if (hintEl && memCfg) {
      hintEl.textContent = memCfg.isDefaultVault
        ? `当前生效（内置默认）：${memCfg.effectiveVaultPath || "未启用"}`
        : `当前生效：${memCfg.effectiveVaultPath || "未启用"}`;
    }
    renderSkillSyncStatus(skillStatus);
    updateSettingsTabBadge();
  } catch {
    // Keep modal usable if settings load fails transiently.
  }
}

function localAppLaunchUrl(app) {
  const id = String(app?.id || "").trim();
  if (!id) return "#";
  return `./apps/${encodeURIComponent(id)}/`;
}

function renderLocalApps() {
  const apps = Array.isArray(state.localApps) ? state.localApps : [];
  const hasApps = apps.length > 0;

  const strip = $("localAppsStrip");
  if (strip) {
    strip.hidden = !hasApps;
    strip.innerHTML = hasApps
      ? apps.map((app) => {
        const href = escapeHtml(localAppLaunchUrl(app));
        const name = escapeHtml(app.name || app.id);
        const desc = escapeHtml(app.description || "");
        const tip = desc ? `${name} · ${desc}` : name;
        return `<a class="local-app-chip" href="${href}" title="${tip}">`
          + `<span class="local-app-chip-name">${name}</span>`
          + `<span class="local-app-open-mark" aria-hidden="true">↗</span>`
          + `</a>`;
      }).join("")
      : "";
    if (hasApps) hydrateDeclarativeIcons(strip);
  }

  const remoteSec = $("remoteLocalAppsSection");
  const remoteList = $("remoteLocalAppsList");
  if (remoteSec && remoteList) {
    remoteSec.hidden = !hasApps;
    remoteList.innerHTML = hasApps
      ? apps.map((app) => {
        const href = escapeHtml(localAppLaunchUrl(app));
        const name = escapeHtml(app.name || app.id);
        const desc = escapeHtml(app.description || "复用当前安全通道访问本机工作台");
        return `<div class="remote-local-app-item">`
          + `<div class="remote-local-app-meta">`
          + `<strong>${name}</strong>`
          + `<span>${desc}</span>`
          + `</div>`
          + `<a class="btn-primary btn-xs remote-local-app-open" href="${href}">`
          + `<span class="btn-icon-glyph" data-icon="external-link" data-icon-size="12" aria-hidden="true"></span>`
          + `<span>直接进入</span>`
          + `</a>`
          + `</div>`;
      }).join("")
      : "";
    if (hasApps) hydrateDeclarativeIcons(remoteList);
  }
}

async function refreshLocalApps() {
  try {
    const res = await apiGet("api/apps");
    state.localApps = Array.isArray(res?.apps) ? res.apps : [];
  } catch {
    state.localApps = [];
  }
  renderLocalApps();
  return state.localApps;
}

const LAN_FALLBACK_URL_STORAGE_KEY = "ac.lanFallbackUrl";
let lanFallbackTimer = null;
let lanFallbackChecking = false;

function isCurrentLanSession() {
  if (typeof location === "undefined") return false;
  return isLocalOrLanHostname(location.hostname) && !isLoopbackHostname(location.hostname);
}

function isCurrentRemoteSession() {
  if (typeof location === "undefined") return false;
  return !isLocalOrLanHostname(location.hostname);
}

function getSavedLanFallbackUrl() {
  const fromState = String(state.lanInfo?.fallbackUrl || "").trim();
  if (fromState) return fromState;
  try {
    return String(localStorage.getItem(LAN_FALLBACK_URL_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function buildUrlWithCurrentThread(baseUrl) {
  try {
    const target = new URL(baseUrl);
    if (state.activeThreadId) {
      target.searchParams.set("thread", state.activeThreadId);
    } else {
      target.searchParams.delete("thread");
    }
    return target.toString();
  } catch {
    return baseUrl;
  }
}

function syncNetworkSwitchMenuButton() {
  const btn = $("switchNetworkLinkBtn");
  if (!btn) return;
  if (isCurrentLanSession()) {
    const fallbackUrl = getSavedLanFallbackUrl();
    if (fallbackUrl) {
      btn.hidden = false;
      btn.textContent = "切回公网中继";
      btn.title = "切回公网中继访问地址";
      return;
    }
  } else if (isCurrentRemoteSession() && state.lanInfo?.enabled && state.lanInfo?.primaryUrl) {
    btn.hidden = false;
    btn.textContent = "切到局域网直连";
    btn.title = `切换到局域网直连 (${state.lanInfo.primaryUrl})`;
    return;
  }
  btn.hidden = true;
}

function applyLanInfo(lan) {
  if (!lan || typeof lan !== "object") return;
  state.lanInfo = lan;
  if (isCurrentLanSession() && lan.fallbackUrl) {
    try {
      localStorage.setItem(LAN_FALLBACK_URL_STORAGE_KEY, lan.fallbackUrl);
    } catch {}
  }
  syncNetworkSwitchMenuButton();
}

function clearLanFallbackTimer() {
  if (lanFallbackTimer) {
    clearTimeout(lanFallbackTimer);
    lanFallbackTimer = null;
  }
}

async function probeUrlReachable(url, { timeoutMs = 2500, noCors = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      mode: noCors ? "no-cors" : "same-origin",
      signal: controller.signal,
    });
    return noCors ? true : response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function runLanFallbackCheck() {
  if (lanFallbackChecking || !isCurrentLanSession() || state.sseConnected) return;
  const fallbackUrl = getSavedLanFallbackUrl();
  if (!fallbackUrl) return;
  lanFallbackChecking = true;
  try {
    const localOk = await probeUrlReachable(apiUrl("health"), { timeoutMs: 2000, noCors: false });
    if (localOk || state.sseConnected) return;
    const remoteHealthUrl = new URL("health", fallbackUrl).toString();
    const remoteOk = await probeUrlReachable(remoteHealthUrl, { timeoutMs: 3000, noCors: true });
    if (!remoteOk || state.sseConnected) return;
    showToastBanner("局域网已断开，正在切回公网中继…", { sticky: true });
    location.replace(buildUrlWithCurrentThread(fallbackUrl));
  } finally {
    lanFallbackChecking = false;
  }
}

function scheduleLanFallbackCheck(delayMs = 5000) {
  if (!isCurrentLanSession() || !getSavedLanFallbackUrl()) return;
  if (lanFallbackTimer) return;
  lanFallbackTimer = setTimeout(() => {
    lanFallbackTimer = null;
    void runLanFallbackCheck();
  }, delayMs);
}

async function switchNetworkLink() {
  if (isCurrentLanSession()) {
    const fallbackUrl = getSavedLanFallbackUrl();
    if (!fallbackUrl) return;
    showToastBanner("正在切回公网中继…");
    location.href = buildUrlWithCurrentThread(fallbackUrl);
    return;
  }
  if (!isCurrentRemoteSession()) return;
  try {
    const fallbackUrl = `${location.origin}${location.pathname}`;
    const data = await apiPost("api/remote/lan-switch", {
      threadId: state.activeThreadId || "",
      fallbackUrl,
    });
    if (!data?.connectUrl) {
      throw new Error("未获取到可用的局域网连接地址");
    }
    showToastBanner(`正在切换到局域网直连（${data.lan?.primaryUrl || ""}）…`, { sticky: true });
    location.href = data.connectUrl;
  } catch (error) {
    const errMsg = formatActionError(error, "切换局域网直连失败");
    showToastBanner("切换局域网直连失败", { detail: errMsg, error: true });
  }
}

function syncRemoteButtonIndicator() {
  const active = state.tunnelStatus?.state === "running" || Boolean(state.remoteStatus?.connected);
  const dot = $("remoteActiveDot");
  if (dot) dot.hidden = !active;
  $("remoteModalBtn")?.classList.toggle("is-online", active);
}

async function openRemoteModal({ silentOpen = false } = {}) {
  if (!silentOpen) {
    setTopbarMenuOpen(false);
    setComposerConfigOpen(false);
  }
  const modal = $("remoteModal");
  const [status] = await Promise.all([
    apiGet("api/remote").catch(() => null),
    refreshLocalApps().catch(() => null),
  ]);
  if (status) {
    renderRemoteStatus(status);
  }
  if (!silentOpen && !modal.open) {
    modal.showModal();
  }
}

function renderTunnelStatus(tunnel) {
  if (!tunnel || typeof tunnel !== "object") return;
  state.tunnelStatus = tunnel;
  syncRemoteButtonIndicator();

  const textMap = {
    stopped: "未开启",
    starting: "正在启动…",
    running: "运行中（可扫码连接）",
    missing_binary: "未安装 cloudflared",
    error: "启动失败",
    disabled: "已禁用",
  };
  const pill = $("tunnelStateText");
  if (pill) {
    pill.textContent = textMap[tunnel.state] || tunnel.state || "未开启";
    pill.className = `tunnel-state-pill${
      tunnel.state === "running" ? " is-running"
        : tunnel.state === "starting" ? " is-starting"
          : (tunnel.state === "error" || tunnel.state === "missing_binary") ? " is-error"
            : ""
    }`;
  }

  const canManage = tunnel.canManage !== false;
  if ($("tunnelReadonlyNotice")) $("tunnelReadonlyNotice").hidden = canManage;
  if ($("tunnelManageWrap")) $("tunnelManageWrap").hidden = !canManage;

  const missingBox = $("tunnelMissingBox");
  if (missingBox) {
    missingBox.hidden = !(canManage && (tunnel.state === "missing_binary" || tunnel.installed === false));
  }
  const installCmdCode = $("tunnelInstallCmdCode");
  if (installCmdCode && tunnel.installHint) {
    installCmdCode.textContent = tunnel.installHint;
  }

  const errEl = $("tunnelErrorText");
  if (errEl) {
    const showErr = canManage && tunnel.state === "error" && Boolean(tunnel.lastError);
    errEl.hidden = !showErr;
    errEl.textContent = showErr ? tunnel.lastError : "";
  }

  const isRunning = tunnel.state === "running";
  const isStarting = tunnel.state === "starting";
  const startBtn = $("startTunnelBtn");
  if (startBtn) {
    startBtn.hidden = isRunning;
    startBtn.disabled = state.tunnelBusy || isStarting || tunnel.state === "disabled";
    startBtn.innerHTML = (state.tunnelBusy || isStarting)
      ? `${iconSvg("clock", { size: 13 })}<span>正在分配公网加密地址…</span>`
      : `${iconSvg("bolt", { size: 13 })}<span>一键开启并生成二维码</span>`;
  }
  if ($("rotateTunnelBtn")) {
    $("rotateTunnelBtn").hidden = !isRunning;
    $("rotateTunnelBtn").disabled = state.tunnelBusy;
  }
  if ($("stopTunnelBtn")) {
    $("stopTunnelBtn").hidden = !(isRunning || isStarting);
    $("stopTunnelBtn").disabled = state.tunnelBusy;
  }

  const qrWrap = $("tunnelQrWrap");
  if (qrWrap) {
    if (canManage && isRunning && tunnel.qrDataUrl && tunnel.pairUrl) {
      qrWrap.hidden = false;
      $("tunnelQrImg").src = tunnel.qrDataUrl;
      $("tunnelPairUrlInput").value = tunnel.pairUrl;
    } else {
      qrWrap.hidden = true;
    }
  }
}

function renderRemoteStatus(status) {
  if (!status || typeof status !== "object") return;
  state.remoteStatus = status;
  syncRemoteButtonIndicator();

  const textMap = {
    unpaired: "未配对",
    connecting: "正在连接中继…",
    connected: "已连接中继（手机可随时访问）",
    disconnected: "连接断开，自动重连中…",
    revoked: "凭证已被撤销，请重新配对",
    disabled: "已禁用远程中继",
  };
  $("remoteStateText").textContent = textMap[status.state] || status.state || "未知";
  if (status.relayUrl) $("relayUrlInput").value = status.relayUrl;
  if (status.label) $("hostLabelInput").value = status.label;

  const canManage = status.canManage !== false;
  $("unpairBtn").hidden = !canManage || !status.paired;
  if ($("remotePairSubmitBtn")) $("remotePairSubmitBtn").hidden = !canManage;
  if ($("remoteReadonlyNotice")) $("remoteReadonlyNotice").hidden = canManage;
  for (const el of $("remotePairForm")?.querySelectorAll("input") || []) {
    el.disabled = !canManage;
  }

  const qrWrap = $("remoteQrWrap");
  if (canManage && status.paired && status.qrDataUrl) {
    qrWrap.hidden = false;
    $("remoteQrImg").src = status.qrDataUrl;
    $("remotePairUrlInput").value = status.pairUrl || "";
  } else {
    qrWrap.hidden = true;
  }

  if ($("relayAdvancedSection") && status.paired) {
    $("relayAdvancedSection").open = true;
  }
  if (status.tunnel) {
    renderTunnelStatus(status.tunnel);
  }
  if (status.fixedTunnel) {
    renderFixedTunnelStatus(status.fixedTunnel);
  }
  if (status.lan) {
    applyLanInfo(status.lan);
  }
}

function renderFixedTunnelStatus(fixed) {
  if (!fixed || typeof fixed !== "object") return;
  state.fixedTunnelStatus = fixed;

  const canManage = fixed.canManage !== false;
  const pill = $("tsFunnelStateText");
  if (pill) {
    if (!fixed.installed) {
      pill.textContent = "未安装";
      pill.className = "tunnel-state-pill";
    } else if (fixed.active) {
      pill.textContent = "Funnel 运行中";
      pill.className = "tunnel-state-pill is-running";
    } else if (fixed.dnsName) {
      pill.textContent = "已就绪（未开启）";
      pill.className = "tunnel-state-pill";
    } else {
      pill.textContent = "未登录 / 未启用 MagicDNS";
      pill.className = "tunnel-state-pill is-error";
    }
  }

  if ($("tsMissingBox")) {
    $("tsMissingBox").hidden = !(canManage && fixed.installed === false);
  }
  if ($("tsInstallCmdCode") && fixed.installHint) {
    $("tsInstallCmdCode").textContent = fixed.installHint;
  }
  if ($("tsErrorText")) {
    const showErr = canManage && Boolean(fixed.lastError);
    $("tsErrorText").hidden = !showErr;
    $("tsErrorText").textContent = showErr ? fixed.lastError : "";
  }
  if ($("startTsFunnelBtn")) {
    $("startTsFunnelBtn").disabled = !canManage || state.fixedTunnelBusy || !fixed.installed;
    $("startTsFunnelBtn").textContent = state.fixedTunnelBusy
      ? "正在处理…"
      : fixed.active
        ? "刷新 Tailscale Funnel 二维码"
        : "一键开启 Tailscale Funnel";
  }
  if ($("stopTsFunnelBtn")) {
    $("stopTsFunnelBtn").hidden = !(canManage && fixed.active);
    $("stopTsFunnelBtn").disabled = state.fixedTunnelBusy;
  }

  const input = $("fixedPublicUrlInput");
  if (input && document.activeElement !== input) {
    if (fixed.fixedPublicUrl) {
      input.value = fixed.fixedPublicUrl;
    } else if (!input.value && fixed.publicUrl) {
      input.value = fixed.publicUrl;
    }
  }
  if ($("saveFixedPairBtn")) {
    $("saveFixedPairBtn").disabled = !canManage || state.fixedTunnelBusy;
  }
  const hasPairedFixed = Boolean(canManage && fixed.fixedPublicUrl && fixed.pairUrl);
  if ($("rotateFixedPairBtn")) {
    $("rotateFixedPairBtn").hidden = !hasPairedFixed;
    $("rotateFixedPairBtn").disabled = state.fixedTunnelBusy;
  }
  if ($("clearFixedPairBtn")) {
    $("clearFixedPairBtn").hidden = !(canManage && fixed.fixedPublicUrl);
    $("clearFixedPairBtn").disabled = state.fixedTunnelBusy;
  }
  const qrWrap = $("fixedQrWrap");
  if (qrWrap) {
    if (hasPairedFixed && fixed.qrDataUrl) {
      qrWrap.hidden = false;
      $("fixedQrImg").src = fixed.qrDataUrl;
      $("fixedPairUrlInput").value = fixed.pairUrl;
    } else {
      qrWrap.hidden = true;
    }
  }
}

async function toggleProjectPin(cwd) {
  const key = normalizeProjectCwd(cwd);
  if (!key) return;
  const currentPinned = Boolean(state.projectsMeta[key]?.pinned);
  try {
    const res = await apiPost("api/project/meta", { cwd: key, pinned: !currentPinned });
    state.projectsMeta = res.projectsMeta || state.projectsMeta;
    renderThreadList();
    renderTopbarAndControls();
    renderProjectBoard();
    renderProjectTaskStrip();
    showToastBanner(!currentPinned ? "已关注置顶该项目" : "已取消关注", {
      detail: state.projectsMeta[key]?.alias || projectBaseName(key),
    });
  } catch (error) {
    showToastBanner("更新项目关注失败", { detail: formatActionError(error), error: true });
  }
}

async function promptProjectAlias(cwd) {
  const key = normalizeProjectCwd(cwd);
  if (!key) return;
  const currentAlias = state.projectsMeta[key]?.alias || "";
  const next = prompt(`为「${projectBaseName(key)}」设置简称（方便搜索与语音匹配，留空清除）：`, currentAlias);
  if (next === null) return;
  try {
    const res = await apiPost("api/project/meta", { cwd: key, alias: next.trim() });
    state.projectsMeta = res.projectsMeta || state.projectsMeta;
    renderThreadList();
    renderTopbarAndControls();
    renderProjectBoard();
    renderProjectTaskStrip();
  } catch (error) {
    showToastBanner("保存项目简称失败", { detail: formatActionError(error), error: true });
  }
}

function isNewThreadDraftActive() {
  return Boolean(!state.activeThread && state.newThreadCwd !== null && !state.boardOpen);
}

function setNewThreadCwdPickerStatus(message = "") {
  const statusEl = $("newThreadCwdStatus");
  if (!statusEl) return;
  const text = String(message || "").trim();
  statusEl.textContent = text;
  statusEl.hidden = !text;
}

function positionNewThreadCwdPopover() {
  const pop = $("newThreadCwdPopover");
  const trigger = $("newThreadCwdBtn");
  if (!pop || !trigger || pop.hidden || typeof window === "undefined") return;
  const rect = trigger.getBoundingClientRect();
  const vw = window.innerWidth || document.documentElement.clientWidth || 1024;
  const vh = window.innerHeight || document.documentElement.clientHeight || 768;
  const width = Math.min(460, vw - 16);
  pop.style.width = `${width}px`;
  pop.style.left = "0px";
  pop.style.top = "0px";
  const popRect = pop.getBoundingClientRect();
  const popH = Math.min(popRect.height || 320, Math.max(200, vh - 16));
  let left = Math.round(rect.left);
  if (left + width > vw - 8) {
    left = vw - width - 8;
  }
  left = Math.max(8, left);
  let top = Math.round(rect.bottom + 6);
  if (top + popH > vh - 8 && rect.top > popH + 14) {
    top = Math.round(rect.top - popH - 6);
  }
  top = Math.max(8, Math.min(top, vh - 80));
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function renderNewThreadCwdPickerList({ scrollToHighlight = false } = {}) {
  const listEl = $("newThreadCwdList");
  if (!listEl) return;
  const { items } = collectNewThreadCwdOptions({
    threads: state.threads,
    projectsMeta: state.projectsMeta,
    currentCwd: state.newThreadCwd || "",
    scopedProjectCwd: state.scopedProjectCwd || "",
    query: state.newThreadCwdPickerQuery,
  });
  state.newThreadCwdPickerOptions = items;
  if (!items.length) {
    state.newThreadCwdPickerIndex = -1;
  } else {
    if (state.newThreadCwdPickerIndex < 0) state.newThreadCwdPickerIndex = 0;
    if (state.newThreadCwdPickerIndex >= items.length) state.newThreadCwdPickerIndex = items.length - 1;
  }
  listEl.innerHTML = renderNewThreadCwdListHtml(items, {
    highlightedIndex: state.newThreadCwdPickerIndex,
    escapeHtml,
    iconSvg,
  });
  if (scrollToHighlight && state.newThreadCwdPickerIndex >= 0) {
    const activeEl = listEl.querySelector(`[data-cwd-option-index="${state.newThreadCwdPickerIndex}"]`);
    activeEl?.scrollIntoView?.({ block: "nearest" });
  }
}

function closeNewThreadCwdPicker({ restoreFocus = false } = {}) {
  const pop = $("newThreadCwdPopover");
  const btn = $("newThreadCwdBtn");
  state.newThreadCwdPickerOpen = false;
  if (pop) pop.hidden = true;
  btn?.setAttribute("aria-expanded", "false");
  setNewThreadCwdPickerStatus("");
  if (restoreFocus) btn?.focus?.();
}

function openNewThreadCwdPicker() {
  if (!isNewThreadDraftActive()) return;
  const pop = $("newThreadCwdPopover");
  const btn = $("newThreadCwdBtn");
  const input = $("newThreadCwdSearchInput");
  const browseBtn = $("newThreadCwdBrowseBtn");
  if (!pop || !btn) return;

  closeCustomSelectMenu();
  setTopbarMenuOpen(false);
  setComposerConfigOpen(false);

  state.newThreadCwdPickerOpen = true;
  state.newThreadCwdPickerQuery = "";
  state.newThreadCwdPickerIndex = 0;
  setNewThreadCwdPickerStatus("");

  const canBrowseLocal = typeof isLoopbackHostname === "function" && isLoopbackHostname(location.hostname);
  if (browseBtn) {
    browseBtn.hidden = !canBrowseLocal;
    browseBtn.disabled = state.newThreadCwdPickingLocal;
  }
  if (input) input.value = "";
  renderNewThreadCwdPickerList();
  const selectedIdx = state.newThreadCwdPickerOptions.findIndex((item) => item.selected);
  if (selectedIdx >= 0) {
    state.newThreadCwdPickerIndex = selectedIdx;
    renderNewThreadCwdPickerList({ scrollToHighlight: true });
  }
  pop.hidden = false;
  btn.setAttribute("aria-expanded", "true");
  positionNewThreadCwdPopover();
  input?.focus?.();
}

function applyNewThreadCwd(nextCwd) {
  if (!isNewThreadDraftActive()) return;
  const normalized = typeof normalizeDraftCwdInput === "function"
    ? normalizeDraftCwdInput(nextCwd)
    : String(nextCwd || "").trim();
  state.newThreadCwd = normalized || "";
  closeNewThreadCwdPicker();
  renderTopbarAndControls();
  $("promptInput")?.focus?.();
}

async function browseLocalDirectoryForNewThread() {
  if (state.newThreadCwdPickingLocal || !isNewThreadDraftActive()) return;
  const browseBtn = $("newThreadCwdBrowseBtn");
  state.newThreadCwdPickingLocal = true;
  setNewThreadCwdPickerStatus("");
  if (browseBtn) {
    browseBtn.disabled = true;
    browseBtn.innerHTML = `${iconSvg("folder", { size: 12 })}<span>选择中…</span>`;
  }
  try {
    const res = await apiPost("api/fs/pick-directory", {
      initialDir: state.newThreadCwd || "",
    }, { timeoutMs: 125_000 });
    if (res?.path) {
      applyNewThreadCwd(res.path);
    }
  } catch (error) {
    setNewThreadCwdPickerStatus(formatActionError(error, "无法打开本机文件夹选择器，请直接输入目录路径"));
  } finally {
    state.newThreadCwdPickingLocal = false;
    if (browseBtn) {
      browseBtn.disabled = false;
      browseBtn.innerHTML = `${iconSvg("folder", { size: 12 })}<span>浏览…</span>`;
    }
  }
}

async function openNewThreadModal({ cwd = "", provider = "", model = "", promptText = "", preserveTaskDraft = false } = {}) {
  setTopbarMenuOpen(false);
  setComposerConfigOpen(false);
  if (typeof closeNewThreadCwdPicker === "function") closeNewThreadCwdPicker();
  const chosenProvider = provider || defaultNewThreadProvider();
  await selectThread("", { newThreadCwd: cwd, preserveTaskDraft });
  $("composerProviderSelect").value = chosenProvider;
  syncComposerProfileSelect();
  if (model) saveNewThreadPrefs(chosenProvider, { model });
  syncModelAndEffortSelectors();
  state.composerGoal = false;
  state.images = [];
  renderComposerImages();
  $("promptInput").value = promptText;
  renderTopbarAndControls();
  setSidebarOpen(false);
  $("promptInput").focus();
}

async function loadMissionOverview({ trigger = "view", force = false } = {}) {
  if (state.scopedProjectCwd) return;
  state.missionOverviewLoading = true;
  if (isBoardViewActive() && isOverviewBoardMode() && !state.missionOverview) {
    renderProjectBoard();
  }
  try {
    const qs = new URLSearchParams({ trigger });
    if (force) qs.set("force", "1");
    const locale = currentUiLocale();
    if (locale) qs.set("locale", locale);
    const data = await apiGet(`/api/overview?${qs.toString()}`);
    if (data && Array.isArray(data.domains)) {
      state.missionOverview = data;
    }
  } catch (error) {
    showToastBanner("加载全景总览失败", { detail: formatActionError(error), error: true });
  } finally {
    state.missionOverviewLoading = false;
    if (isBoardViewActive() && isOverviewBoardMode()) {
      renderProjectBoard();
    }
  }
}

async function refreshMissionOverview({ preferredModel = "" } = {}) {
  state.missionOverviewLoading = true;
  if (state.missionOverview?.meta) {
    state.missionOverview.meta.summarizing = true;
  }
  renderProjectBoard();
  try {
    const data = await apiPost("/api/overview/refresh", {
      ...(preferredModel ? { preferredModel } : {}),
    });
    if (data && Array.isArray(data.domains)) {
      state.missionOverview = data;
    }
  } catch (error) {
    showToastBanner("AI 汇总刷新失败", { detail: formatActionError(error), error: true });
  } finally {
    state.missionOverviewLoading = false;
    if (isBoardViewActive() && isOverviewBoardMode()) {
      renderProjectBoard();
    }
  }
}

async function syncOverviewProjects({ clearExisting = false } = {}) {
  if (state.overviewSyncingProjects) return;
  state.overviewSyncingProjects = true;
  renderProjectBoard();
  try {
    const res = await apiPost("/api/overview/sync", {
      clearExisting,
      locale: currentUiLocale(),
    });
    if (res?.overview && Array.isArray(res.overview.domains)) {
      state.missionOverview = res.overview;
    }
    const addedCount = Number(res?.addedCount) || 0;
    showToastBanner(
      addedCount > 0 ? `已同步收录 ${addedCount} 个新项目` : "当前所有项目均已收录",
      addedCount > 0 ? { detail: (res.addedTopics || []).map((t) => t.name).join("、") } : undefined,
    );
  } catch (error) {
    showToastBanner("同步收录项目失败", { detail: formatActionError(error), error: true });
  } finally {
    state.overviewSyncingProjects = false;
    renderProjectBoard();
  }
}

async function inductOverviewWorkspace(cwd = "") {
  const cleanCwd = String(cwd || "").trim();
  if (!cleanCwd) return;
  const name = projectBaseName(cleanCwd) || cleanCwd;
  try {
    const res = await apiPost("/api/overview/topic", { name, primaryCwd: cleanCwd });
    if (res?.overview && Array.isArray(res.overview.domains)) {
      state.missionOverview = res.overview;
    }
    if (res?.topic?.id && state.boardViewMode === "tycoon3d") {
      state.tycoonSelectedTopicId = res.topic.id;
      state.tycoonInspectorMode = "topic";
      state.tycoonInspectorBack = null;
      tycoon3dInstance?.flyToTopic?.(res.topic.id);
    }
    renderProjectBoard();
    showToastBanner(`已收录为产线「${res?.topic?.name || name}」`);
  } catch (error) {
    showToastBanner("收录产线失败", { detail: formatActionError(error), error: true });
  }
}

async function assignOverviewThreadTopic(threadId, topicId) {
  try {
    const res = await apiPost("/api/overview/assign", { threadId, topicId });
    if (res?.overview) {
      state.missionOverview = res.overview;
    }
    state.overviewAssignThreadId = "";
    renderProjectBoard();
  } catch (error) {
    showToastBanner("调整项目归属失败", { detail: formatActionError(error), error: true });
  }
}

async function toggleOverviewBossFocus(topicId) {
  if (!topicId) return;
  try {
    const res = await apiPost("/api/overview/focus", { topicId });
    if (res?.overview) {
      state.missionOverview = res.overview;
    }
    renderProjectBoard();
  } catch (error) {
    showToastBanner("切换主攻锁定失败", { detail: formatActionError(error), error: true });
  }
}

async function saveOverviewTopicMetrics(topicId, formEl) {
  if (!topicId || !formEl) return;
  const kpis = [];
  for (let i = 0; i < 3; i += 1) {
    const label = formEl.querySelector(`[data-kpi-label="${i}"]`)?.value?.trim() || "";
    const value = formEl.querySelector(`[data-kpi-val="${i}"]`)?.value?.trim() || "";
    const delta = formEl.querySelector(`[data-kpi-delta="${i}"]`)?.value?.trim() || "";
    if (label && value) {
      kpis.push({
        key: `kpi_${i + 1}`,
        label,
        value,
        delta,
        tone: /[$¥元收入创收赞助变现]/i.test(`${label}${value}`) ? "coin" : "growth",
      });
    }
  }
  try {
    const res = await apiPost("/api/overview/metrics", {
      topicId,
      kpis,
      clear: kpis.length === 0,
    });
    if (res?.overview) {
      state.missionOverview = res.overview;
    }
    state.editingMetricsTopicId = "";
    renderProjectBoard();
    showToastBanner(kpis.length ? "已保存数据看板指标并同步 3D 铭牌" : "已恢复默认自动数据采集");
  } catch (error) {
    showToastBanner("保存数据指标失败", { detail: formatActionError(error), error: true });
  }
}

async function mutateOverviewSpark({ action = "add", id = "", text = "", topicId = "" } = {}) {
  try {
    const res = await apiPost("/api/overview/spark", { action, id, text, topicId });
    if (res?.overview) {
      state.missionOverview = res.overview;
    }
    if (action === "add" && $("moSparkInput")) {
      $("moSparkInput").value = "";
    }
    renderProjectBoard();
  } catch (error) {
    showToastBanner("操作灵感孵化箱失败", { detail: formatActionError(error), error: true });
  }
}

async function submitSmartDispatch({ confirmOnly = false } = {}) {
  const inputEl = $("moDispatchInput");
  const text = String(inputEl ? inputEl.value : state.dispatchDraft || "").trim();
  if (!text) {
    inputEl?.focus();
    showToastBanner("请先输入要派发的任务指令", { error: true });
    return;
  }
  state.dispatchDraft = text;
  state.dispatchBusy = true;
  renderProjectBoard();
  try {
    const chosenAgentKey = state.dispatchAgentKey || "auto";
    const activeSubCwd = state.dispatchTopicId ? (state.selectedSubProjectByTopic?.[state.dispatchTopicId] || "") : "";
    const payload = {
      text,
      topicId: state.dispatchTopicId || "",
      ...(activeSubCwd ? { cwdOverride: activeSubCwd } : {}),
      mode: state.dispatchMode || "auto",
      preferredProvider: "auto",
      agentKey: chosenAgentKey,
      model: chosenAgentKey !== "auto" ? (state.dispatchModel || "") : "",
      inheritContext: state.dispatchInheritContext !== false,
    };
    const existingPreview = !confirmOnly
      && !state.dispatchPreview?.rejected
      && state.dispatchPreview?._draftText === text
      && Array.isArray(state.dispatchPreview?.routes)
      && state.dispatchPreview.routes.length > 0
      ? state.dispatchPreview
      : null;
    // Pre-flight: plan once with Gemini 3.8 Flash (or reuse preview) and never execute if the backend would ignore or override the chosen account.
    const preflight = confirmOnly
      ? null
      : (existingPreview || await apiPost("/api/overview/dispatch", {
          ...payload,
          confirmOnly: true,
          useAiPlanner: true,
          allowChat: false,
        }));
    const routesToCheck = confirmOnly ? null : (Array.isArray(preflight?.routes) ? preflight.routes : []);
    if (routesToCheck) {
      const missingAgent = routesToCheck.some((rt) => !rt.agentKey);
      const mismatched = chosenAgentKey !== "auto" && routesToCheck.some((rt) => rt.agentKey !== chosenAgentKey);
      if (missingAgent || mismatched) {
        state.dispatchPreview = { ...preflight, _draftText: text, rejected: true };
        state.lastDispatchReceipt = null;
        showToastBanner("已拦截：后端没有按所选账号派单", {
          detail: missingAgent
            ? "后台服务还是旧版本（不识别账号参数），请先在左下角版本栏点「重启服务」再派单"
            : `后端解析出的账号与所选「${chosenAgentKey}」不一致，未执行`,
          error: true,
        });
        return;
      }
    }
    const res = await apiPost("/api/overview/dispatch", {
      ...payload,
      confirmOnly: Boolean(confirmOnly),
      useAiPlanner: Boolean(confirmOnly),
      ...(confirmOnly ? { allowChat: false } : {}),
      ...(routesToCheck?.length ? { approvedRoutes: routesToCheck } : {}),
      sparkId: confirmOnly ? "" : (state.dispatchSparkId || ""),
    });
    if (confirmOnly) {
      state.dispatchPreview = { ...res, _draftText: text, rejected: false };
      state.lastDispatchReceipt = null;
    } else {
      state.dispatchPreview = null;
      state.lastDispatchReceipt = res;
      state.dispatchDraft = "";
      state.dispatchSparkId = "";
      if (res?.overview) {
        state.missionOverview = res.overview;
      }
      void refreshThreads().catch(() => {});
      const count = Array.isArray(res?.dispatched) ? res.dispatched.length : 0;
      if (count > 0) {
        const first = res.dispatched[0];
        tycoon3dInstance?.triggerDispatchBurst?.(first.topicId || "");
        showToastBanner(
          count === 1
            ? `已召唤员工入驻「${first.topicName}」`
            : `已拆分为 ${count} 个独立并发工位`,
          { detail: first.reason || "" },
        );
      }
    }
  } catch (error) {
    showToastBanner("智能派工失败", { detail: formatActionError(error), error: true });
  } finally {
    state.dispatchBusy = false;
    renderProjectBoard();
  }
}

function findOverviewTopicById(topicId = "") {
  if (!topicId || !Array.isArray(state.missionOverview?.domains)) return null;
  return state.missionOverview.domains.flatMap((d) => d.topics || []).find((t) => t.id === topicId) || null;
}

async function saveOverviewTopicContext(topicId, formEl) {
  if (!topicId || !formEl) return;
  const val = formEl.querySelector("[data-context-summary-input]")?.value?.trim() || "";
  try {
    const res = await apiPost("/api/overview/context", {
      topicId,
      summary: val,
      clear: val.length === 0,
    });
    if (res?.overview) {
      state.missionOverview = res.overview;
    }
    state.editingContextTopicId = "";
    renderProjectBoard();
    showToastBanner(val ? "已保存产线归档记忆摘要（已同步至项目目录）" : "已清除产线归档记忆摘要");
  } catch (error) {
    showToastBanner("保存归档摘要失败", { detail: formatActionError(error), error: true });
  }
}

const spriteController = createSpriteController({
  state,
  getEl: $,
  getTycoon3d: () => tycoon3dInstance,
  deps: {
    apiPostWithHotFallback,
    isBoardViewActive,
    isOverviewBoardMode,
    setTopbarMenuOpen,
    setComposerConfigOpen,
    setSidebarOpen,
    showToastBanner,
    formatActionError,
    buildDispatchAgentContext,
    findOverviewTopicById,
    renderProjectBoard,
    refreshTasks,
    refreshThreads,
    selectThread,
    loadMissionOverview,
    openProjectBoardView,
    ensureVoiceAudioUnlocked,
    playVoiceEarcon,
    requestVoiceWakeLock,
    releaseVoiceWakeLock,
    fetchVoiceTtsAudio,
  },
});

const {
  stopSpriteSpeech,
  enterSpriteFullscreen,
  exitSpriteFullscreen,
  exitSpriteOverlayForNavigation,
  minimizeSpritePhoneCall,
  enterSpritePhoneCall,
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
} = spriteController;

function setBoardViewMode(mode) {
  let requested = mode;
  if (requested === "list") {
    let lastList = "overview";
    try {
      const saved = localStorage.getItem("ac-board-list-mode");
      if (saved === "folders" || saved === "overview") lastList = saved;
    } catch {}
    requested = lastList;
  }
  const next = requested === "folders"
    ? "folders"
    : (requested === "overview" ? "overview" : "tycoon3d");
  state.boardViewMode = next;
  try {
    localStorage.setItem("ac-board-view-mode-v3", next);
    if (next !== "tycoon3d") localStorage.setItem("ac-board-list-mode", next);
  } catch {}
  if (isOverviewBoardMode(next)) {
    void loadMissionOverview({ trigger: "open" });
  }
  renderProjectBoard();
}

function openProjectBoardView() {
  exitSpriteOverlayForNavigation();
  setTopbarMenuOpen(false);
  setComposerConfigOpen(false);
  state.boardOpen = true;
  if (isOverviewBoardMode() && !state.scopedProjectCwd) {
    void loadMissionOverview({ trigger: "open" });
  }
  renderTopbarAndControls();
  renderActiveMessages();
  setSidebarOpen(false);
}

// =========================================================================
// 共享音频解锁 / 提示音 / 唤醒锁 / TTS 底层辅助（供小精灵、朗读播报、输入听写共用）
// =========================================================================

let cachedSilentWavDataUri = "";

function getSilentWavDataUri() {
  if (!cachedSilentWavDataUri) {
    const wavBytes = encodePcm16SamplesToWav(new Int16Array(640), 16000);
    cachedSilentWavDataUri = `data:audio/wav;base64,${uint8ArrayToBase64(wavBytes)}`;
  }
  return cachedSilentWavDataUri;
}

function ensureVoiceAudioUnlocked() {
  try {
    if (typeof navigator !== "undefined" && navigator.audioSession) {
      navigator.audioSession.type = "play-and-record";
    }
  } catch {}
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (AudioCtx) {
    if (!state.voice.audioCtx || state.voice.audioCtx.state === "closed") {
      try {
        state.voice.audioCtx = new AudioCtx();
        state.voice.webAudioUnlocked = false;
      } catch {}
    }
    if (state.voice.audioCtx?.state === "suspended") {
      void state.voice.audioCtx.resume().catch(() => {});
    }
    if (state.voice.audioCtx && !state.voice.webAudioUnlocked) {
      try {
        const ctx = state.voice.audioCtx;
        const buf = ctx.createBuffer(1, 1, 22050);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        src.start(0);
        state.voice.webAudioUnlocked = true;
      } catch {}
    }
  }
}

// Instant local acknowledgement (no network) so the user knows the sentence was captured.
function playVoiceEarcon(kind = "heard", ctx = state.voice.audioCtx) {
  try {
    if (!ctx || ctx.state === "closed" || typeof ctx.createOscillator !== "function") return;
    const tones = kind === "error" ? [660, 440] : kind === "sent" ? [660, 990] : [880, 1320];
    const t0 = ctx.currentTime + 0.01;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);
    gain.connect(ctx.destination);
    tones.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, t0 + i * 0.07);
      osc.connect(gain);
      osc.start(t0 + i * 0.07);
      osc.stop(t0 + i * 0.07 + 0.08);
    });
    setTimeout(() => { try { gain.disconnect(); } catch {} }, 400);
  } catch {}
}

async function requestVoiceWakeLock() {
  try {
    if ("wakeLock" in navigator && !state.voice.wakeLock) {
      state.voice.wakeLock = await navigator.wakeLock.request("screen");
      state.voice.wakeLock.addEventListener?.("release", () => {
        state.voice.wakeLock = null;
      });
    }
  } catch {
    state.voice.wakeLock = null;
  }
}

async function releaseVoiceWakeLock() {
  try {
    await state.voice.wakeLock?.release?.();
  } catch {}
  state.voice.wakeLock = null;
}

async function fetchVoiceTtsAudio({ text = "", utteranceId = "", preferOffline = false, register = false } = {}) {
  const clean = stripMarkdownForSpeech(text, 360);
  if (!clean) return null;
  try {
    const res = await apiPostWithHotFallback("api/voice/tts", {
      text: clean,
      utteranceId,
      preferOffline: Boolean(preferOffline),
      register: Boolean(register),
    });
    return normalizeVoiceTtsPayload({
      ...res,
      utteranceId: res?.utteranceId || utteranceId,
      text: res?.text || clean,
    });
  } catch {
    return null;
  }
}

function isMobileComposerViewport() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(max-width: 960px)")?.matches);
}

function isMobileTouchComposer() {
  if (typeof window === "undefined") return false;
  return Boolean(
    isMobileComposerViewport()
    || window.matchMedia?.("(pointer: coarse)")?.matches
    || window.matchMedia?.("(hover: none)")?.matches,
  );
}

function renderChatTtsButton() {
  const btn = $("chatTtsToggleBtn");
  if (!btn) return;
  const onBoard = isBoardViewActive();
  btn.hidden = onBoard;
  if (onBoard) return;
  const { enabled, speaking, loading } = state.chatTts;
  const isPlaying = Boolean(speaking || loading);
  btn.classList.toggle("is-active", enabled);
  btn.classList.toggle("is-speaking", isPlaying);
  btn.setAttribute("aria-pressed", enabled ? "true" : "false");
  btn.title = enabled
    ? (isPlaying ? "朗读播报中（点击关闭自动朗读）" : "朗读播报已开启：每轮回复自动播报结尾总结（点击关闭）")
    : "朗读播报：点击开启后自动播报回复结尾总结";
  const iconEl = $("chatTtsToggleIcon");
  if (iconEl) {
    iconEl.innerHTML = iconSvg(enabled ? "speaker" : "speaker-off", { size: 14 });
  }
}

function unlockChatReplySpeechAudio() {
  try {
    if (typeof Audio === "undefined") return;
    if (!state.chatTts.audioEl) {
      const audio = new Audio();
      audio.playsInline = true;
      audio.preload = "auto";
      state.chatTts.audioEl = audio;
    }
    if (!state.chatTts.audioUnlocked && !state.chatTts.speaking && !state.chatTts.loading) {
      state.chatTts.audioUnlocked = true;
      const audio = state.chatTts.audioEl;
      audio.src = getSilentWavDataUri();
      audio.play().catch(() => {
        state.chatTts.audioUnlocked = false;
      });
    }
  } catch {
    state.chatTts.audioUnlocked = false;
  }
}

function stopChatReplySpeech() {
  state.chatTts.playToken += 1;
  const wasActive = Boolean(state.chatTts.speaking || state.chatTts.loading);
  state.chatTts.speaking = false;
  state.chatTts.loading = false;
  if (state.chatTts.audioEl) {
    try {
      state.chatTts.audioEl.pause();
      state.chatTts.audioEl.removeAttribute("src");
      state.chatTts.audioEl.load?.();
    } catch {}
  }
  if (wasActive) {
    renderChatTtsButton();
  }
}

function syncCurrentThreadSpokenBaseline(thread) {
  if (!thread?.id) return;
  const { turnId, text } = extractFinalAssistantMessageFromTurns(thread.turns, "");
  if (!text) return;
  state.chatTts.lastSpokenKey = `${thread.id}::${turnId || text.slice(-80)}`;
}

function toggleChatReplyTts() {
  const next = !state.chatTts.enabled;
  state.chatTts.enabled = next;
  saveChatReplyTtsPref(next);
  if (next) {
    unlockChatReplySpeechAudio();
    if (state.activeThread && !state.activeThread.live) {
      syncCurrentThreadSpokenBaseline(state.activeThread);
    }
    renderChatTtsButton();
    showToastBanner("已开启朗读播报", { detail: "回复完成后将默认朗读结尾总结" });
  } else {
    stopChatReplySpeech();
    renderChatTtsButton();
    showToastBanner("已关闭朗读播报");
  }
}

async function speakChatReplyText(summaryText = "") {
  const clean = stripMarkdownForSpeech(summaryText, 300);
  if (!clean || !state.chatTts.enabled) return;
  stopChatReplySpeech();
  const token = ++state.chatTts.playToken;
  state.chatTts.loading = true;
  renderChatTtsButton();

  const clearPlayback = () => {
    if (token !== state.chatTts.playToken) return;
    state.chatTts.loading = false;
    state.chatTts.speaking = false;
    renderChatTtsButton();
  };

  try {
    const tts = await fetchVoiceTtsAudio({ text: clean, register: false });
    if (!state.chatTts.enabled || token !== state.chatTts.playToken || isBoardViewActive()) {
      clearPlayback();
      return;
    }
    if (!tts?.audioBase64 || typeof Audio === "undefined") {
      clearPlayback();
      return;
    }
    if (!state.chatTts.audioEl) {
      const audio = new Audio();
      audio.playsInline = true;
      audio.preload = "auto";
      state.chatTts.audioEl = audio;
    }
    const audio = state.chatTts.audioEl;
    const mime = tts.mimeType || "audio/mpeg";
    audio.onended = clearPlayback;
    audio.onerror = clearPlayback;
    audio.src = `data:${mime};base64,${tts.audioBase64}`;
    state.chatTts.loading = false;
    state.chatTts.speaking = true;
    state.chatTts.audioUnlocked = true;
    renderChatTtsButton();
    await audio.play();
  } catch (err) {
    clearPlayback();
    if (err?.name === "NotAllowedError") {
      setComposerStatus("info", "浏览器限制了自动播放，轻触页面任意处后即可自动朗读总结", { autoClearMs: 3200 });
    }
  }
}

function maybeSpeakCompletedTurnSummary({ threadId = "", turnId = "", fallbackText = "" } = {}) {
  if (!state.chatTts.enabled || !threadId || state.activeThreadId !== threadId || isBoardViewActive()) return;
  if (state.sprite.phoneCallActive || state.dictation.active || state.dictation.pointerDown) return;
  const extracted = extractFinalAssistantMessageFromTurns(state.activeThread?.turns, fallbackText);
  const finalReply = extracted.text;
  if (!finalReply) return;
  const dedupeKey = `${threadId}::${extracted.turnId || turnId || finalReply.slice(-80)}`;
  if (state.chatTts.lastSpokenKey === dedupeKey) return;
  const closingSummary = extractReplyClosingSummaryForSpeech(finalReply, { maxChars: 260 });
  if (!closingSummary) return;
  state.chatTts.lastSpokenKey = dedupeKey;
  void speakChatReplyText(closingSummary);
}

function setComposerHoldMode(enabled, { focusInput = false } = {}) {
  const next = Boolean(enabled);
  if (!next && (state.dictation.active || state.dictation.pointerDown)) {
    state.dictation.pointerDown = false;
    state.dictation.cancelArmed = false;
    void stopComposerDictation({ submit: false });
  }
  state.dictation.holdMode = next;
  if (next) {
    setComposerConfigOpen(false);
    closeSlashCommandMenu();
    $("promptInput")?.blur();
  }
  renderComposerDictationUi();
  if (!next && focusInput) {
    requestAnimationFrame(() => $("promptInput")?.focus());
  }
}

function renderComposerDictationUi() {
  const composerBox = $("composerArea")?.querySelector(".composer-box");
  const holdBar = $("composerHoldBar");
  const holdBtn = $("composerHoldTalkBtn");
  const holdIcon = $("composerHoldTalkIcon");
  const holdWave = $("composerHoldTalkWave");
  const holdLabel = $("composerHoldTalkLabel");
  const btn = $("composerVoiceBtn");
  const iconEl = $("composerVoiceIcon");
  const labelEl = $("composerVoiceLabel");

  const { active, transcribing, holdMode, cancelArmed } = state.dictation;
  const showHoldBar = Boolean(holdMode && isMobileComposerViewport());
  composerBox?.classList.toggle("is-hold-voice-mode", showHoldBar);
  if (holdBar) holdBar.hidden = !showHoldBar;

  if (holdBtn) {
    const gesture = resolveHoldTalkGestureState({
      active,
      transcribing,
      cancelArmed,
      isSubmitting: state.isSubmitting,
    });
    holdBtn.disabled = gesture.disabled;
    holdBtn.classList.toggle("is-recording", gesture.stateKey === "recording");
    holdBtn.classList.toggle("is-cancel-armed", gesture.stateKey === "cancel");
    holdBtn.classList.toggle("is-transcribing", gesture.stateKey === "transcribing");
    if (holdWave) holdWave.hidden = gesture.stateKey !== "recording";
    if (holdIcon) {
      holdIcon.hidden = gesture.stateKey === "recording";
      holdIcon.innerHTML = gesture.stateKey === "cancel"
        ? iconSvg("close", { size: 15 })
        : gesture.stateKey === "transcribing"
          ? iconSvg("clock", { size: 15 })
          : iconSvg("mic", { size: 16 });
    }
    if (holdLabel) {
      holdLabel.textContent = gesture.label;
    }
  }

  if (!btn) return;
  btn.classList.toggle("is-recording", active && !showHoldBar);
  btn.classList.toggle("is-transcribing", transcribing && !showHoldBar);
  btn.setAttribute("aria-pressed", (showHoldBar || active) ? "true" : "false");
  btn.disabled = transcribing;
  if (iconEl) {
    iconEl.innerHTML = (active && !showHoldBar)
      ? iconSvg("stop", { size: 13 })
      : (transcribing && !showHoldBar)
        ? iconSvg("clock", { size: 13 })
        : iconSvg("mic", { size: 15 });
  }
  if (labelEl) {
    labelEl.textContent = active ? "停止" : transcribing ? "识别中" : "语音";
  }
}

function teardownComposerDictationAudio() {
  if (state.dictation.maxTimer) {
    clearTimeout(state.dictation.maxTimer);
    state.dictation.maxTimer = null;
  }
  try { state.dictation.processor?.disconnect?.(); } catch {}
  try { state.dictation.source?.disconnect?.(); } catch {}
  if (state.dictation.micStream) {
    for (const track of state.dictation.micStream.getTracks()) {
      try { track.stop(); } catch {}
    }
  }
  if (state.dictation.audioCtx) {
    try { void state.dictation.audioCtx.close?.(); } catch {}
  }
  state.dictation.processor = null;
  state.dictation.source = null;
  state.dictation.micStream = null;
  state.dictation.audioCtx = null;
}

async function stopComposerDictation({ submit = true, autoSend = false } = {}) {
  state.dictation.pointerDown = false;
  state.dictation.pointerId = null;
  const wasCancelArmed = state.dictation.cancelArmed;
  state.dictation.cancelArmed = false;
  if (!state.dictation.active) {
    renderComposerDictationUi();
    return;
  }
  state.dictation.active = false;
  const chunks = state.dictation.chunks;
  state.dictation.chunks = [];
  teardownComposerDictationAudio();

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  if (!submit || wasCancelArmed || totalLen < 1600) {
    renderComposerDictationUi();
    if (!submit || wasCancelArmed) {
      if (wasCancelArmed) {
        setComposerStatus("info", "已取消语音发送", { autoClearMs: 1600 });
      } else {
        clearComposerStatus();
      }
    } else if (totalLen > 0) {
      setComposerStatus("error", "说话时间太短，请按住说完再松手", { autoClearMs: 2200 });
    }
    return;
  }

  const merged = new Int16Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  state.dictation.transcribing = true;
  renderComposerDictationUi();
  setComposerStatus("pending", autoSend ? "正在识别语音并发送…" : "正在本地语音识别…");

  try {
    const wavBytes = encodePcm16SamplesToWav(merged, 16000);
    const res = await apiPostWithHotFallback("api/voice/transcribe", {
      audioBase64: uint8ArrayToBase64(wavBytes),
      audioMimeType: "audio/wav",
    });
    const text = String(res?.text || "").trim();
    if (text) {
      if (autoSend) {
        clearComposerStatus();
        await handleSend({
          overrideText: text,
          clearDraft: false,
          includeComposerImages: true,
        });
      } else {
        const input = $("promptInput");
        if (input) {
          const cur = input.value;
          input.value = cur && !/\s$/.test(cur) ? `${cur} ${text}` : `${cur}${text}`;
          autoResizePromptInput();
          renderComposerControls();
          input.focus();
        }
        clearComposerStatus();
      }
    } else {
      setComposerStatus("error", "未识别到清晰语音，请重试", { autoClearMs: 2400 });
    }
  } catch (error) {
    setComposerStatus("error", `语音识别失败：${formatActionError(error)}`, { autoClearMs: 3600 });
  } finally {
    state.dictation.transcribing = false;
    renderComposerDictationUi();
  }
}

async function startComposerAudioCapture({ autoSendOnMax = false, holdToken = 0 } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) {
    setComposerStatus("error", "当前浏览器不支持网页麦克风录音", { autoClearMs: 3000 });
    return false;
  }
  stopChatReplySpeech();
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) throw new Error("不支持 AudioContext");
    const ctx = new AudioCtx();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    if (holdToken && (!state.dictation.pointerDown || state.dictation.holdToken !== holdToken)) {
      for (const track of stream.getTracks()) {
        try { track.stop(); } catch {}
      }
      try { void ctx.close?.(); } catch {}
      renderComposerDictationUi();
      setComposerStatus("info", "麦克风已就绪，请按住说话松手发送", { autoClearMs: 2200 });
      return false;
    }
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(2048, 1, 1);
    const silentGain = ctx.createGain();
    silentGain.gain.value = 0;

    state.dictation.chunks = [];
    processor.onaudioprocess = (ev) => {
      if (!state.dictation.active) return;
      const input = ev.inputBuffer?.getChannelData?.(0);
      if (!input?.length) return;
      state.dictation.chunks.push(downsampleFloat32ToInt16(input, ctx.sampleRate || 48000, 16000));
    };

    source.connect(processor);
    processor.connect(silentGain);
    silentGain.connect(ctx.destination);

    state.dictation.audioCtx = ctx;
    state.dictation.micStream = stream;
    state.dictation.source = source;
    state.dictation.processor = processor;
    state.dictation.active = true;
    state.dictation.maxTimer = setTimeout(() => {
      void stopComposerDictation({ submit: true, autoSend: autoSendOnMax });
    }, 55000);
    renderComposerDictationUi();
    if (!holdToken) {
      setComposerStatus("pending", "正在录音… 再次点击麦克风结束并识别");
    }
    return true;
  } catch (error) {
    state.dictation.pointerDown = false;
    state.dictation.cancelArmed = false;
    teardownComposerDictationAudio();
    state.dictation.active = false;
    renderComposerDictationUi();
    setComposerStatus("error", `麦克风启动失败：${error?.message || "请检查权限"}`, { autoClearMs: 3200 });
    return false;
  }
}

async function toggleComposerDictation() {
  if (state.dictation.transcribing) return;
  if (state.dictation.active) {
    await stopComposerDictation({ submit: true, autoSend: false });
    return;
  }
  await startComposerAudioCapture({ autoSendOnMax: false, holdToken: 0 });
}

function enterTycoon3DAndSummonSprite({ startVoice = false } = {}) {
  setTopbarMenuOpen(false);
  setComposerConfigOpen(false);
  if (startVoice) {
    void enterSpritePhoneCall();
    return;
  }
  if (state.scopedProjectCwd) {
    state.scopedProjectCwd = "";
  }
  if (state.boardViewMode !== "tycoon3d") {
    setBoardViewMode("tycoon3d");
  }
  if (!isBoardViewActive()) {
    openProjectBoardView();
  } else {
    if (!state.missionOverview && !state.missionOverviewLoading) {
      void loadMissionOverview({ trigger: "open" });
    }
    renderProjectBoard();
  }
  toggleSpriteAssistant({ open: true });
  requestAnimationFrame(() => $("spriteCommandInput")?.focus());
}

function clampSidebarWidth(width, viewportWidth = window.innerWidth) {
  const numeric = Number(width);
  if (!Number.isFinite(numeric)) return DEFAULT_SIDEBAR_WIDTH;
  const viewportMax =
    Number.isFinite(viewportWidth) && viewportWidth > 0
      ? Math.max(MIN_SIDEBAR_WIDTH, Math.floor(viewportWidth * 0.48))
      : MAX_SIDEBAR_WIDTH;
  const maxAllowed = Math.min(MAX_SIDEBAR_WIDTH, viewportMax);
  return Math.max(MIN_SIDEBAR_WIDTH, Math.min(maxAllowed, Math.round(numeric)));
}

function loadSavedSidebarWidth() {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_PREF_KEY);
    if (!raw) return DEFAULT_SIDEBAR_WIDTH;
    return clampSidebarWidth(Number(raw));
  } catch {
    return DEFAULT_SIDEBAR_WIDTH;
  }
}

function saveSidebarWidth(width) {
  try {
    localStorage.setItem(SIDEBAR_WIDTH_PREF_KEY, String(clampSidebarWidth(width)));
  } catch {
    // Ignore storage write errors in restricted webviews.
  }
}

function applySidebarWidth(width, { persist = false } = {}) {
  const clamped = clampSidebarWidth(width);
  document.documentElement.style.setProperty("--sidebar-width", `${clamped}px`);
  const resizer = $("sidebarResizer");
  if (resizer) {
    resizer.setAttribute("aria-valuenow", String(clamped));
    resizer.setAttribute("aria-valuemin", String(MIN_SIDEBAR_WIDTH));
    resizer.setAttribute("aria-valuemax", String(clampSidebarWidth(MAX_SIDEBAR_WIDTH)));
  }
  if (persist) {
    saveSidebarWidth(clamped);
  }
  return clamped;
}

function bindSidebarResizer() {
  const resizer = $("sidebarResizer");
  const sidebar = $("sidebar");
  if (!resizer || !sidebar) return;

  applySidebarWidth(loadSavedSidebarWidth());

  let activePointerId = null;
  let startX = 0;
  let startWidth = DEFAULT_SIDEBAR_WIDTH;
  let currentWidth = loadSavedSidebarWidth();

  const finishDrag = ({ persist = true } = {}) => {
    if (activePointerId === null) return;
    activePointerId = null;
    resizer.classList.remove("is-resizing");
    document.body.classList.remove("is-resizing-sidebar");
    if (persist) {
      applySidebarWidth(currentWidth, { persist: true });
    }
  };

  resizer.addEventListener("pointerdown", (e) => {
    if (window.matchMedia?.("(max-width: 960px)")?.matches) return;
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.preventDefault();
    activePointerId = e.pointerId;
    startX = e.clientX;
    startWidth = sidebar.getBoundingClientRect().width || loadSavedSidebarWidth();
    currentWidth = clampSidebarWidth(startWidth);
    resizer.classList.add("is-resizing");
    document.body.classList.add("is-resizing-sidebar");
    try {
      resizer.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore unsupported capture errors.
    }
  });

  resizer.addEventListener("pointermove", (e) => {
    if (activePointerId === null || e.pointerId !== activePointerId) return;
    const delta = e.clientX - startX;
    currentWidth = applySidebarWidth(startWidth + delta);
  });

  resizer.addEventListener("pointerup", (e) => {
    if (e.pointerId !== activePointerId) return;
    finishDrag({ persist: true });
  });

  resizer.addEventListener("pointercancel", (e) => {
    if (e.pointerId !== activePointerId) return;
    finishDrag({ persist: false });
  });

  resizer.addEventListener("lostpointercapture", () => {
    finishDrag({ persist: true });
  });

  resizer.addEventListener("dblclick", () => {
    if (window.matchMedia?.("(max-width: 960px)")?.matches) return;
    currentWidth = applySidebarWidth(DEFAULT_SIDEBAR_WIDTH, { persist: true });
  });

  resizer.addEventListener("keydown", (e) => {
    if (window.matchMedia?.("(max-width: 960px)")?.matches) return;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home") return;
    e.preventDefault();
    const step = e.shiftKey ? 24 : 12;
    if (e.key === "Home") {
      currentWidth = applySidebarWidth(DEFAULT_SIDEBAR_WIDTH, { persist: true });
      return;
    }
    const base = sidebar.getBoundingClientRect().width || loadSavedSidebarWidth();
    const next = e.key === "ArrowLeft" ? base - step : base + step;
    currentWidth = applySidebarWidth(next, { persist: true });
  });

  window.addEventListener("resize", () => {
    if (window.matchMedia?.("(max-width: 960px)")?.matches) return;
    currentWidth = applySidebarWidth(loadSavedSidebarWidth());
  });
}

const THEME_STORAGE_KEY = "ac-theme-mode";
const themeColorQuery = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(prefers-color-scheme: light)")
  : null;

function loadThemeMode() {
  try {
    const saved = localStorage.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark" || saved === "system") return saved;
  } catch {}
  return "system";
}

function getSystemTheme() {
  return themeColorQuery?.matches ? "light" : "dark";
}

function resolveEffectiveTheme(mode = loadThemeMode()) {
  if (mode === "light" || mode === "dark") return mode;
  return getSystemTheme();
}

function applyThemeMode(mode = loadThemeMode(), { persist = false } = {}) {
  const safeMode = mode === "light" || mode === "dark" || mode === "system" ? mode : "system";
  const resolved = resolveEffectiveTheme(safeMode);
  if (persist) {
    try {
      if (safeMode === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, safeMode);
    } catch {}
  }
  const root = document.documentElement;
  if (root) {
    root.dataset.theme = resolved;
    root.dataset.themeMode = safeMode;
    root.style.colorScheme = resolved;
  }
  const btn = $("themeToggleBtn");
  const iconEl = $("themeToggleIcon");
  if (iconEl) {
    const iconName = safeMode === "light" ? "sun" : safeMode === "dark" ? "moon" : "monitor";
    iconEl.innerHTML = iconSvg(iconName, { size: 12 });
  }
  if (btn) {
    const modeLabel = safeMode === "system"
      ? `跟随系统（当前${resolved === "light" ? "日间" : "深色"}）`
      : safeMode === "light"
        ? "日间模式"
        : "深色模式";
    const nextAction = safeMode === "system"
      ? `点击切换为${resolved === "light" ? "深色" : "日间"}模式`
      : safeMode !== getSystemTheme()
        ? `点击切换为${resolved === "light" ? "深色" : "日间"}模式`
        : "点击恢复跟随系统";
    btn.title = `主题：${modeLabel} · ${nextAction}（右键恢复跟随系统）`;
    btn.setAttribute("aria-label", `RemoDeck · ${modeLabel}，${nextAction}`);
    btn.dataset.themeMode = safeMode;
    btn.dataset.theme = resolved;
  }
  scheduleMermaidHydration(document, { forceThemeSync: true });
  return { mode: safeMode, resolved };
}

function toggleThemeMode() {
  const current = loadThemeMode();
  const sysTheme = getSystemTheme();
  const opposite = sysTheme === "light" ? "dark" : "light";
  let next = "system";
  if (current === "system") {
    next = opposite;
  } else if (current === opposite) {
    next = sysTheme;
  } else {
    next = "system";
  }
  applyThemeMode(next, { persist: true });
}

function bindEvents() {
  bindSidebarResizer();
  const themeBtn = $("themeToggleBtn");
  if (themeBtn) {
    themeBtn.addEventListener("click", () => toggleThemeMode());
    themeBtn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      applyThemeMode("system", { persist: true });
    });
  }
  if (themeColorQuery) {
    const onSystemThemeChange = () => {
      if (loadThemeMode() === "system") applyThemeMode("system");
    };
    if (typeof themeColorQuery.addEventListener === "function") {
      themeColorQuery.addEventListener("change", onSystemThemeChange);
    } else if (typeof themeColorQuery.addListener === "function") {
      themeColorQuery.addListener(onSystemThemeChange);
    }
  }
  initComposerCustomSelects([
    "composerProviderSelect",
    "composerProfileSelect",
    "modelSelect",
    "effortSelect",
    "permissionSelect",
    "runningSubmitMode",
  ]);
  $("menuBtn").addEventListener("click", () => setSidebarOpen(true));
  $("sidebarBackdrop").addEventListener("click", () => setSidebarOpen(false));

  const setProviderTabsSettingsOpen = (open) => {
    const panel = $("providerTabsSettings");
    if (!panel) return;
    panel.hidden = !open;
  };
  let providerTabsLongPressTimer = 0;
  let providerTabsLongPressOrigin = null;
  let suppressNextProviderTabClick = false;
  const clearProviderTabsLongPress = () => {
    if (providerTabsLongPressTimer) {
      clearTimeout(providerTabsLongPressTimer);
      providerTabsLongPressTimer = 0;
    }
    providerTabsLongPressOrigin = null;
  };
  $("providerTabs").addEventListener("pointerdown", (e) => {
    if (e.button && e.button !== 0) return;
    clearProviderTabsLongPress();
    providerTabsLongPressOrigin = { x: e.clientX, y: e.clientY };
    providerTabsLongPressTimer = setTimeout(() => {
      providerTabsLongPressTimer = 0;
      suppressNextProviderTabClick = true;
      setProviderTabsSettingsOpen(true);
    }, 480);
  });
  $("providerTabs").addEventListener("pointermove", (e) => {
    if (!providerTabsLongPressTimer || !providerTabsLongPressOrigin) return;
    if (Math.hypot(e.clientX - providerTabsLongPressOrigin.x, e.clientY - providerTabsLongPressOrigin.y) > 8) {
      clearProviderTabsLongPress();
    }
  });
  $("providerTabs").addEventListener("pointerup", clearProviderTabsLongPress);
  $("providerTabs").addEventListener("pointercancel", clearProviderTabsLongPress);
  $("providerTabs").addEventListener("contextmenu", (e) => {
    e.preventDefault();
    clearProviderTabsLongPress();
    setProviderTabsSettingsOpen($("providerTabsSettings")?.hidden);
  });
  $("providerTabs").addEventListener("wheel", (e) => {
    const el = $("providerTabs");
    if (!el || el.scrollWidth <= el.clientWidth) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    }
  }, { passive: false });
  $("providerTabs").addEventListener("click", (e) => {
    if (suppressNextProviderTabClick) {
      suppressNextProviderTabClick = false;
      e.preventDefault();
      return;
    }
    const btn = e.target.closest("[data-provider]");
    if (!btn) return;
    setProviderFilter(btn.dataset.provider);
  });
  document.addEventListener("pointerdown", (e) => {
    const panel = $("providerTabsSettings");
    if (!panel || panel.hidden) return;
    if (panel.contains(e.target)) return;
    setProviderTabsSettingsOpen(false);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const panel = $("providerTabsSettings");
    if (panel && !panel.hidden) setProviderTabsSettingsOpen(false);
  });
  $("providerTabsSettingsMenu").addEventListener("change", (e) => {
    const input = e.target.closest("[data-provider-tab-visible]");
    if (!input) return;
    const id = input.dataset.providerTabVisible;
    state.hiddenProviderTabs = state.hiddenProviderTabs.filter((value) => value !== id);
    if (!input.checked) state.hiddenProviderTabs.push(id);
    saveHiddenProviderTabs(state.hiddenProviderTabs);
    setProviderFilter(state.providerFilter);
  });
  $("providerTabsSettingsMenu").addEventListener("click", (e) => {
    if (!e.target.closest("[data-provider-tabs-reset]")) return;
    state.hiddenProviderTabs = [];
    saveHiddenProviderTabs([]);
    setProviderFilter(state.providerFilter);
    const panel = $("providerTabsSettings");
    if (panel) panel.hidden = true;
  });

  $("cliMaintenanceBanner")?.addEventListener("click", async (e) => {
    const dismissBtn = e.target.closest("[data-cli-dismiss]");
    if (dismissBtn?.dataset.cliDismiss) {
      dismissedCliBannerProviders.add(dismissBtn.dataset.cliDismiss);
      renderCliMaintenanceBanner();
      return;
    }
    const btn = e.target.closest("[data-cli-retry]");
    if (!btn) return;
    const provider = btn.dataset.cliRetry;
    if (!provider) return;
    if (state.cliStatus?.[provider]) {
      state.cliStatus[provider] = { ...state.cliStatus[provider], status: "installing", installing: true };
      renderCliMaintenanceBanner();
    }
    try {
      const res = await apiPost("api/cli/install", { provider, force: true });
      if (res?.cliStatus) state.cliStatus = res.cliStatus;
      renderCliMaintenanceBanner();
      void refreshProviders();
    } catch {}
  });

  $("agentQuotaStrip")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-quota-refresh]")) {
      e.stopPropagation();
      void refreshQuotasManual();
      return;
    }
    if (e.target.closest("[data-quota-toggle]") || e.target.closest("[data-quota-filter-provider]")) {
      state.quotaExpanded = !state.quotaExpanded;
      renderQuotaStrip();
    }
  });

  $("telemetryTopbarBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const nextOpen = !(state.telemetryExpanded || state.mobileTelemetryOpen);
    state.mobileTelemetryOpen = nextOpen;
    state.telemetryExpanded = nextOpen;
    if (!nextOpen) {
      state.telemetryPickerOpen = false;
    }
    renderAgentTelemetryBar();
    if (nextOpen) void refreshExecutionStats();
  });

  const handleTelemetryBarClick = (e) => {
    if (e.target.closest("[data-execution-refresh]")) {
      void refreshExecutionStats();
      return;
    }
    const executionThread = e.target.closest("[data-execution-thread]");
    if (executionThread) {
      void selectThread(executionThread.dataset.executionThread, { focusScroll: true }).catch((error) => showToastBanner("打开会话失败", { detail: formatActionError(error), error: true }));
      return;
    }
    if (e.target.closest("[data-telemetry-mobile-close]")) {
      e.stopPropagation();
      state.mobileTelemetryOpen = false;
      state.telemetryExpanded = false;
      state.telemetryPickerOpen = false;
      renderAgentTelemetryBar();
      return;
    }
    const openInstBtn = e.target.closest("[data-open-instance-modal]");
    if (openInstBtn) {
      e.stopPropagation();
      closeTelemetryPopover();
      openInstanceManagerModal(openInstBtn.dataset.openInstanceModal || "");
      return;
    }
    if (e.target.closest("[data-telemetry-picker-toggle]")) {
      e.stopPropagation();
      state.telemetryPickerOpen = !state.telemetryPickerOpen;
      renderAgentTelemetryBar();
      return;
    }
    const pickKeyBtn = e.target.closest("[data-telemetry-pick-key]");
    if (pickKeyBtn) {
      e.stopPropagation();
      const targetKey = String(pickKeyBtn.dataset.telemetryPickKey || "").trim();
      if (targetKey) {
        const items = buildSelectableTelemetryItems(state.profiles);
        const currentSet = new Set(resolveVisibleTelemetryKeys(items, state.telemetryVisiblePrefs));
        if (currentSet.has(targetKey)) currentSet.delete(targetKey);
        else currentSet.add(targetKey);
        const prefs = {
          selectedKeys: items.filter((item) => currentSet.has(item.key)).map((item) => item.key),
          knownKeys: items.map((item) => item.key),
        };
        state.telemetryVisiblePrefs = prefs;
        saveTelemetryVisiblePrefs(prefs);
        renderAgentTelemetryBar();
      }
      return;
    }
    const pickActionBtn = e.target.closest("[data-telemetry-pick-action]");
    if (pickActionBtn) {
      e.stopPropagation();
      const action = String(pickActionBtn.dataset.telemetryPickAction || "").trim();
      const items = buildSelectableTelemetryItems(state.profiles);
      if (action === "all") {
        const prefs = {
          selectedKeys: items.map((item) => item.key),
          knownKeys: items.map((item) => item.key),
        };
        state.telemetryVisiblePrefs = prefs;
        saveTelemetryVisiblePrefs(prefs);
      } else if (action === "default") {
        state.telemetryVisiblePrefs = null;
        saveTelemetryVisiblePrefs(null);
      }
      renderAgentTelemetryBar();
      return;
    }
    if (e.target.closest("[data-telemetry-refresh]")) {
      e.stopPropagation();
      void Promise.allSettled([refreshTelemetry(), refreshQuotasManual()]);
      return;
    }
    const jumpBtn = e.target.closest("[data-telemetry-jump-thread]");
    if (jumpBtn) {
      e.stopPropagation();
      const tid = jumpBtn.dataset.telemetryJumpThread;
      if (tid) {
        closeTelemetryPopover();
        void selectThread(tid).catch((error) => {
          showToastBanner("切换会话失败", { detail: formatActionError(error), error: true });
        });
      }
      return;
    }
    const filterBtn = e.target.closest("[data-telemetry-filter-provider]");
    if (filterBtn) {
      e.stopPropagation();
      const nextProv = filterBtn.dataset.telemetryFilterProvider || "all";
      setProviderFilter(state.providerFilter === nextProv ? "all" : nextProv);
      return;
    }
    if (e.target.closest("[data-telemetry-toggle]")) {
      e.stopPropagation();
      if (state.telemetryExpanded || state.telemetryPickerOpen) {
        closeTelemetryPopover(e.target);
      } else {
        openTelemetryPopover(e.target);
      }
    }
  };
  $("topbarTelemetrySlot")?.addEventListener("click", handleTelemetryBarClick);
  $("agentTelemetryBar")?.addEventListener("click", handleTelemetryBarClick);
  $("telemetryBackdrop")?.addEventListener("click", () => closeTelemetryPopover());
  $("agentTelemetryBar")?.addEventListener("change", (e) => {
    if (e.target.matches("[data-execution-days]")) state.executionStatsDays = Number(e.target.value);
    else if (e.target.matches("[data-execution-provider]")) state.executionStatsProvider = e.target.value;
    else return;
    state.executionStats = null;
    void refreshExecutionStats();
  });

  $("sidebarBatchSelectBtn")?.addEventListener("click", () => {
    if (state.batchSelect.active) exitBatchSelectMode();
    else enterBatchSelectMode();
  });

  const handleBatchBarClick = (e) => {
    const btn = e.target.closest("[data-batch-action]");
    if (btn) handleBatchActionClick(btn.dataset.batchAction);
  };
  $("sidebarBatchBar")?.addEventListener("click", handleBatchBarClick);
  $("boardBatchBar")?.addEventListener("click", handleBatchBarClick);

  $("boardToggleBtn").addEventListener("click", () => openProjectBoardView());

  $("chatTtsToggleBtn")?.addEventListener("click", () => {
    toggleChatReplyTts();
  });

  if (state.chatTts.enabled) {
    const unlockOnce = () => {
      unlockChatReplySpeechAudio();
      document.removeEventListener("pointerdown", unlockOnce, true);
      document.removeEventListener("touchend", unlockOnce, true);
    };
    document.addEventListener("pointerdown", unlockOnce, { capture: true, passive: true });
    document.addEventListener("touchend", unlockOnce, { capture: true, passive: true });
  }

  $("voiceModeBtn").addEventListener("click", () => {
    if (state.sprite.phoneCallActive) {
      void enterSpritePhoneCall();
    } else {
      enterSpriteFullscreen();
    }
  });

  $("activeProfileBadge")?.addEventListener("click", () => {
    const provider = state.activeThread?.provider || defaultProviderValue();
    openNewThreadModal({
      cwd: state.activeThread?.cwd || "",
      provider,
    });
  });

  $("activeProjectCrumb")?.addEventListener("click", () => openProjectBoardView());
  $("newThreadCwdBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.newThreadCwdPickerOpen) {
      closeNewThreadCwdPicker();
    } else {
      openNewThreadCwdPicker();
    }
  });
  const newThreadCwdInput = $("newThreadCwdSearchInput");
  newThreadCwdInput?.addEventListener("input", () => {
    state.newThreadCwdPickerQuery = newThreadCwdInput.value;
    state.newThreadCwdPickerIndex = 0;
    setNewThreadCwdPickerStatus("");
    renderNewThreadCwdPickerList();
  });
  newThreadCwdInput?.addEventListener("keydown", (e) => {
    const opts = state.newThreadCwdPickerOptions || [];
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!opts.length) return;
      state.newThreadCwdPickerIndex = state.newThreadCwdPickerIndex < opts.length - 1
        ? state.newThreadCwdPickerIndex + 1
        : 0;
      renderNewThreadCwdPickerList({ scrollToHighlight: true });
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!opts.length) return;
      state.newThreadCwdPickerIndex = state.newThreadCwdPickerIndex > 0
        ? state.newThreadCwdPickerIndex - 1
        : opts.length - 1;
      renderNewThreadCwdPickerList({ scrollToHighlight: true });
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const chosen = opts[state.newThreadCwdPickerIndex] || opts[0] || null;
      if (chosen) {
        applyNewThreadCwd(chosen.cwd);
        return;
      }
      const typed = String(newThreadCwdInput.value || "").trim();
      if (typed && looksLikeDirectoryPath(typed)) {
        applyNewThreadCwd(typed);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeNewThreadCwdPicker({ restoreFocus: true });
    }
  });
  $("newThreadCwdList")?.addEventListener("click", (e) => {
    const optBtn = e.target.closest("[data-cwd-option-value]");
    if (!optBtn) return;
    applyNewThreadCwd(optBtn.dataset.cwdOptionValue ?? "");
  });
  $("newThreadCwdBrowseBtn")?.addEventListener("click", () => {
    void browseLocalDirectoryForNewThread();
  });
  window.addEventListener("resize", () => {
    if (state.newThreadCwdPickerOpen) positionNewThreadCwdPopover();
  });
  window.addEventListener("scroll", (e) => {
    if (!state.newThreadCwdPickerOpen) return;
    if (e.target instanceof Element && e.target.closest("#newThreadCwdPopover")) return;
    closeNewThreadCwdPicker();
  }, true);
  $("activeGoalBadge")?.addEventListener("click", () => $("goalToggleBtn")?.click());

  $("topbarMoreBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    setTopbarMenuOpen(!state.topbarMenuOpen);
  });

  $("topbarMoreMenu")?.addEventListener("click", (e) => {
    const hit = e.target.closest("button, a");
    if (hit && !hit.disabled) {
      setTopbarMenuOpen(false);
    }
  });

  $("topbarPinProjectBtn")?.addEventListener("click", () => {
    if (state.activeThread?.cwd) {
      void toggleProjectPin(state.activeThread.cwd);
    }
  });

  $("topbarNewInProjectBtn")?.addEventListener("click", () => {
    openNewThreadModal({
      cwd: state.activeThread?.cwd || state.newThreadCwd || "",
      provider: defaultNewThreadProvider(),
    });
  });

  $("switchNetworkLinkBtn")?.addEventListener("click", () => {
    void switchNetworkLink();
  });

  $("composerConfigBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    setComposerConfigOpen(!state.composerConfigOpen);
  });

  $("composerConfigCloseBtn")?.addEventListener("click", () => setComposerConfigOpen(false));

  document.addEventListener("click", (e) => {
    if (state.topbarMenuOpen && !e.target.closest(".topbar-more-wrap")) {
      setTopbarMenuOpen(false);
    }
    if (
      state.composerConfigOpen
      && !e.target.closest("#composerConfigPopover")
      && !e.target.closest("#composerConfigBtn")
      && !e.target.closest("#acCustomSelectPopover")
    ) {
      setComposerConfigOpen(false);
    }
    if (
      state.newThreadCwdPickerOpen
      && !e.target.closest("#newThreadCwdPopover")
      && !e.target.closest("#newThreadCwdBtn")
    ) {
      closeNewThreadCwdPicker();
    }
    if (
      (state.telemetryExpanded || state.mobileTelemetryOpen)
      && !e.target.closest("#agentTelemetryBar")
      && !e.target.closest("#topbarTelemetrySlot")
      && !e.target.closest("#telemetryTopbarBtn")
    ) {
      closeTelemetryPopover();
    } else if (state.telemetryPickerOpen && !e.target.closest(".telemetry-picker-panel") && !e.target.closest("[data-telemetry-picker-toggle]")) {
      state.telemetryPickerOpen = false;
      renderAgentTelemetryBar();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (state.sprite.viewMode === "phone") {
        minimizeSpritePhoneCall();
        return;
      }
      if (state.sprite.viewMode === "fullscreen") {
        exitSpriteFullscreen();
        return;
      }
      if (state.batchSelect.active) exitBatchSelectMode();
      if (state.topbarMenuOpen) setTopbarMenuOpen(false);
      if (state.composerConfigOpen) setComposerConfigOpen(false);
      if (state.newThreadCwdPickerOpen) closeNewThreadCwdPicker({ restoreFocus: true });
      if (state.telemetryPickerOpen || state.mobileTelemetryOpen || state.telemetryExpanded) {
        closeTelemetryPopover();
      }
    }
  });

  $("projectTaskStrip").addEventListener("click", (e) => {
    const openTaskModalBtn = e.target.closest("[data-task-open-modal]");
    if (openTaskModalBtn) {
      void openTasksModal(openTaskModalBtn.dataset.taskOpenModal || "");
      return;
    }
    const planBtn = e.target.closest("[data-task-jump-plan]");
    if (planBtn) {
      void jumpToTaskPlan(planBtn.dataset.taskJumpPlan);
      return;
    }
    const siblingBtn = e.target.closest("[data-task-new-sibling]");
    if (siblingBtn) {
      void startLinkedThreadDraft({ mode: "same", taskId: siblingBtn.dataset.taskNewSibling });
      return;
    }
    const childBtn = e.target.closest("[data-task-new-child]");
    if (childBtn) {
      void startLinkedThreadDraft({ mode: "child", parentTaskId: childBtn.dataset.taskNewChild });
      return;
    }
    if (e.target.closest("[data-task-cancel-draft]")) {
      state.newThreadTaskDraft = null;
      renderProjectTaskStrip();
      return;
    }
    const taskThreadBtn = e.target.closest("[data-task-strip-thread]");
    if (taskThreadBtn) {
      void selectThread(taskThreadBtn.dataset.taskStripThread).catch((error) => {
        showToastBanner("切换会话失败", { detail: formatActionError(error), error: true });
      });
      return;
    }
    if (e.target.closest("[data-strip-board]")) {
      openProjectBoardView();
      return;
    }
    const pinBtn = e.target.closest("[data-toggle-pin-cwd]");
    if (pinBtn) {
      void toggleProjectPin(pinBtn.dataset.togglePinCwd);
      return;
    }
    const openWindowBtn = e.target.closest("[data-open-project-window]");
    if (openWindowBtn) {
      e.stopPropagation();
      openProjectWindow(openWindowBtn.dataset.openProjectWindow);
      return;
    }
    const newBtn = e.target.closest("[data-new-in-cwd]");
    if (newBtn) {
      void openNewThreadModal({ cwd: newBtn.dataset.newInCwd, provider: defaultNewThreadProvider() });
      return;
    }
    const pill = e.target.closest("[data-strip-thread-id]");
    if (pill) {
      void selectThread(pill.dataset.stripThreadId).catch((error) => {
        showToastBanner("切换任务失败", { detail: formatActionError(error), error: true });
      });
    }
  });

  $("projectBoard").addEventListener("submit", (e) => {
    if (e.target.id === "spriteCommandForm") {
      e.preventDefault();
      const val = $("spriteCommandInput")?.value?.trim() || state.sprite.draft || "";
      if (val) void handleSpriteCommand(val);
      return;
    }
    if (e.target.id === "moDispatchForm") {
      e.preventDefault();
      void submitSmartDispatch({ confirmOnly: false });
      return;
    }
    if (e.target.id === "moSparkForm") {
      e.preventDefault();
      const val = $("moSparkInput")?.value?.trim() || "";
      const tp = $("moSparkTopicSelect")?.value || "";
      if (!val) return;
      void mutateOverviewSpark({ action: "add", text: val, topicId: tp });
      return;
    }
    const contextForm = e.target.closest("[data-mo-context-form]");
    if (contextForm) {
      e.preventDefault();
      void saveOverviewTopicContext(contextForm.dataset.moContextForm, contextForm);
      return;
    }
    const metricsForm = e.target.closest("[data-mo-metrics-form]");
    if (metricsForm) {
      e.preventDefault();
      void saveOverviewTopicMetrics(metricsForm.dataset.moMetricsForm || "", metricsForm);
    }
  });

  const sidebarSearchInput = $("sidebarSearchInput");
  const sidebarSearchClearBtn = $("sidebarSearchClearBtn");
  const syncSidebarSearchUi = () => {
    const val = String(state.sidebarSearchText || "");
    if (sidebarSearchInput && sidebarSearchInput.value !== val) {
      sidebarSearchInput.value = val;
    }
    if (sidebarSearchClearBtn) {
      sidebarSearchClearBtn.hidden = !val.trim();
    }
  };
  sidebarSearchInput?.addEventListener("input", (e) => {
    state.sidebarSearchText = e.target.value;
    syncSidebarSearchUi();
    scheduleRemoteSearch("sidebar", state.sidebarSearchText);
    renderThreadList();
  });
  sidebarSearchInput?.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && state.sidebarSearchText) {
      e.preventDefault();
      state.sidebarSearchText = "";
      syncSidebarSearchUi();
      scheduleRemoteSearch("sidebar", "");
      renderThreadList();
    }
  });
  sidebarSearchClearBtn?.addEventListener("click", () => {
    state.sidebarSearchText = "";
    syncSidebarSearchUi();
    scheduleRemoteSearch("sidebar", "");
    renderThreadList();
    sidebarSearchInput?.focus();
  });

  $("projectBoard").addEventListener("input", (e) => {
    if (e.target.id === "boardSearchInput") {
      state.searchText = e.target.value;
      scheduleRemoteSearch("board", state.searchText);
      renderProjectBoard();
      return;
    }
    if (e.target.id === "spriteCommandInput") {
      state.sprite.draft = e.target.value;
      tycoon3dInstance?.setUserBusy?.(true);
      return;
    }
    if (e.target.id === "moDispatchInput") {
      state.dispatchDraft = e.target.value;
      if (state.dispatchPreview) {
        state.dispatchPreview = null;
      }
    }
  });

  $("projectBoard").addEventListener("change", (e) => {
    if (e.target.id === "overviewModelSelect") {
      void refreshMissionOverview({ preferredModel: e.target.value || "auto" });
      return;
    }
    if (e.target.id === "moDispatchTopicSelect") {
      state.dispatchTopicId = e.target.value || "";
      state.dispatchPreview = null;
      renderProjectBoard();
      return;
    }
    if (e.target.id === "moDispatchInheritCheck") {
      state.dispatchInheritContext = Boolean(e.target.checked);
      state.dispatchPreview = null;
      return;
    }
    if (handleSpriteDelegatedChange(e)) return;
    if (e.target.id === "moDispatchModeSelect") {
      state.dispatchMode = e.target.value || "auto";
      state.dispatchPreview = null;
      return;
    }
    if (e.target.id === "moDispatchPrioritySelect") {
      const strategy = e.target.value || "adaptive";
      state.dispatchPreview = null;
      void apiPost("/api/overview/dispatch-prefs", { strategy }).then((res) => {
        if (res?.overview) state.missionOverview = res.overview;
        renderProjectBoard();
      }).catch(() => {});
      return;
    }
    if (e.target.id === "moDispatchProviderOrderSelect") {
      const providerOrder = String(e.target.value || "").split(",").map((s) => s.trim()).filter(Boolean);
      state.dispatchPreview = null;
      void apiPost("/api/overview/dispatch-prefs", { strategy: "provider", providerOrder }).then((res) => {
        if (res?.overview) state.missionOverview = res.overview;
        renderProjectBoard();
      }).catch(() => {});
      return;
    }
    if (e.target.id === "moDispatchAgentSelect") {
      state.dispatchAgentKey = e.target.value || "auto";
      state.dispatchModel = "";
      state.dispatchPreview = null;
      renderProjectBoard();
      return;
    }
    if (e.target.id === "moDispatchModelSelect") {
      state.dispatchModel = e.target.value || "";
      state.dispatchPreview = null;
      return;
    }
    const assignSelect = e.target.closest("[data-mo-assign-select]");
    if (assignSelect) {
      void assignOverviewThreadTopic(assignSelect.dataset.moAssignSelect, assignSelect.value || "");
    }
  });

  $("projectBoard").addEventListener("click", (e) => {
    for (const openMenu of document.querySelectorAll("details.mo-refresh-menu[open]")) {
      if (!openMenu.contains(e.target)) openMenu.removeAttribute("open");
    }

    const assistantBadge = e.target.closest("[data-assistant-badge]");
    if (assistantBadge) {
      const type = assistantBadge.dataset.assistantBadge;
      const topics = state.missionOverview?.domains?.flatMap((d) => d.topics || []).filter((tp) => tp.assistantSignals?.counts?.[type] > 0) || [];
      const previous = state.sprite.badgeCursor?.[type] || 0;
      const topic = topics[previous % topics.length];
      if (topic) {
        state.sprite.badgeCursor = { ...state.sprite.badgeCursor, [type]: previous + 1 };
        tycoon3dInstance?.flyToTopic?.(topic.id);
        openSpriteCards(topic.id, type);
      }
      return;
    }
    if (handleSpriteDelegatedClick(e)) return;
    const viewSwitchBtn = e.target.closest("[data-board-view-mode]");
    if (viewSwitchBtn) {
      setBoardViewMode(viewSwitchBtn.dataset.boardViewMode);
      return;
    }

    if (e.target.closest("[data-tycoon-open-unassigned]")) {
      state.tycoonInspectorMode = state.tycoonInspectorMode === "unassigned" ? "" : "unassigned";
      state.tycoonInspectorRoomId = "";
      state.tycoonInspectorClusterOnly = false;
      state.tycoonInspectorBack = null;
      state.tycoonSelectedTopicId = "";
      renderProjectBoard();
      return;
    }

    if (e.target.closest("[data-tycoon-open-recent-done]")) {
      state.tycoonInspectorMode = state.tycoonInspectorMode === "recent_done" ? "" : "recent_done";
      state.tycoonInspectorRoomId = "";
      state.tycoonInspectorClusterOnly = false;
      state.tycoonInspectorBack = null;
      state.tycoonSelectedTopicId = "";
      renderProjectBoard();
      return;
    }

    if (e.target.closest("[data-tycoon-open-directory]")) {
      state.tycoonInspectorMode = state.tycoonInspectorMode === "directory" ? "" : "directory";
      state.tycoonInspectorRoomId = "";
      state.tycoonInspectorClusterOnly = false;
      state.tycoonInspectorBack = null;
      state.tycoonSelectedTopicId = "";
      renderProjectBoard();
      return;
    }

    if (e.target.closest("[data-tycoon-toggle-cluster-scope]")) {
      state.tycoonInspectorClusterOnly = !state.tycoonInspectorClusterOnly;
      state.tycoonInspectorMode = state.tycoonInspectorClusterOnly ? "cluster" : "room";
      renderProjectBoard();
      return;
    }

    if (e.target.closest("[data-tycoon-inspector-back]")) {
      const back = state.tycoonInspectorBack;
      state.tycoonInspectorBack = null;
      state.tycoonSelectedTopicId = "";
      if (back && ["room", "cluster", "directory"].includes(back.mode)) {
        state.tycoonInspectorMode = back.mode;
        state.tycoonInspectorRoomId = back.roomId || "";
        state.tycoonInspectorClusterOnly = Boolean(back.clusterOnly);
      } else {
        state.tycoonInspectorMode = "";
      }
      renderProjectBoard();
      return;
    }

    const subProjBtn = e.target.closest("[data-mo-select-subproject]");
    if (subProjBtn) {
      const tid = subProjBtn.dataset.moSelectSubproject || "";
      const subCwd = subProjBtn.dataset.moSubprojectCwd || "";
      if (tid) {
        if (subCwd) state.selectedSubProjectByTopic = { ...state.selectedSubProjectByTopic, [tid]: subCwd };
        else {
          const next = { ...state.selectedSubProjectByTopic };
          delete next[tid];
          state.selectedSubProjectByTopic = next;
        }
        if (state.dispatchTopicId === tid) {
          state.dispatchPreview = null;
        }
        renderProjectBoard();
      }
      return;
    }

    const inductBtn = e.target.closest("[data-mo-induct-cwd]");
    if (inductBtn) {
      e.stopPropagation();
      void inductOverviewWorkspace(inductBtn.dataset.moInductCwd || "");
      return;
    }

    const moActionBtn = e.target.closest("[data-mo-action]");
    if (moActionBtn) {
      const act = moActionBtn.dataset.moAction;
      if (act === "refresh") {
        const modelSel = $("overviewModelSelect");
        void refreshMissionOverview({ preferredModel: modelSel?.value || "" });
      } else if (act === "sync-projects") {
        void syncOverviewProjects();
      } else if (act === "toggle-immersive") {
        state.immersiveOverview = !state.immersiveOverview;
        renderProjectBoard();
      } else if (act === "preview-dispatch") {
        void submitSmartDispatch({ confirmOnly: true });
      } else if (act === "clear-dispatch-feedback") {
        state.dispatchPreview = null;
        state.lastDispatchReceipt = null;
        renderProjectBoard();
      }
      return;
    }

    const focusIncubatorBtn = e.target.closest("[data-mo-focus-incubator]");
    if (focusIncubatorBtn) {
      const panel = $("moIncubatorPanel");
      panel?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      $("moSparkInput")?.focus();
      return;
    }

    const tycoonCamBtn = e.target.closest("[data-tycoon-cam-room]");
    if (tycoonCamBtn) {
      const rm = tycoonCamBtn.dataset.tycoonCamRoom || "all";
      state.tycoonSelectedTopicId = "";
      state.tycoonInspectorBack = null;
      state.tycoonInspectorClusterOnly = false;
      if (rm === "incubator") {
        state.tycoonInspectorMode = "incubator";
        state.tycoonInspectorRoomId = "";
        tycoon3dInstance?.flyToRoom?.("incubator");
      } else if (rm === "all") {
        state.overviewDomainFilter = "all";
        state.tycoonInspectorMode = "";
        state.tycoonInspectorRoomId = "";
        tycoon3dInstance?.flyToRoom?.("all");
      } else {
        state.overviewDomainFilter = rm;
        state.tycoonInspectorMode = "room";
        state.tycoonInspectorRoomId = rm;
        tycoon3dInstance?.flyToRoom?.(rm);
      }
      renderProjectBoard();
      return;
    }

    const tycoonTopicBtn = e.target.closest("[data-tycoon-select-topic]");
    if (tycoonTopicBtn) {
      const tid = tycoonTopicBtn.dataset.tycoonSelectTopic || "";
      if (["room", "cluster", "directory"].includes(state.tycoonInspectorMode)) {
        state.tycoonInspectorBack = {
          mode: state.tycoonInspectorMode,
          roomId: state.tycoonInspectorRoomId,
          clusterOnly: state.tycoonInspectorClusterOnly,
        };
      }
      state.tycoonSelectedTopicId = tid;
      state.tycoonInspectorMode = "topic";
      tycoon3dInstance?.flyToTopic?.(tid);
      renderProjectBoard();
      return;
    }

    if (e.target.closest("[data-tycoon-close-inspector]")) {
      state.tycoonInspectorMode = "";
      state.tycoonInspectorRoomId = "";
      state.tycoonInspectorClusterOnly = false;
      state.tycoonInspectorBack = null;
      state.tycoonSelectedTopicId = "";
      renderProjectBoard();
      return;
    }

    if (e.target.closest("[data-tycoon-toggle-quest]")) {
      state.tycoonQuestCollapsed = !state.tycoonQuestCollapsed;
      try {
        localStorage.setItem("ac-tycoon-quest-collapsed", state.tycoonQuestCollapsed ? "1" : "0");
      } catch {}
      renderProjectBoard();
      return;
    }

    if (e.target.closest("[data-tycoon-toggle-dispatch-cfg]")) {
      state.tycoonDispatchConfigOpen = !state.tycoonDispatchConfigOpen;
      renderProjectBoard();
      return;
    }

    if (e.target.closest("[data-tycoon-toggle-dock]")) {
      const currentlyOpen = Boolean(
        state.tycoonMobileDockOpen
        || state.dispatchPreview?.routes?.length
        || state.lastDispatchReceipt?.dispatched?.length
      );
      state.tycoonMobileDockOpen = !currentlyOpen;
      if (currentlyOpen) {
        state.dispatchPreview = null;
        state.lastDispatchReceipt = null;
      }
      renderProjectBoard();
      if (state.tycoonMobileDockOpen) {
        setTimeout(() => $("moDispatchInput")?.focus(), 40);
      }
      return;
    }

    if (e.target.closest("[data-tycoon-open-incubator]")) {
      state.tycoonInspectorMode = "incubator";
      state.tycoonSelectedTopicId = "";
      tycoon3dInstance?.flyToRoom?.("incubator");
      renderProjectBoard();
      setTimeout(() => $("moSparkInput")?.focus(), 40);
      return;
    }

    if (e.target.closest("[data-tycoon-fly-harvest]")) {
      const topHarvest = (state.missionOverview?.bossFocus || []).find((x) => x.readyToHarvest)
        || (state.missionOverview?.domains || []).flatMap((d) => d.topics || []).find((t) => t.pipeline?.readyToHarvest);
      if (topHarvest) {
        const id = topHarvest.topicId || topHarvest.id;
        state.tycoonSelectedTopicId = id;
        state.tycoonInspectorMode = "topic";
        tycoon3dInstance?.flyToTopic?.(id);
        renderProjectBoard();
      }
      return;
    }

    if (e.target.closest("[data-tycoon-fly-live]")) {
      const liveTp = (state.missionOverview?.domains || []).flatMap((d) => d.topics || []).find((t) => t.liveCount > 0);
      if (liveTp) {
        state.tycoonSelectedTopicId = liveTp.id;
        state.tycoonInspectorMode = "topic";
        tycoon3dInstance?.flyToTopic?.(liveTp.id);
        renderProjectBoard();
      }
      return;
    }

    if (e.target.closest("[data-tycoon-fly-pending]")) {
      const pendTp = (state.missionOverview?.domains || []).flatMap((d) => d.topics || []).find((t) => t.pendingCount > 0);
      if (pendTp) {
        state.tycoonSelectedTopicId = pendTp.id;
        state.tycoonInspectorMode = "topic";
        tycoon3dInstance?.flyToTopic?.(pendTp.id);
        renderProjectBoard();
      }
      return;
    }

    const scrollTopicBtn = e.target.closest("[data-mo-scroll-topic]");
    if (scrollTopicBtn) {
      const tid = scrollTopicBtn.dataset.moScrollTopic;
      if (state.overviewDomainFilter !== "all") {
        state.overviewDomainFilter = "all";
        renderProjectBoard();
      }
      const card = document.getElementById(`mo-topic-${tid}`);
      card?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    const toggleFocusBtn = e.target.closest("[data-mo-toggle-focus]");
    if (toggleFocusBtn) {
      e.stopPropagation();
      void toggleOverviewBossFocus(toggleFocusBtn.dataset.moToggleFocus || "");
      return;
    }

    const toggleChilledBtn = e.target.closest("[data-mo-toggle-chilled]");
    if (toggleChilledBtn) {
      state.overviewShowChilled = !state.overviewShowChilled;
      renderProjectBoard();
      return;
    }

    const editContextBtn = e.target.closest("[data-mo-toggle-context-edit]");
    if (editContextBtn) {
      const tid = editContextBtn.dataset.moToggleContextEdit || "";
      state.editingContextTopicId = state.editingContextTopicId === tid ? "" : tid;
      renderProjectBoard();
      return;
    }

    const expandContextBtn = e.target.closest("[data-mo-toggle-context-expand]");
    if (expandContextBtn) {
      const tid = expandContextBtn.dataset.moToggleContextExpand || "";
      if (tid) {
        if (state.expandedOverviewContexts.has(tid)) state.expandedOverviewContexts.delete(tid);
        else state.expandedOverviewContexts.add(tid);
        renderProjectBoard();
      }
      return;
    }

    const editMetricsBtn = e.target.closest("[data-mo-toggle-metrics-edit]");
    if (editMetricsBtn) {
      const tid = editMetricsBtn.dataset.moToggleMetricsEdit || "";
      state.editingMetricsTopicId = state.editingMetricsTopicId === tid ? "" : tid;
      renderProjectBoard();
      return;
    }

    const moreMetricsBtn = e.target.closest("[data-mo-toggle-metrics-more]");
    if (moreMetricsBtn) {
      const tid = moreMetricsBtn.dataset.moToggleMetricsMore || "";
      if (tid) {
        if (state.expandedOverviewMetrics.has(tid)) state.expandedOverviewMetrics.delete(tid);
        else state.expandedOverviewMetrics.add(tid);
        renderProjectBoard();
      }
      return;
    }

    const sparkActionBtn = e.target.closest("[data-mo-spark-action]");
    if (sparkActionBtn) {
      void mutateOverviewSpark({
        action: sparkActionBtn.dataset.moSparkAction,
        id: sparkActionBtn.dataset.moSparkId || "",
      });
      return;
    }

    const hatchSparkBtn = e.target.closest("[data-mo-hatch-spark]");
    if (hatchSparkBtn) {
      const sparkId = hatchSparkBtn.dataset.moHatchSpark || "";
      const sparkTopic = hatchSparkBtn.dataset.moHatchTopic || "";
      const sparkTitle = hatchSparkBtn.dataset.moHatchTitle || "";
      state.dispatchSparkId = sparkId;
      state.dispatchTopicId = sparkTopic;
      state.dispatchMode = "new";
      state.dispatchDraft = `立项孵化推进：${sparkTitle}`;
      state.dispatchPreview = null;
      state.tycoonMobileDockOpen = true;
      if (window.innerWidth <= 780) state.tycoonInspectorMode = "";
      renderProjectBoard();
      const inputEl = $("moDispatchInput");
      if (inputEl) {
        inputEl.focus();
        inputEl.select();
      }
      return;
    }

    const selectDispatchTopicBtn = e.target.closest("[data-mo-select-dispatch-topic]");
    if (selectDispatchTopicBtn) {
      const tid = selectDispatchTopicBtn.dataset.moSelectDispatchTopic || "";
      state.dispatchTopicId = tid;
      if (tid && "moSubprojectCwd" in selectDispatchTopicBtn.dataset) {
        const subCwd = selectDispatchTopicBtn.dataset.moSubprojectCwd || "";
        if (subCwd) state.selectedSubProjectByTopic = { ...state.selectedSubProjectByTopic, [tid]: subCwd };
        else {
          const next = { ...state.selectedSubProjectByTopic };
          delete next[tid];
          state.selectedSubProjectByTopic = next;
        }
      }
      state.dispatchPreview = null;
      state.tycoonMobileDockOpen = true;
      renderProjectBoard();
      $("moDispatchInput")?.focus();
      return;
    }

    const quickDispatchBtn = e.target.closest("[data-mo-quick-dispatch-text]");
    if (quickDispatchBtn) {
      const tid = quickDispatchBtn.dataset.moQuickDispatchTopic || "";
      state.dispatchTopicId = tid;
      if (tid && "moSubprojectCwd" in quickDispatchBtn.dataset) {
        const subCwd = quickDispatchBtn.dataset.moSubprojectCwd || "";
        if (subCwd) state.selectedSubProjectByTopic = { ...state.selectedSubProjectByTopic, [tid]: subCwd };
        else {
          const next = { ...state.selectedSubProjectByTopic };
          delete next[tid];
          state.selectedSubProjectByTopic = next;
        }
      }
      state.dispatchDraft = quickDispatchBtn.dataset.moQuickDispatchText || "";
      state.dispatchSparkId = "";
      state.dispatchPreview = null;
      state.tycoonMobileDockOpen = true;
      if (window.innerWidth <= 780) state.tycoonInspectorMode = "";
      renderProjectBoard();
      const inputEl = $("moDispatchInput");
      if (inputEl) {
        inputEl.focus();
        inputEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
      return;
    }

    const podSearchBtn = e.target.closest("[data-mo-pod-search]");
    if (podSearchBtn) {
      const kw = podSearchBtn.dataset.moPodSearch || "";
      state.searchText = state.searchText === kw ? "" : kw;
      scheduleRemoteSearch("board", state.searchText, { immediate: true });
      renderProjectBoard();
      return;
    }

    const domainFilterBtn = e.target.closest("[data-mo-domain-filter]");
    if (domainFilterBtn) {
      const next = domainFilterBtn.dataset.moDomainFilter || "all";
      state.overviewDomainFilter = state.overviewDomainFilter === next && next !== "all" ? "all" : next;
      renderProjectBoard();
      return;
    }

    const prefillBtn = e.target.closest("[data-mo-prefill-text]");
    if (prefillBtn) {
      const targetCwd = prefillBtn.dataset.moPrefillCwd || "";
      const prefillText = prefillBtn.dataset.moPrefillText || "";
      void openNewThreadModal({ cwd: targetCwd, provider: defaultNewThreadProvider() }).then(() => {
        const inputEl = $("promptInput");
        if (inputEl && prefillText) {
          inputEl.value = prefillText;
          inputEl.dispatchEvent(new Event("input", { bubbles: true }));
          inputEl.focus();
        }
      });
      return;
    }

    const expandTopicBtn = e.target.closest("[data-mo-expand-topic]");
    if (expandTopicBtn) {
      state.expandedOverviewTopics.add(expandTopicBtn.dataset.moExpandTopic);
      renderProjectBoard();
      return;
    }

    const collapseTopicBtn = e.target.closest("[data-mo-collapse-topic]");
    if (collapseTopicBtn) {
      state.expandedOverviewTopics.delete(collapseTopicBtn.dataset.moCollapseTopic);
      renderProjectBoard();
      return;
    }

    const archiveToggleBtn = e.target.closest("[data-mo-toggle-archive]");
    if (archiveToggleBtn) {
      const tid = archiveToggleBtn.dataset.moToggleArchive;
      if (state.expandedOverviewArchives.has(tid)) state.expandedOverviewArchives.delete(tid);
      else state.expandedOverviewArchives.add(tid);
      renderProjectBoard();
      return;
    }

    const assignToggleBtn = e.target.closest("[data-mo-toggle-assign]");
    if (assignToggleBtn) {
      e.stopPropagation();
      const tid = assignToggleBtn.dataset.moToggleAssign;
      state.overviewAssignThreadId = state.overviewAssignThreadId === tid ? "" : tid;
      renderProjectBoard();
      return;
    }

    const actionBtn = e.target.closest("[data-board-action]");
    if (actionBtn) {
      const act = actionBtn.dataset.boardAction;
      if (act === "toggle-batch-select") {
        if (state.batchSelect.active) exitBatchSelectMode();
        else enterBatchSelectMode();
      } else if (act === "voice") {
        void enterSpritePhoneCall();
      }
      else if (act === "new") openNewThreadModal({
        cwd: state.scopedProjectCwd || "",
        provider: defaultNewThreadProvider(),
      });
      else if (act === "resume" && state.activeThread) {
        state.boardOpen = false;
        renderTopbarAndControls();
        renderActiveMessages();
        renderPendingRequests();
        renderQueuedTurns();
      } else if (act === "clear-search") {
        state.searchText = "";
        scheduleRemoteSearch("board", "");
        renderProjectBoard();
      } else if (act === "toggle-all-projects") {
        state.showAllProjects = !state.showAllProjects;
        renderProjectBoard();
      }
      return;
    }

    const expandBtn = e.target.closest("[data-expand-project-cwd]");
    if (expandBtn) {
      const cwd = expandBtn.dataset.expandProjectCwd;
      if (cwd) {
        const prevCount = Number(state.expandedProjects.get(cwd)) || 0;
        state.expandedProjects.set(cwd, prevCount + THREAD_EXPAND_STEP);
        renderProjectBoard();
      }
      return;
    }

    const collapseBtn = e.target.closest("[data-collapse-project-cwd]");
    if (collapseBtn) {
      state.expandedProjects.delete(collapseBtn.dataset.collapseProjectCwd);
      renderProjectBoard();
      return;
    }

    if (state.batchSelect.active) {
      const batchProjHead = e.target.closest("[data-batch-project-cwd]");
      if (batchProjHead && batchProjHead.dataset.batchProjectCwd) {
        toggleBatchProjectSelection(batchProjHead.dataset.batchProjectCwd);
        return;
      }
      const openBtn = e.target.closest("[data-board-open-thread]");
      if (openBtn && openBtn.dataset.boardOpenThread) {
        toggleBatchThreadSelection(openBtn.dataset.boardOpenThread, { shiftKey: e.shiftKey });
        return;
      }
    }

    const pinBtn = e.target.closest("[data-toggle-pin-cwd]");
    if (pinBtn) {
      void toggleProjectPin(pinBtn.dataset.togglePinCwd);
      return;
    }

    const aliasBtn = e.target.closest("[data-alias-cwd]");
    if (aliasBtn) {
      void promptProjectAlias(aliasBtn.dataset.aliasCwd);
      return;
    }

    const openWindowBtn = e.target.closest("[data-open-project-window]");
    if (openWindowBtn) {
      e.stopPropagation();
      openProjectWindow(openWindowBtn.dataset.openProjectWindow);
      return;
    }
    const newBtn = e.target.closest("[data-new-in-cwd]");
    if (newBtn) {
      void openNewThreadModal({ cwd: newBtn.dataset.newInCwd, provider: defaultNewThreadProvider() });
      return;
    }

    const openBtn = e.target.closest("[data-board-open-thread]");
    if (openBtn && openBtn.dataset.boardOpenThread) {
      void selectThread(openBtn.dataset.boardOpenThread, { focusSidebar: true }).catch((error) => {
        showToastBanner("打开会话失败", { detail: formatActionError(error), error: true });
      });
    }
  });

  $("threadList").addEventListener("click", (e) => {
    const menuBtn = e.target.closest("[data-thread-menu]");
    if (menuBtn) {
      e.stopPropagation();
      const rect = menuBtn.getBoundingClientRect();
      openThreadContextMenu(menuBtn.dataset.threadMenu, rect.right, rect.bottom);
      return;
    }
    const foldBtn = e.target.closest("[data-batch-fold-cwd]");
    if (foldBtn) {
      e.stopPropagation();
      toggleSidebarGroupCollapse(foldBtn.dataset.batchFoldCwd);
      return;
    }
    const openWindowBtn = e.target.closest("[data-open-project-window]");
    if (openWindowBtn) {
      e.stopPropagation();
      openProjectWindow(openWindowBtn.dataset.openProjectWindow);
      return;
    }
    const newBtn = e.target.closest("[data-new-in-cwd]");
    if (newBtn) {
      e.stopPropagation();
      void openNewThreadModal({ cwd: newBtn.dataset.newInCwd, provider: defaultNewThreadProvider() });
      return;
    }
    const staleBtn = e.target.closest("[data-sidebar-stale-projects]");
    if (staleBtn) {
      e.stopPropagation();
      const mode = staleBtn.dataset.sidebarStaleProjects;
      if (mode === "expand") {
        state.showStaleProjects = true;
        state.staleProjectsOpenedAt = Date.now();
      } else {
        state.showStaleProjects = false;
        state.staleProjectsOpenedAt = 0;
      }
      saveSidebarFoldState();
      renderThreadList();
      return;
    }
    const expandBtn = e.target.closest("[data-sidebar-expand-cwd]");
    if (expandBtn) {
      e.stopPropagation();
      const cwd = normalizeProjectCwd(expandBtn.dataset.sidebarExpandCwd) || "默认工作区";
      const prevCount = Number(state.expandedSidebarGroups.get(cwd)) || 0;
      state.expandedSidebarGroups.set(cwd, prevCount + THREAD_EXPAND_STEP);
      state.expandedThreadsAt[cwd] = Date.now();
      setSidebarGroupManualPref(cwd, "expand");
      renderThreadList();
      return;
    }
    const collapseBtn = e.target.closest("[data-sidebar-collapse-cwd]");
    if (collapseBtn) {
      e.stopPropagation();
      const cwd = normalizeProjectCwd(collapseBtn.dataset.sidebarCollapseCwd) || "默认工作区";
      state.expandedSidebarGroups.delete(cwd);
      delete state.expandedThreadsAt[cwd];
      setSidebarGroupManualPref(cwd, "expand");
      renderThreadList();
      return;
    }
    const toggle = e.target.closest("[data-toggle-cwd]");
    if (toggle) {
      const cwd = toggle.dataset.toggleCwd;
      if (state.batchSelect.active) {
        toggleBatchProjectSelection(cwd);
      } else {
        toggleSidebarGroupCollapse(cwd);
      }
      return;
    }
    const item = e.target.closest("[data-thread-id]");
    if (item) {
      if (state.batchSelect.active) {
        toggleBatchThreadSelection(item.dataset.threadId, { shiftKey: e.shiftKey });
        return;
      }
      exitSpriteOverlayForNavigation();
      void selectThread(item.dataset.threadId).catch((error) => {
        const errMsg = formatActionError(error, "加载会话失败");
        setComposerStatus("error", `加载会话失败：${errMsg}`);
        showToastBanner("加载会话失败", { detail: errMsg, error: true });
      });
    }
  });

  bindLongPressMultiSelect($("threadList"), (el) => {
    const item = el.closest("[data-thread-id]");
    if (item?.dataset?.threadId) return { threadId: item.dataset.threadId };
    const head = el.closest("[data-toggle-cwd]");
    if (head?.dataset?.toggleCwd) return { projectCwd: head.dataset.toggleCwd };
    return null;
  });

  $("threadList").addEventListener("contextmenu", (e) => {
    if (state.batchSelect.active) return;
    const item = e.target.closest("[data-thread-id]");
    const tid = item?.dataset?.threadId || "";
    if (!tid) return;
    e.preventDefault();
    openThreadContextMenu(tid, e.clientX, e.clientY);
  });

  bindLongPressMultiSelect($("projectBoard"), (el) => {
    const task = el.closest("[data-board-open-thread]");
    if (task?.dataset?.boardOpenThread) return { threadId: task.dataset.boardOpenThread };
    const head = el.closest(".board-card-head");
    const card = head?.closest("[data-project-cwd]");
    if (card?.dataset?.projectCwd) return { projectCwd: card.dataset.projectCwd };
    return null;
  });

  $("composerProviderSelect").addEventListener("change", () => {
    state.userPickedDraftModel = false;
    syncComposerProfileSelect();
    syncModelAndEffortSelectors();
    renderAgentTelemetryBar();
  });

  $("composerProfileSelect").addEventListener("change", () => {
    state.userPickedDraftModel = false;
    syncComposerProfileSelect();
    renderComposerConfigChip();
    renderAgentTelemetryBar();
    void refreshModelsForProfile(currentComposerProvider(), currentComposerProfileId());
  });

  $("newModalProbeProfilesBtn")?.addEventListener("click", () => {
    void triggerProfileProbe({ provider: $("newProviderSelect").value || defaultProviderValue() });
  });

  $("newModalAddProfileBtn")?.addEventListener("click", () => {
    openInstanceManagerModal($("newProviderSelect")?.value || defaultProviderValue());
  });

  $("instProviderTabs")?.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-inst-provider]");
    if (!tab) return;
    state.instanceManagerProvider = tab.dataset.instProvider === "claude" ? "claude" : "codex";
    renderInstanceLoginGuide(null);
    renderInstanceManagerModal();
  });

  $("instanceCreateForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    void handleCreateManagedProfile({ loginImmediately: true });
  });

  $("instCreateOnlyBtn")?.addEventListener("click", () => {
    void handleCreateManagedProfile({ loginImmediately: false });
  });

  const handleProfilePillClick = (e, { isNewModal = false } = {}) => {
    const openMgrBtn = e.target.closest("[data-open-instance-modal]");
    if (openMgrBtn) {
      e.stopPropagation();
      if (!isNewModal) setComposerConfigOpen(false);
      openInstanceManagerModal(openMgrBtn.dataset.openInstanceModal || "");
      return;
    }
    const loginBtn = e.target.closest("[data-login-profile]");
    if (loginBtn) {
      e.stopPropagation();
      void triggerProfileLogin({
        provider: loginBtn.dataset.loginProvider,
        profileId: loginBtn.dataset.loginProfile,
        mode: loginBtn.dataset.loginMode || "",
      });
      return;
    }
    const deleteBtn = e.target.closest("[data-delete-profile]");
    if (deleteBtn) {
      e.stopPropagation();
      void handleDeleteManagedProfile({
        provider: deleteBtn.dataset.profileProvider,
        profileId: deleteBtn.dataset.deleteProfile,
      });
      return;
    }
    const copyLoginBtn = e.target.closest("[data-copy-login-cmd]");
    if (copyLoginBtn) {
      e.stopPropagation();
      const loginCmd = copyLoginBtn.dataset.copyLoginCmd || "";
      if (loginCmd) {
        void copyTextToClipboard(loginCmd).then((copied) => {
          if (copied) {
            copyLoginBtn.textContent = "已复制";
            clearTimeout(copyLoginBtn._copyTimer);
            copyLoginBtn._copyTimer = setTimeout(() => {
              copyLoginBtn.textContent = "复制登录";
            }, 1800);
            showToastBanner("已复制终端登录命令", {
              detail: "请在 Mac 终端粘贴执行登录后点击「测通」",
            });
          } else {
            showToastBanner("请手动在终端执行以下命令", { detail: loginCmd });
          }
        });
      }
      return;
    }
    const probeBtn = e.target.closest("[data-probe-profile]");
    if (probeBtn) {
      e.stopPropagation();
      void triggerProfileProbe({
        provider: probeBtn.dataset.probeProvider,
        profileId: probeBtn.dataset.probeProfile,
      });
      return;
    }
    const disableBtn = e.target.closest("[data-toggle-disable-profile]");
    if (disableBtn) {
      e.stopPropagation();
      void toggleProfileDisabled({
        provider: disableBtn.dataset.profileProvider,
        profileId: disableBtn.dataset.toggleDisableProfile,
        disabled: disableBtn.dataset.nextDisabled === "1",
      });
      return;
    }
    const relayBtn = e.target.closest("[data-relay-profile]");
    if (!isNewModal && relayBtn && state.activeThread) {
      const targetProfile = state.profiles.find(
        (p) => p.provider === relayBtn.dataset.profileProvider && p.id === relayBtn.dataset.relayProfile,
      );
      if (targetProfile) {
        void relayThreadWithProfile(targetProfile, {
          cwd: state.activeThread.cwd || "",
          text: $("promptInput")?.value || "",
          images: [...state.images],
        });
      }
      return;
    }
    const selectBtn = e.target.closest("[data-select-profile]");
    if (selectBtn) {
      const nextId = selectBtn.dataset.selectProfile;
      const targetSelect = isNewModal ? $("newProfileSelect") : $("composerProfileSelect");
      if (targetSelect && !targetSelect.disabled) {
        targetSelect.value = nextId;
        if (isNewModal) {
          syncNewProfileSelect();
          void refreshModelsForProfile($("newProviderSelect").value || defaultProviderValue(), nextId);
        } else {
          syncComposerProfileSelect();
          void refreshModelsForProfile(currentComposerProvider(), nextId);
        }
      }
    }
  };

  $("composerProfilePills")?.addEventListener("click", (e) => handleProfilePillClick(e, { isNewModal: false }));
  $("newProfilePills")?.addEventListener("click", (e) => handleProfilePillClick(e, { isNewModal: true }));
  $("instanceManagerModal")?.addEventListener("click", (e) => handleProfilePillClick(e, { isNewModal: false }));
  $("newProfileSelect")?.addEventListener("change", () => {
    syncNewProfileSelect();
    void refreshModelsForProfile($("newProviderSelect").value || defaultProviderValue(), $("newProfileSelect").value);
  });

  $("modelSelect").addEventListener("change", () => {
    const provider = currentComposerProvider();
    const nextModel = $("modelSelect").value;
    const models = ensurePreferredModelInList(
      resolveModelsForProvider(state.modelsByProvider, state.allModels, provider),
      provider,
      nextModel,
    );
    const selected = models.find((m) => (m.id || m.model) === nextModel) || null;
    syncEffortSelectForModel(selected);
    const nextEffort = $("effortSelect").hidden ? "" : ($("effortSelect").value || "");
    if (state.activeThreadId) {
      saveLocalThreadPrefs(state.activeThreadId, { model: nextModel, modelExplicit: true, effort: nextEffort });
      if (state.activeThread) {
        state.activeThread.model = nextModel;
        state.activeThread.reasoningEffort = nextEffort;
      }
      void apiPost("api/thread/prefs", {
        threadId: state.activeThreadId,
        model: nextModel,
        effort: nextEffort,
      }).catch(() => null);
    } else {
      state.userPickedDraftModel = true;
      saveNewThreadPrefs(provider, { model: nextModel, effort: nextEffort });
    }
    const label = selected?.displayName || nextModel || "默认模型";
    setComposerStatus("success", `已选择模型：${label}`, { autoClearMs: 2200 });
  });

  $("effortSelect").addEventListener("change", () => {
    const nextEffort = $("effortSelect").hidden ? "" : ($("effortSelect").value || "");
    if (state.activeThreadId) {
      saveLocalThreadPrefs(state.activeThreadId, { effort: nextEffort });
      if (state.activeThread) state.activeThread.reasoningEffort = nextEffort;
      void apiPost("api/thread/prefs", {
        threadId: state.activeThreadId,
        effort: nextEffort,
      }).catch(() => null);
    } else {
      saveNewThreadPrefs(currentComposerProvider(), { effort: nextEffort });
    }
    renderComposerConfigChip();
  });

  $("permissionSelect").addEventListener("change", async () => {
    const nextPerm = normalizeUiPermissionMode($("permissionSelect").value, "turbo");
    state.defaultPermissionMode = saveDefaultPermissionMode(nextPerm);
    $("permissionSelect").classList.toggle("is-turbo", nextPerm === "turbo");
    renderComposerConfigChip();
    let approvedCount = 0;
    if (state.activeThreadId) {
      saveLocalThreadPrefs(state.activeThreadId, { permissionMode: nextPerm });
      if (state.activeThread) state.activeThread.permissionMode = nextPerm;
      const res = await apiPost("api/thread/prefs", {
        threadId: state.activeThreadId,
        permissionMode: nextPerm,
      }).catch(() => null);
      approvedCount = Number(res?.autoApprovedCount || 0);
      if (nextPerm === "turbo" && !approvedCount) {
        approvedCount = await autoApproveTurboRequestsForThread(state.activeThreadId);
      }
    }
    const label = permissionModeDisplayLabel(nextPerm);
    setComposerStatus(
      "success",
      approvedCount > 0 ? `已切换为 ${label}，并自动批准 ${approvedCount} 项待确认请求` : `已切换权限：${label}`,
      { autoClearMs: 2500 },
    );
  });

  $("newProviderPills")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-select-provider]");
    if (btn?.dataset?.selectProvider) {
      selectNewModalProvider(btn.dataset.selectProvider);
    }
  });
  $("newProviderSelect").addEventListener("change", () => {
    selectNewModalProvider($("newProviderSelect").value || defaultNewThreadProvider());
  });

  $("promptInput").addEventListener("input", () => {
    renderComposerControls();
    void updateSlashCommandMenu();
  });
  $("promptInput").addEventListener("change", () => renderComposerControls());
  $("promptInput").addEventListener("focus", () => {
    minVisualViewportHeightWhileFocused = Math.round(window.visualViewport?.height || 0);
  });
  $("promptInput").addEventListener("blur", () => {
    lastPromptBlurAt = Date.now();
  });
  $("promptInput").addEventListener("compositionend", () => {
    renderComposerControls();
    void updateSlashCommandMenu();
  });
  $("runningSubmitMode").addEventListener("change", () => renderComposerControls());

  $("promptInput").addEventListener("keydown", (e) => {
    if (state.slashMenuOpen && state.slashMenuItems.length && !e.isComposing && e.keyCode !== 229) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        state.slashMenuIndex = (state.slashMenuIndex + 1) % state.slashMenuItems.length;
        renderSlashCommandMenu();
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        state.slashMenuIndex = (state.slashMenuIndex - 1 + state.slashMenuItems.length) % state.slashMenuItems.length;
        renderSlashCommandMenu();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeSlashCommandMenu();
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        applySlashMenuChoice(state.slashMenuIndex);
        return;
      }
    }
    if (shouldSubmitPromptOnEnter({
      key: e.key,
      shiftKey: e.shiftKey,
      isComposing: e.isComposing,
      keyCode: e.keyCode,
      isMobileTouch: isMobileTouchComposer(),
    })) {
      e.preventDefault();
      void handleSend();
    }
  });

  $("composerSlashBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (state.slashMenuOpen) {
      closeSlashCommandMenu();
      return;
    }
    void updateSlashCommandMenu({ manual: true });
    $("promptInput")?.focus();
  });

  $("slashCommandMenu")?.addEventListener("click", (e) => {
    const itemBtn = e.target.closest("[data-slash-index]");
    if (!itemBtn) return;
    e.stopPropagation();
    applySlashMenuChoice(Number(itemBtn.dataset.slashIndex) || 0);
  });

  document.addEventListener("click", (e) => {
    if (!state.slashMenuOpen) return;
    if (e.target.closest("#slashCommandMenu") || e.target.closest("#composerSlashBtn")) return;
    closeSlashCommandMenu();
  });

  $("promptInput").addEventListener("paste", (e) => {
    const { imageFiles, nonImageFiles } = partitionDataTransferFiles(e.clipboardData);
    const plainText = e.clipboardData?.getData("text/plain") || "";
    const uriList = e.clipboardData?.getData("text/uri-list") || "";
    const html = e.clipboardData?.getData("text/html") || "";
    const clipboardFiles = [...(e.clipboardData?.files || [])];
    const linkText = formatClipboardFilesAsMarkdownLinks({
      uriList,
      plainText,
      files: clipboardFiles,
    });
    const filesToUpload = filterFilesNeedingUpload({ nonImageFiles, uriList, plainText, linkText });

    if (imageFiles.length > 0) {
      const cleanedText = cleanClipboardTextForPastedImages({
        plainText,
        uriList,
        html,
        imageFiles,
        clipboardFiles,
      });
      const residualText = (linkText || filesToUpload.length > 0)
        ? stripCoveredFileNamesFromText(cleanedText, nonImageFiles)
        : cleanedText;
      if (!cleanedText || cleanedText !== plainText || linkText || filesToUpload.length > 0) {
        e.preventDefault();
        if (residualText) {
          insertTextIntoPrompt(residualText, { padSpaces: false });
        }
      }
      for (const file of imageFiles) {
        void addComposerImageFile(file);
      }
      if (linkText) insertTextIntoPrompt(linkText);
      if (filesToUpload.length > 0) void uploadAndInsertComposerFiles(filesToUpload);
      return;
    }

    if (linkText || filesToUpload.length > 0) {
      e.preventDefault();
      if (linkText) insertTextIntoPrompt(linkText);
      if (filesToUpload.length > 0) void uploadAndInsertComposerFiles(filesToUpload);
    }
  });

  $("imageUploadBtn").addEventListener("click", () => $("imageFileInput").click());
  $("composerHoldAttachBtn")?.addEventListener("click", () => $("imageFileInput").click());
  $("composerVoiceBtn")?.addEventListener("click", () => {
    if (state.chatTts.enabled) unlockChatReplySpeechAudio();
    if (isMobileComposerViewport()) {
      setComposerHoldMode(true);
      return;
    }
    void toggleComposerDictation();
  });
  $("composerHoldKeyboardBtn")?.addEventListener("click", () => {
    setComposerHoldMode(false, { focusInput: true });
  });

  const holdTalkBtn = $("composerHoldTalkBtn");
  if (holdTalkBtn) {
    holdTalkBtn.addEventListener("contextmenu", (e) => e.preventDefault());
    holdTalkBtn.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (state.dictation.transcribing || state.isSubmitting) return;
      e.preventDefault();
      if (state.chatTts.enabled) unlockChatReplySpeechAudio();
      const token = ++state.dictation.holdToken;
      state.dictation.pointerDown = true;
      state.dictation.pointerId = e.pointerId;
      state.dictation.startY = Number(e.clientY) || 0;
      state.dictation.cancelArmed = false;
      try { holdTalkBtn.setPointerCapture?.(e.pointerId); } catch {}
      try { navigator.vibrate?.(12); } catch {}
      renderComposerDictationUi();
      void startComposerAudioCapture({ autoSendOnMax: true, holdToken: token });
    });

    holdTalkBtn.addEventListener("pointermove", (e) => {
      if (!state.dictation.pointerDown || state.dictation.pointerId !== e.pointerId) return;
      const dy = state.dictation.startY - (Number(e.clientY) || 0);
      const nextCancel = dy > 48;
      if (nextCancel !== state.dictation.cancelArmed) {
        state.dictation.cancelArmed = nextCancel;
        try { navigator.vibrate?.(10); } catch {}
        renderComposerDictationUi();
      }
    });

    const finishHoldGesture = (e, { forceCancel = false } = {}) => {
      if (!state.dictation.pointerDown) return;
      if (e?.pointerId !== undefined && state.dictation.pointerId !== null && e.pointerId !== state.dictation.pointerId) {
        return;
      }
      const shouldCancel = Boolean(forceCancel || state.dictation.cancelArmed);
      state.dictation.pointerDown = false;
      state.dictation.pointerId = null;
      if (!state.dictation.active) {
        state.dictation.cancelArmed = false;
        renderComposerDictationUi();
        return;
      }
      void stopComposerDictation({ submit: !shouldCancel, autoSend: !shouldCancel });
    };

    holdTalkBtn.addEventListener("pointerup", (e) => finishHoldGesture(e, { forceCancel: false }));
    holdTalkBtn.addEventListener("pointercancel", (e) => finishHoldGesture(e, { forceCancel: true }));
    holdTalkBtn.addEventListener("lostpointercapture", (e) => {
      if (state.dictation.pointerDown) finishHoldGesture(e, { forceCancel: false });
    });

    window.addEventListener("blur", () => {
      if (state.dictation.pointerDown || (state.dictation.holdMode && state.dictation.active)) {
        state.dictation.pointerDown = false;
        void stopComposerDictation({ submit: false });
      }
    });
    window.addEventListener("resize", () => {
      if (!isMobileComposerViewport() && state.dictation.holdMode && !state.dictation.active && !state.dictation.transcribing) {
        setComposerHoldMode(false);
      } else {
        renderComposerDictationUi();
      }
    });
  }
  $("imageFileInput").addEventListener("change", (e) => {
    const files = [...(e.target.files || [])];
    e.target.value = "";
    for (const file of files) void addComposerImageFile(file);
  });

  $("composerImages").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-img]");
    if (!btn) return;
    state.images.splice(Number(btn.dataset.removeImg), 1);
    renderComposerImages();
    renderComposerControls();
  });

  const composerArea = $("composerArea");
  const composerBox = composerArea?.querySelector(".composer-box");
  if (composerArea && composerBox) {
    let dragDepth = 0;
    const isFileDrag = (e) => Boolean(e.dataTransfer?.types && [...e.dataTransfer.types].includes("Files"));
    composerArea.addEventListener("dragenter", (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      dragDepth += 1;
      composerBox.classList.add("is-dragover");
    });
    composerArea.addEventListener("dragover", (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
      composerBox.classList.add("is-dragover");
    });
    composerArea.addEventListener("dragleave", (e) => {
      if (!isFileDrag(e) && dragDepth === 0) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) composerBox.classList.remove("is-dragover");
    });
    composerArea.addEventListener("drop", (e) => {
      dragDepth = 0;
      composerBox.classList.remove("is-dragover");
      const allFiles = [...(e.dataTransfer?.files || [])];
      const { imageFiles, nonImageFiles } = partitionDataTransferFiles(e.dataTransfer);
      const uriList = e.dataTransfer?.getData("text/uri-list") || "";
      const plainText = e.dataTransfer?.getData("text/plain") || "";
      const nonImageLinkText = formatClipboardFilesAsMarkdownLinks({
        uriList,
        plainText,
        files: allFiles,
      });
      const filesToUpload = filterFilesNeedingUpload({
        nonImageFiles,
        uriList,
        plainText,
        linkText: nonImageLinkText,
      });
      if (!imageFiles.length && !nonImageLinkText && !filesToUpload.length) return;
      e.preventDefault();
      for (const file of imageFiles) void addComposerImageFile(file);
      if (nonImageLinkText) insertTextIntoPrompt(nonImageLinkText);
      if (filesToUpload.length > 0) void uploadAndInsertComposerFiles(filesToUpload);
    });
  }

  $("messagesViewport")?.addEventListener("error", (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (!img.classList.contains("msg-image") && !img.classList.contains("md-inline-img")) return;
    const failedSrc = img.getAttribute("src") || img.currentSrc || img.src || "";
    if (failedSrc) {
      markThreadImageFailed(failedSrc);
      revealedDeferredImageSrcs.delete(failedSrc);
    }
    markCardImageBroken(img);
  }, true);

  document.addEventListener("click", (e) => {
    const fileTrigger = e.target.closest("[data-local-file-path]");
    if (fileTrigger) {
      const targetThreadId = state.activeThread?.id || state.activeThreadId || "";
      const filePath = fileTrigger.dataset.localFilePath || "";
      const lineAnchor = Number(fileTrigger.dataset.localFileLine) || null;
      if (targetThreadId && filePath) {
        e.preventDefault();
        void openFilePreviewModal(targetThreadId, filePath, lineAnchor);
        return;
      }
    }
    const revealAllTrigger = e.target.closest("[data-reveal-thread-images]");
    if (revealAllTrigger) {
      const activeTid = state.activeThread?.id || state.activeThreadId || "";
      if (activeTid) {
        setThreadImagesUnlocked(activeTid, true);
      }
      return;
    }
    const revealInlineTrigger = e.target.closest("[data-reveal-inline-img]");
    if (revealInlineTrigger) {
      const wrap = revealInlineTrigger.closest(".md-inline-img-wrap");
      const lazyImg = wrap?.querySelector("img[data-lazy-src]");
      if (lazyImg) {
        activateDeferredImage(lazyImg);
      }
      return;
    }
    const previewTrigger = e.target.closest("[data-preview-src]");
    if (previewTrigger && !e.target.closest("[data-remove-img]")) {
      const deferredImg = previewTrigger.querySelector("img[data-lazy-src]");
      if (deferredImg) {
        activateDeferredImage(deferredImg);
        return;
      }
      const src = previewTrigger.dataset.previewSrc || "";
      const rawSrc = previewTrigger.dataset.previewRaw || "";
      const caption = previewTrigger.dataset.previewCaption || "";
      if (src) {
        openImagePreviewModal(src, caption, rawSrc);
        return;
      }
    }
    const inlineImg = e.target.closest(".md-inline-img");
    if (inlineImg) {
      if (inlineImg.dataset.lazySrc) {
        activateDeferredImage(inlineImg);
        return;
      }
      const src = inlineImg.dataset.previewSrc || inlineImg.getAttribute("src") || "";
      const rawSrc = inlineImg.dataset.previewRaw || "";
      const caption = inlineImg.dataset.previewCaption || inlineImg.getAttribute("alt") || "图片预览";
      if (src) openImagePreviewModal(src, caption, rawSrc);
    }
  });

  $("imagePreviewLoadRawBtn")?.addEventListener("click", () => {
    const info = state.imagePreview;
    const img = $("imagePreviewImg");
    const metaEl = $("imagePreviewMeta");
    const btn = $("imagePreviewLoadRawBtn");
    if (!info?.rawSrc || !img || !btn) return;
    btn.disabled = true;
    btn.textContent = "加载中…";
    img.onload = () => {
      if (state.imagePreview) state.imagePreview.showingRaw = true;
      btn.hidden = true;
      btn.disabled = false;
      if (metaEl) metaEl.textContent = "原图";
    };
    img.onerror = () => {
      btn.disabled = false;
      btn.textContent = "重试原图";
    };
    img.src = info.rawSrc;
  });

  async function revealLocalThreadFile(threadId, path, triggerBtn = null) {
    const cleanThreadId = String(threadId || "").trim();
    const cleanPath = String(path || "").trim();
    if (!cleanThreadId || !cleanPath) return;
    const managerName = localFileManagerName();
    if (triggerBtn) triggerBtn.disabled = true;
    try {
      await apiPost("api/thread/reveal", { threadId: cleanThreadId, path: cleanPath });
    } catch (error) {
      showToastBanner(`打开${managerName}失败`, { detail: formatActionError(error, `无法在${managerName}中定位该文件`), error: true });
    } finally {
      if (triggerBtn) triggerBtn.disabled = false;
    }
  }

  document.addEventListener("contextmenu", (e) => {
    if (!isLoopbackHostname(location.hostname)) return;
    const fileTrigger = e.target?.closest?.("[data-local-file-path]");
    const filePath = fileTrigger?.dataset?.localFilePath || "";
    if (!filePath) return;
    const hasMacNativeMenu = Boolean(window.webkit?.messageHandlers?.localFileContextMenu);
    if (hasMacNativeMenu && filePath.startsWith("/") && !filePath.startsWith("//")) {
      return;
    }
    e.preventDefault();
    const targetThreadId = (fileTrigger.id === "imagePreviewImg" || fileTrigger.id === "imagePreviewCaption")
      ? (state.imagePreview?.revealThreadId || state.activeThread?.id || state.activeThreadId || "")
      : (fileTrigger.closest?.("#filePreviewModal")
        ? (state.filePreview?.threadId || state.activeThread?.id || state.activeThreadId || "")
        : (state.activeThread?.id || state.activeThreadId || ""));
    openLocalFileContextMenu(targetThreadId, filePath, e.clientX, e.clientY, fileTrigger);
  });

  $("imagePreviewRevealBtn")?.addEventListener("click", () => {
    const info = state.imagePreview;
    const btn = $("imagePreviewRevealBtn");
    if (!info?.revealThreadId || !info?.revealPath) return;
    void revealLocalThreadFile(info.revealThreadId, info.revealPath, btn);
  });

  $("filePreviewRevealBtn")?.addEventListener("click", () => {
    const fp = state.filePreview;
    const btn = $("filePreviewRevealBtn");
    if (!fp?.threadId || !fp?.path) return;
    void revealLocalThreadFile(fp.threadId, fp.path, btn);
  });

  const imgModal = $("imagePreviewModal");
  if (imgModal) {
    const stage = $("imagePreviewStage");
    const imgEl = $("imagePreviewImg");
    const zoomBtn = $("imagePreviewZoomBtn");
    const zoomOutBtn = $("imagePreviewZoomOutBtn");
    const zoomInBtn = $("imagePreviewZoomInBtn");

    const applyPreviewTransform = (dragging = false) => {
      const info = state.imagePreview;
      const svgHostEl = $("imagePreviewSvgHost");
      const isSvg = Boolean(info?.svgMode);
      const targetEl = isSvg ? svgHostEl : imgEl;
      if (!info || !targetEl) return;
      const minScale = isSvg ? 0.5 : 1;
      const maxScale = isSvg ? 8 : 6;
      const scale = Math.max(minScale, Math.min(maxScale, info.scale || 1));
      info.scale = scale;

      if (!isSvg && scale <= 1.01) {
        info.scale = 1;
        info.tx = 0;
        info.ty = 0;
        targetEl.style.transform = "";
        targetEl.classList.remove("is-zoomed", "is-dragging");
        if (zoomBtn) zoomBtn.hidden = true;
        if (zoomOutBtn) zoomOutBtn.hidden = true;
        if (zoomInBtn) zoomInBtn.hidden = true;
        return;
      }

      const atRestSvg = isSvg
        && Math.abs(scale - 1) <= 0.01
        && Math.abs(info.tx || 0) < 0.5
        && Math.abs(info.ty || 0) < 0.5;
      if (atRestSvg) {
        info.scale = 1;
        info.tx = 0;
        info.ty = 0;
        targetEl.style.transform = "";
        targetEl.classList.remove("is-zoomed", "is-dragging");
      } else {
        targetEl.classList.add("is-zoomed");
        targetEl.classList.toggle("is-dragging", dragging);
        targetEl.style.transform = `translate3d(${(info.tx || 0).toFixed(1)}px, ${(info.ty || 0).toFixed(1)}px, 0) scale(${scale.toFixed(3)})`;
      }

      if (zoomBtn) {
        zoomBtn.hidden = false;
        zoomBtn.textContent = `${Math.round(info.scale * 100)}%`;
      }
      if (zoomOutBtn) zoomOutBtn.hidden = !isSvg;
      if (zoomInBtn) zoomInBtn.hidden = !isSvg;
    };

    const zoomAtPoint = (nextScaleRaw, clientX, clientY) => {
      const info = state.imagePreview;
      if (!info || !stage) return;
      const isSvg = Boolean(info.svgMode);
      const oldScale = info.scale || 1;
      const nextScale = Math.max(isSvg ? 0.5 : 1, Math.min(isSvg ? 8 : 6, nextScaleRaw));
      if (Math.abs(nextScale - oldScale) < 0.001) return;
      const rect = stage.getBoundingClientRect();
      const ox = clientX - (rect.left + rect.width / 2);
      const oy = clientY - (rect.top + rect.height / 2);
      const ratio = nextScale / oldScale;
      info.tx = ox - (ox - (info.tx || 0)) * ratio;
      info.ty = oy - (oy - (info.ty || 0)) * ratio;
      info.scale = nextScale;
      applyPreviewTransform(false);
    };

    const zoomByStep = (factor) => {
      const info = state.imagePreview;
      if (!info || !stage) return;
      const rect = stage.getBoundingClientRect();
      zoomAtPoint((info.scale || 1) * factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
    };

    const resetPreviewZoom = () => {
      if (!state.imagePreview) return;
      state.imagePreview.scale = 1;
      state.imagePreview.tx = 0;
      state.imagePreview.ty = 0;
      applyPreviewTransform(false);
    };

    zoomBtn?.addEventListener("click", resetPreviewZoom);
    zoomInBtn?.addEventListener("click", () => zoomByStep(1.35));
    zoomOutBtn?.addEventListener("click", () => zoomByStep(1 / 1.35));
    stage?.addEventListener("dblclick", (e) => {
      e.preventDefault();
      if ((state.imagePreview?.scale || 1) > 1.05) {
        resetPreviewZoom();
      } else {
        zoomAtPoint(2.2, e.clientX, e.clientY);
      }
    });

    // Trackpad two-finger pinch (`ctrlKey` + wheel), mouse wheel in SVG mode, & two-finger pan when zoomed
    stage?.addEventListener("wheel", (e) => {
      const info = state.imagePreview;
      if (!info) return;
      if (e.ctrlKey || e.metaKey || info.svgMode) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.008);
        zoomAtPoint((info.scale || 1) * factor, e.clientX, e.clientY);
      } else if ((info.scale || 1) > 1.01) {
        e.preventDefault();
        info.tx = (info.tx || 0) - e.deltaX;
        info.ty = (info.ty || 0) - e.deltaY;
        applyPreviewTransform(true);
      }
    }, { passive: false });

    // Touch two-finger pinch & single-finger pan
    let pinchState = null;
    let panState = null;
    const touchDist = (t1, t2) => Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
    const touchMid = (t1, t2) => ({ x: (t1.clientX + t2.clientX) / 2, y: (t1.clientY + t2.clientY) / 2 });

    stage?.addEventListener("touchstart", (e) => {
      const info = state.imagePreview;
      if (!info) return;
      if (e.touches.length === 2) {
        e.preventDefault();
        panState = null;
        const mid = touchMid(e.touches[0], e.touches[1]);
        pinchState = {
          startDist: Math.max(1, touchDist(e.touches[0], e.touches[1])),
          startScale: info.scale || 1,
          lastMid: mid,
        };
      } else if (e.touches.length === 1 && (info.svgMode || (info.scale || 1) > 1.01)) {
        panState = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: info.tx || 0, ty: info.ty || 0 };
      }
    }, { passive: false });

    stage?.addEventListener("touchmove", (e) => {
      const info = state.imagePreview;
      if (!info) return;
      if (e.touches.length === 2 && pinchState) {
        e.preventDefault();
        const dist = touchDist(e.touches[0], e.touches[1]);
        const mid = touchMid(e.touches[0], e.touches[1]);
        const nextScale = pinchState.startScale * (dist / pinchState.startDist);
        info.tx = (info.tx || 0) + (mid.x - pinchState.lastMid.x);
        info.ty = (info.ty || 0) + (mid.y - pinchState.lastMid.y);
        pinchState.lastMid = mid;
        zoomAtPoint(nextScale, mid.x, mid.y);
      } else if (e.touches.length === 1 && panState) {
        e.preventDefault();
        info.tx = panState.tx + (e.touches[0].clientX - panState.x);
        info.ty = panState.ty + (e.touches[0].clientY - panState.y);
        applyPreviewTransform(true);
      }
    }, { passive: false });

    stage?.addEventListener("touchend", () => {
      pinchState = null;
      panState = null;
      applyPreviewTransform(false);
    });

    stage?.addEventListener("mousedown", (e) => {
      const info = state.imagePreview;
      if (e.button !== 0 || !info || (!info.svgMode && (info.scale || 1) <= 1.01)) return;
      e.preventDefault();
      panState = { x: e.clientX, y: e.clientY, tx: info.tx || 0, ty: info.ty || 0 };
    });
    window.addEventListener("mousemove", (e) => {
      if (!panState || !state.imagePreview) return;
      state.imagePreview.tx = panState.tx + (e.clientX - panState.x);
      state.imagePreview.ty = panState.ty + (e.clientY - panState.y);
      applyPreviewTransform(true);
    });
    window.addEventListener("mouseup", () => {
      if (!panState) return;
      panState = null;
      applyPreviewTransform(false);
    });

    imgModal.addEventListener("click", (e) => {
      if (e.target === imgModal) imgModal.close();
    });
    imgModal.addEventListener("close", () => {
      resetPreviewZoom();
      imgModal.classList.remove("is-svg-preview");
      if (zoomBtn) zoomBtn.hidden = true;
      if (zoomOutBtn) zoomOutBtn.hidden = true;
      if (zoomInBtn) zoomInBtn.hidden = true;
      if (imgEl) {
        imgEl.onload = null;
        imgEl.onerror = null;
        imgEl.removeAttribute("src");
        imgEl.hidden = false;
      }
      const currentSvgHost = $("imagePreviewSvgHost");
      if (currentSvgHost) {
        currentSvgHost.innerHTML = "";
        currentSvgHost.hidden = true;
      }
      resetMobileViewportAfterModal();
    });
  }

  $("filePreviewToggleRawBtn")?.addEventListener("click", () => {
    const fp = state.filePreview;
    if (!fp?.meta) return;
    fp.rawMode = !fp.rawMode;
    const btn = $("filePreviewToggleRawBtn");
    if (btn) btn.textContent = fp.rawMode ? "渲染" : "源码";
    renderFilePreviewBody(fp.meta, { threadId: fp.threadId, rawMode: fp.rawMode });
  });

  $("filePreviewCopyBtn")?.addEventListener("click", async () => {
    const text = state.filePreview?.meta?.content || "";
    const btn = $("filePreviewCopyBtn");
    if (!text || !btn) return;
    try {
      await navigator.clipboard?.writeText(text);
      btn.textContent = "已复制";
      setTimeout(() => { btn.textContent = "复制"; }, 1400);
    } catch {}
  });

  const fileModal = $("filePreviewModal");
  if (fileModal) {
    fileModal.addEventListener("click", (e) => {
      if (e.target === fileModal) fileModal.close();
    });
    fileModal.addEventListener("close", () => {
      const bodyEl = $("filePreviewBody");
      if (bodyEl) {
        for (const media of bodyEl.querySelectorAll("video, audio")) {
          try {
            media.pause();
            media.removeAttribute("src");
            media.load();
          } catch {}
        }
        bodyEl.innerHTML = "";
      }
      resetMobileViewportAfterModal();
    });
  }

  $("composerGoalBtn").addEventListener("click", () => {
    state.composerGoal = !state.composerGoal;
    renderComposerControls();
  });

  $("composerStatus").addEventListener("click", (e) => {
    if (e.target.closest("[data-unarchive-retry-trigger]") && state.lastUnarchiveContext?.threadId) {
      const ctx = state.lastUnarchiveContext;
      clearComposerStatus();
      void unarchiveThreadAndOptionallyResend(ctx.threadId, { retrySend: true });
      return;
    }
    if (e.target.closest("[data-failover-trigger]") && state.lastFailoverContext?.altProfile) {
      const ctx = state.lastFailoverContext;
      clearComposerStatus();
      void relayThreadWithProfile(ctx.altProfile, ctx);
      return;
    }
    if (e.target.closest("[data-dismiss-composer-status]")) clearComposerStatus();
  });

  $("composerArchivedBanner")?.addEventListener("click", (e) => {
    if (e.target.closest("[data-unarchive-active-thread]") && state.activeThreadId) {
      void unarchiveThreadAndOptionallyResend(state.activeThreadId, { retrySend: false });
    }
  });

  $("codexCompatBanner")?.addEventListener("click", (e) => {
    const newThreadBtn = e.target.closest("[data-codex-exec-new-thread]");
    if (newThreadBtn) {
      const profileId = String(newThreadBtn.dataset.profileId || "").trim();
      void startNewCodexExecThreadFromActive(profileId);
      return;
    }
    const toggleBtn = e.target.closest("[data-codex-exec-toggle]");
    if (toggleBtn) {
      const profileId = String(toggleBtn.dataset.profileId || "").trim();
      const nextEnabled = toggleBtn.getAttribute("aria-checked") !== "true";
      if (profileId) void toggleCodexExecMode(profileId, nextEnabled);
      return;
    }
    const dismissBtn = e.target.closest("[data-codex-exec-dismiss]");
    if (dismissBtn) {
      const profileId = String(dismissBtn.dataset.profileId || "").trim();
      if (profileId) dismissCodexCompatBanner(profileId);
    }
  });

  const sendBtn = $("sendBtn");
  sendBtn.addEventListener("pointerdown", () => {
    const now = Date.now();
    sendBtnPointerDown = {
      at: now,
      hadRecentCollapse: lastKeyboardCollapseAt > 0 && (now - lastKeyboardCollapseAt) >= 0 && (now - lastKeyboardCollapseAt) < 450,
    };
  });
  sendBtn.addEventListener("pointercancel", () => {
    sendBtnPointerDown = null;
  });
  document.addEventListener("pointerdown", (e) => {
    if (!(e.target instanceof Element && e.target.closest("#sendBtn"))) {
      sendBtnPointerDown = null;
    }
  }, { capture: true, passive: true });
  sendBtn.addEventListener("click", (e) => {
    const pointerInfo = sendBtnPointerDown;
    sendBtnPointerDown = null;
    if (!shouldAllowSendButtonClick({
      isMobileTouch: isMobileTouchComposer(),
      isEditingQueue: Boolean(activeEditingQueueItem()),
      nowMs: Date.now(),
      lastKeyboardCollapseAtMs: lastKeyboardCollapseAt,
      lastPromptBlurAtMs: lastPromptBlurAt,
      pointerDownAtMs: pointerInfo?.at || 0,
      pointerDownHadRecentCollapse: Boolean(pointerInfo?.hadRecentCollapse),
      clickDetail: Number(e.detail ?? 1),
    })) {
      e.preventDefault();
      return;
    }
    void handleSend();
  });
  $("messagesViewport")?.addEventListener("click", async (e) => {
    const targetEl = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (!targetEl) return;
    const resumeBtn = targetEl.closest("[data-resume-interrupted-turn]");
    if (resumeBtn) {
      if (!state.activeThreadId || state.isSubmitting) return;
      if (isActiveThreadRunning()) {
        showToastBanner("当前会话正在执行中", { detail: "无需重复启动" });
        return;
      }
      const goalSuspended = Boolean(state.activeThread?.goalState?.active);
      resumeBtn.disabled = true;
      try {
        await handleSend({
          overrideText: "继续完成刚才中断的步骤",
          clearDraft: false,
          forceGoal: goalSuspended,
        });
      } finally {
        resumeBtn.disabled = false;
      }
      return;
    }
    const forkBtn = targetEl.closest("[data-fork-turn-index]");
    if (forkBtn) {
      if (!state.activeThreadId || forkBtn.disabled) return;
      const upToTurnIndex = Number(forkBtn.dataset.forkTurnIndex);
      const upToTurnId = forkBtn.dataset.forkTurnId || "";
      forkBtn.disabled = true;
      try {
        await forkThreadAction(state.activeThreadId, {
          ...(Number.isInteger(upToTurnIndex) && upToTurnIndex >= 0 ? { upToTurnIndex } : {}),
          ...(upToTurnId ? { upToTurnId } : {}),
        });
      } finally {
        forkBtn.disabled = false;
      }
      return;
    }
    const pinPlanBtn = targetEl.closest("[data-pin-plan-turn-index]");
    if (pinPlanBtn) {
      if (!state.activeThreadId || pinPlanBtn.disabled) return;
      const turnIndex = Number(pinPlanBtn.dataset.pinPlanTurnIndex);
      const turnId = pinPlanBtn.dataset.pinPlanTurnId || "";
      const excerpt = pinPlanBtn.closest(".msg-row")?.querySelector("[data-copy-message]")?.dataset?.copyMessage || "";
      pinPlanBtn.disabled = true;
      try {
        await pinTurnAsPlanAction({
          threadId: state.activeThreadId,
          turnId,
          turnIndex: Number.isInteger(turnIndex) ? turnIndex : -1,
          excerpt,
        });
      } finally {
        pinPlanBtn.disabled = false;
      }
      return;
    }
    if (handleMermaidInteraction(e)) return;
    await handleCopyButtonClick(e);
  });

  const handleCopyButtonClick = async (e) => {
    const targetEl = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (!targetEl) return false;
    const messageCopyBtn = targetEl.closest("[data-copy-message]");
    const copyBtn = messageCopyBtn || targetEl.closest("[data-copy-code]");
    if (!copyBtn) return false;
    const block = copyBtn.closest(".md-code-block");
    const codeText = messageCopyBtn
      ? messageCopyBtn.dataset.copyMessage
      : (block?.querySelector("pre > code")?.textContent ?? "");
    if (!codeText) return true;
    const copyLabel = messageCopyBtn?.querySelector("span") || copyBtn;
    const copied = await copyTextToClipboard(codeText);
    if (copied) {
      copyLabel.textContent = "已复制";
      copyBtn.classList.add("is-copied");
      clearTimeout(copyBtn._copyTimer);
      copyBtn._copyTimer = setTimeout(() => {
        copyLabel.textContent = "复制";
        copyBtn.classList.remove("is-copied");
      }, 1500);
    } else if (messageCopyBtn) {
      showToastBanner("复制失败", { detail: "请重试或选中文字后复制", error: true });
    }
    return true;
  };

  const handleMermaidInteraction = (e) => {
    const targetEl = e.target instanceof Element ? e.target : e.target?.parentElement;
    if (!targetEl) return false;
    const toggleBtn = targetEl.closest("[data-mermaid-toggle]");
    if (toggleBtn) {
      const block = toggleBtn.closest("[data-mermaid-block]");
      if (!block) return true;
      const stageEl = block.querySelector("[data-mermaid-stage]");
      const sourceEl = block.querySelector("pre.md-mermaid-source");
      const nextShowSource = block.dataset.mermaidView !== "source";
      block.dataset.mermaidView = nextShowSource ? "source" : "diagram";
      if (stageEl) stageEl.hidden = nextShowSource;
      if (sourceEl) sourceEl.hidden = !nextShowSource;
      toggleBtn.textContent = nextShowSource ? "图表" : "源码";
      toggleBtn.setAttribute("aria-pressed", nextShowSource ? "true" : "false");
      if (!nextShowSource && block.dataset.mermaidState !== "rendered" && block.dataset.mermaidState !== "streaming") {
        scheduleMermaidHydration(block);
      }
      return true;
    }
    const zoomBtn = targetEl.closest("[data-mermaid-zoom]");
    if (zoomBtn) {
      const block = zoomBtn.closest("[data-mermaid-block]");
      if (!block) return true;
      const caption = block.querySelector(".md-mermaid-lang")?.textContent?.trim() || "Mermaid 图表";
      const svgEl = block.querySelector("[data-mermaid-stage] svg");
      if (svgEl) {
        openMermaidPreviewModal(svgEl.outerHTML, caption);
      } else {
        void hydrateMermaidBlocks(block)
          .then(() => {
            const nextSvg = block.querySelector("[data-mermaid-stage] svg");
            if (nextSvg) openMermaidPreviewModal(nextSvg.outerHTML, caption);
            else showToastBanner("暂无可放大的图表", { detail: "请稍候待图表渲染完成后再试" });
          })
          .catch(() => {
            showToastBanner("图表放大预览失败", { detail: "请切换源码查看", error: true });
          });
      }
      return true;
    }
    const stageSvg = targetEl.closest("[data-mermaid-stage] svg");
    if (stageSvg && !targetEl.closest("a[href], button")) {
      const selected = typeof window !== "undefined" ? window.getSelection?.()?.toString?.()?.trim() : "";
      if (selected) return false;
      const block = stageSvg.closest("[data-mermaid-block]");
      const caption = block?.querySelector(".md-mermaid-lang")?.textContent?.trim() || "Mermaid 图表";
      openMermaidPreviewModal(stageSvg.outerHTML, caption);
      return true;
    }
    return false;
  };

  const handleMermaidDblClick = (e) => {
    const targetEl = e.target instanceof Element ? e.target : e.target?.parentElement;
    const svgEl = targetEl?.closest?.("[data-mermaid-stage] svg");
    if (!svgEl || $("imagePreviewModal")?.open) return;
    const block = svgEl.closest("[data-mermaid-block]");
    const caption = block?.querySelector(".md-mermaid-lang")?.textContent?.trim() || "Mermaid 图表";
    openMermaidPreviewModal(svgEl.outerHTML, caption);
  };

  $("messagesViewport")?.addEventListener("dblclick", handleMermaidDblClick);
  $("filePreviewBody")?.addEventListener("click", async (e) => {
    if (handleMermaidInteraction(e)) return;
    await handleCopyButtonClick(e);
  });
  $("filePreviewBody")?.addEventListener("dblclick", handleMermaidDblClick);
  $("loadOlderBtn").addEventListener("click", async () => {
    try {
      await loadOlderMessages();
    } catch (error) {
      setComposerStatus("error", `加载更早对话失败：${formatActionError(error)}`);
    }
  });
  $("refreshThreadBtn").addEventListener("click", async () => {
    try {
      await refreshThreads();
      if (state.activeThreadId) await selectThread(state.activeThreadId, { focusScroll: false });
    } catch (error) {
      const errMsg = formatActionError(error, "刷新失败");
      setComposerStatus("error", `刷新失败：${errMsg}`);
      showToastBanner("刷新失败", { detail: errMsg, error: true });
    }
  });

  const interruptBtn = $("interruptBtn");
  interruptBtn.addEventListener("click", async () => {
    if (!state.activeThreadId || interruptBtn.disabled) return;
    interruptBtn.disabled = true;
    setComposerStatus("info", "正在中断当前执行…");
    try {
      await apiPost("api/interrupt", { threadId: state.activeThreadId });
      await selectThread(state.activeThreadId, { focusScroll: false });
      setComposerStatus("success", "已中断当前执行", { autoClearMs: 2200 });
    } catch (error) {
      const errMsg = formatActionError(error, "中断失败");
      setComposerStatus("error", `中断失败：${errMsg}`);
      showToastBanner("中断失败", { detail: errMsg, error: true });
    } finally {
      interruptBtn.disabled = false;
    }
  });

  $("goalToggleBtn").addEventListener("click", async () => {
    if (!state.activeThreadId || !state.activeThread) return;
    try {
      const enabled = !state.activeThread.goalState?.active;
      const res = await apiPost("api/thread/goal", {
        threadId: state.activeThreadId,
        enabled,
        model: $("modelSelect").value || "",
        effort: $("effortSelect").hidden ? "" : ($("effortSelect").value || ""),
        permissionMode: normalizeUiPermissionMode($("permissionSelect").value || state.defaultPermissionMode || "turbo", "turbo"),
      });
      state.activeThread.goalState = res.goalState;
      renderTopbarAndControls();
      renderThreadList();
    } catch (error) {
      const errMsg = formatActionError(error, "切换 Goal 模式失败");
      setComposerStatus("error", `切换 Goal 失败：${errMsg}`);
      showToastBanner("切换 Goal 失败", { detail: errMsg, error: true });
    }
  });

  $("renameThreadBtn").addEventListener("click", async () => {
    if (!state.activeThreadId) return;
    const next = prompt("输入新的会话标题：", state.activeThread?.title || "");
    if (!next || !next.trim()) return;
    try {
      await apiPost("api/thread/name", { threadId: state.activeThreadId, name: next.trim() });
      await selectThread(state.activeThreadId, { focusScroll: false });
      await refreshThreads();
    } catch (error) {
      const errMsg = formatActionError(error, "重命名失败");
      setComposerStatus("error", `重命名失败：${errMsg}`);
      showToastBanner("重命名失败", { detail: errMsg, error: true });
    }
  });

  $("pinTicketBtn")?.addEventListener("click", () => {
    setTopbarMenuOpen(false);
    void pinThreadAsTicket(state.activeThreadId);
  });
  $("newSiblingThreadBtn")?.addEventListener("click", () => {
    setTopbarMenuOpen(false);
    if (!state.activeThreadId) return;
    void startLinkedThreadDraft({ mode: "same", sourceThreadId: state.activeThreadId });
  });
  $("newChildTaskThreadBtn")?.addEventListener("click", () => {
    setTopbarMenuOpen(false);
    if (!state.activeThreadId) return;
    void startLinkedThreadDraft({ mode: "child", sourceThreadId: state.activeThreadId });
  });
  $("linkExistingTaskBtn")?.addEventListener("click", () => {
    setTopbarMenuOpen(false);
    if (!state.activeThreadId) return;
    state.tasksBindPickerId = state.tasksSelectedId || state.tasks.find((t) => t.status === "open")?.id || "";
    void openTasksModal(state.tasksBindPickerId);
  });
  $("sidebarTasksBtn")?.addEventListener("click", () => {
    setSidebarOpen(false);
    void openTasksModal();
  });
  $("openTasksModalBtn")?.addEventListener("click", () => {
    setTopbarMenuOpen(false);
    void openTasksModal();
  });
  $("tasksModal")?.addEventListener("click", async (e) => {
    if (e.target === $("tasksModal")) {
      $("tasksModal").close();
      return;
    }
    const statusTab = e.target.closest("[data-tasks-status]");
    if (statusTab) {
      state.tasksModalStatus = statusTab.dataset.tasksStatus || "open";
      renderTasksModal();
      return;
    }
    const toggleCollapse = e.target.closest("[data-task-toggle-collapse]");
    if (toggleCollapse) {
      e.stopPropagation();
      const id = toggleCollapse.dataset.taskToggleCollapse;
      if (state.tasksCollapsedIds.has(id)) state.tasksCollapsedIds.delete(id);
      else state.tasksCollapsedIds.add(id);
      renderTasksModal();
      return;
    }
    const selectRow = e.target.closest("[data-task-select]");
    if (selectRow) {
      const id = selectRow.dataset.taskSelect;
      if (id && state.tasksSelectedId !== id) {
        state.tasksSelectedId = id;
        state.tasksBindPickerId = "";
        renderTasksModal();
        void loadTaskDetailLogs(id);
      }
      return;
    }
    const planBtn = e.target.closest("[data-task-jump-plan]");
    if (planBtn) {
      void jumpToTaskPlan(planBtn.dataset.taskJumpPlan);
      return;
    }
    const siblingBtn = e.target.closest("[data-task-new-sibling]");
    if (siblingBtn) {
      void startLinkedThreadDraft({ mode: "same", taskId: siblingBtn.dataset.taskNewSibling });
      return;
    }
    const childBtn = e.target.closest("[data-task-new-child]");
    if (childBtn) {
      void startLinkedThreadDraft({ mode: "child", parentTaskId: childBtn.dataset.taskNewChild });
      return;
    }
    const toggleBind = e.target.closest("[data-task-toggle-bind]");
    if (toggleBind) {
      const id = toggleBind.dataset.taskToggleBind;
      state.tasksBindPickerId = state.tasksBindPickerId === id ? "" : id;
      renderTasksModal();
      return;
    }
    const bindBtn = e.target.closest("[data-task-bind-thread]");
    if (bindBtn) {
      const id = bindBtn.dataset.taskBindThread;
      const tid = bindBtn.dataset.threadId;
      await apiPost(`api/tasks/${encodeURIComponent(id)}`, { addThreadId: tid });
      state.tasksBindPickerId = "";
      await refreshTasks();
      await loadTaskDetailLogs(id);
      showToastBanner("已将历史会话挂入任务");
      return;
    }
    const unbindBtn = e.target.closest("[data-task-unbind-thread]");
    if (unbindBtn) {
      const id = unbindBtn.dataset.taskUnbindThread;
      const tid = unbindBtn.dataset.threadId;
      await apiPost(`api/tasks/${encodeURIComponent(id)}`, { removeThreadId: tid });
      await refreshTasks();
      await loadTaskDetailLogs(id);
      return;
    }
    const statusBtn = e.target.closest("[data-task-set-status]");
    if (statusBtn) {
      const id = statusBtn.dataset.taskSetStatus;
      const nextStatus = statusBtn.dataset.status;
      await apiPost(`api/tasks/${encodeURIComponent(id)}`, { status: nextStatus });
      await refreshTasks();
      await loadTaskDetailLogs(id);
      return;
    }
    const threadJump = e.target.closest("[data-task-strip-thread]");
    if (threadJump) {
      $("tasksModal").close();
      await selectThread(threadJump.dataset.taskStripThread, { focusScroll: true });
    }
  });
  $("tasksModal")?.addEventListener("submit", async (e) => {
    if (e.target.id === "taskQuickLogForm") {
      e.preventDefault();
      const taskId = e.target.dataset.taskId;
      const input = $("taskQuickLogInput");
      const text = input?.value?.trim() || "";
      if (!taskId || !text) return;
      await apiPost(`api/tasks/${encodeURIComponent(taskId)}/log`, { text, kind: "agent_log", actor: "user" });
      if (input) input.value = "";
      await refreshTasks();
      await loadTaskDetailLogs(taskId);
    }
  });
  $("tasksSearchInput")?.addEventListener("input", (e) => {
    state.tasksModalQuery = e.target.value || "";
    renderTasksModal();
  });
  $("newRootTaskBtn")?.addEventListener("click", () => {
    const form = $("newRootTaskForm");
    if (!form) return;
    form.hidden = !form.hidden;
    if (!form.hidden) $("newRootTaskTitleInput")?.focus();
  });
  $("cancelNewRootTaskBtn")?.addEventListener("click", () => {
    const form = $("newRootTaskForm");
    if (form) form.hidden = true;
  });
  $("newRootTaskForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("newRootTaskTitleInput")?.value?.trim() || "";
    const goal = $("newRootTaskGoalInput")?.value?.trim() || "";
    if (!title) return;
    const res = await apiPost("api/tasks", { title, goal, cwd: state.activeThread?.cwd || state.newThreadCwd || "" });
    $("newRootTaskTitleInput").value = "";
    $("newRootTaskGoalInput").value = "";
    $("newRootTaskForm").hidden = true;
    await refreshTasks();
    if (res?.task?.id) {
      state.tasksSelectedId = res.task.id;
      renderTasksModal();
      void loadTaskDetailLogs(res.task.id);
    }
  });

  $("toggleThreadImagesBtn")?.addEventListener("click", () => {
    const tid = state.activeThread?.id || state.activeThreadId || "";
    if (!tid) return;
    setThreadImagesUnlocked(tid, !isThreadImagesUnlocked(tid));
    setTopbarMenuOpen(false);
  });

  $("archiveThreadBtn").addEventListener("click", async () => {
    if (!state.activeThreadId || !state.activeThread) return;
    if (state.activeThread.archived) {
      setTopbarMenuOpen(false);
      await unarchiveThreadAndOptionallyResend(state.activeThreadId, { retrySend: false });
      return;
    }
    try {
      await apiPost("api/thread/archive", { threadId: state.activeThreadId, archived: true });
      if (!state.showArchived) {
        await selectThread("");
      } else {
        await selectThread(state.activeThreadId, { focusScroll: false });
      }
      await refreshThreads();
    } catch (error) {
      const errMsg = formatActionError(error, "归档操作失败");
      setComposerStatus("error", `归档失败：${errMsg}`);
      showToastBanner("归档失败", { detail: errMsg, error: true });
    }
  });

  $("queuedTurnsBar").addEventListener("click", async (e) => {
    const toggleBtn = e.target.closest("[data-queue-toggle]");
    if (toggleBtn) {
      state.queuedPanelCollapsed = !state.queuedPanelCollapsed;
      renderQueuedTurns();
      return;
    }

    const steerBtn = e.target.closest("[data-queue-steer]");
    if (steerBtn && state.activeThreadId) {
      if (steerBtn.disabled) return;
      const steerId = steerBtn.dataset.queueSteer;
      const entry = (state.queuedTurns || []).find((item) => item.id === steerId);
      steerBtn.disabled = true;
      setComposerStatus("pending", "正在直接引导进当前会话…");
      try {
        const isThreadRunning = Boolean(state.activeThread?.live || state.liveActivity?.status === "running");
        const res = await apiPost("api/thread/queue/steer", {
          threadId: state.activeThreadId,
          id: steerId,
          expectedTurnId: isThreadRunning ? (state.liveActivity?.turnId || "") : "",
        });
        applyActiveQueuedTurns(state.activeThreadId, res.items || []);
        if (state.activeThread) {
          const entryText = String(entry?.text || res.entry?.text || "").trim();
          const imageCount = Number(entry?.imageCount ?? res.entry?.imageCount ?? 0);
          const userContent = [
            ...(entryText ? [{ type: "text", text: entryText }] : []),
            ...(imageCount > 0 ? [{ type: "text", text: `[图片附件 x${imageCount}]` }] : []),
          ];
          if (userContent.length) {
            if (!Array.isArray(state.activeThread.turns)) state.activeThread.turns = [];
            const tailTurn = state.activeThread.turns[state.activeThread.turns.length - 1];
            if (tailTurn && (tailTurn.status === "inProgress" || tailTurn.status === "running")) {
              tailTurn.items = [
                ...(Array.isArray(tailTurn.items) ? tailTurn.items : []),
                { type: "userMessage", id: `user-steer-${Date.now()}`, content: userContent },
              ];
            } else {
              const turnId = res.result?.turn?.id || `optimistic-turn-${Date.now()}`;
              state.activeThread.turns.push({
                id: turnId,
                status: "inProgress",
                startedAt: Math.floor(Date.now() / 1000),
                items: [{ type: "userMessage", id: `user-${turnId}`, content: userContent }],
              });
            }
          }
          state.activeThread.live = true;
          syncThreadSummaryIntoList({ id: state.activeThreadId, live: true });
          state.liveActivity = mergeLiveActivity(state.liveActivity, {
            turnId: res.result?.turn?.id || state.liveActivity?.turnId || "",
            status: "running",
            phase: `${providerDisplayName(state.activeThread.provider)} 执行中`,
          });
          renderThreadList();
          renderTopbarAndControls();
          renderActiveMessages();
          scheduleActiveThreadReload(state.activeThreadId, 350);
        }
        setComposerStatus("success", "已将排队消息直接引导进当前会话", { autoClearMs: 2600 });
      } catch (error) {
        const errMsg = formatActionError(error, "引导失败");
        setComposerStatus("error", `引导排队消息失败：${errMsg}`);
        showToastBanner("引导失败", { detail: errMsg, error: true });
      } finally {
        if (steerBtn.isConnected) steerBtn.disabled = false;
      }
      return;
    }

    const editBtn = e.target.closest("[data-queue-edit]");
    if (editBtn && state.activeThreadId) {
      const editId = editBtn.dataset.queueEdit;
      const entry = (state.queuedTurns || []).find((item) => item.id === editId);
      const targetThreadId = state.activeThreadId;
      try {
        editBtn.disabled = true;
        const res = await apiGet(
          `api/thread/queue/entry?threadId=${encodeURIComponent(targetThreadId)}&id=${encodeURIComponent(editId)}`,
        );
        if (state.activeThreadId !== targetThreadId) return;
        const fullEntry = res?.entry || entry;
        if (!fullEntry) {
          throw new Error("未找到该排队消息");
        }
        const input = $("promptInput");
        const existingEdit = activeEditingQueueItem();
        const prevDraftText = existingEdit ? existingEdit.prevDraftText : String(input?.value || "");
        const prevImages = existingEdit ? existingEdit.prevImages : [...(state.images || [])];
        const prevGoal = existingEdit ? existingEdit.prevGoal : Boolean(state.composerGoal);

        const restoredImages = (Array.isArray(fullEntry.images) ? fullEntry.images : [])
          .filter((img) => img && img.dataUrl)
          .map((img, idx) => ({
            id: `queue-edit-${editId}-${idx}-${Date.now()}`,
            name: img.name || `image-${idx + 1}.jpg`,
            dataUrl: img.dataUrl,
            byteLength: estimateDataUrlBytes(img.dataUrl),
            compressed: true,
          }));

        const listIndex = (state.queuedTurns || []).findIndex((q) => q.id === editId);
        state.editingQueueItem = {
          id: editId,
          threadId: targetThreadId,
          position: Number(fullEntry.position) || (listIndex >= 0 ? listIndex + 1 : 1),
          prevDraftText,
          prevImages,
          prevGoal,
        };
        if (input) {
          input.value = String(fullEntry.text || "");
        }
        state.images = restoredImages;
        state.composerGoal = Boolean(fullEntry.goalMode);
        renderComposerImages();
        renderComposerEditBanner();
        renderQueuedTurns();
        renderComposerControls();
        input?.focus();
        setComposerStatus(
          "info",
          restoredImages.length
            ? `已载入排队 #${state.editingQueueItem.position}（含 ${restoredImages.length} 张图片），修改后点击“保存更新”`
            : `已载入排队 #${state.editingQueueItem.position}，修改后点击“保存更新”`,
          { autoClearMs: 4000 },
        );
      } catch (error) {
        if (Number(error?.status || 0) === 404 || error?.code === "queued_turn_not_found") {
          setComposerStatus("info", "该排队消息已自动发送或取消", { autoClearMs: 4000 });
          void apiGet(`api/thread/queue?id=${encodeURIComponent(targetThreadId)}`)
            .then((qRes) => applyActiveQueuedTurns(targetThreadId, qRes?.items || []))
            .catch(() => {});
        } else {
          setComposerStatus("error", `载入排队消息失败：${formatActionError(error)}`);
        }
      } finally {
        if (editBtn.isConnected) editBtn.disabled = false;
      }
      return;
    }

    const cancelBtn = e.target.closest("[data-queue-cancel], [data-cancel-queue]");
    if (!cancelBtn || !state.activeThreadId) return;
    const cancelId = cancelBtn.dataset.queueCancel || cancelBtn.dataset.cancelQueue;
    try {
      const res = await apiPost("api/thread/queue/cancel", {
        threadId: state.activeThreadId,
        id: cancelId,
      });
      if (state.editingQueueItem?.id === cancelId) {
        clearQueueEditState({ restoreDraft: true });
      }
      applyActiveQueuedTurns(state.activeThreadId, res.items || []);
    } catch (error) {
      setComposerStatus("error", `取消排队失败：${formatActionError(error)}`);
    }
  });

  $("composerEditBanner")?.addEventListener("click", (e) => {
    const cancelEditBtn = e.target.closest("[data-cancel-queue-edit]");
    if (!cancelEditBtn) return;
    clearQueueEditState({ restoreDraft: true });
    $("promptInput")?.focus();
  });

  $("pendingRequestsDock").addEventListener("click", async (e) => {
    let targetRequestId = "";
    try {
      const declineBtn = e.target.closest("[data-decline-id]");
      if (declineBtn) {
        targetRequestId = declineBtn.dataset.declineId || "";
        await apiPost("api/server-request", {
          requestId: targetRequestId,
          decision: "decline",
        });
        removePendingRequestById(targetRequestId);
        return;
      }
      const optBtn = e.target.closest("[data-option-id]");
      if (optBtn) {
        targetRequestId = optBtn.dataset.requestId || "";
        await apiPost("api/server-request", {
          requestId: targetRequestId,
          optionId: optBtn.dataset.optionId,
        });
        removePendingRequestById(targetRequestId);
        return;
      }
      const decBtn = e.target.closest("[data-decision]");
      if (decBtn) {
        targetRequestId = decBtn.dataset.requestId || "";
        await apiPost("api/approval", {
          requestId: targetRequestId,
          decision: decBtn.dataset.decision,
        });
        removePendingRequestById(targetRequestId);
      }
    } catch (error) {
      if (targetRequestId && Number(error?.status) === 404) {
        removePendingRequestById(targetRequestId);
        setComposerStatus("info", "该确认项已自动处理或过期", { autoClearMs: 2500 });
        return;
      }
      const errMsg = formatActionError(error, "响应审批请求失败");
      setComposerStatus("error", errMsg);
      showToastBanner("审批请求失败", { detail: errMsg, error: true });
    }
  });

  $("pendingRequestsDock").addEventListener("change", (e) => syncUserInputQuestion(e.target));

  $("pendingRequestsDock").addEventListener("submit", async (e) => {
    const form = e.target.closest("form[data-kind='userInput']");
    if (!form) return;
    e.preventDefault();
    if (form.dataset.submitting === "1" || !form.reportValidity()) return;
    const requestId = form.dataset.requestId || "";
    const submitBtn = form.querySelector("[type='submit']");
    try {
      const req = state.pendingRequests.find((r) => r.id === requestId);
      const answers = collectUserInputAnswers(req, form);
      form.dataset.submitting = "1";
      submitBtn.disabled = true;
      submitBtn.textContent = "提交中…";
      await apiPost("api/server-request", { requestId, decision: "accept", answers });
      removePendingRequestById(requestId);
    } catch (error) {
      if (requestId && Number(error?.status) === 404) {
        removePendingRequestById(requestId);
        setComposerStatus("info", "该确认项已自动处理或过期", { autoClearMs: 2500 });
        return;
      }
      const errMsg = formatActionError(error, "提交回答失败");
      setComposerStatus("error", errMsg);
      showToastBanner("提交回答失败", { detail: errMsg, error: true });
    } finally {
      delete form.dataset.submitting;
      submitBtn.disabled = false;
      submitBtn.textContent = "提交回答";
    }
  });

  $("newThreadBtn").addEventListener("click", () => {
    openNewThreadModal({
      cwd: state.activeThread?.cwd || state.newThreadCwd || state.scopedProjectCwd || "",
      provider: defaultNewThreadProvider(),
    });
  });

  $("continueAgentSelect").addEventListener("change", () => { void refreshContinueThreadModels(); });
  $("continueModelSelect").addEventListener("change", syncContinueThreadEffort);
  $("continueThreadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submit = $("continueThreadSubmitBtn");
    const profile = selectedContinueProfile();
    if (submit.disabled || !profile) return;
    const modal = $("continueThreadModal");
    const errorEl = $("continueThreadError");
    const model = $("continueModelSelect").value;
    const effort = $("continueEffortSelect").value;
    const effortDisabled = $("continueEffortSelect").disabled;
    for (const id of ["continueAgentSelect", "continueModelSelect", "continueEffortSelect"]) $(id).disabled = true;
    errorEl.hidden = true;
    submit.disabled = true;
    submit.textContent = "创建中…";
    try {
      const result = await apiPost("api/thread/continue", {
        threadId: modal.dataset.threadId,
        targetProvider: profile.provider,
        targetProfileId: profile.id,
        model,
        effort,
      });
      saveNewThreadPrefs(profile.provider, { model, effort });
      if (state.providerFilter !== "all" && state.providerFilter !== profile.provider) setProviderFilter("all");
      await refreshThreads();
      await selectThread(result.thread.id);
      modal.close();
      $("promptInput").focus();
      setComposerStatus("success", "已带入上下文，输入指令即可继续", { autoClearMs: 3000 });
    } catch (error) {
      errorEl.textContent = formatActionError(error, "创建接续会话失败");
      errorEl.hidden = false;
    } finally {
      $("continueAgentSelect").disabled = false;
      $("continueModelSelect").disabled = false;
      $("continueEffortSelect").disabled = effortDisabled;
      submit.disabled = false;
      submit.textContent = "新建接续会话";
    }
  });

  $("newThreadForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const submitBtn = $("createThreadSubmitBtn");
    const errEl = $("newThreadError");
    errEl.hidden = true;
    errEl.textContent = "";
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "创建中…";
    }
    const provider = $("newProviderSelect").value;
    const profileId = $("newProfileSelect").value || defaultProfileForProvider(provider);
    const model = $("newModelSelect")?.value || "";
    const effort = getNewThreadPrefs(provider).effort || "";
    const cwd = $("newCwdInput").value.trim();
    const permissionMode = normalizeUiPermissionMode($("newPermissionSelect").value || "turbo", "turbo");
    state.defaultPermissionMode = saveDefaultPermissionMode(permissionMode);
    const goalMode = $("newGoalCheckbox").checked;
    const text = $("newPromptInput").value;
    try {
      const created = await apiPost("api/thread/new", {
        provider,
        profileId,
        model,
        effort,
        cwd,
        text,
        permissionMode,
        goalMode,
      });
      saveNewThreadPrefs(provider, { model, effort });
      $("newPromptInput").value = "";
      $("newGoalCheckbox").checked = false;
      $("newThreadModal").close();
      const createdProvider = created?.thread?.provider || provider;
      if (state.providerFilter !== "all" && createdProvider && state.providerFilter !== createdProvider) {
        setProviderFilter("all");
      }
      await refreshThreads();
      if (created?.thread?.id) {
        saveLocalThreadPrefs(created.thread.id, { model, effort, permissionMode });
        await selectThread(created.thread.id);
      }
    } catch (error) {
      const errMsg = formatActionError(error, "创建会话失败");
      errEl.textContent = `创建失败：${errMsg}`;
      errEl.hidden = false;
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = "创建会话";
      }
    }
  });

  $("sidebarUpdateBtn")?.addEventListener("click", () => {
    setSidebarOpen(false);
    void openUpdateModal();
  });
  $("openUpdateModalBtn")?.addEventListener("click", () => void openUpdateModal());
  window.addEventListener("ac:locale-change", () => {
    if ($("updateModal")?.open) renderUpdateModal();
    if (state.missionOverview && !state.scopedProjectCwd) {
      void loadMissionOverview({ trigger: "view", force: false });
    }
  });
  spriteController.bindFullscreenEvents();

  $("openAutomationsModalBtn")?.addEventListener("click", () => void openAutomationsModal());
  $("sidebarAutomationsBtn")?.addEventListener("click", () => void openAutomationsModal());
  $("refreshAutomationsBtn")?.addEventListener("click", () => void refreshAutomations().catch(() => {}));
  $("automationsGlobalToggle")?.addEventListener("change", (e) => {
    void apiPost("api/automations/toggle", { enabled: Boolean(e.target.checked) })
      .then((snap) => {
        state.automationsSnapshot = snap;
        renderAutomationsModal(snap);
      })
      .catch(() => {});
  });
  $("autoProviderSelect")?.addEventListener("change", () => {
    const provider = $("autoProviderSelect")?.value || "codex";
    syncAutomationProfileSelect();
    syncAutomationModelAndEffortSelects();
    void refreshModelsForProfile(provider, $("autoProfileSelect")?.value || "");
  });
  $("autoProfileSelect")?.addEventListener("change", () => {
    const provider = $("autoProviderSelect")?.value || "codex";
    void refreshModelsForProfile(provider, $("autoProfileSelect")?.value || "");
  });
  $("autoModelSelect")?.addEventListener("change", () => {
    const provider = $("autoProviderSelect")?.value || "codex";
    const modelId = $("autoModelSelect")?.value || "";
    const models = resolveModelsForProvider(state.modelsByProvider, state.allModels, provider);
    const selectedObj = models.find((m) => (m.id || m.model) === modelId) || null;
    syncAutomationEffortSelect(selectedObj, "");
  });
  $("autoScheduleSelect")?.addEventListener("change", () => {
    const isCustom = $("autoScheduleSelect")?.value === "__custom__";
    const customField = $("autoScheduleCustomField");
    if (customField) customField.hidden = !isCustom;
    if (isCustom) $("autoScheduleCustomInput")?.focus();
  });
  $("autoCancelEditBtn")?.addEventListener("click", () => {
    resetAutomationForm();
    const details = $("automationCreateDetails");
    if (details) details.open = false;
  });
  $("automationCreateForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const prompt = $("autoPromptInput")?.value?.trim() || "";
    if (!prompt) return;
    const editingId = $("autoTaskIdInput")?.value?.trim() || "";
    const scheduleVal = $("autoScheduleSelect")?.value || "FREQ=DAILY;BYHOUR=9;BYMINUTE=0";
    const rrule = scheduleVal === "__custom__"
      ? ($("autoScheduleCustomInput")?.value?.trim() || "FREQ=DAILY;BYHOUR=9;BYMINUTE=0")
      : scheduleVal;
    const provider = $("autoProviderSelect")?.value || "codex";
    try {
      const snap = await apiPost("api/automations/custom", {
        action: "create",
        ...(editingId ? { id: editingId } : {}),
        name: $("autoNameInput")?.value?.trim() || "",
        provider,
        profileId: $("autoProfileSelect")?.value || defaultProfileForProvider(provider),
        model: $("autoModelSelect")?.value || "",
        reasoningEffort: $("autoEffortSelect")?.disabled ? "" : ($("autoEffortSelect")?.value || ""),
        rrule,
        cwd: $("autoCwdInput")?.value?.trim() || "",
        prompt,
      });
      state.automationsSnapshot = snap;
      renderAutomationsModal(snap);
      resetAutomationForm();
      const details = $("automationCreateDetails");
      if (details) details.open = false;
      showToastBanner(editingId ? "已更新定时任务配置" : "已添加定时任务并开启后台托管");
    } catch (error) {
      showToastBanner(editingId ? "更新定时任务失败" : "创建定时任务失败", { detail: formatActionError(error), error: true });
    }
  });
  $("automationsList")?.addEventListener("click", async (e) => {
    const editBtn = e.target.closest("[data-auto-edit]");
    if (editBtn) {
      const key = editBtn.dataset.autoEdit;
      const task = (state.automationsSnapshot?.tasks || []).find((t) => t.taskKey === key || t.id === key);
      if (task) startEditAutomationTask(task);
      return;
    }
    const runBtn = e.target.closest("[data-auto-run]");
    if (runBtn) {
      const key = runBtn.dataset.autoRun;
      runBtn.disabled = true;
      try {
        const res = await apiPost("api/automations/run", { taskKey: key });
        if (res?.snapshot) {
          state.automationsSnapshot = res.snapshot;
          renderAutomationsModal(res.snapshot);
        }
        showToastBanner("已立即唤起执行定时任务", {
          detail: res?.threadId ? `已启动会话 ${res.threadId}` : "任务已在后台启动",
        });
      } catch (error) {
        showToastBanner("唤起定时任务失败", { detail: formatActionError(error), error: true });
      } finally {
        runBtn.disabled = false;
      }
      return;
    }
    const toggleBtn = e.target.closest("[data-auto-toggle]");
    if (toggleBtn) {
      const key = toggleBtn.dataset.autoToggle;
      const managed = toggleBtn.dataset.autoNextManaged === "1";
      const snap = await apiPost("api/automations/toggle", { taskKey: key, managed }).catch(() => null);
      if (snap) {
        state.automationsSnapshot = snap;
        renderAutomationsModal(snap);
      }
      return;
    }
    const delBtn = e.target.closest("[data-auto-delete]");
    if (delBtn) {
      const key = delBtn.dataset.autoDelete;
      delBtn.disabled = true;
      try {
        const snap = await apiPost("api/automations/delete", { taskKey: key });
        if (snap) {
          state.automationsSnapshot = snap;
          renderAutomationsModal(snap);
        }
        showToastBanner("已删除定时计划");
      } catch (error) {
        showToastBanner("删除定时计划失败", { detail: formatActionError(error), error: true });
      } finally {
        delBtn.disabled = false;
      }
      return;
    }
    const openThreadBtn = e.target.closest("[data-auto-open-thread]");
    if (openThreadBtn) {
      const tid = openThreadBtn.dataset.autoOpenThread;
      $("automationsModal")?.close();
      if (tid) void selectThread(tid, { focusScroll: true }).catch(() => {});
    }
  });
  $("automationsModal")?.addEventListener("click", (e) => {
    if (e.target === $("automationsModal")) $("automationsModal").close();
  });
  $("restartServiceBtn")?.addEventListener("click", () => void triggerRestartService());
  $("applyDesktopUpdateBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = $("desktopUpdateMenu");
    setDesktopUpdateMenuOpen(Boolean(menu?.hidden));
  });
  $("desktopUpdateMenu")?.addEventListener("click", (e) => {
    const choice = e.target?.closest?.("[data-desktop-open]");
    if (!choice) return;
    e.stopPropagation();
    void triggerDesktopAppUpdate({ openAfterBuild: choice.dataset.desktopOpen === "1" });
  });
  $("updateModal")?.addEventListener("close", () => setDesktopUpdateMenuOpen(false));
  $("updateModal")?.addEventListener("cancel", (e) => {
    const menu = $("desktopUpdateMenu");
    if (menu && !menu.hidden) {
      e.preventDefault();
      setDesktopUpdateMenuOpen(false);
    }
  });
  document.addEventListener("click", (e) => {
    const menu = $("desktopUpdateMenu");
    if (!menu || menu.hidden) return;
    if (!e.target?.closest?.("#desktopUpdateMenuWrap")) {
      setDesktopUpdateMenuOpen(false);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const menu = $("desktopUpdateMenu");
    if (menu && !menu.hidden) {
      e.preventDefault();
      e.stopPropagation();
      setDesktopUpdateMenuOpen(false);
    }
  }, true);
  $("checkUpdateBtn")?.addEventListener("click", () => void triggerCheckUpdates());
  $("applyUpdateBtn")?.addEventListener("click", () => void triggerApplyUpdate());
  $("autoCheckUpdateToggle")?.addEventListener("change", (e) => {
    updateSettingsTabBadge();
    void saveUpdateConfig({ autoCheckEnabled: Boolean(e.target.checked) });
  });
  $("autoUpdateToggle")?.addEventListener("change", (e) => {
    updateSettingsTabBadge();
    void saveUpdateConfig({ autoUpdateEnabled: Boolean(e.target.checked) });
  });
  $("autoUpdateDesktopToggle")?.addEventListener("change", (e) => {
    updateSettingsTabBadge();
    void saveUpdateConfig({ autoUpdateDesktopApp: Boolean(e.target.checked) });
  });
  $("agentAutoTitleToggle")?.addEventListener("change", async (e) => {
    const enabled = Boolean(e.target.checked);
    updateSettingsTabBadge();
    try {
      await apiPost("api/settings", { agentAutoTitle: enabled });
      showToastBanner(enabled ? "已开启 AI 会话主动同步标题" : "已关闭 AI 会话主动同步标题");
    } catch (error) {
      e.target.checked = !enabled;
      updateSettingsTabBadge();
      showToastBanner("保存设置失败", { detail: error?.message || "未知错误", error: true });
    }
  });
  $("autoUpdateCliToggle")?.addEventListener("change", async (e) => {
    const enabled = Boolean(e.target.checked);
    updateSettingsTabBadge();
    try {
      await apiPost("api/settings", { autoUpdateCli: enabled });
      showToastBanner(enabled ? "已开启闲时自动更新 CLI" : "已关闭闲时自动更新 CLI");
    } catch (error) {
      e.target.checked = !enabled;
      updateSettingsTabBadge();
      showToastBanner("保存设置失败", { detail: error?.message || "未知错误", error: true });
    }
  });
  $("agyAutoCompactToggle")?.addEventListener("change", async (e) => {
    const enabled = Boolean(e.target.checked);
    updateSettingsTabBadge();
    const tokensEl = $("agyAutoCompactTokensSelect");
    if (tokensEl) tokensEl.disabled = !enabled;
    try {
      await apiPost("api/settings", { agyAutoCompact: enabled });
      showToastBanner(enabled ? "已开启 AGY 发送前自动压缩" : "已关闭 AGY 发送前自动压缩");
    } catch (error) {
      e.target.checked = !enabled;
      if (tokensEl) tokensEl.disabled = enabled;
      updateSettingsTabBadge();
      showToastBanner("保存设置失败", { detail: error?.message || "未知错误", error: true });
    }
  });
  $("agyAutoCompactTokensSelect")?.addEventListener("change", async (e) => {
    const tokens = Number(e.target.value) || 60000;
    try {
      const res = await apiPost("api/settings", { agyAutoCompactTokens: tokens });
      showToastBanner(`AGY 自动压缩阈值已设为 ${Math.round((res?.settings?.agyAutoCompactTokens || tokens) / 1000)}K`);
    } catch (error) {
      showToastBanner("保存设置失败", { detail: error?.message || "未知错误", error: true });
    }
  });
  $("agyAutoRetryAuth401Toggle")?.addEventListener("change", async (e) => {
    const enabled = Boolean(e.target.checked);
    updateSettingsTabBadge();
    try {
      await apiPost("api/settings", { agyAutoRetryAuth401: enabled });
      showToastBanner(enabled ? "已开启 AGY 瞬时 401 自动续发" : "已关闭 AGY 瞬时 401 自动续发");
    } catch (error) {
      e.target.checked = !enabled;
      updateSettingsTabBadge();
      showToastBanner("保存设置失败", { detail: error?.message || "未知错误", error: true });
    }
  });
  $("sharedMemoryToggle")?.addEventListener("change", async (e) => {
    const enabled = Boolean(e.target.checked);
    updateSettingsTabBadge();
    try {
      await apiPost("api/memory/config", { enabled });
      await loadMemoryAndSkillSettings();
      showToastBanner(enabled ? "已启用内置共享记忆与任务投影" : "已关闭内置共享记忆注入");
    } catch (error) {
      e.target.checked = !enabled;
      updateSettingsTabBadge();
      showToastBanner("保存设置失败", { detail: error?.message || "未知错误", error: true });
    }
  });
  $("saveMemoryConfigBtn")?.addEventListener("click", async () => {
    const vaultPath = $("memoryVaultPathInput")?.value?.trim() || "";
    await apiPost("api/memory/config", { vaultPath });
    await loadMemoryAndSkillSettings();
    showToastBanner(vaultPath ? "已更新自定义记忆库路径" : "已切回内置默认记忆库");
  });
  $("resetMemoryVaultBtn")?.addEventListener("click", async () => {
    if ($("memoryVaultPathInput")) $("memoryVaultPathInput").value = "";
    await apiPost("api/memory/config", { vaultPath: "" });
    await loadMemoryAndSkillSettings();
    showToastBanner("已恢复内置默认记忆目录");
  });
  $("installSkillSyncBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (btn) btn.disabled = true;
    try {
      const res = await apiPost("api/skills/sync", { action: "install" });
      renderSkillSyncStatus(res?.status);
      showToastBanner("已同步内置记忆与任务技能到 Claude / Codex / Antigravity");
    } catch (error) {
      showToastBanner("同步技能失败", { detail: formatActionError(error), error: true });
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  $("uninstallSkillSyncBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (btn) btn.disabled = true;
    try {
      const res = await apiPost("api/skills/sync", { action: "uninstall" });
      renderSkillSyncStatus(res?.status);
      showToastBanner("已移除由 RemoDeck 托管的三端技能链接");
    } catch (error) {
      showToastBanner("卸载技能失败", { detail: formatActionError(error), error: true });
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  $("checkCliUpdatesBtn")?.addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (btn) btn.disabled = true;
    try {
      const res = await apiPost("api/cli/check", {});
      await renderCliVersionsInModal(res?.cliStatus);
    } catch (error) {
      showToastBanner("检查 CLI 更新失败", { detail: error?.message || "未知错误", error: true });
    } finally {
      if (btn) btn.disabled = false;
    }
  });
  $("cliVersionsList")?.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.("[data-cli-upgrade]");
    if (!btn) return;
    const provider = btn.getAttribute("data-cli-upgrade");
    if (!provider) return;
    btn.disabled = true;
    btn.textContent = "升级中…";
    try {
      const res = await apiPost("api/cli/upgrade", { provider, force: true });
      const nextCliStatus = res?.cliStatus ? { ...res.cliStatus } : null;
      if (!res?.ok && nextCliStatus?.[provider] && !nextCliStatus[provider].lastError && res?.message) {
        nextCliStatus[provider] = { ...nextCliStatus[provider], lastError: res.message };
      }
      await renderCliVersionsInModal(nextCliStatus);
      showToastBanner(res?.ok ? (res.message || "CLI 升级成功") : (res?.message || "CLI 升级失败"), { error: !res?.ok });
    } catch (error) {
      showToastBanner("CLI 升级失败", { detail: error?.message || "未知错误", error: true });
      await renderCliVersionsInModal().catch(() => {});
    }
  });
  $("updateModal")?.addEventListener("click", (e) => {
    if (e.target === $("updateModal")) {
      $("updateModal").close();
      return;
    }
    const tabBtn = e.target?.closest?.("[data-update-tab]");
    if (tabBtn) {
      const tab = tabBtn.getAttribute("data-update-tab");
      if (tab) {
        state.updateModalTab = tab;
        syncUpdateModalTabs();
      }
      return;
    }
    const verBtn = e.target?.closest?.("[data-notes-version]");
    if (verBtn) {
      state.updateNotesVersionKey = verBtn.getAttribute("data-notes-version") || "";
      state.updateNotesCategory = "all";
      renderUpdateReleaseNotesBody();
      return;
    }
    const catBtn = e.target?.closest?.("[data-notes-category]");
    if (catBtn) {
      state.updateNotesCategory = catBtn.getAttribute("data-notes-category") || "all";
      renderUpdateReleaseNotesBody();
    }
  });

  $("remoteModalBtn").addEventListener("click", () => void openRemoteModal());

  $("startTunnelBtn")?.addEventListener("click", async () => {
    if (state.tunnelBusy) return;
    state.tunnelBusy = true;
    renderTunnelStatus({ ...(state.tunnelStatus || {}), state: "starting", lastError: "" });
    try {
      const status = await apiPost("api/tunnel/start", {});
      state.tunnelBusy = false;
      renderTunnelStatus(status);
      showToastBanner("免费加密隧道已就绪", { detail: "手机扫码即可连接控制台" });
    } catch (error) {
      state.tunnelBusy = false;
      const latest = await apiGet("api/remote").catch(() => null);
      if (latest) {
        renderRemoteStatus(latest);
      } else {
        renderTunnelStatus({
          ...(state.tunnelStatus || {}),
          state: error?.code === "cloudflared_missing" ? "missing_binary" : "error",
          installed: error?.code !== "cloudflared_missing",
          lastError: formatActionError(error, "开启临时隧道失败"),
        });
      }
      const errEl = $("tunnelErrorText");
      if (errEl && error?.code !== "cloudflared_missing") {
        errEl.hidden = false;
        errEl.textContent = formatActionError(error, "开启临时隧道失败");
      }
    }
  });

  $("stopTunnelBtn")?.addEventListener("click", async () => {
    if (state.tunnelBusy) return;
    state.tunnelBusy = true;
    renderTunnelStatus(state.tunnelStatus);
    try {
      const status = await apiPost("api/tunnel/stop", {});
      state.tunnelBusy = false;
      renderTunnelStatus(status);
      showToastBanner("已关闭临时隧道并废止远程会话");
    } catch (error) {
      state.tunnelBusy = false;
      renderTunnelStatus(state.tunnelStatus);
      showToastBanner("关闭隧道失败", { detail: formatActionError(error), error: true });
    }
  });

  $("rotateTunnelBtn")?.addEventListener("click", async () => {
    if (state.tunnelBusy) return;
    state.tunnelBusy = true;
    renderTunnelStatus(state.tunnelStatus);
    try {
      const status = await apiPost("api/tunnel/rotate", {});
      state.tunnelBusy = false;
      renderTunnelStatus(status);
      if (status.fixedTunnel) renderFixedTunnelStatus(status.fixedTunnel);
      showToastBanner("已重置配对二维码", { detail: "旧手机会话已立即失效" });
    } catch (error) {
      state.tunnelBusy = false;
      renderTunnelStatus(state.tunnelStatus);
      showToastBanner("重置二维码失败", { detail: formatActionError(error), error: true });
    }
  });

  $("copyTunnelUrlBtn")?.addEventListener("click", async () => {
    const val = $("tunnelPairUrlInput")?.value;
    if (!val) return;
    await navigator.clipboard?.writeText(val).catch(() => {});
    $("copyTunnelUrlBtn").textContent = "已复制";
    setTimeout(() => { if ($("copyTunnelUrlBtn")) $("copyTunnelUrlBtn").textContent = "复制"; }, 1500);
  });

  $("copyBrewCmdBtn")?.addEventListener("click", async () => {
    const cmd = state.tunnelStatus?.installHint || $("tunnelInstallCmdCode")?.textContent || "brew install cloudflared";
    await navigator.clipboard?.writeText(cmd).catch(() => {});
    $("copyBrewCmdBtn").textContent = "已复制";
    setTimeout(() => { if ($("copyBrewCmdBtn")) $("copyBrewCmdBtn").textContent = "复制命令"; }, 1500);
  });

  $("startTsFunnelBtn")?.addEventListener("click", async () => {
    if (state.fixedTunnelBusy) return;
    state.fixedTunnelBusy = true;
    renderFixedTunnelStatus(state.fixedTunnelStatus || {});
    try {
      const res = await apiPost("api/tunnel/tailscale/start", {});
      state.fixedTunnelBusy = false;
      renderFixedTunnelStatus(res);
      showToastBanner("Tailscale Funnel 固定链接已就绪", { detail: res.fixedPublicUrl || "可扫码连接" });
    } catch (error) {
      state.fixedTunnelBusy = false;
      const latest = await apiGet("api/remote").catch(() => null);
      if (latest) {
        renderRemoteStatus(latest);
      } else {
        renderFixedTunnelStatus({
          ...(state.fixedTunnelStatus || {}),
          lastError: formatActionError(error, "开启 Tailscale Funnel 失败"),
        });
      }
      if ($("tsErrorText")) {
        $("tsErrorText").hidden = false;
        $("tsErrorText").textContent = formatActionError(error, "开启 Tailscale Funnel 失败");
      }
    }
  });

  $("stopTsFunnelBtn")?.addEventListener("click", async () => {
    if (state.fixedTunnelBusy) return;
    state.fixedTunnelBusy = true;
    renderFixedTunnelStatus(state.fixedTunnelStatus || {});
    try {
      const res = await apiPost("api/tunnel/tailscale/stop", {});
      state.fixedTunnelBusy = false;
      renderFixedTunnelStatus(res);
      showToastBanner("已关闭 Tailscale Funnel 并废止旧会话");
    } catch (error) {
      state.fixedTunnelBusy = false;
      renderFixedTunnelStatus(state.fixedTunnelStatus || {});
      showToastBanner("关闭 Funnel 失败", { detail: formatActionError(error), error: true });
    }
  });

  $("copyTsCmdBtn")?.addEventListener("click", async () => {
    const cmd = state.fixedTunnelStatus?.installHint || $("tsInstallCmdCode")?.textContent || "brew install --cask tailscale";
    await navigator.clipboard?.writeText(cmd).catch(() => {});
    $("copyTsCmdBtn").textContent = "已复制";
    setTimeout(() => { if ($("copyTsCmdBtn")) $("copyTsCmdBtn").textContent = "复制命令"; }, 1500);
  });

  $("fixedPairForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (state.fixedTunnelBusy) return;
    const publicUrl = String($("fixedPublicUrlInput")?.value || "").trim();
    if (!publicUrl) {
      showToastBanner("请输入固定公网域名（如 https://agent.example.com）", { error: true });
      return;
    }
    state.fixedTunnelBusy = true;
    renderFixedTunnelStatus(state.fixedTunnelStatus || {});
    try {
      const res = await apiPost("api/tunnel/fixed-pair", { publicUrl });
      state.fixedTunnelBusy = false;
      renderFixedTunnelStatus(res);
      showToastBanner("固定链接配对二维码已生成");
    } catch (error) {
      state.fixedTunnelBusy = false;
      renderFixedTunnelStatus(state.fixedTunnelStatus || {});
      showToastBanner("生成配对二维码失败", { detail: formatActionError(error), error: true });
    }
  });

  $("rotateFixedPairBtn")?.addEventListener("click", async () => {
    if (state.fixedTunnelBusy) return;
    state.fixedTunnelBusy = true;
    renderFixedTunnelStatus(state.fixedTunnelStatus || {});
    try {
      const status = await apiPost("api/tunnel/rotate", {});
      state.fixedTunnelBusy = false;
      renderTunnelStatus(status);
      if (status.fixedTunnel) renderFixedTunnelStatus(status.fixedTunnel);
      showToastBanner("已重置固定链接配对二维码", { detail: "旧手机会话已立即失效" });
    } catch (error) {
      state.fixedTunnelBusy = false;
      renderFixedTunnelStatus(state.fixedTunnelStatus || {});
      showToastBanner("重置二维码失败", { detail: formatActionError(error), error: true });
    }
  });

  $("clearFixedPairBtn")?.addEventListener("click", async () => {
    if (state.fixedTunnelBusy) return;
    state.fixedTunnelBusy = true;
    renderFixedTunnelStatus(state.fixedTunnelStatus || {});
    try {
      const res = await apiPost("api/tunnel/fixed-pair", { publicUrl: "" });
      state.fixedTunnelBusy = false;
      if ($("fixedPublicUrlInput")) $("fixedPublicUrlInput").value = "";
      renderFixedTunnelStatus(res);
      showToastBanner("已清除固定链接记录");
    } catch (error) {
      state.fixedTunnelBusy = false;
      renderFixedTunnelStatus(state.fixedTunnelStatus || {});
      showToastBanner("清除失败", { detail: formatActionError(error), error: true });
    }
  });

  $("copyFixedUrlBtn")?.addEventListener("click", async () => {
    const val = $("fixedPairUrlInput")?.value;
    if (!val) return;
    await navigator.clipboard?.writeText(val).catch(() => {});
    $("copyFixedUrlBtn").textContent = "已复制";
    setTimeout(() => { if ($("copyFixedUrlBtn")) $("copyFixedUrlBtn").textContent = "复制"; }, 1500);
  });

  $("remotePairForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      const status = await apiPost("api/remote/pair", {
        relayUrl: $("relayUrlInput").value.trim(),
        inviteCode: $("inviteCodeInput").value.trim(),
        label: $("hostLabelInput").value.trim(),
      });
      renderRemoteStatus(status);
    } catch (error) {
      showToastBanner("配对失败", { detail: formatActionError(error), error: true });
    }
  });

  $("unpairBtn").addEventListener("click", async () => {
    try {
      const status = await apiPost("api/remote/unpair", {});
      renderRemoteStatus(status);
    } catch (error) {
      showToastBanner("撤销失败", { detail: formatActionError(error), error: true });
    }
  });

  $("copyPairUrlBtn").addEventListener("click", async () => {
    const val = $("remotePairUrlInput").value;
    if (!val) return;
    await navigator.clipboard?.writeText(val).catch(() => {});
    $("copyPairUrlBtn").textContent = "已复制";
    setTimeout(() => { $("copyPairUrlBtn").textContent = "复制"; }, 1500);
  });

  for (const btn of document.querySelectorAll("[data-close-modal]")) {
    btn.addEventListener("click", () => $(btn.dataset.closeModal)?.close());
  }

  const vp = $("messagesViewport");
  bindFollowIntent(vp, {
    pause: () => { state.autoFollow = false; },
    settle: () => {
      const distance = vp.scrollHeight - vp.scrollTop - vp.clientHeight;
      if (distance < 24) state.autoFollow = true;
    },
  });
}

let imageQueueChain = Promise.resolve();

function addComposerImageFile(file) {
  if (!file) return Promise.resolve();
  state.imageProcessingCount += 1;
  setComposerStatus("pending", "正在压缩优化图片…");
  renderComposerControls();

  const task = imageQueueChain.then(async () => {
    const compressedItem = await compressImageFileForUpload(file);
    const budget = validateImageBatchBudget(state.images, compressedItem.byteLength);
    if (!budget.ok) {
      throw new Error(budget.message || "图片数量或总大小超出限制");
    }
    state.images.push(compressedItem);
    const input = $("promptInput");
    const cleanedText = stripAttachedImagePaths(input.value, [file]);
    if (cleanedText !== input.value) {
      const start = stripAttachedImagePaths(input.value.slice(0, input.selectionStart), [file]).length;
      const end = stripAttachedImagePaths(input.value.slice(0, input.selectionEnd), [file]).length;
      input.value = cleanedText;
      input.setSelectionRange(start, end);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      autoResizePromptInput();
    }
    renderComposerImages();
    renderComposerControls();
    const origBytes = Number(file.size) || 0;
    if (compressedItem.compressed && origBytes > compressedItem.byteLength * 1.3) {
      setComposerStatus(
        "success",
        `已添加图片（已优化至 ${formatByteSize(compressedItem.byteLength)}）`,
        { autoClearMs: 2200 },
      );
    } else if ($("composerStatus")?.classList.contains("is-pending")) {
      clearComposerStatus();
    }
  }).catch((error) => {
    const msg = error?.message || "读取或压缩图片失败";
    setComposerStatus("error", msg, { autoClearMs: 4200 });
    showToastBanner("添加图片失败", { detail: msg, error: true });
  }).finally(() => {
    state.imageProcessingCount = Math.max(0, state.imageProcessingCount - 1);
    renderComposerControls();
  });

  imageQueueChain = task.catch(() => {});
  return task;
}

const MAX_UPLOAD_FILE_COUNT = 10;
const MAX_UPLOAD_SINGLE_BYTES = 15 * 1024 * 1024;
const MAX_UPLOAD_TOTAL_BYTES = 20 * 1024 * 1024;

function insertTextIntoPrompt(insertText, { padSpaces = true } = {}) {
  const input = $("promptInput");
  if (!input || !insertText) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? start;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);
  const needsLeadingSpace = padSpaces && Boolean(before && !/[\s(\[{'"`]$/.test(before));
  const needsTrailingSpace = padSpaces && Boolean(after && !/^[\s.,;:!?)\]}'"`]/.test(after));
  const chunk = `${needsLeadingSpace ? " " : ""}${insertText}${needsTrailingSpace ? " " : ""}`;
  input.setRangeText(chunk, start, end, "end");
  input.dispatchEvent(new Event("input", { bubbles: true }));
  autoResizePromptInput();
}

async function uploadAndInsertComposerFiles(files = []) {
  const list = Array.isArray(files) ? files.filter(Boolean) : [];
  if (!list.length) return;

  if (list.length > MAX_UPLOAD_FILE_COUNT) {
    const msg = `单次最多粘贴 ${MAX_UPLOAD_FILE_COUNT} 个文件`;
    setComposerStatus("error", msg, { autoClearMs: 4200 });
    showToastBanner("上传文件失败", { detail: msg, error: true });
    return;
  }

  let totalBytes = 0;
  for (const file of list) {
    const size = Number(file.size) || 0;
    if (size > MAX_UPLOAD_SINGLE_BYTES) {
      const msg = `文件 ${file.name || "未命名"} 超过 ${formatByteSize(MAX_UPLOAD_SINGLE_BYTES)} 上限`;
      setComposerStatus("error", msg, { autoClearMs: 4200 });
      showToastBanner("上传文件失败", { detail: msg, error: true });
      return;
    }
    totalBytes += size;
  }
  if (totalBytes > MAX_UPLOAD_TOTAL_BYTES) {
    const msg = `单次粘贴文件总大小超过 ${formatByteSize(MAX_UPLOAD_TOTAL_BYTES)} 上限`;
    setComposerStatus("error", msg, { autoClearMs: 4200 });
    showToastBanner("上传文件失败", { detail: msg, error: true });
    return;
  }

  const originThreadId = state.activeThreadId || "";
  state.fileUploadingCount += 1;
  renderComposerControls();
  setComposerStatus(
    "pending",
    list.length > 1 ? `正在上传 ${list.length} 个文件…` : `正在上传 ${list[0].name || "文件"}…`,
  );

  try {
    const payloadFiles = [];
    for (const file of list) {
      const buf = new Uint8Array(await file.arrayBuffer());
      payloadFiles.push({
        name: file.name || "pasted-file",
        type: file.type || "application/octet-stream",
        dataBase64: uint8ArrayToBase64(buf),
      });
    }
    const res = await apiPost(
      "api/thread/upload",
      {
        threadId: originThreadId,
        files: payloadFiles,
      },
      { timeoutMs: 60_000 },
    );
    const saved = Array.isArray(res?.files) ? res.files : [];
    const links = saved
      .map((item) => formatPastedFileMarkdownLink(item?.path || "", { trustedLocalPath: true }))
      .filter(Boolean);
    if (originThreadId && state.activeThreadId !== originThreadId) {
      clearComposerStatus();
      showToastBanner("原会话已切换，未向当前输入框插入上传链接", {
        detail: saved.length ? `文件已保存至本机：${saved[0].name}` : "",
      });
      return;
    }
    if (links.length) {
      insertTextIntoPrompt(links.join(" "));
      setComposerStatus(
        "success",
        saved.length > 1 ? `已附加 ${saved.length} 个文件` : `已附加文件 ${saved[0]?.name || ""}`.trim(),
        { autoClearMs: 2200 },
      );
    } else if (saved.length > 0) {
      const msg = "文件已保存但未能生成可预览路径链接";
      setComposerStatus("error", msg, { autoClearMs: 4200 });
      showToastBanner("上传文件失败", { detail: msg, error: true });
    } else {
      clearComposerStatus();
    }
  } catch (error) {
    const msg = error?.message || "上传文件失败";
    setComposerStatus("error", msg, { autoClearMs: 4200 });
    showToastBanner("上传文件失败", { detail: msg, error: true });
  } finally {
    state.fileUploadingCount = Math.max(0, state.fileUploadingCount - 1);
    renderComposerControls();
  }
}

let lastVisualViewportHeight = 0;
let minVisualViewportHeightWhileFocused = 0;
let lastKeyboardCollapseAt = 0;
let lastPromptBlurAt = 0;
let sendBtnPointerDown = null;

function syncVisualViewportLayout() {
  const vv = window.visualViewport;
  if (!vv) {
    document.documentElement.style.removeProperty("--app-height");
    document.documentElement.style.removeProperty("--app-offset-top");
    return;
  }
  if (vv.scale > 1.05) return;
  const nextHeight = Math.round(vv.height);
  const promptFocused = document.activeElement === $("promptInput");
  if (promptFocused) {
    if (minVisualViewportHeightWhileFocused === 0 || nextHeight < minVisualViewportHeightWhileFocused) {
      minVisualViewportHeightWhileFocused = nextHeight;
    }
  }
  const steppedUp = lastVisualViewportHeight > 0 && (nextHeight - lastVisualViewportHeight) >= 60;
  const animatedCollapse = minVisualViewportHeightWhileFocused > 0
    && nextHeight > lastVisualViewportHeight
    && (nextHeight - minVisualViewportHeightWhileFocused) >= 80;
  if (steppedUp || animatedCollapse) {
    lastKeyboardCollapseAt = Date.now();
  }
  lastVisualViewportHeight = nextHeight;
  document.documentElement.style.setProperty("--app-height", `${nextHeight}px`);
  document.documentElement.style.setProperty("--app-offset-top", `${Math.max(0, Math.round(vv.offsetTop))}px`);
  if (promptFocused) {
    scrollViewportIfFollowing();
  }
}

function resetMobileViewportAfterModal() {
  if (typeof window === "undefined") return;
  try {
    if (window.scrollX !== 0 || window.scrollY !== 0) {
      window.scrollTo(0, 0);
    }
  } catch {}
  syncVisualViewportLayout();
  requestAnimationFrame(() => {
    try {
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    } catch {}
    syncVisualViewportLayout();
  });
}

function bindVisualViewport() {
  const vv = window.visualViewport;
  if (!vv) return;
  syncVisualViewportLayout();
  vv.addEventListener("resize", syncVisualViewportLayout);
  vv.addEventListener("scroll", syncVisualViewportLayout);
}

let uiVersionCheckInFlight = false;
let lastUiHtmlEtag = "";
let activityPollTimer = null;
let activityPollInFlight = false;
let activityPollTick = 0;

function startLiveActivityPolling() {
  if (activityPollTimer) return;
  activityPollTimer = setInterval(async () => {
    if (document.visibilityState === "hidden" || activityPollInFlight) return;
    activityPollInFlight = true;
    activityPollTick += 1;
    try {
      const targetId = state.activeThreadId;
      if (!isBoardViewActive() && targetId && !state.initialThreadLoading) {
        const wasRunning = isActiveThreadRunning();
        if (wasRunning || (state.queuedTurns || []).length > 0 || activityPollTick % 4 === 0) {
          const cursorQs = state.activityCursor ? `&cursor=${encodeURIComponent(state.activityCursor)}` : "";
          const act = await apiGetWithHotFallback(`api/thread/activity?id=${encodeURIComponent(targetId)}${cursorQs}`).catch(() => null);
          if (state.activeThreadId === targetId && act) {
            const prevLive = Boolean(state.activeThread?.live);
            if (act.cursor) state.activityCursor = act.cursor;
            if (Array.isArray(act.queuedTurns)) {
              applyActiveQueuedTurns(targetId, act.queuedTurns);
            }
            const streamingTurnChanged = Boolean(
              act.streaming?.turnId
              && state.streamingTurnId
              && act.streaming.turnId !== state.streamingTurnId,
            );
            const serverClearedStreamText = Boolean(
              act.live
              && act.streaming
              && !act.streaming.text
              && state.streamingText,
            );
            const duplicatePersistedStream = Boolean(
              act.live
              && state.streamingText
              && isStreamingTextAlreadyPersisted(state.activeThread?.turns, state.streamingText),
            );
            let clearedStaleStream = false;
            if (!act.live && (prevLive || wasRunning)) {
              if (state.activeThread) state.activeThread.live = false;
              syncThreadSummaryIntoList({ id: targetId, live: false });
              state.liveActivity = { status: "completed" };
              state.streamingText = "";
              state.streamingThought = "";
              state.streamingTurnId = "";
            } else if (act.live && (streamingTurnChanged || serverClearedStreamText || duplicatePersistedStream)) {
              state.streamingText = "";
              if (!act.streaming?.thought) state.streamingThought = "";
              if (act.streaming?.turnId) state.streamingTurnId = act.streaming.turnId;
              clearedStaleStream = true;
            }
            const isImmediateTransition = clearedStaleStream || Boolean(act.live) !== prevLive || (!act.live && wasRunning);
            if (act.changed || isImmediateTransition) {
              const sinceLastReload = Date.now() - lastActiveThreadReloadDoneAt;
              if (!isImmediateTransition && act.live && lastActiveThreadReloadDoneAt > 0 && sinceLastReload < 4000) {
                if (act.activity) {
                  const prevPhase = state.liveActivity?.phase || "";
                  const prevText = state.liveActivity?.text || "";
                  const nextPhase = act.activity.phase || "";
                  const nextText = act.activity.text ?? act.activity.detail ?? "";
                  state.liveActivity = mergeLiveActivity(state.liveActivity, {
                    status: "running",
                    phase: nextPhase,
                    text: nextText,
                  });
                  renderTopbarAndControls();
                  if (prevPhase !== nextPhase || prevText !== nextText) {
                    syncLiveTurnFrontier();
                  }
                }
                if (!activeThreadReloadInFlight) {
                  scheduleActiveThreadReload(targetId, Math.max(250, 4000 - sinceLastReload));
                }
              } else {
                await reloadActiveThreadProgress(targetId);
              }
            } else if (act.live && act.activity) {
              const prevPhase = state.liveActivity?.phase || "";
              const prevText = state.liveActivity?.text || "";
              const nextPhase = act.activity.phase || "";
              const nextText = act.activity.text ?? act.activity.detail ?? "";
              state.liveActivity = mergeLiveActivity(state.liveActivity, {
                status: "running",
                phase: nextPhase,
                text: nextText,
              });
              renderTopbarAndControls();
              if (prevPhase !== nextPhase || prevText !== nextText) {
                syncLiveTurnFrontier();
              }
            }
          }
        }
      }
      const sidebarVisible = Boolean($("sidebar")?.classList.contains("is-open")) || window.innerWidth > 900;
      const listPollTicks = (isBoardViewActive() || sidebarVisible) ? 6 : 12;
      if (activityPollTick % listPollTicks === 0 && !state.isSubmitting && (isBoardViewActive() || sidebarVisible || state.threads.some((t) => t.live || (t.queuedCount || 0) > 0))) {
        await refreshThreads().catch(() => {});
      }
    } finally {
      activityPollInFlight = false;
    }
  }, 2500);
}

async function checkUiVersionAndReloadIfStale() {
  if (uiVersionCheckInFlight || state.isSubmitting || state.dictation?.active || state.dictation?.transcribing || state.sprite?.phoneCallActive || state.sprite?.recording) return;
  const currentMeta = document.querySelector('meta[name="ac-ui-version"]')?.getAttribute("content") || "";
  if (!currentMeta) return;
  const draft = $("promptInput")?.value || "";
  if (draft.trim() || state.editingQueueItem || state.images.length) return;

  uiVersionCheckInFlight = true;
  try {
    const headers = {};
    if (lastUiHtmlEtag) headers["If-None-Match"] = lastUiHtmlEtag;
    const res = await fetch("./", { cache: "no-store", credentials: "same-origin", headers });
    const etag = String(res.headers?.get("etag") || "").trim();
    if (etag) lastUiHtmlEtag = etag;
    if (res.status === 304) return;
    if (!res.ok) return;
    const html = await res.text();
    const matched = html.match(/<meta\s+name="ac-ui-version"\s+content="([^"]+)"/i);
    if (matched?.[1] && matched[1] !== currentMeta) {
      location.reload();
    }
  } catch {
    // Ignore transient network errors when returning from background.
  } finally {
    uiVersionCheckInFlight = false;
  }
}

async function init() {
  renderProviderTabs();
  window.addEventListener("online", () => {
    if (!state.sseConnected || !state.eventSource || state.eventSource.readyState === EventSource.CLOSED) {
      connectEvents();
      scheduleLanFallbackCheck(2500);
    }
    if (state.activeThreadId && !isBoardViewActive() && !state.initialThreadLoading) {
      void reloadActiveThreadProgress(state.activeThreadId);
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void checkUiVersionAndReloadIfStale();
      const nowSec = Math.floor(Date.now() / 1000);
      if (hasElapsedQuotaReset(state.profiles, nowSec) || (Date.now() - lastAutoQuotaRefreshAt) > 120_000) {
        void refreshQuotasSilent({ refresh: true });
      }
      if (!state.sseConnected || !state.eventSource || state.eventSource.readyState === EventSource.CLOSED) {
        connectEvents();
      }
      if (state.activeThreadId && !isBoardViewActive() && !state.initialThreadLoading) {
        void reloadActiveThreadProgress(state.activeThreadId);
      }
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (state.tycoonInspectorMode || state.tycoonSelectedTopicId) {
        state.tycoonInspectorMode = "";
        state.tycoonInspectorRoomId = "";
        state.tycoonInspectorClusterOnly = false;
        state.tycoonInspectorBack = null;
        state.tycoonSelectedTopicId = "";
        renderProjectBoard();
        return;
      }
      if (state.immersiveOverview) {
        state.immersiveOverview = false;
        renderProjectBoard();
        return;
      }
    }
    const tag = String(e.target?.tagName || "").toUpperCase();
    const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable;
    if (!isTyping && !e.metaKey && !e.ctrlKey && !e.altKey && isBoardViewActive() && state.boardViewMode === "tycoon3d") {
      const roomByKey = {
        "1": "all",
        "2": "indie-lab",
        "3": "drama-studio",
        "4": "global-pub",
        "5": "bounty-guild",
        "6": "incubator",
      };
      const rm = roomByKey[e.key];
      if (rm) {
        state.tycoonSelectedTopicId = "";
        state.tycoonInspectorBack = null;
        state.tycoonInspectorClusterOnly = false;
        if (rm === "incubator") {
          state.tycoonInspectorMode = "incubator";
          state.tycoonInspectorRoomId = "";
          tycoon3dInstance?.flyToRoom?.("incubator");
        } else if (rm === "all") {
          state.overviewDomainFilter = "all";
          state.tycoonInspectorMode = "";
          state.tycoonInspectorRoomId = "";
          tycoon3dInstance?.flyToRoom?.("all");
        } else {
          state.overviewDomainFilter = rm;
          state.tycoonInspectorMode = "room";
          state.tycoonInspectorRoomId = rm;
          tycoon3dInstance?.flyToRoom?.(rm);
        }
        renderProjectBoard();
      }
    }
  });
  hydrateDeclarativeIcons(document);
  applyThemeMode(loadThemeMode());
  bindVisualViewport();
  syncProfileSelectors();
  syncModelAndEffortSelectors();
  syncPermissionSelectors();
  syncNetworkSwitchMenuButton();
  bindEvents();
  connectEvents();
  startLiveActivityPolling();

  const initialThread = new URL(location.href).searchParams.get("thread") || "";
  const cachedThreadsPayload = loadCachedThreads();
  if (cachedThreadsPayload?.threads?.length) {
    state.threads = cachedThreadsPayload.threads.filter((t) => !isInternalVoiceThreadClient(t));
    state.projectsMeta = cachedThreadsPayload.projectsMeta || {};
    renderThreadList();
  }

  const modelsPromise = refreshModels().catch(() => {});
  const telemetryPromise = refreshTelemetry().catch(() => {});
  void refreshTasks().catch(() => {});
  void refreshLocalApps().catch(() => {});
  void refreshUpdateStatus().catch(() => {});

  try {
    if (initialThread) {
      state.activeThreadId = initialThread;
      state.boardOpen = false;
      state.initialThreadLoading = true;
      syncWorkspaceVisibility();
      const turnListEl = $("turnList");
      if (turnListEl) {
        turnListEl.hidden = false;
        turnListEl.innerHTML = `<div class="empty-state" style="text-align:center;color:var(--text-muted);">正在加载会话…</div>`;
      }

      const provPromise = refreshProviders().then(() => {
        if (state.activeThread) {
          renderTopbarAndControls();
          syncProfileSelectors();
          syncModelAndEffortSelectors();
        }
      });
      const threadsPromise = refreshThreads();
      const threadPromise = selectThread(initialThread).then(() => true).catch((err) => {
        if (Number(err?.status) === 404) return false;
        throw err;
      });

      const threadLoaded = await threadPromise;
      state.initialThreadLoading = false;
      if (!threadLoaded) {
        await selectThread("");
      }
      const settled = await Promise.allSettled([provPromise, threadsPromise, modelsPromise, telemetryPromise]);
      const fatalErr = settled.find((r) => r.status === "rejected")?.reason;
      if (fatalErr) throw fatalErr;
      if (threadLoaded && state.activeThread) {
        renderTopbarAndControls();
        renderProjectTaskStrip();
        const hasTurns = Array.isArray(state.activeThread.turns) && state.activeThread.turns.length > 0;
        if (!hasTurns && state.threads.length && !state.threads.some((t) => t.id === initialThread)) {
          await selectThread("");
        }
      }
    } else {
      await Promise.all([
        refreshProviders(),
        refreshThreads(),
      ]);
      void modelsPromise;
      void telemetryPromise;
      if (state.scopedProjectCwd) {
        const scopedGroup = getProjectGroups({ ignoreFilters: true })[0];
        if (scopedGroup?.threads?.length) {
          await selectThread(scopedGroup.threads[0].id);
        } else {
          await selectThread("", { newThreadCwd: state.scopedProjectCwd });
        }
      } else {
        renderTopbarAndControls();
        renderActiveMessages();
      }
    }
  } catch (error) {
    state.initialThreadLoading = false;
    const errMsg = formatActionError(error, "初始化控制台失败");
    setComposerStatus("error", errMsg);
    showToastBanner("初始化失败", { detail: errMsg, sticky: true, error: true });
  }
  renderComposerControls();
  setInterval(() => {
    if (pruneExpiredSidebarPrefs(Date.now())) {
      renderThreadList();
    }
    renderAgentTelemetryBar();
    if (state.telemetryExpanded) void refreshExecutionStats();
    quotaAutoRefreshTick += 1;
    const elapsed = hasElapsedQuotaReset(state.profiles, Math.floor(Date.now() / 1000));
    if ((elapsed && (Date.now() - lastAutoQuotaRefreshAt) >= 60_000) || quotaAutoRefreshTick % 5 === 0) {
      void refreshQuotasSilent({ refresh: elapsed });
    }
  }, 60_000);
}

void init();

// Delegation survives SSE updates that replace the assistant markup.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) noteSpriteParkLeave();
  else if (isBoardViewActive() && state.boardViewMode === "tycoon3d") void maybeStartSpriteTour();
});
window.addEventListener("pagehide", noteSpriteParkLeave);
document.addEventListener("focusin", (event) => {
  if (event.target.id === "spriteCommandInput") tycoon3dInstance?.setUserBusy?.(true);
});
document.addEventListener("focusout", (event) => {
  if (event.target.id === "spriteCommandInput") tycoon3dInstance?.setUserBusy?.(Boolean(state.sprite.open));
});
let spriteDrawerTouchY = null;
document.addEventListener("touchstart", (event) => {
  if (event.target.closest("[data-sprite-drawer-handle], .sprite-pop-head")) spriteDrawerTouchY = event.touches[0].clientY;
}, { passive: true });
document.addEventListener("touchend", (event) => {
  if (spriteDrawerTouchY !== null && event.changedTouches[0].clientY - spriteDrawerTouchY > 60) toggleSpriteAssistant({ open: false });
  spriteDrawerTouchY = null;
}, { passive: true });
