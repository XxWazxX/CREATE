# Creates the CREATE icon (.ico) and a desktop shortcut to scripts/launch.ps1.
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Add-Type -AssemblyName System.Drawing

# --- Icon: four rounded amber bars on a near-black rounded square (same as the in-app logo) ---
$icoPath = Join-Path $root "public\create.ico"
$sizes = 256, 48, 32, 16
$pngs = foreach ($s in $sizes) {
  $bmp = New-Object System.Drawing.Bitmap $s, $s
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = "AntiAlias"
  $g.Clear([System.Drawing.Color]::Transparent)
  function RoundRect($x, $y, $w, $h, $r) {
    $p = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = [Math]::Max(1, $r * 2)
    $p.AddArc($x, $y, $d, $d, 180, 90); $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90); $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $p.CloseFigure(); return $p
  }
  $k = $s / 64.0
  $bg = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 11, 11, 12))
  $g.FillPath($bg, (RoundRect 0 0 ($s - 1) ($s - 1) (14 * $k)))
  $amber = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 242, 181, 68))
  foreach ($bar in @(@(14, 26, 12), @(24, 18, 28), @(34, 12, 40), @(44, 22, 20))) {
    $g.FillPath($amber, (RoundRect ($bar[0] * $k) ($bar[1] * $k) (6 * $k) ($bar[2] * $k) (3 * $k)))
  }
  $g.Dispose()
  $ms = New-Object System.IO.MemoryStream
  if ($s -ge 256) {
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  } else {
    # Classic DIB entry (BITMAPINFOHEADER + bottom-up BGRA + AND mask): read by every Windows component.
    $w = New-Object System.IO.BinaryWriter $ms
    $w.Write([UInt32]40); $w.Write([Int32]$s); $w.Write([Int32]($s * 2)); $w.Write([UInt16]1); $w.Write([UInt16]32)
    $w.Write([UInt32]0); $w.Write([UInt32]($s * $s * 4)); $w.Write([Int32]0); $w.Write([Int32]0); $w.Write([UInt32]0); $w.Write([UInt32]0)
    for ($y = $s - 1; $y -ge 0; $y--) {
      for ($x = 0; $x -lt $s; $x++) {
        $c = $bmp.GetPixel($x, $y)
        $w.Write([byte]$c.B); $w.Write([byte]$c.G); $w.Write([byte]$c.R); $w.Write([byte]$c.A)
      }
    }
    $maskRow = [int]([Math]::Ceiling($s / 32.0) * 4)
    $w.Write((New-Object byte[] ($maskRow * $s)))
    $w.Flush()
  }
  $bmp.Dispose()
  , $ms.ToArray()
}
# ICO container with PNG-compressed entries
$fs = [System.IO.File]::Create($icoPath)
$bw = New-Object System.IO.BinaryWriter $fs
$bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
$offset = 6 + 16 * $sizes.Count
for ($i = 0; $i -lt $sizes.Count; $i++) {
  $s = $sizes[$i]; $len = $pngs[$i].Length
  $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s }))); $bw.Write([byte]($(if ($s -ge 256) { 0 } else { $s })))
  $bw.Write([byte]0); $bw.Write([byte]0); $bw.Write([UInt16]1); $bw.Write([UInt16]32)
  $bw.Write([UInt32]$len); $bw.Write([UInt32]$offset); $offset += $len
}
foreach ($p in $pngs) { $bw.Write($p) }
$bw.Close()

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
