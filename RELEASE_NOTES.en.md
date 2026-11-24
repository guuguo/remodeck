# Agent Control Release Notes

> Plain-language English release notes for end users covering key additions, improvements, and fixes in each version. Keep this file in sync with `RELEASE_NOTES.md` whenever user-visible changes ship; the in-app "Version & Updates" modal loads it automatically for non-Chinese UI locales.

## In development (2026-11-24) — In-Car Voice: Full Sentences, Accurate Project Names, Ask-Back

Summary: Fixed the issues that hurt voice use while driving most — sentences cut in half, misheard project names, and replies that ran too long.

### Added

- **"Heard you" chime**: Voice calls and the Sprite Assistant play a short chime when they catch the end of what you said, so you know it was received without looking.
- **Ask-back when a project isn't found**: Instead of reading out a technical error, voice now asks "A or B?" — just say the project name to continue.

### Improved

- **Sentences stay whole**: Pauses of up to 1.6 seconds no longer split one sentence into two, so you can think mid-sentence while driving.
- **Better project-name recognition**: Speech recognition now prefers the more accurate Whisper turbo model and is primed with your project names and common terms.
- **Clearer audio**: The microphone filter now keeps more high-frequency detail, which helps with sounds like "s" and "sh".
- **Shorter replies**: Spoken replies lead with the conclusion and stay within a sentence or two.

### Fixed

- **Nothing is lost while the AI is busy**: Extra sentences spoken while the AI was thinking or talking used to be dropped; they are now stitched together and sent in full.
- **Sprite barge-in keeps your first words**: Interrupting the Sprite while it speaks no longer loses the start of what you said.

## v0.2.4 (2026-11-21) — 3D Dream Factory Polish, LAN Switch & Anonymous Usage Ping

Summary: Upgraded the 3D Dream Factory overview and Sprite Assistant, added quick LAN access switching, improved file/image previewing, and introduced an opt-out anonymous startup ping.

### Added

- **Quick LAN Access Switching**: View and switch local network URLs directly so phones and tablets on the same Wi-Fi can connect effortlessly.
- **Opt-Out Anonymous Usage Ping**: Sends a lightweight startup/daily ping containing only a hashed instance ID, version, OS, arch, and Node major version; disable anytime via `AGENT_CONTROL_DISABLE_TELEMETRY=1` or `DO_NOT_TRACK=1`.

### Improved

- **3D Dream Factory & Sprite Assistant**: Enhanced 3D workspace visuals, mission overview sync, and sprite status feedback.
- **Higher AGY Auto-Compact Threshold**: Allows raising the Antigravity pre-send auto-compact threshold up to 900K tokens.
- **Markdown File Links & Image Preview**: Refined local file link resolution and image preview sizing inside chat replies.

### Fixed

- **Hide Background Console Windows on Windows**: Fixed `git`, `sqlite3`, `codex`, and voice worker spawns occasionally flashing blank console windows on Windows during overview, quota, or profile discovery refreshes.

## v0.2.3 (2026-11-19) — Inline Mermaid Diagrams, Unarchive & Clearer Execution Stats

Summary: Render Mermaid flowcharts inline in chat, unarchive archived Codex sessions in one click, read human-friendly model speed stats, and view dedicated user-facing release notes.

### Added

- **Auto-Compact AGY Context Before Sending**: When an Antigravity session's context has grown about 60K tokens since its last compaction (adjustable or off in Settings), it is compacted automatically right before your next message is sent, with nothing lost or re-queued, which saves a lot of weekly quota.
- **Inline Mermaid Diagram Rendering**: Flowcharts, sequence diagrams, and state diagrams in replies automatically render as crisp vector diagrams with fullscreen zoom and source-code toggle.
- **One-Click Codex Unarchive**: Unarchive an archived Codex thread directly from the composer banner or error bar without switching back to the native CLI.
- **Scheduled Task Auto-Unarchive Fallback**: Managed scheduled tasks automatically unarchive an archived target thread—or fall back to a fresh session when needed—so overnight automations keep running.
- **Dedicated User-Facing Release Notes**: The update modal highlights clear Added, Improved, and Fixed takeaways for end users while keeping raw git commits collapsible on demand.

### Improved

- **Plain-Language Execution Stats**: Summary cards surface fastest time-to-first-token, output speed (tok/s), fastest completion, and top model directly instead of obscure percentages.
- **Full Model Badge Labels**: Fixed truncation for long model names (Neon, 3.8 Flash, GPT-6.2-ASTRA) and custom multi-account labels inside status badges.
- **3D Dream Factory & Cross-Platform Desktops**: Supports natural-language Dream Factory layout reorg, system-matching light/dark desktop window themes, and smoother Windows / Linux installation and self-updates.
- **Daylight Contrast & Mobile Ergonomics**: Refined light-theme contrast, mobile long-press session menus, forked thread merging, and large history loading.

### Fixed

- **Token Speed Calibration**: Fixed legacy stats caches stuck on "No speed data" and filtered inflated throughput spikes caused by replayed historical messages.
- **Per-Thread `/goal` State Isolation**: Fixed switching between threads sharing stale `/goal` auto-continue composer state.

## v0.2.2 (2026-11-16) — Faster Voice Copilot Models & Stability Improvements

Summary: Sped up lightweight voice routing models, accelerated huge session loads, and added an in-modal Restart Service button.

### Added

- **In-Modal Service Restart**: Restart the managed background service directly from the update modal with clear inline error diagnostics if restart fails.
- **Cross-Agent Handoff & Qoder CLI**: Resume existing sessions with a different agent, pick models/reasoning levels freely, and manage local Qoder CLI sessions.

### Improved

- **Lower-Latency Voice Copilot**: Switched lightweight voice routing to Claude Sonnet / GPT-6.1 Terra low-reasoning modes to shorten back-and-forth pauses.
- **Large History Performance**: Significantly faster loading and pagination for multi-thousand-line transcripts.

### Fixed

- **Windows Self-Update & Path Compatibility**: Stopped self-updates from terminating the restart helper (`taskkill /T`) and fixed installs under usernames or paths containing spaces or non-ASCII characters.

## v0.2.0 (2026-11-16) — Auto-Update Panel & Unified Multi-Agent Monitor

Summary: Added cross-device update checks, idle auto-restart, fingerprint-tracked desktop app sync, and upgraded the 4-agent live monitor.

### Added

- **One-Click & Idle Auto-Update**: Check for remote updates from desktop or phone and automatically pull + restart cleanly when the working tree is clean and no turns are running.
- **Desktop Shell Sync**: Tracks native desktop wrapper version and source fingerprint so server updates automatically rebuild and sync the desktop app when needed.

### Improved

- **Multi-Agent HUD & Account Aliases**: Upgraded live status, queue counters, and automatic multi-account labels across Codex, Claude Code, Antigravity, and Grok.

## v0.1.0 (2026-11-16) — Initial Public Release

Summary: Introduced the unified local multi-agent console, zero-config QR mobile relay, and native macOS desktop shell.

### Added

- **Unified Multi-Agent Management**: Consolidated Codex, Claude Code, and Antigravity sessions with live streaming, interruption, turn queuing, and remote follow-ups.
- **QR Mobile Pairing & Desktop App**: Built-in Cloudflare Quick Tunnel QR pairing, self-hosted relay support, and a native macOS `Agent Control.app` wrapper.
