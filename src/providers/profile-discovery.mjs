import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, readdir, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import { basename, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import { readManagedProfiles } from "../managed-profiles.mjs";
import {
  normalizePlatform,
  providerCandidatePaths,
  resolveExecutableCrossPlatform,
  resolveUserHome,
} from "../platform.mjs";

const execFileAsync = promisify(execFile);

export function extractPublicEndpointHost(rawUrl) {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).host || "";
  } catch {
    return "";
  }
}

export async function readCodexPublicEndpoint(codexHome) {
  const empty = { modelProvider: "", endpointHost: "", endpointLabel: "" };
  if (!codexHome) return empty;
  const configText = await readFile(resolve(codexHome, "config.toml"), "utf8").catch(() => "");
  if (!configText) {
    const hasAuth = await pathExists(resolve(codexHome, "auth.json"));
    return hasAuth ? { modelProvider: "openai", endpointHost: "", endpointLabel: "官方" } : empty;
  }

  let currentSection = "";
  let topModelProvider = "";
  let topBaseUrl = "";
  let anyBaseUrl = "";
  const sectionBaseUrls = new Map();

  for (const rawLine of configText.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const secMatch = line.match(/^\[([^\]]+)\]$/);
    if (secMatch) {
      currentSection = secMatch[1].trim();
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_.-]+)\s*=\s*["']([^"']+)["']/);
    if (!kvMatch) continue;
    const [, key, val] = kvMatch;
    if (!currentSection && key === "model_provider") {
      topModelProvider = val.trim();
    } else if (key === "base_url" || key === "openai_base_url") {
      if (!anyBaseUrl) anyBaseUrl = val.trim();
      if (!currentSection) {
        topBaseUrl = val.trim();
      } else {
        sectionBaseUrls.set(currentSection, val.trim());
      }
    }
  }

  const targetSectionUrl = topModelProvider ? sectionBaseUrls.get(`model_providers.${topModelProvider}`) : "";
  const chosenUrl = targetSectionUrl || topBaseUrl || anyBaseUrl;
  const endpointHost = extractPublicEndpointHost(chosenUrl);
  let endpointLabel = endpointHost;
  if (!endpointLabel) {
    if (topModelProvider && topModelProvider.toLowerCase() !== "openai") {
      endpointLabel = topModelProvider;
    } else if (await pathExists(resolve(codexHome, "auth.json"))) {
      endpointLabel = "官方";
    }
  }
  return {
    modelProvider: topModelProvider,
    endpointHost,
    endpointLabel,
  };
}

export async function readClaudePublicEndpoint(configDir) {
  const candidates = [
    resolve(configDir, "settings.json"),
    resolve(configDir, "settings.local.json"),
  ];
  for (const filePath of candidates) {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8"));
      const baseUrl = parsed?.env?.ANTHROPIC_BASE_URL || "";
      const host = extractPublicEndpointHost(baseUrl);
      if (host) {
        return { endpointHost: host, endpointLabel: host };
      }
    } catch {
      // Ignore missing or invalid settings file.
    }
  }
  return { endpointHost: "", endpointLabel: "" };
}

async function pathExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveExecutable({
  envVar = "",
  candidates = [],
  binaryName = "",
  env = process.env,
  platform = process.platform,
} = {}) {
  const explicit = envVar ? String(env?.[envVar] || "").trim() : "";
  if (explicit) {
    const resolvedExplicit = resolveExecutableCrossPlatform({
      envVar,
      candidates: [],
      binaryName: "",
      env,
      platform,
      strictExplicit: true,
    });
    return resolvedExplicit || explicit;
  }
  return resolveExecutableCrossPlatform({
    envVar: "",
    candidates,
    binaryName,
    env,
    platform,
  }) || binaryName;
}

function slugProfileId(value, fallback = "custom") {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^\.+/, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || fallback;
}

async function parseProfileOverride(rawValue, defaultPrefix = "custom") {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) return null;
  let items = [];
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    items = parsed.map((item, index) => {
      if (typeof item === "string") {
        const home = resolve(item);
        return {
          id: index === 0 ? "default" : slugProfileId(basename(home), `${defaultPrefix}-${index}`),
          label: index === 0 ? "默认" : basename(home),
          home,
        };
      }
      return {
        id: slugProfileId(item.id || basename(item.home || ""), `${defaultPrefix}-${index}`),
        label: String(item.label || item.id || basename(item.home || "")).trim(),
        home: resolve(String(item.home || "")),
        profileType: item.profileType || "",
      };
    }).filter((item) => item.home);
  } else {
    items = trimmed.split(",").map((part, index) => {
      const item = part.trim();
      if (!item) return null;
      const eq = item.indexOf("=");
      if (eq > 0) {
        const id = slugProfileId(item.slice(0, eq), `${defaultPrefix}-${index}`);
        const home = resolve(item.slice(eq + 1).trim());
        return { id, label: id, home };
      }
      const home = resolve(item);
      return {
        id: index === 0 ? "default" : slugProfileId(basename(home), `${defaultPrefix}-${index}`),
        label: index === 0 ? "默认" : basename(home),
        home,
      };
    }).filter(Boolean);
  }
  return Promise.all(items.map(async (item) => ({
    ...item,
    explicit: true,
    exists: await pathExists(item.home),
  })));
}

async function scanLaunchAgentEnvVars(varNames = [], home = os.homedir(), platform = process.platform) {
  if (normalizePlatform(platform) !== "darwin") return [];
  const found = [];
  const launchDir = resolve(home, "Library", "LaunchAgents");
  const files = await readdir(launchDir).catch(() => []);
  for (const name of files) {
    if (!name.endsWith(".plist")) continue;
    const xml = await readFile(resolve(launchDir, name), "utf8").catch(() => "");
    if (!xml) continue;
    for (const varName of varNames) {
      const pattern = new RegExp(`<key>${varName}</key>\\s*<string>([^<]+)</string>`, "gi");
      for (const match of xml.matchAll(pattern)) {
        const rawPath = String(match[1] || "").trim();
        if (rawPath) {
          found.push({
            varName,
            path: resolve(rawPath.replace(/^~\//, `${home}/`)),
            source: name,
          });
        }
      }
    }
  }
  return found;
}

const CLAUDE_PLAN_TIER_ORDER = Object.freeze({
  max: 5,
  enterprise: 4,
  team: 4,
  pro: 3,
  gateway: 2,
  deepseek: 2,
  free: 1,
});

function pickHigherPlanType(a, b) {
  const cleanA = String(a || "").trim();
  const cleanB = String(b || "").trim();
  if (!cleanA) return cleanB;
  if (!cleanB) return cleanA;
  const rankA = CLAUDE_PLAN_TIER_ORDER[cleanA.toLowerCase()] ?? 0;
  const rankB = CLAUDE_PLAN_TIER_ORDER[cleanB.toLowerCase()] ?? 0;
  return rankB > rankA ? cleanB : cleanA;
}

function resolveCockpitDir(env = process.env, home = os.homedir()) {
  const custom = String(env?.COCKPIT_HOME || "").trim();
  return custom ? resolve(custom) : resolve(home, ".antigravity_cockpit");
}

export function defaultClaudeDesktopUserDataDir({ env = process.env, home = os.homedir(), platform = process.platform } = {}) {
  const norm = normalizePlatform(platform);
  if (norm === "darwin") {
    return resolve(home, "Library", "Application Support", "Claude");
  }
  if (norm === "win32") {
    return resolve(env?.APPDATA || resolve(home, "AppData", "Roaming"), "Claude");
  }
  return resolve(home, ".config", "Claude");
}

async function readJsonSafe(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function readCockpitInstanceRegistry(cockpitDir, registryName) {
  const defaults = {};
  const byKey = new Map();
  const upsertInstance = (raw) => {
    if (!raw || typeof raw !== "object") return;
    const dir = String(raw.userDataDir || "").trim();
    const id = String(raw.id || "").trim();
    const key = dir ? resolve(dir) : id;
    if (!key) return;
    const prev = byKey.get(key) || {};
    byKey.set(key, {
      id: id || prev.id || "",
      name: String(raw.name || prev.name || "").trim(),
      userDataDir: dir ? resolve(dir) : (prev.userDataDir || ""),
      bindAccountId: String(raw.bindAccountId || prev.bindAccountId || "").trim(),
      launchMode: String(raw.launchMode || prev.launchMode || "").trim(),
    });
  };

  const jsonDoc = await readJsonSafe(resolve(cockpitDir, registryName));
  if (jsonDoc && typeof jsonDoc === "object") {
    if (jsonDoc.defaultSettings && typeof jsonDoc.defaultSettings === "object") {
      Object.assign(defaults, jsonDoc.defaultSettings);
    }
    for (const item of Array.isArray(jsonDoc.instances) ? jsonDoc.instances : []) {
      upsertInstance(item);
    }
  }

  const sqlitePath = resolve(cockpitDir, "instance_registry.sqlite");
  if (await pathExists(sqlitePath)) {
    let db = null;
    try {
      db = new DatabaseSync(sqlitePath, { readOnly: true });
      const regRow = db.prepare("SELECT state FROM instance_registry WHERE registry = ?").get(registryName);
      if (regRow?.state) {
        const parsedState = JSON.parse(regRow.state);
        if (parsedState?.defaults && typeof parsedState.defaults === "object") {
          Object.assign(defaults, parsedState.defaults);
        }
      }
      const rows = db.prepare(
        "SELECT instance_id, user_data_dir, account_id, profile FROM instance_profiles WHERE registry = ? ORDER BY position ASC",
      ).all(registryName);
      for (const row of rows) {
        let prof = {};
        try {
          prof = row?.profile ? JSON.parse(row.profile) : {};
        } catch {
          prof = {};
        }
        upsertInstance({
          ...prof,
          id: prof.id || row.instance_id,
          userDataDir: prof.userDataDir || row.user_data_dir,
          bindAccountId: prof.bindAccountId || row.account_id,
        });
      }
    } catch {
      // Fall back to JSON registry when SQLite is absent or locked.
    } finally {
      try { db?.close(); } catch {}
    }
  }

  return {
    defaults,
    instances: [...byKey.values()],
  };
}

async function readCockpitClaudeAccounts(cockpitDir) {
  const byId = new Map();
  const bestByIdentity = new Map();

  const ingest = (raw) => {
    if (!raw || typeof raw !== "object") return;
    const id = String(raw.id || raw.account_id || "").trim();
    const email = String(raw.email || "").trim();
    const name = String(raw.name || "").trim();
    const planType = String(raw.plan_type || raw.planType || "").trim();
    const accountUuid = String(raw.account_uuid || raw.accountUuid || raw.provider_user_id || "").trim();
    const organizationUuid = String(raw.organization_uuid || raw.organizationUuid || "").trim();
    if (!id && !email && !accountUuid) return;

    const record = {
      id,
      email,
      name,
      planType,
      accountUuid,
      organizationUuid,
    };
    if (id) {
      const prev = byId.get(id) || {};
      byId.set(id, {
        id,
        email: email || prev.email || "",
        name: name || prev.name || "",
        planType: pickHigherPlanType(prev.planType, planType),
        accountUuid: accountUuid || prev.accountUuid || "",
        organizationUuid: organizationUuid || prev.organizationUuid || "",
      });
    }

    for (const identKey of [
      accountUuid ? `uuid:${accountUuid}` : "",
      email ? `email:${email.toLowerCase()}` : "",
    ].filter(Boolean)) {
      const prev = bestByIdentity.get(identKey) || {};
      bestByIdentity.set(identKey, {
        email: email || prev.email || "",
        name: name || prev.name || "",
        planType: pickHigherPlanType(prev.planType, planType),
        accountUuid: accountUuid || prev.accountUuid || "",
        organizationUuid: organizationUuid || prev.organizationUuid || "",
      });
    }
    return record;
  };

  const jsonDoc = await readJsonSafe(resolve(cockpitDir, "claude_accounts.json"));
  for (const item of Array.isArray(jsonDoc?.accounts) ? jsonDoc.accounts : []) {
    ingest(item);
  }

  const sqlitePath = resolve(cockpitDir, "claude_accounts.sqlite");
  if (await pathExists(sqlitePath)) {
    let db = null;
    try {
      db = new DatabaseSync(sqlitePath, { readOnly: true });
      const rows = db.prepare(
        "SELECT account_id, email, name, plan_type, provider_user_id FROM summaries",
      ).all();
      for (const row of rows) {
        ingest(row);
      }
    } catch {
      // Ignore unreadable sqlite.
    } finally {
      try { db?.close(); } catch {}
    }
  }

  const resolveAccount = (accountId) => {
    const cleanId = String(accountId || "").trim();
    if (!cleanId) return null;
    const direct = byId.get(cleanId);
    if (!direct) return null;
    const ident = (direct.accountUuid && bestByIdentity.get(`uuid:${direct.accountUuid}`))
      || (direct.email && bestByIdentity.get(`email:${direct.email.toLowerCase()}`))
      || {};
    return {
      bindAccountId: cleanId,
      email: direct.email || ident.email || "",
      name: direct.name || ident.name || "",
      planType: pickHigherPlanType(direct.planType, ident.planType),
      accountUuid: direct.accountUuid || ident.accountUuid || "",
      organizationUuid: direct.organizationUuid || ident.organizationUuid || "",
    };
  };

  return { resolveAccount };
}

export async function discoverCodexProfiles({ env = process.env, home = "", dataDir = "" } = {}) {
  const resolvedHome = home || resolveUserHome(env, process.platform, os.homedir());
  const override = await parseProfileOverride(env.AGENT_CONTROL_CODEX_HOMES, "codex");
  if (override) {
    return override.map((item) => ({
      ...item,
      provider: "codex",
      label: item.label || `Codex · ${item.id}`,
    }));
  }

  const cockpitDir = resolveCockpitDir(env, resolvedHome);
  const codexRegistry = await readCockpitInstanceRegistry(cockpitDir, "codex_instances.json");
  const cockpitNameByPath = new Map();
  for (const inst of codexRegistry.instances) {
    if (!inst.userDataDir || !inst.name) continue;
    const res = resolve(inst.userDataDir);
    cockpitNameByPath.set(res, inst.name);
    const canon = await realpath(res).catch(() => res);
    cockpitNameByPath.set(canon, inst.name);
  }

  const seenPaths = new Set();
  const usedIds = new Set();
  const profiles = [];
  const nextUniqueId = (baseId) => {
    const clean = slugProfileId(baseId, "default");
    if (!usedIds.has(clean)) {
      usedIds.add(clean);
      return clean;
    }
    let idx = 2;
    while (usedIds.has(`${clean}-${idx}`)) idx += 1;
    const unique = `${clean}-${idx}`;
    usedIds.add(unique);
    return unique;
  };
  const addProfile = async (id, label, dirPath, requireExists = false, extra = {}) => {
    const resolved = resolve(dirPath);
    const exists = await pathExists(resolved);
    if (requireExists && !exists) return;
    const canonical = exists ? await realpath(resolved).catch(() => resolved) : resolved;
    if (seenPaths.has(canonical)) return;
    seenPaths.add(canonical);
    const cockpitName = cockpitNameByPath.get(resolved) || cockpitNameByPath.get(canonical) || "";
    const resolvedLabel = (!extra?.managed && cockpitName) ? `Codex · ${cockpitName}` : label;
    profiles.push({
      id: nextUniqueId(id),
      provider: "codex",
      label: resolvedLabel,
      home: resolved,
      exists,
      ...extra,
    });
  };

  const envHome = String(env.CODEX_HOME || "").trim();
  if (envHome) {
    await addProfile("default", "Codex 默认", envHome, false);
  }
  await addProfile(envHome ? "home" : "default", "Codex 默认", resolve(resolvedHome, ".codex"), false);

  const launchHomes = await scanLaunchAgentEnvVars(["CODEX_HOME"], resolvedHome);
  for (const item of launchHomes) {
    await addProfile(basename(item.path).replace(/^\.codex-?/, "") || "agent", `Codex · ${basename(item.path)}`, item.path, true);
  }

  const homeEntries = await readdir(resolvedHome, { withFileTypes: true }).catch(() => []);
  for (const entry of homeEntries) {
    if (!entry.isDirectory() || !entry.name.startsWith(".codex-")) continue;
    const candidate = resolve(resolvedHome, entry.name);
    const hasMarker = await pathExists(resolve(candidate, "auth.json"))
      || await pathExists(resolve(candidate, "state_5.sqlite"));
    if (!hasMarker) continue;
    const suffix = entry.name.slice(".codex-".length);
    await addProfile(suffix, `Codex · ${suffix}`, candidate, true);
  }

  for (const inst of codexRegistry.instances) {
    if (!inst?.userDataDir) continue;
    const instId = inst.name || inst.id?.slice(0, 8) || basename(inst.userDataDir);
    const instLabel = inst.name ? `Codex · ${inst.name}` : `Codex · ${basename(inst.userDataDir)}`;
    await addProfile(instId, instLabel, inst.userDataDir, true);
  }

  if (dataDir) {
    const managedList = (await readManagedProfiles(dataDir)).filter((item) => item.provider === "codex");
    for (const item of managedList) {
      await addProfile(item.id, `Codex · ${item.name}`, item.home, false, {
        managed: true,
        managedName: item.name,
      });
    }
  }

  return profiles;
}

export async function readClaudePublicAccount(
  configDir,
  home = os.homedir(),
  cockpitAccount = null,
  { allowHomeFallback = true } = {},
) {
  const candidates = [
    resolve(configDir, ".claude.json"),
    ...(allowHomeFallback ? [resolve(home, ".claude.json")] : []),
  ];
  let oauthAcct = null;
  for (const filePath of candidates) {
    try {
      const parsed = JSON.parse(await readFile(filePath, "utf8"));
      if (parsed?.oauthAccount && typeof parsed.oauthAccount === "object") {
        oauthAcct = parsed.oauthAccount;
        break;
      }
    } catch {
      // Try next file.
    }
  }

  if (cockpitAccount && (cockpitAccount.email || cockpitAccount.accountUuid)) {
    const email = String(cockpitAccount.email || "").trim();
    const matchesOauth = Boolean(
      oauthAcct
      && (
        (email && String(oauthAcct.emailAddress || "").trim().toLowerCase() === email.toLowerCase())
        || (cockpitAccount.organizationUuid && oauthAcct.organizationUuid === cockpitAccount.organizationUuid)
      ),
    );
    const name = matchesOauth
      ? String(oauthAcct.displayName || cockpitAccount.name || "").trim()
      : String(cockpitAccount.name || "").trim();
    const org = matchesOauth ? String(oauthAcct.organizationName || "").trim() : "";
    return {
      signedIn: true,
      email,
      name,
      organizationName: org,
      planType: String(cockpitAccount.planType || "").trim(),
      accountUuid: String(cockpitAccount.accountUuid || (matchesOauth ? oauthAcct.accountUuid : "") || "").trim(),
      organizationUuid: String(cockpitAccount.organizationUuid || (matchesOauth ? oauthAcct.organizationUuid : "") || "").trim(),
      label: name && email ? `${name} · ${email}` : (email || name || "已绑定实例"),
    };
  }

  if (oauthAcct) {
    const email = String(oauthAcct.emailAddress || "").trim();
    const name = String(oauthAcct.displayName || "").trim();
    const org = String(oauthAcct.organizationName || "").trim();
    if (email || name) {
      return {
        signedIn: true,
        email,
        name,
        organizationName: org,
        accountUuid: String(oauthAcct.accountUuid || "").trim(),
        organizationUuid: String(oauthAcct.organizationUuid || "").trim(),
        label: name && email ? `${name} · ${email}` : (email || name),
      };
    }
  }
  return { signedIn: false, email: "", name: "", organizationName: "", label: "本地配置" };
}

export async function readClaudeDesktopSessionsMeta(profile, { accountUuid = "", orgUuid = "" } = {}) {
  const claimedIds = new Set();
  const errorEntries = [];
  const desktopDir = String(profile?.desktopUserDataDir || "").trim();
  const acct = String(
    accountUuid || profile?.cockpitAccount?.accountUuid || profile?.account?.accountUuid || "",
  ).trim();
  if (!desktopDir || !acct) {
    return { claimedIds, errorEntries };
  }
  const targetOrg = String(
    orgUuid || profile?.cockpitAccount?.organizationUuid || profile?.account?.organizationUuid || "",
  ).trim();

  const acctDir = resolve(desktopDir, "claude-code-sessions", acct);
  const orgEntries = await readdir(acctDir, { withFileTypes: true }).catch(() => []);
  for (const orgEntry of orgEntries) {
    if (!orgEntry.isDirectory()) continue;
    if (targetOrg && orgEntry.name !== targetOrg) continue;
    const orgDirPath = resolve(acctDir, orgEntry.name);
    const files = await readdir(orgDirPath, { withFileTypes: true }).catch(() => []);
    const parsedList = await Promise.all(
      files
        .filter((f) => f.isFile() && f.name.startsWith("local_") && f.name.endsWith(".json"))
        .map((f) => readJsonSafe(resolve(orgDirPath, f.name))),
    );
    for (const parsed of parsedList) {
      if (!parsed || typeof parsed !== "object") continue;
      const cliId = String(parsed.cliSessionId || "").trim();
      const lastCliId = String(parsed.lastAssistantCliSessionId || "").trim();
      if (cliId) claimedIds.add(cliId);
      if (lastCliId) claimedIds.add(lastCliId);
      if (parsed.error && parsed.errorAt) {
        const errorAtMs = Number(parsed.errorAt);
        if (Number.isFinite(errorAtMs) && errorAtMs > 0) {
          errorEntries.push({
            cliSessionId: cliId || lastCliId,
            error: String(parsed.error),
            errorAtMs,
          });
        }
      }
    }
  }
  errorEntries.sort((a, b) => b.errorAtMs - a.errorAtMs);
  return { claimedIds, errorEntries };
}

export async function discoverClaudeProfiles({ env = process.env, home = "", dataDir = "" } = {}) {
  const resolvedHome = home || resolveUserHome(env, process.platform, os.homedir());
  const override = await parseProfileOverride(env.AGENT_CONTROL_CLAUDE_CONFIG_DIRS, "claude");
  if (override) {
    return override.map((item) => ({
      ...item,
      provider: "claude",
      label: item.label || `Claude · ${item.id}`,
      cliConfigDir: item.cliConfigDir || item.home,
    }));
  }

  const cockpitDir = resolveCockpitDir(env, resolvedHome);
  const [claudeRegistry, cockpitAccounts] = await Promise.all([
    readCockpitInstanceRegistry(cockpitDir, "claude_instances.json"),
    readCockpitClaudeAccounts(cockpitDir),
  ]);
  const defaultDesktopDir = defaultClaudeDesktopUserDataDir({ env, home: resolvedHome });
  const defaultCliHome = resolve(String(env.CLAUDE_CONFIG_DIR || "").trim() || resolve(resolvedHome, ".claude"));
  const defaultBindId = String(claudeRegistry.defaults?.bindAccountId || "").trim();
  const defaultFollowLocal = claudeRegistry.defaults?.followLocalAccount;
  const defaultCockpitAccount = (defaultBindId && defaultFollowLocal === false)
    ? cockpitAccounts.resolveAccount(defaultBindId)
    : null;

  const seenPaths = new Set();
  const seenDesktopDirs = new Set();
  const usedIds = new Set();
  const profiles = [];

  const nextUniqueId = (baseId) => {
    const clean = slugProfileId(baseId, "default");
    if (!usedIds.has(clean)) {
      usedIds.add(clean);
      return clean;
    }
    let idx = 2;
    while (usedIds.has(`${clean}-${idx}`)) idx += 1;
    const unique = `${clean}-${idx}`;
    usedIds.add(unique);
    return unique;
  };

  const addProfile = async (
    id,
    label,
    dirPath,
    requireExists = false,
    { desktopUserDataDir = "", cockpitAccount = null, isDesktopInstance = false, managed = false, managedName = "" } = {},
  ) => {
    const resolved = resolve(dirPath);
    const exists = await pathExists(resolved);
    if (requireExists && !exists) return;
    const canonical = exists ? await realpath(resolved).catch(() => resolved) : resolved;
    if (!isDesktopInstance) {
      if (seenPaths.has(canonical)) return;
      seenPaths.add(canonical);
    } else if (desktopUserDataDir) {
      const resolvedDesk = resolve(desktopUserDataDir);
      if (seenDesktopDirs.has(resolvedDesk)) return;
      seenDesktopDirs.add(resolvedDesk);
    }
    const profileId = nextUniqueId(id);
    const dedicatedCliConfigDir = isDesktopInstance
      ? resolve(resolvedHome, `.claude-${profileId}`)
      : "";
    if (dedicatedCliConfigDir) {
      seenPaths.add(dedicatedCliConfigDir);
      const dedicatedCanonical = await realpath(dedicatedCliConfigDir).catch(() => dedicatedCliConfigDir);
      seenPaths.add(dedicatedCanonical);
    }
    profiles.push({
      id: profileId,
      provider: "claude",
      label,
      home: resolved,
      historyDir: resolved,
      cliConfigDir: resolved,
      desktopUserDataDir: desktopUserDataDir ? resolve(desktopUserDataDir) : "",
      exists,
      ...(managed ? { managed: true, managedName: managedName || label } : {}),
      ...(cockpitAccount ? { cockpitAccount } : {}),
      ...(isDesktopInstance
        ? {
            isDesktopInstance: true,
            dedicatedCliConfigDir,
          }
        : {}),
    });
  };

  const envDir = String(env.CLAUDE_CONFIG_DIR || "").trim();
  if (envDir) {
    await addProfile("default", "Claude 默认", envDir, false, {
      desktopUserDataDir: defaultDesktopDir,
      cockpitAccount: defaultCockpitAccount,
    });
  }
  await addProfile(envDir ? "home" : "default", "Claude 默认", resolve(resolvedHome, ".claude"), false, {
    desktopUserDataDir: envDir ? "" : defaultDesktopDir,
    cockpitAccount: envDir ? null : defaultCockpitAccount,
  });
  seenDesktopDirs.add(defaultDesktopDir);
  if (defaultCockpitAccount) {
    const altDefaultDir = resolve(resolvedHome, ".claude-default");
    seenPaths.add(altDefaultDir);
    const altDefaultCanonical = await realpath(altDefaultDir).catch(() => altDefaultDir);
    seenPaths.add(altDefaultCanonical);
  }

  for (const inst of claudeRegistry.instances) {
    const rawDir = String(inst?.userDataDir || "").trim();
    const bindId = String(inst?.bindAccountId || "").trim();
    const cockpitAccount = cockpitAccounts.resolveAccount(bindId);
    const resolvedDir = rawDir ? resolve(rawDir) : "";
    if (!resolvedDir) continue;
    if (resolvedDir === defaultDesktopDir && (!bindId || bindId === defaultBindId)) continue;

    const dirExists = await pathExists(resolvedDir);
    if (!dirExists && !cockpitAccount) continue;

    const isNativeCliDir = (
      await pathExists(resolve(resolvedDir, "projects"))
      || await pathExists(resolve(resolvedDir, "settings.json"))
      || await pathExists(resolve(resolvedDir, ".credentials.json"))
    );
    const instLabel = inst.name ? `Claude · ${inst.name}` : `Claude · ${basename(resolvedDir)}`;
    const instId = inst.name || inst.id?.slice(0, 8) || basename(resolvedDir);

    if (isNativeCliDir) {
      await addProfile(instId, instLabel, resolvedDir, true, {
        desktopUserDataDir: resolvedDir,
        cockpitAccount,
        isDesktopInstance: false,
      });
    } else {
      await addProfile(instId, instLabel, defaultCliHome, false, {
        desktopUserDataDir: resolvedDir,
        cockpitAccount,
        isDesktopInstance: true,
      });
    }
  }

  const launchDirs = await scanLaunchAgentEnvVars(["CLAUDE_CONFIG_DIR"], resolvedHome);
  for (const item of launchDirs) {
    await addProfile(basename(item.path).replace(/^\.claude-?/, "") || "agent", `Claude · ${basename(item.path)}`, item.path, true);
  }

  const homeEntries = await readdir(resolvedHome, { withFileTypes: true }).catch(() => []);
  for (const entry of homeEntries) {
    if (!entry.isDirectory() || !entry.name.startsWith(".claude-")) continue;
    const candidate = resolve(resolvedHome, entry.name);
    const hasMarker = await pathExists(resolve(candidate, "projects"))
      || await pathExists(resolve(candidate, "sessions"));
    if (!hasMarker) continue;
    const suffix = entry.name.slice(".claude-".length);
    await addProfile(suffix, `Claude · ${suffix}`, candidate, true);
  }

  if (dataDir) {
    const managedList = (await readManagedProfiles(dataDir)).filter((item) => item.provider === "claude");
    for (const item of managedList) {
      await addProfile(item.id, `Claude · ${item.name}`, item.home, false, {
        managed: true,
        managedName: item.name,
      });
    }
  }

  return profiles;
}

export async function discoverAntigravityProfiles({ env = process.env, home = os.homedir() } = {}) {
  const override = await parseProfileOverride(env.AGENT_CONTROL_AGY_APP_DATA_DIRS, "agy");
  if (override) {
    return override.map((item) => ({
      ...item,
      provider: "antigravity",
      profileType: item.profileType || (item.id === "cli" ? "cli" : "desktop"),
      label: item.label || `Antigravity · ${item.id}`,
    }));
  }

  const profiles = [];
  const desktopDir = resolve(home, ".gemini", "antigravity");
  const cliDir = resolve(home, ".gemini", "antigravity-cli");
  const desktopExists = await pathExists(desktopDir);
  const cliExists = await pathExists(cliDir);

  if (desktopExists || !cliExists) {
    profiles.push({
      id: "desktop",
      provider: "antigravity",
      profileType: "desktop",
      label: "Antigravity",
      home: desktopDir,
      exists: desktopExists,
    });
  } else if (cliExists) {
    profiles.push({
      id: "cli",
      provider: "antigravity",
      profileType: "cli",
      label: "Antigravity",
      home: cliDir,
      exists: cliExists,
    });
  }
  return profiles;
}

async function readCockpitPublicAccountRows(sqlitePath) {
  if (!sqlitePath || !(await pathExists(sqlitePath))) return [];
  try {
    const { stdout = "" } = await execFileAsync(
      "sqlite3",
      [
        "-readonly",
        "-json",
        sqlitePath,
        "SELECT account_id, email, name, plan_type, subscription_active_until FROM summaries;",
      ],
      { timeout: 2_000, maxBuffer: 256 * 1024 },
    );
    const parsed = JSON.parse(stdout.trim() || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function hasGrokAuth(grokHome, env = process.env) {
  if (String(env?.XAI_API_KEY || "").trim()) {
    return true;
  }
  if (!grokHome) return false;
  try {
    const raw = await readFile(resolve(grokHome, "auth.json"), "utf8");
    const parsed = JSON.parse(raw || "{}");
    if (Array.isArray(parsed)) return parsed.length > 0;
    if (parsed && typeof parsed === "object") {
      return Object.keys(parsed).length > 0;
    }
    return false;
  } catch {
    return false;
  }
}

export async function readGrokPublicAccount(grokHome, cockpitAccount = null, env = process.env) {
  const authenticated = await hasGrokAuth(grokHome, env);
  const email = String(cockpitAccount?.email || "").trim();
  const name = String(cockpitAccount?.name || "").trim();
  const planType = String(cockpitAccount?.plan_type || cockpitAccount?.planType || "").trim();
  const baseLabel = name && email ? `${name} · ${email}` : (email || name);
  const label = baseLabel || (authenticated ? (String(env?.XAI_API_KEY || "").trim() ? "API Key" : "已登录") : "未登录");
  return {
    signedIn: authenticated,
    authenticated,
    email,
    name,
    planType,
    label,
  };
}

export async function discoverGrokProfiles({ env = process.env, home = os.homedir(), dataDir = "" } = {}) {
  const overrideRaw = env.AGENT_CONTROL_GROK_HOMES ?? env.AGENT_CONTROL_GROK_CONFIG_DIRS;
  const override = await parseProfileOverride(overrideRaw, "grok");
  if (override) {
    const list = await Promise.all(override.map(async (item) => {
      const authenticated = await hasGrokAuth(item.home, env);
      return {
        ...item,
        provider: "grok",
        label: item.label || `Grok · ${item.id}`,
        authenticated,
        cockpitAccount: null,
      };
    }));
    list.sort((a, b) => Number(Boolean(b.authenticated)) - Number(Boolean(a.authenticated)));
    return list;
  }

  const cockpitDir = resolve(home, ".antigravity_cockpit");
  const cockpitRows = await readCockpitPublicAccountRows(resolve(cockpitDir, "grok_accounts.sqlite"));
  const accountById = new Map();
  for (const row of cockpitRows) {
    const id = String(row?.account_id || "").trim().toLowerCase();
    if (id) accountById.set(id, row);
  }

  const seenPaths = new Set();
  const usedIds = new Set();
  const profiles = [];
  const nextUniqueId = (baseId) => {
    const clean = slugProfileId(baseId, "default");
    if (!usedIds.has(clean)) {
      usedIds.add(clean);
      return clean;
    }
    let idx = 2;
    while (usedIds.has(`${clean}-${idx}`)) idx += 1;
    const unique = `${clean}-${idx}`;
    usedIds.add(unique);
    return unique;
  };
  const addProfile = async (id, label, dirPath, { requireExists = false, cockpitAccount = null, managed = false, managedName = "" } = {}) => {
    const resolved = resolve(dirPath);
    const exists = await pathExists(resolved);
    if (requireExists && !exists) return;
    const canonical = exists ? await realpath(resolved).catch(() => resolved) : resolved;
    if (seenPaths.has(canonical)) return;
    seenPaths.add(canonical);
    const authenticated = await hasGrokAuth(resolved, env);
    profiles.push({
      id: nextUniqueId(id),
      provider: "grok",
      label,
      home: resolved,
      exists,
      authenticated,
      cockpitAccount,
      ...(managed ? { managed: true, managedName: managedName || label } : {}),
    });
  };

  const cockpitProfilesDir = resolve(cockpitDir, "grok_profiles");
  const cockpitEntries = await readdir(cockpitProfilesDir, { withFileTypes: true }).catch(() => []);
  for (const entry of cockpitEntries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const dirName = entry.name;
    const acct = accountById.get(dirName.toLowerCase()) || null;
    const shortId = dirName.slice(0, 8);
    const emailPrefix = acct?.email ? String(acct.email).split("@")[0] : "";
    await addProfile(
      `cockpit-${shortId}`,
      emailPrefix ? `Grok · ${emailPrefix}` : `Grok · ${shortId}`,
      resolve(cockpitProfilesDir, dirName),
      { requireExists: true, cockpitAccount: acct },
    );
  }

  const envHome = String(env.GROK_HOME || "").trim();
  if (envHome) {
    await addProfile("env", `Grok · ${basename(resolve(envHome))}`, envHome, { requireExists: false });
  }
  await addProfile("default", "Grok 默认", resolve(home, ".grok"), { requireExists: false });

  if (dataDir) {
    const managedList = (await readManagedProfiles(dataDir)).filter((item) => item.provider === "grok");
    for (const item of managedList) {
      await addProfile(item.id, `Grok · ${item.name}`, item.home, {
        requireExists: false,
        managed: true,
        managedName: item.name,
      });
    }
  }

  profiles.sort((a, b) => Number(Boolean(b.authenticated)) - Number(Boolean(a.authenticated)));
  return profiles;
}

export async function discoverAllProfiles({ env = process.env, home = os.homedir(), dataDir = "" } = {}) {
  const [codex, claude, antigravity, grok] = await Promise.all([
    discoverCodexProfiles({ env, home, dataDir }),
    discoverClaudeProfiles({ env, home, dataDir }),
    discoverAntigravityProfiles({ env, home }),
    discoverGrokProfiles({ env, home, dataDir }),
  ]);
  return { codex, claude, antigravity, grok };
}

export function resolveProviderExecutables(
  env = process.env,
  home = os.homedir(),
  { platform = process.platform } = {},
) {
  return {
    codex: resolveExecutable({
      envVar: "CODEX_BIN",
      candidates: [
        ...providerCandidatePaths("codex", { env, homeDir: home, platform }),
        "/usr/local/bin/codex",
      ],
      binaryName: "codex",
      env,
      platform,
    }),
    claude: resolveExecutable({
      envVar: "CLAUDE_BIN",
      candidates: providerCandidatePaths("claude", { env, homeDir: home, platform }),
      binaryName: "claude",
      env,
      platform,
    }),
    antigravity: resolveExecutable({
      envVar: "AGY_BIN",
      candidates: providerCandidatePaths("antigravity", { env, homeDir: home, platform }),
      binaryName: "agy",
      env,
      platform,
    }),
    grok: resolveExecutable({
      envVar: "GROK_BIN",
      candidates: providerCandidatePaths("grok", { env, homeDir: home, platform }),
      binaryName: "grok",
      env,
      platform,
    }),
  };
}

export async function safeStatMtimeMs(filePath) {
  try {
    return (await stat(filePath)).mtimeMs;
  } catch {
    return 0;
  }
}
