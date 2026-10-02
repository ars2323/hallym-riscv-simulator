/* The engine needs no Java module the installed runtime lacks.

     node tools/check-java-modules.ts

   The installer's runtime is a jlink image of JAVA_MODULES
   (tools/java-modules.ts); the JDK a developer and the Linux CI run has
   every module.  A class from another module (6d91957 used
   java.util.logging, which is java.logging) passes every check with the JDK
   and dies at the first start of the installed app:
   NoClassDefFoundError.  jdeps lists the modules the engine's classes
   (probe/build/classes) and the RARS jar use; each must be one of
   JAVA_MODULES.  Negative control: a class that uses java.util.logging,
   compiled here, must be caught. */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { JAVA_MODULES } from './java-modules.ts';

const root = path.join(import.meta.dirname, '..');
const rarsHome = process.env.RARS_HOME ?? path.join(os.homedir(), '.cache', 'hallym-riscv', 'rars');
const jar = process.env.RARS_JAR ?? path.join(rarsHome, 'rars-src.jar');
const classes = path.join(root, '..', 'probe', 'build', 'classes');
const bin = (t: string) => (process.env.JAVA_HOME ? path.join(process.env.JAVA_HOME, 'bin', t) : t);

// The modules jdeps says `paths` need (stderr shown, never hidden).
function needs(...paths: string[]): string[] {
  const out = execFileSync(bin('jdeps'), ['--multi-release', '21', '--ignore-missing-deps', '--print-module-deps', '-cp', jar, ...paths],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return out.trim().split('\n').pop()!.split(',').map((m) => m.trim()).filter(Boolean);
}
const outside = (mods: string[]) => mods.filter((m) => !JAVA_MODULES.includes(m));

let failed = 0;
const engine = needs(classes, jar);
const extra = outside(engine);
console.log(`${extra.length ? 'FAIL' : 'PASS'}  the engine and RARS need ${engine.join(', ')}; the runtime has ${JAVA_MODULES.join(', ')}${extra.length ? `; missing: ${extra.join(', ')}` : ''}`);
if (extra.length) failed++;

// The control: a class using java.util.logging.
const dir = mkdtempSync(path.join(os.tmpdir(), 'java-modules-'));
try {
  writeFileSync(path.join(dir, 'UsesLogging.java'), 'public class UsesLogging { static final java.util.logging.Logger L = java.util.logging.Logger.getLogger("x"); }\n');
  execFileSync(bin('javac'), ['--release', '11', '-d', path.join(dir, 'out'), path.join(dir, 'UsesLogging.java')], { stdio: 'inherit' });
  const c = outside(needs(path.join(dir, 'out')));
  console.log(`${c.includes('java.logging') ? 'PASS' : 'FAIL'}    control: a class that uses java.util.logging is caught (outside: ${c.join(', ') || 'nothing'})`);
  if (!c.includes('java.logging')) failed++;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
