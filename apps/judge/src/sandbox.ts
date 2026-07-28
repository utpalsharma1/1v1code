/* ============================================================================
   The sandbox (§11)

   Every containment flag lives here, in one list, so there is exactly one place
   to audit and exactly one place for a regression to hide. apps/judge/src/
   security.test.ts attempts to break each one.

   Nothing is bind-mounted. The job goes in over stdin and results come back on
   stdout, which removes mount-based escapes from the design and avoids
   Windows/WSL2 path translation entirely.
   ========================================================================= */

import { spawn } from "node:child_process";
import type { JudgeJob } from "@1v1/proto";

/**
 * Elapsed-time source. Never `Date.now()`.
 *
 * The system clock is not monotonic and on this host it demonstrably is not:
 * WSL2 was measured stepping backward 2514ms inside a 20-second window, which
 * made a container that ran for 6.4 real seconds report 3.8. Every duration in
 * the judge — a test's runtime, a wall-clock decision, and in Phase 2B a match's
 * elapsed time, which is the tiebreak — has to come from a clock that only ever
 * moves forward. Use Date.now() for "what time is it", never for "how long".
 */
export const monotonicMs = (): number => Number(process.hrtime.bigint() / 1_000_000n);

/** Every judge container carries this so the reaper can find orphans. */
export const JUDGE_LABEL = "com.1v1.judge=1";

export const IMAGES: Record<JudgeJob["language"], string> = {
  CPP17: "1v1-judge-cpp17",
  PYTHON3: "1v1-judge-python3",
};

/** Overall container lifetime. Per-test limits are enforced by the runner. */
export const CONTAINER_WALL_CLOCK_MS = 60_000;
/** Hard cap on bytes read from the container's stdout. */
export const MAX_STDOUT_BYTES = 1024 * 1024;

export interface SandboxOptions {
  image: string;
  memoryLimitMb: number;
  /** Milliseconds. The worker kills the container at this point regardless. */
  wallClockMs?: number;
  /** Extra args, used only by the security tests. */
  extraArgs?: string[];
  /** Overrides the image entrypoint. Security tests only. */
  entrypoint?: string[];
}

/**
 * The §11 flag set, plus four additions that §11 doesn't name but that a
 * sandbox running hostile code has no business omitting:
 *
 *   --cap-drop ALL              nothing needs a capability to run a solution
 *   --security-opt no-new-privileges
 *                               blocks setuid escalation inside the container
 *   --memory-swap = --memory    without this Docker grants swap equal to the
 *                               memory limit, so "256m" silently means 512m
 *   --ulimit / --pids-limit     a second ceiling under the cgroup's
 *
 * `--tmpfs /tmp:exec` is deliberate: a compiled binary must run from somewhere,
 * and the process is executing attacker code by definition. `noexec` there
 * would only break C++ without removing any capability the attacker lacks.
 */
export function dockerArgs(opts: SandboxOptions): string[] {
  const memory = `${opts.memoryLimitMb}m`;
  return [
    "run",
    "--rm",
    "--interactive",

    // How the reaper finds us. A name prefix would work until someone renames
    // a container; a label is part of the contract.
    "--label", JUDGE_LABEL,

    // §11
    "--network", "none",
    "--memory", memory,
    "--memory-swap", memory,
    "--cpus", "0.5",
    "--pids-limit", "64",
    "--read-only",
    "--user", "1000:1000",

    // Additions
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    "--ulimit", "nofile=64:64",
    "--ulimit", "fsize=8388608:8388608",
    "--ulimit", "core=0:0",

    // NOT `--ulimit nproc`. RLIMIT_NPROC is per-UID and system-wide — it is not
    // namespaced by the container. With `--user 1000:1000` on a host whose own
    // login user is also uid 1000, the host's processes count against the
    // container's allowance and `exec` fails outright with EAGAIN before any
    // code runs. `--pids-limit` above is the cgroup-scoped equivalent and is
    // the correct tool; nproc here was redundant and actively broke the box.

    // The single writable location, capped and owned by the runner user.
    "--tmpfs", "/tmp:rw,exec,nosuid,nodev,size=64m,mode=1777",

    // Nothing should be reachable even if the network namespace leaked.
    "--dns", "0.0.0.0",

    ...(opts.entrypoint ? ["--entrypoint", opts.entrypoint[0]!] : []),
    ...(opts.extraArgs ?? []),
    opts.image,
    ...(opts.entrypoint ? opts.entrypoint.slice(1) : []),
  ];
}

export interface SandboxResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  /** True when the worker killed it for exceeding the wall clock. */
  timedOut: boolean;
  /** True when stdout hit MAX_STDOUT_BYTES and the container was killed. */
  outputCapped: boolean;
  durationMs: number;
}

/**
 * Runs one container to completion.
 *
 * Docker has no "kill after N seconds" flag — `--stop-timeout` only affects
 * `docker stop`. The wall clock has to be enforced here, and it is, with a
 * `docker kill` rather than a signal to the CLI process, because killing the
 * client leaves the container running.
 */
export function runSandboxed(
  opts: SandboxOptions,
  stdin: string,
  onLine?: (line: string) => void,
): Promise<SandboxResult> {
  const containerName = `1v1-judge-${Math.random().toString(36).slice(2, 12)}`;
  const args = dockerArgs(opts);
  args.splice(1, 0, "--name", containerName);

  const started = monotonicMs();

  return new Promise<SandboxResult>((resolve) => {
    const child = spawn("docker", args, { windowsHide: true });

    let stdout = "";
    let stderr = "";
    let pending = "";
    let bytes = 0;
    let timedOut = false;
    let outputCapped = false;
    let settled = false;

    const kill = () => {
      // Kill the container, not the CLI: killing the client orphans the
      // container and it keeps burning CPU.
      spawn("docker", ["kill", containerName], { windowsHide: true }).on("error", () => {});
    };

    const wallClock = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.wallClockMs ?? CONTAINER_WALL_CLOCK_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_STDOUT_BYTES) {
        if (!outputCapped) {
          outputCapped = true;
          kill();
        }
        return;
      }
      const text = chunk.toString("utf8");
      stdout += text;
      if (!onLine) return;
      pending += text;
      let index = pending.indexOf("\n");
      while (index !== -1) {
        const line = pending.slice(0, index).trim();
        pending = pending.slice(index + 1);
        if (line) onLine(line);
        index = pending.indexOf("\n");
      }
    });

    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < 16_384) stderr += chunk.toString("utf8");
    });

    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(wallClock);
      resolve({
        stdout,
        stderr,
        exitCode,
        timedOut,
        outputCapped,
        durationMs: monotonicMs() - started,
      });
    };

    child.on("error", (error) => {
      stderr += `\n${error.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));

    child.stdin.on("error", () => {});
    child.stdin.write(stdin);
    child.stdin.end();
  });
}

/** Does this machine have a usable Docker daemon? */
export async function dockerAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["info", "--format", "{{.ServerVersion}}"], {
      windowsHide: true,
    });
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
  });
}
