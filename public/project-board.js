import { iconSvg, providerIconSvg } from "./icons.js";
import { compactThreadSourceChip, providerVisualMeta } from "./instance-switcher.js";
import { escapeHtml } from "./markdown.js";

export const SIDEBAR_STALE_PROJECT_AGE_SEC = 18 * 3600;
export const SIDEBAR_STALE_THREAD_AGE_SEC = 12 * 3600;
export const SIDEBAR_MANUAL_HOLD_MS = 30 * 60 * 1000;
export const SIDEBAR_ACTIVE_LIVE_WINDOW_SEC = 20 * 60;
export const SIDEBAR_AUTO_EXPAND_LIVE_COUNT = 2;
export const THREAD_EXPAND_STEP = 10;

const MAX_UI_SEARCH_TERMS = 6;

export function splitSearchTerms(searchText = "") {
  const seen = new Set();
  const terms = [];
  for (const part of String(searchText || "").trim().split(/\s+/)) {
    const clean = part.trim();
    if (!clean) continue;
    const lower = clean.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    terms.push(clean);
    if (terms.length >= MAX_UI_SEARCH_TERMS) break;
  }
  return terms;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function renderHighlightedTextHtml(text, searchText = "") {
  const raw = String(text ?? "");
  const terms = splitSearchTerms(searchText);
  if (!raw || !terms.length) return escapeHtml(raw);
  const sorted = [...terms].sort((a, b) => b.length - a.length);
  const re = new RegExp(`(${sorted.map(escapeRegExp).join("|")})`, "gi");
  let out = "";
  let lastIdx = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > lastIdx) {
      out += escapeHtml(raw.slice(lastIdx, m.index));
    }
    out += `<mark class="search-hit-mark">${escapeHtml(m[0])}</mark>`;
    lastIdx = m.index + m[0].length;
  }
  if (lastIdx < raw.length) {
    out += escapeHtml(raw.slice(lastIdx));
  }
  return out;
}

function formatSearchMatchSnippet(searchMatch) {
  const snippet = String(searchMatch?.matchSnippet || "").trim();
  if (!snippet) return "";
  if (searchMatch?.matchRole === "user") return `你: ${snippet}`;
  if (searchMatch?.matchRole === "assistant") return `AI: ${snippet}`;
  return snippet;
}

function formatSearchStatusMessage(searchLoading = false, searchIndexStatus = null) {
  if (searchIndexStatus?.indexing) {
    const total = Number(searchIndexStatus.totalThreads) || 0;
    const done = Number(searchIndexStatus.indexedThreads) || 0;
    return total > 0 ? `后台建立历史正文索引中（${done}/${total}）…` : "后台建立历史正文索引中…";
  }
  if (searchLoading) {
    return "正在检索历史对话内容…";
  }
  return "";
}

function resolveExtraExpandedCount(expandedStore, cwd, step = THREAD_EXPAND_STEP) {
  if (!expandedStore || !cwd) return 0;
  if (expandedStore instanceof Map) {
    const val = expandedStore.get(cwd);
    if (val === true || val === Infinity) return Infinity;
    const num = Math.floor(Number(val) || 0);
    return num > 0 ? num : 0;
  }
  if (expandedStore instanceof Set) {
    return expandedStore.has(cwd) ? step : 0;
  }
  if (typeof expandedStore === "object") {
    const val = expandedStore[cwd];
    if (val === true || val === Infinity) return Infinity;
    const num = Math.floor(Number(val) || 0);
    return num > 0 ? num : 0;
  }
  return 0;
}

export function toEpochSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function readSidebarFoldPref(sidebarFoldPrefs, cwd) {
  if (!sidebarFoldPrefs || !cwd) return null;
  return sidebarFoldPrefs instanceof Map ? sidebarFoldPrefs.get(cwd) : sidebarFoldPrefs[cwd];
}

export function isSidebarManualPrefActive(pref, nowMs = Date.now(), manualHoldMs = SIDEBAR_MANUAL_HOLD_MS) {
  if (!pref || typeof pref !== "object") return false;
  if (pref.action !== "expand" && pref.action !== "collapse") return false;
  const ts = Number(pref.updatedAt);
  if (!Number.isFinite(ts) || ts <= 0) return false;
  if (nowMs < ts) return true;
  return (nowMs - ts) < manualHoldMs;
}

export function countGroupActiveRunning(group, {
  nowMs = Date.now(),
  liveActivityByThread = null,
  activeLiveWindowSec = SIDEBAR_ACTIVE_LIVE_WINDOW_SEC,
} = {}) {
  const nowSec = toEpochSeconds(nowMs);
  let count = 0;
  for (const t of group?.threads || []) {
    if (!t) continue;
    const hasPending = (t.pendingCount || 0) > 0;
    const hasGoal = Boolean(t.goalState?.active);
    const hasActivity = Boolean(liveActivityByThread?.has?.(t.id));
    const tSec = toEpochSeconds(t.updatedAt);
    const isRecentLive = Boolean(t.live) && (!tSec || !nowSec || nowSec <= tSec || (nowSec - tSec) <= activeLiveWindowSec);
    if (hasPending || hasGoal || hasActivity || isRecentLive) {
      count += 1;
    }
  }
  return count;
}

export function resolveProjectGroupCollapsed(group, {
  activeThreadId = "",
  hasQuery = false,
  collapsedGroups = null,
  sidebarFoldPrefs = null,
  autoFoldProjects = true,
  nowMs = Date.now(),
  manualHoldMs = SIDEBAR_MANUAL_HOLD_MS,
  liveActivityByThread = null,
  activeLiveWindowSec = SIDEBAR_ACTIVE_LIVE_WINDOW_SEC,
  autoExpandLiveCount = SIDEBAR_AUTO_EXPAND_LIVE_COUNT,
} = {}) {
  if (!group) return false;
  if (hasQuery) return false;
  if (collapsedGroups?.has?.(group.cwd)) return true;
  const pref = readSidebarFoldPref(sidebarFoldPrefs, group.cwd);
  if (isSidebarManualPrefActive(pref, nowMs, manualHoldMs)) {
    return pref.action === "collapse";
  }
  if (activeThreadId && group.threads?.some((t) => t.id === activeThreadId)) return false;
  if (!autoFoldProjects) return false;
  if ((group.pendingCount || 0) > 0) return false;
  if ((group.errorCount || 0) > 0) return false;
  if (countGroupActiveRunning(group, { nowMs, liveActivityByThread, activeLiveWindowSec }) >= autoExpandLiveCount) {
    return false;
  }
  return true;
}

export function partitionSidebarProjectGroups(groups = [], {
  activeThreadId = "",
  hasQuery = false,
  sidebarFoldPrefs = null,
  nowMs = Date.now(),
  manualHoldMs = SIDEBAR_MANUAL_HOLD_MS,
  staleProjectAgeSec = SIDEBAR_STALE_PROJECT_AGE_SEC,
  minVisibleProjects = 3,
} = {}) {
  if (hasQuery || !Array.isArray(groups) || !groups.length) {
    return { primaryGroups: groups || [], staleGroups: [] };
  }
  const nowSec = toEpochSeconds(nowMs);
  const keepSet = new Set();
  for (const group of groups) {
    if (!group) continue;
    const pref = readSidebarFoldPref(sidebarFoldPrefs, group.cwd);
    const manualExpand = isSidebarManualPrefActive(pref, nowMs, manualHoldMs) && pref.action === "expand";
    const hasActiveThread = Boolean(activeThreadId && group.threads?.some((t) => t.id === activeThreadId));
    const latestSec = toEpochSeconds(group.latestUpdatedAt);
    const isRecentProject = !latestSec || !nowSec || nowSec <= latestSec || (nowSec - latestSec) <= staleProjectAgeSec;
    if (
      group.pinned
      || (group.liveCount || 0) > 0
      || (group.pendingCount || 0) > 0
      || (group.errorCount || 0) > 0
      || (group.goalCount || 0) > 0
      || hasActiveThread
      || manualExpand
      || isRecentProject
    ) {
      keepSet.add(group.cwd);
    }
  }
  const targetMin = Math.min(groups.length, Math.max(0, Number(minVisibleProjects) || 0));
  if (keepSet.size < targetMin) {
    for (const group of groups) {
      if (!group) continue;
      keepSet.add(group.cwd);
      if (keepSet.size >= targetMin) break;
    }
  }
  return {
    primaryGroups: groups.filter((g) => keepSet.has(g.cwd)),
    staleGroups: groups.filter((g) => !keepSet.has(g.cwd)),
  };
}

export function normalizeProjectCwd(cwd) {
  const raw = String(cwd || "").trim();
  if (!raw) return "";
  if (raw === "/") return "/";
  const driveRootMatch = raw.match(/^([A-Za-z]:)[\\/]*$/);
  if (driveRootMatch) return `${driveRootMatch[1]}\\`;
  if (/^[A-Za-z]:(?:[\\/]|$)/.test(raw) || /^\\\\/.test(raw)) {
    const winSlashed = raw.replace(/\//g, "\\");
    const uncRootMatch = winSlashed.match(/^(\\\\[^\\]+\\[^\\]+)\\*$/);
    if (uncRootMatch) return uncRootMatch[1];
    return winSlashed.replace(/\\+$/, "");
  }
  return raw.replace(/\/+$/, "") || "/";
}

export function isSameProjectCwd(a, b) {
  const normA = normalizeProjectCwd(a);
  const normB = normalizeProjectCwd(b);
  if (!normA || !normB) return normA === normB;
  if (/^[A-Za-z]:\\/.test(normA) || /^[A-Za-z]:\\/.test(normB)) {
    return normA.toLowerCase() === normB.toLowerCase();
  }
  return normA === normB;
}

export function isUserHomeCwd(cwd) {
  const clean = normalizeProjectCwd(cwd).replace(/\\/g, "/");
  return /^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root|[A-Za-z]:\/Users\/[^/]+)$/i.test(clean);
}

export function projectBaseName(cwd) {
  const clean = normalizeProjectCwd(cwd);
  if (!clean) return "默认工作区";
  if (isUserHomeCwd(clean)) return "个人主目录 (~)";
  if (clean === "/" || /^[A-Za-z]:\\$/.test(clean)) return clean;
  const parts = clean.split(/[\\/]+/).filter(Boolean);
  return parts[parts.length - 1] || clean;
}

export function formatRelativeTimeShort(epochSeconds) {
  const ts = Number(epochSeconds || 0);
  if (!ts) return "";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
  return `${Math.floor(diff / 86400)}天前`;
}

export function formatCompactRelativeTime(epochSeconds) {
  const ts = Number(epochSeconds || 0);
  if (!ts) return "";
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)}m`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h`;
  return `${Math.floor(diff / 86400)}d`;
}

function normalizeTextForDedupe(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/^(?:任务|task)\s*[:：]\s*/i, "")
    .replace(/(?:\.{2,}|…)+$/g, "")
    .replace(/[\s"'“”‘’「」『』【】()（）[\]<>·•:：,，.。!！?？;；\-_/\\#*>`~]+/g, "");
}

export function isStructuredBracketTitle(title = "") {
  const s = String(title || "");
  return /^\s*【[^】｜|]{1,16}[｜|][^】]{1,28}】\S/.test(s)
    || /^\s*[^\s·]{1,14}·\S/.test(s);
}

export function dedupeThreadPreview(title = "", preview = "") {
  const rawTitle = String(title || "").replace(/\s+/g, " ").trim();
  const rawPreview = String(preview || "").replace(/\s+/g, " ").trim();
  if (!rawPreview) return "";

  if (/^(?:好了吗|改好了吗|弄好了吗|继续(?:吧|执行|检查)?|好的|行|收到|ok|okay|yes|跑一下测试|谢谢|嗯|要)[？?!！。.\s]*$/i.test(rawPreview)) {
    return "";
  }
  if (/^(?:bug report and screenshot|file does not exist error)$/i.test(rawPreview)) {
    return "";
  }

  if (isStructuredBracketTitle(rawTitle)) {
    const core = rawTitle
      .replace(/^\s*【[^】]+】/, "")
      .replace(/^\s*[^\s·]{1,14}·/, "")
      .trim();
    const normCore = normalizeTextForDedupe(core);
    const normPreviewCur = normalizeTextForDedupe(rawPreview);
    if (normCore.length >= 4 && (normPreviewCur.includes(normCore) || normCore.includes(normPreviewCur))) {
      return "";
    }
  }

  const normTitle = normalizeTextForDedupe(rawTitle);
  const normPreview = normalizeTextForDedupe(rawPreview);
  if (!normPreview) return "";
  if (normTitle && (normPreview === normTitle || normTitle.startsWith(normPreview))) {
    return "";
  }

  const titleStem = rawTitle.replace(/\s*(?:\.{2,}|…)+\s*$/, "").trim();
  if (titleStem.length >= 4 && rawPreview.toLowerCase().startsWith(titleStem.toLowerCase())) {
    const rest = rawPreview
      .slice(titleStem.length)
      .replace(/^[\s,，.。:：;；、\-—·]+/, "")
      .trim();
    if (!rest || /^(?:\.{2,}|…)+$/.test(rest) || normalizeTextForDedupe(rest).length < 3) {
      return "";
    }
    return rest;
  }

  if (normTitle.length >= 6 && normPreview.startsWith(normTitle) && (normPreview.length - normTitle.length) < 3) {
    return "";
  }

  return rawPreview;
}

export function isThreadFailed(thread, recentCompletedByThread = null) {
  if (!thread || thread.live || (thread.pendingCount || 0) > 0) return false;
  if (thread.lastTurnStatus === "failed" || Boolean(String(thread.lastError || "").trim())) return true;
  return recentCompletedByThread?.get?.(thread.id)?.status === "failed";
}

export function compactThreadErrorSummary(thread, recentCompletedByThread = null) {
  const raw = String(
    thread?.lastError
      || recentCompletedByThread?.get?.(thread?.id)?.summary
      || "",
  ).trim();
  if (!raw) return "执行报错中断";
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line && !/^Agent execution terminated due to error\.?$/i.test(line));
  const picked = lines[0] || raw.replace(/\s+/g, " ").trim();
  return picked.length > 88 ? `${picked.slice(0, 88).trim()}…` : picked;
}

export function buildProjectGroups(threads = [], {
  pendingRequests = [],
  pendingRequestsSynced = false,
  projectsMeta = {},
  searchText = "",
  searchMatchesByThread = null,
  providerFilter = "all",
  profileFilter = "all",
  recentCompletedByThread = null,
} = {}) {
  const pendingCountByThread = new Map();
  for (const req of pendingRequests || []) {
    if (!req?.threadId) continue;
    pendingCountByThread.set(req.threadId, (pendingCountByThread.get(req.threadId) || 0) + 1);
  }

  const lowerTerms = splitSearchTerms(searchText).map((t) => t.toLowerCase());
  const grouped = new Map();

  for (const rawThread of threads || []) {
    const cwd = normalizeProjectCwd(rawThread.cwd) || "默认工作区";
    const meta = projectsMeta[cwd] || {};
    const rawName = projectBaseName(cwd);
    const alias = String(meta.alias || "").trim();
    const remoteMatch = searchMatchesByThread?.get?.(rawThread.id) || rawThread.searchMatch || null;

    if (providerFilter !== "all" && rawThread.provider !== providerFilter) continue;
    if (profileFilter !== "all" && `${rawThread.provider}:${rawThread.profileId}` !== profileFilter) continue;
    if (lowerTerms.length > 0) {
      const hay = [
        rawThread.title,
        rawThread.preview,
        rawThread.lastError,
        cwd,
        rawName,
        alias,
        rawThread.provider,
        rawThread.profileLabel,
      ].join(" ").toLowerCase();
      const localMatched = lowerTerms.every((term) => hay.includes(term));
      if (!localMatched && !remoteMatch) continue;
    }

    const livePending = pendingCountByThread.get(rawThread.id) || 0;
    const pendingCount = (pendingRequestsSynced || rawThread.pendingCountSynced)
      ? livePending
      : (livePending || rawThread.pendingCount || 0);
    const thread = {
      ...rawThread,
      cwd,
      pendingCount,
      ...(remoteMatch ? { searchMatch: remoteMatch } : {}),
    };
    if (!grouped.has(cwd)) {
      grouped.set(cwd, {
        cwd,
        rawName,
        alias,
        name: alias || rawName,
        pinned: Boolean(meta.pinned),
        pinnedAt: Number(meta.pinnedAt) || 0,
        isHomeDir: isUserHomeCwd(cwd),
        threads: [],
        liveCount: 0,
        pendingCount: 0,
        errorCount: 0,
        goalCount: 0,
        latestUpdatedAt: 0,
      });
    }
    const group = grouped.get(cwd);
    group.threads.push(thread);
    if (thread.live) group.liveCount += 1;
    if (pendingCount > 0) group.pendingCount += pendingCount;
    if (isThreadFailed(thread, recentCompletedByThread)) group.errorCount += 1;
    if (thread.goalState?.active) group.goalCount += 1;
    if ((thread.updatedAt || 0) > group.latestUpdatedAt) {
      group.latestUpdatedAt = Number(thread.updatedAt) || 0;
    }
  }

  const result = [...grouped.values()];
  for (const group of result) {
    group.threads.sort((a, b) => {
      if (Boolean(a.pinned) !== Boolean(b.pinned)) return a.pinned ? -1 : 1;
      const timeDiff = (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
      if (timeDiff !== 0) return timeDiff;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }

  result.sort((a, b) => {
    if (Boolean(a.pinned) !== Boolean(b.pinned)) {
      return a.pinned ? -1 : 1;
    }
    const timeDiff = (Number(b.latestUpdatedAt) || 0) - (Number(a.latestUpdatedAt) || 0);
    if (timeDiff !== 0) return timeDiff;
    return String(a.cwd || "").localeCompare(String(b.cwd || ""));
  });

  return result;
}

export function suggestFocusProjects(projectGroups = [], maxCount = 5) {
  return (projectGroups || [])
    .filter((g) => !g.pinned && !g.isHomeDir)
    .slice(0, maxCount);
}

function toSelectedIdSet(selectedThreadIds) {
  if (selectedThreadIds instanceof Set) return selectedThreadIds;
  if (Array.isArray(selectedThreadIds)) return new Set(selectedThreadIds);
  return null;
}

export function computeProjectGroupSelectionState(group, selectedThreadIds) {
  const threads = Array.isArray(group?.threads) ? group.threads : [];
  const selectedSet = toSelectedIdSet(selectedThreadIds);
  let selectedCount = 0;
  if (selectedSet) {
    for (const t of threads) {
      if (t?.id && selectedSet.has(t.id)) selectedCount += 1;
    }
  }
  const total = threads.length;
  return {
    total,
    selectedCount,
    checked: total > 0 && selectedCount === total,
    partial: selectedCount > 0 && selectedCount < total,
  };
}

function renderBatchCheckHtml({ checked = false, partial = false } = {}) {
  const cls = checked ? "batch-check is-checked" : (partial ? "batch-check is-partial" : "batch-check");
  const glyph = checked ? iconSvg("check", { size: 11 }) : (partial ? iconSvg("minus", { size: 11 }) : "");
  return `<span class="${cls}" aria-hidden="true">${glyph}</span>`;
}

export function renderBatchActionBarHtml({
  selectedCount = 0,
  totalVisibleCount = 0,
  idleVisibleCount = 0,
  archivedView = false,
  submitting = false,
} = {}) {
  const count = Math.max(0, Number(selectedCount) || 0);
  const total = Math.max(0, Number(totalVisibleCount) || 0);
  const idle = Math.max(0, Number(idleVisibleCount) || 0);
  const allSelected = total > 0 && count >= total;
  const primaryLabel = submitting
    ? "处理中…"
    : (archivedView ? `恢复 (${count})` : `归档 (${count})`);
  return `
    <div class="batch-bar-meta">
      <span class="batch-bar-count">已选 <strong>${count}</strong> 项</span>
    </div>
    <div class="batch-bar-actions">
      ${!archivedView && idle > 0 ? `<button type="button" class="btn-secondary btn-xs" data-batch-action="select-idle" title="一键选中全部空闲/已完成会话">选空闲 (${idle})</button>` : ""}
      ${!allSelected && total > 0 ? `<button type="button" class="btn-secondary btn-xs" data-batch-action="select-all">全选</button>` : ""}
      ${count > 0 ? `<button type="button" class="btn-secondary btn-xs" data-batch-action="clear-all">清空</button>` : ""}
      <button type="button" class="btn-primary btn-xs batch-archive-submit" data-batch-action="submit-archive" ${count === 0 || submitting ? "disabled" : ""}>${iconSvg("archive", { size: 12 })}<span>${escapeHtml(primaryLabel)}</span></button>
      <button type="button" class="btn-secondary btn-xs" data-batch-action="exit" ${submitting ? "disabled" : ""}>完成</button>
    </div>
  `;
}

function resolveThreadDotClass(thread, recentCompletedByThread = null) {
  if ((thread?.pendingCount || 0) > 0) return "is-pending";
  if (thread?.live) return "is-live";
  if (isThreadFailed(thread, recentCompletedByThread)) return "is-error";
  if (recentCompletedByThread?.has?.(thread?.id)) return "is-done is-recent";
  return "is-done";
}

function renderThreadStatusMarkerHtml(thread, recentCompletedByThread = null) {
  const dotClass = resolveThreadDotClass(thread, recentCompletedByThread);
  const provider = String(thread?.provider || "antigravity");
  const meta = providerVisualMeta(provider);
  const isLiveRunning = (thread?.pendingCount || 0) === 0 && Boolean(thread?.live);
  const stateClasses = isLiveRunning ? "is-live is-agent-live" : dotClass;
  return `<span class="thread-status-dot ${stateClasses} is-agent-marker is-${escapeHtml(meta.tone)}" aria-hidden="true">${providerIconSvg(provider, { size: 12 })}</span>`;
}

function renderThreadCompactChipHtml(thread, chip) {
  if (!chip) return "";
  const text = String(chip.text || "").trim();
  if (!text) return "";
  return `<span class="thread-micro-tag is-text-only is-${escapeHtml(chip.tone)}" title="${escapeHtml(chip.title)}">${escapeHtml(text)}</span>`;
}

function renderTaskSlotHtml(thread, activeThreadId, { selectionMode = false, selectedSet = null, profiles = [], recentCompletedByThread = null, searchText = "" } = {}) {
  const isSelected = thread.id === activeThreadId;
  const isBatchChecked = Boolean(selectionMode && selectedSet?.has(thread.id));
  const hasQuery = Boolean(String(searchText || "").trim());
  const title = thread.title || "新会话";
  const timeText = formatCompactRelativeTime(thread.updatedAt);
  const pendingCount = thread.pendingCount || 0;
  const queuedCount = thread.queuedCount || 0;
  const isError = isThreadFailed(thread, recentCompletedByThread);
  const isDone = !thread.live && pendingCount === 0 && !isError;
  const isRecentDone = isDone && Boolean(recentCompletedByThread?.has?.(thread.id));
  const markerHtml = renderThreadStatusMarkerHtml(thread, recentCompletedByThread);
  const chip = compactThreadSourceChip(thread, { profiles });
  const chipHtml = renderThreadCompactChipHtml(thread, chip);
  const searchMatch = hasQuery ? (thread.searchMatch || null) : null;
  const snippetText = searchMatch ? formatSearchMatchSnippet(searchMatch) : "";
  const statusBadges = [];
  if (pendingCount > 0) {
    statusBadges.push(`<span class="board-status-pill is-pending">待确认 ${pendingCount}</span>`);
  }
  if (isError) {
    const fullErr = String(thread.lastError || recentCompletedByThread?.get?.(thread.id)?.summary || "执行报错中断").trim();
    statusBadges.push(`<span class="board-status-pill is-error" title="${escapeHtml(fullErr)}">报错中断</span>`);
  } else if (isRecentDone) {
    statusBadges.push(`<span class="board-status-pill is-recent-done" title="刚刚完成，尚未查看">新完成</span>`);
  }
  if (queuedCount > 0) {
    statusBadges.push(`<span class="board-status-pill is-queued" title="排队中 ${queuedCount} 条">排队 ${queuedCount}</span>`);
  }
  if (thread.goalState?.active) {
    statusBadges.push(`<span class="board-status-pill is-goal" title="Goal 自动推进中">${iconSvg("target", { size: 11 })}</span>`);
  }
  if (searchMatch && Number(searchMatch.matchCount) > 1) {
    statusBadges.push(`<span class="board-status-pill is-hit" title="对话正文命中 ${searchMatch.matchCount} 处">${searchMatch.matchCount} 处</span>`);
  }
  const preview = (isError && !snippetText)
    ? compactThreadErrorSummary(thread, recentCompletedByThread)
    : (snippetText || dedupeThreadPreview(title, thread.preview));
  const titleHtml = hasQuery ? renderHighlightedTextHtml(title, searchText) : escapeHtml(title);
  const previewHtml = hasQuery ? renderHighlightedTextHtml(preview, searchText) : escapeHtml(preview);
  const rowClasses = [
    "board-task-row",
    isSelected ? "is-selected" : "",
    isBatchChecked ? "is-batch-checked" : "",
    thread.live ? "is-live" : "",
    pendingCount > 0 ? "is-pending" : "",
    isError ? "is-error" : "",
    isDone ? "is-done" : "",
    isRecentDone ? "is-recent-done" : "",
  ].filter(Boolean).join(" ");

  return `
    <button
      type="button"
      class="${rowClasses}"
      data-board-open-thread="${escapeHtml(thread.id)}"${selectionMode ? ` aria-pressed="${isBatchChecked ? "true" : "false"}"` : ""}
    >
      <div class="board-task-main">
        <div class="board-task-top">
          ${selectionMode ? renderBatchCheckHtml({ checked: isBatchChecked }) : ""}
          ${markerHtml}
          <span class="board-task-title">${titleHtml}</span>
          ${statusBadges.join("")}
          ${chipHtml}
          <span class="board-task-time">${escapeHtml(timeText)}</span>
        </div>
        ${preview ? `<div class="board-task-preview${(isError && !snippetText) ? " is-error" : (snippetText ? " is-search-hit" : "")}">${previewHtml}</div>` : ""}
      </div>
    </button>
  `;
}

function renderSidebarProjectGroupHtml(group, {
  activeThreadId = "",
  collapsedGroups = new Set(),
  expandedSidebarGroups = new Set(),
  sidebarFoldPrefs = null,
  autoFoldProjects = true,
  hasQuery = false,
  searchText = "",
  nowMs = Date.now(),
  nowSec = 0,
  manualHoldMs = SIDEBAR_MANUAL_HOLD_MS,
  liveActivityByThread = new Map(),
  recentCompletedByThread = new Map(),
  activeLiveWindowSec = SIDEBAR_ACTIVE_LIVE_WINDOW_SEC,
  autoExpandLiveCount = SIDEBAR_AUTO_EXPAND_LIVE_COUNT,
  providerFilter = "all",
  profileFilter = "all",
  profiles = [],
  maxVisiblePerGroup = 8,
  staleThreadAgeSec = SIDEBAR_STALE_THREAD_AGE_SEC,
  minVisibleThreadsWhenOpen = 2,
  selectionMode = false,
  selectedThreadIds = null,
  allowOpenProjectWindow = true,
} = {}) {
  const cwd = group.cwd;
  const allItems = Array.isArray(group.threads) ? group.threads : [];
  const collapsed = resolveProjectGroupCollapsed(group, {
    activeThreadId,
    hasQuery,
    collapsedGroups,
    sidebarFoldPrefs,
    autoFoldProjects,
    nowMs,
    manualHoldMs,
    liveActivityByThread,
    activeLiveWindowSec,
    autoExpandLiveCount,
  });
  const extraExpandedCount = hasQuery ? Infinity : resolveExtraExpandedCount(expandedSidebarGroups, cwd, THREAD_EXPAND_STEP);
  const groupTitle = group.name || projectBaseName(cwd);

  const mustKeep = (t) => (
    t.id === activeThreadId
    || Boolean(t.pinned)
    || Boolean(t.live)
    || (t.pendingCount || 0) > 0
    || (t.queuedCount || 0) > 0
    || isThreadFailed(t, recentCompletedByThread)
    || Boolean(t.goalState?.active)
    || Boolean(recentCompletedByThread?.has?.(t.id))
  );
  const isStaleThread = (t) => {
    const tSec = toEpochSeconds(t.updatedAt);
    return Boolean(tSec > 0 && nowSec > tSec && (nowSec - tSec) > staleThreadAgeSec);
  };

  const freshList = allItems.filter((t) => mustKeep(t) || !isStaleThread(t));
  const defaultVisibleIds = new Set();
  if (freshList.length > 0) {
    for (const item of freshList.slice(0, maxVisiblePerGroup)) {
      defaultVisibleIds.add(item.id);
    }
    for (const item of allItems) {
      if (mustKeep(item)) defaultVisibleIds.add(item.id);
    }
  } else if (allItems.length > 0) {
    const fallbackCount = Math.min(Math.max(1, Number(minVisibleThreadsWhenOpen) || 2), allItems.length);
    for (const item of allItems.slice(0, fallbackCount)) {
      defaultVisibleIds.add(item.id);
    }
    if (activeThreadId) {
      const activeItem = allItems.find((item) => item.id === activeThreadId);
      if (activeItem) defaultVisibleIds.add(activeItem.id);
    }
  }

  const defaultHiddenItems = allItems.filter((t) => !defaultVisibleIds.has(t.id));
  const allHiddenAreStale = defaultHiddenItems.length > 0
    && defaultHiddenItems.every((t) => isStaleThread(t) && !mustKeep(t));
  const revealedHiddenSlice = hasQuery
    ? defaultHiddenItems
    : defaultHiddenItems.slice(0, Math.min(extraExpandedCount, defaultHiddenItems.length));
  const revealedHiddenIds = new Set(revealedHiddenSlice.map((t) => t.id));
  const visibleItems = hasQuery
    ? allItems
    : allItems.filter((t) => defaultVisibleIds.has(t.id) || revealedHiddenIds.has(t.id));
  const hiddenCount = hasQuery ? 0 : Math.max(0, defaultHiddenItems.length - revealedHiddenSlice.length);
  const expandedCount = hasQuery ? 0 : revealedHiddenSlice.length;
  const kindSuffix = `${allHiddenAreStale ? "较早" : ""}会话`;

  const selectedSet = toSelectedIdSet(selectedThreadIds);
  const groupSel = selectionMode ? computeProjectGroupSelectionState(group, selectedSet) : null;

  const groupClasses = [
    "project-group",
    group.pinned ? "is-pinned" : "",
    group.liveCount > 0 ? "has-live" : "",
    group.pendingCount > 0 ? "has-pending" : "",
    group.errorCount > 0 ? "has-error" : "",
    collapsed ? "is-collapsed" : "",
    selectionMode ? "is-batch-mode" : "",
    groupSel?.checked ? "is-batch-checked" : "",
    groupSel?.partial ? "is-batch-partial" : "",
  ].filter(Boolean).join(" ");

  const itemsHtml = collapsed ? "" : `
    <div class="project-group-items">
      ${visibleItems.map((t) => {
        const isSelected = t.id === activeThreadId;
        const isBatchChecked = Boolean(selectionMode && selectedSet?.has(t.id));
        const pendingCount = t.pendingCount || 0;
        const queuedCount = t.queuedCount || 0;
        const isError = isThreadFailed(t, recentCompletedByThread);
        const isDone = !t.live && pendingCount === 0 && !isError;
        const isRecentDone = isDone && Boolean(recentCompletedByThread?.has?.(t.id));
        const markerHtml = renderThreadStatusMarkerHtml(t, recentCompletedByThread);
        const chip = compactThreadSourceChip(t, { providerFilter, profileFilter, profiles });
        const chipHtml = renderThreadCompactChipHtml(t, chip);
        const title = t.title || "新会话";
        const liveAct = t.live ? liveActivityByThread?.get?.(t.id) : null;
        const searchMatch = hasQuery ? (t.searchMatch || null) : null;
        const snippetText = searchMatch ? formatSearchMatchSnippet(searchMatch) : "";
        let subText = "";
        let isLiveSub = false;
        let isSearchHitSub = false;
        if (t.live) {
          const phase = liveAct?.phase || t.livePhase || `${providerVisualMeta(t.provider).short} 执行中`;
          subText = liveAct?.detail ? `${phase} · ${liveAct.detail}` : phase;
          isLiveSub = true;
        } else if (snippetText) {
          subText = snippetText;
          isSearchHitSub = true;
        } else if (isError) {
          subText = compactThreadErrorSummary(t, recentCompletedByThread);
        } else if (hasQuery) {
          subText = dedupeThreadPreview(title, t.preview || "");
        }

        const itemClasses = [
          "thread-item",
          isSelected ? "is-selected" : "",
          isBatchChecked ? "is-batch-checked" : "",
          t.live ? "is-live" : "",
          pendingCount > 0 ? "is-pending" : "",
          isError ? "is-error" : "",
          isDone ? "is-done" : "",
          isRecentDone ? "is-recent-done" : "",
        ].filter(Boolean).join(" ");

        const fullErr = isError
          ? String(t.lastError || recentCompletedByThread?.get?.(t.id)?.summary || "执行报错中断").trim()
          : "";
        const hitCount = searchMatch ? Number(searchMatch.matchCount) || 0 : 0;
        const tagsHtml = [
          pendingCount ? `<span class="thread-pending-pill" title="待确认 ${pendingCount} 项">${pendingCount}</span>` : "",
          isError ? `<span class="thread-error-pill" title="${escapeHtml(fullErr)}">报错</span>` : "",
          hitCount > 1 ? `<span class="thread-hit-pill" title="对话正文命中 ${hitCount} 处">${hitCount} 处</span>` : "",
          queuedCount ? `<span class="thread-queued-pill" title="排队中 ${queuedCount} 条">排队 ${queuedCount}</span>` : "",
          t.goalState?.active ? `<span class="goal-micro-tag" title="Goal 自动推进中">${iconSvg("target", { size: 11 })}</span>` : "",
          chipHtml,
        ].filter(Boolean).join("");
        const timeHtml = !t.live ? `<span class="thread-item-time">${escapeHtml(formatCompactRelativeTime(t.updatedAt))}</span>` : "";
        const titleHtml = hasQuery ? renderHighlightedTextHtml(title, searchText) : escapeHtml(title);
        const subHtml = (hasQuery && !isLiveSub && !(isError && !isSearchHitSub))
          ? renderHighlightedTextHtml(subText, searchText)
          : escapeHtml(subText);
        const subClass = isLiveSub
          ? "is-live-sub"
          : (isSearchHitSub ? "is-search-hit" : (isError ? "is-error-sub" : ""));

        return `
          <div class="thread-item-wrap${selectionMode ? "" : " has-menu"}">
          <button type="button" class="${itemClasses}" data-thread-id="${escapeHtml(t.id)}"${selectionMode ? ` aria-pressed="${isBatchChecked ? "true" : "false"}"` : ""}>
            <span class="thread-item-top">
              ${selectionMode ? renderBatchCheckHtml({ checked: isBatchChecked }) : ""}
              ${markerHtml}
              <span class="thread-item-title">${titleHtml}</span>
              ${t.pinned ? `<span class="thread-pin-marker" title="已在当前项目置顶" aria-label="已在当前项目置顶">${iconSvg("pin", { size: 11 })}</span>` : ""}
              ${!subText && (tagsHtml || timeHtml) ? `<span class="thread-item-right">${tagsHtml}${timeHtml}</span>` : timeHtml}
            </span>
            ${subText ? `
              <span class="thread-item-secondary">
                <span class="thread-item-sub ${subClass}" title="${escapeHtml((isError && !isSearchHitSub ? fullErr : "") || subText)}">${subHtml}</span>
                ${tagsHtml ? `<span class="thread-item-tags">${tagsHtml}</span>` : ""}
              </span>
            ` : ""}
          </button>
          ${!selectionMode ? `<button type="button" class="thread-item-menu-btn" data-thread-menu="${escapeHtml(t.id)}" aria-label="更多操作" aria-haspopup="menu" title="更多操作">${iconSvg("more", { size: 16 })}</button>` : ""}
          </div>
        `;
      }).join("")}
      ${hiddenCount > 0 ? (() => {
        const expandLabel = hiddenCount <= THREAD_EXPAND_STEP
          ? `展开其余 ${hiddenCount} 条${kindSuffix}`
          : `${expandedCount > 0 ? "继续展开" : "展开"} ${THREAD_EXPAND_STEP} 条${kindSuffix}（剩余 ${hiddenCount} 条）`;
        const expandBtn = `
          <button type="button" class="sidebar-more-btn" data-sidebar-expand-cwd="${escapeHtml(cwd)}">
            ${expandLabel}
          </button>
        `;
        if (!hasQuery && expandedCount > 0) {
          return `
            <div class="sidebar-more-row">
              ${expandBtn}
              <button type="button" class="sidebar-more-btn is-collapse is-inline" data-sidebar-collapse-cwd="${escapeHtml(cwd)}">收起</button>
            </div>
          `;
        }
        return expandBtn;
      })() : (!hasQuery && expandedCount > 0 ? `
        <button type="button" class="sidebar-more-btn is-collapse" data-sidebar-collapse-cwd="${escapeHtml(cwd)}">
          ${allHiddenAreStale ? "收起较早会话" : "收起会话列表"}
        </button>
      ` : "")}
    </div>
  `;

  return `
    <div class="${groupClasses}" data-cwd="${escapeHtml(cwd)}">
      <div class="project-group-head" data-toggle-cwd="${escapeHtml(cwd)}" title="${escapeHtml(cwd)}">
        <span class="project-group-left">
          ${selectionMode ? renderBatchCheckHtml(groupSel) : ""}
          ${selectionMode
            ? `<button type="button" class="project-group-fold-btn" data-batch-fold-cwd="${escapeHtml(cwd)}" title="${collapsed ? "展开会话" : "收起会话"}" aria-label="${collapsed ? "展开会话" : "收起会话"}">${collapsed ? "▸" : "▾"}</button>`
            : `<span class="project-group-caret" aria-hidden="true">${collapsed ? "▸" : "▾"}</span>`}
          <span class="project-group-icon ${group.pinned ? "is-pinned" : ""}" aria-hidden="true">${group.pinned ? iconSvg("star-filled", { size: 12 }) : iconSvg("folder", { size: 12 })}</span>
          <span class="project-group-name">${escapeHtml(groupTitle)}</span>
        </span>
        <span class="project-group-right">
          ${group.errorCount > 0 ? `<span class="group-stat-pill is-error" title="${group.errorCount} 个任务报错中断">报错 ${group.errorCount}</span>` : ""}
          ${group.pendingCount > 0 ? `<span class="group-stat-pill is-pending" title="待确认 ${group.pendingCount}">${group.pendingCount}</span>` : ""}
          ${group.liveCount > 0 ? `<span class="group-stat-pill is-live" title="${group.liveCount} 个运行中"><span class="group-live-dot" aria-hidden="true"></span>${group.liveCount}</span>` : ""}
          ${!selectionMode && allowOpenProjectWindow ? `<button type="button" class="project-group-open" data-open-project-window="${escapeHtml(cwd)}" title="在独立新窗口打开此项目" aria-label="在独立新窗口打开此项目">${iconSvg("external-link", { size: 11 })}</button>` : ""}
          ${!selectionMode ? `<button type="button" class="project-group-add" data-new-in-cwd="${escapeHtml(cwd)}" title="在此项目新建会话（可选 Codex 等智能体）" aria-label="在此项目新建会话（可选 Codex 等智能体）">${iconSvg("plus", { size: 12 })}</button>` : ""}
          <span class="project-group-count">${selectionMode && groupSel?.selectedCount ? `${groupSel.selectedCount}/${allItems.length}` : allItems.length}</span>
        </span>
      </div>
      ${itemsHtml}
    </div>
  `;
}

export function renderSidebarThreadListHtml(groups = [], {
  activeThreadId = "",
  collapsedGroups = new Set(),
  expandedSidebarGroups = new Set(),
  sidebarFoldPrefs = null,
  autoFoldProjects = true,
  showStaleProjects = false,
  nowMs = Date.now(),
  manualHoldMs = SIDEBAR_MANUAL_HOLD_MS,
  staleProjectAgeSec = SIDEBAR_STALE_PROJECT_AGE_SEC,
  staleThreadAgeSec = SIDEBAR_STALE_THREAD_AGE_SEC,
  minVisibleProjects = 3,
  minVisibleThreadsWhenOpen = 2,
  activeLiveWindowSec = SIDEBAR_ACTIVE_LIVE_WINDOW_SEC,
  autoExpandLiveCount = SIDEBAR_AUTO_EXPAND_LIVE_COUNT,
  providerFilter = "all",
  profileFilter = "all",
  profiles = [],
  liveActivityByThread = new Map(),
  recentCompletedByThread = new Map(),
  searchText = "",
  searchLoading = false,
  searchIndexStatus = null,
  maxVisiblePerGroup = 8,
  selectionMode = false,
  selectedThreadIds = null,
  allowOpenProjectWindow = true,
} = {}) {
  const hasQuery = Boolean(String(searchText || "").trim());
  const statusMsg = hasQuery ? formatSearchStatusMessage(searchLoading, searchIndexStatus) : "";
  if (!Array.isArray(groups) || !groups.length) {
    if (statusMsg) {
      return `<div class="thread-empty">${escapeHtml(statusMsg)}</div>`;
    }
    return `<div class="thread-empty">暂无匹配的会话</div>`;
  }

  const nowSec = toEpochSeconds(nowMs);
  const { primaryGroups, staleGroups } = partitionSidebarProjectGroups(groups, {
    activeThreadId,
    hasQuery,
    sidebarFoldPrefs,
    nowMs,
    manualHoldMs,
    staleProjectAgeSec,
    minVisibleProjects,
  });

  const renderGroup = (group) => renderSidebarProjectGroupHtml(group, {
    activeThreadId,
    collapsedGroups,
    expandedSidebarGroups,
    sidebarFoldPrefs,
    autoFoldProjects,
    hasQuery,
    searchText,
    nowMs,
    nowSec,
    manualHoldMs,
    liveActivityByThread,
    recentCompletedByThread,
    activeLiveWindowSec,
    autoExpandLiveCount,
    providerFilter,
    profileFilter,
    profiles,
    maxVisiblePerGroup,
    staleThreadAgeSec,
    minVisibleThreadsWhenOpen,
    selectionMode,
    selectedThreadIds,
    allowOpenProjectWindow,
  });

  const html = primaryGroups.map(renderGroup);
  if (staleGroups.length > 0) {
    if (showStaleProjects) {
      html.push(`
        <div class="sidebar-stale-section is-expanded">
          <button type="button" class="sidebar-stale-projects-btn is-collapse" data-sidebar-stale-projects="collapse">
            <span class="stale-projects-left">
              <span class="project-group-caret" aria-hidden="true">▾</span>
              <span>收起较早未进行的项目</span>
            </span>
            <span class="stale-projects-count">${staleGroups.length}</span>
          </button>
          <div class="sidebar-stale-groups">
            ${staleGroups.map(renderGroup).join("")}
          </div>
        </div>
      `);
    } else {
      html.push(`
        <div class="sidebar-stale-section is-collapsed">
          <button type="button" class="sidebar-stale-projects-btn" data-sidebar-stale-projects="expand">
            <span class="stale-projects-left">
              <span class="project-group-caret" aria-hidden="true">▸</span>
              <span>较早未进行的项目</span>
            </span>
            <span class="stale-projects-count">${staleGroups.length}</span>
          </button>
        </div>
      `);
    }
  }

  if (statusMsg) {
    html.push(`<div class="sidebar-search-status">${escapeHtml(statusMsg)}</div>`);
  }

  return html.join("");
}

function renderProjectCardHtml(group, {
  activeThreadId = "",
  expanded = false,
  extraExpandedCount = 0,
  selectionMode = false,
  selectedThreadIds = null,
  profiles = [],
  recentCompletedByThread = null,
  allowOpenProjectWindow = true,
  searchText = "",
} = {}) {
  const baseLimit = 4;
  const visibleCount = expanded === true
    ? group.threads.length
    : Math.min(group.threads.length, baseLimit + Math.max(0, Number(extraExpandedCount) || 0));
  const shownThreads = group.threads.slice(0, visibleCount);
  const hiddenCount = Math.max(0, group.threads.length - shownThreads.length);
  const actualExpanded = Math.max(0, shownThreads.length - baseLimit);
  const selectedSet = toSelectedIdSet(selectedThreadIds);
  const groupSel = selectionMode ? computeProjectGroupSelectionState(group, selectedSet) : null;
  const cardClasses = [
    "board-project-card",
    group.pinned ? "is-pinned" : "",
    group.pendingCount > 0 ? "has-pending" : "",
    group.errorCount > 0 ? "has-error" : "",
    group.liveCount > 0 ? "has-live" : "",
    selectionMode ? "is-batch-mode" : "",
    groupSel?.checked ? "is-batch-checked" : "",
    groupSel?.partial ? "is-batch-partial" : "",
  ].filter(Boolean).join(" ");

  return `
    <article class="${cardClasses}" data-project-cwd="${escapeHtml(group.cwd)}">
      <div class="board-card-head"${selectionMode ? ` data-batch-project-cwd="${escapeHtml(group.cwd)}"` : ""}>
        <div class="board-card-title-wrap">
          ${selectionMode ? renderBatchCheckHtml(groupSel) : `
          <button
            type="button"
            class="board-pin-btn ${group.pinned ? "is-pinned" : ""}"
            data-toggle-pin-cwd="${escapeHtml(group.cwd)}"
            title="${group.pinned ? "取消关注置顶" : "关注置顶该项目"}"
            aria-label="${group.pinned ? "取消关注" : "关注置顶"}"
          >${group.pinned ? iconSvg("star-filled", { size: 14 }) : iconSvg("star", { size: 14 })}</button>`}
          <div class="board-card-names">
            <div class="board-card-title-row">
              <strong class="board-card-name">${escapeHtml(group.name)}</strong>
              <span class="board-card-count">${group.threads.length} 个任务</span>
              ${group.errorCount ? `<span class="board-status-pill is-error">报错 ${group.errorCount}</span>` : ""}
              ${group.liveCount ? `<span class="board-status-pill is-live">${group.liveCount} 运行中</span>` : ""}
              ${group.pendingCount ? `<span class="board-status-pill is-pending">待确认 ${group.pendingCount}</span>` : ""}
            </div>
            <div class="board-card-path" title="${escapeHtml(group.cwd)}">
              ${group.alias ? `<span class="board-alias-raw">${escapeHtml(group.rawName)} · </span>` : ""}
              <span>${escapeHtml(group.cwd)}</span>
            </div>
          </div>
        </div>
        <div class="board-card-actions">
          ${selectionMode ? `
            <span class="board-batch-ratio">${groupSel.selectedCount > 0 ? `已选 ${groupSel.selectedCount}/${groupSel.total}` : "点击全选项目"}</span>
          ` : `
            ${allowOpenProjectWindow ? `
            <button
              type="button"
              class="btn-secondary btn-xs"
              data-open-project-window="${escapeHtml(group.cwd)}"
              title="在独立新窗口打开此项目"
              aria-label="在独立新窗口打开此项目"
            >${iconSvg("external-link", { size: 11 })} 新窗口</button>` : ""}
            <button
              type="button"
              class="btn-secondary btn-xs"
              data-alias-cwd="${escapeHtml(group.cwd)}"
              title="设置项目中文简称（方便搜索与语音匹配）"
            >简称</button>
            <button
              type="button"
              class="btn-primary btn-xs"
              data-new-in-cwd="${escapeHtml(group.cwd)}"
            >+ 新任务</button>
          `}
        </div>
      </div>
      <div class="board-task-list">
        ${shownThreads.map((t) => renderTaskSlotHtml(t, activeThreadId, { selectionMode, selectedSet, profiles, recentCompletedByThread, searchText })).join("")}
      </div>
      ${hiddenCount > 0 ? (() => {
        const expandLabel = hiddenCount <= THREAD_EXPAND_STEP
          ? `展开其余 ${hiddenCount} 个任务`
          : `${actualExpanded > 0 ? "继续展开" : "展开"} ${THREAD_EXPAND_STEP} 个任务（剩余 ${hiddenCount} 个）`;
        const expandBtn = `
          <button type="button" class="board-expand-tasks-btn" data-expand-project-cwd="${escapeHtml(group.cwd)}">
            ${expandLabel}
          </button>
        `;
        if (actualExpanded > 0) {
          return `
            <div class="board-expand-tasks-row">
              ${expandBtn}
              <button type="button" class="board-expand-tasks-btn is-collapse" data-collapse-project-cwd="${escapeHtml(group.cwd)}">收起</button>
            </div>
          `;
        }
        return expandBtn;
      })() : (actualExpanded > 0 ? `
        <button type="button" class="board-expand-tasks-btn" data-collapse-project-cwd="${escapeHtml(group.cwd)}">
          收起部分任务
        </button>
      ` : "")}
    </article>
  `;
}

export function renderProjectBoardHtml({
  groups = [],
  allGroups = groups,
  pendingRequests = [],
  showAllProjects = false,
  expandedProjects = new Set(),
  activeThreadId = "",
  searchText = "",
  searchLoading = false,
  searchIndexStatus = null,
  selectionMode = false,
  selectedThreadIds = null,
  profiles = [],
  recentCompletedByThread = null,
  allowOpenProjectWindow = true,
} = {}) {
  const hasQuery = Boolean(String(searchText || "").trim());
  const statusMsg = hasQuery ? formatSearchStatusMessage(searchLoading, searchIndexStatus) : "";
  const pinnedGroups = groups.filter((g) => g.pinned);
  const unpinnedGroups = groups.filter((g) => !g.pinned);

  const suggestions = suggestFocusProjects(allGroups, 6);
  const showSuggestions = !searchText.trim() && pinnedGroups.length < 3 && suggestions.length > 0;

  const recentLimit = searchText.trim() || showAllProjects ? unpinnedGroups.length : 8;
  const visibleUnpinned = unpinnedGroups.slice(0, recentLimit);
  const hiddenOtherCount = Math.max(0, unpinnedGroups.length - visibleUnpinned.length);

  const failedThreads = [];
  const seenFailedIds = new Set();
  for (const g of allGroups || []) {
    for (const t of g?.threads || []) {
      if (!t?.id || seenFailedIds.has(t.id)) continue;
      if (isThreadFailed(t, recentCompletedByThread)) {
        seenFailedIds.add(t.id);
        failedThreads.push({ ...t, projectName: g.name });
      }
    }
  }

  const errorAlertHtml = failedThreads.length ? `
    <div class="board-attention-banner is-error">
      <div class="board-attention-text">
        <strong>有 ${failedThreads.length} 个任务因报错中断</strong>
        <span>${escapeHtml(`${failedThreads[0].projectName ? `${failedThreads[0].projectName} · ` : ""}${failedThreads[0].title || "会话"}：${compactThreadErrorSummary(failedThreads[0], recentCompletedByThread)}`)}</span>
      </div>
      <button type="button" class="btn-primary btn-xs is-danger" data-board-open-thread="${escapeHtml(failedThreads[0].id)}">
        立即查看
      </button>
    </div>
  ` : "";

  const pendingAlertHtml = pendingRequests.length ? `
    <div class="board-attention-banner">
      <div class="board-attention-text">
        <strong>有 ${pendingRequests.length} 个任务等待你审批或确认</strong>
        <span>点击下方对应任务即可处理，或在语音总控中直接下达批复</span>
      </div>
      <button type="button" class="btn-primary btn-xs" data-board-open-thread="${escapeHtml(pendingRequests[0].threadId || "")}">
        立即查看
      </button>
    </div>
  ` : "";

  const suggestionsHtml = showSuggestions ? `
    <section class="board-suggest-box">
      <div class="board-suggest-head">
        <span>一键星标常做项目（置顶后随时秒找、语音优先命中）</span>
      </div>
      <div class="board-suggest-chips">
        ${suggestions.map((g) => `
          <button type="button" class="board-suggest-chip" data-toggle-pin-cwd="${escapeHtml(g.cwd)}" title="${escapeHtml(g.cwd)}">
            <span>${iconSvg("star", { size: 11 })} ${escapeHtml(g.name)}</span>
            <span class="board-suggest-num">${g.threads.length}</span>
          </button>
        `).join("")}
      </div>
    </section>
  ` : "";

  return `
    <div class="board-toolbar">
      <div class="board-toolbar-heading">
        <div class="mo-title-line">
          <h2>项目与多任务总控</h2>
          <div class="mo-view-switch" role="tablist" aria-label="面板视图切换">
            <button type="button" class="mo-view-tab" data-board-view-mode="tycoon3d" aria-selected="false">3D 梦工厂</button>
            <button type="button" class="mo-view-tab is-active" data-board-view-mode="list" aria-selected="true">列表</button>
          </div>
          <div class="mo-view-subswitch" role="tablist" aria-label="列表分组方式">
            <button type="button" class="mo-subview-tab" data-board-view-mode="overview" aria-selected="false">按产线</button>
            <button type="button" class="mo-subview-tab is-active" data-board-view-mode="folders" aria-selected="true">按目录</button>
          </div>
        </div>
        <p>关注项目固定置顶；单项目下可直接并行管理多个智能体任务</p>
      </div>
      <div class="board-toolbar-actions">
        <button type="button" class="btn-secondary btn-sm ${selectionMode ? "is-active" : ""}" data-board-action="toggle-batch-select">${iconSvg("check", { size: 13 })} ${selectionMode ? "退出多选" : "批量归档"}</button>
        <button type="button" class="btn-secondary btn-sm" data-board-action="voice">${iconSvg("mic", { size: 13 })} 语音找项目 / 播报</button>
        <button type="button" class="btn-primary btn-sm" data-board-action="new">${iconSvg("plus", { size: 13 })} 新建会话</button>
        ${activeThreadId ? `<button type="button" class="btn-secondary btn-sm" data-board-action="resume">回到当前对话</button>` : ""}
      </div>
    </div>

    <div class="board-search-row">
      <input
        id="boardSearchInput"
        type="search"
        class="board-search-input"
        value="${escapeHtml(searchText)}"
        placeholder="输入项目名、简称、标题或对话内容关键词…"
      />
      ${searchText ? `<button type="button" class="btn-secondary btn-sm" data-board-action="clear-search">清空</button>` : ""}
    </div>
    ${statusMsg && groups.length ? `<div class="board-search-status">${escapeHtml(statusMsg)}</div>` : ""}

    ${errorAlertHtml}
    ${pendingAlertHtml}
    ${suggestionsHtml}

    ${!groups.length ? `
      <div class="board-empty-card">
        <strong>${statusMsg ? escapeHtml(statusMsg) : "没有找到匹配的项目或任务"}</strong>
        <span>${statusMsg ? "请稍候，正在扫描历史对话正文…" : "你可以清空搜索词，或者点击右上角「+ 新建会话」直接开始"}</span>
      </div>
    ` : ""}

    ${pinnedGroups.length ? `
      <section class="board-section">
        <div class="board-section-head">
          <h3>${iconSvg("star-filled", { size: 14 })} 我关注的项目 (${pinnedGroups.length})</h3>
        </div>
        <div class="board-grid">
          ${pinnedGroups.map((g) => renderProjectCardHtml(g, {
            activeThreadId,
            extraExpandedCount: resolveExtraExpandedCount(expandedProjects, g.cwd, THREAD_EXPAND_STEP),
            selectionMode,
            selectedThreadIds,
            profiles,
            recentCompletedByThread,
            allowOpenProjectWindow,
            searchText,
          })).join("")}
        </div>
      </section>
    ` : ""}

    ${visibleUnpinned.length ? `
      <section class="board-section">
        <div class="board-section-head">
          <h3>${iconSvg("folder", { size: 14 })} 最近项目 (${unpinnedGroups.length})</h3>
          ${unpinnedGroups.length > 8 ? `
            <button type="button" class="btn-secondary btn-xs" data-board-action="toggle-all-projects">
              ${showAllProjects ? "仅看最近 8 个" : `展开全部 ${unpinnedGroups.length} 个`}
            </button>
          ` : ""}
        </div>
        <div class="board-grid">
          ${visibleUnpinned.map((g) => renderProjectCardHtml(g, {
            activeThreadId,
            extraExpandedCount: resolveExtraExpandedCount(expandedProjects, g.cwd, THREAD_EXPAND_STEP),
            selectionMode,
            selectedThreadIds,
            profiles,
            recentCompletedByThread,
            allowOpenProjectWindow,
            searchText,
          })).join("")}
        </div>
        ${hiddenOtherCount > 0 ? `
          <div class="board-more-wrap">
            <button type="button" class="btn-secondary btn-sm" data-board-action="toggle-all-projects">
              展开其余 ${hiddenOtherCount} 个历史项目
            </button>
          </div>
        ` : ""}
      </section>
    ` : ""}
  `;
}

export function renderProjectTaskStripHtml({ projectGroup, activeThreadId = "", recentCompletedByThread = null } = {}) {
  if (!projectGroup) return "";
  const shown = projectGroup.threads.slice(0, 12);
  if (activeThreadId && !shown.some((t) => t.id === activeThreadId)) {
    const activeItem = projectGroup.threads.find((t) => t.id === activeThreadId);
    if (activeItem) shown.push(activeItem);
  }
  return `
    <div class="strip-project-info">
      <button type="button" class="strip-board-btn" data-strip-board title="回到项目总控面板">${iconSvg("board", { size: 12 })} 面板</button>
      <button
        type="button"
        class="strip-pin-btn ${projectGroup.pinned ? "is-pinned" : ""}"
        data-toggle-pin-cwd="${escapeHtml(projectGroup.cwd)}"
        title="${projectGroup.pinned ? "取消关注" : "关注置顶该项目"}"
      >${projectGroup.pinned ? iconSvg("star-filled", { size: 12 }) : iconSvg("star", { size: 12 })} ${escapeHtml(projectGroup.name)}</button>
    </div>
    <div class="strip-tasks-scroll" role="tablist" aria-label="同项目并行任务">
      ${shown.map((t) => {
        const isCurrent = t.id === activeThreadId;
        const label = t.title || "新会话";
        const isError = isThreadFailed(t, recentCompletedByThread);
        const isDone = !t.live && !(t.pendingCount > 0) && !isError;
        const visual = providerVisualMeta(t.provider);
        const fullErr = isError
          ? String(t.lastError || recentCompletedByThread?.get?.(t.id)?.summary || "执行报错中断").trim()
          : "";
        return `
          <button
            type="button"
            class="strip-task-pill ${isCurrent ? "is-active" : ""}${t.live ? " is-live" : ""}${isError ? " is-error" : ""}${isDone ? " is-done" : ""}"
            data-strip-thread-id="${escapeHtml(t.id)}"
            title="${escapeHtml(fullErr ? `${visual.label} · ${label}（报错：${fullErr}）` : `${visual.label} · ${label}`)}"
          >
            <span class="strip-status-dot is-${escapeHtml(t.provider)}${t.live ? " is-live" : ""}${t.pendingCount > 0 ? " is-pending" : ""}${isError ? " is-error" : ""}${isDone ? " is-done" : ""}" aria-hidden="true"></span>
            <span class="strip-provider-tag is-${escapeHtml(t.provider)}" aria-hidden="true">${escapeHtml(visual.glyph)}</span>
            <span class="strip-task-label">${escapeHtml(label)}</span>
            ${t.pendingCount > 0 ? `<span class="thread-pending-pill">${t.pendingCount}</span>` : ""}
            ${isError ? `<span class="thread-error-pill" title="${escapeHtml(fullErr)}">报错</span>` : ""}
            ${t.queuedCount > 0 ? `<span class="thread-queued-pill" title="排队中 ${t.queuedCount} 条">排队 ${t.queuedCount}</span>` : ""}
          </button>
        `;
      }).join("")}
      <button
        type="button"
        class="strip-new-task-btn"
        data-new-in-cwd="${escapeHtml(projectGroup.cwd)}"
        title="在当前项目目录新建并行任务"
      >＋<span class="strip-new-task-label"> 新任务</span></button>
    </div>
  `;
}
