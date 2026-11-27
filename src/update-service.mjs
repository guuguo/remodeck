import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { defaultDataDir } from "./instance-identity.mjs";
import { normalizePlatform, prepareCrossPlatformSpawn, resolveExecutableCrossPlatform, resolveUserHome } from "./platform.mjs";
import { resolveServerNodeArgs } from "../scripts/service.mjs";

const execFileAsync = promisify(execFile);

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_APP_ROOT = resolve(MODULE_DIR, "..");
export const RELEASE_NOTES_FILENAME = "RELEASE_NOTES.md";
export const RELEASE_NOTES_EN_FILENAME = "RELEASE_NOTES.en.md";
// Published on the remote after a history rewrite: lists the pre-rewrite commit SHAs so
// clients sitting on an official old commit can safely realign instead of reporting "ahead".
export const HISTORY_REWRITE_FILENAME = "history-rewrite.json";
export const CHANGELOG_FILENAME = "CHANGELOG.md";
export const DESKTOP_APP_NAME = "Agent Control.app";
export const DESKTOP_SOURCE_FILES = [
  "desktop/macos/AgentControl.swift",
  "desktop/macos/Info.plist",
  "desktop/macos/build-app.sh",
  "desktop/macos/render-icon.swift",
  "desktop/linux/agent-control.py",
  "desktop/linux/agent-control.svg",
  "desktop/linux/install-app.sh",
  "desktop/windows/install-app.ps1",
  "desktop/windows/RemoteDeckLauncher.cs",
  "desktop/windows/remodeck.ico",
];
export const DEFAULT_CHECK_INTERVAL_HOURS = 6;
const MIN_CHECK_INTERVAL_HOURS = 1;
const MAX_CHECK_INTERVAL_HOURS = 168;
const DEFAULT_INITIAL_DELAY_MS = 12_000;
const DEFAULT_IDLE_RETRY_MS = 60_000;
const DEFAULT_RESTART_DELAY_MS = 650;

export function updateStatePath(dataDir = defaultDataDir()) {
  return resolve(dataDir, "update-state.json");
}

export function sanitizeRemoteUrl(raw = "") {
  const clean = String(raw || "").trim();
  if (!clean) return "";
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(clean)) {
      const parsed = new URL(clean);
      parsed.username = "";
      parsed.password = "";
      return parsed.toString();
    }
  } catch {
    // Fall through for SCP-style git@host:owner/repo.git URLs.
  }
  return clean.replace(/^([^:@/]+):[^@/]*@/, "$1@");
}

export function parsePorcelainDirtyFiles(stdout = "", maxItems = 8) {
  const lines = String(stdout || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line.trim().length > 0);
  const files = lines.map((line) => line.slice(3).trim()).filter(Boolean);
  return {
    dirty: files.length > 0,
    dirtyCount: files.length,
    dirtySample: files.slice(0, Math.max(1, maxItems)),
  };
}

function isEnglishReleaseLocale(locale = "zh") {
  const clean = String(locale || "").trim().toLowerCase();
  return Boolean(clean && !clean.startsWith("zh"));
}

function normalizeReleaseCategory(rawHeading = "", locale = "zh") {
  const text = String(rawHeading || "").trim();
  const isEn = isEnglishReleaseLocale(locale);
  if (/(新增|新功能|功能|亮点|features?|added?)/i.test(text)) {
    return { category: "new", categoryLabel: isEn ? "New" : "新增" };
  }
  if (/(优化|改进|体验|升级|性能|improv|enhanc|optimiz)/i.test(text)) {
    return { category: "improve", categoryLabel: isEn ? "Improved" : "优化" };
  }
  if (/(修复|修正|问题|bug|fix)/i.test(text)) {
    return { category: "fix", categoryLabel: isEn ? "Fixed" : "修复" };
  }
  return { category: "note", categoryLabel: isEn ? "Note" : "说明" };
}

function compareSemverParts(a = "", b = "") {
  const pa = String(a || "").trim().replace(/^v/i, "").split(".").map((n) => Number(n));
  const pb = String(b || "").trim().replace(/^v/i, "").split(".").map((n) => Number(n));
  if (pa.length !== 3 || pb.length !== 3 || pa.some(Number.isNaN) || pb.some(Number.isNaN)) {
    return 0;
  }
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

function stripTrailingGitSha(text = "") {
  return String(text || "").replace(/\s*\([0-9a-f]{7,40}\)\s*$/i, "").trim();
}

function stripMarkdownBoldMarkers(text = "") {
  return String(text || "").replace(/\*\*(.+?)\*\*/g, "$1").trim();
}

function parseReleaseHeading(rawHeading = "", locale = "zh") {
  const heading = String(rawHeading || "").trim();
  const versionMatch = heading.match(/\bv?(\d+\.\d+\.\d+)\b/i);
  const dateMatch = heading.match(/(\d{4}-\d{2}-\d{2})/);
  const version = versionMatch?.[1] || "";
  const date = dateMatch?.[1] || "";
  const isEn = isEnglishReleaseLocale(locale);

  let title = "";
  const sepMatch = heading.match(/(?:—|--|\s-\s|：)\s*(.+)$/);
  if (sepMatch?.[1]) {
    title = sepMatch[1].trim();
  } else {
    title = heading
      .replace(/\bv?\d+\.\d+\.\d+\b/i, "")
      .replace(/\(\s*\d{4}-\d{2}-\d{2}\s*\)/, "")
      .replace(/\d{4}-\d{2}-\d{2}/, "")
      .replace(/^[\s—\-:：]+|[\s—\-:：]+$/g, "")
      .trim();
  }

  return {
    id: version ? `v${version}` : heading,
    heading,
    version,
    date,
    title: title || (version ? (isEn ? `v${version} Release` : `v${version} 版本更新`) : heading),
  };
}

function parseReleaseListItem(rawText = "", defaultCat = { category: "note", categoryLabel: "说明" }, locale = "zh") {
  let clean = stripTrailingGitSha(String(rawText || "").trim());
  if (!clean) return null;
  const isEn = isEnglishReleaseLocale(locale);

  let cat = { ...defaultCat };
  const prefixMatch = clean.match(/^(?:【([^】]{1,10})】|\[([^\]]{1,10})\])\s*(.+)$/);
  if (prefixMatch) {
    const tagText = (prefixMatch[1] || prefixMatch[2] || "").trim();
    if (tagText) {
      cat = normalizeReleaseCategory(tagText, locale);
      clean = prefixMatch[3].trim();
    }
  }

  let title = "";
  let detail = "";
  const boldSplit = clean.match(/^\*\*(.+?)\*\*\s*(?:[:：—-]+\s*(.*)|$)/);
  if (boldSplit) {
    title = stripMarkdownBoldMarkers(boldSplit[1]);
    detail = stripMarkdownBoldMarkers(boldSplit[2] || "");
  } else {
    detail = stripMarkdownBoldMarkers(clean);
  }

  const text = title && detail
    ? `${title}${isEn ? ": " : "："}${detail}`
    : (title || detail);
  if (!text) return null;

  return {
    category: cat.category,
    categoryLabel: cat.categoryLabel,
    title,
    detail,
    text,
  };
}

export function parseReleaseNotes(markdown = "", { maxEntries = 6, maxItemsPerEntry = 12, locale = "zh" } = {}) {
  const source = String(markdown || "");
  if (!source.trim()) return [];
  const defaultNoteCat = { category: "note", categoryLabel: isEnglishReleaseLocale(locale) ? "Note" : "说明" };

  const lines = source.split(/\r?\n/);
  const entries = [];
  let current = null;
  let currentCat = { ...defaultNoteCat };
  let summaryLines = [];
  let summaryDone = false;

  const flushCurrent = () => {
    if (!current) return;
    if (!current.summary && summaryLines.length > 0) {
      current.summary = stripMarkdownBoldMarkers(summaryLines.join(" "))
        .replace(/^(?:一句话总结|更新摘要|版本摘要|摘要|summary|tl;dr|overview)\s*[:：]\s*/i, "")
        .trim();
    }
    if (current.items.length > 0 || current.summary || current.title) {
      entries.push(current);
    }
    current = null;
    summaryLines = [];
    summaryDone = false;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      flushCurrent();
      if (entries.length >= maxEntries) break;
      const meta = parseReleaseHeading(h2[1], locale);
      current = {
        ...meta,
        summary: "",
        items: [],
      };
      currentCat = { ...defaultNoteCat };
      summaryLines = [];
      summaryDone = false;
      continue;
    }

    if (!current) continue;
    if (entries.length >= maxEntries) continue;

    const h3 = line.match(/^###+\s+(.+)$/);
    if (h3) {
      summaryDone = true;
      currentCat = normalizeReleaseCategory(h3[1], locale);
      continue;
    }

    if (!line) {
      if (summaryLines.length > 0) summaryDone = true;
      continue;
    }

    if (/^(?:>|<!--|---+|\*\*\*+$|UI\s*资源版本\s*[:：])/i.test(line)) {
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      summaryDone = true;
      if (current.items.length < maxItemsPerEntry) {
        const parsedItem = parseReleaseListItem(bullet[1], currentCat, locale);
        if (parsedItem) {
          current.items.push(parsedItem);
        }
      }
      continue;
    }

    if (!summaryDone && current.items.length === 0) {
      summaryLines.push(line);
    }
  }

  flushCurrent();
  return entries.slice(0, maxEntries);
}

function classifyCommitSubject(rawSubject = "", locale = "zh") {
  const subject = String(rawSubject || "").trim();
  const isEn = isEnglishReleaseLocale(locale);
  const prefixMatch = subject.match(/^(feat|fix|perf|refactor|style|ui|docs|chore|ci|build|test)(?:\(([^)]*)\))?!?:\s*(.+)$/i);
  const commitType = (prefixMatch?.[1] || "").toLowerCase();
  const cleanText = stripTrailingGitSha((prefixMatch?.[3] || subject).trim());

  if (commitType === "feat" || /^(?:新增|增加|支持|接入|上线|add(?:ed)?|support)/i.test(cleanText)) {
    return { category: "new", categoryLabel: isEn ? "New" : "新增", text: cleanText };
  }
  if (commitType === "fix" || /^(?:修复|修正|解决|fix(?:ed)?|resolve)/i.test(cleanText)) {
    return { category: "fix", categoryLabel: isEn ? "Fixed" : "修复", text: cleanText };
  }
  if (["perf", "refactor", "style", "ui"].includes(commitType) || /^(?:优化|改进|完善|升级|精简|调整|improv|enhanc|optimiz)/i.test(cleanText)) {
    return { category: "improve", categoryLabel: isEn ? "Improved" : "优化", text: cleanText };
  }
  return { category: "note", categoryLabel: isEn ? "Maintenance" : "维护", text: cleanText };
}

export function summarizeCommitsAsReleaseEntry(pendingCommits = [], { remoteVersion = "", title = "", locale = "zh" } = {}) {
  const rawList = Array.isArray(pendingCommits) ? pendingCommits : [];
  if (rawList.length === 0) return null;
  const isEn = isEnglishReleaseLocale(locale);

  const isBumpCommit = (s) => /^(?:chore(?:\([^)]*\))?:\s*)?(?:bump(?:\s+version)?|release)\b|^版本发布(?:\s|$)/i.test(String(s || "").trim());
  const nonBump = rawList.filter((c) => !isBumpCommit(c?.subject));
  const chosen = (nonBump.length > 0 ? nonBump : rawList).slice(0, 8);

  const items = chosen
    .map((commit) => {
      const classified = classifyCommitSubject(commit?.subject || "", locale);
      if (!classified.text) return null;
      return {
        category: classified.category,
        categoryLabel: classified.categoryLabel,
        title: "",
        detail: classified.text,
        text: classified.text,
      };
    })
    .filter(Boolean);

  if (items.length === 0) return null;
  const newestTs = Number(chosen[0]?.timestamp) || 0;
  const dateStr = newestTs > 0 ? new Date(newestTs * 1000).toISOString().slice(0, 10) : "";
  const defaultTitle = isEn
    ? (remoteVersion ? `v${remoteVersion} Changes` : "Latest Code Updates")
    : (remoteVersion ? `v${remoteVersion} 更新内容` : "最新代码更新");

  return {
    id: remoteVersion ? `v${remoteVersion}` : "commits-fallback",
    heading: title || defaultTitle,
    version: String(remoteVersion || "").trim(),
    date: dateStr,
    title: title || defaultTitle,
    summary: "",
    items,
  };
}

function normalizeReleaseItemKey(item) {
  return String(item?.text || item?.detail || item?.title || "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export function computePendingReleaseNotes({
  localNotes = [],
  remoteNotes = [],
  localSource = "none",
  remoteSource = "none",
  pendingCommits = [],
  localVersion = "",
  remoteVersion = "",
  locale = "zh",
} = {}) {
  const localList = Array.isArray(localNotes) ? localNotes : [];
  const remoteList = Array.isArray(remoteNotes) ? remoteNotes : [];
  const commits = Array.isArray(pendingCommits) ? pendingCommits : [];

  if (remoteList.length === 0 && commits.length === 0) {
    return { pending: [], pendingSource: "none" };
  }

  // Case 1: Legacy installation lacks RELEASE_NOTES.md while remote introduces it.
  // Never dump the entire historical changelog — surface only newer versions (or top 1 entry).
  if (remoteSource === "release_notes" && localSource !== "release_notes" && remoteList.length > 0) {
    const newerEntries = localVersion
      ? remoteList.filter((entry) => entry.version && compareSemverParts(entry.version, localVersion) > 0)
      : [];
    const selected = (newerEntries.length > 0 ? newerEntries : [remoteList[0]]).slice(0, 3);
    return { pending: selected, pendingSource: "release_notes" };
  }

  if (remoteList.length > 0) {
    const localKeys = new Set(
      localList.map((entry) => entry.version || entry.heading).filter(Boolean),
    );
    const newEntries = [];
    for (const entry of remoteList) {
      const key = entry.version || entry.heading;
      if (key && localKeys.has(key)) break;
      newEntries.push(entry);
      if (newEntries.length >= 4) break;
    }
    if (newEntries.length > 0) {
      return {
        pending: newEntries,
        pendingSource: remoteSource === "changelog" ? "changelog" : "release_notes",
      };
    }

    // Case 2: Same top version updated in-place on remote (mid-version push on main).
    const remoteTop = remoteList[0];
    const localTop = localList.find((e) => (
      (remoteTop.version && e.version === remoteTop.version)
      || (remoteTop.heading && e.heading === remoteTop.heading)
    )) || localList[0];

    if (remoteTop && localTop) {
      const localItemKeys = new Set((localTop.items || []).map(normalizeReleaseItemKey).filter(Boolean));
      const addedItems = (remoteTop.items || []).filter((item) => {
        const key = normalizeReleaseItemKey(item);
        return key && !localItemKeys.has(key);
      });
      if (addedItems.length > 0) {
        return {
          pending: [{
            ...remoteTop,
            items: addedItems.slice(0, 12),
          }],
          pendingSource: remoteSource === "changelog" ? "changelog" : "release_notes",
        };
      }
      if (
        remoteTop.date !== localTop.date
        || remoteTop.title !== localTop.title
        || remoteTop.summary !== localTop.summary
      ) {
        return {
          pending: [remoteTop],
          pendingSource: remoteSource === "changelog" ? "changelog" : "release_notes",
        };
      }
    }
  }

  if (commits.length > 0) {
    const fallbackEntry = summarizeCommitsAsReleaseEntry(commits, { remoteVersion, locale });
    if (fallbackEntry) {
      return {
        pending: [fallbackEntry],
        pendingSource: "commits_fallback",
      };
    }
  }

  return { pending: [], pendingSource: "none" };
}

async function readLocalReleaseNotes(rootDir) {
  for (const candidate of [
    { file: RELEASE_NOTES_FILENAME, source: "release_notes" },
    { file: CHANGELOG_FILENAME, source: "changelog" },
  ]) {
    try {
      const raw = await readFile(resolve(rootDir, candidate.file), "utf8");
      const entries = parseReleaseNotes(raw);
      if (entries.length > 0) {
        return {
          file: candidate.file,
          source: candidate.source,
          entries,
        };
      }
    } catch {
      // Try next release notes file.
    }
  }
  return { file: "", source: "none", entries: [] };
}

async function readLocalReleaseNotesEn(rootDir) {
  try {
    const raw = await readFile(resolve(rootDir, RELEASE_NOTES_EN_FILENAME), "utf8");
    const entries = parseReleaseNotes(raw, { locale: "en" });
    if (entries.length > 0) {
      return {
        file: RELEASE_NOTES_EN_FILENAME,
        source: "release_notes",
        entries,
      };
    }
  } catch {
    // Missing RELEASE_NOTES.en.md falls back cleanly to RELEASE_NOTES.md or commit summary.
  }
  return { file: "", source: "none", entries: [] };
}

function clampCheckIntervalHours(value, fallback = DEFAULT_CHECK_INTERVAL_HOURS) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(MIN_CHECK_INTERVAL_HOURS, Math.min(MAX_CHECK_INTERVAL_HOURS, Math.round(num)));
}

function defaultGitRunner(rootDir, args, { env = process.env, platform = process.platform, timeoutMs = 20_000 } = {}) {
  const prepared = prepareCrossPlatformSpawn("git", ["-C", rootDir, ...args], {
    cwd: rootDir,
    env,
    timeout: timeoutMs,
    maxBuffer: 2 * 1024 * 1024,
  }, { platform });
  return execFileAsync(prepared.command, prepared.args, prepared.options);
}

function defaultNpmRunner(rootDir, args, { env = process.env, platform = process.platform, timeoutMs = 180_000 } = {}) {
  const prepared = prepareCrossPlatformSpawn("npm", args, {
    cwd: rootDir,
    env,
    timeout: timeoutMs,
    maxBuffer: 4 * 1024 * 1024,
  }, { platform });
  return execFileAsync(prepared.command, prepared.args, prepared.options);
}

export function detectManagedService({
  platform = process.platform,
  env = process.env,
  dataDir = defaultDataDir(env),
  homeDir = resolveUserHome(env, normalizePlatform(platform), os.homedir()),
} = {}) {
  const norm = normalizePlatform(platform);
  if (norm === "darwin") {
    const plistPath = resolve(homeDir, "Library", "LaunchAgents", "com.guuguo.agent-control.plist");
    return {
      managed: existsSync(plistPath),
      kind: "launchd",
      target: plistPath,
    };
  }
  if (norm === "linux") {
    const unitPath = resolve(homeDir, ".config", "systemd", "user", "agent-control.service");
    return {
      managed: existsSync(unitPath),
      kind: "systemd",
      target: unitPath,
    };
  }
  if (norm === "win32") {
    const vbsPath = resolve(dataDir, "bin", "run-hidden.vbs");
    return {
      managed: existsSync(vbsPath),
      kind: "schtasks",
      target: vbsPath,
    };
  }
  return { managed: false, kind: "", target: "" };
}

async function readManifestHash(rootDir) {
  const parts = [];
  for (const name of ["package.json", "package-lock.json"]) {
    try {
      const content = await readFile(resolve(rootDir, name), "utf8");
      parts.push(createHash("sha256").update(content).digest("hex"));
    } catch {
      parts.push("missing");
    }
  }
  return parts.join(":");
}

function decodeXmlEntities(text = "") {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'");
}

export function parsePlistStrings(xmlText = "") {
  const result = {};
  const pattern = /<key>([^<]+)<\/key>\s*<string>([^<]*)<\/string>/g;
  let matched = null;
  while ((matched = pattern.exec(String(xmlText || ""))) !== null) {
    const key = decodeXmlEntities(matched[1]).trim();
    if (!key) continue;
    result[key] = decodeXmlEntities(matched[2]).trim();
  }
  return result;
}

export async function computeDesktopSourceHash(rootDir = DEFAULT_APP_ROOT, packageVersion = "0.0.0") {
  const hash = createHash("sha256");
  hash.update(`${String(packageVersion || "0.0.0").trim()}\n`);
  const sorted = [...DESKTOP_SOURCE_FILES].sort();
  for (const rel of sorted) {
    hash.update(`-- ${rel} --\n`);
    try {
      const content = await readFile(resolve(rootDir, rel));
      hash.update(content);
    } catch {
      // Missing source file contributes empty body while preserving deterministic hash.
    }
    hash.update("\n");
  }
  return hash.digest("hex").slice(0, 12);
}

export function isSwiftcAvailable({ env = process.env, platform = process.platform } = {}) {
  if (normalizePlatform(platform) !== "darwin") return false;
  const resolved = resolveExecutableCrossPlatform({
    binaryName: "swiftc",
    candidates: ["/usr/bin/swiftc"],
    env,
    platform,
  });
  return Boolean(resolved);
}

export async function readInstalledDesktopAppInfo({
  rootDir = DEFAULT_APP_ROOT,
  packageVersion = "0.0.0",
  platform = process.platform,
  installDir = "",
  env = process.env,
} = {}) {
  const expectedVersion = String(packageVersion || "0.0.0").trim();
  const normPlatform = normalizePlatform(platform);

  if (normPlatform === "linux") {
    const homeDir = resolveUserHome(env, normPlatform);
    const xdgData = env?.XDG_DATA_HOME ? resolve(env.XDG_DATA_HOME) : resolve(homeDir, ".local", "share");
    const metaDir = resolve(installDir || env?.AGENT_CONTROL_APP_INSTALL_DIR || resolve(xdgData, "agent-control"));
    const metaPath = resolve(metaDir, "desktop-meta.json");
    const desktopFile = resolve(xdgData, "applications", "com.guuguo.AgentControl.desktop");
    const expectedHash = await computeDesktopSourceHash(rootDir, expectedVersion);
    const hasInstallScript = existsSync(resolve(rootDir, "desktop", "linux", "install-app.sh"));
    const canBuild = hasInstallScript;
    let meta = null;
    if (existsSync(metaPath)) {
      try {
        meta = JSON.parse((await readFile(metaPath, "utf8")).replace(/^\uFEFF/, ""));
      } catch {
        meta = null;
      }
    }
    const appPath = String(meta?.appPath || desktopFile);
    const launcherPath = String(meta?.launcherPath || "").trim();
    const installed = Boolean(meta || existsSync(desktopFile));
    if (!installed) {
      return {
        supported: true,
        installed: false,
        appPath,
        installedVersion: "",
        installedBuildNumber: "",
        installedHash: "",
        expectedVersion,
        expectedHash,
        repoRoot: "",
        state: "not_installed",
        needsUpdate: false,
        canBuild,
        reason: "尚未安装 Linux 桌面入口，可点击「构建桌面 App」安装（需 Python 3 + PyGObject + WebKitGTK 4.1）",
      };
    }
    const installedVersion = String(meta?.version || "").trim();
    const installedHash = String(meta?.buildHash || "").trim();
    const repoRoot = String(meta?.repoRoot || "").trim();
    const repoRootMismatch = Boolean(repoRoot && resolve(repoRoot) !== resolve(rootDir));
    let reason = "";
    let needsUpdate = false;
    if (!installedHash) {
      needsUpdate = true;
      reason = "旧版 Linux 桌面入口尚未包含构建指纹，建议重建以启用版本跟踪";
    } else if (installedVersion !== expectedVersion) {
      needsUpdate = true;
      reason = `桌面 App 版本（v${installedVersion || "未知"}）落后于当前服务版本（v${expectedVersion}）`;
    } else if (installedHash !== expectedHash) {
      needsUpdate = true;
      reason = "Linux 桌面端源码或安装脚本已更新，需要重新同步桌面入口";
    } else if (repoRootMismatch) {
      needsUpdate = true;
      reason = "桌面入口绑定的仓库路径与当前服务目录不一致";
    }
    return {
      supported: true,
      installed: true,
      appPath,
      launcherPath,
      installedVersion,
      installedBuildNumber: "",
      installedHash,
      expectedVersion,
      expectedHash,
      repoRoot,
      state: needsUpdate ? "outdated" : "up_to_date",
      needsUpdate,
      canBuild,
      reason,
    };
  }

  if (normPlatform === "win32") {
    const homeDir = resolveUserHome(env, normPlatform);
    const localBase = resolve(
      installDir
        || env?.AGENT_CONTROL_APP_INSTALL_DIR
        || (env?.LOCALAPPDATA ? resolve(env.LOCALAPPDATA, "AgentControl") : resolve(homeDir, "AppData", "Local", "AgentControl")),
    );
    const metaPath = resolve(localBase, "desktop-meta.json");
    const startMenuDir = env?.APPDATA
      ? resolve(env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs")
      : resolve(homeDir, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs");
    const startMenuShortcut = resolve(startMenuDir, "RemoteDeck.lnk");
    const legacyStartMenuShortcut = resolve(startMenuDir, "Agent Control.lnk");
    const expectedHash = await computeDesktopSourceHash(rootDir, expectedVersion);
    const hasInstallScript = existsSync(resolve(rootDir, "desktop", "windows", "install-app.ps1"));
    const canBuild = hasInstallScript;
    let meta = null;
    if (existsSync(metaPath)) {
      try {
        meta = JSON.parse((await readFile(metaPath, "utf8")).replace(/^\uFEFF/, ""));
      } catch {
        meta = null;
      }
    }
    const appPath = String(
      meta?.appPath
      || (existsSync(startMenuShortcut) ? startMenuShortcut : (existsSync(legacyStartMenuShortcut) ? legacyStartMenuShortcut : startMenuShortcut)),
    );
    const installed = Boolean(meta || existsSync(startMenuShortcut) || existsSync(legacyStartMenuShortcut));
    if (!installed) {
      return {
        supported: true,
        installed: false,
        appPath,
        installedVersion: "",
        installedBuildNumber: "",
        installedHash: "",
        expectedVersion,
        expectedHash,
        repoRoot: "",
        state: "not_installed",
        needsUpdate: false,
        canBuild,
        reason: "尚未安装 Windows 桌面 App 快捷入口，可点击「构建桌面 App」创建桌面与开始菜单独立窗口入口",
      };
    }
    const installedVersion = String(meta?.version || "").trim();
    const installedHash = String(meta?.buildHash || "").trim();
    const repoRoot = String(meta?.repoRoot || "").trim();
    const desktopPath = String(meta?.desktopPath || "").trim();
    const startMenuPath = String(meta?.startMenuPath || (existsSync(startMenuShortcut) ? startMenuShortcut : "")).trim();
    const iconPath = String(meta?.iconPath || "").trim();
    const launcherExePath = String(meta?.launcherExePath || "").trim();
    const launcherPath = String(meta?.launcherPath || "").trim();
    const browserPath = String(meta?.browserPath || "").trim();
    const browserArgs = Array.isArray(meta?.browserArgs) ? meta.browserArgs.map((arg) => String(arg)) : [];
    const repoRootMismatch = Boolean(repoRoot && resolve(repoRoot) !== resolve(rootDir));
    let reason = "";
    let needsUpdate = false;
    if (!installedHash) {
      needsUpdate = true;
      reason = "旧版 Windows 桌面入口尚未包含构建指纹，建议重建以启用版本跟踪";
    } else if (installedVersion !== expectedVersion) {
      needsUpdate = true;
      reason = `桌面 App 版本（v${installedVersion || "未知"}）落后于当前服务版本（v${expectedVersion}）`;
    } else if (installedHash !== expectedHash) {
      needsUpdate = true;
      reason = "Windows 桌面启动脚本或配置已更新，需要重新构建桌面入口";
    } else if (repoRootMismatch) {
      needsUpdate = true;
      reason = "桌面入口绑定的仓库路径与当前服务目录不一致";
    }
    return {
      supported: true,
      installed: true,
      appPath,
      desktopPath,
      startMenuPath,
      iconPath,
      launcherExePath,
      launcherPath,
      browserPath,
      browserArgs,
      installedVersion,
      installedBuildNumber: "",
      installedHash,
      expectedVersion,
      expectedHash,
      repoRoot,
      state: needsUpdate ? "outdated" : "up_to_date",
      needsUpdate,
      canBuild,
      reason,
    };
  }

  if (normPlatform !== "darwin") {
    return {
      supported: false,
      installed: false,
      appPath: "",
      installedVersion: "",
      installedBuildNumber: "",
      installedHash: "",
      expectedVersion,
      expectedHash: "",
      repoRoot: "",
      state: "unsupported",
      needsUpdate: false,
      canBuild: false,
      reason: "当前操作系统暂不支持桌面壳子更新",
    };
  }

  const targetInstallDir = resolve(installDir || env?.AGENT_CONTROL_APP_INSTALL_DIR || "/Applications");
  const appPath = resolve(targetInstallDir, DESKTOP_APP_NAME);
  const plistPath = resolve(appPath, "Contents", "Info.plist");
  const expectedHash = await computeDesktopSourceHash(rootDir, expectedVersion);
  const hasBuildScript = existsSync(resolve(rootDir, "desktop", "macos", "build-app.sh"));
  const canBuild = hasBuildScript && isSwiftcAvailable({ env, platform });

  if (!existsSync(appPath)) {
    return {
      supported: true,
      installed: false,
      appPath,
      installedVersion: "",
      installedBuildNumber: "",
      installedHash: "",
      expectedVersion,
      expectedHash,
      repoRoot: "",
      state: "not_installed",
      needsUpdate: false,
      canBuild,
      reason: `未在 ${targetInstallDir} 检测到 ${DESKTOP_APP_NAME}`,
    };
  }

  let plist = {};
  try {
    const rawPlist = await readFile(plistPath, "utf8");
    plist = parsePlistStrings(rawPlist);
  } catch {
    plist = {};
  }

  const installedVersion = String(plist.CFBundleShortVersionString || "").trim();
  const installedBuildNumber = String(plist.CFBundleVersion || "").trim();
  const installedHash = String(plist.AgentControlBuildHash || "").trim();
  const repoRoot = String(plist.AgentControlRepoRoot || "").trim();
  const repoRootMismatch = Boolean(repoRoot && resolve(repoRoot) !== resolve(rootDir));

  let reason = "";
  let needsUpdate = false;
  if (!installedHash) {
    needsUpdate = true;
    reason = "旧版桌面壳子尚未包含构建指纹，建议重建以启用壳子版本跟踪";
  } else if (installedVersion !== expectedVersion) {
    needsUpdate = true;
    reason = `桌面 App 版本（v${installedVersion || "未知"}）落后于当前服务版本（v${expectedVersion}）`;
  } else if (installedHash !== expectedHash) {
    needsUpdate = true;
    reason = "桌面端 Swift 源码或配置已更新，需要重新编译桌面 App";
  } else if (repoRootMismatch) {
    needsUpdate = true;
    reason = "桌面 App 绑定的仓库路径与当前服务目录不一致";
  }

  return {
    supported: true,
    installed: true,
    appPath,
    installedVersion,
    installedBuildNumber,
    installedHash,
    expectedVersion,
    expectedHash,
    repoRoot,
    state: needsUpdate ? "outdated" : "up_to_date",
    needsUpdate,
    canBuild,
    reason,
  };
}

export function resolveDesktopLaunchSpec({
  platform = process.platform,
  desktopApp = null,
  appPath = "",
  reason = "manual",
  existsSyncImpl = existsSync,
} = {}) {
  const norm = normalizePlatform(platform);
  if (norm === "win32") {
    if (reason !== "manual") return null;
    const lnkCandidates = [appPath, desktopApp?.appPath, desktopApp?.startMenuPath, desktopApp?.desktopPath]
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    const seen = new Set();
    for (const candidate of lnkCandidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      if (/\.lnk$/i.test(candidate) && existsSyncImpl(candidate)) {
        return {
          command: "explorer.exe",
          args: [candidate],
          windowsHide: true,
        };
      }
    }
    const launcherExePath = String(desktopApp?.launcherExePath || "").trim();
    if (launcherExePath && existsSyncImpl(launcherExePath)) {
      return {
        command: launcherExePath,
        args: [],
        windowsHide: false,
      };
    }
    const browserPath = String(desktopApp?.browserPath || "").trim();
    if (browserPath && existsSyncImpl(browserPath)) {
      return {
        command: browserPath,
        args: Array.isArray(desktopApp?.browserArgs) ? desktopApp.browserArgs.map((arg) => String(arg)) : [],
        windowsHide: false,
      };
    }
    const launcherPath = String(desktopApp?.launcherPath || "").trim();
    if (launcherPath && existsSyncImpl(launcherPath)) {
      return {
        command: "cmd.exe",
        args: ["/d", "/c", "start", "", launcherPath],
        windowsHide: true,
      };
    }
    return null;
  }

  if (norm === "linux") {
    if (reason !== "manual") return null;
    const launcherPath = String(desktopApp?.launcherPath || "").trim();
    if (launcherPath && existsSyncImpl(launcherPath)) {
      return {
        command: launcherPath,
        args: [],
        windowsHide: false,
      };
    }
    return null;
  }

  return null;
}

async function readLocalMeta(rootDir, platform, { desktopInstallDir = "", env = process.env } = {}) {
  let packageVersion = "0.0.0";
  try {
    const pkg = JSON.parse(await readFile(resolve(rootDir, "package.json"), "utf8"));
    if (pkg?.version) packageVersion = String(pkg.version).trim();
  } catch {
    // Ignore missing package.json in custom fixtures.
  }

  let uiVersion = "";
  try {
    const html = await readFile(resolve(rootDir, "public", "index.html"), "utf8");
    const matched = html.match(/<meta\s+name="ac-ui-version"\s+content="([^"]+)"/i);
    if (matched?.[1]) uiVersion = matched[1].trim();
  } catch {
    // Ignore missing index.html.
  }

  const desktopApp = await readInstalledDesktopAppInfo({
    rootDir,
    packageVersion,
    platform,
    installDir: desktopInstallDir,
    env,
  });

  return {
    packageVersion,
    uiVersion,
    hasDesktopApp: Boolean(desktopApp.installed),
    desktopApp,
  };
}

export class UpdateService {
  #rootDir;
  #dataDir;
  #env;
  #platform;
  #desktopInstallDir;
  #statePath;
  #execGit;
  #execNpm;
  #execDesktopBuild;
  #hasCustomDesktopBuild;
  #relaunchDesktopApp;
  #restartService;
  #onUnattendedRestart;
  #canAutoUpdateIdle;
  #onStatusChange;
  #initialDelayMs;
  #idleRetryMs;
  #restartDelayMs;
  #config = {
    autoCheckEnabled: true,
    autoUpdateEnabled: false,
    autoUpdateDesktopApp: true,
    checkIntervalHours: DEFAULT_CHECK_INTERVAL_HOURS,
  };
  #persisted = {
    lastCheckedAt: null,
    lastUpdatedAt: null,
    lastUpdatedFromSha: "",
    lastUpdatedToSha: "",
    lastError: "",
  };
  #repoInfo = {
    packageVersion: "0.0.0",
    uiVersion: "",
    isGitRepo: false,
    branch: "main",
    localSha: "",
    localShortSha: "",
    localCommitTime: 0,
    localCommitSubject: "",
    remoteName: "origin",
    remoteUrl: "",
    dirty: false,
    dirtyCount: 0,
    dirtySample: [],
    managedService: false,
    serviceKind: "",
    localReleaseNotesFile: "",
    localReleaseNotesSource: "none",
    localReleaseNotes: [],
    localReleaseNotesEnFile: "",
    localReleaseNotesEnSource: "none",
    localReleaseNotesEn: [],
    hasDesktopApp: false,
    desktopApp: {
      supported: false,
      installed: false,
      appPath: "",
      installedVersion: "",
      installedBuildNumber: "",
      installedHash: "",
      expectedVersion: "0.0.0",
      expectedHash: "",
      repoRoot: "",
      state: "unsupported",
      needsUpdate: false,
      canBuild: false,
      reason: "",
    },
  };
  #remoteInfo = {
    remoteSha: "",
    remoteShortSha: "",
    remoteCommitTime: 0,
    remoteCommitSubject: "",
    remoteVersion: "",
    behindCount: 0,
    aheadCount: 0,
    historyRewritten: false,
    pendingCommits: [],
    remoteReleaseNotesFile: "",
    remoteReleaseNotesSource: "none",
    remoteReleaseNotes: [],
    remoteReleaseNotesEnFile: "",
    remoteReleaseNotesEnSource: "none",
    remoteReleaseNotesEn: [],
  };
  #checking = false;
  #updating = false;
  #desktopUpdating = false;
  #desktopPhase = "idle";
  #desktopMessage = "";
  #phase = "idle";
  #phaseMessage = "";
  #restartPending = false;
  #desktopRebuildSuggested = false;
  #checkInFlight = null;
  #checkTimer = null;
  #initialTimer = null;
  #idleRetryTimer = null;
  #autoApplyPending = false;
  #closed = false;

  constructor({
    rootDir = DEFAULT_APP_ROOT,
    dataDir = defaultDataDir(),
    env = process.env,
    platform = process.platform,
    desktopInstallDir = "",
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    idleRetryMs = DEFAULT_IDLE_RETRY_MS,
    restartDelayMs = DEFAULT_RESTART_DELAY_MS,
    execGit = null,
    execNpm = null,
    execDesktopBuild = null,
    relaunchDesktopApp = null,
    restartService = null,
    onUnattendedRestart = null,
    canAutoUpdateIdle = null,
    onStatusChange = () => {},
  } = {}) {
    this.#rootDir = resolve(rootDir);
    this.#dataDir = dataDir;
    this.#env = env;
    this.#platform = platform;
    this.#desktopInstallDir = desktopInstallDir || env?.AGENT_CONTROL_APP_INSTALL_DIR || "";
    this.#statePath = dataDir ? updateStatePath(dataDir) : "";
    this.#initialDelayMs = Math.max(0, Number(initialDelayMs) || 0);
    this.#idleRetryMs = Math.max(50, Number(idleRetryMs) || DEFAULT_IDLE_RETRY_MS);
    this.#restartDelayMs = Math.max(0, Number(restartDelayMs) || 0);
    this.#execGit = execGit || ((args, opts) => defaultGitRunner(this.#rootDir, args, {
      env: this.#env,
      platform: this.#platform,
      ...opts,
    }));
    this.#execNpm = execNpm || ((args, opts) => defaultNpmRunner(this.#rootDir, args, {
      env: this.#env,
      platform: this.#platform,
      ...opts,
    }));
    this.#hasCustomDesktopBuild = typeof execDesktopBuild === "function";
    this.#execDesktopBuild = execDesktopBuild || ((opts) => this.#defaultExecDesktopBuild(opts));
    this.#relaunchDesktopApp = relaunchDesktopApp || ((opts) => this.#defaultRelaunchDesktopApp(opts));
    this.#restartService = restartService || ((ctx) => this.#defaultRestartService(ctx));
    this.#onUnattendedRestart = onUnattendedRestart;
    this.#canAutoUpdateIdle = canAutoUpdateIdle || (() => true);
    this.#onStatusChange = onStatusChange;
  }

  async #git(args, opts = {}) {
    const res = await this.#execGit(args, opts);
    return {
      stdout: String(res?.stdout || ""),
      stderr: String(res?.stderr || ""),
    };
  }

  async #saveState() {
    if (!this.#statePath) return;
    try {
      await mkdir(dirname(this.#statePath), { recursive: true, mode: 0o700 });
      const payload = {
        version: 1,
        ...this.#config,
        ...this.#persisted,
      };
      const tmp = `${this.#statePath}.tmp-${process.pid}-${Date.now()}`;
      await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tmp, this.#statePath);
    } catch {
      // Non-fatal persistence failure.
    }
  }

  async #inspectRepo() {
    const [meta, localRelease, localReleaseEn] = await Promise.all([
      readLocalMeta(this.#rootDir, this.#platform, {
        desktopInstallDir: this.#desktopInstallDir,
        env: this.#env,
      }),
      readLocalReleaseNotes(this.#rootDir),
      readLocalReleaseNotesEn(this.#rootDir),
    ]);
    const service = detectManagedService({
      platform: this.#platform,
      env: this.#env,
      dataDir: this.#dataDir,
    });
    const base = {
      ...meta,
      isGitRepo: false,
      branch: "main",
      localSha: "",
      localShortSha: "",
      localCommitTime: 0,
      localCommitSubject: "",
      remoteName: "origin",
      remoteUrl: "",
      dirty: false,
      dirtyCount: 0,
      dirtySample: [],
      managedService: service.managed,
      serviceKind: service.kind,
      localReleaseNotesFile: localRelease.file,
      localReleaseNotesSource: localRelease.source,
      localReleaseNotes: localRelease.entries,
      localReleaseNotesEnFile: localReleaseEn.file,
      localReleaseNotesEnSource: localReleaseEn.source,
      localReleaseNotesEn: localReleaseEn.entries,
    };

    try {
      const inside = await this.#git(["rev-parse", "--is-inside-work-tree"], { timeoutMs: 5_000 });
      if (inside.stdout.trim() !== "true") {
        this.#repoInfo = base;
        return base;
      }
      base.isGitRepo = true;

      const [branchRes, shaRes, logRes, remoteRes, statusRes] = await Promise.all([
        this.#git(["rev-parse", "--abbrev-ref", "HEAD"], { timeoutMs: 5_000 }).catch(() => ({ stdout: "main" })),
        this.#git(["rev-parse", "HEAD"], { timeoutMs: 5_000 }).catch(() => ({ stdout: "" })),
        this.#git(["log", "-1", "--format=%h%n%ct%n%s"], { timeoutMs: 5_000 }).catch(() => ({ stdout: "" })),
        this.#git(["remote", "get-url", "origin"], { timeoutMs: 5_000 }).catch(() => ({ stdout: "" })),
        this.#git(["status", "--porcelain"], { timeoutMs: 8_000 }).catch(() => ({ stdout: "" })),
      ]);

      const rawBranch = branchRes.stdout.trim();
      base.branch = (rawBranch && rawBranch !== "HEAD") ? rawBranch : "main";
      base.localSha = shaRes.stdout.trim();
      const [shortSha = "", tsStr = "0", subject = ""] = logRes.stdout.split(/\r?\n/);
      base.localShortSha = shortSha.trim() || base.localSha.slice(0, 7);
      base.localCommitTime = Number(tsStr) || 0;
      base.localCommitSubject = subject.trim();
      base.remoteUrl = sanitizeRemoteUrl(remoteRes.stdout);
      const dirtyInfo = parsePorcelainDirtyFiles(statusRes.stdout);
      base.dirty = dirtyInfo.dirty;
      base.dirtyCount = dirtyInfo.dirtyCount;
      base.dirtySample = dirtyInfo.dirtySample;
    } catch {
      // Keep base snapshot if git metadata is unreadable.
    }

    this.#repoInfo = base;
    return base;
  }

  #resolveUpdateState() {
    if (!this.#repoInfo.isGitRepo || !this.#repoInfo.remoteUrl) {
      return "unavailable";
    }
    if (this.#remoteInfo.behindCount > 0 && this.#remoteInfo.aheadCount > 0) {
      return "diverged";
    }
    if (this.#remoteInfo.behindCount > 0) {
      return "available";
    }
    return "up_to_date";
  }

  statusSnapshot() {
    const updateState = this.#resolveUpdateState();
    const hasUpdate = updateState === "available" || updateState === "diverged";
    const canApply = Boolean(
      this.#repoInfo.isGitRepo
      && this.#repoInfo.remoteUrl
      && this.#remoteInfo.behindCount > 0
      && this.#remoteInfo.aheadCount === 0
      && !this.#repoInfo.dirty
      && !this.#updating,
    );
    const {
      localReleaseNotesFile,
      localReleaseNotesSource,
      localReleaseNotes,
      localReleaseNotesEnFile,
      localReleaseNotesEnSource,
      localReleaseNotesEn,
      ...publicRepoInfo
    } = this.#repoInfo;
    const {
      remoteReleaseNotesFile,
      remoteReleaseNotesSource,
      remoteReleaseNotes,
      remoteReleaseNotesEnFile,
      remoteReleaseNotesEnSource,
      remoteReleaseNotesEn,
      ...publicRemoteInfo
    } = this.#remoteInfo;
    const localNotes = Array.isArray(localReleaseNotes) ? localReleaseNotes : [];
    const remoteNotes = Array.isArray(remoteReleaseNotes) ? remoteReleaseNotes : [];
    const localEnNotes = Array.isArray(localReleaseNotesEn) ? localReleaseNotesEn : [];
    const remoteEnNotes = Array.isArray(remoteReleaseNotesEn) ? remoteReleaseNotesEn : [];
    const pendingResult = (hasUpdate && this.#remoteInfo.behindCount > 0)
      ? computePendingReleaseNotes({
        localNotes,
        remoteNotes,
        localSource: localReleaseNotesSource,
        remoteSource: remoteReleaseNotesSource,
        pendingCommits: this.#remoteInfo.pendingCommits,
        localVersion: this.#repoInfo.packageVersion,
        remoteVersion: this.#remoteInfo.remoteVersion,
      })
      : { pending: [], pendingSource: "none" };
    const pendingEnResult = (hasUpdate && this.#remoteInfo.behindCount > 0)
      ? computePendingReleaseNotes({
        localNotes: localEnNotes,
        remoteNotes: remoteEnNotes,
        localSource: localReleaseNotesEnSource,
        remoteSource: remoteReleaseNotesEnSource,
        pendingCommits: this.#remoteInfo.pendingCommits,
        localVersion: this.#repoInfo.packageVersion,
        remoteVersion: this.#remoteInfo.remoteVersion,
        locale: "en",
      })
      : { pending: [], pendingSource: "none" };

    const zhBucket = {
      file: localReleaseNotesFile || remoteReleaseNotesFile || "",
      current: localNotes[0] || null,
      recent: localNotes.slice(0, 4),
      remote: remoteNotes[0] || null,
      pending: pendingResult.pending,
      pendingSource: pendingResult.pendingSource,
    };
    const hasEnBucket = localEnNotes.length > 0 || remoteEnNotes.length > 0 || pendingEnResult.pending.length > 0;
    const enBucket = hasEnBucket
      ? {
        file: localReleaseNotesEnFile || remoteReleaseNotesEnFile || "",
        current: localEnNotes[0] || null,
        recent: localEnNotes.slice(0, 4),
        remote: remoteEnNotes[0] || null,
        pending: pendingEnResult.pending,
        pendingSource: pendingEnResult.pendingSource,
      }
      : null;

    return {
      ...publicRepoInfo,
      ...publicRemoteInfo,
      ...this.#config,
      ...this.#persisted,
      updateState,
      hasUpdate,
      canApply,
      checking: this.#checking,
      updating: this.#updating,
      desktopUpdating: this.#desktopUpdating,
      desktopPhase: this.#desktopPhase,
      desktopMessage: this.#desktopMessage,
      phase: this.#phase,
      phaseMessage: this.#phaseMessage,
      restartPending: this.#restartPending,
      desktopRebuildSuggested: this.#desktopRebuildSuggested,
      releaseNotes: {
        ...zhBucket,
        ...(enBucket ? { locales: { en: enBucket } } : {}),
      },
    };
  }

  #emitStatus() {
    const snap = this.statusSnapshot();
    try {
      this.#onStatusChange(snap);
    } catch {
      // Ignore listener errors.
    }
    return snap;
  }

  async load() {
    if (this.#statePath) {
      try {
        const parsed = JSON.parse(await readFile(this.#statePath, "utf8"));
        if (parsed && typeof parsed === "object") {
          if (typeof parsed.autoCheckEnabled === "boolean") {
            this.#config.autoCheckEnabled = parsed.autoCheckEnabled;
          }
          if (typeof parsed.autoUpdateEnabled === "boolean") {
            this.#config.autoUpdateEnabled = parsed.autoUpdateEnabled;
          }
          if (typeof parsed.autoUpdateDesktopApp === "boolean") {
            this.#config.autoUpdateDesktopApp = parsed.autoUpdateDesktopApp;
          }
          if (parsed.checkIntervalHours !== undefined) {
            this.#config.checkIntervalHours = clampCheckIntervalHours(parsed.checkIntervalHours);
          }
          if (parsed.lastCheckedAt) this.#persisted.lastCheckedAt = Number(parsed.lastCheckedAt) || null;
          if (parsed.lastUpdatedAt) this.#persisted.lastUpdatedAt = Number(parsed.lastUpdatedAt) || null;
          if (parsed.lastUpdatedFromSha) this.#persisted.lastUpdatedFromSha = String(parsed.lastUpdatedFromSha);
          if (parsed.lastUpdatedToSha) this.#persisted.lastUpdatedToSha = String(parsed.lastUpdatedToSha);
          if (parsed.lastError) this.#persisted.lastError = String(parsed.lastError);
        }
      } catch {
        // Use defaults when persisted update state is absent.
      }
    }
    await this.#inspectRepo();
    await this.#readRemoteComparison().catch(() => {});
    return this.statusSnapshot();
  }

  async #readRemoteComparison() {
    if (!this.#repoInfo.isGitRepo || !this.#repoInfo.remoteUrl) return;
    const remoteRef = `origin/${this.#repoInfo.branch}`;
    const shaRes = await this.#git(["rev-parse", remoteRef], { timeoutMs: 5_000 }).catch(() => null);
    const remoteSha = shaRes?.stdout?.trim() || "";
    if (!remoteSha) return;

    const [remoteLogRes, aheadBehindRes, commitsRes, remotePkgRes, remoteNotesRes, remoteNotesEnRes, remoteChangelogRes] = await Promise.all([
      this.#git(["log", "-1", "--format=%h%n%ct%n%s", remoteRef], { timeoutMs: 5_000 }).catch(() => ({ stdout: "" })),
      this.#git(["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`], { timeoutMs: 5_000 }).catch(() => ({ stdout: "0 0" })),
      this.#git(["log", "--format=%h%x09%ct%x09%s", "-n", "10", `HEAD..${remoteRef}`], { timeoutMs: 5_000 }).catch(() => ({ stdout: "" })),
      this.#git(["show", `${remoteRef}:package.json`], { timeoutMs: 5_000 }).catch(() => ({ stdout: "" })),
      this.#git(["show", `${remoteRef}:${RELEASE_NOTES_FILENAME}`], { timeoutMs: 5_000 }).catch(() => ({ stdout: "" })),
      this.#git(["show", `${remoteRef}:${RELEASE_NOTES_EN_FILENAME}`], { timeoutMs: 5_000 }).catch(() => ({ stdout: "" })),
      this.#git(["show", `${remoteRef}:${CHANGELOG_FILENAME}`], { timeoutMs: 5_000 }).catch(() => ({ stdout: "" })),
    ]);

    const [shortSha = "", tsStr = "0", subject = ""] = remoteLogRes.stdout.split(/\r?\n/);
    const counts = aheadBehindRes.stdout.trim().split(/\s+/);
    let aheadCount = Number(counts[0]) || 0;
    const behindCount = Number(counts[1]) || 0;

    // Diverged because upstream rewrote history: if our HEAD is a known official pre-rewrite
    // commit, we have no local work of our own and may realign with a hard reset.
    let historyRewritten = false;
    if (aheadCount > 0 && behindCount > 0 && this.#repoInfo.localSha) {
      const mapRes = await this.#git(["show", `${remoteRef}:${HISTORY_REWRITE_FILENAME}`], { timeoutMs: 5_000 }).catch(() => ({ stdout: "" }));
      try {
        const oldShas = JSON.parse(mapRes.stdout || "{}")?.oldShas;
        if (Array.isArray(oldShas) && oldShas.includes(this.#repoInfo.localSha)) {
          historyRewritten = true;
          aheadCount = 0;
        }
      } catch {
        // Ignore malformed rewrite map.
      }
    }
    const pendingCommits = commitsRes.stdout
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [sha = "", ts = "0", ...rest] = line.split("\t");
        return {
          sha: sha.trim(),
          timestamp: Number(ts) || 0,
          subject: rest.join("\t").trim(),
        };
      })
      .filter((item) => item.sha || item.subject);

    let remoteVersion = "";
    try {
      if (remotePkgRes.stdout.trim()) {
        const parsedPkg = JSON.parse(remotePkgRes.stdout);
        if (parsedPkg?.version) remoteVersion = String(parsedPkg.version).trim();
      }
    } catch {
      // Ignore invalid remote package.json.
    }

    let remoteReleaseNotesFile = "";
    let remoteReleaseNotesSource = "none";
    let remoteReleaseNotes = [];
    const parsedRemoteNotes = parseReleaseNotes(remoteNotesRes.stdout);
    if (parsedRemoteNotes.length > 0) {
      remoteReleaseNotesFile = RELEASE_NOTES_FILENAME;
      remoteReleaseNotesSource = "release_notes";
      remoteReleaseNotes = parsedRemoteNotes;
    } else {
      const parsedRemoteChangelog = parseReleaseNotes(remoteChangelogRes.stdout);
      if (parsedRemoteChangelog.length > 0) {
        remoteReleaseNotesFile = CHANGELOG_FILENAME;
        remoteReleaseNotesSource = "changelog";
        remoteReleaseNotes = parsedRemoteChangelog;
      }
    }

    let remoteReleaseNotesEnFile = "";
    let remoteReleaseNotesEnSource = "none";
    let remoteReleaseNotesEn = [];
    const parsedRemoteNotesEn = parseReleaseNotes(remoteNotesEnRes.stdout, { locale: "en" });
    if (parsedRemoteNotesEn.length > 0) {
      remoteReleaseNotesEnFile = RELEASE_NOTES_EN_FILENAME;
      remoteReleaseNotesEnSource = "release_notes";
      remoteReleaseNotesEn = parsedRemoteNotesEn;
    }

    this.#remoteInfo = {
      remoteSha,
      remoteShortSha: shortSha.trim() || remoteSha.slice(0, 7),
      remoteCommitTime: Number(tsStr) || 0,
      remoteCommitSubject: subject.trim(),
      remoteVersion,
      behindCount,
      aheadCount,
      historyRewritten,
      pendingCommits,
      remoteReleaseNotesFile,
      remoteReleaseNotesSource,
      remoteReleaseNotes,
      remoteReleaseNotesEnFile,
      remoteReleaseNotesEnSource,
      remoteReleaseNotesEn,
    };
  }

  #clearTimers() {
    if (this.#initialTimer) {
      clearTimeout(this.#initialTimer);
      this.#initialTimer = null;
    }
    if (this.#checkTimer) {
      clearInterval(this.#checkTimer);
      this.#checkTimer = null;
    }
    if (this.#idleRetryTimer) {
      clearTimeout(this.#idleRetryTimer);
      this.#idleRetryTimer = null;
    }
  }

  #rescheduleTimers() {
    this.#clearTimers();
    if (this.#closed || !this.#config.autoCheckEnabled) return;
    const intervalMs = this.#config.checkIntervalHours * 3_600_000;
    this.#checkTimer = setInterval(() => {
      void this.checkForUpdates({ silent: true }).catch(() => {});
    }, intervalMs);
    this.#checkTimer.unref?.();
  }

  start() {
    if (this.#closed) return;
    this.#rescheduleTimers();
    if (this.#config.autoCheckEnabled && this.#initialDelayMs >= 0) {
      this.#initialTimer = setTimeout(() => {
        this.#initialTimer = null;
        void this.checkForUpdates({ silent: true }).catch(() => {});
      }, this.#initialDelayMs);
      this.#initialTimer.unref?.();
    }
  }

  #scheduleIdleAutoApply(delayMs = this.#idleRetryMs) {
    if (this.#closed || this.#idleRetryTimer || !this.#config.autoUpdateEnabled) return;
    this.#idleRetryTimer = setTimeout(() => {
      this.#idleRetryTimer = null;
      void this.#tryAutoApplyWhenIdle();
    }, Math.max(0, Number(delayMs) || 0));
    this.#idleRetryTimer.unref?.();
  }

  async #tryAutoApplyWhenIdle() {
    if (this.#closed || !this.#config.autoUpdateEnabled || this.#updating) {
      this.#autoApplyPending = false;
      return;
    }
    if (this.#remoteInfo.behindCount <= 0 || this.#remoteInfo.aheadCount > 0 || this.#repoInfo.dirty) {
      this.#autoApplyPending = false;
      return;
    }
    let isIdle = false;
    try {
      isIdle = Boolean(await this.#canAutoUpdateIdle());
    } catch {
      isIdle = false;
    }
    if (!isIdle) {
      this.#autoApplyPending = true;
      this.#scheduleIdleAutoApply(this.#idleRetryMs);
      return;
    }
    this.#autoApplyPending = false;
    await this.applyUpdate({ reason: "auto" }).catch(() => {});
  }

  async configure(patch = {}) {
    if (patch && typeof patch === "object") {
      if (typeof patch.autoCheckEnabled === "boolean") {
        this.#config.autoCheckEnabled = patch.autoCheckEnabled;
      }
      if (typeof patch.autoUpdateEnabled === "boolean") {
        this.#config.autoUpdateEnabled = patch.autoUpdateEnabled;
        if (!patch.autoUpdateEnabled) {
          this.#autoApplyPending = false;
        }
      }
      if (typeof patch.autoUpdateDesktopApp === "boolean") {
        this.#config.autoUpdateDesktopApp = patch.autoUpdateDesktopApp;
      }
      if (patch.checkIntervalHours !== undefined) {
        this.#config.checkIntervalHours = clampCheckIntervalHours(
          patch.checkIntervalHours,
          this.#config.checkIntervalHours,
        );
      }
    }
    await this.#saveState();
    this.#rescheduleTimers();
    const snap = this.#emitStatus();
    if (this.#config.autoUpdateEnabled && this.#remoteInfo.behindCount > 0 && this.#remoteInfo.aheadCount === 0 && !this.#repoInfo.dirty) {
      this.#scheduleIdleAutoApply(this.#idleRetryMs);
    }
    return snap;
  }

  async checkForUpdates({ silent = false, triggerAutoApply = true } = {}) {
    if (this.#checkInFlight) return this.#checkInFlight;

    let shouldTriggerAutoApply = false;
    this.#checkInFlight = (async () => {
      this.#checking = true;
      if (!this.#updating) {
        this.#phase = "checking";
        this.#phaseMessage = "正在检查远端更新…";
      }
      if (!silent) this.#emitStatus();

      try {
        await this.#inspectRepo();
        if (!this.#repoInfo.isGitRepo || !this.#repoInfo.remoteUrl) {
          this.#persisted.lastCheckedAt = Date.now();
          this.#persisted.lastError = "";
          if (!this.#updating) {
            this.#phase = "idle";
            this.#phaseMessage = "";
          }
          await this.#saveState();
          return this.#emitStatus();
        }

        await this.#git(["fetch", "--quiet", "origin", this.#repoInfo.branch], { timeoutMs: 25_000 });
        await this.#readRemoteComparison();

        this.#persisted.lastCheckedAt = Date.now();
        this.#persisted.lastError = "";
        if (!this.#updating) {
          this.#phase = "idle";
          this.#phaseMessage = "";
        }
        await this.#saveState();
        const snap = this.#emitStatus();

        if (
          triggerAutoApply
          && this.#config.autoUpdateEnabled
          && snap.behindCount > 0
          && snap.aheadCount === 0
          && !snap.dirty
          && !this.#updating
        ) {
          shouldTriggerAutoApply = true;
        }
        return snap;
      } catch (error) {
        const message = String(error?.stderr || error?.message || "检查更新失败").trim();
        this.#persisted.lastCheckedAt = Date.now();
        this.#persisted.lastError = message;
        if (!this.#updating) {
          this.#phase = "error";
          this.#phaseMessage = message;
        }
        await this.#saveState();
        this.#emitStatus();
        if (!silent) {
          throw Object.assign(new Error(message), { status: 502 });
        }
        return this.statusSnapshot();
      } finally {
        this.#checking = false;
        if (!this.#updating && this.#phase === "checking") {
          this.#phase = "idle";
          this.#phaseMessage = "";
        }
        this.#checkInFlight = null;
      }
    })();

    const result = await this.#checkInFlight;
    if (shouldTriggerAutoApply && !this.#closed) {
      this.#scheduleIdleAutoApply(0);
    }
    return result;
  }

  async #defaultExecDesktopBuild({ installDir = "" } = {}) {
    const normPlatform = normalizePlatform(this.#platform);
    const expectedVersion = this.#repoInfo?.packageVersion || "0.0.0";
    const expectedHash = await computeDesktopSourceHash(this.#rootDir, expectedVersion);
    const env = {
      ...this.#env,
      ...(installDir ? { AGENT_CONTROL_APP_INSTALL_DIR: installDir } : {}),
      AGENT_CONTROL_APP_VERSION: expectedVersion,
      AGENT_CONTROL_BUILD_HASH: expectedHash,
    };
    if (normPlatform === "linux") {
      const installScript = resolve(this.#rootDir, "desktop", "linux", "install-app.sh");
      const prepared = prepareCrossPlatformSpawn("bash", [installScript], {
        cwd: this.#rootDir,
        env,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      }, { platform: this.#platform });
      return execFileAsync(prepared.command, prepared.args, prepared.options);
    }
    if (normPlatform === "win32") {
      const psScript = resolve(this.#rootDir, "desktop", "windows", "install-app.ps1");
      const port = String(this.#env?.PORT || "43310").trim() || "43310";
      const psArgs = [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        psScript,
        "-Port",
        port,
        "-AppVersion",
        expectedVersion,
        "-BuildHash",
        expectedHash,
      ];
      if (installDir) {
        psArgs.push("-InstallDir", installDir);
      }
      const prepared = prepareCrossPlatformSpawn("powershell", psArgs, {
        cwd: this.#rootDir,
        env,
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      }, { platform: this.#platform });
      return execFileAsync(prepared.command, prepared.args, prepared.options);
    }
    const buildScript = resolve(this.#rootDir, "desktop", "macos", "build-app.sh");
    const prepared = prepareCrossPlatformSpawn("bash", [buildScript, "--install"], {
      cwd: this.#rootDir,
      env,
      timeout: 240_000,
      maxBuffer: 4 * 1024 * 1024,
    }, { platform: this.#platform });
    return execFileAsync(prepared.command, prepared.args, prepared.options);
  }

  async #defaultRelaunchDesktopApp({ appPath = "", desktopApp = null, reason = "manual" } = {}) {
    const norm = normalizePlatform(this.#platform);
    if (norm === "win32" || norm === "linux") {
      const launchSpec = resolveDesktopLaunchSpec({
        platform: norm,
        desktopApp,
        appPath,
        reason,
      });
      if (!launchSpec) {
        return { relaunched: false, reason: reason === "manual" ? "launcher_not_found" : "auto_sync_skipped" };
      }
      try {
        const prepared = prepareCrossPlatformSpawn(launchSpec.command, launchSpec.args, {
          cwd: this.#rootDir,
          env: this.#env,
          detached: true,
          stdio: "ignore",
          windowsHide: launchSpec.windowsHide,
        }, { platform: this.#platform });
        const child = spawn(prepared.command, prepared.args, prepared.options);
        child.unref?.();
        return { relaunched: true };
      } catch {
        return { relaunched: false };
      }
    }

    if (norm !== "darwin" || !appPath || !existsSync(appPath)) {
      return { relaunched: false };
    }
    try {
      const check = await execFileAsync("pgrep", ["-f", "Agent Control.app/Contents/MacOS/AgentControl"], {
        timeout: 3_000,
      }).catch(() => null);
      const pids = String(check?.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => /^\d+$/.test(line));
      if (!pids.length && reason !== "manual") {
        return { relaunched: false, reason: "not_running" };
      }
      if (pids.length) {
        await execFileAsync("osascript", ["-e", 'tell application id "com.guuguo.agent-control.desktop" to quit'], {
          timeout: 4_000,
        }).catch(() => {});
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 600));
        const stillRunning = await execFileAsync("pgrep", ["-f", "Agent Control.app/Contents/MacOS/AgentControl"], {
          timeout: 3_000,
        }).catch(() => null);
        if (String(stillRunning?.stdout || "").trim()) {
          await execFileAsync("pkill", ["-f", "Agent Control.app/Contents/MacOS/AgentControl"], {
            timeout: 3_000,
          }).catch(() => {});
          await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
        }
      }
      const prepared = prepareCrossPlatformSpawn("open", ["-a", appPath], {
        cwd: this.#rootDir,
        env: this.#env,
        detached: true,
        stdio: "ignore",
      }, { platform: this.#platform });
      const child = spawn(prepared.command, prepared.args, prepared.options);
      child.unref?.();
      return { relaunched: true };
    } catch {
      return { relaunched: false };
    }
  }

  async #runDesktopBuildAndInstall({ reason = "manual", relaunchIfRunning = true } = {}) {
    const normPlatform = normalizePlatform(this.#platform);
    this.#desktopUpdating = true;
    this.#desktopPhase = "building";
    this.#desktopMessage = normPlatform === "win32"
      ? "正在构建并安装最新 Windows 桌面 App…"
      : (normPlatform === "linux" ? "正在安装最新 Linux 桌面 App…" : "正在编译并安装最新 macOS 桌面 App…");
    this.#emitStatus();

    try {
      await this.#execDesktopBuild({
        rootDir: this.#rootDir,
        installDir: this.#desktopInstallDir,
        reason,
      });
      await this.#inspectRepo();
      this.#desktopRebuildSuggested = false;
      this.#desktopPhase = "done";
      const installedVer = this.#repoInfo.desktopApp?.installedVersion || this.#repoInfo.packageVersion;
      if (normPlatform === "win32") {
        if (reason === "manual") {
          this.#desktopMessage = relaunchIfRunning
            ? `桌面 App 已更新至 v${installedVer}，已创建桌面与开始菜单快捷方式并正在打开`
            : `桌面 App 已更新至 v${installedVer}，已创建桌面与开始菜单快捷方式（未自动打开）`;
        } else {
          this.#desktopMessage = `桌面 App 已更新至 v${installedVer}，已同步桌面与开始菜单快捷方式`;
        }
      } else {
        this.#desktopMessage = reason === "manual" && !relaunchIfRunning
          ? `桌面 App 已更新至 v${installedVer}（未自动打开）`
          : `桌面 App 已更新至 v${installedVer}`;
      }
      this.#emitStatus();

      if (relaunchIfRunning) {
        const timer = setTimeout(() => {
          void Promise.resolve(this.#relaunchDesktopApp({
            appPath: this.#repoInfo.desktopApp?.appPath,
            desktopApp: this.#repoInfo.desktopApp,
            reason,
          })).catch(() => {});
        }, Math.min(400, this.#restartDelayMs || 350));
        timer.unref?.();
      }

      return {
        ok: true,
        rebuilt: true,
        desktopApp: this.#repoInfo.desktopApp,
        message: this.#desktopMessage,
      };
    } catch (error) {
      const msg = String(error?.stderr || error?.message || "桌面 App 编译失败").trim();
      this.#desktopPhase = "error";
      this.#desktopMessage = msg;
      this.#emitStatus();
      throw Object.assign(new Error(msg), { status: Number(error?.status) || 500 });
    } finally {
      this.#desktopUpdating = false;
    }
  }

  async applyDesktopUpdate({ reason = "manual", relaunchIfRunning = true, openAfterBuild } = {}) {
    if (this.#updating || this.#desktopUpdating) {
      throw Object.assign(new Error("正在执行更新，请稍候完成"), { status: 409 });
    }
    const normPlatform = normalizePlatform(this.#platform);
    if (!["darwin", "linux", "win32"].includes(normPlatform)) {
      throw Object.assign(new Error("当前操作系统暂不支持更新桌面 App 壳子"), { status: 400 });
    }
    await this.#inspectRepo();
    const info = this.#repoInfo.desktopApp;
    if (!this.#hasCustomDesktopBuild && !info?.canBuild) {
      const hint = normPlatform === "darwin"
        ? "未检测到 Xcode Command Line Tools (swiftc) 或桌面构建脚本，无法在本机重编 App"
        : "未检测到桌面构建脚本，无法在本机更新桌面 App";
      throw Object.assign(new Error(hint), {
        status: 400,
      });
    }
    const shouldOpen = typeof openAfterBuild === "boolean" ? openAfterBuild : Boolean(relaunchIfRunning);
    const res = await this.#runDesktopBuildAndInstall({ reason, relaunchIfRunning: shouldOpen });
    return {
      ...res,
      status: this.statusSnapshot(),
    };
  }

  async applyUpdate({ reason = "manual" } = {}) {
    if (this.#updating || this.#desktopUpdating) {
      throw Object.assign(new Error("正在更新中，请稍候完成"), { status: 409 });
    }

    this.#updating = true;
    try {
      await this.checkForUpdates({ silent: reason === "auto", triggerAutoApply: false });
      const preSnap = this.statusSnapshot();

      if (!preSnap.isGitRepo || !preSnap.remoteUrl) {
        throw Object.assign(new Error("当前安装目录不是可在线拉取的 Git 仓库，请通过 install.sh 重新安装或手动升级"), {
          status: 400,
        });
      }
      if (preSnap.dirty) {
        const msg = `检测到本地存在 ${preSnap.dirtyCount} 项未提交改动（${preSnap.dirtySample.join("、")}），为避免覆盖开发修改已暂停更新`;
        this.#persisted.lastError = msg;
        this.#phase = "error";
        this.#phaseMessage = msg;
        await this.#saveState();
        this.#emitStatus();
        throw Object.assign(new Error(msg), { status: 409 });
      }
      if (preSnap.aheadCount > 0) {
        const msg = `当前分支领先远端 ${preSnap.aheadCount} 个提交，无法 fast-forward 自动合并，请在本机手动执行 git pull --rebase`;
        this.#persisted.lastError = msg;
        this.#phase = "error";
        this.#phaseMessage = msg;
        await this.#saveState();
        this.#emitStatus();
        throw Object.assign(new Error(msg), { status: 409 });
      }
      if (preSnap.behindCount === 0) {
        this.#phase = "idle";
        this.#phaseMessage = "";
        return {
          ok: true,
          updated: false,
          message: "当前已是最新版本",
          status: this.#emitStatus(),
        };
      }

      const fromSha = preSnap.localSha;
      this.#persisted.lastError = "";
      this.#phase = "pulling";
      this.#phaseMessage = `正在拉取 ${preSnap.behindCount} 个新提交…`;
      this.#emitStatus();

      const beforeHash = await readManifestHash(this.#rootDir);
      if (this.#remoteInfo.historyRewritten) {
        await this.#git(["reset", "--hard", `origin/${preSnap.branch}`], { timeoutMs: 45_000 });
      } else {
        await this.#git(["pull", "--ff-only", "origin", preSnap.branch], { timeoutMs: 45_000 });
      }
      const afterHash = await readManifestHash(this.#rootDir);
      const needsNpmInstall = beforeHash !== afterHash || !existsSync(resolve(this.#rootDir, "node_modules"));

      if (needsNpmInstall) {
        this.#phase = "installing";
        this.#phaseMessage = "检测到依赖变更，正在更新运行依赖…";
        this.#emitStatus();
        await this.#execNpm(["install", "--omit=dev", "--no-audit", "--no-fund"], { timeoutMs: 180_000 });
      }

      await this.#inspectRepo();
      await this.#readRemoteComparison().catch(() => {});

      const toSha = this.#repoInfo.localSha;
      const normPlatform = normalizePlatform(this.#platform);
      const desktopDirPrefix = normPlatform === "win32"
        ? "desktop/windows/"
        : (normPlatform === "linux" ? "desktop/linux/" : "desktop/macos/");
      let desktopChanged = false;
      if (fromSha && toSha && fromSha !== toSha && this.#repoInfo.hasDesktopApp) {
        const diffRes = await this.#git(["diff", "--name-only", fromSha, toSha], { timeoutMs: 5_000 }).catch(() => ({ stdout: "" }));
        desktopChanged = diffRes.stdout.split(/\r?\n/).some((line) => line.startsWith(desktopDirPrefix));
      }

      let desktopRebuilt = false;
      const desktopInfo = this.#repoInfo.desktopApp;
      const shouldAutoSyncDesktop = Boolean(
        this.#config.autoUpdateDesktopApp
        && desktopInfo?.supported
        && desktopInfo?.installed
        && (desktopInfo?.needsUpdate || desktopChanged)
        && (this.#hasCustomDesktopBuild || desktopInfo?.canBuild),
      );
      if (shouldAutoSyncDesktop) {
        this.#phase = "building_desktop";
        this.#phaseMessage = "代码已更新，正在同步编译最新桌面 App…";
        this.#emitStatus();
        try {
          await this.#runDesktopBuildAndInstall({
            reason: `sync:${reason}`,
            relaunchIfRunning: true,
          });
          desktopRebuilt = true;
        } catch {
          // Do not block service restart if Swift desktop rebuild fails.
          this.#desktopRebuildSuggested = true;
        }
      } else {
        this.#desktopRebuildSuggested = Boolean(desktopChanged || (desktopInfo?.installed && desktopInfo?.needsUpdate));
      }

      this.#persisted.lastUpdatedAt = Date.now();
      this.#persisted.lastUpdatedFromSha = fromSha;
      this.#persisted.lastUpdatedToSha = toSha;
      this.#persisted.lastError = "";
      this.#restartPending = true;
      this.#phase = "restarting";
      this.#phaseMessage = desktopRebuilt
        ? "代码与桌面 App 已同步更新，正在平滑重启服务…"
        : "新版本已就绪，正在平滑重启服务…";
      await this.#saveState();
      this.#updating = false;
      const postSnap = this.#emitStatus();

      const timer = setTimeout(() => {
        void Promise.resolve(this.#restartService({
          reason,
          fromSha,
          toSha,
          desktopChanged,
          desktopRebuilt,
          managedService: this.#repoInfo.managedService,
          serviceKind: this.#repoInfo.serviceKind,
        })).catch(() => {});
      }, this.#restartDelayMs);
      timer.unref?.();

      return {
        ok: true,
        updated: true,
        restarting: true,
        fromSha,
        toSha,
        desktopRebuilt,
        desktopRebuildSuggested: this.#desktopRebuildSuggested,
        message: desktopRebuilt
          ? "新版本与桌面 App 壳子均已更新，服务正在重启，页面将在重连后自动刷新"
          : "新版本拉取完成，服务正在重启，页面将在重连后自动刷新",
        status: postSnap,
      };
    } catch (error) {
      const msg = String(error?.stderr || error?.message || "更新失败").trim();
      this.#persisted.lastError = msg;
      this.#restartPending = false;
      this.#phase = "error";
      this.#phaseMessage = msg;
      await this.#saveState();
      this.#emitStatus();
      throw Object.assign(new Error(msg), { status: Number(error?.status) || 500 });
    } finally {
      this.#updating = false;
    }
  }

  async restartService({ reason = "manual" } = {}) {
    if (this.#updating || this.#restartPending) {
      throw Object.assign(new Error("当前正在更新或重启中，请稍候"), { status: 409 });
    }
    this.#persisted.lastError = "";
    this.#restartPending = true;
    this.#phase = "restarting";
    this.#phaseMessage = "正在平滑重启后台服务…";
    await this.#saveState();
    const postSnap = this.#emitStatus();

    const timer = setTimeout(() => {
      void Promise.resolve(this.#restartService({
        reason,
        managedService: this.#repoInfo.managedService,
        serviceKind: this.#repoInfo.serviceKind,
      })).catch(() => {});
    }, this.#restartDelayMs);
    timer.unref?.();

    return {
      ok: true,
      restarting: true,
      message: "后台服务正在重启，页面将在重连后自动恢复",
      status: postSnap,
    };
  }

  async #defaultRestartService() {
    const service = detectManagedService({
      platform: this.#platform,
      env: this.#env,
      dataDir: this.#dataDir,
    });
    if (service.managed) {
      const serviceScript = resolve(this.#rootDir, "scripts", "service.mjs");
      const prepared = prepareCrossPlatformSpawn(process.execPath, [serviceScript, "restart"], {
        cwd: this.#rootDir,
        env: this.#env,
        detached: true,
        stdio: "ignore",
      }, { platform: this.#platform });
      const child = spawn(prepared.command, prepared.args, prepared.options);
      child.unref?.();
      return;
    }
    if (typeof this.#onUnattendedRestart === "function") {
      await this.#onUnattendedRestart();
    }
    const serverEntry = resolve(this.#rootDir, "src", "server.mjs");
    const prepared = prepareCrossPlatformSpawn(process.execPath, resolveServerNodeArgs(serverEntry), {
      cwd: this.#rootDir,
      env: this.#env,
      detached: true,
      stdio: "ignore",
    }, { platform: this.#platform });
    const child = spawn(prepared.command, prepared.args, prepared.options);
    child.unref?.();
    process.exit(0);
  }

  close() {
    this.#closed = true;
    this.#clearTimers();
  }
}
