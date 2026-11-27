// Cross-engine memory vault: an Obsidian-compatible Markdown folder shared by
// Codex / Claude Code / Antigravity. Frontmatter and tables are machine-parsed,
// prose stays human-first. Machine-only artifacts live under `.ac/` (hidden
// from Obsidian) and are not meant to be read by people.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

export const MEMORY_CONFIG_FILE = "memory.json";
export const PROJECTS_DIR = "项目";
export const AREAS_DIR = "领域";
export const ME_DIR = "我";
export const INBOX_DIR = "收件箱";
export const CONFLICTS_FILE = `${INBOX_DIR}/待裁决.md`;
export const MACHINE_DIR = ".ac";
export const STALE_FACT_DAYS = 60;
export const IDLE_WIP_DAYS = 7;

const FACT_HEADERS = ["键", "值", "确认", "来源"];
const HISTORY_HEADERS = ["键", "旧值", "旧来源", "取代于", "新值"];
const CONFLICT_HEADERS = ["日期", "归属", "键", "现值", "新值", "状态"];
const WIP_SECTIONS = ["目标", "当前状态", "下一步", "暂定（未定稿，勿当事实）", "中间产物", "日志"];
const SOURCE_RANK = { code: 3, user: 2, agent: 1 };
const SYNC_CONFLICT_RE = /sync-conflict|conflicted copy|冲突副本/i;

export function today(now = new Date()) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function expandHome(p) {
  const s = String(p || "").trim();
  return s.startsWith("~/") ? join(os.homedir(), s.slice(2)) : s;
}

export async function readMemoryConfig(dataDir) {
  if (!dataDir) return {};
  try {
    return JSON.parse(await readFile(join(dataDir, MEMORY_CONFIG_FILE), "utf8")) || {};
  } catch {
    return {};
  }
}

export async function writeMemoryConfig(dataDir, patch = {}) {
  const next = { ...(await readMemoryConfig(dataDir)), ...patch };
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, MEMORY_CONFIG_FILE), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

// Vault is opt-in: env wins, then `<dataDir>/memory.json`; empty means disabled.
export async function resolveVaultPath({ env = process.env, dataDir = "" } = {}) {
  const fromEnv = expandHome(env?.AC_MEMORY_VAULT);
  if (fromEnv) return resolve(fromEnv);
  const cfg = await readMemoryConfig(dataDir);
  const fromCfg = expandHome(cfg.vaultPath);
  return fromCfg ? resolve(fromCfg) : "";
}

export function defaultVaultPath(dataDir = "") {
  const clean = String(dataDir || "").trim();
  return clean ? resolve(clean, "memory") : "";
}

export async function resolveEffectiveVaultPath({ env = process.env, dataDir = "", enabled = true } = {}) {
  if (!enabled) return "";
  const explicit = await resolveVaultPath({ env, dataDir });
  if (explicit) return explicit;
  return defaultVaultPath(dataDir);
}

// ---------- frontmatter (small YAML subset: scalars, inline lists, dash lists) ----------

function parseScalar(raw) {
  const v = String(raw).trim();
  if (/^\[.*\]$/.test(v)) {
    return v.slice(1, -1).split(",").map((x) => unquote(x.trim())).filter(Boolean);
  }
  return unquote(v);
}

function unquote(v) {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

export function parseNote(raw = "") {
  const text = String(raw).replace(/\r\n/g, "\n");
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let listKey = "";
  for (const line of m[1].split("\n")) {
    const item = line.match(/^\s+-\s+(.*)$/);
    if (item && listKey) {
      meta[listKey].push(unquote(item[1].trim()));
      continue;
    }
    const kv = line.match(/^([A-Za-z0-9_\-一-鿿]+):\s*(.*)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    const cleaned = value.replace(/\s+#.*$/, "");
    if (cleaned === "") {
      meta[key] = [];
      listKey = key;
    } else {
      meta[key] = parseScalar(cleaned);
      listKey = "";
    }
  }
  return { meta, body: text.slice(m[0].length).replace(/^\n+/, "") };
}

function quoteIfNeeded(v) {
  const s = String(v ?? "");
  return /^[\s\-?:,[\]{}#&*!|>'"%@`]|:\s|\s#|^$/.test(s) ? JSON.stringify(s) : s;
}

export function renderNote(meta = {}, body = "") {
  const lines = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      lines.push(`${k}: [${v.map((x) => quoteIfNeeded(x).replace(/,/g, "，")).join(", ")}]`);
    } else {
      lines.push(`${k}: ${quoteIfNeeded(v)}`);
    }
  }
  const cleanBody = String(body || "").replace(/^\n+/, "");
  return `---\n${lines.join("\n")}\n---\n\n${cleanBody.replace(/\n*$/, "\n")}`;
}

// ---------- sections and tables ----------

function findSection(body, heading) {
  const lines = body.split("\n");
  const start = lines.findIndex((l) => /^##\s+/.test(l) && l.replace(/^##\s+/, "").trim() === heading);
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^#{1,2}\s+/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { lines, start, end, content: lines.slice(start + 1, end).join("\n").trim() };
}

export function getSection(body, heading) {
  return findSection(body, heading)?.content ?? "";
}

export function setSection(body, heading, content) {
  const found = findSection(body, heading);
  const block = [`## ${heading}`, "", String(content || "").trim(), ""];
  if (!found) {
    return `${body.replace(/\n*$/, "")}\n\n${block.join("\n")}`;
  }
  const { lines, start, end } = found;
  return [...lines.slice(0, start), ...block, ...lines.slice(end)].join("\n").replace(/\n{3,}/g, "\n\n");
}

function cell(v) {
  return String(v ?? "").replace(/\r?\n+/g, " ").replace(/\|/g, "\\|").trim();
}

function splitRow(line) {
  const inner = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  const cells = [];
  let cur = "";
  for (let i = 0; i < inner.length; i += 1) {
    if (inner[i] === "\\" && inner[i + 1] === "|") {
      cur += "|";
      i += 1;
    } else if (inner[i] === "|") {
      cells.push(cur.trim());
      cur = "";
    } else {
      cur += inner[i];
    }
  }
  cells.push(cur.trim());
  return cells;
}

export function parseTable(text = "") {
  const lines = String(text).split("\n").filter((l) => l.trim().startsWith("|"));
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = splitRow(lines[0]);
  const rows = lines.slice(2).map((l) => {
    const cells = splitRow(l);
    return Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? ""]));
  });
  return { headers, rows };
}

export function renderTable(headers, rows) {
  return [
    `| ${headers.map(cell).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${headers.map((h) => cell(r[h])).join(" | ")} |`),
  ].join("\n");
}

function slugify(text) {
  return String(text || "")
    .trim()
    .replace(/[\\/:*?"<>|#^[\]]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

// ---------- vault ----------

export class MemoryVault {
  #writeQueue = Promise.resolve();
  #mutationQueue = Promise.resolve();

  constructor(root, { now = () => new Date() } = {}) {
    if (!root) throw new Error("记忆库路径未配置（设置 AC_MEMORY_VAULT 或运行 remodeck memory config --vault <路径>）");
    this.root = resolve(root);
    this.now = now;
  }

  #serialize(fn) {
    const run = this.#mutationQueue.then(fn, fn);
    this.#mutationQueue = run.catch(() => {});
    return run;
  }

  abs(rel) {
    const p = resolve(this.root, rel);
    if (p !== this.root && !p.startsWith(this.root + sep)) throw new Error(`路径越出记忆库：${rel}`);
    return p;
  }

  rel(abs) {
    return relative(this.root, abs).split(sep).join("/");
  }

  async listNotes() {
    const out = [];
    const walk = async (dir) => {
      let entries = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (e.name.startsWith(".")) continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile() && e.name.endsWith(".md")) out.push(p);
      }
    };
    await walk(this.root);
    return out.map((abs) => this.rel(abs)).sort();
  }

  async read(rel) {
    const raw = await readFile(this.abs(rel), "utf8");
    return { rel, raw, ...parseNote(raw) };
  }

  async tryRead(rel) {
    try {
      return await this.read(rel);
    } catch {
      return null;
    }
  }

  async write(rel, meta, body) {
    const p = this.abs(rel);
    const run = this.#writeQueue.then(async () => {
      await mkdir(dirname(p), { recursive: true });
      const tmp = `${p}.${process.pid}.${randomUUID().slice(0, 8)}.tmp`;
      await writeFile(tmp, renderNote(meta, body));
      await rename(tmp, p);
      return rel;
    });
    this.#writeQueue = run.catch(() => {});
    return run;
  }

  // scope: "<topicId>" | "area:<name>" | "me"
  scopeDir(scope) {
    const s = String(scope || "").trim();
    if (!s) throw new Error("缺少归属：项目 id、area:<领域名> 或 me");
    if (s === "me") return ME_DIR;
    if (s.startsWith("area:")) return `${AREAS_DIR}/${slugify(s.slice(5))}`;
    return `${PROJECTS_DIR}/${slugify(s)}`;
  }

  cardPath(scope) {
    const dir = this.scopeDir(scope);
    return `${dir}/${basename(dir)}.md`;
  }

  async projectCards() {
    const notes = await this.listNotes();
    const cards = [];
    for (const rel of notes) {
      const parts = rel.split("/");
      if (parts.length !== 3 || parts[0] !== PROJECTS_DIR || parts[2] !== `${parts[1]}.md`) continue;
      const note = await this.tryRead(rel);
      if (note) cards.push(note);
    }
    return cards;
  }

  async ensureCard(scope, defaults = {}) {
    const rel = this.cardPath(scope);
    const existing = await this.tryRead(rel);
    if (existing) return existing;
    const name = defaults.name || basename(this.scopeDir(scope));
    const kind = scope === "me" ? "me" : String(scope).startsWith("area:") ? "area" : "project";
    const meta = { kind, ...(kind === "project" ? { topic: scope } : {}), name, aliases: defaults.aliases || [], updated: today(this.now()) };
    const body = `# ${name}\n\n${defaults.description || ""}\n\n## 事实\n\n${renderTable(FACT_HEADERS, [])}\n\n## 决策\n\n## 链接\n`;
    await this.write(rel, meta, body);
    return this.read(rel);
  }

  // Maps a cwd or free text to a project topic id using card frontmatter (cwd prefixes, aliases).
  async resolveTopic({ topic = "", cwd = "", text = "" } = {}) {
    if (topic) return String(topic);
    const cards = await this.projectCards();
    const cleanCwd = String(cwd || "").replace(/\/+$/, "");
    if (cleanCwd) {
      let best = null;
      let bestLen = 0;
      for (const c of cards) {
        for (const prefix of [].concat(c.meta.cwd || [])) {
          const p = String(prefix).replace(/\/+$/, "");
          if (p && (cleanCwd === p || cleanCwd.startsWith(`${p}/`)) && p.length > bestLen) {
            best = c;
            bestLen = p.length;
          }
        }
      }
      if (best) return best.meta.topic || basename(dirname(best.rel));
    }
    const hay = String(text || "").toLowerCase();
    if (hay) {
      for (const c of cards) {
        const names = [c.meta.name, c.meta.topic, ...[].concat(c.meta.aliases || []), ...[].concat(c.meta.keywords || [])];
        if (names.some((n) => n && String(n).length >= 2 && hay.includes(String(n).toLowerCase()))) {
          return c.meta.topic || basename(dirname(c.rel));
        }
      }
    }
    return "";
  }

  // ----- facts: keyed, conflict-aware -----
  async upsertFact(scope, key, value, { source = "agent" } = {}) {
    const cleanKey = String(key || "").trim();
    const cleanValue = String(value ?? "").trim();
    if (!cleanKey || !cleanValue) throw new Error("fact 需要键和值");
    const src = SOURCE_RANK[source] ? source : "agent";
    const card = await this.ensureCard(scope);
    const date = today(this.now());
    const { rows } = parseTable(getSection(card.body, "事实"));
    const idx = rows.findIndex((r) => r["键"] === cleanKey);
    let action = "inserted";
    let body = card.body;
    if (idx >= 0) {
      const old = rows[idx];
      if (old["值"] === cleanValue) {
        action = "refreshed";
        rows[idx] = { ...old, 确认: date, 来源: (SOURCE_RANK[src] > (SOURCE_RANK[old["来源"]] || 0)) ? src : old["来源"] };
      } else if (SOURCE_RANK[src] >= (SOURCE_RANK[old["来源"]] || 1)) {
        action = "superseded";
        const history = parseTable(getSection(body, "历史（已取代）")).rows;
        history.push({ 键: cleanKey, 旧值: old["值"], 旧来源: old["来源"], 取代于: date, 新值: cleanValue });
        body = setSection(body, "历史（已取代）", renderTable(HISTORY_HEADERS, history));
        rows[idx] = { 键: cleanKey, 值: cleanValue, 确认: date, 来源: src };
      } else {
        await this.#queueConflict({ scope, key: cleanKey, current: `${old["值"]}（${old["来源"]}）`, incoming: `${cleanValue}（${src}）` });
        return { action: "conflict", key: cleanKey, current: old["值"], incoming: cleanValue, file: CONFLICTS_FILE };
      }
    } else {
      rows.push({ 键: cleanKey, 值: cleanValue, 确认: date, 来源: src });
    }
    body = setSection(body, "事实", renderTable(FACT_HEADERS, rows));
    await this.write(card.rel, { ...card.meta, updated: date }, body);
    return { action, key: cleanKey, value: cleanValue, file: card.rel };
  }

  async #queueConflict({ scope, key, current, incoming }) {
    const note = await this.tryRead(CONFLICTS_FILE);
    const meta = note?.meta?.kind ? note.meta : { kind: "conflicts", updated: today(this.now()) };
    const body = note?.body || "# 待裁决\n\n同一个键出现两个说法且新来源权威更低时进入这里。改「状态」为「采用新值」或「保留现值」，下次体检会执行。\n";
    const rows = parseTable(getSection(body, "队列")).rows;
    if (!rows.some((r) => r["归属"] === scope && r["键"] === key && r["新值"] === incoming && r["状态"] === "待定")) {
      rows.push({ 日期: today(this.now()), 归属: scope, 键: key, 现值: current, 新值: incoming, 状态: "待定" });
    }
    await this.write(CONFLICTS_FILE, { ...meta, updated: today(this.now()) }, setSection(body, "队列", renderTable(CONFLICT_HEADERS, rows)));
  }

  async addDecision(scope, text, { source = "agent" } = {}) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) throw new Error("decide 需要内容");
    const card = await this.ensureCard(scope);
    const existing = getSection(card.body, "决策");
    if (existing.includes(clean)) return { action: "exists", file: card.rel };
    const date = today(this.now());
    const line = `- ${date} ${clean}（${source}）`;
    const body = setSection(card.body, "决策", [existing, line].filter(Boolean).join("\n"));
    await this.write(card.rel, { ...card.meta, updated: date }, body);
    return { action: "added", file: card.rel };
  }

  // ----- ledgers: Markdown tables with primary-key upsert -----
  ledgerPath(scope, name) {
    return `${this.scopeDir(scope)}/台账-${slugify(name)}.md`;
  }

  async upsertLedger(scope, name, row = {}, { keys = [] } = {}) {
    const rel = this.ledgerPath(scope, name);
    const note = await this.tryRead(rel);
    const meta = note?.meta?.kind ? { ...note.meta } : { kind: "ledger", scope, name, key: keys };
    const pk = [].concat(meta.key || []).filter(Boolean);
    const body = note?.body || `# 台账：${name}\n\n`;
    const table = parseTable(getSection(body, "记录"));
    const headers = [...table.headers];
    for (const h of Object.keys(row)) if (!headers.includes(h)) headers.push(h);
    if (!pk.length) throw new Error("新台账需要 --key 指定主键列（例如 --key 平台,链接）");
    const match = table.rows.findIndex((r) => pk.every((k) => String(r[k] ?? "") === String(row[k] ?? "")));
    let action = "inserted";
    if (match >= 0) {
      table.rows[match] = { ...table.rows[match], ...row };
      action = "updated";
    } else {
      table.rows.push(row);
    }
    const date = today(this.now());
    await this.write(rel, { ...meta, key: pk, updated: date }, setSection(body, "记录", renderTable(headers, table.rows)));
    return { action, file: rel, rows: table.rows.length };
  }

  // ----- work-in-progress task cards -----
  wipPath(scope, slug) {
    return `${this.scopeDir(scope)}/任务-${slugify(slug)}.md`;
  }

  async updateWip(scope, slug, patch = {}) {
    return this.#serialize(async () => {
      const rel = this.wipPath(scope, slug);
      const note = await this.tryRead(rel);
      const date = today(this.now());
      const stamp = this.now().toISOString().slice(0, 16).replace("T", " ");
      const meta = note?.meta?.kind ? { ...note.meta } : { kind: "wip", task: slugify(slug), scope, title: patch.title || slug, status: "active", sessions: [] };
      let body = note?.body || `# ${patch.title || slug}\n\n${WIP_SECTIONS.map((s) => `## ${s}\n`).join("\n")}`;
      if (patch.title) meta.title = patch.title;
      if (patch.status) meta.status = patch.status;
      if (patch.session) meta.sessions = [...new Set([...[].concat(meta.sessions || []), patch.session])];
      if (patch.goal) body = setSection(body, "目标", patch.goal);
      if (patch.state) body = setSection(body, "当前状态", patch.state);
      if (patch.next) body = setSection(body, "下一步", patch.next);
      if (patch.tentative) body = setSection(body, "暂定（未定稿，勿当事实）", patch.tentative);
      if (patch.artifact) {
        const lines = getSection(body, "中间产物").split("\n").filter(Boolean);
        const [path] = String(patch.artifact).split(/\s+[—-]\s+/);
        const kept = lines.filter((l) => !l.startsWith(`- ${path} `) && l !== `- ${path}`);
        body = setSection(body, "中间产物", [...kept, `- ${patch.artifact}`].join("\n"));
      }
      if (patch.log) {
        const log = getSection(body, "日志");
        body = setSection(body, "日志", [log, `- ${stamp} ${String(patch.log).replace(/\s+/g, " ").trim()}`].filter(Boolean).join("\n"));
      }
      meta.updated = date;
      await this.write(rel, meta, body);
      return { file: rel, status: meta.status };
    });
  }

  // One-way read-only Markdown projection of a RemoDeck core task.
  async projectTask(task, logs = [], { scope = "", parentTitle = "", childTitles = [] } = {}) {
    if (!task?.id) return null;
    return this.#serialize(async () => {
      const dir = scope ? this.scopeDir(scope) : INBOX_DIR;
      const rel = `${dir}/任务-${slugify(task.id)}.md`;
      const date = String(task.updatedAt || "").slice(0, 10) || today(this.now());
      const meta = {
        kind: "task",
        taskId: task.id,
        ...(task.parentId ? { parentId: task.parentId } : {}),
        ...(scope ? { scope } : {}),
        title: task.title || task.id,
        status: task.status || "open",
        sessions: [].concat(task.threadIds || []),
        updated: date,
      };
      const criteriaLines = (task.criteria || []).length
        ? task.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")
        : "（暂无）";
      const planLine = task.planRef?.threadId
        ? `- 会话：\`${task.planRef.threadId}\`${task.planRef.turnId ? `（轮次 ${task.planRef.turnId}）` : ""}${task.planRef.excerpt ? `\n- 摘要：${task.planRef.excerpt}` : ""}`
        : "（暂无）";
      const childLines = childTitles.length ? childTitles.map((t) => `- ${t}`).join("\n") : "（暂无）";
      const sessionLines = (task.threadIds || []).length ? task.threadIds.map((id) => `- \`${id}\``).join("\n") : "（暂无）";
      const logLines = (logs || []).length
        ? logs.slice(-20).map((l) => `- ${String(l.ts || "").slice(0, 16).replace("T", " ")} [${l.kind || "log"}] ${l.text || ""}`).join("\n")
        : "（暂无）";
      const parentHeader = task.parentId ? `\n> 所属父任务：${parentTitle || task.parentId}（\`${task.parentId}\`）\n` : "";
      const body = [
        `# ${task.title || task.id}`,
        parentHeader.trimEnd(),
        "<!-- 只读投影：真源由 RemoDeck tasks.json 维护，请使用 remodeck task 命令或界面操作 -->",
        "",
        "## 目标",
        "",
        task.goal || "（未写目标）",
        "",
        "## 验收标准",
        "",
        criteriaLines,
        "",
        "## 规划锚点",
        "",
        planLine,
        "",
        "## 子任务",
        "",
        childLines,
        "",
        "## 关联会话",
        "",
        sessionLines,
        "",
        "## 执行过程",
        "",
        logLines,
        "",
      ].filter((line, idx, arr) => !(line === "" && arr[idx - 1] === "")).join("\n");
      await this.write(rel, meta, body);
      return { file: rel };
    });
  }

  async listWip({ scope = "", status = "" } = {}) {
    const prefix = scope ? `${this.scopeDir(scope)}/` : "";
    const out = [];
    for (const rel of await this.listNotes()) {
      if (!basename(rel).startsWith("任务-") || (prefix && !rel.startsWith(prefix))) continue;
      const note = await this.tryRead(rel);
      if (!note || note.meta.kind !== "wip") continue;
      if (status && note.meta.status !== status) continue;
      out.push({
        rel,
        title: note.meta.title || basename(rel, ".md"),
        status: note.meta.status || "active",
        updated: note.meta.updated || "",
        state: getSection(note.body, "当前状态"),
        next: getSection(note.body, "下一步"),
      });
    }
    return out;
  }

  // ----- free notes (lessons, references, inbox items) -----
  async addNote({ scope = "", title, kind = "note", body = "", tags = [] } = {}) {
    if (!title) throw new Error("note 需要标题");
    const dir = scope ? this.scopeDir(scope) : INBOX_DIR;
    const rel = `${dir}/${slugify(title)}.md`;
    const existing = await this.tryRead(rel);
    if (existing) throw new Error(`已存在同名笔记：${rel}（用 get 查看后再决定合并）`);
    const date = today(this.now());
    await this.write(rel, { kind, scope: scope || "inbox", tags, created: date, verified_at: date }, `# ${title}\n\n${body}`);
    return { file: rel };
  }

  // ----- retrieval -----
  async search(query, { scope = "", kind = "", limit = 8 } = {}) {
    const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const prefix = scope ? `${this.scopeDir(scope)}/` : "";
    const hits = [];
    for (const rel of await this.listNotes()) {
      if (prefix && !rel.startsWith(prefix)) continue;
      const note = await this.tryRead(rel);
      if (!note) continue;
      if (kind && note.meta.kind !== kind) continue;
      const title = basename(rel, ".md").toLowerCase();
      const tags = [...[].concat(note.meta.aliases || []), ...[].concat(note.meta.tags || []), note.meta.name || ""].join(" ").toLowerCase();
      const body = note.body.toLowerCase();
      let score = 0;
      let firstTerm = "";
      for (const t of terms) {
        let s = 0;
        if (title.includes(t)) s += 5;
        if (tags.includes(t)) s += 4;
        const count = body.split(t).length - 1;
        s += Math.min(count, 5);
        if (!s && /[一-鿿]{3,}/.test(t)) {
          const grams = [];
          for (let i = 0; i < t.length - 1; i += 1) grams.push(t.slice(i, i + 2));
          const matched = grams.filter((g) => title.includes(g) || body.includes(g)).length;
          if (matched / grams.length >= 0.6) s += 1;
        }
        if (s && !firstTerm) firstTerm = t;
        score += s;
      }
      if (note.meta.status === "superseded" || note.meta.status === "dropped") score *= 0.5;
      if (score <= 0) continue;
      const line = note.body.split("\n").find((l) => firstTerm && l.toLowerCase().includes(firstTerm)) || "";
      hits.push({ rel, kind: note.meta.kind || "note", status: note.meta.status || "", score, snippet: line.trim().slice(0, 160) });
    }
    return hits.sort((a, b) => b.score - a.score || a.rel.localeCompare(b.rel)).slice(0, limit);
  }

  // Compact, agent-oriented summary of one scope; meant to be injected into prompts.
  async brief({ scope = "", maxChars = 2400 } = {}) {
    if (!scope) return "";
    const card = await this.tryRead(this.cardPath(scope));
    const out = [];
    const name = card?.meta?.name || scope;
    out.push(`[记忆简报] ${name}（${scope}）· 记忆库 ${this.root}`);
    if (card) {
      const facts = parseTable(getSection(card.body, "事实")).rows;
      if (facts.length) out.push(`事实：${facts.map((f) => `${f["键"]}=${f["值"]}（${f["确认"]}）`).join("；")}`);
      const decisions = getSection(card.body, "决策").split("\n").filter((l) => l.startsWith("- ")).slice(-6);
      if (decisions.length) out.push(`决策：\n${decisions.join("\n")}`);
      const links = getSection(card.body, "链接");
      if (links) out.push(`链接：\n${links}`);
    }
    const wips = (await this.listWip({ scope })).filter((w) => w.status === "active" || w.status === "paused");
    for (const w of wips.slice(0, 5)) {
      out.push(`进行中任务「${w.title}」(${w.status}，${w.updated}) ${w.rel}\n  状态：${compact(w.state, 160)}\n  下一步：${compact(w.next, 160)}`);
    }
    const dir = `${this.scopeDir(scope)}/`;
    for (const rel of (await this.listNotes()).filter((r) => r.startsWith(dir) && basename(r).startsWith("台账-"))) {
      const note = await this.tryRead(rel);
      const rows = parseTable(getSection(note?.body || "", "记录")).rows;
      out.push(`台账 ${rel}：${rows.length} 行，更新于 ${note?.meta?.updated || "?"}（remodeck memory get 查看全文）`);
    }
    const conflicts = parseTable(getSection((await this.tryRead(CONFLICTS_FILE))?.body || "", "队列")).rows
      .filter((r) => r["状态"] === "待定" && r["归属"] === scope);
    if (conflicts.length) out.push(`待裁决冲突 ${conflicts.length} 条：${CONFLICTS_FILE}`);
    if (out.length === 1) out.push("（暂无记录）");
    const text = out.join("\n");
    return text.length > maxChars ? `${text.slice(0, maxChars - 20)}\n…（已截断）` : text;
  }

  // One-line pointer injected into new sessions: tells the agent what exists without spending context on contents.
  async pointer({ scope = "" } = {}) {
    if (!scope) return "";
    const card = await this.tryRead(this.cardPath(scope));
    const dir = `${this.scopeDir(scope)}/`;
    const notes = (await this.listNotes()).filter((r) => r.startsWith(dir));
    const ledgers = notes.filter((r) => basename(r).startsWith("台账-")).map((r) => basename(r, ".md").slice(3));
    const wips = (await this.listWip({ scope })).filter((w) => w.status === "active" || w.status === "paused");
    const facts = card ? parseTable(getSection(card.body, "事实")).rows.length : 0;
    if (!card && !notes.length) return "";
    const parts = [`事实 ${facts} 条`];
    if (ledgers.length) parts.push(`台账：${ledgers.join("、")}`);
    if (wips.length) parts.push(`未完成任务：${wips.map((w) => w.title).join("、")}`);
    return `[共享记忆] 项目「${card?.meta?.name || scope}」（${scope}）在记忆库有记录：${parts.join("；")}。`;
  }

  // ----- registry sync, lint -----
  async syncProjects(registry = {}) {
    const domains = new Map((registry.domains || []).map((d) => [d.id, d]));
    const results = [];
    for (const t of registry.topics || []) {
      if (!t?.id) continue;
      const rel = this.cardPath(t.id);
      const existing = await this.tryRead(rel);
      const cwd = [...new Set([t.primaryCwd, ...(t.cwdPrefixes || [])].filter(Boolean))];
      const registryMeta = {
        kind: "project",
        topic: t.id,
        name: t.name || t.id,
        domain: domains.get(t.domainId)?.name || t.domainId || "",
        cwd,
        keywords: t.keywords || [],
      };
      if (existing) {
        const aliases = existing.meta.aliases || [];
        await this.write(rel, { ...existing.meta, ...registryMeta, aliases }, existing.body);
        results.push({ topic: t.id, action: "updated" });
      } else {
        const body = `# ${registryMeta.name}\n\n${t.description || ""}\n\n## 事实\n\n${renderTable(FACT_HEADERS, [])}\n\n## 决策\n\n## 链接\n\n${cwd.map((c) => `- 规则：\`${c}/AGENTS.md\``).slice(0, 1).join("\n")}\n`;
        await this.write(rel, { ...registryMeta, aliases: [], updated: today(this.now()) }, body);
        results.push({ topic: t.id, action: "created" });
      }
    }
    return results;
  }

  async lint() {
    const now = this.now();
    const notes = await this.listNotes();
    const names = new Set();
    const report = { staleFacts: [], duplicateKeys: [], brokenLinks: [], syncConflicts: [], pendingConflicts: 0, idleWip: [] };
    const parsed = [];
    for (const rel of notes) {
      if (SYNC_CONFLICT_RE.test(rel)) report.syncConflicts.push(rel);
      const note = await this.tryRead(rel);
      if (!note) continue;
      parsed.push(note);
      names.add(basename(rel, ".md"));
      for (const a of [].concat(note.meta.aliases || [])) names.add(String(a));
    }
    const ageDays = (d) => (now - new Date(`${d}T00:00:00`)) / 86400000;
    for (const note of parsed) {
      const facts = parseTable(getSection(note.body, "事实")).rows;
      const seen = new Set();
      for (const f of facts) {
        if (seen.has(f["键"])) report.duplicateKeys.push(`${note.rel} · ${f["键"]}`);
        seen.add(f["键"]);
        if (f["确认"] && ageDays(f["确认"]) > STALE_FACT_DAYS) report.staleFacts.push(`${note.rel} · ${f["键"]}（${f["确认"]}）`);
      }
      for (const m of note.body.matchAll(/\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]/g)) {
        const target = basename(m[1].trim().replace(/\\$/, ""));
        if (!names.has(target)) report.brokenLinks.push(`${note.rel} → [[${m[1].trim().replace(/\\$/, "")}]]`);
      }
      if (note.meta.kind === "wip" && note.meta.status === "active" && note.meta.updated && ageDays(note.meta.updated) > IDLE_WIP_DAYS) {
        report.idleWip.push(`${note.rel}（${note.meta.updated}）`);
      }
      if (note.rel === CONFLICTS_FILE) {
        report.pendingConflicts = parseTable(getSection(note.body, "队列")).rows.filter((r) => r["状态"] === "待定").length;
      }
    }
    return report;
  }
}

function compact(text, max) {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s || "（空）";
}

// ---------- Antigravity scratch inventory (machine-only, read-only source) ----------

const SCRATCH_CLASSES = [
  ["secret", /(session|cookie|token|auth|login|credential|storage_state|2fa|passwd|password)/i],
  ["snapshot", /\.(png|jpe?g|webp|gif|mp4)$|_snap\.txt$/i],
  ["result", /(result|_list|platforms|audit|stats|report)[^/]*\.json$/i],
  ["state", /(state|progress|checkpoint)[^/]*\.json$/i],
  ["tool", /\.(py|mjs|cjs|js|ts|sh)$/i],
  ["doc", /\.md$/i],
];

export function classifyScratchFile(name) {
  for (const [cls, re] of SCRATCH_CLASSES) if (re.test(name)) return cls;
  return "other";
}

export async function scanAntigravityScratch(brainDir, { maxFilesPerSession = 300 } = {}) {
  const sessions = [];
  let ids = [];
  try {
    ids = await readdir(brainDir);
  } catch {
    return sessions;
  }
  for (const id of ids) {
    const scratch = join(brainDir, id, "scratch");
    if (!existsSync(scratch)) continue;
    const files = [];
    const walk = async (dir, depth) => {
      let entries = [];
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (files.length >= maxFilesPerSession) return;
        const p = join(dir, e.name);
        if (e.isDirectory() && depth < 3) await walk(p, depth + 1);
        else if (e.isFile()) {
          const st = await stat(p).catch(() => null);
          const name = relative(scratch, p).split(sep).join("/");
          files.push({ name, size: st?.size || 0, mtime: st?.mtime?.toISOString() || "", class: classifyScratchFile(name) });
        }
      }
    };
    await walk(scratch, 0);
    if (!files.length) continue;
    const classes = {};
    for (const f of files) classes[f.class] = (classes[f.class] || 0) + 1;
    const mtime = files.reduce((m, f) => (f.mtime > m ? f.mtime : m), "");
    sessions.push({ rawId: id, dir: scratch, mtime, total: files.length, classes, files });
  }
  return sessions.sort((a, b) => b.mtime.localeCompare(a.mtime));
}

// Wraps a pointer for a new session's first prompt: the agent pulls details itself only when the task needs history.
export function formatMemoryBriefForPrompt(pointer) {
  if (!pointer) return "";
  return `${pointer}本会话没有之前的上下文：如果任务涉及过往进展、发布记录、数据或已做的决定，先用 remodeck-memory 技能检索（remodeck memory brief / search / get），不要凭印象作答；无关则忽略本提示。`;
}
