/* The window as it opens and while it is covered: maximised at start; the
   caption buttons' patch (titleBarOverlay: Windows draws the buttons on it)
   coloured under a dialog's backdrop, white again after; the question
   dialogs (panels/ask.ts): a click outside does nothing, Esc is cancel, the
   keys stay inside.  (RISC-V edition: no first screen and no tutorial, so
   their tests are not here; the dialogs carry no character.) */

import { expect, test } from '@playwright/test';

import { launch, openAndAssemble, program, type Running } from './harness.ts';

const PROGRAM = 'main:\n  li a7, 10\n  ecall\n';
const overlay = (r: Running) => r.app.evaluate(({ BrowserWindow }) => (BrowserWindow.getAllWindows()[0] as unknown as { overlayColor?: string }).overlayColor ?? '#ffffff');
const symbols = (r: Running) => r.app.evaluate(({ BrowserWindow }) => (BrowserWindow.getAllWindows()[0] as unknown as { overlaySymbol?: string }).overlaySymbol ?? '#00205b');

test('opens maximised (Windows), at its own 1280x800 where nothing maximises it', async () => {
  const r = await launch({ width: 1280, height: 800 }, { keepSize: true });
  try {
    const w = await r.app.evaluate(({ BrowserWindow }) => { const b = BrowserWindow.getAllWindows()[0]; return { maximized: b.isMaximized(), size: b.getContentSize() }; });
    if (process.platform === 'win32') expect(w.maximized).toBe(true);
    else if (!w.maximized) expect(w.size).toEqual([1280, 800]);
  } finally {
    await r.close();
  }
});

test('the caption buttons\' patch follows a dialog\'s backdrop in the Editor, and is white again after', async () => {
  const r = await launch();
  const { page } = r;
  try {
    await openAndAssemble(r, program(r.dir, 'p.s', PROGRAM));
    await expect.poll(() => overlay(r)).toBe('#ffffff');
    await page.getByTitle('Settings').click();
    await expect.poll(() => overlay(r)).toBe('#a6b1c6');   // white under navy at 35 %
    await page.locator('dialog.settings').getByRole('button', { name: 'Close' }).click();
    await expect.poll(() => overlay(r)).toBe('#ffffff');
  } finally {
    await r.close();
  }
});

test('a question: modal, a click outside does nothing, Esc is cancel, Tab stays inside', async () => {
  const r = await launch();
  const { page } = r;
  try {
    await openAndAssemble(r, program(r.dir, 'p.s', PROGRAM));
    await page.getByTitle('New file').click();
    const dialog = page.locator('dialog.ask');
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((d) => d.matches(':modal'))).toBe(true);
    await expect(page.locator('img.char')).toHaveCount(0); // no character in this edition
    expect(await dialog.evaluate((d) => getComputedStyle(d, '::backdrop').backgroundColor)).toBe('rgba(0, 32, 91, 0.35)');
    // Outside: the backdrop, the Editor, the title bar -- nothing happens.
    const h = await page.evaluate(() => window.innerHeight);
    for (const [x, y] of [[10, h / 2], [200, 300], [640, 20]]) { await page.mouse.click(x, y); await page.waitForTimeout(150); }
    await expect(dialog).toBeVisible();
    // Tab goes round the two buttons and nowhere else.
    for (let i = 0; i < 3; i += 1) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('dialog.ask')), `Tab ${i + 1}: focus inside`).toBe(true);
    }
    // Esc: the safe answer, the file stays.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.titlebar .file')).toContainText('p.s');
  } finally {
    await r.close();
  }
});

