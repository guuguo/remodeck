import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
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
});
