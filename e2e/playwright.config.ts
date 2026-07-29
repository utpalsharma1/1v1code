import { defineConfig, devices } from "@playwright/test";

/* Dev-only. Nothing here ships in the bundle.

   These tests exist because three bugs in a row were invisible without a
   browser: `--ulimit nproc`, the RSC seam, and 404'd assets. Each passed every
   headless check we had. A browser is the only thing that sees what a user
   sees. */

export default defineConfig({
  testDir: ".",
  // Serial: these share one dev server and one database.
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env["WEB_URL"] ?? "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
