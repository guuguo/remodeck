#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

async function runMockExecCli(argv) {
  const isResume = argv[0] === "resume";
  const rest = isResume ? argv.slice(1) : argv;
  let cwd = process.cwd();
  let model = "";
  let sandbox = "";
  let bypass = false;
  const configs = [];
  const images = [];
  const positionals = [];

  for (let i = 0; i < rest.length; i += 1) {
    const arg = rest[i];
    if (arg === "--json" || arg === "--skip-git-repo-check") continue;
    if (arg === "--dangerously-bypass-approvals-and-sandbox") {
      bypass = true;
      continue;
    }
    if (arg === "-C" || arg === "--cd") {
      cwd = rest[++i] || cwd;
      continue;
    }
    if (arg === "-m" || arg === "--model") {
      model = rest[++i] || "";
      continue;
    }
    if (arg === "-s" || arg === "--sandbox") {
      sandbox = rest[++i] || "";
      continue;
    }
    if (arg === "-c" || arg === "--config") {
      configs.push(rest[++i] || "");
      continue;
    }
    if (arg === "-i" || arg === "--image") {
      images.push(rest[++i] || "");
      continue;
    }
    positionals.push(arg);
  }

  let rawId = "";
  let promptArg = "";
  if (isResume) {
    rawId = positionals[0] || "";
    promptArg = positionals[1] || "";
  } else {
    promptArg = positionals[0] || "";
  }

  let prompt = promptArg;
  if (!prompt || prompt === "-") {
    prompt = await new Promise((resolveStdin) => {
      let data = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => { data += chunk; });
      process.stdin.on("end", () => resolveStdin(data));
      process.stdin.resume();
    });
  }

  const threadId = rawId || `01900000-0000-7000-8000-${String(Date.now()).slice(-12).padStart(12, "0")}`;
  const codexHome = process.env.CODEX_HOME || "";
  if (codexHome) {
    appendFileSync(
      resolve(codexHome, ".mock-exec-invocations.jsonl"),
      `${JSON.stringify({
        argv,
        isResume,
        cwd,
        model,
        sandbox,
        bypass,
        configs,
        images,
        rawId,
        threadId,
        prompt,
        hasOriginatorOverride: Object.hasOwn(process.env, "CODEX_INTERNAL_ORIGINATOR_OVERRIDE"),
      })}\n`,
      "utf8",
    );
  }

  const writeEv = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
  writeEv({ type: "thread.started", thread_id: threadId });
  writeEv({
    type: "item.completed",
    item: {
      id: "item_0",
      type: "error",
      message: `Model metadata for \`${model || "gpt-5.4"}\` not found. Defaulting to fallback metadata; this can degrade performance and cause issues.`,
    },
  });
  writeEv({ type: "turn.started" });

  if (prompt.includes("[SLOW]")) {
    await new Promise((resolveSlow) => {
      const timer = setTimeout(() => {
        const reply = `Codex exec 慢任务完成: ${prompt}`;
        writeEv({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: reply } });
        writeEv({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } });
        resolveSlow();
      }, 15_000);
      process.on("SIGTERM", () => {
        clearTimeout(timer);
        process.exit(143);
      });
    });
    process.exit(0);
  }

  if (prompt.includes("[EXEC_FAIL]")) {
    writeEv({ type: "turn.failed", error: { message: "mock exec failure" } });
    process.exit(1);
  }

  const reply = `Codex exec 已处理: ${prompt}`;
  if (codexHome) {
    appendFileSync(
      resolve(codexHome, ".mock-exec-turns.jsonl"),
      `${JSON.stringify({ threadId, prompt, reply })}\n`,
      "utf8",
    );
  }
  writeEv({ type: "item.completed", item: { id: "item_1", type: "agent_message", text: reply } });
  writeEv({ type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } });
  process.exit(0);
}

if (process.argv[2] === "exec") {
  void runMockExecCli(process.argv.slice(3));
} else {
  runMockAppServer();
}

function runMockAppServer() {

function readMockProbeError() {
  const home = process.env.CODEX_HOME || "";
  if (!home) return "";
  const errFile = resolve(home, ".mock-probe-error");
  if (!existsSync(errFile)) return "";
  return readFileSync(errFile, "utf8").trim() || "429 usage_limit exceeded";
}

const threads = new Map();
const loadedThreads = new Set();
const slowTurns = new Map();

function ensureThread(id, extra = {}) {
  if (!threads.has(id)) {
    threads.set(id, {
      id,
      name: extra.name || "",
      preview: extra.preview || "",
      cwd: extra.cwd || "/tmp/mock-codex-project",
      createdAt: Math.floor(Date.now() / 1000),
      updatedAt: Math.floor(Date.now() / 1000),
      model: extra.model || "gpt-5.4",
      reasoningEffort: extra.reasoningEffort || "medium",
      turns: [],
    });
  }
  return threads.get(id);
}

// Seed one historical thread for list/read verification.
const seeded = ensureThread("01900000-0000-7000-8000-000000000001", {
  name: "Mock Codex 历史会话",
  preview: "检查测试初始化",
});
seeded.turns.push({
  id: "turn-seed-1",
  status: "completed",
  startedAt: Math.floor(Date.now() / 1000) - 60,
  completedAt: Math.floor(Date.now() / 1000) - 55,
  items: [
    { type: "userMessage", id: "u-seed-1", content: [{ type: "text", text: "检查测试初始化" }] },
    { type: "agentMessage", id: "a-seed-1", text: "Mock Codex 历史回复正常", phase: "final_answer" },
  ],
});

let nextServerReqId = 1000;
const pendingServerReqs = new Map();

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function askClient(method, params) {
  const id = `codex-srv-${nextServerReqId++}`;
  return new Promise((resolve) => {
    pendingServerReqs.set(id, resolve);
    send({ id, method, params });
  });
}

async function runTurnBehavior(thread, turn, text) {
  send({ method: "turn/started", params: { threadId: thread.id, turn } });

  if (text.includes("[REQUEST_APPROVAL]")) {
    const decisionRes = await askClient("item/commandExecution/requestApproval", {
      threadId: thread.id,
      turnId: turn.id,
      itemId: `cmd-${turn.id}`,
      command: "echo approved",
      cwd: thread.cwd,
      reason: "测试 Codex 命令审批",
    });
    const reply = `Codex 审批结果: ${decisionRes?.decision || "unknown"}`;
    send({ method: "item/agentMessage/delta", params: { threadId: thread.id, turnId: turn.id, delta: reply } });
    turn.items.push({ type: "agentMessage", id: `a-${turn.id}`, text: reply, phase: "final_answer" });
    turn.status = "completed";
    send({ method: "turn/completed", params: { threadId: thread.id, turn } });
    return;
  }

  if (text.includes("[ASK_INPUT]")) {
    const answerRes = await askClient("item/tool/requestUserInput", {
      threadId: thread.id,
      turnId: turn.id,
      itemId: `input-${turn.id}`,
      questions: [{
        id: "framework",
        header: "选择方案",
        question: "请选择要使用的测试方案？",
        options: [
          { label: "方案 A", description: "快速验证" },
          { label: "方案 B", description: "完整检查" },
        ],
      }],
    });
    const picked = answerRes?.answers?.framework?.answers?.join(", ") || "none";
    const reply = `收到输入: ${picked}`;
    turn.items.push({ type: "agentMessage", id: `a-${turn.id}`, text: reply, phase: "final_answer" });
    turn.status = "completed";
    send({ method: "turn/completed", params: { threadId: thread.id, turn } });
    return;
  }

  if (text.includes("[SLOW]")) {
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (!slowTurns.has(turn.id)) return;
        slowTurns.delete(turn.id);
        turn.status = "completed";
        const reply = "慢任务正常完成";
        turn.items.push({ type: "agentMessage", id: `a-${turn.id}`, text: reply, phase: "final_answer" });
        send({ method: "turn/completed", params: { threadId: thread.id, turn } });
        resolve();
      }, 15_000);
      slowTurns.set(turn.id, {
        interrupt() {
          clearTimeout(timer);
          slowTurns.delete(turn.id);
          turn.status = "interrupted";
          send({ method: "turn/completed", params: { threadId: thread.id, turn } });
          resolve();
        },
        steer(steerText) {
          clearTimeout(timer);
          slowTurns.delete(turn.id);
          const reply = `已按插话处理: ${steerText}`;
          turn.items.push({ type: "agentMessage", id: `a-${turn.id}`, text: reply, phase: "final_answer" });
          turn.status = "completed";
          send({ method: "turn/completed", params: { threadId: thread.id, turn } });
          resolve();
        },
      });
    });
    return;
  }

  if (text.includes("[OFFICIAL_CLIENT_ONLY]")) {
    const errDetail = "unexpected status 403 Forbidden: This account only allows Codex official clients, url: http://127.0.0.1:3425/v1/responses";
    send({
      method: "error",
      params: {
        error: {
          message: "Reconnecting... 1/5",
          codexErrorInfo: { responseStreamDisconnected: { httpStatusCode: 403 } },
          additionalDetails: errDetail,
        },
        willRetry: true,
        threadId: thread.id,
        turnId: turn.id,
      },
    });
    turn.status = "failed";
    turn.error = { message: errDetail };
    send({ method: "turn/completed", params: { threadId: thread.id, turn } });
    return;
  }

  const isGoalContinuation = text.includes("[Goal 自动推进");
  let reply = `Codex 已处理: ${text}`;
  if (text.includes("[GOAL_TWO_STEPS]") && !isGoalContinuation) {
    reply = "第一阶段已完成，还需要下一步验证。";
  } else if (isGoalContinuation || text.includes("[COMPLETE_NOW]")) {
    reply = "所有目标均已完成并验证。\n<!-- GOAL_COMPLETE -->";
  }
  send({ method: "item/agentMessage/delta", params: { threadId: thread.id, turnId: turn.id, delta: reply } });
  const msgItem = { type: "agentMessage", id: `a-${turn.id}`, text: reply, phase: "final_answer" };
  turn.items.push(msgItem);
  turn.status = "completed";
  send({ method: "item/completed", params: { threadId: thread.id, turnId: turn.id, item: msgItem } });
  send({ method: "turn/completed", params: { threadId: thread.id, turn } });
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  // Client response to serverRequest.
  if (msg.id !== undefined && !msg.method) {
    const resolveReq = pendingServerReqs.get(String(msg.id));
    if (resolveReq) {
      pendingServerReqs.delete(String(msg.id));
      resolveReq(msg.result);
    }
    return;
  }

  const { id, method, params = {} } = msg;
  if (method === "initialized") return;

  if (method === "initialize") {
    send({ id, result: { serverInfo: { name: "mock-codex", version: "0.0.1" } } });
    return;
  }

  if (method === "model/list") {
    const mockErr = readMockProbeError();
    if (mockErr) {
      send({ id, error: { code: -32000, message: mockErr } });
      return;
    }
    send({
      id,
      result: {
        data: [
          {
            id: "gpt-5.4",
            model: "gpt-5.4",
            displayName: "gpt-5.4",
            isDefault: true,
            defaultReasoningEffort: "medium",
            supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "medium" }, { reasoningEffort: "high" }],
          },
          {
            id: "gpt-5.3-codex",
            model: "gpt-5.3-codex",
            displayName: "gpt-5.3-codex",
            isDefault: false,
            defaultReasoningEffort: "high",
            supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "high" }],
          },
        ],
      },
    });
    return;
  }

  if (method === "thread/list") {
    send({ id, result: { data: [...threads.values()] } });
    return;
  }

  if (method === "thread/start") {
    const mockErr = readMockProbeError();
    if (mockErr) {
      send({ id, error: { code: -32000, message: mockErr } });
      return;
    }
    const threadId = `01900000-0000-7000-8000-${String(threads.size + 10).padStart(12, "0")}`;
    const thread = ensureThread(threadId, params);
    loadedThreads.add(threadId);
    send({ id, result: { thread } });
    return;
  }

  if (method === "thread/resume") {
    const resumeErrFile = resolve(process.env.CODEX_HOME || "", ".mock-resume-error");
    if (existsSync(resumeErrFile)) {
      send({ id, error: { code: -32000, message: readFileSync(resumeErrFile, "utf8").trim() } });
      return;
    }
    const thread = ensureThread(params.threadId, params);
    if (thread.archived) {
      send({
        id,
        error: {
          code: -32000,
          message: `session ${params.threadId} is archived. Run \`codex unarchive ${params.threadId}\` to unarchive it first.`,
        },
      });
      return;
    }
    loadedThreads.add(params.threadId);
    send({ id, result: { thread } });
    return;
  }

  if (method === "thread/read") {
    const thread = ensureThread(params.threadId);
    const execTurnsFile = resolve(process.env.CODEX_HOME || "", ".mock-exec-turns.jsonl");
    if (thread.turns.length === 0 && process.env.CODEX_HOME && existsSync(execTurnsFile)) {
      const execRows = readFileSync(execTurnsFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((row) => row.threadId === params.threadId);
      if (execRows.length) {
        thread.turns = execRows.map((row, idx) => ({
          id: `exec-recorded-${idx + 1}`,
          status: "completed",
          items: [
            { type: "userMessage", id: `u-exec-${idx + 1}`, content: [{ type: "text", text: row.prompt }] },
            { type: "agentMessage", id: `a-exec-${idx + 1}`, text: row.reply, phase: "final_answer" },
          ],
        }));
      }
    }
    send({ id, result: { thread } });
    return;
  }

  if (method === "turn/start") {
    const policyFile = resolve(process.env.CODEX_HOME || "", ".mock-expected-turn-policy");
    if (existsSync(policyFile)) {
      const expected = JSON.parse(readFileSync(policyFile, "utf8"));
      const actual = { approvalPolicy: params.approvalPolicy, sandboxPolicy: params.sandboxPolicy };
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        send({ id, error: { code: -32000, message: `Unexpected turn policy: ${JSON.stringify(actual)}` } });
        return;
      }
    }
    const errorFile = resolve(process.env.CODEX_HOME || "", ".mock-turn-start-error");
    if (existsSync(errorFile)) {
      send({ id, error: { code: -32000, message: readFileSync(errorFile, "utf8").trim() } });
      return;
    }
    const thread = ensureThread(params.threadId);
    const text = (params.input || []).filter((i) => i.type === "text").map((i) => i.text).join("\n");
    const turnId = `turn-${Date.now()}-${thread.turns.length + 1}`;
    const turn = {
      id: turnId,
      status: "inProgress",
      startedAt: Math.floor(Date.now() / 1000),
      items: [{ type: "userMessage", id: `u-${turnId}`, content: [{ type: "text", text }] }],
    };
    thread.turns.push(turn);
    thread.updatedAt = Math.floor(Date.now() / 1000);
    if (!thread.preview) thread.preview = text.slice(0, 80);
    send({ id, result: { turn } });
    setImmediate(() => void runTurnBehavior(thread, turn, text));
    return;
  }

  if (method === "turn/steer") {
    if (!loadedThreads.has(params.threadId)) {
      send({ id, error: { code: -32000, message: `thread not found: ${params.threadId}` } });
      return;
    }
    if (String(params.expectedTurnId || "").startsWith("stale-") && !slowTurns.has(params.expectedTurnId)) {
      send({ id, error: { code: -32000, message: `no active turn: ${params.expectedTurnId}` } });
      return;
    }
    const text = (params.input || []).filter((i) => i.type === "text").map((i) => i.text).join("\n");
    const handler = slowTurns.get(params.expectedTurnId);
    send({ id, result: { turnId: params.expectedTurnId } });
    if (handler) setImmediate(() => handler.steer(text));
    return;
  }

  if (method === "turn/interrupt") {
    const handler = slowTurns.get(params.turnId);
    send({ id, result: { ok: true } });
    if (handler) setImmediate(() => handler.interrupt());
    return;
  }

  if (method === "thread/name/set") {
    const t = threads.get(params.threadId);
    if (t) t.name = params.name;
    send({ id, result: { ok: true } });
    return;
  }

  if (method === "thread/archive") {
    const t = threads.get(params.threadId);
    if (t) t.archived = true;
    send({ id, result: { ok: true } });
    return;
  }

  if (method === "thread/unarchive") {
    const unsupportedFile = resolve(process.env.CODEX_HOME || "", ".mock-unarchive-unsupported");
    if (existsSync(unsupportedFile)) {
      send({ id, error: { code: -32601, message: "Method not found" } });
      return;
    }
    const t = threads.get(params.threadId);
    if (t) t.archived = false;
    send({ id, result: { ok: true } });
    return;
  }

  if (method === "account/login/start") {
    const loginId = "mock-login-1";
    const authUrl = "https://auth.openai.com/authorize?mock=1";
    send({ id, result: { type: "chatgpt", authUrl, loginId } });
    const home = process.env.CODEX_HOME || "";
    const emailHintFile = home ? resolve(home, ".mock-auto-login-email") : "";
    if (emailHintFile && existsSync(emailHintFile)) {
      const email = readFileSync(emailHintFile, "utf8").trim() || "alt@example.com";
      const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({ name: "Alt User", email })).toString("base64url");
      writeFileSync(
        resolve(home, "auth.json"),
        `${JSON.stringify({ tokens: { id_token: `${header}.${payload}.mock` } }, null, 2)}\n`,
        "utf8",
      );
      setImmediate(() => {
        send({ method: "account/updated", params: { authMode: "chatgpt", planType: "pro" } });
        send({ method: "account/login/completed", params: { loginId, success: true, error: null } });
      });
    }
    return;
  }

  send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
});
}
