#!/usr/bin/env node
/**
 * ac-task: tree-structured task CLI for RemoDeck (Codex / Claude Code / Antigravity).
 *
 *   remodeck task list [--status open|done|dropped|all] [--topic <id>] [--flat] [--json]
 *   remodeck task show <id> [--limit 20] [--json]
 *   remodeck task new "<标题>" [--parent <id>] [--goal "..."] [--criteria "c1;c2"] [--topic <id>] [--cwd <path>]
 *   remodeck task log <id> "<进展内容>" [--thread <id>]
 *   remodeck task done <id> | drop <id> | reopen <id>
 *   remodeck task bind <id> <threadId> | unbind <id> <threadId>
 */
import { readFile } from "node:fs/promises";
import { defaultDataDir } from "../src/instance-identity.mjs";
import { buildTaskTree, flattenTaskTree, TaskStore } from "../src/task-store.mjs";

const VALUE_FLAGS = new Set(["status", "topic", "cwd", "parent", "goal", "criteria", "thread", "limit", "url", "data-dir"]);

function parseArgs(argv) {
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (VALUE_FLAGS.has(k) && i + 1 < argv.length) flags[k] = argv[++i];
      else flags[k] = true;
    } else {
      pos.push(a);
    }
  }
  return { flags, pos };
}

function baseUrlFrom(flags) {
  if (flags.offline || process.env.AGENT_CONTROL_OFFLINE === "1") return "";
  const raw = flags.url || process.env.AGENT_CONTROL_URL || `http://127.0.0.1:${process.env.PORT || 43310}`;
  return String(raw).replace(/\/+$/, "");
}

async function tryApi(url, path, { method = "GET", body = null } = {}) {
  if (!url) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 800);
  try {
    const res = await fetch(`${url}${path}`, {
      method,
      headers: body ? { "Content-Type": "application/json", Accept: "application/json" } : { Accept: "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      const err = new Error(data?.error?.message || `HTTP ${res.status}`);
      err.httpStatus = res.status;
      throw err;
    }
    return await res.json();
  } catch (err) {
    if (err?.httpStatus && err.httpStatus < 500) throw err;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function statusMark(status) {
  if (status === "done") return "[✓]";
  if (status === "dropped") return "[×]";
  return "[●]";
}

function renderTreeLines(roots, prefix = "") {
  const lines = [];
  roots.forEach((node, idx) => {
    const last = idx === roots.length - 1;
    const branch = prefix ? `${prefix}${last ? "└─ " : "├─ "}` : "";
    const sessions = (node.threadIds || []).length;
    const sub = node.childCount ? ` · 子任务 ${node.childDoneCount || 0}/${node.childCount}` : "";
    const plan = node.planRef?.threadId ? " · 📌规划" : "";
    lines.push(`${branch}${statusMark(node.status)} ${node.id} ${node.title} (${sessions} 会话${sub}${plan})`);
    if (node.children?.length) {
      const childPrefix = prefix ? `${prefix}${last ? "   " : "│  "}` : "  ";
      lines.push(...renderTreeLines(node.children, childPrefix));
    }
  });
  return lines;
}

function print(value) {
  process.stdout.write(typeof value === "string" ? `${value}\n` : `${JSON.stringify(value, null, 2)}\n`);
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, pos } = parseArgs(rest);
  if (!cmd || cmd === "help" || flags.help) {
    const src = await readFile(new URL(import.meta.url), "utf8");
    print(src.match(/\/\*\*([\s\S]*?)\*\//)[1].replace(/^ \* ?/gm, "").trim());
    return;
  }

  const dataDir = flags["data-dir"] || defaultDataDir();
  const store = new TaskStore({ dataDir });
  const apiUrl = flags["data-dir"] ? "" : baseUrlFrom(flags);

  switch (cmd) {
    case "list": {
      const status = flags.status || "open";
      const topicId = flags.topic || "";
      const tasks = await store.list({ status, topicId });
      if (flags.json) {
        print({ tasks, tree: buildTaskTree(tasks) });
        return;
      }
      if (!tasks.length) {
        print("暂无匹配任务");
        return;
      }
      if (flags.flat) {
        for (const t of flattenTaskTree(buildTaskTree(tasks))) {
          print(`${statusMark(t.status)} ${t.id} ${t.pathTitles?.join(" › ") || t.title}`);
        }
        return;
      }
      for (const line of renderTreeLines(buildTaskTree(tasks))) print(line);
      return;
    }

    case "show": {
      const id = pos[0];
      if (!id) throw new Error("用法：remodeck task show <id>");
      const task = await store.get(id);
      if (!task) throw new Error(`任务不存在：${id}`);
      const [ancestors, children, logs] = await Promise.all([
        store.getAncestors(id),
        store.getChildren(id),
        store.readLogs(id, { limit: Number(flags.limit) || 20 }),
      ]);
      if (flags.json) {
        print({ task, ancestors, children, logs });
        return;
      }
      const pathStr = [...ancestors.map((a) => `${a.title}(${a.id})`), `${task.title}(${task.id})`].join(" › ");
      const out = [
        `${statusMark(task.status)} ${pathStr}`,
        task.goal ? `目标：${task.goal}` : "",
        task.topicId ? `项目：${task.topicId}` : "",
        task.cwd ? `目录：${task.cwd}` : "",
        task.criteria?.length ? `验收标准：\n${task.criteria.map((c, i) => `  ${i + 1}. ${c}`).join("\n")}` : "",
        task.planRef?.threadId ? `规划锚点：${task.planRef.threadId}${task.planRef.excerpt ? `（${task.planRef.excerpt}）` : ""}` : "",
        `关联会话 (${task.threadIds.length})：${task.threadIds.join(", ") || "无"}`,
        children.length ? `子任务 (${children.length})：\n${children.map((c) => `  ${statusMark(c.status)} ${c.id} ${c.title}`).join("\n")}` : "",
        logs.length ? `最近过程 (${logs.length})：\n${logs.map((l) => `  - ${String(l.ts || "").slice(0, 16).replace("T", " ")} [${l.kind}] ${l.text}`).join("\n")}` : "最近过程：无",
      ].filter(Boolean);
      print(out.join("\n"));
      return;
    }

    case "new": {
      const title = pos.join(" ").trim();
      if (!title) throw new Error("用法：remodeck task new <标题> [--parent <id>] [--goal ...] [--criteria ...]");
      const payload = {
        title,
        parentId: flags.parent || "",
        goal: flags.goal || "",
        ...(flags.criteria ? { criteria: flags.criteria } : {}),
        topicId: flags.topic || "",
        cwd: flags.cwd || "",
      };
      const viaApi = await tryApi(apiUrl, "/api/tasks", { method: "POST", body: payload });
      if (viaApi?.task) {
        print(viaApi.task);
        return;
      }
      print(await store.create(payload));
      return;
    }

    case "log": {
      const [id, ...restMsg] = pos;
      const text = restMsg.join(" ").trim();
      if (!id || !text) throw new Error("用法：remodeck task log <id> <进展内容>");
      const threadId = flags.thread || process.env.AGENT_CONTROL_THREAD_ID || "";
      const payload = { kind: "agent_log", actor: "agent", threadId, text };
      const viaApi = await tryApi(apiUrl, `/api/tasks/${encodeURIComponent(id)}/log`, { method: "POST", body: payload });
      if (viaApi?.entry) {
        print(viaApi.entry);
        return;
      }
      print(await store.appendLog(id, payload));
      return;
    }

    case "done":
    case "drop":
    case "reopen": {
      const id = pos[0];
      if (!id) throw new Error(`用法：remodeck task ${cmd} <id>`);
      const status = cmd === "done" ? "done" : cmd === "drop" ? "dropped" : "open";
      const viaApi = await tryApi(apiUrl, `/api/tasks/${encodeURIComponent(id)}`, { method: "POST", body: { status } });
      if (viaApi?.task) {
        print(viaApi.task);
        return;
      }
      print(await store.update(id, { status, actor: "cli" }));
      return;
    }

    case "bind":
    case "unbind": {
      const [id, threadId] = pos;
      if (!id || !threadId) throw new Error(`用法：remodeck task ${cmd} <id> <threadId>`);
      const body = cmd === "bind" ? { addThreadId: threadId } : { removeThreadId: threadId };
      const viaApi = await tryApi(apiUrl, `/api/tasks/${encodeURIComponent(id)}`, { method: "POST", body });
      if (viaApi?.task) {
        print(viaApi.task);
        return;
      }
      print(cmd === "bind" ? await store.bindThread(id, threadId, { actor: "cli" }) : await store.unbindThread(id, threadId, { actor: "cli" }));
      return;
    }

    default:
      throw new Error(`未知命令：${cmd}（remodeck task help 查看用法）`);
  }
}

main().catch((err) => {
  process.stderr.write(`ac-task: ${err?.message || err}\n`);
  process.exit(1);
});
