/* Settings and About.  Nothing is kept from one run to the next (a lab PC
   is shared): the font size, the Data radix, Ctrl +/-, the folds, the
   window's size -- all back to their defaults at the next start, and
   nothing of them on disk.  (RISC-V edition: no Advanced settings yet --
   RARS's options are not in the engine protocol, docs/engine-protocol.md 10,
   hole 3 -- so the MIPS edition's Advanced and exception-handler tests are
   not here.) */

import { expect, test } from '@playwright/test';
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { launch, openAndAssemble, root, sample } from './harness.ts';

const VERSION = (JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string }).version;

// Every file under `dir`.
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = path.join(dir, n);
  return statSync(p).isDirectory() ? files(p) : [p];
});

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
