import { open, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { formatProfileKey } from "./composite-id.mjs";
import { execFileCrossPlatform, resolveUserHome } from "./platform.mjs";
import {
  defaultClaudeDesktopUserDataDir,
  readClaudeDesktopSessionsMeta,
} from "./providers/profile-discovery.mjs";

const TAIL_READ_BYTES = 128 * 1024;
const MAX_CLAUDE_FILES = 20;
const MAX_CODEX_FILES = 5;
const MAX_GROK_USAGE_FILES = 80;
const FIVE_HOURS_MS = 5 * 3600 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 3600 * 1000;
const CLAUDE_LOOKBACK_MS = SEVEN_DAYS_MS;
const CLAUDE_PLAN_WEEKLY_MAX_AGE_MS = 24 * 3600 * 1000;
const CLAUDE_PLAN_STALE_DETAIL_AGE_MS = 2 * 3600 * 1000;

const MONTH_NAMES = Object.freeze({
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
});

function getTimeZoneParts(epochMs, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const out = {};
  for (const part of fmt.formatToParts(new Date(epochMs))) {
    if (part.type !== "literal") out[part.type] = Number(part.value);
  }
  return out;
}

function zonedLocalToUtcMs(year, month, day, hour, minute, timeZone) {
  const targetUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let guess = targetUtc;
  for (let i = 0; i < 2; i += 1) {
    const p = getTimeZoneParts(guess, timeZone);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    const diff = asUtc - targetUtc;
    if (diff === 0) break;
    guess -= diff;
  }
  return guess;
}

export function parseClaudeErrorResetSec(errorText, anchorMs) {
  const text = String(errorText || "").trim();
  const anchor = Number(anchorMs);
  if (!text || !Number.isFinite(anchor) || anchor <= 0) return null;

  const match = text.match(
    /resets\s+(?:([A-Za-z]{3})\s+(\d{1,2}),?\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(([^)]+)\))?/i,
  );
  if (!match) return null;

  const monthWord = match[1] ? match[1].toLowerCase() : "";
  const explicitDay = match[2] ? Number(match[2]) : null;
  let hour = Number(match[3]);
  const minute = match[4] ? Number(match[4]) : 0;
  const ampm = String(match[5] || "").toLowerCase();
  const rawTz = String(match[6] || "").trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute > 59) return null;
  if (ampm === "am") {
    hour = hour === 12 ? 0 : hour;
  } else if (ampm === "pm") {
    hour = hour === 12 ? 12 : hour + 12;
  }
  if (hour < 0 || hour > 23) return null;

  let timeZone = rawTz;
  try {
    getTimeZoneParts(anchor, timeZone);
  } catch {
    timeZone = "UTC";
  }

  const baseParts = getTimeZoneParts(anchor, timeZone);
  const explicitMonth = monthWord ? (MONTH_NAMES[monthWord] || null) : null;
  if (explicitMonth && explicitDay) {
    let candidate = zonedLocalToUtcMs(baseParts.year, explicitMonth, explicitDay, hour, minute, timeZone);
    if (candidate <= anchor - 60_000) {
      candidate = zonedLocalToUtcMs(baseParts.year + 1, explicitMonth, explicitDay, hour, minute, timeZone);
    }
    return Math.floor(candidate / 1000);
  }

  let candidate = zonedLocalToUtcMs(baseParts.year, baseParts.month, baseParts.day, hour, minute, timeZone);
  if (candidate <= anchor - 60_000) {
    candidate = zonedLocalToUtcMs(baseParts.year, baseParts.month, baseParts.day + 1, hour, minute, timeZone);
  }
  return Math.floor(candidate / 1000);
}

function clampPercent(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function toTimestampSec(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
  }
  const num = Number(value);
  if (Number.isFinite(num) && String(value).trim() !== "") {
    return num > 1e12 ? Math.floor(num / 1000) : Math.floor(num);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : fallback;
}

export function statusToneFromPercent(remainingPercent) {
  if (remainingPercent === null || remainingPercent === undefined || !Number.isFinite(Number(remainingPercent))) {
    return "unknown";
  }
  const pct = Number(remainingPercent);
  if (pct <= 0) return "exhausted";
  if (pct < 20) return "warn";
  return "ok";
}

function pickLowestRemainingBucket(buckets = []) {
  const withPct = buckets.filter((b) => typeof b?.remainingPercent === "number" && Number.isFinite(b.remainingPercent));
  if (!withPct.length) return buckets[0] || null;
  return withPct.reduce((best, cur) => (cur.remainingPercent < best.remainingPercent ? cur : best));
}

async function readJsonSafe(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function readTailText(filePath, maxBytes = TAIL_READ_BYTES) {
  const st = await stat(filePath).catch(() => null);
  if (!st || !st.isFile() || st.size === 0) return "";
  if (st.size <= maxBytes) {
    return readFile(filePath, "utf8").catch(() => "");
  }
  const fh = await open(filePath, "r").catch(() => null);
  if (!fh) return "";
  try {
    const offset = Math.max(0, st.size - maxBytes);
    const length = st.size - offset;
    const buf = Buffer.allocUnsafe(length);
    await fh.read(buf, 0, length, offset);
    const text = buf.toString("utf8");
    const firstNl = text.indexOf("\n");
    return offset > 0 && firstNl >= 0 ? text.slice(firstNl + 1) : text;
  } finally {
    await fh.close().catch(() => {});
  }
}

async function readCockpitAccountRows(sqlitePath) {
  const st = await stat(sqlitePath).catch(() => null);
  if (!st?.isFile()) return [];
  try {
    const { stdout = "" } = await execFileCrossPlatform(
      "sqlite3",
      [
        "-readonly",
        "-json",
        sqlitePath,
        "SELECT account_id, email, name, plan_type, subscription_active_until FROM summaries;",
      ],
      { timeout: 2_000, maxBuffer: 256 * 1024 },
    );
    const rows = JSON.parse(stdout.trim() || "[]");
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function formatPlanLabel(rawPlan) {
  const clean = String(rawPlan || "").trim();
  if (!clean) return "";
  const map = {
    prolite: "Pro Lite",
    pro: "Pro",
    chatgptpro: "ChatGPT Pro",
    plus: "Plus",
    team: "Team",
    free: "Free",
    enterprise: "Enterprise",
    max: "Max",
    claude_pro: "Pro",
    claude_max: "Max",
    claude_team: "Team",
    claude_enterprise: "Enterprise",
    grokpro: "Grok Pro",
    supergrok: "SuperGrok",
    gateway: "API Gateway",
  };
  return map[clean.toLowerCase()] || clean;
}

function formatCodexBucketLabel(windowMinutes, fallbackLabel) {
  const mins = Number(windowMinutes);
  if (mins > 0 && mins <= 360) return "5h 限额";
  if (mins >= 1440) return "周限额";
  if (mins > 0) {
    return mins >= 60 ? `${Math.round(mins / 60)}h 限额` : `${mins}m 限额`;
  }
  return fallbackLabel;
}

function classifyCodexWindowKind(windowMinutes) {
  const mins = Number(windowMinutes);
  if (mins > 0 && mins <= 360) return "five_hour";
  if (mins >= 1440) return "weekly";
  return "";
}

function formatCodexBucket(id, rawBucket, fallbackLabel, nowSec) {
  if (!rawBucket || typeof rawBucket !== "object") return null;
  const windowMins = Number(rawBucket.windowDurationMins ?? rawBucket.window_minutes ?? 0) || 0;
  const resetsAtRaw = toTimestampSec(rawBucket.resetsAt ?? rawBucket.resets_at, null);
  const label = formatCodexBucketLabel(windowMins, fallbackLabel);
  const windowKind = classifyCodexWindowKind(windowMins);
  if (resetsAtRaw !== null && resetsAtRaw <= nowSec) {
    return {
      id,
      windowKind,
      label,
      remainingPercent: 100,
      usedPercent: 0,
      resetsAt: null,
      detail: "窗口已重置",
    };
  }
  const used = clampPercent(rawBucket.usedPercent ?? rawBucket.used_percent ?? 0) ?? 0;
  const remaining = Math.max(0, 100 - used);
  return {
    id,
    windowKind,
    label,
    remainingPercent: remaining,
    usedPercent: used,
    resetsAt: resetsAtRaw,
    detail: "",
  };
}

function formatCodexCredits(rawCredits) {
  if (!rawCredits || typeof rawCredits !== "object") return null;
  if (rawCredits.unlimited) {
    return { hasCredits: true, unlimited: true, balance: null, label: "无限额" };
  }
  const rawBal = rawCredits.balance;
  const numBal = Number(rawBal);
  if (!rawCredits.hasCredits && !rawCredits.has_credits && !(numBal > 0)) {
    return null;
  }
  if (Number.isFinite(numBal) && numBal > 0) {
    const shortBal = numBal >= 100 ? String(Math.round(numBal)) : numBal.toFixed(2);
    return { hasCredits: true, unlimited: false, balance: String(rawBal), label: `积分 ${shortBal}` };
  }
  return null;
}

async function collectFilesRecursive(dirPath, { maxDepth = 4, ext = ".jsonl" } = {}, depth = 0, out = []) {
  if (depth > maxDepth) return out;
  const entries = await readdir(dirPath, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const full = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await collectFilesRecursive(full, { maxDepth, ext }, depth + 1, out);
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      const st = await stat(full).catch(() => null);
      if (st) out.push({ path: full, mtimeMs: st.mtimeMs });
    }
  }
  return out;
}

function formatAntigravityBucketLabel(bucket) {
  const id = String(bucket?.bucketId || "").toLowerCase();
  if (id === "gemini-5h") return "Gemini 5h";
  if (id === "gemini-weekly") return "Gemini 周";
  if (id === "3p-5h") return "Claude/GPT 5h";
  if (id === "3p-weekly") return "Claude/GPT 周";
  return String(bucket?.displayName || bucket?.bucketId || "配额");
}

function formatAntigravityWindowKind(bucket) {
  const id = String(bucket?.bucketId || "").toLowerCase();
  if (id === "gemini-5h") return "five_hour";
  if (id === "gemini-weekly") return "weekly";
  if (id === "3p-5h") return "third_party_5h";
  if (id === "3p-weekly") return "third_party_weekly";
  return "";
}

function buildQuotaWindows(buckets = []) {
  const list = Array.isArray(buckets) ? buckets : [];
  return {
    fiveHour: list.find((b) => b?.windowKind === "five_hour") || null,
    weekly: list.find((b) => b?.windowKind === "weekly") || null,
    thirdPartyFiveHour: list.find((b) => b?.windowKind === "third_party_5h") || null,
    thirdPartyWeekly: list.find((b) => b?.windowKind === "third_party_weekly") || null,
  };
}

function hasClaudeWindowSignal(win) {
  return Boolean(
    win
    && typeof win === "object"
    && (
      win.status
      || win.rateLimitType
      || win.resetsAt !== undefined
      || win.utilization !== undefined
      || win.remainingPercent !== undefined
    ),
  );
}

function mergeWindowObjects(baseWin, extraWin) {
  if (!baseWin && !extraWin) return null;
  if (!baseWin) return extraWin;
  if (!extraWin) return baseWin;
  return { ...extraWin, ...baseWin };
}

export function extractClaudeRateLimitWindows(obj) {
  if (!obj || typeof obj !== "object") {
    return { fiveHour: null, sevenDay: null };
  }

  let fiveHour = null;
  let sevenDay = null;

  const containers = [
    obj.rate_limit_info,
    obj.rateLimitInfo,
    obj.apiErrorParams?.rate_limit_info,
    obj.quotaLimits,
    obj.rate_limit_event,
    obj,
  ];

  for (const c of containers) {
    if (!c || typeof c !== "object") continue;
    const uw = c.unifiedWindows && typeof c.unifiedWindows === "object" ? c.unifiedWindows : null;
    if (uw) {
      if (!fiveHour && hasClaudeWindowSignal(uw.five_hour)) {
        fiveHour = uw.five_hour;
      }
      const uwWeekly = uw.seven_day || uw.weekly;
      if (!sevenDay && hasClaudeWindowSignal(uwWeekly)) {
        sevenDay = uwWeekly;
      }
    }
    const cand5h = c.five_hour || c.fiveHour;
    if (!fiveHour && hasClaudeWindowSignal(cand5h)) {
      fiveHour = cand5h;
    }
    const cand7d = c.seven_day || c.sevenDay || c.weekly;
    if (!sevenDay && hasClaudeWindowSignal(cand7d)) {
      sevenDay = cand7d;
    }
  }

  for (const c of containers) {
    if (!hasClaudeWindowSignal(c)) continue;
    const rType = String(c.rateLimitType || "").toLowerCase();
    if (rType === "seven_day" || rType === "weekly") {
      sevenDay = mergeWindowObjects(sevenDay, c);
    } else {
      fiveHour = mergeWindowObjects(fiveHour, c);
    }
  }

  return { fiveHour, sevenDay };
}

export class QuotaService {
  #env;
  #homeDir;
  #cockpitDir;
  #grokAppDir;
  #codexQuotaReader;
  #claudeQuotaReader;
  #ttlMs;
  #nowFn;
  #cache = null;
  #inFlight = null;

  constructor({
    env = process.env,
    homeDir = resolveUserHome(env, process.platform, os.homedir()),
    cockpitDir = "",
    grokAppDir = "",
    codexQuotaReader = null,
    claudeQuotaReader = null,
    ttlMs = 30_000,
    nowFn = () => Date.now(),
  } = {}) {
    this.#env = env;
    this.#homeDir = resolve(homeDir);
    this.#cockpitDir = resolve(cockpitDir || join(this.#homeDir, ".antigravity_cockpit"));
    this.#grokAppDir = resolve(grokAppDir || join(this.#homeDir, "Library", "Application Support", "com.grokapp.grok-app"));
    this.#codexQuotaReader = codexQuotaReader;
    this.#claudeQuotaReader = claudeQuotaReader;
    this.#ttlMs = Math.max(0, Number(ttlMs) || 30_000);
    this.#nowFn = nowFn;
  }

  async collectAll(profiles = [], { refresh = false } = {}) {
    const nowMs = this.#nowFn();
    if (!refresh && this.#cache && (nowMs - this.#cache.at) < this.#ttlMs) {
      const sameKeys = profiles.every((p) => {
        const key = p.key || formatProfileKey(p.provider, p.id);
        return this.#cache.byKey.has(key);
      });
      if (sameKeys) {
        return {
          updatedAt: this.#cache.updatedAt,
          quotas: profiles.map((p) => this.#cache.byKey.get(p.key || formatProfileKey(p.provider, p.id))),
          byKey: Object.fromEntries(this.#cache.byKey),
        };
      }
    }

    if (this.#inFlight && !refresh) {
      return this.#inFlight;
    }

    const run = this.#collectFresh(profiles, { refresh, nowMs }).finally(() => {
      if (this.#inFlight === run) this.#inFlight = null;
    });
    this.#inFlight = run;
    return run;
  }

  async #collectFresh(profiles, { refresh, nowMs }) {
    const [codexAccounts, claudeAccounts, grokAccounts, agyAccounts] = await Promise.all([
      readCockpitAccountRows(join(this.#cockpitDir, "codex_accounts.sqlite")),
      readCockpitAccountRows(join(this.#cockpitDir, "claude_accounts.sqlite")),
      readCockpitAccountRows(join(this.#cockpitDir, "grok_accounts.sqlite")),
      readCockpitAccountRows(join(this.#cockpitDir, "antigravity_accounts.sqlite")),
    ]);

    const claudeProfiles = profiles.filter((p) => p?.provider === "claude");
    const claudeMetaByKey = new Map();
    const desktopClaimedByCliDir = new Map();
    await Promise.all(claudeProfiles.map(async (p) => {
      const key = p.key || formatProfileKey(p.provider, p.id);
      const historyKey = resolve(String(p.historyDir || p.cliConfigDir || p.home || ""));
      let meta = await readClaudeDesktopSessionsMeta(p);
      if (!meta.claimedIds.size && !meta.errorEntries.length && p.id === "default") {
        const defaultDesktop = defaultClaudeDesktopUserDataDir({ env: this.#env, home: this.#homeDir });
        if (defaultDesktop && defaultDesktop !== p.desktopUserDataDir) {
          meta = await readClaudeDesktopSessionsMeta({ ...p, desktopUserDataDir: defaultDesktop });
        }
      }
      claudeMetaByKey.set(key, meta);
      if (p.isDesktopInstance && meta.claimedIds.size > 0 && historyKey) {
        let set = desktopClaimedByCliDir.get(historyKey);
        if (!set) {
          set = new Set();
          desktopClaimedByCliDir.set(historyKey, set);
        }
        for (const id of meta.claimedIds) set.add(id);
      }
    }));

    const ctx = {
      nowMs,
      nowSec: Math.floor(nowMs / 1000),
      refresh,
      codexAccounts,
      claudeAccounts,
      grokAccounts,
      agyAccounts,
      claudeProfileCount: claudeProfiles.length,
      claudeMetaByKey,
      desktopClaimedByCliDir,
      antigravityCache: undefined,
      grokBillingCache: undefined,
    };

    const quotas = await Promise.all(profiles.map((profile) => this.#collectForProfile(profile, ctx)));
    const byKey = new Map();
    for (const q of quotas) {
      byKey.set(formatProfileKey(q.provider, q.profileId), q);
    }
    const updatedAt = Math.floor(nowMs / 1000);
    this.#cache = { at: nowMs, updatedAt, byKey };
    return {
      updatedAt,
      quotas,
      byKey: Object.fromEntries(byKey),
    };
  }

  async #collectForProfile(profile, ctx) {
    const base = {
      provider: profile.provider,
      profileId: profile.id,
      available: Boolean(profile.installed && !profile.health?.disabled),
      planLabel: "",
      accountLabel: profile.identityLabel || profile.account?.email || profile.account?.label || "",
      statusTone: "unknown",
      primary: null,
      buckets: [],
      windows: buildQuotaWindows([]),
      credits: null,
      summaryText: "",
      updatedAt: ctx.nowSec,
      source: "none",
    };

    try {
      if (profile.provider === "antigravity") {
        return await this.#collectAntigravity(profile, base, ctx);
      }
      if (profile.provider === "codex") {
        return await this.#collectCodex(profile, base, ctx);
      }
      if (profile.provider === "grok") {
        return await this.#collectGrok(profile, base, ctx);
      }
      if (profile.provider === "claude") {
        return await this.#collectClaude(profile, base, ctx);
      }
      return base;
    } catch {
      return base;
    }
  }

  async #loadAntigravityQuotaCache() {
    const authDir = join(this.#cockpitDir, "cache", "quota_api_v1_desktop", "authorized");
    const files = await readdir(authDir).catch(() => []);
    const candidates = [];
    for (const name of files) {
      if (!name.endsWith(".json")) continue;
      const full = join(authDir, name);
      const st = await stat(full).catch(() => null);
      if (st?.isFile()) candidates.push({ path: full, mtimeMs: st.mtimeMs });
    }
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const cand of candidates) {
      const parsed = await readJsonSafe(cand.path);
      if (parsed?.payload?.quota_summary?.groups) {
        return { parsed, mtimeSec: Math.floor(cand.mtimeMs / 1000) };
      }
    }
    return null;
  }

  async #collectAntigravity(profile, base, ctx) {
    if (ctx.antigravityCache === undefined) {
      ctx.antigravityCache = await this.#loadAntigravityQuotaCache();
    }
    const cache = ctx.antigravityCache;
    if (!cache) {
      const acct = ctx.agyAccounts[0];
      return {
        ...base,
        planLabel: formatPlanLabel(acct?.plan_type) || (profile.profileType === "cli" ? "CLI" : "桌面端"),
        accountLabel: acct?.email || base.accountLabel,
      };
    }

    const { parsed, mtimeSec } = cache;
    const email = String(parsed.email || ctx.agyAccounts[0]?.email || "").trim();
    const matchedAcct = ctx.agyAccounts.find((a) => String(a.email || "").toLowerCase() === email.toLowerCase()) || ctx.agyAccounts[0];
    const groups = Array.isArray(parsed.payload?.quota_summary?.groups) ? parsed.payload.quota_summary.groups : [];
    const buckets = [];
    for (const group of groups) {
      for (const b of Array.isArray(group?.buckets) ? group.buckets : []) {
        const id = String(b.bucketId || b.displayName || "").trim();
        const resetsAt = toTimestampSec(b.resetTime, null);
        const expired = resetsAt !== null && resetsAt <= ctx.nowSec;
        const remainingPercent = expired ? 100 : clampPercent(Number(b.remainingFraction) * 100);
        const usedPercent = remainingPercent !== null ? Math.max(0, 100 - remainingPercent) : null;
        buckets.push({
          id,
          windowKind: formatAntigravityWindowKind(b),
          label: formatAntigravityBucketLabel(b),
          remainingPercent,
          usedPercent,
          resetsAt: expired ? null : resetsAt,
          detail: expired ? "周期已重置" : "",
        });
      }
    }

    const geminiBuckets = buckets.filter((b) => b.id.startsWith("gemini-"));
    const primary = pickLowestRemainingBucket(geminiBuckets.length ? geminiBuckets : buckets);
    const statusTone = statusToneFromPercent(primary?.remainingPercent);
    const summaryText = primary?.remainingPercent !== null && primary?.remainingPercent !== undefined
      ? (primary.remainingPercent <= 0 ? "耗尽" : `余 ${primary.remainingPercent}%`)
      : "";

    return {
      ...base,
      planLabel: formatPlanLabel(matchedAcct?.plan_type) || (profile.profileType === "cli" ? "CLI" : "桌面端"),
      accountLabel: email || base.accountLabel,
      statusTone,
      primary,
      buckets,
      windows: buildQuotaWindows(buckets),
      summaryText,
      updatedAt: toTimestampSec(parsed.updatedAt, mtimeSec) || mtimeSec,
      source: "cockpit-cache",
    };
  }

  async #readLatestCodexRolloutRateLimits(codexHome) {
    const sessionsDir = join(codexHome, "sessions");
    const files = await collectFilesRecursive(sessionsDir, { maxDepth: 4, ext: ".jsonl" });
    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    for (const file of files.slice(0, MAX_CODEX_FILES)) {
      const tail = await readTailText(file.path);
      if (!tail) continue;
      const lines = tail.split("\n").filter(Boolean);
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (!lines[i].includes("rate_limits")) continue;
        try {
          const obj = JSON.parse(lines[i]);
          const rl = obj?.payload?.rate_limits || obj?.payload?.info?.rate_limits || null;
          if (rl && typeof rl === "object") {
            return {
              rateLimits: rl,
              updatedAt: toTimestampSec(obj.timestamp, Math.floor(file.mtimeMs / 1000)),
              source: "rollout-jsonl",
            };
          }
        } catch {
          // Ignore partial/malformed trailing line.
        }
      }
    }
    return null;
  }

  async #collectCodex(profile, base, ctx) {
    const email = String(profile.account?.email || "").trim().toLowerCase();
    const matchedAcct = email
      ? ctx.codexAccounts.find((a) => String(a.email || "").trim().toLowerCase() === email)
      : null;

    let rawData = null;
    if (this.#codexQuotaReader) {
      const res = await this.#codexQuotaReader(profile, { refresh: ctx.refresh }).catch(() => null);
      if (res) {
        rawData = res.rateLimits
          ? res
          : { rateLimits: res, updatedAt: ctx.nowSec, source: "rpc" };
      }
    }
    if (!rawData && profile.home) {
      rawData = await this.#readLatestCodexRolloutRateLimits(profile.home);
    }

    const rl = rawData?.rateLimits || null;
    const planLabel = formatPlanLabel(rl?.planType || rl?.plan_type || matchedAcct?.plan_type)
      || (profile.endpointHost && profile.endpointLabel !== "官方" ? profile.endpointLabel : "");

    if (!rl) {
      if (profile.endpointHost && profile.endpointLabel !== "官方") {
        return {
          ...base,
          planLabel: planLabel || "三方端点",
          accountLabel: profile.endpointHost,
          statusTone: "unknown",
          summaryText: profile.endpointHost,
          source: "endpoint",
        };
      }
      return {
        ...base,
        planLabel,
        accountLabel: profile.account?.email || base.accountLabel,
      };
    }

    const buckets = [
      formatCodexBucket("primary", rl.primary, "主限额", ctx.nowSec),
      formatCodexBucket("secondary", rl.secondary, "次限额", ctx.nowSec),
    ].filter(Boolean);

    const byLimit = rawData?.rateLimitsByLimitId || rl?.rateLimitsByLimitId || rl?.rate_limits_by_limit_id || null;
    if (
      byLimit
      && typeof byLimit === "object"
      && (!buckets.some((b) => b.windowKind === "five_hour") || !buckets.some((b) => b.windowKind === "weekly"))
    ) {
      for (const [limitId, limitEntry] of Object.entries(byLimit)) {
        if (!limitEntry || typeof limitEntry !== "object") continue;
        for (const [slotKey, slotRaw, slotFallback] of [
          ["primary", limitEntry.primary, "主限额"],
          ["secondary", limitEntry.secondary, "次限额"],
        ]) {
          const extra = formatCodexBucket(`${limitId}:${slotKey}`, slotRaw, slotFallback, ctx.nowSec);
          if (!extra) continue;
          const dup = buckets.some((b) => b.id === extra.id || (extra.windowKind && b.windowKind === extra.windowKind));
          if (!dup) buckets.push(extra);
        }
      }
    }

    const primary = pickLowestRemainingBucket(buckets);
    const fallbackByLimitCredits = byLimit && typeof byLimit === "object"
      ? Object.values(byLimit).find((entry) => entry?.credits)?.credits
      : null;
    const credits = formatCodexCredits(rl.credits || fallbackByLimitCredits);
    const statusTone = statusToneFromPercent(primary?.remainingPercent);
    const summaryText = primary?.remainingPercent !== null && primary?.remainingPercent !== undefined
      ? (primary.remainingPercent <= 0 ? "耗尽" : `余 ${primary.remainingPercent}%`)
      : (credits?.label || "");

    return {
      ...base,
      planLabel,
      accountLabel: profile.account?.email || base.accountLabel,
      statusTone,
      primary,
      buckets,
      windows: buildQuotaWindows(buckets),
      credits,
      summaryText,
      updatedAt: rawData?.updatedAt || ctx.nowSec,
      source: rawData?.source || "rollout-jsonl",
    };
  }

  async #readGrok7dUsage(grokHome, nowMs) {
    const sessionsRoot = join(grokHome, "sessions");
    const cwdDirs = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
    const usageFiles = [];
    for (const cwdDir of cwdDirs) {
      if (!cwdDir.isDirectory()) continue;
      const cwdPath = join(sessionsRoot, cwdDir.name);
      const sessDirs = await readdir(cwdPath, { withFileTypes: true }).catch(() => []);
      for (const sDir of sessDirs) {
        if (!sDir.isDirectory()) continue;
        const upath = join(cwdPath, sDir.name, "usage.json");
        const st = await stat(upath).catch(() => null);
        if (st?.isFile() && (nowMs - st.mtimeMs) <= SEVEN_DAYS_MS) {
          usageFiles.push({ path: upath, mtimeMs: st.mtimeMs });
        }
      }
    }
    usageFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
    let totalTokens = 0;
    let totalCostUsd = 0;
    let sessionCount = 0;
    for (const item of usageFiles.slice(0, MAX_GROK_USAGE_FILES)) {
      const parsed = await readJsonSafe(item.path);
      const sess = parsed?.session;
      if (!sess || typeof sess !== "object") continue;
      sessionCount += 1;
      totalTokens += Number(sess.totalTokens || 0);
      totalCostUsd += Number(sess.costUsdTicks || 0) / 1e10;
    }
    return { sessionCount, totalTokens, totalCostUsd };
  }

  async #collectGrok(profile, base, ctx) {
    if (profile.authenticated === false) {
      return {
        ...base,
        available: false,
        planLabel: "未登录",
        accountLabel: profile.account?.label || "本地历史",
        statusTone: "unknown",
        primary: {
          id: "auth",
          label: "登录状态",
          remainingPercent: null,
          usedPercent: null,
          resetsAt: null,
          detail: "未登录 · 仅看历史",
        },
        buckets: [],
        credits: null,
        summaryText: "仅历史",
        updatedAt: ctx.nowSec,
        source: "auth-check",
      };
    }

    if (ctx.grokBillingCache === undefined) {
      ctx.grokBillingCache = await readJsonSafe(join(this.#grokAppDir, "account_billing_cache.json"));
    }
    const billing = ctx.grokBillingCache;
    const email = String(profile.account?.email || "").trim().toLowerCase();
    const matchedAcct = (email
      ? ctx.grokAccounts.find((a) => String(a.email || "").trim().toLowerCase() === email)
      : null) || ctx.grokAccounts[0];
    const usage7d = profile.home
      ? await this.#readGrok7dUsage(profile.home, ctx.nowMs)
      : { sessionCount: 0, totalTokens: 0, totalCostUsd: 0 };

    const planLabel = formatPlanLabel(billing?.subscriptionTier || matchedAcct?.plan_type || profile.account?.planType) || "已登录";
    const usageNote = usage7d.sessionCount > 0
      ? `7天${usage7d.sessionCount}次 · $${usage7d.totalCostUsd.toFixed(2)}`
      : "";

    const grok7dBucket = usage7d.totalTokens > 0
      ? {
          id: "grok-7d",
          windowKind: "weekly_usage",
          label: "近7d 用量",
          remainingPercent: null,
          usedPercent: null,
          resetsAt: null,
          detail: `${usage7d.sessionCount}会话 · ${Math.round(usage7d.totalTokens / 1000)}k tok`,
        }
      : null;

    if (!billing || billing.available === false) {
      const fallbackBuckets = grok7dBucket ? [grok7dBucket] : [];
      return {
        ...base,
        planLabel,
        accountLabel: profile.account?.email || matchedAcct?.email || base.accountLabel,
        statusTone: "ok",
        primary: {
          id: "usage-7d",
          windowKind: "weekly_usage",
          label: "近7天消耗",
          remainingPercent: null,
          usedPercent: null,
          resetsAt: null,
          detail: usageNote || "已登录",
        },
        buckets: fallbackBuckets,
        windows: buildQuotaWindows(fallbackBuckets),
        summaryText: usage7d.totalCostUsd > 0 ? `$${usage7d.totalCostUsd.toFixed(2)}` : "正常",
        source: usage7d.sessionCount > 0 ? "usage-json" : "account",
      };
    }

    const remainingPercent = clampPercent(
      billing.remainingPercent ?? (typeof billing.creditUsagePercent === "number" ? 100 - billing.creditUsagePercent : null),
    );
    const usedPercent = remainingPercent !== null ? 100 - remainingPercent : clampPercent(billing.creditUsagePercent);
    const resetsAt = toTimestampSec(billing.resetsAt, null);
    const staleBilling = Boolean(resetsAt !== null && resetsAt <= ctx.nowSec);

    const primaryDetailParts = [];
    if (staleBilling) primaryDetailParts.push("缓存待桌面端刷新");
    if (usageNote) primaryDetailParts.push(usageNote);

    const primary = {
      id: "grok-billing",
      windowKind: "billing",
      label: "订阅额度",
      remainingPercent,
      usedPercent,
      resetsAt: staleBilling ? null : resetsAt,
      detail: primaryDetailParts.join(" · "),
    };

    const productBuckets = [];
    for (const prod of Array.isArray(billing.products) ? billing.products : []) {
      const used = clampPercent(prod?.usedPercent);
      if (used === null) continue;
      const prodLabel = String(prod.label || `Product ${prod.productId}`);
      const isBuild = prodLabel.toLowerCase().includes("build") || Number(prod.productId) === 2;
      productBuckets.push({
        id: `product-${prod.productId ?? prod.label}`,
        windowKind: isBuild ? "build" : "product",
        label: prodLabel,
        remainingPercent: Math.max(0, 100 - used),
        usedPercent: used,
        resetsAt: null,
        detail: `已用 ${used}%`,
      });
    }

    const buckets = [primary, ...productBuckets, ...(grok7dBucket ? [grok7dBucket] : [])];
    const statusTone = statusToneFromPercent(remainingPercent);
    const summaryText = remainingPercent !== null
      ? (remainingPercent <= 0 ? "耗尽" : `余 ${remainingPercent}%`)
      : "正常";

    return {
      ...base,
      planLabel,
      accountLabel: profile.account?.email || matchedAcct?.email || base.accountLabel,
      statusTone,
      primary,
      buckets,
      windows: buildQuotaWindows(buckets),
      summaryText,
      updatedAt: toTimestampSec(billing.fetchedAt, ctx.nowSec) || ctx.nowSec,
      source: "grok-billing-cache",
    };
  }

  async #scanClaudeRecentTelemetry(
    claudeHome,
    nowMs,
    { allowedSessionIds = null, excludedSessionIds = null, allowUnscoped = true } = {},
  ) {
    const projectsDir = join(claudeHome, "projects");
    const hasAllowList = Boolean(allowedSessionIds && allowedSessionIds.size > 0);
    let files = [];
    const fileSessionId = (filePath) => {
      const base = basename(filePath, ".jsonl");
      const parent = dirname(filePath);
      if (basename(parent) === "subagents") {
        return basename(dirname(parent));
      }
      return base;
    };
    if (allowUnscoped || hasAllowList) {
      files = await collectFilesRecursive(projectsDir, { maxDepth: 2, ext: ".jsonl" });
      if (hasAllowList) {
        files = files.filter((f) => allowedSessionIds.has(fileSessionId(f.path)));
      } else if (excludedSessionIds && excludedSessionIds.size > 0) {
        files = files.filter((f) => !excludedSessionIds.has(fileSessionId(f.path)));
      }
    }
    const recent = files
      .filter((f) => (nowMs - f.mtimeMs) <= CLAUDE_LOOKBACK_MS)
      .sort((a, b) => b.mtimeMs - a.mtimeMs)
      .slice(0, MAX_CLAUDE_FILES);

    let latestFiveHour = null;
    let latestFiveHourTsMs = -1;
    let latestSevenDay = null;
    let latestSevenDayTsMs = -1;
    let recent5hMsgs = 0;
    let recent5hTokens = 0;
    let recent7dMsgs = 0;
    let recent7dTokens = 0;

    for (const file of recent) {
      const tail = await readTailText(file.path);
      if (!tail) continue;
      const lines = tail.split("\n").filter(Boolean);
      for (const line of lines) {
        let obj;
        try {
          obj = JSON.parse(line);
        } catch {
          continue;
        }
        const tsMs = Date.parse(obj?.timestamp || "") || file.mtimeMs;
        if (obj?.type === "assistant") {
          const outTokens = Number(obj?.message?.usage?.output_tokens || 0) || 0;
          if ((nowMs - tsMs) <= SEVEN_DAYS_MS) {
            recent7dMsgs += 1;
            recent7dTokens += outTokens;
          }
          if ((nowMs - tsMs) <= FIVE_HOURS_MS) {
            recent5hMsgs += 1;
            recent5hTokens += outTokens;
          }
        }
        const hasRateSignal = Boolean(
          obj?.quotaLimits
          || obj?.rate_limit_event
          || obj?.rate_limit_info
          || obj?.apiErrorParams?.rate_limit_info
          || obj?.type === "rate_limit_event",
        );
        if (hasRateSignal) {
          const extracted = extractClaudeRateLimitWindows(obj);
          if (extracted.fiveHour && tsMs >= latestFiveHourTsMs) {
            latestFiveHour = extracted.fiveHour;
            latestFiveHourTsMs = tsMs;
          }
          if (extracted.sevenDay && tsMs >= latestSevenDayTsMs) {
            latestSevenDay = extracted.sevenDay;
            latestSevenDayTsMs = tsMs;
          }
        }
      }
    }

    return {
      latestFiveHour,
      latestFiveHourTsMs,
      latestSevenDay,
      latestSevenDayTsMs,
      recent5hMsgs,
      recent5hTokens,
      recent7dMsgs,
      recent7dTokens,
    };
  }

  #buildClaudeWindowBucket({
    id,
    windowKind,
    label,
    ql,
    msgCount,
    tokCount,
    fallbackDetail,
    nowSec,
  }) {
    const tag = windowKind === "weekly" ? "近7d" : "近5h";
    const usageSuffix = tokCount >= 1000 ? ` · ${Math.round(tokCount / 1000)}k` : "";
    const activeDetail = msgCount > 0 ? `${tag} ${msgCount}条${usageSuffix}` : "限流中";
    if (ql && typeof ql === "object") {
      const resetsAt = toTimestampSec(ql.resetsAt, null);
      const activeWindow = resetsAt === null || resetsAt > nowSec;
      if (ql.status === "rejected" && resetsAt !== null && resetsAt > nowSec) {
        return {
          id,
          windowKind,
          label,
          remainingPercent: 0,
          usedPercent: 100,
          resetsAt,
          detail: activeDetail,
        };
      }
      const rawRemPct = ql.remainingPercent ?? (typeof ql.utilization === "number" ? (1 - ql.utilization) * 100 : null);
      if (rawRemPct !== null && activeWindow) {
        const remainingPercent = clampPercent(rawRemPct);
        return {
          id,
          windowKind,
          label,
          remainingPercent,
          usedPercent: remainingPercent !== null ? 100 - remainingPercent : null,
          resetsAt,
          detail: msgCount > 0 ? `${tag} ${msgCount}条${usageSuffix}` : "",
        };
      }
    }
    return {
      id,
      windowKind,
      label,
      remainingPercent: null,
      usedPercent: null,
      resetsAt: null,
      detail: fallbackDetail,
    };
  }

  async #readClaudePlanUsageSample(profile, targetOrgUuid, { allowUnscoped = true } = {}) {
    const cleanOrg = String(targetOrgUuid || "").trim();
    if (!cleanOrg && !allowUnscoped) return null;

    const candidates = new Set();
    if (profile?.desktopUserDataDir) {
      candidates.add(join(profile.desktopUserDataDir, "plan-usage-history.json"));
    }
    const defaultDesktopDir = defaultClaudeDesktopUserDataDir({ env: this.#env, home: this.#homeDir });
    if (defaultDesktopDir) {
      candidates.add(join(defaultDesktopDir, "plan-usage-history.json"));
    }
    const cockpitClaudeDir = join(this.#homeDir, ".cockpit_tools", "instances", "claude");
    const cockpitDirs = await readdir(cockpitClaudeDir, { withFileTypes: true }).catch(() => []);
    for (const entry of cockpitDirs) {
      if (!entry.isDirectory()) continue;
      candidates.add(join(cockpitClaudeDir, entry.name, "plan-usage-history.json"));
    }

    let bestByOrg = null;
    let bestFallback = null;
    for (const filePath of candidates) {
      const doc = await readJsonSafe(filePath);
      const samples = Array.isArray(doc?.samples) ? doc.samples : [];
      const isOwnDir = Boolean(profile?.desktopUserDataDir)
        && resolve(filePath) === resolve(join(profile.desktopUserDataDir, "plan-usage-history.json"));
      for (const s of samples) {
        const tMs = Number(s?.t);
        if (!Number.isFinite(tMs) || tMs <= 0) continue;
        const org = String(s?.org || "").trim();
        const u = s?.u;
        if (!u || typeof u !== "object") continue;
        const fhRaw = u.fh ?? u.five_hour ?? u.fiveHour;
        const sdRaw = u.sd ?? u.seven_day ?? u.sevenDay;
        const fiveHourUsedPct = fhRaw !== null && fhRaw !== undefined ? clampPercent(fhRaw) : null;
        const sevenDayUsedPct = sdRaw !== null && sdRaw !== undefined ? clampPercent(sdRaw) : null;
        if (fiveHourUsedPct === null && sevenDayUsedPct === null) continue;

        const entry = { tMs, org, fiveHourUsedPct, sevenDayUsedPct };
        if (cleanOrg) {
          if (org === cleanOrg && (!bestByOrg || tMs > bestByOrg.tMs)) {
            bestByOrg = entry;
          }
        } else if (isOwnDir || allowUnscoped) {
          if (!bestFallback || tMs > bestFallback.tMs) {
            bestFallback = entry;
          }
        }
      }
    }
    return bestByOrg || bestFallback;
  }

  #mergeClaudeWindow({
    id,
    windowKind,
    label,
    ql,
    qlTsMs = -1,
    desktopError = null,
    planUsedPct = null,
    planSampleTsMs = -1,
    windowMs = FIVE_HOURS_MS,
    msgCount = 0,
    tokCount = 0,
    fallbackDetail = "未限流",
    nowSec,
    nowMs,
  }) {
    const desktopActive = Boolean(desktopError && (!desktopError.resetsAt || desktopError.resetsAt > nowSec));
    const desktopTsMs = desktopError?.tsMs || -1;

    let chosenQl = ql || null;
    let chosenTsMs = qlTsMs;
    if (desktopActive && (!ql || ql.status !== "rejected" || toTimestampSec(ql.resetsAt, 0) <= nowSec || desktopTsMs >= qlTsMs)) {
      chosenQl = {
        status: "rejected",
        rateLimitType: id,
        resetsAt: desktopError.resetsAt ?? toTimestampSec(ql?.resetsAt, null),
      };
      chosenTsMs = desktopTsMs;
    }

    const eventBucket = this.#buildClaudeWindowBucket({
      id,
      windowKind,
      label,
      ql: chosenQl,
      msgCount,
      tokCount,
      fallbackDetail,
      nowSec,
    });

    const activeResetSec = (eventBucket.resetsAt && eventBucket.resetsAt > nowSec)
      ? eventBucket.resetsAt
      : (desktopError?.resetsAt && desktopError.resetsAt > nowSec ? desktopError.resetsAt : null);

    if (eventBucket.remainingPercent === 0) {
      return {
        bucket: { ...eventBucket, resetsAt: activeResetSec ?? eventBucket.resetsAt },
        usedPlanSample: false,
      };
    }

    const knownResetSec = Math.max(
      toTimestampSec(ql?.resetsAt, 0) || 0,
      desktopError?.resetsAt || 0,
    );
    const planSec = Number.isFinite(planSampleTsMs) && planSampleTsMs > 0 ? Math.floor(planSampleTsMs / 1000) : 0;
    const planRolledOverByReset = knownResetSec > planSec && knownResetSec <= nowSec;
    const planUnconfirmedExhausted = id === "five_hour" && planUsedPct === 100 && !activeResetSec;
    let effectivePlanWindowMs = windowMs;
    if (id === "seven_day") {
      effectivePlanWindowMs = Math.min(effectivePlanWindowMs, CLAUDE_PLAN_WEEKLY_MAX_AGE_MS);
    }
    if (planUnconfirmedExhausted) {
      effectivePlanWindowMs = Math.min(effectivePlanWindowMs, 15 * 60_000);
    }
    const planFresh = planUsedPct !== null
      && Number.isFinite(planSampleTsMs)
      && planSampleTsMs > 0
      && (nowMs - planSampleTsMs) <= effectivePlanWindowMs
      && !planRolledOverByReset;

    if (planFresh && (eventBucket.remainingPercent === null || planSampleTsMs >= chosenTsMs)) {
      const remainingPercent = clampPercent(100 - planUsedPct);
      const tag = windowKind === "weekly" ? "近7d" : "近5h";
      const usageSuffix = tokCount >= 1000 ? ` · ${Math.round(tokCount / 1000)}k` : "";
      const ageMs = nowMs - planSampleTsMs;
      const staleNote = ageMs >= CLAUDE_PLAN_STALE_DETAIL_AGE_MS
        ? `缓存${Math.max(2, Math.round(ageMs / 3600_000))}h前`
        : "";
      const baseDetail = msgCount > 0
        ? `${tag} ${msgCount}条${usageSuffix}`
        : (remainingPercent === 0 ? "限流中" : "");
      const detail = [baseDetail, staleNote].filter(Boolean).join(" · ");
      return {
        bucket: {
          id,
          windowKind,
          label,
          remainingPercent,
          usedPercent: remainingPercent !== null ? 100 - remainingPercent : null,
          resetsAt: activeResetSec,
          detail,
        },
        usedPlanSample: true,
      };
    }

    return {
      bucket: eventBucket,
      usedPlanSample: false,
    };
  }

  async #collectClaude(profile, base, ctx) {
    const cliConfigDir = profile.cliConfigDir || profile.home;
    const historyDir = profile.historyDir || profile.home || cliConfigDir;
    const defaultCliHome = resolve(String(this.#env.CLAUDE_CONFIG_DIR || "").trim() || join(this.#homeDir, ".claude"));
    const allowHomeFallback = !profile.managed && !profile.isDesktopInstance && (profile.id === "default" || resolve(cliConfigDir) === defaultCliHome);
    const claudeJson = (await readJsonSafe(join(cliConfigDir, ".claude.json")))
      || (historyDir !== cliConfigDir ? await readJsonSafe(join(historyDir, ".claude.json")) : null)
      || (allowHomeFallback ? await readJsonSafe(join(this.#homeDir, ".claude.json")) : null);
    const settingsJson = profile.isDesktopInstance
      ? null
      : ((await readJsonSafe(join(cliConfigDir, "settings.json")))
        || (await readJsonSafe(join(cliConfigDir, "settings.local.json"))));

    const baseUrl = String(settingsJson?.env?.ANTHROPIC_BASE_URL || "").trim();
    let gatewayHost = "";
    if (baseUrl) {
      try {
        const host = new URL(baseUrl).host;
        if (host && host.toLowerCase() !== "api.anthropic.com") gatewayHost = host;
      } catch {
        // Ignore invalid URL.
      }
    }

    const oauthAcct = claudeJson?.oauthAccount || null;
    const boundEmail = String(profile.cockpitAccount?.email || profile.account?.email || "").trim();
    const oauthMatches = Boolean(
      oauthAcct
      && (!boundEmail || String(oauthAcct.emailAddress || "").trim().toLowerCase() === boundEmail.toLowerCase()),
    );
    const email = boundEmail || String(oauthMatches ? (oauthAcct?.emailAddress || "") : "").trim();
    const accountUuid = String(
      profile.cockpitAccount?.accountUuid
      || profile.account?.accountUuid
      || (oauthMatches ? oauthAcct?.accountUuid : "")
      || "",
    ).trim();
    const orgUuid = String(
      profile.cockpitAccount?.organizationUuid
      || profile.account?.organizationUuid
      || (oauthMatches ? oauthAcct?.organizationUuid : "")
      || "",
    ).trim();

    const matchedAccts = email
      ? ctx.claudeAccounts.filter((a) => String(a.email || "").trim().toLowerCase() === email.toLowerCase())
      : [];
    const tierOrder = { max: 5, enterprise: 4, team: 4, pro: 3, gateway: 2, free: 1 };
    matchedAccts.sort((a, b) => (tierOrder[String(b.plan_type || "").toLowerCase()] ?? -1) - (tierOrder[String(a.plan_type || "").toLowerCase()] ?? -1));

    const rawPlanType = (oauthMatches ? oauthAcct?.organizationType : "")
      || profile.cockpitAccount?.planType
      || profile.account?.planType
      || matchedAccts[0]?.plan_type
      || "";
    const planLabel = gatewayHost
      ? "API Gateway"
      : (formatPlanLabel(rawPlanType) || "Pro");

    const profileKey = profile.key || formatProfileKey(profile.provider, profile.id);
    let desktopMeta = ctx.claudeMetaByKey?.get(profileKey) || { claimedIds: new Set(), errorEntries: [] };
    if (!desktopMeta.claimedIds.size && !desktopMeta.errorEntries.length && accountUuid) {
      desktopMeta = await readClaudeDesktopSessionsMeta(profile, { accountUuid, orgUuid });
      if (!desktopMeta.claimedIds.size && !desktopMeta.errorEntries.length && profile.id === "default") {
        const defaultDesktop = defaultClaudeDesktopUserDataDir({ env: this.#env, home: this.#homeDir });
        if (defaultDesktop && defaultDesktop !== profile.desktopUserDataDir) {
          desktopMeta = await readClaudeDesktopSessionsMeta(
            { ...profile, desktopUserDataDir: defaultDesktop },
            { accountUuid, orgUuid },
          );
        }
      }
    }

    const cliKey = resolve(String(historyDir || cliConfigDir || ""));
    const excludedSessionIds = !profile.isDesktopInstance
      ? (ctx.desktopClaimedByCliDir?.get(cliKey) || null)
      : null;
    const telemetry = await this.#scanClaudeRecentTelemetry(historyDir, ctx.nowMs, {
      allowedSessionIds: profile.isDesktopInstance ? desktopMeta.claimedIds : null,
      excludedSessionIds,
      allowUnscoped: !profile.isDesktopInstance,
    });

    if (gatewayHost) {
      const primary = {
        id: "gateway",
        windowKind: "gateway",
        label: "网关端点",
        remainingPercent: null,
        usedPercent: null,
        resetsAt: null,
        detail: gatewayHost,
      };
      return {
        ...base,
        planLabel,
        accountLabel: gatewayHost,
        statusTone: "ok",
        primary,
        buckets: [primary],
        windows: buildQuotaWindows([primary]),
        summaryText: "Gateway",
        updatedAt: ctx.nowSec,
        source: "settings-gateway",
      };
    }

    let desktop5hError = null;
    let desktop7dError = null;
    for (const entry of desktopMeta.errorEntries || []) {
      const msg = String(entry.error || "");
      const resetsAt = parseClaudeErrorResetSec(msg, entry.errorAtMs);
      if (/\b(weekly|7[\s-]*day)\b/i.test(msg)) {
        if (!desktop7dError) {
          desktop7dError = { status: "rejected", rateLimitType: "seven_day", resetsAt, tsMs: entry.errorAtMs };
        }
      } else if (/\b5[\s-]*hour\b/i.test(msg) || /limit/i.test(msg)) {
        if (!desktop5hError) {
          desktop5hError = { status: "rejected", rateLimitType: "five_hour", resetsAt, tsMs: entry.errorAtMs };
        }
      }
    }

    const cliRateLimit = this.#claudeQuotaReader
      ? await this.#claudeQuotaReader(profile, { refresh: ctx.refresh }).catch(() => null)
      : null;
    const cliWindows = extractClaudeRateLimitWindows(cliRateLimit);
    const cliBaseTsMs = Number(cliRateLimit?.updatedAtMs)
      || (Number(cliRateLimit?.updatedAt) > 0 ? Number(cliRateLimit.updatedAt) * 1000 : -1);
    const cli5hTsMs = Number(cliWindows.fiveHour?.observedAtMs) || (cliWindows.fiveHour ? cliBaseTsMs : -1);
    const cli7dTsMs = Number(cliWindows.sevenDay?.observedAtMs) || (cliWindows.sevenDay ? cliBaseTsMs : -1);

    const hasNumericPct = (win) => Boolean(
      win && typeof win === "object"
      && (typeof win.utilization === "number" || typeof win.remainingPercent === "number"),
    );
    const pickClaudeSource = (telQl, telTsMs, cliQl, cliTsMs) => {
      if (cliQl && (!telQl || cliTsMs > telTsMs || (cliTsMs === telTsMs && (hasNumericPct(cliQl) || !hasNumericPct(telQl))))) {
        return { ql: cliQl, tsMs: cliTsMs, from: "cli" };
      }
      if (telQl) {
        return { ql: telQl, tsMs: telTsMs, from: "telemetry" };
      }
      return { ql: null, tsMs: -1, from: "none" };
    };

    const picked5h = pickClaudeSource(telemetry.latestFiveHour, telemetry.latestFiveHourTsMs, cliWindows.fiveHour, cli5hTsMs);
    const picked7d = pickClaudeSource(telemetry.latestSevenDay, telemetry.latestSevenDayTsMs, cliWindows.sevenDay, cli7dTsMs);

    const planSample = await this.#readClaudePlanUsageSample(profile, orgUuid, {
      allowUnscoped: (ctx.claudeProfileCount || 1) <= 1,
    });

    const merged5h = this.#mergeClaudeWindow({
      id: "five_hour",
      windowKind: "five_hour",
      label: "5h 窗口",
      ql: picked5h.ql,
      qlTsMs: picked5h.tsMs,
      desktopError: desktop5hError,
      planUsedPct: planSample?.fiveHourUsedPct ?? null,
      planSampleTsMs: planSample?.tMs ?? -1,
      windowMs: FIVE_HOURS_MS,
      msgCount: telemetry.recent5hMsgs,
      tokCount: telemetry.recent5hTokens,
      fallbackDetail: telemetry.recent5hMsgs > 0 ? `近5h ${telemetry.recent5hMsgs}条` : "未限流",
      nowSec: ctx.nowSec,
      nowMs: ctx.nowMs,
    });

    const merged7d = this.#mergeClaudeWindow({
      id: "seven_day",
      windowKind: "weekly",
      label: "周限额",
      ql: picked7d.ql,
      qlTsMs: picked7d.tsMs,
      desktopError: desktop7dError,
      planUsedPct: planSample?.sevenDayUsedPct ?? null,
      planSampleTsMs: planSample?.tMs ?? -1,
      windowMs: SEVEN_DAYS_MS,
      msgCount: telemetry.recent7dMsgs,
      tokCount: telemetry.recent7dTokens,
      fallbackDetail: telemetry.recent7dMsgs > 0 ? `近7d ${telemetry.recent7dMsgs}条` : "未限流",
      nowSec: ctx.nowSec,
      nowMs: ctx.nowMs,
    });

    const fiveHourBucket = merged5h.bucket;
    const weeklyBucket = merged7d.bucket;
    const buckets = [fiveHourBucket, weeklyBucket];
    const windows = buildQuotaWindows(buckets);
    const lowest = pickLowestRemainingBucket(buckets);
    let primary = fiveHourBucket;
    let statusTone = "ok";
    let summaryText = "5h 正常";

    if (fiveHourBucket.remainingPercent === 0) {
      primary = fiveHourBucket;
      statusTone = "exhausted";
      summaryText = "5h 耗尽";
    } else if (weeklyBucket.remainingPercent === 0) {
      primary = weeklyBucket;
      statusTone = "exhausted";
      summaryText = "周耗尽";
    } else if (typeof lowest?.remainingPercent === "number") {
      primary = lowest;
      statusTone = statusToneFromPercent(lowest.remainingPercent);
      summaryText = `余 ${lowest.remainingPercent}%`;
    }

    const latestTs = Math.max(
      telemetry.latestFiveHourTsMs,
      telemetry.latestSevenDayTsMs,
      cli5hTsMs,
      cli7dTsMs,
      desktop5hError?.tsMs || -1,
      desktop7dError?.tsMs || -1,
      planSample?.tMs || -1,
    );
    const usedCliStream = (
      (picked5h.from === "cli" && fiveHourBucket.remainingPercent !== null && !merged5h.usedPlanSample)
      || (picked7d.from === "cli" && weeklyBucket.remainingPercent !== null && !merged7d.usedPlanSample)
    );
    let source = "claude-jsonl";
    if (usedCliStream) {
      source = (merged5h.usedPlanSample || merged7d.usedPlanSample || desktop5hError || desktop7dError)
        ? "claude-cli-stream+cockpit"
        : "claude-cli-stream";
    } else if (merged5h.usedPlanSample || merged7d.usedPlanSample) {
      source = (telemetry.latestFiveHour || telemetry.latestSevenDay) ? "claude-jsonl+cockpit" : "cockpit-usage-history";
    } else if (desktop5hError || desktop7dError) {
      source = "claude-desktop+jsonl";
    }
    return {
      ...base,
      planLabel,
      accountLabel: email || base.accountLabel,
      statusTone,
      primary,
      buckets,
      windows,
      summaryText,
      updatedAt: latestTs > 0 ? Math.floor(latestTs / 1000) : ctx.nowSec,
      source,
    };
  }
}
