import { expect, test } from "@playwright/test";

/* ============================================================================
   Sign-in, driven the way a person drives it.

   This path has now broken twice for unrelated reasons and neither was visible
   to any headless check:

   1. The form posted to a server action, reachable only over the RSC protocol,
      so nothing could drive what the browser drove.
   2. Core JS chunks 404'd, so React never hydrated, so the click handler was
      never attached and the form did a native GET with the password in the URL.

   Both were found by a human opening a browser. The HTTP-level test that
   replaced (1) still could not have caught (2), because it never rendered a
   page or clicked anything. So this types into the real fields and clicks the
   real button.
   ========================================================================= */

const password = "correct-horse-battery-staple";
const unique = () => Math.random().toString(36).slice(2, 8);

test("register through the form, then reach /play authenticated", async ({ page }) => {
  const handle = `pw_${unique()}`;
  const email = `${handle}@example.com`;

  // Any request that carries a credential in its URL is a failure, whatever
  // else happens. This is the exact defect the unhydrated form produced.
  const leaked: string[] = [];
  page.on("request", (request) => {
    const url = request.url();
    if (/[?&](password|email)=/i.test(url)) leaked.push(url);
  });

  await page.goto("/register");
  await expect(page.getByRole("heading", { name: /create account/i })).toBeVisible();

  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole("button", { name: /create account/i }).click();

  // The redirect is the assertion: it only happens on a real session.
  await page.waitForURL("**/play", { timeout: 20_000 });

  expect(leaked, `credentials appeared in a URL:\n${leaked.join("\n")}`).toEqual([]);

  // /play is client-gated on a real session, so "not signed in" must not appear.
  await expect(page.getByText(/not signed in/i)).toHaveCount(0);
});

test("the session survives a reload and mints a socket ticket", async ({ page }) => {
  const handle = `pw_${unique()}`;
  const email = `${handle}@example.com`;

  await page.goto("/register");
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/play");

  await page.reload();
  await expect(page.getByText(/not signed in/i)).toHaveCount(0);

  // The cross-origin socket handshake depends on this endpoint, and it is the
  // piece that could not be observed from the server when it was broken.
  const status = await page.evaluate(async () => {
    const response = await fetch("/api/socket-ticket", {
      method: "POST",
      credentials: "same-origin",
    });
    return response.status;
  });
  expect(status, "the browser's own cookie failed to mint a ticket").toBe(200);
});

test("a signed-out visitor is told to sign in, not shown a broken page", async ({ page }) => {
  await page.goto("/play");
  await expect(page.getByRole("heading", { name: /not signed in/i })).toBeVisible();
  /* The copy must describe something a visitor can actually do. It used to
     instruct them to paste a cookie into a devtools console, which stopped
     being true and then stayed on the page. Assert on the instruction, not on
     the vocabulary — an earlier version of this check matched the word
     "console" and flagged a sentence that was reassuring the user there was no
     console step, which is a test failing on correct copy. */
  await expect(page.getByText(/paste|devtools|document\.cookie/i)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /create account/i })).toBeVisible();
});

test("a wrong password shows a visible error and stays put", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', "arjun@example.com");
  await page.fill('input[name="password"]', "definitely-not-the-password");
  await page.getByRole("button", { name: /sign in/i }).click();

  // Silence is the bug. The user must see why nothing happened.
  await expect(page.getByRole("alert")).toBeVisible();
  expect(page.url()).toContain("/login");
});
