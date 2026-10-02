/* What reaches the Console from the engine: the student's program's output,
   its fd 2 included -- and nothing of the JVM's.  The JVM writes to stderr
   for its own reasons: the launcher's "Picked up JAVA_TOOL_OPTIONS" (a lab
   PC with a company Java sets it), java.util.logging (java.util.prefs'
   "Created user preferences directory" opened the Console at a start).
   RarsProbe.ErrRouter keeps System.err's words from any thread but RARS's
   simulator thread off the Console; the transport writes the process's
   stderr to a log file (engine-<role>.log in the run's folder), never to
   the Console.

   Each noise is made certain before the Console is looked at (the
   precondition, not a wait for luck): the main engine is killed once the
   window is up and the app starts another -- an engine starting with the
   window not yet loaded says its words to nobody -- with its settings
   folder deleted first (java.util.prefs creates it again, and says so), or
   with JAVA_TOOL_OPTIONS set; the log file must then hold the noise.
   Controls: the mutants that send System.err's every word to the Console,
   and the process's stderr to the Console (tools/mutants.ts). */

import { expect, test } from '@playwright/test';
import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';

import { javaPids, killHard } from '../helpers/processes.ts';
import { launch, openAndAssemble, program, settled, type Running } from './harness.ts';

let r: Running;
test.afterEach(async () => { await r.close(); });

// This run's folder (main.ts: <SPIM_USER_DATA>/run-<pid>-<time>).
function runDir(): string {
  const base = path.join(r.dir, 'user-data');
  const runs = readdirSync(base).filter((n) => n.startsWith('run-'));
  if (runs.length !== 1) throw new Error(`expected one run folder in ${base}, found ${runs.join(' ') || 'none'}`);
  return path.join(base, runs[0]);
}

async function mainEngine(): Promise<number> {
  await expect.poll(() => javaPids('-Dhallym.engine=main', r.dir).length, { timeout: 30_000, message: 'the main engine' }).toBe(1);
  return javaPids('-Dhallym.engine=main', r.dir)[0];
}

// The main engine killed with the window up: the app starts another.  Not
// assembled again after (an assemble clears the Console: it would hide what
// the new engine wrote).
async function restartMain(before?: () => void): Promise<void> {
  const old = await mainEngine();
  before?.();
  killHard(old);
  await expect(r.page.locator('.run-placeholder')).toContainText('엔진을 다시 시작했습니다');
  await expect.poll(() => javaPids('-Dhallym.engine=main', r.dir).filter((p) => p !== old).length, { timeout: 30_000, message: 'a new main engine' }).toBe(1);
}

// Until `done` (the noise was made), at most 15 s, saying how long; then a
// second more for whatever the noise sent to reach the window.
async function until(what: string, done: () => boolean): Promise<void> {
  const t0 = Date.now();
  while (!done()) {
    if (Date.now() - t0 > 15_000) throw new Error(`${what}: not within 15 s`);
    await r.page.waitForTimeout(100);
  }
  console.log(`  ${what}: ${Date.now() - t0} ms after the new engine was there`);
  await r.page.waitForTimeout(1000);
}
const logHas = (text: string) => () => { try { return readFileSync(path.join(runDir(), 'engine-main.log'), 'utf8').includes(text); } catch { return false; } };

async function consoleUntouched(): Promise<void> {
  expect(await r.page.locator('.clog').textContent(), 'nothing in the Console').toBe('');
  expect(await r.page.locator('.console').evaluate((e) => e.classList.contains('is-empty')), 'the Console as it is while empty').toBe(true);
}

const QUIET = 'main:\n  li a7, 10\n  ecall\n';

test("the program's own fd 2 is in the Console", async () => {
  r = await launch();
  await openAndAssemble(r, program(r.dir, 'fd2.s',
    '  .data\nm: .ascii "to-fd2"\n  .text\nmain:\n  li a0, 2\n  la a1, m\n  li a2, 6\n  li a7, 64\n  ecall\n  li a7, 10\n  ecall\n'));
  await r.page.keyboard.press('F5');
  await settled(r.page);
  await expect(r.page.locator('.clog')).toHaveText('to-fd2');
});

test("a new settings folder: java.util.prefs' line goes to the log, not the Console", async () => {
  r = await launch();
  await openAndAssemble(r, program(r.dir, 'q.s', QUIET));
  const prefs = path.join(runDir(), 'rars-prefs-main');
  await restartMain(() => rmSync(prefs, { recursive: true, force: true }));
  await until('the new engine made its settings folder again', () => existsSync(path.join(prefs, '.java', '.userPrefs')));
  await consoleUntouched();
  const log = readFileSync(path.join(runDir(), 'engine-main.log'), 'utf8');
  expect(log, 'the line, in the log').toContain('Created user preferences directory');
});

test("JAVA_TOOL_OPTIONS set (a company Java): the launcher's line goes to the log, not the Console", async () => {
  r = await launch(undefined, { env: { JAVA_TOOL_OPTIONS: '-Dhallym.noise=1' } });
  await openAndAssemble(r, program(r.dir, 'q.s', QUIET));
  await restartMain();
  await until('the launcher\'s line in the log', logHas('Picked up JAVA_TOOL_OPTIONS'));
  await consoleUntouched();
  const log = readFileSync(path.join(runDir(), 'engine-main.log'), 'utf8');
  expect(log, 'the line, in the log').toContain('Picked up JAVA_TOOL_OPTIONS: -Dhallym.noise=1');
});
