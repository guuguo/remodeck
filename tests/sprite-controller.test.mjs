import test from "node:test";
import assert from "node:assert/strict";
import { createInitialSpriteState, createSpriteController } from "../public/sprite-controller.js";
import { renderSpritePhoneCallHtml } from "../public/sprite-assistant.js";

function createTestHarness({
  fetchImpl = null,
  elements = {},
  doc = null,
  ttsCalls = null,
  toasts = null,
  boardOpen = false,
  boardViewMode = "tycoon3d",
  sharedAudioCtx = null,
  mediaDevices = null,
  AudioContextCtor = null,
  warmResponse = null,
} = {}) {
  const state = {
    boardOpen,
    boardViewMode,
    scopedProjectCwd: "",
    missionOverview: { domains: [] },
    missionOverviewLoading: false,
    threads: [],
    tasks: [],
    dispatchAgentKey: "auto",
    dispatchModel: "",
    dispatchInheritContext: true,
    recentCompletedByThread: new Map(),
    voice: { audioCtx: sharedAudioCtx },
    sprite: createInitialSpriteState(),
  };
  const phoneLogs = [];
  const defaultFetch = async (url, opts = {}) => {
    const u = String(url || "");
    if (u.includes("api/assistant/phone-log")) {
      try {
        phoneLogs.push(JSON.parse(opts.body || "{}"));
      } catch {}
      return Response.json({ ok: true });
    }
    if (u.includes("api/assistant/call/warm")) {
      return Response.json(warmResponse || { ok: true, options: [] });
    }
    if (fetchImpl) {
      return fetchImpl(url, opts);
    }
    return Response.json({ ok: true });
  };
  const getEl = (id) => elements[id] || null;
  const controller = createSpriteController({
    state,
    getEl,
    doc: doc || { activeElement: null, hidden: false, getElementById: getEl, querySelectorAll: () => [] },
    fetchImpl: defaultFetch,
    deps: {
      isBoardViewActive: () => Boolean(state.boardOpen),
      isOverviewBoardMode: (m = state.boardViewMode) => m !== "folders",
      showToastBanner: (message, opts = {}) => {
        toasts?.push({ message, ...opts });
      },
      buildDispatchAgentContext: () => ({ agentOptions: [] }),
      findOverviewTopicById: (id) => state.missionOverview?.domains?.flatMap((d) => d.topics || []).find((t) => t.id === id) || null,
      loadMissionOverview: async () => {},
      refreshThreads: async () => {},
      fetchVoiceTtsAudio: async (opts) => {
        ttsCalls?.push(opts);
        return null;
      },
      mediaDevices,
      AudioContextCtor,
    },
  });
  return { state, controller, phoneLogs };
}

function createMockAudioNode(kind) {
  const node = {
    kind,
    connectedTo: [],
    disconnected: false,
    connect(target) {
      node.connectedTo.push(target);
      return target;
    },
    disconnect() {
      node.disconnected = true;
    },
  };
  if (kind === "filter") {
    node.type = "";
    node.frequency = { value: 0 };
    node.Q = { value: 0 };
  } else if (kind === "gain") {
    node.gain = { value: 1 };
  } else if (kind === "processor") {
    node.onaudioprocess = null;
  }
  return node;
}

function createMockAudioCtx({ state = "running", sampleRate = 48000, resumeImpl = null } = {}) {
  const nodes = { source: [], filters: [], processors: [], gains: [] };
  const ctx = {
    state,
    sampleRate,
    destination: { kind: "destination" },
    closeCalls: 0,
    resumeCalls: 0,
    resume() {
      ctx.resumeCalls += 1;
      if (resumeImpl) return resumeImpl(ctx);
      ctx.state = "running";
      return Promise.resolve();
    },
    createMediaStreamSource() {
      const n = createMockAudioNode("source");
      nodes.source.push(n);
      return n;
    },
    createBiquadFilter() {
      const n = createMockAudioNode("filter");
      nodes.filters.push(n);
      return n;
    },
    createScriptProcessor() {
      const n = createMockAudioNode("processor");
      nodes.processors.push(n);
      return n;
    },
    createGain() {
      const n = createMockAudioNode("gain");
      nodes.gains.push(n);
      return n;
    },
    close() {
      ctx.closeCalls += 1;
      ctx.state = "closed";
      return Promise.resolve();
    },
    _nodes: nodes,
  };
  return ctx;
}

function createMockMediaStream(label = "Built-in Mic") {
  const track = {
    label,
    muted: false,
    readyState: "live",
    stopped: false,
    onended: null,
    onmute: null,
    onunmute: null,
    stop() {
      track.stopped = true;
      track.readyState = "ended";
    },
  };
  return {
    track,
    stream: {
      getTracks: () => [track],
      getAudioTracks: () => [track],
    },
  };
}

function ndjsonResponse(events) {
  const raw = `${events.map((e) => JSON.stringify(e)).join("\n")}\n`;
  const bytes = new TextEncoder().encode(raw);
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.slice(0, Math.floor(bytes.length / 2)));
      controller.enqueue(bytes.slice(Math.floor(bytes.length / 2)));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "application/x-ndjson; charset=utf-8" },
  });
}

test("SpriteController runs full NDJSON phone turn through single phase state machine", async () => {
  const { state, controller, phoneLogs } = createTestHarness({
    fetchImpl: async (url) => {
      assert.match(String(url), /api\/assistant\/voice-turn/);
      return ndjsonResponse([
        { type: "ping" },
        { type: "heard", heardText: "看看状态" },
        { type: "answer", heardText: "看看状态", answer: { text: "一切正常。", spokenReply: "一切正常。", mood: "good" } },
        { type: "tts_chunk", index: 0, total: 1, tts: { audioBase64: Buffer.from("mp3").toString("base64"), mimeType: "audio/mp3", provider: "edge-tts" } },
        { type: "done" },
      ]);
    },
  });

  await controller.enterSpritePhoneCall();
  assert.equal(state.sprite.phoneCallActive, true);
  assert.equal(state.sprite.phonePhase, "listening");

  await controller.sendSpritePhoneTurn({ transcriptText: "看看状态" });
  // Flush async TTS queue microtasks so speaking completes cleanly back to listening
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(state.sprite.phonePhase, "listening");
  assert.ok(state.sprite.messages.some((m) => m.role === "sprite" && m.text.includes("一切正常")));

  await controller.hangupSpritePhoneCall();
  assert.equal(state.sprite.phoneCallActive, false);
  assert.equal(state.sprite.phonePhase, "idle");

  // Wait for fire-and-forget phone-log POSTs
  await new Promise((r) => setTimeout(r, 20));
  const phases = phoneLogs
    .filter((e) => e.event === "state_change")
    .map((e) => `${e.fromPhase}->${e.toPhase}`);
  assert.deepEqual(phases, ["listening->thinking", "thinking->speaking", "speaking->listening"]);
  assert.equal(phoneLogs.find((e) => e.event === "call_start")?.toPhase, "listening");
  assert.equal(phoneLogs.find((e) => e.event === "call_end")?.fromPhase, "listening");
});

test("SpriteController never speaks raw JS/HTTP error via TTS when a phone turn fails", async () => {
  const ttsCalls = [];
  const { state, controller, phoneLogs } = createTestHarness({
    ttsCalls,
    fetchImpl: async () => new Response("server crash", { status: 500 }),
  });

  await controller.enterSpritePhoneCall();
  state.sprite.messages = [];
  await controller.sendSpritePhoneTurn({ transcriptText: "查一下进度" });
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(state.sprite.phonePhase, "listening");
  assert.equal(ttsCalls.length, 0);
  const errMsg = state.sprite.messages.find((m) => m.role === "sprite" && m.tone === "worry");
  assert.ok(errMsg);
  assert.match(errMsg.text, /语音通话请求失败/);
  assert.ok(phoneLogs.some((e) => e.event === "turn_error" && e.fromPhase === "thinking" && e.toPhase === "listening"));

  await controller.hangupSpritePhoneCall();
});

test("SpriteController aborts in-flight fetch on hangup and drops stale replies", async () => {
  let fetchSignal = null;
  let markFetchStarted = null;
  const fetchStarted = new Promise((r) => { markFetchStarted = r; });

  const { state, controller, phoneLogs } = createTestHarness({
    fetchImpl: (_url, opts) => new Promise((_resolve, reject) => {
      fetchSignal = opts.signal;
      markFetchStarted();
      opts.signal.addEventListener("abort", () => {
        const err = new Error("Aborted");
        err.name = "AbortError";
        reject(err);
      });
    }),
  });

  await controller.enterSpritePhoneCall();
  state.sprite.messages = [];
  const turnPromise = controller.sendSpritePhoneTurn({ transcriptText: "等很久的请求" });
  await fetchStarted;
  assert.equal(state.sprite.phonePhase, "thinking");

  await controller.hangupSpritePhoneCall();
  await turnPromise;
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(fetchSignal?.aborted, true);
  assert.equal(state.sprite.phoneCallActive, false);
  assert.equal(state.sprite.phonePhase, "idle");
  // No error toast/message pushed on user-initiated hangup
  assert.equal(state.sprite.messages.filter((m) => m.role === "sprite").length, 0);
  assert.equal(phoneLogs.find((e) => e.event === "call_end")?.fromPhase, "thinking");
});

test("SpriteController shields active phone call from background overview polling notifications", async () => {
  const ttsCalls = [];
  const { state, controller } = createTestHarness({
    boardOpen: true,
    boardViewMode: "tycoon3d",
    ttsCalls,
  });

  const ov1 = {
    radar: { liveThreads: [{ id: "t1", title: "工位A" }], pendingThreads: [], harvestReadyCount: 0 },
    domains: [{ id: "d1", topics: [{ id: "tp1", name: "示例商城", pipeline: { readyToHarvest: false }, activeThreads: [{ id: "t1", title: "工位A", live: true }] }] }],
  };
  const ov2 = {
    radar: { liveThreads: [], pendingThreads: [], harvestReadyCount: 1 },
    domains: [{ id: "d1", topics: [{ id: "tp1", name: "示例商城", pipeline: { readyToHarvest: true }, activeThreads: [{ id: "t1", title: "工位A", live: false }] }] }],
  };

  state.sprite.greetedSession = true;
  controller.syncSpriteWithOverview(ov1);

  await controller.enterSpritePhoneCall();
  state.sprite.messages = [];
  controller.syncSpriteWithOverview(ov2);
  assert.equal(state.sprite.messages.length, 0);
  assert.equal(ttsCalls.length, 0);

  await controller.hangupSpritePhoneCall();

  // After hangup, overview diffs notify normally in popover mode
  const ov3 = {
    radar: { liveThreads: [], pendingThreads: [{ id: "t2", title: "工位B", pendingCount: 1 }], harvestReadyCount: 1 },
    domains: [{ id: "d1", topics: [{ id: "tp1", name: "示例商城", pipeline: { readyToHarvest: true }, activeThreads: [{ id: "t2", title: "工位B", pendingCount: 1 }] }] }],
  };
  controller.syncSpriteWithOverview(ov3);
  assert.equal(state.sprite.messages.length, 1);
  assert.match(state.sprite.messages[0].text, /工位B/);
});

test("SpriteController renders fullscreen mount safely and rolls back on DOM render exception", () => {
  let failSet = false;
  let storedHtml = "";
  const fsMount = {
    hidden: true,
    _acLastHtml: "",
    querySelectorAll: () => [],
    get innerHTML() {
      return storedHtml;
    },
    set innerHTML(val) {
      if (failSet) throw new Error("Simulated DOM failure");
      storedHtml = String(val ?? "");
    },
  };
  const toasts = [];
  const { state, controller } = createTestHarness({
    elements: { spriteFullscreenMount: fsMount },
    toasts,
  });

  controller.enterSpriteFullscreen();
  assert.equal(state.sprite.viewMode, "fullscreen");
  assert.equal(fsMount.hidden, false);
  assert.match(fsMount.innerHTML, /class="sprite-fs-shell"/);

  // Simulate render exception: must roll back cleanly and notify without leaving a blank overlay
  failSet = true;
  state.sprite.messages.push({ id: "x1", role: "sprite", text: "触发重绘" });
  controller.renderSpriteAssistantMount();
  assert.equal(state.sprite.viewMode, "popover");
  assert.equal(fsMount.hidden, true);
  assert.ok(toasts.some((t) => t.error && t.message.includes("自动退回")));
});

test("SpriteController reuses shared audioCtx, feeds VAD to voice-turn, and leaves shared ctx open on hangup", async () => {
  const sharedCtx = createMockAudioCtx({ state: "running", sampleRate: 48000 });
  const { stream, track } = createMockMediaStream("Studio Mic");
  const voiceTurnBodies = [];

  const { state, controller, phoneLogs } = createTestHarness({
    sharedAudioCtx: sharedCtx,
    mediaDevices: {
      async getUserMedia() {
        return stream;
      },
    },
    fetchImpl: async (url, opts = {}) => {
      if (String(url).includes("api/assistant/voice-turn")) {
        voiceTurnBodies.push(JSON.parse(opts.body || "{}"));
        return ndjsonResponse([
          { type: "heard", heardText: "测试麦克风" },
          { type: "answer", heardText: "测试麦克风", answer: { text: "听到了。", spokenReply: "听到了。", mood: "good" } },
          { type: "done" },
        ]);
      }
      return Response.json({ ok: true });
    },
  });

  await controller.enterSpritePhoneCall();
  assert.equal(state.sprite.recording, true);
  assert.equal(state.sprite.micStatus, "ready");
  assert.equal(state.sprite.mic.ownsAudioCtx, false);
  assert.equal(state.sprite.mic.filterNodes.length, 2);
  assert.ok(state.sprite.mic.silentGain);
  assert.equal(state.sprite.mic.silentGain.gain.value, 0);

  await new Promise((r) => setTimeout(r, 10));
  const micReady = phoneLogs.find((e) => e.event === "mic_ready");
  assert.equal(micReady?.detail?.reusedCtx, true);
  assert.equal(micReady?.detail?.sampleRate, 48000);
  assert.equal(micReady?.detail?.trackLabel, "Studio Mic");

  const proc = state.sprite.mic.processor;
  assert.equal(typeof proc.onaudioprocess, "function");
  const speechFrame = new Float32Array(2048).fill(0.08);
  const silenceFrame = new Float32Array(2048).fill(0);
  for (let i = 0; i < 8; i += 1) {
    proc.onaudioprocess({ inputBuffer: { getChannelData: () => speechFrame } });
  }
  for (let i = 0; i < 30; i += 1) {
    proc.onaudioprocess({ inputBuffer: { getChannelData: () => silenceFrame } });
  }
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(voiceTurnBodies.length, 1);
  assert.ok(String(voiceTurnBodies[0].audioBase64 || "").length > 100);

  await controller.hangupSpritePhoneCall();
  assert.equal(track.stopped, true);
  assert.equal(proc.disconnected, true);
  assert.equal(sharedCtx._nodes.filters.every((n) => n.disconnected), true);
  assert.equal(sharedCtx._nodes.gains[0].disconnected, true);
  assert.equal(sharedCtx._nodes.source[0].disconnected, true);
  assert.equal(sharedCtx.closeCalls, 0);
  assert.equal(state.sprite.micStatus, "idle");
});

test("SpriteController never hangs when AudioContext.resume stalls in suspended state", async () => {
  const stalledCtx = createMockAudioCtx({
    state: "suspended",
    sampleRate: 48000,
    resumeImpl: () => new Promise(() => {}),
  });
  const { stream } = createMockMediaStream("Desktop Mic");
  const { state, controller, phoneLogs } = createTestHarness({
    sharedAudioCtx: stalledCtx,
    mediaDevices: {
      async getUserMedia() {
        return stream;
      },
    },
  });

  const startedAt = Date.now();
  await controller.enterSpritePhoneCall();
  const elapsed = Date.now() - startedAt;

  assert.ok(elapsed < 1500, `Expected bounded resume under 1.5s, got ${elapsed}ms`);
  assert.equal(state.sprite.recording, true);
  assert.equal(state.sprite.micStatus, "ready");
  assert.ok(state.sprite.mic.processor);

  await new Promise((r) => setTimeout(r, 10));
  const micReady = phoneLogs.find((e) => e.event === "mic_ready");
  assert.equal(micReady?.detail?.ctxState, "suspended");

  await controller.hangupSpritePhoneCall();
});

test("SpriteController surfaces mic errors honestly in phone UI and retries capture on orb tap", async () => {
  const { stream } = createMockMediaStream("Retry Mic");
  let allowMic = false;
  let fetchCalledForBrief = 0;

  const { state, controller, phoneLogs } = createTestHarness({
    AudioContextCtor: function MockAudioCtx() {
      return createMockAudioCtx({ state: "running", sampleRate: 48000 });
    },
    mediaDevices: {
      async getUserMedia() {
        if (!allowMic) {
          const err = new Error("Permission denied by user");
          err.name = "NotAllowedError";
          throw err;
        }
        return stream;
      },
    },
    fetchImpl: async (url) => {
      if (String(url).includes("api/assistant/voice-turn")) {
        fetchCalledForBrief += 1;
      }
      return Response.json({ ok: true });
    },
  });

  await controller.enterSpritePhoneCall();
  assert.equal(state.sprite.recording, false);
  assert.equal(state.sprite.micStatus, "error");
  assert.match(renderSpritePhoneCallHtml(state.sprite), /麦克风未就绪/);
  assert.doesNotMatch(renderSpritePhoneCallHtml(state.sprite), /随时开口说话/);

  await new Promise((r) => setTimeout(r, 10));
  assert.ok(phoneLogs.some((e) => e.event === "mic_error" && e.detail?.name === "NotAllowedError"));

  // Allow mic and click the phone orb to re-arm capture rather than firing canned briefing text
  allowMic = true;
  const orbBtn = {
    dataset: { spriteAction: "phone-orb" },
    closest(sel) {
      return sel === "[data-sprite-action]" ? orbBtn : null;
    },
  };
  controller.handleSpriteDelegatedClick({ target: orbBtn, stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(fetchCalledForBrief, 0);
  assert.equal(state.sprite.recording, true);
  assert.equal(state.sprite.micStatus, "ready");
  assert.match(renderSpritePhoneCallHtml(state.sprite), /随时开口说话/);

  await controller.hangupSpritePhoneCall();
});

test("SpriteController sends proposalId only, cancels server-side proposal, and greets with warm notices safely", async () => {
  const voiceBodies = [];
  const actionBodies = [];
  const ttsCalls = [];
  let turnSeq = 0;

  const { state, controller } = createTestHarness({
    ttsCalls,
    warmResponse: {
      ok: true,
      options: [],
      notices: [{ id: "n1", kind: "completed", title: "导出工位", text: "「导出工位」已经跑完了，可以验收", threadId: "codex:default:t-1" }],
    },
    fetchImpl: async (url, opts = {}) => {
      const u = String(url || "");
      const body = opts.body ? JSON.parse(opts.body) : {};
      if (u.includes("api/assistant/action")) {
        actionBodies.push(body);
        return Response.json({ ok: true, canceled: true, clearedProposal: true });
      }
      if (u.includes("api/assistant/voice-turn")) {
        voiceBodies.push(body);
        turnSeq += 1;
        if (turnSeq === 1) {
          return ndjsonResponse([
            { type: "heard", heardText: "派个活" },
            {
              type: "answer",
              heardText: "派个活",
              answer: {
                text: "准备派给示例商城，确认发吗？",
                spokenReply: "准备派给示例商城，确认发吗？",
                proposal: { id: "act_prop_1", intent: "dispatch", risk: "confirm", summary: "准备派给示例商城，确认发吗？", routes: [{ topicName: "示例商城", agentLabel: "Codex" }] },
              },
            },
            { type: "done" },
          ]);
        }
        return ndjsonResponse([
          { type: "heard", heardText: "算了" },
          { type: "answer", heardText: "算了", answer: { text: "好的，已取消。", spokenReply: "好的，已取消。", clearedProposal: true } },
          { type: "done" },
        ]);
      }
      return Response.json({ ok: true });
    },
  });

  await controller.enterSpritePhoneCall();
  await new Promise((r) => setTimeout(r, 25));
  assert.ok(state.sprite.messages.some((m) => /接通了，先同步一下/.test(m.text)));
  assert.ok(ttsCalls.some((c) => /导出工位/.test(c.text)));

  await controller.sendSpritePhoneTurn({ transcriptText: "派个活" });
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(state.sprite.pendingProposal?.id, "act_prop_1");

  await controller.sendSpritePhoneTurn({ transcriptText: "稍微等一下" });
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(voiceBodies[1].proposalId, "act_prop_1");
  assert.equal(voiceBodies[1].pendingProposal, undefined);
  assert.equal(state.sprite.pendingProposal, null);

  // Clicking cancel-proposal notifies server with { proposalId, cancel: true }.
  state.sprite.pendingProposal = { id: "act_prop_2", summary: "待取消" };
  const cancelBtn = {
    dataset: { spriteAction: "cancel-proposal" },
    closest(sel) { return sel === "[data-sprite-action]" ? cancelBtn : null; },
  };
  controller.handleSpriteDelegatedClick({ target: cancelBtn, stopPropagation() {} });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(state.sprite.pendingProposal, null);
  assert.deepEqual(actionBodies.at(-1), { proposalId: "act_prop_2", cancel: true });

  await controller.hangupSpritePhoneCall();
});

test("SpriteController never plays warm notices when user is already speaking", async () => {
  const ttsCalls = [];
  const { state, controller } = createTestHarness({
    ttsCalls,
    warmResponse: {
      ok: true,
      options: [],
      notices: [{ id: "n2", kind: "completed", title: "工位X", text: "「工位X」已经跑完了，可以验收" }],
    },
  });
  state.sprite.speechActive = true;
  await controller.enterSpritePhoneCall();
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(ttsCalls.length, 0);
  await controller.hangupSpritePhoneCall();
});
