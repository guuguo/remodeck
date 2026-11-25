import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { codexExecutionPolicy, isBypassPermissionMode } from "../permissions.mjs";
import { killProcessTreeCrossPlatform, prepareCrossPlatformSpawn } from "../platform.mjs";
import {
  appServerEnvironment,
  appServerExecutable,
  appServerWorkingDirectory,
} from "./codex-app-server-client.mjs";

const START_TIMEOUT_MS = 15_000;

function extensionFromMime(mimeType = "") {
  const m = String(mimeType || "").toLowerCase();
  if (m.includes("png")) return ".png";
  if (m.includes("webp")) return ".webp";
  if (m.includes("gif")) return ".gif";
  return ".jpg";
}

function extractItemText(item) {
  if (!item || typeof item !== "object") return "";
  if (typeof item.text === "string") return item.text;
  if (Array.isArray(item.content)) {
    return item.content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter(Boolean)
      .join("");
  }
  return "";
}

async function materializeExecImages(images = []) {
  const imagePaths = [];
  let tempDir = "";
  const list = Array.isArray(images) ? images : [];
  for (let i = 0; i < list.length; i += 1) {
    const img = list[i];
    if (!img) continue;
    if (typeof img === "string") {
      const match = img.match(/^data:([^;]+);base64,(.+)$/i);
      if (match) {
        if (!tempDir) tempDir = await mkdtemp(resolve(os.tmpdir(), "agent-control-codex-exec-"));
        const target = resolve(tempDir, `image-${i + 1}${extensionFromMime(match[1])}`);
        await writeFile(target, Buffer.from(match[2], "base64"));
        imagePaths.push(target);
      }
      continue;
    }
    if (img.path) {
      imagePaths.push(String(img.path));
      continue;
    }
    const dataUrl = String(img.dataUrl || img.url || "");
    const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/i);
    if (match) {
      if (!tempDir) tempDir = await mkdtemp(resolve(os.tmpdir(), "agent-control-codex-exec-"));
      const target = resolve(tempDir, `image-${i + 1}${extensionFromMime(match[1])}`);
      await writeFile(target, Buffer.from(match[2], "base64"));
      imagePaths.push(target);
    }
  }
  return { imagePaths, tempDir };
}

/**
 * 构建原生 `codex exec` / `codex exec resume` 子命令参数。
 */
export function buildCodexExecArgs({
  rawId = "",
  cwd = "",
  model = "",
  effort = "",
  permissionMode = "workspace",
  imagePaths = [],
} = {}) {
  const cleanRawId = String(rawId || "").trim();
  const cleanCwd = String(cwd || "").trim();
  const cleanModel = String(model || "").trim();
  const cleanEffort = String(effort || "").trim();
  const policy = codexExecutionPolicy(permissionMode);
  const bypass = isBypassPermissionMode(permissionMode);

  if (!cleanRawId) {
    const args = ["exec", "--json", "--skip-git-repo-check"];
    if (cleanCwd) args.push("-C", cleanCwd);
    if (cleanModel) args.push("-m", cleanModel);
    if (bypass) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      args.push("-s", policy.sandbox);
    }
    if (cleanEffort) {
      args.push("-c", `model_reasoning_effort=${JSON.stringify(cleanEffort)}`);
    }
    for (const p of imagePaths || []) {
      if (p) args.push("-i", String(p));
    }
    args.push("-");
    return args;
  }

  // `codex exec resume` 不支持 `-C` 与 `-s`，工作目录通过 spawn cwd 传入，沙箱通过 `-c sandbox_mode=...` 配置。
  const args = ["exec", "resume", "--json", "--skip-git-repo-check"];
  if (cleanModel) args.push("-m", cleanModel);
  if (bypass) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  } else {
    args.push("-c", `sandbox_mode=${JSON.stringify(policy.sandbox)}`);
  }
  if (cleanEffort) {
    args.push("-c", `model_reasoning_effort=${JSON.stringify(cleanEffort)}`);
  }
  for (const p of imagePaths || []) {
    if (p) args.push("-i", String(p));
  }
  args.push(cleanRawId, "-");
  return args;
}

/**
 * 通过本机原生 `codex exec` / `codex exec resume` 子命令运行 Codex 轮次并桥接标准通知事件。
 */
export class CodexExecRunner {
  #env;
  #platform;
  #spawnImpl;
  #onNotification;
  #activeByThread = new Map();

  constructor({
    env = process.env,
    platform = process.platform,
    spawnImpl = spawn,
    onNotification = () => {},
  } = {}) {
    this.#env = env;
    this.#platform = platform;
    this.#spawnImpl = spawnImpl;
    this.#onNotification = onNotification;
  }

  isActive(rawId) {
    return Boolean(rawId && this.#activeByThread.has(rawId));
  }

  getActiveTurnId(rawId) {
    return this.#activeByThread.get(rawId)?.turnId || "";
  }

  async runTurn({
    profileId = "default",
    codexHome = "",
    rawId = "",
    cwd = "",
    text = "",
    images = [],
    model = "",
    effort = "",
    permissionMode = "workspace",
  } = {}) {
    const cleanRawId = String(rawId || "").trim();
    const isNewThread = !cleanRawId;
    const resolvedCwd = String(cwd || "").trim() || appServerWorkingDirectory(this.#env, this.#platform);
    const { imagePaths, tempDir } = await materializeExecImages(images);
    const args = buildCodexExecArgs({
      rawId: cleanRawId,
      cwd: isNewThread ? resolvedCwd : "",
      model,
      effort,
      permissionMode,
      imagePaths,
    });
    const turnId = `exec-turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let prepared;
    try {
      prepared = prepareCrossPlatformSpawn(
        appServerExecutable(this.#env),
        args,
        {
          cwd: resolvedCwd,
          env: appServerEnvironment(this.#env, codexHome),
          stdio: ["pipe", "pipe", "pipe"],
        },
        { platform: this.#platform },
      );
    } catch (error) {
      if (tempDir) await rm(tempDir, { recursive: true, force: true }).catch(() => {});
      throw error;
    }

    const proc = this.#spawnImpl(prepared.command, prepared.args, prepared.options);
    const entry = {
      proc,
      profileId,
      turnId,
      threadId: cleanRawId,
      interrupted: false,
      terminalEmitted: false,
    };

    if (!isNewThread) {
      this.#activeByThread.set(cleanRawId, entry);
    }

    const promptText = String(text || "").trim() ? String(text || "") : "请查看附图";
    const sentAgentTextByItem = new Map();
    const sentReasoningTextByItem = new Map();
    let buffer = "";
    let stderrTail = "";
    let lastAgentMessage = "";
    let lastStreamError = "";
    let startSettled = !isNewThread;
    let gateOpen = !isNewThread;
    const pendingNotifications = [];

    const emitNow = (method, params) => {
      if (method === "turn/completed" && entry.threadId && this.#activeByThread.get(entry.threadId) === entry) {
        this.#activeByThread.delete(entry.threadId);
      }
      this.#onNotification(profileId, { method, params });
    };

    const flushQueued = () => {
      gateOpen = true;
      while (pendingNotifications.length) {
        const next = pendingNotifications.shift();
        emitNow(next.method, next.params);
      }
    };

    const enqueueNotification = (method, params) => {
      if (gateOpen) {
        emitNow(method, params);
      } else {
        pendingNotifications.push({ method, params });
      }
    };

    let resolveStart = () => {};
    let rejectStart = () => {};
    let startTimer = null;
    const startPromise = isNewThread
      ? new Promise((resolveP, rejectP) => {
          resolveStart = (value) => {
            if (startSettled) return;
            startSettled = true;
            clearTimeout(startTimer);
            resolveP(value);
          };
          rejectStart = (err) => {
            if (startSettled) return;
            startSettled = true;
            clearTimeout(startTimer);
            rejectP(err);
          };
          startTimer = setTimeout(() => {
            rejectStart(new Error("codex exec 启动会话超时"));
          }, START_TIMEOUT_MS);
          startTimer.unref?.();
        })
      : Promise.resolve({ rawId: cleanRawId, turn: { id: turnId, status: "inProgress" } });

    const handleItemProgress = (item, completed) => {
      if (!item || typeof item !== "object") return;
      const itemType = String(item.type || "");
      const itemKey = String(item.id || itemType || "default");
      const threadId = entry.threadId;

      if (itemType === "error") {
        // Non-fatal warnings (e.g. model metadata cache notices) must not fail the turn.
        return;
      }

      if (itemType === "agent_message" || itemType === "agentMessage") {
        const fullText = extractItemText(item);
        const prevText = sentAgentTextByItem.get(itemKey) || "";
        let delta = "";
        if (fullText.startsWith(prevText)) {
          delta = fullText.slice(prevText.length);
        } else if (fullText && fullText !== prevText) {
          delta = fullText;
        }
        if (delta && threadId) {
          sentAgentTextByItem.set(itemKey, fullText);
          enqueueNotification("item/agentMessage/delta", {
            threadId,
            turnId,
            itemId: item.id || "",
            delta,
          });
        }
        if (completed && fullText) {
          lastAgentMessage = fullText;
          if (threadId) {
            enqueueNotification("item/completed", {
              threadId,
              turnId,
              item: {
                id: item.id || "",
                type: "agentMessage",
                text: fullText,
                phase: "final_answer",
              },
            });
          }
        }
        return;
      }

      if (itemType === "reasoning") {
        const fullText = extractItemText(item);
        const prevText = sentReasoningTextByItem.get(itemKey) || "";
        let delta = "";
        if (fullText.startsWith(prevText)) {
          delta = fullText.slice(prevText.length);
        } else if (fullText && fullText !== prevText) {
          delta = fullText;
        }
        if (delta && threadId) {
          sentReasoningTextByItem.set(itemKey, fullText);
          enqueueNotification("item/reasoning/summaryTextDelta", {
            threadId,
            turnId,
            itemId: item.id || "",
            delta,
          });
        }
      }
    };

    const handleEventLine = (line) => {
      if (!line) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      const evType = String(event?.type || "");

      if (evType === "thread.started") {
        const startedId = String(event.thread_id || event.threadId || "").trim();
        if (startedId) {
          entry.threadId = startedId;
          if (!entry.terminalEmitted) {
            this.#activeByThread.set(startedId, entry);
          }
          if (isNewThread && !startSettled) {
            resolveStart({
              rawId: startedId,
              turn: { id: turnId, status: "inProgress" },
            });
            const t = setTimeout(flushQueued, 20);
            t.unref?.();
          }
        }
        return;
      }

      if (evType === "turn.started") {
        if (entry.threadId) {
          enqueueNotification("turn/started", {
            threadId: entry.threadId,
            turn: { id: turnId, status: "inProgress" },
          });
        }
        return;
      }

      if (evType === "item.started" || evType === "item.updated" || evType === "item.completed") {
        handleItemProgress(event.item, evType === "item.completed");
        return;
      }

      if (evType === "error") {
        const errText = String(event.message || event.error?.message || "").trim();
        if (errText) {
          lastStreamError = errText;
          if (entry.threadId) {
            enqueueNotification("error", {
              threadId: entry.threadId,
              turnId,
              error: { message: errText },
              willRetry: /^Reconnecting\b/i.test(errText),
            });
          }
        }
        return;
      }

      if (evType === "turn.completed") {
        entry.terminalEmitted = true;
        if (entry.threadId) {
          enqueueNotification("turn/completed", {
            threadId: entry.threadId,
            turn: {
              id: turnId,
              status: "completed",
              lastAgentMessage,
              error: null,
            },
          });
        }
        return;
      }

      if (evType === "turn.failed") {
        entry.terminalEmitted = true;
        const errMsg = String(event.error?.message || event.message || lastStreamError || "codex exec 执行失败").trim();
        if (entry.threadId) {
          enqueueNotification("turn/completed", {
            threadId: entry.threadId,
            turn: {
              id: turnId,
              status: "failed",
              lastAgentMessage,
              error: { message: errMsg },
            },
          });
        } else if (isNewThread && !startSettled) {
          rejectStart(new Error(errMsg));
        }
      }
    };

    proc.stdout?.setEncoding("utf8");
    proc.stdout?.on("data", (chunk) => {
      buffer += chunk;
      while (true) {
        const idx = buffer.indexOf("\n");
        if (idx < 0) break;
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        handleEventLine(line);
      }
    });

    proc.stderr?.setEncoding("utf8");
    proc.stderr?.on("data", (chunk) => {
      stderrTail = `${stderrTail}${chunk}`.slice(-2000);
    });

    proc.on("error", (error) => {
      if (entry.threadId && this.#activeByThread.get(entry.threadId) === entry) {
        this.#activeByThread.delete(entry.threadId);
      }
      if (!startSettled) {
        rejectStart(error);
      } else if (entry.threadId && !entry.terminalEmitted) {
        entry.terminalEmitted = true;
        enqueueNotification("turn/completed", {
          threadId: entry.threadId,
          turn: {
            id: turnId,
            status: entry.interrupted ? "interrupted" : "failed",
            lastAgentMessage,
            error: entry.interrupted ? null : { message: String(error?.message || error || "codex exec 启动失败") },
          },
        });
      }
      if (tempDir) void rm(tempDir, { recursive: true, force: true }).catch(() => {});
    });

    proc.on("close", (code, signal) => {
      if (buffer.trim()) {
        handleEventLine(buffer.trim());
        buffer = "";
      }
      if (entry.threadId && this.#activeByThread.get(entry.threadId) === entry) {
        this.#activeByThread.delete(entry.threadId);
      }
      const cleanStderr = stderrTail.trim();
      const failureMsg = lastStreamError || cleanStderr || `codex exec 已退出 (${code ?? signal})`;

      if (!startSettled) {
        rejectStart(new Error(failureMsg));
      } else if (entry.threadId && !entry.terminalEmitted) {
        entry.terminalEmitted = true;
        if (entry.interrupted) {
          enqueueNotification("turn/completed", {
            threadId: entry.threadId,
            turn: {
              id: turnId,
              status: "interrupted",
              lastAgentMessage,
              error: null,
            },
          });
        } else if (code === 0) {
          enqueueNotification("turn/completed", {
            threadId: entry.threadId,
            turn: {
              id: turnId,
              status: "completed",
              lastAgentMessage,
              error: null,
            },
          });
        } else {
          enqueueNotification("turn/completed", {
            threadId: entry.threadId,
            turn: {
              id: turnId,
              status: "failed",
              lastAgentMessage,
              error: { message: failureMsg },
            },
          });
        }
      }
      if (tempDir) void rm(tempDir, { recursive: true, force: true }).catch(() => {});
    });

    try {
      proc.stdin?.end(promptText, "utf8");
    } catch {
      // Ignore closed stdin; close/error handler will settle.
    }

    return startPromise;
  }

  async interrupt(rawId) {
    const entry = this.#activeByThread.get(rawId);
    if (!entry) return null;
    entry.interrupted = true;
    const proc = entry.proc;
    if (proc && proc.exitCode === null) {
      await new Promise((resolveInterrupt) => {
        const timer = setTimeout(() => {
          killProcessTreeCrossPlatform(proc, { signal: "SIGKILL", platform: this.#platform });
          resolveInterrupt();
        }, 1_500);
        timer.unref?.();
        proc.once("exit", () => {
          clearTimeout(timer);
          resolveInterrupt();
        });
        try {
          killProcessTreeCrossPlatform(proc, { signal: "SIGTERM", platform: this.#platform });
        } catch {
          clearTimeout(timer);
          resolveInterrupt();
        }
      });
    }
    return { ok: true, turnId: entry.turnId };
  }

  async close() {
    const entries = [...this.#activeByThread.keys()];
    await Promise.all(entries.map((rawId) => this.interrupt(rawId).catch(() => {})));
    this.#activeByThread.clear();
  }
}
