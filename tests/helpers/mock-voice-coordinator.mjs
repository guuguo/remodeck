// Canned model responses for existing voice delivery/dispatch protocol tests.
// These fixtures deliberately do not implement language understanding.
const cases = new Map([
  ["示例商城后台现在什么进度", { intent: "summarize_progress", spokenReply: "示例商城后台的任务正在推进。" }],
  ["刚才没听清，再说一遍", { intent: "repeat_last", replyFrom: "last" }],
  ["让 示例商城后台 跑一下构建", { intent: "send_turn", targetName: "示例商城后台", instruction: "跑一下构建" }],
  ["在示例商城后台新开一个任务排查连接", { intent: "create_thread", targetName: "示例商城后台", instruction: "排查连接", provider: "antigravity" }],
  ["用 hydrogen 让示例商城后台跑一下检查", { intent: "send_turn", targetName: "示例商城后台", instruction: "跑一下检查", model: "gemini-4-hydrogen-low" }],
  ["在示例商城后台新开一个协调者 carbon 任务做深度审计", { intent: "create_thread", targetName: "示例商城后台", instruction: "做深度审计", provider: "antigravity", model: "gemini-pro-orchestrator" }],
  ["嗯", { intent: "no_speech" }],
  ["谢谢观看", { intent: "no_speech" }],
  ["先把窗帘拉上吧", { intent: "no_speech" }],
  ["让 示例商城后台 顺便把单测补全", { intent: "send_turn", targetName: "示例商城后台", instruction: "顺便把单测补全", dispatchMode: "queue" }],
  ["别等了，直接出结果", { intent: "send_turn", targetName: "示例商城后台", instruction: "直接出结果", dispatchMode: "immediate" }],
  ["让 示例商城后台 停止等待，直接汇报结论", { intent: "send_turn", targetName: "示例商城后台", instruction: "直接汇报结论", dispatchMode: "immediate" }],
  ["帮我详细梳理一下这两个项目目前阻塞点和风险清单", { intent: "subagent_hydrogen" }],
  ["帮我深入分析一下这两个任务的优先级", { intent: "subagent_hydrogen" }],
  ["让 示例商城后台 检查一下首页样式", { intent: "send_turn", targetName: "示例商城后台", instruction: "检查一下首页样式" }],
  ["让 Agent Control 检查一下断线重连逻辑", { intent: "send_turn", targetName: "Agent Control", instruction: "检查一下断线重连逻辑" }],
  ["刚才那两个任务结果怎么样", { intent: "summarize_progress", replyFrom: "results" }],
  ["帮我深入分析一下示例商城后台最近的报错原因", { intent: "subagent_hydrogen", targetName: "示例商城后台" }],
  ["让示例商城跑一下检查", { intent: "send_turn", targetName: "示例商城后台", instruction: "跑一下检查" }],
  ["让 示例商城后台 跑一下检查", { intent: "send_turn", targetName: "示例商城后台", instruction: "跑一下检查" }],
  ["你好", { intent: "wake_ping", spokenReply: "我在，请讲。" }],
]);

export function mockVoiceCoordinatorResponse(prompt, snapshot) {
  const transcript = prompt.split("用户补充输入：")[1] || "";
  const canned = cases.get(transcript);
  if (!canned) return null;
  const { targetName, replyFrom, ...fields } = canned;
  const project = targetName ? snapshot.projects?.find((p) => p.name === targetName || p.alias === targetName) : null;
  let spokenReply = fields.intent === "no_speech" ? "" : (fields.spokenReply || `好的，正在处理${targetName || "你的请求"}。`);
  if (replyFrom === "results") spokenReply = (snapshot.completedResults || []).map((r) => r.lastResultSummary).join("；");
  if (replyFrom === "last") {
    const lastJson = prompt.match(/<LAST_REPLY>\n([\s\S]*?)\n<\/LAST_REPLY>/)?.[1];
    spokenReply = JSON.parse(lastJson || "null")?.text || "还没有播报记录。";
  }
  return { heardText: transcript, instruction: transcript, dispatchMode: "queue",
    targetProjectCwd: project?.cwd || "",
    targetThreadId: fields.intent === "create_thread" ? "" : (project?.threads?.[0]?.id || ""),
    ...fields, spokenReply,
  };
}
