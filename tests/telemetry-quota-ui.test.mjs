import assert from "node:assert/strict";
import test from "node:test";
import { hasElapsedQuotaReset, renderAgentTelemetryBarHtml } from "../public/instance-switcher.js";

function renderQuota(windows, options = {}) {
  return renderAgentTelemetryBarHtml([{
    key: "codex:default",
    provider: "codex",
    id: "default",
    installed: true,
    authenticated: true,
    quota: {
      status: "ok",
      windows,
      buckets: [{ id: "credits", windowKind: "credits", label: "积分", detail: "积分 38591" }],
    },
  }], {}, { activeProvider: "codex", activeProfileId: "default", ...options });
}

test("compact quota uses weekly background progress and keeps credits in expanded details", () => {
  const windows = { weekly: { remainingPercent: 46 }, fiveHour: { remainingPercent: 84 } };
  const html = renderQuota(windows);
  assert.match(html, /has-weekly-quota quota-ok/);
  assert.match(html, /telemetry-weekly-fill" style="width:46%"/);
  assert.match(html, /class="telemetry-compact-percent">46%</);
  assert.match(html, /title="周额度剩余 46%/);
  const text = html.replace(/<[^>]*>/g, "");
  assert.match(text, /46%/);
  assert.doesNotMatch(text, /周|5h|84%|积分|38591/);
  assert.match(renderQuota(windows, { expanded: true }), /积分 38591/);
});

test("compact quota only warns for five-hour remaining below 30 percent", () => {
  const render = (percent) => renderQuota({ weekly: { remainingPercent: 46 }, fiveHour: { remainingPercent: percent } });
  assert.doesNotMatch(render(30), /telemetry-quota-alert|5h 30%/);
  assert.match(render(29), /telemetry-quota-alert is-warn">5h 29%/);
  assert.match(render(0), /telemetry-quota-alert is-danger">5h 0%/);
  assert.doesNotMatch(render(null), /telemetry-quota-alert/);
});

test("compact weekly progress distinguishes exhausted, missing, and third-party quotas", () => {
  const exhausted = renderQuota({ weekly: { remainingPercent: 0 } });
  assert.match(exhausted, /has-weekly-quota quota-danger/);
  assert.match(exhausted, /telemetry-weekly-fill" style="width:0%"/);
  assert.match(renderQuota({ weekly: { remainingPercent: 20 } }), /quota-warn/);
  for (const windows of [{}, { weekly: { remainingPercent: null } }]) {
    const html = renderQuota(windows);
    assert.doesNotMatch(html, /telemetry-weekly-progress|积分|38591/);
    assert.match(html, /暂无周额度数据/);
  }
  const thirdParty = renderQuota({ thirdPartyWeekly: { remainingPercent: 61 }, thirdPartyFiveHour: { remainingPercent: 12 } });
  assert.match(thirdParty, /telemetry-weekly-fill" style="width:61%"/);
  assert.match(thirdParty, /telemetry-quota-alert is-warn">5h 12%/);
});

test("expanded quotas show a countdown per window and exact local reset time on hover", () => {
  const nowSec = Date.parse("2026-11-16T10:00:00Z") / 1000;
  const html = renderQuota({
    fiveHour: { remainingPercent: 22, resetsAt: nowSec + 2400 },
    weekly: { remainingPercent: 93, resetsAt: (nowSec + 3 * 86400) * 1000 },
  }, { expanded: true, nowSec });
  assert.match(html, /telemetry-chip-reset[^>]*>40分后重置/);
  assert.match(html, /telemetry-chip-reset[^>]*>3天后重置/);
  assert.match(html, /datetime="2026-11-16T10:40:00\.000Z"/);
  assert.match(html, /重置时间：/);
  assert.equal((html.match(/telemetry-quota-chip has-reset/g) || []).length, 2);
});

test("elapsed reset times await refreshed data and missing reset times are never inferred", () => {
  const nowSec = 1794823200;
  const elapsed = renderQuota({ weekly: { remainingPercent: 23, resetsAt: nowSec - 1 } }, { expanded: true, nowSec });
  assert.match(elapsed, /已到重置时间，待刷新/);
  assert.match(elapsed, />23%<\/span>/);
  assert.doesNotMatch(elapsed, /已重置|>100%</);
  for (const resetsAt of [undefined, null, 0, "unknown"]) {
    const html = renderQuota({ weekly: { remainingPercent: 46, resetsAt } }, { expanded: true, nowSec });
    assert.match(html, /未提供重置时间/);
    assert.doesNotMatch(html, /telemetry-chip-reset/);
  }
});

test("third-party and count-based quotas retain their independent reset times", () => {
  const nowSec = 1794823200;
  const profiles = [{ key: "antigravity:cli", provider: "antigravity", id: "cli", installed: true,
    quota: { status: "ok", windows: {
      fiveHour: { remainingPercent: 90, resetsAt: nowSec + 3600 },
      weekly: { remainingPercent: 44, resetsAt: nowSec + 2 * 86400 },
      thirdPartyWeekly: { remainingPercent: 100, resetsAt: nowSec + 4 * 86400 },
    } },
  }, { key: "claude:work", provider: "claude", id: "work", installed: true,
    quota: { status: "ok", windows: { fiveHour: { remainingPercent: null, detail: "5h 22条", resetsAt: nowSec + 1800 } } },
  }];
  const html = renderAgentTelemetryBarHtml(profiles, {}, { expanded: true, nowSec });
  for (const text of ["1小时后重置", "2天后重置", "4天后重置", "30分后重置"]) assert.ok(html.includes(text), text);
  assert.equal((html.match(/class="telemetry-chip-reset"/g) || []).length, 4);
  assert.match(html, /5h 22条/);
});

test("reset countdown advances when rendered again even without a new quota snapshot", () => {
  const nowSec = 1794823200;
  const windows = { weekly: { remainingPercent: 46, resetsAt: nowSec + 120 } };
  assert.match(renderQuota(windows, { expanded: true, nowSec }), />2分后重置</);
  assert.match(renderQuota(windows, { expanded: true, nowSec: nowSec + 60 }), />1分后重置</);
  assert.match(renderQuota(windows, { expanded: true, nowSec: nowSec + 120 }), /已到重置时间，待刷新/);
});

test("hasElapsedQuotaReset detects expired resetsAt windows across profiles", () => {
  const nowSec = 1795345200;
  assert.equal(hasElapsedQuotaReset([], nowSec), false);
  assert.equal(hasElapsedQuotaReset([{
    provider: "claude",
    id: "default",
    quota: {
      windows: {
        fiveHour: { remainingPercent: 25, resetsAt: nowSec + 300 },
        weekly: { remainingPercent: 66, resetsAt: nowSec + 86400 },
      },
    },
  }], nowSec), false);
  assert.equal(hasElapsedQuotaReset([{
    provider: "claude",
    id: "default",
    quota: {
      windows: {
        fiveHour: { remainingPercent: 0, resetsAt: nowSec },
        weekly: { remainingPercent: 9, resetsAt: null },
      },
    },
  }], nowSec), true);
  assert.equal(hasElapsedQuotaReset([{
    provider: "antigravity",
    id: "desktop",
    quota: {
      buckets: [{ id: "3p-5h", remainingPercent: 0, resetsAt: (nowSec - 5) * 1000 }],
    },
  }], nowSec), true);
});
