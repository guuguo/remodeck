import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { formatCompositeThreadId } from "../composite-id.mjs";
import { resolveUserHome } from "../platform.mjs";
import { cleanPreviewText, displayThreadTitle, mergeActiveTurnIntoHistory } from "../thread-display.mjs";
import {
  ClaudeSessionHistoryIndex,
  readClaudeExternalSessionActivity,
  readClaudeThreadHistory,
} from "./claude-history.mjs";
import {
  claudeExecutable,
  ClaudeTurnManager,
  DEFAULT_CLAUDE_MODELS,
  probeClaudeProfile,
  readClaudeCliAuthStatus,
  readClaudeModelCatalog,
} from "./claude-runner.mjs";
import {
  discoverClaudeProfiles,
  readClaudeDesktopSessionsMeta,
  readClaudePublicAccount,
  readClaudePublicEndpoint,
} from "./profile-discovery.mjs";

const execFileAsync = promisify(execFile);

function shellQuote(value) {
  const str = String(value || "");
  if (/^[A-Za-z0-9_./:-]+$/.test(str)) return str;
  return `'${str.replace(/'/g, `'\\''`)}'`;
}

// Must mirror claudeEnvironment(): runs against ~/.claude drop CLAUDE_CONFIG_DIR,
// and the macOS keychain entry name depends on whether that variable is set
// ("Claude Code-credentials" vs "Claude Code-credentials-<hash>"), so logging in
// with an explicit CLAUDE_CONFIG_DIR=~/.claude would never be seen at runtime.
function claudeLoginCommand(cliDir, env, homeDir) {
  const resolvedDir = resolve(String(cliDir));
  if (resolvedDir === resolve(homeDir, ".claude") && !String(env?.CLAUDE_CONFIG_DIR || "").trim()) {
    return "env -u CLAUDE_CONFIG_DIR claude auth login";
  }
  return `CLAUDE_CONFIG_DIR=${shellQuote(resolvedDir)} claude auth login`;
}

function applescriptQuote(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export class ClaudeProvider {
  id = "claude";
  label = "Claude Code";
  #env;
  #dataDir;
  #index = new ClaudeSessionHistoryIndex();
  #runner;
  #profiles = [];
  #knownSessions = new Map();
  #defaultModelByProfile = new Map();
  #onEvent;
  #onServerRequest;

  constructor({
    env = process.env,
    dataDir = "",
    onEvent = () => {},
    onServerRequest = () => {},
  } = {}) {
    this.#env = env;
    this.#dataDir = dataDir;
    this.#onEvent = onEvent;
    this.#onServerRequest = onServerRequest;
    this.#runner = new ClaudeTurnManager({ env });
    this.#bindRunnerEvents();
  }

  #bindRunnerEvents() {
    const threadKey = (profileId, rawId) => formatCompositeThreadId("claude", profileId, rawId);

    this.#runner.on("turnStarted", ({ profileId, rawId, turn }) => {
      this.#onEvent({
        type: "turn_started",
        provider: "claude",
        profileId,
        rawId,
        threadId: threadKey(profileId, rawId),
        turn,
      });
    });

    this.#runner.on("streamItemStart", ({ profileId, rawId, turnId, itemId, blockType, toolName }) => {
      this.#onEvent({
        type: "stream_item_start",
        provider: "claude",
        profileId,
        rawId,
        threadId: threadKey(profileId, rawId),
        turnId,
        itemId,
        blockType,
        toolName,
      });
    });

    this.#runner.on("streamDelta", ({ profileId, rawId, turnId, itemId, kind, delta, toolName }) => {
      this.#onEvent({
        type: "stream_delta",
        provider: "claude",
        profileId,
        rawId,
        threadId: threadKey(profileId, rawId),
        turnId,
        itemId,
        kind,
        delta,
        toolName,
      });
    });

    this.#runner.on("assistantMessage", ({ profileId, rawId, turnId, item }) => {
      this.#onEvent({
        type: "item_completed",
        provider: "claude",
        profileId,
        rawId,
        threadId: threadKey(profileId, rawId),
        turnId,
        item,
      });
    });

    this.#runner.on("reasoningMessage", ({ profileId, rawId, turnId, item }) => {
      this.#onEvent({
        type: "item_completed",
        provider: "claude",
        profileId,
        rawId,
        threadId: threadKey(profileId, rawId),
        turnId,
        item,
      });
    });

    this.#runner.on("toolUse", ({ profileId, rawId, turnId, toolUse }) => {
      this.#onEvent({
        type: "tool_use",
        provider: "claude",
        profileId,
        rawId,
        threadId: threadKey(profileId, rawId),
        turnId,
        toolUse,
      });
    });

    this.#runner.on("toolResult", ({ profileId, rawId, turnId, toolResult }) => {
      this.#onEvent({
        type: "tool_result",
        provider: "claude",
        profileId,
        rawId,
        threadId: threadKey(profileId, rawId),
        turnId,
        toolResult,
      });
    });

    this.#runner.on("controlRequest", ({ profileId, rawId, turnId, request }) => {
      this.#onServerRequest({
        ...request,
        provider: "claude",
        profileId,
        rawThreadId: rawId,
        threadId: threadKey(profileId, rawId),
        turnId,
      });
    });

    this.#runner.on("turnCompleted", ({ profileId, rawId, turnId, status, lastAgentMessage, error, durationMs, result }) => {
      this.#onEvent({
        type: "turn_completed",
        provider: "claude",
        profileId,
        rawId,
        threadId: threadKey(profileId, rawId),
        turnId,
        status,
        lastAgentMessage,
        error,
        durationMs,
        usage: result?.usage || null,
      });
    });
  }

  async refreshProfiles() {
    const homeDir = resolveUserHome(this.#env, process.platform, os.homedir());
    const defaultCliHome = resolve(String(this.#env.CLAUDE_CONFIG_DIR || "").trim() || resolve(homeDir, ".claude"));
    const discovered = await discoverClaudeProfiles({ env: this.#env, home: homeDir, dataDir: this.#dataDir });
    const hasCliBinary = Boolean(claudeExecutable(this.#env));
    const needsDefaultAuthCheck = discovered.some((p) => p.isDesktopInstance || p.cockpitAccount);
    const defaultCliAuth = needsDefaultAuthCheck
      ? await readClaudeCliAuthStatus({ configDir: defaultCliHome, env: this.#env }).catch(() => ({
          supported: false,
          loggedIn: false,
        }))
      : { supported: false, loggedIn: false };

    this.#profiles = await Promise.all(discovered.map(async (profile) => {
      const historyDir = profile.historyDir || profile.home;
      let cliDir = profile.cliConfigDir || profile.home;
      const boundEmail = String(profile.cockpitAccount?.email || "").trim().toLowerCase();

      if (profile.isDesktopInstance && profile.dedicatedCliConfigDir) {
        let useDedicated = false;
        if (existsSync(profile.dedicatedCliConfigDir)) {
          const dedAuth = await readClaudeCliAuthStatus({
            configDir: profile.dedicatedCliConfigDir,
            env: this.#env,
          }).catch(() => null);
          if (dedAuth?.loggedIn || existsSync(resolve(profile.dedicatedCliConfigDir, "settings.json"))) {
            useDedicated = true;
          }
        }
        if (useDedicated) {
          cliDir = profile.dedicatedCliConfigDir;
        } else if (
          defaultCliAuth?.loggedIn
          && (!boundEmail || String(defaultCliAuth.email || "").toLowerCase() === boundEmail)
        ) {
          cliDir = defaultCliHome;
        } else {
          cliDir = profile.dedicatedCliConfigDir;
        }
      } else if (!profile.isDesktopInstance && profile.id === "default" && boundEmail) {
        const altDefaultDir = resolve(homeDir, ".claude-default");
        if (existsSync(altDefaultDir)) {
          const altAuth = await readClaudeCliAuthStatus({
            configDir: altDefaultDir,
            env: this.#env,
          }).catch(() => null);
          if (altAuth?.loggedIn) {
            cliDir = altDefaultDir;
          }
        }
      }

      let endpoint = await readClaudePublicEndpoint(cliDir);
      if (boundEmail && !endpoint.endpointHost) {
        const currentAuth = cliDir === defaultCliHome ? defaultCliAuth
          : await readClaudeCliAuthStatus({ configDir: cliDir, env: this.#env }).catch(() => null);
        if (!currentAuth?.loggedIn || String(currentAuth.email || "").toLowerCase() !== boundEmail) {
          const candidates = new Set([
            defaultCliHome,
            ...discovered.flatMap((p) => [p.cliConfigDir || p.home, p.dedicatedCliConfigDir]),
          ]);
          for (const candidate of candidates) {
            if (!candidate || candidate === cliDir || !existsSync(candidate)) continue;
            const auth = candidate === defaultCliHome ? defaultCliAuth
              : await readClaudeCliAuthStatus({ configDir: candidate, env: this.#env }).catch(() => null);
            if (auth?.loggedIn && String(auth.email || "").toLowerCase() === boundEmail) {
              cliDir = candidate;
              endpoint = await readClaudePublicEndpoint(cliDir);
              break;
            }
          }
        }
      }
      const allowHomeFallback = Boolean(!profile.managed && !profile.isDesktopInstance && (profile.id === "default" || resolve(cliDir) === defaultCliHome));
      const account = await readClaudePublicAccount(cliDir, homeDir, profile.cockpitAccount || null, {
        allowHomeFallback,
      });
      const loginCommand = claudeLoginCommand(cliDir, this.#env, homeDir);
      const needsLogin = Boolean(profile.managed && !account.signedIn && !endpoint.endpointHost);
      return {
        ...profile,
        historyDir,
        cliConfigDir: cliDir,
        account,
        endpointHost: endpoint.endpointHost || "",
        endpointLabel: endpoint.endpointLabel || "",
        needsLogin,
        loginCommand,
        installed: Boolean(profile.managed ? (hasCliBinary || profile.exists) : (profile.exists || account.signedIn)),
      };
    }));
    return this.#profiles;
  }

  async listProfiles() {
    if (!this.#profiles.length) await this.refreshProfiles();
    return this.#profiles.map((profile) => ({
      ...profile,
      online: Boolean(profile.installed),
    }));
  }

  #configDirFor(profile) {
    return profile?.cliConfigDir || profile?.home || resolve(os.homedir(), ".claude");
  }

  #historyDirFor(profile) {
    return profile?.historyDir || profile?.home || this.#configDirFor(profile);
  }

  async #resolveSessionStoreDir(profile, rawId) {
    const historyDir = this.#historyDirFor(profile);
    const cliDir = this.#configDirFor(profile);
    if (resolve(cliDir) !== resolve(historyDir) && existsSync(cliDir)) {
      const inCli = await this.#index.findSessionFile(cliDir, rawId);
      if (inCli) return { dir: cliDir, located: inCli };
    }
    const inHist = await this.#index.findSessionFile(historyDir, rawId);
    return { dir: historyDir, located: inHist };
  }

  async #getProfile(profileId) {
    const profiles = await this.listProfiles();
    const found = profiles.find((item) => item.id === profileId);
    if (!found) {
      throw Object.assign(new Error(`未知的 Claude 实例配置：${profileId}`), { status: 404 });
    }
    return found;
  }

  async listModels(profileId = "default") {
    const profile = await this.#getProfile(profileId).catch(() => null);
    const cliDir = this.#configDirFor(profile);
    const historyDir = this.#historyDirFor(profile);
    const catalogDir = existsSync(resolve(cliDir, "cache", "model-catalog")) || existsSync(resolve(cliDir, "settings.json"))
      ? cliDir
      : historyDir;
    const models = await readClaudeModelCatalog(catalogDir);
    const defaultEntry = models.find((item) => item.isDefault) || models[0];
    if (defaultEntry?.id) {
      this.#defaultModelByProfile.set(profileId, defaultEntry.id);
    }
    return models.map((item) => ({
      ...item,
      profileId,
    }));
  }

  async probeProfile(profileId = "default", { timeoutMs = 12_000 } = {}) {
    const profile = await this.#getProfile(profileId);
    return probeClaudeProfile({
      configDir: this.#configDirFor(profile),
      env: this.#env,
      timeoutMs,
      profile,
    });
  }

  #normalizeThread(profile, summary) {
    const rawId = String(summary.id || "");
    const running = this.#runner.isRunning(rawId);
    const fallbackDefaultModel = DEFAULT_CLAUDE_MODELS.find((item) => item.isDefault)?.id || DEFAULT_CLAUDE_MODELS[0].id;
    return {
      id: formatCompositeThreadId("claude", profile.id, rawId),
      rawId,
      provider: "claude",
      providerLabel: "Claude Code",
      profileId: profile.id,
      profileLabel: profile.label,
      name: summary.name || "",
      upstreamTitle: summary.name || "",
      upstreamCustomTitle: summary.upstreamCustomTitle || "",
      firstUserText: summary.firstUserText || "",
      lastUserText: summary.lastUserText || "",
      hasFollowUpTurns: Boolean(summary.hasFollowUpTurns),
      title: displayThreadTitle(summary),
      preview: cleanPreviewText(summary.preview || summary.name || "", 120),
      cwd: summary.cwd || os.homedir(),
      createdAt: Number(summary.createdAt) || 0,
      updatedAt: Number(summary.updatedAt) || 0,
      model: summary.model || this.#defaultModelByProfile.get(profile.id) || fallbackDefaultModel,
      reasoningEffort: summary.reasoningEffort || "medium",
      gitInfo: summary.gitInfo || null,
      turns: summary.turns,
      largeHistory: Boolean(summary.largeHistory),
      archived: false,
      live: Boolean(running || summary.live),
    };
  }

  async listThreads(profileId, { limit = 300 } = {}) {
    const profile = await this.#getProfile(profileId);
    const historyDir = this.#historyDirFor(profile);
    const cliDir = this.#configDirFor(profile);
    const resolvedHist = resolve(historyDir);

    let claimedForThisDesktop = null;
    const claimedByOtherDesktop = new Set();
    if (profile.isDesktopInstance) {
      const meta = await readClaudeDesktopSessionsMeta(profile);
      claimedForThisDesktop = meta.claimedIds;
    } else {
      const allProfiles = await this.listProfiles();
      const siblings = allProfiles.filter(
        (p) => p.id !== profile.id && p.isDesktopInstance && resolve(this.#historyDirFor(p)) === resolvedHist,
      );
      if (siblings.length) {
        const metas = await Promise.all(siblings.map((p) => readClaudeDesktopSessionsMeta(p)));
        for (const meta of metas) {
          for (const id of meta.claimedIds) claimedByOtherDesktop.add(id);
        }
      }
    }

    const fetchLimit = (claimedForThisDesktop || claimedByOtherDesktop.size > 0)
      ? Math.max(Number(limit) * 4 || 1200, 1200)
      : limit;
    const rawSessions = await this.#index.listSessions(historyDir, { limit: fetchLimit });
    const filteredHist = rawSessions.filter((item) => {
      if (claimedForThisDesktop) return claimedForThisDesktop.has(item.id);
      if (claimedByOtherDesktop.size > 0) return !claimedByOtherDesktop.has(item.id);
      return true;
    });

    const extraCliSessions = (resolve(cliDir) !== resolvedHist && existsSync(cliDir))
      ? await this.#index.listSessions(cliDir, { limit })
      : [];

    const byId = new Map(filteredHist.map((item) => [item.id, item]));
    for (const item of extraCliSessions) {
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
    for (const [key, known] of this.#knownSessions.entries()) {
      if (!key.startsWith(`${profile.id}:`)) continue;
      if (!byId.has(known.id)) {
        byId.set(known.id, known);
      }
    }
    const merged = [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
    return merged.map((item) => this.#normalizeThread(profile, item));
  }

  #externalActivityPayload(external, active = external?.live) {
    if (!active) return null;
    return {
      turnId: "",
      status: "running",
      phase: "Claude 执行中",
      text: "",
      updatedAt: external.updatedAt || Math.floor(Date.now() / 1000),
    };
  }

  async readThread(profileId, rawId, { cursor = null, limit = 40 } = {}) {
    const profile = await this.#getProfile(profileId);
    const { dir: storeDir } = await this.#resolveSessionStoreDir(profile, rawId);
    const [{ thread, nextCursor }, external] = await Promise.all([
      readClaudeThreadHistory(storeDir, rawId, {
        index: this.#index,
        cursor,
        limit,
      }),
      readClaudeExternalSessionActivity(storeDir, rawId, { index: this.#index }),
    ]);
    const known = this.#knownSessions.get(`${profileId}:${rawId}`);
    const activeTurn = this.#runner.getActiveTurn(rawId);
    const merged = {
      ...known,
      ...thread,
      firstUserText: thread.firstUserText || known?.firstUserText || "",
      lastUserText: thread.lastUserText || known?.lastUserText || "",
      hasFollowUpTurns: Boolean(thread.hasFollowUpTurns || known?.hasFollowUpTurns),
      updatedAt: Math.max(
        Number(thread.updatedAt) || 0,
        Number(external.latestUpdatedAt) || 0,
        Number(known?.updatedAt) || 0,
      ),
      live: Boolean(external.readThreadLive),
      turns: mergeActiveTurnIntoHistory(Array.isArray(thread.turns) ? thread.turns : [], activeTurn, {
        liveItemSuffix: "live",
      }),
    };
    const normalized = this.#normalizeThread(profile, merged);
    const activity = activeTurn
      ? {
          turnId: activeTurn.turnId,
          status: "running",
          phase: "Claude 执行中",
          text: activeTurn.lastText?.slice(-200) || "",
          updatedAt: Math.floor(Date.now() / 1000),
        }
      : this.#externalActivityPayload(external, external.readThreadLive);
    return {
      thread: normalized,
      nextCursor,
      activity,
      activityCursor: external.cursor || String(normalized.updatedAt || Date.now()),
    };
  }

  async getActivity(profileId, rawId, { cursor = null } = {}) {
    const activeTurn = this.#runner.getActiveTurn(rawId);
    if (activeTurn) {
      const nextCursor = `active:${activeTurn.turnId}:${(activeTurn.lastText || "").length}`;
      return {
        cursor: nextCursor,
        changed: cursor ? cursor !== nextCursor : true,
        live: true,
        activity: {
          turnId: activeTurn.turnId,
          status: "running",
          phase: "Claude 执行中",
          text: activeTurn.lastText?.slice(-200) || "",
          updatedAt: Math.floor(Date.now() / 1000),
        },
        streaming: {
          turnId: activeTurn.turnId,
          text: activeTurn.lastText || "",
          thought: "",
        },
      };
    }
    const profile = await this.#getProfile(profileId);
    const { dir: storeDir } = await this.#resolveSessionStoreDir(profile, rawId);
    const external = await readClaudeExternalSessionActivity(storeDir, rawId, {
      index: this.#index,
    });
    return {
      cursor: external.cursor,
      changed: Boolean(cursor && cursor !== external.cursor),
      live: external.live,
      activity: this.#externalActivityPayload(external),
    };
  }

  async startThread({
    profileId = "default",
    cwd = os.homedir(),
    text = "",
    images = [],
    model = "",
    effort = "",
    permissionMode = "workspace",
  } = {}) {
    const profile = await this.#getProfile(profileId);
    const rawId = randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const draft = {
      id: rawId,
      cwd: cwd || os.homedir(),
      createdAt: now,
      updatedAt: now,
      model: model || this.#defaultModelByProfile.get(profile.id) || DEFAULT_CLAUDE_MODELS[0].id,
      preview: cleanPreviewText(text || "新 Claude 会话", 120),
      turns: [],
    };
    this.#knownSessions.set(`${profile.id}:${rawId}`, draft);
    const thread = this.#normalizeThread(profile, draft);

    if (String(text || "").trim() || (images && images.length)) {
      const { turn } = await this.#runner.runTurn({
        profileId: profile.id,
        configDir: this.#configDirFor(profile),
        rawId,
        isNewSession: true,
        cwd: draft.cwd,
        text,
        images,
        model: model || "",
        effort: effort || "",
        permissionMode,
      });
      return { thread, turn };
    }
    return { thread, turn: null };
  }

  async sendTurn({
    profileId = "default",
    rawId,
    cwd = "",
    text = "",
    images = [],
    model = "",
    effort = "",
    permissionMode = "workspace",
    steer = false,
  } = {}) {
    const profile = await this.#getProfile(profileId);
    if (steer && this.#runner.isRunning(rawId)) {
      // Interrupt active run cleanly before starting follow-up turn if requested.
      await this.#runner.interrupt(rawId);
      const waitDeadline = Date.now() + 5_000;
      while (this.#runner.isRunning(rawId) && Date.now() < waitDeadline) {
        await new Promise((r) => setTimeout(r, 100));
      }
    }

    const configDir = this.#configDirFor(profile);
    const { dir: storeDir, located } = await this.#resolveSessionStoreDir(profile, rawId);
    let resolvedCwd = cwd;
    if (!resolvedCwd) {
      resolvedCwd = this.#knownSessions.get(`${profile.id}:${rawId}`)?.cwd || "";
      if (resolvedCwd && !(await stat(resolvedCwd).catch(() => null))?.isDirectory()) {
        resolvedCwd = "";
      }
      if (!resolvedCwd && located) {
        const parsed = await readClaudeThreadHistory(storeDir, rawId, { index: this.#index, limit: 1 });
        resolvedCwd = parsed.thread?.cwd || "";
      }
    }
    if (resolvedCwd && !(await stat(resolvedCwd).catch(() => null))?.isDirectory()) {
      throw Object.assign(new Error(`工作目录不存在：${resolvedCwd}`), { status: 400, code: "invalid_cwd" });
    }
    const isNewSession = !located && !this.#knownSessions.get(`${profile.id}:${rawId}`)?.hasRun;
    if (this.#knownSessions.has(`${profile.id}:${rawId}`)) {
      this.#knownSessions.get(`${profile.id}:${rawId}`).hasRun = true;
    }

    const { turn } = await this.#runner.runTurn({
      profileId: profile.id,
      configDir,
      rawId,
      isNewSession,
      cwd: resolvedCwd || os.homedir(),
      text,
      images,
      model,
      effort,
      permissionMode,
    });
    const thread = this.#normalizeThread(profile, {
      id: rawId,
      cwd: resolvedCwd || os.homedir(),
      updatedAt: Math.floor(Date.now() / 1000),
      model: model || this.#defaultModelByProfile.get(profile.id) || DEFAULT_CLAUDE_MODELS[0].id,
      preview: cleanPreviewText(text || "", 120),
    });
    return { turn, thread };
  }

  respondServerRequest(profileId, rawRequest, input) {
    return this.#runner.respondToControlRequest(rawRequest.rawThreadId, rawRequest, input);
  }

  async interrupt({ rawId } = {}) {
    return this.#runner.interrupt(rawId);
  }

  async startProfileLogin(profileId = "default", { mode = "terminal", openOnHost = true } = {}) {
    const profile = await this.#getProfile(profileId);
    const cliDir = this.#configDirFor(profile);
    await mkdir(cliDir, { recursive: true, mode: 0o700 });
    const homeDir = resolveUserHome(this.#env, process.platform, os.homedir());
    const loginCommand = claudeLoginCommand(cliDir, this.#env, homeDir);
    let openedTerminal = false;
    if (process.platform === "darwin" && openOnHost && this.#env.AGENT_CONTROL_NO_HOST_OPEN !== "1") {
      try {
        await execFileAsync("osascript", [
          "-e",
          `tell application "Terminal" to do script ${applescriptQuote(loginCommand)}`,
          "-e",
          `tell application "Terminal" to activate`,
        ]);
        openedTerminal = true;
      } catch {}
    }
    return {
      ok: true,
      provider: "claude",
      profileId,
      mode: mode || "terminal",
      openedTerminal,
      loginCommand,
    };
  }

  async close() {
    await this.#runner.close();
  }
}
