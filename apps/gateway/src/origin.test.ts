/* The origin allowlist, attacked rather than confirmed.

   The `*.` wildcard exists so a Cloudflare quick tunnel's random hostname can
   be accepted without reflecting every origin. A suffix match is exactly the
   kind of check that is usually written as `includes()` and is then satisfied
   by `trycloudflare.com.evil.test`, so this tries that. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { originAllowed } from "./origin.ts";

const ALLOW = ["http://localhost:3000", "https://*.trycloudflare.com"];

test("an exact origin is allowed", () => {
  assert.equal(originAllowed("http://localhost:3000", ALLOW), true);
});

test("a matching tunnel hostname is allowed", () => {
  assert.equal(originAllowed("https://brave-cat-runs-fast.trycloudflare.com", ALLOW), true);
});

test("a suffix that is only a substring is REFUSED", () => {
  for (const hostile of [
    "https://trycloudflare.com.evil.test",
    "https://eviltrycloudflare.com",
    "http://brave-cat.trycloudflare.com", // wrong scheme
    "https://example.test",
  ]) {
    assert.equal(originAllowed(hostile, ALLOW), false, `${hostile} must be refused`);
  }
});

test("the bare suffix itself is not a wildcard match", () => {
  assert.equal(originAllowed("https://trycloudflare.com", ALLOW), false);
});
