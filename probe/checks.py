"""Section-3 questions, each answered by running the probe.

Every check has a negative control: the same assertion applied to a situation
that must fail. If a control passes, the check is not measuring anything and
the script exits non-zero.
"""
import json
import os
import subprocess
import sys
import tempfile
import time

from client import Probe, case, classpath, HERE

TEXT_BASE = 0x00400000
DATA_BASE = 0x10010000
results = []


def record(name, verdict, evidence):
    results.append({"check": name, "verdict": verdict, "evidence": evidence})
    print(f"[{verdict:>5}] {name}: {evidence}", flush=True)


def must_fail(name, fn):
    """Negative control: fn() must raise AssertionError."""
    try:
        fn()
    except AssertionError:
        return
    print(f"[ BAD ] negative control did not fail: {name}", flush=True)
    sys.exit(f"negative control '{name}' passed, so its check is meaningless")


def u32(x):
    return x & 0xffffffff


# ---------------------------------------------------------------- start-up

def check_headless_and_classes():
    """Which java.desktop classes are loaded at start-up, assemble, and run."""
    def loaded(commands):
        with tempfile.NamedTemporaryFile("r", suffix=".log", delete=False) as f:
            log = f.name
        p = Probe(jvm_args=["-Djava.awt.headless=true", f"-Xlog:class+load=info:file={log}"])
        for cmd, kw in commands:
            r = p.call(cmd, **kw)
            assert r["ok"], r
        p.close()
        with open(log) as f:
            lines = [l for l in f if "source: jrt:/java.desktop" in l]
        os.unlink(log)
        return sorted({l.split()[1] for l in lines})

    boot = loaded([("ping", {})])
    asm = loaded([("assemble", {"source": case("hello.s")})])
    run = loaded([("assemble", {"source": case("hello.s")}), ("run", {})])
    record("java.desktop classes loaded: start-up only", "info", f"{len(boot)}: {', '.join(boot)}")
    record("java.desktop classes added by assemble", "info", f"{len(set(asm) - set(boot))}: {sorted(set(asm) - set(boot))}")
    record("java.desktop classes added by run", "info", f"{len(set(run) - set(asm))}: {sorted(set(run) - set(asm))}")
    def no_windows(classes):
        gui = [c for c in classes if c.startswith(("javax.swing.J", "java.awt.Frame", "java.awt.Window", "sun.awt.X11"))]
        assert not gui, gui
    no_windows(run)
    record("no window/peer classes (JFrame, Window, X11) loaded", "works", "none in start-up+assemble+run")
    must_fail("window filter catches JFrame", lambda: no_windows(run + ["javax.swing.JFrame"]))
    return boot


def check_without_java_desktop(jlink_dir):
    """Run the probe on a runtime that has java.base + java.prefs only."""
    java = os.path.join(jlink_dir, "bin", "java")
    p = subprocess.run([java, "-Djava.awt.headless=true", "-cp", classpath(), "RarsProbe"],
                       input='{"id":1,"cmd":"quit"}\n', capture_output=True, text=True, timeout=30)
    first_err = next((json.loads(l)["text"] for l in p.stdout.splitlines() if '"err"' in l and "NoClassDefFound" in l), None)
    ready = '"ready"' in p.stdout
    record("runs without java.desktop", "no" if not ready else "works",
           first_err or "started fine")
    return ready


# ---------------------------------------------------------------- stepping

def check_step(p):
    r = p.call("assemble", source=case("hello.s"))
    assert r["ok"], r
    s = p.call("step")
    assert s["reason"] == "MAX_STEPS" and s["steps"] == 1, s
    assert s["executed"]["addr"] == TEXT_BASE and s["pc"] == TEXT_BASE + 4, s
    assert s["executed"]["basic"].startswith("auipc"), s
    assert len(s["x"]) == 32 and len(s["f"]) == 32, s
    assert s["executed"]["code"] == r["text"][0]["code"], (s, r["text"][0])
    record("step exactly one instruction", "works",
           f"pc {TEXT_BASE:#x}->{s['pc']:#x}, executed {s['executed']['basic']!r} code={u32(s['executed']['code']):#010x} line {s['executed']['line']}")
    # negative control: a run is not a single step
    def ctl():
        p.call("assemble", source=case("hello.s"))
        r2 = p.call("run")
        assert r2["steps"] == 1, r2
    must_fail("run is not one step", ctl)
    p.output()


def check_breakpoints(p):
    asm = p.call("assemble", source=case("hello.s"))
    bp = asm["text"][4]["addr"]          # li a0, 42
    assert p.call("bp", set=[bp])["ok"]
    r = p.call("run")
    assert r["reason"] == "BREAKPOINT" and r["pc"] == bp, r
    p.call("bp", set=[])
    r2 = p.call("run")
    assert r2["reason"] == "NORMAL_TERMINATION", r2
    record("breakpoint set/clear without GUI", "works",
           f"run stopped at {bp:#x} (BREAKPOINT), cleared, then ran to NORMAL_TERMINATION")

    def ctl():  # no breakpoint -> must not stop there
        p.call("assemble", source=case("hello.s"))
        p.call("bp", set=[])
        r3 = p.call("run")
        assert r3["reason"] == "BREAKPOINT", r3
    must_fail("no breakpoint, no BREAKPOINT stop", ctl)
    p.output()


def check_stop(p):
    p.call("assemble", source=case("forever.s"))
    rid = p.send("run")
    time.sleep(0.3)
    t = time.perf_counter()
    assert p.call("stop")["was_running"]
    r = p.reply(rid, timeout=5)
    dt = (time.perf_counter() - t) * 1000
    assert r["reason"] == "STOP", r
    s = p.call("step")
    assert s["reason"] == "MAX_STEPS", s
    record("stop a running program", "works", f"reply {dt:.1f} ms after stop, {r['steps']} instructions ran, stepping resumes afterwards")

    def ctl():  # without stop the run must not come back
        p.call("assemble", source=case("forever.s"))
        rid2 = p.send("run")
        try:
            p.reply(rid2, timeout=0.5)
        except TimeoutError:
            p.call("stop")
            p.reply(rid2, timeout=5)
            raise AssertionError("run did not return on its own")
    must_fail("forever.s needs stop", ctl)


def check_backstep(p):
    p.call("assemble", source=case("hello.s"))
    a = p.call("step"); b = p.call("step"); c = p.call("step")
    u = p.call("backstep")
    assert u["ok"] and u["pc"] == b["pc"] and u["x"] == b["x"], (u, b)
    record("undo one step (RARS back-stepper)", "works", f"after 3 steps pc={c['pc']:#x}, backstep -> pc={u['pc']:#x}, regs equal step 2")


# ---------------------------------------------------------------- state

def check_state(p):
    p.call("assemble", source=case("fp.s"))
    r = p.call("run")
    assert u32(r["f"][1]) == 0x40400000, r["f"][:2]   # 3.0f
    m = p.call("mem", addr=DATA_BASE, len=4096)
    assert m["ok"] and len(m["hex"]) == 8192 and m["hex"].startswith("0000c03f"), m["hex"][:16]
    bad = p.call("mem", addr=0, len=4)
    assert not bad["ok"], bad
    asm = p.call("assemble", source=case("hello.s"))
    t = asm["text"]
    assert [x["addr"] for x in t] == [TEXT_BASE + 4 * i for i in range(len(t))]
    assert all({"addr", "code", "basic", "line", "src"} <= x.keys() for x in t)
    record("x0-x31, pc, f0-f31 in one call", "works", f"fadd.s ft1 = {u32(r['f'][1]):#010x} (3.0f)")
    record("read arbitrary memory range", "works", f"4096 bytes from {DATA_BASE:#x}; unmapped address 0 -> {bad['error']!r}")
    record("text segment listing", "works",
           f"{len(t)} rows with addr/code/basic/line/src, e.g. {t[0]['addr']:#x} {u32(t[0]['code']):#010x} {t[0]['basic']!r} line {t[0]['line']}")
    def fp_is_3(regs):
        assert u32(regs[1]) == 0x40400000, regs[:2]
    must_fail("f1 check rejects f1 before fadd.s", lambda: fp_is_3(p.call("regs")["f"] if p.call("assemble", source=case("fp.s")) else None))
    p.output()


# ---------------------------------------------------------------- console

def check_console(p):
    p.call("assemble", source=case("readint.s"))
    rid = p.send("run")
    ev = p.wait_event("input_wanted", timeout=5)
    st = p.call("status")
    assert st["busy"] and st["waiting"], st
    p.call("input", text="21\n")
    r = p.reply(rid)
    out = p.output()
    assert r["reason"] == "NORMAL_TERMINATION" and out == "42\n", (r, out)
    record("feed console input from outside", "works", f"input_wanted at pc={ev['pc']:#x}, status waiting=true, fed '21' -> printed {out!r}")

    # step-mode: the step reply waits for input
    p.call("assemble", source=case("readint.s"))
    p.call("step")
    rid = p.send("step")
    p.wait_event("input_wanted", timeout=5)
    try:
        p.reply(rid, timeout=0.3)
        raise AssertionError("step returned without input")
    except TimeoutError:
        pass
    p.call("input", text="5\n")
    s = p.reply(rid)
    assert s["x"][10] == 5, s["x"][10]
    record("step into ReadInt", "messy", "step reply is withheld until input arrives (the step blocks; an input_wanted event says why)")

    # stop while waiting, then undo the half-finished ecall with the back-stepper
    p.call("assemble", source="main: li a0, 77\n li a7, 5\n ecall\n li a7, 10\n ecall\n")
    rid = p.send("run")
    p.wait_event("input_wanted", timeout=5)
    p.call("stop")
    r = p.reply(rid, timeout=5)
    assert r["reason"] == "STOP" and r["x"][10] == 0 and r["pc"] == TEXT_BASE + 12, r
    u = p.call("backstep")
    assert u["pc"] == TEXT_BASE + 8 and u["x"][10] == 77, u
    rid = p.send("step")
    p.wait_event("input_wanted", timeout=5)
    p.call("input", text="9\n")
    assert p.reply(rid)["x"][10] == 9
    record("stop while waiting for input", "messy",
           "STOP returns, but RARS completes the ecall with its default input '0' (a0 77->0, pc past ecall); "
           "one backstep restores a0=77 and pc=ecall, and the next step asks for input again")

    def ctl():  # hello.s never asks for input
        p.call("assemble", source=case("hello.s"))
        p.call("run")
        p.wait_event("input_wanted", timeout=0.5)
    must_fail("hello.s emits no input_wanted", lambda: _expect_timeout(ctl))
    p.output()


def _expect_timeout(fn):
    try:
        fn()
    except TimeoutError:
        raise AssertionError("timed out as expected")


# ---------------------------------------------------------------- errors

def check_errors(p):
    r = p.call("assemble", source=case("errors.s"))
    assert not r["ok"] and [e["line"] for e in r["errors"]] == [3, 4, 6], r
    assert all(e["col"] > 0 and e["message"] for e in r["errors"]), r
    record("structured assemble errors, several at once", "works",
           "; ".join(f"L{e['line']}:C{e['col']} {e['message']}" for e in r["errors"]))
    p.call("assemble", source=case("misaligned.s"))
    x = p.call("run")
    assert x["reason"] == "EXCEPTION" and x["cause"] == 4 and x["line"] == 6, x
    record("runtime error report", "works", f"reason=EXCEPTION cause={x['cause']} line={x['line']} {x['message']!r}")
    must_fail("hello.s has no errors", lambda: _assert_errors(p.call("assemble", source=case("hello.s"))))


def _assert_errors(r):
    assert not r["ok"], r


# ---------------------------------------------------------------- repetition

def run_output(p, name, stdin=None):
    a = p.call("assemble", source=case(name))
    assert a["ok"], a
    if stdin:
        p.call("input", text=stdin)
    r = p.call("run", timeout=10)
    return r, p.output()


def check_repeat(skip_reset_probe):
    fresh = Probe()
    _, base = run_output(fresh, "clean.s")
    fresh.close()

    p = Probe()
    _, c1 = run_output(p, "clean.s")
    _, d = run_output(p, "dirty.s")
    _, c2 = run_output(p, "clean.s")
    bad = p.call("assemble", source=case("uselabel.s"))
    for _ in range(50):
        run_output(p, "dirty.s")
    _, c3 = run_output(p, "clean.s")
    assert c1 == c2 == c3 == base, (base, c1, c2, c3)
    assert not bad["ok"], bad
    record("re-assemble in one JVM leaves no data/heap/symbol residue", "works",
           f"fresh JVM clean.s -> {base!r}; same JVM after dirty.s x51 -> {c3!r}; label from previous program not visible ({bad['errors'][0]['message']!r})")

    # the memory read path would see contamination if it were there
    def ctl():
        run_output(p, "dirty.s")
        m = p.call("mem", addr=DATA_BASE + 64, len=4)
        assert m["hex"] == "00000000", m
    must_fail("dirty.s marker is visible before re-assemble", ctl)

    # console input left over from the previous run must not leak into the next
    def leftover(q):
        q.call("assemble", source=case("readint.s"))
        q.call("input", text="1\n2\n")
        q.call("run")
        q.output()
        q.call("assemble", source=case("readint.s"))
        rid = q.send("run")
        try:
            q.wait_event("input_wanted", timeout=2)
        except TimeoutError:
            r = q.reply(rid)
            raise AssertionError(f"second run never asked for input; printed {q.output()!r} ({r['reason']})")
        q.call("input", text="3\n")
        q.reply(rid)
        return q.output()
    out = leftover(p)
    assert out == "6\n", out
    record("leftover console input does not leak across re-assemble", "works", "fed '1\\n2\\n', re-assembled, next run asked for input again")
    must_fail("without the stdio reset the leftover '2' leaks", lambda: _assert_eq(leftover(skip_reset_probe), "6\n"))
    p.close()


def _assert_eq(a, b):
    assert a == b, (a, b)


def main():
    jlink_min = sys.argv[1] if len(sys.argv) > 1 else None
    p = Probe()
    record("RARS version reported by Globals.version", "info", p.version)
    check_headless_and_classes()
    if jlink_min:
        check_without_java_desktop(jlink_min)
    check_step(p)
    check_breakpoints(p)
    check_stop(p)
    check_backstep(p)
    check_state(p)
    check_console(p)
    check_errors(p)
    p.close()
    check_repeat(Probe(jvm_args=["-Dprobe.skipStdioReset=true"]))
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    with open(os.path.join(HERE, "results", "checks.json"), "w") as f:
        json.dump(results, f, indent=1)
    print("all checks and negative controls behaved", flush=True)


if __name__ == "__main__":
    main()
