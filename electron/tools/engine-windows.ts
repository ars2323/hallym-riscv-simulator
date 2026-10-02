/* The engine process (a JVM) where the MIPS edition had none: measured, on
   whatever this runs on -- the Windows CI job is what it is for.  Each check
   has a negative control that must fail, or the check means nothing.

     node tools/engine-windows.ts [--java <java.exe>] [--out <dir>]

   --java: the java to run (default: the one the app would use, src/main/
   paths.ts engine(); the Windows job passes the installed app's jlink
   runtime too).  Writes <out>/engine-windows.json (default report/).

   1. Cold start: 10 fresh engines, ms from spawn to `ready`, and to the
      answer of the first assemble.
   2. Korean through stdio: a program prints a UTF-8 .string, reads a line of
      Korean, prints it back.  Control: -Dfile.encoding=COMPAT (the PC's code
      page: windows-1252 on the runner, MS949 on a Korean PC) must garble it.
   3. Kill: a busy engine (an endless loop) killed the way the host kills it
      (transport.kill(): SIGKILL, which on Windows -- no signals -- is
      TerminateProcess): the exit is reported and the process is gone.
      Control: a "kill" that relies on the engine's cooperation (closing its
      stdin, a polite end) against an engine that does not cooperate
      (-Dprobe.ignoreEof=true) must leave it alive.
   4. Orphan: a parent process that started an engine dies at once
      (TerminateProcess / SIGKILL, no goodbye): the engine leaves by itself
      (it reads the end of its stdin).  Control: -Dprobe.ignoreEof=true must
      stay (and is then killed here).

   The console window (does a black box flash up when the window starts an
   engine?) needs the app's window: tests/e2e/windows.e2e.ts. */

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { engine } from '../src/main/paths.ts';
import type { EngineMessage } from '../src/sim/protocol.ts';
import { engineArgs, engineTransport, type EngineCommand, type Transport } from '../src/sim/transport.ts';
import { alive, goneWithin, killHard } from '../tests/helpers/processes.ts';

const { values: opt } = parseArgs({ options: { java: { type: 'string' }, out: { type: 'string', default: 'report' } } });
const base: EngineCommand = { ...engine(), ...(opt.java ? { java: opt.java } : {}) };
const T0 = Date.now();
const say = (s: string) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)} s] ${s}`);
const results: Record<string, unknown> = { platform: `${process.platform} ${process.arch}`, java: base.java };
let failed = 0;
const verdict = (name: string, ok: boolean, detail: string) => {
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}: ${detail}`);
  if (!ok) failed += 1;
};

interface Engine {
  t: Transport;
  events: EngineMessage[];
  // The first event from index `from` on that `pred` takes; waits at most capMs.
  next(pred: (m: EngineMessage) => boolean, capMs: number, what: string, from?: number): Promise<EngineMessage>;
}
function start(extraArgs: string[] = []): Engine {
  const t = engineTransport({ ...base, extraArgs: [...(base.extraArgs ?? []), ...extraArgs] });
  const events: EngineMessage[] = [];
  const waiters: (() => void)[] = [];
  t.onMessage((m) => { events.push(m); for (const w of waiters.splice(0)) w(); });
  t.onExit((i) => { events.push({ ev: 'exit', ...i } as never); for (const w of waiters.splice(0)) w(); });
  const next = async (pred: (m: EngineMessage) => boolean, capMs: number, what: string, from = 0) => {
    const t0 = Date.now();
    for (;;) {
      const m = events.slice(from).find(pred);
      if (m) return m;
      if (Date.now() - t0 > capMs) throw new Error(`no ${what} within ${capMs} ms; got ${JSON.stringify(events.slice(-5))}`);
      await new Promise<void>((r) => { waiters.push(r); setTimeout(r, 200); });
    }
  };
  return { t, next, events };
}
let ids = 0;
async function call(e: Engine, cmd: string, args: object = {}, capMs = 30_000): Promise<Record<string, unknown>> {
  const id = ++ids;
  e.t.send({ id, cmd, ...args });
  return (await e.next((m) => (m as { id?: number }).id === id, capMs, `answer to ${cmd}`)) as Record<string, unknown>;
}
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

// ---- 1. cold start
{
  const ready: number[] = [];
  const assembled: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    const t0 = performance.now();
    const e = start();
    await e.next((m) => (m as { ev?: string }).ev === 'ready', 30_000, 'ready');
    ready.push(performance.now() - t0);
    const a = await call(e, 'assemble', { source: 'main:\n li a0, 1\n li a7, 10\n ecall\n' });
    if (!a.ok) throw new Error(`assemble failed: ${JSON.stringify(a)}`);
    assembled.push(performance.now() - t0);
    e.t.kill();
    say(`  start ${i + 1}: ready ${ready[i].toFixed(0)} ms, first assemble answered ${assembled[i].toFixed(0)} ms`);
  }
  results.coldStart = { readyMs: ready.map(Math.round), assembledMs: assembled.map(Math.round), readyMedianMs: Math.round(median(ready)), assembledMedianMs: Math.round(median(assembled)) };
  say(`cold start: ready median ${Math.round(median(ready))} ms (first ${Math.round(ready[0])} ms), first assemble median ${Math.round(median(assembled))} ms`);
}

// ---- 2. Korean through stdio
const KOREAN = `.data
msg: .string "한글 출력, "
buf: .space 64
.text
main:
    la   a0, msg
    li   a7, 4
    ecall
    la   a0, buf
    li   a1, 64
    li   a7, 8
    ecall
    la   a0, buf
    li   a7, 4
    ecall
    li   a7, 10
    ecall
`;
async function korean(extraArgs: string[]): Promise<string> {
  const e = start(extraArgs);
  try {
    await e.next((m) => (m as { ev?: string }).ev === 'ready', 30_000, 'ready');
    const a = await call(e, 'assemble', { source: KOREAN });
    if (!a.ok) throw new Error(`assemble: ${JSON.stringify(a)}`);
    const run = call(e, 'run', {});
    await e.next((m) => (m as { ev?: string }).ev === 'input_wanted', 30_000, 'input_wanted');
    await call(e, 'input', { text: '입력 값 — 가나다\n' });
    const r = await run;
    if (r.reason !== 'NORMAL_TERMINATION') throw new Error(`run: ${JSON.stringify(r)}`);
    return e.events.filter((m) => (m as { ev?: string }).ev === 'out').map((m) => (m as { text: string }).text).join('');
  } finally { e.t.kill(); }
}
{
  const want = '한글 출력, 입력 값 — 가나다\n';
  const got = await korean([]);
  verdict('Korean console output and input', got === want, JSON.stringify(got));
  const control = await korean(['-Dfile.encoding=COMPAT']);
  if (process.platform === 'win32' || control !== want) {
    verdict('  control: file.encoding=COMPAT (the code page) garbles it', control !== want, JSON.stringify(control));
  } else {
    say(`  (control not counted: file.encoding=COMPAT is this ${process.platform} locale's UTF-8, so it cannot fail here; it is Windows' check)`);
  }
  results.korean = { want, got, control };
}

// ---- 3. kill
async function busy(extraArgs: string[] = []): Promise<Engine> {
  const e = start(extraArgs);
  await e.next((m) => (m as { ev?: string }).ev === 'ready', 30_000, 'ready');
  const a = await call(e, 'assemble', { source: 'main:\nloop: j loop\n' });
  if (!a.ok) throw new Error(`assemble: ${JSON.stringify(a)}`);
  e.t.send({ id: ++ids, cmd: 'run' });
  await new Promise((r) => setTimeout(r, 300));
  return e;
}
{
  const e = await busy();
  const pid = e.t.pid!;
  const t0 = performance.now();
  e.t.kill();
  const exit = await e.next((m) => (m as { ev?: string }).ev === 'exit', 10_000, 'exit') as unknown as { code: number | null; signal: string | null };
  const reported = performance.now() - t0;
  const gone = await goneWithin([pid], 5000, say);
  verdict('kill a busy engine', gone !== null, `exit reported after ${reported.toFixed(0)} ms as code=${exit.code} signal=${exit.signal}; process gone after ${gone} ms`);
  results.kill = { exitCode: exit.code, signal: exit.signal, reportedMs: Math.round(reported), goneMs: gone };

  // The control: an engine that ignores the end of stdin, "killed" by closing its stdin.
  const child = spawn(base.java, engineArgs({ ...base, extraArgs: [...(base.extraArgs ?? []), '-Dprobe.ignoreEof=true'] }),
    { stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
  child.stdout.resume();
  await new Promise((r) => setTimeout(r, 1500));
  child.stdin.end();
  const cgone = await goneWithin([child.pid!], 2000, say);
  verdict('  control: a polite end (stdin closed) leaves an engine that ignores it alive', cgone === null, cgone === null ? 'still alive after 2 s' : `gone after ${cgone} ms`);
  child.kill('SIGKILL');
  await goneWithin([child.pid!], 5000, say);
}

// ---- 4. orphan: the parent dies, the engine must go by itself
async function orphan(extraArgs: string[]): Promise<{ enginePid: number; goneMs: number | null }> {
  // A parent like the app's main process: starts an engine through the same
  // transport, runs an endless loop on it, prints the engine's pid, waits.
  const child = `
    import { engineTransport } from ${JSON.stringify(pathToFileURL(path.join(import.meta.dirname, '../src/sim/transport.ts')).href)};
    const t = engineTransport(${JSON.stringify({ ...base, extraArgs: [...(base.extraArgs ?? []), ...extraArgs] })});
    t.onMessage((m) => {
      if (m.ev === 'ready') t.send({ id: 1, cmd: 'assemble', source: 'main:\\nloop: j loop\\n' });
      if (m.id === 1) { t.send({ id: 2, cmd: 'run' }); setTimeout(() => console.log('ENGINE ' + t.pid), 300); }
    });
    setInterval(() => {}, 1000);`;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', child], { stdio: ['ignore', 'pipe', 'inherit'] });
  const enginePid = await new Promise<number>((resolve, reject) => {
    let out = '';
    const cap = setTimeout(() => reject(new Error(`the parent did not report its engine within 30 s: ${out}`)), 30_000);
    parent.stdout.setEncoding('utf8');
    parent.stdout.on('data', (d: string) => {
      out += d;
      const m = /ENGINE (\d+)/.exec(out);
      if (m) { clearTimeout(cap); resolve(Number(m[1])); }
    });
  });
  if (!alive(enginePid)) throw new Error(`engine ${enginePid} is not running before the parent dies`);
  say(`  parent ${parent.pid} started engine ${enginePid}; killing the parent alone`);
  killHard(parent.pid!);
  const goneMs = await goneWithin([enginePid], 5000, say);
  return { enginePid, goneMs };
}
{
  const o = await orphan([]);
  verdict('the parent dies: the engine goes too', o.goneMs !== null, `engine gone ${o.goneMs} ms after its parent was killed`);
  const c = await orphan(['-Dprobe.ignoreEof=true']);
  verdict('  control: an engine that ignores the end of stdin stays', c.goneMs === null, c.goneMs === null ? 'still running after 5 s (an orphan; killed now)' : `gone after ${c.goneMs} ms`);
  if (alive(c.enginePid)) killHard(c.enginePid);
  results.orphan = { goneMs: o.goneMs, controlStayed: c.goneMs === null };
}

results.args = engineArgs(base);
mkdirSync(opt.out!, { recursive: true });
writeFileSync(path.join(opt.out!, 'engine-windows.json'), JSON.stringify(results, null, 1));
say(failed ? `${failed} FAILED` : 'all checks passed, every control failed');
process.exit(failed ? 1 : 0);
