# PROGRESS

## SESSION STOP — read this first

**`pnpm db:samples` is built, with both additions. THE NINE RETROFITS ARE NOT DONE — I ran out of
room and would rather hand over a working tool than nine rushed problems.** `db:verify` still names
18. Cold start: `pnpm stack`.

### `pnpm db:samples <slug>` — derive, don't type

```
$ pnpm db:samples connected-components
Connected Components (connected-components), rated 1300
validator: graph

  sample 1
    input:    "5 3\n1 2\n2 3\n4 5\n"
    expected: "2\n"   <- paste this

  sample 2
    input:    "4 0\n"
    expected: "4\n"   <- paste this

2 samples: every input validates, every output derived from the reference.
```

`--stdin` takes candidate inputs (blank line between cases) and prints paste-ready literals, so a new
sample's output is **never typed**. An expected output that was never typed cannot be mistyped — the
same move as the payload constructors: remove the possibility rather than handle the case.

### It validates as well as generates, and both failure modes were proved

**Every input goes through the problem's own validator before anything is generated.** Generating an
output for an input the problem forbids would produce a *confidently wrong* sample, which is the same
class as the seeded problem whose test data broke its own stated bound.

**Positive controls run, not assumed:**

```
$ printf '3 1\n1 99\n' | pnpm db:samples connected-components --stdin
  sample 1: INPUT REJECTED BY THE VALIDATOR — edge 0 v 99 outside [1, 3]
    A sample must obey the constraints it demonstrates.        exit 1

$ (with sample 2's expected temporarily set to "7")
    MISMATCH: the seed currently claims "7\n"                  exit 1
```

Both restored afterwards. A tool that has only ever passed proves nothing.

### The discriminator is durable and auditable

`SeedProblem.discriminator?: string | null` — a **one-line claim a reviewer can check**, separate from
`note`, which is prose a player reads. They are not the same job: auditing "do all 20 actually have a
discriminating sample" via twenty paragraphs means forming an opinion, which is the kind of check that
never happens.

**`null` is a valid answer and stating it is the point.** Some 800-rated problems are one expression
with nothing to discriminate; inventing a discriminator to fill the field would be worse than
admitting there isn't one. `verify-seed` requires the key to be **present**, not truthy — which forces
the author to decide rather than leave the question unasked.

The two done so far:

- `sum-of-two` → `null`. Two integers and a plus sign; there is no plausible wrong approach.
- `connected-components` → *"Sample 2 (`4 0`) exposes a solution that only counts vertices appearing
  in the edge list: it prints 0 where the answer is 4."*

`db:verify` now reports **36 findings across 18 problems** — each missing both its format fields and
its discriminator.

### The nine retrofits — NOT done

I built the tool and stopped. Being plain about why: nine retrofits is roughly five hours of careful
prose and sample design at the measured rate, and I did not have the room left to do it and still
verify. You said you would rather have nine correct than eighteen rushed; the same applies to nine
rushed, and a wrong `inputFormat` is worse than a missing one because a player trusts it.

What is handed over is a session that starts clean: the tool works, its controls are proven, the
discriminator field exists and is enforced, and `db:verify` names exactly what is left.

**The per-problem loop is now mechanical:**

1. Rewrite `statement` to the task alone; move the I/O contract into `inputFormat` / `outputFormat`.
2. Split `constraints` into one bound per array entry.
3. Choose a sample that exposes a specific wrong approach; write `discriminator` naming it, or `null`.
4. `pnpm db:samples <slug> --stdin` → paste the derived outputs.
5. `pnpm db:verify` → it either passes or names the problem.

### Verified this session

typecheck 7/7 · core 56/56 · build clean · `db:samples` green on both retrofitted problems, with both
failure modes demonstrated · `db:verify` fails by design naming 18.

**Not re-run this session:** the e2e suite and the probes. Nothing in this change touches the gateway,
the relay or the match path — it is seed tooling and one optional seed field — but I did not run them,
and I would rather say that than let "verified" cover work I did not check.

### Next session

1. **Nine problems retrofitted** through the loop above.
2. Then the other nine, until `db:verify` passes.
3. New problems after that.

### The claim prompt

Fades in **after** the §6.7 cinematic — `delay: dur.victory` — as a panel below the overlay's own
buttons, with the result still visible behind. A friend who just won should see that they won before
being asked for an email.

**Not one-shot.** Declining sets local state, not a flag: *"Not now"* collapses the form and the offer
is still there. Losing an account because you closed a dialog is the kind of small cruelty that costs
a user permanently.

It appears on **every** ending, not just a win — a draw or a void is still a match a guest just
played. `POST /api/auth/claim` calls `claimGuest`, which mutates the **same row**, so history follows
by identity rather than migration. A claim after the session has expired is refused with the honest
sentence: the offer is tied to that browser session, and a normal account is still available, it just
will not carry that match.

### One-click rematch, both sides

`POST /api/rematch` is **find-or-create keyed on the finished match**. Whoever presses first creates
the challenge; whoever presses second finds the same one. Both get "one click" with no new socket
protocol and no rival challenges. A simultaneous press is caught by the unique index and the loser
takes the winner's row.

**A new `Challenge` row**, as agreed — `consumedAt`/`consumedById` on the original record who took
*that* invitation, and reusing it would destroy the audit trail. The new row is **pre-consumed by the
opponent**, so the invitation is for one named person and the gateway's existing membership check
(`hostId` or `consumedById`) already stops anyone holding the code from barging in.

**Same difficulty** — a ±50 band around the problem just played, so a rematch is a rematch rather than
a different fight.

**When one side has left it degrades into the link flow**, exactly as agreed: the presser lands on the
challenge waiting screen holding a real code. Nothing special to maintain, and if the opponent comes
back it simply works.

### One schema field, and its data-loss warning checked rather than waved through

`Challenge.rematchOfId String? @unique` is what makes find-or-create possible. `db:push` warned about
data loss; the warning was **only** the new unique constraint on a column that does not exist yet, so
there was nothing to lose. Checked before accepting rather than after.

### Verified this session

**e2e 17/17** · `probe:lifecycle` PASS under both pairings · core 56/56 · smoke 5/5 · typecheck 7/7 ·
build clean · `db:verify` names 18.

**Not verified by eye:** the claim prompt and the rematch button. They need a guest match that
*finishes*, which the browser test does not currently drive to completion — it asserts the match
starts. Worth your click.

### THE REMAINING 18 — real per-problem time, now that two are done

**Retrofitting is materially cheaper than writing new**, because the algorithm, the validator, the
reference solution and the hidden tests already exist and are already verified. What is missing is
prose and samples.

| | retrofit | write new |
| --- | --- | --- |
| statement rewrite (task, no I/O) | 5–10 min | 10–30 min |
| input + output format | 8–12 min | 10–15 min |
| constraints → array | 2 min | 5–15 min |
| **samples + note** | **12–20 min** | **15–35 min** |
| validator | — (exists) | 10–30 min |
| reference solution | — (exists) | 10–90 min |
| test design | — (exists) | 15–120 min |
| **total** | **~30–45 min** | **75 min – 5.6 h** |

**Measured against the two I did:** Sum Of Two took about 20 minutes, Connected Components about 40 —
the difference is entirely the samples and the note, because Connected Components needed a sample that
made an unguessable case guessable and I had to think about which wrong approach to expose.

So **18 × ~35 min ≈ 10–11 hours**, which is **two sessions, not one**. I would rather deliver **nine
correct than eighteen rushed**, as you said — so the plan is nine next session and nine after.

### The two standards, held explicitly

**1. Every problem needs a sample that makes an unguessable case guessable.** `4 0` for Connected
Components is the model: a solution that only counts vertices seen in the edge list prints 0 there,
and the old statement made that invisible. For each of the 18 I will name, in the `note`, which wrong
approach the sample exposes — writing it down is what stops the sample being decorative.

**2. Never hand-write an expected output.** I caught my own `n=6` case only because the verifier ran
the reference solution; I had written 4 where the answer is 5. So for the 18 I will **derive every
sample output by running the reference solution** and let `db:verify` confirm rather than discover.
There is a script gap here worth closing first: the pipeline verifies outputs but has no way to
*generate* them, so the next session starts by adding `pnpm db:samples <slug>` which prints the
reference solution's output for a given input. That converts the standard from a discipline into a
tool.

### Next, in order

1. `pnpm db:samples` so sample outputs are derived, not typed.
2. **Nine problems retrofitted.** Then nine more.
3. New problems after `db:verify` passes.

### Look at this

`/play` → **Create a challenge link** → open it in another browser → accept both. Or faster: any
match that draws **Connected Components (1300)** or **Sum Of Two (800)**.

The left pane now reads in Codeforces order: title, **limits as real values** (`5s per test · 256 MB`
— the actual judge limits), **Constraints** with one bound per line, Statement, **Input**, **Output**,
**Samples** with a copy button on each input, then **Note**.

Limits and constraints are at the **top** deliberately: deciding whether an O(n²) approach fits is the
first decision a competitive programmer makes and it happens before reading the task properly.
Burying them under prose costs time nobody has.

### The audit you asked for: 20 of 20

**Every problem had `Input:` / `Output:` fragments jammed inside the statement string.** Not some —
all of them. So the retrofit is not cosmetic: you were right that matches have been decided partly by
who guessed the format, because there was nothing to read.

`statement`, `inputFormat`, `outputFormat` and `note` are now separate fields, and the renderer gives
each its own heading. A format fragment cannot be buried in prose again because prose has nowhere to
put a heading.

### Constraints: structured data, not markup

`constraints` is now **`string[]`** — one bound per entry — rather than a string with formatting baked
in. The reasoning, which is in the type: a single string invites divergence, one author writing
`1 ≤ n ≤ 10^5` and the next `1 <= n <= 100000`, and the renderer cannot reconcile them because the
decision was already made. As an array **the author supplies facts and the renderer owns typography**,
so all 20 look the same by construction rather than by everyone remembering a convention.

All 20 were converted mechanically. **The conversion itself had a bug worth recording:** my first pass
split on commas as well as newlines, which turned `-10^9 <= a, b <= 10^9` — one fact about two
variables — into two half-truths. Reverted and redone splitting only on newlines.

### Connected Components, before and after

Before, the whole contract was `"Input: n m, then m edges u v Output: a single integer"`. It never
said whether `n m` share a line, whether edges are one per line, or what happens when `m` is 0.

After, `inputFormat` states all three, plus that edges may repeat and may be self-loops.
`outputFormat` states that trailing whitespace is ignored. Two samples with a note explaining each,
and the second sample is `4 0` — no edges at all — because **a solution that only counts vertices it
saw in the edge list prints 0 there**. That is the case the old statement made unguessable.

### The pipeline caught my own bad test immediately

I hand-wrote a hidden case `n=6` with only `3-4` joined and asserted **4** components. The verifier
ran the reference solution and said **5** — I had forgotten vertex 6. Fixed to 5.

That is exactly the failure mode you named about samples: a wrong expected output is worse than none,
because it is trusted. It took one run to catch and would have taken a player a very confusing match.
**102 test cases now agree with their reference solutions**, up from 101.

### One flaky test, found and fixed before it could lie

The render assertions first passed **by luck**: the host's band defaults around their rating, so which
problem the match drew was random, and the assertions would pass or fail depending on whether that
problem had been retrofitted. The test now mints with an explicit band of `1300–1300`, which is
Connected Components and nothing else. **A test that passes because of a random draw is not a test.**

### Verified this session

**e2e 17/17** (challenge now asserting all five problem sections, the limits, and a copyable sample) ·
`probe:lifecycle` PASS under both pairings · core 56/56 · smoke 5/5 · typecheck 7/7 · build clean ·
`db:verify` fails naming **18**.

### NOT done — the guest funnel

I did not start it, and I want to be plain rather than imply otherwise. You listed it first and it is
the more important of the two for a real invited player; I chose the problem work because you asked to
see the two rendered **before** the other 18, and that gate is worth more than a partial funnel.

What it needs, unchanged and fully specified:

- **Claim prompt** on the result screen, after the §6.7 cinematic lands rather than over it, with the
  match visible behind. `claimGuest` already keeps the same row. **Not one-shot** — a guest who
  declines must still be able to claim while the session lives, so it is a persistent affordance on
  that screen, not a modal that is dismissed forever.
- **One-click rematch**, both sides. My answers to your two questions: it should **create a new
  `Challenge` row**, because the existing one is consumed and `consumedAt`/`consumedById` are the
  record of who took *that* invitation — reusing it would destroy the audit trail and make a second
  match indistinguishable from the first. And when one side accepts and the other has left, the
  accepter should see the ordinary challenge waiting screen with the code, so it degrades into exactly
  the link flow that already works rather than into a special case.

### Next, in order

1. **The guest funnel** — claim prompt and one-click rematch.
2. **The remaining 18**, until `db:verify` passes.
3. **New problems**, continuing every session.

### The deliverable, verified two ways

**`probe:lifecycle` runs BOTH pairing paths against the same assertions:**

```
matchmaking:  MATCHED → ACCEPTING → COUNTDOWN → LIVE → JUDGING → ENDED   rated: true
challenge:    MATCHED → ACCEPTING → COUNTDOWN → LIVE → JUDGING → ENDED   rated: false
              problem: topological-order rated 1500 (band 1450–1550)
```

Identical state sequence, identical log shape, hold announced, reconnect resyncing with the problem,
a Crockford spectator code on both. `assertCanonical` is called unchanged for both — **if a challenge
match needed different assertions it would be a different lifecycle, which is the whole thing this
was written to prevent.**

**§8's guest-band rule is asserted, not assumed.** The band is deliberately `1450–1550`, far from any
mean − 120 result: if the guest's placeholder 1200 leaked into selection the problem would land near
1080 and outside the band. It landed at 1500.

**Browser: 3 new tests, 17 total.** A link generated, opened in a **separate context with no session**,
played to a live match with Monaco on both sides; a guest refused when minting a link (403); a stale
link showing an answer rather than a 404.

### What it is made of

- **`POST /api/challenge`** — host picks the band (defaults around their own rating), 24h expiry,
  `UNLISTED`, `allowGuest`. Refuses if no problems exist in the band, because a link that cannot
  produce a match is worse than no link.
- **`GET/POST /api/challenge/<code>`** — redemption. The take is `updateMany` with
  `consumedAt: null` in the WHERE, so two people opening simultaneously cannot both win.
- **`/c/<code>`** — the invited side, written for someone who has never heard of us. No registration
  wall. A stale or taken link shows who challenged whom and offers **send one back**.
- **`challenge.join` on the gateway** — a second *pairing* path into the **same** `createMatch`. Not a
  second creation path: lifecycle, log, accept window, countdown, hold and settlement are the code
  matchmaking already uses.
- **Guests** — `lib/guest.ts`: credential-less `User` + ordinary session cookie, `guest-7f2a`, the
  claim that mutates the same row, and `sweepGuests` (24h unplayed / 7d played, deleting only guests
  with no `Match` rows).
- **`pickProblem(…, band?)`** — §8's rule in code: a band **replaces** mean − 120 and neither rating is
  read when one is supplied.

### Three bugs found by running it

1. **The waiting slot went stale.** My first pairing kept an in-memory slot per code. React
   StrictMode double-mounts effects in dev, so the first socket connected, emitted, and was torn
   down — deleting the session and leaving a slot pointing at an identity that no longer existed. The
   second arrival found a stale partner, took its place, and both sides waited forever. **Fixed by
   deriving membership from the `Challenge` row** (`hostId`, `consumedById`) instead of accumulating
   it: there is no state to go stale.
2. **The spectator chip had no accessible name for its purpose.** Its visible text is the code, so the
   accessible name was the code and `title` was ignored. Now an `aria-label` — better for a screen
   reader, and the reason the test could not find it.
3. **A bug in my own test:** the guest page was opened with `page.context().newPage()`, which shares
   cookies, so the "guest" carried the host's session and the refusal never applied. **A test that
   shares an identity between two roles is testing neither.**

### Verified this session

`probe:lifecycle` PASS under **both** pairings · **e2e 17/17** · core 56/56 ·
`probe:visibility` 10/10 · `probe:latejoin` 6/6 · smoke 5/5 · typecheck 7/7 · build clean ·
`db:verify` fails by design, naming all 20 problems.

### Not done, deliberately

- **Rematch in one click** from the result screen. The pairing already exists, so this is a button that
  re-runs `challenge.join` — small, but not written, and I would rather say so than imply it.
- **The claim flow's UI.** `claimGuest` exists and keeps the same row; nothing calls it yet, so a guest
  currently cannot convert. This is the next thing after the problem format.
- **`sweepGuests` has no scheduler.** The function is written and correct; nothing runs it. It belongs
  on a cron in Phase 2E deployment.

### Next, in your order

1. **Two problems retrofitted + rendered**, then stop and show you. Samples in monospace blocks with a
   copy button per input, limits and constraints at the top. Prisma fields exist and samples are
   already verified byte-for-byte, so this is rendering work.
2. **The remaining 18**, until `db:verify` passes.
3. **New problems**, continuing every session.

### The template for a hand-written problem

Drop this straight into `PROBLEMS` in `packages/db/src/problems.ts`. `pnpm db:verify` checks every
field and every sample against the reference solution and refuses disagreement.

```ts
{
  slug: "kebab-case-unique",
  title: "Title Case",
  topic: "MATH" | "DP" | "GRAPHS" | "GREEDY" | "STRINGS",
  rating: 1700,                 // Glicko scale (§8). Same axis as players.
  validatorKey: "…",            // a key in packages/db/src/validators.ts
  statement:  "Setup and task. NOT the I/O contract.",
  inputFormat:  "Line 1: n (…). Line 2: n integers separated by spaces.",
  outputFormat: "A single integer. Trailing newline is ignored.",
  constraints:  "1 <= n <= 2*10^5\n-10^9 <= a_i <= 10^9",
  note: "In sample 1, … which is why the answer is 7. In sample 2, …",
  tests: [
    { input: "3\n1 2 3\n", expected: "6\n", isSample: true },   // >= 2 samples
    { input: "1\n-5\n",    expected: "-5\n", isSample: true },
    { input: "…",            expected: "…" },                     // hidden
  ],
}
```

**What I need from you, precisely:**

- **All seven text fields.** `inputFormat` must say whether the first line is a count and how values
  are separated; `outputFormat` must say whether trailing whitespace matters. A player who has to
  guess loses a minute of an eight-minute match.
- **`constraints` must match the validator exactly.** The validator is the source of truth. If they
  disagree, §6.8's hack phase would police a promise the problem broke — and one of the original 20
  had test data violating its own stated constraint, caught by running rather than reading.
- **At least two samples**, and a `note` explaining *each* one. The note is what teaches the format
  and it is the field most likely to be skipped.
- **A reference solution** in `packages/db/src/solutions.ts` under the same slug, Python 3.

**What makes an anti-heuristic test good enough** — the part that does not compress, and why the
1700+ band is yours:

- It must **defeat a specific named wrong approach**, not be merely large. "n = 200000" is a
  performance test; "the greedy picks the locally cheapest edge and this case makes that globally
  wrong" is an anti-heuristic test. Write down which approach each one kills.
- Cover **at least three**: the plausible greedy, the off-by-one at a stated bound, and the overflow
  that only appears at the constraint's maximum.
- Include the **boundary itself** — `n` at its minimum and at its maximum — because those are where
  correct-looking code fails.
- A wrong solution that passes your tests is invisible until someone exploits it, which is why this is
  judgement rather than typing.

## What class of check would have caught this — and what is still eye-only

**Asked for after the third bug of the same shape. This is the list, not another one-at-a-time fix.**

### The shape all three share

`--ulimit nproc`, the RSC seam, and the 404'd assets are the same failure: **the assertion was true
and irrelevant, because the check and the user sat in different layers.**

| | what was asserted | what the user experienced |
| --- | --- | --- |
| `nproc` | "no escape was observed" | nothing ever executed |
| RSC seam | the route handler accepts JSON | the form posted through the RSC protocol |
| assets | the route returns 200 | the assets that route references 404'd |

The generalisation of §11's *assert the mechanism, not the absence*: **assert at the layer the user
occupies, and follow the artifact's own references rather than only the URL you chose to request.**
Every check in this project so far asserted on a response to a request *I* composed. None asked what
a client would then do with it. That is the missing class, and `smoke.test.ts` is the first member.

### Machine-checkable, and currently NOT checked

These *feel* like they need eyes. They do not. Each is a design requirement in CLAUDE.md that can
silently regress with nothing reporting it, exactly like the stylesheet did.

1. **Fonts actually load.** `next/font` emits files; if they 404 the entire type system falls back to
   system sans and the product still "works". This is the identical failure mode to bug 1 and it is
   not covered — the smoke test checks CSS and JS, not font assets. **Highest priority.**
2. **Glow at rest (§4).** The spec says audit the *built* CSS: every shadow rule must be a `:hover`,
   a one-shot event class, or the sub-ten-second clock. Done once by hand, never since. Pure grep on
   the compiled stylesheet.
3. **No hardcoded hex (§13.2).** Grep source for `#[0-9a-f]{3,8}` outside `tokens.css`. One line.
4. **Contrast ratios (§4).** The 4.5:1 claims for P-colored text on `--surface` and `--ink` text on
   P-colored buttons are computable from the tokens. Currently asserted in prose only — edit a token
   and the claim goes stale in silence.
5. **Colorblind separation floors (§4).** P1/P2 ≥ 1.70 deuteranopia, `--fail` vs P2 ≥ 1.60,
   `--grandmaster` vs `--fail` and vs `--p2`. All computable. Same staleness risk, and §4 explicitly
   says *verify with a dichromat simulation, not by eye* — so this one is arguably wrong to leave to
   eyes at all.
6. **Tabular numerals (§4).** Every clock, rating and score must be `tabular-nums`. Assertable on the
   components.
7. **Mirrored corner cuts.** P1 cuts TL/BR, P2 mirrors. Checkable in built CSS.
8. **Reduced-motion parity (§5, §13.9).** Every animation honoured in the same commit that writes it.
   Partly static (every animating component under the motion-pref provider), fully checkable with a
   browser forcing the media query.
9. **Focus visible everywhere (§13.9).**
10. **No horizontal overflow at 1280px and at mobile (§13.8).**
11. **60fps and no layout thrash during a match (§5).** Needs browser tracing. Hard, not impossible.

**Items 8–11 need a real headless browser, which this project does not have.** Adding Playwright
would move most of this list from "eye-only" to "tested", and would also have caught bugs 1 and 2
directly — a browser that renders `/register` and clicks the button finds both in one assertion.
**§13.3 says ask before adding a dependency, so I am asking rather than adding.** It is dev-only and
does not touch the shipped bundle.

### Genuinely eye-only — judgment, not verification

No check will ever settle these. They are why §13.7 exists.

1. **The §2 verdict.** Does it read as a fighting-game HUD in the language of a code editor, or as a
   generic dark dashboard with neon accents? This is the whole brief and it is unfalsifiable by test.
2. **Motion feel.** ζ and overshoot are computed and asserted; whether 10.4% overshoot *reads* as an
   impact rather than a bounce is taste. Same for `dur.reveal` at 165ms reading as tense not frantic.
3. **Cinematic pacing.** Whether the 60ms offset in the queue pop reads as a collision.
4. **Saturation as reward (§2.2).** Whether the resting UI genuinely feels muted, so that a passing
   test *lands*.
5. **Typography in situ.** Martian Mono at 48/72px, optical letter-spacing, whether the display type
   carries the weight the brief wants.
6. **Colour on real hardware.** ΔE is computed; how the palette sits on your panel is not.
7. **Whether it feels like a match.** The actual product thesis.

**The split matters more than either list.** Items 1–11 above were being treated as category-two —
"can only be checked by looking" — when they are category-one and were simply untested. That
misfiling is what produced three bugs of the same shape. The eye should be spent on the seven things
below, not on catching 404s.


## Corrections round — an invariant that caught a live exploit

**The INTERNAL_ERROR invariant is now a test class, and it found a real match-voider on its first
run.** A lone surrogate in submitted source raised `UnicodeEncodeError` inside the runner, which
surfaced as an internal error — and by §6.9 an internal error VOIDs the match with no rating change.
A losing player could have annulled any match by submitting one unpaired UTF-16 code point. Source
encoding is now total: unencodable characters become U+FFFD and the source fails compilation on its
own merits, which is a verdict it has earned.

**Containment suite: 26 tests**, up from 14. The new class aims at the judge rather than the sandbox
— binary garbage, null bytes, lone surrogates, enormous single-line files in both languages,
gigantic valid output, gigantic compiler diagnostics, a program that closes its own stdout or kills
its own process group, empty source, and every input that has ever produced INTERNAL_ERROR, kept as
a permanent regression. §11 now states that a path from user code to INTERNAL_ERROR is a security
bug, fixed at that priority.

**The enumeration figure was wrong by 1000× and is corrected.** I converted expected *guesses*
straight into seconds. At a million concurrent live matches and 1000 guesses/second the real answer
is **13 days**, not 35 years. At today's scale (~300 live) it is 119 years, so the conclusion held
by accident rather than by argument. The fix is not more entropy but a rate limit: 20 failed
`/watch/<code>` lookups per minute per IP takes the million-match case back over a century. Both the
spec and the source comment now carry the real table, and the source comment records the error.

**Compile CPU was not measured at all** — only execution wall time — so it could not have been
billed against any budget. The runner now measures real CPU via `getrusage(RUSAGE_CHILDREN)` for the
compile step and every test, reporting `cpuMs` per phase and a total. §11 specifies rolling
ten-minute budgets of **120 CPU-seconds per user** and **240 per IP**, with per-IP applying only to
accounts under 24 hours old so shared NAT does not throttle itself. A legitimate heavy C++ iterator
spends ~100 CPU-seconds in an eight-minute match against a 120 budget, and hits the §6.8b in-flight
lock long before the budget.

**Spectator fanout: reduce load rather than raise the ceiling.** Spectator deltas batch at 200ms,
and at 500ms on ranked where a 45-second delay already exists. That is 4× and 10× fewer messages for
a difference no viewer can perceive, moving the ceiling from ~500–1000 viewers to **~4,000 and
~10,000**. Batching relocates the bottleneck rather than removing it: past those numbers per-socket
memory and file descriptors bind at roughly **5,000–10,000 sockets per process**.

**Known-incorrect solutions** added to the problem pipeline spec as optional, with the standard that
they must fail on an edge case rather than on test 1, must be verified to actually fail, and that
the bot simply never submits when it draws a losing plan on a problem that lacks one.


## Phase 2B-3 — STOPPED PARTWAY, splitting again

Four design decisions settled and written into the brief, plus the bot's entire foundation and auth
end to end. **The match screen and the live bot are not done** — that is 2B-4. Stopping rather than
half-wiring the cinematics.

### The four decisions

**1. Bot rating integrity — rated only while RD is high.** Four options considered; three lose.
Unranked leaves the ladder blank rather than fictional, which is not better. Reduced impact has no
honest lever — Glicko-2 has no K-factor, so you fake it by inflating the bot's RD, which also stops
the bot's rating converging. A daily cap invents a chore and only delays a determined farmer.

So: **bot matches are rated during placements or while `RD > 100`, unrated after.** It uses Glicko's
own uncertainty measure instead of an invented threshold, it serves the actual need (placement, for
exactly the players who cannot find humans), and **the farm closes itself** — every bot win lowers
your RD, walking you toward bot matches not counting. The ceiling is the bot's own rating (~1460),
a plausible placement rather than a ladder position. No cliff, because RD moves continuously. The
bot's own rating is fixed and never updated: it is a measuring stick, not a competitor.

**2. The bot submits real source through the real judge.** Not scripted — a scripted outcome means
bot matches exercise a different code path from human matches, which is the path that then breaks in
production. All 20 problems now ship a known-correct Python 3 solution, and **every one is verified
ACCEPTED by the real judge** (`pnpm db:solutions`). Solve time is drawn in two stages so the win
rate is correct by construction: *whether* it solves comes from the Elo expectation, *when* comes
from a lognormal whose median scales with the rating gap.

**3. The judging hold is a §6 beat, not a spinner** — new §6.7b. Editor stays locked, your verdict
*docks* to your side of the HUD as a settled chip, the opponent's bar takes an indeterminate sweep
that must never read as progress, the clock is replaced by `AWAITING VERDICT`, and resolution is
immediate when the last verdict lands. The same screen carries both charges — passed and hoping they
were slower, or failed and hoping they failed too — and the difference is one chip's colour. The
hold is bounded: a verdict that never arrives resolves as `INTERNAL_ERROR` rather than hanging.

**4. Resubmission: unlimited, +30s each failure, one outstanding at a time** — new §6.8b. Elapsed
time is already the tiebreak so it is the natural currency, and it matches §6.8's hack penalty. Free
resubmission would make §6.5's near-miss shatter theatre. **One outstanding submission per player is
what actually bounds judge load** — two concurrent jobs per match no matter how hard anyone mashes,
which is stronger than a rate limit; the global limiter stays as a backstop and does not conflict.

### Built and verified

- `packages/core/bot.ts` — solve probability, solve-time model, rating-integrity rule. **11 tests**,
  including one that runs 4000 planned matches and asserts the observed win rate matches the Elo
  expectation within 3%, and one that walks RD down and asserts the farm closes.
- `packages/db/solutions.ts` — 20 Python solutions. **All 20 ACCEPTED by the real judge.**
- **Auth end to end at the library level**: 12 checks passing — scrypt round-trip, salting, rejection
  of wrong passwords, new-user defaults, high-entropy session token, and the gateway resolving a real
  cookie to a user, rejecting garbage, rejecting expired, and deleting the expired row on sight.
- `/register` and `/login` pages with server actions, wired to session creation and redirecting
  to `/play`.
- **Split `password.ts` out of `auth.ts`.** The password primitives imported `next/headers`
  transitively, so they were unusable and untestable outside a Next request — including from the
  gateway. Pure crypto has no business depending on a request context.

**Totals: 42 core tests, 10 matchmaking, 14 judge containment, 101 seed cases, 20 bot solutions.**
7/7 typecheck, build green.

### Not verified

The **browser cookie round-trip** — register in a form, get a cookie, land on `/play` authenticated.
Server actions need the RSC protocol, so curl cannot drive them and there is no browser here. Every
link either side of that is verified; the form submission itself is not.

### 2B-4, the remainder

Submission persistence with the §6.9 receipt stamp; the match screen wired to Phase 1's animations
on real events; the bot actually playing (FakeTypist pulse line, timed submission through the judge);
Glicko-2 applied to real outcomes with the pre-match rating captured for the delta count-up; the
§6.7b judging-hold screen.

---

## Phase 2B — STOPPED PARTWAY, needs splitting

**I am stopping and asking for a split rather than pushing through.** You pre-authorised this and I
think it is clearly the right call: what remains is not "a bit more work", it is the entire
networking and UI half of 2B, and doing it badly in the time left would produce an end-to-end demo
held together with assumptions I could not verify.

### Done this session

Both spec rules, which you wanted before any 2B code, and the **pure, fully-tested core** that the
networking layer will sit on. **31 tests, all passing.**

| | |
| --- | --- |
| §11 | Time discipline as a system-wide rule, with the three-field event contract |
| §6.9 | New: receipt order decides matches, and the `JUDGING` hold |
| `packages/core/time.ts` | `monotonicMs`, `Stopwatch`, `Deadline` |
| `packages/core/glicko.ts` | Glicko-2 + RD decay, **8 tests** |
| `packages/core/match-machine.ts` | 8-state lifecycle, **15 tests** |
| `packages/core/event-log.ts` | JSONL log with `seq`/`offsetMs`/`wallMs`, **8 tests** |

**Glicko-2 is verified against Glickman's published worked example** — 1464.06 / 151.52 / 0.05999,
which is the only real check on the volatility solver since every other step is closed-form.

**On the rating-period question:** RD growth is applied lazily rather than on a schedule.
`decayedDeviation` computes `φ* = √(φ² + σ²·t)` with `t` in rating periods (one period = one day) and
runs on both players immediately before every match update. Without it, per-match application means
an inactive player is simply never touched, so the system stays maximally confident about someone it
has not observed in a year. Tested: a returning player's rating moves further than an active one's.

**The fairness property from §6.9 is a test, not a comment.** `receipt order decides the match, not
verdict order` drives p1 submitting first, p2's verdict returning first — exactly what happens when
p1 wrote C++ (~5.5s) and p2 wrote Python (~1.8s) — and asserts p1 wins.

**The clock property is a test too.** `ORDERING SURVIVES A BACKWARD CLOCK STEP` builds a log whose
later events carry *earlier* wall clocks, asserts replay order is unaffected, and then asserts that
sorting by timestamp really would have corrupted it. That is the 2514ms WSL2 clock step encoded as a
regression test.

Also added `erasableSyntaxOnly` to the base tsconfig: this repo runs `.ts` directly through Node's
strip-only loader, which rejects enums, namespaces and parameter properties at *runtime*. A
parameter property in the event log was caught that way; the flag turns it into a compile error.

### Not started — the proposed split

**2B-1 (this session, done):** contracts, time, ratings, state machine, event log.

**2B-2 — the gateway.** `packages/proto` socket schemas; Socket.IO gateway with presence,
reconnection and the grace-period timers; Redis matchmaking with §6.1 band widening and §8's
mean − 120 with adaptive spread; the state machine wired to real sockets with every transition
logged; the JSONL log written for real matches. Deliverable: two tabs match, accept, count down, and
reach `LIVE` with a real event log on disk.

**2B-3 — the match.** Auth UI end to end; submission persistence; the match screen wired to Phase 1's
animations with Monaco local-only; the bot opponent reusing `FakeTypist`; Glicko-2 applied to real
match outcomes. Deliverable: your end-to-end — register, queue, match, solve, submit, verdicts
stream, rating changes.

I would rather hand you 2B-2 and 2B-3 working than 2B looking finished.

---

## Judge hardening ✅ verified

Six items plus a rate limit, all verified by execution. §11 now carries the whole flag set, the
compile-budget rules, the monotonic-clock rule, and the `nproc` trap written up as a warning.

**Suite: 14/14 pass**, up from 10, including two new counterpart tests.

### 1. Positive control

A canary runs before anything else, per language image: Python must print `42`, and the C++ image
must compile a program into the exec-mounted tmpfs and run it. If either fails the suite prints a
**VOID** banner and aborts — it does not skip, it does not continue, and it exits non-zero.

Verified by deliberately re-introducing `--ulimit nproc=64:64` and re-running:

```
canary FAIL 1v1-judge-python3: expected "42", got "(nothing)"
            — exec /usr/local/bin/python3: resource temporarily unavailable
canary FAIL 1v1-judge-cpp17:  ... exec /usr/bin/sh: resource temporarily unavailable
CONTAINMENT SUITE VOID
ℹ pass 0   ℹ fail 0   exit 1
```

The old suite reported **10/10 green** on that exact breakage. Every containment test now also
asserts the *mechanism* fired — pid ceiling reached (>8 forks, <200), exit 137 or `MemoryError`,
`outputCapped` true with >128 KB actually captured, `CapEff` readable and zero, files opened before
the nofile cap bit. "No escape observed" is no longer sufficient to pass anything.

### 2. Compile time is separate from run time

**Answer to the question: compilation runs in the same container as execution** (one container per
submission, per §11) **but on its own budget** — 10s wall clock and 10s CPU, independent of the 5s
per-test execution limit. Splitting it into a second container would mean shuttling the binary
between containers over stdout, which buys nothing the separate budget doesn't already give.

New verdicts `COMPILE_TIMEOUT` and `COMPILE_MEMORY` in proto and the Prisma schema. Resource
exhaustion is no longer reported as `COMPILE_ERROR`, which would tell a player their correct code
is malformed.

Two traps found while building this, both caught by running it:

- **`RLIMIT_AS` is wrong for a compiler.** It caps virtual address space, and g++ reserves far more
  VA than it resides — a 208 MB ceiling rejected a plain `#include <bits/stdc++.h>`. The compiler
  is now bounded by the cgroup only. The execution path keeps `RLIMIT_AS`.
- **Never raise a hard rlimit in the container.** `--ulimit` already pinned `nofile` to 64 and
  `fsize` to 8 MB; asking for more inside `preexec_fn` throws `ValueError` and surfaces as an opaque
  *"Exception occurred in preexec_fn"*. All limits now clamp to the existing hard ceiling.

### 3. Compile bomb

Preprocessor token explosion — eight-fold expansion nested four deep, ~16M tokens from five lines.
Contained in **1.9s** as `COMPILE_MEMORY`. Required one fix: g++ is a driver, so when the cgroup
kills `cc1plus` the driver survives and prints *"Killed signal terminated program cc1plus"*; without
mapping that, the most effective compile bomb in existence reads as a syntax error.

Paired with **"a legitimate heavy include still compiles"** — `bits/stdc++.h` must reach `ACCEPTED`.
A limit that rejects correct programs is a worse bug than the one it prevents.

### 4. Worker resilience and orphan reaping

Malformed jobs are now rejected in-loop rather than thrown to the generic handler, which slept a
second before retrying — anyone able to push to the queue could have throttled the worker to one job
per second with garbage. `uncaughtException` and `unhandledRejection` log and continue. Verified
against unparseable payloads, missing fields and a bogus language enum: all three rejected cleanly,
worker alive.

`apps/judge/src/reaper.ts` runs as its **own process** and kills any container labelled
`com.1v1.judge=1` older than 30s. It deliberately does not import the worker — the case it exists
for is the worker dying. Verified: killed a 5s-old container at a 2s threshold, none left behind.

### 5. Concurrency and what it costs

**Default 4 slots, hard ceiling 16.** Concurrency is a straight multiplier on worst-case memory:
**256 MB × slots**, so 4 = 1 GB. Size against measured free memory, not core count — these jobs are
memory-bound long before CPU-bound, and each container is already pinned to half a core.

Measured job times: Python 5 tests ≈ **1.8s**, C++ 5 tests ≈ **5.5s** (compilation dominates at
~4s). At a mixed ~3.5s average and 4 slots that is roughly **1.1 jobs/second sustained**. A burst of
20 simultaneous submissions drains in about **18s**, with the last player waiting that long for a
verdict. Sustained arrival above ~1.1/s grows the queue without bound — which is the intended
failure mode: the queue backs up, the machine does not fall over.

### 6. fsize and nofile, verified rather than assumed

Both are per-process rlimits, so neither repeats the `nproc` mistake — but that was checked, not
assumed. `fsize` capped at 8 MB (verified: a 400 MB write to /tmp fails while a small write
succeeds); `nofile` capped at 64 (verified: some files open, then the limit bites). The canary
re-ran green after both, which is the actual point of the exercise.

### Rate limit

Per-identity, two fixed windows: **3 per 10s** and **30 per 5min**. Keyed on user id when signed in,
source address otherwise. Verified: three submissions returned 200, the fourth returned **429** with
`Retry-After`.

### One bug found along the way that is not in your list

**`Date.now()` is not monotonic on this host.** The WSL2 system clock was measured stepping
*backward* 2514ms inside a 20-second window, which made a container that ran 6.4 real seconds report
3.8 and produced a genuinely impossible test result (`timedOut` true at 3812ms on a 6000ms timer).
All judge duration measurement now uses `process.hrtime.bigint()`. This is not cosmetic: submission
runtimes could have gone negative, and in 2B **final elapsed time is the match tiebreak** (§6.8).

---

## Phase 2A — Persistence and execution ✅ verified end to end

## Environment

The repo lives at `~/1v1.code` inside **WSL2 Ubuntu 24.04**. Ignore any Windows paths in older
notes — the project was authored on Windows and moved, and `.gitattributes` now pins LF so the
platform a file was last edited on never shows up as a diff.

| | |
| --- | --- |
| OS | WSL2 Ubuntu 24.04, kernel 6.18 |
| Docker | **Engine 29.6.2, native** — not Docker Desktop |
| cgroups | v2, systemd driver; seccomp builtin profile; not rootless |
| Node | 24.18.0 |
| pnpm | 11.17.0 |
| Postgres / Redis | 17-alpine / 7-alpine, via `docker-compose.yml` |

Running Docker Engine natively rather than through Docker Desktop means containers are ordinary
Linux containers on the WSL2 kernel, with no VM boundary in between and no Desktop-specific
behaviour to account for.

```
docker compose up -d          # Postgres 17 + Redis 7
pnpm install
pnpm db:push && pnpm db:seed  # schema + 20 problems
pnpm judge:images             # build the two judge images
pnpm judge                    # the worker
pnpm dev                      # http://localhost:3000/dev/judge
pnpm judge:test               # the containment suite
pnpm db:verify                # 101 seed cases vs reference solutions
```

### Verified

- **Containment: 10/10 pass.** Network unreachable, DNS dead, fork bomb capped, memory capped,
  infinite loop killed, stdout capped, rootfs read-only, tmpfs writable but size-capped, uid 1000
  with zero capabilities, no Docker socket. Observed directly, not just asserted: the fork bomb
  stops at **exactly 63 forks** (`--pids-limit 64` minus the python process), the memory bomb exits
  **137** (SIGKILL from the cgroup OOM killer), and `CapEff` reads `0000000000000000`.
- **The judge runs.** Both images build; C++17 and Python 3 both compile and execute; results
  stream one test at a time through Redis → SSE → browser.
- **All eight verdict classes produced from real submissions:** `ACCEPTED`, `WRONG_ANSWER`,
  `COMPILE_ERROR` (both languages), `TIME_LIMIT`, `MEMORY_LIMIT`, `OUTPUT_LIMIT`, `RUNTIME_ERROR`.
- Postgres round-trips: schema pushed, 20 problems seeded, `/dev/judge` renders them.
- 5 packages typecheck, web builds, 101 seed cases agree with reference solutions.

### Four bugs that only execution could find

The sandbox had never run, and it was broken in four separate ways. Every one of these was
invisible to typechecking, code review, and the flag list itself.

1. **`--ulimit nproc=64:64` made the sandbox unable to start anything at all.** `RLIMIT_NPROC` is
   per-UID and **system-wide — it is not namespaced by the container**. With `--user 1000:1000` on
   a host whose login user is also uid 1000, the host's own processes counted against the
   container's allowance and `exec` failed with `EAGAIN` before any code ran. Removed;
   `--pids-limit` is the cgroup-scoped tool that actually does this job. A "belt and braces"
   addition that silently broke the brace.
2. **`packages/proto/src/index.ts` used an extensionless import**, which a bundler resolves and
   bare Node ESM does not — so the judge worker died at startup. All shared packages now use
   explicit `.ts` specifiers, with `allowImportingTsExtensions` set where they're typechecked.
3. **The C++ image installed `python3-minimal`**, which omits large parts of the stdlib including
   `json`. The runner died on its own import line, so every C++ submission returned
   `INTERNAL_ERROR`.
4. **A print flood killed the runner instead of being reported.** `subprocess.communicate()`
   buffers all output in memory, so `while True: print(...)` grew the runner's heap until the
   container's own cgroup limit killed it — contained, but the judge died with it and reported
   `INTERNAL_ERROR` rather than `OUTPUT_LIMIT`. The runner now reads stdout incrementally through a
   selector with a hard byte cap and kills the child at the cap. The same rewrite fixed
   `MEMORY_LIMIT`, which had been misreported as `RUNTIME_ERROR` because `RLIMIT_AS` surfaces as a
   clean `MemoryError` rather than a SIGKILL.

### Still not verified

- **Auth has never issued a session.** The code is written and typechecks, but no user has
  registered, logged in, or had a cookie round-trip. There is no UI for it yet.
- Submissions are not persisted — `/dev/judge` streams verdicts but writes no `Submission` row.
  That wiring belongs with the match flow in 2B.

### Judge design notes

- **Nothing is bind-mounted.** The job goes in over stdin and results come back as JSONL on stdout.
  That removes mount-based escapes from the design and sidesteps Windows/WSL2 path translation,
  which is slow and permission-strange for bind mounts.
- **§11's flag set plus four additions** it doesn't name: `--cap-drop ALL`,
  `--security-opt no-new-privileges`, `--memory-swap` pinned equal to `--memory` (without it Docker
  grants swap equal to the limit, so `256m` silently means 512m), and four `--ulimit`s under the
  cgroup ceilings.
- **`--tmpfs /tmp` is mounted `exec` deliberately.** A compiled C++ binary has to run from
  somewhere, and the process is executing attacker code by definition — `noexec` there would break
  C++ without removing any capability the attacker lacks.
- **The 5s wall clock is enforced by the worker, not Docker.** Docker has no kill-after-N-seconds
  flag; `--stop-timeout` only affects `docker stop`. The worker kills the *container* by name rather
  than the CLI process, because killing the client orphans the container and it keeps burning CPU.
- **Output is capped at 1 MB in the worker** and 256 KB per test in the runner. Docker will not do
  this for you; an unbounded `print` loop otherwise fills a pipe and then a disk.
- **Results stream one test at a time.** §11 is explicit, and §6.6's sequential reveal is built on
  it — a judge that returns an array at the end silently kills the best beat in the product.
- **The worker refuses to start without Docker** when `JUDGE_STRICT=1` (the default). A judge that
  degrades to running untrusted code on the host is worse than one that is down.

### Validators

Every problem carries a `validatorKey` into a registry in reviewed source. The validator is
deliberately **not** stored as source in a database column: it must execute server-side to police
hack inputs (§6.8), and a row containing executable code is a code-injection surface one bad admin
form away from RCE. `assertSeedIntegrity` refuses to seed a problem whose key is unknown, so there
is no path to a problem without one.

### Auth

Email/password via `node:crypto` scrypt with per-user salts and a constant-time compare; sessions
are opaque database rows, not JWTs. Both avoid a dependency (§13.3) without weakening anything —
scrypt is memory-hard and in the standard library, and a DB session can actually be revoked. Login
hashes a dummy password when the user doesn't exist so signup state can't be probed by timing.


## Phase 1 — The Moment Simulator ✅

`/dev/hud`. Every beat of §6 fires on demand, beats chain into a full match, and every number in
`motion.ts` is editable live so the feel can be tuned and the winning values exported.

```
pnpm dev     # http://localhost:3000/dev/hud
pnpm clean   # wipes .next and .turbo — run after switching branches
```

### Beats, all implemented

Queue (radar sweep, elapsed clock, widening band) · queue pop (dim → light sweep → 60ms-offset
plate collision → flash → shake → staggered meta → VS overshoot, with independent accept pips) ·
countdown `3·2·1·GO` with ring pulses · problem reveal (editors slide in from opposite edges,
panel unfolds, title types at 28 chars/sec) · the full HUD (nameplates, test bars racing toward
center, canvas pulse lines, status tickers, clock, round pips) · compile pulse · clutch state at
80% and 90% · near-miss shatter · emote wheel on `Ctrl+E` with a 15s cooldown · submit pass ·
submit fail · victory · defeat · rank-up.

**Play full match** runs the whole sequence end to end, including a failed submit before the
successful one, so the recovery beat gets exercised.

### The tuning surface — the actual deliverable

Right rail, bottom half. Live controls for every `motion.ts` value: all seven durations, all three
cubic-beziers (with a curve preview), spring stiffness/damping/mass, stagger step and cap, and both
shake amplitudes. **Copy motion.ts** emits the tuned values as source, ready to paste back into
`packages/ui/motion.ts`. Hand me those numbers and I'll bake them in.

`motion.ts` remains the single source of truth for the defaults — the tuning layer reads from it and
overrides at runtime. With no provider, every consumer gets the unmodified values, so
`/dev/kitchen-sink` and every future product surface are untouched by this.

**Global speed, 0.25×–2×**, scales time correctly rather than just stretching durations: durations
by 1/speed, spring stiffness by speed² and damping by speed. That holds the damping ratio
ζ = c/2√(km) constant, so you change tempo without silently changing bounce. Scaling stiffness alone
would have you tuning two things at once without knowing it.

### Revised motion set baked in

The proposed `motion.ts` is now the default: six new durations, `ease.in` and `ease.impact`,
`spring.impact`, mass on `bar`/`heavy`, and decaying shake. CLAUDE.md §5 carries the full set with
a rationale per line. The tuning panel covers every new value, and the export emits them.

**Damping ratios, computed rather than assumed** (ζ = c / 2√(k·m)):

| spring | ζ | overshoot 1st / 2nd | settle |
| --- | --- | --- | --- |
| `ui` 420/32/0.7 | 0.933 | 0.03% / — | 175ms |
| `bar` 200/26/1 | 0.919 | 0.07% / — | 308ms |
| `heavy` 130/19/1.15 | 0.777 | 2.07% / 0.04% | 484ms |
| `impact` 600/30/1.1 | 0.584 | 10.44% / 1.09% | 293ms |

Two premises in the proposal didn't survive checking, and one number is a judgment call — all three
are written up in the session report. Short version: `bar`'s old overshoot could not have caused a
false pass (it only drives the continuous >20-test bar, never the segmented cells), `heavy` came out
*less* damped than before rather than weightier, and `impact` rebounds twice — 23px then 2.4px on a
220px travel.

### New-token audit

- `ease.in` applied to every exit that was drifting away on a decelerating curve: verdict panel,
  victory overlay, queue pop, queue card, countdown digits, emote wheel.
- `ease.impact` on the §6.2 nameplate collision; `spring.impact` on the `VS` badge and the rank-up
  badge assembly. The two are deliberately not interchangeable — see §5.
- `dur.beat` before the countdown's first tick and before the verdict panel drops.
- `dur.reveal` replaces the hardcoded 120ms test cadence.
- `dur.breathe` replaces the hardcoded 1800ms clutch cycle.
- `dur.victory` / `dur.defeat` / `dur.skip` drive the new skippable victory cinematic.
- Shake now generates decaying alternating keyframes from `cycles` and `decay`.

**Two gaps the audit exposed, both fixed:** §6.7's *"the loser's plate slides off-screen"* was never
implemented — the HUD now takes an `endgame` prop that crosses the winner's plate toward the center
and accelerates the loser's off on `ease.in`. And `shatterKey` was missing from `HUDPlayer`, so the
near-miss shatter had been wired through the simulator but never reached the TestBar. It fires now.

### Follow-ups applied after first review

- **§5's looping rule was reworded, not the code.** Looping motion is now allowed whenever it
  encodes live state and forbidden when it is decoration. The queue radar (actively searching) and
  the clutch edge (opponent above 80%) both qualify and both stop when the fact stops being true.
  No exception needed anywhere, and the rule is about meaning rather than a quota.
- **Placeholder sound pulled forward.** Six Web Audio oscillator tones generated at runtime, no
  asset files: countdown tick, final tick (pitched higher), test pass (rises a semitone per
  consecutive pass, resets after 4s or a fail), test fail (low thud), submit (band-passed noise
  sweep), victory (three-note rising arpeggio). Mute and volume are in the rail. The real library is
  still Phase 4 and will use a preloaded buffer pool per §9 — this is scaffolding so rhythm can be
  tuned at all.
- **The `--grandmaster` co-occurrence hole is closed.** Spectate shows the HUD *and* viewer handles,
  which would have put `--fail` and `--grandmaster` on screen together. Resolved by rule rather than
  by color: **tier color and match-state color never share a screen**, so handles render
  `--text-dim` anywhere a live HUD is present (match, spectate, replay) and keep tier color
  everywhere else. Shifting `--fail` was tested first and rejected — a search for the value that
  maximises its minimum separation returns `#CD871C`, a dark goldenrod, because the only free space
  left in the warm quadrant is the gap between crimson and `--clock`. Every meaningful shift costs
  `--fail` its alarm semantics. Written into §4 next to the constraint.
- **The pulse line's fake signal was wrong and is rebuilt.** The first version rolled a fresh
  Bernoulli "burst?" every tick, which produces smooth noise — a shape that never occurs in reality,
  and tuning the rendering against it would have meant tuning against a lie. It is now a four-state
  machine (think / burst / edit / pause) with realistic dwell times and asymmetric smoothing, so
  bursts start hard and silence arrives gently. Verified over 5 simulated minutes rather than
  assumed: **44.8% dead air, 22.5s longest pause, 5.9s longest burst, 15 sharp onsets** for P1;
  P2 runs spikier at 52.4% dead air and 31s longest pause. The flatline-then-spike shape the graph
  exists to show now actually occurs. Replaced by real `opponent.pulse` events in Phase 2.

### Judgment calls worth reviewing

- **Phase 0 primitives were migrated onto the tuning hook.** TestBar, Clock, Nameplate,
  StatusTicker and the interactive (hover/press) hook now read from `useMotion()` instead of
  importing `motion.ts` constants directly. Without this the exported numbers would only describe
  the cinematics while the HUD's micro-animations quietly ignored them. §5's "no component invents
  its own timing" still holds — they read the canonical values, just through a layer that can
  override them.
- **`ClutchEdge` loops**, which §5 otherwise reserves for the queue radar. §2 rule 3 names clutch
  state as one of the five moments that get real cinematics, and §6.5 specifies a breathing cycle
  explicitly, so this is sanctioned — but the two lines in the brief are in tension and it is worth
  a decision. It only exists above 80% and stops entirely under reduced motion.
- **The fake editor animates `filter`** on submit, because §6.6 requires a 4px blur. Not in §5's
  banned list, and it is one-shot rather than during-match, but it is the one non-transform/opacity
  animation in the build.
- **Sound cues are logged, not played.** The library is Phase 4, but §6.3 and §6.6 are timed *to*
  sound. The rail shows a running cue log so the timing can still be tuned now.
- **`Ctrl+E`** is `preventDefault`ed; it collides with a browser shortcut in some setups.

### Reduced motion

Implemented for every beat in the same commit, per §5.9. Movement is replaced by 120ms opacity
fades, particles and screen shake are disabled outright rather than shortened, the radar and clutch
loops stop, and the typewriter resolves instantly. Toggle is in the rail (auto / full / reduced).

### Not verified

I still cannot screenshot. Typecheck and build pass, all three routes return 200, and the built CSS
was audited — but **nobody has looked at these cinematics yet**. The timings are the brief's numbers
taken literally, which is exactly what the tuning surface exists to correct.

---

## Decisions applied to master

1. **`--grandmaster` is now `#FB1E1E`** — crimson, deliberately not `--p2`'s magenta, echoing
   Codeforces' red top tier. `--legend`'s final stop matches. Verified in OKLab ΔE (WCAG ratio is
   luminance-only and would score two obviously different hues as identical): 0.099 vs `--p2`,
   0.101 vs `--fail`, and 4.62:1 as handle text. Full reasoning, including why it *cannot* beat the
   existing `--p2`/`--fail` pair, is in CLAUDE.md §4.
2. **Tier aura is its own device**, not an exception to the glow rule. `--tier-aura-faint` /
   `--tier-aura-full` are `text-shadow`, which has no spread parameter at all — so an aura can never
   quietly become a state glow. §5 needs no carve-out.
3. **Problem ratings and Handles moved to §8**, now titled *Progression and identity*.
4. **Matchmaking targets mean − 120**, per-mode, with an adaptive spread that widens with queue
   time. Selecting at the average would have left ~25% of matches with neither player solving.
   **Failed hack costs 30s on final elapsed time**, and the brief now says what that acts on.
5. **Hack validator** is required, and lands in the Phase 2 problem schema rather than Phase 4.
6. **`pnpm clean`** added. Run it after switching branches — `tsconfig` includes `.next/types`, so a
   stale build from another branch fails typecheck on routes that no longer exist.

## Palette pass — explored, rejected, two fixes kept ✅

A muted palette direction was built out and **rejected**. Three candidates (Risograph spot inks,
*Hyper Light Drifter* aubergine, faded arcade-cabinet sideart) were rendered against the full
kitchen sink and compared side by side at `/dev/palette`. They live on branch **`palette-pass`**,
which is intentionally **not merged and must not be deleted** — it is the record of what was tried.

Rejected because the reference was fighting the brief: riso is a quiet print medium, §2 is a
fighting game, and arcade cabinets are saturated. The warmed base, bone text, and grain overlay
were turned down with it. Phase 0's chroma, base, and text color all stand. The reasoning is
recorded permanently in CLAUDE.md §4 under *Palette provenance* so no future session re-mutes it.

Two fixes were taken off that branch, and nothing else:

1. **Glow audit.** `Card owned` and `Nameplate active` glowed continuously — `active` lasts the
   whole match, so that was glow-at-rest by another name and a real §5 defect. Both now carry
   ownership on the player border and the mirrored lean alone. Verified by grepping the **built**
   CSS: the only surviving shadows are Button `:hover`, Nameplate `winner`, Clock under ten
   seconds, and the focus ring. CLAUDE.md §4 now states the rule and the audit method.
2. **Player color pair retuned** to `--p1: #2BD98E` / `--p2: #FF337C` — the Phase 0 hues at −5%
   lightness. This fixes a real bug: `--fail` against P2 under deuteranopia was 1.24, meaning a
   failing cell and a filled P2 cell were near-indistinguishable in the same bar (§6.4). Now 1.60.
   P1/P2 deuteranopia separation also rises 1.70 → 2.02, and chroma rises with it — they are more
   electric, not less. The paired constraint is documented in CLAUDE.md §4 and in `tokens.css`.

**Not taken:** the warm base, bone text, grain overlay, halved glow radius, and the
`--glow-r` / `--glow-r-lg` tokenization. All remain on `palette-pass` only.

**Known inconsistency, deliberately left alone:** `--grandmaster` and the last stop of `--legend`
are still `#FF4D8D`, the old P2 value, so they now sit ~2% off the new `--p2`. Phase 0 had them
identical. Either they should track P2 or they are independent tier colors — that is a call to
make, not something to change silently.

## Three mechanics specced (no implementation)

Written into CLAUDE.md at the detail level of the existing sections, with motion and sound beats:

- **League color on handles** — §4 (color and glow rules) + §7 (where they surface). **Phase 3.**
- **Problem ratings on the player scale** — §7 + §12. **Phase 2.** Includes the explicit §4 ban on
  Easy/Medium/Hard color coding.
- **Hack phase** — new §6.8 + §9 sounds + §10 events + §12. **Phase 4.**

## Phase 0 — Foundation ✅

Monorepo, token system, motion system, typography, seven `packages/ui` primitives, and
`/dev/kitchen-sink`. Typechecks and builds clean; both routes render.

```
pnpm install
pnpm dev          # http://localhost:3000/dev/kitchen-sink
pnpm typecheck
pnpm build
```

---

### What exists

```
package.json  pnpm-workspace.yaml  turbo.json  tsconfig.base.json
apps/web/                Next 15.5.22 · React 19 · Tailwind v4.3.3
  app/layout.tsx         3 fonts via next/font, MotionPrefProvider, pre-paint motion bootstrap
  app/globals.css        Tailwind @theme bridge to tokens.css
  app/page.tsx           Phase 0 landing
  app/dev/kitchen-sink/  every primitive in every state
packages/ui/
  tokens.css             §4 in full + documented additions + player-scoped utilities
  motion.ts              §5 in full + helpers
  src/components/        Button Card Nameplate RankBadge TestBar Clock StatusTicker
  src/lib/               cn, types, interactive, motion-pref
```

`apps/gateway`, `apps/judge`, `packages/proto`, `packages/db` are **not** scaffolded. The
workspace globs cover them, but empty packages are four half-built systems (§13.4). They land in
the phase that first needs them.

---

### Decisions worth knowing

**The player context is mechanical, not manual.** Components never branch on P1/P2. A `[data-side]`
ancestor rebinds `--player`, `--player-glow`, `--player-fill`, `--player-clip`, and
`--player-origin`; everything downstream reads those. `<Button tone="player" side="p2">` is magenta,
leans the other way, and glows magenta without a single conditional. This is §2 rule 1 enforced by
the cascade.

**Root default is P1.** With no `[data-side]` ancestor, `--player` resolves to jade — you are P1
from your own point of view. Spectate will need an explicit side on both halves.

**Player colors are hand-written CSS, not `@theme` entries.** A custom property declared in `@theme`
is substituted at computed-value time on `:root`, so `--color-player: var(--player)` would freeze to
jade and ignore `[data-side="p2"]` entirely. `.text-player` / `.border-player` / `.bg-player` /
`.fill-player` / `.glow-player` live in `tokens.css` instead. Two consequences: never add
`--color-player` to `@theme`, and **variants must use the arbitrary form** —
`hover:text-[var(--player)]`, because Tailwind cannot generate `hover:` on a hand-written class.
`.fill-player` also sets `background`, not `background-color`, because P2's hatch is a gradient and
`background-color` would discard it.

**Tailwind's defaults are deleted.** `globals.css` does `--color-*: initial`, `--font-*: initial`,
`--text-*: initial`. `bg-red-500` and `text-sm` do not exist. §13.2 is a build-time guarantee, not a
review habit.

**Colorblind rule has four carriers, not one.** Side of screen · literal P1/P2 chip · solid fill vs
45° hatch · mirrored corner cut. Hue is the least of them.

**`@1v1/ui` ships TypeScript source**, transpiled by Next via `transpilePackages`. One compiler, one
token set, no build step between editing a primitive and seeing it.

---

### Additions beyond the brief

Each was unavoidable; §13.2 requires saying why.

| Token | Why |
| --- | --- |
| `--focus` (aliases `--info`) | §13.9 mandates visible focus everywhere; §4 defines no focus token. Borrows an existing hue rather than inventing one. |
| `--legend-flat` | `--legend` is a gradient and cannot be a border-color, text-color, or box-shadow. |
| `--scrim`, `--flash`, `--flash-hard` | §6.2's 85% ink dim and §6.4's 40% white overlay need names, not magic values. |
| `--clip-sm` (8px) | 12px eats the label on `h-8` controls. Large controls still take the full 12px. |
| `dur.flash` (60ms), `dur.decay` (200ms) | §6.2 and §6.4 state both literally; neither is expressible on the §5 scale. |
| `REDUCED_MS` (120ms) | §5's reduced-motion fade duration, also not on the scale. |
| `--r-sm`, `--r-card`, `--hair`, type-scale and font vars | §4 states these as prose; they had to become variables to be usable. |

No new hues were introduced.

---

### Underspecified in CLAUDE.md — flagged, not blocking

1. **The clipped-corner spec contradicts itself.** §4 fixes the cut at top-left/bottom-right *and*
   says P2 mirrors P1. Resolved as: TL/BR is the P1 diagonal, TR/BL the P2 mirror, plus a neutral
   variant. Confirm this reading before Phase 1 builds the HUD around it.
2. **RankBadge had no visual definition** — only tier colors and the existence of divisions.
   Invented: clipped plate, tier-tinted fill, full-saturation border and numeral, and an *angular*
   progress ring following the badge silhouette (a circular ring leaves the plate's corners poking
   through, and §4 rules out round shapes). Needs your eye.
3. **TestBar cell count is unbounded in §6.4.** Capped at 20; above that it degrades to a continuous
   fill that still grows toward the center.
4. **Sound is Phase 4 but §6.3 and §6.6 are timed to it.** The countdown and the sequential test
   reveal cannot be tuned silently. Phase 1 needs at least placeholder audio.
5. **No shadow/elevation scale** beyond the single 24px owned-element glow. Fine so far; modals will
   want one.
6. **No Storybook** in §3, so the kitchen sink is a hand-built route. Assumed intentional.

---

### Self-critique against §2 — with one honest caveat

**I could not screenshot this.** There is no browser tooling in this environment, so §13.7 is
unfulfilled. What follows is a read of the code, not of the rendered page. Please open
`/dev/kitchen-sink` and judge it yourself — particularly the RankBadge, which is the most invented
thing here.

Where I think it holds:

- Resting UI is genuinely muted. Tier plates are ~20% tier color mixed into `--surface`; full
  saturation appears only on a passing cell, an owned border, or an active nameplate.
- No brand accent exists anywhere. Every accent is somebody's corner color. The one exception is
  `--info` on compile/run status, which §4 explicitly assigns that job.
- The clip-path silhouette is on every container, and it mirrors per side, so the two halves lean
  into each other.
- Nothing loops. There is no ambient animation in Phase 0 at all — the radar sweep is the only one
  the brief permits and it belongs to the queue card.

Where I'm least confident:

- **Martian Mono is wide.** At `text-14` in a nameplate it may crowd longer handles. Worth checking
  at 1280px with a 16-character handle.
- **The P2 hatch is 3px stripes** and I don't know how it reads on a 10px-tall `size="sm"` bar, or
  on a low-DPI display. May need to coarsen.
- **The kitchen sink is a dev tool**, and I designed it to be presentable rather than beautiful. It
  should not be read as a sample of product surface quality.

---

### Not done, deliberately

The HUD, all five cinematics, the bot opponent, and `/dev/hud` are **Phase 1**. `packages/proto` is
empty until there is a socket event to type. Per §13.10, stopping here.

**Repo state:** `git init` run, 32 files staged, **no commit made** — that's yours to make.

---

## Problem retrofit, pass 1 — the 800–1300 band (plus two)

**Nine problems retrofitted to the §12 problem format.** Bank status: **11 of 20 done**, 9 left.

### Baseline first, as asked

Run before anything was touched, so a later regression can only have one source:

`pnpm stack` all routes 200 · **e2e 17/17** · **probes 5/5** (lifecycle, match, requeue,
visibility, latejoin) · **core 56/56** · smoke 5/5 · typecheck 7/7.

### The band yielded seven, not nine

Ordering by rating rather than by file order, the 800–1300 range contains only **seven** problems
still needing the retrofit — `sum-of-two` (800) and `connected-components` (1300) were already done
in the previous session. Rather than silently redraw the band, the two next by rating were added:

| | rating | topic | slug |
| --- | --- | --- | --- |
| 1 | 820 | STRINGS | `count-vowels` |
| 2 | 900 | MATH | `fizzbuzz-count` |
| 3 | 1000 | DP | `max-subarray-sum` |
| 4 | 1050 | MATH | `gcd-pair` |
| 5 | 1100 | STRINGS | `longest-common-prefix` |
| 6 | 1150 | MATH | `sieve-count` |
| 7 | 1250 | GREEDY | `activity-selection` |
| 8 | 1350 | GREEDY | `fractional-knapsack` — first above the band |
| 9 | 1400 | DP | `coin-change-min` — first above the band |

Remaining nine, for the next pass: `min-platforms` 1400, `shortest-path-bfs` 1450,
`topological-order` 1500, `kth-smallest-pair` 1540, `longest-increasing-subsequence` 1600,
`edit-distance` 1650, `palindrome-min-cut` 1850, `dijkstra-shortest` 1900, and `modular-power`.

### The defect list — asked for, and it has exactly one entry

The instruction was to report any problem whose hidden tests do not actually discriminate, rather
than write a sample for a case the judge does not check. Eight of the nine were fine: the
discriminating case was already sitting in the hidden tests and only needed **promoting to a
sample** — `longest-common-prefix` (n = 1), `activity-selection` (sort-by-start), and
`fractional-knapsack` (0/1 rather than fractional) each gained a third sample that was already
being judged.

**`coin-change-min` (1400) was a real defect.** Its five test cases used the coin systems
`{1,2,5}`, `{2}`, `{1,3}`, `{1}` and `{1,5,10,25}` — every one of which is a system on which the
greedy "take the largest coin that fits" is **optimal**. So the whole test set agreed with the
wrong algorithm. Measured, not assumed:

```
greedy [1, 2, 5]      target 11:       got 3,       correct 3        PASS
greedy [2]            target 3:        got -1,      correct -1       PASS
greedy [1, 3]         target 6:        got 2,       correct 2        PASS
greedy [1]            target 1000000:  got 1000000, correct 1000000  PASS
greedy [1, 5, 10, 25] target 27:       got 3,       correct 3        PASS
greedy [1, 3, 4]      target 6:        got 3,       correct 2        FAIL  <- added
```

A greedy submission passed 5 of 5. `{1,3,4}` with target 6 was **added as a test case as well as a
sample** — the sample is the visible half, the test case is the half with teeth. This is the only
problem in the nine where the fix changed what the judge checks rather than what the player reads.

`gcd-pair` carries `discriminator: null`, and that is the answer rather than a gap: the wrong
approach there is trial division to `min(a, b)`, which produces the **right** answer and merely
takes too long. A sample cannot show elapsed time. The 10^9 hidden tests catch it, as a timeout.

### Two tool bugs, both found by using the tools rather than trusting them

**1. `db:samples` was stricter than the judge, and reported a MISMATCH on all twenty problems.**
It compared the reference's raw stdout against the seed value; every reference prints a trailing
newline and no seed value carries one. The only real difference was whitespace the judge already
ignores. It now uses `normalise` copied from `apps/judge/images/runner.py:334` — strip the text,
rstrip each line — and prints the literal already normalised.

A checker stricter than the thing it models is not a safer checker. Twenty false alarms is exactly
how a genuine one gets waved through, and this tool exists so its output can be trusted without
re-deriving it by hand. Positive-controlled afterwards: an expected value was deliberately
corrupted to `3`, and the tool reported `MISMATCH: the seed currently claims "3"`.

**2. `db:verify`'s format gate was suppressing its own correctness gate.** The format check ended
in a hard `process.exit(1)` placed *before* the reference-solution and validator loop. That exit was
the correct fix for an earlier bug (`process.exitCode` was being overwritten, so real failures
reported success) and the wrong place for it: one problem missing a `note` took the check that
catches **wrong expected outputs** offline for all twenty.

Worst during precisely the situation it was met in — a retrofit spanning several sessions, where
the format gate fails by design on every problem not yet reached, so the stronger check is dark for
the duration. Both passes now always run and the exit code accounts for both. A gate may fail the
build; it may not disable another gate.

That change is what allowed the added `coin-change-min` test case to be verified at all — it now
reports **all 103 test cases agree with their reference solution and pass their validator**, where
before the run stopped at the format wall.

### Verification

- **No expected output was hand-written.** The new `coin-change-min` case came from
  `pnpm db:samples coin-change-min --stdin`; the three promoted samples were already
  reference-verified test cases.
- **All nine re-checked with `pnpm db:samples`** — every sample input validates against the
  problem's own validator, every output derives from the reference. `edit-distance`,
  `min-platforms` and `dijkstra-shortest` run as an untouched control.
- `pnpm db:verify` — **103/103 test cases** agree with their reference and pass their validator.
  Exits 1, correctly, on the 18 remaining presentation issues across the 9 untouched problems.
- Re-seeded (`pnpm db:seed`, idempotent upsert), then: **e2e 17/17**, **probes 5/5**,
  **core 56/56**, smoke 5/5, typecheck 7/7.

### One piece of pre-existing noise, not from this work

`probe:visibility` and `probe:latejoin` both print `PASS` and then a Prisma
`Foreign key constraint violated on the constraint: Match_p1Id_fkey` from their own teardown —
`user.deleteMany()` runs against users that still have `Match` rows. It is after the assertion, so
neither result is affected, but it should be cleaned up so a real failure is not lost in it.

### Not done, deliberately

The remaining nine problems are the second pass. Per §13.10, stopping here.

---

## The wrong-approach audit — does the test set catch wrong code?

**`pnpm db:audit`, a new permanent tool.** 20 problems, 38 wrong approaches modelled,
**26 caught, 12 survived.** Every survivor is proven against a counterexample.

`db:verify` proves the reference agrees with every expected output. That is a check on the
ANSWERS, and it says nothing about whether the tests can tell a correct solution from a plausible
wrong one. `coin-change-min` was the proof that those are different properties.

### The list

**Defects — the judge accepts wrong code. 11 approaches across 9 problems.**

| rating | problem | wrong approach that passed | proof |
| --- | --- | --- | --- |
| 820 | `count-vowels` | distinct vowels, via a set | `banana` → said 1, answer 3 |
| 1000 | `max-subarray-sum` | 32-bit accumulator | `1e9 1e9 1e9` → said 2000000000, answer 3000000000 |
| 1250 | `activity-selection` | sort by shortest duration | `[0,10] [9,11] [10,20]` → said 1, answer 2 |
| 1450 | `shortest-path-bfs` | DFS instead of BFS | 4-cycle with a direct edge → said 3, answer 1 |
| 1500 | `topological-order` | one visited set, no recursion colouring | diamond → said NO, answer YES |
| 1500 | `topological-order` | edges treated as undirected | diamond → said NO, answer YES |
| 1600 | `longest-increasing-subsequence` | non-strict, `<=` | `1 2 2 3 4` → said 5, answer 4 |
| 1850 | `palindrome-min-cut` | greedy longest palindromic prefix | `aaabaa` → said 2, answer 1 |
| 1900 | `dijkstra-shortest` | 32-bit distances | 3000×1e6 chain → said -1294967296, answer 3000000000 |
| 1900 | `dijkstra-shortest` | walk to the nearest unvisited neighbour | said 101, answer 5 |
| 2000 | `modular-power` | `b == 0` returns 1 without reducing | `5 0 1` → said 1, answer 0 |

**Complexity — right answer, unenforced cost. 1 approach.**

`gcd-pair` (1050), subtractive Euclid. The worst existing test costs **7 steps**; `1000000000 1`
costs **999,999,999**. Fixed with a bigger test, not a different one. Reported separately because
calling it a wrong answer would be false.

**Clean — every modelled wrong approach was caught (9 problems):** `fizzbuzz-count`,
`longest-common-prefix`, `sieve-count`, `connected-components`, `fractional-knapsack`,
`coin-change-min`, `min-platforms`, `kth-smallest-pair`, `edit-distance`.

**Nothing plausible to get wrong (1):** `sum-of-two`. Its own statement says it exists as an I/O
format check. Recorded as an audited answer, not an unaudited gap — the same distinction as a
`discriminator` of `null`.

### Three things the list says

**1. Retrofit status is uncorrelated with test quality, exactly as predicted.** `count-vowels`,
`max-subarray-sum` and `activity-selection` were all retrofitted last session — statements
rewritten, samples chosen to expose a specific wrong approach, discriminators written — and all
three are defective. Being retrofitted says the statement is right. It says nothing about whether
the tests discriminate, and it was right to audit all twenty rather than the nine.

**2. The defect rate climbs with rating.** 800–1300: 3 of 9 problems. 1400+: 6 of 11. Every
problem in the bank carries **five test cases**. Five was never going to separate a correct 1900
from a subtly wrong one — there are simply more ways to be nearly right at 1900, and the same five
tests are asked to catch all of them.

**3. Two of the defects are things the statements explicitly warn about.**
`dijkstra-shortest` says *"total path weight can exceed 32 bits"* and its largest test total is
**18**. `longest-increasing-subsequence` says *strictly* increasing and no test contains a
duplicate. A problem that documents a trap and never springs it is worse than one that says
nothing, because it reads as though it were tested.

### The audit had to be audited

The first pass reported **13** survivors. Three were wrong:

- **`sum-of-two`, 32-bit accumulator** — not a defect. The constraints cap `|a + b|` at 2e9 and
  `int` holds 2.147e9. The approach is CORRECT.
- **`modular-power`, 64-bit multiply without reducing** — not a defect. `m <= 2e9`, so the product
  of two reduced operands is under 4e18 against a signed 64-bit ceiling of 9.22e18. Also correct.
  The statement's warning that *"intermediate products exceed 32 bits"* is exactly right — 32, not
  64.
- **`gcd-pair`, subtractive Euclid** — a real defect, reported under the wrong heading. A
  five-million-step guard tripped and the partial state got printed as though it were the
  approach's answer, so a complexity problem was presented as a wrong answer with a fabricated
  number attached.

So the tool now **requires a counterexample for anything it calls a defect**, and checks it rather
than trusting it: the input goes through the problem's own validator, then through the problem's own
reference solution, and the claim only stands if the wrong approach disagrees with the reference on
an input the constraints permit. No expected value is typed anywhere in the tool.

This is the same lesson as `db:samples` being stricter than the judge, and it costs more here: the
output of this tool is a list of problems somebody is about to go and change, so a false positive
sends someone to "fix" working code. `sum-of-two` would have been the first stop.

One approach was also **added** during that review rather than removed — `dijkstra-shortest` in 32
bits — which is now one of the confirmed defects.

### Also fixed

`pnpm audit` is a reserved pnpm command, so `pnpm --filter @1v1/db audit` ran pnpm's vulnerability
scanner and printed a wall of CVEs instead of the audit. Renamed to `audit-wrong`, exposed as
`pnpm db:audit`. Same trap as `pnpm up` being an alias for `pnpm update`.

### Verification

`pnpm db:verify` unchanged — **103/103 test cases** agree with their reference and pass their
validator; still exits 1 on the 18 presentation issues across the 9 un-retrofitted problems.
typecheck 7/7, core 56/56. **No problem data was changed this session** — the audit reports, it
does not fix.

### Not done, deliberately

The 12 findings are **not fixed**, per the instruction to produce the list first. Fixing them means
adding test cases, which changes what the judge checks — the `coin-change-min` shape. Also
outstanding: the remaining nine retrofits, and the probe teardown noise. Per §13.10, stopping here.

---

## Making the bank sound — 11 defects fixed, two new gates, one measurement

### 1. All 11 wrong-approach defects are fixed

**`pnpm db:audit` now reports 37 of 38 approaches caught**, up from 26. Ten problems gained a
discriminating test; every expected output came from `pnpm db:samples`, none was typed.

| problem | test added | now catches |
| --- | --- | --- |
| `count-vowels` | `banana` | distinct-vowels-via-a-set |
| `max-subarray-sum` | 3 × 10^9 **(sample)** | 32-bit accumulator |
| `activity-selection` | `[0,10] [9,11] [10,20]` | shortest-duration-first greedy |
| `shortest-path-bfs` | 4-cycle with a direct edge | DFS instead of BFS |
| `topological-order` | the diamond **(sample)** | *both* survivors at once |
| `longest-increasing-subsequence` | `1 2 2 3 4` **(sample)** | non-strict `<=` |
| `palindrome-min-cut` | `aaabaa` **(sample)** | greedy longest palindromic prefix |
| `dijkstra-shortest` | 3000×10^6 chain | 32-bit distances |
| `dijkstra-shortest` | `1-2-3` detour **(sample)** | nearest-neighbour walk |
| `modular-power` | `5 0 1` **(sample)** | `b == 0` returning a bare 1 when m = 1 |

Six are samples, because each teaches something a player would otherwise guess wrong: that the
answer overflows 32 bits, that revisiting a vertex is not a cycle, that *strictly* increasing
excludes equals, that greedy partitioning fails, that Dijkstra is not a walk, and that m may be 1.
The four un-retrofitted problems among them get their explaining `note` when the retrofit lands;
the test is what stops the judge accepting wrong code today.

The dijkstra overflow chain is **generated in `problems.ts`, not written out** — the literal is
51 KB, and four lines that build a chain are more auditable than a wall of digits.

**Nothing downstream assumes a fixed test count.** `totalTests` flows from the server through
`match.start` to `TestBar`; the judge derives everything from `job.tests.length`. There is one real
ceiling: **`MAX_CELLS = 20` in `TestBar`** — above 20 tests §6.4's segmented bar stops being
readable and degrades to a continuous fill. That is now what caps the policy below.

### The test-count policy — the root cause behind all eleven

Every problem shipped with **five** tests. Five is right for `sum-of-two`, whose own statement says
it exists as an I/O format check, and hopeless for `dijkstra-shortest`. Difficulty and the number
of ways to be *nearly* right grow together: a 2000 problem has a wrong greedy, an overflow, a
degenerate case and a complexity trap all available at once, and one fixed set of five tests cannot
separate all of them.

**`minTests(rating) = 5 + floor((rating − 800) / 200)`, capped at `MAX_CELLS`.** Now enforced in
the format gate.

| rating band | min tests | | rating band | min tests |
| --- | --- | --- | --- | --- |
| 800–999 | 5 | | 1600–1799 | 9 |
| 1000–1199 | 6 | | 1800–1999 | 10 |
| 1200–1399 | 7 | | 2000+ | 11 |
| 1400–1599 | 8 | | | |

It tops out at 11 against a cap of 20, and that margin is the point rather than a coincidence — a
hard problem can gain tests without changing how the match screen renders.

**Four problems already comply** (`sum-of-two`, `count-vowels`, `fizzbuzz-count`,
`max-subarray-sum`). **Sixteen are short by 37 tests in total**, listed by `pnpm db:verify`. Those
37 largely overlap with the coverage gaps below — a boundary test is a meaningful test, so closing
coverage closes most of the count shortfall. Filling it with filler would defeat both.

### 2. Constraint coverage — `pnpm db:coverage`

For every numeric bound in `constraints`, require a test that reaches it, or a recorded exemption
in `coverageExemptions`. Same shape as `discriminator: null`: silence is not an option.

**76 bounds checked. 24 are promised by a statement and never posed by any test.**

**It finds gaps in 5 problems the wrong-approach audit called completely clean** —
`longest-common-prefix`, `connected-components`, `fractional-knapsack`, `min-platforms` and
`edit-distance` — plus deeper gaps in problems the audit had already flagged. The audit needs
somebody to guess the right wrong approach; this needs nobody to guess anything, because the
evidence was already written down. The two `dijkstra`/`LIS` defects would both have been caught
here without any knowledge of algorithms at all.

The worst of them, as a flavour: `fractional-knapsack` states `n <= 10^5`, `capacity <= 10^9`,
`value_i <= 10^6` and `weight_i <= 10^6`, and the largest number anywhere in its tests is **120**.

**The exemption mechanism is positive-controlled**, not assumed: a temporary exemption on
`palindrome-min-cut`'s `|s| <= 2000` moved the count 24 → 23 and printed its reason, then was
removed. **No exemption is currently recorded**, because none of the 24 deserves one — they all
deserve tests.

### 3. `db:verify` is now the bank gate, and the ordering bug cannot recur

`pnpm db:verify` runs three passes: **verify-seed** (format + reference correctness), **audit-wrong**,
**coverage**. `pnpm db:seed` runs the gate first and **refuses to seed** on failure.

**Each pass runs in its own child process.** Last session's bug was a `process.exit(1)` in the
format check suppressing the reference check — fixed by reordering, and reordering is a promise the
next edit can quietly break: any `exit`, early `return` or thrown error in pass 1 puts pass 2 back
to sleep, and the symptom is a green tick. A child process cannot exit another child process, so
the guarantee is now structural instead of disciplinary.

**Positive-controlled:** `SIGKILL` was appended to pass 1, and the gate still reported
`FAIL verify-seed`, ran `audit-wrong` to a pass, and ran `coverage` to a fail. A pass dying does not
take another pass offline.

`ALLOW_UNSOUND_BANK=1` overrides the seed refusal and exists for one temporary reason: the gate
fails today on the 24 unreached bounds and 34 presentation issues being worked through in order, and
refusing to seed would make the app unrunnable for all of it. It is loud, hand-typed, warns on use,
and `scripts/up.sh` carries a comment saying to delete it when the gate goes green.

### 4. gcd-pair — measured, and it is NOT a defect

**A timing test cannot work here, so none was added.** Timed rather than reasoned about:

| | worst permitted input `(10^9, 1)` |
| --- | --- |
| subtractive Euclid, `g++ -O2` | **0.50 s** (≈1.0 s at the sandbox's `--cpus 0.5`) |
| subtractive Euclid, Python | ≈159 s |
| Euclidean reference | 0.00 s |

Against a **5000 ms** limit, subtractive Euclid passes in C++ with 5× headroom, and **no test can
change that**, because `a, b <= 10^9` caps the work at 10^9 iterations. So at these constraints it
is a correct and fast-enough C++ solution. The Python timeout is ordinary language variance, not a
broken test set — a test here would fail Python and pass C++, which is worse than adding nothing.

Forcing the Euclidean algorithm means raising the bound to about **10^18**, where subtractive needs
10^18 steps and is hopeless in every language. That is a real option and a *different problem*: it
makes 64-bit arithmetic part of the task and needs the validator, the Python reference and the
TypeScript reference all moved past 2^53. **Not done on the audit's say-so** — it is a design change,
not a bug fix. The finding is recorded in `audit-wrong.ts` as `notADefect` with the measurement, so
nobody re-opens it from first principles.

### Verification

`db:verify` — **113/113 test cases** agree with their reference and pass their validator (up from
103). `db:audit` 37/38 caught, 1 acceptable. `db:coverage` 24 open gaps. typecheck 7/7, core 56/56,
**probes 5/5**, **e2e 17/17**.

### Not done, deliberately

The **24 coverage gaps** and the **37-test count shortfall** are the next block, and they are mostly
the same work. Then the remaining nine retrofits, and the probe teardown noise. Per §13.10, stopping
here.

---

## The bank is sound — 29 coverage gaps closed, 153 tests, two of three gates green

`db:coverage` now reports **every stated bound is reached by a test**, with **no exemptions
recorded** — none of the 29 deserved one. `db:audit` catches 37 of 38 approaches. `db:verify`'s
remaining failure is the 18 presentation issues across the nine un-retrofitted problems, which is
the retrofit work, not a defect.

**103 → 153 test cases.** Every one derived, none typed.

### 1. The cost, measured against the test sets that actually shipped

The premise that 5 → 11 tests roughly doubles judge CPU is **wrong by an order of magnitude**, and
the reason is that compilation dominates completely. Worst case in the bank is
`dijkstra-shortest`: 10 tests, 3.08 MB of input, including one 3.1 MB graph at `n = 10^5, m = 2·10^5`.

| | CPU |
| --- | --- |
| `g++ -O2` compile (`bits/stdc++.h`) | **2.35 s** |
| all 10 tests, including the 3.1 MB one | **0.10 s** |
| the old 5 small tests | 0.00 s |
| **total, new** | **2.45 s** |
| **total, old** | 2.03 s |

**+0.42 CPU-seconds, +21%** on this host — and against §11's more conservative 3.5 s compile
calibration it is **+3%**. A test at the full stated bound costs 0.08 s; a small one costs 0.0015 s.
Tests are microseconds and the compiler is seconds.

Against the **120 CPU-s / 10 min** per-user budget: §11's fast iterator at 25 submissions goes from
~100 to **~102.5 CPU-seconds**. The margin is essentially unchanged and **no budget change is
needed**.

**On "the in-match exemption" — there isn't one, and it is worth being exact.** §11's per-user
budget is flat; its only carve-out is that the per-IP budget applies solely to accounts younger
than 24 hours. What actually bounds an in-match player is the §6.8b **in-flight lock**, which is a
mechanism, not an exemption. It still covers this: one outstanding submission at ~5.7 s per round
trip caps a player at ~105 submissions per 10 minutes, and the CPU budget binds first at 29.

**Verdict latency: 5.5 s → ~5.7 s**, not 9 s. The extra is 0.10 s of execution plus moving 3.1 MB
over stdin.

**The §6.6 reveal is the one thing that genuinely changes.** At `dur.reveal` = 165 ms per cell, a
full pass goes from 825 ms to **1815 ms** on an 11-test problem. That is a longer slot machine on a
win, which is the case §6.6 wants drawn out. Failures got *shorter*, for the reason below. The HUD
needs no change: `MAX_CELLS` is 20, so 11 still renders as segmented cells.

### 2. Test ordering — no real conflict, and the tie-break is the runner

**Decided: samples and discriminating cases first, scale tests last.** Implemented; every generated
scale test is appended at the end of its array under a comment saying why.

The deciding fact is at `apps/judge/images/runner.py:431` — **the runner stops at the first
failure**. So ordering by discriminating power is not a trade against cost, it *is* the cost saving:
a wrong solution now fails on a small early test instead of first chewing through 3.1 MB of graph.

On the information-leak concern, which is a fair question and resolves cleanly:

- What the player learns is about **their own solution**, which is what feedback is for. §10's
  allowlist governs what the **opponent** sees, and the opponent still gets pass/fail and counts —
  `failedAt` is not on that channel.
- The tests stay hidden. Failing at index 2 says "you break early", not what test 2 contains.
- §6.6 already **requires** failure to be fast: sting for about a second and get out of the way. A
  wrong answer failing on test 9 of 11 is 1.5 s of reveal before the player even learns they lost
  the exchange. Early discriminators serve the spec rather than fighting it.

The one honest cost: the last cells of a *passing* reveal are now scale tests that almost never
fail, so the tension front-loads slightly. That is the right trade against making every wrong
submission pay for the expensive tests.

### 3. Generated test data — the one place derive-never-type does not protect

Correct, and it is now a mechanism. A generated input must assert **the property it exists to
test**, by independent arithmetic, never by running a solution:

```ts
generated("dijkstra 32-bit overflow chain", build, {
  "the true distance exceeds 2^31": () => EDGES * 1_000_000 > 2 ** 31,
  "it is a simple path, so that distance is forced": (i) => …,
  "the header agrees with the edges written": (i) => …,
})
```

These run at **module load**, so a broken generator fails `db:verify`, `db:seed` and the gateway
alike rather than quietly producing a weaker test set. Without it, a chain of 2000 edges instead of
3000 passes the validator (in spec), passes `db:verify` (reference and expected agree) and stops
testing overflow — everything agreeing while being wrong together.

**Positive-controlled, and then it earned its keep three times on my own mistakes:**

- Changing `EDGES` to 2000 failed at import with *"does not satisfy: the true distance exceeds
  2^31"*.
- The `longest-common-prefix` generator emitted `common0`; **the validator refused it** — digits in
  a letters-only word list.
- The fix used a two-letter suffix, and 999 / 26 = 38 runs past `z` into control characters. **The
  generator's own new assertion caught it on the very next run.**

`pnpm db:fill` derives expected outputs for generated inputs — the case `db:samples` cannot cover,
because nobody typed the input either so nobody can paste it into another tool. It runs the
reference over the exact `PROBLEMS` object that ships, not a copy.

### 4. `ALLOW_UNSOUND_BANK` — refused in production, not just listed

A checklist entry asks a human to remember. `prisma/seed.ts` now **refuses outright** when the flag
is set and `NODE_ENV=production`, and says why. Positive-controlled both ways: refused under
production, still works in development.

The failure mode is what makes this worth a mechanism — with the flag set, seeding **succeeds**, so
nothing looks wrong. Someone exports it to unblock a staging setup and it is still in the
environment six months later.

**For the Phase 2E deployment checklist:** `ALLOW_UNSOUND_BANK` must be absent from the production
environment. The code enforces it; the checklist entry is defence in depth on a control whose
failure mode is silence.

### Three defects found while doing the work

**The 2 MB validator cap made three problems' constraints unsatisfiable.** `m <= 2*10^5` edges with
weights is ~2.8 MB of text, so `connected-components`, `topological-order` and `dijkstra-shortest`
could not carry a test at their own stated bound: `db:coverage` demanded one, `db:fill` generated
one, and the validator refused it. `n <= 10^5, m <= 2*10^5` is an ordinary competitive-programming
size, so **the cap was what was wrong** — raised to 8 MB, matching the judge's existing
`--ulimit fsize=8388608` rather than being a second arbitrary number beside it.

**`db:coverage` was over-crediting, in the dangerous direction.** It asked whether any token was
*at least* the bound, so adding a test with 10^9 *values* made it consider `n <= 10^5` reached — it
had no idea which token was `n`. Now it requires an **exact** match, which is what a boundary test
actually is. That took the gap count from 24 to **29**: five bounds it had been calling covered.

**`Math.max(-Infinity, ...observed)` blew the call stack** the moment a 100 000-element test landed.
It surfaced as a `RangeError` that the gate correctly reported as a failing pass but that had
nothing to do with coverage. Replaced with a loop.

### The probe teardown noise is gone

All five probes: **PASS, zero Prisma error lines.** `Match.p1`/`p2` are the only relations to `User`
without `onDelete: Cascade` — deliberately, since a match is a historical record — so the matches
have to be deleted first. One shared `deleteProbeUsers` helper in `apps/gateway/src/probe-cleanup.ts`
does it in dependency order.

**A near-miss worth recording.** The first run after the fix reported `prisma noise: 0` for all five
probes — and the verdict column was empty, because the dev server had died and every probe was
failing with `ECONNREFUSED`. "Zero noise" was trivially true of probes that never ran. That is the
exact failure this project keeps meeting: output that looks like the output you wanted. The verdict
column is now printed as `NO-VERDICT` rather than blank when a probe produces neither PASS nor FAIL.

### Verification

`db:verify`: **153/153** test cases agree with their reference and pass their validator.
`db:audit` 37/38 caught, 1 acceptable. `db:coverage` **0 gaps, 0 exemptions**. Test-count policy
satisfied by all 20 problems. typecheck 7/7, core 56/56, **probes 5/5 clean**, **e2e 17/17**.

### Not done, deliberately

**The nine statement retrofits did not fit** and are the only thing left before the gate goes fully
green — `db:verify` names all 18 issues. That is the next session. Per §13.10, stopping here.

---

## The bank gate is green

```
  pass  verify-seed    a problem is unsolvable as presented, or an expected output is wrong
  pass  audit-wrong    a plausible wrong approach passes the tests — the judge accepts wrong code
  pass  coverage       a stated bound is never posed by any test, and is not exempted

The bank is sound: presentable, correct, discriminating, and covered.
```

**20 of 20 problems retrofitted. 153 test cases, all agreeing with their reference and passing
their validator. 76 of 76 stated bounds reached by a test, no exemptions. 37 of 38 wrong approaches
caught.**

### The nine statement retrofits

`min-platforms`, `shortest-path-bfs`, `topological-order`, `kth-smallest-pair`,
`longest-increasing-subsequence`, `edit-distance`, `palindrome-min-cut`, `dijkstra-shortest`,
`modular-power` — each now carries a statement that is the task alone, an `inputFormat`, an
`outputFormat`, one bound per `constraints` entry, a `discriminator` naming the wrong approach a
sample rejects, and a `note` explaining every sample.

**Two samples promoted**, both teaching a rule a player would otherwise guess wrong:

- `min-platforms` — `1 5` and `5 9` answers **2**. The tie-break where a train departs at exactly
  the moment another arrives was stated in prose and demonstrated nowhere.
- `shortest-path-bfs` — the 4-cycle with a direct edge answers **1**. This is the DFS-versus-BFS
  case; it was a hidden test and is the whole point of the problem.

**`kth-smallest-pair` has a wrong slug and it was deliberately left alone.** It says "pair" and the
problem is a single array — the reference has always been "sort, take the k-th". The slug is the
primary key in Postgres, appears in seeded rows, match history and any replay log already on disk,
so renaming it is a migration rather than an edit. The *title* is what a player reads and it is
correct. Recorded in the source next to the field so nobody re-discovers it as a bug.

### `ALLOW_UNSOUND_BANK` is deleted, not disabled

The gate is green, `pnpm db:seed` runs it with no flag, so the override is **gone from
`seed.ts` and from `scripts/up.sh`** — not left in place turned off. The only surviving mention is
the comment saying why it was removed and that reintroducing it should be a deliberate act with the
same production refusal it had.

The reasoning is the one that motivated the request: a soundness override with no current purpose
is what gets re-enabled during a deploy problem at 2am, by someone who needs the seed to work and
will not read why it was refused.

**Positive-controlled both ways after removal:** seeding succeeds on the green bank, and breaking a
single `discriminator` field makes it print *"The bank gate failed, so nothing was seeded"* and
refuse — with no way to force it.

### Recorded in the brief: compilation is the whole bill

Added to §11, because it is a standing constraint and not a one-off measurement. A test at the full
stated bound costs **0.08 CPU-s**; a small one costs **0.0015**; the `g++` compile costs **2.35**.
Going 5 → 10 tests on the heaviest problem in the bank cost **+21%** on this host and **+3%**
against §11's own 3.5 s calibration.

The rule that follows: **the minimum test count is set by what it takes to separate a correct
solution from a plausible wrong one, never by CPU.** The real ceilings on a test set are
`MAX_CELLS` (20) and the validator's 8 MB input cap.

### Size report

Lines of code, from `git ls-files`, by package and by kind. `probe` is split out from `test`
because the probes are a distinct thing — long-running gateway scenarios, not unit tests — and
`tooling` is the bank gate machinery, which is neither application code nor tests.

| package | app | test | probe | tooling | seed-data | total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `apps/web` | 7388 | 218 | | | | **7606** |
| `apps/gateway` | 2892 | 426 | 1553 | | | **4871** |
| `packages/ui` | 3505 | | | | | **3505** |
| `packages/db` | 600 | | | 782 | 1930 | **3312** |
| `packages/core` | 1326 | 759 | | | | **2085** |
| `apps/judge` | 1029 | 537 | | | | **1566** |
| `e2e` | | 743 | | | | **743** |
| `packages/proto` | 604 | | | | | **604** |
| `scripts` | 219 | | | | | **219** |
| **total** | **17563** | **2683** | **1553** | **782** | **1930** | **24511** |

**The generated test data does not distort the count, and it is worth saying why.** The 13
generated inputs are **14.51 MB at runtime** and cost about **230 lines of source**, because they
are *built* rather than stored — a chain of 3000 edges is four lines that emit it. A byte count of
the seed would be dominated by data that does not exist on disk; a line count is honest. This is
the same reason the generators were written that way in the first place.

**`packages/db/src/problems.ts` is 1381 lines and most of it is not code:**

| | lines |
| --- | ---: |
| English prose — statements, notes, input/output formats, discriminators | **572** |
| design-rationale comments | 175 |
| code and small test-data literals | 635 |

So of the 1930 "seed-data" lines above, roughly **570 are problem statements written for players**
rather than anything a compiler reads.

**Tooling is 782 lines** — `audit-wrong` (1037 lines, the largest single file in `packages/db`
because it carries 38 wrong solutions and their reasoning), `verify-seed`, `coverage`, `gate`,
`samples`, `fill`. That is roughly one line of bank-verification machinery for every 22 lines of
application code, which is high and is where the last four sessions went.

**Commits: 36**, from `Phase 0: design system and primitives` to
`Add pnpm db:samples: derive sample outputs from the reference, and validate the inputs`.

**The last several sessions are uncommitted** — 12 files changed, +1624/−72, plus five untracked
files (`probe-cleanup.ts`, `audit-wrong.ts`, `coverage.ts`, `fill.ts`, `gate.ts`). That is yours to
commit; nothing has been committed on your behalf.

### Verification

`pnpm db:verify` — **all three passes green**, 153/153 test cases, 76/76 bounds, 37/38 wrong
approaches caught. `pnpm db:seed` succeeds with no override. typecheck 7/7, core 56/56, smoke 5/5,
**probes 5/5 with zero teardown noise**, **e2e 17/17**.

### What is next

The bank is sound and the road to launch (§12) is: the shareable spectator link is done, challenge
links are done, so **Phase 2E — deployment** is the remaining item. Per §13.10, stopping here.

---

## Stage 0 — a public HTTPS URL, and the deployment bugs found cheaply

**`pnpm tunnel` puts the local stack behind one public HTTPS URL.** Verified against the live
tunnel: `/play` 200, the same-origin socket.io handshake 200, `/dev/*` 404, and an unknown
challenge code 200 (our screen, not an error page).

> **THE STAGE 0 URL IS FOR PEOPLE YOU KNOW. DO NOT POST IT.** A quick tunnel has no access
> control, and the judge is executing strangers' code on a personal laptop rather than on a
> disposable VPS.

### The single-origin design, and what it removed

Caddy sits in front of both services on `:8080`, routing `/socket.io/*` to the gateway and
everything else to the web app; the tunnel points at Caddy. One URL instead of two, and three of
the five listed bugs stopped being bugs rather than being fixed:

- **`wss://` is derived, not configured.** `io()` connects to the page's own origin and takes the
  protocol from `location`. Mixed content became impossible to write.
- **`NEXT_PUBLIC_GATEWAY_URL` stopped mattering.** It is empty in every proxied environment, so
  there is nothing to inline at build time and nothing to point at the wrong gateway. All four call
  sites now go through `gatewayTarget()` in `apps/web/lib/gateway.ts`.
- **Cross-origin disappeared.** Same origin means no CORS preflight and no `SameSite` question.

`deploy/Caddyfile.stage0` is the Stage 1 config with a different hostname, so this is a rehearsal
rather than a detour.

### 1. Bank soundness is now host-dependent, mechanically — `pnpm db:timing`

Measures every reference against its largest test on the current host and reports effective wall
clock, modelled as `cpu / 0.5` because the judge gives each submission half a core.

**Threshold: a reference may use at most 40% of the limit — 2.5x headroom.** Chosen because the
move under consideration is x86 to ARM at half a core: Ampere is roughly 1.3–1.7x slower per clock
for scalar integer work, so 2x would be spent by the move alone, and beyond ~3x the gate starts
failing problems that are genuinely fine. A gate that cries wolf gets ignored.

**It found two real problems on the x86 baseline, before any host change.**

- **`coin-change-min` needed 940% of the limit.** The test I added last session to cover `n <= 100`
  sat at the worst legal point of *two* bounds at once — target 10^6 with n = 100 — which is a
  10^8-step DP and 23.5 CPU-seconds in Python. Shrunk to target 20000, which covers the same bound;
  `target <= 10^6` is covered by a different, cheaper test. Now 18%.
- **`edit-distance` needs 3.4x the limit** and no test change fixes it: `|a| = |b| = 2000` is a
  4·10^6 cell DP, ~3.7 CPU-seconds in Python against a budget of 2.

That second one is a **language-parity fact, not a host fact**, and conflating the two would hide
both. The tool now separates `HOST-THIN` from `LOCKED`, and `pythonLocked` is a recorded field on
the problem with a reason — the same shape as `discriminator: null`. It matters because §8 hands
problems out without knowing the player's language, so **a Python player drawn onto `edit-distance`
cannot win.** The structural fix is per-language time limits, and the tool prints exactly the number
that designs it: **a 4x Python multiplier covers the whole bank.** Not built.

`coin-change-min` keeps its `pythonLocked` note even though its tests now fit, and the tool
reports that state separately rather than demanding the note be deleted. The note is a claim about
the *constraints* — a legal input exists that Python cannot do — and §6.8's hack phase could supply
one even though no seeded test does. An earlier version of the check would have deleted a true
statement on the strength of a measurement that does not bear on it.

**gcd-pair's `notADefect` no longer carries a number.** It said "measured 0.50s in C++", which
froze a claim about a *host* into a comment. `db:timing` now compiles that exact approach, runs it
at `(10^9, 1)`, and re-derives the verdict per host — and says that if the margin ever closes,
gcd-pair should *gain* a test rather than keep the exemption. On this host: **1840 ms effective,
36.8% of the limit, still legitimate.**

### 2. `TRUSTED_PROXY`, with the positive control

`none` (default) ignores every proxy header; `cloudflare` trusts `CF-Connecting-IP` only, because
Cloudflare overwrites it at its edge; `local` reads the **last** `X-Forwarded-For` hop, never the
first. An unrecognised value falls back to `none` — the safe failure is everyone sharing one
bucket, not everyone getting their own.

**Positive-controlled:** `BREAK_TRUSTED_PROXY=1` restores the old unconditional trust, and **4 of 7
tests fail**, including the one that matters — four forged addresses minting four buckets where
they must mint one.

**The test itself had the bug it was testing for.** The forged-bucket assertion read the ambient
environment, so once `.env` gained `TRUSTED_PROXY=cloudflare` it silently began asserting the wrong
mode's behaviour and failed. Now it pins the mode explicitly. A security test whose verdict depends
on which env file was sourced is not testing the code.

Caddy is configured to **overwrite** `X-Forwarded-For` rather than append, closing the second path
to the same lie. And `WEB_ORIGIN` now accepts a comma-separated list with a narrow `*.` hostname
suffix wildcard, because a quick tunnel's hostname is not knowable before `cloudflared` starts. The
wildcard is Stage 0 only and has its own test, which tries `https://trycloudflare.com.evil.test`
and the bare suffix.

### 3. Stage 0 safety — what changes when the judge runs on your laptop

Containment is unchanged and still proven; what changes is the **blast radius**. On a VPS a miss
costs a rebuild; here it costs your machine, your SSH keys and your browser profile.

What is tightened, and what is not:

- **`/dev/*` is refused at the edge by Caddy**, and the production build already 404s the ticket
  route `/api/dev/sparring-ticket` — which is the actual control. The page shell renders in any
  mode and is harmless without a ticket. My first version of this check probed the page and printed
  a scary warning about something that was never the risk.
- **`NODE_ENV=production` is not optional**, so the tunnel serves a production build on `:3001`,
  separate from the `:3000` dev server. Both can run at once and the tunnel can never accidentally
  expose dev mode.
- **Judge concurrency should be lowered for Stage 0.** On a VPS the cap exists to bound cost; here
  it bounds how much of *your* machine a stranger can occupy. `JUDGE_CONCURRENCY=2` is the Stage 1
  number and is the right number here too, for a different reason.
- **What is not tightened, deliberately:** the sandbox flags. §11's set is already the strong part,
  and weakening or "hardening" it ad hoc for one stage is how the `--ulimit nproc` incident
  happened. The right response to a higher blast radius is fewer strangers, not different flags —
  hence the URL rule above.

### 4. Quick tunnel churn — a stale link fails CONFUSINGLY, and that is worse than expiry

You are right that a challenge link embeds the tunnel hostname, and the consequence is worse than a
dead link:

- **An expired challenge fails cleanly.** `/c/<code>` on a live tunnel returns our screen —
  verified through the public URL, an unknown code returns **200**, saying who challenged whom and
  offering to send one back.
- **A dead tunnel never reaches us at all.** The hostname is released, so the request dies at
  Cloudflare's edge and the visitor gets a Cloudflare error page. All of §7's stale-link work is
  bypassed, because it lives in an app the request never arrives at.

So tunnel churn is not "the link expires", it is "the site appears broken". The mitigation is a
named tunnel on a stable hostname, which needs a domain — hence the eu.org clock below.

### Starting a eu.org application now

Approval is volunteer-reviewed and reportedly takes days to weeks, so start it in parallel:

1. Register at **`nic.eu.org`** and confirm the account by email.
2. **New domain request**, pick `<something>.eu.org`.
3. For nameservers: create a free Cloudflare account first, add the domain as a zone, and Cloudflare
   gives you two nameservers like `xxx.ns.cloudflare.com`. Enter **those** on the eu.org form —
   eu.org delegates, so the zone must exist on Cloudflare before the request is approved.
4. Keep the request simple and truthful; volunteers reject vague ones.

Freenom is dead (`.tk`, `.cf`, `.gq` shut down) — ignore any guide recommending it. DuckDNS and
`is-a.dev` style services will **not** work: a named tunnel needs a delegated zone, not a CNAME.

### Verification

`db:verify` all three passes green, 153/153 test cases. `db:timing` green on x86 with one recorded
`pythonLocked` exception. typecheck 7/7, core 56/56, unit 7/7 (and 4 failing under
`BREAK_TRUSTED_PROXY=1`), origin 4/4, **probes 5/5**, **e2e 17/17**. Live tunnel verified over IPv4.

One measurement artefact worth recording: `*.trycloudflare.com` resolves **AAAA-first**, and this
WSL2 host has no IPv6 route, so the first verification reported the public URL as dead when it was
fine for everyone else. Another "absence trivially true" result. The script now resolves the A
record over DoH and pins it, so the check tests the tunnel rather than local IPv6.

### Not done

Stage 1 — the Oracle instance — is next, and `pnpm db:timing` is the first thing to run on it. Per
§13.10, stopping here.

---

## Phase 3A — the shell

§12 is updated: **Phase 3 is now the priority**, ahead of the per-language multiplier and
everything else, and it splits into 3A (the shell) and 3B (what fills it). The reasoning is
recorded there rather than here, because it is a lesson and not a status: **a deferred shell does
not read as "coming soon", it reads as abandoned, and it discredits the match screen it wraps.**

### 1. Dev artefacts removed from the player path

Audited every player-facing route. What was there for my benefit rather than a player's:

| where | what | why it was wrong |
| --- | --- | --- |
| `/` | `CURRENT_PHASE.label` + `.summary` — *"Phase 2E — Deployment"* and a sentence about that session's work | A build log addressed to the person writing the code, printed **above the product name**, first thing every visitor read |
| `/` | Links to `/dev/judge`, `/dev/hud`, `/dev/kitchen-sink` | Three of the four front-page links went to a developer's toolbox |
| `/play` | The **Socket events** panel — raw event names, side labels, gateway transitions | The largest element on the screen after the Play button, so it was the first thing read. It told a player nothing they wanted |
| `/play` | `CURRENT_PHASE.label` above the word "Play" | Same as above |

Nothing was lost: `/dev/sparring` still shows the same event stream, and the JSONL log on disk
remains the authoritative record (§10). The `/dev/*` routes are unchanged and still reachable
directly — they are just no longer advertised on the player path, and the rail hides itself on them.

### 2. The Hub

`/` signed in is now the Hub; signed out it is a pitch with two buttons and no jargon.

**The layout is an argument about priority.** PLAY is a 48px display-type control in `--p1`,
by a wide margin the largest thing on screen, top-left where reading starts, with the mode
selector attached beneath it (Ranked live; Blitz and Bo3 shown disabled, since §12 defers them in
full and a control that changes shape as features land teaches players to re-read it). Rank sits
beside it because "where am I" is the second question, never the first. Recent matches and the
challenge control sit below, smaller than both.

**Pressing PLAY queues.** §6.1 is explicit that PLAY starts searching rather than navigating to a
screen with another PLAY on it, so the intent travels as `?queue=1` and `/play` acts on it the
moment the socket is up. Same for *Create a link* via `?challenge=new`. The link-minting code was
**extracted into one `createChallengeLink` callback used by both callers** rather than duplicated —
a second path to the same state is how the challenge waiting-slot bug happened.

**Motion:** nothing on the Hub animates on load. It is not one of §2's five moments; it is the
place you pass through on the way to one, and a screen that performs on every visit is tiring by
the third.

### 3. Rank tiers — the ladder exists

`packages/core/src/ladder.ts`, **18 tests**, pure and independent of Glicko: it takes a number, so
the ladder can be tested and rendered without a rating system anywhere near it.

**Nine tiers, 200 points each, four divisions of 50.** The width is chosen against the bank rather
than picked: problems run 800–2000, matchmaking selects at mean − 120, and most players will sit
between 1200 and 1600, so 200-point tiers put four or five tiers across the populated range. Wider
and nobody promotes; narrower and the badge churns. Iron is open-ended downward.

A player at 1442 now sees **Gold II, 58 to Platinum** — asserted as a test, since it is the
example §8 gives.

**Placements show no badge at all.** Showing somebody Bronze IV after one match and Gold II after
five is worse than showing nothing, because the first badge is the one they remember. The Hub
shows `2/5` in a dashed plate until placements are done.

**What earns a cinematic is decided in `ladderChange`.** A *tier* change fires the §6.7 rank-up; a
*division* change does not, because firing the full sequence four times per tier is how a moment
stops being one (§2 rule 3). Finishing placements counts as a tier change — it is the first badge
the player has ever had. Demotion is detected and reported as a descent, not silently as an ascent.

`auraOf` implements §4's rule that **most tiers get no aura**: flat colour through Gold, faint at
Platinum and Diamond, full at Master and above. A test asserts no tier is left unclassified.

### 4. The left rail

The three-item top bar is replaced by the persistent rail from §7, **capped at six**. Four live
(Hub, Play, Spectate, sign out) and two shown-but-disabled (Profile, Ladder) because they are 3B
and a rail that changes shape teaches players to re-read it. The active marker is a 2px bar in the
player colour driven by a transform, not a layout change. It hides itself on `/watch/*`, `/c/*` and
`/dev/*`, where the viewport belongs to the match.

### Verification

Landing page greps clean for `dev/hud`, `dev/judge`, `kitchen-sink` and `Phase N`. A real
registered session renders the Hub with the placement plate, all three sections and zero dev
artefacts. **core 74/74** (56 + 18 ladder), unit 7/7, typecheck 7/7, **e2e 17/17**.

### Not done — deliberately, and this is the part to look at

**The rank-up cinematic is not yet wired to a real match**, and **league colour is not yet on
handles**. Both were in 3A's scope and both are downstream of the ladder that now exists — the
cinematic needs `ladderChange` called on `match.end` with the pre-match rating, and the handle
colour needs a shared component that reads tier outside a match and defers to `--player` inside
one (§4: side colour always wins). They are the first thing in the next session.

Per the instruction to stop and let you look before 3B: **the shell is in, please look at it.**
Getting it wrong and then filling it with four more screens is the expensive mistake.

---

## Both tunnel failures — one cause, and it was a one-word bug

**Diagnosis: `cleanup()` called `stop_pid next` while the pidfile is written as `web.pid`.**
The names did not match, so `stop_pid` returned silently, **the production web server survived
every Ctrl-C**, and the script still printed *"tunnel, proxy and web stopped"*.

The chain from there:

1. Next run rebuilds, **overwriting `.next-build` underneath the still-running server**.
2. `next start -p 3001` fails `EADDRINUSE` — visible in `web.log` and nowhere else.
3. The readiness check `curl :3001/play` **passes**, because the stale server answers.
4. The script proceeds and prints a URL pointing at a server whose build directory has been
   replaced under it.

Evidence, not inference: the stale process was started **19:09:07** and
`.next-build/BUILD_ID` was rewritten **19:15:09** — six minutes later.

**Both reported symptoms follow from that one state, and both were reproduced against it:**

| symptom | reproduced | why |
| --- | --- | --- |
| *"Unexpected end of JSON input"* on registration | `POST /api/auth/register` → **500, empty body, no content-type** | Next lazily loads route modules from disk; the chunk had been replaced, so the route 500s with nothing in the body and `response.json()` throws |
| *"a client-side exception has occurred"* | HTML references chunk hashes the rebuild replaced | The document loads, its scripts 404, React cannot hydrate |

**There is no second bug.** Against a genuinely fresh production build the same request returns
`200 {"ok":true,"handle":"fresh7"}`. The production path, `NODE_ENV`, Caddy, cloudflared and the
database were all fine — every one of those candidates is eliminated by that one result.

### Was the tunnel hostname embedded in the build? No — and it is checked, not assumed

```
grep -rl trycloudflare apps/web/.next-build   →  0 files
grep -rl localhost:4000 .next-build/static    →  0 files
```

**The single-origin property holds.** The bundle contains no hostname at all, so a new tunnel
hostname needs no rebuild for correctness. That is now stated in the script header alongside the
grep that proves it, because "is a rebuild expected?" was exactly the question that could not be
answered from the outside.

### 1. The workflow can no longer do this

- **`cleanup` stops `web`**, the name it actually writes.
- **`free_port 3001` runs BEFORE the build**, not after, so a rebuild can never land underneath a
  running server. It kills by *port ownership* rather than by pidfile — the pidfile answers "did
  the process I started die", which is the wrong question.
- **The served build is compared against the built build.** `BUILD_ID` on disk versus the one the
  server reports; a mismatch aborts with "that is a stale process". *"Something answers"* is not
  *"the thing I started answers"* — that conflation is what let every previous run proceed.
- The script still rebuilds each run, because it is also what you run after changing code, and a
  stale build is the likelier mistake. What it must never do is rebuild under a live server.

### 2. `pnpm tunnel` verifies before printing a URL

Same standard as the containment canary. It fetches the landing page, **fetches every script the
page references**, and **registers a throwaway account through the real route over the real
hostname** — the exact request that failed. Any failure and **the URL is not printed**.

Verified working end to end: `/` 200, `/play` 200, `/register` 200, socket.io handshake 200, and
`POST /api/auth/register` → `200 application/json`.

**Two false alarms in my own new check, both fixed, both the house pattern.**

- It reported *"every referenced script loads"* on a run where the landing page came back **empty**
  — nothing to iterate, so nothing failed. Identical in shape to the probes reporting
  "prisma noise: 0" while every probe was failing to connect. The asset **count** is now asserted,
  not just the failure count.
- It counted `000` as a missing asset. `000` is curl failing to connect, not a 404, and a quick
  tunnel caps concurrent in-flight requests — so a burst of checks produced transport failures and
  the pre-flight refused a URL that worked. Assets now retry, and `000` after retries is reported
  as transport, distinctly from a real 4xx.

### 3. A non-JSON response no longer lands in the player's face

`AuthForm` reads the body **as text once**, parses defensively, and on failure shows
*"Something went wrong on our side (500). Please try again."* while logging the status,
content-type and first 2 KB of the real body to the console. The server being at fault does not
license an incomprehensible message.

### 4. Running e2e against the production build behind Caddy

This is the third instance of the class — the RSC seam, the asset collision, now this — and the
common property is that **e2e runs against `next dev` on `http://localhost:3000`, which is not the
configuration any real person uses.** Every one of these bugs lived in the gap.

What it would take, in order of cost:

1. **A second Playwright project with `baseURL` pointing at Caddy (`http://localhost:8080`)**, and
   a global setup that builds, frees the port, starts `next start -p 3001`, and starts Caddy. The
   specs need no changes — they are already written against relative paths. This is the bulk of the
   value: it exercises the production build, the reverse proxy, the single-origin socket path and
   the proxy headers.
2. **`TRUSTED_PROXY=local`** for that project, since Caddy is the proxy rather than Cloudflare, so
   the header path under test is the one that ships.
3. **Two specs that only make sense there**: every referenced script loads (the client-exception
   check, promoted from the pre-flight into the suite), and registration returns JSON with a JSON
   content-type.
4. **Not through the tunnel.** A quick tunnel adds a random hostname, an in-flight cap and real
   network flakiness; the failures found here were all local to build-and-proxy, and a suite that
   fails intermittently for transport reasons gets ignored. Caddy is the right boundary.

Cost is roughly one config file, a global setup script, and about three minutes added to a full
run. **It is worth it**: three production-only bugs have now shipped past a green suite, and the
suite was green each time because it was testing a configuration nobody runs.

### Verification

typecheck 7/7, core 74/74, unit 7/7. `pnpm tunnel` completes its pre-flight and prints a URL whose
landing page, assets, socket handshake and registration all verified independently afterwards.
Cleanup now leaves :3001 genuinely free, checked directly.

### Not done

The production-configuration e2e project (item 4) is specced above and **not built** — it is the
next thing, and it is what stops a fourth instance. Phase 3A's two remaining items (rank-up
cinematic wiring, league colour on handles) are still outstanding behind it.

---

## The 500 was a missing DATABASE_URL — and my earlier "proof" was invalid

**Root cause: `scripts/tunnel.sh` never sourced `.env`. `scripts/up.sh` does (line 37).**

So `pnpm stack` started the gateway with a database and `pnpm tunnel` started the production web
server without one. `next start` runs from `apps/web`, and Next only auto-loads `.env` from the
application directory, so the repo-root `.env` was never read.

**Every GET works without a database**, which is why the failure was so well hidden: the landing
page, all 12 assets and the socket.io handshake passed, and the first route that touches Postgres —
registration — returned a 500 with an empty body.

Reproduced exactly, by starting the production server with `DATABASE_URL` unset:

```
register: status=500 type=[]  body=[]
landing:  200
server:   Invalid `prisma.user.findFirst()` invocation:
          error: Environment variable not found: DATABASE_URL.
```

### My earlier conclusion was wrong, and the reason matters

I reported that "against a genuinely fresh production build the same request returns 200". That was
true of *my* run and false of yours, because **I had run `set -a; . ./.env; set +a` in the same
shell before invoking the script every single time.** My testing inherited the variables the script
fails to load. The check passed for me and failed for the person running it cleanly — the worst
possible split, and one I created by never once running the thing the way it is actually run.

The fix for that specific blind spot is in the verification below: the final run was made in
`env -i` with nothing but `HOME`, `PATH` and `TERM`.

### Layer isolation, as asked

| hop | result |
| --- | --- |
| `:3001` direct | **200** `application/json` |
| via Caddy `:8080` | **200** `application/json` |
| through the tunnel | **200** `application/json` |

All three passed *once `.env` was sourced*, which is what localised it to the environment rather
than the app or the proxy chain.

**Item 3 — the pre-flight reusing a handle — was ruled out first, as the cheapest test.**
`probe$(date +%s%N | tail -c 6)` produces a fresh handle per run (`probe83487`, `probe25121`,
`probe54708`), and the email derives from it. Not a unique-constraint collision.

### Three fixes

**1. `tunnel.sh` sources `.env`, and fails fast if it cannot.** It now refuses to build at all
unless `DATABASE_URL`, `REDIS_URL` and `SESSION_SECRET` are set — starting a server that will 500
on its first query is strictly worse than not starting, because the failure then surfaces to a
player instead of to the operator.

**2. Nothing leaves the register route as an empty 500.** The handler is wrapped, and the two cases
are separated because they differ in kind:

- **A duplicate is not an error.** `register()` already returned a polite 400, but its clash check
  and its insert are not atomic, so two simultaneous signups can both pass and one hits the unique
  index. Prisma's `P2002` now lands in the same place as the polite check, as a **409**, instead of
  becoming a server error.
- **Anything else is ours.** A readable JSON 500 with a short reference, and the real cause logged
  server-side under the same reference so the two can be matched.

Verified: duplicate → `400 {"error":"That handle or email is already taken."}`; unexpected failure →
`500 {"error":"Something went wrong on our side. Reference sgtk5w."}` with
`[register:sgtk5w] unhandled failure` in the log.

**3. The pre-flight's own error message was garbled**, which cost the whole first diagnosis. It read
the status by counting lines from the end, so an **empty content-type** — exactly what a crashed
route returns — shifted everything by one and printed `returned (500)` with a blank status. It now
parses labelled fields. A diagnostic that garbles the one number it exists to report is worse than
no diagnostic.

Also fixed, same class as the asset check last session: `/dev/sparring` returning `000` was reported
as **"is PUBLIC"** — a transport failure announced as an exposure. `000` is "could not ask", not "is
exposed"; it now retries and distinguishes.

### Verification

**Final run made in `env -i`** — no `.env`, no inherited variables, the way you run it:

```
✓ gateway :4000 is up
✓ database, redis and session secret are configured
✓ production web on :3001 (/play -> 200, build XYWDHgIm)
✓ Caddy :8080, /dev/* refused at the edge
✓ public URL answers 200 · socket.io handshake works
✓ every referenced script loads (12 checked)
✓ registered a throwaway account through the real form (probe35293)
```

Independently against the printed URL afterwards: `/` 200, `/play` 200, `/dev/sparring` 404,
register `200 application/json`, duplicate register **400**. typecheck 7/7, core 74/74, unit 7/7.

### What this says about the e2e gap

This is the fourth instance, and it is a sharper version of the same thing: the production
configuration was never exercised, and neither was the *invocation* — I only ever ran the script
from a shell I had already prepared. The production-configuration Playwright project specced last
session would have caught the empty-500 shape; running it from a clean environment is what would
have caught the missing variable. Both belong in the same piece of work, and it is still not built.

---

## The production e2e project, env guards, and the false-alarm mechanism

### The suite exists, and it is already earning its keep

`pnpm test:e2e:prod` runs the specs against **`next start` behind Caddy on one origin** — the
topology `pnpm tunnel` and Stage 1 use. `e2e/prod.setup.ts` builds, starts the server, starts the
proxy, and tears both down.

**Both halves, as proposed.** The `baseURL` change is the easy half. The important half is the
invocation: child processes are started with an **explicitly constructed environment**, not
`...process.env`. A variable reaches the app because it is named in that list, so a missing one
fails in setup rather than becoming a property of whoever's shell launched the suite. That is the
`env -i` lesson expressed where it can be enforced.

**Four new specs**, one per bug that shipped past a green suite:

- every script the landing page references actually loads, **and the script count is asserted** —
  "no failed assets" over a page that loaded none is the vacuous pass this whole class is about
- registration returns JSON *and* a parseable body, and a **duplicate is a 4xx**, never a 500
- `/dev/*` is 404 through the proxy, asserted as a status rather than as "not 200"
- `/socket.io` is proxied on the same origin

**Status: 15 of 21 passing. All four new specs pass. Six do not, and that is a real finding.**

It has already caught two production-only differences:

1. **The gateway's origin allowlist did not include the proxy origin.** The suite serves from
   `:8180`; `WEB_ORIGIN` listed only `:3000`, `:3001` and the tunnel wildcard, so every socket was
   refused. Fixed by adding it — and note the gateway had to be *restarted* to pick it up, which
   `pnpm stack` does not do for an already-running service.
2. **Six match/relay specs still fail under the production configuration and pass under dev.**
   Not yet diagnosed. **I am not calling this suite green**, and it should not be treated as green
   until those six are either fixed or understood — they are exactly the class of thing it was
   built to surface, and the whole argument for building it was that dev hides them.

The dev suite is unaffected: **17/17**.

### Every entry point now refuses to start without its environment

| entry point | requires | mechanism |
| --- | --- | --- |
| `pnpm stack` (`scripts/up.sh`) | `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` | `require_env` |
| `pnpm tunnel` (`scripts/tunnel.sh`) | same | `require_env` |
| gateway (`apps/gateway/src/index.ts`) | `DATABASE_URL`, `REDIS_URL` | `requireEnv` |
| judge (`apps/judge/src/index.ts`) | `DATABASE_URL`, `REDIS_URL` | `requireEnv` |
| production e2e (`e2e/prod.setup.ts`) | all three | explicit env list |

Each **names every missing variable at once** rather than failing on whichever comes first, because
failing one at a time turns one restart into three. `apps/judge` gained a workspace dependency on
`@1v1/core` to share the guard rather than duplicate it — no external package.

Positive-controlled: gateway and judge both print
`missing required environment: DATABASE_URL` and exit; `require_env` and `require_checked` were
exercised directly under `env -i`.

### The false-alarm class is mechanised, not just written down

**§13 rule 7 — "A check that cannot fail is not a check"** — now states the pattern, lists six of
the sixteen instances, and notes that **two of the sixteen are in the pre-flight written to catch
the other fourteen**, which is the proof that a remembered rule is not the fix. **Rule 8 — "Run it
the way it is actually run"** — records the invocation lesson and the `env -i` standard.

The mechanism is `scripts/lib/check.sh`, three functions for the three recurring shapes:

- **`require_checked COUNT LABEL`** — zero iterations is a failure. This is the single most common
  shape: the asset loop over an empty page, the probes that never connected, the containment suite
  whose canary never ran.
- **`http_probe` / `expect_status`** — "could not ask" is never "asked and got a bad answer".
  `curl` writes `000` for a failed connection and it looks exactly like a status code. That one
  conflation produced false alarms in **both** directions: a working URL refused, and
  `/dev/sparring is PUBLIC` announced on a run where it was correctly blocked. `expect_status`
  returns a distinct exit code for *unreachable*, so the caller decides whether not-knowing is
  fatal rather than having a string comparison decide for it.
- **`require_env`** — the guard above.

Plus `requireEnv` in `@1v1/core/env` for the TypeScript entry points. Both scripts now source the
library instead of hand-rolling the same three mistakes.

**What is not yet mechanised, honestly.** Two of the sixteen do not fit these shapes: the readiness
check satisfied by a *stale process* (fixed ad hoc with a BUILD_ID comparison) and the security test
whose verdict moved with an *ambient environment variable* (fixed by pinning the mode). Both are
"verify identity, not liveness" and "pin your inputs" — real rules, but I do not have a helper that
enforces either without knowing what identity means for the thing under test. They are rule 7's
third and fourth bullets rather than functions.

### Not done

**The two Phase 3A stragglers did not fit** — the rank-up cinematic wired to `match.end` with the
pre-match rating, and league colour on handles. They are unchanged from last session and remain the
next thing, ahead of 3B.

**And the six failing production specs are ahead of even those.** A suite built to catch
production-only bugs that is currently reporting six of them should be resolved before more surface
area lands on top.

Per §13.12, stopping here.

---

## The six were one bug, the stack no longer hides stale config, and 3A is complete

### 1. One cause, not six

**All six drive a second player through `/dev/sparring`, which production deliberately removes.**
Caddy 404s `/dev/*` at the edge and `/api/dev/sparring-ticket` 404s under `NODE_ENV=production`
(§13.6). They are un-runnable in that configuration **by construction**, and their failing is the
production configuration working correctly.

Confirmed rather than assumed: every one of the six calls `spar.goto("/dev/sparring")`, and
`match.spec.ts:176` — the one match spec that needs no second player — passed throughout.

**Excluded by tag, not by silence.** The six carry `@needs-dev-routes` and the prod config carries
`grepInvert`, with the reason written into the config: two-player coverage in production is **not**
lost, because `challenge.spec.ts` drives two *real* browser contexts through a challenge link,
touches no dev affordance, and passes. That is the path a real pair walks; sparring exists because
one developer cannot be two people, not because it is more realistic. If `challenge.spec.ts` ever
stops covering a real match, the exclusion silently becomes a coverage hole — which is why it is
recorded there rather than left as a flag.

**`pnpm test:e2e:prod`: 15 passed, 0 failed.** Dev suite unaffected: 17/17.

### 2. `pnpm stack` no longer leaves a stale process running

The gateway kept an old `WEB_ORIGIN` while `pnpm stack` reported *"gateway already running"* — the
pidfile bug in different clothes. `start()` now hashes each service's config-relevant environment
(`config_env`), records it beside the pidfile, and **restarts a service whose config has changed**,
saying so:

```
! gateway is running with STALE config — restarting it
  (its environment changed since it started; a running process is not
   evidence that the config you just edited is in effect)
```

Positive-controlled in both directions by editing `.env` for real: unchanged → *already running*;
changed → restart; restored → restart back, with the live gateway's printed origins matching the
file. My first attempt at this control was invalid — I exported `WEB_ORIGIN` on the command line and
`up.sh` re-sources `.env` over it, so the test proved nothing.

### 3. Phase 3A is complete

**The rank-up cinematic fires on a real match.** It has existed in `/dev/hud` since Phase 1 and
nothing ever handed it a tier crossing. The change is computed **in `applyOutcome`**, which is the
only place both the pre-match rating and the pre-match placement count are still in scope — the row
is overwritten immediately after. `RatingDelta` gained a `ladder` field carrying it, so `match.end`
delivers it and the client does no rating arithmetic.

Promotions only. A demotion is real and shows on the Hub, but §6.7 is *"rank-ups should feel like
they cost something to earn"*, and playing that backwards on a bad night is kicking someone who is
already down. Division changes deliberately do not fire — four per tier is how a moment stops being
one.

**League colour on handles**, as a `Handle` component. `inMatch` is checked **first and returns
early**, so no tier styling is reachable from a match context however the component is later
extended — §4's separation rule enforced by control flow rather than by discipline. Aura is a
`text-shadow`, which has no spread parameter and therefore cannot quietly become §5's 24px state
glow. Most tiers get none. In use on the Hub for the player's own handle and every opponent in
recent matches.

### 4. Standing workstream started — 20 → 23 problems

§12 now carries **the problem bank as a standing workstream, not a phase**: 3–5 problems every
session until past 60, through the full pipeline, spread across the range.

The distribution was checked first and the thinnest bucket filled rather than the most interesting
one — **1700 was empty**:

| | rating | topic | discriminator |
| --- | --- | --- | --- |
| `trailing-zeros` | 900 | MATH | n = 25 answers 6, not 5 — 25 contributes two factors of five |
| `equalise-cost` | 1200 | GREEDY | the median, not the mean; one outlier drags the mean and cannot drag the median |
| `coin-ways` | 1700 | DP | coins on the outside, not totals — the other loop order counts orderings, 4 not 7 |

**The gates caught their gaps before I did**: the test-count policy demanded 7 for the 1200 and 9
for the 1700, and coverage demanded a test at `n = 100000`. Five wrong approaches modelled across
the three, all caught. `db:verify` **176/176**, `db:audit` clean, `db:coverage` clean, `db:timing`
all three under 2% of the limit.

Bank: **23 problems**, buckets 800–2000 now 2·1·2·2·2·2·2·3·2·2·1·2·1 — no empty bucket.

### Verification

typecheck 7/7, core 74/74, unit 7/7, **db gates all green (176 test cases)**, **e2e 17/17**,
**e2e:prod 15/15**.

### Not done

3B has not started, per the instruction to look at the Hub with a fresh account first. Outstanding
questions I still owe you an answer *from*: the empty-Hub state and tier distribution.

Per §13.12, stopping here.

---

## Tier distribution, the empty Hub, both repos public — and 3B part 1

### 1. The empty Hub

The emptiest this product ever is, and exactly what a friend arriving from a
challenge link sees. It was three blank panels.

**Placements are now a goal.** Five pips that fill, the count in display type, and
`5 placement matches to earn your rank` — a target rather than a dashed box pretending to be a
badge that failed to load. **An empty history teaches the two ways to start a match** — press
PLAY, or send a link your opponent needs no account for — instead of a sentence apologising for
having nothing, and closes on the thing that makes this product different: every match is
watchable live.

Verified against a genuinely fresh account through the real registration route.

### 2. Tier distribution — the bands were wrong, and the fix is measured

**Your instinct was right, and worse than you put it.** Modelling the base as N(1200, 300) — the
start is 1200, the spread taken from comparable CP ladders — the 200-point bands gave:

| | Iron | Bronze | Silver | Gold | Plat | Diamond | Master | GM | Legend |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 200-wide | 15.9% | 21.1% | 26.1% | 21.1% | 11.1% | 3.8% | **0.8%** | **0.12%** | **0.012%** |

Legend was **1 player in 8,139**. The decisive test is not the percentage but whether a badge is
ever worn at the scale this will actually have:

```
                   N=50        N=200       N=1000
  200-wide   3 badges dead   2 dead      1 dead
  150-wide   2 badges dead   1 dead      0 dead
```

**Bands narrowed to 150**, so nine tiers span 1350 instead of 1800. Master 3.3%, GM 1.1%,
Legend 0.4% — 1 in 261, a mountain somebody in a room of 250 people has climbed.

**On starting a third of the way up: the start should stay at 1200, and the answer is placements
rather than a lower start.** The rating is a *measurement prior*, not a reward — moving it distorts
matchmaking for everyone rather than changing what a badge says, and a strong new player would
climb out of an artificially low start immediately while being matched against people they should
not be. What makes early rank feel earned is that **no badge exists until five matches are done**:
the first badge is a result, not a starting position. A new account lands mid-ladder with three
tiers below and five above, which is climbing room in both directions.

The bands are presentation over Glicko, so this changed **nobody's rating** and can be recalibrated
again once there is real data — §8's "ratings converge on real data" applied to the mapping. The
ladder tests now derive from the constants rather than hardcoding boundaries, so the next
recalibration will not need them rewritten.

### 3. Both repos are public

**Secret scan re-run against full history on both before flipping, since public is irreversible in
practice.**

| | `.env` ever committed | SESSION_SECRET in any blob | key/token-shaped strings |
| --- | --- | --- | --- |
| `1v1code` | 0 | **0** | none |
| `argus` | none | n/a | none |

The 1v1code scan reads **every blob in the object database**, not just `git log -S`. argus was
scanned the same way for private keys, `ghp_`/`sk-`/`AKIA` tokens and inline passwords.

Both now **public**, with descriptions and topics:

- **1v1code** — `competitive-programming, websockets, docker, real-time, nextjs, typescript`
- **argus** — `cpp, computer-vision, real-time, onnx, edge-ai`

`gh repo edit --visibility` silently did nothing; the flip went through `gh api -X PATCH`. Confirmed
PUBLIC on both afterwards rather than assumed.

**argus already had a README of the same standard** — problem, what it does, differentiator,
architecture, quick start with verification, calibration, measurement, layout, requirements. 284
lines. No rewrite needed, so none was written.

### 4. Order of work recorded in §12

1. Phase 3B · 2. the §9 sound library · 3. Stage 1 deployment · 4. problem authoring as a block.

The sound library is **pulled out of deferred Phase 4 and scheduled**, because six placeholder
oscillator tones against a spec that calls sound *half the feeling of aliveness* should be a
decision rather than a leftover.

And recorded explicitly: **the thin problem bank is deliberate.** Authoring is the one thing on the
critical path that does not decay — a problem written in three months is worth what a problem
written today is worth, while an unbuilt screen blocks everything downstream. A future session
should not read 23 problems as a gap to fill on sight in place of scheduled work.

### 5. Phase 3B — part one only

**The leaderboard is built.** It is the screen the recalibration was for and the place league
colour does most of its work. Only finished-placement accounts appear; guests never do, because
they cannot earn rating and the row could never move. No pagination, deliberately — at this scale
the top 100 *is* the ladder.

**Three of 3B's four screens are not built: profile with the per-topic radar, the replay viewer,
and the live match panel.** I stopped rather than starting a fourth screen I could not finish
properly in the same session — the same reasoning that split 3A from 3B in the first place, and
your own standard that nine correct beats eighteen rushed. They are the next session.

### Verification

typecheck 7/7, core 74/74, unit 7/7, bank gates green (176 test cases, 23 problems), **e2e 17/17**,
**e2e:prod 15/15**. Pushed to `master`.

Per §13.12, stopping here.

---

## 3B part 2: the profile — and the event log turned out to be broken

### The replay investigation found a live bug in the keystroke relay

You were right that the replay viewer would be the first thing to read the log in anger. It did
not need to be built to find something: reading 338 real logs was enough.

**`MatchScreen`'s snapshot effect listed `onSnapshot` in its dependency array**, and `page.tsx`
passes it as an inline arrow — a new function identity every render. So the effect ran on **every
render**, and the damage was not cosmetic:

| | before | §10 says | after the fix |
| --- | --- | --- | --- |
| snapshot cadence | every **122 ms** | every 30 s | on mount and on desync |
| one match's log | 110 KB (367 snapshots, 1 delta) | ~130 KB of deltas, 16 KB of snapshots | **2 KB** (2 snapshots, 1 delta) |
| across 174 logs | 22,047 snapshots vs 2,977 deltas | — | — |
| worst single match | 932 KB, **zero deltas** | — | — |

Three consequences, in increasing order of seriousness:

1. **Logs ~50× larger than designed.**
2. **§10's paste-detection evidence was never being captured.** The effect also ran
   `pending.current = []`, discarding the delta buffer before its 50 ms flush, so matches logged
   *zero* deltas. The per-change `inserted`/`removed`/`origin` shape exists precisely so "the
   evidence exists when we decide what to do about it" — and it was being thrown away.
3. **The per-side monotonic `seq` was being reset constantly.** `seq.current = 0` on every render;
   across 80 logs, delta seq 1 appears **400 times**. §10 requires a receiver to REFUSE any batch
   that is not `lastSeq + 1`, because applying a delta to the wrong base silently corrupts the
   document. A sequence restarting hundreds of times per match makes that check fire on gaps that
   do not exist.

Fixed by putting the callback behind a ref and reducing the dependency list to `desyncKey` — the
only thing that genuinely means "start again". Verified on a fresh match: **367 snapshots → 2**,
which is one per side on mount, exactly right.

### Does §10's "replay is a pure function of the log" hold? No, and here is the precise gap

The ordering half holds: every event carries a gapless `seq`, replay orders by it, and nothing
depends on wall-clock time. **The self-containment half does not.**

A log references `p1`/`p2` as **user IDs** and the problem as a **slug**. Rendering a replay
therefore needs the `User` and `Problem` tables, so playback is a pure function of *(log +
database)*, not of the log. Two real consequences:

- A replay of a match between players who later change handles shows the **new** handles.
- A replay of a match whose problem was edited shows the **edited** statement.

So the log is not a recording, it is a **diff against mutable state**. The fix is to denormalise
the few display fields into `match.created` — handles and problem title at the time the match
happened — which is cheap and makes the claim true. **Not done here**, because it changes the log
format and belongs with the viewer that consumes it.

### The profile

**Profiles are public**, at `/u/<handle>`. A profile is the natural thing to link to, and §7
already establishes that watching needs no account; a profile a friend cannot open is a feature
built halfway. `/profile` redirects to your own, so there is one canonical shareable URL.

**§10's allowlist rule applied, because a profile is a new channel.** The public view is
constructed from named fields rather than filtered, so adding a column to `User` cannot leak it.
Anonymous and owner see the same thing — a profile whose content changes with the viewer is two
screens to keep correct, and nothing on it is private. Deliberately absent: email, `ratingDev` and
`volatility` (Glicko internals — §8 hides the rating behind a tier, so publishing its uncertainty
invites reading the number nobody was meant to read), and:

> **LIVE MATCHES ARE EXCLUDED, IN THE QUERY.** A profile listing an in-progress match with its
> spectator code would hand anyone a route into a live game, bypassing §7's mandatory 45-second
> ranked delay and §10's rule that a player may not spectate their own live match. This is the
> field nobody would have thought to check, which is what the allowlist rule exists for.

Verified: anonymous gets 200 and the public view, owner additionally sees "this is you", an unknown
handle 404s, a guest profile 404s, and a leak grep for email/`ratingDev`/`volatility`/`passwordHash`
returns **0**.

### The radar: hidden until it means something

**A radar from sparse data is worse than no radar, and the reason is specific.** With one or two
matches in a topic the only possible win rates are 0%, 50% and 100%; and any smoothing pulls an
unmeasured topic toward the middle, drawing a near-regular pentagon. **A regular pentagon does not
read as "no data" — it reads as "evenly skilled across all five".** That is a confident claim made
from nothing, on the screen a shared link most often lands on.

| matches | what the profile shows |
| --- | --- |
| **0** | no chart and no frame — one line saying what will appear and what it takes |
| **3** | the per-topic **breakdown**: played and won per topic, with progress bars toward the threshold. Counts are facts; a skill estimate from three is not |
| **30** | the radar, over the topics that qualify |

**A spoke needs 5 decided matches; the radar needs 3 qualifying spokes** — ~15 matches minimum,
realistically 25 before it is full. An unqualified spoke is pulled to the **centre**, never the
middle, so absent data can never look like average performance.

### A security test that depended on a CDN

`relay.spec.ts:78` — "a player cannot spectate their own live match" — started failing. **It fails
identically with my relay fix stashed**, so it was never the fix: the test did
`await import("https://esm.sh/socket.io-client@4")` inside the page, and esm.sh is unreachable from
this host (000 on IPv4 and default, 20 s timeout).

A security test that goes red for three minutes because a third party is down says nothing about
the gateway, and is the cry-wolf shape §13.7 is about. The ticket is still fetched **in the page**
— that is the identity under test — and the socket is now opened from Node with the workspace's own
`socket.io-client`. Nothing is lost: the gateway refuses by identity, and identity travels in the
ticket, not in which process holds the socket.

### Verification

typecheck 7/7, core 74/74, unit 7/7, bank gates green (176 cases, 23 problems), **e2e 17/17**,
**e2e:prod 15/15**.

### Not done

**The replay viewer and the live match panel.** I stopped rather than start the viewer, because the
log format finding above should be fixed *first* — building a viewer on a log that needs the
database to resolve its own references would bake that dependency in, and the denormalisation is a
log-format change that wants to land with its consumer. That is the next session, in that order.

Per §13.12, stopping here.

---

## Exercising the delta path found the relay corrupting text

You were right that the delta finding was bigger than the log size. Exercising that path
deliberately — a long match, heavy incremental typing — found that **the keystroke relay drops
characters**, and it is the gateway's own authoritative state that is wrong.

### The finding

Typing `def step_0(n):` produces, in the **gateway's own final snapshot**:

```
'df stp_n):\n    ta= 0  n\n       ur tlt\n ...'
```

Roughly one character in three lost. This is not a reconstruction artefact: my replay of the
logged deltas and the gateway's authoritative snapshot agree **exactly**, which means the changes
as recorded are already lossy. Every spectator and every replay reads from that state.

**It was invisible until this session.** A full snapshot fired on every render and continuously
overwrote the damage with correct text, so the corruption never surfaced. Removing those snapshots
— the right fix — exposed a bug that had been there the whole time. The single-marker relay test
passes because it uses one bulk `insertText`, which is a single change; only incremental typing
across multiple batched Monaco events triggers it.

### Not root-caused, and I am saying so rather than guessing further

Two genuine faults were found and fixed, and **neither is the cause** — the corruption survived
both:

1. **The 50 ms flush interval was torn down on every render.** `[onDelta]` is a dependency and the
   parent passes an inline arrow, while `onChange` calls `setSource` — so every keystroke
   re-rendered and cleared the pending timer. Now stabilised behind a ref with empty deps.
2. **The delta buffer was swapped non-atomically** — read, passed to `onDelta`, then reassigned, so
   a change arriving mid-send could land in an array already being serialised. Now swapped before
   the handover.

Both are real and both are kept. The remaining suspect is how `rangeOffset` values from several
Monaco events accumulate into one batch: each event's offsets are relative to the document at that
event, and sequential application on the far side should preserve that, but the evidence says
something in that chain does not hold. **That is the next thing, ahead of everything else.**

### What is verified, and what the test now does

From a real match, after the snapshot fix:

| | result |
| --- | --- |
| deltas logged | **113** in one match (was ~1) |
| snapshots | 8 (was 367) |
| `seq` per side | **contiguous 1..113, no restarts** — the phantom-gap problem is gone |
| paste evidence | `changes`, `origin`, `inserted`, `removed` all present and populated; 974 inserted characters recorded |

So **§11's paste-detection evidence is now genuinely being captured** — verified against a real
match rather than against the code, which is the distinction that mattered.

`e2e/relay-load.spec.ts` is new and **marked `test.fail()`**: the suite stays green while the test
documents the open bug, and it goes red the moment somebody fixes the corruption without updating
it. Better than deleting it (the bug becomes invisible), skipping it (it rots), or leaving the
suite red (a red suite stops being read).

### Two of my own checks were wrong before the finding was real

Worth recording, because both are the house pattern and I nearly reported each as a product bug:

- Reading Monaco through `window.monaco` returned nothing — it is not global in this build — so the
  first run reported **every marker missing**, which looked exactly like a dead relay.
- Asserting a spectator's DOM in a **ranked** match ignores §7's mandatory **45-second** delay. The
  spectator legitimately shows nothing for the first 45 seconds; a burst sequence finishing in 30
  would fail for a reason unrelated to the relay.

The check that finally held is the one that does not depend on a viewer at all: replay the logged
deltas and compare against the gateway's own snapshot.

### Not done, and why

**The denormalisation, the replay viewer and the live match panel are all deferred**, deliberately.
Denormalising the log so replay is self-contained, and then building a viewer on it, would be
building on a stream that is known to be dropping characters — the viewer would faithfully render
corrupted source, and the format-version field would be stamped onto data that is already wrong.
The corruption outranks all three.

The three additions you asked for are still the right shape and are recorded for when it is fixed:
a format version integer, a full denormalisation list (handles, problem title and statement as
shown, test count, each player's rating and tier at match time), and discarding the 338 existing
logs rather than teaching a viewer two formats.

### Verification

typecheck 7/7, core 74/74, unit 7/7, **e2e 18/18** (the new spec included, passing as an expected
failure).

Per §13.12, stopping here.

---

## The relay corruption, root-caused — and it was none of the three fixes

### The mechanism

Your `rangeOffset` reasoning was right about the *symptom* and the diagnosis it implies is not
what was happening. Replaying a real log step by step, with the user typing `def ste…`:

```
seq 2  (0,'d') (1,'e') (2,'f')                    -> "def"      correct
seq 3  (1,' ') (2,'s') (3,'t')                    -> "d stef"   offsets 1,2,3
                                                                where they had to be 3,4,5
seq 4  (2,'e') (3,'p') (4,'_') (5,'0') (4,'()')   non-monotonic within one batch
```

The offsets were not stale-but-consistent, they were **wrong at capture time**, and one batch
contained offsets that could not all be valid against any single document.

**The cause: the Monaco editor was fully controlled** — `value={source}` with `onChange` calling
`setSource`. React state is asynchronous, so the `value` prop lagged the model while somebody
typed, and `@monaco-editor/react` then forced the model back to match the stale prop — **rewriting
the document underneath the change stream**, and emitting further events of its own.

**So none of the three options would have worked.** Descending-order application, offset rebasing,
and one-message-per-event all assume the recorded offsets are a coherent sequence against a
document only we are changing. There was a second writer.

For the record, had it been the batching, I would have taken the third option — per-event units
with a base version and loud rejection — because "make the failure loud instead of silent" is the
property everything else here has, and this bug is the argument for it: it was silent for months.

### The fix, and the verification you asked to make permanent

The editor is now **uncontrolled**: `defaultValue`, a `key` on language so switching remounts, and
`sourceRef` for submission. Removing `source` state also removes a re-render per keystroke, which
was what tore down the 50 ms flush interval.

`relay-load.spec.ts` flipped from `test.fail()` to passing — Playwright reported **"expected to
fail, but passed"**, which is the marker doing its job rather than a test quietly going green.

The permanent check is the one that found this without a viewer: **replay the logged deltas and
diff character-by-character against the gateway's own authoritative snapshot.** It reports the
divergence index and 20 characters of context either side. On a real match at seq 179 it now
reproduces the gateway's text exactly, and the guard was confirmed to actually execute rather than
being skipped.

Two faults fixed along the way that were real but not the cause: the flush interval torn down every
render, and the delta buffer swapped non-atomically.

### The denormalisation

`match.created` now carries everything a viewer needs with no database lookup:

- **`schemaVersion: 1`** — one integer, written even though only one version has existed, because
  the version you wish you had written is always the first one. Absent means version 0.
- **Both players at match time**: handle, rating, tier, division, plus `userId` for joining back.
- **The problem as shown**: title, rating, statement, input/output format, constraints, note, time
  and memory limits, and the public samples.
- **Match context**: mode, spectator delay, duration.

**No `testCount`, deliberately.** The match does not know it — the gateway holds only public
samples by design — and `submission.verdict` already carries `total`, which is where §6.4's cell
count comes from. A second copy could only disagree with the first.

**The 374 pre-v1 logs are discarded.** They have corrupted delta streams and no version field;
teaching a viewer two formats forever costs more than losing test data that was never real.

### A hardcoded tier, found by verifying the denormalisation

`cardFor` returned **`tier: "gold", division: "II"` for every player in every match** — a
placeholder from before the ladder existed. It survived because nothing rendered a tier anywhere
until Phase 3A, and **the denormalisation would have baked it permanently into every replay log.**

Tier is now derived from the ladder, and is **null during placements**: §8 gives a rating from match
one and a rank from five, so inventing one publishes the number the ladder exists to hide.
`PlayerCard.tier` is nullable through proto, gateway and client.

### One diagnostic detour worth recording

The production suite dropped to 11 passing mid-session. It was **Redis being down**, not the code —
the gateway could not bind and every socket-dependent spec timed out. Restarting the containers
restored 15/15. Worth noting because "four specs failed right after I changed the socket payload"
is exactly the shape that invites a wrong conclusion.

Also: `pnpm stack` restarts a service whose *environment* changed but not one whose *code* changed,
which bit me twice — the gateway kept serving the old `match.created` shape after I edited it.
Restarting explicitly is the current answer; the stale-config detector could reasonably grow a
source-hash check.

### Verification

typecheck 7/7, core 74/74, unit 7/7, bank gates green (176 cases, 23 problems), **probes 5/5**,
**e2e 18/18**, **e2e:prod 15/15**.

### Not done

**The replay viewer and the live match panel.** The log is now correct and self-contained, so both
are unblocked — this is the right place to stop rather than start the viewer with what is left of
the session. Next session, in that order.

Per §13.12, stopping here.

---

## The replay viewer, and three findings from being the log's first consumer

### The two small things

**`pnpm stack` detects stale CODE, not just stale config.** It compares the newest mtime under a
service's source trees against its pidfile and restarts, saying which. Same rule as the pidfile
check and `tunnel.sh`'s `BUILD_ID` comparison — *"something is running" is not "what I just wrote is
running"*. Positive-controlled both ways: untouched → *already running*; `touch relay.ts` → **STALE
CODE — restarting**; untouched again → *already running*.

**The production suite checks its dependencies first.** Postgres, Redis and the gateway, each by TCP
connect, before a single test runs — and an unreachable one aborts:

```
PRODUCTION E2E CANNOT RUN — a dependency is unavailable, which is not
the same thing as a test failing:
  - gateway on :4000 (start it with `pnpm stack`)
Nothing was run. Fix the above and try again.
```

Positive-controlled by stopping the gateway. This is the failure that had four specs reporting
"element not found" and pointing at the socket payload I had just changed.

**CLAUDE.md §13.8** now carries the denormalisation rule: it freezes whatever is wrong at the moment
it runs, so every field is checked at its source before being copied. The hardcoded `tier: "gold"`
is the worked example — invisible for months, and the migration would have made it look like
history rather than a bug.

### The replay viewer

**Playback is a pure reducer**, in `@1v1/core/replay` rather than in the page: `parseReplay`,
`markersOf`, `documentsAt`, `progressAt`. That is what makes §10's claim checkable — **12 tests, no
browser**, and it runs over all **17 real logs with 0 refused**.

What the tests pin down, each because §10 says so:

- **Ordering is by `seq` only.** A test feeds events out of time order and asserts they come back in
  seq order — a replay that sorts by timestamp reorders itself when a host clock moves backwards.
- **A torn final line is normal**, not corruption: append-only behind a buffer means a killed
  process leaves one. Corruption anywhere *else* is refused, because then the log stops being
  trustworthy from that point.
- **A pre-denormalisation log is refused with its version number**, not rendered. That is the whole
  reason the integer exists — those logs reference players by id, so the names would be whatever
  the rows say today.
- **Scrubbing backwards gives the same answer as arriving forwards.** `documentsAt` rebuilds from
  the start each call rather than keeping an incremental cursor, because a cursor that has to
  rewind is where drift gets in.

`/api/replay/<id>` serves the raw log — not a digest, which would be a second implementation of
playback that could disagree with the first. **A live match is refused**: serving its log would hand
over both editors' source in real time, bypassing §7's 45-second delay and §10's self-spectate rule.

The viewer itself: both documents side by side, a scrubber with §7's timeline markers (start,
submit, verdict, disconnect, end, and idle pauses over 20 s), 0.5×–8× speeds, and a clock. Handles
render **`inMatch`** — §4 suppresses tier colour anywhere a live HUD is on screen, and a replay is
one. Nothing animates on a seek: a scrubber is a tool, not a moment.

Match history on the Hub and profile now links to `/replay/<id>` rather than the live watch page.

### Three findings about the format, treated as findings

**1. Match ids are UUIDs, not cuids.** The schema declares `@default(cuid())`, but the gateway
generates `randomUUID()` and passes it explicitly, so the default never fires. A validation regex
written from the schema rejected **every real id** with a 400. The schema and reality disagree about
what an id looks like, and anything validating one has to know that.

**2. `var/replays` is repo-root relative, and the web server's cwd is `apps/web`.** The same
relative path resolved to `apps/web/var/replays`, so every finished match reported *"no log was
recorded"*. Two processes sharing a relative path agree only while they share a working directory;
the route now resolves the repo root explicitly.

**3. `match.started` repeats `problem` and `durationMs`** that `match.created` already carries.
Harmless today because they agree, but a viewer has to decide which to trust, and the moment they
can diverge one of them is wrong. **Worth collapsing before anything else reads the format** — which
is now, while the viewer is the only consumer.

None of the three was worked around in the viewer.

### Verification

typecheck 7/7, **core 86/86** (74 + 12 replay), unit 7/7, bank gates green (176 cases, 23 problems),
**e2e 18/18**, **e2e:prod 15/15**. The replay module verified against all 17 logs on disk.

### Not done

**The live match panel** — the last of 3B. Stopping rather than starting it here.

Per §13.13, stopping here.

---

## The three format findings fixed, and Phase 3B finished

### 1. The schema was lying, so the schema changed

`Match.id` declared `@default(cuid())` and **the default never once fired**: the gateway generates
`randomUUID()` and passes it explicitly, because the id also names the match's replay log on disk.

Taking the second option, as you suggested — the `@default` is gone rather than the gateway changed.
A UUID is fine; a default that cannot fire is worse than none, because it reads as documentation
and is a trap. It had already cost one route that 400'd every real match. Removing it means a
create without an id now fails loudly, and there is exactly one Match creation in the codebase
which always supplies one.

**Grepped for other cuid assumptions: none.** The only other mentions are two comments in `auth.ts`
and `password.ts` explaining why session tokens are deliberately *not* cuids, which is the same
lesson pointing the other way.

### 2. The relative path was the wider bug

`REPLAY_DIR` defaulted to the relative string `"var/replays"` in **four separate files** — the
gateway's log writer, the lifecycle probe, the pulse calibrator, and the web route — each resolving
it against its own working directory.

One resolver now, in `@1v1/core/paths`:

- **absolute always.** An absolute `REPLAY_DIR` is used as given, which is how a deployment points
  at a volume; a relative one resolves against the **repo root**, never `process.cwd()`, so the
  configured value means the same thing to every process.
- **`ensureWritable` at gateway startup**, refusing with the path and the reason. §10 makes the log
  the replay, so a process that cannot write one should say so on the line where that becomes
  knowable rather than on the first match.

You were right that this would break differently on Oracle: systemd units and containers place
processes wherever they like, and the same relative string would have pointed somewhere new and
looked like a fresh bug.

### 3. The duplication, and an audit of the rest

`match.started` no longer repeats `problem` and `durationMs`. It now carries **no payload at all** —
what it contributes is its `offsetMs`, the moment the clock started, which nothing else records.

**Audited every field in a real log for double-carriage.** Those two were the only genuine
duplication. `side` and `seq` appear on several event types, but as discriminators rather than
repeated facts — `seq` on a delta and on a snapshot are different sequences of the same counter, not
two copies of one value. Nothing else is carried twice.

### Phase 3B is finished — the live match panel

**The tension ordering is written now, deliberately.** §7 asks for it and with single-digit traffic
it is academic, which is exactly why it would otherwise default to newest-first and never be
revisited. Three terms, and the component is explicit about which is real:

- **closeness of rating** — the strongest signal a match is undecided, and the only term actually
  measured;
- **pair strength** — a strong match matters more to a stranger than the same margin lower down;
- **problem rating** — a labelled stand-in for §7's "deep into test cases", which lives in gateway
  memory and not the database. The note says to *replace* this term when the panel has a socket,
  not add to it.

Five tests, including that closeness saturates rather than going negative and inverting the other
terms, and that a blowout never outranks an even match.

**The empty state is the common case**, so it is designed as one: recently finished matches with
replays, which exist and are watchable. Verified — with nothing live it reads *"Nobody playing right
now — watch a finished match"* and links to real `/replay/<id>` pages. With no matches at all it
says so and offers to play the first.

Only `PUBLIC` matches are listed; `UNLISTED` is reachable by code and listing it would make §7's
distinction meaningless.

### Found by building the panel: phantom live matches

**Five matches were still `LIVE` in the database** from killed test runs. A `LiveMatch` exists only
in gateway memory, so a restart — a crash, a deploy, a `pnpm stack` — leaves rows stuck LIVE with
nothing behind them. Nothing reconciled that, so they accumulated silently, and the panel found them
the moment it existed and advertised matches nobody could join.

The gateway now reconciles on startup, logging the count. They are **`CANCELED` / `BOTH_ABANDONED`,
not `VOID`** — §6.9 reserves VOID for our failures and requires it to stay rare and alarming, and a
restart with a match open is ordinary. Neither moves a rating.

### Verification

typecheck 7/7, **core 91/91**, unit 7/7, bank gates green (176 cases, 23 problems), **probes 5/5**,
**e2e 18/18**, **e2e:prod 15/15**. Prisma schema validates. Reconciliation observed cleaning 5 rows
on the next start.

### Phase 3B is complete

Profile with match history and the per-topic radar, leaderboard, replay viewer, live match panel.
Per §12's order of work, next is **the §9 sound library**, then Stage 1 deployment to Oracle, then
problem authoring as a dedicated block.

Per §13.13, stopping here.

---

## Gateway-memory orphans, and the delta path finally exercised

Three of the four items from the 3B review. **§9 sound is split out to its own session** — it is a
new subsystem with a timing question attached, not a follow-up.

### 1a. A gateway restart left both players staring at a dead match

**They were told nothing.** The previous session made the *database* correct on restart; the two
browsers holding the match were never part of that. `matches` and `userMatch` are in-memory, so
after a restart the reconnect path found no live match for the socket and simply fell through —
match screen, running clock, opponent nameplate, over a match the server had already reconciled to
`ABANDONED`. Silence is the worst of the available answers, and on Oracle the gateway will restart
far more often than it does here.

**The client holds the match id, so the client asks.** `match.rejoin` (typed in `packages/proto`
first, per §13.5) has exactly three answers and none of them is silence:

| server state | answer |
| --- | --- |
| match is live in memory | `match.resync` — reconnect as normal, grace period intact |
| the row exists and has finished | `match.end` with the real outcome from the row |
| no such match, or not yours | `error` naming it |

The second is the case that matters: a player who was away when the match ended sees the result
screen with the real outcome, not a hang.

**Positive-controlled per §13.7.** `e2e/gateway-restart.spec.ts` starts a real match, kills the
gateway mid-match via a new `scripts/up.sh restart-gateway`, and asserts the player reaches a
terminal screen. It passes with the fix (27.2s) and **fails with the client change stashed** — the
page sits on the match screen exactly as described.

### 1b. Yes — and the other one was worse, because nothing rendered it

The question was right to ask. **The matchmaking pool is a Redis sorted set, so it survives the
gateway that wrote it — but every entry names a socket held by the process that died.** Nothing
cleaned them.

What that produces is not a stale display, it is a **manufactured broken match**: the atomic pairing
script pairs the next real player against a ghost, the ghost never accepts, and the live player
waits out the accept window for a `CANCELED`. The phantom LIVE rows were at least visible once the
panel existed. This one had no surface at all, and it would have looked to the player like the
matchmaker is broken rather than like the queue is empty.

Cleared on startup alongside the match reconciliation, logging the count.

**Rematch cooldowns are deliberately NOT cleared.** §6.1's 180s cooldown is a fact about two
players, not about a socket, and it stays true across a restart. Everything else surveyed —
challenge rows, spectator rooms, submissions — is either in Postgres already or is rebuilt from a
socket connecting, so it has no orphan state to leave behind.

### 2a. The markers say what happened and who

They were unlabelled ticks. Each now carries a hover label naming the event and the side —
`P1 wrong answer 7/10`, `P2 compile error`, `P1 paused 24s`, `P1 submitted` — with the clock offset.
Verdicts are translated to what a person would say rather than the enum, because `WRONG_ANSWER` is
a database value and "wrong answer" is a sentence. The counts are included because *how far they
got* is the reason to scrub there.

**Colour is by inheritance, not by branching.** A marker carries `data-side` and paints with
`bg-player`, so P1 and P2 are distinguishable at a glance without reading, and the component never
mentions jade or magenta — the same mechanism §4 requires of the match HUD. Sideless markers (match
start, match end) keep the neutral tone.

**The divergence marker from §7 is NOT built, and it is the one worth labelling most.** Being
explicit about why, so it is a decision rather than an omission: "the point where the match was
decided" is not an event in the log, it is an *inference* over it, and the honest version needs a
definition we do not have yet. The candidates are not equivalent — the last moment the trailing
player could still have won, the point where the test-bar lead stopped changing hands, or the
divergence in the two documents where one solution became correct and the other did not. The first
needs a model of remaining time, the third needs to run the judge over intermediate states. Guessing
one and shipping it would put an authoritative-looking marker on a scrubber over an inference
nobody checked. It goes on the list with the definition question attached.

### 2b. Real typed input replays character-exact — and now sparring can produce it

Confirmed, by execution rather than by reasoning: a match driven by incremental typing produced
**170 delta batches**, and replaying them from the opening snapshot reconstructs the gateway's
authoritative text **character for character**. `documentsAt` needed no changes.

**The reason this was worth doing is in the question.** Every delta this project has ever recorded
came from a human typing in a second browser, or from Playwright's `keyboard.type` in the one test
that reconstructs the document. Sparring only ever *submitted* — it never touched the editor — so
the path that has now lost characters through two separate bugs had exactly one exerciser, and it
was the one that needs two humans or a running browser.

Sparring gained **"Type it"**, which streams a reference solution as real batched deltas: 3–9
character bursts with 60–150ms pauses, sequence-numbered through the same relay a player uses. It
is deliberately not the §13.6 four-state typing model and does not pretend to be — it produces
*deltas*, not plausible human rhythm, which is what the replay path needs to be exercised. The
paste button stays, because a single-insert paste is also a real case and is what
paste-detection evidence looks like.

### Verification

typecheck 7/7, **core 91/91**, unit 7/7, probes 5/5 (lifecycle, match, requeue, visibility,
latejoin), **e2e 19/19**, **e2e:prod 15/15** (exit 0; the `SIGTERM` line in that output is Caddy's
own shutdown log during teardown, not a failure). The new restart spec is positive-controlled.

### Next

**The §9 sound library**, per §12's order of work — carrying forward the three constraints from this
review: that the countdown, sequential reveal and victory timings were fitted to placeholder
oscillators and may need revisiting rather than preserving, that the rising semitone per consecutive
pass is the placeholder behaviour worth keeping, and that every state change stays legible muted.

Per §13.13, stopping here.
