// Deterministic, renderer-independent patrol and proactive speech budget.
const TYPES = ["alert", "harvest", "ruin"];
const SAME_SIGNAL_MS = 30 * 60_000;
const GLOBAL_MS = 2 * 60_000;
const FLIGHT_MS = 5000;
const INSPECT_MS = 5000;

export function createSpriteBrain({ now: clock = Date.now } = {}) {
  const readNow = () => typeof clock === "function" ? clock() : Number(clock);
  let target = null;
  let phase = "patrol";
  let since = null;
  let previousNow = null;
  let lastSpoke = -Infinity;
  const spoken = new Map();
  const queued = new Map();
  const keyOf = (s) => `${s.topicId}:${s.mark}`;
  const canSay = (s, at) => at - lastSpoke >= GLOBAL_MS
    && at - (spoken.get(keyOf(s)) ?? -Infinity) >= SAME_SIGNAL_MS;

  return {
    // signals: tour stops {topicId, topicTitle, mark, bubble?, arrived?}.
    // A queuedOnly stop requests speech without changing the patrol route.
    step({ signals = [], now = readNow(), userBusy = false } = {}) {
      const at = Number(now);
      const stops = signals.filter((s) => s?.topicId && TYPES.includes(s.mark));
      const route = stops.filter((s) => !s.queuedOnly).sort((a, b) =>
        TYPES.indexOf(a.mark) - TYPES.indexOf(b.mark) || String(a.topicId).localeCompare(String(b.topicId)));
      const liveKeys = new Set(stops.map(keyOf));
      for (const [key, s] of queued) if (!s.queuedOnly && !liveKeys.has(key)) queued.delete(key);
      for (const s of stops) {
        if (s.queuedOnly && at - (spoken.get(keyOf(s)) ?? -Infinity) >= SAME_SIGNAL_MS) queued.set(keyOf(s), s);
      }
      if (since === null) since = at;
      if (userBusy) {
        if (previousNow !== null) since += Math.max(0, at - previousNow);
        previousNow = at;
        return { mood: phase === "inspect" ? "inspect" : "idle", targetTopicId: target, bubble: null };
      }
      previousNow = at;
      if (!route.some((s) => s.topicId === target)) {
        target = route[0]?.topicId ?? null;
        phase = "patrol";
        since = at;
      }
      let stop = route.find((s) => s.topicId === target);
      if (stop && phase === "patrol" && (stop.arrived === true || (stop.arrived == null && at - since >= FLIGHT_MS))) {
        phase = "inspect";
        since = at;
        if (!queued.has(keyOf(stop)) && at - (spoken.get(keyOf(stop)) ?? -Infinity) >= SAME_SIGNAL_MS) queued.set(keyOf(stop), stop);
      } else if (stop && phase === "inspect" && at - since >= INSPECT_MS) {
        const next = (route.indexOf(stop) + 1) % route.length;
        stop = route[next];
        target = stop.topicId;
        phase = "patrol";
        since = at;
      }
      let bubble = null;
      for (const [key, s] of queued) {
        if (!canSay(s, at)) continue;
        if (!s.queuedOnly && (s.topicId !== target || phase !== "inspect")) continue;
        const text = s.bubble || `${s.topicTitle || s.topicId}：${{ alert: "等你拍板", harvest: "有菜可收", ruin: "停了几天" }[s.mark]}`;
        bubble = { text, topicId: s.topicId, type: s.mark, ttlMs: s.ttlMs ?? 6000 };
        lastSpoke = at;
        spoken.set(key, at);
        queued.delete(key);
        break;
      }
      let mood = target ? phase : "idle";
      if (phase === "inspect" && at - since >= 1000) mood = { alert: "waiting", harvest: "good", ruin: "worry" }[stop?.mark] || "inspect";
      return { mood, targetTopicId: target, bubble };
    },
    // User speech bypasses the budget, but keeps the next proactive bubble quiet.
    noteUserBubble(now = readNow()) { lastSpoke = Number(now); },
    reset() {
      target = null; phase = "patrol"; since = null; previousNow = null;
      lastSpoke = -Infinity; spoken.clear(); queued.clear();
    },
  };
}
