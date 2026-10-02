# Does a console window show when the app starts java.exe -- as a student
# starts the app, not as Playwright does?
#
#   console-flash.ps1 -Exe <installed HallymRISCV.exe> -Report <dir>
#
# Under Playwright (tests/e2e/engine-process.e2e.ts) every java.exe had a
# console of its own (a conhost.exe child) and none showed a window, with
# windowsHide or without (CI, 87a9531): the app started there is shown and
# hidden as Playwright asks, and its children's consoles with it -- the
# negative control could not fail.  Here the app is started the way the
# watcher's own control starts a console program and sees its window
# (Start-Process: ShellExecute, as Explorer and the Start menu do), with
# ELECTRON_NO_ATTACH_CONSOLE=1 (no console of this script's to share; a
# student's start has none).  Twice: as shipped (no console window may
# show), and with ENGINE_WINDOWS_HIDE=0 (the control: one must).  Each run:
# the app starts its two engines, one is killed and started again, the app
# closes; console-windows.ps1 watches the desktop every 20 ms meanwhile.
param(
  [Parameter(Mandatory = $true)][string]$Exe,
  [Parameter(Mandatory = $true)][string]$Report
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Exe)) { throw "no app at '$Exe'" }
New-Item -ItemType Directory -Force -Path $Report | Out-Null
$failed = 0
function Pass([string]$m) { Write-Host "PASS  $m" }
function Bad([string]$m) { Write-Host "FAIL  $m"; $script:failed++ }

# This run's engines: their command line carries the run's user-data folder
# (-Djava.util.prefs.userRoot=...), whoever their parent is.
function Engines([string]$marker) {
  @(Get-CimInstance Win32_Process -Filter "Name='java.exe'" | Where-Object { "$($_.CommandLine)".Contains('RarsProbe') -and "$($_.CommandLine)".Contains($marker) })
}
# What there is, when a wait ends without what it waited for.
function Evidence($app, [string]$ud) {
  Write-Host "      the app $($app.Id): exited $($app.HasExited)$(if ($app.HasExited) { ", code $($app.ExitCode)" })"
  foreach ($q in @(Get-CimInstance Win32_Process -Filter "Name='HallymRISCV.exe' or Name='java.exe'")) {
    $cl = "$($q.CommandLine)"; Write-Host ("      {0} parent {1} {2} {3}" -f $q.ProcessId, $q.ParentProcessId, $q.Name, $cl.Substring(0, [Math]::Min(220, $cl.Length)))
  }
  foreach ($f in @(Get-ChildItem $ud -Recurse -Filter 'engine-*.log' -ErrorAction SilentlyContinue)) { Write-Host "      $($f.FullName):"; Get-Content $f.FullName -Tail 30 | ForEach-Object { Write-Host "        $_" } }
  Write-Host "      run folders: $((@(Get-ChildItem $ud -ErrorAction SilentlyContinue) | ForEach-Object { $_.Name }) -join ', ')"
}
function Consoles([int[]]$pids) {
  $all = @(Get-CimInstance Win32_Process)
  foreach ($p in $pids) {
    $hosts = @($all | Where-Object { $_.ParentProcessId -eq $p -and ($_.Name -eq 'conhost.exe' -or $_.Name -eq 'OpenConsole.exe') } | ForEach-Object { "$($_.Name) $($_.ProcessId)" })
    Write-Host "      $p console host child: $(if ($hosts.Count) { $hosts -join ', ' } else { 'none' })"
  }
}
# Waits for $cond, at most $cap s, saying how long each time; at the cap,
# $evidence says what there is, then it fails.
function Until([string]$what, [int]$cap, [scriptblock]$cond, [scriptblock]$evidence = {}) {
  $t0 = Get-Date
  while (-not (& $cond)) {
    $s = [int]((Get-Date) - $t0).TotalMilliseconds
    if ($s -gt $cap * 1000) { & $evidence; throw "$what`: not within $cap s" }
    Write-Host "      $s ms: waiting for $what"
    Start-Sleep -Milliseconds 500
  }
}

function Run([string]$name, [string]$hide) {
  Write-Host "== $name"
  $out = Join-Path $Report "console-flash-$name.json"
  $started = "$out.started"
  Remove-Item $started -ErrorAction SilentlyContinue
  $watcher = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    (Join-Path $PSScriptRoot 'console-windows.ps1'), '-Seconds', '30', '-Out', $out, '-Started', $started)
  Until 'the window watcher' 30 { Test-Path $started }
  $env:ELECTRON_NO_ATTACH_CONSOLE = '1'
  $ud = Join-Path (Resolve-Path $Report).Path "console-flash-$name-user-data"
  $env:SPIM_USER_DATA = $ud
  if ($hide -eq '0') { $env:ENGINE_WINDOWS_HIDE = '0' } else { Remove-Item Env:ENGINE_WINDOWS_HIDE -ErrorAction SilentlyContinue }
  $app = Start-Process $Exe -PassThru
  try {
    Write-Host "      the app: $($app.Id)"
    Until 'its two engines' 30 { (Engines $ud).Count -eq 2 } { Evidence $app $ud }
    $found = @(Engines $ud)
    $first = @($found | ForEach-Object { [int]$_.ProcessId })
    Write-Host "      engines $($first -join ' '), their parent(s) $((@($found | ForEach-Object { $_.ParentProcessId } | Sort-Object -Unique)) -join ' ') (the app: $($app.Id)):"; Consoles $first
    Stop-Process -Id $first[0] -Force   # a restart: a third java.exe
    Until 'the engine started again' 30 { @(Engines $ud | Where-Object { $first -notcontains [int]$_.ProcessId }).Count -eq 1 } { Evidence $app $ud }
    $again = @(Engines $ud | Where-Object { $first -notcontains [int]$_.ProcessId } | ForEach-Object { [int]$_.ProcessId })
    Write-Host "      started again: $($again -join ' '):"; Consoles $again
    Start-Sleep -Seconds 2
  } finally {
    $null = $app.CloseMainWindow()
    if (-not $app.WaitForExit(10000)) { Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue }
    Engines $ud | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Get-Process HallymRISCV -ErrorAction SilentlyContinue | Where-Object { $_.Id -eq $app.Id } | Stop-Process -Force -ErrorAction SilentlyContinue
    Remove-Item Env:ENGINE_WINDOWS_HIDE, Env:ELECTRON_NO_ATTACH_CONSOLE, Env:SPIM_USER_DATA -ErrorAction SilentlyContinue
  }
  if (-not $watcher.WaitForExit(45000)) { throw 'the window watcher did not end within 45 s' }
  $seen = @((Get-Content $out -Raw | ConvertFrom-Json).appeared)
  foreach ($w in $seen) { Write-Host "      appeared: $($w.class) '$($w.title)' ($($w.process) $($w.pid)) at $($w.ms) ms" }
  @($seen | Where-Object { $_.class -match '^(ConsoleWindowClass|CASCADIA_HOSTING_WINDOW_CLASS|PseudoConsoleWindow)$' -or $_.process -match '^(java|javaw|conhost|OpenConsole|WindowsTerminal)$' })
}

$shipped = Run 'shipped' ''
if ($shipped.Count -eq 0) { Pass 'as shipped: no console window shows when the app starts or restarts its engines' } else { Bad "as shipped: $($shipped.Count) console window(s) showed" }
$control = Run 'control' '0'
if ($control.Count -gt 0) { Pass "  control, ENGINE_WINDOWS_HIDE=0: $($control.Count) console window(s) showed" }
else {
  # Measured on windows-latest (5c13ba2): each engine has its own conhost.exe and no window
  # shows, windowsHide or not -- this runner shows no window for a console child whose stdio
  # is pipes, so it cannot show the flash windowsHide prevents, and the check above proves
  # nothing here.  Said loudly, not counted as a pass or a failure: windowsHide is pinned by
  # tests/sim/process.test.ts and its mutant.  For the record, java.exe started on its own
  # (Start-Process: its own console, stdio the console's) -- does a java console show here?
  Write-Host "BLOCKED  control, ENGINE_WINDOWS_HIDE=0: no console window showed on this runner, so the check above proves nothing here"
  Write-Host '::warning title=Console window check unproven::With windowsHide off no console window showed on this runner either; the check cannot be proven here (WINDOWS.md)'
  $java = Join-Path (Split-Path $Exe) 'resources\engine\runtime\bin\java.exe'
  $out = Join-Path $Report 'console-flash-java-alone.json'; $started = "$out.started"
  $watcher = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    (Join-Path $PSScriptRoot 'console-windows.ps1'), '-Seconds', '8', '-Out', $out, '-Started', $started)
  Until 'the window watcher' 30 { Test-Path $started }
  $engine = Join-Path (Split-Path $Exe) 'resources\engine'
  # The engine itself: it waits on its stdin (here its console's) until killed.
  $j = Start-Process $java -ArgumentList @('-cp', ('"' + (Join-Path $engine 'classes') + ';' + (Join-Path $engine 'rars.jar') + '"'), 'RarsProbe') -PassThru
  Start-Sleep -Seconds 3
  if (-not $j.HasExited) { Stop-Process -Id $j.Id -Force }
  if (-not $watcher.WaitForExit(20000)) { throw 'the window watcher did not end within 20 s' }
  foreach ($w in @((Get-Content $out -Raw | ConvertFrom-Json).appeared)) { Write-Host "      java.exe alone, appeared: $($w.class) '$($w.title)' ($($w.process) $($w.pid)) at $($w.ms) ms" }
}
if ($failed) { Write-Host "$failed FAILED"; exit 1 }
if ($control.Count -gt 0) { Write-Host 'the check passed, its control failed' } else { Write-Host 'the check passed; its control could not fail on this runner: BLOCKED, not proven' }
