# 1v1.code — Build Brief for Claude Code

---

## 1. What we're building

**1v1.code** — a real-time competitive programming arena where two people solve the same problem simultaneously while spectators watch both editors stream live, keystroke by keystroke.

This is not a practice site with a timer bolted on. It is an **esports arena that happens to be about code**. Competitive programming platforms today are grey, static, and emotionally flat. This product's entire reason to exist is that a match should feel like a match: a countdown, an opponent you can feel, a crowd, a clock, and a moment where you win or lose.

**Everything below about visuals and motion is a functional requirement, not polish. Do not defer it. Do not build "logic first, styling later."** Each phase ships fully designed and fully animated or it is not done.

---

## 2. Design thesis (non-negotiable)

**"A fighting-game HUD rendered in the language of a code editor."**

The subject's own material is terminals, monospace type, syntax colors, compile logs, and passing tests. The format's material is fighting games and MOBAs: corner colors, health bars, round pips, draft screens, KO moments. Fuse them. Do not reach for generic "gaming neon" or generic "dark SaaS dashboard" — both are defaults, and both are wrong here.

Three rules that hold everywhere:

1. **Player identity is the color system.** There is no arbitrary brand accent sprinkled around. Green is P1. Magenta is P2. Every bar, glow, cursor, avatar ring, and particle inherits from whose side it belongs to. The UI is *about* the confrontation.
2. **Saturation is a reward.** The resting UI is muted and dark. Full-saturation color appears only when something happens — a test passes, a submit lands, a rank increases. This is why it reads as vibrant without being tiring.
3. **Spend the motion budget on five moments.** Queue pop, match start, test-case resolution, clutch state, victory. Those get real cinematics. Everything else is fast (150–200ms) and gets out of the way. Scattered ambient animation everywhere is what makes an interface feel cheap and AI-generated.

---

## 3. Stack

```
Monorepo (pnpm workspaces + Turborepo)

apps/web        Next.js 15 (App Router), TypeScript, Tailwind v4, Framer Motion, Zustand, TanStack Query
apps/gateway    Node + Socket.IO — matchmaking, rooms, keystroke relay, presence
apps/judge      Node worker — pulls from Redis queue, runs code in Docker, streams verdicts
packages/proto  Shared TypeScript types + zod schemas for every socket event (single source of truth)
packages/ui     Design tokens + primitive components
packages/db     Prisma schema + client

Postgres (users, matches, problems, ratings, replays index)
Redis (matchmaking queue, presence, pub/sub between gateway instances, rate limits)
Docker (sandboxed execution)
```

Editor: **Monaco**. Each editor is single-writer, so no CRDT is needed for 1v1 — stream Monaco `contentChanged` deltas with sequence numbers. Only Relay mode (later phase) needs Yjs.

Animation: **Framer Motion** for everything UI. Canvas 2D for particle bursts on victory/rank-up only. Do not add GSAP, Lottie, or Three.js — they are not needed and they will bloat the bundle.

---

## 4. Design tokens

Define these in `packages/ui/tokens.css` as CSS custom properties and expose through Tailwind v4's `@theme`. **Never hardcode a hex value in a component.**

### Color

```css
/* Base — deep ink with a blue cast, never pure black (pure black kills depth) */
--ink:        #080B12;   /* app background */
--surface:    #0F1520;   /* cards, panels */
--elevated:   #18202E;   /* modals, popovers, hovered rows */
--line:       #232E42;   /* borders, dividers */
--line-hot:   #35435E;   /* focused borders */

/* Text */
--text:       #E8EFF8;
--text-dim:   #93A3BC;
--text-faint: #5C6C85;

/* Player identity — the core of the system */
--p1:         #3DDC97;   /* jade — left corner */
--p1-glow:    #3DDC9740;
--p2:         #FF4D8D;   /* magenta — right corner */
--p2-glow:    #FF4D8D40;

/* State — each has exactly one job */
--clock:      #FFC53D;   /* time pressure ONLY */
--fail:       #FF6B35;   /* failed tests, compile errors ONLY */
--info:       #4CC9F0;   /* neutral system messages */

/* Rank tiers — used for badges, profile glow, season art */
--iron:       #6B7280;
--bronze:     #B06B3A;
--silver:     #9FB3C8;
--gold:       #F0B429;
--platinum:   #2DD4BF;
--diamond:    #60A5FA;
--master:     #A855F7;
--grandmaster:#FF4D8D;
--legend:     linear-gradient(100deg,#FFD76E,#FF8A3D,#FF4D8D);
```

**Colorblind rule:** player identity must never depend on hue alone. P1 is always left, always labelled `P1`, always uses a **solid** bar fill. P2 is always right, labelled `P2`, always uses a bar fill with a subtle 45° hatch texture. Verify at deuteranopia and protanopia.

### Type

- **Display / headings / HUD:** `Martian Mono` — uppercase, weight 700–800, `letter-spacing: -0.02em`, used with restraint. A competitive coding arena whose headlines are monospace is the point; do not substitute a generic geometric sans.
- **Body / UI:** `Geist Sans` (fallback `Inter`) — 400/500/600.
- **Code + all numerals:** `JetBrains Mono` with `font-variant-numeric: tabular-nums`. Every timer, score, rating, and stat uses tabular figures so digits never jitter as they change.

Scale: `12 / 13 / 14 / 16 / 20 / 26 / 34 / 48 / 72`. Match clock is `72`. Nothing else is.

### Geometry — the signature shape language

Fighting-game HUDs slant. Adopt one consistent device and use it everywhere so the product has a recognizable silhouette:

- **Clipped corner:** primary containers use `clip-path: polygon(...)` to cut the top-left and bottom-right corners at 12px. Bars, nameplates, buttons, badges.
- P1 elements cut on one diagonal, P2 elements mirror it. The two sides visually lean into each other.
- Radius elsewhere: `4px` small, `8px` cards. Never pill-shaped, never fully rounded — softness is off-brief.
- Borders are `1px solid var(--line)`; active/owned elements get a `1px` player-colored border plus an outer `0 0 24px var(--pX-glow)`.

---

## 5. Motion system

Put these in one file, `packages/ui/motion.ts`, and import them. No component invents its own timing.

```ts
export const dur = { instant: 90, fast: 160, base: 240, slow: 420, cine: 900 };

export const ease = {
  out:   [0.22, 1, 0.36, 1],      // default for entrances
  inOut: [0.65, 0, 0.35, 1],      // for moves/transforms
  snap:  [0.34, 1.56, 0.64, 1],   // slight overshoot — buttons, badges, pops
};

export const spring = {
  ui:    { type: 'spring', stiffness: 420, damping: 32, mass: 0.7 },
  bar:   { type: 'spring', stiffness: 180, damping: 22 },  // health/test bars
  heavy: { type: 'spring', stiffness: 120, damping: 18 },  // big cinematic panels
};
```

**Hard rules:**
- Animate `transform` and `opacity` only. Never animate `width`, `height`, `top`, `left`, or `box-shadow` on anything that runs during a match. Bars scale on the X axis with `transform-origin` set to the owning player's side.
- Stagger list children by **40ms**, capped at 8 items (after that, fade the group).
- Every interactive element has three visible states: rest, hover (`scale 1.02`, border → player/accent color, 160ms), press (`scale 0.97`, 90ms).
- **Never animate the code editor's own content.** The editor is a workspace, it stays calm. All drama happens in the HUD around it.
- Respect `prefers-reduced-motion`: replace all movement with 120ms opacity fades, disable particles, disable screen shake, keep every state change legible through color and text alone. Also ship a manual **Reduce Motion** toggle in settings — some users will be on weak laptops.
- Performance floor: 60fps during a match on a mid-range laptop. Keystroke streaming, the pulse graph, and the HUD must never trigger layout. Use `will-change` sparingly and only on elements currently animating.

---

## 6. The match experience — beat by beat

This section is the product. Build it with more care than anything else in this document.

### 6.1 Queue

The Hub's **PLAY** button is the largest element on screen. On click it does not navigate — it transforms in place into a queue card, which expands downward with a spring. Inside:

- A slow **radar sweep** rotating behind the player's rank badge (this is the one piece of ambient motion allowed to loop, because waiting needs a heartbeat).
- Elapsed time in tabular JetBrains Mono, counting up.
- Live text: `Scanning 1420–1480 · 47 players in queue`. Widen the search band visibly every 10s and say so: `Widening search…`.
- Cancel is always one click, always visible.

### 6.2 Queue pop — the first cinematic

This is the dopamine moment. Budget: **1.4s**.

1. Screen dims to 85% ink, `120ms`.
2. A hard horizontal light-sweep rips across the viewport left-to-right, `220ms`, and on its trailing edge the two nameplates snap in — P1 from the left, P2 from the right, `spring.heavy`, arriving with a 60ms offset so it reads as a collision, not a symmetric fade.
3. Both plates flash white for 60ms on arrival. Screen shake: 3px, 180ms, `ease.snap`. Sound: a low impact hit.
4. Ratings, rank badges, and head-to-head record (`4–6 vs @rohan`) fade up beneath the plates, staggered 40ms.
5. A center `VS` in Martian Mono 800 scales from 1.6 → 1.0 with overshoot, with the two player glows bleeding in from either side behind it.

If the opponent hasn't accepted yet, show two accept-state pips that fill independently. The tension of watching the other pip fill is free drama — don't skip it.

### 6.3 Countdown & problem reveal

- `3 · 2 · 1` in 72px display type, each digit scaling 1.4 → 1.0 with a ring pulse expanding outward and fading. Distinct tick sound per beat; the final beat is pitched higher.
- On `GO`, the two editors **slide in from opposite edges** while the problem statement panel unfolds from the center. `dur.slow`, `spring.heavy`.
- The problem title types itself in — a genuine typewriter effect at ~28 chars/sec. On this product, a typing animation is thematically earned rather than decorative. Use it here and nowhere else.
- The clock does not start until the reveal animation completes. Say so.

### 6.4 Match HUD — the signature element

Fixed to the top of the match screen, always visible, never scrolls away.

```
┌──────────────────────────────────────────────────────────────────────┐
│  ◤ P1  arjun_dev        │      07:42      │        rohan_x   P2 ◥    │
│  ▰▰▰▰▰▰▰▱▱▱  7/10       │   ROUND 1 · Bo3 │       4/10  ▰▰▰▰▱▱▱▱▱▱   │
│  ∿∿∿⎯⎯∿∿∿∿⎯⎯⎯∿∿          │   ● ○ ○         │          ⎯⎯∿∿∿∿∿⎯⎯∿∿∿    │
└──────────────────────────────────────────────────────────────────────┘
```

Three elements per side:

**Test bar.** Segmented into one cell per test case. Cells fill toward the center — P1 fills rightward, P2 fills leftward — so the bars race at each other. Each cell that turns green does so with a 90ms scale-Y pop and a brief 40% white overlay that decays over 200ms. A failing cell flashes `--fail`, shakes 2px horizontally, then settles to a dim outline.

**Typing pulse line.** A live sparkline of the opponent's keystroke rate over the last 60 seconds, updated at ~8fps. This is the most original thing in the product: it shows *thinking pauses versus typing bursts* without ever leaking a character of code. A flatline means they're stuck. A sudden burst after a long flatline means they just figured it out and your stomach drops. Render on canvas, never DOM.

**Status ticker.** Small caps text, cross-fading between states: `typing…` / `compiling` / `running tests` / `4/10 passed` / `submitted`. Never shows content, only activity.

The center column holds the clock, round pips (best-of series), and mode label.

### 6.5 Feeling the opponent

- **Compile pulse:** when either player compiles, a shockwave ripple crosses that player's half of the HUD, 400ms, and their nameplate border flares for 200ms.
- **Clutch state:** when the opponent reaches 80%+ of test cases, the viewport edge on their side develops a slow breathing glow in their color, ~1.8s cycle. It's peripheral — you feel it before you consciously see it. At 90%+ it doubles in intensity and a low sub-bass tone fades in.
- **Near-miss:** if the opponent submits and *fails*, their bar cracks — a 200ms red flash and a downward shatter of their filled cells. Enormous relief for you, well-earned pain for them. This is the single best spectator moment in the product.
- **Emotes:** a 6-emote radial wheel bound to `Ctrl+E`, rate-limited to one per 15 seconds. `👏 🔥 😅 🤝 🧠 😱` only. No text chat during ranked play, ever.

### 6.6 Submission

On submit, take over the screen briefly — this is the highest-stakes second in the product:

1. Editor dims and blurs 4px, `160ms`. It is out of your hands now.
2. A verdict panel drops from the top with `spring.heavy`.
3. Test cases resolve **sequentially**, ~120ms apart, each with a tick and a sound. Do not resolve them all at once. The staggered reveal is the entire drama — this is a slot machine and you should treat it like one.
4. **Pass:** the panel floods green from the center outward, a particle burst fires from the panel edges, the screen shakes 5px, and the win sting plays.
5. **Fail:** the panel goes `--fail`, the failing case number is spotlit while others dim, and the panel slides away in 240ms so the player is back in the editor fast. Failure should sting for exactly one second and then get out of the way — never make a losing player wait on an animation.

### 6.7 Victory

Budget: **3s**, and it is the only place in the product with a full-screen takeover.

- Freeze both editors. The loser's side desaturates to greyscale over 600ms while the winner's side saturates up.
- The winner's nameplate scales up, crosses the center line, and the loser's plate slides off-screen.
- `VICTORY` / `DEFEAT` in 72px display, with a light-sweep pass across the letterforms.
- Particle burst in the winner's color from the center, ~200 particles on canvas, gravity-affected, fading over 1.6s.
- The rating delta counts up (or down) digit by digit in tabular figures: `1442 → 1458` with `+16` floating up and fading.
- If it triggers a rank-up, chain into the rank-up cinematic: old badge shatters, new badge assembles from fragments with a radial light burst in that tier's color. Rank-ups should feel like they cost something to earn.
- Four buttons, always: **Rematch · Queue again · Watch replay · Back to Hub**. `Rematch` is primary and focused by default.

---

## 7. Other screens

**Hub.** One screen that answers "what do I do right now" in under a second. Giant PLAY button with an attached mode selector (remembers last mode). Rank badge with progress arc to next tier beside it. Three daily quests. Friends-online strip with one-click challenge. A live carousel of matches currently in progress with viewer counts — the site should look inhabited even when it isn't. Left rail, max 6 items, persistent.

**Draft / pick-ban** (Phase 3, and it's the second signature screen). Both players see five problem categories. They alternately ban two each on a 15-second per-pick timer. Banned cards crack and desaturate with a hard sound. The final category card flips over to reveal the problem. This is pure MOBA DNA applied to something nobody has applied it to, it is cheap to build, and it will be the thing people screenshot.

**Spectate.** Both editors side by side, read-only Monaco, the full HUD, a viewer count, a live emote stream floating up the right edge, and a scrubber if joining late. Ranked and tournament matches are delayed 45 seconds to prevent stream-sniping — show the delay badge openly.

**Replay.** Keystroke-level scrubber, variable speed (0.5×–8×), both players synced. Timeline markers for compiles, submissions, and idle pauses over 20s. A **divergence marker** auto-detecting where the match was decided. A time breakdown: reading / thinking / typing / debugging.

**Profile.** Rank badge, per-topic rating radar chart (DP, graphs, greedy, strings, math), match history with mini pulse-line thumbnails, titles, rivalries, season recap card built for sharing.

---

## 8. Progression surfaces

Rating is Glicko-2 and stays hidden behind a tier ladder: **Iron → Bronze → Silver → Gold → Platinum → Diamond → Master → Grandmaster → Legend**, divisions IV→I, promotion series at tier boundaries, 5 placement matches, soft reset each season.

Keep the grind separate from rank so losing players still progress: XP and account level earned for *playing*, a season track with free and premium lanes, coins, daily quests with streak freezes, achievements with real specificity ("win with under 10 seconds left", "win from 0/10 at the halfway mark", "beat someone 300 rating above you"), and auto-tracked rivalries.

Cosmetics must fit the medium: editor themes, syntax palettes, keystroke sound packs, victory animations, nameplate frames, cursor trails, titles. **Never anything that affects gameplay.**

---

## 9. Sound

Ship a small library, on by default, one master toggle plus a volume slider. It is half the feeling of aliveness and almost everyone skips it.

`queue_pop` (low impact) · `countdown_tick` ×3 + higher final · `test_pass` (short tick, pitch rises with each consecutive pass) · `test_fail` (dull thud) · `submit` (whoosh) · `victory` (rising sting) · `defeat` (falling) · `rank_up` (chord) · `clutch_ambient` (sub-bass loop, fades in above 80%) · `emote` (soft pop).

Use the Web Audio API with a preloaded buffer pool. Never `<audio>` tags — the latency will ruin the timing.

---

## 10. Realtime protocol

Define every event once in `packages/proto` with zod schemas. Client and server both import from there; no duplicated shapes.

```
client → server:  queue.join, queue.leave, match.accept, editor.delta,
                  code.run, code.submit, emote.send, draft.ban

server → client:  queue.status, match.found, match.start, opponent.status,
                  opponent.pulse, test.result, match.end, spectator.join
```

- Editor deltas: batched at ~50ms, sequence-numbered, with periodic full snapshots every 30s for late-joining spectators.
- Every match writes an append-only JSONL event log to disk/S3 — this file *is* the replay. Replay playback must be a pure function of that log. Do not build a separate recording system.
- Server is authoritative on the clock. The client's clock is display only and re-syncs on every server tick.
- Rate-limit every inbound event per socket.

---

## 11. Judge

Docker, one container per submission, from prebuilt per-language images. `--network none`, `--memory 256m`, `--cpus 0.5`, `--pids-limit 64`, read-only rootfs, non-root user, 5s wall-clock kill. Judge workers pull from a Redis queue and stream per-test-case results back as they complete — **the sequential test reveal in §6.6 depends on results streaming individually, so do not batch them**. Languages: C++17, Python 3, Java, JavaScript.

---

## 12. Build phases

Do exactly one phase per session. Each phase ends fully designed, fully animated, and demoable.

**Phase 0 — Foundation.** Monorepo, Tailwind v4 with the full token set, `motion.ts`, typography loaded, and `packages/ui` primitives: Button, Card, Nameplate, RankBadge, TestBar, Clock, StatusTicker. Plus a `/dev/kitchen-sink` route showing every primitive in every state.

**Phase 1 — The Moment Simulator.** Before any networking, build `/dev/hud`: the complete match HUD with buttons that fire every cinematic on demand — queue pop, countdown, test pass, test fail, clutch state, submit pass, submit fail, victory, rank-up. *You are building this alone and will not have two humans to test with. This route is how you tune the feel, and it is the highest-leverage thing in the whole build.* Do not skip it, do not build it last.

**Phase 2 — Real 1v1.** Auth, Postgres schema, 20 seeded problems, Socket.IO gateway, matchmaking on Redis, Monaco with delta streaming, Docker judge, the real match screen wired to Phase 1's animations, Glicko-2, victory and rating flow.

**Phase 3 — Alive.** Spectator mode, replay from the event log, the Hub, profiles with topic radar, XP/quests/streaks, draft pick-ban.

**Phase 4 — Depth.** Bo3, Blitz, Debug Duel, Ghost Races (race a stored replay — this makes the site feel populated at zero cost and solves the empty-queue problem), tournaments, sound library, cosmetics.

---

## 13. Rules for you, Claude Code

1. **Never build logic-first with placeholder styling.** A screen ships designed or it doesn't ship.
2. **Never hardcode a color, duration, or easing.** Tokens only. If you need a new one, add it to the token file and say why.
3. **Ask before adding a dependency.** The approved list is in §3.
4. **Vertical slices, not layers.** One feature working end to end beats four half-built systems.
5. **Every socket event is typed in `packages/proto` before it is used.**
6. **Seed a bot opponent from day one** that replays a recorded solve at realistic typing speed. Solo development is impossible without it.
7. **Screenshot your work and critique it against §2 before telling me a screen is done.** If it looks like a generic dark dashboard with neon accents, it has failed the brief — say so and fix it.
8. Test at 1280px and at mobile widths. Mobile is spectate-and-browse only; the editor is desktop-only and should say so gracefully rather than degrade.
9. Keyboard focus must be visible everywhere. `prefers-reduced-motion` must be honored in every animation you write, in the same commit that writes it.
10. When a phase is done, write what changed to `PROGRESS.md` and stop. Do not roll into the next phase.

**First task:** read this file, confirm the stack in §3, list anything you think is underspecified, then execute **Phase 0 only**.