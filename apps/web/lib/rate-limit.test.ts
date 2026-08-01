/* ============================================================================
   The trusted-proxy switch, attacked rather than confirmed.

   This test forges the headers a client can actually send and asserts they are
   ignored unless a declared proxy vouches for them. It is written the way the
   visibility probe is written: the failure it exists to catch is a header being
   BELIEVED, so it tries to get one believed.

   The bug it guards is silent in the direction that matters. A forgeable client
   address does not break anything visibly — it hands every attacker a fresh
   rate-limit bucket while the limiter reports that it is working.

   BREAK_TRUSTED_PROXY=1 makes `clientAddress` trust headers unconditionally,
   which is the old behaviour. It exists so this test can be shown to fail: a
   test that has never failed has not been shown to test anything. Same device
   as BREAK_VISIBILITY=1 in the gateway.
   ========================================================================= */

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { clientAddress, rateLimitIdentity, trustedProxy } from "./rate-limit.ts";

const forged = (headers: Record<string, string>): Request =>
  new Request("https://example.test/api/judge", { headers });

/* What a hostile client sends: its own CF-Connecting-IP, and an X-Forwarded-For
   whose FIRST entry it chose. Both look identical to the real thing. */
const HOSTILE = {
  "cf-connecting-ip": "203.0.113.99",
  "x-forwarded-for": "203.0.113.99, 198.51.100.7",
};

test("TRUSTED_PROXY=none ignores every proxy header", () => {
  assert.equal(clientAddress(forged(HOSTILE), "none"), null);
  assert.equal(
    clientAddress(forged({ "cf-connecting-ip": "203.0.113.99" }), "none"),
    null,
    "CF-Connecting-IP must not be believed when nothing is in front of us",
  );
});

test("TRUSTED_PROXY=cloudflare honours CF-Connecting-IP and still ignores X-Forwarded-For", () => {
  assert.equal(clientAddress(forged(HOSTILE), "cloudflare"), "203.0.113.99");
  /* Cloudflare APPENDS to X-Forwarded-For, so its first entry stays
     client-controlled and must never be read even here. */
  assert.equal(
    clientAddress(forged({ "x-forwarded-for": "203.0.113.99" }), "cloudflare"),
    null,
    "X-Forwarded-For must be ignored under cloudflare — only CF-Connecting-IP is overwritten",
  );
});

test("TRUSTED_PROXY=local reads the LAST X-Forwarded-For hop, never the client's", () => {
  /* The client claimed 203.0.113.99; our proxy appended the real peer. */
  assert.equal(clientAddress(forged(HOSTILE), "local"), "198.51.100.7");
  assert.equal(
    clientAddress(forged({ "cf-connecting-ip": "203.0.113.99" }), "local"),
    null,
    "CF-Connecting-IP means nothing when we are not behind Cloudflare",
  );
});

test("a forged header cannot mint a fresh rate-limit bucket under TRUSTED_PROXY=none", () => {
  /* PIN THE MODE. The first version read the ambient environment, and once
     `.env` gained TRUSTED_PROXY=cloudflare it started asserting the wrong
     mode's behaviour and failed. A security test whose verdict depends on
     whichever env file happened to be sourced is not testing the code. */
  const before = process.env["TRUSTED_PROXY"];
  try {
    process.env["TRUSTED_PROXY"] = "none";
    /* THE ACTUAL ATTACK: many identities from one client. Every one must
       collapse to the same bucket, or the limit is worthless. */
    const identities = new Set(
      ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"].map((ip) =>
        rateLimitIdentity(null, forged({ "cf-connecting-ip": ip, "x-forwarded-for": ip })),
      ),
    );
    assert.equal(
      identities.size,
      1,
      `forged headers produced ${identities.size} distinct buckets; they must produce 1`,
    );
    assert.equal([...identities][0], "ip:untrusted");
  } finally {
    if (before === undefined) delete process.env["TRUSTED_PROXY"];
    else process.env["TRUSTED_PROXY"] = before;
  }
});

test("under TRUSTED_PROXY=cloudflare the header IS honoured — and that is only safe behind the edge", () => {
  /* Stated as a test so the trade-off is explicit rather than implied: in this
     mode distinct CF-Connecting-IP values DO produce distinct buckets. That is
     correct only because Cloudflare overwrites the header at its edge. Setting
     this mode without Cloudflare actually in front is the whole hole. */
  const before = process.env["TRUSTED_PROXY"];
  try {
    process.env["TRUSTED_PROXY"] = "cloudflare";
    const a = rateLimitIdentity(null, forged({ "cf-connecting-ip": "1.1.1.1" }));
    const b = rateLimitIdentity(null, forged({ "cf-connecting-ip": "2.2.2.2" }));
    assert.equal(a, "ip:1.1.1.1");
    assert.notEqual(a, b);
  } finally {
    if (before === undefined) delete process.env["TRUSTED_PROXY"];
    else process.env["TRUSTED_PROXY"] = before;
  }
});

test("a signed-in user is never identified by a header", () => {
  assert.equal(rateLimitIdentity("user_abc", forged(HOSTILE)), "u:user_abc");
});

test("the default is none, so a missing or misspelt setting fails safe", () => {
  const before = process.env["TRUSTED_PROXY"];
  try {
    delete process.env["TRUSTED_PROXY"];
    assert.equal(trustedProxy(), "none");
    process.env["TRUSTED_PROXY"] = "cloudfare"; // misspelt on purpose
    assert.equal(trustedProxy(), "none", "an unrecognised value must fall back to none");
    process.env["TRUSTED_PROXY"] = "cloudflare";
    assert.equal(trustedProxy(), "cloudflare");
  } finally {
    if (before === undefined) delete process.env["TRUSTED_PROXY"];
    else process.env["TRUSTED_PROXY"] = before;
  }
});
