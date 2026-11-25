const RATE_LIMIT_RE = /(?:^|\b)(?:429|rate[_\s-]?limit|usage[_\s-]?limit|too many requests|quota|overloaded|credit balance)(?:\b|$)|限额|额度|限流|频控/i;
const AUTH_ERROR_RE = /(?:^|\b)(?:401|403|unauthorized|forbidden|invalid[_\s-]?api[_\s-]?key|authentication|auth[_\s-]?error|not logged in|login required|token expired|invalid token)(?:\b|$)|鉴权|未登录|密钥无效|认证失败/i;
const NETWORK_ERROR_RE = /(?:^|\b)(?:502|503|504|timeout|timed[_\s-]?out|econnrefused|enotfound|ehostunreach|enetunreach|econnreset|socket hang up|bad gateway|fetch failed)(?:\b|$)|线路|连接失败|无法连接|网络|超时/i;
const NOT_INSTALLED_RE = /(?:^|\b)(?:enoent|command not found|not installed)(?:\b|$)|未安装|找不到命令/i;
const CODEX_OFFICIAL_CLIENT_ONLY_RE = /only allows codex official clients/i;

export function isCodexOfficialClientError(errorOrMessage) {
  if (!errorOrMessage) return false;
  if (typeof errorOrMessage === "string") {
    return CODEX_OFFICIAL_CLIENT_ONLY_RE.test(errorOrMessage);
  }
  const texts = [
    errorOrMessage.message,
    errorOrMessage.additionalDetails,
    errorOrMessage.reason,
    errorOrMessage.stderr,
    errorOrMessage.detail,
    errorOrMessage.error?.message,
    errorOrMessage.error?.additionalDetails,
  ].filter(Boolean);
  return texts.some((item) => CODEX_OFFICIAL_CLIENT_ONLY_RE.test(String(item)));
}

export function extractErrorMessage(errorOrMessage) {
  if (!errorOrMessage) return "";
  if (typeof errorOrMessage === "string") return errorOrMessage.trim();
  const additional = String(
    errorOrMessage.additionalDetails || errorOrMessage.error?.additionalDetails || "",
  ).trim();
  const primaryMsg = String(errorOrMessage.message || errorOrMessage.error?.message || "").trim();
  if (additional && (CODEX_OFFICIAL_CLIENT_ONLY_RE.test(additional) || /^Reconnecting\b/i.test(primaryMsg))) {
    return additional;
  }
  const candidates = [
    errorOrMessage.message,
    errorOrMessage.additionalDetails,
    errorOrMessage.reason,
    errorOrMessage.result,
    errorOrMessage.stderr,
    errorOrMessage.error?.message,
    errorOrMessage.error?.additionalDetails,
  ].filter(Boolean);
  return String(candidates[0] || "").trim();
}

export function classifyProfileError(errorOrMessage, { now = Date.now(), cooldownSeconds = 1800 } = {}) {
  const detail = extractErrorMessage(errorOrMessage);
  const nowSec = Math.floor(now / 1000);
  if (RATE_LIMIT_RE.test(detail)) {
    return {
      status: "cooldown",
      reasonCode: "rate_limit",
      shortReason: "限额冷却",
      detail,
      cooldownUntil: nowSec + Math.max(60, Number(cooldownSeconds) || 1800),
    };
  }
  if (isCodexOfficialClientError(errorOrMessage) || isCodexOfficialClientError(detail)) {
    return {
      status: "unavailable",
      reasonCode: "official_client_only",
      shortReason: "仅限官方CLI",
      detail: detail || extractErrorMessage(errorOrMessage),
      cooldownUntil: 0,
    };
  }
  if (AUTH_ERROR_RE.test(detail)) {
    if (/CLI未登录/.test(detail)) {
      return {
        status: "unavailable",
        reasonCode: "auth",
        shortReason: "CLI未登录",
        detail: detail.replace(/^401\s+/, ""),
        cooldownUntil: 0,
      };
    }
    return {
      status: "unavailable",
      reasonCode: "auth",
      shortReason: "鉴权失效",
      detail,
      cooldownUntil: 0,
    };
  }
  if (NETWORK_ERROR_RE.test(detail)) {
    return {
      status: "unavailable",
      reasonCode: "network",
      shortReason: "线路不通",
      detail,
      cooldownUntil: 0,
    };
  }
  if (NOT_INSTALLED_RE.test(detail)) {
    return {
      status: "unavailable",
      reasonCode: "not_installed",
      shortReason: "未安装",
      detail,
      cooldownUntil: 0,
    };
  }
  return {
    status: "unavailable",
    reasonCode: "error",
    shortReason: "暂不可用",
    detail,
    cooldownUntil: 0,
  };
}

export function normalizeProfileHealth(rawMeta = {}, { installed = true, now = Date.now() } = {}) {
  const meta = rawMeta && typeof rawMeta === "object" ? rawMeta : {};
  const nowSec = Math.floor(now / 1000);
  const disabled = Boolean(meta.disabled);
  const alias = String(meta.alias || "").trim();
  const autoAliasSignature = String(meta.autoAliasSignature || "").trim();
  const autoAliasSource = String(meta.autoAliasSource || "").trim();
  const codexExecMode = Boolean(meta.codexExecMode);
  const codexExecSuggested = Object.hasOwn(meta, "codexExecSuggested")
    ? Boolean(meta.codexExecSuggested)
    : meta.reasonCode === "official_client_only";

  if (!installed) {
    return {
      status: "unavailable",
      reasonCode: "not_installed",
      shortReason: "未安装",
      detail: meta.detail || "未检测到本机目录或可执行文件",
      latencyMs: null,
      checkedAt: Number(meta.checkedAt) || 0,
      cooldownUntil: 0,
      disabled,
      alias,
      codexExecMode,
      codexExecSuggested,
      ...(autoAliasSignature ? { autoAliasSignature } : {}),
      ...(autoAliasSource ? { autoAliasSource } : {}),
    };
  }

  let status = String(meta.status || "unknown");
  let reasonCode = String(meta.reasonCode || "");
  let shortReason = String(meta.shortReason || "");
  let detail = String(meta.detail || "");
  let cooldownUntil = Number(meta.cooldownUntil) || 0;

  if (!["healthy", "unknown", "cooldown", "unavailable"].includes(status)) {
    status = "unknown";
  }

  // 历史曾因会话并发占用锁（如 already has an active writer）误标成实例不可用时，自动清洗恢复为 unknown。
  if (status === "unavailable" && detail && isIgnorableTurnError({ message: detail })) {
    status = "unknown";
    reasonCode = "";
    shortReason = "";
    detail = "";
    cooldownUntil = 0;
  }

  if (status === "cooldown" && cooldownUntil > 0 && nowSec >= cooldownUntil) {
    status = "unknown";
    reasonCode = "";
    shortReason = "";
    detail = "";
    cooldownUntil = 0;
  }

  return {
    status,
    reasonCode,
    shortReason,
    detail,
    latencyMs: Number.isFinite(Number(meta.latencyMs)) && Number(meta.latencyMs) >= 0 ? Math.round(Number(meta.latencyMs)) : null,
    checkedAt: Number(meta.checkedAt) || 0,
    cooldownUntil,
    disabled,
    alias,
    codexExecMode,
    codexExecSuggested: Object.hasOwn(meta, "codexExecSuggested")
      ? Boolean(meta.codexExecSuggested)
      : reasonCode === "official_client_only",
    ...(autoAliasSignature ? { autoAliasSignature } : {}),
    ...(autoAliasSource ? { autoAliasSource } : {}),
  };
}

export function profileAvailabilityRank(profile) {
  const health = profile?.health || {};
  if (health.disabled) return 4;
  switch (health.status) {
    case "healthy":
      return 0;
    case "unknown":
      return 1;
    case "cooldown":
      return 2;
    case "unavailable":
      return 3;
    default:
      return 1;
  }
}

export function sortProfilesByHealth(profiles = []) {
  return [...(Array.isArray(profiles) ? profiles : [])].sort((a, b) => {
    const rankDiff = profileAvailabilityRank(a) - profileAvailabilityRank(b);
    if (rankDiff !== 0) return rankDiff;
    const latA = Number.isFinite(a?.health?.latencyMs) ? a.health.latencyMs : Number.MAX_SAFE_INTEGER;
    const latB = Number.isFinite(b?.health?.latencyMs) ? b.health.latencyMs : Number.MAX_SAFE_INTEGER;
    if (latA !== latB) return latA - latB;
    return 0;
  });
}

export function isIgnorableTurnError(error) {
  if (!error) return false;
  if (Number(error.status) === 409) return true;
  if (
    error.code === "thread_busy"
    || error.code === "writer_conflict"
    || error.code === "codex_app_running"
    || error.code === "thread_not_directly_controllable"
    || error.code === "invalid_cwd"
  ) {
    return true;
  }
  const msg = extractErrorMessage(error);
  return /(?:interrupted|aborted|cancelled|canceled|已中断|already has an active writer|\bactive writer\b|thread is busy|正在运行|已被.*占用|被本地客户端占用)/i.test(msg);
}
