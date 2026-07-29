/* Guard: no source file may hardcode a phase label.

   Two phase labels went stale and both were found by a human reading the
   screen — the landing page was three phases behind, /play was two. The fix is
   not "remember to update them", it is making the second occurrence impossible.

   Run with:  pnpm --filter @1v1/web test:phase
   ========================================================================= */

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { CURRENT_PHASE } from "./lib/phase.ts";

const ROOT = import.meta.dirname;
const SKIP = new Set(["node_modules", ".next", ".next-build", ".turbo"]);

/** "Phase 2B-3", "Phase 0", "Phase 2B-2 · gateway" — the shape that goes stale. */
const PHASE_LITERAL = /Phase\s+\d[A-Za-z0-9-]*/g;

/* Comments are stripped before matching, and /dev is exempt. Both carve-outs
   are about what actually goes stale.

   A comment citing "§6.8, Phase 4" is a reference to the spec — it stays true
   forever and a reviewer wants it there. A /dev route saying "Phase 2A" states
   which phase built the tool, which is provenance, also permanently true.

   What goes stale is a label claiming the CURRENT state of the product to a
   visitor, and that is what this guards. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sources(full, found);
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

test("only lib/phase.ts may hardcode a phase label", () => {
  const offenders: string[] = [];

  for (const file of sources(ROOT)) {
    const relative = file.slice(ROOT.length + 1);
    if (
      file.endsWith(join("lib", "phase.ts")) ||
      file === join(ROOT, "phase-labels.test.ts") ||
      relative.startsWith(join("app", "dev"))
    ) {
      continue;
    }
    for (const match of stripComments(readFileSync(file, "utf8")).match(PHASE_LITERAL) ?? []) {
      offenders.push(`${relative}: ${match}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `hardcoded phase labels found — import CURRENT_PHASE from lib/phase.ts instead:\n  ${offenders.join("\n  ")}`,
  );
});

test("the phase constant is self-consistent", () => {
  assert.ok(
    CURRENT_PHASE.label.includes(CURRENT_PHASE.id),
    `label ${CURRENT_PHASE.label!} must contain id ${CURRENT_PHASE.id}`,
  );
});
