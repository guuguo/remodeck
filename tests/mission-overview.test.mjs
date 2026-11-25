import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createThreadMetaStore } from "../src/thread-meta-store.mjs";
import {
  MissionOverviewService,
  classifyThreadRuleBased,
  isScratchNoiseCwd,
} from "../src/mission-overview-service.mjs";
import { renderMissionOverviewHtml, renderTycoonHudHtml } from "../public/mission-overview.js";
import { buildTycoonWorldLayout, computeStudioProgression, resolveStationArchetype, resolveWorkstationActivityState } from "../public/tycoon-3d.js";

async function seedGenericTestDomains(dataDir, topics = null) {
  const domains = [
    { id: "indie-lab", code: "LAB 01", name: "软件研发室", shortName: "软件研发", order: 1 },
    { id: "drama-studio", code: "STUDIO 02", name: "内容工坊", shortName: "内容工坊", order: 2 },
    { id: "global-pub", code: "GLOBAL 03", name: "发布增长部", shortName: "发布部", order: 3 },
    { id: "bounty-guild", code: "GUILD 04", name: "专项运维所", shortName: "专项所", order: 4 },
  ];
  const defaultTopics = topics || [
    {
      id: "translator-app",
      domainId: "indie-lab",
      name: "翻译插件",
      description: "插件商业化收款与支付回调",
      primaryCwd: "/Users/demo/workspace/translator-app",
      cwdPrefixes: ["/Users/demo/workspace/translator-app"],
      keywords: ["翻译插件", "支付回调", "商业化"],
      yieldType: "coin",
      yieldLabel: "直接金币变现",
      ledgerId: "translator-app",
      landmark: "comic",
      pinned: true,
      order: 1,
    },
    {
      id: "control-panel",
      domainId: "indie-lab",
      name: "控制台面板",
      description: "总控台、语音助手与主题优化",
      primaryCwd: "/Users/demo/workspace/control-panel",
      cwdPrefixes: ["/Users/demo/workspace/control-panel"],
      keywords: ["控制台", "control-panel", "语音助手", "日间模式"],
      yieldType: "growth",
      yieldLabel: "效率增长飞轮",
      landmark: "radar",
      pinned: true,
      order: 2,
    },
    {
      id: "landing-site",
      domainId: "indie-lab",
      name: "工具主站",
      description: "产品落地页与 SEO 收录",
      primaryCwd: "/Users/demo/workspace/landing-site",
      cwdPrefixes: ["/Users/demo/workspace/landing-site"],
      keywords: ["landing-site", "工具主站", "seo", "推广"],
      yieldType: "growth",
      yieldLabel: "涨粉引流飞轮",
      landmark: "lighthouse",
      pinned: false,
      order: 3,
    },
    {
      id: "video-channel",
      domainId: "global-pub",
      name: "视频矩阵",
      description: "视频剪辑与频道发布",
      primaryCwd: "/Users/demo/workspace/video-channel",
      cwdPrefixes: ["/Users/demo/workspace/video-channel"],
      keywords: ["video-channel", "视频", "youtube", "申诉"],
      yieldType: "coin",
      yieldLabel: "海外流量创收",
      landmark: "youtube",
      pinned: true,
      order: 1,
    },
    {
      id: "ops-service",
      domainId: "bounty-guild",
      name: "服务端运维",
      description: "线上排查与备用源检查",
      primaryCwd: "/Users/demo/workspace/ops-service",
      cwdPrefixes: ["/Users/demo/workspace/ops-service"],
      keywords: ["ops-service", "运维", "排查", "备用源"],
      yieldType: "bounty",
      yieldLabel: "委托稳底盘",
      landmark: "phone",
      pinned: false,
      order: 1,
    },
    {
      id: "scene-editor",
      domainId: "drama-studio",
      name: "3D 场景工坊",
      description: "家具透视与 3D 渲染",
      primaryCwd: "/Users/demo/workspace/scene-editor",
      cwdPrefixes: ["/Users/demo/workspace/scene-editor"],
      keywords: ["scene-editor", "3d", "透视", "场景"],
      yieldType: "bounty",
      yieldLabel: "专项交付",
      landmark: "cottage",
      pinned: false,
      order: 1,
    },
  ];
  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, "mission-domains.json"), JSON.stringify({
    version: 3,
    domains,
    topics: defaultTopics,
  }), "utf8");
  return defaultTopics;
}

function createMockHub(threads = [], profiles = null) {
  const metaStore = createThreadMetaStore({
    filePath: join(os.tmpdir(), `ac-mo-meta-${Date.now()}-${Math.random().toString(36).slice(2)}.json`),
  });
  const sentTurns = [];
  const startedThreads = [];
  const archivedIds = [];

  return {
    metaStore,
    sentTurns,
    startedThreads,
    archivedIds,
    async archiveThreads(ids = [], archived = true) {
      if (archived) archivedIds.push(...ids);
      return { ok: true, count: ids.length };
    },
    async listThreads() {
      return { threads };
    },
    listThreadsMeta() {
      return metaStore.listThreads();
    },
    async updateThreadTopic(threadId, topicId, stageTag) {
      return metaStore.setThreadTopic(threadId, topicId, stageTag);
    },
    async listProvidersAndProfiles() {
      if (profiles) return { profiles };
      return {
        profiles: [
          { provider: "codex", id: "default", installed: true, health: { disabled: false } },
          { provider: "claude", id: "default", installed: true, health: { disabled: false } },
        ],
      };
    },
    async sendTurn(payload) {
      sentTurns.push(payload);
      return { ok: true, turn: { id: `turn-${sentTurns.length}` } };
    },
    async startThread(payload) {
      const newThread = {
        id: `${payload.provider}:${payload.profileId}:spawn-${startedThreads.length + 1}`,
        provider: payload.provider,
        profileId: payload.profileId,
        cwd: payload.cwd,
        title: payload.text.slice(0, 24),
        preview: payload.text,
        firstUserText: payload.text,
        updatedAt: Math.floor(Date.now() / 1000),
        live: true,
      };
      startedThreads.push(payload);
      threads.unshift(newThread);
      return { thread: newThread, turn: { id: `turn-new-${startedThreads.length}` } };
    },
  };
}

test("MissionOverviewService reflects cross-workspace threads, reverse-slices multi-project drifted sessions, and groups parallel worker pods", async () => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-mo-test-"));
  try {
    const customTopics = await seedGenericTestDomains(dir);
  const nowSec = Math.floor(Date.now() / 1000);
    const threads = [
      {
        id: "antigravity:desktop:t1",
        provider: "antigravity",
        cwd: "/Users/demo/workspace/control-panel",
        title: "翻译插件·支付回调对接",
        preview: "完成赞助回调签名验证",
        updatedAt: nowSec - 120,
      },
      {
        id: "antigravity:desktop:drifted-voice",
        provider: "antigravity",
        cwd: "/Users/demo/workspace/control-panel",
        firstUserText: "优化我们的语音助手并修复打开没反应",
        title: "工具主站的seo 推广相关",
        preview: "更新 landing-site sitemap 与 meta",
        autoTitleIsDrift: true,
        updatedAt: nowSec - 180,
      },
      {
        id: "codex:default:voice-worker-1",
        provider: "codex",
        cwd: "/Users/demo/workspace/control-panel",
        firstUserText: "语音助手免提轮流说话优化",
        title: "语音助手免提轮流说话优化",
        preview: "VAD 过滤完成",
        updatedAt: nowSec - 240,
      },
      {
        id: "claude:default:voice-worker-2",
        provider: "claude",
        cwd: "/Users/demo/workspace/control-panel",
        firstUserText: "语音助手 TTS 播报队列修复",
        title: "语音助手 TTS 播报队列修复",
        preview: "TTS 播放正常",
        updatedAt: nowSec - 260,
        live: true,
      },
      {
        id: "antigravity:desktop:t4",
        provider: "antigravity",
        cwd: "/Users/demo/workspace/video-channel",
        title: "YouTube·视频剪辑发布",
        preview: "生成英文口播与字幕画面",
        updatedAt: nowSec - 900,
      },
      {
        id: "codex:default:t-spark",
        provider: "codex",
        cwd: "/Users/demo",
        firstUserText: "昨日灵感构想：能不能做个自动拆解视频钩子的小插件",
        title: "灵感构想：视频钩子拆解插件",
        preview: "初步想法记录",
        updatedAt: nowSec - 20 * 3600,
      },
      {
        id: "claude:default:t-scratch",
        provider: "claude",
        cwd: "/private/tmp/claude-501/demo-work/abc/scratchpad/gen3",
        title: "临时子代理草稿",
        preview: "",
        updatedAt: nowSec - 60,
      },
      {
        id: "codex:default:t-old",
        provider: "codex",
        cwd: "/Users/demo/workspace/control-panel",
        title: "两周前的旧优化",
        preview: "历史已归档",
        updatedAt: nowSec - 15 * 24 * 3600,
      },
    ];

    assert.equal(isScratchNoiseCwd(threads[6].cwd), true);
    assert.equal(classifyThreadRuleBased(threads[0], customTopics).topicId, "translator-app");

    const ledgerPath = join(dir, "projects.json");
    await writeFile(ledgerPath, JSON.stringify([
      {
        id: "translator-app",
        name: "翻译插件",
        root: "/Users/demo/workspace/translator-app",
        status: "active",
        next_review: "2026-11-28",
      },
    ]), "utf8");

    const hub = createMockHub(threads);
    const service = new MissionOverviewService({
      hub,
      dataDir: dir,
      projectValuePath: ledgerPath,
      collectGitImpl: async (cwd) => ({
        cwd,
        commits: ["abc1234 feat: test commit (1 hour ago)"],
        dirtyCount: cwd.includes("control-panel") ? 2 : 0,
      }),
      runAiImpl: async () => null,
    });

    const overview = await service.getOverview({ trigger: "view", force: false });
    const flatTopics = overview.domains.flatMap((d) => d.topics);
    const byId = Object.fromEntries(flatTopics.map((t) => [t.id, t]));

    assert.equal(byId["translator-app"].activeThreads.some((t) => t.id === "antigravity:desktop:t1"), true);
    assert.equal(byId["translator-app"].pipeline.stageIndex >= 4, true);
    assert.equal(byId["translator-app"].pipeline.readyToHarvest, false);
    assert.equal(byId["translator-app"].pipeline.harvestInferred, true);
    assert.equal(byId["translator-app"].pipeline.harvestEvidence, null);
    assert.equal(byId["translator-app"].valueLedger.status, "active");
    assert.equal(byId["translator-app"].valueLedger.nextReview, "2026-11-28");

    assert.equal(byId["landing-site"].activeThreads.some((t) => t.id === "antigravity:desktop:drifted-voice" && !t.isSlice), true);
    const slicedInCtrl = byId["control-panel"].activeThreads.find((t) => t.id === "antigravity:desktop:drifted-voice");
    assert.ok(slicedInCtrl, "drifted voice session should be reverse-sliced back into control-panel");
    assert.equal(slicedInCtrl.isSlice, true);
    assert.equal(slicedInCtrl.allFootprints.includes("语音助手"), true);

    const voicePod = byId["control-panel"].workerPods.find((p) => p.label === "语音助手");
    assert.ok(voicePod, "concurrent voice threads should form a Parallel Worker Pod");
    assert.equal(voicePod.count, 2);

    assert.equal(overview.incubator.eggs.some((e) => e.threadId === "codex:default:t-spark" && e.freshnessTier === "hot"), true);

    assert.equal(overview.bossFocus.length, 3);
    await service.toggleBossFocus("scene-editor");
    const afterPin = await service.getOverview({ trigger: "view" });
    assert.equal(afterPin.bossFocus[0].topicId, "scene-editor");

    const searchedHtml = renderMissionOverviewHtml(overview, { searchText: "语音助手" });
    assert.match(searchedHtml, /工具主站的seo 推广相关/);
    assert.equal(/\p{Extended_Pictographic}/u.test(searchedHtml), false);

    await service.upsertTopicMetrics({
      topicId: "video-channel",
      kpis: [
        { key: "subs", label: "YT 粉丝数", value: "3,680", delta: "+120", tone: "growth" },
        { key: "rev", label: "创收收入", value: "$428", delta: "本月", tone: "coin" },
      ],
    });
    const withMetrics = await service.getOverview({ trigger: "view" });
    const prog = computeStudioProgression(withMetrics);
    assert.equal(prog.level >= 1, true);
    const layout = buildTycoonWorldLayout(withMetrics, { searchText: "语音助手", selectedTopicId: "video-channel" });
    assert.equal(layout.rooms.length, 5);
    assert.equal(layout.workstations.length, 6);
    const ytWs = layout.workstations.find((w) => w.topicId === "video-channel");
    assert.equal(ytWs.landmark, "youtube");
    assert.equal(ytWs.kpis[0].label, "YT 粉丝数");
    assert.equal(ytWs.kpis[1].value, "$428");
    const cottageWs = layout.workstations.find((w) => w.topicId === "scene-editor");
    assert.equal(cottageWs.landmark, "cottage");
    const ctrlWs = layout.workstations.find((w) => w.topicId === "control-panel");
    assert.equal(ctrlWs.isSearchHit, true, "3D sky-beam should light up control-panel when searching 语音助手");
    assert.equal(layout.eggs.length >= 1, true);

    const hudHtml = renderTycoonHudHtml(withMetrics, {
      searchText: "语音助手",
      selectedTopicId: "video-channel",
    });
    assert.match(hudHtml, /3D 梦工厂/);
    assert.match(hudHtml, /左键按住拖拽平移地图/);
    assert.match(hudHtml, /YT 粉丝数/);
    assert.match(hudHtml, /\$428/);
    assert.equal(/\p{Extended_Pictographic}/u.test(hudHtml), false);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
  }
});

test("MissionOverviewService Smart Dispatcher reuses clean idle workstation, spawns parallel when busy/polluted, and splits multi-project prompts", async () => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-mo-dispatch-"));
  try {
    const customTopics = await seedGenericTestDomains(dir);
    const nowSec = Math.floor(Date.now() / 1000);
    const threads = [
      {
        id: "codex:default:clean-theme",
        provider: "codex",
        profileId: "default",
        cwd: "/Users/demo/workspace/control-panel",
        firstUserText: "适配日间模式亮色边框",
        title: "适配日间模式亮色边框",
        preview: "已完成 app.css 调整",
        updatedAt: nowSec - 300,
        live: false,
      },
      {
        id: "codex:default:busy-trans",
        provider: "codex",
        profileId: "default",
        cwd: "/Users/demo/workspace/translator-app",
        firstUserText: "接入支付回调 webhook",
        title: "接入支付回调 webhook",
        preview: "正在编写测试",
        updatedAt: nowSec - 60,
        live: true,
      },
    ];

    const hub = createMockHub(threads);
    const service = new MissionOverviewService({
      hub,
      dataDir: dir,
      projectValuePath: join(dir, "none.json"),
      collectGitImpl: async () => null,
      runAiImpl: async () => null,
    });

    const preview1 = await service.dispatchTask({
      text: "继续微调 控制台 日间模式按钮阴影",
      confirmOnly: true,
    });
    assert.equal(preview1.routes.length, 1);
    assert.equal(preview1.routes[0].action, "reuse_clean");
    assert.equal(preview1.routes[0].threadId, "codex:default:clean-theme");

    const exec1 = await service.dispatchTask({
      text: "继续微调 控制台 日间模式按钮阴影",
      confirmOnly: false,
    });
    assert.equal(exec1.dispatched[0].action, "reuse_clean");
    assert.equal(hub.sentTurns.length, 1);
    assert.equal(hub.sentTurns[0].threadId, "codex:default:clean-theme");

    const exec2 = await service.dispatchTask({
      text: "给翻译插件补上支付回调对账导出接口",
      confirmOnly: false,
    });
    assert.equal(exec2.dispatched.length, 1);
    assert.equal(exec2.dispatched[0].action, "spawn_parallel");
    assert.equal(exec2.dispatched[0].topicId, "translator-app");
    assert.equal(hub.startedThreads.length, 1);
    assert.equal(hub.startedThreads[0].cwd, "/Users/demo/workspace/translator-app");
    assert.equal(hub.startedThreads[0].memoryTopic, "translator-app", "dispatch passes its topic so the hub adds the memory pointer");
    assert.equal(hub.metaStore.listThreads()[exec2.dispatched[0].threadId].topicId, "translator-app");

    const exec3 = await service.dispatchTask({
      text: "1. 给服务端运维检查备用源连通性；2. 帮 3D 场景工坊排查透视角度",
      confirmOnly: false,
    });
    assert.equal(exec3.dispatched.length, 2);
    assert.equal(exec3.dispatched[0].topicId, "ops-service");
    assert.equal(exec3.dispatched[1].topicId, "scene-editor");

    const afterSpark = await service.handleSparkAction({
      action: "add",
      text: "做个桌面宠物联动工位状态的小挂件",
    });
    const addedEgg = afterSpark.overview.incubator.eggs.find((e) => e.kind === "manual");
    assert.ok(addedEgg);
    const afterChill = await service.handleSparkAction({ action: "chill", id: addedEgg.id });
    assert.equal(afterChill.overview.incubator.chilledCount >= 1, true);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
  }
});

test("MissionOverviewService enforces cooldown + fingerprint gating, manual locks, XSS safety, and zero emojis", async () => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-mo-gate-"));
  try {
    const customTopics = await seedGenericTestDomains(dir);
    const nowSec = Math.floor(Date.now() / 1000);
    const threads = [
      {
        id: "antigravity:desktop:x1",
        provider: "antigravity",
        cwd: "/Users/demo",
        title: "帮我看下工具主站 SEO <script>alert(1)</script>",
        preview: "调整落地页 meta",
        updatedAt: nowSec - 60,
      },
    ];
    const hub = createMockHub(threads);
    let aiCalls = 0;
    const service = new MissionOverviewService({
      hub,
      dataDir: dir,
      projectValuePath: join(dir, "none.json"),
      cooldownMs: 30 * 60 * 1000,
      collectGitImpl: async () => null,
      runAiImpl: async () => {
        aiCalls += 1;
        return JSON.stringify({
          assignments: {
            "antigravity:desktop:x1": { topicId: "landing-site", stage: "商业化·推广", secondaryTopicIds: ["control-panel"] },
          },
          topics: {
            "landing-site": {
              stageIndex: 4,
              progress: "已完成工具主站 SEO meta 调整",
              nextStep: "部署并验证收录",
              bottleneck: "差提交上线收录",
            },
          },
        });
      },
    });

    const first = await service.getOverview({ trigger: "open" });
    assert.equal(first.meta.summarizing, true);
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(aiCalls, 1);

    const second = await service.getOverview({ trigger: "open" });
    assert.equal(second.meta.summarizing, false);
    assert.equal(aiCalls, 1);

    const siteTopic = second.domains.flatMap((d) => d.topics).find((t) => t.id === "landing-site");
    assert.equal(siteTopic.summary.progress, "已完成工具主站 SEO meta 调整");
    assert.equal(siteTopic.pipeline.stageIndex, 4);
    assert.equal(siteTopic.pipeline.bottleneck, "差提交上线收录");

    await service.assignThreadTopic("antigravity:desktop:x1", "ops-service", "研发");
    const afterAssign = await service.getOverview({ trigger: "view" });
    const opsTopic = afterAssign.domains.flatMap((d) => d.topics).find((t) => t.id === "ops-service");
    assert.equal(opsTopic.activeThreads.some((t) => t.id === "antigravity:desktop:x1"), true);

    const html = renderMissionOverviewHtml(afterAssign, { searchText: "", immersive: true });
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /AI STUDIO TYCOON/);
    assert.equal(/\p{Extended_Pictographic}/u.test(html), false, "Overview HTML must not contain pictographic emojis");
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
  }
});

test("Smart Dispatcher routes to the right account: follows project history, remembers explicit picks, never reuses another account's session", async () => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-mo-agent-"));
  try {
    const customTopics = await seedGenericTestDomains(dir);
    const nowSec = Math.floor(Date.now() / 1000);
    const threads = [
      {
        id: "codex:personal:t1",
        provider: "codex",
        profileId: "personal",
        cwd: "/Users/demo/workspace/control-panel",
        firstUserText: "适配日间模式亮色边框",
        title: "适配日间模式亮色边框",
        preview: "已完成 app.css 调整",
        updatedAt: nowSec - 300,
      },
      {
        id: "codex:company:w1",
        provider: "codex",
        profileId: "company",
        cwd: "/Users/demo/workspace/ops-service",
        title: "线上监控告警排查",
        preview: "定位上报字段",
        updatedAt: nowSec - 600,
      },
    ];
    const profiles = [
      { provider: "codex", id: "company", label: "Codex 公司", installed: true, health: {}, account: { signedIn: true, email: "work@example.com" } },
      { provider: "codex", id: "personal", label: "Codex 自用", installed: true, health: {}, account: { signedIn: true, email: "me@example.com" } },
      { provider: "claude", id: "default", label: "Claude 默认", installed: true, health: {}, account: { signedIn: true, email: "claude@example.com" } },
      { provider: "grok", id: "default", label: "Grok 默认", installed: true, health: {}, account: { signedIn: false } },
    ];
    const hub = createMockHub(threads, profiles);
    const service = new MissionOverviewService({
      hub,
      dataDir: dir,
      projectValuePath: join(dir, "none.json"),
      collectGitImpl: async () => null,
      runAiImpl: async () => null,
    });

    const autoPreview = await service.dispatchTask({ text: "继续微调 控制台 日间模式按钮阴影", confirmOnly: true });
    assert.equal(autoPreview.routes[0].agentKey, "codex:personal");
    assert.equal(autoPreview.routes[0].agentSource, "affinity");
    assert.equal(autoPreview.routes[0].action, "reuse_clean");
    assert.match(autoPreview.routes[0].agentLabel, /me@example\.com/);

    const workPreview = await service.dispatchTask({ text: "继续排查线上监控告警", topicId: "ops-service", confirmOnly: true });
    assert.equal(workPreview.routes[0].agentKey, "codex:company");

    const explicit = await service.dispatchTask({
      text: "继续微调 控制台 日间模式按钮阴影",
      topicId: "control-panel",
      agentKey: "claude:default",
      model: "claude-sonnet-5-5",
    });
    assert.equal(explicit.dispatched[0].action, "spawn_parallel");
    assert.equal(hub.startedThreads.at(-1).provider, "claude");
    assert.equal(hub.startedThreads.at(-1).profileId, "default");
    assert.equal(hub.startedThreads.at(-1).model, "claude-sonnet-5-5");
    assert.equal(hub.sentTurns.length, 0);

    const remembered = await service.dispatchTask({ text: "再优化一下面板", topicId: "control-panel", confirmOnly: true });
    assert.equal(remembered.routes[0].agentKey, "claude:default");
    assert.equal(remembered.routes[0].agentSource, "remembered");
    const ov = await service.getOverview({ trigger: "view" });
    const ac = ov.domains.flatMap((d) => d.topics).find((t) => t.id === "control-panel");
    assert.equal(ac.agentPref, "claude:default");
    assert.equal(ac.agentAffinity.includes("codex:personal"), true);

    await assert.rejects(
      service.dispatchTask({ text: "测试", topicId: "control-panel", agentKey: "grok:default", confirmOnly: true }),
      /不可用/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
  }
});

test("Shared primaryCwd topics isolate per-topic .agent-metrics.<topicId>.json files without overwriting each other", async () => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-mo-shared-metrics-"));
  try {
    const sharedRepo = join(dir, "shared-repo");
    await mkdir(sharedRepo, { recursive: true });
    // Untagged legacy .agent-metrics.json must NOT leak across shared-cwd topics
    await writeFile(join(sharedRepo, ".agent-metrics.json"), JSON.stringify({
      updatedAt: "2026-11-18 20:50",
      kpis: [{ key: "yt", label: "YouTube", value: "2.4万", tone: "growth" }],
    }), "utf8");
    // Per-topic metrics files
    await writeFile(join(sharedRepo, ".agent-metrics.topic-cn.json"), JSON.stringify({
      topicId: "topic-cn",
      updatedAt: "2026-11-18 21:00",
      kpis: [{ key: "rev", label: "国内短剧收益", value: "¥1,280", tone: "coin", primary: true }],
    }), "utf8");
    await writeFile(join(sharedRepo, ".agent-metrics.topic-overseas.json"), JSON.stringify({
      topicId: "topic-overseas",
      updatedAt: "2026-11-18 21:01",
      kpis: [{ key: "yt", label: "YouTube订阅", value: "1,007", tone: "growth", primary: true }],
    }), "utf8");

    const customTopics = [
      { id: "topic-cn", domainId: "drama-studio", name: "国内漫剧", primaryCwd: sharedRepo, cwdPrefixes: [sharedRepo], keywords: ["国内"], yieldType: "coin", order: 1 },
      { id: "topic-overseas", domainId: "global-pub", name: "海外TikTok", primaryCwd: sharedRepo, cwdPrefixes: [], keywords: ["海外"], yieldType: "coin", order: 1 },
    ];
    const dataDir = join(dir, "data");
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, "mission-domains.json"), JSON.stringify({
      domains: [
        { id: "drama-studio", name: "漫剧影棚", shortName: "漫剧影棚", order: 1 },
        { id: "global-pub", name: "海外发行台", shortName: "海外发行", order: 2 },
      ],
      topics: customTopics,
    }), "utf8");
    const hub = createMockHub([]);
    const service = new MissionOverviewService({
      hub,
      dataDir,
      projectValuePath: join(dir, "none.json"),
      collectGitImpl: async () => null,
      runAiImpl: async () => null,
    });
    const ov = await service.getOverview({ trigger: "view", force: true });
    const allTopics = ov.domains.flatMap((d) => d.topics);
    const cn = allTopics.find((t) => t.id === "topic-cn");
    const osTopic = allTopics.find((t) => t.id === "topic-overseas");
    assert.equal(cn.metrics.kpis[0].label, "国内短剧收益");
    assert.equal(osTopic.metrics.kpis[0].label, "YouTube订阅");
    assert.match(cn.metrics.syncPrompt, /\.agent-metrics\.topic-cn\.json/);
    assert.match(osTopic.metrics.syncPrompt, /\.agent-metrics\.topic-overseas\.json/);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
  }
});

test("archiveAndSummarizeTopic previews stale threads, archives with dual-stored digest, and injects context on new dispatches", async () => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-mo-archive-ctx-"));
  try {
    const repoDir = join(dir, "repo");
    const dataDir = join(dir, "data");
    await mkdir(repoDir, { recursive: true });
    await mkdir(dataDir, { recursive: true });
    await writeFile(join(dataDir, "mission-domains.json"), JSON.stringify({
      version: 3,
      domains: [{ id: "indie-lab", name: "软件研发室", shortName: "软件研发", order: 1 }],
      topics: [{
        id: "demo-line",
        domainId: "indie-lab",
        name: "示例产线",
        primaryCwd: repoDir,
        cwdPrefixes: [repoDir],
        keywords: ["示例"],
        yieldType: "growth",
        order: 1,
      }],
    }), "utf8");

    const nowSec = Math.floor(Date.now() / 1000);
    const threads = [
      { id: "codex:default:stale-1", provider: "codex", profileId: "default", cwd: repoDir, title: "完成登录鉴权重构", preview: "已切换 JWT 双令牌", updatedAt: nowSec - 5 * 86400, live: false },
      { id: "codex:default:stale-pinned", provider: "codex", profileId: "default", cwd: repoDir, title: "置顶规范不归档", preview: "长期保留", updatedAt: nowSec - 10 * 86400, live: false, pinned: true },
      { id: "codex:default:recent-1", provider: "codex", profileId: "default", cwd: repoDir, title: "近期按钮样式", preview: "刚改完", updatedAt: nowSec - 3600, live: false },
    ];
    const hub = createMockHub(threads);
    const service = new MissionOverviewService({
      hub,
      dataDir,
      projectValuePath: join(dir, "none.json"),
      collectGitImpl: async () => null,
      runAiImpl: async () => "已完成 JWT 双令牌登录鉴权重构，接口契约与测试已冻结。",
    });

    const preview = await service.archiveAndSummarizeTopic({ topicId: "demo-line", staleDays: 3, confirmOnly: true });
    assert.equal(preview.candidates.length, 1);
    assert.equal(preview.candidates[0].id, "codex:default:stale-1");

    const executed = await service.archiveAndSummarizeTopic({ topicId: "demo-line", staleDays: 3, confirmOnly: false });
    assert.equal(executed.archivedCount, 1);
    assert.deepEqual(hub.archivedIds, ["codex:default:stale-1"]);
    assert.match(executed.digest.summary, /JWT 双令牌/);
    assert.match(executed.digest.contextFilePath, /\.agent-context\.demo-line\.md$/);

    // New parallel spawn defaults to injecting the archive digest
    await service.dispatchTask({ text: "新增导出接口", topicId: "demo-line", mode: "new", confirmOnly: false });
    assert.match(hub.startedThreads[0].text, /产线历史归档上下文/);
    assert.match(hub.startedThreads[0].text, /JWT 双令牌/);

    // Opting out skips context injection
    await service.dispatchTask({ text: "纯独立测试", topicId: "demo-line", mode: "new", inheritContext: false, confirmOnly: false });
    assert.doesNotMatch(hub.startedThreads[1].text, /产线历史归档上下文/);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
  }
});

test("Adaptive dispatch respects configurable priority, avoids exhausted quotas, and selects model tiers by task difficulty", async () => {
  const {
    classifyDispatchTaskDifficulty,
    classifyDispatchTaskSpecialty,
    selectAdaptiveModelForRoute,
  } = await import("../src/mission-overview-service.mjs");

  assert.equal(classifyDispatchTaskDifficulty("深度重构鉴权架构并排查跨仓库内存泄漏根因"), "heavy");
  assert.equal(classifyDispatchTaskDifficulty("查一下状态"), "fast");
  assert.equal(classifyDispatchTaskDifficulty("新增导出接口并补齐单测"), "balanced");
  assert.equal(classifyDispatchTaskSpecialty("深度重构鉴权架构并排查并发死锁根因"), "hardcore");
  assert.equal(classifyDispatchTaskSpecialty("帮我策划一个短剧分镜脚本与前端视觉设计"), "creative");

  const heavyCodex = selectAdaptiveModelForRoute({
    provider: "codex",
    difficulty: "heavy",
    availableModels: [
      { id: "gpt-6.2-sol", model: "gpt-6.2-sol" },
      { id: "gpt-6.2-astra", model: "gpt-6.2-astra" },
    ],
  });
  assert.equal(heavyCodex.model, "gpt-6.2-sol");
  assert.equal(heavyCodex.effort, "high");

  const fastCodex = selectAdaptiveModelForRoute({
    provider: "codex",
    difficulty: "fast",
    availableModels: [
      { id: "gpt-6.2-sol", model: "gpt-6.2-sol" },
      { id: "gpt-6.2-astra", model: "gpt-6.2-astra" },
    ],
  });
  assert.equal(fastCodex.model, "gpt-6.2-sol");
  assert.equal(fastCodex.effort, "low");

  const dir = await mkdtemp(join(os.tmpdir(), "ac-dispatch-adaptive-"));
  try {
    const hub = {
      async listThreads() { return { threads: [] }; },
      async listProvidersAndProfiles() {
        return {
          defaultProvider: "codex",
          defaultProfileId: "default",
          profiles: [
            {
              provider: "codex",
              id: "default",
              label: "Codex 默认",
              installed: true,
              account: { signedIn: true },
              quota: { status: "exhausted", windows: { weekly: { remainingPercent: 0 }, fiveHour: { remainingPercent: 0 } } },
            },
            {
              provider: "claude",
              id: "default",
              label: "Claude 默认",
              installed: true,
              account: { signedIn: true },
              quota: { status: "ok", windows: { weekly: { remainingPercent: 92 }, fiveHour: { remainingPercent: 88 } } },
            },
            {
              provider: "antigravity",
              id: "desktop",
              label: "Antigravity",
              installed: true,
              account: { signedIn: true },
              quota: { status: "ok", windows: { weekly: { remainingPercent: 60 }, fiveHour: { remainingPercent: 70 } } },
            },
          ],
        };
      },
      async listModels(provider) {
        if (provider === "claude") {
          return [{ id: "claude-opus-5-5" }, { id: "claude-sonnet-5-5" }, { id: "claude-haiku-4-5" }];
        }
        if (provider === "antigravity") {
          return [{ id: "gemini-4-pro" }, { id: "gemini-4-hydrogen" }];
        }
        return [{ id: "gpt-6.2-sol" }, { id: "gpt-6.2-astra" }];
      },
    };
    const service = new MissionOverviewService({
      hub,
      dataDir: dir,
      topics: [{ id: "demo", domainId: "lab-forge", name: "Demo", primaryCwd: dir, cwdPrefixes: [dir], keywords: ["demo"] }],
    });

    // Adaptive / quota mode avoids exhausted Codex and picks high-quota Claude with flagship Opus for heavy task.
    const heavyRes = await service.dispatchTask({
      text: "深度重构系统架构并排查并发死锁根因",
      topicId: "demo",
      confirmOnly: true,
    });
    assert.equal(heavyRes.routes[0].provider, "claude");
    assert.equal(heavyRes.routes[0].model, "claude-opus-5-5");
    assert.equal(heavyRes.routes[0].effort, "high");
    assert.equal(heavyRes.routes[0].taskDifficulty, "heavy");

    // Switching priority to custom provider order picks Antigravity first + fast model for lightweight task.
    await service.updateDispatchPrefs({ strategy: "provider", providerOrder: ["antigravity", "claude", "codex", "grok"] });
    const fastRes = await service.dispatchTask({
      text: "查一下状态",
      topicId: "demo",
      confirmOnly: true,
    });
    assert.equal(fastRes.routes[0].provider, "antigravity");
    assert.equal(fastRes.routes[0].model, "gemini-4-hydrogen");
    assert.equal(fastRes.routes[0].effort, "low");
    assert.equal(fastRes.routes[0].taskDifficulty, "fast");
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
  }
});

test("Zero-preset fresh install auto-discovers topics from user's local workspace threads", async () => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-mo-autodiscover-"));
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const threads = [
      { id: "codex:default:r1", provider: "codex", cwd: "/Users/alice/dev/my-saas-app", title: "实现订阅支付接口", updatedAt: nowSec - 100 },
      { id: "claude:default:r2", provider: "claude", cwd: "/Users/alice/dev/video-maker", title: "剪辑产品宣传视频", updatedAt: nowSec - 200 },
      { id: "codex:default:r3", provider: "codex", cwd: "/private/tmp/claude-501/demo/abc/scratchpad/gen1", title: "临时测试", updatedAt: nowSec - 50 },
    ];
    const hub = createMockHub(threads);
    const service = new MissionOverviewService({
      hub,
      dataDir: dir,
      projectValuePath: join(dir, "none.json"),
      collectGitImpl: async () => null,
      runAiImpl: async () => null,
    });
    const ov = await service.getOverview({ trigger: "view" });
    const topics = ov.domains.flatMap((d) => d.topics);
    assert.equal(topics.length, 2);
    assert.equal(topics.some((t) => t.primaryCwd === "/Users/alice/dev/my-saas-app" && t.autoDiscovered), true);
    assert.equal(topics.some((t) => t.primaryCwd === "/Users/alice/dev/video-maker" && t.domainId === "drama-studio"), true);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
  }
});

test("planAndApplyBlueprintEdit supports deterministic & AI-assisted natural-language Dream Factory corrections", async () => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-mo-reorg-"));
  try {
    const nowSec = Math.floor(Date.now() / 1000);
    const threads = [
      { id: "codex:default:r1", provider: "codex", cwd: "/Users/alice/dev/web-ui", title: "前端页面", updatedAt: nowSec - 100 },
      { id: "codex:default:r2", provider: "codex", cwd: "/Users/alice/dev/api-core", title: "后端接口", updatedAt: nowSec - 200 },
      { id: "codex:default:r3", provider: "codex", cwd: "/Users/alice/dev/junk-demo", title: "旧测试", updatedAt: nowSec - 300 },
    ];
    const hub = createMockHub(threads);
    const service = new MissionOverviewService({
      hub,
      dataDir: dir,
      projectValuePath: join(dir, "none.json"),
      collectGitImpl: async () => null,
      runAiImpl: async () => JSON.stringify({
        summary: "把 web-ui 与 api-core 合并并改名为全栈主线，同时移除 junk-demo",
        operations: [
          { type: "merge", sourceTopicId: "web-ui", targetTopicId: "api-core", newName: "全栈主线" },
          { type: "remove", topicId: "junk-demo" },
        ],
      }),
    });

    // Trigger auto-discovery
    await service.getOverview({ trigger: "view" });

    // 1. Deterministic rename + move preview & apply
    const detPreview = await service.planAndApplyBlueprintEdit({
      instruction: "把 web-ui 改名为 官网前端，把 web-ui 移到 发布与增长部",
      confirmOnly: true,
    });
    assert.equal(detPreview.pendingConfirmation, true);
    assert.equal(detPreview.aiUsed, false);
    assert.equal(detPreview.operations.length, 2);

    const detApplied = await service.planAndApplyBlueprintEdit({
      instruction: detPreview.instruction,
      operations: detPreview.operations,
      confirmOnly: false,
    });
    assert.equal(detApplied.appliedCount, 2);
    let topics = detApplied.overview.domains.flatMap((d) => d.topics);
    const renamed = topics.find((t) => t.id === "web-ui");
    assert.equal(renamed.name, "官网前端");
    assert.equal(renamed.domainId, "global-pub");

    // 2. AI fallback for complex multi-step reorganization
    const aiPreview = await service.planAndApplyBlueprintEdit({
      instruction: "帮我把前后端合在一起叫全栈主线，废掉那个旧测试",
      confirmOnly: true,
    });
    assert.equal(aiPreview.aiUsed, true);
    assert.equal(aiPreview.operations.length, 2);

    const aiApplied = await service.planAndApplyBlueprintEdit({
      operations: aiPreview.operations,
      confirmOnly: false,
    });
    assert.equal(aiApplied.appliedCount, 2);
    topics = aiApplied.overview.domains.flatMap((d) => d.topics);
    assert.equal(topics.length, 1);
    assert.equal(topics[0].name, "全栈主线");
    assert.equal(topics[0].cwdPrefixes.includes("/Users/alice/dev/web-ui"), true);
    assert.equal(topics[0].cwdPrefixes.includes("/Users/alice/dev/api-core"), true);
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
  }
});

test("resolveWorkstationActivityState separates working, pending, and resting states without harvest masking", () => {
  const multiWorkingHarvest = resolveWorkstationActivityState({
    liveCount: 2,
    pendingCount: 0,
    readyToHarvest: true,
  });
  assert.deepEqual(multiWorkingHarvest, {
    state: "working",
    intensityTier: 2,
    isWorking: true,
    isPending: false,
    isResting: false,
    statusText: "火力全开 ×2",
    showHarvest: true,
  });

  const overdriveWorking = resolveWorkstationActivityState({
    liveCount: 3,
    pendingCount: 0,
    readyToHarvest: true,
  });
  assert.deepEqual(overdriveWorking, {
    state: "working",
    intensityTier: 3,
    isWorking: true,
    isPending: false,
    isResting: false,
    statusText: "超频爆气 ×3",
    showHarvest: true,
  });

  const singleWorking = resolveWorkstationActivityState({
    liveCount: 1,
    pendingCount: 0,
    readyToHarvest: false,
  });
  assert.deepEqual(singleWorking, {
    state: "working",
    intensityTier: 1,
    isWorking: true,
    isPending: false,
    isResting: false,
    statusText: "工作中",
    showHarvest: false,
  });

  const pendingWithWork = resolveWorkstationActivityState({
    liveCount: 1,
    pendingCount: 1,
    readyToHarvest: true,
  });
  assert.deepEqual(pendingWithWork, {
    state: "pending",
    intensityTier: 1,
    isWorking: true,
    isPending: true,
    isResting: false,
    statusText: "待拍板 1",
    showHarvest: true,
  });

  const restingHarvest = resolveWorkstationActivityState({
    liveCount: 0,
    pendingCount: 0,
    readyToHarvest: true,
  });
  assert.deepEqual(restingHarvest, {
    state: "resting",
    intensityTier: 0,
    isWorking: false,
    isPending: false,
    isResting: true,
    statusText: "休息中",
    showHarvest: true,
  });

  const pureResting = resolveWorkstationActivityState({
    liveCount: 0,
    pendingCount: 0,
    readyToHarvest: false,
  });
  assert.deepEqual(pureResting, {
    state: "resting",
    intensityTier: 0,
    isWorking: false,
    isPending: false,
    isResting: true,
    statusText: "休息中",
    showHarvest: false,
  });
});

test("each department gets a distinct station archetype and layout exposes it", () => {
  assert.equal(resolveStationArchetype("indie-lab"), "code");
  assert.equal(resolveStationArchetype("drama-studio"), "studio");
  assert.equal(resolveStationArchetype("global-pub"), "broadcast");
  assert.equal(resolveStationArchetype("bounty-guild"), "workshop");
  assert.equal(resolveStationArchetype("unknown-room"), "code");

  const layout = buildTycoonWorldLayout({
    domains: [
      { id: "indie-lab", topics: [{ id: "a", name: "A" }] },
      { id: "drama-studio", topics: [{ id: "b", name: "B" }] },
      { id: "global-pub", topics: [{ id: "c", name: "C" }] },
      { id: "bounty-guild", topics: [{ id: "d", name: "D" }] },
    ],
  });
  assert.deepEqual(
    layout.workstations.map((w) => w.archetype),
    ["code", "studio", "broadcast", "workshop"],
  );
});

test("overview, tycoon HUD, and project board render recent unread completed indicators and compact 3m relative times", async () => {
  const { renderMissionOverviewHtml, renderTycoonHudHtml } = await import("../public/mission-overview.js");
  const { renderProjectBoardHtml } = await import("../public/project-board.js");

  const nowSec = Math.floor(Date.now() / 1000);
  const doneThread = {
    id: "codex:default:recent-done-1",
    provider: "codex",
    profileId: "default",
    cwd: "/Users/alice/dev/demo",
    title: "已完成未读测试会话",
    preview: "已完成校验",
    updatedAt: nowSec - 180,
    live: false,
    pendingCount: 0,
    queuedCount: 0,
    stage: "研发",
  };
  const liveThread = {
    id: "claude:default:live-1",
    provider: "claude",
    profileId: "default",
    cwd: "/Users/alice/dev/demo",
    title: "运行中测试会话",
    updatedAt: nowSec - 30,
    live: true,
    pendingCount: 0,
    queuedCount: 0,
    stage: "研发",
  };
  const recentCompletedByThread = new Map([
    [doneThread.id, { status: "completed", summary: "已完成校验", at: Date.now(), updatedAt: doneThread.updatedAt }],
  ]);
  const topic = {
    id: "demo-topic",
    domainId: "indie-lab",
    name: "示例产线",
    primaryCwd: "/Users/alice/dev/demo",
    yieldType: "growth",
    pipeline: { stageIndex: 2, stageLabel: "研发", readyToHarvest: false },
    activeThreads: [doneThread, liveThread],
    archivedThreads: [],
  };
  const overview = {
    domains: [{ id: "indie-lab", name: "软件研发室", shortName: "研发室", topics: [topic] }],
    topics: [topic],
    bossFocus: [],
    incubator: { eggs: [], chilled: [], totalActive: 0, chilledCount: 0 },
    unassignedActive: [],
    radar: { liveThreads: [liveThread], pendingThreads: [], totalActiveCount: 2, driftedCount: 0, harvestReadyCount: 0 },
    meta: {},
  };

  const overviewHtml = renderMissionOverviewHtml(overview, { recentCompletedByThread });
  assert.match(overviewHtml, /is-recent-done/);
  assert.match(overviewHtml, /新完成/);
  assert.match(overviewHtml, />3m</);
  assert.doesNotMatch(overviewHtml, />3分钟前</);

  const hudHtml = renderTycoonHudHtml(overview, {
    inspectorMode: "recent_done",
    recentCompletedByThread,
  });
  assert.match(hudHtml, /data-tycoon-open-recent-done="1"/);
  assert.match(hudHtml, /最近完成未读 · 1 条/);
  assert.match(hudHtml, /已完成未读测试会话/);
  assert.match(hudHtml, />3m</);

  const boardHtml = renderProjectBoardHtml({
    groups: [{
      cwd: "/Users/alice/dev/demo",
      name: "demo",
      pinned: true,
      liveCount: 1,
      pendingCount: 0,
      threads: [doneThread, liveThread],
    }],
    recentCompletedByThread,
  });
  assert.match(boardHtml, /board-task-row[^"]*is-recent-done/);
  assert.match(boardHtml, /board-status-pill is-recent-done/);
  assert.match(boardHtml, />3m</);
});


test("AI-assisted sprite dispatch plans semantic splits, chat-only replies, approvedRoutes execution, and deterministic fallback", async () => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-overview-ai-dispatch-"));
  let aiBehavior = "split";

  const hub = createMockHub(
    [
      {
        id: "antigravity:cli:ui-1",
        provider: "antigravity",
        profileId: "cli",
        title: "梦工厂 3D 卡片排版",
        firstUserText: "梦工厂 3D 卡片排版",
        cwd: "/repo/control-panel",
        live: false,
        pendingCount: 0,
        updatedAt: Math.floor(Date.now() / 1000) - 300,
      },
    ],
    [
      { provider: "codex", id: "personal", name: "Codex 主力", installed: true, quota: { windows: { weekly: { remainingPercent: 88 } } } },
      { provider: "antigravity", id: "cli", name: "Agy 创意", installed: true, quota: { windows: { weekly: { remainingPercent: 92 } } } },
    ],
  );
  const sent = hub.sentTurns;
  const started = hub.startedThreads;

  try {
    await seedGenericTestDomains(dir, [
      {
        id: "control-panel",
        domainId: "indie-lab",
        name: "控制台",
        primaryCwd: "/repo/control-panel",
        cwdPrefixes: ["/repo/control-panel"],
        keywords: ["控制台"],
        order: 1,
      },
      {
        id: "manga-trans",
        domainId: "indie-lab",
        name: "图片翻译",
        primaryCwd: "/repo/manga",
        cwdPrefixes: ["/repo/manga"],
        keywords: ["图片翻译"],
        order: 2,
      },
    ]);
    const service = new MissionOverviewService({
      hub,
      dataDir: dir,
      collectGitImpl: async () => null,
      runAiImpl: async () => {
        if (aiBehavior === "chat") {
          return {
            intent: "chat",
            reply: "当前建议先处理控制台登录态问题，再推进图片翻译上线。",
            tasks: [],
          };
        }
        if (aiBehavior === "broken") {
          throw new Error("simulated AI failure");
        }
        return {
          intent: "dispatch",
          reply: "已帮你拆成两单：UI 走查复用 Agy 空闲工位，死锁排查新开 Codex 并发处理。",
          tasks: [
            {
              topicId: "control-panel",
              instruction: "走查梦工厂弹窗响应式样式",
              specialty: "creative",
              difficulty: "fast",
              agentKey: "antigravity:cli",
              action: "reuse_clean",
              targetThreadId: "antigravity:cli:ui-1",
              reason: "复用同项目空闲 UI 工位",
            },
            {
              topicId: "manga-trans",
              instruction: "排查后台任务队列并发死锁根因",
              specialty: "hardcore",
              difficulty: "heavy",
              agentKey: "codex:personal",
              action: "spawn_parallel",
              targetThreadId: "",
              reason: "硬核并发排查由 Codex 新开干净工位",
            },
          ],
        };
      },
    });

    // 1. AI semantic split + reuse + spawn
    const preview = await service.dispatchTask({
      text: "把弹窗样式再顺一下，另外队列好像有并发死锁去查一下",
      confirmOnly: true,
      useAiPlanner: true,
    });
    assert.equal(preview.aiPlanned, true);
    assert.match(preview.reply || "", /拆成两单/);
    assert.equal(preview.routes.length, 2);
    assert.equal(preview.routes[0].topicId, "control-panel");
    assert.equal(preview.routes[0].action, "reuse_clean");
    assert.equal(preview.routes[0].threadId, "antigravity:cli:ui-1");
    assert.equal(preview.routes[0].agentSource, "ai");
    assert.equal(preview.routes[1].topicId, "manga-trans");
    assert.equal(preview.routes[1].action, "spawn_parallel");
    assert.equal(preview.routes[1].agentKey, "codex:personal");

    // 2. Confirming with approvedRoutes executes exact previewed routes without re-planning
    const execRes = await service.dispatchTask({
      text: "把弹窗样式再顺一下，另外队列好像有并发死锁去查一下",
      confirmOnly: false,
      approvedRoutes: preview.routes,
    });
    assert.equal(execRes.dispatched.length, 2);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].threadId, "antigravity:cli:ui-1");
    assert.equal(started.length, 1);
    assert.equal(started[0].provider, "codex");
    assert.equal(started[0].cwd, "/repo/manga");

    // 3. Chat-only intent does not fabricate dispatch routes
    aiBehavior = "chat";
    const chatRes = await service.dispatchTask({
      text: "现在先做哪件事比较好？",
      confirmOnly: true,
      useAiPlanner: true,
    });
    assert.equal(chatRes.chatOnly, true);
    assert.equal(chatRes.routes.length, 0);
    assert.match(chatRes.reply || "", /当前建议/);

    // 4. Seamless fallback to deterministic rule engine when AI fails
    aiBehavior = "broken";
    const fallbackRes = await service.dispatchTask({
      text: "帮图片翻译补一个单测",
      confirmOnly: true,
      useAiPlanner: true,
    });
    assert.equal(fallbackRes.aiPlanned, false);
    assert.equal(fallbackRes.routes.length, 1);
    assert.equal(fallbackRes.routes[0].topicId, "manga-trans");
  } finally {
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }).catch(() => {});
  }
});
