import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { ClaudeProvider } from "../src/providers/claude-provider.mjs";
import { discoverClaudeProfiles, discoverCodexProfiles } from "../src/providers/profile-discovery.mjs";
import { extractClaudeRateLimitWindows, parseClaudeErrorResetSec, QuotaService, statusToneFromPercent } from "../src/quota-service.mjs";

function seedCockpitSqlite(sqlitePath, rows = []) {
  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec(`
      CREATE TABLE summaries (
        source TEXT,
        position INTEGER,
        account_id TEXT,
        email TEXT,
        name TEXT,
        created_at INTEGER,
        last_used INTEGER,
        plan_type TEXT,
        subscription_active_until TEXT,
        provider_login TEXT,
        provider_user_id TEXT,
        payload TEXT
      );
    `);
    const stmt = db.prepare(`
      INSERT INTO summaries (account_id, email, name, plan_type, payload)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const row of rows) {
      stmt.run(
        row.account_id || "acc-1",
        row.email || "",
        row.name || "",
        row.plan_type || "",
        row.payload || '{"secret_token":"MUST_NOT_LEAK"}',
      );
    }
  } finally {
    db.close();
  }
}

test("QuotaService classifies 5h/weekly windows, Codex rateLimitsByLimitId, and Claude dual buckets", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ac-quota-win-"));
  try {
    const claudeHome = join(root, "claude");
    const claudeProj = join(claudeHome, "projects", "-tmp-proj");
    await mkdir(claudeProj, { recursive: true });
    const nowIso = new Date().toISOString();
    await writeFile(
      join(claudeProj, "s1.jsonl"),
      [
        JSON.stringify({
          type: "system",
          subtype: "quota_limit",
          timestamp: nowIso,
          quotaLimits: { seven_day: { utilization: 0.35, resetsAt: Math.floor(Date.now() / 1000) + 86400 } },
        }),
        JSON.stringify({
          type: "assistant",
          timestamp: nowIso,
          message: { usage: { output_tokens: 420 }, content: [{ type: "text", text: "ok" }] },
        }),
      ].join("\n") + "\n",
      "utf8",
    );

    const fakeCodexProvider = {
      id: "codex",
      readRateLimits: async () => ({
        rateLimitsByLimitId: {
          codex: {
            primary: { windowDurationMins: 300, usedPercent: 18, resetsAt: Math.floor(Date.now() / 1000) + 3600 },
            secondary: { windowDurationMins: 10080, usedPercent: 33, resetsAt: Math.floor(Date.now() / 1000) + 86400 },
            credits: { balance: "12500", hasCredits: true, unlimited: false },
          },
        },
      }),
    };

    const svc = new QuotaService({
      homeDir: root,
      cockpitSqlitePath: join(root, "missing.sqlite"),
      codexQuotaReader: async () => fakeCodexProvider.readRateLimits(),
    });
    const res = await svc.collectAll([
      { provider: "codex", id: "default", key: "codex:default", installed: true, home: join(root, "codex") },
      { provider: "claude", id: "default", key: "claude:default", installed: true, home: claudeHome },
    ], { refresh: true });

    const codexQ = res.byKey["codex:default"];
    assert.ok(codexQ.windows?.fiveHour);
    assert.equal(codexQ.windows.fiveHour.remainingPercent, 82);
    assert.ok(codexQ.windows?.weekly);
    assert.equal(codexQ.windows.weekly.remainingPercent, 67);
    assert.equal(String(codexQ.credits?.balance), "12500");

    const claudeQ = res.byKey["claude:default"];
    assert.ok(claudeQ.buckets.some((b) => b.id === "five_hour"));
    assert.ok(claudeQ.buckets.some((b) => b.id === "seven_day"));
    assert.ok(claudeQ.windows?.fiveHour);
    assert.ok(claudeQ.windows?.weekly);
    assert.equal(claudeQ.windows.weekly.remainingPercent, 65);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("statusToneFromPercent classifies thresholds cleanly", () => {
  assert.equal(statusToneFromPercent(null), "unknown");
  assert.equal(statusToneFromPercent(0), "exhausted");
  assert.equal(statusToneFromPercent(10), "warn");
  assert.equal(statusToneFromPercent(19), "warn");
  assert.equal(statusToneFromPercent(20), "ok");
  assert.equal(statusToneFromPercent(100), "ok");
});

test("QuotaService aggregates Antigravity, Codex, Claude, and Grok safely with caching and refresh", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-quota-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const homeDir = resolve(root, "home");
  const cockpitDir = resolve(root, "cockpit");
  const grokAppDir = resolve(root, "grok-app");
  const agyCacheDir = resolve(cockpitDir, "cache", "quota_api_v1_desktop", "authorized");
  const codexHome = resolve(homeDir, ".codex");
  const codexSessions = resolve(codexHome, "sessions", "2026", "11", "15");
  const claudeHome = resolve(homeDir, ".claude");
  const claudeProjects = resolve(claudeHome, "projects", "-tmp-proj");
  const grokAuthedHome = resolve(homeDir, "grok-authed");
  const grokDefaultHome = resolve(homeDir, ".grok");

  await Promise.all([
    mkdir(agyCacheDir, { recursive: true }),
    mkdir(codexSessions, { recursive: true }),
    mkdir(claudeProjects, { recursive: true }),
    mkdir(grokAppDir, { recursive: true }),
    mkdir(resolve(grokAuthedHome, "sessions", "proj", "s1"), { recursive: true }),
    mkdir(grokDefaultHome, { recursive: true }),
  ]);

  const nowMs = Date.now() + 10_000;
  const nowSec = Math.floor(nowMs / 1000);

  seedCockpitSqlite(join(cockpitDir, "antigravity_accounts.sqlite"), [
    { account_id: "agy-1", email: "agy@example.com", plan_type: "pro" },
  ]);
  seedCockpitSqlite(join(cockpitDir, "codex_accounts.sqlite"), [
    { account_id: "codex-1", email: "codex@example.com", plan_type: "prolite" },
  ]);
  seedCockpitSqlite(join(cockpitDir, "grok_accounts.sqlite"), [
    { account_id: "grok-1", email: "grok@example.com", plan_type: "GrokPro" },
  ]);

  await writeFile(join(agyCacheDir, "acc.json"), JSON.stringify({
    email: "agy@example.com",
    updatedAt: nowSec - 60,
    payload: {
      quota_summary: {
        groups: [
          {
            buckets: [
              { bucketId: "gemini-5h", remainingFraction: 0.72, resetTime: nowSec + 3600 },
              { bucketId: "gemini-weekly", remainingFraction: 0.1, resetTime: nowSec - 10 },
              { bucketId: "3p-5h", remainingFraction: 0.95, resetTime: nowSec + 7200 },
            ],
          },
        ],
      },
    },
  }));

  await writeFile(join(codexSessions, "rollout-1.jsonl"), JSON.stringify({
    timestamp: new Date(nowMs - 5000).toISOString(),
    payload: {
      rate_limits: {
        plan_type: "pro",
        primary: { used_percent: 25, window_minutes: 300, resets_at: nowSec + 1800 },
        secondary: { used_percent: 5, window_minutes: 10080, resets_at: nowSec + 86400 },
        credits: { balance: 12345 },
      },
    },
  }) + "\n");

  await writeFile(join(claudeProjects, "sess-1.jsonl"), [
    JSON.stringify({
      type: "assistant",
      timestamp: new Date(nowMs - 10_000).toISOString(),
      quotaLimits: {
        status: "rejected",
        rateLimitType: "five_hour",
        resetsAt: nowSec + 2400,
      },
    }),
  ].join("\n") + "\n");

  await writeFile(join(grokAppDir, "account_billing_cache.json"), JSON.stringify({
    available: true,
    subscriptionTier: "SuperGrok",
    creditUsagePercent: 18,
    resetsAt: new Date((nowSec + 5000) * 1000).toISOString(),
    products: [{ productId: 1, label: "Grok Build", usedPercent: 12 }],
    fetchedAt: nowSec - 20,
  }));

  await writeFile(join(grokAuthedHome, "sessions", "proj", "s1", "usage.json"), JSON.stringify({
    session: { totalTokens: 5000, costUsdTicks: 2_500_000_000 },
  }));

  let rpcCalls = 0;
  let fakeNow = nowMs;
  const service = new QuotaService({
    homeDir,
    cockpitDir,
    grokAppDir,
    ttlMs: 30_000,
    nowFn: () => fakeNow,
    codexQuotaReader: async (profile) => {
      if (profile.id === "rpc") {
        rpcCalls += 1;
        return {
          planType: "prolite",
          primary: { usedPercent: 15, windowDurationMins: 300, resetsAt: nowSec + 1200 },
          credits: { balance: 999 },
        };
      }
      return null;
    },
  });

  const profiles = [
    { id: "desktop", provider: "antigravity", profileType: "desktop", installed: true, home: root, account: { email: "agy@example.com" } },
    { id: "default", provider: "codex", installed: true, home: codexHome, account: { email: "codex@example.com" } },
    { id: "rpc", provider: "codex", installed: true, home: root, account: { email: "codex@example.com" } },
    { id: "default", provider: "claude", installed: true, home: claudeHome, account: { email: "claude@example.com" } },
    { id: "cockpit-1", provider: "grok", installed: true, authenticated: true, home: grokAuthedHome, account: { email: "grok@example.com" } },
    { id: "default", provider: "grok", installed: true, authenticated: false, home: grokDefaultHome, account: { label: "未登录" } },
  ];

  const first = await service.collectAll(profiles);
  assert.equal(rpcCalls, 1);

  const agyQ = first.byKey["antigravity:desktop"];
  assert.equal(agyQ.summaryText, "余 72%");
  const expiredWeekly = agyQ.buckets.find((b) => b.id === "gemini-weekly");
  assert.equal(expiredWeekly.remainingPercent, 100);
  assert.equal(expiredWeekly.resetsAt, null);

  const codexRolloutQ = first.byKey["codex:default"];
  assert.equal(codexRolloutQ.planLabel, "Pro");
  assert.equal(codexRolloutQ.summaryText, "余 75%");
  assert.equal(codexRolloutQ.credits.balance, "12345");

  const codexRpcQ = first.byKey["codex:rpc"];
  assert.equal(codexRpcQ.planLabel, "Pro Lite");
  assert.equal(codexRpcQ.summaryText, "余 85%");
  assert.equal(codexRpcQ.source, "rpc");

  const claudeQ = first.byKey["claude:default"];
  assert.equal(claudeQ.statusTone, "exhausted");
  assert.equal(claudeQ.summaryText, "5h 耗尽");

  const grokAuthQ = first.byKey["grok:cockpit-1"];
  assert.equal(grokAuthQ.planLabel, "SuperGrok");
  assert.equal(grokAuthQ.summaryText, "余 82%");
  assert.equal(grokAuthQ.buckets.some((b) => b.label === "Grok Build" && b.remainingPercent === 88), true);

  const grokAnonQ = first.byKey["grok:default"];
  assert.equal(grokAnonQ.available, false);
  assert.equal(grokAnonQ.planLabel, "未登录");
  assert.equal(grokAnonQ.summaryText, "仅历史");

  // 30s TTL cache avoids duplicate RPC collection without refresh=true
  fakeNow += 5_000;
  await service.collectAll(profiles);
  assert.equal(rpcCalls, 1);

  await service.collectAll(profiles, { refresh: true });
  assert.equal(rpcCalls, 2);

  // Zero secrets exposed
  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /MUST_NOT_LEAK|secret_token/);
});

test("parseClaudeErrorResetSec parses timezone reset wall-clock strings and next-day rollovers", () => {
  const anchorMs = 1794671302419; // 2026-11-14T23:48:22.419+08:00
  assert.equal(
    parseClaudeErrorResetSec("You've hit your 5-hour limit · resets 2:50am (Asia/Taipei)", anchorMs),
    1794682200,
  );
  assert.equal(parseClaudeErrorResetSec("no reset timestamp here", anchorMs), null);
});

test("discovers dual Cockpit Claude instances and Codex Cockpit labels with isolated quotas and rollover", async () => {
  const root = await mkdtemp(join(os.tmpdir(), "ac-cockpit-dual-claude-"));
  try {
    const cockpitDir = join(root, ".antigravity_cockpit");
    const cockpitInstDir = join(root, ".cockpit_tools", "instances", "claude", "06c986e6488fe0fa");
    const defaultDesktopDir = join(root, "Library", "Application Support", "Claude");
    const codexHome = join(root, ".codex");
    const claudeHome = join(root, ".claude");
    const claudeProjDir = join(claudeHome, "projects", "-tmp-workspace");

    await mkdir(cockpitDir, { recursive: true });
    await mkdir(join(cockpitInstDir, "claude-code-sessions", "acct-hotmail", "org-hotmail"), { recursive: true });
    await mkdir(join(defaultDesktopDir, "claude-code-sessions", "acct-icloud", "org-icloud"), { recursive: true });
    await mkdir(codexHome, { recursive: true });
    await mkdir(claudeProjDir, { recursive: true });

    await writeFile(
      join(cockpitDir, "codex_instances.json"),
      JSON.stringify({
        instances: [{ id: "inst-codex-1", name: "personal", userDataDir: codexHome }],
      }),
      "utf8",
    );

    await writeFile(
      join(cockpitDir, "claude_accounts.json"),
      JSON.stringify({
        accounts: [
          {
            id: "acc_icloud",
            email: "alice@example.com",
            account_uuid: "acct-icloud",
            organization_uuid: "org-icloud",
            plan_type: "max",
          },
          {
            id: "acc_hotmail_desktop",
            email: "bob@example.com",
            account_uuid: "acct-hotmail",
            organization_uuid: "org-hotmail",
            plan_type: null,
          },
          {
            id: "acc_hotmail_oauth",
            email: "bob@example.com",
            account_uuid: "acct-hotmail",
            organization_uuid: "org-hotmail",
            plan_type: "Pro",
          },
        ],
      }),
      "utf8",
    );

    await writeFile(
      join(cockpitDir, "claude_instances.json"),
      JSON.stringify({
        defaultSettings: { bindAccountId: "acc_icloud", followLocalAccount: false },
        instances: [
          {
            id: "inst-hotmail",
            name: "claude hotmail",
            userDataDir: cockpitInstDir,
            bindAccountId: "acc_hotmail_desktop",
          },
        ],
      }),
      "utf8",
    );

    // Local .claude.json is currently signed in to hotmail, but claude:default must honor bindAccountId=acc_icloud.
    await writeFile(
      join(claudeHome, ".claude.json"),
      JSON.stringify({
        oauthAccount: {
          emailAddress: "bob@example.com",
          accountUuid: "acct-hotmail",
          organizationUuid: "org-hotmail",
          organizationType: "claude_pro",
        },
      }),
      "utf8",
    );

    const anchorMs = 1794671302419; // 2026-11-14T23:48:22+08:00
    await writeFile(
      join(defaultDesktopDir, "plan-usage-history.json"),
      JSON.stringify({
        samples: [{ t: anchorMs - 60_000, org: "org-icloud", u: { fh: 8, sd: 79 } }],
      }),
      "utf8",
    );
    await writeFile(
      join(cockpitInstDir, "plan-usage-history.json"),
      JSON.stringify({
        samples: [
          { t: anchorMs - 300_000, org: "org-icloud", u: { fh: 50, sd: 50 } },
          { t: anchorMs - 500, org: "org-hotmail", u: { fh: 100, sd: 72 } },
        ],
      }),
      "utf8",
    );

    // Session claimed by claude-hotmail (plus desktop rate-limit error).
    const hotmailSid = "22561d92-dfd7-44fb-b6ab-5d5035bb0240";
    const icloudSid = "11111111-2222-3333-4444-555555555555";
    await writeFile(
      join(cockpitInstDir, "claude-code-sessions", "acct-hotmail", "org-hotmail", "local_1.json"),
      JSON.stringify({
        cliSessionId: hotmailSid,
        error: "You've hit your 5-hour limit · resets 2:50am (Asia/Taipei)",
        errorAt: anchorMs,
      }),
      "utf8",
    );

    const hotmailJsonl = join(claudeProjDir, `${hotmailSid}.jsonl`);
    const icloudJsonl = join(claudeProjDir, `${icloudSid}.jsonl`);
    await writeFile(
      hotmailJsonl,
      `${JSON.stringify({ type: "user", timestamp: new Date(anchorMs - 2000).toISOString(), cwd: root, message: { content: "Hotmail 桌面会话" } })}\n`,
      "utf8",
    );
    await writeFile(
      icloudJsonl,
      `${JSON.stringify({ type: "user", timestamp: new Date(anchorMs - 1000).toISOString(), cwd: root, message: { content: "Default 主号会话" } })}\n`,
      "utf8",
    );
    await utimes(hotmailJsonl, new Date(anchorMs), new Date(anchorMs));
    await utimes(icloudJsonl, new Date(anchorMs), new Date(anchorMs));

    const env = { HOME: root };
    const codexProfiles = await discoverCodexProfiles({ env, home: root });
    assert.equal(codexProfiles[0].id, "default");
    assert.equal(codexProfiles[0].label, "Codex · personal");

    const claudeProfiles = await discoverClaudeProfiles({ env, home: root });
    assert.equal(claudeProfiles.length, 2);
    assert.equal(claudeProfiles[0].id, "default");
    assert.equal(claudeProfiles[0].cockpitAccount.email, "alice@example.com");
    assert.equal(claudeProfiles[1].id, "claude-hotmail");
    assert.equal(claudeProfiles[1].label, "Claude · claude hotmail");
    assert.equal(claudeProfiles[1].cockpitAccount.email, "bob@example.com");

    // Verify threads stay partitioned cleanly across both Claude profiles.
    const claudeProvider = new ClaudeProvider({ env });
    await claudeProvider.refreshProfiles();
    const defaultThreads = await claudeProvider.listThreads("default", { limit: 20 });
    const hotmailThreads = await claudeProvider.listThreads("claude-hotmail", { limit: 20 });
    assert.deepEqual(defaultThreads.map((t) => t.rawId), [icloudSid]);
    assert.deepEqual(hotmailThreads.map((t) => t.rawId), [hotmailSid]);

    // Verify quota isolation and real 5h/weekly percentages.
    let nowMs = anchorMs + 10_000;
    const quotaSvc = new QuotaService({ env, homeDir: root, cockpitDir, nowFn: () => nowMs });
    const initial = await quotaSvc.collectAll(claudeProfiles, { refresh: true });

    const qDefault = initial.byKey["claude:default"];
    assert.equal(qDefault.accountLabel, "alice@example.com");
    assert.equal(qDefault.planLabel, "Max");
    assert.equal(qDefault.windows.fiveHour.remainingPercent, 92);
    assert.equal(qDefault.windows.weekly.remainingPercent, 21);
    assert.equal(qDefault.summaryText, "余 21%");

    const qHotmail = initial.byKey["claude:claude-hotmail"];
    assert.equal(qHotmail.accountLabel, "bob@example.com");
    assert.equal(qHotmail.planLabel, "Pro");
    assert.equal(qHotmail.statusTone, "exhausted");
    assert.equal(qHotmail.summaryText, "5h 耗尽");
    assert.equal(qHotmail.windows.fiveHour.remainingPercent, 0);
    assert.equal(qHotmail.windows.fiveHour.resetsAt, 1794682200);
    assert.equal(qHotmail.windows.weekly.remainingPercent, 28);

    // After 5h resets (>1794682200), hotmail's stale 5h exhaustion expires while weekly 28% remains active.
    nowMs = 1794682200 * 1000 + 60_000;
    const rolled = await quotaSvc.collectAll(claudeProfiles, { refresh: true });
    const qHotmailRolled = rolled.byKey["claude:claude-hotmail"];
    assert.equal(qHotmailRolled.windows.fiveHour.remainingPercent, null);
    assert.equal(qHotmailRolled.windows.weekly.remainingPercent, 28);
    assert.equal(qHotmailRolled.summaryText, "余 28%");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("QuotaService consumes Claude CLI unifiedWindows stream events, expires stale plan samples, and replaces fallback 充足 with 未限流", async (t) => {
  const root = await mkdtemp(join(os.tmpdir(), "ac-quota-cli-stream-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const homeDir = join(root, "home");
  const claudeHome = join(homeDir, ".claude");
  const desktopDir = join(homeDir, "Library", "Application Support", "Claude");
  await Promise.all([
    mkdir(join(claudeHome, "projects"), { recursive: true }),
    mkdir(desktopDir, { recursive: true }),
  ]);

  const anchorMs = 1795340000_000;
  const anchorSec = Math.floor(anchorMs / 1000);
  const reset5hSec = anchorSec + 3600;
  const reset7dSec = anchorSec + 86400 * 3;

  // Verify pure extractor handles official rate_limit_info.unifiedWindows shape.
  const extracted = extractClaudeRateLimitWindows({
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed",
      resetsAt: reset5hSec,
      rateLimitType: "five_hour",
      unifiedWindows: {
        five_hour: { utilization: 0.75, resetsAt: reset5hSec, status: "allowed" },
        seven_day: { utilization: 0.34, resetsAt: reset7dSec, status: "allowed" },
      },
    },
  });
  assert.equal(extracted.fiveHour?.utilization, 0.75);
  assert.equal(extracted.sevenDay?.utilization, 0.34);

  // Older desktop sample (4 days stale) and recent desktop sample overridden by fresher CLI stream.
  await writeFile(
    join(desktopDir, "plan-usage-history.json"),
    JSON.stringify({
      samples: [
        { t: anchorMs - 4 * 86400 * 1000, org: "org-stale", u: { fh: 0, sd: 14 } },
        { t: anchorMs - 3600 * 1000, org: "org-live", u: { fh: 10, sd: 82 } },
      ],
    }),
    "utf8",
  );

  let fakeNowMs = anchorMs;
  const svc = new QuotaService({
    homeDir,
    cockpitDir: join(root, ".cockpit"),
    ttlMs: 0,
    nowFn: () => fakeNowMs,
    claudeQuotaReader: async (profile) => {
      if (profile.id !== "live") return null;
      return {
        fiveHour: { utilization: 0.75, resetsAt: reset5hSec, status: "allowed", observedAtMs: anchorMs - 10_000 },
        sevenDay: { utilization: 0.34, resetsAt: reset7dSec, status: "allowed", observedAtMs: anchorMs - 10_000 },
        updatedAtMs: anchorMs - 10_000,
        updatedAt: anchorSec - 10,
        source: "claude-cli-stream",
      };
    },
  });

  const profiles = [
    {
      provider: "claude",
      id: "live",
      installed: true,
      home: claudeHome,
      cockpitAccount: { email: "live@example.com", organizationUuid: "org-live", planType: "Pro" },
    },
    {
      provider: "claude",
      id: "stale",
      installed: true,
      home: join(root, "empty-claude"),
      cockpitAccount: { email: "stale@example.com", organizationUuid: "org-stale", planType: "Pro" },
    },
  ];

  const first = await svc.collectAll(profiles, { refresh: true });
  const qLive = first.byKey["claude:live"];
  assert.equal(qLive.windows.fiveHour.remainingPercent, 25);
  assert.equal(qLive.windows.fiveHour.resetsAt, reset5hSec);
  assert.equal(qLive.windows.weekly.remainingPercent, 66);
  assert.equal(qLive.windows.weekly.resetsAt, reset7dSec);
  assert.equal(qLive.summaryText, "余 25%");
  assert.equal(qLive.source, "claude-cli-stream");

  // 4-day-old plan-usage-history sample must be expired, not masquerading as 86% or "充足".
  const qStale = first.byKey["claude:stale"];
  assert.equal(qStale.windows.fiveHour.remainingPercent, null);
  assert.equal(qStale.windows.fiveHour.detail, "未限流");
  assert.equal(qStale.windows.weekly.remainingPercent, null);
  assert.equal(qStale.windows.weekly.detail, "未限流");

  // After 5h resetsAt passes, 5h clears cleanly while active weekly stays at 66%.
  fakeNowMs = (reset5hSec + 60) * 1000;
  const rolled = await svc.collectAll(profiles, { refresh: true });
  const qRolled = rolled.byKey["claude:live"];
  assert.equal(qRolled.windows.fiveHour.remainingPercent, null);
  assert.equal(qRolled.windows.fiveHour.resetsAt, null);
  assert.equal(qRolled.windows.fiveHour.detail, "未限流");
  assert.equal(qRolled.windows.weekly.remainingPercent, 66);
  assert.equal(qRolled.summaryText, "余 66%");
});
