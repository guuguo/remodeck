import { t } from "./i18n.js";
import { iconSvg, providerIconSvg } from "./icons.js";
import { escapeHtml } from "./markdown.js";
import { formatCompactRelativeTime, projectBaseName } from "./project-board.js";
import { LANDMARK_BADGE_LABELS, ROOM_BLUEPRINTS, computeStudioProgression, partitionRoomTopicsForSlots, readTycoonVisualPrefs } from "./tycoon-3d.js";

const DEFAULT_STAGES = [
  { index: 1, label: "立项" },
  { index: 2, label: "研发" },
  { index: 3, label: "打磨" },
  { index: 4, label: "宣发" },
  { index: 5, label: "收菜" },
];

function formatSummaryAge(tsMs) {
  const ts = Number(tsMs) || 0;
  if (!ts) return "待首次盘点";
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "刚刚盘点";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m 前盘点`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h 前盘点`;
  return `${Math.floor(diffSec / 86400)}d 前盘点`;
}

function stageClassSuffix(stage = "") {
  if (/宣传片|动效/.test(stage)) return "is-media";
  if (/出海/.test(stage)) return "is-overseas";
  if (/商业化|推广/.test(stage)) return "is-biz";
  if (/排查/.test(stage)) return "is-support";
  if (/内容/.test(stage)) return "is-content";
  return "is-dev";
}

function domainThemeClass(domainId = "", idx = 0) {
  if (domainId === "indie-lab" || domainId === "creative-products") return "theme-cyan";
  if (domainId === "drama-studio" || domainId === "drama-overseas") return "theme-violet";
  if (domainId === "global-pub") return "theme-amber";
  if (domainId === "bounty-guild" || domainId === "work-support" || domainId === "special-projects") return "theme-emerald";
  return ["theme-cyan", "theme-violet", "theme-amber", "theme-emerald"][idx % 4];
}

function yieldBadgeMeta(yieldType = "growth", yieldLabel = "") {
  if (yieldType === "coin") {
    return { cls: "is-coin", icon: "coin", text: yieldLabel || "直接金币变现" };
  }
  if (yieldType === "shield") {
    return { cls: "is-shield", icon: "shield", text: yieldLabel || "出海护航底座" };
  }
  if (yieldType === "bounty") {
    return { cls: "is-bounty", icon: "compass", text: yieldLabel || "委托稳底盘" };
  }
  return { cls: "is-growth", icon: "rocket", text: yieldLabel || "涨粉引流飞轮" };
}

function renderWorkerSpriteGroupSvg(provider = "codex", x = 0, y = 0, { working = false, idx = 0 } = {}) {
  const palette = provider === "claude"
    ? { body: "#f59e0b", visor: "#fef3c7", glow: "#fbbf24" }
    : provider === "antigravity"
      ? { body: "#a78bfa", visor: "#ede9fe", glow: "#c4b5fd" }
      : { body: "#34d399", visor: "#d1fae5", glow: "#6ee7b7" };
  const animClass = working ? `mo-svg-worker is-working delay-${idx % 3}` : "mo-svg-worker is-idle";
  return `
    <g class="${animClass}" transform="translate(${x}, ${y})">
      <rect x="-11" y="7" width="22" height="4" rx="1.5" fill="rgba(148,163,184,0.28)" />
      <rect x="-7" y="-1" width="14" height="8.5" rx="3" fill="${palette.body}" opacity="0.92" />
      <circle cx="0" cy="-7" r="5.5" fill="${palette.body}" />
      <rect x="-3.8" y="-9" width="7.6" height="3.2" rx="1.4" fill="${palette.visor}" />
      ${working ? `
        <rect x="-8" y="3.5" width="16" height="3.5" rx="1" fill="${palette.glow}" class="mo-svg-screen-glow" />
        <circle cx="-8" cy="-12" r="1.3" fill="${palette.glow}" class="mo-svg-spark s1" />
        <circle cx="8" cy="-13" r="1.1" fill="#fde047" class="mo-svg-spark s2" />
      ` : ""}
    </g>
  `;
}

function renderStudioFloorplanHtml(domains = [], incubator = {}, { domainFilter = "all" } = {}) {
  const byId = Object.fromEntries(domains.map((d) => [d.id, d]));
  const rooms = [
    {
      id: domains[0]?.id || "indie-lab",
      title: byId["indie-lab"]?.shortName || domains[0]?.name?.slice(0, 6) || "软件研发室",
      code: "LAB 01",
      x: 10, y: 10, w: 178, h: 112,
      stroke: "#38bdf8",
      fill: "rgba(56, 189, 248, 0.09)",
      data: byId["indie-lab"] || domains[0] || {},
    },
    {
      id: domains[1]?.id || "drama-studio",
      title: byId["drama-studio"]?.shortName || domains[1]?.name?.slice(0, 6) || "漫剧制片厂",
      code: "STUDIO 02",
      x: 196, y: 10, w: 174, h: 112,
      stroke: "#a855f7",
      fill: "rgba(168, 85, 247, 0.09)",
      data: byId["drama-studio"] || domains[1] || {},
    },
    {
      id: domains[2]?.id || "global-pub",
      title: byId["global-pub"]?.shortName || domains[2]?.name?.slice(0, 6) || "海外发行部",
      code: "GLOBAL 03",
      x: 10, y: 130, w: 120, h: 108,
      stroke: "#f59e0b",
      fill: "rgba(245, 158, 11, 0.09)",
      data: byId["global-pub"] || domains[2] || {},
    },
    {
      id: domains[3]?.id || "bounty-guild",
      title: byId["bounty-guild"]?.shortName || domains[3]?.name?.slice(0, 6) || "赏金委托所",
      code: "GUILD 04",
      x: 138, y: 130, w: 122, h: 108,
      stroke: "#10b981",
      fill: "rgba(16, 185, 129, 0.09)",
      data: byId["bounty-guild"] || domains[3] || {},
    },
  ];

  const eggCount = Number(incubator?.totalActive) || (incubator?.eggs?.length || 0);
  const hotEggCount = (incubator?.eggs || []).filter((e) => e.freshnessTier === "hot").length;

  const roomsSvg = rooms.map((r) => {
    const isSelected = domainFilter === r.id;
    const liveCount = Number(r.data?.liveCount) || 0;
    const pendingCount = Number(r.data?.pendingCount) || 0;
    const harvestCount = Number(r.data?.harvestCount) || 0;
    const topicCount = (r.data?.topics || []).reduce((s, tp) => s + (tp.primaryActiveCount ?? tp.activeThreads?.length ?? 0), 0);
    const sprites = Array.isArray(r.data?.sprites) && r.data.sprites.length ? r.data.sprites : ["codex"];
    const maxSprites = r.w > 150 ? 3 : 2;
    const shownSprites = sprites.slice(0, maxSprites);
    const startX = r.x + Math.round(r.w / (shownSprites.length + 1));
    const stepX = Math.round(r.w / (shownSprites.length + 1));
    const workerY = r.y + r.h - 28;

    return `
      <g
        class="mo-svg-room ${isSelected ? "is-selected" : ""} ${liveCount > 0 ? "is-live" : ""}"
        data-mo-domain-filter="${escapeHtml(r.id)}"
        role="button"
        tabindex="0"
        aria-label="筛选部门：${escapeHtml(r.title)}"
      >
        <rect
          x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="10"
          fill="${r.fill}"
          stroke="${isSelected ? "#ffffff" : r.stroke}"
          stroke-width="${isSelected ? "2" : "1.25"}"
        />
        <text x="${r.x + 10}" y="${r.y + 19}" class="mo-svg-room-code" fill="${r.stroke}">${escapeHtml(r.code)}</text>
        <text x="${r.x + 10}" y="${r.y + 36}" class="mo-svg-room-title">${escapeHtml(r.title)}</text>
        <text x="${r.x + 10}" y="${r.y + 51}" class="mo-svg-room-meta">${(r.data?.topics || []).length} 项目 · ${topicCount} 工位${liveCount > 0 ? ` · ${liveCount} 运转` : ""}</text>

        ${shownSprites.map((prov, idx) => renderWorkerSpriteGroupSvg(prov, startX + idx * stepX, workerY, {
          working: liveCount > 0 && idx < liveCount,
          idx,
        })).join("")}

        ${harvestCount > 0 ? `
          <g class="mo-svg-badge-coin" transform="translate(${r.x + r.w - 22}, ${r.y + 20})">
            <circle cx="0" cy="0" r="9.5" fill="#f59e0b" />
            <circle cx="0" cy="0" r="7.5" fill="none" stroke="#fef3c7" stroke-width="1" />
            <text x="0" y="3.5" text-anchor="middle" class="mo-svg-badge-txt">$</text>
          </g>
        ` : ""}

        ${pendingCount > 0 ? `
          <g class="mo-svg-badge-alert" transform="translate(${r.x + r.w - (harvestCount > 0 ? 44 : 22)}, ${r.y + 20})">
            <rect x="-9" y="-9" width="18" height="18" rx="5" fill="#ef4444" />
            <text x="0" y="4" text-anchor="middle" class="mo-svg-badge-txt">!</text>
          </g>
        ` : ""}
      </g>
    `;
  }).join("");

  const incubatorSelected = domainFilter === "incubator";
  const incubatorRoomSvg = `
    <g
      class="mo-svg-room is-incubator ${incubatorSelected ? "is-selected" : ""}"
      data-mo-focus-incubator="1"
      role="button"
      tabindex="0"
      aria-label="查看灵感孵化室"
    >
      <rect
        x="268" y="130" width="102" height="108" rx="10"
        fill="rgba(251, 191, 36, 0.1)"
        stroke="${incubatorSelected ? "#ffffff" : "#fbbf24"}"
        stroke-width="${incubatorSelected ? "2" : "1.25"}"
        stroke-dasharray="4 2"
      />
      <text x="278" y="149" class="mo-svg-room-code" fill="#fbbf24">IDEA LAB</text>
      <text x="278" y="166" class="mo-svg-room-title">灵感孵化室</text>
      <text x="278" y="181" class="mo-svg-room-meta">${eggCount} 枚火种</text>
      <g class="mo-svg-egg ${hotEggCount > 0 ? "is-hot" : ""}" transform="translate(319, 212)">
        <ellipse cx="0" cy="7" rx="16" ry="4" fill="rgba(251, 191, 36, 0.24)" />
        <path d="M0 -15 C-9 -15 -13 -4 -13 4 A13 13 0 0 0 13 4 C13 -4 9 -15 0 -15 Z" fill="#fde68a" stroke="#f59e0b" stroke-width="1.5" />
        <path d="M-7 1 L-2 -3 L2 2 L7 -3" fill="none" stroke="#b45309" stroke-width="1.3" stroke-linecap="round" />
      </g>
    </g>
  `;

  return `
    <div class="mo-tycoon-panel mo-floorplan-card">
      <div class="mo-panel-head">
        <div class="mo-panel-title-row">
          <span class="mo-panel-icon is-cyan">${iconSvg("layers", { size: 14 })}</span>
          <strong>梦工厂工位沙盘</strong>
          <span class="mo-panel-tag">${domainFilter === "all" ? "点击房间过滤" : "已锁定房间"}</span>
        </div>
        ${domainFilter !== "all" ? `
          <button type="button" class="mo-mini-link-btn" data-mo-domain-filter="all">查看全厂</button>
        ` : ""}
      </div>
      <div class="mo-floorplan-wrap">
        <svg class="mo-floorplan-svg" viewBox="0 0 380 248" fill="none" aria-label="AI 梦工厂工位沙盘平面图">
          ${roomsSvg}
          ${incubatorRoomSvg}
        </svg>
      </div>
      <div class="mo-floorplan-legend">
        <span><i class="mo-leg-dot is-work"></i>敲码运转</span>
        <span><i class="mo-leg-dot is-coin"></i>$ 准收菜产线</span>
        <span><i class="mo-leg-dot is-alert"></i>! 待老板拍板</span>
      </div>
    </div>
  `;
}

function renderPipelineMeterHtml(pipeline = {}, stages = DEFAULT_STAGES, { compact = false } = {}) {
  const current = Math.max(1, Math.min(5, Number(pipeline?.stageIndex) || 1));
  const ready = Boolean(pipeline?.readyToHarvest);
  return `
    <div class="mo-pipeline-track ${compact ? "is-compact" : ""} ${ready ? "is-harvest-ready" : ""}" title="产线阶段：${escapeHtml(pipeline?.stageLabel || "研发")}">
      ${stages.map((st) => {
        const stateCls = st.index < current ? "is-done" : (st.index === current ? "is-current" : "is-todo");
        return `
          <div class="mo-pipe-step ${stateCls}">
            <span class="mo-pipe-node">${st.index}</span>
            <span class="mo-pipe-label">${escapeHtml(st.label)}</span>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderBossFocusHtml(bossFocus = [], stages = DEFAULT_STAGES) {
  return `
    <div class="mo-tycoon-panel mo-focus-card">
      <div class="mo-panel-head">
        <div class="mo-panel-title-row">
          <span class="mo-panel-icon is-gold">${iconSvg("crown", { size: 14 })}</span>
          <strong>老板今日主攻 · 临门一脚收菜台</strong>
        </div>
        <span class="mo-panel-hint">离变现/涨粉最近 Top 3</span>
      </div>
      ${bossFocus.length ? `
        <div class="mo-focus-list">
          ${bossFocus.map((item, idx) => {
            const ym = yieldBadgeMeta(item.yieldType, item.yieldLabel);
            return `
              <div class="mo-focus-item ${item.readyToHarvest ? "is-harvest" : ""}">
                <div class="mo-focus-top">
                  <div class="mo-focus-name-group">
                    <span class="mo-focus-rank">0${idx + 1}</span>
                    <button type="button" class="mo-focus-jump-btn" data-mo-scroll-topic="${escapeHtml(item.topicId)}">
                      <strong>${escapeHtml(item.name)}</strong>
                    </button>
                    <span class="mo-yield-chip ${ym.cls}">${iconSvg(ym.icon, { size: 11 })} ${escapeHtml(ym.text)}</span>
                    ${item.readyToHarvest ? `<span class="mo-harvest-pill">准收菜</span>` : ""}
                  </div>
                  <button
                    type="button"
                    class="mo-pin-focus-btn ${item.isBossPinned ? "is-pinned" : ""}"
                    data-mo-toggle-focus="${escapeHtml(item.topicId)}"
                    title="${item.isBossPinned ? "取消老板钦点锁定" : "钦点锁定到今日主攻台"}"
                  >${iconSvg(item.isBossPinned ? "star-filled" : "star", { size: 12 })}</button>
                </div>
                ${renderPipelineMeterHtml({ stageIndex: item.stageIndex, stageLabel: item.stageLabel, readyToHarvest: item.readyToHarvest }, stages, { compact: true })}
                <div class="mo-focus-bottom">
                  <span class="mo-focus-bottleneck" title="${escapeHtml(item.bottleneck)}">${escapeHtml(item.bottleneck)}</span>
                  <button
                    type="button"
                    class="mo-focus-dispatch-btn"
                    data-mo-quick-dispatch-topic="${escapeHtml(item.topicId)}"
                    data-mo-quick-dispatch-text="${escapeHtml(item.nextStep)}"
                    title="由厂长自动匹配干净工位或新开并发分身推进此步"
                  >${iconSvg("bolt", { size: 11 })}<span>派单推进</span></button>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      ` : `
        <div class="mo-panel-empty">暂无活跃产线，可在上方派单台直接布置今日目标</div>
      `}
    </div>
  `;
}

function renderIncubatorHtml(incubator = {}, { showChilled = false, allTopics = [] } = {}) {
  const eggs = Array.isArray(incubator?.eggs) ? incubator.eggs : [];
  const chilled = Array.isArray(incubator?.chilled) ? incubator.chilled : [];
  const chilledCount = Number(incubator?.chilledCount) || chilled.length;

  return `
    <div class="mo-tycoon-panel mo-incubator-card" id="moIncubatorPanel">
      <div class="mo-panel-head">
        <div class="mo-panel-title-row">
          <span class="mo-panel-icon is-amber">${iconSvg("egg", { size: 14 })}</span>
          <strong>灵感孵化箱</strong>
          <span class="mo-panel-tag is-amber">防遗忘昨天的灵光</span>
        </div>
        ${chilledCount > 0 ? `
          <button type="button" class="mo-mini-link-btn" data-mo-toggle-chilled="1">
            ${iconSvg("snowflake", { size: 11 })} ${showChilled ? "收起冷库" : `冷库 (${chilledCount})`}
          </button>
        ` : ""}
      </div>

      <form id="moSparkForm" class="mo-spark-form">
        <input
          id="moSparkInput"
          type="text"
          class="mo-spark-input"
          maxlength="140"
          placeholder="闪过一个新点子？1 秒记下防明天忘掉…"
        />
        <select id="moSparkTopicSelect" class="mo-spark-topic-select" aria-label="关联产线">
          <option value="">自动归类</option>
          ${allTopics.map((tp) => `<option value="${escapeHtml(tp.id)}">${escapeHtml(tp.name)}</option>`).join("")}
        </select>
        <button type="submit" class="mo-spark-submit-btn">${iconSvg("plus", { size: 12 })}<span>入箱</span></button>
      </form>

      ${eggs.length ? `
        <div class="mo-egg-list">
          ${eggs.slice(0, 4).map((egg) => `
            <div class="mo-egg-item is-${escapeHtml(egg.freshnessTier || "warm")}">
              <div class="mo-egg-main">
                <div class="mo-egg-badges">
                  <span class="mo-fresh-badge is-${escapeHtml(egg.freshnessTier || "warm")}">
                    ${iconSvg(egg.freshnessTier === "hot" ? "flame" : "egg", { size: 10 })}
                    ${escapeHtml(egg.freshnessLabel || "待孵化")}
                  </span>
                  <span class="mo-egg-topic">${escapeHtml(egg.topicName || "独立新物种")}</span>
                </div>
                <div class="mo-egg-title">${escapeHtml(egg.title)}</div>
                <div class="mo-egg-pitch">${escapeHtml(egg.pitch || "")}</div>
              </div>
              <div class="mo-egg-actions">
                ${egg.threadId ? `
                  <button
                    type="button"
                    class="mo-egg-btn is-open"
                    data-board-open-thread="${escapeHtml(egg.threadId)}"
                    title="打开当时的灵感原对话"
                  >原对话</button>
                ` : ""}
                <button
                  type="button"
                  class="mo-egg-btn is-hatch"
                  data-mo-hatch-spark="${escapeHtml(egg.id)}"
                  data-mo-hatch-topic="${escapeHtml(egg.topicId || "")}"
                  data-mo-hatch-title="${escapeHtml(egg.title)}"
                  title="破壳派工：分配干净工位落地这个灵感"
                >${iconSvg("rocket", { size: 10 })}<span>破壳</span></button>
                <button
                  type="button"
                  class="mo-egg-btn is-chill"
                  data-mo-spark-action="chill"
                  data-mo-spark-id="${escapeHtml(egg.id)}"
                  title="暂时不做，放进冷库不占视线"
                >${iconSvg("snowflake", { size: 11 })}</button>
              </div>
            </div>
          `).join("")}
        </div>
      ` : `
        <div class="mo-panel-empty">孵化箱干净无积压 · 昨天的灵光会话也会自动打捞到这里</div>
      `}

      ${showChilled && chilled.length ? `
        <div class="mo-chilled-drawer">
          <div class="mo-chilled-title">${iconSvg("snowflake", { size: 11 })} 冷库暂存（不干扰日常主线）</div>
          ${chilled.map((egg) => `
            <div class="mo-chilled-row">
              <span class="mo-chilled-text">${escapeHtml(egg.title)}</span>
              <div class="mo-chilled-btns">
                <button type="button" class="mo-mini-link-btn" data-mo-spark-action="wake" data-mo-spark-id="${escapeHtml(egg.id)}">回温</button>
                <button type="button" class="mo-mini-link-btn is-danger" data-mo-spark-action="delete" data-mo-spark-id="${escapeHtml(egg.id)}">移除</button>
              </div>
            </div>
          `).join("")}
        </div>
      ` : ""}
    </div>
  `;
}

export function renderBoardViewSwitchHtml(active = "tycoon3d") {
  const isList = active !== "tycoon3d";
  return `
    <div class="mo-view-switch" role="tablist" aria-label="面板视图切换">
      <button type="button" class="mo-view-tab ${!isList ? "is-active" : ""}" data-board-view-mode="tycoon3d" aria-selected="${!isList}">3D 梦工厂</button>
      <button type="button" class="mo-view-tab ${isList ? "is-active" : ""}" data-board-view-mode="list" aria-selected="${isList}">列表</button>
    </div>
    ${isList ? `
      <div class="mo-view-subswitch" role="tablist" aria-label="列表分组方式">
        <button type="button" class="mo-subview-tab ${active === "overview" ? "is-active" : ""}" data-board-view-mode="overview" aria-selected="${active === "overview"}">按产线</button>
        <button type="button" class="mo-subview-tab ${active === "folders" ? "is-active" : ""}" data-board-view-mode="folders" aria-selected="${active === "folders"}">按目录</button>
      </div>
    ` : ""}
  `;
}

function renderRefreshControlHtml({ modelOptions = [], preferredModel = "auto", summarizing = false, meta = {}, btnClass = "mo-ctrl-btn" } = {}) {
  const current = modelOptions.find((o) => o.key === preferredModel);
  const currentLabel = !current || current.key === "auto" ? "自动优选" : current.label;
  return `
    <div class="mo-refresh-split">
      <button type="button" class="${btnClass}" data-mo-action="refresh" ${summarizing ? "disabled" : ""} title="AI 盘点各产线进度（${escapeHtml(formatSummaryAge(meta.lastSummarizedAt))}，模型：${escapeHtml(currentLabel)}）">
        ${iconSvg("refresh", { size: 13 })}<span>${summarizing ? "盘点中" : "盘点"}</span>
      </button>
      ${modelOptions.length ? `
        <details class="mo-refresh-menu">
          <summary class="${btnClass} is-icon-only" title="设置盘点用的模型" aria-label="设置盘点用的模型">${iconSvg("chevron-down", { size: 12 })}</summary>
          <div class="mo-refresh-pop">
            <span class="mo-refresh-pop-title">盘点用的模型</span>
            <select id="overviewModelSelect" class="mo-model-select" aria-label="盘点模型">
              ${modelOptions.map((opt) => `
                <option value="${escapeHtml(opt.key)}" ${opt.key === preferredModel ? "selected" : ""}>${escapeHtml(opt.key === "auto" ? "自动优选" : opt.label)}</option>
              `).join("")}
            </select>
            <span class="mo-refresh-pop-hint">只影响「盘点」总结进度，和派工用哪个账号无关</span>
          </div>
        </details>
      ` : ""}
    </div>
  `;
}

function renderDispatchAgentControlsHtml({
  agentOptions = [],
  dispatchAgentKey = "auto",
  autoResolvedLabel = "",
  modelOptions = [],
  dispatchModel = "",
  dispatchPrefs = null,
} = {}) {
  const groups = new Map();
  for (const opt of agentOptions) {
    const g = opt.providerLabel || opt.provider || "Agent";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(opt);
  }
  const autoText = autoResolvedLabel ? `账号：自动 → ${autoResolvedLabel}` : "账号：自动（自适应优选）";
  const isAuto = !dispatchAgentKey || dispatchAgentKey === "auto";
  const strategy = String(dispatchPrefs?.strategy || "adaptive");
  const currentOrder = Array.isArray(dispatchPrefs?.providerOrder) && dispatchPrefs.providerOrder.length
    ? dispatchPrefs.providerOrder.join(",")
    : "antigravity,claude,codex,grok";
  const orderPresets = [
    { value: "antigravity,claude,codex,grok", label: "顺序：Agy → Claude → Codex" },
    { value: "claude,antigravity,codex,grok", label: "顺序：Claude → Agy → Codex" },
    { value: "codex,claude,antigravity,grok", label: "顺序：Codex → Claude → Agy" },
    { value: "grok,antigravity,claude,codex", label: "顺序：Grok → Agy → Claude" },
  ];
  return `
    <select id="moDispatchPrioritySelect" class="mo-dispatch-select is-priority" aria-label="自动派工优先级" title="切换自动派工的选号优先级策略">
      <option value="adaptive" ${strategy === "adaptive" ? "selected" : ""}>优先：自适应（额度+常用）</option>
      <option value="quota" ${strategy === "quota" ? "selected" : ""}>优先：剩余额度最多</option>
      <option value="recent" ${strategy === "recent" ? "selected" : ""}>优先：近期最常用</option>
      <option value="provider" ${strategy === "provider" ? "selected" : ""}>优先：按智能体顺序</option>
    </select>
    ${strategy === "provider" ? `
      <select id="moDispatchProviderOrderSelect" class="mo-dispatch-select is-order" aria-label="智能体顺序" title="自定义智能体优先级顺序">
        ${orderPresets.map((p) => `<option value="${p.value}" ${currentOrder === p.value ? "selected" : ""}>${p.label}</option>`).join("")}
      </select>
    ` : ""}
    <select id="moDispatchAgentSelect" class="mo-dispatch-select is-agent" aria-label="派给哪个 AI 账号" title="${escapeHtml(isAuto ? autoText : "已手动指定账号，会记住为该产线的默认账号")}">
      <option value="auto" ${isAuto ? "selected" : ""}>${escapeHtml(autoText)}</option>
      ${[...groups.entries()].map(([gLabel, items]) => `
        <optgroup label="${escapeHtml(gLabel)}">
          ${items.map((o) => `<option value="${escapeHtml(o.key)}" ${o.key === dispatchAgentKey ? "selected" : ""}>${escapeHtml(o.excluded ? `${o.label}（默认跳过）` : o.label)}</option>`).join("")}
        </optgroup>
      `).join("")}
    </select>
    <select id="moDispatchModelSelect" class="mo-dispatch-select is-model" aria-label="模型" ${isAuto ? "disabled" : ""} title="${isAuto ? "自动模式按任务难度自动匹配强/快模型；先指定账号可固定模型" : "选择该账号使用的模型"}">
      <option value="" ${!dispatchModel ? "selected" : ""}>${isAuto ? "模型：按难度自适应" : "模型：账号默认"}</option>
      ${modelOptions.map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === dispatchModel ? "selected" : ""}>${escapeHtml(m.label)}</option>`).join("")}
    </select>
  `;
}

function renderRouteAgentHtml(rt = {}) {
  if (!rt.agentLabel) return "";
  const modelText = rt.model ? ` · ${rt.model}${rt.effort ? ` (${rt.effort})` : ""}` : "";
  const hint = [rt.taskDifficultyLabel, rt.agentReason || rt.agentSourceLabel].filter(Boolean).join(" · ");
  return `<span class="mo-route-agent" title="${escapeHtml(hint)}">${escapeHtml(rt.agentLabel)}${escapeHtml(modelText)}${hint ? `<small>${escapeHtml(hint)}</small>` : ""}</span>`;
}

function renderSmartDispatcherBarHtml({
  allTopics = [],
  dispatchDraft = "",
  dispatchTopicId = "",
  dispatchMode = "auto",
  dispatchInheritContext = true,
  dispatchBusy = false,
  dispatchPreview = null,
  lastDispatchReceipt = null,
  driftedCount = 0,
  dispatchAgent = {},
} = {}) {
  const routes = Array.isArray(dispatchPreview?.routes) ? dispatchPreview.routes : [];
  const receipts = Array.isArray(lastDispatchReceipt?.dispatched) ? lastDispatchReceipt.dispatched : [];

  return `
    <section class="mo-dispatcher-bar" aria-label="厂长智能派单与会话分流台">
      <form id="moDispatchForm" class="mo-dispatch-form">
        <div class="mo-dispatch-lead">
          <span class="mo-dispatch-badge">${iconSvg("split", { size: 13 })}<span>智能会话分发台</span></span>
          <span class="mo-dispatch-tip">
            自动匹配空闲干净工位；遇运行中或串项目脏会话<strong>自动新开并发分身</strong>并锁死产线归属
            ${driftedCount > 0 ? ` · 已自动切片找回 <strong>${driftedCount}</strong> 条跨项目混杂会话` : ""}
          </span>
        </div>

        <div class="mo-dispatch-controls">
          <select id="moDispatchTopicSelect" class="mo-dispatch-select" aria-label="目标产线">
            <option value="" ${!dispatchTopicId ? "selected" : ""}>自动识别产线（支持多项目分号拆单）</option>
            ${allTopics.map((tp) => `
              <option value="${escapeHtml(tp.id)}" ${tp.id === dispatchTopicId ? "selected" : ""}>定向：${escapeHtml(tp.name)}</option>
            `).join("")}
          </select>

          <select id="moDispatchModeSelect" class="mo-dispatch-select is-mode" aria-label="工位分配策略">
            <option value="auto" ${dispatchMode !== "new" ? "selected" : ""}>优先空闲干净工位 / 忙时自动开分身</option>
            <option value="new" ${dispatchMode === "new" ? "selected" : ""}>强制新开独立并发工位</option>
          </select>

          <label class="mo-inherit-toggle" title="新开并发分身时自动注入该产线的历史归档记忆摘要（复用已有工位时不重复注入）">
            <input id="moDispatchInheritCheck" type="checkbox" ${dispatchInheritContext !== false ? "checked" : ""} />
            <span>新工位继承归档记忆</span>
          </label>

          ${renderDispatchAgentControlsHtml(dispatchAgent)}

          <div class="mo-dispatch-input-wrap">
            <input
              id="moDispatchInput"
              type="text"
              class="mo-dispatch-input"
              value="${escapeHtml(dispatchDraft)}"
              placeholder="直接输入要做的事（例如：给登录页补错误提示；检查官网 SEO 收录）…"
              ${dispatchBusy ? "disabled" : ""}
            />
          </div>

          <button
            type="button"
            class="mo-ctrl-btn mo-dispatch-preview-btn"
            data-mo-action="preview-dispatch"
            ${dispatchBusy ? "disabled" : ""}
            title="先看厂长准备分发到哪个会话或新开哪个分身"
          >预览路由</button>

          <button
            type="submit"
            class="btn-primary btn-sm mo-dispatch-submit-btn"
            ${dispatchBusy ? "disabled" : ""}
          >${iconSvg("send", { size: 12 })}<span>${dispatchBusy ? "派工中…" : "智能派工"}</span></button>
        </div>
      </form>

      ${routes.length ? `
        <div class="mo-dispatch-feedback is-preview">
          <div class="mo-dispatch-fb-head">
            <strong>路由预览（共拆分为 ${routes.length} 个独立工单，确认无误点「智能派工」立即执行）：</strong>
            <button type="button" class="mo-mini-link-btn" data-mo-action="clear-dispatch-feedback">收起</button>
          </div>
          <div class="mo-dispatch-route-list">
            ${routes.map((rt) => `
              <div class="mo-dispatch-route-row">
                <span class="mo-route-act ${rt.action === "reuse_clean" ? "is-reuse" : "is-spawn"}">
                  ${rt.action === "reuse_clean" ? "复用干净工位" : "新开并发分身"}
                </span>
                <strong class="mo-route-topic">${escapeHtml(rt.topicName)}</strong>
                ${rt.willInheritContext ? `<span class="mo-inherit-pill" title="${escapeHtml(rt.contextSummaryPreview || "")}">继承归档记忆</span>` : ""}
                <span class="mo-route-task">「${escapeHtml(rt.segmentText)}」</span>
                ${renderRouteAgentHtml(rt)}
                <span class="mo-route-reason">${escapeHtml(rt.reason)}</span>
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}

      ${!routes.length && receipts.length ? `
        <div class="mo-dispatch-feedback is-receipt">
          <div class="mo-dispatch-fb-head">
            <strong>已精准派发 ${receipts.length} 个工单（产线已锁定，告别乱串）：</strong>
            <button type="button" class="mo-mini-link-btn" data-mo-action="clear-dispatch-feedback">知道了</button>
          </div>
          <div class="mo-dispatch-route-list">
            ${receipts.map((rc) => `
              <div class="mo-dispatch-route-row">
                <span class="mo-route-act ${rc.action === "reuse_clean" ? "is-reuse" : "is-spawn"}">
                  ${rc.action === "reuse_clean" ? "已续接干净工位" : "已开并发新分身"}
                </span>
                <strong class="mo-route-topic">${escapeHtml(rc.topicName)}</strong>
                ${renderRouteAgentHtml(rc)}
                <span class="mo-route-reason">${escapeHtml(rc.reason)}</span>
                ${rc.threadId ? `
                  <button type="button" class="mo-route-open-btn" data-board-open-thread="${escapeHtml(rc.threadId)}">
                    直达工位 →
                  </button>
                ` : ""}
              </div>
            `).join("")}
          </div>
        </div>
      ` : ""}
    </section>
  `;
}

function isThreadRecentUnreadDone(thread, recentCompletedByThread = null) {
  if (!thread?.id || thread.live || (thread.pendingCount || 0) > 0) return false;
  return Boolean(recentCompletedByThread?.has?.(thread.id));
}

function collectRecentCompletedThreads(overview, recentCompletedByThread = null) {
  if (!recentCompletedByThread?.size) return [];
  const seen = new Set();
  const list = [];
  const domains = Array.isArray(overview?.domains) ? overview.domains : [];
  for (const d of domains) {
    for (const tp of d.topics || []) {
      for (const t of tp.activeThreads || []) {
        if (!t?.id || seen.has(t.id) || !isThreadRecentUnreadDone(t, recentCompletedByThread)) continue;
        seen.add(t.id);
        const entry = recentCompletedByThread.get(t.id);
        list.push({
          ...t,
          ownerTopicName: tp.name,
          ownerTopicId: tp.id,
          recentAt: Number(entry?.at) || (Number(t.updatedAt) || 0) * 1000,
        });
      }
    }
  }
  for (const t of overview?.unassignedActive || []) {
    if (!t?.id || seen.has(t.id) || !isThreadRecentUnreadDone(t, recentCompletedByThread)) continue;
    seen.add(t.id);
    const entry = recentCompletedByThread.get(t.id);
    list.push({
      ...t,
      ownerTopicName: "待归类",
      ownerTopicId: "",
      recentAt: Number(entry?.at) || (Number(t.updatedAt) || 0) * 1000,
    });
  }
  list.sort((a, b) => (b.recentAt || 0) - (a.recentAt || 0));
  return list;
}

function renderOverviewThreadRowHtml(thread, {
  activeThreadId = "",
  allTopics = [],
  assignOpenThreadId = "",
  recentCompletedByThread = null,
  allowInduct = false,
} = {}) {
  const isSelected = thread.id === activeThreadId;
  const stage = thread.stage || "研发";
  const stageCls = stageClassSuffix(stage);
  const timeText = formatCompactRelativeTime(thread.updatedAt);
  const isRecentDone = isThreadRecentUnreadDone(thread, recentCompletedByThread);
  const sourceLabel = !thread.isSlice && thread.isCrossWorkspace && thread.cwd ? projectBaseName(thread.cwd) : "";
  const footprints = Array.isArray(thread.footprints) ? thread.footprints.slice(0, 2) : [];

  const statusChips = [];
  if (thread.isSlice && thread.sliceFromTopicName) {
    statusChips.push(`<span class="mo-slice-pill" title="该会话最新标题已漂移至「${escapeHtml(thread.sliceFromTopicName)}」，但历史改动包含本项目内容">${iconSvg("split", { size: 10 })} 切片自 ${escapeHtml(thread.sliceFromTopicName)}</span>`);
  }
  for (const fp of footprints) {
    statusChips.push(`<span class="mo-footprint-pill" title="${escapeHtml(thread.driftedFrom ? `早期曾聊：${thread.driftedFrom}` : `会话内包含「${fp}」改动`)}">曾改:${escapeHtml(fp)}</span>`);
  }
  if (!footprints.length && thread.driftedFrom) {
    statusChips.push(`<span class="mo-footprint-pill" title="会话早期内容：${escapeHtml(thread.driftedFrom)}">早期:${escapeHtml(thread.driftedFrom.slice(0, 10))}</span>`);
  }
  if (thread.pendingCount > 0) {
    statusChips.push(`<span class="mo-status-pill is-pending">待确认 ${thread.pendingCount}</span>`);
  }
  if (thread.live) {
    statusChips.push(`<span class="mo-status-pill is-live"><i class="mo-live-pulse"></i>运行中</span>`);
  }
  if (isRecentDone) {
    statusChips.push(`<span class="mo-status-pill is-recent-done" title="刚刚完成，尚未查看"><i class="mo-recent-dot"></i>新完成</span>`);
  }
  if (thread.queuedCount > 0) {
    statusChips.push(`<span class="mo-status-pill is-queued">排队 ${thread.queuedCount}</span>`);
  }

  const assignPickerHtml = assignOpenThreadId === thread.id ? `
    <div class="mo-assign-row" data-mo-assign-box="${escapeHtml(thread.id)}">
      <span class="mo-assign-label">锁定归属产线：</span>
      <select class="mo-assign-select" data-mo-assign-select="${escapeHtml(thread.id)}" aria-label="选择归属项目">
        <option value="">自动识别（取消手动锁定）</option>
        ${allTopics.map((tp) => `
          <option value="${escapeHtml(tp.id)}" ${tp.id === thread.topicId ? "selected" : ""}>${escapeHtml(tp.name)}</option>
        `).join("")}
      </select>
    </div>
  ` : "";

  const tooltipLines = [
    thread.title || "新会话",
    thread.driftedFrom ? `早期主题：${thread.driftedFrom}` : "",
    (thread.allFootprints || []).length ? `涉及模块：${thread.allFootprints.join(" / ")}` : "",
    thread.cwd ? `目录：${thread.cwd}` : "",
  ].filter(Boolean).join("\n");

  return `
    <div class="mo-thread-wrap">
      <div class="mo-thread-row ${isSelected ? "is-selected" : ""}${thread.live ? " is-live" : ""}${thread.pendingCount > 0 ? " is-pending" : ""}${isRecentDone ? " is-recent-done" : ""}${thread.isSlice ? " is-slice" : ""}">
        <button
          type="button"
          class="mo-thread-open-btn"
          data-board-open-thread="${escapeHtml(thread.id)}"
          title="${escapeHtml(tooltipLines)}"
        >
          <span class="mo-thread-icon is-${escapeHtml(thread.provider || "default")}">${providerIconSvg(thread.provider, { size: 13 })}</span>
          <span class="mo-stage-pill ${stageCls}">${escapeHtml(stage)}</span>
          <span class="mo-thread-title">${escapeHtml(thread.title || "新会话")}</span>
          ${sourceLabel ? `<span class="mo-origin-tag" title="跨目录反射自：${escapeHtml(thread.cwd)}">${iconSvg("external-link", { size: 10 })} ${escapeHtml(sourceLabel)}</span>` : ""}
          ${statusChips.join("")}
          <span class="mo-thread-time">${escapeHtml(timeText)}</span>
        </button>
        ${allowInduct && thread.cwd && !thread.isSlice ? `
          <button
            type="button"
            class="mo-induct-btn"
            data-mo-induct-cwd="${escapeHtml(thread.cwd)}"
            title="将该目录正式收录为独立产线：${escapeHtml(thread.cwd)}"
          >${iconSvg("plus", { size: 11 })}<span>收录</span></button>
        ` : ""}
        <button
          type="button"
          class="mo-thread-assign-btn"
          data-mo-toggle-assign="${escapeHtml(thread.id)}"
          title="手动锁定该会话所属产线"
          aria-label="调整归属项目"
        >${iconSvg("folder", { size: 12 })}</button>
      </div>
      ${assignPickerHtml}
    </div>
  `;
}

const DEFAULT_VISIBLE_KPI_COUNT = 6;

function renderTopicMetricsPanelHtml(topic, {
  editingMetricsTopicId = "",
  expandedMetricsTopics = new Set(),
} = {}) {
  const metrics = topic.metrics || {};
  const rawKpis = Array.isArray(metrics.kpis) ? metrics.kpis : [];
  const hasPrimaryFlags = rawKpis.some((k) => Boolean(k?.primary));
  const kpis = hasPrimaryFlags
    ? [...rawKpis.filter((k) => k?.primary), ...rawKpis.filter((k) => !k?.primary)]
    : rawKpis;
  const isEditing = editingMetricsTopicId === topic.id;
  const isMetricsExpanded = Boolean(expandedMetricsTopics?.has?.(topic.id));
  const hasMoreKpis = kpis.length > DEFAULT_VISIBLE_KPI_COUNT;
  const visibleKpis = (!hasMoreKpis || isMetricsExpanded)
    ? kpis
    : kpis.slice(0, DEFAULT_VISIBLE_KPI_COUNT);
  const hiddenKpiCount = Math.max(0, kpis.length - visibleKpis.length);
  const syncPrompt = metrics.syncPrompt || `请尽可能全面采集「${topic.name}」所有重要业务与创收指标，按重要程度排序（核心指标标 "primary":true 置顶）并写入 .agent-metrics.${topic.id}.json`;

  const editorRows = [0, 1, 2].map((idx) => {
    const cur = kpis[idx] || {};
    const phLabel = idx === 0 ? "如：YT 订阅 / 粉丝数" : (idx === 1 ? "如：创收收入 / 赞助" : "如：累计播放 / Star");
    const phVal = idx === 0 ? "如：1,280" : (idx === 1 ? "如：$320" : "如：22.3万");
    return `
      <div class="mo-kpi-edit-row">
        <input type="text" class="mo-kpi-input is-label" data-kpi-label="${idx}" value="${escapeHtml(cur.label || "")}" placeholder="${phLabel}" />
        <input type="text" class="mo-kpi-input is-val" data-kpi-val="${idx}" value="${escapeHtml(cur.value || "")}" placeholder="${phVal}" />
        <input type="text" class="mo-kpi-input is-delta" data-kpi-delta="${idx}" value="${escapeHtml(cur.delta || "")}" placeholder="备注/变化" />
      </div>
    `;
  }).join("");

  return `
    <div class="mo-metrics-panel">
      <div class="mo-metrics-head">
        <span class="mo-metrics-title">
          ${iconSvg("coin", { size: 12 })}
          <span>数据与创收看板</span>
          ${metrics.updatedAt ? `<small class="mo-metrics-age">${escapeHtml(metrics.updatedAt)}</small>` : ""}
        </span>
        <div class="mo-metrics-actions">
          <button
            type="button"
            class="mo-mini-link-btn"
            data-mo-quick-dispatch-topic="${escapeHtml(topic.id)}"
            data-mo-quick-dispatch-text="${escapeHtml(syncPrompt)}"
            title="召唤 AI 员工尽可能全面采集最新业务与创收指标并写入 .agent-metrics.json"
          >${iconSvg("refresh", { size: 10 })} 派单采数</button>
          <button
            type="button"
            class="mo-mini-link-btn"
            data-mo-toggle-metrics-edit="${escapeHtml(topic.id)}"
          >${isEditing ? "取消" : (kpis.length ? "改指标" : "+ 录指标")}</button>
        </div>
      </div>

      ${visibleKpis.length ? `
        <div class="mo-kpi-grid">
          ${visibleKpis.map((k) => `
            <div class="mo-kpi-tile is-${escapeHtml(k.tone || "growth")}">
              <span class="mo-kpi-label">${escapeHtml(k.label)}</span>
              <strong class="mo-kpi-val">${escapeHtml(k.value)}</strong>
              ${k.delta ? `<span class="mo-kpi-delta">${escapeHtml(k.delta)}</span>` : ""}
            </div>
          `).join("")}
        </div>
        ${hasMoreKpis ? `
          <button
            type="button"
            class="mo-kpi-more-btn"
            data-mo-toggle-metrics-more="${escapeHtml(topic.id)}"
          >
            ${iconSvg(isMetricsExpanded ? "chevron-up" : "chevron-down", { size: 11 })}
            <span>${isMetricsExpanded ? `收起多余指标（共 ${kpis.length} 项）` : `展开更多指标（+${hiddenKpiCount} 项）`}</span>
          </button>
        ` : ""}
      ` : (!isEditing ? `
        <div class="mo-kpi-empty">
          支持读取仓库 <code>.agent-metrics.json</code>、点「派单采数」自动拉取，或点「+ 录指标」填入粉丝/创收
        </div>
      ` : "")}

      ${isEditing ? `
        <form class="mo-kpi-edit-form" data-mo-metrics-form="${escapeHtml(topic.id)}">
          ${editorRows}
          <div class="mo-kpi-edit-foot">
            <span class="mo-kpi-edit-hint">保存后将同步展示在 3D 建筑头顶铭牌</span>
            <button type="submit" class="btn-primary btn-xs">保存指标</button>
          </div>
        </form>
      ` : ""}
    </div>
  `;
}

function renderTopicArchiveDigestHtml(topic, {
  expandedContexts = new Set(),
  editingContextTopicId = "",
} = {}) {
  const digest = topic.archiveDigest || null;
  const isEditing = editingContextTopicId === topic.id;
  const isExpanded = Boolean(expandedContexts?.has?.(topic.id));
  const nowSec = Math.floor(Date.now() / 1000);
  const idleStaleCount = [...(topic.activeThreads || []).filter((t) => !t.isSlice), ...(topic.archivedThreads || [])]
    .filter((t) => {
      if (t.live || (t.pendingCount || 0) > 0 || t.pinned || t.goalState?.active) return false;
      const u = Number(t.updatedAt) > 1e11 ? Math.floor(Number(t.updatedAt) / 1000) : Number(t.updatedAt || 0);
      return !u || (nowSec - u) >= 3 * 86400;
    }).length;

  if (!digest?.summary && !isEditing) {
    if (!idleStaleCount) return "";
    return `
      <div class="mo-context-strip is-empty">
        <span class="mo-context-hint">
          ${iconSvg("archive", { size: 11 })}
          <span>发现 <strong>${idleStaleCount}</strong> 条闲置超 3 天的历史会话，可归档沉淀为产线记忆供新工单继承</span>
        </span>
        <button type="button" class="mo-mini-link-btn" data-sprite-archive-topic="${escapeHtml(topic.id)}">召唤小精灵归档总结</button>
      </div>
    `;
  }

  return `
    <div class="mo-context-panel">
      <div class="mo-context-head">
        <span class="mo-context-title">
          ${iconSvg("archive", { size: 12 })}
          <span>产线归档记忆</span>
          ${digest?.totalArchivedDigested ? `<small class="mo-metrics-age">已沉淀 ${digest.totalArchivedDigested} 条 · 新开分身自动继承</small>` : ""}
        </span>
        <div class="mo-metrics-actions">
          ${idleStaleCount > 0 ? `
            <button type="button" class="mo-mini-link-btn" data-sprite-archive-topic="${escapeHtml(topic.id)}" title="归档新闲置的 ${idleStaleCount} 条会话并合并更新摘要">
              +归档新闲置 (${idleStaleCount})
            </button>
          ` : ""}
          ${digest?.summary && !isEditing ? `
            <button type="button" class="mo-mini-link-btn" data-mo-toggle-context-expand="${escapeHtml(topic.id)}">
              ${isExpanded ? "收起" : "展开全文"}
            </button>
          ` : ""}
          <button type="button" class="mo-mini-link-btn" data-mo-toggle-context-edit="${escapeHtml(topic.id)}">
            ${isEditing ? "取消" : "编辑"}
          </button>
        </div>
      </div>
      ${!isEditing && digest?.summary ? `
        <div class="mo-context-body ${isExpanded ? "is-expanded" : "is-clamped"}">${escapeHtml(digest.summary)}</div>
        ${isExpanded && digest.contextFilePath ? `<div class="mo-context-file">已双存同步：<code>${escapeHtml(digest.contextFilePath)}</code></div>` : ""}
      ` : ""}
      ${isEditing ? `
        <form class="mo-context-edit-form" data-mo-context-form="${escapeHtml(topic.id)}">
          <textarea class="mo-context-textarea" rows="4" data-context-summary-input="1" placeholder="提炼该产线的关键结论、规范与后续衔接上下文…">${escapeHtml(digest?.summary || "")}</textarea>
          <div class="mo-kpi-edit-foot">
            <span class="mo-kpi-edit-hint">新开并发分身时自动注入；清空保存可移除摘要</span>
            <button type="submit" class="btn-primary btn-xs">保存归档摘要</button>
          </div>
        </form>
      ` : ""}
    </div>
  `;
}

function normClientPrefix(p = "") {
  return String(p || "").trim().replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

function renderTopicCardHtml(topic, {
  activeThreadId = "",
  allTopics = [],
  stages = DEFAULT_STAGES,
  expandedTopics = new Set(),
  expandedArchives = new Set(),
  expandedContexts = new Set(),
  assignOpenThreadId = "",
  editingMetricsTopicId = "",
  editingContextTopicId = "",
  expandedMetricsTopics = new Set(),
  selectedSubProjectByTopic = {},
  searchText = "",
  inInspector = false,
  recentCompletedByThread = null,
} = {}) {
  const subProjects = Array.isArray(topic.subProjects) ? topic.subProjects : [];
  const selectedSubCwd = subProjects.length >= 2
    ? (selectedSubProjectByTopic?.[topic.id] || "")
    : "";
  const activeSubProject = selectedSubCwd
    ? subProjects.find((sp) => sp.cwd === selectedSubCwd) || null
    : null;
  const activeSubNorm = activeSubProject ? normClientPrefix(activeSubProject.cwd) : "";
  const matchesSubProject = (t) => {
    if (!activeSubNorm) return true;
    const tc = normClientPrefix(t?.cwd);
    if (!tc) return false;
    return tc === activeSubNorm || tc.startsWith(`${activeSubNorm}/`);
  };

  const q = String(searchText || "").trim().toLowerCase();
  const matchesQuery = (t) => {
    if (!q) return true;
    const hay = [
      t.title || "",
      t.preview || "",
      t.cwd || "",
      t.stage || "",
      t.driftedFrom || "",
      t.sliceFromTopicName || "",
      ...(t.allFootprints || []),
      ...(t.footprints || []),
    ].join(" ").toLowerCase();
    return hay.includes(q);
  };
  const topicMatches = !q || `${topic.name} ${topic.description || ""} ${topic.yieldLabel || ""} ${topic.summary?.progress || ""} ${topic.summary?.nextStep || ""}`.toLowerCase().includes(q);
  const baseActive = (topic.activeThreads || []).filter(matchesSubProject);
  const baseArchived = (topic.archivedThreads || []).filter(matchesSubProject);
  const visibleActive = topicMatches ? baseActive : baseActive.filter(matchesQuery);
  const visibleArchived = topicMatches ? baseArchived : baseArchived.filter(matchesQuery);

  if (q && !topicMatches && !visibleActive.length && !visibleArchived.length) {
    return "";
  }

  const subProjectsHtml = subProjects.length >= 2 ? `
    <div class="mo-subprojects-bar" role="tablist" aria-label="同厂子项目工位">
      <button
        type="button"
        class="mo-subproject-chip ${!activeSubProject ? "is-active" : ""}"
        data-mo-select-subproject="${escapeHtml(topic.id)}"
        data-mo-subproject-cwd=""
      >
        <span>全部</span>
        <span class="mo-subproject-count">${topic.primaryActiveCount ?? (topic.activeThreads || []).filter((t) => !t.isSlice).length}</span>
      </button>
      ${subProjects.map((sp) => `
        <div class="mo-subproject-group ${activeSubProject?.cwd === sp.cwd ? "is-active" : ""}">
          <button
            type="button"
            class="mo-subproject-chip ${activeSubProject?.cwd === sp.cwd ? "is-active" : ""} ${sp.liveCount > 0 ? "is-live" : ""} ${sp.pendingCount > 0 ? "is-pending" : ""}"
            data-mo-select-subproject="${escapeHtml(topic.id)}"
            data-mo-subproject-cwd="${escapeHtml(sp.cwd)}"
            title="${escapeHtml(sp.cwd)}"
          >
            ${sp.liveCount > 0 ? `<i class="mo-sub-live-dot"></i>` : ""}
            <span>${escapeHtml(sp.name)}</span>
            <span class="mo-subproject-count">${sp.activeCount}</span>
          </button>
          <button
            type="button"
            class="mo-subproject-add-btn"
            data-new-in-cwd="${escapeHtml(sp.cwd)}"
            title="在子项目「${escapeHtml(sp.name)}」目录新建会话"
            aria-label="在 ${escapeHtml(sp.name)} 新建会话"
          >${iconSvg("plus", { size: 10 })}</button>
        </div>
      `).join("")}
    </div>
  ` : "";

  const isExpanded = Boolean(q) || expandedTopics?.has?.(topic.id);
  const isArchiveOpen = Boolean(q && visibleArchived.length) || expandedArchives?.has?.(topic.id);
  const defaultLimit = 5;
  const shownActive = isExpanded ? visibleActive : visibleActive.slice(0, defaultLimit);
  const hiddenActiveCount = Math.max(0, visibleActive.length - shownActive.length);

  const ym = yieldBadgeMeta(topic.yieldType, topic.yieldLabel);
  const pipeline = topic.pipeline || { stageIndex: 2, stageLabel: "研发", readyToHarvest: false };
  const git = topic.gitSnapshot;
  const latestCommit = git?.commits?.[0] || "";
  const gitBadgeHtml = git
    ? `<span class="mo-git-chip ${git.dirtyCount > 0 ? "is-dirty" : "is-clean"}" title="${escapeHtml((git.commits || []).join("\n"))}">${git.dirtyCount > 0 ? `${git.dirtyCount} 未提交` : "Git 干净"}</span>`
    : "";

  const ledger = topic.valueLedger;
  const ledgerBadgeHtml = ledger?.status
    ? `<span class="mo-ledger-chip" title="项目价值台账状态：${escapeHtml(ledger.status)}${ledger.nextReview ? ` · 下次复查 ${escapeHtml(ledger.nextReview)}` : ""}">${escapeHtml(ledger.status === "active" ? "台账活跃" : ledger.status)}${ledger.nextReview ? ` · 复盘 ${escapeHtml(ledger.nextReview.slice(5))}` : ""}</span>`
    : "";

  const pods = Array.isArray(topic.workerPods) ? topic.workerPods : [];
  const podsHtml = pods.length ? `
    <div class="mo-pods-row" aria-label="同模块并发工位组">
      <span class="mo-pods-label">并发工位组：</span>
      ${pods.map((pod) => `
        <button
          type="button"
          class="mo-pod-chip ${pod.liveCount > 0 ? "is-live" : ""}"
          data-mo-pod-search="${escapeHtml(pod.label)}"
          title="点击筛选「${escapeHtml(pod.label)}」的 ${pod.count} 个并发会话"
        >
          <span>${escapeHtml(pod.label)}</span>
          <strong>×${pod.count}</strong>
        </button>
      `).join("")}
    </div>
  ` : "";

  const recentDoneCount = (topic.activeThreads || []).filter((t) => isThreadRecentUnreadDone(t, recentCompletedByThread)).length;
  const cardClasses = [
    "mo-topic-card",
    inInspector ? "is-in-inspector" : "",
    topic.pinned ? "is-pinned" : "",
    topic.liveCount > 0 ? "has-live" : "",
    topic.pendingCount > 0 ? "has-pending" : "",
    recentDoneCount > 0 ? "has-recent-done" : "",
    pipeline.readyToHarvest ? "is-harvest-ready" : "",
  ].filter(Boolean).join(" ");

  return `
    <article class="${cardClasses}" id="mo-topic-${escapeHtml(topic.id)}" data-mo-topic-id="${escapeHtml(topic.id)}">
      ${inInspector ? "" : `<div class="mo-card-glow" aria-hidden="true"></div>`}
      <header class="mo-topic-head">
        <div class="mo-topic-title-wrap">
          <div class="mo-topic-title-row">
            ${inInspector ? "" : `<strong class="mo-topic-name">${escapeHtml(topic.name)}</strong>`}
            ${topic.landmark && LANDMARK_BADGE_LABELS[topic.landmark] ? `<span class="mo-landmark-chip">${escapeHtml(LANDMARK_BADGE_LABELS[topic.landmark])}</span>` : ""}
            <span class="mo-yield-chip ${ym.cls}">${iconSvg(ym.icon, { size: 11 })} ${escapeHtml(ym.text)}</span>
            ${pipeline.readyToHarvest ? `<span class="mo-harvest-pill">准收菜</span>` : ""}
            <span class="mo-topic-count-badge">${topic.primaryActiveCount ?? visibleActive.length} 工位${topic.sliceCount > 0 ? ` +${topic.sliceCount}切片` : ""}</span>
            ${topic.liveCount > 0 ? `<span class="mo-status-pill is-live"><i class="mo-live-pulse"></i>${topic.liveCount} 运转</span>` : ""}
            ${topic.pendingCount > 0 ? `<span class="mo-status-pill is-pending">待拍板 ${topic.pendingCount}</span>` : ""}
            ${recentDoneCount > 0 ? `<span class="mo-status-pill is-recent-done"><i class="mo-recent-dot"></i>新完成 ${recentDoneCount}</span>` : ""}
            ${gitBadgeHtml}
            ${ledgerBadgeHtml}
          </div>
          ${topic.description ? `<div class="mo-topic-desc" title="${escapeHtml(topic.description)}">${escapeHtml(topic.description)}</div>` : ""}
        </div>
        ${inInspector ? "" : `
          <div class="mo-topic-actions">
            <button
              type="button"
              class="mo-pin-focus-btn ${topic.isBossPinned ? "is-pinned" : ""}"
              data-mo-toggle-focus="${escapeHtml(topic.id)}"
              title="${topic.isBossPinned ? "取消今日主攻置顶" : "置顶到老板今日主攻台"}"
            >${iconSvg(topic.isBossPinned ? "star-filled" : "star", { size: 12 })}</button>
            <button
              type="button"
              class="mo-launch-new-btn is-sprite"
              data-sprite-summon-topic="${escapeHtml(topic.id)}"
              data-sprite-summon-name="${escapeHtml(topic.name)}"
              title="在此产线召唤小精灵（归档久远对话并提炼摘要 / 继承上下文派工）"
            >${iconSvg("bulb", { size: 11 })}<span>小精灵</span></button>
            <button
              type="button"
              class="mo-launch-new-btn"
              data-mo-select-dispatch-topic="${escapeHtml(topic.id)}"
              data-mo-subproject-cwd="${escapeHtml(activeSubProject?.cwd || "")}"
              title="定向派工到此产线（自动匹配干净工位或新开并发分身）"
            >${iconSvg("split", { size: 11 })}<span>派工</span></button>
            <button
              type="button"
              class="mo-launch-new-btn is-plain"
              data-new-in-cwd="${escapeHtml(activeSubProject?.cwd || topic.primaryCwd || "")}"
              title="${activeSubProject ? `在子项目「${escapeHtml(activeSubProject.name)}」目录新建会话` : "手动在该产线主目录新建会话"}"
            >${iconSvg("plus", { size: 11 })}</button>
          </div>
        `}
      </header>

      ${renderPipelineMeterHtml(pipeline, stages, { compact: inInspector })}
      ${subProjectsHtml}
      ${renderTopicMetricsPanelHtml(topic, { editingMetricsTopicId, expandedMetricsTopics })}
      ${renderTopicArchiveDigestHtml(topic, { expandedContexts, editingContextTopicId })}
      ${podsHtml}

      <div class="mo-summary-box ${topic.summary?.source === "ai" ? "is-ai-verified" : ""}">
        <div class="mo-summary-line">
          <span class="mo-summary-key">产线</span>
          <span class="mo-summary-val">${escapeHtml(topic.summary?.progress || "近 7 天暂无新对话")}</span>
        </div>
        ${latestCommit ? `
          <div class="mo-summary-line is-git-line">
            <span class="mo-summary-key">提交</span>
            <code class="mo-git-commit-line">${escapeHtml(latestCommit)}</code>
          </div>
        ` : ""}
        ${topic.summary?.nextStep ? `
          <div class="mo-summary-line is-next">
            <span class="mo-summary-key">推进</span>
            <button
              type="button"
              class="mo-next-prefill-btn"
              data-mo-quick-dispatch-topic="${escapeHtml(topic.id)}"
              data-mo-subproject-cwd="${escapeHtml(activeSubProject?.cwd || "")}"
              data-mo-quick-dispatch-text="${escapeHtml(topic.summary.nextStep)}"
              title="填入智能派单台，自动挑选干净工位或开并发分身执行"
            >
              <span class="mo-next-text">${escapeHtml(topic.summary.nextStep)}</span>
              <span class="mo-prefill-hint">${iconSvg("rocket", { size: 11 })} 智能派单</span>
            </button>
          </div>
        ` : ""}
      </div>

      ${shownActive.length ? `
        <div class="mo-thread-list">
          ${shownActive.map((t) => renderOverviewThreadRowHtml(t, { activeThreadId, allTopics, assignOpenThreadId, recentCompletedByThread })).join("")}
        </div>
      ` : `
        <div class="mo-topic-empty">近 7 天暂无活跃工位${visibleArchived.length ? `（另有 ${visibleArchived.length} 条历史归档）` : ""}</div>
      `}

      ${(hiddenActiveCount > 0 || visibleArchived.length > 0 || (isExpanded && visibleActive.length > defaultLimit)) ? `
        <footer class="mo-topic-foot">
          ${hiddenActiveCount > 0 ? `
            <button type="button" class="mo-foot-btn" data-mo-expand-topic="${escapeHtml(topic.id)}">
              展开其余 ${hiddenActiveCount} 个工位会话
            </button>
          ` : (isExpanded && visibleActive.length > defaultLimit ? `
            <button type="button" class="mo-foot-btn" data-mo-collapse-topic="${escapeHtml(topic.id)}">收起工位列表</button>
          ` : "<span></span>")}
          ${visibleArchived.length > 0 ? `
            <button type="button" class="mo-foot-btn is-archive" data-mo-toggle-archive="${escapeHtml(topic.id)}">
              ${iconSvg("archive", { size: 11 })} ${isArchiveOpen ? `收起归档 (${visibleArchived.length})` : `历史归档 (${visibleArchived.length})`}
            </button>
          ` : ""}
        </footer>
      ` : ""}

      ${isArchiveOpen && visibleArchived.length ? `
        <div class="mo-archive-list">
          ${visibleArchived.slice(0, 12).map((t) => renderOverviewThreadRowHtml(t, { activeThreadId, allTopics, assignOpenThreadId, recentCompletedByThread })).join("")}
        </div>
      ` : ""}
    </article>
  `;
}

export function renderMissionOverviewHtml(overview, {
  activeThreadId = "",
  searchText = "",
  loading = false,
  expandedTopics = new Set(),
  expandedArchives = new Set(),
  expandedContexts = new Set(),
  assignOpenThreadId = "",
  editingMetricsTopicId = "",
  editingContextTopicId = "",
  expandedMetricsTopics = new Set(),
  selectedSubProjectByTopic = {},
  syncingProjects = false,
  allowResume = false,
  domainFilter = "all",
  immersive = false,
  showChilledSparks = false,
  dispatchDraft = "",
  dispatchTopicId = "",
  dispatchMode = "auto",
  dispatchInheritContext = true,
  dispatchBusy = false,
  dispatchPreview = null,
  lastDispatchReceipt = null,
  dispatchAgent = {},
  recentCompletedByThread = null,
} = {}) {
  const domains = Array.isArray(overview?.domains) ? overview.domains : [];
  const allTopics = Array.isArray(overview?.topics) ? overview.topics : [];
  const bossFocus = Array.isArray(overview?.bossFocus) ? overview.bossFocus : [];
  const incubator = overview?.incubator || { eggs: [], chilled: [], totalActive: 0, chilledCount: 0 };
  const stages = Array.isArray(overview?.pipelineStages) && overview.pipelineStages.length ? overview.pipelineStages : DEFAULT_STAGES;
  const unassignedActive = Array.isArray(overview?.unassignedActive) ? overview.unassignedActive : [];
  const meta = overview?.meta || {};
  const radar = overview?.radar || { liveThreads: [], pendingThreads: [], totalActiveCount: 0, driftedCount: 0, harvestReadyCount: 0 };
  const modelOptions = Array.isArray(meta.modelOptions) ? meta.modelOptions : [];
  const preferredModel = meta.preferredModel || "auto";
  const summarizing = Boolean(meta.summarizing || loading);

  const allFlatTopics = domains.flatMap((d) => d.topics || []);
  const liveTotal = (radar.liveThreads || []).length;
  const pendingTotal = (radar.pendingThreads || []).reduce((s, t) => s + (t.pendingCount || 1), 0);
  const harvestReadyTotal = Number(radar.harvestReadyCount) || allFlatTopics.filter((tp) => tp.pipeline?.readyToHarvest).length;
  const dirtyRepos = allFlatTopics.filter((tp) => (tp.gitSnapshot?.dirtyCount || 0) > 0);
  const totalDirtyFiles = dirtyRepos.reduce((s, tp) => s + (tp.gitSnapshot?.dirtyCount || 0), 0);

  const summaryStatusText = summarizing
    ? "AI 厂长参谋正在盘点各车间产线、切片混杂会话与打捞昨日灵光…"
    : `${formatSummaryAge(meta.lastSummarizedAt)}${meta.lastModelUsed ? ` · ${meta.lastModelUsed}` : ""}`;

  const q = String(searchText || "").trim().toLowerCase();
  const visibleUnassigned = (domainFilter === "all" || domainFilter === "unassigned")
    ? (q
        ? unassignedActive.filter((t) => `${t.title || ""} ${t.preview || ""} ${t.cwd || ""} ${(t.allFootprints || []).join(" ")}`.toLowerCase().includes(q))
        : unassignedActive)
    : [];

  const recentDoneThreads = collectRecentCompletedThreads(overview, recentCompletedByThread);
  const recentDoneIds = new Set(recentDoneThreads.map((t) => t.id));
  const radarItems = [
    ...(radar.pendingThreads || []).slice(0, 4).map((t) => ({ ...t, radarKind: "pending" })),
    ...(radar.liveThreads || []).filter((t) => !(t.pendingCount > 0)).slice(0, 5).map((t) => ({ ...t, radarKind: "live" })),
    ...recentDoneThreads.filter((t) => !((radar.pendingThreads || []).some((p) => p.id === t.id))).slice(0, 4).map((t) => ({ ...t, radarKind: "recent_done" })),
  ];
  void recentDoneIds;

  const domainNavChips = [
    { id: "all", name: "全厂产线", count: radar.totalActiveCount || 0, theme: "theme-all" },
    ...domains.map((d, i) => ({
      id: d.id,
      name: d.shortName || d.name,
      count: (d.topics || []).reduce((s, tp) => s + (tp.primaryActiveCount ?? tp.activeThreads?.length ?? 0), 0),
      theme: domainThemeClass(d.id, i),
    })),
    ...(unassignedActive.length ? [{ id: "unassigned", name: "散落探索", count: unassignedActive.length, theme: "theme-cyan" }] : []),
  ];

  const domainSectionsHtml = domains.map((domain, idx) => {
    if (domainFilter !== "all" && domainFilter !== domain.id) return "";
    const themeCls = domainThemeClass(domain.id, idx);
    const sectorCode = domain.code || `ROOM 0${idx + 1}`;
    const domainActiveCount = (domain.topics || []).reduce((s, tp) => s + (tp.primaryActiveCount ?? tp.activeThreads?.length ?? 0), 0);
    const domainLiveCount = (domain.topics || []).reduce((s, tp) => s + (tp.liveCount || 0), 0);
    const cardsHtml = (domain.topics || [])
      .map((topic) => renderTopicCardHtml(topic, {
        activeThreadId,
        allTopics,
        stages,
        expandedTopics,
        expandedArchives,
        expandedContexts,
        assignOpenThreadId,
        editingMetricsTopicId,
        editingContextTopicId,
        expandedMetricsTopics,
        selectedSubProjectByTopic,
        searchText,
        recentCompletedByThread,
      }))
      .filter(Boolean)
      .join("");
    if (!cardsHtml) return "";
    return `
      <section class="mo-domain-section ${themeCls}" data-mo-domain="${escapeHtml(domain.id)}">
        <div class="mo-domain-head">
          <div class="mo-domain-title-group">
            <span class="mo-sector-tag">${escapeHtml(sectorCode)}</span>
            <h3>${escapeHtml(domain.name)}</h3>
            <span class="mo-domain-stat">${domainActiveCount} 工位${domainLiveCount > 0 ? ` · ${domainLiveCount} 运转中` : ""}</span>
          </div>
          <div class="mo-domain-line" aria-hidden="true"></div>
        </div>
        <div class="mo-topic-grid">${cardsHtml}</div>
      </section>
    `;
  }).filter(Boolean).join("");

  return `
    <div class="mo-deck-shell ${summarizing ? "is-scanning" : ""}">
      <div class="mo-ambient-bg" aria-hidden="true"></div>

      <section class="mo-cockpit-hero">
        <div class="mo-cockpit-top">
          <div class="mo-cockpit-brand">
            <div class="mo-sonar-orb ${liveTotal > 0 ? "is-live" : ""}${pendingTotal > 0 ? " is-pending" : ""}" aria-hidden="true">
              <span class="mo-sonar-ring r1"></span>
              <span class="mo-sonar-ring r2"></span>
              <span class="mo-sonar-core"></span>
            </div>
            <div class="mo-cockpit-titles">
              <div class="mo-title-line">
                <span class="mo-kicker">AI STUDIO TYCOON · 一人梦工厂</span>
                ${renderBoardViewSwitchHtml("overview")}
              </div>
              <div class="mo-cockpit-sub">
                <span class="mo-ai-pulse-dot ${summarizing ? "is-busy" : ""}"></span>
                <span>${escapeHtml(summaryStatusText)}</span>
                ${meta.lastError ? `<span class="mo-summary-err" title="${escapeHtml(meta.lastError)}">· ${escapeHtml(meta.lastError)}</span>` : ""}
              </div>
            </div>
          </div>

          <div class="mo-cockpit-controls">
            ${renderRefreshControlHtml({ modelOptions, preferredModel, summarizing, meta })}
            <button type="button" class="mo-ctrl-btn" data-mo-action="sync-projects" ${syncingProjects ? "disabled" : ""} title="扫描近期工作区与记忆库项目卡，自动补充未收录产线">
              ${iconSvg("layers", { size: 13 })}<span>${syncingProjects ? "同步中" : "同步项目"}</span>
            </button>
            <button type="button" class="mo-ctrl-btn ${immersive ? "is-active" : ""}" data-mo-action="toggle-immersive" title="${immersive ? "退出全屏沉浸沙盘 (Esc)" : "展开全屏沉浸沙盘"}">
              ${iconSvg(immersive ? "minimize" : "maximize", { size: 13 })}<span>${immersive ? "退出沉浸" : "沉浸沙盘"}</span>
            </button>
            <button type="button" class="mo-ctrl-btn" data-board-action="voice" title="开启轻量总控助手">
              ${iconSvg("mic", { size: 13 })}<span>助手</span>
            </button>
            <button type="button" class="btn-secondary btn-xs mo-ctrl-btn" data-board-action="new" title="手动配置参数新建会话">
              ${iconSvg("plus", { size: 13 })}<span>手动新建</span>
            </button>
            ${allowResume ? `<button type="button" class="mo-ctrl-btn" data-board-action="resume">回到对话</button>` : ""}
          </div>
        </div>

        ${renderSmartDispatcherBarHtml({
          allTopics,
          dispatchDraft,
          dispatchTopicId,
          dispatchMode,
          dispatchInheritContext,
          dispatchBusy,
          dispatchPreview,
          lastDispatchReceipt,
          driftedCount: radar.driftedCount || 0,
          dispatchAgent: { ...dispatchAgent, dispatchPrefs: overview?.meta?.dispatchPrefs || null },
        })}

        <div class="mo-tycoon-sandbox">
          ${renderStudioFloorplanHtml(domains, incubator, { domainFilter })}
          ${renderBossFocusHtml(bossFocus, stages)}
          ${renderIncubatorHtml(incubator, { showChilled: showChilledSparks, allTopics })}
        </div>

        <div class="mo-hud-metrics is-compact-strip">
          <div class="mo-metric-tile ${harvestReadyTotal > 0 ? "is-harvest" : ""}">
            <span class="mo-metric-label">准收菜产线 HARVEST</span>
            <strong class="mo-metric-num">${harvestReadyTotal}</strong>
            <span class="mo-metric-sub">处于宣发/变现临门一脚</span>
          </div>
          <div class="mo-metric-tile ${liveTotal > 0 ? "is-live" : ""}">
            <span class="mo-metric-label">运转工位 WORKING</span>
            <strong class="mo-metric-num">${liveTotal}</strong>
            <span class="mo-metric-sub">${liveTotal > 0 ? "AI 员工并行敲码中" : "全厂工位空闲待命"}</span>
          </div>
          <div class="mo-metric-tile ${pendingTotal > 0 ? "is-pending" : ""}">
            <span class="mo-metric-label">待老板拍板 APPROVAL</span>
            <strong class="mo-metric-num">${pendingTotal}</strong>
            <span class="mo-metric-sub">${pendingTotal > 0 ? "需确认授权或问题" : "零阻塞项"}</span>
          </div>
          <div class="mo-metric-tile ${dirtyRepos.length > 0 ? "is-git" : ""}">
            <span class="mo-metric-label">未提交仓库 GIT</span>
            <strong class="mo-metric-num">${dirtyRepos.length}<small>/${allFlatTopics.filter((t) => t.gitSnapshot).length || allFlatTopics.length}</small></strong>
            <span class="mo-metric-sub">${totalDirtyFiles > 0 ? `共 ${totalDirtyFiles} 处改动待收口` : "主仓库全部干净"}</span>
          </div>
        </div>

        ${radarItems.length ? `
          <div class="mo-radar-bar" aria-label="实时工位雷达">
            <div class="mo-radar-label">${iconSvg("bolt", { size: 13 })} 实时运转</div>
            <div class="mo-radar-pills">
              ${radarItems.map((t) => {
                const pillCls = t.radarKind === "pending"
                  ? "is-pending"
                  : (t.radarKind === "recent_done" ? "is-recent-done" : "is-live");
                const tagText = t.radarKind === "pending"
                  ? `待拍板 ${t.pendingCount}`
                  : (t.radarKind === "recent_done" ? "新完成" : "运转中");
                const timeBadge = formatCompactRelativeTime(t.updatedAt);
                return `
                <button
                  type="button"
                  class="mo-radar-pill ${pillCls}"
                  data-board-open-thread="${escapeHtml(t.id)}"
                  title="${escapeHtml(t.title || "新会话")}"
                >
                  <span class="mo-radar-tag">${tagText}</span>
                  <span class="mo-radar-text">${escapeHtml(t.title || "新会话")}</span>
                  ${timeBadge ? `<span class="mo-radar-time">${escapeHtml(timeBadge)}</span>` : ""}
                </button>
              `;
              }).join("")}
            </div>
          </div>
        ` : ""}

        <div class="mo-filter-bar">
          <div class="mo-domain-pills" role="tablist" aria-label="车间过滤">
            ${domainNavChips.map((chip) => `
              <button
                type="button"
                class="mo-domain-pill ${chip.theme} ${domainFilter === chip.id ? "is-active" : ""}"
                data-mo-domain-filter="${escapeHtml(chip.id)}"
              >
                <span>${escapeHtml(chip.name)}</span>
                <span class="mo-domain-pill-num">${chip.count}</span>
              </button>
            `).join("")}
          </div>
          <div class="mo-search-wrap">
            <input
              id="boardSearchInput"
              type="search"
              class="board-search-input mo-search-input"
              value="${escapeHtml(searchText)}"
              placeholder="搜模块（如：语音助手 / SEO / 支付）自动揪出被改名的混杂会话…"
            />
            ${searchText ? `<button type="button" class="mo-clear-search-btn" data-board-action="clear-search">${iconSvg("close", { size: 12 })}</button>` : ""}
          </div>
        </div>
      </section>

      ${!overview && loading ? `
        <div class="board-empty-card mo-loading-card">
          <strong>正在唤醒 AI 梦工厂沙盘…</strong>
          <span>正在聚合各车间产线、反向切片跨项目会话与打捞昨日灵光</span>
        </div>
      ` : domainSectionsHtml}

      ${visibleUnassigned.length ? `
        <section class="mo-domain-section theme-cyan">
          <div class="mo-domain-head">
            <div class="mo-domain-title-group">
              <span class="mo-sector-tag">EXPLORE</span>
              <h3>散落探索 / 待归入产线对话</h3>
              <span class="mo-domain-stat">${visibleUnassigned.length} 条</span>
            </div>
            <div class="mo-domain-line" aria-hidden="true"></div>
          </div>
          <div class="mo-unassigned-card">
            <div class="mo-thread-list">
              ${visibleUnassigned.slice(0, 12).map((t) => renderOverviewThreadRowHtml(t, { activeThreadId, allTopics, assignOpenThreadId, recentCompletedByThread, allowInduct: true })).join("")}
            </div>
          </div>
        </section>
      ` : ""}
    </div>
  `;
}

function renderInspectorRoomTopicItemHtml(tp, { isOverflow = false } = {}) {
  const stageIdx = Math.max(1, Math.min(5, Number(tp?.pipeline?.stageIndex) || 1));
  const activeCount = Number(tp?.primaryActiveCount ?? tp?.activeThreads?.length ?? 0);
  const subCount = Array.isArray(tp?.subProjects) ? tp.subProjects.length : 0;
  const subTitle = tp?.summary?.progress || tp?.description || tp?.primaryCwd || "";
  return `
    <div class="tycoon-room-item ${tp.liveCount > 0 ? "is-live" : ""} ${tp.pendingCount > 0 ? "is-pending" : ""}">
      <button type="button" class="tycoon-room-item-main" data-tycoon-select-topic="${escapeHtml(tp.id)}">
        <div class="tycoon-room-item-top">
          <strong class="tycoon-room-item-name">${escapeHtml(tp.name)}</strong>
          <span class="tycoon-q-lv">Lv.${stageIdx}</span>
          ${isOverflow ? `<span class="tycoon-room-item-tag is-cluster">折叠</span>` : ""}
          ${subCount >= 2 ? `<span class="tycoon-room-item-tag is-sub">${subCount} 子项目</span>` : ""}
          ${tp.pendingCount > 0 ? `<span class="mo-status-pill is-pending">待拍板 ${tp.pendingCount}</span>` : ""}
          ${tp.liveCount > 0 ? `<span class="mo-status-pill is-live"><i class="mo-live-pulse"></i>${tp.liveCount} 运转</span>` : ""}
          ${tp.pipeline?.readyToHarvest ? `<span class="mo-harvest-pill">准收菜</span>` : ""}
        </div>
        <div class="tycoon-room-item-meta">
          <span>${activeCount} 工位</span>
          ${subTitle ? `<span class="tycoon-room-item-desc" title="${escapeHtml(subTitle)}">${escapeHtml(subTitle)}</span>` : ""}
        </div>
      </button>
      <div class="tycoon-room-item-actions">
        <button
          type="button"
          class="mo-launch-new-btn"
          data-tycoon-select-topic="${escapeHtml(tp.id)}"
          title="展开该项目的工位会话与子项目"
        ><span>工位</span></button>
        <button
          type="button"
          class="mo-launch-new-btn"
          data-mo-select-dispatch-topic="${escapeHtml(tp.id)}"
          title="定向派工到此项目"
        >${iconSvg("split", { size: 11 })}</button>
        <button
          type="button"
          class="mo-launch-new-btn is-plain"
          data-new-in-cwd="${escapeHtml(tp.primaryCwd || "")}"
          title="在该项目目录新建会话"
        >${iconSvg("plus", { size: 11 })}</button>
      </div>
    </div>
  `;
}

export function renderTycoonHudHtml(overview, {
  activeThreadId = "",
  searchText = "",
  loading = false,
  expandedTopics = new Set(),
  expandedArchives = new Set(),
  expandedContexts = new Set(),
  assignOpenThreadId = "",
  editingMetricsTopicId = "",
  editingContextTopicId = "",
  expandedMetricsTopics = new Set(),
  allowResume = false,
  domainFilter = "all",
  immersive = false,
  selectedTopicId = "",
  inspectorMode = "",
  inspectorRoomId = "",
  inspectorClusterOnly = false,
  inspectorBack = null,
  selectedSubProjectByTopic = {},
  syncingProjects = false,
  questCollapsed = false,
  dispatchConfigOpen = false,
  mobileDockOpen = false,
  showChilledSparks = false,
  dispatchDraft = "",
  dispatchTopicId = "",
  dispatchMode = "auto",
  dispatchInheritContext = true,
  dispatchBusy = false,
  dispatchPreview = null,
  lastDispatchReceipt = null,
  dispatchAgent = {},
  recentCompletedByThread = null,
} = {}) {
  const domains = Array.isArray(overview?.domains) ? overview.domains : [];
  const allTopics = Array.isArray(overview?.topics) ? overview.topics : [];
  const bossFocus = Array.isArray(overview?.bossFocus) ? overview.bossFocus : [];
  const incubator = overview?.incubator || { eggs: [], chilled: [], totalActive: 0, chilledCount: 0 };
  const stages = Array.isArray(overview?.pipelineStages) && overview.pipelineStages.length ? overview.pipelineStages : DEFAULT_STAGES;
  const meta = overview?.meta || {};
  const radar = overview?.radar || { liveThreads: [], pendingThreads: [], totalActiveCount: 0, driftedCount: 0, harvestReadyCount: 0 };
  const modelOptions = Array.isArray(meta.modelOptions) ? meta.modelOptions : [];
  const preferredModel = meta.preferredModel || "auto";
  const summarizing = Boolean(meta.summarizing || loading);

  const allFlatTopics = domains.flatMap((d) => d.topics || []);
  const unassignedActive = Array.isArray(overview?.unassignedActive) ? overview.unassignedActive : [];
  const recentDoneThreads = collectRecentCompletedThreads(overview, recentCompletedByThread);
  const liveTotal = (radar.liveThreads || []).length;
  const pendingTotal = (radar.pendingThreads || []).reduce((s, t) => s + (t.pendingCount || 1), 0);
  const harvestReadyTotal = Number(radar.harvestReadyCount) || allFlatTopics.filter((tp) => tp.pipeline?.readyToHarvest).length;
  const eggCount = Number(incubator.totalActive) || (incubator.eggs?.length || 0);
  const prog = computeStudioProgression(overview);
  const visPrefs = readTycoonVisualPrefs();

  const selectedTopic = selectedTopicId
    ? allFlatTopics.find((tp) => tp.id === selectedTopicId) || null
    : null;

  const q = String(searchText || "").trim().toLowerCase();
  const searchMatchedThreads = q
    ? allFlatTopics.flatMap((tp) => (tp.activeThreads || []).filter((t) => {
        const hay = [
          t.title || "",
          t.preview || "",
          t.stage || "",
          t.driftedFrom || "",
          t.sliceFromTopicName || "",
          ...(t.allFootprints || []),
          ...(t.footprints || []),
        ].join(" ").toLowerCase();
        return hay.includes(q);
      }).map((t) => ({ ...t, ownerTopicName: tp.name, ownerTopicId: tp.id }))).slice(0, 6)
    : [];

  const cameraButtons = [
    { id: "all", key: "1", label: "全厂俯瞰" },
    { id: "indie-lab", key: "2", label: ROOM_BLUEPRINTS["indie-lab"].shortTitle },
    { id: "drama-studio", key: "3", label: ROOM_BLUEPRINTS["drama-studio"].shortTitle },
    { id: "global-pub", key: "4", label: ROOM_BLUEPRINTS["global-pub"].shortTitle },
    { id: "bounty-guild", key: "5", label: ROOM_BLUEPRINTS["bounty-guild"].shortTitle },
    { id: "incubator", key: "6", label: ROOM_BLUEPRINTS.incubator.shortTitle },
  ];

  const routes = Array.isArray(dispatchPreview?.routes) ? dispatchPreview.routes : [];
  const receipts = Array.isArray(lastDispatchReceipt?.dispatched) ? lastDispatchReceipt.dispatched : [];
  const isDockOpen = Boolean(mobileDockOpen || dispatchBusy || routes.length || receipts.length);
  const hasDockDraftOrQuery = Boolean(String(dispatchDraft || "").trim() || String(searchText || "").trim());

  const selectedDispatchTopic = dispatchTopicId
    ? allTopics.find((tp) => tp.id === dispatchTopicId) || null
    : null;
  const isRouteCustom = Boolean(
    dispatchTopicId
    || (dispatchAgent?.selectedAgentKey && dispatchAgent.selectedAgentKey !== "auto")
    || dispatchMode === "new"
    || dispatchInheritContext === false,
  );
  const routeSummaryLabel = selectedDispatchTopic
    ? selectedDispatchTopic.name.slice(0, 7)
    : (isRouteCustom ? "自定义路由" : "自动路由");

  let inspectorDrawerHtml = "";
  if (inspectorMode === "recent_done") {
    inspectorDrawerHtml = `
      <aside class="tycoon-hud-inspector" aria-label="最近完成未读会话">
        <div class="tycoon-drawer-bar">
          <span>${iconSvg("check", { size: 13 })} 最近完成未读 · ${recentDoneThreads.length} 条</span>
          <button type="button" class="tycoon-drawer-close" data-tycoon-close-inspector="1" title="关闭面板">${iconSvg("close", { size: 13 })}</button>
        </div>
        <div class="tycoon-inspector-scroll">
          <p class="tycoon-drawer-hint">这些会话刚完成一轮执行且尚未查看，点击标题直接打开并标记已读。</p>
          ${recentDoneThreads.length ? `
            <div class="mo-thread-list">
              ${recentDoneThreads.slice(0, 40).map((t) => renderOverviewThreadRowHtml(t, { activeThreadId, allTopics, assignOpenThreadId, recentCompletedByThread })).join("")}
            </div>
          ` : `<div class="mo-panel-empty">暂无最近完成未读会话</div>`}
        </div>
      </aside>
    `;
  } else if (inspectorMode === "unassigned") {
    inspectorDrawerHtml = `
      <aside class="tycoon-hud-inspector" aria-label="待归类会话">
        <div class="tycoon-drawer-bar">
          <span>${iconSvg("folder", { size: 13 })} 待归类会话 · ${unassignedActive.length} 条</span>
          <div class="tycoon-drawer-actions">
            <button type="button" class="mo-launch-new-btn is-plain" data-mo-action="sync-projects" ${syncingProjects ? "disabled" : ""} title="自动扫描并收录新项目">${iconSvg("layers", { size: 11 })}<span>${syncingProjects ? "同步中" : "同步项目"}</span></button>
            <button type="button" class="tycoon-drawer-close" data-tycoon-close-inspector="1" title="关闭面板">${iconSvg("close", { size: 13 })}</button>
          </div>
        </div>
        <div class="tycoon-inspector-scroll">
          <p class="tycoon-drawer-hint">点「+ 收录」把目录直接升级为独立产线，或点文件夹归入已有产线。</p>
          ${unassignedActive.length ? `
            <div class="mo-thread-list">
              ${unassignedActive.slice(0, 40).map((t) => renderOverviewThreadRowHtml(t, { activeThreadId, allTopics, assignOpenThreadId, recentCompletedByThread, allowInduct: true })).join("")}
            </div>
          ` : `<div class="mo-panel-empty">全部会话都已归类</div>`}
        </div>
      </aside>
    `;
  } else if (inspectorMode === "room" || inspectorMode === "cluster") {
    const resolvedRoomId = inspectorRoomId || (domainFilter !== "all" ? domainFilter : "");
    const targetDomain = domains.find((d) => d.id === resolvedRoomId) || domains[0] || null;
    const domainTopics = Array.isArray(targetDomain?.topics) ? targetDomain.topics : [];
    const bp = ROOM_BLUEPRINTS[targetDomain?.id] || {};
    const { overflow } = partitionRoomTopicsForSlots(domainTopics, bp.maxSlots || 6);
    const overflowIds = new Set(overflow.map((t) => t.id));
    const showingClusterOnly = Boolean(inspectorClusterOnly && overflow.length > 0);
    const listTopics = showingClusterOnly ? overflow : domainTopics;
    inspectorDrawerHtml = `
      <aside class="tycoon-hud-inspector" aria-label="同厂项目列表">
        <div class="tycoon-drawer-bar">
          <span class="tycoon-drawer-title">${iconSvg("layers", { size: 13 })} <strong>${escapeHtml(targetDomain?.name || "同厂项目")}</strong> <span class="tycoon-drawer-count">${listTopics.length}${domainTopics.length > listTopics.length ? `/${domainTopics.length}` : ""}</span></span>
          <div class="tycoon-drawer-actions">
            ${overflow.length > 0 ? `
              <button
                type="button"
                class="mo-launch-new-btn is-plain"
                data-tycoon-toggle-cluster-scope="1"
                title="${showingClusterOnly ? "显示该厂全部项目" : "仅看折叠在复合厂房内的项目"}"
              ><span>${showingClusterOnly ? `全厂 (${domainTopics.length})` : `折叠 (+${overflow.length})`}</span></button>
            ` : ""}
            <button type="button" class="mo-launch-new-btn is-plain" data-mo-action="sync-projects" ${syncingProjects ? "disabled" : ""} title="同步扫描本机未收录项目">${iconSvg("refresh", { size: 11 })}<span>${syncingProjects ? "同步中" : "同步"}</span></button>
            <button type="button" class="tycoon-drawer-close" data-tycoon-close-inspector="1" title="关闭面板">${iconSvg("close", { size: 13 })}</button>
          </div>
        </div>
        <div class="tycoon-inspector-scroll">
          <p class="tycoon-drawer-hint">${showingClusterOnly ? `此处展开受 3D 场地容量折叠的 ${overflow.length} 个项目，点击任意项目查看工位与子项目。` : `同厂共 ${domainTopics.length} 个项目，点击任一项即可展开其工位会话与多目录子项目。`}</p>
          ${listTopics.length ? `
            <div class="tycoon-room-list">
              ${listTopics.map((tp) => renderInspectorRoomTopicItemHtml(tp, { isOverflow: overflowIds.has(tp.id) })).join("")}
            </div>
          ` : `<div class="mo-panel-empty">该厂区暂无项目，可点右上角「同步」自动发现本地仓库</div>`}
        </div>
      </aside>
    `;
  } else if (inspectorMode === "directory") {
    const nonEmptyDomains = domains.filter((d) => (d.topics || []).length > 0);
    inspectorDrawerHtml = `
      <aside class="tycoon-hud-inspector" aria-label="全园区项目目录">
        <div class="tycoon-drawer-bar">
          <span class="tycoon-drawer-title">${iconSvg("board", { size: 13 })} <strong>全园区项目目录 · ${allFlatTopics.length}</strong></span>
          <div class="tycoon-drawer-actions">
            <button type="button" class="mo-launch-new-btn is-plain" data-mo-action="sync-projects" ${syncingProjects ? "disabled" : ""} title="扫描近期工作区与记忆库项目卡，自动补充未收录产线">${iconSvg("refresh", { size: 11 })}<span>${syncingProjects ? "同步中" : "同步项目"}</span></button>
            <button type="button" class="tycoon-drawer-close" data-tycoon-close-inspector="1" title="关闭面板">${iconSvg("close", { size: 13 })}</button>
          </div>
        </div>
        <div class="tycoon-inspector-scroll">
          <p class="tycoon-drawer-hint">全厂区已收录的所有项目与集群；点击任意项目在 3D 沙盘定位并展开工位。</p>
          ${nonEmptyDomains.length ? nonEmptyDomains.map((dom) => {
            const bp = ROOM_BLUEPRINTS[dom.id] || {};
            const { overflow } = partitionRoomTopicsForSlots(dom.topics || [], bp.maxSlots || 6);
            const overflowIds = new Set(overflow.map((t) => t.id));
            return `
              <div class="tycoon-dir-section">
                <div class="tycoon-dir-head">
                  <strong>${escapeHtml(dom.name)}</strong>
                  <span>${(dom.topics || []).length} 项</span>
                </div>
                <div class="tycoon-room-list">
                  ${(dom.topics || []).map((tp) => renderInspectorRoomTopicItemHtml(tp, { isOverflow: overflowIds.has(tp.id) })).join("")}
                </div>
              </div>
            `;
          }).join("") : `<div class="mo-panel-empty">暂未收录项目，点击右上角「同步项目」立即扫描本机工作区</div>`}
        </div>
      </aside>
    `;
  } else if (inspectorMode === "incubator") {
    inspectorDrawerHtml = `
      <aside class="tycoon-hud-inspector" aria-label="3D 灵感孵化温室控制台">
        <div class="tycoon-drawer-bar">
          <span>${iconSvg("egg", { size: 13 })} 灵感孵化温室</span>
          <button type="button" class="tycoon-drawer-close" data-tycoon-close-inspector="1" title="关闭面板">${iconSvg("close", { size: 13 })}</button>
        </div>
        ${renderIncubatorHtml(incubator, { showChilled: showChilledSparks, allTopics })}
      </aside>
    `;
  } else if (selectedTopic) {
    const selectedSubCwd = Array.isArray(selectedTopic.subProjects) && selectedTopic.subProjects.length >= 2
      ? (selectedSubProjectByTopic?.[selectedTopic.id] || "")
      : "";
    const hasBack = Boolean(inspectorBack && ["room", "cluster", "directory"].includes(inspectorBack.mode));
    inspectorDrawerHtml = `
      <aside class="tycoon-hud-inspector" aria-label="3D 产线工位详情">
        <div class="tycoon-drawer-bar">
          <span class="tycoon-drawer-title" title="${escapeHtml(selectedTopic.name)}">
            ${hasBack ? `<button type="button" class="tycoon-drawer-back-btn" data-tycoon-inspector-back="1" title="返回上级项目列表">←</button>` : ""}
            ${iconSvg("layers", { size: 13 })} <strong>${escapeHtml(selectedTopic.name)}</strong>
          </span>
          <div class="tycoon-drawer-actions">
            <button
              type="button"
              class="mo-pin-focus-btn ${selectedTopic.isBossPinned ? "is-pinned" : ""}"
              data-mo-toggle-focus="${escapeHtml(selectedTopic.id)}"
              title="${selectedTopic.isBossPinned ? "取消今日主攻置顶" : "置顶到主线 Top 3"}"
            >${iconSvg(selectedTopic.isBossPinned ? "star-filled" : "star", { size: 12 })}</button>
            <button
              type="button"
              class="mo-launch-new-btn is-sprite"
              data-sprite-summon-topic="${escapeHtml(selectedTopic.id)}"
              data-sprite-summon-name="${escapeHtml(selectedTopic.name)}"
              title="召唤此产线小精灵（归档总结 / 继承记忆派工）"
            >${iconSvg("bulb", { size: 11 })}<span>小精灵</span></button>
            <button
              type="button"
              class="mo-launch-new-btn"
              data-mo-select-dispatch-topic="${escapeHtml(selectedTopic.id)}"
              data-mo-subproject-cwd="${escapeHtml(selectedSubCwd)}"
              title="定向派工到此产线"
            >${iconSvg("split", { size: 11 })}<span>派工</span></button>
            <button
              type="button"
              class="mo-launch-new-btn is-plain"
              data-new-in-cwd="${escapeHtml(selectedSubCwd || selectedTopic.primaryCwd || "")}"
              title="手动在该产线目录新建会话"
            >${iconSvg("plus", { size: 11 })}</button>
            <button type="button" class="tycoon-drawer-close" data-tycoon-close-inspector="1" title="关闭详情 (点击空白地板也可收起)">${iconSvg("close", { size: 13 })}</button>
          </div>
        </div>
        <div class="tycoon-inspector-scroll">
          ${renderTopicCardHtml(selectedTopic, {
            activeThreadId,
            allTopics,
            stages,
            expandedTopics: new Set([selectedTopic.id, ...expandedTopics]),
            expandedArchives,
            expandedContexts,
            assignOpenThreadId,
            editingMetricsTopicId,
            editingContextTopicId,
            expandedMetricsTopics,
            selectedSubProjectByTopic,
            searchText: "",
            inInspector: true,
            recentCompletedByThread,
          })}
        </div>
      </aside>
    `;
  }

  return `
    <div class="tycoon-hud-root${inspectorDrawerHtml ? " has-inspector" : ""}">
      <header class="tycoon-hud-top">
        <div class="tycoon-brand-cluster">
          <div class="tycoon-lv-crest" title="梦工厂繁荣度积分：${prog.totalPoints}">
            <span class="tycoon-lv-num">Lv.${prog.level}</span>
            <div class="tycoon-xp-bar"><i style="width:${prog.xpPercent}%"></i></div>
          </div>
          <div class="tycoon-mode-switch">${renderBoardViewSwitchHtml("tycoon3d")}</div>
        </div>

        <div class="tycoon-assistant-badges" aria-label="${t("园区工单")}">
          ${[["alert", "!", "等你"], ["harvest", "$", "收菜"], ["ruin", "🚧", "烂尾"]].map(([type, mark, label]) => {
            const count = Number(overview?.assistantBadges?.[type]) || 0;
            return `<button type="button" class="tycoon-assistant-badge is-${type} ${count ? "" : "is-empty"}" data-assistant-badge="${type}" aria-label="${escapeHtml(t(label))} ${count}"><span>${mark} ${escapeHtml(t(label))}</span><strong>${count}</strong></button>`;
          }).join("")}
        </div>
        <button type="button" class="tycoon-mobile-more" data-sprite-action="hud-more" aria-expanded="false" aria-label="${t("更多")}">⋯</button>
        <div id="tycoonHudMore" class="tycoon-more-panel">
        <div class="tycoon-mobile-scene-switch">${renderBoardViewSwitchHtml("tycoon3d")}</div>
        <div class="tycoon-resource-strip" aria-label="工厂核心资源与状态">
          <button type="button" class="tycoon-res-pill is-coin" data-tycoon-fly-harvest="1" title="点击飞往距收菜变现最近的 3D 工位">
            ${iconSvg("coin", { size: 13 })}
            <span>准收菜</span>
            <strong>${harvestReadyTotal}</strong>
          </button>
          <button type="button" class="tycoon-res-pill is-work ${liveTotal > 0 ? "is-pulsing" : ""}" data-tycoon-fly-live="1" title="点击巡视正在敲码运转的 AI 员工">
            ${iconSvg("bolt", { size: 13 })}
            <span>运转员工</span>
            <strong>${liveTotal}</strong>
          </button>
          <button type="button" class="tycoon-res-pill is-alert ${pendingTotal > 0 ? "is-urgent" : ""}" data-tycoon-fly-pending="1" title="需要老板拍板授权的工位（按 Space 一键跳转下一个）">
            ${iconSvg("bell", { size: 13 })}
            <span>待拍板</span>
            <strong>${pendingTotal}</strong>
            ${pendingTotal > 0 ? `<kbd class="tycoon-space-kbd">Space</kbd>` : ""}
          </button>
          <button type="button" class="tycoon-res-pill is-egg" data-tycoon-open-incubator="1" title="点击飞往 3D 灵感孵化温室">
            ${iconSvg("egg", { size: 13 })}
            <span>灵光蛋</span>
            <strong>${eggCount}</strong>
          </button>
          <button type="button" class="tycoon-res-pill is-directory ${inspectorMode === "directory" ? "is-active" : ""}" data-tycoon-open-directory="1" title="查看全园区全部已收录项目与同厂分组">
            ${iconSvg("board", { size: 13 })}
            <span>项目</span>
            <strong>${allFlatTopics.length}</strong>
          </button>
          ${recentDoneThreads.length ? `
            <button type="button" class="tycoon-res-pill is-recent-done ${inspectorMode === "recent_done" ? "is-active" : ""}" data-tycoon-open-recent-done="1" title="最近完成但尚未查看的会话，点开逐条查看">
              ${iconSvg("check", { size: 13 })}
              <span>新完成</span>
              <strong>${recentDoneThreads.length}</strong>
            </button>
          ` : ""}
          ${unassignedActive.length ? `
            <button type="button" class="tycoon-res-pill is-unassigned ${inspectorMode === "unassigned" ? "is-active" : ""}" data-tycoon-open-unassigned="1" title="没归到任何产线的近期会话，点开逐条归类">
              ${iconSvg("folder", { size: 13 })}
              <span>待归类</span>
              <strong>${unassignedActive.length}</strong>
            </button>
          ` : ""}
        </div>

        <div class="tycoon-sys-controls">
          <div class="tycoon-vis-group" role="group" aria-label="3D 画面与视角开关">
            <button type="button" class="mo-ctrl-btn tycoon-top-btn tycoon-vis-btn ${visPrefs.perspective ? "is-active" : ""}" data-tycoon-toggle-vis="perspective" aria-pressed="${visPrefs.perspective ? "true" : "false"}" title="切换等距正交 / 36° 微缩透视视角">36° 透视</button>
            <button type="button" class="mo-ctrl-btn tycoon-top-btn tycoon-vis-btn ${visPrefs.tiltShift ? "is-active" : ""}" data-tycoon-toggle-vis="tiltShift" aria-pressed="${visPrefs.tiltShift ? "true" : "false"}" title="开启或关闭微缩移轴景深（关闭可省 4 次模糊开销）">移轴景深</button>
            <button type="button" class="mo-ctrl-btn tycoon-top-btn tycoon-vis-btn ${visPrefs.bloom ? "is-active" : ""}" data-tycoon-toggle-vis="bloom" aria-pressed="${visPrefs.bloom ? "true" : "false"}" title="开启或关闭高光选择性泛光">泛光</button>
          </div>
          ${renderRefreshControlHtml({ modelOptions, preferredModel, summarizing, meta, btnClass: "mo-ctrl-btn tycoon-top-btn" })}
          <button type="button" class="mo-ctrl-btn tycoon-top-btn ${immersive ? "is-active" : ""}" data-mo-action="toggle-immersive" title="全屏游戏沉浸模式 (Esc 退出)">
            ${iconSvg(immersive ? "minimize" : "maximize", { size: 13 })}<span>${immersive ? "退全屏" : "全屏"}</span>
          </button>
          <button type="button" class="mo-ctrl-btn tycoon-top-btn is-icon-only" data-board-action="voice" title="开启长语音通话助手">
            ${iconSvg("mic", { size: 13 })}
          </button>
          ${allowResume ? `<button type="button" class="mo-ctrl-btn tycoon-top-btn" data-board-action="resume">回对话</button>` : ""}
        </div>
        </div>
      </header>

      <div class="tycoon-hud-middle">
        <aside class="tycoon-quest-box ${questCollapsed ? "is-collapsed" : ""}" aria-label="主线任务收菜榜" title="左键按住拖拽平移地图 · WASD移动 · 滚轮缩放">
          <div class="tycoon-quest-head" ${questCollapsed ? `data-tycoon-toggle-quest="1" role="button" tabindex="0"` : ""}>
            <span class="tycoon-quest-title">${iconSvg("crown", { size: 13 })} ${questCollapsed ? `主线 Top ${Math.min(3, bossFocus.length || 3)}` : "今日主线 · 临门一脚 Top 3"}</span>
            <button type="button" class="tycoon-quest-fold" data-tycoon-toggle-quest="1" title="${questCollapsed ? "展开主线任务" : "收起任务栏"}">
              ${iconSvg(questCollapsed ? "chevron-down" : "chevron-up", { size: 12 })}
            </button>
          </div>
          ${!questCollapsed ? `
            <div class="tycoon-quest-list">
              ${bossFocus.map((qItem, idx) => `
                <div class="tycoon-quest-row ${selectedTopicId === qItem.topicId ? "is-active" : ""}">
                  <button type="button" class="tycoon-quest-focus-btn" data-tycoon-select-topic="${escapeHtml(qItem.topicId)}" title="点击定位到「${escapeHtml(qItem.name)}」3D 建筑">
                    <div class="tycoon-quest-line1">
                      <span class="tycoon-q-badge">Q${idx + 1}</span>
                      <strong class="tycoon-q-name">${escapeHtml(qItem.name)}</strong>
                      <span class="tycoon-q-lv">Lv.${qItem.stageIndex} ${escapeHtml(qItem.stageLabel)}</span>
                      ${qItem.readyToHarvest ? `<span class="mo-harvest-pill">准收菜</span>` : ""}
                    </div>
                  </button>
                  <div class="tycoon-quest-foot">
                    <button type="button" class="tycoon-quest-sub-btn" data-tycoon-select-topic="${escapeHtml(qItem.topicId)}" title="${escapeHtml(qItem.bottleneck)}">
                      ${escapeHtml(qItem.bottleneck)}
                    </button>
                    <button
                      type="button"
                      class="tycoon-quest-go-btn"
                      data-mo-quick-dispatch-topic="${escapeHtml(qItem.topicId)}"
                      data-mo-quick-dispatch-text="${escapeHtml(qItem.nextStep)}"
                      title="召唤 AI 员工推进：${escapeHtml(qItem.nextStep)}"
                    >${iconSvg("bolt", { size: 11 })}<span>派工</span></button>
                  </div>
                </div>
              `).join("")}
            </div>
            <div class="tycoon-cam-tips">左键拖拽平移 · WASD移动 · 滚轮缩放 · Space跳待拍板</div>
          ` : ""}
        </aside>

        ${inspectorDrawerHtml}
      </div>

      <footer class="tycoon-bottom-dock ${isDockOpen ? "is-mobile-expanded" : "is-mobile-collapsed"}" aria-label="镜头切换与智能召唤派单台">
        ${searchMatchedThreads.length ? `
          <div class="tycoon-search-popup">
            <span class="tycoon-search-pop-label">3D 光柱已锁定「${escapeHtml(searchText)}」：</span>
            <div class="tycoon-search-pop-pills">
              ${searchMatchedThreads.map((mt) => {
                const timeBadge = formatCompactRelativeTime(mt.updatedAt);
                return `
                <button type="button" class="mo-radar-pill is-live" data-board-open-thread="${escapeHtml(mt.id)}">
                  <span class="mo-radar-tag">${escapeHtml(mt.ownerTopicName)}</span>
                  <span class="mo-radar-text">${escapeHtml(mt.title)}</span>
                  ${timeBadge ? `<span class="mo-radar-time">${escapeHtml(timeBadge)}</span>` : ""}
                </button>
              `;
              }).join("")}
            </div>
          </div>
        ` : ""}

        ${routes.length ? `
          <div class="mo-dispatch-feedback is-preview tycoon-dock-popup">
            <div class="mo-dispatch-fb-head">
              <strong>派工预览（${routes.length} 单）：</strong>
              <button type="button" class="mo-mini-link-btn" data-mo-action="clear-dispatch-feedback">关闭</button>
            </div>
            <div class="mo-dispatch-route-list">
              ${routes.map((rt) => `
                <div class="mo-dispatch-route-row">
                  <span class="mo-route-act ${rt.action === "reuse_clean" ? "is-reuse" : "is-spawn"}">
                    ${rt.action === "reuse_clean" ? "续接干净工位" : "召唤并发新分身"}
                  </span>
                  <strong class="mo-route-topic">${escapeHtml(rt.topicName)}</strong>
                  ${rt.willInheritContext ? `<span class="mo-inherit-pill" title="${escapeHtml(rt.contextSummaryPreview || "")}">继承归档记忆</span>` : ""}
                  ${renderRouteAgentHtml(rt)}
                  <span class="mo-route-reason">${escapeHtml(rt.reason)}</span>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}

        ${!routes.length && receipts.length ? `
          <div class="mo-dispatch-feedback is-receipt tycoon-dock-popup">
            <div class="mo-dispatch-fb-head">
              <strong>已召唤 ${receipts.length} 名 AI 员工上岗：</strong>
              <button type="button" class="mo-mini-link-btn" data-mo-action="clear-dispatch-feedback">收起</button>
            </div>
            <div class="mo-dispatch-route-list">
              ${receipts.map((rc) => `
                <div class="mo-dispatch-route-row">
                  <span class="mo-route-act ${rc.action === "reuse_clean" ? "is-reuse" : "is-spawn"}">
                    ${rc.action === "reuse_clean" ? "已入驻原工位" : "已召唤新分身"}
                  </span>
                  <strong class="mo-route-topic">${escapeHtml(rc.topicName)}</strong>
                  ${rc.willInheritContext ? `<span class="mo-inherit-pill" title="${escapeHtml(rc.contextSummaryPreview || "")}">已继承归档记忆</span>` : ""}
                  ${renderRouteAgentHtml(rc)}
                  <span class="mo-route-reason">${escapeHtml(rc.reason)}</span>
                  ${rc.threadId ? `
                    <button type="button" class="mo-route-open-btn" data-board-open-thread="${escapeHtml(rc.threadId)}">进入工位 →</button>
                  ` : ""}
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}

        <div class="tycoon-dock-cam-row">
          <div class="tycoon-cam-pills">
            ${cameraButtons.map((cb) => `
              <button
                type="button"
                class="tycoon-cam-btn ${(domainFilter === cb.id && inspectorMode !== "incubator") || (cb.id === "incubator" && inspectorMode === "incubator") ? "is-active" : ""}"
                data-tycoon-cam-room="${escapeHtml(cb.id)}"
              >
                <kbd>${cb.key}</kbd><span>${escapeHtml(cb.label)}</span>
              </button>
            `).join("")}
          </div>

          <button
            type="button"
            class="tycoon-mobile-dock-toggle ${isDockOpen ? "is-active" : ""} ${!isDockOpen && hasDockDraftOrQuery ? "has-draft" : ""}"
            data-sprite-action="open"
            aria-expanded="${isDockOpen ? "true" : "false"}"
          >
            ${iconSvg(isDockOpen ? "chevron-down" : "send", { size: 12 })}
            <span>${isDockOpen ? "收起" : "派工"}</span>
          </button>

          <div class="tycoon-radar-search">
            <input
              id="boardSearchInput"
              type="search"
              class="board-search-input tycoon-search-input"
              value="${escapeHtml(searchText)}"
              placeholder="3D 光柱搜会话…"
            />
            ${searchText ? `<button type="button" class="mo-clear-search-btn" data-board-action="clear-search">${iconSvg("close", { size: 12 })}</button>` : ""}
          </div>
        </div>

        <form id="moDispatchForm" class="tycoon-dock-dispatch-row">
          <div class="tycoon-dispatch-config" ${dispatchConfigOpen ? "" : "hidden"}>
            <select id="moDispatchTopicSelect" class="mo-dispatch-select is-topic" aria-label="目标车间产线">
              <option value="" ${!dispatchTopicId ? "selected" : ""}>产线：自动识别（支持分号拆单）</option>
              ${allTopics.map((tp) => `
                <option value="${escapeHtml(tp.id)}" ${tp.id === dispatchTopicId ? "selected" : ""}>产线：${escapeHtml(tp.name)}</option>
              `).join("")}
            </select>
            ${renderDispatchAgentControlsHtml(dispatchAgent)}
            <select id="moDispatchModeSelect" class="mo-dispatch-select is-mode" aria-label="召唤策略">
              <option value="auto" ${dispatchMode !== "new" ? "selected" : ""}>工位：优先复用空闲</option>
              <option value="new" ${dispatchMode === "new" ? "selected" : ""}>工位：强制新开分身</option>
            </select>
            <label class="mo-inherit-toggle" title="新开并发分身时自动注入该产线的历史归档记忆摘要（复用已有工位时不重复注入）">
              <input id="moDispatchInheritCheck" type="checkbox" ${dispatchInheritContext !== false ? "checked" : ""} />
              <span>新工位继承记忆</span>
            </label>
          </div>
          <div class="tycoon-dispatch-input-row">
            <button
              type="button"
              class="mo-ctrl-btn tycoon-route-toggle ${dispatchConfigOpen || isRouteCustom ? "is-active" : ""}"
              data-tycoon-toggle-dispatch-cfg="1"
              aria-expanded="${dispatchConfigOpen ? "true" : "false"}"
              title="点击展开/收起产线、账号、模型与工位复用设置"
            >${iconSvg("settings", { size: 12 })}<span>${escapeHtml(routeSummaryLabel)}</span></button>
            <input
              id="moDispatchInput"
              type="text"
              class="mo-dispatch-input"
              value="${escapeHtml(dispatchDraft)}"
              placeholder="${selectedDispatchTopic ? `向「${escapeHtml(selectedDispatchTopic.name)}」下达派工指令…` : "输入指令自动匹配干净工位派工（分号拆多单）…"}"
              ${dispatchBusy ? "disabled" : ""}
            />
            <button type="button" class="mo-ctrl-btn" data-mo-action="preview-dispatch" ${dispatchBusy ? "disabled" : ""}>预览</button>
            <button type="submit" class="btn-primary btn-sm mo-dispatch-submit-btn" ${dispatchBusy ? "disabled" : ""}>
              ${iconSvg("send", { size: 12 })}<span>${dispatchBusy ? "召唤中…" : "派工"}</span>
            </button>
          </div>
        </form>
      </footer>
    </div>
  `;
}
