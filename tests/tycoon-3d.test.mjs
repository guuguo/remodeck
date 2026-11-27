import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  computePerspectiveRigPose,
  estimateWorkstationLabelSize,
  formatRoomBannerHtml,
  readTycoonVisualPrefs,
  renderWorkstationTagHtml,
  resolveLabelCollisionLayout,
  resolveTycoonThemeTuning,
  resolveWorkstationActivityState,
  resolveWorkstationLodMode,
  shortestAngleDelta,
  shouldShowRoomBanner,
  selectAssistantSignalBadge,
  buildTycoonWorldLayout,
  partitionRoomTopicsForSlots,
  writeTycoonVisualPrefs,
} from "../public/tycoon-3d.js";
import { renderTycoonHudHtml } from "../public/mission-overview.js";

test("shortestAngleDelta wraps cleanly across +/-PI without full-circle jitter", () => {
  const from = Math.PI - 0.1;
  const to = -Math.PI + 0.1;
  const delta = shortestAngleDelta(from, to);
  assert.ok(Math.abs(delta - 0.2) < 1e-9, `expected ~0.2, got ${delta}`);

  const rev = shortestAngleDelta(to, from);
  assert.ok(Math.abs(rev + 0.2) < 1e-9, `expected ~-0.2, got ${rev}`);
});

test("computePerspectiveRigPose couples zoom >= 1.4 to ~24 deg pitch and elevated lookY", () => {
  const overview = computePerspectiveRigPose({ x: 0, z: 0, zoom: 0.92, blend: 1 });
  assert.equal(Math.round(overview.fov), 36);
  assert.ok(overview.pitchDeg >= 39 && overview.pitchDeg <= 41);
  assert.equal(overview.lookY, 0);

  const focused = computePerspectiveRigPose({ x: -10, z: -8, zoom: 1.42, blend: 1 });
  assert.equal(Math.round(focused.fov), 36);
  assert.ok(focused.pitchDeg <= 24.5 && focused.pitchDeg >= 23.8, `pitchDeg=${focused.pitchDeg}`);
  assert.ok(focused.lookY >= 1.1 && focused.lookY <= 1.2, `lookY=${focused.lookY}`);

  const midBlend = computePerspectiveRigPose({ x: 0, z: 0, zoom: 1, blend: 0 });
  assert.equal(Math.round(midBlend.fov), 6);
  assert.equal(midBlend.lookY, 0);
});

test("resolveWorkstationLodMode enforces 3-level zoom LOD while keeping pending and focused cards full", () => {
  assert.equal(resolveWorkstationLodMode({ zoom: 0.72, isResting: true }), "micro");
  assert.equal(resolveWorkstationLodMode({ zoom: 0.72, isResting: false }), "mid");
  assert.equal(resolveWorkstationLodMode({ zoom: 0.72, isResting: false, isPending: true }), "full");
  assert.equal(resolveWorkstationLodMode({ zoom: 0.72, isResting: true, isSelected: true }), "full");

  assert.equal(resolveWorkstationLodMode({ zoom: 1.0, isResting: true }), "mid");
  assert.equal(resolveWorkstationLodMode({ zoom: 1.0, isResting: false, isHovered: true }), "full");
  assert.equal(resolveWorkstationLodMode({ zoom: 1.0, isResting: true, isSearchHit: true }), "full");

  assert.equal(resolveWorkstationLodMode({ zoom: 1.35, isResting: true }), "full");
});

test("resolveLabelCollisionLayout keeps higher-priority pending label anchored and displaces lower-priority overlap", () => {
  const layout = resolveLabelCollisionLayout([
    { id: "ws:resting", ax: 400, ay: 300, w: 120, h: 32, priority: 10, visible: true },
    { id: "ws:pending", ax: 405, ay: 302, w: 140, h: 48, priority: 82, visible: true },
  ], { w: 1280, h: 720 });

  const pendingBox = layout.get("ws:pending");
  const restingBox = layout.get("ws:resting");
  assert.ok(pendingBox && restingBox);
  assert.equal(pendingBox.dist, 0);
  assert.ok(restingBox.dist > 10, `expected displaced resting label dist > 10, got ${restingBox.dist}`);
});

test("readTycoonVisualPrefs / writeTycoonVisualPrefs safely fall back and persist", () => {
  const defaults = readTycoonVisualPrefs();
  assert.deepEqual(defaults, { perspective: false, tiltShift: false, bloom: true });

  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  try {
    const saved = writeTycoonVisualPrefs({ perspective: true, tiltShift: true, bloom: false });
    assert.deepEqual(saved, { perspective: true, tiltShift: true, bloom: false });
    assert.deepEqual(readTycoonVisualPrefs(), { perspective: true, tiltShift: true, bloom: false });
  } finally {
    delete globalThis.localStorage;
  }
});

test("renderTycoonHudHtml includes visual toggles and Space pending shortcut hint", () => {
  const pendingThread = {
    id: "codex:default:pend-1",
    provider: "codex",
    profileId: "default",
    title: "待拍板测试",
    pendingCount: 1,
    live: false,
    updatedAt: Math.floor(Date.now() / 1000) - 20,
  };
  const overview = {
    domains: [{
      id: "indie-lab",
      name: "软件研发室",
      topics: [{
        id: "t1",
        domainId: "indie-lab",
        name: "测试产线",
        pendingCount: 1,
        liveCount: 0,
        pipeline: { stageIndex: 2, stageLabel: "研发", readyToHarvest: false },
        activeThreads: [pendingThread],
        archivedThreads: [],
      }],
    }],
    topics: [{ id: "t1", name: "测试产线" }],
    bossFocus: [],
    incubator: { eggs: [], chilled: [], totalActive: 0, chilledCount: 0 },
    unassignedActive: [],
    radar: { liveThreads: [], pendingThreads: [pendingThread], totalActiveCount: 1, driftedCount: 0, harvestReadyCount: 0 },
    meta: {},
  };

  const html = renderTycoonHudHtml(overview, {});
  assert.match(html, /data-tycoon-toggle-vis="perspective"/);
  assert.match(html, /36° 透视/);
  assert.match(html, /data-tycoon-toggle-vis="tiltShift"/);
  assert.match(html, /移轴景深/);
  assert.match(html, /data-tycoon-toggle-vis="bloom"/);
  assert.match(html, /泛光/);
  assert.match(html, /tycoon-space-kbd">Space<\/kbd>/);
});

test("resolveTycoonThemeTuning preserves dark mode baseline and prevents light mode overexposure", () => {
  const dark = resolveTycoonThemeTuning("dark");
  assert.deepEqual(dark.post, {
    exposure: 1.15,
    bloomThr: 0.78,
    bloomKnee: 0.58,
    bloomStrength: 0.8,
    vignette: 0.42,
  });
  assert.deepEqual(dark.lights, {
    hemiSky: 0x7f9cd6,
    hemiGround: 0x0a1410,
    hemiIntensity: 0.5,
    keyColor: 0xc7d8ff,
    keyIntensity: 1.5,
    rimColor: 0x60a5fa,
    rimIntensity: 1.5,
  });

  const light = resolveTycoonThemeTuning("light");
  assert.ok(light.post.exposure < 1.0, `expected light exposure < 1.0, got ${light.post.exposure}`);
  assert.ok(light.post.bloomThr >= 1.3, `expected light bloomThr >= 1.3, got ${light.post.bloomThr}`);
  assert.ok(light.post.bloomStrength <= 0.2, `expected light bloomStrength <= 0.2, got ${light.post.bloomStrength}`);
  assert.ok(light.lights.hemiIntensity <= 0.4, `expected light hemiIntensity <= 0.4, got ${light.lights.hemiIntensity}`);
  assert.ok(
    light.lights.keyIntensity / light.lights.hemiIntensity >= 5,
    `expected key/hemi contrast >= 5, got ${light.lights.keyIntensity / light.lights.hemiIntensity}`,
  );
  for (const rgb of light.env.softboxes) {
    assert.ok(rgb.every((c) => c <= 1.5), `expected light softbox RGB <= 1.5, got ${rgb}`);
  }
});


test("assistant badge renders only the server-selected highest priority signal", () => {
  const counts = { alert: 2, harvest: 3, ruin: 1 };
  const topic = { assistantSignals: { top: "alert", counts, ruinDays: 8, cards: [] }, harvestInferred: true };
  assert.deepEqual(selectAssistantSignalBadge(topic), { type: "alert", text: "!", inferred: false });
  topic.assistantSignals.top = "harvest";
  assert.deepEqual(selectAssistantSignalBadge(topic), { type: "harvest", text: "$3", inferred: false });
  topic.assistantSignals.top = "ruin";
  const ruin = selectAssistantSignalBadge(topic);
  assert.equal(ruin.type, "ruin");
  assert.match(ruin.text, /🚧8/);
  assert.equal(ruin.inferred, false);
});

test("assistant inferred harvest is dashed only when there is no harvest card", () => {
  const topic = { harvestInferred: true, assistantSignals: { top: null, counts: {}, cards: [] } };
  assert.equal(selectAssistantSignalBadge(topic).inferred, true);
  topic.assistantSignals.cards.push({ type: "harvest" });
  assert.equal(selectAssistantSignalBadge(topic), null);
  assert.equal(selectAssistantSignalBadge({}), null);
});

test("world layout carries assistant signals and inference into building records", () => {
  const assistantSignals = { top: "alert", counts: { alert: 1, harvest: 0, ruin: 0 }, cards: [], ruinDays: null };
  const layout = buildTycoonWorldLayout({ domains: [{ id: "indie-lab", topics: [{ id: "shop", name: "示例商城", assistantSignals, harvestInferred: true }] }] });
  assert.equal(layout.workstations[0].assistantSignals, assistantSignals);
  assert.equal(layout.workstations[0].harvestInferred, true);
});

test("spriteVisit guards against paused/missing state and pause() settles pending visits", () => {
  const src = fs.readFileSync(new URL("../public/tycoon-3d.js", import.meta.url), "utf8");
  const visitMatch = src.match(/function spriteVisit\([\s\S]*?\n  \}/);
  assert.ok(visitMatch, "spriteVisit should exist");
  assert.match(visitMatch[0], /if \(!running \|\| !spriteRecord \|\| !dest\)\s*\{\s*return Promise\.resolve\(\);/);
  assert.match(visitMatch[0], /spriteMotionTimer\s*=\s*setTimeout\(\(\)\s*=>\s*finishSpriteVisit\(\)/);
  const pauseMatch = src.match(/pause\(\)\s*\{[\s\S]*?\n    \}/);
  assert.ok(pauseMatch, "pause() should exist");
  assert.match(pauseMatch[0], /finishSpriteVisit\(\)/);
});

test("partitionRoomTopicsForSlots and buildTycoonWorldLayout fold overflow projects into an expandable cluster hub", () => {
  const topics = Array.from({ length: 8 }, (_, idx) => ({
    id: `proj-${idx + 1}`,
    domainId: "indie-lab",
    name: `项目${idx + 1}`,
    liveCount: idx === 7 ? 2 : 0,
    pendingCount: idx === 6 ? 1 : 0,
    primaryActiveCount: idx + 1,
    pipeline: { stageIndex: idx === 7 ? 4 : 2, stageLabel: "研发", readyToHarvest: idx === 7 },
    assistantSignals: idx === 5
      ? { top: "harvest", counts: { alert: 0, harvest: 2, ruin: 0 }, ruinDays: null, cards: [] }
      : (idx === 6 ? { top: "alert", counts: { alert: 1, harvest: 0, ruin: 0 }, ruinDays: null, cards: [] } : undefined),
    activeThreads: [],
    archivedThreads: [],
    subProjects: idx === 0 ? [{ id: "s1", name: "web", cwd: "/Users/alice/dev/web" }, { id: "s2", name: "api", cwd: "/Users/alice/dev/api" }] : [],
  }));

  const { standalone, overflow } = partitionRoomTopicsForSlots(topics, 6);
  assert.equal(standalone.length, 5);
  assert.equal(overflow.length, 3);
  assert.equal(standalone.some((t) => t.id === "proj-7"), true, "pending project must stay standalone");
  assert.equal(standalone.some((t) => t.id === "proj-8"), true, "live project must stay standalone");

  // Give one overflow project an active signal and verify cluster aggregation
  overflow[0].harvestInferred = true;
  const layout = buildTycoonWorldLayout({
    domains: [{ id: "indie-lab", name: "软件研发室", shortName: "内容工坊", topics }],
  }, {
    selectedTopicId: overflow[0].id,
    searchText: overflow[0].name,
  });

  assert.equal(layout.rooms[0].shortTitle, "内容工坊");
  const indieStations = layout.workstations.filter((w) => w.roomId === "indie-lab");
  assert.equal(indieStations.length, 6);
  const hub = indieStations.find((w) => w.isClusterHub);
  assert.ok(hub, "cluster hub workstation should be emitted for overflow projects");
  assert.equal(hub.topicId, "hub:indie-lab");
  assert.equal(hub.name, "内容工坊");
  assert.equal(hub.memberCount, 3);
  assert.deepEqual(hub.memberTopicIds, overflow.map((t) => t.id));
  assert.equal(hub.isSearchHit, true, "searching an overflow member lights up its cluster hub");
  assert.equal(hub.isSelected, true, "selecting an overflow member highlights its cluster hub");

  const firstStandalone = indieStations.find((w) => w.topicId === "proj-1");
  if (firstStandalone) {
    assert.equal(firstStandalone.subProjectCount, 2);
  }
});

test("renderWorkstationTagHtml keeps single-line tags without resting pill, levels, KPI rows, or pips", () => {
  const stripTitles = (html) => html.replace(/\s*title="[^"]*"/g, "");
  const restingAct = resolveWorkstationActivityState({ liveCount: 0, pendingCount: 0, readyToHarvest: false });
  const restingHtml = renderWorkstationTagHtml({
    topicId: "sample-shop",
    name: "示例商城",
    stageIndex: 3,
    subProjectCount: 4,
    kpis: [{ label: "Stars", value: "42" }],
    assistantSignals: { top: "harvest", counts: { harvest: 3 } },
  }, restingAct);

  assert.match(restingHtml, /示例商城/);
  assert.match(restingHtml, />\+4</);
  assert.match(restingHtml, />\$3</);
  assert.doesNotMatch(stripTitles(restingHtml), /休息中|Lv\.|tycoon3d-kpi-row|tycoon3d-pips|子项目/);

  const hubHtml = renderWorkstationTagHtml({
    topicId: "hub:indie-lab",
    name: "内容工坊",
    isClusterHub: true,
    memberCount: 8,
    assistantSignals: { top: "harvest", counts: { harvest: 6 } },
  }, restingAct);

  assert.match(hubHtml, /内容工坊/);
  assert.match(hubHtml, />\+8</);
  assert.match(hubHtml, />\$6</);
  assert.doesNotMatch(stripTitles(hubHtml), /展开 8 项目|\+8项目/);

  const workingAct = resolveWorkstationActivityState({ liveCount: 1, pendingCount: 0 });
  const workingHtml = renderWorkstationTagHtml({ topicId: "w1", name: "示例工具", stageIndex: 3, kpis: [{ label: "Stars", value: "9" }] }, workingAct);
  assert.match(workingHtml, /tycoon3d-state-pill is-working/);
  assert.match(workingHtml, /工作中/);
  assert.match(workingHtml, /示例工具/);
  assert.doesNotMatch(stripTitles(workingHtml), /Lv\.|tycoon3d-kpi-row|tycoon3d-pips/);

  const pendingAct = resolveWorkstationActivityState({ liveCount: 0, pendingCount: 1 });
  const pendingHtml = renderWorkstationTagHtml({ topicId: "p1", name: "示例官网", stageIndex: 3 }, pendingAct);
  assert.match(pendingHtml, /tycoon3d-state-pill is-pending/);
  assert.match(pendingHtml, /待拍板 1/);
  assert.doesNotMatch(stripTitles(pendingHtml), /Lv\.|tycoon3d-kpi-row|tycoon3d-pips/);

  // XSS escaping, count coercion, and fallback $收菜 rendering
  const xssHtml = renderWorkstationTagHtml(
    { topicId: "xss", name: '<img src=x>', isClusterHub: true, subProjectCount: 1 },
    { ...restingAct, showHarvest: true },
    { signalBadge: { type: 'alert" onclick="x', text: "<bad>" }, signalTitle: 't"1' },
  );
  assert.match(xssHtml, /&lt;img src=x&gt;/);
  assert.match(xssHtml, /data-signal-type="alert&quot; onclick=&quot;x"/);
  assert.match(xssHtml, />\$收菜</);
  assert.doesNotMatch(xssHtml, /undefined|NaN|tycoon3d-cluster-pill/);
});

test("estimateWorkstationLabelSize measures compact single-line dimensions and fallback harvest pill", () => {
  const restingAct = resolveWorkstationActivityState({ liveCount: 0, pendingCount: 0 });
  const workingAct = resolveWorkstationActivityState({ liveCount: 1, pendingCount: 0 });
  const restingSize = estimateWorkstationLabelSize({ name: "示例商城" }, restingAct, { lodMode: "micro" });
  const harvestFallbackSize = estimateWorkstationLabelSize({ name: "示例商城" }, { ...restingAct, showHarvest: true }, { lodMode: "micro" });
  const workingSize = estimateWorkstationLabelSize({ name: "示例商城" }, workingAct, { lodMode: "mid" });

  assert.equal(restingSize.h, 24);
  assert.equal(workingSize.h, 28);
  assert.equal(harvestFallbackSize.w - restingSize.w, 38);
  assert.ok(workingSize.w > restingSize.w);
});

test("resolveWorkstationLodMode keeps resting stations micro on compact viewports unless focused", () => {
  assert.equal(resolveWorkstationLodMode({ zoom: 1.35, isResting: true, compactViewport: true }), "micro");
  assert.equal(resolveWorkstationLodMode({ zoom: 1.35, isResting: true, compactViewport: true, isSelected: true }), "full");
  assert.equal(resolveWorkstationLodMode({ zoom: 1.35, isResting: false, compactViewport: true, isPending: true }), "full");
});

test("formatRoomBannerHtml and shouldShowRoomBanner strip hotkeys, coerce counts, and enforce boundary thresholds", () => {
  const bannerHtml = formatRoomBannerHtml({ hotkey: "4", shortTitle: "海外发行部", title: "海外发行与基建部", topicCount: 2 });
  assert.equal(bannerHtml, "海外发行部 · 2");
  assert.doesNotMatch(bannerHtml, /\[4\]/);
  assert.equal(formatRoomBannerHtml({ shortTitle: "海外发行部", topicCount: 0 }), "海外发行部");

  assert.equal(shouldShowRoomBanner({ viewportWidth: 779, zoom: 0.92, selectedRoomId: "all" }), false);
  assert.equal(shouldShowRoomBanner({ viewportWidth: 780, zoom: 0.92, selectedRoomId: "all" }), true);
  assert.equal(shouldShowRoomBanner({ viewportWidth: 1280, zoom: 0.92, selectedRoomId: "bounty-guild" }), false);
  assert.equal(shouldShowRoomBanner({ viewportWidth: 1280, zoom: 1.18, selectedRoomId: "all" }), false);
  assert.equal(shouldShowRoomBanner({ viewportWidth: 1280, zoom: 1.17, selectedRoomId: "all" }), true);
});

test("CSS removes resting zZ, preserves selected/micro cascade, expands signal hit target, and hides empty HUD wrapper", () => {
  const workspaceCss = fs.readFileSync(new URL("../public/project-workspace.css", import.meta.url), "utf8");
  const assistantCss = fs.readFileSync(new URL("../public/tycoon-assistant.css", import.meta.url), "utf8");
  const spriteCss = fs.readFileSync(new URL("../public/sprite-assistant.css", import.meta.url), "utf8");
  const tycoonJs = fs.readFileSync(new URL("../public/tycoon-3d.js", import.meta.url), "utf8");

  assert.doesNotMatch(workspaceCss, /\.tycoon3d-tag\.is-resting::before/);
  assert.match(workspaceCss, /\.tycoon3d-tag\.is-resting:not\(\.is-selected\):not\(\.is-search-hit\)/);
  assert.match(workspaceCss, /\.tycoon3d-tag\.is-resting\.is-lod-micro:not\(\.is-selected\):not\(\.is-search-hit\)/);
  assert.match(assistantCss, /\.tycoon-signal-badge::before[\s\S]*inset:\s*-4px/);
  assert.match(spriteCss, /\.tycoon-assistant-badge\.is-empty\s*\{\s*display:\s*none;\s*\}/);
  assert.match(spriteCss, /\.tycoon-assistant-badges:not\(:has\(\.tycoon-assistant-badge:not\(\.is-empty\)\)\)\s*\{\s*display:\s*none;\s*\}/);
  assert.match(tycoonJs, /opacity\s*=\s*a\s*>=\s*1\s*\?\s*""\s*:\s*String\(a\)/);
});
