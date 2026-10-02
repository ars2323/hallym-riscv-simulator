/* Engine processes, found and waited for: the checks that an engine is gone
   (killed, or left behind by a window that went away).  Works on Windows
   (CIM's Win32_Process) and Linux (/proc). */

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

// (On Linux a process that has exited but is not yet reaped -- a zombie -- counts as gone.)
export function alive(pid: number): boolean {
  try { process.kill(pid, 0); } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
  if (process.platform === 'linux') {
    try { return !readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]?.startsWith('Z'); } catch { return false; }
  }
  return true;
}

// The engine processes (java running RarsProbe) whose command line contains every one of
// `markers` (e.g. -Dhallym.engine=main and the test's scratch directory).
export function javaPids(...markers: string[]): number[] {
  if (markers.length === 0) throw new Error('javaPids: no marker (it would find every engine on the machine)');
  if (process.platform === 'win32') {
    // The markers go through the environment: no quoting of paths into the script.
    const ps = "$m = $env:PIDS_MARKERS -split \"`n\"; Get-CimInstance Win32_Process -Filter \"Name='java.exe' or Name='javaw.exe'\" | "
      + "Where-Object { $c = $_.CommandLine; $c -and $c.Contains('RarsProbe') -and -not ($m | Where-Object { -not $c.Contains($_) }) } | ForEach-Object { $_.ProcessId }";
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps],
      { encoding: 'utf8', env: { ...process.env, PIDS_MARKERS: markers.join('\n') } });
    return out.split(/\s+/).filter(Boolean).map(Number);
  }
  const pids: number[] = [];
  for (const d of readdirSync('/proc')) {
    if (!/^\d+$/.test(d)) continue;
    let cmd = '';
    try { cmd = readFileSync(`/proc/${d}/cmdline`, 'utf8').replaceAll('\0', ' '); } catch { continue; }
    try { if (readFileSync(`/proc/${d}/stat`, 'utf8').split(') ')[1]?.startsWith('Z')) continue; } catch { continue; } // a zombie has gone
    if (cmd.includes('RarsProbe') && markers.every((m) => cmd.includes(m))) pids.push(Number(d));
  }
  return pids;
}

/* Waits until none of `pids` is alive, at most `capMs`; says how long it has
   waited at every look.  Returns the ms it took, or null at the cap. */
export async function goneWithin(pids: number[], capMs: number, say: (s: string) => void = () => {}): Promise<number | null> {
  if (pids.length === 0) throw new Error('goneWithin: no processes to wait for (nothing was found to begin with)');
  const t0 = Date.now();
  for (;;) {
    const left = pids.filter(alive);
    const ms = Date.now() - t0;
    say(`  ${ms} ms: ${left.length ? `still alive ${left.join(' ')}` : 'all gone'}`);
    if (left.length === 0) return ms;
    if (ms >= capMs) return null;
    await new Promise((r) => setTimeout(r, Math.min(250, capMs - ms)));
  }
}

export function killHard(pid: number): void {
  if (process.platform === 'win32') execFileSync('taskkill.exe', ['/F', '/PID', String(pid)], { stdio: 'inherit' }); // that process only, not its tree
  else process.kill(pid, 'SIGKILL');
}
