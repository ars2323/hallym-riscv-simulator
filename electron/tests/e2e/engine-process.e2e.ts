/* The engine as a process of the student's PC (the MIPS edition had none):

   1. Closing the window ends both engines (the simulator's and the checker's).
   2. The app killed outright (Task Manager, a crash: no goodbye) while a
      program runs: both engines go, within 5 s.  Two things see to it: the
      engine leaves at the end of its stdin, and on Windows the job object
      libuv puts every child in kills it with its parent.  Control: engines
      told to ignore the end of stdin (-Dprobe.ignoreEof=true) and started
      outside the job object (ENGINE_DETACHED=1) stay, orphans; they are
      killed here.
   3. Windows: no console window appears when the window starts its engines
      or restarts one (java.exe is a console program).  Control: started
      without windowsHide (ENGINE_WINDOWS_HIDE=0), one does.
      (tools/windows/console-windows.ps1 watches the desktop every 20 ms.)

   tools/engine-windows.ts measures the rest without a window: cold start,
   Korean through stdio, kill. */

import { expect, test } from '@playwright/test';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { goneWithin, javaPids, killHard } from '../helpers/processes.ts';
import { launch, openAndAssemble, program, root, settled, type Running } from './harness.ts';

test.describe.configure({ mode: 'serial' });
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

// The app killed while the simulator runs an endless loop; returns ms until both engines were gone, or null.
async function killedApp(env: Record<string, string>): Promise<{ ms: number | null; pids: number[] }> {
  const r = await launch(undefined, { env });
  const pids = await bothEngines(r);
  await openAndAssemble(r, program(r.dir, 'loop.s', 'main:\nloop: j loop\n'));
  await r.page.keyboard.press('F5');
  await expect(r.page.locator('.status')).toContainText('실행 중');
  say(`  app ${r.app.process().pid} with engines ${pids.join(' ')}: killing the app's main process alone`);
  killHard(r.app.process().pid!);
  const ms = await goneWithin(pids, 5000, say);
  for (const p of pids) { try { killHard(p); } catch { /* gone */ } }
  // Chromium's own processes outlive a killed main process for a moment and still write there.
  try { rmSync(r.dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 }); } catch (e) { say(`  (scratch directory left: ${(e as Error).message})`); }
  return { ms, pids };
}

test('2: the app killed outright -> its engines leave by themselves', async () => {
  const { ms, pids } = await killedApp({});
  expect(ms, `engines ${pids.join(' ')} left running: orphans`).not.toBeNull();
  say(`engines gone ${ms} ms after the app was killed`);
});

test('2, negative control: engines that ignore the end of stdin are left behind', async () => {
  const { ms } = await killedApp({ ENGINE_JAVA_ARGS: '-Dprobe.ignoreEof=true', ENGINE_DETACHED: '1' });
  expect(ms).toBeNull();
});

// Windows: the windows that appear on the desktop while the app starts, its
// engine is killed and restarted, and the app closes.
async function windowsSeen(env: Record<string, string>, out: string): Promise<{ class: string; title: string; process: string; ms: number }[]> {
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
  const r = await launch(undefined, { env });
  const pids = await bothEngines(r);
  await openAndAssemble(r, program(r.dir, 'p.s', 'main:\n  li a0, 7\n  li a7, 10\n  ecall\n'));
  killHard(javaPids('-Dhallym.engine=main', r.dir)[0]);              // a restart: a third java.exe
  await expect(r.page.locator('.run-placeholder')).toContainText('엔진을 다시 시작했습니다');
  await expect.poll(() => javaPids('-Dhallym.engine=main', r.dir).filter((p) => !pids.includes(p)).length, { timeout: 15_000 }).toBe(1);
  await r.page.waitForTimeout(1000);
  await r.close();
  const code = await Promise.race([exited, new Promise<'cap'>((done) => setTimeout(() => done('cap'), 40_000))]);
  if (code !== 0) throw new Error(`the window watcher ended with ${code}`);
  const seen = JSON.parse(readFileSync(out, 'utf8').replace(/^﻿/, '')).appeared as { class: string; title: string; process: string; ms: number }[];
  say(`windows that appeared: ${JSON.stringify(seen)}`);
  return seen;
}
const consoleLike = (w: { class: string; process: string }) =>
  /^(ConsoleWindowClass|CASCADIA_HOSTING_WINDOW_CLASS|PseudoConsoleWindow)$/.test(w.class) || /^(java|javaw|conhost|OpenConsole|WindowsTerminal)$/i.test(w.process);

test('3 (Windows): no console window flashes up when engines start or restart', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows only');
  const seen = await windowsSeen({}, info.outputPath('windows.json'));
  expect(seen.filter(consoleLike)).toEqual([]);
});

test('3 (Windows), negative control: without windowsHide a console window appears', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'Windows only');
  const seen = await windowsSeen({ ENGINE_WINDOWS_HIDE: '0' }, info.outputPath('windows.json'));
  expect(seen.filter(consoleLike).length).toBeGreaterThan(0);
});
