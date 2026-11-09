# Creates the CREATE icon (.ico) and a desktop shortcut to scripts/launch.ps1.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# --- Icon: built from the app logo (src/app/icon.svg), metal grey on glass ---
$icoPath = Join-Path $root "public\create.ico"
Push-Location $root
node scripts/make-icon.mjs
Pop-Location
# Windows caches shortcut icons by path: a copy named after its content forces the refresh.
$hash = (Get-FileHash $icoPath -Algorithm MD5).Hash.Substring(0, 8)
$iconDir = Join-Path $env:LOCALAPPDATA "CREATE"
New-Item -ItemType Directory -Force $iconDir | Out-Null
Get-ChildItem $iconDir -Filter "create-*.ico" | Remove-Item -Force
$icoPath = Join-Path $iconDir "create-$hash.ico"
Copy-Item (Join-Path $root "public\create.ico") $icoPath -Force

# --- Shortcut on the (possibly OneDrive-redirected) desktop ---
$desktop = [Environment]::GetFolderPath("Desktop")
$lnk = Join-Path $desktop "CREATE.lnk"
$shell = New-Object -ComObject WScript.Shell
$sc = $shell.CreateShortcut($lnk)
# Opens the online app in its own window (no local server needed); Edge if Chrome is missing.
$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
$sc.TargetPath = $browser
$sc.Arguments = "--app=https://create.wazprod.workers.dev"
$sc.WorkingDirectory = Split-Path $browser
$sc.IconLocation = "$icoPath,0"
$sc.Description = "CREATE — bibliothèque de beats"
$sc.Save()
Write-Output "Shortcut: $lnk"
Write-Output "Icon: $icoPath"
