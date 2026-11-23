[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [繁體中文](README.zh-TW.md)

# Agent Control

> 在電腦與手機上統一檢視 **Codex**、**Claude Code**、**Antigravity** 與 **Grok** 的任務進度、隨時續跑對話與核准權限 —— 一行指令裝好即用，不改動原工具的任何設定與資料庫。

<p align="center">
  <img src="docs/tutorial/01-desktop-console.png" alt="Agent Control 桌面端主控制台" width="760" />
</p>

## 🔒 安全與隱私邊界

- **唯讀解析本地紀錄**：僅以唯讀方式讀取 `~/.codex`、`~/.claude`、`~/.gemini`，絕不修改上游工具資料庫。
- **對話不上傳第三方雲端**：所有程式碼與對話留在你的本機；遠端控制透過一次性配對碼與安全 Cookie 保護。
- **內建多語言介面**：支援 `English`、`繁體中文`、`简体中文`、`日本語`、`한국어`（右上角選單即時切換）。

## ⚡ 一行指令安裝（需 Node.js 22+ 與 Git）

**macOS / Linux：**
```bash
curl -fsSL https://raw.githubusercontent.com/guuguo/agent-control/main/install.sh | bash
```

**Windows (PowerShell)：**
```powershell
(irm https://raw.githubusercontent.com/guuguo/agent-control/main/install.ps1).TrimStart([char]0xFEFF) | iex
```

## ✨ 核心功能

- **多帳號與多引擎總控**：自動區分多個 Codex 帳號與額度，並整合 Claude Code / Antigravity / Grok 工作階段。
- **手機掃碼遠端核准**：離開座位也能即時查看程式碼 Diff、批核權限、中斷或排隊派發下一條指令。
- **5 種遠端方案自由切換**：Cloudflare 免費臨時通道（預設）、Tailscale Funnel（免費固定 `*.ts.net`）、Cloudflare Named Tunnel、Docker / Sealos 自託管中繼、僅限本機。
- **免持語音總控**：支援 VAD 自動斷句、打斷與背景任務完成/待核准語音播報。

更多說明：[英文版 README](README.en.md) · [簡體中文完整教學](README.md) · [Antigravity 多語言無損啟動器](https://github.com/guuguo/antigravity-zh-launcher) · [官網主頁](https://hub.guuguo.top/agent-control) · [遠端部署指南](docs/remote-deploy.md) · [MIT 授權](LICENSE)
