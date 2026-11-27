import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderMessageCopyButton } from "../public/markdown.js";
import {
  buildClientTaskTree,
  findTaskForThread,
  renderTaskStripHtml,
  renderTaskTreeModalHtml,
  shouldShowTaskStrip,
} from "../public/task-tree.js";

function extractTopLevelCssRule(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `Expected top-level CSS rule for ${selector}`);
  return match[1];
}

test("task-tree visibility stays hidden for unpinned single sessions and renders strip for tasks/drafts", () => {
  assert.equal(shouldShowTaskStrip({ task: null, draftContext: null }), false);

  const task = {
    id: "tk_root",
    parentId: "",
    title: "登录优化 <script>",
    status: "open",
    threadIds: ["codex:default:a", "claude:default:b"],
    planRef: { threadId: "codex:default:a", turnId: "t1", turnIndex: 0 },
    childCount: 1,
    childDoneCount: 0,
  };
  assert.equal(shouldShowTaskStrip({ task }), true);

  const stripHtml = renderTaskStripHtml({
    task,
    ancestors: [{ id: "tk_top", title: "认证总览" }],
    siblingThreads: [
      { id: "codex:default:a", title: "规划会话", provider: "codex", live: true },
      { id: "claude:default:b", title: "实现会话", provider: "claude", live: false },
    ],
    activeThreadId: "claude:default:b",
  });
  assert.doesNotMatch(stripHtml, /<script>/);
  assert.match(stripHtml, /认证总览 › 登录优化 &lt;script&gt;/);
  assert.match(stripHtml, /data-task-jump-plan="tk_root"/);
  assert.match(stripHtml, /data-task-new-sibling="tk_root"/);
  assert.match(stripHtml, /data-task-new-child="tk_root"/);

  const draftHtml = renderTaskStripHtml({
    draftContext: { mode: "child", taskTitle: "子任务草稿", sourceThreadId: "codex:default:a" },
    liveCwdWarning: "兄弟会话「规划会话」正在同目录运行",
  });
  assert.match(draftHtml, /新建子任务会话/);
  assert.match(draftHtml, /正在同目录运行/);
});

test("renderTaskTreeModalHtml renders hierarchical indented tree, logs, and escapes HTML", () => {
  const tasks = [
    { id: "tk_1", parentId: "", title: "根任务", goal: "主目标", status: "open", threadIds: ["codex:default:a"], criteria: ["测试通过"], updatedAt: "2026-11-26T01:00:00Z" },
    { id: "tk_2", parentId: "tk_1", title: "子任务 <img onerror=alert(1)>", goal: "", status: "done", threadIds: ["claude:default:b"], updatedAt: "2026-11-26T02:00:00Z" },
  ];
  const annotated = buildClientTaskTree(tasks).flatMap((r) => [r, ...(r.children || [])]);
  assert.equal(findTaskForThread(tasks, "codex:default:a").id, "tk_1");

  const html = renderTaskTreeModalHtml({
    tasks: annotated,
    selectedTaskId: "tk_1",
    detailLogs: [{ ts: "2026-11-26T02:10:00Z", kind: "agent_log", text: "完成接口开发 <ok>" }],
    threadsById: new Map([["codex:default:a", { id: "codex:default:a", title: "主规划", live: false }]]),
    statusFilter: "all",
  });
  assert.doesNotMatch(html, /<img onerror/);
  assert.match(html, /padding-left:24px/);
  assert.match(html, /完成接口开发 &lt;ok&gt;/);
  assert.match(html, /data-task-new-child="tk_1"/);
});

test("renderMessageCopyButton renders pin-plan button only when allowPinPlan=true", () => {
  const userHtml = renderMessageCopyButton("hello", { forkTurnIndex: 0, forkTurnId: "t1", allowPinPlan: false });
  assert.doesNotMatch(userHtml, /data-pin-plan-turn-index/);
  const agentHtml = renderMessageCopyButton("plan", { forkTurnIndex: 2, forkTurnId: "t3", allowPinPlan: true });
  assert.match(agentHtml, /data-pin-plan-turn-index="2"/);
  assert.match(agentHtml, /data-pin-plan-turn-id="t3"/);
});

test("modal dialog architecture sizes shell to card without left clipping across all modals", async () => {
  const [appCss, html] = await Promise.all([
    readFile(new URL("../public/app.css", import.meta.url), "utf8"),
    readFile(new URL("../public/index.html", import.meta.url), "utf8"),
  ]);

  const modalDialogRule = extractTopLevelCssRule(appCss, ".modal-dialog");
  assert.match(modalDialogRule, /--modal-max-width:\s*460px;/);
  assert.match(modalDialogRule, /width:\s*fit-content;/);
  assert.match(modalDialogRule, /overflow:\s*visible;/);
  assert.match(modalDialogRule, /max-width:\s*min\(var\(--modal-viewport-max-w\),\s*calc\(100%\s*-\s*var\(--modal-gutter\)\)\);/);
  assert.doesNotMatch(modalDialogRule, /(^|[^-])max-width:\s*\d+px;/m);

  const modalCardRule = extractTopLevelCssRule(appCss, ".modal-card");
  assert.match(modalCardRule, /width:\s*min\(var\(--modal-max-width,\s*460px\),/);
  assert.match(modalCardRule, /max-width:\s*min\(100%,\s*var\(--modal-viewport-max-w,/);

  const wideModalSelectors = [
    [appCss, ".modal-dialog.tasks-modal", 920],
    [appCss, "#updateModal.modal-dialog", 640],
    [appCss, "#automationsModal.modal-dialog", 680],
    [appCss, ".modal-dialog.instance-manager-modal", 640],
  ];
  for (const [cssText, selector, expectedPx] of wideModalSelectors) {
    const rule = extractTopLevelCssRule(cssText, selector);
    assert.match(rule, new RegExp(`--modal-max-width:\\s*${expectedPx}px;`), `${selector} must declare --modal-max-width`);
    assert.doesNotMatch(rule, /(^|[^-])max-width\s*:/m, `${selector} must not override dialog max-width directly`);
  }

  const tasksCardRule = extractTopLevelCssRule(appCss, ".tasks-modal-card");
  assert.doesNotMatch(tasksCardRule, /(^|\n)\s*width\s*:/m, ".tasks-modal-card should inherit width from .modal-card + --modal-max-width");
  assert.match(extractTopLevelCssRule(appCss, ".task-modal-tree-pane"), /min-width:\s*0;/);
  assert.match(extractTopLevelCssRule(appCss, ".task-modal-detail-pane"), /min-width:\s*0;/);
  assert.match(extractTopLevelCssRule(appCss, ".tasks-modal-body"), /overflow-x:\s*hidden;/);
  assert.match(appCss, /--text-primary:\s*#e8eef7;/);

  const dialogOpenMatches = [...html.matchAll(/<dialog\b([^>]*)>/g)];
  const dialogCloseMatches = [...html.matchAll(/<\/dialog>/g)];
  assert.equal(dialogOpenMatches.length, dialogCloseMatches.length, "All <dialog> tags in index.html must be closed");
  assert.ok(dialogOpenMatches.length >= 9);
  for (const m of dialogOpenMatches) {
    assert.match(m[1], /\bclass="[^"]*\bmodal-dialog\b/, `<dialog ${m[1]}> must carry modal-dialog class`);
  }
  assert.match(
    html,
    /<dialog id="tasksModal" class="modal-dialog tasks-modal"[^>]*>\s*<div class="modal-card tasks-modal-card">/,
  );
});
