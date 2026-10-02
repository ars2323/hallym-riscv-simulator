/* The Inspector in all six formats, in the real window: for each, the word
   in the format's fields, and -- where there is an immediate -- the row
   that puts its scattered pieces together.  That row, read off the screen
   bit by bit (sign extension, pieces, the always-0 bits), must be the
   32-bit immediate the line under it states, and the immediate RARS printed
   in the instruction ("beq x7,x0,0x00000008").
   Negative control: the same reading with the always-0 box taken out of the
   row is caught (a row that forgot B's or J's lowest bit). */

import { expect, test, type Page } from '@playwright/test';

import { launch, openAndAssemble, program, settled, type Running } from './harness.ts';

const PROGRAM = `.data
v:  .word 0
.text
main:
    nop                 # the Inspector shows the instruction at PC once a step is taken
    add  t1, t0, t0
    addi t2, t1, -5
    lui  t0, 0x10010
    sw   t2, -8(t0)
    bne  t2, zero, next  # taken: t2 is -5
    nop
next:
    jal  ra, fun
    li   a7, 10
    ecall
fun:
    ret
`;

// [format, field names in the word, immediate bit names under the row (null: no row)]
const STEPS: [string, string[], string[] | null][] = [
  ['R', ['funct7', 'rs2', 'rs1', 'funct3', 'rd', 'opcode'], null],
  ['I', ['imm[11:0]', 'rs1', 'funct3', 'rd', 'opcode'], ['부호 확장: imm[11] 복사', '11:0']],
  ['U', ['imm[31:12]', 'rd', 'opcode'], ['31:12', '11:0']],
  ['S', ['imm[11:5]', 'rs2', 'rs1', 'funct3', 'imm[4:0]', 'opcode'], ['부호 확장: imm[11] 복사', '11:5', '4:0']],
  ['B', ['imm[12|10:5]', 'rs2', 'rs1', 'funct3', 'imm[4:1|11]', 'opcode'], ['부호 확장: imm[12] 복사', '12', '11', '10:5', '4:1', '0']],
  ['J', ['imm[20|10:1|11|19:12]', 'rd', 'opcode'], ['부호 확장: imm[20] 복사', '20', '19:12', '11', '10:1', '0']],
];

// The immediate as the row shows it: its 32 bits, left to right.
const rowBits = (page: Page) => page.locator('.immgrid .bit').allInnerTexts().then((b) => b.join(''));
// What the line under it says: "imm = … = -8 (…)" or "imm = 0x10010000 (…)".
async function statedImmediate(page: Page): Promise<number> {
  const note = await page.locator('.explain .note').innerText();
  const m = /=\s*(-?\d+)\s*\(/.exec(note) ?? /imm = (0x[0-9a-f]+)/.exec(note);
  if (!m) throw new Error(`no immediate in "${note}"`);
  return Number(m[1]) | 0;
}
// The immediate RARS printed: the last operand, or the offset in "x(reg)"; U prints its upper 20 bits.
async function rarsImmediate(page: Page, format: string): Promise<number> {
  const dis = await page.locator('.ihead .dis').innerText();
  const ops = dis.split(/\s+/)[1].split(/[,()]/).filter(Boolean);
  const text = format === 'S' || (format === 'I' && /\(/.test(dis)) ? ops[1] : ops[ops.length - 1];
  const n = /^0x/.test(text) ? parseInt(text, 16) | 0 : Number(text);
  return format === 'U' ? (n << 12) | 0 : n;
}
async function checkRow(page: Page, format: string): Promise<void> {
  const bits = await rowBits(page);
  expect(bits, 'the row is the immediate in 32 bits').toMatch(/^[01]{32}$/);
  const shown = parseInt(bits, 2) | 0;
  expect(shown, 'the row = the value stated under it').toBe(await statedImmediate(page));
  expect(shown, 'the row = what RARS printed').toBe(await rarsImmediate(page, format));
}

let r: Running;
test.beforeAll(async () => {
  r = await launch({ width: 1920, height: 1040 });
  await openAndAssemble(r, program(r.dir, 'formats.s', PROGRAM));
  await r.page.keyboard.press('F10');
  await settled(r.page);
});
test.afterAll(async () => { await r.close(); });

test('R, I, U, S, B, J: the fields of the word, and the immediate put together from its pieces', async () => {
  const { page } = r;
  for (const [format, fields, imm] of STEPS) {
    await expect(page.locator('.insp .badge')).toHaveText(format);
    expect(await page.locator('.insp .bitgrid:not(.immgrid) .fname').allInnerTexts(), `${format}: fields`).toEqual(fields);
    if (imm === null) {
      await expect(page.locator('.immgrid')).toHaveCount(0);
    } else {
      expect(await page.locator('.immgrid .iname').allInnerTexts(), `${format}: the row's pieces`).toEqual(imm);
      await checkRow(page, format);
      // Each piece in the row has the colour of its bits in the word above.
      const pieces = await page.locator('.immgrid .ipiece').count();
      for (let k = 1; k <= pieces; k += 1) await expect(page.locator(`.bitgrid:not(.immgrid) .bit.p${k}`).first()).toBeVisible();
    }
    await page.keyboard.press('F10');
    await settled(page);
  }
});

test('negative control: a row without the always-0 bit is caught', async () => {
  const { page } = r;
  await openAndAssemble(r, program(r.dir, 'b.s', 'main:\n    nop\n    beq t2, zero, next\n    nop\nnext:\n    nop\n'));
  await page.keyboard.press('F10');
  await settled(page);
  await expect(page.locator('.insp .badge')).toHaveText('B');
  await checkRow(page, 'B');
  await page.locator('.immgrid .izero').evaluate((el) => el.remove());
  await expect(checkRow(page, 'B')).rejects.toThrow();
});
