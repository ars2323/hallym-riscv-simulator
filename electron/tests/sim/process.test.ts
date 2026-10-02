/* The engine in its own process (src/sim/), as the app uses it.

   1. An endless loop is stopped: the host answers meanwhile, and afterwards
      registers can be read and PC is in the loop.
   2. A breakpoint, set by line, stops the run; the run goes on to the end.
   3. The process dying is reported, what was pending fails with
      EngineCrashed, and a fresh process works -- the "restarting" state in
      between.  Without restarts (the negative control) it does not.
   4. Console output and "waiting for input" arrive as events.
   5. An engine that cannot start (no java), that dies again and again, or
      that speaks another protocol is "dead": calls fail at once, with why.
   6. stop() kills an engine that does not answer (a fake engine here).
   (The MIPS edition's process.test.ts, for the JVM engine.) */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { CRASH_MESSAGE, EngineCrashed, EngineDead, Simulator, type CrashReport, type EngineState } from '../../src/sim/host.ts';
import { PROTOCOL } from '../../src/sim/protocol.ts';
import { engineTransport, type ExitInfo, type Transport } from '../../src/sim/transport.ts';
import { startEngine } from '../helpers/engine.ts';

const LOOP = 'main:\nloop: j loop\n';
const BREAK = `main:
    li   t0, 1          # 2
    addi t0, t0, 1      # 3
    addi t0, t0, 40     # 4
    li   a7, 10
    ecall
`;

describe('one engine', () => {
  let sim: Simulator;
  before(async () => { sim = await startEngine(); });
  after(() => sim.close());

  test('the engine is ready and says which RARS', () => {
    assert.equal(sim.state, 'ready');
    assert.equal(sim.rars, '1.6');
  });

  test('1: an endless loop is stopped, and can be looked at', async () => {
    assert.ok((await sim.call('assemble', { source: LOOP })).ok);
    const running = sim.call('run', {});
    await new Promise((r) => setTimeout(r, 200));
    const status = await sim.call('status', {});   // answered while it runs
    assert.ok(status.ok && status.busy);
    assert.equal(await sim.stop(), 'stopped');
    const r = await running;
    assert.ok(r.ok && r.reason === 'STOP');
    assert.equal(r.pc >>> 0, 0x00400000);
    assert.equal(await sim.stop(), 'idle');
  });

  test('2: a breakpoint by line stops the run there; the run goes on to the end', async () => {
    assert.ok((await sim.call('bp', { lines: [4] })).ok);
    const a = await sim.call('assemble', { source: BREAK });
    assert.ok(a.ok);
    assert.deepEqual(a.breakpoints, [{ line: 4, addr: 0x00400008 }]);
    const r = await sim.call('run', {});
    assert.ok(r.ok && r.reason === 'BREAKPOINT' && r.pc === 0x00400008 && r.x[5] === 2);
    const end = await sim.call('run', {});
    assert.ok(end.ok && end.reason === 'NORMAL_TERMINATION' && end.x[5] === 42);
    await sim.call('bp', { lines: [] });
  });

  test('mem: a range ending at the top of the stack, and one past it', async () => {
    assert.ok((await sim.call('assemble', { source: LOOP })).ok);
    const top = await sim.call('mem', { addr: 0x7ffffff0, len: 12 });
    assert.ok(top.ok && top.hex.length === 24);
    // Ending at 0x80000000 once overflowed the engine's loop into an empty "ok" (fixed in RarsProbe.mem):
    // it must be an address error, never an empty answer.
    const past = await sim.call('mem', { addr: 0x7ffffff0, len: 16 });
    assert.ok(!past.ok && past.code === 'address', JSON.stringify(past));
  });

  test('4: console output and input come as events', async () => {
    const out: string[] = [];
    const inputs: number[] = [];
    const onOut = (t: string) => out.push(t);
    const onIn = (pc: number) => inputs.push(pc);
    sim.on('console', onOut);
    sim.on('input', onIn);
    try {
      assert.ok((await sim.call('assemble', { source: 'main:\n li a0, 7\n li a7, 1\n ecall\n li a7, 5\n ecall\n li a7, 1\n ecall\n li a7, 10\n ecall\n' })).ok);
      const run = sim.call('run', {});
      while (inputs.length === 0) await new Promise((r) => setTimeout(r, 10));
      assert.equal(out.join(''), '7');
      await sim.call('input', { text: '35\n' });
      const r = await run;
      assert.ok(r.ok && r.reason === 'NORMAL_TERMINATION');
      assert.equal(out.join(''), '735');
      assert.equal(inputs.length, 1);
    } finally {
      sim.off('console', onOut);
      sim.off('input', onIn);
    }
  });
});

// The pid of the JVM a host started: the newest java child of this process.
async function crashScenario(restartOnCrash: boolean): Promise<void> {
  const states: EngineState[] = [];
  const crashes: CrashReport[] = [];
  let kill: (() => void) | null = null;
  const sim = await startEngine({ restartOnCrash });
  // Reach the transport the host holds: wrap the factory the helper gave it.
  sim.on('state', (s) => states.push(s));
  sim.on('crashed', (c) => crashes.push(c));
  kill = () => sim.crashForTest();
  try {
    assert.ok((await sim.call('assemble', { source: LOOP })).ok);
    const running = sim.call('run', {});
    kill();
    await assert.rejects(running, (e: unknown) => e instanceof EngineCrashed);
    assert.equal(crashes.length, 1);
    assert.equal(crashes[0].message, CRASH_MESSAGE);
    assert.equal(crashes[0].restarted, true, 'a fresh engine is on its way');
    await sim.whenReady();
    assert.deepEqual(states, ['restarting', 'ready']);
    // The fresh engine is empty, and works.
    const step = await sim.call('step', {});
    assert.ok(!step.ok && step.code === 'not_runnable');
    assert.ok((await sim.call('assemble', { source: BREAK })).ok);
    const r = await sim.call('run', {});
    assert.ok(r.ok && r.x[5] === 42);
  } finally {
    sim.close();
  }
}

test('3: a crash is reported and a fresh engine works', async () => {
  await crashScenario(true);
});

test('3, negative control: without restarts the same scenario fails', async () => {
  await assert.rejects(crashScenario(false));
});

test('5: no java: dead at once, and calls say why', async () => {
  const states: EngineState[] = [];
  const sim = new Simulator({ transport: () => engineTransport({ java: '/no/such/java', classpath: '' }) });
  sim.on('state', (s) => states.push(s));
  sim.launch();
  await assert.rejects(sim.whenReady());
  assert.equal(sim.state, 'dead');
  assert.match(sim.deadReason, /시작할 수 없습니다/);
  await assert.rejects(sim.call('ping', {}), (e: unknown) => e instanceof EngineDead);
  assert.deepEqual(states, ['dead']);
  sim.close();
});

/* A stand-in engine: answers `ready` with the given protocol, then only
   what `answer` says (null: never answers). */
function fakeTransport(protocol: number, answer: (msg: Record<string, unknown>) => object | null): () => Transport {
  return () => {
    const listeners: ((m: never) => void)[] = [];
    const exits: ((i: ExitInfo) => void)[] = [];
    let alive = true;
    setTimeout(() => { for (const l of listeners) l({ ev: 'ready', protocol, rars: 'fake' } as never); }, 5);
    return {
      send: (m) => {
        const a = answer(m as Record<string, unknown>);
        if (a && alive) setTimeout(() => { for (const l of listeners) l({ id: (m as { id: number }).id, ...a } as never); }, 1);
      },
      onMessage: (l) => { listeners.push(l as never); },
      onExit: (l) => { exits.push(l); },
      kill: () => { if (!alive) return; alive = false; setTimeout(() => { for (const l of exits) l({ code: null, signal: 'SIGKILL', stderr: '' }); }, 1); },
    };
  };
}

test('5: an engine of another protocol is never talked to', async () => {
  const sim = new Simulator({ transport: fakeTransport(PROTOCOL - 1, () => ({ ok: true })) });
  sim.launch();
  await assert.rejects(sim.whenReady());
  assert.equal(sim.state, 'dead');
  assert.match(sim.deadReason, /프로토콜/);
  sim.close();
});

test('5: dying again and again: dead after maxCrashes', async () => {
  const sim = new Simulator({ transport: fakeTransport(PROTOCOL, () => ({ ok: true })), maxCrashes: 2 });
  sim.launch();
  await sim.whenReady();
  for (let i = 0; i < 3; i += 1) {
    sim.crashForTest();
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.equal(sim.state, 'dead');
  assert.match(sim.deadReason, /3번 멈춰/);
  sim.close();
});

test('6: stop() kills an engine that does not answer, and a fresh one starts', async () => {
  // Answers everything but stop and run.
  const sim = new Simulator({
    transport: fakeTransport(PROTOCOL, (m) => (m.cmd === 'stop' || m.cmd === 'run' ? null : { ok: true })),
    stopTimeoutMs: 200,
  });
  sim.launch();
  await sim.whenReady();
  const run = sim.call('run', {});
  run.catch(() => {});
  assert.equal(await sim.stop(), 'killed');
  await assert.rejects(run, (e: unknown) => e instanceof EngineCrashed && /killed by stop/.test(e.message));
  await sim.whenReady();
  assert.equal(sim.state, 'ready');
  sim.close();
});
