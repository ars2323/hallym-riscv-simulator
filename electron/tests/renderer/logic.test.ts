/* The window's pure logic over the engine's replies (logic/machine.ts). */

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  changedKeys, fpCells, registerRows, stateAfter, stopMessage, stopReason, textRows, WINDOW_GROUPS, ZERO_REGS, type RegisterValues,
} from '../../src/renderer/app/logic/machine.ts';

const regs = (patch: Partial<RegisterValues> = {}): RegisterValues => ({ ...ZERO_REGS, x: [...ZERO_REGS.x], fbits: [...ZERO_REGS.fbits], ...patch });

test('register rows: pc, then x0..x31 each once, named both ways, by the RISC-V groups', () => {
  const rows = registerRows(regs());
  assert.equal(rows[0].key, 'pc');
  const xs = rows.filter((r) => r.key !== 'pc').map((r) => Number(r.key.slice(1)));
  assert.deepEqual([...xs].sort((a, b) => a - b), Array.from({ length: 32 }, (_, i) => i));
  assert.equal(rows.find((r) => r.key === 'x10')!.name, 'x10 a0');
  assert.equal(rows.find((r) => r.key === 'x8')!.name, 'x8 s0/fp');
  assert.equal(rows.find((r) => r.key === 'x0')!.group, 'Constant');
  assert.equal(rows.find((r) => r.key === 'x1')!.group, 'Return address');
  assert.equal(rows.find((r) => r.key === 'x17')!.group, 'Arguments · return values');
  assert.equal(rows.find((r) => r.key === 'x28')!.group, 'Temporaries');
  assert.equal(rows.find((r) => r.key === 'x27')!.group, 'Saved');
  // No MIPS groups.
  assert.ok(!WINDOW_GROUPS.some((g) => ['Return values', 'Reserved', 'CP0'].includes(g.title)));
});

test('changed registers: x and f, not pc', () => {
  const a = regs();
  const b = regs({ pc: 4, x: a.x.map((v, i) => (i === 12 ? 17 : v)), fbits: a.fbits.map((v, i) => (i === 1 ? '3ff8000000000000' : v)) });
  assert.deepEqual([...changedKeys(a, b)].sort(), ['f1', 'x12']);
  assert.equal(changedKeys(null, b).size, 0);
});

test('f registers from their 64 bits: a NaN-boxed single, or a double', () => {
  assert.deepEqual(fpCells('ffffffff40400000'), { hex: '0x40400000', value: '3', kind: 'single' });
  assert.deepEqual(fpCells('3ff8000000000000'), { hex: '0x3ff8000000000000', value: '1.5', kind: 'double' });
  // What the engine's 32-bit view would have shown for that double: NaN.  fpCells never reads it.
  assert.equal(fpCells('ffffffff7fc00000').value, 'NaN');
});

test('text rows from the engine: unsigned, a pseudo instruction as a band', () => {
  const rows = textRows([
    { addr: 0x00400000, code: 0x0fc10517, basic: 'auipc x10,0x0000fc10', line: 5, src: 'la a0, msg' },
    { addr: 0x00400004, code: 0x00050513, basic: 'addi x10,x10,0', line: 5, src: '' },
    { addr: 0x00400008, code: -2101137, basic: 'jal x0,0xfffffffc', line: 6, src: 'j main' },
  ], new Set([0x00400008]));
  assert.deepEqual(rows.map((r) => [r.format, r.band, r.breakpoint]), [['U', true, false], ['I', true, false], ['J', false, true]]);
  assert.equal(rows[2].word, 0xffdff06f);
});

test('what a stop means', () => {
  assert.equal(stopReason('NORMAL_TERMINATION'), 'exit');
  assert.equal(stopReason('CLIFF_TERMINATION'), 'exit');
  assert.equal(stopReason('EXCEPTION'), 'error');
  assert.equal(stopReason('BREAKPOINT'), 'breakpoint');
  assert.equal(stopReason('STOP'), 'stopped');
  assert.equal(stopReason('MAX_STEPS'), 'limit');
  assert.equal(stateAfter('exit'), 'finished');
  assert.equal(stateAfter('error'), 'finished');
  assert.equal(stateAfter('breakpoint'), 'paused');
  assert.match(stopMessage('breakpoint', '0x00400008'), /`0x00400008`/);
  assert.match(stopMessage('input', ''), /입력/);
});
