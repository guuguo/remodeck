---
name: remodeck-memory
description: Shared cross-engine memory and hierarchical tree task tracker for RemoDeck across Codex, Claude Code, and Antigravity. Use when a session prompt references [任务 ...] or [共享记忆], when splitting or tracking multi-step/subtask/parallel work, when the user asks about past work ("之前/上次/发过哪些/数据如何/做到哪了") or uses unclear references to prior items, when recording verified facts/decisions/ledgers/lessons, or when legacy/engine-private memories need progressive consolidation.
---

# RemoDeck 共享记忆与树状任务（remodeck-memory）

本技能统一管理 **树状任务（`remodeck task`）** 与 **跨引擎共享记忆（`remodeck memory`）**，供 Codex / Claude Code / Antigravity 三端共用。**先查再做，做完写回；触达旧账，顺手收口。**

命令入口（安装 RemoDeck 后全局可用 `remodeck`；在 RemoDeck 仓库内未装 PATH 时可用 `node scripts/ac-task.mjs` / `node scripts/ac-memory.mjs`）：
- 默认记忆目录位于 RemoDeck 数据目录下的 `<dataDir>/memory`（纯 Markdown）；若配置了 `remodeck memory config --vault <path>` 或环境变量 `AC_MEMORY_VAULT`，则读写指定的 Obsidian/Markdown 仓库。

---

## 1. 树状任务（`remodeck task` —— 进行中工作唯一真源）

任务按**父子严格树状结构**（`parent -> child`）保存在 `<dataDir>/tasks.json` 与 append-only 时间线 `<dataDir>/tasks/<id>.jsonl`，并会在启用共享记忆时单向投影为只读 Markdown。
- **禁止双写 `wip`**：正在进行的跨步骤、跨会话或并行工作一律用 `remodeck task` 管理，不要再往旧 `remodeck memory wip` 新建/同步任务卡（`wip` 仅用于读取或完结遗留卡片）。

当新会话开头带有任务指针时，例如：
`[任务 tk_ab12「...」｜...｜查进度：remodeck task show tk_ab12｜记进展：remodeck task log tk_ab12 "一句进展"]`

1. **按需拉取上下游上下文**：修改代码前如需了解父任务目标、兄弟会话进展、规划锚点（`planRef`）或验收标准，先执行：
   ```bash
   remodeck task show <id>
   ```
2. **尊重同目录并发兄弟会话**：若提示同目录已有运行中的兄弟/父任务会话，先查看任务日志与状态，避免修改兄弟会话正在编辑的文件。
3. **关键里程碑追加简明日志**（append-only）：
   ```bash
   remodeck task log <id> "一句关键进展或验证结果"
   ```
4. **拆分工作建子任务，不做平铺重复任务**：
   ```bash
   remodeck task new "子任务标题" --parent <parentId> --goal "明确目标"
   ```
5. **查看与完结**：
   ```bash
   remodeck task list [--status open|done|all] [--topic <scope>]
   remodeck task done <id>
   ```

---

## 2. 共享记忆：按需检索（`remodeck memory` —— 先查再做）

新会话默认**没有**历史上下文。首条消息末尾若出现 `[共享记忆] …`，只提示存在哪些记录，**不含具体内容**。

**出现以下任一需求时，先检索再作答或动手：**
- 问及过往：「之前 / 上次 / 前几天 / 已经…了吗 / 做到哪了 / 发过哪些 / 数据怎么样 / 当时为什么」。
- 指代不明的旧对象：「那篇文章」「那个脚本」「继续上次的」等缺少上下文的引用。
- 执行依赖既有约定的操作：发布、改配置、改定价、对外渠道规则等。
- `[共享记忆]` 简报里存在与当前工作同名的未完结记录。

**检索顺序**：`remodeck memory brief --topic <scope>`（约 2400 字总览）→ `remodeck memory search <关键词...>` → `remodeck memory get <相对路径>`。
- 记忆库未命中或明显缺漏时，再去查阅项目内文档或引擎私存记忆目录；仍无依据就明确说明不知道，严禁凭印象编造。
- 与历史无关的纯新需求无需检索。

---

## 3. 共享记忆：写入纪律与防膨胀

**准入三问**（满足任一再沉淀）：下次新会话还会再问吗？花了力气才查实吗？换个会话会做错吗？

- **零负向事实纠偏免问直写**：查证发现记忆库存在过时/错误事实（如已上线/已修复仍标待办），或用户在对话中陈述了明确的新事实/状态变化时，**直接静默写回 `fact`/`ledger` 或完结旧项**，回复时一句话带过即可，**严禁反问“要不要顺手记一下/消项”**。仅尚未拍板的方案（不得误记为 `decide`）及有外部副作用的操作才需确认。

| 场景 | 命令 |
|---|---|
| 发布、渠道状态、流水等结构化多行记录 | `remodeck memory ledger <归属> <台账名> 列=值 ... --key 主键列`（首次建表必传 `--key`） |
| 经验证的简短事实（端口、架构约定、现状总览） | `remodeck memory fact <归属> <键> '<值>' --source code\|user\|agent` |
| 用户已拍板的决定或长期偏好 | `remodeck memory decide <归属> '<内容>' --source user` |
| 可复用踩坑经验、长篇规范或 SOP | `remodeck memory note '<标题>' --topic <归属> --kind lesson\|reference --body '...'`（长文本走 `<<'EOF'` stdin） |

- **归属（scope）**：`项目/` 下的项目 ID（如 `demo-shop`）、`area:<领域名>`（跨项目通用经验）或 `me`（个人偏好）。
- **来源权威**：`code`（代码/实测） > `user` > `agent`（推断）。低权威值不会直接覆盖高权威值，冲突会进入 `收件箱/待裁决.md` 等待用户裁决。
- **防止 `fact` 膨胀截断 `brief`**：`brief` 有约 2400 字上限且优先展示 `事实`。单条 `fact` 必须控制在**一句话（≤ 120 字）**，更新前先看已有键名并**复用同义键覆盖**；多渠道/多行明细走 `ledger`，长规范走 `note`。
- **防止 Shell 误展开**：值包含 `$`（如 `$0`、`$4.9`）、反引号或 `!` 时，必须使用单引号 `'...'` 或 `<<'EOF'` stdin，避免被 shell 展开。

---

## 4. 旧记忆渐进收口（触达即迁，禁止双写）

仅在当前任务**检索回退命中**或**写入发现旧账**时顺手收口；**严禁脱离当前任务全仓扫描搬迁**。先判三界：

1. **工程与业务真源 → 绝不迁移（原位保留，仅记指针）**：被代码/脚本/构建流程直接读写的文件（配置表、清单）、仓库契约（`AGENTS.md`、`CLAUDE.md`、`DESIGN.md`、`docs/harness/`）、内容成品、原始采集证据包及独立维护的专项业务库。记忆库只在链接或产物说明里留路径指针。
2. **引擎私存记忆 → 只进不出，触达即迁**：如 `~/.claude/projects/*/memory/*.md` 等单引擎本地 memory，读到尚未入库的长期事实/决策/经验时去重迁入 `remodeck memory`，**停止往私存目录追加新内容**。
3. **项目内纯备忘旧文档 → 比对合并 + 原位冻结**：无代码读取、纯跨会话备忘的散落状态表/踩坑记，按高权威/最新核实结果去重结构化入库（剥离任何密钥字段），并将旧动态段落替换为单行跳转指针（未经用户明确允许，**严禁删除 Git 仓库文件**）。

---

## 5. 硬红线与维护

- **严禁存储凭据与隐私态**：绝不写入密码、token、cookie、session ID 或登录态/凭据文件正文（`*_state.json`、`active_session.txt` 等）。
- **中间产物只记指针**：记录路径 + 一句话说明，不复制大文件进记忆库。
- **不泛滥建任务、不记无用流水**：一次性简单问答不建任务；能直接从代码或 `git` 读到的细节不重复入库；`.ac/` 下机器索引禁止手改。
- **定期巡检**：运行 `remodeck memory lint` 检查过期事实、重复键、断链、闲置遗留任务卡与同步冲突副本。
