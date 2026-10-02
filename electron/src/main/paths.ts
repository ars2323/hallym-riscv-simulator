/* Where the app's own files are.  Run from the source tree (npm run
   electron, the e2e tests) they are where the repository keeps them.  The
   packaged layout (MIPS edition: tools/package.ts, SPIM_BUNDLE) is not
   built for the RISC-V edition yet; the bundled branches are kept so the
   shape stays the MIPS app's.

   The engine (docs/engine-protocol.md) is a JVM: `java` (ENGINE_JAVA, else
   the one on PATH -- later the bundled jlink runtime), the engine's classes
   (probe/build/classes, built by probe/run.sh build or the SessionStart
   hook) and the RARS jar (RARS_JAR, else where probe/setup.sh puts it). */

import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const bundled = process.env.SPIM_BUNDLE === '1';
const here = import.meta.dirname;
const root = path.join(here, '..', '..');
const electronDist = () => path.dirname(process.execPath); // the Electron binary's folder, in both cases

export const paths = {
  page: bundled ? path.join(here, 'renderer/app/index.html') : path.join(root, 'src/renderer/app/index.html'),
  preload: path.join(here, 'preload.cjs'),
  examples: bundled ? path.join(here, 'examples') : path.join(root, 'src/examples'),
  // A license file by its name in licenses/ (the packaged name; see LICENSES).
  license: (name: string) => (bundled ? path.join(here, 'licenses', name) : path.join(root, LICENSE_SOURCES[name])),
  electronLicense: () => path.join(electronDist(), bundled ? 'LICENSE.electron.txt' : 'LICENSE'),
  chromiumCredits: () => path.join(electronDist(), 'LICENSES.chromium.html'),
};

const repo = path.join(root, '..');
export function engine(): { java: string; classpath: string } {
  const rarsHome = process.env.RARS_HOME ?? path.join(process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache'), 'hallym-riscv', 'rars');
  const jar = process.env.RARS_JAR ?? path.join(rarsHome, 'rars1_6.jar');
  const classes = process.env.ENGINE_CLASSES ?? path.join(repo, 'probe', 'build', 'classes');
  return { java: process.env.ENGINE_JAVA ?? 'java', classpath: [classes, jar].join(path.delimiter) };
}

export const version: string = bundled
  ? (process.env.SPIM_VERSION as string)
  : JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;

/* The notices About shows, in order: title, and the file in the source tree.
   tools/package.ts copies each into licenses/ under the same key, and puts
   LICENSE and NOTICE next to the executable as well (BSD: the notice goes
   with the binary). */
export const LICENSES: { name: string; title: string }[] = [
  { name: 'NOTICE', title: 'NOTICE — RARS, JSoftFloat' },
  { name: 'OFL-Pretendard.txt', title: 'Pretendard — SIL Open Font License 1.1' },
  { name: 'OFL-D2Coding.txt', title: 'D2Coding — SIL Open Font License 1.1' },
  { name: 'lucide-LICENSE.txt', title: 'Lucide icons — ISC License' },
  { name: 'third-party.txt', title: 'Bundled libraries (CodeMirror, iconv-lite …)' },
];

// (NOTICE is the repository's, at its root.)
export const LICENSE_SOURCES: Record<string, string> = {
  'NOTICE': '../NOTICE',
  'OFL-Pretendard.txt': 'src/renderer/assets/fonts/OFL-Pretendard.txt',
  'OFL-D2Coding.txt': 'src/renderer/assets/fonts/OFL-D2Coding.txt',
  'lucide-LICENSE.txt': 'src/renderer/assets/icons/lucide/LICENSE.txt',
  'third-party.txt': 'build/licenses/third-party.txt', // tools/build-ui.ts writes it
};
