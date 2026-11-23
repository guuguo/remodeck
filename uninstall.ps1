param(
  [string]$InstallDir = "$env:LOCALAPPDATA\agent-control\app",
  [switch]$Purge
)

$ErrorActionPreference = "Stop"

Write-Host "[1/3] 正在停止并移除 Windows 自启任务..." -ForegroundColor Cyan
$serviceScript = Join-Path $InstallDir "scripts\service.mjs"
if ((Test-Path $serviceScript) -and (Get-Command node -ErrorAction SilentlyContinue)) {
  & node $serviceScript uninstall
} else {
  try { & schtasks /Delete /TN AgentControl /F 2>$null | Out-Null } catch {}
}

Write-Host "[2/3] 正在移除桌面快捷方式与程序目录..." -ForegroundColor Cyan
$desktopDir = [Environment]::GetFolderPath("Desktop")
if ($desktopDir) {
  $shortcutPath = Join-Path $desktopDir "Agent Control.url"
  if (Test-Path $shortcutPath) { Remove-Item -Force $shortcutPath }
}

if (Test-Path $InstallDir) {
  Remove-Item -Recurse -Force $InstallDir
  Write-Host "已移除: $InstallDir"
}

if ($Purge) {
  $dataDir = if ($env:AGENT_CONTROL_DATA_DIR) { $env:AGENT_CONTROL_DATA_DIR } else { Join-Path $env:APPDATA "Agent Control" }
  if (Test-Path $dataDir) {
    Remove-Item -Recurse -Force $dataDir
    Write-Host "已清除数据目录: $dataDir"
  }
}

Write-Host "[3/3] RemoDeck (Agent Control) 卸载完成。" -ForegroundColor Green
