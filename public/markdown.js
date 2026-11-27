import { iconSvg, providerIconSvg } from "./icons.js";
import { extractCodexGoalContext } from "./codex-goal-context.js?v=20261117goalcontext";
import { extractCodexSkillContexts } from "./codex-skill-context.js?v=20261117skill";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeHref(rawHref) {
  const trimmed = String(rawHref || "").trim();
  if (!trimmed) return "#";
  if (/^(https?:|mailto:|file:|conversation:|#)/i.test(trimmed)) return trimmed;
  return "#";
}

const CLIENT_RASTER_IMAGE_EXT_RE = /\.(?:png|jpe?g|webp|gif)$/i;
const CLIENT_PREVIEW_FILE_EXT_RE = /\.(?:png|jpe?g|webp|gif|md|mdx|txt|log|json|jsonl|ya?ml|toml|xml|svg|html?|css|scss|mjs|cjs|js|jsx|tsx?|py|sh|zsh|sql|csv|tsv|mp4|webm|mov|mp3|wav|m4a|ogg|pdf|go|rs|java|kt|swift|vue|svelte)$/i;

function splitClientFileRefAndAnchor(rawRef = "") {
  let working = String(rawRef || "").trim();
  let startLine = null;
  let endLine = null;

  const hashMatch = working.match(/#L(\d+)(?:-L?(\d+))?$/i);
  if (hashMatch) {
    startLine = Number(hashMatch[1]) || null;
    endLine = Number(hashMatch[2] || hashMatch[1]) || startLine;
    working = working.slice(0, hashMatch.index);
  } else {
    const colonMatch = working.match(/:(\d+)(?::(\d+))?$/);
    if (colonMatch) {
      startLine = Number(colonMatch[1]) || null;
      endLine = startLine;
      working = working.slice(0, colonMatch.index);
    }
  }

  let cleanPath = working;
  if (/^file:\/\//i.test(cleanPath)) {
    try {
      const parsed = new URL(cleanPath);
      cleanPath = decodeURIComponent(parsed.pathname || "");
      if (/^\/[A-Za-z]:(?:\/|$)/.test(cleanPath)) cleanPath = cleanPath.slice(1);
    } catch {
      cleanPath = cleanPath.replace(/^file:\/\//i, "");
    }
  }
  return {
    cleanPath: cleanPath.trim(),
    startLine,
    endLine,
  };
}

function isLocalFileSystemPath(rawTarget = "") {
  const trimmed = String(rawTarget || "").trim();
  if (!trimmed) return false;
  return (
    /^\/(?:Users|Volumes|tmp|var|opt|home|etc|private)\//i.test(trimmed)
    || /^~\//.test(trimmed)
    || /^[A-Za-z]:[\\/]/.test(trimmed)
  );
}

function isPreviewableRelativePath(cleanPath = "") {
  const trimmed = String(cleanPath || "").trim();
  if (!trimmed || trimmed.startsWith("#")) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return false;
  if (trimmed.startsWith("//")) return false;
  return CLIENT_PREVIEW_FILE_EXT_RE.test(trimmed);
}

function parsePreviewableCodePath(codeText = "") {
  const trimmed = String(codeText || "").trim();
  if (!trimmed || trimmed.length > 360) return null;
  if (/^(?:https?:|mailto:|data:|#)/i.test(trimmed)) return null;
  if (/[;&|><$={}[\]()]/.test(trimmed)) return null;
  if (trimmed.startsWith("-")) return null;
  const { cleanPath, startLine, endLine } = splitClientFileRefAndAnchor(trimmed);
  if (!cleanPath || !CLIENT_PREVIEW_FILE_EXT_RE.test(cleanPath)) return null;
  const hasSpaces = /\s/.test(cleanPath);
  if (hasSpaces && !isLocalFileSystemPath(cleanPath) && !/^file:\/\//i.test(trimmed)) {
    return null;
  }
  const hasSlash = cleanPath.includes("/") || cleanPath.includes("\\");
  if (!hasSlash) {
    // Reject dotted property chains like foo.bar.js unless single filename stem + extension.
    if (!/^[^\s.][^\s./\\]*\.[a-z0-9]{1,6}$/i.test(cleanPath)) return null;
  }
  return { cleanPath, startLine, endLine };
}

const FAILED_THREAD_IMAGE_CACHE_LIMIT = 400;
const failedThreadImageKeys = new Set();

function normalizeFailedThreadImageKey(rawSrc = "") {
  const s = String(rawSrc || "").trim();
  if (!s) return "";
  const idx = s.indexOf("api/thread/image");
  if (idx < 0) return "";
  const qIdx = s.indexOf("?", idx);
  if (qIdx < 0) return s.slice(idx);
  const queryStr = s.slice(qIdx + 1).split("#")[0];
  try {
    const sp = new URLSearchParams(queryStr);
    const tid = sp.get("threadId") || "";
    const p = sp.get("path") || "";
    if (tid || p) return `threadId=${tid}&path=${p}`;
  } catch {
    // Ignore malformed query string; fallback to raw slice.
  }
  return s.slice(idx);
}

export function markThreadImageFailed(src = "") {
  const key = normalizeFailedThreadImageKey(src);
  if (!key) return false;
  if (failedThreadImageKeys.has(key)) {
    failedThreadImageKeys.delete(key);
  } else if (failedThreadImageKeys.size >= FAILED_THREAD_IMAGE_CACHE_LIMIT) {
    const oldest = failedThreadImageKeys.values().next().value;
    if (oldest !== undefined) failedThreadImageKeys.delete(oldest);
  }
  failedThreadImageKeys.add(key);
  return true;
}

export function isThreadImageFailed(src = "") {
  const key = normalizeFailedThreadImageKey(src);
  return key ? failedThreadImageKeys.has(key) : false;
}

export function clearFailedThreadImages() {
  failedThreadImageKeys.clear();
}

function buildThreadImageUrls(threadId, filePath) {
  const base = `./api/thread/image?threadId=${encodeURIComponent(threadId)}&path=${encodeURIComponent(filePath)}`;
  return {
    thumbSrc: `${base}&w=480&q=68`,
    inlineSrc: `${base}&w=960&q=70`,
    previewSrc: `${base}&w=1280&q=75`,
    rawSrc: `${base}&raw=1`,
  };
}

function localPathToFileHref(rawTarget = "") {
  const trimmed = String(rawTarget || "").trim();
  if (!trimmed) return "#";
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) {
    return `file:///${trimmed.replace(/\\/g, "/")}`;
  }
  if (trimmed.startsWith("/")) {
    return `file://${trimmed}`;
  }
  return "#";
}

function stripOptionalMatchingQuotes(raw = "") {
  const trimmed = String(raw || "").trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

export function formatPastedFileMarkdownLink(rawInput = "") {
  const candidate = stripOptionalMatchingQuotes(rawInput);
  if (!candidate) return "";
  const isFileUri = /^file:\/\//i.test(candidate);
  const { cleanPath, startLine, endLine } = splitClientFileRefAndAnchor(candidate);
  if (!cleanPath || (!isFileUri && !isLocalFileSystemPath(cleanPath))) return "";
  // 排除相对路径与 ~ 简写，确保链接始终带上文件绝对路径。
  if (/^~\//.test(cleanPath)) return "";

  const normalized = cleanPath.replace(/\\/g, "/").replace(/\/+$/, "");
  const segments = normalized.split("/").filter(Boolean);
  const baseName = segments.length ? segments[segments.length - 1] : cleanPath;
  const label = baseName.replace(/\[/g, "\\[").replace(/\]/g, "\\]");
  let href = localPathToFileHref(cleanPath);
  if (href === "#") return "";
  if (startLine) {
    href += endLine && endLine !== startLine ? `#L${startLine}-L${endLine}` : `#L${startLine}`;
  }
  const needsAngleBrackets = /[\s()<>]/.test(href);
  return `[${label}](${needsAngleBrackets ? `<${href}>` : href})`;
}

export function formatClipboardFilesAsMarkdownLinks({
  uriList = "",
  plainText = "",
  files = [],
  includeImages = false,
} = {}) {
  const links = [];
  const seen = new Set();
  const pushFormatted = (raw) => {
    const formatted = formatPastedFileMarkdownLink(raw);
    if (!formatted || seen.has(formatted)) return;
    seen.add(formatted);
    links.push(formatted);
  };

  const uriLines = String(uriList || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#") && /^file:\/\//i.test(line));
  for (const uri of uriLines) {
    if (!includeImages && CLIENT_RASTER_IMAGE_EXT_RE.test(uri.split(/[?#]/)[0])) continue;
    pushFormatted(uri);
  }

  for (const file of Array.isArray(files) ? files : []) {
    const filePath = String(file?.path || "").trim();
    if (!filePath) continue;
    const isImage = String(file?.type || "").startsWith("image/") || CLIENT_RASTER_IMAGE_EXT_RE.test(filePath);
    if (!includeImages && isImage) continue;
    pushFormatted(filePath);
  }

  if (!links.length && plainText) {
    const rawLines = String(plainText)
      .split(/\r?\n/)
      .map((line) => stripOptionalMatchingQuotes(line))
      .filter(Boolean);
    if (
      rawLines.length > 0
      && rawLines.every((line) => {
        if (/^\[[^\]]+\]\(/.test(line)) return false;
        const link = formatPastedFileMarkdownLink(line);
        if (!link) return false;
        return includeImages || !CLIENT_RASTER_IMAGE_EXT_RE.test(splitClientFileRefAndAnchor(line).cleanPath);
      })
    ) {
      for (const line of rawLines) pushFormatted(line);
    }
  }

  return links.join(" ");
}

function sanitizeImageSrc(rawSrc) {
  const trimmed = String(rawSrc || "").trim();
  if (!trimmed) return "";
  if (/^https?:/i.test(trimmed)) return trimmed;
  if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,[a-z0-9+/=\s]+$/i.test(trimmed)) {
    return trimmed.replace(/\s+/g, "");
  }
  return "";
}

function renderEscapedEmphasis(escapedText) {
  return escapedText
    .replace(/\*\*\*([^*]+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\w\x00])__([^_\n]+?)__(?=[^\w\x00]|$)/g, "$1<strong>$2</strong>")
    .replace(/~~([^~\n]+?)~~/g, "<del>$1</del>")
    .replace(/(?<!\*)\*([^*\s](?:[^*\n]*?[^*\s])?)\*(?!\*)/g, "<em>$1</em>")
    .replace(/(^|[^\w\x00])_([^_\s\n](?:[^_\n]*?[^_\s\n])?)_(?=[^\w\x00]|$)/g, "$1<em>$2</em>");
}

function restoreInlineTokens(html, tokens) {
  let out = html;
  for (let pass = 0; pass < 4 && out.includes("\x00MDTOK"); pass += 1) {
    out = out.replace(/\x00MDTOK(\d+)\x00/g, (_, idxStr) => tokens[Number(idxStr)] ?? "");
  }
  return out;
}

function renderDeferredOrEagerImageHtml({
  className = "msg-image",
  src = "",
  alt = "图片",
  title = "",
  previewSrc = "",
  previewRaw = "",
  previewCaption = "",
  deferImages = false,
} = {}) {
  const cleanSrc = String(src || "");
  if (!cleanSrc) return "";
  const shouldDefer = Boolean(deferImages && !cleanSrc.startsWith("data:"));
  const cls = shouldDefer ? `${className} is-deferred-image` : className;
  const srcAttr = shouldDefer
    ? `data-lazy-src="${escapeHtml(cleanSrc)}" decoding="async"`
    : `src="${escapeHtml(cleanSrc)}" loading="lazy"`;
  const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
  const previewAttr = previewSrc ? ` data-preview-src="${escapeHtml(previewSrc)}"` : "";
  const rawAttr = previewRaw ? ` data-preview-raw="${escapeHtml(previewRaw)}"` : "";
  const capAttr = previewCaption ? ` data-preview-caption="${escapeHtml(previewCaption)}"` : "";
  const imgTag = `<img class="${cls}" ${srcAttr}${previewAttr}${rawAttr}${capAttr} alt="${escapeHtml(alt)}"${titleAttr} />`;
  if (shouldDefer && className === "md-inline-img") {
    const label = alt || "图片";
    const tip = previewCaption || title || label;
    return `<span class="md-inline-img-wrap is-deferred"><button type="button" class="md-inline-img-trigger" data-reveal-inline-img="1" title="点击加载预览图：${escapeHtml(tip)}">${iconSvg("image", { size: 12 })}<span class="md-inline-img-label">${escapeHtml(label)}</span><span class="md-inline-img-hint">点击预览</span></button>${imgTag}</span>`;
  }
  return imgTag;
}

function renderRevealThreadImagesButtonHtml() {
  return `<button type="button" class="msg-reveal-thread-images-btn" data-reveal-thread-images="1" title="加载并展示当前会话的全部预览图">${iconSvg("image", { size: 12 })}<span>加载本会话预览图</span></button>`;
}

function resolveMarkdownFileRef(rawRef, basePath) {
  // Only file previews supply a base; normal conversation links keep using CWD.
  if (!basePath || !rawRef || /^(?:[a-z][a-z0-9+.-]*:|[/\\#]|~[\\/])/i.test(rawRef)) return rawRef;
  const separator = Math.max(basePath.lastIndexOf("/"), basePath.lastIndexOf("\\"));
  return separator < 0 ? rawRef : basePath.slice(0, separator + 1) + rawRef;
}

function renderInlineMarkdown(text, { threadId = "", deferImages = false, basePath = "" } = {}) {
  let working = String(text ?? "").replace(/\x00/g, "");
  if (!working) return "";

  const tokens = [];
  const stash = (html) => {
    const id = tokens.length;
    tokens.push(html);
    return `\x00MDTOK${id}\x00`;
  };

  // 1. Multi-backtick inline code spans (before escapes/links so code stays verbatim).
  working = working.replace(/(`+)([^\n]*?)\1/g, (_, _ticks, inner) => {
    const trimmed = inner.length >= 2 && inner.startsWith(" ") && inner.endsWith(" ") && inner.trim()
      ? inner.slice(1, -1)
      : inner;
    const fileRef = threadId ? parsePreviewableCodePath(trimmed) : null;
    if (fileRef) {
      fileRef.cleanPath = resolveMarkdownFileRef(fileRef.cleanPath, basePath);
      const lineAttr = fileRef.startLine ? ` data-local-file-line="${fileRef.startLine}"` : "";
      return stash(
        `<code class="md-code-file" data-local-file-path="${escapeHtml(fileRef.cleanPath)}"${lineAttr} title="点击查看：${escapeHtml(fileRef.cleanPath)}">${escapeHtml(trimmed)}</code>`,
      );
    }
    return stash(`<code>${escapeHtml(trimmed)}</code>`);
  });

  // 2. Backslash punctuation escapes.
  working = working.replace(/\\([\\`*_~[\]()#+-|.!$<>])/g, (_, ch) => stash(escapeHtml(ch)));

  // 3. Inline LaTeX math: \( ... \) or $ ... $ (skipping bare currency like $100).
  working = working.replace(/\\\(([^\n]+?)\\\)/g, (_, expr) => stash(`<span class="md-math-inline">${escapeHtml(expr.trim())}</span>`));
  working = working.replace(/(?<![\\$\w])\$([^\s$](?:[^$\n]*?[^\s$])?)\$(?!\d)/g, (full, expr) => {
    if (/^\d[\d,.\s]*(?:[-–~到至和与]\s*\d[\d,.\s]*)?$/.test(expr.trim())) return full;
    return stash(`<span class="md-math-inline">${escapeHtml(expr.trim())}</span>`);
  });

  // 4. Safe <kbd>...</kbd> inline keycap tags.
  working = working.replace(/<kbd>([^<>\n]{1,28})<\/kbd>/gi, (_, keyText) => (
    stash(`<kbd class="md-kbd">${escapeHtml(keyText.trim())}</kbd>`)
  ));

  // 5. Markdown images: ![alt](url) or ![alt](<url with spaces>) or ![alt](relative.png).
  working = working.replace(
    /!\[([^\]\n]*)\]\(\s*(?:<([^>\n]+)>|((?:\([^()\s]*\)|[^()\n])+?))(?:\s+"([^"\n]*)")?\s*\)/g,
    (_, altRaw, bracketHref, plainHref, titleRaw) => {
      const rawUrl = resolveMarkdownFileRef((bracketHref || plainHref || "").trim(), basePath);
      const safeImg = sanitizeImageSrc(rawUrl);
      if (safeImg) {
        return stash(
          renderDeferredOrEagerImageHtml({
            className: "md-inline-img",
            src: safeImg,
            alt: altRaw || "图片",
            title: titleRaw || "",
            deferImages,
          }),
        );
      }
      const ref = splitClientFileRefAndAnchor(rawUrl);
      const isFileProto = /^file:/i.test(rawUrl);
      const isLocalOrRel = isFileProto || isLocalFileSystemPath(ref.cleanPath) || isPreviewableRelativePath(ref.cleanPath);
      if (isLocalOrRel) {
        const label = altRaw || clientPathBasename(ref.cleanPath) || "本地图片";
        if (threadId && CLIENT_RASTER_IMAGE_EXT_RE.test(ref.cleanPath)) {
          const urls = buildThreadImageUrls(threadId, ref.cleanPath);
          if (!isThreadImageFailed(urls.inlineSrc)) {
            return stash(
              renderDeferredOrEagerImageHtml({
                className: "md-inline-img",
                src: urls.inlineSrc,
                previewSrc: urls.previewSrc,
                previewRaw: urls.rawSrc,
                previewCaption: ref.cleanPath,
                alt: label,
                deferImages,
              }),
            );
          }
        }
        const safeHref = escapeHtml(isFileProto ? sanitizeHref(rawUrl) : localPathToFileHref(ref.cleanPath));
        const fileAttr = ` data-local-file-path="${escapeHtml(ref.cleanPath)}"`;
        return stash(`<a class="md-file-link" href="${safeHref}"${fileAttr} title="${escapeHtml(ref.cleanPath)}" target="_blank" rel="noopener noreferrer">${iconSvg("image", { size: 12 })} ${escapeHtml(label)}</a>`);
      }
      return escapeHtml(altRaw ? `[图片: ${altRaw}]` : "[图片]");
    },
  );

  // 6. Markdown links: [label](url), [label](<file:///path>), [label](/local/path), or [label](rel/path.md).
  working = working.replace(
    /\[([^\]\n]+)\]\(\s*(?:<([^>\n]+)>|((?:\([^()\s]*\)|[^()\n])+?))(?:\s+"([^"\n]*)")?\s*\)/g,
    (_, labelRaw, bracketHref, plainHref, titleRaw) => {
      const rawUrl = resolveMarkdownFileRef((bracketHref || plainHref || "").trim(), basePath);
      const labelHtml = renderEscapedEmphasis(escapeHtml(labelRaw));
      const trimmedLabel = String(labelRaw || "").trim();
      const ref = splitClientFileRefAndAnchor(rawUrl);
      const isFileProto = /^file:/i.test(rawUrl);
      const isLocalPath = isLocalFileSystemPath(ref.cleanPath);
      const isRelPath = isPreviewableRelativePath(ref.cleanPath);
      const lineAttr = ref.startLine ? ` data-local-file-line="${ref.startLine}"` : "";

      if (trimmedLabel.startsWith("$") && (isFileProto || isLocalPath || isRelPath)) {
        const cleanTip = titleRaw ? `${rawUrl} · ${titleRaw}` : rawUrl;
        return stash(`<span class="md-skill-chip" data-local-file-path="${escapeHtml(ref.cleanPath)}"${lineAttr} title="${escapeHtml(cleanTip)}">${labelHtml}</span>`);
      }

      if (isLocalPath || isFileProto || isRelPath) {
        const fileHref = isFileProto
          ? sanitizeHref(rawUrl)
          : (isLocalPath ? localPathToFileHref(ref.cleanPath) : "#");
        const tipAttr = ` title="${escapeHtml(titleRaw || rawUrl)}"`;
        const fileAttrs = ` data-local-file-path="${escapeHtml(ref.cleanPath)}"${lineAttr}`;
        return stash(`<a class="md-file-link" href="${escapeHtml(fileHref)}"${fileAttrs}${tipAttr} target="_blank" rel="noopener noreferrer">${labelHtml}</a>`);
      }

      const safeUrl = sanitizeHref(rawUrl);
      const isConvRef = /^conversation:/i.test(safeUrl);
      const clsAttr = isConvRef ? ` class="md-file-link"` : "";
      const titleAttr = titleRaw ? ` title="${escapeHtml(titleRaw)}"` : (isConvRef ? ` title="${escapeHtml(rawUrl)}"` : "");
      return stash(`<a${clsAttr} href="${escapeHtml(safeUrl)}"${titleAttr} target="_blank" rel="noopener noreferrer">${labelHtml}</a>`);
    },
  );

  // 7. Bare URL auto-linking (stops before whitespace, CJK punctuation, Markdown emphasis delimiters, and balanced parens).
  working = working.replace(/https?:\/\/(?:(?!\*\*|~~)[^\s<>"'`\x00\u3000-\u303f\uff01-\uffef“”‘’])+/g, (rawMatch) => {
    let url = rawMatch;
    let suffix = "";
    const protoLen = url.indexOf("://") + 3;
    while (url.length > protoLen) {
      const last = url[url.length - 1];
      if (/[.,;:!?*_~。，；！？、]/.test(last)) {
        suffix = last + suffix;
        url = url.slice(0, -1);
        continue;
      }
      if (last === ")" && (url.match(/\(/g) || []).length < (url.match(/\)/g) || []).length) {
        suffix = ")" + suffix;
        url = url.slice(0, -1);
        continue;
      }
      if (last === "]" && (url.match(/\[/g) || []).length < (url.match(/\]/g) || []).length) {
        suffix = "]" + suffix;
        url = url.slice(0, -1);
        continue;
      }
      break;
    }
    if (url.length <= protoLen) return rawMatch;
    const anchor = stash(`<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`);
    return anchor + suffix;
  });

  const formatted = renderEscapedEmphasis(escapeHtml(working));
  return restoreInlineTokens(formatted, tokens);
}

function splitTableCells(line) {
  let trimmed = String(line || "").trim();
  if (trimmed.startsWith("|")) trimmed = trimmed.slice(1);
  if (trimmed.endsWith("|") && !trimmed.endsWith("\\|")) trimmed = trimmed.slice(0, -1);
  return trimmed
    .split(/(?<!\\)\|/)
    .map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function isFullPipeRow(line) {
  return /^\s*\|.+\|\s*$/.test(String(line || ""));
}

function parseTableAlignments(line) {
  const trimmed = String(line || "").trim();
  if (!trimmed.includes("|")) return null;
  const cells = splitTableCells(trimmed);
  const minCells = isFullPipeRow(trimmed) ? 1 : 2;
  if (cells.length < minCells) return null;
  const alignments = [];
  for (const cell of cells) {
    if (!/^:?-{2,}:?$/.test(cell)) return null;
    if (cell.startsWith(":") && cell.endsWith(":")) alignments.push("center");
    else if (cell.endsWith(":")) alignments.push("right");
    else if (cell.startsWith(":")) alignments.push("left");
    else alignments.push("");
  }
  return alignments;
}

function renderTableRowCells(tag, cells, colCount, alignments = [], { threadId = "", deferImages = false, basePath = "" } = {}) {
  const out = [];
  for (let c = 0; c < colCount; c += 1) {
    const align = alignments[c] || "";
    const alignAttr = align ? ` style="text-align:${align}"` : "";
    out.push(`<${tag}${alignAttr}>${renderInlineMarkdown(cells[c] || "", { threadId, deferImages, basePath })}</${tag}>`);
  }
  return `<tr>${out.join("")}</tr>`;
}

const ALERT_META = {
  note: { label: "NOTE · 说明", icon: iconSvg("info", { size: 13 }) },
  tip: { label: "TIP · 建议", icon: iconSvg("bulb", { size: 13 }) },
  important: { label: "IMPORTANT · 重要", icon: iconSvg("pin", { size: 13 }) },
  warning: { label: "WARNING · 注意", icon: iconSvg("warning", { size: 13 }) },
  caution: { label: "CAUTION · 警告", icon: iconSvg("error", { size: 13 }) },
};

const LIST_START_RE = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const HR_RE = /^\s*(?:-\s*){3,}$|^\s*(?:\*\s*){3,}$|^\s*(?:_\s*){3,}$/;
const HEADING_RE = /^\s*(#{1,6})\s+(.+?)(?:\s+#+\s*)?$/;
const FENCE_OPEN_RE = /^\s*(`{3,}|~{3,})(.*)$/;

function renderListItemsHtml(items, { threadId = "", deferImages = false, basePath = "" } = {}) {
  if (!items.length) return "";
  const html = [];
  const stack = [];

  const openListTag = (ordered, start) => (
    ordered ? `<ol${start > 1 ? ` start="${start}"` : ""}>` : "<ul>"
  );

  for (const item of items) {
    const tag = item.ordered ? "ol" : "ul";
    while (stack.length > 0 && item.indent < stack[stack.length - 1].baseIndent - 1) {
      const popped = stack.pop();
      if (popped.liOpen) html.push("</li>");
      html.push(`</${popped.tag}>`);
    }

    if (stack.length === 0 || item.indent > stack[stack.length - 1].baseIndent + 1) {
      stack.push({ baseIndent: item.indent, tag, liOpen: false });
      html.push(openListTag(item.ordered, item.start));
    } else {
      const top = stack[stack.length - 1];
      if (top.liOpen) {
        html.push("</li>");
        top.liOpen = false;
      }
      if (top.tag !== tag) {
        stack.pop();
        html.push(`</${top.tag}>`);
        stack.push({ baseIndent: item.indent, tag, liOpen: false });
        html.push(openListTag(item.ordered, item.start));
      }
    }

    const bodyHtml = item.lines.map((ln) => renderInlineMarkdown(ln, { threadId, deferImages, basePath })).join("<br />");
    if (item.taskChecked !== null) {
      const checkedCls = item.taskChecked ? " is-checked" : "";
      html.push(
        `<li class="md-task-item${checkedCls}"><span class="md-checkbox${checkedCls}" aria-hidden="true">${item.taskChecked ? iconSvg("check", { size: 11 }) : ""}</span><span class="md-task-body">${bodyHtml}</span>`,
      );
    } else {
      html.push(`<li>${bodyHtml}`);
    }
    stack[stack.length - 1].liOpen = true;
  }

  while (stack.length > 0) {
    const popped = stack.pop();
    if (popped.liOpen) html.push("</li>");
    html.push(`</${popped.tag}>`);
  }
  return html.join("");
}

function isBlockBoundaryLine(lines, index) {
  const line = lines[index] ?? "";
  if (!line.trim()) return true;
  if (FENCE_OPEN_RE.test(line)) return true;
  if (HR_RE.test(line)) return true;
  if (HEADING_RE.test(line)) return true;
  if (/^\s*>/.test(line)) return true;
  if (LIST_START_RE.test(line)) return true;
  if (/^\s*\$\$/.test(line)) return true;
  if (/^\s*<details(?:\s+open)?>\s*$/i.test(line)) return true;
  if (/^\s*<truncated\s+\d+\s+bytes>\s*$/i.test(line)) return true;
  if (line.includes("|") && parseTableAlignments(lines[index + 1])) return true;
  if (isFullPipeRow(line) && splitTableCells(line).length >= 2 && isFullPipeRow(lines[index + 1] || "") && splitTableCells(lines[index + 1] || "").length >= 2) {
    return true;
  }
  return false;
}

export function renderMarkdown(source, { depth = 0, threadId = "", deferImages = false, basePath = "" } = {}) {
  const text = String(source || "")
    .replace(/<!--\s*GOAL_COMPLETE\s*-->/g, "")
    .replace(/\r\n/g, "\n");
  if (!text.trim()) return "";

  const lines = text.split("\n");
  const html = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // 1. Blank line
    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 2. Fenced code blocks (``` or ~~~, any length >= 3)
    const fenceMatch = line.match(FENCE_OPEN_RE);
    if (fenceMatch) {
      const fence = fenceMatch[1];
      const fenceChar = fence[0];
      const fenceLen = fence.length;
      const codeLang = String(fenceMatch[2] || "").trim().split(/\s+/)[0] || "";
      const codeLines = [];
      let closed = false;
      i += 1;
      while (i < lines.length) {
        const closeRe = new RegExp(`^\\s*${fenceChar}{${fenceLen},}\\s*$`);
        if (closeRe.test(lines[i])) {
          closed = true;
          i += 1;
          break;
        }
        codeLines.push(lines[i]);
        i += 1;
      }
      const codeText = codeLines.join("\n");
      if (codeLang.toLowerCase() === "mermaid") {
        let diagramType = "";
        for (const rawMermaidLine of codeText.replace(/\r\n?/g, "\n").split("\n")) {
          const trimmedMermaid = rawMermaidLine.trim();
          if (!trimmedMermaid || trimmedMermaid.startsWith("%%")) continue;
          const mermaidTypes = [
            [/^(?:flowchart|graph)(?:\s|$)/i, "流程图"],
            [/^sequenceDiagram(?:\s|$)/i, "时序图"],
            [/^stateDiagram(?:-v2)?(?:\s|$)/i, "状态图"],
            [/^classDiagram(?:-v2)?(?:\s|$)/i, "类图"],
            [/^erDiagram(?:\s|$)/i, "ER 图"],
            [/^gantt(?:\s|$)/i, "甘特图"],
            [/^pie(?:\s|$)/i, "饼图"],
            [/^mindmap(?:\s|$)/i, "思维导图"],
            [/^timeline(?:\s|$)/i, "时间线"],
            [/^xychart-beta(?:\s|$)/i, "图表"],
            [/^gitGraph(?:\s|$)/i, "Git 图"],
            [/^journey(?:\s|$)/i, "旅程图"],
            [/^quadrantChart(?:\s|$)/i, "象限图"],
            [/^architecture-beta(?:\s|$)/i, "架构图"],
          ];
          const matched = mermaidTypes.find(([re]) => re.test(trimmedMermaid));
          if (matched) diagramType = matched[1];
          break;
        }
        const typeSuffix = diagramType ? ` · ${diagramType}` : "";
        const initialState = closed ? "pending" : "streaming";
        const initialView = closed ? "diagram" : "source";
        html.push(
          `<div class="md-code-block md-mermaid-block" data-mermaid-block="1" data-mermaid-state="${initialState}" data-mermaid-view="${initialView}"><div class="md-code-head md-mermaid-head"><span class="md-code-lang md-mermaid-lang">Mermaid${escapeHtml(typeSuffix)}</span><div class="md-mermaid-actions"><button type="button" class="md-copy-btn md-mermaid-btn" data-mermaid-toggle="1" aria-pressed="${closed ? "false" : "true"}"${closed ? "" : " hidden"} title="切换图表与源码">${closed ? "源码" : "图表"}</button><button type="button" class="md-copy-btn md-mermaid-btn" data-mermaid-zoom="1" hidden title="全屏缩放查看">放大</button><button type="button" class="md-copy-btn" data-copy-code title="复制代码">复制</button></div></div><div class="md-mermaid-stage" data-mermaid-stage${closed ? "" : " hidden"}>${closed ? '<div class="md-mermaid-placeholder">正在渲染图表…</div>' : ""}</div><div class="md-mermaid-error" data-mermaid-error hidden></div><pre class="md-pre md-mermaid-source" data-lang="mermaid"${closed ? " hidden" : ""}><code>${escapeHtml(codeText)}</code></pre></div>`,
        );
        continue;
      }
      html.push(
        `<div class="md-code-block"><div class="md-code-head"><span class="md-code-lang">${escapeHtml(codeLang || "text")}</span><button type="button" class="md-copy-btn" data-copy-code title="复制代码">复制</button></div><pre class="md-pre" data-lang="${escapeHtml(codeLang)}"><code>${escapeHtml(codeText)}</code></pre></div>`,
      );
      continue;
    }

    // 3. Display math block ($$ ... $$)
    const singleMath = line.match(/^\s*\$\$(.+?)\$\$\s*$/);
    if (singleMath) {
      html.push(`<div class="md-math-block">${escapeHtml(singleMath[1].trim())}</div>`);
      i += 1;
      continue;
    }
    if (/^\s*\$\$\s*$/.test(line)) {
      const mathLines = [];
      let closedAt = -1;
      for (let j = i + 1; j < lines.length; j += 1) {
        if (/^\s*\$\$\s*$/.test(lines[j])) {
          closedAt = j;
          break;
        }
        mathLines.push(lines[j]);
      }
      if (closedAt >= 0) {
        html.push(`<div class="md-math-block">${escapeHtml(mathLines.join("\n").trim())}</div>`);
        i = closedAt + 1;
        continue;
      }
    }

    // 4. Safe <details> ... </details>
    const detailsOpen = line.match(/^\s*<details(\s+open)?>\s*$/i);
    if (detailsOpen && depth < 4) {
      let closeIdx = -1;
      for (let j = i + 1; j < lines.length; j += 1) {
        if (/^\s*<\/details>\s*$/i.test(lines[j])) {
          closeIdx = j;
          break;
        }
      }
      if (closeIdx > i) {
        const innerLines = lines.slice(i + 1, closeIdx);
        let summaryText = "详情";
        const firstNonEmptyIdx = innerLines.findIndex((ln) => ln.trim().length > 0);
        if (firstNonEmptyIdx >= 0) {
          const sumMatch = innerLines[firstNonEmptyIdx].match(/^\s*<summary>([\s\S]*?)<\/summary>\s*$/i);
          if (sumMatch) {
            summaryText = sumMatch[1].trim() || "详情";
            innerLines.splice(firstNonEmptyIdx, 1);
          }
        }
        const bodyHtml = renderMarkdown(innerLines.join("\n"), { depth: depth + 1, threadId, deferImages, basePath });
        const openAttr = detailsOpen[1] ? " open" : "";
        html.push(
          `<details class="md-details"${openAttr}><summary>${renderInlineMarkdown(summaryText, { threadId, deferImages, basePath })}</summary><div class="md-details-body">${bodyHtml}</div></details>`,
        );
        i = closeIdx + 1;
        continue;
      }
    }

    // 5. Fallback notice if legacy <truncated N bytes> marker ever appears
    const truncMatch = line.match(/^\s*<truncated\s+(\d+)\s+bytes>\s*$/i);
    if (truncMatch) {
      html.push(
        `<div class="md-truncated-note">已省略中间 ${Number(truncMatch[1]).toLocaleString("en-US")} 字节内容</div>`,
      );
      i += 1;
      continue;
    }

    // 6. Standard GFM Table (header + separator |---|---| + body rows)
    const nextAligns = line.includes("|") ? parseTableAlignments(lines[i + 1]) : null;
    if (nextAligns) {
      const headerCells = splitTableCells(line);
      if (headerCells.length >= 1) {
        const colCount = Math.max(headerCells.length, nextAligns.length);
        const bodyRows = [];
        i += 2;
        while (i < lines.length) {
          const rowLine = lines[i];
          if (!rowLine.trim() || !rowLine.includes("|")) break;
          if (FENCE_OPEN_RE.test(rowLine) || HR_RE.test(rowLine) || HEADING_RE.test(rowLine)) break;
          bodyRows.push(splitTableCells(rowLine));
          i += 1;
        }
        const thead = `<thead>${renderTableRowCells("th", headerCells, colCount, nextAligns, { threadId, deferImages, basePath })}</thead>`;
        const tbody = bodyRows.length
          ? `<tbody>${bodyRows.map((cells) => renderTableRowCells("td", cells, colCount, nextAligns, { threadId, deferImages, basePath })).join("")}</tbody>`
          : "";
        html.push(`<div class="md-table-wrap"><table class="md-table">${thead}${tbody}</table></div>`);
        continue;
      }
    }

    // 7. Headerless pipe rows (2+ consecutive | a | b | lines)
    if (
      isFullPipeRow(line)
      && splitTableCells(line).length >= 2
      && isFullPipeRow(lines[i + 1] || "")
      && splitTableCells(lines[i + 1] || "").length >= 2
    ) {
      const rows = [];
      let colCount = 0;
      while (i < lines.length && isFullPipeRow(lines[i])) {
        const cells = splitTableCells(lines[i]);
        if (cells.length < 2) break;
        colCount = Math.max(colCount, cells.length);
        rows.push(cells);
        i += 1;
      }
      const tbody = `<tbody>${rows.map((cells) => renderTableRowCells("td", cells, colCount, [], { threadId, deferImages, basePath })).join("")}</tbody>`;
      html.push(`<div class="md-table-wrap"><table class="md-table is-headless">${tbody}</table></div>`);
      continue;
    }

    // 8. Horizontal rule
    if (HR_RE.test(line)) {
      html.push(`<hr class="md-hr" />`);
      i += 1;
      continue;
    }

    // 9. Headings (h1 - h6)
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const level = headingMatch[1].length;
      html.push(`<h${level}>${renderInlineMarkdown(headingMatch[2], { threadId, deferImages, basePath })}</h${level}>`);
      i += 1;
      continue;
    }

    // 10. Blockquotes & GitHub Alerts (> [!NOTE|TIP|IMPORTANT|WARNING|CAUTION])
    if (/^\s*>/.test(line)) {
      const quoteLines = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) {
        quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
        i += 1;
      }
      const alertMatch = (quoteLines[0] || "").match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s+(.*))?$/i);
      if (alertMatch && depth < 4) {
        const kind = alertMatch[1].toLowerCase();
        const meta = ALERT_META[kind] || ALERT_META.note;
        const restLines = [
          ...(alertMatch[2] ? [alertMatch[2]] : []),
          ...quoteLines.slice(1),
        ];
        const bodyHtml = restLines.join("\n").trim()
          ? renderMarkdown(restLines.join("\n"), { depth: depth + 1, threadId, deferImages, basePath })
          : "";
        html.push(
          `<div class="md-alert is-${kind}"><div class="md-alert-title"><span class="md-alert-icon" aria-hidden="true">${meta.icon}</span><span>${meta.label}</span></div>${bodyHtml ? `<div class="md-alert-body">${bodyHtml}</div>` : ""}</div>`,
        );
      } else {
        const innerHtml = depth < 4
          ? renderMarkdown(quoteLines.join("\n"), { depth: depth + 1, threadId, deferImages, basePath })
          : `<p>${quoteLines.map((ln) => renderInlineMarkdown(ln, { threadId, deferImages, basePath })).join("<br />")}</p>`;
        html.push(`<blockquote>${innerHtml}</blockquote>`);
      }
      continue;
    }

    // 11. Lists (nested ul/ol, ol start, task list [ ]/[x], soft-wrapped lines)
    if (LIST_START_RE.test(line)) {
      const listItems = [];
      while (i < lines.length) {
        const cur = lines[i];
        const lm = cur.match(LIST_START_RE);
        if (lm) {
          const indent = lm[1].replace(/\t/g, "  ").length;
          const ordered = Boolean(lm[3]);
          const start = ordered ? Math.max(1, Number(lm[3]) || 1) : 1;
          let itemText = lm[4];
          let taskChecked = null;
          const taskMatch = itemText.match(/^\[([ xX])\]\s+(.*)$/);
          if (taskMatch) {
            taskChecked = taskMatch[1].toLowerCase() === "x";
            itemText = taskMatch[2];
          }
          listItems.push({ indent, ordered, start, taskChecked, lines: [itemText] });
          i += 1;
          continue;
        }
        if (!cur.trim()) {
          if (i + 1 < lines.length && LIST_START_RE.test(lines[i + 1])) {
            i += 1;
            continue;
          }
          break;
        }
        if (listItems.length > 0 && /^\s{2,}\S/.test(cur) && !isBlockBoundaryLine(lines, i)) {
          listItems[listItems.length - 1].lines.push(cur.trim());
          i += 1;
          continue;
        }
        break;
      }
      html.push(renderListItemsHtml(listItems, { threadId, deferImages, basePath }));
      continue;
    }

    // 12. Paragraph (coalesce contiguous plain lines)
    const paraLines = [];
    while (i < lines.length && !isBlockBoundaryLine(lines, i)) {
      paraLines.push(lines[i]);
      i += 1;
    }
    if (paraLines.length) {
      html.push(`<p>${paraLines.map((ln) => renderInlineMarkdown(ln, { threadId, deferImages, basePath })).join("<br />")}</p>`);
    } else {
      // Defensive advance if a non-empty line wasn't claimed above (e.g. unclosed <details>).
      html.push(`<p>${renderInlineMarkdown(lines[i], { threadId, deferImages, basePath })}</p>`);
      i += 1;
    }
  }

  return html.join("");
}

function statusPillHtml(status) {
  if (!status || status === "completed") return `<span class="item-status ok">完成</span>`;
  if (status === "inProgress" || status === "running") return `<span class="item-status running">进行中</span>`;
  if (status === "interrupted" || status === "cancelled") return `<span class="item-status">已中断</span>`;
  if (status === "failed" || status === "declined") return `<span class="item-status err">失败</span>`;
  return `<span class="item-status">${escapeHtml(status)}</span>`;
}

function describeSleepToolCall(item) {
  if (!item || item.type !== "mcpToolCall") return null;
  const tool = String(item.tool || "").trim();
  if (!/^(?:clock\.)?sleep$/i.test(tool)) return null;
  const args = item.arguments && typeof item.arguments === "object" ? item.arguments : {};
  const rawDuration = Number(item.durationMs ?? args.duration_ms ?? args.durationMs);
  const dur = Number.isFinite(rawDuration) && rawDuration > 0 ? formatClientDurationMs(rawDuration) : "";
  const status = String(item.status || "completed");
  const isRunning = status === "inProgress" || status === "running";
  const isInterrupted = status === "interrupted" || status === "cancelled";
  let label = "clock.sleep";
  if (isRunning) {
    label = dur ? `clock.sleep · 定时等待 ${dur}` : "clock.sleep · 定时等待中";
  } else if (isInterrupted) {
    label = dur ? `clock.sleep · 等待 ${dur}（已中断）` : "clock.sleep · 已中断";
  } else if (dur) {
    label = `clock.sleep · 等待 ${dur}`;
  }
  return {
    kind: "等待",
    label,
    isSleep: true,
    output: String(item.resultText || item.output || "").trim(),
  };
}

const CLIENT_IMAGE_TAG_RE = /<image\b([^>\n]*\b(?:name|path)\s*=[^>\n]*)>(?:\s*<\/image>)?/gi;
const CLIENT_QUESTION_REPLY_TAG_RE = /<send_user_message_question_reply>\s*([\s\S]*?)\s*<\/send_user_message_question_reply>/gi;
const CLIENT_FILES_HEADER_RE = /^\s*#\s*Files (?:mentioned|pasted) by the user:(?:\s*\n|\s+)([\s\S]*)$/i;
const CLIENT_FILES_SPLIT_MULTILINE_RE = /\n+#+\s*My request:[ \t]*(?:\n|$)/i;
const CLIENT_FILES_SPLIT_INLINE_RE = /\s+##\s*My request:\s*/i;
const CLIENT_LEADING_MY_REQUEST_RE = /^\s*#+\s*My request:[ \t]*(?:\n|$)/i;
const CLIENT_AMBIENT_BROWSER_RE = /<in-app-browser-context\b[^>]*>[\s\S]*?<\/in-app-browser-context>/gi;
const CLIENT_EXTERNAL_APPS_RE = /<external_codex_apps_[^>]*>[\s\S]*?<\/external_codex_apps_[^>]*>/gi;
const CLIENT_APPS_CTX_RE = /<codex_apps_[^>]*>[\s\S]*?<\/codex_apps_[^>]*>/gi;
const CLIENT_HEARTBEAT_START_RE = /^\s*(?:```(?:xml)?\s*\n)?<heartbeat\b/i;
const CLIENT_HEARTBEAT_BLOCK_RE = /(?:```(?:xml)?\s*\n)?<heartbeat\b[^>]*>([\s\S]*?)<\/heartbeat>(?:\s*```)?/i;
const CLIENT_HEARTBEAT_INCOMPLETE_RE = /(?:```(?:xml)?\s*\n)?<heartbeat\b[^>]*>([\s\S]*)$/i;
const CLIENT_HTML_SPACE_RE = /(?:&#x0*20;|&#0*32;|&nbsp;)/gi;
const CLIENT_RASTER_EXT_RE = /\.(?:png|jpe?g|webp|gif)$/i;
const CLIENT_CLAUDE_SYS_PREFIX_RE = /\[SYSTEM NOTIFICATION - NOT USER INPUT\](?:[^\n]*\n?){0,6}?(?=\s*<task-notification\b|\s*$)/gi;
const CLIENT_CLAUDE_TASK_NOTIF_RE = /<task-notification\b[^>]*>([\s\S]*?)<\/task-notification>/gi;
const CLIENT_CLAUDE_CROSS_SESSION_RE = /(?:^|\n)[ \t]*(?:Another Claude session sent a message:\s*\n?)?<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/gi;
const CLIENT_CLAUDE_BASH_RE = /<bash-input\b[^>]*>([\s\S]*?)<\/bash-input>(?:\s*<bash-stdout\b[^>]*>([\s\S]*?)<\/bash-stdout>)?(?:\s*<bash-stderr\b[^>]*>([\s\S]*?)<\/bash-stderr>)?/gi;
const CLIENT_CLAUDE_INVISIBLE_NOISE_RE = /<(system-reminder|local-command-caveat|side-sessions-event|tools-used-before-summary)\b[^>]*>[\s\S]*?<\/\1>/gi;
const CLIENT_CLAUDE_COMPACT_PREFIX_RE = /^\s*This session is being continued from a previous conversation that ran out of context\.(?:\s+The summary below covers the earlier portion of the conversation\.)?\s*/i;
const CLIENT_CLAUDE_SLASH_TAG_RE = /<(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr)\b[^>]*>([\s\S]*?)<\/(?:command-name|command-message|command-args|local-command-stdout|local-command-stderr)>/gi;
const CLIENT_ANSI_ESCAPE_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function readClosedClientXmlTag(xmlBody = "", tagName = "") {
  const match = String(xmlBody || "").match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? match[1].trim() : "";
}

function parseClientXmlAttr(attrText = "", attrName = "") {
  const m = String(attrText || "").match(new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  return (m ? (m[1] ?? m[2] ?? m[3] ?? "") : "").trim();
}

function stripClientAnsi(value = "") {
  return String(value || "").replace(CLIENT_ANSI_ESCAPE_RE, "").trimEnd();
}

function formatClientDurationMs(rawMs = "") {
  const ms = Number(String(rawMs || "").trim());
  if (!Number.isFinite(ms) || ms <= 0) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSec = ms / 1000;
  if (totalSec < 60) return `${totalSec < 10 ? totalSec.toFixed(1) : Math.round(totalSec)}s`;
  const mins = Math.floor(totalSec / 60);
  const secs = Math.round(totalSec % 60);
  return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
}

function parseClientTaskNotificationBlock(inner = "") {
  return {
    taskId: readClosedClientXmlTag(inner, "task-id"),
    toolUseId: readClosedClientXmlTag(inner, "tool-use-id"),
    taskType: readClosedClientXmlTag(inner, "task-type"),
    event: readClosedClientXmlTag(inner, "event"),
    outputFile: readClosedClientXmlTag(inner, "output-file"),
    status: readClosedClientXmlTag(inner, "status").toLowerCase(),
    summary: readClosedClientXmlTag(inner, "summary").replace(/\s+/g, " ").trim(),
    note: readClosedClientXmlTag(inner, "note"),
    result: readClosedClientXmlTag(inner, "result"),
    durationMs: readClosedClientXmlTag(inner, "duration_ms"),
    toolUses: readClosedClientXmlTag(inner, "tool_uses"),
    subagentTokens: readClosedClientXmlTag(inner, "subagent_tokens"),
  };
}

function extractClientClaudeUserEvents(rawText = "") {
  let working = String(rawText || "");
  const taskNotifications = [];
  const crossSessionMessages = [];
  const bashEvents = [];
  const slashCommands = [];
  const compactSummaries = [];

  if (/<(?:task-notification|cross-session-message|bash-input|command-name|command-message|local-command-|system-reminder|side-sessions-event|tools-used-before-summary)\b/i.test(working)
    || working.includes("[SYSTEM NOTIFICATION - NOT USER INPUT]")) {
    working = working.replace(CLIENT_CLAUDE_SYS_PREFIX_RE, "\n");
    working = working.replace(CLIENT_CLAUDE_TASK_NOTIF_RE, (_, inner) => {
      taskNotifications.push(parseClientTaskNotificationBlock(inner));
      return "\n";
    });
    working = working.replace(CLIENT_CLAUDE_CROSS_SESSION_RE, (_, attrs, body) => {
      crossSessionMessages.push({
        from: parseClientXmlAttr(attrs, "from"),
        fromName: parseClientXmlAttr(attrs, "from-name"),
        body: String(body || "").trim(),
      });
      return "\n";
    });
    working = working.replace(CLIENT_CLAUDE_BASH_RE, (_, input, stdout = "", stderr = "") => {
      bashEvents.push({
        input: String(input || "").trim(),
        stdout: stripClientAnsi(stdout),
        stderr: stripClientAnsi(stderr),
      });
      return "\n";
    });
    if (/<(?:command-name|local-command-stdout|local-command-stderr)\b/i.test(working)) {
      const cmdName = readClosedClientXmlTag(working, "command-name");
      const cmdArgs = readClosedClientXmlTag(working, "command-args");
      const stdout = stripClientAnsi(readClosedClientXmlTag(working, "local-command-stdout"));
      const stderr = stripClientAnsi(readClosedClientXmlTag(working, "local-command-stderr"));
      if (cmdName || stdout || stderr) {
        slashCommands.push({ commandName: cmdName, commandArgs: cmdArgs, stdout, stderr });
      }
      working = working.replace(CLIENT_CLAUDE_SLASH_TAG_RE, "\n");
    }
    for (let pass = 0; pass < 3; pass += 1) {
      const next = working.replace(CLIENT_CLAUDE_INVISIBLE_NOISE_RE, "\n");
      if (next === working) break;
      working = next;
    }
  }

  if (CLIENT_CLAUDE_COMPACT_PREFIX_RE.test(working)) {
    const summaryBody = working
      .replace(CLIENT_CLAUDE_COMPACT_PREFIX_RE, "")
      .replace(/^\s*Summary:\s*/i, "")
      .trim();
    compactSummaries.push({
      summary: summaryBody,
    });
    working = "";
  }

  return {
    text: working,
    taskNotifications,
    crossSessionMessages,
    bashEvents,
    slashCommands,
    compactSummaries,
  };
}

function extractClientXmlTag(xmlBody = "", tagName = "") {
  const re = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = String(xmlBody || "").match(re);
  if (match) return match[1].trim();
  const unclosedRe = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*)$`, "i");
  const unclosed = String(xmlBody || "").match(unclosedRe);
  return unclosed ? unclosed[1].replace(/<[^>]*$/, "").trim() : "";
}

function parseClientHeartbeatUserPrompt(rawText = "") {
  const normalized = String(rawText || "").replace(/\r\n?/g, "\n");
  const match = normalized.match(CLIENT_HEARTBEAT_BLOCK_RE);
  if (!match) return null;
  const inner = match[1] || "";
  const automationId = extractClientXmlTag(inner, "automation_id");
  const currentTimeIso = extractClientXmlTag(inner, "current_time_iso");
  const instructions = extractClientXmlTag(inner, "instructions");
  if (!automationId && !currentTimeIso && !instructions) return null;
  return {
    heartbeat: { automationId, currentTimeIso, instructions },
    remainder: normalized.replace(match[0], "\n").trim(),
  };
}

function parseClientHeartbeatAgentReply(rawText = "", { allowIncomplete = false } = {}) {
  const normalized = String(rawText || "").replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return null;
  let match = normalized.match(CLIENT_HEARTBEAT_BLOCK_RE);
  if (!match && allowIncomplete) {
    match = normalized.match(CLIENT_HEARTBEAT_INCOMPLETE_RE);
  }
  if (!match) return null;
  const inner = match[1] || "";
  const automationId = extractClientXmlTag(inner, "automation_id");
  const decisionRaw = extractClientXmlTag(inner, "decision").toUpperCase();
  const message = extractClientXmlTag(inner, "message");
  const decision = decisionRaw === "NOTIFY" || decisionRaw === "DONT_NOTIFY"
    ? decisionRaw
    : (decisionRaw || (message && !match[0].includes("</heartbeat>") ? "" : "DONT_NOTIFY"));
  const extraText = normalized.replace(match[0], "\n").trim();
  return {
    automationId,
    decision,
    notify: decision === "NOTIFY",
    message,
    extraText,
  };
}

export function cleanStreamingAgentText(rawText = "") {
  const text = String(rawText || "");
  if (!CLIENT_HEARTBEAT_START_RE.test(text)) return text;
  const parsed = parseClientHeartbeatAgentReply(text, { allowIncomplete: true });
  if (!parsed) return text;
  const combined = [parsed.extraText, parsed.message].filter(Boolean).join("\n\n");
  return combined || "正在执行定时巡检…";
}

function parseTimestampMs(rawIsoOrSec) {
  if (!rawIsoOrSec) return NaN;
  if (typeof rawIsoOrSec === "number" && Number.isFinite(rawIsoOrSec)) {
    return rawIsoOrSec > 1e12 ? rawIsoOrSec : rawIsoOrSec * 1000;
  }
  const parsed = Date.parse(String(rawIsoOrSec).trim());
  return Number.isFinite(parsed) ? parsed : NaN;
}

function pad2(num) {
  return String(num).padStart(2, "0");
}

export function formatMessageTimeMeta(rawIsoOrSec, nowMs = Date.now()) {
  const tsMs = parseTimestampMs(rawIsoOrSec);
  if (!Number.isFinite(tsMs) || tsMs <= 0) return null;
  const dt = new Date(tsMs);
  if (Number.isNaN(dt.getTime())) return null;
  const now = new Date(nowMs);
  const year = dt.getFullYear();
  const month = pad2(dt.getMonth() + 1);
  const day = pad2(dt.getDate());
  const hour = pad2(dt.getHours());
  const minute = pad2(dt.getMinutes());
  const second = pad2(dt.getSeconds());
  const timePart = `${hour}:${minute}`;
  const full = `${year}-${month}-${day} ${timePart}:${second}`;
  const sameYear = year === now.getFullYear();
  const sameDay = sameYear && dt.getMonth() === now.getMonth() && dt.getDate() === now.getDate();
  const label = sameDay
    ? timePart
    : (sameYear ? `${month}-${day} ${timePart}` : `${year}-${month}-${day} ${timePart}`);
  return { label, full };
}

function renderMessageTimeTag(rawIsoOrSec) {
  const meta = formatMessageTimeMeta(rawIsoOrSec);
  if (!meta) return "";
  return `<span class="msg-time" title="${escapeHtml(meta.full)}">${escapeHtml(meta.label)}</span>`;
}

function formatHeartbeatTimeLabel(rawIsoOrSec) {
  const tsMs = parseTimestampMs(rawIsoOrSec);
  if (!Number.isFinite(tsMs) || tsMs <= 0) return "";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(tsMs));
  } catch {
    return "";
  }
}

function clientPathBasename(rawPath = "") {
  const parts = String(rawPath || "").trim().split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || String(rawPath || "").trim();
}

function stripClientWrappingQuotes(value = "") {
  const s = String(value || "").trim();
  if (s.length >= 2 && ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'")))) {
    return s.slice(1, -1).trim();
  }
  return s;
}

function parseClientCodexImageAttrs(attrText = "") {
  const attrs = String(attrText || "");
  const pathMatch = attrs.match(/\bpath\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i);
  const nameMatch = attrs.match(/\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|(\[[^\]\n]*\]|[^\s>]+))/i);
  const path = stripClientWrappingQuotes(pathMatch ? (pathMatch[1] ?? pathMatch[2] ?? pathMatch[3] ?? "") : "");
  const nameRaw = stripClientWrappingQuotes(nameMatch ? (nameMatch[1] ?? nameMatch[2] ?? nameMatch[3] ?? "") : "");
  const name = (!nameRaw || /^\[Image\s*#?\d*\]$/i.test(nameRaw))
    ? (clientPathBasename(path) || nameRaw || "图片")
    : nameRaw;
  return { name, path, label: nameRaw || name };
}

function parseClientQuestionReplyPayload(jsonText = "") {
  let parsed;
  try {
    parsed = JSON.parse(String(jsonText || "").trim());
  } catch {
    return [];
  }
  const list = Array.isArray(parsed) ? parsed : (parsed && typeof parsed === "object" ? [parsed] : []);
  const replies = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const question = String(entry.question || "").trim();
    const answerList = Array.isArray(entry.answers)
      ? entry.answers.map((v) => String(v ?? "").trim()).filter(Boolean)
      : [];
    const answer = answerList.length ? answerList.join(" / ") : String(entry.answer ?? "").trim();
    if (question || answer) replies.push({ question, answer });
  }
  return replies;
}

function extractClientFilesMentionedHeader(text = "") {
  const raw = String(text || "").replace(/\r\n?/g, "\n");
  const leadMatch = raw.match(CLIENT_FILES_HEADER_RE);
  if (!leadMatch) return null;
  const after = leadMatch[1] || "";
  let body = after;
  let requestText = "";
  const multi = after.match(CLIENT_FILES_SPLIT_MULTILINE_RE);
  if (multi && multi.index !== undefined) {
    body = after.slice(0, multi.index);
    requestText = after.slice(multi.index + multi[0].length);
  } else {
    const inline = after.match(CLIENT_FILES_SPLIT_INLINE_RE);
    if (inline && inline.index !== undefined) {
      body = after.slice(0, inline.index);
      requestText = after.slice(inline.index + inline[0].length);
    }
  }
  const images = [];
  const files = [];
  const lines = body.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const headerRe = /##\s+(?:"((?:[^"\n]|\\")+)"|([^\n":]+?)):\s+((?:\/|~\/|[A-Za-z]:[\\/])[^\n]+?)(?=\s+Image attachment:|\s+Distinguish instructions|\s+##\s+My request:|$)/gi;
    let m;
    while ((m = headerRe.exec(line)) !== null) {
      const cleanLabel = String(m[1] ?? m[2] ?? "").replace(/\\"/g, '"').trim();
      const rawPath = String(m[3] || "").trim().replace(/\s+…$/, "");
      if (!rawPath || rawPath.endsWith("…")) continue;
      const nextChunk = `${line.slice(m.index)}\n${lines[i + 1] || ""}`;
      if (/Image attachment:\s*true\b/i.test(nextChunk) || CLIENT_RASTER_EXT_RE.test(rawPath)) {
        images.push({
          type: "localImage",
          name: cleanLabel || clientPathBasename(rawPath) || "图片",
          path: rawPath,
          label: cleanLabel,
        });
      } else {
        files.push({
          type: "localFile",
          name: clientPathBasename(rawPath) || cleanLabel || "文件",
          path: rawPath,
          label: cleanLabel || clientPathBasename(rawPath) || "文件",
        });
      }
    }
  }
  return { images, files, text: String(requestText || "").replace(CLIENT_HTML_SPACE_RE, " ").trim() };
}

function cleanUserBubbleText(value) {
  let working = String(value || "").replace(/\r\n?/g, "\n");
  if (/<(?:USER_REQUEST|ADDITIONAL_METADATA|USER_SETTINGS_CHANGE|environment_context|system-reminder|skills_instructions|multi_agent_)\b/i.test(working)) {
    const matched = working.match(/<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i);
    const base = matched ? matched[1] : working;
    working = base
      .replace(/<\/?USER_REQUEST>/gi, "")
      .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, "")
      .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, "")
      .replace(/<environment_context>[\s\S]*?<\/environment_context>/gi, "")
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, "")
      .replace(/<skills_instructions>[\s\S]*?<\/skills_instructions>/gi, "")
      .replace(/<permissions instructions[\s\S]*?<\/permissions instructions>/gi, "")
      .replace(/<multi_agent_[^>]*>[\s\S]*?<\/multi_agent_[^>]*>/gi, "");
  }
  return working.trim();
}

function extractClientCodexUserText(rawText = "") {
  const goal = extractCodexGoalContext(rawText);
  const skillContext = extractCodexSkillContexts(goal.text);
  let working = skillContext.text;
  const images = [];
  const files = [];
  const questionReplies = [];

  if (CLIENT_HEARTBEAT_START_RE.test(working)) {
    const parsedHb = parseClientHeartbeatUserPrompt(working);
    if (parsedHb) {
      return {
        text: parsedHb.remainder,
        images,
        files,
        questionReplies,
        heartbeat: parsedHb.heartbeat,
        goalContext: goal.goalContext,
        skills: skillContext.skills,
        taskNotifications: [],
        crossSessionMessages: [],
        bashEvents: [],
        slashCommands: [],
      };
    }
  }

  const claudeEvents = extractClientClaudeUserEvents(working);
  working = claudeEvents.text;

  const hadAmbientWrapper = (
    CLIENT_AMBIENT_BROWSER_RE.test(working)
    || CLIENT_EXTERNAL_APPS_RE.test(working)
    || CLIENT_APPS_CTX_RE.test(working)
  );
  CLIENT_AMBIENT_BROWSER_RE.lastIndex = 0;
  CLIENT_EXTERNAL_APPS_RE.lastIndex = 0;
  CLIENT_APPS_CTX_RE.lastIndex = 0;

  working = working
    .replace(CLIENT_AMBIENT_BROWSER_RE, "\n")
    .replace(CLIENT_EXTERNAL_APPS_RE, "\n")
    .replace(CLIENT_APPS_CTX_RE, "\n");
  if (hadAmbientWrapper) {
    working = working.replace(CLIENT_LEADING_MY_REQUEST_RE, "");
  }

  working = working.replace(CLIENT_IMAGE_TAG_RE, (_, attrText) => {
    const img = parseClientCodexImageAttrs(attrText);
    if (img.path) {
      images.push({ type: "localImage", name: img.name, path: img.path, label: img.label });
    } else {
      images.push({ type: "image", name: img.name, path: "", missingFile: true });
    }
    return "\n";
  });
  working = working.replace(/^[ \t]*<\/image>[ \t]*$/gim, "\n").replace(/<\/image>/gi, " ");

  const filesHeader = extractClientFilesMentionedHeader(working);
  if (filesHeader) {
    images.push(...filesHeader.images);
    files.push(...filesHeader.files);
    working = filesHeader.text;
  }

  working = working.replace(CLIENT_QUESTION_REPLY_TAG_RE, (_, innerJson) => {
    const parsed = parseClientQuestionReplyPayload(innerJson);
    if (parsed.length) {
      questionReplies.push(...parsed);
      return "\n";
    }
    return "\n";
  });

  working = working.replace(CLIENT_HTML_SPACE_RE, " ");

  return {
    text: cleanUserBubbleText(working),
    images,
    files,
    questionReplies,
    heartbeat: null,
    goalContext: goal.goalContext,
    skills: skillContext.skills,
    taskNotifications: claudeEvents.taskNotifications,
    crossSessionMessages: claudeEvents.crossSessionMessages,
    bashEvents: claudeEvents.bashEvents,
    slashCommands: claudeEvents.slashCommands,
    compactSummaries: claudeEvents.compactSummaries,
  };
}

export function parseUserMessageContent(item) {
  const parts = Array.isArray(item?.content) ? item.content : [];
  const rawTexts = [];
  const rawImages = [];
  const rawFiles = [];

  for (const part of parts) {
    if (!part || typeof part !== "object") continue;
    const type = String(part.type || "").toLowerCase();
    if ((type === "text" || type === "input_text") && part.text) {
      rawTexts.push(part.text);
    } else if (type === "localfile" || type === "local_file") {
      const cleanPath = String(part.path || "").trim();
      if (cleanPath) {
        rawFiles.push({
          type: "localFile",
          name: part.name || clientPathBasename(cleanPath) || "文件",
          path: cleanPath,
          label: part.label || part.name || clientPathBasename(cleanPath) || "文件",
        });
      }
    } else if (type === "image" || type === "localimage" || type === "local_image" || type === "input_image") {
      if (part.url || part.image_url || part.path || part.missingFile) {
        rawImages.push({
          type: part.path ? "localImage" : "image",
          name: part.name || (part.path ? clientPathBasename(part.path) : "") || "图片",
          url: part.url || part.image_url || "",
          path: part.path || "",
          missingFile: Boolean(part.missingFile),
        });
      }
    }
  }
  if (!rawTexts.length && typeof item?.text === "string" && item.text.trim()) {
    rawTexts.push(item.text);
  }

  const parsedText = extractClientCodexUserText(rawTexts.join("\n"));
  const images = [];
  const seenPaths = new Set();
  const seenUrls = new Set();

  for (const img of [...rawImages, ...parsedText.images]) {
    const cleanPath = String(img.path || "").trim();
    const cleanUrl = String(img.url || "").trim();
    if (cleanPath) {
      if (seenPaths.has(cleanPath)) continue;
      seenPaths.add(cleanPath);
      images.push({
        type: "localImage",
        name: img.name || clientPathBasename(cleanPath) || "图片",
        path: cleanPath,
        url: cleanUrl,
      });
    } else if (cleanUrl) {
      if (seenUrls.has(cleanUrl)) continue;
      seenUrls.add(cleanUrl);
      images.push({
        type: "image",
        name: img.name || "图片",
        path: "",
        url: cleanUrl,
      });
    } else if (img.missingFile) {
      images.push({
        type: "image",
        name: img.name || "图片",
        path: "",
        missingFile: true,
      });
    }
  }

  const files = [];
  const seenFilePaths = new Set();
  for (const f of [...rawFiles, ...(parsedText.files || [])]) {
    const cleanPath = String(f.path || "").trim();
    if (!cleanPath || seenFilePaths.has(cleanPath)) continue;
    seenFilePaths.add(cleanPath);
    files.push({
      type: "localFile",
      name: f.name || clientPathBasename(cleanPath) || "文件",
      path: cleanPath,
      label: f.label || f.name || clientPathBasename(cleanPath) || "文件",
    });
  }

  const questionReplies = Array.isArray(item?.questionReplies) && item.questionReplies.length
    ? item.questionReplies
    : parsedText.questionReplies;

  const heartbeat = item?.heartbeat || parsedText.heartbeat || null;

  return {
    textParts: parsedText.text ? [parsedText.text] : [],
    images,
    files,
    questionReplies,
    heartbeat,
    goalContext: item?.goalContext || parsedText.goalContext || null,
    skills: parsedText.skills,
    taskNotifications: parsedText.taskNotifications || [],
    crossSessionMessages: parsedText.crossSessionMessages || [],
    bashEvents: parsedText.bashEvents || [],
    slashCommands: parsedText.slashCommands || [],
    compactSummaries: parsedText.compactSummaries || [],
  };
}

function isPlaceholderImagePathClient(rawPath = "") {
  const s = String(rawPath || "").trim();
  return !s || s.startsWith("[图片]");
}

function renderHeartbeatUserTrigger(heartbeat, { threadId = "" } = {}) {
  const autoId = String(heartbeat.automationId || "").trim();
  const autoName = String(heartbeat.automationName || "").trim();
  const titleText = autoName || autoId || "定时巡检";
  const timeLabel = formatHeartbeatTimeLabel(heartbeat.currentTimeIso);
  const instructions = String(heartbeat.instructions || "").trim();
  return `
    <div class="msg-row msg-automation-trigger">
      <div class="heartbeat-trigger-bar">
        <span class="heartbeat-badge">${iconSvg("clock", { size: 12 })}<span>定时任务</span></span>
        <span class="heartbeat-title">${escapeHtml(titleText)}</span>
        ${autoName && autoId ? `<span class="heartbeat-id-chip">${escapeHtml(autoId)}</span>` : ""}
        ${timeLabel ? `<span class="heartbeat-time">${escapeHtml(timeLabel)}</span>` : ""}
      </div>
      ${instructions ? `
        <details class="heartbeat-inst-details heartbeat-disclosure">
          <summary>查看巡检指令</summary>
          <div class="heartbeat-inst-body md-body">${renderMarkdown(instructions, { threadId })}</div>
        </details>
      ` : ""}
    </div>
  `;
}

function renderGoalContextCard(goalContext, { threadId = "" } = {}) {
  const objective = String(goalContext.objective || "");
  return `<div class="msg-row msg-goal-context">
    <details class="goal-context-card heartbeat-disclosure">
      <summary class="heartbeat-quiet-summary">
        <span class="heartbeat-badge">${iconSvg("target", { size: 12 })}<span>目标续跑</span></span>
        <span class="heartbeat-msg">${escapeHtml(objective)}</span>
      </summary>
      <div class="heartbeat-quiet-body md-body">${renderMarkdown(objective, { threadId })}</div>
    </details>
  </div>`;
}

function renderSkillContextCard(skill, { threadId = "" } = {}) {
  const file = threadId
    ? `<button type="button" class="msg-file-chip is-clickable" data-local-file-path="${escapeHtml(skill.path)}" title="${escapeHtml(skill.path)}">${iconSvg("paperclip", { size: 12 })}<span>打开 SKILL.md</span></button>`
    : "";
  return `<div class="msg-row msg-skill-context">
    <details class="skill-context-card task-notif-card heartbeat-disclosure">
      <summary class="task-notif-summary" title="展开技能说明">
        <span class="task-notif-badge">${iconSvg("bolt", { size: 12 })}<span>技能加载</span></span>
        <strong class="skill-context-name">${escapeHtml(skill.name)}</strong>
        <span class="task-notif-chevron">${iconSvg("chevron-down", { size: 12 })}</span>
      </summary>
      <div class="task-notif-body">
        <div class="skill-context-source"><code>${escapeHtml(skill.path)}</code>${file}${renderMessageCopyButton(skill.body)}</div>
        <div class="skill-context-content md-body">${renderMarkdown(skill.body, { threadId, deferImages: true })}</div>
      </div>
    </details>
  </div>`;
}

const TASK_NOTIF_STATUS_META = {
  completed: { tone: "ok", label: "后台任务 · 已完成", icon: "check" },
  failed: { tone: "err", label: "后台任务 · 失败", icon: "error" },
  error: { tone: "err", label: "后台任务 · 失败", icon: "error" },
  stopped: { tone: "warn", label: "后台任务 · 已停止", icon: "stop" },
  cancelled: { tone: "warn", label: "后台任务 · 已取消", icon: "stop" },
  canceled: { tone: "warn", label: "后台任务 · 已取消", icon: "stop" },
  interrupted: { tone: "warn", label: "后台任务 · 已中断", icon: "stop" },
  running: { tone: "running", label: "后台任务 · 运行中", icon: "clock" },
  in_progress: { tone: "running", label: "后台任务 · 运行中", icon: "clock" },
};

function renderTaskNotificationCard(notif, { threadId = "" } = {}) {
  const statusKey = String(notif.status || "").toLowerCase();
  const meta = TASK_NOTIF_STATUS_META[statusKey] || {
    tone: "neutral",
    label: statusKey ? `后台任务 · ${statusKey}` : "后台任务",
    icon: "info",
  };
  const summaryText = notif.summary || notif.note || notif.taskId || "后台任务状态通知";
  const durationLabel = formatClientDurationMs(notif.durationMs);
  const outputChip = notif.outputFile
    ? (threadId
      ? `<button type="button" class="msg-file-chip is-clickable" data-local-file-path="${escapeHtml(notif.outputFile)}" title="点击查看输出文件：${escapeHtml(notif.outputFile)}">${iconSvg("paperclip", { size: 12 })}<span>${escapeHtml(clientPathBasename(notif.outputFile))}</span></button>`
      : `<div class="msg-file-chip" title="${escapeHtml(notif.outputFile)}">${iconSvg("paperclip", { size: 12 })}<span>${escapeHtml(clientPathBasename(notif.outputFile))}</span></div>`)
    : "";

  const techChips = [
    notif.taskId ? `task-id: ${notif.taskId}` : "",
    notif.toolUseId ? `tool-use: ${notif.toolUseId}` : "",
    notif.taskType ? `type: ${notif.taskType}` : "",
    notif.event ? `event: ${notif.event}` : "",
    notif.toolUses ? `tools: ${notif.toolUses}` : "",
    notif.subagentTokens ? `tokens: ${notif.subagentTokens}` : "",
  ].filter(Boolean);

  const hasBody = Boolean(notif.note || notif.result || outputChip || techChips.length);
  const headHtml = `
    <span class="task-notif-badge is-${meta.tone}">${iconSvg(meta.icon, { size: 12 })}<span>${escapeHtml(meta.label)}</span></span>
    <span class="task-notif-title">${escapeHtml(summaryText)}</span>
    <span class="task-notif-meta">
      ${durationLabel ? `<span class="task-notif-pill">${escapeHtml(durationLabel)}</span>` : ""}
      ${notif.taskId ? `<code class="task-notif-id">${escapeHtml(notif.taskId)}</code>` : ""}
      ${hasBody ? `<span class="task-notif-chevron">${iconSvg("chevron-down", { size: 12 })}</span>` : ""}
    </span>
  `;

  if (!hasBody) {
    return `<div class="msg-row msg-task-notification"><div class="task-notif-card is-${meta.tone} is-static"><div class="task-notif-summary">${headHtml}</div></div></div>`;
  }

  return `
    <div class="msg-row msg-task-notification">
      <details class="task-notif-card is-${meta.tone}">
        <summary class="task-notif-summary">${headHtml}</summary>
        <div class="task-notif-body">
          ${notif.note ? `<div class="task-notif-note">${escapeHtml(notif.note)}</div>` : ""}
          ${notif.result ? `
            <div class="task-notif-section">
              <div class="task-notif-section-label">执行结果</div>
              <div class="task-notif-result md-body">${renderMarkdown(notif.result, { threadId })}</div>
            </div>
          ` : ""}
          ${outputChip ? `<div class="task-notif-files">${outputChip}</div>` : ""}
          ${techChips.length ? `<div class="task-notif-tech">${techChips.map((c) => `<code>${escapeHtml(c)}</code>`).join("")}</div>` : ""}
        </div>
      </details>
    </div>
  `;
}

function renderCrossSessionMessageCard(msg, { threadId = "" } = {}) {
  const fromLabel = msg.fromName || msg.from || "其他会话";
  const previewLine = String(msg.body || "").replace(/\s+/g, " ").trim();
  const hasBody = Boolean(msg.body);
  return `
    <div class="msg-row msg-cross-session">
      <details class="task-notif-card is-info">
        <summary class="task-notif-summary">
          <span class="task-notif-badge is-info">${iconSvg("chat", { size: 12 })}<span>跨会话消息</span></span>
          <span class="task-notif-title">${escapeHtml(fromLabel)}</span>
          ${previewLine ? `<span class="task-notif-snippet">${escapeHtml(previewLine)}</span>` : ""}
          ${hasBody ? `<span class="task-notif-meta"><span class="task-notif-chevron">${iconSvg("chevron-down", { size: 12 })}</span></span>` : ""}
        </summary>
        ${hasBody ? `<div class="task-notif-body"><div class="task-notif-result md-body">${renderMarkdown(msg.body, { threadId })}</div></div>` : ""}
      </details>
    </div>
  `;
}

function renderClaudeBashCard(ev) {
  const cmd = String(ev.input || "").trim();
  const out = [ev.stdout, ev.stderr].filter(Boolean).join("\n").trim();
  const hasErr = Boolean(ev.stderr);
  const headHtml = `
    <span class="task-notif-badge ${hasErr ? "is-err" : "is-neutral"}">${iconSvg("bolt", { size: 12 })}<span>本地命令</span></span>
    <code class="claude-bash-cmd">$ ${escapeHtml(cmd || "(empty)")}</code>
    ${out ? `<span class="task-notif-meta"><span class="task-notif-chevron">${iconSvg("chevron-down", { size: 12 })}</span></span>` : ""}
  `;
  if (!out) {
    return `<div class="msg-row msg-claude-bash"><div class="task-notif-card is-neutral is-static"><div class="task-notif-summary">${headHtml}</div></div></div>`;
  }
  return `
    <div class="msg-row msg-claude-bash">
      <details class="task-notif-card ${hasErr ? "is-err" : "is-neutral"}">
        <summary class="task-notif-summary">${headHtml}</summary>
        <div class="task-notif-body">
          ${ev.stdout ? `<pre class="claude-bash-output"><code>${escapeHtml(ev.stdout)}</code></pre>` : ""}
          ${ev.stderr ? `<pre class="claude-bash-output is-stderr"><code>${escapeHtml(ev.stderr)}</code></pre>` : ""}
        </div>
      </details>
    </div>
  `;
}

function renderClaudeCompactSummaryCard(item = {}, { threadId = "" } = {}) {
  const summary = String(item.summary || "").trim();
  if (!summary) {
    return `
      <div class="msg-row msg-claude-bash">
        <div class="task-notif-card is-neutral is-static">
          <div class="task-notif-summary">
            <span class="task-notif-badge is-neutral">${iconSvg("bolt", { size: 12 })}<span>上下文已压缩</span></span>
            <span class="task-notif-snippet">已自动归纳前序对话摘要</span>
          </div>
        </div>
      </div>
    `;
  }
  const snippet = summary.replace(/\s+/g, " ").trim();
  const previewText = snippet.length > 90 ? `${snippet.slice(0, 90).trim()}…` : snippet;
  return `
    <div class="msg-row msg-claude-bash">
      <details class="task-notif-card is-neutral">
        <summary class="task-notif-summary">
          <span class="task-notif-badge is-neutral">${iconSvg("bolt", { size: 12 })}<span>上下文已压缩</span></span>
          <span class="task-notif-snippet">${escapeHtml(previewText)}</span>
          <span class="task-notif-meta"><span class="task-notif-chevron">${iconSvg("chevron-down", { size: 12 })}</span></span>
        </summary>
        <div class="task-notif-body md-body">${renderMarkdown(summary, { threadId, deferImages: true })}</div>
      </details>
    </div>
  `;
}

function renderSlashCommandCard(cmd) {
  const fullCmd = [cmd.commandName, cmd.commandArgs].filter(Boolean).join(" ").trim();
  const out = [cmd.stdout, cmd.stderr].filter(Boolean).join("\n").trim();
  return `
    <div class="msg-row msg-claude-bash">
      <div class="task-notif-card is-neutral is-static">
        <div class="task-notif-summary">
          <span class="task-notif-badge is-neutral">${iconSvg("settings", { size: 12 })}<span>指令</span></span>
          ${fullCmd ? `<code class="claude-bash-cmd">${escapeHtml(fullCmd)}</code>` : ""}
          ${out ? `<span class="task-notif-snippet">${escapeHtml(out.replace(/\s+/g, " "))}</span>` : ""}
        </div>
      </div>
    </div>
  `;
}

export function renderMessageCopyButton(text = "", { forkTurnIndex = -1, forkTurnId = "", allowPinPlan = false } = {}) {
  const content = String(text).replace(/<!--\s*GOAL_COMPLETE\s*-->/g, "");
  if (!content.trim()) return "";
  const copyHtml = `<button type="button" class="msg-copy-btn" data-copy-message="${escapeHtml(content)}" title="复制消息文字（Markdown）" aria-label="复制消息文字">${iconSvg("clipboard", { size: 12 })}<span>复制</span></button>`;
  if (!Number.isInteger(forkTurnIndex) || forkTurnIndex < 0) return copyHtml;
  const forkHtml = `<button type="button" class="msg-copy-btn msg-fork-btn" data-fork-turn-index="${forkTurnIndex}" data-fork-turn-id="${escapeHtml(forkTurnId)}" title="从此处分叉为新会话（丢弃下方后续对话）" aria-label="从此处分叉为新会话">${iconSvg("fork", { size: 12 })}<span>分叉</span></button>`;
  const planHtml = allowPinPlan
    ? `<button type="button" class="msg-copy-btn msg-plan-btn" data-pin-plan-turn-index="${forkTurnIndex}" data-pin-plan-turn-id="${escapeHtml(forkTurnId)}" title="将此回复设为任务规划锚点，后续从兄弟会话一键跳回" aria-label="设为任务规划">${iconSvg("pin", { size: 12 })}<span>设为规划</span></button>`
    : "";
  return `${copyHtml}${forkHtml}${planHtml}`;
}

function renderUserItem(item, { threadId = "", deferImages = false, forkTurnIndex = -1, forkTurnId = "", timestamp = null } = {}) {
  const {
    textParts,
    images,
    files,
    questionReplies,
    heartbeat,
    goalContext,
    skills,
    taskNotifications,
    crossSessionMessages,
    bashEvents,
    slashCommands,
    compactSummaries,
  } = parseUserMessageContent(item);
  const hasNormalUserContent = Boolean(images.length || files.length || questionReplies.length || textParts.length);
  const skillCards = skills.map((skill) => renderSkillContextCard(skill, { threadId }));
  if (heartbeat && !hasNormalUserContent) {
    return skillCards.join("") + renderHeartbeatUserTrigger(heartbeat, { threadId });
  }
  const eventCards = [
    ...(goalContext ? [renderGoalContextCard(goalContext, { threadId })] : []),
    ...skillCards,
    ...taskNotifications.map((n) => renderTaskNotificationCard(n, { threadId })),
    ...crossSessionMessages.map((m) => renderCrossSessionMessageCard(m, { threadId })),
    ...bashEvents.map((b) => renderClaudeBashCard(b)),
    ...slashCommands.map((c) => renderSlashCommandCard(c)),
    ...compactSummaries.map((c) => renderClaudeCompactSummaryCard(c, { threadId })),
  ];
  if (!hasNormalUserContent) {
    return eventCards.join("");
  }
  const imageParts = [];
  let deferredImageCount = 0;
  for (const part of images) {
    const label = part.name || (part.path ? clientPathBasename(part.path) : "") || "图片";
    const directSrc = part.url && (part.url.startsWith("data:") || part.url.startsWith("http")) ? part.url : "";
    const urls = buildThreadImageUrls(threadId, part.path);
    const localSrc = (!directSrc && part.path && threadId && !part.missingFile && !isPlaceholderImagePathClient(part.path) && !isThreadImageFailed(urls.thumbSrc))
      ? urls.thumbSrc
      : "";
    const previewSrc = directSrc || (localSrc ? urls.previewSrc : "");
    const rawAttr = (!directSrc && localSrc) ? ` data-preview-raw="${escapeHtml(urls.rawSrc)}"` : "";
    const src = directSrc || localSrc;
    const tip = part.path || label;
    if (src) {
      const cardDeferred = Boolean(deferImages && !src.startsWith("data:"));
      if (cardDeferred) deferredImageCount += 1;
      const btnTitle = cardDeferred ? `点击加载预览图：${tip}` : `点击放大预览：${tip}`;
      imageParts.push(`
        <div class="msg-image-card${cardDeferred ? " is-deferred" : ""}">
          <button type="button" class="msg-image-btn" data-preview-src="${escapeHtml(previewSrc)}"${rawAttr} data-preview-caption="${escapeHtml(tip)}" title="${escapeHtml(btnTitle)}">
            <span class="msg-image-deferred-lead" aria-hidden="true">${iconSvg("image", { size: 13 })}</span>
            ${renderDeferredOrEagerImageHtml({ className: "msg-image", src, alt: label, deferImages: cardDeferred })}
            <span class="msg-image-caption">${escapeHtml(label)}</span>
          </button>
          ${part.path ? `<div class="msg-file-chip is-fallback" hidden title="${escapeHtml(part.path)}">${iconSvg("image", { size: 12 })}<span>${escapeHtml(label)}</span></div>` : ""}
        </div>
      `);
    } else {
      imageParts.push(`<div class="msg-file-chip" title="${escapeHtml(tip)}">${iconSvg("image", { size: 12 })}<span>${escapeHtml(isPlaceholderImagePathClient(part.path) ? part.path : label)}</span></div>`);
    }
  }
  const revealUserImagesBtnHtml = deferredImageCount > 0 ? renderRevealThreadImagesButtonHtml() : "";
  const fileChips = files.map((file) => (
    threadId
      ? `<button type="button" class="msg-file-chip is-clickable" data-local-file-path="${escapeHtml(file.path)}" title="点击查看：${escapeHtml(file.path)}">${iconSvg("paperclip", { size: 12 })}<span>${escapeHtml(file.name)}</span></button>`
      : `<div class="msg-file-chip" title="${escapeHtml(file.path)}">${iconSvg("paperclip", { size: 12 })}<span>${escapeHtml(file.name)}</span></div>`
  ));
  const repliesHtml = questionReplies.length
    ? `
      <div class="user-question-replies">
        ${questionReplies.map((qr) => `
          <div class="user-question-reply">
            ${qr.question ? `<div class="user-qr-q" title="${escapeHtml(qr.question)}">${escapeHtml(qr.question)}</div>` : ""}
            ${qr.answer ? `<div class="user-qr-a"><span class="user-qr-badge">回答</span><span>${escapeHtml(qr.answer)}</span></div>` : ""}
          </div>
        `).join("")}
      </div>
    `
    : "";
  const userTimeHtml = renderMessageTimeTag(item?.timestamp || item?.createdAt || item?.startedAt || timestamp);
  return `${eventCards.join("")}
    <div class="msg-row msg-user">
      <div class="msg-meta"><span class="msg-role">你</span>${userTimeHtml}${renderMessageCopyButton([
        ...questionReplies.map((qr) => [qr.question, qr.answer].filter(Boolean).join("\n")),
        textParts.join("\n"),
      ].filter(Boolean).join("\n\n"), { forkTurnIndex, forkTurnId })}</div>
      <div class="msg-bubble user-bubble">
        ${imageParts.length ? `<div class="msg-images">${imageParts.join("")}${revealUserImagesBtnHtml}</div>` : ""}
        ${fileChips.length ? `<div class="msg-files">${fileChips.join("")}</div>` : ""}
        ${repliesHtml}
        ${textParts.length ? `<div class="md-body">${renderMarkdown(textParts.join("\n"), { threadId, deferImages })}</div>` : ""}
      </div>
    </div>
  `;
}

const RAW_TOOL_ECHO_RE = /^(?:Created At:\s*\d{4}-\d{2}-\d{2}|Completed At:\s*\d{4}-\d{2}-\d{2}|Showing lines \d+-\d+ of \d+|Partial read \(lines|Command exited with code \d+|Made \d+ replacements? in |Wrote \d+ bytes to |Encountered error in (?:tool|step) execution:)/m;
const READ_TOOL_RE = /^(read_file|view_file|read|list_dir|ls)$/i;
const SEARCH_TOOL_RE = /^(grep(?:_search)?|glob|search(?:_web)?|find.*|semble.*)$/i;
const EDIT_TOOL_RE = /^(edit_file|write_file|write_to_file|replace.*|multi_edit|multi_replace.*|patch)$/i;
const CMD_TOOL_RE = /^(run_command|exec_command|bash|manage_task)$/i;
const STEP_ECHO_HEADER_RE = /^(?:(?:Created At|Completed At):[^\n]*(?:\n|$))+/i;
const STEP_EXEC_PREFIX_RE = /^Encountered error in (?:step|tool) execution:\s*/i;
const FILE_NOT_FOUND_ERR_RE = /\bfile does not exist\b|\bno such file or directory\b|\bENOENT\b|\bpath does not exist\b/i;
const SPAWN_ERR_RE = /\bspawn(?:\s+[^\n]+)?\s+ENOENT\b/i;
const INVALID_LINE_RANGE_ERR_RE = /\binvalid line range\b|StartLine\s+\d+\s+is greater than EndLine\s+\d+/i;
const START_END_LINE_ERR_RE = /StartLine\s+(\d+)\s+is greater than EndLine\s+(\d+)/i;
const TARGET_NOT_FOUND_ERR_RE = /target content not found in the file|Target must exactly match existing file text/i;
const IS_DIR_ERR_RE = /\bis a directory\b|\bEISDIR\b/i;
const ALREADY_FORMATTED_TOOL_ERR_RE = /^(?:文件不存在|行号范围无效|补丁内容未匹配|目标是目录而非文件|单步工具未通过)/;

function stripStepEchoHeadersClient(rawText = "") {
  return String(rawText ?? "")
    .replace(/\r\n/g, "\n")
    .replace(STEP_ECHO_HEADER_RE, "")
    .trim();
}

function stripStepEchoPrefixClient(rawText = "") {
  return stripStepEchoHeadersClient(rawText)
    .replace(STEP_EXEC_PREFIX_RE, "")
    .replace(STEP_ECHO_HEADER_RE, "")
    .trim();
}

export function isRecoverableToolErrorText(rawText = "") {
  if (!rawText) return false;
  if (typeof rawText === "object") {
    if (rawText.recoverable === true) return true;
    if (String(rawText.syscall || "").startsWith("spawn")) return false;
    rawText = rawText.message || rawText.error?.message || "";
  }
  const clean = String(rawText || "").trim();
  if (!clean) return false;
  if (SPAWN_ERR_RE.test(clean)) return false;
  return (
    /Encountered error in (?:step|tool) execution:/i.test(clean)
    || FILE_NOT_FOUND_ERR_RE.test(clean)
    || INVALID_LINE_RANGE_ERR_RE.test(clean)
    || TARGET_NOT_FOUND_ERR_RE.test(clean)
    || IS_DIR_ERR_RE.test(clean)
  );
}

export function formatToolExecutionError(rawText = "", { filePath = "", toolName = "" } = {}) {
  const reason = stripStepEchoPrefixClient(rawText);
  const explicitLabel = shortPathLabel(filePath);
  const fallbackMatch = reason.match(/(?:file:\/\/)?(?:\/[^\s"'`:;,)]+|(?:[\w.-]+[/\\])+[\w.-]+\.[A-Za-z0-9_-]+)/);
  const fileLabel = explicitLabel || (fallbackMatch?.[0] ? shortPathLabel(fallbackMatch[0]) : "");

  if (!reason) {
    const cleanTool = String(toolName || "").trim();
    if (fileLabel) return `单步工具未通过：${fileLabel}`;
    return cleanTool ? `单步工具未通过（${cleanTool}）` : "单步工具未通过";
  }

  if (ALREADY_FORMATTED_TOOL_ERR_RE.test(reason)) {
    if (explicitLabel && !reason.includes(explicitLabel)) {
      if (reason === "文件不存在" || reason === "补丁内容未匹配" || reason === "目标是目录而非文件" || /^行号范围无效/.test(reason)) {
        return `${reason}：${explicitLabel}`;
      }
    }
    return reason;
  }

  if (FILE_NOT_FOUND_ERR_RE.test(reason)) {
    return fileLabel ? `文件不存在：${fileLabel}` : "文件不存在";
  }

  if (INVALID_LINE_RANGE_ERR_RE.test(reason)) {
    const rangeMatch = reason.match(START_END_LINE_ERR_RE);
    const prefix = rangeMatch
      ? `行号范围无效（第 ${rangeMatch[1]}–${rangeMatch[2]} 行）`
      : "行号范围无效";
    return fileLabel ? `${prefix}：${fileLabel}` : prefix;
  }

  if (TARGET_NOT_FOUND_ERR_RE.test(reason)) {
    return fileLabel ? `补丁内容未匹配：${fileLabel}` : "补丁内容未匹配";
  }

  if (IS_DIR_ERR_RE.test(reason)) {
    return fileLabel ? `目标是目录而非文件：${fileLabel}` : "目标是目录而非文件";
  }

  return fileLabel ? `单步工具未通过（${fileLabel}）：${reason}` : `单步工具未通过：${reason}`;
}

export function unwrapToolText(value) {
  let text = String(value ?? "").trim();
  if (!text) return "";
  for (let i = 0; i < 2; i += 1) {
    if (text.length >= 2 && text.startsWith("\"") && text.endsWith("\"")) {
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed === "string") {
          text = parsed.trim();
          continue;
        }
      } catch {
        text = text.slice(1, -1).trim();
        continue;
      }
    }
    break;
  }
  return text.replace(/^File\s+/, "").replace(/^(?:\.\.?[/\\])+/, "").trim();
}

export function formatCompactPath(rawPath) {
  const cleaned = unwrapToolText(rawPath).replace(/^file:\/\//i, "").trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/[/\\]+/).filter((seg) => seg && seg !== "." && seg !== "..");
  if (!parts.length) return cleaned;
  return parts.length >= 2 ? `${parts[parts.length - 2]}/${parts[parts.length - 1]}` : parts[0];
}

export function isRawToolEchoItem(item) {
  if (!item || typeof item !== "object") return false;
  if (item.type === "mcpToolCall" && item.tool === "exit_plan_mode") return true;
  if (item.type === "agentMessage") {
    if (String(item.id || "").startsWith("agy-gen-")) return true;
    const rawText = String(item.text || "").trim();
    if (item.phase === "commentary" && RAW_TOOL_ECHO_RE.test(rawText)) {
      return true;
    }
    if (/^Created At:/i.test(rawText)) {
      const body = stripStepEchoHeadersClient(rawText);
      if (/^(?:Encountered error in (?:tool|step) execution:|Showing lines \d+-\d+ of \d+)/i.test(body)) {
        return true;
      }
    }
  }
  return false;
}

function shortPathLabel(rawPath) {
  const cleaned = unwrapToolText(rawPath).replace(/^file:\/\//i, "").trim();
  if (!cleaned) return "";
  const parts = cleaned.split(/[/\\]+/).filter((seg) => seg && seg !== "." && seg !== "..");
  return parts.length ? parts[parts.length - 1] : cleaned;
}

function mergeProcessStatus(prevStatus, nextStatus) {
  if (nextStatus === "failed" || nextStatus === "declined" || prevStatus === "failed" || prevStatus === "declined") {
    return "failed";
  }
  if (nextStatus === "inProgress" || nextStatus === "running" || prevStatus === "inProgress" || prevStatus === "running") {
    return "inProgress";
  }
  return nextStatus || prevStatus || "completed";
}

function extractReasoningText(item) {
  if (!item || typeof item !== "object" || item.type !== "reasoning") return "";
  const lines = (
    Array.isArray(item.content) && item.content.length
      ? item.content
      : (Array.isArray(item.summary) ? item.summary : [])
  ).filter(Boolean);
  if (lines.length) return lines.join("\n\n");
  return typeof item.text === "string" ? item.text : "";
}

function collectProcessDigest(processItems) {
  const editMap = new Map();
  const editedNames = [];
  const editedNameSet = new Set();
  const readNames = [];
  const readNameSet = new Set();
  const readErrors = [];
  const commandMap = new Map();
  const otherTools = [];
  const notes = [];
  const reasoningBlocks = [];
  let readCount = 0;
  let searchCount = 0;
  let cmdTotalCount = 0;

  const pushEdited = (rawPath, status, errorMessage = "", recoverable = false) => {
    const compact = formatCompactPath(rawPath) || "文件改动";
    const shortName = shortPathLabel(rawPath) || "文件改动";
    if (!editedNameSet.has(shortName)) {
      editedNameSet.add(shortName);
      editedNames.push(shortName);
    }
    const existing = editMap.get(compact);
    if (existing) {
      existing.count += 1;
      existing.status = mergeProcessStatus(existing.status, status);
      if (rawPath && !existing.rawPath) existing.rawPath = rawPath;
      if (errorMessage) existing.errorMessage = errorMessage;
      if (recoverable) existing.recoverable = true;
    } else {
      editMap.set(compact, {
        compactPath: compact,
        rawPath: rawPath && rawPath !== "文件改动" ? rawPath : "",
        shortName,
        count: 1,
        status: status || "completed",
        errorMessage,
        recoverable: Boolean(recoverable),
      });
    }
  };

  const pushReadName = (rawPath) => {
    const shortName = shortPathLabel(rawPath);
    if (shortName && !readNameSet.has(shortName)) {
      readNameSet.add(shortName);
      readNames.push(shortName);
    }
  };

  const pushCommand = (command, { status = "completed", output = "", errorMessage = "" } = {}) => {
    cmdTotalCount += 1;
    const key = unwrapToolText(command) || "命令";
    const existing = commandMap.get(key);
    if (existing) {
      existing.count += 1;
      existing.status = mergeProcessStatus(existing.status, status);
      if (output) existing.output = output;
      if (errorMessage) existing.errorMessage = errorMessage;
    } else {
      commandMap.set(key, {
        command: key,
        count: 1,
        status: status || "completed",
        output,
        errorMessage,
      });
    }
  };

  for (const item of Array.isArray(processItems) ? processItems : []) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "reasoning") {
      const reasoningText = extractReasoningText(item);
      if (reasoningText) reasoningBlocks.push(reasoningText);
    } else if (item.type === "agentMessage") {
      const compactText = String(item.text || "").replace(/\s+/g, " ").trim();
      if (compactText) notes.push(compactText);
    } else if (item.type === "fileChange") {
      const changes = Array.isArray(item.changes) && item.changes.length ? item.changes : [{ path: "文件改动" }];
      const rawErr = item.error?.message ? String(item.error.message) : "";
      const recoverable = Boolean(item.error?.recoverable || isRecoverableToolErrorText(rawErr));
      for (const c of changes) {
        const formattedErr = rawErr
          ? formatToolExecutionError(rawErr, { filePath: c?.path || "", toolName: "fileChange" })
          : "";
        pushEdited(c?.path || "", item.status || "completed", formattedErr, recoverable);
      }
    } else if (item.type === "commandExecution") {
      pushCommand(item.command || "", {
        status: item.status || "completed",
        output: String(item.aggregatedOutput || "").trim(),
        errorMessage: item.error?.message ? formatToolExecutionError(item.error.message, { toolName: "run_command" }) : "",
      });
    } else if (item.type === "mcpToolCall") {
      const tool = String(item.tool || "");
      const args = item.arguments && typeof item.arguments === "object" ? item.arguments : {};
      const errMsg = item.error?.message ? String(item.error.message) : "";
      const rawPath = args.Path || args.path || args.TargetFile || args.AbsolutePath || args.DirectoryPath || args.File || args.file_path || "";
      const recoverable = Boolean(item.error?.recoverable || isRecoverableToolErrorText(errMsg));
      if (READ_TOOL_RE.test(tool)) {
        readCount += 1;
        pushReadName(rawPath);
        if (item.status === "failed" || errMsg) {
          readErrors.push({
            shortName: shortPathLabel(rawPath) || "读取文件",
            message: formatToolExecutionError(errMsg || "文件读取未通过", { filePath: rawPath, toolName: tool }),
          });
        }
      } else if (SEARCH_TOOL_RE.test(tool)) {
        searchCount += 1;
        if (item.status === "failed" || errMsg) {
          readErrors.push({
            shortName: shortPathLabel(rawPath) || tool,
            message: formatToolExecutionError(errMsg || "检索未通过", { filePath: rawPath, toolName: tool }),
          });
        }
      } else if (EDIT_TOOL_RE.test(tool)) {
        const formattedErr = errMsg
          ? formatToolExecutionError(errMsg, { filePath: rawPath, toolName: tool })
          : "";
        pushEdited(rawPath, item.status || "completed", formattedErr, recoverable);
      } else if (CMD_TOOL_RE.test(tool)) {
        pushCommand(args.toolSummary || args.CommandLine || args.command || tool, {
          status: item.status || "completed",
          errorMessage: errMsg ? formatToolExecutionError(errMsg, { filePath: rawPath, toolName: tool }) : "",
        });
      } else {
        const sleepInfo = describeSleepToolCall(item);
        const label = sleepInfo ? sleepInfo.label : (unwrapToolText(args.toolSummary || "") || tool || "工具调用");
        otherTools.push({
          kind: sleepInfo ? sleepInfo.kind : "工具",
          label: label.slice(0, 80),
          status: item.status || "completed",
          output: sleepInfo ? sleepInfo.output : "",
          errorMessage: errMsg ? formatToolExecutionError(errMsg, { filePath: rawPath, toolName: tool }) : "",
          recoverable,
        });
      }
    }
  }

  return {
    editMap,
    editedNames,
    readNames,
    readErrors,
    readCount,
    searchCount,
    commandMap,
    cmdTotalCount,
    otherTools,
    notes,
    reasoningBlocks,
  };
}

function extractAgentOutputImagePaths(text = "", maxCount = 6) {
  const src = String(text || "");
  if (!src) return [];
  const withoutCodeBlocks = src.replace(/```[\s\S]*?```/g, " ");
  const inlineImgPaths = new Set();
  const inlineImgRe = /!\[[^\]\n]*\]\(\s*(?:<([^>\n]+)>|((?:\([^()\s]*\)|[^()\n])+?))(?:\s+"[^"\n]*")?\s*\)/g;
  let m;
  while ((m = inlineImgRe.exec(withoutCodeBlocks)) !== null) {
    const rawTarget = String(m[1] || m[2] || "").trim();
    const ref = splitClientFileRefAndAnchor(rawTarget);
    if (ref.cleanPath && CLIENT_RASTER_IMAGE_EXT_RE.test(ref.cleanPath)) {
      inlineImgPaths.add(ref.cleanPath);
    }
  }

  const found = [];
  const seen = new Set();
  const pushIfRaster = (rawTarget) => {
    if (found.length >= maxCount) return;
    const rawStr = String(rawTarget || "").trim();
    if (!rawStr || /^(?:https?:|data:|mailto:|#)/i.test(rawStr)) return;
    const ref = splitClientFileRefAndAnchor(rawStr);
    if (!ref.cleanPath || !CLIENT_RASTER_IMAGE_EXT_RE.test(ref.cleanPath)) return;
    if (!/^file:/i.test(rawStr) && !isLocalFileSystemPath(ref.cleanPath) && !isPreviewableRelativePath(ref.cleanPath)) {
      return;
    }
    if (inlineImgPaths.has(ref.cleanPath) || seen.has(ref.cleanPath)) return;
    seen.add(ref.cleanPath);
    found.push(ref.cleanPath);
  };

  const linkRe = /(?<!!)\[[^\]\n]+\]\(\s*(?:<([^>\n]+)>|((?:\([^()\s]*\)|[^()\n])+?))(?:\s+"[^"\n]*")?\s*\)/g;
  while ((m = linkRe.exec(withoutCodeBlocks)) !== null) {
    pushIfRaster(m[1] || m[2] || "");
  }

  const codeRe = /`([^`\n]{4,360})`/g;
  while ((m = codeRe.exec(withoutCodeBlocks)) !== null) {
    const codeRef = parsePreviewableCodePath(m[1] || "");
    if (codeRef) pushIfRaster(codeRef.cleanPath);
  }
  return found;
}

function shortModelName(rawModel = "") {
  const clean = String(rawModel || "").trim();
  if (!clean) return "";
  const lower = clean.toLowerCase();
  const effortSuffix = /\bxhigh\b/i.test(clean)
    ? " XH"
    : (/\bhigh\b/i.test(clean) ? " H" : (/\blow\b/i.test(clean) ? " L" : ""));
  const orchMatch = clean.match(/^orchestrator\s*\(([^)]+)\)/i);
  if (orchMatch?.[1]) {
    const inner = orchMatch[1].trim();
    return inner.length > 20 ? inner.slice(0, 20) : inner;
  }
  const orchIdMatch = clean.match(/^gemini[- ]pro[- ]orchestrator(?:[- ]([a-z][a-z0-9]+))?(?:[- (]+(?:low|medium|high|xhigh)\)?)?$/i);
  if (orchIdMatch || lower === "orchestrator") {
    const rawCodename = orchIdMatch?.[1] && !/^(?:low|medium|high|xhigh)$/i.test(orchIdMatch[1])
      ? orchIdMatch[1]
      : "Carbon";
    const word = rawCodename.charAt(0).toUpperCase() + rawCodename.slice(1).toLowerCase();
    return `${word}${effortSuffix}`;
  }
  const geminiWorker = clean.match(/^gemini[- ](flash|pro|lite|ultra|nano)[- ]worker(?:[- ](?:agy|[a-z0-9]+))?(?:[- (]+(?:low|medium|high|xhigh)\)?)?$/i);
  if (geminiWorker) {
    const tier = geminiWorker[1].charAt(0).toUpperCase() + geminiWorker[1].slice(1).toLowerCase();
    return `${tier} Worker${effortSuffix}`;
  }
  const geminiCodename = clean.match(/^gemini[- ]\d+(?:[.-]\d+)*[- ]([a-z][a-z0-9]+)(?:[- (]+(?:low|medium|high|xhigh)\)?)?$/i);
  if (geminiCodename?.[1] && !/^(?:pro|flash|lite|ultra|nano|exp|preview)$/i.test(geminiCodename[1])) {
    const word = geminiCodename[1].charAt(0).toUpperCase() + geminiCodename[1].slice(1).toLowerCase();
    return `${word}${effortSuffix}`;
  }
  const geminiVersioned = clean.match(/^gemini[- ](\d+(?:[.-]\d+)*)[- ](pro|flash|lite|ultra|nano)(?:[- ](lite|exp|preview))?(?:[- (]+(?:low|medium|high|xhigh)\)?)?$/i);
  if (geminiVersioned) {
    const ver = geminiVersioned[1].replace(/-/g, ".");
    const tier = geminiVersioned[2].charAt(0).toUpperCase() + geminiVersioned[2].slice(1).toLowerCase();
    const sub = geminiVersioned[3] ? ` ${geminiVersioned[3].charAt(0).toUpperCase() + geminiVersioned[3].slice(1).toLowerCase()}` : "";
    return `${ver} ${tier}${sub}${effortSuffix}`;
  }
  if (lower.includes("carbon")) {
    if (lower.includes("high")) return "Carbon H";
    if (lower.includes("medium")) return "Carbon M";
    return "Carbon";
  }
  if (lower.includes("argon")) {
    return "Argon";
  }
  if (lower.includes("hydrogen")) {
    if (lower.includes("xhigh")) return "Hydrogen XH";
    if (lower.includes("high")) return "Hydrogen H";
    if (lower.includes("low")) return "Hydrogen L";
    return "Hydrogen";
  }
  if (lower.startsWith("gemini-")) {
    const cleaned = clean
      .replace(/^gemini-/i, "Gemini ")
      .replace(/-\d{8,}$/, "")
      .replace(/-/g, " ")
      .replace(/\bpro\b/gi, "Pro")
      .replace(/\bflash\b/gi, "Flash")
      .replace(/\blite\b/gi, "Lite")
      .trim();
    return cleaned.length > 22 ? cleaned.slice(0, 22) : cleaned;
  }
  if (lower.includes("opus")) {
    const ver = clean.match(/(\d+(?:[.-]\d+)?)/);
    return ver ? `Opus ${ver[1].replace(/-/g, ".")}` : "Opus";
  }
  if (lower.includes("sonnet")) {
    const ver = clean.match(/(\d+(?:[.-]\d+)?)/);
    return ver ? `Sonnet ${ver[1].replace(/-/g, ".")}` : "Sonnet";
  }
  if (lower.includes("fable")) {
    const ver = clean.match(/(\d+(?:[.-]\d+)?)/);
    return ver ? `Fable ${ver[1].replace(/-/g, ".")}` : "Fable";
  }
  if (lower.includes("haiku")) {
    const ver = clean.match(/(\d+(?:[.-]\d+)?)/);
    return ver ? `Haiku ${ver[1].replace(/-/g, ".")}` : "Haiku";
  }
  if (clean === "gpt-5.3-codex" || /5\.3.*codex/i.test(clean)) {
    return "5.3 Codex";
  }
  const gptOss = clean.match(/^gpt[- ]oss(?:[\s-]+(\d+[a-z]*))?(?:[- (]+(?:low|medium|high|xhigh)\)?)?$/i);
  if (gptOss) {
    const size = gptOss[1] ? ` ${gptOss[1].toUpperCase()}` : "";
    return `GPT-OSS${size}${effortSuffix}`;
  }
  if (lower.includes("gpt-")) {
    const baseGpt = clean
      .replace(/^.*?(gpt-[0-9a-z.-]+).*$/i, "$1")
      .replace(/-(?:low|medium|high|xhigh)$/i, "")
      .toUpperCase();
    const withEffort = `${baseGpt}${effortSuffix}`;
    return withEffort.length > 20 ? withEffort.slice(0, 20) : withEffort;
  }
  if (lower.startsWith("grok-")) {
    if (lower.includes("4.7-build-fast") || lower.includes("4.7 fast")) return "Grok 4.7F";
    const ver = clean.match(/grok-(\d+(?:[.-]\d+)?)/i);
    return ver ? `Grok ${ver[1].replace(/-/g, ".")}` : clean.slice(0, 14);
  }
  const stripped = clean
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/^(Claude|Gemini)\s+/i, "")
    .trim();
  return stripped.length > 20 ? stripped.slice(0, 20) : stripped;
}

function shortEffortLabel(effort = "") {
  const clean = String(effort || "").trim().toLowerCase();
  return ({ low: "L", medium: "M", high: "H", xhigh: "XH", max: "MAX" })[clean] || "";
}

export function formatTurnModelBadge(turnOrModel, fallbackModel = "", fallbackEffort = "") {
  let rawModels = [];
  let rawEffort = "";
  if (turnOrModel && typeof turnOrModel === "object") {
    const list = Array.isArray(turnOrModel.models)
      ? turnOrModel.models.map((m) => String(m || "").trim()).filter(Boolean)
      : [];
    const single = String(turnOrModel.model || "").trim();
    if (list.length) {
      rawModels = list;
      rawEffort = String(turnOrModel.effort || turnOrModel.reasoningEffort || "").trim();
    } else if (single) {
      rawModels = [single];
      rawEffort = String(turnOrModel.effort || turnOrModel.reasoningEffort || "").trim();
    } else if (String(fallbackModel || "").trim()) {
      rawModels = [String(fallbackModel).trim()];
      rawEffort = String(turnOrModel.effort || turnOrModel.reasoningEffort || fallbackEffort || "").trim();
    }
  } else if (typeof turnOrModel === "string" && turnOrModel.trim()) {
    rawModels = [turnOrModel.trim()];
    rawEffort = String(fallbackEffort || "").trim();
  } else if (String(fallbackModel || "").trim()) {
    rawModels = [String(fallbackModel).trim()];
    rawEffort = String(fallbackEffort || "").trim();
  }

  const shortNames = [];
  const rawNames = [];
  for (const raw of rawModels) {
    const short = shortModelName(raw);
    if (!short) continue;
    if (!shortNames.includes(short)) {
      shortNames.push(short);
    }
    if (!rawNames.includes(raw)) {
      rawNames.push(raw);
    }
  }
  if (!shortNames.length) return null;

  const baseLabel = shortNames.length === 1
    ? shortNames[0]
    : `${shortNames[0]} → ${shortNames[shortNames.length - 1]}`;
  const effShort = shortEffortLabel(rawEffort);
  const alreadyHasEffort = effShort && new RegExp(`\\b${effShort}$`).test(baseLabel);
  const label = effShort && !alreadyHasEffort ? `${baseLabel} · ${effShort}` : baseLabel;
  const title = `${rawNames.join(" → ")}${rawEffort ? ` (${rawEffort})` : ""}`;
  return { label, title };
}

function renderAgentMessageItem(item, agentLabel, { forcePrimary = false, threadId = "", modelBadge = null, deferImages = false, forkTurnIndex = -1, forkTurnId = "", timestamp = null } = {}) {
  const rawText = String(item.text || "");
  const parsedHb = item.heartbeat || parseClientHeartbeatAgentReply(rawText, { allowIncomplete: false });
  const text = item.heartbeat
    ? rawText
    : (parsedHb ? [parsedHb.extraText, parsedHb.message].filter(Boolean).join("\n\n") : rawText);
  const goalComplete = text.includes("<!-- GOAL_COMPLETE -->");
  const isCommentary = !forcePrimary && item.phase === "commentary";
  const outputImagePaths = (!isCommentary && threadId) ? extractAgentOutputImagePaths(text, 6) : [];
  let deferredOutputCount = 0;
  const outputThumbsInner = outputImagePaths.map((imgPath) => {
    const label = clientPathBasename(imgPath) || "图片";
    const urls = buildThreadImageUrls(threadId, imgPath);
    if (isThreadImageFailed(urls.thumbSrc)) {
      return `<div class="msg-file-chip" title="${escapeHtml(imgPath)}">${iconSvg("image", { size: 12 })}<span>${escapeHtml(label)}</span></div>`;
    }
    if (deferImages) deferredOutputCount += 1;
    const btnTitle = deferImages ? `点击加载预览图：${imgPath}` : `点击放大预览：${imgPath}`;
    return `
            <div class="msg-image-card${deferImages ? " is-deferred" : ""}">
              <button type="button" class="msg-image-btn" data-preview-src="${escapeHtml(urls.previewSrc)}" data-preview-raw="${escapeHtml(urls.rawSrc)}" data-preview-caption="${escapeHtml(imgPath)}" title="${escapeHtml(btnTitle)}">
                <span class="msg-image-deferred-lead" aria-hidden="true">${iconSvg("image", { size: 13 })}</span>
                ${renderDeferredOrEagerImageHtml({ className: "msg-image", src: urls.thumbSrc, alt: label, deferImages })}
                <span class="msg-image-caption">${escapeHtml(label)}</span>
              </button>
              <div class="msg-file-chip is-fallback" hidden title="${escapeHtml(imgPath)}">${iconSvg("image", { size: 12 })}<span>${escapeHtml(label)}</span></div>
            </div>
          `;
  }).join("");
  const revealOutputBtnHtml = deferredOutputCount > 0 ? renderRevealThreadImagesButtonHtml() : "";
  const outputThumbsHtml = outputImagePaths.length
    ? `
      <div class="msg-images agent-output-images">
        ${outputThumbsInner}
        ${revealOutputBtnHtml}
      </div>
    `
    : "";
  const hbTagHtml = parsedHb
    ? (parsedHb.notify
      ? `<span class="heartbeat-notify-tag">${iconSvg("bell", { size: 11 })} 巡检通知</span>`
      : `<span class="phase-tag">巡检结果</span>`)
    : "";
  const agentTimeHtml = renderMessageTimeTag(item?.completedAt || item?.timestamp || item?.createdAt || timestamp);
  return `
    <div class="msg-row msg-agent ${isCommentary ? "is-commentary" : ""}">
      <div class="msg-meta">
        <span class="msg-role">${escapeHtml(agentLabel)}</span>
        ${modelBadge?.label ? `<span class="turn-model-tag" title="${escapeHtml(modelBadge.title || modelBadge.label)}">${escapeHtml(modelBadge.label)}</span>` : ""}
        ${hbTagHtml}
        ${isCommentary ? `<span class="phase-tag">过程汇报</span>` : ""}
        ${goalComplete ? `<span class="goal-done-tag">目标已达成</span>` : ""}
        ${agentTimeHtml}
        ${renderMessageCopyButton(text, { forkTurnIndex, forkTurnId, allowPinPlan: true })}
      </div>
      <div class="msg-bubble agent-bubble md-body">
        ${renderMarkdown(text, { threadId, deferImages })}
        ${outputThumbsHtml}
      </div>
    </div>
  `;
}

export function summarizeProcessItems(processItems = [], { isRunning = false } = {}) {
  const digest = collectProcessDigest(processItems);
  const {
    editedNames,
    readNames,
    readCount,
    searchCount,
    commandMap,
    cmdTotalCount,
    otherTools,
    notes,
    reasoningBlocks,
  } = digest;

  const segments = [];
  if (editedNames.length > 0) {
    if (editedNames.length <= 2) {
      segments.push(`改动 ${editedNames.join("、")}`);
    } else {
      segments.push(`改动 ${editedNames.slice(0, 2).join("、")} 等 ${editedNames.length} 个文件`);
    }
  } else if (readCount > 0) {
    if (readNames.length > 0) {
      segments.push(`查阅 ${readNames.slice(0, 2).join("、")}${readNames.length > 2 ? ` 等 ${readNames.length} 个文件` : ""}`);
    } else {
      segments.push(`查阅 ${readCount} 处`);
    }
  } else if (searchCount > 0) {
    segments.push(`检索 ${searchCount} 次`);
  }

  if (cmdTotalCount > 0) {
    const firstCmd = commandMap.keys().next().value || "";
    if (cmdTotalCount === 1 && editedNames.length === 0 && firstCmd && firstCmd.length <= 28) {
      segments.push(`运行 ${firstCmd}`);
    } else {
      segments.push(`命令 ${cmdTotalCount} 次`);
    }
  }

  if (otherTools.length > 0 && segments.length < 2) {
    segments.push(`调用 ${otherTools.length} 个工具`);
  }

  if (!segments.length && (reasoningBlocks.length > 0 || notes.length > 0)) {
    segments.push("思考与分析");
  }

  const prefix = isRunning ? "执行过程" : "已执行";
  return segments.length ? `${prefix} · ${segments.join(" · ")}` : prefix;
}

function buildLiveStepStream(processItems) {
  const steps = [];
  const pushMergedRead = ({ kind, name, status, sourceIdx }) => {
    const prev = steps[steps.length - 1];
    if (prev && prev.groupKey === kind) {
      prev.count += 1;
      if (name && !prev.names.includes(name)) prev.names.push(name);
      prev.status = mergeProcessStatus(prev.status, status);
      prev.lastIdx = sourceIdx;
      return;
    }
    steps.push({
      groupKey: kind,
      kind,
      names: name ? [name] : [],
      count: 1,
      status: status || "completed",
      isCode: false,
      output: "",
      firstIdx: sourceIdx,
      lastIdx: sourceIdx,
    });
  };

  const items = Array.isArray(processItems) ? processItems : [];
  for (let idx = 0; idx < items.length; idx += 1) {
    const item = items[idx];
    if (!item || typeof item !== "object" || item.type === "reasoning") continue;
    if (item.type === "agentMessage") {
      const compactText = String(item.text || "").replace(/\s+/g, " ").trim();
      if (!compactText) continue;
      steps.push({
        kind: "进展",
        label: compactText.length > 200 ? `${compactText.slice(0, 200).trim()}…` : compactText,
        status: "",
        isCode: false,
        output: "",
        firstIdx: idx,
        lastIdx: idx,
      });
    } else if (item.type === "fileChange") {
      const firstPath = item.changes?.[0]?.path || "";
      steps.push({
        kind: "改动",
        label: formatCompactPath(firstPath) || "文件改动",
        status: item.status || "completed",
        isCode: true,
        output: "",
        firstIdx: idx,
        lastIdx: idx,
      });
    } else if (item.type === "commandExecution") {
      const cmd = unwrapToolText(item.command || "") || "命令";
      steps.push({
        kind: "命令",
        label: cmd.length > 90 ? `${cmd.slice(0, 90).trim()}…` : cmd,
        status: item.status || "completed",
        isCode: true,
        output: String(item.aggregatedOutput || "").trim(),
        firstIdx: idx,
        lastIdx: idx,
      });
    } else if (item.type === "mcpToolCall") {
      const tool = String(item.tool || "");
      const args = item.arguments && typeof item.arguments === "object" ? item.arguments : {};
      const rawPath = args.Path || args.path || args.TargetFile || args.AbsolutePath || args.DirectoryPath || args.File || args.file_path || "";
      if (READ_TOOL_RE.test(tool)) {
        pushMergedRead({
          kind: "查阅",
          name: shortPathLabel(rawPath) || "文件",
          status: item.status || "completed",
          sourceIdx: idx,
        });
      } else if (SEARCH_TOOL_RE.test(tool)) {
        pushMergedRead({
          kind: "检索",
          name: unwrapToolText(args.Query || args.query || args.Pattern || "") || shortPathLabel(rawPath) || "代码",
          status: item.status || "completed",
          sourceIdx: idx,
        });
      } else if (EDIT_TOOL_RE.test(tool)) {
        steps.push({
          kind: "改动",
          label: formatCompactPath(rawPath) || "文件改动",
          status: item.status || "completed",
          isCode: true,
          output: "",
          firstIdx: idx,
          lastIdx: idx,
        });
      } else if (CMD_TOOL_RE.test(tool)) {
        const cmd = unwrapToolText(args.toolSummary || args.CommandLine || args.command || "") || tool;
        steps.push({
          kind: "命令",
          label: cmd.length > 90 ? `${cmd.slice(0, 90).trim()}…` : cmd,
          status: item.status || "completed",
          isCode: true,
          output: "",
          firstIdx: idx,
          lastIdx: idx,
        });
      } else {
        const sleepInfo = describeSleepToolCall(item);
        const label = sleepInfo ? sleepInfo.label : (unwrapToolText(args.toolSummary || "") || tool || "工具调用");
        steps.push({
          kind: sleepInfo ? sleepInfo.kind : "工具",
          label: label.slice(0, 80),
          status: item.status || "completed",
          isCode: true,
          isSleep: Boolean(sleepInfo),
          output: sleepInfo ? sleepInfo.output : "",
          firstIdx: idx,
          lastIdx: idx,
        });
      }
    }
  }

  return steps.map((step) => {
    if (!step.groupKey) return step;
    const head = step.names.slice(0, 2).join("、");
    let label = head || step.kind;
    if (step.count > 1) {
      label = head ? `${head} 等 ${step.count} 项` : `${step.kind} ${step.count} 次`;
    }
    return { ...step, label };
  });
}

function renderLiveProgressFeedHtml(processItems, digest, { liveThought = "", livePhase = "" } = {}) {
  const recentSteps = buildLiveStepStream(processItems).slice(-5);
  const items = Array.isArray(processItems) ? processItems : [];
  let lastReasoningIdx = -1;
  let lastPersistedThought = "";
  for (let idx = items.length - 1; idx >= 0; idx -= 1) {
    const t = extractReasoningText(items[idx]);
    if (t) {
      lastReasoningIdx = idx;
      lastPersistedThought = t;
      break;
    }
  }
  if (!lastPersistedThought && digest?.reasoningBlocks?.length) {
    lastPersistedThought = String(digest.reasoningBlocks[digest.reasoningBlocks.length - 1] || "");
    lastReasoningIdx = Math.max(0, items.length - 1);
  }

  const cleanLiveThought = String(liveThought || "").replace(/\s+/g, " ").trim();
  const cleanPersistedThought = String(lastPersistedThought || "").replace(/\s+/g, " ").trim();
  const activeThoughtSource = cleanLiveThought || cleanPersistedThought;
  const thoughtTail = activeThoughtSource.length > 180 ? `…${activeThoughtSource.slice(-180).trim()}` : activeThoughtSource;
  const lastStepIdx = recentSteps.length ? Number(recentSteps[recentSteps.length - 1].lastIdx ?? -1) : -1;
  const thoughtIsBottomFrontier = Boolean(thoughtTail) && (
    Boolean(cleanLiveThought) || lastReasoningIdx > lastStepIdx
  );
  const lastStepInProgress = !thoughtIsBottomFrontier
    && recentSteps.length > 0
    && (recentSteps[recentSteps.length - 1].status === "inProgress" || recentSteps[recentSteps.length - 1].status === "running");
  const cleanPhase = String(livePhase || "").trim();

  if (!recentSteps.length && !thoughtTail && !cleanPhase) return "";

  let lastCmdWithOutIdx = -1;
  for (let i = recentSteps.length - 1; i >= 0; i -= 1) {
    if (recentSteps[i].kind === "命令" && recentSteps[i].output) {
      lastCmdWithOutIdx = i;
      break;
    }
  }

  const thoughtHtml = thoughtTail
    ? (thoughtIsBottomFrontier
      ? `
      <div class="live-thought-preview" data-live-frontier="1">
        <span class="live-frontier-dot" aria-hidden="true"></span>
        <span class="tool-kind">思考中</span>
        <span class="live-thought-text">${escapeHtml(thoughtTail)}</span>
      </div>
    `
      : `
      <div class="live-thought-preview">
        <span class="tool-kind">思考</span>
        <span class="live-thought-text">${escapeHtml(thoughtTail)}</span>
      </div>
    `)
    : "";

  const feedRows = [];
  let thoughtInserted = false;
  let thoughtSlotIdx = -1;
  if (thoughtHtml && !thoughtIsBottomFrontier) {
    thoughtSlotIdx = recentSteps.findIndex((step) => Number(step.lastIdx ?? -1) > lastReasoningIdx);
    if (thoughtSlotIdx === -1) thoughtSlotIdx = 0;
  }

  for (let idx = 0; idx < recentSteps.length; idx += 1) {
    if (thoughtHtml && !thoughtIsBottomFrontier && !thoughtInserted && idx === thoughtSlotIdx) {
      feedRows.push(thoughtHtml);
      thoughtInserted = true;
    }
    const step = recentSteps[idx];
    const isFrontierStep = idx === recentSteps.length - 1 && lastStepInProgress;
    let stepLabel = step.label;
    if (isFrontierStep && step.isSleep && cleanPhase) {
      const waitMatch = cleanPhase.match(/已等待\s*[^·\n]+/);
      if (waitMatch && !stepLabel.includes("已等待")) {
        stepLabel = `${stepLabel}（${waitMatch[0].trim()}）`;
      }
    }
    const labelHtml = step.isCode
      ? `<code class="tool-title">${escapeHtml(stepLabel)}</code>`
      : `<span class="process-note-text">${escapeHtml(stepLabel)}</span>`;
    const pill = step.status ? statusPillHtml(step.status) : "";
    let cmdSnippetHtml = "";
    if (idx === lastCmdWithOutIdx && step.output) {
      const tailLines = step.output
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .slice(-3)
        .join("\n")
        .slice(-240);
      if (tailLines) {
        const outputLabel = tailLines === step.output.trim() ? "命令输出" : "输出末尾预览";
        cmdSnippetHtml = `<div class="live-cmd-output">
          <details class="live-cmd-output-details">
            <summary>${outputLabel} · 展开查看</summary>
            <pre class="tool-output">${escapeHtml(step.output)}</pre>
          </details>
          <pre class="live-cmd-snippet">${escapeHtml(tailLines)}</pre>
        </div>`;
      }
    }
    feedRows.push(`
      <div class="live-progress-row${isFrontierStep ? " is-active-frontier" : ""}">
        <div class="live-progress-main">
          ${isFrontierStep ? `<span class="live-frontier-dot" aria-hidden="true"></span>` : ""}
          <span class="tool-kind">${escapeHtml(step.kind)}</span>
          ${labelHtml}
          ${pill}
        </div>
        ${cmdSnippetHtml}
      </div>
    `);
  }

  if (thoughtHtml && thoughtIsBottomFrontier) {
    feedRows.push(thoughtHtml);
  } else if (!lastStepInProgress) {
    feedRows.push(`
      <div class="live-frontier-status" data-live-frontier="1">
        <span class="live-frontier-dot" aria-hidden="true"></span>
        <span class="live-frontier-text">${escapeHtml(cleanPhase || "正在继续执行…")}</span>
      </div>
    `);
  }

  return `
    <div class="live-progress-feed" aria-live="polite">
      ${feedRows.join("")}
    </div>
  `;
}

function renderProcessGroupHtml(processItems, { isRunning = false, liveThought = "", livePhase = "", extraReasoning = "", threadId = "", modelBadge = null } = {}) {
  const safeItems = Array.isArray(processItems) ? processItems : [];
  const cleanExtraThought = String(liveThought || extraReasoning || "").trim();
  const cleanPhase = String(livePhase || "").trim();
  if (!safeItems.length && !cleanExtraThought && !(isRunning && cleanPhase)) return "";
  const summaryLabel = safeItems.length
    ? summarizeProcessItems(safeItems, { isRunning })
    : (cleanExtraThought
      ? (isRunning ? "执行过程 · 思考与分析" : "已执行 · 思考与分析")
      : (cleanPhase || "正在启动任务…"));
  const digest = collectProcessDigest(safeItems);
  const rows = [];

  for (const entry of digest.editMap.values()) {
    const countTag = entry.count > 1 ? `<span class="process-count-tag">${entry.count} 处</span>` : "";
    const fileAttr = (threadId && entry.rawPath)
      ? ` data-local-file-path="${escapeHtml(splitClientFileRefAndAnchor(entry.rawPath).cleanPath)}" title="点击查看：${escapeHtml(entry.rawPath)}"`
      : "";
    const titleClass = fileAttr ? "tool-title md-code-file" : "tool-title";
    if (entry.status === "failed" && entry.errorMessage) {
      if (entry.recoverable) {
        rows.push(`
          <div class="process-step-row is-soft-warn">
            <span class="tool-kind">单步提示</span>
            <span class="process-note-text">${escapeHtml(entry.errorMessage)}（已交回模型继续处理）</span>
          </div>
        `);
      } else {
        rows.push(`
          <details class="process-subdetail">
            <summary>
              <span class="tool-kind">改动</span>
              <code class="${titleClass}"${fileAttr}>${escapeHtml(entry.compactPath)}</code>
              ${countTag}
              ${statusPillHtml(entry.status)}
            </summary>
            <div class="tool-body">
              <pre class="tool-output">${escapeHtml(entry.errorMessage.slice(0, 400))}</pre>
            </div>
          </details>
        `);
      }
    } else {
      rows.push(`
        <div class="process-step-row">
          <span class="tool-kind">改动</span>
          <code class="${titleClass}"${fileAttr}>${escapeHtml(entry.compactPath)}</code>
          ${countTag}
          ${statusPillHtml(entry.status)}
        </div>
      `);
    }
  }

  if (digest.readCount > 0 || digest.searchCount > 0) {
    const totalReadAndSearch = digest.readCount + digest.searchCount;
    let readSummary = "";
    if (digest.readNames.length > 0) {
      const head = digest.readNames.slice(0, 3).join("、");
      const totalDistinct = Math.max(digest.readNames.length, totalReadAndSearch);
      readSummary = digest.readNames.length > 3 || totalReadAndSearch > digest.readNames.length
        ? `${head} 等 ${totalDistinct} 项`
        : head;
    } else if (digest.readCount > 0 && digest.searchCount > 0) {
      readSummary = `查阅 ${digest.readCount} 处 · 检索 ${digest.searchCount} 次`;
    } else if (digest.readCount > 0) {
      readSummary = `查阅 ${digest.readCount} 处`;
    } else {
      readSummary = `检索 ${digest.searchCount} 次`;
    }
    rows.push(`
      <div class="process-step-row">
        <span class="tool-kind">查阅</span>
        <span class="process-note-text">${escapeHtml(readSummary)}</span>
      </div>
    `);
  }

  for (const readErr of digest.readErrors) {
    rows.push(`
      <div class="process-step-row is-soft-warn">
        <span class="tool-kind">单步提示</span>
        <span class="process-note-text">${escapeHtml(readErr.message)}（已交回模型继续处理）</span>
      </div>
    `);
  }

  for (const cmd of digest.commandMap.values()) {
    const countTag = cmd.count > 1 ? `<span class="process-count-tag">${cmd.count} 次</span>` : "";
    const commandOut = String(cmd.output || "").trim();
    const shouldExpand = cmd.status === "failed" || Boolean(commandOut);
    if (shouldExpand) {
      rows.push(`
        <details class="process-subdetail">
          <summary>
            <span class="tool-kind">命令</span>
            <code class="tool-title">${escapeHtml(cmd.command)}</code>
            ${countTag}
            ${statusPillHtml(cmd.status)}
          </summary>
          <div class="tool-body">
            <pre class="tool-output">${escapeHtml(commandOut || cmd.errorMessage || "命令执行异常")}</pre>
          </div>
        </details>
      `);
    } else {
      rows.push(`
        <div class="process-step-row">
          <span class="tool-kind">命令</span>
          <code class="tool-title">${escapeHtml(cmd.command)}</code>
          ${countTag}
          ${statusPillHtml(cmd.status)}
        </div>
      `);
    }
  }

  for (const toolItem of digest.otherTools) {
    const kindLabel = toolItem.kind || "工具";
    const toolOut = String(toolItem.output || "").trim();
    if (toolItem.errorMessage) {
      if (toolItem.recoverable) {
        rows.push(`
          <div class="process-step-row is-soft-warn">
            <span class="tool-kind">单步提示</span>
            <span class="process-note-text">${escapeHtml(toolItem.errorMessage)}（已交回模型继续处理）</span>
          </div>
        `);
      } else {
        rows.push(`
          <details class="process-subdetail">
            <summary>
              <span class="tool-kind">${escapeHtml(kindLabel)}</span>
              <code class="tool-title">${escapeHtml(toolItem.label)}</code>
              ${statusPillHtml(toolItem.status)}
            </summary>
            <div class="tool-body">
              <pre class="tool-output">${escapeHtml(toolItem.errorMessage.slice(0, 400))}</pre>
            </div>
          </details>
        `);
      }
    } else if (toolOut) {
      rows.push(`
        <details class="process-subdetail">
          <summary>
            <span class="tool-kind">${escapeHtml(kindLabel)}</span>
            <code class="tool-title">${escapeHtml(toolItem.label)}</code>
            ${statusPillHtml(toolItem.status)}
          </summary>
          <div class="tool-body">
            <pre class="tool-output">${escapeHtml(toolOut.slice(0, 400))}</pre>
          </div>
        </details>
      `);
    } else {
      rows.push(`
        <div class="process-step-row">
          <span class="tool-kind">${escapeHtml(kindLabel)}</span>
          <code class="tool-title">${escapeHtml(toolItem.label)}</code>
          ${statusPillHtml(toolItem.status)}
        </div>
      `);
    }
  }

  for (const note of digest.notes) {
    rows.push(`
      <div class="process-step-row is-note">
        <span class="tool-kind">说明</span>
        <span class="process-note-text">${escapeHtml(note.slice(0, 180))}${note.length > 180 ? "…" : ""}</span>
      </div>
    `);
  }

  const allReasoningBlocks = [...digest.reasoningBlocks];
  if (cleanExtraThought) {
    const prevClean = String(allReasoningBlocks[allReasoningBlocks.length - 1] || "").replace(/\s+/g, " ").trim();
    const nextClean = cleanExtraThought.replace(/\s+/g, " ").trim();
    const tail = nextClean.slice(-60);
    const isDuplicate = prevClean && (prevClean === nextClean || (tail.length >= 16 && prevClean.includes(tail)));
    if (!isDuplicate) allReasoningBlocks.push(cleanExtraThought);
  }

  if (allReasoningBlocks.length) {
    const totalCount = allReasoningBlocks.length;
    const clippedReasoning = allReasoningBlocks.slice(-3).join("\n\n").slice(-2400);
    rows.push(`
      <details class="process-subdetail">
        <summary>
          <span class="tool-kind">内部推理记录（共 ${totalCount} 段，按需展开）</span>
        </summary>
        <div class="tool-body"><pre class="tool-output">${escapeHtml(clippedReasoning)}</pre></div>
      </details>
    `);
  }

  if (!rows.length) {
    if (isRunning && cleanPhase) {
      const liveOnlyFeedHtml = renderLiveProgressFeedHtml(safeItems, digest, { liveThought, livePhase });
      if (!liveOnlyFeedHtml) return "";
      return `
        <div class="process-card is-live">
          ${liveOnlyFeedHtml}
        </div>
      `;
    }
    return "";
  }
  const liveFeedHtml = isRunning
    ? renderLiveProgressFeedHtml(safeItems, digest, { liveThought, livePhase })
    : "";
  return `
    <div class="process-card${isRunning ? " is-live" : ""}">
      <details class="process-summary-box${isRunning ? " is-live" : ""}">
        <summary>
          <span class="process-summary-dot"></span>
          <span class="process-summary-text">${escapeHtml(summaryLabel)}</span>
          ${modelBadge?.label ? `<span class="process-model-pill" title="${escapeHtml(modelBadge.title || modelBadge.label)}">${escapeHtml(modelBadge.label)}</span>` : ""}
          <span class="process-summary-hint">展开明细</span>
        </summary>
        <div class="process-summary-body">
          ${rows.join("")}
        </div>
      </details>
      ${liveFeedHtml}
    </div>
  `;
}

function itemFilePathClient(item) {
  if (!item || typeof item !== "object") return "";
  if (item.type === "fileChange") {
    return String(item.changes?.[0]?.path || "");
  }
  const args = item.arguments && typeof item.arguments === "object" ? item.arguments : {};
  return String(
    args.Path
    || args.path
    || args.TargetFile
    || args.AbsolutePath
    || args.DirectoryPath
    || args.File
    || args.file_path
    || "",
  );
}

function findRecoverableTargetItemClient(items, rawErrText) {
  if (TARGET_NOT_FOUND_ERR_RE.test(rawErrText)) {
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const it = items[i];
      if (!it || it.error?.message) continue;
      if (it.type === "fileChange" || (it.type === "mcpToolCall" && EDIT_TOOL_RE.test(String(it.tool || "")))) {
        return it;
      }
    }
  }

  const batches = [];
  let currentBatch = null;
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    if (it.type === "mcpToolCall" || it.type === "fileChange" || it.type === "commandExecution") {
      const idMatch = String(it.id || "").match(/^agy-(\d+)-tool-(\d+)$/);
      const batchKey = idMatch ? `step:${idMatch[1]}` : `seq:${batches.length}`;
      if (!currentBatch || (idMatch ? currentBatch.key !== batchKey : currentBatch.genAfter > 0)) {
        currentBatch = { key: batchKey, tools: [], genAfter: 0 };
        batches.push(currentBatch);
      }
      currentBatch.tools.push(it);
    } else if (it.type === "agentMessage" && String(it.id || "").startsWith("agy-gen-")) {
      if (currentBatch) currentBatch.genAfter += 1;
    } else if (it.type === "agentMessage" && it.phase !== "commentary") {
      currentBatch = null;
    }
  }

  const readBatches = batches.filter((b) => b.tools.some((it) => it.type === "mcpToolCall" && READ_TOOL_RE.test(String(it.tool || ""))));
  const incompleteReadBatch = [...readBatches].reverse().find((b) => b.genAfter < b.tools.length);
  const chosenBatch = incompleteReadBatch
    || readBatches[readBatches.length - 1]
    || [...batches].reverse().find((b) => b.genAfter < b.tools.length)
    || batches[batches.length - 1]
    || null;

  if (chosenBatch && chosenBatch.tools.length > 0) {
    const m = chosenBatch.genAfter;
    if (m < chosenBatch.tools.length) {
      const byIndex = chosenBatch.tools[m];
      if (!byIndex?.error?.message) return byIndex;
    }
    const readTools = chosenBatch.tools.filter((it) => it.type === "mcpToolCall" && READ_TOOL_RE.test(String(it.tool || "")));
    if (m < readTools.length && !readTools[m]?.error?.message) {
      return readTools[m];
    }
    const lastRead = [...readTools].reverse().find((it) => !it.error?.message) || readTools[readTools.length - 1];
    if (lastRead) return lastRead;
    return chosenBatch.tools[chosenBatch.tools.length - 1];
  }

  return [...items].reverse().find((it) => (
    it && (it.type === "mcpToolCall" || it.type === "fileChange" || it.type === "commandExecution") && !it.error?.message
  )) || null;
}

export function normalizeTurnForRender(turn) {
  if (!turn || typeof turn !== "object") return { items: [], status: "completed", error: null };
  const clonedItems = (Array.isArray(turn.items) ? turn.items : []).map((item) => {
    if (!item || typeof item !== "object") return item;
    if (item.error?.message) {
      const fp = itemFilePathClient(item);
      const formatted = formatToolExecutionError(item.error.message, {
        filePath: fp,
        toolName: item.tool || item.type || "",
      });
      return {
        ...item,
        error: {
          ...item.error,
          message: formatted,
          recoverable: Boolean(item.error.recoverable || isRecoverableToolErrorText(item.error.message)),
        },
      };
    }
    return { ...item };
  });

  const rawTurnErr = String(turn?.error?.message || "").trim();
  if (!rawTurnErr) {
    return {
      ...turn,
      items: clonedItems,
    };
  }

  if (isRecoverableToolErrorText(rawTurnErr)) {
    const targetItem = findRecoverableTargetItemClient(clonedItems, rawTurnErr);
    if (targetItem) {
      const fp = itemFilePathClient(targetItem);
      const friendly = formatToolExecutionError(rawTurnErr, {
        filePath: fp,
        toolName: targetItem.tool || targetItem.type || "",
      });
      targetItem.status = "failed";
      targetItem.error = { message: friendly, path: fp, recoverable: true };
    } else {
      clonedItems.push({
        type: "mcpToolCall",
        id: "agy-step-recovered-err",
        server: "antigravity",
        tool: "step_tool",
        arguments: {},
        status: "failed",
        result: null,
        error: { message: formatToolExecutionError(rawTurnErr), recoverable: true },
      });
    }
    return {
      ...turn,
      status: turn.status === "failed" ? "completed" : (turn.status || "completed"),
      error: null,
      items: clonedItems,
    };
  }

  const cleanFatal = stripStepEchoHeadersClient(rawTurnErr);
  return {
    ...turn,
    error: cleanFatal ? { ...turn.error, message: cleanFatal } : null,
    items: clonedItems,
  };
}

export function isSyntheticLiveReplyItem(item) {
  return Boolean(item?.type === "agentMessage" && /:(?:agent|live)$/.test(String(item.id || "")));
}

export function isStreamingTextAlreadyPersisted(turns = [], streamingText = "") {
  const norm = (s) => cleanStreamingAgentText(s).replace(/\s+/g, " ").trim();
  const cleanLive = norm(streamingText);
  if (!cleanLive) return false;
  const list = Array.isArray(turns) ? turns : [];
  const startIdx = Math.max(0, list.length - 4);
  for (let tIdx = list.length - 1; tIdx >= startIdx; tIdx -= 1) {
    const turn = list[tIdx];
    const items = Array.isArray(turn?.items) ? turn.items : [];
    for (const it of items) {
      if (!it || it.type !== "agentMessage" || isSyntheticLiveReplyItem(it)) continue;
      const persisted = norm(it.text);
      if (!persisted) continue;
      if (persisted === cleanLive) return true;
      if (tIdx < list.length - 1 && cleanLive.length >= 24 && persisted.includes(cleanLive)) {
        return true;
      }
    }
  }
  return false;
}

function classifyTurnItems(turn, { hideSyntheticLiveReply = false } = {}) {
  const normalizedTurn = normalizeTurnForRender(turn);
  const cleanItems = (Array.isArray(normalizedTurn?.items) ? normalizedTurn.items : [])
    .filter((item) => !isRawToolEchoItem(item) && !(hideSyntheticLiveReply && isSyntheticLiveReplyItem(item)));
  const primaryAgentIndexes = new Set();
  for (let i = 0; i < cleanItems.length; i += 1) {
    const item = cleanItems[i];
    if (item?.type === "agentMessage" && item.phase !== "commentary" && String(item.text || "").trim()) {
      primaryAgentIndexes.add(i);
    }
  }
  if (primaryAgentIndexes.size === 0) {
    for (let i = cleanItems.length - 1; i >= 0; i -= 1) {
      const item = cleanItems[i];
      if (item?.type === "agentMessage" && String(item.text || "").trim()) {
        primaryAgentIndexes.add(i);
        break;
      }
    }
  }
  return { normalizedTurn, cleanItems, primaryAgentIndexes };
}

function isTurnProcessItem(item) {
  if (!item || typeof item !== "object") return false;
  return (
    item.type === "reasoning"
    || item.type === "commandExecution"
    || item.type === "fileChange"
    || item.type === "mcpToolCall"
    || (item.type === "agentMessage" && String(item.text || "").trim())
  );
}

export function turnEndsWithProcessGroup(turn) {
  const { cleanItems, primaryAgentIndexes } = classifyTurnItems(turn);
  let endsWithProcess = false;
  for (let i = 0; i < cleanItems.length; i += 1) {
    const item = cleanItems[i];
    if (!item || typeof item !== "object") continue;
    if (item.type === "userMessage" || (item.type === "agentMessage" && primaryAgentIndexes.has(i))) {
      endsWithProcess = false;
    } else if (isTurnProcessItem(item)) {
      endsWithProcess = true;
    }
  }
  return endsWithProcess;
}

function detectQuietHeartbeatGroup(turn) {
  if (!turn || typeof turn !== "object") return null;
  if (turn.quietHeartbeatGroup) return turn.quietHeartbeatGroup;
  if (turn.status === "inProgress" || turn.status === "running") return null;
  if (turn.error?.message) return null;
  const items = Array.isArray(turn.items) ? turn.items : [];
  if (!items.length) return null;

  let userHb = null;
  let agentHb = null;
  let hasNormalUser = false;
  let hasFileChange = false;

  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "fileChange") {
      hasFileChange = true;
    } else if (item.type === "userMessage") {
      const parsed = parseUserMessageContent(item);
      if (parsed.heartbeat) userHb = parsed.heartbeat;
      if (parsed.images.length || parsed.files.length || parsed.questionReplies.length || parsed.textParts.length) {
        hasNormalUser = true;
      }
    } else if (item.type === "agentMessage") {
      const hb = item.heartbeat || parseClientHeartbeatAgentReply(item.text || "", { allowIncomplete: false });
      if (hb || item.phase !== "commentary") {
        agentHb = hb ? { ...hb, cleanText: item.heartbeat ? item.text : hb.message } : null;
      }
    }
  }

  if (hasNormalUser || hasFileChange) return null;
  if (!userHb && !agentHb) return null;
  if (!agentHb || agentHb.notify) return null;

  return {
    count: 1,
    automationId: agentHb.automationId || userHb?.automationId || "",
    automationName: agentHb.automationName || userHb?.automationName || "",
    firstStartedAt: turn.startedAt || null,
    lastCompletedAt: turn.completedAt || turn.startedAt || null,
    currentTimeIso: userHb?.currentTimeIso || "",
    message: agentHb.message || agentHb.cleanText || "",
    instructions: userHb?.instructions || "",
  };
}

function renderQuietHeartbeatTurnHtml(turn, group, { threadId = "" } = {}) {
  const autoId = String(group.automationId || "").trim();
  const autoName = String(group.automationName || "").trim();
  const titleLabel = autoName || autoId || "定时巡检";
  const count = Math.max(1, Number(group.count) || 1);
  const latestMessage = String(group.message || "").trim();
  const timeLabel = formatHeartbeatTimeLabel(group.lastCompletedAt || group.currentTimeIso || turn.completedAt || turn.startedAt);
  const instructions = String(group.instructions || "").trim();
  return `
    <section class="turn-block is-quiet-heartbeat" data-turn-id="${escapeHtml(turn.id || "")}">
      <details class="heartbeat-quiet-card heartbeat-disclosure">
        <summary class="heartbeat-quiet-summary">
          <span class="heartbeat-badge">${iconSvg("clock", { size: 12 })}<span>定时巡检</span></span>
          <span class="heartbeat-title">${escapeHtml(titleLabel)}</span>
          ${count > 1 ? `<span class="heartbeat-count-pill">连续 ${count} 次无变更</span>` : ""}
          <span class="heartbeat-msg">${escapeHtml(latestMessage || "检查完成，无需通知")}</span>
          ${timeLabel ? `<span class="heartbeat-time">${escapeHtml(timeLabel)}</span>` : ""}
        </summary>
        <div class="heartbeat-quiet-body">
          ${latestMessage ? `<div class="heartbeat-body-msg md-body">${renderMarkdown(latestMessage, { threadId })}</div>` : ""}
          ${instructions ? `<div class="heartbeat-inst-label">巡检指令（${escapeHtml(autoId || "automation")}）</div><div class="heartbeat-inst-body md-body">${renderMarkdown(instructions, { threadId })}</div>` : ""}
        </div>
      </details>
    </section>
  `;
}

function extractAskQuestionList(item) {
  if (!item || item.type !== "mcpToolCall" || item.tool !== "ask_question") return [];
  if (Array.isArray(item.questions) && item.questions.length) return item.questions;
  let raw = item.arguments?.questions ?? item.arguments?.Questions;
  if (typeof raw === "string") {
    try { raw = JSON.parse(raw); } catch { return []; }
  }
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q, idx) => {
      if (!q || typeof q !== "object") return null;
      const question = String(q.question || q.prompt || "").trim();
      const options = (Array.isArray(q.options) ? q.options : [])
        .map((opt) => (typeof opt === "string"
          ? { label: opt.trim(), description: "" }
          : { label: String(opt?.label || opt?.name || opt?.value || "").trim(), description: String(opt?.description || "").trim() }))
        .filter((o) => o.label);
      if (!question && !options.length) return null;
      return {
        id: String(q.id || `q_${idx}`),
        header: String(q.header || `问题 ${idx + 1}`),
        question,
        multiSelect: Boolean(q.is_multi_select ?? q.multiSelect),
        options,
      };
    })
    .filter(Boolean);
}

function renderAskQuestionItemHtml(item, questions) {
  const answerText = String(item?.result?.content?.find((c) => c?.type === "text")?.text || "").trim();
  const blocks = questions.map((q, idx) => {
    const optsHtml = (q.options || []).map((opt, oIdx) => `
      <li class="agy-ask-opt"><span class="agy-ask-idx">${oIdx + 1}.</span><span>${escapeHtml(opt.label)}</span></li>
    `).join("");
    return `
      <div class="agy-ask-question">
        <div class="agy-ask-qtitle">${questions.length > 1 ? `${idx + 1}. ` : ""}${escapeHtml(q.question || q.header || "请确认")}</div>
        ${optsHtml ? `<ul class="agy-ask-opts">${optsHtml}</ul>` : ""}
      </div>
    `;
  }).join("");
  return `
    <div class="agy-ask-card">
      <div class="agy-ask-head">
        <span class="agy-ask-badge">提问确认</span>
        <span class="agy-ask-status">${answerText ? "已回答" : "等待下方卡片或消息回答"}</span>
      </div>
      ${blocks}
      ${answerText ? `<div class="agy-ask-answer">已选/回答：${escapeHtml(answerText)}</div>` : ""}
    </div>
  `;
}

export function renderTurnHtml(turn, {
  agentLabel = "Agent",
  threadId = "",
  turnIndex = -1,
  forceRunning = false,
  suppressRunning = false,
  liveThought = "",
  livePhase = "",
  trailingThought = "",
  hideSyntheticLiveReply = false,
  showIncompleteSummaryHint = false,
  supersededByNextTurn = false,
  hasExternalStreamingReply = false,
  fallbackModel = "",
  fallbackEffort = "",
  goalSuspended = false,
  deferImages = false,
} = {}) {
  const { normalizedTurn, cleanItems, primaryAgentIndexes } = classifyTurnItems(turn, { hideSyntheticLiveReply });
  const isRunning = suppressRunning
    ? false
    : Boolean(forceRunning || normalizedTurn?.status === "inProgress" || normalizedTurn?.status === "running");

  if (!isRunning) {
    const quietGroup = detectQuietHeartbeatGroup(normalizedTurn);
    if (quietGroup) {
      return renderQuietHeartbeatTurnHtml(normalizedTurn, quietGroup, { threadId });
    }
  }

  const modelBadge = formatTurnModelBadge(normalizedTurn, fallbackModel, fallbackEffort);
  let processBadgeShown = false;
  const takeProcessBadge = () => {
    if (processBadgeShown || !modelBadge) return null;
    processBadgeShown = true;
    return modelBadge;
  };

  const parts = [];
  let pendingProcessItems = [];
  let hasAskQuestion = false;
  const flushProcessGroup = (groupRunning = false, isFinalFlush = false) => {
    if (!pendingProcessItems.length) return;
    const html = renderProcessGroupHtml(pendingProcessItems, {
      isRunning: groupRunning,
      liveThought: groupRunning ? liveThought : "",
      livePhase: groupRunning ? livePhase : "",
      extraReasoning: (!groupRunning && isFinalFlush) ? trailingThought : "",
      threadId,
      modelBadge: takeProcessBadge(),
    });
    pendingProcessItems = [];
    if (html) parts.push(html);
  };

  const turnStartTime = normalizedTurn?.startedAt || normalizedTurn?.createdAt || null;
  const turnReplyTime = normalizedTurn?.completedAt || normalizedTurn?.startedAt || normalizedTurn?.createdAt || null;

  for (let i = 0; i < cleanItems.length; i += 1) {
    const item = cleanItems[i];
    if (!item || typeof item !== "object") continue;
    const askQuestions = extractAskQuestionList(item);
    if (askQuestions.length) {
      flushProcessGroup(false, false);
      hasAskQuestion = true;
      parts.push(renderAskQuestionItemHtml(item, askQuestions));
    } else if (item.type === "userMessage") {
      flushProcessGroup(false, false);
      parts.push(renderUserItem(item, { threadId, deferImages, forkTurnIndex: turnIndex, forkTurnId: normalizedTurn?.id || "", timestamp: turnStartTime }));
    } else if (item.type === "agentMessage" && primaryAgentIndexes.has(i)) {
      flushProcessGroup(false, false);
      parts.push(renderAgentMessageItem(item, agentLabel, { forcePrimary: true, threadId, modelBadge, deferImages, forkTurnIndex: turnIndex, forkTurnId: normalizedTurn?.id || "", timestamp: turnReplyTime }));
    } else if (isTurnProcessItem(item)) {
      pendingProcessItems.push(item);
    }
  }
  if (pendingProcessItems.length) {
    flushProcessGroup(isRunning, true);
  } else if (isRunning && (String(liveThought || "").trim() || String(livePhase || "").trim())) {
    const syntheticHtml = renderProcessGroupHtml([], {
      isRunning: true,
      liveThought,
      livePhase,
      threadId,
      modelBadge: takeProcessBadge(),
    });
    if (syntheticHtml) parts.push(syntheticHtml);
  } else if (!isRunning && String(trailingThought || "").trim()) {
    const syntheticDoneHtml = renderProcessGroupHtml([], {
      isRunning: false,
      extraReasoning: trailingThought,
      threadId,
      modelBadge: takeProcessBadge(),
    });
    if (syntheticDoneHtml) parts.push(syntheticDoneHtml);
  }

  const hasProcessContent = cleanItems.some((it) => isTurnProcessItem(it)) || Boolean(String(trailingThought || "").trim());
  if (
    showIncompleteSummaryHint
    && !isRunning
    && !hasExternalStreamingReply
    && primaryAgentIndexes.size === 0
    && !hasAskQuestion
    && !normalizedTurn?.error?.message
    && hasProcessContent
  ) {
    if (supersededByNextTurn) {
      parts.push(`<div class="turn-no-summary-hint">已由后续新消息接续处理（本轮无独立汇总）</div>`);
    } else {
      parts.push(`
        <div class="turn-no-summary-hint is-incomplete">
          <span>本轮停在工具执行步（未生成结果汇总，可能在桌面端等待确认或已中断）</span>
          <button type="button" class="turn-resume-inline-btn" data-resume-interrupted-turn="1">${goalSuspended ? "▶ 恢复 Goal" : "▶ 继续执行"}</button>
        </div>
      `);
    }
  }

  const errorBanner = normalizedTurn?.error?.message
    ? `
      <div class="turn-error">
        <div class="turn-error-head">
          <div class="turn-error-main">${escapeHtml(normalizedTurn.error.message)}</div>
          ${!isRunning && !supersededByNextTurn ? `<button type="button" class="turn-resume-inline-btn is-error-retry" data-resume-interrupted-turn="1">${goalSuspended ? "▶ 恢复 Goal" : "▶ 重试继续"}</button>` : ""}
        </div>
        ${normalizedTurn.error.detail ? `<details class="turn-error-details"><summary>查看原始错误详情</summary><pre class="turn-error-pre">${escapeHtml(normalizedTurn.error.detail)}</pre></details>` : ""}
      </div>
    `
    : "";

  return `<section class="turn-block" data-turn-id="${escapeHtml(normalizedTurn.id || "")}">${parts.join("")}${errorBanner}</section>`;
}

function stripTurnUserText(value) {
  const extracted = extractClientCodexUserText(String(value || ""));
  return extracted.text
    .replace(/\[Request interrupted by user[^\]]*\]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function turnUserInputText(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  const texts = items
    .filter((it) => it?.type === "userMessage")
    .map((it) => {
      if (typeof it.text === "string" && it.text.trim()) return it.text;
      const content = Array.isArray(it.content) ? it.content : [];
      return content.filter((b) => b?.type === "text" && b.text).map((b) => b.text).join("\n");
    })
    .filter(Boolean);
  return stripTurnUserText(texts.join("\n"));
}

function turnPrimaryReplyText(turn) {
  const items = Array.isArray(turn?.items) ? turn.items : [];
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i];
    if (it?.type === "agentMessage" && it.phase !== "commentary" && String(it.text || "").trim()) {
      return String(it.text).trim();
    }
  }
  return "";
}

/**
 * 前端渲染兜底去重：合并刚落盘轮次与尾部重复的 inProgress 合成轮次。
 */
export function dedupeAdjacentTurns(turns = []) {
  const list = Array.isArray(turns) ? turns : [];
  const result = [];
  for (const turn of list) {
    if (!turn || typeof turn !== "object") continue;
    const prev = result[result.length - 1];
    if (!prev) {
      result.push(turn);
      continue;
    }
    const currIsLiveTail = turn.status === "inProgress"
      || turn.status === "running"
      || /^(?:agy|claude|grok)-turn-/.test(String(turn.id || ""));
    const prevUser = turnUserInputText(prev);
    const currUser = turnUserInputText(turn);
    const prevReply = turnPrimaryReplyText(prev);
    const currReply = turnPrimaryReplyText(turn);
    const prevHasDifferentReply = Boolean(prevReply && prevReply !== currReply);

    if (currIsLiveTail && prevUser && prevUser === currUser && !prevHasDifferentReply) {
      const mergedItems = [...(Array.isArray(prev.items) ? prev.items : [])];
      for (const item of Array.isArray(turn.items) ? turn.items : []) {
        if (!item || item.type === "userMessage") continue;
        if (
          item.type === "agentMessage"
          && String(item.text || "").trim()
          && String(item.text || "").trim() === prevReply
        ) {
          continue;
        }
        mergedItems.push(item);
      }
      result[result.length - 1] = {
        ...prev,
        status: turn.status || "inProgress",
        model: turn.model || prev.model || "",
        models: (Array.isArray(turn.models) && turn.models.length) ? turn.models : (prev.models || []),
        effort: turn.effort || prev.effort || "",
        items: mergedItems,
      };
      continue;
    }

    if (
      currIsLiveTail
      && prevReply
      && currReply
      && currReply.length >= 20
      && currReply === prevReply
      && (!prevUser || !currUser || prevUser !== currUser)
    ) {
      const strippedItems = (Array.isArray(turn.items) ? turn.items : []).filter(
        (item) => !(
          item?.type === "agentMessage"
          && item.phase !== "commentary"
          && String(item.text || "").trim() === prevReply
        ),
      );
      result.push({ ...turn, items: strippedItems });
      continue;
    }

    if (result.length >= 2 && (!currUser || currUser !== prevUser)) {
      const matchesEarlier = result.slice(0, -1).some((earlier) => {
        const earlierUser = turnUserInputText(earlier);
        const earlierReply = turnPrimaryReplyText(earlier);
        if (turn.id && earlier?.id && turn.id === earlier.id) {
          const sameOrMissingUser = !currUser || !earlierUser || currUser === earlierUser;
          const sameOrMissingReply = !currReply || earlierReply === currReply;
          return sameOrMissingUser && sameOrMissingReply;
        }
        return Boolean(
          currUser
          && earlierUser === currUser
          && currReply
          && earlierReply === currReply,
        );
      });
      if (matchesEarlier) continue;
    }

    result.push(turn);
  }
  const collapsed = [];
  for (const turn of result) {
    const currGroup = detectQuietHeartbeatGroup(turn);
    if (!currGroup) {
      collapsed.push(turn);
      continue;
    }
    const prev = collapsed[collapsed.length - 1];
    const prevGroup = prev ? detectQuietHeartbeatGroup(prev) : null;
    if (
      prevGroup
      && (!prevGroup.automationId || !currGroup.automationId || prevGroup.automationId === currGroup.automationId)
    ) {
      collapsed[collapsed.length - 1] = {
        ...turn,
        quietHeartbeatGroup: {
          ...currGroup,
          count: Math.max(1, Number(prevGroup.count) || 1) + Math.max(1, Number(currGroup.count) || 1),
          firstStartedAt: prevGroup.firstStartedAt || currGroup.firstStartedAt || prev.startedAt || null,
          lastCompletedAt: currGroup.lastCompletedAt || prevGroup.lastCompletedAt || turn.completedAt || null,
          automationName: currGroup.automationName || prevGroup.automationName || "",
          instructions: currGroup.instructions || prevGroup.instructions || "",
        },
      };
    } else {
      collapsed.push(turn.quietHeartbeatGroup ? turn : { ...turn, quietHeartbeatGroup: currGroup });
    }
  }
  return collapsed;
}
