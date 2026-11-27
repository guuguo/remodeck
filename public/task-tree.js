import { escapeHtml } from "./markdown.js";
import { iconSvg } from "./icons.js";

function toTimestampMs(value) {
  if (!value) return 0;
  const n = Number(value);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  return Date.parse(value) || 0;
}

function sortTaskNodes(a, b) {
  const openDiff = (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1);
  if (openDiff !== 0) return openDiff;
  const updDiff = toTimestampMs(b.updatedAt) - toTimestampMs(a.updatedAt);
  if (updDiff !== 0) return updDiff;
  return String(a.id || "").localeCompare(String(b.id || ""));
}

export function buildClientTaskTree(tasks = []) {
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
    node.children.sort(sortTaskNodes);
    node.depth = depth;
    node.ancestorIds = ancestorIds;
    node.pathTitles = [...pathTitles, node.title];
    let childCount = 0;
    let childOpenCount = 0;
    let childDoneCount = 0;
    for (const child of node.children) {
      annotate(child, depth + 1, [...ancestorIds, node.id], node.pathTitles);
      childCount += 1 + (child.childCount || 0);
      childOpenCount += (child.status === "open" ? 1 : 0) + (child.childOpenCount || 0);
      childDoneCount += (child.status === "done" ? 1 : 0) + (child.childDoneCount || 0);
    }
    node.childCount = childCount;
    node.childOpenCount = childOpenCount;
    node.childDoneCount = childDoneCount;
  };

  roots.sort(sortTaskNodes);
  for (const root of roots) annotate(root, 0, [], []);
  return roots;
}

export function flattenClientTaskTree(roots = []) {
  const out = [];
  const walk = (nodes) => {
    for (const node of nodes || []) {
      const { children, ...rest } = node;
      out.push(rest);
      if (Array.isArray(children) && children.length) walk(children);
    }
  };
  walk(roots);
  return out;
}

export function getTaskAncestors(tasks = [], taskId = "") {
  const byId = new Map((tasks || []).map((t) => [t.id, t]));
  const out = [];
  const seen = new Set([taskId]);
  let cur = byId.get(taskId)?.parentId || "";
  while (cur && byId.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    out.unshift(byId.get(cur));
    cur = byId.get(cur).parentId || "";
  }
  return out;
}

export function findTaskForThread(tasks = [], threadId = "", { includeClosed = false } = {}) {
  const cleanId = String(threadId || "").trim();
  if (!cleanId) return null;
  const matches = (tasks || []).filter((t) => (
    Array.isArray(t?.threadIds) && t.threadIds.includes(cleanId) && (includeClosed || t.status === "open")
  ));
  if (!matches.length) return null;
  matches.sort(sortTaskNodes);
  return matches[0];
}

export function shouldShowTaskStrip({ task = null, draftContext = null } = {}) {
  return Boolean(draftContext || task);
}

function sessionDotClass(th) {
  if (!th || th.missing) return "is-muted";
  if ((th.pendingCount || 0) > 0) return "is-waiting";
  if (th.live) return "is-running";
  if (th.lastError || th.lastTurnStatus === "failed") return "is-failed";
  return "is-idle";
}

function compactSessionLabel(th, fallbackId) {
  const provMap = { codex: "Codex", claude: "Claude", antigravity: "Agy", grok: "Grok", qoder: "Qoder" };
  const raw = String(th?.title || th?.name || fallbackId || "会话").replace(/\s+/g, " ").trim();
  const short = raw.length > 14 ? `${raw.slice(0, 13)}…` : raw;
  const p = provMap[th?.provider] || "";
  return p ? `${short}·${p}` : short;
}

export function renderTaskStripHtml({
  task = null,
  ancestors = [],
  children = [],
  siblingThreads = [],
  activeThreadId = "",
  draftContext = null,
  liveCwdWarning = "",
} = {}) {
  if (draftContext) {
    const modeLabel = draftContext.mode === "child" ? "新建子任务会话" : "关联任务新会话";
    const title = draftContext.taskTitle || draftContext.parentTitle || "新协作会话";
    const warnHtml = liveCwdWarning
      ? `<span class="task-strip-warn" title="${escapeHtml(liveCwdWarning)}">${iconSvg("warning", { size: 12 })}<span>${escapeHtml(liveCwdWarning)}</span></span>`
      : "";
    const backBtn = draftContext.sourceThreadId
      ? `<button type="button" class="task-strip-btn" data-task-strip-thread="${escapeHtml(draftContext.sourceThreadId)}">回到原会话</button>`
      : "";
    return `
      <div class="task-strip-row is-draft">
        <span class="task-strip-badge">${iconSvg("layers", { size: 12 })}<span>${escapeHtml(modeLabel)}</span></span>
        <span class="task-strip-title">${escapeHtml(title)}</span>
        ${warnHtml}
        <div class="task-strip-actions">
          ${backBtn}
          <button type="button" class="task-strip-btn is-muted" data-task-cancel-draft="1">取消关联</button>
        </div>
      </div>
    `;
  }

  if (!task) return "";

  const crumbs = [...ancestors.map((a) => a.title), task.title].filter(Boolean);
  const crumbText = crumbs.length > 2 ? `${crumbs[0]} › … › ${crumbs.at(-1)}` : crumbs.join(" › ");
  const childTotal = Number(task.childCount || children.length || 0);
  const childDone = Number(task.childDoneCount || 0);
  const childPill = childTotal > 0 ? `<span class="task-strip-subcount">子 ${childDone}/${childTotal}</span>` : "";
  const planPinned = Boolean(task.planRef?.threadId);
  const planTarget = task.planRef?.threadId || task.threadIds?.[0] || "";
  const planBtn = planTarget
    ? `<button type="button" class="task-strip-btn task-strip-plan ${planPinned ? "is-pinned" : ""}" data-task-jump-plan="${escapeHtml(task.id)}" title="${escapeHtml(planPinned ? "一键跳回已钉住的规划消息" : "跳回任务首个会话")}">${iconSvg("pin", { size: 12 })}<span>${planPinned ? "规划" : "源会话"}</span></button>`
    : "";

  const pillsHtml = (siblingThreads || []).map((th) => {
    const isCurrent = th.id === activeThreadId;
    const label = compactSessionLabel(th, th.id);
    return `<button type="button" class="task-strip-pill ${isCurrent ? "is-active" : ""}" data-task-strip-thread="${escapeHtml(th.id)}" title="${escapeHtml(th.title || th.id)}"><span class="task-dot ${sessionDotClass(th)}"></span><span>${escapeHtml(label)}</span></button>`;
  }).join("");

  return `
    <div class="task-strip-row">
      <button type="button" class="task-strip-crumb" data-task-open-modal="${escapeHtml(task.id)}" title="查看任务树与过程记录">
        ${iconSvg("layers", { size: 12 })}
        <span class="task-strip-crumb-text">${escapeHtml(crumbText)}</span>
        ${childPill}
      </button>
      ${planBtn}
      <div class="task-strip-pills">${pillsHtml}</div>
      <div class="task-strip-actions">
        <button type="button" class="task-strip-btn" data-task-new-sibling="${escapeHtml(task.id)}" title="保持当前会话继续跑，同时开一个同任务新会话">${iconSvg("plus", { size: 11 })}<span>关联会话</span></button>
        <button type="button" class="task-strip-btn" data-task-new-child="${escapeHtml(task.id)}" title="在此任务下拆分一个子任务并开新会话">${iconSvg("fork", { size: 11 })}<span>子任务</span></button>
      </div>
    </div>
  `;
}

function taskStatusLabel(task) {
  if (task.status === "done") return "已完成";
  if (task.status === "dropped") return "已放弃";
  const map = { running: "运转中", waiting: "待拍板", failed: "异常", passed: "待验收", missing: "待补齐", asking: "等你回复", idle: "进行中", lost: "进行中" };
  return map[task.state] || "进行中";
}

function filterTreeByQueryAndStatus(tasks, statusFilter, query) {
  const byId = new Map((tasks || []).map((t) => [t.id, t]));
  const q = String(query || "").trim().toLowerCase();
  const keepIds = new Set();
  for (const t of tasks || []) {
    const statusOk = statusFilter === "all" || t.status === statusFilter;
    const textMatch = !q || `${t.title} ${t.goal || ""} ${t.id}`.toLowerCase().includes(q);
    if (statusOk && textMatch) {
      let cur = t.id;
      const seen = new Set();
      while (cur && byId.has(cur) && !seen.has(cur)) {
        seen.add(cur);
        keepIds.add(cur);
        cur = byId.get(cur).parentId || "";
      }
    }
  }
  return buildClientTaskTree((tasks || []).filter((t) => keepIds.has(t.id)));
}

function formatLogTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 16);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function renderTaskTreeModalHtml({
  tasks = [],
  selectedTaskId = "",
  detailLogs = [],
  threadsById = new Map(),
  statusFilter = "open",
  query = "",
  collapsedIds = new Set(),
  bindPickerTaskId = "",
} = {}) {
  const roots = filterTreeByQueryAndStatus(tasks, statusFilter, query);
  const flatVisible = flattenClientTaskTree(roots);
  const byId = new Map((tasks || []).map((t) => [t.id, t]));
  const selected = (selectedTaskId && byId.get(selectedTaskId)) || flatVisible[0] || null;

  const renderNodes = (nodes) => nodes.map((node) => {
    const hasChildren = Boolean(node.children?.length);
    const isCollapsed = collapsedIds instanceof Set && collapsedIds.has(node.id);
    const isSelected = selected?.id === node.id;
    const indentPx = Math.min(5, node.depth || 0) * 16;
    const sessionCount = (node.threadIds || []).length;
    const subCount = node.childCount ? `${node.childDoneCount || 0}/${node.childCount}` : "";
    const stateCls = node.status === "done" ? "is-done" : (node.status === "dropped" ? "is-dropped" : (node.state === "running" ? "is-running" : (node.state === "waiting" ? "is-waiting" : "is-open")));
    const caretHtml = hasChildren
      ? `<button type="button" class="task-tree-caret" data-task-toggle-collapse="${escapeHtml(node.id)}" aria-label="${isCollapsed ? "展开子任务" : "折叠子任务"}">${isCollapsed ? "▸" : "▾"}</button>`
      : `<span class="task-tree-caret-spacer" aria-hidden="true">${node.depth > 0 ? "└" : ""}</span>`;
    return `
      <div class="task-tree-node-wrap">
        <div class="task-tree-row ${isSelected ? "is-selected" : ""} ${stateCls}" style="padding-left:${8 + indentPx}px" data-task-select="${escapeHtml(node.id)}">
          ${caretHtml}
          <span class="task-dot ${stateCls}"></span>
          <span class="task-tree-title">${escapeHtml(node.title)}</span>
          ${subCount ? `<span class="task-tree-chip" title="已完成/总子任务">${escapeHtml(subCount)}</span>` : ""}
          ${node.planRef?.threadId ? `<span class="task-tree-pin-mark" title="已钉住规划">${iconSvg("pin", { size: 11 })}</span>` : ""}
          <span class="task-tree-meta">${sessionCount} 会话</span>
        </div>
        ${hasChildren && !isCollapsed ? `<div class="task-tree-children">${renderNodes(node.children)}</div>` : ""}
      </div>
    `;
  }).join("");

  const treeHtml = roots.length
    ? renderNodes(roots)
    : `<div class="empty-state">暂无匹配任务。点击右上角「+ 新建根任务」，或在任意会话中点「设为规划」/「关联会话」自动成树。</div>`;

  let detailHtml = `<div class="empty-state">选择左侧任务查看规划、子任务、关联会话与过程时间线</div>`;
  if (selected) {
    const ancestors = getTaskAncestors(tasks, selected.id);
    const children = (tasks || []).filter((t) => t.parentId === selected.id);
    const pathText = [...ancestors.map((a) => a.title), selected.title].join(" › ");
    const sessions = (selected.threadIds || []).map((tid) => threadsById.get(tid) || { id: tid, title: tid, missing: true });
    const planTarget = selected.planRef?.threadId || selected.threadIds?.[0] || "";
    const availableToBind = bindPickerTaskId === selected.id
      ? [...threadsById.values()].filter((th) => !th.internal && !th.archived && !(selected.threadIds || []).includes(th.id)).slice(0, 15)
      : [];

    detailHtml = `
      <div class="task-detail-card">
        <div class="task-detail-head">
          <div>
            <div class="task-detail-crumb">${escapeHtml(pathText)} · <code>${escapeHtml(selected.id)}</code></div>
            <h4>${escapeHtml(selected.title)}</h4>
          </div>
          <span class="task-status-pill is-${escapeHtml(selected.status)}">${escapeHtml(taskStatusLabel(selected))}</span>
        </div>
        ${selected.goal ? `<p class="task-detail-goal">${escapeHtml(selected.goal)}</p>` : ""}
        <div class="task-detail-actions">
          ${planTarget ? `<button type="button" class="btn-secondary btn-xs" data-task-jump-plan="${escapeHtml(selected.id)}">${iconSvg("pin", { size: 12 })}<span>${selected.planRef?.threadId ? "跳回原规划" : "打开源会话"}</span></button>` : ""}
          <button type="button" class="btn-secondary btn-xs" data-task-new-sibling="${escapeHtml(selected.id)}">+ 关联新会话</button>
          <button type="button" class="btn-secondary btn-xs" data-task-new-child="${escapeHtml(selected.id)}">+ 子任务</button>
          <button type="button" class="btn-secondary btn-xs" data-task-toggle-bind="${escapeHtml(selected.id)}">关联已有会话</button>
          ${selected.status === "open"
            ? `<button type="button" class="btn-primary btn-xs" data-task-set-status="${escapeHtml(selected.id)}" data-status="done">标为完成</button>
               <button type="button" class="btn-secondary btn-xs" data-task-set-status="${escapeHtml(selected.id)}" data-status="dropped">放弃</button>`
            : `<button type="button" class="btn-secondary btn-xs" data-task-set-status="${escapeHtml(selected.id)}" data-status="open">重新打开</button>`}
        </div>

        ${bindPickerTaskId === selected.id ? `
          <div class="task-bind-picker">
            <div class="task-bind-picker-head">选择要挂入「${escapeHtml(selected.title)}」的已有会话：</div>
            <div class="task-bind-picker-list">
              ${availableToBind.length
                ? availableToBind.map((th) => `<button type="button" class="task-bind-option" data-task-bind-thread="${escapeHtml(selected.id)}" data-thread-id="${escapeHtml(th.id)}">${escapeHtml(th.title || th.id)} <span>${escapeHtml(th.provider || "")}</span></button>`).join("")
                : `<span class="task-muted">没有可新增关联的活跃会话</span>`}
            </div>
          </div>
        ` : ""}

        ${selected.criteria?.length ? `
          <div class="task-detail-block">
            <strong>验收标准</strong>
            <ol class="task-criteria-list">${selected.criteria.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ol>
          </div>
        ` : ""}

        <div class="task-detail-block">
          <strong>关联会话 (${sessions.length})</strong>
          <div class="task-session-list">
            ${sessions.length ? sessions.map((th) => `
              <div class="task-session-row">
                <button type="button" class="task-session-jump" data-task-strip-thread="${escapeHtml(th.id)}">
                  <span class="task-dot ${sessionDotClass(th)}"></span>
                  <span>${escapeHtml(th.title || th.id)}</span>
                  ${selected.planRef?.threadId === th.id ? `<span class="task-plan-tag">规划锚点</span>` : ""}
                </button>
                <button type="button" class="task-session-unbind" data-task-unbind-thread="${escapeHtml(selected.id)}" data-thread-id="${escapeHtml(th.id)}" title="从任务移除此会话">移除</button>
              </div>
            `).join("") : `<span class="task-muted">暂无关联会话</span>`}
          </div>
        </div>

        ${children.length ? `
          <div class="task-detail-block">
            <strong>子任务 (${children.length})</strong>
            <div class="task-child-list">
              ${children.map((ch) => `<button type="button" class="task-child-chip" data-task-select="${escapeHtml(ch.id)}"><span class="task-dot is-${escapeHtml(ch.status)}"></span><span>${escapeHtml(ch.title)}</span></button>`).join("")}
            </div>
          </div>
        ` : ""}

        <div class="task-detail-block">
          <strong>执行过程时间线 (${detailLogs.length})</strong>
          <form id="taskQuickLogForm" class="task-quick-log-form" data-task-id="${escapeHtml(selected.id)}">
            <input id="taskQuickLogInput" type="text" maxlength="300" placeholder="补记一条进展或说明…" />
            <button type="submit" class="btn-secondary btn-xs">记录</button>
          </form>
          <ul class="task-log-list">
            ${detailLogs.length
              ? detailLogs.slice().reverse().map((l) => `<li><span class="task-log-time">${escapeHtml(formatLogTime(l.ts))}</span><span class="task-log-kind">${escapeHtml(l.kind || "log")}</span><span class="task-log-text">${escapeHtml(l.text || "")}</span></li>`).join("")
              : `<li class="task-muted">暂无过程记录</li>`}
          </ul>
        </div>
      </div>
    `;
  }

  return `
    <div class="task-modal-grid">
      <div class="task-modal-tree-pane">${treeHtml}</div>
      <div class="task-modal-detail-pane">${detailHtml}</div>
    </div>
  `;
}
