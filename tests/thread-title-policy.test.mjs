import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ProviderHub } from "../src/provider-hub.mjs";
import { AntigravityProvider } from "../src/providers/antigravity-provider.mjs";
import { CodexProvider } from "../src/providers/codex-provider.mjs";
import { createAgentControlServer } from "../src/server.mjs";
import {
  evaluateTitleMutation,
  formatStructuredTitle,
  isCanonicalDomainTitle,
  measureTitleWidth,
  resolveEffectiveTitleMeta,
  stripForkAndContinueWrappers,
  validateAgentBaseTitle,
  validateAgentSuffix,
} from "../src/thread-title-policy.mjs";

const execFileAsync = promisify(execFile);
const MOCK_CODEX_BIN = fileURLToPath(new URL("./helpers/mock-codex-cli.mjs", import.meta.url));
const MOCK_CLAUDE_BIN = fileURLToPath(new URL("./helpers/mock-claude-cli.mjs", import.meta.url));
const MOCK_AGY_BIN = fileURLToPath(new URL("./helpers/mock-agy-cli.mjs", import.meta.url));
const RENAME_SCRIPT = fileURLToPath(new URL("../scripts/rename-thread.mjs", import.meta.url));

test("thread-title-policy validates width budgets, format, fillers, wrappers, and domain titles", () => {
  assert.equal(measureTitleWidth("新会话｜路径选择器"), 9);
  assert.equal(measureTitleWidth("Android｜上架 Google Play"), 13);
  assert.equal(measureTitleWidth("Antigravity"), 6);

  assert.equal(isCanonicalDomainTitle("【示例客户｜张三｜消息同步｜OPPO X6】图片无法显示"), true);
  assert.equal(isCanonicalDomainTitle("【示例客户｜张三｜消息同步】图片无法显示"), true);
  assert.equal(isCanonicalDomainTitle("【支付模块】超时问题"), false);

  assert.equal(stripForkAndContinueWrappers("模块A｜功能与性能评估 (Antigravity 接续) (分叉)"), "模块A｜功能与性能评估");
  assert.equal(stripForkAndContinueWrappers("继续 (Claude Code 接续)"), "继续");

  const valid1 = validateAgentBaseTitle("新会话 | 路径选择器");
  assert.equal(valid1.ok, true);
  assert.equal(valid1.value, "新会话｜路径选择器");
  assert.equal(valid1.object, "新会话");
  assert.equal(valid1.subject, "路径选择器");

  const valid2 = validateAgentBaseTitle("Android｜上架 Google Play");
  assert.equal(valid2.ok, true);

  for (const bad of [
    "",
    "新会话",
    "继续",
    "帮我排查登录问题",
    "全面诊断模块A",
    "Opus 全面评估标题",
    "支付模块｜超时排查中",
    "支付模块｜超时一下",
    "【支付模块】回调超时",
    "支付｜超时 (Antigravity 接续)",
    "支付｜超时 <USER_REQUEST>",
    "对象｜子对象｜多了一段",
    "超长对象名字超过七个字｜主旨",
    "对象｜主旨实在太长超过十个字了",
    "超宽对象｜一个正好超过十六字的总主干",
  ]) {
    const res = validateAgentBaseTitle(bad);
    assert.equal(res.ok, false, `expected invalid title: ${bad}`);
  }

  assert.equal(validateAgentSuffix("+自动标题").value, "自动标题");
  assert.equal(validateAgentSuffix("自动标题").ok, true);
  assert.equal(validateAgentSuffix("").ok, false);
  assert.equal(validateAgentSuffix("超过五个汉字的后缀").ok, false);
  assert.equal(validateAgentSuffix("含｜分隔").ok, false);
  assert.equal(validateAgentSuffix("排查中").ok, false);
});

test("evaluateTitleMutation enforces none -> draft -> locked, suffix rules, domain priority, and user lock", () => {
  const t0 = 1_700_000_000;

  // 1. Draft allows refinement until locked
  const d1 = evaluateTitleMutation(null, { source: "agent", name: "支付模块｜回调排查" }, { nowSec: t0 });
  assert.equal(d1.ok, true);
  assert.equal(d1.skipped, false);
  assert.equal(d1.titleState, "draft");
  assert.equal(d1.nextCustomName, "支付模块｜回调排查");

  let meta = { customName: d1.nextCustomName, titleMeta: d1.nextTitleMeta };
  const d2 = evaluateTitleMutation(meta, { source: "agent", name: "支付模块｜签名校验超时", lock: true }, { nowSec: t0 + 10 });
  assert.equal(d2.ok, true);
  assert.equal(d2.titleState, "locked");
  assert.equal(d2.nextCustomName, "支付模块｜签名校验超时");

  // 2. Locked blocks ordinary overwrites
  meta = { customName: d2.nextCustomName, titleMeta: d2.nextTitleMeta };
  const overwriteBlocked = evaluateTitleMutation(meta, { source: "agent", name: "缓存｜清理脚本" }, { nowSec: t0 + 20 });
  assert.equal(overwriteBlocked.ok, true);
  assert.equal(overwriteBlocked.skipped, true);
  assert.equal(overwriteBlocked.locked, true);
  assert.equal(overwriteBlocked.reason, "primary_title_locked");
  assert.equal(overwriteBlocked.currentName, "支付模块｜签名校验超时");

  // 3. Auto-lock after 30m or 3 user turns
  const draftOnly = evaluateTitleMutation(null, { source: "agent", name: "首页｜首屏加载优化" }, { nowSec: t0 });
  const agedEff = resolveEffectiveTitleMeta({ customName: draftOnly.nextCustomName, titleMeta: draftOnly.nextTitleMeta }, { nowSec: t0 + 1800 });
  assert.equal(agedEff.state, "locked");
  const turnEff = resolveEffectiveTitleMeta({
    customName: draftOnly.nextCustomName,
    titleMeta: { ...draftOnly.nextTitleMeta, draftTurns: 3 },
  }, { nowSec: t0 + 5 });
  assert.equal(turnEff.state, "locked");

  // 4. Append suffixes: deduplicate, max 2, total width <= 22
  const a1 = evaluateTitleMutation(meta, { source: "agent", action: "append", suffix: "重试" }, { nowSec: t0 + 30 });
  assert.equal(a1.ok, true);
  assert.equal(a1.skipped, false);
  assert.equal(a1.nextCustomName, "支付模块｜签名校验超时 +重试");
  meta = { customName: a1.nextCustomName, titleMeta: a1.nextTitleMeta };

  const dup = evaluateTitleMutation(meta, { source: "agent", action: "append", suffix: "签名" }, { nowSec: t0 + 35 });
  assert.equal(dup.skipped, true);
  assert.equal(dup.reason, "suffix_duplicate");

  const dup2 = evaluateTitleMutation(meta, { source: "agent", action: "append", suffix: "重试" }, { nowSec: t0 + 36 });
  assert.equal(dup2.skipped, true);
  assert.equal(dup2.reason, "suffix_duplicate");

  const a2 = evaluateTitleMutation(meta, { source: "agent", action: "append", suffix: "告警" }, { nowSec: t0 + 40 });
  assert.equal(a2.ok, true);
  assert.equal(a2.nextCustomName, "支付模块｜签名校验超时 +重试 +告警");
  meta = { customName: a2.nextCustomName, titleMeta: a2.nextTitleMeta };

  const a3 = evaluateTitleMutation(meta, { source: "agent", action: "append", suffix: "监控" }, { nowSec: t0 + 50 });
  assert.equal(a3.skipped, true);
  assert.equal(a3.reason, "suffix_limit_reached");

  const overTotal = evaluateTitleMutation({
    customName: "订单对账系统｜跨库补偿同步修护版 +重试",
    titleMeta: { state: "locked", source: "agent", base: "订单对账系统｜跨库补偿同步修护版", suffixes: ["重试"], createdAt: t0, lockedAt: t0, updatedAt: t0, draftTurns: 1 },
  }, { source: "agent", action: "append", suffix: "上线验证" }, { nowSec: t0 + 55 });
  assert.equal(overTotal.ok, false);
  assert.equal(overTotal.code, "title_total_too_long");

  // 5. Domain title overrides agent, blocks generic agent overwrites, and user lock overrides everything
  const dom = evaluateTitleMutation(meta, { source: "domain", name: "【示例客户｜张三｜消息同步｜OPPO X6】图片无法显示" }, { nowSec: t0 + 60 });
  assert.equal(dom.ok, true);
  assert.equal(dom.skipped, false);
  assert.equal(dom.nextTitleMeta.source, "domain");
  meta = { customName: dom.nextCustomName, titleMeta: dom.nextTitleMeta };

  const agentOnDomain = evaluateTitleMutation(meta, { source: "agent", name: "消息｜图片修复" }, { nowSec: t0 + 70 });
  assert.equal(agentOnDomain.skipped, true);
  assert.equal(agentOnDomain.reason, "locked_by_domain");

  const usr = evaluateTitleMutation(meta, { source: "user", name: "用户手改标题" }, { nowSec: t0 + 80 });
  assert.equal(usr.ok, true);
  assert.equal(usr.titleState, "user");
  meta = { customName: usr.nextCustomName, titleMeta: usr.nextTitleMeta };

  assert.equal(evaluateTitleMutation(meta, { source: "agent", name: "覆盖测试" }).reason, "locked_by_user");
  assert.equal(evaluateTitleMutation(meta, { source: "domain", name: "【示例客户｜张三｜消息同步｜OPPO X6】重命名" }).reason, "locked_by_user");

  // 6. Legacy customName without titleMeta is treated as locked
  const legacyRes = evaluateTitleMutation({ customName: "历史手动标题", updatedAt: t0 }, { source: "agent", name: "新标题｜测试" });
  assert.equal(legacyRes.skipped, true);
  assert.equal(legacyRes.reason, "primary_title_locked");
  assert.equal(formatStructuredTitle("对象｜主旨", ["扩展"]), "对象｜主旨 +扩展");
});

test("scripts/rename-thread.mjs enforces local validation, server lock, --append, --domain, and user lock", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-rename-cli-"));
  const codexHome = resolve(root, "codex");
  const dataDir = resolve(root, "data");
  await Promise.all([codexHome, dataDir].map((d) => mkdir(d, { recursive: true })));

  const server = await createAgentControlServer({
    port: 0,
    dataDir,
    disableRelay: true,
    disableTunnel: true,
    disableUpdateCheck: true,
    env: {
      ...process.env,
      HOME: root,
      USERPROFILE: root,
      CODEX_BIN: MOCK_CODEX_BIN,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", home: codexHome }]),
      AGENT_CONTROL_CLAUDE_CONFIG_DIRS: "[]",
      AGENT_CONTROL_AGY_APP_DATA_DIRS: "[]",
      AGENT_CONTROL_GROK_HOMES: "[]",
      AGENT_CONTROL_DISABLE_AUTOMATIONS: "1",
    },
  });
  t.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  await server.start();

  const started = await server.hub.startThread({
    provider: "codex",
    profileId: "default",
    cwd: root,
    text: "初始任务 [COMPLETE_NOW]",
  });
  const threadId = started.thread.id;

  // Rejects invalid title locally before hitting server
  await assert.rejects(
    execFileAsync(process.execPath, [RENAME_SCRIPT, "帮我看下这个非常长的错误标题超出限制了", "--id", threadId, "--url", server.url]),
    /标题未通过格式校验/,
  );

  // Draft rename succeeds and can be refined once before locking
  const r1 = await execFileAsync(process.execPath, [RENAME_SCRIPT, "支付模块｜回调排查", "--id", threadId, "--url", server.url]);
  assert.equal(JSON.parse(r1.stdout).titleState, "draft");

  const r2 = await execFileAsync(process.execPath, [RENAME_SCRIPT, "支付模块｜签名校验超时", "--lock", "--id", threadId, "--url", server.url]);
  const j2 = JSON.parse(r2.stdout);
  assert.equal(j2.titleState, "locked");
  assert.equal(j2.name, "支付模块｜签名校验超时");

  // Second ordinary rename is skipped cleanly
  const r3 = await execFileAsync(process.execPath, [RENAME_SCRIPT, "缓存｜清理脚本", "--id", threadId, "--url", server.url]);
  const j3 = JSON.parse(r3.stdout);
  assert.equal(j3.skipped, true);
  assert.equal(j3.reason, "primary_title_locked");
  assert.equal(j3.name, "支付模块｜签名校验超时");

  // --append adds suffix cleanly
  const r4 = await execFileAsync(process.execPath, [RENAME_SCRIPT, "--append", "重试", "--id", threadId, "--url", server.url]);
  const j4 = JSON.parse(r4.stdout);
  assert.equal(j4.skipped, false);
  assert.equal(j4.name, "支付模块｜签名校验超时 +重试");

  // --domain updates ticket title and blocks plain agent overwrite
  const domTitle = "【示例客户｜张三｜消息同步｜OPPO X6】图片无法显示";
  const r5 = await execFileAsync(process.execPath, [RENAME_SCRIPT, domTitle, "--domain", "--id", threadId, "--url", server.url]);
  assert.equal(JSON.parse(r5.stdout).name, domTitle);

  const r6 = await execFileAsync(process.execPath, [RENAME_SCRIPT, "新标题｜测试", "--id", threadId, "--url", server.url]);
  assert.equal(JSON.parse(r6.stdout).reason, "locked_by_domain");

  // User manual rename locks against everything
  const manualRes = await fetch(`${server.url}/api/thread/name`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ threadId, name: "人工锁定标题" }),
  });
  assert.equal(manualRes.status, 200);
  const r7 = await execFileAsync(process.execPath, [RENAME_SCRIPT, "--append", "补充", "--id", threadId, "--url", server.url]);
  assert.equal(JSON.parse(r7.stdout).reason, "locked_by_user");
});

test("ProviderHub debounces upstream thread_updated and inherits structured state across forks", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-hub-title-policy-"));
  const homes = Object.fromEntries(["codex", "agy"].map((p) => [p, resolve(root, p)]));
  await Promise.all(Object.values(homes).map((p) => mkdir(p, { recursive: true })));

  const hubEnv = {
    ...process.env,
    HOME: root,
    USERPROFILE: root,
    CODEX_BIN: MOCK_CODEX_BIN,
    AGY_BIN: MOCK_AGY_BIN,
    AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", home: homes.codex }]),
    AGENT_CONTROL_CLAUDE_CONFIG_DIRS: "[]",
    AGENT_CONTROL_AGY_APP_DATA_DIRS: JSON.stringify([{ id: "cli", home: homes.agy, profileType: "cli" }]),
    AGENT_CONTROL_GROK_HOMES: "[]",
  };
  const dataDir = resolve(root, "data");
  const codexProvider = new CodexProvider({ env: hubEnv, dataDir });
  const agyProvider = new AntigravityProvider({ env: hubEnv });
  let emitAgy = null;
  const origAgySetCallbacks = agyProvider.setCallbacks.bind(agyProvider);
  agyProvider.setCallbacks = (cbs) => {
    emitAgy = cbs.onEvent;
    return origAgySetCallbacks(cbs);
  };

  const events = [];
  const hub = new ProviderHub({
    dataDir,
    providers: [codexProvider, agyProvider],
    enableQueueDrain: false,
    env: hubEnv,
  });
  const unsub = hub.subscribe((eventName, payload) => {
    if (eventName === "thread_renamed") events.push(payload);
  });
  t.after(async () => {
    unsub();
    await hub.close();
    await rm(root, { recursive: true, force: true });
  });
  await hub.init();

  // Upstream thread_updated: first non-placeholder accepted once, subsequent updates ignored
  assert.equal(typeof emitAgy, "function");
  emitAgy({ type: "thread_updated", provider: "antigravity", profileId: "cli", rawId: "agy-s1", threadId: "antigravity:cli:agy-s1", title: "新会话" });
  emitAgy({ type: "thread_updated", provider: "antigravity", profileId: "cli", rawId: "agy-s1", threadId: "antigravity:cli:agy-s1", title: "首个上游标题" });
  emitAgy({ type: "thread_updated", provider: "antigravity", profileId: "cli", rawId: "agy-s1", threadId: "antigravity:cli:agy-s1", title: "第二轮飘移标题" });
  assert.deepEqual(events.map((e) => e.name), ["首个上游标题"]);

  // Fork from locked canonical thread inherits clean locked base (strips wrappers on append)
  const parentGood = await hub.startThread({ provider: "codex", profileId: "default", cwd: root, text: "父任务 [COMPLETE_NOW]" });
  await hub.renameThread(parentGood.thread.id, "模块A｜功能与性能评估", { source: "agent", lock: true });
  const forkGood = await hub.forkThread({ threadId: parentGood.thread.id, targetProvider: "antigravity", targetProfileId: "cli" });
  assert.match(forkGood.thread.name, /^模块A｜功能与性能评估 \(Antigravity 接续\)$/);

  const blockedForkOverwrite = await hub.renameThread(forkGood.thread.id, "新主干｜不应覆盖", { source: "agent" });
  assert.equal(blockedForkOverwrite.skipped, true);
  assert.equal(blockedForkOverwrite.reason, "primary_title_locked");

  const appendedFork = await hub.renameThread(forkGood.thread.id, "", { source: "agent", action: "append", suffix: "新季" });
  assert.equal(appendedFork.skipped, false);
  assert.equal(appendedFork.name, "模块A｜功能与性能评估 +新季");

  // Fork from vague legacy title stays draft so agent can fix it immediately
  const parentBad = await hub.startThread({ provider: "codex", profileId: "default", cwd: root, text: "继续 [COMPLETE_NOW]" });
  const forkBad = await hub.forkThread({ threadId: parentBad.thread.id, targetProvider: "antigravity", targetProfileId: "cli" });
  assert.match(forkBad.thread.name, /\(Antigravity 接续\)$/);
  const fixedFork = await hub.renameThread(forkBad.thread.id, "计费规则｜赠期按周期均摊", { source: "agent", lock: true });
  assert.equal(fixedFork.skipped, false);
  assert.equal(fixedFork.name, "计费规则｜赠期按周期均摊");

  // Draft auto-locks after 3rd user turn via sendTurn
  const draftThread = await hub.startThread({ provider: "codex", profileId: "default", cwd: root, text: "首轮 [COMPLETE_NOW]" });
  await hub.renameThread(draftThread.thread.id, "构建系统｜打包脚本", { source: "agent", lock: false });
  await hub.sendTurn({ threadId: draftThread.thread.id, cwd: root, text: "二轮补充 [COMPLETE_NOW]" });
  await hub.sendTurn({ threadId: draftThread.thread.id, cwd: root, text: "三轮追问 [COMPLETE_NOW]" });
  const after3Turns = await hub.renameThread(draftThread.thread.id, "其他｜尝试覆盖", { source: "agent" });
  assert.equal(after3Turns.skipped, true);
  assert.equal(after3Turns.reason, "primary_title_locked");
});
