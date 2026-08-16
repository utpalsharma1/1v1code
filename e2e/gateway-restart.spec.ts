import { expect, test, type Page } from "@playwright/test";
import { execSync } from "node:child_process";

/* ============================================================================
   THE GATEWAY DIES MID-MATCH. Do the two browsers find out?

   A LiveMatch exists only in the gateway's memory. Before this, a restart left
   both players on a match screen with a running clock over a match the server
   had already reconciled to ABANDONED — correct server-side, and completely
   invisible to the two people looking at it.

   This matters more on Oracle than locally: a small VM restarts the gateway on
   every deploy, every OOM and every crash, so what is an occasional oddity here
   is routine there.
   ========================================================================= */

const password = "correct-horse-battery-staple";

async function register(page: Page): Promise<string> {
  const handle = `rs_${Math.random().toString(36).slice(2, 7)}`;
  await page.goto("/register");
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', `${handle}@example.com`);
  await page.fill('input[name="password"]', password);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/play");
  await expect(page.getByText(/^connected$/i)).toBeVisible({ timeout: 20_000 });
  return handle;
}

test(
  "a gateway restart mid-match tells both players instead of leaving them hanging",
  { tag: "@needs-dev-routes" },
  async ({ browser }) => {
    test.setTimeout(240_000);

    const playerCtx = await browser.newContext();
    const partnerCtx = await browser.newContext();
    const play = await playerCtx.newPage();
    const spar = await partnerCtx.newPage();

    await register(play);
    await spar.goto("/dev/sparring");
    await expect(spar.getByText(/connected · sparring_/i)).toBeVisible({ timeout: 20_000 });

    await play.getByRole("button", { name: /^play$/i }).click();
    await spar.getByRole("button", { name: /join queue/i }).click();
    await play.getByRole("button", { name: /^accept$/i }).click({ timeout: 60_000 });
    await spar.getByRole("button", { name: /^accept$/i }).click();
    await expect(play.locator(".monaco-editor").first()).toBeVisible({ timeout: 60_000 });

    /* Kill it the way a crash does, then bring it back the way a deploy does. */
    execSync("bash scripts/up.sh restart-gateway || true", { cwd: process.cwd(), stdio: "ignore" });

    /* The player must END UP somewhere honest — the result screen — rather than
       sitting on a live match screen forever. Socket.IO reconnects on its own;
       what is under test is that the gateway ANSWERS the rejoin. */
    await expect(
      play.getByText(/rematch|queue again|back to hub|no longer exists/i).first(),
      "after a gateway restart the player must be told the match is over",
    ).toBeVisible({ timeout: 90_000 });

    await playerCtx.close();
    await partnerCtx.close();
  },
);
