#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import { resolve } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const readArg = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : "";
};

const configDir = process.env.CLAUDE_CONFIG_DIR || resolve(os.homedir(), ".claude");
if (args[0] === "auth" && args[1] === "status") {
  if (configDir && existsSync(resolve(configDir, ".mock-probe-error"))) {
    const errText = readFileSync(resolve(configDir, ".mock-probe-error"), "utf8").trim() || "401 unauthorized invalid api key";
    if (/CLI_LOGGED_OUT/i.test(errText)) {
      process.stdout.write(`${JSON.stringify({ loggedIn: false, authMethod: "none" })}\n`);
      process.exit(1);
    }
    process.stderr.write(`${errText}\n`);
    process.exit(1);
  }
  if (configDir && existsSync(resolve(configDir, ".mock-auth-status.json"))) {
    process.stdout.write(`${readFileSync(resolve(configDir, ".mock-auth-status.json"), "utf8").trim()}\n`);
    process.exit(0);
  }
  process.stdout.write(`${JSON.stringify({ loggedIn: true, authMethod: "claude.ai", email: "" })}\n`);
  process.exit(0);
}

const sessionId = readArg("--session-id") || readArg("--resume") || "mock-claude-session";
const model = readArg("--model") || "claude-sonnet-4-6";
const pendingControl = new Map();
let interrupted = false;

function writeJsonl(obj) {
  if (!configDir) return;
  const dir = resolve(configDir, "projects", "-tmp-mock-claude");
  mkdirSync(dir, { recursive: true });
  appendFileSync(resolve(dir, `${sessionId}.jsonl`), `${JSON.stringify({
    ...obj,
    sessionId,
    cwd: process.cwd(),
    timestamp: new Date().toISOString(),
  })}\n`);
}

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function requestControl(subtype, requestPayload) {
  const request_id = `ctrl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return new Promise((resolveReq) => {
    pendingControl.set(request_id, resolveReq);
    send({
      type: "control_request",
      request_id,
      request: {
        subtype,
        ...requestPayload,
      },
    });
  });
}

process.on("SIGINT", () => {
  interrupted = true;
  send({
    type: "result",
    subtype: "error_during_execution",
    is_error: false,
    session_id: sessionId,
    result: "",
  });
  process.exit(130);
});

async function handleUserTurn(userMsg) {
  const content = userMsg?.message?.content;
  const text = typeof content === "string"
    ? content
    : (Array.isArray(content) ? content.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "");

  if (configDir && existsSync(resolve(configDir, ".mock-probe-error"))) {
    const errText = readFileSync(resolve(configDir, ".mock-probe-error"), "utf8").trim() || "401 unauthorized invalid api key";
    send({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      session_id: sessionId,
      result: errText,
    });
    process.exit(1);
    return;
  }

  writeJsonl({ type: "user", uuid: `u-${Date.now()}`, message: { role: "user", content } });

  send({
    type: "system",
    subtype: "init",
    session_id: sessionId,
    model,
    cwd: process.cwd(),
    tools: ["Bash", "Edit", "Read", "AskUserQuestion"],
  });

  if (text.includes("[CLAUDE_APPROVAL]")) {
    const res = await requestControl("can_use_tool", {
      tool_name: "Bash",
      tool_use_id: "toolu_bash_1",
      input: { command: "ls -la" },
      decision_reason: "测试 Claude 命令权限审批",
    });
    const behavior = res?.behavior || "deny";
    const reply = `Claude 工具权限决策: ${behavior}`;
    send({
      type: "assistant",
      message: { id: "msg_1", role: "assistant", model, content: [{ type: "text", text: reply }] },
    });
    writeJsonl({ type: "assistant", uuid: `a-${Date.now()}`, message: { id: "msg_1", role: "assistant", model, content: [{ type: "text", text: reply }] } });
    send({ type: "result", subtype: "success", is_error: false, session_id: sessionId, result: reply, duration_ms: 42 });
    return;
  }

  if (text.includes("[ASK_USER]")) {
    const res = await requestControl("can_use_tool", {
      tool_name: "AskUserQuestion",
      tool_use_id: "toolu_ask_1",
      input: {
        questions: [{
          header: "实现方式",
          question: "请确认测试选项",
          multiSelect: false,
          options: [
            { label: "单元测试", description: "快速反馈" },
            { label: "集成测试", description: "全链路检查" },
          ],
        }],
      },
    });
    const ans = JSON.stringify(res?.updatedInput?.answers || {});
    const reply = `Claude 收到问答: ${ans}`;
    send({
      type: "assistant",
      message: { id: "msg_ask", role: "assistant", model, content: [{ type: "text", text: reply }] },
    });
    writeJsonl({ type: "assistant", uuid: `a-${Date.now()}`, message: { id: "msg_ask", role: "assistant", model, content: [{ type: "text", text: reply }] } });
    send({ type: "result", subtype: "success", is_error: false, session_id: sessionId, result: reply, duration_ms: 35 });
    return;
  }

  if (text.includes("[SLOW]")) {
    await new Promise((r) => setTimeout(r, 15_000));
    if (interrupted) return;
  }

  const isGoalContinuation = text.includes("[Goal 自动推进");
  let reply = `Claude 回复: ${text}`;
  if (text.includes("[GOAL_TWO_STEPS]") && !isGoalContinuation) {
    reply = "Claude 第一阶段完成，仍需收尾。";
  } else if (isGoalContinuation || text.includes("[COMPLETE_NOW]")) {
    reply = "Claude 目标全部完成。\n<!-- GOAL_COMPLETE -->";
  }

  // Emit streaming deltas first, then full assistant message + result.
  send({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } } });
  send({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "分析请求中…" } } });
  send({ type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } } });
  const mid = Math.max(1, Math.floor(reply.length / 2));
  send({ type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: reply.slice(0, mid) } } });
  send({ type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "text_delta", text: reply.slice(mid) } } });

  const msgObj = {
    id: `msg_${Date.now()}`,
    role: "assistant",
    model,
    content: [
      { type: "thinking", thinking: "分析请求中…" },
      { type: "text", text: reply },
    ],
  };
  send({ type: "assistant", message: msgObj });
  writeJsonl({ type: "assistant", uuid: `a-${Date.now()}`, message: msgObj });
  const rateLimitPath = configDir ? resolve(configDir, ".mock-rate-limit.json") : "";
  if (rateLimitPath && existsSync(rateLimitPath)) {
    const info = JSON.parse(readFileSync(rateLimitPath, "utf8"));
    send({
      type: "rate_limit_event",
      rate_limit_info: info,
      session_id: sessionId,
    });
  } else if (text.includes("[RATE_LIMIT]")) {
    const nowSec = Math.floor(Date.now() / 1000);
    send({
      type: "rate_limit_event",
      rate_limit_info: {
        status: "allowed",
        resetsAt: nowSec + 3600,
        rateLimitType: "five_hour",
        unifiedWindows: {
          five_hour: { utilization: 0.75, resetsAt: nowSec + 3600, status: "allowed" },
          seven_day: { utilization: 0.34, resetsAt: nowSec + 86400 * 3, status: "allowed" },
        },
      },
      session_id: sessionId,
    });
  }
  send({
    type: "result",
    subtype: "success",
    is_error: false,
    session_id: sessionId,
    result: reply,
    duration_ms: 25,
  });
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
  if (msg.type === "control_response") {
    const reqId = msg.response?.request_id;
    const cb = pendingControl.get(reqId);
    if (cb) {
      pendingControl.delete(reqId);
      cb(msg.response?.response);
    }
    return;
  }
  if (msg.type === "user") {
    void handleUserTurn(msg).then(() => process.exit(0));
  }
});
