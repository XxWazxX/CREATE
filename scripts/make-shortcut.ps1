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
$sc.TargetPath = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
$sc.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $root 'scripts\launch.ps1')`""
$sc.WorkingDirectory = $root
$sc.IconLocation = "$icoPath,0"
$sc.Description = "CREATE — bibliothèque de beats"
$sc.WindowStyle = 7
$sc.Save()
Write-Output "Shortcut: $lnk"
Write-Output "Icon: $icoPath"
