#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${AGENT_CONTROL_REPO_URL:-https://github.com/guuguo/remodeck.git}"
REPO_BRANCH="${AGENT_CONTROL_BRANCH:-main}"
INSTALL_DIR="${AGENT_CONTROL_HOME:-$HOME/.local/share/agent-control/app}"
PORT="${PORT:-43310}"
LOCAL_BIN="$HOME/.local/bin"

REMOTE_MODE="${AGENT_CONTROL_REMOTE:-auto}"
RELAY_URL="${AGENT_CONTROL_RELAY_URL:-}"
RELAY_INVITE="${AGENT_CONTROL_RELAY_INVITE:-}"
RELAY_LABEL="${AGENT_CONTROL_HOST_LABEL:-}"

INSTALL_SERVICE="true"
INSTALL_APP="true"
OPEN_AFTER="true"
INSTALL_SKILL="ask"

usage() {
  cat <<'EOF'
RemoDeck (原 Agent Control) 一键安装脚本 (macOS / Linux)

用法:
  curl -fsSL https://raw.githubusercontent.com/guuguo/remodeck/main/install.sh | bash
  或本地仓库运行: ./install.sh [选项]

选项:
  --remote <模式>   远程隧道方案: cloudflare | tailscale | named | relay | local（默认交互选择，非交互默认 cloudflare）
  --relay-url <URL> 自托管固定中继地址（配合 --remote relay 使用）
  --invite <邀请码> 自托管固定中继配对邀请码
  --label <名称>    本机在远程列表的显示名称
  --dir <路径>      指定安装目录（默认: ~/.local/share/agent-control/app）
  --port <端口>     指定本地控制台端口（默认: 43310）
  --no-service      仅拉取依赖，不注册开机后台服务
  --no-app          不安装原生桌面窗口与应用菜单入口
  --no-open         安装完成后不自动打开界面
  --install-skill   安装后同步内置共享记忆与任务技能到 Claude/Codex/Antigravity
  --no-skill        跳过同步内置技能提示
  -h, --help        显示帮助信息
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --remote)
      REMOTE_MODE="${2:?--remote 需要提供模式: cloudflare|tailscale|named|relay|local}"
      shift 2
      ;;
    --relay-url)
      RELAY_URL="${2:?--relay-url 需要提供 URL}"
      shift 2
      ;;
    --invite)
      RELAY_INVITE="${2:?--invite 需要提供邀请码}"
      shift 2
      ;;
    --label)
      RELAY_LABEL="${2:?--label 需要提供主机名}"
      shift 2
      ;;
    --dir)
      INSTALL_DIR="${2:?--dir 需要提供路径}"
      shift 2
      ;;
    --port)
      PORT="${2:?--port 需要提供端口号}"
      shift 2
      ;;
    --no-service)
      INSTALL_SERVICE="false"
      shift
      ;;
    --no-app)
      INSTALL_APP="false"
      shift
      ;;
    --no-open)
      OPEN_AFTER="false"
      shift
      ;;
    --install-skill)
      INSTALL_SKILL="true"
      shift
      ;;
    --no-skill)
      INSTALL_SKILL="false"
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
if [[ "$OS_NAME" != "Darwin" && "$OS_NAME" != "Linux" ]]; then
  echo "[错误] install.sh 仅支持 macOS 与 Linux。Windows 用户请使用 install.ps1。" >&2
  exit 1
fi

case "$REMOTE_MODE" in
  auto|cloudflare|tailscale|named|relay|local) ;;
  *)
    echo "[错误] --remote 仅支持 cloudflare | tailscale | named | relay | local，收到: $REMOTE_MODE" >&2
    exit 1
    ;;
esac

SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
  SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [[ "$OS_NAME" == "Darwin" ]]; then
  DEFAULT_DATA_DIR="${AGENT_CONTROL_DATA_DIR:-$HOME/Library/Application Support/Agent Control}"
else
  DEFAULT_DATA_DIR="${AGENT_CONTROL_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/agent-control}"
fi

ALREADY_INSTALLED="false"
if [[ -d "$INSTALL_DIR/.git" ]] \
  || [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/src/server.mjs" && -f "$SCRIPT_DIR/package.json" && -d "$SCRIPT_DIR/node_modules" ]] \
  || [[ -x "$LOCAL_BIN/agent-control" ]] \
  || [[ -f "$DEFAULT_DATA_DIR/remote-config.json" ]] \
  || [[ -f "$DEFAULT_DATA_DIR/control-runtime.json" ]]; then
  ALREADY_INSTALLED="true"
fi

detect_existing_remote_mode() {
  local cfg="$DEFAULT_DATA_DIR/remote-config.json"
  if [[ -f "$cfg" ]]; then
    local detected
    detected="$(grep -oE '"(mode|provider|tunnelProvider)"[[:space:]]*:[[:space:]]*"(cloudflare|tailscale|named|relay|local)"' "$cfg" 2>/dev/null | head -n 1 | sed -E 's/.*"([^"]+)"$/\1/' || true)"
    if [[ -n "$detected" ]]; then
      echo "$detected"
      return 0
    fi
  fi
  if command -v cloudflared >/dev/null 2>&1; then
    echo "cloudflare"
  else
    echo "local"
  fi
}

if [[ "$REMOTE_MODE" == "auto" ]]; then
  if [[ "$ALREADY_INSTALLED" == "true" ]]; then
    REMOTE_MODE="$(detect_existing_remote_mode)"
    echo "检测到本机已安装 Agent Control，跳过方案选择并直接更新（远程模式: ${REMOTE_MODE}）。"
  elif [[ -r /dev/tty && -w /dev/tty && "${AGENT_CONTROL_NONINTERACTIVE:-0}" != "1" ]]; then
    echo "" > /dev/tty
    echo "请选择手机远程接入方案（安装后可随时在页面或命令行切换）：" > /dev/tty
    echo "  [1] Cloudflare 免费临时隧道（默认推荐，安装 cloudflared；免服务器免注册，每次地址随机）" > /dev/tty
    echo "  [2] Tailscale Funnel 固定链接（0 元免域名，永久 https://*.ts.net）" > /dev/tty
    echo "  [3] Cloudflare Named Tunnel 固定隧道（0 元隧道，需 1 个自有 Cloudflare 域名）" > /dev/tty
    echo "  [4] 自托管固定中继（Sealos 约 ¥5~15/月 或 Docker 一键容器）" > /dev/tty
    echo "  [5] 仅本机使用（不安装额外隧道组件，后续可随时用 agent-control remote 切换）" > /dev/tty
    printf "请输入选项 [1-5]（默认 1）: " > /dev/tty
    IFS= read -r choice < /dev/tty || choice=""
    case "${choice:-1}" in
      1) REMOTE_MODE="cloudflare" ;;
      2) REMOTE_MODE="tailscale" ;;
      3) REMOTE_MODE="named" ;;
      4) REMOTE_MODE="relay" ;;
      5) REMOTE_MODE="local" ;;
      *) REMOTE_MODE="cloudflare" ;;
    esac
  else
    REMOTE_MODE="cloudflare"
  fi
fi

if [[ "$ALREADY_INSTALLED" != "true" && "$REMOTE_MODE" == "relay" && -z "$RELAY_URL" && -r /dev/tty && -w /dev/tty && "${AGENT_CONTROL_NONINTERACTIVE:-0}" != "1" ]]; then
  echo "" > /dev/tty
  echo "若已部署自托管中继，可现在直接配对（留空回车可跳过，稍后在界面配对）：" > /dev/tty
  printf "  中继地址（如 https://relay.example.com）: " > /dev/tty
  IFS= read -r RELAY_URL < /dev/tty || RELAY_URL=""
  if [[ -n "$RELAY_URL" ]]; then
    printf "  配对邀请码: " > /dev/tty
    IFS= read -r RELAY_INVITE < /dev/tty || RELAY_INVITE=""
  fi
fi

find_node_bin() {
  local candidates=()
  if command -v node >/dev/null 2>&1; then
    candidates+=("$(command -v node)")
  fi
  candidates+=(
    "/opt/homebrew/bin/node"
    "/usr/local/bin/node"
    "$HOME/.local/bin/node"
    "$HOME/.volta/bin/node"
    "$HOME/.fnm/aliases/default/bin/node"
  )
  if [[ -d "$HOME/.nvm/versions/node" ]]; then
    local nvm_node
    for nvm_node in "$HOME/.nvm/versions/node"/*/bin/node; do
      [[ -x "$nvm_node" ]] && candidates+=("$nvm_node")
    done
  fi
  local bin major
  for bin in "${candidates[@]}"; do
    if [[ -x "$bin" ]]; then
      major="$("$bin" -p "Number(process.versions.node.split('.')[0])" 2>/dev/null || echo 0)"
      if [[ "$major" -ge 22 ]]; then
        printf '%s' "$bin"
        return 0
      fi
    fi
  done
  return 1
}

NODE_BIN="$(find_node_bin || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "[错误] 需要 Node.js >= 22.0.0。" >&2
  if [[ "$OS_NAME" == "Darwin" ]]; then
    echo "请先执行: brew install node@22  或从 https://nodejs.org 下载安装。" >&2
  else
    echo "请先安装 Node.js 22+（https://nodejs.org），然后重新执行本脚本。" >&2
  fi
  exit 1
fi

NODE_DIR="$(dirname "$NODE_BIN")"
export PATH="$NODE_DIR:/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"

if ! command -v npm >/dev/null 2>&1; then
  echo "[错误] 未检测到 npm，请确认 Node.js 安装完整。" >&2
  exit 1
fi

install_cloudflared_if_missing() {
  if command -v cloudflared >/dev/null 2>&1; then
    echo "已检测到 cloudflared: $(command -v cloudflared)"
    return 0
  fi
  if [[ "$OS_NAME" == "Darwin" ]]; then
    if command -v brew >/dev/null 2>&1; then
      echo "正在通过 Homebrew 安装 cloudflared..."
      if brew install cloudflared; then
        return 0
      fi
    fi
    echo "[警告] 自动安装 cloudflared 失败，可稍后手动执行: brew install cloudflared" >&2
    return 1
  fi
  local arch cf_arch url dest
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) cf_arch="amd64" ;;
    aarch64|arm64) cf_arch="arm64" ;;
    *)
      echo "[警告] 暂不支持自动下载 $arch 架构的 cloudflared，请手动安装。" >&2
      return 1
      ;;
  esac
  url="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${cf_arch}"
  mkdir -p "$LOCAL_BIN"
  dest="$LOCAL_BIN/cloudflared"
  echo "正在下载 cloudflared ($cf_arch) 到 $dest..."
  if curl -fsSL --retry 2 --connect-timeout 15 "$url" -o "$dest"; then
    chmod +x "$dest"
    return 0
  fi
  echo "[警告] 下载 cloudflared 失败，可稍后手动安装或切换为自托管固定中继。" >&2
  return 1
}

APP_DIR=""
if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/src/server.mjs" && -f "$SCRIPT_DIR/package.json" ]]; then
  APP_DIR="$SCRIPT_DIR"
  echo "[1/5] 检测到本地源码目录，直接使用: $APP_DIR"
else
  if ! command -v git >/dev/null 2>&1; then
    echo "[错误] 缺少 git，请先安装 git（macOS 可执行 xcode-select --install 或 brew install git）。" >&2
    exit 1
  fi
  mkdir -p "$(dirname "$INSTALL_DIR")"
  if [[ -d "$INSTALL_DIR/.git" ]]; then
    echo "[1/5] 正在更新 Agent Control 源码: $INSTALL_DIR"
    git -C "$INSTALL_DIR" fetch --depth 1 origin "$REPO_BRANCH"
    git -C "$INSTALL_DIR" checkout -B "$REPO_BRANCH" "origin/$REPO_BRANCH" >/dev/null 2>&1 || git -C "$INSTALL_DIR" reset --hard "origin/$REPO_BRANCH"
  else
    echo "[1/5] 正在克隆 Agent Control 仓库到: $INSTALL_DIR"
    rm -rf "$INSTALL_DIR"
    git clone --depth 1 --branch "$REPO_BRANCH" "$REPO_URL" "$INSTALL_DIR"
  fi
  APP_DIR="$INSTALL_DIR"
fi

echo "[2/5] 正在安装运行依赖..."
(
  cd "$APP_DIR"
  npm install --omit=dev --no-audit --no-fund
)

mkdir -p "$LOCAL_BIN"
CLI_PATH="$LOCAL_BIN/agent-control"
cat > "$CLI_PATH" <<EOF
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$APP_DIR"
NODE_BIN="$NODE_BIN"
PORT="\${PORT:-$PORT}"

usage() {
  cat <<'HELP'
Agent Control 命令行工具

用法:
  agent-control [命令]

命令:
  open                 打开桌面应用或本地控制台页面（默认）
  start                安装并启动后台常驻服务
  restart              重启后台常驻服务
  stop                 停止并移除后台常驻服务
  status               查看运行状态与监听端口
  logs                 查看最近服务日志
  run                  前台运行服务（调试用）
  desktop              安装/更新当前系统的原生桌面应用
  remote <子命令>      切换或查看远程隧道方案:
                         status              查看当前隧道与中继状态
                         cloudflare [--start] 准备 Cloudflare 免费隧道（可选立即启动）
                         tailscale [--start]  准备并可选开启 Tailscale Funnel 固定链接
                         relay [--url U --code C] 绑定自托管固定中继
                         unpair              解除固定中继配对
                         stop                停止当前 Cloudflare 临时隧道
  update               从 GitHub 拉取最新版本并重启服务
  task <子命令>        管理树状任务 (list / show / new / log / done)
  memory <子命令>      读写共享记忆库 (brief / search / get / fact / decide / note)
  skill <子命令>       同步内置记忆与任务技能 (status / install / uninstall)
  uninstall            卸载 Agent Control
HELP
}

api_req() {
  local method="\$1"
  local path="\$2"
  local body="\${3:-}"
  if [[ -n "\$body" ]]; then
    curl -fsS -X "\$method" -H "Content-Type: application/json" -d "\$body" "http://127.0.0.1:\${PORT}\${path}"
  else
    curl -fsS -X "\$method" "http://127.0.0.1:\${PORT}\${path}"
  fi
}

ensure_cloudflared() {
  if command -v cloudflared >/dev/null 2>&1; then
    echo "cloudflared 已就绪: \$(command -v cloudflared)"
    return 0
  fi
  if [[ "\$(uname -s)" == "Darwin" ]]; then
    if command -v brew >/dev/null 2>&1; then
      brew install cloudflared
      return \$?
    fi
    echo "请先安装 Homebrew 或手动执行: brew install cloudflared" >&2
    return 1
  fi
  local arch cf_arch dest="\$HOME/.local/bin/cloudflared"
  arch="\$(uname -m)"
  case "\$arch" in
    x86_64|amd64) cf_arch="amd64" ;;
    aarch64|arm64) cf_arch="arm64" ;;
    *) echo "暂不支持 \$arch 架构自动下载 cloudflared" >&2; return 1 ;;
  esac
  mkdir -p "\$HOME/.local/bin"
  curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-\${cf_arch}" -o "\$dest"
  chmod +x "\$dest"
  echo "已安装 cloudflared 到 \$dest"
}

handle_remote() {
  local sub="\${1:-status}"
  shift || true
  case "\$sub" in
    status)
      api_req GET "/api/remote"
      echo ""
      ;;
    cloudflare)
      ensure_cloudflared
      if [[ "\${1:-}" == "--start" ]]; then
        api_req POST "/api/tunnel/start" "{}"
        echo ""
      else
        echo "已准备 Cloudflare 免费隧道，可在界面「手机远程」点击一键开启，或执行: agent-control remote cloudflare --start"
      fi
      ;;
    tailscale)
      if [[ "\${1:-}" == "--start" ]]; then
        api_req POST "/api/tunnel/tailscale/start" "{}"
        echo ""
      else
        echo "可在界面「手机远程 -> 固定链接隧道」一键开启 Tailscale Funnel，或执行: agent-control remote tailscale --start"
      fi
      ;;
    relay)
      local r_url="" r_code="" r_label=""
      while [[ \$# -gt 0 ]]; do
        case "\$1" in
          --url) r_url="\${2:-}"; shift 2 ;;
          --code|--invite) r_code="\${2:-}"; shift 2 ;;
          --label) r_label="\${2:-}"; shift 2 ;;
          *) echo "未知参数: \$1" >&2; exit 2 ;;
        esac
      done
      if [[ -z "\$r_url" && -r /dev/tty ]]; then
        printf "请输入中继地址 (如 https://relay.example.com): " > /dev/tty
        IFS= read -r r_url < /dev/tty || r_url=""
      fi
      if [[ -z "\$r_code" && -r /dev/tty ]]; then
        printf "请输入配对邀请码: " > /dev/tty
        IFS= read -r r_code < /dev/tty || r_code=""
      fi
      if [[ -z "\$r_url" || -z "\$r_code" ]]; then
        echo "需要提供 --url 和 --code" >&2
        exit 1
      fi
      local payload
      payload="\$("\$NODE_BIN" -e 'console.log(JSON.stringify({relayUrl:process.argv[1],inviteCode:process.argv[2],label:process.argv[3]||""}))' "\$r_url" "\$r_code" "\$r_label")"
      api_req POST "/api/remote/pair" "\$payload"
      echo ""
      ;;
    unpair)
      api_req POST "/api/remote/unpair" "{}"
      echo ""
      ;;
    stop)
      api_req POST "/api/tunnel/stop" "{}"
      echo ""
      ;;
    *)
      echo "未知 remote 子命令: \$sub (支持 status | cloudflare | relay | unpair | stop)" >&2
      exit 2
      ;;
  esac
}

cmd="\${1:-open}"
shift || true

case "\$cmd" in
  open)
    if [[ "\$(uname -s)" == "Darwin" && -d "/Applications/Agent Control.app" ]]; then
      open -a "/Applications/Agent Control.app"
    elif [[ "\$(uname -s)" == "Darwin" ]]; then
      open "http://127.0.0.1:\${PORT}"
    elif [[ -x "\$HOME/.local/bin/agent-control-desktop" ]]; then
      PORT="\$PORT" "\$HOME/.local/bin/agent-control-desktop" >/dev/null 2>&1 &
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "http://127.0.0.1:\${PORT}" >/dev/null 2>&1 &
    else
      echo "请在浏览器打开: http://127.0.0.1:\${PORT}"
    fi
    ;;
  start|install)
    PORT="\$PORT" "\$NODE_BIN" "\$APP_DIR/scripts/service.mjs" install
    ;;
  restart)
    PORT="\$PORT" "\$NODE_BIN" "\$APP_DIR/scripts/service.mjs" restart
    ;;
  stop)
    PORT="\$PORT" "\$NODE_BIN" "\$APP_DIR/scripts/service.mjs" uninstall
    ;;
  status|logs|run)
    PORT="\$PORT" "\$NODE_BIN" "\$APP_DIR/scripts/service.mjs" "\$cmd"
    ;;
  desktop)
    if [[ "\$(uname -s)" == "Linux" ]]; then
      PORT="\$PORT" bash "\$APP_DIR/desktop/linux/install-app.sh"
    else
      PORT="\$PORT" bash "\$APP_DIR/desktop/macos/build-app.sh" --install
    fi
    ;;
  remote)
    handle_remote "\$@"
    ;;
  update)
    if [[ -d "\$APP_DIR/.git" ]]; then
      git -C "\$APP_DIR" pull --ff-only
      (cd "\$APP_DIR" && npm install --omit=dev --no-audit --no-fund)
    fi
    PORT="\$PORT" "\$NODE_BIN" "\$APP_DIR/scripts/service.mjs" install
    if [[ "\$(uname -s)" == "Darwin" && -d "/Applications/Agent Control.app" ]] && command -v swiftc >/dev/null 2>&1; then
      PORT="\$PORT" bash "\$APP_DIR/desktop/macos/build-app.sh" --install
    elif [[ "\$(uname -s)" == "Linux" && -x "\$HOME/.local/bin/agent-control-desktop" ]]; then
      PORT="\$PORT" bash "\$APP_DIR/desktop/linux/install-app.sh"
    fi
    echo "Agent Control 已更新完成。"
    ;;
  uninstall)
    exec bash "\$APP_DIR/uninstall.sh" "\$@"
    ;;
  task)
    PORT="\$PORT" "\$NODE_BIN" "\$APP_DIR/scripts/ac-task.mjs" "\$@"
    ;;
  memory)
    "\$NODE_BIN" "\$APP_DIR/scripts/ac-memory.mjs" "\$@"
    ;;
  skill)
    "\$NODE_BIN" "\$APP_DIR/scripts/ac-skill.mjs" "\$@"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "未知命令: \$cmd" >&2
    usage >&2
    exit 2
    ;;
esac
EOF
chmod +x "$CLI_PATH"
ln -sf "$CLI_PATH" "$LOCAL_BIN/remodeck"

if [[ "$REMOTE_MODE" == "cloudflare" || "$REMOTE_MODE" == "named" ]]; then
  echo "[3/5] 正在配置 cloudflared ($REMOTE_MODE 模式)..."
  install_cloudflared_if_missing || true
else
  echo "[3/5] 已选择远程模式: ${REMOTE_MODE}（跳过自动安装 cloudflared，后续随时可用 agent-control remote cloudflare 补装）"
fi

if [[ "$INSTALL_SERVICE" == "true" ]]; then
  echo "[4/5] 正在注册并启动本地后台服务 (端口 $PORT)..."
  PORT="$PORT" "$NODE_BIN" "$APP_DIR/scripts/service.mjs" install
else
  echo "[4/5] 已跳过后台服务安装 (--no-service)"
fi

INSTALLED_APP_PATH=""
if [[ "$OS_NAME" == "Darwin" && "$INSTALL_APP" == "true" ]]; then
  if command -v swiftc >/dev/null 2>&1; then
    echo "[5/5] 正在构建并安装 macOS 原生桌面端 (/Applications/Agent Control.app)..."
    PORT="$PORT" bash "$APP_DIR/desktop/macos/build-app.sh" --install
    INSTALLED_APP_PATH="/Applications/Agent Control.app"
  else
    echo "[5/5] 未检测到 swiftc，已跳过原生 .app 构建（可随时安装 Xcode CLI Tools 后执行: agent-control desktop）"
  fi
elif [[ "$OS_NAME" == "Linux" && "$INSTALL_APP" == "true" ]]; then
  echo "[5/5] 正在安装 Linux 原生桌面入口..."
  if PORT="$PORT" bash "$APP_DIR/desktop/linux/install-app.sh"; then
    INSTALLED_APP_PATH="${XDG_DATA_HOME:-$HOME/.local/share}/applications/com.guuguo.AgentControl.desktop"
  else
    echo "已保留浏览器控制台。安装上述桌面依赖后执行 agent-control desktop 即可补装。"
  fi
else
  echo "[5/5] 已完成 CLI 与服务部署。"
fi

HEALTH_OK="false"
if [[ "$INSTALL_SERVICE" == "true" ]] && command -v curl >/dev/null 2>&1; then
  for _ in $(seq 1 20); do
    if curl -fsS --max-time 1 "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      HEALTH_OK="true"
      break
    fi
    sleep 0.4
  done
fi

RELAY_PAIR_NOTE=""
if [[ "$REMOTE_MODE" == "relay" && -n "$RELAY_URL" && -n "$RELAY_INVITE" && "$HEALTH_OK" == "true" ]]; then
  echo "正在配对自托管固定中继..."
  PAIR_PAYLOAD="$("$NODE_BIN" -e 'console.log(JSON.stringify({relayUrl:process.argv[1],inviteCode:process.argv[2],label:process.argv[3]||""}))' "$RELAY_URL" "$RELAY_INVITE" "$RELAY_LABEL")"
  if curl -fsS -X POST -H "Content-Type: application/json" -d "$PAIR_PAYLOAD" "http://127.0.0.1:${PORT}/api/remote/pair" >/dev/null; then
    RELAY_PAIR_NOTE="已完成固定中继配对 ($RELAY_URL)"
  else
    RELAY_PAIR_NOTE="自动配对失败，请在界面「手机远程 -> 自托管固定中继」中重试"
  fi
elif [[ "$REMOTE_MODE" == "relay" ]]; then
  RELAY_PAIR_NOTE="待配对（可在界面「手机远程 -> 自托管固定中继」或执行 agent-control remote relay 完成绑定）"
fi

if [[ "$INSTALL_SKILL" == "true" ]]; then
  echo "正在同步内置共享记忆与任务技能到本机 Agent 客户端..."
  "$NODE_BIN" "$APP_DIR/scripts/ac-skill.mjs" install || true
elif [[ "$INSTALL_SKILL" == "ask" && -r /dev/tty && -w /dev/tty && "${AGENT_CONTROL_NONINTERACTIVE:-0}" != "1" ]]; then
  printf "是否同步内置共享记忆与任务技能 (remodeck-memory) 到 Claude/Codex/Antigravity？[Y/n]: " > /dev/tty
  IFS= read -r skill_choice < /dev/tty || skill_choice=""
  case "${skill_choice:-Y}" in
    n|N|no|NO)
      echo "已跳过技能同步，稍后可在控制台「版本与更新 -> 设置」或执行 remodeck skill install 随时开启。"
      ;;
    *)
      "$NODE_BIN" "$APP_DIR/scripts/ac-skill.mjs" install || true
      ;;
  esac
fi

echo ""
echo "=================================================="
echo "  RemoDeck (Agent Control) 安装完成"
echo "=================================================="
echo "  源码目录: $APP_DIR"
echo "  本地控制台: http://127.0.0.1:${PORT}"
if [[ -n "$INSTALLED_APP_PATH" ]]; then
  echo "  桌面应用: $INSTALLED_APP_PATH"
fi
echo "  命令行工具: $LOCAL_BIN/remodeck（兼容别名: $CLI_PATH）"
echo "  远程接入模式: ${REMOTE_MODE}（可在界面「手机远程」或 remodeck remote 随时切换）"
if [[ -n "$RELAY_PAIR_NOTE" ]]; then
  echo "  中继状态: $RELAY_PAIR_NOTE"
fi
if [[ "$INSTALL_SERVICE" == "true" ]]; then
  if [[ "$HEALTH_OK" == "true" ]]; then
    echo "  服务状态: 运行中 (http://127.0.0.1:${PORT}/health 正常)"
  else
    echo "  服务状态: 已配置（如端口尚未就绪，可执行 remodeck logs 查看日志）"
  fi
fi
echo ""
echo "  常用命令:"
echo "    remodeck open                打开控制台"
echo "    remodeck remote status       查看当前隧道/中继状态"
echo "    remodeck remote cloudflare   切换/准备 Cloudflare 免费隧道"
echo "    remodeck remote tailscale    开启 Tailscale Funnel 固定链接"
echo "    remodeck remote relay        切换/绑定自托管固定中继"
echo "    remodeck update              一键升级到最新版"
echo "    remodeck uninstall           卸载"
if [[ ":$PATH:" != *":$LOCAL_BIN:"* ]]; then
  echo ""
  echo "  提示: 请将 ~/.local/bin 加入 PATH，或直接使用 $LOCAL_BIN/remodeck"
fi
echo ""
echo "  If this helps you, consider giving it a Star: https://github.com/guuguo/remodeck"
echo "=================================================="

if [[ "$OPEN_AFTER" == "true" && "$INSTALL_SERVICE" == "true" ]]; then
  if [[ "$OS_NAME" == "Darwin" && -n "$INSTALLED_APP_PATH" ]]; then
    open -a "$INSTALLED_APP_PATH" >/dev/null 2>&1 || true
  elif [[ "$OS_NAME" == "Darwin" ]]; then
    open "http://127.0.0.1:${PORT}" >/dev/null 2>&1 || true
  elif [[ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ]]; then
    "$CLI_PATH" open
  fi
fi
