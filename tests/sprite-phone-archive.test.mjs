import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SpritePhoneArchive } from "../src/sprite-phone-archive.mjs";

test("SpritePhoneArchive logs structured events, saves user/AI audio, and prunes only recordings older than 24h", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "ac-phone-archive-"));
  try {
    const archive = new SpritePhoneArchive({ dataDir, retentionHours: 12 }); // clamped to at least 24h
    const nowMs = Date.UTC(2026, 10, 26, 12, 0, 0);

    await archive.logEvent({
      stage: "asr",
      event: "asr_done",
      callId: "spcall-1",
      turnId: "spturn-1",
      asrMs: 142,
      heardText: "今天园子里有什么要盯的",
    });
    const logRaw = await readFile(archive.logPath, "utf8");
    const logEntry = JSON.parse(logRaw.trim());
    assert.equal(logEntry.stage, "asr");
    assert.equal(logEntry.asrMs, 142);
    assert.equal(logEntry.heardText, "今天园子里有什么要盯的");

    const userBytes = Buffer.from("RIFFuser-wav-data");
    const aiBytes = Buffer.from("ID3ai-mp3-data");
    const userSaved = await archive.saveAudio({
      callId: "spcall-1",
      turnId: "spturn-1",
      role: "user",
      audioBase64: userBytes.toString("base64"),
      mimeType: "audio/wav",
      nowMs,
    });
    const aiSaved = await archive.saveAudio({
      callId: "spcall-1",
      turnId: "spturn-1",
      role: "ai",
      index: 0,
      audioBase64: aiBytes.toString("base64"),
      mimeType: "audio/mp3",
      nowMs,
    });

    assert.ok(userSaved?.path.endsWith(".wav"));
    assert.ok(aiSaved?.path.endsWith("-ai-0.mp3"));
    assert.deepEqual(await readFile(userSaved.path), userBytes);
    assert.deepEqual(await readFile(aiSaved.path), aiBytes);

    // 23 hours later: both files must still be retained
    const mtimeUser = new Date(nowMs - 23 * 3600_000);
    await utimes(userSaved.path, mtimeUser, mtimeUser);
    // 25 hours earlier: AI file is expired
    const mtimeExpired = new Date(nowMs - 25 * 3600_000);
    await utimes(aiSaved.path, mtimeExpired, mtimeExpired);

    const pruneRes = await archive.cleanupExpiredRecordings({ nowMs });
    assert.equal(pruneRes.deletedFiles, 1);

    // User audio (23h old) still exists; AI audio (25h old) is gone
    assert.ok(await stat(userSaved.path));
    await assert.rejects(() => stat(aiSaved.path));

    archive.close();
  } finally {
    await rm(dataDir, { recursive: true, force: true });
  }
});
