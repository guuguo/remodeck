import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { buildProjectGroups, renderSidebarThreadListHtml } from "../public/project-board.js";

const threadId = "antigravity:desktop:mobile-menu";
const nowMs = Date.now();
const groups = buildProjectGroups([{ id: threadId, provider: "antigravity", profileId: "desktop", cwd: "/tmp/menu-project", title: "手机菜单测试", updatedAt: Math.floor(nowMs / 1000) }]);

test("会话行提供独立的触屏菜单按钮，多选模式保留原选择行为", () => {
  const html = renderSidebarThreadListHtml(groups, { nowMs, autoFoldProjects: false });
  assert.match(html, /data-thread-menu="antigravity:desktop:mobile-menu" aria-label="更多操作" aria-haspopup="menu"/);
  const rowBody = html.match(/<button[^>]*data-thread-id="[^"]+"[^>]*>([\s\S]*?)<\/button>/)?.[1];
  assert.ok(rowBody);
  assert.doesNotMatch(rowBody, /<button|data-thread-menu=/);
  assert.match(rowBody, /手机菜单测试/);
  const batchHtml = renderSidebarThreadListHtml(groups, { nowMs, autoFoldProjects: false, selectionMode: true, selectedThreadIds: new Set([threadId]) });
  assert.doesNotMatch(batchHtml, /data-thread-menu=/);
  assert.match(batchHtml, /data-thread-id="antigravity:desktop:mobile-menu" aria-pressed="true"/);
});

test("点击省略号打开对应会话菜单，不切换会话；点击标题仍打开会话", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const start = source.indexOf('$("threadList").addEventListener("click", (e) => {');
  const end = source.indexOf('\n\n  bindLongPressMultiSelect($("threadList")', start);
  assert.ok(start > 0 && end > start);
  let clickHandler;
  const opened = [], selected = [];
  vm.runInNewContext(source.slice(start, end), {
    $: () => ({ addEventListener: (_type, handler) => { clickHandler = handler; } }),
    state: { batchSelect: { active: false } },
    exitSpriteOverlayForNavigation: () => {},
    openThreadContextMenu: (...args) => opened.push(args),
    selectThread: (id) => { selected.push(id); return Promise.resolve(); },
  });
  let stopped = false;
  const menu = { dataset: { threadMenu: threadId }, getBoundingClientRect: () => ({ right: 300, bottom: 440 }) };
  clickHandler({ target: { closest: (selector) => selector === "[data-thread-menu]" ? menu : null }, stopPropagation: () => { stopped = true; } });
  assert.equal(stopped, true);
  assert.deepEqual(opened, [[threadId, 300, 440]]);
  assert.deepEqual(selected, []);
  clickHandler({ target: { closest: (selector) => selector === "[data-thread-id]" ? { dataset: { threadId } } : null } });
  assert.deepEqual(selected, [threadId]);
});
