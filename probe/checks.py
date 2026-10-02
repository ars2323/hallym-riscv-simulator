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


def experiment(java, mode):
    """One DesktopExperiment mode in its own JVM; returns its verdict line."""
    p = subprocess.run([java, "-Xlog:disable", "-Xlog:all=warning:stderr", "-Djava.awt.headless=true",
                        "-cp", classpath(), "DesktopExperiment", mode],
                       capture_output=True, text=True, timeout=60)
    lines = [l for l in p.stdout.splitlines() if l.startswith(mode + " ")]
    assert lines, f"no verdict from {mode}: stdout={p.stdout[-500:]!r} stderr={p.stderr[-500:]!r}"
    return lines[-1]


def check_without_java_desktop(jlink_dir):
    """Can any unmodified entry point run on java.base + java.prefs only?"""
    java_min = os.path.join(jlink_dir, "bin", "java")
    if not os.path.isfile(java_min):
        sys.exit(f"{java_min} missing: run probe/run.sh bench first (it builds the jlink images)")
    full = {m: experiment("java", m) for m in ("initialize", "api", "skip")}
    small = {m: experiment(java_min, m) for m in ("initialize", "api", "skip")}

    def all_fail(verdicts):
        assert all(" FAIL " in v for v in verdicts.values()), verdicts
    all_fail(small)
    # positive control: on a full runtime the experiment can succeed, so its failures above mean something
    must_fail("full runtime runs the normal and api paths", lambda: all_fail({m: full[m] for m in ("initialize", "api")}))
    for m in ("initialize", "api", "skip"):
        record(f"without java.desktop: {m} path", "no", small[m])
    record("skipping Settings, even on a full runtime", "no", full["skip"])
    return False


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


BP_SRC = """# line 1
main:   li   t0, 1        # line 2
        # line 3: a comment that the second version turns into code
        li   t1, 2        # line 4
        li   t2, 3        # line 5
        li   a7, 10       # line 6
        ecall             # line 7
"""
BP_SRC_EDITED = BP_SRC.replace("        # line 3: a comment that the second version turns into code", "        nop               # line 3 (new)")


def check_breakpoints(p):
    asm = p.call("assemble", source=case("hello.s"))
    line = 8                                  # li a0, 42
    r = p.call("bp", lines=[line])
    bp = r["breakpoints"][0]["addr"]
    assert bp == next(t["addr"] for t in asm["text"] if t["line"] == line), (r, asm["text"])
    r = p.call("run")
    assert r["reason"] == "BREAKPOINT" and r["pc"] == bp, r
    p.call("bp", lines=[])
    r2 = p.call("run")
    assert r2["reason"] == "NORMAL_TERMINATION", r2
    record("breakpoint set/clear by source line", "works",
           f"line {line} -> {bp:#x}, run stopped there (BREAKPOINT), cleared, then ran to NORMAL_TERMINATION")

    def ctl():  # no breakpoint -> must not stop there
        p.call("assemble", source=case("hello.s"))
        p.call("bp", lines=[])
        r3 = p.call("run")
        assert r3["reason"] == "BREAKPOINT", r3
    must_fail("no breakpoint, no BREAKPOINT stop", ctl)
    p.output()


def breakpoint_survives(q):
    """bp on line 5, then re-assemble a version where line 3 became code: the stop must still be line 5."""
    q.call("assemble", source=BP_SRC)
    q.call("bp", lines=[5])
    first = q.call("run")
    assert first["reason"] == "BREAKPOINT", first
    a = q.call("assemble", source=BP_SRC_EDITED)       # the app sends nothing else
    want = next(t["addr"] for t in a["text"] if t["line"] == 5)
    assert a["breakpoints"] == [{"line": 5, "addr": want}], a["breakpoints"]
    r = q.call("run")
    stopped_line = next((t["line"] for t in a["text"] if t["addr"] == r["pc"]), None)
    assert r["reason"] == "BREAKPOINT" and r["pc"] == want, (r["reason"], hex(r["pc"]), "line", stopped_line, "want", hex(want))
    return first["pc"], want


def check_breakpoints_survive(v1_probe):
    p = Probe()
    old, new = breakpoint_survives(p)
    p.close()
    record("breakpoint survives re-assemble (engine re-resolves the line)", "works",
           f"line 5 was {old:#x}; after line 3 became code it is {new:#x}, and the run stops there without the app resending")
    must_fail("protocol-1 behaviour (address kept) stops at the wrong line", lambda: breakpoint_survives(v1_probe))
    v1_probe.close()


STOP_INPUT_SRC = """        .data
buf:    .ascii "XYZ\0"
        .text
main:   li   a0, 77
        li   a7, 5           # ReadInt
        ecall
        la   a0, buf
        li   a1, 4
        li   a7, 8           # ReadString into buf
        ecall
        li   a7, 10
        ecall
"""


def stop_during_input(q, backstep):
    """Stop while each of two input syscalls waits; the engine must leave no trace of the ecall."""
    q.call("assemble", source=STOP_INPUT_SRC)
    asm_text = q.call("assemble", source=STOP_INPUT_SRC)["text"]
    ecalls = [t["addr"] for t in asm_text if t["basic"].startswith("ecall")]
    rid = q.send("run", backstep=backstep)
    q.wait_event("input_wanted", timeout=5)
    q.call("stop")
    r = q.reply(rid, timeout=5)
    assert r["reason"] == "STOP" and r.get("input_cancelled") and r.get("undone"), r
    assert r["x"][10] == 77 and r["pc"] == ecalls[0], (r["x"][10], hex(r["pc"]))
    # the next run asks again; give it a number, then stop during ReadString
    rid = q.send("run", backstep=backstep)
    q.wait_event("input_wanted", timeout=5)
    q.call("input", text="5\n")
    q.wait_event("input_wanted", timeout=5)
    q.call("stop")
    r2 = q.reply(rid, timeout=5)
    mem = q.call("mem", addr=DATA_BASE, len=4)["hex"]
    assert r2["reason"] == "STOP" and r2.get("undone") and r2["pc"] == ecalls[1], r2
    assert mem == "58595a00", mem             # "XYZ\0" untouched: ReadString's write was undone too
    return r, r2, mem


def check_stop_input(v1_probe):
    p = Probe()
    r, r2, mem = stop_during_input(p, backstep=True)
    stop_during_input(p, backstep=False)    # the engine records the ecall even with backstep off
    p.close()
    record("stop while waiting for input (engine undoes the ecall)", "works",
           f"STOP reply has input_cancelled+undone; a0 stays 77, pc={r['pc']:#x} is the ecall; "
           f"ReadString buffer stays {mem}; same with backstep:false")
    must_fail("protocol-1 behaviour leaves the default input in a0", lambda: stop_during_input(v1_probe, backstep=True))
    v1_probe.close()


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


def stop_many(q, n=200):
    """Stop a running loop n times; every reply must say STOP."""
    bad = []
    for i in range(n):
        q.call("assemble", source=case("forever.s"))
        rid = q.send("run")
        time.sleep(0.005)
        q.call("stop")
        r = q.reply(rid, timeout=5)
        if r["reason"] != "STOP":
            bad.append(r["reason"])
    assert not bad, f"{len(bad)}/{n} stops said {sorted(set(bad))}"
    return n


def check_stop_race():
    """RARS's setStop() race (null reason, about 1 stop in 20): the wrapper must cover it."""
    p = Probe()
    n = stop_many(p)
    p.close()
    record("every stop says STOP (RARS's setStop race covered)", "works", f"{n} stops, all STOP")
    raw = Probe(jvm_args=["-Dprobe.rawStopReason=true"])
    must_fail("without the wrapper's cover, some stop says null", lambda: stop_many(raw))
    raw.close()


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
    p.call("assemble", source=".data\nd: .double 1.5\n.text\nla t0, d\nfld ft0, 0(t0)\nli a7, 10\necall\n")
    for _ in range(3):
        d = p.call("step")
    def double_ok(regs):
        assert regs["fbits"][0] == "3ff8000000000000", regs["fbits"][0]
    double_ok(d)
    must_fail("f[] alone cannot show a double", lambda: double_ok({"fbits": [f"{u32(d['f'][0]):016x}"]}))
    record("double in an f register (fbits)", "works", f"fld 1.5 -> fbits[0]={d['fbits'][0]}, while f[0]={u32(d['f'][0]):#010x} (RARS single view)")
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


# ---------------------------------------------------------------- protocol contract

def check_protocol(p):
    assert p.protocol == 2, p.protocol
    # ids keep their JSON type
    p.send_raw('{"id":"s-1","cmd":"ping"}')
    r = p.reply_where(lambda m: m.get("id") == "s-1")
    assert r["ok"], r
    # every failure carries a machine-readable code
    p.send_raw("not json")
    bad = p.reply_where(lambda m: "id" in m and m["id"] is None)
    codes = {"bad_json": bad.get("code"),
             "bad_request": p.call("assemble").get("code"),
             "unknown_cmd": p.call("frob").get("code"),
             "address": p.call("mem", addr=0, len=1).get("code"),
             "assemble_error": p.call("assemble", source="addi").get("code"),
             "not_runnable": p.call("step").get("code")}
    def codes_match(c):
        assert all(k == v for k, v in c.items()), c
    codes_match(codes)
    must_fail("code check notices a wrong code", lambda: codes_match({**codes, "busy": "bad_request"}))
    a = p.call("assemble", source=".globl main\n.data\nmsg: .word 1\n.text\nmain: la t0, msg\nloop: j loop\n")
    sym = {x["name"]: x for x in a["symbols"]}
    assert sym["msg"]["segment"] == "data" and sym["msg"]["addr"] == DATA_BASE, sym
    assert sym["main"]["global"] and not sym["loop"]["global"] and sym["loop"]["addr"] == TEXT_BASE + 8, sym
    record("protocol contract (version, id types, error codes, symbols)", "works",
           f"protocol={p.protocol}; string id echoed; codes {sorted(codes)}; symbols {sorted(sym)}")


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
    check_protocol(p)
    p.close()
    check_repeat(Probe(jvm_args=["-Dprobe.skipStdioReset=true"]))
    check_breakpoints_survive(Probe(jvm_args=["-Dprobe.v1Breakpoints=true"]))
    check_stop_input(Probe(jvm_args=["-Dprobe.v1StopInput=true"]))
    check_stop_race()
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    with open(os.path.join(HERE, "results", "checks.json"), "w") as f:
        json.dump(results, f, indent=1)
    print("all checks and negative controls behaved", flush=True)


if __name__ == "__main__":
    main()
