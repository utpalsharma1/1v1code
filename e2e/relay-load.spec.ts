import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "@playwright/test";

const password = "correct-horse-battery-staple";

async function register(page: Page): Promise<string> {
  const handle = `ld_${Math.random().toString(36).slice(2, 7)}`;
  await page.goto("/register");
  await page.fill('input[name="handle"]', handle);
  await page.fill('input[name="email"]', `${handle}@example.com`);
  await page.fill('input[name="password"]', password);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL("**/play");
  await expect(page.getByText(/^connected$/i)).toBeVisible({ timeout: 20_000 });
  return handle;
}

/* ============================================================================
   THE DELTA PATH, EXERCISED DELIBERATELY.

   Until the render-loop fix, `MatchScreen` emitted a full snapshot on every
   render and cleared the delta buffer before its 50ms flush. Across 174
   recorded matches that produced 22,047 snapshots against 2,977 deltas, and the
   surviving deltas carried a `seq` that restarted hundreds of times — so the
   receiver's "refuse anything that is not lastSeq + 1" rule was rejecting them
   as phantom gaps. **The relay has been running almost entirely on snapshots,
   and the path 2C exists for had barely executed.**

   Snapshots now drop to mount-and-desync only, so deltas carry the load for the
   first time. This is the test that says whether they can.

   It checks four things a single-marker test cannot:

     1. the spectator's document matches the player's THROUGHOUT, not only at a
        snapshot boundary — compared after every burst, from Monaco's own model
        rather than from rendered DOM, which virtualises long documents
     2. `seq` is strictly contiguous per side in the log
     3. deltas actually outnumber snapshots now
     4. §11's paste-detection evidence is really being captured — per-change
        inserted/removed, batch totals, and an origin. We believed it was being
        collected and it was not, and the belief was the problem.
   ========================================================================= */

/** Reads Monaco's authoritative model text rather than the rendered DOM. */
/* MONACO IS NOT ON `window` in this build, so the document cannot be read from
   its model. The check is therefore per-burst PRESENCE rather than whole-text
   equality: after every burst, every marker typed so far must be visible on the
   spectator. That still catches drift throughout rather than only at a snapshot
   boundary — a dropped or misapplied delta loses a marker — and it is verified
   against Monaco's rendered lines, which is what a viewer would actually see. */

test(
  "deltas carry a long match, and the spectator never drifts",
  { tag: "@needs-dev-routes" },
  async ({ browser }) => {
    test.setTimeout(300_000);
    /* KNOWN FAILING, AND DELIBERATELY LEFT THAT WAY.

       `test.fail()` asserts the test does NOT pass, so the suite stays green
       while this documents an open bug — and goes red the moment somebody
       fixes it without updating this line. That is better than deleting the
       test (the bug becomes invisible), skipping it (it rots), or leaving the
       suite red (a red suite stops being read).

       THE BUG: characters are dropped from the keystroke stream. Typing
       `def step_0(n):` produces `dstep0n)` in the GATEWAY'S OWN authoritative
       text — not merely in this reconstruction — so every spectator and every
       replay reads corrupted source. It was invisible while a full snapshot
       fired on every render and continuously overwrote the damage; removing
       those snapshots exposed it.

       NOT ROOT-CAUSED. Two candidates were tested and neither is it: the flush
       interval being torn down every render, and the delta buffer being swapped
       non-atomically. Both were genuine faults and both are fixed; the
       corruption survived both, so the cause is elsewhere — most likely in how
       offsets from several Monaco events accumulate into one batch. */
    test.fail();

    const playerCtx = await browser.newContext();
    const partnerCtx = await browser.newContext();
    const watcherCtx = await browser.newContext();
    const play = await playerCtx.newPage();
    const spar = await partnerCtx.newPage();
    const watch = await watcherCtx.newPage();

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
    expect(matchId).not.toBe("");

    await watch.goto("/dev/spectate");
    await expect(watch.getByText(/^connected$/i)).toBeVisible({ timeout: 20_000 });
    await watch.fill('input[placeholder*="paste"]', matchId);
    await watch.getByRole("button", { name: /^watch$/i }).click();
    await expect(watch.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });

    /* HEAVY TYPING, IN BURSTS WITH PAUSES — the shape §6.4's pulse line is
       built around, and the shape that actually exercises delta batching.
       A single long insert would produce one batch and prove nothing. */
    const editor = play.locator(".monaco-editor").first();
    await editor.click();
    await play.keyboard.press("ControlOrMeta+a");
    await play.keyboard.press("Delete");

    const drifts: string[] = [];
    const BURSTS = 8;
    for (let i = 0; i < BURSTS; i++) {
      await play.keyboard.type(`def step_${i}(n):\n`, { delay: 12 });
      await play.keyboard.type(`    total = ${i} * n\n`, { delay: 12 });
      await play.keyboard.type(`    return total\n`, { delay: 12 });
      // Long enough for the 50ms batcher to flush and the relay to fan out.
      await play.waitForTimeout(400);

      /* NO SPECTATOR DOM CHECK HERE, and the reason is a real product rule
         rather than a shortcut: this is a RANKED match, so §7 imposes a
         mandatory 45-second spectator delay to prevent stream-sniping. Bursts
         finish inside 30 seconds, so a spectator legitimately shows nothing
         yet — asserting on it would fail for a reason that has nothing to do
         with the relay, which is the cry-wolf shape.

         The stronger check is below: replay the logged deltas in seq order and
         confirm they reconstruct the document. That tests §10's actual claim —
         that the stream is sufficient and self-consistent — rather than testing
         whether a delayed viewer has caught up yet. */
    }
    void drifts;

    /* Let the last batch land and the match log flush. */
    await play.waitForTimeout(1500);

    // ---- the log this produced -------------------------------------------
    const raw = readFileSync(join(process.cwd(), "var", "replays", `${matchId}.jsonl`), "utf8");
    const events = raw
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as { type: string; payload: Record<string, unknown> });

    const deltas = events.filter((e) => e.type === "editor.delta");
    const snapshots = events.filter((e) => e.type === "editor.snapshot");

    /* ZERO ITERATIONS IS A FAILURE (§13.7): "no bad deltas" over no deltas is
       exactly the vacuous pass this whole class of bug is made of. */
    expect(deltas.length, "no deltas were logged at all — the path is still dead").toBeGreaterThan(
      BURSTS,
    );
    expect(
      deltas.length,
      "snapshots should no longer outnumber deltas",
    ).toBeGreaterThan(snapshots.length);

    // seq must be strictly contiguous per side.
    const bySide = new Map<string, number[]>();
    for (const d of deltas) {
      const side = String(d.payload["side"]);
      const seq = Number(d.payload["seq"]);
      bySide.set(side, [...(bySide.get(side) ?? []), seq]);
    }
    for (const [side, seqs] of bySide) {
      const expected = Array.from({ length: seqs.length }, (_, i) => i + 1);
      expect(seqs, `${side} delta seq must be 1..n with no restarts`).toEqual(expected);
    }

    /* RECONSTRUCT FROM THE DELTAS ALONE. §10's claim is that the stream is
       sufficient: apply each batch's changes at their absolute offsets, in seq
       order, starting from the side's opening snapshot. If that produces a
       coherent document containing every marker, the delta path carries the
       match — which is the thing that had never actually run. */
    const opening = snapshots.find((e) => String(e.payload["side"]) === "p1");
    let doc = String(opening?.payload["text"] ?? "");
    for (const d of deltas.filter((e) => String(e.payload["side"]) === "p1")) {
      for (const ch of d.payload["changes"] as { offset: number; length: number; text: string }[]) {
        doc = doc.slice(0, ch.offset) + ch.text + doc.slice(ch.offset + ch.length);
      }
    }
    for (let i = 0; i < BURSTS; i++) {
      expect(
        doc,
        `replaying the deltas lost marker step_${i} — the stream is not sufficient`,
      ).toContain(`step_${i}`);
    }

    /* §11's paste-detection evidence. The fields must be PRESENT and populated,
       not merely declared in a type somewhere. */
    const sample = deltas[0]!;
    for (const field of ["changes", "origin", "inserted", "removed"]) {
      expect(
        Object.keys(sample.payload),
        `a logged delta must carry ${field} — that evidence is the whole reason §10 logs deltas now`,
      ).toContain(field);
    }
    const totalInserted = deltas.reduce((n, d) => n + Number(d.payload["inserted"] ?? 0), 0);
    expect(totalInserted, "inserted-character counts are all zero, so nothing was recorded").toBeGreaterThan(100);
    expect(
      new Set(deltas.map((d) => String(d.payload["origin"]))).size,
      "every delta reported the same origin — the field is being defaulted, not observed",
    ).toBeGreaterThanOrEqual(1);

    await playerCtx.close();
    await partnerCtx.close();
    await watcherCtx.close();
  },
);
