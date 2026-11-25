import test from "node:test";
import assert from "node:assert/strict";
import { createSpriteBrain } from "../public/sprite-brain.js";

const stop = (topicId = "shop", mark = "alert", extra = {}) => ({ topicId, topicTitle: "示例商城", mark, ...extra });

test("T15: patrol → inspect → signal pose, five-second stops, then next building", () => {
  const brain = createSpriteBrain();
  const signals = [stop("books", "harvest"), stop()];
  assert.deepEqual(brain.step({ signals, now: 0 }), { mood: "patrol", targetTopicId: "shop", bubble: null });
  const inspection = brain.step({ signals, now: 5000 });
  assert.equal(inspection.mood, "inspect");
  assert.equal(inspection.bubble.topicId, "shop");
  assert.equal(inspection.bubble.ttlMs, 6000);
  assert.equal(brain.step({ signals, now: 6000 }).mood, "waiting");
  const next = brain.step({ signals, now: 10000 });
  assert.equal(next.mood, "patrol");
  assert.equal(next.targetTopicId, "books");
  assert.equal(brain.step({ signals, now: 15000 }).mood, "inspect");
  assert.equal(brain.step({ signals, now: 16000 }).mood, "good");
  assert.deepEqual(brain.step({ signals: [], now: 20000 }), { mood: "idle", targetTopicId: null, bubble: null });
});

test("T15: same building and same signal speaks once in thirty minutes", () => {
  const brain = createSpriteBrain();
  const signals = [stop("shop", "alert", { arrived: true })];
  const bubbles = [];
  for (let now = 0; now < 30 * 60_000; now += 1000) {
    const result = brain.step({ signals, now });
    if (result.bubble) bubbles.push(now);
  }
  assert.deepEqual(bubbles, [0]);
  let afterCooldown;
  for (let now = 30 * 60_000; now < 30 * 60_000 + 10_000; now += 1000) afterCooldown ||= brain.step({ signals, now }).bubble;
  assert.ok(afterCooldown);
});

test("T15: park-wide proactive speech is at most once per two minutes, across signal types", () => {
  const brain = createSpriteBrain();
  const times = [];
  for (let now = 0; now <= 360_000; now += 1000) {
    const signals = [stop("a", "alert", { arrived: true }), stop("b", "harvest", { arrived: true }), stop("c", "ruin", { arrived: true })];
    if (brain.step({ signals, now }).bubble) times.push(now);
  }
  assert.equal(times.length, 3);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 120_000);
});

test("T15: busy freezes patrol and queues speech until the user is free", () => {
  const brain = createSpriteBrain();
  const signals = [stop("shop", "alert", { arrived: true })];
  brain.step({ signals, now: 0, userBusy: true });
  const request = stop("shop", "alert", { bubble: "示例商城：先看这张工单", queuedOnly: true });
  assert.equal(brain.step({ signals: [...signals, request], now: 4000, userBusy: true }).bubble, null);
  assert.equal(brain.step({ signals, now: 8000, userBusy: true }).targetTopicId, null);
  const free = brain.step({ signals, now: 9000 });
  assert.equal(free.bubble.text, request.bubble);
  const frozenTarget = brain.step({ signals, now: 10_000, userBusy: true }).targetTopicId;
  assert.equal(brain.step({ signals: [stop("other", "ruin")], now: 120_000, userBusy: true }).targetTopicId, frozenTarget);
});

test("T15: explicit speech quiets proactive bubbles; reset clears budget and removed signals", () => {
  let now = 100;
  const brain = createSpriteBrain({ now: () => now });
  const signals = [stop("shop", "ruin", { arrived: true })];
  brain.noteUserBubble();
  assert.equal(brain.step({ signals }).bubble, null);
  now = 120_100;
  // Re-enter inspect after a coarse clock advance.
  brain.step({ signals });
  assert.ok(brain.step({ signals, now: now + 1 }).bubble);
  brain.reset();
  const reset = brain.step({ signals, now });
  assert.equal(reset.mood, "inspect");
  assert.ok(reset.bubble);
  brain.reset();
  assert.equal(brain.step({ signals: [], now }).mood, "idle");
});

test("T15: renderer arrival, rather than elapsed flight, controls inspection", () => {
  const brain = createSpriteBrain();
  assert.equal(brain.step({ signals: [stop("a", "ruin", { arrived: false })], now: 0 }).mood, "patrol");
  assert.equal(brain.step({ signals: [stop("a", "ruin", { arrived: false })], now: 30_000 }).mood, "patrol");
  assert.equal(brain.step({ signals: [stop("a", "ruin", { arrived: true })], now: 30_001 }).mood, "inspect");
  assert.equal(brain.step({ signals: [stop("a", "ruin", { arrived: true })], now: 31_001 }).mood, "worry");
});
