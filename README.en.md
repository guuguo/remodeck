[简体中文](README.md) · **English** · [日本語](README.ja.md) · [한국어](README.ko.md) · [繁體中文](README.zh-TW.md)

<h1 align="center">RemoDeck</h1>

<p align="center">
  <strong>Self-hosted desktop &amp; mobile remote control console for Codex, Claude Code, Antigravity, Grok, and Qoder</strong> <em>(formerly Agent Control)</em>.<br />
  Monitor live progress in a 2D board or 3D Dream Factory view, approve tool permissions by tap or voice, track multi-account quotas, and queue follow-ups from any browser.
</p>

<p align="center">
  <a href="https://hub.guuguo.top/agent-control"><img src="https://img.shields.io/badge/Website-hub.guuguo.top-0ea5e9?style=flat-square" alt="Website" /></a>
  <img src="https://img.shields.io/badge/Node.js-22%2B-339933?style=flat-square&logo=node.js&logoColor=white" alt="Node.js 22+" />
  <img src="https://img.shields.io/badge/OS-macOS%20%7C%20Linux%20%7C%20Windows-64748b?style=flat-square" alt="OS" />
  <img src="https://img.shields.io/badge/UI%20Languages-EN%20%7C%20%E7%AE%80%20%7C%20%E7%B9%81%20%7C%20%E6%97%A5%20%7C%20%ED%95%9C-8b5cf6?style=flat-square" alt="5 UI Languages" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-22c55e?style=flat-square" alt="MIT" /></a>
</p>

> **Supported Agents**: OpenAI Codex (multi-account quota separation) · Anthropic Claude Code · Google Antigravity · Grok · Qoder CLI  
> **Desktop & Service**: macOS (native `Agent Control.app`) · Linux (GTK/WebKitGTK window + `systemd` user service) · Windows (standalone app window + CLI)<br>
> **Architecture**: Strictly read-only upstream indexing · Local HTTP/SSE server (`127.0.0.1:43310`) · Zero external database dependency  
> **Remote Access**: `$0` Cloudflare Quick Tunnel (default) · `$0` Tailscale Funnel · `$0` Named Tunnel · Self-hosted Docker / Sealos Relay

<p align="center">
  <img src="docs/tutorial/00-demo-overview-en.gif" alt="Agent Control 14s animated overview: 3D Dream Factory, Multi-Account Console, 5s QR Mobile Control, and Driving Voice Approvals" width="760" /><br />
  <sub>14s overview: 3D Dream Factory · Multi-Account Console · 5s QR Mobile Control · Hands-Free Driving Voice Approvals</sub>
</p>

> [!IMPORTANT]
> **Security & Privacy Guarantee (Read Before Installing)**
> - **Strictly Read-Only Upstream Indexing**: Reads `~/.codex`, `~/.claude`, and `~/.gemini` histories in read-only mode. Custom titles, tags, pins, and archives live separately in RemoDeck's (Agent Control's) own data directory—your upstream databases and configs are **never** modified.
> - **Zero Cloud Prompt Storage**: Your code, prompts, and conversation histories never touch a third-party cloud database. Remote access routes directly through your chosen tunnel or self-hosted relay, protected by one-time pairing codes and HTTP-only session cookies.
> - **No Credential Scraping**: Multi-profile discovery only inspects explicit environment variables, public LaunchAgent paths, and display metadata (email/label)—never tokens or API keys.

---

## 🔄 Why RemoDeck?

| Workflow | Multi-Engine Support | Multi-Account Codex Quotas | Remote & Voice Control | Setup & Desktop Experience |
| --- | :---: | :---: | :---: | :---: |
| Multiple IDE / Terminal Windows | ❌ Separate apps | ❌ Guess by terminal | ❌ Stuck at desk | High memory usage |
| Single-Engine Bot / Web Bridges | ❌ Usually Codex or Claude only | ❌ | ⚠️ Manual bot / Tailscale setup | ❌ Web-only or headless |
| **RemoDeck** | ✅ **Codex + Claude + Antigravity + Grok + Qoder** | ✅ **Auto-detected & labeled** | ✅ **5s QR mobile UI + driving voice approvals** | ✅ **3D Dream Factory + macOS / Linux / Windows apps** |

---

## 📸 Screenshots & Core Capabilities

### 1. 3D Dream Factory · Live Workspace Overview & Natural-Language Reorg
Watch every project and running coding agent on a real-time 3D isometric floor plan—see who is actively coding, idle, or waiting on permission at a glance, click any station to inspect or send follow-ups, and reorganize the room layout with natural language.
<p align="center">
  <img src="docs/tutorial/10-dream-factory-3d.png" alt="Agent Control 3D Dream Factory Control Room" width="760" />
</p>

### 2. Desktop Console · Multi-Engine, Multi-Account & Execution Stats
Consolidate active and historical sessions by project workspace, pin key threads, switch models or reasoning effort (or hand off a thread to another agent), track per-account Codex quotas, and view real-time median / P90 latency, TTFT, and protocol token speed under **Agent Live Monitor**.
<p align="center">
  <img src="docs/tutorial/01-desktop-console-en.png" alt="Agent Control Desktop Console" width="760" />
</p>

### 3. Mobile Browser · Live Monitor, Approvals & Queued Follow-Ups
Leave your desk without losing control—inspect code diffs, approve or deny tool calls, interrupt runaway turns, manage `/goal` auto-continue runs, and queue your next prompt from your phone.
<table>
  <tr>
    <td align="center" width="50%"><strong>Project Board &amp; Multi-Agent Status</strong></td>
    <td align="center" width="50%"><strong>Rich Markdown, Diffs &amp; Turn Queue</strong></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/tutorial/05-mobile-paired-console.png" alt="Mobile Project Board" width="250" /></td>
    <td align="center"><img src="docs/tutorial/06-mobile-session-chat.png" alt="Mobile Session Chat" width="250" /></td>
  </tr>
</table>

<details open>
<summary><strong>More Core Features (Hands-Free Driving Voice Copilot · QR Remote Tunnel · Cross-Platform Auto-Update)</strong></summary>

<table>
  <tr>
    <td align="center" width="33%"><strong>🚗 Hands-Free Driving Voice Copilot</strong></td>
    <td align="center" width="33%"><strong>📱 5-Second Zero-Config QR Tunnel</strong></td>
    <td align="center" width="33%"><strong>🔄 One-Click &amp; Idle Auto-Update</strong></td>
  </tr>
  <tr>
    <td align="center"><img src="docs/tutorial/08-voice-copilot-modal.png" alt="Hands-Free Voice Copilot Modal" width="260" /></td>
    <td align="center"><img src="docs/tutorial/03-tunnel-qr-ready.png" alt="Mobile Remote Pairing and Tunnel Modal" width="260" /></td>
    <td align="center"><img src="docs/tutorial/09-update-modal.png" alt="Version Check and Auto-Update Modal" width="260" /></td>
  </tr>
</table>

- **Hands-Free Voice Copilot (`Call`)**: Keeps the screen awake, detects speech boundaries with VAD + barge-in interruption, alerts you aloud when a background task finishes or needs permission, and lets you verbally approve or reject tool calls. Uses selectable low-latency routing models (**Claude Sonnet (low)**, **GPT-6.1 Terra (low)**, **Antigravity Hydrogen / Flash**, **Grok**)—no Gemini lock-in—with local `mlx-whisper` + `edge-tts` / `say` on macOS (plus browser STT fallback and server-generated audio playback).
- **Execution Statistics (`execution-stats.json`)**: Summarizes successful turns over `24h`, `7d`, `30d`, or `All` by agent, model, and reasoning effort (median & P90 duration, first-token latency, protocol token averages, and tool counts, up to 5,000 turns). Prompt and response contents are never logged into stats.
- **Desktop App Sync & Restart**: Checks upstream commits automatically or on demand, performs smooth idle restarts when nothing is running, and rebuilds/syncs native desktop wrappers on **macOS, Windows, and Linux** by source fingerprint.

</details>

---

## ⚡ Quick Start (One-Line Install or Manual Clone)

Requires **Node.js 22+** (Node 22.13+ or 24+ recommended on Linux) and **Git**.

**macOS / Linux (one-line installer):**
```bash
curl -fsSL https://raw.githubusercontent.com/guuguo/remodeck/main/install.sh | bash
```

Linux supports a native GTK/WebKitGTK desktop window and a `systemd --user` service. See the [Linux installation guide](docs/linux.md) for desktop packages, headless servers, SSH port forwarding, containers, and WSL.

**Windows (PowerShell):**
```powershell
(irm https://raw.githubusercontent.com/guuguo/remodeck/main/install.ps1).TrimStart([char]0xFEFF) | iex
```

**Prefer inspecting and running manually without curl-pipe?**
```bash
git clone https://github.com/guuguo/remodeck.git
cd remodeck
npm install
npm start
```

1. **Open**: Launches `http://127.0.0.1:43310` automatically (and installs **Agent Control.app** in `/Applications` on macOS, or native desktop wrappers on Windows and Linux).
2. **Switch UI Language**: Auto-detects browser language (`English`, `简体中文`, `繁體中文`, `日本語`, `한국어`), or switch anytime from the top-right **More** menu.
3. **Connect Your Phone**: Click **Remote** in the top bar to generate a QR code and pair in ~5 seconds.

---

## 🌐 Remote Access Modes (Switch Anytime)

| Mode | Cost | URL Type | Best For | Highlights |
| --- | :---: | :---: | --- | --- |
| **Cloudflare Quick Tunnel (Default)** | **$0** | Temporary | Instant zero-config tryout | No account or server needed; QR ready in 5s |
| **Tailscale Funnel** | **$0** | **Permanent** (`*.ts.net`) | Daily personal mobile use | Free permanent HTTPS domain, one-click toggle |
| **Cloudflare Named Tunnel** | **$0** | **Permanent** (Custom domain) | Custom domain owners | Always-on system service on your domain |
| **Self-Hosted Docker / Sealos Relay** | Infra only | **Permanent** | Multi-device / firewalled hosts | Auto-reconnects on reboot; one-click deploy |
| **Local Only** | **$0** | — | Desktop consolidation only | No tunnel installed; switchable anytime |

👉 Full remote deployment & Docker/Sealos guide: [docs/remote-deploy.md](docs/remote-deploy.md)

---

## 📂 Project Structure & Zero-Token Local Development

- `src/server.mjs` — HTTP/SSE server (`127.0.0.1:43310`) and API routes
- `src/provider-hub.mjs` — Unified session aggregation, conflict-isolated approvals, turn queue, and `/goal` auto-continue controller
- `src/providers/` — Read-only adapters & multi-profile discovery for Codex, Claude Code, Antigravity, Grok, and Qoder CLI
- `src/remote-bridge.mjs` & `relay/relay-server.mjs` — Outbound WebSocket tunnel & self-hosted public relay
- `public/` — Zero-build ESM web UI (`public/i18n.js` for 5 languages + Three.js 3D Dream Factory)
- `desktop/` — Native app wrappers and installers for macOS (`WKWebView`), Linux (`GTK/WebKitGTK`), and Windows
- `tests/` — Zero-token mock-CLI end-to-end test suite

```bash
npm run check
npm test
```

All automated tests run against mock CLIs and consume **zero real LLM tokens**.

---

## 🗑️ Uninstall

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/guuguo/remodeck/main/uninstall.sh | bash
```

**Windows (PowerShell):**
```powershell
(irm https://raw.githubusercontent.com/guuguo/remodeck/main/uninstall.ps1).TrimStart([char]0xFEFF) | iex
```

---

## 🔗 Companion Tools

- **[antigravity-zh-launcher](https://github.com/guuguo/antigravity-zh-launcher)** — Non-intrusive 9-language launcher & AI thinking localization for Google Antigravity (zero binary modification, preserves official code signature).
- **[hub.guuguo.top](https://hub.guuguo.top)** — Indie developer tools hub by guuguo.

## Acknowledgements

- Thanks to the [LINUX DO](https://linux.do/) community for feedback, bug reports, and feature ideas.

## License

[MIT](LICENSE)
