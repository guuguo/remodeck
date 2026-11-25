import assert from "node:assert/strict";
import test from "node:test";
import { extractSelectDescriptor, renderCustomSelectMenuHtml, renderCustomSelectTriggerInnerHtml } from "../public/custom-select.js";
import {
  ensurePreferredModelInList,
  pickDefaultModelForProvider,
  resolveAntigravityModelSelection,
} from "../public/instance-switcher.js";

test("composer compact labels preserve selected values and full dropdown information", () => {
  for (const [id, value, full, compact] of [
    ["permissionSelect", "turbo", "Turbo（自动批准）", "Turbo"],
    ["permissionSelect", "workspace", "工作区读写", "工作区"],
    ["modelSelect", "gemini-4-carbon-high", "Gemini 4 Carbon (High)", "Carbon H"],
    ["modelSelect", "gemini-4-hydrogen", "Gemini 4 Hydrogen", "Hydrogen"],
    ["modelSelect", "gemini-4-argon", "Gemini 4 Argon", "Argon"],
    ["modelSelect", "claude-opus-5-5", "Claude Opus 5.5", "Opus 5.5"],
    ["effortSelect", "high", "高思考", "高思考"],
  ]) {
    const descriptor = extractSelectDescriptor({ id, value, options: [{ value, textContent: full }] });
    assert.equal(descriptor.value, value);
    assert.equal(descriptor.selectedLabel, full);
    assert.equal(descriptor.triggerLabel, compact);
    assert.ok(renderCustomSelectTriggerInnerHtml(descriptor).includes(`>${compact}<`));
    assert.ok(renderCustomSelectMenuHtml(descriptor).includes(full));
  }

  assert.deepEqual(resolveAntigravityModelSelection("gemini-4-hydrogen-medium"), {
    baseModel: "gemini-4-hydrogen",
    effort: "medium",
  });
  const mergedAgyModels = [
    { id: "gemini-pro-orchestrator", model: "gemini-pro-orchestrator", baseModel: "gemini-pro-orchestrator", provider: "antigravity" },
    { id: "gemini-4-hydrogen", model: "gemini-4-hydrogen", baseModel: "gemini-4-hydrogen", provider: "antigravity" },
  ];
  const dedupedList = ensurePreferredModelInList(mergedAgyModels, "antigravity", "gemini-4-hydrogen-medium");
  assert.equal(dedupedList.length, 2);
  assert.equal(pickDefaultModelForProvider(dedupedList, "antigravity", "gemini-4-hydrogen-medium")?.id, "gemini-4-hydrogen");
});

test("composer profile trigger uses account label while menu retains health and quota details", () => {
  const descriptor = extractSelectDescriptor({
    id: "composerProfileSelect",
    value: "work",
    options: [{ value: "work", textContent: "Codex · guuguo自用 · alice@qq.com · 可用 · 周95%", dataset: { compactLabel: "guuguo自用" } }],
  });
  assert.equal(descriptor.triggerLabel, "guuguo自用");
  const trigger = renderCustomSelectTriggerInnerHtml(descriptor);
  assert.match(trigger, /guuguo自用/);
  assert.doesNotMatch(trigger, /Codex|qq.com|周95%/);
  assert.match(renderCustomSelectMenuHtml(descriptor), /Codex · guuguo自用 · alice@qq.com · 可用 · 周95%/);
});
