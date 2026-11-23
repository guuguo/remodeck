#!/usr/bin/env bash
set -euo pipefail

INSTALL_DIR="${AGENT_CONTROL_HOME:-$HOME/.local/share/agent-control/app}"
LOCAL_BIN="$HOME/.local/bin"
CLI_PATH="$LOCAL_BIN/agent-control"
PURGE="false"

usage() {
  cat <<'EOF'
RemoDeck (原 Agent Control) 一键卸载脚本 (macOS / Linux)

用法:
  curl -fsSL https://raw.githubusercontent.com/guuguo/remodeck/main/uninstall.sh | bash
  ./uninstall.sh [--purge]

选项:
  --purge   同时删除本地用户元数据、日志与配对凭证目录
  -h, --help 显示帮助信息
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --purge)
      PURGE="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "[错误] 未知参数: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

OS_NAME="$(uname -s)"

echo "[1/3] 正在停止并移除后台服务..."
if [[ -f "$INSTALL_DIR/scripts/service.mjs" ]] && command -v node >/dev/null 2>&1; then
  node "$INSTALL_DIR/scripts/service.mjs" uninstall || true
elif [[ "$OS_NAME" == "Darwin" ]]; then
  PLIST_PATH="$HOME/Library/LaunchAgents/com.guuguo.agent-control.plist"
  if [[ -f "$PLIST_PATH" ]]; then
    launchctl unload "$PLIST_PATH" >/dev/null 2>&1 || true
    rm -f "$PLIST_PATH"
    echo "已移除 LaunchAgent: $PLIST_PATH"
  fi
elif [[ "$OS_NAME" == "Linux" ]]; then
  UNIT_PATH="$HOME/.config/systemd/user/agent-control.service"
  if [[ -f "$UNIT_PATH" ]]; then
    systemctl --user disable --now agent-control.service >/dev/null 2>&1 || true
    rm -f "$UNIT_PATH"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    echo "已移除 systemd 用户服务: $UNIT_PATH"
  fi
fi

echo "[2/3] 正在移除桌面应用与命令行入口..."
if [[ "$OS_NAME" == "Darwin" && -d "/Applications/Agent Control.app" ]]; then
  rm -rf "/Applications/Agent Control.app"
  echo "已移除 /Applications/Agent Control.app"
fi
if [[ "$OS_NAME" == "Linux" ]]; then
  DESKTOP_DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
  rm -f "$LOCAL_BIN/agent-control-desktop" \
    "$DESKTOP_DATA/applications/com.guuguo.AgentControl.desktop" \
    "$DESKTOP_DATA/icons/hicolor/scalable/apps/agent-control.svg"
fi

if [[ -f "$CLI_PATH" ]]; then
  rm -f "$CLI_PATH"
  echo "已移除 $CLI_PATH"
fi
if [[ -L "$LOCAL_BIN/remodeck" || -f "$LOCAL_BIN/remodeck" ]]; then
  rm -f "$LOCAL_BIN/remodeck"
  echo "已移除 $LOCAL_BIN/remodeck"
fi

echo "[3/3] 正在清理安装目录..."
if [[ -d "$INSTALL_DIR" ]]; then
  rm -rf "$INSTALL_DIR"
  echo "已移除 $INSTALL_DIR"
fi

if [[ "$PURGE" == "true" ]]; then
  if [[ "$OS_NAME" == "Darwin" ]]; then
    DATA_DIR="${AGENT_CONTROL_DATA_DIR:-$HOME/Library/Application Support/Agent Control}"
  else
    DATA_DIR="${AGENT_CONTROL_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/agent-control}"
  fi
  if [[ -d "$DATA_DIR" ]]; then
    rm -rf "$DATA_DIR"
    echo "已清除数据目录: $DATA_DIR"
  fi
else
  echo "已保留用户元信息与日志目录（如需彻底删除请附带 --purge）"
fi

echo "RemoDeck (Agent Control) 卸载完成。"
