import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { defaultDataDir } from "./instance-identity.mjs";
import { normalizeWorkspacePath } from "./platform.mjs";
import { displayThreadTitle } from "./thread-display.mjs";
import { normalizedThreadName } from "./thread-name.mjs";
import {
  evaluateTitleMutation,
  isCanonicalDomainTitle,
  resolveEffectiveTitleMeta,
} from "./thread-title-policy.mjs";

export function normalizeProjectCwd(cwd) {
  return normalizeWorkspacePath(cwd);
}

function cleanProjectAlias(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 60);
}

function cleanProfileAlias(value) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, 40);
}

function cleanReasoningEffort(value) {
  if (!value) return "";
  if (typeof value === "object") {
    return cleanReasoningEffort(value.reasoningEffort ?? value.id ?? value.value ?? "");
  }
  const str = String(value).trim();
  return str === "[object Object]" ? "" : str;
}

export function threadMetaPath(dataDir = defaultDataDir()) {
  return resolve(dataDir, "thread-meta.json");
}

export function profileHealthPath(dataDir = defaultDataDir()) {
  return resolve(dataDir, "profile-health.json");
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, filePath);
}

export const DEFAULT_AGY_AUTO_COMPACT_TOKENS = 60_000;
const AGY_AUTO_COMPACT_TOKENS_MIN = 20_000;
const AGY_AUTO_COMPACT_TOKENS_MAX = 900_000;

function normalizeSettings(raw = {}) {
  const tokens = Math.round(Number(raw?.agyAutoCompactTokens));
  return {
    agentAutoTitle: raw?.agentAutoTitle !== false,
    autoUpdateCli: raw?.autoUpdateCli !== false,
    sharedMemoryEnabled: raw?.sharedMemoryEnabled !== false,
    agyAutoCompact: raw?.agyAutoCompact !== false,
    agyAutoRetryAuth401: raw?.agyAutoRetryAuth401 !== false,
    agyAutoCompactTokens: Number.isFinite(tokens) && tokens > 0
      ? Math.min(AGY_AUTO_COMPACT_TOKENS_MAX, Math.max(AGY_AUTO_COMPACT_TOKENS_MIN, tokens))
      : DEFAULT_AGY_AUTO_COMPACT_TOKENS,
  };
}

export function createThreadMetaStore({
  filePath = threadMetaPath(),
  profileFilePath = resolve(dirname(filePath), "profile-health.json"),
} = {}) {
  let state = { version: 1, threads: {}, projects: {}, profiles: {}, settings: normalizeSettings() };
  let loaded = false;
  let writeChain = Promise.resolve();
  let persistScheduled = null;
  let profileWriteChain = Promise.resolve();

  const readProfilesFile = async () => {
    try {
      const parsed = JSON.parse(await readFile(profileFilePath, "utf8"));
      const raw = parsed?.profiles && typeof parsed.profiles === "object" ? parsed.profiles : parsed;
      const profiles = {};
      if (raw && typeof raw === "object" && !Array.isArray(raw)) {
        for (const [key, item] of Object.entries(raw)) {
          if (!key || key === "version" || !item || typeof item !== "object" || Array.isArray(item)) continue;
          profiles[key] = { ...item };
        }
      }
      return profiles;
    } catch {
      return {};
    }
  };

  const loadProfilesFresh = async () => {
    const fresh = await readProfilesFile();
    if (Object.keys(fresh).length) {
      state.profiles = { ...(state.profiles || {}), ...fresh };
    }
    return state.profiles;
  };

  const ensureLoaded = async () => {
    if (loaded) return;
    loaded = true;
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8"));
      if (parsed && typeof parsed === "object") {
        const projects = {};
        if (parsed.projects && typeof parsed.projects === "object") {
          for (const [rawCwd, item] of Object.entries(parsed.projects)) {
            const key = normalizeProjectCwd(rawCwd);
            if (!key || !item || typeof item !== "object") continue;
            projects[key] = { ...item };
          }
        }
        const legacyProfiles = {};
        if (parsed.profiles && typeof parsed.profiles === "object") {
          for (const [key, item] of Object.entries(parsed.profiles)) {
            if (!key || !item || typeof item !== "object") continue;
            legacyProfiles[key] = { ...item };
          }
        }
        const threads = {};
        if (parsed.threads && typeof parsed.threads === "object") {
          for (const [tid, item] of Object.entries(parsed.threads)) {
            if (!tid || !item || typeof item !== "object") continue;
            const cleanedEffort = cleanReasoningEffort(item.reasoningEffort);
            const nextItem = { ...item };
            if ("reasoningEffort" in nextItem) {
              if (cleanedEffort) nextItem.reasoningEffort = cleanedEffort;
              else delete nextItem.reasoningEffort;
            }
            if (typeof nextItem.cwd === "string") {
              const cleanedCwd = normalizeProjectCwd(nextItem.cwd);
              if (cleanedCwd) nextItem.cwd = cleanedCwd;
              else delete nextItem.cwd;
            }
            threads[tid] = nextItem;
          }
        }
        const fileProfiles = await readProfilesFile();
        const rawSettings = parsed.settings && typeof parsed.settings === "object" ? parsed.settings : {};
        state = {
          version: 1,
          threads,
          projects,
          profiles: { ...legacyProfiles, ...fileProfiles },
          settings: normalizeSettings(rawSettings),
        };
      }
    } catch {
      const fileProfiles = await readProfilesFile();
      state = { version: 1, threads: {}, projects: {}, profiles: fileProfiles, settings: normalizeSettings() };
    }
  };

  const persist = () => {
    if (!persistScheduled) {
      persistScheduled = Promise.resolve().then(() => {
        persistScheduled = null;
        const snapshot = {
          version: 1,
          threads: { ...state.threads },
          projects: { ...state.projects },
          settings: { ...state.settings },
        };
        const next = writeChain.then(() => writeJsonAtomic(filePath, snapshot));
        writeChain = next.catch(() => {});
        return next;
      });
    }
    return persistScheduled;
  };

  return {
    filePath,
    profileFilePath,
    async load() {
      await ensureLoaded();
      return state;
    },
    get(compositeId) {
      return state.threads[compositeId] ? { ...state.threads[compositeId] } : null;
    },
    async setCustomName(compositeId, name, { source = "user" } = {}) {
      await ensureLoaded();
      const clean = normalizedThreadName(name);
      const nowSec = Math.floor(Date.now() / 1000);
      const prev = state.threads[compositeId] || {};
      const resolvedSource = source === "domain" || (source === "agent" && isCanonicalDomainTitle(clean))
        ? "domain"
        : (source === "agent" ? "agent" : "user");
      state.threads[compositeId] = {
        ...prev,
        customName: clean,
        titleMeta: {
          state: resolvedSource === "user" ? "user" : "locked",
          source: resolvedSource,
          base: clean,
          suffixes: [],
          createdAt: prev.titleMeta?.createdAt || nowSec,
          lockedAt: nowSec,
          updatedAt: nowSec,
          draftTurns: Math.max(1, Number(prev.titleMeta?.draftTurns) || 1),
        },
        updatedAt: nowSec,
      };
      await persist();
      return { ...state.threads[compositeId] };
    },
    async applyThreadTitleMutation(
      compositeId,
      { source = "user", action = "set", name = "", suffix = "", lock = false } = {},
    ) {
      await ensureLoaded();
      const prev = state.threads[compositeId] || {};
      const nowSec = Math.floor(Date.now() / 1000);
      const decision = evaluateTitleMutation(prev, { source, action, name, suffix, lock }, { nowSec });
      if (!decision.ok) {
        throw Object.assign(new Error(decision.error || "标题格式不合法"), {
          status: decision.status || 400,
          code: decision.code || "invalid_title",
        });
      }
      if (decision.skipped) {
        return {
          skipped: true,
          locked: Boolean(decision.locked),
          reason: decision.reason,
          name: decision.currentName,
          titleState: decision.titleState,
          base: decision.base,
          suffixes: decision.suffixes,
        };
      }
      state.threads[compositeId] = {
        ...prev,
        customName: decision.nextCustomName,
        titleMeta: decision.nextTitleMeta,
        updatedAt: nowSec,
      };
      await persist();
      return {
        skipped: false,
        locked: decision.nextTitleMeta.state === "locked" || decision.nextTitleMeta.state === "user",
        reason: "",
        name: decision.nextCustomName,
        titleState: decision.nextTitleMeta.state,
        titleMeta: { ...decision.nextTitleMeta },
      };
    },
    async setForkInheritedName(
      compositeId,
      displayName,
      { inheritedBase = "", suffixes = [], lock = false, source = "fork" } = {},
    ) {
      await ensureLoaded();
      const cleanDisplay = normalizedThreadName(displayName);
      const cleanBase = String(inheritedBase || cleanDisplay).replace(/[\r\n]+/g, " ").trim() || cleanDisplay;
      const cleanSuffixes = Array.isArray(suffixes)
        ? suffixes.map((s) => String(s || "").trim()).filter(Boolean)
        : [];
      const nowSec = Math.floor(Date.now() / 1000);
      const prev = state.threads[compositeId] || {};
      const nextState = source === "user" ? "user" : (lock ? "locked" : "draft");
      state.threads[compositeId] = {
        ...prev,
        customName: cleanDisplay,
        titleMeta: {
          state: nextState,
          source,
          base: cleanBase,
          suffixes: cleanSuffixes,
          createdAt: nowSec,
          lockedAt: nextState === "locked" || nextState === "user" ? nowSec : 0,
          updatedAt: nowSec,
          draftTurns: lock || nextState === "user" ? 3 : 1,
        },
        updatedAt: nowSec,
      };
      await persist();
      return { ...state.threads[compositeId] };
    },
    async recordUserTurnForTitle(compositeId) {
      await ensureLoaded();
      if (!compositeId) return null;
      const prev = state.threads[compositeId];
      if (!prev?.titleMeta || prev.titleMeta.state !== "draft") return null;
      const nowSec = Math.floor(Date.now() / 1000);
      const nextTurns = (Number(prev.titleMeta.draftTurns) || 1) + 1;
      const eff = resolveEffectiveTitleMeta({
        ...prev,
        titleMeta: { ...prev.titleMeta, draftTurns: nextTurns },
      }, { nowSec });
      state.threads[compositeId] = {
        ...prev,
        titleMeta: {
          ...prev.titleMeta,
          draftTurns: nextTurns,
          state: eff.state,
          lockedAt: eff.state === "locked" ? (eff.lockedAt || nowSec) : 0,
          updatedAt: nowSec,
        },
      };
      await persist();
      return { ...state.threads[compositeId] };
    },
    async setAutoTitle(
      compositeId,
      autoTitle,
      {
        sourceSig = "",
        isDrift = false,
        locked = false,
        domainKey = "",
        schemaVersion = 0,
      } = {},
    ) {
      await ensureLoaded();
      if (!compositeId) return null;
      const trimmed = String(autoTitle || "").trim();
      const clean = trimmed ? normalizedThreadName(trimmed) : "";
      const nextSig = String(sourceSig || "");
      const nextIsDrift = Boolean(clean && isDrift);
      const nextLocked = Boolean(clean && locked);
      const nextDomainKey = clean ? String(domainKey || "") : "";
      const nextSchemaVersion = clean ? (Number(schemaVersion) || 0) : 0;
      const prev = state.threads[compositeId] || {};
      if (
        (prev.autoTitle || "") === clean
        && (prev.autoTitleSourceSig || "") === nextSig
        && Boolean(prev.autoTitleIsDrift) === nextIsDrift
        && Boolean(prev.titleLocked) === nextLocked
        && (prev.titleDomainKey || "") === nextDomainKey
        && (Number(prev.titleSchemaVersion) || 0) === nextSchemaVersion
      ) {
        return { ...prev };
      }
      const now = Math.floor(Date.now() / 1000);
      state.threads[compositeId] = {
        ...prev,
        autoTitle: clean,
        autoTitleSourceSig: nextSig,
        autoTitleIsDrift: nextIsDrift,
        titleLocked: nextLocked,
        titleDomainKey: nextDomainKey,
        titleSchemaVersion: nextSchemaVersion,
        autoTitleUpdatedAt: clean ? now : 0,
        updatedAt: now,
      };
      await persist();
      return { ...state.threads[compositeId] };
    },
    async setPinned(compositeId, pinned = true) {
      await ensureLoaded();
      const prev = state.threads[compositeId] || {};
      state.threads[compositeId] = { ...prev, pinned: Boolean(pinned) };
      await persist();
      return { ...state.threads[compositeId] };
    },
    async setArchived(compositeId, archived = true) {
      await ensureLoaded();
      const prev = state.threads[compositeId] || {};
      const nextArchived = Boolean(archived);
      state.threads[compositeId] = {
        ...prev,
        archived: nextArchived,
        archivedAt: nextArchived ? Math.floor(Date.now() / 1000) : null,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      await persist();
      return { ...state.threads[compositeId] };
    },
    async setArchivedMany(compositeIds = [], archived = true) {
      await ensureLoaded();
      const nextArchived = Boolean(archived);
      const now = Math.floor(Date.now() / 1000);
      const updatedIds = [];
      for (const rawId of compositeIds) {
        const id = String(rawId || "").trim();
        if (!id) continue;
        const prev = state.threads[id] || {};
        state.threads[id] = {
          ...prev,
          archived: nextArchived,
          archivedAt: nextArchived ? now : null,
          updatedAt: now,
        };
        updatedIds.push(id);
      }
      if (updatedIds.length > 0) {
        await persist();
      }
      return {
        count: updatedIds.length,
        threadIds: updatedIds,
        archived: nextArchived,
      };
    },
    hasUnarchivedOverrides() {
      return Object.values(state.threads || {}).some((item) => item && item.archived === false);
    },
    listThreads() {
      const out = {};
      for (const [id, item] of Object.entries(state.threads || {})) {
        if (!id || !item || typeof item !== "object") continue;
        out[id] = { ...item };
      }
      return out;
    },
    async setThreadTopic(compositeId, topicId = "", stageTag = "") {
      await ensureLoaded();
      if (!compositeId) return null;
      const prev = state.threads[compositeId] || {};
      const cleanTopic = String(topicId || "").trim().slice(0, 64);
      const cleanStage = String(stageTag || "").replace(/[\r\n]+/g, " ").trim().slice(0, 32);
      const next = { ...prev, updatedAt: Math.floor(Date.now() / 1000) };
      if (cleanTopic) {
        next.topicId = cleanTopic;
        if (cleanStage) next.stageTag = cleanStage;
        else delete next.stageTag;
      } else {
        delete next.topicId;
        delete next.stageTag;
      }
      state.threads[compositeId] = next;
      await persist();
      return { ...next };
    },
    async setThreadTask(compositeId, taskId = "") {
      await ensureLoaded();
      if (!compositeId) return null;
      const prev = state.threads[compositeId] || {};
      const cleanTaskId = String(taskId || "").trim().slice(0, 64);
      if ((prev.taskId || "") === cleanTaskId) return { ...prev };
      const next = { ...prev, updatedAt: Math.floor(Date.now() / 1000) };
      if (cleanTaskId) next.taskId = cleanTaskId;
      else delete next.taskId;
      state.threads[compositeId] = next;
      await persist();
      return { ...next };
    },
    async setThreadPrefs(compositeId, patch = {}) {
      await ensureLoaded();
      if (!compositeId) return null;
      const prev = state.threads[compositeId] || {};
      const next = { ...prev, updatedAt: Math.floor(Date.now() / 1000) };
      if (typeof patch.internal === "boolean") next.internal = patch.internal;
      if (typeof patch.model === "string" && patch.model.trim()) {
        next.model = patch.model.trim();
      }
      if ("reasoningEffort" in patch) {
        const cleaned = cleanReasoningEffort(patch.reasoningEffort);
        if (cleaned) next.reasoningEffort = cleaned;
        else delete next.reasoningEffort;
      }
      if (typeof patch.permissionMode === "string" && patch.permissionMode.trim()) {
        next.permissionMode = patch.permissionMode.trim();
      }
      if (typeof patch.cwd === "string" && patch.cwd.trim()) {
        const normCwd = normalizeProjectCwd(patch.cwd);
        if (normCwd) next.cwd = normCwd;
      }
      state.threads[compositeId] = next;
      await persist();
      return { ...state.threads[compositeId] };
    },
    listProjects() {
      const out = {};
      for (const [key, item] of Object.entries(state.projects || {})) {
        out[key] = { ...item };
      }
      return out;
    },
    getProject(cwd) {
      const key = normalizeProjectCwd(cwd);
      return key && state.projects[key] ? { ...state.projects[key] } : null;
    },
    async setProjectMeta(cwd, patch = {}) {
      await ensureLoaded();
      const key = normalizeProjectCwd(cwd);
      if (!key) {
        throw Object.assign(new Error("项目路径 cwd 不能为空"), { status: 400 });
      }
      const prev = state.projects[key] || {};
      const now = Math.floor(Date.now() / 1000);
      const nextPinned = Object.hasOwn(patch, "pinned") ? Boolean(patch.pinned) : Boolean(prev.pinned);
      const nextAlias = Object.hasOwn(patch, "alias") ? cleanProjectAlias(patch.alias) : cleanProjectAlias(prev.alias);
      if (!nextPinned && !nextAlias) {
        delete state.projects[key];
        await persist();
        return { pinned: false, alias: "", pinnedAt: null, updatedAt: now };
      }
      const pinnedAt = nextPinned ? (prev.pinnedAt || now) : null;
      state.projects[key] = {
        ...prev,
        pinned: nextPinned,
        alias: nextAlias,
        pinnedAt,
        updatedAt: now,
      };
      await persist();
      return { ...state.projects[key] };
    },
    applyToThread(thread) {
      if (!thread?.id) return thread;
      const meta = state.threads[thread.id];
      if (!meta) return thread;
      const customName = meta.customName || "";
      const eff = resolveEffectiveTitleMeta(meta);
      const nextName = customName || thread.name || "";
      const nextTitle = customName
        || thread.title
        || displayThreadTitle({ ...thread, customName, name: nextName });
      return {
        ...thread,
        originalName: thread.originalName ?? thread.name ?? "",
        originalTitle: thread.originalTitle ?? thread.title ?? "",
        name: nextName,
        title: nextTitle,
        customName,
        autoTitle: "",
        autoTitleSourceSig: "",
        autoTitleIsDrift: false,
        titleLocked: Boolean(customName && eff.state !== "draft"),
        titleState: eff.state,
        titleDomainKey: "",
        titleSchemaVersion: Number(meta.titleSchemaVersion) || 0,
        archived: Boolean(meta.archived ?? thread.archived),
        pinned: Boolean(meta.pinned),
        ...(meta.internal ? { internal: true } : {}),
        ...(meta.taskId ? { taskId: meta.taskId } : {}),
        ...(meta.cwd ? { cwd: meta.cwd } : {}),
        ...(meta.model ? { model: meta.model } : {}),
        ...(meta.reasoningEffort ? { reasoningEffort: meta.reasoningEffort } : {}),
        ...(meta.permissionMode ? { permissionMode: meta.permissionMode } : {}),
      };
    },
    getSettings() {
      return normalizeSettings(state.settings);
    },
    async setSettings(patch = {}) {
      await ensureLoaded();
      const prev = normalizeSettings(state.settings);
      const next = normalizeSettings({
        ...prev,
        ...(Object.hasOwn(patch, "agentAutoTitle") ? { agentAutoTitle: Boolean(patch.agentAutoTitle) } : {}),
        ...(Object.hasOwn(patch, "autoUpdateCli") ? { autoUpdateCli: Boolean(patch.autoUpdateCli) } : {}),
        ...(Object.hasOwn(patch, "sharedMemoryEnabled") ? { sharedMemoryEnabled: Boolean(patch.sharedMemoryEnabled) } : {}),
        ...(Object.hasOwn(patch, "agyAutoCompact") ? { agyAutoCompact: Boolean(patch.agyAutoCompact) } : {}),
        ...(Object.hasOwn(patch, "agyAutoRetryAuth401") ? { agyAutoRetryAuth401: Boolean(patch.agyAutoRetryAuth401) } : {}),
        ...(Object.hasOwn(patch, "agyAutoCompactTokens") ? { agyAutoCompactTokens: patch.agyAutoCompactTokens } : {}),
      });
      state.settings = next;
      await persist();
      return { ...next };
    },
    getProfileMeta(profileKey) {
      const key = String(profileKey || "").trim();
      return key && state.profiles?.[key] ? { ...state.profiles[key] } : null;
    },
    listProfilesMeta() {
      const out = {};
      for (const [key, item] of Object.entries(state.profiles || {})) {
        out[key] = { ...item };
      }
      return out;
    },
    async setProfileMeta(profileKey, patch = {}) {
      const key = String(profileKey || "").trim();
      if (!key) {
        throw Object.assign(new Error("实例标识 profileKey 不能为空"), { status: 400 });
      }
      const runUpdate = async () => {
        await ensureLoaded();
        await loadProfilesFresh();
        if (!state.profiles || typeof state.profiles !== "object") {
          state.profiles = {};
        }
        const prev = state.profiles[key] || {};
        const next = { ...prev };
        if (Object.hasOwn(patch, "status") && typeof patch.status === "string") {
          next.status = patch.status;
        }
        if (Object.hasOwn(patch, "reasonCode")) {
          next.reasonCode = String(patch.reasonCode || "");
        }
        if (Object.hasOwn(patch, "shortReason")) {
          next.shortReason = String(patch.shortReason || "");
        }
        if (Object.hasOwn(patch, "detail")) {
          next.detail = String(patch.detail || "").slice(0, 400);
        }
        if (Object.hasOwn(patch, "latencyMs")) {
          next.latencyMs = patch.latencyMs === null || patch.latencyMs === undefined
            ? null
            : Math.max(0, Math.round(Number(patch.latencyMs) || 0));
        }
        if (Object.hasOwn(patch, "checkedAt")) {
          next.checkedAt = Number(patch.checkedAt) || 0;
        }
        if (Object.hasOwn(patch, "cooldownUntil")) {
          next.cooldownUntil = Number(patch.cooldownUntil) || 0;
        }
        if (Object.hasOwn(patch, "disabled")) {
          next.disabled = Boolean(patch.disabled);
        }
        if (Object.hasOwn(patch, "alias")) {
          next.alias = cleanProfileAlias(patch.alias);
        }
        if (Object.hasOwn(patch, "autoAliasSignature")) {
          next.autoAliasSignature = String(patch.autoAliasSignature || "").slice(0, 240);
        }
        if (Object.hasOwn(patch, "autoAliasSource")) {
          next.autoAliasSource = String(patch.autoAliasSource || "").slice(0, 32);
        }
        if (Object.hasOwn(patch, "codexExecMode")) {
          next.codexExecMode = Boolean(patch.codexExecMode);
        }
        if (Object.hasOwn(patch, "codexExecSuggested")) {
          next.codexExecSuggested = Boolean(patch.codexExecSuggested);
        }
        next.updatedAt = Math.floor(Date.now() / 1000);
        state.profiles[key] = next;
        await writeJsonAtomic(profileFilePath, {
          version: 1,
          profiles: state.profiles,
        });
        return { ...next };
      };
      const op = profileWriteChain.then(runUpdate, runUpdate);
      profileWriteChain = op.catch(() => {});
      return op;
    },
    flush() {
      return Promise.all([persistScheduled || Promise.resolve(), writeChain, profileWriteChain]);
    },
  };
}
