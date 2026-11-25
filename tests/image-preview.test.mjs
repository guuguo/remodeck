import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { autoPreviewThreadImages } from "../public/image-preview-policy.js";
import { cleanClipboardTextForPastedImages, stripAttachedImagePaths } from "../public/image-attachment.js";
import { CodexProvider } from "../src/providers/codex-provider.mjs";
import { readLargeThreadPreview } from "../src/providers/codex-large-preview.mjs";
import { recoverCodexImagePreview } from "../src/providers/codex-image-preview.mjs";
import { createAgentControlServer } from "../src/server.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const dataUrl = `data:image/png;base64,${png.toString("base64")}`;
const record = (content) => ({ type: "response_item", payload: { type: "message", role: "user", content } });
const imageParts = (path, url = dataUrl) => [
  { type: "input_text", text: `<image name=[Image #1] path="${path}">` },
  { type: "input_image", image_url: url },
  { type: "input_text", text: "</image>" },
];

test("成功附加的图片路径不占正文，保留说明、其他文件和网络链接", () => {
  const file = { name: "abc.jpg" };
  assert.equal(stripAttachedImagePaths("工单\n/Users/a/abc.jpg 多人反馈工作台无数据", [file]), "工单\n多人反馈工作台无数据");
  assert.equal(stripAttachedImagePaths('看 "/Users/a/My Pictures/abc.jpg" 这张图', [file]), "看 这张图");
  assert.equal(stripAttachedImagePaths("D:\\微信图片\\abc.jpg 多人反馈", [file]), "多人反馈");
  const unchanged = "\n  保留缩进\nhttps://example.com/abc.jpg\n/Users/a/other.jpg 参考图片 abc.jpg\n";
  assert.equal(stripAttachedImagePaths(unchanged, [file]), unchanged);
  assert.equal(stripAttachedImagePaths("/Users/a/abc.jpg 出错", []), "/Users/a/abc.jpg 出错");

  // 含空格目录（如 Application Support、Data SSD）及 shell 转义空格、file:// URI
  const larkName = "img_v3_0217n_48cfee6f-a633-45ad-93fb-23f66296aa7g.jpg";
  const larkPath = `/Users/alice/Library/Application Support/LarkShell/sdk_storage/0123456789abcdef0123456789abcdef/resources/images/${larkName}`;
  assert.equal(stripAttachedImagePaths(larkPath, [{ name: larkName }]), "");
  assert.equal(stripAttachedImagePaths(`看下这个问题 ${larkPath} 怎么回事`, [{ name: larkName }]), "看下这个问题 怎么回事");

  const spaceFile = { name: "测试 截图.png" };
  assert.equal(stripAttachedImagePaths("看 /Volumes/Data SSD/dev/测试 截图.png 这张图", [spaceFile]), "看 这张图");
  assert.equal(stripAttachedImagePaths("看 /Users/alice/Application\\ Support/LarkShell/测试\\ 截图.png 这张图", [spaceFile]), "看 这张图");
  assert.equal(stripAttachedImagePaths("file:///Users/a/My%20Docs/%E6%B5%8B%E8%AF%95%20%E6%88%AA%E5%9B%BE.png 说明", [spaceFile]), "说明");
  assert.equal(stripAttachedImagePaths("file://localhost/Users/a/My Docs/测试 截图.png 说明", [spaceFile]), "说明");

  // 同行多路径/网址不跨路径误吞
  assert.equal(
    stripAttachedImagePaths("请对比 /Users/a/other.jpg 和 /Users/a/My Pictures/abc.jpg 这张图", [file]),
    "请对比 /Users/a/other.jpg 和 这张图",
  );
  const localAndHttps = "/Users/a/other.jpg 线上 https://example.com/abc.jpg";
  assert.equal(stripAttachedImagePaths(localAndHttps, [file]), localAndHttps);

  // 较长非匹配路径无性能退化
  const longNonMatching = `/Users/a/${"sub dir/".repeat(80)}other_file.txt 说明 ${"word ".repeat(80)}abc.jpg`;
  const startedAt = performance.now();
  assert.equal(stripAttachedImagePaths(longNonMatching, [file]), longNonMatching);
  assert.ok(performance.now() - startedAt < 50);
});

test("粘贴图片时同步清理剪贴板附带的本地路径与裸文件名，同时保留混合正文与无关链接", async () => {
  const larkPath = "/Users/alice/Library/Application Support/LarkShell/sdk_storage/0123456789abcdef0123456789abcdef/resources/images/img_v3_0217n_48cfee6f-a633-45ad-93fb-23f66296aa7g.jpg";

  // 飞书单图复制：真实文件名匹配 & 浏览器合成名 image.png
  assert.equal(cleanClipboardTextForPastedImages({
    plainText: larkPath,
    imageFiles: [{ name: "img_v3_0217n_48cfee6f-a633-45ad-93fb-23f66296aa7g.jpg" }],
  }), "");
  assert.equal(cleanClipboardTextForPastedImages({
    plainText: larkPath,
    imageFiles: [{ name: "image.png" }],
  }), "");

  // Finder 单图/多图复制：text/plain 为裸文件名
  assert.equal(cleanClipboardTextForPastedImages({
    plainText: "Screenshot 2026-11-23.png",
    imageFiles: [{ name: "Screenshot 2026-11-23.png" }],
  }), "");
  assert.equal(cleanClipboardTextForPastedImages({
    plainText: "a.png\nb.jpg",
    imageFiles: [{ name: "a.png" }, { name: "b.jpg" }],
  }), "");

  // 飞书混合消息：真实文件名、HTML <img> + 合成名、仅合成名三种情况
  const mixedText = `接口报错如下\n${larkPath}\n请帮忙排查`;
  assert.equal(cleanClipboardTextForPastedImages({
    plainText: mixedText,
    imageFiles: [{ name: "img_v3_0217n_48cfee6f-a633-45ad-93fb-23f66296aa7g.jpg" }],
  }), "接口报错如下\n请帮忙排查");
  assert.equal(cleanClipboardTextForPastedImages({
    plainText: mixedText,
    html: `<meta charset='utf-8'><span>接口报错如下</span><img src="file://${encodeURI(larkPath)}"><span>请帮忙排查</span>`,
    imageFiles: [{ name: "image.png" }],
  }), "接口报错如下\n请帮忙排查");
  assert.equal(cleanClipboardTextForPastedImages({
    plainText: mixedText,
    imageFiles: [{ name: "image.png" }],
  }), "接口报错如下\n请帮忙排查");

  // 独立路径行位于首行、中间行、末行时移除空行，但保留原有的空行结构
  assert.equal(cleanClipboardTextForPastedImages({
    plainText: `${larkPath}\n第一段\n\n第二段`,
    imageFiles: [{ name: "image.png" }],
  }), "第一段\n\n第二段");
  assert.equal(cleanClipboardTextForPastedImages({
    plainText: `第一段\n\n第二段\n${larkPath}`,
    imageFiles: [{ name: "image.png" }],
  }), "第一段\n\n第二段");

  // 不误删网络链接、非图片文件、普通文本里的图片名
  const safeMixed = "参考 https://example.com/abc.jpg 与 /Users/a/report.pdf 和 /Users/a/foo.txt 说明 abc.jpg";
  assert.equal(cleanClipboardTextForPastedImages({
    plainText: safeMixed,
    imageFiles: [{ name: "image.png" }],
  }), safeMixed);

  // 纯正常正文 + 粘贴图片时返回完全相等的原文
  const pureBody = "第一行说明\r\n\r\n  保持缩进与换行";
  assert.equal(cleanClipboardTextForPastedImages({
    plainText: pureBody,
    imageFiles: [{ name: "image.png" }],
  }), pureBody);

  // 验证 app.js paste 监听已接入同步清理并在变更或清空时阻止默认粘贴
  const appSource = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const pasteIdx = appSource.indexOf('$("promptInput").addEventListener("paste"');
  assert.ok(pasteIdx >= 0);
  const pasteBlock = appSource.slice(pasteIdx, pasteIdx + 1200);
  assert.match(pasteBlock, /cleanClipboardTextForPastedImages\(/);
  assert.match(pasteBlock, /if\s*\(!cleanedText\s*\|\|\s*cleanedText\s*!==\s*plainText\)\s*\{\s*e\.preventDefault\(\);/);
});

test("自动预览观察可见附件卡，隐藏的图片节点不会阻断加载", async () => {
  const source = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
  const code = source.slice(source.indexOf("function deferredImageObservationTarget("), source.indexOf("function captureViewportAnchor("));
  const observed = [], loaded = [];
  let callback;
  const img = { dataset: { lazySrc: "./api/thread/image?test" }, closest: () => card };
  const card = { querySelector: () => img };
  const root = { querySelectorAll: () => [img] };
  vm.runInNewContext(`let deferredImageObserver = null, deferredObserveRafId = 0; ${code}\nscheduleDeferredImagesObservation(root);`, {
    root, $: () => root,
    syncThreadImagesUnlockedClass() {}, hydrateRevealedDeferredImages() {},
    isThreadImagesUnlocked: () => true,
    requestAnimationFrame: (fn) => { fn(); return 1; },
    revealedDeferredImageSrcs: new Set(),
    activateDeferredImage: (target) => loaded.push(target),
    IntersectionObserver: class { constructor(fn) { callback = fn; } observe(target) { observed.push(target); } },
  });
  assert.deepEqual(observed, [card]);
  callback([{ target: card, isIntersecting: false, intersectionRatio: 0 }]);
  assert.deepEqual(loaded, []);
  callback([{ target: card, isIntersecting: true, intersectionRatio: 1 }]);
  assert.deepEqual(loaded, [img]);
});

test("电脑本机及手机局域网默认预览；公网中继保留按需加载", () => {
  for (const hostname of ["localhost", "127.0.0.1", "[::1]", "192.168.1.8", "10.1.2.3", "172.16.0.1", "172.31.255.254", "macbook.local"]) {
    assert.equal(autoPreviewThreadImages({ hostname, finePointer: true }), true, hostname);
    assert.equal(autoPreviewThreadImages({ hostname, finePointer: false }), true, `触屏 ${hostname}`);
  }
  for (const hostname of ["relay.example.com", "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.1.8", "192.168.300.1"]) {
    assert.equal(autoPreviewThreadImages({ hostname, finePointer: true }), false, hostname);
    assert.equal(autoPreviewThreadImages({ hostname, finePointer: false }), false, `触屏 ${hostname}`);
  }
});

test("Codex 临时图片丢失后通过原图片 API 恢复，保留历史体积、权限和现存文件优先级", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-img-recovery-"));
  const home = resolve(root, "codex"), workspace = resolve(root, "project"), dataDir = resolve(root, "data");
  await Promise.all([home, workspace].map((dir) => mkdir(dir, { recursive: true })));
  const rolloutPath = resolve(home, "rollout.jsonl");
  const missingPath = resolve(os.tmpdir(), `codex-clipboard-${root.split("/").at(-1)}.png`);
  const currentPath = resolve(workspace, "current.png");
  await writeFile(currentPath, png);
  const records = [
    { timestamp: "2026-11-18T01:00:00Z", type: "event_msg", payload: { type: "task_started", turn_id: "turn-image" } },
    { ...record([...imageParts("other.png", "data:image/png;base64,aW52YWxpZA=="), ...imageParts(missingPath), { type: "input_text", text: "看图" }]), timestamp: "2026-11-18T01:00:01Z" },
    { timestamp: "2026-11-18T01:00:01Z", type: "event_msg", payload: { type: "item_completed", item: { type: "UserMessage", content: [{ type: "local_image", path: missingPath }, { type: "text", text: "看图" }] } } },
    record(imageParts("current.png", "data:image/png;base64,aW52YWxpZA==")),
    { timestamp: "2026-11-18T01:00:02Z", type: "event_msg", payload: { type: "task_complete", turn_id: "turn-image" } },
  ];
  const originalRollout = records.map((r) => JSON.stringify(r)).join("\n") + "\n";
  await writeFile(rolloutPath, originalRollout);
  const db = new DatabaseSync(resolve(home, "state_5.sqlite"));
  db.exec(`CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, created_at INTEGER, updated_at INTEGER, source TEXT, model_provider TEXT, cwd TEXT, title TEXT, archived INTEGER, first_user_message TEXT, model TEXT, reasoning_effort TEXT, thread_source TEXT, preview TEXT, name TEXT, git_sha TEXT, git_branch TEXT, git_origin_url TEXT)`);
  db.prepare("INSERT INTO threads (id,rollout_path,created_at,updated_at,source,model_provider,cwd,title,archived,first_user_message,model,reasoning_effort,thread_source,preview,name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("image-thread", rolloutPath, 1700000000, 1700000001, "vscode", "openai", workspace, "图片预览", 0, "看图", "gpt-6.1-sol", "medium", "user", "看图", "");
  db.close();
  const provider = new CodexProvider({ env: { ...process.env, HOME: root, USERPROFILE: root, CODEX_BIN: fileURLToPath(new URL("./helpers/mock-codex-cli.mjs", import.meta.url)), AGENT_CONTROL_CODEX_HOMES: JSON.stringify([{ id: "default", home }]) } });
  const server = await createAgentControlServer({ port: 0, dataDir, providers: [provider], disableRelay: true, disableTunnel: true, disableUpdateCheck: true, env: { ...process.env, HOME: root, AGENT_CONTROL_DISABLE_AUTOMATIONS: "1" } });
  t.after(async () => { await server.close(); await rm(root, { recursive: true, force: true }); });
  await server.start();
  const urlFor = (path, extra = {}) => `${server.url}/api/thread/image?${new URLSearchParams({ threadId: "codex:default:image-thread", path, ...extra })}`;
  const recovered = await fetch(urlFor(missingPath));
  assert.equal(recovered.status, 200);
  assert.match(recovered.headers.get("content-type"), /image\/png/);
  assert.deepEqual(Buffer.from(await recovered.arrayBuffer()), png);
  const head = await fetch(urlFor(missingPath, { raw: "1" }), { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(Number(head.headers.get("content-length")), png.length);
  assert.equal(await head.text(), "");
  const cached = await fetch(urlFor(missingPath), { headers: { "If-None-Match": recovered.headers.get("etag") } });
  assert.equal(cached.status, 304);
  assert.equal((await fetch(urlFor(currentPath))).status, 200);
  assert.equal((await fetch(urlFor("other.png"))).status, 404, "无效内嵌图不得作为图片返回");
  assert.equal((await fetch(urlFor("unknown.png"))).status, 404, "没有对应转录的图片仍返回不存在");
  assert.equal((await fetch(urlFor("../outside.png"))).status, 403);
  assert.equal((await fetch(urlFor(resolve(root, "outside.png")))).status, 403);
  assert.equal((await fetch(urlFor(resolve(workspace, ".env.png")))).status, 403);
  const preview = await readLargeThreadPreview(rolloutPath, { limit: 10 });
  assert.doesNotMatch(JSON.stringify(preview), /data:image/);
  assert.equal(await readFile(rolloutPath, "utf8"), originalRollout);
  await assert.rejects(stat(missingPath), { code: "ENOENT" });
  // 恢复结果只写控制台缓存；不改 Codex 转录，也不重建系统临时附件。
});

test("恢复图片按同一 wrapper 配对，不借用助手图、其他附件或超限数据", async (t) => {
  const root = await mkdtemp(resolve(os.tmpdir(), "ac-img-pair-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rolloutPath = resolve(root, "rollout.jsonl");
  const args = { rolloutPath, cwd: root, cacheDir: resolve(root, "cache"), maxBytes: 1024 };
  await writeFile(rolloutPath, [
    record(imageParts("a.png", "data:image/png;base64,aW52YWxpZA==")),
    record(imageParts("b.png")),
    { type: "response_item", payload: { type: "message", role: "assistant", content: imageParts("assistant.png") } },
  ].map(JSON.stringify).join("\n"));
  assert.equal(await recoverCodexImagePreview({ ...args, targetPath: resolve(root, "a.png") }), null);
  assert.equal(await recoverCodexImagePreview({ ...args, targetPath: resolve(root, "assistant.png") }), null);
  assert.equal(await recoverCodexImagePreview({ ...args, targetPath: resolve(root, "b.png"), maxBytes: 8 }), null);
  const recovered = await recoverCodexImagePreview({ ...args, targetPath: resolve(root, "b.png") });
  assert.deepEqual(await readFile(recovered.filePath), png);
});
