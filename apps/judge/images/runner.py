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
import selectors
import subprocess
import sys
import tempfile
import threading
import time

# A submission that prints in a loop must not be able to fill the disk or the
# pipe. Truncate hard and report OUTPUT_LIMIT.
MAX_OUTPUT_BYTES = 256 * 1024

# Compilation is a separate budget from execution, and it has to be. A compiler
# is an arbitrary-computation engine: recursive template instantiation, #include
# explosion and constexpr loops are all Turing-complete workloads that happen
# before a single line of the program runs. Charging them against the 5s
# execution limit would kill correct heavy-template C++ for being slow to build,
# and leaving them untimed is a live denial-of-service hole.
MAX_COMPILE_SECONDS = 10

# The compiler gets its own memory ceiling *below* the container's, so that a
# template bomb hits RLIMIT_AS and dies cleanly instead of tripping the cgroup
# OOM killer — which may pick the runner as its victim and take the judge down
# with it. That was the shape of the print-flood bug; the same trap applies here.
COMPILE_MEMORY_RESERVE = 48 * 1024 * 1024


def child_cpu_seconds():
    """
    Cumulative CPU consumed by children we have waited on.

    Wall time is not a cost measure: a compile bomb spends 10 seconds of CPU
    from five lines of input, which a request-counting limiter cannot see. CPU
    seconds are the thing actually being consumed, so they are the thing that
    has to be billed (section 11).
    """
    ru = resource.getrusage(resource.RUSAGE_CHILDREN)
    return ru.ru_utime + ru.ru_stime


def emit(obj):
    sys.stdout.write(json.dumps(obj, separators=(",", ":")) + "\n")
    sys.stdout.flush()


def set_limit(which, soft):
    """
    Lower a resource limit, never raise it.

    The container's --ulimit flags already pin several hard limits, and a
    non-root process cannot raise a hard limit: asking for more than the
    ceiling raises ValueError inside preexec_fn, which surfaces as an opaque
    "Exception occurred in preexec_fn" and kills the job before it starts.
    Clamp to whatever the hard limit already is.
    """
    try:
        current_soft, hard = resource.getrlimit(which)
    except (ValueError, OSError):
        return
    if hard != resource.RLIM_INFINITY:
        soft = min(soft, hard)
        target_hard = hard
    else:
        target_hard = soft
    try:
        resource.setrlimit(which, (soft, target_hard))
    except (ValueError, OSError):
        pass


def limits(memory_bytes):
    """Applied in the child, after fork, before exec."""

    def apply():
        # Belt to the cgroup's braces. The cgroup memory limit is what actually
        # contains the process; RLIMIT_AS makes the failure a clean allocation
        # error instead of an OOM kill where possible.
        set_limit(resource.RLIMIT_AS, memory_bytes)
        set_limit(resource.RLIMIT_FSIZE, 8 * 1024 * 1024)
        set_limit(resource.RLIMIT_NOFILE, 64)
        set_limit(resource.RLIMIT_CORE, 0)
        os.setsid()

    return apply


def write_source(path, source):
    """
    Persist the submitted source, tolerating anything at all.

    Source arrives as JSON, so it can contain lone surrogates, null bytes and
    other sequences that are not encodable UTF-8. Writing them naively raises
    UnicodeEncodeError inside the runner, which reaches the top-level handler
    and is reported as an internal error — and by section 6.9 an internal error
    VOIDS the match. That makes it an exploit: a losing player submits a lone
    surrogate and the match is annulled.

    So encoding is total. Unencodable characters become U+FFFD, and the result
    then fails compilation on its own merits as COMPILE_ERROR, which is a
    verdict properly attributable to the submission.
    """
    with open(path, "w", encoding="utf-8", errors="replace", newline="") as handle:
        handle.write(source)


def compile_step(argv, memory_bytes):
    """
    Runs a compiler under its own wall clock and its own memory ceiling.

    Returns (status, message) where status is OK, COMPILE_ERROR,
    COMPILE_TIMEOUT or COMPILE_MEMORY.
    """
    budget = max(64 * 1024 * 1024, memory_bytes - COMPILE_MEMORY_RESERVE)

    def apply():
        set_limit(resource.RLIMIT_CORE, 0)
        # A CPU-seconds ceiling as well as the wall clock: a compile bomb that
        # spins without allocating would otherwise sit at 100% until the wall
        # clock fires, and SIGXCPU cuts that short.
        set_limit(resource.RLIMIT_CPU, MAX_COMPILE_SECONDS)
        os.setsid()

        # Deliberately NO RLIMIT_AS here, unlike the execution path.
        #
        # RLIMIT_AS caps virtual address space, not resident memory, and a
        # modern C++ compiler reserves vastly more VA than it ever resides:
        # a plain `#include <bits/stdc++.h>` blew a 208 MB AS ceiling while
        # using a fraction of that in RSS. Any AS limit tight enough to bound
        # real memory rejects correct programs, which is a worse failure than
        # the one it prevents.
        #
        # The cgroup memory limit is the real containment and it bounds RSS
        # properly. A compile bomb trips it and returns SIGKILL, which
        # compile_step maps to COMPILE_MEMORY. The runner survives because the
        # OOM killer scores by memory used and the compiler is, by a wide
        # margin, the fattest process in the cgroup.

    cpu_before = child_cpu_seconds()
    try:
        proc = subprocess.Popen(
            argv,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            preexec_fn=apply,
            cwd="/tmp",
            env={"PATH": "/usr/bin:/bin", "HOME": "/tmp", "TMPDIR": "/tmp"},
        )
    except OSError as exc:
        return "COMPILE_ERROR", f"could not start compiler: {exc}", 0

    try:
        _, err = proc.communicate(timeout=MAX_COMPILE_SECONDS)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), 9)
        except OSError:
            pass
        proc.kill()
        proc.communicate()
        return (
            "COMPILE_TIMEOUT",
            f"compilation exceeded {MAX_COMPILE_SECONDS}s",
            int((child_cpu_seconds() - cpu_before) * 1000),
        )

    compile_cpu_ms = int((child_cpu_seconds() - cpu_before) * 1000)

    if proc.returncode == 0:
        return "OK", "", compile_cpu_ms

    text = err.decode("utf-8", "replace")
    # SIGKILL from the cgroup, SIGXCPU from RLIMIT_CPU, or a compiler that says
    # it ran out of memory — all of these are resource exhaustion, not a
    # syntax error, and reporting them as COMPILE_ERROR would tell the player
    # their correct code is malformed.
    if proc.returncode in (-9, 137):
        return "COMPILE_MEMORY", "compiler exhausted its memory ceiling", compile_cpu_ms
    if proc.returncode in (-24, 152):
        return (
            "COMPILE_TIMEOUT",
            f"compiler exceeded {MAX_COMPILE_SECONDS}s of CPU",
            compile_cpu_ms,
        )

    lowered = text.lower()
    # g++ is a driver: when the cgroup OOM-kills cc1plus, the driver itself
    # survives and exits non-zero, reporting "Killed signal terminated program
    # cc1plus". Without this the most effective compile bomb in existence gets
    # reported to the player as a syntax error in their own code.
    if (
        "out of memory" in lowered
        or "memory exhausted" in lowered
        or "killed signal terminated" in lowered
        or "internal compiler error: killed" in lowered
    ):
        return "COMPILE_MEMORY", "compiler exhausted its memory ceiling", compile_cpu_ms
    # Compiler diagnostics can themselves be enormous; truncate hard.
    return "COMPILE_ERROR", text[:4000], compile_cpu_ms


def run_once(argv, stdin_data, timeout_s, memory_bytes):
    """
    Returns (verdict, stdout, elapsed_ms).

    Reads the child's stdout incrementally with a hard byte cap rather than via
    communicate(). communicate() buffers everything in memory first, so a
    `while True: print(...)` loop grows the *runner's* heap until the container's
    own cgroup limit kills the runner — the flood is contained, but the judge
    dies with it and reports INTERNAL_ERROR instead of OUTPUT_LIMIT.
    """
    started = time.monotonic()
    cpu_before = child_cpu_seconds()
    try:
        proc = subprocess.Popen(
            argv,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            preexec_fn=limits(memory_bytes),
            cwd="/tmp",
            env={"PATH": "/usr/bin:/bin", "HOME": "/tmp"},
        )
    except OSError:
        return "RUNTIME_ERROR", "", 0, 0

    # Feed stdin from a thread: a large input can fill the pipe buffer and block
    # here forever if the child never reads it.
    def feed():
        try:
            proc.stdin.write(stdin_data.encode())
            proc.stdin.close()
        except OSError:
            pass

    threading.Thread(target=feed, daemon=True).start()

    out = bytearray()
    err = bytearray()
    capped = False
    timed_out = False

    selector = selectors.DefaultSelector()
    selector.register(proc.stdout, selectors.EVENT_READ, "out")
    selector.register(proc.stderr, selectors.EVENT_READ, "err")
    open_streams = 2
    deadline = started + timeout_s

    while open_streams > 0:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            timed_out = True
            break
        for key, _ in selector.select(timeout=min(remaining, 0.05)):
            try:
                chunk = os.read(key.fileobj.fileno(), 65536)
            except OSError:
                chunk = b""
            if not chunk:
                selector.unregister(key.fileobj)
                open_streams -= 1
                continue
            if key.data == "err":
                if len(err) < 8192:
                    err.extend(chunk[: 8192 - len(err)])
                continue
            room = MAX_OUTPUT_BYTES - len(out)
            if room <= 0:
                capped = True
                break
            out.extend(chunk[:room])
            if len(chunk) > room:
                capped = True
                break
        if capped:
            break

    selector.close()

    if timed_out or capped:
        try:
            os.killpg(os.getpgid(proc.pid), 9)
        except OSError:
            pass
        proc.kill()

    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass

    elapsed = int((time.monotonic() - started) * 1000)
    cpu_ms = int((child_cpu_seconds() - cpu_before) * 1000)

    if capped:
        return "OUTPUT_LIMIT", out.decode("utf-8", "replace"), elapsed, cpu_ms
    if timed_out:
        return "TIME_LIMIT", "", elapsed, cpu_ms
    if proc.returncode != 0:
        # -9/137 is SIGKILL, which under a cgroup memory limit is the OOM
        # killer. RLIMIT_AS instead surfaces as a clean MemoryError, which
        # would otherwise be misreported as a plain runtime error.
        if proc.returncode in (-9, 137):
            return "MEMORY_LIMIT", "", elapsed, cpu_ms
        if b"MemoryError" in err:
            return "MEMORY_LIMIT", "", elapsed, cpu_ms
        return "RUNTIME_ERROR", "", elapsed, cpu_ms

    return "OK", out.decode("utf-8", "replace"), elapsed, cpu_ms


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
    total_cpu_ms = 0

    if language == "CPP17":
        src = os.path.join(workdir, "main.cpp")
        binary = os.path.join(workdir, "main")
        try:
            write_source(src, source)
        except Exception as exc:
            emit({
                "kind": "compile-failed",
                "verdict": "COMPILE_ERROR",
                "message": f"source could not be stored: {type(exc).__name__}",
                "cpuMs": 0,
            })
            return
        emit({"kind": "compiling"})
        status, message, compile_cpu = compile_step(
            # -fsigned-char PINS AN ARCHITECTURE DIFFERENCE THAT WOULD OTHERWISE
            # DECIDE MATCHES. Plain `char` is signed on x86-64 and UNSIGNED on
            # AArch64 by default, verified by compiling the same file in both
            # images: `char c = -1; c < 0` is true on x86 and false on ARM.
            #
            # That is not an abstract portability note, it is a submission that
            # passes here and fails on the deployment host. The classic shape is
            # `char c; while ((c = getchar()) != EOF)` — EOF is -1, an unsigned
            # char can never equal it, and the loop runs forever, so a correct
            # solution earns TIME_LIMIT for reasons the player cannot see.
            #
            # Pinning it to signed makes the judge behave identically on every
            # host we might ever run on, and matches the platform competitive
            # programmers overwhelmingly develop against. The alternative —
            # letting the verdict depend on which machine picked up the job — is
            # indistinguishable from cheating from the losing player's side, the
            # same argument §6.9 makes about receipt order.
            ["g++", "-std=c++17", "-O2", "-fsigned-char", "-o", binary, src],
            memory_bytes,
        )
        total_cpu_ms += compile_cpu
        if status != "OK":
            emit({
                "kind": "compile-failed",
                "verdict": status,
                "message": message,
                "cpuMs": total_cpu_ms,
            })
            return
        argv = [binary]
    elif language == "PYTHON3":
        src = os.path.join(workdir, "main.py")
        try:
            write_source(src, source)
        except Exception as exc:
            emit({
                "kind": "compile-failed",
                "verdict": "COMPILE_ERROR",
                "message": f"source could not be stored: {type(exc).__name__}",
                "cpuMs": 0,
            })
            return
        # Syntax-check up front so a typo reports COMPILE_ERROR rather than
        # failing every test case identically.
        emit({"kind": "compiling"})
        status, message, compile_cpu = compile_step(
            [
                sys.executable,
                "-c",
                "import py_compile,sys; py_compile.compile(sys.argv[1], doraise=True)",
                src,
            ],
            memory_bytes,
        )
        total_cpu_ms += compile_cpu
        if status != "OK":
            emit({
                "kind": "compile-failed",
                "verdict": status,
                "message": message,
                "cpuMs": total_cpu_ms,
            })
            return
        argv = [sys.executable, src]
    else:
        emit({"kind": "error", "message": f"unsupported language {language}"})
        return

    emit({"kind": "running", "total": len(tests)})

    for test in tests:
        status, out, elapsed, cpu_ms = run_once(argv, test["input"], time_limit, memory_bytes)
        total_cpu_ms += cpu_ms
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
                "cpuMs": cpu_ms,
            }
        )
        if verdict != "ACCEPTED":
            emit({"kind": "cpu", "totalCpuMs": total_cpu_ms})
            # Stop at the first failure: the verdict is decided and continuing
            # only burns judge capacity.
            break


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:  # noqa: BLE001 — the runner must never crash silently
        emit({"kind": "error", "message": f"{type(exc).__name__}: {exc}"[:500]})
