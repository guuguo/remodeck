import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";
import { ensurePreferredModelInList, pickDefaultModelForProvider, resolveModelsForProvider, resolveAntigravityModelSelection } from "../public/instance-switcher.js";
import { resolveComposerSubmission, extractGoalDirective } from "../public/composer-mode.js";
const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
function fn(name) {
  const start = source.search(new RegExp(`^(?:async )?function ${name}\\(`, "m"));
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf("\n}", start) + 2);
}
function harness() {
  const storage = new Map(), elements = new Map(), requests = [];
  const el = (id) => {
    if (!elements.has(id)) elements.set(id, { value: "", hidden: false, disabled: false, dataset: {}, focus() {} });
    return elements.get(id);
  };
  const ctx = vm.createContext({
    console, URL, Date, clearTimeout,
    state: { activeThreadId: "", activeThread: null, newThreadCwd: null, newThreadTaskDraft: null, boardOpen: true, images: [], defaultPermissionMode: "turbo", threads: [], modelsByProvider: {}, allModels: [], dictation: { active: false, pointerDown: false }, chatTts: { enabled: false } },
    $: el,
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    defaultProviderValue: () => "codex", defaultNewThreadProvider: () => "codex", defaultProfileForProvider: () => "default",
    getLocalThreadPrefs: () => null,
    resolveModelsForProvider, ensurePreferredModelInList, pickDefaultModelForProvider, resolveAntigravityModelSelection,
    escapeHtml: (s) => s, renderModelOptionsHtml: () => "",
    resolveComposerSubmission, extractGoalDirective,
    normalizeUiPermissionMode: (s) => s, saveDefaultPermissionMode: (s) => s,
    activeEditingQueueItem: () => null, isActiveThreadRunning: () => false,
    history: { replaceState() {} }, location: { href: "http://localhost/?thread=old" },
    apiPost: async (path, payload) => { requests.push({ path, payload }); return {}; },
  });
  for (const name of ["syncCfgFieldVisibility", "renderComposerConfigChip", "syncAllCustomSelects", "setTopbarMenuOpen", "setComposerConfigOpen", "renderComposerImages", "renderTopbarAndControls", "setSidebarOpen", "syncComposerProfileSelect", "closeCustomSelectMenu", "closeSlashCommandMenu", "clearComposerStatus", "syncProfileSelectors", "renderThreadList", "renderAgentTelemetryBar", "renderActiveMessages", "renderPendingRequests", "renderQueuedTurns", "setComposerStatus", "renderComposerControls", "refreshThreads", "saveLocalThreadPrefs", "stopChatReplySpeech", "exitSpriteOverlayForNavigation", "unlockChatReplySpeechAudio", "stopComposerDictation", "refreshTasks"]) ctx[name] = () => {};
  const names = ["getNewThreadPrefs", "saveNewThreadPrefs", "currentComposerProvider", "currentComposerProfileId", "syncModelAndEffortSelectors", "syncEffortSelectForModel", "normalizeEffortOptionValue", "selectThread", "openNewThreadModal", "isBoardViewActive", "handleSend"];
  vm.runInContext(`const NEW_THREAD_PREFS_KEY = "test.newThreadPrefs"; let activeThreadReloadTimer = null; let lastActiveThreadReloadDoneAt = 0;\n${names.map(fn).join("\n")}`, ctx);
  ctx.state.modelsByProvider = {
    codex: [{ id: "sol", provider: "codex", supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" }],
    antigravity: [{ id: "gemini-4-hydrogen", provider: "antigravity", supportedReasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium" }],
  };
  return { ctx, el, requests };
}

test("project new opens an empty composer and first send preserves project after switching Agent", async () => {
  const { ctx, el, requests } = harness();
  ctx.state.activeThreadId = "old";
  ctx.state.activeThread = { provider: "codex", cwd: "/agent-control" };
  ctx.state.images = [{ name: "old.jpg" }];
  ctx.state.composerGoal = true;
  el("promptInput").value = "old prompt";
  await ctx.openNewThreadModal({ cwd: "/project with spaces/客户问题解决", provider: "codex" });
  assert.equal(requests.length, 0);
  assert.equal(ctx.state.activeThreadId, "");
  assert.equal(ctx.state.activeThread, null);
  assert.equal(ctx.isBoardViewActive(), false);
  assert.equal(el("promptInput").value, "");
  assert.equal(ctx.state.images.length, 0);
  assert.equal(ctx.state.composerGoal, false);
  el("composerProviderSelect").value = "antigravity";
  ctx.syncModelAndEffortSelectors();
  el("effortSelect").value = "high";
  el("composerProfileSelect").value = "desktop";
  el("promptInput").value = "检查客户问题";
  el("permissionSelect").value = "turbo";
  await ctx.handleSend();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, "api/thread/new");
  assert.equal(requests[0].payload.cwd, "/project with spaces/客户问题解决");
  assert.equal(requests[0].payload.provider, "antigravity");
  assert.equal(requests[0].payload.model, "gemini-4-hydrogen");
  assert.equal(requests[0].payload.effort, "high");
  await ctx.selectThread("");
  assert.equal(ctx.state.newThreadCwd, null);
  assert.equal(ctx.isBoardViewActive(), true);
});

test("all new entry points use the blank flow, including without a project, and never show the old modal", async () => {
  const { ctx } = harness();
  await ctx.openNewThreadModal();
  assert.equal(ctx.state.newThreadCwd, "");
  assert.equal(ctx.isBoardViewActive(), false);
  assert.doesNotMatch(source, /\$\("newThreadModal"\)\.showModal\(/);
  assert.equal((source.match(/openNewThreadModal\(\{ cwd: newBtn\.dataset\.newInCwd/g) || []).length, 3);
});

test("Agent-specific model/effort persist across switching and do not change existing threads", () => {
  const { ctx, el } = harness();
  ctx.saveNewThreadPrefs("codex", { model: "sol", effort: "high" });
  ctx.saveNewThreadPrefs("antigravity", { model: "gemini-4-hydrogen", effort: "low" });
  for (const [provider, model, effort] of [["codex", "sol", "high"], ["antigravity", "gemini-4-hydrogen", "low"], ["codex", "sol", "high"]]) {
    el("composerProviderSelect").value = provider;
    ctx.state.userPickedDraftModel = false;
    ctx.syncModelAndEffortSelectors();
    assert.equal(el("modelSelect").value, model);
    assert.equal(el("effortSelect").value, effort);
  }
  ctx.state.activeThreadId = "codex:default:existing";
  ctx.state.activeThread = { provider: "codex", model: "sol", reasoningEffort: "low" };
  ctx.syncModelAndEffortSelectors();
  assert.equal(el("effortSelect").value, "low");
  assert.equal(ctx.getNewThreadPrefs("codex").effort, "high");
});
