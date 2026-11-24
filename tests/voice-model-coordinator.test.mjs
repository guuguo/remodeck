import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { VoiceCallService } from "../src/voice-call-service.mjs";
import { normalizeVoiceConfig, parseVoiceModelSelectionKey, renderVoiceModelSelectOptionsHtml } from "../public/voice-copilot.js";

const basePlan = { intent: "summarize_progress", spokenReply: "我会根据完整语义回答，不改变任务。" };

async function fixture(t, { provider = "codex", env = {} } = {}) {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-model-voice-"));
  const calls = [];
  const actions = [];
  let response = basePlan;
  let fail = false;
  let svc;
  const threads = ["first", "second"].map((id) => ({ id: `codex:work:${id}`, provider: "codex", cwd: `/dev/${id}`, title: id, live: true }));
  const hub = {
    listThreads: async () => ({ threads, projectsMeta: {} }),
    listProvidersAndProfiles: async () => ({ profiles: [{ provider, id: "work", installed: true, authenticated: true }] }),
    listModels: async () => ({ items: [{ id: "test-model" }] }),
    allPendingRequests: () => [{ id: "codex:work:req", threadId: threads[1].id }],
    readThread: async () => ({ thread: { turns: [] } }),
    startThread: async (input) => {
      calls.push(input);
      if (fail) throw new Error("模型连接失败");
      const id = `${provider}:work:coordinator-${calls.length}`;
      setTimeout(() => void svc.handleHubEvent("provider_event", {
        type: "turn_completed", threadId: id,
        lastAgentMessage: typeof response === "string" ? response : JSON.stringify(response),
      }), 10);
      return { thread: { id } };
    },
    interrupt: async (input) => { actions.push({ action: "interrupt", ...input }); },
    sendTurn: async (input) => { actions.push({ action: "send", ...input }); },
    respondToRequest: async (id, input) => { actions.push({ action: "approve", id, ...input }); },
  };
  svc = new VoiceCallService({ hub, dataDir: dir, env: {
    ...process.env,
    VOICE_ASR_BIN: fileURLToPath(new URL("./helpers/mock-voice-asr.mjs", import.meta.url)),
    EDGE_TTS_BIN: "none", MACOS_SAY_BIN: "none", ...env,
  } });
  t.after(async () => { await svc.close(); await rm(dir, { recursive: true, force: true }); });
  return { svc, calls, actions, threads, setResponse(value) { response = value; }, setFailure() { fail = true; },
    turn: (transcriptText, extra = {}) => svc.handleTurn({ callId: "model-call", transcriptText,
      activeThreadId: threads[0].id, voiceProvider: provider, voiceProfileId: "work", voiceModel: "test-model", tts: false, ...extra }) };
}

test("every non-empty utterance reaches the selected model, including questions, negation, quotes, filler and short replies", async (t) => {
  const f = await fixture(t);
  const phrases = ["为什么停止了我的所有任务", "不要停止", "他刚才说停止运行", "停止运行", "好的", "嗯", "谢谢观看", "今天中午吃什么", "粉絲展現在什麼進度"];
  for (const phrase of phrases) {
    const result = await f.turn(phrase);
    assert.equal(result.model, "test-model");
    assert.equal(result.plan.intent, "summarize_progress");
    assert.equal(result.heardText, phrase);
    assert.match(f.calls.at(-1).text, new RegExp(phrase));
    assert.equal(f.calls.at(-1).permissionMode, "plan");
  }
  assert.equal(f.calls.length, phrases.length);
  assert.equal(f.actions.length, 0);
});

test("model-selected exact target, approval and dispatch mode are honored without keyword overrides", async (t) => {
  const f = await fixture(t);
  f.setResponse({ ...basePlan, intent: "interrupt_thread", targetThreadId: f.threads[1].id });
  await f.turn("请处理一下这件事");
  assert.deepEqual(f.actions.pop(), { action: "interrupt", threadId: f.threads[1].id });
  f.setResponse({ ...basePlan, intent: "send_turn", targetThreadId: f.threads[1].id, instruction: "立即发送，不要排队", dispatchMode: "queue" });
  await f.turn("立即发送，不要排队");
  assert.equal(f.actions.at(-1).steer, undefined);
  f.setResponse({ ...basePlan, intent: "send_turn", targetThreadId: f.threads[1].id, instruction: "请处理一下", dispatchMode: "immediate" });
  await f.turn("请处理一下");
  assert.equal(f.actions.at(-1).steer, true);
  f.setResponse({ ...basePlan, intent: "approve_request", requestId: "codex:work:req", decision: "decline" });
  await f.turn("我同意你刚才的解释");
  assert.deepEqual(f.actions.at(-1), { action: "approve", id: "codex:work:req", decision: "decline" });
});

test("invalid targets, missing approval ids and invalid model output never fall back to the active or first task", async (t) => {
  const f = await fixture(t);
  for (const plan of [
    { intent: "interrupt_thread", targetThreadId: "first", heardText: "停止 first" },
    { intent: "interrupt_thread" },
    { intent: "send_turn", targetProjectCwd: "unknown-project", instruction: "跑测试" },
    { intent: "approve_request", decision: "accept" },
    { intent: "approve_request", requestId: "codex:work:req", decision: "maybe" },
    { intent: "create_thread", targetProjectCwd: "/dev/invented", instruction: "开始" },
  ]) {
    f.setResponse({ ...basePlan, ...plan });
    const result = await f.turn("停止 first，批准第一个请求");
    assert.equal(result.executed.ok, false);
  }
  f.setResponse("这是格式错误的模型回复");
  await assert.rejects(f.turn("停止运行"), /模型.*(?:格式|JSON)/);
  f.setFailure();
  await assert.rejects(f.turn("停止运行"), /模型连接失败/);
  assert.equal(f.actions.length, 0);
});

test("unresolved targets ask a short spoken choice, and an exact project name chosen by the model resolves", async (t) => {
  const f = await fixture(t);
  f.setResponse({ ...basePlan, intent: "send_turn", targetProjectCwd: "/somewhere/else/second", instruction: "跑测试" });
  const resolved = await f.turn("让 second 跑测试");
  assert.equal(resolved.executed.ok, true);
  assert.notEqual(resolved.executed.summaryTag, "目标未确认");

  f.setResponse({ ...basePlan, intent: "create_thread", targetProjectCwd: "/dev/invented", heardText: "让 second 开始", instruction: "开始" });
  const asked = await f.turn("让 second 开始");
  assert.equal(asked.executed.ok, false);
  assert.equal(asked.spokenReply, "是交给second吗？");
  assert.doesNotMatch(asked.spokenReply, /模型|有效/);

  f.setResponse({ ...basePlan, intent: "send_turn", instruction: "跑测试" });
  const ambiguous = await f.turn("跑一下测试");
  assert.match(ambiguous.spokenReply, /^是.+还是.+？$/);
  const snapshot = await f.svc.buildLiveSnapshot({ callId: "model-call" });
  assert.equal(snapshot.pendingClarification.instruction, "跑测试");
  await f.turn("second");
  assert.match(f.calls.at(-1).text, /"pendingClarification":\{"intent":"send_turn"/);
});

test("silence stays acoustic, while model-decided noise and briefings use the same model pipeline", async (t) => {
  const f = await fixture(t);
  const empty = await f.turn("");
  assert.equal(empty.noSpeech, true);
  assert.equal(f.calls.length, 0);
  f.setResponse({ intent: "no_speech", spokenReply: "" });
  const ignored = await f.turn("背景对白");
  assert.equal(ignored.noSpeech, true);
  assert.equal(f.calls.length, 1);
  f.setResponse(basePlan);
  await f.turn("", { mode: "briefing" });
  assert.equal(f.calls.length, 2);
});

test("legacy local-only selections migrate to auto and no local rule option remains", () => {
  assert.equal(normalizeVoiceConfig({ preferredModelKey: "local:local-rules" }).preferredModelKey, "auto");
  assert.equal(parseVoiceModelSelectionKey("local:local-rules").voiceProvider, "auto");
  assert.doesNotMatch(renderVoiceModelSelectOptionsHtml(), /local-rules|本机规则/);
});

test("resolveVoicePlanTarget allows threads[].cwd outside top projects slice while still blocking invented paths, and prompts annotate overlap speech", async (t) => {
  const { resolveVoicePlanTarget } = await import("../src/voice-call-service.mjs");
  const snapshot = {
    projects: [{ cwd: "/dev/top1", name: "top1", threads: [] }],
    threads: [{ id: "antigravity:desktop:t-15", cwd: "/dev/extra/agent-control", title: "语音优化", provider: "antigravity" }],
  };
  const resolved = resolveVoicePlanTarget({
    intent: "send_turn",
    targetProjectCwd: "/dev/extra/agent-control",
    targetThreadId: "antigravity:desktop:t-15",
  }, snapshot);
  assert.equal(resolved.valid, true);
  assert.equal(resolved.cwd, "/dev/extra/agent-control");
  assert.equal(resolved.threadId, "antigravity:desktop:t-15");

  const invented = resolveVoicePlanTarget({
    intent: "create_thread",
    targetProjectCwd: "/dev/not-in-snapshot",
  }, snapshot);
  assert.equal(invented.valid, false);

  const f = await fixture(t);
  f.setResponse({ ...basePlan, intent: "summarize_progress", spokenReply: "已结合你播报时说的话连贯处理。" });
  await f.turn("先停一下看看工作项目", {
    overlapDurationMs: 1200,
    overlapBotText: "当前项目正在运行测试。",
  });
  assert.match(f.calls.at(-1).text, /<SPEECH_TIMING_CONTEXT>.*overlapDurationMs":1200.*aiWasSpeakingText":"当前项目正在运行测试。".*<\/SPEECH_TIMING_CONTEXT>/);
});

test("no available model reports an error instead of using local rules", async (t) => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-no-voice-model-"));
  const svc = new VoiceCallService({ dataDir: dir, env: { AGY_BIN: "none" }, hub: {
    listThreads: async () => ({ threads: [], projectsMeta: {} }),
    listProvidersAndProfiles: async () => ({ profiles: [] }), allPendingRequests: () => [],
    interrupt() { assert.fail("no model must not interrupt tasks"); },
  } });
  t.after(async () => { await svc.close(); await rm(dir, { recursive: true, force: true }); });
  await assert.rejects(svc.handleTurn({ transcriptText: "停止所有任务", tts: false }), /未找到可用.*模型/);
});

for (const provider of ["claude", "grok"]) {
  test(`${provider} processes raw coordinator JSON without truncating it as speech`, async (t) => {
    const f = await fixture(t, { provider });
    f.setResponse({ ...basePlan, spokenReply: "我会根据完整上下文理解当前请求。".repeat(30),
      intent: "interrupt_thread", targetThreadId: f.threads[1].id });
    await f.turn("请处理一下刚才提到的事");
    assert.equal(f.calls[0].provider, provider);
    assert.equal(f.calls[0].model, "test-model");
    assert.deepEqual(f.actions[0], { action: "interrupt", threadId: f.threads[1].id });
  });
}

test("Antigravity uses the same mandatory coordinator over Mock ACP", async (t) => {
  const expected = { ...basePlan, spokenReply: "模型已理解这是一句询问。" };
  const f = await fixture(t, { provider: "antigravity", env: {
    AGY_BIN: fileURLToPath(new URL("./helpers/mock-agy-cli.mjs", import.meta.url)),
    MOCK_VOICE_COORDINATOR_RESPONSE: JSON.stringify(expected),
  } });
  const result = await f.turn("为什么停止了我的任务");
  assert.equal(result.model, "test-model");
  assert.equal(result.spokenReply, expected.spokenReply);
  assert.equal(f.calls.length, 0);
  assert.equal(f.actions.length, 0);
});
