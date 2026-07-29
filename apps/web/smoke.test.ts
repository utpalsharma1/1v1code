/* ============================================================================
   Asset smoke test — does the app actually render styled and hydrate?

   THIS IS THE CHECK THAT WAS MISSING.

   Typecheck passed. `next build` passed. All twelve sign-in tests passed. Every
   route returned 200. And the app was serving completely unstyled HTML with a
   dead React runtime, because `/_next/static/*` was 404ing for CSS and for
   several core JS chunks.

   Every existing check looked at the HTML document. Not one of them looked at
   what the document *references*. A 200 on a route says nothing about whether
   the stylesheet it links to exists, and §2 makes design a functional
   requirement — so an unstyled app is a failed build, not a cosmetic issue.

   So this walks the actual dependency graph of each page: fetch the route,
   extract every stylesheet and script URL the browser would fetch, and demand
   each one returns 200 with real content. Then it asserts the CSS contains our
   tokens and *not* Tailwind's default palette, which distinguishes "Tailwind
   compiled our theme" from "something served a stylesheet".

   Requires: dev server (or `next start`) on :3000.
   Run with:  pnpm test:smoke
   ========================================================================= */

import assert from "node:assert/strict";
import test, { before, describe } from "node:test";

const WEB = process.env["WEB_URL"] ?? "http://localhost:3000";

/** Every route that must render styled. */
const ROUTES = ["/", "/login", "/register", "/play", "/dev/hud", "/dev/kitchen-sink", "/dev/judge"];

/** Below this the stylesheet is a stub, an error page, or a truncated build. */
const MIN_CSS_BYTES = 5_000;

async function html(path: string): Promise<string> {
  const response = await fetch(`${WEB}${path}`);
  assert.equal(response.status, 200, `${path} did not return 200`);
  return response.text();
}

function refs(doc: string, pattern: RegExp): string[] {
  const found = new Set<string>();
  for (const m of doc.matchAll(pattern)) {
    const url = m[1];
    if (url && url.startsWith("/_next/")) found.add(url);
  }
  return [...found];
}

const stylesheets = (doc: string) =>
  refs(doc, /<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g).concat(
    refs(doc, /<link[^>]+href="([^"]+\.css[^"]*)"/g),
  );

const scripts = (doc: string) => refs(doc, /<script[^>]+src="([^"]+)"/g);

before(async () => {
  const health = await fetch(WEB).catch(() => null);
  if (!health?.ok) throw new Error(`no server at ${WEB} — start the dev server first`);
});

describe("the app renders styled", () => {
  test("every route links at least one stylesheet", async () => {
    for (const route of ROUTES) {
      const links = stylesheets(await html(route));
      assert.ok(
        links.length > 0,
        `${route} links NO stylesheet at all — the page would render as raw HTML`,
      );
    }
  });

  test("every linked stylesheet is served and is not empty", async () => {
    for (const route of ROUTES) {
      for (const href of stylesheets(await html(route))) {
        const response = await fetch(`${WEB}${href}`);
        assert.equal(
          response.status,
          200,
          `${route} links ${href} which returns ${response.status} — the app renders unstyled`,
        );
        const body = await response.text();
        assert.ok(
          body.length >= MIN_CSS_BYTES,
          `${route}: ${href} is only ${body.length} bytes — Tailwind did not compile`,
        );
      }
    }
  });

  test("the stylesheet carries our tokens, not a default theme", async () => {
    const href = stylesheets(await html("/"))[0];
    assert.ok(href, "no stylesheet on the landing page");
    const css = await (await fetch(`${WEB}${href}`)).text();

    // Tokens must survive into the served asset.
    for (const token of ["--ink:", "--p1:", "--p2:", "--ff-display"]) {
      assert.ok(css.includes(token), `token ${token} missing from the served CSS`);
    }
    // Utilities the components actually use must have been generated.
    for (const utility of [".bg-ink", ".text-fg", "clip-path"]) {
      assert.ok(css.includes(utility), `utility ${utility} was not generated`);
    }
    // §13.2 / globals.css wipe Tailwind's palette with `--color-*: initial`. If
    // these exist, the @theme block did not apply and any styling we see is not
    // ours — the failure mode that looks fine until a color is wrong everywhere.
    for (const banned of ["bg-red-500", "text-sm"]) {
      assert.ok(!css.includes(banned), `Tailwind's default theme leaked in: ${banned}`);
    }
  });
});

describe("the app hydrates", () => {
  test("every referenced script is served", async () => {
    // A 404 on a core chunk means React never boots. The visible symptom is not
    // an error — it is a form that silently does nothing when submitted, because
    // no onSubmit handler was ever attached. That was the second reported bug,
    // and it had the same root cause as the first.
    for (const route of ROUTES) {
      for (const src of scripts(await html(route))) {
        const response = await fetch(`${WEB}${src}`);
        assert.equal(
          response.status,
          200,
          `${route} references ${src} which returns ${response.status} — React will not hydrate`,
        );
      }
    }
  });
});

describe("credentials never travel in a URL", () => {
  test("auth forms declare method=post and a real action", async () => {
    // Without both, an unhydrated browser submits a GET to the current URL and
    // puts the password in the address bar, history and server log. Observed.
    for (const route of ["/login", "/register"]) {
      const doc = await html(route);
      const form = /<form[^>]*>/i.exec(doc)?.[0] ?? "";
      assert.match(form, /method="post"/i, `${route} form must declare method="post": ${form}`);
      assert.match(form, /action="\/api\/auth\//i, `${route} form must declare an action: ${form}`);
    }
  });
});
