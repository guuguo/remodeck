import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const STATE_FILENAME = "automation-scheduler.json";
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const MIN_RETRIGGER_GAP_MS = 60_000;
const RRULE_WEEKDAYS = Object.freeze({
  SU: 0,
  MO: 1,
  TU: 2,
  WE: 3,
  TH: 4,
  FR: 5,
  SA: 6,
});
const WEEKDAY_LABELS = Object.freeze({
  SU: "周日",
  MO: "周一",
  TU: "周二",
  WE: "周三",
  TH: "周四",
  FR: "周五",
  SA: "周六",
});
const ARCHIVED_THREAD_ERROR_RE = /\bis archived\b|codex unarchive\b|已在 Codex 中归档|先解除归档/i;

function isArchivedThreadError(error) {
  if (!error) return false;
  if (String(error?.code || "") === "thread_archived") return true;
  return ARCHIVED_THREAD_ERROR_RE.test(String(error?.message || error || ""));
}

function extractRawThreadId(compositeOrRawId = "", provider = "", profileId = "") {
  const id = String(compositeOrRawId || "").trim();
  if (!id) return "";
  const prefix = `${provider}:${profileId}:`;
  if (provider && profileId && id.startsWith(prefix)) {
    return id.slice(prefix.length);
  }
  const parts = id.split(":");
  return parts.length >= 3 ? parts.slice(2).join(":") : id;
}

function toEpochMs(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1e12 ? Math.floor(n) : Math.floor(n * 1000);
}

function unquoteTomlString(raw = "") {
  const s = String(raw || "").trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1).replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
  }
  return s;
}

function parseTomlStringArray(raw = "") {
  const s = String(raw || "").trim();
  if (!s.startsWith("[") || !s.endsWith("]")) return [];
  const items = [];
  for (const m of s.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)) {
    const val = (m[1] ?? m[2] ?? "").replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
    if (val) items.push(val);
  }
  return items;
}

export function parseCodexAutomationToml(content = "") {
  const data = {};
  for (const line of String(content || "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("[")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const rawVal = trimmed.slice(eqIdx + 1).trim();
    if (!key) continue;
    if (key === "cwds") {
      data.cwds = parseTomlStringArray(rawVal);
    } else if (/^\d+$/.test(rawVal)) {
      data[key] = Number(rawVal);
    } else {
      data[key] = unquoteTomlString(rawVal);
    }
  }
  return data;
}

export function parseRrule(raw = "") {
  const clean = String(raw || "").trim().replace(/^RRULE:/i, "");
  if (!clean) return null;
  const parts = {};
  for (const seg of clean.split(";")) {
    const eq = seg.indexOf("=");
    if (eq <= 0) continue;
    const k = seg.slice(0, eq).trim().toUpperCase();
    const v = seg.slice(eq + 1).trim().toUpperCase();
    if (k && v) parts[k] = v;
  }
  const freq = parts.FREQ || "";
  if (!freq) return null;
  const interval = Math.max(1, Number.parseInt(parts.INTERVAL || "1", 10) || 1);
  const parseTimeField = (value, max) => {
    const values = [...new Set((value || "").split(",")
      .map((item) => Number.parseInt(item, 10))
      .filter(Number.isFinite)
      .map((item) => Math.max(0, Math.min(max, item))))].sort((a, b) => a - b);
    return values.length > 1 ? values : values[0] ?? null;
  };
  const byMinute = parseTimeField(parts.BYMINUTE, 59);
  const byHour = parseTimeField(parts.BYHOUR, 23);
  const count = parts.COUNT !== undefined ? Number.parseInt(parts.COUNT, 10) : null;
  const byDay = parts.BYDAY
    ? parts.BYDAY.split(",").map((d) => d.trim()).filter((d) => Object.hasOwn(RRULE_WEEKDAYS, d))
    : [];
  return {
    freq,
    interval,
    byMinute,
    byHour,
    byDay,
    count: Number.isFinite(count) && count > 0 ? count : null,
  };
}

export function formatRruleHuman(raw = "") {
  const parsed = parseRrule(raw);
  if (!parsed) return raw ? String(raw) : "手动触发";
  if (Array.isArray(parsed.byMinute) || Array.isArray(parsed.byHour)) return String(raw);
  const pad2 = (n) => String(n).padStart(2, "0");
  if (parsed.freq === "MINUTELY") {
    return `每 ${parsed.interval} 分钟`;
  }
  if (parsed.freq === "HOURLY") {
    const minText = parsed.byMinute !== null && parsed.interval === 1 ? `:${pad2(parsed.byMinute)}` : "";
    return parsed.interval === 1 ? `每小时${minText ? ` (${minText})` : ""}` : `每 ${parsed.interval} 小时`;
  }
  if (parsed.freq === "DAILY") {
    const timeText = parsed.byHour !== null
      ? ` ${pad2(parsed.byHour)}:${pad2(parsed.byMinute ?? 0)}`
      : "";
    return parsed.interval === 1 ? `每天${timeText}` : `每 ${parsed.interval} 天${timeText}`;
  }
  if (parsed.freq === "WEEKLY") {
    const days = parsed.byDay.length
      ? parsed.byDay.map((d) => WEEKDAY_LABELS[d] || d).join("、")
      : "每周";
    const timeText = parsed.byHour !== null
      ? ` ${pad2(parsed.byHour)}:${pad2(parsed.byMinute ?? 0)}`
      : "";
    return `${days}${timeText}${parsed.count === 1 ? " (单次)" : ""}`;
  }
  return String(raw || "");
}

export function computeNextRunAtMs(rawRrule = "", {
  lastRunAtMs = 0,
  createdAtMs = 0,
  nowMs = Date.now(),
} = {}) {
  const parsed = parseRrule(rawRrule);
  if (!parsed) return 0;
  if (parsed.count === 1 && lastRunAtMs > 0) return 0;

  const anchorMs = Math.max(Number(lastRunAtMs) || 0, Number(createdAtMs) || 0);
  if (parsed.freq === "MINUTELY") {
    const stepMs = parsed.interval * 60_000;
    if (anchorMs <= 0) return nowMs;
    return anchorMs + stepMs;
  }

  if (parsed.freq === "HOURLY") {
    const stepMs = parsed.interval * 3_600_000;
    const base = anchorMs > 0 ? anchorMs : nowMs - stepMs;
    const d = new Date(base);
    if (parsed.byMinute !== null) {
      const minutes = [parsed.byMinute].flat();
      for (const minute of minutes) {
        d.setMinutes(minute, 0, 0);
        if (d.getTime() > base) return d.getTime();
      }
      d.setMinutes(minutes[0], 0, 0);
      return d.getTime() + stepMs;
    }
    return base + stepMs;
  }

  if (parsed.freq === "DAILY" || parsed.freq === "WEEKLY") {
    const daily = parsed.freq === "DAILY";
    const base = anchorMs > 0 ? anchorMs : nowMs - (daily ? 86_400_000 : 60_000);
    const start = new Date(base);
    const hours = [parsed.byHour ?? start.getHours()].flat();
    const minutes = [parsed.byMinute ?? 0].flat();
    const nextOnDate = (offset) => {
      const date = new Date(start);
      if (offset) date.setDate(date.getDate() + offset);
      let next = Infinity;
      for (const hour of hours) {
        for (const minute of minutes) {
          const candidate = new Date(date).setHours(hour, minute, 0, 0);
          if (candidate > base) next = Math.min(next, candidate);
        }
      }
      return Number.isFinite(next) ? next : 0;
    };
    if (daily) return nextOnDate(0) || nextOnDate(parsed.interval);

    const allowedDays = parsed.byDay.length
      ? new Set(parsed.byDay.map((d) => RRULE_WEEKDAYS[d]))
      : new Set([start.getDay()]);
    for (let offset = 0; offset <= 14; offset += 1) {
      if (!allowedDays.has((start.getDay() + offset) % 7)) continue;
      const next = nextOnDate(offset);
      if (next) return next;
    }
  }
  return 0;
}

function readCodexAutomationsFromSqlite(codexHome) {
  const out = new Map();
  for (const filename of ["codex.db", "codex-dev.db"]) {
    const dbPath = resolve(codexHome, "sqlite", filename);
    if (!existsSync(dbPath)) continue;
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      const tableCheck = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='automations'",
      ).get();
      if (!tableCheck) continue;
      const rows = db.prepare(`
        SELECT id, name, prompt, status, next_run_at, last_run_at, cwds, rrule,
               model, reasoning_effort, kind, target_thread_id, created_at, updated_at
        FROM automations
      `).all();
      for (const row of rows) {
        const id = String(row?.id || "").trim();
        if (!id) continue;
        let cwds = [];
        try {
          const parsedCwds = JSON.parse(String(row.cwds || "[]"));
          if (Array.isArray(parsedCwds)) cwds = parsedCwds.filter(Boolean).map(String);
        } catch {}
        const prev = out.get(id);
        const updatedAtMs = toEpochMs(row.updated_at);
        if (prev && prev.updatedAtMs >= updatedAtMs) continue;
        out.set(id, {
          id,
          name: String(row.name || id),
          prompt: String(row.prompt || ""),
          status: String(row.status || "ACTIVE").toUpperCase(),
          nextRunAtMs: toEpochMs(row.next_run_at),
          lastRunAtMs: toEpochMs(row.last_run_at),
          cwds,
          rrule: String(row.rrule || ""),
          model: String(row.model || ""),
          reasoningEffort: String(row.reasoning_effort || ""),
          kind: String(row.kind || "cron"),
          targetThreadId: String(row.target_thread_id || ""),
          createdAtMs: toEpochMs(row.created_at),
          updatedAtMs,
        });
      }
    } catch {
      // Ignore unreadable or locked SQLite files cleanly.
    } finally {
      try { db?.close(); } catch {}
    }
  }
  return out;
}

export function discoverCodexAutomations(profile) {
  const codexHome = String(profile?.home || "").trim();
  if (!codexHome || !existsSync(codexHome)) return [];
  const merged = readCodexAutomationsFromSqlite(codexHome);
  const autoRoot = resolve(codexHome, "automations");
  if (existsSync(autoRoot)) {
    try {
      for (const entry of readdirSync(autoRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const tomlPath = resolve(autoRoot, entry.name, "automation.toml");
        if (!existsSync(tomlPath)) continue;
        try {
          const parsed = parseCodexAutomationToml(readFileSync(tomlPath, "utf8"));
          const id = String(parsed.id || entry.name).trim();
          if (!id) continue;
          const existing = merged.get(id);
          if (existing) {
            if (!existing.prompt && parsed.prompt) existing.prompt = parsed.prompt;
            if (!existing.cwds?.length && Array.isArray(parsed.cwds)) existing.cwds = parsed.cwds;
            if (!existing.rrule && parsed.rrule) existing.rrule = parsed.rrule;
            if (!existing.targetThreadId && parsed.target_thread_id) existing.targetThreadId = parsed.target_thread_id;
          } else {
            merged.set(id, {
              id,
              name: String(parsed.name || id),
              prompt: String(parsed.prompt || ""),
              status: String(parsed.status || "ACTIVE").toUpperCase(),
              nextRunAtMs: 0,
              lastRunAtMs: 0,
              cwds: Array.isArray(parsed.cwds) ? parsed.cwds : [],
              rrule: String(parsed.rrule || ""),
              model: String(parsed.model || ""),
              reasoningEffort: String(parsed.reasoning_effort || ""),
              kind: String(parsed.kind || "cron"),
              targetThreadId: String(parsed.target_thread_id || ""),
              createdAtMs: toEpochMs(parsed.created_at),
              updatedAtMs: toEpochMs(parsed.updated_at),
            });
          }
        } catch {}
      }
    } catch {}
  }

  return [...merged.values()].map((item) => ({
    ...item,
    taskKey: `codex:${profile.id}:${item.id}`,
    source: "codex-native",
    provider: "codex",
    profileId: profile.id,
    profileLabel: profile.label || `Codex · ${profile.id}`,
  }));
}

function parseSkillFrontmatter(content = "") {
  const match = String(content || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: String(content || "").trim() };
  const meta = {};
  for (const line of match[1].split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const k = line.slice(0, colon).trim();
    const v = line.slice(colon + 1).trim();
    if (k && v) meta[k] = v;
  }
  return { meta, body: match[2].trim() };
}

export function discoverClaudeScheduledTasks(profile) {
  const configDir = String(profile?.home || "").trim();
  if (!configDir) return [];
  const schedRoot = resolve(configDir, "scheduled-tasks");
  if (!existsSync(schedRoot)) return [];
  const items = [];
  try {
    for (const entry of readdirSync(schedRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillPath = resolve(schedRoot, entry.name, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      try {
        const { meta, body } = parseSkillFrontmatter(readFileSync(skillPath, "utf8"));
        const id = String(meta.name || entry.name).trim();
        items.push({
          id,
          taskKey: `claude:${profile.id}:${id}`,
          source: "claude-native",
          provider: "claude",
          profileId: profile.id,
          profileLabel: profile.label || `Claude · ${profile.id}`,
          name: meta.description || id,
          prompt: body || meta.description || id,
          status: "PAUSED",
          nextRunAtMs: 0,
          lastRunAtMs: 0,
          cwds: [],
          rrule: "",
          model: "",
          reasoningEffort: "",
          kind: "scheduled-skill",
          targetThreadId: "",
          createdAtMs: 0,
          updatedAtMs: 0,
        });
      } catch {}
    }
  } catch {}
  return items;
}

export class AutomationScheduler {
  #hub;
  #dataDir;
  #statePath;
  #pollIntervalMs;
  #onEvent;
  #state = {
    enabled: true,
    overrides: {},
    customTasks: [],
    hiddenTaskKeys: [],
  };
  #timer = null;
  #tickPromise = null;
  #inFlightKeys = new Set();
  #closed = false;

  constructor({
    hub,
    dataDir,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    onEvent = null,
  } = {}) {
    this.#hub = hub;
    this.#dataDir = dataDir;
    this.#statePath = resolve(dataDir, STATE_FILENAME);
    this.#pollIntervalMs = Math.max(100, Number(pollIntervalMs) || DEFAULT_POLL_INTERVAL_MS);
    this.#onEvent = typeof onEvent === "function" ? onEvent : null;
  }

  async load() {
    try {
      const raw = await readFile(this.#statePath, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") {
        this.#state = {
          enabled: parsed.enabled !== false,
          overrides: parsed.overrides && typeof parsed.overrides === "object" ? parsed.overrides : {},
          customTasks: Array.isArray(parsed.customTasks) ? parsed.customTasks : [],
          hiddenTaskKeys: Array.isArray(parsed.hiddenTaskKeys) ? parsed.hiddenTaskKeys.filter(Boolean) : [],
        };
      }
    } catch {
      // Fresh state file on first boot.
    }
  }

  async #saveState() {
    try {
      await mkdir(dirname(this.#statePath), { recursive: true });
      await writeFile(this.#statePath, JSON.stringify(this.#state, null, 2), "utf8");
    } catch {}
  }

  #emit(eventName, payload) {
    if (typeof this.#onEvent === "function") {
      try {
        this.#onEvent(eventName, payload);
      } catch {}
    }
  }

  start() {
    if (this.#closed || this.#timer) return;
    this.#timer = setInterval(() => {
      void this.tick().catch(() => {});
    }, this.#pollIntervalMs);
    this.#timer.unref?.();
  }

  close() {
    this.#closed = true;
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  async listTasks({ nowMs = Date.now() } = {}) {
    const payload = await this.#hub.listProvidersAndProfiles?.().catch(() => null);
    const profiles = Array.isArray(payload?.profiles) ? payload.profiles : [];
    const seenCodexHomes = new Set();
    const seenClaudeHomes = new Set();
    const rawTasks = [];

    for (const profile of profiles) {
      if (!profile || profile.installed === false) continue;
      const homeKey = String(profile.home || "");
      if (profile.provider === "codex" && homeKey && !seenCodexHomes.has(homeKey)) {
        seenCodexHomes.add(homeKey);
        rawTasks.push(...discoverCodexAutomations(profile));
      } else if (profile.provider === "claude" && homeKey && !seenClaudeHomes.has(homeKey)) {
        seenClaudeHomes.add(homeKey);
        rawTasks.push(...discoverClaudeScheduledTasks(profile));
      }
    }

    const profileLabelMap = new Map();
    for (const profile of profiles) {
      if (!profile?.provider || !profile?.id) continue;
      profileLabelMap.set(`${profile.provider}:${profile.id}`, profile.label || profile.id);
    }

    for (const custom of this.#state.customTasks) {
      if (!custom?.id) continue;
      const customProvider = custom.provider || "codex";
      const customProfileId = custom.profileId || "default";
      const resolvedProfileLabel = profileLabelMap.get(`${customProvider}:${customProfileId}`)
        || custom.profileLabel
        || customProvider
        || "自定义";
      rawTasks.push({
        id: custom.id,
        taskKey: `custom:${customProvider}:${custom.id}`,
        source: "agent-control",
        provider: customProvider,
        profileId: customProfileId,
        profileLabel: resolvedProfileLabel,
        name: custom.name || custom.id,
        prompt: custom.prompt || "",
        status: custom.status === "PAUSED" ? "PAUSED" : "ACTIVE",
        nextRunAtMs: 0,
        lastRunAtMs: 0,
        cwds: custom.cwd ? [custom.cwd] : [],
        rrule: custom.rrule || "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
        model: custom.model || "",
        reasoningEffort: custom.reasoningEffort || "",
        kind: "cron",
        targetThreadId: custom.targetThreadId || "",
        createdAtMs: Number(custom.createdAtMs) || 0,
        updatedAtMs: Number(custom.updatedAtMs) || 0,
      });
    }

    const hiddenSet = new Set(Array.isArray(this.#state.hiddenTaskKeys) ? this.#state.hiddenTaskKeys : []);
    return rawTasks.filter((task) => !hiddenSet.has(task.taskKey)).map((task) => {
      const ov = this.#state.overrides?.[task.taskKey] || {};
      const defaultManaged = task.status === "ACTIVE";
      const managed = typeof ov.managed === "boolean" ? ov.managed : defaultManaged;
      const effectiveLastRunAtMs = Math.max(Number(task.lastRunAtMs) || 0, Number(ov.lastTriggeredAtMs) || 0);
      const computedNextMs = task.rrule
        ? computeNextRunAtMs(task.rrule, {
            lastRunAtMs: effectiveLastRunAtMs,
            createdAtMs: task.createdAtMs,
            nowMs,
          })
        : 0;
      const rawNextMs = Number(task.nextRunAtMs) || 0;
      const nextRunAtMs = rawNextMs > effectiveLastRunAtMs
        ? rawNextMs
        : computedNextMs;

      return {
        ...task,
        targetThreadId: ov.targetThreadId || task.targetThreadId || "",
        managed,
        running: this.#inFlightKeys.has(task.taskKey),
        scheduleLabel: formatRruleHuman(task.rrule),
        effectiveLastRunAtMs,
        nextRunAtMs,
        lastTriggeredAtMs: Number(ov.lastTriggeredAtMs) || 0,
        lastStatus: ov.lastStatus || "",
        lastError: ov.lastError || "",
        lastThreadId: ov.lastThreadId || "",
        runCount: Number(ov.runCount) || 0,
      };
    }).sort((a, b) => {
      if (a.managed !== b.managed) return a.managed ? -1 : 1;
      if (a.status !== b.status) return a.status === "ACTIVE" ? -1 : 1;
      return (a.nextRunAtMs || Number.MAX_SAFE_INTEGER) - (b.nextRunAtMs || Number.MAX_SAFE_INTEGER);
    });
  }

  async getSnapshot({ nowMs = Date.now() } = {}) {
    const tasks = await this.listTasks({ nowMs });
    return {
      enabled: this.#state.enabled !== false,
      tasks,
      summary: {
        total: tasks.length,
        managedCount: tasks.filter((t) => t.managed).length,
        activeCount: tasks.filter((t) => t.status === "ACTIVE").length,
        runningCount: tasks.filter((t) => t.running).length,
      },
    };
  }

  async configure({ enabled = undefined, taskKey = "", managed = undefined } = {}) {
    if (typeof enabled === "boolean") {
      this.#state.enabled = enabled;
    }
    const cleanKey = String(taskKey || "").trim();
    if (cleanKey && typeof managed === "boolean") {
      this.#state.overrides[cleanKey] = {
        ...(this.#state.overrides[cleanKey] || {}),
        managed,
      };
    }
    await this.#saveState();
    const snap = await this.getSnapshot();
    this.#emit("automation_status", snap);
    return snap;
  }

  async saveCustomTask({
    action = "create",
    id = "",
    name = "",
    provider = "codex",
    profileId = "default",
    cwd = "",
    prompt = "",
    rrule = "FREQ=DAILY;BYHOUR=9;BYMINUTE=0",
    model = "",
    reasoningEffort = "",
  } = {}) {
    if (action === "delete") {
      const cleanId = String(id || "").trim();
      this.#state.customTasks = this.#state.customTasks.filter((t) => t.id !== cleanId && `custom:${t.provider || "codex"}:${t.id}` !== cleanId);
      await this.#saveState();
      const snap = await this.getSnapshot();
      this.#emit("automation_status", snap);
      return snap;
    }

    const cleanPrompt = String(prompt || "").trim();
    if (!cleanPrompt) {
      throw Object.assign(new Error("定时任务指令不能为空"), { status: 400 });
    }
    const nowMs = Date.now();
    const taskId = String(id || "").trim() || `ac-${nowMs.toString(36)}`;
    const existing = this.#state.customTasks.find((t) => t.id === taskId);
    const nextProvider = String(provider || "codex").trim();
    const nextProfileId = String(profileId || "default").trim();
    const record = {
      id: taskId,
      name: String(name || "").trim() || cleanPrompt.slice(0, 28),
      provider: nextProvider,
      profileId: nextProfileId,
      cwd: String(cwd || "").trim() || os.homedir(),
      prompt: cleanPrompt,
      rrule: String(rrule || "FREQ=DAILY;BYHOUR=9;BYMINUTE=0").trim(),
      model: String(model || "").trim(),
      reasoningEffort: String(reasoningEffort || "").trim(),
      status: existing?.status === "PAUSED" ? "PAUSED" : "ACTIVE",
      createdAtMs: Number(existing?.createdAtMs) || nowMs,
      updatedAtMs: nowMs,
    };
    if (existing) {
      const oldKey = `custom:${existing.provider || "codex"}:${existing.id}`;
      const newKey = `custom:${nextProvider}:${taskId}`;
      const oldOv = this.#state.overrides?.[oldKey];
      const providerOrProfileChanged = (existing.provider || "codex") !== nextProvider
        || (existing.profileId || "default") !== nextProfileId;
      if (oldKey !== newKey && oldOv) {
        const { targetThreadId: _dropTarget, lastThreadId: _dropLast, ...restOv } = oldOv;
        this.#state.overrides[newKey] = {
          ...restOv,
          ...(this.#state.overrides[newKey] || {}),
        };
        delete this.#state.overrides[oldKey];
      } else if (providerOrProfileChanged && this.#state.overrides?.[newKey]?.targetThreadId) {
        delete this.#state.overrides[newKey].targetThreadId;
      }
    }
    this.#state.customTasks = [
      record,
      ...this.#state.customTasks.filter((t) => t.id !== taskId),
    ];
    await this.#saveState();
    const snap = await this.getSnapshot();
    this.#emit("automation_status", snap);
    return snap;
  }

  async deleteTask(taskKeyOrId = "") {
    const clean = String(taskKeyOrId || "").trim();
    if (!clean) {
      throw Object.assign(new Error("taskKey 不能为空"), { status: 400 });
    }
    const beforeLen = this.#state.customTasks.length;
    this.#state.customTasks = this.#state.customTasks.filter(
      (t) => t.id !== clean && `custom:${t.provider || "codex"}:${t.id}` !== clean,
    );
    const removedCustom = this.#state.customTasks.length !== beforeLen;
    if (!removedCustom) {
      const hidden = new Set(Array.isArray(this.#state.hiddenTaskKeys) ? this.#state.hiddenTaskKeys : []);
      hidden.add(clean);
      this.#state.hiddenTaskKeys = [...hidden];
    }
    if (this.#state.overrides && Object.hasOwn(this.#state.overrides, clean)) {
      delete this.#state.overrides[clean];
    }
    await this.#saveState();
    const snap = await this.getSnapshot();
    this.#emit("automation_status", snap);
    return snap;
  }

  async #executeTask(task, { reason = "scheduled", nowMs = Date.now() } = {}) {
    if (!task || this.#inFlightKeys.has(task.taskKey)) {
      return { ok: false, skipped: true, reason: "already_running" };
    }
    this.#inFlightKeys.add(task.taskKey);
    const prevOv = this.#state.overrides[task.taskKey] || {};
    try {
      let threadId = "";
      let fallbackCwd = "";
      let unarchivedTarget = false;
      let fallbackNewThread = false;
      const promptText = task.kind === "heartbeat" && task.provider === "codex" && task.targetThreadId
        ? `<heartbeat>\n  <automation_id>${task.id}</automation_id>\n  <current_time_iso>${new Date(nowMs).toISOString()}</current_time_iso>\n  <instructions>\n${task.prompt}\n  </instructions>\n</heartbeat>`
        : task.prompt;

      if (task.targetThreadId) {
        const compositeId = `${task.provider}:${task.profileId}:${task.targetThreadId}`;
        const existing = await this.#hub.readThread?.(compositeId, { limit: 2 }).catch(() => null);
        fallbackCwd = existing?.thread?.cwd || "";
        if (existing?.thread?.live) {
          return { ok: false, skipped: true, reason: "target_thread_busy" };
        }
        if (existing?.thread) {
          let unarchiveAttempted = false;
          const tryUnarchive = async () => {
            unarchiveAttempted = true;
            if (typeof this.#hub.archiveThread !== "function") return false;
            try {
              await this.#hub.archiveThread(compositeId, false);
              unarchivedTarget = true;
              return true;
            } catch {
              return false;
            }
          };
          const sendToTarget = () => this.#hub.sendTurn({
            threadId: compositeId,
            text: promptText,
            ...(task.model ? { model: task.model } : {}),
            ...(task.reasoningEffort ? { effort: task.reasoningEffort } : {}),
            permissionMode: "turbo",
          });

          let canSendToTarget = true;
          if (existing.thread.archived) {
            canSendToTarget = await tryUnarchive();
          }
          if (canSendToTarget) {
            try {
              const res = await sendToTarget();
              threadId = res?.thread?.id || compositeId;
            } catch (sendErr) {
              if (!isArchivedThreadError(sendErr)) throw sendErr;
              if (!unarchiveAttempted && await tryUnarchive()) {
                try {
                  const retryRes = await sendToTarget();
                  threadId = retryRes?.thread?.id || compositeId;
                } catch (retryErr) {
                  if (!isArchivedThreadError(retryErr)) throw retryErr;
                }
              }
            }
          }
        }
      }

      if (!threadId) {
        fallbackNewThread = Boolean(task.targetThreadId);
        const rawCwd = task.cwds?.find((p) => p && existsSync(p))
          || (fallbackCwd && existsSync(fallbackCwd) ? fallbackCwd : "")
          || task.cwds?.[0]
          || os.homedir();
        const resolvedCwd = existsSync(rawCwd) ? rawCwd : os.homedir();
        const res = await this.#hub.startThread({
          provider: task.provider || "codex",
          profileId: task.profileId || "default",
          cwd: resolvedCwd,
          ...(task.model ? { model: task.model } : {}),
          ...(task.reasoningEffort ? { effort: task.reasoningEffort } : {}),
          text: promptText,
          permissionMode: "turbo",
        });
        threadId = res?.thread?.id || "";
      }

      const nextTargetRawId = fallbackNewThread && threadId
        ? extractRawThreadId(threadId, task.provider || "codex", task.profileId || "default")
        : "";
      this.#state.overrides[task.taskKey] = {
        ...prevOv,
        ...(nextTargetRawId ? { targetThreadId: nextTargetRawId } : {}),
        lastTriggeredAtMs: nowMs,
        lastStatus: "triggered",
        lastError: "",
        lastThreadId: threadId,
        runCount: (Number(prevOv.runCount) || 0) + 1,
      };
      await this.#saveState();
      const eventPayload = {
        taskKey: task.taskKey,
        name: task.name,
        provider: task.provider,
        threadId,
        unarchived: unarchivedTarget,
        fallbackNewThread,
        reason,
        triggeredAtMs: nowMs,
      };
      this.#emit("automation_run", eventPayload);
      return {
        ok: true,
        threadId,
        taskKey: task.taskKey,
        unarchived: unarchivedTarget,
        fallbackNewThread,
      };
    } catch (error) {
      this.#state.overrides[task.taskKey] = {
        ...prevOv,
        lastTriggeredAtMs: nowMs,
        lastStatus: "error",
        lastError: error?.message || "定时唤起失败",
      };
      await this.#saveState();
      this.#emit("automation_run", {
        taskKey: task.taskKey,
        name: task.name,
        provider: task.provider,
        error: error?.message || "定时唤起失败",
        reason,
        triggeredAtMs: nowMs,
      });
      throw error;
    } finally {
      this.#inFlightKeys.delete(task.taskKey);
    }
  }

  async runNow(taskKey, { nowMs = Date.now() } = {}) {
    const cleanKey = String(taskKey || "").trim();
    const tasks = await this.listTasks({ nowMs });
    const target = tasks.find((t) => t.taskKey === cleanKey || t.id === cleanKey);
    if (!target) {
      throw Object.assign(new Error("未找到指定定时任务"), { status: 404 });
    }
    const result = await this.#executeTask(target, { reason: "manual", nowMs });
    const snapshot = await this.getSnapshot({ nowMs });
    return { ...result, snapshot };
  }

  async tick({ nowMs = Date.now() } = {}) {
    if (this.#closed || this.#state.enabled === false) return { ran: [], skipped: [] };
    if (this.#tickPromise) return this.#tickPromise;

    this.#tickPromise = (async () => {
      const ran = [];
      const skipped = [];
      const tasks = await this.listTasks({ nowMs });
      for (const task of tasks) {
        if (!task.managed || !task.prompt) continue;
        if (!task.nextRunAtMs || nowMs < task.nextRunAtMs) continue;
        if (task.lastRunAtMs >= task.nextRunAtMs - MIN_RETRIGGER_GAP_MS) {
          // Upstream desktop app already executed this due window; advance internal marker cleanly.
          const prevOv = this.#state.overrides[task.taskKey] || {};
          if ((Number(prevOv.lastTriggeredAtMs) || 0) < task.lastRunAtMs) {
            this.#state.overrides[task.taskKey] = {
              ...prevOv,
              lastTriggeredAtMs: task.lastRunAtMs,
              lastStatus: prevOv.lastStatus || "native_ran",
            };
            await this.#saveState();
          }
          skipped.push({ taskKey: task.taskKey, reason: "native_already_ran" });
          continue;
        }
        if (task.lastTriggeredAtMs && nowMs - task.lastTriggeredAtMs < MIN_RETRIGGER_GAP_MS) {
          skipped.push({ taskKey: task.taskKey, reason: "cooldown" });
          continue;
        }
        try {
          const res = await this.#executeTask(task, { reason: "scheduled", nowMs });
          if (res.ok) ran.push(res);
          else skipped.push({ taskKey: task.taskKey, reason: res.reason || "skipped" });
        } catch (error) {
          skipped.push({ taskKey: task.taskKey, reason: error?.message || "error" });
        }
      }
      return { ran, skipped };
    })().finally(() => {
      this.#tickPromise = null;
    });

    return this.#tickPromise;
  }
}
