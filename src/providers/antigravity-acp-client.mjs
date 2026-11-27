import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import os from "node:os";
import { antigravityModeId } from "../permissions.mjs";
import {
  execFileCrossPlatform,
  killProcessTreeCrossPlatform,
  normalizePlatform,
  pathModuleForPlatform,
  prepareCrossPlatformSpawn,
  resolveUserHome,
} from "../platform.mjs";
import { resolveProviderExecutables } from "./profile-discovery.mjs";

const ACP_PROTOCOL_VERSION = 1;
const CLIENT_INFO = {
  name: "agent-control",
  version: "0.1.0",
};
const DEFAULT_REQUEST_TIMEOUT_MS = 45_000;
const PROMPT_TIMEOUT_MS = 30 * 60 * 1000;

export const DEFAULT_AGY_MODEL = "gemini-pro-orchestrator";

const AGY_EFFORT_ORDER = ["low", "medium", "high", "xhigh"];

export function isAntigravityInternalWorkerModel(modelId = "") {
  return /(?:^|-)worker(?:-agy)?$/i.test(String(modelId || "").trim());
}

export const FALLBACK_AGY_MODELS = Object.freeze([
  {
    id: "gemini-pro-orchestrator",
    model: "gemini-pro-orchestrator",
    baseModel: "gemini-pro-orchestrator",
    displayName: "Orchestrator (Carbon)",
    provider: "antigravity",
    isDefault: true,
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: [],
  },
  {
    id: "gemini-pro-orchestrator-neon",
    model: "gemini-pro-orchestrator-neon",
    baseModel: "gemini-pro-orchestrator-neon",
    displayName: "Orchestrator (Neon)",
    provider: "antigravity",
    isDefault: false,
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: [],
  },
  {
    id: "gemini-pro-orchestrator-argon",
    model: "gemini-pro-orchestrator-argon",
    baseModel: "gemini-pro-orchestrator-argon",
    displayName: "Orchestrator (Argon)",
    provider: "antigravity",
    isDefault: false,
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: [],
  },
  {
    id: "gemini-4-neon",
    model: "gemini-4-neon",
    baseModel: "gemini-4-neon",
    displayName: "Gemini 4 Neon",
    provider: "antigravity",
    isDefault: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "gemini-4-carbon",
    model: "gemini-4-carbon",
    baseModel: "gemini-4-carbon",
    displayName: "Gemini 4 Carbon",
    provider: "antigravity",
    isDefault: false,
    defaultReasoningEffort: "high",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-4-argon",
    model: "gemini-4-argon",
    baseModel: "gemini-4-argon",
    displayName: "Gemini 4 Argon",
    provider: "antigravity",
    isDefault: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gemini-4-hydrogen",
    model: "gemini-4-hydrogen",
    baseModel: "gemini-4-hydrogen",
    displayName: "Gemini 4 Hydrogen",
    provider: "antigravity",
    isDefault: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high", "xhigh"],
  },
  {
    id: "gemini-3.8-flash",
    model: "gemini-3.8-flash",
    baseModel: "gemini-3.8-flash",
    displayName: "Gemini 3.8 Flash",
    provider: "antigravity",
    isDefault: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "claude-opus-5-5",
    model: "claude-opus-5-5",
    baseModel: "claude-opus-5-5",
    displayName: "Claude Opus 5.5",
    provider: "antigravity",
    isDefault: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "claude-sonnet-5-5",
    model: "claude-sonnet-5-5",
    baseModel: "claude-sonnet-5-5",
    displayName: "Claude Sonnet 5.5",
    provider: "antigravity",
    isDefault: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["low", "medium", "high"],
  },
  {
    id: "gpt-oss-120b",
    model: "gpt-oss-120b",
    baseModel: "gpt-oss-120b",
    displayName: "GPT-OSS 120B",
    provider: "antigravity",
    isDefault: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
  },
]);

export function agyExecutable(env = process.env) {
  return resolveProviderExecutables(env).antigravity;
}

export function splitAntigravityModelEffort(modelId = "", explicitEffort = "") {
  const cleanModel = String(modelId || "").trim();
  const suffixMatch = cleanModel.match(/^(.+)-(low|medium|high|xhigh)$/i);
  const baseModel = suffixMatch ? suffixMatch[1] : cleanModel;
  const derivedEffort = suffixMatch ? suffixMatch[2].toLowerCase() : "";
  const effort = String(explicitEffort || derivedEffort || "").trim().toLowerCase();
  return { baseModel, effort };
}

export function parseAgyModelsOutput(stdout) {
  const byBase = new Map();
  for (const line of String(stdout || "").split(/[\r\n]+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const match = trimmed.match(/^([a-z0-9._-]+)\s+(.+)$/i);
    if (!match) continue;
    const rawId = match[1];
    const rawDisplayName = match[2].trim();
    const { baseModel, effort } = splitAntigravityModelEffort(rawId);
    const cleanDisplayName = rawDisplayName.replace(/\s*\((?:low|medium|high|xhigh)\)\s*$/i, "").trim() || rawDisplayName;
    const key = baseModel || rawId;
    let entry = byBase.get(key);
    if (!entry) {
      entry = {
        id: key,
        model: key,
        baseModel: key,
        displayName: cleanDisplayName,
        provider: "antigravity",
        isDefault: false,
        defaultReasoningEffort: effort || "medium",
        supportedReasoningEfforts: [],
      };
      byBase.set(key, entry);
    } else if (cleanDisplayName.length < entry.displayName.length) {
      entry.displayName = cleanDisplayName;
    }
    if (effort && !entry.supportedReasoningEfforts.includes(effort)) {
      entry.supportedReasoningEfforts.push(effort);
    }
  }
  const items = [...byBase.values()].map((entry) => {
    const sorted = entry.supportedReasoningEfforts.sort(
      (a, b) => AGY_EFFORT_ORDER.indexOf(a) - AGY_EFFORT_ORDER.indexOf(b),
    );
    const preferredDefault = sorted.includes("medium")
      ? "medium"
      : (sorted[0] || entry.defaultReasoningEffort || "medium");
    return {
      ...entry,
      defaultReasoningEffort: preferredDefault,
      supportedReasoningEfforts: sorted,
    };
  });
  if (items.length) {
    const preferred =
      items.find((item) => item.id === DEFAULT_AGY_MODEL)
      || items.find((item) => item.id === "gemini-4-carbon")
      || items.find((item) => item.id.startsWith("gemini-4-carbon"))
      || items[0];
    if (preferred) preferred.isDefault = true;
  }
  return items;
}

export async function fetchAgyModelsFromCli({
  env = process.env,
  execFileImpl = execFileCrossPlatform,
  platform = process.platform,
  timeoutMs = 15_000,
} = {}) {
  try {
    const { stdout = "" } = await execFileImpl(agyExecutable(env), ["models"], {
      cwd: resolveUserHome(env, platform, os.homedir()),
      env,
      shell: false,
      timeout: timeoutMs,
      maxBuffer: 128 * 1024,
    });
    const parsed = parseAgyModelsOutput(stdout);
    return parsed.length
      ? { items: parsed, fromFallback: false }
      : { items: [...FALLBACK_AGY_MODELS], fromFallback: true };
  } catch {
    return { items: [...FALLBACK_AGY_MODELS], fromFallback: true };
  }
}

export async function listAgyModelsFromCli(options = {}) {
  const result = await fetchAgyModelsFromCli(options);
  return result.items;
}

export function resolveAgyAcpLaunch({
  appDataDir = "",
  env = process.env,
  homeDir,
  platform = process.platform,
  skipPermissions = false,
} = {}) {
  const normPlat = normalizePlatform(platform);
  const p = pathModuleForPlatform(normPlat);
  const args = skipPermissions ? ["acp", "--stdio", "--dangerously-skip-permissions"] : ["acp", "--stdio"];
  const childEnv = { ...env };
  delete childEnv.CLAUDECODE;
  delete childEnv.CLAUDE_CODE_ENTRYPOINT;

  const resolvedHome = p.resolve(String(homeDir || "").trim() || resolveUserHome(childEnv, normPlat, os.homedir()));
  const raw = String(appDataDir || "").trim();
  if (!raw) {
    return { args, env: childEnv, cwd: resolvedHome };
  }

  if (!p.isAbsolute(raw)) {
    args.push("--app-data-dir", raw);
    return { args, env: childEnv, cwd: resolvedHome };
  }

  const resolvedTarget = p.resolve(raw);
  const defaultGeminiDir = p.resolve(resolvedHome, ".gemini");
  const relToGemini = p.relative(defaultGeminiDir, resolvedTarget);
  if (relToGemini && relToGemini !== ".." && !relToGemini.startsWith(`..${p.sep}`) && !p.isAbsolute(relToGemini)) {
    args.push("--app-data-dir", relToGemini);
    return { args, env: childEnv, cwd: resolvedHome };
  }

  const parentDir = p.dirname(resolvedTarget);
  const relParent = p.relative(resolvedHome, parentDir);
  if (relParent !== ".." && !relParent.startsWith(`..${p.sep}`) && !p.isAbsolute(relParent)) {
    args.push("--gemini-dir", relParent || ".", "--app-data-dir", p.basename(resolvedTarget));
    return { args, env: childEnv, cwd: resolvedHome };
  }

  const grandParent = p.dirname(parentDir);
  childEnv.HOME = grandParent;
  if (normPlat === "win32") {
    childEnv.USERPROFILE = grandParent;
  }
  args.push("--gemini-dir", p.basename(parentDir) || ".", "--app-data-dir", p.basename(resolvedTarget));
  return { args, env: childEnv, cwd: grandParent };
}

export function normalizeAcpPermissionRequest(msg) {
  const params = msg?.params || {};
  const options = Array.isArray(params.options) ? params.options : [];
  const toolCall = params.toolCall || {};
  return {
    id: String(msg.id),
    rawId: msg.id,
    provider: "antigravity",
    method: "session/request_permission",
    kind: "acpPermission",
    title: String(params.title || toolCall.title || "Antigravity 请求授权"),
    threadId: String(params.sessionId || ""),
    reason: String(params.description || toolCall.kind || ""),
    command: String(toolCall.command || toolCall.rawInput?.command || toolCall.rawInput?.CommandLine || ""),
    options: options.map((opt) => ({
      optionId: String(opt.optionId || opt.id || ""),
      name: String(opt.name || opt.label || opt.optionId || opt.id || ""),
      kind: String(opt.kind || "allow_once"),
    })),
    availableDecisions: ["accept", "acceptForSession", "decline"],
  };
}

export function createAcpPermissionResponse(request, input = {}) {
  const options = Array.isArray(request.options) ? request.options : [];
  const requestedOptionId = String(input.optionId || "").trim();
  if (requestedOptionId) {
    return {
      outcome: { outcome: "selected", optionId: requestedOptionId },
      _meta: null,
    };
  }
  const decision = String(input.decision || "decline");
  if (decision === "cancel") {
    return { outcome: { outcome: "cancelled" }, _meta: null };
  }
  const matchByKind = (kinds) => options.find((opt) => kinds.includes(opt.kind));
  let chosen = null;
  if (decision === "acceptForSession") {
    chosen = matchByKind(["allow_always"]) || matchByKind(["allow_once"]) || options[0];
  } else if (decision === "accept" || decision === "approved") {
    chosen = matchByKind(["allow_once"]) || matchByKind(["allow_always"]) || options[0];
  } else {
    chosen = matchByKind(["reject_once", "reject_always", "deny"]) || options[options.length - 1];
  }
  if (!chosen?.optionId) {
    return { outcome: { outcome: "cancelled" }, _meta: null };
  }
  return {
    outcome: { outcome: "selected", optionId: chosen.optionId },
    _meta: null,
  };
}

export class AntigravityAcpClient extends EventEmitter {
  #appDataDir;
  #env;
  #platform;
  #spawnImpl;
  #executable;
  #process = null;
  #ready = null;
  #nextId = 1;
  #pending = new Map();
  #buffer = "";
  #stderrTail = [];
  #replayingSessions = new Set();
  #loadedSessions = new Set();
  #skipPermissions = false;
  #closed = false;
  #launch;
  #clientCapabilities;
  #agentName;

  constructor({
    appDataDir = "",
    env = process.env,
    platform = process.platform,
    spawnImpl = spawn,
    executable = "",
    skipPermissions = false,
    launch = null,
    clientCapabilities = {},
    agentName = "Antigravity",
  } = {}) {
    super();
    this.#appDataDir = appDataDir;
    this.#env = env;
    this.#platform = platform;
    this.#spawnImpl = spawnImpl;
    this.#executable = executable || agyExecutable(env);
    this.#skipPermissions = Boolean(skipPermissions);
    this.#launch = launch;
    this.#clientCapabilities = clientCapabilities;
    this.#agentName = agentName;
  }

  get skipPermissions() {
    return this.#skipPermissions;
  }

  get isConnected() {
    return Boolean(this.#process && this.#process.exitCode === null);
  }

  async ensureReady() {
    if (this.#closed) throw new Error(`${this.#agentName} ACP 客户端已关闭`);
    if (this.#ready) return this.#ready;
    this.#ready = this.#start().catch((error) => {
      this.#ready = null;
      throw error;
    });
    return this.#ready;
  }

  async #start() {
    const launch = this.#launch || resolveAgyAcpLaunch({
      appDataDir: this.#appDataDir,
      env: this.#env,
      platform: this.#platform,
      skipPermissions: this.#skipPermissions,
    });

    const prepared = prepareCrossPlatformSpawn(
      this.#executable,
      launch.args,
      {
        cwd: launch.cwd,
        env: launch.env,
        stdio: ["pipe", "pipe", "pipe"],
      },
      { platform: this.#platform },
    );
    const proc = this.#spawnImpl(prepared.command, prepared.args, prepared.options);
    this.#process = proc;
    this.#buffer = "";
    this.#stderrTail = [];

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => this.#onStdout(chunk));
    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk) => {
      this.#stderrTail.push(chunk);
      if (this.#stderrTail.length > 20) this.#stderrTail.shift();
    });
    proc.on("error", (error) => this.#failAll(error));
    proc.on("exit", (code, signal) => {
      const stderrText = this.#stderrTail.join("").trim().slice(-400);
      const processLabel = this.#agentName === "Antigravity" ? "agy acp" : `${this.#agentName} ACP`;
      const message = stderrText
        ? `${processLabel} 已退出 (${code ?? signal}): ${stderrText}`
        : `${processLabel} 已退出 (${code ?? signal})`;
      if (this.#process === proc) {
        this.#process = null;
        this.#ready = null;
      }
      this.#loadedSessions.clear();
      this.#replayingSessions.clear();
      this.#failAll(new Error(message));
      this.emit("exit", { code, signal, message });
    });

    try {
      await this.#sendRequest("initialize", {
        protocolVersion: ACP_PROTOCOL_VERSION,
        clientCapabilities: this.#clientCapabilities,
        clientInfo: CLIENT_INFO,
      });
    } catch (error) {
      if (this.#process === proc) {
        this.#process = null;
        this.#ready = null;
      }
      killProcessTreeCrossPlatform(proc, { signal: "SIGTERM", platform: this.#platform });
      throw error;
    }
  }

  #onStdout(chunk) {
    this.#buffer += chunk;
    while (true) {
      const idx = this.#buffer.indexOf("\n");
      if (idx < 0) break;
      const line = this.#buffer.slice(0, idx).trim();
      this.#buffer = this.#buffer.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      this.#dispatch(msg);
    }
  }

  #dispatch(msg) {
    const hasId = Object.prototype.hasOwnProperty.call(msg, "id") && msg.id !== null;
    if (hasId && !msg.method) {
      const entry = this.#pending.get(String(msg.id));
      if (!entry) return;
      this.#pending.delete(String(msg.id));
      clearTimeout(entry.timer);
      if (msg.error) {
        entry.reject(Object.assign(new Error(msg.error.message || `${this.#agentName} ACP 调用失败`), {
          code: msg.error.code,
          status: 500,
        }));
      } else {
        entry.resolve(msg.result);
      }
      return;
    }
    if (hasId && msg.method) {
      this.emit("serverRequest", msg);
      return;
    }
    if (msg.method === "session/update") {
      const sessionId = msg.params?.sessionId;
      if (sessionId && this.#replayingSessions.has(sessionId)) {
        return; // Suppress history replay notifications while session/load runs.
      }
      this.emit("sessionUpdate", msg.params);
      return;
    }
    if (msg.method) {
      this.emit("notification", msg);
    }
  }

  #writeLine(payload) {
    if (!this.#process?.stdin?.writable) {
      throw new Error(`${this.#agentName} ACP 输入流不可用`);
    }
    this.#process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  #sendRequest(method, params, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    const id = this.#nextId++;
    return new Promise((resolveReq, rejectReq) => {
      const timer = setTimeout(() => {
        this.#pending.delete(String(id));
        rejectReq(new Error(`${this.#agentName} ACP 请求超时 (${method})`));
      }, timeoutMs);
      timer.unref?.();
      this.#pending.set(String(id), {
        resolve: resolveReq,
        reject: rejectReq,
        timer,
        method,
        sessionId: String(params?.sessionId || ""),
      });
      try {
        this.#writeLine({ jsonrpc: "2.0", id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(String(id));
        rejectReq(error);
      }
    });
  }

  #failAll(error) {
    for (const [key, entry] of [...this.#pending.entries()]) {
      this.#pending.delete(key);
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  async request(method, params = {}, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
    await this.ensureReady();
    return this.#sendRequest(method, params, timeoutMs);
  }

  async listSessions() {
    return this.request("session/list", {});
  }

  async newSession({ cwd = os.homedir(), mcpServers = [] } = {}) {
    const result = await this.request("session/new", { cwd, mcpServers });
    if (result?.sessionId) this.#loadedSessions.add(result.sessionId);
    return result;
  }

  async ensureSessionLoaded(sessionId, { cwd = os.homedir(), mcpServers = [] } = {}) {
    if (this.#loadedSessions.has(sessionId)) return null;
    this.#replayingSessions.add(sessionId);
    try {
      const result = await this.request("session/load", { sessionId, cwd, mcpServers }, 60_000);
      this.#loadedSessions.add(sessionId);
      return result;
    } finally {
      this.#replayingSessions.delete(sessionId);
    }
  }

  async configureSession(sessionId, {
    model = "",
    effort = "",
    permissionMode = "full",
  } = {}) {
    const modeId = antigravityModeId(permissionMode);
    await this.request("session/set_mode", { sessionId, modeId }).catch(() => null);
    if (model) {
      const { baseModel, effort: derivedEffort } = splitAntigravityModelEffort(model, effort);
      if (baseModel) {
        let modelResult = await this.request("session/set_config_option", {
          sessionId,
          configId: "model",
          value: baseModel,
          _meta: null,
        }).catch(() => null);
        if (!modelResult && baseModel !== model) {
          await this.request("session/set_config_option", {
            sessionId,
            configId: "model",
            value: model,
            _meta: null,
          }).catch(() => null);
        }
      }
      const targetEffort = effort || derivedEffort;
      if (targetEffort) {
        await this.request("session/set_config_option", {
          sessionId,
          configId: "thought_level",
          value: targetEffort,
          _meta: null,
        }).catch(() => null);
      }
    } else if (effort) {
      await this.request("session/set_config_option", {
        sessionId,
        configId: "thought_level",
        value: effort,
        _meta: null,
      }).catch(() => null);
    }
  }

  async sendPrompt(sessionId, promptBlocks) {
    return this.request("session/prompt", {
      sessionId,
      prompt: promptBlocks,
    }, PROMPT_TIMEOUT_MS);
  }

  async cancel(sessionId) {
    await this.ensureReady();
    this.#writeLine({
      jsonrpc: "2.0",
      method: "session/cancel",
      params: { sessionId, _meta: null },
    });
  }

  abortSessionPrompt(sessionId, reason = "已强制中断当前回合") {
    const cleanId = String(sessionId || "").trim();
    if (!cleanId) return 0;
    this.#loadedSessions.delete(cleanId);
    let abortedCount = 0;
    for (const [key, entry] of [...this.#pending.entries()]) {
      if (entry.method === "session/prompt" && entry.sessionId === cleanId) {
        clearTimeout(entry.timer);
        this.#pending.delete(key);
        abortedCount += 1;
        entry.reject(Object.assign(new Error(reason), {
          status: 499,
          code: "prompt_aborted",
          aborted: true,
        }));
      }
    }
    return abortedCount;
  }

  respond(rawId, result) {
    this.#writeLine({ jsonrpc: "2.0", id: rawId, result });
  }

  respondError(rawId, code = -32000, message = "用户拒绝请求") {
    this.#writeLine({ jsonrpc: "2.0", id: rawId, error: { code, message } });
  }

  async close() {
    this.#closed = true;
    const proc = this.#process;
    this.#process = null;
    this.#ready = null;
    this.#loadedSessions.clear();
    this.#replayingSessions.clear();
    this.#failAll(new Error(`${this.#agentName} ACP 客户端已关闭`));
    if (proc && proc.exitCode === null) {
      await new Promise((resolveClose) => {
        const timer = setTimeout(() => {
          killProcessTreeCrossPlatform(proc, { signal: "SIGKILL", platform: this.#platform });
          resolveClose();
        }, 1_500);
        timer.unref?.();
        proc.once("exit", () => {
          clearTimeout(timer);
          resolveClose();
        });
        try {
          killProcessTreeCrossPlatform(proc, { signal: "SIGTERM", platform: this.#platform });
        } catch {
          clearTimeout(timer);
          resolveClose();
        }
      });
    }
  }
}
