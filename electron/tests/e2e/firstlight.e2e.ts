/* The RISC-V edition's first light: the ten things the round set out to
   make work, each in the real app with the real engine (RARS in a JVM).

     1  the app opens on the Editor              6  the Inspector takes R and I words apart
     2  open a .s file, or write a new one       7  Run, and Stop
     3  Ctrl+S assembles; errors by line         8  console output, and input the program asks for
     4  F10 steps; changed registers marked      9  assembling again is clean; breakpoints survive it
     5  Text: address, encoding, instruction     10 a dead engine comes back, and the student is told

   Three of them also write the pictures the round's report shows
   (docs/screens/riscv-*.png).

   Negative controls (each must make its test fail; run by hand, results in
   the round's report):
     ENGINE_JAVA_ARGS=-Dprobe.v1Breakpoints=true  -> 9 fails (the engine keeps the old address)
     ENGINE_JAVA_ARGS=-Dprobe.v1StopInput=true    -> 8 fails (a0 holds the fake input 0)
     SIM_RESTART=0                                -> 10 fails (no engine comes back) */

import { expect, test } from '@playwright/test';
import path from 'node:path';

import { javaPids } from '../helpers/processes.ts';
import { answerSave, launch, newFile, openAndAssemble, openOnly, program, regHex, root, settled, statusText, type Running } from './harness.ts';

let r: Running;
test.beforeEach(async () => { r = await launch(); });
test.afterEach(async () => { await r.close(); });

const SCREENS = path.join(root, 'docs', 'screens');

// A click in the breakpoint gutter, level with the Editor's line `line`.
async function gutter(line: number): Promise<void> {
  const at = (await r.page.locator('.cm-line').nth(line - 1).boundingBox())!;
  const g = (await r.page.locator('.cm-bp-gutter').boundingBox())!;
  await r.page.mouse.click(g.x + g.width / 2, at.y + at.height / 2);
}

const ARITH = `# x10..x12: a few R and I instructions
main:
    li   a0, 5          # I: addi
    addi a1, a0, 7      # I
    add  a2, a0, a1     # R
    sub  a3, a2, a0     # R
    lw   a4, 0(sp)      # I: a load
    li   a7, 10
    ecall
`;

test('1-6: opens on the Editor, writes a program, assembles, steps; registers, Text and the Inspector', async () => {
  const { page } = r;
  // 1: the first screen, then (바로 시작, 새 파일) an empty Editor
  await expect(page.locator('.wcard')).toBeVisible();
  await newFile(page);
  await expect(page.locator('.editor-panel .cm-content')).toBeVisible();
  await expect(page.locator('.titlebar .file')).toContainText('untitled.s');
  // 2 (new): type a program; Ctrl+S asks where to save it, then assembles
  await answerSave(r.app, path.join(r.dir, 'arith.s'));
  await page.locator('.cm-content').click();
  await page.keyboard.insertText(ARITH);
  await page.keyboard.press('Control+s');
  await page.waitForSelector('.run-grid:not([hidden])');
  await expect(page.locator('.titlebar .file')).toContainText('arith.s');
  await expect(page.locator('.asm')).toContainText('어셈블했습니다');
  // 5: Text rows: address, encoding, format, instruction, line, source
  const first = page.locator('.trow').first();
  await expect(first.locator('.addr')).toHaveText('00400000');
  await expect(first.locator('.word')).toHaveText('00500513');
  await expect(first.locator('.dis')).toHaveText('addi x10,x0,5');
  await expect(first.locator('.lno')).toHaveText('3');
  await expect(first.locator('.src')).toContainText('li   a0, 5');
  // 4: F10 three times; a2 (x12) changes on the third and is marked
  for (let i = 0; i < 3; i += 1) { await page.keyboard.press('F10'); await settled(page); }
  expect(await regHex(page, 'x10')).toBe('0x00000005');
  expect(await regHex(page, 'x11')).toBe('0x0000000c');
  expect(await regHex(page, 'x12')).toBe('0x00000011');
  await expect(page.locator('.rrow.chg')).toHaveCount(1);
  await expect(page.locator('.rrow.chg')).toHaveAttribute('data-reg', 'x12');
  await expect(page.locator('.rrow[data-reg="x12"] .rn')).toHaveText('x12 a2');
  expect(await statusText(page)).toContain('방금 바뀜');
  // 6: the Inspector follows PC: sub (R) is next -- funct7 rs2 rs1 funct3 rd opcode
  const insp = page.locator('.insp');
  await expect(insp.locator('.ihead .dis')).toHaveText('sub x13,x12,x10');
  await expect(insp.locator('.ihead .badge')).toHaveText('R');
  await expect(insp.locator('.fname')).toHaveText(['funct7', 'rs2', 'rs1', 'funct3', 'rd', 'opcode']);
  await expect(insp.locator('.fbox.f-funct7 .fbits')).toHaveText('0100000');
  await expect(insp.locator('.explain')).toContainText('x12');
  await page.screenshot({ path: path.join(SCREENS, 'riscv-overview.png') });
  // ...and an I word (lw): imm[11:0] rs1 funct3 rd opcode, the immediate sign-extended
  await page.keyboard.press('F10');
  await settled(page);
  await expect(insp.locator('.ihead .dis')).toHaveText('lw x14,0(x2)');
  await expect(insp.locator('.fname')).toHaveText(['imm[11:0]', 'rs1', 'funct3', 'rd', 'opcode']);
  await expect(insp.locator('.explain')).toContainText('4바이트 값을');
});

test('2: opens a .s file from disk', async () => {
  const file = program(r.dir, 'hello.s', '.data\nmsg: .asciz "hi"\n.text\nmain:\n  la a0, msg\n  li a7, 4\n  ecall\n');
  await openOnly(r, file);
  await expect(r.page.locator('.titlebar .file')).toContainText('hello.s');
  await expect(r.page.locator('.cm-content')).toContainText('la a0, msg');
});

test('3: errors in the Assemble panel, by line, in RARS\'s words; the machine on screen stays', async () => {
  const { page } = r;
  await openAndAssemble(r, program(r.dir, 'ok.s', 'main:\n  li a0, 1\n  li a7, 10\n  ecall\n'));
  await page.keyboard.press('F10');
  await settled(page);
  expect(await regHex(page, 'x10')).toBe('0x00000001');
  // Two errors: a missing operand on line 3, an unknown instruction on line 5.
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('main:\n  li a0, 1\n  addi a1, a0\n  li a7, 10\n  bogus a0\n  ecall\n');
  await page.keyboard.press('Control+s');
  const panel = page.locator('.asm[data-state=errors]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('h3')).toHaveText('코드에 오류가 2개 있습니다');
  await expect(panel.locator('.item .line')).toHaveText(['3행', '5행']);
  await expect(panel.locator('.item .what').first()).toContainText('Too few or incorrectly formatted operands');
  await expect(panel.locator('.item .what').last()).toContainText('"bogus" is not a recognized operator');
  await expect(page.locator('.cm-error-gutter .cm-error-mark')).toHaveCount(2);
  // The last program is still on the Run side, where it was.
  expect(await regHex(page, 'x10')).toBe('0x00000001');
  await page.screenshot({ path: path.join(SCREENS, 'riscv-errors.png') });
});

test('7: Run, and Stop (Esc) ends an endless loop', async () => {
  const { page } = r;
  await openAndAssemble(r, program(r.dir, 'loop.s', 'main:\n  addi t0, t0, 1\n  j main\n'));
  await page.keyboard.press('F5');
  await expect(page.locator('.status')).toContainText('실행 중');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await settled(page);
  await expect(page.locator('.status')).toContainText('멈췄습니다');
  expect(Number.parseInt(await regHex(page, 'x5'), 16)).toBeGreaterThan(1000); // t0 counted while it ran
  // and Run to the end of a program that ends
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('main:\n  li a0, 3\n  li a7, 93\n  ecall\n');
  await page.keyboard.press('Control+s');
  await page.waitForSelector('.asm[data-state=ok]');
  await page.keyboard.press('F5');
  await settled(page);
  await expect(page.locator('.status')).toContainText('프로그램이 끝났습니다');
});

const READ = `.data
prompt: .asciz "number? "
.text
main:
    li   a0, 77
    la   a0, prompt
    li   a7, 4          # PrintString
    ecall
    li   a7, 5          # ReadInt
    ecall
    add  a0, a0, a0
    li   a7, 1          # PrintInt
    ecall
    li   a7, 10
    ecall
`;

test('8: console output, input when the program asks; Stop while it waits leaves no fake input', async () => {
  const { page } = r;
  await openAndAssemble(r, program(r.dir, 'read.s', READ));
  await page.keyboard.press('F5');
  const input = page.locator('.cinput');
  await expect(input).toBeVisible();
  await expect(page.locator('.clog')).toHaveText('number? ');
  await expect(page.locator('.status')).toContainText('입력을 기다립니다');
  await input.fill('21');
  await page.screenshot({ path: path.join(SCREENS, 'riscv-console-input.png') });
  await input.press('Enter');
  await settled(page);
  await expect(page.locator('.clog')).toContainText('42');
  await expect(page.locator('.status')).toContainText('프로그램이 끝났습니다');

  // Stop while it waits: the engine undoes the ecall -- a0 is not RARS's fake 0, PC is the ecall again.
  await page.getByRole('button', { name: /Reset/ }).click();
  await settled(page);
  await page.keyboard.press('F5');
  await expect(input).toBeVisible();
  await page.keyboard.press('Escape');
  await settled(page);
  await expect(page.locator('.status')).toContainText('입력을 기다리다 멈췄습니다');
  expect(await regHex(page, 'x10')).not.toBe('0x00000000');
  expect(await regHex(page, 'x17')).toBe('0x00000005');
  // ...and running on asks again
  await page.keyboard.press('F5');
  await expect(input).toBeVisible();
  await input.fill('5');
  await input.press('Enter');
  await settled(page);
  await expect(page.locator('.clog')).toContainText('10');
});

const BP = `main:
    li   t0, 1        # line 2
    # line 3: becomes code in the second version
    li   t1, 2        # line 4
    li   t2, 3        # line 5
    li   a7, 10
    ecall
`;

test('9: assembling again is clean, and a breakpoint survives it (the engine sets it again)', async () => {
  const { page } = r;
  await openAndAssemble(r, program(r.dir, 'bp.s', BP));
  await gutter(5);
  await expect(page.locator('.cm-bp-dot')).toHaveCount(1);
  await page.keyboard.press('F5');
  await settled(page);
  expect(await statusText(page)).toContain('브레이크포인트');
  expect(await regHex(page, 'x6')).toBe('0x00000002');   // t1 done
  expect(await regHex(page, 'x7')).toBe('0x00000000');   // t2 not yet
  // Line 3 becomes code: line 5's instruction moves to a new address.  The app sends no breakpoint.
  await page.locator('.cm-line').nth(2).click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await page.keyboard.insertText('    li   t3, 9');
  await page.keyboard.press('Control+s');
  await page.waitForSelector('.asm[data-state=ok]');
  // Clean: the machine starts again from nothing.
  expect(await regHex(page, 'x5')).toBe('0x00000000');
  expect(await regHex(page, 'x6')).toBe('0x00000000');
  await expect(page.locator('.clog')).toBeHidden();
  await expect(page.locator('.trow.bp-on .lno')).toHaveText('5');
  await page.keyboard.press('F5');
  await settled(page);
  expect(await statusText(page)).toContain('브레이크포인트');
  expect(await regHex(page, 'x28')).toBe('0x00000009');  // the new line 3 ran
  expect(await regHex(page, 'x6')).toBe('0x00000002');   // line 4 ran
  expect(await regHex(page, 'x7')).toBe('0x00000000');   // stopped before line 5, not before line 4
});

// The pids of this app's engine processes of one role (Windows too: tests/helpers/processes.ts).
const enginePids = (role: 'main' | 'checker'): number[] => javaPids(`-Dhallym.engine=${role}`, r.dir);

test('10: the engine dies -> the student is told, a fresh engine starts, the program assembles again', async () => {
  const { page } = r;
  await openAndAssemble(r, program(r.dir, 'p.s', 'main:\n  li a0, 7\n  li a7, 10\n  ecall\n'));
  await page.keyboard.press('F10');
  await settled(page);
  const pids = enginePids('main');
  expect(pids).toHaveLength(1);
  process.kill(pids[0], 'SIGKILL');
  await expect(page.locator('.status')).toContainText('시뮬레이터 엔진이 멈췄습니다');
  await expect(page.locator('.run-placeholder')).toContainText('엔진을 다시 시작했습니다');
  // A fresh engine (another process), ready: Ctrl+S works again.
  await expect.poll(() => enginePids('main').filter((p) => p !== pids[0]).length, { timeout: 15_000 }).toBe(1);
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+s');
  await page.waitForSelector('.asm[data-state=ok]');
  await page.keyboard.press('F10');
  await settled(page);
  expect(await regHex(page, 'x10')).toBe('0x00000007');
});
