import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { getSkillSyncStatus, installSkill, SKILL_NAME, uninstallSkill } from "../src/skill-sync.mjs";

test("skill-sync installs, inspects, preserves unmanaged skills, and cleanly uninstalls", async (t) => {
  const homeDir = await mkdtemp(join(os.tmpdir(), "ac-skill-home-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));

  const initial = await getSkillSyncStatus({ homeDir });
  assert.equal(initial.sourceExists, true);
  assert.equal(initial.targets.every((x) => !x.installed), true);

  // Pre-seed an unmanaged claude skill directory with the same name.
  const claudeUnmanaged = join(homeDir, ".claude", "skills", SKILL_NAME);
  await mkdir(claudeUnmanaged, { recursive: true });
  await writeFile(join(claudeUnmanaged, "SKILL.md"), "user custom skill");

  const installed = await installSkill({ homeDir });
  const byClient = new Map(installed.results.map((r) => [r.client, r]));
  assert.equal(byClient.get("claude").action, "skipped_unmanaged");
  assert.equal(byClient.get("codex").action, "installed");
  assert.equal(byClient.get("antigravity").action, "installed");
  assert.equal(await readFile(join(claudeUnmanaged, "SKILL.md"), "utf8"), "user custom skill");

  const afterStatus = await getSkillSyncStatus({ homeDir });
  const statusMap = new Map(afterStatus.targets.map((x) => [x.client, x]));
  assert.equal(statusMap.get("claude").conflict, true);
  assert.equal(statusMap.get("codex").upToDate, true);
  assert.equal(statusMap.get("antigravity").upToDate, true);

  // Uninstall removes managed targets only; unmanaged directory stays untouched.
  const removed = await uninstallSkill({ homeDir });
  const remMap = new Map(removed.results.map((r) => [r.client, r]));
  assert.equal(remMap.get("claude").action, "skipped_unmanaged");
  assert.equal(remMap.get("codex").action, "removed");
  assert.equal(remMap.get("antigravity").action, "removed");
  assert.equal(await readFile(join(claudeUnmanaged, "SKILL.md"), "utf8"), "user custom skill");
  await assert.rejects(lstat(join(homeDir, ".codex", "skills", SKILL_NAME)));
});

test("skill-sync copy mode writes managed marker and cleans up on uninstall", async (t) => {
  const homeDir = await mkdtemp(join(os.tmpdir(), "ac-skill-copy-"));
  t.after(() => rm(homeDir, { recursive: true, force: true }));

  const res = await installSkill({ homeDir, clients: ["codex"], preferCopy: true });
  assert.equal(res.results[0].mode, "copy");
  const status = await getSkillSyncStatus({ homeDir, clients: ["codex"] });
  assert.equal(status.targets[0].managed, true);
  assert.equal(status.targets[0].upToDate, true);

  const uninstalled = await uninstallSkill({ homeDir, clients: ["codex"] });
  assert.equal(uninstalled.results[0].action, "removed");
});
