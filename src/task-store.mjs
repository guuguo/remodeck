import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const TASK_STATUSES = Object.freeze(["open", "done", "dropped"]);
export const TASK_LOG_KINDS = Object.freeze([
  "created",
  "session_bound",
  "session_unbound",
  "plan_pinned",
  "turn_completed",
  "agent_log",
  "status_changed",
  "updated",
]);

function shortText(value, size) {
  return Array.from(String(value || "").replace(/\s+/g, " ").trim()).slice(0, size).join("");
}

function toTimestampMs(value) {
  if (!value) return 0;
  const n = Number(value);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  return Date.parse(value) || 0;
}

export function cleanTaskCriteria(value) {
  if (value === undefined || value === null) return [];
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\n+|[；;]/)
      : null;
  if (!list || list.some((item) => typeof item !== "string")) {
    throw Object.assign(new Error("验收标准必须是文本列表"), { status: 400 });
  }
  const out = list
    .map((item) => shortText(item.replace(/^\s*(?:\d+[.、)]|[-*•])\s*/, ""), 120))
    .filter(Boolean);
  if (out.length > 8) {
    throw Object.assign(new Error("验收标准最多 8 条"), { status: 400 });
  }
  return out;
}

function cleanThreadIds(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    const id = String(raw || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function normalizePlanRef(raw, fallbackAt = "") {
  if (!raw || typeof raw !== "object") return null;
  const threadId = String(raw.threadId || "").trim();
  if (!threadId) return null;
  const turnId = String(raw.turnId || "").trim();
  const turnIndex = Number.isInteger(raw.turnIndex) && raw.turnIndex >= 0 ? raw.turnIndex : -1;
  const excerpt = shortText(raw.excerpt || "", 160);
  const pinnedAt = String(raw.pinnedAt || fallbackAt || "").trim();
  return {
    threadId,
    turnId,
    turnIndex,
    ...(excerpt ? { excerpt } : {}),
    ...(pinnedAt ? { pinnedAt } : {}),
  };
}

function normalizeTaskRecord(raw = {}, fallbackIso = "") {
  const id = String(raw.id || "").trim();
  if (!id) return null;
  const status = TASK_STATUSES.includes(raw.status) ? raw.status : "open";
  const createdAt = String(raw.createdAt || fallbackIso || new Date().toISOString());
  const updatedAt = String(raw.updatedAt || createdAt);
  const threadIds = cleanThreadIds(raw.threadIds || (raw.threadId ? [raw.threadId] : []));
  const rawCriteria = Array.isArray(raw.criteria) ? raw.criteria : [];
  const criteria = rawCriteria
    .map((c) => shortText(String(c || "").replace(/^\s*(?:\d+[.、)]|[-*•])\s*/, ""), 120))
    .filter(Boolean)
    .slice(0, 8);
  const planRef = normalizePlanRef(raw.planRef, updatedAt);
  return {
    id,
    parentId: String(raw.parentId || "").trim(),
    title: shortText(raw.title || "未命名任务", 60) || "未命名任务",
    goal: shortText(raw.goal || "", 240),
    criteria,
    topicId: String(raw.topicId || "").trim(),
    cwd: String(raw.cwd || "").trim(),
    status,
    threadIds,
    planRef,
    draftedBy: String(raw.draftedBy || "").trim(),
    createdAt,
    updatedAt,
    ...(raw.closedAt ? { closedAt: String(raw.closedAt) } : {}),
  };
}

function sortTasksForTree(a, b) {
  const openDiff = (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1);
  if (openDiff !== 0) return openDiff;
  const updDiff = toTimestampMs(b.updatedAt) - toTimestampMs(a.updatedAt);
  if (updDiff !== 0) return updDiff;
  const crtDiff = toTimestampMs(b.createdAt) - toTimestampMs(a.createdAt);
  if (crtDiff !== 0) return crtDiff;
  return String(a.id).localeCompare(String(b.id));
}

export function buildTaskTree(tasks = []) {
  const list = Array.isArray(tasks) ? tasks.filter((t) => t?.id) : [];
  const byId = new Map();
  for (const item of list) {
    byId.set(item.id, { ...item, children: [] });
  }
  const roots = [];
  for (const node of byId.values()) {
    const pid = node.parentId && node.parentId !== node.id && byId.has(node.parentId) ? node.parentId : "";
    if (!pid) {
      node.parentId = "";
      roots.push(node);
      continue;
    }
    // Guard against pre-existing hand-edited cycles before linking.
    let cur = pid;
    let cyclic = false;
    const seen = new Set([node.id]);
    while (cur) {
      if (seen.has(cur)) {
        cyclic = true;
        break;
      }
      seen.add(cur);
      const p = byId.get(cur);
      cur = p?.parentId && p.parentId !== cur && byId.has(p.parentId) ? p.parentId : "";
    }
    if (cyclic) {
      node.parentId = "";
      roots.push(node);
    } else {
      byId.get(pid).children.push(node);
    }
  }

  const annotate = (node, depth, ancestorIds, pathTitles) => {
    node.children.sort(sortTasksForTree);
    node.depth = depth;
    node.ancestorIds = ancestorIds;
    node.pathTitles = [...pathTitles, node.title];
    let childCount = 0;
    let childOpenCount = 0;
    let childDoneCount = 0;
    let hasLiveChild = false;
    for (const child of node.children) {
      annotate(child, depth + 1, [...ancestorIds, node.id], node.pathTitles);
      childCount += 1 + (child.childCount || 0);
      childOpenCount += (child.status === "open" ? 1 : 0) + (child.childOpenCount || 0);
      childDoneCount += (child.status === "done" ? 1 : 0) + (child.childDoneCount || 0);
      if (child.state === "running" || child.live || child.hasLiveChild) {
        hasLiveChild = true;
      }
    }
    node.directChildCount = node.children.length;
    node.childCount = childCount;
    node.childOpenCount = childOpenCount;
    node.childDoneCount = childDoneCount;
    node.hasLiveChild = hasLiveChild;
  };

  roots.sort(sortTasksForTree);
  for (const root of roots) {
    annotate(root, 0, [], []);
  }
  return roots;
}

export function flattenTaskTree(roots = []) {
  const out = [];
  const walk = (nodes) => {
    for (const node of nodes || []) {
      const { children, ...rest } = node;
      out.push(rest);
      if (Array.isArray(children) && children.length) {
        walk(children);
      }
    }
  };
  walk(roots);
  return out;
}

async function writeJsonAtomic(filePath, payload) {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(tempPath, filePath);
}

export class TaskStore {
  #tasks = null;
  #queue = Promise.resolve();
  #projectQueue = Promise.resolve();
  #logWriteQueue = Promise.resolve();

  constructor({ dataDir, now = () => Date.now(), onChange = null, projectToVault = null } = {}) {
    if (!dataDir) throw new Error("TaskStore requires dataDir");
    this.dataDir = resolve(dataDir);
    this.filePath = resolve(this.dataDir, "tasks.json");
    this.logsDir = resolve(this.dataDir, "tasks");
    this.legacyTicketsPath = resolve(this.dataDir, "assistant", "tickets.json");
    this.now = now;
    this.onChange = typeof onChange === "function" ? onChange : null;
    this.projectToVault = typeof projectToVault === "function" ? projectToVault : null;
  }

  #isoNow() {
    return new Date(this.now()).toISOString();
  }

  logPath(taskId) {
    const cleanId = String(taskId || "").replace(/[^A-Za-z0-9_-]/g, "");
    if (!cleanId) throw Object.assign(new Error("无效的任务 ID"), { status: 400 });
    return resolve(this.logsDir, `${cleanId}.jsonl`);
  }

  async #load() {
    if (this.#tasks) return this.#tasks;
    let parsed = null;
    let needsInitialSave = false;
    try {
      parsed = JSON.parse(await readFile(this.filePath, "utf8"));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      // Migrate legacy assistant/tickets.json once when tasks.json is absent.
      try {
        const legacyRaw = JSON.parse(await readFile(this.legacyTicketsPath, "utf8"));
        if (legacyRaw && typeof legacyRaw === "object") {
          parsed = { version: 1, tasks: legacyRaw };
          needsInitialSave = Object.keys(legacyRaw).length > 0;
        }
      } catch (legacyErr) {
        if (legacyErr.code !== "ENOENT") {
          // Ignore malformed legacy file rather than crashing task initialization.
          parsed = { version: 1, tasks: {} };
        }
      }
    }

    const rawMap = parsed?.tasks && typeof parsed.tasks === "object"
      ? parsed.tasks
      : (parsed && typeof parsed === "object" && !Array.isArray(parsed) && !parsed.tasks ? parsed : {});
    const fallbackIso = this.#isoNow();
    const map = {};
    for (const [key, item] of Object.entries(rawMap || {})) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const normalized = normalizeTaskRecord({ id: key, ...item }, fallbackIso);
      if (normalized) map[normalized.id] = normalized;
    }
    this.#tasks = map;
    if (needsInitialSave) {
      await writeJsonAtomic(this.filePath, { version: 1, tasks: this.#tasks });
    }
    return this.#tasks;
  }

  async #mutate(fn) {
    const run = this.#queue.then(async () => {
      const tasks = await this.#load();
      const result = await fn(tasks);
      await writeJsonAtomic(this.filePath, { version: 1, tasks });
      return result;
    });
    this.#queue = run.catch(() => {});
    return run;
  }

  async #appendLogEntry(taskId, { kind = "agent_log", actor = "system", threadId = "", text = "" } = {}) {
    const cleanKind = TASK_LOG_KINDS.includes(kind) ? kind : "agent_log";
    const cleanText = shortText(text, 400);
    if (!cleanText) return null;
    const entry = {
      ts: this.#isoNow(),
      kind: cleanKind,
      actor: shortText(actor || "system", 32) || "system",
      ...(threadId ? { threadId: String(threadId).trim() } : {}),
      text: cleanText,
    };
    const path = this.logPath(taskId);
    const run = this.#logWriteQueue.then(async () => {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await appendFile(path, `${JSON.stringify(entry)}\n`, { encoding: "utf8", mode: 0o600 });
      return entry;
    });
    this.#logWriteQueue = run.catch(() => {});
    return run;
  }

  #scheduleProjection(task) {
    if (!this.projectToVault || !task?.id) return;
    const run = this.#projectQueue.then(async () => {
      const all = await this.#load();
      const latest = all[task.id] || task;
      const logs = await this.readLogs(latest.id, { limit: 20 });
      const parentTitle = latest.parentId ? (all[latest.parentId]?.title || "") : "";
      const childTitles = Object.values(all)
        .filter((t) => t.parentId === latest.id)
        .map((t) => `${t.title}${t.status !== "open" ? `（${t.status === "done" ? "已完成" : "已放弃"}）` : ""}`);
      await this.projectToVault(latest, logs, { parentTitle, childTitles });
    }).catch(() => {});
    this.#projectQueue = run;
  }

  #emitChange(type, task) {
    if (this.onChange && task) {
      try {
        this.onChange({ type, task: { ...task } });
      } catch {
        // Keep listener errors isolated from store persistence.
      }
    }
    this.#scheduleProjection(task);
  }

  async flush() {
    await Promise.all([this.#queue, this.#logWriteQueue, this.#projectQueue]);
  }

  async list({ status = "open", topicId = "", cwd = "", tree = false } = {}) {
    const all = await this.#load();
    const cleanStatus = String(status || "open").trim();
    const cleanTopic = String(topicId || "").trim();
    const cleanCwd = String(cwd || "").trim().replace(/\/+$/, "");
    let items = Object.values(all).filter((t) => {
      if (cleanStatus !== "all" && t.status !== cleanStatus) return false;
      if (cleanTopic && t.topicId !== cleanTopic) return false;
      if (cleanCwd && t.cwd.replace(/\/+$/, "") !== cleanCwd) return false;
      return true;
    }).map((t) => ({ ...t, threadIds: [...t.threadIds], criteria: [...t.criteria] }));
    items.sort(sortTasksForTree);
    return tree ? buildTaskTree(items) : items;
  }

  async get(id) {
    const cleanId = String(id || "").trim();
    if (!cleanId) return null;
    const all = await this.#load();
    const task = all[cleanId];
    return task ? { ...task, threadIds: [...task.threadIds], criteria: [...task.criteria] } : null;
  }

  async findByThreadId(threadId, { includeClosed = false } = {}) {
    const cleanThreadId = String(threadId || "").trim();
    if (!cleanThreadId) return null;
    const all = await this.#load();
    const matches = Object.values(all).filter((t) => (
      t.threadIds.includes(cleanThreadId) && (includeClosed || t.status === "open")
    ));
    if (!matches.length) return null;
    matches.sort(sortTasksForTree);
    const hit = matches[0];
    return { ...hit, threadIds: [...hit.threadIds], criteria: [...hit.criteria] };
  }

  async getAncestors(taskId) {
    const all = await this.#load();
    const out = [];
    const seen = new Set([taskId]);
    let cur = all[taskId]?.parentId || "";
    while (cur && all[cur] && !seen.has(cur)) {
      seen.add(cur);
      out.unshift({ ...all[cur], threadIds: [...all[cur].threadIds], criteria: [...all[cur].criteria] });
      cur = all[cur].parentId || "";
    }
    return out;
  }

  async getChildren(taskId) {
    const all = await this.#load();
    return Object.values(all)
      .filter((t) => t.parentId === taskId)
      .sort(sortTasksForTree)
      .map((t) => ({ ...t, threadIds: [...t.threadIds], criteria: [...t.criteria] }));
  }

  async getRootId(taskId) {
    const ancestors = await this.getAncestors(taskId);
    return ancestors[0]?.id || taskId;
  }

  async getThreadIdsInSubtree(taskId) {
    const all = await this.#load();
    const seenTasks = new Set();
    const threadIds = new Set();
    const walk = (id) => {
      if (!id || seenTasks.has(id) || !all[id]) return;
      seenTasks.add(id);
      for (const tid of all[id].threadIds || []) threadIds.add(tid);
      for (const candidate of Object.values(all)) {
        if (candidate.parentId === id) walk(candidate.id);
      }
    };
    walk(taskId);
    return [...threadIds];
  }

  async create({
    title,
    goal = "",
    criteria = [],
    topicId = "",
    cwd = "",
    parentId = "",
    threadIds = [],
    planRef = null,
    draftedBy = "",
    actor = "user",
  } = {}) {
    const cleanTitle = shortText(title || "", 60);
    if (!cleanTitle) throw Object.assign(new Error("任务标题不能为空"), { status: 400 });
    const cleanParentId = String(parentId || "").trim();
    const cleanCriteria = cleanTaskCriteria(criteria);
    const cleanThreads = cleanThreadIds(threadIds);
    const nowIso = this.#isoNow();

    const created = await this.#mutate(async (all) => {
      let parent = null;
      if (cleanParentId) {
        parent = all[cleanParentId];
        if (!parent) throw Object.assign(new Error("父任务不存在"), { status: 404 });
      }
      const id = `tk_${randomUUID().slice(0, 8)}`;
      const task = {
        id,
        parentId: cleanParentId,
        title: cleanTitle,
        goal: shortText(goal || "", 240),
        criteria: cleanCriteria,
        topicId: String(topicId || parent?.topicId || "").trim(),
        cwd: String(cwd || parent?.cwd || "").trim(),
        status: "open",
        threadIds: cleanThreads,
        planRef: normalizePlanRef(planRef, nowIso),
        draftedBy: String(draftedBy || "").trim(),
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      all[id] = task;
      return task;
    });

    await this.#appendLogEntry(created.id, {
      kind: "created",
      actor,
      threadId: created.threadIds[0] || "",
      text: cleanParentId ? `创建子任务「${created.title}」` : `创建任务「${created.title}」`,
    });
    this.#emitChange("created", created);
    return { ...created, threadIds: [...created.threadIds], criteria: [...created.criteria] };
  }

  async update(id, {
    title,
    goal,
    criteria,
    status,
    parentId,
    topicId,
    cwd,
    addThreadId,
    removeThreadId,
    planRef,
    actor = "user",
  } = {}) {
    const cleanId = String(id || "").trim();
    if (!cleanId) throw Object.assign(new Error("缺少任务 ID"), { status: 400 });
    if (status !== undefined && !TASK_STATUSES.includes(status)) {
      throw Object.assign(new Error("任务状态只能是 open/done/dropped"), { status: 400 });
    }
    const cleanCriteria = criteria !== undefined ? cleanTaskCriteria(criteria) : undefined;
    const at = this.#isoNow();
    const logsToAppend = [];

    const updated = await this.#mutate(async (all) => {
      const prev = all[cleanId];
      if (!prev) throw Object.assign(new Error("任务不存在"), { status: 404 });
      let nextParentId = prev.parentId;
      if (parentId !== undefined) {
        const candidate = String(parentId || "").trim();
        if (candidate === cleanId) {
          throw Object.assign(new Error("不能把任务设为自己的父任务"), { status: 400 });
        }
        if (candidate) {
          if (!all[candidate]) throw Object.assign(new Error("目标父任务不存在"), { status: 404 });
          // Walk ancestors to prevent forming a cycle.
          const seen = new Set([cleanId]);
          let cur = candidate;
          while (cur) {
            if (seen.has(cur)) {
              throw Object.assign(new Error("父任务关系不能形成循环"), { status: 400 });
            }
            seen.add(cur);
            cur = all[cur]?.parentId || "";
          }
        }
        nextParentId = candidate;
      }

      let nextThreads = [...prev.threadIds];
      const addTid = typeof addThreadId === "string" ? addThreadId.trim() : "";
      const removeTid = typeof removeThreadId === "string" ? removeThreadId.trim() : "";
      if (addTid && !nextThreads.includes(addTid)) {
        nextThreads.push(addTid);
        logsToAppend.push({ kind: "session_bound", actor, threadId: addTid, text: `关联会话 ${addTid}` });
      }
      if (removeTid && nextThreads.includes(removeTid)) {
        nextThreads = nextThreads.filter((t) => t !== removeTid);
        logsToAppend.push({ kind: "session_unbound", actor, threadId: removeTid, text: `解绑会话 ${removeTid}` });
      }

      const nextStatus = status !== undefined ? status : prev.status;
      if (status !== undefined && status !== prev.status) {
        const statusLabel = status === "done" ? "已完成" : status === "dropped" ? "已放弃" : "重新打开";
        logsToAppend.push({ kind: "status_changed", actor, text: `任务状态变更：${statusLabel}` });
      }

      const nextPlanRef = planRef === undefined ? prev.planRef : normalizePlanRef(planRef, at);
      if (planRef !== undefined && JSON.stringify(nextPlanRef) !== JSON.stringify(prev.planRef)) {
        if (nextPlanRef && !nextThreads.includes(nextPlanRef.threadId)) {
          nextThreads.push(nextPlanRef.threadId);
        }
        logsToAppend.push({
          kind: "plan_pinned",
          actor,
          threadId: nextPlanRef?.threadId || "",
          text: nextPlanRef ? `已钉住规划锚点${nextPlanRef.excerpt ? `：${nextPlanRef.excerpt}` : ""}` : "已清除规划锚点",
        });
      }

      const nextTitle = title !== undefined ? (shortText(title, 60) || prev.title) : prev.title;
      const nextGoal = goal !== undefined ? shortText(goal, 240) : prev.goal;
      const nextCriteria = cleanCriteria !== undefined ? cleanCriteria : prev.criteria;

      if (!logsToAppend.length && (
        nextTitle !== prev.title
        || nextGoal !== prev.goal
        || JSON.stringify(nextCriteria) !== JSON.stringify(prev.criteria)
        || nextParentId !== prev.parentId
      )) {
        logsToAppend.push({ kind: "updated", actor, text: "更新任务详情" });
      }

      const next = {
        ...prev,
        parentId: nextParentId,
        title: nextTitle,
        goal: nextGoal,
        criteria: nextCriteria,
        ...(topicId !== undefined ? { topicId: String(topicId || "").trim() } : {}),
        ...(cwd !== undefined ? { cwd: String(cwd || "").trim() } : {}),
        status: nextStatus,
        threadIds: nextThreads,
        planRef: nextPlanRef,
        updatedAt: at,
        ...(nextStatus === "open" ? {} : { closedAt: status !== undefined ? at : (prev.closedAt || at) }),
      };
      if (nextStatus === "open") delete next.closedAt;
      all[cleanId] = next;
      return next;
    });

    for (const entry of logsToAppend) {
      await this.#appendLogEntry(cleanId, entry);
    }
    this.#emitChange("updated", updated);
    return { ...updated, threadIds: [...updated.threadIds], criteria: [...updated.criteria] };
  }

  async bindThread(taskId, threadId, { role = "", actor = "system" } = {}) {
    const cleanTid = String(threadId || "").trim();
    if (!cleanTid) throw Object.assign(new Error("缺少会话 ID"), { status: 400 });
    const existing = await this.get(taskId);
    if (!existing) throw Object.assign(new Error("任务不存在"), { status: 404 });
    if (existing.threadIds.includes(cleanTid)) return existing;
    const updated = await this.#mutate(async (all) => {
      const prev = all[taskId];
      if (!prev) throw Object.assign(new Error("任务不存在"), { status: 404 });
      if (prev.threadIds.includes(cleanTid)) return prev;
      const next = {
        ...prev,
        threadIds: [...prev.threadIds, cleanTid],
        updatedAt: this.#isoNow(),
      };
      all[taskId] = next;
      return next;
    });
    await this.#appendLogEntry(taskId, {
      kind: "session_bound",
      actor,
      threadId: cleanTid,
      text: role ? `关联会话（${shortText(role, 24)}）` : `关联会话 ${cleanTid}`,
    });
    this.#emitChange("updated", updated);
    return { ...updated, threadIds: [...updated.threadIds], criteria: [...updated.criteria] };
  }

  async unbindThread(taskId, threadId, { actor = "user" } = {}) {
    return this.update(taskId, { removeThreadId: threadId, actor });
  }

  async pinPlan(taskId, { threadId, turnId = "", turnIndex = -1, excerpt = "", actor = "user" } = {}) {
    const cleanTid = String(threadId || "").trim();
    if (!cleanTid) throw Object.assign(new Error("缺少会话 ID"), { status: 400 });
    return this.update(taskId, {
      addThreadId: cleanTid,
      planRef: { threadId: cleanTid, turnId, turnIndex, excerpt, pinnedAt: this.#isoNow() },
      actor,
    });
  }

  async appendLog(taskId, { kind = "agent_log", actor = "agent", threadId = "", text = "" } = {}) {
    const cleanId = String(taskId || "").trim();
    const cleanText = shortText(text, 400);
    if (!cleanId) throw Object.assign(new Error("缺少任务 ID"), { status: 400 });
    if (!cleanText) throw Object.assign(new Error("日志内容不能为空"), { status: 400 });

    const updated = await this.#mutate(async (all) => {
      const prev = all[cleanId];
      if (!prev) throw Object.assign(new Error("任务不存在"), { status: 404 });
      const next = { ...prev, updatedAt: this.#isoNow() };
      all[cleanId] = next;
      return next;
    });
    const entry = await this.#appendLogEntry(cleanId, { kind, actor, threadId, text: cleanText });
    this.#emitChange("log_appended", updated);
    return entry;
  }

  async readLogs(taskId, { limit = 50 } = {}) {
    let raw = "";
    try {
      raw = await readFile(this.logPath(taskId), "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
    const entries = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object" && parsed.text) entries.push(parsed);
      } catch {
        // Ignore partial/malformed trailing lines.
      }
    }
    const max = Math.max(1, Number(limit) || 50);
    return entries.slice(-max);
  }
}
