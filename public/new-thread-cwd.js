import {
  buildProjectGroups,
  isSameProjectCwd,
  normalizeProjectCwd,
  projectBaseName,
} from "./project-board.js";

function fallbackEscapeHtml(value = "") {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fallbackIconSvg(name = "folder") {
  return `<span class="cwd-picker-icon-fallback" data-icon="${fallbackEscapeHtml(name)}"></span>`;
}

export function looksLikeDirectoryPath(raw = "") {
  const s = String(raw || "").trim();
  if (!s) return false;
  return s === "~"
    || /^~[\\/]/.test(s)
    || s.startsWith("/")
    || /^\.\.?[\\/]/.test(s)
    || s.startsWith("\\\\")
    || /^[A-Za-z]:(?:[\\/]|$)/.test(s);
}

export function normalizeDraftCwdInput(raw = "") {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (s === "~" || /^~[\\/]*$/.test(s)) return "~";
  if (/^~[\\/]/.test(s)) {
    return s.replace(/[\\/]+$/, "");
  }
  return normalizeProjectCwd(s);
}

export function formatCwdParts(cwd = "") {
  const full = String(cwd || "");
  if (!full) return { prefix: "", leaf: "", full: "" };
  const splitAt = Math.max(full.lastIndexOf("/"), full.lastIndexOf("\\"));
  if (splitAt >= 0 && splitAt < full.length - 1) {
    return {
      prefix: full.slice(0, splitAt + 1),
      leaf: full.slice(splitAt + 1),
      full,
    };
  }
  return { prefix: "", leaf: full, full };
}

export function collectNewThreadCwdOptions({
  threads = [],
  projectsMeta = {},
  currentCwd = "",
  scopedProjectCwd = "",
  query = "",
} = {}) {
  const cleanCurrent = normalizeDraftCwdInput(currentCwd);
  const cleanScoped = normalizeDraftCwdInput(scopedProjectCwd);
  const trimmedQuery = String(query || "").trim();

  const entries = [];
  const findEntry = (cwd) => entries.find((item) => isSameProjectCwd(item.cwd, cwd)) || null;

  const groups = buildProjectGroups(Array.isArray(threads) ? threads : [], {
    projectsMeta: projectsMeta || {},
    providerFilter: "all",
    profileFilter: "all",
    searchText: "",
  });

  for (const group of groups) {
    const cleanCwd = normalizeProjectCwd(group?.cwd);
    if (!cleanCwd || cleanCwd === "默认工作区") continue;
    if (findEntry(cleanCwd)) continue;
    entries.push({
      cwd: cleanCwd,
      rawName: group.rawName || projectBaseName(cleanCwd),
      alias: String(group.alias || "").trim(),
      name: String(group.name || group.alias || group.rawName || projectBaseName(cleanCwd)),
      pinned: Boolean(group.pinned),
      pinnedAt: Number(group.pinnedAt) || 0,
      latestUpdatedAt: Number(group.latestUpdatedAt) || 0,
      isCustomCurrent: false,
    });
  }

  for (const [rawCwd, meta] of Object.entries(projectsMeta || {})) {
    const cleanCwd = normalizeProjectCwd(rawCwd);
    if (!cleanCwd || cleanCwd === "默认工作区") continue;
    if (findEntry(cleanCwd)) continue;
    const rawName = projectBaseName(cleanCwd);
    const alias = String(meta?.alias || "").trim();
    entries.push({
      cwd: cleanCwd,
      rawName,
      alias,
      name: alias || rawName,
      pinned: Boolean(meta?.pinned),
      pinnedAt: Number(meta?.pinnedAt) || 0,
      latestUpdatedAt: 0,
      isCustomCurrent: false,
    });
  }

  if (cleanScoped && cleanScoped !== "默认工作区" && !findEntry(cleanScoped)) {
    const meta = projectsMeta?.[cleanScoped]
      || Object.entries(projectsMeta || {}).find(([k]) => isSameProjectCwd(k, cleanScoped))?.[1]
      || {};
    const rawName = projectBaseName(cleanScoped);
    const alias = String(meta?.alias || "").trim();
    entries.push({
      cwd: cleanScoped,
      rawName,
      alias,
      name: alias || rawName,
      pinned: Boolean(meta?.pinned),
      pinnedAt: Number(meta?.pinnedAt) || 0,
      latestUpdatedAt: 0,
      isCustomCurrent: false,
    });
  }

  if (cleanCurrent && cleanCurrent !== "默认工作区" && !findEntry(cleanCurrent)) {
    const rawName = projectBaseName(cleanCurrent);
    entries.push({
      cwd: cleanCurrent,
      rawName,
      alias: "",
      name: rawName,
      pinned: false,
      pinnedAt: 0,
      latestUpdatedAt: 0,
      isCustomCurrent: true,
    });
  }

  entries.sort((a, b) => {
    if (a.isCustomCurrent !== b.isCustomCurrent) return a.isCustomCurrent ? -1 : 1;
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) {
      const pinDiff = (Number(b.pinnedAt) || 0) - (Number(a.pinnedAt) || 0);
      if (pinDiff !== 0) return pinDiff;
    }
    const timeDiff = (Number(b.latestUpdatedAt) || 0) - (Number(a.latestUpdatedAt) || 0);
    if (timeDiff !== 0) return timeDiff;
    return String(a.name || "").localeCompare(String(b.name || ""), "zh-CN");
  });

  const q = trimmedQuery.toLowerCase();
  const normalizedQuery = normalizeDraftCwdInput(trimmedQuery);
  const filtered = q
    ? entries.filter((item) => {
      const hay = [item.name, item.alias, item.rawName, item.cwd].join(" ").toLowerCase();
      if (hay.includes(q)) return true;
      return Boolean(normalizedQuery && item.cwd.toLowerCase().includes(normalizedQuery.toLowerCase()));
    })
    : entries;

  const items = filtered.map((item) => ({
    kind: "project",
    cwd: item.cwd,
    name: item.name,
    subtitle: item.cwd,
    alias: item.alias,
    pinned: item.pinned,
    isCustomCurrent: item.isCustomCurrent,
    selected: Boolean(cleanCurrent && isSameProjectCwd(item.cwd, cleanCurrent)),
  }));

  if (
    trimmedQuery
    && looksLikeDirectoryPath(trimmedQuery)
    && normalizedQuery
    && !items.some((item) => isSameProjectCwd(item.cwd, normalizedQuery))
  ) {
    items.unshift({
      kind: "custom",
      cwd: normalizedQuery,
      name: "使用此目录路径",
      subtitle: normalizedQuery,
      alias: "",
      pinned: false,
      isCustomCurrent: false,
      selected: Boolean(cleanCurrent && isSameProjectCwd(normalizedQuery, cleanCurrent)),
    });
  }

  const matchesDefault = !q
    || "默认工作区（用户主目录）".toLowerCase().includes(q)
    || (q.length >= 2 && ("home".includes(q) || "default".includes(q)));
  if (matchesDefault) {
    items.push({
      kind: "default",
      cwd: "",
      name: "默认工作区（用户主目录）",
      subtitle: "留空，由智能体默认在主目录启动",
      alias: "",
      pinned: false,
      isCustomCurrent: false,
      selected: !cleanCurrent,
    });
  }

  return {
    items,
    currentCwd: cleanCurrent,
    query: trimmedQuery,
  };
}

export function renderNewThreadCwdListHtml(
  options = [],
  {
    highlightedIndex = 0,
    escapeHtml = fallbackEscapeHtml,
    iconSvg = fallbackIconSvg,
  } = {},
) {
  if (!Array.isArray(options) || options.length === 0) {
    return `<div class="cwd-picker-empty">没有匹配的项目，可直接输入完整目录路径后按回车使用</div>`;
  }
  return options.map((opt, idx) => {
    const isSelected = Boolean(opt?.selected);
    const isHighlighted = idx === highlightedIndex;
    const kind = opt?.kind || "project";
    const iconName = kind === "custom" ? "edit" : (opt?.pinned ? "star-filled" : "folder");
    const cls = [
      "cwd-picker-option",
      isSelected ? "is-selected" : "",
      isHighlighted ? "is-highlighted" : "",
      kind === "default" ? "is-default" : "",
      kind === "custom" ? "is-custom" : "",
    ].filter(Boolean).join(" ");
    return `<button`
      + ` type="button"`
      + ` role="option"`
      + ` class="${cls}"`
      + ` data-cwd-option-value="${escapeHtml(opt?.cwd ?? "")}"`
      + ` data-cwd-option-index="${idx}"`
      + ` aria-selected="${isSelected ? "true" : "false"}"`
      + `>`
      + `<span class="cwd-picker-opt-icon${opt?.pinned ? " is-pinned" : ""}" aria-hidden="true">${iconSvg(iconName, { size: 13 })}</span>`
      + `<span class="cwd-picker-opt-body">`
      + `<span class="cwd-picker-opt-name">${escapeHtml(opt?.name || "")}</span>`
      + `<code class="cwd-picker-opt-path">${escapeHtml(opt?.subtitle || opt?.cwd || "")}</code>`
      + `</span>`
      + `<span class="cwd-picker-opt-check" aria-hidden="true">${isSelected ? iconSvg("check", { size: 12 }) : ""}</span>`
      + `</button>`;
  }).join("");
}
