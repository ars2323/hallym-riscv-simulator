/* src/core/decoder.ts against RARS itself.

   tests/core/rars-words.json holds words RARS assembled from
   tests/core/rars-words.s with what RARS prints for each (its `basic`),
   made by tools/gen-rars-words.ts through the engine.  The decoder sees the
   word only; its name, its format and, for R and I, its fields must agree
   with what RARS says the word is. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { decode, FORMATS, formatOf, reassemble } from '../../src/core/decoder.ts';

const root = path.join(import.meta.dirname, '..', '..');
const words: { code: number; basic: string; line: number }[] =
  JSON.parse(readFileSync(path.join(root, 'tests/core/rars-words.json'), 'utf8')).words;

// "addi x10,x0,5" -> name "addi", operands ["x10", "x0", "5"]; "lw x14,0(x2)" -> ["x14", "0", "x2"]
function parse(basic: string): { name: string; ops: string[] } {
  const [name, rest = ''] = basic.trim().split(/\s+/, 2);
  return { name, ops: rest.split(/[,()]/).map((s) => s.trim()).filter(Boolean) };
}
const regNum = (s: string) => Number(/^[xf](\d+)$/.exec(s)?.[1] ?? NaN);
const num = (s: string) => (/^0x/i.test(s) ? parseInt(s, 16) | 0 : Number(s));

export function checkWord(w: { code: number; basic: string }, decoder = decode): void {
  const d = decoder(w.code);
  const { name, ops } = parse(w.basic);
  assert.equal(d.name, name, `${w.basic}: name`);
  assert.ok(d.known, w.basic);
  if (!d.fields) return;
  assert.equal(reassemble(d), w.code >>> 0, `${w.basic}: fields tile the word`);
  const field = (n: string) => d.fields!.find((f) => f.name === n)?.value;
  if (d.format === 'R' && !name.startsWith('f')) {
    assert.deepEqual([field('rd'), field('rs1'), field('rs2')], ops.map(regNum), `${w.basic}: rd rs1 rs2`);
  }
  if (d.format === 'I') {
    if (['lb', 'lh', 'lw', 'lbu', 'lhu', 'flw', 'fld'].includes(name) && ops.length === 3) {
      // lw x14,0(x2): rd, imm, rs1 (jalr prints as jalr x1,x6,0: rd, rs1, imm, below)
      assert.deepEqual([field('rd'), d.imm, field('rs1')], [regNum(ops[0]), num(ops[1]), regNum(ops[2])], `${w.basic}: rd imm rs1`);
    } else if (['slli', 'srli', 'srai'].includes(name)) {
      assert.deepEqual([field('rd'), field('rs1'), field('shamt')], [regNum(ops[0]), regNum(ops[1]), num(ops[2])], w.basic);
    } else if (ops.length === 3 && !name.startsWith('csr')) {
      assert.deepEqual([field('rd'), field('rs1'), d.imm], [regNum(ops[0]), regNum(ops[1]), num(ops[2])], `${w.basic}: rd rs1 imm`);
    }
  }
}

test('every word RARS assembled: the decoder names it as RARS does, and takes R and I apart as RARS reads them', () => {
  assert.ok(words.length > 60, 'the corpus is there');
  for (const w of words) checkWord(w);
  const formats = new Set(words.map((w) => formatOf(w.code)));
  for (const f of ['R', 'I', 'S', 'B', 'U', 'J']) assert.ok(formats.has(f as never), `corpus covers ${f}`);
});

test('negative control: a decoder that swaps two names is caught', () => {
  const swapped = (word: number) => {
    const d = decode(word);
    return d.name === 'sub' ? { ...d, name: 'add' } : d;
  };
  assert.throws(() => { for (const w of words) checkWord(w, swapped); }, /name/);
});

test('this round takes R and I apart; S, B, U, J are entries still to add', () => {
  assert.deepEqual(Object.keys(FORMATS).sort(), ['I', 'R']);
  const sw = words.find((w) => parse(w.basic).name === 'sw')!;
  assert.equal(decode(sw.code).format, 'S');
  assert.equal(decode(sw.code).fields, null); // no wrong picture
});
