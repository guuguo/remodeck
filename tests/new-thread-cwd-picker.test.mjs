import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  collectNewThreadCwdOptions,
  formatCwdParts,
  looksLikeDirectoryPath,
  normalizeDraftCwdInput,
  renderNewThreadCwdListHtml,
} from "../public/new-thread-cwd.js";
import { translateText } from "../public/i18n.js";
import { expandHomePath, pickNativeDirectory } from "../src/platform.mjs";
import { CodexProvider } from "../src/providers/codex-provider.mjs";
import { createAgentControlServer } from "../src/server.mjs";

const MOCK_CODEX_BIN = fileURLToPath(new URL("./helpers/mock-codex-cli.mjs", import.meta.url));

test("collectNewThreadCwdOptions deduplicates, excludes placeholder, orders pinned/recent, and keeps custom paths", () => {
  const threads = [
    { id: "c:1", cwd: "", updatedAt: 999 },
    { id: "c:2", cwd: "/work/recent-app/", updatedAt: 500 },
    { id: "c:3", cwd: "/work/older-app", updatedAt: 200 },
    { id: "c:4", cwd: "/work/pinned-app", updatedAt: 100 },
  ];
  const projectsMeta = {
    "/work/pinned-app": { pinned: true, pinnedAt: 400, alias: "置顶项目" },
    "/work/meta-only": { pinned: true, pinnedAt: 600, alias: "仅元信息" },
  };

  const base = collectNewThreadCwdOptions({
    threads,
    projectsMeta,
    currentCwd: "/work/unsaved-custom/",
    scopedProjectCwd: "/work/scoped-proj",
  });

  assert.equal(base.items.some((i) => i.cwd === "默认工作区"), false);
  assert.deepEqual(
    base.items.map((i) => i.cwd),
    [
      "/work/unsaved-custom",
      "/work/meta-only",
      "/work/pinned-app",
      "/work/recent-app",
      "/work/older-app",
      "/work/scoped-proj",
      "",
    ],
  );
  assert.equal(base.items[0].isCustomCurrent, true);
  assert.equal(base.items[0].selected, true);
  assert.equal(base.items[1].alias, "仅元信息");
  assert.equal(base.items.at(-1).kind, "default");
  assert.equal(base.items.at(-1).selected, false);

  const byAlias = collectNewThreadCwdOptions({ threads, projectsMeta, query: "置顶" });
  assert.deepEqual(byAlias.items.map((i) => i.cwd), ["/work/pinned-app"]);

  const existingSlash = collectNewThreadCwdOptions({ threads, projectsMeta, query: "/work/recent-app/" });
  assert.equal(existingSlash.items.filter((i) => i.kind === "custom").length, 0);
  assert.deepEqual(existingSlash.items.map((i) => i.cwd), ["/work/recent-app"]);

  const customTyped = collectNewThreadCwdOptions({ threads, projectsMeta, query: "~/dev/new-proj/" });
  assert.equal(customTyped.items.length, 1);
  assert.equal(customTyped.items[0].kind, "custom");
  assert.equal(customTyped.items[0].cwd, "~/dev/new-proj");

  const defaultSelected = collectNewThreadCwdOptions({ threads, projectsMeta, currentCwd: "", query: "home" });
  assert.equal(defaultSelected.items.at(-1).kind, "default");
  assert.equal(defaultSelected.items.at(-1).selected, true);
});

test("looksLikeDirectoryPath, normalizeDraftCwdInput, formatCwdParts, and renderNewThreadCwdListHtml handle XSS and edge cases", () => {
  assert.equal(looksLikeDirectoryPath("/Volumes/SSD/dev"), true);
  assert.equal(looksLikeDirectoryPath("~/projects"), true);
  assert.equal(looksLikeDirectoryPath("D:\\Code"), true);
  assert.equal(looksLikeDirectoryPath("两个显眼包"), false);

  assert.equal(normalizeDraftCwdInput("  ~/dev/app/  "), "~/dev/app");
  assert.equal(normalizeDraftCwdInput(" / "), "/");
  assert.equal(normalizeDraftCwdInput("   "), "");

  assert.deepEqual(formatCwdParts("/a/b/c"), { prefix: "/a/b/", leaf: "c", full: "/a/b/c" });
  assert.deepEqual(formatCwdParts("C:\\dev\\app"), { prefix: "C:\\dev\\", leaf: "app", full: "C:\\dev\\app" });

  assert.match(renderNewThreadCwdListHtml([]), /cwd-picker-empty/);

  const html = renderNewThreadCwdListHtml([
    { kind: "project", cwd: '/tmp/<img src=x onerror="alert(1)">', name: '<script>x</script>', subtitle: '/tmp/<tag>', pinned: true, selected: true },
    { kind: "default", cwd: "", name: "默认工作区（用户主目录）", subtitle: "留空", selected: false },
  ], { highlightedIndex: 1 });

  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /class="cwd-picker-option is-selected"/);
  assert.match(html, /class="cwd-picker-option is-highlighted is-default"/);
});

test("expandHomePath and pickNativeDirectory work cleanly across platforms", async () => {
  const posixEnv = { HOME: "/Users/alice" };
  assert.equal(expandHomePath("", posixEnv, "darwin"), "");
  assert.equal(expandHomePath("~", posixEnv, "darwin"), "/Users/alice");
  assert.equal(expandHomePath("~/dev/proj/", posixEnv, "darwin"), "/Users/alice/dev/proj");
  assert.equal(expandHomePath("/opt/work/", posixEnv, "darwin"), "/opt/work");

  const winEnv = { USERPROFILE: "C:\\Users\\Alice" };
  assert.equal(expandHomePath("~", winEnv, "win32"), "C:\\Users\\Alice");
  assert.equal(expandHomePath("~\\Repos\\App\\", winEnv, "win32"), "C:\\Users\\Alice\\Repos\\App");

  const darwinOk = await pickNativeDirectory({
    platform: "darwin",
    env: posixEnv,
    execImpl: async (cmd, args) => {
      assert.equal(cmd, "osascript");
      assert.equal(args[0], "-e");
      return { stdout: "/Volumes/Data SSD/dev/demo/\n", stderr: "" };
    },
  });
  assert.deepEqual(darwinOk, { canceled: false, path: "/Volumes/Data SSD/dev/demo" });

  const darwinCancel = await pickNativeDirectory({
    platform: "darwin",
    env: posixEnv,
    execImpl: async () => ({ stdout: "", stderr: "" }),
  });
  assert.deepEqual(darwinCancel, { canceled: true, path: "" });
});

test("POST /api/fs/pick-directory enforces local-only access and POST /api/thread/new expands ~", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-cwd-picker-"));
  const home = resolve(root, "home");
  const subProj = resolve(home, "sub-project");
  const codexHome = resolve(root, "codex");
  const dataDir = resolve(root, "data");
  await Promise.all([subProj, codexHome, dataDir].map((dir) => mkdir(dir, { recursive: true })));

  let pickerCalls = 0;
  let pickerResult = { canceled: false, path: `${subProj}/` };
  const provider = new CodexProvider({
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      CODEX_BIN: MOCK_CODEX_BIN,
      AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", home: codexHome }]),
    },
  });
  const server = await createAgentControlServer({
    port: 0,
    dataDir,
    providers: [provider],
    disableRelay: true,
    disableTunnel: true,
    disableUpdateCheck: true,
    pickDirectoryImpl: async ({ initialDir }) => {
      pickerCalls += 1;
      assert.equal(initialDir, subProj);
      return pickerResult;
    },
    env: { ...process.env, HOME: home, USERPROFILE: home, AGENT_CONTROL_DISABLE_AUTOMATIONS: "1" },
  });
  t.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  await server.start();

  const okRes = await fetch(`${server.url}/api/fs/pick-directory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initialDir: subProj }),
  });
  assert.equal(okRes.status, 200);
  assert.deepEqual(await okRes.json(), { ok: true, canceled: false, path: subProj });
  assert.equal(pickerCalls, 1);

  pickerResult = { canceled: true, path: "" };
  const cancelRes = await fetch(`${server.url}/api/fs/pick-directory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ initialDir: subProj }),
  });
  assert.equal(cancelRes.status, 200);
  assert.deepEqual(await cancelRes.json(), { ok: true, canceled: true, path: "" });
  assert.equal(pickerCalls, 2);

  const blockedRes = await fetch(`${server.url}/api/fs/pick-directory`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9" },
    body: JSON.stringify({ initialDir: subProj }),
  });
  assert.ok([401, 403].includes(blockedRes.status));
  assert.equal(pickerCalls, 2);

  const threadRes = await fetch(`${server.url}/api/thread/new`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider: "codex",
      profileId: "default",
      cwd: "~/sub-project",
      text: "check cwd",
    }),
  });
  assert.equal(threadRes.status, 200);
  const threadJson = await threadRes.json();
  assert.equal(threadJson.thread?.cwd, subProj);
});

test("UI markup, styles, i18n, and app wiring include editable draft CWD picker without breaking activeCwd", async () => {
  const [html, css, appJs] = await Promise.all([
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
    readFile(new URL("../public/app.css", import.meta.url), "utf8"),
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
  ]);

  const versionMatch = html.match(/name="ac-ui-version" content="([^"]+)"/);
  assert.ok(versionMatch?.[1]);
  assert.ok(html.includes(`src="./app.js?v=${versionMatch[1]}"`));
  assert.match(html, /id="activeCwd"/);
  for (const id of [
    "newThreadCwdBtn",
    "newThreadCwdText",
    "newThreadCwdPopover",
    "newThreadCwdSearchInput",
    "newThreadCwdBrowseBtn",
    "newThreadCwdStatus",
    "newThreadCwdList",
  ]) {
    assert.ok(html.includes(`id="${id}"`), `index.html missing #${id}`);
  }

  assert.match(css, /\.topbar\.is-new-thread-draft\s+\.active-subrow\s*\{[^}]*display:\s*flex\s*!important;/);
  assert.match(css, /:root\[data-theme="light"\]\s+\.cwd-picker-popover\s*\{/);
  assert.match(appJs, /applyNewThreadCwd/);
  assert.match(appJs, /api\/fs\/pick-directory/);
  assert.match(appJs, /isLoopbackHostname\(location\.hostname\)/);
  assert.equal(translateText("浏览…", "en"), "Browse…");
  assert.equal(translateText("默认工作区（用户主目录）", "en"), "Default Workspace (Home Directory)");
});
