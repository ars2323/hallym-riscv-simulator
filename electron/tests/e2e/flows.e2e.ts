/* The window's main paths, end to end in the real app. */

import { expect, test } from '@playwright/test';
import path from 'node:path';

import { answerSave, launch, openAndAssemble, program, regHex, sample, settled, statusText, textRow, type Running } from './harness.ts';

let r: Running;
test.beforeEach(async () => { r = await launch(); });
test.afterEach(async () => { await r.close(); });

test('new file -> paste -> Ctrl+S -> errors -> fix -> Ctrl+S -> Text', async () => {
  const { app, page } = r;
  // (No first screen in this edition: the app opens on an untitled file.)
  await expect(page.locator('.editor-panel')).toBeVisible();

  const source = 'main:\n  li   t0, 5\n  srll t1, t0, 1\n  li   a7, 10\n  ecall\n';
  await app.evaluate(({ clipboard }, t) => clipboard.writeText(t), source);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+v');
  await expect(page.locator('.cm-line').nth(2)).toHaveText('  srll t1, t0, 1');

  const saved = path.join(r.dir, 'week1.s');
  await answerSave(app, saved);
  await page.keyboard.press('Control+s');
  const item = page.locator('.asm .item');
  await expect(item).toHaveCount(1);
  await expect(item.locator('.line')).toHaveText('3행');
  await expect(page.locator('.cm-error-line')).toHaveCount(1);
  await expect(page.locator('.titlebar .file')).toContainText('week1.s');

  await page.locator('.asm').getByRole('button', { name: '3행으로 가기' }).click();
  await page.keyboard.press('Shift+End');
  await page.keyboard.insertText('  srli t1, t0, 1');
  await page.keyboard.press('Control+s');

  await expect(page.locator('.run-grid')).toBeVisible();
  await expect(page.locator('.ptab.on')).toHaveText('Text');
  await expect(page.locator('.asm')).toHaveAttribute('data-state', 'ok');
  await expect(page.locator('.asm .item')).toHaveCount(0);
  await expect(page.locator('.trow .src', { hasText: 'srli t1, t0, 1' })).toHaveCount(1);
});

test('F10 changes registers and highlights only what changed', async () => {
  const { page } = r;
  await openAndAssemble(r, program(r.dir, 'f10.s', 'main:\n  li t0, 5\n  srli t1, t0, 1\n  li a7, 10\n  ecall\n'));
  await expect(page.locator('.run-grid')).toBeVisible();
  for (let i = 0; i < 20 && (await regHex(page, 'x5')) === '0x00000000'; i += 1) {
    await page.keyboard.press('F10');
    await settled(page);
  }
  expect(await regHex(page, 'x5')).toBe('0x00000005');
  await expect(page.locator('.rrow[data-reg="x5"]')).toHaveClass(/chg/);
  await expect(page.locator('.rrow.chg')).toHaveCount(1);
  await expect(page.locator('.status')).toContainText('t0');

  await page.keyboard.press('F10');
  await settled(page);
  expect(await regHex(page, 'x6')).toBe('0x00000002');
  await expect(page.locator('.rrow.chg')).toHaveCount(1);
  await expect(page.locator('.rrow[data-reg="x6"]')).toHaveClass(/chg/);
  await expect(page.locator('.rrow[data-reg="x5"]')).not.toHaveClass(/chg/);
  // The PC row in Text follows.
  const pc = await regHex(page, 'pc');
  await expect(page.locator('.trow.pc')).toHaveAttribute('data-addr', pc);
});

test('choosing an instruction opens the Inspector with its fields', async () => {
  const { page } = r;
  await openAndAssemble(r, sample(r.dir, 'tests/samples/lab04-ok.s', 'lab04.s'));
  const panel = page.locator('.insp');
  await expect(panel.locator('.ihead')).toHaveCount(0); // nothing chosen: the guide
  await (await textRow(page, '0x00400030')).locator('.dis').click(); // srai s2, t6, 1: an I-type shift
  await expect(panel.locator('.ihead .dis')).toHaveText('srai x18,x31,1');
  await expect(panel.locator('.bitgrid .fname')).toHaveText(['funct7', 'shamt', 'rs1', 'funct3', 'rd', 'opcode']);
  await expect(panel.locator('.bitgrid .fbits')).toHaveText(['0100000', '00001', '11111', '101', '10010', '0010011']);
  await expect(panel.locator('.bitgrid .bit')).toHaveCount(32);
  await expect(panel.locator('.ftable tr').nth(3).locator('td').last()).toHaveText('x31 (t6)');
  await expect(panel.locator('.explain')).toContainText('srai — Shift Right Arithmetic Immediate');
  await expect(panel.locator('.explain')).toContainText('s2');
  await page.keyboard.press('Escape');
  await expect(panel.locator('.ihead')).toHaveCount(0);
});

test('breakpoint -> F5 stops there -> F5 goes on to the end', async () => {
  const { page } = r;
  await openAndAssemble(r, program(r.dir, 'bp.s', 'main:\n  li t0, 1\n  li t1, 2\n  add t2, t0, t1\n  li a7, 10\n  ecall\n'));
  const row = page.locator('.trow', { has: page.locator('.src', { hasText: 'add t2' }) });
  const addr = await row.getAttribute('data-addr');
  await row.locator('.bp').click();
  await expect(row).toHaveClass(/bp-on/);
  await page.keyboard.press('F5');
  await settled(page);
  expect(await statusText(page)).toContain('브레이크포인트');
  await expect(page.locator('.trow.pc')).toHaveAttribute('data-addr', addr!);
  expect(await regHex(page, 'x7')).toBe('0x00000000');
  expect(await regHex(page, 'x6')).toBe('0x00000002');

  await page.keyboard.press('F5');
  await settled(page);
  expect(await statusText(page)).toContain('프로그램이 끝났습니다');
  expect(await regHex(page, 'x7')).toBe('0x00000003');
  // (No "first run" card with a character in this edition.)
  await page.getByRole('button', { name: /Reset/ }).click();
  // Keys wait while Reset builds the new machine: wait for it to be ready.
  await expect(page.locator('.status')).toContainText('Step · ');
  await expect(page.locator('.trow', { has: page.locator('.src', { hasText: 'add t2' }) })).toHaveClass(/bp-on/);
  await page.keyboard.press('F5');
  await expect(page.locator('.status')).toContainText('브레이크포인트'); // the new machine has it too
  await page.keyboard.press('F5');
  await expect(page.locator('.status')).toContainText('프로그램이 끝났습니다');
});

test('an endless loop: F5, stop, the registers are there to read', async () => {
  const { page } = r;
  await openAndAssemble(r, program(r.dir, 'loop.s', 'main:\nloop:\n  addi t0, t0, 1\n  j loop\n'));
  await page.keyboard.press('F5');
  await expect(page.locator('.status .run')).toHaveText('실행 중');
  // (No progress events from the engine yet: docs/engine-protocol.md 10, hole 9.)
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await settled(page);
  expect(await statusText(page)).toContain('멈췄습니다');
  const t0 = parseInt(await regHex(page, 'x5'), 16);
  expect(t0).toBeGreaterThan(1000);
  // Still a machine: one more step, and the Inspector reads it.
  await page.keyboard.press('F10');
  await settled(page);
  const pc = await regHex(page, 'pc');
  await (await textRow(page, pc)).locator('.dis').click();
  await expect(page.locator('.insp .ihead .dis')).toBeVisible();
});

test('console input: the run waits, Enter goes on', async () => {
  const { page } = r;
  await openAndAssemble(r, program(r.dir, 'read.s',
    'main:\n  li a7, 5\n  ecall\n  addi a0, a0, 1\n  li a7, 1\n  ecall\n  li a7, 10\n  ecall\n'));
  await page.keyboard.press('F5');
  const input = page.locator('.cinput');
  await expect(input).toBeVisible();
  await expect(input).toBeFocused();
  expect(await statusText(page)).toContain('입력을 기다립니다');
  // The run is still going on, waiting: the button is Stop (the engine undoes the ecall if pressed).
  await expect(page.getByTitle('Stop (Esc)')).toBeEnabled();
  await input.fill('41');
  await input.press('Enter');
  await expect(page.locator('.clog')).toHaveText('41\n42');
  await settled(page);
  expect(await statusText(page)).toContain('프로그램이 끝났습니다');
  await expect(input).toBeHidden();
});

// (The MIPS edition's ".err directive ends the core" test is not here: RARS has
// no such directive, and nothing in a source ends the engine.  A dead engine is
// firstlight.e2e.ts 10.)
