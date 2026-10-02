/* The window's title before the window script runs: the page's <title>
   (index.html) is what Windows shows in the taskbar until app.ts sets
   document.title -- the MIPS edition's "Hallym MIPS" stood there until
   87a9531, seen by the Windows CI in the first second of a start.  It
   must be the app's name, as main.ts gives the window and app.ts gives
   the page (tests/e2e/window.e2e.ts reads the title after). */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = path.join(import.meta.dirname, '..', '..');
const read = (f: string) => readFileSync(path.join(root, f), 'utf8');

test("the page's <title>, the window's and the app's name are one: Hallym RISC-V", () => {
  const page = /<title>([^<]*)<\/title>/.exec(read('src/renderer/app/index.html'))?.[1];
  const app = /const APP_NAME = '([^']*)'/.exec(read('src/renderer/app/app.ts'))?.[1];
  const win = /^\s*title: '([^']*)',/m.exec(read('src/main/main.ts'))?.[1];
  assert.equal(page, 'Hallym RISC-V');
  assert.equal(app, page);
  assert.equal(win, page);
});
