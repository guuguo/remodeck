import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { defaultDataDir } from "./instance-identity.mjs";
import { MemoryVault, getSection, parseTable, resolveVaultPath, today as vaultToday } from "./memory-vault.mjs";
import {
  execFileCrossPlatform,
  killProcessTreeCrossPlatform,
  normalizeWorkspacePath,
  prepareCrossPlatformSpawn,
} from "./platform.mjs";
import { claudeEnvironment, claudeExecutable, readClaudeCliAuthStatus } from "./providers/claude-runner.mjs";
import { resolveProviderExecutables } from "./providers/profile-discovery.mjs";
import { AssistantService } from "./assistant-service.mjs";
import { harvestEvidenceForThread, isInternalAssistantThread, threadTail } from "./assistant-signals.mjs";

export const DOMAINS_SCHEMA_VERSION = 3;
export const DEFAULT_OVERVIEW_COOLDOWN_MS = 30 * 60 * 1000;
export const DEFAULT_ACTIVE_WINDOW_SEC = 7 * 24 * 3600;
export const DEFAULT_SPARK_WINDOW_SEC = 14 * 24 * 3600;

export const DEFAULT_LANDMARK_BY_TOPIC = Object.freeze({});

const GENERIC_LANDMARK_CYCLE = Object.freeze([
  "radar",
  "gears",
  "obelisk",
  "lighthouse",
  "comic",
  "cinema",
  "youtube",
  "shield",
  "phone",
  "cat",
  "cottage",
  "bullchart",
  "tower",
]);

function inferLandmarkForTopic(topic = {}, index = 0) {
  const hay = `${topic.id || ""} ${topic.name || ""} ${topic.description || ""} ${(topic.keywords || []).join(" ")}`.toLowerCase();
  if (/(radar|control|panel|monitor|agent)/.test(hay)) return "radar";
  if (/(security|auth|proxy|browser|shield|guard)/.test(hay)) return "shield";
  if (/(mobile|app|ios|android|phone)/.test(hay)) return "phone";
  if (/(video|movie|drama|studio|cinema|media)/.test(hay)) return "cinema";
  if (/(youtube|tiktok|social|publish|channel)/.test(hay)) return "youtube";
  if (/(stock|finance|trade|chart|quant|analytics)/.test(hay)) return "bullchart";
  if (/(comic|manga|image|design|ui)/.test(hay)) return "comic";
  if (/(home|house|game|3d|scene)/.test(hay)) return "cottage";
  if (/(web|site|hub|docs|blog|seo)/.test(hay)) return "lighthouse";
  if (/(cli|tool|sdk|lib|plugin|engine|core)/.test(hay)) return "gears";
  return GENERIC_LANDMARK_CYCLE[index % GENERIC_LANDMARK_CYCLE.length];
}

export const OVERVIEW_MODEL_OPTIONS = Object.freeze([
  { key: "auto", label: "自动优选 (3.8 Flash / Hydrogen / Terra / Sonnet)", provider: "auto", model: "" },
  { key: "antigravity:gemini-3.8-flash", label: "Gemini 3.8 Flash", provider: "antigravity", model: "gemini-3.8-flash" },
  { key: "antigravity:gemini-4-hydrogen", label: "Gemini 4 Hydrogen", provider: "antigravity", model: "gemini-4-hydrogen" },
  { key: "codex:gpt-6.1-terra", label: "GPT-6.1 Terra", provider: "codex", model: "gpt-6.1-terra" },
  { key: "claude:claude-sonnet-5-5", label: "Claude Sonnet 5.5", provider: "claude", model: "claude-sonnet-5-5" },
]);

export const DEFAULT_DISPATCH_PLANNER_MODEL = "antigravity:gemini-3.8-flash";

/**
 * Resolve ordered lightweight model candidates with optional provider filtering,
 * single-shot-per-provider deduplication, and attempt cap.
 */
export function selectLightweightModelCandidates({
  preferredModel = "auto",
  fallbackToAuto = false,
  availableProviders = null,
  dedupeByProvider = false,
  maxAttempts = 0,
} = {}) {
  const autoCandidates = [
    OVERVIEW_MODEL_OPTIONS.find((o) => o.key === "antigravity:gemini-3.8-flash"),
    OVERVIEW_MODEL_OPTIONS.find((o) => o.key === "antigravity:gemini-4-hydrogen"),
    OVERVIEW_MODEL_OPTIONS.find((o) => o.key === "codex:gpt-6.1-terra"),
    OVERVIEW_MODEL_OPTIONS.find((o) => o.key === "claude:claude-sonnet-5-5"),
  ].filter(Boolean);

  let candidates = preferredModel && preferredModel !== "auto"
    ? [OVERVIEW_MODEL_OPTIONS.find((o) => o.key === preferredModel)].filter(Boolean)
    : autoCandidates;

  if (fallbackToAuto && preferredModel && preferredModel !== "auto") {
    const seenKeys = new Set(candidates.map((c) => c.key));
    candidates = [...candidates, ...autoCandidates.filter((c) => !seenKeys.has(c.key))];
  }

  if (availableProviders) {
    const allowed = availableProviders instanceof Set
      ? availableProviders
      : new Set(Array.isArray(availableProviders) ? availableProviders : []);
    if (allowed.size > 0) {
      const filtered = candidates.filter((c) => allowed.has(c.provider));
      if (filtered.length > 0) {
        candidates = filtered;
      }
    }
  }

  if (dedupeByProvider) {
    const seenProviders = new Set();
    candidates = candidates.filter((c) => {
      if (seenProviders.has(c.provider)) return false;
      seenProviders.add(c.provider);
      return true;
    });
  }

  if (maxAttempts > 0) {
    candidates = candidates.slice(0, Math.max(1, maxAttempts));
  }
  return candidates;
}

export const PIPELINE_STAGES = Object.freeze([
  { index: 1, key: "init", label: "立项" },
  { index: 2, key: "build", label: "研发" },
  { index: 3, key: "polish", label: "打磨" },
  { index: 4, key: "launch", label: "宣发" },
  { index: 5, key: "harvest", label: "收菜" },
]);

export const YIELD_META = Object.freeze({
  coin: { label: "直接金币变现", priority: 4 },
  growth: { label: "涨粉引流飞轮", priority: 3 },
  bounty: { label: "委托稳底盘", priority: 2 },
  shield: { label: "出海护航底座", priority: 1 },
});

export const DEFAULT_MISSION_DOMAINS = Object.freeze([
  { id: "indie-lab", code: "LAB 01", name: "软件产品研发室", shortName: "软件研发室", order: 1 },
  { id: "drama-studio", code: "STUDIO 02", name: "内容与创作工坊", shortName: "内容工坊", order: 2 },
  { id: "global-pub", code: "GLOBAL 03", name: "发布与增长部", shortName: "发布增长部", order: 3 },
  { id: "bounty-guild", code: "GUILD 04", name: "专项与运维所", shortName: "专项运维所", order: 4 },
]);

const LEGACY_DOMAIN_MAP = Object.freeze({
  "creative-products": "indie-lab",
  "drama-overseas": "drama-studio",
  "work-support": "bounty-guild",
  "special-projects": "bounty-guild",
});

// Source code ships with zero hardcoded personal projects; user topics are
// persisted in `<dataDir>/mission-domains.json` or auto-discovered from local workspaces.
export const DEFAULT_MISSION_TOPICS = Object.freeze([]);

const FEATURE_FOOTPRINT_RULES = Object.freeze([
  { label: "语音助手", pattern: /语音|voice|whisper|tts|asr|免提|播报/i },
  { label: "主题皮肤", pattern: /主题|日间模式|深色模式|dark\s*mode|light\s*mode|css|ui/i },
  { label: "总控面板", pattern: /总览|看板|dashboard|mission-overview|3d/i },
  { label: "远程服务", pattern: /隧道|tunnel|proxy|relay|中继|websocket|api/i },
  { label: "多开实例", pattern: /多开|profile|实例|配额|quota|cli/i },
  { label: "音视频制作", pattern: /视频|动画|剪辑|字幕|ffmpeg|remotion|blender/i },
  { label: "增长与SEO", pattern: /seo|sitemap|推广|增长|营销|landing/i },
  { label: "商业化变现", pattern: /支付|订阅|订单|变现|license|pricing|stripe/i },
  { label: "多语言i18n", pattern: /多语言|国际化|i18n|locale|translation/i },
  { label: "线上排查", pattern: /排查|日志|报错|异常|debug|bugfix|hotfix/i },
  { label: "测试与CI", pattern: /test|测试|ci|workflow|lint|build|deploy/i },
  { label: "脚本与文档", pattern: /脚本|文档|readme|docs|spec|plan/i },
]);

function toEpochSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function normPath(p) {
  return normalizeWorkspacePath(String(p || "").trim());
}

function pathMatchesPrefix(targetPath, prefix) {
  const cleanTarget = normPath(targetPath);
  const cleanPrefix = normPath(prefix);
  if (!cleanTarget || !cleanPrefix) return false;
  if (cleanTarget === cleanPrefix) return true;
  const sep = cleanPrefix.includes("\\") ? "\\" : "/";
  const normalizedPrefix = cleanPrefix.endsWith(sep) ? cleanPrefix : `${cleanPrefix}${sep}`;
  return cleanTarget.startsWith(normalizedPrefix);
}

export function isCwdCoveredByTopics(cwd = "", topics = []) {
  const clean = normPath(cwd);
  if (!clean) return false;
  return (Array.isArray(topics) ? topics : []).some((topic) => (
    (topic?.primaryCwd && pathMatchesPrefix(clean, topic.primaryCwd))
    || (Array.isArray(topic?.cwdPrefixes) && topic.cwdPrefixes.some((p) => pathMatchesPrefix(clean, p)))
  ));
}

export function isNonProjectDiscoveryCwd(cwd = "", existingTopics = []) {
  const clean = normPath(cwd);
  if (!clean || clean === "/" || isScratchNoiseCwd(clean)) return true;
  const homeNorm = normPath(os.homedir());
  if (homeNorm && clean === homeNorm) return true;
  const tmpNorm = normPath(os.tmpdir());
  if (tmpNorm && (clean === tmpNorm || pathMatchesPrefix(clean, tmpNorm))) return true;
  const slash = clean.replace(/\\/g, "/");
  if (
    /^\/(?:private\/)?tmp(?:\/|$)/i.test(slash)
    || /^\/var\/tmp(?:\/|$)/i.test(slash)
    || /^\/(?:private\/)?var\/folders\/[^/]+\/[^/]+\/T(?:\/|$)/i.test(slash)
    || /(?:^|[\\/])AppData[\\/]Local[\\/]Temp(?:[\\/]|$)/i.test(clean)
    || /^[a-z]:\\Temp(?:\\|$)/i.test(clean)
  ) {
    return true;
  }
  if (/^\/(?:Users|home)\/[^/]+$/i.test(slash) || /^[a-z]:\\Users\\[^\\]+$/i.test(clean)) {
    return true;
  }
  for (const topic of Array.isArray(existingTopics) ? existingTopics : []) {
    for (const p of [topic?.primaryCwd, ...(topic?.cwdPrefixes || [])]) {
      const existingPath = normPath(p);
      if (existingPath && existingPath !== clean && pathMatchesPrefix(existingPath, clean)) {
        return true;
      }
    }
  }
  return false;
}

const FOLDER_ACRONYM_MAP = Object.freeze({
  ai: "AI",
  api: "API",
  cli: "CLI",
  ui: "UI",
  ux: "UX",
  mcp: "MCP",
  sdk: "SDK",
  seo: "SEO",
  saas: "SaaS",
  ios: "iOS",
  macos: "macOS",
  llm: "LLM",
  rag: "RAG",
  "3d": "3D",
  "2d": "2D",
  ci: "CI",
  cd: "CD",
  e2e: "E2E",
  pwa: "PWA",
  crm: "CRM",
  tts: "TTS",
  asr: "ASR",
  ocr: "OCR",
  sql: "SQL",
  url: "URL",
  dns: "DNS",
  ssh: "SSH",
  hls: "HLS",
  cdn: "CDN",
});

const GENERIC_TITLE_PLACEHOLDERS = new Set([
  "agents", "agents.md", "claude", "claude.md", "readme", "readme.md",
  "untitled", "document", "vite + react", "vite + react + ts",
  "react app", "next.js app", "create react app",
]);

const GENERIC_LATIN_STOP_WORDS = new Set([
  "app", "web", "src", "docs", "demo", "test", "mvp",
  "readme", "agents", "claude", "index", "home",
]);

const GENERIC_AGGREGATE_KEYS = new Set([
  "app", "web", "frontend", "backend", "server", "client", "api", "docs",
  "demo", "test", "src", "main", "project", "tool", "tools", "home", "index",
  "应用", "项目", "前端", "后端", "测试", "工具", "文档",
]);

const TRAILING_STATUS_PAREN_RE = /\s*[（(]\s*(?:MVP|WIP|Beta|Alpha|Draft|Demo|Prototype|v\d+(?:\.\d+)*)\s*[）)]\s*$/i;
const INNER_STATUS_ONLY_RE = /^(?:MVP|WIP|Beta|Alpha|Draft|Demo|Prototype|v\d+(?:\.\d+)*)$/i;
const DOC_TITLE_PREFIX_RE = /^(?:AGENTS(?:\.md)?|CLAUDE(?:\.md)?|README(?:\.(?:zh(?:-CN|-TW)?|en|ja|ko))?(?:\.md)?)\s*(?:[-—–:|｜·/]\s*)?/i;

export function normalizeDiscoveryLocale(raw = "") {
  const first = String(raw || "")
    .split(",")[0]
    .split(";")[0]
    .split(".")[0]
    .trim()
    .replace(/_/g, "-")
    .toLowerCase();
  if (!first || first === "c" || first === "posix") return "";
  if (first.startsWith("zh")) return "zh";
  if (first.startsWith("en")) return "en";
  if (first.startsWith("ja")) return "ja";
  if (first.startsWith("ko")) return "ko";
  return "";
}

export function humanizeRepoFolderName(folderName = "") {
  const clean = String(folderName || "").trim();
  if (!clean) return "";
  if (/[\u4e00-\u9fff]/.test(clean)) return clean;
  const parts = clean.split(/[-_\s]+/).filter(Boolean);
  if (!parts.length) return clean;
  return parts.map((part) => {
    const low = part.toLowerCase();
    if (FOLDER_ACRONYM_MAP[low]) return FOLDER_ACRONYM_MAP[low];
    if (/[a-z]/.test(part) && /[A-Z]/.test(part)) return part;
    if (/^\d+$/.test(part)) return part;
    return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
  }).join(" ");
}

function cleanTitleFragment(raw = "") {
  return String(raw || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[#*`_\s\p{Extended_Pictographic}\u2600-\u27BF]+/gu, "")
    .replace(/[#*`_\s]+$/g, "")
    .trim();
}

function splitStrongTitleSegments(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return [];
  const pipePair = trimmed.match(/^([^｜|]+?)\s*[｜|]\s*([^｜|]+?)$/);
  if (pipePair) {
    const left = pipePair[1].replace(TRAILING_STATUS_PAREN_RE, "").trim();
    const right = pipePair[2].replace(TRAILING_STATUS_PAREN_RE, "").trim();
    if (
      /[\u4e00-\u9fff]/.test(left)
      && /[\u4e00-\u9fff]/.test(right)
      && !/[｜|]/.test(left)
      && right.length >= 2
      && right.length <= 12
      && (left.length > right.length || /[·•]/.test(left))
    ) {
      return [right, left];
    }
  }
  return trimmed
    .split(/\s+[—–-]\s+|\s*[｜|]\s*|\s*[：:]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function extractBilingualNameCandidates(rawTitle = "") {
  let clean = cleanTitleFragment(rawTitle);
  if (!clean) return { zh: [], en: [] };
  clean = clean.replace(DOC_TITLE_PREFIX_RE, "").trim();
  clean = clean.replace(/^[#*`_\s—–\-:|｜·/]+/, "").trim();
  if (!clean || GENERIC_TITLE_PLACEHOLDERS.has(clean.toLowerCase())) {
    return { zh: [], en: [] };
  }
  clean = clean.replace(TRAILING_STATUS_PAREN_RE, "").trim();
  if (!clean || GENERIC_TITLE_PLACEHOLDERS.has(clean.toLowerCase())) {
    return { zh: [], en: [] };
  }

  const expanded = [];
  for (const seg of splitStrongTitleSegments(clean)) {
    const strippedSeg = seg.replace(TRAILING_STATUS_PAREN_RE, "").trim();
    if (!strippedSeg) continue;
    const parenMatch = strippedSeg.match(/^(.+?)\s*[（(]([^()（）]+)[）)]\s*$/);
    if (parenMatch) {
      const outer = parenMatch[1].replace(TRAILING_STATUS_PAREN_RE, "").trim();
      const inner = parenMatch[2].replace(TRAILING_STATUS_PAREN_RE, "").trim();
      if (outer) expanded.push(outer);
      if (inner && !INNER_STATUS_ONLY_RE.test(inner) && inner.length <= 26) {
        for (const sub of splitStrongTitleSegments(inner)) {
          if (sub) expanded.push(sub);
        }
      }
    } else {
      expanded.push(strippedSeg);
    }
  }

  const zh = [];
  const en = [];
  const seenZh = new Set();
  const seenEn = new Set();

  for (const rawSeg of expanded) {
    const seg = rawSeg.replace(/^["'“”‘’]+|["'“”‘’，。.;；!?！？]+$/g, "").trim();
    if (!seg || GENERIC_TITLE_PLACEHOLDERS.has(seg.toLowerCase())) continue;
    if (/[\u4e00-\u9fff]/.test(seg)) {
      let candidate = seg;
      if (Array.from(candidate).length > 20 && /[·•]/.test(candidate)) {
        const sub = candidate
          .split(/\s*[·•]\s*/)
          .map((s) => s.trim())
          .find((s) => {
            const len = Array.from(s).length;
            return len >= 2 && len <= 20 && !/[。；;!?！？]/.test(s);
          });
        if (sub) candidate = sub;
      }
      if (Array.from(candidate).length <= 24 && !/[。；;!?！？]/.test(candidate)) {
        const key = candidate.toLowerCase();
        if (!seenZh.has(key)) {
          seenZh.add(key);
          zh.push(candidate);
        }
      }
      continue;
    }
    if (/[A-Za-z]{2,}/.test(seg)) {
      const words = seg.split(/\s+/).filter(Boolean);
      if (seg.length <= 36 && words.length <= 6 && !GENERIC_LATIN_STOP_WORDS.has(seg.toLowerCase())) {
        const key = seg.toLowerCase();
        if (!seenEn.has(key)) {
          seenEn.add(key);
          en.push(seg);
        }
      }
    }
  }

  return { zh, en };
}

async function readHeadText(filePath, maxBytes = 4096) {
  let fh = null;
  try {
    fh = await open(filePath, "r");
    const buf = Buffer.allocUnsafe(maxBytes);
    const { bytesRead } = await fh.read(buf, 0, maxBytes, 0);
    return buf.toString("utf8", 0, bytesRead);
  } catch {
    return "";
  } finally {
    await fh?.close?.().catch(() => {});
  }
}

function decodeHtmlEntities(text = "") {
  return String(text || "")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&mdash;/gi, "—")
    .replace(/&ndash;/gi, "–")
    .replace(/&middot;/gi, "·");
}

function safeParseJsonFields(rawText = "", keys = []) {
  if (!rawText) return {};
  try {
    const parsed = JSON.parse(rawText);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {}
  const out = {};
  for (const key of keys) {
    const re = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`);
    const m = rawText.match(re);
    if (m) {
      try {
        out[key] = JSON.parse(`"${m[1]}"`);
      } catch {
        out[key] = m[1];
      }
    }
  }
  return out;
}

function extractMarkdownHeadingTitle(rawText = "") {
  if (!rawText) return "";
  const lines = String(rawText).replace(/\r\n/g, "\n").split("\n");
  let idx = 0;
  if (lines[0]?.trim() === "---") {
    for (let i = 1; i < lines.length; i += 1) {
      if (lines[i].trim() === "---") {
        idx = i + 1;
        break;
      }
    }
  }
  let inFence = false;
  let fenceChar = "";
  const keptLines = [];
  for (let i = idx; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const ch = fenceMatch[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = ch;
      } else if (ch === fenceChar) {
        inFence = false;
        fenceChar = "";
      }
      continue;
    }
    if (!inFence) keptLines.push(line);
  }
  const body = keptLines.join("\n");
  const mdMatch = body.match(/^#\s+(.+)$/m);
  const htmlMatch = body.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const mdIdx = mdMatch?.index ?? Number.POSITIVE_INFINITY;
  const htmlIdx = htmlMatch?.index ?? Number.POSITIVE_INFINITY;
  if (mdIdx === Number.POSITIVE_INFINITY && htmlIdx === Number.POSITIVE_INFINITY) return "";
  if (mdIdx <= htmlIdx && mdMatch) return decodeHtmlEntities(mdMatch[1].trim());
  return htmlMatch ? decodeHtmlEntities(htmlMatch[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) : "";
}

function extractHtmlTitle(rawText = "") {
  const m = String(rawText || "").match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return "";
  return decodeHtmlEntities(m[1].replace(/\s+/g, " ").trim());
}

export async function readRepoMetadata(cwd = "") {
  const cleanCwd = normPath(cwd);
  if (!cleanCwd) return { zh: "", en: "", aliases: [] };
  const folderLower = (basename(cleanCwd) || "").trim().toLowerCase();

  const relFiles = [
    "project.config.json",
    "package.json",
    "manifest.json",
    "extension/manifest.json",
    "public/manifest.webmanifest",
    "AGENTS.md",
    "CLAUDE.md",
    "README.zh-CN.md",
    "README.zh.md",
    "README.md",
    "README.en.md",
    "index.html",
    "web/index.html",
    "public/index.html",
  ];
  const contents = await Promise.all(
    relFiles.map((rel) => readHeadText(join(cleanCwd, rel), 4096)),
  );
  const byRel = Object.fromEntries(relFiles.map((rel, i) => [rel, contents[i]]));

  const rawTitles = [];
  if (byRel["project.config.json"]) {
    const cfg = safeParseJsonFields(byRel["project.config.json"], ["projectname"]);
    let pname = String(cfg.projectname || "").trim();
    if (pname && /%[0-9a-f]{2}/i.test(pname)) {
      try {
        pname = decodeURIComponent(pname);
      } catch {}
    }
    if (pname && pname.toLowerCase() !== folderLower) {
      rawTitles.push(pname);
    }
  }

  if (byRel["package.json"]) {
    const pkg = safeParseJsonFields(byRel["package.json"], ["displayName", "productName"]);
    for (const val of [pkg.displayName, pkg.productName]) {
      const s = String(val || "").trim();
      if (s) rawTitles.push(s);
    }
  }

  for (const rel of ["manifest.json", "extension/manifest.json", "public/manifest.webmanifest"]) {
    if (!byRel[rel]) continue;
    const mf = safeParseJsonFields(byRel[rel], ["name", "short_name"]);
    for (const val of [mf.name, mf.short_name]) {
      const s = String(val || "").trim();
      if (s && !/^__MSG_.+__$/i.test(s)) rawTitles.push(s);
    }
  }

  for (const rel of ["AGENTS.md", "CLAUDE.md", "README.zh-CN.md", "README.zh.md", "README.md", "README.en.md"]) {
    const heading = extractMarkdownHeadingTitle(byRel[rel]);
    if (heading) rawTitles.push(heading);
  }

  for (const rel of ["index.html", "web/index.html", "public/index.html"]) {
    const title = extractHtmlTitle(byRel[rel]);
    if (title) rawTitles.push(title);
  }

  let zh = "";
  let en = "";
  const allCandidates = [];
  const seen = new Set();
  for (const rawTitle of rawTitles) {
    const { zh: zhList, en: enList } = extractBilingualNameCandidates(rawTitle);
    for (const item of zhList) {
      if (!zh) zh = item;
      const k = item.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        allCandidates.push(item);
      }
    }
    for (const item of enList) {
      if (!en) en = item;
      const k = item.toLowerCase();
      if (!seen.has(k)) {
        seen.add(k);
        allCandidates.push(item);
      }
    }
  }
  const aliases = allCandidates.filter((item) => item !== zh && item !== en).slice(0, 6);
  return { zh, en, aliases };
}

export function inferThreadsDominantLang(threads = []) {
  let zhCount = 0;
  let enCount = 0;
  for (const t of Array.isArray(threads) ? threads : []) {
    const title = String(t?.title || "").trim();
    if (!title) continue;
    if (/[\u4e00-\u9fff]/.test(title)) zhCount += 1;
    else if (/[A-Za-z]/.test(title)) enCount += 1;
  }
  if (zhCount > 0 && zhCount >= enCount) return "zh";
  if (enCount > 0) return "en";
  return "";
}

function inferRepeatedChineseThreadPrefix(threads = []) {
  const byPrefix = new Map();
  for (const t of Array.isArray(threads) ? threads : []) {
    const title = String(t?.title || "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    const m = title.match(/^([^\s｜|][^｜|]{1,15}?)\s*[｜|]\s*(.+)$/);
    if (!m) continue;
    const prefix = m[1].trim();
    const len = Array.from(prefix).length;
    if (len < 2 || len > 12 || !/[\u4e00-\u9fff]/.test(prefix)) continue;
    if (/^(?:修复|排查|实现|优化|新增|重构|检查|更新|测试|帮我|请)/.test(prefix)) continue;
    let set = byPrefix.get(prefix);
    if (!set) {
      set = new Set();
      byPrefix.set(prefix, set);
    }
    set.add(title);
  }
  let best = "";
  let bestCount = 0;
  for (const [prefix, titles] of byPrefix.entries()) {
    if (titles.size >= 2 && titles.size > bestCount) {
      best = prefix;
      bestCount = titles.size;
    }
  }
  return best;
}

export function resolveLocalizedWorkspaceNames({
  folderName = "",
  vaultCard = null,
  projectAlias = "",
  repoMeta = null,
  threads = [],
  locale = "",
} = {}) {
  let sysLocale = "";
  try {
    sysLocale = normalizeDiscoveryLocale(Intl.DateTimeFormat().resolvedOptions().locale || "");
  } catch {}
  const lang = normalizeDiscoveryLocale(locale) || inferThreadsDominantLang(threads) || sysLocale || "zh";

  let tier1Zh = "";
  let tier1En = "";
  for (const explicitName of [vaultCard?.name, projectAlias]) {
    const clean = String(explicitName || "").trim();
    if (!clean) continue;
    const { zh: zList, en: eList } = extractBilingualNameCandidates(clean);
    if (zList.length || eList.length) {
      if (!tier1Zh && zList[0]) tier1Zh = zList[0];
      if (!tier1En && eList[0]) tier1En = eList[0];
    } else if (/[\u4e00-\u9fff]/.test(clean)) {
      if (!tier1Zh) tier1Zh = clean;
    } else if (/[A-Za-z0-9]/.test(clean)) {
      if (!tier1En) tier1En = clean;
    }
  }

  const tier2Zh = String(repoMeta?.zh || "").trim();
  const tier2En = String(repoMeta?.en || "").trim();
  const threadZh = inferRepeatedChineseThreadPrefix(threads);
  const cleanFolder = String(folderName || "").trim();
  const folderZh = /[\u4e00-\u9fff]/.test(cleanFolder) ? cleanFolder : "";
  const folderEn = !folderZh && /[A-Za-z]/.test(cleanFolder) ? humanizeRepoFolderName(cleanFolder) : "";

  const zh = tier1Zh || tier2Zh || folderZh || threadZh || "";
  const en = tier1En || tier2En || (!tier1Zh ? folderEn : "") || "";
  const name = lang === "zh"
    ? (zh || en || folderEn || cleanFolder)
    : (en || zh || folderEn || cleanFolder);
  const names = {
    ...(zh ? { zh } : {}),
    ...(en ? { en } : {}),
  };

  const aliasSet = new Set();
  const aliases = [];
  for (const candidate of [
    ...(Array.isArray(repoMeta?.aliases) ? repoMeta.aliases : []),
    ...(Array.isArray(vaultCard?.aliases) ? vaultCard.aliases : []),
    projectAlias,
  ]) {
    const s = String(candidate || "").trim();
    if (!s || s === name || s === zh || s === en) continue;
    const k = s.toLowerCase();
    if (!aliasSet.has(k)) {
      aliasSet.add(k);
      aliases.push(s);
    }
  }

  return { name, names, lang, aliases: aliases.slice(0, 6) };
}

export function canonicalProjectAggregateKey(name = "") {
  const key = String(name || "")
    .toLowerCase()
    .replace(/[\s\-_·•｜|:：()（）【】[\].,!?]+/g, "")
    .trim();
  if (!key || GENERIC_AGGREGATE_KEYS.has(key)) return "";
  if (/[\u4e00-\u9fff]/.test(key)) {
    return Array.from(key).length >= 2 ? key : "";
  }
  return key.length >= 3 ? key : "";
}

function pickTopicDisplayName(topic = {}, lang = "") {
  if (!topic) return "";
  const localized = lang && topic.names && typeof topic.names === "object"
    ? String(topic.names[lang] || "").trim()
    : "";
  if (!localized) return topic.name || "";
  if (topic.autoDiscovered === true) return localized;
  const known = Object.values(topic.names).map((v) => String(v || "").trim()).filter(Boolean);
  return known.includes(String(topic.name || "").trim()) ? localized : (topic.name || "");
}

const ARCHIVE_TRANSCRIPT_TURNS = 8;
const ARCHIVE_TRANSCRIPT_CHARS = 2400;
const ARCHIVE_TRANSCRIPT_TOTAL_CHARS = 24_000;
const SECRET_LIKE_RE = /(token|api[_-]?key|secret|password|cookie|session_id|bearer\s+[a-z0-9]|sk-[a-z0-9]{8,})/i;

// Flattens the tail of a thread into "用户/助手" lines so the archive distiller sees real outcomes, not just titles.
export function buildArchiveTranscript(turns = [], { maxTurns = ARCHIVE_TRANSCRIPT_TURNS, maxChars = ARCHIVE_TRANSCRIPT_CHARS } = {}) {
  const lines = [];
  for (const turn of (Array.isArray(turns) ? turns : []).slice(-maxTurns)) {
    for (const item of turn?.items || []) {
      if (item?.type === "userMessage") {
        const text = (Array.isArray(item.content) ? item.content : [])
          .map((part) => (part?.type === "text" ? part.text : ""))
          .join(" ");
        const clean = String(text || "").replace(/\s+/g, " ").trim();
        if (clean) lines.push(`用户：${clean.slice(0, 400)}`);
      } else if (item?.type === "agentMessage" && item.text) {
        const clean = String(item.text).replace(/\s+/g, " ").trim();
        if (clean) lines.push(`助手：${clean.slice(0, 700)}`);
      }
    }
  }
  const text = lines.join("\n");
  return text.length > maxChars ? `…${text.slice(-maxChars)}` : text;
}

// Loose comparison key so rephrased punctuation/spacing doesn't count as new memory.
export function memoryDedupKey(text = "") {
  return String(text || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

// Keeps only well-formed, secret-free memory entries from the distiller's JSON.
export function normalizeArchiveMemoryPlan(raw = null) {
  const obj = raw && typeof raw === "object" ? raw : {};
  const str = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
  const safe = (...vals) => !vals.some((v) => SECRET_LIKE_RE.test(v));
  const list = (v) => (Array.isArray(v) ? v : []);
  const facts = list(obj.facts)
    .map((f) => ({ key: str(f?.key, 40), value: str(f?.value, 240) }))
    .filter((f) => f.key && f.value && safe(f.key, f.value))
    .slice(0, 8);
  const decisions = list(obj.decisions)
    .map((d) => str(typeof d === "string" ? d : d?.text, 240))
    .filter((d) => d && safe(d))
    .slice(0, 6);
  const lessons = list(obj.lessons)
    .map((l) => ({ title: str(l?.title, 40), body: String(l?.body ?? "").trim().slice(0, 1200) }))
    .filter((l) => l.title && l.body && safe(l.title, l.body))
    .slice(0, 4);
  const wip = list(obj.wip)
    .map((w) => ({ slug: str(w?.slug || w?.title, 40), title: str(w?.title || w?.slug, 60), state: str(w?.state, 300), next: str(w?.next, 300) }))
    .filter((w) => w.slug && (w.state || w.next) && safe(w.state, w.next))
    .slice(0, 4);
  return { summary: str(obj.summary, 480), facts, decisions, lessons, wip };
}

function compactHeadline(raw = "", maxLen = 22) {
  const clean = String(raw || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\/[a-z0-9_-]+\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";
  return clean.length > maxLen ? `${clean.slice(0, maxLen)}…` : clean;
}

function textsDivergeSemantically(firstText = "", currentTitle = "") {
  const a = compactHeadline(firstText, 30).toLowerCase();
  const b = compactHeadline(currentTitle, 30).toLowerCase();
  if (!a || !b || a.length < 4 || b.length < 4) return false;
  if (a.includes(b.slice(0, 4)) || b.includes(a.slice(0, 4))) return false;
  // Check 2-gram overlap for Chinese/English tokens
  const grams = new Set();
  for (let i = 0; i < a.length - 1; i += 1) {
    const g = a.slice(i, i + 2).trim();
    if (g.length === 2) grams.add(g);
  }
  let hits = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const g = b.slice(i, i + 2).trim();
    if (grams.has(g)) hits += 1;
  }
  return hits <= 1;
}

export function isScratchNoiseCwd(cwd = "") {
  const clean = String(cwd || "").trim().replace(/\\/g, "/");
  if (!clean) return false;
  return (
    /\/private\/tmp\/claude-\d+\/.*\/scratchpad(?:\/|$)/i.test(clean)
    || /\/\.gemini\/antigravity\/brain\/[^/]+\/scratch(?:\/|$)/i.test(clean)
    || /\/Claude\/scratch-workspaces\//i.test(clean)
    || /\/overview-worker(?:\/|$)/i.test(clean)
  );
}

export function isInternalOverviewThread(thread = {}) {
  return isInternalAssistantThread(thread);
}

export function inferStageTag(thread = {}, topic = null) {
  const text = `${thread?.title || ""} ${thread?.preview || ""} ${thread?.firstUserText || ""} ${thread?.cwd || ""}`.toLowerCase();
  if (/宣传片|动画|动效|视频制作|成片|分镜|角色卡|发布/.test(text)) return "媒体·动效";
  if (/tiktok|youtube|出海|外挂字幕|运营/.test(text)) return "出海运营";
  if (/支付|seo|推广|商业化|赞助|定价/.test(text)) return "商业化·推广";
  if (/排查|报错|挂了|离线|失败|bug|异常|修复/.test(text)) return "问题排查";
  if (/小说|剧本|大纲|漫剧|创作/.test(text)) return "内容生产";
  if (topic?.domainId === "bounty-guild") return "问题排查";
  if (topic?.domainId === "global-pub") return "出海运营";
  if (topic?.domainId === "drama-studio") return "内容生产";
  return "研发";
}

export function extractThreadFootprints(thread = {}) {
  const fullCorpus = [
    thread?.firstUserText || "",
    thread?.autoTitle || "",
    thread?.lastUserText || "",
    thread?.title || "",
    thread?.preview || "",
  ].join(" \n ");

  const matchedLabels = [];
  for (const rule of FEATURE_FOOTPRINT_RULES) {
    if (rule.pattern.test(fullCorpus)) {
      matchedLabels.push(rule.label);
    }
  }

  const titleOnly = `${thread?.title || ""}`;
  const hiddenFootprints = matchedLabels.filter((label) => {
    const rule = FEATURE_FOOTPRINT_RULES.find((r) => r.label === label);
    return rule ? !rule.pattern.test(titleOnly) : false;
  });

  const drifted = Boolean(thread?.autoTitleIsDrift) || textsDivergeSemantically(thread?.firstUserText, thread?.title);
  const driftedFrom = drifted ? compactHeadline(thread?.firstUserText, 20) : "";

  return {
    allLabels: matchedLabels.slice(0, 5),
    hiddenFootprints: hiddenFootprints.slice(0, 3),
    driftedFrom,
    isMultiTask: Boolean(drifted || matchedLabels.length >= 3),
  };
}

function scoreTextAgainstTopic(rawText = "", topic) {
  const lower = String(rawText || "").toLowerCase();
  if (!lower) return 0;
  let score = 0;
  for (const kw of topic.keywords || []) {
    const cleanKw = String(kw || "").trim().toLowerCase();
    if (!cleanKw) continue;
    if (lower.includes(cleanKw)) {
      score += 120 + cleanKw.length * 2;
    }
  }
  const cleanName = String(topic.name || "").trim().toLowerCase();
  if (cleanName && cleanName.length >= 2 && lower.includes(cleanName)) {
    score += 110;
  }
  return score;
}

function scoreTopicMatch(thread, topic) {
  const latestText = `${thread?.title || ""} ${thread?.preview || ""} ${thread?.lastUserText || ""}`;
  const earlyText = `${thread?.firstUserText || ""} ${thread?.autoTitle || ""}`;
  const cwd = normPath(thread?.cwd || "");
  let score = scoreTextAgainstTopic(latestText, topic);

  // Also give partial weight to early session history so pure cwd sessions still resolve accurately
  const earlyScore = scoreTextAgainstTopic(earlyText, topic);
  if (score === 0 && earlyScore > 0) {
    score += Math.round(earlyScore * 0.85);
  }

  for (const prefix of topic.cwdPrefixes || []) {
    if (pathMatchesPrefix(cwd, prefix)) {
      score += 80 + normPath(prefix).length;
    }
  }
  return score;
}

export function detectSecondaryTopicIds(thread = {}, primaryTopicId = "", topics = DEFAULT_MISSION_TOPICS) {
  const secondary = new Set();
  const historyCorpus = [
    thread?.firstUserText || "",
    thread?.autoTitle || "",
    thread?.lastUserText || "",
    thread?.title || "",
    thread?.preview || "",
  ].join(" ");
  const cwd = normPath(thread?.cwd || "");

  for (const topic of topics) {
    if (!topic?.id || topic.id === primaryTopicId) continue;
    const kwScore = scoreTextAgainstTopic(historyCorpus, topic);
    if (kwScore >= 120) {
      secondary.add(topic.id);
      continue;
    }
    // If session ran inside a concrete topic repo (not generic home/drama shared dir), and history has relevant footprints
    if (
      topic.primaryCwd
      && topic.id !== "domestic-drama"
      && pathMatchesPrefix(cwd, topic.primaryCwd)
      && (Boolean(thread?.firstUserText) || Boolean(thread?.autoTitleIsDrift))
    ) {
      const earlyScore = scoreTextAgainstTopic(`${thread?.firstUserText || ""} ${thread?.autoTitle || ""}`, topic);
      if (earlyScore >= 100 || (topic.id === "agent-control" && /语音|面板|主题|隧道|实例|voice|overview/i.test(historyCorpus))) {
        secondary.add(topic.id);
      }
    }
  }
  return [...secondary].slice(0, 3);
}

export function classifyThreadRuleBased(thread = {}, topics = DEFAULT_MISSION_TOPICS) {
  let bestTopic = null;
  let bestScore = 0;
  for (const topic of topics) {
    const score = scoreTopicMatch(thread, topic);
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }
  if (!bestTopic || bestScore < 60) {
    return { topicId: "", stage: inferStageTag(thread, null), source: "unassigned" };
  }
  return {
    topicId: bestTopic.id,
    stage: inferStageTag(thread, bestTopic),
    source: "rule",
  };
}

export function inferPipelineStage(topic, activeThreads = [], gitSnap = null, cachedSummary = null) {
  const harvestEvidence = activeThreads.map(harvestEvidenceForThread).find(Boolean) || null;
  const aiStage = Number(cachedSummary?.stageIndex);
  if (Number.isInteger(aiStage) && aiStage >= 1 && aiStage <= 5) {
    const stageMeta = PIPELINE_STAGES.find((s) => s.index === aiStage) || PIPELINE_STAGES[1];
    const readyToHarvest = aiStage >= 4 || (topic.yieldType === "coin" && aiStage >= 3 && activeThreads.length > 0);
    return {
      stageIndex: aiStage,
      stageLabel: stageMeta.label,
      readyToHarvest: Boolean(harvestEvidence),
      harvestEvidence,
      harvestInferred: !harvestEvidence && readyToHarvest,
      bottleneck: cachedSummary?.bottleneck || "",
    };
  }

  const corpus = activeThreads.map((t) => `${t.title || ""} ${t.preview || ""} ${t.stage || ""}`).join(" ").toLowerCase();
  let stageIndex = 1;
  if (/收款|已上线|已发布|上线完成|付费开通|订阅开通/.test(corpus)) {
    stageIndex = 5;
  } else if (/商业化|变现|定价|seo|推广|宣传|营销|上架|youtube|tiktok/.test(corpus)) {
    stageIndex = 4;
  } else if (/修复|优化|打磨|测试|重构|排查/.test(corpus) || activeThreads.length >= 4 || (gitSnap?.dirtyCount || 0) > 0) {
    stageIndex = 3;
  } else if (activeThreads.length > 0 || (gitSnap?.commits?.length || 0) > 0) {
    stageIndex = 2;
  }

  const readyToHarvest = Boolean(
    stageIndex >= 4
    || (topic.yieldType === "coin" && stageIndex >= 3 && activeThreads.length > 0),
  );

  let bottleneck = "";
  const pendingCount = activeThreads.reduce((s, t) => s + (t.pendingCount || 0), 0);
  if (pendingCount > 0) {
    bottleneck = `卡在 ${pendingCount} 项待确认授权，拍板即可继续推进`;
  } else if (stageIndex >= 4 && (gitSnap?.dirtyCount || 0) > 0) {
    bottleneck = `宣发/变现临门一脚：还有 ${gitSnap.dirtyCount} 处本地改动待提交收口`;
  } else if (readyToHarvest && topic.yieldType === "coin") {
    bottleneck = "距变现最近，优先完成商用闭环与分发验收";
  } else if (readyToHarvest && topic.yieldType === "growth") {
    bottleneck = "宣传物料/SEO 已就绪，推动对外发布放大飞轮";
  }

  const stageMeta = PIPELINE_STAGES.find((s) => s.index === stageIndex) || PIPELINE_STAGES[0];
  return {
    stageIndex,
    stageLabel: stageMeta.label,
    readyToHarvest: Boolean(harvestEvidence),
    harvestEvidence,
    harvestInferred: !harvestEvidence && readyToHarvest,
    bottleneck,
  };
}

export const AGENT_SOURCE_LABELS = Object.freeze({
  ai: "AI 智能分配",
  manual: "你指定的账号",
  remembered: "沿用你上次给该项目选的账号",
  affinity: "沿用该项目历史会话所用账号",
  adaptive: "自适应优选（额度+近期常用）",
  quota: "剩余额度最充裕账号",
  recent: "近期最常用账号",
  provider: "按自定义智能体优先级",
  default: "全局默认账号",
  fallback: "首个可用账号",
});

export const DISPATCH_PRIORITY_STRATEGIES = Object.freeze([
  { key: "adaptive", label: "自适应（额度+常用）" },
  { key: "quota", label: "剩余额度优先" },
  { key: "recent", label: "近期常用优先" },
  { key: "provider", label: "按智能体顺序" },
]);

export const DEFAULT_DISPATCH_PROVIDER_ORDER = Object.freeze(["antigravity", "claude", "codex", "grok"]);

const DISPATCH_PROVIDER_NAMES = new Set(["codex", "claude", "antigravity", "grok", "qoder"]);

function normalizeDispatchProvider(value) {
  const lower = String(value || "").trim().toLowerCase();
  if (!lower || lower === "auto") return "";
  if (lower === "agy") return "antigravity";
  return DISPATCH_PROVIDER_NAMES.has(lower) ? lower : "";
}

export const TASK_DIFFICULTY_LABELS = Object.freeze({
  heavy: "复杂深度 · 最强模型",
  balanced: "常规任务 · 均衡模型",
  fast: "轻量快速 · 高速模型",
});

const MODEL_TIERS_BY_PROVIDER = Object.freeze({
  codex: {
    heavy: { models: ["gpt-6.2-sol", "gpt-6.1-terra", "gpt-5.4"], effort: "high" },
    balanced: { models: ["gpt-6.2-sol", "gpt-6.1-terra", "gpt-5.4"], effort: "medium" },
    fast: { models: ["gpt-6.2-sol", "gpt-6.1-terra", "gpt-6.1-sol", "gpt-6-luna"], effort: "low" },
  },
  claude: {
    heavy: { models: ["claude-opus-5-5", "claude-opus-4-6", "claude-sonnet-5-5"], effort: "high" },
    balanced: { models: ["claude-sonnet-5-5", "claude-sonnet-4-6"], effort: "medium" },
    fast: { models: ["claude-haiku-4-5", "claude-sonnet-5-5", "claude-sonnet-4-6"], effort: "low" },
  },
  antigravity: {
    heavy: { models: ["gemini-4-carbon", "gemini-4-neon", "claude-opus-5-5", "gemini-pro-orchestrator", "gemini-4-hydrogen"], effort: "high" },
    balanced: { models: ["gemini-4-hydrogen", "gemini-4-argon", "claude-sonnet-5-5", "gemini-3.8-flash"], effort: "medium" },
    fast: { models: ["gemini-4-hydrogen", "gemini-3.8-flash"], effort: "low" },
  },
  grok: {
    heavy: { models: ["grok-4", "grok-3"], effort: "high" },
    balanced: { models: ["grok-4", "grok-4-fast"], effort: "medium" },
    fast: { models: ["grok-4-fast", "grok-3-mini"], effort: "low" },
  },
});

export function normalizeDispatchPrefs(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  const validStrategies = new Set(DISPATCH_PRIORITY_STRATEGIES.map((s) => s.key));
  const strategy = validStrategies.has(String(src.strategy || "").trim())
    ? String(src.strategy).trim()
    : "adaptive";
  const incomingOrder = Array.isArray(src.providerOrder) ? src.providerOrder : [];
  const validProviders = new Set(["antigravity", "claude", "codex", "grok", "qoder"]);
  const seen = new Set();
  const providerOrder = [];
  for (const item of [...incomingOrder, ...DEFAULT_DISPATCH_PROVIDER_ORDER]) {
    const clean = String(item || "").trim().toLowerCase();
    if (!clean || !validProviders.has(clean) || seen.has(clean)) continue;
    seen.add(clean);
    providerOrder.push(clean);
  }
  const incomingExcluded = Array.isArray(src.excludedAgentKeys) ? src.excludedAgentKeys : [];
  const seenExcluded = new Set();
  const excludedAgentKeys = [];
  for (const item of incomingExcluded) {
    const clean = String(item || "").trim();
    if (!clean || seenExcluded.has(clean)) continue;
    seenExcluded.add(clean);
    excludedAgentKeys.push(clean);
  }
  return { strategy, providerOrder, excludedAgentKeys };
}

export function classifyDispatchTaskDifficulty(text = "") {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "balanced";
  const heavyRe = /重构|架构|深度|疑难|根因|全量(?:重构|迁移|改造|审计|排查|重写|替换)|多文件|跨仓库|迁移|性能优化|安全审计|从零|从头|系统性|复杂|设计方案|底层|并发|死锁|内存泄漏|redesign|architect|refactor|deep\s+dive|root\s+cause/i;
  const metricsFastRe = /\.agent-metrics(?:\.[^.\s]+)?\.json|采数|(?:采集|拉取|抓取|同步|汇总|更新).{0,24}(?:指标|明细|数据|创收|粉丝|阅读|播放|KPI)/i;
  const codingTaskRe = /实现|开发|新增|编写|修复|排查|改造|重构|接口|服务|组件|单测|测试|bug|fix/i;
  if (metricsFastRe.test(clean) && !heavyRe.test(clean) && !codingTaskRe.test(clean)) {
    return "fast";
  }
  const fastRe = /^(?:请|帮我|麻烦|先)?(?:查一下|查下|看看|看下|确认|检查|汇报|总结|整理|翻译|微调|改个文案|改下文字|重命名|加个图标|补个|问一下|简单|快速|顺便)|(?:状态|进度|汇总|文案|配色|图标|提示语|报错截图)/i;
  if (heavyRe.test(clean) || (clean.length >= 110 && /排查|修复|实现|改造|优化|开发/.test(clean))) {
    return "heavy";
  }
  if (fastRe.test(clean) || (clean.length <= 12 && !/排查|重构|架构|设计|开发|实现|新增|接口|修复|单测/.test(clean))) {
    return "fast";
  }
  return "balanced";
}

const AGENT_SPECIALTY_SCORES = Object.freeze({
  hardcore: { codex: 22, claude: 18, antigravity: 10, grok: 6, label: "擅长硬核攻坚" },
  creative: { antigravity: 22, claude: 18, grok: 14, codex: 6, label: "擅长创意设计" },
  general: { antigravity: 0, claude: 0, codex: 0, grok: 0, label: "" },
});

export function classifyDispatchTaskSpecialty(text = "") {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "general";
  if (/疑难|根因|死锁|并发|内存泄漏|底层|协议|编译|构建失败|架构重构|全量重构|安全审计|卡死|崩溃|crash|debug|refactor/i.test(clean)) {
    return "hardcore";
  }
  if (/创意|脑暴|剧本|分镜|短剧|小说|文案|命名|设计|UI|前端|审美|视觉|动画|海报|视频|mv|角色卡|画风|策划|选题/i.test(clean)) {
    return "creative";
  }
  return "general";
}

export function extractProfileQuotaScore(profile = {}) {
  const quota = profile?.quota;
  if (!quota || typeof quota !== "object") {
    return { hasQuota: false, exhausted: false, lowQuota: false, weeklyPercent: null, fiveHourPercent: null, score: 0, summary: "" };
  }
  const weeklyRaw = quota.windows?.weekly?.remainingPercent;
  const fiveHourRaw = quota.windows?.fiveHour?.remainingPercent;
  const weeklyPercent = Number.isFinite(Number(weeklyRaw)) ? Math.max(0, Math.min(100, Number(weeklyRaw))) : null;
  const fiveHourPercent = Number.isFinite(Number(fiveHourRaw)) ? Math.max(0, Math.min(100, Number(fiveHourRaw))) : null;
  const hasQuota = weeklyPercent !== null || fiveHourPercent !== null;
  const exhausted = Boolean(
    quota.status === "exhausted"
    || (weeklyPercent !== null && weeklyPercent <= 0)
    || (fiveHourPercent !== null && fiveHourPercent <= 0),
  );
  const lowQuota = Boolean(
    !exhausted
    && ((weeklyPercent !== null && weeklyPercent < 18) || (fiveHourPercent !== null && fiveHourPercent < 15)),
  );
  const effectiveWeekly = weeklyPercent ?? fiveHourPercent ?? 50;
  const effectiveFiveHour = fiveHourPercent ?? weeklyPercent ?? 50;
  const score = exhausted
    ? -1000
    : (effectiveWeekly * 0.65 + effectiveFiveHour * 0.35 - (lowQuota ? 25 : 0));
  const parts = [];
  if (weeklyPercent !== null) parts.push(`周额度 ${Math.round(weeklyPercent)}%`);
  if (fiveHourPercent !== null && fiveHourPercent < 40) parts.push(`5h ${Math.round(fiveHourPercent)}%`);
  return {
    hasQuota,
    exhausted,
    lowQuota,
    weeklyPercent,
    fiveHourPercent,
    score,
    summary: exhausted ? "额度已耗尽" : parts.join(" · "),
  };
}

export function selectAdaptiveModelForRoute({
  provider = "",
  difficulty = "balanced",
  explicitModel = "",
  availableModels = [],
} = {}) {
  const cleanExplicit = String(explicitModel || "").trim();
  const tierTable = MODEL_TIERS_BY_PROVIDER[provider] || null;
  const tier = tierTable?.[difficulty] || tierTable?.balanced || { models: [], effort: difficulty === "heavy" ? "high" : (difficulty === "fast" ? "low" : "medium") };
  if (cleanExplicit) {
    return { model: cleanExplicit, effort: tier.effort || "", modelSource: "manual" };
  }
  const catalog = Array.isArray(availableModels) ? availableModels : [];
  const catalogIds = new Map();
  for (const item of catalog) {
    const id = String(item?.model || item?.id || "").trim();
    if (id) catalogIds.set(id.toLowerCase(), id);
  }
  if (catalogIds.size > 0) {
    for (const candidate of tier.models) {
      const matched = catalogIds.get(candidate.toLowerCase());
      if (matched) {
        return { model: matched, effort: tier.effort || "", modelSource: "adaptive" };
      }
    }
    const defaultItem = catalog.find((item) => item?.isDefault) || catalog[0];
    const fallbackId = String(defaultItem?.model || defaultItem?.id || "").trim();
    return { model: fallbackId, effort: tier.effort || "", modelSource: "default" };
  }
  return {
    model: tier.models[0] || "",
    effort: tier.effort || "",
    modelSource: tier.models[0] ? "adaptive" : "default",
  };
}

export function agentKeyOfThread(thread = {}) {
  const provider = String(thread?.provider || "").trim();
  if (!provider) return "";
  return `${provider}:${String(thread?.profileId || "default").trim() || "default"}`;
}

// Rank provider:profile keys by how often (and how recently) a topic's own sessions used them.
export function computeAgentAffinity(activeThreads = [], archivedThreads = []) {
  const counts = new Map();
  const add = (t, weight) => {
    const key = agentKeyOfThread(t);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + weight);
  };
  activeThreads.filter((t) => !t.isSlice).forEach((t, idx) => add(t, (t.live ? 3 : 1) + (idx < 5 ? 1 : 0)));
  archivedThreads.slice(0, 20).forEach((t) => add(t, 0.5));
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}

function buildWorkerPods(activeThreads = []) {
  const groups = new Map();
  for (const t of activeThreads) {
    if (t.isSlice) continue;
    const primaryFootprint = Array.isArray(t.allFootprints) && t.allFootprints[0]
      ? t.allFootprints[0]
      : (t.stage && t.stage !== "研发" ? t.stage : "");
    if (!primaryFootprint) continue;
    if (!groups.has(primaryFootprint)) {
      groups.set(primaryFootprint, []);
    }
    groups.get(primaryFootprint).push(t);
  }
  const pods = [];
  for (const [label, list] of groups.entries()) {
    if (list.length < 2) continue;
    pods.push({
      label,
      count: list.length,
      liveCount: list.filter((x) => x.live).length,
      threadIds: list.map((x) => x.id),
    });
  }
  return pods.sort((a, b) => (b.liveCount - a.liveCount) || (b.count - a.count)).slice(0, 4);
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, filePath);
}

function isTestRuntime(env = process.env) {
  return Boolean(
    env?.NODE_ENV === "test"
    || env?.NODE_TEST_CONTEXT
    || process.env?.NODE_TEST_CONTEXT
    || process.execArgv?.some((arg) => arg.includes("--test")),
  );
}

function parseJsonFromAiText(rawText = "") {
  const raw = String(rawText || "").trim();
  if (!raw) return null;
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) return null;
  try {
    return JSON.parse(candidate.slice(firstBrace, lastBrace + 1));
  } catch {
    return null;
  }
}

export async function collectRepoGitSnapshot(cwd, { timeoutMs = 2_500 } = {}) {
  const cleanCwd = normPath(cwd);
  if (!cleanCwd) return null;
  try {
    const [logRes, statusRes] = await Promise.all([
      execFileCrossPlatform("git", ["-C", cleanCwd, "log", "-n", "3", "--format=%h %s (%cr)"], {
        timeout: timeoutMs,
        maxBuffer: 64 * 1024,
      }).catch(() => ({ stdout: "" })),
      execFileCrossPlatform("git", ["-C", cleanCwd, "status", "--porcelain"], {
        timeout: timeoutMs,
        maxBuffer: 64 * 1024,
      }).catch(() => ({ stdout: "" })),
    ]);
    const commits = String(logRes.stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);
    const dirtyLines = String(statusRes.stdout || "")
      .split(/\r?\n/)
      .filter((s) => s.trim().length > 0);
    if (!commits.length && !dirtyLines.length) return null;
    return {
      cwd: cleanCwd,
      commits,
      dirtyCount: dirtyLines.length,
    };
  } catch {
    return null;
  }
}

function buildOverviewFingerprint(activeThreads = [], gitSnapshots = {}) {
  const h = createHash("sha1");
  const sortedThreads = [...activeThreads]
    .filter((t) => !t.isSlice)
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const t of sortedThreads) {
    h.update(`${t.id}:${t.updatedAt || 0}:${t.live ? 1 : 0}:${t.pendingCount || 0}:${t.title || ""}\n`);
  }
  for (const cwd of Object.keys(gitSnapshots).sort()) {
    const snap = gitSnapshots[cwd];
    if (!snap) continue;
    h.update(`git:${cwd}:${(snap.commits || []).join("|")}:${snap.dirtyCount || 0}\n`);
  }
  return h.digest("hex").slice(0, 16);
}

function buildFallbackTopicSummary(topic, activeThreads = [], gitSnap = null) {
  const primaryActive = activeThreads.filter((t) => !t.isSlice);
  const liveCount = primaryActive.filter((t) => t.live).length;
  const pendingCount = primaryActive.reduce((sum, t) => sum + (Number(t.pendingCount) || 0), 0);
  const topTitles = primaryActive.slice(0, 2).map((t) => String(t.title || "").trim()).filter(Boolean);
  let progress = "";
  if (topTitles.length) {
    progress = `近期焦点：${topTitles.join("；")}`;
  } else if (gitSnap?.commits?.length) {
    progress = `最新提交：${gitSnap.commits[0]}`;
  } else {
    progress = topic.description || "近 7 天暂无新对话";
  }
  let nextStep = "";
  if (pendingCount > 0) {
    nextStep = `优先处理 ${pendingCount} 项待审批/确认请求`;
  } else if (liveCount > 0) {
    nextStep = `${liveCount} 个工位运行中，关注产出验收`;
  } else if (gitSnap?.dirtyCount > 0) {
    nextStep = `整理并提交工作区 ${gitSnap.dirtyCount} 处未提交改动`;
  } else if (topTitles[0]) {
    nextStep = `继续推进「${topTitles[0].slice(0, 24)}」收口`;
  } else {
    nextStep = "产线待命，可随时派发新工单";
  }
  return { progress, nextStep, source: "fallback" };
}

function sparkFreshnessMeta(ageHours = 0) {
  if (ageHours <= 42) {
    return { tier: "hot", label: "昨日灵光 · 趁热孵化" };
  }
  if (ageHours <= 120) {
    return { tier: "warm", label: "余温尚存" };
  }
  return { tier: "ember", label: "待唤醒火种" };
}

function splitCompoundPromptSegments(text = "", topics = DEFAULT_MISSION_TOPICS) {
  const clean = String(text || "").trim();
  if (!clean) return [];

  // Split by explicit numbered list or semicolons/newlines when user dispatches multiple distinct project tasks
  const rawParts = clean
    .split(/(?:\r?\n)+|(?:\s*[；;]\s*)|(?=\b\d+[.、)\s]\s*)/)
    .map((s) => s.replace(/^\d+[.、)\s]\s*/, "").trim())
    .filter((s) => s.length >= 4);

  if (rawParts.length <= 1) {
    return [clean];
  }

  // Only split into separate parallel sessions if segments clearly target >= 2 distinct topics or user explicitly wrote >= 2 actionable items
  const matchedTopics = rawParts.map((seg) => {
    let bestId = "";
    let best = 0;
    for (const tp of topics) {
      const sc = scoreTextAgainstTopic(seg, tp);
      if (sc > best) {
        best = sc;
        bestId = tp.id;
      }
    }
    return best >= 100 ? bestId : "";
  });

  const uniqueMatched = new Set(matchedTopics.filter(Boolean));
  if (uniqueMatched.size >= 2) {
    return rawParts.slice(0, 5);
  }
  return [clean];
}

export class MissionOverviewService {
  #hub;
  #dataDir;
  #overviewPath;
  #domainsPath;
  #sparksPath;
  #metricsPath;
  #contextsPath;
  #projectValuePath;
  #cooldownMs;
  #activeWindowSec;
  #broadcast;
  #runAiImpl;
  #collectGitImpl;
  #readRepoMetaImpl;
  #env;

  #domains = [...DEFAULT_MISSION_DOMAINS];
  #topics = [...DEFAULT_MISSION_TOPICS];
  #ignoredCwds = [];
  #domainsMtimeMs = 0;
  #vaultCardsCache = { at: 0, cards: [] };
  #repoMetaCache = new Map();
  #lastRequestedLocale = "";
  #lastSyncDiscoverAt = 0;
  #sparksState = {
    version: 1,
    manualSparks: [],
    chilledIds: [],
    aiSparks: [],
  };
  #metricsStore = {
    version: 1,
    topics: {},
  };
  #contextsStore = {
    version: 1,
    topics: {},
  };
  #cache = {
    version: 2,
    lastSummarizedAt: 0,
    lastFingerprint: "",
    preferredModel: "auto",
    cooldownMs: DEFAULT_OVERVIEW_COOLDOWN_MS,
    lastError: "",
    lastModelUsed: "",
    pinnedFocusIds: [],
    topicAgentPrefs: {},
    dispatchPrefs: normalizeDispatchPrefs(),
    assignments: {},
    topicSummaries: {},
  };
  #loaded = false;
  #inFlightPromise = null;
  #gitCache = new Map();
  #valueLedgerCache = { at: 0, byId: new Map(), byRoot: new Map() };
  #autoMetricsCache = { at: 0, byTopicId: new Map() };

  constructor({
    hub,
    dataDir = defaultDataDir(),
    projectValuePath = "",
    cooldownMs = DEFAULT_OVERVIEW_COOLDOWN_MS,
    activeWindowSec = DEFAULT_ACTIVE_WINDOW_SEC,
    broadcast = null,
    runAiImpl = null,
    collectGitImpl = null,
    readRepoMetaImpl = null,
    env = process.env,
    assistantOptions = {},
  } = {}) {
    this.#hub = hub;
    this.#dataDir = dataDir;
    this.#overviewPath = resolve(dataDir, "mission-overview.json");
    this.#domainsPath = resolve(dataDir, "mission-domains.json");
    this.#sparksPath = resolve(dataDir, "mission-sparks.json");
    this.#metricsPath = resolve(dataDir, "mission-metrics.json");
    this.#contextsPath = resolve(dataDir, "mission-contexts.json");
    this.#projectValuePath = projectValuePath;
    this.#cooldownMs = Math.max(60_000, Number(cooldownMs) || DEFAULT_OVERVIEW_COOLDOWN_MS);
    this.#activeWindowSec = Math.max(3600, Number(activeWindowSec) || DEFAULT_ACTIVE_WINDOW_SEC);
    this.#broadcast = typeof broadcast === "function" ? broadcast : null;
    this.#runAiImpl = typeof runAiImpl === "function" ? runAiImpl : null;
    this.#collectGitImpl = typeof collectGitImpl === "function" ? collectGitImpl : collectRepoGitSnapshot;
    this.#readRepoMetaImpl = typeof readRepoMetaImpl === "function" ? readRepoMetaImpl : readRepoMetadata;
    this.#env = env;
    this.voiceService = null;
    this.assistant = new AssistantService({
      hub, dataDir, env,
      getOverview: () => this.getOverview({ trigger: "assistant" }),
      onJudged: () => {
        if (!this.#broadcast) return;
        void this.getOverview({ trigger: "assistant" }).then((overview) => this.#broadcast?.("overview_updated", overview)).catch(() => {});
      },
      dispatchImpl: (opts) => this.dispatchTask(opts),
      ...assistantOptions,
      // Tests never reach a real model: without an injected runner there is no channel at all.
      llmOptions: { completeImpl: this.#runAiImpl || !isTestRuntime(env) ? (input) => this.completeAssistantText(input) : null, ...(assistantOptions.llmOptions || {}) },
    });
  }

  async #ensureLoaded() {
    const normalizeIgnoredList = (list) => [
      ...new Set((Array.isArray(list) ? list : []).map((p) => normPath(p)).filter(Boolean)),
    ];
    if (this.#loaded) {
      try {
        const st = await stat(this.#domainsPath);
        if (st.mtimeMs && st.mtimeMs !== this.#domainsMtimeMs) {
          const rawDomains = JSON.parse(await readFile(this.#domainsPath, "utf8"));
          if (Array.isArray(rawDomains?.domains) && rawDomains.domains.length) {
            this.#domains = rawDomains.domains;
          }
          if (Array.isArray(rawDomains?.topics)) {
            this.#topics = rawDomains.topics;
          }
          this.#ignoredCwds = normalizeIgnoredList(rawDomains?.ignoredCwds);
          this.#domainsMtimeMs = st.mtimeMs;
          this.#gitCache.clear();
          this.#autoMetricsCache.at = 0;
        }
      } catch {}
      return;
    }
    this.#loaded = true;
    try {
      const [rawText, st] = await Promise.all([
        readFile(this.#domainsPath, "utf8"),
        stat(this.#domainsPath).catch(() => null),
      ]);
      const rawDomains = JSON.parse(rawText);
      if (Array.isArray(rawDomains?.domains) && rawDomains.domains.length) {
        this.#domains = rawDomains.domains;
      }
      if (Array.isArray(rawDomains?.topics)) {
        this.#topics = rawDomains.topics;
      }
      this.#ignoredCwds = normalizeIgnoredList(rawDomains?.ignoredCwds);
      this.#domainsMtimeMs = st?.mtimeMs || 0;
    } catch {
      // Fresh install with no mission-domains.json yet: keep topics empty so
      // #syncDiscoveredTopics() populates from the user's own local repos.
      this.#domains = [...DEFAULT_MISSION_DOMAINS];
      this.#topics = [];
      this.#ignoredCwds = [];
      this.#domainsMtimeMs = 0;
    }

    try {
      const rawCache = JSON.parse(await readFile(this.#overviewPath, "utf8"));
      if (rawCache && typeof rawCache === "object") {
        this.#cache = {
          ...this.#cache,
          ...rawCache,
          pinnedFocusIds: Array.isArray(rawCache.pinnedFocusIds) ? rawCache.pinnedFocusIds : [],
          assignments: rawCache.assignments && typeof rawCache.assignments === "object" ? rawCache.assignments : {},
          topicAgentPrefs: rawCache.topicAgentPrefs && typeof rawCache.topicAgentPrefs === "object" ? rawCache.topicAgentPrefs : {},
          dispatchPrefs: normalizeDispatchPrefs(rawCache.dispatchPrefs),
          topicSummaries: rawCache.topicSummaries && typeof rawCache.topicSummaries === "object" ? rawCache.topicSummaries : {},
        };
      }
    } catch {}

    try {
      const rawSparks = JSON.parse(await readFile(this.#sparksPath, "utf8"));
      if (rawSparks && typeof rawSparks === "object") {
        this.#sparksState = {
          version: 1,
          manualSparks: Array.isArray(rawSparks.manualSparks) ? rawSparks.manualSparks : [],
          chilledIds: Array.isArray(rawSparks.chilledIds) ? rawSparks.chilledIds : [],
          aiSparks: Array.isArray(rawSparks.aiSparks) ? rawSparks.aiSparks : [],
        };
      }
    } catch {}

    try {
      const rawMetrics = JSON.parse(await readFile(this.#metricsPath, "utf8"));
      if (rawMetrics && typeof rawMetrics === "object") {
        this.#metricsStore = {
          version: 1,
          topics: rawMetrics.topics && typeof rawMetrics.topics === "object" ? rawMetrics.topics : {},
        };
      }
    } catch {}

    try {
      const rawContexts = JSON.parse(await readFile(this.#contextsPath, "utf8"));
      if (rawContexts && typeof rawContexts === "object") {
        this.#contextsStore = {
          version: 1,
          topics: rawContexts.topics && typeof rawContexts.topics === "object" ? rawContexts.topics : {},
        };
      }
    } catch {}
  }

  async #persistContexts() {
    await writeJsonAtomic(this.#contextsPath, this.#contextsStore).catch(() => {});
  }

  async #persistCache() {
    await writeJsonAtomic(this.#overviewPath, this.#cache).catch(() => {});
  }

  async #persistDomains() {
    await writeJsonAtomic(this.#domainsPath, {
      version: DOMAINS_SCHEMA_VERSION,
      domains: this.#domains,
      topics: this.#topics,
      ignoredCwds: this.#ignoredCwds,
    }).catch(() => {});
    const st = await stat(this.#domainsPath).catch(() => null);
    if (st?.mtimeMs) this.#domainsMtimeMs = st.mtimeMs;
  }

  async #readVaultProjectCards({ force = false } = {}) {
    if (!force && this.#vaultCardsCache.at > 0 && (Date.now() - this.#vaultCardsCache.at) < 60_000) {
      return this.#vaultCardsCache.cards;
    }
    const root = await resolveVaultPath({ env: this.#env, dataDir: this.#dataDir }).catch(() => "");
    if (!root) {
      this.#vaultCardsCache = { at: Date.now(), cards: [] };
      return [];
    }
    try {
      const vault = new MemoryVault(root);
      const rawCards = await vault.projectCards();
      const cards = rawCards.map((note) => {
        const meta = note?.meta || {};
        const cwds = []
          .concat(meta.cwd || [])
          .map((p) => normPath(p))
          .filter(Boolean);
        const bodyLines = String(note?.body || "")
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter((l) => l && !l.startsWith("#") && !l.startsWith("|") && !l.startsWith("-") && !l.startsWith(">"));
        return {
          topic: String(meta.topic || "").trim(),
          name: String(meta.name || meta.topic || "").trim(),
          domain: String(meta.domain || "").trim(),
          cwds,
          keywords: [].concat(meta.keywords || []).map((k) => String(k || "").trim()).filter(Boolean),
          aliases: [].concat(meta.aliases || []).map((a) => String(a || "").trim()).filter(Boolean),
          description: compactHeadline(bodyLines[0] || "", 80),
        };
      }).filter((c) => c.topic || c.cwds.length > 0);
      this.#vaultCardsCache = { at: Date.now(), cards };
      return cards;
    } catch {
      return this.#vaultCardsCache.cards || [];
    }
  }

  async #persistSparks() {
    await writeJsonAtomic(this.#sparksPath, this.#sparksState).catch(() => {});
  }

  async #persistMetrics() {
    await writeJsonAtomic(this.#metricsPath, this.#metricsStore).catch(() => {});
  }

  async #collectAllTopicMetrics({ force = false } = {}) {
    if (!force && (Date.now() - this.#autoMetricsCache.at) < 2 * 60 * 1000 && this.#autoMetricsCache.at > 0) {
      return this.#autoMetricsCache.byTopicId;
    }
    const byTopicId = new Map();

    // Per-repo standard `.agent-metrics.<topicId>.json` / `.agent-metrics.json` & package.json version
    const cwdTopicCounts = new Map();
    for (const topic of this.#topics) {
      const cwd = normPath(topic.primaryCwd);
      if (cwd) cwdTopicCounts.set(cwd, (cwdTopicCounts.get(cwd) || 0) + 1);
    }
    const normalizeKpiList = (list = []) => list.slice(0, 24).map((k) => ({
      key: String(k.key || k.label || "kpi"),
      label: String(k.label || "指标").slice(0, 18),
      value: String(k.value ?? "-").slice(0, 20),
      delta: String(k.delta || "").slice(0, 20),
      tone: String(k.tone || "growth"),
      ...(k.primary ? { primary: true } : {}),
    }));

    await Promise.all(this.#topics.map(async (topic) => {
      const cwd = normPath(topic.primaryCwd);
      if (!cwd) return;
      const isSharedCwd = (cwdTopicCounts.get(cwd) || 0) > 1;
      const scopedRaw = await readFile(resolve(cwd, `.agent-metrics.${topic.id}.json`), "utf8").catch(() => "");
      if (scopedRaw) {
        try {
          const parsed = JSON.parse(scopedRaw);
          if (Array.isArray(parsed?.kpis) && parsed.kpis.length) {
            byTopicId.set(topic.id, {
              source: "repo-file",
              updatedAt: String(parsed.updatedAt || ""),
              kpis: normalizeKpiList(parsed.kpis),
            });
            return;
          }
        } catch {}
      }

      const repoMetricsRaw = await readFile(resolve(cwd, ".agent-metrics.json"), "utf8").catch(() => "");
      if (repoMetricsRaw) {
        try {
          const parsed = JSON.parse(repoMetricsRaw);
          const byTopicEntry = parsed?.byTopic?.[topic.id];
          if (byTopicEntry && Array.isArray(byTopicEntry.kpis) && byTopicEntry.kpis.length) {
            byTopicId.set(topic.id, {
              source: "repo-file",
              updatedAt: String(byTopicEntry.updatedAt || parsed.updatedAt || ""),
              kpis: normalizeKpiList(byTopicEntry.kpis),
            });
            return;
          }
          const matchesTopic = parsed?.topicId ? parsed.topicId === topic.id : !isSharedCwd;
          if (matchesTopic && Array.isArray(parsed?.kpis) && parsed.kpis.length) {
            byTopicId.set(topic.id, {
              source: "repo-file",
              updatedAt: String(parsed.updatedAt || ""),
              kpis: normalizeKpiList(parsed.kpis),
            });
            return;
          }
        } catch {}
      }

      const pkgRaw = await readFile(resolve(cwd, "package.json"), "utf8").catch(() => "");
      if (pkgRaw) {
        try {
          const pkg = JSON.parse(pkgRaw);
          if (pkg?.version) {
            const existing = byTopicId.get(topic.id);
            const verKpi = { key: "version", label: "当前版本", value: `v${pkg.version}`, delta: "", tone: "bounty" };
            if (existing) {
              existing.kpis = [verKpi, ...existing.kpis].slice(0, 24);
            } else {
              byTopicId.set(topic.id, {
                source: "package-json",
                updatedAt: "",
                kpis: [verKpi],
              });
            }
          }
        } catch {}
      }
    }));

    // 3. Manual / API-pushed overrides in `<dataDir>/mission-metrics.json` take top precedence
    for (const [tid, saved] of Object.entries(this.#metricsStore.topics || {})) {
      if (saved && Array.isArray(saved.kpis) && saved.kpis.length) {
        byTopicId.set(tid, {
          source: saved.source || "manual",
          updatedAt: saved.updatedAt || "",
          kpis: saved.kpis,
        });
      }
    }

    this.#autoMetricsCache = { at: Date.now(), byTopicId };
    return byTopicId;
  }

  async #readProjectValueLedger() {
    if ((Date.now() - this.#valueLedgerCache.at) < 2 * 60 * 1000 && this.#valueLedgerCache.at > 0) {
      return this.#valueLedgerCache;
    }
    const byId = new Map();
    const byRoot = new Map();
    try {
      const parsed = JSON.parse(await readFile(this.#projectValuePath, "utf8"));
      const items = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.projects) ? parsed.projects : []);
      for (const item of items) {
        if (!item || typeof item !== "object") continue;
        const entry = {
          id: String(item.id || ""),
          name: String(item.name || ""),
          status: String(item.status || ""),
          nextReview: String(item.next_review || item.nextReview || ""),
        };
        if (entry.id) byId.set(entry.id, entry);
        if (item.root) byRoot.set(normPath(item.root), entry);
      }
    } catch {}
    this.#valueLedgerCache = { at: Date.now(), byId, byRoot };
    return this.#valueLedgerCache;
  }

  async #getGitSnapshotCached(cwd, { force = false } = {}) {
    const clean = normPath(cwd);
    if (!clean) return null;
    const hit = this.#gitCache.get(clean);
    if (!force && hit && (Date.now() - hit.at) < 5 * 60 * 1000) {
      return hit.value;
    }
    const value = await this.#collectGitImpl(clean).catch(() => null);
    this.#gitCache.set(clean, { at: Date.now(), value });
    return value;
  }

  #resolveEffectiveLocale(explicitLocale = "", threads = []) {
    const explicit = normalizeDiscoveryLocale(explicitLocale);
    if (explicit) {
      this.#lastRequestedLocale = explicit;
      return explicit;
    }
    if (this.#lastRequestedLocale) return this.#lastRequestedLocale;
    const inferred = inferThreadsDominantLang(threads);
    if (inferred) return inferred;
    const envLoc = normalizeDiscoveryLocale(
      this.#env?.AC_LOCALE || this.#env?.LC_ALL || this.#env?.LC_MESSAGES || this.#env?.LANG || "",
    );
    if (envLoc) return envLoc;
    try {
      const sysLoc = normalizeDiscoveryLocale(Intl.DateTimeFormat().resolvedOptions().locale || "");
      if (sysLoc) return sysLoc;
    } catch {}
    return "zh";
  }

  async #getRepoMetadataCached(cwd, { force = false } = {}) {
    const clean = normPath(cwd);
    if (!clean) return { zh: "", en: "", aliases: [] };
    const hit = this.#repoMetaCache.get(clean);
    if (!force && hit && (Date.now() - hit.at) < 5 * 60 * 1000) {
      return hit.value;
    }
    const value = await this.#readRepoMetaImpl(clean).catch(() => ({ zh: "", en: "", aliases: [] }));
    this.#repoMetaCache.set(clean, { at: Date.now(), value });
    return value;
  }

  #resolveThreadAssignment(thread, threadMeta = null) {
    const manualTopicId = String(threadMeta?.topicId || "").trim();
    if (manualTopicId && this.#topics.some((t) => t.id === manualTopicId)) {
      const topic = this.#topics.find((t) => t.id === manualTopicId);
      return {
        topicId: manualTopicId,
        stage: String(threadMeta?.stageTag || "").trim() || inferStageTag(thread, topic),
        secondaryTopicIds: [],
        source: "manual",
      };
    }

    const aiAssign = this.#cache.assignments?.[thread.id];
    if (aiAssign?.topicId && this.#topics.some((t) => t.id === aiAssign.topicId)) {
      const topic = this.#topics.find((t) => t.id === aiAssign.topicId);
      const sec = Array.isArray(aiAssign.secondaryTopicIds)
        ? aiAssign.secondaryTopicIds.filter((id) => id !== aiAssign.topicId && this.#topics.some((tp) => tp.id === id))
        : [];
      return {
        topicId: aiAssign.topicId,
        stage: String(aiAssign.stage || "").trim() || inferStageTag(thread, topic),
        secondaryTopicIds: sec,
        source: "ai",
      };
    }

    const ruleRes = classifyThreadRuleBased(thread, this.#topics);
    return {
      ...ruleRes,
      secondaryTopicIds: [],
    };
  }

  #isThreadActiveInWindow(thread, nowSec) {
    if (!thread) return false;
    if (thread.live || (Number(thread.pendingCount) || 0) > 0 || (Number(thread.queuedCount) || 0) > 0 || thread.goalState?.active) {
      return true;
    }
    const updatedSec = toEpochSeconds(thread.updatedAt);
    if (!updatedSec || !nowSec) return true;
    return (nowSec - updatedSec) <= this.#activeWindowSec;
  }

  async #collectAllGitSnapshots({ force = false } = {}) {
    const uniqueCwds = [...new Set(this.#topics.map((t) => normPath(t.primaryCwd)).filter(Boolean))];
    const entries = await Promise.all(
      uniqueCwds.map(async (cwd) => [cwd, await this.#getGitSnapshotCached(cwd, { force })]),
    );
    return Object.fromEntries(entries.filter(([, snap]) => Boolean(snap)));
  }

  #buildIncubator(cleanThreads = [], nowSec = Math.floor(Date.now() / 1000)) {
    const chilledSet = new Set(this.#sparksState.chilledIds || []);
    const activeEggs = [];
    const chilledEggs = [];
    const topicMap = new Map(this.#topics.map((t) => [t.id, t]));

    // 1. Manual boss sparks
    for (const sp of this.#sparksState.manualSparks || []) {
      if (!sp?.id || !sp.text) continue;
      const ageHours = Math.max(0, (nowSec - toEpochSeconds(sp.createdAt || nowSec)) / 3600);
      const fresh = sparkFreshnessMeta(ageHours);
      const tp = sp.topicId ? topicMap.get(sp.topicId) : null;
      const item = {
        id: sp.id,
        kind: "manual",
        title: sp.text,
        pitch: tp ? `定向孵化至「${tp.name}」产线` : "随手记录的灵光火种，破壳即可自动派发工位",
        topicId: sp.topicId || "",
        topicName: tp?.name || "待分配产线",
        primaryCwd: tp?.primaryCwd || "",
        threadId: "",
        createdAt: toEpochSeconds(sp.createdAt || nowSec),
        freshnessTier: fresh.tier,
        freshnessLabel: fresh.label,
      };
      if (chilledSet.has(item.id)) chilledEggs.push(item);
      else activeEggs.push(item);
    }

    // 2. AI + Heuristic salvaged dormant/exploratory spark threads ("昨天的灵光一闪")
    const aiSparkMap = new Map(
      (this.#sparksState.aiSparks || [])
        .filter((s) => s?.threadId)
        .map((s) => [s.threadId, s]),
    );

    const candidateThreads = [];
    for (const t of cleanThreads) {
      if (t.live || (Number(t.pendingCount) || 0) > 0 || isScratchNoiseCwd(t.cwd)) continue;
      const updatedSec = toEpochSeconds(t.updatedAt);
      if (!updatedSec) continue;
      const ageSec = Math.max(0, nowSec - updatedSec);
      if (ageSec > DEFAULT_SPARK_WINDOW_SEC) continue;

      const sparkId = `thread:${t.id}`;
      const aiHit = aiSparkMap.get(t.id);
      const text = `${t.title || ""} ${t.firstUserText || ""} ${t.preview || ""}`;
      const looksLikeIdea = /灵感|想法|构想|能不能|试试|做个|新做|原型|mvp|立项|方案|打算|孵化|脑暴|grill-me|\/plan/i.test(text);
      const isDormantShort = ageSec >= 6 * 3600 && (looksLikeIdea || Boolean(aiHit));

      if (!aiHit && !isDormantShort) continue;
      const ruleAssign = classifyThreadRuleBased(t, this.#topics);
      const tp = (aiHit?.topicId && topicMap.get(aiHit.topicId))
        || (ruleAssign.topicId && topicMap.get(ruleAssign.topicId))
        || null;
      const ageHours = ageSec / 3600;
      const fresh = sparkFreshnessMeta(ageHours);
      candidateThreads.push({
        id: sparkId,
        kind: "thread",
        title: aiHit?.title || compactHeadline(t.title || t.firstUserText || "未命名灵感会话", 28),
        pitch: aiHit?.pitch || compactHeadline(t.preview || t.firstUserText || "搁置中的探索对话，可一键唤醒继续推进", 44),
        topicId: tp?.id || "",
        topicName: tp?.name || "独立探索新物种",
        primaryCwd: tp?.primaryCwd || t.cwd || "",
        threadId: t.id,
        createdAt: updatedSec,
        freshnessTier: fresh.tier,
        freshnessLabel: fresh.label,
        score: (aiHit ? 200 : 0) + (ageHours <= 42 ? 120 : 40) + (looksLikeIdea ? 60 : 0),
      });
    }

    candidateThreads.sort((a, b) => (b.score - a.score) || (b.createdAt - a.createdAt));
    for (const item of candidateThreads.slice(0, 8)) {
      if (chilledSet.has(item.id)) chilledEggs.push(item);
      else activeEggs.push(item);
    }

    return {
      eggs: activeEggs.slice(0, 6),
      chilled: chilledEggs.slice(0, 12),
      totalActive: activeEggs.length,
      chilledCount: chilledEggs.length,
    };
  }

  #buildBossFocus(flatTopics = []) {
    const pinnedSet = new Set(this.#cache.pinnedFocusIds || []);
    const scored = flatTopics.map((tp) => {
      const isBossPinned = pinnedSet.has(tp.id);
      const yieldPrio = YIELD_META[tp.yieldType]?.priority || 1;
      const hasActivity = tp.activeThreads.length > 0 || (tp.gitSnapshot?.dirtyCount || 0) > 0 || isBossPinned;
      const score = (isBossPinned ? 10000 : 0)
        + (tp.pendingCount > 0 ? 850 + tp.pendingCount * 40 : 0)
        + (tp.pipeline.readyToHarvest ? 360 + yieldPrio * 75 : 0)
        + (tp.liveCount > 0 ? 240 + tp.liveCount * 20 : 0)
        + (tp.pipeline.stageIndex * 45)
        + (yieldPrio * 25)
        + Math.min(tp.activeThreads.length, 15) * 4;
      return { tp, isBossPinned, hasActivity, score };
    }).filter((x) => x.hasActivity);

    scored.sort((a, b) => (b.score - a.score) || ((b.tp.latestUpdatedAt || 0) - (a.tp.latestUpdatedAt || 0)));

    return scored.slice(0, 3).map(({ tp, isBossPinned }) => ({
      topicId: tp.id,
      name: tp.name,
      domainId: tp.domainId,
      primaryCwd: tp.primaryCwd,
      yieldType: tp.yieldType || "growth",
      yieldLabel: tp.yieldLabel || YIELD_META[tp.yieldType]?.label || "产线推进",
      stageIndex: tp.pipeline.stageIndex,
      stageLabel: tp.pipeline.stageLabel,
      readyToHarvest: tp.pipeline.readyToHarvest,
      isBossPinned,
      liveCount: tp.liveCount,
      pendingCount: tp.pendingCount,
      dirtyCount: tp.gitSnapshot?.dirtyCount || 0,
      bottleneck: tp.pipeline.bottleneck || tp.summary?.nextStep || "继续推进核心交付",
      nextStep: tp.summary?.nextStep || "推进当前阶段目标",
    }));
  }

  #assembleSnapshot(rawThreads = [], { gitSnapshots = {}, ledger = null, metricsMap = null, nowMs = Date.now() } = {}) {
    const nowSec = Math.floor(nowMs / 1000);
    const metaMap = typeof this.#hub?.listThreadsMeta === "function" ? this.#hub.listThreadsMeta() : {};
    const topicById = new Map(this.#topics.map((t) => [t.id, t]));

    const cleanThreads = (Array.isArray(rawThreads) ? rawThreads : [])
      .filter((t) => t && t.id && !t.archived && !metaMap[t.id]?.internal && !isInternalOverviewThread(t));

    const topicBuckets = new Map();
    for (const topic of this.#topics) {
      topicBuckets.set(topic.id, { active: [], archived: [] });
    }
    const unassignedActive = [];
    const unassignedArchived = [];
    const activePoolForFingerprint = [];

    for (const t of cleanThreads) {
      const threadMeta = metaMap[t.id] || null;
      const assignment = this.#resolveThreadAssignment(t, threadMeta);
      const isScratch = isScratchNoiseCwd(t.cwd);
      const isActive = this.#isThreadActiveInWindow(t, nowSec);

      if (!assignment.topicId && isScratch && !t.live && !(t.pendingCount > 0)) {
        continue;
      }

      const targetTopic = assignment.topicId ? topicById.get(assignment.topicId) : null;
      const isCrossWorkspace = Boolean(
        targetTopic?.primaryCwd
        && t.cwd
        && !pathMatchesPrefix(t.cwd, targetTopic.primaryCwd)
        && !(targetTopic.cwdPrefixes || []).some((p) => pathMatchesPrefix(t.cwd, p)),
      );

      const fp = extractThreadFootprints(t);
      const secondaryIds = assignment.source === "manual"
        ? []
        : [
            ...new Set([
              ...(assignment.secondaryTopicIds || []),
              ...detectSecondaryTopicIds(t, assignment.topicId, this.#topics),
            ]),
          ].filter((id) => id && id !== assignment.topicId && topicBuckets.has(id));

      const enriched = {
        id: t.id,
        provider: t.provider,
        profileId: t.profileId || "",
        title: t.title || "新会话",
        preview: t.preview || "",
        cwd: t.cwd || "",
        pinned: Boolean(t.pinned),
        updatedAt: toEpochSeconds(t.updatedAt),
        live: Boolean(t.live),
        livePhase: t.livePhase || "",
        pendingCount: Number(t.pendingCount) || 0,
        queuedCount: Number(t.queuedCount) || 0,
        goalState: t.goalState || null,
        assistantTail: threadTail(t),
        lastError: t.lastError || "",
        lastTurnStatus: t.lastTurnStatus || "",
        topicId: assignment.topicId,
        stage: assignment.stage,
        assignmentSource: assignment.source,
        isCrossWorkspace,
        allFootprints: fp.allLabels,
        footprints: fp.hiddenFootprints,
        driftedFrom: fp.driftedFrom,
        isMultiTaskSession: Boolean(fp.isMultiTask || secondaryIds.length > 0),
        secondaryTopicIds: secondaryIds,
        isSlice: false,
        sliceFromTopicName: "",
      };

      if (isActive) {
        activePoolForFingerprint.push(enriched);
      }

      if (assignment.topicId && topicBuckets.has(assignment.topicId)) {
        const bucket = topicBuckets.get(assignment.topicId);
        if (isActive) bucket.active.push(enriched);
        else bucket.archived.push(enriched);
      } else {
        if (isActive) unassignedActive.push(enriched);
        else unassignedArchived.push(enriched);
      }

      // Reverse-slice multi-project sessions into secondary topics they touched so nothing gets lost!
      if (isActive && secondaryIds.length > 0) {
        for (const secTopicId of secondaryIds) {
          const secBucket = topicBuckets.get(secTopicId);
          const secTopic = topicById.get(secTopicId);
          if (!secBucket || !secTopic) continue;
          secBucket.active.push({
            ...enriched,
            topicId: secTopicId,
            stage: inferStageTag(t, secTopic),
            isSlice: true,
            sliceFromTopicId: assignment.topicId,
            sliceFromTopicName: targetTopic?.name || "其他会话",
            footprints: fp.allLabels.slice(0, 3),
          });
        }
      }
    }

    const sortByRecency = (a, b) => {
      if (Boolean(a.isSlice) !== Boolean(b.isSlice)) {
        // Keep primary sessions slightly ahead only when urgency ties, unless slice is live/pending
        const aUrg = (a.pendingCount > 0 ? 2 : 0) + (a.live ? 1 : 0);
        const bUrg = (b.pendingCount > 0 ? 2 : 0) + (b.live ? 1 : 0);
        if (aUrg !== bUrg) return bUrg - aUrg;
      }
      const aUrgent = (a.pendingCount > 0 ? 2 : 0) + (a.live ? 1 : 0);
      const bUrgent = (b.pendingCount > 0 ? 2 : 0) + (b.live ? 1 : 0);
      if (aUrgent !== bUrgent) return bUrgent - aUrgent;
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    };

    const pinnedFocusSet = new Set(this.#cache.pinnedFocusIds || []);

    const domainsOut = [...this.#domains]
      .sort((a, b) => (a.order || 99) - (b.order || 99))
      .map((domain) => {
        const domainTopics = this.#topics
          .filter((t) => t.domainId === domain.id)
          .sort((a, b) => (a.order || 99) - (b.order || 99))
          .map((topic) => {
            const bucket = topicBuckets.get(topic.id) || { active: [], archived: [] };
            bucket.active.sort(sortByRecency);
            bucket.archived.sort(sortByRecency);
            const primaryOnly = bucket.active.filter((t) => !t.isSlice);
            const sliceCount = bucket.active.length - primaryOnly.length;
            const gitSnap = gitSnapshots[normPath(topic.primaryCwd)] || null;
            const cachedSummary = this.#cache.topicSummaries?.[topic.id] || null;
            const fallbackSummary = buildFallbackTopicSummary(topic, bucket.active, gitSnap);
            const summary = cachedSummary?.progress
              ? {
                  progress: cachedSummary.progress,
                  nextStep: cachedSummary.nextStep || fallbackSummary.nextStep,
                  updatedAt: cachedSummary.updatedAt || this.#cache.lastSummarizedAt || 0,
                  source: "ai",
                }
              : { ...fallbackSummary, updatedAt: 0 };

            const liveCount = primaryOnly.filter((t) => t.live).length;
            const pendingCount = primaryOnly.reduce((sum, t) => sum + (t.pendingCount || 0), 0);
            const queuedCount = primaryOnly.reduce((sum, t) => sum + (t.queuedCount || 0), 0);
            const latestUpdatedAt = bucket.active[0]?.updatedAt || bucket.archived[0]?.updatedAt || 0;

            const pipeline = inferPipelineStage(topic, primaryOnly, gitSnap, cachedSummary);
            const workerPods = buildWorkerPods(bucket.active);
            const valueEntry = (topic.ledgerId && ledger?.byId?.get(topic.ledgerId))
              || (topic.primaryCwd && ledger?.byRoot?.get(normPath(topic.primaryCwd)))
              || null;

            const yieldType = topic.yieldType || "growth";
            const yieldLabel = topic.yieldLabel || YIELD_META[yieldType]?.label || "产线推进";
            const landmark = topic.landmark || DEFAULT_LANDMARK_BY_TOPIC[topic.id] || inferLandmarkForTopic(topic, topic.order || 0);
            const rawMetrics = metricsMap?.get(topic.id) || null;
            const topicCwdNorm = normPath(topic.primaryCwd);
            const sharedCwdCount = topicCwdNorm
              ? this.#topics.filter((t) => normPath(t.primaryCwd) === topicCwdNorm).length
              : 0;
            const metricsFileName = sharedCwdCount > 1 ? `.agent-metrics.${topic.id}.json` : ".agent-metrics.json";
            const syncPrompt = `请尽可能全面采集「${topic.name}」所有能拿到的重要业务与创收指标（包含变现/收入/付费、阅读/播放/流量、粉丝/订阅/Star、转化率/完播/留存、发布与待办规模等各维度，尽量采集全量明细不要遗漏，且只采集「${topic.name}」自身口径，勿混入同目录其他产线）；将最核心的 3~6 项指标标为 "primary":true 并排在最前，其余次级或分平台指标按重要程度依次排在后面（最多 20 项），按 {"topicId":"${topic.id}","updatedAt":"YYYY-MM-DD HH:mm","kpis":[{"key":"main","label":"指标名","value":"数值","delta":"趋势或统计口径","tone":"coin|growth|bounty|shield","primary":true}]} 格式写入 ${topic.primaryCwd || "项目目录"}/${metricsFileName}`;
            const metrics = {
              kpis: Array.isArray(rawMetrics?.kpis) ? rawMetrics.kpis : [],
              updatedAt: rawMetrics?.updatedAt || "",
              source: rawMetrics?.source || "",
              syncPrompt,
            };

            // Collect unique active providers in this topic for studio sprite rendering
            const activeProviders = [...new Set(primaryOnly.filter((t) => t.live).map((t) => t.provider))];
            const recentProviders = [...new Set(primaryOnly.slice(0, 4).map((t) => t.provider))];

            const uniquePrefixes = [];
            const seenPrefixes = new Set();
            for (const p of [topic.primaryCwd, ...(topic.cwdPrefixes || [])]) {
              const np = normPath(p);
              if (!np || seenPrefixes.has(np)) continue;
              seenPrefixes.add(np);
              uniquePrefixes.push(np);
            }
            let subProjects = [];
            if (uniquePrefixes.length >= 2) {
              const primaryNorm = normPath(topic.primaryCwd);
              const baseCounts = new Map();
              for (const p of uniquePrefixes) {
                const b = basename(p) || p;
                baseCounts.set(b, (baseCounts.get(b) || 0) + 1);
              }
              const subMap = new Map(uniquePrefixes.map((cwd, sIdx) => {
                const base = basename(cwd) || cwd;
                const parent = basename(dirname(cwd));
                const name = (baseCounts.get(base) || 0) > 1 && parent ? `${parent}/${base}` : base;
                return [cwd, {
                  id: `${topic.id}::sub-${sIdx + 1}`,
                  name,
                  cwd,
                  isPrimary: cwd === primaryNorm,
                  order: sIdx,
                  activeCount: 0,
                  liveCount: 0,
                  pendingCount: 0,
                  archivedCount: 0,
                  latestUpdatedAt: 0,
                }];
              }));
              const matchSubPrefix = (threadCwd) => {
                const nc = normPath(threadCwd);
                if (!nc) return "";
                let best = "";
                for (const prefix of uniquePrefixes) {
                  if (pathMatchesPrefix(nc, prefix) && prefix.length > best.length) {
                    best = prefix;
                  }
                }
                return best;
              };
              for (const th of primaryOnly) {
                const matched = matchSubPrefix(th.cwd);
                const entry = matched ? subMap.get(matched) : null;
                if (!entry) continue;
                entry.activeCount += 1;
                if (th.live) entry.liveCount += 1;
                entry.pendingCount += Number(th.pendingCount) || 0;
                if ((th.updatedAt || 0) > entry.latestUpdatedAt) entry.latestUpdatedAt = th.updatedAt || 0;
              }
              for (const th of bucket.archived) {
                const matched = matchSubPrefix(th.cwd);
                const entry = matched ? subMap.get(matched) : null;
                if (!entry) continue;
                entry.archivedCount += 1;
                if ((th.updatedAt || 0) > entry.latestUpdatedAt) entry.latestUpdatedAt = th.updatedAt || 0;
              }
              subProjects = [...subMap.values()]
                .sort((a, b) => (
                  ((b.pendingCount > 0 ? 1 : 0) - (a.pendingCount > 0 ? 1 : 0))
                  || ((b.liveCount > 0 ? 1 : 0) - (a.liveCount > 0 ? 1 : 0))
                  || ((b.activeCount > 0 ? 1 : 0) - (a.activeCount > 0 ? 1 : 0))
                  || ((b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0))
                  || (b.latestUpdatedAt - a.latestUpdatedAt)
                  || (a.order - b.order)
                ))
                .map(({ order: _order, ...rest }) => rest);
            }

            return {
              ...topic,
              landmark,
              yieldType,
              yieldLabel,
              isBossPinned: pinnedFocusSet.has(topic.id),
              agentAffinity: computeAgentAffinity(primaryOnly, bucket.archived).slice(0, 3),
              agentPref: String(this.#cache.topicAgentPrefs?.[topic.id]?.agentKey || ""),
              pipeline,
              readyToHarvest: pipeline.readyToHarvest,
              harvestEvidence: pipeline.harvestEvidence,
              harvestInferred: pipeline.harvestInferred,
              valueLedger: valueEntry,
              metrics,
              archiveDigest: this.#contextsStore.topics?.[topic.id] || null,
              workerPods,
              subProjects,
              sliceCount,
              activeProviders: activeProviders.length ? activeProviders : recentProviders.slice(0, 2),
              activeThreads: bucket.active,
              primaryActiveCount: primaryOnly.length,
              archivedThreads: bucket.archived,
              archivedCount: bucket.archived.length,
              liveCount,
              pendingCount,
              queuedCount,
              latestUpdatedAt,
              gitSnapshot: gitSnap,
              summary,
            };
          });

        const roomLiveCount = domainTopics.reduce((s, tp) => s + tp.liveCount, 0);
        const roomPendingCount = domainTopics.reduce((s, tp) => s + tp.pendingCount, 0);
        const roomHarvestCount = domainTopics.filter((tp) => tp.pipeline?.readyToHarvest).length;
        const roomSprites = [...new Set(domainTopics.flatMap((tp) => tp.activeProviders || []))].slice(0, 3);

        return {
          ...domain,
          liveCount: roomLiveCount,
          pendingCount: roomPendingCount,
          harvestCount: roomHarvestCount,
          sprites: roomSprites.length ? roomSprites : ["codex"],
          topics: domainTopics,
        };
      });

    unassignedActive.sort(sortByRecency);
    unassignedArchived.sort(sortByRecency);

    const flatTopics = domainsOut.flatMap((d) => d.topics);
    const bossFocus = this.#buildBossFocus(flatTopics);
    const incubator = this.#buildIncubator(cleanThreads, nowSec);

    const radar = {
      liveThreads: activePoolForFingerprint.filter((t) => t.live).sort(sortByRecency),
      pendingThreads: activePoolForFingerprint.filter((t) => t.pendingCount > 0).sort(sortByRecency),
      totalActiveCount: activePoolForFingerprint.length,
      driftedCount: activePoolForFingerprint.filter((t) => t.isMultiTaskSession).length,
      harvestReadyCount: flatTopics.filter((t) => t.pipeline?.readyToHarvest).length,
    };

    const activeFingerprint = buildOverviewFingerprint(activePoolForFingerprint, gitSnapshots);
    const cooldownMs = Number(this.#cache.cooldownMs) || this.#cooldownMs;

    return {
      domains: domainsOut,
      topics: this.#topics.map((t) => ({
        id: t.id,
        name: t.name,
        domainId: t.domainId,
        primaryCwd: t.primaryCwd,
        yieldType: t.yieldType || "growth",
      })),
      bossFocus,
      incubator,
      pipelineStages: PIPELINE_STAGES,
      unassignedActive,
      unassignedArchivedCount: unassignedArchived.length,
      radar,
      meta: {
        lastSummarizedAt: this.#cache.lastSummarizedAt || 0,
        cooldownMs,
        preferredModel: this.#cache.preferredModel || "auto",
        lastModelUsed: this.#cache.lastModelUsed || "",
        lastError: this.#cache.lastError || "",
        summarizing: Boolean(this.#inFlightPromise),
        activeFingerprint,
        modelOptions: OVERVIEW_MODEL_OPTIONS,
        dispatchPrefs: normalizeDispatchPrefs(this.#cache.dispatchPrefs),
        dispatchPriorityStrategies: DISPATCH_PRIORITY_STRATEGIES,
      },
    };
  }

  async #syncDiscoveredTopics(rawThreads = [], { forceRescan = false, clearExisting = false } = {}) {
    const hadTopicsBefore = !clearExisting && this.#topics.length > 0;
    if (clearExisting) {
      this.#topics = [];
      this.#ignoredCwds = [];
    }

    const metaMap = typeof this.#hub?.listThreadsMeta === "function" ? this.#hub.listThreadsMeta() : {};
    const nowSec = Math.floor(Date.now() / 1000);
    const ignoredSet = clearExisting ? [] : this.#ignoredCwds;
    const isIgnored = (cwd) => ignoredSet.some((ign) => pathMatchesPrefix(cwd, ign));
    const vaultCards = await this.#readVaultProjectCards({ force: forceRescan });

    const byCwd = new Map();
    for (const t of Array.isArray(rawThreads) ? rawThreads : []) {
      if (!t || t.archived || t.internal || metaMap[t.id]?.internal || isInternalOverviewThread(t)) continue;
      const cwd = normPath(t.cwd);
      if (!cwd || isNonProjectDiscoveryCwd(cwd, this.#topics) || isCwdCoveredByTopics(cwd, this.#topics) || isIgnored(cwd)) {
        continue;
      }
      let bucket = byCwd.get(cwd);
      if (!bucket) {
        bucket = { cwd, threads: [], latestAt: 0, vaultCard: null, hasActiveWindow: false };
        byCwd.set(cwd, bucket);
      }
      bucket.threads.push(t);
      const upd = toEpochSeconds(t.updatedAt);
      if (upd > bucket.latestAt) bucket.latestAt = upd;
      if (this.#isThreadActiveInWindow(t, nowSec)) bucket.hasActiveWindow = true;
    }

    for (const card of vaultCards) {
      for (const rawCwd of card.cwds || []) {
        const cwd = normPath(rawCwd);
        if (!cwd || isNonProjectDiscoveryCwd(cwd, this.#topics) || isCwdCoveredByTopics(cwd, this.#topics) || isIgnored(cwd)) {
          continue;
        }
        let bucket = byCwd.get(cwd);
        if (!bucket) {
          bucket = { cwd, threads: [], latestAt: nowSec, vaultCard: card, hasActiveWindow: true };
          byCwd.set(cwd, bucket);
        } else if (!bucket.vaultCard) {
          bucket.vaultCard = card;
          bucket.hasActiveWindow = true;
        }
      }
    }

    this.#lastSyncDiscoverAt = Date.now();
    if (!byCwd.size) return { changed: false, added: [] };

    const keptBuckets = [];
    for (const bucket of byCwd.values()) {
      if (hadTopicsBefore && !forceRescan) {
        if (!bucket.vaultCard && !bucket.hasActiveWindow && bucket.threads.length < 2) continue;
      }
      if (!bucket.vaultCard && vaultCards.length) {
        const folderLower = (basename(bucket.cwd) || "").toLowerCase();
        bucket.vaultCard = vaultCards.find((card) => (
          card.cwds.some((c) => pathMatchesPrefix(bucket.cwd, c))
          || (folderLower && card.topic && card.topic.toLowerCase() === folderLower)
        )) || null;
      }
      keptBuckets.push(bucket);
    }
    if (!keptBuckets.length) return { changed: false, added: [] };

    // Merge child sub-directories into the shallowest uncovered parent candidate
    keptBuckets.sort((a, b) => (a.cwd.length - b.cwd.length) || (b.latestAt - a.latestAt));
    const mergedBuckets = [];
    for (const cand of keptBuckets) {
      const parent = mergedBuckets.find((p) => pathMatchesPrefix(cand.cwd, p.cwd));
      if (parent) {
        parent.threads.push(...cand.threads);
        if (cand.latestAt > parent.latestAt) parent.latestAt = cand.latestAt;
        if (cand.hasActiveWindow) parent.hasActiveWindow = true;
        if (!parent.vaultCard && cand.vaultCard) parent.vaultCard = cand.vaultCard;
      } else {
        mergedBuckets.push(cand);
      }
    }

    const capacityLeft = Math.max(0, 80 - this.#topics.length);
    if (!capacityLeft) return { changed: false, added: [] };

    const sortedWorkspaces = mergedBuckets
      .sort((a, b) => (b.latestAt - a.latestAt) || (b.threads.length - a.threads.length))
      .slice(0, capacityLeft);

    const usedIds = new Set(this.#topics.map((t) => t.id));
    const nextOrderBase = this.#topics.reduce((max, t) => Math.max(max, Number(t.order) || 0), 0);
    const added = sortedWorkspaces.map((ws, idx) => {
      const folderName = basename(ws.cwd) || `workspace-${idx + 1}`;
      const preferredSlug = String(ws.vaultCard?.topic || "").trim();
      const baseSlug = (preferredSlug || folderName)
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
        .replace(/^-+|-+$/g, "") || `repo-${idx + 1}`;
      let id = baseSlug;
      let suffix = 2;
      while (usedIds.has(id)) {
        id = `${baseSlug}-${suffix}`;
        suffix += 1;
      }
      usedIds.add(id);

      const sampleText = ws.threads.slice(0, 8).map((t) => `${t.title || ""} ${t.preview || ""}`).join(" ").toLowerCase();
      const vaultDomain = ws.vaultCard?.domain ? this.#findDomainByQuery(ws.vaultCard.domain) : null;
      let domainId = vaultDomain?.id || "indie-lab";
      let yieldType = "growth";
      const hay = `${folderName} ${ws.vaultCard?.name || ""} ${sampleText}`.toLowerCase();
      if (/(video|story|novel|script|media|design|content|drama|comic|manga|movie|audio|music|视频|小说|创作|漫剧|短剧|分镜|动画)/.test(hay)) {
        if (!vaultDomain) domainId = "drama-studio";
        yieldType = "coin";
      } else if (/(seo|publish|social|marketing|youtube|tiktok|growth|推广|发行|出海|运营|引流)/.test(hay)) {
        if (!vaultDomain) domainId = "global-pub";
        yieldType = "growth";
      } else if (/(ops|support|bug|issue|infra|deploy|health|life|finance|stock|client|运维|排查|体检|医疗|炒股|投研|客户|专项)/.test(hay)) {
        if (!vaultDomain) domainId = "bounty-guild";
        yieldType = "bounty";
      }

      const recentTitles = ws.threads
        .slice(0, 2)
        .map((t) => compactHeadline(t.title || "", 18))
        .filter(Boolean);
      const description = ws.vaultCard?.description
        || (recentTitles.length
          ? `自动发现本地仓库 · 近期：${recentTitles.join(" / ")}`
          : `自动发现本地工作区：${ws.cwd}`);

      const kwSet = new Set([
        folderName.toLowerCase(),
        ...(ws.vaultCard?.keywords || []).map((k) => k.toLowerCase()),
        ...(ws.vaultCard?.aliases || []).map((a) => a.toLowerCase()),
      ].filter(Boolean));
      const cwds = [...new Set([ws.cwd, ...(ws.vaultCard?.cwds || []).filter((c) => pathMatchesPrefix(c, ws.cwd))])];
      const topicObj = {
        id,
        domainId,
        name: ws.vaultCard?.name || folderName,
        description,
        primaryCwd: ws.cwd,
        cwdPrefixes: cwds,
        keywords: [...kwSet],
        yieldType,
        yieldLabel: YIELD_META[yieldType]?.label || "产线推进",
        ledgerId: "",
        pinned: !hadTopicsBefore && idx < 4,
        autoDiscovered: true,
        order: nextOrderBase + idx + 1,
      };
      topicObj.landmark = inferLandmarkForTopic(topicObj, this.#topics.length + idx);
      return topicObj;
    });

    this.#topics = [...this.#topics, ...added];
    if (!clearExisting && this.#ignoredCwds.length && added.length) {
      const addedCwds = added.flatMap((t) => [t.primaryCwd, ...(t.cwdPrefixes || [])].filter(Boolean));
      this.#ignoredCwds = this.#ignoredCwds.filter((ign) => !addedCwds.some((c) => pathMatchesPrefix(c, ign)));
    }
    await this.#persistDomains();
    this.#autoMetricsCache.at = 0;
    return { changed: true, added };
  }

  async syncProjects({ clearExisting = false } = {}) {
    await this.#ensureLoaded();
    const listRes = typeof this.#hub?.listThreads === "function"
      ? await this.#hub.listThreads({ includeArchived: false, limit: 500 }).catch(() => ({ threads: [] }))
      : { threads: [] };
    const rawThreads = Array.isArray(listRes) ? listRes : (Array.isArray(listRes?.threads) ? listRes.threads : []);
    const res = await this.#syncDiscoveredTopics(rawThreads, {
      forceRescan: true,
      clearExisting: Boolean(clearExisting),
    });
    const overview = await this.getOverview({ trigger: "view", force: false });
    if (this.#broadcast) this.#broadcast("overview_updated", overview);
    return {
      ok: true,
      addedCount: res.added.length,
      addedTopics: res.added,
      overview,
    };
  }

  async getOverview({ trigger = "view", force = false } = {}) {
    await this.#ensureLoaded();
    const listRes = typeof this.#hub?.listThreads === "function"
      ? await this.#hub.listThreads({ includeArchived: false, limit: 500 })
      : { threads: [] };
    const rawThreads = await this.assistant.readThreadEvidence((listRes?.threads || []).filter((t) => !isInternalOverviewThread(t)));
    await this.#syncDiscoveredTopics(rawThreads);

    const [gitSnapshots, ledger, metricsMap] = await Promise.all([
      this.#collectAllGitSnapshots({ force }),
      this.#readProjectValueLedger(),
      this.#collectAllTopicMetrics({ force }),
    ]);
    const snapshot = this.#assembleSnapshot(rawThreads, { gitSnapshots, ledger, metricsMap });

    const nowMs = Date.now();
    const cooldownMs = Number(this.#cache.cooldownMs) || this.#cooldownMs;
    const expired = !this.#cache.lastSummarizedAt || (nowMs - this.#cache.lastSummarizedAt) >= cooldownMs;
    const changed = snapshot.meta.activeFingerprint !== this.#cache.lastFingerprint;
    const shouldRefresh = force || (trigger === "open" && expired && changed);

    if (shouldRefresh && !this.#inFlightPromise) {
      void this.triggerRefresh({ force, rawThreads, gitSnapshots }).catch(() => {});
      snapshot.meta.summarizing = true;
    }

    return this.assistant.decorateOverview(snapshot);
  }

  async triggerRefresh({
    force = true,
    preferredModel = "",
    cooldownMinutes = 0,
    rawThreads = null,
    gitSnapshots = null,
  } = {}) {
    await this.#ensureLoaded();
    if (preferredModel) {
      const valid = OVERVIEW_MODEL_OPTIONS.some((o) => o.key === preferredModel);
      if (valid) this.#cache.preferredModel = preferredModel;
    }
    if (Number(cooldownMinutes) >= 1 && Number(cooldownMinutes) <= 24 * 60) {
      this.#cache.cooldownMs = Math.round(Number(cooldownMinutes) * 60 * 1000);
    }

    if (this.#inFlightPromise) {
      return this.#inFlightPromise;
    }

    this.#inFlightPromise = (async () => {
      try {
        const threads = rawThreads || (await this.#hub?.listThreads?.({ includeArchived: false, limit: 500 }))?.threads || [];
        const [snaps, ledger] = await Promise.all([
          gitSnapshots || this.#collectAllGitSnapshots({ force: true }),
          this.#readProjectValueLedger(),
        ]);
        const preSnapshot = this.#assembleSnapshot(threads, { gitSnapshots: snaps, ledger });
        const activeThreads = [
          ...preSnapshot.domains.flatMap((d) => d.topics.flatMap((t) => t.activeThreads.filter((x) => !x.isSlice))),
          ...preSnapshot.unassignedActive,
        ];

        const prompt = this.#buildOverviewPrompt(preSnapshot, activeThreads, snaps, threads);
        const aiResult = await this.#invokeLightweightModel(prompt, this.#cache.preferredModel || "auto");
        if (aiResult?.parsed) {
          await this.#applyAiResult(aiResult.parsed, activeThreads);
          this.#cache.lastSummarizedAt = Date.now();
          this.#cache.lastFingerprint = preSnapshot.meta.activeFingerprint;
          this.#cache.lastModelUsed = aiResult.modelLabel || this.#cache.preferredModel || "auto";
          this.#cache.lastError = "";
          await this.#persistCache();
        } else {
          this.#cache.lastError = aiResult?.error || "模型未返回有效 JSON 汇总";
          await this.#persistCache();
        }
      } catch (err) {
        this.#cache.lastError = err?.message || "汇总执行失败";
        await this.#persistCache();
      } finally {
        this.#inFlightPromise = null;
        if (this.#broadcast) {
          const fresh = await this.getOverview({ trigger: "view", force: false }).catch(() => null);
          if (fresh) this.#broadcast("overview_updated", fresh);
        }
      }
    })();

    return this.#inFlightPromise;
  }

  #buildOverviewPrompt(snapshot, activeThreads = [], gitSnapshots = {}, rawThreads = []) {
    const topicLines = this.#topics.map((t) => {
      const snap = gitSnapshots[normPath(t.primaryCwd)];
      const gitLine = snap
        ? ` | Git: commits=[${(snap.commits || []).slice(0, 2).join("; ")}], dirty=${snap.dirtyCount || 0}`
        : "";
      return `- ${t.id} (${t.name}, 收益类型=${t.yieldLabel || t.yieldType}): ${t.description}${gitLine}`;
    }).join("\n");

    const rawById = new Map((rawThreads || []).map((r) => [r.id, r]));
    const threadLines = activeThreads.slice(0, 48).map((t) => {
      const raw = rawById.get(t.id) || {};
      const firstHint = compactHeadline(raw.firstUserText || "", 32);
      const preview = String(t.preview || "").replace(/\s+/g, " ").trim().slice(0, 120);
      const flags = [
        t.live ? "运行中" : "",
        t.pendingCount > 0 ? `待确认${t.pendingCount}` : "",
        t.assignmentSource === "manual" ? `已锁定=${t.topicId}` : `初分=${t.topicId || "待定"}`,
        firstHint && firstHint !== compactHeadline(t.title, 32) ? `首句="${firstHint}"` : "",
      ].filter(Boolean).join(",");
      return `- id="${t.id}" | cwd="${t.cwd}" | title="${t.title}" | tail="${preview}" | [${flags}]`;
    }).join("\n");

    return [
      "你是「一人 AI 梦工厂」工作室厂长参谋。请根据「核心产线版图」与「近 7 天活跃会话」输出严格 JSON：",
      "任务 1（会话归位与一会话多项目切片）：把会话归入最准确的 topicId，给出简短 stage（研发 / 宣传片·动效 / 商业化·推广 / 出海运营 / 内容生产 / 问题排查）。若某会话首句与当前标题跨了多个项目（一会话改了多个项目），请在 secondaryTopicIds 填入次要 topicId 数组。已标注「已锁定=xxx」的不要改。",
      "任务 2（产线 5 阶进度与临门一脚诊断）：为活跃产线评估 stageIndex（1=立项, 2=研发, 3=打磨, 4=宣发, 5=收菜变现）、progress（务实进展 25~50字）、nextStep（下一步可执行动作 15~32字）及 bottleneck（距变现/涨粉差哪临门一脚，20字内）。",
      "任务 3（昨日灵光打捞）：挑出最多 3 条近期聊过几句但未做完的高价值新点子/灵光会话填入 sparks。",
      "",
      "【核心产线版图】",
      topicLines,
      "",
      "【近 7 天活跃会话】",
      threadLines || "(无)",
      "",
      "严格仅输出如下 JSON，不要任何 Markdown 解释：",
      '{"assignments":{"<threadId>":{"topicId":"<topicId>","stage":"<stage>","secondaryTopicIds":[]}},"topics":{"<topicId>":{"stageIndex":3,"progress":"...","nextStep":"...","bottleneck":"..."}},"sparks":[{"threadId":"<threadId>","topicId":"<topicId>","title":"...","pitch":"..."}]}',
    ].join("\n");
  }

  async #applyAiResult(parsed, activeThreads = []) {
    const validTopicIds = new Set(this.#topics.map((t) => t.id));
    const lockedIds = new Set(activeThreads.filter((t) => t.assignmentSource === "manual").map((t) => t.id));

    if (parsed?.assignments && typeof parsed.assignments === "object") {
      for (const [tid, info] of Object.entries(parsed.assignments)) {
        if (!tid || lockedIds.has(tid) || !info || typeof info !== "object") continue;
        const topicId = String(info.topicId || "").trim();
        if (!topicId || !validTopicIds.has(topicId)) continue;
        const stage = String(info.stage || "").trim().slice(0, 24);
        const secondaryTopicIds = Array.isArray(info.secondaryTopicIds)
          ? info.secondaryTopicIds.map((x) => String(x || "").trim()).filter((x) => x && x !== topicId && validTopicIds.has(x)).slice(0, 3)
          : [];
        this.#cache.assignments[tid] = {
          topicId,
          stage: stage || "研发",
          secondaryTopicIds,
          updatedAt: Date.now(),
        };
      }
    }

    if (parsed?.topics && typeof parsed.topics === "object") {
      for (const [topicId, info] of Object.entries(parsed.topics)) {
        if (!validTopicIds.has(topicId) || !info || typeof info !== "object") continue;
        const progress = String(info.progress || "").replace(/\s+/g, " ").trim().slice(0, 140);
        const nextStep = String(info.nextStep || "").replace(/\s+/g, " ").trim().slice(0, 100);
        const bottleneck = String(info.bottleneck || "").replace(/\s+/g, " ").trim().slice(0, 80);
        const rawStage = Number(info.stageIndex);
        const stageIndex = Number.isInteger(rawStage) && rawStage >= 1 && rawStage <= 5 ? rawStage : undefined;
        if (!progress && !nextStep) continue;
        this.#cache.topicSummaries[topicId] = {
          progress,
          nextStep,
          ...(bottleneck ? { bottleneck } : {}),
          ...(stageIndex ? { stageIndex } : {}),
          updatedAt: Date.now(),
        };
      }
    }

    if (Array.isArray(parsed?.sparks)) {
      this.#sparksState.aiSparks = parsed.sparks
        .filter((s) => s && typeof s === "object" && s.threadId)
        .slice(0, 6)
        .map((s) => ({
          threadId: String(s.threadId).trim(),
          topicId: validTopicIds.has(String(s.topicId || "").trim()) ? String(s.topicId).trim() : "",
          title: compactHeadline(s.title || "", 28),
          pitch: compactHeadline(s.pitch || "", 48),
        }));
      await this.#persistSparks();
    }
  }

  async toggleBossFocus(topicId = "") {
    await this.#ensureLoaded();
    const cleanId = String(topicId || "").trim();
    if (!cleanId || !this.#topics.some((t) => t.id === cleanId)) {
      throw Object.assign(new Error(`未知产线 ID：${cleanId}`), { status: 400 });
    }
    const list = Array.isArray(this.#cache.pinnedFocusIds) ? [...this.#cache.pinnedFocusIds] : [];
    const idx = list.indexOf(cleanId);
    if (idx >= 0) {
      list.splice(idx, 1);
    } else {
      list.unshift(cleanId);
    }
    this.#cache.pinnedFocusIds = list.slice(0, 3);
    await this.#persistCache();
    const overview = await this.getOverview({ trigger: "view", force: false });
    if (this.#broadcast) this.#broadcast("overview_updated", overview);
    return { ok: true, pinnedFocusIds: this.#cache.pinnedFocusIds, overview };
  }

  async handleSparkAction({ action = "add", id = "", text = "", topicId = "" } = {}) {
    await this.#ensureLoaded();
    const act = String(action || "add").trim();
    if (act === "add") {
      const cleanText = String(text || "").replace(/\s+/g, " ").trim().slice(0, 160);
      if (!cleanText) {
        throw Object.assign(new Error("灵感内容不能为空"), { status: 400 });
      }
      let resolvedTopicId = String(topicId || "").trim();
      if (!resolvedTopicId || !this.#topics.some((t) => t.id === resolvedTopicId)) {
        const guess = classifyThreadRuleBased({ title: cleanText, preview: "" }, this.#topics);
        resolvedTopicId = guess.topicId || "";
      }
      const spark = {
        id: `spark:${randomUUID().slice(0, 8)}`,
        text: cleanText,
        topicId: resolvedTopicId,
        createdAt: Math.floor(Date.now() / 1000),
      };
      this.#sparksState.manualSparks = [spark, ...(this.#sparksState.manualSparks || [])].slice(0, 40);
      await this.#persistSparks();
    } else if (act === "chill") {
      const cleanId = String(id || "").trim();
      if (!cleanId) throw Object.assign(new Error("缺少灵感 ID"), { status: 400 });
      if (!this.#sparksState.chilledIds.includes(cleanId)) {
        this.#sparksState.chilledIds.push(cleanId);
        await this.#persistSparks();
      }
    } else if (act === "wake") {
      const cleanId = String(id || "").trim();
      this.#sparksState.chilledIds = (this.#sparksState.chilledIds || []).filter((x) => x !== cleanId);
      await this.#persistSparks();
    } else if (act === "delete") {
      const cleanId = String(id || "").trim();
      this.#sparksState.manualSparks = (this.#sparksState.manualSparks || []).filter((x) => x.id !== cleanId);
      if (cleanId.startsWith("thread:") && !this.#sparksState.chilledIds.includes(cleanId)) {
        this.#sparksState.chilledIds.push(cleanId);
      }
      await this.#persistSparks();
    } else {
      throw Object.assign(new Error(`未知灵感动作：${act}`), { status: 400 });
    }

    const overview = await this.getOverview({ trigger: "view", force: false });
    if (this.#broadcast) this.#broadcast("overview_updated", overview);
    return { ok: true, overview };
  }

  async #listDispatchProfiles() {
    if (typeof this.#hub?.listProvidersAndProfiles !== "function") {
      return { profiles: [], defaultKey: "" };
    }
    const res = await this.#hub.listProvidersAndProfiles().catch(() => ({ profiles: [] }));
    const profiles = (Array.isArray(res?.profiles) ? res.profiles : []).filter((p) => (
      p
      && p.provider
      && p.installed !== false
      && !p.health?.disabled
      && p.account?.signedIn !== false
    ));
    const defaultKey = res?.defaultProvider ? `${res.defaultProvider}:${res.defaultProfileId || "default"}` : "";
    return { profiles, defaultKey };
  }

  #describeProfile(p) {
    const label = String(p?.health?.alias || p?.alias || p?.label || `${p?.provider} ${p?.id}`).trim();
    const email = String(p?.account?.email || "").trim();
    return email && !label.includes(email) ? `${label}（${email}）` : label;
  }

  async updateDispatchPrefs({ strategy = "", providerOrder = null, excludedAgentKeys = null } = {}) {
    await this.#ensureLoaded();
    const current = normalizeDispatchPrefs(this.#cache.dispatchPrefs);
    this.#cache.dispatchPrefs = normalizeDispatchPrefs({
      strategy: strategy || current.strategy,
      providerOrder: Array.isArray(providerOrder) ? providerOrder : current.providerOrder,
      excludedAgentKeys: Array.isArray(excludedAgentKeys) ? excludedAgentKeys : current.excludedAgentKeys,
    });
    await this.#persistCache();
    const overview = await this.getOverview({ trigger: "view", force: false });
    if (this.#broadcast) this.#broadcast("overview_updated", overview);
    return { ok: true, dispatchPrefs: this.#cache.dispatchPrefs, overview };
  }

  #resolveDispatchAgent({
    agentKey = "auto",
    preferredProvider = "auto",
    topic = null,
    profiles = [],
    defaultKey = "",
    flatTopics = [],
    priorityStrategy = "",
    providerOrder = null,
    excludedAgentKeys = null,
    taskSpecialty = "general",
  } = {}) {
    const byKey = new Map(profiles.map((p) => [`${p.provider}:${p.id || "default"}`, p]));
    const prefs = normalizeDispatchPrefs({
      strategy: priorityStrategy || this.#cache.dispatchPrefs?.strategy,
      providerOrder: Array.isArray(providerOrder) ? providerOrder : this.#cache.dispatchPrefs?.providerOrder,
      excludedAgentKeys: Array.isArray(excludedAgentKeys)
        ? excludedAgentKeys
        : this.#cache.dispatchPrefs?.excludedAgentKeys,
    });
    const pick = (key, source, reason = "") => {
      const p = byKey.get(key);
      if (!p) return null;
      return {
        provider: p.provider,
        profileId: p.id || "default",
        agentKey: key,
        agentLabel: this.#describeProfile(p),
        agentSource: source,
        agentReason: reason,
      };
    };

    const cleanKey = String(agentKey || "auto").trim();
    const cleanKeyLower = cleanKey.toLowerCase();
    const explicitProvider = (cleanKey && cleanKeyLower !== "auto" && !cleanKey.includes(":"))
      ? normalizeDispatchProvider(cleanKey)
      : "";
    if (cleanKey && cleanKeyLower !== "auto" && !explicitProvider) {
      const hit = pick(cleanKey, "manual", "手动指定账号");
      if (!hit) {
        throw Object.assign(new Error(`所选账号「${cleanKey}」当前不可用（未安装、已停用或未登录），请换一个`), { status: 400 });
      }
      return hit;
    }

    const providerFilter = explicitProvider || normalizeDispatchProvider(preferredProvider);
    if (explicitProvider && !profiles.some((p) => p.provider === explicitProvider)) {
      throw Object.assign(new Error(`所选账号「${cleanKey}」当前不可用（未安装、已停用或未登录），请换一个`), { status: 400 });
    }

    const excludedSet = new Set(prefs.excludedAgentKeys || []);
    const nonExcludedProfiles = excludedSet.size
      ? profiles.filter((p) => !excludedSet.has(`${p.provider}:${p.id || "default"}`))
      : profiles;
    const autoPool = nonExcludedProfiles.length > 0 ? nonExcludedProfiles : profiles;
    const autoByKey = new Map(autoPool.map((p) => [`${p.provider}:${p.id || "default"}`, p]));

    const remembered = topic ? String(this.#cache.topicAgentPrefs?.[topic.id]?.agentKey || "") : "";
    if (remembered) {
      const rememberedProfile = autoByKey.get(remembered);
      const matchesProviderFilter = !providerFilter || rememberedProfile?.provider === providerFilter;
      const rememberedQuota = rememberedProfile ? extractProfileQuotaScore(rememberedProfile) : null;
      const scopedPool = providerFilter ? autoPool.filter((p) => p.provider === providerFilter) : autoPool;
      const hasHealthyAlternative = scopedPool.some((p) => !extractProfileQuotaScore(p).exhausted);
      if (rememberedProfile && matchesProviderFilter && (!rememberedQuota?.exhausted || !hasHealthyAlternative || prefs.strategy === "provider")) {
        return pick(
          remembered,
          explicitProvider ? "manual" : "remembered",
          rememberedQuota?.summary || (explicitProvider ? `指定 ${explicitProvider} 渠道（沿用项目记忆）` : "沿用该项目记忆账号"),
        );
      }
    }

    const affinity = topic
      ? (Array.isArray(topic.agentAffinity) && topic.agentAffinity.length
        ? topic.agentAffinity
        : computeAgentAffinity(topic.activeThreads || [], topic.archivedThreads || []))
      : [];

    // Global recency across all topics so newly created / less-used topics still prefer the user's favorite active agents.
    const globalRecency = new Map();
    for (const tp of Array.isArray(flatTopics) ? flatTopics : []) {
      for (const t of Array.isArray(tp?.activeThreads) ? tp.activeThreads : []) {
        const k = agentKeyOfThread(t);
        if (!k) continue;
        globalRecency.set(k, (globalRecency.get(k) || 0) + (t.live ? 2 : 1));
      }
    }

    let eligible = autoPool.filter((p) => !providerFilter || p.provider === providerFilter);
    if (eligible.length === 0 && providerFilter) {
      eligible = profiles.filter((p) => p.provider === providerFilter);
    }
    if (eligible.length > 0) {
      const affinityRank = new Map(affinity.map((k, idx) => [k, idx]));
      const anyQuota = eligible.some((p) => extractProfileQuotaScore(p).hasQuota);
      const maxGlobal = Math.max(1, ...globalRecency.values());
      const orderList = prefs.providerOrder;

      const scored = eligible.map((p, idx) => {
        const key = `${p.provider}:${p.id || "default"}`;
        const quotaInfo = extractProfileQuotaScore(p);
        const affIdx = affinityRank.has(key) ? affinityRank.get(key) : -1;
        const topicAffScore = affIdx >= 0 ? Math.max(20, 45 - affIdx * 10) : 0;
        const globalUseScore = ((globalRecency.get(key) || 0) / maxGlobal) * 20;
        const orderIdx = orderList.indexOf(p.provider);
        const orderScore = orderIdx >= 0 ? Math.max(0, (orderList.length - orderIdx) * 10) : 0;
        const quotaScore = quotaInfo.hasQuota ? quotaInfo.score : (quotaInfo.exhausted ? -1000 : 50);
        const healthStatus = String(p?.health?.status || "").toLowerCase();
        const healthPenalty = healthStatus === "unavailable" ? -1500 : healthStatus === "cooldown" ? -400 : 0;
        const specialtyTable = AGENT_SPECIALTY_SCORES[taskSpecialty] || AGENT_SPECIALTY_SCORES.general;
        const specialtyScore = Number(specialtyTable[p.provider] || 0);

        let total = 0;
        if (prefs.strategy === "quota") {
          total = quotaScore * 2.0 + topicAffScore * 0.4 + globalUseScore * 0.25 + orderScore * 0.2 + healthPenalty;
        } else if (prefs.strategy === "recent") {
          total = (quotaInfo.exhausted ? -1000 : 0) + topicAffScore * 2.0 + globalUseScore * 1.5 + quotaScore * 0.2 + orderScore * 0.15 + healthPenalty;
        } else if (prefs.strategy === "provider") {
          total = (quotaInfo.exhausted ? -800 : 0) + orderScore * 3.0 + quotaScore * 0.35 + topicAffScore * 0.25 + healthPenalty;
        } else {
          // adaptive: balance remaining quota, agent specialty (hardcore vs creative), topic affinity, recency, and priority.
          total = quotaScore * 0.85 + specialtyScore + topicAffScore * 1.15 + globalUseScore * 0.75 + orderScore * 0.45 + healthPenalty;
        }
        return { p, key, total, quotaInfo, affIdx, orderIdx, specialtyScore, specialtyLabel: specialtyTable.label, idx };
      });

      scored.sort((a, b) => b.total - a.total || a.idx - b.idx);
      const winner = scored[0];
      if (winner) {
        let source = explicitProvider ? "manual" : prefs.strategy;
        if (!explicitProvider && winner.affIdx === 0 && (!anyQuota || prefs.strategy === "recent" || (!winner.quotaInfo.exhausted && !winner.quotaInfo.lowQuota))) {
          source = "affinity";
        } else if (!explicitProvider && !anyQuota && !winner.quotaInfo.hasQuota && winner.affIdx < 0 && winner.key === defaultKey && prefs.strategy === "adaptive") {
          source = "default";
        }
        const reasonParts = [];
        if (explicitProvider) reasonParts.push(`指定 ${explicitProvider} 渠道`);
        if (winner.specialtyScore >= 18 && winner.specialtyLabel) reasonParts.push(winner.specialtyLabel);
        if (winner.quotaInfo.summary) reasonParts.push(winner.quotaInfo.summary);
        if (winner.affIdx === 0) reasonParts.push("项目近期常用");
        else if ((globalRecency.get(winner.key) || 0) > 0) reasonParts.push("近期高频使用");
        if (prefs.strategy === "provider" && winner.orderIdx >= 0) reasonParts.push(`优先级 #${winner.orderIdx + 1}`);
        return pick(winner.key, source, reasonParts.join(" · ") || AGENT_SOURCE_LABELS[source] || "");
      }
    }

    if (defaultKey && autoByKey.has(defaultKey)) {
      const hit = pick(defaultKey, "default", "全局默认账号");
      if (hit) return hit;
    }
    const first = autoPool[0] || profiles[0];
    if (first) return pick(`${first.provider}:${first.id || "default"}`, "fallback", "首个可用账号");
    return {
      provider: "codex",
      profileId: "default",
      agentKey: "codex:default",
      agentLabel: "Codex 默认",
      agentSource: "fallback",
      agentReason: "默认兜底账号",
    };
  }

  async #planDispatchWithAi({
    text = "",
    scopedTopicId = "",
    flatTopics = [],
    profiles = [],
    agentKey = "auto",
    mode = "auto",
    excludedAgentKeys = null,
    preferredModel = DEFAULT_DISPATCH_PLANNER_MODEL,
    allowChat = true,
  } = {}) {
    const excludedSet = new Set(
      Array.isArray(excludedAgentKeys)
        ? excludedAgentKeys
        : (this.#cache.dispatchPrefs?.excludedAgentKeys || []),
    );
    const availableProfiles = profiles.filter((p) => !excludedSet.has(`${p.provider}:${p.id || "default"}`));
    const pool = availableProfiles.length > 0 ? availableProfiles : profiles;

    const topicLines = flatTopics.slice(0, 24).map((tp) => {
      const idleCandidates = (tp.activeThreads || [])
        .filter((t) => !t.isSlice && !t.live && !(t.pendingCount > 0) && !t.isCrossWorkspace && !t.isMultiTaskSession)
        .slice(0, 3)
        .map((t) => `${t.id}(${agentKeyOfThread(t) || t.provider}):${compactHeadline(t.title, 20)}`);
      const cwdTail = tp.primaryCwd ? tp.primaryCwd.split("/").slice(-2).join("/") : "-";
      return `- id="${tp.id}" | 名称="${tp.name}" | 目录=${cwdTail}${tp.description ? ` | 简介=${compactHeadline(tp.description, 32)}` : ""}${idleCandidates.length ? ` | 可复用空闲工位=[${idleCandidates.join("; ")}]` : ""}`;
    });

    const profileLines = pool.slice(0, 12).map((p) => {
      const key = `${p.provider}:${p.id || "default"}`;
      const q = extractProfileQuotaScore(p);
      const specHint = p.provider === "codex"
        ? "偏硬核研发/调试/重构"
        : p.provider === "claude"
          ? "偏架构/全栈/长文梳理"
          : p.provider === "antigravity"
            ? "偏创意/UI视觉/前端/多模态"
            : "通用助手";
      return `- agentKey="${key}" | 名称="${this.#describeProfile(p)}" | 专长=${specHint} | 额度=${q.summary || (q.exhausted ? "已耗尽" : "可用")}`;
    });

    const prompt = [
      "你是梦工厂总控台的「小精灵总管」智能调度规划器。请理解用户的自然语言指令，判断他是想「派发研发/创作任务」还是「普通咨询/闲聊」。",
      "",
      "【可用产线（Projects / Topics）】",
      ...(topicLines.length ? topicLines : ["- 暂无已配置产线"]),
      "",
      "【可用 AI 员工账号】",
      ...(profileLines.length ? profileLines : ["- codex:default"]),
      "",
      "【当前约束】",
      scopedTopicId ? `- 当前聚焦产线 ID：${scopedTopicId}（若用户未明确指派其他项目，优先归入此产线）` : "- 当前为全厂总览视角（请根据语义匹配最合适的产线）",
      agentKey && agentKey !== "auto" ? `- 用户已显式指定账号：${agentKey}（请勿更换为其他账号）` : "- 账号由你结合任务性质与剩余额度自动优选",
      mode === "new" ? "- 用户要求强制新开独立并发工位（action 必须为 spawn_parallel）" : "- 若存在同账号且语义高度相关的空闲干净工位，可建议 reuse_clean，否则建议 spawn_parallel",
      ...(allowChat === false ? ["- 当前来自派单台显式任务提交，不要返回 chat，请直接输出 dispatch 与对应 tasks。"] : []),
      "",
      "【任务难度分级标准（difficulty 务必克制准确，禁止盲目给 heavy）】",
      "- fast: 轻量查询、信息/指标采集（如采集业务与创收指标写入 `.agent-metrics.json`、统计汇总、状态巡检）、翻译、文案微调、改名等机械或资料收集型任务（即使包含「全面/全量/不要遗漏」，只要本质是信息采集汇总就选 `fast`）",
      "- balanced: 常规功能开发、接口编写、一般 Bug 修复、页面样式调整、单测补齐等日常任务",
      "- heavy: 高难度架构设计、跨模块大规模重构、复杂并发/死锁/内存泄漏等疑难根因排查、底层协议或安全审计",
      "",
      `【用户输入】「${text}」`,
      "",
      "请只输出一个合法 JSON 对象，不要附加 markdown 代码块或多余解释：",
      "{",
      '  "intent": "dispatch" 或 "chat",',
      '  "reply": "一句简短自然的中文管家回复（无 emoji；若为 dispatch 则说明你的拆分与分配思路；若为 chat 则直接回答用户问题或给出建议）",',
      '  "tasks": [',
      "    {",
      '      "topicId": "匹配到的产线 id",',
      '      "instruction": "提炼后的清晰、可直接交给 AI 员工执行的任务描述（去掉称呼和口癖；若为单任务且原文包含精确文件路径、JSON 格式要求、字段名或口径约束，必须完整保留，不得省略）",',
      '      "specialty": "hardcore | creative | general",',
      '      "difficulty": "fast | balanced | heavy",',
      '      "agentKey": "推荐的账号 agentKey",',
      '      "action": "reuse_clean | spawn_parallel",',
      '      "targetThreadId": "若 action 为 reuse_clean 且上文列出了对应产线与账号的空闲工位，填该工位 id；否则留空字符串",',
      '      "reason": "15~30字简短说明分配理由（如：涉及UI与并发，拆出前端单交Agy）"',
      "    }",
      "  ]",
      "}",
      "注意：如果用户输入明显不是可执行任务（例如打招呼、问问题、让你给意见），请把 intent 设为 \"chat\"，tasks 设为 []。",
      "如果用户一句话里包含多个互不依赖或跨项目的事项，请主动拆分为 2~5 条并行 tasks。",
    ].join("\n");

    const healthyProviders = new Set(
      pool
        .filter((p) => p?.installed !== false && !extractProfileQuotaScore(p).exhausted)
        .map((p) => p.provider)
        .filter(Boolean),
    );
    const installedProviders = healthyProviders.size > 0
      ? healthyProviders
      : new Set(pool.filter((p) => p?.installed !== false).map((p) => p.provider).filter(Boolean));
    let effectivePreferred = preferredModel || DEFAULT_DISPATCH_PLANNER_MODEL;
    if (
      effectivePreferred === DEFAULT_DISPATCH_PLANNER_MODEL
      && installedProviders.size > 0
      && !installedProviders.has("antigravity")
      && this.#cache.preferredModel
      && this.#cache.preferredModel !== "auto"
    ) {
      const cachedPrefProvider = String(this.#cache.preferredModel).split(":")[0];
      if (installedProviders.has(cachedPrefProvider)) {
        effectivePreferred = this.#cache.preferredModel;
      }
    }

    const aiRes = await this.#invokeLightweightModel(
      prompt,
      effectivePreferred,
      {
        fallbackToAuto: true,
        deadlineMs: Date.now() + 18_000,
        maxAttempts: 2,
        availableProviders: installedProviders,
        dedupeByProvider: true,
      },
    ).catch(() => null);
    if (!aiRes?.parsed || typeof aiRes.parsed !== "object") {
      return null;
    }
    const parsed = aiRes.parsed;
    const intent = parsed.intent === "chat" ? "chat" : "dispatch";
    const reply = String(parsed.reply || "").trim();
    const rawTasks = Array.isArray(parsed.tasks) ? parsed.tasks.slice(0, 5) : [];
    return {
      intent,
      reply,
      tasks: rawTasks,
      modelLabel: aiRes.modelLabel || "",
    };
  }

  async dispatchTask({
    text = "",
    topicId = "",
    cwdOverride = "",
    mode = "auto",
    preferredProvider = "auto",
    agentKey = "auto",
    model = "",
    effort = "",
    priorityStrategy = "",
    providerOrder = null,
    excludedAgentKeys = null,
    remember = true,
    confirmOnly = false,
    sparkId = "",
    inheritContext = true,
    useAiPlanner = false,
    allowChat = true,
    approvedRoutes = null,
  } = {}) {
    await this.#ensureLoaded();
    const cleanText = String(text || "").trim();
    if (!cleanText && (!Array.isArray(approvedRoutes) || !approvedRoutes.length)) {
      throw Object.assign(new Error("请输入要派发的任务指令"), { status: 400 });
    }
    const cleanModel = String(model || "").trim();
    const cleanCwdOverride = normPath(cwdOverride);

    const [overview, profileInfo] = await Promise.all([
      this.getOverview({ trigger: "view", force: false }),
      this.#listDispatchProfiles(),
    ]);
    const flatTopics = overview.domains.flatMap((d) => d.topics);
    const topicMap = new Map(flatTopics.map((t) => [t.id, t]));
    const profileByKey = new Map(profileInfo.profiles.map((p) => [`${p.provider}:${p.id || "default"}`, p]));
    const resolveTargetCwd = (tp) => {
      if (!cleanCwdOverride || !tp) return tp?.primaryCwd || "";
      const matchesTopic = (tp.primaryCwd && pathMatchesPrefix(cleanCwdOverride, tp.primaryCwd))
        || (Array.isArray(tp.cwdPrefixes) && tp.cwdPrefixes.some((p) => pathMatchesPrefix(cleanCwdOverride, p)));
      return matchesTopic ? cleanCwdOverride : (tp.primaryCwd || "");
    };

    let routes = [];
    let aiPlanned = false;
    let aiModel = "";
    let aiReply = "";

    // Fast path: execute already-previewed & user-approved routes verbatim when confirmOnly is false
    if (!confirmOnly && Array.isArray(approvedRoutes) && approvedRoutes.length > 0) {
      for (const rt of approvedRoutes.slice(0, 5)) {
        const targetTopic = topicMap.get(rt?.topicId) || flatTopics[0] || {
          id: rt?.topicId || "general-workspace",
          name: rt?.topicName || "默认工作区",
          primaryCwd: normPath(rt?.cwd) || process.cwd(),
          activeThreads: [],
        };
        const segText = String(rt?.segmentText || cleanText).trim();
        if (!segText) continue;
        const resolvedKey = String(rt?.agentKey || "").trim();
        const prof = profileByKey.get(resolvedKey);
        const agent = prof
          ? {
              provider: prof.provider,
              profileId: prof.id || "default",
              agentKey: resolvedKey,
              agentLabel: this.#describeProfile(prof),
              agentSource: rt.agentSource || "ai",
              agentReason: rt.agentReason || "",
            }
          : this.#resolveDispatchAgent({
              agentKey: agentKey !== "auto" ? agentKey : "auto",
              preferredProvider,
              topic: targetTopic,
              profiles: profileInfo.profiles,
              defaultKey: profileInfo.defaultKey,
              flatTopics,
              priorityStrategy,
              providerOrder,
              excludedAgentKeys,
            });
        const topicDigest = this.#contextsStore.topics?.[targetTopic.id] || null;
        const hasTopicDigest = Boolean(topicDigest?.summary);
        const routeCwd = rt?.cwd && ((targetTopic.primaryCwd && pathMatchesPrefix(rt.cwd, targetTopic.primaryCwd)) || (targetTopic.cwdPrefixes || []).some((p) => pathMatchesPrefix(rt.cwd, p)))
          ? normPath(rt.cwd)
          : resolveTargetCwd(targetTopic);
        let reuseThread = null;
        if (rt?.action === "reuse_clean" && rt?.threadId && mode !== "new") {
          reuseThread = (targetTopic.activeThreads || []).find(
            (t) => t.id === rt.threadId && !t.live && !(t.pendingCount > 0) && !t.isCrossWorkspace && !t.isMultiTaskSession && agentKeyOfThread(t) === agent.agentKey,
          ) || null;
        }
        routes.push({
          segmentText: segText,
          action: reuseThread ? "reuse_clean" : "spawn_parallel",
          topicId: targetTopic.id,
          topicName: targetTopic.name,
          cwd: routeCwd,
          stage: rt.stage || inferStageTag({ title: segText, preview: "" }, targetTopic),
          threadId: reuseThread ? reuseThread.id : "",
          threadTitle: reuseThread ? reuseThread.title : compactHeadline(segText, 24),
          provider: agent.provider,
          profileId: agent.profileId,
          agentKey: agent.agentKey,
          agentLabel: agent.agentLabel,
          agentSource: agent.agentSource,
          agentSourceLabel: AGENT_SOURCE_LABELS[agent.agentSource] || "",
          agentReason: agent.agentReason || "",
          model: String(rt.model || cleanModel || "").trim(),
          effort: String(rt.effort || effort || "").trim(),
          taskDifficulty: rt.taskDifficulty || "balanced",
          taskDifficultyLabel: rt.taskDifficultyLabel || TASK_DIFFICULTY_LABELS[rt.taskDifficulty] || "",
          hasTopicDigest,
          willInheritContext: !reuseThread && Boolean(inheritContext !== false && hasTopicDigest),
          contextSummaryPreview: !reuseThread && inheritContext !== false && hasTopicDigest ? compactHeadline(topicDigest.summary, 64) : "",
          contextFilePath: topicDigest?.contextFilePath || "",
          reason: String(rt.reason || "").trim() || `在「${targetTopic.name}」执行已确认的派工方案`,
        });
      }
      aiPlanned = Boolean(approvedRoutes.some((r) => r?.agentSource === "ai"));
    }

    // AI-assisted planning path for natural-language dispatch previews
    if (!routes.length && useAiPlanner) {
      const aiPlan = await this.#planDispatchWithAi({
        text: cleanText,
        scopedTopicId: topicId,
        flatTopics,
        profiles: profileInfo.profiles,
        agentKey,
        mode,
        excludedAgentKeys,
        allowChat,
      });
      if (aiPlan) {
        if (aiPlan.intent === "chat") {
          if (confirmOnly && allowChat) {
            return {
              ok: true,
              confirmOnly: true,
              chatOnly: true,
              aiPlanned: true,
              aiModel: aiPlan.modelLabel || "",
              reply: aiPlan.reply || "我在听，请告诉我你需要处理哪个项目或具体任务。",
              routes: [],
            };
          }
        } else {
          const usedThreadIds = new Set();
          const excludedSet = new Set(
            Array.isArray(excludedAgentKeys)
              ? excludedAgentKeys
              : (this.#cache.dispatchPrefs?.excludedAgentKeys || []),
          );
          for (const item of aiPlan.tasks) {
            let segText = String(item?.instruction || "").trim();
            if (!segText) continue;
            if (
              aiPlan.tasks.length === 1
              && cleanText.length > segText.length
              && (segText.length < cleanText.length * 0.75 || /\{[^}]+\}|\/[\w.-]+\.\w+|\.agent-metrics/.test(cleanText))
            ) {
              segText = cleanText;
            }
            let targetTopic = topicMap.get(item?.topicId) || (topicId ? topicMap.get(topicId) : null);
            if (!targetTopic) {
              let bestScore = 0;
              for (const tp of flatTopics) {
                const sc = scoreTextAgainstTopic(segText, tp);
                if (sc > bestScore) {
                  bestScore = sc;
                  targetTopic = tp;
                }
              }
            }
            if (!targetTopic) {
              targetTopic = flatTopics[0] || {
                id: "general-workspace",
                name: "默认工作区",
                primaryCwd: process.cwd(),
                activeThreads: [],
              };
            }

            const taskSpecialty = ["hardcore", "creative", "general"].includes(item?.specialty)
              ? item.specialty
              : classifyDispatchTaskSpecialty(segText);
            const difficulty = ["fast", "balanced", "heavy"].includes(item?.difficulty)
              ? item.difficulty
              : classifyDispatchTaskDifficulty(segText);

            let agent = null;
            const aiKey = String(item?.agentKey || "").trim();
            if (agentKey && agentKey !== "auto") {
              agent = this.#resolveDispatchAgent({
                agentKey,
                preferredProvider,
                topic: targetTopic,
                profiles: profileInfo.profiles,
                defaultKey: profileInfo.defaultKey,
                flatTopics,
                priorityStrategy,
                providerOrder,
                excludedAgentKeys,
                taskSpecialty,
              });
            } else if (aiKey && profileByKey.has(aiKey) && !excludedSet.has(aiKey)) {
              const p = profileByKey.get(aiKey);
              const quotaInfo = extractProfileQuotaScore(p);
              const hasHealthyAlt = profileInfo.profiles.some(
                (cand) => !excludedSet.has(`${cand.provider}:${cand.id || "default"}`) && !extractProfileQuotaScore(cand).exhausted,
              );
              if (!quotaInfo.exhausted || !hasHealthyAlt) {
                agent = {
                  provider: p.provider,
                  profileId: p.id || "default",
                  agentKey: aiKey,
                  agentLabel: this.#describeProfile(p),
                  agentSource: "ai",
                  agentReason: [quotaInfo.summary, String(item?.reason || "").trim()].filter(Boolean).join(" · ") || "AI 结合任务性质优选",
                };
              }
            }
            if (!agent) {
              agent = this.#resolveDispatchAgent({
                agentKey,
                preferredProvider,
                topic: targetTopic,
                profiles: profileInfo.profiles,
                defaultKey: profileInfo.defaultKey,
                flatTopics,
                priorityStrategy,
                providerOrder,
                excludedAgentKeys,
                taskSpecialty,
              });
            }

            const availableModels = await this.#listModelsForAgent(agent.provider, agent.profileId);
            const selectedModel = selectAdaptiveModelForRoute({
              provider: agent.provider,
              difficulty,
              explicitModel: cleanModel,
              availableModels,
            });
            const resolvedEffort = String(effort || selectedModel.effort || "").trim();
            const segStage = inferStageTag({ title: segText, preview: "" }, targetTopic);

            const topicDigest = this.#contextsStore.topics?.[targetTopic.id] || null;
            const hasTopicDigest = Boolean(topicDigest?.summary);
            const forceNew = mode === "new";
            const effectiveCwd = resolveTargetCwd(targetTopic);
            const isSubOverride = Boolean(cleanCwdOverride && effectiveCwd === cleanCwdOverride && effectiveCwd !== normPath(targetTopic.primaryCwd));

            let reuseThread = null;
            if (!forceNew && item?.action === "reuse_clean" && item?.targetThreadId) {
              const cand = (targetTopic.activeThreads || []).find((t) => (
                t.id === item.targetThreadId
                && !t.isSlice
                && !usedThreadIds.has(t.id)
                && !t.live
                && !(t.pendingCount > 0)
                && !t.isCrossWorkspace
                && !t.isMultiTaskSession
                && agentKeyOfThread(t) === agent.agentKey
                && (!isSubOverride || (t.cwd && pathMatchesPrefix(t.cwd, effectiveCwd)))
              ));
              if (cand) reuseThread = cand;
            }

            if (reuseThread) {
              usedThreadIds.add(reuseThread.id);
              routes.push({
                segmentText: segText,
                action: "reuse_clean",
                topicId: targetTopic.id,
                topicName: targetTopic.name,
                cwd: effectiveCwd,
                stage: segStage,
                threadId: reuseThread.id,
                threadTitle: reuseThread.title,
                provider: agent.provider,
                profileId: agent.profileId,
                agentKey: agent.agentKey,
                agentLabel: agent.agentLabel,
                agentSource: agent.agentSource,
                agentSourceLabel: AGENT_SOURCE_LABELS[agent.agentSource] || "",
                agentReason: agent.agentReason || "",
                model: selectedModel.model || cleanModel,
                effort: resolvedEffort,
                taskDifficulty: difficulty,
                taskDifficultyLabel: TASK_DIFFICULTY_LABELS[difficulty] || "",
                hasTopicDigest,
                willInheritContext: false,
                contextSummaryPreview: "",
                contextFilePath: topicDigest?.contextFilePath || "",
                reason: String(item?.reason || "").trim() || `AI 匹配并复用空闲工位「${compactHeadline(reuseThread.title, 18)}」`,
              });
            } else {
              const willInherit = Boolean(inheritContext !== false && hasTopicDigest);
              routes.push({
                segmentText: segText,
                action: "spawn_parallel",
                topicId: targetTopic.id,
                topicName: targetTopic.name,
                cwd: effectiveCwd,
                stage: segStage,
                threadId: "",
                threadTitle: compactHeadline(segText, 24),
                provider: agent.provider,
                profileId: agent.profileId,
                agentKey: agent.agentKey,
                agentLabel: agent.agentLabel,
                agentSource: agent.agentSource,
                agentSourceLabel: AGENT_SOURCE_LABELS[agent.agentSource] || "",
                agentReason: agent.agentReason || "",
                model: selectedModel.model || cleanModel,
                effort: resolvedEffort,
                taskDifficulty: difficulty,
                taskDifficultyLabel: TASK_DIFFICULTY_LABELS[difficulty] || "",
                hasTopicDigest,
                willInheritContext: willInherit,
                contextSummaryPreview: willInherit ? compactHeadline(topicDigest.summary, 64) : "",
                contextFilePath: topicDigest?.contextFilePath || "",
                reason: String(item?.reason || "").trim() || (isSubOverride
                  ? `在「${targetTopic.name} · ${basename(effectiveCwd)}」子项目目录开启独立干净工位`
                  : `在「${targetTopic.name}」开启独立干净工位`),
              });
            }
          }
          if (routes.length > 0) {
            aiPlanned = true;
            aiModel = aiPlan.modelLabel || "";
            aiReply = aiPlan.reply || "";
          }
        }
      }
    }

    if (!routes.length) {
      const segments = topicId
        ? [cleanText]
        : splitCompoundPromptSegments(cleanText, this.#topics);

      const usedThreadIds = new Set();

      for (const segText of segments) {
      let targetTopic = topicId ? topicMap.get(topicId) : null;
      if (!targetTopic) {
        let bestScore = 0;
        for (const tp of flatTopics) {
          const sc = scoreTextAgainstTopic(segText, tp);
          if (sc > bestScore) {
            bestScore = sc;
            targetTopic = tp;
          }
        }
      }
      if (!targetTopic) {
        targetTopic = flatTopics[0] || {
          id: "general-workspace",
          name: "默认工作区",
          primaryCwd: process.cwd(),
          activeThreads: [],
        };
      }

      const taskSpecialty = classifyDispatchTaskSpecialty(segText);
      const agent = this.#resolveDispatchAgent({
        agentKey,
        preferredProvider,
        topic: targetTopic,
        profiles: profileInfo.profiles,
        defaultKey: profileInfo.defaultKey,
        flatTopics,
        priorityStrategy,
        providerOrder,
        excludedAgentKeys,
        taskSpecialty,
      });
      const difficulty = classifyDispatchTaskDifficulty(segText);
      const availableModels = await this.#listModelsForAgent(agent.provider, agent.profileId);
      const selectedModel = selectAdaptiveModelForRoute({
        provider: agent.provider,
        difficulty,
        explicitModel: cleanModel,
        availableModels,
      });
      const resolvedEffort = String(effort || selectedModel.effort || "").trim();
      const agentFields = {
        provider: agent.provider,
        profileId: agent.profileId,
        agentKey: agent.agentKey,
        agentLabel: agent.agentLabel,
        agentSource: agent.agentSource,
        agentSourceLabel: AGENT_SOURCE_LABELS[agent.agentSource] || "",
        agentReason: agent.agentReason || "",
        model: selectedModel.model || cleanModel,
        effort: resolvedEffort,
        taskDifficulty: difficulty,
        taskDifficultyLabel: TASK_DIFFICULTY_LABELS[difficulty] || "",
      };

      const segStage = inferStageTag({ title: segText, preview: "" }, targetTopic);
      const segFootprints = extractThreadFootprints({ title: segText }).allLabels;
      const effectiveCwd = resolveTargetCwd(targetTopic);
      const isSubOverride = Boolean(cleanCwdOverride && effectiveCwd === cleanCwdOverride && effectiveCwd !== normPath(targetTopic.primaryCwd));

      // Only sessions on the SAME account are eligible for reuse, so personal work never lands in a company account.
      const candidates = (targetTopic?.activeThreads || []).filter((t) => (
        !t.isSlice
        && !usedThreadIds.has(t.id)
        && agentKeyOfThread(t) === agent.agentKey
        && (!isSubOverride || (t.cwd && pathMatchesPrefix(t.cwd, effectiveCwd)))
      ));
      let bestIdleClean = null;
      let bestIdleScore = 0;
      let busyMatch = null;
      let pollutedMatch = null;

      for (const cand of candidates) {
        const candLabels = new Set(cand.allFootprints || []);
        const labelOverlap = segFootprints.filter((lb) => candLabels.has(lb)).length;
        const wordOverlap = segText.slice(0, 12).length >= 3 && String(cand.title || "").includes(segText.slice(0, 4)) ? 1 : 0;
        const semanticMatch = labelOverlap * 2 + wordOverlap + (cand.stage === segStage && segStage !== "研发" ? 1 : 0);

        if (cand.live || cand.pendingCount > 0) {
          if (semanticMatch > 0 && !busyMatch) busyMatch = cand;
          continue;
        }
        if (cand.isCrossWorkspace || cand.isMultiTaskSession) {
          if (semanticMatch > 0 && !pollutedMatch) pollutedMatch = cand;
          continue;
        }
        if (semanticMatch > bestIdleScore) {
          bestIdleScore = semanticMatch;
          bestIdleClean = cand;
        }
      }

      const forceNew = mode === "new";
      const topicDigest = this.#contextsStore.topics?.[targetTopic.id] || null;
      const hasTopicDigest = Boolean(topicDigest?.summary);
      if (!forceNew && bestIdleClean && bestIdleScore >= 2) {
        usedThreadIds.add(bestIdleClean.id);
        routes.push({
          segmentText: segText,
          action: "reuse_clean",
          topicId: targetTopic.id,
          topicName: targetTopic.name,
          cwd: effectiveCwd,
          stage: segStage,
          threadId: bestIdleClean.id,
          threadTitle: bestIdleClean.title,
          ...agentFields,
          hasTopicDigest,
          willInheritContext: false,
          contextSummaryPreview: "",
          contextFilePath: topicDigest?.contextFilePath || "",
          reason: `复用同账号下空闲且未串项的工位「${compactHeadline(bestIdleClean.title, 18)}」`,
        });
      } else {
        let reason = isSubOverride
          ? `在「${targetTopic.name} · ${basename(effectiveCwd)}」子项目目录开启独立干净工位并锁定归属`
          : `在「${targetTopic.name}」主目录开启独立干净工位并锁定归属`;
        if (forceNew) {
          reason = "按指令强制开启独立并发分身，隔离上下文";
        } else if (busyMatch) {
          reason = `同模块工位「${compactHeadline(busyMatch.title, 14)}」正在运行中，自动新开并发分身防排队阻塞`;
        } else if (pollutedMatch) {
          reason = `历史会话「${compactHeadline(pollutedMatch.title, 14)}」已混杂多项目改动，自动新开干净工位防污染`;
        }
        const willInherit = Boolean(inheritContext !== false && hasTopicDigest);
        routes.push({
          segmentText: segText,
          action: "spawn_parallel",
          topicId: targetTopic.id,
          topicName: targetTopic.name,
          cwd: effectiveCwd,
          stage: segStage,
          threadId: "",
          threadTitle: compactHeadline(segText, 24),
          ...agentFields,
          hasTopicDigest,
          willInheritContext: willInherit,
          contextSummaryPreview: willInherit ? compactHeadline(topicDigest.summary, 64) : "",
          contextFilePath: topicDigest?.contextFilePath || "",
          reason,
        });
      }
      }
    }

    if (confirmOnly) {
      return {
        ok: true,
        confirmOnly: true,
        aiPlanned,
        ...(aiModel ? { aiModel } : {}),
        ...(aiReply ? { reply: aiReply } : {}),
        routes,
      };
    }

    const dispatched = [];
    for (const route of routes) {
      if (route.action === "reuse_clean" && route.threadId && typeof this.#hub?.sendTurn === "function") {
        const res = await this.#hub.sendTurn({
          threadId: route.threadId,
          cwd: route.cwd,
          text: route.segmentText,
          permissionMode: "turbo",
          ...(route.model ? { model: route.model } : {}),
          ...(route.effort ? { effort: route.effort } : {}),
        });
        const finalThreadId = res?.redirectedThreadId || route.threadId;
        if (typeof this.#hub?.updateThreadTopic === "function") {
          await this.#hub.updateThreadTopic(finalThreadId, route.topicId, route.stage);
        }
        dispatched.push({
          ...route,
          threadId: finalThreadId,
        });
      } else if (typeof this.#hub?.startThread === "function") {
        const topicDigest = this.#contextsStore.topics?.[route.topicId] || null;
        // Vault-backed digests reach new threads via the hub's memory pointer instead of inlined text.
        const injectedText = (route.willInheritContext && topicDigest?.summary && !topicDigest.memory)
          ? `${route.segmentText}\n\n---\n[产线历史归档上下文（继承自「${route.topicName}」归档记忆${topicDigest.contextFilePath ? `，详单见 ${topicDigest.contextFilePath}` : ""}）]\n${topicDigest.summary}`
          : route.segmentText;
        const res = await this.#hub.startThread({
          provider: route.provider,
          profileId: route.profileId,
          cwd: route.cwd,
          text: injectedText,
          memoryTopic: route.topicId,
          permissionMode: "turbo",
          ...(route.model ? { model: route.model } : {}),
          ...(route.effort ? { effort: route.effort } : {}),
        });
        const newTid = res?.thread?.id || "";
        if (newTid && typeof this.#hub?.updateThreadTopic === "function") {
          await this.#hub.updateThreadTopic(newTid, route.topicId, route.stage);
        }
        dispatched.push({
          ...route,
          threadId: newTid,
          threadTitle: res?.thread?.title || route.threadTitle,
        });
      }
    }

    // Remember an explicit account choice per topic so the next "auto" dispatch keeps using it.
    const explicitKey = String(agentKey || "auto").trim();
    if (remember && explicitKey && explicitKey !== "auto" && dispatched.length) {
      for (const route of dispatched) {
        this.#cache.topicAgentPrefs[route.topicId] = {
          agentKey: route.agentKey,
          model: route.model || "",
          updatedAt: Date.now(),
        };
      }
      await this.#persistCache();
    }

    // If hatched from a manual spark, clean it up so it doesn't stay duplicated in incubator
    if (sparkId) {
      if (sparkId.startsWith("spark:")) {
        this.#sparksState.manualSparks = (this.#sparksState.manualSparks || []).filter((s) => s.id !== sparkId);
      } else if (!this.#sparksState.chilledIds.includes(sparkId)) {
        this.#sparksState.chilledIds.push(sparkId);
      }
      await this.#persistSparks();
    }

    const nextOverview = await this.getOverview({ trigger: "view", force: false });
    if (this.#broadcast) this.#broadcast("overview_updated", nextOverview);
    return {
      ok: true,
      confirmOnly: false,
      dispatched,
      overview: nextOverview,
    };
  }

  async #listModelsForAgent(provider, profileId = "") {
    if (typeof this.#hub?.listModels !== "function") return [];
    const res = await this.#hub.listModels({ provider, profileId }).catch(() => null);
    if (Array.isArray(res)) return res;
    if (Array.isArray(res?.data)) return res.data;
    if (provider && Array.isArray(res?.byProvider?.[provider])) return res.byProvider[provider];
    return [];
  }

  #lightweightCandidates(preferredModel = "auto") {
    return selectLightweightModelCandidates({ preferredModel });
  }

  async #invokeLightweightModel(
    prompt,
    preferredModel = "auto",
    {
      fallbackToAuto = false,
      deadlineMs = 0,
      maxAttempts = 0,
      availableProviders = null,
      dedupeByProvider = false,
    } = {},
  ) {
    if (this.#runAiImpl) {
      const raw = await this.#runAiImpl({ prompt, preferredModel });
      const parsed = typeof raw === "object" && raw !== null ? raw : parseJsonFromAiText(raw);
      return { parsed, modelLabel: preferredModel };
    }
    if (isTestRuntime(this.#env)) {
      return { parsed: null, error: "测试环境跳过外部模型" };
    }

    const candidates = selectLightweightModelCandidates({
      preferredModel,
      fallbackToAuto,
      availableProviders,
      dedupeByProvider,
      maxAttempts,
    });

    const chainOpts = {
      ...(deadlineMs > 0 ? { deadlineMs } : {}),
    };
    const result = await this.#runModelChain(prompt, candidates, parseJsonFromAiText, chainOpts);
    return result.value ? { parsed: result.value, modelLabel: result.modelLabel } : { parsed: null, error: result.error };
  }

  // Tries each channel in order through the user's own CLI logins and returns
  // the first output that `accept` turns into a value.
  async #runModelChain(prompt, candidates, accept, { deadlineMs = 0, maxAttempts = candidates.length, signal = null } = {}) {
    let lastErr = "无可用均衡模型通道";
    const list = candidates.slice(0, Math.max(1, maxAttempts));
    for (const cand of list) {
      if (signal?.aborted) return { value: null, error: "请求已取消" };
      const remainingMs = deadlineMs > 0 ? (deadlineMs - Date.now()) : 0;
      if (deadlineMs > 0 && remainingMs <= 3_000) {
        lastErr = "总思考时间已用尽";
        break;
      }
      const claudeCodexTimeout = deadlineMs > 0 ? Math.min(22_000, remainingMs) : 35_000;
      const agyTimeout = deadlineMs > 0 ? Math.min(22_000, remainingMs) : 40_000;
      try {
        let text = "";
        if (cand.provider === "claude") {
          text = await this.#runClaudeOnce(prompt, cand.model, claudeCodexTimeout, cand.profileId || "", signal);
        } else if (cand.provider === "codex") {
          text = await this.#runCodexOnce(prompt, cand.model, claudeCodexTimeout, cand.profileId || "", signal);
        } else if (cand.provider === "antigravity") {
          text = await this.#runAntigravityOnce(prompt, cand.model, agyTimeout, cand.profileId || "", signal);
        }
        const value = accept(text);
        if (value) return { value, modelLabel: cand.label };
        lastErr = `${cand.label} 返回格式不符`;
      } catch (err) {
        if (signal?.aborted) return { value: null, error: "请求已取消" };
        lastErr = err?.message || `${cand.label} 调用失败`;
      }
    }
    return { value: null, error: lastErr };
  }

  #assistantCandidates(modelKey = "auto") {
    const raw = String(modelKey || "auto").trim();
    const base = this.#lightweightCandidates("auto");
    if (!raw || raw === "auto") return base;
    const firstColon = raw.indexOf(":");
    if (firstColon < 0) return base;
    const provider = raw.slice(0, firstColon).trim().toLowerCase();
    const rest = raw.slice(firstColon + 1);
    const secondColon = rest.indexOf(":");
    const profileId = secondColon >= 0 ? rest.slice(0, secondColon).trim() : "";
    const model = (secondColon >= 0 ? rest.slice(secondColon + 1) : rest).trim();
    if (!["antigravity", "codex", "claude"].includes(provider) || !model) return base;
    const explicit = { key: raw, label: `${provider}:${model}`, provider, profileId, model };
    return [explicit, ...base.filter((c) => !(c.provider === provider && c.model === model))];
  }

  // One-shot completion adapter for the sprite assistant (answers and harvest
  // verdicts). Uses warm voice sessions only for interactive chat, keeping
  // background harvest verdicts isolated on ephemeral runners.
  async completeAssistantText({ system = "", prompt = "", modelKey = "auto", model = "auto", sessionId = "", background = false, signal = null, onDelta = null } = {}) {
    if (signal?.aborted) return null;
    const effectiveModel = String(modelKey && modelKey !== "auto" ? modelKey : model || "auto").trim() || "auto";
    const fullPrompt = system ? `${system}\n\n${prompt}` : prompt;
    if (this.#runAiImpl) {
      const raw = await this.#runAiImpl({ prompt: fullPrompt, preferredModel: effectiveModel, modelKey: effectiveModel, sessionId, purpose: "assistant", background: Boolean(background), signal, onDelta });
      return typeof raw === "string" ? raw : typeof raw?.text === "string" ? raw.text : null;
    }
    if (isTestRuntime(this.#env)) return null;
    const deadlineMs = background ? 0 : Date.now() + 50_000;
    if (!background && this.voiceService?.completeAssistantChat) {
      const remainingForWarm = Math.min(25_000, deadlineMs - Date.now());
      if (remainingForWarm > 3_000) {
        const warm = await this.voiceService.completeAssistantChat({
          sessionId,
          system,
          prompt,
          modelKey: effectiveModel,
          timeoutMs: remainingForWarm,
          signal,
          onDelta,
        }).catch(() => null);
        if (warm) return warm;
        if (signal?.aborted) return null;
      }
    }
    const chainOpts = background
      ? { signal }
      : { deadlineMs, maxAttempts: 2, signal };
    const result = await this.#runModelChain(
      fullPrompt,
      this.#assistantCandidates(effectiveModel),
      (text) => String(text || "").trim() || null,
      chainOpts,
    );
    return result.value;
  }

  async #runClaudeOnce(prompt, model = "claude-sonnet-5-5", timeoutMs = 35_000, preferredProfileId = "", signal = null) {
    if (signal?.aborted) throw new Error("请求已取消");
    const profiles = typeof this.#hub?.listProfiles === "function"
      ? this.#hub.listProfiles("claude").filter((p) => p?.installed !== false && !p.health?.disabled && p.health?.status !== "unavailable")
      : [{ id: "default", home: "" }];
    if (!profiles.length) throw new Error("Claude 账号均处于限流或不可用状态");
    const target = (preferredProfileId && profiles.find((p) => p.id === preferredProfileId)) || profiles[0];
    const configDir = target.home || "";
    const auth = await readClaudeCliAuthStatus({ configDir, env: this.#env, timeoutMs: 2_500 }).catch(() => ({ loggedIn: false }));
    if (signal?.aborted) throw new Error("请求已取消");
    if (!auth.loggedIn && !target.endpointLabel) {
      throw new Error("Claude 未登录");
    }
    const prepared = prepareCrossPlatformSpawn(
      claudeExecutable(this.#env),
      ["-p", "--no-session-persistence", "--model", model, "--output-format", "text", prompt],
      {
        cwd: os.tmpdir(),
        env: claudeEnvironment(this.#env, configDir, { platform: process.platform }),
        stdio: ["ignore", "pipe", "pipe"],
      },
      { platform: process.platform },
    );
    return new Promise((resolveRun, rejectRun) => {
      const proc = spawn(prepared.command, prepared.args, prepared.options);
      let settled = false;
      let out = "";
      let onAbort = null;
      const cleanup = () => {
        clearTimeout(timer);
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        killProcessTreeCrossPlatform(proc, { signal: "SIGTERM", platform: process.platform });
        rejectRun(new Error("Claude 汇总超时"));
      }, timeoutMs);
      timer.unref?.();
      if (signal) {
        onAbort = () => {
          if (settled) return;
          settled = true;
          cleanup();
          killProcessTreeCrossPlatform(proc, { signal: "SIGTERM", platform: process.platform });
          rejectRun(new Error("请求已取消"));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      proc.stdout?.on("data", (c) => {
        if (out.length < 65_536) out += String(c);
      });
      proc.once("error", (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectRun(err);
      });
      proc.once("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (code === 0 && out.trim()) resolveRun(out.trim());
        else rejectRun(new Error(`Claude 退出码 ${code}`));
      });
    });
  }

  async #runCodexOnce(prompt, model = "gpt-6.1-terra", timeoutMs = 35_000, preferredProfileId = "", signal = null) {
    if (signal?.aborted) throw new Error("请求已取消");
    const profiles = typeof this.#hub?.listProfiles === "function"
      ? this.#hub.listProfiles("codex").filter((p) => p?.installed !== false && !p.health?.disabled && p.health?.status !== "unavailable")
      : [];
    const target = (preferredProfileId && profiles.find((p) => p.id === preferredProfileId))
      || profiles.find((p) => p.health?.status === "healthy")
      || profiles[0]
      || null;
    if (typeof this.#hub?.listProfiles === "function" && !profiles.length) {
      throw new Error("Codex 账号均不可用");
    }
    const codexCmd = resolveProviderExecutables(this.#env)?.codex || this.#env.CODEX_BIN || "codex";
    const codexEnv = target?.home ? { ...this.#env, CODEX_HOME: target.home } : this.#env;
    const prepared = prepareCrossPlatformSpawn(
      codexCmd,
      ["exec", "--ephemeral", "--skip-git-repo-check", "--sandbox", "read-only", "-m", model, "-c", 'model_reasoning_effort="low"', "--json", prompt],
      {
        cwd: os.tmpdir(),
        env: codexEnv,
        stdio: ["ignore", "pipe", "pipe"],
      },
      { platform: process.platform },
    );
    return new Promise((resolveRun, rejectRun) => {
      const proc = spawn(prepared.command, prepared.args, prepared.options);
      let settled = false;
      let lastText = "";
      let onAbort = null;
      const cleanup = () => {
        clearTimeout(timer);
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        killProcessTreeCrossPlatform(proc, { signal: "SIGTERM", platform: process.platform });
        rejectRun(new Error("Codex 汇总超时"));
      }, timeoutMs);
      timer.unref?.();
      if (signal) {
        onAbort = () => {
          if (settled) return;
          settled = true;
          cleanup();
          killProcessTreeCrossPlatform(proc, { signal: "SIGTERM", platform: process.platform });
          rejectRun(new Error("请求已取消"));
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
      rl.on("line", (line) => {
        try {
          const evt = JSON.parse(line);
          if (evt?.type === "item.completed" && evt?.item?.type === "agent_message" && evt?.item?.text) {
            lastText = String(evt.item.text);
          }
        } catch {}
      });
      proc.once("error", (err) => {
        if (settled) return;
        settled = true;
        cleanup();
        rejectRun(err);
      });
      proc.once("close", (code) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (code === 0 && lastText.trim()) resolveRun(lastText.trim());
        else rejectRun(new Error(`Codex 退出码 ${code}`));
      });
    });
  }

  async #runAntigravityOnce(prompt, model = "gemini-3.8-flash", timeoutMs = 40_000, preferredProfileId = "", signal = null) {
    if (signal?.aborted) throw new Error("请求已取消");
    if (typeof this.#hub?.startThread !== "function") {
      throw new Error("Antigravity 不可用");
    }
    const profiles = typeof this.#hub?.listProfiles === "function"
      ? this.#hub.listProfiles("antigravity").filter((p) => p?.installed !== false && !p.health?.disabled && p.health?.status !== "unavailable")
      : [];
    if (typeof this.#hub?.listProfiles === "function" && !profiles.length) {
      throw new Error("Antigravity 账号均不可用");
    }
    const chosenProfile = (preferredProfileId && profiles.find((p) => p.id === preferredProfileId))
      || profiles.find((p) => p.health?.status === "healthy")
      || profiles[0]
      || { id: "desktop" };
    const workerCwd = resolve(this.#dataDir, "overview-worker");
    await mkdir(workerCwd, { recursive: true }).catch(() => {});
    if (signal?.aborted) throw new Error("请求已取消");
    const started = await this.#hub.startThread({
      provider: "antigravity",
      profileId: chosenProfile.id || "desktop",
      cwd: workerCwd,
      model,
      effort: "low",
      text: `[MISSION_OVERVIEW_WORKER]\n${prompt}`,
      permissionMode: "plan",
      internal: true,
      memoryBrief: false,
    });
    const tid = String(started?.thread?.id || "").trim();
    if (!tid) throw new Error("Antigravity 未返回会话 ID");

    try {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (signal?.aborted) throw new Error("请求已取消");
        await new Promise((r) => setTimeout(r, 900));
        if (signal?.aborted) throw new Error("请求已取消");
        const res = await this.#hub.readThread(tid, { limit: 4 }).catch(() => null);
        const turns = res?.thread?.turns || [];
        const lastTurn = turns[turns.length - 1];
        if (lastTurn && lastTurn.status && lastTurn.status !== "inProgress" && lastTurn.status !== "running") {
          if (lastTurn.status === "failed" || lastTurn.status === "interrupted") {
            throw new Error("Antigravity 汇总未完成");
          }
          const items = lastTurn.items || [];
          const agentItem = [...items].reverse().find((it) => it?.type === "agentMessage" && it.text);
          if (agentItem?.text) return String(agentItem.text);
          if (lastTurn.status === "completed") throw new Error("Antigravity 返回空内容");
        }
      }
      throw new Error("Antigravity 汇总超时");
    } finally {
      if (typeof this.#hub?.archiveThreads === "function") {
        void this.#hub.archiveThreads([tid], true).catch(() => {});
      }
    }
  }

  async assignThreadTopic(threadId, topicId = "", stageTag = "") {
    await this.#ensureLoaded();
    if (!threadId) throw Object.assign(new Error("缺少 threadId"), { status: 400 });
    if (topicId && !this.#topics.some((t) => t.id === topicId)) {
      throw Object.assign(new Error(`未知项目主题：${topicId}`), { status: 400 });
    }
    if (typeof this.#hub?.updateThreadTopic === "function") {
      await this.#hub.updateThreadTopic(threadId, topicId, stageTag);
    }
    if (!topicId) {
      delete this.#cache.assignments[threadId];
      await this.#persistCache();
    }
    const overview = await this.getOverview({ trigger: "view", force: false });
    if (this.#broadcast) this.#broadcast("overview_updated", overview);
    return { ok: true, overview };
  }

  async upsertTopic({
    id = "",
    domainId = "indie-lab",
    name = "",
    description = "",
    primaryCwd = "",
    cwdPrefixes = null,
    keywords = [],
    yieldType = "growth",
    landmark = "",
    pinned = false,
  } = {}) {
    await this.#ensureLoaded();
    const cleanName = String(name || "").trim();
    if (!cleanName) throw Object.assign(new Error("项目名称不能为空"), { status: 400 });
    const topicId = String(id || "").trim()
      || cleanName.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "")
      || `topic-${Date.now()}`;
    const existingIdx = this.#topics.findIndex((t) => t.id === topicId);
    const mappedDomain = LEGACY_DOMAIN_MAP[domainId] || domainId;
    const finalYield = YIELD_META[yieldType] ? yieldType : "growth";
    const resolvedPrimaryCwd = normPath(primaryCwd || (existingIdx >= 0 ? this.#topics[existingIdx].primaryCwd : ""));
    const rawPrefixes = Array.isArray(cwdPrefixes) && cwdPrefixes.length
      ? cwdPrefixes
      : (primaryCwd
          ? [resolvedPrimaryCwd, ...(existingIdx >= 0 ? (this.#topics[existingIdx].cwdPrefixes || []) : [])]
          : (existingIdx >= 0 ? (this.#topics[existingIdx].cwdPrefixes || []) : []));
    const resolvedPrefixes = [...new Set(rawPrefixes.map((p) => normPath(p)).filter(Boolean))];
    const nextTopic = {
      id: topicId,
      domainId: this.#domains.some((d) => d.id === mappedDomain) ? mappedDomain : "indie-lab",
      name: cleanName,
      description: String(description || "").trim(),
      primaryCwd: resolvedPrimaryCwd,
      cwdPrefixes: resolvedPrefixes,
      keywords: Array.isArray(keywords) && keywords.length ? keywords : (existingIdx >= 0 ? this.#topics[existingIdx].keywords : [cleanName.toLowerCase()]),
      yieldType: finalYield,
      yieldLabel: YIELD_META[finalYield]?.label || "涨粉引流飞轮",
      pinned: Boolean(pinned),
      order: existingIdx >= 0 ? this.#topics[existingIdx].order : (this.#topics.length + 1),
    };
    nextTopic.landmark = String(landmark || (existingIdx >= 0 ? this.#topics[existingIdx].landmark : "") || inferLandmarkForTopic(nextTopic, this.#topics.length));
    if (existingIdx >= 0) this.#topics[existingIdx] = nextTopic;
    else this.#topics.push(nextTopic);
    const coveredCwds = [nextTopic.primaryCwd, ...(nextTopic.cwdPrefixes || [])].filter(Boolean);
    if (coveredCwds.length && this.#ignoredCwds.length) {
      this.#ignoredCwds = this.#ignoredCwds.filter((ign) => !coveredCwds.some((c) => pathMatchesPrefix(c, ign)));
    }
    await this.#persistDomains();
    this.#autoMetricsCache.at = 0;
    const overview = await this.getOverview({ trigger: "view", force: false });
    if (this.#broadcast) this.#broadcast("overview_updated", overview);
    return { ok: true, topic: nextTopic, overview };
  }

  async upsertTopicMetrics({ topicId = "", kpis = [], source = "manual", clear = false } = {}) {
    await this.#ensureLoaded();
    const cleanId = String(topicId || "").trim();
    if (!cleanId || !this.#topics.some((t) => t.id === cleanId)) {
      throw Object.assign(new Error(`未知产线 ID：${cleanId}`), { status: 400 });
    }
    if (clear) {
      delete this.#metricsStore.topics[cleanId];
    } else {
      const normalizedKpis = (Array.isArray(kpis) ? kpis : [])
        .map((k, idx) => ({
          key: String(k?.key || `kpi_${idx + 1}`).trim().slice(0, 24),
          label: String(k?.label || "").trim().slice(0, 18),
          value: String(k?.value ?? "").trim().slice(0, 22),
          delta: String(k?.delta || "").trim().slice(0, 22),
          tone: ["coin", "growth", "bounty", "shield"].includes(k?.tone) ? k.tone : "coin",
        }))
        .filter((k) => k.label && k.value)
        .slice(0, 24);
      if (!normalizedKpis.length) {
        throw Object.assign(new Error("请至少填写一项有效的指标名称与数值"), { status: 400 });
      }
      const nowIso = new Date().toISOString().slice(0, 16).replace("T", " ");
      this.#metricsStore.topics[cleanId] = {
        updatedAt: nowIso,
        source: String(source || "manual").slice(0, 24),
        kpis: normalizedKpis,
      };
    }
    await this.#persistMetrics();
    this.#autoMetricsCache.at = 0;
    const overview = await this.getOverview({ trigger: "view", force: false });
    if (this.#broadcast) this.#broadcast("overview_updated", overview);
    return { ok: true, overview };
  }

  async #writeTopicContextMarkdown(topic, digestRecord) {
    const cwd = normPath(topic?.primaryCwd);
    if (!cwd || !digestRecord?.summary) return "";
    const filePath = resolve(cwd, `.agent-context.${topic.id}.md`);
    const recentItems = Array.isArray(digestRecord.recentItems) ? digestRecord.recentItems : [];
    const lines = [
      `# ${topic.name} · 产线历史归档上下文`,
      "",
      `> 更新时间：${digestRecord.updatedAt || ""} | 累计沉淀归档会话：${digestRecord.totalArchivedDigested || 0} 条`,
      "",
      "## 核心沉淀与衔接摘要",
      "",
      digestRecord.summary,
      "",
    ];
    if (recentItems.length) {
      lines.push("## 近期已归档会话索引", "");
      for (const item of recentItems.slice(0, 30)) {
        const datePart = item.date ? `[${item.date}] ` : "";
        const stagePart = item.stage ? `（${item.stage}）` : "";
        const prevPart = item.preview ? ` — ${item.preview}` : "";
        lines.push(`- ${datePart}**${item.title || "未命名会话"}**${stagePart}${prevPart}`);
      }
      lines.push("");
    }
    try {
      await writeFile(filePath, lines.join("\n"), "utf8");
      return filePath;
    } catch {
      return "";
    }
  }

  #buildDeterministicArchiveSummary(topic, archivedList = [], prevSummary = "") {
    const stages = [...new Set(archivedList.map((t) => t.stage).filter(Boolean))];
    const footprints = [...new Set(archivedList.flatMap((t) => t.allFootprints || t.footprints || []).filter(Boolean))].slice(0, 6);
    const highlights = archivedList
      .slice(0, 5)
      .map((t) => {
        const title = compactHeadline(t.title || "未命名任务", 24);
        const prev = compactHeadline(t.preview || "", 32);
        return prev && prev !== title ? `${title}（${prev}）` : title;
      });
    const parts = [];
    if (prevSummary) {
      parts.push(`前期沉淀：${String(prevSummary).replace(/\s+/g, " ").slice(0, 160)}`);
    }
    parts.push(`本次归档 ${archivedList.length} 条会话${stages.length ? `（涉及${stages.join("/")}阶段）` : ""}：${highlights.join("；")}。`);
    if (footprints.length) {
      parts.push(`高频触达模块：${footprints.join("、")}。`);
    }
    return parts.join(" ").slice(0, 460);
  }

  // Reads each candidate's transcript tail, asks the model which outcomes deserve long-term memory,
  // and writes them (facts / decisions / lessons / wip + a session ledger row) into the vault.
  // Returns null when no vault is configured; vault write errors propagate so nothing gets archived.
  async #distillArchiveToMemory({ topicCfg, targetTopic, candidates = [], preferredModel = "auto" }) {
    const root = await resolveVaultPath({ env: this.#env, dataDir: this.#dataDir }).catch(() => "");
    if (!root) return null;
    const vault = new MemoryVault(root);
    const scope = topicCfg.id;
    await vault.ensureCard(scope, { name: topicCfg.name || targetTopic?.name || scope });

    const transcripts = [];
    let budget = ARCHIVE_TRANSCRIPT_TOTAL_CHARS;
    for (const c of candidates.slice(0, 25)) {
      if (budget <= 0) break;
      let body = "";
      if (typeof this.#hub?.readThread === "function") {
        const res = await this.#hub.readThread(c.id, { limit: ARCHIVE_TRANSCRIPT_TURNS }).catch(() => null);
        body = buildArchiveTranscript(res?.thread?.turns || [], { maxChars: Math.min(ARCHIVE_TRANSCRIPT_CHARS, budget) });
      }
      budget -= body.length;
      transcripts.push(`### [${c.date || `${c.idleDays}天前`}] ${c.title}（${c.id}）\n${body || `预览：${c.preview || "无"}`}`);
    }

    const existingBrief = await vault.brief({ scope, maxChars: 1600 }).catch(() => "");
    const scopeDir = `${vault.scopeDir(scope)}/`;
    const allNotes = await vault.listNotes().catch(() => []);
    const existingNoteKeys = new Set(allNotes.map((rel) => memoryDedupKey(basename(rel, ".md"))));
    const scopeNoteTitles = allNotes
      .filter((rel) => rel.startsWith(scopeDir) && !/^(台账-|任务-)/.test(basename(rel)) && rel !== vault.cardPath(scope))
      .map((rel) => basename(rel, ".md"));
    const card = await vault.tryRead(vault.cardPath(scope));
    const existingFacts = new Map(parseTable(getSection(card?.body || "", "事实")).rows.map((r) => [r["键"], memoryDedupKey(r["值"])]));
    const existingDecisionKeys = getSection(card?.body || "", "决策").split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => memoryDedupKey(l.replace(/^- \d{4}-\d{2}-\d{2}\s*/, "").replace(/（(agent|user|code)）$/, "")));
    const prompt = [
      `你是「${targetTopic?.name || scope}」项目的共享记忆管理员。下列会话即将归档，请提炼其中值得长期保留的成果写入记忆库。`,
      "准入三问，满足任一才记：下次新会话会再问吗？花了力气才得到的吗？换个会话会做错吗？",
      "规则：1. 只记已落地或已验证的结论，不记过程闲聊、一次性输出、能从代码/git 直接读到的内容；",
      "2. facts 用短键（如「当前进度」「部署端口」），与已有记忆同义时复用原键名以便覆盖；",
      "3. decisions 只记用户拍板的决定或偏好；lessons 只记可复用的踩坑经验；wip 只记明确做了一半、需要接着做的任务；",
      "4. 【已有记忆】里已经记过的内容（包括换个说法的同义表述）一律不要再输出，只输出新增的或值发生变化的条目；",
      "5. 严禁写入密码、token、cookie、API key 等凭证；没有值得记的就返回空数组。",
      '只输出 JSON：{"summary":"150字内的本批会话成果概述","facts":[{"key":"","value":""}],"decisions":[""],"lessons":[{"title":"","body":""}],"wip":[{"slug":"","title":"","state":"","next":""}]}',
      existingBrief ? `\n【已有记忆】\n${existingBrief}` : "",
      scopeNoteTitles.length ? `已有笔记：${scopeNoteTitles.slice(0, 40).join("、")}` : "",
      `\n【待归档会话 ${candidates.length} 条】`,
      ...transcripts,
    ].filter(Boolean).join("\n");

    const aiRes = await this.#invokeLightweightModel(prompt, preferredModel || "auto").catch(() => null);
    const distilled = Boolean(aiRes?.parsed && typeof aiRes.parsed === "object");
    const plan = normalizeArchiveMemoryPlan(aiRes?.parsed);
    const sourceIds = candidates.map((c) => c.id);
    const files = new Set();
    const report = { scope, distilled, facts: 0, conflicts: 0, decisions: 0, lessons: 0, wip: 0, skipped: 0, sessions: 0, files: [] };

    // Anything the vault already holds is skipped outright (no rewrite, no "re-confirmed" churn).
    for (const f of plan.facts) {
      if (existingFacts.get(f.key) === memoryDedupKey(f.value)) {
        report.skipped += 1;
        continue;
      }
      const res = await vault.upsertFact(scope, f.key, f.value, { source: "agent" });
      if (res.action === "conflict") report.conflicts += 1;
      else report.facts += 1;
      files.add(res.file);
    }
    for (const d of plan.decisions) {
      const key = memoryDedupKey(d);
      if (existingDecisionKeys.some((k) => k && (k === key || k.includes(key) || key.includes(k)))) {
        report.skipped += 1;
        continue;
      }
      existingDecisionKeys.push(key);
      const res = await vault.addDecision(scope, d, { source: "agent" });
      if (res.action === "added") report.decisions += 1;
      files.add(res.file);
    }
    for (const l of plan.lessons) {
      if (existingNoteKeys.has(memoryDedupKey(l.title))) {
        report.skipped += 1;
        continue;
      }
      existingNoteKeys.add(memoryDedupKey(l.title));
      try {
        const res = await vault.addNote({ scope, title: l.title, kind: "lesson", body: `${l.body}\n\n来源会话：${sourceIds.join("、")}` });
        report.lessons += 1;
        files.add(res.file);
      } catch (err) {
        if (!/已存在同名笔记/.test(String(err?.message || ""))) throw err;
      }
    }
    for (const w of plan.wip) {
      const res = await vault.updateWip(scope, w.slug, { title: w.title, state: w.state, next: w.next, log: "归档会话时提炼" });
      report.wip += 1;
      files.add(res.file);
    }
    const archivedOn = vaultToday();
    for (const c of candidates) {
      const res = await vault.upsertLedger(scope, "会话", {
        会话: c.id,
        日期: c.date || archivedOn,
        引擎: String(c.id).split(":")[0] || "",
        标题: compactHeadline(c.title || "未命名会话", 60),
        归档: archivedOn,
      }, { keys: ["会话"] });
      report.sessions += 1;
      files.add(res.file);
    }
    report.files = [...files];

    const counts = [
      report.facts && `事实 ${report.facts}`,
      report.decisions && `决策 ${report.decisions}`,
      report.lessons && `经验 ${report.lessons}`,
      report.wip && `任务卡 ${report.wip}`,
      report.conflicts && `待裁决 ${report.conflicts}`,
      report.skipped && `已有跳过 ${report.skipped}`,
    ].filter(Boolean).join("、");
    const head = distilled
      ? `已落记忆库（${scope}）：${counts || "本批无新增长期记忆"}；${report.sessions} 条会话已登记到「台账-会话」。`
      : `模型提炼不可用，仅把 ${report.sessions} 条会话登记到记忆库「台账-会话」（${scope}），可随时取消归档回看。`;
    return { summary: [head, plan.summary].filter(Boolean).join("\n"), report };
  }

  async archiveAndSummarizeTopic({
    topicId = "",
    staleDays = 3,
    confirmOnly = false,
    threadIds = null,
    preferredModel = "auto",
  } = {}) {
    await this.#ensureLoaded();
    const cleanId = String(topicId || "").trim();
    const topicCfg = this.#topics.find((t) => t.id === cleanId);
    if (!cleanId || !topicCfg) {
      throw Object.assign(new Error(`未知产线 ID：${cleanId}`), { status: 400 });
    }

    const overview = await this.getOverview({ trigger: "view", force: false });
    const targetTopic = overview.domains.flatMap((d) => d.topics || []).find((t) => t.id === cleanId);
    if (!targetTopic) {
      throw Object.assign(new Error(`未找到产线快照：${cleanId}`), { status: 404 });
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const daysNum = Math.max(0, Number.isFinite(Number(staleDays)) ? Number(staleDays) : 3);
    const minIdleSec = daysNum * 86400;

    const seen = new Set();
    const allUnarchivedForTopic = [];
    for (const item of [...(targetTopic.activeThreads || []), ...(targetTopic.archivedThreads || [])]) {
      if (!item?.id || item.isSlice || seen.has(item.id)) continue;
      seen.add(item.id);
      allUnarchivedForTopic.push(item);
    }

    const explicitIdSet = Array.isArray(threadIds) && threadIds.length
      ? new Set(threadIds.map((x) => String(x || "").trim()).filter(Boolean))
      : null;

    const candidates = allUnarchivedForTopic
      .filter((t) => {
        if (t.live || (t.pendingCount || 0) > 0 || t.pinned || t.goalState?.active) return false;
        if (explicitIdSet) return explicitIdSet.has(t.id);
        const updSec = Number(t.updatedAt) > 1e11 ? Math.floor(Number(t.updatedAt) / 1000) : Number(t.updatedAt || 0);
        const idleSec = updSec > 0 ? Math.max(0, nowSec - updSec) : minIdleSec;
        return idleSec >= minIdleSec;
      })
      .map((t) => {
        const updSec = Number(t.updatedAt) > 1e11 ? Math.floor(Number(t.updatedAt) / 1000) : Number(t.updatedAt || 0);
        const idleDays = updSec > 0 ? Math.max(0, Math.floor((nowSec - updSec) / 86400)) : daysNum;
        const dateStr = updSec > 0 ? new Date(updSec * 1000).toISOString().slice(0, 10) : "";
        return {
          id: t.id,
          title: t.title || "未命名会话",
          preview: compactHeadline(t.preview || "", 60),
          stage: t.stage || "",
          footprints: t.allFootprints || t.footprints || [],
          updatedAt: updSec,
          idleDays,
          date: dateStr,
        };
      });

    const existingDigest = this.#contextsStore.topics?.[cleanId] || null;

    if (confirmOnly) {
      return {
        ok: true,
        confirmOnly: true,
        topicId: cleanId,
        topicName: targetTopic.name,
        staleDays: daysNum,
        candidates,
        existingDigest,
        memoryVault: Boolean(await resolveVaultPath({ env: this.#env, dataDir: this.#dataDir }).catch(() => "")),
      };
    }

    if (!candidates.length) {
      return {
        ok: true,
        confirmOnly: false,
        archivedCount: 0,
        digest: existingDigest,
        overview,
      };
    }

    // Distill into the shared memory vault first; threads are archived only after memory lands.
    const memory = await this.#distillArchiveToMemory({ topicCfg, targetTopic, candidates, preferredModel });

    const idsToArchive = candidates.map((c) => c.id);
    if (typeof this.#hub?.archiveThreads === "function") {
      await this.#hub.archiveThreads(idsToArchive, true);
    }

    // Without a vault, fall back to the legacy digest (AI with deterministic fallback).
    let distilledSummary = memory?.summary || "";
    const aiPrompt = [
      `你是「${targetTopic.name}」产线的项目记忆总管。请将下列刚刚归档的历史会话与原有归档摘要合并提炼成一段 150~340 字的高密度中文「产线归档记忆摘要」，供后续新开派工单的 AI 员工直接继承上下文。`,
      "要求：1. 只保留已落地的关键结论、架构/脚本约定、踩坑教训与待续方向；2. 严禁空话套话与 emoji；3. 只输出纯文本摘要本身（不要 Markdown 标题或代码块）。",
      existingDigest?.summary ? `\n【原有归档摘要】\n${existingDigest.summary}` : "",
      `\n【本次新归档的 ${candidates.length} 条会话】`,
      ...candidates.slice(0, 25).map((c) => `- [${c.date || `${c.idleDays}天前`}] (${c.stage || "研发"}) ${c.title}：${c.preview || "无预览"}`),
    ].filter(Boolean).join("\n");

    if (!memory) try {
      if (this.#runAiImpl) {
        const aiRes = await this.#runAiImpl(aiPrompt, preferredModel || "auto");
        const rawText = typeof aiRes === "string" ? aiRes : String(aiRes?.summary || aiRes?.text || "");
        distilledSummary = rawText.trim().slice(0, 480);
      } else {
        const aiRes = await this.#invokeLightweightModel(aiPrompt, preferredModel || "auto").catch(() => null);
        const rawText = String(aiRes?.text || "").trim();
        if (rawText) {
          try {
            const maybeJson = JSON.parse(rawText);
            distilledSummary = String(maybeJson?.summary || rawText).trim().slice(0, 480);
          } catch {
            distilledSummary = rawText.replace(/^```[\w]*\s*|\s*```$/g, "").trim().slice(0, 480);
          }
        }
      }
    } catch {}

    if (!distilledSummary) {
      distilledSummary = this.#buildDeterministicArchiveSummary(targetTopic, candidates, existingDigest?.summary || "");
    }

    const nowIso = new Date().toISOString().slice(0, 16).replace("T", " ");
    const prevItems = Array.isArray(existingDigest?.recentItems) ? existingDigest.recentItems : [];
    const mergedItems = [...candidates, ...prevItems].slice(0, 40);
    const nextDigest = {
      topicId: cleanId,
      topicName: targetTopic.name,
      summary: distilledSummary,
      lastBatchCount: candidates.length,
      totalArchivedDigested: (Number(existingDigest?.totalArchivedDigested) || 0) + candidates.length,
      updatedAt: nowIso,
      contextFilePath: "",
      recentItems: mergedItems,
      memory: memory?.report || null,
    };
    if (!memory) nextDigest.contextFilePath = await this.#writeTopicContextMarkdown(topicCfg, nextDigest);

    this.#contextsStore.topics[cleanId] = nextDigest;
    await this.#persistContexts();

    const nextOverview = await this.getOverview({ trigger: "view", force: false });
    if (this.#broadcast) this.#broadcast("overview_updated", nextOverview);
    return {
      ok: true,
      confirmOnly: false,
      archivedCount: candidates.length,
      digest: nextDigest,
      overview: nextOverview,
    };
  }

  async upsertTopicArchiveContext({ topicId = "", summary = "", clear = false } = {}) {
    await this.#ensureLoaded();
    const cleanId = String(topicId || "").trim();
    const topicCfg = this.#topics.find((t) => t.id === cleanId);
    if (!cleanId || !topicCfg) {
      throw Object.assign(new Error(`未知产线 ID：${cleanId}`), { status: 400 });
    }
    if (clear) {
      delete this.#contextsStore.topics[cleanId];
      await this.#persistContexts();
    } else {
      const cleanSummary = String(summary || "").trim().slice(0, 800);
      if (!cleanSummary) {
        throw Object.assign(new Error("归档摘要内容不能为空"), { status: 400 });
      }
      const prev = this.#contextsStore.topics[cleanId] || {};
      const nowIso = new Date().toISOString().slice(0, 16).replace("T", " ");
      const nextDigest = {
        ...prev,
        topicId: cleanId,
        topicName: topicCfg.name,
        summary: cleanSummary,
        totalArchivedDigested: Number(prev.totalArchivedDigested) || 0,
        updatedAt: nowIso,
        recentItems: Array.isArray(prev.recentItems) ? prev.recentItems : [],
      };
      nextDigest.contextFilePath = await this.#writeTopicContextMarkdown(topicCfg, nextDigest);
      this.#contextsStore.topics[cleanId] = nextDigest;
      await this.#persistContexts();
    }
    const overview = await this.getOverview({ trigger: "view", force: false });
    if (this.#broadcast) this.#broadcast("overview_updated", overview);
    return { ok: true, digest: this.#contextsStore.topics[cleanId] || null, overview };
  }

  #findTopicByQuery(query) {
    const raw = String(query || "").trim().replace(/^[「"'【]+|[」"'】]+$/g, "").trim();
    if (!raw) return null;
    const low = raw.toLowerCase();
    return (
      this.#topics.find((t) => t.id.toLowerCase() === low || t.name.toLowerCase() === low)
      || this.#topics.find((t) => t.name.toLowerCase().includes(low) || low.includes(t.name.toLowerCase()))
      || null
    );
  }

  #findDomainByQuery(query) {
    const raw = String(query || "").trim().replace(/^[「"'【]+|[」"'】]+$/g, "").trim();
    if (!raw) return null;
    const low = raw.toLowerCase();
    const direct = this.#domains.find((d) => (
      d.id.toLowerCase() === low
      || d.name.toLowerCase() === low
      || String(d.shortName || "").toLowerCase() === low
      || d.name.toLowerCase().includes(low)
      || String(d.shortName || "").toLowerCase().includes(low)
    ));
    if (direct) return direct;
    if (/(研发|软件|开发|代码|工程|tech|indie)/.test(low)) return this.#domains.find((d) => d.id === "indie-lab") || null;
    if (/(创作|内容|漫剧|小说|视频|短剧|工坊|drama)/.test(low)) return this.#domains.find((d) => d.id === "drama-studio") || null;
    if (/(发布|增长|发行|推广|海外|营销|pub|growth)/.test(low)) return this.#domains.find((d) => d.id === "global-pub") || null;
    if (/(运维|专项|赏金|排查|支持|bounty|ops)/.test(low)) return this.#domains.find((d) => d.id === "bounty-guild") || null;
    return null;
  }

  #parseDeterministicBlueprintOps(instruction) {
    const text = String(instruction || "").trim();
    if (!text) return [];
    const ops = [];

    if (/(重新扫描|重扫|重新发现|恢复默认发现|清空重扫)/.test(text)) {
      const clearExisting = /(清空|重置|全部重新)/.test(text);
      ops.push({
        type: "rescan",
        clearExisting,
        label: clearExisting ? "清空当前产线并重新扫描本地仓库" : "补充扫描本地仓库并追加未收录产线",
      });
      return ops;
    }

    const clauses = text.split(/[，,。；;\n]+/).map((s) => s.trim()).filter(Boolean);
    for (const clause of clauses) {
      let m = clause.match(/^(?:请|帮我|把)?[「"'【]?(.+?)[」"'】]?(?:改名为|重命名为|改成|改叫|叫作?)[「"'【]?(.+?)[」"'】]?$/);
      if (m) {
        const topic = this.#findTopicByQuery(m[1]);
        const toName = String(m[2] || "").trim().replace(/^[「"'【]+|[」"'】]+$/g, "");
        if (topic && toName && toName !== topic.name) {
          ops.push({
            type: "rename",
            topicId: topic.id,
            fromName: topic.name,
            toName,
            label: `重命名产线：「${topic.name}」→「${toName}」`,
          });
          continue;
        }
      }

      m = clause.match(/^(?:请|帮我|把)?[「"'【]?(.+?)[」"'】]?(?:移到|移动到|放到|归入|挪到|调整到)[「"'【]?(.+?)[」"'】]?$/);
      if (m) {
        const topic = this.#findTopicByQuery(m[1]);
        const domain = this.#findDomainByQuery(m[2]);
        if (topic && domain && topic.domainId !== domain.id) {
          ops.push({
            type: "move",
            topicId: topic.id,
            topicName: topic.name,
            toDomainId: domain.id,
            toDomainName: domain.name,
            label: `移动房区：「${topic.name}」→「${domain.name}」`,
          });
          continue;
        }
      }

      m = clause.match(/^(?:请|帮我|把)?[「"'【]?(.+?)[」"'】]?(?:和|与|跟)[「"'【]?(.+?)[」"'】]?合并(?:成|为)?[「"'【]?(.+?)[」"'】]?$/)
        || clause.match(/^(?:请|帮我|把)?[「"'【]?(.+?)[」"'】]?(?:和|与|跟)[「"'【]?(.+?)[」"'】]?合并$/);
      if (m) {
        const src = this.#findTopicByQuery(m[1]);
        const tgt = this.#findTopicByQuery(m[2]);
        const newName = m[3] ? String(m[3]).trim().replace(/^[「"'【]+|[」"'】]+$/g, "") : "";
        if (src && tgt && src.id !== tgt.id) {
          ops.push({
            type: "merge",
            sourceTopicId: src.id,
            sourceName: src.name,
            targetTopicId: tgt.id,
            targetName: newName || tgt.name,
            newName: newName || "",
            label: `合并产线：「${src.name}」并入「${newName || tgt.name}」`,
          });
          continue;
        }
      }

      m = clause.match(/^(?:请|帮我|把)?[「"'【]?(.+?)[」"'】]?合并到[「"'【]?(.+?)[」"'】]?$/);
      if (m) {
        const src = this.#findTopicByQuery(m[1]);
        const tgt = this.#findTopicByQuery(m[2]);
        if (src && tgt && src.id !== tgt.id) {
          ops.push({
            type: "merge",
            sourceTopicId: src.id,
            sourceName: src.name,
            targetTopicId: tgt.id,
            targetName: tgt.name,
            label: `合并产线：「${src.name}」并入「${tgt.name}」`,
          });
          continue;
        }
      }

      m = clause.match(/^(?:请|帮我)?(?:删除|移除|去掉|隐藏|不要)[「"'【]?(.+?)[」"'】]?(?:产线|项目|这?条)?$/);
      if (m) {
        const topic = this.#findTopicByQuery(m[1]);
        if (topic) {
          ops.push({
            type: "remove",
            topicId: topic.id,
            topicName: topic.name,
            label: `移除产线：「${topic.name}」（保留原有会话，仅从梦工厂看板撤下）`,
          });
          continue;
        }
      }
    }
    return ops;
  }

  #normalizeBlueprintOps(rawOps = []) {
    const out = [];
    for (const raw of Array.isArray(rawOps) ? rawOps : []) {
      if (!raw || !raw.type) continue;
      if (raw.type === "rescan") {
        const clearExisting = Boolean(raw.clearExisting);
        out.push({
          type: "rescan",
          clearExisting,
          label: raw.label || (clearExisting ? "清空当前产线并重新扫描本地仓库" : "补充扫描本地仓库并追加未收录产线"),
        });
      } else if (raw.type === "rename") {
        const topic = this.#findTopicByQuery(raw.topicId || raw.fromName);
        const toName = String(raw.toName || "").trim();
        if (topic && toName) {
          out.push({
            type: "rename",
            topicId: topic.id,
            fromName: topic.name,
            toName,
            label: raw.label || `重命名产线：「${topic.name}」→「${toName}」`,
          });
        }
      } else if (raw.type === "move") {
        const topic = this.#findTopicByQuery(raw.topicId || raw.topicName);
        const domain = this.#findDomainByQuery(raw.toDomainId || raw.toDomainName);
        if (topic && domain) {
          out.push({
            type: "move",
            topicId: topic.id,
            topicName: topic.name,
            toDomainId: domain.id,
            toDomainName: domain.name,
            label: raw.label || `移动房区：「${topic.name}」→「${domain.name}」`,
          });
        }
      } else if (raw.type === "merge") {
        const src = this.#findTopicByQuery(raw.sourceTopicId || raw.sourceName);
        const tgt = this.#findTopicByQuery(raw.targetTopicId || raw.targetName);
        if (src && tgt && src.id !== tgt.id) {
          const newName = String(raw.newName || "").trim();
          out.push({
            type: "merge",
            sourceTopicId: src.id,
            sourceName: src.name,
            targetTopicId: tgt.id,
            targetName: newName || tgt.name,
            newName,
            label: raw.label || `合并产线：「${src.name}」并入「${newName || tgt.name}」`,
          });
        }
      } else if (raw.type === "remove") {
        const topic = this.#findTopicByQuery(raw.topicId || raw.topicName);
        if (topic) {
          out.push({
            type: "remove",
            topicId: topic.id,
            topicName: topic.name,
            label: raw.label || `移除产线：「${topic.name}」`,
          });
        }
      } else if (raw.type === "update_desc") {
        const topic = this.#findTopicByQuery(raw.topicId || raw.topicName);
        const description = String(raw.description || "").trim();
        if (topic && description) {
          out.push({
            type: "update_desc",
            topicId: topic.id,
            topicName: topic.name,
            description,
            label: raw.label || `更新「${topic.name}」简介`,
          });
        }
      }
    }
    return out;
  }

  async planAndApplyBlueprintEdit({
    instruction = "",
    confirmOnly = true,
    operations = null,
    preferredModel = "auto",
  } = {}) {
    await this.#ensureLoaded();
    const cleanInstruction = String(instruction || "").trim();
    let plannedOps = Array.isArray(operations) && operations.length
      ? this.#normalizeBlueprintOps(operations)
      : this.#parseDeterministicBlueprintOps(cleanInstruction);
    let aiUsed = false;
    let summary = "";

    if (!plannedOps.length && cleanInstruction) {
      const domainLines = this.#domains.map((d) => `- ${d.id}: ${d.name} (${d.shortName})`).join("\n");
      const topicLines = this.#topics.map((t) => `- ${t.id} | ${t.name} | 房区=${t.domainId} | 目录=${t.primaryCwd || "-"}`).join("\n");
      const aiPrompt = [
        "你是梦工厂总控台的产线蓝图规划器。用户通过口述/文字要求纠偏当前自动扫描出的梦工厂产线布局。",
        "可选房区（domains）：",
        domainLines,
        "当前产线（topics）：",
        topicLines || "（暂无）",
        `用户要求：「${cleanInstruction}」`,
        "请只输出一个合法 JSON 对象，不要附加 markdown 代码块或多余文字：",
        `{"summary":"一句话说明本次调整方案","operations":[{"type":"rename|move|merge|remove|rescan|update_desc",...}]}`,
        "operations 字段格式：",
        '- rename: {"type":"rename","topicId":"...","toName":"新名称"}',
        '- move: {"type":"move","topicId":"...","toDomainId":"indie-lab|drama-studio|global-pub|bounty-guild"}',
        '- merge: {"type":"merge","sourceTopicId":"...","targetTopicId":"...","newName":"可选新名称"}',
        '- remove: {"type":"remove","topicId":"..."}',
        '- rescan: {"type":"rescan","clearExisting":false}',
        '- update_desc: {"type":"update_desc","topicId":"...","description":"新简介"}',
      ].join("\n");
      const aiRes = await this.#invokeLightweightModel(aiPrompt, preferredModel || "auto").catch(() => null);
      if (aiRes?.parsed && typeof aiRes.parsed === "object") {
        plannedOps = this.#normalizeBlueprintOps(aiRes.parsed.operations);
        summary = String(aiRes.parsed.summary || "").trim();
        aiUsed = true;
      }
    }

    if (!plannedOps.length) {
      throw Object.assign(
        new Error("未识别到可执行的梦工厂布局调整指令。你可以这样说：「把 xxx 改名为 yyy」「把 xxx 移到内容工坊」「把 A 和 B 合并」「删除 xxx」或「重新扫描本地仓库」。"),
        { status: 400 },
      );
    }

    if (!summary) {
      summary = plannedOps.map((o) => o.label).join("；");
    }

    if (confirmOnly) {
      return {
        ok: true,
        pendingConfirmation: true,
        aiUsed,
        summary,
        operations: plannedOps,
        instruction: cleanInstruction,
      };
    }

    const applied = [];
    for (const op of plannedOps) {
      if (op.type === "rename") {
        const t = this.#topics.find((item) => item.id === op.topicId);
        if (t) {
          t.name = op.toName;
          t.autoDiscovered = false;
          applied.push(op);
        }
      } else if (op.type === "move") {
        const t = this.#topics.find((item) => item.id === op.topicId);
        if (t && this.#domains.some((d) => d.id === op.toDomainId)) {
          t.domainId = op.toDomainId;
          t.autoDiscovered = false;
          applied.push(op);
        }
      } else if (op.type === "update_desc") {
        const t = this.#topics.find((item) => item.id === op.topicId);
        if (t) {
          t.description = op.description;
          applied.push(op);
        }
      } else if (op.type === "merge") {
        const srcIdx = this.#topics.findIndex((item) => item.id === op.sourceTopicId);
        const tgt = this.#topics.find((item) => item.id === op.targetTopicId);
        if (srcIdx >= 0 && tgt && tgt.id !== op.sourceTopicId) {
          const src = this.#topics[srcIdx];
          tgt.cwdPrefixes = [...new Set([...(tgt.cwdPrefixes || []), ...(src.cwdPrefixes || []), ...(src.primaryCwd ? [src.primaryCwd] : [])])];
          tgt.keywords = [...new Set([...(tgt.keywords || []), ...(src.keywords || []), src.name.toLowerCase()])];
          if (op.newName) tgt.name = op.newName;
          tgt.autoDiscovered = false;
          this.#topics.splice(srcIdx, 1);
          applied.push(op);
        }
      } else if (op.type === "remove") {
        const idx = this.#topics.findIndex((item) => item.id === op.topicId);
        if (idx >= 0) {
          const removed = this.#topics[idx];
          if (removed?.primaryCwd) {
            const cleanRemoved = normPath(removed.primaryCwd);
            if (cleanRemoved && !this.#ignoredCwds.some((p) => pathMatchesPrefix(cleanRemoved, p))) {
              this.#ignoredCwds.push(cleanRemoved);
            }
          }
          this.#topics.splice(idx, 1);
          applied.push(op);
        }
      } else if (op.type === "rescan") {
        const listRes = typeof this.#hub?.listThreads === "function"
          ? await this.#hub.listThreads({ includeArchived: false, limit: 500 }).catch(() => ({ threads: [] }))
          : { threads: [] };
        const rawThreads = Array.isArray(listRes) ? listRes : (Array.isArray(listRes?.threads) ? listRes.threads : []);
        await this.#syncDiscoveredTopics(rawThreads, {
          forceRescan: true,
          clearExisting: Boolean(op.clearExisting),
        });
        applied.push(op);
      }
    }

    await this.#persistDomains();
    const overview = await this.getOverview({ trigger: "view", force: true });
    if (this.#broadcast) this.#broadcast("overview_updated", overview);
    return {
      ok: true,
      pendingConfirmation: false,
      aiUsed,
      summary,
      appliedCount: applied.length,
      operations: applied,
      overview,
    };
  }
}
