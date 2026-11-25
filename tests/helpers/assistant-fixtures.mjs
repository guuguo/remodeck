import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { MissionOverviewService } from "../../src/mission-overview-service.mjs";
import { MemoryVault } from "../../src/memory-vault.mjs";

export const ASSISTANT_NOW = Date.parse("2026-11-25T04:00:00Z");
export function assistantThread(id, topic, ageDays, text, extra = {}) {
  return { id: `codex:default:${id}`, provider: "codex", profileId: "default", cwd: topic.primaryCwd, title: `${topic.name}导出`,
    updatedAt: (ASSISTANT_NOW - ageDays * 86400000) / 1000, live: false, pendingCount: 0, preview: "用户请求不能当作助手结论",
    turns: [{ id: `turn-${id}`, status: "completed", items: [{ type: "agentMessage", text }] }], ...extra };
}
export async function assistantFixture() {
  const dataDir = await mkdtemp(resolve(tmpdir(), "ac-assistant-"));
  let clock = ASSISTANT_NOW;
  const topics = ["示例商城", "绘本工坊", "插件市场", "记账小程序"].map((name, i) => ({
    id: `line-${i}`, name, domainId: "indie-lab", primaryCwd: `/Users/alice/projects/demo-${i}`, cwdPrefixes: [`/Users/alice/projects/demo-${i}`], keywords: [name], order: i + 1,
  }));
  await writeFile(resolve(dataDir, "mission-domains.json"), JSON.stringify({ version: 3, domains: [{ id: "indie-lab", name: "软件研发室" }], topics }));
  const threads = [
    assistantThread("A", topics[0], 4, "导出格式用 A 还是 B？"),
    assistantThread("B", topics[1], 1, "等你选择格式", { live: true, pendingCount: 1 }),
    assistantThread("C", topics[2], 0.5, "已完成导出，生成了 24 个文件，测试全部通过。"),
    assistantThread("D", topics[3], 1, "可以按分类整理账单。"),
  ];
  const sent = [], started = [], reads = [];
  const hub = {
    async listThreads() { return { threads: threads.map(({ turns, ...rest }) => rest) }; },
    listThreadsMeta() { return {}; },
    async readThread(id) { reads.push(id); return { thread: threads.find((t) => t.id === id) }; },
    async searchThreads() { return { threads: [] }; },
    async sendTurn(payload) { sent.push(payload); return { ok: true }; },
    async startThread(payload) { started.push(payload); throw new Error("问答不得创建工位"); },
  };
  const vault = new MemoryVault(resolve(dataDir, "vault"), { now: () => new Date(clock) });
  const overview = new MissionOverviewService({ hub, dataDir, env: {}, collectGitImpl: async (cwd) => ({ cwd, dirtyCount: 0, commits: ["a1b2c3d 添加导出验证 (1 day ago)"] }),
    assistantOptions: { now: () => clock, vault } });
  return { dataDir, topics, threads, hub, overview, assistant: overview.assistant, vault, sent, started, reads, setNow(value) { clock = value; } };
}
