# The installer with /S, as a lab's deployment runs it: installs per user
# with no page and no question, and starts nothing -- neither the program
# nor its engine (java.exe) -- in the 15 s after it returns.  Writes the
# installed program's path to <Report>/installed.txt (the e2e then run
# against it) and PASS/FAIL lines to <Report>/install-silent.txt.
#
#   install-silent.ps1 -Setup <setup.exe> -Report <dir>
param([Parameter(Mandatory = $true)][string]$Setup, [Parameter(Mandatory = $true)][string]$Report)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Report | Out-Null
$log = Join-Path $Report 'install-silent.txt'
$failed = $false
function Note($s) { Write-Host $s; Add-Content $log $s }
function Check($ok, $what) { if ($ok) { Note "PASS  $what" } else { Note "FAIL  $what"; $script:failed = $true } }

$exe = Join-Path $env:LOCALAPPDATA 'Programs\Hallym RISC-V\HallymRISCV.exe'
Check (-not (Test-Path $exe)) 'nothing installed before'
$sw = [Diagnostics.Stopwatch]::StartNew()
$p = Start-Process (Resolve-Path $Setup).Path -ArgumentList '/S' -Wait -PassThru
Check ($p.ExitCode -eq 0) "/S exit code $($p.ExitCode) after $($sw.ElapsedMilliseconds) ms"
Check (Test-Path $exe) "installed: $exe"
$java = Join-Path $env:LOCALAPPDATA 'Programs\Hallym RISC-V\resources\engine\runtime\bin\java.exe'
Check (Test-Path $java) "the Java runtime: $java"
# Nothing started: watched for 15 s, every second, with the time said each time.
$started = @()
for ($s = 1; $s -le 15; $s++) {
  Start-Sleep -Seconds 1
  $running = @(Get-Process HallymRISCV, java, javaw -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$env:LOCALAPPDATA\Programs\Hallym RISC-V\*" })
  Write-Host "  $s s after /S returned: $($running.Count) of our processes running"
  $started += $running | ForEach-Object { "$($_.ProcessName) $($_.Id)" }
}
Check ($started.Count -eq 0) "/S started nothing (15 s watched): $($started -join ', ')"
Set-Content -Path (Join-Path $Report 'installed.txt') -Value $exe
if ($failed) { Note 'RESULT  FAIL'; exit 1 } else { Note 'RESULT  PASS' }
