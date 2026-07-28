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
--p1:         #2BD98E;   /* jade — left corner */
--p1-glow:    #2BD98E40;
--p2:         #FF337C;   /* magenta — right corner */
--p2-glow:    #FF337C40;

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
--grandmaster:#FB1E1E;   /* crimson — deliberately NOT --p2's magenta */
--legend:     linear-gradient(100deg,#FFD76E,#FF8A3D,#FB1E1E);

/* Tier aura — a different device from state glow. See "Tier aura" below. */
--tier-aura-faint: 0 0 6px  color-mix(in oklab, var(--tier) 22%, transparent);
--tier-aura-full:  0 0 10px color-mix(in oklab, var(--tier) 38%, transparent);
```

**Grandmaster is crimson, not magenta, and that is load-bearing.** It used to be the same hex as `--p2`. When `--p2` moved it was left behind, which put a Grandmaster badge ~2% away from a P2 element — the one outcome worse than either matching or clearly differing, because it reads as a rendering bug. It is now pulled to crimson, which also echoes Codeforces' red top tier, and the ladder's `--legend` gradient ends on the same value so the top reads continuous.

We now have three warm colors — `--p2` magenta, `--fail` orange, `--grandmaster` crimson — and they must not converge. Verified in OKLab ΔE, which is the right metric here; WCAG contrast ratio only measures luminance and would score two obviously different hues as identical:

- vs `--p2`: **0.099** normal, 0.126 deuteranopia, 0.160 protanopia.
- vs `--fail`: **0.101** normal, 0.187 deuteranopia, 0.246 protanopia.
- Clears 4.62:1 as handle text on `--surface` and 4.97:1 on `--ink`, which small text requires.

Note that crimson sits *between* magenta and orange in hue, so inserting it necessarily reduces the minimum pairwise distance — it cannot beat the existing `--p2`/`--fail` pair (0.137 / 0.175 / 0.223) and asking it to would be geometrically impossible. What makes this safe is **co-occurrence, not distance**.

**The separation rule: tier color and match-state color never share a screen.**

`--grandmaster` (0.101 from `--fail` in normal vision) is the closest pair in the palette, so they must never be co-present. Spectate (§7) is the screen that nearly broke this — it shows the full match HUD *and* a live emote stream carrying viewer handles, which would have put `--fail` on the test bars and `--grandmaster` on a handle at the same time. The resolution:

- **Anywhere a live match HUD is on screen, handles render `--text-dim` with no tier color and no aura.** That covers the match screen, spectate, and replay playback. Identity there comes from the `P1`/`P2` chip and, where it matters, a small `RankBadge` — never from handle color.
- Tier color keeps every surface where no match state exists: hub, leaderboards, profiles, match history, friend strips, season art. That is where most social browsing happens, so the "a glowing handle just walked in" moment survives essentially intact.

Shifting `--fail` was the obvious alternative and it was tested and rejected. The warm quadrant already holds four colors — magenta, crimson, orange, amber — and a search for the `--fail` that maximises its minimum separation returns `#CD871C`, a dark goldenrod. Every candidate that meaningfully improves separation flees into the only free space, which is the gap between crimson and `--clock`'s amber, and arrives somewhere that no longer reads as an alarm and now competes semantically with the clock. `--fail` has exactly one job (§4) and the color has to do that job first. **Do not retune `--fail` to fix an adjacency problem — fix the adjacency.**

**Colorblind rule:** player identity must never depend on hue alone. P1 is always left, always labelled `P1`, always uses a **solid** bar fill. P2 is always right, labelled `P2`, always uses a bar fill with a subtle 45° hatch texture. Verify at deuteranopia and protanopia.

**Player color constraint — P1 and P2 are a matched pair. Never retune one alone.** These two values are holding four numbers at once, and moving either one moves all four:

- P1/P2 separation under deuteranopia is **2.02**. This is a hard floor of **1.70** — below that the two corners are genuinely indistinguishable to a deuteranope and the whole identity system falls back on position and label alone.
- P1/P2 separation under protanopia is 4.60, and 1.90 in normal vision.
- `--fail` against P2 under deuteranopia is **1.60**. Earlier values put this at 1.24, which meant a failing cell and a filled P2 cell were near-identical to a deuteranope — a real bug, since §6.4 uses those two states side by side in the same bar.
- Both sit at mid-lightness on purpose, so that P-colored text clears 4.5:1 on `--surface` *and* `--ink` text clears 4.5:1 on a solid P-colored button. Those two requirements pull in opposite directions and mid-lightness is where they both pass.

The values above are the original Phase 0 hues at −5% lightness. That drop raises chroma (0.624 → 0.682 for P1, 0.698 → 0.800 for P2) as well as separation — it makes them *more* electric, not less. Dropping only P1 lands deuteranopia at 1.56 and breaks the floor. Verify with a dichromat simulation, not by eye.

**Palette provenance — read this before muting anything.** A fully muted direction was explored and rejected. It pulled P1 and P2 down to Risograph spot-ink chroma — Hunter Green `#407060` against Wine `#914E72` — on a warm charcoal ground with bone text and a low-opacity film-grain overlay, alongside two further candidates grounded in *Hyper Light Drifter* and in sun-faded arcade-cabinet sideart. All three were built out against the full kitchen sink and compared side by side. The work survives on branch `palette-pass` and was deliberately not merged.

It was rejected because the reference was fighting the brief. Risograph is a quiet print medium and restraint is the entire point of it; §2 is a fighting game, and arcade cabinets are saturated. The warmed base, the bone text, and the grain overlay were all judged alongside it and turned down with it.

**The chroma above is a deliberate choice, not an oversight. Do not mute it.**

**No difficulty colors.** Problem difficulty is a number on the player rating scale (§8), never an Easy/Medium/Hard color code. Difficulty green collides with P1, difficulty red collides with `--fail`, and a rating is more precise than three buckets anyway. Do not add a difficulty palette later.

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
- Borders are `1px solid var(--line)`. An element that belongs to a player takes a `1px` player-colored border, and that plus the mirrored corner cut is the *entire* ownership signal.
- **Glow is for events, never for rest.** `0 0 24px var(--pX-glow)` fires on hover, on a state *change*, and on the victory flare. It never sits on an element for the duration of a match. A nameplate that glows for eight straight minutes is ambient animation wearing a disguise, it violates §5's "spend the motion budget on five moments", and it is the single loudest tell that an interface was generated rather than designed. This was a real defect in Phase 0 — `Card owned` and `Nameplate active` both glowed continuously — and it has been fixed.
- Audit glow by grepping the **built** CSS for shadow declarations, never the source. Every surviving rule must be a `:hover`, a one-shot event class, or the sub-ten-second clock. Reading the source misses what the utility classes actually compile to.

### League color on handles (Phase 3)

Outside a match, a player's handle renders in their **tier color everywhere it appears** — hub, leaderboards, profiles, match history, friend strips, season art. Rank stops being a badge you click and becomes ambient identity you read at a glance. Legend takes the `--legend` gradient on the text itself.

Spectate and replay are the exceptions, because a match HUD is on screen there — see *the separation rule* above.

#### Tier aura

**Tier aura is not state glow.** They are two different devices that happen to both be expressible as a shadow, and the moment you let them share a token they start drifting into each other. They are separated on purpose, in code and by eye:

| | State glow (`--pX-glow`) | Tier aura (`--tier-aura-*`) |
| --- | --- | --- |
| property | `box-shadow` on a container | `text-shadow` on a handle |
| when | on change, on hover, one-shot | at rest, permanently |
| radius | 24px | 6–10px |
| alpha | 25% | 22–38% of a *color-mix*, far weaker in practice |
| spread | available | **impossible** — `text-shadow` has no spread parameter |

That last row is the enforcement. The aura physically cannot grow a spread, so it can never quietly become a state glow, and a reviewer can tell which device they are looking at from the property name alone.

This means §5's rule needs no exception carved into it: **state glow is still never at rest.** Tier aura sits at rest under its own rule, below.

**Aura scales with tier, and most tiers get none.**

- **Iron, Bronze, Silver, Gold** — flat tier color. No aura, ever.
- **Platinum, Diamond** — `--tier-aura-faint`.
- **Master, Grandmaster, Legend** — `--tier-aura-full`. These values are a starting point, tuned by eye.

A leaderboard where every handle glows is visual noise. The restraint is precisely what makes the top of the ladder feel earned: a handle with an aura appearing in spectator chat should read as an **event** — someone important just walked in. If everything glows, nothing does.

Never animate the aura, never pulse it, and never extend it downward to more tiers.

**Inside a match, side color always wins.** A Grandmaster on the P1 side renders jade — never crimson. This is not a special case to code around: the handle component sits inside the `[data-side]` scope and inherits `--player` like everything else. If you ever find yourself branching on tier inside the match HUD, the component is in the wrong place in the tree. Tier aura is suppressed entirely on any screen showing a live HUD — and the `--grandmaster` separation analysis above depends on that staying true.

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
- **Looping motion is allowed only when it encodes live state, never as decoration.** A loop must be readable as a fact about the world: the queue radar sweeps because you are *actively searching*, and the clutch edge breathes because the opponent is *above 80%*. Both stop the instant the fact stops being true. Anything that loops without a live state behind it is decoration and does not ship — scattered ambient animation is exactly what makes an interface feel generated. This is a rule about meaning, not a quota: there is no fixed number of permitted loops, and a loop that passes this test needs no exception carved out for it.
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

- A slow **radar sweep** rotating behind the player's rank badge. It loops because it encodes live state — you are searching right now — and it stops the moment you are not. See §5.
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

### 6.8 Hack phase — mode variant (Phase 4)

A mode variant, not the default ranked flow. Chronologically it sits **between §6.6 and §6.7**: both players submit, and then a 60-second window opens in which each can write a counter-test input designed to break the other's solution. A landed hack scores and can flip the result of the match.

**A failed hack adds 30 seconds to the attacker's final elapsed time.** Be precise about what that penalty acts on: it is not deducted from a running clock, because the hack phase happens *after* both players have stopped solving and there is no clock left to take from. Final elapsed time is the tiebreak when both players pass, so the penalty is charged there — it can lose you a match you had already won on speed, without ever being able to un-solve a problem you solved. 30 seconds is deliberately less than the 60-second phase itself: a penalty larger than the window it lives in makes attempting a hack strictly irrational, which would kill the mechanic rather than price it.

**Why this earns its place.** It means passing the tests is not safe. Edge cases acquire real weight, defensive thinking becomes worth as much as raw speed, and every match gets a second act instead of ending the instant somebody is faster. As a spectator moment it is better than the solve itself: watching someone read an opponent's code hunting for the unhandled empty input is far more legible drama than watching two people type. **If scope ever has to be cut, cut elsewhere first.**

The beat, at the level of §6.6:

1. **The reveal.** The opponent's source becomes visible and read-only, and that reveal is its own moment — build it as one, don't just swap a panel. Both editors slide outward to the screen edges, the opponent's source rises into the center from below with `spring.heavy`, and the syntax highlighting resolves over `dur.slow` rather than arriving all at once. It should feel like evidence being handed to you. Note that §5 still holds: the *panel* moves, the code inside it does not.
2. **The clock.** 60 seconds on the existing `Clock` component, which takes its sub-ten-second treatment unchanged — `--clock` color, one 90ms pop per tick. Do not build a second timer.
3. **Composing.** A single input field in `--ff-code` beneath the source, with a live size/format counter against the problem's stated input constraints. A hack must never be rejected on a technicality the player could not see coming.
4. **Resolution.** The submitted input runs against the opponent's code. The verdict resolves the way §6.6 does — sequentially, never batched.
5. **Hack lands.** The victim's test bar **shatters**: take the near-miss shatter from §6.5 and escalate it hard. Every filled cell fractures and falls rather than just the leading edge, the bar's frame cracks along its corner cut, screen shake at `shake.hard`, and the attacker's half of the HUD floods with their player color from the outer edge inward. This is the most violent thing in the product and it should look like it.
6. **Hack fails.** The attacker's own bar takes a 200ms `--fail` flash, the penalty is deducted with the number floating up and fading, and the panel clears in `dur.base`. Same principle as §6.6: failure stings for about a second and then gets out of the way.

**Sound.** `hack_land` is the most violent sound in the library — a hard percussive break with a low tail, unmistakably distinct from `test_fail` and louder than anything except `victory`. `hack_fail` is a dull miss. `hack_reveal` is a low riser sitting under the source-code reveal in step 1.

**The validator is not optional — it is what makes the mechanic exist.** Every problem ships a **validator** alongside its test cases: a function that takes a candidate input and returns pass/fail against the problem's stated constraints. A submitted counter-test runs through the validator *before* it is ever run against the opponent's code, and a rejected input costs nothing.

Without this, a "hack" is just a malformed input. Feed a solution `n = -1` when the statement says `1 ≤ n ≤ 10⁵` and of course it breaks — so does every correct solution, including the hacker's own. The mechanic collapses into who can think of the most out-of-spec garbage, which is neither interesting nor a test of anything. With a validator, a successful hack means precisely one thing: *your opponent's code is wrong on an input the problem explicitly permits.* That is the entire mechanic, and it does not survive without it.

**Add the validator to the problem schema in Phase 2**, when problems are first modelled — not in Phase 4. Retrofitting a required field across a seeded problem set is exactly the kind of avoidable migration that makes a later phase slip, and a problem without a validator can never be used in a hack mode.

**Rules.** One hack attempt per player per phase. Validator rejection is free and does not consume the attempt. Hacking is disabled in Blitz — 60 seconds of reading is longer than the match itself.

---

## 7. Other screens

**Hub.** One screen that answers "what do I do right now" in under a second. Giant PLAY button with an attached mode selector (remembers last mode). Rank badge with progress arc to next tier beside it. Three daily quests. Friends-online strip with one-click challenge. A live carousel of matches currently in progress with viewer counts — the site should look inhabited even when it isn't. Left rail, max 6 items, persistent.

**Draft / pick-ban** (Phase 3, and it's the second signature screen). Both players see five problem categories. They alternately ban two each on a 15-second per-pick timer. Banned cards crack and desaturate with a hard sound. The final category card flips over to reveal the problem. This is pure MOBA DNA applied to something nobody has applied it to, it is cheap to build, and it will be the thing people screenshot.

**Spectate.** Both editors side by side, read-only Monaco, the full HUD, a viewer count, a live emote stream floating up the right edge, and a scrubber if joining late. Ranked and tournament matches are delayed 45 seconds to prevent stream-sniping — show the delay badge openly.

**Replay.** Keystroke-level scrubber, variable speed (0.5×–8×), both players synced. Timeline markers for compiles, submissions, and idle pauses over 20s. A **divergence marker** auto-detecting where the match was decided. A time breakdown: reading / thinking / typing / debugging.

**Profile.** Rank badge, per-topic rating radar chart (DP, graphs, greedy, strings, math), match history with mini pulse-line thumbnails, titles, rivalries, season recap card built for sharing.

---

## 8. Progression and identity

Rating is Glicko-2 and stays hidden behind a tier ladder: **Iron → Bronze → Silver → Gold → Platinum → Diamond → Master → Grandmaster → Legend**, divisions IV→I, promotion series at tier boundaries, 5 placement matches, soft reset each season.

Keep the grind separate from rank so losing players still progress: XP and account level earned for *playing*, a season track with free and premium lanes, coins, daily quests with streak freezes, achievements with real specificity ("win with under 10 seconds left", "win from 0/10 at the halfway mark", "beat someone 300 rating above you"), and auto-tracked rivalries.

Cosmetics must fit the medium: editor themes, syntax palettes, keystroke sound packs, victory animations, nameplate frames, cursor trails, titles. **Never anything that affects gameplay.**

### Problem ratings (Phase 2)

Every problem carries a rating **on the same numeric scale as players**. A 1600 problem is one that a 1600-rated player solves roughly half the time. One number, both sides of the system, no translation layer between them — a player who knows they are 1540 knows exactly what a 1700 problem means before they open it. This is the cheapest legibility win available to us, and it is why we don't need difficulty buckets (§4).

**It also hands us matchmaking — but do not select at the average.** Selecting a problem at the mean of the two ratings means *each* player solves it about half the time, which means roughly a quarter of matches end with neither player solving anything. A dead match is the worst outcome in the product: no cinematics fire, nobody earns anything, and both players leave. Target **mean − 120** for ranked duels, so both players can realistically land it and the match is decided by speed and nerve rather than by whether anyone finishes at all.

The offset is a **per-mode constant**, not a global:

- **Ranked duel** — mean − 120.
- **Blitz** — substantially lower again; the match is short and there is no time to think your way out of a hard problem.
- **Bo3** — escalating across games. Open below the ranked offset and climb toward it by game three, so a series builds instead of flattening.

**The spread is adaptive.** Sample the difficulty rather than fixing it, and widen the sampling window as queue time grows — exactly the way §6.1 already widens the rating band, and say so in the queue copy the same way. A player waiting ninety seconds should get a match, and a slightly off-target problem is enormously better than no opponent.

**Ratings converge on real data.** Seed them with estimates and let matches correct them: after each match, update the problem from the outcome exactly the way a player is updated, treating the problem as the opponent. A problem nobody at its stated rating can finish is mis-rated, and the data will say so within a few dozen matches. Never hand-tune a rating that solve data disagrees with.

Surface the number on the problem card, in match history, on the replay timeline, and in the post-match summary. Never as a letter grade, never as a bucket, never color-coded — see §4.

### Handles

Handles carry league color everywhere outside a match — the full rule, including tier aura and why most tiers don't get one, is in §4 under *League color on handles*. Inside a match, side color wins; nothing in §6 ever renders a handle in tier color.

---

## 9. Sound

Ship a small library, on by default, one master toggle plus a volume slider. It is half the feeling of aliveness and almost everyone skips it.

`queue_pop` (low impact) · `countdown_tick` ×3 + higher final · `test_pass` (short tick, pitch rises with each consecutive pass) · `test_fail` (dull thud) · `submit` (whoosh) · `victory` (rising sting) · `defeat` (falling) · `rank_up` (chord) · `clutch_ambient` (sub-bass loop, fades in above 80%) · `emote` (soft pop).

Ships with the hack phase (§6.8, Phase 4): `hack_reveal` (low riser) · `hack_land` (hard percussive break with a low tail — the most violent sound in the library, louder than everything except `victory`) · `hack_fail` (dull miss).

Use the Web Audio API with a preloaded buffer pool. Never `<audio>` tags — the latency will ruin the timing.

---

## 10. Realtime protocol

Define every event once in `packages/proto` with zod schemas. Client and server both import from there; no duplicated shapes.

```
client → server:  queue.join, queue.leave, match.accept, editor.delta,
                  code.run, code.submit, emote.send, draft.ban,
                  hack.submit                                    (Phase 4)

server → client:  queue.status, match.found, match.start, opponent.status,
                  opponent.pulse, test.result, match.end, spectator.join,
                  hack.open, hack.result                         (Phase 4)
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

**Phase 2 — Real 1v1.** Auth, Postgres schema, 20 seeded problems **each with a validator (§6.8)**, Socket.IO gateway, matchmaking on Redis, Monaco with delta streaming, Docker judge, the real match screen wired to Phase 1's animations, Glicko-2, **problem ratings on the player scale (§8) driving difficulty selection at mean − 120**, victory and rating flow.

**Phase 3 — Alive.** Spectator mode, replay from the event log, the Hub, profiles with topic radar, XP/quests/streaks, draft pick-ban, **league color on handles (§4)**.

**Phase 4 — Depth.** Bo3, Blitz, Debug Duel, **hack phase (§6.8)**, Ghost Races (race a stored replay — this makes the site feel populated at zero cost and solves the empty-queue problem), tournaments, sound library, cosmetics.

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