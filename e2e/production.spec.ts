import { expect, test } from "@playwright/test";

/* ============================================================================
   Specs that only mean anything against the production build behind a proxy.

   Each one corresponds to a bug that shipped past a green suite because e2e ran
   against `next dev` on localhost.
   ========================================================================= */

test("every script the landing page references actually loads", async ({ page }) => {
  /* THE ASSET COLLISION AND THE STALE SERVER both presented as "Application
     error: a client-side exception has occurred": the document is fine and the
     chunks it needs are gone. A page-level 200 says nothing about that. */
  const failed: string[] = [];
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/_next/static/") && response.status() !== 200) {
      failed.push(`${response.status()} ${url}`);
    }
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  const scripts = await page.locator("script[src]").count();
  /* ZERO ITERATIONS IS A FAILURE (§13.7). "No failed assets" over a page that
     loaded no scripts is vacuously true, and that exact shape is why this
     assertion exists. */
  expect(scripts, "the page referenced no scripts at all — it did not render").toBeGreaterThan(0);
  expect(failed, `assets failed to load: ${failed.join(", ")}`).toEqual([]);
  expect(errors, `client-side exceptions: ${errors.join(", ")}`).toEqual([]);
});

test("registration returns JSON, and a duplicate is a readable 4xx", async ({ page }) => {
  /* THE MISSING DATABASE_URL returned a 500 with an EMPTY BODY, which reached
     the player as "Unexpected end of JSON input". Both halves are asserted:
     the status, and that the body is actually JSON. */
  await page.goto("/");
  const handle = `prod${Date.now().toString().slice(-6)}`;
  const body = {
    handle,
    email: `${handle}@example.test`,
    password: "correct-horse-battery-staple",
  };

  const first = await page.evaluate(async (payload) => {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: response.status, type: response.headers.get("content-type"), text: await response.text() };
  }, body);

  expect(first.status, `registration failed: ${first.text.slice(0, 300)}`).toBe(200);
  expect(first.type ?? "", "a route that returns no content-type has crashed").toContain("application/json");
  expect(() => JSON.parse(first.text)).not.toThrow();

  /* A taken handle is an expected event, not a server error. */
  const second = await page.evaluate(async (payload) => {
    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: response.status, text: await response.text() };
  }, body);

  expect(second.status, "a duplicate must be a 4xx, never a 500").toBeGreaterThanOrEqual(400);
  expect(second.status).toBeLessThan(500);
  expect(JSON.parse(second.text).error).toMatch(/already taken/i);
});

test("the dev routes are not reachable through the proxy", async ({ request }) => {
  /* /dev/sparring mints socket tickets in development. Behind the proxy it must
     be refused — and this asserts the STATUS, not merely "not 200", because a
     transport failure reported as an exposure is its own bug (§13.7). */
  const response = await request.get("/dev/sparring");
  expect(response.status()).toBe(404);
});

test("the socket path is proxied on the same origin", async ({ request }) => {
  /* The single-origin property: the client connects with no URL and the proxy
     routes /socket.io to the gateway. If this 404s, every match screen is dead
     while every page still renders. */
  const response = await request.get("/socket.io/?EIO=4&transport=polling");
  expect(response.status()).toBe(200);
});
