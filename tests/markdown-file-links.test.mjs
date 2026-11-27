import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { renderMarkdown } from "../public/markdown.js";

const threadId = "codex:default:preview-test";
const basePath = "story-demo/小说/目录.md";

test("文档内链接以当前文件为基准，表格、列表、引用与折叠块保留同一基准", () => {
  const link = "[第25章](正文/025-示例.md#L3)";
  for (const source of [link, `# ${link}`, `- ${link}`, `> ${link}`, `> [!NOTE]\n> ${link}`, `<details>\n<summary>目录</summary>\n${link}\n</details>`, `| 章 | 正文 |\n|---|---|\n|025|${link}|`]) {
    const html = renderMarkdown(source, { threadId, basePath });
    assert.match(html, /data-local-file-path="story-demo\/小说\/正文\/025-示例.md"/);
    assert.match(html, /data-local-file-line="3"/);
  }
  const html = renderMarkdown("[脚本](../脚本/ep14.md)\n\n![插图](图片/插图.png)\n\n`正文/025-示例.md`", { threadId, basePath });
  assert.match(html, /data-local-file-path="story-demo\/小说\/..\/脚本\/ep14.md"/);
  assert.match(html, /path=story-demo%2F%E5%B0%8F%E8%AF%B4%2F%E5%9B%BE%E7%89%87%2F/);
  assert.match(html, /data-local-file-path="story-demo\/小说\/正文\/025-示例.md"/);
  const windows = renderMarkdown("[正文](正文/025.md)", { basePath: "C:\\books\\小说\\目录.md" });
  assert.match(windows, /data-local-file-path="C:\\books\\小说\\正文\/025.md"/);
});

test("普通对话、绝对路径、file URL、网页链接与锚点保持原语义", () => {
  const plain = renderMarkdown("[正文](正文/025.md)", { threadId });
  assert.match(plain, /data-local-file-path="正文\/025.md"/);
  const source = "[绝对](/Volumes/资料/章.md) [文件](file:///tmp/chapter.md#L2) [网页](https://example.com/doc.md) [定位](#chapter)";
  assert.equal(renderMarkdown(source, { threadId, basePath }), renderMarkdown(source, { threadId }));
  assert.match(renderMarkdown("[正文](正文/025.md)", { threadId, basePath: "目录.md" }), /data-local-file-path="正文\/025.md"/);
});

test("预览使用服务端解析出的实际目录，二次点击沿用新文档所在目录", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const bodyFunction = source.slice(source.indexOf("function renderFilePreviewBody("), source.indexOf("\nasync function openFilePreviewModal("));
  const bodyEl = { innerHTML: "" };
  const meta = { kind: "markdown", content: "[正文](正文/025.md)", displayPath: basePath, requestPath: "目录.md" };
  const context = { $: () => bodyEl, renderMarkdown, scheduleMermaidHydration: () => {} };
  vm.runInNewContext(bodyFunction + '\nrenderFilePreviewBody(meta, { threadId });', { ...context, meta, threadId });
  assert.match(bodyEl.innerHTML, /data-local-file-path="story-demo\/小说\/正文\/025.md"/);
  const chapterMeta = { kind: "markdown", content: "[下章](026.md)", displayPath: "story-demo/小说/正文/025.md" };
  vm.runInNewContext(bodyFunction + '\nrenderFilePreviewBody(meta, { threadId });', { ...context, meta: chapterMeta, threadId });
  assert.match(bodyEl.innerHTML, /data-local-file-path="story-demo\/小说\/正文\/026.md"/);
});
