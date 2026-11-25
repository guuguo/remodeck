import test from "node:test";
import assert from "node:assert/strict";

import {
  computePerspectiveRigPose,
  readTycoonVisualPrefs,
  resolveLabelCollisionLayout,
  resolveTycoonThemeTuning,
  resolveWorkstationLodMode,
  shortestAngleDelta,
  selectAssistantSignalBadge,
  buildTycoonWorldLayout,
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
