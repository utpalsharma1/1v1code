# 1v1.code

**A real-time competitive programming arena where two people solve the same problem simultaneously while spectators watch both editors stream live, keystroke by keystroke.** It is not a practice site with a timer bolted on — it is an esports arena that happens to be about code, with a countdown, an opponent you can feel, a clock, and a moment where you win or lose.

---

## What makes it different

Competitive programming platforms are single-player against a clock. This one is head-to-head and watchable.

- **Live keystroke streaming.** Both editors stream as they are typed. A spectator sees the code appear character by character, not a diff after the fact.
- **Side-by-side spectating.** Two editors, one HUD, a viewer count, and a scrubber if you arrive late. A shared `/watch/<code>` link needs no account.
- **You can feel the opponent without seeing their code.** The HUD carries a live sparkline of their keystroke rate — thinking pauses versus typing bursts. A flatline means they are stuck; a sudden burst after a long flatline means they just worked it out and your stomach drops. **It leaks no source at all**, and that is enforced at the gateway rather than in the UI.
- **Real-time everything else**: a segmented test bar that fills toward the centre so the two bars race at each other, a compile shockwave across the opponent's half, a breathing edge glow when they cross 80%, and a bar that visibly cracks when they submit and fail.

---

## Architecture

A pnpm + Turborepo monorepo.

```
apps/web        Next.js 15 (App Router), Tailwind v4, Framer Motion, Monaco
apps/gateway    Node + Socket.IO — matchmaking, rooms, keystroke relay, presence
apps/judge      Node worker — pulls from Redis, runs code in Docker, streams verdicts
packages/proto  zod schemas for every socket event, imported by client and server
packages/core   rating (Glicko-2), the rank ladder, match state machine, event log
packages/ui     design tokens and primitives
packages/db     Prisma schema, the problem bank, and the tooling that verifies it

Postgres · Redis · Docker
```

### How a match flows

```
queue.join ──► Redis matchmaking          band widens ±25 every 10s to a ±400 ceiling
               (one atomic Lua script)     pairing is atomic, so nobody is matched twice
     │
     ▼
match.found ──► both sides accept ──► countdown ──► LIVE
     │                                                │
     │                          editor.delta batched at 50ms, sequence-numbered
     │                          opponent gets a keystroke COUNT; spectators get source
     ▼                                                │
code.submit ──► receipt stamped at the gateway on the monotonic clock
                          │
                          ▼
                  Redis queue ──► judge worker ──► one Docker container
                          │                              │
                          │        per-test results stream back individually,
                          │        because §6.6's sequential reveal depends on it
                          ▼
                  JUDGING ──► every outstanding verdict resolves
                          ▼
                  decided by RECEIPT ORDER, never verdict order
```

**Receipt order is a fairness rule, not a timing detail.** A C++ submission takes ~5.5s against Python's ~1.8s, so once the judge queue has any depth the order verdicts come back is not the order submissions were made. If "first correct wins" read verdict time, a player would lose because someone else's job was ahead of theirs in a queue they cannot see — indistinguishable from cheating, from the losing player's side. So the gateway stamps receipt the instant a submission arrives, before it is queued, and that stamp is the sole authority.

**A lost verdict is a no-contest, not a loss.** If the judge dies or a message is lost, the match ends `VOID` with no rating change. Losing rating because our infrastructure failed is indefensible.

### Every match is an append-only event log

Each match writes JSONL to disk, and **that file is the replay** — playback is a pure function of the log, with no separate recording system. Every event carries `seq` (a gapless monotonic integer, the only thing replay orders by), `offsetMs` (for scrubbing) and `wallMs` (display only). A replay that sorts by timestamp reorders itself when the host clock drifts; this one cannot.

---

## The judge

The most serious engineering here. It executes untrusted code from strangers.

One container per submission, from prebuilt per-language images. **Nothing is bind-mounted** — the job goes in over stdin and JSONL results come back on stdout, which removes mount-based escapes from the design entirely.

```
--network none          --read-only               --cap-drop ALL
--memory 256m           --user 1000:1000          --security-opt no-new-privileges
--memory-swap 256m      --pids-limit 64           --ulimit nofile=64:64
--cpus 0.5              --tmpfs /tmp:rw,exec,nosuid,nodev,size=64m
```

A few of these are load-bearing in non-obvious ways:

- **`--memory-swap` must equal `--memory`.** Without it Docker grants swap equal to the limit, so `256m` silently means 512m.
- **`--tmpfs /tmp` is `exec` on purpose.** A compiled binary has to run from somewhere, and `noexec` breaks C++ without removing any capability the attacker lacks.
- **Never add `--ulimit nproc`.** It looks like the natural companion to `--pids-limit` and it is not: `RLIMIT_NPROC` is enforced per-UID and system-wide, *not* namespaced by the container. It was added once as belt-and-braces and silently broke the entire sandbox — while the containment suite reported ten of ten passing, because "no escape was observed" is trivially true of a container that never executed anything.

**Compilation is a separate budget from execution**, because a compiler is an arbitrary-computation engine — recursive template instantiation and `constexpr` loops are Turing-complete workloads that run before a single line of the program does. It gets its own 10s wall and CPU limit and its own verdicts (`COMPILE_ERROR`, `COMPILE_TIMEOUT`, `COMPILE_MEMORY`), because reporting resource exhaustion as a syntax error tells a player their correct code is malformed.

**`INTERNAL_ERROR` must be unreachable from user code**, and that is a security invariant rather than a robustness one: a lost verdict voids the match, so a submission that can provoke one annuls any match its author is about to lose — invisibly, while they look like a victim of our infrastructure.

**Billing is in CPU-seconds, not requests.** Five lines of preprocessor macros buy ten seconds of CPU; a request-counting limiter counts one request while the attacker spends ten CPU-seconds, so the limiter and the resource are in different units.

---

## Running it locally

**Prerequisites:** Node 20+, pnpm 9+, Docker (for Postgres, Redis and the judge sandbox), and Python 3 (the problem bank's reference solutions).

```bash
git clone https://github.com/utpalsharma1/1v1code
cd 1v1code
pnpm install

cp .env.example .env
# SESSION_SECRET has no default on purpose. Generate one:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

pnpm stack          # Postgres, Redis, judge, gateway, web — with a health check
```

`pnpm stack` refuses to start without the environment it needs, and restarts any service whose configuration has changed since it started. "Something is running" is not "the thing I configured is running".

Then open <http://localhost:3000>.

**Playing against yourself.** You cannot be two people, so `/dev/sparring` drives a second player on command — queue, accept, submit correct, submit wrong, submit timeout, drop socket. It mints its ticket through a route that 404s in production. `/dev/hud` fires every cinematic on demand, `/dev/judge` streams verdicts for pasted code, and `/dev/kitchen-sink` shows every primitive in every state.

**Sharing it with a friend.** `pnpm tunnel` builds for production, puts Caddy in front so the web app and the gateway share one origin, and exposes it through a Cloudflare quick tunnel. It refuses to print a URL until it has loaded the landing page, fetched every script that page references, and registered a throwaway account through the real form — because a URL serving a crashing page is worse than no URL.

---

## Status

Built and working:

| | |
| --- | --- |
| **Design system** | tokens, motion system, primitives, `/dev/kitchen-sink` |
| **The match** | queue pop, countdown, HUD, test resolution, clutch state, victory, rank-up |
| **Persistence** | Postgres + Prisma, email/password auth, sessions |
| **The judge** | Docker sandbox, C++17 and Python 3, streaming verdicts, containment suite |
| **Real matches** | Socket.IO gateway, atomic matchmaking, lifecycle state machine, Glicko-2 |
| **Keystroke relay** | 50ms batching, sequence numbers, snapshots, gateway-enforced visibility |
| **Spectating** | `/watch/<code>`, no account needed, late joiners land from a snapshot |
| **Challenge links** | guest play with no registration, one-click rematch |
| **The shell** | Hub, rank ladder Iron→Legend, left rail, league colour on handles |

Deferred, deliberately: Bo3, Blitz, the hack phase, team modes, tournaments, cosmetics — all of Phase 4. **Depth before breadth: eight half-finished modes are worth less than one that feels incredible.**

In progress: the problem bank (23 of a target 60+, accumulating 3–5 per session), profile and leaderboard screens, and deployment.

---

## Verification

**About 26% of this codebase is verification, and that is a feature rather than an accident.** 7,438 of 28,835 lines.

The reason is a bug that has now happened sixteen times: *a check that reported success while the thing it watched was broken.* `0 assets missing` on a page that came back empty. `prisma noise: 0` across five probes that were all failing to connect. A containment suite green because the canary never executed. A transport failure announced as a security exposure. So the checks here are built to be able to fail, and are shown to fail before they are trusted.

**The problem bank has four gates**, and `pnpm db:verify` runs all of them in separate child processes so that no gate can take another offline:

- **`db:verify`** — every expected output agrees with a reference solution, and every test input passes the problem's own validator. Expected outputs are *derived*, never typed.
- **`db:audit`** — 43 plausible wrong approaches, none of which may survive the tests. This found that `coin-change-min` used only coin systems on which the greedy algorithm is optimal, so a wrong solution passed 5 of 5 — every match on that problem could have been won by wrong code. Ten more of the same kind followed.
- **`db:coverage`** — every numeric bound in a problem's constraints is reached by a test, or exempted with a recorded reason. `dijkstra-shortest` warned that path totals exceed 32 bits; the largest total in its test set was 18.
- **`db:timing`** — re-derives every timing fact on the host it runs on, because a bank that is sound on one machine is not sound on another.

**The judge's containment suite attempts every escape** — network call, fork bomb, memory exhaustion, infinite loop, unbounded stdout, filesystem write — and asserts the *mechanism*, not the absence: that the pid ceiling was reached, that the exit code was 137, that the verdict was `OUTPUT_LIMIT`. "The fork bomb did not escape" is satisfied by a container that never forked. A **positive control** runs first, and if the canary fails the suite reports VOID and refuses to continue.

**`probe:visibility` attacks the rule rather than confirming it**, trying every route by which an opponent might obtain source during a live match. `BREAK_VISIBILITY=1` deliberately breaks the enforcement so the probe can be shown to go red.

**Two end-to-end suites.** `pnpm test:e2e` runs against the dev server; `pnpm test:e2e:prod` runs the same specs against a production build behind Caddy, with child processes given an explicitly constructed environment. That second one exists because four bugs shipped past a green suite — the last of them a production server started with no `DATABASE_URL` — and the common property was that the suite tested a configuration nobody uses.

---

## License

**AGPL-3.0.** The code is fully open to read, run, learn from and self-host. What it does not permit is taking it closed-source as a competing hosted service: because this is a network application, the AGPL's network clause means anyone who runs a modified version publicly has to publish their changes. That is the right trade for a product intended to launch — maximally open for anyone assessing, learning from, or contributing to it, while the one thing it protects against is the one thing worth protecting against.

---

Built by [@utpalsharma1](https://github.com/utpalsharma1). The full design brief lives in [`CLAUDE.md`](CLAUDE.md) and the build log, including every decision reversed and why, is in [`PROGRESS.md`](PROGRESS.md).
