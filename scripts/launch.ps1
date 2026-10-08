# CREATE launcher (used by the desktop shortcut).
# Starts the app server in the background if needed, then opens CREATE in its own window.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$url = "http://localhost:3000"
$log = Join-Path $root "launcher.log"

function Test-Up {
  try { (Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -MaximumRedirection 0).StatusCode -lt 500 } catch {
    if ($_.Exception.Response) { return $true } else { return $false }
  }
}

function Show-Error($msg) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show($msg, "CREATE", "OK", "Error") | Out-Null
}

if (-not (Test-Up)) {
  $env:PATH = "C:\Program Files\nodejs;$env:PATH"
  Set-Location $root

  # Rebuild only when the code changed since the last production build.
  $buildId = Join-Path $root ".next\BUILD_ID"
  $newest = Get-ChildItem -Path (Join-Path $root "src") -Recurse -File | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  $needsBuild = -not (Test-Path $buildId) -or ($newest.LastWriteTime -gt (Get-Item $buildId).LastWriteTime) -or
    ((Get-Item (Join-Path $root ".env.local")).LastWriteTime -gt (Get-Item $buildId -ErrorAction SilentlyContinue).LastWriteTime)
  if ($needsBuild) {
    $b = Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run build > `"$log`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden -Wait -PassThru
    if ($b.ExitCode -ne 0) { Show-Error "La compilation de CREATE a échoué. Détails : $log"; exit 1 }
  }

  Start-Process -FilePath "cmd.exe" -ArgumentList "/c npm run start -- -p 3000 >> `"$log`" 2>&1" -WorkingDirectory $root -WindowStyle Hidden

  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-Up)) {
    if ((Get-Date) -gt $deadline) { Show-Error "CREATE n'a pas démarré. Détails : $log"; exit 1 }
    Start-Sleep -Milliseconds 500
  }
}

# Own window without browser chrome (Edge app mode), fallback: default browser.
$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($edge) { Start-Process -FilePath $edge -ArgumentList "--app=$url" } else { Start-Process $url }
