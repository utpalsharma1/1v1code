import { expect, test, type Page } from "@playwright/test";

/* ============================================================================
   The deliverable, in two real browsers: a link, a stranger, a match.

   The invited context has NO account and never registers. §7's whole argument is
   that a registration wall in front of a first match costs more than every other
   growth feature combined, so this test would fail if one appeared.
   ========================================================================= */

const password = "correct-horse-battery-staple";

async function registerAndPlay(page: Page): Promise<string> {
  const handle = `ch_${Math.random().toString(36).slice(2, 7)}`;
  await page.goto("/register");
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', `${handle}@example.com`);
  await page.fill('input[name="password"]', password);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/play");
  await expect(page.getByText(/^connected$/i)).toBeVisible({ timeout: 20_000 });
  return handle;
}

test("a link, a browser with no account, and a match that runs like any other", async ({
  browser,
}) => {
  test.setTimeout(240_000);

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  const hostHandle = await registerAndPlay(host);

  /* Mint with an EXPLICIT band of 1300–1300, which is Connected Components and
     nothing else.

     The first version used the UI button, whose band defaults around the host's
     rating — so which problem the match drew was luck, and the render assertions
     below would pass or fail depending on whether that problem had been
     retrofitted yet. A test that passes because of a random draw is not a test. */
  const code = await host.evaluate(async () => {
    const response = await fetch("/api/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ ratingMin: 1300, ratingMax: 1300 }),
    });
    return ((await response.json()) as { code: string }).code;
  });
  expect(code, `expected a 10-char code, got "${code}"`).toMatch(/^[0-9A-HJKMNP-TV-Z]{10}$/);
  // The host still has to be waiting on it, which is what minting through the
  // UI does — so join explicitly here, exactly as the button does.
  await host.goto(`/play?challenge=${code}`);

  /* The invited side. A completely separate browser context — no session, no
     localStorage, nothing. It must be able to play. */
  await guest.goto(`/c/${code}`);
  await expect(guest.getByText(new RegExp(`${hostHandle} challenged you`, "i"))).toBeVisible({
    timeout: 20_000,
  });
  // The offer must be explicit that no account is needed.
  await expect(guest.getByText(/don't need an account|do not need an account/i)).toBeVisible();

  /* NO PLAY PRESS on either side. Arriving with ?challenge= goes straight to
     the challenge screen, and the guest goes from the link to accept. If either needed PLAY first, these assertions
     fail — which is the point, because PLAY is the matchmaking queue and there
     is nothing to queue for when you are already paired with a named person. */
  await expect(host.getByRole("button", { name: /^play$/i })).toHaveCount(0);

  await guest.getByRole("button", { name: /play as guest/i }).click();
  await guest.waitForURL(/\/play\?challenge=/, { timeout: 20_000 });
  // The lobby must never appear on this path, not even for a frame.
  await expect(guest.getByRole("button", { name: /^play$/i })).toHaveCount(0);

  /* Straight to the §6.2 accept step, with no intermediate press. That step
     stays: it is what stops a match starting against an empty chair. */
  const hostAccept = host.getByRole("button", { name: /^accept$/i });
  await expect(hostAccept).toBeVisible({ timeout: 60_000 });

  // §8 / §7: UNRATED, disclosed BEFORE the countdown while the window is open.
  await expect(host.getByText(/unrated/i)).toBeVisible();

  await hostAccept.click();
  await guest.getByRole("button", { name: /^accept$/i }).click({ timeout: 30_000 });

  // Monaco, the HUD, the problem panel — the same match screen.
  await expect(host.locator(".monaco-editor").first()).toBeVisible({ timeout: 60_000 });
  await expect(guest.locator(".monaco-editor").first()).toBeVisible({ timeout: 60_000 });

  /* THE PROBLEM MUST BE SOLVABLE AS PRESENTED. Every one of the 20 shipped
     without an input or output format, so a player had to guess whether values
     were space- or newline-separated — which means matches were decided partly
     by who guessed right. These assertions are the floor. */
  await expect(host.getByRole("heading", { name: /^constraints$/i })).toBeVisible();
  await expect(host.getByRole("heading", { name: /^input$/i })).toBeVisible();
  await expect(host.getByRole("heading", { name: /^output$/i })).toBeVisible();
  await expect(host.getByRole("heading", { name: /^sample/i })).toBeVisible();
  await expect(host.getByRole("heading", { name: /^note$/i })).toBeVisible();
  // Limits shown as real values, and at least one copyable sample input.
  await expect(host.getByText(/\bMB\b/)).toBeVisible();
  await expect(host.getByRole("button", { name: /copy sample input/i }).first()).toBeVisible();

  // §7: still shareable, even with a guest in it.
  const shareChip = host.getByRole("button", { name: /copy the spectator link/i });
  await expect(shareChip).toBeVisible();

  await hostCtx.close();
  await guestCtx.close();
});

test("a guest cannot create a challenge link", async ({ browser }) => {
  /* A credential-less account that can mint invite links is a spam primitive.
     Refused by the HTTP route and independently by the gateway.

     SEPARATE CONTEXTS. The first version opened the host with
     `page.context().newPage()`, which shares cookies — so the "guest" page was
     carrying the host's session and the refusal never applied. A test that
     shares an identity between two roles is testing neither. */
  test.setTimeout(120_000);

  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  const host = await hostCtx.newPage();
  const page = await guestCtx.newPage();
  const hostHandle = await registerAndPlay(host);
  await host.getByRole("button", { name: /create a challenge link/i }).click();
  const chip = host.getByRole("button", { name: /copy link/i });
  await expect(chip).toBeVisible({ timeout: 20_000 });
  const code = (await chip.innerText()).split("\n")[0]!.trim();
  void hostHandle;

  await page.goto(`/c/${code}`);
  await page.getByRole("button", { name: /play as guest/i }).click();
  await page.waitForURL(/\/play\?challenge=/, { timeout: 20_000 });

  const status = await page.evaluate(async () => {
    const response = await fetch("/api/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: "{}",
    });
    return response.status;
  });
  expect(status, "a guest must not be able to mint a challenge link").toBe(403);

  await hostCtx.close();
  await guestCtx.close();
});

test("a stale link is not a dead end", async ({ page }) => {
  /* §7: a stale link shows who challenged whom and offers one click to send one
     back. A 404 here is a lost player, and a link opened tomorrow rather than
     tonight is the most likely way this gets used slightly wrong. */
  await page.goto("/c/ZZZZZZZZZZ");
  await expect(page.getByText(/doesn't work|does not work/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("button", { name: /back to 1v1/i })).toBeVisible();
});
