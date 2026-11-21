import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";
import { claudePermissionMode } from "../permissions.mjs";
import {
  killProcessTreeCrossPlatform,
  normalizePlatform,
  prepareCrossPlatformSpawn,
  resolveUserHome,
} from "../platform.mjs";
import { resolveProviderExecutables } from "./profile-discovery.mjs";

const CLAUDE_EFFORT_ORDER = Object.freeze(["low", "medium", "high", "xhigh", "max"]);

export const DEFAULT_CLAUDE_MODELS = Object.freeze([
  {
    id: "claude-opus-5-5",
    model: "claude-opus-5-5",
    displayName: "Claude Opus 5.5",
    description: "复杂工程与深度推理",
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
    description: "高效均衡主力模型",
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
    description: "旗舰高阶攻坚模型",
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
    description: "极速轻量响应",
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
    description: "5.1 攻坚模型",
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
    description: "4.8 深度推理模型",
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
    description: "前代旗舰推理模型",
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
    description: "4.6 深度推理模型",
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
    description: "4.6 均衡主力模型",
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
    description: "4.5 轻量快速模型",
    section: "overflow",
    provider: "claude",
    isDefault: false,
    defaultReasoningEffort: "",
    supportedReasoningEfforts: [],
  },
]);

export function formatClaudeModelDisplayName(modelId, rawName = "") {
  const cleanName = String(rawName || "").trim();
  if (cleanName) {
    return /^claude\b/i.test(cleanName) ? cleanName : `Claude ${cleanName}`;
  }
  const cleanId = String(modelId || "").trim();
  const baseId = cleanId.replace(/-\d{8}$/, "");
  const match = baseId.match(/^claude-([a-z]+)(?:-(\d+)(?:-(\d+))?)?(?:-[a-z0-9-]+)?$/i);
  if (match) {
    const family = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    const version = match[2] ? (match[3] ? `${match[2]}.${match[3]}` : match[2]) : "";
    return version ? `Claude ${family} ${version}` : `Claude ${family}`;
  }
  return cleanId || "Claude";
}

function applyClaudeDefaultSelection(models, preferredIds = []) {
  if (!models.length) return models;
  let chosenIdx = -1;
  for (const target of preferredIds) {
    const clean = String(target || "").trim();
    if (!clean) continue;
    const idx = models.findIndex((item) => item.id === clean || item.model === clean);
    if (idx >= 0) {
      chosenIdx = idx;
      break;
    }
  }
  if (chosenIdx < 0) chosenIdx = 0;
  return models.map((item, idx) => ({
    ...item,
    isDefault: idx === chosenIdx,
  }));
}

function buildExtraClaudeModelEntry(modelId) {
  return {
    id: modelId,
    model: modelId,
    displayName: formatClaudeModelDisplayName(modelId),
    description: "",
    section: "main",
    provider: "claude",
    isDefault: false,
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: [...CLAUDE_EFFORT_ORDER],
  };
}

export async function readClaudeModelCatalog(configDir = "") {
  const resolvedDir = String(configDir || "").trim() || resolve(os.homedir(), ".claude");
  let settingsModel = "";
  let extraModelIds = [];
  try {
    const settingsRaw = await readFile(resolve(resolvedDir, "settings.json"), "utf8");
    const settings = JSON.parse(settingsRaw);
    if (typeof settings?.model === "string") {
      settingsModel = settings.model.trim();
    }
    if (settings?.modelSettings && typeof settings.modelSettings === "object") {
      extraModelIds = Object.keys(settings.modelSettings)
        .map((key) => String(key || "").trim())
        .filter((key) => /^claude-/i.test(key));
    }
  } catch {
    // Ignore missing or unreadable settings.json.
  }

  const catalogDir = resolve(resolvedDir, "cache", "model-catalog");
  const files = await readdir(catalogDir).catch(() => []);
  const validCatalogs = [];
  for (const name of files) {
    if (!name.endsWith(".json")) continue;
    try {
      const parsed = JSON.parse(await readFile(resolve(catalogDir, name), "utf8"));
      const models = parsed?.catalog?.config?.models;
      if (Array.isArray(models) && models.length > 0) {
        validCatalogs.push(parsed);
      }
    } catch {
      // Skip malformed catalog cache files.
    }
  }

  if (validCatalogs.length > 0) {
    validCatalogs.sort((a, b) => Number(b.fetchedAt || 0) - Number(a.fetchedAt || 0));
    const descById = new Map();
    for (const entry of validCatalogs) {
      for (const m of entry.catalog?.config?.models || []) {
        const id = String(m?.id || "").trim();
        const desc = String(m?.description || "").trim();
        if (id && desc && !descById.has(id)) {
          descById.set(id, desc);
        }
      }
    }

    const latestCatalog = validCatalogs[0].catalog;
    const thinkingMap = new Map();
    for (const st of latestCatalog.state?.thinking_by_model || []) {
      const id = String(st?.id || "").trim();
      const effort = String(st?.thinking?.effort || "").trim().toLowerCase();
      if (id && effort) thinkingMap.set(id, effort);
    }

    const seen = new Set();
    const mainModels = [];
    const overflowModels = [];
    for (const m of latestCatalog.config.models) {
      const id = String(m?.id || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);

      let efforts = [];
      if (m?.thinking?.type !== "none") {
        const rawEfforts = Array.isArray(m?.runtime?.effort_levels) && m.runtime.effort_levels.length
          ? m.runtime.effort_levels
          : (Array.isArray(m?.thinking?.effort_options) ? m.thinking.effort_options.map((opt) => opt?.id) : []);
        const filtered = rawEfforts
          .map((e) => String(e || "").trim().toLowerCase())
          .filter((e) => CLAUDE_EFFORT_ORDER.includes(e));
        efforts = [...new Set(filtered)];
      }

      let defaultEffort = "";
      if (efforts.length > 0) {
        const candidates = [
          thinkingMap.get(id),
          String(m?.runtime?.default_effort || "").trim().toLowerCase(),
          "medium",
        ];
        defaultEffort = candidates.find((cand) => cand && efforts.includes(cand)) || efforts[0];
      }

      const section = m?.section === "overflow" ? "overflow" : "main";
      const mapped = {
        id,
        model: id,
        displayName: formatClaudeModelDisplayName(id, m?.name || ""),
        description: String(m?.description || descById.get(id) || "").trim(),
        section,
        provider: "claude",
        isDefault: false,
        defaultReasoningEffort: defaultEffort,
        supportedReasoningEfforts: efforts,
      };
      if (section === "overflow") overflowModels.push(mapped);
      else mainModels.push(mapped);
    }

    for (const extraId of extraModelIds) {
      if (seen.has(extraId)) continue;
      seen.add(extraId);
      mainModels.push(buildExtraClaudeModelEntry(extraId));
    }

    const combined = [...mainModels, ...overflowModels];
    const preferredDefault = settingsModel || String(latestCatalog.state?.model || "").trim();
    return applyClaudeDefaultSelection(combined, [preferredDefault, "claude-sonnet-5-5"]);
  }

  const fallback = DEFAULT_CLAUDE_MODELS.map((item) => ({
    ...item,
    supportedReasoningEfforts: [...item.supportedReasoningEfforts],
  }));
  const seen = new Set(fallback.map((item) => item.id));
  const extraEntries = [];
  for (const extraId of extraModelIds) {
    if (seen.has(extraId)) continue;
    seen.add(extraId);
    extraEntries.push(buildExtraClaudeModelEntry(extraId));
  }
  const mergedFallback = extraEntries.length
    ? [
        ...fallback.filter((item) => item.section !== "overflow"),
        ...extraEntries,
        ...fallback.filter((item) => item.section === "overflow"),
      ]
    : fallback;
  return applyClaudeDefaultSelection(mergedFallback, [settingsModel, "claude-sonnet-5-5"]);
}

export function claudeExecutable(env = process.env) {
  return resolveProviderExecutables(env).claude;
}

export function claudeEnvironment(env = process.env, configDir = "", { platform = process.platform } = {}) {
  const out = { ...env };
  delete out.CLAUDECODE;
  delete out.CLAUDE_CODE_ENTRYPOINT;
  delete out.CLAUDE_CODE_SSE_PORT;
  if (configDir) {
    const resolvedDir = resolve(String(configDir));
    const defaultDir = resolve(resolveUserHome(env, platform, os.homedir()), ".claude");
    if (resolvedDir === defaultDir && !String(env?.CLAUDE_CONFIG_DIR || "").trim()) {
      delete out.CLAUDE_CONFIG_DIR;
    } else {
      out.CLAUDE_CONFIG_DIR = resolvedDir;
    }
  }
  return out;
}

function buildClaudePromptContent(text, images = []) {
  if (!images || !images.length) return String(text || "");
  const blocks = [];
  for (const image of images) {
    const src = typeof image === "string" ? image : (image?.dataUrl || image?.url || "");
    const match = src.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: match[1],
          data: match[2],
        },
      });
    }
  }
  if (String(text || "").trim() || !blocks.length) {
    blocks.push({ type: "text", text: String(text || "") });
  }
  return blocks;
}

export function buildClaudeCliArgs({
  rawId,
  isNewSession = false,
  model = "",
  effort = "",
  permissionMode = "workspace",
} = {}) {
  const cliPermMode = claudePermissionMode(permissionMode);
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
  ];
  if (isNewSession) {
    args.push("--session-id", rawId);
  } else {
    args.push("--resume", rawId);
  }
  if (model) {
    args.push("--model", model);
  }
  if (effort) {
    args.push("--effort", effort);
  }
  if (cliPermMode === "bypassPermissions") {
    args.push("--permission-mode", "bypassPermissions", "--dangerously-skip-permissions");
  } else {
    args.push("--permission-mode", cliPermMode, "--permission-prompt-tool", "stdio");
  }
  return args;
}

function summarizeClaudeToolTitle(toolName, input = {}) {
  if (toolName === "Bash") return "Claude 请求执行命令";
  if (toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit") {
    return "Claude 请求修改文件";
  }
  if (toolName === "AskUserQuestion") return "Claude 需要你做出选择";
  return `Claude 请求使用工具：${toolName}`;
}

export function normalizeClaudeControlRequest(msg, { rawThreadId = "" } = {}) {
  const reqId = String(msg.request_id || randomUUID());
  const req = msg.request || {};
  const toolName = String(req.tool_name || "");
  const input = req.input && typeof req.input === "object" ? req.input : {};

  if (toolName === "AskUserQuestion") {
    const rawQuestions = Array.isArray(input.questions) ? input.questions : [];
    const questions = rawQuestions.map((q, index) => ({
      id: String(q.id || q.question || `q_${index}`),
      header: String(q.header || `问题 ${index + 1}`),
      question: String(q.question || ""),
      isOther: q.isOther ?? true,
      multiSelect: Boolean(q.multiSelect),
      options: (Array.isArray(q.options) ? q.options : []).map((opt) => ({
        label: String(opt.label || opt),
        description: String(opt.description || ""),
      })),
    }));
    return {
      id: reqId,
      rawId: reqId,
      provider: "claude",
      method: "claude/askUserQuestion",
      kind: "userInput",
      title: "Claude 需要你回答以下问题",
      threadId: rawThreadId,
      toolName,
      toolUseId: req.tool_use_id || "",
      rawInput: input,
      questions,
    };
  }

  return {
    id: reqId,
    rawId: reqId,
    provider: "claude",
    method: "claude/canUseTool",
    kind: toolName === "Bash" ? "command" : ((toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit") ? "fileChange" : "toolApproval"),
    title: summarizeClaudeToolTitle(toolName, input),
    threadId: rawThreadId,
    toolName,
    toolUseId: req.tool_use_id || "",
    command: toolName === "Bash" ? String(input.command || "") : "",
    cwd: String(input.cwd || ""),
    filePath: String(input.file_path || input.path || ""),
    reason: String(req.decision_reason || req.blocked_path || ""),
    rawInput: input,
    permissionSuggestions: Array.isArray(req.permission_suggestions) ? req.permission_suggestions : [],
    availableDecisions: ["accept", "acceptForSession", "decline"],
  };
}

export class ClaudeTurnManager extends EventEmitter {
  #env;
  #platform;
  #spawnImpl;
  #activeRuns = new Map();
  #closed = false;

  constructor({ env = process.env, platform = process.platform, spawnImpl = spawn } = {}) {
    super();
    this.#env = env;
    this.#platform = platform;
    this.#spawnImpl = spawnImpl;
  }

  isRunning(rawId) {
    return this.#activeRuns.has(rawId);
  }

  getActiveTurn(rawId) {
    return this.#activeRuns.get(rawId) || null;
  }

  respondToControlRequest(rawId, request, input = {}) {
    const run = this.#activeRuns.get(rawId);
    if (!run || !run.proc?.stdin?.writable) {
      throw Object.assign(new Error("Claude 会话进程未处于等待输入状态"), { status: 409 });
    }
    let responsePayload;
    if (request.kind === "userInput") {
      const answers = {};
      for (const q of request.questions || []) {
        const entry = input.answers?.[q.id];
        const values = Array.isArray(entry?.answers)
          ? entry.answers
          : (Array.isArray(entry) ? entry : (entry ? [String(entry)] : []));
        if (values.length) {
          answers[q.question || q.id] = q.multiSelect ? values : values[0];
        }
      }
      responsePayload = {
        behavior: input.decision === "decline" || input.decision === "cancel" ? "deny" : "allow",
        ...(input.decision === "decline" || input.decision === "cancel"
          ? { message: "用户取消了回答" }
          : { updatedInput: { ...(request.rawInput || {}), answers } }),
      };
    } else {
      const decision = String(input.decision || "decline");
      const allowed = decision === "accept" || decision === "acceptForSession" || decision === "approved";
      if (allowed) {
        responsePayload = {
          behavior: "allow",
          updatedInput: request.rawInput || {},
          ...(decision === "acceptForSession" && request.permissionSuggestions?.length
            ? { updatedPermissions: request.permissionSuggestions }
            : {}),
        };
      } else {
        responsePayload = {
          behavior: "deny",
          message: String(input.message || "用户拒绝了本次工具调用"),
        };
      }
    }

    run.proc.stdin.write(`${JSON.stringify({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: request.rawId,
        response: responsePayload,
      },
    })}\n`);
    return { ok: true };
  }

  async runTurn({
    profileId = "default",
    configDir = "",
    rawId,
    isNewSession = false,
    cwd = os.homedir(),
    text = "",
    images = [],
    model = "",
    effort = "",
    permissionMode = "workspace",
  } = {}) {
    if (this.#closed) throw new Error("Claude 执行器已关闭");
    if (this.#activeRuns.has(rawId)) {
      throw Object.assign(new Error("Claude 会话当前正在运行，请等待完成或先中断"), {
        status: 409,
        code: "thread_busy",
      });
    }

    const turnId = `claude-turn-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const args = buildClaudeCliArgs({
      rawId,
      isNewSession,
      model,
      effort,
      permissionMode,
    });
    const effectiveCwd = cwd || resolveUserHome(this.#env, this.#platform, os.homedir());
    const prepared = prepareCrossPlatformSpawn(
      claudeExecutable(this.#env),
      args,
      {
        cwd: effectiveCwd,
        env: claudeEnvironment(this.#env, configDir),
        stdio: ["pipe", "pipe", "pipe"],
      },
      { platform: this.#platform },
    );
    const proc = this.#spawnImpl(prepared.command, prepared.args, prepared.options);
    proc.stdin?.on("error", () => {});

    const run = {
      profileId,
      rawId,
      turnId,
      proc,
      startedAt: Math.floor(Date.now() / 1000),
      buffer: "",
      stderrTail: [],
      userText: String(text || ""),
      lastText: "",
      interrupted: false,
      resultSeen: false,
      activeBlocks: new Map(),
      model,
    };
    this.#activeRuns.set(rawId, run);

    const previewBlocks = [];
    for (const img of Array.isArray(images) ? images : []) {
      if (img) previewBlocks.push({ type: "image", path: `🖼 ${img.name || "附件图片"}` });
    }
    if (String(text || "").trim() || !previewBlocks.length) {
      previewBlocks.push({ type: "text", text: String(text || "") });
    }

    this.emit("turnStarted", {
      profileId,
      rawId,
      turn: {
        id: turnId,
        status: "inProgress",
        startedAt: run.startedAt,
        model: model || "",
        effort: effort || "",
        items: [{
          type: "userMessage",
          id: `user-${turnId}`,
          content: previewBlocks,
        }],
      },
    });

    const completionPromise = new Promise((resolveDone) => {
      run.resolveDone = resolveDone;
    });

    const closeStdinSafely = () => {
      try {
        if (proc.stdin?.writable && !proc.stdin.destroyed) proc.stdin.end();
      } catch {}
    };

    const handleLine = (line) => {
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (!msg || typeof msg !== "object") return;

      if (msg.type === "system" && msg.subtype === "init") {
        if (msg.model) run.model = String(msg.model);
        this.emit("sessionInit", {
          profileId,
          rawId,
          turnId,
          sessionId: msg.session_id || rawId,
          model: msg.model || "",
          permissionMode: msg.permissionMode || "",
        });
        return;
      }

      if (msg.type === "stream_event" && msg.event) {
        this.#handleStreamEvent(run, msg.event);
        return;
      }

      if (msg.type === "assistant" && msg.message) {
        const content = Array.isArray(msg.message.content) ? msg.message.content : [];
        const hasToolUse = content.some((b) => b?.type === "tool_use");
        for (const block of content) {
          if (block?.type === "text" && block.text) {
            run.lastText = block.text;
            this.emit("assistantMessage", {
              profileId,
              rawId,
              turnId,
              item: {
                type: "agentMessage",
                id: `${msg.message.id || turnId}:text`,
                text: block.text,
                phase: hasToolUse ? "commentary" : "final_answer",
              },
            });
          } else if (block?.type === "thinking" && block.thinking) {
            this.emit("reasoningMessage", {
              profileId,
              rawId,
              turnId,
              item: {
                type: "reasoning",
                id: `${msg.message.id || turnId}:thinking`,
                summary: [block.thinking],
                content: [block.thinking],
              },
            });
          } else if (block?.type === "tool_use") {
            this.emit("toolUse", {
              profileId,
              rawId,
              turnId,
              toolUse: block,
            });
          }
        }
        if (hasToolUse) {
          run.lastText = "";
        }
        return;
      }

      if (msg.type === "user" && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block?.type === "tool_result") {
            this.emit("toolResult", {
              profileId,
              rawId,
              turnId,
              toolResult: block,
            });
          }
        }
        return;
      }

      if (msg.type === "control_request" && msg.request?.subtype === "can_use_tool") {
        const normalized = normalizeClaudeControlRequest(msg, { rawThreadId: rawId });
        this.emit("controlRequest", {
          profileId,
          rawId,
          turnId,
          request: normalized,
        });
        return;
      }

      if (msg.type === "result") {
        run.resultSeen = true;
        if (typeof msg.result === "string" && msg.result) {
          run.lastText = msg.result;
        }
        const status = run.interrupted
          ? "interrupted"
          : (msg.is_error || msg.subtype === "error" ? "failed" : "completed");
        closeStdinSafely();
        this.emit("turnCompleted", {
          profileId,
          rawId,
          turnId,
          status,
          lastAgentMessage: run.lastText,
          error: status === "failed" ? { message: msg.error || msg.result || "Claude 执行失败" } : null,
          durationMs: msg.duration_ms || null,
          result: msg,
        });
      }
    };

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk) => {
      run.buffer += chunk;
      while (true) {
        const idx = run.buffer.indexOf("\n");
        if (idx < 0) break;
        const line = run.buffer.slice(0, idx).trim();
        run.buffer = run.buffer.slice(idx + 1);
        if (line) handleLine(line);
      }
    });

    proc.stderr.setEncoding("utf8");
    proc.stderr.on("data", (chunk) => {
      run.stderrTail.push(chunk);
      if (run.stderrTail.length > 20) run.stderrTail.shift();
    });

    proc.on("error", (error) => {
      if (this.#activeRuns.get(rawId) === run) {
        this.#activeRuns.delete(rawId);
      }
      if (!run.resultSeen) {
        run.resultSeen = true;
        const message = (error?.code === "ENOENT" && effectiveCwd && !existsSync(effectiveCwd))
          ? `工作目录不存在：${effectiveCwd}`
          : (error?.message || "启动 claude CLI 失败");
        this.emit("turnCompleted", {
          profileId,
          rawId,
          turnId,
          status: "failed",
          lastAgentMessage: run.lastText,
          error: { message },
        });
      }
      run.resolveDone({ status: "failed", error });
    });

    proc.on("exit", (code, signal) => {
      if (run.killTimer) clearTimeout(run.killTimer);
      if (run.sigkillTimer) clearTimeout(run.sigkillTimer);
      if (run.buffer.trim()) handleLine(run.buffer.trim());
      if (this.#activeRuns.get(rawId) === run) {
        this.#activeRuns.delete(rawId);
      }
      if (!run.resultSeen) {
        const stderrText = run.stderrTail.join("").trim().slice(-300);
        const status = run.interrupted || signal === "SIGINT" ? "interrupted" : (code === 0 ? "completed" : "failed");
        const error = status === "failed"
          ? { message: stderrText || `claude 进程异常退出 (${code ?? signal})` }
          : null;
        this.emit("turnCompleted", {
          profileId,
          rawId,
          turnId,
          status,
          lastAgentMessage: run.lastText,
          error,
        });
        run.resolveDone({ status, lastAgentMessage: run.lastText, error });
      } else {
        run.resolveDone({ status: run.interrupted ? "interrupted" : "completed", lastAgentMessage: run.lastText });
      }
    });

    // Send user input immediately over stream-json stdin, keeping stdin open for control_response.
    const userPayload = {
      type: "user",
      message: {
        role: "user",
        content: buildClaudePromptContent(text, images),
      },
    };
    proc.stdin.write(`${JSON.stringify(userPayload)}\n`);

    return {
      turn: {
        id: turnId,
        status: "inProgress",
        startedAt: run.startedAt,
      },
      completionPromise,
    };
  }

  #handleStreamEvent(run, event) {
    const idx = event.index ?? 0;
    if (event.type === "content_block_start") {
      const block = event.content_block || {};
      if (block.type === "tool_use") {
        run.lastText = "";
      }
      const itemId = `${run.turnId}:blk:${idx}`;
      run.activeBlocks.set(idx, {
        itemId,
        type: block.type || "text",
        text: block.text || block.thinking || "",
        name: block.name || "",
      });
      this.emit("streamItemStart", {
        profileId: run.profileId,
        rawId: run.rawId,
        turnId: run.turnId,
        itemId,
        blockType: block.type || "text",
        toolName: block.name || "",
      });
    } else if (event.type === "content_block_delta") {
      const delta = event.delta || {};
      const entry = run.activeBlocks.get(idx) || { itemId: `${run.turnId}:blk:${idx}`, type: "text", text: "" };
      if (delta.type === "text_delta" && typeof delta.text === "string") {
        entry.text += delta.text;
        run.lastText = entry.text;
        this.emit("streamDelta", {
          profileId: run.profileId,
          rawId: run.rawId,
          turnId: run.turnId,
          itemId: entry.itemId,
          kind: "text",
          delta: delta.text,
        });
      } else if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
        this.emit("streamDelta", {
          profileId: run.profileId,
          rawId: run.rawId,
          turnId: run.turnId,
          itemId: entry.itemId,
          kind: "reasoning",
          delta: delta.thinking,
        });
      } else if (delta.type === "input_json_delta") {
        this.emit("streamDelta", {
          profileId: run.profileId,
          rawId: run.rawId,
          turnId: run.turnId,
          itemId: entry.itemId,
          kind: "toolInput",
          toolName: entry.name || "",
          delta: delta.partial_json || "",
        });
      }
      run.activeBlocks.set(idx, entry);
    }
  }

  async interrupt(rawId) {
    const run = this.#activeRuns.get(rawId);
    if (!run) return { ok: true, alreadyIdle: true };
    run.interrupted = true;
    if (normalizePlatform(this.#platform) === "win32") {
      killProcessTreeCrossPlatform(run.proc, { signal: "SIGTERM", platform: this.#platform });
    } else {
      try {
        run.proc.kill("SIGINT");
      } catch {}
      run.killTimer = setTimeout(() => {
        if (run.proc.exitCode === null) {
          killProcessTreeCrossPlatform(run.proc, { signal: "SIGTERM", platform: this.#platform });
        }
      }, 1_500);
      run.killTimer.unref?.();
      run.sigkillTimer = setTimeout(() => {
        if (run.proc.exitCode === null) {
          killProcessTreeCrossPlatform(run.proc, { signal: "SIGKILL", platform: this.#platform });
        }
      }, 3_500);
      run.sigkillTimer.unref?.();
    }
    return { ok: true, turnId: run.turnId };
  }

  async close() {
    this.#closed = true;
    for (const rawId of [...this.#activeRuns.keys()]) {
      await this.interrupt(rawId);
    }
    this.#activeRuns.clear();
  }
}

async function hasClaudeGatewayEnvConfig(configDir) {
  if (!configDir) return false;
  for (const name of ["settings.json", "settings.local.json"]) {
    try {
      const parsed = JSON.parse(await readFile(resolve(configDir, name), "utf8"));
      const envObj = parsed?.env;
      if (
        envObj
        && typeof envObj === "object"
        && (
          String(envObj.ANTHROPIC_BASE_URL || "").trim()
          || String(envObj.ANTHROPIC_AUTH_TOKEN || "").trim()
          || String(envObj.ANTHROPIC_API_KEY || "").trim()
        )
      ) {
        return true;
      }
    } catch {
      // Ignore missing or unreadable settings files.
    }
  }
  return false;
}

/**
 * Inspect `claude auth status --json` without invoking an LLM turn.
 */
export async function readClaudeCliAuthStatus({
  configDir = "",
  env = process.env,
  platform = process.platform,
  spawnImpl = spawn,
  timeoutMs = 4_000,
} = {}) {
  const prepared = prepareCrossPlatformSpawn(
    claudeExecutable(env),
    ["auth", "status", "--json"],
    {
      cwd: os.tmpdir(),
      env: claudeEnvironment(env, configDir, { platform }),
      stdio: ["ignore", "pipe", "pipe"],
    },
    { platform },
  );

  return new Promise((resolveAuth) => {
    let settled = false;
    let proc;
    const stdoutChunks = [];
    const stderrChunks = [];

    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolveAuth(value);
    };

    try {
      proc = spawnImpl(prepared.command, prepared.args, prepared.options);
    } catch {
      finish({ supported: false, loggedIn: false, rawError: "" });
      return;
    }

    const timer = setTimeout(() => {
      killProcessTreeCrossPlatform(proc, { signal: "SIGTERM", platform });
      finish({ supported: false, loggedIn: false, rawError: "" });
    }, timeoutMs);
    timer.unref?.();

    proc.stdout?.on("data", (chunk) => stdoutChunks.push(chunk.toString("utf8")));
    proc.stderr?.on("data", (chunk) => stderrChunks.push(chunk.toString("utf8")));
    proc.on("error", () => finish({ supported: false, loggedIn: false, rawError: "" }));
    proc.on("close", (code) => {
      const stdoutText = stdoutChunks.join("").trim();
      const stderrText = stderrChunks.join("").trim();
      try {
        const parsed = stdoutText ? JSON.parse(stdoutText) : null;
        if (parsed && typeof parsed === "object" && typeof parsed.loggedIn === "boolean") {
          finish({
            supported: true,
            loggedIn: Boolean(parsed.loggedIn),
            authMethod: String(parsed.authMethod || "none"),
            email: String(parsed.email || "").trim(),
            orgId: String(parsed.orgId || "").trim(),
            subscriptionType: String(parsed.subscriptionType || "").trim(),
            rawError: "",
          });
          return;
        }
      } catch {
        // Non-JSON stdout falls through to stderr/unsupported check.
      }
      if (code !== 0 && stderrText && !/unknown option|unknown command|unrecognized/i.test(stderrText)) {
        finish({ supported: true, loggedIn: false, rawError: stderrText });
        return;
      }
      finish({ supported: false, loggedIn: false, rawError: "" });
    });
  });
}

export async function probeClaudeProfile({
  configDir = "",
  env = process.env,
  platform = process.platform,
  spawnImpl = spawn,
  timeoutMs = 12_000,
  model = "claude-haiku-4-5",
  profile = null,
} = {}) {
  const started = Date.now();
  const hasGateway = configDir ? await hasClaudeGatewayEnvConfig(configDir) : false;

  if (!hasGateway) {
    const auth = await readClaudeCliAuthStatus({
      configDir,
      env,
      platform,
      spawnImpl,
      timeoutMs: Math.min(timeoutMs, 4_000),
    });
    if (auth.rawError) {
      throw new Error(auth.rawError);
    }
    if (auth.supported) {
      const boundEmail = String(profile?.cockpitAccount?.email || profile?.account?.email || "").trim();
      const profileId = String(profile?.id || "").trim() || "default";
      const emailArg = boundEmail ? ` --email ${boundEmail}` : "";
      if (auth.loggedIn) {
        if (boundEmail && auth.email && auth.email.toLowerCase() !== boundEmail.toLowerCase()) {
          const targetConfigDir = (!profile?.isDesktopInstance && profileId === "default")
            ? "~/.claude-default"
            : `~/.claude-${profileId}`;
          throw new Error(
            `401 CLI未登录目标账号：默认 CLI 当前登录为 ${auth.email}，与该实例绑定的 ${boundEmail} 不一致；请在终端执行 CLAUDE_CONFIG_DIR=${targetConfigDir} claude auth login${emailArg}`,
          );
        }
        return {
          ok: true,
          latencyMs: Math.max(1, Date.now() - started),
          email: auth.email || "",
        };
      }
      if (profile?.isDesktopInstance) {
        throw new Error(
          `401 CLI未登录：已识别桌面账号，但 CLI 需要单独授权；请使用对应桌面账号完成登录，在终端执行 CLAUDE_CONFIG_DIR=~/.claude-${profileId} claude auth login${emailArg}`,
        );
      }
      throw new Error(
        `401 CLI未登录：Claude 桌面 App 内置登录态不写入终端 CLI 凭证（桌面历史可正常读取）；请在终端执行 env -u CLAUDE_CONFIG_DIR claude auth login${emailArg}`,
      );
    }
  }

  const sessionId = randomUUID();
  const args = [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--session-id",
    sessionId,
    "--model",
    model,
    "--permission-mode",
    "plan",
  ];
  const prepared = prepareCrossPlatformSpawn(
    claudeExecutable(env),
    args,
    {
      cwd: os.tmpdir(),
      env: claudeEnvironment(env, configDir, { platform }),
      stdio: ["pipe", "pipe", "pipe"],
    },
    { platform },
  );
  const proc = spawnImpl(prepared.command, prepared.args, prepared.options);

  return new Promise((resolveProbe, rejectProbe) => {
    let settled = false;
    let resultEvent = null;
    const stderrTail = [];
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      killProcessTreeCrossPlatform(proc, { signal: "SIGTERM", platform });
      rejectProbe(new Error(`Claude 测通超时 (${timeoutMs}ms)`));
    }, timeoutMs);
    timer.unref?.();

    const finishOk = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveProbe({
        ok: true,
        latencyMs: Math.max(1, Date.now() - started),
      });
    };

    const finishErr = (message) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectProbe(new Error(String(message || "Claude 测通失败").trim()));
    };

    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      try {
        const msg = JSON.parse(line);
        if (msg?.type === "result") {
          resultEvent = msg;
          if (msg.is_error || msg.subtype === "error_during_execution") {
            finishErr(msg.result || msg.error || "Claude 返回错误");
          } else {
            finishOk();
          }
        }
      } catch {
        // Ignore non-JSON preamble.
      }
    });

    proc.stderr?.on("data", (chunk) => {
      const txt = chunk.toString("utf8").trim();
      if (txt) {
        stderrTail.push(txt);
        if (stderrTail.length > 6) stderrTail.shift();
      }
    });

    proc.on("error", (err) => finishErr(err?.message || "无法启动 Claude CLI"));
    proc.on("close", (code) => {
      if (settled) return;
      if (resultEvent && !resultEvent.is_error && code === 0) {
        finishOk();
        return;
      }
      const errText = resultEvent?.result || stderrTail.join(" ") || `Claude 退出码 ${code ?? "unknown"}`;
      finishErr(errText);
    });

    const probeMsg = `${JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: "[AGENT_CONTROL_PING] Reply with OK",
      },
    })}\n`;
    proc.stdin.write(probeMsg);
    proc.stdin.end();
  });
}
