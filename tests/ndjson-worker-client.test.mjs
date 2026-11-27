import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NdjsonWorkerClient } from "../src/ndjson-worker-client.mjs";

test("NdjsonWorkerClient handles ready handshake, id-matched concurrency, timeout reset, and SIGTERM cleanup", async (t) => {
  const dir = await mkdtemp(join(os.tmpdir(), "ac-ndjson-worker-"));
  const pidFile = join(dir, "worker.pid");
  const scriptPath = join(dir, "mock-worker.mjs");

  await writeFile(scriptPath, `#!/bin/sh
exec node -e '
const fs = require("fs");
const readline = require("readline");
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
process.stdout.write(JSON.stringify({ ready: true }) + "\\n");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  const req = JSON.parse(line);
  if (req.hang) return;
  const delayMs = Number(req.delayMs) || 0;
  setTimeout(() => {
    if (req.fail) {
      process.stdout.write(JSON.stringify({ id: req.id, ok: false, error: "boom" }) + "\\n");
    } else {
      process.stdout.write(JSON.stringify({ id: req.id, ok: true, echo: req.value }) + "\\n");
    }
  }, delayMs);
});
process.on("SIGTERM", () => process.exit(0));
'
`, "utf8");
  await chmod(scriptPath, 0o755);

  let closed = false;
  const worker = new NdjsonWorkerClient({
    label: "Mock Worker",
    readyTimeoutMs: 3_000,
    defaultRequestTimeoutMs: 1_500,
    isClosed: () => closed,
    resolveLaunch: () => ({ cmd: scriptPath, args: [], env: { ...process.env } }),
  });

  t.after(async () => {
    closed = true;
    worker.reset("test teardown");
    await rm(dir, { recursive: true, force: true });
  });

  // 1. Concurrent id-matched responses settle cleanly even when arriving out of order.
  const [slowRes, fastRes] = await Promise.all([
    worker.request({ value: "slow", delayMs: 60 }, { idPrefix: "w-" }),
    worker.request({ value: "fast", delayMs: 5 }, { idPrefix: "w-" }),
  ]);
  assert.equal(slowRes.echo, "slow");
  assert.equal(fastRes.echo, "fast");
  await assert.rejects(() => worker.request({ fail: true }), /boom/);

  const firstPid = Number((await readFile(pidFile, "utf8")).trim());
  assert.ok(firstPid > 0);

  // 2. Request timeout resets the hung child and allows clean respawn afterwards.
  await assert.rejects(
    () => worker.request({ hang: true }, { timeoutMs: 250, timeoutMessage: "custom timeout" }),
    /custom timeout/,
  );

  // 3. After timeout reset, a fresh worker serves requests normally and reset() sends SIGTERM.
  const recovered = await worker.request({ value: "after-reset" });
  assert.equal(recovered.echo, "after-reset");
  const secondPid = Number((await readFile(pidFile, "utf8")).trim());
  assert.ok(secondPid > 0);

  worker.reset("done");
  await new Promise((r) => setTimeout(r, 150));
  let alive = true;
  try {
    process.kill(secondPid, 0);
  } catch {
    alive = false;
  }
  assert.equal(alive, false);
});
