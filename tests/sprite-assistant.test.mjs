import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSpriteOpeningBriefing,
  buildSpriteContext, parseSpriteNdjson, appendSpriteTurn, askSpriteAssistant, submitSpriteDispatch, renderSpriteWorkCard, spriteTomorrowAtEight,
  buildSpriteQueryReply,
  captureSpriteOverviewSnapshot,
  classifySpriteUserInput,
  diffSpriteOverviewEvents,
  renderSpriteAssistantHtml,
} from "../public/sprite-assistant.js";

import { setLocale } from "../public/i18n.js";
setLocale("zh-CN", null);

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
  assert.match(brief.stats, /1 名 AI 员工正在运转/);
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

  const disp = classifySpriteUserInput("派工：用 Codex 给图片翻译修个问题", {
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

test("T3: questions default to ask; only explicit dispatch verbs enter preview", () => {
  for (const text of ["怎样派工", "派工记录", "派工是什么意思", "示例商城做到哪了", "那它呢", "帮我看看插件市场", "修个问题", "用 Codex 给示例商城修个问题"]) {
    assert.equal(classifySpriteUserInput(text).intent, "ask", text);
  }
  for (const text of ["派工：修登录", "让 Codex 去示例商城修登录", "帮我开个工位做登录验收"]) {
    assert.equal(classifySpriteUserInput(text).intent, "dispatch_preview", text);
  }
  assert.equal(classifySpriteUserInput("归档历史对话").intent, "archive_preview");
});

test("T14: dispatch preview performs zero startThread/send calls until confirmation", async () => {
  let starts = 0, sends = 0;
  const payload = { text: "修登录回调", topicId: "shop", confirmOnly: false };
  const post = async (path, body) => {
    assert.equal(path, "/api/overview/dispatch");
    if (!body.confirmOnly) { starts++; sends++; }
    return { routes: [{ topicId: "shop", agentKey: "codex:default" }] };
  };
  const result = await submitSpriteDispatch(payload, { post });
  assert.equal(starts, 0);
  assert.equal(sends, 0);
  await submitSpriteDispatch(payload, { confirmed: true, routes: result.routes, post });
  assert.equal(starts, 1);
  assert.equal(sends, 1);
});

test("T16: opening judgement prioritizes alerts, then harvest, then the oldest quiet line", () => {
  const overview = { domains: [{ topics: [
    { id: "shop", name: "示例商城", updatedAt: 20, assistantSignals: { counts: { alert: 1 } } },
    { id: "book", name: "绘本工坊", updatedAt: 10, assistantSignals: { counts: { harvest: 1 } } },
  ] }] };
  let brief = buildSpriteOpeningBriefing(overview);
  assert.match(brief.text, /^示例商城.*拍板/);
  assert.equal(brief.chips.length, 1);
  overview.domains[0].topics[0].assistantSignals.counts.alert = 0;
  brief = buildSpriteOpeningBriefing(overview);
  assert.match(brief.text, /^绘本工坊.*收/);
  overview.domains[0].topics[1].assistantSignals.counts.harvest = 0;
  assert.match(buildSpriteOpeningBriefing(overview).text, /最久没动的是绘本工坊/);
});

test("NDJSON parser preserves split lines, CRLF, blank lines and final unterminated answers", () => {
  const first = parseSpriteNdjson('{"type":"trace","label":"翻工位"}\r\n\n{"type":"ans');
  assert.equal(first.events.length, 1);
  assert.equal(first.remainder, '{"type":"ans');
  const final = parseSpriteNdjson('wer","text":"完成"}', first.remainder, true);
  assert.deepEqual(final.events, [{ type: "answer", text: "完成" }]);
  assert.equal(final.remainder, "");
  assert.throws(() => parseSpriteNdjson("broken\n"), SyntaxError);
});

test("assistant transport handles streamed UTF-8, buffered NDJSON and JSON without dispatch", async () => {
  const events = [{ type: "trace", step: "threads", label: "翻了工位", count: 1 }, { type: "answer", text: "商城进展", sources: [] }];
  const raw = events.map(JSON.stringify).join("\n");
  const bytes = new TextEncoder().encode(raw);
  const traces = [];
  const result = await askSpriteAssistant({ text: "到哪了" }, (trace) => traces.push(trace), {
    demo: false, fetchImpl: async (url, options) => {
      assert.match(url, /\/api\/assistant\/ask$/);
      assert.equal(options.headers.Accept, "application/x-ndjson");
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(bytes.slice(0, 44)); controller.enqueue(bytes.slice(44)); controller.close();
      } }), { headers: { "content-type": "application/x-ndjson" } });
    },
  });
  assert.equal(result.text, "商城进展");
  assert.equal(traces.length, 1);
  const buffered = await askSpriteAssistant({}, () => {}, { demo: false, fetchImpl: async () => ({ ok: true, headers: new Headers({ "content-type": "application/x-ndjson" }), text: async () => raw }) });
  assert.equal(buffered.text, result.text);
  const json = await askSpriteAssistant({}, (trace) => traces.push(trace), { demo: false, fetchImpl: async () => Response.json({ text: "结论", trace: [events[0]] }) });
  assert.equal(json.text, "结论");
  assert.equal(traces.length, 2);
});

test("multi-turn history stays at six entries and focusStack keeps latest topics first", () => {
  let session = { turns: [], focusStack: [] };
  for (let i = 0; i < 5; i++) session = appendSpriteTurn(session, `问题${i}`, { text: `回答${i}`, focusTopicId: `topic${i % 2}` });
  assert.equal(session.turns.length, 6);
  assert.deepEqual(session.focusStack, ["topic0", "topic1"]);
  assert.equal(session.turns[0].text, "问题2");
  const unchangedFocus = appendSpriteTurn(session, "继续", { text: "解释" });
  assert.deepEqual(unchangedFocus.focusStack, session.focusStack);
});

test("work card renders sources, editable continuation and all work order actions safely", () => {
  const html = renderSpriteWorkCard({ id: "alert:one", type: "alert", title: "登录<脚本>", line: "等回调证据", sources: [{ threadId: "codex:default:one", label: "工位" }] }, { continueCardId: "alert:one", continueMessage: "继续 <script>" });
  assert.match(html, /data-board-open-thread="codex:default:one"/);
  assert.match(html, /data-sprite-continue-message="alert:one"/);
  for (const action of ["send_continue", "snooze", "park", "done", "dismiss"]) assert.match(html, new RegExp(`data-sprite-card-action="${action}"`));
  assert.doesNotMatch(html, /<script>/);
  const tomorrow = new Date(spriteTomorrowAtEight(new Date(2026, 10, 25, 23, 30)));
  assert.equal(tomorrow.getDate(), 26);
  assert.equal(tomorrow.getHours(), 8);
});


test("context shortcuts and prompts follow selected building signals", () => {
  const topic = { id: "shop", name: "示例商城", assistantSignals: { top: "alert" } };
  assert.match(buildSpriteContext(topic).placeholder, /示例商城.*拍板/);
  assert.ok(buildSpriteContext(topic).quick.includes("去拍板"));
  topic.assistantSignals.top = "harvest";
  assert.match(buildSpriteContext(topic).placeholder, /收菜的依据/);
  assert.ok(buildSpriteContext(topic).quick.includes("去收菜"));
  topic.assistantSignals.top = "ruin";
  assert.match(buildSpriteContext(topic).placeholder, /上次停在哪/);
  assert.equal(buildSpriteContext(topic).quick.length, 4);
});
