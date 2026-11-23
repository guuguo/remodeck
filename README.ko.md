[简体中文](README.md) · [English](README.en.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [繁體中文](README.zh-TW.md)

# Agent Control

> **Codex**, **Claude Code**, **Antigravity**, **Grok**을 PC와 스마트폰에서 하나로 제어하는 셀프 호스팅 원격 콘솔입니다. 한 줄 명령어로 설치되며 기존 도구의 설정이나 DB를 절대 수정하지 않습니다.

<p align="center">
  <img src="docs/tutorial/01-desktop-console-ko.png" alt="Agent Control 데스크톱 콘솔" width="760" />
</p>

## 🔒 보안 및 프라이버시 원칙

- **읽기 전용 인덱싱**: `~/.codex`, `~/.claude`, `~/.gemini` 기록을 읽기 전용으로만 읽어 원본 데이터베이스를 건드리지 않습니다.
- **제3자 클라우드 저장 없음**: 모든 코드와 대화는 로컬 머신에 유지되며, 원격 접속 시에도 일회용 페어링 코드와 인증 쿠키로 보호됩니다.
- **다국어 UI 내장**: `English`, `한국어`, `日本語`, `简体中文`, `繁體中文` 지원 (우측 상단 메뉴에서 즉시 전환 가능).

## ⚡ 한 줄 설치 (Node.js 22+ / Git 필요)

**macOS / Linux:**
```bash
curl -fsSL https://raw.githubusercontent.com/guuguo/agent-control/main/install.sh | bash
```

**Windows (PowerShell):**
```powershell
(irm https://raw.githubusercontent.com/guuguo/agent-control/main/install.ps1).TrimStart([char]0xFEFF) | iex
```

## ✨ 주요 기능

- **다중 계정 및 다중 에이전트 통합**: 여러 Codex 계정의 할당량 자동 구분 및 Claude Code / Antigravity / Grok 세션을 프로젝트별로 통합 관리.
- **모바일 QR 원격 승인**: 외출 중에도 진행 상황 확인, 권한 승인/거부, 실행 중단, 대기열 지시 전송 가능.
- **5가지 원격 연결 옵션**: Cloudflare 무료 임시 터널(기본), Tailscale Funnel(무료 고정 `*.ts.net`), Cloudflare Named Tunnel, Docker/Sealos 셀프 호스팅 릴레이, 로컬 전용.
- **핸즈프리 음성 제어**: 운전 중이나 이동 중에도 VAD 음성으로 상태 확인 및 승인 처리 지원.

자세한 내용: [영문 README](README.en.md) · [중국어 간체 README](README.md) · [Antigravity 다국어 런처](https://github.com/guuguo/antigravity-zh-launcher) · [공식 사이트](https://hub.guuguo.top/agent-control) · [원격 배포 가이드](docs/remote-deploy.md) · [MIT 라이선스](LICENSE)
