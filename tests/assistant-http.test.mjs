import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { AssistantLLM } from "../src/assistant-llm.mjs";
import { createAgentControlServer } from "../src/server.mjs";
import { CodexProvider } from "../src/providers/codex-provider.mjs";
import { openSearchIndexWriteDb } from "../src/search-index-worker.mjs";
import { searchIndexDbPath } from "../src/search-index.mjs";

async function waitFor(fn) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Mock 协议等待超时");
}

test("T1/T10/T11 HTTP 问答与 NDJSON 使用 Mock CLI，internal 不出现在列表、搜索、SSE 和计数", async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), "ac-assistant-http-"));
  const dataDir = resolve(root, "data"), home = resolve(root, "codex");
  await Promise.all([mkdir(dataDir), mkdir(home)]);
  await writeFile(resolve(dataDir, "mission-domains.json"), JSON.stringify({ version: 3,
    domains: [{ id: "indie-lab", name: "软件研发室" }], topics: [{ id: "shop", name: "示例商城", domainId: "indie-lab", primaryCwd: "/tmp/mock-codex-project", cwdPrefixes: ["/tmp/mock-codex-project"], keywords: ["示例商城"] }] }));
  const env = { ...process.env, HOME: root, USERPROFILE: root, AC_MEMORY_VAULT: "", AGENT_CONTROL_DISABLE_AUTOMATIONS: "1",
    CODEX_BIN: fileURLToPath(new URL("./helpers/mock-codex-cli.mjs", import.meta.url)),
    AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", home }]) };
  const provider = new CodexProvider({ env });
  const srv = await createAgentControlServer({ port: 0, dataDir, env, providers: [provider], disableRelay: true, disableTunnel: true, disableUpdateCheck: true });
  t.after(async () => { await srv.close(); await rm(root, { recursive: true, force: true }); });
  await srv.start();
  const request = async (path, body, method = body ? "POST" : "GET") => {
    const res = await fetch(`${srv.url}${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, body: await res.json() };
  };
  let starts = 0, sends = 0;
  const startThread = srv.hub.startThread.bind(srv.hub), sendTurn = srv.hub.sendTurn.bind(srv.hub);
  srv.hub.startThread = (...args) => { starts++; return startThread(...args); };
  srv.hub.sendTurn = (...args) => { sends++; return sendTurn(...args); };
  const answer = await request("/api/assistant/ask", { text: "示例商城做到哪了" });
  assert.equal(answer.status, 200);
  assert.equal(answer.body.kind, "answer");
  assert.equal(answer.body.focusTopicId, "shop");
  assert.ok(answer.body.sources.some((s) => s.kind === "thread"));
  const streamed = await fetch(`${srv.url}/api/assistant/ask`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" }, body: JSON.stringify({ text: "它卡在哪", focus: ["shop"] }) });
  assert.equal(streamed.status, 200);
  assert.match(streamed.headers.get("content-type"), /application\/x-ndjson/);
  const events = (await streamed.text()).trim().split("\n").map(JSON.parse);
  const final = events.at(-1);
  assert.equal(final.type, "answer");
  assert.equal(final.focusTopicId, "shop");
  for (const [step, kind] of Object.entries({ threads: "thread", commits: "commit", wip: "wip", memory: "memory" })) {
    const count = final.sources.filter((s) => s.kind === kind).length;
    const trace = events.filter((e) => e.type === "trace" && e.step === step);
    assert.equal(trace.length, count ? 1 : 0);
    if (count) assert.equal(trace[0].count, count);
  }
  assert.equal(starts, 0);
  assert.equal(sends, 0);
  // Exercise card delivery through the actual mock protocol on the existing
  // seeded workstation, using the same card shape as the rule fixtures.
  const assistant = srv.overviewService.assistant;
  const originalOverview = assistant.getOverview;
  const snapshot = await originalOverview();
  const topic = snapshot.domains.flatMap((d) => d.topics)[0];
  const originalId = topic.activeThreads[0].id;
  const card = { id: `ruin:${originalId}`, topicId: topic.id, threadId: originalId, type: "ruin", title: "导出格式", line: "等待选择格式", since: new Date().toISOString(), sources: [answer.body.sources.find((s) => s.threadId === originalId)], actions: ["continue", "snooze", "park"] };
  topic.assistantSignals.cards = [card];
  assistant.getOverview = async () => snapshot;
  const continued = await request(`/api/assistant/cards/${encodeURIComponent(card.id)}/action`, { type: "continue", message: "选择 A，请继续。" });
  assistant.getOverview = originalOverview;
  assert.equal(continued.status, 200);
  assert.equal(continued.body.threadId, originalId);
  const delivered = await waitFor(async () => { const r = await srv.hub.readThread(originalId); return r.thread.turns.at(-1)?.status === "completed" && r.thread; });
  assert.match(JSON.stringify(delivered.turns.at(-1).items), /选择 A，请继续/);
  assert.equal(starts, 0);
  assert.equal(sends, 1);
  assert.equal((await request("/api/assistant/profile/aliases", { alias: "小铺", topicId: "shop" })).body.ok, true);
  assert.equal((await request("/api/assistant/profile")).body.aliases["小铺"], "shop");
  assert.equal((await request("/api/assistant/ask", { text: "小铺做到哪了" })).body.focusTopicId, "shop");
  assert.deepEqual((await request("/api/assistant/profile", undefined, "DELETE")).body.aliases, {});
  assert.ok(Array.isArray((await request("/api/assistant/tour")).body.stops));
  assert.equal((await request("/api/assistant/cards/missing/action", { type: "done" })).status, 404);

  // A real Mock CLI request exercises the complete provider → hub → metadata
  // path. The turn may complete immediately, before startThread returns.
  const hubEvents = [];
  const unsubscribe = srv.hub.subscribe((name, payload) => hubEvents.push({ name, payload }));
  t.after(unsubscribe);
  const controller = new AbortController();
  const sse = await fetch(`${srv.url}/api/events`, { signal: controller.signal });
  let wire = "";
  const reader = sse.body.getReader();
  const pump = (async () => {
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; wire += new TextDecoder().decode(value); } }
    catch { /* closed in cleanup */ }
  })();
  t.after(async () => { controller.abort(); await pump; });
  const worker = await srv.hub.startThread({ provider: "codex", profileId: "default", cwd: root, text: "示例商城内部盘点", internal: true, memoryBrief: false });
  const id = worker.thread.id;
  const detail = await waitFor(async () => { const r = await srv.hub.readThread(id); return r.thread.turns.at(-1)?.status === "completed" && r.thread; });
  assert.equal(detail.internal, true);
  const meta = JSON.parse(await readFile(resolve(dataDir, "thread-meta.json"), "utf8"));
  assert.equal(meta.threads[id].internal, true);
  for (const archived of ["0", "all"]) assert.equal((await request(`/api/threads?archived=${archived}`)).body.threads.some((th) => th.id === id), false);
  const overview = (await request("/api/overview")).body;
  assert.equal(overview.radar.liveThreads.some((th) => th.id === id), false);
  assert.equal(overview.radar.totalActiveCount, 1);
  assert.equal(overview.domains.flatMap((d) => d.topics).some((tp) => [...tp.activeThreads, ...tp.archivedThreads].some((th) => th.id === id)), false);
  assert.equal(hubEvents.some((e) => JSON.stringify(e.payload).includes(id)), false);
  await new Promise((r) => setImmediate(r));
  assert.equal(wire.includes(id), false);
  controller.abort();
  await pump;

  // Search must filter metadata even when the old index still contains a row.
  await srv.hub.syncSearchIndexNow();
  const db = openSearchIndexWriteDb(searchIndexDbPath(dataDir));
  for (const tid of [id, "codex:default:public-indexed"]) {
    db.prepare("INSERT OR REPLACE INTO indexed_threads(thread_id,provider,profile_id,raw_id,title,preview,cwd,updated_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(tid, "codex", "default", tid.split(":").at(-1), "示例商城导出", "示例商城", root, Math.floor(Date.now() / 1000));
    db.prepare("INSERT INTO indexed_messages(thread_id,role,seq,updated_at,body) VALUES(?,?,?,?,?)").run(tid, "assistant", 1, Math.floor(Date.now() / 1000), "示例商城导出已验证");
  }
  db.close();
  const searched = (await request("/api/threads/search?q=示例商城&archived=all")).body;
  assert.equal(searched.threads.some((th) => th.id === id), false);
  assert.equal(searched.threads.some((th) => th.id === "codex:default:public-indexed"), true);

  // Models catalog, voice-turn endpoint (silent WAV gate, text turn, confirm/cancel proposal), and action endpoint.
  const modelsRes = await request("/api/assistant/models");
  assert.equal(modelsRes.status, 200);
  assert.ok(Array.isArray(modelsRes.body.options));

  const silentWav = Buffer.alloc(44 + 3200);
  silentWav.write("RIFF", 0, "ascii");
  silentWav.writeUInt32LE(36 + 3200, 4);
  silentWav.write("WAVE", 8, "ascii");
  silentWav.write("fmt ", 12, "ascii");
  silentWav.writeUInt32LE(16, 16);
  silentWav.writeUInt16LE(1, 20);
  silentWav.writeUInt16LE(1, 22);
  silentWav.writeUInt32LE(16000, 24);
  silentWav.writeUInt32LE(32000, 28);
  silentWav.writeUInt16LE(2, 32);
  silentWav.writeUInt16LE(16, 34);
  silentWav.write("data", 36, "ascii");
  silentWav.writeUInt32LE(3200, 40);
  const silentTurn = await request("/api/assistant/voice-turn", { audioBase64: silentWav.toString("base64"), tts: false });
  assert.equal(silentTurn.status, 200);
  assert.equal(silentTurn.body.noSpeech, true);

  srv.overviewService.assistant.llm = new AssistantLLM({
    dataDir,
    config: { enabled: true },
    completeImpl: async (input) => {
      const p = JSON.parse(input.prompt);
      if (p.pendingProposal && /好/.test(p.question) && p.speechTiming?.overlapDurationMs > 0) {
        return JSON.stringify({
          spokenReply: "刚才我在播报，请再确认一次是否要钉成工单。",
          reply: "请再确认一次是否要钉成工单。",
          intent: "chat",
          action: {},
          proposalAction: "",
        });
      }
      return JSON.stringify({
        spokenReply: "先帮你把这个会话钉成工单。",
        reply: "我先把这个会话钉成工单，便于持续跟踪。",
        intent: "pin_ticket",
        action: { threadId: originalId, title: "导出跟进", goal: "完成示例商城导出" },
      });
    },
  });
  const voiceAsk = await request("/api/assistant/voice-turn", { transcriptText: "把这个钉成工单", autoExecute: false, tts: false, sessionId: "http-phone" });
  assert.equal(voiceAsk.status, 200);
  assert.equal(voiceAsk.body.noSpeech, false);
  assert.equal(voiceAsk.body.answer.proposal?.intent, "pin_ticket");
  assert.equal(voiceAsk.body.answer.proposal?.risk, "toggle");
  assert.equal(voiceAsk.body.answer.proposal?.payload, undefined, "不得向客户端泄漏内部 payload");

  const voiceCancel = await request("/api/assistant/voice-turn", { transcriptText: "算了", proposalId: voiceAsk.body.answer.proposal.id, tts: false, sessionId: "http-phone" });
  assert.equal(voiceCancel.status, 200);
  assert.equal(voiceCancel.body.answer.clearedProposal, true);
  assert.equal((await request("/api/assistant/tickets")).body.tickets.length, 0);

  // Replaying an already-canceled proposalId must never execute.
  const voiceReplayCanceled = await request("/api/assistant/voice-turn", { transcriptText: "确认", proposalId: voiceAsk.body.answer.proposal.id, tts: false, sessionId: "http-phone" });
  assert.equal(voiceReplayCanceled.status, 200);
  assert.equal(voiceReplayCanceled.body.answer.executedAction, undefined);
  assert.equal((await request("/api/assistant/tickets")).body.tickets.length, 0);

  // Create a fresh proposal: overlap speech must NOT trigger fast regex confirm; "没问题" must execute once only.
  const voiceAsk2 = await request("/api/assistant/voice-turn", { transcriptText: "再帮我钉成工单", autoExecute: false, tts: false, sessionId: "http-phone" });
  assert.ok(voiceAsk2.body.answer.proposal?.id);

  const overlapEcho = await request("/api/assistant/voice-turn", {
    transcriptText: "好",
    proposalId: voiceAsk2.body.answer.proposal.id,
    overlapDurationMs: 420,
    overlapBotText: "先帮你把这个会话钉成工单。",
    tts: false,
    sessionId: "http-phone",
  });
  assert.equal(overlapEcho.status, 200);
  assert.equal(overlapEcho.body.answer.executedAction, undefined);
  assert.equal((await request("/api/assistant/tickets")).body.tickets.length, 0);

  const voiceConfirm = await request("/api/assistant/voice-turn", { transcriptText: "没问题", proposalId: voiceAsk2.body.answer.proposal.id, tts: false, sessionId: "http-phone" });
  assert.equal(voiceConfirm.status, 200);
  assert.equal(voiceConfirm.body.answer.executedAction?.ok, true);
  assert.equal((await request("/api/assistant/tickets")).body.tickets.length, 1);

  const voiceReplayConsumed = await request("/api/assistant/voice-turn", { transcriptText: "对", proposalId: voiceAsk2.body.answer.proposal.id, tts: false, sessionId: "http-phone" });
  assert.equal(voiceReplayConsumed.status, 200);
  assert.equal(voiceReplayConsumed.body.answer.executedAction, undefined);
  assert.equal((await request("/api/assistant/tickets")).body.tickets.length, 1);

  const actionBad = await request("/api/assistant/action", { intent: "approve_request", requestId: "missing", decision: "accept" });
  assert.equal(actionBad.status, 404);
  const actionExpired = await request("/api/assistant/action", { proposalId: voiceAsk2.body.answer.proposal.id });
  assert.equal(actionExpired.status, 410);

  // Streaming NDJSON voice-turn with onDelta early spokenReply prefetch + notices delivery & warm pop.
  const synthCalls = [];
  srv.overviewService.voiceService.synthesizeSpeech = async ({ text }) => {
    synthCalls.push(text);
    return {
      audioBase64: Buffer.from("mock-mp3").toString("base64"),
      mimeType: "audio/mp3",
      provider: "mock-tts",
      text,
      expectedMs: 300,
    };
  };
  srv.overviewService.voiceService.warmAssistantCall = async () => ({
    ok: true,
    asrAvailable: false,
    ttsEngine: "mock-tts",
    options: [],
    resolved: null,
  });

  const openTicketId = (await request("/api/assistant/tickets")).body.tickets[0].id;
  assert.ok(openTicketId);
  await assistant.handleHubEvent("turn_completed", { threadId: originalId, turnId: "t-done-1", status: "completed" });

  let deltaSawEarlyTts = false;
  srv.overviewService.assistant.llm = new AssistantLLM({
    dataDir,
    config: { enabled: true },
    completeImpl: async (input) => {
      const part1 = '{"spokenReply":"第一句先汇报结论。第二句说明后续安排。",';
      const part2 = '"reply":"第一句先汇报结论。第二句说明后续安排。","intent":"chat","action":{}}';
      input.onDelta?.(part1, part1);
      deltaSawEarlyTts = synthCalls.length >= 2;
      input.onDelta?.(part2, part1 + part2);
      return part1 + part2;
    },
  });
  const ndjsonRes = await fetch(`${srv.url}/api/assistant/voice-turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ transcriptText: "简单汇报一下", tts: true, sessionId: "http-phone-stream" }),
  });
  assert.equal(ndjsonRes.status, 200);
  assert.match(ndjsonRes.headers.get("content-type"), /application\/x-ndjson/);
  const streamEvents = (await ndjsonRes.text()).trim().split("\n").map(JSON.parse);
  assert.equal(deltaSawEarlyTts, true, "spokenReply 一写完应在 LLM 结束前立即启动预合成 TTS");
  assert.equal(streamEvents[0].type, "heard");
  assert.equal(streamEvents[1].type, "answer");
  assert.equal(streamEvents[1].answer.notices?.length, 1);
  assert.match(streamEvents[1].answer.spokenReply, /顺便说一下/);
  const ttsChunks = streamEvents.filter((e) => e.type === "tts_chunk");
  assert.equal(ttsChunks.length, 3);
  assert.equal(ttsChunks[0].text, "第一句先汇报结论。");
  assert.equal(ttsChunks[1].text, "第二句说明后续安排。");
  assert.match(ttsChunks[2].text, /顺便说一下/);
  assert.equal(streamEvents.at(-1).type, "done");

  // Pure streaming prefetch hit (no pending notices altering spokenText) records prefetchedTtsHit: true in phone archive.
  const synthCountBeforeHit = synthCalls.length;
  const ndjsonHitRes = await fetch(`${srv.url}/api/assistant/voice-turn`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
    body: JSON.stringify({ transcriptText: "再汇报一次", tts: true, callId: "call-prefetch-hit", sessionId: "http-phone-stream" }),
  });
  assert.equal(ndjsonHitRes.status, 200);
  await ndjsonHitRes.text();
  assert.equal(synthCalls.length - synthCountBeforeHit, 2, "命中预合成后不应重复合成相同片段");
  await new Promise((r) => setTimeout(r, 40));
  const phoneArchiveLines = (await readFile(resolve(dataDir, "logs", "sprite-phone.jsonl"), "utf8"))
    .trim().split("\n").map((l) => JSON.parse(l));
  const hitLog = phoneArchiveLines.find((e) => e.callId === "call-prefetch-hit" && e.event === "tts_done");
  assert.equal(hitLog?.prefetchedTtsHit, true);
  assert.equal(typeof hitLog?.spokenReadyMs, "number");

  // Warm endpoint pops up to 2 pending notices, and notices/ack marks unread notices seen.
  await assistant.handleHubEvent("turn_completed", { threadId: originalId, turnId: "t-done-2", status: "completed" });
  await assistant.handleHubEvent("turn_completed", { threadId: originalId, turnId: "t-done-3", status: "failed" });
  const warmRes = await request("/api/assistant/call/warm", {});
  assert.equal(warmRes.status, 200);
  assert.equal(warmRes.body.notices?.length, 2);
  const unreadBefore = await request("/api/assistant/notices");
  assert.ok(unreadBefore.body.unreadCount >= 2);
  const ackRes = await request("/api/assistant/notices/ack", { ids: unreadBefore.body.notices.map((n) => n.id) });
  assert.equal(ackRes.body.ok, true);
  assert.equal((await request("/api/assistant/notices")).body.unreadCount, 0);
});
