#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import { resolve } from "node:path";

function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function usage() {
  console.error(
    [
      "Usage:",
      '  node scripts/ac-verify.mjs --title "验证码" [--subtitle "..."] [--image /path.png] [--refresh-url http://127.0.0.1:...] [--fields-json "[...]"] [--meta-json "{}"] [--ttl 120] [--url http://127.0.0.1:43310]',
    ].join("\n"),
  );
}

function normalizeImageToDataUrl(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text.startsWith("data:image/")) return text;
  const clean = text.replace(/\s+/g, "");
  let mime = "image/png";
  if (clean.startsWith("R0lGOD")) mime = "image/gif";
  else if (clean.startsWith("/9j/")) mime = "image/jpeg";
  else if (clean.startsWith("UklGR")) mime = "image/webp";
  return `data:${mime};base64,${clean}`;
}

function postJsonLongPoll(rawUrl, bodyObj) {
  return new Promise((resolveReq, rejectReq) => {
    const parsed = new URL(rawUrl);
    const payload = JSON.stringify(bodyObj ?? {});
    const lib = parsed.protocol === "https:" ? https : http;
    const req = lib.request(
      parsed,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 0,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            return rejectReq(new Error(`HTTP ${res.statusCode} 非 JSON: ${text.slice(0, 200)}`));
          }
          if ((res.statusCode || 500) >= 400) {
            return rejectReq(new Error(data?.error?.message || data?.message || `HTTP ${res.statusCode}`));
          }
          resolveReq(data);
        });
      },
    );
    req.setTimeout(0);
    req.on("error", rejectReq);
    req.write(payload);
    req.end();
  });
}

async function runGenericMode(flags, acUrl) {
  const payload = {
    title: flags.title ? String(flags.title) : "需要人工动态验证",
    subtitle: flags.subtitle ? String(flags.subtitle) : "",
    source: flags.source ? String(flags.source) : "Agent",
    kind: flags.kind ? String(flags.kind) : "captcha",
    ttlMs: flags.ttl ? Math.round(Number(flags.ttl) * 1000) : 120_000,
    wait: true,
  };
  if (flags.image && flags.image !== true) {
    const buf = await readFile(resolve(String(flags.image)));
    payload.imageDataUrl = normalizeImageToDataUrl(buf.toString("base64"));
  }
  if (flags["refresh-url"] && flags["refresh-url"] !== true) {
    payload.refreshUrl = String(flags["refresh-url"]);
  }
  if (flags["fields-json"] && flags["fields-json"] !== true) {
    payload.fields = JSON.parse(String(flags["fields-json"]));
  }
  if (flags["meta-json"] && flags["meta-json"] !== true) {
    payload.meta = JSON.parse(String(flags["meta-json"]));
  }

  const result = await postJsonLongPoll(`${acUrl}/api/human-verify`, payload);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(result?.ok ? 0 : 1);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help || flags.h) {
    usage();
    process.exit(0);
  }
  const acUrl = String(flags.url || process.env.AGENT_CONTROL_URL || "http://127.0.0.1:43310").replace(/\/+$/, "");
  await runGenericMode(flags, acUrl);
}

main().catch((err) => {
  process.stderr.write(`${err?.message || String(err)}\n`);
  process.exit(1);
});
