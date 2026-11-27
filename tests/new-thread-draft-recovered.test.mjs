import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { ensurePreferredModelInList, pickDefaultModelForProvider, resolveAntigravityModelSelection, resolveModelsForProvider } from "../public/instance-switcher.js";
import { resolveComposerSubmission, extractGoalDirective } from "../public/composer-mode.js";

const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
function fn(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
function harness(names) {
  const store = new Map();
  const elements = new Map();
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, { value: "", hidden: false, disabled: false, dataset: {}, focus() {} });
    return elements.get(id);
  };
  const ctx = vm.createContext({
    console, URL, Date, clearTimeout,
    state: { activeThreadId: "", activeThread: null, newThreadCwd: null, newThreadTaskDraft: null, boardOpen: true, images: [], defaultPermissionMode: "turbo", threads: [], modelsByProvider: {}, allModels: [], dictation: { active: false, pointerDown: false }, chatTts: { enabled: false } },
    $: el,
    localStorage: { getItem: (key) => store.get(key) || null, setItem: (key, value) => store.set(key, value) },
    defaultProviderValue: () => "codex", defaultProfileForProvider: () => "default",
    getLocalThreadPrefs: () => null,
    resolveModelsForProvider, ensurePreferredModelInList, pickDefaultModelForProvider, resolveAntigravityModelSelection,
    escapeHtml: (s) => s,
    renderModelOptionsHtml: () => "",
    resolveComposerSubmission, extractGoalDirective,
    normalizeUiPermissionMode: (s) => s, saveDefaultPermissionMode: (s) => s,
    activeEditingQueueItem: () => null, isActiveThreadRunning: () => false,
    history: { replaceState() {} }, location: { href: "http://localhost/?thread=old" },
  });
  for (const name of ["syncCfgFieldVisibility", "renderComposerConfigChip", "syncAllCustomSelects", "setTopbarMenuOpen", "setComposerConfigOpen", "renderComposerImages", "renderTopbarAndControls", "setSidebarOpen", "syncComposerProfileSelect", "closeCustomSelectMenu", "clearComposerStatus", "closeSlashCommandMenu", "syncProfileSelectors", "renderThreadList", "renderAgentTelemetryBar", "renderActiveMessages", "renderPendingRequests", "renderQueuedTurns", "setComposerStatus", "renderComposerControls", "refreshThreads", "saveLocalThreadPrefs", "stopChatReplySpeech", "exitSpriteOverlayForNavigation", "unlockChatReplySpeechAudio", "stopComposerDictation", "refreshTasks"]) ctx[name] = () => {};
  vm.runInContext(`const NEW_THREAD_PREFS_KEY = "test.newThreadPrefs"; let activeThreadReloadTimer = null; let lastActiveThreadReloadDoneAt = 0;\n${names.map(fn).join("\n")}`, ctx);
  return { ctx, el, store };
}
const preferenceFunctions = ["getNewThreadPrefs", "saveNewThreadPrefs", "currentComposerProvider", "normalizeEffortOptionValue", "syncModelAndEffortSelectors", "syncEffortSelectForModel"];

test("blank draft restores independent model/effort for each Agent and leaves existing thread preferences intact", () => {
  const { ctx, el } = harness(preferenceFunctions);
  ctx.state.modelsByProvider = {
    codex: [{ id: "sol", provider: "codex", supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" }],
    antigravity: [{ id: "gemini-4-hydrogen", provider: "antigravity", supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" }],
  };
  ctx.saveNewThreadPrefs("codex", { model: "sol", effort: "high" });
  ctx.saveNewThreadPrefs("antigravity", { model: "gemini-4-hydrogen", effort: "low" });
  for (const [provider, model, effort] of [["codex", "sol", "high"], ["antigravity", "gemini-4-hydrogen", "low"], ["codex", "sol", "high"]]) {
    el("composerProviderSelect").value = provider;
    ctx.state.userPickedDraftModel = false;
    ctx.syncModelAndEffortSelectors();
    assert.equal(el("modelSelect").value, model);
    assert.equal(el("effortSelect").value, effort);
  }
  // Re-enter after a page reload: preferences are read from storage, not prior DOM values.
  el("modelSelect").value = "";
  el("effortSelect").value = "";
  ctx.syncModelAndEffortSelectors();
  assert.equal(el("effortSelect").value, "high");
  ctx.state.activeThreadId = "codex:default:existing";
  ctx.state.activeThread = { provider: "codex", model: "sol", reasoningEffort: "low" };
  ctx.syncModelAndEffortSelectors();
  assert.equal(el("effortSelect").value, "low");
  assert.equal(ctx.getNewThreadPrefs("codex").effort, "high");
});

test("project new opens an empty composer without creating a backend thread", async () => {
  const { ctx, el } = harness([...preferenceFunctions, "selectThread", "openNewThreadModal", "isBoardViewActive"]);
  ctx.state.activeThreadId = "old";
  ctx.state.activeThread = { provider: "codex", cwd: "/old" };
  ctx.state.images = [{ name: "old.jpg" }];
  ctx.state.composerGoal = true;
  el("promptInput").value = "previous message";
  await ctx.openNewThreadModal({ cwd: "/project with spaces/客户问题", provider: "antigravity" });
  assert.equal(ctx.state.activeThreadId, "");
  assert.equal(ctx.state.activeThread, null);
  assert.equal(ctx.state.newThreadCwd, "/project with spaces/客户问题");
  assert.equal(ctx.isBoardViewActive(), false);
  assert.equal(el("composerProviderSelect").value, "antigravity");
  assert.equal(el("promptInput").value, "");
  assert.equal(ctx.state.images.length, 0);
  assert.equal(ctx.state.composerGoal, false);
  await ctx.selectThread("");
  assert.equal(ctx.state.newThreadCwd, null);
  assert.equal(ctx.isBoardViewActive(), true);
});

test("first send creates thread in the draft project with bottom model and effort", async () => {
  const { ctx, el } = harness(["getNewThreadPrefs", "saveNewThreadPrefs", "currentComposerProvider", "currentComposerProfileId", "handleSend"]);
  const requests = [];
  ctx.apiPost = async (path, payload) => { requests.push({ path, payload }); return {}; };
  ctx.state.newThreadCwd = "/客户问题";
  ctx.state.boardOpen = false;
  el("composerProviderSelect").value = "codex";
  el("composerProfileSelect").value = "work";
  el("modelSelect").value = "gpt-6.1-sol";
  el("effortSelect").value = "high";
  el("permissionSelect").value = "turbo";
  el("promptInput").value = "检查离线问题";
  await ctx.handleSend();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "api/thread/new");
  assert.equal(requests[0].payload.cwd, "/客户问题");
  assert.equal(requests[0].payload.profileId, "work");
  assert.equal(requests[0].payload.model, "gpt-6.1-sol");
  assert.equal(requests[0].payload.effort, "high");
  assert.equal(ctx.getNewThreadPrefs("codex").effort, "high");
});

test("bottom selection changes persist only for new drafts and restore on Agent switch", () => {
  const { ctx, el } = harness(preferenceFunctions);
  const handlers = new Map();
  for (const id of ["modelSelect", "effortSelect", "composerProviderSelect"]) {
    el(id).addEventListener = (event, handler) => handlers.set(id, handler);
  }
  ctx.state.modelsByProvider = {
    codex: [{ id: "sol", provider: "codex", supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" }],
    antigravity: [{ id: "gemini-4-hydrogen", provider: "antigravity", supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" }],
  };
  const modelStart = source.indexOf('  $("modelSelect").addEventListener("change",');
  const modelEnd = source.indexOf('  $("permissionSelect").addEventListener("change",', modelStart);
  vm.runInContext(source.slice(modelStart, modelEnd), ctx);
  const providerStart = source.indexOf('  $("composerProviderSelect").addEventListener("change",');
  const providerEnd = source.indexOf('  $("composerProfileSelect").addEventListener("change",', providerStart);
  vm.runInContext(source.slice(providerStart, providerEnd), ctx);
  el("composerProviderSelect").value = "codex";
  el("modelSelect").value = "sol";
  handlers.get("modelSelect")();
  el("effortSelect").value = "high";
  handlers.get("effortSelect")();
  el("composerProviderSelect").value = "antigravity";
  handlers.get("composerProviderSelect")();
  el("effortSelect").value = "low";
  handlers.get("effortSelect")();
  el("composerProviderSelect").value = "codex";
  handlers.get("composerProviderSelect")();
  assert.equal(el("modelSelect").value, "sol");
  assert.equal(el("effortSelect").value, "high");
  assert.equal(ctx.getNewThreadPrefs("antigravity").effort, "low");
});
