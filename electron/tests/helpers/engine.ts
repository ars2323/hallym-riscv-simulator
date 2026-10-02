/* The real engine (RARS in a JVM) for the unit tests: one host per test
   file, started the way the app starts it (src/main/paths.ts engine()). */

import path from 'node:path';

import { engine } from '../../src/main/paths.ts';
import { Simulator, type HostOptions } from '../../src/sim/host.ts';
import { engineTransport } from '../../src/sim/transport.ts';

export const root = path.join(import.meta.dirname, '..', '..');

export async function startEngine(options: Partial<HostOptions> & { extraArgs?: string[] } = {}): Promise<Simulator> {
  const where = engine();
  return Simulator.start({ transport: () => engineTransport({ ...where, extraArgs: options.extraArgs }), ...options });
}

// Bytes from the engine's mem reply.
export const hexBytes = (hex: string): Uint8Array => Uint8Array.from({ length: hex.length / 2 }, (_, i) => parseInt(hex.slice(2 * i, 2 * i + 2), 16));
