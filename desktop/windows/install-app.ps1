param(
  [string]$Port = $(if ($env:PORT) { $env:PORT } else { "43310" }),
  [string]$AppVersion = $(if ($env:AGENT_CONTROL_APP_VERSION) { $env:AGENT_CONTROL_APP_VERSION } else { "0.1.0" }),
  [string]$BuildHash = $(if ($env:AGENT_CONTROL_BUILD_HASH) { $env:AGENT_CONTROL_BUILD_HASH } else { "" }),
  [string]$InstallDir = $(if ($env:AGENT_CONTROL_APP_INSTALL_DIR) { $env:AGENT_CONTROL_APP_INSTALL_DIR } else { "" })
)

$ErrorActionPreference = "Stop"
try {
  [Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
  $OutputEncoding = [System.Text.UTF8Encoding]::new($false)
} catch {}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$LocalBase = if ($InstallDir) {
  $InstallDir
} elseif ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA "AgentControl"
} else {
  Join-Path $HOME "AppData\Local\AgentControl"
}

New-Item -ItemType Directory -Force -Path $LocalBase | Out-Null

function Resolve-SourceIconPath {
  param([string]$ScriptRoot, [string]$RepoRoot)
  $candidates = @(
    (Join-Path $ScriptRoot "remodeck.ico"),
    (Join-Path $RepoRoot "desktop\windows\remodeck.ico"),
    (Join-Path $RepoRoot "public\favicon.ico")
  )
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }
  return ""
}

function Find-ChromiumBrowser {
  $exeNames = @("msedge.exe", "chrome.exe", "brave.exe")
  $candidates = @()

  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe")
    $candidates += (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
    $candidates += (Join-Path ${env:ProgramFiles(x86)} "BraveSoftware\Brave-Browser\Application\brave.exe")
  }
  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe")
    $candidates += (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe")
    $candidates += (Join-Path $env:ProgramFiles "BraveSoftware\Brave-Browser\Application\brave.exe")
  }
  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\Application\msedge.exe")
    $candidates += (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe")
    $candidates += (Join-Path $env:LOCALAPPDATA "BraveSoftware\Brave-Browser\Application\brave.exe")
  }

  foreach ($exeName in $exeNames) {
    foreach ($regRoot in @(
      "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths",
      "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths",
      "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths"
    )) {
      $regPath = Join-Path $regRoot $exeName
      try {
        if (Test-Path -LiteralPath $regPath) {
          $props = Get-ItemProperty -LiteralPath $regPath -ErrorAction SilentlyContinue
          if ($props -and $props.'(default)') {
            $candidates += ([string]$props.'(default)').Trim('"')
          }
          if ($props -and $props.Path) {
            $candidates += (Join-Path ([string]$props.Path).Trim('"') $exeName)
          }
        }
      } catch {}
    }
  }

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return $candidate
    }
  }
  return ""
}

function Find-NodeExe {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -and (Test-Path -LiteralPath $cmd.Source -PathType Leaf)) {
    return $cmd.Source
  }
  $candidates = @()
  if ($env:ProgramFiles) {
    $candidates += (Join-Path $env:ProgramFiles "nodejs\node.exe")
  }
  if (${env:ProgramFiles(x86)}) {
    $candidates += (Join-Path ${env:ProgramFiles(x86)} "nodejs\node.exe")
  }
  if ($env:LOCALAPPDATA) {
    $candidates += (Join-Path $env:LOCALAPPDATA "Programs\nodejs\node.exe")
  }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return $candidate
    }
  }
  return "node.exe"
}

function Find-CscExe {
  $candidates = @()
  if ($env:SystemRoot) {
    $candidates += (Join-Path $env:SystemRoot "Microsoft.NET\Framework64\v4.0.30319\csc.exe")
    $candidates += (Join-Path $env:SystemRoot "Microsoft.NET\Framework\v4.0.30319\csc.exe")
  }
  $cmd = Get-Command csc.exe -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source) {
    $candidates += $cmd.Source
  }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return $candidate
    }
  }
  return ""
}

function Resolve-ExistingOrFirstDir {
  param([string[]]$Candidates)
  $clean = @()
  foreach ($item in $Candidates) {
    if ($item -and "$item".Trim()) {
      $clean += "$item".Trim()
    }
  }
  foreach ($item in $clean) {
    if (Test-Path -LiteralPath $item -PathType Container) {
      return $item
    }
  }
  if ($clean.Count -gt 0) {
    return $clean[0]
  }
  return ""
}

function Resolve-StartMenuProgramsDir {
  param([object]$WshShell)
  $candidates = @()
  try {
    $p = [Environment]::GetFolderPath("Programs")
    if ($p) { $candidates += $p }
  } catch {}
  try {
    $reg = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders" -Name "Programs" -ErrorAction SilentlyContinue
    if ($reg -and $reg.Programs) {
      $candidates += [Environment]::ExpandEnvironmentVariables([string]$reg.Programs)
    }
  } catch {}
  if ($WshShell) {
    try {
      $sp = $WshShell.SpecialFolders.Item("Programs")
      if ($sp) { $candidates += [string]$sp }
    } catch {}
  }
  if ($env:APPDATA) {
    $candidates += (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs")
  }
  $homeBase = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
  if ($homeBase) {
    $candidates += (Join-Path $homeBase "AppData\Roaming\Microsoft\Windows\Start Menu\Programs")
  }
  return (Resolve-ExistingOrFirstDir -Candidates $candidates)
}

function Resolve-DesktopDir {
  param([object]$WshShell)
  $candidates = @()
  try {
    $p = [Environment]::GetFolderPath("DesktopDirectory")
    if ($p) { $candidates += $p }
  } catch {}
  try {
    $p2 = [Environment]::GetFolderPath("Desktop")
    if ($p2) { $candidates += $p2 }
  } catch {}
  if ($WshShell) {
    try {
      $sp = $WshShell.SpecialFolders.Item("Desktop")
      if ($sp) { $candidates += [string]$sp }
    } catch {}
  }
  try {
    $reg = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders" -Name "Desktop" -ErrorAction SilentlyContinue
    if ($reg -and $reg.Desktop) {
      $candidates += [Environment]::ExpandEnvironmentVariables([string]$reg.Desktop)
    }
  } catch {}
  $homeBase = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
  if ($homeBase) {
    $candidates += (Join-Path $homeBase "Desktop")
  }
  return (Resolve-ExistingOrFirstDir -Candidates $candidates)
}

$SourceIconPath = Resolve-SourceIconPath -ScriptRoot $ScriptDir -RepoRoot $RootDir
if (-not $SourceIconPath) {
  throw "未找到 Windows 应用图标文件 (desktop\windows\remodeck.ico)"
}

$rawTag = if ($BuildHash) { $BuildHash } elseif ($AppVersion) { $AppVersion } else { "default" }
$safeTag = ($rawTag -replace '[^A-Za-z0-9._-]', '')
if (-not $safeTag) { $safeTag = "default" }
$IconPath = Join-Path $LocalBase "remodeck-$safeTag.ico"
Copy-Item -LiteralPath $SourceIconPath -Destination $IconPath -Force
Get-ChildItem -LiteralPath $LocalBase -Filter "remodeck*.ico" -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.FullName -ne $IconPath) {
    Remove-Item -LiteralPath $_.FullName -Force -ErrorAction SilentlyContinue
  }
}

$Url = "http://127.0.0.1:$Port"
$ProfileDir = Join-Path $LocalBase "app-profile"
New-Item -ItemType Directory -Force -Path $ProfileDir | Out-Null

$BrowserExe = Find-ChromiumBrowser
$BrowserArgs = @()
if ($BrowserExe) {
  $BrowserArgs = @(
    "--app=$Url",
    "--user-data-dir=$ProfileDir",
    "--no-first-run",
    "--no-default-browser-check"
  )
}

$NodeExe = Find-NodeExe
$CfgPath = Join-Path $LocalBase "launcher.cfg"
$CfgLines = @(
  "url=$Url/",
  "healthUrl=$Url/health",
  "port=$Port",
  "repoRoot=$RootDir",
  "browserPath=$BrowserExe",
  "profileDir=$ProfileDir",
  "nodePath=$NodeExe"
)
[System.IO.File]::WriteAllText($CfgPath, ($CfgLines -join "`r`n") + "`r`n", [System.Text.UTF8Encoding]::new($false))

$LauncherCs = Join-Path $ScriptDir "RemoteDeckLauncher.cs"
$ExePath = Join-Path $LocalBase "RemoteDeck.exe"
$BuiltExePath = ""
$CscExe = Find-CscExe
if ($CscExe -and (Test-Path -LiteralPath $LauncherCs -PathType Leaf)) {
  try {
    $StageExe = Join-Path $LocalBase "RemoteDeck.new.exe"
    Remove-Item -LiteralPath $StageExe -Force -ErrorAction SilentlyContinue
    & $CscExe /nologo /optimize+ /target:winexe /utf8output "/win32icon:$IconPath" "/out:$StageExe" /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll $LauncherCs | Out-Null
    if ($LASTEXITCODE -eq 0 -and (Test-Path -LiteralPath $StageExe -PathType Leaf)) {
      Move-Item -LiteralPath $StageExe -Destination $ExePath -Force
      $BuiltExePath = $ExePath
    } else {
      Remove-Item -LiteralPath $StageExe -Force -ErrorAction SilentlyContinue
    }
  } catch {
    Write-Warning "未能编译原生 Windows 启动器（将使用浏览器直连快捷方式）: $($_.Exception.Message)"
  }
}

$LauncherPath = ""
$CmdPath = Join-Path $LocalBase "agent-control-desktop.cmd"
$VbsPath = Join-Path $LocalBase "agent-control-desktop.vbs"

if ($BuiltExePath) {
  $TargetPath = $BuiltExePath
  $TargetArgs = ""
  $RelaunchCmd = """$BuiltExePath"""
  Remove-Item -LiteralPath $CmdPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $VbsPath -Force -ErrorAction SilentlyContinue
} elseif ($BrowserExe) {
  $TargetPath = $BrowserExe
  $TargetArgs = "--app=""$Url"" --user-data-dir=""$ProfileDir"" --no-first-run --no-default-browser-check"
  $RelaunchCmd = """$BrowserExe"" $TargetArgs"
  Remove-Item -LiteralPath $CmdPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $VbsPath -Force -ErrorAction SilentlyContinue
} else {
  $CmdContent = (@(
    "@echo off",
    "chcp 65001 >nul",
    "setlocal",
    "start """" ""$Url"""
  ) -join "`r`n") + "`r`n"
  [System.IO.File]::WriteAllText($CmdPath, $CmdContent, [System.Text.UTF8Encoding]::new($false))
  $VbsContent = "Set WshShell = CreateObject(""WScript.Shell"")`r`nWshShell.Run """"""$CmdPath"""""", 0, False`r`n"
  [System.IO.File]::WriteAllText($VbsPath, $VbsContent, [System.Text.UnicodeEncoding]::new($false, $true))
  $LauncherPath = $CmdPath
  $TargetPath = "$env:SystemRoot\System32\wscript.exe"
  $TargetArgs = """$VbsPath"""
  $RelaunchCmd = """$TargetPath"" $TargetArgs"
}

$WshShell = New-Object -ComObject WScript.Shell
$StartMenuDir = Resolve-StartMenuProgramsDir -WshShell $WshShell
$DesktopDir = Resolve-DesktopDir -WshShell $WshShell

$AppUserModelId = "com.guuguo.remodeck.desktop"
$IconLocation = "$IconPath,0"
$CreatedLinks = @()
$StartMenuShortcutPath = ""
$DesktopShortcutPath = ""

$ShellHelperCs = @"
using System;
using System.Runtime.InteropServices;

namespace RemoteDeckShell {
  [StructLayout(LayoutKind.Sequential)]
  public struct PropertyKey {
    public Guid fmtid;
    public uint pid;
  }

  [StructLayout(LayoutKind.Sequential)]
  public struct PropVariant : IDisposable {
    public ushort vt;
    public ushort wReserved1;
    public ushort wReserved2;
    public ushort wReserved3;
    public IntPtr p;
    public IntPtr p2;

    public static PropVariant FromString(string value) {
      return new PropVariant {
        vt = 31,
        p = Marshal.StringToCoTaskMemUni(value ?? string.Empty),
        p2 = IntPtr.Zero
      };
    }

    public void Dispose() {
      PropVariantClear(ref this);
    }

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropVariant pvar);
  }

  [ComImport]
  [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
  [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface IPropertyStore {
    int GetCount(out uint cProps);
    int GetAt(uint iProp, out PropertyKey pkey);
    int GetValue(ref PropertyKey key, out PropVariant pv);
    int SetValue(ref PropertyKey key, ref PropVariant pv);
    int Commit();
  }

  public static class ShortcutHelper {
    private static readonly Guid AppUserModelFmtId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
    private static readonly Guid IPropertyStoreIid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = true)]
    private static extern int SHGetPropertyStoreFromParsingName(
      string pszPath,
      IntPtr pbc,
      uint flags,
      ref Guid riid,
      out IPropertyStore ppv);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern void SHChangeNotify(uint wEventId, uint uFlags, IntPtr dwItem1, IntPtr dwItem2);

    private static void SetStringProp(IPropertyStore store, uint pid, string value) {
      var key = new PropertyKey { fmtid = AppUserModelFmtId, pid = pid };
      var pv = PropVariant.FromString(value);
      try {
        int hr = store.SetValue(ref key, ref pv);
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
      } finally {
        pv.Dispose();
      }
    }

    public static void ApplyAppUserModel(string shortcutPath, string appId, string relaunchCmd, string iconResource, string displayName) {
      Guid iid = IPropertyStoreIid;
      IPropertyStore store;
      int hr = SHGetPropertyStoreFromParsingName(shortcutPath, IntPtr.Zero, 2, ref iid, out store);
      if (hr < 0 || store == null) Marshal.ThrowExceptionForHR(hr);
      try {
        SetStringProp(store, 5, appId);
        SetStringProp(store, 2, relaunchCmd);
        SetStringProp(store, 3, iconResource);
        SetStringProp(store, 4, displayName);
        hr = store.Commit();
        if (hr < 0) Marshal.ThrowExceptionForHR(hr);
      } finally {
        if (Marshal.IsComObject(store)) {
          Marshal.ReleaseComObject(store);
        }
      }
    }

    public static void NotifyIconChanged(string directoryPath) {
      SHChangeNotify(0x08000000, 0x0000, IntPtr.Zero, IntPtr.Zero);
      if (!string.IsNullOrEmpty(directoryPath)) {
        IntPtr ptr = Marshal.StringToCoTaskMemUni(directoryPath);
        try {
          SHChangeNotify(0x00001000, 0x0005, ptr, IntPtr.Zero);
        } finally {
          Marshal.FreeCoTaskMem(ptr);
        }
      }
    }
  }
}
"@

$shellHelperReady = $false
try {
  if (-not ("RemoteDeckShell.ShortcutHelper" -as [type])) {
    Add-Type -TypeDefinition $ShellHelperCs -ErrorAction Stop
  }
  $shellHelperReady = $true
} catch {
  Write-Warning "未能加载 Shell 属性辅助模块（将仅保存标准快捷方式）: $($_.Exception.Message)"
}

foreach ($entry in @(
  @{ Kind = "startMenu"; Dir = $StartMenuDir },
  @{ Kind = "desktop"; Dir = $DesktopDir }
)) {
  $dir = $entry.Dir
  if (-not $dir) { continue }
  if (-not (Test-Path -LiteralPath $dir)) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
  }

  Remove-Item -LiteralPath (Join-Path $dir "Agent Control.lnk") -Force -ErrorAction SilentlyContinue
  if ($entry.Kind -eq "desktop") {
    Remove-Item -LiteralPath (Join-Path $dir "Agent Control.url") -Force -ErrorAction SilentlyContinue
  }

  $LnkPath = Join-Path $dir "RemoteDeck.lnk"
  $Shortcut = $WshShell.CreateShortcut($LnkPath)
  $Shortcut.TargetPath = $TargetPath
  $Shortcut.Arguments = $TargetArgs
  $Shortcut.WorkingDirectory = $RootDir
  $Shortcut.Description = "RemoteDeck (RemoDeck / Agent Control) Desktop Console"
  $Shortcut.IconLocation = $IconLocation
  $Shortcut.Save()

  if ($shellHelperReady -and (Test-Path -LiteralPath $LnkPath)) {
    try {
      [RemoteDeckShell.ShortcutHelper]::ApplyAppUserModel($LnkPath, $AppUserModelId, $RelaunchCmd, $IconLocation, "RemoteDeck")
    } catch {
      Write-Warning "写入快捷方式 AppUserModel 属性失败 ($LnkPath): $($_.Exception.Message)"
    }
    try {
      [RemoteDeckShell.ShortcutHelper]::NotifyIconChanged($dir)
    } catch {}
  }

  if (Test-Path -LiteralPath $LnkPath) {
    $CreatedLinks += $LnkPath
    if ($entry.Kind -eq "startMenu") { $StartMenuShortcutPath = $LnkPath }
    if ($entry.Kind -eq "desktop") { $DesktopShortcutPath = $LnkPath }
  }
}

if ($CreatedLinks.Count -eq 0) {
  throw "未能创建开始菜单或桌面快捷方式（StartMenuDir='$StartMenuDir', DesktopDir='$DesktopDir'）"
}

$PrimaryAppPath = if ($StartMenuShortcutPath) { $StartMenuShortcutPath } else { $DesktopShortcutPath }
$MetaPath = Join-Path $LocalBase "desktop-meta.json"
$MetaObj = [ordered]@{
  version = $AppVersion
  buildHash = $BuildHash
  repoRoot = $RootDir
  url = $Url
  appPath = $PrimaryAppPath
  startMenuPath = $StartMenuShortcutPath
  desktopPath = $DesktopShortcutPath
  iconPath = $IconPath
  launcherExePath = $BuiltExePath
  browserPath = $BrowserExe
  browserArgs = $BrowserArgs
  launcherPath = $LauncherPath
  platform = "win32"
  updatedAt = (Get-Date).ToString("o")
}
$MetaJson = ($MetaObj | ConvertTo-Json -Depth 4) + "`r`n"
[System.IO.File]::WriteAllText($MetaPath, $MetaJson, [System.Text.UTF8Encoding]::new($false))

Write-Host "已安装 RemoteDeck Windows 桌面 App："
if ($StartMenuShortcutPath) { Write-Host "  开始菜单: $StartMenuShortcutPath" }
if ($DesktopShortcutPath) { Write-Host "  桌面快捷方式: $DesktopShortcutPath" }
if ($BuiltExePath) { Write-Host "  原生启动器: $BuiltExePath" }
Write-Host "  应用图标: $IconPath"
