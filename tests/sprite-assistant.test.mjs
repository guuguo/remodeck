import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { replaceHtmlPreservingUiState } from "../public/dom-preserve.js";
import {
  buildSpriteOpeningBriefing,
  buildSpriteContext, parseSpriteNdjson, appendSpriteTurn, askSpriteAssistant, matchSpriteConfirmation, renderSpriteWorkCard, spriteTomorrowAtEight,
  buildSpriteQueryReply,
  captureSpriteOverviewSnapshot,
  classifySpriteUserInput,
  buildSpriteTicketReply,
  diffSpriteOverviewEvents,
  loadSpritePrefs,
  saveSpritePrefs,
  linkifySpriteAnswerHtml,
  renderSpriteMessageHtml,
  renderSpriteAssistantHtml,
  renderSpriteFullscreenHtml,
  renderSpritePhoneCallHtml,
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

  assert.equal(classifySpriteUserInput("确认", { hasPendingProposal: true }).intent, "confirm_proposal");
  assert.equal(classifySpriteUserInput("算了", { hasPendingProposal: true }).intent, "cancel_proposal");
  assert.equal(matchSpriteConfirmation("确认派出！"), "confirm");
  assert.equal(matchSpriteConfirmation("ok"), "confirm");
  assert.equal(matchSpriteConfirmation("不用了"), "cancel");
  assert.equal(matchSpriteConfirmation("看看进度"), "");
  assert.equal(classifySpriteUserInput("我的工单").intent, "query_tickets");
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
    pendingProposal: {
      id: "act_prev_1",
      intent: "dispatch",
      model: "gemini-4-pro",
      instruction: "检查回调",
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
  assert.match(html, /data-sprite-action="confirm-proposal"/);
  assert.match(html, /data-sprite-action="cancel-proposal"/);
  assert.match(html, /data-sprite-action="edit-proposal"/);
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
    pendingProposal: {
      id: "act_inh_1",
      intent: "dispatch",
      inheritContext: true,
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
    pendingProposal: {
      id: "act_ai_1",
      intent: "dispatch",
      aiPlanned: true,
      aiModel: "Gemini 3.8 Flash",
      model: "gemini-4-pro",
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

test("Fullscreen sprite assistant renders unified dispatch proposal card and confirmation controls", () => {
  const fsHtml = renderSpriteFullscreenHtml({
    pendingProposal: {
      id: "act_fs_1",
      intent: "dispatch",
      instruction: "修登录回调",
      inheritContext: false,
      routes: [
        {
          action: "spawn_parallel",
          topicName: "示例商城",
          agentLabel: "Codex 默认",
          taskBrief: "修登录回调",
          hasTopicDigest: true,
        },
      ],
    },
  });
  assert.match(fsHtml, /派工预览/);
  assert.match(fsHtml, /data-sprite-toggle-inherit/);
  assert.doesNotMatch(fsHtml, /data-sprite-toggle-inherit[^>]*checked/);
  assert.match(fsHtml, /data-sprite-action="edit-proposal"/);
  assert.match(fsHtml, /data-sprite-action="confirm-proposal"/);
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
  const html = renderSpriteWorkCard({ id: "alert:one", type: "alert", title: "登录<脚本>", line: "等回调证据", threadId: "codex:default:one", sources: [{ threadId: "codex:default:one", label: "工位" }] }, { continueCardId: "alert:one", continueMessage: "继续 <script>" });
  assert.match(html, /data-board-open-thread="codex:default:one"/);
  assert.match(html, /data-sprite-continue-message="alert:one"/);
  for (const action of ["send_continue", "snooze", "park", "done", "pin", "dismiss"]) assert.match(html, new RegExp(`data-sprite-card-action="${action}"`));
  assert.doesNotMatch(html, /<script>/);
  // A 工单 card shows its goal and criteria and is not offered for pinning again.
  const ticket = renderSpriteWorkCard({ id: "ruin:ticket:tk_1", type: "ruin", title: "账单", line: "停了 4 天", threadId: "codex:default:one", ticketId: "tk_1", goal: "整理账单", criteria: ["能导出 <CSV>"], sources: [] });
  assert.match(ticket, /目标：整理账单/);
  assert.match(ticket, /<li>能导出 &lt;CSV&gt;<\/li>/);
  assert.doesNotMatch(ticket, /data-sprite-card-action="pin"/);
  // A failed scheduled run offers a retry, not a continuation.
  const failed = renderSpriteWorkCard({ id: "alert:auto:k", type: "alert", title: "晨报", line: "定时唤起失败：离线", originLabel: "定时任务·晨报", actions: ["retry", "snooze", "dismiss"], sources: [] });
  assert.match(failed, /data-sprite-card-action="retry"/);
  assert.match(failed, /定时任务·晨报/);
  assert.doesNotMatch(failed, /send_continue|data-sprite-continue-message/);
  const wip = renderSpriteWorkCard({ id: "ruin:t:wip:a.md", type: "ruin", title: "任务卡", line: "久未更新", sources: [] });
  assert.doesNotMatch(wip, /send_continue/, "没有原工位的卡不给续做");
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

test("「我的工单」列出每张工单停在哪，可打开工位和改验收标准", () => {
  const empty = buildSpriteTicketReply({ assistantTickets: [] });
  assert.match(empty.text, /还没有任务/);
  const reply = buildSpriteTicketReply({ assistantTickets: [
    { id: "tk_1", title: "账单分类", topicName: "记账小程序", line: "还差：没看到运行结果", criteria: ["能跑通"], state: "missing", threadId: "codex:default:D" },
    { id: "tk_2", parentId: "tk_1", title: "导出 CSV", topicName: "记账小程序", line: "工位正在做", criteria: [], state: "running", threadId: "codex:default:E" },
  ] });
  assert.match(reply.text, /「记账小程序」账单分类：还差：没看到运行结果（验收标准 1 条）/);
  assert.match(reply.text, /└─ 导出 CSV：工位正在做/);
  assert.deepEqual(reply.actions.map((a) => a.type), ["open_thread", "ticket_edit", "open_thread", "ticket_edit"]);
});

test("小精灵全屏助手与豆包电话界面渲染安全且包含核心控制", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  assert.deepEqual(loadSpritePrefs(storage), { ttsEnabled: false, modelKey: "auto", phoneAutoExecute: true });
  saveSpritePrefs({ modelKey: "codex:default:gpt-6.1-terra", phoneAutoExecute: false }, storage);
  assert.deepEqual(loadSpritePrefs(storage), { ttsEnabled: false, modelKey: "codex:default:gpt-6.1-terra", phoneAutoExecute: false });

  const fsHtml = renderSpriteFullscreenHtml({
    modelOptions: [{ key: "auto", label: "自动优选模型" }, { key: "codex:default:gpt-6.1-terra", label: "Codex · GPT-6.1 Terra" }],
    modelKey: "codex:default:gpt-6.1-terra",
    messages: [{
      id: "m1",
      role: "sprite",
      text: "方案如下 <script>x</script>",
      executedTag: "已批准 <ok>",
      notices: [{ id: "n1", title: "导出工位 <img onerror=alert(2)>", text: "「导出工位」已经跑完了，可以验收 <script>z</script>", threadId: "codex:default:t-done" }],
    }],
    pendingProposal: {
      id: "act_1",
      intent: "dispatch",
      summary: "批准「npm test」<img onerror=alert(1)>",
      routes: [
        { topicName: "示例商城", agentLabel: "Codex", segmentText: "修复导出" },
        { topicName: "绘本工坊 <script>r</script>", agentLabel: "Claude", segmentText: "补单测" },
      ],
    },
    busy: true,
    thinkingLabel: "正在翻阅园区…",
  });
  assert.doesNotMatch(fsHtml, /<script>|<img onerror/);
  assert.match(fsHtml, /data-sprite-model-select="1"/);
  assert.match(fsHtml, /data-sprite-action="enter-phone"/);
  assert.match(fsHtml, /data-sprite-action="confirm-proposal"/);
  assert.match(fsHtml, /正在翻阅园区/);
  assert.match(fsHtml, /class="sprite-msg-notices"/);
  assert.match(fsHtml, /data-board-open-thread="codex:default:t-done"/);
  assert.match(fsHtml, /修复导出/);

  const phoneHtml = renderSpritePhoneCallHtml({
    phoneAutoExecute: false,
    phoneMuted: true,
    phoneElapsedSec: 65,
    phoneKeyboardOpen: true,
    messages: [{ id: "u1", role: "user", text: "现在怎么样" }, { id: "s1", role: "sprite", text: "一切正常 <script>y</script>", spokenText: "一切正常" }],
    pendingProposal: {
      id: "act_1",
      summary: "准备拆 2 路，确认发吗？",
      routes: [
        { topicName: "示例商城", agentLabel: "Codex" },
        { topicName: "绘本工坊", agentLabel: "Claude <script>x</script>" },
      ],
    },
  });
  assert.doesNotMatch(phoneHtml, /<script>y|<script>x/);
  assert.match(phoneHtml, /sprite-phone-route-pill/);
  assert.match(phoneHtml, /01:05/);
  assert.match(phoneHtml, /写前先确认/);
  assert.match(phoneHtml, /data-sprite-action="hangup-phone"/);
  assert.match(phoneHtml, /data-sprite-action="minimize-phone"/);
  assert.match(phoneHtml, /data-sprite-action="toggle-phone-mute"/);
  assert.match(phoneHtml, /id="spritePhoneTextForm"/);
  assert.match(phoneHtml, /data-sprite-action="open-sidebar"/);
});

test("全屏小精灵挂载与布局回归防护（防白屏 _acLastHtml 提前赋值 & 不遮挡左侧抽屉）", () => {
  // 1. replaceHtmlPreservingUiState on empty mount populates innerHTML and tracks _acLastHtml cleanly
  const fsHtml = renderSpriteFullscreenHtml({
    messages: [{ id: "m1", role: "sprite", text: "测试全屏内容" }],
  });
  const fsMount = { innerHTML: "" };
  const changed1 = replaceHtmlPreservingUiState(fsMount, fsHtml);
  assert.equal(changed1, true);
  assert.match(fsMount.innerHTML, /class="sprite-fs-shell"/);
  assert.match(fsMount.innerHTML, /id="spriteFullscreenInput"/);
  assert.match(fsMount.innerHTML, /data-sprite-action="open-sidebar"/);
  assert.equal(fsMount._acLastHtml, fsHtml);
  assert.equal(replaceHtmlPreservingUiState(fsMount, fsHtml), false);

  const phoneHtml = renderSpritePhoneCallHtml({ phoneElapsedSec: 12 });
  const phoneMount = { innerHTML: "" };
  assert.equal(replaceHtmlPreservingUiState(phoneMount, phoneHtml), true);
  assert.match(phoneMount.innerHTML, /id="spritePhoneShell"/);

  // 2. index.html mounts #spriteFullscreenMount inside <main id="mainArea">...</main>, not outside </main>
  const indexHtml = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const mainStart = indexHtml.indexOf('<main id="mainArea"');
  const mainEnd = indexHtml.indexOf("</main>");
  const mountIdx = indexHtml.indexOf('id="spriteFullscreenMount"');
  assert.ok(mainStart !== -1 && mainEnd !== -1 && mountIdx !== -1);
  assert.ok(mountIdx > mainStart && mountIdx < mainEnd, "#spriteFullscreenMount must live inside #mainArea");

  // 3. sprite-assistant.css scopes fullscreen mount with position: absolute inside #mainArea
  const cssText = fs.readFileSync(new URL("../public/sprite-assistant.css", import.meta.url), "utf8");
  assert.match(cssText, /#mainArea\s*\{\s*position:\s*relative;/);
  assert.match(cssText, /\.sprite-fullscreen-mount\s*\{[^}]*position:\s*absolute;/);
  assert.doesNotMatch(cssText, /\.sprite-fullscreen-mount\s*\{[^}]*position:\s*fixed;/);

  // 4. neither app.js nor sprite-controller.js may pre-assign fsMount._acLastHtml = fsHtml before replaceHtmlPreservingUiState
  for (const rel of ["../public/app.js", "../public/sprite-controller.js"]) {
    const src = fs.readFileSync(new URL(rel, import.meta.url), "utf8");
    assert.doesNotMatch(src, /fsMount\._acLastHtml\s*=\s*fsHtml;/);
  }
});

test("消息正文内联跳转链接、精炼跳转栏与上下文胶囊折叠", () => {
  const manySources = Array.from({ length: 12 }, (_, i) => ({
    kind: "thread",
    threadId: `codex:default:other-${i}`,
    label: `工位·无关工位${i}`,
  }));
  const msgHtml = renderSpriteMessageHtml({
    id: "m-links",
    role: "sprite",
    text: "在「示例商城」产线下的 导出格式排查 <script>bad</script> 会话里已经完成。",
    links: [
      { kind: "thread", id: "codex:default:t-export", label: "导出格式排查", matchText: "导出格式排查" },
      { kind: "topic", id: "shop", label: "示例商城", matchText: "示例商城" },
    ],
    actions: [
      { label: "查看产线", type: "focus", payload: { topicId: "shop" } },
      { label: "打开工位", type: "open_thread", payload: { threadId: "codex:default:t-export" } },
      { label: "收菜", type: "card_action", payload: { cardId: "harvest:1", action: "harvest" } },
    ],
    traceSteps: [{ step: "compose", label: "整理回复", count: 12 }],
    sources: manySources,
  });

  assert.doesNotMatch(msgHtml, /<script>bad/);
  assert.match(msgHtml, /class="sprite-inline-link is-thread" data-board-open-thread="codex:default:t-export"/);
  assert.match(msgHtml, /class="sprite-inline-link is-topic" data-sprite-focus-topic="shop"/);
  assert.match(msgHtml, /<div class="sprite-msg-links">[\s\S]*打开会话：导出格式排查[\s\S]*查看产线：示例商城/);
  // Duplicate focus/open_thread action buttons are suppressed, while unique action index stays 2.
  assert.doesNotMatch(msgHtml, /data-sprite-answer-action="0"/);
  assert.doesNotMatch(msgHtml, /data-sprite-answer-action="1"/);
  assert.match(msgHtml, /data-sprite-answer-action="2">收菜</);
  // All 12 raw sources are tucked inside <details class="sprite-trace">, not sprawled outside.
  const detailsMatch = msgHtml.match(/<details class="sprite-trace">[\s\S]*<\/details>/);
  assert.ok(detailsMatch, "应渲染折叠trace容器");
  assert.match(detailsMatch[0], /参考 12 条上下文/);
  assert.match(detailsMatch[0], /无关工位11/);
  const outsideDetails = msgHtml.replace(/<details class="sprite-trace">[\s\S]*<\/details>/, "");
  assert.doesNotMatch(outsideDetails, /无关工位0/);

  // Long match stays intact without nested replacement inside <button>.
  const nested = linkifySpriteAnswerHtml("<p><code>示例商城导出排查</code></p>", [
    { kind: "thread", id: "t1", label: "示例商城导出排查" },
    { kind: "topic", id: "shop", label: "示例商城" },
  ]);
  assert.equal((nested.match(/<button\b/g) || []).length, 1);
  assert.match(nested, /data-board-open-thread="t1"/);
});

test("3D 面板气泡思考态展示实时进度与停止按钮，NDJSON 支持心跳与报错透传", async () => {
  const popHtml = renderSpriteAssistantHtml({
    open: true,
    busy: true,
    thinkingLabel: "翻了相关工位 4 条",
    messages: [{ id: "u1", role: "user", text: "今天哪个会话完工了" }],
  }, { is3dMode: true });
  assert.match(popHtml, /class="sprite-fs-thinking is-popover"/);
  assert.match(popHtml, /翻了相关工位 4 条/);
  assert.match(popHtml, /data-sprite-action="abort-ask"/);

  const fsHtml = renderSpriteFullscreenHtml({ busy: true, thinkingLabel: "正在思考" });
  assert.match(fsHtml, /data-sprite-action="abort-ask"/);

  // NDJSON ping & error handling + external abort
  const pingAndAnswer = [
    JSON.stringify({ type: "ping", ts: 1 }),
    JSON.stringify({ type: "trace", step: "resolve", label: "整合全园状态", count: 1 }),
    JSON.stringify({ type: "answer", text: "搞定", links: [] }),
  ].join("\n");
  const traces = [];
  const res = await askSpriteAssistant({ text: "测试" }, (tr) => traces.push(tr), {
    demo: false,
    fetchImpl: async () => new Response(pingAndAnswer, { headers: { "content-type": "application/x-ndjson" } }),
  });
  assert.equal(res.text, "搞定");
  assert.equal(traces.length, 1);

  await assert.rejects(
    askSpriteAssistant({ text: "测试" }, () => {}, {
      demo: false,
      fetchImpl: async () => new Response(`${JSON.stringify({ type: "error", message: "模型响应超时" })}\n`, {
        headers: { "content-type": "application/x-ndjson" },
      }),
    }),
    /模型响应超时/,
  );

  const ac = new AbortController();
  ac.abort();
  await assert.rejects(
    askSpriteAssistant({ text: "测试" }, () => {}, {
      demo: false,
      signal: ac.signal,
      fetchImpl: async (_url, opts) => {
        if (opts.signal.aborted) throw new DOMException("Aborted", "AbortError");
        return Response.json({});
      },
    }),
    (err) => Boolean(err?.aborted || err?.name === "AbortError"),
  );
});

test("sprite-controller/app imports all used module exports and shields phone calls from errors/overview spam", () => {
  for (const fileRel of [
    "../public/app.js",
    "../public/sprite-controller.js",
    "../public/sprite-audio-pipeline.js",
    "../public/sprite-phone-controller.js",
  ]) {
    const src = fs.readFileSync(new URL(fileRel, import.meta.url), "utf8");
    for (const modName of ["sprite-assistant.js", "voice-copilot.js", "sprite-controller.js"]) {
      const importRe = new RegExp(`import\\s*\\{([^}]+)\\}\\s*from\\s*"\\./${modName.replace(".", "\\.")}(?:\\?[^"]*)?"`);
      const impMatch = src.match(importRe);
      if (!impMatch) continue;
      const modSrc = fs.readFileSync(new URL(`../public/${modName}`, import.meta.url), "utf8");
      const imported = new Set(
        impMatch[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop()).filter(Boolean),
      );
      const exported = [...modSrc.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/g)].map((m) => m[1]);
      for (const sym of exported) {
        if (imported.has(sym)) continue;
        const localDecl = new RegExp(`(?:function|const|let|var|class)\\s+${sym}\\b`).test(src);
        if (localDecl) continue;
        const refRe = new RegExp(`(?<![.\\w$])${sym}(?!\\s*:)\\b`);
        assert.equal(refRe.test(src), false, `${fileRel}: ${modName} export "${sym}" is referenced without being imported`);
      }
    }
  }
  const phoneJs = fs.readFileSync(new URL("../public/sprite-phone-controller.js", import.meta.url), "utf8");
  const errCatchIdx = phoneJs.indexOf("语音通话请求失败：${formatActionError(error)}");
  assert.ok(errCatchIdx !== -1);
  assert.match(phoneJs.slice(errCatchIdx, errCatchIdx + 160), /skipAutoSpeak:\s*true/);
  const ctrlJs = fs.readFileSync(new URL("../public/sprite-controller.js", import.meta.url), "utf8");
  assert.match(ctrlJs, /onOverviewScreen\s*&&\s*!state\.sprite\.phoneCallActive\s*&&\s*events\.length\s*>\s*0/);
});
