import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  cloudflaredInstallHint,
  decodeFileUri,
  defaultPlatformHostLabel,
  isExecutableFile,
  isSubpathOrEqual,
  isUserHomePath,
  normalizeWorkspacePath,
  prepareCrossPlatformSpawn,
  providerCandidatePaths,
  resolveExecutableCrossPlatform,
  resolvePlatformAppsDir,
  resolvePlatformDataDir,
  splitPathEnv,
} from "../src/platform.mjs";
import { decodeWorkspaceUri } from "../src/providers/antigravity-history.mjs";
import { resolveAgyAcpLaunch } from "../src/providers/antigravity-acp-client.mjs";
import { decodeSlugFallback } from "../src/providers/claude-history.mjs";
import { QuickTunnelManager } from "../src/quick-tunnel.mjs";
import {
  encodeWindowsVbsBuffer,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsRunScripts,
} from "../scripts/service.mjs";

test("resolvePlatformDataDir, resolvePlatformAppsDir, and defaultPlatformHostLabel follow OS conventions", () => {
  assert.equal(
    resolvePlatformDataDir({ platform: "darwin", homeDir: "/Users/alice", env: {} }),
    "/Users/alice/Library/Application Support/Agent Control",
  );
  assert.equal(
    resolvePlatformDataDir({
      platform: "win32",
      homeDir: "C:\\Users\\Alice",
      env: { APPDATA: "C:\\Users\\Alice\\AppData\\Roaming" },
    }),
    "C:\\Users\\Alice\\AppData\\Roaming\\Agent Control",
  );
  assert.equal(
    resolvePlatformDataDir({
      platform: "win32",
      homeDir: "C:\\Users\\Alice",
      env: {},
    }),
    "C:\\Users\\Alice\\AppData\\Roaming\\Agent Control",
  );
  assert.equal(
    resolvePlatformDataDir({
      platform: "linux",
      homeDir: "/home/alice",
      env: { XDG_DATA_HOME: "/home/alice/.xdg-data" },
    }),
    "/home/alice/.xdg-data/agent-control",
  );
  assert.equal(
    resolvePlatformDataDir({ platform: "linux", homeDir: "/home/alice", env: {} }),
    "/home/alice/.local/share/agent-control",
  );
  assert.equal(
    resolvePlatformAppsDir({ platform: "win32", env: { APPDATA: "D:\\Data" } }),
    "D:\\Data\\Agent Control\\apps",
  );
  assert.equal(
    resolvePlatformDataDir({ customDir: "E:\\CustomControl", platform: "win32" }),
    "E:\\CustomControl",
  );

  assert.equal(defaultPlatformHostLabel("my-mac.local", "darwin"), "my-mac");
  assert.equal(defaultPlatformHostLabel("", "darwin"), "Mac");
  assert.equal(defaultPlatformHostLabel("", "win32"), "Windows");
  assert.equal(defaultPlatformHostLabel("", "linux"), "Linux");
});

test("isSubpathOrEqual prevents traversal and handles Windows case/drive isolation", () => {
  assert.equal(isSubpathOrEqual("C:\\srv\\public", "C:\\srv\\public\\index.html", "win32"), true);
  assert.equal(isSubpathOrEqual("C:\\srv\\public", "c:\\SRV\\PUBLIC\\assets\\app.js", "win32"), true);
  assert.equal(isSubpathOrEqual("C:\\srv\\public", "C:\\srv\\public", "win32"), true);
  assert.equal(isSubpathOrEqual("C:\\srv\\public", "C:\\srv\\public\\..\\secret.json", "win32"), false);
  assert.equal(isSubpathOrEqual("C:\\srv\\public", "D:\\srv\\public\\index.html", "win32"), false);

  assert.equal(isSubpathOrEqual("/srv/public", "/srv/public/app.js", "linux"), true);
  assert.equal(isSubpathOrEqual("/srv/public", "/srv/public/..foo", "linux"), true);
  assert.equal(isSubpathOrEqual("/srv/public", "/srv/public/../etc/passwd", "linux"), false);
  assert.equal(isSubpathOrEqual("/srv/public", "/srv/public-other/a.js", "linux"), false);
});

test("splitPathEnv and resolveExecutableCrossPlatform handle Windows ; delimiter and skip extensionless shims", () => {
  const winEnv = {
    Path: "\"C:\\Program Files\\nodejs\";C:\\Users\\Alice\\AppData\\Roaming\\npm;",
  };
  assert.deepEqual(splitPathEnv(winEnv, "win32"), [
    "C:\\Program Files\\nodejs",
    "C:\\Users\\Alice\\AppData\\Roaming\\npm",
  ]);
  assert.deepEqual(splitPathEnv({ PATH: "/usr/local/bin:/opt/homebrew/bin:" }, "darwin"), [
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ]);

  const fakeFiles = new Set([
    "C:\\Users\\Alice\\AppData\\Roaming\\npm\\codex",
    "C:\\Users\\Alice\\AppData\\Roaming\\npm\\codex.cmd",
    "C:\\Tools\\cloudflared.exe",
    "D:\\Mocks\\mock-cli.mjs",
  ]);
  const statSyncImpl = (p) => {
    if (fakeFiles.has(p)) return { isFile: () => true };
    throw new Error("ENOENT");
  };

  assert.equal(
    isExecutableFile("C:\\Users\\Alice\\AppData\\Roaming\\npm\\codex", { platform: "win32", statSyncImpl }),
    false,
  );
  assert.equal(
    isExecutableFile("C:\\Users\\Alice\\AppData\\Roaming\\npm\\codex.cmd", { platform: "win32", statSyncImpl }),
    true,
  );
  assert.equal(
    isExecutableFile("D:\\Mocks\\mock-cli.mjs", { platform: "win32", allowScript: true, statSyncImpl }),
    true,
  );

  assert.equal(
    resolveExecutableCrossPlatform({
      envVar: "CODEX_BIN",
      binaryName: "codex",
      env: { Path: "C:\\Users\\Alice\\AppData\\Roaming\\npm" },
      platform: "win32",
      statSyncImpl,
    }),
    "C:\\Users\\Alice\\AppData\\Roaming\\npm\\codex.cmd",
  );

  assert.equal(
    resolveExecutableCrossPlatform({
      envVar: "CLOUDFLARED_BIN",
      binaryName: "cloudflared",
      env: { CLOUDFLARED_BIN: "C:\\missing\\cloudflared.exe", Path: "C:\\Tools" },
      platform: "win32",
      strictExplicit: true,
      statSyncImpl,
    }),
    null,
  );

  assert.equal(
    resolveExecutableCrossPlatform({
      envVar: "CODEX_BIN",
      binaryName: "codex",
      env: { CODEX_BIN: "D:\\Mocks\\mock-cli.mjs" },
      platform: "win32",
      strictExplicit: true,
      statSyncImpl,
    }),
    "D:\\Mocks\\mock-cli.mjs",
  );

  const winCandidates = providerCandidatePaths("codex", {
    platform: "win32",
    homeDir: "C:\\Users\\Alice",
    env: { APPDATA: "C:\\Users\\Alice\\AppData\\Roaming" },
  });
  assert.equal(winCandidates.includes("C:\\Users\\Alice\\AppData\\Roaming\\npm\\codex.cmd"), true);
});

test("prepareCrossPlatformSpawn unwraps npm .cmd shims, runs .mjs via node, and quotes .bat via cmd.exe on Windows", async () => {
  const tempDir = await mkdtemp(join(os.tmpdir(), "ac-platform-test-"));
  try {
    const jsEntry = join(tempDir, "node_modules", "pkg", "bin", "cli.js");
    await mkdir(join(tempDir, "node_modules", "pkg", "bin"), { recursive: true });
    await writeFile(jsEntry, "console.log('ok');\n", "utf8");

    const cmdShim = join(tempDir, "codex.cmd");
    await writeFile(
      cmdShim,
      `@ECHO off\r\n"%_prog%"  "%dp0%\\node_modules\\pkg\\bin\\cli.js" %*\r\n`,
      "utf8",
    );

    const preparedShim = prepareCrossPlatformSpawn(
      cmdShim,
      ["app-server", "--stdio"],
      { env: { TEST_ENV: "1" } },
      { platform: "win32", execPath: "C:\\Program Files\\nodejs\\node.exe" },
    );
    assert.equal(preparedShim.command, "C:\\Program Files\\nodejs\\node.exe");
    assert.deepEqual(preparedShim.args, [jsEntry, "app-server", "--stdio"]);
    assert.equal(preparedShim.options.shell, false);
    assert.equal(preparedShim.options.windowsHide, true);

    const preparedMjs = prepareCrossPlatformSpawn(
      "D:\\repo\\tests\\helpers\\mock-codex-cli.mjs",
      ["--stdio"],
      {},
      { platform: "win32", execPath: "C:\\node\\node.exe" },
    );
    assert.equal(preparedMjs.command, "C:\\node\\node.exe");
    assert.deepEqual(preparedMjs.args, ["D:\\repo\\tests\\helpers\\mock-codex-cli.mjs", "--stdio"]);

    const preparedBat = prepareCrossPlatformSpawn(
      "C:\\Tools\\custom wrapper.bat",
      ["--url", "http://127.0.0.1:43310", "%PATH%"],
      { env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" } },
      { platform: "win32" },
    );
    assert.equal(preparedBat.command, "C:\\Windows\\System32\\cmd.exe");
    assert.equal(preparedBat.options.windowsVerbatimArguments, true);
    assert.equal(preparedBat.options.windowsHide, true);
    assert.deepEqual(preparedBat.args.slice(0, 3), ["/d", "/s", "/c"]);
    assert.match(preparedBat.args[3], /^""C:\\Tools\\custom wrapper\.bat" --url http:\/\/127\.0\.0\.1:43310 "%%PATH%%""$/);

    const preparedPosix = prepareCrossPlatformSpawn(
      "/usr/local/bin/codex",
      ["app-server"],
      { cwd: "/tmp" },
      { platform: "linux" },
    );
    assert.equal(preparedPosix.command, "/usr/local/bin/codex");
    assert.deepEqual(preparedPosix.args, ["app-server"]);
    assert.equal(preparedPosix.options.shell, false);
    assert.equal("windowsHide" in preparedPosix.options, false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("decodeFileUri, decodeWorkspaceUri, resolveAgyAcpLaunch, and decodeSlugFallback handle Windows & Linux paths", () => {
  assert.equal(decodeFileUri("file:///C:/Users/Alice/agent-control/"), "C:\\Users\\Alice\\agent-control");
  assert.equal(decodeFileUri("file:///c%3A/dev/my%20app"), "c:\\dev\\my app");
  assert.equal(decodeFileUri("file://nas/share/repo/"), "\\\\nas\\share\\repo");
  assert.equal(normalizeWorkspacePath("C:\\"), "C:\\");
  assert.equal(normalizeWorkspacePath("D:"), "D:\\");

  assert.equal(isUserHomePath("C:\\Users\\Alice", "C:\\Users\\Alice"), true);
  assert.equal(
    decodeWorkspaceUri(
      JSON.stringify(["file:///C:/Users/Alice", "file:///D:/work/agent-control"]),
      { homeDir: "C:\\Users\\Alice" },
    ),
    "D:\\work\\agent-control",
  );

  const sameDriveAgy = resolveAgyAcpLaunch({
    appDataDir: "C:\\Users\\Alice\\.gemini\\antigravity-cli",
    homeDir: "C:\\Users\\Alice",
    platform: "win32",
    env: { USERPROFILE: "C:\\Users\\Alice" },
  });
  assert.deepEqual(sameDriveAgy.args, ["acp", "--stdio", "--app-data-dir", "antigravity-cli"]);
  assert.equal(sameDriveAgy.cwd, "C:\\Users\\Alice");

  const crossDriveAgy = resolveAgyAcpLaunch({
    appDataDir: "D:\\Profiles\\agy-work",
    homeDir: "C:\\Users\\Alice",
    platform: "win32",
    env: { USERPROFILE: "C:\\Users\\Alice", HOME: "C:\\Users\\Alice" },
  });
  assert.deepEqual(crossDriveAgy.args, ["acp", "--stdio", "--gemini-dir", "Profiles", "--app-data-dir", "agy-work"]);
  assert.equal(crossDriveAgy.cwd, "D:\\");
  assert.equal(crossDriveAgy.env.HOME, "D:\\");
  assert.equal(crossDriveAgy.env.USERPROFILE, "D:\\");

  assert.equal(decodeSlugFallback("C--Users-Alice-agent-control"), "C:\\Users\\Alice\\agent\\control");
  assert.equal(decodeSlugFallback("-home-alice-repo"), "/home/alice/repo");
});

test("cloudflaredInstallHint and QuickTunnelManager reflect darwin, win32, and linux hints", () => {
  assert.equal(cloudflaredInstallHint("darwin"), "brew install cloudflared");
  assert.equal(cloudflaredInstallHint("win32"), "winget install --id Cloudflare.cloudflared");
  assert.match(cloudflaredInstallHint("linux"), /cloudflared-linux-amd64/);

  const winTunnel = new QuickTunnelManager({
    platform: "win32",
    env: { CLOUDFLARED_BIN: "C:\\nonexistent\\cloudflared.exe" },
  });
  const linuxTunnel = new QuickTunnelManager({
    platform: "linux",
    env: { CLOUDFLARED_BIN: "/nonexistent/cloudflared" },
  });
  assert.equal(winTunnel.statusSnapshot().installHint, "winget install --id Cloudflare.cloudflared");
  assert.match(linuxTunnel.statusSnapshot().installHint, /cloudflared-linux-amd64/);
});

test("service renderers emit valid launchd, systemd, and Windows runner artifacts", () => {
  const plist = renderLaunchdPlist({
    nodeBin: "/usr/local/bin/node",
    rootDir: "/Users/alice/agent-control",
    serverEntry: "/Users/alice/agent-control/src/server.mjs",
    dataDir: "/Users/alice/Library/Application Support/Agent Control",
    homeDir: "/Users/alice",
  });
  assert.match(plist, /com\.guuguo\.agent-control/);
  assert.match(plist, /43310/);

  const unit = renderSystemdUnit({
    nodeBin: "/usr/bin/node",
    rootDir: "/home/alice/agent control",
    serverEntry: "/home/alice/agent control/src/server.mjs",
    dataDir: "/home/alice/.local/share/agent-control",
  });
  assert.match(unit, /ExecStart="\/usr\/bin\/node" "\/home\/alice\/agent control\/src\/server\.mjs"/);
  assert.match(unit, /WantedBy=default\.target/);

  const winScripts = renderWindowsRunScripts({
    nodeBin: "C:\\Program Files\\nodejs\\node.exe",
    rootDir: "D:\\dev\\agent-control",
    serverEntry: "D:\\dev\\agent-control\\src\\server.mjs",
    dataDir: "C:\\Users\\张三\\AppData\\Roaming\\Agent Control",
  });
  assert.match(winScripts.cmdContent, /^@echo off\r\nchcp 65001 >nul\r\n/);
  assert.match(winScripts.cmdContent, /set "PORT=43310"/);
  assert.match(winScripts.cmdContent, /set "PYTHONUTF8=1"/);
  assert.match(winScripts.cmdContent, /cd \/d "D:\\dev\\agent-control"/);
  assert.match(winScripts.vbsContent, /WScript\.Shell/);
  const vbsBuf = encodeWindowsVbsBuffer(winScripts.vbsContent);
  assert.equal(vbsBuf[0], 0xff);
  assert.equal(vbsBuf[1], 0xfe);
  assert.equal(vbsBuf.subarray(2).toString("utf16le"), winScripts.vbsContent);

  const legacyNodeWin = renderWindowsRunScripts({
    nodeBin: "C:\\Program Files\\nodejs\\node.exe",
    rootDir: "D:\\dev\\agent-control",
    serverEntry: "D:\\dev\\agent-control\\src\\server.mjs",
    dataDir: "C:\\Users\\Admin\\AppData\\Roaming\\Agent Control",
    nodeVersion: "22.9.0",
  });
  assert.match(legacyNodeWin.cmdContent, /"--experimental-sqlite" "D:\\dev\\agent-control\\src\\server\.mjs"/);
});

test("prepareCrossPlatformSpawn hides console windows for git and sqlite3 on Windows", () => {
  const gitLaunch = prepareCrossPlatformSpawn("git", ["-C", "E:\\repo", "status"], { timeout: 2500 }, { platform: "win32" });
  assert.equal(gitLaunch.command, "git");
  assert.equal(gitLaunch.options.windowsHide, true);
  assert.equal(gitLaunch.options.shell, false);

  const sqliteLaunch = prepareCrossPlatformSpawn("sqlite3", ["-readonly", "-json", "db.sqlite"], { timeout: 2000 }, { platform: "win32" });
  assert.equal(sqliteLaunch.command, "sqlite3");
  assert.equal(sqliteLaunch.options.windowsHide, true);
  assert.equal(sqliteLaunch.options.shell, false);
});

test("background execFile/spawn callers enforce windowsHide on Windows", async () => {
  const repoRoot = join(import.meta.dirname, "..");
  for (const relPath of [
    "src/mission-overview-service.mjs",
    "src/quota-service.mjs",
    "src/providers/profile-discovery.mjs",
    "src/providers/codex-provider.mjs",
  ]) {
    const src = await readFile(join(repoRoot, relPath), "utf8");
    assert.doesNotMatch(src, /promisify\(execFile\)/, `${relPath} must not use raw promisify(execFile)`);
    assert.match(src, /execFileCrossPlatform/, `${relPath} must use execFileCrossPlatform`);
  }

  const voiceSrc = await readFile(join(repoRoot, "src/voice-call-service.mjs"), "utf8");
  assert.doesNotMatch(voiceSrc, /\bspawn\(/, "voice-call-service should delegate worker spawning to NdjsonWorkerClient");
  assert.match(voiceSrc, /NdjsonWorkerClient/, "voice-call-service must use NdjsonWorkerClient");

  const workerSrc = await readFile(join(repoRoot, "src/ndjson-worker-client.mjs"), "utf8");
  const spawnBlocks = workerSrc.match(/child\s*=\s*this\.#spawnImpl\([\s\S]*?\}\);/g) || [];
  assert.equal(spawnBlocks.length, 1);
  for (const block of spawnBlocks) {
    assert.match(block, /windowsHide:\s*true/, "NdjsonWorkerClient spawn call must set windowsHide: true");
  }
});
