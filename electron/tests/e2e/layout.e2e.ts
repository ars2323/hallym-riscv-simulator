/* The window's frame and layout: the title bar is the app's own, the Editor
   and the Run side sit side by side, the Run side shows the machine only
   while it holds the Editor's program, and the Editor marks the line being
   executed. */

import { expect, test } from '@playwright/test';

import { launch, openAndAssemble, program, regHex, resize, settled, side, type Running } from './harness.ts';

let r: Running;
test.beforeEach(async () => { r = await launch(); });
test.afterEach(async () => { await r.close(); });

const PROGRAM = 'main:\n  li t0, 5\n  li t1, 7\n  add t2, t0, t1\n  li a7, 10\n  ecall\n';

test('the title bar is the window\'s own: name, a drag region, room for the caption buttons', async () => {
  const { page } = r;
  await expect(page.locator('.titlebar .appname')).toHaveText('Hallym RISC-V');
  await expect(page).toHaveTitle('untitled.s — Hallym RISC-V'); // no first screen: an untitled file from the start
  expect(await page.evaluate(() => (navigator as unknown as { windowControlsOverlay?: { visible: boolean } }).windowControlsOverlay?.visible))
    .toBe(true); // titleBarOverlay: the system draws the caption buttons
  const regions = await page.evaluate(() => ({
    bar: getComputedStyle(document.querySelector('.titlebar')!).getPropertyValue('-webkit-app-region'),
    button: getComputedStyle(document.querySelector('.titlebar button')!).getPropertyValue('-webkit-app-region'),
  }));
  expect(regions).toEqual({ bar: 'drag', button: 'no-drag' });
  // Nothing of ours under the caption buttons.
  const free = await page.evaluate(() => {
    const o = (navigator as unknown as { windowControlsOverlay: { getTitlebarAreaRect(): DOMRect } }).windowControlsOverlay.getTitlebarAreaRect();
    const tools = document.querySelector('.titlebar .tools')!.getBoundingClientRect();
    return tools.right <= o.x + o.width;
  });
  expect(free).toBe(true);
});

test('Run side: a card before the first assemble, the machine after -- and still the machine once the code changes, with a band', async () => {
  const { page } = r;
  await expect(page.locator('.editor-panel')).toBeVisible(); // the app opens on the Editor
  const card = page.locator('.run-placeholder');
  await expect(card).toHaveAttribute('data-kind', 'fresh');
  await expect(card).toContainText('아직 어셈블하지 않았습니다');
  await expect(page.locator('.run-grid')).toBeHidden();

  await openAndAssemble(r, program(r.dir, 'p.s', PROGRAM));
  await expect(page.locator('.run-grid')).toBeVisible();
  await expect(card).toBeHidden();

  await side(page, 'Editor');
  await page.locator('.cm-content').click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(' # 바꿈');
  await expect(card).toBeHidden();
  await side(page, 'Run');
  await expect(page.locator('.run-grid')).toBeVisible();
  const band = page.locator('.run-band');
  await expect(band).toBeVisible();
  await expect(band).toContainText('마지막으로 어셈블한 코드');
  expect(await band.evaluate((e) => e.getBoundingClientRect().height)).toBeLessThanOrEqual(30); // one line, covering nothing
  await side(page, 'Editor');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+s');
  await expect(band).toBeHidden();
  await expect(page.locator('.run-grid')).toBeVisible();
});

test('the Editor marks the line being executed', async () => {
  const { page } = r;
  // (The MIPS edition also checked that SPIM's start-up code, whose line
  // numbers are the exception handler's, marks no Editor line.  RARS runs
  // the student's program from its first instruction: there is none.)
  await openAndAssemble(r, program(r.dir, 'p.s', PROGRAM));
  await expect(page.locator('.cm-pc-line')).toHaveCount(0); // not started
  await page.keyboard.press('F10');
  await settled(page);
  expect(await regHex(page, 'x5')).toBe('0x00000005');
  // li t0, 5 has run: PC is at li t1, 7 -- line 3.
  await expect(page.locator('.cm-pc-line')).toHaveText('  li t1, 7');
  await page.keyboard.press('F10');
  await settled(page);
  await expect(page.locator('.cm-pc-line')).toHaveText('  add t2, t0, t1');
  // The Text row and the Editor line agree.
  await expect(page.locator('.trow.pc .lno')).toHaveText('4');
});

test('splitter: drag to share the width, fold either side away and back', async () => {
  const { page } = r;
  await openAndAssemble(r, program(r.dir, 'p.s', PROGRAM));
  test.skip(await page.getByRole('tab', { name: 'Editor', exact: true }).isVisible(), 'a narrow window has no splitter: Editor and Run are tabs');
  const editorBox = async () => (await page.locator('.pane-editor').boundingBox())!;
  const before = (await editorBox()).width;
  const grip = (await page.locator('.splitter .grip').boundingBox())!;
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + 150, grip.y + grip.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await editorBox()).width).toBeGreaterThan(before + 100);

  await page.getByRole('button', { name: 'Collapse Editor' }).click();
  await expect(page.locator('.editor-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Expand Editor' })).toBeVisible();
  await page.getByRole('button', { name: 'Expand Editor' }).click();
  await expect(page.locator('.editor-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Collapse Run' }).click();
  await expect(page.locator('.run-grid')).toBeHidden();
  await page.getByRole('button', { name: 'Expand Run' }).click();
  await expect(page.locator('.run-grid')).toBeVisible();
});

test('narrow windows show one side at a time; 1093 wide (1366 at 125%) keeps both', async () => {
  const { page } = r;
  await openAndAssemble(r, program(r.dir, 'p.s', PROGRAM));
  await resize(r, { width: 1093, height: 582 });
  await expect(page.locator('.viewswitch')).toBeHidden();
  await expect(page.locator('.editor-panel')).toBeVisible();
  await expect(page.locator('.run-grid')).toBeVisible();
  await resize(r, { width: 910, height: 505 });
  await expect(page.locator('.viewswitch')).toBeVisible();
  await page.locator('.viewswitch button', { hasText: 'Editor' }).click();
  await expect(page.locator('.editor-panel')).toBeVisible();
  await expect(page.locator('.run-grid')).toBeHidden();
  await page.locator('.viewswitch button', { hasText: 'Run' }).click();
  await expect(page.locator('.run-grid')).toBeVisible();
  await expect(page.locator('.editor-panel')).toBeHidden();
});

// The Console's height (app.css): as tall as its words while it is empty,
// Registers taking the rest; its share -- clamp(120 px, 26vh, 260 px) --
// once there is output; the grip between them drags, a double click resets.
test('the Console: as tall as its words while empty, its share with output; the grip drags it, a double click resets', async () => {
  const { page } = r;
  const HELLO = '        .data\nmsg:    .asciz "hello\\n"\n        .text\nmain:   li a7, 4\n        la a0, msg\n        ecall\n        li a7, 10\n        ecall\n';
  await openAndAssemble(r, program(r.dir, 'hello.s', HELLO));
  await side(page, 'Run');
  const heights = () => page.evaluate(() => {
    const height = (s: string) => Math.round((document.querySelector(s) as HTMLElement).getBoundingClientRect().height);
    const words = document.querySelector('.console .notice') as HTMLElement;
    const needs = words.checkVisibility() ? Math.round(words.getBoundingClientRect().height + (document.querySelector('.console .phead') as HTMLElement).getBoundingClientRect().height) + 2 : 0;
    return { column: height('.run-grid .leftcol'), registers: height('.regs'), console: height('.console'), needs, window: window.innerHeight };
  });
  const empty = await heights();
  expect(Math.abs(empty.console - empty.needs), `empty: ${JSON.stringify(empty)}`).toBeLessThanOrEqual(3);
  expect(Math.abs(empty.registers + 8 + empty.console - empty.column)).toBeLessThanOrEqual(2);
  await page.keyboard.press('F5');
  await settled(page);
  await expect(page.locator('.console .clog')).toContainText('hello');
  const output = await heights();
  const share = Math.min(260, Math.max(120, 0.26 * output.window));
  expect(Math.abs(output.console - share), `with output: ${JSON.stringify(output)}`).toBeLessThanOrEqual(2);
  expect(output.registers).toBeLessThan(empty.registers);
  // The grip: 60 px up gives the Console 60 px more; a double click, the share again.
  const g = (await page.locator('.leftcol > .vgrip').boundingBox())!;
  const [x, y] = [g.x + g.width / 2, g.y + g.height / 2];
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 60, { steps: 4 });
  await page.mouse.up();
  const dragged = await heights();
  expect(Math.abs(dragged.console - (output.console + 60)), `dragged: ${JSON.stringify(dragged)}`).toBeLessThanOrEqual(6);
  expect(Math.abs(dragged.registers + 8 + dragged.console - dragged.column)).toBeLessThanOrEqual(2);
  await page.locator('.leftcol > .vgrip').dblclick();
  expect(Math.abs((await heights()).console - share)).toBeLessThanOrEqual(2);
});
