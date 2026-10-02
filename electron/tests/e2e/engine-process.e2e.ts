/* The engine as a process of the student's PC (the MIPS edition had none):

   1. Closing the window ends both engines (the simulator's and the checker's).
   2. The app's main process killed outright (taskkill /F, SIGKILL: Task
      Manager, a crash, no goodbye) while a program runs: both engines go,
      within 5 s.  The main process is the one main.ts runs in (process.pid
      there), the engines' parent: not always the one Playwright started --
      the installed app on Windows ran main.ts in a child of it (CI, 2026-10-02:
      Playwright's 5692, main.ts in 1188, the engines' parent; killing 5692
      left 1188 and so the whole app running).  Three ways out (RarsProbe):
      the parent's end (ProcessHandle), the end of stdin, and on Windows the
      job object; each alone, the other two off, and the parent watch with a
      shutdown hook that never ends (it halts).  Control: all three off, the
      engines stay (orphans; killed here).
   3. Windows: no console window appears when the window starts its engines
      or restarts one (java.exe is a console program); the watcher's own
      control: a console program's window is seen.  The control without
      windowsHide cannot fail under Playwright: tools/windows/console-flash.ps1.
      (tools/windows/console-windows.ps1 watches the desktop every 20 ms.)

   The tests are independent: one failing does not skip the others.
   tools/engine-windows.ts measures the rest without a window: cold start,
   Korean through stdio, kill. */

import { expect, test } from '@playwright/test';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { goneWithin, javaPids, killHard } from '../helpers/processes.ts';
import { launch, openAndAssemble, program, root, settled, type Running } from './harness.ts';

const say = (s: string) => console.log(s);

async function bothEngines(r: Running): Promise<number[]> {
  await expect.poll(() => javaPids('-Dhallym.engine=main', r.dir).length + javaPids('-Dhallym.engine=checker', r.dir).length,
    { timeout: 30_000, message: 'both engines started' }).toBe(2);
  return [...javaPids('-Dhallym.engine=main', r.dir), ...javaPids('-Dhallym.engine=checker', r.dir)];
}

test('1: closing the window ends both engines', async () => {
  const r = await launch();
  const pids = await bothEngines(r);
  await r.close();
  const ms = await goneWithin(pids, 5000, say);
  expect(ms, `engines ${pids.join(' ')} still running 5 s after the window closed`).not.toBeNull();
});

type Way = 'parent' | 'stdin' | 'none';
// Which way each engine left by, from its trace: "parent <pid> exited: leaving",
// "end of stdin: leaving", or neither (killed from outside: the job object; or
// still running).  Written before the engine goes, so it is there when it went.
function waysOut(trace: string): Record<'main' | 'checker', Way> {
  const way = (role: string): Way => {
    const mine = trace.split('\n').filter((l) => l.includes(` ${role}: `));
    if (mine.some((l) => /parent \d+ exited: leaving/.test(l))) return 'parent';
    if (mine.some((l) => l.includes('end of stdin: leaving'))) return 'stdin';
    return 'none';
  };
  return { main: way('main'), checker: way('checker') };
}

// Where a process came from: its parent, executable and command line.
function whoIs(pid: number): string {
  if (process.platform === 'win32') {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | ForEach-Object { "$($_.ProcessId) parent $($_.ParentProcessId) exe $($_.ExecutablePath)\n    command line: $($_.CommandLine)" }`], { encoding: 'utf8' }).trim() || `${pid}: (gone)`;
  }
  try {
    const ppid = /^PPid:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1];
    return `${pid} parent ${ppid}\n    command line: ${readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').join(' ').slice(0, 300)}`;
  } catch { return `${pid}: (gone)`; }
}

// The app's main process -- the one main.ts runs in, the engines' parent --
// killed outright while the simulator runs an endless loop.  Returns ms until
// both engines were gone (or null), how many of its java processes are left
// after 5 s, and which way each engine left by.
async function killedApp(env: Record<string, string>): Promise<{ ms: number | null; pids: number[]; left: number; ways: Record<'main' | 'checker', Way> }> {
  const dir = mkdtempSync(path.join(tmpdir(), 'engine-trace-'));
  const trace = path.join(dir, 'trace.txt');
  const r = await launch(undefined, { env: { ...env, ENGINE_JAVA_ARGS: `${env.ENGINE_JAVA_ARGS ?? ''} -Dprobe.trace=${trace}`.trim() } });
  const pids = await bothEngines(r);
  await openAndAssemble(r, program(r.dir, 'loop.s', 'main:\nloop: j loop\n'));
  await r.page.keyboard.press('F5');
  await expect(r.page.locator('.status')).toContainText('실행 중');
  const main = await r.app.evaluate(() => ({ pid: process.pid, ppid: process.ppid }));
  const started = r.app.process().pid!;
  // The tree, before anything is killed: the process Playwright started, the one main.ts runs in, an engine.
  say(`  the tree (${process.env.SPIM_E2E_EXE ? 'the installed app' : 'the source tree'}):`);
  say(`    started by Playwright: ${whoIs(started)}`);
  if (main.pid !== started) say(`    main.ts runs in: ${whoIs(main.pid)}`);
  say(`    an engine: ${whoIs(pids[0])}`.slice(0, 400));
  say(`  killing ${main.pid} (main.ts) alone; engines ${pids.join(' ')}`);
  killHard(main.pid);
  const ms = await goneWithin(pids, 5000, say);
  const left = javaPids(r.dir).length;
  const text = existsSync(trace) ? readFileSync(trace, 'utf8') : '';
  say(`engine trace:\n${text || '(none written)'}`);
  const ways = waysOut(text);
  say(`  java processes of this app left after 5 s: ${left}; ways out: main ${ways.main}, checker ${ways.checker}`);
  for (const p of pids) { try { killHard(p); } catch { /* gone */ } }
  try { killHard(started); } catch { /* gone with its child, or the same process */ }
  // Chromium's own processes outlive a killed main process for a moment and still write there.
  try { rmSync(r.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) { say(`  (scratch directory left: ${(e as Error).message})`); }
  return { ms, pids, left, ways };
}

const NO_WATCH = '-Dprobe.noParentWatch=true', NO_EOF = '-Dprobe.ignoreEof=true';
// `by`: the ways an engine may have left by.  A way switched off must never be
// the one (the switch works); with a single way on, it must be that one ('none'
// for the job object: killed from outside, nothing written).
const WAYS: { name: string; env: Record<string, string>; by: Way[]; only?: 'win32' }[] = [
  { name: 'all three ways', env: {}, by: ['parent', 'stdin', 'none'] },
  { name: 'the parent watch alone', env: { ENGINE_JAVA_ARGS: NO_EOF, ENGINE_DETACHED: '1' }, by: ['parent'] },
  { name: 'the parent watch alone, a shutdown hook that never ends', env: { ENGINE_JAVA_ARGS: `${NO_EOF} -Dprobe.stuckShutdownHook=true`, ENGINE_DETACHED: '1' }, by: ['parent'] },
  { name: 'the end of stdin alone', env: { ENGINE_JAVA_ARGS: NO_WATCH, ENGINE_DETACHED: '1' }, by: ['stdin'] },
  { name: 'the job object alone', env: { ENGINE_JAVA_ARGS: `${NO_WATCH} ${NO_EOF}` }, by: ['none'], only: 'win32' },
  // The engine as it was before the parent watch: the end of stdin and the job object.
  { name: 'no parent watch (before 651cf16)', env: { ENGINE_JAVA_ARGS: NO_WATCH }, by: ['stdin', 'none'] },
];
for (const w of WAYS) {
  test(`2: the app's main process killed outright -> its engines leave by themselves: ${w.name}`, async () => {
    test.skip(w.only !== undefined && process.platform !== w.only, 'Windows only');
    const { ms, pids, left, ways } = await killedApp(w.env);
    expect(ms, `engines ${pids.join(' ')} left running: orphans`).not.toBeNull();
    expect(left).toBe(0);
    for (const role of ['main', 'checker'] as const) expect(w.by, `the ${role} engine left by "${ways[role]}"`).toContain(ways[role]);
    say(`engines gone ${ms} ms after the main process was killed (${w.name}); left by: main ${ways.main}, checker ${ways.checker}`);
  });
}

test('2, negative control: none of the three ways -> the engines are left behind', async () => {
  const { ms, left, ways } = await killedApp({ ENGINE_JAVA_ARGS: `${NO_WATCH} ${NO_EOF}`, ENGINE_DETACHED: '1' });
  expect(ms).toBeNull();
  expect(left).toBe(2);
  expect(ways).toEqual({ main: 'none', checker: 'none' });
});

// Windows: the windows that appear on the desktop while `during` runs.
type Seen = { class: string; title: string; process: string; ms: number };
async function windowsSeen(out: string, during: () => Promise<void>): Promise<Seen[]> {
  const started = `${out}.started`;
  rmSync(started, { force: true });
  const watcher = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    path.join(root, 'tools/windows/console-windows.ps1'), '-Seconds', '20', '-Out', out, '-Started', started], { stdio: 'inherit' });
  const exited = new Promise<number | null>((done) => watcher.on('exit', done));
  const t0 = Date.now();
  while (!existsSync(started)) {
    say(`  ${Date.now() - t0} ms: waiting for the window watcher to start`);
    if (Date.now() - t0 > 30_000) throw new Error('the window watcher did not start within 30 s');
    await new Promise((r) => setTimeout(r, 250));
  }
  await during();
  const code = await Promise.race([exited, new Promise<'cap'>((done) => setTimeout(() => done('cap'), 40_000))]);
  if (code !== 0) throw new Error(`the window watcher ended with ${code}`);
  const seen = JSON.parse(readFileSync(out, 'utf8').replace(/^\uFEFF/, '')).appeared as Seen[];
  say(`windows that appeared: ${JSON.stringify(seen)}`);
  return seen;
}
const consoleLike = (w: { class: string; process: string }) =>
  /^(ConsoleWindowClass|CASCADIA_HOSTING_WINDOW_CLASS|PseudoConsoleWindow)$/.test(w.class) || /^(java|javaw|conhost|OpenConsole|WindowsTerminal)$/i.test(w.process);

// Which of these processes has a console of its own: a conhost.exe (or
// OpenConsole.exe) child.  The evidence when a console window does or does
// not appear.
function consoles(pids: number[]): string {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command',
    `$all = @(Get-CimInstance Win32_Process); foreach ($p in @(${pids.join(',')})) { $me = $all | Where-Object { $_.ProcessId -eq $p }; $hosts = @($all | Where-Object { $_.ParentProcessId -eq $p -and ($_.Name -eq 'conhost.exe' -or $_.Name -eq 'OpenConsole.exe') } | ForEach-Object { "$($_.Name) $($_.ProcessId)" }); "  $p $($me.Name): console host child: $(if ($hosts.Count) { $hosts -join ', ' } else { 'none' })" }`],
  { encoding: 'utf8' }).trimEnd();
}

// The app as a student starts it, without a console (Start menu, the
// installer): Electron attaches to its parent's console unless told not to,
// and Playwright starts it under cmd.exe (CI, 5a90f3c).  It starts its
// engines, one is killed and started again, the app closes.
async function appRun(env: Record<string, string>): Promise<void> {
  const r = await launch(undefined, { env: { ...env, ELECTRON_NO_ATTACH_CONSOLE: '1' } });
  const pids = await bothEngines(r);
  const main = await r.app.evaluate(() => process.pid);
  say(`consoles (main ${main}, engines ${pids.join(' ')}):\n${consoles([main, ...pids])}`);
  await openAndAssemble(r, program(r.dir, 'p.s', 'main:\n  li a0, 7\n  li a7, 10\n  ecall\n'));
  killHard(javaPids('-Dhallym.engine=main', r.dir)[0]);              // a restart: a third java.exe
  await expect(r.page.locator('.run-placeholder')).toContainText('엔진을 다시 시작했습니다');
  await expect.poll(() => javaPids('-Dhallym.engine=main', r.dir).filter((p) => !pids.includes(p)).length, { timeout: 15_000 }).toBe(1);
  const again = javaPids('-Dhallym.engine=main', r.dir);
  say(`consoles after the restart:\n${consoles(again)}`);
  await r.page.waitForTimeout(1000);
  await r.close();
}

test('3 (Windows), the watcher\'s own control: a console program started from Explorer\'s way shows its window, and is seen', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows only');
  const seen = await windowsSeen(info.outputPath('windows.json'), async () => {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', "Start-Process cmd.exe -ArgumentList '/c','ping -n 5 127.0.0.1'"], { stdio: 'inherit' });
    await new Promise((r) => setTimeout(r, 6000));
  });
  expect(seen.filter(consoleLike).length, 'a console window seen').toBeGreaterThan(0);
});

test('3 (Windows): no console window flashes up when engines start or restart', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows only');
  const seen = await windowsSeen(info.outputPath('windows.json'), () => appRun({}));
  expect(seen.filter(consoleLike)).toEqual([]);
});

// Its negative control (ENGINE_WINDOWS_HIDE=0: a window must show) cannot fail
// here: under Playwright every java.exe has a console of its own and none shows
// a window, windowsHide or not (CI, 87a9531: a conhost.exe child of each
// engine, no window in either run, the watcher's own control seen).  The check
// and its control as a student starts the app: tools/windows/console-flash.ps1
// (the Windows CI job).
