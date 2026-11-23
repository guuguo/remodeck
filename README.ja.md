[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [繁體中文](README.zh-TW.md)

# Agent Control

> **Codex**・**Claude Code**・**Antigravity**・**Grok** を PC とスマホから一括管理できるセルフホスト型リモートコンソール。1 行のコマンドで導入でき、元ツールの設定や履歴 DB は一切変更しません。

<p align="center">
  <img src="docs/tutorial/01-desktop-console-ja.png" alt="Agent Control デスクトップコンソール" width="760" />
</p>

## 🔒 セキュリティとプライバシー

- **読み取り専用インデックス**：`~/.codex`・`~/.claude`・`~/.gemini` の履歴を読み取り専用で参照し、元のデータベースを書き換えません。
- **ローカル完結・クラウド保存なし**：会話やコードは自分のマシンに留まります。リモート接続時もワンタイムペアリングコードと認証 Cookie で保護されます。
- **多言語 UI 内蔵**：`English` / `日本語` / `한국어` / `简体中文` / `繁體中文` に対応（右上のメニューから即時切り替え可能）。

## ⚡ ワンラインインストール（Node.js 22+ / Git 必須）

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/guuguo/agent-control/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
(irm https://raw.githubusercontent.com/guuguo/agent-control/main/install.ps1).TrimStart([char]0xFEFF) | iex
```

## ✨ 主な機能

- **複数アカウント・複数エージェント統合**：複数 Codex アカウントのクォータ自動判別、Claude Code / Antigravity / Grok のセッションをプロジェクト単位で統合管理。
- **スマホ QR リモート承認**：外出先から進捗確認、権限承認・拒否、割り込み停止、キュー追加が可能。
- **5 つの接続方式**：Cloudflare 無料一時トンネル（デフォルト）、Tailscale Funnel（無料固定 `*.ts.net`）、Cloudflare Named Tunnel、Docker / Sealos 自前リレー、ローカル専用。
- **ハンズフリー音声コントロール**：運転中や作業中に VAD 音声でタスク状況確認や承認が可能。

詳細ガイド：[英語 README](README.en.md) · [簡体字中国語 README](README.md) · [Antigravity 多言語ランチャー](https://github.com/guuguo/antigravity-zh-launcher) · [公式サイト](https://hub.guuguo.top/agent-control) · [リモートデプロイ手順](docs/remote-deploy.md) · [AGPL-3.0 ライセンス](LICENSE)
