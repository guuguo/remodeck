import { spawn } from "node:child_process";
import os from "node:os";
import { createInterface } from "node:readline";
import { claudeEnvironment, claudeExecutable, readClaudeCliAuthStatus } from "./providers/claude-runner.mjs";
import { resolveProviderExecutables } from "./providers/profile-discovery.mjs";
import { prepareCrossPlatformSpawn, killProcessTreeCrossPlatform } from "./platform.mjs";

const KNOWN_DOMAIN_DISPLAY = Object.freeze({
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

export function formatDomainDisplayAlias(email = "") {
  const clean = String(email || "").trim().toLowerCase();
  const atIdx = clean.indexOf("@");
  if (atIdx < 0) return "";
  const host = clean.slice(atIdx + 1).trim();
  if (!host) return "";
  const firstLabel = host.split(".")[0] || host;
  if (KNOWN_DOMAIN_DISPLAY[firstLabel]) {
    return KNOWN_DOMAIN_DISPLAY[firstLabel];
  }
  return firstLabel.slice(0, 10);
}

function baseShortProfileName(profile = {}) {
  const alias = String(profile?.health?.alias || "").trim();
  if (alias) return alias;
  const provider = String(profile?.provider || "").trim().toLowerCase();
  const label = String(profile?.label || "").trim();
  const stripped = label
    .replace(/^(Codex|Claude\s*Code|Claude|Antigravity|Grok)\s*[·:/\-]?\s*/i, "")
    .trim();
  const isGeneric = !stripped
    || (provider && stripped.toLowerCase() === provider)
    || /^(默认|default)$/i.test(stripped);
  if (!isGeneric) return stripped;
  if (profile.id === "desktop") return "桌面";
  if (profile.id === "cli") return "CLI";
  const email = String(profile?.account?.email || "").trim();
  if (email) {
    const atIdx = email.indexOf("@");
    const handle = (atIdx > 0 ? email.slice(0, atIdx) : email).trim();
    if (handle) return handle;
  }
  const ep = String(profile?.endpointLabel || "").trim();
  if (ep) return ep.split(".")[0] || ep;
  return String(profile?.id || "默认").trim() || "默认";
}

export function computeMultiProfileSignature(profiles = []) {
  const sigBody = (Array.isArray(profiles) ? profiles : [])
    .filter((p) => p && p.installed !== false)
    .map((p) => [
      p.key || `${p.provider}:${p.id}`,
      String(p.account?.email || "").toLowerCase(),
      String(p.endpointLabel || "").toLowerCase(),
      String(p.label || ""),
    ].join("|"))
    .sort()
    .join(";");
  return sigBody ? `v2:${sigBody}` : "";
}

export function isAutoAliasUpgradeCandidate(profile = {}, sig = "") {
  const alias = String(profile?.health?.alias || "").trim();
  if (!alias) return true;
  const source = String(profile?.health?.autoAliasSource || "").trim();
  if (!["ai", "fallback", "checked"].includes(source)) return false;
  return Boolean(sig && profile?.health?.autoAliasSignature !== sig);
}

export function extractReadableOwnerHandle(email = "") {
  const clean = String(email || "").trim();
  const atIdx = clean.indexOf("@");
  const rawLocal = (atIdx > 0 ? clean.slice(0, atIdx) : clean).trim();
  if (!rawLocal) return "";
  // 去掉类似姓名缩写后跟着的出生年份/长串数字后缀（如 carol1990 -> carol）
  const alphaLead = rawLocal.match(/^([a-zA-Z][a-zA-Z._-]{1,10}?)\d{4,}$/);
  if (alphaLead && alphaLead[1]) {
    return alphaLead[1].replace(/[._-]+$/g, "") || rawLocal;
  }
  return rawLocal;
}

function compactOwnerPrefix(owner = "", maxLen = 6) {
  const clean = String(owner || "").trim();
  if (!clean) return "";
  if (clean.length <= maxLen) return clean;
  if (/^\d+$/.test(clean)) return clean.slice(-4);
  return clean.slice(0, maxLen);
}

export function suggestFallbackDistinctAliases(profiles = []) {
  const list = (Array.isArray(profiles) ? profiles : []).filter((p) => p && p.installed !== false);
  if (list.length < 2) return {};

  const usedLower = new Set(
    list
      .map((p) => String(p?.health?.alias || "").trim().toLowerCase())
      .filter(Boolean),
  );
  const baseCounts = new Map();
  const ownerCounts = new Map();
  for (const p of list) {
    const base = baseShortProfileName(p).toLowerCase();
    baseCounts.set(base, (baseCounts.get(base) || 0) + 1);
    const owner = extractReadableOwnerHandle(p.account?.email || "").toLowerCase();
    if (owner) {
      ownerCounts.set(owner, (ownerCounts.get(owner) || 0) + 1);
    }
  }

  const assigned = {};
  for (const p of list) {
    const key = p.key || `${p.provider}:${p.id}`;
    if (String(p?.health?.alias || "").trim()) continue;
    const base = baseShortProfileName(p);
    const email = String(p.account?.email || "").trim();
    const rawOwner = extractReadableOwnerHandle(email);
    const domainAlias = formatDomainDisplayAlias(email);
    const ownerCollision = rawOwner ? (ownerCounts.get(rawOwner.toLowerCase()) || 0) > 1 : false;
    const hasDistinctOwner = Boolean(rawOwner && !ownerCollision);
    const baseCollision = (baseCounts.get(base.toLowerCase()) || 0) > 1 || /^(默认|default)$/i.test(base);
    if (!baseCollision && !hasDistinctOwner) continue;

    const ep = String(p.endpointLabel || "").trim();
    const epShort = ep ? (ep.split(".")[0] || ep).slice(0, 10) : "";
    const idShort = (p.id && !/^(default|默认)$/i.test(p.id))
      ? (p.id === "desktop" ? "桌面" : p.id === "cli" ? "CLI" : String(p.id).slice(0, 10))
      : "";

    const candidates = [];
    if (hasDistinctOwner) {
      const ownerShort = compactOwnerPrefix(rawOwner, domainAlias ? 6 : 10);
      if (domainAlias) {
        candidates.push(`${ownerShort}·${domainAlias}`.slice(0, 12));
      }
      candidates.push(ownerShort);
    }
    if (!email && /^(default|默认)$/i.test(String(p.id || ""))) {
      candidates.push("默认");
    }
    if (domainAlias) {
      candidates.push(domainAlias);
      if (idShort && domainAlias.toLowerCase() !== idShort.toLowerCase()) {
        candidates.push(`${domainAlias}·${idShort}`);
      }
    }
    if (epShort) candidates.push(epShort);
    if (idShort) candidates.push(idShort);
    candidates.push(`${base}·${idShort || "副"}`);

    let chosen = "";
    for (const cand of candidates) {
      const clean = String(cand).trim().slice(0, 12);
      if (clean && !usedLower.has(clean.toLowerCase())) {
        chosen = clean;
        break;
      }
    }
    if (!chosen) {
      let idx = 2;
      while (usedLower.has(`${base}${idx}`.toLowerCase())) idx += 1;
      chosen = `${base}${idx}`.slice(0, 12);
    }
    usedLower.add(chosen.toLowerCase());
    assigned[key] = chosen;
  }
  return assigned;
}

export function buildLightweightAliasPrompt(providerId, profiles = []) {
  const rows = (Array.isArray(profiles) ? profiles : [])
    .filter((p) => p && p.installed !== false)
    .map((p) => ({
      key: p.key || `${providerId}:${p.id}`,
      id: p.id || "",
      label: p.label || "",
      email: p.account?.email || "",
      endpoint: p.endpointLabel || "",
      existingAlias: p.health?.alias || "",
    }));

  return [
    `智能体 ${providerId} 有多个账号/实例。请仅为 existingAlias 为空的实例各取一个 2~10 个字符且互不重复的简称，方便在窄侧边栏一眼区分归属。`,
    "严格按以下优先级命名：",
    "1. 不同账号拥有者优先（邮箱 @ 前缀不同，如 alice@qq.com 与 carol1990@163.com 属于两个人）：必须以账号名/用户名为核心（可省略结尾长串数字年份，如 carol1990 -> carol），并可带简短平台后缀，例如 alice·QQ、carol·163。严禁只写 QQ 或 163 而丢掉拥有者。",
    "2. 同一拥有者不同邮箱（邮箱 @ 前缀相同，如 bob@icloud.com 与 bob@hotmail.com）：用邮箱服务商区分，保留常用标准名称（如 iCloud、Hotmail、Gmail、Outlook），禁止将品牌生硬直译（如禁止把 Hotmail 译成“热邮”）。",
    "3. 未绑定邮箱的本地默认实例（如 id=default 且无 email）：可直接命名为“默认”，不要生成“default·副”。",
    "严格只输出一个 JSON 对象，key 为实例 key，value 为简称，不要输出任何额外解释或 markdown 代码块：",
    JSON.stringify(rows),
  ].join("\n");
}

export function parseLightweightAliasResponse(rawText = "", allowedKeys = []) {
  const allowed = new Set(allowedKeys);
  const cleanText = String(rawText || "").trim();
  if (!cleanText) return {};

  const jsonMatch = cleanText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return {};
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

  const out = {};
  const seenLower = new Set();
  for (const [k, v] of Object.entries(parsed)) {
    if (!allowed.has(k)) continue;
    const alias = String(v || "")
      .replace(/[\r\n\t]+/g, " ")
      .replace(/[<>"'`]/g, "")
      .trim()
      .slice(0, 12);
    if (!alias || seenLower.has(alias.toLowerCase())) continue;
    seenLower.add(alias.toLowerCase());
    out[k] = alias;
  }
  return out;
}

function isTestRuntime(env = process.env) {
  return Boolean(
    env?.NODE_ENV === "test"
    || env?.NODE_TEST_CONTEXT
    || process.env?.NODE_TEST_CONTEXT
    || process.execArgv?.some((arg) => arg.includes("--test")),
  );
}

async function runClaudeEphemeralPrompt(prompt, { configDir = "", env = process.env, spawnImpl = spawn, timeoutMs = 15_000 } = {}) {
  const args = [
    "-p",
    "--no-session-persistence",
    "--model",
    "claude-haiku-4-5",
    "--output-format",
    "text",
    prompt,
  ];
  const prepared = prepareCrossPlatformSpawn(
    claudeExecutable(env),
    args,
    {
      cwd: os.tmpdir(),
      env: claudeEnvironment(env, configDir, { platform: process.platform }),
      stdio: ["ignore", "pipe", "pipe"],
    },
    { platform: process.platform },
  );
  const proc = spawnImpl(prepared.command, prepared.args, prepared.options);
  return new Promise((resolveRun, rejectRun) => {
    let settled = false;
    let out = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTreeCrossPlatform(proc, { signal: "SIGTERM", platform: process.platform });
      rejectRun(new Error("claude lightweight alias timeout"));
    }, timeoutMs);
    timer.unref?.();

    proc.stdout?.on("data", (chunk) => {
      if (out.length < 16_384) out += String(chunk);
    });
    proc.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRun(err);
    });
    proc.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 && out.trim()) resolveRun(out.trim());
      else rejectRun(new Error(`claude lightweight alias exited ${code}`));
    });
  });
}

async function runCodexEphemeralPrompt(prompt, { codexHome = "", env = process.env, spawnImpl = spawn, timeoutMs = 15_000 } = {}) {
  const args = [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "--json",
    prompt,
  ];
  const nextEnv = { ...env };
  if (codexHome) nextEnv.CODEX_HOME = codexHome;
  const codexCmd = resolveProviderExecutables(nextEnv)?.codex || nextEnv.CODEX_BIN || "codex";
  const prepared = prepareCrossPlatformSpawn(
    codexCmd,
    args,
    {
      cwd: os.tmpdir(),
      env: nextEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
    { platform: process.platform },
  );
  const proc = spawnImpl(prepared.command, prepared.args, prepared.options);
  return new Promise((resolveRun, rejectRun) => {
    let settled = false;
    let lastAgentText = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTreeCrossPlatform(proc, { signal: "SIGTERM", platform: process.platform });
      rejectRun(new Error("codex lightweight alias timeout"));
    }, timeoutMs);
    timer.unref?.();

    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      try {
        const evt = JSON.parse(line);
        if (evt?.type === "item.completed" && evt?.item?.type === "agent_message" && evt?.item?.text) {
          lastAgentText = String(evt.item.text);
        }
      } catch {}
    });
    proc.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRun(err);
    });
    proc.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0 && lastAgentText.trim()) resolveRun(lastAgentText.trim());
      else rejectRun(new Error(`codex lightweight alias exited ${code}`));
    });
  });
}

export async function runDefaultLightweightAliasAi({
  providerId,
  profiles = [],
  allProfiles = [],
  env = process.env,
  spawnImpl = spawn,
  timeoutMs = 15_000,
} = {}) {
  if (isTestRuntime(env)) return null;
  const prompt = buildLightweightAliasPrompt(providerId, profiles);
  const pool = Array.isArray(allProfiles) && allProfiles.length ? allProfiles : profiles;

  const claudeCandidates = pool.filter((p) => p?.provider === "claude" && p.installed !== false && !p.health?.disabled);
  for (const cp of claudeCandidates) {
    const configDir = cp.home || "";
    const auth = await readClaudeCliAuthStatus({ configDir, env, spawnImpl, timeoutMs: 2_500 }).catch(() => ({ loggedIn: false }));
    if (auth.loggedIn || cp.endpointLabel) {
      try {
        return await runClaudeEphemeralPrompt(prompt, { configDir, env, spawnImpl, timeoutMs });
      } catch {}
    }
  }

  const codexCandidates = pool.filter(
    (p) => p?.provider === "codex" && p.installed !== false && !p.health?.disabled && p.authenticated !== false,
  );
  for (const xp of codexCandidates) {
    try {
      return await runCodexEphemeralPrompt(prompt, { codexHome: xp.home || "", env, spawnImpl, timeoutMs });
    } catch {}
  }

  return null;
}

export async function resolveAutoProfileAliases({
  providerId,
  profiles = [],
  allProfiles = [],
  env = process.env,
  callLightweightAi = null,
  timeoutMs = 15_000,
} = {}) {
  const installed = (Array.isArray(profiles) ? profiles : []).filter((p) => p && p.installed !== false && !p.health?.disabled);
  if (installed.length < 2) return { aliases: {}, source: "none" };

  const sig = computeMultiProfileSignature(installed);
  const unnamed = installed.filter((p) => isAutoAliasUpgradeCandidate(p, sig));
  if (!unnamed.length) return { aliases: {}, source: "none" };

  const unnamedSet = new Set(unnamed.map((p) => p.key || `${providerId}:${p.id}`));
  const unnamedKeys = Array.from(unnamedSet);
  const promptProfiles = installed.map((p) => (
    unnamedSet.has(p.key || `${providerId}:${p.id}`)
      ? { ...p, health: { ...(p.health || {}), alias: "" } }
      : p
  ));
  const existingLower = new Set(
    installed
      .filter((p) => !unnamedSet.has(p.key || `${providerId}:${p.id}`))
      .map((p) => String(p?.health?.alias || "").trim().toLowerCase())
      .filter(Boolean),
  );

  try {
    const runner = typeof callLightweightAi === "function" ? callLightweightAi : runDefaultLightweightAliasAi;
    const raw = await runner({ providerId, profiles: promptProfiles, allProfiles, env, timeoutMs });
    if (raw) {
      const parsed = typeof raw === "string"
        ? parseLightweightAliasResponse(raw, unnamedKeys)
        : raw;
      const valid = {};
      const seen = new Set(existingLower);
      for (const k of unnamedKeys) {
        const val = String(parsed?.[k] || "").trim().slice(0, 12);
        if (val && !seen.has(val.toLowerCase())) {
          seen.add(val.toLowerCase());
          valid[k] = val;
        }
      }
      if (Object.keys(valid).length === unnamedKeys.length) {
        return { aliases: valid, source: "ai" };
      }
    }
  } catch {}

  const fallback = suggestFallbackDistinctAliases(promptProfiles);
  return {
    aliases: fallback,
    source: Object.keys(fallback).length ? "fallback" : "none",
  };
}
