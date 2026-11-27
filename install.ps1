param(
  [ValidateSet("auto", "cloudflare", "tailscale", "named", "relay", "local")]
  [string]$Remote = "auto",
  [string]$RelayUrl = "",
  [string]$InviteCode = "",
  [string]$HostLabel = "",
  [string]$InstallDir = "$env:LOCALAPPDATA\agent-control\app",
  [int]$Port = 43310,
  [switch]$NoService,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
try {
  [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {}

$RepoUrl = if ($env:AGENT_CONTROL_REPO_URL) { $env:AGENT_CONTROL_REPO_URL } else { "https://github.com/guuguo/remodeck.git" }
$RepoBranch = if ($env:AGENT_CONTROL_BRANCH) { $env:AGENT_CONTROL_BRANCH } else { "main" }

function Resolve-AgentControlDataDir {
  $custom = "$($env:AGENT_CONTROL_DATA_DIR)".Trim()
  if ($custom) { return $custom }
  $base = "$($env:APPDATA)".Trim()
  if (-not $base) { $base = "$($env:LOCALAPPDATA)".Trim() }
  if (-not $base) { $base = [Environment]::GetFolderPath("ApplicationData") }
  if (-not $base) { $base = Join-Path $HOME "AppData\Roaming" }
  return (Join-Path $base "Agent Control")
}

function Show-AgentControlTroubleshoot {
  param(
    [string]$Reason,
    [string]$AppPath,
    [string]$DataDir,
    [int]$ListenPort
  )
  $logDir = Join-Path $DataDir "logs"
  $stderrLog = Join-Path $logDir "stderr.log"
  $stdoutLog = Join-Path $logDir "stdout.log"
  $leaseFile = Join-Path $DataDir "control-runtime.json"

  Write-Host ""
  Write-Host "==================================================" -ForegroundColor Red
  Write-Host "  RemoDeck (Agent Control) 安装或启动失败" -ForegroundColor Red
  Write-Host "==================================================" -ForegroundColor Red
  if ($Reason) {
    Write-Host "  错误原因: $Reason" -ForegroundColor Red
  }
  if ($AppPath) {
    Write-Host "  源码目录: $AppPath"
  }
  Write-Host "  数据目录: $DataDir"
  Write-Host "  错误日志: $stderrLog"
  Write-Host "  输出日志: $stdoutLog"
  Write-Host "  运行租约: $leaseFile"

  foreach ($logFile in @($stderrLog, $stdoutLog)) {
    if (Test-Path -LiteralPath $logFile) {
      try {
        $tail = Get-Content -LiteralPath $logFile -Encoding UTF8 -Tail 30 -ErrorAction SilentlyContinue
        if ($tail) {
          Write-Host ""
          Write-Host "--- 最近日志 ($logFile) ---" -ForegroundColor Yellow
          $tail | ForEach-Object { Write-Host $_ }
        }
      } catch {}
    }
  }

  Write-Host ""
  Write-Host "--- 排查路径（可按顺序复制到 PowerShell 执行） ---" -ForegroundColor Cyan
  if ($AppPath -and (Test-Path -LiteralPath $AppPath)) {
    Write-Host "  1) 进入安装目录:   cd `"$AppPath`""
    Write-Host "  2) 查看服务状态:   node scripts\service.mjs status"
    Write-Host "  3) 查看完整日志:   node scripts\service.mjs logs"
    Write-Host "  4) 前台运行排障:   node scripts\service.mjs run"
    Write-Host "  5) 更换端口重试:   `$env:PORT=$(if ($ListenPort -eq 43310) { 43315 } else { $ListenPort + 1 }); node scripts\service.mjs restart"
  } else {
    Write-Host "  1) 检查网络与 Git/Node 环境后重试安装命令"
    Write-Host "  2) 若路径含中文，可指定英文目录安装: `$env:AGENT_CONTROL_DATA_DIR='D:\agent-control-data'"
  }
  Write-Host "==================================================" -ForegroundColor Red
}

$appDir = $null
$dataDir = Resolve-AgentControlDataDir

try {
  $hasLocalRepo = ($PSScriptRoot -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot "src\server.mjs")) -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot "package.json")) -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot "node_modules")))
  $alreadyInstalled = (
    (Test-Path -LiteralPath (Join-Path $InstallDir ".git")) -or
    $hasLocalRepo -or
    (Test-Path -LiteralPath (Join-Path $dataDir "remote-config.json")) -or
    (Test-Path -LiteralPath (Join-Path $dataDir "control-runtime.json"))
  )

  if ($Remote -eq "auto") {
    if ($env:AGENT_CONTROL_REMOTE -in @("cloudflare", "tailscale", "named", "relay", "local")) {
      $Remote = $env:AGENT_CONTROL_REMOTE
    } elseif ($alreadyInstalled) {
      $detectedRemote = ""
      $cfgPath = Join-Path $dataDir "remote-config.json"
      if (Test-Path -LiteralPath $cfgPath) {
        try {
          $cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
          foreach ($candidate in @($cfg.mode, $cfg.provider, $cfg.tunnelProvider)) {
            if ($candidate -in @("cloudflare", "tailscale", "named", "relay", "local")) {
              $detectedRemote = [string]$candidate
              break
            }
          }
        } catch {}
      }
      if (-not $detectedRemote) {
        $detectedRemote = if (Get-Command cloudflared -ErrorAction SilentlyContinue) { "cloudflare" } else { "local" }
      }
      $Remote = $detectedRemote
      Write-Host "检测到本机已安装 Agent Control，跳过方案选择并直接更新（远程模式: $Remote）。" -ForegroundColor Cyan
    } elseif ([Environment]::UserInteractive) {
      Write-Host ""
      Write-Host "请选择手机远程接入方案（安装后可随时在页面切换）：" -ForegroundColor Cyan
      Write-Host "  [1] Cloudflare 免费临时隧道（默认推荐，自动检测安装 cloudflared；免服务器，每次地址随机）"
      Write-Host "  [2] Tailscale Funnel 固定链接（0 元免域名，永久 https://*.ts.net）"
      Write-Host "  [3] Cloudflare Named Tunnel 固定隧道（0 元隧道，需 1 个自有 Cloudflare 域名）"
      Write-Host "  [4] 自托管固定中继（Sealos 约 ¥5~15/月 或 Docker 一键容器）"
      Write-Host "  [5] 仅本机使用（不安装额外隧道组件，后续随时可切换）"
      $choice = Read-Host "请输入选项 [1-5]（默认 1）"
      switch ($choice) {
        "2" { $Remote = "tailscale" }
        "3" { $Remote = "named" }
        "4" { $Remote = "relay" }
        "5" { $Remote = "local" }
        default { $Remote = "cloudflare" }
      }
    } else {
      $Remote = "cloudflare"
    }
  }

  if (-not $alreadyInstalled -and $Remote -eq "relay" -and -not $RelayUrl -and [Environment]::UserInteractive) {
    $RelayUrl = Read-Host "请输入自托管中继地址（留空跳过，稍后在界面配对）"
    if ($RelayUrl) {
      $InviteCode = Read-Host "请输入配对邀请码"
    }
  }

  Write-Host "[1/5] 检查 Node.js (>= 22) 与 Git 环境..." -ForegroundColor Cyan
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) {
    throw "未检测到 Node.js。请先安装 Node.js 22+：winget install OpenJS.NodeJS.LTS"
  }

  $nodeMajor = [int](& node -p "Number(process.versions.node.split('.')[0])")
  if ($nodeMajor -lt 22) {
    throw "当前 Node.js 版本过低（需要 >= 22.0.0）：$(& node -v)。请升级后重试。"
  }

  if ($PSScriptRoot -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot "src\server.mjs")) -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot "package.json"))) {
    $appDir = $PSScriptRoot
    Write-Host "[2/5] 使用本地源码目录: $appDir" -ForegroundColor Cyan
  } else {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
      throw "未检测到 Git。请先安装 Git：winget install Git.Git"
    }
    $parentDir = Split-Path -Parent $InstallDir
    if (-not (Test-Path -LiteralPath $parentDir)) {
      New-Item -ItemType Directory -Force -Path $parentDir | Out-Null
    }
    if (Test-Path -LiteralPath (Join-Path $InstallDir ".git")) {
      Write-Host "[2/5] 正在更新仓库: $InstallDir" -ForegroundColor Cyan
      & git -c core.quotepath=false -C $InstallDir fetch --depth 1 origin $RepoBranch
      if ($LASTEXITCODE -ne 0) { throw "git fetch 失败 (exit=$LASTEXITCODE)，请检查 GitHub 网络连接或代理设置" }
      & git -c core.quotepath=false -C $InstallDir checkout -B $RepoBranch "origin/$RepoBranch"
      if ($LASTEXITCODE -ne 0) { throw "git checkout 失败 (exit=$LASTEXITCODE)" }
    } else {
      Write-Host "[2/5] 正在克隆 Agent Control 到: $InstallDir" -ForegroundColor Cyan
      if (Test-Path -LiteralPath $InstallDir) { Remove-Item -LiteralPath $InstallDir -Recurse -Force }
      & git -c core.quotepath=false clone --depth 1 --branch $RepoBranch $RepoUrl $InstallDir
      if ($LASTEXITCODE -ne 0) { throw "git clone 失败 (exit=$LASTEXITCODE)，请检查 GitHub 网络连接或代理设置" }
    }
    $appDir = $InstallDir
  }

  Write-Host "[3/5] 正在安装依赖..." -ForegroundColor Cyan
  Push-Location -LiteralPath $appDir
  try {
    & npm install --omit=dev --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm install 失败 (exit=$LASTEXITCODE)" }

    if ($Remote -eq "cloudflare" -or $Remote -eq "named") {
      Write-Host "[4/5] 正在检查 cloudflared ($Remote 模式)..." -ForegroundColor Cyan
      if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
        if (Get-Command winget -ErrorAction SilentlyContinue) {
          try {
            & winget install --id Cloudflare.cloudflared --accept-package-agreements --accept-source-agreements
          } catch {
            Write-Warning "自动安装 cloudflared 失败，可稍后手动执行：winget install --id Cloudflare.cloudflared"
          }
        } else {
          Write-Warning "未检测到 winget，请手动安装 cloudflared：winget install --id Cloudflare.cloudflared"
        }
      }
    } else {
      Write-Host "[4/5] 已选择远程模式: $Remote（跳过自动安装 cloudflared）" -ForegroundColor Cyan
    }

    $env:PORT = "$Port"
    $env:AGENT_CONTROL_DATA_DIR = "$dataDir"
    if (-not $NoService) {
      Write-Host "[5/5] 正在安装并启动 Windows 后台任务 (端口 $Port)..." -ForegroundColor Cyan
      & node scripts\service.mjs install
      if ($LASTEXITCODE -ne 0) { throw "注册或启动后台服务失败 (exit=$LASTEXITCODE)" }
    }
  } finally {
    Pop-Location
  }

  $desktopDir = [Environment]::GetFolderPath("Desktop")
  if ($desktopDir -and (Test-Path -LiteralPath $desktopDir)) {
    $legacyUrl = Join-Path $desktopDir "Agent Control.url"
    if (Test-Path -LiteralPath $legacyUrl) { Remove-Item -LiteralPath $legacyUrl -Force -ErrorAction SilentlyContinue }
    $shortcutPath = Join-Path $desktopDir "RemoteDeck.url"
    $iconCandidate = Join-Path $appDir "desktop\windows\remodeck.ico"
    $urlLines = @("[InternetShortcut]", "URL=http://127.0.0.1:$Port/")
    if (Test-Path -LiteralPath $iconCandidate) {
      $urlLines += "IconFile=$iconCandidate"
      $urlLines += "IconIndex=0"
    }
    $urlContent = ($urlLines -join "`r`n") + "`r`n"
    Set-Content -LiteralPath $shortcutPath -Value $urlContent -Encoding Default
  }

  $healthy = $false
  if (-not $NoService) {
    for ($i = 0; $i -lt 30; $i++) {
      try {
        $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/health" -TimeoutSec 1 -UseBasicParsing
        if ($resp.StatusCode -eq 200) {
          $healthy = $true
          break
        }
      } catch {}
      Start-Sleep -Milliseconds 500
    }
    if (-not $healthy) {
      throw "后台服务未能成功监听 http://127.0.0.1:$Port/health（可能是端口被占用/Hyper-V 保留，或服务端启动异常）"
    }
  }

  $relayNote = ""
  if ($Remote -eq "relay" -and $RelayUrl -and $InviteCode -and $healthy) {
    try {
      $pairBody = @{ relayUrl = $RelayUrl; inviteCode = $InviteCode; label = $HostLabel } | ConvertTo-Json
      Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/remote/pair" -ContentType "application/json" -Body $pairBody | Out-Null
      $relayNote = "已完成固定中继配对 ($RelayUrl)"
    } catch {
      $relayNote = "自动配对失败，请在页面「手机远程 -> 自托管固定中继」中重试"
    }
  }

  Write-Host ""
  Write-Host "==================================================" -ForegroundColor Green
  Write-Host "  RemoDeck (Agent Control) 安装完成" -ForegroundColor Green
  Write-Host "  源码目录: $appDir"
  Write-Host "  数据目录: $dataDir"
  Write-Host "  日志目录: $(Join-Path $dataDir 'logs')"
  Write-Host "  本地控制台: http://127.0.0.1:$Port"
  Write-Host "  远程模式: $Remote（可在界面「手机远程」随时切换 Cloudflare / 固定中继）"
  if ($relayNote) {
    Write-Host "  中继状态: $relayNote"
  }
  Write-Host "  桌面快捷方式: $desktopDir\RemoteDeck.url"
  if ($healthy) {
    Write-Host "  服务状态: 运行中"
  }
  Write-Host ""
  Write-Host "  If this helps you, consider giving it a Star: https://github.com/guuguo/remodeck" -ForegroundColor Cyan
  Write-Host "==================================================" -ForegroundColor Green

  if (-not $NoOpen -and -not $NoService) {
    Start-Process "http://127.0.0.1:$Port"
  }
} catch {
  Show-AgentControlTroubleshoot -Reason $_.Exception.Message -AppPath $appDir -DataDir $dataDir -ListenPort $Port
  if ([Environment]::UserInteractive) {
    try { Read-Host "按回车键退出" | Out-Null } catch {}
  }
  throw
}
