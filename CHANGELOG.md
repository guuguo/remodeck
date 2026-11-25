# 更新日志 (CHANGELOG)

## v0.2.6 (2026-11-25)

UI 资源版本：`20261125a`

- feat(search): global thread content search with snippets
- feat(human-verify): human verification panel, HUD and generic API
- feat(codex): exec compatibility mode for official-client-only accounts
- feat(ui): native folder picker for new threads, title policy, quota and history polish
- fix(voice): keep full utterances, project hotwords, ask back on unresolved targets
- feat(update): realign clients after an upstream history rewrite
- chore(privacy): strip maintainer-specific data and add no-private-content rule

## v0.2.4 (2026-11-21)

UI 资源版本：`20261121a`

- feat(agy): allow auto-compact thresholds up to 900K (9e08217)
- feat(ui): Mermaid diagrams, unarchive actions, 3D factory and stats polish (4ba9f6c)
- feat(update): bilingual user-facing release notes in update panel (33d84cd)
- feat(cli): detect Homebrew cask installs for CLI maintenance (5ad2e23)
- feat(providers): AGY auto-compact before send and archived-thread recovery (54318de)
- feat(memory): opt-in shared memory vault with one-line session pointer (c551bf0)
- docs: refresh overview GIFs with upgraded 3D Dream Factory and Sprite Assistant UI (83595f2)
- docs(en): use raw.githubusercontent.com URLs in English README (2669460)
- docs: add 14-second animated overview GIF to Chinese and English READMEs (f9885e2)

## v0.2.3 (2026-11-18)

UI 资源版本：`20261118a`

- fix(macos): 桌面壳默认跟随系统外观并隐藏首页不可用返回按钮 (affa0fb)
- fix: Windows CLI 安装支持含空格路径，并新增日间模式与语音一来一回优化 (2cb6fd6)
- feat: 支持会话在所属项目内置顶 (e4a6a87)
- 修复分叉会话分页刷新丢失中间对话的问题 (f2f7119)
- 覆盖 runner 实际使用的 APT 动态镜像列表 (2662d5a)
- 让 CI 换源同时覆盖主 sources.list 配置 (5f839c6)
- 使用 Ubuntu 官方 HTTPS 源避免桌面 CI 依赖下载超时 (232ede3)
- 修正 Linux 桌面错误提示的显示并补充验收 (4bf7f57)
- 等待 WebKit DOM 返回标题后验收原生导航 (766635e)
- 补齐 Linux 语音授权入口并修正桌面命令解析验收 (e2a7542)
- 新增 Linux 原生桌面壳、应用入口与图形冒烟测试 (a3e834f)
- 修正 systemd 工作目录格式并修复 ARM 测试清理顺序 (e8cfc2d)
- 补齐 Linux 后台 CLI 路径、部署指南与双架构兼容验证 (f2e3f1f)
- feat(install): print GitHub Star prompt on successful setup (e79019c)
- 修复命令输出仅显示 JSON 尾部，支持展开查看完整输出 (31e8951)
- 修复 Codex 历史图片恢复与本机预览，精简输入附件展示 (db2fefe)
- fix(windows): avoid killing self-update restart helper with taskkill /T (4a28d92)
- feat(ui,cli): hide unauth agent tabs with horizontal scroll and auto-install missing CLIs (575a00a)
- fix(service): support Node 22.5-22.12 sqlite flag and clarify Windows autostart warning (f085880)
- docs(i18n): add localized desktop screenshots for EN/JA/KO READMEs and posts (be5c56c)
- 新增手机会话操作菜单入口并保留长按多选 (1c68210)
- 修复 Markdown 预览内相对链接按当前文档目录跳转 (25cf48b)
- 优化 Codex 技能消息为折叠卡片并清理会话预览 (3178891)
- docs: upgrade README with high-conversion badges, security table, and architecture (4eecd38)
- docs: switch install/uninstall URLs to hub.guuguo.top short links (a165d64)
- feat(i18n): add 5-language UI support and internationalize READMEs (258a88f)
- 新增换 Agent 接续会话并支持选择模型与思考强度 (26e3dc6)
- 接入 Qoder CLI 并支持隐藏侧栏智能体筛选入口 (612974e)
- fix: 重启服务失败时在更新弹窗内直接展示错误提示 (ca36cc4)
- feat: 在版本与自动更新弹窗新增「重启服务」按钮与 /api/update/restart 接口 (395aa5a)
- fix(windows): 完善安装与启动错误展示、排查路径与中文路径兼容 (53001bd)
- fix: 优化超大历史会话加载性能并修复 Windows 一键安装与后台服务启动 (d375df9)
- docs: 在 README 补充 LINUX DO 社区认可链接 (6696065)
- chore(release): v0.2.2 功能与稳定性更新，语音轻量模型切换至 Sonnet / GPT-6.1 Terra 低思考 (6c90136)

## v0.2.2 (2026-11-16)

UI 资源版本：`20261116quotc`

- 版本发布 v0.2.2

## v0.2.1 (2026-11-16)

UI 资源版本：`20261116quotb`

- 版本发布 v0.2.1

## v0.2.0 (2026-11-16)

UI 资源版本：`20261116ag`

- 新增服务端版本检测、闲时自动平滑更新与跨端一键更新面板（支持 Web 与移动端操作）
- 新增统一版本维护脚本（`npm run version:bump`），联动同步 `package.json`、UI 资源版本号与 `CHANGELOG.md`
- 支持 macOS `Agent Control.app` 桌面外壳版本及 12 位构建指纹跟踪，更新服务端时可自动联动重编安装
- 优化 4 家智能体实时监控 HUD、多账号自动别名、排队与执行状态展示及语音通话多引擎模型切换
- 升级 `README.md` 展示图，补充桌面全景、手机双栏、免提语音通话、扫码隧道及自动更新实拍截图

## v0.1.0 (2026-11-16)

- 初始版本发布：支持 Codex、Claude Code、Antigravity 与 Grok 多智能体统一远程控制、扫码免费隧道、中继连接与 macOS 原生 WKWebView 桌面壳。
