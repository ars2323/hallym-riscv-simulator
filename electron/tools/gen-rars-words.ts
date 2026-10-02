/* Writes tests/core/rars-words.json: the words RARS assembles from
   tests/core/rars-words.s, each with what RARS prints for it (`basic`) --
   the oracle tests/core/decoder.test.ts checks the decoder against.  Needs
   the engine (probe/run.sh build) and RARS_JAR, as the app does.

     node tools/gen-rars-words.ts */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { engine } from '../src/main/paths.ts';
import { Simulator } from '../src/sim/host.ts';
import { engineTransport } from '../src/sim/transport.ts';

const root = path.join(import.meta.dirname, '..');
const sim = await Simulator.start({ transport: () => engineTransport(engine()) });
if (sim.state !== 'ready') throw new Error(`engine not ready: ${sim.deadReason}`);
const a = await sim.call('assemble', { source: readFileSync(path.join(root, 'tests/core/rars-words.s'), 'utf8') });
sim.close();
if (!a.ok) throw new Error(`rars-words.s did not assemble: ${JSON.stringify(a)}`);
const words = a.text.map((t) => ({ code: t.code, basic: t.basic, line: t.line }));
writeFileSync(path.join(root, 'tests/core/rars-words.json'),
  JSON.stringify({ rars: sim.rars, source: 'tests/core/rars-words.s', words }, null, 0).replace(/\},\{/g, '},\n{') + '\n');
console.log(`${words.length} words from RARS ${sim.rars}`);
