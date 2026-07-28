/* ============================================================================
   Orphan reaper

   Runs as its own process, on purpose. The worker already kills a container
   when its wall clock expires — but that only helps if the worker is alive to
   do it. If the worker crashes, is OOM-killed, or is stopped mid-job, every
   container it started keeps running: pinned to half a core each, holding
   256 MB each, forever. Nothing else in the system would ever notice.

   So the reaper does not import the worker, share its lifecycle, or depend on
   its state. It asks Docker directly what is running and kills anything older
   than the maximum any legitimate job could take.

   Run alongside the worker:  pnpm --filter @1v1/judge reaper
   ========================================================================= */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { JUDGE_LABEL } from "./sandbox.ts";

const run = promisify(execFile);

/** Anything older than this cannot be a live job — the worker's own ceiling is
 *  well under it, so a survivor is by definition an orphan. */
const MAX_AGE_MS = Number(process.env["JUDGE_REAP_AGE_MS"] ?? "30000");
const INTERVAL_MS = Number(process.env["JUDGE_REAP_INTERVAL_MS"] ?? "10000");

interface Orphan {
  id: string;
  ageMs: number;
}

async function findOrphans(): Promise<Orphan[]> {
  const { stdout } = await run("docker", [
    "ps",
    "--filter",
    `label=${JUDGE_LABEL}`,
    "--format",
    "{{.ID}} {{.CreatedAt}}",
  ]);

  const now = Date.now();
  const orphans: Orphan[] = [];

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const spaceAt = trimmed.indexOf(" ");
    if (spaceAt === -1) continue;
    const id = trimmed.slice(0, spaceAt);
    const created = Date.parse(trimmed.slice(spaceAt + 1).replace(/ [A-Z]{2,5}$/, ""));
    if (Number.isNaN(created)) continue;
    const ageMs = now - created;
    if (ageMs > MAX_AGE_MS) orphans.push({ id, ageMs });
  }

  return orphans;
}

export async function reapOnce(): Promise<number> {
  let orphans: Orphan[];
  try {
    orphans = await findOrphans();
  } catch (error) {
    console.error("reaper: could not list containers:", error);
    return 0;
  }

  for (const orphan of orphans) {
    try {
      await run("docker", ["kill", orphan.id]);
      console.log(`reaped ${orphan.id} (age ${Math.round(orphan.ageMs / 1000)}s)`);
    } catch {
      // Already gone between listing and killing. That is the good outcome.
    }
  }
  return orphans.length;
}

async function main(): Promise<void> {
  console.log(
    `Reaper up: killing containers labelled ${JUDGE_LABEL} older than ${MAX_AGE_MS}ms, every ${INTERVAL_MS}ms`,
  );
  process.on("uncaughtException", (e) => console.error("reaper continues:", e));
  process.on("unhandledRejection", (e) => console.error("reaper continues:", e));

  for (;;) {
    await reapOnce();
    await new Promise((resolve) => setTimeout(resolve, INTERVAL_MS));
  }
}

if (process.argv[1]?.endsWith("reaper.ts")) void main();
