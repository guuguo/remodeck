#!/usr/bin/env node
/**
 * Rename the current Agent Control session from inside an AI agent turn.
 *
 * Usage:
 *   node scripts/rename-thread.mjs "对象｜主旨" [--lock] [--id <threadIdOrRawId>] [--provider <provider>] [--cwd <cwd>] [--url <baseUrl>]
 *   node scripts/rename-thread.mjs --append "短后缀" [--id <threadIdOrRawId>] [--provider <provider>] [--cwd <cwd>] [--url <baseUrl>]
 *   node scripts/rename-thread.mjs "【客户｜提出人｜模块｜机型】异常" --domain [...]
 */

import {
  isCanonicalDomainTitle,
  validateAgentBaseTitle,
  validateAgentSuffix,
} from "../src/thread-title-policy.mjs";

function parseArgs(argv) {
  const out = {
    name: "",
    append: "",
    lock: false,
    domain: false,
    id: "",
    provider: "",
    cwd: "",
    url: "",
  };
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--id" && i + 1 < argv.length) {
      out.id = argv[++i];
    } else if (arg === "--provider" && i + 1 < argv.length) {
      out.provider = argv[++i];
    } else if (arg === "--cwd" && i + 1 < argv.length) {
      out.cwd = argv[++i];
    } else if (arg === "--url" && i + 1 < argv.length) {
      out.url = argv[++i];
    } else if (arg === "--append" && i + 1 < argv.length) {
      out.append = argv[++i];
    } else if (arg === "--lock") {
      out.lock = true;
    } else if (arg === "--domain") {
      out.domain = true;
    } else if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    }
  }
  out.name = positional.join(" ").trim();
  return out;
}

function printUsage() {
  console.error([
    "用法:",
    '  node scripts/rename-thread.mjs "对象｜主旨" [--lock] [--id <id>] [--provider <p>] [--cwd <dir>] [--url <url>]',
    '  node scripts/rename-thread.mjs --append "短后缀" [--id <id>] [--provider <p>] [--cwd <dir>] [--url <url>]',
    '  node scripts/rename-thread.mjs "【客户｜提出人｜模块｜机型】异常" --domain [--id <id>]',
  ].join("\n"));
}

function detectEnvSession() {
  if (process.env.AGENT_CONTROL_THREAD_ID) {
    return { id: process.env.AGENT_CONTROL_THREAD_ID.trim(), provider: "" };
  }
  if (process.env.ANTIGRAVITY_CONVERSATION_ID) {
    return { id: process.env.ANTIGRAVITY_CONVERSATION_ID.trim(), provider: "antigravity" };
  }
  if (process.env.CODEX_THREAD_ID) {
    return { id: process.env.CODEX_THREAD_ID.trim(), provider: "codex" };
  }
  if (process.env.CLAUDE_SESSION_ID) {
    return { id: process.env.CLAUDE_SESSION_ID.trim(), provider: "claude" };
  }
  return { id: "", provider: "" };
}

async function resolveUniqueLiveThreadId(baseUrl, { provider, cwd }) {
  const qs = new URLSearchParams({ limit: "80" });
  if (provider) qs.set("provider", provider);
  const res = await fetch(`${baseUrl}/api/threads?${qs.toString()}`);
  if (!res.ok) {
    throw new Error(`查询会话列表失败: HTTP ${res.status}`);
  }
  const data = await res.json();
  const threads = Array.isArray(data?.threads) ? data.threads : [];
  const liveInCwd = threads.filter((th) => th.live && (!cwd || th.cwd === cwd));
  if (liveInCwd.length === 1) {
    return liveInCwd[0].id;
  }
  if (liveInCwd.length > 1) {
    throw new Error(`当前目录存在 ${liveInCwd.length} 个运行中会话，请通过 --id 指定具体会话 ID`);
  }
  throw new Error("未检测到当前会话 ID（请传入 --id 或确认环境变量存在）");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.name && !args.append)) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }
  if (args.append && args.name) {
    console.error("--append 模式只需传入后缀，不要同时传入新主标题");
    process.exit(1);
  }

  let effectiveName = args.name;
  let effectiveSuffix = "";
  const source = args.domain ? "domain" : "agent";
  const action = args.append ? "append" : "set";

  if (action === "append") {
    const sv = validateAgentSuffix(args.append);
    if (!sv.ok) {
      console.error(`后缀未通过格式校验：${sv.error}`);
      process.exit(1);
    }
    effectiveSuffix = sv.value;
  } else if (!args.domain && !isCanonicalDomainTitle(args.name)) {
    const bv = validateAgentBaseTitle(args.name);
    if (!bv.ok) {
      console.error(`标题未通过格式校验：${bv.error}`);
      process.exit(1);
    }
    effectiveName = bv.value;
  }

  const baseUrl = (args.url || process.env.AGENT_CONTROL_URL || "http://127.0.0.1:43310").replace(/\/+$/, "");
  const envDetected = detectEnvSession();
  const effectiveProvider = args.provider || envDetected.provider;
  const effectiveCwd = args.cwd || process.cwd();
  let targetId = args.id || envDetected.id;

  if (!targetId) {
    targetId = await resolveUniqueLiveThreadId(baseUrl, {
      provider: effectiveProvider,
      cwd: effectiveCwd,
    });
  }

  const payload = {
    ...(targetId.includes(":") ? { threadId: targetId } : { rawId: targetId }),
    provider: effectiveProvider,
    cwd: effectiveCwd,
    source,
    action,
    ...(action === "append" ? { suffix: effectiveSuffix } : { name: effectiveName }),
    ...(args.lock ? { lock: true } : {}),
  };

  const res = await fetch(`${baseUrl}/api/thread/name`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`重命名失败 (HTTP ${res.status}): ${text}`);
  }
  console.log(text);
}

main().catch((err) => {
  console.error(err?.message || String(err));
  process.exit(1);
});
