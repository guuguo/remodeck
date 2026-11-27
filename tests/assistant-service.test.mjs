import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { AssistantLLM, extractCompleteJsonStringField, TICKET_DRAFT_PROMPT } from "../src/assistant-llm.mjs";
import { computeTopicSignals, resolveActionRisk, shouldSearchParkSources } from "../src/assistant-service.mjs";
import { cardSubject, harvestEvidenceForThread, isCardHandled } from "../src/assistant-signals.mjs";
import { inferPipelineStage } from "../src/mission-overview-service.mjs";
import { assistantFixture, assistantThread, ASSISTANT_NOW } from "./helpers/assistant-fixtures.mjs";

async function fixture(t) {
  const f = await assistantFixture();
  t.after(() => rm(f.dataDir, { recursive: true, force: true }));
  return f;
}
const allTopics = (o) => o.domains.flatMap((d) => d.topics);
function checkTrace(answer) {
  for (const [step, kind] of Object.entries({ threads: "thread", commits: "commit", wip: "wip", memory: "memory" })) {
    const count = answer.sources.filter((s) => s.kind === kind).length;
    const items = answer.trace.filter((t) => t.step === step);
    assert.equal(items.length, count ? 1 : 0, step);
    if (count) assert.equal(items[0].count, count, step);
  }
}

test("T1/T9 问进度只读、有出处和焦点，模型不可用使用标注模板", async (t) => {
  const f = await fixture(t);
  const answer = await f.assistant.ask({ text: "示例商城做到哪了" });
  assert.equal(answer.kind, "answer");
  assert.equal(answer.focusTopicId, "line-0");
  assert.ok(answer.sources.length >= 1);
  assert.equal(f.started.length, 0);
  assert.equal(f.sent.length, 0);
  assert.equal(answer.usedModel, false);
  assert.match(answer.text, /导出格式用 A 还是 B/);
  assert.match(answer.text, /（未经模型整理）$/);
  checkTrace(answer);
  const history = await f.assistant.ask({ text: "示例商城之前怎么解决" });
  assert.equal(history.usedModel, false);
  assert.match(history.text, /（未经模型整理）$/);
});

test("T4 overview 四工位 A/B/C/D 仅产生 ruin/alert/harvest/无信号", async (t) => {
  const f = await fixture(t);
  const o = await f.overview.getOverview();
  assert.deepEqual(allTopics(o).map((tp) => tp.assistantSignals.top), ["ruin", "alert", "harvest", null]);
  assert.deepEqual(o.assistantBadges, { alert: 1, harvest: 1, ruin: 1 });
  assert.equal(o.topics[0].assistantSignals.top, "ruin");
  assert.equal(allTopics(o)[0].assistantSignals.ruinDays, 4);
  for (const tp of allTopics(o)) for (const card of tp.assistantSignals.cards) {
    assert.ok(card.sources.length);
    assert.ok(Array.from(card.title).length <= 24);
    assert.ok(Array.from(card.line).length <= 40);
  }
  assert.equal(f.started.length, 0);
});

test("T5 阶段推断不亮收菜，review 证据才使 readyToHarvest=true", async (t) => {
  const f = await fixture(t);
  const inferred = inferPipelineStage(f.topics[0], [f.threads[3]], null, { stageIndex: 4, readyToHarvest: true });
  assert.equal(inferred.readyToHarvest, false);
  assert.equal(inferred.harvestInferred, true);
  assert.equal(inferred.harvestEvidence, null);
  assert.equal(inferPipelineStage(f.topics[0], [], null, { stageIndex: 4, readyToHarvest: false }).harvestInferred, true);
  const reviewed = inferPipelineStage(f.topics[2], [f.threads[2]], null, { stageIndex: 4 });
  assert.equal(reviewed.readyToHarvest, true);
  assert.equal(reviewed.harvestInferred, false);
  assert.match(reviewed.harvestEvidence, /测试全部通过/);
  const topic = allTopics(await f.overview.getOverview())[2];
  assert.equal(topic.readyToHarvest, true);
  assert.equal(topic.harvestEvidence, topic.pipeline.harvestEvidence);
});

test("收菜拒绝用户首句、无 review、失败、运行中、排队和后续用户消息", async (t) => {
  const f = await fixture(t), good = f.threads[2];
  for (const patch of [
    { turns: undefined, preview: "已完成并验证通过" },
    { turns: [{ status: "completed", items: [{ type: "agentMessage", text: "已完成导出" }] }] },
    { live: true }, { queuedCount: 1 }, { lastError: "执行失败" }, { lastTurnStatus: "failed" },
    { turns: [{ status: "failed", items: good.turns[0].items }] },
    { turns: [{ status: "completed", items: [...good.turns[0].items, { type: "userMessage", content: [{ type: "text", text: "已完成测试通过？" }] }] }] },
    { turns: [{ status: "completed", items: [{ type: "agentMessage", text: "已完成修改，但测试未通过" }] }] },
    { turns: [{ status: "completed", items: [{ type: "agentMessage", text: "已完成开发，等待验收" }] }] },
    { turns: [{ status: "completed", items: [{ type: "agentMessage", text: "已完成开发，尚未验收" }] }] },
  ]) assert.equal(harvestEvidenceForThread({ ...good, ...patch }), null);
});

test("T6 snooze 原子持久化，到次日 08:00 恢复", async (t) => {
  const f = await fixture(t);
  const card = allTopics(await f.overview.getOverview())[0].assistantSignals.cards[0];
  const until = "2026-11-26T00:00:00Z";
  await f.assistant.cardAction(card.id, { type: "snooze", until });
  assert.equal(allTopics(await f.overview.getOverview())[0].assistantSignals.cards.length, 0);
  const state = JSON.parse(await readFile(resolve(f.dataDir, "assistant/card-state.json"), "utf8"));
  assert.equal(state[cardSubject(card.id)].until, until.replace("Z", ".000Z"));
  f.setNow(Date.parse(until));
  assert.equal(allTopics(await f.overview.getOverview())[0].assistantSignals.cards[0].id, card.id);
  await assert.rejects(f.assistant.cardAction(card.id, { type: "snooze", until: "bad-date" }), /稍后时间/);
});

test("工位再次运行后使尾部缓存失效，同秒更新时间也不重用旧收菜证据", async (t) => {
  const f = await fixture(t);
  assert.equal(allTopics(await f.overview.getOverview())[2].readyToHarvest, true);
  const previousReads = f.reads.length;
  await f.overview.getOverview();
  assert.equal(f.reads.length, previousReads);
  f.threads[2].live = true;
  assert.equal(allTopics(await f.overview.getOverview())[2].readyToHarvest, false);
  f.threads[2].live = false;
  f.threads[2].turns = [{ status: "completed", items: [{ type: "agentMessage", text: "选 A 还是 B？" }] }];
  assert.equal(allTopics(await f.overview.getOverview())[2].readyToHarvest, false);
});

test("T7 continue 只发原工位，保留可编辑消息和缺省续做语", async (t) => {
  const f = await fixture(t);
  const card = allTopics(await f.overview.getOverview())[0].assistantSignals.cards[0];
  const result = await f.assistant.cardAction(card.id, { type: "continue", message: "选择 A，请继续。" });
  assert.equal(result.threadId, f.threads[0].id);
  assert.deepEqual(f.sent[0], { threadId: f.threads[0].id, text: "选择 A，请继续。" });
  await f.assistant.cardAction(card.id, { type: "continue" });
  assert.match(f.sent[1].text, /继续上次/);
  assert.equal(f.started.length, 0);
});

test("T8/T11 8 天 active 任务卡产生 ruin 和任务卡出处，trace 精确对应", async (t) => {
  const f = await fixture(t);
  f.setNow(ASSISTANT_NOW - 8 * 86400000);
  await f.vault.updateWip("line-3", "classification", { title: "账单分类规则", state: "分类规则表写到一半", status: "active" });
  await f.vault.updateWip("line-3", "done", { title: "已完成任务", status: "done" });
  f.setNow(ASSISTANT_NOW);
  await f.vault.addNote({ scope: "line-3", title: "记账小程序", body: "记账小程序按分类规则整理。" });
  const tp = allTopics(await f.overview.getOverview())[3];
  assert.equal(tp.assistantSignals.top, "ruin");
  assert.equal(tp.assistantSignals.cards.length, 1);
  assert.equal(tp.assistantSignals.cards[0].sources[0].kind, "wip");
  assert.match(tp.assistantSignals.cards[0].sources[0].label, /任务卡/);
  const emitted = [];
  const answer = await f.assistant.ask({ text: "记账小程序做到哪了" }, { onTrace: (item) => emitted.push(item) });
  checkTrace(answer);
  assert.equal(answer.sources.filter((s) => s.kind === "wip").length, 1);
  assert.ok(answer.sources.some((s) => s.kind === "memory"));
  assert.deepEqual(emitted, answer.trace);
});

test("T12 指代、历史第二个、焦点栈和歧义候选", async (t) => {
  const f = await fixture(t);
  const first = await f.assistant.ask({ text: "示例商城做到哪了" });
  const second = await f.assistant.ask({ text: "它卡在哪", focus: [first.focusTopicId] });
  assert.equal(second.focusTopicId, "line-0");
  const history = [{ role: "user", text: "示例商城做到哪了" }, { role: "assistant", text: "示例商城等你选格式" }, { role: "user", text: "绘本工坊呢" }];
  assert.equal((await f.assistant.ask({ text: "第二个呢", history, focus: ["line-1", "line-0"] })).focusTopicId, "line-1");
  assert.equal((await f.assistant.ask({ text: "这条线怎么样", history })).focusTopicId, "line-1");
  assert.equal((await f.assistant.ask({ text: "做到哪了", contextTopicId: "line-2" })).focusTopicId, "line-2");
  const unknown = await f.assistant.ask({ text: "小铺做到哪了" });
  assert.equal(unknown.kind, "clarify");
  assert.equal(unknown.candidates.length, 2);
  assert.equal(unknown.actions.filter((a) => a.type === "clarify_pick").length, 2);
  assert.equal((await f.assistant.ask({ text: "示例商城和绘本工坊做到哪了" })).kind, "clarify");
  assert.equal(f.started.length, 0);
});

test("T11 全文检索补充旧工位、去重，所有工单结论均包含对应出处", async (t) => {
  const f = await fixture(t);
  f.hub.searchThreads = async () => ({ threads: [f.threads[0], f.threads[0], { ...f.threads[0], id: "codex:default:history", searchMatch: { matchSnippet: "历史格式说明" } }] });
  for (let i = 0; i < 4; i++) f.threads.push(assistantThread(`recent-${i}`, f.topics[0], 1, "讨论格式", { title: `不同事项${i}` }));
  const answer = await f.assistant.ask({ text: "示例商城做到哪了" });
  checkTrace(answer);
  assert.equal(answer.sources.filter((s) => s.threadId === f.threads[0].id).length, 1);
  assert.ok(answer.sources.some((s) => s.threadId === "codex:default:history"));
  assert.match(answer.text.split("\n")[0], /\[S\d+\]/);
});

test("T13 选中别名写 profile，下次直达；并发别名写入和清空", async (t) => {
  const f = await fixture(t);
  const unknown = await f.assistant.ask({ text: "小铺做到哪了" });
  await f.assistant.addAlias(unknown.actions[0].payload);
  assert.equal((await f.assistant.profile()).aliases["小铺"], "line-0");
  assert.equal((await f.assistant.ask({ text: "小铺做到哪了" })).focusTopicId, "line-0");
  await Promise.all([f.assistant.addAlias({ alias: "画册", topicId: "line-1" }), f.assistant.addAlias({ alias: "扩展", topicId: "line-2" })]);
  assert.equal(Object.keys((await f.assistant.profile()).aliases).length, 3);
  assert.deepEqual((await f.assistant.clearProfile()).aliases, {});
  await assert.rejects(f.assistant.addAlias({ alias: "未知", topicId: "missing" }), /产线不存在/);
});

test("工位按同 cwd 和近似标题粗合并，每类上限 3，最新状态覆盖旧卡", async (t) => {
  const f = await fixture(t), topic = f.topics[0];
  const threads = [f.threads[0], { ...f.threads[0], id: "codex:default:A2", title: `${f.threads[0].title}（续）` }];
  let signals = computeTopicSignals({ ...topic, activeThreads: threads }, { now: ASSISTANT_NOW });
  assert.equal(signals.cards.length, 1);
  assert.equal(signals.cards[0].relatedCount, 2);
  threads.push(assistantThread("new", topic, 1, "今天讨论过了。"));
  assert.equal(computeTopicSignals({ ...topic, activeThreads: threads }, { now: ASSISTANT_NOW }).cards.length, 0);
  signals = computeTopicSignals({ ...topic, activeThreads: Array.from({ length: 7 }, (_, i) => assistantThread(`stale-${i}`, topic, 4, "选哪一个？", { title: `事项${i}` })) }, { now: ASSISTANT_NOW });
  assert.equal(signals.counts.ruin, 3);
});

test("park/done/dismiss/harvest 隐藏工单，harvest 返回原工位且不发消息", async (t) => {
  for (const type of ["park", "done", "dismiss", "harvest"]) {
    const f = await fixture(t), topicIndex = type === "harvest" ? 2 : 0;
    const card = allTopics(await f.overview.getOverview())[topicIndex].assistantSignals.cards[0];
    const result = await f.assistant.cardAction(card.id, { type });
    assert.equal(result.ok, true);
    assert.equal(allTopics(await f.overview.getOverview())[topicIndex].assistantSignals.cards.length, 0);
    assert.equal(f.sent.length, 0);
    assert.equal(f.started.length, 0);
  }
});

test("巡园按信号优先级/时间，最多5站，since 仅返回新卡", async (t) => {
  const f = await fixture(t);
  const tour = await f.assistant.tour();
  assert.deepEqual(tour.stops.map((s) => s.mark), ["alert", "harvest", "ruin"]);
  assert.ok(tour.stops.every((s) => Array.from(s.bubble).length <= 18));
  const recent = await f.assistant.tour({ since: "2026-11-24T04:00:00Z" });
  assert.deepEqual(recent.stops.map((s) => s.mark), ["harvest"]);
  const base = await f.overview.getOverview();
  const prototype = base.domains[0].topics[1];
  const extra = Array.from({ length: 8 }, (_, i) => ({ ...prototype, id: `extra-${i}`, assistantSignals: { cards: [{ ...prototype.assistantSignals.cards[0], since: new Date(ASSISTANT_NOW - i * 1000).toISOString() }] } }));
  f.assistant.getOverview = async () => ({ ...base, domains: [{ topics: extra }] });
  const limited = await f.assistant.tour();
  assert.equal(limited.stops.length, 5);
  assert.equal(limited.more, 3);
  assert.equal(limited.stops[0].topicId, "extra-7");
});

test("轻量模型可插拔、证据引用校验、10分钟缓存、持久化每日预算", async (t) => {
  const f = await fixture(t);
  let calls = 0, clock = ASSISTANT_NOW;
  const completeImpl = async (input) => { calls++; assert.ok(input.system.includes("无出处不断言")); return "已完成导出并通过验证 [S1]"; };
  const llm = new AssistantLLM({ dataDir: f.dataDir, config: { enabled: true, dailyAskLimit: 1 }, completeImpl, now: () => clock });
  const evidence = { question: "之前如何验证", sources: [{ id: "S1", text: "已完成导出，测试通过" }] };
  assert.match(await llm.complete({ evidence }), /\[S1\]/);
  assert.match(await llm.complete({ evidence }), /\[S1\]/);
  assert.equal(calls, 1);
  const secondInstance = new AssistantLLM({ dataDir: f.dataDir, config: { enabled: true, dailyAskLimit: 1 }, completeImpl, now: () => clock });
  assert.equal(await secondInstance.complete({ evidence: { ...evidence, question: "不同问题" } }), null);
  clock += 86400000;
  assert.ok(await secondInstance.complete({ evidence }));
  assert.equal(calls, 2);
  clock += 86400000;
  const ungrounded = new AssistantLLM({ dataDir: f.dataDir, config: { enabled: true }, completeImpl: async () => "已部署到线上", now: () => clock });
  assert.equal(await ungrounded.complete({ evidence }), null);
  const broken = new AssistantLLM({ dataDir: f.dataDir, config: { enabled: true }, completeImpl: async () => { throw new Error("unavailable"); }, now: () => clock });
  assert.equal(await broken.complete({ evidence }), null);
});

test("历史问答模型只收到截断证据包，错误/超预算均回落", async (t) => {
  const f = await fixture(t);
  let received;
  f.assistant.llm = new AssistantLLM({ dataDir: f.dataDir, config: { enabled: true, dailyAskLimit: 1 }, completeImpl: async (input) => {
    received = JSON.parse(input.prompt);
    return "待你选择导出格式 [S1]";
  } });
  const input = { text: "示例商城之前怎么解决", history: [{ role: "user", text: "只用来理解指代的历史" }] };
  assert.equal((await f.assistant.ask(input)).usedModel, true);
  // Earlier turns ride along as conversation, never as citable sources.
  assert.equal(JSON.stringify(received.sources).includes("理解指代"), false);
  assert.equal(received.conversation[0].text, "只用来理解指代的历史");
  assert.ok(received.sources.every((s) => Array.from(s.text).length <= 300));
  const exceeded = await f.assistant.ask({ text: "示例商城上次怎么解决" });
  assert.equal(exceeded.usedModel, false);
  assert.match(exceeded.text, /（未经模型整理）$/);
});

test("尾部只保留短摘录：工单句取交付句/末尾问句并去掉 Markdown", async () => {
  const { threadTail } = await import("../src/assistant-signals.mjs");
  const turn = (text) => ({ turns: [{ status: "completed", items: [{ type: "agentMessage", text }] }] });
  const long = `是的，你感觉很准。\n\n### 本次已完成优化\n- 改为 **自定义下拉**\n- 测试全部通过\n${"补充说明。".repeat(200)}`;
  const tail = threadTail(turn(long));
  assert.ok(Array.from(tail.text).length <= 200, "摘录有上限，overview 不携带整段原文");
  assert.equal(tail.evidence, "本次已完成优化");
  assert.equal(harvestEvidenceForThread({ id: "codex:default:t1", assistantTail: tail }), "本次已完成优化");
  const asking = threadTail(turn("先把结论放前面：示例商城已部署。\n\n需要我把改动推送到 main，还是等你确认？"));
  assert.equal(asking.asking, true);
  assert.equal(asking.question, "需要我把改动推送到 main，还是等你确认？");
  assert.equal(threadTail(turn("评审结论：暂缓合入。已完成修复，测试全部通过。")).evidence, null);
});

test("冷启动读尾部受时间预算约束，未读完的在后台补齐", async () => {
  const { AssistantService } = await import("../src/assistant-service.mjs");
  let release;
  const gate = new Promise((r) => { release = r; });
  const hub = { async readThread(id) { await gate; return { thread: { id, turns: [{ status: "completed", items: [{ type: "agentMessage", text: "需要我继续吗？" }] }] } }; } };
  const svc = new AssistantService({ hub, dataDir: "/tmp/unused-assistant-budget", evidenceBudgetMs: 20 });
  const threads = [{ id: "codex:default:a", updatedAt: 1 }, { id: "codex:default:b", updatedAt: 1 }];
  const started = Date.now();
  const first = await svc.readThreadEvidence(threads);
  assert.ok(Date.now() - started < 1000);
  assert.equal(first.some((t) => t.assistantTail), false);
  release();
  await new Promise((r) => setTimeout(r, 10));
  const second = await svc.readThreadEvidence(threads);
  assert.equal(second.every((t) => t.assistantTail?.asking), true);
});

test("工单处理按主体记：类型变了照样能标完成，新动静后完成的卡会再出现", async (t) => {
  const f = await fixture(t);
  const card = allTopics(await f.overview.getOverview())[0].assistantSignals.cards[0];
  const staleId = `${card.type === "harvest" ? "ruin" : "harvest"}:${cardSubject(card.id)}`;
  const result = await f.assistant.cardAction(staleId, { type: "done" });
  assert.equal(result.ok, true);
  assert.equal(allTopics(await f.overview.getOverview())[0].assistantSignals.cards.length, 0);
  // Already-hidden or vanished cards still accept bookkeeping actions instead of 404.
  assert.equal((await f.assistant.cardAction("ruin:gone-thread", { type: "park" })).ok, true);
  assert.equal(f.sent.length, 0);

  const doneAt = "2026-11-25T08:00:00.000Z";
  const state = { [cardSubject(card.id)]: { type: "done", at: doneAt } };
  assert.equal(isCardHandled({ id: card.id, since: "2026-11-24T08:00:00.000Z" }, state), true);
  assert.equal(isCardHandled({ id: card.id, since: "2026-11-25T09:00:00.000Z" }, state), false);
  assert.equal(isCardHandled({ id: card.id, since: "2026-11-25T09:00:00.000Z" }, { [cardSubject(card.id)]: { type: "dismiss", at: doneAt } }), true);
  // States written before subject keys existed still apply.
  assert.equal(isCardHandled({ id: card.id, since: "2026-11-24T08:00:00.000Z" }, { [card.id]: { type: "park", at: doneAt } }), true);
});

test("收菜由模型判：模型裁决覆盖措辞规则，无实锤不亮金，裁决持久化", async (t) => {
  const f = await fixture(t);
  const prompts = [];
  f.assistant.llm = new AssistantLLM({ dataDir: f.dataDir, config: { enabled: true }, now: () => ASSISTANT_NOW, completeImpl: async (input) => {
    assert.match(input.system, /验收员/);
    const payload = JSON.parse(input.prompt);
    prompts.push(payload);
    return payload.reply.includes("账单")
      ? '判定如下 {"delivered":true,"verified":true,"evidence":"分类脚本已跑通，输出 12 类","missing":""}'
      : '{"delivered":true,"verified":false,"evidence":"","missing":"没看到运行结果"}';
  } });
  const harvestOf = (o, i) => allTopics(o)[i].assistantSignals.cards.find((c) => c.type === "harvest");
  // Before verdicts arrive the wording rule is the fallback.
  assert.ok(harvestOf(await f.overview.getOverview(), 2));
  let overview;
  for (let i = 0; i < 50; i++) {
    overview = await f.overview.getOverview();
    if (harvestOf(overview, 3)) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(harvestOf(overview, 3).line, "分类脚本已跑通，输出 12 类");
  assert.equal(harvestOf(overview, 2), undefined, "模型说没有实锤，措辞再像也不亮金");
  assert.equal(allTopics(overview)[2].readyToHarvest, false);
  // Asking and live threads are never sent to the judge.
  assert.deepEqual(prompts.map((p) => p.reply).sort(), ["可以按分类整理账单。", "已完成导出，生成了 24 个文件，测试全部通过。"].sort());
  await new Promise((r) => setTimeout(r, 30));
  const stored = JSON.parse(await readFile(resolve(f.dataDir, "assistant", "harvest-judgments.json"), "utf8"));
  assert.equal(stored[f.threads[3].id].verified, true);
  assert.equal(stored[f.threads[2].id].missing, "没看到运行结果");
});

test("收菜判定解析：只认合法 JSON，声称验证但无证据降为未验证，模型不可用回落", async (t) => {
  const f = await fixture(t);
  const judge = (text) => new AssistantLLM({ dataDir: f.dataDir, config: { enabled: true }, completeImpl: async () => text });
  const input = { title: "导出", ask: "导出账单", reply: "已导出" };
  assert.equal((await judge('{"delivered":true,"verified":true,"evidence":"","missing":""}').judgeHarvest(input)).verified, false);
  assert.equal((await judge('{"delivered":false,"verified":true,"evidence":"x"}').judgeHarvest(input)).verified, false);
  assert.equal(await judge("看起来完成了").judgeHarvest(input), null);
  assert.equal(await new AssistantLLM({ dataDir: f.dataDir, config: { enabled: true } }).judgeHarvest(input), null);
  assert.equal(await new AssistantLLM({ dataDir: f.dataDir, config: { enabled: false }, completeImpl: async () => "{}" }).judgeHarvest(input), null);
});

const waitFor = async (fn, tries = 60) => {
  for (let i = 0; i < tries; i++) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); }
  return null;
};

test("钉成工单：模型起草目标与验收标准，幂等；验收标准进判定，未逐条满足不亮金；续做走 goal", async (t) => {
  const f = await fixture(t);
  const judged = [];
  f.assistant.llm = new AssistantLLM({ dataDir: f.dataDir, config: { enabled: true }, now: () => ASSISTANT_NOW, completeImpl: async (input) => {
    const payload = JSON.parse(input.prompt);
    if (input.system === TICKET_DRAFT_PROMPT) return '{"title":"账单分类","goal":"把账单按分类整理出来","criteria":["分类脚本能跑通","输出分类数量"]}';
    if (/验收员/.test(input.system)) {
      judged.push(payload);
      return payload.criteria?.length
        ? '{"delivered":true,"verified":false,"evidence":"","missing":"没看到分类脚本运行结果"}'
        : '{"delivered":true,"verified":true,"evidence":"已给出分类方案","missing":""}';
    }
    return null;
  } });
  const thread = f.threads[3];
  const { ticket } = await f.assistant.createTicket({ threadId: thread.id });
  assert.equal(ticket.title, "账单分类");
  assert.deepEqual(ticket.criteria, ["分类脚本能跑通", "输出分类数量"]);
  assert.equal(ticket.topicId, "line-3");
  assert.equal((await f.assistant.createTicket({ threadId: thread.id })).existed, true);
  const overview = await waitFor(async () => {
    const o = await f.overview.getOverview();
    return o.assistantTickets?.[0]?.state === "missing" ? o : null;
  });
  assert.ok(overview, "带验收标准的判定应回写到工单状态");
  assert.match(overview.assistantTickets[0].line, /还差：没看到分类脚本运行结果/);
  assert.ok(judged.some((p) => p.criteria?.length === 2), "判定输入应带验收标准");
  assert.equal(allTopics(overview)[3].assistantSignals.cards.find((c) => c.type === "harvest"), undefined, "验收标准没满足就不亮金");
  // Editing the criteria re-judges against the new list.
  await f.assistant.updateTicket(ticket.id, { criteria: "能导出 CSV" });
  assert.ok(await waitFor(async () => { await f.overview.getOverview(); return judged.some((p) => p.criteria?.[0] === "能导出 CSV"); }));
  // Continuing a ticket card carries goal and criteria and runs as a goal.
  f.setNow(ASSISTANT_NOW + 3 * 86400000);
  const stale = await f.overview.getOverview();
  const card = allTopics(stale)[3].assistantSignals.cards.find((c) => c.id === `ruin:ticket:${ticket.id}`);
  assert.ok(card, "停了 3 天的工单重新浮出");
  assert.equal(card.ticketId, ticket.id);
  await f.assistant.cardAction(card.id, { type: "continue", message: "接着做" });
  assert.equal(f.sent.at(-1).threadId, thread.id);
  assert.equal(f.sent.at(-1).goalMode, true);
  assert.match(f.sent.at(-1).text, /^接着做\n任务目标：把账单按分类整理出来\n验收标准：\n1\. 能导出 CSV/);
  await f.assistant.cardAction(card.id, { type: "done" });
  assert.equal((await f.assistant.listTickets({ status: "done" })).tickets[0].id, ticket.id);
  assert.equal((await f.assistant.listTickets()).tickets.length, 0);
  await assert.rejects(f.assistant.updateTicket(ticket.id, { status: "closed" }), /open\/done\/dropped/);
});

test("没有模型时工单仍可建：目标取会话标题，不带验收标准", async (t) => {
  const f = await fixture(t);
  const { ticket } = await f.assistant.createTicket({ threadId: f.threads[0].id });
  assert.equal(ticket.title, "示例商城导出");
  assert.deepEqual(ticket.criteria, []);
  assert.equal(ticket.draftedBy, "");
  await assert.rejects(f.assistant.createTicket({}), /工位/);
});

test("定时任务冒泡：失败变待拍板卡并可重试，按 cwd 归产线，家目录归收件箱，卡上标来源任务", async (t) => {
  const f = await fixture(t);
  const ran = [];
  f.assistant.automations = {
    list: async () => [
      { taskKey: "codex:default:nightly", name: "夜间巡检", status: "ACTIVE", cwds: ["/Users/alice/projects/demo-1/sub"], lastStatus: "error", lastError: "实例离线", lastTriggeredAtMs: ASSISTANT_NOW - 3600000 },
      { taskKey: "custom:morning", name: "晨报", status: "ACTIVE", cwds: ["/Users/alice"], lastStatus: "error", lastError: "模型不可用", lastTriggeredAtMs: ASSISTANT_NOW - 7200000 },
      { taskKey: "custom:export", name: "导出", status: "ACTIVE", cwds: ["/Users/alice/projects/demo-2"], lastStatus: "triggered", lastThreadId: f.threads[2].id },
    ],
    run: async (key) => { ran.push(key); },
  };
  const o = await f.overview.getOverview();
  assert.ok(allTopics(o)[1].assistantSignals.cards.some((c) => c.id === "alert:auto:codex:default:nightly" && /实例离线/.test(c.line)));
  assert.deepEqual(o.assistantInbox.cards.map((c) => c.id), ["alert:auto:custom:morning"]);
  assert.equal(o.assistantBadges.alert, 3);
  assert.equal(allTopics(o)[2].assistantSignals.cards.find((c) => c.type === "harvest").originLabel, "定时任务·导出");
  await f.assistant.cardAction("alert:auto:custom:morning", { type: "retry" });
  assert.deepEqual(ran, ["custom:morning"]);
  await assert.rejects(f.assistant.cardAction(allTopics(o)[0].assistantSignals.cards[0].id, { type: "retry" }), /不是定时任务/);
  const tour = await f.assistant.tour();
  assert.ok(tour.stops.some((s) => s.topicId === "" && s.cards[0].id === "alert:auto:custom:morning"));
});

test("连续对话：之前几轮对话随证据包交给模型，用来理解指代", async (t) => {
  const f = await fixture(t);
  let seen = null;
  f.assistant.llm = new AssistantLLM({ dataDir: f.dataDir, config: { enabled: true }, now: () => ASSISTANT_NOW, completeImpl: async (input) => {
    if (/验收员/.test(input.system)) return '{"delivered":false,"verified":false,"evidence":"","missing":""}';
    seen = JSON.parse(input.prompt);
    return "停在导出格式要你选 A 还是 B [S1]";
  } });
  const answer = await f.assistant.ask({ text: "它卡在哪", focus: ["line-0"], history: [
    { role: "user", text: "示例商城做到哪了" }, { role: "assistant", text: "示例商城停在导出格式。" }] });
  assert.equal(answer.usedModel, true);
  assert.deepEqual(seen.conversation.map((h) => h.role), ["user", "assistant"]);
  assert.equal(seen.conversation[0].text, "示例商城做到哪了");
});

test("全能对话：无产线命中也能自由聊天，不强制 [S1] 与 clarify 拦截", async (t) => {
  const f = await fixture(t);
  let seenPrompt = null;
  f.assistant.llm = new AssistantLLM({ dataDir: f.dataDir, config: { enabled: true }, now: () => ASSISTANT_NOW, completeImpl: async (input) => {
    seenPrompt = JSON.parse(input.prompt);
    return JSON.stringify({
      reply: "可以叫「极简清单」，先从每日三件事切入最轻巧。",
      spokenReply: "我觉得可以叫极简清单，先做每日三件事最轻巧。",
      mood: "good",
      intent: "chat",
      action: {},
    });
  } });
  const answer = await f.assistant.ask({ text: "帮我想个新产品的名字和切入点", mode: "phone", sessionId: "s-chat" });
  assert.equal(answer.kind, "answer");
  assert.equal(answer.usedModel, true);
  assert.match(answer.text, /极简清单/);
  assert.doesNotMatch(answer.text, /\[S\d+\]|未经模型整理/);
  assert.equal(answer.spokenReply, "我觉得可以叫极简清单，先做每日三件事最轻巧。");
  assert.ok(seenPrompt.park?.topics?.length >= 4, "全园上下文应传给模型");
  // Plain text replies from the model are never discarded either.
  f.assistant.llm = new AssistantLLM({ dataDir: f.dataDir, config: { enabled: true }, now: () => ASSISTANT_NOW, completeImpl: async () => "今天先盯导出格式选择，很快就能收尾。" });
  const plain = await f.assistant.ask({ text: "今天先干嘛好", sessionId: "s-plain" });
  assert.equal(plain.usedModel, true);
  assert.equal(plain.text, "今天先盯导出格式选择，很快就能收尾。");
});

test("分级动作执行：风险分级、服务端一次性提案/过期、续做自动排队、amend/cancel 流转", async (t) => {
  const f = await fixture(t);
  const responded = [];
  const queued = [];
  f.hub.allPendingRequests = () => [{ id: "req_1", threadId: f.threads[1].id, title: "允许运行测试", command: "npm test" }];
  f.hub.respondToRequest = async (id, payload) => { responded.push({ id, ...payload }); };
  f.hub.queueTurn = async (payload) => { queued.push(payload); return { ok: true }; };
  f.hub.interrupt = async () => ({ ok: true });

  assert.equal(resolveActionRisk("focus_topic"), "direct");
  assert.equal(resolveActionRisk("continue_thread"), "toggle");
  assert.equal(resolveActionRisk("approve_request", { decision: "decline" }), "toggle");
  assert.equal(resolveActionRisk("approve_request", { decision: "accept" }), "confirm");
  assert.equal(resolveActionRisk("dispatch"), "confirm");
  assert.equal(resolveActionRisk("interrupt_thread"), "confirm");

  let nextModelReply = null;
  f.assistant.llm = new AssistantLLM({
    dataDir: f.dataDir,
    config: { enabled: true },
    now: () => ASSISTANT_NOW,
    completeImpl: async (input) => {
      if (nextModelReply) return nextModelReply(JSON.parse(input.prompt));
      const p = JSON.parse(input.prompt);
      if (/不存在/.test(p.question)) {
        return JSON.stringify({ spokenReply: "好的", reply: "好的", intent: "approve_request", action: { requestId: "fake_req", decision: "accept" } });
      }
      if (/继续/.test(p.question)) {
        return JSON.stringify({ spokenReply: "让甲继续做。", reply: "让甲继续做。", intent: "continue_thread", action: { threadId: f.threads[0].id, message: "选择格式 A" } });
      }
      if (/队列/.test(p.question)) {
        return JSON.stringify({ spokenReply: "已排进下一轮。", reply: "已排进下一轮。", intent: "continue_thread", action: { threadId: f.threads[1].id, message: "顺便跑个单测" } });
      }
      if (/拒绝/.test(p.question)) {
        return JSON.stringify({ spokenReply: "拒绝该请求。", reply: "拒绝该请求。", intent: "approve_request", action: { requestId: "req_1", decision: "decline" } });
      }
      if (/中断/.test(p.question)) {
        return JSON.stringify({ spokenReply: "准备中断。", reply: "准备中断。", intent: "interrupt_thread", action: { threadId: f.threads[1].id } });
      }
      return JSON.stringify({ spokenReply: "请确认批准这个请求。", reply: "请确认批准这个请求。", intent: "approve_request", action: { requestId: "req_1", decision: "accept" } });
    },
  });

  // 1. Chat mode (autoExecute: false) returns a slim server-stored proposal without leaking payload.
  const proposed = await f.assistant.ask({ text: "帮我批准允许运行测试", mode: "chat", autoExecute: false, sessionId: "s1" });
  assert.equal(responded.length, 0);
  assert.equal(proposed.proposal?.intent, "approve_request");
  assert.equal(proposed.proposal?.risk, "confirm");
  assert.equal(proposed.proposal?.payload, undefined);

  // 2. High-risk actions (approve_request:accept, interrupt_thread) force confirmation even when autoExecute: true.
  const forcedAccept = await f.assistant.ask({ text: "帮我批准允许运行测试", mode: "phone", autoExecute: true, sessionId: "s-phone-confirm" });
  assert.equal(forcedAccept.executedAction, undefined);
  assert.equal(forcedAccept.proposal?.risk, "confirm");
  assert.equal(responded.length, 0);

  const forcedInterrupt = await f.assistant.ask({ text: "帮我中断运行中工位", mode: "phone", autoExecute: true, sessionId: "s-phone-int" });
  assert.equal(forcedInterrupt.executedAction, undefined);
  assert.equal(forcedInterrupt.proposal?.intent, "interrupt_thread");
  assert.equal(forcedInterrupt.proposal?.risk, "confirm");

  // 3. One-time consumption & replay protection.
  const confirmed = await f.assistant.executeProposedAction({ proposalId: forcedAccept.proposal.id });
  assert.equal(confirmed.ok, true);
  assert.deepEqual(responded, [{ id: "req_1", decision: "accept" }]);
  await assert.rejects(
    f.assistant.executeProposedAction({ proposalId: forcedAccept.proposal.id }),
    /已过期或已执行/,
  );

  // 4. Proposal expiration (60s TTL) & cancelProposal.
  const toExpire = await f.assistant.ask({ text: "帮我批准允许运行测试", mode: "chat", autoExecute: false, sessionId: "s-exp" });
  f.setNow(ASSISTANT_NOW + 61_000);
  assert.equal(f.assistant.getPendingProposal(toExpire.proposal.id), null);
  await assert.rejects(f.assistant.executeProposedAction({ proposalId: toExpire.proposal.id }), /已过期或已执行/);
  f.setNow(ASSISTANT_NOW);

  // 5. Toggle-risk actions obey autoExecute: true (continue idle -> sendTurn; continue live -> queueTurn; decline -> immediate).
  const direct = await f.assistant.ask({ text: "让示例商城继续选格式 A", mode: "phone", autoExecute: true, sessionId: "s2" });
  assert.equal(direct.proposal, undefined);
  assert.equal(direct.executedAction?.ok, true);
  assert.equal(f.sent.at(-1)?.threadId, f.threads[0].id);
  assert.match(f.sent.at(-1)?.text || "", /选择格式 A/);

  const sentBeforeQueue = f.sent.length;
  const queuedRes = await f.assistant.ask({ text: "给运行中工位队列加一句", mode: "phone", autoExecute: true, sessionId: "s2-queue" });
  assert.equal(queuedRes.executedAction?.ok, true);
  assert.equal(queuedRes.executedAction?.queued, true);
  assert.equal(f.sent.length, sentBeforeQueue, "live 工位续做不得直接 sendTurn");
  assert.equal(queued.at(-1)?.threadId, f.threads[1].id);
  assert.match(queued.at(-1)?.text || "", /顺便跑个单测/);

  const declineDirect = await f.assistant.ask({ text: "帮我拒绝请求", mode: "phone", autoExecute: true, sessionId: "s-dec" });
  assert.equal(declineDirect.executedAction?.ok, true);
  assert.deepEqual(responded.at(-1), { id: "req_1", decision: "decline" });

  // 6. Model-driven proposalAction confirm / amend / cancel.
  const baseProp = await f.assistant.ask({ text: "帮我批准允许运行测试", mode: "chat", autoExecute: false, sessionId: "s-act" });
  nextModelReply = (p) => {
    assert.equal(p.pendingProposal?.id, baseProp.proposal.id);
    return JSON.stringify({
      spokenReply: "好的，改一下，改为中断这个工位，确认吗？",
      reply: "改为中断工位，请确认。",
      intent: "interrupt_thread",
      action: { threadId: f.threads[1].id },
      proposalAction: "amend",
    });
  };
  const amended = await f.assistant.ask({ text: "别批准了，直接中断它", mode: "phone", sessionId: "s-act", proposalId: baseProp.proposal.id });
  assert.equal(f.assistant.getPendingProposal(baseProp.proposal.id), null);
  assert.equal(amended.proposal?.intent, "interrupt_thread");
  assert.notEqual(amended.proposal?.id, baseProp.proposal.id);

  nextModelReply = () => JSON.stringify({ spokenReply: "好，我确认执行。", reply: "已批准。", intent: "chat", action: {}, proposalAction: "confirm" });
  const modelConfirmed = await f.assistant.ask({ text: "就按刚改的执行吧", mode: "phone", sessionId: "s-act", proposalId: amended.proposal.id });
  assert.equal(modelConfirmed.clearedProposal, true);
  assert.equal(modelConfirmed.executedAction?.intent, "interrupt_thread");
  assert.equal(modelConfirmed.executedAction?.ok, true);

  nextModelReply = null;
  // 7. Forged requestId never produces a proposal or runs.
  const forged = await f.assistant.ask({ text: "批准一个不存在的请求", mode: "phone", autoExecute: true, sessionId: "s3" });
  assert.equal(forged.proposal, undefined);
  assert.equal(forged.executedAction, undefined);
  await assert.rejects(f.assistant.executeProposedAction({ intent: "approve_request", requestId: "fake_req", decision: "accept" }), /不存在/);
});

test("精准跳转链接提取：回复点名具体会话（含无 refs 兜底与 refs 校验）不误取无关 sources[0]", async (t) => {
  const f = await fixture(t);
  f.threads.push(assistantThread("E", f.topics[3], 0.2, "已完成对账单导出格式排查与修复。", { title: "对账单导出格式排查" }));
  f.assistant.llm = new AssistantLLM({
    dataDir: f.dataDir,
    config: { enabled: true },
    now: () => ASSISTANT_NOW,
    completeImpl: async (input) => {
      const p = JSON.parse(input.prompt);
      if (/验收员/.test(input.system)) return '{"delivered":false,"verified":false,"evidence":"","missing":""}';
      if (/不填refs/.test(p.question)) {
        return JSON.stringify({
          reply: "在「记账小程序」产线下的 对账单导出格式排查 会话里已完成处理。",
          spokenReply: "记账小程序里的对账单导出格式排查已经做完了。",
          focusTopicId: "line-3",
          mood: "good",
          intent: "chat",
          action: {},
        });
      }
      return JSON.stringify({
        reply: "请查看对账单导出格式排查会话。",
        spokenReply: "请看对账单导出格式排查。",
        focusTopicId: "line-3",
        refs: ["codex:default:E", "codex:default:nonexistent", "line-3"],
        mood: "report",
        intent: "chat",
        action: {},
      });
    },
  });

  const noRefs = await f.assistant.ask({ text: "今天干活的是哪个会话？不填refs" });
  assert.equal(noRefs.links?.[0]?.kind, "thread");
  assert.equal(noRefs.links?.[0]?.id, "codex:default:E");
  assert.equal(noRefs.links?.[0]?.matchText, "对账单导出格式排查");
  assert.ok(noRefs.links?.some((l) => l.kind === "topic" && l.id === "line-3"));
  assert.equal(noRefs.actions.find((a) => a.type === "open_thread")?.payload?.threadId, "codex:default:E");

  const withRefs = await f.assistant.ask({ text: "帮我看看今天哪个会话完工了", sessionId: "s-refs" });
  assert.equal(withRefs.links.some((l) => l.id === "codex:default:nonexistent"), false, "伪造 ID 必须被过滤");
  assert.equal(withRefs.links?.[0]?.id, "codex:default:E");
});

test("后台验收判定携带 background=true 隔离交互队列，外部 signal 可中止 ask()", async (t) => {
  const f = await fixture(t);
  const bgFlags = [];
  f.assistant.llm = new AssistantLLM({
    dataDir: f.dataDir,
    config: { enabled: true },
    now: () => ASSISTANT_NOW,
    completeImpl: async (input) => {
      bgFlags.push({ isJudge: /验收员/.test(input.system), background: input.background });
      if (/验收员/.test(input.system)) return '{"delivered":true,"verified":true,"evidence":"测试全过","missing":""}';
      await new Promise((resolve) => setTimeout(resolve, 200));
      return JSON.stringify({ reply: "延迟回答", spokenReply: "延迟回答", intent: "chat", action: {} });
    },
  });
  await f.overview.getOverview();
  await waitFor(async () => bgFlags.some((x) => x.isJudge));
  assert.equal(bgFlags.find((x) => x.isJudge)?.background, true);

  const ac = new AbortController();
  const askPromise = f.assistant.ask({ text: "现在园区什么情况", sessionId: "s-abort" }, { signal: ac.signal });
  setTimeout(() => ac.abort(), 30);
  await assert.rejects(askPromise, (err) => Boolean(err?.aborted || err?.name === "AbortError"));
  assert.equal(bgFlags.find((x) => !x.isJudge)?.background, false);
});

test("语音派活：preview拆单(confirmOnly) -> 确认走approvedRoutes(不二次规划) -> 自动建Task树并异步补验收标准", async (t) => {
  const f = await fixture(t);
  const started = [];
  const boundTasks = [];
  const profiles = [
    { provider: "codex", id: "personal", label: "Codex 自用", installed: true, health: { status: "healthy", alias: "AliasA" }, account: { signedIn: true, email: "alice@example.com" } },
    { provider: "claude", id: "default", label: "Claude 默认", installed: true, health: { status: "healthy", alias: "AliasB" }, account: { signedIn: true, email: "bob@example.com" } },
    { provider: "antigravity", id: "cli", label: "Antigravity CLI", installed: true, health: { status: "unavailable" }, account: { signedIn: true } },
    { provider: "antigravity", id: "desktop", label: "Antigravity", installed: true, health: { status: "healthy" }, account: { signedIn: true } },
    { provider: "grok", id: "default", label: "Grok 默认", installed: true, health: {}, account: { signedIn: false } },
  ];
  f.hub.listProvidersAndProfiles = async () => ({
    profiles,
    defaultProvider: "antigravity",
    defaultProfileId: "desktop",
  });
  f.hub.startThread = async (payload) => {
    started.push(payload);
    return { thread: { id: `${payload.provider}:${payload.profileId}:new-${started.length}`, title: payload.text } };
  };
  f.hub.setThreadTask = async (threadId, taskId) => {
    boundTasks.push({ threadId, taskId });
  };

  let seenParkAgents = null;
  let nextModelAgentKey = "";
  const draftCalls = [];
  f.assistant.llm = new AssistantLLM({
    dataDir: f.dataDir,
    config: { enabled: true },
    now: () => ASSISTANT_NOW,
    completeImpl: async (input) => {
      if (input.system === TICKET_DRAFT_PROMPT) {
        draftCalls.push({ background: input.background, prompt: JSON.parse(input.prompt) });
        return JSON.stringify({ title: "派工子单", goal: "完成验证", criteria: ["测试通过", "日志可查"] });
      }
      const p = JSON.parse(input.prompt);
      if (/验收员/.test(input.system)) return '{"delivered":false,"verified":false,"evidence":"","missing":""}';
      seenParkAgents = p.park?.agents || [];
      return JSON.stringify({
        spokenReply: "好，已经帮你派单了。",
        reply: "好，我来帮你派单处理。",
        focusTopicId: "line-0",
        mood: "good",
        intent: "dispatch",
        action: {
          instruction: "排查语音播放链路",
          topicId: "line-0",
          agentKey: nextModelAgentKey,
          mode: "new",
        },
      });
    },
  });

  // Phone mode (even with autoExecute: true) enriches dispatch preview, speaks confirm question, and builds Task on confirm.
  for (const [idx, caseSpec] of [
    { inputAgentKey: "codex", expectedProvider: "codex", expectedProfile: "personal" },
    { inputAgentKey: "claude", expectedProvider: "claude", expectedProfile: "default" },
    { inputAgentKey: "antigravity", expectedProvider: "antigravity", expectedProfile: "desktop" },
    { inputAgentKey: "antigravity:default", expectedProvider: "antigravity", expectedProfile: "desktop" },
    { inputAgentKey: "AliasA", expectedProvider: "codex", expectedProfile: "personal" },
    { inputAgentKey: "默认", expectedProvider: null, expectedProfile: null },
  ].entries()) {
    nextModelAgentKey = caseSpec.inputAgentKey;
    const beforeStarted = started.length;
    const res = await f.assistant.ask({
      text: `帮我派单测试-${idx}`,
      mode: "phone",
      autoExecute: true,
      sessionId: `sp-${idx}`,
    });
    if (idx === 0) {
      assert.equal(seenParkAgents.some((a) => a.agentKey === "codex:personal"), true);
      assert.equal(seenParkAgents.some((a) => a.agentKey === "antigravity:desktop"), true);
      assert.equal(seenParkAgents.some((a) => a.agentKey === "antigravity:cli"), false, "unavailable 账号不进候选提示");
      assert.equal(seenParkAgents.some((a) => a.agentKey === "grok:default"), false, "未登录账号不进候选提示");
    }
    assert.equal(started.length, beforeStarted, "ask() 仅预览拆单，确认前绝不启动工位");
    assert.equal(res.proposal?.intent, "dispatch");
    assert.equal(res.proposal?.risk, "confirm");
    assert.equal(res.proposal?.payload, undefined);
    assert.match(res.spokenReply, /确认发吗/);
    assert.doesNotMatch(res.text, /不可用|未登录/);

    const execRes = await f.assistant.executeProposedAction({ proposalId: res.proposal.id });
    assert.equal(execRes.ok, true, `case ${caseSpec.inputAgentKey} 应成功: ${execRes.error}`);
    assert.equal(execRes.taskIds?.length, 1);
    const created = started.at(-1);
    if (caseSpec.expectedProvider) {
      assert.equal(created.provider, caseSpec.expectedProvider);
      assert.equal(created.profileId, caseSpec.expectedProfile);
    }
  }

  // Multi-route split dispatch: confirmOnly:true preview -> confirm executes approvedRoutes without re-planning & creates parent+child tasks.
  const dispatchCalls = [];
  const origDispatch = f.assistant.dispatchImpl;
  f.assistant.dispatchImpl = async (opts) => {
    dispatchCalls.push(opts);
    if (opts.confirmOnly) {
      return {
        ok: true,
        confirmOnly: true,
        aiPlanned: true,
        routes: [
          { topicId: "line-0", topicName: "示例商城", agentKey: "codex:personal", agentLabel: "Codex 自用", segmentText: "修复后端接口", action: "spawn_parallel" },
          { topicId: "line-1", topicName: "绘本工坊", agentKey: "claude:default", agentLabel: "Claude 默认", segmentText: "补全前端展示", action: "spawn_parallel" },
        ],
      };
    }
    return {
      ok: true,
      confirmOnly: false,
      dispatched: opts.approvedRoutes.map((r, i) => ({
        ...r,
        cwd: `/Users/alice/projects/demo-${i}`,
        threadId: `mock:default:split-${i + 1}`,
      })),
    };
  };

  nextModelAgentKey = "auto";
  const splitAsk = await f.assistant.ask({ text: "把商城接口和绘本前端一起拆单派下去", mode: "phone", sessionId: "sp-split" });
  assert.equal(dispatchCalls[0].confirmOnly, true);
  assert.equal(dispatchCalls[0].useAiPlanner, true);
  assert.equal(splitAsk.proposal?.routes?.length, 2);
  assert.match(splitAsk.spokenReply, /准备拆 2 路.*确认发吗/);

  const splitExec = await f.assistant.executeProposedAction({ proposalId: splitAsk.proposal.id });
  assert.equal(dispatchCalls[1].confirmOnly, false);
  assert.equal(dispatchCalls[1].useAiPlanner, false, "执行阶段不得重复 AI 规划");
  assert.equal(dispatchCalls[1].approvedRoutes?.length, 2);
  assert.equal(splitExec.taskIds?.length, 3, "多路派工应建 1 个父任务 + 2 个子任务");

  await waitFor(async () => {
    const tasks = await f.assistant.taskStore.list({ status: "all" });
    const children = tasks.filter((tk) => tk.parentId === splitExec.taskIds[0]);
    return children.length === 2 && children.every((tk) => tk.criteria.length > 0);
  });
  assert.equal(draftCalls.every((c) => c.background === true), true);
  const allTasks = await f.assistant.taskStore.list({ status: "all" });
  const splitChildren = allTasks.filter((tk) => tk.parentId === splitExec.taskIds[0]);
  assert.equal(splitChildren.length, 2);
  assert.deepEqual(splitChildren[0].criteria, ["测试通过", "日志可查"]);
  assert.ok(boundTasks.some((b) => b.threadId === "mock:default:split-1"));
  f.assistant.dispatchImpl = origDispatch;
});

test("结果回流队列：handleHubEvent 仅收录受追踪工位并去重，pop/list/ack 顺序消费", async (t) => {
  const f = await fixture(t);
  const tk = await f.assistant.taskStore.create({
    title: "支付联调",
    goal: "修复回调",
    topicId: "line-0",
    threadIds: [f.threads[0].id],
  });

  // Unrelated / interrupted / internal threads are ignored.
  assert.equal(await f.assistant.handleHubEvent("turn_completed", { threadId: "codex:default:unrelated", status: "completed" }), null);
  assert.equal(await f.assistant.handleHubEvent("turn_completed", { threadId: f.threads[0].id, status: "interrupted" }), null);
  assert.equal(await f.assistant.handleHubEvent("turn_completed", { threadId: f.threads[0].id, internal: true, status: "completed" }), null);

  // Tracked open ticket thread enqueues once per dedupeKey.
  const n1 = await f.assistant.handleHubEvent("turn_completed", { threadId: f.threads[0].id, turnId: "turn-1", status: "completed" });
  assert.equal(n1?.kind, "completed");
  assert.match(n1?.text || "", /支付联调.*已经跑完了/);
  assert.equal(await f.assistant.handleHubEvent("turn_completed", { threadId: f.threads[0].id, turnId: "turn-1", status: "completed" }), null);

  const n2 = await f.assistant.handleHubEvent("provider_event", { method: "turn/completed", threadId: f.threads[0].id, params: { turn: { id: "turn-2", status: "failed" } } });
  assert.equal(n2?.kind, "failed");
  assert.match(n2?.text || "", /执行出错/);

  const pop1 = await f.assistant.popPendingVoiceNotices({ limit: 1 });
  assert.equal(pop1.notices.length, 1);
  assert.equal(pop1.notices[0].id, n1.id);
  assert.equal(pop1.remainingCount, 1);

  const pop2 = await f.assistant.popPendingVoiceNotices({ limit: 2 });
  assert.equal(pop2.notices.length, 1);
  assert.equal(pop2.notices[0].id, n2.id);
  assert.equal(pop2.remainingCount, 0);

  const unread = await f.assistant.listUnreadNotices();
  assert.equal(unread.unreadCount, 2);
  await f.assistant.ackNotices([n1.id]);
  assert.equal((await f.assistant.listUnreadNotices()).unreadCount, 1);
  assert.equal(tk.id.startsWith("tk_"), true);
});

test("流式 JSON 首字段解析 extractCompleteJsonStringField 与短句跳过检索 shouldSearchParkSources", async (t) => {
  assert.equal(extractCompleteJsonStringField('{"spokenReply":"未闭合'), null);
  assert.equal(extractCompleteJsonStringField('{"spokenReply":"先说\\"你好\\"\\n第二句'), null);
  assert.equal(extractCompleteJsonStringField('{"spokenReply":"abc\\'), null);
  assert.equal(
    extractCompleteJsonStringField('{"spokenReply":"先说\\"你好\\"\\n第二句","reply":"屏幕"}', "spokenReply"),
    '先说"你好"\n第二句',
  );
  assert.equal(extractCompleteJsonStringField('{"reply":"先写这个"}', "spokenReply"), null);

  assert.equal(shouldSearchParkSources("你好"), false);
  assert.equal(shouldSearchParkSources("好的！"), false);
  assert.equal(shouldSearchParkSources("嗯对"), false);
  assert.equal(shouldSearchParkSources("ok"), false);
  assert.equal(shouldSearchParkSources("帮我看看进度"), true);
  assert.equal(shouldSearchParkSources("你好", { topic: { id: "line-0", name: "示例商城" } }), true);

  const f = await fixture(t);
  let searchCalls = 0;
  f.hub.searchThreads = async () => { searchCalls += 1; return { threads: [] }; };
  f.assistant.llm = new AssistantLLM({
    dataDir: f.dataDir,
    config: { enabled: true },
    now: () => ASSISTANT_NOW,
    completeImpl: async () => JSON.stringify({ spokenReply: "我在呢，随时吩咐。", reply: "我在。", intent: "chat", action: {} }),
  });
  await f.assistant.ask({ text: "你好", mode: "phone", sessionId: "s-skip" });
  assert.equal(searchCalls, 0, "纯寒暄必须跳过工位全文检索");
  await f.assistant.ask({ text: "帮我看下昨天报错原因", mode: "phone", sessionId: "s-search" });
  assert.equal(searchCalls, 1);
});
