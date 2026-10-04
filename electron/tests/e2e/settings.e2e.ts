/* Settings and About.  Nothing is kept from one run to the next (a lab PC
   is shared): the font size, the Data radix, Ctrl +/-, the folds, the
   window's size -- all back to their defaults at the next start, and
   nothing of them on disk.  (RISC-V edition: no Advanced settings yet --
   RARS's options are not in the engine protocol, docs/engine-protocol.md 10,
   hole 3 -- so the MIPS edition's Advanced and exception-handler tests are
   not here.) */

import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { goneWithin, javaPids } from '../helpers/processes.ts';
import { launch, openAndAssemble, root, type Running, sample } from './harness.ts';

const VERSION = (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;

// Every file under `dir`.
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? files(p) : [p];
});

/** Settings is reached from the top bar, and the top bar carries nothing on
    the first screen (2.8.1): these go into the Editor first. */
async function intoTheEditor(r: Running): Promise<void> {
  await r.page.getByRole('button', { name: /바로 시작/ }).click();
  await r.page.getByRole('button', { name: /새 파일/ }).click();
  await r.page.locator('.editor-panel').waitFor();
}

test('nothing is kept: font size, Data radix, zoom, folds and the window are back to their defaults at the next start', async () => {
  const runs = mkdtempSync(path.join(tmpdir(), 'spim-runs-'));
  let r = await launch({ width: 1280, height: 800 }, { userData: runs });
  try {
    await openAndAssemble(r, sample(r.dir, 'tests/samples/data-labels.s'));
    await r.page.getByTitle('Settings').click();
    const dialog = r.page.locator('dialog.settings');
    await dialog.getByRole('button', { name: 'Dec' }).click();
    await dialog.getByRole('button', { name: 'Larger' }).click();
    await dialog.getByRole('button', { name: 'Larger' }).click();
    await expect(dialog.locator('.value')).toHaveText('15px');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await r.page.keyboard.press('Control+=');
    await expect.poll(() => r.page.evaluate(() => document.documentElement.style.getPropertyValue('--fs'))).toBe('16px');
    await r.page.locator('.console').getByRole('button', { name: 'Collapse' }).click();
    await expect(r.page.locator('.console')).not.toHaveClass(/open/);
    await r.page.getByRole('button', { name: 'Collapse Editor' }).click();
    await expect(r.page.locator('.split')).toHaveAttribute('data-folded', 'editor');
    await r.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1000, 700));
  } finally {
    await r.app.close();
  }
  // Nothing written for the next start (no settings file, no profile of it left
  // once the next start has cleaned up).
  r = await launch({ width: 1280, height: 800 }, { userData: runs, keepSize: true });
  try {
    const { page } = r;
    expect(await page.evaluate(() => document.documentElement.style.getPropertyValue('--fs'))).toBe('13px');
    // The window as the app opens it: maximised (Windows; on a Linux display
    // without a window manager maximising is nothing, and it is its own
    // 1280x800) -- not the 1000x700 of the last run.
    const win = await r.app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      return { size: w.getContentSize(), maximized: w.isMaximized() };
    });
    if (process.platform === 'win32') expect(win.maximized).toBe(true);
    if (!win.maximized) expect(win.size).toEqual([1280, 800]);
    await intoTheEditor(r);
    await page.getByTitle('Settings').click();
    const dialog = page.locator('dialog.settings');
    await expect(dialog.locator('.value')).toHaveText('13px');
    await expect(dialog.getByRole('button', { name: 'Hex' })).toHaveClass(/on/);
    await dialog.getByRole('button', { name: 'Close' }).click();
    await openAndAssemble(r, sample(r.dir, 'tests/samples/data-labels.s'));
    await expect(page.locator('.console')).toHaveClass(/open/);
    await expect(page.locator('.split')).toHaveAttribute('data-folded', 'none');
    await page.locator('.ptab', { hasText: 'Data' }).click();
    await expect(page.locator('.dtable')).toHaveClass(/base-16/);
    // On disk: only this run's folder, and no settings file anywhere.
    const left = readdirSync(runs);
    expect(left.length, left.join(', ')).toBe(1);
    expect(files(runs).filter((f) => /settings/i.test(path.basename(f)))).toEqual([]);
  } finally {
    await r.close();
  }
  // Quit: once the program has exited, this run's folder goes too.
  await expect.poll(() => (existsSync(runs) ? readdirSync(runs) : []), { timeout: 20_000 }).toEqual([]);
});

test('About: version, RARS, and every notice from the files the package carries', async () => {
  const r = await launch();
  const { page } = r;
  try {
    await intoTheEditor(r);
    await page.getByTitle('Settings').click();
    await page.getByRole('button', { name: /About · Licenses/ }).click();
    const about = page.locator('dialog.about');
    await expect(about).toContainText(VERSION); // package.json's
    await expect(about).toContainText('Simulator engine: RARS 1.6 by Pete Sanderson, Kenneth Vollmar and Benjamin Landers (MIT)');
    await about.getByRole('button', { name: 'Licenses' }).click();
    const items = about.locator('details');
    await expect(items).toHaveCount(6);
    // NOTICE: RARS's and JSoftFloat's MIT notices (the repository's file).
    for (const [i, text] of [[0, 'Pete Sanderson and Kenneth Vollmar'], [0, 'Benjamin Landers'], [1, 'SIL OPEN FONT LICENSE'], [3, 'ISC'],
                             [4, '@codemirror/view'], [5, 'Electron']] as const) {
      await items.nth(i).locator('summary').click();
      await expect(items.nth(i).locator('pre')).toContainText(text);
    }
  } finally {
    await r.close();
  }
});

/* Killed outright -- Task Manager, a crash, the power button on a lab PC --
   the program never reaches its own clean-up, so its run's folder (Chromium's
   profile, the engines' logs, RARS's settings in rars-prefs-*) stays in the
   temporary folder.  The next start removes every run's folder whose program
   is gone (src/main/main.ts), so they do not pile up.  The kill is checked to
   have left the folder first: without that the test would pass on a program
   that cleaned up after itself, and prove nothing about the next start. */
test('killed outright, its run\'s folder is left; the next start removes it', async () => {
  const runs = mkdtempSync(path.join(tmpdir(), 'spim-runs-'));
  const r = await launch({ width: 1280, height: 800 }, { userData: runs });
  const pid = r.app.process().pid!;
  await expect.poll(() => javaPids('-Dhallym.engine=', runs).length, { timeout: 30_000, message: 'both engines started' }).toBe(2);
  const engines = javaPids('-Dhallym.engine=', runs);
  const [killed] = readdirSync(runs);
  console.log(`the run's folder: ${killed}: ${readdirSync(path.join(runs, killed)).filter((n) => /^rars-prefs|^engine-/.test(n)).join(', ') || '(no engine files yet)'}`);
  r.app.process().kill('SIGKILL');                       // TerminateProcess on Windows: no quit, no clean-up
  expect(await goneWithin([pid], 10_000), 'the program ended').not.toBeNull();
  // Its engines leave by themselves when it is started as a student starts it
  // (WINDOWS.md, 250 ms); under Playwright on Windows they did not within
  // 10 s (CI, 4faba4d).  This test is about the folder, so they are ended.
  if (await goneWithin(engines, 10_000) === null) {
    console.log(`engines ${engines.join(' ')} still running 10 s after the program was killed: ended here`);
    for (const p of engines) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } }
    expect(await goneWithin(engines, 10_000), 'its engines ended').not.toBeNull();
  }
  expect(readdirSync(runs), 'the kill left its folder behind (the case this is about)').toContain(killed);

  const again = await launch({ width: 1280, height: 800 }, { userData: runs });
  try {
    const now = readdirSync(runs);
    console.log(`after the next start: ${now.join(', ')}`);
    expect(now, 'the killed run\'s folder is still there').not.toContain(killed);
    expect(now.length).toBe(1);
  } finally {
    await again.close();
    rmSync(r.dir, { recursive: true, force: true });
  }
  await expect.poll(() => (existsSync(runs) ? readdirSync(runs) : []), { timeout: 20_000 }).toEqual([]);
  rmSync(runs, { recursive: true, force: true });
});
