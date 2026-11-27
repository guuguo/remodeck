import { createHash } from "node:crypto";
import { cp, lstat, mkdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_NAME = "remodeck-memory";
export const MANAGED_MARKER = ".remodeck-managed";
export const SKILL_CLIENTS = Object.freeze(["claude", "codex", "antigravity"]);

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SKILL_SOURCE_DIR = resolve(__dirname, "..", "skills", SKILL_NAME);

export function skillTargetPaths({ homeDir = os.homedir(), skillName = SKILL_NAME } = {}) {
  const home = resolve(homeDir || os.homedir());
  return {
    claude: join(home, ".claude", "skills", skillName),
    codex: join(home, ".codex", "skills", skillName),
    antigravity: join(home, ".gemini", "antigravity", "skills", skillName),
  };
}

function sha256(text) {
  return createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

async function readIfFile(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

async function inspectTarget(client, targetPath, sourceDir, sourceHash) {
  const parentExists = await lstat(dirname(targetPath)).then((st) => st.isDirectory()).catch(() => false);
  const st = await lstat(targetPath).catch(() => null);
  if (!st) {
    return {
      client,
      path: targetPath,
      parentExists,
      installed: false,
      managed: false,
      upToDate: false,
      conflict: false,
      mode: "none",
    };
  }
  const absSource = resolve(sourceDir);
  if (st.isSymbolicLink()) {
    const rawLink = await readlink(targetPath).catch(() => "");
    const resolvedLink = rawLink ? resolve(dirname(targetPath), rawLink) : "";
    const isSameSource = resolvedLink === absSource;
    return {
      client,
      path: targetPath,
      parentExists,
      installed: true,
      managed: isSameSource,
      upToDate: isSameSource,
      conflict: !isSameSource,
      mode: "symlink",
    };
  }
  if (st.isDirectory()) {
    const marker = await readIfFile(join(targetPath, MANAGED_MARKER));
    const managed = marker !== null;
    const targetSkill = await readIfFile(join(targetPath, "SKILL.md"));
    const upToDate = Boolean(managed && sourceHash && targetSkill !== null && sha256(targetSkill) === sourceHash);
    return {
      client,
      path: targetPath,
      parentExists,
      installed: true,
      managed,
      upToDate,
      conflict: !managed,
      mode: "copy",
    };
  }
  return {
    client,
    path: targetPath,
    parentExists,
    installed: true,
    managed: false,
    upToDate: false,
    conflict: true,
    mode: "file",
  };
}

function resolveClientsList(clients) {
  if (!clients || !clients.length) return [...SKILL_CLIENTS];
  const requested = (Array.isArray(clients) ? clients : String(clients).split(","))
    .map((c) => String(c || "").trim().toLowerCase())
    .filter(Boolean);
  const invalid = requested.filter((c) => !SKILL_CLIENTS.includes(c));
  if (invalid.length) {
    throw Object.assign(new Error(`未知客户端：${invalid.join(", ")}（支持 claude / codex / antigravity）`), { status: 400 });
  }
  return [...new Set(requested)];
}

export async function getSkillSyncStatus({
  homeDir = os.homedir(),
  sourceDir = DEFAULT_SKILL_SOURCE_DIR,
  clients = SKILL_CLIENTS,
} = {}) {
  const absSource = resolve(sourceDir);
  const sourceSkill = await readIfFile(join(absSource, "SKILL.md"));
  const sourceExists = sourceSkill !== null;
  const sourceHash = sourceExists ? sha256(sourceSkill) : "";
  const paths = skillTargetPaths({ homeDir });
  const selected = resolveClientsList(clients);
  const targets = [];
  for (const client of selected) {
    targets.push(await inspectTarget(client, paths[client], absSource, sourceHash));
  }
  return {
    skillName: SKILL_NAME,
    sourceDir: absSource,
    sourceExists,
    targets,
  };
}

export async function installSkill({
  clients = SKILL_CLIENTS,
  homeDir = os.homedir(),
  sourceDir = DEFAULT_SKILL_SOURCE_DIR,
  force = false,
  preferCopy = process.platform === "win32",
} = {}) {
  const absSource = resolve(sourceDir);
  const sourceSkill = await readIfFile(join(absSource, "SKILL.md"));
  if (sourceSkill === null) {
    throw Object.assign(new Error(`技能源目录缺少 SKILL.md：${absSource}`), { status: 404 });
  }
  const sourceHash = sha256(sourceSkill);
  const paths = skillTargetPaths({ homeDir });
  const selected = resolveClientsList(clients);
  const results = [];

  for (const client of selected) {
    const targetPath = paths[client];
    const info = await inspectTarget(client, targetPath, absSource, sourceHash);
    if (info.installed && info.upToDate) {
      results.push({ client, path: targetPath, action: "up_to_date" });
      continue;
    }
    if (info.installed && !info.managed && !force) {
      results.push({
        client,
        path: targetPath,
        action: "skipped_unmanaged",
        reason: "已存在非 RemoDeck 管理的同名技能，跳过覆盖",
      });
      continue;
    }

    await mkdir(dirname(targetPath), { recursive: true });
    if (info.installed) {
      await rm(targetPath, { recursive: true, force: true });
    }

    let mode = "symlink";
    if (!preferCopy) {
      try {
        await symlink(absSource, targetPath, "dir");
      } catch {
        mode = "copy";
      }
    } else {
      mode = "copy";
    }
    if (mode === "copy") {
      await cp(absSource, targetPath, { recursive: true });
      await writeFile(
        join(targetPath, MANAGED_MARKER),
        `${JSON.stringify({ managedBy: "remodeck", skillName: SKILL_NAME, sourceDir: absSource, installedAt: new Date().toISOString() }, null, 2)}\n`,
      );
    }
    results.push({ client, path: targetPath, action: info.installed ? "updated" : "installed", mode });
  }

  return {
    skillName: SKILL_NAME,
    sourceDir: absSource,
    results,
    status: await getSkillSyncStatus({ homeDir, sourceDir: absSource }),
  };
}

export async function uninstallSkill({
  clients = SKILL_CLIENTS,
  homeDir = os.homedir(),
  sourceDir = DEFAULT_SKILL_SOURCE_DIR,
} = {}) {
  const absSource = resolve(sourceDir);
  const paths = skillTargetPaths({ homeDir });
  const selected = resolveClientsList(clients);
  const results = [];

  for (const client of selected) {
    const targetPath = paths[client];
    const info = await inspectTarget(client, targetPath, absSource, "");
    if (!info.installed) {
      results.push({ client, path: targetPath, action: "not_installed" });
      continue;
    }
    if (!info.managed) {
      results.push({ client, path: targetPath, action: "skipped_unmanaged" });
      continue;
    }
    await rm(targetPath, { recursive: true, force: true });
    results.push({ client, path: targetPath, action: "removed" });
  }

  return {
    skillName: SKILL_NAME,
    sourceDir: absSource,
    results,
    status: await getSkillSyncStatus({ homeDir, sourceDir: absSource }),
  };
}
