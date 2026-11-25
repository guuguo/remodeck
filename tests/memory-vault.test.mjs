import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CONFLICTS_FILE,
  MemoryVault,
  classifyScratchFile,
  getSection,
  parseNote,
  parseTable,
  renderNote,
  resolveVaultPath,
  scanAntigravityScratch,
  writeMemoryConfig,
} from "../src/memory-vault.mjs";

async function tempVault(t, nowRef = { value: new Date("2026-11-20T10:00:00") }) {
  const root = await mkdtemp(join(os.tmpdir(), "ac-memory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, vault: new MemoryVault(root, { now: () => nowRef.value }), nowRef };
}

const REGISTRY = {
  domains: [{ id: "indie-lab", name: "软件产品研发室" }],
  topics: [{
    id: "demo-translator",
    domainId: "indie-lab",
    name: "图片翻译",
    description: "示例品牌 DemoBrand 浏览器插件",
    primaryCwd: "/work/manga-bubble-translator",
    cwdPrefixes: ["/work/manga-bubble-translator"],
    keywords: ["图片翻译", "会员订阅"],
  }],
};

test("frontmatter round-trips lists, paths with spaces and colons", () => {
  const raw = renderNote({ kind: "project", cwd: ["/Volumes/Data SSD/dev/a"], name: "a: b", aliases: [] }, "# x\n");
  const { meta, body } = parseNote(raw);
  assert.deepEqual(meta.cwd, ["/Volumes/Data SSD/dev/a"]);
  assert.equal(meta.name, "a: b");
  assert.deepEqual(meta.aliases, []);
  assert.equal(body, "# x\n");
});

test("sync-projects builds cards from the registry and resolves topic by cwd or alias", async (t) => {
  const { vault } = await tempVault(t);
  assert.deepEqual(await vault.syncProjects(REGISTRY), [{ topic: "demo-translator", action: "created" }]);
  assert.equal(await vault.resolveTopic({ cwd: "/work/manga-bubble-translator/src" }), "demo-translator");
  assert.equal(await vault.resolveTopic({ cwd: "/work/other" }), "");
  assert.equal(await vault.resolveTopic({ text: "看看会员订阅的数据" }), "demo-translator");

  await vault.upsertFact("demo-translator", "品牌名", "示例品牌 DemoBrand", { source: "user" });
  const again = await vault.syncProjects(REGISTRY);
  assert.equal(again[0].action, "updated");
  const card = await vault.read("项目/demo-translator/demo-translator.md");
  assert.match(card.body, /示例品牌 DemoBrand/, "registry sync must keep human-edited body");
});

test("facts: refresh, supersede by equal/higher authority, queue conflicts from lower authority", async (t) => {
  const { vault, nowRef } = await tempVault(t);
  await vault.syncProjects(REGISTRY);
  assert.equal((await vault.upsertFact("demo-translator", "定价", "9.9 元", { source: "user" })).action, "inserted");

  nowRef.value = new Date("2026-11-25T10:00:00");
  assert.equal((await vault.upsertFact("demo-translator", "定价", "9.9 元", { source: "agent" })).action, "refreshed");
  let facts = parseTable(getSection((await vault.read("项目/demo-translator/demo-translator.md")).body, "事实")).rows;
  assert.deepEqual(facts, [{ 键: "定价", 值: "9.9 元", 确认: "2026-11-25", 来源: "user" }]);

  const conflict = await vault.upsertFact("demo-translator", "定价", "19 元", { source: "agent" });
  assert.equal(conflict.action, "conflict");
  const queue = parseTable(getSection((await vault.read(CONFLICTS_FILE)).body, "队列")).rows;
  assert.equal(queue.length, 1);
  assert.equal(queue[0]["状态"], "待定");
  await vault.upsertFact("demo-translator", "定价", "19 元", { source: "agent" });
  assert.equal(parseTable(getSection((await vault.read(CONFLICTS_FILE)).body, "队列")).rows.length, 1, "same conflict is queued once");

  assert.equal((await vault.upsertFact("demo-translator", "定价", "12 元", { source: "code" })).action, "superseded");
  const card = await vault.read("项目/demo-translator/demo-translator.md");
  facts = parseTable(getSection(card.body, "事实")).rows;
  assert.equal(facts[0]["值"], "12 元");
  const history = parseTable(getSection(card.body, "历史（已取代）")).rows;
  assert.deepEqual(history[0], { 键: "定价", 旧值: "9.9 元", 旧来源: "user", 取代于: "2026-11-25", 新值: "12 元" });
});

test("ledger upserts by primary key and keeps pipes escaped", async (t) => {
  const { vault } = await tempVault(t);
  const first = await vault.upsertLedger("demo-translator", "文章发布", { 平台: "知乎", 链接: "https://z/1", 标题: "A | B", 阅读: "2" }, { keys: ["平台", "链接"] });
  assert.equal(first.action, "inserted");
  const second = await vault.upsertLedger("demo-translator", "文章发布", { 平台: "知乎", 链接: "https://z/1", 阅读: "40" });
  assert.equal(second.action, "updated");
  await vault.upsertLedger("demo-translator", "文章发布", { 平台: "掘金", 链接: "https://j/1", 阅读: "5" });
  const note = await vault.read("项目/demo-translator/台账-文章发布.md");
  const rows = parseTable(getSection(note.body, "记录")).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0]["标题"], "A | B");
  assert.equal(rows[0]["阅读"], "40");
  await assert.rejects(() => vault.upsertLedger("x", "无主键", { a: "1" }), /主键/);
});

test("wip card overwrites state, appends log, dedupes artifacts, and shows up in brief", async (t) => {
  const { vault } = await tempVault(t);
  await vault.syncProjects(REGISTRY);
  await vault.updateWip("demo-translator", "掘金续发", { title: "掘金续发", state: "卡在弹窗", next: "跑续发脚本", artifact: "scratch/a.py — v1", log: "开始", session: "antigravity:default:1" });
  await vault.updateWip("demo-translator", "掘金续发", { state: "已发布", artifact: "scratch/a.py — v2", log: "完成" });
  const card = await vault.read("项目/demo-translator/任务-掘金续发.md");
  assert.equal(getSection(card.body, "当前状态"), "已发布");
  assert.equal(getSection(card.body, "中间产物"), "- scratch/a.py — v2");
  assert.equal(getSection(card.body, "日志").split("\n").length, 2);
  assert.deepEqual(card.meta.sessions, ["antigravity:default:1"]);

  await vault.upsertLedger("demo-translator", "文章发布", { 平台: "掘金", 链接: "u" }, { keys: ["平台", "链接"] });
  await vault.addDecision("demo-translator", "文章统一用「做个小工具」系列标题", { source: "user" });
  const brief = await vault.brief({ scope: "demo-translator" });
  assert.match(brief, /进行中任务「掘金续发」/);
  assert.match(brief, /下一步：跑续发脚本/);
  assert.match(brief, /台账 项目\/demo-translator\/台账-文章发布\.md：1 行/);
  assert.match(brief, /做个小工具/);

  await vault.updateWip("demo-translator", "掘金续发", { status: "done" });
  assert.doesNotMatch(await vault.brief({ scope: "demo-translator" }), /进行中任务/);
});

test("search ranks title/alias hits and supports unsplit Chinese queries", async (t) => {
  const { vault } = await tempVault(t);
  await vault.addNote({ scope: "area:自媒体运营", title: "知乎发文节奏", kind: "lesson", body: "晚上九点后发布阅读更高" });
  await vault.addNote({ title: "随手记", body: "提到知乎一次" });
  const hits = await vault.search("知乎");
  assert.equal(hits[0].rel, "领域/自媒体运营/知乎发文节奏.md");
  assert.equal(hits.length, 2);
  const fuzzy = await vault.search("发布阅读量");
  assert.equal(fuzzy[0].rel, "领域/自媒体运营/知乎发文节奏.md");
  await assert.rejects(() => vault.addNote({ title: "随手记" }), /已存在/);
});

test("lint reports stale facts, broken links, idle wip and sync-conflict copies", async (t) => {
  const { vault, nowRef } = await tempVault(t);
  await vault.syncProjects(REGISTRY);
  await vault.upsertFact("demo-translator", "端口", "43310");
  await vault.updateWip("demo-translator", "旧任务", { state: "做了一半" });
  await vault.addNote({ title: "链接测试", body: "见 [[不存在的笔记]] 和 [[demo-translator|图片翻译]] 以及 | [[demo-translator\\|表格内]] |" });
  await writeFile(join(vault.root, "收件箱", "a.sync-conflict-20261120.md"), "x");
  nowRef.value = new Date("2027-02-01T10:00:00");
  const report = await vault.lint();
  assert.equal(report.staleFacts.length, 1);
  assert.deepEqual(report.brokenLinks, ["收件箱/链接测试.md → [[不存在的笔记]]"]);
  assert.equal(report.idleWip.length, 1);
  assert.equal(report.syncConflicts.length, 1);
});

test("vault path is opt-in via env or data-dir config and rejects escaping paths", async (t) => {
  const { root, vault } = await tempVault(t);
  assert.equal(await resolveVaultPath({ env: {}, dataDir: root }), "");
  await writeMemoryConfig(root, { vaultPath: "/tmp/vault-x" });
  assert.equal(await resolveVaultPath({ env: {}, dataDir: root }), "/tmp/vault-x");
  assert.equal(await resolveVaultPath({ env: { AC_MEMORY_VAULT: "/tmp/vault-y" }, dataDir: root }), "/tmp/vault-y");
  await assert.rejects(() => vault.read("../etc/passwd"), /越出/);
});

test("scratch inventory classifies files without reading their contents", async (t) => {
  const { root } = await tempVault(t);
  const scratch = join(root, "brain", "abc", "scratch");
  await mkdir(join(scratch, "variants"), { recursive: true });
  for (const name of ["zhihu_publish.py", "zhihu_result.json", "juejin_state.json", "active_session.txt", "shot.png", "variants/zhihu.md"]) {
    await writeFile(join(scratch, name), "{}");
  }
  await mkdir(join(root, "brain", "empty", "scratch"), { recursive: true });
  const sessions = await scanAntigravityScratch(join(root, "brain"));
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].classes, { tool: 1, result: 1, state: 1, secret: 1, snapshot: 1, doc: 1 });
  assert.equal(classifyScratchFile("amo_after_login.json"), "secret");
});

test("hub.startThread appends the project memory brief for sessions opened in a known project cwd", async (t) => {
  const { ProviderHub } = await import("../src/provider-hub.mjs");
  const { root, vault } = await tempVault(t);
  await vault.syncProjects(REGISTRY);
  await vault.upsertFact("demo-translator", "品牌名", "示例品牌 DemoBrand", { source: "user" });
  const dataDir = join(root, "data");
  await mkdir(dataDir, { recursive: true });
  await writeMemoryConfig(dataDir, { vaultPath: root });
  const sent = [];
  const provider = {
    id: "codex",
    async init() {},
    async close() {},
    async listThreads() { return { threads: [] }; },
    async startThread(payload) {
      sent.push(payload);
      return { thread: { id: `codex:default:t${sent.length}`, cwd: payload.cwd }, turn: { id: "turn-1" } };
    },
  };
  const hub = new ProviderHub({ dataDir, providers: [provider], enableQueueDrain: false });
  t.after(() => hub.close?.().catch(() => {}));
  await hub.startThread({ provider: "codex", cwd: "/work/manga-bubble-translator", text: "看看文章数据" });
  await hub.startThread({ provider: "codex", cwd: "/work/other", text: "随便聊聊" });
  await hub.startThread({ provider: "codex", cwd: "/work/manga-bubble-translator", text: "/goal 做完" });
  await hub.startThread({ provider: "codex", cwd: "/work/shared", text: "派发任务", memoryTopic: "demo-translator" });
  assert.match(sent[0].text, /^看看文章数据\n\n---\n\[共享记忆\] 项目「图片翻译」/);
  assert.match(sent[0].text, /事实 1 条/);
  assert.doesNotMatch(sent[0].text, /示例品牌 DemoBrand/, "contents are pulled on demand, not pushed");
  assert.match(sent[0].text, /ac-memory brief \/ search/);
  assert.equal(sent[1].text, "随便聊聊");
  assert.equal(sent[2].text, "/goal 做完");
  assert.match(sent[3].text, /项目「图片翻译」/, "explicit dispatch topic wins over cwd matching");
});
