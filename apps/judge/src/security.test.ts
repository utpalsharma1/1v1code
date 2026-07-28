/* ============================================================================
   Judge containment suite

   Every claim in §11 gets a test that actually attempts the escape. A sandbox
   whose guarantees were only ever read off a flag list is a sandbox nobody has
   checked — flags get reordered, a `--memory-swap` gets dropped, an image gets
   rebuilt from a different base, and the list still looks right.

   Run with:  pnpm --filter @1v1/judge test
   Requires Docker and both judge images. Skips loudly, never silently, if the
   daemon is unreachable — a security suite that quietly passes when it did not
   run is worse than no suite.
   ========================================================================= */

import assert from "node:assert/strict";
import test, { before, describe } from "node:test";
import { dockerAvailable, runSandboxed } from "./sandbox.ts";

const IMAGE = "1v1-judge-python3";
const MEM = 256;

let available = false;

before(async () => {
  available = await dockerAvailable();
  if (!available) {
    console.error("\n  !! DOCKER UNREACHABLE — containment was NOT verified.\n");
  }
});

/** Runs a Python program inside the sandbox and returns everything observed. */
async function attempt(program: string, wallClockMs = 20_000) {
  return runSandboxed(
    { image: IMAGE, memoryLimitMb: MEM, wallClockMs, entrypoint: ["python3", "-c", program] },
    "",
  );
}

describe("§11 containment", () => {
  test("network is unreachable", async (t) => {
    if (!available) return t.skip("docker unavailable");
    const result = await attempt(`
import socket, sys
socket.setdefaulttimeout(4)
try:
    s = socket.create_connection(("1.1.1.1", 53), timeout=4)
    print("ESCAPED: connected")
except Exception as e:
    print("CONTAINED:", type(e).__name__)
`);
    assert.match(result.stdout, /CONTAINED/, `network was reachable: ${result.stdout}`);
    assert.doesNotMatch(result.stdout, /ESCAPED/);
  });

  test("dns does not resolve", async (t) => {
    if (!available) return t.skip("docker unavailable");
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

  test("fork bomb hits the pid limit", async (t) => {
    if (!available) return t.skip("docker unavailable");
    // 64 pids. A bomb must fail to allocate long before it can wedge the host.
    const result = await attempt(
      `
import os
made = 0
try:
    for _ in range(500):
        pid = os.fork()
        if pid == 0:
            os._exit(0)
        made += 1
except OSError as e:
    print("CONTAINED after", made, type(e).__name__)
else:
    print("ESCAPED: forked", made)
`,
      20_000,
    );
    assert.match(result.stdout, /CONTAINED/, `fork bomb was not capped: ${result.stdout}`);
    const made = Number(/CONTAINED after (\d+)/.exec(result.stdout)?.[1] ?? "999");
    assert.ok(made < 200, `pid limit far too loose: ${made} forks succeeded`);
  });

  test("memory exhaustion is capped near the limit", async (t) => {
    if (!available) return t.skip("docker unavailable");
    // Allocate in 32MB chunks well past the 256MB cap. Either the allocation
    // raises or the OOM killer takes it; both are containment. Running to
    // completion is not.
    const result = await attempt(`
blocks = []
try:
    for i in range(64):
        blocks.append(bytearray(32 * 1024 * 1024))
    print("ESCAPED: allocated", len(blocks) * 32, "MB")
except MemoryError:
    print("CONTAINED: MemoryError at", len(blocks) * 32, "MB")
`);
    const escaped = /ESCAPED/.test(result.stdout);
    assert.ok(
      !escaped,
      `allocated past the cgroup limit: ${result.stdout}`,
    );
    // An OOM kill produces no stdout and a non-zero exit — also containment.
    assert.ok(
      /CONTAINED/.test(result.stdout) || result.exitCode !== 0,
      `neither MemoryError nor OOM kill: exit=${result.exitCode} out=${result.stdout}`,
    );
  });

  test("infinite loop is killed by the wall clock", async (t) => {
    if (!available) return t.skip("docker unavailable");
    const started = Date.now();
    const result = await attempt(`
while True:
    pass
`, 6_000);
    const elapsed = Date.now() - started;
    assert.ok(result.timedOut, "wall clock did not fire");
    assert.ok(elapsed < 20_000, `took ${elapsed}ms to kill a spin loop`);
  });

  test("unbounded stdout is capped", async (t) => {
    if (!available) return t.skip("docker unavailable");
    const result = await attempt(`
import sys
line = "A" * 4096 + "\\n"
while True:
    sys.stdout.write(line)
`, 30_000);
    assert.ok(result.outputCapped, "output cap did not trigger");
    assert.ok(
      result.stdout.length <= 1024 * 1024 + 65_536,
      `captured ${result.stdout.length} bytes past the cap`,
    );
  });

  test("rootfs is read-only", async (t) => {
    if (!available) return t.skip("docker unavailable");
    const result = await attempt(`
paths = ["/x", "/etc/x", "/usr/x", "/opt/x", "/home/runner/x"]
escaped = []
for p in paths:
    try:
        open(p, "w").write("x")
        escaped.append(p)
    except OSError:
        pass
print("ESCAPED:" + ",".join(escaped) if escaped else "CONTAINED: rootfs read-only")
`);
    assert.match(result.stdout, /CONTAINED/, `wrote to the rootfs: ${result.stdout}`);
  });

  test("tmpfs is writable but size-capped", async (t) => {
    if (!available) return t.skip("docker unavailable");
    // /tmp must work — a C++ binary has to compile somewhere — but it must not
    // be a route to filling the host disk.
    const result = await attempt(`
try:
    with open("/tmp/probe", "wb") as f:
        f.write(b"ok")
    print("WRITABLE")
except OSError as e:
    print("BROKEN:", e)
try:
    with open("/tmp/big", "wb") as f:
        for _ in range(400):
            f.write(b"A" * (1024 * 1024))
    print("ESCAPED: wrote 400MB")
except OSError as e:
    print("CONTAINED:", type(e).__name__)
`);
    assert.match(result.stdout, /WRITABLE/, "tmpfs is not writable — C++ cannot compile");
    assert.match(result.stdout, /CONTAINED/, `tmpfs was not size-capped: ${result.stdout}`);
  });

  test("process runs as non-root with no capabilities", async (t) => {
    if (!available) return t.skip("docker unavailable");
    const result = await attempt(`
import os
print("uid", os.getuid(), "gid", os.getgid())
try:
    caps = open("/proc/self/status").read()
    line = [l for l in caps.splitlines() if l.startswith("CapEff")][0]
    print(line)
except Exception as e:
    print("capcheck failed", e)
`);
    assert.match(result.stdout, /uid 1000/, `not running as uid 1000: ${result.stdout}`);
    assert.doesNotMatch(result.stdout, /uid 0\b/);
    const cap = /CapEff:\s*([0-9a-f]+)/.exec(result.stdout)?.[1];
    if (cap) {
      assert.equal(BigInt(`0x${cap}`), 0n, `effective capabilities not empty: ${cap}`);
    }
  });

  test("docker socket is not reachable", async (t) => {
    if (!available) return t.skip("docker unavailable");
    const result = await attempt(`
import os
print("ESCAPED" if os.path.exists("/var/run/docker.sock") else "CONTAINED: no socket")
`);
    assert.match(result.stdout, /CONTAINED/, "docker socket is mounted into the sandbox");
  });
});
