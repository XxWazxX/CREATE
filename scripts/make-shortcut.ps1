# Creates the CREATE desktop shortcut: a tiny launcher (CREATE.exe) with the logo built in,
# which opens the online app in its own window. The shortcut points at the launcher, not at
# chrome.exe: Chrome rewrites shortcuts to itself and the desktop then loses the icon.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot

# --- Icon from the app logo (src/app/icon.svg) ---
Push-Location $root
node scripts/make-icon.mjs
Pop-Location

# --- Launcher with the icon embedded ---
$dir = Join-Path $env:LOCALAPPDATA "CREATE"
New-Item -ItemType Directory -Force $dir | Out-Null
$exe = Join-Path $dir "CREATE.exe"
$csc = Get-ChildItem "$env:SystemRoot\Microsoft.NET\Framework64\v4*\csc.exe" | Select-Object -Last 1
& $csc.FullName /nologo /target:winexe /optimize+ "/win32icon:$(Join-Path $root 'public\create.ico')" "/out:$exe" (Join-Path $root "scripts\launcher\CreateLauncher.cs")
if ($LASTEXITCODE -ne 0) { throw "Launcher build failed" }

# --- Shortcut on the (possibly OneDrive-redirected) desktop ---
$lnk = Join-Path ([Environment]::GetFolderPath("Desktop")) "CREATE.lnk"
$sc = (New-Object -ComObject WScript.Shell).CreateShortcut($lnk)
$sc.TargetPath = $exe
$sc.WorkingDirectory = $dir
$sc.IconLocation = "$exe,0"
$sc.Description = "CREATE — bibliothèque de beats"
$sc.Save()
ie4uinit.exe -show
Write-Output "Shortcut: $lnk -> $exe"
