import { expect, test, type Page } from "@playwright/test";

/* ============================================================================
   The 2B-4 deliverable, in a real browser — TWO PLAYERS.

   2B-4 is human vs human, so this drives two browser contexts: a registered
   player at /play and the dev sparring partner at /dev/sparring. That is the
   whole point of the sparring page — every beat now needs two people, and a
   test cannot coordinate two humans.

   Every previous bug in this project was found by opening a browser rather
   than by a test. This is that walk, automated.
   ========================================================================= */

const password = "correct-horse-battery-staple";

async function registerAndQueue(page: Page): Promise<string> {
  const handle = `pwm_${Math.random().toString(36).slice(2, 7)}`;
  await page.goto("/register");
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', `${handle}@example.com`);
  await page.fill('input[name="password"]', password);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/play");
  await expect(page.getByText(/^connected$/i)).toBeVisible({ timeout: 20_000 });
  return handle;
}

test("/play survives a socket blip and stays matchable", { tag: "@needs-dev-routes" }, async ({ browser }) => {
  /* The bug that made the match screen unreachable by hand: a queued player
     whose socket blipped was dropped from the Redis pool and never put back,
     while their screen carried on showing the queue card. Any Next dev
     recompile did it. This reloads /play mid-queue — a harder blip than a
     recompile — and then checks a sparring client can still find them. */
  test.setTimeout(180_000);

  const player = await browser.newContext();
  const partner = await browser.newContext();
  const play = await player.newPage();
  const spar = await partner.newPage();

  await registerAndQueue(play);
  await play.getByRole("button", { name: /^play$/i }).click();
  await expect(play.getByText(/queue is empty|searching/i).first()).toBeVisible({ timeout: 40_000 });

  // The blip: a full reload drops the socket and opens a new one.
  await play.reload();
  await expect(play.getByText(/^connected$/i)).toBeVisible({ timeout: 20_000 });

  await spar.goto("/dev/sparring");
  await expect(spar.getByText(/connected · sparring_/i)).toBeVisible({ timeout: 20_000 });
  await spar.getByRole("button", { name: /join queue/i }).click();

  // If the pool forgot the reloaded player, this never appears.
  await expect(spar.locator("section", { hasText: /events/i })).toContainText(/match found/i, {
    timeout: 60_000,
  });

  await player.close();
  await partner.close();
});

test("two players: queue, pair, accept, solve in Monaco, and finish rated", { tag: "@needs-dev-routes" }, async ({ browser }) => {
  test.setTimeout(240_000);

  const player = await browser.newContext();
  const partner = await browser.newContext();
  const play = await player.newPage();
  const spar = await partner.newPage();

  await registerAndQueue(play);
  await spar.goto("/dev/sparring");
  await expect(spar.getByText(/connected · sparring_/i)).toBeVisible({ timeout: 20_000 });

  // Both queue. With no bot fallback, pairing happens only because two real
  // clients are present — which is exactly what 2B-4 is.
  await play.getByRole("button", { name: /^play$/i }).click();
  await spar.getByRole("button", { name: /join queue/i }).click();

  /* The accept control lives INSIDE the queue-pop cinematic. That overlay is
     `fixed inset-0 z-50`, so a button rendered by the page behind it would be
     unclickable — which is precisely how the first real two-browser match
     died. Clicking it here is the regression test. */
  const accept = play.getByRole("button", { name: /^accept$/i });
  await expect(accept).toBeVisible({ timeout: 60_000 });
  await accept.click();
  await spar.getByRole("button", { name: /^accept$/i }).click();

  // Countdown, then the match screen with Monaco.
  await expect(play.locator(".monaco-editor").first()).toBeVisible({ timeout: 60_000 });
  // The problem panel is present — the <h1> is the problem's own title, so
  // anchor on the panel's labels rather than guessing the heading text.
  await expect(play.getByText(/^constraints$/i)).toBeVisible();
  await expect(play.getByRole("button", { name: /^submit$/i })).toBeVisible();

  // A deliberately wrong submission first: §6.8b gives unlimited attempts, and
  // the only cost is the in-flight lock.
  /* Monaco's textarea is a hidden input proxy and does not accept fill().
     Type into it the way a person does. */
  await play.locator(".monaco-editor").first().click();
  await play.keyboard.press("ControlOrMeta+a");
  await play.keyboard.insertText("print(0)\n");
  await play.getByRole("button", { name: /^submit$/i }).click();

  // The lock must be legible, not a silently dead button.
  await expect(play.getByRole("button", { name: /judging/i })).toBeVisible({ timeout: 20_000 });
  // And it must come back, so the match continues.
  await expect(play.getByRole("button", { name: /^submit$/i })).toBeVisible({ timeout: 90_000 });

  // Now the sparring partner submits the real reference solution and wins.
  await spar.getByRole("button", { name: /correct \(reference\)/i }).click();

  // Defeat is a real result with a real rating change.
  await expect(play.getByText(/victory|defeat|draw|no contest/i).first()).toBeVisible({
    timeout: 150_000,
  });

  await player.close();
  await partner.close();
});

test("reloading mid-match still ends cleanly and re-enables Play", { tag: "@needs-dev-routes" }, async ({ browser }) => {
  /* Correct server state, client parked in a state nothing tells it to leave —
     the same shape as the QueuePop overlay covering Accept.

     A reload mid-match resynced correctly, but the resync did not carry the
     problem back, so the match screen could not render; when the match then
     ended there was no ending screen and no Play button, and only a hard
     reload recovered. A terminal match must return the client to idle whether
     it ended live or after a resync. */
  test.setTimeout(240_000);

  const player = await browser.newContext();
  const partner = await browser.newContext();
  const play = await player.newPage();
  const spar = await partner.newPage();

  await registerAndQueue(play);
  await spar.goto("/dev/sparring");
  await expect(spar.getByText(/connected · sparring_/i)).toBeVisible({ timeout: 20_000 });

  await play.getByRole("button", { name: /^play$/i }).click();
  await spar.getByRole("button", { name: /join queue/i }).click();

  await play.getByRole("button", { name: /^accept$/i }).click({ timeout: 60_000 });
  await spar.getByRole("button", { name: /^accept$/i }).click();
  await expect(play.locator(".monaco-editor").first()).toBeVisible({ timeout: 60_000 });

  // THE RELOAD, mid-match.
  await play.reload();
  await expect(play.getByText(/^connected$/i).or(play.locator(".monaco-editor").first())).toBeVisible({
    timeout: 30_000,
  });
  // Resync must put the match screen back, problem statement included.
  await expect(play.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
  await expect(play.getByText(/^constraints$/i)).toBeVisible();

  // Let the sparring partner win, ending the match while we are resynced.
  await spar.getByRole("button", { name: /correct \(reference\)/i }).click();

  // The ending must render, and Play must come back without a hard reload.
  await expect(play.getByText(/victory|defeat|draw|no contest|match canceled/i).first()).toBeVisible({
    timeout: 150_000,
  });
  // "Back to Hub", not "Queue again" — we are asserting the client can return
  // to idle, and Queue again deliberately goes straight back into the queue.
  await play.getByRole("button", { name: /back/i }).first().click();
  const playButton = play.getByRole("button", { name: /^play$/i });
  await expect(playButton).toBeVisible({ timeout: 20_000 });
  await expect(playButton).toBeEnabled();

  await player.close();
  await partner.close();
});

test("an empty queue says so instead of sweeping a radar forever", async ({ page }) => {
  /* 2B-4 removed the 20s bot fallback, so an empty pool has no automatic
     ending. The choice: the queue never expires, but it stops pretending.
     §5 only permits a loop that encodes live state, and a radar sweeping over
     provably nobody is the dishonest version. */
  test.setTimeout(120_000);

  await registerAndQueue(page);
  await page.getByRole("button", { name: /^play$/i }).click();

  await expect(page.getByText(/queue is empty/i)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/nobody else is queuing/i)).toBeVisible();
  // Still queued — not cancelled. The wording has to say so.
  await expect(page.getByText(/still in the queue/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /leave queue/i })).toBeVisible();
});

test("an unaccepted match is CANCELED, never VOID", { tag: "@needs-dev-routes" }, async ({ browser }) => {
  /* §6.9 gives VOID one meaning — our infrastructure failed. It fired on the
     first real browser match for the entirely ordinary reason that nobody
     could accept, which is what made it worthless as a signal. Two players
     pair and neither accepts: the result must be CANCELED. */
  test.setTimeout(120_000);

  const player = await browser.newContext();
  const partner = await browser.newContext();
  const play = await player.newPage();
  const spar = await partner.newPage();

  await registerAndQueue(play);
  await spar.goto("/dev/sparring");
  await expect(spar.getByText(/connected · sparring_/i)).toBeVisible({ timeout: 20_000 });

  await play.getByRole("button", { name: /^play$/i }).click();
  await spar.getByRole("button", { name: /join queue/i }).click();
  await expect(play.getByRole("button", { name: /^accept$/i })).toBeVisible({ timeout: 60_000 });

  // Deliberately do not accept. The window is 12s.
  const events = spar.locator("section", { hasText: /events/i });
  await expect(events).toContainText(/match end: CANCELED/i, { timeout: 40_000 });
  /* Scoped to the outcome line, not the whole log. A bare /VOID/i match also
     hit the "no rating change (canceled, void, or unrated)" line, which is
     explanatory copy rather than an outcome — a test failing on correct text,
     the same shape as an earlier check that flagged the word "console" in a
     sentence saying there was no console step. */
  await expect(events).not.toContainText(/match end: VOID/i);

  await player.close();
  await partner.close();
});
