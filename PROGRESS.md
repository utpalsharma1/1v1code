# PROGRESS

## SESSION STOP — read this first

**Phase 2C-1 is built and verified. The keystroke relay works end to end.** Working tree clean.

### The visibility rule, attacked rather than confirmed

`pnpm probe:visibility` does not assert "the opponent received no deltas" — that passes trivially
if the attacker never tried. It attacks:

- **`onAny`**, so it catches every event the socket can deliver rather than a list of names I
  happened to think of
- asks for the opponent's editor directly (`editor.resync` with their side)
- asks greedily for **both** sides at once
- tries to **spectate its own live match**, the one-click bypass
- **forges a snapshot** claiming to be the opponent's editor, to check the gateway attributes by
  identity rather than by payload

Then it asserts a secret string the victim typed appears in *nothing* it received.

**Positive control performed.** `BREAK_VISIBILITY=1` removes the enforcement, and the probe fails
with `THE OPPONENT'S SOURCE LEAKED via editor.delta, editor.snapshot` — 22 events across 8 names
instead of 15 across 7. Restored, it passes. A browser test covers the same ground through the real
UI: a spectator sees the typed marker, the opponent's window never contains it, and a competitor
asking to spectate their own match gets `SELF_SPECTATE`.

Enforcement lives in `canSee` / `canSpectate` in `apps/gateway/src/relay.ts`, and **both fanout
paths route through it**. There is no second path and there must never be one.

### The pulse line needed retuning, and here are the numbers

**You were right to ask. The smoothing transfers; the scale did not.**

Rising 0.6 / falling 0.18 was chosen to preserve burst onsets, and against real typing that is not
merely preserved — it is the mechanism. Real keystrokes at 125ms are a sparse impulse train, mostly
zeros and ones, so the fast attack is what turns the first keystroke of a burst into a visible onset
and the slow release is what makes a pause read as a decline. Measured: **onset to 0.3 in ~250ms,
release from 1.0 to 0.05 in ~2000ms** — an 8:1 asymmetry, intact.

**What was wrong was `PULSE_FULL_SCALE`, which I first set to 2.5 by reasoning about headroom
alone.** Simulating an eight-minute match at 8fps against Poisson keystrokes:

| full scale | 5 c/s typist | 9 c/s bursts | slow 3 c/s |
| --- | --- | --- | --- |
| 2.5 | mean 0.28 | mean 0.44 | 46% below 0.05 |
| **1.5** | **mean 0.36, p50 0.40** | **mean 0.55, p95 0.95** | 54% below 0.05 |
| 1.0 | mean 0.45 | p95 0.999 — pinned | 54% below 0.05 |

At 2.5 the trace hugs the floor for a normal typist, which inverts §6.4: a flatline is supposed to
mean *stuck*, not *typing normally*. At 1.0 a merely ordinary typist already pins the graph so a
burst has nowhere to go. **1.5 is where ordinary typing sits mid-range, a real burst reaches p95 ≈
0.95 with headroom, and pauses still hit the floor.**

**One honest consequence: real typing is 2–3× jaggier tick to tick than the simulator was** — mean
absolute step ~0.076 against ~0.026. The simulator was smooth because it held a persistent target
for dozens of ticks and a human does not. **I did not filter that out**, because the texture is the
actual signal and smoothing it would be tuning the instrument to match the model instead of the
world. It is the thing to judge by eye; the constants are in `packages/core/src/pulse.ts` with the
table above.

### What 2C-1 ships

- **Monaco deltas over the gateway**, batched at 50ms, per-side monotonic `seq`, absolute character
  offsets so applying is a pure string splice on the far side.
- **The gateway holds authoritative text per side**, which is what makes snapshots, late joiners and
  gap recovery free rather than a replay of the stream.
- **Gap recovery never guesses.** A delta that is not `lastSeq + 1` is refused, and the gateway asks
  that client for a snapshot (`editor.desync`). Applying to the wrong base yields plausible code
  nobody wrote, which is worse than a visible hole because nothing downstream can tell.
- **Snapshots every 30s**, plus a final one per side before the log closes, so a replay always ends
  holding both complete documents.
- **Deltas in the JSONL log** under the existing `seq` / `offsetMs` / `wallMs` contract, carrying the
  paste-detection shape. Verified on disk — a real batch reads
  `ins=183 removed=0 origin=paste` against `ins=26 origin=type`, so a paste is unmistakable to
  anything reading the log. No enforcement built, as specified.
- **The pulse line on real keystrokes**, reported at 125ms (~8fps) rather than the old 500ms, which
  smeared a burst's leading edge across four samples.
- **`/dev/spectate`** — both editors side by side, gap-counting, with the match id now exposed on the
  match screen so you can paste it in.

### Verified this session

`probe:visibility` with a failing positive control · **e2e 14/14 in a real browser**, including
typing reaching a spectator and never the opponent · core 56/56 (5 new pulse property tests) ·
`probe:match` · `probe:requeue` · matchmaking 10/10 · sign-in 14/14 · smoke 5/5 · typecheck 7/7 ·
production build clean.

**Not verified: how the real pulse line looks.** That is the one thing this phase changed that only
an eye can settle — see the jaggedness note above.

### Two bugs found by running it

- **`@1v1/core`'s index reaches `node:crypto`** via `codes.ts`, so importing the pulse helpers from
  the package root broke every page with an unbundleable-scheme error — `/register` returned 500.
  There is now a `@1v1/core/pulse` subpath export and the browser imports the leaf.
- **`/dev/spectate` tore down its own socket on Watch.** The effect depended on `joined`, so setting
  it rebuilt the socket and discarded the `spectate.join` that had just been sent. The page
  connected, joined nothing, and showed two empty editors. It uses a ref now.

### To see it

1. **Window A — `/play`.** Sign in, **PLAY**.
2. **Window B — `/dev/sparring`.** **Join queue**. Both **Accept**.
3. **Window C — `/dev/spectate`.** Copy the match id — the gateway logs
   `[gateway] match <id>: …`, or read `data-match-id` off the match screen — paste it, **Watch**.
4. Type in A. It appears in C's left editor within ~50ms, and never anywhere in B.

### Bringing the stack back up, in order

```bash
cd ~/1v1.code
docker compose up -d
set -a && . ./.env && set +a

pnpm install                             # only if deps changed
pnpm db:push && pnpm db:seed
pnpm judge:images                        # only if runner.py or a Dockerfile changed

setsid nohup node --experimental-strip-types apps/judge/src/index.ts   > /tmp/worker.log  2>&1 < /dev/null &
setsid nohup node --experimental-strip-types apps/gateway/src/index.ts > /tmp/gateway.log 2>&1 < /dev/null &
setsid nohup pnpm --filter @1v1/web dev                                > /tmp/web.log     2>&1 < /dev/null &

pnpm test:smoke                          # RUN FIRST — asset integrity, ~10s
```

**The judge worker is easy to forget and its absence looks like a product bug** — every submission
hits the 90s ceiling and resolves `INTERNAL_ERROR`, which correctly voids the match.

**There is no bot.** A single window sits in an empty queue and says so. Use `/dev/sparring`.

Suites: `pnpm test:smoke` · `pnpm test:e2e` · `pnpm probe:match` · `pnpm probe:requeue` ·
`pnpm probe:visibility` · `pnpm test:signin` · `pnpm judge:test` (Docker) · `pnpm db:verify` ·
`pnpm db:solutions` · `node --experimental-strip-types --test packages/core/src/*.test.ts` ·
`node --experimental-strip-types --test apps/gateway/src/matchmaking.test.ts`

**Shell note:** `pkill -f` has matched its own shell repeatedly here. Kill by PID from
`ps -eo pid,cmd`, and start long-lived processes with `setsid … < /dev/null & disown`.

### Next: 2C-2 — the spectator stream

§7's tiered fanout (200ms, 500ms on ranked), room broadcast rather than per-socket sends, the
late-joiner snapshot path, and the self-spectate ban across a real audience. Everything in it is a
load optimisation unobservable at one viewer, which is why it was split.


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
