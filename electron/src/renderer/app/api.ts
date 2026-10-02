/* window.app, as src/main/preload.cjs exposes it. */

import type { OpenedFile, Settings } from '../../main/main.ts';
import type { EngineState } from '../../sim/host.ts';
import type { TextFileFormat } from '../../node/text-file.ts';
import type { CallName, Calls } from '../../sim/protocol.ts';

export interface AppApi {
  // One engine command; resolves with its reply (ok or not, docs/engine-protocol.md).
  // Rejects when the engine crashed (EngineCrashed) or cannot run (EngineDead).
  call<M extends CallName>(cmd: M, params?: Calls[M][0]): Promise<Calls[M][1]>;
  stop(): Promise<'stopped' | 'idle' | 'killed'>;
  // Assembles in a second engine, the machine on screen untouched: does it assemble?
  // null: that engine is not there (the window assembles on the machine itself).
  check(source: string): Promise<Calls['assemble'][1] | null>;
  engineState(): Promise<{ state: EngineState; detail: string; rars: string }>;
  onConsole(listener: (text: string) => void): void;
  onInput(listener: (pc: number) => void): void;
  onCrashed(listener: (message: string, cause: string, restarted: boolean) => void): void;
  onEngineState(listener: (state: EngineState, detail: string) => void): void;
  openFile(): Promise<OpenedFile | null>;
  saveFile(file: { path: string | null; name: string; text: string; format: TextFileFormat | null }):
    Promise<{ path: string; name: string } | null>;
  about(): Promise<AboutInfo>;
  license(index: number): Promise<string>;  // LICENSES[index]; one past the end: Electron's
  openCredits(): Promise<void>;             // LICENSES.chromium.html, in the browser
  getSettings(): Promise<Settings>;
  setSettings(s: Settings): Promise<Settings>;
  setOverlay(patch: { color: string; symbolColor: string }): Promise<void>;  // the caption buttons' patch and symbols (logic/overlay.ts)
}

export interface AboutInfo {
  version: string; rars: string; electron: string; chrome: string; node: string;
  licenses: string[]; // titles, in order
}

declare global { interface Window { app: AppApi } }
