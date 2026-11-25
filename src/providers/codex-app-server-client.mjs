import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import os from "node:os";
import { resolve } from "node:path";
import {
  killProcessTreeCrossPlatform,
  prepareCrossPlatformSpawn,
  resolveUserHome,
} from "../platform.mjs";
import { resolveProviderExecutables } from "./profile-discovery.mjs";

const CLIENT_INFO = {
  name: "agent-control",
  title: "Agent Control",
  version: "0.1.0",
};

const REQUEST_TIMEOUT_MS = 30_000;

export function appServerExecutable(env = process.env) {
  return resolveProviderExecutables(env).codex;
}

export function appServerWorkingDirectory(env = process.env, platform = process.platform) {
  const configured = String(env.AGENT_CONTROL_CWD || env.CODEX_CONTROL_CWD || "").trim();
  return configured ? resolve(configured) : resolveUserHome(env, platform, os.homedir());
}

export function appServerEnvironment(env = process.env, codexHome = "") {
  const out = { ...env };
  delete out.CLAUDECODE;
  delete out.CLAUDE_CODE_ENTRYPOINT;
  if (codexHome) out.CODEX_HOME = codexHome;
  return out;
}

export function normalizeServerRequest(message) {
  const method = message?.method || "";
  const params = message?.params || {};
  const base = {
    id: String(message.id),
    rawId: message.id,
    method,
    threadId: params.threadId || "",
    turnId: params.turnId || "",
    itemId: params.itemId || "",
    provider: "codex",
  };
  if (method === "item/commandExecution/requestApproval") {
    return {
      ...base,
      kind: "command",
      title: "Codex 请求执行命令",
      command: params.command || "",
      cwd: params.cwd || "",
      reason: params.reason || "",
      commandActions: params.commandActions || [],
      additionalPermissions: params.additionalPermissions || null,
      availableDecisions: params.availableDecisions || ["accept", "acceptForSession", "decline", "cancel"],
    };
  }
  if (method === "item/fileChange/requestApproval") {
    return {
      ...base,
      kind: "fileChange",
      title: "Codex 请求修改文件",
      reason: params.reason || "",
      grantRoot: params.grantRoot || "",
      availableDecisions: ["accept", "acceptForSession", "decline", "cancel"],
    };
  }
  if (method === "execCommandApproval") {
    return {
      ...base,
      kind: "command",
      title: "Codex 请求执行命令",
      command: Array.isArray(params.command) ? params.command.join(" ") : String(params.command || ""),
      cwd: params.cwd || "",
      reason: params.reason || "",
      availableDecisions: ["approved", "approved_for_session", "denied", "abort"],
    };
  }
  if (method === "applyPatchApproval") {
    return {
      ...base,
      kind: "fileChange",
      title: "Codex 请求应用补丁",
      reason: params.reason || "",
      grantRoot: params.grantRoot || "",
      fileCount: Object.keys(params.fileChanges || {}).length,
      availableDecisions: ["approved", "approved_for_session", "denied", "abort"],
    };
  }
  if (method === "item/tool/requestUserInput") {
    return {
      ...base,
      kind: "userInput",
      title: "Codex 需要你确认信息",
      isBlocking: params.isBlocking !== false,
      questions: Array.isArray(params.questions) ? params.questions : [],
    };
  }
  return { ...base, kind: "unknown", title: method || "未知请求", params };
}

export function createServerRequestResponse(request, input = {}) {
  const decision = input.decision || "decline";
  if (request.method === "item/commandExecution/requestApproval" || request.method === "item/fileChange/requestApproval") {
    return { decision };
  }
  if (request.method === "execCommandApproval" || request.method === "applyPatchApproval") {
    const legacy = {
      accept: "approved",
      acceptForSession: "approved_for_session",
      decline: "denied",
      cancel: "abort",
      approved: "approved",
      approved_for_session: "approved_for_session",
      denied: "denied",
      abort: "abort",
    };
    return { decision: legacy[decision] || "denied" };
  }
  if (request.method === "item/tool/requestUserInput") {
    const answers = {};
    for (const q of request.questions || []) {
      const provided = input.answers?.[q.id];
      const list = Array.isArray(provided?.answers)
        ? provided.answers
        : (Array.isArray(provided) ? provided : (provided ? [String(provided)] : []));
      answers[q.id] = { answers: list.map(String) };
    }
    return { answers };
  }
  return input;
}

export class CodexAppServerClient extends EventEmitter {
  #codexHome;
  #env;
  #platform;
  #spawnImpl;
  #executable;
  #args;
  #process = null;
  #ready = null;
  #nextId = 1;
  #pending = new Map();
  #buffer = "";
  #stderrTail = [];
  #closed = false;

  constructor({
    codexHome = "",
    env = process.env,
    platform = process.platform,
    spawnImpl = spawn,
    executable = "",
    args = ["app-server", "--stdio"],
  } = {}) {
    super();
    this.#codexHome = codexHome;
    this.#env = env;
    this.#platform = platform;
    this.#spawnImpl = spawnImpl;
    this.#executable = executable || appServerExecutable(env);
    this.#args = args;
  }

  get isConnected() {
    return Boolean(this.#process && this.#process.exitCode === null);
  }

  get pid() {
    return this.#process && this.#process.exitCode === null ? (this.#process.pid || null) : null;
  }

  async ensureReady() {
    if (this.#closed) throw new Error("Codex App Server 客户端已关闭");
    if (this.#ready) return this.#ready;
    this.#ready = this.#start().catch((error) => {
      this.#ready = null;
      throw error;
    });
    return this.#ready;
  }

  async #start() {
    const prepared = prepareCrossPlatformSpawn(
      this.#executable,
      this.#args,
      {
        cwd: appServerWorkingDirectory(this.#env, this.#platform),
        env: appServerEnvironment(this.#env, this.#codexHome),
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
      const msg = stderrText
        ? `codex app-server 已退出 (${code ?? signal}): ${stderrText}`
        : `codex app-server 已退出 (${code ?? signal})`;
      this.#process = null;
      this.#ready = null;
      this.#failAll(new Error(msg));
      this.emit("exit", { code, signal, message: msg });
    });

    await this.#sendRequest("initialize", {
      clientInfo: CLIENT_INFO,
      capabilities: { experimentalApi: true },
    });
    this.#writeLine({ method: "initialized", params: {} });
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
        const err = Object.assign(new Error(msg.error.message || "Codex RPC 调用失败"), {
          code: msg.error.code,
          status: msg.error.code === -32600 ? 400 : 500,
        });
        entry.reject(err);
      } else {
        entry.resolve(msg.result);
      }
      return;
    }
    if (hasId && msg.method) {
      this.emit("serverRequest", msg);
      return;
    }
    if (msg.method) {
      this.emit("notification", msg);
    }
  }

  #writeLine(payload) {
    if (!this.#process?.stdin?.writable) {
      throw new Error("codex app-server 输入流不可用");
    }
    this.#process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  #sendRequest(method, params, timeoutMs = REQUEST_TIMEOUT_MS) {
    const id = this.#nextId++;
    return new Promise((resolveReq, rejectReq) => {
      const timer = setTimeout(() => {
        this.#pending.delete(String(id));
        rejectReq(new Error(`Codex 请求超时 (${method})`));
      }, timeoutMs);
      timer.unref?.();
      this.#pending.set(String(id), { resolve: resolveReq, reject: rejectReq, timer });
      try {
        this.#writeLine({ id, method, params });
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

  async request(method, params = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    await this.ensureReady();
    return this.#sendRequest(method, params, timeoutMs);
  }

  respond(rawId, result) {
    this.#writeLine({ id: rawId, result });
  }

  respondError(rawId, code = -32601, message = "请求被拒绝") {
    this.#writeLine({ id: rawId, error: { code, message } });
  }

  async close() {
    this.#closed = true;
    const proc = this.#process;
    this.#process = null;
    this.#ready = null;
    this.#failAll(new Error("Codex 客户端已关闭"));
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
          resolveClose();
        }
      });
    }
  }
}
