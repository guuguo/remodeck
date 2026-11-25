export const TITLE_WIDTH_LIMITS = Object.freeze({
  object: 7,
  subject: 10,
  base: 16,
  suffix: 5,
  total: 22,
  maxSuffixes: 2,
  draftLockAfterMs: 30 * 60 * 1000,
  draftLockUserTurns: 3,
});

const XML_TAG_RE = /<(?:USER_REQUEST|ADDITIONAL_METADATA|USER_SETTINGS_CHANGE|image|task-notification|system-reminder|cross-session-message|environment_context|skills_instructions|local-command-|bash-input)\b/i;
const WRAPPER_TAG_RE = /(?:\((?:Antigravity|Codex|Claude(?:\s*Code)?|Grok|Qoder)\s*接续\)|\(分叉(?:\s*\d+)?\))/i;
const PLACEHOLDER_TITLE_RE = /^(?:新会话|未命名会话|untitled|new\s+chat|new\s+session)$/i;
const LEADING_FILLER_RE = /^(?:帮我|请帮我|请问|麻烦|看一下|看下|看看|继续|接着|全面|现状)(?:$|[｜|，,。\s]|(?=[\u4e00-\u9fffA-Za-z0-9]))/i;
const MODEL_EXEC_PREFIX_RE = /^(?:让\s*)?(?:Opus|Sonnet|Haiku|GPT[\d.-]*|Gemini[\d.-]*|Claude|Codex|Antigravity|Grok)(?:\s*[\d.]+)?\s*(?:全面|帮忙|来|做|诊断|评估|分析|写|改)/i;
const STATUS_TAIL_RE = /(?:排查中|处理中|进行中|已完成|待确认|一下)$/i;
const TRAILING_FORK_OR_CONTINUE_RE = /(?:\s*\(分叉(?:\s*\d+)?\)\s*|\s*\([^()]*接续\)\s*)$/;

/**
 * Measure display width where ASCII printable chars count as 0.5 and CJK/full-width chars count as 1.
 */
export function measureTitleWidth(text = "") {
  let units = 0;
  for (const ch of String(text || "")) {
    const code = ch.codePointAt(0);
    if (code >= 0x20 && code <= 0x7e) {
      units += 0.5;
    } else {
      units += 1;
    }
  }
  return Math.ceil(units);
}

/**
 * Detect domain-owned bracketed titles with 3+ header segments (e.g. 【Client｜Reporter｜Module｜Model】Issue).
 */
export function isCanonicalDomainTitle(raw = "") {
  const clean = String(raw || "").replace(/[\r\n]+/g, " ").trim();
  const match = clean.match(/^【([^】\n]{1,64})】\s*(\S.*)$/);
  if (!match) return false;
  const parts = match[1].split(/[｜|]/).map((part) => part.trim()).filter(Boolean);
  if (parts.length < 3) return false;
  return !XML_TAG_RE.test(match[2]);
}

/**
 * Strip trailing "(分叉)" and "(<Provider> 接续)" suffixes recursively.
 */
export function stripForkAndContinueWrappers(raw = "") {
  let out = String(raw || "").replace(/[\r\n]+/g, " ").trim();
  while (TRAILING_FORK_OR_CONTINUE_RE.test(out)) {
    out = out.replace(TRAILING_FORK_OR_CONTINUE_RE, "").trim();
  }
  return out;
}

/**
 * Collapse whitespace and normalize ASCII pipe separators into full-width "｜".
 */
export function normalizeAgentBaseTitle(raw = "") {
  return String(raw || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[｜|]\s*/g, "｜")
    .trim();
}

export function validateAgentBaseTitle(raw = "") {
  const value = normalizeAgentBaseTitle(raw);
  const width = measureTitleWidth(value);
  if (!value || width < 2) {
    return { ok: false, value, object: "", subject: "", width, error: "标题不能为空且至少包含 2 个字符" };
  }
  if (XML_TAG_RE.test(value)) {
    return { ok: false, value, object: "", subject: "", width, error: "标题不能包含系统标签或附件标记" };
  }
  if (WRAPPER_TAG_RE.test(value)) {
    return { ok: false, value, object: "", subject: "", width, error: "标题不能包含「接续」或「分叉」标记" };
  }
  if (value.startsWith("【")) {
    return { ok: false, value, object: "", subject: "", width, error: "通用会话标题请使用「对象｜主旨」格式，不要加【】方括号" };
  }
  if (PLACEHOLDER_TITLE_RE.test(value) || LEADING_FILLER_RE.test(value)) {
    return { ok: false, value, object: "", subject: "", width, error: "标题不能以「帮我/继续/全面/现状/新会话」等口水或占位词开头" };
  }
  if (MODEL_EXEC_PREFIX_RE.test(value)) {
    return { ok: false, value, object: "", subject: "", width, error: "标题不能包含模型或引擎执行前缀" };
  }
  if (STATUS_TAIL_RE.test(value)) {
    return { ok: false, value, object: "", subject: "", width, error: "标题末尾不要带「排查中/已完成/一下」等状态词" };
  }

  let object = "";
  let subject = value;
  if (value.includes("｜")) {
    const parts = value.split("｜");
    if (parts.length > 2) {
      return { ok: false, value, object: "", subject: "", width, error: "通用标题最多包含 1 个「｜」（格式：对象｜主旨）" };
    }
    object = parts[0].trim();
    subject = parts[1].trim();
    if (!object || !subject) {
      return { ok: false, value, object, subject, width, error: "「对象｜主旨」两侧均不能为空" };
    }
    if (PLACEHOLDER_TITLE_RE.test(subject) || LEADING_FILLER_RE.test(subject) || MODEL_EXEC_PREFIX_RE.test(subject)) {
      return { ok: false, value, object, subject, width, error: "主旨部分不能包含口水词、占位词或模型执行前缀" };
    }
    const objWidth = measureTitleWidth(object);
    if (objWidth > TITLE_WIDTH_LIMITS.object) {
      return {
        ok: false,
        value,
        object,
        subject,
        width,
        error: `对象槽位过长（当前宽度 ${objWidth}，上限 ${TITLE_WIDTH_LIMITS.object}）`,
      };
    }
    const subjWidth = measureTitleWidth(subject);
    if (subjWidth > TITLE_WIDTH_LIMITS.subject) {
      return {
        ok: false,
        value,
        object,
        subject,
        width,
        error: `主旨槽位过长（当前宽度 ${subjWidth}，上限 ${TITLE_WIDTH_LIMITS.subject}）`,
      };
    }
  }

  if (width > TITLE_WIDTH_LIMITS.base || value.length > 32) {
    return {
      ok: false,
      value,
      object,
      subject,
      width,
      error: `主干标题过长（当前宽度 ${width}，上限 ${TITLE_WIDTH_LIMITS.base}）`,
    };
  }

  return { ok: true, value, object, subject, width, error: "" };
}

export function validateAgentSuffix(raw = "") {
  const clean = String(raw || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/^\s*\++\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
  const width = measureTitleWidth(clean);
  if (!clean) {
    return { ok: false, value: "", width: 0, error: "追加后缀不能为空" };
  }
  if (/[｜|+]/.test(clean)) {
    return { ok: false, value: clean, width, error: "后缀不能包含「｜」或「+」" };
  }
  if (XML_TAG_RE.test(clean) || WRAPPER_TAG_RE.test(clean)) {
    return { ok: false, value: clean, width, error: "后缀不能包含系统标签或接续/分叉标记" };
  }
  if (PLACEHOLDER_TITLE_RE.test(clean) || LEADING_FILLER_RE.test(clean) || STATUS_TAIL_RE.test(clean)) {
    return { ok: false, value: clean, width, error: "后缀不能包含虚词、占位词或状态词" };
  }
  if (width > TITLE_WIDTH_LIMITS.suffix || clean.length > 12) {
    return {
      ok: false,
      value: clean,
      width,
      error: `后缀过长（当前宽度 ${width}，上限 ${TITLE_WIDTH_LIMITS.suffix}）`,
    };
  }
  return { ok: true, value: clean, width, error: "" };
}

export function formatStructuredTitle(base = "", suffixes = []) {
  const cleanBase = String(base || "").trim();
  const cleanSuffixes = Array.isArray(suffixes)
    ? suffixes.map((s) => String(s || "").trim()).filter(Boolean)
    : [];
  if (!cleanBase) return "";
  if (!cleanSuffixes.length) return cleanBase;
  return `${cleanBase} ${cleanSuffixes.map((s) => `+${s}`).join(" ")}`;
}

export function isDuplicateSuffix(base = "", suffixes = [], candidate = "") {
  const norm = (value) => String(value || "").toLowerCase().replace(/\s+/g, "");
  const cand = norm(candidate);
  if (!cand) return true;
  if (norm(base).includes(cand)) return true;
  for (const item of Array.isArray(suffixes) ? suffixes : []) {
    const normItem = norm(item);
    if (!normItem) continue;
    if (normItem === cand || normItem.includes(cand) || cand.includes(normItem)) {
      return true;
    }
  }
  return false;
}

export function resolveEffectiveTitleMeta(meta = null, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const tm = meta?.titleMeta && typeof meta.titleMeta === "object" ? meta.titleMeta : null;
  if (tm && tm.state) {
    let state = String(tm.state || "none");
    const source = String(tm.source || "");
    const base = String(tm.base || meta?.customName || "").trim();
    const suffixes = Array.isArray(tm.suffixes)
      ? tm.suffixes.map((s) => String(s || "").trim()).filter(Boolean)
      : [];
    const createdAt = Number(tm.createdAt) || 0;
    let lockedAt = Number(tm.lockedAt) || 0;
    const updatedAt = Number(tm.updatedAt) || 0;
    const draftTurns = Number(tm.draftTurns) || 0;
    const lockWindowSec = Math.floor(TITLE_WIDTH_LIMITS.draftLockAfterMs / 1000);
    if (state === "draft") {
      if ((createdAt > 0 && nowSec - createdAt >= lockWindowSec) || draftTurns >= TITLE_WIDTH_LIMITS.draftLockUserTurns) {
        state = "locked";
        if (!lockedAt) lockedAt = nowSec;
      }
    }
    return {
      state,
      source,
      base,
      suffixes,
      createdAt,
      lockedAt,
      updatedAt,
      draftTurns,
    };
  }

  const legacyCustomName = String(meta?.customName || "").trim();
  if (legacyCustomName) {
    const isDomain = isCanonicalDomainTitle(legacyCustomName);
    const ts = Number(meta?.updatedAt) || 0;
    return {
      state: "locked",
      source: isDomain ? "domain" : "legacy",
      base: legacyCustomName,
      suffixes: [],
      createdAt: ts,
      lockedAt: ts,
      updatedAt: ts,
      draftTurns: TITLE_WIDTH_LIMITS.draftLockUserTurns,
    };
  }

  return {
    state: "none",
    source: "",
    base: "",
    suffixes: [],
    createdAt: 0,
    lockedAt: 0,
    updatedAt: 0,
    draftTurns: 0,
  };
}

export function evaluateTitleMutation(existingMeta = null, request = {}, { nowSec = Math.floor(Date.now() / 1000) } = {}) {
  const eff = resolveEffectiveTitleMeta(existingMeta, { nowSec });
  const rawSource = String(request?.source || "user").trim().toLowerCase();
  const source = rawSource === "agent" || rawSource === "domain" ? rawSource : "user";
  const action = String(request?.action || "set").trim().toLowerCase() === "append" ? "append" : "set";
  const lock = Boolean(request?.lock);
  const currentName = formatStructuredTitle(eff.base, eff.suffixes) || String(existingMeta?.customName || "").trim();

  if (source === "user") {
    const cleanName = String(request?.name || "").replace(/[\r\n]+/g, " ").trim();
    if (!cleanName) {
      return { ok: false, status: 400, code: "empty_title", error: "会话标题不能为空", currentName, titleState: eff.state };
    }
    if (cleanName.length > 200) {
      return { ok: false, status: 400, code: "title_too_long", error: "会话标题不能超过 200 字", currentName, titleState: eff.state };
    }
    return {
      ok: true,
      status: 200,
      skipped: false,
      locked: true,
      reason: "",
      error: "",
      nextCustomName: cleanName,
      nextTitleMeta: {
        state: "user",
        source: "user",
        base: cleanName,
        suffixes: [],
        createdAt: eff.createdAt || nowSec,
        lockedAt: nowSec,
        updatedAt: nowSec,
        draftTurns: Math.max(1, eff.draftTurns || 1),
      },
      currentName,
      base: cleanName,
      suffixes: [],
      titleState: "user",
    };
  }

  if (source === "domain" || (source === "agent" && action !== "append" && isCanonicalDomainTitle(request?.name))) {
    if (eff.state === "user") {
      return {
        ok: true,
        status: 200,
        skipped: true,
        locked: true,
        reason: "locked_by_user",
        error: "",
        currentName,
        base: eff.base,
        suffixes: eff.suffixes,
        titleState: "user",
      };
    }
    const cleanName = String(request?.name || "").replace(/[\r\n]+/g, " ").trim();
    if (!cleanName) {
      return { ok: false, status: 400, code: "empty_title", error: "会话标题不能为空", currentName, titleState: eff.state };
    }
    if (cleanName.length > 200) {
      return { ok: false, status: 400, code: "title_too_long", error: "会话标题不能超过 200 字", currentName, titleState: eff.state };
    }
    return {
      ok: true,
      status: 200,
      skipped: false,
      locked: true,
      reason: "",
      error: "",
      nextCustomName: cleanName,
      nextTitleMeta: {
        state: "locked",
        source: "domain",
        base: cleanName,
        suffixes: [],
        createdAt: eff.createdAt || nowSec,
        lockedAt: nowSec,
        updatedAt: nowSec,
        draftTurns: Math.max(1, eff.draftTurns || 1),
      },
      currentName,
      base: cleanName,
      suffixes: [],
      titleState: "locked",
    };
  }

  // source === "agent"
  if (eff.state === "user") {
    return {
      ok: true,
      status: 200,
      skipped: true,
      locked: true,
      reason: "locked_by_user",
      error: "",
      currentName,
      base: eff.base,
      suffixes: eff.suffixes,
      titleState: "user",
    };
  }
  if (eff.source === "domain") {
    return {
      ok: true,
      status: 200,
      skipped: true,
      locked: true,
      reason: "locked_by_domain",
      error: "",
      currentName,
      base: eff.base,
      suffixes: eff.suffixes,
      titleState: eff.state,
    };
  }

  if (action === "append") {
    if (eff.state === "none" || !eff.base) {
      return {
        ok: false,
        status: 400,
        code: "no_primary_title",
        error: "会话尚未设定主标题，请先设置主标题后再追加后缀",
        currentName,
        titleState: eff.state,
      };
    }
    const sv = validateAgentSuffix(request?.suffix ?? request?.name ?? "");
    if (!sv.ok) {
      return {
        ok: false,
        status: 400,
        code: "invalid_title_suffix",
        error: sv.error,
        currentName,
        titleState: eff.state,
      };
    }
    if (isDuplicateSuffix(eff.base, eff.suffixes, sv.value)) {
      return {
        ok: true,
        status: 200,
        skipped: true,
        locked: true,
        reason: "suffix_duplicate",
        error: "",
        currentName,
        base: eff.base,
        suffixes: eff.suffixes,
        titleState: "locked",
      };
    }
    if (eff.suffixes.length >= TITLE_WIDTH_LIMITS.maxSuffixes) {
      return {
        ok: true,
        status: 200,
        skipped: true,
        locked: true,
        reason: "suffix_limit_reached",
        error: "",
        currentName,
        base: eff.base,
        suffixes: eff.suffixes,
        titleState: "locked",
      };
    }
    const nextSuffixes = [...eff.suffixes, sv.value];
    const nextCustomName = formatStructuredTitle(eff.base, nextSuffixes);
    const totalWidth = measureTitleWidth(nextCustomName);
    if (totalWidth > TITLE_WIDTH_LIMITS.total) {
      const usedWidth = measureTitleWidth(formatStructuredTitle(eff.base, eff.suffixes));
      const remaining = Math.max(0, TITLE_WIDTH_LIMITS.total - usedWidth - 1);
      return {
        ok: false,
        status: 400,
        code: "title_total_too_long",
        error: `追加后缀后总宽度超限（当前 ${totalWidth}，上限 ${TITLE_WIDTH_LIMITS.total}，建议后缀不超过 ${remaining} 字）`,
        currentName,
        titleState: eff.state,
      };
    }
    return {
      ok: true,
      status: 200,
      skipped: false,
      locked: true,
      reason: "",
      error: "",
      nextCustomName,
      nextTitleMeta: {
        state: "locked",
        source: eff.source || "agent",
        base: eff.base,
        suffixes: nextSuffixes,
        createdAt: eff.createdAt || nowSec,
        lockedAt: eff.lockedAt || nowSec,
        updatedAt: nowSec,
        draftTurns: Math.max(1, eff.draftTurns || 1),
      },
      currentName,
      base: eff.base,
      suffixes: nextSuffixes,
      titleState: "locked",
    };
  }

  // action === "set"
  if (eff.state === "locked") {
    return {
      ok: true,
      status: 200,
      skipped: true,
      locked: true,
      reason: "primary_title_locked",
      error: "",
      currentName,
      base: eff.base,
      suffixes: eff.suffixes,
      titleState: "locked",
    };
  }

  const bv = validateAgentBaseTitle(request?.name ?? "");
  if (!bv.ok) {
    return {
      ok: false,
      status: 400,
      code: "invalid_agent_title",
      error: bv.error,
      currentName,
      titleState: eff.state,
    };
  }

  const nextState = lock ? "locked" : "draft";
  const isUpdateDraft = eff.state === "draft";
  const createdAt = isUpdateDraft && eff.createdAt ? eff.createdAt : nowSec;
  const draftTurns = isUpdateDraft && eff.draftTurns ? eff.draftTurns : 1;

  return {
    ok: true,
    status: 200,
    skipped: false,
    locked: nextState === "locked",
    reason: "",
    error: "",
    nextCustomName: bv.value,
    nextTitleMeta: {
      state: nextState,
      source: "agent",
      base: bv.value,
      suffixes: [],
      createdAt,
      lockedAt: nextState === "locked" ? nowSec : 0,
      updatedAt: nowSec,
      draftTurns,
    },
    currentName,
    base: bv.value,
    suffixes: [],
    titleState: nextState,
  };
}
