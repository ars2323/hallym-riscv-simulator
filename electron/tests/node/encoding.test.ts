/* A source file saved as CP949 (with CRLF, as old Windows editors wrote it)
   assembles to the very same machine as its UTF-8 twin: the bytes are
   decoded in Node (src/node/text-file.ts) and the engine receives text
   either way.  (The MIPS edition's test, on the RISC-V engine.) */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';

import { decodeTextFile } from '../../src/node/text-file.ts';
import type { Simulator } from '../../src/sim/host.ts';
import { hexBytes, root, startEngine } from '../helpers/engine.ts';

let sim: Simulator;
before(async () => { sim = await startEngine(); });
after(() => sim.close());

async function machine(file: string) {
  const decoded = decodeTextFile(readFileSync(path.join(root, file)));
  const assembled = await sim.call('assemble', { source: decoded.text });
  assert.ok(assembled.ok, JSON.stringify(assembled));
  const data = await sim.call('mem', { addr: 0x10010000, len: 64 });
  assert.ok(data.ok);
  const out: string[] = [];
  const listen = (t: string) => out.push(t);
  sim.on('console', listen);
  const run = await sim.call('run', {});
  sim.off('console', listen);
  assert.ok(run.ok);
  return { format: decoded.format, text: assembled.text, symbols: assembled.symbols, data: data.hex, output: out.join(''), x: run.x };
}

test('CP949 + CRLF and UTF-8 + LF give the same machine', async () => {
  const utf8 = await machine('tests/samples/hangul-utf8.s');
  const cp949 = await machine('tests/samples/hangul-cp949.s');
  assert.deepEqual(utf8.format, { encoding: 'UTF-8', byteOrderMark: false, lineEnd: 'LF' });
  assert.deepEqual(cp949.format, { encoding: 'CP949', byteOrderMark: false, lineEnd: 'CRLF' });
  const { format: _a, ...u } = utf8;
  const { format: _b, ...c } = cp949;
  assert.deepEqual(c, u);
  // The Hangul is Hangul: in a source line, in memory, and in what the program printed.
  assert.ok(utf8.text.some((t) => t.src.includes('# 출력')));
  assert.ok(Buffer.from(hexBytes(utf8.data)).includes(Buffer.from('안녕하세요, RISC-V!\n', 'utf8')));
  assert.equal(utf8.output, '안녕하세요, RISC-V!\n');
});
