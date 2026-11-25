import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_DATA_URL_CHARS = 6 * 1024 * 1024;
const DEFAULT_TTL_MS = 120_000;
const MIN_TTL_MS = 15_000;
const MAX_TTL_MS = 600_000;
const ALLOWED_KINDS = new Set(["captcha", "otp", "credentials", "custom"]);

export function isLoopbackRefreshUrl(rawUrl) {
  const text = String(rawUrl || "").trim();
  if (!text) return false;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== "http:") return false;
    const host = parsed.hostname.toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

function sniffImageMime(buf, fallbackMime = "image/png") {
  if (Buffer.isBuffer(buf) && buf.length >= 4) {
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
      return "image/gif";
    }
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      return "image/png";
    }
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return "image/jpeg";
    }
    if (
      buf.length >= 12
      && buf.subarray(0, 4).toString("ascii") === "RIFF"
      && buf.subarray(8, 12).toString("ascii") === "WEBP"
    ) {
      return "image/webp";
    }
  }
  return fallbackMime;
}

export function bufferToImageDataUrl(buf, fallbackMime = "image/png") {
  if (!Buffer.isBuffer(buf) || buf.length === 0) {
    throw Object.assign(new Error("图片内容为空"), { status: 400, code: "empty_image" });
  }
  if (buf.length > MAX_IMAGE_BYTES) {
    throw Object.assign(new Error("图片大小超过 4MB 限制"), { status: 400, code: "image_too_large" });
  }
  const mime = sniffImageMime(buf, fallbackMime);
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function normalizeBase64Image(raw, fallbackMime = "image/png") {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text.startsWith("data:image/")) {
    if (text.length > MAX_DATA_URL_CHARS) {
      throw Object.assign(new Error("图片 Data URL 过大"), { status: 400, code: "image_too_large" });
    }
    return text;
  }
  const cleanB64 = text.replace(/\s+/g, "");
  if (cleanB64.length > MAX_DATA_URL_CHARS) {
    throw Object.assign(new Error("图片编码过大"), { status: 400, code: "image_too_large" });
  }
  let mime = fallbackMime;
  if (cleanB64.startsWith("R0lGOD")) mime = "image/gif";
  else if (cleanB64.startsWith("/9j/")) mime = "image/jpeg";
  else if (cleanB64.startsWith("iVBOR")) mime = "image/png";
  else if (cleanB64.startsWith("UklGR")) mime = "image/webp";
  return `data:${mime};base64,${cleanB64}`;
}

function normalizeFields(rawFields) {
  const list = Array.isArray(rawFields) && rawFields.length > 0
    ? rawFields
    : [{ name: "code", label: "验证码", type: "text", placeholder: "输入结果后回车提交", required: true }];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const f = list[i] && typeof list[i] === "object" ? list[i] : {};
    const name = String(f.name || `field_${i + 1}`).trim() || `field_${i + 1}`;
    if (seen.has(name)) continue;
    seen.add(name);
    out.push({
      name,
      label: String(f.label || name).trim() || name,
      type: f.type === "password" ? "password" : "text",
      placeholder: String(f.placeholder || "").trim(),
      value: f.value === undefined || f.value === null ? "" : String(f.value),
      required: f.required !== false,
    });
  }
  return out.length > 0
    ? out
    : [{ name: "code", label: "验证码", type: "text", placeholder: "输入结果后回车提交", value: "", required: true }];
}

function publicSnapshot(entry) {
  return {
    id: entry.id,
    title: entry.title,
    subtitle: entry.subtitle,
    source: entry.source,
    kind: entry.kind,
    imageDataUrl: entry.imageDataUrl,
    fields: entry.fields,
    meta: { ...entry.meta },
    canRefresh: Boolean(entry.refreshUrl),
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
    ttlMs: entry.ttlMs,
    status: entry.status,
  };
}

export class HumanVerifyManager {
  #pending = new Map();
  #targetOrigin = "";
  #dataDir = "";
  #env;
  #onEvent;
  #disableNativeHud;
  #nativeHudBinPath;
  #spawnImpl;
  #fetchImpl;
  #platform;

  constructor({
    dataDir = "",
    env = process.env,
    onEvent = null,
    disableNativeHud = false,
    nativeHudBinPath = null,
    spawnImpl = spawn,
    fetchImpl = fetch,
    platform = process.platform,
  } = {}) {
    this.#dataDir = String(dataDir || "").trim();
    this.#env = env || process.env;
    this.#onEvent = typeof onEvent === "function" ? onEvent : null;
    this.#disableNativeHud = Boolean(disableNativeHud);
    this.#nativeHudBinPath = nativeHudBinPath
      ? String(nativeHudBinPath)
      : (this.#dataDir ? resolve(this.#dataDir, "bin", "ac-verify-hud") : "");
    this.#spawnImpl = spawnImpl;
    this.#fetchImpl = fetchImpl;
    this.#platform = platform;
  }

  setTargetOrigin(origin) {
    this.#targetOrigin = String(origin || "").trim().replace(/\/+$/, "");
  }

  #emit(eventName, payload) {
    try {
      this.#onEvent?.(eventName, payload);
    } catch {}
  }

  #scheduleExpiry(entry) {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    const delayMs = Math.max(50, entry.expiresAt - Date.now());
    entry.timer = setTimeout(() => {
      this.cancel(entry.id, { reason: "timeout" });
    }, delayMs);
    entry.timer.unref?.();
  }

  #killNativeHud(entry) {
    const child = entry?.child;
    if (!child) return;
    entry.child = null;
    try {
      child.kill("SIGTERM");
    } catch {}
    const forceTimer = setTimeout(() => {
      try {
        if (!child.killed) {
          child.kill("SIGKILL");
        }
      } catch {}
    }, 500);
    forceTimer.unref?.();
  }

  #spawnNativeHud(entry) {
    if (this.#platform !== "darwin") return;
    if (this.#disableNativeHud || this.#env?.AGENT_CONTROL_DISABLE_NATIVE_HUD === "1") return;
    if (!this.#targetOrigin || !this.#nativeHudBinPath) return;
    if (!existsSync(this.#nativeHudBinPath)) return;
    try {
      const child = this.#spawnImpl(
        this.#nativeHudBinPath,
        ["--url", this.#targetOrigin, "--id", entry.id],
        { stdio: "ignore", detached: false },
      );
      child.on?.("error", () => {});
      child.on?.("exit", () => {
        if (entry.child === child) {
          entry.child = null;
        }
      });
      entry.child = child;
    } catch {}
  }

  async create(input = {}) {
    const body = input && typeof input === "object" ? input : {};
    const title = String(body.title || "").trim() || "需要人工动态验证";
    const subtitle = String(body.subtitle || "").trim();
    const source = String(body.source || "").trim() || "Agent";
    const rawKind = String(body.kind || "captcha").trim();
    const kind = ALLOWED_KINDS.has(rawKind) ? rawKind : "custom";
    const ttlMs = Math.min(MAX_TTL_MS, Math.max(MIN_TTL_MS, Math.round(Number(body.ttlMs) || DEFAULT_TTL_MS)));
    const meta = body.meta && typeof body.meta === "object" && !Array.isArray(body.meta)
      ? { ...body.meta }
      : {};
    const fields = normalizeFields(body.fields);

    const refreshUrl = String(body.refreshUrl || "").trim();
    if (refreshUrl && !isLoopbackRefreshUrl(refreshUrl)) {
      throw Object.assign(new Error("refreshUrl 仅允许本机回环 HTTP 地址"), {
        status: 400,
        code: "invalid_refresh_url",
      });
    }

    let imageDataUrl = "";
    if (body.imageDataUrl !== undefined && body.imageDataUrl !== null && String(body.imageDataUrl).trim()) {
      const rawDataUrl = String(body.imageDataUrl).trim();
      if (!rawDataUrl.startsWith("data:image/")) {
        throw Object.assign(new Error("imageDataUrl 必须为合法的 data:image/... 格式"), {
          status: 400,
          code: "invalid_image_data_url",
        });
      }
      imageDataUrl = normalizeBase64Image(rawDataUrl);
    } else if (body.imagePath !== undefined && body.imagePath !== null && String(body.imagePath).trim()) {
      const imgPath = resolve(String(body.imagePath).trim());
      let buf;
      try {
        buf = await readFile(imgPath);
      } catch (err) {
        throw Object.assign(new Error(`读取验证图片失败: ${err?.message || err}`), {
          status: 400,
          code: "invalid_image_path",
        });
      }
      imageDataUrl = bufferToImageDataUrl(buf);
    }

    const now = Date.now();
    const id = `hv_${randomBytes(6).toString("hex")}`;
    let resolveWait;
    const waitPromise = new Promise((resolveFn) => {
      resolveWait = resolveFn;
    });

    const entry = {
      id,
      title,
      subtitle,
      source,
      kind,
      imageDataUrl,
      fields,
      meta,
      refreshUrl,
      createdAt: now,
      expiresAt: now + ttlMs,
      ttlMs,
      status: "pending",
      timer: null,
      child: null,
      settled: false,
      resolveWait: (result) => {
        if (entry.settled) return;
        entry.settled = true;
        resolveWait(result);
      },
    };

    this.#pending.set(id, entry);
    this.#scheduleExpiry(entry);
    this.#spawnNativeHud(entry);

    const snap = publicSnapshot(entry);
    this.#emit("human_verify_created", snap);

    return {
      item: snap,
      wait: () => waitPromise,
    };
  }

  listPending() {
    return [...this.#pending.values()].map(publicSnapshot);
  }

  get(id) {
    const entry = this.#pending.get(String(id || "").trim());
    return entry ? publicSnapshot(entry) : null;
  }

  async refresh(id) {
    const key = String(id || "").trim();
    const entry = this.#pending.get(key);
    if (!entry) {
      throw Object.assign(new Error("验证请求不存在或已结束"), { status: 404, code: "not_found" });
    }
    if (!entry.refreshUrl) {
      throw Object.assign(new Error("当前验证请求未配置刷新地址"), { status: 400, code: "refresh_unsupported" });
    }

    let res;
    try {
      res = await this.#fetchImpl(entry.refreshUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      throw Object.assign(new Error(`刷新验证码请求失败: ${err?.message || err}`), {
        status: 502,
        code: "refresh_failed",
      });
    }

    if (!res?.ok) {
      throw Object.assign(new Error(`刷新验证码失败: HTTP ${res?.status || 502}`), {
        status: 502,
        code: "refresh_failed",
      });
    }

    let raw;
    try {
      raw = await res.json();
    } catch {
      throw Object.assign(new Error("刷新接口返回非 JSON 数据"), {
        status: 502,
        code: "refresh_invalid_json",
      });
    }

    const cap = raw?.captcha && typeof raw.captcha === "object" ? raw.captcha : raw;
    const rawImg = cap?.imageDataUrl || cap?.imgBase64 || cap?.img || raw?.imageDataUrl || raw?.imgBase64 || raw?.img || "";
    const nextImage = normalizeBase64Image(rawImg);
    if (!nextImage) {
      throw Object.assign(new Error("刷新接口未返回有效图片"), {
        status: 502,
        code: "refresh_empty_image",
      });
    }

    if (!this.#pending.has(key)) {
      throw Object.assign(new Error("验证请求已在刷新期间结束"), { status: 404, code: "not_found" });
    }

    entry.imageDataUrl = nextImage;
    const nextUuid = cap?.uuid ?? raw?.uuid;
    if (nextUuid !== undefined && nextUuid !== null && String(nextUuid).trim() !== "") {
      entry.meta = { ...entry.meta, uuid: String(nextUuid).trim() };
    }
    entry.expiresAt = Date.now() + entry.ttlMs;
    this.#scheduleExpiry(entry);

    const snap = publicSnapshot(entry);
    this.#emit("human_verify_updated", snap);
    return snap;
  }

  submit(id, { value, values, submittedBy = "web" } = {}) {
    const key = String(id || "").trim();
    const entry = this.#pending.get(key);
    if (!entry) {
      throw Object.assign(new Error("验证请求不存在或已过期"), { status: 404, code: "not_found" });
    }

    const normalizedValues = {};
    const inputValues = values && typeof values === "object" && !Array.isArray(values) ? values : null;
    for (let i = 0; i < entry.fields.length; i += 1) {
      const f = entry.fields[i];
      let rawVal;
      if (inputValues && Object.hasOwn(inputValues, f.name)) {
        rawVal = inputValues[f.name];
      } else if (i === 0 && value !== undefined && value !== null) {
        rawVal = value;
      } else {
        rawVal = f.value ?? "";
      }
      const str = rawVal === undefined || rawVal === null ? "" : String(rawVal);
      const finalVal = f.type === "password" ? str : str.trim();
      if (f.required && !finalVal.trim()) {
        throw Object.assign(new Error(`请填写「${f.label}」`), {
          status: 400,
          code: "missing_field",
        });
      }
      normalizedValues[f.name] = finalVal;
    }

    this.#pending.delete(key);
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.status = "submitted";
    this.#killNativeHud(entry);

    const safeActor = String(submittedBy || "web").trim() || "web";
    this.#emit("human_verify_resolved", {
      id: key,
      status: "submitted",
      submittedBy: safeActor,
    });

    const primaryField = entry.fields[0]?.name || "code";
    entry.resolveWait({
      ok: true,
      id: key,
      status: "submitted",
      value: normalizedValues[primaryField] ?? "",
      values: normalizedValues,
      meta: { ...entry.meta },
      submittedBy: safeActor,
    });

    return { ok: true, id: key, status: "submitted" };
  }

  cancel(id, { reason = "cancelled", submittedBy = "" } = {}) {
    const key = String(id || "").trim();
    const entry = this.#pending.get(key);
    if (!entry) {
      return { ok: false, id: key, status: "not_found" };
    }

    this.#pending.delete(key);
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    const finalStatus = String(reason || "cancelled").trim() || "cancelled";
    entry.status = finalStatus;
    this.#killNativeHud(entry);

    const safeActor = String(submittedBy || "").trim();
    this.#emit("human_verify_resolved", {
      id: key,
      status: finalStatus,
      ...(safeActor ? { submittedBy: safeActor } : {}),
    });

    entry.resolveWait({
      ok: false,
      id: key,
      status: finalStatus,
      meta: { ...entry.meta },
      ...(safeActor ? { submittedBy: safeActor } : {}),
    });

    return { ok: true, id: key, status: finalStatus };
  }

  close() {
    for (const id of [...this.#pending.keys()]) {
      this.cancel(id, { reason: "closed" });
    }
  }
}
