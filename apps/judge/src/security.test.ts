/* ============================================================================
   Judge containment suite

   Every claim in section 11 gets a test that actually attempts the escape.

   TWO RULES, both learned the hard way.

   1. POSITIVE CONTROL FIRST. This suite once passed ten of ten while the
      sandbox could not execute a single instruction: `--ulimit nproc` made
      every `exec` fail with EAGAIN, so every container produced no output, and
      "no escape was observed" is trivially true of a container that never ran.
      A canary now runs before anything else and the whole suite goes VOID if it
      fails, because a green tick on meaningless results is worse than a red one.

   2. ASSERT THE MECHANISM, NOT THE ABSENCE. "The fork bomb did not escape" is
      satisfied by a container that never forked. "The fork bomb hit the pids
      ceiling at 63" is not. Each test below checks that the specific machinery
      fired — a ceiling reached, an exit code of 137, an OUTPUT_LIMIT verdict.
      Absence of a bad outcome is not evidence of containment.

   Run with:  pnpm --filter @1v1/judge test
   ========================================================================= */

import assert from "node:assert/strict";
import test, { before, describe } from "node:test";
import { dockerAvailable, monotonicMs, runSandboxed } from "./sandbox.ts";

const PY = "1v1-judge-python3";
const CPP = "1v1-judge-cpp17";
const MEM = 256;

const VOID_BANNER = `
==============================================================================
  CONTAINMENT SUITE VOID

  The positive control failed: the sandbox could not run a trivial program.
  No containment result can be trusted, because "nothing escaped" is trivially
  true of a container that never executed anything.

  Fix execution first, then re-run. Do not read this as a pass.
==============================================================================
`;

async function attempt(program: string, wallClockMs = 20_000, image = PY) {
  return runSandboxed(
    { image, memoryLimitMb: MEM, wallClockMs, entrypoint: ["python3", "-c", program] },
    "",
  );
}

/* ── Positive control ─────────────────────────────────────────────────── */

interface Canary {
  image: string;
  ok: boolean;
  detail: string;
}

const canaries: Canary[] = [];

/** A trivial program that must produce known output inside known limits. */
async function canary(image: string, entrypoint: string[], expect: string): Promise<Canary> {
  try {
    const result = await runSandboxed(
      { image, memoryLimitMb: MEM, wallClockMs: 30_000, entrypoint },
      "",
    );
    const got = result.stdout.trim();
    if (got === expect) return { image, ok: true, detail: `produced "${got}"` };
    return {
      image,
      ok: false,
      detail: `expected "${expect}", got "${got || "(nothing)"}" — stderr: ${
        result.stderr.trim().slice(0, 300) || "(none)"
      }`,
    };
  } catch (error) {
    return { image, ok: false, detail: `threw ${String(error)}` };
  }
}

before(async () => {
  if (!(await dockerAvailable())) {
    console.error(VOID_BANNER);
    throw new Error("VOID: Docker daemon unreachable — containment NOT verified");
  }

  // Python image: interpreter runs, arithmetic works, stdout reaches us.
  canaries.push(await canary(PY, ["python3", "-c", "print(6*7)"], "42"));

  // C++ image: the toolchain compiles into the exec-mounted tmpfs and the
  // binary runs. This canary would have caught both the nproc bug and the
  // python3-minimal bug on the C++ side.
  canaries.push(
    await canary(
      CPP,
      [
        "sh",
        "-c",
        'printf "#include <cstdio>\\nint main(){std::printf(\\"42\\");}" > /tmp/c.cpp && g++ -std=c++17 -o /tmp/c /tmp/c.cpp && /tmp/c',
      ],
      "42",
    ),
  );

  for (const c of canaries) {
    console.error(`  canary ${c.ok ? "OK  " : "FAIL"} ${c.image}: ${c.detail}`);
  }
  const failed = canaries.filter((c) => !c.ok);
  if (failed.length > 0) {
    console.error(VOID_BANNER);
    throw new Error(`VOID: ${failed.length} canary failure(s) — results are meaningless`);
  }
});

/* ── Containment ──────────────────────────────────────────────────────── */

describe("section 11 containment", () => {
  test("positive control executed and produced correct output", () => {
    assert.equal(canaries.length, 2, "positive control did not run");
    for (const c of canaries) assert.ok(c.ok, `${c.image}: ${c.detail}`);
  });

  test("network is unreachable", async () => {
    const result = await attempt(`
import socket
socket.setdefaulttimeout(4)
try:
    socket.create_connection(("1.1.1.1", 53), timeout=4)
    print("ESCAPED: connected")
except Exception as e:
    print("CONTAINED:", type(e).__name__)
`);
    assert.match(result.stdout, /CONTAINED/, `network reachable: ${result.stdout}`);
    assert.doesNotMatch(result.stdout, /ESCAPED/);
  });

  test("dns does not resolve", async () => {
    const result = await attempt(`
import socket
socket.setdefaulttimeout(4)
try:
    print("ESCAPED:", socket.gethostbyname("example.com"))
except Exception as e:
    print("CONTAINED:", type(e).__name__)
`);
    assert.match(result.stdout, /CONTAINED/, `dns resolved: ${result.stdout}`);
  });

  test("fork bomb reaches the pids ceiling", async () => {
    const result = await attempt(`
import os
made = 0
try:
    for _ in range(500):
        if os.fork() == 0:
            os._exit(0)
        made += 1
except OSError as e:
    print("CONTAINED", made, type(e).__name__)
else:
    print("ESCAPED", made)
`);
    assert.match(result.stdout, /CONTAINED/, `not capped: ${result.stdout}`);
    const made = Number(/CONTAINED (\d+)/.exec(result.stdout)?.[1] ?? "-1");
    // MECHANISM: the ceiling must actually have been reached. A container that
    // cannot fork at all reports 0 and would pass a bare "did not escape" check.
    assert.ok(made > 8, `pid ceiling never reached — only ${made} forks succeeded`);
    assert.ok(made < 200, `pid ceiling far too loose: ${made} forks`);
  });

  test("memory exhaustion is stopped by a limit that fired", async () => {
    const result = await attempt(`
b = []
try:
    for i in range(64):
        b.append(bytearray(32 * 1024 * 1024))
    print("ESCAPED", len(b) * 32)
except MemoryError:
    print("CONTAINED MemoryError", len(b) * 32)
`);
    assert.doesNotMatch(result.stdout, /ESCAPED/, `allocated past the cap: ${result.stdout}`);
    // MECHANISM: either the OOM killer fired (137) or RLIMIT_AS raised
    // MemoryError. A clean exit 0 with no output would mean nothing ran.
    const killed = result.exitCode === 137 || result.exitCode === 1;
    const raised = /CONTAINED MemoryError/.test(result.stdout);
    assert.ok(
      killed || raised,
      `neither OOM kill nor MemoryError: exit=${result.exitCode} out=${JSON.stringify(result.stdout)}`,
    );
  });

  test("infinite loop is killed by the wall clock", async () => {
    const started = monotonicMs();
    const result = await attempt("while True: pass", 6_000);
    const elapsed = monotonicMs() - started;
    assert.ok(result.timedOut, "wall clock did not fire");
    // MECHANISM: it must have actually spun for the budget. A container that
    // died instantly would also report "no escape".
    assert.ok(elapsed >= 5_000, `returned in ${elapsed}ms — the loop cannot have run`);
    assert.ok(elapsed < 20_000, `took ${elapsed}ms to kill a spin loop`);
  });

  test("unbounded stdout is capped", async () => {
    const result = await attempt(
      `
import sys
line = "A" * 4096 + "\\n"
while True:
    sys.stdout.write(line)
`,
      30_000,
    );
    // MECHANISM: the cap is what stopped it, and real output got through first.
    assert.ok(result.outputCapped, "output cap did not trigger");
    assert.ok(result.stdout.length > 128 * 1024, "far too little output — did it run?");
    assert.ok(
      result.stdout.length <= 1024 * 1024 + 65_536,
      `captured ${result.stdout.length} bytes past the cap`,
    );
  });

  test("compile bomb is contained by the compile budget", async () => {
    // A compiler is an arbitrary-computation engine, and its work happens
    // before a single line of the program runs — so the execution limit never
    // sees it. Preprocessor token explosion is the cheapest demonstration:
    // eight-fold expansion nested four deep is ~16M tokens from five lines.
    const bomb = [
      "#define A(x) x x x x x x x x",
      "#define B(x) A(A(x))",
      "#define C(x) B(B(x))",
      "#define E(x) C(C(x))",
      "int main(){ E(int a;) return 0; }",
    ].join("\n");

    const started = monotonicMs();
    const result = await runSandboxed(
      { image: CPP, memoryLimitMb: MEM, wallClockMs: 90_000 },
      JSON.stringify({
        language: "CPP17",
        source: bomb,
        tests: [{ ordinal: 0, input: "", expected: "x" }],
        timeLimitMs: 5000,
        memoryLimitMb: MEM,
      }),
    );
    const elapsed = monotonicMs() - started;

    // MECHANISM: a compile-class verdict must come back, promptly, and the
    // runner must survive to report it. An unbounded compiler is a denial of
    // service that the execution limit is structurally unable to catch.
    assert.ok(
      elapsed < 40_000,
      `compile bomb ran ${elapsed}ms — the compile budget did not contain it`,
    );
    assert.match(
      result.stdout,
      /"kind":"compile-failed"/,
      `no compile verdict returned — did the runner die? ${result.stdout.slice(0, 300)}`,
    );
    assert.match(
      result.stdout,
      /COMPILE_MEMORY|COMPILE_TIMEOUT/,
      `resource exhaustion was misreported as a syntax error: ${result.stdout.slice(0, 300)}`,
    );
  });

  test("a legitimate heavy include still compiles", async () => {
    // The counterpart to the bomb: the budget must not be so tight that
    // correct code is rejected. #include <bits/stdc++.h> is the standard
    // competitive-programming header and it is genuinely expensive.
    const result = await runSandboxed(
      { image: CPP, memoryLimitMb: MEM, wallClockMs: 60_000 },
      JSON.stringify({
        language: "CPP17",
        source:
          "#include <bits/stdc++.h>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b;}\n",
        tests: [{ ordinal: 0, input: "2 3\n", expected: "5" }],
        timeLimitMs: 5000,
        memoryLimitMb: MEM,
      }),
    );
    assert.match(
      result.stdout,
      /"verdict":"ACCEPTED"/,
      `heavy but legitimate compile was rejected: ${result.stdout.slice(0, 400)}`,
    );
  });

  test("rootfs is read-only", async () => {
    const result = await attempt(`
escaped = []
for p in ["/x", "/etc/x", "/usr/x", "/opt/x", "/home/runner/x"]:
    try:
        open(p, "w").write("x"); escaped.append(p)
    except OSError:
        pass
print("ESCAPED:" + ",".join(escaped) if escaped else "CONTAINED rootfs read-only")
`);
    assert.match(result.stdout, /CONTAINED/, `wrote to rootfs: ${result.stdout}`);
  });

  test("tmpfs is writable but size- and fsize-capped", async () => {
    const result = await attempt(`
try:
    open("/tmp/probe", "wb").write(b"ok"); print("WRITABLE")
except OSError as e:
    print("BROKEN", e)

# RLIMIT_FSIZE is per-process, so unlike RLIMIT_NPROC it is safe here. Verify
# rather than assume — that distinction is the whole lesson of the nproc bug.
import signal
signal.signal(signal.SIGXFSZ, signal.SIG_IGN)
try:
    with open("/tmp/big", "wb") as f:
        for _ in range(400):
            f.write(b"A" * (1024 * 1024)); f.flush()
    print("ESCAPED wrote 400MB")
except OSError as e:
    print("CONTAINED", type(e).__name__)
`);
    assert.match(result.stdout, /WRITABLE/, "tmpfs not writable — C++ could not compile");
    assert.match(result.stdout, /CONTAINED/, `tmpfs/fsize not capped: ${result.stdout}`);
  });

  test("nofile is capped without breaking execution", async () => {
    const result = await attempt(`
opened = []
try:
    for i in range(500):
        opened.append(open("/tmp/probe_%d" % i, "w"))
    print("ESCAPED", len(opened))
except OSError as e:
    print("CONTAINED", len(opened), type(e).__name__)
`);
    assert.match(result.stdout, /CONTAINED/, `nofile not capped: ${result.stdout}`);
    const opened = Number(/CONTAINED (\d+)/.exec(result.stdout)?.[1] ?? "-1");
    // MECHANISM: files must have opened before the limit bit. Zero would be the
    // nproc failure mode wearing a different costume.
    assert.ok(opened > 0, "could not open a single file — the limit is breaking execution");
    assert.ok(opened < 200, `nofile ceiling too loose: ${opened}`);
  });

  test("process runs as non-root with no capabilities", async () => {
    const result = await attempt(`
import os
print("uid", os.getuid(), "gid", os.getgid())
print([l for l in open("/proc/self/status") if l.startswith("CapEff")][0].strip())
`);
    assert.match(result.stdout, /uid 1000/, `not uid 1000: ${result.stdout}`);
    const cap = /CapEff:\s*([0-9a-f]+)/.exec(result.stdout)?.[1];
    assert.ok(cap, "could not read CapEff — did the process run?");
    assert.equal(BigInt(`0x${cap}`), 0n, `capabilities not empty: ${cap}`);
  });

  test("docker socket is not reachable", async () => {
    const result = await attempt(`
import os
print("ESCAPED" if os.path.exists("/var/run/docker.sock") else "CONTAINED no socket")
`);
    assert.match(result.stdout, /CONTAINED/, "docker socket mounted into sandbox");
  });
});

/* ── The INTERNAL_ERROR invariant ─────────────────────────────────────────

   NO INPUT, HOWEVER MALFORMED, MAY CAUSE THE JUDGE TO REPORT INTERNAL_ERROR.

   This is a security invariant, not a robustness one. §6.9 makes a lost verdict
   a no-contest — VOID, no rating change — so a submission that can provoke
   INTERNAL_ERROR is a submission that voids any match its author is about to
   lose. The print-flood bug did exactly that before it was fixed.

   Every judge failure must resolve to a verdict attributable to the submission:
   COMPILE_ERROR, COMPILE_TIMEOUT, COMPILE_MEMORY, RUNTIME_ERROR, TIME_LIMIT,
   MEMORY_LIMIT, OUTPUT_LIMIT or WRONG_ANSWER. Never INTERNAL_ERROR, and never
   silence — silence becomes INTERNAL_ERROR one layer up.
   ───────────────────────────────────────────────────────────────────────── */

interface JobOutcome {
  verdicts: string[];
  sawInternalError: boolean;
  producedSomething: boolean;
  raw: string;
}

/** Runs a full job through the real runner protocol, as the worker would. */
async function runJob(
  language: "PYTHON3" | "CPP17",
  source: string,
  tests: { ordinal: number; input: string; expected: string }[] = [
    { ordinal: 0, input: "1 2\n", expected: "3" },
  ],
): Promise<JobOutcome> {
  const image = language === "CPP17" ? CPP : PY;
  const result = await runSandboxed(
    { image, memoryLimitMb: MEM, wallClockMs: 60_000 },
    JSON.stringify({ language, source, tests, timeLimitMs: 5000, memoryLimitMb: MEM }),
  );

  const verdicts: string[] = [];
  let sawInternalError = false;
  for (const line of result.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const event = JSON.parse(trimmed) as Record<string, unknown>;
      if (event["kind"] === "error") sawInternalError = true;
      const verdict = event["verdict"];
      if (typeof verdict === "string") verdicts.push(verdict);
    } catch {
      // Unparseable output from the runner would become INTERNAL_ERROR in the
      // worker, so it counts as a failure of this invariant too.
      sawInternalError = true;
    }
  }
  return {
    verdicts,
    sawInternalError,
    producedSomething: result.stdout.trim().length > 0,
    raw: result.stdout.slice(0, 300),
  };
}

const REAL_VERDICTS = new Set([
  "ACCEPTED",
  "WRONG_ANSWER",
  "TIME_LIMIT",
  "MEMORY_LIMIT",
  "RUNTIME_ERROR",
  "COMPILE_ERROR",
  "COMPILE_TIMEOUT",
  "COMPILE_MEMORY",
  "OUTPUT_LIMIT",
]);

function assertAttributable(name: string, outcome: JobOutcome): void {
  assert.ok(
    !outcome.sawInternalError,
    `${name}: judge reported an internal error — this VOIDS matches (${outcome.raw})`,
  );
  assert.ok(
    outcome.producedSomething,
    `${name}: judge produced nothing, which becomes INTERNAL_ERROR upstream`,
  );
  assert.ok(
    outcome.verdicts.some((v) => REAL_VERDICTS.has(v)),
    `${name}: no verdict attributable to the submission — got ${JSON.stringify(outcome.verdicts)}`,
  );
}

describe("INTERNAL_ERROR is unreachable from user code", () => {
  test("binary garbage as source", async () => {
    const garbage = Array.from({ length: 400 }, (_, i) => String.fromCharCode((i * 7) % 65535)).join("");
    assertAttributable("binary garbage", await runJob("PYTHON3", garbage));
  });

  test("source containing null bytes", async () => {
    assertAttributable("null bytes", await runJob("PYTHON3", "print(1)\u0000\u0000\nprint(2)\n"));
  });

  test("source containing lone surrogates (invalid UTF-16 pairs)", async () => {
    assertAttributable("lone surrogate", await runJob("PYTHON3", "print('\ud800')\n"));
  });

  test("enormous single-line source", async () => {
    // One line, no newlines, near the protocol's 256 KB source cap.
    const huge = `x = ${"1+".repeat(60_000)}1\nprint(0)\n`;
    assertAttributable("enormous single line", await runJob("PYTHON3", huge));
  });

  test("enormous single-line C++ source", async () => {
    const huge = `int main(){long x=${"1+".repeat(40_000)}1;return 0;}\n`;
    assertAttributable("enormous single line c++", await runJob("CPP17", huge));
  });

  test("gigantic but valid output", async () => {
    // Valid output, just far past the cap. Must be OUTPUT_LIMIT, not a crash.
    const outcome = await runJob("PYTHON3", 'import sys\nsys.stdout.write("A" * 40_000_000)\n');
    assertAttributable("gigantic valid output", outcome);
    assert.ok(
      outcome.verdicts.includes("OUTPUT_LIMIT") || outcome.verdicts.includes("WRONG_ANSWER"),
      `expected OUTPUT_LIMIT, got ${JSON.stringify(outcome.verdicts)}`,
    );
  });

  test("gigantic compiler diagnostics", async () => {
    // Thousands of distinct errors: the compiler's own stderr becomes the
    // payload. Truncation happens in compile_step; without it this is a
    // memory blow-up inside the runner.
    const many = Array.from({ length: 4000 }, (_, i) => `undefined_symbol_${i} zzz${i};`).join("\n");
    const outcome = await runJob("CPP17", `${many}\nint main(){return 0;}\n`);
    assertAttributable("gigantic diagnostics", outcome);
    assert.ok(
      outcome.verdicts.some((v) => v.startsWith("COMPILE_")),
      `expected a COMPILE_* verdict, got ${JSON.stringify(outcome.verdicts)}`,
    );
  });

  test("the print flood that once produced INTERNAL_ERROR", async () => {
    // Regression: this exact input killed the runner by buffering the flood in
    // memory, and the worker reported INTERNAL_ERROR. That was an exploitable
    // match-voider, not just a robustness bug.
    const outcome = await runJob(
      "PYTHON3",
      'import sys\nline = "A" * 4096 + "\\n"\nwhile True:\n    sys.stdout.write(line)\n',
    );
    assertAttributable("print flood", outcome);
    assert.ok(
      outcome.verdicts.includes("OUTPUT_LIMIT"),
      `expected OUTPUT_LIMIT, got ${JSON.stringify(outcome.verdicts)}`,
    );
  });

  test("a program that closes its own stdout", async () => {
    // If the runner assumes stdout stays open, this is an unhandled exception.
    assertAttributable(
      "closed stdout",
      await runJob("PYTHON3", "import os, sys\nos.close(1)\nsys.exit(0)\n"),
    );
  });

  test("a program that kills its own process group", async () => {
    assertAttributable(
      "self-signal",
      await runJob("PYTHON3", "import os, signal\nos.killpg(os.getpgid(0), signal.SIGKILL)\n"),
    );
  });

  test("empty source", async () => {
    assertAttributable("empty source", await runJob("PYTHON3", ""));
  });

  test("source that is only a null byte", async () => {
    assertAttributable("null-only source", await runJob("PYTHON3", "\u0000"));
  });
});
