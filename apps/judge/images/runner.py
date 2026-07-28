#!/usr/bin/env python3
"""
In-container runner.

Reads one JSON job from stdin, compiles if needed, runs every test case, and
emits one JSON line per test to stdout as it goes. §11 forbids batching: the
sequential reveal in §6.6 is built on results arriving individually.

Nothing is mounted into the container. Source and test data arrive over stdin,
which removes bind mounts — and the whole class of mount-based escapes — from
the design entirely. It also sidesteps Windows/WSL2 path translation, which is
slow and permission-strange for bind mounts.

The only writable location is a small tmpfs at /tmp. It is mounted `exec`
because a compiled C++ binary has to run from somewhere; that is not a
weakening, since the process is already executing attacker-supplied code by
definition. Everything else is read-only.
"""

import json
import os
import resource
import subprocess
import sys
import tempfile

# A submission that prints in a loop must not be able to fill the disk or the
# pipe. Truncate hard and report OUTPUT_LIMIT.
MAX_OUTPUT_BYTES = 256 * 1024
MAX_COMPILE_SECONDS = 10


def emit(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def limits(memory_bytes):
    """Applied in the child, after fork, before exec."""

    def apply():
        # Belt to the cgroup's braces. The cgroup memory limit is what actually
        # contains the process; RLIMIT_AS makes the failure a clean allocation
        # error instead of an OOM kill where possible.
        resource.setrlimit(resource.RLIMIT_AS, (memory_bytes, memory_bytes))
        resource.setrlimit(resource.RLIMIT_FSIZE, (8 * 1024 * 1024, 8 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        os.setsid()

    return apply


def run_once(argv, stdin_data, timeout_s, memory_bytes):
    """Returns (verdict, stdout, elapsed_ms)."""
    import time

    started = time.monotonic()
    try:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            preexec_fn=limits(memory_bytes),
            cwd="/tmp",
            env={"PATH": "/usr/bin:/bin", "HOME": "/tmp"},
        )
    except OSError:
        return "RUNTIME_ERROR", "", 0

    truncated = False
    try:
        out, _ = proc.communicate(input=stdin_data.encode(), timeout=timeout_s)
    except subprocess.TimeoutExpired:
        proc.kill()
        try:
            os.killpg(proc.pid, 9)
        except OSError:
            pass
        proc.communicate()
        return "TIME_LIMIT", "", int((time.monotonic() - started) * 1000)

    elapsed = int((time.monotonic() - started) * 1000)

    if len(out) > MAX_OUTPUT_BYTES:
        out = out[:MAX_OUTPUT_BYTES]
        truncated = True

    if truncated:
        return "OUTPUT_LIMIT", out.decode("utf-8", "replace"), elapsed
    if proc.returncode != 0:
        # 137 = SIGKILL, which under a cgroup memory limit means the OOM killer.
        if proc.returncode in (-9, 137):
            return "MEMORY_LIMIT", "", elapsed
        return "RUNTIME_ERROR", "", elapsed

    return "OK", out.decode("utf-8", "replace"), elapsed


def normalise(text):
    """Trailing whitespace is never the difference between right and wrong."""
    return "\n".join(line.rstrip() for line in text.strip().splitlines())


def main():
    job = json.loads(sys.stdin.read())
    language = job["language"]
    source = job["source"]
    tests = job["tests"]
    time_limit = job["timeLimitMs"] / 1000.0
    memory_bytes = job["memoryLimitMb"] * 1024 * 1024

    workdir = tempfile.mkdtemp(dir="/tmp")

    if language == "CPP17":
        src = os.path.join(workdir, "main.cpp")
        binary = os.path.join(workdir, "main")
        with open(src, "w") as handle:
            handle.write(source)
        emit({"kind": "compiling"})
        compile_proc = subprocess.run(
            ["g++", "-std=c++17", "-O2", "-o", binary, src],
            capture_output=True,
            timeout=MAX_COMPILE_SECONDS,
            cwd="/tmp",
        )
        if compile_proc.returncode != 0:
            emit(
                {
                    "kind": "compile-failed",
                    "message": compile_proc.stderr.decode("utf-8", "replace")[:4000],
                }
            )
            return
        argv = [binary]
    elif language == "PYTHON3":
        src = os.path.join(workdir, "main.py")
        with open(src, "w") as handle:
            handle.write(source)
        # Syntax-check up front so a typo reports COMPILE_ERROR rather than
        # failing every test case identically.
        emit({"kind": "compiling"})
        check = subprocess.run(
            [sys.executable, "-c", "import py_compile,sys; py_compile.compile(sys.argv[1], doraise=True)", src],
            capture_output=True,
            timeout=MAX_COMPILE_SECONDS,
        )
        if check.returncode != 0:
            emit(
                {
                    "kind": "compile-failed",
                    "message": check.stderr.decode("utf-8", "replace")[:4000],
                }
            )
            return
        argv = [sys.executable, src]
    else:
        emit({"kind": "error", "message": f"unsupported language {language}"})
        return

    emit({"kind": "running", "total": len(tests)})

    for test in tests:
        status, out, elapsed = run_once(argv, test["input"], time_limit, memory_bytes)
        if status == "OK":
            verdict = "ACCEPTED" if normalise(out) == normalise(test["expected"]) else "WRONG_ANSWER"
        else:
            verdict = status
        emit(
            {
                "kind": "test",
                "ordinal": test["ordinal"],
                "verdict": verdict,
                "runtimeMs": elapsed,
            }
        )
        if verdict != "ACCEPTED":
            # Stop at the first failure: the verdict is decided and continuing
            # only burns judge capacity.
            break


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — the runner must never crash silently
        emit({"kind": "error", "message": f"{type(exc).__name__}: {exc}"[:500]})
