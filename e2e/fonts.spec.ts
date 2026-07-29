import { expect, test } from "@playwright/test";

/* ============================================================================
   Do the fonts actually load?

   This is the same failure mode as the 404'd stylesheet, and it is the one the
   smoke test still could not see. `next/font` emits font files and rewrites
   @font-face to point at them. If those files 404, or the family name drifts,
   every heading silently falls back to a system sans — and the page still looks
   deliberate enough that you might not notice. §4 names three specific families
   and calls monospace headlines "the point, not an accident", so a silent
   fallback is a failed build, not a cosmetic issue.

   Absence of an error is not evidence of loading, so this asserts the
   mechanism: `document.fonts` reports the family as loaded, the rendered
   element actually resolves to that family, and the font files themselves
   return 200 with real bytes.
   ========================================================================= */

/** §4: display/HUD, body/UI, and code+numerals. All three are load-bearing. */
const FAMILIES = [
  { token: "--ff-display", expect: /Martian/i },
  { token: "--ff-body", expect: /Geist/i },
  { token: "--ff-code", expect: /JetBrains/i },
];

test("every font file the page requests is served", async ({ page }) => {
  const fontResponses: { url: string; status: number; bytes: number }[] = [];

  page.on("response", async (response) => {
    const url = response.url();
    if (!/\.(woff2?|ttf|otf)(\?|$)/i.test(url)) return;
    let bytes = 0;
    try {
      bytes = (await response.body()).length;
    } catch {
      /* body already discarded — status still tells us what we need */
    }
    fontResponses.push({ url, status: response.status(), bytes });
  });

  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  expect(fontResponses.length, "the page requested no font files at all").toBeGreaterThan(0);
  for (const font of fontResponses) {
    expect(font.status, `${font.url} returned ${font.status}`).toBe(200);
    expect(font.bytes, `${font.url} is empty`).toBeGreaterThan(1000);
  }
});

test("the three named families are available, not silently substituted", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  for (const { token, expect: pattern } of FAMILIES) {
    // The token must resolve to the family we think it does...
    const resolved = await page.evaluate(
      (name) => getComputedStyle(document.documentElement).getPropertyValue(name),
      token,
    );
    expect(resolved, `${token} resolved to "${resolved}"`).toMatch(pattern);

    /* ...and the browser must actually be able to render it.

       Asserting "the face is loaded" was wrong and this test caught me doing
       it: fonts load lazily, and the landing page renders nothing in
       --ff-code, so JetBrains Mono was legitimately `unloaded`. That is
       correct browser behaviour, not a missing font.

       `document.fonts.load()` forces the fetch and resolves with the faces it
       managed to get — an empty array if the file 404s. So this distinguishes
       "not needed yet" from "not there", which is the whole point. */
    const family = resolved.split(",")[0]!.trim().replace(/^["']|["']$/g, "");
    const result = await page.evaluate(async (name) => {
      const faces = await document.fonts.load(`700 48px "${name}"`);
      return { count: faces.length, usable: document.fonts.check(`700 48px "${name}"`) };
    }, family);

    expect(result.count, `${family} fetched no faces — the font file is missing`).toBeGreaterThan(0);
    expect(result.usable, `${family} is not renderable — the browser is falling back`).toBe(true);
  }
});

test("the display heading really renders in the display face", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const heading = page.locator("h1").first();
  await expect(heading).toBeVisible();

  // Not "is the CSS right" — is the browser actually able to use the face it
  // was told to. `check` returns false when it would fall back.
  const usable = await heading.evaluate((el) => {
    const family = getComputedStyle(el).fontFamily;
    const first = family.split(",")[0]?.trim().replace(/^["']|["']$/g, "") ?? "";
    return { family, first, ok: document.fonts.check(`700 48px "${first}"`) };
  });

  expect(usable.first, `h1 font-family was "${usable.family}"`).toMatch(/Martian/i);
  expect(usable.ok, `the browser cannot render ${usable.first} — it is falling back`).toBe(true);
});
