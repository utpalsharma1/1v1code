import { defineConfig, devices } from "@playwright/test";

/* ============================================================================
   The PRODUCTION configuration: `next start` behind Caddy, on one origin.

   Four bugs shipped past a green suite because the only suite ran against
   `next dev` on localhost:3000 — a configuration nobody uses. This runs the
   same specs against the shape that actually ships.

   Not through the tunnel, deliberately. A quick tunnel adds a random hostname,
   a concurrent-request cap and real network flakiness; every bug found so far
   was local to build-and-proxy, and a suite that fails intermittently for
   transport reasons is one that gets ignored. Caddy is the right boundary.
   ========================================================================= */

export default defineConfig({
  testDir: ".",
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  timeout: 90_000,
  expect: { timeout: 15_000 },
  globalSetup: "./prod.setup.ts",
  use: {
    baseURL: "http://localhost:8180",
    trace: "retain-on-failure",
  },
  /* SIX SPECS ARE EXCLUDED, AND THE REASON IS NOT "THEY FAIL".

     They drive a second player through `/dev/sparring`, which production
     deliberately removes: Caddy 404s `/dev/*` at the edge and the ticket route
     `/api/dev/sparring-ticket` 404s under NODE_ENV=production (§13.6). So they
     are un-runnable here BY CONSTRUCTION, and the fact that they fail is the
     production configuration working correctly.

     This is an exclusion, not a silencing. Two-player coverage in production is
     NOT lost: `challenge.spec.ts` drives two REAL browser contexts through a
     challenge link and touches no dev affordance at all — it queues, pairs,
     accepts, renders the match screen and the problem panel — and it passes
     here. That is the path a real pair of players walks, which is the better
     test of the two; sparring exists because one developer cannot be two
     people, not because it is more realistic.

     If that ever stops being true — if challenge.spec.ts is removed or stops
     covering a real match — this exclusion silently becomes a coverage hole,
     so it is written down here rather than left as a config flag. */
  grepInvert: /@needs-dev-routes/,
  projects: [{ name: "chromium-prod", use: { ...devices["Desktop Chrome"] } }],
});
