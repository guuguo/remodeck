import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { createAgentControlServer } from "../src/server.mjs";
import {
  bumpSemver,
  nextUiVersion,
  runBumpVersion,
} from "../scripts/bump-version.mjs";
import {
  computeDesktopSourceHash,
  computePendingReleaseNotes,
  DESKTOP_APP_NAME,
  parsePlistStrings,
  parsePorcelainDirtyFiles,
  parseReleaseNotes,
  readInstalledDesktopAppInfo,
  resolveDesktopLaunchSpec,
  sanitizeRemoteUrl,
  summarizeCommitsAsReleaseEntry,
  UpdateService,
} from "../src/update-service.mjs";

function gitSync(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function setupLocalGitRemoteFixture(t) {
  const baseDir = await mkdtemp(resolve(os.tmpdir(), "ac-update-git-"));
  t.after(() => rm(baseDir, { recursive: true, force: true }));

  const bareDir = resolve(baseDir, "remote.git");
  const authorDir = resolve(baseDir, "author");
  const appDir = resolve(baseDir, "app");
  const dataDir = resolve(baseDir, "data");

  await mkdir(bareDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });
  execFileSync("git", ["init", "--bare", "--initial-branch=main", bareDir], { stdio: "pipe" });
  execFileSync("git", ["clone", bareDir, authorDir], { stdio: "pipe" });

  gitSync(authorDir, ["config", "user.email", "test@example.com"]);
  gitSync(authorDir, ["config", "user.name", "Tester"]);
  await mkdir(resolve(authorDir, "public"), { recursive: true });
  await writeFile(resolve(authorDir, "package.json"), JSON.stringify({ name: "agent-control", version: "0.1.0" }, null, 2), "utf8");
  await writeFile(resolve(authorDir, "public", "index.html"), '<meta name="ac-ui-version" content="20261116af" />\n', "utf8");
  await writeFile(resolve(authorDir, "node_modules_marker"), "ok\n", "utf8");
  gitSync(authorDir, ["add", "."]);
  gitSync(authorDir, ["commit", "-m", "init v0.1.0"]);
  gitSync(authorDir, ["push", "-u", "origin", "main"]);

  execFileSync("git", ["clone", "--branch", "main", bareDir, appDir], { stdio: "pipe" });
  gitSync(appDir, ["config", "user.email", "test@example.com"]);
  gitSync(appDir, ["config", "user.name", "Tester"]);
  await mkdir(resolve(appDir, "node_modules"), { recursive: true });

  return { baseDir, bareDir, authorDir, appDir, dataDir };
}

test("sanitizeRemoteUrl strips embedded credentials and parsePorcelainDirtyFiles parses status", () => {
  assert.equal(
    sanitizeRemoteUrl("https://user:ghp_secret123@github.com/guuguo/agent-control.git"),
    "https://github.com/guuguo/agent-control.git",
  );
  assert.equal(
    sanitizeRemoteUrl("git@github.com:guuguo/agent-control.git"),
    "git@github.com:guuguo/agent-control.git",
  );
  assert.deepEqual(parsePorcelainDirtyFiles(" M public/app.js\n?? temp.txt\n"), {
    dirty: true,
    dirtyCount: 2,
    dirtySample: ["public/app.js", "temp.txt"],
  });
  assert.deepEqual(parsePorcelainDirtyFiles(""), {
    dirty: false,
    dirtyCount: 0,
    dirtySample: [],
  });
});

test("UpdateService detects remote commits, blocks dirty apply, and updates cleanly with dependency & restart hooks", async (t) => {
  const { authorDir, appDir, dataDir } = await setupLocalGitRemoteFixture(t);

  let idleFlag = false;
  let npmCalls = 0;
  let restartCtx = null;
  const events = [];

  const service = new UpdateService({
    rootDir: appDir,
    dataDir,
    initialDelayMs: 60_000,
    idleRetryMs: 50,
    restartDelayMs: 10,
    execNpm: async (args) => {
      npmCalls += 1;
      assert.deepEqual(args.slice(0, 2), ["install", "--omit=dev"]);
      return { stdout: "added 0 packages", stderr: "" };
    },
    canAutoUpdateIdle: () => idleFlag,
    restartService: (ctx) => {
      restartCtx = ctx;
    },
    onStatusChange: (snap) => events.push(snap),
  });
  t.after(() => service.close());

  const initial = await service.load();
  assert.equal(initial.isGitRepo, true);
  assert.equal(initial.packageVersion, "0.1.0");
  assert.equal(initial.uiVersion, "20261116af");
  assert.equal(initial.updateState, "up_to_date");
  assert.equal(initial.hasUpdate, false);

  // Author pushes a new version modifying package.json & index.html
  await writeFile(resolve(authorDir, "package.json"), JSON.stringify({ name: "agent-control", version: "0.1.1" }, null, 2), "utf8");
  await writeFile(resolve(authorDir, "public", "index.html"), '<meta name="ac-ui-version" content="20261116zz" />\n', "utf8");
  gitSync(authorDir, ["add", "package.json", "public/index.html"]);
  gitSync(authorDir, ["commit", "-m", "feat: 发布 v0.1.1 自更新演示"]);
  gitSync(authorDir, ["push", "origin", "main"]);

  // Enable autoUpdate while busy (idleFlag = false) -> must detect update without restarting while busy.
  await service.configure({ autoCheckEnabled: true, autoUpdateEnabled: true, checkIntervalHours: 3 });
  const checked = await service.checkForUpdates({ silent: false });
  assert.equal(checked.updateState, "available");
  assert.equal(checked.hasUpdate, true);
  assert.equal(checked.behindCount, 1);
  assert.equal(checked.remoteVersion, "0.1.1");
  assert.equal(checked.pendingCommits.length, 1);
  assert.equal(checked.pendingCommits[0].subject, "feat: 发布 v0.1.1 自更新演示");
  assert.equal(restartCtx, null);

  // Dirty local working tree must block applyUpdate and preserve uncommitted edits.
  await writeFile(resolve(appDir, "local-wip.txt"), "do not overwrite\n", "utf8");
  await assert.rejects(() => service.applyUpdate({ reason: "manual" }), /未提交改动/);
  assert.equal(await readFile(resolve(appDir, "local-wip.txt"), "utf8"), "do not overwrite\n");

  // Clean working tree + idle -> one-click apply succeeds, runs npm install on package.json diff, and schedules restart.
  await rm(resolve(appDir, "local-wip.txt"), { force: true });
  idleFlag = true;
  const applyRes = await service.applyUpdate({ reason: "manual" });
  assert.equal(applyRes.ok, true);
  assert.equal(applyRes.updated, true);
  assert.equal(applyRes.restarting, true);
  assert.equal(applyRes.status.packageVersion, "0.1.1");
  assert.equal(applyRes.status.uiVersion, "20261116zz");
  assert.equal(applyRes.status.behindCount, 0);
  assert.equal(npmCalls, 1);

  await new Promise((r) => setTimeout(r, 40));
  assert.ok(restartCtx);
  assert.notEqual(restartCtx.fromSha, restartCtx.toSha);

  // Persisted settings survive reload.
  const reloaded = new UpdateService({ rootDir: appDir, dataDir });
  t.after(() => reloaded.close());
  const loadedState = await reloaded.load();
  assert.equal(loadedState.autoUpdateEnabled, true);
  assert.equal(loadedState.checkIntervalHours, 3);
  assert.equal(loadedState.lastUpdatedToSha, restartCtx.toSha);
});

test("HTTP /api/update/* endpoints and SSE ready payload expose check, config, and apply controls", async (t) => {
  const { authorDir, appDir, dataDir } = await setupLocalGitRemoteFixture(t);
  let restartCalled = false;

  const srv = await createAgentControlServer({
    port: 0,
    host: "127.0.0.1",
    dataDir,
    disableRelay: true,
    disableTunnel: true,
    disableUpdateCheck: true,
    providers: [],
    updateServiceOptions: {
      rootDir: appDir,
      initialDelayMs: 60_000,
      restartDelayMs: 10,
      execNpm: async () => ({ stdout: "", stderr: "" }),
      restartService: () => {
        restartCalled = true;
      },
    },
  });
  await srv.start();
  t.after(() => srv.close());

  const initialRes = await fetch(`${srv.url}/api/update`);
  assert.equal(initialRes.status, 200);
  const initialJson = await initialRes.json();
  assert.equal(initialJson.packageVersion, "0.1.0");
  assert.equal(initialJson.updateState, "up_to_date");

  // Push remote update and trigger /api/update/check
  await writeFile(resolve(authorDir, "package.json"), JSON.stringify({ name: "agent-control", version: "0.2.0" }, null, 2), "utf8");
  gitSync(authorDir, ["add", "package.json"]);
  gitSync(authorDir, ["commit", "-m", "chore: bump to 0.2.0"]);
  gitSync(authorDir, ["push", "origin", "main"]);

  const checkRes = await fetch(`${srv.url}/api/update/check`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(checkRes.status, 200);
  const checkJson = await checkRes.json();
  assert.equal(checkJson.hasUpdate, true);
  assert.equal(checkJson.remoteVersion, "0.2.0");

  const cfgRes = await fetch(`${srv.url}/api/update/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ autoCheckEnabled: true, autoUpdateEnabled: true }),
  });
  assert.equal(cfgRes.status, 200);
  const cfgJson = await cfgRes.json();
  assert.equal(cfgJson.autoUpdateEnabled, true);

  const applyRes = await fetch(`${srv.url}/api/update/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "manual" }),
  });
  assert.equal(applyRes.status, 200);
  const applyJson = await applyRes.json();
  assert.equal(applyJson.ok, true);
  assert.equal(applyJson.updated, true);
  assert.equal(applyJson.status.packageVersion, "0.2.0");

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(restartCalled, true);
});

test("bump-version scripts sync package.json, UI version, and CHANGELOG cleanly", async (t) => {
  assert.equal(bumpSemver("0.1.0", "patch"), "0.1.1");
  assert.equal(bumpSemver("0.1.0", "minor"), "0.2.0");
  assert.equal(bumpSemver("0.1.0", "major"), "1.0.0");
  assert.equal(bumpSemver("0.1.0", "2.3.4"), "2.3.4");

  const day = new Date(2026, 10, 16);
  assert.equal(nextUiVersion("20261116af", day), "20261116ag");
  assert.equal(nextUiVersion("20261115z", day), "20261116a");

  const tempRoot = await mkdtemp(resolve(os.tmpdir(), "ac-bump-ver-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  await mkdir(resolve(tempRoot, "public"), { recursive: true });
  await writeFile(resolve(tempRoot, "package.json"), JSON.stringify({ name: "agent-control", version: "0.1.0" }, null, 2), "utf8");
  await writeFile(resolve(tempRoot, "public", "index.html"), '<meta name="ac-ui-version" content="20261116af" />\n<script type="module" src="./app.js?v=20261116af"></script>\n', "utf8");
  await writeFile(resolve(tempRoot, "public", "app.js"), 'import { x } from "./icons.js?v=20261116af";\n', "utf8");
  await writeFile(resolve(tempRoot, "CHANGELOG.md"), "# 更新日志 (CHANGELOG)\n\n## v0.1.0 (2026-11-16)\n\n- init\n", "utf8");

  const res = runBumpVersion("0.2.0", { rootDir: tempRoot, date: day });
  assert.equal(res.oldVersion, "0.1.0");
  assert.equal(res.newVersion, "0.2.0");
  assert.equal(res.newUiVersion, "20261116ag");

  const pkg = JSON.parse(await readFile(resolve(tempRoot, "package.json"), "utf8"));
  assert.equal(pkg.version, "0.2.0");
  const html = await readFile(resolve(tempRoot, "public", "index.html"), "utf8");
  assert.match(html, /content="20261116ag"/);
  assert.match(html, /app\.js\?v=20261116ag/);
  const appJs = await readFile(resolve(tempRoot, "public", "app.js"), "utf8");
  assert.match(appJs, /icons\.js\?v=20261116ag/);
  const log = await readFile(resolve(tempRoot, "CHANGELOG.md"), "utf8");
  assert.match(log, /^# 更新日志 \(CHANGELOG\)\s+## v0\.2\.0 \(2026-11-16\)/);
  const releaseNotes = await readFile(resolve(tempRoot, "RELEASE_NOTES.md"), "utf8");
  assert.match(releaseNotes, /## v0\.2\.0 \(2026-11-16\)/);
  assert.match(releaseNotes, /### 优化/);
  const releaseNotesEn = await readFile(resolve(tempRoot, "RELEASE_NOTES.en.md"), "utf8");
  assert.match(releaseNotesEn, /## v0\.2\.0 \(2026-11-16\)/);
  assert.match(releaseNotesEn, /### Improved/);
});

test("UpdateService detects desktop shell drift, builds via /api/update/desktop, and syncs on applyUpdate", async (t) => {
  const { authorDir, appDir, dataDir, baseDir } = await setupLocalGitRemoteFixture(t);
  const desktopDir = resolve(baseDir, "Applications");
  const appBundle = resolve(desktopDir, DESKTOP_APP_NAME);

  await mkdir(resolve(authorDir, "desktop", "macos"), { recursive: true });
  await writeFile(resolve(authorDir, "desktop", "macos", "AgentControl.swift"), "// v1\n", "utf8");
  await writeFile(resolve(authorDir, "desktop", "macos", "Info.plist"), "<plist></plist>\n", "utf8");
  await writeFile(resolve(authorDir, "desktop", "macos", "build-app.sh"), "#!/usr/bin/env bash\n", "utf8");
  await writeFile(resolve(authorDir, "desktop", "macos", "render-icon.swift"), "// icon\n", "utf8");
  gitSync(authorDir, ["add", "."]);
  gitSync(authorDir, ["commit", "-m", "add desktop source"]);
  gitSync(authorDir, ["push", "origin", "main"]);
  gitSync(appDir, ["pull", "--ff-only", "origin", "main"]);

  async function writeDesktopBundle({ version, hash, buildNumber = "1", root = appDir }) {
    await mkdir(resolve(appBundle, "Contents"), { recursive: true });
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<plist version="1.0"><dict>',
      `  <key>CFBundleShortVersionString</key><string>${version}</string>`,
      `  <key>CFBundleVersion</key><string>${buildNumber}</string>`,
      ...(hash ? [`  <key>AgentControlBuildHash</key><string>${hash}</string>`] : []),
      `  <key>AgentControlRepoRoot</key><string>${root}</string>`,
      '</dict></plist>',
    ].join("\n");
    await writeFile(resolve(appBundle, "Contents", "Info.plist"), xml, "utf8");
  }

  // Legacy 0.1.0 shell without AgentControlBuildHash should be flagged as outdated on darwin.
  await writeDesktopBundle({ version: "0.1.0", hash: "" });
  const parsedPlist = parsePlistStrings(await readFile(resolve(appBundle, "Contents", "Info.plist"), "utf8"));
  assert.equal(parsedPlist.CFBundleShortVersionString, "0.1.0");

  const initialDesktopInfo = await readInstalledDesktopAppInfo({
    rootDir: appDir,
    packageVersion: "0.1.0",
    platform: "darwin",
    installDir: desktopDir,
  });
  assert.equal(initialDesktopInfo.supported, true);
  assert.equal(initialDesktopInfo.installed, true);
  assert.equal(initialDesktopInfo.needsUpdate, true);
  assert.equal(initialDesktopInfo.state, "outdated");

  let buildCalls = 0;
  let relaunchCalls = 0;
  let serviceRestartCalls = 0;

  const srv = await createAgentControlServer({
    host: "127.0.0.1",
    port: 0,
    dataDir,
    disableRelay: true,
    disableTunnel: true,
    disableUpdateCheck: true,
    providers: [],
    updateServiceOptions: {
      rootDir: appDir,
      platform: "darwin",
      desktopInstallDir: desktopDir,
      initialDelayMs: 60_000,
      restartDelayMs: 10,
      execNpm: async () => ({ stdout: "", stderr: "" }),
      execDesktopBuild: async () => {
        buildCalls += 1;
        const pkg = JSON.parse(await readFile(resolve(appDir, "package.json"), "utf8"));
        const hash = await computeDesktopSourceHash(appDir, pkg.version);
        await writeDesktopBundle({ version: pkg.version, hash, buildNumber: String(buildCalls + 1) });
      },
      relaunchDesktopApp: async () => {
        relaunchCalls += 1;
      },
      restartService: () => {
        serviceRestartCalls += 1;
      },
    },
  });
  await srv.start();
  t.after(() => srv.close());

  const beforeStatus = await (await fetch(`${srv.url}/api/update`)).json();
  assert.equal(beforeStatus.desktopApp.needsUpdate, true);
  assert.equal(beforeStatus.autoUpdateDesktopApp, true);

  // Manual desktop rebuild via POST /api/update/desktop
  const desktopRes = await fetch(`${srv.url}/api/update/desktop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "manual" }),
  });
  assert.equal(desktopRes.status, 200);
  const desktopJson = await desktopRes.json();
  assert.equal(desktopJson.ok, true);
  assert.equal(desktopJson.rebuilt, true);
  assert.equal(desktopJson.status.desktopApp.needsUpdate, false);
  assert.equal(desktopJson.status.desktopApp.state, "up_to_date");
  assert.equal(buildCalls, 1);

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(relaunchCalls, 1);

  // Remote bump to 0.2.0 + Swift source change -> applyUpdate automatically rebuilds desktop shell too.
  await writeFile(resolve(authorDir, "package.json"), JSON.stringify({ name: "agent-control", version: "0.2.0" }, null, 2), "utf8");
  await writeFile(resolve(authorDir, "desktop", "macos", "AgentControl.swift"), "// v2\n", "utf8");
  gitSync(authorDir, ["add", "."]);
  gitSync(authorDir, ["commit", "-m", "release v0.2.0 with desktop shell update"]);
  gitSync(authorDir, ["push", "origin", "main"]);

  const applyRes = await fetch(`${srv.url}/api/update/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "manual" }),
  });
  assert.equal(applyRes.status, 200);
  const applyJson = await applyRes.json();
  assert.equal(applyJson.ok, true);
  assert.equal(applyJson.desktopRebuilt, true);
  assert.equal(applyJson.status.packageVersion, "0.2.0");
  assert.equal(applyJson.status.desktopApp.installedVersion, "0.2.0");
  assert.equal(applyJson.status.desktopApp.needsUpdate, false);
  assert.equal(buildCalls, 2);

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(serviceRestartCalls, 1);
  assert.equal(relaunchCalls, 2);

  // Standalone manual restart endpoint triggers service restart without requiring remote updates.
  const restartRes = await fetch(`${srv.url}/api/update/restart`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "manual" }),
  });
  assert.equal(restartRes.status, 409); // restartPending from applyUpdate above is still true

  const svcOnly = new UpdateService({
    rootDir: appDir,
    dataDir: resolve(baseDir, "data-restart-only"),
    disableAutoCheck: true,
    restartDelayMs: 10,
    restartService: () => { serviceRestartCalls += 1; },
  });
  const restarted = await svcOnly.restartService({ reason: "manual" });
  assert.equal(restarted.ok, true);
  assert.equal(restarted.restarting, true);
  assert.equal(restarted.status.restartPending, true);
  await assert.rejects(svcOnly.restartService({ reason: "manual" }), (err) => err?.status === 409);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(serviceRestartCalls, 2);
  svcOnly.close();
});

test("readInstalledDesktopAppInfo and applyDesktopUpdate support Windows and Linux desktop wrappers", async (t) => {
  const { readInstalledDesktopAppInfo, computeDesktopSourceHash } = await import("../src/update-service.mjs");
  const baseDir = await mkdtemp(resolve(os.tmpdir(), "ac-desktop-cross-"));
  t.after(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  const rootDir = resolve(baseDir, "repo");
  const winInstallDir = resolve(baseDir, "win-local");
  const linuxInstallDir = resolve(baseDir, "linux-meta");
  await mkdir(resolve(rootDir, "desktop", "windows"), { recursive: true });
  await mkdir(resolve(rootDir, "desktop", "linux"), { recursive: true });
  await mkdir(resolve(rootDir, "public"), { recursive: true });
  await writeFile(resolve(rootDir, "package.json"), JSON.stringify({ name: "agent-control", version: "0.2.3" }), "utf8");
  await writeFile(resolve(rootDir, "public", "index.html"), '<meta name="ac-ui-version" content="test" />', "utf8");
  await writeFile(resolve(rootDir, "desktop", "windows", "install-app.ps1"), "# win installer\n", "utf8");
  await writeFile(resolve(rootDir, "desktop", "linux", "install-app.sh"), "#!/usr/bin/env bash\n", "utf8");
  await writeFile(resolve(rootDir, "desktop", "linux", "agent-control.py"), "# linux app\n", "utf8");

  const expectedHash = await computeDesktopSourceHash(rootDir, "0.2.3");

  // Windows: initially not installed, but supported & buildable
  const winBefore = await readInstalledDesktopAppInfo({
    rootDir,
    packageVersion: "0.2.3",
    platform: "win32",
    installDir: winInstallDir,
    env: { ...process.env, APPDATA: resolve(baseDir, "win-roaming") },
  });
  assert.equal(winBefore.supported, true);
  assert.equal(winBefore.installed, false);
  assert.equal(winBefore.canBuild, true);

  const winSvc = new UpdateService({
    rootDir,
    dataDir: resolve(baseDir, "data-win"),
    platform: "win32",
    desktopInstallDir: winInstallDir,
    disableAutoCheck: true,
    execDesktopBuild: async ({ installDir }) => {
      await mkdir(installDir, { recursive: true });
      await writeFile(resolve(installDir, "desktop-meta.json"), JSON.stringify({
        version: "0.2.3",
        buildHash: expectedHash,
        repoRoot: rootDir,
        appPath: resolve(installDir, "Agent Control.lnk"),
      }), "utf8");
    },
  });
  t.after(() => winSvc.close());
  const winBuilt = await winSvc.applyDesktopUpdate({ reason: "manual", relaunchIfRunning: false });
  assert.equal(winBuilt.ok, true);
  assert.equal(winBuilt.desktopApp.installed, true);
  assert.equal(winBuilt.desktopApp.state, "up_to_date");

  // Linux: initially not installed, supported & buildable
  const linuxBefore = await readInstalledDesktopAppInfo({
    rootDir,
    packageVersion: "0.2.3",
    platform: "linux",
    installDir: linuxInstallDir,
    env: { ...process.env, XDG_DATA_HOME: resolve(baseDir, "xdg-data") },
  });
  assert.equal(linuxBefore.supported, true);
  assert.equal(linuxBefore.installed, false);
  assert.equal(linuxBefore.canBuild, true);

  const linuxSvc = new UpdateService({
    rootDir,
    dataDir: resolve(baseDir, "data-linux"),
    platform: "linux",
    desktopInstallDir: linuxInstallDir,
    disableAutoCheck: true,
    execDesktopBuild: async ({ installDir }) => {
      await mkdir(installDir, { recursive: true });
      await writeFile(resolve(installDir, "desktop-meta.json"), JSON.stringify({
        version: "0.2.3",
        buildHash: expectedHash,
        repoRoot: rootDir,
        appPath: resolve(installDir, "com.guuguo.AgentControl.desktop"),
      }), "utf8");
    },
  });
  t.after(() => linuxSvc.close());
  const linuxBuilt = await linuxSvc.applyDesktopUpdate({ reason: "manual", relaunchIfRunning: false });
  assert.equal(linuxBuilt.ok, true);
  assert.equal(linuxBuilt.desktopApp.installed, true);
  assert.equal(linuxBuilt.desktopApp.state, "up_to_date");
});

test("parseReleaseNotes and computePendingReleaseNotes handle user-friendly notes and fallbacks cleanly", () => {
  const sampleMd = [
    "# Agent Control 更新说明",
    "",
    "> 头部提示文本应被忽略",
    "",
    "## v0.2.3 (2026-11-19) — 图表直出与解归档",
    "",
    "UI 资源版本：`20261119relnotes`",
    "",
    "一句话总结：支持直接在对话中看流程图，也能一键解归档旧会话。",
    "",
    "### 新增",
    "",
    "- **Mermaid 流程图直接渲染**：对话里的流程图直接画出图形。",
    "- 【修复】**速率校准**：解决部分历史会话不显示吐字速度的问题 (abc1234)",
    "",
    "### 优化",
    "",
    "- **执行统计更直观**：第一眼看清谁最快。",
    "",
    "## v0.2.2 (2026-11-16) — 语音更轻快",
    "",
    "- 升级语音轻量模型",
  ].join("\n");

  const parsed = parseReleaseNotes(sampleMd);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].version, "0.2.3");
  assert.equal(parsed[0].date, "2026-11-19");
  assert.equal(parsed[0].title, "图表直出与解归档");
  assert.equal(parsed[0].summary, "支持直接在对话中看流程图，也能一键解归档旧会话。");
  assert.equal(parsed[0].items.length, 3);
  assert.deepEqual(parsed[0].items[0], {
    category: "new",
    categoryLabel: "新增",
    title: "Mermaid 流程图直接渲染",
    detail: "对话里的流程图直接画出图形。",
    text: "Mermaid 流程图直接渲染：对话里的流程图直接画出图形。",
  });
  assert.equal(parsed[0].items[1].category, "fix");
  assert.equal(parsed[0].items[1].categoryLabel, "修复");
  assert.doesNotMatch(parsed[0].items[1].text, /abc1234/);
  assert.equal(parsed[0].items[2].category, "improve");

  // Scenario 1: New remote version v0.2.4 added on top
  const remoteNewVer = parseReleaseNotes(`# H\n\n## v0.2.4 (2026-11-20) — 全新能力\n\n### 新增\n- 支持批量导出\n\n${sampleMd}`);
  const s1 = computePendingReleaseNotes({
    localNotes: parsed,
    remoteNotes: remoteNewVer,
    localSource: "release_notes",
    remoteSource: "release_notes",
    pendingCommits: [{ sha: "1111111", timestamp: 1700000000, subject: "feat: export" }],
    localVersion: "0.2.3",
    remoteVersion: "0.2.4",
  });
  assert.equal(s1.pendingSource, "release_notes");
  assert.equal(s1.pending.length, 1);
  assert.equal(s1.pending[0].version, "0.2.4");

  // Scenario 2: Same version v0.2.3 updated in place with new items
  const remoteInPlace = parseReleaseNotes(sampleMd.replace("- **执行统计更直观**：第一眼看清谁最快。", "- **执行统计更直观**：第一眼看清谁最快。\n- **新增桌面提醒**：发现更新后角标更醒目。"));
  const s2 = computePendingReleaseNotes({
    localNotes: parsed,
    remoteNotes: remoteInPlace,
    localSource: "release_notes",
    remoteSource: "release_notes",
    pendingCommits: [{ sha: "2222222", timestamp: 1700000000, subject: "feat: desktop badge" }],
    localVersion: "0.2.3",
    remoteVersion: "0.2.3",
  });
  assert.equal(s2.pendingSource, "release_notes");
  assert.equal(s2.pending.length, 1);
  assert.deepEqual(s2.pending[0].items.map((i) => i.title), ["新增桌面提醒"]);

  // Scenario 3: Legacy installation without RELEASE_NOTES.md upgrades to version that introduces it -> only top/newer entries
  const s3 = computePendingReleaseNotes({
    localNotes: [{ id: "v0.2.0", heading: "v0.2.0 (2026-11-16)", version: "0.2.0", date: "2026-11-16", title: "old", summary: "", items: [] }],
    remoteNotes: parsed,
    localSource: "changelog",
    remoteSource: "release_notes",
    pendingCommits: [{ sha: "3333333", timestamp: 1700000000, subject: "docs: add release notes" }],
    localVersion: "0.2.0",
    remoteVersion: "0.2.3",
  });
  assert.equal(s3.pendingSource, "release_notes");
  assert.equal(s3.pending.length, 2); // 0.2.3 and 0.2.2 are strictly > 0.2.0

  // Scenario 4: Code pushed without editing RELEASE_NOTES.md -> commits fallback
  const s4 = computePendingReleaseNotes({
    localNotes: parsed,
    remoteNotes: parsed,
    localSource: "release_notes",
    remoteSource: "release_notes",
    pendingCommits: [
      { sha: "4444444", timestamp: 1700000500, subject: "chore: bump version" },
      { sha: "5555555", timestamp: 1700000400, subject: "fix(ui): 修复窄屏下弹窗横向溢出" },
      { sha: "6666666", timestamp: 1700000300, subject: "feat: 新增快捷键切换深浅主题" },
    ],
    localVersion: "0.2.3",
    remoteVersion: "0.2.3",
  });
  assert.equal(s4.pendingSource, "commits_fallback");
  assert.equal(s4.pending.length, 1);
  assert.equal(s4.pending[0].items.length, 2);
  assert.equal(s4.pending[0].items[0].category, "fix");
  assert.equal(s4.pending[0].items[0].text, "修复窄屏下弹窗横向溢出");
  assert.equal(s4.pending[0].items[1].category, "new");

  // Direct commit summarizer sanity check
  const summarized = summarizeCommitsAsReleaseEntry([{ sha: "abc", timestamp: 0, subject: "perf: 提升首屏加载速度" }]);
  assert.equal(summarized.items[0].category, "improve");
  assert.equal(summarized.items[0].text, "提升首屏加载速度");
});

test("UpdateService reads local and remote RELEASE_NOTES.md across checkForUpdates and applyUpdate", async (t) => {
  const { authorDir, appDir, dataDir } = await setupLocalGitRemoteFixture(t);

  await writeFile(
    resolve(authorDir, "RELEASE_NOTES.md"),
    "# Agent Control 更新说明\n\n## v0.1.0 (2026-11-16) — 初始版本\n\n### 新增\n- **基础面板**：支持远程对话。\n",
    "utf8",
  );
  gitSync(authorDir, ["add", "RELEASE_NOTES.md"]);
  gitSync(authorDir, ["commit", "-m", "docs: add initial release notes"]);
  gitSync(authorDir, ["push", "origin", "main"]);
  gitSync(appDir, ["pull", "--ff-only", "origin", "main"]);

  let restarted = false;
  const service = new UpdateService({
    rootDir: appDir,
    dataDir,
    initialDelayMs: 60_000,
    restartDelayMs: 10,
    execNpm: async () => ({ stdout: "", stderr: "" }),
    restartService: () => {
      restarted = true;
    },
  });
  t.after(() => service.close());

  const initial = await service.load();
  assert.equal(initial.releaseNotes.file, "RELEASE_NOTES.md");
  assert.equal(initial.releaseNotes.current?.version, "0.1.0");
  assert.equal(initial.releaseNotes.current?.title, "初始版本");
  assert.deepEqual(initial.releaseNotes.pending, []);
  assert.equal(initial.releaseNotes.pendingSource, "none");

  // Author bumps to v0.1.1 with rich release notes
  await writeFile(resolve(authorDir, "package.json"), JSON.stringify({ name: "agent-control", version: "0.1.1" }, null, 2), "utf8");
  await writeFile(
    resolve(authorDir, "RELEASE_NOTES.md"),
    [
      "# Agent Control 更新说明",
      "",
      "## v0.1.1 (2026-11-19) — 对话更顺滑",
      "",
      "一句话总结：加入图表渲染与人话版更新日志。",
      "",
      "### 新增",
      "- **流程图预览**：支持对话内直接查看流程图。",
      "",
      "## v0.1.0 (2026-11-16) — 初始版本",
      "",
      "### 新增",
      "- **基础面板**：支持远程对话。",
      "",
    ].join("\n"),
    "utf8",
  );
  gitSync(authorDir, ["add", "package.json", "RELEASE_NOTES.md"]);
  gitSync(authorDir, ["commit", "-m", "chore: release v0.1.1"]);
  gitSync(authorDir, ["push", "origin", "main"]);

  const checked = await service.checkForUpdates({ silent: false });
  assert.equal(checked.hasUpdate, true);
  assert.equal(checked.releaseNotes.pendingSource, "release_notes");
  assert.equal(checked.releaseNotes.pending.length, 1);
  assert.equal(checked.releaseNotes.pending[0].version, "0.1.1");
  assert.equal(checked.releaseNotes.pending[0].summary, "加入图表渲染与人话版更新日志。");
  assert.equal(checked.releaseNotes.pending[0].items[0].title, "流程图预览");

  const applied = await service.applyUpdate({ reason: "manual" });
  assert.equal(applied.ok, true);
  assert.equal(applied.status.releaseNotes.current?.version, "0.1.1");
  assert.equal(applied.status.releaseNotes.pending.length, 0);
  assert.equal(applied.status.releaseNotes.recent.length, 2);

  await new Promise((r) => setTimeout(r, 30));
  assert.equal(restarted, true);
});

test("parseReleaseNotes and UpdateService support bilingual RELEASE_NOTES.en.md seamlessly", async (t) => {
  const sampleEn = [
    "# Agent Control Release Notes",
    "",
    "> Ignore header note",
    "",
    "## v0.2.3 (2026-11-19) — Diagrams & Unarchive",
    "",
    "Summary: Render Mermaid flowcharts inline and unarchive Codex threads.",
    "",
    "### Added",
    "",
    "- **Inline Mermaid Diagrams**: Automatically draw vector flowcharts.",
    "- [Fixed] **Speed Calibration**: Ignore replayed historical bursts (dead123)",
    "",
    "### Improved",
    "",
    "- **Clearer Stats**: Show tok/s directly.",
  ].join("\n");

  const parsedEn = parseReleaseNotes(sampleEn, { locale: "en" });
  assert.equal(parsedEn.length, 1);
  assert.equal(parsedEn[0].version, "0.2.3");
  assert.equal(parsedEn[0].title, "Diagrams & Unarchive");
  assert.equal(parsedEn[0].summary, "Render Mermaid flowcharts inline and unarchive Codex threads.");
  assert.deepEqual(parsedEn[0].items[0], {
    category: "new",
    categoryLabel: "New",
    title: "Inline Mermaid Diagrams",
    detail: "Automatically draw vector flowcharts.",
    text: "Inline Mermaid Diagrams: Automatically draw vector flowcharts.",
  });
  assert.equal(parsedEn[0].items[1].category, "fix");
  assert.equal(parsedEn[0].items[1].categoryLabel, "Fixed");
  assert.doesNotMatch(parsedEn[0].items[1].text, /dead123/);

  const { authorDir, appDir, dataDir } = await setupLocalGitRemoteFixture(t);
  await writeFile(
    resolve(authorDir, "RELEASE_NOTES.md"),
    "# Agent Control 更新说明\n\n## v0.1.0 (2026-11-16) — 初始版本\n\n### 新增\n- **基础面板**：支持远程对话。\n",
    "utf8",
  );
  await writeFile(
    resolve(authorDir, "RELEASE_NOTES.en.md"),
    "# Agent Control Release Notes\n\n## v0.1.0 (2026-11-16) — Initial Release\n\n### Added\n- **Core Console**: Manage remote sessions.\n",
    "utf8",
  );
  gitSync(authorDir, ["add", "RELEASE_NOTES.md", "RELEASE_NOTES.en.md"]);
  gitSync(authorDir, ["commit", "-m", "docs: add bilingual release notes"]);
  gitSync(authorDir, ["push", "origin", "main"]);
  gitSync(appDir, ["pull", "--ff-only", "origin", "main"]);

  const svc = new UpdateService({
    rootDir: appDir,
    dataDir,
    initialDelayMs: 60_000,
    restartDelayMs: 10,
    execNpm: async () => ({ stdout: "", stderr: "" }),
    restartService: () => {},
  });
  t.after(() => svc.close());

  const initial = await svc.load();
  assert.equal(initial.releaseNotes.current?.title, "初始版本");
  assert.equal(initial.releaseNotes.locales?.en?.file, "RELEASE_NOTES.en.md");
  assert.equal(initial.releaseNotes.locales?.en?.current?.title, "Initial Release");

  await writeFile(resolve(authorDir, "package.json"), JSON.stringify({ name: "agent-control", version: "0.1.1" }, null, 2), "utf8");
  await writeFile(
    resolve(authorDir, "RELEASE_NOTES.md"),
    "# Agent Control 更新说明\n\n## v0.1.1 (2026-11-19) — 中文亮点\n\n### 新增\n- **中文项**：新功能。\n\n## v0.1.0 (2026-11-16) — 初始版本\n\n### 新增\n- **基础面板**：支持远程对话。\n",
    "utf8",
  );
  await writeFile(
    resolve(authorDir, "RELEASE_NOTES.en.md"),
    "# Agent Control Release Notes\n\n## v0.1.1 (2026-11-19) — English Highlights\n\nSummary: Plain-English update notes.\n\n### Added\n- **English Item**: Fresh feature.\n\n## v0.1.0 (2026-11-16) — Initial Release\n\n### Added\n- **Core Console**: Manage remote sessions.\n",
    "utf8",
  );
  gitSync(authorDir, ["add", "package.json", "RELEASE_NOTES.md", "RELEASE_NOTES.en.md"]);
  gitSync(authorDir, ["commit", "-m", "chore: release v0.1.1"]);
  gitSync(authorDir, ["push", "origin", "main"]);

  const checked = await svc.checkForUpdates({ silent: false });
  assert.equal(checked.hasUpdate, true);
  assert.equal(checked.releaseNotes.pending[0].title, "中文亮点");
  assert.equal(checked.releaseNotes.locales?.en?.pendingSource, "release_notes");
  assert.equal(checked.releaseNotes.locales?.en?.pending?.[0]?.title, "English Highlights");
  assert.equal(checked.releaseNotes.locales?.en?.pending?.[0]?.summary, "Plain-English update notes.");

  const applied = await svc.applyUpdate({ reason: "manual" });
  assert.equal(applied.ok, true);
  assert.equal(applied.status.releaseNotes.locales?.en?.current?.version, "0.1.1");
  assert.equal(applied.status.releaseNotes.locales?.en?.pending?.length, 0);
});

test("rewritten upstream history realigns clean clients on official commits and protects local work", async (t) => {
  const { authorDir, appDir, dataDir } = await setupLocalGitRemoteFixture(t);
  const oldSha = gitSync(appDir, ["rev-parse", "HEAD"]).trim();

  // Upstream rewrites history (new root commit with different content) and publishes the old-SHA map.
  gitSync(authorDir, ["checkout", "--orphan", "rewritten"]);
  await writeFile(resolve(authorDir, "package.json"), JSON.stringify({ name: "agent-control", version: "0.1.1" }, null, 2), "utf8");
  await writeFile(resolve(authorDir, "history-rewrite.json"), JSON.stringify({ oldShas: [oldSha] }), "utf8");
  gitSync(authorDir, ["add", "-A"]);
  gitSync(authorDir, ["commit", "-m", "rewritten init"]);
  gitSync(authorDir, ["push", "--force", "origin", "rewritten:main"]);

  const service = new UpdateService({
    rootDir: appDir,
    dataDir,
    initialDelayMs: 60_000,
    restartDelayMs: 10,
    execNpm: async () => ({ stdout: "", stderr: "" }),
    canAutoUpdateIdle: () => true,
    restartService: () => {},
  });
  t.after(() => service.close());
  await service.load();

  // A client with its own local commit must NOT be realigned.
  await writeFile(resolve(appDir, "mine.txt"), "mine\n", "utf8");
  gitSync(appDir, ["add", "mine.txt"]);
  gitSync(appDir, ["commit", "-m", "local work"]);
  const guarded = await service.checkForUpdates({ silent: false });
  assert.ok(guarded.aheadCount > 0);
  await assert.rejects(() => service.applyUpdate({ reason: "manual" }), /领先远端/);

  // Drop the local commit -> HEAD is an official old commit -> realign via reset --hard.
  gitSync(appDir, ["reset", "--hard", oldSha]);
  const checked = await service.checkForUpdates({ silent: false });
  assert.equal(checked.aheadCount, 0);
  assert.equal(checked.hasUpdate, true);
  const applied = await service.applyUpdate({ reason: "manual" });
  assert.equal(applied.updated, true);
  assert.equal(gitSync(appDir, ["rev-parse", "HEAD"]).trim(), gitSync(appDir, ["rev-parse", "origin/main"]).trim());
});

test("Windows desktop info strips UTF-8 BOM, resolves USERPROFILE, and exposes launch metadata", async (t) => {
  const baseDir = await mkdtemp(resolve(os.tmpdir(), "ac-win-bom-"));
  t.after(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  const rootDir = resolve(baseDir, "repo");
  const userProfile = resolve(baseDir, "Users", "alice");
  const localBase = resolve(userProfile, "AppData", "Local", "AgentControl");
  const startMenuPrograms = resolve(userProfile, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs");
  const desktopDir = resolve(userProfile, "Desktop");
  await mkdir(resolve(rootDir, "desktop", "windows"), { recursive: true });
  await mkdir(localBase, { recursive: true });
  await mkdir(startMenuPrograms, { recursive: true });
  await mkdir(desktopDir, { recursive: true });
  await writeFile(resolve(rootDir, "package.json"), JSON.stringify({ name: "agent-control", version: "0.2.6" }), "utf8");
  await writeFile(resolve(rootDir, "desktop", "windows", "install-app.ps1"), "# win installer\n", "utf8");
  await writeFile(resolve(rootDir, "desktop", "windows", "remodeck.ico"), Buffer.from([0, 0, 1, 0]));

  const expectedHash = await computeDesktopSourceHash(rootDir, "0.2.6");
  const startMenuPath = resolve(startMenuPrograms, "RemoteDeck.lnk");
  const desktopPath = resolve(desktopDir, "RemoteDeck.lnk");
  const iconPath = resolve(localBase, `remodeck-${expectedHash}.ico`);
  const browserPath = resolve(baseDir, "Edge", "msedge.exe");
  const browserArgs = ["--app=http://127.0.0.1:43310", `--user-data-dir=${resolve(localBase, "app-profile")}`];

  const metaJson = JSON.stringify({
    version: "0.2.6",
    buildHash: expectedHash,
    repoRoot: rootDir,
    appPath: startMenuPath,
    startMenuPath,
    desktopPath,
    iconPath,
    browserPath,
    browserArgs,
    launcherPath: "",
    platform: "win32",
  });
  await writeFile(resolve(localBase, "desktop-meta.json"), `\uFEFF${metaJson}`, "utf8");

  const info = await readInstalledDesktopAppInfo({
    rootDir,
    packageVersion: "0.2.6",
    platform: "win32",
    env: { USERPROFILE: userProfile },
  });

  assert.equal(info.installed, true);
  assert.equal(info.state, "up_to_date");
  assert.equal(info.needsUpdate, false);
  assert.equal(info.appPath, startMenuPath);
  assert.equal(info.startMenuPath, startMenuPath);
  assert.equal(info.desktopPath, desktopPath);
  assert.equal(info.iconPath, iconPath);
  assert.equal(info.browserPath, browserPath);
  assert.deepEqual(info.browserArgs, browserArgs);
});

test("resolveDesktopLaunchSpec selects Windows shortcut, browser fallback, and respects auto sync", async (t) => {
  const baseDir = await mkdtemp(resolve(os.tmpdir(), "ac-win-launch-"));
  t.after(async () => {
    await rm(baseDir, { recursive: true, force: true });
  });

  const startMenuLnk = resolve(baseDir, "RemoteDeck.lnk");
  const browserExe = resolve(baseDir, "msedge.exe");
  const launcherCmd = resolve(baseDir, "agent-control-desktop.cmd");
  await writeFile(startMenuLnk, "lnk", "utf8");
  await writeFile(browserExe, "exe", "utf8");
  await writeFile(launcherCmd, "@echo off\n", "utf8");

  const browserArgs = ["--app=http://127.0.0.1:43310"];
  const desktopApp = {
    appPath: startMenuLnk,
    startMenuPath: startMenuLnk,
    desktopPath: resolve(baseDir, "Desktop", "RemoteDeck.lnk"),
    browserPath: browserExe,
    browserArgs,
    launcherPath: launcherCmd,
  };

  // Manual build prefers .lnk via explorer.exe so AppUserModelID and custom icon apply.
  assert.deepEqual(
    resolveDesktopLaunchSpec({ platform: "win32", desktopApp, appPath: startMenuLnk, reason: "manual" }),
    { command: "explorer.exe", args: [startMenuLnk], windowsHide: true },
  );

  // Background auto-sync must not pop up an unsolicited window.
  assert.equal(
    resolveDesktopLaunchSpec({ platform: "win32", desktopApp, appPath: startMenuLnk, reason: "sync:auto" }),
    null,
  );

  // When .lnk is missing, falls back to direct browser launch with isolated args.
  await rm(startMenuLnk, { force: true });
  assert.deepEqual(
    resolveDesktopLaunchSpec({ platform: "win32", desktopApp, appPath: startMenuLnk, reason: "manual" }),
    { command: browserExe, args: browserArgs, windowsHide: false },
  );

  // When both .lnk and browser are missing, falls back to cmd launcher.
  await rm(browserExe, { force: true });
  assert.deepEqual(
    resolveDesktopLaunchSpec({ platform: "win32", desktopApp, appPath: startMenuLnk, reason: "manual" }),
    { command: "cmd.exe", args: ["/d", "/c", "start", "", launcherCmd], windowsHide: true },
  );
});

test("Windows desktop installer script and icon/manifest assets satisfy invariants", async () => {
  const repoRoot = resolve(import.meta.dirname, "..");
  const psBytes = await readFile(resolve(repoRoot, "desktop", "windows", "install-app.ps1"));
  assert.equal(psBytes[0], 0xef);
  assert.equal(psBytes[1], 0xbb);
  assert.equal(psBytes[2], 0xbf);

  const psText = psBytes.subarray(3).toString("utf8");
  assert.match(psText, /RemoteDeck\.lnk/);
  assert.match(psText, /ApplyAppUserModel/);
  assert.match(psText, /9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3/);
  assert.match(psText, /UTF8Encoding\]::new\(\$false\)/);
  assert.doesNotMatch(psText, /\$EdgeIcon\s*=|\$Shortcut\.IconLocation\s*=\s*\$EdgeIcon/);

  const winIco = await readFile(resolve(repoRoot, "desktop", "windows", "remodeck.ico"));
  const pubIco = await readFile(resolve(repoRoot, "public", "favicon.ico"));
  assert.ok(winIco.length > 1000);
  assert.equal(winIco.readUInt16LE(0), 0);
  assert.equal(winIco.readUInt16LE(2), 1);
  assert.equal(winIco.readUInt16LE(4), 6);
  assert.equal(Buffer.compare(winIco, pubIco), 0);

  const icon192 = await readFile(resolve(repoRoot, "public", "icon-192.png"));
  assert.deepEqual(icon192.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

  const iconSvg = await readFile(resolve(repoRoot, "public", "icon.svg"), "utf8");
  assert.match(iconSvg, /<svg\b/);

  const manifest = JSON.parse(await readFile(resolve(repoRoot, "public", "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.name, "RemoteDeck");
  assert.equal(manifest.start_url, "./");
  assert.ok(manifest.icons.some((item) => item.src === "./icon-192.png"));
  assert.ok(manifest.icons.some((item) => item.src === "./icon.svg"));

  const indexHtml = await readFile(resolve(repoRoot, "public", "index.html"), "utf8");
  assert.match(indexHtml, /href="\.\/favicon\.ico"/);
  assert.match(indexHtml, /href="\.\/icon\.svg"/);
  assert.match(indexHtml, /href="\.\/icon-192\.png"/);
  assert.match(indexHtml, /href="\.\/manifest\.webmanifest"/);
  assert.match(indexHtml, /id="desktopUpdateMenuWrap"/);
  assert.match(indexHtml, /id="applyDesktopUpdateBtn"/);
  assert.match(indexHtml, /id="desktopUpdateMenu"/);
  assert.match(indexHtml, /data-desktop-open="1"/);
  assert.match(indexHtml, /data-desktop-open="0"/);
});

test("POST /api/update/desktop honors explicit openAfterBuild flag for remote vs local rebuilds", async (t) => {
  const { authorDir, appDir, dataDir, baseDir } = await setupLocalGitRemoteFixture(t);
  const winInstallDir = resolve(baseDir, "win-local");

  await mkdir(resolve(authorDir, "desktop", "windows"), { recursive: true });
  await writeFile(resolve(authorDir, "desktop", "windows", "install-app.ps1"), "# win installer\n", "utf8");
  await writeFile(resolve(authorDir, "desktop", "windows", "remodeck.ico"), Buffer.from([0, 0, 1, 0]));
  gitSync(authorDir, ["add", "."]);
  gitSync(authorDir, ["commit", "-m", "add windows installer"]);
  gitSync(authorDir, ["push", "origin", "main"]);
  gitSync(appDir, ["pull", "--ff-only", "origin", "main"]);

  let relaunchCalls = 0;
  const srv = await createAgentControlServer({
    host: "127.0.0.1",
    port: 0,
    dataDir,
    disableRelay: true,
    disableTunnel: true,
    disableUpdateCheck: true,
    providers: [],
    updateServiceOptions: {
      rootDir: appDir,
      platform: "win32",
      desktopInstallDir: winInstallDir,
      initialDelayMs: 60_000,
      restartDelayMs: 10,
      execDesktopBuild: async () => {
        const pkg = JSON.parse(await readFile(resolve(appDir, "package.json"), "utf8"));
        const hash = await computeDesktopSourceHash(appDir, pkg.version);
        await mkdir(winInstallDir, { recursive: true });
        await writeFile(resolve(winInstallDir, "desktop-meta.json"), JSON.stringify({
          version: pkg.version,
          buildHash: hash,
          repoRoot: appDir,
          appPath: resolve(winInstallDir, "RemoteDeck.lnk"),
          platform: "win32",
        }), "utf8");
      },
      relaunchDesktopApp: async () => {
        relaunchCalls += 1;
      },
    },
  });
  await srv.start();
  t.after(() => srv.close());

  const silentRes = await fetch(`${srv.url}/api/update/desktop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "manual", openAfterBuild: false }),
  });
  assert.equal(silentRes.status, 200);
  const silentJson = await silentRes.json();
  assert.equal(silentJson.ok, true);
  assert.match(silentJson.message, /未自动打开/);

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(relaunchCalls, 0);

  const openRes = await fetch(`${srv.url}/api/update/desktop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason: "manual", openAfterBuild: true }),
  });
  assert.equal(openRes.status, 200);
  const openJson = await openRes.json();
  assert.equal(openJson.ok, true);
  assert.match(openJson.message, /正在打开/);

  await new Promise((r) => setTimeout(r, 40));
  assert.equal(relaunchCalls, 1);
});

test("Windows native launcher and Linux/cross-platform desktop shells maintain feature parity", async (t) => {
  const repoRoot = resolve(import.meta.dirname, "..");

  // 1. resolveDesktopLaunchSpec prefers launcherExePath before direct browserPath when .lnk is absent.
  const tmpDir = await mkdtemp(resolve(os.tmpdir(), "ac-win-exe-launch-"));
  t.after(() => rm(tmpDir, { recursive: true, force: true }));
  const exePath = resolve(tmpDir, "RemoteDeck.exe");
  const browserPath = resolve(tmpDir, "msedge.exe");
  await writeFile(exePath, "mz", "utf8");
  await writeFile(browserPath, "mz", "utf8");
  assert.deepEqual(
    resolveDesktopLaunchSpec({
      platform: "win32",
      desktopApp: {
        appPath: resolve(tmpDir, "missing.lnk"),
        launcherExePath: exePath,
        browserPath,
        browserArgs: ["--app=http://127.0.0.1:43310"],
      },
      reason: "manual",
    }),
    { command: exePath, args: [], windowsHide: false },
  );

  // 2. Windows RemoteDeckLauncher.cs stays strict C# 5.0 and implements health probe + service bootstrap.
  const csText = await readFile(resolve(repoRoot, "desktop", "windows", "RemoteDeckLauncher.cs"), "utf8");
  assert.doesNotMatch(csText, /\$"/);
  assert.doesNotMatch(csText, /\?\./);
  assert.doesNotMatch(csText, /\bout\s+var\b/);
  assert.doesNotMatch(csText, /\bnameof\s*\(/);
  assert.match(csText, /SetCurrentProcessExplicitAppUserModelID/);
  assert.match(csText, /com\.guuguo\.remodeck\.desktop/);
  assert.match(csText, /ProbeHealth/);
  assert.match(csText, /launcher\.cfg/);
  assert.match(csText, /service\.mjs/);

  // 3. Windows install-app.ps1 compiles RemoteDeckLauncher.cs with csc.exe when available and writes launcher.cfg.
  const psBytes = await readFile(resolve(repoRoot, "desktop", "windows", "install-app.ps1"));
  assert.equal(psBytes[0], 0xef);
  assert.equal(psBytes[1], 0xbb);
  assert.equal(psBytes[2], 0xbf);
  const psText = psBytes.subarray(3).toString("utf8");
  assert.match(psText, /csc\.exe/);
  assert.match(psText, /\/target:winexe/);
  assert.match(psText, /\/win32icon:/);
  assert.match(psText, /RemoteDeckLauncher\.cs/);
  assert.match(psText, /launcher\.cfg/);
  assert.match(psText, /launcherExePath/);

  // 4. Linux desktop shell has updated RemoteDeck icon, desktop Name=RemoteDeck, zoom/hard-reload/restart/plugin windows.
  const publicIconSvg = await readFile(resolve(repoRoot, "public", "icon.svg"), "utf8");
  const linuxIconSvg = await readFile(resolve(repoRoot, "desktop", "linux", "agent-control.svg"), "utf8");
  assert.equal(linuxIconSvg, publicIconSvg);

  const linuxInstaller = await readFile(resolve(repoRoot, "desktop", "linux", "install-app.sh"), "utf8");
  assert.match(linuxInstaller, /Name=RemoteDeck\\n/);

  const linuxPy = await readFile(resolve(repoRoot, "desktop", "linux", "agent-control.py"), "utf8");
  assert.match(linuxPy, /def open_plugin_window/);
  assert.match(linuxPy, /reload_bypass_cache/);
  assert.match(linuxPy, /set_zoom_level/);
  assert.match(linuxPy, /def restart_local_service/);

  // 5. Web UI provides cross-platform local file right-click menu while preserving macOS WKWebView native bridge.
  const appJs = await readFile(resolve(repoRoot, "public", "app.js"), "utf8");
  assert.match(appJs, /function openLocalFileContextMenu\(/);
  assert.match(appJs, /function localFileManagerName\(/);
  assert.match(appJs, /window\.webkit\?\.messageHandlers\?\.localFileContextMenu/);
});
