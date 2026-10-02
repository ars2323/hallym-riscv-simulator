/* src/core/memory-text.ts.  (a): word, half-word and byte texts over the
   engine's data memory (RARS), checked against its bytes of the same words.
   (b): the MIPS edition's table (from the Qt build's tst_memory_text.cpp),
   with RISC-V's register names. */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import {
  asciiText, lineOffsetName, memoryDetailLines, memoryValueText, memoryValueWidth, nameWithOffset, resolveGoTo,
  type MemoryUnit,
} from '../../src/core/memory-text.ts';
import { LabelMap } from '../../src/core/symbols.ts';
import { hexBytes, root, startEngine } from '../helpers/engine.ts';

test('texts over the engine\'s memory agree with its bytes', async () => {
  const sim = await startEngine();
  try {
    const a = await sim.call('assemble', { source: readFileSync(path.join(root, 'tests/samples/data-stack.s'), 'utf8') });
    assert.ok(a.ok);
    const r = await sim.call('run', {});
    assert.ok(r.ok && r.reason === 'NORMAL_TERMINATION');
    const base = 0x10010000;
    const count = 16;
    const m = await sim.call('mem', { addr: base, len: 4 * count });
    assert.ok(m.ok);
    const bytes = hexBytes(m.hex);
    let nonZero = 0;
    for (let i = 0; i < count; i += 1) {
      const b = [...bytes.subarray(4 * i, 4 * i + 4)];
      const w = (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0; // RARS's memory is little-endian
      assert.equal(memoryValueText(w, 4, 16), b.map((x) => memoryValueText(x, 1, 16)).reverse().join(''));
      assert.equal(memoryValueText(b[0] | (b[1] << 8), 2, 16), memoryValueText(w & 0xffff, 2, 16));
      b.forEach((x) => assert.equal(memoryValueText(x, 1, 10), String((x << 24) >> 24)));
      const lines = memoryDetailLines(base + 4 * i, w, b, [], 'User data', []);
      assert.equal(lines[6], `Bytes     ${b.map((x) => memoryValueText(x, 1, 16)).join(' ')}  "${asciiText(b)}"`);
      if (w !== 0) nonZero += 1;
    }
    assert.ok(nonZero > 3);
    assert.equal(asciiText(bytes.subarray(0, 12)), 'Hello, data!');
  } finally {
    sim.close();
  }
});

test('values', () => {
  const table: [number, MemoryUnit, number, string][] = [
    [0x6c6c6548, 4, 16, '6c6c6548'], [0, 4, 16, '00000000'], [0xffffffff, 4, 10, '-1'],
    [0x80000000, 4, 10, '-2147483648'], [0x7fffffff, 4, 10, '2147483647'],
    [5, 4, 2, '00000000000000000000000000000101'],
    [0xabcd, 2, 16, 'abcd'], [0xabcd, 2, 10, '-21555'], [0x1234, 2, 10, '4660'], [0x8001, 2, 2, '1000000000000001'],
    [0x41, 1, 16, '41'], [0xff, 1, 10, '-1'], [0x7f, 1, 10, '127'], [0x80, 1, 10, '-128'], [0x05, 1, 2, '00000101'],
    // A sign-extended value from the core (read_mem_byte returns an int).
    [0xffffff80, 1, 16, '80'], [0xffffabcd, 2, 16, 'abcd'],
  ];
  for (const [value, unit, base, text] of table) {
    assert.equal(memoryValueText(value, unit, base), text, `${value.toString(16)} unit ${unit} base ${base}`);
  }
});

test('widths cover the extremes', () => {
  for (const unit of [1, 2, 4] as MemoryUnit[]) {
    for (const base of [2, 10, 16]) {
      for (const s of [0, 1, 0x7f, 0x80, 0xff, 0x7fff, 0x8000, 0xffff, 0x7fffffff, 0x80000000, 0xffffffff]) {
        assert.ok(memoryValueText(s, unit, base).length <= memoryValueWidth(unit, base));
      }
    }
  }
});

test('offsets', () => {
  assert.equal(lineOffsetName(0), '+0');
  assert.equal(lineOffsetName(4), '+4');
  assert.equal(lineOffsetName(12), '+C');
  assert.equal(lineOffsetName(0x10010025 - 0x10010020), '+5');
  assert.equal(nameWithOffset('msg', 0), 'msg');
  assert.equal(nameWithOffset('t0', 3), 't0+3');
});

test('ascii', () => {
  const bytes = [0x48, 0x69, 0x20, 0x7e, 0x00, 0x1f, 0x7f, 0x80, 0xff, 0x3c];
  assert.equal(asciiText(bytes), 'Hi ~.....<');
  assert.equal(asciiText([]), '');
});

test('detail lines', () => {
  let lines = memoryDetailLines(0x10010000, 0x6c6c6548, [0x48, 0x65, 0x6c, 0x6c], ['msg'], 'User data', ['a0', 't0+1']);
  assert.equal(lines.join('\n'),
    '0x10010000 | msg | User data\n'
    + 'Hex       0x6c6c6548\n'
    + 'Signed    1819043144\n'
    + 'Unsigned  1819043144\n'
    + '31   27   23   19   15   11   7    3\n'
    + '0110 1100 0110 1100 0110 0101 0100 1000\n'
    + 'Bytes     48 65 6c 6c  "Hell"\n'
    + 'Pointers  a0, t0+1');
  lines = memoryDetailLines(0x7fffff84, 0, [0, 0, 0, 0], [], 'User stack', []);
  assert.equal(lines.length, 7); // no Pointers line
  assert.equal(lines[0], '0x7fffff84 | User stack');
  assert.equal(lines[6], 'Bytes     00 00 00 00  "...."');
});

test('go to', () => {
  const labels = new LabelMap();
  labels.add('msg', 0x10010000);
  labels.add('deadbeef', 0x10010080); // a label that looks like hex
  assert.deepEqual(resolveGoTo(' sp ', labels), { kind: 'Register', reg: { file: 'x', number: 2 } });
  assert.deepEqual(resolveGoTo('x2', labels), { kind: 'Register', reg: { file: 'x', number: 2 } });
  assert.deepEqual(resolveGoTo('fp', labels), { kind: 'Register', reg: { file: 'x', number: 8 } });
  assert.deepEqual(resolveGoTo('fa0', labels), { kind: 'Register', reg: { file: 'f', number: 10 } });
  assert.deepEqual(resolveGoTo('msg', labels), { kind: 'Label', address: 0x10010000, label: 'msg' });
  // A label wins over hex digits.
  assert.deepEqual(resolveGoTo('deadbeef', labels), { kind: 'Label', address: 0x10010080, label: 'deadbeef' });
  assert.deepEqual(resolveGoTo('0x10010004', labels), { kind: 'Address', address: 0x10010004 });
  assert.deepEqual(resolveGoTo('10010004', labels), { kind: 'Address', address: 0x10010004 });
  assert.deepEqual(resolveGoTo('7FFFFF84', labels), { kind: 'Address', address: 0x7fffff84 });
  // "a0" is the register; the address 0xa0 is written with 0x.
  assert.equal(resolveGoTo('a0', labels).kind, 'Register');
  assert.deepEqual(resolveGoTo('0xa0', labels), { kind: 'Address', address: 0xa0 });
  const none = new LabelMap();
  for (const text of ['', '0x', '123456789', 'no such label', 'x32', '$t0']) assert.equal(resolveGoTo(text, none).kind, 'Invalid', text);
});
