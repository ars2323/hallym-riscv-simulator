"""Tiny client for RarsProbe's stdio JSON protocol (used by checks.py and bench.py)."""
import json
import os
import queue
import subprocess
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))


def classpath():
    jar = os.environ.get("RARS_JAR")
    if not jar:
        sys.exit("RARS_JAR is empty: point it at rars1_6.jar (see probe/setup.sh)")
    if not os.path.isfile(jar):
        sys.exit(f"RARS_JAR={jar} does not exist")
    build = os.path.join(HERE, "build", "classes")
    if not os.path.isfile(os.path.join(build, "RarsProbe.class")):
        sys.exit(f"{build}/RarsProbe.class missing: run probe/run.sh build")
    return f"{build}{os.pathsep}{jar}"


class Probe:
    def __init__(self, java="java", jvm_args=(), timeout=10.0):
        self.timeout = timeout
        self.t_spawn = time.perf_counter()
        self.p = subprocess.Popen(
            # JVM unified logging defaults to stdout, which is the protocol channel.
            [java, "-Xlog:disable", "-Xlog:all=warning:stderr", *jvm_args, "-cp", classpath(), "RarsProbe"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, encoding="utf-8", bufsize=1)
        self.q = queue.Queue()
        self.events = []            # every non-reply message, in order
        self.stderr = []
        threading.Thread(target=self._pump, daemon=True).start()
        threading.Thread(target=self._pump_err, daemon=True).start()
        self.next_id = 1
        ready = self.wait_event("ready")
        self.t_ready = time.perf_counter()
        self.version = ready["rars"]
        self.protocol = ready.get("protocol")

    def _pump(self):
        for line in self.p.stdout:
            try:
                self.q.put(json.loads(line))
            except ValueError:
                # Something other than the probe wrote to fd 1 (e.g. a JVM warning). Surface it loudly.
                print(f"probe: non-JSON on stdout: {line!r}", file=sys.stderr, flush=True)
                self.q.put({"ev": "nonjson", "text": line})
        self.q.put(None)

    def _pump_err(self):
        for line in self.p.stderr:
            self.stderr.append(line)

    def _get(self, deadline, what):
        left = deadline - time.perf_counter()
        try:
            if left <= 0:
                raise queue.Empty
            m = self.q.get(timeout=left)
        except queue.Empty:
            raise TimeoutError(f"no {what} before deadline; stderr tail={''.join(self.stderr)[-500:]!r}") from None
        if m is None:
            raise RuntimeError(f"probe exited (code {self.p.wait()}) while waiting for {what}; "
                               f"stderr={''.join(self.stderr)[-2000:]}")
        return m

    def wait_event(self, ev, timeout=None):
        if not ev:
            raise ValueError("wait_event: empty event name")
        deadline = time.perf_counter() + (timeout or self.timeout)
        for i, m in enumerate(self.events):
            if m.get("ev") == ev:
                return self.events.pop(i)
        while True:
            m = self._get(deadline, f"event {ev!r}")
            if m.get("ev") == ev:
                return m
            self.events.append(m)

    def send_raw(self, line):
        """Write one raw line (for malformed-request tests)."""
        self.p.stdin.write(line + "\n")
        self.p.stdin.flush()

    def send(self, cmd, **kw):
        rid = self.next_id
        self.next_id += 1
        self.p.stdin.write(json.dumps({"id": rid, "cmd": cmd, **kw}) + "\n")
        self.p.stdin.flush()
        return rid

    def reply(self, rid, timeout=None):
        if not isinstance(rid, int):
            raise ValueError(f"reply: bad id {rid!r}")
        deadline = time.perf_counter() + (timeout or self.timeout)
        for i, m in enumerate(self.events):
            if m.get("id") == rid:
                return self.events.pop(i)
        while True:
            m = self._get(deadline, f"reply to id {rid}")
            if m.get("id") == rid:
                return m
            self.events.append(m)

    def reply_where(self, pred, timeout=None):
        """First message (reply or event) matching pred, e.g. a reply whose id is not an int."""
        deadline = time.perf_counter() + (timeout or self.timeout)
        for i, m in enumerate(self.events):
            if pred(m):
                return self.events.pop(i)
        while True:
            m = self._get(deadline, "matching message")
            if pred(m):
                return m
            self.events.append(m)

    def call(self, cmd, timeout=None, **kw):
        return self.reply(self.send(cmd, **kw), timeout)

    def output(self):
        """Drain console output events collected so far."""
        out = [m["text"] for m in self.events if m.get("ev") == "out"]
        self.events = [m for m in self.events if m.get("ev") != "out"]
        return "".join(out)

    def close(self):
        try:
            self.call("quit", timeout=5)
        except Exception:
            pass
        try:
            self.p.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.p.kill()


def case(name):
    with open(os.path.join(HERE, "cases", name), encoding="utf-8") as f:
        return f.read()
