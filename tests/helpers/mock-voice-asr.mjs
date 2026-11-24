#!/usr/bin/env node
import { statSync } from "node:fs";
import readline from "node:readline";

process.stdout.write(`${JSON.stringify({ ready: true, modelDir: "mock-whisper" })}\n`);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch {
    return;
  }
  const id = String(req?.id || "");
  try {
    const audioPath = String(req?.audioPath || "");
    const st = statSync(audioPath);
    if (!st.isFile() || st.size <= 0) {
      throw new Error("missing audio");
    }
    const text = process.env.MOCK_VOICE_ASR_ECHO_PROMPT === "1"
      ? `PROMPT:${String(req?.prompt || "")}`
      : String(process.env.MOCK_VOICE_ASR_TEXT || "让 粉丝站小屋 跑一下测试").trim();
    process.stdout.write(`${JSON.stringify({
      id,
      ok: true,
      text,
      engine: "mock-whisper",
      durationMs: 4,
    })}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      id,
      ok: false,
      error: error?.message || "mock asr failed",
    })}\n`);
  }
});
