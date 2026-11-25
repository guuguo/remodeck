import { spawn } from "node:child_process";
import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WINDOWS_CORE_EXEC_EXTS = [".exe", ".cmd", ".bat", ".com"];
const WINDOWS_SCRIPT_EXTS = [".mjs", ".cjs", ".js"];

/**
 * Normalize OS platform identifiers into darwin | win32 | linux.
 */
export function normalizePlatform(platform = process.platform) {
  if (platform === "win32" || platform === "darwin") return platform;
  return "linux";
}

/**
 * Pick path.win32 or path.posix explicitly for cross-platform path operations.
 */
export function pathModuleForPlatform(platform = process.platform) {
  return normalizePlatform(platform) === "win32" ? path.win32 : path.posix;
}

function isWindowsStylePath(rawPath) {
  const s = String(rawPath || "").trim();
  return /^[A-Za-z]:(?:[\\/]|$)/.test(s) || /^\\\\/.test(s);
}

/**
 * Resolve the user's home directory consistently across Windows, macOS, and Linux.
 */
export function resolveUserHome(env = process.env, platform = process.platform, fallbackHome = os.homedir()) {
  const norm = normalizePlatform(platform);
  if (norm === "win32") {
    const profile = String(env?.USERPROFILE || "").trim();
    if (profile) return profile;
    const home = String(env?.HOME || "").trim();
    if (home) return home;
    const drive = String(env?.HOMEDRIVE || "").trim();
    const homePath = String(env?.HOMEPATH || "").trim();
    if (drive && homePath) return `${drive}${homePath}`;
    return String(fallbackHome || "").trim();
  }
  const home = String(env?.HOME || "").trim();
  return home || String(fallbackHome || "").trim();
}

/**
 * Compute default machine display label for the host platform.
 */
export function defaultPlatformHostLabel(hostname = os.hostname(), platform = process.platform) {
  const clean = String(hostname || "")
    .replace(/\.local$/i, "")
    .trim();
  if (clean) return clean;
  const norm = normalizePlatform(platform);
  if (norm === "win32") return "Windows";
  if (norm === "linux") return "Linux";
  return "Mac";
}

/**
 * Resolve platform-standard Agent Control data directory.
 */
export function resolvePlatformDataDir({
  customDir,
  env = process.env,
  homeDir,
  platform = process.platform,
} = {}) {
  const norm = normalizePlatform(platform);
  const p = pathModuleForPlatform(norm);
  const custom = String(customDir ?? env?.AGENT_CONTROL_DATA_DIR ?? "").trim();
  if (custom) return p.resolve(custom);

  const home = String(homeDir || "").trim() || resolveUserHome(env, norm);
  if (norm === "darwin") {
    return p.resolve(home, "Library", "Application Support", "Agent Control");
  }
  if (norm === "win32") {
    const base = String(env?.APPDATA || env?.LOCALAPPDATA || "").trim()
      || p.join(home, "AppData", "Roaming");
    return p.resolve(base, "Agent Control");
  }
  const xdgData = String(env?.XDG_DATA_HOME || "").trim()
    || p.join(home, ".local", "share");
  return p.resolve(xdgData, "agent-control");
}

/**
 * Resolve platform-standard local apps directory under Agent Control data dir.
 */
export function resolvePlatformAppsDir(options = {}) {
  const norm = normalizePlatform(options.platform);
  const p = pathModuleForPlatform(norm);
  return p.resolve(resolvePlatformDataDir(options), "apps");
}

/**
 * Verify targetPath is equal to or strictly nested inside rootDir.
 */
export function isSubpathOrEqual(rootDir, targetPath, platform = process.platform) {
  const norm = normalizePlatform(platform);
  const p = pathModuleForPlatform(norm);
  let root = p.resolve(String(rootDir || ""));
  let target = p.resolve(String(targetPath || ""));
  if (norm === "win32") {
    root = root.toLowerCase();
    target = target.toLowerCase();
  }
  const rel = p.relative(root, target);
  if (rel === "") return true;
  if (rel === ".." || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) {
    return false;
  }
  return true;
}

/**
 * Normalize POSIX, Windows drive, and UNC workspace paths cleanly.
 */
export function normalizeWorkspacePath(cwd) {
  const raw = String(cwd || "").trim();
  if (!raw) return "";
  if (raw === "/") return "/";

  const driveRootMatch = raw.match(/^([A-Za-z]:)[\\/]*$/);
  if (driveRootMatch) {
    return `${driveRootMatch[1]}\\`;
  }

  if (isWindowsStylePath(raw)) {
    const winSlashed = raw.replace(/\//g, "\\");
    const uncRootMatch = winSlashed.match(/^(\\\\[^\\]+\\[^\\]+)\\*$/);
    if (uncRootMatch) {
      return uncRootMatch[1];
    }
    return winSlashed.replace(/\\+$/, "");
  }

  return raw.replace(/\/+$/, "") || "/";
}

/**
 * Decode file:// URIs (POSIX, Windows drive, UNC share) or plain paths into normalized workspace paths.
 */
export function decodeFileUri(rawUri) {
  const raw = String(rawUri || "").trim();
  if (!raw) return "";
  if (!raw.startsWith("file://")) {
    return normalizeWorkspacePath(raw);
  }

  try {
    const parsed = new URL(raw);
    if (parsed.hostname && parsed.hostname.toLowerCase() !== "localhost") {
      const sharePath = decodeURIComponent(parsed.pathname).replace(/\//g, "\\");
      return normalizeWorkspacePath(`\\\\${parsed.hostname}${sharePath}`);
    }
    let decodedPath = decodeURIComponent(parsed.pathname || "");
    if (/^\/[A-Za-z]:(?:\/|$)/.test(decodedPath)) {
      decodedPath = decodedPath.slice(1);
      return normalizeWorkspacePath(decodedPath);
    }
    if (decodedPath) {
      return normalizeWorkspacePath(decodedPath);
    }
  } catch {
    // Fall back to string decoding below.
  }

  try {
    return normalizeWorkspacePath(fileURLToPath(raw));
  } catch {
    let fallback = decodeURIComponent(raw.replace(/^file:\/\//, ""));
    if (/^\/[A-Za-z]:(?:\/|$)/.test(fallback)) {
      fallback = fallback.slice(1);
    }
    return normalizeWorkspacePath(fallback);
  }
}

/**
 * Check whether cwd refers to a user home directory (macOS, Linux, or Windows).
 */
export function isUserHomePath(cwd, homeDir = os.homedir()) {
  const clean = normalizeWorkspacePath(cwd);
  if (!clean) return false;
  const cleanForward = clean === "/" ? "/" : clean.replace(/\\/g, "/").replace(/\/+$/, "");

  const normHome = normalizeWorkspacePath(homeDir);
  if (normHome) {
    const homeForward = normHome === "/" ? "/" : normHome.replace(/\\/g, "/").replace(/\/+$/, "");
    if (isWindowsStylePath(clean) || isWindowsStylePath(normHome)) {
      if (cleanForward.toLowerCase() === homeForward.toLowerCase()) return true;
    } else if (cleanForward === homeForward) {
      return true;
    }
  }

  return /^(?:\/Users\/[^/]+|\/home\/[^/]+|\/root|[A-Za-z]:\/Users\/[^/]+)$/i.test(cleanForward);
}

/**
 * Read PATH (or case-insensitive Path on Windows) from env.
 */
export function getPathEnvValue(env = process.env, platform = process.platform) {
  if (!env || typeof env !== "object") return "";
  if (normalizePlatform(platform) !== "win32") {
    return String(env.PATH || "");
  }
  if (typeof env.PATH === "string" && env.PATH) return env.PATH;
  if (typeof env.Path === "string" && env.Path) return env.Path;
  for (const [key, val] of Object.entries(env)) {
    if (key.toLowerCase() === "path" && typeof val === "string" && val) {
      return val;
    }
  }
  return "";
}

/**
 * Split PATH using OS delimiter (`;` on Windows, `:` on POSIX).
 */
export function splitPathEnv(env = process.env, platform = process.platform) {
  const norm = normalizePlatform(platform);
  const raw = getPathEnvValue(env, norm);
  if (!raw) return [];
  const sep = norm === "win32" ? ";" : ":";
  return raw
    .split(sep)
    .map((part) => part.trim().replace(/^"(.*)"$/, "$1"))
    .filter(Boolean);
}

/**
 * Return ordered executable file extensions for Windows binary resolution.
 */
export function windowsExecutableExtensions(env = process.env) {
  const seen = new Set(WINDOWS_CORE_EXEC_EXTS);
  const out = [...WINDOWS_CORE_EXEC_EXTS];
  const pathext = String(env?.PATHEXT || env?.pathext || "").trim();
  if (pathext) {
    for (const part of pathext.split(";")) {
      const ext = part.trim().toLowerCase();
      if (!ext || !ext.startsWith(".")) continue;
      if (ext === ".js" || ext === ".mjs" || ext === ".cjs") continue;
      if (!seen.has(ext)) {
        seen.add(ext);
        out.push(ext);
      }
    }
  }
  return out;
}

/**
 * Check whether filePath exists and is runnable on the target platform.
 * On Windows, skips extensionless files (e.g. npm `#!/bin/sh` shims).
 */
export function isExecutableFile(filePath, {
  platform = process.platform,
  allowScript = false,
  statSyncImpl = statSync,
  accessSyncImpl = accessSync,
} = {}) {
  const target = String(filePath || "").trim();
  if (!target) return false;

  try {
    const st = statSyncImpl(target);
    if (!st?.isFile?.()) return false;
  } catch {
    return false;
  }

  const norm = normalizePlatform(platform);
  if (norm === "win32") {
    const ext = path.win32.extname(target).toLowerCase();
    if (!ext) return false;
    if (WINDOWS_CORE_EXEC_EXTS.includes(ext)) return true;
    if (allowScript && WINDOWS_SCRIPT_EXTS.includes(ext)) return true;
    return false;
  }

  try {
    accessSyncImpl(target, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveCandidateFile(candidate, { platform, env, allowScript, statSyncImpl, accessSyncImpl }) {
  const clean = String(candidate || "").trim();
  if (!clean) return null;
  if (isExecutableFile(clean, { platform, allowScript, statSyncImpl, accessSyncImpl })) {
    return clean;
  }
  const norm = normalizePlatform(platform);
  if (norm === "win32") {
    const p = pathModuleForPlatform(norm);
    if (!p.extname(clean)) {
      for (const ext of windowsExecutableExtensions(env)) {
        const withExt = `${clean}${ext}`;
        if (isExecutableFile(withExt, { platform: norm, allowScript, statSyncImpl, accessSyncImpl })) {
          return withExt;
        }
      }
    }
  }
  return null;
}

/**
 * Resolve an executable from explicit env override, standard candidate paths, or PATH.
 */
export function resolveExecutableCrossPlatform({
  envVar,
  candidates = [],
  binaryName,
  env = process.env,
  platform = process.platform,
  strictExplicit = false,
  preferPath = false,
  statSyncImpl = statSync,
  accessSyncImpl = accessSync,
} = {}) {
  const norm = normalizePlatform(platform);
  const p = pathModuleForPlatform(norm);

  const explicit = envVar ? String(env?.[envVar] || "").trim() : "";
  if (explicit) {
    const hit = resolveCandidateFile(explicit, {
      platform: norm,
      env,
      allowScript: true,
      statSyncImpl,
      accessSyncImpl,
    });
    if (hit) return hit;
    if (strictExplicit) return null;
  }

  const checkCandidates = () => {
    for (const candidate of candidates) {
      const hit = resolveCandidateFile(candidate, {
        platform: norm,
        env,
        allowScript: false,
        statSyncImpl,
        accessSyncImpl,
      });
      if (hit) return hit;
    }
    return null;
  };

  const checkPathDirs = () => {
    const bin = String(binaryName || "").trim();
    if (!bin) return null;
    const dirs = splitPathEnv(env, norm);
    if (norm === "win32") {
      const hasExt = Boolean(p.extname(bin));
      const exts = hasExt ? [""] : windowsExecutableExtensions(env);
      for (const dir of dirs) {
        for (const ext of exts) {
          const candidate = p.join(dir, `${bin}${ext}`);
          if (isExecutableFile(candidate, { platform: norm, allowScript: false, statSyncImpl, accessSyncImpl })) {
            return candidate;
          }
        }
      }
    } else {
      for (const dir of dirs) {
        const candidate = p.join(dir, bin);
        if (isExecutableFile(candidate, { platform: norm, allowScript: false, statSyncImpl, accessSyncImpl })) {
          return candidate;
        }
      }
    }
    return null;
  };

  if (preferPath) {
    return checkPathDirs() || checkCandidates() || null;
  }
  return checkCandidates() || checkPathDirs() || null;
}

/**
 * Return platform-appropriate standard install candidate paths for a CLI tool.
 */
export function providerCandidatePaths(tool, {
  env = process.env,
  homeDir,
  platform = process.platform,
} = {}) {
  const norm = normalizePlatform(platform);
  const p = pathModuleForPlatform(norm);
  const home = String(homeDir || "").trim() || resolveUserHome(env, norm);
  const pyVersions = ["313", "312", "311", "310", "39"];

  if (norm === "win32") {
    const appData = String(env?.APPDATA || "").trim() || p.join(home, "AppData", "Roaming");
    const localAppData = String(env?.LOCALAPPDATA || "").trim() || p.join(home, "AppData", "Local");
    const programFiles = String(env?.ProgramFiles || env?.PROGRAMFILES || "").trim() || "C:\\Program Files";
    const programFilesX86 = String(env?.["ProgramFiles(x86)"] || "").trim() || "C:\\Program Files (x86)";

    if (tool === "codex") {
      return [
        p.join(appData, "npm", "codex.cmd"),
        p.join(home, ".local", "bin", "codex.exe"),
        p.join(home, ".local", "bin", "codex.cmd"),
      ];
    }
    if (tool === "claude") {
      return [
        p.join(home, ".local", "bin", "claude.exe"),
        p.join(home, ".claude", "local", "claude.exe"),
        p.join(appData, "npm", "claude.cmd"),
      ];
    }
    if (tool === "antigravity") {
      return [
        p.join(localAppData, "agy", "bin", "agy.exe"),
        p.join(home, ".local", "bin", "agy.cmd"),
        p.join(home, ".local", "bin", "agy.exe"),
        p.join(localAppData, "Programs", "Antigravity", "bin", "agy.cmd"),
        p.join(localAppData, "Programs", "Antigravity", "resources", "app", "bin", "agy.cmd"),
        p.join(programFiles, "Antigravity", "resources", "app", "bin", "agy.cmd"),
        p.join(appData, "npm", "agy.cmd"),
      ];
    }
    if (tool === "grok") {
      return [
        p.join(home, ".local", "bin", "grok.exe"),
        p.join(home, ".grok", "bin", "grok.exe"),
        p.join(appData, "npm", "grok.cmd"),
      ];
    }
    if (tool === "cloudflared") {
      return [
        p.join(programFiles, "cloudflared", "cloudflared.exe"),
        p.join(programFilesX86, "cloudflared", "cloudflared.exe"),
        p.join(localAppData, "Microsoft", "WinGet", "Links", "cloudflared.exe"),
        p.join(home, "scoop", "shims", "cloudflared.exe"),
      ];
    }
    if (tool === "tailscale") {
      return [
        p.join(programFiles, "Tailscale", "tailscale.exe"),
        p.join(programFilesX86, "Tailscale", "tailscale.exe"),
        p.join(localAppData, "Microsoft", "WinGet", "Links", "tailscale.exe"),
      ];
    }
    if (tool === "edge-tts") {
      const out = [];
      for (const ver of pyVersions) {
        out.push(p.join(appData, "Python", `Python${ver}`, "Scripts", "edge-tts.exe"));
        out.push(p.join(localAppData, "Programs", "Python", `Python${ver}`, "Scripts", "edge-tts.exe"));
      }
      out.push(p.join(home, ".local", "bin", "edge-tts.exe"));
      return out;
    }
    return [];
  }

  if (norm === "darwin") {
    if (tool === "codex") {
      return [
        "/opt/homebrew/bin/codex",
        "/usr/local/bin/codex",
        p.join(home, ".local", "bin", "codex"),
      ];
    }
    if (tool === "claude") {
      return [
        "/opt/homebrew/bin/claude",
        "/usr/local/bin/claude",
        p.join(home, ".local", "bin", "claude"),
      ];
    }
    if (tool === "antigravity") {
      return [
        p.join(home, ".local", "bin", "agy"),
        "/opt/homebrew/bin/agy",
        "/usr/local/bin/agy",
        "/Applications/Antigravity.app/Contents/Resources/app/bin/agy",
      ];
    }
    if (tool === "grok") {
      return [
        p.join(home, ".local", "bin", "grok"),
        p.join(home, ".grok", "bin", "grok"),
        "/opt/homebrew/bin/grok",
        "/usr/local/bin/grok",
      ];
    }
    if (tool === "cloudflared") {
      return [
        "/opt/homebrew/bin/cloudflared",
        "/usr/local/bin/cloudflared",
        p.join(home, ".local", "bin", "cloudflared"),
        "/usr/bin/cloudflared",
      ];
    }
    if (tool === "tailscale") {
      return [
        "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
        "/opt/homebrew/bin/tailscale",
        "/usr/local/bin/tailscale",
        p.join(home, ".local", "bin", "tailscale"),
        "/usr/bin/tailscale",
      ];
    }
    if (tool === "edge-tts") {
      return [
        "/opt/homebrew/bin/edge-tts",
        "/usr/local/bin/edge-tts",
        p.join(home, ".local", "bin", "edge-tts"),
        p.join(home, "Library", "Python", "3.13", "bin", "edge-tts"),
        p.join(home, "Library", "Python", "3.12", "bin", "edge-tts"),
        p.join(home, "Library", "Python", "3.11", "bin", "edge-tts"),
        p.join(home, "Library", "Python", "3.10", "bin", "edge-tts"),
        p.join(home, "Library", "Python", "3.9", "bin", "edge-tts"),
      ];
    }
    return [];
  }

  // linux
  if (tool === "antigravity") {
    return [
      p.join(home, ".local", "bin", "agy"),
      p.join(home, ".npm-global", "bin", "agy"),
      "/usr/local/bin/agy",
      "/usr/bin/agy",
      "/usr/share/antigravity/resources/app/bin/agy",
      "/opt/Antigravity/resources/app/bin/agy",
    ];
  }
  const binName = tool;
  return [
    p.join(home, ".local", "bin", binName),
    p.join(home, ".npm-global", "bin", binName),
    `/usr/local/bin/${binName}`,
    `/usr/bin/${binName}`,
    `/snap/bin/${binName}`,
  ];
}

/**
 * Platform-specific install hint shown when cloudflared is not found.
 */
export function cloudflaredInstallHint(platform = process.platform) {
  const norm = normalizePlatform(platform);
  if (norm === "win32") {
    return "winget install --id Cloudflare.cloudflared";
  }
  if (norm === "linux") {
    return "curl -fsSL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o ~/.local/bin/cloudflared && chmod +x ~/.local/bin/cloudflared";
  }
  return "brew install cloudflared";
}

/**
 * Platform-specific install hint shown when tailscale is not found.
 */
export function tailscaleInstallHint(platform = process.platform) {
  const norm = normalizePlatform(platform);
  if (norm === "win32") {
    return "winget install --id Tailscale.Tailscale";
  }
  if (norm === "linux") {
    return "curl -fsSL https://tailscale.com/install.sh | sh";
  }
  return "brew install --cask tailscale";
}

/**
 * Extract the target JS entrypoint from an npm-generated Windows .cmd shim when present.
 */
export function tryResolveNpmCmdShimScript(cmdFilePath, {
  readFileSyncImpl = readFileSync,
  existsSyncImpl = existsSync,
} = {}) {
  const target = String(cmdFilePath || "").trim();
  if (!target || !/\.cmd$/i.test(target)) return null;

  let content = "";
  try {
    content = readFileSyncImpl(target, "utf8");
  } catch {
    return null;
  }

  const match = String(content || "").match(/"%(?:~dp0\\?|dp0%\\)([^"\r\n]+?\.(?:mjs|cjs|js))"/i);
  if (!match) return null;

  const p = isWindowsStylePath(target) ? path.win32 : path;
  const relScript = match[1].replace(/[\\/]+/g, p.sep);
  const resolvedScript = p.resolve(p.dirname(target), relScript);
  try {
    if (existsSyncImpl(resolvedScript)) return resolvedScript;
  } catch {
    return null;
  }
  return null;
}

/**
 * Safely quote a single argument for `cmd.exe /d /s /c`.
 */
export function quoteWindowsCmdArg(arg) {
  const str = String(arg ?? "");
  if (!str) return "\"\"";
  const needsQuotes = /[\s&|<>()^"%!]/.test(str);
  const escaped = str
    .replace(/"/g, "\"\"")
    .replace(/%/g, "%%");
  if (!needsQuotes) return escaped;
  return `"${escaped}"`;
}

/**
 * Rewrite child process invocations so `.cmd`/`.bat`/`.mjs`/`.js` run safely on Windows without Node 22 EINVAL.
 */
export function prepareCrossPlatformSpawn(command, args = [], options = {}, {
  platform = process.platform,
  execPath = process.execPath,
  readFileSyncImpl = readFileSync,
  existsSyncImpl = existsSync,
} = {}) {
  const norm = normalizePlatform(platform);
  const argList = Array.isArray(args) ? [...args] : [];

  if (norm !== "win32") {
    return {
      command,
      args: argList,
      options: { ...options, shell: false },
    };
  }

  const baseOptions = {
    ...options,
    shell: false,
    windowsHide: options?.windowsHide ?? true,
  };

  if (/\.(?:mjs|cjs|js)$/i.test(String(command || ""))) {
    return {
      command: execPath,
      args: [command, ...argList],
      options: baseOptions,
    };
  }

  if (/\.(?:cmd|bat)$/i.test(String(command || ""))) {
    if (/\.cmd$/i.test(String(command || ""))) {
      const shimScript = tryResolveNpmCmdShimScript(command, {
        readFileSyncImpl,
        existsSyncImpl,
      });
      if (shimScript) {
        return {
          command: execPath,
          args: [shimScript, ...argList],
          options: baseOptions,
        };
      }
    }

    const envObj = options?.env || process.env;
    const comspec = String(envObj?.ComSpec || envObj?.COMSPEC || "cmd.exe").trim() || "cmd.exe";
    const cmdLine = [quoteWindowsCmdArg(command), ...argList.map(quoteWindowsCmdArg)].join(" ");
    return {
      command: comspec,
      args: ["/d", "/s", "/c", `"${cmdLine}"`],
      options: {
        ...baseOptions,
        windowsVerbatimArguments: true,
      },
    };
  }

  return {
    command,
    args: argList,
    options: baseOptions,
  };
}

/**
 * Cross-platform spawn wrapper using prepareCrossPlatformSpawn.
 */
export function spawnCrossPlatform(command, args = [], options = {}, runtimeOpts = {}) {
  const spawnFn = runtimeOpts.spawnImpl || spawn;
  const prepared = prepareCrossPlatformSpawn(command, args, options, runtimeOpts);
  return spawnFn(prepared.command, prepared.args, prepared.options);
}

/**
 * Cross-platform Promise-based buffered command runner (safe replacement for child_process.execFile on Windows .cmd/.mjs).
 */
export function execFileCrossPlatform(command, args = [], options = {}, runtimeOpts = {}) {
  const timeoutMs = Number(options?.timeout || 0);
  const maxBuffer = Number(options?.maxBuffer || 10 * 1024 * 1024);
  const encoding = options?.encoding || "utf8";
  const spawnOptions = {
    ...options,
    stdio: options?.stdio || ["ignore", "pipe", "pipe"],
  };
  delete spawnOptions.timeout;
  delete spawnOptions.maxBuffer;
  delete spawnOptions.encoding;

  return new Promise((resolveExec, rejectExec) => {
    let child;
    try {
      child = spawnCrossPlatform(command, args, spawnOptions, runtimeOpts);
    } catch (error) {
      rejectExec(error);
      return;
    }

    const stdoutChunks = [];
    const stderrChunks = [];
    let totalBytes = 0;
    let settled = false;
    let timedOut = false;
    let timer = null;

    const finishError = (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      rejectExec(err);
    };

    const appendChunk = (targetChunks, chunk) => {
      if (settled) return;
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      totalBytes += buf.length;
      if (totalBytes > maxBuffer) {
        killProcessTreeCrossPlatform(child, { platform: runtimeOpts.platform });
        finishError(Object.assign(new Error(`stdout/stderr maxBuffer (${maxBuffer}) exceeded`), {
          code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        }));
        return;
      }
      targetChunks.push(buf);
    };

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        killProcessTreeCrossPlatform(child, { platform: runtimeOpts.platform });
      }, timeoutMs);
      timer.unref?.();
    }

    child.stdout?.on("data", (chunk) => appendChunk(stdoutChunks, chunk));
    child.stderr?.on("data", (chunk) => appendChunk(stderrChunks, chunk));

    child.on("error", (error) => {
      finishError(error);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString(encoding);
      const stderr = Buffer.concat(stderrChunks).toString(encoding);
      if (timedOut) {
        rejectExec(Object.assign(new Error(`Command timed out after ${timeoutMs}ms`), {
          killed: true,
          code: null,
          signal: signal || "SIGTERM",
          stdout,
          stderr,
        }));
        return;
      }
      if (code !== 0) {
        rejectExec(Object.assign(new Error(stderr.trim() || `Command exited with code ${code}`), {
          code,
          signal,
          stdout,
          stderr,
        }));
        return;
      }
      resolveExec({ stdout, stderr });
    });
  });
}

/**
 * Terminate a child process and its descendant tree safely across Windows and POSIX.
 */
export function killProcessTreeCrossPlatform(proc, {
  signal = "SIGTERM",
  platform = process.platform,
  spawnImpl = spawn,
} = {}) {
  if (!proc || proc.exitCode !== null) return;
  const norm = normalizePlatform(platform);
  if (norm === "win32" && proc.pid) {
    try {
      const killer = spawnImpl("taskkill", ["/PID", String(proc.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer?.on?.("error", () => {});
    } catch {
      // Ignore taskkill spawn error and fall back to proc.kill().
    }
    try {
      proc.kill();
    } catch {
      // Ignore if already exited.
    }
    return;
  }
  try {
    proc.kill(signal);
  } catch {
    // Ignore if already exited.
  }
}

/**
 * Expand a leading ~ or ~/ (~\) home prefix and normalize workspace path.
 */
export function expandHomePath(rawPath, env = process.env, platform = process.platform) {
  const raw = String(rawPath || "").trim();
  if (!raw) return "";
  const norm = normalizePlatform(platform);
  const home = resolveUserHome(env, norm);
  if (raw === "~" || /^~[\\/]*$/.test(raw)) {
    return home ? normalizeWorkspacePath(home) : "~";
  }
  if (/^~[\\/]/.test(raw)) {
    if (!home) return normalizeWorkspacePath(raw);
    const rest = raw.slice(2);
    const p = pathModuleForPlatform(norm);
    return normalizeWorkspacePath(rest ? p.join(home, rest) : home);
  }
  return normalizeWorkspacePath(raw);
}

function resolveValidInitialDirectory(rawInitialDir, { env = process.env, platform = process.platform } = {}) {
  const expanded = expandHomePath(rawInitialDir, env, platform);
  if (!expanded) return "";
  const p = pathModuleForPlatform(platform);
  let candidate = expanded;
  for (let i = 0; i < 4 && candidate; i += 1) {
    try {
      if (existsSync(candidate) && statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Ignore stat errors and walk up to parent.
    }
    const parent = p.dirname(candidate);
    if (!parent || parent === candidate) break;
    candidate = parent;
  }
  return "";
}

/**
 * Open the native OS directory picker dialog on macOS, Windows, or Linux.
 */
export async function pickNativeDirectory({
  initialDir = "",
  prompt = "选择新会话的工作目录",
  platform = process.platform,
  env = process.env,
  execImpl = execFileCrossPlatform,
} = {}) {
  const norm = normalizePlatform(platform);
  const validInitialDir = resolveValidInitialDirectory(initialDir, { env, platform: norm });
  const promptText = String(prompt || "选择新会话的工作目录");

  if (norm === "darwin") {
    const script = [
      "on run argv",
      "  set promptText to item 1 of argv",
      "  set defaultDir to \"\"",
      "  if (count of argv) > 1 then set defaultDir to item 2 of argv",
      "  activate",
      "  try",
      "    if defaultDir is not \"\" then",
      "      set chosenFolder to choose folder with prompt promptText default location (POSIX file defaultDir)",
      "    else",
      "      set chosenFolder to choose folder with prompt promptText",
      "    end if",
      "    return POSIX path of chosenFolder",
      "  on error number -128",
      "    return \"\"",
      "  end try",
      "end run",
    ].join("\n");
    const args = ["-e", script, promptText];
    if (validInitialDir) args.push(validInitialDir);
    try {
      const res = await execImpl("osascript", args, { env, timeout: 120_000 });
      const chosen = normalizeWorkspacePath(String(res?.stdout || "").trim());
      return { canceled: !chosen, path: chosen };
    } catch (err) {
      if (String(err?.stderr || err?.message || "").includes("-128")) {
        return { canceled: true, path: "" };
      }
      throw err;
    }
  }

  if (norm === "win32") {
    const psScript = [
      "Add-Type -AssemblyName System.Windows.Forms",
      "$dlg = New-Object System.Windows.Forms.FolderBrowserDialog",
      "$dlg.Description = $env:AC_PICK_PROMPT",
      "$dlg.ShowNewFolderButton = $true",
      "if ($env:AC_PICK_INITIAL_DIR -and (Test-Path -LiteralPath $env:AC_PICK_INITIAL_DIR)) {",
      "  $dlg.SelectedPath = $env:AC_PICK_INITIAL_DIR",
      "}",
      "if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {",
      "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
      "  Write-Output $dlg.SelectedPath",
      "}",
    ].join("; ");
    const res = await execImpl("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-STA",
      "-Command",
      psScript,
    ], {
      env: {
        ...env,
        AC_PICK_PROMPT: promptText,
        AC_PICK_INITIAL_DIR: validInitialDir,
      },
      timeout: 120_000,
      windowsHide: true,
    });
    const chosen = normalizeWorkspacePath(String(res?.stdout || "").trim());
    return { canceled: !chosen, path: chosen };
  }

  const zenityArgs = [
    "--file-selection",
    "--directory",
    `--title=${promptText}`,
  ];
  if (validInitialDir) {
    zenityArgs.push(`--filename=${validInitialDir.endsWith("/") ? validInitialDir : `${validInitialDir}/`}`);
  }
  try {
    const res = await execImpl("zenity", zenityArgs, { env, timeout: 120_000 });
    const chosen = normalizeWorkspacePath(String(res?.stdout || "").trim());
    return { canceled: !chosen, path: chosen };
  } catch (err) {
    if (Number(err?.code) === 1) {
      return { canceled: true, path: "" };
    }
    if (err?.code !== "ENOENT") {
      throw err;
    }
  }

  try {
    const res = await execImpl("kdialog", [
      "--getexistingdirectory",
      validInitialDir || resolveUserHome(env, norm) || "/",
      "--title",
      promptText,
    ], { env, timeout: 120_000 });
    const chosen = normalizeWorkspacePath(String(res?.stdout || "").trim());
    return { canceled: !chosen, path: chosen };
  } catch (err) {
    if (Number(err?.code) === 1) {
      return { canceled: true, path: "" };
    }
    if (err?.code === "ENOENT") {
      throw new Error("当前桌面环境缺少文件夹选择工具（zenity 或 kdialog），请直接输入目录路径");
    }
    throw err;
  }
}
