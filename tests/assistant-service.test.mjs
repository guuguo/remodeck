import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { AssistantLLM } from "../src/assistant-llm.mjs";
import { computeTopicSignals } from "../src/assistant-service.mjs";
import { harvestEvidenceForThread } from "../src/assistant-signals.mjs";
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
  assert.equal(state[card.id].until, until.replace("Z", ".000Z"));
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
  const input = { text: "示例商城之前怎么解决", history: [{ role: "user", text: "不应进入模型的无关历史" }] };
  assert.equal((await f.assistant.ask(input)).usedModel, true);
  assert.equal(JSON.stringify(received).includes("无关历史"), false);
  assert.ok(received.sources.every((s) => Array.from(s.text).length <= 300));
  const exceeded = await f.assistant.ask({ text: "示例商城上次怎么解决" });
  assert.equal(exceeded.usedModel, false);
  assert.match(exceeded.text, /（未经模型整理）$/);
});
