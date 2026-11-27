#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "此安装器仅用于 Linux。" >&2
  exit 1
fi
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PYTHON_BIN="/usr/bin/python3"
if [[ ! -x "$PYTHON_BIN" ]]; then
  echo "请先安装系统 Python 3、PyGObject、GTK 3 和 WebKitGTK 4.1（见 docs/linux.md）。" >&2
  exit 1
fi
"$PYTHON_BIN" "$ROOT_DIR/desktop/linux/agent-control.py" --check
"$PYTHON_BIN" - "$ROOT_DIR" "${PORT:-43310}" <<'PY'
import os
from pathlib import Path
import shlex
import shutil
import sys

root, port = sys.argv[1:]
bin_dir = Path.home() / ".local/bin"
data = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local/share")
applications = data / "applications"
icons = data / "icons/hicolor/scalable/apps"
for directory in (bin_dir, applications, icons):
    directory.mkdir(parents=True, exist_ok=True)
launcher = bin_dir / "agent-control-desktop"
launcher.write_text('#!/usr/bin/env bash\nset -euo pipefail\nexport PORT="${PORT:-' + port + '}"\nexec /usr/bin/python3 ' + shlex.quote(str(Path(root) / "desktop/linux/agent-control.py")) + ' "$@"\n')
launcher.chmod(0o755)
shutil.copyfile(Path(root) / "desktop/linux/agent-control.svg", icons / "agent-control.svg")
# Desktop Entry 字符串转义与 shell quoting 不同，路径允许包含空格。
executable = str(launcher).replace("%", "%%")
for char in ('\\', '"', '`', '$'):
    executable = executable.replace(char, "\\" + char)
executable = executable.replace('\\', '\\\\')
desktop = applications / "com.guuguo.AgentControl.desktop"
desktop.write_text('[Desktop Entry]\nType=Application\nName=RemoteDeck\nGenericName=AI Agent Console\nComment=本机与远程多智能体控制台\nKeywords=RemoteDeck;RemoDeck;Agent Control;Codex;Claude;Antigravity;\nExec="' + executable + '"\nIcon=agent-control\nTerminal=false\nCategories=Development;Utility;\nStartupWMClass=com.guuguo.AgentControl\n')
desktop.chmod(0o755)
import json
meta_dir = Path(os.environ.get("AGENT_CONTROL_APP_INSTALL_DIR") or (data / "agent-control"))
meta_dir.mkdir(parents=True, exist_ok=True)
meta_path = meta_dir / "desktop-meta.json"
meta_path.write_text(json.dumps({
    "version": os.environ.get("AGENT_CONTROL_APP_VERSION") or "",
    "buildHash": os.environ.get("AGENT_CONTROL_BUILD_HASH") or "",
    "repoRoot": str(Path(root).resolve()),
    "appPath": str(desktop),
    "launcherPath": str(launcher),
    "platform": "linux",
}, ensure_ascii=False, indent=2) + "\n")
print("已安装桌面入口：" + str(desktop))
print("启动：agent-control open（或在应用菜单搜索 RemoteDeck）")
PY
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "${XDG_DATA_HOME:-$HOME/.local/share}/applications" || true
fi
