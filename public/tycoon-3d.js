import { escapeHtml } from "./markdown.js";
import { createSpriteBrain } from "./sprite-brain.js";

// Keep new assistant copy local: the shared locale dictionary is owned separately.
const assistantLocale = () => globalThis.window?.AgentControlI18n?.getLocale?.() || "zh-CN";
const assistantText = (zh, en) => assistantLocale().startsWith("zh")
  ? (globalThis.window?.AgentControlI18n?.t?.(zh) || zh) : en;

export function selectAssistantSignalBadge(topic = {}, locale = "zh-CN") {
  const signals = topic.assistantSignals;
  const type = signals?.top;
  if (type === "alert") return { type, text: "!", inferred: false };
  if (type === "harvest") return { type, text: `$${Number(signals.counts?.harvest) || 1}`, inferred: false };
  if (type === "ruin") return { type, text: `🚧${signals.ruinDays ?? 0}${locale.startsWith("zh") ? "天" : "d"}`, inferred: false };
  if (topic.harvestInferred && !(signals?.cards || []).some((card) => card.type === "harvest")) {
    return { type: "harvest", text: locale.startsWith("zh") ? "$准收菜" : "$Soon", inferred: true };
  }
  return null;
}


export const ROOM_BLUEPRINTS = Object.freeze({
  "indie-lab": {
    id: "indie-lab",
    hotkey: "2",
    title: "软件产品研发室",
    shortTitle: "软件研发室",
    x: -12.5,
    z: -8.6,
    w: 21.5,
    d: 13.6,
    maxSlots: 6,
    colorHex: 0x38bdf8,
    accentCss: "#38bdf8",
    camZoom: 1.25,
  },
  "drama-studio": {
    id: "drama-studio",
    hotkey: "3",
    title: "漫剧与小说制片厂",
    shortTitle: "漫剧制片厂",
    x: 11.5,
    z: -8.6,
    w: 17.5,
    d: 13.6,
    maxSlots: 6,
    colorHex: 0xa855f7,
    accentCss: "#a855f7",
    camZoom: 1.35,
  },
  "global-pub": {
    id: "global-pub",
    hotkey: "4",
    title: "海外发行与基建部",
    shortTitle: "海外发行部",
    x: -14.2,
    z: 8.8,
    w: 16.5,
    d: 12.6,
    maxSlots: 4,
    colorHex: 0xf59e0b,
    accentCss: "#f59e0b",
    camZoom: 1.32,
  },
  "bounty-guild": {
    id: "bounty-guild",
    hotkey: "5",
    title: "赏金委托与专项所",
    shortTitle: "赏金委托所",
    x: 3.2,
    z: 8.8,
    w: 15.6,
    d: 12.6,
    maxSlots: 4,
    colorHex: 0x10b981,
    accentCss: "#10b981",
    camZoom: 1.28,
  },
  incubator: {
    id: "incubator",
    hotkey: "6",
    title: "灵感孵化温室",
    shortTitle: "灵感孵化室",
    x: 16.6,
    z: 8.8,
    w: 8.6,
    d: 12.6,
    colorHex: 0xfbbf24,
    accentCss: "#fbbf24",
    camZoom: 1.48,
  },
});

export const LANDMARK_BADGE_LABELS = Object.freeze({
  comic: "漫译塔",
  radar: "总控塔",
  obelisk: "反重力碑",
  lighthouse: "导航灯塔",
  gears: "齿轮工坊",
  cinema: "漫剧影棚",
  youtube: "出海影音碑",
  shield: "防关联盾",
  phone: "云机基站",
  cat: "猫耳书阁",
  cottage: "温馨小屋",
  bullchart: "投研K线台",
  tower: "产线工坊",
});

const DEFAULT_LANDMARK_FALLBACK = Object.freeze({});

const PROVIDER_COLORS = Object.freeze({
  codex: { body: 0x10b981, emissive: 0x34d399, eye: 0x6ee7b7 },
  claude: { body: 0xf59e0b, emissive: 0xfbbf24, eye: 0xfde68a },
  antigravity: { body: 0x8b5cf6, emissive: 0xa78bfa, eye: 0xc4b5fd },
  grok: { body: 0x0ea5e9, emissive: 0x38bdf8, eye: 0x7dd3fc },
  default: { body: 0x3b82f6, emissive: 0x60a5fa, eye: 0x93c5fd },
});

function topicMatchesSearch(topic, q = "") {
  if (!q) return false;
  const lower = q.trim().toLowerCase();
  if (!lower) return false;
  if (`${topic.name || ""} ${topic.description || ""} ${topic.yieldLabel || ""}`.toLowerCase().includes(lower)) {
    return true;
  }
  const threads = [...(topic.activeThreads || []), ...(topic.archivedThreads || [])];
  return threads.some((t) => {
    const hay = [
      t.title || "",
      t.preview || "",
      t.stage || "",
      t.driftedFrom || "",
      t.sliceFromTopicName || "",
      ...(t.allFootprints || []),
      ...(t.footprints || []),
    ].join(" ").toLowerCase();
    return hay.includes(lower);
  });
}

export function resolveWorkstationActivityState({ liveCount = 0, pendingCount = 0, readyToHarvest = false } = {}) {
  const live = Math.max(0, Number(liveCount) || 0);
  const pending = Math.max(0, Number(pendingCount) || 0);
  const intensityTier = live >= 3 ? 3 : (live === 2 ? 2 : (live === 1 ? 1 : 0));
  const state = pending > 0 ? "pending" : (live > 0 ? "working" : "resting");
  const statusText = pending > 0
    ? `待拍板 ${pending}`
    : (live >= 3
        ? `超频爆气 ×${live}`
        : (live === 2 ? "火力全开 ×2" : (live === 1 ? "工作中" : "休息中")));
  return {
    state,
    intensityTier,
    isWorking: live > 0,
    isPending: pending > 0,
    isResting: live === 0 && pending === 0,
    statusText,
    showHarvest: Boolean(readyToHarvest),
  };
}

export const STATION_ARCHETYPES = Object.freeze({
  "indie-lab": "code",
  "drama-studio": "studio",
  "global-pub": "broadcast",
  "bounty-guild": "workshop",
});

export function resolveStationArchetype(roomId = "") {
  return STATION_ARCHETYPES[roomId] || "code";
}

export function computeStudioProgression(overview) {
  const domains = Array.isArray(overview?.domains) ? overview.domains : [];
  const flatTopics = domains.flatMap((d) => d.topics || []);
  let totalPoints = 0;
  for (const tp of flatTopics) {
    const st = Number(tp.pipeline?.stageIndex) || 1;
    const activeCnt = Number(tp.primaryActiveCount ?? tp.activeThreads?.length ?? 0);
    totalPoints += st * 28 + Math.min(activeCnt, 30) * 3 + (tp.pipeline?.readyToHarvest ? 35 : 0);
  }
  const level = Math.max(1, Math.floor(totalPoints / 120) + 1);
  const xpInLevel = totalPoints % 120;
  const xpPercent = Math.min(100, Math.round((xpInLevel / 120) * 100));
  return { level, xpPercent, totalPoints };
}

export function partitionRoomTopicsForSlots(topics = [], maxSlots = 6) {
  const list = Array.isArray(topics) ? topics : [];
  const cap = Math.max(2, Number(maxSlots) || 6);
  if (list.length <= cap) {
    return { standalone: list, overflow: [] };
  }
  const keepCount = Math.max(1, cap - 1);
  const scored = list.map((tp, idx) => {
    const pending = Number(tp?.pendingCount) || 0;
    const live = Number(tp?.liveCount) || 0;
    const activeCnt = Number(tp?.primaryActiveCount ?? tp?.activeThreads?.length ?? 0);
    const score = (pending > 0 ? 10000 : 0)
      + (live > 0 ? 5000 : 0)
      + (tp?.isBossPinned ? 2500 : 0)
      + (tp?.pinned ? 1200 : 0)
      + (activeCnt > 0 ? 400 : 0);
    return {
      idx,
      score,
      latestUpdatedAt: Number(tp?.latestUpdatedAt) || 0,
    };
  });
  scored.sort((a, b) => (
    (b.score - a.score)
    || (b.latestUpdatedAt - a.latestUpdatedAt)
    || (a.idx - b.idx)
  ));
  const keepIdxSet = new Set(scored.slice(0, keepCount).map((item) => item.idx));
  const standalone = [];
  const overflow = [];
  list.forEach((tp, idx) => {
    if (keepIdxSet.has(idx)) standalone.push(tp);
    else overflow.push(tp);
  });
  return { standalone, overflow };
}

export function buildTycoonWorldLayout(overview, {
  searchText = "",
  selectedTopicId = "",
  selectedRoomId = "all",
  selectedClusterRoomId = "",
} = {}) {
  const domains = Array.isArray(overview?.domains) ? overview.domains : [];
  const incubator = overview?.incubator || { eggs: [] };
  const rooms = [];
  const workstations = [];

  const domainOrder = ["indie-lab", "drama-studio", "global-pub", "bounty-guild"];
  for (let dIdx = 0; dIdx < domainOrder.length; dIdx += 1) {
    const roomId = domainOrder[dIdx];
    const bp = ROOM_BLUEPRINTS[roomId];
    const domainData = domains.find((d) => d.id === roomId) || domains[dIdx] || { id: roomId, name: bp.title, topics: [] };
    const topics = Array.isArray(domainData.topics) ? domainData.topics : [];
    const { standalone, overflow } = partitionRoomTopicsForSlots(topics, bp.maxSlots || 6);

    rooms.push({
      ...bp,
      shortTitle: domainData.shortName || bp.shortTitle,
      name: domainData.name || bp.title,
      liveCount: Number(domainData.liveCount) || 0,
      pendingCount: Number(domainData.pendingCount) || 0,
      harvestCount: Number(domainData.harvestCount) || 0,
      topicCount: topics.length,
      overflowCount: overflow.length,
      isSelected: selectedRoomId === roomId,
    });

    const renderTopics = [...standalone];
    if (overflow.length > 0) {
      const sigCounts = { alert: 0, harvest: 0, ruin: 0 };
      let maxRuinDays = null;
      let anyInferredHarvest = false;
      let anyReadyToHarvest = false;
      for (const member of overflow) {
        const counts = member?.assistantSignals?.counts || {};
        sigCounts.alert += Number(counts.alert) || 0;
        sigCounts.harvest += Number(counts.harvest) || 0;
        sigCounts.ruin += Number(counts.ruin) || 0;
        if (Number.isFinite(Number(member?.assistantSignals?.ruinDays))) {
          maxRuinDays = maxRuinDays === null
            ? Number(member.assistantSignals.ruinDays)
            : Math.max(maxRuinDays, Number(member.assistantSignals.ruinDays));
        }
        if (member?.pipeline?.readyToHarvest || member?.readyToHarvest) anyReadyToHarvest = true;
        if (member?.harvestInferred) anyInferredHarvest = true;
      }
      const topSig = sigCounts.alert > 0 ? "alert" : (sigCounts.harvest > 0 ? "harvest" : (sigCounts.ruin > 0 ? "ruin" : null));
      const mergedSignals = (topSig || anyInferredHarvest)
        ? {
            top: topSig,
            counts: sigCounts,
            ruinDays: maxRuinDays,
            cards: [],
          }
        : undefined;
      const signalTopicId = topSig
        ? (overflow.find((m) => (m?.assistantSignals?.counts?.[topSig] || 0) > 0)?.id || overflow[0].id)
        : overflow[0].id;
      const hubProviders = [...new Set(overflow.flatMap((m) => (Array.isArray(m.activeProviders) ? m.activeProviders : [])))];
      const hubLiveCount = overflow.reduce((s, m) => s + (Number(m.liveCount) || 0), 0);
      const hubPendingCount = overflow.reduce((s, m) => s + (Number(m.pendingCount) || 0), 0);
      const hubActiveCount = overflow.reduce((s, m) => s + Number(m.primaryActiveCount ?? m.activeThreads?.length ?? 0), 0);
      const hubStageIndex = Math.max(1, ...overflow.map((m) => Number(m.pipeline?.stageIndex) || 1));
      renderTopics.push({
        id: `hub:${roomId}`,
        domainId: roomId,
        name: domainData.shortName || bp.shortTitle,
        landmark: overflow[0]?.landmark || "tower",
        yieldType: "growth",
        yieldLabel: "同厂多项目集群",
        pipeline: {
          stageIndex: hubStageIndex,
          stageLabel: PIPELINE_STAGE_LABELS[hubStageIndex] || "研发",
          readyToHarvest: anyReadyToHarvest,
        },
        assistantSignals: mergedSignals,
        signalTopicId,
        harvestInferred: anyInferredHarvest,
        liveCount: hubLiveCount,
        pendingCount: hubPendingCount,
        primaryActiveCount: hubActiveCount,
        sliceCount: overflow.reduce((s, m) => s + (Number(m.sliceCount) || 0), 0),
        gitSnapshot: { dirtyCount: overflow.reduce((s, m) => s + (Number(m.gitSnapshot?.dirtyCount) || 0), 0) },
        metrics: { kpis: [] },
        activeProviders: hubProviders.length ? hubProviders : ["codex"],
        isClusterHub: true,
        clusterRoomId: roomId,
        memberTopicIds: overflow.map((m) => m.id),
        memberTopics: overflow.map((m) => ({
          id: m.id,
          name: m.name,
          liveCount: Number(m.liveCount) || 0,
          pendingCount: Number(m.pendingCount) || 0,
          activeCount: Number(m.primaryActiveCount ?? m.activeThreads?.length ?? 0),
          stageIndex: Math.max(1, Math.min(5, Number(m.pipeline?.stageIndex) || 1)),
          readyToHarvest: Boolean(m.pipeline?.readyToHarvest || m.readyToHarvest),
        })),
        memberCount: overflow.length,
        hubSelected: selectedClusterRoomId === roomId || overflow.some((m) => m.id === selectedTopicId),
        hubSearchHit: overflow.some((m) => topicMatchesSearch(m, searchText)),
      });
    }

    const cols = renderTopics.length <= 1 ? 1 : (renderTopics.length <= 2 ? 2 : (renderTopics.length <= 4 ? 2 : 3));
    const rows = Math.max(1, Math.ceil(renderTopics.length / cols));
    const usableW = bp.w - 5.6;
    const usableD = bp.d - 5.2;

    renderTopics.forEach((tp, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      // Stagger alternate rows slightly so isometric overhead titles never stack vertically
      const staggerX = rows > 1 && cols > 1 ? (row % 2 === 1 ? 0.55 : -0.55) : 0;
      const offsetX = (cols === 1 ? 0 : ((col / (cols - 1)) - 0.5) * usableW) + staggerX;
      const offsetZ = rows === 1 ? 0.8 : ((row / (rows - 1)) - 0.5) * usableD + 0.6;
      const wx = Number((bp.x + offsetX).toFixed(2));
      const wz = Number((bp.z + offsetZ).toFixed(2));

      const liveCount = Number(tp.liveCount) || 0;
      const pendingCount = Number(tp.pendingCount) || 0;
      const activeCnt = Number(tp.primaryActiveCount ?? tp.activeThreads?.length ?? 0);
      const cloneCount = Math.min(2, liveCount >= 2 ? liveCount - 1 : (activeCnt >= 8 ? 1 : 0));
      const providers = Array.isArray(tp.activeProviders) && tp.activeProviders.length
        ? tp.activeProviders
        : ["codex"];

      const kpis = Array.isArray(tp.metrics?.kpis) ? tp.metrics.kpis.slice(0, 2) : [];
      const isClusterHub = Boolean(tp.isClusterHub);

      workstations.push({
        topicId: tp.id,
        roomId,
        archetype: resolveStationArchetype(roomId),
        name: tp.name,
        landmark: tp.landmark || DEFAULT_LANDMARK_FALLBACK[tp.id] || "tower",
        yieldType: tp.yieldType || "growth",
        yieldLabel: tp.yieldLabel || "",
        x: wx,
        z: wz,
        stageIndex: Math.max(1, Math.min(5, Number(tp.pipeline?.stageIndex) || 1)),
        stageLabel: tp.pipeline?.stageLabel || "研发",
        readyToHarvest: Boolean(tp.pipeline?.readyToHarvest),
        assistantSignals: tp.assistantSignals,
        signalTopicId: tp.signalTopicId || tp.id,
        harvestInferred: Boolean(tp.harvestInferred),
        liveCount,
        pendingCount,
        activeCount: activeCnt,
        sliceCount: Number(tp.sliceCount) || 0,
        dirtyCount: Number(tp.gitSnapshot?.dirtyCount) || 0,
        kpis,
        primaryProvider: providers[0] || "codex",
        cloneProviders: Array.from({ length: cloneCount }, (_, i) => providers[(i + 1) % providers.length] || "claude"),
        isClusterHub,
        clusterRoomId: isClusterHub ? roomId : "",
        memberTopicIds: isClusterHub ? (tp.memberTopicIds || []) : [],
        memberTopics: isClusterHub ? (tp.memberTopics || []) : [],
        memberCount: isClusterHub ? (Number(tp.memberCount) || 0) : 0,
        subProjectCount: isClusterHub ? 0 : (Array.isArray(tp.subProjects) ? tp.subProjects.length : 0),
        isSelected: isClusterHub ? Boolean(tp.hubSelected) : (selectedTopicId === tp.id),
        isSearchHit: isClusterHub ? Boolean(tp.hubSearchHit) : topicMatchesSearch(tp, searchText),
      });
    });
  }

  const incBp = ROOM_BLUEPRINTS.incubator;
  const rawEggs = Array.isArray(incubator.eggs) ? incubator.eggs.slice(0, 6) : [];
  const eggs = rawEggs.map((egg, idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const ex = Number((incBp.x + (col === 0 ? -1.7 : 1.7)).toFixed(2));
    const ez = Number((incBp.z - 2.4 + row * 2.8).toFixed(2));
    return {
      id: egg.id,
      title: egg.title,
      topicId: egg.topicId || "",
      threadId: egg.threadId || "",
      freshnessTier: egg.freshnessTier || "warm",
      x: ex,
      z: ez,
    };
  });

  rooms.push({
    ...incBp,
    name: incBp.title,
    liveCount: 0,
    pendingCount: 0,
    harvestCount: eggs.filter((e) => e.freshnessTier === "hot").length,
    eggCount: eggs.length,
    isSelected: selectedRoomId === "incubator",
  });

  return { rooms, workstations, eggs };
}

// ---------------------------------------------------------------------------
// Rendering engine (PBR + ACES tone mapping + procedural environment)
// ---------------------------------------------------------------------------

const PLAT_TOP = 0.36;

// Campus pad bounds derived from room blueprints (+ margin)
const CAMPUS = (() => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const bp of Object.values(ROOM_BLUEPRINTS)) {
    minX = Math.min(minX, bp.x - bp.w / 2);
    maxX = Math.max(maxX, bp.x + bp.w / 2);
    minZ = Math.min(minZ, bp.z - bp.d / 2);
    maxZ = Math.max(maxZ, bp.z + bp.d / 2);
  }
  return { minX: minX - 2.4, maxX: maxX + 2.4, minZ: minZ - 2.4, maxZ: maxZ + 2.4 };
})();
const BLVD_Z = 0.35;
const BLVD_W = 2.8;
const POND = { x: -33.5, z: 4, rx: 3.8, rz: 6.2 };

function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp01(v) {
  return v < 0 ? 0 : (v > 1 ? 1 : v);
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function lerp(a, b, k) {
  return a + (b - a) * k;
}

function smoothstep(edge0, edge1, x) {
  const k = clamp01((x - edge0) / (edge1 - edge0));
  return k * k * (3 - 2 * k);
}

export function shortestAngleDelta(from, to) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

const TYCOON_VIS_PREFS_KEY = "ac-tycoon-vis-prefs";
const DEFAULT_VIS_PREFS = Object.freeze({
  perspective: false,
  tiltShift: false,
  bloom: true,
});

export function readTycoonVisualPrefs() {
  try {
    if (typeof localStorage === "undefined") return { ...DEFAULT_VIS_PREFS };
    const raw = localStorage.getItem(TYCOON_VIS_PREFS_KEY);
    if (!raw) return { ...DEFAULT_VIS_PREFS };
    const parsed = JSON.parse(raw);
    return {
      perspective: Boolean(parsed?.perspective),
      tiltShift: Boolean(parsed?.tiltShift),
      bloom: parsed?.bloom !== false,
    };
  } catch {
    return { ...DEFAULT_VIS_PREFS };
  }
}

export function writeTycoonVisualPrefs(patch = {}) {
  const next = { ...readTycoonVisualPrefs(), ...patch };
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(TYCOON_VIS_PREFS_KEY, JSON.stringify(next));
    }
  } catch {}
  return next;
}

const TYCOON_THEME_TUNING = Object.freeze({
  light: Object.freeze({
    env: Object.freeze({
      top: 0x7c9fc4,
      horizon: 0xaec0d4,
      bottom: 0x5a685e,
      softboxes: Object.freeze([
        Object.freeze([1.25, 1.18, 1.05]),
        Object.freeze([0.55, 0.68, 0.85]),
        Object.freeze([0.78, 0.62, 0.44]),
        Object.freeze([0.42, 0.46, 0.54]),
      ]),
    }),
    lights: Object.freeze({
      hemiSky: 0xcce0f5,
      hemiGround: 0x5c6b5e,
      hemiIntensity: 0.32,
      keyColor: 0xfff0d4,
      keyIntensity: 2.35,
      rimColor: 0x93c5fd,
      rimIntensity: 0.42,
    }),
    post: Object.freeze({
      exposure: 0.9,
      bloomThr: 1.35,
      bloomKnee: 0.55,
      bloomStrength: 0.16,
      vignette: 0.14,
    }),
  }),
  dark: Object.freeze({
    env: Object.freeze({
      top: 0x1d3a7a,
      horizon: 0x0b1530,
      bottom: 0x02040a,
      softboxes: Object.freeze([
        Object.freeze([2.4, 2.5, 2.8]),
        Object.freeze([0.5, 1.4, 2.4]),
        Object.freeze([2.2, 1.1, 0.5]),
        Object.freeze([0.6, 0.4, 1.4]),
      ]),
    }),
    lights: Object.freeze({
      hemiSky: 0x7f9cd6,
      hemiGround: 0x0a1410,
      hemiIntensity: 0.5,
      keyColor: 0xc7d8ff,
      keyIntensity: 1.5,
      rimColor: 0x60a5fa,
      rimIntensity: 1.5,
    }),
    post: Object.freeze({
      exposure: 1.15,
      bloomThr: 0.78,
      bloomKnee: 0.58,
      bloomStrength: 0.8,
      vignette: 0.42,
    }),
  }),
});

export function resolveTycoonThemeTuning(theme = "dark") {
  return theme === "light" ? TYCOON_THEME_TUNING.light : TYCOON_THEME_TUNING.dark;
}

const ISO_OFFSET_CONST = { x: 28, y: 25, z: 28 };
const ISO_ELEV_DEG = (Math.atan2(ISO_OFFSET_CONST.y, Math.hypot(ISO_OFFSET_CONST.x, ISO_OFFSET_CONST.z)) * 180) / Math.PI;

export function computePerspectiveRigPose({
  x = 0,
  z = 0,
  zoom = 1,
  blend = 1,
  baseHalfH = 15.5,
} = {}) {
  const zClamped = Math.max(0.62, Math.min(2.35, Number(zoom) || 1));
  const b = clamp01(Number(blend) || 0);
  const fov = lerp(6, 36, easeOutCubic(b));
  const halfFovRad = (fov * Math.PI) / 360;
  const dist = (baseHalfH / zClamped) / Math.tan(halfFovRad);
  const zoomRamp = smoothstep(1.0, 1.42, zClamped);
  const targetPitchDeg = lerp(40, 24, zoomRamp);
  const pitchDeg = lerp(ISO_ELEV_DEG, targetPitchDeg, b);
  const pitchRad = (pitchDeg * Math.PI) / 180;
  const lookY = lerp(0, 1.15, smoothstep(1.05, 1.42, zClamped)) * b;
  const horiz = dist * Math.cos(pitchRad);
  const camY = lookY + dist * Math.sin(pitchRad);
  const camX = x + horiz * Math.SQRT1_2;
  const camZ = z + horiz * Math.SQRT1_2;
  return {
    fov,
    dist,
    pitchDeg,
    lookY,
    pos: [camX, camY, camZ],
    look: [x, lookY, z],
  };
}

export function resolveWorkstationLodMode({
  zoom = 1,
  isPending = false,
  isSelected = false,
  isSearchHit = false,
  isHovered = false,
  isResting = false,
  compactViewport = false,
} = {}) {
  if (isPending || isSelected || isSearchHit || isHovered) {
    return "full";
  }
  if (compactViewport && isResting) {
    return "micro";
  }
  if (zoom >= 1.3) {
    return "full";
  }
  if (zoom < 0.85) {
    return isResting ? "micro" : "mid";
  }
  return "mid";
}

export function formatRoomBannerHtml(rm = {}) {
  const topicCount = Math.max(0, Number(rm.topicCount) || 0);
  return `${escapeHtml(rm.shortTitle || rm.title || "")}${topicCount > 0 ? ` · ${topicCount}` : ""}`;
}

export function shouldShowRoomBanner({ viewportWidth = 1024, zoom = 1, selectedRoomId = "all" } = {}) {
  if (Number(viewportWidth) < 780) return false;
  if (selectedRoomId && selectedRoomId !== "all") return false;
  if (Number(zoom) >= 1.18) return false;
  return true;
}

export function renderWorkstationTagHtml(ws = {}, act = {}, { signalBadge, signalTitle } = {}) {
  const isPending = Boolean(act.isPending);
  const isWorking = Boolean(act.isWorking);
  const isResting = act.isResting !== undefined ? Boolean(act.isResting) : (!isPending && !isWorking);
  const stateIconPath = isPending
    ? `<path d="M8 2.6v6.2M8 11.9v.6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`
    : `<path d="M9.1 1.75 3.6 9h4.1l-1 5.25 5.7-7.25H8.3l.8-5.25Z" fill="currentColor" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>`;
  const state = act.state || (isPending ? "pending" : (isWorking ? "working" : "resting"));
  const intensityTier = Number(act.intensityTier) || 0;
  const statePillHtml = !isResting
    ? `<span class="tycoon3d-state-pill is-${escapeHtml(state)} is-tier-${intensityTier}"><svg class="tycoon3d-state-ico" viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden="true">${stateIconPath}</svg><span class="tycoon3d-state-txt">${escapeHtml(act.statusText || "")}</span></span>`
    : "";
  const resolvedBadge = signalBadge === undefined ? selectAssistantSignalBadge(ws, assistantLocale()) : signalBadge;
  const resolvedTitle = signalTitle || (resolvedBadge ? (assistantText(
    { alert: "等你拍板", harvest: resolvedBadge.inferred ? "准收菜（推测）" : "收菜", ruin: "烂尾" }[resolvedBadge.type] || "",
    { alert: "Needs your decision", harvest: resolvedBadge.inferred ? "Almost ready (inferred)" : "Ready to review", ruin: "Unfinished" }[resolvedBadge.type] || "",
  ) || "") : "");
  const badgeType = resolvedBadge ? escapeHtml(String(resolvedBadge.type || "")) : "";
  const signalHtml = resolvedBadge
    ? `<span class="tycoon-signal-badge is-${badgeType}${resolvedBadge.inferred ? " is-inferred" : ""}" data-signal-type="${badgeType}" role="button" tabindex="0" aria-label="${escapeHtml(resolvedTitle)}" title="${escapeHtml(resolvedTitle)}">${escapeHtml(resolvedBadge.text || "")}</span>`
    : "";
  const harvestBadgeHtml = !ws.assistantSignals && act.showHarvest ? `<span class="tycoon3d-mini-badge is-coin">$收菜</span>` : "";
  const memberCount = Math.max(0, Number(ws.memberCount) || 0);
  const subCount = Math.max(0, Number(ws.subProjectCount) || 0);
  const clusterPillHtml = ws.isClusterHub && memberCount > 0
    ? `<span class="tycoon3d-cluster-pill" title="展开 ${memberCount} 个同厂项目">+${memberCount}</span>`
    : (subCount >= 2 ? `<span class="tycoon3d-cluster-pill is-sub" title="${subCount} 个子项目">+${subCount}</span>` : "");
  return `<div class="tycoon3d-tag-top">${statePillHtml}<strong class="tycoon3d-name">${escapeHtml(ws.name || "")}</strong>${clusterPillHtml}${harvestBadgeHtml}${signalHtml}</div>`;
}

export function measureTagNamePx(name = "") {
  return Array.from(String(name || "")).reduce((sum, ch) => sum + (ch.charCodeAt(0) > 255 ? 11 : 6.5), 0);
}

export function estimateWorkstationLabelSize(ws = {}, act = {}, { lodMode = "mid", badge = null, namePx } = {}) {
  const resolvedNamePx = Number.isFinite(namePx) ? namePx : measureTagNamePx(ws.name);
  let w = Math.max(54, Math.ceil(resolvedNamePx) + (lodMode === "micro" ? 16 : 20));
  if (!act.isResting) {
    w += Math.ceil(String(act.statusText || "").length * 10 + 24);
  }
  if (badge) {
    w += String(badge.text || "").length * 7 + 16;
  } else if (!ws.assistantSignals && act.showHarvest) {
    w += 38;
  }
  const memberCount = Math.max(0, Number(ws.memberCount) || 0);
  const subCount = Math.max(0, Number(ws.subProjectCount) || 0);
  if ((ws.isClusterHub && memberCount > 0) || subCount >= 2) {
    w += 26;
  }
  const h = (lodMode === "micro" || act.isResting) ? 24 : 28;
  return { w, h };
}

function boxOverlapArea(a, b, pad = 6) {
  const ox = Math.min(a.right + pad, b.right + pad) - Math.max(a.left - pad, b.left - pad);
  if (ox <= 0) return 0;
  const oy = Math.min(a.bottom + pad, b.bottom + pad) - Math.max(a.top - pad, b.top - pad);
  return oy > 0 ? ox * oy : 0;
}

export function resolveLabelCollisionLayout(items = [], viewport = { w: 1024, h: 680 }) {
  const width = Math.max(300, Number(viewport?.w) || 1024);
  const height = Math.max(280, Number(viewport?.h) || 680);
  const sorted = [...items]
    .filter((it) => it && it.visible)
    .sort((a, b) => (b.priority - a.priority) || (a.ay - b.ay) || String(a.id).localeCompare(String(b.id)));

  const placed = [];
  const result = new Map();
  const minTop = 52;
  const maxBottom = height - 62;

  for (const it of sorted) {
    const halfW = it.w / 2;
    const minX = halfW + 8;
    const maxX = Math.max(minX, width - halfW - 8);
    const baseLx = Math.max(minX, Math.min(maxX, it.ax));
    const baseLy = Math.max(minTop + it.h, Math.min(maxBottom, it.ay));

    const candidates = [
      [0, 0],
      [0, -26],
      [0, -52],
      [-it.w * 0.48, -22],
      [it.w * 0.48, -22],
      [0, -78],
      [-it.w * 0.65, -48],
      [it.w * 0.65, -48],
      [0, 28],
      [-it.w * 0.8, 0],
      [it.w * 0.8, 0],
    ];

    let bestLx = baseLx;
    let bestLy = baseLy;
    let bestCost = Infinity;

    for (const [dx, dy] of candidates) {
      const lx = Math.max(minX, Math.min(maxX, it.ax + dx));
      const ly = Math.max(minTop + it.h, Math.min(maxBottom, it.ay + dy));
      const box = { left: lx - halfW, right: lx + halfW, top: ly - it.h, bottom: ly };
      let overlap = 0;
      for (let i = 0; i < placed.length; i += 1) {
        overlap += boxOverlapArea(box, placed[i], 5);
      }
      const movePenalty = Math.hypot(lx - it.ax, ly - it.ay) * 0.25;
      const cost = overlap * 100 + movePenalty;
      if (overlap === 0) {
        bestLx = lx;
        bestLy = ly;
        bestCost = cost;
        break;
      }
      if (cost < bestCost) {
        bestCost = cost;
        bestLx = lx;
        bestLy = ly;
      }
    }

    placed.push({ left: bestLx - halfW, right: bestLx + halfW, top: bestLy - it.h, bottom: bestLy });
    const offX = bestLx - it.ax;
    const offY = bestLy - it.ay;
    result.set(it.id, {
      x: bestLx,
      y: bestLy,
      offX,
      offY,
      dist: Math.hypot(offX, offY),
    });
  }

  return result;
}

const FSQ_VERT = "varying vec2 vUv;\nvoid main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }";

const BRIGHT_FRAG = `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThr, uKnee;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv + uTexel * vec2(-0.5, -0.5)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2( 0.5, -0.5)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2(-0.5,  0.5)).rgb
         + texture2D(tSrc, vUv + uTexel * vec2( 0.5,  0.5)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  c *= smoothstep(uThr, uThr + uKnee, l);
  gl_FragColor = vec4(min(c, vec3(24.0)), 1.0);
}`;

const BLUR_FRAG = `
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += texture2D(tSrc, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  c += texture2D(tSrc, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const COMPOSITE_FRAG = `
uniform sampler2D tScene, tTs1, tTs2, tB1, tB2;
uniform float uExposure, uBloom, uFocusY, uFocusHalf, uTs, uVig, uGrain, uFrame, uAspect;
varying vec2 vUv;
vec3 RRTAndODTFit(vec3 v){
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 aces(vec3 color){
  const mat3 IN = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 OUT = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  color *= uExposure / 0.6;
  color = IN * color;
  color = RRTAndODTFit(color);
  color = OUT * color;
  return clamp(color, 0.0, 1.0);
}
vec3 toSRGB(vec3 c){
  return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
}
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
void main(){
  vec3 col = texture2D(tScene, vUv).rgb;
  if (uTs > 0.001) {
    vec3 b1 = texture2D(tTs1, vUv).rgb;
    vec3 b2 = texture2D(tTs2, vUv).rgb;
    float k = smoothstep(uFocusHalf, uFocusHalf + 0.3, abs(vUv.y - uFocusY)) * uTs;
    col = k < 0.5 ? mix(col, b1, k * 2.0) : mix(b1, b2, k * 2.0 - 1.0);
  }
  if (uBloom > 0.001) {
    vec3 bloom = texture2D(tB1, vUv).rgb * 0.88 + texture2D(tB2, vUv).rgb * 0.72;
    col += bloom * uBloom;
  }
  col = aces(col);
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  col *= mix(1.0, smoothstep(1.18, 0.26, length(q)), uVig);
  col = toSRGB(col);
  col += (hash(gl_FragCoord.xy + uFrame * 17.0) - 0.5) * uGrain;
  gl_FragColor = vec4(col, 1.0);
}`;

const GRID_VERT = "varying vec2 vP;\nvoid main(){ vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }";
const GRID_FRAG = `
uniform float uT, uImp;
uniform vec2 uImpC;
uniform vec3 uCol, uGold;
varying vec2 vP;
void main(){
  vec2 q = vP / 2.0;
  vec2 fw = fwidth(q);
  vec2 g = abs(fract(q - 0.5) - 0.5) / max(fw, vec2(0.0001));
  float line = (1.0 - min(min(g.x, g.y), 1.0)) * (1.0 - smoothstep(0.35, 0.9, max(fw.x, fw.y)));
  float r = length(vP);
  float fall = 1.0 - smoothstep(18.0, 48.0, r);
  float base = 0.055 * fall;
  float di = uT - uImp;
  float ri = length(vP - uImpC);
  float bi = (di < 0.0 || di > 4.0) ? 0.0 : exp(-pow((ri - 15.0 * di) / 1.5, 2.0)) * exp(-di * 1.15);
  vec3 col = uCol * base * line + uGold * bi * (line * 1.5 + 0.09);
  gl_FragColor = vec4(col, 1.0);
}`;

const PIPELINE_STAGE_LABELS = Object.freeze({ 1: "立项", 2: "研发", 3: "打磨", 4: "宣发", 5: "收菜" });

export function createTycoon3DWorld(containerEl, {
  onSelectTopic = null,
  onSelectCluster = null,
  onSelectRoom = null,
  onSelectIncubator = null,
  onSelectSprite = null,
  onSignalBadgeClick = null,
  onSpriteBubbleClick = null,
  onClearSelection = null,
} = {}) {
  let THREE = null;
  let spriteRecord = null;
  const spriteBrain = createSpriteBrain();
  let spriteMood = "patrol";
  let lastSpriteLegacyMood = "idle";
  let spriteOverrideUntil = 0;
  let spriteBubble = null;
  let spriteUserBusy = false;
  let spriteMotion = null;
  let spriteMotionTimer = null;
  let spriteProactive = [];
  const SPRITE_MOODS = new Set(["patrol", "inspect", "guide", "thinking", "report", "good", "worry", "waiting", "listening", "idle"]);
  let renderer = null;
  let scene = null;
  let camera = null;
  let orthoCam = null;
  let perspCam = null;
  let rafId = 0;
  let running = false;
  let disposed = false;
  let initialized = false;
  let lastOverview = null;
  let lastUiState = {};
  let currentTheme = "";
  let lastFrameAt = 0;
  let currentAnimTime = 0;
  let frameCounter = 0;

  // Dual-camera rig (isometric orthographic <-> 36 deg miniature perspective)
  const BASE_FRUSTUM_HALF_H = 15.5;
  const ISO_OFFSET = ISO_OFFSET_CONST;
  const camGoal = { x: 0.5, z: 0.4, zoom: 0.92 };
  const camCurr = { x: 0.5, z: 0.4, zoom: 0.92 };
  const panVelocity = { x: 0, z: 0 };
  const heldKeys = new Set();
  const visPrefs = readTycoonVisualPrefs();
  let perspBlend = visPrefs.perspective ? 1 : 0;
  let perspTarget = visPrefs.perspective ? 1 : 0;
  let isUserDragging = false;
  let chaseState = { active: false, tx: 0, tz: 0 };
  let impactShakeAt = -100;
  let lastPendingJumpId = "";

  // Shared GPU resources
  const tex = {};
  let envRT = null;
  const matCache = new Map();
  const geoCache = new Map();

  // Scene graph handles
  let floorMesh = null;
  let poolMesh = null;
  let gridMesh = null;
  let gridMat = null;
  let hemiLight = null;
  let keyLight = null;
  let rimLight = null;
  let nexusParts = null;
  let dynamicGroup = null;
  let eggGroup = null;
  let fxGroup = null;
  let envGroup = null;
  const envAnimators = [];
  let particles = null;
  let particleBase = null;
  let particleSpeeds = null;

  // Post-processing handles (desktop only)
  let postScene = null;
  let postCam = null;
  let postQuad = null;
  let brightMat = null;
  let blurMat = null;
  let compMat = null;
  let postRT = null;
  let postW = 0;
  let postH = 0;

  const interactiveMeshes = [];
  const wsRecords = new Map();
  const roomRecords = new Map();
  const animators = [];
  const eggAnimators = [];
  const eggHitMeshes = [];
  const packets = [];
  const ripples = [];
  const seenTopicIds = new Set();
  let lastThemeSig = "";
  let lastRoomsStructSig = "";
  let lastEggsSig = "";
  const lastWsSigs = new Map();
  let firstBuildDone = false;
  let hoveredKey = "";
  let labelHoverKey = "";
  const cleanupFns = [];

  // DOM layers
  const canvasWrap = document.createElement("div");
  canvasWrap.className = "tycoon3d-canvas-wrap";
  const labelsWrap = document.createElement("div");
  labelsWrap.className = "tycoon3d-labels-layer";
  const leaderSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  leaderSvg.setAttribute("class", "tycoon3d-leader-svg");
  leaderSvg.setAttribute("aria-hidden", "true");
  labelsWrap.appendChild(leaderSvg);
  const fallbackBanner = document.createElement("div");
  fallbackBanner.className = "tycoon3d-loading-hint";
  fallbackBanner.textContent = "正在构筑等距 3D 梦工厂地图…";
  containerEl.innerHTML = "";
  containerEl.appendChild(canvasWrap);
  containerEl.appendChild(labelsWrap);
  containerEl.appendChild(fallbackBanner);

  const isLight = () => currentTheme === "light";
  const glowFactor = () => (isLight() ? 0.55 : 1);
  const isMobilePerf = Boolean(
    typeof window !== "undefined" && (
      window.matchMedia?.("(pointer: coarse)")?.matches
      || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "")
      || window.innerWidth <= 768
    )
  );
  const spriteReducedMotion = () => isMobilePerf || Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  let cachedViewport = { w: 1024, h: 680 };
  let lastRenderAt = 0;

  function readResolvedTheme() {
    return document.documentElement?.dataset?.theme === "light" ? "light" : "dark";
  }

  // ---------------------------------------------------------------- textures
  function canvasTex(w, h, draw, { srgb = true, repeat = false } = {}) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) {
      t.wrapS = THREE.RepeatWrapping;
      t.wrapT = THREE.RepeatWrapping;
    }
    t.anisotropy = isMobilePerf ? 1 : Math.min(8, renderer?.capabilities?.getMaxAnisotropy?.() || 1);
    return t;
  }

  function disposeSharedTextures() {
    for (const key of Object.keys(tex)) {
      tex[key]?.dispose?.();
      delete tex[key];
    }
  }

  function createSharedTextures() {
    disposeSharedTextures();
    const light = isLight();

    tex.glow = canvasTex(128, 128, (g, w, h) => {
      const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      grd.addColorStop(0, "rgba(255,255,255,1)");
      grd.addColorStop(0.2, "rgba(255,255,255,0.6)");
      grd.addColorStop(0.5, "rgba(255,255,255,0.14)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }, { srgb: false });

    tex.grass = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = light ? "#4f8246" : "#13291c";
      g.fillRect(0, 0, w, h);
      const r = seededRandom(7);
      for (let i = 0; i < 3200; i += 1) {
        const x = r() * w;
        const y = r() * h;
        const l = r();
        g.fillStyle = light
          ? (l > 0.5 ? "rgba(34,78,32,0.34)" : "rgba(124,172,92,0.28)")
          : (l > 0.5 ? "rgba(8,30,18,0.45)" : "rgba(50,95,62,0.32)");
        g.fillRect(x, y, 1.6, 3.2);
      }
      for (let i = 0; i < 14; i += 1) {
        const x = r() * w;
        const y = r() * h;
        const grd = g.createRadialGradient(x, y, 0, x, y, 30 + r() * 30);
        grd.addColorStop(0, light ? "rgba(92,138,60,0.22)" : "rgba(30,70,45,0.3)");
        grd.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
      }
    }, { repeat: true });
    tex.grass.repeat.set(40, 30);

    tex.concrete = canvasTex(512, 512, (g, w, h) => {
      g.fillStyle = light ? "#9aa8ba" : "#161e2d";
      g.fillRect(0, 0, w, h);
      const r = seededRandom(11);
      for (let i = 0; i < 9000; i += 1) {
        const bright = r() > 0.5;
        g.fillStyle = bright
          ? (light ? "rgba(255,255,255,0.12)" : "rgba(148,163,184,0.06)")
          : (light ? "rgba(30,41,59,0.12)" : "rgba(0,0,0,0.22)");
        g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5);
      }
      g.strokeStyle = light ? "rgba(51,65,85,0.42)" : "rgba(0,0,0,0.55)";
      g.lineWidth = 2;
      for (let i = 0; i <= w; i += 256) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke();
      }
      g.strokeStyle = light ? "rgba(255,255,255,0.22)" : "rgba(56,189,248,0.05)";
      g.lineWidth = 1;
      for (let i = 2; i <= w; i += 256) {
        g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke();
        g.beginPath(); g.moveTo(0, i); g.lineTo(w, i); g.stroke();
      }
    }, { repeat: true });

    tex.stone = canvasTex(256, 256, (g, w, h) => {
      const r = seededRandom(23);
      g.fillStyle = light ? "#8d8477" : "#1f2636";
      g.fillRect(0, 0, w, h);
      const bw = 64;
      const bh = 32;
      for (let row = 0; row < h / bh; row += 1) {
        const off = row % 2 ? bw / 2 : 0;
        for (let col = -1; col < w / bw + 1; col += 1) {
          const v = r();
          const base = light ? [198, 187, 169] : [44, 52, 70];
          const k = (v - 0.5) * (light ? 20 : 14);
          g.fillStyle = `rgb(${Math.round(base[0] + k)},${Math.round(base[1] + k)},${Math.round(base[2] + k)})`;
          g.fillRect(col * bw + off + 2, row * bh + 2, bw - 4, bh - 4);
        }
      }
    }, { repeat: true });

    tex.code = canvasTex(128, 256, (g, w, h) => {
      g.fillStyle = "#06101f";
      g.fillRect(0, 0, w, h);
      const palette = ["#38bdf8", "#34d399", "#a78bfa", "#f472b6", "#fbbf24", "#94a3b8", "#e2e8f0"];
      let y = 6;
      while (y < h - 4) {
        let x = 6 + (Math.random() < 0.35 ? 12 : 0) + (Math.random() < 0.2 ? 12 : 0);
        const segs = 1 + Math.floor(Math.random() * 3);
        for (let s = 0; s < segs; s += 1) {
          const len = 8 + Math.random() * 38;
          g.fillStyle = palette[Math.floor(Math.random() * palette.length)];
          g.globalAlpha = 0.9;
          g.fillRect(x, y, len, 4);
          x += len + 6;
          if (x > w - 10) break;
        }
        y += 9;
      }
      g.globalAlpha = 1;
    }, { repeat: true });

    tex.flow = canvasTex(32, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.fillStyle = "rgba(255,255,255,0.16)";
      g.fillRect(0, 0, w, h);
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, "rgba(255,255,255,0)");
      grd.addColorStop(0.45, "rgba(255,255,255,1)");
      grd.addColorStop(0.6, "rgba(255,255,255,0.15)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.fillRect(9, 0, 14, h);
    }, { repeat: true, srgb: false });

    tex.beam = canvasTex(4, 128, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      grd.addColorStop(0, "rgba(255,255,255,0)");
      grd.addColorStop(0.65, "rgba(255,255,255,0.5)");
      grd.addColorStop(1, "rgba(255,255,255,1)");
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }, { srgb: false });

    tex.wall = canvasTex(256, 64, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, w, 0);
      grd.addColorStop(0, "#7c3aed");
      grd.addColorStop(0.25, "#db2777");
      grd.addColorStop(0.5, "#f59e0b");
      grd.addColorStop(0.75, "#0ea5e9");
      grd.addColorStop(1, "#7c3aed");
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
      g.fillStyle = "rgba(0,0,0,0.25)";
      for (let y = 0; y < h; y += 4) g.fillRect(0, y, w, 1);
    }, { repeat: true });

    tex.pool = canvasTex(256, 256, (g, w, h) => {
      const grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
      grd.addColorStop(0, "rgba(255,255,255,0.9)");
      grd.addColorStop(0.45, "rgba(255,255,255,0.3)");
      grd.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    }, { srgb: false });

    tex.bg = canvasTex(8, 512, (g, w, h) => {
      const grd = g.createLinearGradient(0, 0, 0, h);
      if (light) {
        grd.addColorStop(0, "#cdd8e8");
        grd.addColorStop(0.55, "#b8c7dc");
        grd.addColorStop(1, "#9fb2cc");
      } else {
        grd.addColorStop(0, "#0e1b38");
        grd.addColorStop(0.5, "#08112a");
        grd.addColorStop(1, "#03060e");
      }
      g.fillStyle = grd;
      g.fillRect(0, 0, w, h);
    });

    tex.zzz = canvasTex(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.textAlign = "center";
      g.textBaseline = "middle";
      const mainColor = light ? "#475569" : "#cbd5e1";
      const strokeColor = light ? "rgba(255,255,255,0.92)" : "rgba(15,23,42,0.92)";
      const drawZ = (char, x, y, size, angle) => {
        g.save();
        g.translate(x, y);
        g.rotate(angle);
        g.font = `900 ${size}px ui-sans-serif, system-ui, -apple-system, sans-serif`;
        g.lineWidth = 6;
        g.strokeStyle = strokeColor;
        g.strokeText(char, 0, 0);
        g.fillStyle = mainColor;
        g.fillText(char, 0, 0);
        g.restore();
      };
      drawZ("z", 40, 86, 34, -0.14);
      drawZ("Z", 82, 42, 48, 0.12);
    });

    tex.hazard = canvasTex(256, 64, (g, w, h) => {
      g.fillStyle = "#1e293b";
      g.fillRect(0, 0, w, h);
      g.fillStyle = "#f59e0b";
      for (let x = -h; x < w + h; x += 32) {
        g.beginPath();
        g.moveTo(x, h);
        g.lineTo(x + 16, h);
        g.lineTo(x + 16 + h, 0);
        g.lineTo(x + h, 0);
        g.closePath();
        g.fill();
      }
    }, { repeat: true });
    tex.hazard.repeat.set(8, 1);

    tex.aura = canvasTex(128, 256, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      for (let i = 0; i < 10; i += 1) {
        const cx = ((i + 0.5) / 10) * w;
        const bw = 6 + (i % 3) * 4;
        const grd = g.createLinearGradient(cx, h, cx, 0);
        grd.addColorStop(0, "rgba(255,255,255,0)");
        grd.addColorStop(0.22, "rgba(255,244,190,0.85)");
        grd.addColorStop(0.6, "rgba(251,146,60,0.65)");
        grd.addColorStop(1, "rgba(251,191,36,0)");
        g.fillStyle = grd;
        g.fillRect(cx - bw / 2, 0, bw, h);
      }
    }, { repeat: true });
    tex.aura.repeat.set(2, 1);

    tex.moon = canvasTex(128, 128, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      const tmp = document.createElement("canvas");
      tmp.width = w;
      tmp.height = h;
      const tg = tmp.getContext("2d");
      tg.fillStyle = light ? "#f59e0b" : "#fde68a";
      tg.beginPath();
      tg.arc(58, 66, 40, 0, Math.PI * 2);
      tg.fill();
      tg.globalCompositeOperation = "destination-out";
      tg.beginPath();
      tg.arc(80, 48, 36, 0, Math.PI * 2);
      tg.fill();
      g.save();
      g.shadowColor = light ? "rgba(15,23,42,0.55)" : "rgba(253,230,138,0.85)";
      g.shadowBlur = light ? 6 : 14;
      g.drawImage(tmp, 0, 0);
      g.restore();
      g.fillStyle = light ? "#64748b" : "#f8fafc";
      [[100, 96, 4.5], [108, 26, 3.5], [22, 22, 3]].forEach(([x, y, r]) => {
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      });
    });
  }

  // ------------------------------------------------------- geometry & mats
  function geo(key, factory) {
    let g = geoCache.get(key);
    if (!g) {
      g = factory();
      g.userData.shared = true;
      geoCache.set(key, g);
    }
    return g;
  }

  const boxGeo = (w, h, d) => geo(`box|${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
  const cylGeo = (rt, rb, h, seg = 24, open = false) => geo(`cyl|${rt}|${rb}|${h}|${seg}|${open}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, 1, open));
  const sphereGeo = (r, ws = 24, hs = 18) => geo(`sph|${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
  const capsuleGeo = (r, len) => geo(`cap|${r}|${len}`, () => new THREE.CapsuleGeometry(r, len, 6, 14));
  const torusGeo = (r, tube, rs = 10, ts = 48, arc = Math.PI * 2) => geo(`tor|${r}|${tube}|${rs}|${ts}|${arc}`, () => new THREE.TorusGeometry(r, tube, rs, ts, arc));
  const coneGeo = (r, h, seg = 24, open = false) => geo(`cone|${r}|${h}|${seg}|${open}`, () => new THREE.ConeGeometry(r, h, seg, 1, open));
  const octaGeo = (r) => geo(`octa|${r}`, () => new THREE.OctahedronGeometry(r, 0));

  function roundedRectShape(w, d, r) {
    const s = new THREE.Shape();
    const x = -w / 2;
    const y = -d / 2;
    const rr = Math.max(0.001, Math.min(r, w / 2, d / 2));
    s.moveTo(x + rr, y);
    s.lineTo(x + w - rr, y);
    s.quadraticCurveTo(x + w, y, x + w, y + rr);
    s.lineTo(x + w, y + d - rr);
    s.quadraticCurveTo(x + w, y + d, x + w - rr, y + d);
    s.lineTo(x + rr, y + d);
    s.quadraticCurveTo(x, y + d, x, y + d - rr);
    s.lineTo(x, y + rr);
    s.quadraticCurveTo(x, y, x + rr, y);
    return s;
  }

  // Flat rounded slab (lies on XZ plane, bottom at y=0, total height h)
  function slabGeo(w, d, h, r, bevel = 0.04) {
    return geo(`slab|${w}|${d}|${h}|${r}|${bevel}`, () => {
      const b = Math.min(bevel, h / 2.2);
      const g = new THREE.ExtrudeGeometry(
        roundedRectShape(w - b * 2, d - b * 2, Math.max(0.01, r - b)),
        {
          depth: Math.max(0.001, h - b * 2),
          bevelEnabled: b > 0,
          bevelThickness: b,
          bevelSize: b,
          bevelSegments: 3,
          curveSegments: 10,
        },
      );
      g.rotateX(-Math.PI / 2);
      g.translate(0, b, 0);
      return g;
    });
  }

  // Upright rounded panel (faces +Z, centered)
  function panelGeo(w, h, depth, r) {
    return geo(`panel|${w}|${h}|${depth}|${r}`, () => {
      const b = Math.min(0.03, depth / 3);
      const g = new THREE.ExtrudeGeometry(roundedRectShape(w - b * 2, h - b * 2, Math.max(0.01, r - b)), {
        depth: Math.max(0.001, depth - b * 2),
        bevelEnabled: true,
        bevelThickness: b,
        bevelSize: b,
        bevelSegments: 3,
        curveSegments: 10,
      });
      g.translate(0, 0, -depth / 2 + b);
      return g;
    });
  }

  function cached(key, factory) {
    let m = matCache.get(key);
    if (!m) {
      m = factory();
      m.userData.cached = true;
      matCache.set(key, m);
    }
    return m;
  }

  function phys(color, {
    rough = 0.45,
    metal = 0.05,
    clear = 0,
    emissive = 0x000000,
    ei = 0,
    flat = false,
    opacity = 1,
  } = {}) {
    const key = `p|${color}|${rough}|${metal}|${clear}|${emissive}|${ei}|${flat}|${opacity}`;
    return cached(key, () => {
      if (isMobilePerf || clear <= 0) {
        return new THREE.MeshStandardMaterial({
          color,
          roughness: rough,
          metalness: metal,
          emissive,
          emissiveIntensity: ei,
          flatShading: flat,
          transparent: opacity < 1,
          opacity,
        });
      }
      return new THREE.MeshPhysicalMaterial({
        color,
        roughness: rough,
        metalness: metal,
        clearcoat: clear,
        clearcoatRoughness: 0.22,
        emissive,
        emissiveIntensity: ei,
        flatShading: flat,
        transparent: opacity < 1,
        opacity,
      });
    });
  }

  function neon(color, { opacity = 1, additive = false } = {}) {
    return cached(`n|${color}|${opacity}|${additive}`, () => new THREE.MeshBasicMaterial({
      color,
      toneMapped: false,
      transparent: opacity < 1 || additive,
      opacity,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: !additive,
    }));
  }

  function glassMat(tint = 0xffffff, opacity = 0.18) {
    return cached(`glass|${tint}|${opacity}`, () => (
      isMobilePerf
        ? new THREE.MeshStandardMaterial({
          color: tint,
          roughness: 0.12,
          metalness: 0,
          transparent: true,
          opacity,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
        : new THREE.MeshPhysicalMaterial({
          color: tint,
          roughness: 0.06,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.05,
          transparent: true,
          opacity,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
    ));
  }

  const invisibleMat = () => cached("invisible", () => new THREE.MeshBasicMaterial({ visible: false }));

  function mesh(g, m, { cast = true, receive = false } = {}) {
    const o = new THREE.Mesh(g, m);
    o.castShadow = cast;
    o.receiveShadow = receive;
    return o;
  }

  function glowSprite(color, size, opacity = 0.8) {
    const m = new THREE.SpriteMaterial({
      map: tex.glow,
      color,
      transparent: true,
      opacity: opacity * glowFactor(),
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const s = new THREE.Sprite(m);
    s.scale.set(size, size, 1);
    s.renderOrder = 6;
    s.userData.baseOpacity = opacity * glowFactor();
    return s;
  }

  function disposeTree(root) {
    root.traverse((o) => {
      if (o === root) return;
      if (o.isSprite) {
        o.material?.dispose?.();
        return;
      }
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
      const mats = Array.isArray(o.material) ? o.material : (o.material ? [o.material] : []);
      for (const m of mats) {
        if (!m.userData?.cached) m.dispose();
      }
    });
    while (root.children.length) root.remove(root.children[0]);
  }

  // ------------------------------------------------------------ environment
  function buildEnvMap(light) {
    const { env } = resolveTycoonThemeTuning(light ? "light" : "dark");
    const envScene = new THREE.Scene();
    const sky = new THREE.SphereGeometry(50, 32, 16);
    const pos = sky.attributes.position;
    const top = new THREE.Color(env.top);
    const horizon = new THREE.Color(env.horizon);
    const bottom = new THREE.Color(env.bottom);
    const colors = [];
    for (let i = 0; i < pos.count; i += 1) {
      const y = pos.getY(i) / 50;
      const c = y > 0 ? horizon.clone().lerp(top, y) : horizon.clone().lerp(bottom, -y);
      colors.push(c.r, c.g, c.b);
    }
    sky.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const skyMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
    envScene.add(new THREE.Mesh(sky, skyMat));

    const boxGeoEnv = new THREE.PlaneGeometry(1, 1);
    const softbox = (w, h, pos3, rgb) => {
      const m = new THREE.MeshBasicMaterial({ color: new THREE.Color(rgb[0], rgb[1], rgb[2]), side: THREE.DoubleSide });
      const p = new THREE.Mesh(boxGeoEnv, m);
      p.scale.set(w, h, 1);
      p.position.set(pos3[0], pos3[1], pos3[2]);
      p.lookAt(0, 0, 0);
      envScene.add(p);
      return m;
    };
    const mats = [
      softbox(26, 14, [6, 34, 14], env.softboxes[0]),
      softbox(18, 10, [-36, 12, -6], env.softboxes[1]),
      softbox(14, 8, [30, 10, -24], env.softboxes[2]),
      softbox(20, 6, [0, 6, 38], env.softboxes[3]),
    ];

    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromScene(envScene, 0.035);
    pmrem.dispose();
    sky.dispose();
    skyMat.dispose();
    boxGeoEnv.dispose();
    mats.forEach((m) => m.dispose());
    return rt;
  }

  function applySceneTheme(theme) {
    currentTheme = theme;
    const light = isLight();
    const { lights, post } = resolveTycoonThemeTuning(theme);
    for (const m of matCache.values()) m.dispose();
    matCache.clear();
    createSharedTextures();

    scene.background = tex.bg;
    envRT?.dispose?.();
    envRT = buildEnvMap(light);
    scene.environment = envRT.texture;
    renderer.toneMappingExposure = post.exposure;

    floorMesh.material.map = tex.grass;
    floorMesh.material.color.setHex(0xffffff);
    floorMesh.material.roughness = 0.95;
    floorMesh.material.metalness = 0;
    floorMesh.material.needsUpdate = true;

    poolMesh.material.map = tex.pool;
    poolMesh.material.color.setHex(0x1d4ed8);
    poolMesh.material.opacity = 0.18;
    poolMesh.material.blending = THREE.AdditiveBlending;
    poolMesh.visible = !light;
    poolMesh.material.needsUpdate = true;

    if (gridMesh) {
      gridMesh.visible = !light;
    }
    syncPostThemeUniforms();

    hemiLight.color.setHex(lights.hemiSky);
    hemiLight.groundColor.setHex(lights.hemiGround);
    hemiLight.intensity = lights.hemiIntensity;
    keyLight.color.setHex(lights.keyColor);
    keyLight.intensity = lights.keyIntensity;
    rimLight.color.setHex(lights.rimColor);
    rimLight.intensity = lights.rimIntensity;

    particles.material.map = tex.glow;
    particles.material.color.setHex(light ? 0x60a5fa : 0x7dd3fc);
    particles.material.opacity = light ? 0.28 : 0.6;
    particles.material.blending = light ? THREE.NormalBlending : THREE.AdditiveBlending;
    particles.material.needsUpdate = true;

    buildCampus();
  }

  // --------------------------------------------------------------- campus
  function flatPlane(w, d, mat, { y = 0.02, uvScale = 0 } = {}) {
    const g = new THREE.PlaneGeometry(w, d);
    if (uvScale) {
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i += 1) {
        uv.setXY(i, (uv.getX(i) * w) / uvScale, (uv.getY(i) * d) / uvScale);
      }
    }
    const m = mesh(g, mat, { cast: false, receive: true });
    m.rotation.x = -Math.PI / 2;
    m.position.y = y;
    return m;
  }

  function buildCampus() {
    if (!envGroup) return;
    disposeTree(envGroup);
    envAnimators.length = 0;
    const light = isLight();
    const r = seededRandom(20261118);
    const C = CAMPUS;
    const padW = C.maxX - C.minX;
    const padD = C.maxZ - C.minZ;
    const padCx = (C.minX + C.maxX) / 2;
    const padCz = (C.minZ + C.maxZ) / 2;
    const dummy = new THREE.Object3D();

    const concreteMat = cached("concrete", () => new THREE.MeshStandardMaterial({ map: tex.concrete, roughness: light ? 0.88 : 0.68, metalness: light ? 0 : 0.12 }));
    const stoneMat = cached("stone", () => new THREE.MeshStandardMaterial({ map: tex.stone, roughness: 0.78 }));
    const curbMat = phys(light ? 0x7c8ca1 : 0x2a3345, { rough: 0.72 });
    const edgeMat = phys(light ? 0x64748b : 0x384256, { rough: 0.65 });

    // Concrete campus pad + curbs
    const pad = flatPlane(padW, padD, concreteMat, { y: 0.006, uvScale: 8 });
    pad.position.x = padCx;
    pad.position.z = padCz;
    envGroup.add(pad);
    const curbH = 0.16;
    const curbT = 0.32;
    [
      [padW + curbT * 2, curbT, padCx, C.minZ - curbT / 2],
      [padW + curbT * 2, curbT, padCx, C.maxZ + curbT / 2],
      [curbT, padD, C.minX - curbT / 2, padCz],
      [curbT, padD, C.maxX + curbT / 2, padCz],
    ].forEach(([w, d, x, z]) => {
      const c = mesh(boxGeo(w, curbH, d), curbMat, { cast: true, receive: true });
      c.position.set(x, curbH / 2, z);
      envGroup.add(c);
    });

    // Paved walkways linking every room
    const northEnd = BLVD_Z - BLVD_W / 2;
    const southStart = BLVD_Z + BLVD_W / 2;
    const walks = [
      { x: padCx, z: BLVD_Z, w: padW - 0.4, d: BLVD_W },
      { x: 0.5, z: (C.minZ + 0.2 + northEnd) / 2, w: 2.6, d: northEnd - (C.minZ + 0.2) },
      { x: -5.27, z: (southStart + C.maxZ - 0.2) / 2, w: 1.0, d: (C.maxZ - 0.2) - southStart },
      { x: 11.65, z: (southStart + C.maxZ - 0.2) / 2, w: 0.9, d: (C.maxZ - 0.2) - southStart },
    ];
    walks.forEach((wk) => {
      const p = flatPlane(wk.w, wk.d, stoneMat, { y: 0.016, uvScale: 1.6 });
      p.position.x = wk.x;
      p.position.z = wk.z;
      envGroup.add(p);
      const horizontal = wk.w >= wk.d;
      [-1, 1].forEach((s) => {
        const e = horizontal
          ? mesh(boxGeo(wk.w, 0.05, 0.08), edgeMat, { cast: false, receive: true })
          : mesh(boxGeo(0.08, 0.05, wk.d), edgeMat, { cast: false, receive: true });
        if (horizontal) e.position.set(wk.x, 0.025, wk.z + (s * wk.d) / 2);
        else e.position.set(wk.x + (s * wk.w) / 2, 0.025, wk.z);
        envGroup.add(e);
      });
    });

    // Central plaza around the nexus
    const plaza = mesh(geo("plaza-disc", () => {
      const g = new THREE.CircleGeometry(3.6, 72);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * 4.5, uv.getY(i) * 4.5);
      g.rotateX(-Math.PI / 2);
      return g;
    }), stoneMat, { cast: false, receive: true });
    plaza.position.y = 0.024;
    const brass = mesh(geo("plaza-ring", () => {
      const g = new THREE.RingGeometry(3.42, 3.6, 96);
      g.rotateX(-Math.PI / 2);
      return g;
    }), phys(0xc9a227, { rough: 0.3, metal: 1 }), { cast: false, receive: true });
    brass.position.y = 0.03;
    const inner = mesh(geo("plaza-inner", () => {
      const g = new THREE.RingGeometry(2.2, 2.28, 96);
      g.rotateX(-Math.PI / 2);
      return g;
    }), neon(0x38bdf8, { opacity: light ? 0.55 : 0.8 }), { cast: false });
    inner.position.y = 0.032;
    envGroup.add(plaza, brass, inner);

    // Plaza benches
    const woodMat = phys(light ? 0xb7793f : 0x6b4423, { rough: 0.55, clear: 0.4 });
    const metalMat = phys(light ? 0x475569 : 0x1e293b, { rough: 0.3, metal: 0.85 });
    [0, 180].forEach((deg) => {
      const a = (deg * Math.PI) / 180;
      const b = new THREE.Group();
      b.position.set(Math.cos(a) * 2.95, 0.03, BLVD_Z);
      b.rotation.y = -a + Math.PI / 2;
      const seat = mesh(slabGeo(1.2, 0.38, 0.06, 0.04, 0.015), woodMat);
      seat.position.y = 0.4;
      const back = mesh(boxGeo(1.2, 0.3, 0.05), woodMat);
      back.position.set(0, 0.62, -0.17);
      back.rotation.x = -0.12;
      [-0.5, 0.5].forEach((lx) => {
        const leg = mesh(boxGeo(0.05, 0.4, 0.34), metalMat);
        leg.position.set(lx, 0.2, 0);
        b.add(leg);
      });
      b.add(seat, back);
      envGroup.add(b);
    });

    // Planters with shrubs along the boulevard (instanced)
    const shrubPts = [];
    for (let x = C.minX + 1.6; x <= C.maxX - 1.6; x += 3.2) {
      if (Math.abs(x) < 4.8) continue;
      if (Math.abs(x - 0.5) > 2.3) shrubPts.push([x, northEnd - 0.24]);
      const sx = x + 1.6;
      if (sx < C.maxX - 1 && Math.abs(sx) >= 4.8 && Math.abs(sx + 5.27) > 1.3 && Math.abs(sx - 11.65) > 1.2) {
        shrubPts.push([sx, southStart + 0.24]);
      }
    }
    if (shrubPts.length) {
      const planterGeo = cylGeo(0.34, 0.3, 0.24, 16);
      const planters = new THREE.InstancedMesh(planterGeo, phys(light ? 0x6e7f96 : 0x2b3446, { rough: 0.65 }), shrubPts.length);
      const shrubMat = cached("shrub-mat", () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }));
      const shrubs = new THREE.InstancedMesh(geo("shrub", () => new THREE.IcosahedronGeometry(0.34, 1)), shrubMat, shrubPts.length);
      const col = new THREE.Color();
      shrubPts.forEach(([x, z], i) => {
        dummy.position.set(x, 0.12, z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        planters.setMatrixAt(i, dummy.matrix);
        const s = 0.85 + r() * 0.35;
        dummy.position.set(x, 0.44 * s + 0.18, z);
        dummy.rotation.set(r(), r() * Math.PI, 0);
        dummy.scale.set(s, s * 0.95, s);
        dummy.updateMatrix();
        shrubs.setMatrixAt(i, dummy.matrix);
        col.setHSL(0.28 + r() * 0.06, light ? 0.46 : 0.4, light ? 0.25 + r() * 0.08 : 0.16 + r() * 0.06);
        shrubs.setColorAt(i, col);
      });
      planters.castShadow = true;
      planters.receiveShadow = true;
      shrubs.castShadow = true;
      shrubs.receiveShadow = true;
      envGroup.add(planters, shrubs);
    }

    // Street lamps (glow at night)
    const lampPts = [];
    for (let x = C.minX + 3.2; x <= C.maxX - 2; x += 6.4) {
      if (Math.abs(x) < 5.4) continue;
      lampPts.push([x, northEnd - 0.24, 1]);
      const sx = x + 3.2;
      if (sx < C.maxX - 1 && Math.abs(sx) >= 5.4 && Math.abs(sx + 5.27) > 1.3 && Math.abs(sx - 11.65) > 1.2) {
        lampPts.push([sx, southStart + 0.24, -1]);
      }
    }
    const poleMat = phys(light ? 0x334155 : 0x1e293b, { rough: 0.35, metal: 0.85 });
    const bulbMat = light ? phys(0xfef9c3, { rough: 0.3, emissive: 0xfde68a, ei: 0.3 }) : neon(0xffe7a3);
    lampPts.forEach(([x, z, dir]) => {
      const lg = new THREE.Group();
      lg.position.set(x, 0, z);
      const pole = mesh(cylGeo(0.045, 0.065, 2.4, 10), poleMat);
      pole.position.y = 1.2;
      const base = mesh(cylGeo(0.14, 0.18, 0.14, 12), poleMat);
      base.position.y = 0.07;
      const arm = mesh(boxGeo(0.06, 0.05, 0.55), poleMat);
      arm.position.set(0, 2.36, dir * 0.26);
      const head = mesh(slabGeo(0.3, 0.42, 0.08, 0.06, 0.02), poleMat);
      head.position.set(0, 2.28, dir * 0.5);
      const bulb = mesh(boxGeo(0.22, 0.02, 0.32), bulbMat, { cast: false });
      bulb.position.set(0, 2.27, dir * 0.5);
      lg.add(pole, base, arm, head, bulb);
      if (!light) {
        const halo = glowSprite(0xffd38a, 1.3, 0.75);
        halo.position.set(0, 2.2, dir * 0.5);
        const pool = mesh(geo("lamp-pool", () => {
          const g = new THREE.CircleGeometry(1.9, 40);
          g.rotateX(-Math.PI / 2);
          return g;
        }), cached("lamp-pool-mat", () => new THREE.MeshBasicMaterial({
          map: tex.pool,
          color: 0xffc777,
          transparent: true,
          opacity: 0.32,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        })), { cast: false });
        pool.position.set(0, 0.04, dir * 0.5);
        lg.add(halo, pool);
      }
      envGroup.add(lg);
    });

    // Low hedges along the campus edge with entrances
    const hedgeMat = cached("hedge-mat", () => new THREE.MeshStandardMaterial({ color: light ? 0x3f6e33 : 0x1b3a26, roughness: 0.9, flatShading: true }));
    const hedgeH = 0.55;
    const addHedgeRun = (x1, x2, z, vertical = false) => {
      const len = Math.abs(x2 - x1);
      if (len < 0.8) return;
      const hg = vertical
        ? mesh(slabGeo(0.6, len, hedgeH, 0.25, 0.12), hedgeMat, { cast: true, receive: true })
        : mesh(slabGeo(len, 0.6, hedgeH, 0.25, 0.12), hedgeMat, { cast: true, receive: true });
      if (vertical) hg.position.set(z, 0, (x1 + x2) / 2);
      else hg.position.set((x1 + x2) / 2, 0, z);
      envGroup.add(hg);
    };
    const hedgeOff = 0.95;
    addHedgeRun(C.minX - 0.4, 0.5 - 2.0, C.minZ - hedgeOff);
    addHedgeRun(0.5 + 2.0, C.maxX + 0.4, C.minZ - hedgeOff);
    addHedgeRun(C.minX - 0.4, -5.27 - 1.2, C.maxZ + hedgeOff);
    addHedgeRun(-5.27 + 1.2, 11.65 - 1.1, C.maxZ + hedgeOff);
    addHedgeRun(11.65 + 1.1, C.maxX + 0.4, C.maxZ + hedgeOff);
    addHedgeRun(C.minZ - 0.4, BLVD_Z - BLVD_W / 2 - 0.4, C.minX - hedgeOff, true);
    addHedgeRun(BLVD_Z + BLVD_W / 2 + 0.4, C.maxZ + 0.4, C.minX - hedgeOff, true);
    addHedgeRun(C.minZ - 0.4, BLVD_Z - BLVD_W / 2 - 0.4, C.maxX + hedgeOff, true);
    addHedgeRun(BLVD_Z + BLVD_W / 2 + 0.4, C.maxZ + 0.4, C.maxX + hedgeOff, true);

    // Pond with reflective water and lily pads
    const water = mesh(geo("pond-water", () => {
      const g = new THREE.CircleGeometry(1, 64);
      g.rotateX(-Math.PI / 2);
      return g;
    }), cached("pond-water-mat", () => new THREE.MeshPhysicalMaterial({
      color: light ? 0x3d8db5 : 0x0a3550,
      roughness: 0.04,
      metalness: 0.15,
      clearcoat: 1,
      clearcoatRoughness: 0.02,
      envMapIntensity: 1.5,
    })), { cast: false, receive: true });
    water.scale.set(POND.rx, 1, POND.rz);
    water.position.set(POND.x, 0.03, POND.z);
    const rim = mesh(torusGeo(1, 0.07, 8, 72), phys(light ? 0xa8a29e : 0x3f4656, { rough: 0.8 }), { cast: true, receive: true });
    rim.rotation.x = Math.PI / 2;
    rim.scale.set(POND.rx + 0.05, POND.rz + 0.05, 1.4);
    rim.position.set(POND.x, 0.05, POND.z);
    envGroup.add(water, rim);
    const padMatLily = phys(light ? 0x4d8b3a : 0x245536, { rough: 0.6 });
    for (let i = 0; i < 7; i += 1) {
      const a = r() * Math.PI * 2;
      const rr = 0.25 + r() * 0.6;
      const lily = mesh(geo("lily", () => {
        const g = new THREE.CircleGeometry(0.32, 20, 0.4, Math.PI * 2 - 0.4);
        g.rotateX(-Math.PI / 2);
        return g;
      }), padMatLily, { cast: false });
      lily.position.set(POND.x + Math.cos(a) * POND.rx * rr, 0.045, POND.z + Math.sin(a) * POND.rz * rr);
      lily.rotation.y = r() * Math.PI * 2;
      lily.scale.setScalar(0.7 + r() * 0.6);
      envGroup.add(lily);
    }
    const pondRings = [0, 1].map((i) => {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
      const ringMesh = mesh(geo("pond-ripple", () => {
        const g = new THREE.RingGeometry(0.9, 1, 48);
        g.rotateX(-Math.PI / 2);
        return g;
      }), m, { cast: false });
      ringMesh.position.set(POND.x + (i ? 1.2 : -1), 0.05, POND.z + (i ? -2 : 1.5));
      envGroup.add(ringMesh);
      return { ringMesh, i };
    });
    envAnimators.push((t) => {
      pondRings.forEach(({ ringMesh, i }) => {
        const k = (t * 0.35 + i * 0.5) % 1;
        ringMesh.scale.setScalar(0.2 + k * 1.6);
        ringMesh.material.opacity = (light ? 0.5 : 0.35) * (1 - k);
      });
    });

    // Trees around the campus (instanced low-poly, deterministic layout)
    const treePts = [];
    const blocked = (x, z) => (
      (x > C.minX - 2.2 && x < C.maxX + 2.2 && z > C.minZ - 2.2 && z < C.maxZ + 2.2)
      || (((x - POND.x) / (POND.rx + 1.6)) ** 2 + ((z - POND.z) / (POND.rz + 1.6)) ** 2) < 1
    );
    for (let tries = 0; tries < 4000 && treePts.length < 120; tries += 1) {
      const x = -44 + r() * 86;
      const z = -32 + r() * 64;
      if (blocked(x, z)) continue;
      if (treePts.some((p) => Math.hypot(p[0] - x, p[1] - z) < 2.2)) continue;
      treePts.push([x, z, 0.75 + r() * 0.65, r() < 0.32]);
    }
    const leafy = treePts.filter((p) => !p[3]);
    const conifers = treePts.filter((p) => p[3]);
    const trunkMat = phys(light ? 0x7c5a3c : 0x3b2a1e, { rough: 0.9 });
    const foliageMat = cached("foliage-mat", () => new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, flatShading: true }));
    const col = new THREE.Color();
    const trunks = new THREE.InstancedMesh(cylGeo(0.11, 0.17, 1, 8), trunkMat, treePts.length);
    treePts.forEach(([x, z, s], i) => {
      dummy.position.set(x, 0.55 * s, z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(s, s * 1.1, s);
      dummy.updateMatrix();
      trunks.setMatrixAt(i, dummy.matrix);
    });
    trunks.castShadow = true;
    envGroup.add(trunks);

    if (leafy.length) {
      const canopyA = new THREE.InstancedMesh(geo("canopy", () => new THREE.IcosahedronGeometry(1, 1)), foliageMat, leafy.length);
      const canopyB = new THREE.InstancedMesh(geo("canopy", () => new THREE.IcosahedronGeometry(1, 1)), foliageMat, leafy.length);
      leafy.forEach(([x, z, s], i) => {
        const autumn = r() < 0.12;
        dummy.position.set(x, 1.6 * s, z);
        dummy.rotation.set(r(), r() * Math.PI, r());
        dummy.scale.set(s * 1.05, s * 0.92, s * 1.05);
        dummy.updateMatrix();
        canopyA.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x + (r() - 0.5) * 0.4 * s, 2.3 * s, z + (r() - 0.5) * 0.4 * s);
        dummy.scale.set(s * 0.68, s * 0.64, s * 0.68);
        dummy.updateMatrix();
        canopyB.setMatrixAt(i, dummy.matrix);
        if (autumn) col.setHSL(0.09 + r() * 0.04, 0.65, light ? 0.44 : 0.28);
        else col.setHSL(0.27 + r() * 0.07, light ? 0.48 : 0.42, light ? 0.24 + r() * 0.09 : 0.13 + r() * 0.07);
        canopyA.setColorAt(i, col);
        col.offsetHSL(0, 0, light ? 0.05 : 0.03);
        canopyB.setColorAt(i, col);
      });
      [canopyA, canopyB].forEach((m) => {
        m.castShadow = true;
        m.receiveShadow = true;
        envGroup.add(m);
      });
    }
    if (conifers.length) {
      const coneA = new THREE.InstancedMesh(coneGeo(1, 1.8, 7), foliageMat, conifers.length);
      const coneB = new THREE.InstancedMesh(coneGeo(1, 1.8, 7), foliageMat, conifers.length);
      conifers.forEach(([x, z, s], i) => {
        dummy.rotation.set(0, r() * Math.PI, 0);
        dummy.position.set(x, 1.65 * s, z);
        dummy.scale.set(s * 0.95, s, s * 0.95);
        dummy.updateMatrix();
        coneA.setMatrixAt(i, dummy.matrix);
        dummy.position.set(x, 2.55 * s, z);
        dummy.scale.set(s * 0.65, s * 0.75, s * 0.65);
        dummy.updateMatrix();
        coneB.setMatrixAt(i, dummy.matrix);
        col.setHSL(0.36 + r() * 0.05, light ? 0.44 : 0.38, light ? 0.19 + r() * 0.07 : 0.11 + r() * 0.05);
        coneA.setColorAt(i, col);
        col.offsetHSL(0, 0, 0.04);
        coneB.setColorAt(i, col);
      });
      [coneA, coneB].forEach((m) => {
        m.castShadow = true;
        m.receiveShadow = true;
        envGroup.add(m);
      });
    }

    // Logistics crate stacks in the pad corners
    const crateMat = phys(light ? 0xc08a4f : 0x6b4a2b, { rough: 0.75 });
    const crateBandMat = phys(light ? 0x8a5a2b : 0x3f2a18, { rough: 0.7 });
    [[C.minX + 1.1, C.minZ + 1.1], [C.maxX - 1.1, C.minZ + 1.1], [C.maxX - 1.1, C.maxZ - 1.1]].forEach(([cx, cz], si) => {
      const stack = [[0, 0, 0], [0.75, 0, 0.1], [0.35, 0.66, 0.05]];
      stack.forEach(([dx, dy, dz], ci) => {
        const c = mesh(slabGeo(0.66, 0.66, 0.64, 0.04, 0.02), crateMat, { cast: true, receive: true });
        c.position.set(cx + dx * (si === 1 || si === 2 ? -1 : 1), dy, cz + dz * (si === 2 ? -1 : 1));
        c.rotation.y = (ci - 1) * 0.12;
        const band = mesh(boxGeo(0.68, 0.06, 0.68), crateBandMat, { cast: false });
        band.position.y = 0.32;
        c.add(band);
        envGroup.add(c);
      });
    });

    // Delivery drones shuttling between the nexus and rooms
    const roomTargets = Object.values(ROOM_BLUEPRINTS);
    const droneBodyMat = phys(light ? 0xdbe3ee : 0x1e293b, { rough: light ? 0.34 : 0.25, metal: 0.4, clear: light ? 0.35 : 1 });
    const rotorMat = cached("rotor-mat", () => new THREE.MeshBasicMaterial({ color: light ? 0x334155 : 0x94a3b8, transparent: true, opacity: 0.45, depthWrite: false }));
    for (let i = 0; i < 4; i += 1) {
      const target = roomTargets[i % roomTargets.length];
      const d = new THREE.Group();
      const body = mesh(slabGeo(0.42, 0.42, 0.12, 0.08, 0.03), droneBodyMat);
      const armA = mesh(boxGeo(0.9, 0.03, 0.06), droneBodyMat);
      armA.rotation.y = Math.PI / 4;
      armA.position.y = 0.08;
      const armB = mesh(boxGeo(0.9, 0.03, 0.06), droneBodyMat);
      armB.rotation.y = -Math.PI / 4;
      armB.position.y = 0.08;
      d.add(body, armA, armB);
      const rotors = [];
      [[0.32, 0.32], [-0.32, 0.32], [0.32, -0.32], [-0.32, -0.32]].forEach(([rx, rz]) => {
        const rotor = mesh(cylGeo(0.16, 0.16, 0.01, 16), rotorMat, { cast: false });
        rotor.position.set(rx, 0.12, rz);
        d.add(rotor);
        rotors.push(rotor);
      });
      const parcel = mesh(slabGeo(0.24, 0.24, 0.2, 0.03, 0.015), crateMat);
      parcel.position.y = -0.22;
      const ledMat = new THREE.MeshBasicMaterial({ color: target.colorHex, toneMapped: false });
      const led = mesh(sphereGeo(0.04, 8, 6), ledMat, { cast: false });
      led.position.set(0, 0.02, 0.22);
      const ledGlow = glowSprite(target.colorHex, 0.6, 0.7);
      ledGlow.position.copy(led.position);
      d.add(parcel, led, ledGlow);
      envGroup.add(d);
      const period = 10 + i * 2.6;
      const offset = i * 0.27;
      const alt = 3.4 + i * 0.45;
      envAnimators.push((t) => {
        const k = ((t / period) + offset) % 1;
        const leg = k < 0.5 ? k * 2 : (1 - k) * 2;
        const e = leg * leg * (3 - 2 * leg);
        const x = target.x * e;
        const z = target.z * e;
        d.position.set(x, alt + Math.sin(leg * Math.PI) * 1.2 + Math.sin(t * 2 + i) * 0.06, z);
        const heading = Math.atan2(target.x, target.z) + (k < 0.5 ? 0 : Math.PI);
        d.rotation.y = heading;
        d.rotation.x = Math.sin(leg * Math.PI) * 0.12 * (k < 0.5 ? 1 : -1);
        parcel.visible = k < 0.5;
        rotors.forEach((rt, ri) => { rt.rotation.y = t * 40 + ri; });
        const blink = Math.sin(t * 8 + i) > 0.2;
        led.visible = blink;
        ledGlow.visible = blink;
      });
    }

    // Courier robots strolling the walkways
    const walkers = [
      { from: [C.minX + 3, BLVD_Z + 0.55], to: [-4.2, BLVD_Z + 0.55], speed: 1.1, provider: "codex" },
      { from: [4.2, BLVD_Z - 0.55], to: [C.maxX - 3, BLVD_Z - 0.55], speed: 0.95, provider: "claude" },
      { from: [0.5, C.minZ + 2.5], to: [0.5, northEnd - 0.6], speed: 0.85, provider: "antigravity" },
    ];
    walkers.forEach((wk, i) => {
      const bot = buildBot(wk.provider, { scale: 0.55, working: false });
      envGroup.add(bot);
      const dx = wk.to[0] - wk.from[0];
      const dz = wk.to[1] - wk.from[1];
      const len = Math.hypot(dx, dz);
      const travel = len / wk.speed;
      envAnimators.push((t, dt = 0.016) => {
        const cycle = (t + i * 5.3) % (travel * 2 + 3);
        let k;
        let forward;
        if (cycle < travel) { k = cycle / travel; forward = true; }
        else if (cycle < travel + 1.5) { k = 1; forward = true; }
        else if (cycle < travel * 2 + 1.5) { k = 1 - (cycle - travel - 1.5) / travel; forward = false; }
        else { k = 0; forward = false; }
        const moving = (cycle < travel) || (cycle >= travel + 1.5 && cycle < travel * 2 + 1.5);
        bot.position.set(wk.from[0] + dx * k, 0.03 + (moving ? Math.abs(Math.sin(t * 9 + i)) * 0.05 : 0), wk.from[1] + dz * k);
        const yaw = Math.atan2(dx, dz) + (forward ? 0 : Math.PI);
        const diff = shortestAngleDelta(bot.rotation.y, yaw);
        bot.rotation.y += diff * Math.min(1, dt * 10);
        const ud = bot.userData;
        ud.leftArm.rotation.x = moving ? Math.sin(t * 9 + i) * 0.6 : -0.2;
        ud.rightArm.rotation.x = moving ? -Math.sin(t * 9 + i) * 0.6 : -0.2;
        ud.headGroup.rotation.y = moving ? 0 : Math.sin(t * 1.5) * 0.5;
      });
    });
  }

  // ------------------------------------------------------------- characters
  function buildBot(provider = "codex", { scale = 1, working = false, headband = false, overdrive = false, pose = "seat" } = {}) {
    const light = isLight();
    const pal = PROVIDER_COLORS[provider] || PROVIDER_COLORS.default;
    const bot = new THREE.Group();
    bot.scale.setScalar(scale);

    const bodyMat = phys(pal.body, { rough: 0.32, clear: 0.9 });
    const shellMat = phys(light ? 0xe8eef5 : 0xe2e8f0, { rough: light ? 0.32 : 0.26, clear: light ? 0.45 : 1 });
    const visorMat = phys(0x070d1a, { rough: 0.1, metal: 0.5, clear: 1 });
    const eyeMat = working
      ? neon(pal.eye)
      : phys(light ? 0x64748b : 0x475569, { rough: 0.5 });

    const torso = mesh(capsuleGeo(0.21, 0.24), bodyMat);
    torso.position.y = 0.48;
    bot.add(torso);

    const bellyMat = working ? neon(pal.emissive) : phys(0x475569, { rough: 0.5 });
    const belly = mesh(geo("bot-belly", () => new THREE.CircleGeometry(0.065, 20)), bellyMat, { cast: false });
    belly.position.set(0, 0.5, 0.212);
    bot.add(belly);

    const headGroup = new THREE.Group();
    headGroup.position.y = 1.0;
    const head = mesh(sphereGeo(0.3, 28, 20), shellMat);
    head.scale.set(1.14, 0.92, 1.0);
    headGroup.add(head);

    const visor = mesh(sphereGeo(0.3, 28, 20), visorMat, { cast: false });
    visor.scale.set(0.94, 0.6, 0.55);
    visor.position.set(0, -0.01, 0.15);
    headGroup.add(visor);

    const eyes = new THREE.Group();
    eyes.position.set(0, 0, 0.31);
    const eyeL = mesh(capsuleGeo(0.032, 0.05), eyeMat, { cast: false });
    eyeL.position.x = -0.09;
    const eyeR = mesh(capsuleGeo(0.032, 0.05), eyeMat, { cast: false });
    eyeR.position.x = 0.09;
    eyes.add(eyeL, eyeR);
    if (!working) {
      eyes.scale.y = 0.22;
    }
    headGroup.add(eyes);

    // Working intensity headband (红头巾 + 飘带)
    let headbandTails = null;
    if (working && headband) {
      const bandMat = phys(0xdc2626, { rough: 0.35, emissive: 0x991b1b, ei: 0.45 });
      const band = mesh(torusGeo(0.305, 0.036, 8, 32), bandMat);
      band.rotation.x = Math.PI / 2 - 0.18;
      band.position.set(0, 0.13, 0.02);
      const knot = mesh(sphereGeo(0.055, 10, 8), bandMat);
      knot.position.set(0, 0.14, -0.31);

      const tailL = new THREE.Group();
      tailL.position.set(-0.04, 0.14, -0.32);
      const tailLMesh = mesh(boxGeo(0.055, 0.26, 0.018), bandMat);
      tailLMesh.position.y = -0.13;
      tailL.add(tailLMesh);

      const tailR = new THREE.Group();
      tailR.position.set(0.04, 0.14, -0.32);
      const tailRMesh = mesh(boxGeo(0.055, 0.24, 0.018), bandMat);
      tailRMesh.position.y = -0.12;
      tailR.add(tailRMesh);

      headGroup.add(band, knot, tailL, tailR);
      headbandTails = [tailL, tailR];
    }

    // Brand crest
    let crest = null;
    if (provider === "claude") {
      crest = new THREE.Group();
      const star = mesh(octaGeo(0.1), neon(pal.emissive), { cast: false });
      star.scale.set(1, 1.3, 1);
      const halo = mesh(torusGeo(0.14, 0.012, 6, 32), neon(pal.emissive), { cast: false });
      halo.rotation.x = Math.PI / 2;
      crest.add(star, halo);
      crest.position.y = 0.38;
    } else if (provider === "antigravity") {
      crest = mesh(octaGeo(0.11), phys(pal.body, { rough: 0.1, clear: 1, emissive: pal.emissive, ei: 0.9, flat: true }));
      crest.scale.set(0.8, 1.5, 0.8);
      crest.position.y = 0.44;
    } else if (provider === "grok") {
      crest = mesh(torusGeo(0.2, 0.018, 6, 36), neon(pal.emissive), { cast: false });
      crest.rotation.x = Math.PI / 2;
      crest.position.y = 0.34;
    } else {
      crest = new THREE.Group();
      const stalk = mesh(cylGeo(0.012, 0.012, 0.16, 6), shellMat);
      stalk.position.y = 0.08;
      const tip = mesh(sphereGeo(0.045, 12, 10), neon(pal.emissive), { cast: false });
      tip.position.y = 0.18;
      crest.add(stalk, tip);
      crest.position.y = 0.26;
    }
    headGroup.add(crest);
    bot.add(headGroup);

    const leftArm = mesh(capsuleGeo(0.055, 0.17), shellMat);
    leftArm.position.set(-0.29, 0.56, 0.08);
    leftArm.rotation.x = working ? -0.9 : -1.25;
    const rightArm = mesh(capsuleGeo(0.055, 0.17), shellMat);
    rightArm.position.set(0.29, 0.56, 0.08);
    rightArm.rotation.x = working ? -0.9 : -1.25;
    bot.add(leftArm, rightArm);

    if (!working && pose !== "lying") {
      torso.rotation.x = 0.24;
      headGroup.position.set(0, 0.90, 0.14);
      headGroup.rotation.set(0.56, 0, 0.22);
    } else if (pose === "lying") {
      leftArm.rotation.x = -0.3;
      rightArm.rotation.x = -0.3;
    }

    bot.userData = {
      headGroup,
      eyes,
      crest,
      torso,
      leftArm,
      rightArm,
      headbandTails,
      working,
      headband,
      overdrive,
      pose,
      blinkSeed: Math.random() * 4.3,
      phase: Math.random() * Math.PI * 2,
    };
    return bot;
  }

  // ------------------------------------------------------------- landmarks
  function buildLandmark(key = "tower", live = false, targetAnims = animators) {
    const light = isLight();
    const root = new THREE.Group();
    root.position.set(0, 0, -1.25);
    const speed = live ? 1.8 : 0.1;

    const pedMat = phys(light ? 0xe2e8f0 : 0x1e293b, { rough: 0.3, metal: 0.55, clear: 0.8 });
    const ped = mesh(cylGeo(0.92, 1.05, 0.22, 32), pedMat, { cast: true, receive: true });
    ped.position.y = 0.11;
    const pedRingMat = live ? neon(0x34d399) : phys(light ? 0x94a3b8 : 0x334155, { rough: 0.6 });
    const pedRing = mesh(torusGeo(0.95, 0.022, 6, 64), pedRingMat, { cast: false });
    pedRing.rotation.x = Math.PI / 2;
    pedRing.position.y = 0.22;
    root.add(ped, pedRing);

    const addGlow = (color, size, y, opacity = 0.6, x = 0, z = 0) => {
      const s = glowSprite(color, size, opacity);
      s.position.set(x, y, z);
      root.add(s);
      return s;
    };

    if (key === "comic") {
      const cols = [0x38bdf8, 0xf472b6, 0xfbbf24];
      cols.forEach((hex, i) => {
        const bk = mesh(slabGeo(1.12 - i * 0.1, 0.8 - i * 0.06, 0.22, 0.06, 0.03), phys(hex, { rough: 0.4, clear: 0.6 }));
        bk.position.y = 0.23 + i * 0.23;
        bk.rotation.y = (i - 1) * 0.2;
        root.add(bk);
        const pages = mesh(boxGeo(1.0 - i * 0.1, 0.12, 0.66 - i * 0.06), phys(0xf8fafc, { rough: 0.7 }), { cast: false });
        pages.position.set(0.04, 0.34 + i * 0.23, 0);
        pages.rotation.y = (i - 1) * 0.2;
        root.add(pages);
      });
      const bubble = new THREE.Group();
      bubble.position.set(0, 1.62, 0);
      const body = mesh(panelGeo(1.12, 0.7, 0.16, 0.24), phys(0xffffff, { rough: 0.25, clear: 1, emissive: 0xe0f2fe, ei: 0.25 }));
      const tail = mesh(coneGeo(0.12, 0.24, 4), phys(0xffffff, { rough: 0.25, clear: 1 }));
      tail.position.set(-0.28, -0.42, 0);
      tail.rotation.z = Math.PI + 0.35;
      const l1 = mesh(boxGeo(0.62, 0.08, 0.02), neon(0xf59e0b), { cast: false });
      l1.position.set(0, 0.1, 0.09);
      const l2 = mesh(boxGeo(0.42, 0.08, 0.02), neon(0x0284c7), { cast: false });
      l2.position.set(-0.1, -0.1, 0.09);
      bubble.add(body, tail, l1, l2);
      root.add(bubble);
      targetAnims.push((t) => {
        bubble.position.y = 1.62 + Math.sin(t * 2 + 1) * 0.08;
        bubble.rotation.y = Math.sin(t * 0.8) * 0.25;
      });
    } else if (key === "radar") {
      const mast = mesh(cylGeo(0.08, 0.16, 1.3, 10), phys(light ? 0xcbd5e1 : 0x334155, { rough: 0.3, metal: 0.8 }));
      mast.position.y = 0.87;
      const lattice = mesh(coneGeo(0.5, 1.3, 4), neon(0x38bdf8, { opacity: 0.55 }), { cast: false });
      lattice.material = cached("radar-wire", () => new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, toneMapped: false, transparent: true, opacity: 0.6 }));
      lattice.position.y = 0.87;
      root.add(mast, lattice);

      const dishGroup = new THREE.Group();
      dishGroup.position.y = 1.6;
      const dish = mesh(
        geo("radar-dish", () => new THREE.SphereGeometry(0.6, 32, 12, 0, Math.PI * 2, 0, Math.PI / 3.2)),
        cached("radar-dish-mat", () => new THREE.MeshPhysicalMaterial({ color: light ? 0xffffff : 0xe2e8f0, roughness: 0.25, metalness: 0.6, clearcoat: 1, side: THREE.DoubleSide })),
      );
      dish.rotation.x = Math.PI * 0.62;
      const feed = mesh(cylGeo(0.015, 0.015, 0.5, 6), phys(0x94a3b8, { metal: 1, rough: 0.3 }));
      feed.rotation.x = Math.PI * 0.12;
      feed.position.set(0, 0.12, 0.12);
      const tip = mesh(sphereGeo(0.06, 12, 10), neon(0x7dd3fc), { cast: false });
      tip.position.set(0, 0.34, 0.2);
      dishGroup.add(dish, feed, tip);
      const tipGlow = glowSprite(0x38bdf8, 0.8, 0.8);
      tipGlow.position.copy(tip.position);
      dishGroup.add(tipGlow);
      root.add(dishGroup);

      const sweep = mesh(
        geo("radar-sweep", () => {
          const g = new THREE.CircleGeometry(1.7, 32, 0, Math.PI / 4);
          g.rotateX(-Math.PI / 2);
          return g;
        }),
        neon(0x38bdf8, { opacity: 0.28, additive: true }),
        { cast: false },
      );
      sweep.position.y = 0.24;
      root.add(sweep);
      targetAnims.push((t) => {
        dishGroup.rotation.y = t * speed;
        sweep.rotation.y = -t * 1.6;
        tipGlow.material.opacity = tipGlow.userData.baseOpacity * (0.6 + 0.4 * Math.sin(t * 6));
      });
    } else if (key === "obelisk") {
      const crystalMat = phys(0xa855f7, { rough: 0.08, metal: 0.1, clear: 1, emissive: 0x7c3aed, ei: 0.7, flat: true });
      const obelisk = mesh(octaGeo(0.62), crystalMat);
      obelisk.scale.set(0.72, 1.7, 0.72);
      obelisk.position.y = 1.5;
      const ring = mesh(torusGeo(0.85, 0.03, 8, 64), neon(0xc4b5fd), { cast: false });
      ring.position.y = 1.45;
      ring.rotation.x = 1.15;
      const g = addGlow(0xa855f7, 2.6, 1.5, 0.55);
      root.add(obelisk, ring);
      const shards = [0, 1, 2].map((i) => {
        const sh = mesh(octaGeo(0.1), crystalMat);
        root.add(sh);
        return { sh, offset: (i / 3) * Math.PI * 2 };
      });
      targetAnims.push((t) => {
        obelisk.rotation.y = t * speed;
        obelisk.position.y = 1.5 + Math.sin(t * 1.8) * 0.1;
        ring.rotation.z = t * 0.6;
        g.position.y = obelisk.position.y;
        shards.forEach(({ sh, offset }) => {
          const a = t * 1.2 + offset;
          sh.position.set(Math.cos(a) * 0.95, 1.45 + Math.sin(a * 2) * 0.18, Math.sin(a) * 0.95);
          sh.rotation.y = t * 3;
        });
      });
    } else if (key === "lighthouse") {
      const body = mesh(cylGeo(0.3, 0.52, 1.5, 24), phys(0xf8fafc, { rough: 0.35, clear: 0.6 }));
      body.position.y = 0.97;
      const s1 = mesh(cylGeo(0.4, 0.45, 0.28, 24), phys(0x0ea5e9, { rough: 0.35, clear: 0.6 }));
      s1.position.y = 0.72;
      const s2 = mesh(cylGeo(0.33, 0.37, 0.24, 24), phys(0x0ea5e9, { rough: 0.35, clear: 0.6 }));
      s2.position.y = 1.3;
      const deck = mesh(cylGeo(0.42, 0.42, 0.06, 24), phys(0x334155, { metal: 0.8, rough: 0.3 }));
      deck.position.y = 1.75;
      const lantern = mesh(cylGeo(0.24, 0.24, 0.32, 16), glassMat(0xfef9c3, 0.35), { cast: false });
      lantern.position.y = 1.94;
      const bulb = mesh(sphereGeo(0.14, 16, 12), neon(0xfde047), { cast: false });
      bulb.position.y = 1.94;
      const cap = mesh(coneGeo(0.3, 0.26, 24), phys(0xef4444, { rough: 0.35, clear: 0.7 }));
      cap.position.y = 2.23;
      root.add(body, s1, s2, deck, lantern, bulb, cap);
      const g = addGlow(0xfde047, 1.6, 1.94, 0.8);
      const beamPivot = new THREE.Group();
      beamPivot.position.y = 1.94;
      const beam = mesh(
        geo("lh-beam", () => {
          const gg = new THREE.ConeGeometry(0.5, 3.2, 20, 1, true);
          gg.rotateZ(Math.PI / 2);
          gg.translate(1.6, 0, 0);
          return gg;
        }),
        neon(0xfef08a, { opacity: 0.16, additive: true }),
        { cast: false },
      );
      beamPivot.add(beam);
      root.add(beamPivot);
      targetAnims.push((t) => {
        beamPivot.rotation.y = t * 1.2;
        g.material.opacity = g.userData.baseOpacity * (0.75 + 0.25 * Math.sin(t * 4));
      });
    } else if (key === "gears") {
      const makeGear = (radius, teeth, color) => {
        const gGroup = new THREE.Group();
        const m = phys(color, { rough: 0.28, metal: 0.9, clear: 0.4 });
        const disc = mesh(cylGeo(radius, radius, 0.16, 32), m);
        disc.rotation.x = Math.PI / 2;
        const hub = mesh(cylGeo(radius * 0.32, radius * 0.32, 0.2, 20), phys(0x1e293b, { metal: 0.9, rough: 0.3 }));
        hub.rotation.x = Math.PI / 2;
        gGroup.add(disc, hub);
        for (let i = 0; i < teeth; i += 1) {
          const a = (i / teeth) * Math.PI * 2;
          const tooth = mesh(boxGeo(0.12, 0.16, 0.16), m);
          tooth.position.set(Math.cos(a) * (radius + 0.05), Math.sin(a) * (radius + 0.05), 0);
          tooth.rotation.z = a;
          gGroup.add(tooth);
        }
        return gGroup;
      };
      const g1 = makeGear(0.5, 10, 0xf59e0b);
      g1.position.set(-0.18, 1.2, 0);
      const g2 = makeGear(0.32, 8, 0x38bdf8);
      g2.position.set(0.52, 1.62, 0.06);
      const post = mesh(boxGeo(0.12, 1.0, 0.12), phys(0x334155, { metal: 0.8, rough: 0.3 }));
      post.position.set(-0.18, 0.72, -0.12);
      root.add(post, g1, g2);
      addGlow(0xf59e0b, 1.4, 1.2, 0.3, -0.18);
      targetAnims.push((t) => {
        g1.rotation.z = t * speed;
        g2.rotation.z = -t * speed * 1.55 + 0.2;
      });
    } else if (key === "cinema") {
      const board = mesh(panelGeo(1.3, 0.9, 0.16, 0.06), phys(0x111827, { rough: 0.35, clear: 0.8 }));
      board.position.y = 0.9;
      const stripeGroup = new THREE.Group();
      stripeGroup.position.set(-0.65, 1.38, 0);
      const stick = mesh(boxGeo(1.32, 0.18, 0.17), phys(0xf8fafc, { rough: 0.4, clear: 0.6 }));
      stick.position.x = 0.66;
      stripeGroup.add(stick);
      for (let i = 0; i < 5; i += 1) {
        const st = mesh(boxGeo(0.12, 0.19, 0.18), phys(0x111827, { rough: 0.4 }), { cast: false });
        st.position.set(0.16 + i * 0.26, 0, 0);
        st.rotation.z = 0.5;
        stripeGroup.add(st);
      }
      const label = mesh(boxGeo(0.9, 0.06, 0.02), neon(0xc084fc), { cast: false });
      label.position.set(0, 0.85, 0.09);
      const reel = mesh(cylGeo(0.42, 0.42, 0.1, 32), phys(0xfbbf24, { metal: 1, rough: 0.24 }));
      reel.rotation.x = Math.PI / 2;
      reel.position.set(0.58, 0.66, 0.2);
      const reelHub = mesh(cylGeo(0.12, 0.12, 0.12, 16), phys(0x1e293b, { metal: 0.8 }));
      reelHub.rotation.x = Math.PI / 2;
      reelHub.position.copy(reel.position);
      root.add(board, stripeGroup, label, reel, reelHub);
      addGlow(0xa855f7, 2.2, 1.0, 0.4);
      targetAnims.push((t) => {
        reel.rotation.y = t * speed * 2;
        stripeGroup.rotation.z = Math.max(0, Math.sin(t * 2.2)) * 0.32;
      });
    } else if (key === "youtube") {
      const plaqueGroup = new THREE.Group();
      plaqueGroup.position.y = 1.3;
      const plaque = mesh(panelGeo(1.42, 1.0, 0.26, 0.3), phys(0xef4444, { rough: 0.22, clear: 1, emissive: 0xb91c1c, ei: 0.45 }));
      const tri = new THREE.Shape();
      tri.moveTo(-0.15, -0.2);
      tri.lineTo(0.24, 0);
      tri.lineTo(-0.15, 0.2);
      tri.lineTo(-0.15, -0.2);
      const play = mesh(
        geo("yt-play", () => new THREE.ExtrudeGeometry(tri, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 2 })),
        neon(0xffffff),
        { cast: false },
      );
      play.position.z = 0.13;
      plaqueGroup.add(plaque, play);
      const stand = mesh(cylGeo(0.06, 0.1, 0.62, 12), phys(0x334155, { metal: 0.8, rough: 0.3 }));
      stand.position.y = 0.52;
      const halo = mesh(torusGeo(0.95, 0.03, 8, 64), neon(0x22d3ee), { cast: false });
      halo.position.y = 1.3;
      root.add(stand, plaqueGroup, halo);
      const g = addGlow(0xef4444, 2.4, 1.3, 0.5);
      targetAnims.push((t) => {
        plaqueGroup.position.y = 1.3 + Math.sin(t * 1.8) * 0.08;
        plaqueGroup.rotation.y = Math.sin(t * 0.7) * 0.22;
        halo.rotation.y = t * speed;
        halo.rotation.x = Math.sin(t * 0.9) * 0.3;
        g.position.y = plaqueGroup.position.y;
      });
    } else if (key === "shield") {
      const shell = mesh(geo("shield-ico", () => new THREE.IcosahedronGeometry(0.85, 1)), cached("shield-wire", () => new THREE.MeshBasicMaterial({ color: 0x38bdf8, wireframe: true, toneMapped: false, transparent: true, opacity: 0.55 })), { cast: false });
      shell.position.y = 1.25;
      const glass = mesh(geo("shield-glass", () => new THREE.IcosahedronGeometry(0.82, 2)), glassMat(0x8b5cf6, 0.14), { cast: false });
      glass.position.y = 1.25;
      const core = mesh(octaGeo(0.38), phys(0x10b981, { rough: 0.1, clear: 1, emissive: 0x059669, ei: 0.9, flat: true }));
      core.position.y = 1.25;
      root.add(shell, glass, core);
      addGlow(0x34d399, 1.8, 1.25, 0.55);
      targetAnims.push((t) => {
        shell.rotation.y = t * speed * 0.6;
        shell.rotation.x = t * 0.2;
        core.rotation.y = -t * 1.5;
      });
    } else if (key === "phone") {
      const body = mesh(panelGeo(0.86, 1.6, 0.14, 0.14), phys(0x111827, { rough: 0.2, metal: 0.6, clear: 1 }));
      body.position.y = 1.05;
      const screen = mesh(geo("phone-screen", () => new THREE.PlaneGeometry(0.74, 1.4)), cached("phone-screen-mat", () => new THREE.MeshBasicMaterial({ map: tex.code, color: 0x6ee7b7, toneMapped: false })), { cast: false });
      screen.position.set(0, 1.05, 0.075);
      root.add(body, screen);
      const arcs = [0.22, 0.36, 0.5].map((r, i) => {
        const arcMat = new THREE.MeshBasicMaterial({ color: 0x34d399, toneMapped: false, transparent: true, opacity: 0.8 });
        const arc = mesh(torusGeo(r, 0.025, 6, 24, Math.PI / 2), arcMat, { cast: false });
        arc.rotation.z = Math.PI / 4;
        arc.position.y = 1.95;
        root.add(arc);
        return { arc, i };
      });
      targetAnims.push((t) => {
        arcs.forEach(({ arc, i }) => {
          arc.material.opacity = 0.25 + 0.75 * Math.max(0, Math.sin(t * 3 - i * 0.8));
        });
      });
    } else if (key === "cat") {
      const headMat = phys(0xfde68a, { rough: 0.45, clear: 0.6 });
      const head = mesh(sphereGeo(0.66, 32, 24), headMat);
      head.scale.set(1.12, 0.92, 0.96);
      head.position.y = 0.88;
      const earMat = phys(0xf59e0b, { rough: 0.4, clear: 0.6 });
      const innerMat = phys(0xfda4af, { rough: 0.5 });
      const ears = [-1, 1].map((side) => {
        const earG = new THREE.Group();
        earG.position.set(side * 0.42, 1.38, 0);
        earG.rotation.z = -side * 0.25;
        const ear = mesh(coneGeo(0.26, 0.5, 4), earMat);
        ear.rotation.y = Math.PI / 4;
        const inner = mesh(coneGeo(0.14, 0.32, 4), innerMat, { cast: false });
        inner.rotation.y = Math.PI / 4;
        inner.position.set(0, -0.04, 0.1);
        earG.add(ear, inner);
        root.add(earG);
        return earG;
      });
      const eyeMat = neon(0x34d399);
      [-0.24, 0.24].forEach((x) => {
        const e = mesh(capsuleGeo(0.05, 0.08), eyeMat, { cast: false });
        e.position.set(x, 0.92, 0.6);
        root.add(e);
      });
      const nose = mesh(sphereGeo(0.05, 10, 8), phys(0xf472b6, { rough: 0.4 }), { cast: false });
      nose.position.set(0, 0.8, 0.64);
      root.add(head, nose);
      targetAnims.push((t) => {
        ears[0].rotation.z = 0.25 + Math.max(0, Math.sin(t * 2.4)) * 0.2;
        ears[1].rotation.z = -0.25 - Math.max(0, Math.sin(t * 2.4 + 1.3)) * 0.2;
      });
    } else if (key === "cottage") {
      const walls = mesh(slabGeo(1.2, 1.05, 0.85, 0.06, 0.03), phys(0xfef3c7, { rough: 0.6 }));
      walls.position.y = 0.22;
      const roof = mesh(coneGeo(1.05, 0.72, 4), phys(0xe11d48, { rough: 0.45, clear: 0.6 }));
      roof.position.y = 1.43;
      roof.rotation.y = Math.PI / 4;
      const chimney = mesh(boxGeo(0.16, 0.4, 0.16), phys(0x78350f, { rough: 0.7 }));
      chimney.position.set(0.3, 1.6, -0.15);
      const win = mesh(boxGeo(0.3, 0.3, 0.04), neon(0xfde047), { cast: false });
      win.position.set(-0.24, 0.72, 0.535);
      const door = mesh(boxGeo(0.24, 0.42, 0.04), phys(0x92400e, { rough: 0.6 }), { cast: false });
      door.position.set(0.26, 0.43, 0.535);
      root.add(walls, roof, chimney, win, door);
      addGlow(0xfbbf24, 1.2, 0.72, 0.6, -0.24, 0.6);
      const puffs = [0, 1, 2].map((i) => {
        const m = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, transparent: true, opacity: 0.6, roughness: 1 });
        const p = mesh(sphereGeo(0.1, 10, 8), m, { cast: false });
        root.add(p);
        return { p, i };
      });
      targetAnims.push((t) => {
        puffs.forEach(({ p, i }) => {
          const k = (t * 0.45 + i / 3) % 1;
          p.position.set(0.3 + Math.sin(k * 6) * 0.06, 1.85 + k * 0.9, -0.15);
          p.scale.setScalar(0.6 + k * 1.4);
          p.material.opacity = 0.55 * (1 - k);
        });
      });
    } else if (key === "bullchart") {
      const bars = [
        { h: 0.6, c: 0x10b981, x: -0.45 },
        { h: 0.95, c: 0xef4444, x: 0 },
        { h: 1.45, c: 0xf59e0b, x: 0.45 },
      ];
      const meshes = bars.map((b) => {
        const candle = mesh(slabGeo(0.3, 0.3, b.h, 0.05, 0.03), phys(b.c, { rough: 0.25, clear: 1, emissive: b.c, ei: 0.35 }));
        candle.position.set(b.x, 0.22, 0);
        const wick = mesh(boxGeo(0.03, b.h + 0.36, 0.03), phys(0x94a3b8, { metal: 0.9, rough: 0.3 }), { cast: false });
        wick.position.set(b.x, 0.22 + (b.h + 0.36) / 2 - 0.1, 0);
        root.add(wick, candle);
        return { candle, base: 1 };
      });
      addGlow(0xf59e0b, 1.6, 1.4, 0.35, 0.45);
      targetAnims.push((t) => {
        meshes.forEach(({ candle }, i) => {
          candle.scale.y = 1 + Math.sin(t * 1.5 + i) * 0.06;
        });
      });
    } else {
      const crystal = mesh(octaGeo(0.55), phys(0x38bdf8, { rough: 0.1, clear: 1, emissive: 0x0284c7, ei: 0.7, flat: true }));
      crystal.position.y = 1.25;
      root.add(crystal);
      addGlow(0x38bdf8, 1.8, 1.25, 0.5);
      targetAnims.push((t) => {
        crystal.rotation.y = t * speed;
      });
    }
    return root;
  }

  // --------------------------------------------------------------- nexus
  function buildNexus() {
    const light = isLight();
    const g = new THREE.Group();
    const ped = mesh(cylGeo(1.35, 1.65, 0.42, 6), phys(light ? 0x94a3b8 : 0x1e293b, { rough: light ? 0.36 : 0.28, metal: 0.65, clear: light ? 0.35 : 0.9 }), { cast: true, receive: true });
    ped.position.y = 0.21;
    const ped2 = mesh(cylGeo(0.95, 1.15, 0.28, 6), phys(light ? 0xcbd5e1 : 0x0f172a, { rough: light ? 0.3 : 0.22, metal: 0.5, clear: light ? 0.4 : 1 }), { cast: true, receive: true });
    ped2.position.y = 0.56;
    const ringTop = mesh(torusGeo(1.02, 0.035, 8, 64), neon(0x38bdf8), { cast: false });
    ringTop.rotation.x = Math.PI / 2;
    ringTop.position.y = 0.71;

    const crystal = mesh(octaGeo(0.62), new THREE.MeshPhysicalMaterial({
      color: 0x7dd3fc,
      emissive: 0x0ea5e9,
      emissiveIntensity: 0.9,
      roughness: 0.06,
      metalness: 0.1,
      clearcoat: 1,
      flatShading: true,
    }));
    crystal.position.y = 1.95;

    const ringMat = phys(0xfbbf24, { rough: 0.2, metal: 1, emissive: 0xb45309, ei: 0.35 });
    const ring1 = mesh(torusGeo(1.05, 0.038, 10, 64), ringMat);
    ring1.position.y = 1.95;
    const ring2 = mesh(torusGeo(1.2, 0.025, 10, 64), ringMat);
    ring2.position.y = 1.95;

    const beamMat = new THREE.MeshBasicMaterial({
      map: tex.beam,
      color: 0x38bdf8,
      transparent: true,
      opacity: light ? 0.25 : 0.4,
      blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const beam = mesh(cylGeo(0.22, 0.55, 7.5, 24, true), beamMat, { cast: false });
    beam.position.y = 0.7 + 3.75;

    const halo = glowSprite(0x38bdf8, 4.4, 0.55);
    halo.position.y = 1.95;

    const light0 = new THREE.PointLight(0x38bdf8, light ? 14 : 30, 16, 2);
    light0.position.y = 2.3;

    g.add(ped, ped2, ringTop, crystal, ring1, ring2, beam, halo, light0);
    dynamicGroup.add(g);

    nexusParts = {
      beam,
      beamMat,
      halo,
      light0,
      baseLightIntensity: light ? 14 : 30,
    };

    animators.push((t) => {
      crystal.rotation.y = t * 0.9;
      crystal.position.y = 1.95 + Math.sin(t * 2.2) * 0.12;
      ring1.rotation.x = 1.1 + Math.sin(t * 0.6) * 0.2;
      ring1.rotation.z = t * 0.8;
      ring2.rotation.y = -t * 0.6;
      ring2.rotation.x = 0.6 + Math.cos(t * 0.5) * 0.2;
      halo.position.y = crystal.position.y;
      const camPos = camera?.position;
      const nearN = camPos ? smoothstep(3.5, 9.5, Math.hypot(camPos.x, camPos.z)) : 1;
      const zoomFade = 1 - 0.35 * smoothstep(1.4, 2.35, camCurr.zoom);
      const nFade = nearN * zoomFade;
      beamMat.opacity = (light ? 0.25 : 0.4) * nFade;
      halo.material.opacity = halo.userData.baseOpacity * (0.8 + 0.2 * Math.sin(t * 3)) * (0.25 + 0.75 * nFade);
      ringTop.scale.setScalar(1 + 0.03 * Math.sin(t * 4));
      light0.intensity = nexusParts.baseLightIntensity * (0.85 + 0.15 * Math.sin(t * 3));
    });

    // Finalized butler, sharing the world's primitive geometry/material caches.
    const spRoot = buildButler(spriteMood);
    spRoot.scale.setScalar(1.3);
    if (spriteRecord) spRoot.position.copy(spriteRecord.group.position);
    else spRoot.position.set(2.35, 1.0, 1.85);
    spRoot.rotation.y = Math.PI / 4;
    const spHit = mesh(sphereGeo(1.1, 8, 8), invisibleMat(), { cast: false });
    spHit.position.y = 1.3;
    spHit.userData = { kind: "sprite" };
    spRoot.add(spHit);
    interactiveMeshes.push(spHit);
    dynamicGroup.add(spRoot);
    const spLabelEl = document.createElement("button");
    spLabelEl.type = "button";
    spLabelEl.className = "tycoon3d-tag tycoon3d-sprite-tag tycoon-sprite-bubble";
    spLabelEl.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (spriteBubble?.topicId) onSpriteBubbleClick?.(spriteBubble.topicId);
      else onSelectSprite?.();
    });
    labelsWrap.appendChild(spLabelEl);
    spriteRecord = { group: spRoot, anchor: new THREE.Vector3(), labelEl: spLabelEl };
    updateSpriteBubble();
    animators.push(updateSprite);

  }


  function changeSpriteMood(mood) {
    const next = SPRITE_MOODS.has(mood) ? mood : "idle";
    if (spriteMood === next) return;
    spriteMood = next;
    spriteRecord?.group.userData.setMood(next);
  }

  function updateSpriteBubble(now = Date.now()) {
    const el = spriteRecord?.labelEl;
    if (!el) return;
    if (spriteBubble && now >= spriteBubble.expiresAt) spriteBubble = null;
    const text = spriteBubble?.text || assistantText("小精灵总管", "Sprite Butler");
    const limit = window.innerWidth <= 390 ? 12 : 18;
    const chars = Array.from(text);
    const short = chars.length > limit ? chars.slice(0, limit - 1).join("") + "…" : text;
    if (el.textContent !== short) el.textContent = short;
    el.title = text;
    el.classList.toggle("is-speaking", Boolean(spriteBubble));
    el.classList.toggle("is-fading", Boolean(spriteBubble && spriteBubble.expiresAt - now <= 450));
    el.dataset.topicId = spriteBubble?.topicId || "";
  }

  function showSpriteBubble(text, { topicId = "", ttlMs = 6000 } = {}) {
    if (!text) return;
    spriteBubble = { text: String(text), topicId, expiresAt: Date.now() + Math.max(0, ttlMs) };
    updateSpriteBubble();
  }

  function findWorkstationRecord(topicId = "") {
    if (!topicId) return null;
    const direct = wsRecords.get(topicId);
    if (direct) return direct;
    for (const rec of wsRecords.values()) {
      if (rec?.ws?.isClusterHub && Array.isArray(rec.ws.memberTopicIds) && rec.ws.memberTopicIds.includes(topicId)) {
        return rec;
      }
    }
    return null;
  }

  function spriteSay(text, { topicId = "", ttlMs = 6000, proactive = true } = {}) {
    if (!text || disposed) return;
    if (!proactive) {
      spriteBrain.noteUserBubble();
      showSpriteBubble(text, { topicId, ttlMs });
      return;
    }
    const mark = findWorkstationRecord(topicId)?.ws.assistantSignals?.top || "alert";
    spriteProactive.push({ topicId: topicId || "__nexus__", mark, bubble: String(text), ttlMs, queuedOnly: true });
  }

  function finishSpriteVisit() {
    if (spriteMotionTimer) {
      clearTimeout(spriteMotionTimer);
      spriteMotionTimer = null;
    }
    const motion = spriteMotion;
    spriteMotion = null;
    motion?.resolve();
  }

  function spriteDestination(topicId) {
    const ws = findWorkstationRecord(topicId)?.ws;
    // Stand in front of, and to the side of, the building's label/roof.
    return ws ? { x: ws.x + 2.1, y: 0.95, z: ws.z + 2.2 } : null;
  }

  function spriteVisit(topicId, { bubble, mood = "guide", camera: followCamera = true } = {}) {
    if (disposed) return Promise.resolve();
    finishSpriteVisit();
    changeSpriteMood(mood);
    spriteOverrideUntil = Date.now() + 6000;
    if (bubble) spriteSay(bubble, { topicId, proactive: false });
    const dest = spriteDestination(topicId);
    if (!running || !spriteRecord || !dest) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      spriteMotion = { topicId, camera: followCamera, resolve };
      if (spriteReducedMotion()) {
        spriteRecord.group.position.set(dest.x, dest.y, dest.z);
        if (followCamera) panToPosition(dest.x, dest.z, 1.42);
        finishSpriteVisit();
        return;
      }
      spriteMotionTimer = setTimeout(() => finishSpriteVisit(), 4000);
    });
  }

  function setSpriteMood(mood, { topicId, bubble, ttlMs = 6000 } = {}) {
    // A new user state supersedes an earlier guide, including in-flight thinking.
    finishSpriteVisit();
    changeSpriteMood(mood);
    spriteOverrideUntil = Date.now() + ttlMs;
    if (topicId) {
      void spriteVisit(topicId, { mood, camera: mood === "guide" });
      spriteOverrideUntil = Date.now() + ttlMs;
    }
    if (bubble) spriteSay(bubble, { topicId, ttlMs, proactive: false });
  }

  function patrolStops() {
    const stops = [];
    for (const { ws } of wsRecords.values()) {
      const mark = ws.assistantSignals?.top;
      if (!mark) continue;
      const days = mark === "ruin" ? ws.assistantSignals.ruinDays : Math.floor(
        (Date.now() - Date.parse(ws.assistantSignals.cards?.find((c) => c.type === mark)?.since)) / 86400000);
      const age = Number.isFinite(days) && days > 0 ? assistantText(` ${days} 天`, ` ${days}d`) : "";
      const message = mark === "alert" ? assistantText("等你拍板", "Needs you")
        : mark === "harvest" ? assistantText("有菜可收", "Ready to review") : assistantText("停在半途", "Left unfinished");
      const dest = spriteDestination(ws.topicId);
      const position = spriteRecord.group.position;
      stops.push({ topicId: ws.signalTopicId || ws.topicId, topicTitle: ws.name, mark,
        bubble: `${ws.name}：${message}${age}`,
        arrived: spriteReducedMotion() || Math.hypot(position.x - dest.x, position.z - dest.z) < 0.12 });
    }
    return stops;
  }

  function updateSprite(t, dt) {
    if (!spriteRecord) return;
    const now = Date.now();
    const root = spriteRecord.group;
    const controlled = spriteMotion || now < spriteOverrideUntil;
    const busy = spriteUserBusy || isUserDragging || heldKeys.size > 0;
    const decision = spriteBrain.step({ signals: [...patrolStops(), ...spriteProactive], now, userBusy: busy || Boolean(controlled) });
    spriteProactive = [];
    if (!controlled && !busy) {
      changeSpriteMood(decision.mood);
      if (decision.bubble) {
        const b = decision.bubble;
        showSpriteBubble(b.text, { ...b, topicId: b.topicId === "__nexus__" ? "" : b.topicId });
      }
    }
    let dest = null;
    if (spriteMotion) {
      dest = spriteDestination(spriteMotion.topicId);
      if (!dest) finishSpriteVisit();
    } else if (!controlled && !busy && !spriteReducedMotion()) {
      dest = spriteDestination(decision.targetTopicId) || {
        x: 2.35 + Math.cos(t * 0.3) * 0.65, y: 1, z: 1.85 + Math.sin(t * 0.3) * 0.65,
      };
    }
    if (dest) {
      const distance = Math.hypot(dest.x - root.position.x, dest.y - root.position.y, dest.z - root.position.z);
      const amount = spriteReducedMotion() ? 1 : Math.min(1, dt * 4 / Math.max(0.001, distance));
      root.position.x += (dest.x - root.position.x) * amount;
      root.position.y += (dest.y - root.position.y) * amount;
      root.position.z += (dest.z - root.position.z) * amount;
      if (spriteMotion?.camera) {
        camGoal.x = root.position.x; camGoal.z = root.position.z; camGoal.zoom = 1.42;
        abortChase();
      }
      if (spriteMotion && distance < 0.12) finishSpriteVisit();
    }
    // Face the user; internal head/hand gestures follow the finalized preview.
    root.rotation.y = Math.atan2(camera.position.x - root.position.x, camera.position.z - root.position.z);
    root.userData.tick(spriteReducedMotion() ? 0 : t);
    spriteRecord.anchor.copy(root.position);
    spriteRecord.anchor.y += (spriteMood === "waiting" ? 3.55 : 2.65) * root.scale.y;
    updateSpriteBubble(now);
  }

  function uniqueSpriteMaterial(material) {
    const copy = material.clone();
    copy.userData.cached = false;
    return copy;
  }

  const FACE_W = 256, FACE_H = 160;
  function drawFace(ctx, state, t) {
    ctx.clearRect(0, 0, FACE_W, FACE_H);
    const bg = ctx.createLinearGradient(0, 0, 0, FACE_H);
    bg.addColorStop(0, "#0b1530"); bg.addColorStop(1, "#050a18");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, FACE_W, FACE_H);
    const col = { good: "#fcd34d", worry: "#fb923c", waiting: "#f87171", doze: "#64748b" }[state] || "#67e8f9";
    ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.shadowColor = col; ctx.shadowBlur = 14;
    const L = 88, R = 168, Y = 72;
    const blink = state === "idle" && (t % 3.2) < 0.12;
    const eyeCapsule = (x, y, w, h) => { ctx.beginPath(); ctx.roundRect(x - w / 2, y - h / 2, w, h, Math.min(w, h) / 2); ctx.fill(); };
    const mouthSmile = (w = 26, d = 10) => { ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(128 - w, 112); ctx.quadraticCurveTo(128, 112 + d, 128 + w, 112); ctx.stroke(); };
    switch (state) {
      case "idle": case "report":
        eyeCapsule(L, Y, 22, blink ? 4 : 42); eyeCapsule(R, Y, 22, blink ? 4 : 42); mouthSmile(); break;
      case "inspect": {
        eyeCapsule(L, Y, 34, 10); eyeCapsule(R, Y, 34, 10);
        const sy = 20 + ((t * 90) % 120); ctx.globalAlpha = .45; ctx.fillRect(10, sy, FACE_W - 20, 4); ctx.globalAlpha = 1; break; }
      case "guide":
        eyeCapsule(L + 16, Y, 22, 40); eyeCapsule(R + 16, Y, 22, 40); mouthSmile(18, 8); break;
      case "thinking": {
        for (let i = 0; i < 3; i++) { const on = Math.floor(t * 3) % 3 === i; ctx.globalAlpha = on ? 1 : .3;
          ctx.beginPath(); ctx.arc(92 + i * 36, Y + 8, on ? 13 : 10, 0, 7); ctx.fill(); }
        ctx.globalAlpha = 1; break; }
      case "good":
        ctx.lineWidth = 9;
        [L, R].forEach((x) => { ctx.beginPath(); ctx.moveTo(x - 20, Y + 10); ctx.quadraticCurveTo(x, Y - 22, x + 20, Y + 10); ctx.stroke(); });
        ctx.beginPath(); ctx.moveTo(100, 104); ctx.quadraticCurveTo(128, 140, 156, 104); ctx.closePath(); ctx.fill(); break;
      case "worry":
        eyeCapsule(L, Y + 6, 22, 30); eyeCapsule(R, Y + 6, 22, 30);
        ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(L - 22, Y - 30); ctx.lineTo(L + 16, Y - 20); ctx.moveTo(R + 22, Y - 30); ctx.lineTo(R - 16, Y - 20); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(108, 122); ctx.quadraticCurveTo(128, 110, 148, 122); ctx.stroke(); break;
      case "waiting":
        ctx.beginPath(); ctx.arc(L, Y, 18, 0, 7); ctx.arc(R, Y, 18, 0, 7); ctx.fill();
        ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(128, 116, 8, 0, 7); ctx.stroke(); break;
      case "listening": {
        ctx.beginPath(); ctx.arc(L, Y - 6, 20, 0, 7); ctx.arc(R, Y - 6, 20, 0, 7); ctx.fill();
        for (let i = 0; i < 5; i++) { const h = 8 + Math.abs(Math.sin(t * 8 + i * 1.3)) * 22; ctx.fillRect(100 + i * 12, 118 - h / 2, 7, h); }
        break; }
      case "doze":
        ctx.lineWidth = 6;
        [L, R].forEach((x) => { ctx.beginPath(); ctx.moveTo(x - 18, Y); ctx.quadraticCurveTo(x, Y + 12, x + 18, Y); ctx.stroke(); });
        ctx.font = "bold 30px sans-serif"; ctx.fillText("z", 196, 44); ctx.font = "bold 20px sans-serif"; ctx.fillText("z", 220, 26); break;
    }
    ctx.shadowBlur = 0;
  }

  function buildButler(state = "idle") {
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const shell = phys(0xf8fafc, { rough: 0.25, clear: 1 });
    const accent = uniqueSpriteMaterial(phys(0x38bdf8, { rough: 0.2, clear: 0.9, emissive: 0x0284c7, ei: 0.35 }));
    const gold = phys(0xfbbf24, { rough: 0.25, metal: 0.4, emissive: 0xb45309, ei: 0.35 });

    // 头：略扁的大圆头 + 正面脸屏
    const head = new THREE.Group(); head.position.y = 1.55; body.add(head);
    const skull = mesh(sphereGeo(0.62, 40, 28), shell); skull.scale.set(1.12, 0.95, 1); head.add(skull);
    const rim = mesh(torusGeo(0.47, 0.035, 10, 48), accent); rim.scale.set(1.26, 0.86, 1); rim.position.z = 0.47; head.add(rim);
    const cv = document.createElement("canvas"); cv.width = FACE_W; cv.height = FACE_H;
    const fctx = cv.getContext("2d"); const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
    const faceGeo = new THREE.SphereGeometry(0.632, 40, 24, Math.PI / 2 - 0.78, 1.56, Math.PI / 2 - 0.46, 0.9);
    const face = mesh(faceGeo, new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }), { cast: false });
    face.scale.set(1.12, 0.95, 1); face.position.z = 0.005; head.add(face);
    // 耳朵灯 + 天线
    [-1, 1].forEach((s) => { const ear = mesh(cylGeo(0.13, 0.13, 0.1, 24), accent); ear.rotation.z = Math.PI / 2; ear.position.x = s * 0.7; head.add(ear); });
    const halo = mesh(torusGeo(0.36, 0.04, 10, 48), uniqueSpriteMaterial(neon(0xfbbf24))); halo.rotation.x = Math.PI / 2; halo.position.y = 0.82; head.add(halo);

    // 身子：小圆身 + 金色领结（管家）
    const torso = mesh(sphereGeo(0.42, 32, 24), shell); torso.scale.set(1, 1.05, 0.9); torso.position.y = 0.72; body.add(torso);
    const belt = mesh(torusGeo(0.39, 0.03, 8, 40), accent); belt.rotation.x = Math.PI / 2; belt.position.y = 0.6; body.add(belt);
    const bow = new THREE.Group(); bow.position.set(0, 1.0, 0.36);
    [-1, 1].forEach((s) => { const w = mesh(new THREE.ConeGeometry(0.1, 0.18, 4), gold); w.rotation.z = s * Math.PI / 2; w.position.x = s * 0.09; bow.add(w); });
    bow.add(mesh(sphereGeo(0.045, 12, 10), gold)); body.add(bow);
    // 胸口状态灯
    const chest = mesh(new THREE.CircleGeometry(0.07, 24), uniqueSpriteMaterial(neon(0x67e8f9)), { cast: false }); chest.position.set(0, 0.74, 0.39); body.add(chest);
    // 背后小推进翼
    const wingMat = glassMat(0x7dd3fc, 0.55);
    const wings = [-1, 1].map((s) => { const g = new THREE.Group(); g.position.set(s * 0.3, 0.9, -0.3);
      const b = mesh(octaGeo(0.26), wingMat, { cast: false }); b.scale.set(1.3, 0.55, 0.14); b.position.x = s * 0.26; g.add(b); body.add(g); return g; });
    // 底部推进光
    const thruster = mesh(new THREE.ConeGeometry(0.2, 0.32, 24, 1, true), neon(0x38bdf8, { opacity: 0.55 }), { cast: false }); thruster.rotation.x = Math.PI; thruster.position.y = 0.2; body.add(thruster);
    const tg = glowSprite(0x38bdf8, 1.0, 0.7); tg.position.y = 0.12; body.add(tg);

    // 悬浮的手（不连手臂）
    const mkHand = () => { const h = new THREE.Group(); const palm = mesh(sphereGeo(0.15, 20, 16), shell); palm.scale.set(1, 0.9, 0.8); h.add(palm);
      const thumb = mesh(sphereGeo(0.06, 12, 10), shell); thumb.position.set(0.1, 0.05, 0.05); h.add(thumb);
      const cuff = mesh(torusGeo(0.11, 0.025, 8, 24), accent); cuff.rotation.y = Math.PI / 2; cuff.position.x = -0.1; h.add(cuff); return h; };
    const handL = mkHand(); const handR = mkHand(); handL.scale.x = -1; body.add(handL, handR);
    const finger = mesh(new THREE.CapsuleGeometry(0.035, 0.14, 4, 10), shell); finger.rotation.z = -Math.PI / 2; finger.position.set(0.18, 0, 0); finger.visible = false; handR.add(finger);

    // 平板（汇报时举起）
    const tablet = new THREE.Group();
    const slab = mesh(boxGeo(0.42, 0.56, 0.04), phys(0x1e293b, { rough: 0.3 })); tablet.add(slab);
    const tc = document.createElement("canvas"); tc.width = 128; tc.height = 170; const tx = tc.getContext("2d");
    tx.fillStyle = "#0b1530"; tx.fillRect(0, 0, 128, 170); tx.fillStyle = "#67e8f9"; tx.font = "bold 18px sans-serif"; tx.fillText(assistantText("工单 3", "Cards 3"), 14, 28);
    [["#ef4444", "!"], ["#fbbf24", "$"], ["#fb923c", "🚧"]].forEach(([c, s], i) => { tx.fillStyle = c; tx.beginPath(); tx.arc(24, 60 + i * 36, 10, 0, 7); tx.fill();
      tx.fillStyle = "#cbd5e1"; tx.fillRect(44, 54 + i * 36, 70, 10); });
    const ttex = new THREE.CanvasTexture(tc); ttex.colorSpace = THREE.SRGBColorSpace;
    const scr = mesh(new THREE.PlaneGeometry(0.36, 0.5), new THREE.MeshBasicMaterial({ map: ttex, toneMapped: false }), { cast: false }); scr.position.z = 0.022; tablet.add(scr);
    tablet.visible = false; body.add(tablet);

    // 头顶 ! 标记
    const bang = new THREE.Group(); const bm = neon(0xef4444);
    const bar = mesh(new THREE.CapsuleGeometry(0.07, 0.26, 4, 12), bm, { cast: false }); bar.position.y = 0.2; bang.add(bar);
    const dot = mesh(sphereGeo(0.075, 12, 10), bm, { cast: false }); dot.position.y = -0.1; bang.add(dot);
    bang.add(glowSprite(0xef4444, 1.1, 0.5)); bang.position.y = 2.98; bang.visible = state === "waiting"; root.add(bang);

    // 金币（报喜）
    const coin = mesh(cylGeo(0.16, 0.16, 0.04, 28), gold); coin.rotation.x = Math.PI / 2; coin.visible = state === "good"; root.add(coin);

    const shadow = mesh(new THREE.CircleGeometry(0.55, 32), new THREE.MeshBasicMaterial({ color: 0x0f172a, transparent: true, opacity: 0.16, depthWrite: false }), { cast: false });
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = -0.38; root.add(shadow);

    root.userData.setMood = (next) => {
      state = next === "patrol" ? "idle" : next;
      const tint = { worry: 0xfb923c, good: 0xfbbf24, waiting: 0xf87171, doze: 0x64748b }[state];
      chest.material.color.setHex(tint || 0x67e8f9);
      accent.color.setHex(tint || 0x38bdf8);
      accent.emissive.setHex(tint || 0x0284c7);
      accent.emissiveIntensity = tint ? 0.25 : 0.35;
      halo.material.color.setHex(state === "doze" ? 0x94a3b8 : 0xfbbf24);
      bang.visible = state === "waiting";
      coin.visible = state === "good";
      faceAt = -Infinity;
    };
    root.userData.textures = [tex, ttex];
    let faceAt = -Infinity;
    root.userData.setMood(state);
    root.userData.tick = (t) => {
      if (t - faceAt >= 0.1) { drawFace(fctx, state, t); tex.needsUpdate = true; faceAt = t; }
      const bobAmp = state === "doze" ? 0.02 : 0.08;
      body.position.y = Math.sin(t * 2.2) * bobAmp + (state === "doze" ? -0.15 : 0);
      const flapHz = { guide: 14, worry: 5, doze: 1.5 }[state] ?? 8;
      wings.forEach((w, i) => { w.rotation.y = (i ? -1 : 1) * Math.sin(t * flapHz) * 0.45; });
      halo.rotation.z = t * ({ thinking: 7, guide: 3 }[state] ?? 1.2);
      if (state === "thinking") halo.material.color.setHSL(0.5 + 0.08 * Math.sin(t * 4), 0.9, 0.6);
      // 手势
      let l = [-0.62, 0.72, 0.15], r = [0.62, 0.72, 0.15], lr = 0, rr = 0;
      finger.visible = false; tablet.visible = false; head.rotation.set(0, 0, 0); body.rotation.set(0, 0, 0);
      switch (state) {
        case "idle": l[1] += Math.sin(t * 2.2 + 1) * 0.04; r[1] += Math.sin(t * 2.2 + 2) * 0.04; break;
        case "inspect": r = [0.5, 1.95, 0.42]; rr = -0.6; head.rotation.y = 0.35; head.rotation.x = 0.12; break;
        case "guide": r = [1.05, 1.35, 0.35]; finger.visible = true; head.rotation.y = 0.45; body.rotation.z = -0.12; break;
        case "thinking": r = [0.32, 1.12, 0.55]; rr = -0.8; head.rotation.z = 0.12; head.rotation.x = -0.08; break;
        case "good": l = [-0.75, 1.85, 0.2]; r = [0.75, 1.85, 0.2]; lr = 0.5; rr = -0.5;
          coin.position.set(0, 2.6 + ((t * 1.2) % 1) * 0.5, 0.2); coin.rotation.z = t * 6; break;
        case "worry": l = [-0.42, 1.45, 0.5]; r = [0.42, 1.45, 0.5]; head.rotation.x = 0.15; break;
        case "waiting": r = [0.78, 1.7 + Math.sin(t * 6) * 0.08, 0.25]; rr = Math.sin(t * 6) * 0.4; bang.position.y = 2.98 + Math.abs(Math.sin(t * 4)) * 0.12; break;
        case "listening": l = [-0.78, 1.55, 0.05]; r = [0.78, 1.55, 0.05]; head.rotation.x = -0.1; break;
        case "doze": l = [-0.55, 0.5, 0.2]; r = [0.55, 0.5, 0.2]; head.rotation.x = 0.3; head.rotation.z = 0.15; break;
        case "report": l = [-0.3, 1.05, 0.62]; r = [0.3, 1.05, 0.62]; tablet.visible = true; tablet.position.set(0, 1.2, 0.68); tablet.rotation.x = -0.25; head.rotation.x = 0.18; break;
      }
      handL.position.set(...l); handR.position.set(...r); handL.rotation.z = lr; handR.rotation.z = rr;
    };
    return root;
  }


  // --------------------------------------------------------------- rooms
  function buildRoomDecor(rm, group) {
    const light = isLight();
    const top = PLAT_TOP;
    if (rm.id === "indie-lab") {
      const rackMat = phys(light ? 0x334155 : 0x111827, { rough: 0.3, metal: 0.7, clear: 0.6 });
      [7.9, 9.1].forEach((x, i) => {
        const rack = mesh(slabGeo(0.8, 0.7, 1.9, 0.06, 0.03), rackMat, { cast: true, receive: true });
        rack.position.set(x, top, 4.2);
        group.add(rack);
        const leds = [];
        for (let r = 0; r < 6; r += 1) {
          const ledMat = new THREE.MeshBasicMaterial({ color: r % 3 === 0 ? 0x34d399 : 0x38bdf8, toneMapped: false });
          const led = mesh(boxGeo(0.5, 0.04, 0.02), ledMat, { cast: false });
          led.position.set(x, top + 0.3 + r * 0.26, 4.56);
          group.add(led);
          leds.push({ led, seed: Math.random() * 10 + i });
        }
        animators.push((t) => {
          leds.forEach(({ led, seed }) => {
            const on = Math.sin(t * (3 + seed % 4) + seed) > -0.3;
            led.material.color.setHex(on ? (seed % 2 > 1 ? 0x34d399 : 0x38bdf8) : 0x0f172a);
          });
        });
      });
    } else if (rm.id === "drama-studio") {
      const frame = mesh(panelGeo(5.2, 2.7, 0.2, 0.12), phys(0x111827, { rough: 0.3, metal: 0.6 }));
      frame.position.set(4.8, top + 1.55, -4.9);
      const screenMat = new THREE.MeshBasicMaterial({ map: tex.wall, toneMapped: false, color: light ? 0xdddddd : 0xffffff });
      const screen = mesh(geo("led-wall", () => new THREE.PlaneGeometry(4.9, 2.4)), screenMat, { cast: false });
      screen.position.set(4.8, top + 1.55, -4.79);
      group.add(frame, screen);
      const wallGlow = glowSprite(0xc084fc, 5.5, 0.35);
      wallGlow.position.set(4.8, top + 1.55, -4.5);
      group.add(wallGlow);
      // Camera rig
      const tripod = mesh(coneGeo(0.36, 1.0, 3, true), phys(0x334155, { metal: 0.8, rough: 0.3 }));
      tripod.position.set(-4.6, top + 0.5, 2.6);
      const camBody = mesh(slabGeo(0.6, 0.42, 0.42, 0.06, 0.03), phys(0x0f172a, { rough: 0.25, metal: 0.5, clear: 1 }));
      camBody.position.set(-4.6, top + 1.0, 2.6);
      camBody.rotation.y = -0.7;
      const lens = mesh(cylGeo(0.12, 0.14, 0.3, 20), phys(0x1e293b, { metal: 0.9, rough: 0.2 }));
      lens.rotation.z = Math.PI / 2;
      lens.rotation.y = -0.7 + Math.PI / 2;
      lens.position.set(-4.35, top + 1.2, 2.35);
      const rec = mesh(sphereGeo(0.04, 8, 6), neon(0xef4444), { cast: false });
      rec.position.set(-4.75, top + 1.47, 2.6);
      group.add(tripod, camBody, lens, rec);
      animators.push((t) => {
        tex.wall.offset.x = (t * 0.05) % 1;
        rec.visible = Math.sin(t * 4) > 0;
      });
    } else if (rm.id === "global-pub") {
      const ped = mesh(cylGeo(0.7, 0.9, 0.5, 32), phys(light ? 0x94a3b8 : 0x1e293b, { rough: light ? 0.38 : 0.3, metal: 0.6, clear: light ? 0.35 : 0.8 }), { cast: true, receive: true });
      ped.position.set(0, top + 0.25, -3.5);
      const core = mesh(sphereGeo(0.78, 32, 24), phys(0x0c4a6e, { rough: 0.2, metal: 0.3, clear: 1, emissive: 0x075985, ei: 0.35 }));
      core.position.set(0, top + 1.6, -3.5);
      const wire = mesh(geo("globe-wire", () => new THREE.SphereGeometry(0.84, 18, 12)), cached("globe-wire-mat", () => new THREE.MeshBasicMaterial({ color: 0xfbbf24, wireframe: true, toneMapped: false, transparent: true, opacity: 0.55 })), { cast: false });
      wire.position.copy(core.position);
      const orbit = mesh(torusGeo(1.15, 0.02, 6, 64), neon(0xfbbf24), { cast: false });
      orbit.position.copy(core.position);
      orbit.rotation.x = 1.2;
      const sat = mesh(sphereGeo(0.07, 10, 8), neon(0xfef3c7), { cast: false });
      group.add(ped, core, wire, orbit, sat);
      const gl = glowSprite(0xf59e0b, 3.0, 0.35);
      gl.position.copy(core.position);
      group.add(gl);
      animators.push((t) => {
        wire.rotation.y = t * 0.4;
        core.rotation.y = t * 0.4;
        const a = t * 1.4;
        const p = new THREE.Vector3(Math.cos(a) * 1.15, 0, Math.sin(a) * 1.15).applyEuler(orbit.rotation);
        sat.position.set(core.position.x + p.x, core.position.y + p.y, core.position.z + p.z);
      });
    } else if (rm.id === "bounty-guild") {
      const heights = [0.5, 0.85, 0.65, 1.2];
      const cols = [0x10b981, 0x34d399, 0xf59e0b, 0x10b981];
      heights.forEach((h, i) => {
        const bar = mesh(slabGeo(0.3, 0.3, h, 0.05, 0.03), phys(cols[i], { rough: 0.25, clear: 1, emissive: cols[i], ei: 0.3 }));
        bar.position.set(-0.69 + i * 0.46, top, -4.6);
        group.add(bar);
        animators.push((t) => {
          bar.scale.y = 1 + Math.sin(t * 1.3 + i * 0.9) * 0.08;
        });
      });
    } else if (rm.id === "incubator") {
      const dome = mesh(geo("inc-dome", () => new THREE.SphereGeometry(3.4, 40, 20, 0, Math.PI * 2, 0, Math.PI / 2)), glassMat(light ? 0xfef9c3 : 0xfbbf24, light ? 0.16 : 0.08), { cast: false });
      dome.scale.set(1.0, 0.75, 1.55);
      dome.position.y = top;
      const frame = mesh(geo("inc-frame", () => new THREE.IcosahedronGeometry(3.42, 1)), cached("inc-frame-mat", () => new THREE.MeshBasicMaterial({ color: 0xfbbf24, wireframe: true, toneMapped: false, transparent: true, opacity: light ? 0.35 : 0.22 })), { cast: false });
      frame.scale.set(1.0, 0.75, 1.55);
      frame.position.y = top;
      group.add(dome, frame);
    }
  }

  function buildConduit(rm, live) {
    const light = isLight();
    const len = Math.hypot(rm.x, rm.z);
    const cg = new THREE.Group();
    cg.position.set(rm.x / 2, 0, rm.z / 2);
    cg.rotation.y = Math.atan2(rm.x, rm.z);
    const rail = mesh(new THREE.PlaneGeometry(0.7, len), phys(light ? 0x8696ac : 0x0c1527, { rough: light ? 0.62 : 0.5, metal: 0.3, clear: light ? 0.15 : 0.4 }), { cast: false, receive: true });
    rail.rotation.x = -Math.PI / 2;
    rail.position.y = 0.012;
    const flowGeo = new THREE.PlaneGeometry(0.26, len);
    const uv = flowGeo.attributes.uv;
    for (let i = 0; i < uv.count; i += 1) uv.setY(i, uv.getY(i) * (len / 2.2));
    const flowMat = new THREE.MeshBasicMaterial({
      map: tex.flow,
      color: rm.colorHex,
      transparent: true,
      opacity: live ? 1 : 0.45,
      blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const flow = mesh(flowGeo, flowMat, { cast: false });
    flow.rotation.x = -Math.PI / 2;
    flow.position.y = 0.022;
    cg.add(rail, flow);
    dynamicGroup.add(cg);
    return { flowMat };
  }

  function buildRoom(rm, idx, now) {
    const light = isLight();
    const group = new THREE.Group();
    group.position.set(rm.x, 0, rm.z);
    const accent = new THREE.Color(rm.colorHex);
    const baseCol = new THREE.Color(light ? 0xd8e1ec : 0x111a2e);

    const rimMat = new THREE.MeshStandardMaterial({
      color: rm.colorHex,
      emissive: rm.colorHex,
      emissiveIntensity: light ? 0.25 : 1.0,
      roughness: 0.4,
    });
    const rim = mesh(slabGeo(rm.w + 0.3, rm.d + 0.3, 0.1, 0.95, 0.03), rimMat, { cast: false, receive: true });
    group.add(rim);

    const slab = mesh(slabGeo(rm.w, rm.d, PLAT_TOP, 0.85, 0.07), phys(baseCol.getHex(), { rough: light ? 0.56 : 0.48, metal: light ? 0.04 : 0.15, clear: light ? 0.12 : 0.6 }), { cast: true, receive: true });
    slab.userData = { kind: rm.id === "incubator" ? "incubator" : "room", roomId: rm.id };
    group.add(slab);
    interactiveMeshes.push(slab);

    const inlayCol = baseCol.clone().lerp(accent, light ? 0.14 : 0.1);
    const inlay = mesh(slabGeo(rm.w - 1.0, rm.d - 1.0, 0.012, 0.55, 0), phys(inlayCol.getHex(), { rough: light ? 0.62 : 0.55, clear: light ? 0.08 : 0.4 }), { cast: false, receive: true });
    inlay.position.y = PLAT_TOP;
    group.add(inlay);

    const wallH = 0.95;
    const gm = glassMat(rm.colorHex, light ? 0.14 : 0.1);
    const back = mesh(boxGeo(rm.w - 0.6, wallH, 0.06), gm, { cast: false });
    back.position.set(0, PLAT_TOP + wallH / 2, -rm.d / 2 + 0.2);
    const left = mesh(boxGeo(0.06, wallH, rm.d - 0.6), gm, { cast: false });
    left.position.set(-rm.w / 2 + 0.2, PLAT_TOP + wallH / 2, 0);
    const trimMat = new THREE.MeshBasicMaterial({ color: rm.colorHex, toneMapped: false });
    const backTrim = mesh(boxGeo(rm.w - 0.6, 0.05, 0.08), trimMat, { cast: false });
    backTrim.position.set(0, PLAT_TOP + wallH, -rm.d / 2 + 0.2);
    const leftTrim = mesh(boxGeo(0.08, 0.05, rm.d - 0.6), trimMat, { cast: false });
    leftTrim.position.set(-rm.w / 2 + 0.2, PLAT_TOP + wallH, 0);
    group.add(back, left, backTrim, leftTrim);

    const postMat = phys(light ? 0x64748b : 0x334155, { rough: 0.32, metal: 0.85 });
    [
      [-rm.w / 2 + 0.2, -rm.d / 2 + 0.2],
      [rm.w / 2 - 0.3, -rm.d / 2 + 0.2],
      [-rm.w / 2 + 0.2, rm.d / 2 - 0.3],
    ].forEach(([px, pz]) => {
      const post = mesh(cylGeo(0.06, 0.06, wallH + 0.08, 12), postMat);
      post.position.set(px, PLAT_TOP + (wallH + 0.08) / 2, pz);
      group.add(post);
    });

    buildRoomDecor(rm, group);
    dynamicGroup.add(group);
    const conduit = buildConduit(rm, rm.liveCount > 0);

    const banner = document.createElement("button");
    banner.type = "button";
    banner.className = "tycoon3d-room-chip";
    banner.style.setProperty("--room-accent", rm.accentCss);
    banner.innerHTML = formatRoomBannerHtml(rm);
    banner.addEventListener("click", (ev) => {
      ev.stopPropagation();
      panToPosition(rm.x, rm.z, rm.camZoom);
      if (rm.id === "incubator") onSelectIncubator?.();
      else onSelectRoom?.(rm.id);
    });
    labelsWrap.appendChild(banner);

    roomRecords.set(rm.id, {
      rm,
      group,
      trimMat,
      rimMat,
      flowMat: conduit.flowMat,
      baseRimIntensity: light ? 0.25 : 1.0,
      banner,
      anchor: new THREE.Vector3(rm.x, PLAT_TOP + wallH + 0.3, rm.z - rm.d / 2 + 0.2),
      spawnAt: firstBuildDone ? -1e9 : now + idx * 90,
      introAlpha: firstBuildDone ? 1 : 0,
      isSelected: false,
    });
  }

  // --------------------------------------------------------- workstation
  function buildSafetyCone(alertRed = false) {
    const g = new THREE.Group();
    const base = mesh(boxGeo(0.32, 0.04, 0.32), phys(0x1e293b, { rough: 0.6 }), { cast: true, receive: true });
    base.position.y = 0.02;
    const cone = mesh(coneGeo(0.13, 0.38, 16), phys(alertRed ? 0xef4444 : 0xf97316, { rough: 0.35 }), { cast: true });
    cone.position.y = 0.23;
    const stripe = mesh(cylGeo(0.075, 0.102, 0.08, 16), phys(0xf8fafc, { rough: 0.25 }), { cast: false });
    stripe.position.y = 0.22;
    g.add(base, cone, stripe);
    return g;
  }

  // Resting lounge couch (bot naps here when the station is idle)
  function buildCouch(light) {
    const g = new THREE.Group();
    const fabric = phys(light ? 0x818cf8 : 0x4338ca, { rough: 0.85 });
    const cushionMat = phys(light ? 0xc7d2fe : 0x6366f1, { rough: 0.9 });
    const base = mesh(slabGeo(1.3, 0.72, 0.24, 0.14, 0.05), fabric, { cast: true, receive: true });
    base.position.y = 0.04;
    const seat = mesh(slabGeo(1.1, 0.6, 0.1, 0.12, 0.04), cushionMat, { cast: true, receive: true });
    seat.position.y = 0.28;
    const back = mesh(panelGeo(1.3, 0.5, 0.2, 0.1), fabric);
    back.position.set(0, 0.5, -0.27);
    const armL = mesh(slabGeo(0.16, 0.72, 0.44, 0.06, 0.03), fabric, { cast: true });
    armL.position.set(-0.62, 0, 0);
    const armR = mesh(slabGeo(0.16, 0.72, 0.44, 0.06, 0.03), fabric, { cast: true });
    armR.position.set(0.62, 0, 0);
    const pillow = mesh(slabGeo(0.3, 0.42, 0.12, 0.1, 0.04), phys(0xf8fafc, { rough: 0.9 }));
    pillow.position.set(-0.4, 0.38, 0.02);
    g.add(base, seat, back, armL, armR, pillow);
    return g;
  }

  // Room-specific station rigs so every department reads differently at a glance.
  function buildStationRig(ws, act, light, pal) {
    const g = new THREE.Group();
    const anims = [];
    const powered = act.isWorking || act.isPending;
    const archetype = ws.archetype || resolveStationArchetype(ws.roomId);
    const screenMat = screenMaterial(ws);
    const darkMetal = phys(light ? 0x94a3b8 : 0x334155, { rough: 0.28, metal: 0.85 });
    const bezelMat = phys(0x0b1220, { rough: 0.28, metal: 0.6, clear: 0.9 });
    const onColor = act.isPending ? 0xef4444 : (act.intensityTier >= 3 ? 0xfb923c : (act.intensityTier === 2 ? 0xf59e0b : 0x34d399));
    const offColor = light ? 0x94a3b8 : 0x1e293b;
    const ledMat = (on, color = onColor) => new THREE.MeshBasicMaterial({
      color: on ? color : offColor,
      toneMapped: false,
      transparent: true,
      opacity: 1,
    });
    const addScreen = (w, h, x, y, z, rotY = 0) => {
      const sg = new THREE.Group();
      sg.position.set(x, y, z);
      sg.rotation.y = rotY;
      const bezel = mesh(panelGeo(w + 0.08, h + 0.08, 0.05, 0.04), bezelMat);
      const scr = mesh(geo(`rig-scr|${w}|${h}`, () => new THREE.PlaneGeometry(w, h)), screenMat, { cast: false });
      scr.position.z = 0.027;
      sg.add(bezel, scr);
      g.add(sg);
      return sg;
    };
    const addDesk = (w, d, topMat, y = 0.68) => {
      const top = mesh(slabGeo(w, d, 0.07, 0.12, 0.025), topMat, { cast: true, receive: true });
      top.position.set(0, y, 0.12);
      g.add(top);
      [-(w / 2 - 0.12), w / 2 - 0.12].forEach((lx) => {
        const leg = mesh(boxGeo(0.06, y, d - 0.14), darkMetal);
        leg.position.set(lx, y / 2, 0.12);
        g.add(leg);
      });
    };

    if (archetype === "studio") {
      // Film camera on a tripod + softbox light + director monitor + clapperboard
      const cam = new THREE.Group();
      cam.position.set(0, 0, 0.15);
      for (let i = 0; i < 3; i += 1) {
        const a = (i / 3) * Math.PI * 2 + 0.5;
        const leg = mesh(cylGeo(0.022, 0.03, 1.2, 8), darkMetal);
        leg.position.set(Math.cos(a) * 0.22, 0.56, Math.sin(a) * 0.22);
        leg.rotation.set(-Math.sin(a) * 0.36, 0, Math.cos(a) * 0.36);
        cam.add(leg);
      }
      const head = new THREE.Group();
      head.position.y = 1.18;
      const camBodyMat = phys(light ? 0x1f2937 : 0x111827, { rough: 0.35, metal: 0.5, clear: 0.6 });
      const camBody = mesh(boxGeo(0.44, 0.34, 0.66), camBodyMat);
      camBody.position.y = 0.1;
      const lens = mesh(cylGeo(0.13, 0.16, 0.32, 20), camBodyMat);
      lens.rotation.x = Math.PI / 2;
      lens.position.set(0, 0.1, -0.48);
      const lensGlass = mesh(cylGeo(0.11, 0.11, 0.012, 20), powered ? neon(0x38bdf8) : phys(0x0b1220, { rough: 0.2 }), { cast: false });
      lensGlass.rotation.x = Math.PI / 2;
      lensGlass.position.set(0, 0.1, -0.645);
      const reelMat = phys(light ? 0x475569 : 0x334155, { rough: 0.3, metal: 0.7 });
      const reel1 = mesh(cylGeo(0.2, 0.2, 0.06, 24), reelMat);
      reel1.rotation.z = Math.PI / 2;
      reel1.position.set(0, 0.47, -0.12);
      const reel2 = mesh(cylGeo(0.2, 0.2, 0.06, 24), reelMat);
      reel2.rotation.z = Math.PI / 2;
      reel2.position.set(0, 0.47, 0.2);
      const recMat = ledMat(powered, 0xef4444);
      const rec = mesh(sphereGeo(0.055, 12, 10), recMat, { cast: false });
      rec.position.set(0.16, 0.3, -0.26);
      head.add(camBody, lens, lensGlass, reel1, reel2, rec);
      cam.add(head);
      g.add(cam);

      const box = new THREE.Group();
      box.position.set(-1.2, 0, -0.2);
      const boxBase = mesh(cylGeo(0.2, 0.24, 0.05, 16), darkMetal);
      boxBase.position.y = 0.025;
      const pole = mesh(cylGeo(0.025, 0.03, 1.55, 8), darkMetal);
      pole.position.y = 0.78;
      box.add(boxBase, pole);
      const boxHead = new THREE.Group();
      boxHead.position.y = 1.62;
      boxHead.rotation.order = "YXZ";
      boxHead.rotation.set(0.35, 1.2, 0);
      const boxBody = mesh(boxGeo(0.66, 0.52, 0.26), phys(0x0f172a, { rough: 0.6 }));
      const faceMat = new THREE.MeshBasicMaterial({ color: powered ? 0xfff7d6 : (light ? 0x64748b : 0x1e293b), toneMapped: false });
      const face = mesh(geo("softbox-face", () => new THREE.PlaneGeometry(0.6, 0.46)), faceMat, { cast: false });
      face.position.z = 0.135;
      boxHead.add(boxBody, face);
      if (powered) {
        const beamMatS = new THREE.MeshBasicMaterial({
          color: 0xfff1c1,
          transparent: true,
          opacity: light ? 0.24 : 0.18,
          blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const beamCone = new THREE.Mesh(coneGeo(0.6, 1.5, 24, true), beamMatS);
        beamCone.rotation.x = -Math.PI / 2;
        beamCone.position.z = 0.9;
        boxHead.add(beamCone);
      }
      box.add(boxHead);
      g.add(box);

      const monPole = mesh(cylGeo(0.022, 0.026, 0.95, 8), darkMetal);
      monPole.position.set(0.95, 0.47, -0.2);
      g.add(monPole);
      addScreen(0.52, 0.32, 0.95, 1.08, -0.2, -0.5);

      const clap = new THREE.Group();
      clap.position.set(0.62, 0, 0.62);
      clap.rotation.y = -0.6;
      const board = mesh(boxGeo(0.36, 0.26, 0.03), phys(0x0f172a, { rough: 0.5 }));
      board.position.y = 0.16;
      const stickPivot = new THREE.Group();
      stickPivot.position.set(-0.18, 0.32, 0);
      const stick = mesh(boxGeo(0.38, 0.06, 0.035), phys(0xf8fafc, { rough: 0.4 }));
      stick.position.x = 0.19;
      stickPivot.add(stick);
      clap.add(board, stickPivot);
      g.add(clap);

      if (powered) {
        anims.push((t) => {
          reel1.rotation.x = t * 4;
          reel2.rotation.x = t * 4;
          recMat.color.setHex(Math.sin(t * 6) > 0 ? 0xef4444 : 0x450a0a);
          stickPivot.rotation.z = Math.max(0, Math.sin(t * 2.4)) * 0.55;
        });
      }
    } else if (archetype === "broadcast") {
      // Broadcast console + video wall + ON AIR light + rotating satellite dish
      const consoleMat = phys(light ? 0xd8e1ec : 0x1e293b, { rough: light ? 0.45 : 0.3, clear: light ? 0.22 : 0.8 });
      const consoleBase = mesh(boxGeo(2.0, 0.62, 0.7), consoleMat, { cast: true, receive: true });
      consoleBase.position.set(0, 0.31, 0.2);
      const consoleTop = mesh(boxGeo(2.04, 0.06, 0.8), phys(light ? 0x94a3b8 : 0x0f172a, { rough: 0.45, metal: 0.4 }));
      consoleTop.position.set(0, 0.66, 0.2);
      consoleTop.rotation.x = 0.22;
      g.add(consoleBase, consoleTop);
      const btnColors = [0x34d399, 0xf59e0b, 0x38bdf8, 0xef4444];
      const btnMats = [];
      for (let i = 0; i < 9; i += 1) {
        const m = ledMat(powered, btnColors[i % btnColors.length]);
        const btn = mesh(boxGeo(0.11, 0.04, 0.11), m, { cast: false });
        btn.position.set(-0.76 + i * 0.19, 0.69, 0.3);
        btn.rotation.x = 0.22;
        g.add(btn);
        btnMats.push(m);
      }
      [-0.9, 0.9].forEach((px) => {
        const post = mesh(cylGeo(0.03, 0.03, 1.1, 8), darkMetal);
        post.position.set(px, 0.95, -0.36);
        g.add(post);
      });
      addScreen(1.9, 0.72, 0, 1.45, -0.34, 0);
      const onAirMat = ledMat(powered, 0xef4444);
      const onAir = mesh(boxGeo(0.56, 0.18, 0.08), onAirMat, { cast: false });
      onAir.position.set(0, 1.96, -0.34);
      g.add(onAir);
      const mic = new THREE.Group();
      mic.position.set(0.45, 0.7, 0.32);
      const micStem = mesh(cylGeo(0.012, 0.012, 0.28, 6), darkMetal);
      micStem.position.y = 0.14;
      const micHead = mesh(sphereGeo(0.055, 12, 10), phys(0x111827, { rough: 0.6 }));
      micHead.position.y = 0.3;
      mic.add(micStem, micHead);
      g.add(mic);

      const sat = new THREE.Group();
      sat.position.set(-1.3, 0, -0.1);
      const satBase = mesh(cylGeo(0.18, 0.22, 0.08, 16), darkMetal);
      satBase.position.y = 0.04;
      const satPole = mesh(cylGeo(0.035, 0.045, 1.0, 10), darkMetal);
      satPole.position.y = 0.5;
      sat.add(satBase, satPole);
      const yaw = new THREE.Group();
      yaw.position.y = 1.02;
      const tilt = new THREE.Group();
      tilt.rotation.x = 0.75;
      const dishMat = cached(`sat-dish-${light}`, () => new THREE.MeshStandardMaterial({
        color: light ? 0xf8fafc : 0xcbd5e1,
        roughness: 0.4,
        metalness: 0.3,
        side: THREE.DoubleSide,
      }));
      const dish = mesh(geo("sat-dish", () => new THREE.SphereGeometry(0.52, 24, 10, 0, Math.PI * 2, 0, 0.78)), dishMat);
      dish.rotation.x = Math.PI;
      dish.position.y = 0.52;
      const feed = mesh(cylGeo(0.015, 0.015, 0.42, 6), darkMetal);
      feed.position.y = 0.28;
      const feedTip = mesh(sphereGeo(0.045, 10, 8), powered ? neon(onColor) : phys(offColor, { rough: 0.5 }), { cast: false });
      feedTip.position.y = 0.5;
      tilt.add(dish, feed, feedTip);
      yaw.add(tilt);
      sat.add(yaw);
      g.add(sat);

      if (powered) {
        anims.push((t) => {
          yaw.rotation.y = t * 0.9;
          onAirMat.opacity = 0.55 + 0.45 * (Math.sin(t * 5) > 0 ? 1 : 0.3);
          btnMats.forEach((m, i) => { m.opacity = Math.sin(t * (5 + i) + i * 1.3) > -0.2 ? 1 : 0.25; });
        });
      }
    } else if (archetype === "workshop") {
      // Workbench + robotic arm welding + spinning gear wheel + crates + toolbox
      const wood = phys(light ? 0xc2875a : 0x7c4a2a, { rough: 0.7 });
      const woodDark = phys(light ? 0x8a5a3b : 0x4a2c1a, { rough: 0.75 });
      const benchTop = mesh(slabGeo(2.15, 0.95, 0.12, 0.06, 0.02), wood, { cast: true, receive: true });
      benchTop.position.set(0, 0.62, 0.1);
      g.add(benchTop);
      [[-0.95, -0.27], [0.95, -0.27], [-0.95, 0.47], [0.95, 0.47]].forEach(([lx, lz]) => {
        const leg = mesh(boxGeo(0.1, 0.62, 0.1), woodDark);
        leg.position.set(lx, 0.31, lz);
        g.add(leg);
      });
      const anvil = mesh(boxGeo(0.36, 0.18, 0.24), darkMetal);
      anvil.position.set(0.5, 0.83, 0.08);
      const toolbox = mesh(boxGeo(0.44, 0.24, 0.26), phys(0xdc2626, { rough: 0.4, metal: 0.3 }));
      toolbox.position.set(0.98, 0.12, -0.55);
      const handle = mesh(boxGeo(0.22, 0.04, 0.04), darkMetal);
      handle.position.set(0.98, 0.27, -0.55);
      g.add(anvil, toolbox, handle);

      const armColor = powered ? 0xf97316 : (light ? 0x94a3b8 : 0x475569);
      const armMat = phys(armColor, { rough: 0.35, metal: 0.4 });
      const arm = new THREE.Group();
      arm.position.set(-0.42, 0.68, -0.05);
      const armBase = mesh(cylGeo(0.14, 0.17, 0.1, 16), darkMetal);
      armBase.position.y = 0.05;
      arm.add(armBase);
      const armYaw = new THREE.Group();
      armYaw.position.y = 0.1;
      const shoulder = new THREE.Group();
      const seg1 = mesh(boxGeo(0.1, 0.55, 0.1), armMat);
      seg1.position.y = 0.275;
      const elbow = new THREE.Group();
      elbow.position.y = 0.55;
      const seg2 = mesh(boxGeo(0.08, 0.45, 0.08), armMat);
      seg2.position.y = 0.225;
      const claw = mesh(sphereGeo(0.06, 10, 8), darkMetal);
      claw.position.y = 0.46;
      elbow.add(seg2, claw);
      shoulder.add(seg1, elbow);
      armYaw.add(shoulder);
      arm.add(armYaw);
      g.add(arm);
      const weldSparks = [];
      if (powered) {
        for (let i = 0; i < 6; i += 1) {
          const sm = new THREE.SpriteMaterial({
            map: tex.glow,
            color: i % 2 ? 0xfbbf24 : 0xfb923c,
            transparent: true,
            opacity: 0.95,
            blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          });
          const sp = new THREE.Sprite(sm);
          sp.scale.set(0.16, 0.16, 1);
          sp.position.y = 0.48;
          sp.userData.seed = Math.random() * Math.PI * 2;
          elbow.add(sp);
          weldSparks.push(sp);
        }
      } else {
        shoulder.rotation.z = -0.15;
        elbow.rotation.z = 2.3;
      }

      const gear = new THREE.Group();
      gear.position.set(-1.28, 0, -0.25);
      gear.rotation.y = Math.PI / 4;
      [-0.12, 0.12].forEach((px) => {
        const post = mesh(boxGeo(0.06, 0.8, 0.06), darkMetal);
        post.position.set(px, 0.4, -0.08);
        gear.add(post);
      });
      const wheel = new THREE.Group();
      wheel.position.y = 0.86;
      const gearMat = phys(powered ? 0xf59e0b : (light ? 0x94a3b8 : 0x475569), { rough: 0.3, metal: 0.8 });
      wheel.add(mesh(torusGeo(0.4, 0.07, 8, 32), gearMat));
      for (let i = 0; i < 10; i += 1) {
        const a = (i / 10) * Math.PI * 2;
        const tooth = mesh(boxGeo(0.12, 0.14, 0.1), gearMat);
        tooth.position.set(Math.cos(a) * 0.49, Math.sin(a) * 0.49, 0);
        tooth.rotation.z = a;
        wheel.add(tooth);
      }
      const hub = mesh(cylGeo(0.1, 0.1, 0.14, 16), darkMetal);
      hub.rotation.x = Math.PI / 2;
      wheel.add(hub);
      gear.add(wheel);
      g.add(gear);

      const crate = mesh(boxGeo(0.44, 0.44, 0.44), wood);
      crate.position.set(-1.15, 0.22, 0.6);
      const crate2 = mesh(boxGeo(0.3, 0.3, 0.3), woodDark);
      crate2.position.set(-1.12, 0.59, 0.58);
      crate2.rotation.y = 0.4;
      g.add(crate, crate2);

      if (powered) {
        anims.push((t) => {
          armYaw.rotation.y = Math.sin(t * 1.6) * 0.8;
          shoulder.rotation.z = -0.5 + Math.sin(t * 2.2) * 0.25;
          elbow.rotation.z = 1.2 + Math.sin(t * 3) * 0.35;
          wheel.rotation.z = -t * 1.8;
          weldSparks.forEach((sp) => {
            const k = (t * 3 + sp.userData.seed) % 1;
            sp.position.set(Math.cos(sp.userData.seed + t * 9) * k * 0.28, 0.48 + k * 0.18, Math.sin(sp.userData.seed + t * 9) * k * 0.28);
            sp.material.opacity = 0.95 * (1 - k);
          });
        });
      }
    } else {
      // Code lab: wide desk + triple monitors + blinking server rack
      addDesk(2.1, 0.92, phys(light ? 0xdce4ef : 0x1e293b, { rough: light ? 0.46 : 0.32, clear: light ? 0.22 : 0.8 }));
      const kb = mesh(slabGeo(0.62, 0.2, 0.03, 0.03, 0.01), phys(0x0f172a, { rough: 0.35, metal: 0.4, clear: 0.6 }));
      kb.position.set(0, 0.75, 0.33);
      g.add(kb);
      if (powered) {
        const kbGlow = mesh(boxGeo(0.58, 0.006, 0.16), neon(pal.emissive, { opacity: 0.6, additive: true }), { cast: false });
        kbGlow.position.set(0, 0.785, 0.33);
        g.add(kbGlow);
      }
      const stand = mesh(cylGeo(0.022, 0.022, 0.34, 8), darkMetal);
      stand.position.set(0, 0.86, -0.18);
      g.add(stand);
      addScreen(0.84, 0.48, 0, 1.12, -0.18, 0);
      addScreen(0.6, 0.42, -0.78, 1.08, -0.04, 0.5);
      addScreen(0.6, 0.42, 0.78, 1.08, -0.04, -0.5);

      const rack = new THREE.Group();
      rack.position.set(-1.3, 0, -0.1);
      const rackBody = mesh(boxGeo(0.46, 1.5, 0.5), phys(light ? 0x334155 : 0x0f172a, { rough: 0.4, metal: 0.6 }));
      rackBody.position.y = 0.75;
      rack.add(rackBody);
      const leds = [];
      for (let i = 0; i < 6; i += 1) {
        const m = ledMat(powered);
        const led = mesh(boxGeo(0.34, 0.05, 0.02), m, { cast: false });
        led.position.set(0, 0.3 + i * 0.2, 0.26);
        rack.add(led);
        leds.push(m);
      }
      g.add(rack);
      if (powered) {
        anims.push((t) => {
          leds.forEach((m, i) => { m.opacity = Math.sin(t * (7 + i * 1.7) + i) > 0 ? 1 : 0.25; });
        });
      }
    }

    return {
      group: g,
      anim: anims.length ? (t) => { for (let i = 0; i < anims.length; i += 1) anims[i](t); } : null,
    };
  }

  function screenMaterial(ws) {
    const light = isLight();
    if (ws.liveCount > 0) {
      return cached(`scr-live-${light}`, () => new THREE.MeshBasicMaterial({ map: tex.code, color: light ? 0xd1fae5 : 0xffffff, toneMapped: false }));
    }
    if (ws.pendingCount > 0) {
      return cached("scr-pending", () => new THREE.MeshBasicMaterial({ map: tex.code, color: 0xfca5a5, toneMapped: false }));
    }
    return cached(`scr-off-${light}`, () => new THREE.MeshBasicMaterial({ color: light ? 0x1e293b : 0x0b1220, toneMapped: false }));
  }

  function buildWorkstation(ws, idx, now, { isHotUpdate = false } = {}) {
    const light = isLight();
    const act = resolveWorkstationActivityState(ws);
    const pal = PROVIDER_COLORS[ws.primaryProvider] || PROVIDER_COLORS.default;
    const group = new THREE.Group();
    const wsAnims = [];
    group.position.set(ws.x, PLAT_TOP, ws.z);

    const hit = new THREE.Mesh(boxGeo(3.8, 3.4, 3.8), invisibleMat());
    hit.position.set(0, 1.5, -0.35);
    hit.userData = ws.isClusterHub
      ? { kind: "cluster", topicId: ws.topicId, roomId: ws.roomId, memberTopicIds: ws.memberTopicIds || [] }
      : { kind: "topic", topicId: ws.topicId, roomId: ws.roomId };
    group.add(hit);
    interactiveMeshes.push(hit);

    const padColor = act.isPending
      ? (light ? 0xf8b4b4 : 0x2b1218)
      : (act.isWorking ? (light ? 0x8be2b0 : 0x0b2520) : (light ? 0x94a3b8 : 0x050912));
    const pad = mesh(
      slabGeo(3.5, 3.5, 0.05, 0.55, 0.02),
      phys(padColor, {
        rough: act.isResting ? 0.78 : (light ? 0.58 : 0.45),
        clear: light ? 0.12 : (act.isResting ? 0.1 : 0.6),
      }),
      { cast: false, receive: true },
    );
    pad.position.set(0, 0, -0.3);
    group.add(pad);

    const powerHex = act.isPending
      ? 0xef4444
      : (act.intensityTier >= 3 ? 0xfb923c : (act.intensityTier === 2 ? 0xf59e0b : 0x10b981));
    const statusHex = (act.isWorking || act.isPending)
      ? powerHex
      : (light ? 0x94a3b8 : 0x334155);

    // Macro status floor pool: glowing spotlight when working, dim "lights out" shadow when resting
    const poolBase = (act.isWorking || act.isPending) ? (light ? 0.42 : 0.6) : (light ? 0.18 : 0.52);
    const poolMat = new THREE.MeshBasicMaterial({
      map: tex.pool,
      color: (act.isWorking || act.isPending) ? powerHex : (light ? 0x334155 : 0x000000),
      transparent: true,
      opacity: poolBase,
      blending: (act.isWorking || act.isPending) && !light ? THREE.AdditiveBlending : THREE.NormalBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const pool = new THREE.Mesh(geo("ws-pool", () => {
      const g = new THREE.PlaneGeometry(4.6, 4.6);
      g.rotateX(-Math.PI / 2);
      return g;
    }), poolMat);
    pool.position.set(0, 0.058, -0.3);
    group.add(pool);

    // Macro status light pillar (visible even at the most zoomed-out overview)
    let pillar = null;
    let pillarMat = null;
    let pillarBase = 0;
    if (act.isWorking || act.isPending) {
      pillarBase = light ? 0.62 : 0.78;
      pillarMat = new THREE.MeshBasicMaterial({
        map: tex.beam,
        color: powerHex,
        transparent: true,
        opacity: pillarBase,
        blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      pillar = new THREE.Mesh(cylGeo(0.42, 0.78, 6, 20, true), pillarMat);
      const widen = 1 + 0.28 * Math.max(0, act.intensityTier - 1);
      pillar.scale.set(widen, 1, widen);
      pillar.position.set(0, 3.1, -0.3);
      group.add(pillar);
    }
    const ringMat = new THREE.MeshBasicMaterial({
      color: statusHex,
      transparent: true,
      opacity: (act.isWorking || act.isPending) ? (light ? 0.82 : 0.72) : (light ? 0.22 : 0.16),
      toneMapped: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(geo("ws-ring", () => {
      const g = new THREE.RingGeometry(1.56, 1.78, 72);
      g.rotateX(-Math.PI / 2);
      return g;
    }), ringMat);
    ring.position.set(0, 0.065, -0.3);
    group.add(ring);

    let pulseRing = null;
    let pulseRingMat = null;
    if (act.isWorking || act.isPending) {
      pulseRingMat = new THREE.MeshBasicMaterial({
        color: statusHex,
        transparent: true,
        opacity: light ? 0.55 : 0.5,
        blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
        toneMapped: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      pulseRing = new THREE.Mesh(geo("ws-pulse-ring", () => {
        const g = new THREE.RingGeometry(1.62, 1.74, 72);
        g.rotateX(-Math.PI / 2);
        return g;
      }), pulseRingMat);
      pulseRing.position.set(0, 0.068, -0.3);
      group.add(pulseRing);
    }

    // Double-layer red breathing outer ring for pending stations (待拍板强无字视觉反差)
    let pendingOuterRing = null;
    let pendingOuterRingMat = null;
    if (act.isPending) {
      pendingOuterRingMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: light ? 0.7 : 0.65,
        blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
        toneMapped: false,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      pendingOuterRing = new THREE.Mesh(geo("ws-pending-outer-ring", () => {
        const g = new THREE.RingGeometry(1.88, 2.04, 72);
        g.rotateX(-Math.PI / 2);
        return g;
      }), pendingOuterRingMat);
      pendingOuterRing.position.set(0, 0.071, -0.3);
      group.add(pendingOuterRing);
    }

    if (act.intensityTier >= 2) {
      const hazardMat = new THREE.MeshBasicMaterial({
        map: tex.hazard,
        transparent: true,
        opacity: light ? 0.92 : 0.88,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      });
      const hazardRing = new THREE.Mesh(geo("ws-hazard-ring", () => {
        const g = new THREE.RingGeometry(1.78, 1.98, 72);
        g.rotateX(-Math.PI / 2);
        return g;
      }), hazardMat);
      hazardRing.position.set(0, 0.062, -0.3);
      group.add(hazardRing);
    }

    if (act.intensityTier >= 2 || act.isPending) {
      const cone1 = buildSafetyCone(act.isPending);
      cone1.position.set(-1.46, 0, 1.22);
      const cone2 = buildSafetyCone(act.isPending);
      cone2.position.set(-1.46, 0, -1.52);
      group.add(cone1, cone2);
    }

    group.add(buildLandmark(ws.landmark, act.isWorking, wsAnims));

    // Department-specific station rig (code lab / film studio / broadcast desk / workshop)
    const rig = buildStationRig(ws, act, light, pal);
    group.add(rig.group);

    let screenGlow = null;
    if (act.isWorking || act.isPending) {
      screenGlow = glowSprite(act.isPending ? 0xef4444 : powerHex, 2.4, 0.34);
      screenGlow.position.set(0, 1.1, -0.05);
      group.add(screenGlow);
    }

    // Bots
    const bots = [];
    const mainBot = buildBot(ws.primaryProvider, {
      scale: act.isResting ? 0.75 : 1,
      working: act.isWorking,
      headband: act.intensityTier >= 2,
      overdrive: act.intensityTier >= 3,
      pose: act.isResting ? "lying" : "seat",
    });
    let moonSprite = null;
    if (act.isResting) {
      // Idle: the desk is empty, the bot naps on a lounge couch under a moon
      const couch = buildCouch(light);
      couch.position.set(1.05, 0, 1.0);
      couch.rotation.y = Math.PI / 4;
      mainBot.rotation.set(0, 0, Math.PI / 2);
      mainBot.position.set(0.4, 0.61, 0.02);
      couch.add(mainBot);
      const blanket = mesh(slabGeo(0.62, 0.5, 0.06, 0.1, 0.03), phys(light ? 0xfde68a : 0xa16207, { rough: 0.9 }));
      blanket.position.set(0.18, 0.78, 0.02);
      couch.add(blanket);
      group.add(couch);

      const moonMat = new THREE.SpriteMaterial({
        map: tex.moon,
        transparent: true,
        opacity: light ? 0.95 : 0.92,
        depthWrite: false,
        toneMapped: false,
      });
      moonSprite = new THREE.Sprite(moonMat);
      moonSprite.scale.set(0.95, 0.95, 1);
      moonSprite.position.set(1.3, 2.2, 0.75);
      moonSprite.renderOrder = 8;
      group.add(moonSprite);
    } else {
      mainBot.position.set(0, 0.02, 0.92);
      mainBot.rotation.y = Math.PI;
      group.add(mainBot);
    }
    bots.push(mainBot);
    (act.isResting ? [] : ws.cloneProviders).forEach((prov, cIdx) => {
      const cloneWorking = ws.liveCount > cIdx + 1;
      const clone = buildBot(prov, {
        scale: 0.8,
        working: cloneWorking,
        headband: cloneWorking && act.intensityTier >= 2,
        overdrive: cloneWorking && act.intensityTier >= 3,
      });
      clone.position.set(cIdx === 0 ? -1.0 : 1.0, cloneWorking ? 0.02 : -0.02, cloneWorking ? 1.0 : 0.9);
      clone.rotation.y = Math.PI + (cIdx === 0 ? -0.4 : 0.4);
      group.add(clone);
      bots.push(clone);
    });

    // Code sparks (store initial x0 to avoid cumulative drift)
    const sparks = [];
    if (act.isWorking) {
      for (let s = 0; s < 6; s += 1) {
        const sp = light
          ? (() => {
              const sm = new THREE.SpriteMaterial({
                map: tex.glow,
                color: s % 2 ? 0x059669 : 0x0284c7,
                transparent: true,
                opacity: 0.85,
                blending: THREE.NormalBlending,
                depthWrite: false,
                toneMapped: false,
              });
              const sprite = new THREE.Sprite(sm);
              sprite.scale.set(0.24, 0.24, 1);
              sprite.renderOrder = 6;
              sprite.userData.baseOpacity = 0.85;
              return sprite;
            })()
          : glowSprite(s % 2 ? pal.emissive : 0x7dd3fc, 0.22, 0.9);
        const x0 = (Math.random() - 0.5) * 0.9;
        sp.position.set(x0, 1.1, 0.1);
        sp.userData.x0 = x0;
        sp.userData.seed = Math.random();
        group.add(sp);
        sparks.push(sp);
      }
    }

    // Tier 2 lightweight single-layer orange floor aura; Tier 3 dual-layer Super-Saiyan aura + sparks
    let auraGroup = null;
    const auraSparks = [];
    if (act.intensityTier === 2) {
      auraGroup = new THREE.Group();
      auraGroup.position.set(0, 0.05, 0.92);
      const midAuraMat = new THREE.MeshBasicMaterial({
        map: tex.aura,
        color: 0xf59e0b,
        transparent: true,
        opacity: light ? 0.42 : 0.52,
        blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      });
      const midAura = new THREE.Mesh(cylGeo(0.46, 0.72, 1.45, 20, true), midAuraMat);
      midAura.position.y = 0.75;
      midAura.userData.op0 = midAuraMat.opacity;
      const footRingMat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: light ? 0.55 : 0.62,
        blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      });
      const footRing = new THREE.Mesh(geo("ws-tier2-foot", () => {
        const g = new THREE.RingGeometry(0.64, 0.84, 36);
        g.rotateX(-Math.PI / 2);
        return g;
      }), footRingMat);
      footRing.position.y = 0.04;
      footRing.userData.op0 = footRingMat.opacity;
      auraGroup.add(midAura, footRing);
      group.add(auraGroup);
    } else if (act.intensityTier >= 3) {
      auraGroup = new THREE.Group();
      auraGroup.position.set(0, 0.05, 0.92);
      const outerAuraMat = new THREE.MeshBasicMaterial({
        map: tex.aura,
        color: 0xf59e0b,
        transparent: true,
        opacity: light ? 0.62 : 0.75,
        blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      });
      const outerAura = new THREE.Mesh(cylGeo(0.58, 0.88, 2.25, 24, true), outerAuraMat);
      outerAura.position.y = 1.15;
      outerAura.userData.op0 = outerAuraMat.opacity;

      const innerAuraMat = new THREE.MeshBasicMaterial({
        map: tex.aura,
        color: 0xfde047,
        transparent: true,
        opacity: light ? 0.45 : 0.55,
        blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        toneMapped: false,
      });
      const innerAura = new THREE.Mesh(cylGeo(0.38, 0.62, 1.95, 24, true), innerAuraMat);
      innerAura.position.y = 1.0;
      innerAura.userData.op0 = innerAuraMat.opacity;
      auraGroup.add(outerAura, innerAura);
      group.add(auraGroup);

      for (let i = 0; i < 8; i += 1) {
        const aspMat = new THREE.SpriteMaterial({
          map: tex.glow,
          color: i % 2 ? 0xf59e0b : 0xfde047,
          transparent: true,
          opacity: 0.9,
          blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        });
        const asp = new THREE.Sprite(aspMat);
        asp.scale.set(0.26, 0.26, 1);
        asp.renderOrder = 7;
        asp.userData.seed = i / 8;
        asp.userData.angle = (i / 8) * Math.PI * 2;
        group.add(asp);
        auraSparks.push(asp);
      }
    }

    // Resting zZz sleep bubble chain (3 staggered rising bubbles)
    const sleepSprites = [];
    if (act.isResting) {
      for (let i = 0; i < 3; i += 1) {
        const sleepMat = new THREE.SpriteMaterial({
          map: tex.zzz,
          transparent: true,
          opacity: light ? 0.85 : 0.78,
          depthWrite: false,
          toneMapped: false,
        });
        const sp = new THREE.Sprite(sleepMat);
        sp.scale.set(0.5, 0.5, 1);
        sp.position.set(0.8, 1.0, 1.25);
        sp.renderOrder = 8;
        sp.userData.phaseOffset = i / 3;
        group.add(sp);
        sleepSprites.push(sp);
      }
    }

    // Harvest coin
    let coin = null;
    if (ws.readyToHarvest) {
      coin = new THREE.Group();
      coin.position.set(0.95, 2.45, -1.2);
      const disc = mesh(cylGeo(0.34, 0.34, 0.09, 40), phys(0xfbbf24, { rough: 0.2, metal: 1, emissive: 0x7c4a03, ei: 0.45 }));
      disc.rotation.x = Math.PI / 2;
      const emb = mesh(cylGeo(0.22, 0.22, 0.1, 40), phys(0xf59e0b, { rough: 0.32, metal: 1 }));
      emb.rotation.x = Math.PI / 2;
      coin.add(disc, emb, glowSprite(0xfbbf24, 1.4, 0.55));
      group.add(coin);
    }

    // Pending alert
    let alert = null;
    if (ws.pendingCount > 0) {
      alert = new THREE.Group();
      alert.position.set(-0.95, 2.55, -1.2);
      const aMat = phys(0xef4444, { rough: 0.3, clear: 1, emissive: 0xdc2626, ei: 0.85 });
      const bar = mesh(capsuleGeo(0.075, 0.24), aMat);
      bar.position.y = 0.14;
      const dot = mesh(sphereGeo(0.085, 14, 10), aMat);
      dot.position.y = -0.22;
      alert.add(bar, dot, glowSprite(0xef4444, 1.2, 0.55));
      group.add(alert);
    }

    // Search beam (toggled via interaction state)
    const beamMat = new THREE.MeshBasicMaterial({
      map: tex.beam,
      color: 0x38bdf8,
      transparent: true,
      opacity: light ? 0.4 : 0.55,
      blending: light ? THREE.NormalBlending : THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const beam = new THREE.Mesh(cylGeo(0.7, 1.25, 8, 32, true), beamMat);
    beam.position.set(0, 4, -0.4);
    beam.visible = false;
    group.add(beam);

    // Overhead nameplate
    const labelEl = document.createElement("button");
    labelEl.type = "button";
    labelEl.className = [
      "tycoon3d-tag",
      ws.isClusterHub ? "is-cluster-hub" : "",
      act.isWorking ? "is-live" : "",
      act.intensityTier === 2 ? "is-tier-2" : "",
      act.intensityTier >= 3 ? "is-tier-3" : "",
      act.isResting ? "is-resting" : "",
      act.isPending ? "is-pending" : "",
      act.showHarvest ? "is-harvest" : "",
    ].filter(Boolean).join(" ");
    labelEl.dataset.tycoonTopic = ws.topicId;
    // Desync per-tag animations so idle panels drift like clouds instead of pulsing in unison
    {
      const rnd = (a, b) => (a + Math.random() * (b - a)).toFixed(2);
      labelEl.style.setProperty("--ty-delay", `-${rnd(0, 9)}s`);
      labelEl.style.setProperty("--ty-float-dur", `${rnd(7, 11)}s`);
      labelEl.style.setProperty("--ty-amp", `${rnd(1.1, 2)}px`);
      const baseGlow = act.isPending ? 2.2 : (act.intensityTier >= 3 ? 2.3 : (act.intensityTier === 2 ? 2.6 : 3));
      labelEl.style.setProperty("--ty-glow-dur", `${(baseGlow + Math.random() * 0.6).toFixed(2)}s`);
    }
    const signalBadge = selectAssistantSignalBadge(ws, assistantLocale());
    labelEl.innerHTML = renderWorkstationTagHtml(ws, act, { signalBadge });
    const signalEl = labelEl.querySelector(".tycoon-signal-badge");
    const selectSignal = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      if (ws.isClusterHub && typeof onSelectCluster === "function") {
        onSelectCluster(ws.roomId, ws.memberTopicIds || []);
      } else {
        onSignalBadgeClick?.(ws.signalTopicId || ws.topicId, signalBadge.type);
      }
    };
    signalEl?.addEventListener("click", selectSignal);
    signalEl?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") selectSignal(ev);
    });
    labelEl.addEventListener("click", (ev) => {
      ev.stopPropagation();
      panToPosition(ws.x, ws.z, 1.42);
      spawnRipple(ws.x, ws.z - 0.3, 0x38bdf8);
      if (ws.isClusterHub) {
        if (typeof onSelectCluster === "function") onSelectCluster(ws.roomId, ws.memberTopicIds || []);
        else onSelectRoom?.(ws.roomId);
      } else {
        onSelectTopic?.(ws.topicId, ws.roomId);
      }
    });
    labelEl.addEventListener("mouseenter", () => { labelHoverKey = ws.topicId; });
    labelEl.addEventListener("mouseleave", () => { if (labelHoverKey === ws.topicId) labelHoverKey = ""; });
    labelsWrap.appendChild(labelEl);

    // SVG leader line & anchor dot for zero-overlap collision displacement
    const leaderColor = act.isPending
      ? "#ef4444"
      : (act.intensityTier >= 3 ? "#fb923c" : (act.intensityTier === 2 ? "#f59e0b" : (act.isWorking ? "#34d399" : "#94a3b8")));
    const leaderLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
    leaderLine.setAttribute("class", "tycoon3d-leader-line");
    leaderLine.setAttribute("stroke", leaderColor);
    leaderLine.style.display = "none";
    const leaderDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    leaderDot.setAttribute("class", "tycoon3d-leader-dot");
    leaderDot.setAttribute("r", "2.6");
    leaderDot.setAttribute("fill", leaderColor);
    leaderDot.style.display = "none";
    leaderSvg.appendChild(leaderLine);
    leaderSvg.appendChild(leaderDot);

    dynamicGroup.add(group);

    const isNew = !seenTopicIds.has(ws.topicId);
    seenTopicIds.add(ws.topicId);
    let spawnAt = -1e9;
    if (!firstBuildDone) spawnAt = now + 380 + idx * 70;
    else if (isNew && !isHotUpdate) spawnAt = now;

    const anchorLift = (ws.readyToHarvest || ws.pendingCount > 0) ? 2.88 : 2.62;
    const rec = {
      ws,
      namePx: measureTagNamePx(ws.name),
      act,
      idx,
      group,
      hitMesh: hit,
      anims: wsAnims,
      ring,
      ringMat,
      pulseRing,
      pulseRingMat,
      pendingOuterRing,
      pendingOuterRingMat,
      statusHex,
      beam,
      bots,
      sparks,
      sleepSprites,
      moonSprite,
      rigAnim: rig.anim,
      pool,
      poolMat,
      poolBase,
      pillar,
      pillarMat,
      pillarBase,
      auraGroup,
      auraSparks,
      coin,
      alert,
      screenGlow,
      labelEl,
      leaderLine,
      leaderDot,
      leaderColor,
      anchor: new THREE.Vector3(ws.x, PLAT_TOP + anchorLift, ws.z - 1.1),
      spawnAt,
      introAlpha: spawnAt < 0 ? 1 : 0,
      hover: 0,
      bounceStart: -100,
      approvalFlashStart: -100,
      isSelected: false,
      isSearchHit: false,
      _lodMode: "",
      _offX: 0,
      _offY: 0,
    };
    wsRecords.set(ws.topicId, rec);
    return rec;
  }

  function disposeWorkstation(topicId) {
    const rec = wsRecords.get(topicId);
    if (!rec) return;
    if (rec.hitMesh) {
      const i = interactiveMeshes.indexOf(rec.hitMesh);
      if (i >= 0) interactiveMeshes.splice(i, 1);
    }
    rec.anims.length = 0;
    if (labelHoverKey === topicId) labelHoverKey = "";
    if (hoveredKey === topicId) hoveredKey = "";
    rec.labelEl?.remove?.();
    rec.leaderLine?.remove?.();
    rec.leaderDot?.remove?.();
    if (rec.group) {
      disposeTree(rec.group);
      dynamicGroup?.remove(rec.group);
    }
    wsRecords.delete(topicId);
  }

  function buildEgg(egg, idx) {
    if (!eggGroup) return;
    const light = isLight();
    const hot = egg.freshnessTier === "hot";
    const tint = hot ? 0xfbbf24 : (egg.freshnessTier === "warm" ? 0x38bdf8 : 0xa78bfa);
    const g = new THREE.Group();
    g.position.set(egg.x, PLAT_TOP, egg.z);
    const base = mesh(cylGeo(0.56, 0.68, 0.2, 32), phys(light ? 0x94a3b8 : 0x1e293b, { rough: light ? 0.36 : 0.3, metal: 0.7, clear: light ? 0.3 : 0.7 }), { cast: true, receive: true });
    base.position.y = 0.1;
    const ring = mesh(torusGeo(0.57, 0.02, 6, 48), neon(tint), { cast: false });
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.2;
    const eggMat = new THREE.MeshPhysicalMaterial({
      color: hot ? 0xfef3c7 : 0xf8fafc,
      emissive: tint,
      emissiveIntensity: hot ? 0.55 : 0.25,
      roughness: 0.18,
      clearcoat: 1,
      iridescence: 0.6,
      iridescenceIOR: 1.3,
    });
    const eggMesh = mesh(sphereGeo(0.42, 32, 24), eggMat);
    eggMesh.scale.set(0.86, 1.22, 0.86);
    eggMesh.position.y = 0.78;
    eggMesh.userData = { kind: "incubator", eggId: egg.id };
    interactiveMeshes.push(eggMesh);
    eggHitMeshes.push(eggMesh);
    const cap = mesh(geo("egg-cap", () => new THREE.SphereGeometry(0.62, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)), glassMat(light ? tint : 0xffffff, light ? 0.16 : 0.12), { cast: false });
    cap.scale.set(1, 1.7, 1);
    cap.position.y = 0.2;
    const gl = glowSprite(tint, hot ? 1.8 : 1.2, hot ? 0.6 : 0.4);
    gl.position.y = 0.78;
    g.add(base, ring, eggMesh, cap, gl);
    eggGroup.add(g);
    const phase = idx * 1.1;
    eggAnimators.push((t) => {
      eggMesh.position.y = 0.78 + Math.sin(t * 2.2 + phase) * 0.07;
      eggMesh.rotation.y = t * 0.8 + phase;
      eggMat.emissiveIntensity = (hot ? 0.55 : 0.25) * (0.75 + 0.25 * Math.sin(t * 3 + phase));
      gl.position.y = eggMesh.position.y;
      if (hot) eggMesh.rotation.z = Math.sin(t * 9 + phase) * 0.04 * Math.max(0, Math.sin(t * 0.8 + phase));
    });
  }

  function rebuildEggs(eggs = []) {
    if (!dynamicGroup) return;
    if (!eggGroup) {
      eggGroup = new THREE.Group();
      dynamicGroup.add(eggGroup);
    }
    for (const m of eggHitMeshes) {
      const i = interactiveMeshes.indexOf(m);
      if (i >= 0) interactiveMeshes.splice(i, 1);
    }
    eggHitMeshes.length = 0;
    eggAnimators.length = 0;
    disposeTree(eggGroup);
    eggs.forEach((egg, idx) => buildEgg(egg, idx));
  }

  // ------------------------------------------------------------ fx
  function spawnRipple(x, z, color = 0x38bdf8, { size = 2.4, dur = 0.9, peak = 0.8, delay = 0 } = {}) {
    if (!THREE || !fxGroup) return;
    const m = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0,
      toneMapped: false,
      depthWrite: false,
      blending: isLight() ? THREE.NormalBlending : THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const r = new THREE.Mesh(geo("ripple", () => {
      const g = new THREE.RingGeometry(0.85, 1, 64);
      g.rotateX(-Math.PI / 2);
      return g;
    }), m);
    r.position.set(x, PLAT_TOP + 0.08, z);
    r.scale.setScalar(0.2);
    r.visible = delay <= 0;
    fxGroup.add(r);
    ripples.push({ mesh: r, t: -delay, dur, size, peak });
  }

  function spawnEnergyPacket(
    targetX,
    targetZ,
    colorHex = 0x38bdf8,
    speed = 0.9,
    { side = 0, arc = 2.8, delay = 0, burstImpact = false, isLead = false, targetTopicId = "" } = {},
  ) {
    if (!THREE || !fxGroup) return;
    const group = new THREE.Group();
    const core = new THREE.Mesh(sphereGeo(0.13, 12, 10), neon(0xffffff));
    const halo = glowSprite(colorHex, 1.05, 0.9);
    group.add(core, halo);
    group.visible = delay <= 0;
    const trail = [];
    for (let i = 0; i < 8; i += 1) {
      const s = glowSprite(colorHex, 0.56 - i * 0.055, 0.52 - i * 0.055);
      s.visible = false;
      fxGroup.add(s);
      trail.push(s);
    }
    const fx = 0;
    const fy = 1.9;
    const fz = 0;
    group.position.set(fx, fy, fz);
    fxGroup.add(group);
    packets.push({
      group,
      trail,
      history: [],
      fx,
      fy,
      fz,
      tx: targetX,
      tz: targetZ,
      t: 0,
      delay,
      speed,
      side,
      arc,
      burstImpact,
      isLead,
      targetTopicId,
      color: colorHex,
    });
  }

  // -------------------------------------------------------- world build
  function wsSignature(w) {
    return JSON.stringify([
      w.topicId, w.name, w.x, w.z, w.stageIndex, w.readyToHarvest, w.liveCount, w.pendingCount,
      w.activeCount > 0, w.landmark, w.primaryProvider, w.cloneProviders,
      w.isClusterHub, w.memberCount, w.subProjectCount,
      Boolean(w.assistantSignals), w.signalTopicId || "",
      w.isClusterHub ? (w.memberTopicIds || []) : null,
      selectAssistantSignalBadge(w, assistantLocale()),
    ]);
  }

  function triggerApprovalSuccess(rec, ws) {
    if (!rec) return;
    rec.bounceStart = currentAnimTime;
    rec.approvalFlashStart = currentAnimTime;
    const ix = ws.x;
    const iz = ws.z - 0.3;
    spawnRipple(ix, iz, 0x7af0ff, { size: 7.2, dur: 1.25, peak: 0.95 });
    spawnRipple(ix, iz, 0xffc857, { size: 5.0, dur: 1.4, peak: 0.85, delay: 0.08 });
    spawnRipple(ix, iz, 0x3ddc97, { size: 3.2, dur: 1.15, peak: 0.75, delay: 0.18 });
    if (gridMat) {
      gridMat.uniforms.uImp.value = currentAnimTime;
      gridMat.uniforms.uImpC.value.set(ix, iz);
    }
  }

  function rebuildDynamicWorld() {
    if (!THREE || !dynamicGroup || !lastOverview) return;
    spriteRecord?.group.userData.textures?.forEach((texture) => texture.dispose());
    disposeTree(dynamicGroup);
    interactiveMeshes.length = 0;
    animators.length = 0;
    eggAnimators.length = 0;
    eggHitMeshes.length = 0;
    wsRecords.clear();
    roomRecords.clear();
    eggGroup = null;
    labelsWrap.innerHTML = "";
    leaderSvg.innerHTML = "";
    labelsWrap.appendChild(leaderSvg);
    labelHoverKey = "";
    lastWsSigs.clear();

    const layout = buildTycoonWorldLayout(lastOverview, {});
    const now = performance.now();
    buildNexus();
    layout.rooms.forEach((rm, idx) => buildRoom(rm, idx, now));
    layout.workstations.forEach((ws, idx) => {
      buildWorkstation(ws, idx, now);
      lastWsSigs.set(ws.topicId, wsSignature(ws));
    });
    rebuildEggs(layout.eggs);

    lastThemeSig = currentTheme;
    lastRoomsStructSig = JSON.stringify(layout.rooms.map((r) => r.id));
    lastEggsSig = JSON.stringify(layout.eggs.map((e) => [e.id, e.freshnessTier]));
    firstBuildDone = true;

    updateCameraTransform();
    updateProjectedLabels();
  }

  function syncDynamicWorldIncremental() {
    if (!THREE || !dynamicGroup || !lastOverview) return;
    const layout = buildTycoonWorldLayout(lastOverview, {});
    const roomsStructSig = JSON.stringify(layout.rooms.map((r) => r.id));
    const eggsSig = JSON.stringify(layout.eggs.map((e) => [e.id, e.freshnessTier]));

    if (!firstBuildDone || currentTheme !== lastThemeSig || roomsStructSig !== lastRoomsStructSig) {
      rebuildDynamicWorld();
      return;
    }

    // Update room conduit flow intensity & topic count badges in-place without rebuilding workstations
    for (const rm of layout.rooms) {
      const rr = roomRecords.get(rm.id);
      if (rr) {
        rr.rm = rm;
        if (rr.flowMat) rr.flowMat.opacity = rm.liveCount > 0 ? 1 : 0.45;
        const nextBannerHtml = formatRoomBannerHtml(rm);
        if (rr.banner && rr.banner.innerHTML !== nextBannerHtml) {
          rr.banner.innerHTML = nextBannerHtml;
        }
      }
    }

    if (eggsSig !== lastEggsSig) {
      lastEggsSig = eggsSig;
      rebuildEggs(layout.eggs);
    }

    const nextIds = new Set(layout.workstations.map((w) => w.topicId));
    for (const oldId of Array.from(wsRecords.keys())) {
      if (!nextIds.has(oldId)) {
        disposeWorkstation(oldId);
        lastWsSigs.delete(oldId);
      }
    }

    const now = performance.now();
    let changed = false;
    layout.workstations.forEach((ws, idx) => {
      const sig = wsSignature(ws);
      const prevSig = lastWsSigs.get(ws.topicId);
      if (sig === prevSig && wsRecords.has(ws.topicId)) {
        const rec = wsRecords.get(ws.topicId);
        rec.ws = ws;
        rec.idx = idx;
        return;
      }
      changed = true;
      const prevRec = wsRecords.get(ws.topicId);
      const prevState = prevRec
        ? {
            isPending: Boolean(prevRec.act?.isPending),
            isWorking: Boolean(prevRec.act?.isWorking),
            readyToHarvest: Boolean(prevRec.ws?.readyToHarvest),
          }
        : null;
      disposeWorkstation(ws.topicId);
      const nextRec = buildWorkstation(ws, idx, now, { isHotUpdate: Boolean(prevRec) });
      lastWsSigs.set(ws.topicId, sig);

      if (prevState?.isPending && nextRec.act.isWorking && !nextRec.act.isPending) {
        triggerApprovalSuccess(nextRec, ws);
      } else if (prevState && !prevState.readyToHarvest && ws.readyToHarvest) {
        nextRec.bounceStart = currentAnimTime;
        spawnRipple(ws.x, ws.z - 0.3, 0xfbbf24, { size: 3.6, dur: 1.0, peak: 0.85 });
      }
    });

    if (changed) {
      updateProjectedLabels();
    }
  }

  function applyInteractionState() {
    if (!lastOverview) return;
    const layout = buildTycoonWorldLayout(lastOverview, {
      searchText: lastUiState.searchText || "",
      selectedTopicId: lastUiState.selectedTopicId || "",
      selectedRoomId: lastUiState.domainFilter || "all",
      selectedClusterRoomId: lastUiState.selectedClusterRoomId || "",
    });
    for (const ws of layout.workstations) {
      const rec = wsRecords.get(ws.topicId);
      if (!rec) continue;
      rec.isSelected = ws.isSelected;
      rec.isSearchHit = ws.isSearchHit;
      rec.beam.visible = ws.isSearchHit;
      rec.labelEl.classList.toggle("is-selected", ws.isSelected);
      rec.labelEl.classList.toggle("is-search-hit", ws.isSearchHit);
    }
    for (const rm of layout.rooms) {
      const rr = roomRecords.get(rm.id);
      if (!rr) continue;
      rr.isSelected = rm.isSelected;
      rr.banner.classList.toggle("is-selected", rm.isSelected);
    }
  }

  // --------------------------------------------------------------- camera
  function abortChase() {
    chaseState.active = false;
    impactShakeAt = -100;
  }

  function panToPosition(x, z, zoom = null) {
    abortChase();
    panVelocity.x = 0;
    panVelocity.z = 0;
    camGoal.x = Math.max(-24, Math.min(24, Number(x) || 0));
    camGoal.z = Math.max(-17, Math.min(17, Number(z) || 0));
    if (Number.isFinite(zoom) && zoom > 0) {
      camGoal.zoom = Math.max(0.62, Math.min(2.35, zoom));
    }
  }

  function resetCamera() {
    abortChase();
    panVelocity.x = 0;
    panVelocity.z = 0;
    camGoal.x = 0.5;
    camGoal.z = 0.4;
    camGoal.zoom = 0.92;
  }

  function updateCameraTransform(t = currentAnimTime, idleBreathing = false) {
    if (!orthoCam || !perspCam) return;
    if (perspBlend <= 0.001) {
      camera = orthoCam;
      orthoCam.position.set(camCurr.x + ISO_OFFSET.x, ISO_OFFSET.y, camCurr.z + ISO_OFFSET.z);
      orthoCam.lookAt(camCurr.x, 0, camCurr.z);
      if (Math.abs(orthoCam.zoom - camCurr.zoom) > 0.0005) {
        orthoCam.zoom = camCurr.zoom;
        orthoCam.updateProjectionMatrix();
      }
      orthoCam.updateMatrixWorld();
    } else {
      camera = perspCam;
      const pose = computePerspectiveRigPose({
        x: camCurr.x,
        z: camCurr.z,
        zoom: camCurr.zoom,
        blend: perspBlend,
        baseHalfH: BASE_FRUSTUM_HALF_H,
      });
      if (Math.abs(perspCam.fov - pose.fov) > 0.01) {
        perspCam.fov = pose.fov;
        perspCam.updateProjectionMatrix();
      }
      perspCam.position.set(pose.pos[0], pose.pos[1], pose.pos[2]);
      if (idleBreathing && perspBlend > 0.5 && !isUserDragging) {
        perspCam.position.y += Math.sin(t * 0.9) * 0.035;
      }
      perspCam.lookAt(pose.look[0], pose.look[1], pose.look[2]);
      perspCam.updateMatrixWorld();
    }

    const ds = t - impactShakeAt;
    if (ds >= 0 && ds < 0.42) {
      const amp = 0.09 * Math.exp(-8 * ds);
      camera.position.x += Math.sin(t * 73) * amp;
      camera.position.y += Math.sin(t * 91) * amp * 0.6;
      camera.position.z += Math.sin(t * 59) * amp;
      camera.updateMatrixWorld();
    }
  }

  function measureViewportSize() {
    const rect = containerEl.getBoundingClientRect();
    const w = rect.width || canvasWrap.clientWidth || window.innerWidth || 1024;
    const h = rect.height || canvasWrap.clientHeight || window.innerHeight || 680;
    cachedViewport = { w: Math.max(300, w), h: Math.max(280, h) };
    return cachedViewport;
  }

  function getViewportSize() {
    return cachedViewport;
  }

  const projVec = { v: null, white: null, teal: null };
  function updateProjectedLabels(dt = 0.016) {
    if (!camera || !THREE) return;
    const { w: width, h: height } = cachedViewport;
    if (!projVec.v) projVec.v = new THREE.Vector3();
    const proj = projVec.v;
    const zoom = camCurr.zoom;

    const projectPoint = (worldAnchor, lift = 0) => {
      proj.copy(worldAnchor);
      proj.y += lift;
      proj.project(camera);
      const front = proj.z > -1 && proj.z < 1;
      const ax = Math.round(((proj.x * 0.5 + 0.5) * width) * 2) / 2;
      const ay = Math.round(((-proj.y * 0.5 + 0.5) * height) * 2) / 2;
      const visible = front && ax > -140 && ax < width + 140 && ay > -80 && ay < height + 90;
      return { ax, ay, visible };
    };

    const items = [];
    const metaById = new Map();

    const compactViewport = width < 780;
    const showRoomBanners = shouldShowRoomBanner({
      viewportWidth: width,
      zoom,
      selectedRoomId: lastUiState.domainFilter || "all",
    });

    for (const rec of wsRecords.values()) {
      const isHovered = hoveredKey === rec.ws.topicId || labelHoverKey === rec.ws.topicId;
      const lodMode = resolveWorkstationLodMode({
        zoom,
        isPending: rec.act.isPending,
        isSelected: rec.isSelected,
        isSearchHit: rec.isSearchHit,
        isHovered,
        isResting: rec.act.isResting,
        compactViewport,
      });
      if (rec._lodMode !== lodMode) {
        rec._lodMode = lodMode;
        rec.labelEl.classList.toggle("is-lod-micro", lodMode === "micro");
        rec.labelEl.classList.toggle("is-lod-mid", lodMode === "mid");
      }

      const { ax, ay, visible } = projectPoint(rec.anchor, rec.hover * 0.14);
      const badge = selectAssistantSignalBadge(rec.ws, assistantLocale());
      const { w: estW, h: estH } = estimateWorkstationLabelSize(rec.ws, rec.act, {
        lodMode,
        badge,
        namePx: rec.namePx,
      });
      let priority = 10;
      if (rec.isSelected || rec.isSearchHit) priority = 100;
      else if (rec.act.isPending) priority = 82;
      else if (rec.act.intensityTier >= 3) priority = 62;
      else if (rec.act.isWorking) priority = 46;
      if (isHovered) priority += 20;

      const id = `ws:${rec.ws.topicId}`;
      items.push({ id, ax, ay, w: estW, h: estH, priority, visible: visible && rec.introAlpha > 0.02 });
      metaById.set(id, { kind: "ws", rec, ax, ay, visible, alpha: rec.introAlpha });
    }

    for (const rr of roomRecords.values()) {
      const { ax, ay, visible } = projectPoint(rr.anchor, rr.group.position.y);
      const id = `rm:${rr.rm.id}`;
      const roomVisible = showRoomBanners && visible && rr.introAlpha > 0.02;
      items.push({
        id,
        ax,
        ay,
        w: 88,
        h: 22,
        priority: rr.isSelected ? 70 : 25,
        visible: roomVisible,
      });
      metaById.set(id, { kind: "rm", rr, ax, ay, visible: roomVisible, alpha: rr.introAlpha });
    }

    if (spriteRecord?.labelEl) {
      const { ax, ay, visible } = projectPoint(spriteRecord.anchor, 0);
      // Reserve the butler's silhouette as well as its speech label. In narrow
      // views a building card must not cover its face; use the same solver.
      const feet = projectPoint(spriteRecord.group.position, 0);
      items.push({ id: "sp:body", ax: feet.ax, ay: feet.ay + 8,
        w: Math.max(64, 110 * zoom), h: Math.max(80, feet.ay - ay + 8), priority: 110, visible });
      const id = "sp:sprite";
      items.push({ id, ax, ay, w: spriteRecord.labelEl.offsetWidth || 102, h: spriteRecord.labelEl.offsetHeight || 24, priority: 36, visible });
      metaById.set(id, { kind: "sp", spriteRecord, ax, ay, visible, alpha: 1 });
    }

    const layoutMap = resolveLabelCollisionLayout(items, cachedViewport);
    const offLerp = Math.min(1, dt * 16);

    for (const [id, meta] of metaById.entries()) {
      const solved = layoutMap.get(id);
      if (meta.kind === "ws") {
        const { rec, ax, ay, visible, alpha } = meta;
        const a = visible ? Math.round(alpha * 100) / 100 : 0;
        if (rec.labelEl._tyLastA !== a) {
          rec.labelEl._tyLastA = a;
          rec.labelEl.style.opacity = a >= 1 ? "" : String(a);
          rec.labelEl.style.visibility = a > 0.02 ? "" : "hidden";
          rec.labelEl.style.pointerEvents = a > 0.5 ? "auto" : "none";
        }
        if (a > 0 && solved) {
          rec._offX += (solved.offX - rec._offX) * offLerp;
          rec._offY += (solved.offY - rec._offY) * offLerp;
          const fx = Math.round((ax + rec._offX) * 2) / 2;
          const fy = Math.round((ay + rec._offY) * 2) / 2;
          if (rec.labelEl._tyLastX !== fx || rec.labelEl._tyLastY !== fy) {
            rec.labelEl._tyLastX = fx;
            rec.labelEl._tyLastY = fy;
            rec.labelEl.style.transform = `translate3d(${fx}px, ${fy}px, 0) translate(-50%, -100%)`;
          }
          const disp = Math.hypot(fx - ax, fy - ay);
          if (disp > 10 && a > 0.25) {
            rec.leaderLine.setAttribute("x1", String(fx));
            rec.leaderLine.setAttribute("y1", String(fy));
            rec.leaderLine.setAttribute("x2", String(ax));
            rec.leaderLine.setAttribute("y2", String(ay));
            rec.leaderDot.setAttribute("cx", String(ax));
            rec.leaderDot.setAttribute("cy", String(ay));
            rec.leaderLine.style.display = "";
            rec.leaderDot.style.display = "";
          } else {
            rec.leaderLine.style.display = "none";
            rec.leaderDot.style.display = "none";
          }
        } else {
          rec.leaderLine.style.display = "none";
          rec.leaderDot.style.display = "none";
        }
      } else if (meta.kind === "rm") {
        const { rr, ax, ay, visible, alpha } = meta;
        const a = visible ? Math.round(alpha * 100) / 100 : 0;
        if (rr.banner._tyLastA !== a) {
          rr.banner._tyLastA = a;
          rr.banner.style.opacity = a >= 1 ? "" : String(a);
          rr.banner.style.visibility = a > 0.02 ? "" : "hidden";
          rr.banner.style.pointerEvents = a > 0.5 ? "auto" : "none";
        }
        if (a > 0 && solved) {
          const fx = Math.round(solved.x * 2) / 2;
          const fy = Math.round(solved.y * 2) / 2;
          if (rr.banner._tyLastX !== fx || rr.banner._tyLastY !== fy) {
            rr.banner._tyLastX = fx;
            rr.banner._tyLastY = fy;
            rr.banner.style.transform = `translate3d(${fx}px, ${fy}px, 0) translate(-50%, -100%)`;
          }
        }
      } else if (meta.kind === "sp") {
        const { spriteRecord: spRec, ax, ay, visible, alpha } = meta;
        const a = visible ? Math.round(alpha * 100) / 100 : 0;
        if (spRec.labelEl._tyLastA !== a) {
          spRec.labelEl._tyLastA = a;
          spRec.labelEl.style.opacity = a >= 1 ? "" : String(a);
          spRec.labelEl.style.visibility = a > 0.02 ? "" : "hidden";
          spRec.labelEl.style.pointerEvents = a > 0.5 ? "auto" : "none";
        }
        if (a > 0 && solved) {
          const fx = Math.round(solved.x * 2) / 2;
          const fy = Math.round(solved.y * 2) / 2;
          if (spRec.labelEl._tyLastX !== fx || spRec.labelEl._tyLastY !== fy) {
            spRec.labelEl._tyLastX = fx;
            spRec.labelEl._tyLastY = fy;
            spRec.labelEl.style.transform = `translate3d(${fx}px, ${fy}px, 0) translate(-50%, -100%)`;
          }
        }
      }
    }
  }

  // ------------------------------------------------------------- post-processing
  function syncPostThemeUniforms() {
    const { post } = resolveTycoonThemeTuning(currentTheme);
    if (brightMat) {
      brightMat.uniforms.uThr.value = post.bloomThr;
      brightMat.uniforms.uKnee.value = post.bloomKnee;
    }
    if (compMat) {
      compMat.uniforms.uExposure.value = post.exposure;
      compMat.uniforms.uBloom.value = visPrefs.bloom ? post.bloomStrength : 0.0;
      compMat.uniforms.uTs.value = visPrefs.tiltShift ? 0.82 : 0.0;
      compMat.uniforms.uVig.value = post.vignette;
    }
    const postActive = !isMobilePerf && (visPrefs.bloom || visPrefs.tiltShift);
    containerEl.classList.toggle("has-webgl-post", postActive);
    if (renderer && THREE) {
      renderer.toneMapping = postActive ? THREE.NoToneMapping : THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = post.exposure;
    }
  }

  function disposePostRT() {
    if (!postRT) return;
    Object.values(postRT).forEach((r) => r?.dispose?.());
    postRT = null;
    postW = 0;
    postH = 0;
  }

  function ensurePostResources(w, h) {
    if (isMobilePerf || !THREE || !renderer) return false;
    if (!postScene) {
      postScene = new THREE.Scene();
      postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      postQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
      postQuad.frustumCulled = false;
      postScene.add(postQuad);

      const mkShader = (frag, uniforms) => new THREE.ShaderMaterial({
        uniforms,
        vertexShader: FSQ_VERT,
        fragmentShader: frag,
        depthTest: false,
        depthWrite: false,
      });
      brightMat = mkShader(BRIGHT_FRAG, {
        tSrc: { value: null },
        uTexel: { value: new THREE.Vector2() },
        uThr: { value: 0.78 },
        uKnee: { value: 0.58 },
      });
      blurMat = mkShader(BLUR_FRAG, {
        tSrc: { value: null },
        uDir: { value: new THREE.Vector2() },
      });
      compMat = mkShader(COMPOSITE_FRAG, {
        tScene: { value: null },
        tTs1: { value: null },
        tTs2: { value: null },
        tB1: { value: null },
        tB2: { value: null },
        uExposure: { value: 1.15 },
        uBloom: { value: 0.8 },
        uFocusY: { value: 0.48 },
        uFocusHalf: { value: 0.22 },
        uTs: { value: 0.0 },
        uVig: { value: 0.42 },
        uGrain: { value: 0.006 },
        uFrame: { value: 0 },
        uAspect: { value: w / Math.max(1, h) },
      });
      syncPostThemeUniforms();
    }

    const dpr = renderer.getPixelRatio();
    const rw = Math.max(16, Math.round(w * dpr));
    const rh = Math.max(16, Math.round(h * dpr));
    const needTs = Boolean(visPrefs.tiltShift);

    const makeRt = (tw, th, extra = {}) => new THREE.WebGLRenderTarget(Math.max(1, tw), Math.max(1, th), {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      ...extra,
    });

    if (!postRT || postW !== rw || postH !== rh) {
      disposePostRT();
      postW = rw;
      postH = rh;
      const h4 = [rw >> 2, rh >> 2];
      const h8 = [rw >> 3, rh >> 3];
      postRT = {
        scene: makeRt(rw, rh, { depthBuffer: true }),
        bA1: makeRt(...h4),
        bB1: makeRt(...h4),
        bA2: makeRt(...h8),
        bB2: makeRt(...h8),
        tA0: null,
        tB0: null,
        tA1: null,
        tB1: null,
      };
    }

    if (needTs && !postRT.tA0) {
      const h2 = [rw >> 1, rh >> 1];
      const h4 = [rw >> 2, rh >> 2];
      postRT.tA0 = makeRt(...h2);
      postRT.tB0 = makeRt(...h2);
      postRT.tA1 = makeRt(...h4);
      postRT.tB1 = makeRt(...h4);
    }

    return true;
  }

  function postPass(mat, target) {
    postQuad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(postScene, postCam);
  }

  function postBlur(src, mid, dst, spread = 1.0) {
    blurMat.uniforms.tSrc.value = src.texture;
    blurMat.uniforms.uDir.value.set(spread / Math.max(1, mid.width), 0);
    postPass(blurMat, mid);
    blurMat.uniforms.tSrc.value = mid.texture;
    blurMat.uniforms.uDir.value.set(0, spread / Math.max(1, dst.height));
    postPass(blurMat, dst);
  }

  function renderFrameWithPost() {
    const usePost = !isMobilePerf && (visPrefs.bloom || visPrefs.tiltShift);
    if (!usePost) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }

    const { w, h } = cachedViewport;
    if (!ensurePostResources(w, h) || !postRT) {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
      return;
    }

    renderer.setRenderTarget(postRT.scene);
    renderer.clear();
    renderer.render(scene, camera);

    if (visPrefs.bloom) {
      brightMat.uniforms.tSrc.value = postRT.scene.texture;
      brightMat.uniforms.uTexel.value.set(2 / postW, 2 / postH);
      postPass(brightMat, postRT.bA1);
      postBlur(postRT.bA1, postRT.bB1, postRT.bA1, 1.0);
      postBlur(postRT.bA1, postRT.bB2, postRT.bA2, 1.0);
    }

    if (visPrefs.tiltShift && postRT.tA0 && postRT.tB0 && postRT.tA1 && postRT.tB1) {
      postBlur(postRT.scene, postRT.tA0, postRT.tB0, 1.0);
      postBlur(postRT.tB0, postRT.tA1, postRT.tB1, 1.0);
    }

    const cu = compMat.uniforms;
    cu.tScene.value = postRT.scene.texture;
    cu.tTs1.value = (visPrefs.tiltShift && postRT.tB0) ? postRT.tB0.texture : postRT.scene.texture;
    cu.tTs2.value = (visPrefs.tiltShift && postRT.tB1) ? postRT.tB1.texture : postRT.scene.texture;
    cu.tB1.value = visPrefs.bloom ? postRT.bA1.texture : postRT.scene.texture;
    cu.tB2.value = visPrefs.bloom ? postRT.bA2.texture : postRT.scene.texture;
    cu.uFrame.value = frameCounter;
    cu.uAspect.value = w / Math.max(1, h);
    postPass(compMat, null);
  }

  // ------------------------------------------------------------- frame
  function animateFrame(nowMs) {
    if (!running || disposed) return;
    rafId = requestAnimationFrame(animateFrame);
    if (!THREE || !renderer || !scene || !camera) return;
    if (isMobilePerf && lastRenderAt && (nowMs - lastRenderAt) < 31) return;
    lastRenderAt = nowMs;

    const dt = Math.min(0.05, lastFrameAt ? (nowMs - lastFrameAt) / 1000 : 0.016);
    lastFrameAt = nowMs;
    const t = nowMs * 0.001;
    currentAnimTime = t;
    frameCounter += 1;
    const light = isLight();

    // Smooth perspective blend transition
    if (Math.abs(perspTarget - perspBlend) > 0.0005) {
      const stepB = dt / 0.42;
      if (perspTarget > perspBlend) perspBlend = Math.min(perspTarget, perspBlend + stepB);
      else perspBlend = Math.max(perspTarget, perspBlend - stepB);
    } else {
      perspBlend = perspTarget;
    }

    // Keyboard panning
    if (heldKeys.size > 0) {
      abortChase();
      const step = (16 * dt) / Math.max(0.65, camCurr.zoom);
      let sx = 0;
      let sy = 0;
      if (heldKeys.has("ArrowLeft") || heldKeys.has("KeyA")) sx -= 1;
      if (heldKeys.has("ArrowRight") || heldKeys.has("KeyD")) sx += 1;
      if (heldKeys.has("ArrowUp") || heldKeys.has("KeyW")) sy -= 1;
      if (heldKeys.has("ArrowDown") || heldKeys.has("KeyS")) sy += 1;
      if (sx !== 0 || sy !== 0) {
        camGoal.x = Math.max(-24, Math.min(24, camGoal.x + (sx * 0.707 + sy * 0.707) * step));
        camGoal.z = Math.max(-17, Math.min(17, camGoal.z + (-sx * 0.707 + sy * 0.707) * step));
      }
    }

    // Gentle chase-cam following lead energy packet during dispatch burst (aborted immediately on user drag/wheel)
    if (chaseState.active) {
      const leadPk = packets.find((p) => p.isLead);
      if (leadPk) {
        const k = clamp01(leadPk.t);
        const w = smoothstep(0.0, 0.35, k);
        const gx = lerp(leadPk.group.position.x, chaseState.tx, 0.35 + 0.65 * k * k);
        const gz = lerp(leadPk.group.position.z, chaseState.tz, 0.35 + 0.65 * k * k);
        camGoal.x = lerp(camGoal.x, Math.max(-24, Math.min(24, gx)), w * 0.35);
        camGoal.z = lerp(camGoal.z, Math.max(-17, Math.min(17, gz)), w * 0.35);
        camGoal.zoom = lerp(camGoal.zoom, 1.38, 0.12);
      } else {
        camGoal.x = Math.max(-24, Math.min(24, chaseState.tx));
        camGoal.z = Math.max(-17, Math.min(17, chaseState.tz));
        camGoal.zoom = 1.38;
        chaseState.active = false;
      }
    }

    if (Math.abs(panVelocity.x) > 0.001 || Math.abs(panVelocity.z) > 0.001) {
      camGoal.x = Math.max(-24, Math.min(24, camGoal.x + panVelocity.x));
      camGoal.z = Math.max(-17, Math.min(17, camGoal.z + panVelocity.z));
      const damp = Math.pow(0.88, dt * 60);
      panVelocity.x *= damp;
      panVelocity.z *= damp;
    }

    const camLerp = 1 - Math.pow(1 - 0.16, dt * 60);
    camCurr.x += (camGoal.x - camCurr.x) * camLerp;
    camCurr.z += (camGoal.z - camCurr.z) * camLerp;
    camCurr.zoom += (camGoal.zoom - camCurr.zoom) * camLerp;
    updateCameraTransform(t, true);

    if (gridMat) {
      gridMat.uniforms.uT.value = t;
    }

    // Shared texture motion
    if (tex.flow) tex.flow.offset.y = (tex.flow.offset.y - dt * 0.55) % 1;
    if (tex.code) tex.code.offset.y = (tex.code.offset.y + dt * 0.28) % 1;
    if (tex.aura) tex.aura.offset.y = (tex.aura.offset.y - dt * 1.9) % 1;

    for (let i = 0; i < envAnimators.length; i += 1) envAnimators[i](t, dt, nowMs);
    for (let i = 0; i < animators.length; i += 1) animators[i](t, dt, nowMs);
    for (let i = 0; i < eggAnimators.length; i += 1) eggAnimators[i](t, dt, nowMs);

    // Rooms: intro rise + selection
    for (const rr of roomRecords.values()) {
      const p = clamp01((nowMs - rr.spawnAt) / 750);
      const e = easeOutCubic(p);
      rr.group.position.y = -1.2 * (1 - e);
      rr.introAlpha = clamp01((p - 0.4) / 0.6);
      const sel = rr.isSelected ? 1 : 0;
      rr.rimMat.emissiveIntensity = rr.baseRimIntensity * (1 + sel * (0.9 + 0.3 * Math.sin(t * 4)));
      rr.trimMat.color.setHex(rr.rm.colorHex);
      if (sel) {
        if (!projVec.white) projVec.white = new THREE.Color(0xffffff);
        rr.trimMat.color.lerp(projVec.white, 0.35 + 0.15 * Math.sin(t * 4));
      }
    }

    // Workstations
    const camPos = camera.position;
    for (const rec of wsRecords.values()) {
      const phase = rec.idx * 0.7;
      for (let i = 0; i < rec.anims.length; i += 1) rec.anims[i](t, dt, nowMs);

      const ip = clamp01((nowMs - rec.spawnAt) / 650);
      let s = rec.spawnAt < 0 ? 1 : Math.max(0.001, easeOutBack(ip));
      const di = t - rec.bounceStart;
      if (di >= 0 && di < 0.85) {
        s *= 1 + 0.12 * Math.exp(-6 * di) * Math.sin(25 * di);
      }
      rec.group.scale.setScalar(s);
      rec.introAlpha = rec.spawnAt < 0 ? 1 : clamp01((ip - 0.5) / 0.5);

      const hoverTarget = (hoveredKey === rec.ws.topicId || labelHoverKey === rec.ws.topicId) ? 1 : 0;
      rec.hover += (hoverTarget - rec.hover) * Math.min(1, dt * 12);
      rec.group.position.y = PLAT_TOP + rec.hover * 0.14;

      // Near-camera light pillar & aura fade (prevent washout on close-up)
      const camDist = Math.hypot(camPos.x - rec.ws.x, camPos.z - (rec.ws.z - 0.3));
      const near = smoothstep(5, 12, camDist) * (1 - 0.42 * smoothstep(1.38, 2.35, camCurr.zoom));

      if (rec.rigAnim) rec.rigAnim(t + phase);
      if (rec.poolMat) {
        rec.poolMat.opacity = rec.act.isResting
          ? rec.poolBase
          : rec.poolBase * (0.72 + 0.28 * Math.sin(t * 3 + phase));
      }
      if (rec.pillar && rec.pillarMat) {
        rec.pillar.rotation.y = t * 0.6;
        rec.pillarMat.opacity = rec.pillarBase * (0.7 + 0.3 * Math.sin(t * 4 + phase)) * near;
      }
      if (rec.moonSprite) {
        rec.moonSprite.position.y = 2.2 + Math.sin(t * 1.1 + phase) * 0.09;
      }

      if (rec.isSelected) {
        rec.ringMat.color.setHex(light ? 0x2563eb : 0xffffff);
        rec.ringMat.opacity = 0.75 + 0.2 * Math.sin(t * 4);
        rec.ring.scale.setScalar(1 + 0.035 * Math.sin(t * 4));
      } else {
        rec.ringMat.color.setHex(rec.statusHex);
        const isBusy = rec.act.isWorking || rec.act.isPending;
        const base = isBusy ? (light ? 0.82 : 0.72) : (light ? 0.22 : 0.16);
        let ringOp = base + rec.hover * 0.35 + (isBusy ? 0.12 * Math.sin(t * 4) : 0);
        const af = t - rec.approvalFlashStart;
        if (af >= 0 && af < 1.3) {
          if (!projVec.teal) projVec.teal = new THREE.Color(0x2ee6a8);
          const g = smoothstep(0.25, 1.25, af);
          rec.ringMat.color.copy(projVec.teal).lerp(new THREE.Color(rec.statusHex), g);
          ringOp = lerp(1.0, ringOp, g);
        }
        rec.ringMat.opacity = ringOp;
        rec.ring.scale.setScalar(1);
      }
      if (rec.pulseRing && rec.pulseRingMat) {
        const pk = (t * 0.65 + phase * 0.3) % 1;
        rec.pulseRing.scale.setScalar(1 + pk * 0.36);
        rec.pulseRingMat.opacity = (light ? 0.55 : 0.5) * (1 - pk);
      }
      if (rec.pendingOuterRing && rec.pendingOuterRingMat) {
        const pk2 = (t * 0.65 + phase * 0.3 + 0.5) % 1;
        rec.pendingOuterRing.scale.setScalar(1 + pk2 * 0.32);
        rec.pendingOuterRingMat.opacity = (light ? 0.65 : 0.6) * (1 - pk2);
      }
      if (rec.beam.visible) {
        rec.beam.material.opacity = (light ? 0.4 : 0.55) * (0.75 + 0.25 * Math.sin(t * 3)) * Math.max(0.35, near);
        rec.beam.rotation.y = t * 0.5;
      }

      rec.bots.forEach((bot, bIdx) => {
        const ud = bot.userData;
        const ph = ud.phase + phase;
        if (ud.working) {
          const freq = ud.overdrive ? 28 : (ud.headband ? 23 : 19);
          ud.leftArm.rotation.x = -0.9 + Math.sin(t * freq + ph) * 0.36;
          ud.rightArm.rotation.x = -0.9 - Math.sin(t * freq + ph) * 0.36;
          ud.headGroup.position.set(
            ud.overdrive ? Math.sin(t * 24 + ph) * 0.015 : 0,
            1.0 + Math.abs(Math.sin(t * (freq * 0.5) + ph)) * 0.045,
            0,
          );
          ud.headGroup.rotation.set(0.14, Math.sin(t * 2.8 + bIdx) * 0.18, 0);
          ud.torso.rotation.x = ud.overdrive ? 0.08 : 0;
          ud.torso.scale.y = 1;
          if (ud.headbandTails) {
            ud.headbandTails.forEach((tail, tIdx) => {
              tail.rotation.z = (tIdx === 0 ? -0.18 : 0.18) + Math.sin(t * 14 + ph + tIdx) * 0.22;
              tail.rotation.x = 0.45 + Math.sin(t * 16 + ph + tIdx * 1.3) * 0.25;
            });
          }
        } else if (ud.pose === "lying") {
          ud.leftArm.rotation.x = -0.3 + Math.sin(t * 1.1 + ph) * 0.02;
          ud.rightArm.rotation.x = -0.3 - Math.sin(t * 1.1 + ph) * 0.02;
          ud.headGroup.position.set(0, 1.0, 0);
          ud.headGroup.rotation.set(0.08 + Math.sin(t * 1.2 + ph) * 0.04, 0, -0.12);
          ud.torso.rotation.x = 0;
          ud.torso.scale.set(1 + Math.sin(t * 1.2 + ph) * 0.05, 1, 1 + Math.sin(t * 1.2 + ph) * 0.05);
        } else {
          ud.leftArm.rotation.x = -1.25 + Math.sin(t * 1.1 + ph) * 0.03;
          ud.rightArm.rotation.x = -1.25 - Math.sin(t * 1.1 + ph) * 0.03;
          ud.headGroup.position.set(0, 0.90 + Math.sin(t * 1.3 + ph) * 0.015, 0.14);
          ud.headGroup.rotation.set(0.56 + Math.sin(t * 1.3 + ph) * 0.035, 0, 0.22);
          ud.torso.rotation.x = 0.24;
          ud.torso.scale.y = 1 + Math.sin(t * 1.3 + ph) * 0.035;
        }
        if (ud.crest) ud.crest.rotation.y = ud.working ? (t * 1.8 + ph) : (t * 0.2 + ph);
        if (ud.eyes) {
          ud.eyes.scale.y = ud.working ? (((t + ud.blinkSeed) % 4.3) < 0.13 ? 0.12 : 1) : 0.22;
        }
      });

      if (rec.sleepSprites?.length) {
        rec.sleepSprites.forEach((sp) => {
          const sk = (t * 0.34 + sp.userData.phaseOffset + phase * 0.15) % 1;
          sp.position.set(
            0.8 + sk * 0.38 + Math.sin(t * 1.6 + sk * 6) * 0.07,
            1.0 + sk * 1.3,
            1.25 - sk * 0.12,
          );
          sp.material.opacity = Math.sin(sk * Math.PI) * (light ? 0.9 : 0.85);
          const sScale = 0.4 + sk * 0.55;
          sp.scale.set(sScale, sScale, 1);
        });
      }

      if (rec.auraGroup) {
        rec.auraGroup.rotation.y = t * 2.4 + phase;
        const auraFade = 0.3 + 0.7 * near;
        rec.auraGroup.children.forEach((m) => {
          if (m.userData.op0 === undefined) m.userData.op0 = m.material.opacity;
          m.material.opacity = m.userData.op0 * auraFade;
        });
        rec.auraGroup.scale.set(
          1 + 0.06 * Math.sin(t * 10 + phase),
          1 + 0.08 * Math.sin(t * 8 + phase),
          1 + 0.06 * Math.sin(t * 10 + phase),
        );
      }

      if (rec.auraSparks?.length) {
        rec.auraSparks.forEach((asp) => {
          const k = (t * 1.35 + asp.userData.seed) % 1;
          const ang = asp.userData.angle + t * 4.2;
          const rad = 0.72 * (1 - k * 0.35);
          asp.position.set(Math.cos(ang) * rad, 0.35 + k * 2.0, 0.92 + Math.sin(ang) * rad);
          asp.material.opacity = Math.sin(k * Math.PI) * 0.95;
          const sc = 0.26 * (1 - k * 0.35);
          asp.scale.set(sc, sc, 1);
        });
      }

      rec.sparks.forEach((sp) => {
        if (sp.userData.x0 === undefined) sp.userData.x0 = sp.position.x;
        const k = (t * 0.9 + sp.userData.seed) % 1;
        sp.position.y = 1.0 + k * 1.3;
        sp.position.x = sp.userData.x0 + Math.sin(t * 3 + sp.userData.seed * 10) * 0.04;
        sp.material.opacity = sp.userData.baseOpacity * (1 - k);
        const sc = 0.22 * (1 - k * 0.5);
        sp.scale.set(sc, sc, 1);
      });

      if (rec.screenGlow) {
        rec.screenGlow.material.opacity = rec.screenGlow.userData.baseOpacity * (0.8 + 0.2 * Math.sin(t * 7 + phase));
      }
      if (rec.coin) {
        rec.coin.rotation.y = t * 2.2 + phase;
        rec.coin.position.y = 2.45 + Math.sin(t * 2.8 + phase) * 0.12;
      }
      if (rec.alert) {
        rec.alert.position.y = 2.55 + Math.abs(Math.sin(t * 4.5 + phase)) * 0.22;
        rec.alert.rotation.y = Math.sin(t * 2) * 0.3;
      }
    }

    // Energy packets (parabolic arc + lateral spread + end-segment acceleration)
    for (let i = packets.length - 1; i >= 0; i -= 1) {
      const pk = packets[i];
      if (pk.delay > 0) {
        pk.delay -= dt;
        pk.group.visible = false;
        continue;
      }
      pk.group.visible = true;
      pk.t += dt * pk.speed;
      const k = Math.min(1, pk.t);
      const e = 0.5 * k + 0.5 * k * k;
      const dx = pk.tx - pk.fx;
      const dz = pk.tz - pk.fz;
      const len = Math.hypot(dx, dz) || 1;
      const sk = Math.sin(k * Math.PI);
      pk.group.position.set(
        pk.fx + dx * e + (-dz / len) * pk.side * sk,
        pk.fy + (0.7 - pk.fy) * e + sk * pk.arc,
        pk.fz + dz * e + (dx / len) * pk.side * sk,
      );
      pk.history.unshift(pk.group.position.clone());
      if (pk.history.length > 24) pk.history.pop();
      pk.trail.forEach((s, ti) => {
        const hp = pk.history[Math.min(pk.history.length - 1, (ti + 1) * 2)];
        if (hp) {
          s.visible = true;
          s.position.copy(hp);
        }
      });
      if (k >= 1) {
        if (pk.burstImpact) {
          spawnRipple(pk.tx, pk.tz - 0.3, 0x7af0ff, { size: 6.4, dur: 1.15, peak: 0.95 });
          spawnRipple(pk.tx, pk.tz - 0.3, 0xffc857, { size: 4.6, dur: 1.3, peak: 0.85, delay: 0.07 });
          spawnRipple(pk.tx, pk.tz - 0.3, 0x3ddc97, { size: 3.1, dur: 1.0, peak: 0.75, delay: 0.16 });
          if (gridMat) {
            gridMat.uniforms.uImp.value = t;
            gridMat.uniforms.uImpC.value.set(pk.tx, pk.tz - 0.3);
          }
          const targetRec = pk.targetTopicId ? findWorkstationRecord(pk.targetTopicId) : null;
          if (targetRec) targetRec.bounceStart = t;
          impactShakeAt = t;
        } else {
          spawnRipple(pk.tx, pk.tz - 0.3, pk.color, { size: 2.4, dur: 0.85, peak: 0.75 });
        }
        disposeTree(pk.group);
        fxGroup.remove(pk.group);
        pk.trail.forEach((s) => {
          s.material.dispose();
          fxGroup.remove(s);
        });
        packets.splice(i, 1);
      }
    }

    // Ripples
    for (let i = ripples.length - 1; i >= 0; i -= 1) {
      const rp = ripples[i];
      rp.t += dt;
      if (rp.t < 0) {
        rp.mesh.visible = false;
        continue;
      }
      rp.mesh.visible = true;
      const p = rp.t / rp.dur;
      const e = easeOutCubic(Math.min(1, p));
      rp.mesh.scale.setScalar(0.2 + e * rp.size);
      rp.mesh.material.opacity = rp.peak * (1 - e);
      if (p >= 1) {
        rp.mesh.material.dispose();
        fxGroup.remove(rp.mesh);
        ripples.splice(i, 1);
      }
    }

    // Ambient particles (pure time-based modulo from initial positions, zero drift)
    if (particles && particleSpeeds && particleBase) {
      const arr = particles.geometry.attributes.position.array;
      for (let p = 0; p < particleSpeeds.length; p += 1) {
        const o = p * 3;
        arr[o] = particleBase[o] + Math.sin(t * 0.5 + p) * 0.4;
        arr[o + 1] = 0.4 + ((particleBase[o + 1] - 0.4 + particleSpeeds[p] * t) % 8.6);
        arr[o + 2] = particleBase[o + 2];
      }
      particles.geometry.attributes.position.needsUpdate = true;
    }

    renderFrameWithPost();
    updateProjectedLabels(dt);
  }

  // ------------------------------------------------------------ input
  function jumpToNextPendingWorkstation() {
    const pendingList = Array.from(wsRecords.values()).filter((r) => r.act.isPending);
    if (!pendingList.length) return false;
    const prevIdx = pendingList.findIndex((r) => r.ws.topicId === lastPendingJumpId);
    const next = pendingList[(prevIdx + 1) % pendingList.length];
    lastPendingJumpId = next.ws.topicId;
    panToPosition(next.ws.x, next.ws.z, 1.48);
    spawnRipple(next.ws.x, next.ws.z - 0.3, 0xef4444, { size: 3.6, dur: 1.0, peak: 0.9 });
    if (next.ws.isClusterHub) {
      const pendingMember = (next.ws.memberTopics || []).find((m) => m.pendingCount > 0)?.id || next.ws.signalTopicId;
      if (pendingMember && pendingMember !== next.ws.topicId) onSelectTopic?.(pendingMember, next.ws.roomId);
      else if (typeof onSelectCluster === "function") onSelectCluster(next.ws.roomId, next.ws.memberTopicIds || []);
      else onSelectRoom?.(next.ws.roomId);
    } else {
      onSelectTopic?.(next.ws.topicId, next.ws.roomId);
    }
    return true;
  }

  function syncVisButtonsDom(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll("[data-tycoon-toggle-vis]").forEach((btn) => {
      const key = btn.dataset.tycoonToggleVis;
      if (key && key in visPrefs) {
        const active = Boolean(visPrefs[key]);
        btn.classList.toggle("is-active", active);
        btn.setAttribute("aria-pressed", active ? "true" : "false");
      }
    });
  }

  function bindPointerAndKeyControls(domEl) {
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -PLAT_TOP);
    const groundHit = new THREE.Vector3();
    const dragHitPrev = new THREE.Vector3();
    const dragHitCurr = new THREE.Vector3();
    const activePointers = new Map();
    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    let dragging = false;
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    let movedDist = 0;
    let lastDeltaWorldX = 0;
    let lastDeltaWorldZ = 0;

    const getPinchDist = () => {
      const pts = Array.from(activePointers.values());
      if (pts.length < 2) return 0;
      return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
    };

    const setPointer = (clientX, clientY) => {
      const rect = domEl.getBoundingClientRect();
      if (!rect.width || !rect.height) return false;
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      return true;
    };

    const intersectGroundAt = (clientX, clientY, outVec) => {
      if (!setPointer(clientX, clientY)) return false;
      return Boolean(raycaster.ray.intersectPlane(groundPlane, outVec));
    };

    const getHitObject = (clientX, clientY) => {
      if (!setPointer(clientX, clientY)) return null;
      const hits = raycaster.intersectObjects(interactiveMeshes, false);
      return hits[0]?.object || null;
    };

    const onContext = (e) => e.preventDefault();
    const onDown = (e) => {
      abortChase();
      activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      domEl.setPointerCapture?.(e.pointerId);
      if (activePointers.size >= 2) {
        dragging = false;
        isUserDragging = false;
        pinchStartDist = getPinchDist();
        pinchStartZoom = camGoal.zoom;
        return;
      }
      dragging = true;
      isUserDragging = true;
      movedDist = 0;
      panVelocity.x = 0;
      panVelocity.z = 0;
      lastDeltaWorldX = 0;
      lastDeltaWorldZ = 0;
      downX = e.clientX;
      downY = e.clientY;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onMove = (e) => {
      if (activePointers.has(e.pointerId)) {
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      }
      if (activePointers.size >= 2 && pinchStartDist > 0) {
        abortChase();
        const dist = getPinchDist();
        if (dist > 0) {
          camGoal.zoom = Math.max(0.62, Math.min(2.35, pinchStartZoom * (dist / pinchStartDist)));
        }
        return;
      }
      if (!dragging) {
        if (e.pointerType === "touch") return;
        const hit = getHitObject(e.clientX, e.clientY);
        hoveredKey = hit?.userData?.topicId || "";
        domEl.style.cursor = hit && (hit.userData.kind === "topic" || hit.userData.kind === "cluster" || hit.userData.kind === "incubator" || hit.userData.kind === "sprite") ? "pointer" : "grab";
        return;
      }
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      movedDist += Math.hypot(dx, dy);
      domEl.style.cursor = "grabbing";

      let worldDx = 0;
      let worldDz = 0;
      let usedRay = false;
      if (perspBlend > 0.001) {
        const okPrev = intersectGroundAt(lastX, lastY, dragHitPrev);
        const okCurr = intersectGroundAt(e.clientX, e.clientY, dragHitCurr);
        if (okPrev && okCurr) {
          const rdx = dragHitPrev.x - dragHitCurr.x;
          const rdz = dragHitPrev.z - dragHitCurr.z;
          if (Math.hypot(rdx, rdz) < 25) {
            worldDx = rdx;
            worldDz = rdz;
            usedRay = true;
          }
        }
      }
      if (!usedRay) {
        const { h } = getViewportSize();
        const worldUnitsPerPixel = ((BASE_FRUSTUM_HALF_H * 2) / Math.max(0.5, camCurr.zoom)) / Math.max(200, h);
        const sinElev = 25 / Math.hypot(28, 25, 28);
        const rightStep = -dx * worldUnitsPerPixel;
        const upStep = (dy * worldUnitsPerPixel) / sinElev;
        worldDx = rightStep * 0.7071 - upStep * 0.7071;
        worldDz = -rightStep * 0.7071 - upStep * 0.7071;
      }

      lastX = e.clientX;
      lastY = e.clientY;
      camGoal.x = Math.max(-24, Math.min(24, camGoal.x + worldDx));
      camGoal.z = Math.max(-17, Math.min(17, camGoal.z + worldDz));
      camCurr.x = camGoal.x;
      camCurr.z = camGoal.z;
      updateCameraTransform(currentAnimTime, false);
      lastDeltaWorldX = worldDx;
      lastDeltaWorldZ = worldDz;
    };
    const onUp = (e) => {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) pinchStartDist = 0;
      if (!dragging) return;
      dragging = false;
      isUserDragging = false;
      domEl.style.cursor = "grab";
      if (movedDist >= 6) {
        panVelocity.x = Math.max(-0.8, Math.min(0.8, lastDeltaWorldX * 0.65));
        panVelocity.z = Math.max(-0.8, Math.min(0.8, lastDeltaWorldZ * 0.65));
        return;
      }
      if (Math.hypot(e.clientX - downX, e.clientY - downY) >= 6) return;
      const hit = getHitObject(e.clientX, e.clientY);
      if (raycaster.ray.intersectPlane(groundPlane, groundHit)) {
        spawnRipple(groundHit.x, groundHit.z, (hit?.userData?.kind === "topic" || hit?.userData?.kind === "cluster") ? 0x38bdf8 : 0x94a3b8);
      }
      if (hit?.userData) {
        const ud = hit.userData;
        if (ud.kind === "cluster" && ud.roomId) {
          const rec = wsRecords.get(ud.topicId);
          if (rec) panToPosition(rec.ws.x, rec.ws.z, 1.42);
          if (typeof onSelectCluster === "function") onSelectCluster(ud.roomId, ud.memberTopicIds || []);
          else onSelectRoom?.(ud.roomId);
        } else if (ud.kind === "topic" && ud.topicId) {
          const rec = wsRecords.get(ud.topicId);
          if (rec) panToPosition(rec.ws.x, rec.ws.z, 1.42);
          onSelectTopic?.(ud.topicId, ud.roomId);
        } else if (ud.kind === "sprite") {
          spawnRipple(spriteRecord?.group?.position?.x || 2.35, spriteRecord?.group?.position?.z || 1.85, 0xfbbf24);
          onSelectSprite?.();
        } else if (ud.kind === "incubator") {
          const bp = ROOM_BLUEPRINTS.incubator;
          panToPosition(bp.x, bp.z, bp.camZoom);
          onSelectIncubator?.(ud.eggId || "");
        } else if (ud.kind === "room" && ud.roomId) {
          const bp = ROOM_BLUEPRINTS[ud.roomId];
          if (bp) panToPosition(bp.x, bp.z, bp.camZoom);
          onSelectRoom?.(ud.roomId);
        }
      } else {
        onClearSelection?.();
      }
    };
    const onCancel = (e) => {
      activePointers.delete(e?.pointerId);
      if (activePointers.size < 2) pinchStartDist = 0;
      dragging = false;
      isUserDragging = false;
    };
    const onLeave = () => { if (!dragging) hoveredKey = ""; };
    const onWheel = (e) => {
      e.preventDefault();
      abortChase();
      const factor = e.deltaY > 0 ? 0.92 : 1.09;
      camGoal.zoom = Math.max(0.62, Math.min(2.35, camGoal.zoom * factor));
    };
    const onKeyDown = (e) => {
      if (!running || disposed) return;
      const tag = String(e.target?.tagName || "").toUpperCase();
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
      if (e.code === "Space" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        jumpToNextPendingWorkstation();
        return;
      }
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "KeyW", "KeyA", "KeyS", "KeyD"].includes(e.code)) {
        abortChase();
        heldKeys.add(e.code);
      }
    };
    const onKeyUp = (e) => heldKeys.delete(e.code);
    const onBlur = () => heldKeys.clear();

    const hudScope = containerEl.parentElement || document;
    const onHudVisClick = (e) => {
      const btn = e.target?.closest?.("[data-tycoon-toggle-vis]");
      if (!btn || disposed) return;
      const key = btn.dataset.tycoonToggleVis;
      if (!key || !(key in visPrefs)) return;
      visPrefs[key] = !visPrefs[key];
      writeTycoonVisualPrefs(visPrefs);
      if (key === "perspective") {
        perspTarget = visPrefs.perspective ? 1 : 0;
      } else {
        syncPostThemeUniforms();
      }
      syncVisButtonsDom(hudScope);
    };

    domEl.addEventListener("contextmenu", onContext);
    domEl.addEventListener("pointerdown", onDown);
    domEl.addEventListener("pointermove", onMove);
    domEl.addEventListener("pointerup", onUp);
    domEl.addEventListener("pointercancel", onCancel);
    domEl.addEventListener("pointerleave", onLeave);
    domEl.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    hudScope.addEventListener("click", onHudVisClick);
    cleanupFns.push(() => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      hudScope.removeEventListener("click", onHudVisClick);
    });
  }

  // -------------------------------------------------------------- init
  async function initEngine() {
    try {
      THREE = await import("./vendor/three.module.min.js");
      if (disposed) return;

      renderer = new THREE.WebGLRenderer({
        antialias: !isMobilePerf,
        powerPreference: isMobilePerf ? "default" : "high-performance",
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, isMobilePerf ? 1.25 : 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;
      renderer.shadowMap.enabled = !isMobilePerf;
      if (!isMobilePerf) {
        renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      }
      canvasWrap.appendChild(renderer.domElement);
      fallbackBanner.remove();

      scene = new THREE.Scene();
      const { w: initW, h: initH } = measureViewportSize();
      const aspect = initW / initH;
      orthoCam = new THREE.OrthographicCamera(
        -BASE_FRUSTUM_HALF_H * aspect,
        BASE_FRUSTUM_HALF_H * aspect,
        BASE_FRUSTUM_HALF_H,
        -BASE_FRUSTUM_HALF_H,
        1,
        160,
      );
      orthoCam.zoom = camCurr.zoom;
      perspCam = new THREE.PerspectiveCamera(36, aspect, 0.2, 600);
      camera = perspBlend > 0.001 ? perspCam : orthoCam;
      updateCameraTransform();

      hemiLight = new THREE.HemisphereLight(0x8fb4ff, 0x0a1020, isMobilePerf ? 0.8 : 0.6);
      keyLight = new THREE.DirectionalLight(0xfff6e8, 2.2);
      keyLight.position.set(16, 32, 12);
      keyLight.castShadow = !isMobilePerf;
      if (!isMobilePerf) {
        keyLight.shadow.mapSize.set(2048, 2048);
        keyLight.shadow.camera.near = 4;
        keyLight.shadow.camera.far = 90;
        keyLight.shadow.camera.left = -36;
        keyLight.shadow.camera.right = 36;
        keyLight.shadow.camera.top = 36;
        keyLight.shadow.camera.bottom = -36;
        keyLight.shadow.bias = -0.0004;
        keyLight.shadow.normalBias = 0.03;
      }
      rimLight = new THREE.DirectionalLight(0x60a5fa, 1.4);
      rimLight.position.set(-24, 14, -20);
      scene.add(hemiLight, keyLight, rimLight);

      floorMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(96, 72),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, metalness: 0.1 }),
      );
      floorMesh.rotation.x = -Math.PI / 2;
      floorMesh.receiveShadow = !isMobilePerf;
      scene.add(floorMesh);

      poolMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(64, 48),
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false }),
      );
      poolMesh.rotation.x = -Math.PI / 2;
      poolMesh.position.y = 0.011;
      scene.add(poolMesh);

      // Dark-mode anti-aliased cyber grid floor + dispatch shockwave (1 drawcall)
      gridMat = new THREE.ShaderMaterial({
        uniforms: {
          uT: { value: 0 },
          uImp: { value: -100 },
          uImpC: { value: new THREE.Vector2(0, 0) },
          uCol: { value: new THREE.Color(0x38e1ff) },
          uGold: { value: new THREE.Color(0xffc857) },
        },
        vertexShader: GRID_VERT,
        fragmentShader: GRID_FRAG,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      gridMesh = new THREE.Mesh(new THREE.PlaneGeometry(96, 72), gridMat);
      gridMesh.rotation.x = -Math.PI / 2;
      gridMesh.position.y = 0.014;
      gridMesh.renderOrder = 2;
      scene.add(gridMesh);

      // Floating ambient motes (store initial particleBase for modulo time motion)
      const N = isMobilePerf ? 60 : 220;
      const pPos = new Float32Array(N * 3);
      particleSpeeds = new Float32Array(N);
      for (let i = 0; i < N; i += 1) {
        pPos[i * 3] = (Math.random() - 0.5) * 60;
        pPos[i * 3 + 1] = 0.4 + Math.random() * 8.6;
        pPos[i * 3 + 2] = (Math.random() - 0.5) * 44;
        particleSpeeds[i] = 0.15 + Math.random() * 0.45;
      }
      particleBase = new Float32Array(pPos);
      const pGeo = new THREE.BufferGeometry();
      pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
      particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
        size: 6,
        sizeAttenuation: false,
        transparent: true,
        depthWrite: false,
        toneMapped: false,
      }));
      scene.add(particles);

      dynamicGroup = new THREE.Group();
      fxGroup = new THREE.Group();
      envGroup = new THREE.Group();
      scene.add(envGroup, dynamicGroup, fxGroup);

      applySceneTheme(readResolvedTheme());
      bindPointerAndKeyControls(renderer.domElement);
      syncPostThemeUniforms();

      const handleResize = () => {
        if (!renderer || !orthoCam || !perspCam || disposed) return;
        const { w, h } = measureViewportSize();
        const asp = w / h;
        orthoCam.left = -BASE_FRUSTUM_HALF_H * asp;
        orthoCam.right = BASE_FRUSTUM_HALF_H * asp;
        orthoCam.top = BASE_FRUSTUM_HALF_H;
        orthoCam.bottom = -BASE_FRUSTUM_HALF_H;
        orthoCam.updateProjectionMatrix();
        perspCam.aspect = asp;
        perspCam.updateProjectionMatrix();
        renderer.setSize(w, h, false);
        if (compMat) compMat.uniforms.uAspect.value = asp;
        updateProjectedLabels();
      };

      const resizeObs = new ResizeObserver(handleResize);
      resizeObs.observe(containerEl);
      const themeObs = new MutationObserver(() => {
        const nextTheme = readResolvedTheme();
        if (nextTheme !== currentTheme) {
          applySceneTheme(nextTheme);
          if (lastOverview) {
            rebuildDynamicWorld();
            applyInteractionState();
          }
        }
      });
      themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      cleanupFns.push(() => {
        resizeObs.disconnect();
        themeObs.disconnect();
      });

      handleResize();
      initialized = true;
      if (lastOverview) {
        rebuildDynamicWorld();
        applyInteractionState();
      }
      if (running) {
        rafId = requestAnimationFrame(animateFrame);
      }
    } catch (err) {
      fallbackBanner.textContent = `3D 视图初始化受限（${err?.message || "WebGL 不可用"}），可点击顶栏切换「2D 看板」`;
    }
  }

  void initEngine();

  return {
    sync(overview, uiState = {}) {
      lastOverview = overview;
      lastUiState = uiState;
      if (!initialized || !overview) return;
      syncDynamicWorldIncremental();
      applyInteractionState();
    },
    flyToRoom(roomId = "all") {
      if (!roomId || roomId === "all") {
        resetCamera();
        return;
      }
      const bp = ROOM_BLUEPRINTS[roomId];
      if (bp) panToPosition(bp.x, bp.z, bp.camZoom);
    },
    flyToTopic(topicId = "") {
      const rec = findWorkstationRecord(topicId);
      if (rec) panToPosition(rec.ws.x, rec.ws.z, 1.42);
    },
    triggerDispatchBurst(topicId = "") {
      const rec = findWorkstationRecord(topicId);
      const tx = rec ? rec.ws.x : 0;
      const tz = rec ? rec.ws.z : -6;
      const sides = [0, -1.1, 1.1, -2.0, 2.0];
      const offX = [0, 0.32, -0.28, 0.18, -0.14];
      const offZ = [0, -0.22, 0.18, 0.26, -0.26];
      if (rec) {
        chaseState = { active: true, tx, tz };
      }
      for (let i = 0; i < 5; i += 1) {
        spawnEnergyPacket(tx + offX[i], tz + offZ[i], i % 2 === 0 ? 0xfbbf24 : 0x38bdf8, 0.92 + i * 0.05, {
          side: sides[i],
          arc: 3.6 - 0.22 * i,
          delay: 0.11 * i,
          burstImpact: i === 0,
          isLead: i === 0,
          targetTopicId: i === 0 ? topicId : "",
        });
      }
    },
    jumpToNextPending: jumpToNextPendingWorkstation,
    setSpriteMood,
    spriteVisit,
    spriteSay,
    setUserBusy(busy) { spriteUserBusy = Boolean(busy); },
    syncSpriteState({ badgeCount = 0, mood = "idle" } = {}) {
      const mapped = { urgent: "waiting", coin: "good", busy: "thinking" }[mood] || mood;
      // The legacy idle sync is frequent; it must not continually reset patrol.
      if (mapped !== lastSpriteLegacyMood) setSpriteMood(mapped);
      lastSpriteLegacyMood = mapped;
      spriteRecord?.labelEl.classList.toggle("has-alert", badgeCount > 0);
    },
    resume() {
      if (disposed || running) return;
      running = true;
      lastFrameAt = 0;
      if (initialized) rafId = requestAnimationFrame(animateFrame);
    },
    pause() {
      running = false;
      heldKeys.clear();
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      finishSpriteVisit();
    },
    dispose() {
      disposed = true;
      this.pause();
      cleanupFns.forEach((fn) => {
        try { fn(); } catch {}
      });
      finishSpriteVisit();
      spriteBrain.reset();
      spriteRecord?.group.userData.textures?.forEach((texture) => texture.dispose());
      if (dynamicGroup) disposeTree(dynamicGroup);
      if (envGroup) disposeTree(envGroup);
      if (fxGroup) disposeTree(fxGroup);
      for (const m of matCache.values()) m.dispose();
      matCache.clear();
      for (const g of geoCache.values()) g.dispose();
      geoCache.clear();
      disposeSharedTextures();
      envRT?.dispose?.();
      disposePostRT();
      postQuad?.geometry?.dispose?.();
      brightMat?.dispose?.();
      blurMat?.dispose?.();
      compMat?.dispose?.();
      floorMesh?.geometry?.dispose?.();
      floorMesh?.material?.dispose?.();
      poolMesh?.geometry?.dispose?.();
      poolMesh?.material?.dispose?.();
      gridMesh?.geometry?.dispose?.();
      gridMat?.dispose?.();
      particles?.geometry?.dispose?.();
      particles?.material?.dispose?.();
      renderer?.dispose?.();
    },
  };
}
