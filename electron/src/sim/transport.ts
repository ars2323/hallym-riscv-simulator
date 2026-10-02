/* The one thing that knows how the engine process is started and talked to.
   The host (host.ts) sees only this interface.

   In the MIPS edition the simulator was a Node worker loading an N-API
   addon (child_process.fork for the tests, Electron's utilityProcess for the
   app).  Here the simulator is a JVM running the engine (RarsProbe, around
   RARS), started the same way in both: a child process whose stdin and
   stdout carry one JSON object per line (docs/engine-protocol.md 1).

   Where the engine is: ENGINE_JAVA (the java executable; default `java` on
   PATH, later the bundled jlink runtime) and the class path of the engine's
   classes and the RARS jar (src/main/paths.ts engine()). */

import { spawn } from 'node:child_process';

import type { EngineMessage } from './protocol.ts';

export interface ExitInfo {
  code: number | null;
  signal: string | null;
  stderr: string;           // the process's last words
  spawnError?: string;      // it never started (no java, a bad path)
}

export interface Transport {
  send(line: object): void;
  onMessage(listener: (message: EngineMessage) => void): void;
  onExit(listener: (info: ExitInfo) => void): void;
  kill(): void; // forcibly; the host uses it only as a last resort
}

export type TransportFactory = () => Transport;

export interface EngineCommand {
  java: string;
  classpath: string;
  prefsDir?: string;   // where RARS's java.util.prefs settings go (never the user's home)
  extraArgs?: string[];
}

const STDERR_KEPT = 8192;

// JVM unified logging writes to stdout by default, which is the protocol
// channel (docs/engine-protocol.md 1): warnings go to stderr instead.
export function engineArgs(cmd: EngineCommand): string[] {
  return ['-Xlog:disable', '-Xlog:all=warning:stderr', '-Djava.awt.headless=true',
    ...(cmd.prefsDir ? [`-Djava.util.prefs.userRoot=${cmd.prefsDir}`] : []),
    ...(cmd.extraArgs ?? []), '-cp', cmd.classpath, 'RarsProbe'];
}

export function engineTransport(cmd: EngineCommand, env: NodeJS.ProcessEnv = process.env): Transport {
  const child = spawn(cmd.java, engineArgs(cmd), { stdio: ['pipe', 'pipe', 'pipe'], env, windowsHide: true });
  const listeners: ((m: EngineMessage) => void)[] = [];
  const exitListeners: ((info: ExitInfo) => void)[] = [];
  let stderr = '';
  let spawnError: string | undefined;
  let alive = true;

  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr = (stderr + chunk).slice(-STDERR_KEPT);
    process.stderr.write(chunk);
  });
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    buffer += chunk;
    for (let nl = buffer.indexOf('\n'); nl >= 0; nl = buffer.indexOf('\n')) {
      const line = buffer.slice(0, nl).replace(/\r$/, '');
      buffer = buffer.slice(nl + 1);
      if (line === '') continue;
      let m: EngineMessage;
      try {
        m = JSON.parse(line) as EngineMessage;
      } catch {
        // Something other than the engine wrote to its fd 1. Loudly (8.6).
        process.stderr.write(`engine: non-JSON on stdout: ${JSON.stringify(line)}\n`);
        m = { ev: 'nonjson', text: line };
      }
      for (const l of listeners) l(m);
    }
  });
  child.on('error', (e) => { spawnError = e.message; });
  // 'close' comes after stdout and stderr have been read to their end.
  child.on('close', (code, signal) => {
    alive = false;
    for (const l of exitListeners) l({ code, signal, stderr, spawnError });
  });
  child.stdin.on('error', () => { /* the engine died: 'close' says so */ });
  return {
    send: (line) => { if (alive && child.stdin.writable) child.stdin.write(JSON.stringify(line) + '\n'); },
    onMessage: (l) => { listeners.push(l); },
    onExit: (l) => { exitListeners.push(l); },
    kill: () => { child.kill('SIGKILL'); },
  };
}
