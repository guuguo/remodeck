import { iconSvg, providerIconSvg } from "./icons.js?v=20261117qoder";

export const PROVIDER_META = Object.freeze({
  all: { id: "all", label: "全部", short: "全部" },
  codex: { id: "codex", label: "Codex", short: "Codex" },
  claude: { id: "claude", label: "Claude Code", short: "Claude" },
  antigravity: { id: "antigravity", label: "Antigravity", short: "Agy" },
  grok: { id: "grok", label: "Grok", short: "Grok" },
  qoder: { id: "qoder", label: "Qoder", short: "Qoder" },
});

export const UI_PERMISSION_MODES = Object.freeze([
  { value: "turbo", label: "Turbo（自动批准）" },
  { value: "workspace", label: "工作区读写" },
  { value: "full", label: "自动安全命令 (Auto)" },
  { value: "safe", label: "只读 / 询问" },
  { value: "plan", label: "仅规划 (Plan)" },
]);

export const CLIENT_FALLBACK_MODELS = Object.freeze({
  qoder: Object.freeze(["auto", "lite", "performance"].map((id) => ({ id, model: id, displayName: { auto: "Auto", lite: "Lite", performance: "Performance" }[id],
    provider: "qoder", isDefault: id === "auto", defaultReasoningEffort: "medium", supportedReasoningEfforts: ["low", "medium", "high"] }))),
  antigravity: Object.freeze([
    {
      id: "gemini-pro-orchestrator",
      model: "gemini-pro-orchestrator",
      displayName: "Orchestrator (Carbon)",
      provider: "antigravity",
      isDefault: true,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: [],
    },
    {
      id: "gemini-4-carbon",
      model: "gemini-4-carbon",
      displayName: "Gemini 4 Carbon",
      provider: "antigravity",
      isDefault: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
    {
      id: "gemini-4-argon",
      model: "gemini-4-argon",
      displayName: "Gemini 4 Argon",
      provider: "antigravity",
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
    {
      id: "gemini-4-hydrogen",
      model: "gemini-4-hydrogen",
      displayName: "Gemini 4 Hydrogen",
      provider: "antigravity",
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    },
    {
      id: "claude-opus-5-5",
      model: "claude-opus-5-5",
      displayName: "Claude Opus 5.5",
      provider: "antigravity",
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
    {
      id: "claude-sonnet-4-6",
      model: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      provider: "antigravity",
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
  ]),
  codex: Object.freeze([
    {
      id: "gpt-6.2-sol",
      model: "gpt-6.2-sol",
      displayName: "GPT-6.2-Sol",
      provider: "codex",
      isDefault: false,
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    },
    {
      id: "gpt-6.2-astra",
      model: "gpt-6.2-astra",
      displayName: "GPT-6.2-Astra",
      provider: "codex",
      isDefault: false,
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
    },
    {
      id: "gpt-6.1-terra",
      model: "gpt-6.1-terra",
      displayName: "GPT-6.1 Terra",
      provider: "codex",
      isDefault: false,
      defaultReasoningEffort: "low",
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
    {
      id: "gpt-5.4",
      model: "gpt-5.4",
      displayName: "GPT-5.4",
      provider: "codex",
      isDefault: true,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
    {
      id: "gpt-5.3-codex",
      model: "gpt-5.3-codex",
      displayName: "GPT-5.3 Codex",
      provider: "codex",
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
  ]),
  claude: Object.freeze([
    {
      id: "claude-opus-5-5",
      model: "claude-opus-5-5",
      displayName: "Claude Opus 5.5",
      section: "main",
      provider: "claude",
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "claude-sonnet-5-5",
      model: "claude-sonnet-5-5",
      displayName: "Claude Sonnet 5.5",
      section: "main",
      provider: "claude",
      isDefault: true,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "claude-fable-5-2",
      model: "claude-fable-5-2",
      displayName: "Claude Fable 5.2",
      section: "main",
      provider: "claude",
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "claude-haiku-5-5",
      model: "claude-haiku-5-5",
      displayName: "Claude Haiku 5.5",
      section: "main",
      provider: "claude",
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "claude-fable-5-1",
      model: "claude-fable-5-1",
      displayName: "Claude Fable 5.1",
      section: "overflow",
      provider: "claude",
      isDefault: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "claude-opus-4-8",
      model: "claude-opus-4-8",
      displayName: "Claude Opus 4.8",
      section: "overflow",
      provider: "claude",
      isDefault: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "claude-opus-4-7",
      model: "claude-opus-4-7",
      displayName: "Claude Opus 4.7",
      section: "overflow",
      provider: "claude",
      isDefault: false,
      defaultReasoningEffort: "xhigh",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    },
    {
      id: "claude-opus-4-6",
      model: "claude-opus-4-6",
      displayName: "Claude Opus 4.6",
      section: "overflow",
      provider: "claude",
      isDefault: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: ["low", "medium", "high", "max"],
    },
    {
      id: "claude-sonnet-4-6",
      model: "claude-sonnet-4-6",
      displayName: "Claude Sonnet 4.6",
      section: "overflow",
      provider: "claude",
      isDefault: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: ["low", "medium", "high", "max"],
    },
    {
      id: "claude-haiku-4-5",
      model: "claude-haiku-4-5",
      displayName: "Claude Haiku 4.5",
      section: "overflow",
      provider: "claude",
      isDefault: false,
      defaultReasoningEffort: "",
      supportedReasoningEfforts: [],
    },
  ]),
  grok: Object.freeze([
    {
      id: "grok-4.7",
      model: "grok-4.7",
      displayName: "Grok 4.7",
      provider: "grok",
      isDefault: true,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    },
    {
      id: "grok-4.7-build-fast",
      model: "grok-4.7-build-fast",
      displayName: "Grok 4.7 Fast",
      provider: "grok",
      isDefault: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    },
    {
      id: "grok-4.6",
      model: "grok-4.6",
      displayName: "Grok 4.6",
      provider: "grok",
      isDefault: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
    },
    {
      id: "grok-4.5",
      model: "grok-4.5",
      displayName: "Grok 4.5",
      provider: "grok",
      isDefault: false,
      defaultReasoningEffort: "high",
      supportedReasoningEfforts: ["low", "medium", "high"],
    },
  ]),
});

export function normalizeUiPermissionMode(mode, fallback = "turbo") {
  const clean = String(mode || "").trim().toLowerCase();
  if (UI_PERMISSION_MODES.some((item) => item.value === clean)) return clean;
  return fallback;
}

export function permissionModeDisplayLabel(mode) {
  const clean = normalizeUiPermissionMode(mode);
  return UI_PERMISSION_MODES.find((item) => item.value === clean)?.label || clean;
}

export function resolveModelsForProvider(modelsByProvider = {}, allModels = [], provider = "antigravity") {
  const direct = Array.isArray(modelsByProvider?.[provider]) ? modelsByProvider[provider] : [];
  if (direct.length) return direct;
  const filtered = (Array.isArray(allModels) ? allModels : []).filter((m) => m.provider === provider);
  if (filtered.length) return filtered;
  return [...(CLIENT_FALLBACK_MODELS[provider] || [])];
}

export function providerDisplayName(provider) {
  return PROVIDER_META[provider]?.label || provider || "Agent";
}

export function providerShortBadge(provider) {
  return PROVIDER_META[provider]?.short || provider || "Agent";
}

export function providerVisualMeta(provider = "antigravity") {
  switch (provider) {
    case "antigravity":
      return { id: "antigravity", label: "Antigravity", short: "Agy", glyph: "", iconSvg: providerIconSvg("antigravity", { size: 12 }), tone: "antigravity" };
    case "codex":
      return { id: "codex", label: "Codex", short: "Codex", glyph: "", iconSvg: providerIconSvg("codex", { size: 12 }), tone: "codex" };
    case "claude":
      return { id: "claude", label: "Claude Code", short: "Claude", glyph: "", iconSvg: providerIconSvg("claude", { size: 12 }), tone: "claude" };
    case "grok":
      return { id: "grok", label: "Grok", short: "Grok", glyph: "", iconSvg: providerIconSvg("grok", { size: 12 }), tone: "grok" };
    case "qoder":
      return { id: "qoder", label: "Qoder", short: "Qoder", glyph: "", iconSvg: providerIconSvg("qoder", { size: 12 }), tone: "qoder" };
    default:
      return {
        id: provider || "agent",
        label: providerDisplayName(provider),
        short: providerShortBadge(provider),
        glyph: "",
        iconSvg: providerIconSvg(provider || "default", { size: 12 }),
        tone: "default",
      };
  }
}

export function permissionVisualMeta(mode = "turbo") {
  const clean = normalizeUiPermissionMode(mode, "turbo");
  const label = permissionModeDisplayLabel(clean);
  switch (clean) {
    case "turbo":
      return { value: "turbo", iconName: "bolt", icon: iconSvg("bolt", { size: 12 }), shortLabel: "Turbo", tone: "turbo", label };
    case "full":
      return { value: "full", iconName: "rocket", icon: iconSvg("rocket", { size: 12 }), shortLabel: "Auto", tone: "auto", label };
    case "workspace":
      return { value: "workspace", iconName: "edit", icon: iconSvg("edit", { size: 12 }), shortLabel: "读写", tone: "workspace", label };
    case "safe":
      return { value: "safe", iconName: "shield", icon: iconSvg("shield", { size: 12 }), shortLabel: "询问", tone: "safe", label };
    case "plan":
      return { value: "plan", iconName: "compass", icon: iconSvg("compass", { size: 12 }), shortLabel: "规划", tone: "plan", label };
    default:
      return { value: clean, iconName: "bolt", icon: iconSvg("bolt", { size: 12 }), shortLabel: clean, tone: "turbo", label };
  }
}

export function resolveAntigravityModelSelection(modelId = "") {
  const clean = String(modelId || "").trim();
  const match = clean.match(/^(.+)-(low|medium|high|xhigh)$/i);
  if (!match) return { baseModel: clean, effort: "" };
  return { baseModel: match[1], effort: match[2].toLowerCase() };
}

export function compactModelBadgeLabel(rawModel = "") {
  const clean = String(rawModel || "").trim();
  if (!clean) return "默认";
  const lower = clean.toLowerCase();
  const effortSuffix = /\bxhigh\b/i.test(clean)
    ? " XH"
    : (/\bhigh\b/i.test(clean)
      ? " H"
      : (/\bmedium\b/i.test(clean)
        ? " M"
        : (/\blow\b/i.test(clean) ? " L" : "")));

  const orchMatch = clean.match(/^orchestrator\s*\(([^)]+)\)/i);
  if (orchMatch?.[1]) {
    const inner = orchMatch[1].trim();
    return inner.length > 18 ? inner.slice(0, 18) : inner;
  }
  const orchIdMatch = clean.match(/^gemini[- ]pro[- ]orchestrator(?:[- ]([a-z][a-z0-9]+))?(?:[- (]+(?:low|medium|high|xhigh)\)?)?$/i);
  if (orchIdMatch || lower === "orchestrator") {
    const rawCodename = orchIdMatch?.[1] && !/^(?:low|medium|high|xhigh)$/i.test(orchIdMatch[1])
      ? orchIdMatch[1]
      : "Carbon";
    const word = rawCodename.charAt(0).toUpperCase() + rawCodename.slice(1).toLowerCase();
    return `${word}${effortSuffix}`;
  }

  const geminiCodename = clean.match(/^gemini[- ]\d+(?:[.-]\d+)*[- ]([a-z][a-z0-9]+)(?:[- (]+(?:low|medium|high|xhigh)\)?)?$/i);
  if (geminiCodename?.[1] && !/^(?:pro|flash|lite|ultra|nano|exp|preview)$/i.test(geminiCodename[1])) {
    const word = geminiCodename[1].charAt(0).toUpperCase() + geminiCodename[1].slice(1).toLowerCase();
    return `${word}${effortSuffix}`;
  }
  const geminiVersioned = clean.match(/^gemini[- ](\d+(?:[.-]\d+)*)[- ](pro|flash|lite|ultra|nano)(?:[- ](lite|exp|preview))?(?:[- (]+(?:low|medium|high|xhigh)\)?)?$/i);
  if (geminiVersioned) {
    const ver = geminiVersioned[1].replace(/-/g, ".");
    const tier = geminiVersioned[2].charAt(0).toUpperCase() + geminiVersioned[2].slice(1).toLowerCase();
    const sub = geminiVersioned[3] ? ` ${geminiVersioned[3].charAt(0).toUpperCase() + geminiVersioned[3].slice(1).toLowerCase()}` : "";
    return `${ver} ${tier}${sub}${effortSuffix}`;
  }
  if (clean === "gemini-4-carbon-high" || /carbon.*\(high\)/i.test(clean) || /^gemini-.*carbon-high$/i.test(clean)) {
    return "Carbon H";
  }
  if (clean === "gemini-4-carbon-medium" || /carbon.*\(medium\)/i.test(clean) || /^gemini-.*carbon-medium$/i.test(clean)) {
    return "Carbon M";
  }
  if (clean === "gemini-4-carbon-low" || /carbon.*\(low\)/i.test(clean) || /^gemini-.*carbon-low$/i.test(clean)) {
    return "Carbon L";
  }
  if (lower.includes("argon")) {
    if (lower.includes("high")) return "Argon H";
    if (lower.includes("medium")) return "Argon M";
    if (lower.includes("low")) return "Argon L";
    return "Argon";
  }
  if (lower.includes("hydrogen")) {
    if (lower.includes("xhigh")) return "Hydrogen XH";
    if (lower.includes("high")) return "Hydrogen H";
    if (lower.includes("medium")) return "Hydrogen M";
    if (lower.includes("low")) return "Hydrogen L";
    return "Hydrogen";
  }
  if (lower.includes("opus")) {
    const ver = clean.match(/(\d+(?:[.-]\d+)?)/);
    return ver ? `Opus ${ver[1].replace(/-/g, ".")}` : "Opus";
  }
  if (lower.includes("sonnet")) {
    const ver = clean.match(/(\d+(?:[.-]\d+)?)/);
    return ver ? `Sonnet ${ver[1].replace(/-/g, ".")}` : "Sonnet";
  }
  if (lower.includes("fable")) {
    const ver = clean.match(/(\d+(?:[.-]\d+)?)/);
    return ver ? `Fable ${ver[1].replace(/-/g, ".")}` : "Fable";
  }
  if (lower.includes("haiku")) {
    const ver = clean.match(/(\d+(?:[.-]\d+)?)/);
    return ver ? `Haiku ${ver[1].replace(/-/g, ".")}` : "Haiku";
  }
  if (clean === "gpt-5.3-codex" || /5\.3.*codex/i.test(clean)) {
    return "5.3 Codex";
  }
  if (lower.includes("gpt-")) {
    const baseGpt = clean
      .replace(/^.*?(gpt-[0-9a-z.-]+).*$/i, "$1")
      .replace(/-(?:low|medium|high|xhigh)$/i, "")
      .toUpperCase();
    const withEffort = `${baseGpt}${effortSuffix}`;
    return withEffort.length > 20 ? withEffort.slice(0, 20) : withEffort;
  }
  if (lower.startsWith("grok-")) {
    if (lower.includes("4.7-build-fast") || lower.includes("4.7 fast")) return "Grok 4.7F";
    const ver = clean.match(/grok-(\d+(?:[.-]\d+)?)/i);
    return ver ? `Grok ${ver[1].replace(/-/g, ".")}` : clean.slice(0, 12);
  }
  const stripped = clean
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/^(Claude|Gemini)\s+/i, "")
    .trim();
  if (!stripped) return "默认";
  return stripped.length > 18 ? stripped.slice(0, 18) : stripped;
}

export function compactEffortBadgeLabel(effort = "") {
  const clean = String(effort || "").trim().toLowerCase();
  const map = { low: "L", medium: "M", high: "H", xhigh: "XH", max: "MAX" };
  return map[clean] || "";
}

function escapeAttrHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const TELEMETRY_PROVIDER_ORDER = ["codex", "claude", "antigravity", "grok", "qoder"];

export function formatTokensPerSec(value = 0) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return "0";
  if (num >= 100) return String(Math.round(num));
  return Number(num.toFixed(1)).toString();
}

function normalizeResetSec(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n > 1e12 ? Math.floor(n / 1000) : Math.floor(n);
}

function parseFinitePercent(raw) {
  if (raw === null || raw === undefined || raw === "") return null;
  const num = Number(raw);
  return Number.isFinite(num) ? Math.max(0, Math.min(100, Math.round(num))) : null;
}

function classifyTelemetryTone(remainingPercent, fallbackStatus = "ok") {
  if (Number.isFinite(remainingPercent)) {
    if (remainingPercent <= 5) return "danger";
    if (remainingPercent <= 25) return "warn";
    return "ok";
  }
  if (fallbackStatus === "exhausted" || fallbackStatus === "unavailable") return "danger";
  if (fallbackStatus === "low" || fallbackStatus === "warn") return "warn";
  return "ok";
}

function isSameQuotaBucket(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.id && b.id && String(a.id).toLowerCase() === String(b.id).toLowerCase()) return true;
  if (a.windowKind && b.windowKind && String(a.windowKind) === String(b.windowKind)) {
    const la = String(a.label || "").trim().toLowerCase();
    const lb = String(b.label || "").trim().toLowerCase();
    if (!la || !lb || la === lb) return true;
  }
  return false;
}

function classifyQuotaBucketSlot(bucket) {
  const kind = String(bucket?.windowKind || "");
  const id = String(bucket?.id || "").toLowerCase();
  const label = String(bucket?.label || "").toLowerCase();
  if (kind === "third_party_5h" || (id.includes("3p") && id.includes("5h"))) return "third_party_5h";
  if (kind === "third_party_weekly" || (id.includes("3p") && (id.includes("week") || id.includes("7d")))) return "third_party_weekly";
  if (kind === "five_hour" || id === "5h" || id.includes("5h") || id.includes("five_hour") || label.includes("5h")) return "five_hour";
  if (kind === "weekly" || id.includes("week") || id.includes("7d") || id.includes("seven_day") || label.includes("周") || label.includes("7天")) return "weekly";
  return "";
}

function resolveQuotaWindowsForUi(quota) {
  if (!quota || typeof quota !== "object") {
    return { fiveHour: null, weekly: null, thirdPartyFiveHour: null, thirdPartyWeekly: null, extraBuckets: [] };
  }
  const buckets = Array.isArray(quota.buckets) ? quota.buckets : [];
  const existing = quota.windows && typeof quota.windows === "object" ? quota.windows : {};
  let fiveHour = existing.fiveHour || null;
  let weekly = existing.weekly || null;
  let thirdPartyFiveHour = existing.thirdPartyFiveHour || null;
  let thirdPartyWeekly = existing.thirdPartyWeekly || null;
  const extraBuckets = [];
  const seenExtraKeys = new Set();

  for (const b of buckets) {
    if (!b || typeof b !== "object") continue;
    const slot = classifyQuotaBucketSlot(b);
    if (slot === "third_party_5h") {
      if (!thirdPartyFiveHour) thirdPartyFiveHour = b;
      continue;
    }
    if (slot === "third_party_weekly") {
      if (!thirdPartyWeekly) thirdPartyWeekly = b;
      continue;
    }
    if (slot === "five_hour") {
      if (!fiveHour) {
        fiveHour = b;
        continue;
      }
      if (isSameQuotaBucket(b, fiveHour)) continue;
    }
    if (slot === "weekly") {
      if (!weekly) {
        weekly = b;
        continue;
      }
      if (isSameQuotaBucket(b, weekly)) continue;
    }
    if (
      isSameQuotaBucket(b, fiveHour)
      || isSameQuotaBucket(b, weekly)
      || isSameQuotaBucket(b, thirdPartyFiveHour)
      || isSameQuotaBucket(b, thirdPartyWeekly)
    ) {
      continue;
    }
    const extraKey = `${String(b.id || "").toLowerCase()}::${String(b.label || "").toLowerCase()}`;
    if (seenExtraKeys.has(extraKey)) continue;
    seenExtraKeys.add(extraKey);
    extraBuckets.push(b);
  }
  return { fiveHour, weekly, thirdPartyFiveHour, thirdPartyWeekly, extraBuckets };
}

function selectRepresentativeProfilesForProvider(profiles = [], provider = "") {
  const scoped = filterProfilesByProvider(profiles, provider);
  if (!scoped.length) return [];
  const installed = scoped.filter((p) => p.installed !== false && !p.health?.disabled);
  const pool = installed.length ? installed : scoped;
  const nonEmptyPool = pool.filter((p) => !(
    p.authenticated === false
    || (provider === "grok" && p.id === "default" && (p.quota?.status === "unavailable" || p.quota?.statusTone === "unknown"))
  ));
  const activePool = nonEmptyPool.length ? nonEmptyPool : pool;

  const deduped = [];
  const seenAccounts = new Set();
  for (const p of activePool) {
    const accountKey = String(
      p.account?.email
      || p.quota?.accountLabel
      || p.endpointLabel
      || "",
    ).trim().toLowerCase();
    if (accountKey) {
      if (seenAccounts.has(accountKey)) continue;
      seenAccounts.add(accountKey);
    }
    deduped.push(p);
  }
  return deduped;
}

function compactBucketDetailText(detail = "") {
  const clean = String(detail || "").trim();
  if (!clean) return "";
  return clean.replace(/^近\s*/, "").replace(/\s+消息$/, "次").slice(0, 14);
}

function renderWindowChipHtml(tagLabel, bucket, { nowSec, fallbackStatus = "ok", showResetDate = false, displayValue = "" } = {}) {
  if (!bucket) return "";
  const pct = parseFinitePercent(bucket.remainingPercent);
  const tone = classifyTelemetryTone(pct, fallbackStatus);
  const resetSec = normalizeResetSec(bucket.resetsAt);
  const resetRel = resetSec ? formatQuotaResetRelative(resetSec, nowSec) : "";
  const resetText = resetSec ? (resetRel || "已到重置时间，待刷新") : "";
  const titleParts = [bucket.label || tagLabel];
  if (pct != null) titleParts.push(`剩余 ${pct}%`);
  if (bucket.detail) titleParts.push(String(bucket.detail));
  if (resetSec) {
    titleParts.push(resetText);
    titleParts.push(`重置时间：${new Intl.DateTimeFormat("zh-CN", {
      year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
      hour12: false, timeZoneName: "short",
    }).format(new Date(resetSec * 1000))}`);
  } else {
    titleParts.push("未提供重置时间");
  }

  const valueText = displayValue || (pct != null ? `${pct}%` : compactBucketDetailText(bucket.detail) || "正常");
  const showReset = showResetDate && Boolean(resetSec);

  return `<span class="telemetry-quota-chip${showReset ? " has-reset" : ""} is-${tone}" title="${escapeAttrHtml(titleParts.join(" · "))}">`
    + `<span class="telemetry-chip-k">${escapeAttrHtml(tagLabel)}</span>`
    + `<span class="telemetry-chip-v">${escapeAttrHtml(valueText)}</span>`
    + (showReset ? `<time class="telemetry-chip-reset" datetime="${new Date(resetSec * 1000).toISOString()}">${escapeAttrHtml(resetText)}</time>` : "")
    + `</span>`;
}

function compactCreditCount(raw) {
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return "";
  if (num >= 10000) return `${(num / 10000).toFixed(1)}w`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}k`;
  return String(Math.round(num));
}

function buildCompactQuotaChipsHtml(provider, repProfiles, nowSec, { showResetDates = false } = {}) {
  if (!repProfiles.length) {
    return {
      chipsHtml: `<span class="telemetry-quota-chip is-muted">未接入</span>`,
      meterPct: null,
      meterTone: "muted",
    };
  }

  const chips = [];
  const pctCandidates = [];
  let worstTone = "ok";
  const bumpTone = (tone) => {
    if (tone === "danger") worstTone = "danger";
    else if (tone === "warn" && worstTone !== "danger") worstTone = "warn";
  };

  if (repProfiles.length > 1) {
    for (const p of repProfiles.slice(0, 2)) {
      const q = p.quota;
      const qTone = q?.statusTone || q?.status || "ok";
      const win = resolveQuotaWindowsForUi(q);
      const shortName = String(q?.planLabel || "").trim()
        || String(p.health?.alias || p.label || p.id || "")
          .replace(/^(Codex|Claude|Antigravity|Grok)\s*[·-]?\s*/i, "")
          .trim()
          .slice(0, 8)
        || p.id;
      const parts = [];
      const pct5 = parseFinitePercent(win.fiveHour?.remainingPercent);
      if (pct5 != null) {
        parts.push(`5h ${pct5}%`);
        pctCandidates.push(pct5);
      }
      const pctW = parseFinitePercent(win.weekly?.remainingPercent);
      if (pctW != null) {
        parts.push(`周 ${pctW}%`);
        pctCandidates.push(pctW);
      }
      if (!parts.length && win.extraBuckets[0]) {
        const b0 = win.extraBuckets[0];
        const pctB0 = parseFinitePercent(b0.remainingPercent);
        parts.push(pctB0 != null ? `${pctB0}%` : (b0.label || "正常"));
      }
      const creditBalance = q?.credits?.balance;
      if (creditBalance !== null && creditBalance !== undefined && Number.isFinite(Number(creditBalance))) {
        const cr = compactCreditCount(creditBalance);
        if (cr) parts.push(`积分${cr}`);
      } else {
        const creditBucket = win.extraBuckets.find((b) => String(b.id || "").includes("credit") || String(b.label || "").includes("积分"));
        if (creditBucket?.detail) {
          const cr = compactCreditCount(creditBucket.detail.replace(/[^\d.]/g, ""));
          if (cr) parts.push(`积分${cr}`);
        }
      }
      const chipText = parts.join(" · ") || q?.summaryText || q?.headline || (qTone === "unavailable" ? "不可用" : "就绪");
      const tone = classifyTelemetryTone(
        win.fiveHour?.remainingPercent ?? win.weekly?.remainingPercent ?? null,
        qTone,
      );
      bumpTone(tone);
      chips.push(
        `<span class="telemetry-quota-chip is-${tone}" title="${escapeAttrHtml(`${shortName}: ${chipText}`)}">`
        + `<span class="telemetry-chip-k">${escapeAttrHtml(shortName)}</span>`
        + `<span class="telemetry-chip-v">${escapeAttrHtml(chipText)}</span>`
        + `</span>`,
      );
    }
  } else {
    const p = repProfiles[0];
    const q = p.quota;
    const qTone = q?.statusTone || q?.status || "ok";
    if (p.authenticated === false || !q || q.status === "unavailable") {
      return {
        chipsHtml: `<span class="telemetry-quota-chip is-muted" title="${escapeAttrHtml(q?.detail || "未认证或仅本地历史")}">${escapeAttrHtml(q?.summaryText || q?.headline || "仅历史")}</span>`,
        meterPct: null,
        meterTone: "muted",
      };
    }
    const win = resolveQuotaWindowsForUi(q);
    if (win.fiveHour) {
      chips.push(renderWindowChipHtml("5h", win.fiveHour, { nowSec, fallbackStatus: qTone, showResetDate: showResetDates }));
      const p5 = parseFinitePercent(win.fiveHour.remainingPercent);
      if (p5 != null) {
        pctCandidates.push(p5);
        bumpTone(classifyTelemetryTone(p5, qTone));
      }
    }
    if (win.weekly) {
      chips.push(renderWindowChipHtml("周", win.weekly, { nowSec, fallbackStatus: qTone, showResetDate: showResetDates }));
      const pw = parseFinitePercent(win.weekly.remainingPercent);
      if (pw != null) {
        pctCandidates.push(pw);
        bumpTone(classifyTelemetryTone(pw, qTone));
      }
    }
    if (provider === "antigravity" && (win.thirdPartyFiveHour || win.thirdPartyWeekly)) {
      const tp = win.thirdPartyFiveHour || win.thirdPartyWeekly;
      chips.push(renderWindowChipHtml("3P", tp, { nowSec, fallbackStatus: qTone, showResetDate: showResetDates }));
      const pt = parseFinitePercent(tp.remainingPercent);
      if (pt != null) pctCandidates.push(pt);
    }
    for (const b of win.extraBuckets.slice(0, Math.max(0, 3 - chips.length))) {
      const shortK = String(b.label || b.id || "").replace(/^(订阅|Grok\s*)/i, "").slice(0, 10) || "额度";
      const pb = parseFinitePercent(b.remainingPercent);
      if (pb != null) {
        pctCandidates.push(pb);
        bumpTone(classifyTelemetryTone(pb, qTone));
        chips.push(renderWindowChipHtml(shortK, b, { nowSec, fallbackStatus: qTone, showResetDate: showResetDates }));
      } else if (b.detail) {
        const shortV = String(b.id || "").includes("credit")
          ? (compactCreditCount(b.detail.replace(/[^\d.]/g, "")) || b.detail.slice(0, 10))
          : b.detail.slice(0, 12);
        chips.push(renderWindowChipHtml(shortK, b, { nowSec, fallbackStatus: "ok", showResetDate: showResetDates, displayValue: shortV }));
      }
    }
    const hasCreditBucket = win.extraBuckets.some((b) => String(b.id || "").includes("credit") || String(b.label || "").includes("积分"));
    if (!hasCreditBucket && q.credits?.balance != null && chips.length < 3) {
      const cr = compactCreditCount(q.credits.balance);
      if (cr) {
        chips.push(
          `<span class="telemetry-quota-chip is-ok" title="${escapeAttrHtml(`积分余额 ${q.credits.balance}`)}">`
          + `<span class="telemetry-chip-k">积分</span>`
          + `<span class="telemetry-chip-v">${escapeAttrHtml(cr)}</span>`
          + `</span>`,
        );
      }
    }
    if (!chips.length) {
      const hint = q.summaryText || q.headline || q.detail || "额度就绪";
      chips.push(`<span class="telemetry-quota-chip is-${classifyTelemetryTone(null, qTone)}">${escapeAttrHtml(hint)}</span>`);
    }
  }

  const meterPct = pctCandidates.length ? Math.min(...pctCandidates) : null;
  return { chipsHtml: chips.join(""), meterPct, meterTone: worstTone };
}

function isTelemetryPlaceholderProfile(profile, siblingCount = 1) {
  if (!profile) return true;
  if (profile.installed === false) return true;
  if (siblingCount <= 1) return false;
  if (profile.health?.disabled) return true;
  if (profile.authenticated === false) return true;
  if (profile.quota?.status === "unavailable") return true;
  return false;
}

function compactEmailDomainShort(email = "") {
  const clean = String(email || "").trim();
  const atIdx = clean.indexOf("@");
  if (atIdx < 0) return "";
  return clean.slice(atIdx + 1).split(".")[0] || "";
}

export function abbreviateMiddleText(value = "", { head = 3, tail = 3, maxLen = 8 } = {}) {
  const clean = String(value || "").trim();
  if (!clean) return "";
  const chars = Array.from(clean);
  if (chars.length <= maxLen) return clean;
  let h = Math.max(1, Number(head) || 3);
  let t = Math.max(1, Number(tail) || 3);
  if (chars.length <= h + t + 2) {
    h = Math.max(1, Math.min(h, Math.floor((maxLen - 2) / 2)));
    t = Math.max(1, Math.min(t, maxLen - 2 - h));
  }
  while (h > 1 && chars[h - 1] === "@") h -= 1;
  while (t > 1 && (chars[chars.length - t] === "." || chars[chars.length - t] === "@")) t -= 1;
  if (chars.length <= h + t + 1) return clean;
  return `${chars.slice(0, h).join("")}...${chars.slice(-t).join("")}`;
}

export function compactProfileDisplayLabel(label = "", provider = "") {
  const clean = String(label || "").trim();
  if (!clean) return "";
  const prefixMatch = clean.match(/^((?:Antigravity|Codex|Claude\s*Code|Claude|Grok)(?:\s*[·:/\-]\s*|\s+))(.*)$/i);
  if (prefixMatch) {
    const prefix = prefixMatch[1];
    const rest = prefixMatch[2].trim();
    if (!rest || /^(默认|default|桌面|desktop|cli|命令行)$/i.test(rest)) return clean;
    const shortRest = abbreviateMiddleText(rest, { head: 3, tail: 3, maxLen: 8 });
    return shortRest === rest ? clean : `${prefix.trimEnd()} ${shortRest}`.replace(/\s{2,}/g, " ");
  }
  const lower = clean.toLowerCase();
  if (lower === String(provider || "").trim().toLowerCase() || /^(默认|default|桌面|desktop|cli|命令行)$/i.test(clean)) {
    return clean;
  }
  return abbreviateMiddleText(clean, { head: 3, tail: 3, maxLen: 8 });
}

function formatTelemetryCardTitle(provider, profile, totalForProvider) {
  const meta = providerVisualMeta(provider);
  const alias = String(profile?.health?.alias || "").trim();
  if (alias) return abbreviateMiddleText(alias, { head: 6, tail: 4, maxLen: 12 });
  if (totalForProvider <= 1) return meta.short;

  const rawLabel = String(profile?.label || profile?.id || "").trim();
  const domainShort = compactEmailDomainShort(profile?.account?.email || profile?.quota?.accountLabel || "");
  if (profile?.id === "default" || rawLabel === `${meta.short} 默认` || rawLabel === `${meta.label} 默认`) {
    return domainShort ? `${meta.short} · ${domainShort}` : `${meta.short} 默认`;
  }
  return compactProfileDisplayLabel(rawLabel, provider) || `${meta.short} · ${abbreviateMiddleText(profile?.id || "", { head: 3, tail: 3, maxLen: 8 })}`;
}

export function buildSelectableTelemetryItems(profiles = []) {
  const safeProfiles = Array.isArray(profiles) ? profiles : [];
  const items = [];

  for (const prov of TELEMETRY_PROVIDER_ORDER) {
    const meta = providerVisualMeta(prov);
    const scoped = filterProfilesByProvider(safeProfiles, prov).filter((p) => p && p.installed !== false);
    if (!scoped.length) continue;

    if (prov === "antigravity") {
      const grouped = [];
      const groupByAccount = new Map();
      for (const p of scoped) {
        const acct = String(
          p.account?.email
          || p.quota?.accountLabel
          || p.endpointLabel
          || "",
        ).trim().toLowerCase();
        const fallbackGroup = (p.id === "desktop" || p.id === "cli") ? "__agy_shared__" : `id:${p.id}`;
        const gKey = acct || fallbackGroup;
        if (!groupByAccount.has(gKey)) {
          const g = [];
          groupByAccount.set(gKey, g);
          grouped.push(g);
        }
        groupByAccount.get(gKey).push(p);
      }

      const usableGroups = grouped.filter((g) => g.some((p) => !isTelemetryPlaceholderProfile(p, grouped.length)));
      const hasUsable = usableGroups.length > 0;
      const seenTitles = new Map();

      for (const group of grouped) {
        const primary = group.find((p) => p.id === "desktop") || group[0];
        const key = primary.key || `antigravity:${primary.id}`;
        const profileKeys = group.map((p) => p.key || `antigravity:${p.id}`);
        const placeholder = group.every((p) => isTelemetryPlaceholderProfile(p, grouped.length));
        let shortTitle = grouped.length <= 1
          ? meta.short
          : formatTelemetryCardTitle(prov, primary, grouped.length);
        const dupIdx = (seenTitles.get(shortTitle) || 0) + 1;
        seenTitles.set(shortTitle, dupIdx);
        if (dupIdx > 1) {
          const dom = compactEmailDomainShort(primary.account?.email || primary.quota?.accountLabel || "");
          shortTitle = dom ? `${shortTitle} (${dom})` : `${shortTitle} (${primary.id})`;
        }
        const identity = formatProfileIdentityHint(primary);
        const pickerLabel = identity && !shortTitle.toLowerCase().includes(identity.toLowerCase())
          ? `${shortTitle} (${identity})`
          : shortTitle;

        items.push({
          key,
          provider: prov,
          profileKeys,
          profiles: [primary],
          shortTitle,
          pickerLabel,
          defaultVisible: !(grouped.length > 1 && hasUsable && placeholder),
        });
      }
      continue;
    }

    const hasUsable = scoped.some((p) => !isTelemetryPlaceholderProfile(p, scoped.length));
    const seenTitles = new Map();
    for (const p of scoped) {
      const key = p.key || `${prov}:${p.id}`;
      const placeholder = isTelemetryPlaceholderProfile(p, scoped.length);
      let shortTitle = formatTelemetryCardTitle(prov, p, scoped.length);
      const dupIdx = (seenTitles.get(shortTitle) || 0) + 1;
      seenTitles.set(shortTitle, dupIdx);
      if (dupIdx > 1) {
        const dom = compactEmailDomainShort(p.account?.email || p.quota?.accountLabel || "");
        shortTitle = dom ? `${shortTitle} (${dom})` : `${shortTitle} (${p.id})`;
      }
      const identity = formatProfileIdentityHint(p);
      const baseLabel = String(
        p.health?.alias
          ? abbreviateMiddleText(p.health.alias, { head: 4, tail: 3, maxLen: 10 })
          : (compactProfileDisplayLabel(p.label, prov) || shortTitle),
      ).trim() || shortTitle;
      const pickerLabel = identity && !baseLabel.toLowerCase().includes(identity.toLowerCase())
        ? `${baseLabel} (${identity})`
        : baseLabel;

      items.push({
        key,
        provider: prov,
        profileKeys: [key],
        profiles: [p],
        shortTitle,
        pickerLabel,
        defaultVisible: !(scoped.length > 1 && hasUsable && placeholder),
      });
    }
  }

  return items;
}

export function resolveVisibleTelemetryKeys(items = [], savedPrefs = null) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return [];

  if (savedPrefs == null) {
    return list.filter((item) => item.defaultVisible).map((item) => item.key);
  }

  if (Array.isArray(savedPrefs)) {
    const selectedSet = new Set(savedPrefs.map((k) => String(k || "")));
    return list.filter((item) => selectedSet.has(item.key)).map((item) => item.key);
  }

  if (typeof savedPrefs === "object") {
    const hasSelected = Array.isArray(savedPrefs.selectedKeys);
    if (!hasSelected) {
      return list.filter((item) => item.defaultVisible).map((item) => item.key);
    }
    const selectedSet = new Set(savedPrefs.selectedKeys.map((k) => String(k || "")));
    const knownSet = new Set(
      (Array.isArray(savedPrefs.knownKeys) ? savedPrefs.knownKeys : []).map((k) => String(k || "")),
    );
    return list
      .filter((item) => selectedSet.has(item.key) || (item.defaultVisible && knownSet.size > 0 && !knownSet.has(item.key)))
      .map((item) => item.key);
  }

  return list.filter((item) => item.defaultVisible).map((item) => item.key);
}

function resolveTelemetryItemMetrics(item, byProvider = {}, byProfile = null, defaultCountByProv = {}) {
  if (byProfile && typeof byProfile === "object") {
    let matched = false;
    let running = 0;
    let queued = 0;
    let tokensPerSec = 0;
    for (const pKey of item.profileKeys) {
      const stat = byProfile[pKey];
      if (!stat) continue;
      matched = true;
      running += Math.max(0, Number(stat.runningCount || 0));
      queued += Math.max(0, Number(stat.queuedCount || 0));
      tokensPerSec += Math.max(0, Number(stat.tokensPerSec || 0));
    }
    if (matched) {
      return {
        running,
        queued,
        tokensPerSec: Math.round(tokensPerSec * 10) / 10,
      };
    }
  }

  const provStat = byProvider?.[item.provider] || {};
  const provDefaultCount = defaultCountByProv[item.provider] || 1;
  if (provDefaultCount <= 1 && item.defaultVisible) {
    return {
      running: Math.max(0, Number(provStat.runningCount || 0)),
      queued: Math.max(0, Number(provStat.queuedCount || 0)),
      tokensPerSec: Math.max(0, Number(provStat.tokensPerSec || 0)),
    };
  }

  const threads = Array.isArray(provStat.activeThreads) ? provStat.activeThreads : [];
  const matching = threads.filter((t) => item.profileKeys.some((pk) => String(t?.id || "").startsWith(`${pk}:`)));
  return {
    running: matching.length,
    queued: 0,
    tokensPerSec: matching.length > 0 ? Math.max(0, Number(provStat.tokensPerSec || 0)) : 0,
  };
}

export function summarizeTelemetryMobileBadge(profiles = [], telemetry = null, visibleKeys = null, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const safeProfiles = Array.isArray(profiles) ? profiles : [];
  const items = buildSelectableTelemetryItems(safeProfiles);
  const resolvedKeys = resolveVisibleTelemetryKeys(items, visibleKeys);
  const visibleSet = new Set(resolvedKeys);
  const visibleItems = items.filter((item) => visibleSet.has(item.key));

  const byProvider = telemetry?.byProvider || {};
  const byProfile = telemetry?.byProfile || null;
  let running = 0;
  let queued = 0;

  if (byProfile && visibleItems.length) {
    for (const prov of TELEMETRY_PROVIDER_ORDER) {
      running += Math.max(0, Number(byProvider[prov]?.runningCount || 0));
      queued += Math.max(0, Number(byProvider[prov]?.queuedCount || 0));
    }
  } else if (telemetry?.totals) {
    running = Math.max(0, Number(telemetry.totals.runningCount || 0));
    queued = Math.max(0, Number(telemetry.totals.queuedCount || 0));
  } else {
    for (const prov of TELEMETRY_PROVIDER_ORDER) {
      running += Math.max(0, Number(byProvider[prov]?.runningCount || 0));
      queued += Math.max(0, Number(byProvider[prov]?.queuedCount || 0));
    }
  }

  let worstTone = "ok";
  const quotaTargetItems = visibleItems.length ? visibleItems : items;
  for (const item of quotaTargetItems) {
    const { meterTone } = buildCompactQuotaChipsHtml(item.provider, item.profiles, nowSec);
    if (meterTone === "danger") {
      worstTone = "danger";
      break;
    }
    if (meterTone === "warn") {
      worstTone = "warn";
    }
  }

  const text = running > 0 ? `${running}运行` : (queued > 0 ? `${queued}排队` : "额度");
  const dotClass = running > 0
    ? "is-running"
    : (worstTone === "danger" ? "is-danger" : (worstTone === "warn" ? "is-warn" : ""));

  return {
    text,
    dotClass,
    runningCount: running,
    queuedCount: queued,
    worstTone,
  };
}

function renderTelemetryPickerPanelHtml(items, visibleSet) {
  return `<div class="telemetry-picker-panel" role="group" aria-label="选择要显示的 Agent 实例">
    <div class="telemetry-picker-head">
      <span class="telemetry-picker-title">勾选展示实例 (${visibleSet.size}/${items.length})</span>
      <div class="telemetry-picker-quick">
        <button type="button" class="telemetry-picker-link" data-telemetry-pick-action="default">恢复默认</button>
        <button type="button" class="telemetry-picker-link" data-telemetry-pick-action="all">全选</button>
      </div>
    </div>
    <div class="telemetry-picker-pills">
      ${items.map((item) => {
        const checked = visibleSet.has(item.key);
        const meta = providerVisualMeta(item.provider);
        return `<button type="button" class="telemetry-pick-pill ${checked ? "is-checked" : ""}" data-telemetry-pick-key="${escapeAttrHtml(item.key)}" aria-pressed="${checked ? "true" : "false"}" title="${escapeAttrHtml(item.pickerLabel)}">`
          + `<span class="telemetry-pick-check">${checked ? iconSvg("check", { size: 10 }) : ""}</span>`
          + `<span class="telemetry-provider-glyph is-${escapeAttrHtml(meta.tone)}">${providerIconSvg(item.provider, { size: 12 })}</span>`
          + `<span class="telemetry-pick-name">${escapeAttrHtml(item.pickerLabel)}</span>`
          + `</button>`;
      }).join("")}
    </div>
  </div>`;
}

function renderTelemetryDrawerHtml(_profiles, byProvider) {
  const runningEntries = [];
  for (const prov of TELEMETRY_PROVIDER_ORDER) {
    const stat = byProvider?.[prov];
    const threads = Array.isArray(stat?.activeThreads) ? stat.activeThreads : [];
    for (const t of threads) {
      if (!t?.id) continue;
      runningEntries.push({ provider: prov, id: t.id, title: t.title || t.id });
    }
  }

  if (!runningEntries.length) {
    return "";
  }

  return `<div class="telemetry-drawer is-compact-tasks" role="region" aria-label="正在运行的 Agent 任务">
    <div class="telemetry-drawer-section">
      <div class="telemetry-drawer-heading">正在运行的任务 (${runningEntries.length})</div>
      <div class="telemetry-running-pills">
        ${runningEntries.map((item) => {
          const meta = providerVisualMeta(item.provider);
          return `<button type="button" class="telemetry-jump-pill is-${escapeAttrHtml(meta.tone)}" data-telemetry-jump-thread="${escapeAttrHtml(item.id)}" title="点击跳转到该会话">`
            + `<span class="telemetry-jump-badge">${providerIconSvg(item.provider, { size: 11 })} ${escapeAttrHtml(meta.short)}</span>`
            + `<span class="telemetry-jump-title">${escapeAttrHtml(item.title)}</span>`
            + `</button>`;
        }).join("")}
      </div>
    </div>
  </div>`;
}

function compactQuotaDisplay(repProfiles = []) {
  const p = repProfiles[0];
  const q = p?.quota;
  if (!p || p.authenticated === false || !q || q.status === "unavailable") {
    return {
      weeklyPercent: null,
      lowFiveHour: null,
      tone: "muted",
      statusText: !p ? "未接入" : (p.authenticated === false ? "未认证" : "额度未知"),
    };
  }
  const win = resolveQuotaWindowsForUi(q);
  const weeklyPercent = parseFinitePercent(win.weekly?.remainingPercent ?? win.thirdPartyWeekly?.remainingPercent);
  const fiveHour = parseFinitePercent(win.fiveHour?.remainingPercent ?? win.thirdPartyFiveHour?.remainingPercent);
  return {
    weeklyPercent,
    lowFiveHour: fiveHour != null && fiveHour < 30 ? fiveHour : null,
    tone: classifyTelemetryTone(weeklyPercent, q.statusTone || q.status),
    statusText: "",
  };
}

function itemMatchesActiveTarget(item, activeProvider = "", activeProfileId = "") {
  const prov = String(activeProvider || "").trim().toLowerCase();
  const profId = String(activeProfileId || "").trim().toLowerCase();
  if (!prov || item.provider !== prov) return false;
  if (!profId) return true;
  const fullKey = `${prov}:${profId}`;
  return (item.profileKeys || []).some((pk) => {
    const clean = String(pk || "").toLowerCase();
    return clean === fullKey || clean.endsWith(`:${profId}`);
  });
}

function selectCompactTelemetryEntries(entries = [], { activeProvider = "", activeProfileId = "" } = {}) {
  if (!entries.length) return [];
  const activeOrQueued = entries
    .filter((e) => e.running > 0 || e.queued > 0)
    .sort((a, b) => (b.running - a.running) || (b.queued - a.queued) || (b.tokensPerSec - a.tokensPerSec));

  const picked = [...activeOrQueued];
  const pickedKeys = new Set(picked.map((e) => e.item.key));

  const exactCurrent = activeProfileId
    ? entries.find((e) => itemMatchesActiveTarget(e.item, activeProvider, activeProfileId))
    : null;
  const providerCurrent = !exactCurrent && activeProvider
    ? entries.find((e) => e.item.provider === String(activeProvider).toLowerCase())
    : null;
  const currentEntry = exactCurrent || providerCurrent;

  if (currentEntry && !pickedKeys.has(currentEntry.item.key)) {
    picked.push(currentEntry);
    pickedKeys.add(currentEntry.item.key);
  }
  if (!picked.length && entries[0]) {
    picked.push(entries[0]);
  }
  return picked;
}

export function renderAgentTelemetryBarHtml(profiles = [], telemetry = null, {
  providerFilter = "all",
  expanded = false,
  refreshing = false,
  visibleKeys = null,
  pickerOpen = false,
  activeProvider = "",
  activeProfileId = "",
  nowSec = Math.floor(Date.now() / 1000),
} = {}) {
  const safeProfiles = Array.isArray(profiles) ? profiles : [];
  if (!safeProfiles.length && !telemetry) return "";

  const byProvider = telemetry?.byProvider || {};
  const byProfile = telemetry?.byProfile || null;
  const totalRunning = TELEMETRY_PROVIDER_ORDER.reduce((sum, p) => sum + Number(byProvider[p]?.runningCount || 0), 0);
  const totalQueued = TELEMETRY_PROVIDER_ORDER.reduce((sum, p) => sum + Number(byProvider[p]?.queuedCount || 0), 0);
  const totalTps = TELEMETRY_PROVIDER_ORDER.reduce((sum, p) => sum + Number(byProvider[p]?.tokensPerSec || 0), 0);

  const items = buildSelectableTelemetryItems(safeProfiles);
  const resolvedKeys = resolveVisibleTelemetryKeys(items, visibleKeys);
  const visibleSet = new Set(resolvedKeys);
  const visibleItems = items.filter((item) => visibleSet.has(item.key));

  const defaultCountByProv = {};
  for (const item of items) {
    if (item.defaultVisible) {
      defaultCountByProv[item.provider] = (defaultCountByProv[item.provider] || 0) + 1;
    }
  }

  let worstTone = "ok";
  const renderCardItems = items.length ? visibleItems : TELEMETRY_PROVIDER_ORDER.map((prov) => ({
    key: prov,
    provider: prov,
    profileKeys: [],
    profiles: [],
    shortTitle: providerVisualMeta(prov).short,
    pickerLabel: providerVisualMeta(prov).label,
    defaultVisible: true,
  }));

  const isExpandedMode = Boolean(expanded || pickerOpen);
  const entries = renderCardItems.map((item) => {
    const prov = item.provider;
    const { running, queued, tokensPerSec } = resolveTelemetryItemMetrics(
      item,
      byProvider,
      byProfile,
      defaultCountByProv,
    );
    const compactChips = buildCompactQuotaChipsHtml(prov, item.profiles, nowSec, { showResetDates: isExpandedMode });
    if (compactChips.meterTone === "danger") worstTone = "danger";
    else if (compactChips.meterTone === "warn" && worstTone !== "danger") worstTone = "warn";
    return {
      item,
      running,
      queued,
      tokensPerSec,
      compactChips,
    };
  });

  if (!isExpandedMode) {
    const compactEntries = selectCompactTelemetryEntries(entries, { activeProvider, activeProfileId });
    const shownRunning = compactEntries.reduce((sum, e) => sum + e.running, 0);
    const shownQueued = compactEntries.reduce((sum, e) => sum + e.queued, 0);
    const hiddenRunning = Math.max(0, totalRunning - shownRunning);
    const hiddenQueued = Math.max(0, totalQueued - shownQueued);

    const pillsHtml = compactEntries.map(({ item, running, queued, tokensPerSec }) => {
      const prov = item.provider;
      const meta = providerVisualMeta(prov);
      const isCurrent = itemMatchesActiveTarget(item, activeProvider, activeProfileId);
      const runText = running > 0
        ? `${running} 运行${queued > 0 ? ` · ${queued} 排队` : ""}`
        : (queued > 0 ? `${queued} 排队` : "");
      const tpsText = tokensPerSec > 0 ? `${formatTokensPerSec(tokensPerSec)} tok/s` : "";
      const quota = compactQuotaDisplay(item.profiles);
      const hasWeekly = quota.weeklyPercent != null;
      const fiveHourText = quota.lowFiveHour != null ? `5h ${quota.lowFiveHour}%` : "";
      const quotaTitle = [
        hasWeekly ? `周额度剩余 ${quota.weeklyPercent}%` : "暂无周额度数据",
        fiveHourText,
        "点击展开全部 Agent 监控与额度详情",
      ].filter(Boolean).join(" · ");
      const glyphStateClass = running > 0 ? "is-running" : (queued > 0 ? "is-queued" : "");
      return `<button type="button" class="telemetry-compact-pill ${running > 0 ? "is-running" : ""} ${isCurrent ? "is-current" : ""}${hasWeekly ? ` has-weekly-quota quota-${quota.tone}` : ""}" data-telemetry-item-key="${escapeAttrHtml(item.key)}" data-telemetry-toggle title="${escapeAttrHtml(quotaTitle)}">`
        + (hasWeekly ? `<span class="telemetry-weekly-progress" aria-hidden="true"><span class="telemetry-weekly-fill" style="width:${quota.weeklyPercent}%"></span></span>` : "")
        + `<span class="telemetry-provider-glyph is-${escapeAttrHtml(meta.tone)}${glyphStateClass ? ` ${glyphStateClass}` : ""}">${providerIconSvg(prov, { size: 12 })}</span>`
        + `<span class="telemetry-compact-name">${escapeAttrHtml(item.shortTitle)}</span>`
        + (runText ? `<span class="telemetry-compact-run ${running > 0 ? "is-running" : "is-queued"}">${escapeAttrHtml(runText)}</span>` : "")
        + (tpsText ? `<span class="telemetry-compact-tps">${escapeAttrHtml(tpsText)}</span>` : "")
        + (fiveHourText ? `<span class="telemetry-quota-alert is-${quota.lowFiveHour <= 5 ? "danger" : "warn"}">${escapeAttrHtml(fiveHourText)}</span>` : "")
        + (quota.statusText ? `<span class="telemetry-compact-quota is-muted">${escapeAttrHtml(quota.statusText)}</span>` : "")
        + (hasWeekly ? `<span class="telemetry-compact-percent">${Math.round(Number(quota.weeklyPercent) || 0)}%</span>` : "")
        + `</button>`;
    }).join("");

    const overflowParts = [];
    if (hiddenRunning > 0) overflowParts.push(`${compactEntries.length ? "+" : ""}${hiddenRunning} 运行`);
    if (hiddenQueued > 0) overflowParts.push(`${compactEntries.length ? "+" : ""}${hiddenQueued} 排队`);
    const overflowPillHtml = overflowParts.length
      ? `<button type="button" class="telemetry-compact-pill telemetry-overflow-pill ${hiddenRunning > 0 ? "is-running" : ""}" data-telemetry-toggle title="其他智能体有后台运行/排队任务，点击展开查看">`
        + `<span class="telemetry-live-dot ${hiddenRunning > 0 ? "is-running" : "is-queued"}" aria-hidden="true"></span>`
        + `<span class="telemetry-compact-run ${hiddenRunning > 0 ? "is-running" : "is-queued"}">${escapeAttrHtml(overflowParts.join(" · "))}</span>`
        + `</button>`
      : "";

    return `<div class="telemetry-bar-shell is-compact">
      <div class="telemetry-compact-row">
        <div class="telemetry-compact-items">${pillsHtml || `<span class="telemetry-summary-title">Agent 就绪</span>`}${overflowPillHtml}</div>
      </div>
    </div>`;
  }

  const cardsHtml = entries.map(({ item, running, queued, tokensPerSec, compactChips }) => {
    const prov = item.provider;
    const meta = providerVisualMeta(prov);
    const tpsText = formatTokensPerSec(tokensPerSec);
    const hasTps = tokensPerSec > 0;
    const { chipsHtml, meterPct, meterTone } = compactChips;

    const isFiltered = providerFilter === prov;
    const runLabel = running > 0
      ? `${running} 运行${queued > 0 ? ` · ${queued}排队` : ""}`
      : (queued > 0 ? `${queued} 排队` : "空闲");

    const cardGlyphStateClass = running > 0 ? "is-running" : (queued > 0 ? "is-queued" : "");
    return `<div class="telemetry-agent-card ${running > 0 ? "is-running" : ""} ${isFiltered ? "is-filtered" : ""}" data-telemetry-item-key="${escapeAttrHtml(item.key)}" data-telemetry-toggle title="点击展开/收起 ${escapeAttrHtml(item.pickerLabel)} 详情">
      <div class="telemetry-card-top">
        <div class="telemetry-card-id">
          <span class="telemetry-provider-glyph is-${escapeAttrHtml(meta.tone)}${cardGlyphStateClass ? ` ${cardGlyphStateClass}` : ""}">${providerIconSvg(prov, { size: 12 })}</span>
          <span class="telemetry-provider-name">${escapeAttrHtml(item.shortTitle)}</span>
        </div>
        <div class="telemetry-card-metrics">
          <span class="telemetry-run-badge ${running > 0 ? "is-running" : queued > 0 ? "is-queued" : ""}">${escapeAttrHtml(runLabel)}</span>
          <span class="telemetry-tps-badge ${hasTps ? "is-active" : ""}">${escapeAttrHtml(tpsText)} tok/s</span>
          ${expanded ? `<button type="button" class="telemetry-card-filter ${isFiltered ? "is-active" : ""}" data-telemetry-filter-provider="${escapeAttrHtml(prov)}" title="${isFiltered ? "取消只看此 Agent" : "只看此 Agent"}">${isFiltered ? "取消筛选" : "只看"}</button>` : ""}
        </div>
      </div>
      <div class="telemetry-card-quotas">${chipsHtml}</div>
      ${meterPct != null ? `<div class="telemetry-meter"><span class="telemetry-meter-fill is-${meterTone}" style="width:${meterPct}%"></span></div>` : ""}
    </div>`;
  }).join("");

  const totalRunText = totalRunning > 0
    ? `${totalRunning} 运行中${totalQueued > 0 ? ` · ${totalQueued} 排队` : ""}`
    : (totalQueued > 0 ? `${totalQueued} 排队` : "全空闲");
  const totalTpsText = `${formatTokensPerSec(totalTps)} tok/s`;
  const summaryDotClass = totalRunning > 0
    ? "is-running"
    : (worstTone === "danger" ? "is-danger" : (worstTone === "warn" ? "is-warn" : ""));

  const gridOrEmptyHtml = items.length && !visibleItems.length
    ? `<div class="telemetry-empty-hint">未选择展示任何实例 · 点击上方「显示」勾选需要展示的 Agent</div>`
    : `<div class="telemetry-bar-grid">${cardsHtml}</div>`;

  return `<div class="telemetry-bar-shell is-expanded">
    <div class="telemetry-bar-summary">
      <div class="telemetry-summary-left">
        <span class="telemetry-summary-dot ${summaryDotClass}" aria-hidden="true"></span>
        <span class="telemetry-summary-title">Agent 实时监控</span>
        <span class="telemetry-summary-stat ${totalRunning > 0 ? "is-active" : ""}">${escapeAttrHtml(totalRunText)}</span>
        <span class="telemetry-summary-sep">·</span>
        <span class="telemetry-summary-stat ${totalTps > 0 ? "is-tps" : ""}">${escapeAttrHtml(totalTpsText)}</span>
      </div>
      <div class="telemetry-summary-actions">
        <button type="button" class="telemetry-action-btn" data-open-instance-modal="" title="多开独立实例并登录接管">${iconSvg("plus", { size: 12 })} <span>多开实例</span></button>
        ${items.length ? `<button type="button" class="telemetry-action-btn ${pickerOpen ? "is-open" : ""}" data-telemetry-picker-toggle aria-expanded="${pickerOpen ? "true" : "false"}" title="选择要显示的 Agent 实例">${iconSvg("settings", { size: 12 })} <span>显示 (${visibleItems.length}/${items.length})</span></button>` : ""}
        <button type="button" class="telemetry-action-btn" data-telemetry-refresh ${refreshing ? "disabled" : ""} title="手动刷新 Agent 额度与状态">${refreshing ? "刷新中…" : `${iconSvg("refresh", { size: 12 })} <span>刷新</span>`}</button>
        <button type="button" class="telemetry-action-btn ${expanded ? "is-open" : ""}" data-telemetry-toggle aria-expanded="${expanded ? "true" : "false"}">${expanded ? `<span>收起</span>${iconSvg("chevron-up", { size: 11 })}` : `<span>详情</span>${iconSvg("chevron-down", { size: 11 })}`}</button>
        <button type="button" class="telemetry-action-btn mobile-only" data-telemetry-mobile-close title="收起监控面板" aria-label="收起监控面板">${iconSvg("close", { size: 12 })}</button>
      </div>
    </div>
    ${pickerOpen && items.length ? renderTelemetryPickerPanelHtml(items, visibleSet) : ""}
    ${gridOrEmptyHtml}
    ${expanded ? renderTelemetryDrawerHtml(safeProfiles, byProvider) : ""}
  </div>`;
}

export function profileHealthVisualMeta(profile) {
  const health = profile?.health || {};
  if (health.disabled) {
    return {
      status: "disabled",
      rank: 4,
      available: false,
      dotClass: "is-disabled",
      icon: "",
      badgeText: "已停用",
      labelPrefix: "",
    };
  }
  if (profile?.installed === false) {
    return {
      status: "unavailable",
      rank: 3,
      available: false,
      dotClass: "is-unavailable",
      icon: "",
      badgeText: "未安装",
      labelPrefix: "",
    };
  }
  if (profile?.needsLogin) {
    return {
      status: "needs_login",
      rank: 3,
      available: false,
      dotClass: "is-cooldown",
      icon: "",
      badgeText: "待登录",
      labelPrefix: "",
    };
  }
  if (profile?.authenticated === false) {
    return {
      status: "unauthenticated",
      rank: 3,
      available: false,
      dotClass: "is-unavailable",
      icon: "",
      badgeText: "仅历史",
      labelPrefix: "",
    };
  }
  const status = health.status || "unknown";
  if (status !== "unavailable" && profile?.quota?.statusTone === "exhausted") {
    return {
      status: "cooldown",
      rank: 2,
      available: false,
      dotClass: "is-cooldown",
      icon: "",
      badgeText: profile.quota.summaryText || "额度耗尽",
      labelPrefix: "",
    };
  }
  const latency = Number.isFinite(Number(health.latencyMs)) && Number(health.latencyMs) > 0
    ? `${Math.round(Number(health.latencyMs))}ms`
    : "";
  switch (status) {
    case "healthy":
      return {
        status: "healthy",
        rank: 0,
        available: true,
        dotClass: "is-healthy",
        icon: "",
        badgeText: latency || "可用",
        labelPrefix: "",
      };
    case "cooldown":
      return {
        status: "cooldown",
        rank: 2,
        available: false,
        dotClass: "is-cooldown",
        icon: "",
        badgeText: health.shortReason || "限额冷却",
        labelPrefix: "",
      };
    case "unavailable":
      return {
        status: "unavailable",
        rank: 3,
        available: false,
        dotClass: "is-unavailable",
        icon: "",
        badgeText: health.shortReason || "暂不可用",
        labelPrefix: "",
      };
    default:
      return {
        status: "unknown",
        rank: 1,
        available: true,
        dotClass: "is-unknown",
        icon: "",
        badgeText: "待测",
        labelPrefix: "",
      };
  }
}

export function sortProfilesByAvailability(profiles = []) {
  return [...(Array.isArray(profiles) ? profiles : [])].sort((a, b) => {
    const metaA = profileHealthVisualMeta(a);
    const metaB = profileHealthVisualMeta(b);
    if (metaA.rank !== metaB.rank) return metaA.rank - metaB.rank;
    const authDiff = Number(Boolean(b?.authenticated !== false)) - Number(Boolean(a?.authenticated !== false));
    if (authDiff !== 0) return authDiff;
    const remA = a?.quota?.primary?.remainingPercent;
    const remB = b?.quota?.primary?.remainingPercent;
    const hasRemA = typeof remA === "number" && Number.isFinite(remA);
    const hasRemB = typeof remB === "number" && Number.isFinite(remB);
    if (hasRemA || hasRemB) {
      const scoreA = hasRemA ? remA : -1;
      const scoreB = hasRemB ? remB : -1;
      if (scoreA !== scoreB) return scoreB - scoreA;
    }
    const latA = Number.isFinite(Number(a?.health?.latencyMs)) ? Number(a.health.latencyMs) : Number.MAX_SAFE_INTEGER;
    const latB = Number.isFinite(Number(b?.health?.latencyMs)) ? Number(b.health.latencyMs) : Number.MAX_SAFE_INTEGER;
    return latA - latB;
  });
}

export function pickBestAvailableProfile(profiles = [], preferredId = "") {
  const sorted = sortProfilesByAvailability(profiles);
  if (!sorted.length) return null;
  if (preferredId) {
    const exact = sorted.find((p) => p.id === preferredId);
    if (exact && profileHealthVisualMeta(exact).rank <= 1) return exact;
  }
  return sorted.find((p) => profileHealthVisualMeta(p).rank <= 1)
    || sorted.find((p) => !p.health?.disabled)
    || sorted[0];
}

export function findFailoverCandidateProfile(profiles = [], provider = "", failedProfileId = "") {
  const scoped = sortProfilesByAvailability(filterProfilesByProvider(profiles, provider));
  return scoped.find((p) => (
    p.id !== failedProfileId
    && p.installed !== false
    && !p.health?.disabled
    && profileHealthVisualMeta(p).rank <= 2
    && profileHealthVisualMeta(p).status !== "unavailable"
  )) || null;
}

export function formatProfileIdentityHint(profile) {
  if (!profile) return "";
  const alias = String(profile.health?.alias || "").trim();
  if (alias) return abbreviateMiddleText(alias, { head: 4, tail: 3, maxLen: 10 });
  const email = String(profile.account?.email || "").trim();
  if (email) {
    return abbreviateMiddleText(email, { head: 4, tail: 3, maxLen: 9 });
  }
  const endpoint = String(profile.endpointLabel || "").trim();
  if (endpoint) return abbreviateMiddleText(endpoint, { head: 4, tail: 4, maxLen: 12 });
  if (profile.identityLabel) return abbreviateMiddleText(String(profile.identityLabel), { head: 3, tail: 3, maxLen: 9 });
  return "";
}

function compactAccountHandle(profile) {
  const email = String(profile?.account?.email || "").trim();
  if (email) {
    const atIdx = email.indexOf("@");
    const handle = (atIdx > 0 ? email.slice(0, atIdx) : email).trim();
    if (handle) return handle;
  }
  const name = String(profile?.account?.name || profile?.identityLabel || "").trim();
  if (name && !/^(默认|default)$/i.test(name)) {
    return name;
  }
  return "";
}

export function compactProfileChipText(profile) {
  if (!profile) return "";
  const alias = String(profile.health?.alias || "").trim();
  if (alias) return alias;
  const provider = String(profile.provider || "").trim().toLowerCase();
  const label = String(profile.label || "").trim();
  const stripped = label
    .replace(/^(Codex|Claude\s*Code|Claude|Antigravity|Grok)\s*[·:/\-]?\s*/i, "")
    .trim();
  const isGenericStripped = !stripped
    || (provider && stripped.toLowerCase() === provider)
    || /^(默认|default)$/i.test(stripped);
  if (!isGenericStripped) return stripped;
  if (profile.id === "desktop") return "桌面";
  if (profile.id === "cli") return "CLI";
  const accountHandle = compactAccountHandle(profile);
  if (accountHandle) return accountHandle;
  if (stripped) return stripped;
  if (label) return label;
  return String(profile.id || "默认").trim() || "默认";
}

function extractCompactVariantLabel(thread) {
  const provider = String(thread?.provider || "").trim().toLowerCase();
  const profileId = String(thread?.profileId || "").trim().toLowerCase();
  const rawLabel = String(thread?.profileLabel || thread?.profileId || "").trim();
  if (profileId === "desktop" || /桌面|desktop/i.test(rawLabel)) return "桌面";
  if (profileId === "cli" || /\bcli\b|命令行/i.test(rawLabel)) return "CLI";

  const cleaned = rawLabel
    .replace(/^(Antigravity|Codex|Claude\s*Code|Claude|Grok)\s*[·:/\-]?\s*/i, "")
    .trim();
  if (!cleaned) return "";
  const lower = cleaned.toLowerCase();
  if (lower === provider || /^(默认|default)$/i.test(cleaned)) return "";
  return cleaned;
}

const KNOWN_EMAIL_DOMAIN_DISPLAY = Object.freeze({
  icloud: "iCloud",
  me: "iCloud",
  hotmail: "Hotmail",
  outlook: "Outlook",
  live: "Outlook",
  gmail: "Gmail",
  googlemail: "Gmail",
  qq: "QQ",
  foxmail: "Foxmail",
  163: "163",
  126: "126",
  yeah: "Yeah",
});

function formatDomainDisplayAlias(email = "") {
  const clean = String(email || "").trim().toLowerCase();
  const atIdx = clean.indexOf("@");
  if (atIdx < 0) return "";
  const firstLabel = (clean.slice(atIdx + 1).trim().split(".")[0] || "").trim();
  if (!firstLabel) return "";
  return KNOWN_EMAIL_DOMAIN_DISPLAY[firstLabel] || firstLabel.slice(0, 10);
}

function compactEmailOwnerHandle(email = "") {
  const clean = String(email || "").trim();
  const atIdx = clean.indexOf("@");
  const rawLocal = (atIdx > 0 ? clean.slice(0, atIdx) : clean).trim();
  if (!rawLocal) return "";
  const alphaLead = rawLocal.match(/^([a-zA-Z][a-zA-Z._-]{1,10}?)\d{4,}$/);
  if (alphaLead && alphaLead[1]) {
    return alphaLead[1].replace(/[._-]+$/g, "") || rawLocal;
  }
  return rawLocal;
}

export function resolveDistinctProfileChipText(profile, scopedProfiles = []) {
  if (!profile) return "";
  const explicitAlias = String(profile.health?.alias || "").trim();
  if (explicitAlias) return explicitAlias;
  const baseText = compactProfileChipText(profile);
  const installedSiblings = (Array.isArray(scopedProfiles) ? scopedProfiles : []).filter(
    (p) => p && p.installed !== false && !p.health?.disabled,
  );
  if (installedSiblings.length < 2) return baseText;

  const owner = compactEmailOwnerHandle(profile.account?.email || "");
  const domainAlias = formatDomainDisplayAlias(profile.account?.email || "");
  if (owner) {
    let ownerCollisions = 0;
    for (const sib of installedSiblings) {
      if (compactEmailOwnerHandle(sib.account?.email || "").toLowerCase() === owner.toLowerCase()) {
        ownerCollisions += 1;
      }
    }
    if (ownerCollisions <= 1 && domainAlias) {
      const ownerShort = owner.length <= 6 ? owner : (/^\d+$/.test(owner) ? owner.slice(-4) : owner.slice(0, 6));
      return `${ownerShort}·${domainAlias}`.slice(0, 12);
    }
    if (ownerCollisions > 1 && domainAlias) {
      return domainAlias;
    }
  }

  let baseCollisions = 0;
  for (const sib of installedSiblings) {
    if (compactProfileChipText(sib).toLowerCase() === baseText.toLowerCase()) {
      baseCollisions += 1;
    }
  }
  if (baseCollisions <= 1 && !/^(默认|default)$/i.test(baseText)) {
    return baseText;
  }

  if (domainAlias) return domainAlias;
  const ep = String(profile.endpointLabel || "").trim();
  if (ep) return ep.split(".")[0] || ep;
  if (!profile.account?.email && /^(default|默认)$/i.test(String(profile.id || ""))) {
    return "默认";
  }
  if (profile.id && !/^(default|默认)$/i.test(profile.id)) {
    return profile.id === "desktop" ? "桌面" : (profile.id === "cli" ? "CLI" : String(profile.id));
  }
  return baseText;
}

export function compactThreadSourceChip(thread, {
  providerFilter = "all",
  profileFilter = "all",
  profiles = [],
} = {}) {
  if (profileFilter && profileFilter !== "all") return null;
  const provider = String(thread?.provider || "antigravity");
  const providerLower = provider.toLowerCase();
  const meta = providerVisualMeta(provider);
  const scopedProfiles = filterProfilesByProvider(profiles, provider).filter((p) => p?.installed !== false);
  const matchedProfile = scopedProfiles.find((p) => p.id === thread?.profileId)
    || profiles.find((p) => String(p?.provider || "").toLowerCase() === providerLower && p?.id === thread?.profileId)
    || null;
  const shortVariant = extractCompactVariantLabel(thread);
  const hasMultiProfiles = scopedProfiles.length >= 2;
  const multiAccountChip = hasMultiProfiles
    ? (resolveDistinctProfileChipText(matchedProfile, scopedProfiles)
      || shortVariant
      || (/^(default|默认)$/i.test(String(thread?.profileId || "")) ? "默认" : String(thread?.profileId || ""))
      || "默认")
    : "";
  const emailHint = String(matchedProfile?.account?.email || "").trim();
  const baseTitle = `${meta.label}${thread?.profileLabel ? ` · ${thread.profileLabel}` : ""}`;
  const title = emailHint && !baseTitle.includes(emailHint)
    ? `${baseTitle} (${emailHint})`
    : baseTitle;

  if (scopedProfiles.length === 1) {
    return null;
  }

  if (hasMultiProfiles) {
    return {
      glyph: "",
      text: multiAccountChip,
      tone: meta.tone,
      title,
    };
  }

  if (providerFilter && providerFilter !== "all") {
    if (!shortVariant) return null;
    if (scopedProfiles.length > 0 && scopedProfiles.length <= 1) return null;
    return {
      glyph: "",
      text: shortVariant,
      tone: meta.tone,
      title,
    };
  }

  if (shortVariant) {
    return {
      glyph: "",
      text: shortVariant,
      tone: meta.tone,
      title,
    };
  }

  return null;
}

export function profileOptionLabel(profile) {
  if (!profile) return "默认";
  const meta = profileHealthVisualMeta(profile);
  const idHint = formatProfileIdentityHint(profile);
  const name = compactProfileDisplayLabel(profile.label || profile.id || "默认", profile.provider);
  const parts = [name];
  if (idHint && !name.includes(idHint)) parts.push(idHint);
  if (meta.status !== "unknown" && meta.badgeText) parts.push(meta.badgeText);
  const quotaSummary = String(profile.quota?.summaryText || "").trim();
  if (quotaSummary && quotaSummary !== meta.badgeText && !parts.includes(quotaSummary)) {
    parts.push(quotaSummary);
  }
  return `${meta.labelPrefix}${parts.join(" · ")}`;
}

export function renderProfilePillsHtml(profiles = [], {
  selectedId = "",
  probingKeys = new Set(),
  activeLocked = false,
  allowManageButton = false,
  provider = "",
} = {}) {
  const sorted = sortProfilesByAvailability(profiles);
  const resolvedProvider = String(provider || sorted[0]?.provider || "").trim().toLowerCase();
  const canManageProvider = resolvedProvider === "codex" || resolvedProvider === "claude";
  if (!sorted.length) {
    return `<div class="profile-pills-empty">未检测到可用实例${allowManageButton && canManageProvider ? ` <button type="button" class="profile-pill-add-btn" data-open-instance-modal="${escapeAttrHtml(resolvedProvider)}" title="新建或管理多开独立实例">${iconSvg("plus", { size: 11 })}<span>多开</span></button>` : ""}</div>`;
  }
  const showDisableToggle = sorted.length >= 2;
  const cardsHtml = sorted.map((p) => {
    const meta = profileHealthVisualMeta(p);
    const key = p.key || `${p.provider}:${p.id}`;
    const isSelected = p.id === selectedId;
    const isProbing = probingKeys?.has?.(key) || probingKeys?.has?.(`${p.provider}:*`);
    const hint = formatProfileIdentityHint(p);
    const isRelayTarget = Boolean(activeLocked && !isSelected && meta.available);
    const quota = p.quota || null;
    const quotaSummary = String(quota?.summaryText || "").trim();
    const quotaPlan = String(quota?.planLabel || "").trim();
    const quotaPct = quota?.primary?.remainingPercent;
    const hasQuotaPct = typeof quotaPct === "number" && Number.isFinite(quotaPct);
    const showQuickLogin = Boolean(p.needsLogin && (p.provider === "codex" || p.provider === "claude"));
    const authCmdMatch = (
      p.provider === "claude"
      && !showQuickLogin
      && (meta.badgeText === "CLI未登录" || p.health?.reasonCode === "auth")
    )
      ? String(p.health?.detail || "").match(/((?:env -u CLAUDE_CONFIG_DIR\s+|CLAUDE_CONFIG_DIR=\S+\s+)?claude auth login(?:\s+--email\s+\S+)?)/i)
      : null;
    const copyLoginCmd = authCmdMatch?.[1] ? authCmdMatch[1].trim() : "";
    const subParts = [];
    if (hint) subParts.push(hint);
    if (quotaPlan && quotaPlan !== "未登录" && !subParts.includes(quotaPlan)) subParts.push(quotaPlan);
    if (isProbing) subParts.push("测通中…");
    else if (isRelayTarget) subParts.push(meta.badgeText !== "待测" ? `${meta.badgeText} · 点此接力` : "点此同目录接力");
    else subParts.push(meta.badgeText);
    if (!isProbing && quotaSummary && quotaSummary !== meta.badgeText) subParts.push(quotaSummary);
    const subText = subParts.filter(Boolean).join(" · ");
    const displayName = compactProfileDisplayLabel(p.label || p.id || "默认", p.provider);
    const toneClass = quota?.statusTone ? `tone-${quota.statusTone}` : "";

    return `
      <div class="profile-pill-card ${meta.dotClass}${isSelected ? " is-selected" : ""}${isProbing ? " is-probing" : ""}" data-profile-key="${escapeAttrHtml(key)}">
        <button
          type="button"
          class="profile-pill-main"
          data-select-profile="${escapeAttrHtml(p.id)}"
          data-profile-provider="${escapeAttrHtml(p.provider || "")}"
          ${isRelayTarget ? `data-relay-profile="${escapeAttrHtml(p.id)}"` : ""}
          title="${escapeAttrHtml(p.health?.detail || p.home || displayName)}"
        >
          <span class="profile-status-dot ${meta.dotClass}" aria-hidden="true"></span>
          <span class="profile-pill-copy">
            <span class="profile-pill-name">${escapeAttrHtml(displayName)}${isSelected && activeLocked ? `<span class="profile-pill-lock">当前</span>` : ""}</span>
            <span class="profile-pill-sub">${escapeAttrHtml(subText)}</span>
            ${hasQuotaPct ? `<span class="quota-mini-bar profile-pill-meter" aria-hidden="true"><span class="quota-mini-fill ${toneClass}" style="width:${Math.max(0, Math.min(100, Math.round(quotaPct)))}%"></span></span>` : ""}
          </span>
        </button>
        <div class="profile-pill-actions">
          ${showQuickLogin ? `
            <button
              type="button"
              class="profile-pill-action-btn is-copy-login"
              data-login-profile="${escapeAttrHtml(p.id)}"
              data-login-provider="${escapeAttrHtml(p.provider || "")}"
              data-login-mode="${p.provider === "codex" ? "oauth" : "terminal"}"
              title="登录此独立实例并交给 Agent Control 后台控制"
            >去登录</button>
          ` : ""}
          ${copyLoginCmd ? `
            <button
              type="button"
              class="profile-pill-action-btn is-copy-login"
              data-copy-login-cmd="${escapeAttrHtml(copyLoginCmd)}"
              title="复制终端登录命令：${escapeAttrHtml(copyLoginCmd)}"
            >复制登录</button>
          ` : ""}
          <button
            type="button"
            class="profile-pill-action-btn"
            data-probe-profile="${escapeAttrHtml(p.id)}"
            data-probe-provider="${escapeAttrHtml(p.provider || "")}"
            ${isProbing ? "disabled" : ""}
            title="手动测通该实例"
          >${isProbing ? "…" : "测通"}</button>
          ${(showDisableToggle || meta.status === "disabled") ? `
            <button
              type="button"
              class="profile-pill-action-btn ${meta.status === "disabled" ? "is-enable" : "is-disable"}"
              data-toggle-disable-profile="${escapeAttrHtml(p.id)}"
              data-profile-provider="${escapeAttrHtml(p.provider || "")}"
              data-next-disabled="${meta.status === "disabled" ? "0" : "1"}"
              title="${meta.status === "disabled" ? "重新启用该实例" : "停用该实例（不再作为默认首选项）"}"
            >${meta.status === "disabled" ? "启用" : "停用"}</button>
          ` : ""}
        </div>
      </div>
    `;
  }).join("");

  if (allowManageButton && canManageProvider) {
    return `${cardsHtml}<button type="button" class="profile-pill-add-btn" data-open-instance-modal="${escapeAttrHtml(resolvedProvider)}" title="新建或管理多开独立实例">${iconSvg("plus", { size: 11 })}<span>多开</span></button>`;
  }
  return cardsHtml;
}

export function renderInstanceManagerListHtml(profiles = [], {
  provider = "codex",
  probingKeys = new Set(),
} = {}) {
  const cleanProvider = String(provider || "codex").trim().toLowerCase();
  const list = sortProfilesByAvailability(filterProfilesByProvider(profiles, cleanProvider));
  if (!list.length) {
    return `<div class="empty-state">暂未发现 ${escapeAttrHtml(providerDisplayName(cleanProvider))} 实例，可在上方创建新的独立多开实例。</div>`;
  }
  const showDisableToggle = list.length >= 2;
  return list.map((p) => {
    const meta = profileHealthVisualMeta(p);
    const key = p.key || `${p.provider}:${p.id}`;
    const isProbing = probingKeys?.has?.(key) || probingKeys?.has?.(`${p.provider}:*`);
    const displayName = compactProfileDisplayLabel(p.label || p.id || "默认", p.provider);
    const hint = formatProfileIdentityHint(p);
    const quotaSummary = String(p.quota?.summaryText || "").trim();
    const subParts = [hint, meta.badgeText];
    if (quotaSummary && quotaSummary !== meta.badgeText) subParts.push(quotaSummary);
    const subText = subParts.filter(Boolean).join(" · ");
    const sourceBadge = p.managed ? "托管多开" : "本机发现";
    const dirText = String(p.cliConfigDir || p.home || "");

    const codexActions = cleanProvider === "codex"
      ? `
        <button
          type="button"
          class="btn-secondary btn-xs is-primary-outline"
          data-login-profile="${escapeAttrHtml(p.id)}"
          data-login-provider="codex"
          data-login-mode="oauth"
          title="拉起独立浏览器 OAuth 登录，完成后自动由 Agent Control 接管"
        >${p.needsLogin ? "浏览器登录" : "换绑账号"}</button>
        <button
          type="button"
          class="btn-secondary btn-xs"
          data-login-profile="${escapeAttrHtml(p.id)}"
          data-login-provider="codex"
          data-login-mode="app"
          title="使用该独立实例目录打开 Codex 桌面端，登录或查看后可随时关闭"
        >开客户端</button>
      `
      : "";

    const claudeActions = cleanProvider === "claude"
      ? `
        <button
          type="button"
          class="btn-secondary btn-xs is-primary-outline"
          data-login-profile="${escapeAttrHtml(p.id)}"
          data-login-provider="claude"
          data-login-mode="terminal"
          title="打开终端以独立目录执行 claude auth login"
        >终端登录</button>
        ${p.loginCommand ? `
          <button
            type="button"
            class="btn-secondary btn-xs"
            data-copy-login-cmd="${escapeAttrHtml(p.loginCommand)}"
            title="复制独立终端登录命令"
          >复制命令</button>
        ` : ""}
      `
      : "";

    return `
      <div class="instance-mgr-card ${meta.dotClass}${isProbing ? " is-probing" : ""}" data-profile-key="${escapeAttrHtml(key)}">
        <div class="instance-mgr-main">
          <div class="instance-mgr-head">
            <span class="profile-status-dot ${meta.dotClass}" aria-hidden="true"></span>
            <strong class="instance-mgr-name">${escapeAttrHtml(displayName)}</strong>
            <span class="instance-mgr-badge${p.managed ? " is-managed" : ""}">${sourceBadge}</span>
          </div>
          <div class="instance-mgr-meta">${escapeAttrHtml(subText || "已就绪")}</div>
          ${dirText ? `<div class="instance-mgr-path" title="${escapeAttrHtml(dirText)}">${escapeAttrHtml(dirText)}</div>` : ""}
        </div>
        <div class="instance-mgr-actions">
          ${codexActions}
          ${claudeActions}
          <button
            type="button"
            class="btn-secondary btn-xs"
            data-probe-profile="${escapeAttrHtml(p.id)}"
            data-probe-provider="${escapeAttrHtml(p.provider || "")}"
            ${isProbing ? "disabled" : ""}
          >${isProbing ? "测通中…" : "测通"}</button>
          ${(showDisableToggle || meta.status === "disabled") ? `
            <button
              type="button"
              class="btn-secondary btn-xs"
              data-toggle-disable-profile="${escapeAttrHtml(p.id)}"
              data-profile-provider="${escapeAttrHtml(p.provider || "")}"
              data-next-disabled="${meta.status === "disabled" ? "0" : "1"}"
            >${meta.status === "disabled" ? "启用" : "停用"}</button>
          ` : ""}
          ${p.managed ? `
            <button
              type="button"
              class="btn-secondary btn-xs is-danger-outline"
              data-delete-profile="${escapeAttrHtml(p.id)}"
              data-profile-provider="${escapeAttrHtml(p.provider || "")}"
              title="从托管多开列表移除（保留本地目录文件）"
            >移除</button>
          ` : ""}
        </div>
      </div>
    `;
  }).join("");
}

export function filterProfilesByProvider(profiles = [], provider = "all") {
  if (!provider || provider === "all") return profiles;
  return profiles.filter((p) => p.provider === provider);
}

const NEW_THREAD_PROVIDER_ORDER = ["antigravity", "codex", "claude", "grok", "qoder"];

export function renderProviderPillsHtml({
  selectedProvider = "antigravity",
  profiles = [],
  providerOrder = NEW_THREAD_PROVIDER_ORDER,
} = {}) {
  const cleanSelected = String(selectedProvider || "antigravity").trim().toLowerCase();
  return (Array.isArray(providerOrder) ? providerOrder : NEW_THREAD_PROVIDER_ORDER).map((provider) => {
    const visual = providerVisualMeta(provider);
    const list = sortProfilesByAvailability(filterProfilesByProvider(profiles, provider));
    const best = pickBestAvailableProfile(list);
    const healthMeta = best ? profileHealthVisualMeta(best) : { dotClass: "is-unknown", badgeText: "未配置" };
    const isSelected = provider === cleanSelected;
    return `
      <button
        type="button"
        class="provider-pill-btn${isSelected ? " is-selected" : ""}"
        data-select-provider="${escapeAttrHtml(provider)}"
        role="radio"
        aria-checked="${isSelected ? "true" : "false"}"
        title="${escapeAttrHtml(`${visual.label}${best ? ` · ${healthMeta.badgeText}` : ""}`)}"
      >
        <span class="provider-pill-icon" aria-hidden="true">${visual.iconSvg || ""}</span>
        <span class="provider-pill-label">${escapeAttrHtml(visual.label)}</span>
        <span class="profile-status-dot ${healthMeta.dotClass}" aria-hidden="true"></span>
      </button>
    `;
  }).join("");
}

export function ensurePreferredModelInList(models = [], provider = "", preferredModel = "") {
  const list = Array.isArray(models) ? [...models] : [];
  const cleanPreferred = String(preferredModel || "").trim();
  if (!cleanPreferred) return list;
  if (list.some((m) => m?.id === cleanPreferred || m?.model === cleanPreferred)) {
    return list;
  }
  if (provider === "antigravity") {
    const { baseModel } = resolveAntigravityModelSelection(cleanPreferred);
    if (baseModel && list.some((m) => m?.id === baseModel || m?.model === baseModel || m?.baseModel === baseModel)) {
      return list;
    }
  }
  if (provider === "claude" && !/^claude-/i.test(cleanPreferred)) return list;
  if (provider === "codex" && /^(claude-|gemini-|grok-)/i.test(cleanPreferred)) return list;
  if (provider === "antigravity" && /^(gpt-|grok-)/i.test(cleanPreferred)) return list;
  if (provider === "grok" && !/^grok-/i.test(cleanPreferred)) return list;
  return [
    {
      id: cleanPreferred,
      model: cleanPreferred,
      displayName: cleanPreferred,
      section: "main",
      provider: provider || "",
      isDefault: false,
      defaultReasoningEffort: "medium",
      supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max"],
    },
    ...list,
  ];
}

export function pickDefaultModelForProvider(models = [], provider = "", preferredModel = "") {
  const scoped = provider ? models.filter((m) => m.provider === provider) : models;
  if (!scoped.length) return null;
  if (preferredModel) {
    const exact = scoped.find((m) => m.id === preferredModel || m.model === preferredModel);
    if (exact) return exact;
    if (provider === "antigravity") {
      const { baseModel } = resolveAntigravityModelSelection(preferredModel);
      if (baseModel) {
        const mapped = scoped.find((m) => m.id === baseModel || m.model === baseModel || m?.baseModel === baseModel);
        if (mapped) return mapped;
      }
    }
  }
  return scoped.find((m) => m.isDefault) || scoped[0];
}

export function formatQuotaResetDateCompact(resetsAtSec, nowSec = Math.floor(Date.now() / 1000)) {
  const target = Number(resetsAtSec);
  const now = Number(nowSec);
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(now)) return "";
  if (Math.floor(target - now) <= 0) return "";
  const d = new Date(target * 1000);
  const n = new Date(now * 1000);
  const pad2 = (v) => String(v).padStart(2, "0");
  const sameDay = d.getFullYear() === n.getFullYear()
    && d.getMonth() === n.getMonth()
    && d.getDate() === n.getDate();
  if (sameDay) {
    return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  return `${d.getMonth() + 1}/${pad2(d.getDate())}`;
}

export function formatQuotaResetRelative(resetsAtSec, nowSec = Math.floor(Date.now() / 1000)) {
  const target = Number(resetsAtSec);
  const now = Number(nowSec);
  if (!Number.isFinite(target) || target <= 0 || !Number.isFinite(now)) return "";
  const diffSec = Math.floor(target - now);
  if (diffSec <= 0) return "";
  const mins = Math.ceil(diffSec / 60);
  if (mins < 60) return `${Math.max(1, mins)}分后重置`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) {
    const remMins = mins % 60;
    return remMins >= 15 ? `${hours}小时${remMins}分后重置` : `${hours}小时后重置`;
  }
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}天${remHours}小时后重置` : `${days}天后重置`;
}

export function hasElapsedQuotaReset(profiles = [], nowSec = Math.floor(Date.now() / 1000)) {
  const safeNow = Number(nowSec);
  if (!Number.isFinite(safeNow) || safeNow <= 0) return false;
  for (const p of Array.isArray(profiles) ? profiles : []) {
    const q = p?.quota;
    if (!q || typeof q !== "object") continue;
    const w = q.windows && typeof q.windows === "object" ? q.windows : {};
    const candidates = [
      w.fiveHour,
      w.weekly,
      w.thirdPartyFiveHour,
      w.thirdPartyWeekly,
      ...(Array.isArray(q.buckets) ? q.buckets : []),
    ];
    for (const bucket of candidates) {
      const resetSec = normalizeResetSec(bucket?.resetsAt);
      if (resetSec !== null && resetSec <= safeNow) {
        return true;
      }
    }
  }
  return false;
}

function shortQuotaProfileLabel(profile) {
  const raw = String(profile?.label || profile?.id || "").trim();
  const provider = String(profile?.provider || "").trim();
  const cleaned = raw
    .replace(/^(Antigravity|Codex|Claude\s*Code|Claude|Grok)\s*[·:/\-]?\s*/i, "")
    .trim();
  if (!cleaned || /^(默认|default)$/i.test(cleaned)) {
    return providerVisualMeta(provider).short;
  }
  const metaShort = providerVisualMeta(provider).short;
  if (provider === "antigravity") {
    return `${metaShort} ${abbreviateMiddleText(cleaned, { head: 3, tail: 3, maxLen: 8 })}`;
  }
  return abbreviateMiddleText(cleaned, { head: 3, tail: 3, maxLen: 8 });
}

export function renderQuotaOverviewHtml(profiles = [], {
  providerFilter = "all",
  expanded = false,
  refreshing = false,
  nowSec = Math.floor(Date.now() / 1000),
} = {}) {
  const installed = (Array.isArray(profiles) ? profiles : []).filter((p) => p && p.installed !== false);
  if (!installed.length) return "";

  const authedProviders = new Set(
    installed.filter((p) => p.authenticated !== false && !p.health?.disabled).map((p) => p.provider),
  );

  let visible = installed;
  if (providerFilter && providerFilter !== "all") {
    const matching = visible.filter((p) => p.provider === providerFilter);
    if (matching.length) visible = matching;
  }
  if (!expanded) {
    const compactFiltered = visible.filter((p) => (
      !p.health?.disabled
      && (p.authenticated !== false || !authedProviders.has(p.provider))
    ));
    if (compactFiltered.length) visible = compactFiltered;
  }

  const chipsHtml = visible.map((p) => {
    const visual = providerVisualMeta(p.provider);
    const q = p.quota || null;
    const tone = q?.statusTone || (p.authenticated === false ? "unknown" : "unknown");
    const pct = q?.primary?.remainingPercent;
    const hasPct = typeof pct === "number" && Number.isFinite(pct);
    const summaryText = q?.summaryText || (p.authenticated === false ? "仅历史" : "待测");
    const shortName = shortQuotaProfileLabel(p);
    const resetText = formatQuotaResetRelative(q?.primary?.resetsAt, nowSec);
    const tipParts = [p.label || p.id, q?.planLabel, q?.accountLabel, summaryText, resetText].filter(Boolean);

    return `
      <button
        type="button"
        class="quota-chip tone-${escapeAttrHtml(tone)}"
        data-quota-filter-provider="${escapeAttrHtml(p.provider || "")}"
        data-quota-profile-id="${escapeAttrHtml(p.id || "")}"
        title="${escapeAttrHtml(tipParts.join(" · "))}"
      >
        <span class="quota-chip-top">
          <span class="quota-chip-provider is-${escapeAttrHtml(visual.tone)}">${providerIconSvg(p.provider, { size: 12 })} ${escapeAttrHtml(shortName)}</span>
          <span class="quota-chip-val tone-${escapeAttrHtml(tone)}">${escapeAttrHtml(summaryText)}</span>
        </span>
        <span class="quota-mini-bar" aria-hidden="true">
          <span class="quota-mini-fill tone-${escapeAttrHtml(tone)}" style="width:${hasPct ? Math.max(0, Math.min(100, Math.round(pct))) : (tone === "ok" ? 100 : (tone === "exhausted" ? 0 : 35))}%"></span>
        </span>
      </button>
    `;
  }).join("");

  let detailHtml = "";
  if (expanded) {
    const cardsHtml = visible.map((p) => {
      const visual = providerVisualMeta(p.provider);
      const q = p.quota || {};
      const tone = q.statusTone || "unknown";
      const planLabel = String(q.planLabel || "").trim();
      const rawAccountLabel = String(q.accountLabel || "").trim();
      const accountLabel = rawAccountLabel ? abbreviateMiddleText(rawAccountLabel, { head: 4, tail: 3, maxLen: 9 }) : "";
      const buckets = Array.isArray(q.buckets) && q.buckets.length
        ? q.buckets
        : (q.primary ? [q.primary] : []);

      const bucketsHtml = buckets.map((b) => {
        const bRem = b?.remainingPercent;
        const hasBRem = typeof bRem === "number" && Number.isFinite(bRem);
        const bTone = hasBRem
          ? (bRem <= 0 ? "exhausted" : (bRem <= 20 ? "warn" : "ok"))
          : tone;
        const resetStr = formatQuotaResetRelative(b?.resetsAt, nowSec);
        const valueLabel = hasBRem ? `${Math.round(bRem)}%` : (b?.detail || q.summaryText || "正常");
        const metaLine = [hasBRem ? b?.detail : "", resetStr].filter(Boolean).join(" · ");

        return `
          <div class="quota-bucket-row">
            <div class="quota-bucket-head">
              <span class="quota-bucket-label">${escapeAttrHtml(b?.label || "配额")}</span>
              <span class="quota-bucket-val tone-${escapeAttrHtml(bTone)}">${escapeAttrHtml(valueLabel)}</span>
            </div>
            ${hasBRem ? `
              <div class="quota-mini-bar is-detail" aria-hidden="true">
                <span class="quota-mini-fill tone-${escapeAttrHtml(bTone)}" style="width:${Math.max(0, Math.min(100, Math.round(bRem)))}%"></span>
              </div>
            ` : ""}
            ${metaLine ? `<div class="quota-bucket-meta">${escapeAttrHtml(metaLine)}</div>` : ""}
          </div>
        `;
      }).join("");

      const creditsText = q.credits?.balance !== null && q.credits?.balance !== undefined
        ? `积分 ${escapeAttrHtml(String(q.credits.balance))}`
        : "";

      return `
        <div class="quota-detail-card tone-${escapeAttrHtml(tone)}">
          <div class="quota-detail-card-head">
            <span class="quota-detail-title">
              <span class="is-${escapeAttrHtml(visual.tone)}">${providerIconSvg(p.provider, { size: 13 })}</span>
              <strong>${escapeAttrHtml(compactProfileDisplayLabel(p.label || p.id, p.provider))}</strong>
              ${planLabel ? `<span class="quota-plan-pill">${escapeAttrHtml(planLabel)}</span>` : ""}
              ${creditsText ? `<span class="quota-plan-pill is-credits">${creditsText}</span>` : ""}
            </span>
            <span class="quota-detail-summary tone-${escapeAttrHtml(tone)}">${escapeAttrHtml(q.summaryText || "待测")}</span>
          </div>
          ${accountLabel ? `<div class="quota-detail-account">${escapeAttrHtml(accountLabel)}</div>` : ""}
          ${bucketsHtml ? `<div class="quota-bucket-list">${bucketsHtml}</div>` : ""}
        </div>
      `;
    }).join("");

    detailHtml = `<div class="quota-detail-list">${cardsHtml}</div>`;
  }

  return `
    <div class="quota-strip-head">
      <button
        type="button"
        class="quota-strip-toggle"
        data-quota-toggle="1"
        aria-expanded="${expanded ? "true" : "false"}"
        title="${expanded ? "收起各智能体额度明细" : "展开查看所有智能体额度与重置时间"}"
      >
        <span class="quota-strip-title">可用额度</span>
        <span class="quota-strip-count">${visible.length}</span>
        <span class="quota-strip-caret" aria-hidden="true">${expanded ? iconSvg("chevron-down", { size: 11 }) : iconSvg("chevron-up", { size: 11 })}</span>
      </button>
      <button
        type="button"
        class="quota-refresh-btn${refreshing ? " is-spinning" : ""}"
        data-quota-refresh="1"
        ${refreshing ? "disabled" : ""}
        title="刷新各智能体额度"
        aria-label="刷新各智能体额度"
      >${iconSvg("refresh", { size: 12 })}</button>
    </div>
    <div class="quota-chip-row">${chipsHtml}</div>
    ${detailHtml}
  `;
}
