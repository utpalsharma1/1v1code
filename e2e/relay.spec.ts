import { expect, test, type Page } from "@playwright/test";

/* ============================================================================
   2C-1 in a real browser: typing in /play appears in /dev/spectate.

   This is the deliverable — the relay end to end through Monaco, the gateway,
   and a spectator's editor — and it is also the visibility rule demonstrated
   from the outside: a spectator sees the source, and the opposing player's
   window never does.
   ========================================================================= */

const password = "correct-horse-battery-staple";

async function register(page: Page): Promise<string> {
  const handle = `rly_${Math.random().toString(36).slice(2, 7)}`;
  await page.goto("/register");
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', `${handle}@example.com`);
  await page.fill('input[name="password"]', password);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/play");
  await expect(page.getByText(/^connected$/i)).toBeVisible({ timeout: 20_000 });
  return handle;
}

test("typing reaches a spectator, and never the opponent", async ({ browser }) => {
  test.setTimeout(240_000);

  const playerCtx = await browser.newContext();
  const partnerCtx = await browser.newContext();
  const watcherCtx = await browser.newContext();
  const play = await playerCtx.newPage();
  const spar = await partnerCtx.newPage();
  const watch = await watcherCtx.newPage();

  await register(play);
  await spar.goto("/dev/sparring");
  await expect(spar.getByText(/connected · sparring_/i)).toBeVisible({ timeout: 20_000 });

  // Capture the match id from the sparring log, which prints match.found.
  await play.getByRole("button", { name: /^play$/i }).click();
  await spar.getByRole("button", { name: /join queue/i }).click();
  await play.getByRole("button", { name: /^accept$/i }).click({ timeout: 60_000 });
  await spar.getByRole("button", { name: /^accept$/i }).click();
  await expect(play.locator(".monaco-editor").first()).toBeVisible({ timeout: 60_000 });

  // The spectator needs the id; read it from the gateway's own URL space by
  // asking the page that already knows it.
  const matchId = await play.evaluate(() => {
    const el = document.querySelector("[data-match-id]");
    return el?.getAttribute("data-match-id") ?? "";
  });
  expect(matchId, "the match screen must expose its match id for /dev/spectate").not.toBe("");

  await watch.goto("/dev/spectate");
  await expect(watch.getByText(/^connected$/i)).toBeVisible({ timeout: 20_000 });
  await watch.fill('input[placeholder*="paste"]', matchId);
  await watch.getByRole("button", { name: /^watch$/i }).click();

  // Type something distinctive into the real editor.
  const secret = `MARKER_${Math.random().toString(36).slice(2, 8)}`;
  await play.locator(".monaco-editor").first().click();
  await play.keyboard.press("ControlOrMeta+a");
  await play.keyboard.insertText(`# ${secret}\n`);

  // The spectator's side-by-side view must show it.
  await expect(watch.locator(".monaco-editor").first()).toContainText(secret, { timeout: 30_000 });

  // And the opponent's own window must never contain it. The sparring page has
  // no editor at all, so assert on the whole document.
  await expect(spar.locator("body")).not.toContainText(secret);

  await playerCtx.close();
  await partnerCtx.close();
  await watcherCtx.close();
});

test("a player cannot spectate their own live match", async ({ browser }) => {
  /* The one-click bypass. §7's 45s ranked delay does not close it, so the
     gateway refuses by identity. */
  test.setTimeout(180_000);

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

  const matchId = await play.evaluate(
    () => document.querySelector("[data-match-id]")?.getAttribute("data-match-id") ?? "",
  );

  /* Ask as the competitor's own session, on the same origin, exactly as a
     modified client would. */
  const refused = await play.evaluate(async (id: string) => {
    const response = await fetch("/api/socket-ticket", { method: "POST", credentials: "same-origin" });
    const { ticket } = (await response.json()) as { ticket: string };
    const { io } = (window as unknown as { __io?: unknown }).__io
      ? (window as unknown as { __io: { io: unknown } }).__io
      : await import(/* webpackIgnore: true */ "https://esm.sh/socket.io-client@4");
    const socket = (io as (u: string, o: unknown) => any)("http://localhost:4000", {
      transports: ["websocket"],
      auth: { ticket },
    });
    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => resolve("no response"), 15_000);
      socket.on("connect", () => socket.emit("spectate.join", { matchId: id }));
      socket.on("error", (e: { code: string }) => {
        clearTimeout(timer);
        resolve(e.code);
      });
      socket.on("editor.snapshot", () => {
        clearTimeout(timer);
        resolve("LEAKED");
      });
    });
  }, matchId);

  expect(refused, "a competitor spectating their own match must be refused").toBe("SELF_SPECTATE");

  await playerCtx.close();
  await partnerCtx.close();
});
