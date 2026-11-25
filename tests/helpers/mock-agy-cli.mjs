#!/usr/bin/env node
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { createInterface } from "node:readline";
import { mockVoiceCoordinatorResponse } from "./mock-voice-coordinator.mjs";

const args = process.argv.slice(2);
const skipPermissionsFlag = args.includes("--dangerously-skip-permissions");
if (args[0] === "models") {
  process.stdout.write([
    "gemini-pro-orchestrator        Orchestrator (Carbon)",
    "gemini-4-carbon-high           Gemini 4 Carbon (High)",
    "gemini-4-carbon-medium         Gemini 4 Carbon (Medium)",
    "gemini-4-hydrogen-low          Gemini 4 Hydrogen (Low)",
    "gemini-4-hydrogen-medium       Gemini 4 Hydrogen (Medium)",
    "claude-opus-5-5-medium         Claude Opus 5.5 (Medium)",
  ].join("\n") + "\n");
  process.exit(0);
}

function readFlagValue(argv, names) {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    for (const name of names) {
      if (arg === name && i + 1 < argv.length) return argv[i + 1];
      if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
    }
  }
  return "";
}

const appDataDirArg = readFlagValue(args, ["--app-data-dir", "--app_data_dir"]);
const geminiDirArg = readFlagValue(args, ["--gemini-dir", "--gemini_dir"]);
const absolutePathViolation = [appDataDirArg, geminiDirArg].find((v) => v && isAbsolute(v)) || "";

const sessions = new Map();
sessions.set("agy-seed-session-1", {
  sessionId: "agy-seed-session-1",
  cwd: "/tmp/mock-agy-project",
  title: "Mock Antigravity 历史对话",
  updatedAt: new Date().toISOString(),
  mode: "accept-edits",
  model: "gemini-4-carbon",
  thought_level: "high",
});

const pendingPerm = new Map();
const activeCancelHandlers = new Map();
let permCounter = 1;

function send(obj) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...obj })}\n`);
}

function askPermission(sessionId, title) {
  if (skipPermissionsFlag) {
    return Promise.resolve({ outcome: { outcome: "selected", optionId: "allow_always" } });
  }
  const id = `agy-perm-${permCounter++}`;
  return new Promise((resolve) => {
    pendingPerm.set(id, resolve);
    send({
      id,
      method: "session/request_permission",
      params: {
        sessionId,
        title,
        options: [
          { optionId: "allow_once", name: "Allow Once", kind: "allow_once" },
          { optionId: "allow_always", name: "Allow Always", kind: "allow_always" },
          { optionId: "reject_once", name: "Reject Once", kind: "reject_once" },
        ],
      },
    });
  });
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", async (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.id !== undefined && !msg.method) {
    const cb = pendingPerm.get(String(msg.id));
    if (cb) {
      pendingPerm.delete(String(msg.id));
      cb(msg.result);
    }
    return;
  }

  const { id, method, params = {} } = msg;

  if (method === "initialize") {
    if (absolutePathViolation) {
      send({
        id,
        error: {
          code: -32603,
          message: `Failed to start Antigravity: language server failed to start: must not be absolute: ${absolutePathViolation}`,
        },
      });
      return;
    }
    send({ id, result: { protocolVersion: 1, agentCapabilities: { loadSession: true } } });
    return;
  }

  if (method === "session/list") {
    send({ id, result: { sessions: [...sessions.values()] } });
    return;
  }

  if (method === "session/new") {
    const sessionId = `agy-sess-${sessions.size + 1}`;
    const entry = {
      sessionId,
      cwd: params.cwd || "/tmp/mock-agy-project",
      title: "",
      updatedAt: new Date().toISOString(),
      mode: "accept-edits",
      model: "gemini-4-carbon",
      thought_level: "high",
    };
    sessions.set(sessionId, entry);
    send({
      id,
      result: {
        sessionId,
        configOptions: [
          { id: "model", currentValue: entry.model },
          { id: "thought_level", currentValue: entry.thought_level },
          { id: "mode", currentValue: entry.mode },
        ],
      },
    });
    return;
  }

  if (method === "session/load") {
    const sessionId = params.sessionId;
    // Intentionally emit historical replay updates BEFORE responding to session/load!
    send({
      method: "session/update",
      params: {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "HISTORICAL_REPLAY_SHOULD_BE_SUPPRESSED" },
        },
      },
    });
    send({ id, result: { loaded: true } });
    return;
  }

  if (method === "session/set_mode") {
    const s = sessions.get(params.sessionId);
    if (s) s.mode = params.modeId;
    send({ id, result: {} });
    return;
  }

  if (method === "session/set_config_option") {
    const s = sessions.get(params.sessionId);
    if (s && params.configId) s[params.configId] = params.value;
    send({ id, result: {} });
    return;
  }

  if (method === "session/cancel") {
    const handler = activeCancelHandlers.get(params.sessionId);
    if (handler) handler();
    return;
  }

  if (method === "session/prompt") {
    const sessionId = params.sessionId;
    const text = (params.prompt || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (process.env.MOCK_AGY_PROMPT_LOG) {
      appendFileSync(process.env.MOCK_AGY_PROMPT_LOG, `${JSON.stringify({ sessionId, text })}\n`);
    }

    if (text.trim() === "/compact") {
      if (process.env.MOCK_AGY_FAIL_COMPACT === "1") {
        send({ id, error: { code: -32001, message: "mock compact failed" } });
        return;
      }
      send({
        method: "session/update",
        params: {
          sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "COMPACT_SUMMARY_SHOULD_NOT_LEAK" } },
        },
      });
      send({ id, result: { stopReason: "end_turn" } });
      return;
    }

    if (text.includes("[AC_VOICE_CALL]")) {
      if (process.env.MOCK_VOICE_COORDINATOR_RESPONSE) {
        send({ method: "session/update", params: { sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: process.env.MOCK_VOICE_COORDINATOR_RESPONSE } },
        } });
        send({ id, result: { stopReason: "end_turn" } });
        return;
      }
      const readMatch = text.match(/read_file\("([^"]+)"\)/);
      let audioValid = true;
      let audioError = "";
      if (readMatch?.[1]) {
        const permOutcome = await askPermission(sessionId, "读取语音文件");
        const permId = permOutcome?.outcome?.optionId || "";
        if (!permId || permId === "cancelled") {
          audioValid = false;
          audioError = "读取语音权限被拒绝";
        } else {
          try {
            const wavBuf = readFileSync(readMatch[1]);
            if (wavBuf.subarray(0, 4).toString("ascii") !== "RIFF" || wavBuf.subarray(8, 12).toString("ascii") !== "WAVE") {
              audioValid = false;
              audioError = "音频不是合法 WAV 格式";
            }
          } catch (err) {
            audioValid = false;
            audioError = `无法读取音频文件: ${err?.message || "unknown"}`;
          }
        }
      }

      let snapshot = { projects: [], pendingRequests: [] };
      const snapMatch = text.match(/<LIVE_CONTROL_SNAPSHOT>\r?\n([\s\S]*?)\r?\n<\/LIVE_CONTROL_SNAPSHOT>/);
      if (snapMatch?.[1]) {
        try {
          snapshot = JSON.parse(snapMatch[1]);
        } catch {
          // ignore malformed test snapshot
        }
      }

      let plan;
      const cannedPlan = mockVoiceCoordinatorResponse(text, snapshot);
      if (cannedPlan) {
        plan = cannedPlan;
      } else if (!audioValid) {
        plan = {
          heardText: "",
          intent: "summarize_progress",
          targetProjectCwd: "",
          targetThreadId: "",
          provider: "",
          instruction: "",
          requestId: "",
          decision: "",
          spokenReply: audioError,
        };
      } else if (text.includes("用户点击了【播报最新进度】")) {
        const projCount = Array.isArray(snapshot.projects) ? snapshot.projects.length : 0;
        plan = {
          heardText: "播报当前任务进度",
          intent: "summarize_progress",
          targetProjectCwd: "",
          targetThreadId: "",
          provider: "",
          instruction: "",
          requestId: "",
          decision: "",
          spokenReply: `当前共有 ${projCount} 个活跃项目，一切运行正常。`,
        };
      } else {
        const userLine = text.match(/(?:用户补充输入|用户说)：([^\n]+)/)?.[1] || "";
        const targetProj = (snapshot.projects || []).find((p) => Array.isArray(p.threads) && p.threads.length > 0 && p.name && userLine.includes(p.name))
          || (snapshot.projects || []).find((p) => Array.isArray(p.threads) && p.threads.length > 0)
          || snapshot.projects?.[0]
          || null;
        const targetThread = targetProj?.threads?.[0] || null;
        if (targetProj && targetThread) {
          plan = {
            heardText: `给 ${targetProj.name} 继续跑回归测试`,
            intent: "send_turn",
            targetProjectCwd: targetProj.cwd,
            targetThreadId: targetThread.id,
            provider: targetThread.provider || "antigravity",
            instruction: "继续跑回归测试",
            requestId: "",
            decision: "",
            spokenReply: `好的，已通知 ${targetProj.name} 继续跑回归测试。`,
          };
        } else {
          plan = {
            heardText: "查看当前任务进度",
            intent: "summarize_progress",
            targetProjectCwd: "",
            targetThreadId: "",
            provider: "",
            instruction: "",
            requestId: "",
            decision: "",
            spokenReply: "目前没有进行中的任务。",
          };
        }
      }

      send({
        method: "session/update",
        params: {
          sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: JSON.stringify(plan) } },
        },
      });
      send({ id, result: { stopReason: "end_turn" } });
      return;
    }

    if (text.includes("[AGY_BG_WAKEUP_PERMISSION]")) {
      const outMatch = text.match(/\[OUT:([^\]]+)\]/);
      send({ id, result: { stopReason: "end_turn" } });
      setTimeout(async () => {
        const outcome = await askPermission(sessionId, "后台唤醒跨目录读取");
        const optId = outcome?.outcome?.optionId || "cancelled";
        if (outMatch?.[1]) {
          writeFileSync(outMatch[1], `bg_approved:${optId}:${skipPermissionsFlag}`);
        }
      }, 20);
      return;
    }

    if (text.includes("[LARGE_TOOL_UPDATE]")) {
      send({
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "tc-large-1",
            title: "读取桌面大图",
            kind: "read",
            status: `completed:${"S".repeat(800)}`,
            rawOutput: `data:image/png;base64,${"B".repeat(50_000)}`,
            rawInput: { blob: "I".repeat(50_000) },
            content: [{ type: "image", data: "C".repeat(40_000) }],
            locations: [{ path: "/tmp/big.png" }],
          },
        },
      });
      send({
        method: "session/update",
        params: {
          sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "大图工具已精简完成。" } },
        },
      });
      send({ id, result: { stopReason: "end_turn" } });
      return;
    }

    if (text.includes("[STALE_AFTER_DONE]")) {
      send({
        method: "session/update",
        params: {
          sessionId,
          update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "主回合完成。" } },
        },
      });
      send({ id, result: { stopReason: "end_turn" } });
      setTimeout(() => {
        send({
          method: "session/update",
          params: {
            sessionId,
            update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "STALE_IDLE_DELTA_SHOULD_NOT_BROADCAST" } },
          },
        });
        send({
          method: "session/update",
          params: {
            sessionId,
            update: {
              sessionUpdate: "tool_call_update",
              toolCallId: "tc-stale-1",
              title: "STALE_IDLE_TOOL_SHOULD_NOT_BROADCAST",
              status: "completed",
            },
          },
        });
      }, 40);
      return;
    }

    if (text.includes("[AGY_PERMISSION]")) {
      const outcome = await askPermission(sessionId, "Antigravity 请求执行敏感命令");
      const optId = outcome?.outcome?.optionId || "cancelled";
      send({
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `Antigravity 授权结果: ${optId}` },
          },
        },
      });
      send({ id, result: { stopReason: "end_turn" } });
      return;
    }

    if (text.includes("[AGY_SUBAGENT_PERMISSION")) {
      const subMatch = text.match(/\[AGY_SUBAGENT_PERMISSION(?::([^\]]+))?\]/);
      const subSessionId = subMatch?.[1] || "subagent-child-1";
      const outcome = await askPermission(subSessionId, "Antigravity 子代理请求执行命令");
      const optId = outcome?.outcome?.optionId || "cancelled";
      send({
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: `子代理授权结果: ${optId}` },
          },
        },
      });
      send({ id, result: { stopReason: "end_turn" } });
      return;
    }

    if (text.includes("[HANG_CANCEL]")) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          activeCancelHandlers.delete(sessionId);
          send({ id, result: { stopReason: "end_turn" } });
          resolve();
        }, 20_000);
        timer.unref?.();
        activeCancelHandlers.set(sessionId, () => {
          // Intentionally hang on session/cancel to test force-release interrupt handling.
        });
      });
      return;
    }

    if (text.includes("[SLOW]")) {
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          activeCancelHandlers.delete(sessionId);
          send({ id, result: { stopReason: "end_turn" } });
          resolve();
        }, 15_000);
        activeCancelHandlers.set(sessionId, () => {
          clearTimeout(timer);
          activeCancelHandlers.delete(sessionId);
          send({ id, result: { stopReason: "cancelled" } });
          resolve();
        });
      });
      return;
    }

    if (process.env.MOCK_AGY_ASK_PERMISSION_ON_CONTINUE === "1" && text.trim() === "继续") {
      await askPermission(sessionId, "继续执行授权确认");
    }

    const isGoalContinuation = text.includes("[Goal 自动推进");
    let reply = `Antigravity 回复(${sessions.get(sessionId)?.model || "default"}/${sessions.get(sessionId)?.thought_level || "high"}): ${text}`;
    if (text.includes("[GOAL_TWO_STEPS]") && !isGoalContinuation) {
      reply = "Antigravity 第一步已完成，继续推进。";
    } else if (isGoalContinuation || text.includes("[COMPLETE_NOW]")) {
      reply = "Antigravity 目标已完成。\n<!-- GOAL_COMPLETE -->";
    }

    send({
      method: "session/update",
      params: {
        sessionId,
        update: { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "思考中…" } },
      },
    });
    send({
      method: "session/update",
      params: {
        sessionId,
        update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: reply } },
      },
    });
    send({ id, result: { stopReason: "end_turn" } });
  }
});
