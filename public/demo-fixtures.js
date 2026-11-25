// Standalone zero-intrusion Demo Mode fixtures (?demo=1)
// Contains 100% synthetic, privacy-safe showcase data for screenshots, GIFs, and live previews.

const NOW_SEC = Math.floor(Date.now() / 1000);
const NOW_MS = Date.now();

const DEMO_PROFILES = [
  {
    key: "codex:default",
    provider: "codex",
    id: "default",
    label: "Codex Pro · 主力工位",
    accountLabel: "studio@indie-dev.io",
    installed: true,
    authenticated: true,
    health: { status: "healthy", disabled: false },
    quota: {
      status: "ok",
      windows: {
        fiveHour: { remainingPercent: 86, resetsAt: NOW_SEC + 3 * 3600 },
        weekly: { remainingPercent: 78, resetsAt: NOW_SEC + 4 * 86400 },
      },
      buckets: [{ id: "credits", windowKind: "credits", label: "配额", detail: "Plus 高速通道" }],
    },
  },
  {
    key: "claude:default",
    provider: "claude",
    id: "default",
    label: "Claude Code · 架构工位",
    accountLabel: "arch@indie-dev.io",
    installed: true,
    authenticated: true,
    health: { status: "healthy", disabled: false },
    quota: {
      status: "ok",
      windows: {
        fiveHour: { remainingPercent: 74, resetsAt: NOW_SEC + 2 * 3600 },
        weekly: { remainingPercent: 69, resetsAt: NOW_SEC + 5 * 86400 },
      },
      buckets: [],
    },
  },
  {
    key: "antigravity:desktop",
    provider: "antigravity",
    id: "desktop",
    label: "Antigravity · 全栈工位",
    accountLabel: "maker@indie-dev.io",
    installed: true,
    authenticated: true,
    health: { status: "healthy", disabled: false },
    quota: {
      status: "ok",
      windows: {
        fiveHour: { remainingPercent: 92, resetsAt: NOW_SEC + 4 * 3600 },
        weekly: { remainingPercent: 88, resetsAt: NOW_SEC + 6 * 86400 },
      },
      buckets: [],
    },
  },
];

const DEMO_MODELS = [
  { id: "gpt-5.4-codex", label: "GPT-5.4 Codex", provider: "codex" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6", provider: "claude" },
  { id: "gemini-3-pro", label: "Gemini 3 Pro", provider: "antigravity" },
];

const DEMO_THREADS = [
  {
    id: "codex:default:demo-ac-3d",
    provider: "codex",
    profileId: "default",
    cwd: "~/workspace/agent-control",
    title: "3D 梦工厂工位状态机与手机远程联动优化",
    preview: "已完成 PBR 等轴测渲染管线、5 大车间工位分配与实时光柱反馈，全部 48 项端到端单测通过。",
    firstUserText: "/goal 完成 3D 梦工厂工位状态机与手机端远程派单联动，并补齐零消耗单测",
    updatedAt: NOW_SEC - 45,
    live: true,
    pinned: true,
    pendingCount: 1,
    stage: "宣发",
    footprints: ["tycoon-3d.js", "mission-overview.js", "provider-hub.mjs"],
  },
  {
    id: "claude:default:demo-ac-relay",
    provider: "claude",
    profileId: "default",
    cwd: "~/workspace/agent-control",
    title: "自托管出站 WebSocket 隧道断线重连压测",
    preview: "正在验证手机 5G 弱网切换 Wi-Fi 时的零丢包自动续传与权限审批幂等锁…",
    updatedAt: NOW_SEC - 90,
    live: true,
    stage: "研发",
    footprints: ["remote-bridge.mjs", "relay-server.mjs"],
  },
  {
    id: "antigravity:desktop:demo-ac-voice",
    provider: "antigravity",
    profileId: "desktop",
    cwd: "~/workspace/agent-control",
    title: "车载免提语音总控：VAD 静音检测与播报队列",
    preview: "已接入本地轻量 VAD 语音唤醒，开车时可直接口述派单给空闲工位。",
    updatedAt: NOW_SEC - 220,
    live: true,
    stage: "打磨",
    footprints: ["voice-copilot.js"],
  },
  {
    id: "antigravity:desktop:demo-manga-canvas",
    provider: "antigravity",
    profileId: "desktop",
    cwd: "~/workspace/manga-lens",
    title: "生肉条漫离屏 Canvas 谐波擦字与放射刺保护",
    preview: "长条漫 1800px 切片 IoU 跨片去重完成，云端仅回传坐标 JSON，节省 96% 带宽。",
    updatedAt: NOW_SEC - 130,
    live: true,
    pinned: true,
    stage: "收菜",
    footprints: ["content.js", "bubbles.mjs"],
  },
  {
    id: "codex:default:demo-manga-cache",
    provider: "codex",
    profileId: "default",
    cwd: "~/workspace/manga-lens",
    title: "SHA-256 双层共享缓存与视口优先并发队列",
    preview: "滑出视口 1.8 屏外的在途切片自动 Abort，首屏气泡平均 0.8s 上屏。",
    updatedAt: NOW_SEC - 420,
    live: true,
    stage: "收菜",
    footprints: ["cache-and-quota.mjs"],
  },
  {
    id: "codex:default:demo-agy-i18n",
    provider: "codex",
    profileId: "default",
    cwd: "~/workspace/i18n-launcher",
    title: "macOS / Windows 双平台无损 9 国语言独立启动器",
    preview: "不修改官方签名包，生成独立中文图标与原版英文客户端零冲突并存。",
    updatedAt: NOW_SEC - 680,
    live: false,
    stage: "收菜",
    footprints: ["install.sh", "install.ps1"],
  },
  {
    id: "antigravity:desktop:demo-drama-ep08",
    provider: "antigravity",
    profileId: "desktop",
    cwd: "~/workspace/ai-anime-studio",
    title: "第 08 集《霓虹雨夜》六宫格分镜轴线锁死与生成",
    preview: "正在按 s01→s06 顺序递进生成分镜板，保持主角风衣道具与走廊光源一致…",
    updatedAt: NOW_SEC - 75,
    live: true,
    stage: "打磨",
    footprints: ["ep08-storyboard.md", "character-card.json"],
  },
  {
    id: "claude:default:demo-drama-dialogue",
    provider: "claude",
    profileId: "default",
    cwd: "~/workspace/ai-anime-studio",
    title: "第 09-12 集剧本去 AI 味台词打磨与钩子反转",
    preview: "已完成单集结尾悬念重构与人物口癖统一审查。",
    updatedAt: NOW_SEC - 510,
    live: true,
    stage: "研发",
    footprints: ["ep09-script.md"],
  },
  {
    id: "codex:default:demo-novel-engine",
    provider: "codex",
    profileId: "default",
    cwd: "~/workspace/novel-continuity",
    title: "长篇连载伏笔账本与章节事实锁 YAML 校验器",
    preview: "自动检测跨 40 章人物状态冲突与未回收伏笔。",
    updatedAt: NOW_SEC - 1500,
    live: false,
    stage: "研发",
    footprints: ["continuity-lock.mjs"],
  },
  {
    id: "antigravity:desktop:demo-global-mv",
    provider: "antigravity",
    profileId: "desktop",
    cwd: "~/workspace/overseas-video-pipeline",
    title: "Remotion 9 国语言科普宣传片自动配音与字幕对齐",
    preview: "正在批量渲染英/日/韩/西/德 60fps 成片并校验响度 -14 LUFS…",
    updatedAt: NOW_SEC - 110,
    live: true,
    stage: "宣发",
    footprints: ["render-multilang.mjs"],
  },
  {
    id: "codex:default:demo-hub-r2",
    provider: "codex",
    profileId: "default",
    cwd: "~/workspace/indie-hub",
    title: "产品矩阵落地页 Cloudflare R2 零流量费视频加速",
    preview: "已上线自适应中英双语演示流与 SEO 结构化卡片。",
    updatedAt: NOW_SEC - 960,
    live: false,
    stage: "收菜",
    footprints: ["index.html", "app.js"],
  },
  {
    id: "claude:default:demo-bounty-audit",
    provider: "claude",
    profileId: "default",
    cwd: "~/workspace/automation-cluster",
    title: "多仓库 PR 安全边界审查与零卡死回归测试守护",
    preview: "等待确认是否自动合并通过单测的 3 个重构分支…",
    updatedAt: NOW_SEC - 160,
    live: true,
    pendingCount: 1,
    stage: "打磨",
    footprints: ["bounded-runner.mjs"],
  },
  {
    id: "codex:default:demo-quant-lab",
    provider: "codex",
    profileId: "default",
    cwd: "~/workspace/quant-backtest",
    title: "多周期趋势共振因子回测与回撤风控看板",
    preview: "已完成 2020-2026 样本外滑点压力测试。",
    updatedAt: NOW_SEC - 2400,
    live: false,
    stage: "研发",
    footprints: ["backtest-engine.py"],
  },
];

const DEMO_PENDING_REQUESTS = [
  {
    id: "demo-req-1",
    threadId: "codex:default:demo-ac-3d",
    provider: "codex",
    profileId: "default",
    kind: "commandApproval",
    title: "请求执行发布前全量端到端检查",
    command: "npm run check && npm test",
    cwd: "~/workspace/agent-control",
    createdAt: NOW_MS - 35_000,
  },
  {
    id: "demo-req-2",
    threadId: "claude:default:demo-bounty-audit",
    provider: "claude",
    profileId: "default",
    kind: "commandApproval",
    title: "请求推送已通过审查的维护分支",
    command: "git push origin feat/bounded-test-guard",
    cwd: "~/workspace/automation-cluster",
    createdAt: NOW_MS - 80_000,
  },
];

function buildTopic({
  id,
  domainId,
  name,
  landmark,
  yieldType,
  yieldLabel,
  stageIndex,
  stageLabel,
  readyToHarvest = false,
  isBossPinned = false,
  primaryCwd,
  activeProviders,
  liveCount,
  pendingCount = 0,
  dirtyCount = 0,
  latestCommit,
  progress,
  nextStep,
  kpis,
  threadIds,
}) {
  const matchedThreads = DEMO_THREADS.filter((t) => threadIds.includes(t.id));
  return {
    id,
    domainId,
    name,
    landmark,
    yieldType,
    yieldLabel,
    isBossPinned,
    primaryCwd,
    activeProviders,
    liveCount,
    pendingCount,
    primaryActiveCount: matchedThreads.length + 3,
    sliceCount: 2,
    pipeline: {
      stageIndex,
      stageLabel,
      readyToHarvest,
    },
    gitSnapshot: {
      dirtyCount,
      latestCommit,
      branch: "main",
    },
    metrics: {
      kpis,
    },
    summary: {
      source: "ai",
      progress,
      nextStep,
      updatedAt: NOW_MS - 120_000,
    },
    activeThreads: matchedThreads,
    archivedThreads: [],
  };
}

function buildDemoOverview() {
  const indieTopics = [
    buildTopic({
      id: "agent-control",
      domainId: "indie-lab",
      name: "Agent Control 总控台",
      landmark: "radar",
      yieldType: "growth",
      yieldLabel: "开源核心飞轮",
      stageIndex: 4,
      stageLabel: "宣发",
      readyToHarvest: false,
      isBossPinned: true,
      primaryCwd: "~/workspace/agent-control",
      activeProviders: ["codex", "claude", "antigravity"],
      liveCount: 3,
      pendingCount: 1,
      dirtyCount: 2,
      latestCommit: "feat(3d): 新增 3D 梦工厂等轴测车间与多工位实时光柱",
      progress: "Codex、Claude 与 Antigravity 三工位正在协同打磨 3D 梦工厂、手机远程隧道与车载语音派单。",
      nextStep: "审阅并通过端到端测试审批，导出 3D 梦工厂演示动图更新开源主页",
      kpis: [
        { key: "k1", label: "GitHub Stars", value: "2.6k", delta: "+410", tone: "growth" },
        { key: "k2", label: "并发工位", value: "10 台", delta: "在线", tone: "growth" },
      ],
      threadIds: [
        "codex:default:demo-ac-3d",
        "claude:default:demo-ac-relay",
        "antigravity:desktop:demo-ac-voice",
      ],
    }),
    buildTopic({
      id: "manga-translator",
      domainId: "indie-lab",
      name: "漫译 MangaLens",
      landmark: "comic",
      yieldType: "coin",
      yieldLabel: "SaaS 订阅变现",
      stageIndex: 5,
      stageLabel: "收菜",
      readyToHarvest: true,
      isBossPinned: true,
      primaryCwd: "~/workspace/manga-lens",
      activeProviders: ["antigravity", "codex"],
      liveCount: 2,
      pendingCount: 0,
      dirtyCount: 0,
      latestCommit: "feat(canvas): 离屏谐波去字与 1800px 条漫跨片 IoU 合并",
      progress: "流式气泡嵌字与双层 SHA-256 缓存已稳定上线，日均节省 96% 图片下行带宽。",
      nextStep: "打包最新 Chrome Web Store 审核构建并查看今日渠道兑换转化",
      kpis: [
        { key: "k1", label: "活跃读者", value: "4,280", delta: "+19%", tone: "growth" },
        { key: "k2", label: "MRR 订阅", value: "$1,420", delta: "+24%", tone: "coin" },
      ],
      threadIds: [
        "antigravity:desktop:demo-manga-canvas",
        "codex:default:demo-manga-cache",
      ],
    }),
    buildTopic({
      id: "antigravity-zh",
      domainId: "indie-lab",
      name: "Antigravity 多语言启动器",
      landmark: "obelisk",
      yieldType: "growth",
      yieldLabel: "口碑引流入口",
      stageIndex: 5,
      stageLabel: "收菜",
      readyToHarvest: true,
      isBossPinned: false,
      primaryCwd: "~/workspace/i18n-launcher",
      activeProviders: ["codex"],
      liveCount: 0,
      pendingCount: 0,
      dirtyCount: 0,
      latestCommit: "feat(i18n): 支持简繁日韩德法西等 9 国语言双图标零侵入并存",
      progress: "macOS 与 Windows 一行命令脚本已覆盖 9 种语言，原版签名包零改动。",
      nextStep: "跟进新版客户端增量词条自动同步脚本",
      kpis: [
        { key: "k1", label: "累计安装", value: "6.8k", delta: "+520", tone: "growth" },
      ],
      threadIds: ["codex:default:demo-agy-i18n"],
    }),
  ];

  const dramaTopics = [
    buildTopic({
      id: "domestic-drama",
      domainId: "drama-studio",
      name: "AI 漫剧制片流水线",
      landmark: "cinema",
      yieldType: "coin",
      yieldLabel: "剧集分成收益",
      stageIndex: 3,
      stageLabel: "打磨",
      readyToHarvest: false,
      isBossPinned: true,
      primaryCwd: "~/workspace/ai-anime-studio",
      activeProviders: ["antigravity", "claude"],
      liveCount: 2,
      pendingCount: 0,
      dirtyCount: 3,
      latestCommit: "feat(ep08): 锁死雨夜走廊角色卡与六宫格镜头轴线",
      progress: "第 08 集六宫格分镜正在递进渲染，第 09-12 集活人感对白已完成去 AI 味精修。",
      nextStep: "验收第 08 集分镜连贯性后一键推送到视频合成画布",
      kpis: [
        { key: "k1", label: "在制剧集", value: "12 集", delta: "EP08渲染中", tone: "growth" },
        { key: "k2", label: "单集完播", value: "71.4%", delta: "+6.2%", tone: "coin" },
      ],
      threadIds: [
        "antigravity:desktop:demo-drama-ep08",
        "claude:default:demo-drama-dialogue",
      ],
    }),
    buildTopic({
      id: "ops-service",
      domainId: "drama-studio",
      name: "长篇设定与伏笔引擎",
      landmark: "cat",
      yieldType: "growth",
      yieldLabel: "IP 内容资产",
      stageIndex: 2,
      stageLabel: "研发",
      readyToHarvest: false,
      primaryCwd: "~/workspace/novel-continuity",
      activeProviders: ["codex"],
      liveCount: 0,
      pendingCount: 0,
      dirtyCount: 0,
      latestCommit: "feat(lock): 新增跨卷人物状态快照与未回收伏笔扫描",
      progress: "YAML 唯一事实源与章节大纲自动反向校验已跑通。",
      nextStep: "生成第 2 卷人物关系时间线视图",
      kpis: [
        { key: "k1", label: "管理字数", value: "32 万字", delta: "0 冲突", tone: "growth" },
      ],
      threadIds: ["codex:default:demo-novel-engine"],
    }),
  ];

  const globalTopics = [
    buildTopic({
      id: "overseas-media",
      domainId: "global-pub",
      name: "9 国语言出海影音矩阵",
      landmark: "youtube",
      yieldType: "growth",
      yieldLabel: "全球自然流量",
      stageIndex: 4,
      stageLabel: "宣发",
      readyToHarvest: false,
      primaryCwd: "~/workspace/overseas-video-pipeline",
      activeProviders: ["antigravity"],
      liveCount: 1,
      pendingCount: 0,
      dirtyCount: 1,
      latestCommit: "chore(render): 批量导出英日韩西德 5 语种产品动效大片",
      progress: "纯代码动效宣传片与多语种旁白正在并行渲染合成。",
      nextStep: "核对多语言字幕轴后同步分发海外频道",
      kpis: [
        { key: "k1", label: "覆盖语种", value: "9 国", delta: "全自动", tone: "growth" },
        { key: "k2", label: "海外播放", value: "148k", delta: "+31k", tone: "growth" },
      ],
      threadIds: ["antigravity:desktop:demo-global-mv"],
    }),
    buildTopic({
      id: "landing-site",
      domainId: "global-pub",
      name: "独立产品门户 Hub",
      landmark: "lighthouse",
      yieldType: "shield",
      yieldLabel: "品牌总入口",
      stageIndex: 5,
      stageLabel: "收菜",
      readyToHarvest: true,
      primaryCwd: "~/workspace/indie-hub",
      activeProviders: ["codex"],
      liveCount: 0,
      pendingCount: 0,
      dirtyCount: 0,
      latestCommit: "feat(r2): 全站产品页接入 R2 零出站费高清演示流",
      progress: "中英双语自适应切换与 R2 视频加速已 100% 切流上线。",
      nextStep: "补充 3D 梦工厂交互式在线预览入口",
      kpis: [
        { key: "k1", label: "月度访问", value: "34.2k", delta: "+28%", tone: "growth" },
      ],
      threadIds: ["codex:default:demo-hub-r2"],
    }),
  ];

  const bountyTopics = [
    buildTopic({
      id: "ai-tools-cluster",
      domainId: "bounty-guild",
      name: "自动化审查与守护集群",
      landmark: "gears",
      yieldType: "bounty",
      yieldLabel: "工程效率底座",
      stageIndex: 3,
      stageLabel: "打磨",
      readyToHarvest: false,
      primaryCwd: "~/workspace/automation-cluster",
      activeProviders: ["claude", "codex"],
      liveCount: 1,
      pendingCount: 1,
      dirtyCount: 1,
      latestCommit: "fix(guard): 强制静默超时收口并抓取泄漏监听端口",
      progress: "Claude 正在对 3 个特性分支执行最小改动集审查，等待确认推送。",
      nextStep: "手机端一键批准 git push 完成合入",
      kpis: [
        { key: "k1", label: "守护仓库", value: "14 个", delta: "0 挂起", tone: "growth" },
      ],
      threadIds: ["claude:default:demo-bounty-audit"],
    }),
    buildTopic({
      id: "stock-research",
      domainId: "bounty-guild",
      name: "量化因子回测实验室",
      landmark: "bullchart",
      yieldType: "bounty",
      yieldLabel: "策略研究沙盒",
      stageIndex: 2,
      stageLabel: "研发",
      readyToHarvest: false,
      primaryCwd: "~/workspace/quant-backtest",
      activeProviders: ["codex"],
      liveCount: 0,
      pendingCount: 0,
      dirtyCount: 0,
      latestCommit: "feat(risk): 补充极端波动率下的仓位熔断仲裁回测",
      progress: "已完成 6 年历史行情样本外回测与交易成本敏感度检验。",
      nextStep: "导出月度归因对比报告",
      kpis: [
        { key: "k1", label: "夏普比率", value: "2.18", delta: "样本外", tone: "coin" },
      ],
      threadIds: ["codex:default:demo-quant-lab"],
    }),
  ];

  const domains = [
    {
      id: "indie-lab",
      code: "ROOM 01",
      name: "软件产品研发室",
      shortName: "软件研发室",
      liveCount: 5,
      pendingCount: 1,
      harvestCount: 2,
      topics: indieTopics,
    },
    {
      id: "drama-studio",
      code: "ROOM 02",
      name: "漫剧与小说制片厂",
      shortName: "漫剧制片厂",
      liveCount: 2,
      pendingCount: 0,
      harvestCount: 0,
      topics: dramaTopics,
    },
    {
      id: "global-pub",
      code: "ROOM 03",
      name: "海外发行与基建部",
      shortName: "海外发行部",
      liveCount: 1,
      pendingCount: 0,
      harvestCount: 1,
      topics: globalTopics,
    },
    {
      id: "bounty-guild",
      code: "ROOM 04",
      name: "赏金委托与专项所",
      shortName: "赏金委托所",
      liveCount: 1,
      pendingCount: 1,
      harvestCount: 0,
      topics: bountyTopics,
    },
  ];

  const allTopics = domains.flatMap((d) => d.topics);
  // Fictional assistant examples: decision, evidenced delivery, unfinished, inference.
  const assistantExamples = [
    { name: "示例商城", type: "alert", days: 4, line: "登录回调方案等你选择 A/B" },
    { name: "绘本工坊", type: "harvest", days: 1, line: "绘本导出文件已生成，等你验收" },
    { name: "插件市场", type: "ruin", days: 8, line: "分类规则表做到一半，尚未继续" },
    { name: "记账小程序", type: null, days: 0, inferred: true },
  ];
  allTopics.forEach((topic, index) => {
    const example = assistantExamples[index];
    const type = example?.type || null;
    if (example) topic.name = example.name;
    const since = new Date(NOW_MS - (example?.days || 0) * 86400000).toISOString();
    const threadId = topic.activeThreads[0]?.id;
    const cards = type ? [{
      id: `${type}:${threadId || topic.id}`, topicId: topic.id, type,
      title: example.line, line: example.line, since, threadId,
      sources: [{ kind: "thread", label: "演示工位", threadId, topicId: topic.id, at: since }],
      actions: type === "harvest" ? ["harvest", "continue", "snooze"] : ["continue", "snooze", "park"],
    }] : [];
    topic.assistantSignals = {
      top: type,
      counts: { alert: Number(type === "alert"), harvest: Number(type === "harvest"), ruin: Number(type === "ruin") },
      ruinDays: type === "ruin" ? example.days : null,
      cards,
    };
    topic.harvestInferred = Boolean(example?.inferred);
    topic.harvestEvidence = type === "harvest" ? example.line : null;
    topic.readyToHarvest = type === "harvest";
    topic.pipeline.readyToHarvest = topic.readyToHarvest;
  });
  const liveThreads = DEMO_THREADS.filter((t) => t.live);
  const pendingThreads = DEMO_THREADS.filter((t) => (t.pendingCount || 0) > 0);

  return {
    domains,
    assistantBadges: { alert: 1, harvest: 1, ruin: 1 },
    topics: allTopics.map((tp) => ({ id: tp.id, name: tp.name, domainId: tp.domainId, primaryCwd: tp.primaryCwd, assistantSignals: tp.assistantSignals, harvestEvidence: tp.harvestEvidence, harvestInferred: tp.harvestInferred, readyToHarvest: tp.readyToHarvest })),
    bossFocus: allTopics
      .filter((tp) => tp.isBossPinned || tp.pipeline.readyToHarvest)
      .slice(0, 4)
      .map((tp) => ({
        topicId: tp.id,
        name: tp.name,
        domainId: tp.domainId,
        stageLabel: tp.pipeline.stageLabel,
        stageIndex: tp.pipeline.stageIndex,
        readyToHarvest: tp.pipeline.readyToHarvest,
        liveCount: tp.liveCount,
        pendingCount: tp.pendingCount,
        nextStep: tp.summary.nextStep,
      })),
    incubator: {
      totalActive: 4,
      chilledCount: 1,
      eggs: [
        {
          id: "egg-1",
          title: "WebGPU 浏览器本地漫画实时超分与去网点滤镜",
          freshnessTier: "hot",
          summary: "无需后端显卡开销，在客户端直接做 2x 线条锐化。",
          updatedAt: NOW_SEC - 1800,
        },
        {
          id: "egg-2",
          title: "iOS 灵动岛实时展示家中 Agent 编码进度与一键放行",
          freshnessTier: "hot",
          summary: "出门带娃时抬腕即可瞄一眼 /goal 长任务到了哪一步。",
          updatedAt: NOW_SEC - 5400,
        },
        {
          id: "egg-3",
          title: "双智能体红蓝对抗 PR 审查工作流（Codex 写 + Claude 挑刺）",
          freshnessTier: "warm",
          summary: "合并前自动互审边界条件与潜在回归风险。",
          updatedAt: NOW_SEC - 14400,
        },
        {
          id: "egg-4",
          title: "3D 梦工厂工位自定义像素宠物与收菜音效包",
          freshnessTier: "warm",
          summary: "里程碑就绪时触发清脆金币入账动效。",
          updatedAt: NOW_SEC - 28800,
        },
      ],
      chilled: [],
    },
    unassignedActive: [],
    radar: {
      liveThreads,
      pendingThreads,
      totalActiveCount: DEMO_THREADS.length,
      driftedCount: 0,
      harvestReadyCount: 3,
    },
    meta: {
      lastSummarizedAt: NOW_MS - 42_000,
      lastModelUsed: "GPT-5.4-Codex · 演示脱敏视图",
      preferredModel: "auto",
      summarizing: false,
      demoMode: true,
      modelOptions: [
        { id: "auto", label: "自动优选参谋模型" },
        { id: "gpt-5.4-codex", label: "GPT-5.4 Codex" },
        { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
      ],
    },
  };
}

let cachedOverview = null;
function getOverview() {
  if (!cachedOverview) cachedOverview = buildDemoOverview();
  return cachedOverview;
}

function buildDemoThreadDetail(compositeId) {
  const base = DEMO_THREADS.find((t) => t.id === compositeId) || DEMO_THREADS[0];
  return {
    thread: {
      ...base,
      model: base.provider === "claude" ? "claude-opus-4-6" : base.provider === "antigravity" ? "gemini-3-pro" : "gpt-5.4-codex",
      turns: [
        {
          id: `${base.id}-turn-1`,
          status: "completed",
          createdAt: NOW_SEC - 600,
          items: [
            {
              id: "u-1",
              type: "userMessage",
              text: base.firstUserText || `请推进「${base.title}」，确保边界干净并通过全量单测。`,
            },
            {
              id: "r-1",
              type: "reasoning",
              summary: [
                "先梳理 5 大 3D 车间布局坐标与工位状态映射，确保多智能体并发时标签错落不重叠，并用 Mock CLI 跑通零 Token 回归验证。",
              ],
            },
            {
              id: "c-1",
              type: "commandExecution",
              command: "npm run check && node --test tests/mission-overview.test.mjs",
              status: "completed",
              exitCode: 0,
              aggregatedOutput: "✔ MissionOverviewService groups parallel worker pods (18.4ms)\n✔ buildTycoonWorldLayout places 5 rooms & landmarks cleanly (4.2ms)\nℹ pass 12 / fail 0",
            },
            {
              id: "a-1",
              type: "agentMessage",
              text: `### 阶段汇报\n\n已完成 **${base.title}** 核心逻辑：\n- ${base.preview}\n- 所有改动保持最小侵入边界，随时可以在手机或桌面端继续派发下一步指令。`,
            },
          ],
        },
      ],
    },
    queuedTurns: [],
    nextCursor: null,
    activity: base.live
      ? {
          status: "running",
          turnId: `${base.id}-turn-live`,
          phase: "正在运行端到端验证并同步 3D 工位状态…",
          text: base.preview,
        }
      : null,
  };
}

export async function handleDemoApiRequest(rawPath, { method = "GET", body = null } = {}) {
  const clean = String(rawPath || "")
    .replace(/^https?:\/\/[^/]+/i, "")
    .replace(/^\/+/, "")
    .replace(/^apps\/ac-hot\//, "");
  const [pathname, search = ""] = clean.split("?");
  const params = new URLSearchParams(search);

  if (pathname === "api/providers") {
    return {
      ok: true,
      label: "Studio Mac Studio · 演示模式",
      defaultProvider: "codex",
      defaultProfileId: "default",
      providers: ["codex", "claude", "antigravity"],
      profiles: DEMO_PROFILES,
      cliStatus: {},
    };
  }

  if (pathname === "api/models") {
    const byProvider = {
      codex: DEMO_MODELS.filter((m) => m.provider === "codex"),
      claude: DEMO_MODELS.filter((m) => m.provider === "claude"),
      antigravity: DEMO_MODELS.filter((m) => m.provider === "antigravity"),
    };
    return { ok: true, data: DEMO_MODELS, byProvider };
  }

  if (pathname === "api/threads") {
    const archived = params.get("archived") === "1";
    return {
      ok: true,
      threads: archived ? [] : DEMO_THREADS,
      projectsMeta: {},
      warnings: [],
    };
  }

  if (pathname === "api/threads/search") {
    const q = String(params.get("q") || "").trim();
    const provider = String(params.get("provider") || "").trim();
    const archived = params.get("archived") || "0";
    const cwd = String(params.get("cwd") || "").trim();
    const limit = Math.max(1, Math.min(150, Number(params.get("limit") || 60)));
    const terms = [...new Set(q.split(/\s+/).filter(Boolean))].slice(0, 6);
    const lowerTerms = terms.map((t) => t.toLowerCase());
    const matchedThreads = [];

    if (lowerTerms.length > 0 && archived !== "1") {
      for (const item of DEMO_THREADS) {
        if (provider && provider !== "all" && item.provider !== provider) continue;
        if (cwd && item.cwd !== cwd) continue;
        const detail = buildDemoThreadDetail(item.id);
        const msgCandidates = [];
        for (const turn of detail?.thread?.turns || []) {
          for (const entry of turn?.items || []) {
            if (entry?.type === "userMessage" && entry.text) {
              msgCandidates.push({ role: "user", text: entry.text });
            } else if (entry?.type === "agentMessage" && entry.text) {
              msgCandidates.push({ role: "assistant", text: entry.text });
            }
          }
        }
        const metaHay = [item.title, item.preview, item.cwd, item.provider].join(" ").toLowerCase();
        const msgMatches = msgCandidates.filter((m) => lowerTerms.every((t) => m.text.toLowerCase().includes(t)));
        const crossMatches = msgCandidates.filter((m) => lowerTerms.some((t) => m.text.toLowerCase().includes(t)));
        const metaAny = lowerTerms.some((t) => metaHay.includes(t));
        const allSatisfied = lowerTerms.every(
          (t) => metaHay.includes(t) || msgCandidates.some((m) => m.text.toLowerCase().includes(t)),
        );
        if (!allSatisfied) continue;
        const chosen = msgMatches[0] || crossMatches[0] || null;
        let snippet = "";
        if (chosen) {
          const clean = chosen.text.replace(/\s+/g, " ").trim();
          const lowerClean = clean.toLowerCase();
          let hitIdx = -1;
          let hitLen = 0;
          for (const t of lowerTerms) {
            const idx = lowerClean.indexOf(t);
            if (idx >= 0 && (hitIdx < 0 || idx < hitIdx)) {
              hitIdx = idx;
              hitLen = t.length;
            }
          }
          if (hitIdx >= 0) {
            const start = Math.max(0, hitIdx - 24);
            const end = Math.min(clean.length, hitIdx + hitLen + 64);
            snippet = `${start > 0 ? "…" : ""}${clean.slice(start, end).trim()}${end < clean.length ? "…" : ""}`;
          }
        }
        matchedThreads.push({
          ...item,
          searchMatch: {
            matchSource: chosen ? (metaAny ? "both" : "content") : "meta",
            matchRole: chosen ? chosen.role : "",
            matchSnippet: snippet,
            matchCount: Math.max(1, msgMatches.length || crossMatches.length),
          },
        });
      }
    }

    return {
      ok: true,
      query: q,
      terms,
      threads: matchedThreads.slice(0, limit),
      indexStatus: {
        ready: true,
        indexing: false,
        indexedThreads: DEMO_THREADS.length,
        totalThreads: DEMO_THREADS.length,
      },
    };
  }

  if (pathname === "api/thread") {
    const id = params.get("id") || DEMO_THREADS[0].id;
    return { ok: true, ...buildDemoThreadDetail(id) };
  }

  if (pathname === "api/overview" || pathname === "api/overview/refresh") {
    return getOverview();
  }

  if (pathname.startsWith("api/overview/")) {
    if (pathname === "api/overview/focus" && body?.topicId) {
      const ov = getOverview();
      for (const d of ov.domains) {
        for (const tp of d.topics) {
          if (tp.id === body.topicId) tp.isBossPinned = !tp.isBossPinned;
        }
      }
    }
    return { ok: true, overview: getOverview() };
  }

  if (pathname === "api/telemetry" || pathname === "api/quotas/refresh") {
    return {
      ok: true,
      profiles: DEMO_PROFILES,
      updatedAt: NOW_MS,
    };
  }

  if (pathname === "api/executions") {
    return {
      ok: true,
      windowDays: 7,
      totals: {
        turns: 186,
        activeThreads: 9,
        totalTokens: 14_820_000,
      },
      byProvider: {
        codex: { turns: 84, totalTokens: 6_400_000 },
        claude: { turns: 52, totalTokens: 4_120_000 },
        antigravity: { turns: 50, totalTokens: 4_300_000 },
      },
    };
  }

  if (pathname === "api/cli/status") {
    return { ok: true, providers: {} };
  }

  if (pathname === "api/slash-commands") {
    return { ok: true, commands: [] };
  }

  if (method === "POST") {
    return { ok: true, overview: getOverview() };
  }

  return { ok: true };
}

export function createDemoEventSource() {
  const listeners = new Map();
  const es = {
    readyState: 1,
    url: "demo://events",
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    close() {
      es.readyState = 2;
      listeners.clear();
    },
  };

  const emit = (type, payloadObj) => {
    const fns = listeners.get(type);
    if (!fns) return;
    const ev = { type, data: payloadObj !== undefined ? JSON.stringify(payloadObj) : "" };
    for (const fn of fns) {
      try {
        fn(ev);
      } catch {}
    }
  };

  setTimeout(() => {
    if (es.readyState === 2) return;
    emit("open");
    emit("ready", {
      pendingRequests: DEMO_PENDING_REQUESTS,
      telemetry: { profiles: DEMO_PROFILES, updatedAt: Date.now() },
      remote: { enabled: true, connected: true, instanceId: "studio-demo" },
      tunnel: { active: true, publicUrl: "https://relay.example.dev/i/studio-demo/" },
    });
  }, 40);

  return es;
}
