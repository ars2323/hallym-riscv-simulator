# Every visible top-level window that appears on the desktop for -Seconds,
# sampled every 20 ms: a console window that flashes up for a moment when
# the app starts java.exe is caught here (tests/e2e/engine-process.e2e.ts).
#
#   console-windows.ps1 -Seconds 15 -Out windows.json -Started started.txt
#
# Writes -Started as soon as it is looking (the test waits for it before it
# starts the app), then -Out: the windows already there at the start
# ("before") and those that appeared after ("appeared": class, title, the
# owning process and its name, ms after the start when first seen).
param(
  [int]$Seconds = 15,
  [Parameter(Mandatory = $true)][string]$Out,
  [Parameter(Mandatory = $true)][string]$Started
)
$ErrorActionPreference = 'Stop'

Add-Type @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class TopWindows {
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static List<string[]> Visible() {
    var r = new List<string[]>();
    EnumWindows((h, l) => {
      if (IsWindowVisible(h)) {
        var c = new StringBuilder(256); GetClassName(h, c, 256);
        var t = new StringBuilder(512); GetWindowText(h, t, 512);
        uint pid; GetWindowThreadProcessId(h, out pid);
        r.Add(new string[] { h.ToInt64().ToString(), c.ToString(), t.ToString(), pid.ToString() });
      }
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@

$before = @{}
foreach ($w in [TopWindows]::Visible()) { $before[$w[0]] = $w }
$appeared = [ordered]@{}
$clock = [Diagnostics.Stopwatch]::StartNew()
Set-Content -Path $Started -Value "looking since $(Get-Date -Format o)"
$lastSaid = -1
while ($clock.ElapsedMilliseconds -lt $Seconds * 1000) {
  foreach ($w in [TopWindows]::Visible()) {
    $key = $w[0] + '|' + $w[1]
    if (-not $before.ContainsKey($w[0]) -and -not $appeared.Contains($key)) {
      $proc = Get-Process -Id ([int]$w[3]) -ErrorAction SilentlyContinue
      $name = if ($proc) { $proc.ProcessName } else { '(gone)' }
      $appeared[$key] = [ordered]@{ hwnd = $w[0]; class = $w[1]; title = $w[2]; pid = [int]$w[3]; process = $name; ms = $clock.ElapsedMilliseconds }
      Write-Host ("  {0} ms: appeared {1} '{2}' ({3} {4})" -f $clock.ElapsedMilliseconds, $w[1], $w[2], $name, $w[3])
    }
  }
  $s = [math]::Floor($clock.ElapsedMilliseconds / 1000)
  if ($s -ne $lastSaid) { Write-Host "  ${s} s of $Seconds s: $($appeared.Count) windows appeared so far"; $lastSaid = $s }
  Start-Sleep -Milliseconds 20
}
[ordered]@{
  seconds = $Seconds
  before = @($before.Values | ForEach-Object { [ordered]@{ class = $_[1]; title = $_[2]; pid = [int]$_[3] } })
  appeared = @($appeared.Values)
} | ConvertTo-Json -Depth 4 | Set-Content -Path $Out -Encoding utf8
Write-Host "done: $($appeared.Count) windows appeared in $Seconds s -> $Out"
