#!/usr/bin/env node
/**
 * ac-skill: install, inspect, or uninstall the built-in remodeck-memory skill across Claude Code, Codex, and Antigravity.
 *
 *   remodeck skill status [--json]
 *   remodeck skill install [--clients claude,codex,antigravity] [--force]
 *   remodeck skill uninstall [--clients claude,codex,antigravity]
 */
import os from "node:os";
import { getSkillSyncStatus, installSkill, uninstallSkill } from "../src/skill-sync.mjs";

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if ((k === "clients" || k === "home") && i + 1 < argv.length) flags[k] = argv[++i];
      else flags[k] = true;
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
}

function formatStatus(status) {
  const lines = [`技能：${status.skillName}（源目录：${status.sourceDir}）`];
  for (const t of status.targets) {
    const state = t.upToDate
      ? "已同步"
      : t.conflict
        ? "已有未托管同名目录"
        : t.installed
          ? "需更新"
          : "未安装";
    lines.push(`- ${t.client.padEnd(12)} ${state} · ${t.path}`);
  }
  return lines.join("\n");
}

async function main() {
  const [cmd = "status", ...rest] = process.argv.slice(2);
  const { flags } = parseArgs(rest);
  const homeDir = flags.home || os.homedir();
  const clients = flags.clients ? String(flags.clients).split(",") : undefined;

  if (cmd === "status") {
    const status = await getSkillSyncStatus({ homeDir, ...(clients ? { clients } : {}) });
    process.stdout.write(flags.json ? `${JSON.stringify(status, null, 2)}\n` : `${formatStatus(status)}\n`);
    return;
  }
  if (cmd === "install") {
    const res = await installSkill({ homeDir, ...(clients ? { clients } : {}), force: Boolean(flags.force) });
    process.stdout.write(flags.json ? `${JSON.stringify(res, null, 2)}\n` : `${formatStatus(res.status)}\n`);
    return;
  }
  if (cmd === "uninstall") {
    const res = await uninstallSkill({ homeDir, ...(clients ? { clients } : {}) });
    process.stdout.write(flags.json ? `${JSON.stringify(res, null, 2)}\n` : `${formatStatus(res.status)}\n`);
    return;
  }
  throw new Error(`未知子命令：${cmd}（支持 status / install / uninstall）`);
}

main().catch((err) => {
  process.stderr.write(`ac-skill: ${err?.message || err}\n`);
  process.exit(1);
});
