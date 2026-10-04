/* Windows: the app leaves nothing in the registry.  Lab PCs are shared, one
   account for everyone, and every start is to begin from the same defaults;
   RARS keeps its settings through java.util.prefs, whose Windows backend is
   the registry (HKCU\Software\JavaSoft\Prefs\rars, written at every start),
   so one student's RARS settings were the next one's.  The engine is given
   its own factory (probe/src/HallymPrefs.java: the engine's folder in the
   run's folder, removed with it).

   Every key and value under HKCU\Software\JavaSoft\Prefs is listed before
   and after the app has started, assembled and run a program and closed:
   nothing new.  Control: the JDK's own factory back
   (ENGINE_JAVA_ARGS, after the app's own -D, so it wins) with RARS's key
   removed first -- the key is there again afterwards.  It is removed after. */

import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';

import { goneWithin, javaPids } from '../helpers/processes.ts';
import { launch, openAndAssemble, program, settled } from './harness.ts';

const PREFS = 'HKCU:\\Software\\JavaSoft\\Prefs';
const ps = (script: string): string => execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });

// Every key under Prefs, and every value in each, one line apiece.
function registry(): string[] {
  const out = ps(`if (Test-Path '${PREFS}') { Get-ChildItem '${PREFS}' -Recurse | ForEach-Object { $k = $_; "key $($k.Name)"; foreach ($v in $k.GetValueNames()) { "value $($k.Name) $v=$($k.GetValue($v))" } }; $r = Get-Item '${PREFS}'; foreach ($v in $r.GetValueNames()) { "value $($r.Name) $v=$($r.GetValue($v))" } }`);
  return out.split(/\r?\n/).filter(Boolean);
}

async function aRun(env: Record<string, string>): Promise<void> {
  const r = await launch(undefined, { env });
  await expect.poll(() => javaPids('-Dhallym.engine=', r.dir).length, { timeout: 30_000, message: 'both engines started' }).toBe(2);
  const pids = javaPids('-Dhallym.engine=', r.dir);
  await openAndAssemble(r, program(r.dir, 'p.s', '  .data\nm: .asciz "hi"\n  .text\nmain:\n  la a0, m\n  li a7, 4\n  ecall\n  li a7, 10\n  ecall\n'));
  await r.page.keyboard.press('F5');
  await settled(r.page);
  await r.close();
  expect(await goneWithin(pids, 10_000, () => {}), 'the engines ended').not.toBeNull();
}

test('Windows: nothing of RARS is left in the registry after a run', async () => {
  test.skip(process.platform !== 'win32', 'the registry is Windows\'');
  const before = new Set(registry());
  await aRun({});
  const added = registry().filter((l) => !before.has(l));
  console.log(`registry entries under ${PREFS} before: ${before.size}; new after a run: ${added.length}`);
  expect(added, 'new under HKCU\\Software\\JavaSoft\\Prefs').toEqual([]);
});

// RARS's key removed, if it is there.  (Remove-Item on a key that is not there
// ends PowerShell with 1 even with -ErrorAction SilentlyContinue: CI, fdc3609.)
const removeRars = (): void => { ps(`if (Test-Path '${PREFS}\\rars') { Remove-Item '${PREFS}\\rars' -Recurse }`); };

test('Windows, negative control: the JDK\'s own factory writes RARS\'s settings to the registry', async () => {
  test.skip(process.platform !== 'win32', 'the registry is Windows\'');
  removeRars();
  const before = new Set(registry());
  try {
    await aRun({ ENGINE_JAVA_ARGS: '-Djava.util.prefs.PreferencesFactory=java.util.prefs.WindowsPreferencesFactory' });
    const added = registry().filter((l) => !before.has(l));
    console.log(`new under ${PREFS} with the JDK's factory: ${added.length}: ${added.slice(0, 6).join(' | ')}`);
    expect(added.some((l) => /\\Prefs\\rars\b/i.test(l)), 'RARS\'s key written').toBe(true);
  } finally {
    removeRars();
  }
});
