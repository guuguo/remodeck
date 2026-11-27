#!/usr/bin/env node
/**
 * ac-memory: shared memory vault CLI for Codex / Claude Code / Antigravity.
 *
 *   ac-memory brief [--topic <id> | --cwd <path>]          compact summary to read before working
 *   ac-memory search <词...> [--topic <id>] [--kind <k>]    find notes
 *   ac-memory get <相对路径>                                print a note
 *   ac-memory fact <归属> <键> <值> [--source user|code|agent]
 *   ac-memory decide <归属> <内容> [--source ...]
 *   ac-memory ledger <归属> <台账名> col=val ... [--key 列1,列2]
 *   ac-memory wip <归属> <任务slug> [--title --status --goal --state --next --tentative --artifact --log --session]
 *   ac-memory wip-list [--topic <id>] [--status active]
 *   ac-memory note <标题> [--topic <归属>] [--kind lesson|reference|note] [--body 文本 | stdin]
 *   ac-memory sync-projects | lint | scan-scratch
 *   ac-memory config --vault <路径>
 *
 * 归属 = 项目 id（如 manga-translator）| area:<领域名> | me
 */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { defaultDataDir } from "../src/instance-identity.mjs";
import {
  MACHINE_DIR,
  MemoryVault,
  resolveEffectiveVaultPath,
  resolveVaultPath,
  scanAntigravityScratch,
  writeMemoryConfig,
} from "../src/memory-vault.mjs";

const FLAG_KEYS = new Set([
  "topic", "cwd", "kind", "limit", "source", "key", "title", "status", "goal", "state", "next",
  "tentative", "artifact", "log", "session", "body", "vault", "brain", "max-chars",
]);

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (FLAG_KEYS.has(k) && i + 1 < argv.length) flags[k] = argv[++i];
      else flags[k] = true;
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
}

async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

function print(obj) {
  process.stdout.write(typeof obj === "string" ? `${obj}\n` : `${JSON.stringify(obj, null, 2)}\n`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, pos } = parseArgs(rest);
  const dataDir = defaultDataDir();

  if (!cmd || cmd === "help" || flags.help) {
    const src = await readFile(new URL(import.meta.url), "utf8");
    print(src.match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, "").trim());
    return;
  }
  if (cmd === "config") {
    if (!flags.vault) throw new Error("用法：ac-memory config --vault <路径>");
    print(await writeMemoryConfig(dataDir, { vaultPath: flags.vault }));
    return;
  }

  const root = flags.vault || (await resolveEffectiveVaultPath({ dataDir })) || (await resolveVaultPath({ dataDir }));
  const vault = new MemoryVault(root);
  const scopeOf = async (explicit) => explicit
    || (await vault.resolveTopic({ topic: flags.topic, cwd: flags.cwd || process.cwd() }));

  switch (cmd) {
    case "brief": {
      const scope = await scopeOf("");
      if (!scope) {
        print(`[记忆简报] 当前目录未匹配到项目。可用 --topic 指定，或 ac-memory search 关键词。记忆库：${vault.root}`);
        return;
      }
      print(await vault.brief({ scope, maxChars: Number(flags["max-chars"]) || 2400 }));
      return;
    }
    case "search": {
      const hits = await vault.search(pos.join(" "), { scope: flags.topic || "", kind: flags.kind || "", limit: Number(flags.limit) || 8 });
      if (!hits.length) print("无匹配");
      for (const h of hits) print(`${h.rel} [${h.kind}${h.status ? `/${h.status}` : ""}] ${h.snippet}`);
      return;
    }
    case "get": {
      const note = await vault.read(pos.join(" "));
      print(note.raw);
      return;
    }
    case "fact": {
      const [scope, key, ...value] = pos;
      print(await vault.upsertFact(scope, key, value.join(" "), { source: flags.source || "agent" }));
      return;
    }
    case "decide": {
      const [scope, ...text] = pos;
      print(await vault.addDecision(scope, text.join(" "), { source: flags.source || "agent" }));
      return;
    }
    case "ledger": {
      const [scope, name, ...pairs] = pos;
      const row = {};
      for (const p of pairs) {
        const i = p.indexOf("=");
        if (i > 0) row[p.slice(0, i)] = p.slice(i + 1);
      }
      const keys = flags.key ? String(flags.key).split(",").map((s) => s.trim()).filter(Boolean) : [];
      print(await vault.upsertLedger(scope, name, row, { keys }));
      return;
    }
    case "wip": {
      const [scope, slug] = pos;
      if (!scope || !slug) throw new Error("用法：ac-memory wip <归属> <任务slug> [--state ... --next ...]");
      print(await vault.updateWip(scope, slug, flags));
      return;
    }
    case "wip-list": {
      const list = await vault.listWip({ scope: flags.topic || "", status: flags.status || "" });
      if (!list.length) print("无任务卡");
      for (const w of list) print(`${w.rel} · ${w.status} · ${w.updated} · ${w.title}`);
      return;
    }
    case "note": {
      const body = typeof flags.body === "string" ? flags.body : await readStdin();
      print(await vault.addNote({ scope: flags.topic || "", title: pos.join(" "), kind: flags.kind || "note", body }));
      return;
    }
    case "sync-projects": {
      const registry = JSON.parse(await readFile(join(dataDir, "mission-domains.json"), "utf8"));
      print(await vault.syncProjects(registry));
      return;
    }
    case "lint":
      print(await vault.lint());
      return;
    case "scan-scratch": {
      const brain = flags.brain || join(os.homedir(), ".gemini", "antigravity", "brain");
      const sessions = await scanAntigravityScratch(brain);
      const outDir = join(vault.root, MACHINE_DIR);
      await mkdir(outDir, { recursive: true });
      const outFile = join(outDir, "agy-scratch-inventory.jsonl");
      await writeFile(outFile, sessions.map((s) => JSON.stringify(s)).join("\n") + (sessions.length ? "\n" : ""));
      const totals = {};
      for (const s of sessions) for (const [k, v] of Object.entries(s.classes)) totals[k] = (totals[k] || 0) + v;
      print({ sessions: sessions.length, files: sessions.reduce((n, s) => n + s.total, 0), classes: totals, output: outFile });
      return;
    }
    default:
      throw new Error(`未知命令：${cmd}（ac-memory help 查看用法）`);
  }
}

main().catch((err) => {
  process.stderr.write(`ac-memory: ${err?.message || err}\n`);
  process.exit(1);
});
