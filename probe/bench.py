"""Section-4 measurements. Prints a table and writes probe/results/bench.json.

Usage: python3 bench.py [JLINK_OUT_DIR]   (default: probe/build/jlink)
"""
import json
import os
import platform
import shutil
import statistics
import subprocess
import sys
import time

from client import Probe, case, HERE

out = {}


def pct(xs, p):
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(round(p / 100 * (len(xs) - 1))))]


def summary(ms):
    return {"n": len(ms), "median_ms": round(statistics.median(ms), 3),
            "p99_ms": round(pct(ms, 99), 3), "max_ms": round(max(ms), 3)}


def dir_bytes(path):
    total = 0
    for root, _, files in os.walk(path):
        for f in files:
            fp = os.path.join(root, f)
            if not os.path.islink(fp):
                total += os.path.getsize(fp)
    return total


def jlink(dest, modules, compress):
    if os.path.exists(dest):
        shutil.rmtree(dest)
    cmd = ["jlink", "--add-modules", ",".join(modules), "--strip-debug", "--no-man-pages",
           "--no-header-files", "--output", dest]
    if compress:
        cmd += ["--compress=zip-9"]
    subprocess.run(cmd, check=True)
    return dir_bytes(dest)


def cold_start(java, runs=10, extra=()):
    ready, first = [], []
    src = case("hello.s")
    for _ in range(runs):
        p = Probe(java=java, jvm_args=["-Djava.awt.headless=true", *extra], timeout=30)
        t = time.perf_counter()
        r = p.call("assemble", source=src)
        assert r["ok"], r
        ready.append((p.t_ready - p.t_spawn) * 1000)
        first.append((time.perf_counter() - p.t_spawn) * 1000)
        p.close()
    return {"spawn_to_ready": summary(ready), "spawn_to_first_assemble_reply": summary(first)}


def main():
    jdir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, "build", "jlink")
    os.makedirs(jdir, exist_ok=True)
    jar = os.environ["RARS_JAR"]
    out["host"] = {"machine": platform.machine(), "system": platform.system(),
                   "java": subprocess.run(["java", "-version"], capture_output=True, text=True).stderr.splitlines()[-3:]}

    # ---- sizes
    sizes = {}
    sizes["rars_jar_bytes"] = os.path.getsize(jar)
    with_desktop = ["java.base", "java.prefs", "java.desktop"]
    without_desktop = ["java.base", "java.prefs"]
    sizes["jlink_base_prefs_bytes"] = jlink(os.path.join(jdir, "min"), without_desktop, False)
    sizes["jlink_base_prefs_zip9_bytes"] = jlink(os.path.join(jdir, "min-zip"), without_desktop, True)
    sizes["jlink_base_prefs_desktop_zip9_bytes"] = jlink(os.path.join(jdir, "desk-zip"), with_desktop, True)
    sizes["jlink_base_prefs_desktop_bytes"] = jlink(os.path.join(jdir, "desk"), with_desktop, False)
    src = os.path.join(HERE, "src", "RarsProbe.java")
    with open(src) as f:
        lines = f.read().splitlines()
    sizes["wrapper_java_lines"] = len(lines)
    sizes["wrapper_java_code_lines"] = sum(1 for l in lines if l.strip() and not l.strip().startswith("//"))
    out["sizes"] = sizes
    print(json.dumps(sizes, indent=1), flush=True)

    # ---- cold start
    desk_java = os.path.join(jdir, "desk", "bin", "java")
    out["cold_start_system_jdk"] = cold_start("java")
    out["cold_start_jlink_desktop"] = cold_start(desk_java)
    out["cold_start_jlink_desktop_zip9"] = cold_start(os.path.join(jdir, "desk-zip", "bin", "java"))
    cds = os.path.join(jdir, "probe.jsa")
    p = Probe(java=desk_java, jvm_args=["-Djava.awt.headless=true", f"-XX:ArchiveClassesAtExit={cds}"], timeout=30)
    p.call("assemble", source=case("hello.s")); p.call("run"); p.close()
    out["cold_start_jlink_desktop_appcds"] = cold_start(desk_java, extra=[f"-XX:SharedArchiveFile={cds}"])
    for k in [k for k in out if k.startswith("cold_start")]:
        print(k, json.dumps(out[k]), flush=True)

    # ---- step latency over stdio
    p = Probe(jvm_args=["-Djava.awt.headless=true"])
    p.call("assemble", source=case("forever.s"))
    step = []
    for _ in range(1000):
        t = time.perf_counter()
        r = p.call("step")
        step.append((time.perf_counter() - t) * 1000)
        assert r["reason"] == "MAX_STEPS", r
    out["step_roundtrip_first100"] = summary(step[:100])
    out["step_roundtrip_all1000"] = summary(step)
    out["step_roundtrip_last900"] = summary(step[100:])

    # ---- state reads
    regs, mem = [], []
    for _ in range(500):
        t = time.perf_counter(); p.call("regs"); regs.append((time.perf_counter() - t) * 1000)
    for _ in range(500):
        t = time.perf_counter(); p.call("mem", addr=0x10010000, len=4096); mem.append((time.perf_counter() - t) * 1000)
    out["regs_roundtrip"] = summary(regs)
    out["mem4k_roundtrip"] = summary(mem)

    # ---- "Instant": a few thousand instructions in one call
    inst = []
    for _ in range(50):
        p.call("assemble", source=case("forever.s"))
        t = time.perf_counter()
        r = p.call("run", max=5000, backstep=False)
        inst.append((time.perf_counter() - t) * 1000)
        assert r["reason"] == "MAX_STEPS" and r["steps"] == 5000, r
    out["run_5000_instructions_roundtrip"] = summary(inst)

    # ---- throughput
    tp = []
    for backstep in (True, False, True, False):
        p.call("assemble", source=case("loop.s"))
        r = p.call("run", timeout=600, backstep=backstep)
        assert r["reason"] == "NORMAL_TERMINATION", r
        tp.append({"backstep": backstep, "instructions": r["steps"], "seconds": round(r["ns"] / 1e9, 3),
                   "instr_per_s": int(r["steps"] / (r["ns"] / 1e9))})
    out["run_throughput_loop_s"] = tp
    p.close()

    for k, v in out.items():
        if k not in ("sizes", "host") and not k.startswith("cold_start"):
            print(k, json.dumps(v), flush=True)
    os.makedirs(os.path.join(HERE, "results"), exist_ok=True)
    with open(os.path.join(HERE, "results", "bench.json"), "w") as f:
        json.dump(out, f, indent=1)


if __name__ == "__main__":
    main()
