/* Every picture the documents show: WebP, 400 KB or less (tools/pictures.ts).
   Control: a picture over the limit and one that is not WebP are both found. */

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { MAX_PICTURE_BYTES, pictureFaults } from '../../tools/pictures.ts';

const root = path.join(import.meta.dirname, '..', '..');
const DIRS = [path.join(root, 'docs/screens'), path.join(root, '..', 'docs/usage/images')];

test('the documents\' pictures: WebP, 400 KB or less', () => {
  assert.deepEqual(pictureFaults(DIRS), []);
});

test('negative control: a picture over the limit, and a PNG, are found', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'pictures-'));
  try {
    writeFileSync(path.join(dir, 'big.webp'), Buffer.alloc(MAX_PICTURE_BYTES + 1));
    writeFileSync(path.join(dir, 'small.png'), Buffer.alloc(10));
    writeFileSync(path.join(dir, 'fine.webp'), Buffer.alloc(10));
    const faults = pictureFaults([dir]);
    assert.equal(faults.length, 2, faults.join('\n'));
    assert.ok(faults.some((f) => f.includes('big.webp') && f.includes('over')));
    assert.ok(faults.some((f) => f.includes('small.png') && f.includes('not WebP')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
