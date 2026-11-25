import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSpriteOpeningBriefing,
  buildSpriteQueryReply,
  captureSpriteOverviewSnapshot,
  classifySpriteUserInput,
  diffSpriteOverviewEvents,
  renderSpriteAssistantHtml,
} from "../public/sprite-assistant.js";

const mockOverview = {
  topics: [
    { id: "manga-trans", name: "图片翻译" },
    { id: "ops-service", name: "服务端运维" },
  ],
  bossFocus: [
    {
      topicId: "manga-trans",
      name: "图片翻译",
      stageIndex: 3,
      stageLabel: "打磨",
      readyToHarvest: true,
      bottleneck: "缺会员订阅回调日志",
      nextStep: "补齐会员订阅回调验收",
    },
  ],
  radar: {
    liveThreads: [{ id: "codex:default:t1", title: "日志联调" }],
    pendingThreads: [],
    harvestReadyCount: 1,
  },
  domains: [
    {
      id: "indie-lab",
      topics: [
        {
          id: "manga-trans",
          name: "图片翻译",
          pipeline: { readyToHarvest: true },
          nextStep: "补齐会员订阅回调验收",
          activeThreads: [{ id: "codex:default:t1", title: "日志联调", live: true }],
        },
        {
          id: "ops-service",
          name: "服务端运维",
          pipeline: { readyToHarvest: false },
          activeThreads: [{ id: "claude:default:t2", title: "录音排查", live: false }],
        },
      ],
    },
  ],
};

test("Sprite Assistant generates opening briefing and detects pending/harvest/completed/failed events", () => {
  const brief = buildSpriteOpeningBriefing(mockOverview, []);
  assert.match(brief.text, /1 名 AI 员工正在运转/);
  assert.match(brief.text, /图片翻译/);
  assert.equal(brief.tone, "coin");

  const snap1 = captureSpriteOverviewSnapshot(mockOverview, []);
  const nextOverview = structuredClone(mockOverview);
  nextOverview.radar.liveThreads = [];
  nextOverview.domains[0].topics[0].activeThreads[0].live = false;
  nextOverview.radar.pendingThreads = [
    { id: "claude:default:t2", title: "录音排查", pendingCount: 1 },
  ];
  nextOverview.domains[0].topics[1].pipeline.readyToHarvest = true;

  const snap2 = captureSpriteOverviewSnapshot(nextOverview, []);
  const events = diffSpriteOverviewEvents(snap1, snap2);
  const types = events.map((e) => e.type);
  assert.deepEqual(types, ["pending", "harvest", "completed"]);

  // Verify failed transition detection
  const snapFailNext = captureSpriteOverviewSnapshot(
    {
      ...mockOverview,
      radar: { liveThreads: [], pendingThreads: [] },
      domains: [
        {
          id: "indie-lab",
          topics: [
            {
              id: "manga-trans",
              name: "图片翻译",
              pipeline: { readyToHarvest: true },
              activeThreads: [{ id: "codex:default:t1", title: "日志联调", live: false, lastError: "API timeout" }],
            },
          ],
        },
      ],
    },
    [],
  );
  const failEvents = diffSpriteOverviewEvents(snap1, snapFailNext);
  assert.equal(failEvents[0]?.type, "failed");
  assert.match(failEvents[0]?.text || "", /API timeout/);
});

test("Sprite Assistant classifies confirm/cancel/queries/dispatch and escapes XSS in preview card", () => {
  const agentOptions = [
    { key: "antigravity:cli", provider: "antigravity", label: "Antigravity" },
    { key: "codex:default", provider: "codex", label: "Codex" },
  ];

  assert.equal(classifySpriteUserInput("确认", { hasPendingPreview: true }).intent, "confirm_preview");
  assert.equal(classifySpriteUserInput("算了", { hasPendingPreview: true }).intent, "cancel_preview");
  assert.equal(classifySpriteUserInput("汇报进展").intent, "briefing");
  assert.equal(classifySpriteUserInput("谁待拍板").intent, "query_pending");
  assert.equal(classifySpriteUserInput("准收菜").intent, "query_harvest");

  const disp = classifySpriteUserInput("帮我派单：用 Antigravity 给图片翻译新开分身补齐回调日志", {
    overview: mockOverview,
    agentOptions,
  });
  assert.equal(disp.intent, "dispatch_preview");
  assert.equal(disp.agentKey, "antigravity:cli");
  assert.equal(disp.topicId, "manga-trans");
  assert.equal(disp.mode, "new");

  const queryPending = buildSpriteQueryReply("query_pending", mockOverview, []);
  assert.match(queryPending.text, /没有需要拍板/);

  const html = renderSpriteAssistantHtml({
    open: true,
    ttsEnabled: true,
    messages: [{ role: "sprite", text: "你好 <script>alert(1)</script>" }],
    pendingPreview: {
      payload: { model: "gemini-4-pro" },
      routes: [
        {
          action: "reuse_clean",
          topicName: "图片翻译 <img onerror=alert(1)>",
          agentLabel: "Antigravity",
          reason: "复用空闲干净工位",
        },
      ],
    },
  }, { is3dMode: true });

  assert.doesNotMatch(html, /<script>|<img onerror/);
  assert.match(html, /确认派出/);
  assert.match(html, /Antigravity/);
  assert.match(html, /gemini-4-pro/);
});

test("Sprite Assistant supports scoped topic archive preview, confirm, and context inheritance UI", () => {
  const archCmd = classifySpriteUserInput("把过去很久的对话归档总结", {
    scopedTopicId: "manga-trans",
    overview: mockOverview,
  });
  assert.equal(archCmd.intent, "archive_preview");
  assert.equal(archCmd.topicId, "manga-trans");
  assert.equal(archCmd.staleDays, 3);

  assert.equal(
    classifySpriteUserInput("确认", { hasPendingArchive: true }).intent,
    "confirm_archive",
  );
  assert.equal(
    classifySpriteUserInput("取消", { hasPendingArchive: true }).intent,
    "cancel_archive",
  );

  const archHtml = renderSpriteAssistantHtml({
    open: true,
    scopedTopicId: "manga-trans",
    scopedTopicName: "图片翻译",
    pendingArchive: {
      topicId: "manga-trans",
      topicName: "图片翻译",
      staleDays: 3,
      candidates: [{ id: "t1", title: "旧会话 <script>x</script>", preview: "已完成", idleDays: 5 }],
    },
  });
  assert.doesNotMatch(archHtml, /<script>x<\/script>/);
  assert.match(archHtml, /确认归档 \(1\)/);
  assert.match(archHtml, /\.agent-context\.manga-trans\.md/);

  const inheritHtml = renderSpriteAssistantHtml({
    open: true,
    pendingPreview: {
      payload: { inheritContext: true },
      routes: [{ action: "spawn_parallel", topicName: "图片翻译", hasTopicDigest: true, agentLabel: "Agy" }],
    },
  });
  assert.match(inheritHtml, /继承归档记忆/);
  assert.match(inheritHtml, /data-sprite-toggle-inherit/);

  const reorgCmd = classifySpriteUserInput("把 web-ui 改名为 官网前端，然后移到内容工坊", {
    overview: mockOverview,
  });
  assert.equal(reorgCmd.intent, "reorg_preview");
  assert.equal(classifySpriteUserInput("确认", { hasPendingReorg: true }).intent, "confirm_reorg");
  assert.equal(classifySpriteUserInput("取消", { hasPendingReorg: true }).intent, "cancel_reorg");

  const reorgHtml = renderSpriteAssistantHtml({
    open: true,
    pendingReorg: {
      summary: "重命名并调整房区",
      operations: [{ type: "rename", label: "重命名产线：「web-ui」→「官网前端」<script>x</script>" }],
    },
  });
  assert.doesNotMatch(reorgHtml, /<script>x<\/script>/);
  assert.match(reorgHtml, /梦工厂布局调整方案/);
  assert.match(reorgHtml, /确认调整/);
});

test("Sprite Assistant skips excluded accounts on provider match and renders excluded accounts drawer", () => {
  const agentOptions = [
    { key: "codex:company", provider: "codex", providerLabel: "Codex", label: "张苍", excluded: true },
    { key: "codex:personal", provider: "codex", providerLabel: "Codex", label: "个人主力", excluded: false },
  ];

  const disp = classifySpriteUserInput("用 Codex 给图片翻译修个问题", {
    overview: mockOverview,
    agentOptions,
    excludedAgentKeys: ["codex:company"],
  });
  assert.equal(disp.intent, "dispatch_preview");
  assert.equal(disp.agentKey, "codex:personal");

  const html = renderSpriteAssistantHtml({
    open: true,
    prefsOpen: true,
  }, {
    agentOptions,
    excludedAgentKeys: ["codex:company"],
  });
  assert.match(html, /自动派单默认跳过/);
  assert.match(html, /data-sprite-toggle-excluded="codex:company"/);
  assert.match(html, /张苍/);
  assert.match(html, /已跳过/);
  assert.doesNotMatch(html, /sprite-tool-count/);

  const aiHtml = renderSpriteAssistantHtml({
    open: true,
    pendingPreview: {
      aiPlanned: true,
      aiModel: "Gemini 3.8 Flash",
      payload: { model: "gemini-4-pro" },
      routes: [
        {
          action: "spawn_parallel",
          topicName: "控制台",
          segmentText: "排查后台队列死锁问题 <script>bad</script>",
          agentLabel: "Codex 主力",
          reason: "AI 拆单：硬核排查交 Codex",
        },
      ],
    },
  });
  assert.match(aiHtml, /AI 分配 · Gemini 3\.8 Flash/);
  assert.match(aiHtml, /排查后台队列死锁问题/);
  assert.doesNotMatch(aiHtml, /<script>bad/);
});
