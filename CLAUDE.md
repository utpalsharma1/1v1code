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
export const dur = {
  instant: 90,
  fast:    160,
  base:    240,
  slow:    420,
  cine:    900,

  flash:   60,    // the 60ms white plate flash on arrival (§6.2)
  decay:   200,   // white-overlay decay, border flare, near-miss flash (§6.4, §6.5)

  beat:    140,   // held stillness before a big moment — tension lives in the pause
  reveal:  165,   // per-test cadence in §6.6; 120ms reads frantic against a rising pitch
  breathe: 2400,  // clutch cycle — slower reads as dread, faster as a notification
  victory: 2800,  // mandatory portion of the victory cinematic
  defeat:  1600,  // deliberately shorter — losing stings once and gets out of the way
  skip:    700,   // after this, any input skips the remainder of a cinematic
} as const;

export const ease: Record<'out' | 'in' | 'inOut' | 'snap' | 'impact', Cubic> = {
  out:    [0.22, 1, 0.36, 1],     // entrances
  in:     [0.55, 0, 1, 0.45],     // exits accelerate away instead of drifting off
  inOut:  [0.65, 0, 0.35, 1],     // moves and transforms
  snap:   [0.34, 1.56, 0.64, 1],  // slight overshoot — buttons, badges, pops
  impact: [0.16, 1, 0.30, 1],     // expo-out: arrives hard, lands rather than settles
};

export const spring = {
  ui:     { type: 'spring', stiffness: 420, damping: 32, mass: 0.7  },  // ζ 0.93
  bar:    { type: 'spring', stiffness: 200, damping: 26, mass: 1    },  // ζ 0.92
  heavy:  { type: 'spring', stiffness: 130, damping: 22, mass: 1.15 },  // ζ 0.90
  impact: { type: 'spring', stiffness: 600, damping: 30, mass: 1.1  },  // ζ 0.58
};

export const STAGGER_STEP = 40;
export const STAGGER_CAP  = 8;

export const shake = { light: 3, hard: 5, cycles: 3, decay: 0.62 };
```

**Damping ratios are load-bearing, so they are stated.** ζ = c / (2√(k·m)), and it decides whether a spring overshoots:

- `ui` — ζ 0.93, overshoot 0.03%. Effectively critically damped. Settles in ~175ms.
- `bar` — ζ 0.92, overshoot 0.07%. It drives the **continuous** fill used above `MAX_CELLS` tests; the segmented cells run on tween keyframes and never touch it. So the risk it guards against is *not* a fill spilling across a cell boundary and reading as a false pass — that cannot happen. It is subtler: a bar whose entire job is to be read as a measurement briefly displaying a value above the true one. The old 180/22 (ζ 0.82) overshot 1.11%, about 3.6px on a 320px bar. Do not lower its damping.
- `heavy` — ζ 0.90, overshoot 0.16%, settling ~418ms. Slow arrival with no visible wobble. Mass is what makes it feel heavy; an earlier attempt raised mass but left damping at 19, which produced ζ 0.78 and 2.1% overshoot — that is bounce, not weight, and it reads as cheapness on a large panel.
- `impact` — ζ 0.58, overshoot 10.4%, then a 1.1% rebound 330ms later, then nothing. One hard landing plus a hint of a second. Below about ζ 0.5 the second rebound becomes clearly visible and it stops reading as an impact and starts reading as a bounce.

**`ease.impact` and `spring.impact` are not interchangeable.** The expo-out curve arrives hard with *no* overshoot — use it where something must land, like the §6.2 nameplate collision. The spring overshoots 10% — use it where something must pop, like the `VS` badge or a rank-up badge assembling. Choosing the spring for a collision makes the plates bounce, which is the opposite of a collision.

**Shake decays.** Amplitude × `decay`ⁿ across `cycles` oscillations. Constant amplitude reads as a rumble or a rendering glitch; decaying amplitude reads as an impulse, because that is what an impulse does.

**Cinematics are skippable, and that is the real fix for repetition.** A sequence that is wonderful once is tiring on the fiftieth rematch. The answer is not a shorter cinematic — it is `dur.victory` / `dur.defeat` of mandatory playback, after which `dur.skip` arms any input to drop the rest. Defeat's mandatory portion is deliberately shorter than victory's.

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

**Widening has a ceiling, and pairing is atomic.** Both matter more than they look.

- **Band:** starts at ±30 and widens by 25 every 10s, to a **ceiling of ±400**. On reaching the ceiling it stops and the player simply keeps waiting — an unbounded band eventually pairs a 900 with a 2400, which is not a match, it is a punishment for being at the edge of the ladder. The queue copy says `Widening search…` while it widens and stops saying it at the ceiling, because claiming to widen when you are not is a lie the player can feel.
- **Rematch cooldown:** the same pair cannot be matched in ranked again for **180s**. Without it, a two-player pool ping-pongs the same fixture forever, and the §8 rating update assumes some independence between consecutive matches.
- **A pool of one is the normal case in development, not an edge case.** The bot was the intended answer and is **held as of 2B-4**, which is human vs human only. Its foundations stay built and unused — the solve model and RD gate in `packages/core/src/bot.ts`, the 20 verified solutions in `packages/db/src/solutions.ts` — so nothing has to be re-derived when it is switched on. Until then, a second player in development comes from `/dev/sparring` (§13.6), not from the product.
- **An empty queue never expires, but it stops pretending.** With no bot fallback there is no automatic ending, and the three candidates are not equal. A hard timeout is wrong: it ejects a player from a queue they may still want to be in, and nothing about an empty pool makes waiting invalid. Queueing silently forever is worse, because the radar sweep above encodes "you are searching right now", and spinning it over a provably empty pool implies a match is coming when nothing can produce one — the version players rightly hate. So the queue stays open indefinitely and the **claim** changes: `queue.status` carries `alone`, and once that has held for 20s the card drops the radar, says *Queue is empty · nobody else is queuing*, states that you are still queued and will pair the moment someone joins, and offers *Leave queue*. Nothing is cancelled and nothing is invented.
- **Pairing must be atomic inside Redis.** Read-then-write lets the same player be matched twice, or two players both pair with a third. The find-partner / remove-both / create-match sequence is one Lua script, which Redis executes single-threaded, so it is safe across multiple gateway processes even though we run one. Anything less is a race that only shows up under load.

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

### 6.7b The judging hold — waiting on the opponent's verdict

§6.9 holds the match until every outstanding verdict resolves. That hold is a **beat**, not a spinner. It is the tensest moment in the product: you know your own result and you do not know whether it was enough.

The screen, from the moment your own verdict settles while theirs is outstanding:

1. **The editor does not come back.** §6.6 dimmed and blurred it on submit; it stays that way. The match is out of your hands and the UI should not pretend otherwise.
2. **Your verdict docks.** The §6.6 verdict panel does not slide away — it shrinks and travels to your side of the HUD with `spring.heavy`, becoming a settled result chip above your test bar. Settled, legible, done.
3. **Their slot stays unresolved.** The opponent's test bar takes a slow indeterminate sweep in their player color, ~1.4s cycle. It must read as *still resolving*, never as progress — a bar that appears to fill would be a lie about information we do not have. This loop encodes live state (§5): their verdict is genuinely outstanding, and it stops the instant it lands.
4. **The center column replaces the clock** with `AWAITING VERDICT` in display type, round pips beneath. The clock is meaningless here — the match is already decided, it just is not known yet.
5. **Resolution is immediate.** When the last verdict lands, the §6.9 receipt-order comparison runs and victory or defeat fires with no intervening beat. Do not add a reveal; the wait *was* the reveal.

**The same screen carries opposite charges, and the difference is one chip.** If you passed, your chip is player-colored and the question is whether they beat you on receipt order. If you failed, your chip is `--fail` and the question inverts — you are now hoping they failed too. The layout, the sweep and the copy are identical; the emotional content lives entirely in your own result. Do not write two screens.

**Sound.** `judging_hold` is a sustained low tone, not a tick — held breath rather than a countdown. It begins when the hold begins and stops the instant the opponent's verdict lands, which makes the silence itself the cue.

**The hold must be bounded.** A verdict that never arrives — a dead judge worker, a lost Redis message — cannot hang the match forever. An outstanding submission that exceeds the judge's own ceiling (container wall clock plus slack) resolves as `INTERNAL_ERROR`, the match proceeds under §6.9, and the screen says the verdict was lost rather than sitting there. A hold with no timeout is a bug wearing a design.

### 6.8b Resubmission

**Unlimited attempts. One outstanding submission per player at a time. In ranked 1v1 there is no time penalty, because there is nothing for it to act on.**

The cost of a wrong answer is **the in-flight lock**, and that is enough:

- While your submission is being judged you cannot submit again. A wrong C++ answer therefore costs about 5.5 seconds of being unable to try anything; a wrong Python answer costs about 1.8.
- That is **self-balancing and needs no invented number**. The penalty scales with the language you chose and the judge's real behaviour, rather than with a constant somebody picked.
- It is also what bounds judge load — two concurrent jobs per match no matter how hard anyone mashes, which is a stronger guarantee than a rate limit. The global per-identity limit (§11) stays as a backstop against abuse outside a match and does not conflict: one-outstanding already caps a player at roughly one submission per judge round trip.
- **Free resubmission would still be wrong**, which is why the lock matters. If failing cost literally nothing, §6.5's near-miss shatter would be theatre — the bar cracks and they immediately try again.
- **A hard attempt cap is worse than either.** It makes the last attempt agonising in a way that encourages *not* submitting, which is the opposite of what the format wants.

**Time penalties exist only in modes where elapsed time is the score.** In ranked 1v1 receipt order decides outright (§6.9), so a time penalty would be decorative — it cannot change who wins. It applies where the clock genuinely is the result:

- **Daily problem** and **Ghost Races**, where you are racing a time rather than a person.
- **Bo3**, where cumulative elapsed time breaks a 1–1 series.
- **Hack mode** (§6.8), where both players have already solved and the phase exists to reorder them.

In those modes a failed submission adds **30 seconds** and a failed hack adds 30 seconds, on the same scale for the same reason.

**A penalty never alters receipt order.** It adjusts an elapsed-time *score*, which is a different quantity that only some modes read. If you ever find yourself wanting a penalty to change who submitted first, the design has gone wrong.

**Receipt order decides the match. Verdict order never does.** This is a fairness rule, not a timing detail, and it is easy to get wrong by accident.

The judge is a queue with finite slots (§11: four by default). A C++ submission takes ~5.5s against Python's ~1.8s, so once the queue has any depth at all, **the order verdicts come back is not the order submissions were made**. If "first correct submission wins" reads verdict time, or the elapsed-time tiebreak reads when judging finished, a player loses a match because somebody else's job happened to be ahead of theirs in a queue they cannot see. That is indistinguishable from cheating, from the losing player's point of view.

- **Stamp receipt at the gateway the instant a submission arrives, before it is queued, on the monotonic clock.** That stamp is the sole authority for win order and for the §6.8 elapsed-time tiebreak.
- **Queue wait and judge duration are diagnostics.** Log them, show them in the post-match summary if useful, and never let either become an input to the result.
- The receipt stamp is what gets written to the event log and what the `Submission` row stores as its ordering key.

**The match holds in `JUDGING` until every outstanding submission has resolved.** It does not end the moment the first `ACCEPTED` arrives. Consider both players submitting a correct solution 200ms apart while the first is still being judged: ending on first-verdict would hand the match to whoever's job finished first, which is the queue's decision, not the players'.

So: entering `JUDGING` records the set of outstanding submissions. Each verdict resolves one. The match resolves only when that set is empty, and then it is decided by **receipt order among the accepted submissions**. A player whose submission was received first and passes wins, even if their verdict arrived second.

If a player submits again while already in `JUDGING`, the earlier submission keeps its receipt stamp — a later submission cannot improve your position in the ordering, only your correctness.

**Penalties never alter receipt order.** Time penalties (§6.8b) adjust an elapsed-time *score*, which only some modes read; receipt order is a separate, immutable fact about when the gateway saw a submission. Nothing may reorder it — not a failed attempt, not a failed hack, not a mode setting. If receipt order could be bought or sold, the fairness guarantee above is worth nothing.

**A lost verdict is a no-contest, not a loss.** If any submission resolves `INTERNAL_ERROR` — the judge worker died, a Redis message was lost, a container failed for reasons that are not the player's code — the match ends `VOID`: **no rating change for either side**, recorded and displayed as a void in match history, and it does not consume a placement match. Losing rating because our infrastructure failed is indefensible, and a player cannot tell our fault from theirs.

**`VOID` means our fault and nothing else. Routine cancellation is `CANCELED`.** Both carry no rating change, and they are still separate outcome kinds on purpose. A match that neither player accepted, or that both players disconnected from, is ordinary — the first one fires constantly in development and fired on the very first real two-browser match. Recording those as `VOID` would make a genuine no-contest indistinguishable from an abandoned queue pop, which destroys the one signal `VOID` exists to carry. So `VOID` takes exactly one reason, `INTERNAL_ERROR`; `CANCELED` takes `NEVER_STARTED` and `BOTH_ABANDONED`. A test asserts that no ordinary path can reach `VOID`.

This puts a hard constraint on the judge: **`INTERNAL_ERROR` must never be reachable from user code.** If a submission can provoke it, a losing player can void any match they are about to lose. Every hostile input the containment suite covers — memory exhaustion, output flood, fork bomb, compile bomb — must produce a *real* verdict. That the print flood once produced `INTERNAL_ERROR` (§11) was therefore not only a robustness bug; it was an exploitable one.

---

## 7. Other screens

**Hub.** One screen that answers "what do I do right now" in under a second. Giant PLAY button with an attached mode selector (remembers last mode). Rank badge with progress arc to next tier beside it. Three daily quests. Friends-online strip with one-click challenge. A live carousel of matches currently in progress with viewer counts — the site should look inhabited even when it isn't. Left rail, max 6 items, persistent.

**Draft / pick-ban** (Phase 3, and it's the second signature screen). Both players see five problem categories. They alternately ban two each on a 15-second per-pick timer. Banned cards crack and desaturate with a hard sound. The final category card flips over to reveal the problem. This is pure MOBA DNA applied to something nobody has applied it to, it is cheap to build, and it will be the thing people screenshot.

**Spectate.** Both editors side by side, read-only Monaco, the full HUD, a viewer count, a live emote stream floating up the right edge, and a scrubber if joining late.

### Spectating in detail (Phase 3)

*The live panel — what makes a match worth clicking — is deliberately not specced yet. Everything below is.*

**By code.** `/watch/<code>` resolves to a live match regardless of visibility. `PUBLIC` matches are additionally listed in the live panel; `UNLISTED` matches are reachable by code only. Ranked defaults to `PUBLIC`, challenge matches to `UNLISTED`.

**No account required to watch.** A shared link reaching a stranger who watches a live match is the best growth path we have, and a registration wall in front of it converts that stranger into a bounce. Spectating is anonymous and read-only, with a register prompt that never blocks the stream.

**Be honest in the copy: unlisted is not private.** Anyone holding the code can watch, and can pass it on. The UI must say that in those words rather than implying secrecy we do not enforce. True invite-only — an allowlist, or a code that dies on first use — is a later feature, and until it exists we should not let a player believe they have it.

**Rate-limit `/watch/<code>` per IP, weighting failed lookups far more heavily than successful ones.** The code space is not a defence on its own, and the reason is that **the attack gets easier exactly as the product succeeds**. Expected time for a blind attacker at 1000 guesses/second to find one live unlisted match:

| live matches at once | time to first hit |
| --- | --- |
| 300 (today) | 119 years |
| 5,000 | 7.1 years |
| 100,000 | 130 days |
| 1,000,000 | **13 days** |

A 20-failed-lookups-per-minute budget per address turns that last row into over a century from a single IP. That is the control; the entropy only buys the headroom for it to work. Do not let this rest on a guess about our own future scale.

*(An earlier draft of this section claimed 35 years at a million live matches. That was expected guesses misread as seconds — a 1000× error, in the flattering direction.)*

**Fanout is a room broadcast, never per-socket sends.** Serialise once, write N times. Per-socket sends fail an order of magnitude earlier at every size below.

**Spectators get a coarser stream than players, and that is the main lever.** Players need 50ms deltas because they are competing; a viewer cannot perceive the difference between 50ms and 200ms of somebody else's typing. So **spectator deltas batch at 200ms**, and on ranked — where there is already a mandatory 45-second delay, so latency is meaningless — they batch at **500ms**. Reducing the load beats raising the ceiling: it is a 4× and 10× cut for a difference no viewer can see.

| stream | batch | messages/s/match | viewers before the event loop saturates |
| --- | --- | --- | --- |
| players | 50ms | ~40 | — |
| spectators, unranked | 200ms | ~10 | **~4,000** |
| spectators, ranked (45s delayed) | 500ms | ~4 | **~10,000** |

**Batching moves the bottleneck rather than removing it.** At those numbers message rate is no longer what binds — per-socket memory and file descriptors are, at roughly 30–50 KB per connection, so **5,000–10,000 sockets per process** becomes the real ceiling regardless of how little each one receives. Past that the fix is staged: the Redis adapter so gateways scale horizontally (§12, deployment), then a dedicated fanout tier if a single match ever needs more.

**Late joiners get a snapshot, not replayed deltas.** Replaying an hour of keystrokes to catch someone up is both slow and pointless. This depends on the periodic full snapshots in 2C and should not be built before them.

**Delay.** Ranked and tournament matches are delayed **45 seconds**, mandatory, to prevent stream-sniping — show the delay badge openly. Challenge and custom matches default to **no delay**, with a host toggle: friends watching friends is the entire point of those, and a 45-second delay ruins the experience it exists to enable.

**Emotes.** Spectators get the §6.5 wheel, rate-limited per viewer. Above a threshold, stop rendering individual emotes and aggregate into a burst meter — 500 separate 🔥 is noise, whereas a meter that spikes is a crowd. The aggregation *is* the feature at scale, not a degradation of it.

### Challenge links (Phase 2D)

**This is the launch feature.** Ranked matchmaking needs a population that does not exist on day one; a challenge link needs exactly two people who already know each other, so it brings its own audience. Everything about it should be optimised for the invited person, who has never heard of us.

- A player generates a link, picks **mode and difficulty band**, and sends it. The **first person to open it joins**; the match starts when both accept, through the normal §6.2 accept flow.
- **The link must survive the opponent not being online yet.** It expires after **24 hours**. A stale link does not 404 — it shows who challenged whom, that it expired, and a one-click *"send one back"* that creates a fresh challenge aimed at the original host. A dead end here is a lost player.
- **Guests may play without registering.** If registration is required before a first match, most invited people will never play, and that single decision probably costs more than every other growth feature combined. A guest gets a `User` row with `isGuest` set and no credentials.
  - A guest **can**: accept a challenge, play the match, see the result, rematch, and watch.
  - A guest **cannot**: earn or lose rating (their matches are unrated for both sides), appear on leaderboards, queue for ranked matchmaking, or create their own challenge links — that last one keeps a guest account from being a spam primitive.
  - The result screen prompts them to **register and keep the result**, which claims the same row rather than starting them over. Guest rows expire after 7 days if unclaimed.
- **Rematch is one click from the result screen, with no new link.** The pairing already exists; making two friends re-share a URL between every game is the kind of friction that ends a session early.

### Clip export (Phase 2D)

Auto-generate a short **vertical** video of the final seconds of a close match, ending on the win animation, offered on the victory screen.

This is the actual distribution mechanism. A link travels to people who already know the sender; a clip travels to people who do not, and it carries the one thing a screenshot cannot — the moment the bar fills and the screen flares. Everything else in §7 competes for existing attention; this is the only feature that manufactures it.

It should be one tap, watermarked, and require no editing. If a player has to think about it, they will not do it.

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

### The bot

The bot is the queue fallback after 20s (§6.1), so until there is a real population it is **most matches**. Every rule below exists because of that.

**It is labelled as a bot before the match, never after.** The `PlayerCard` carries `isBot` and the queue-pop nameplate shows it. Players work it out either way — from the pulse line, from the timing, from the handle — and finding out afterwards feels like being tricked in a way that losing never does.

#### Rating integrity

The trap is symmetric. If beating the bot moves rating, it is farmable and the ladder is fiction. If it never does, almost nobody's rating ever moves and the ladder is empty. Four options, and why three lose:

- **Unranked bot matches.** Honest, zero farm risk, trivial to reason about — and it means a new player can play twenty matches and still have no rating. The ladder is not fiction, it is blank, which is not better.
- **Ranked with reduced impact.** Glicko-2 has no K-factor to turn down; you would fake it by inflating the bot's RD, which also stops the bot's own rating ever converging and muddies the model to buy a fudge factor. Farming still works, just slower.
- **Ranked but capped per day.** Bounds the farm, but invents a daily chore, needs per-day counters, and a determined farmer still arrives — later.
- **Ranked only while rating deviation is high. ← this one.**

**Bot matches are rated only while the system does not yet know where you belong** — that is, during placements or while `RD > 100`. Above that confidence they are unrated and say so before the match starts.

This uses Glicko's own uncertainty measure instead of an invented threshold, which is why it behaves well:

- It serves the actual need. What an empty ladder requires is *placement*, and it is precisely the new and low-rated players who cannot find humans.
- **It self-limits.** Every bot win reduces your RD, which moves you toward bot matches not counting. The farm closes itself.
- **The farm's ceiling is the bot's own rating**, roughly 1460 — a plausible placement, not a ladder position. Nobody reaches the top of the ladder this way.
- **No cliff.** RD moves continuously, so there is no 1399-versus-1401 edge to sit on, and the player can see placements remaining.

**The bot's own rating is fixed and never updated.** It is a measuring stick, not a competitor; letting players drag it around would let a coordinated group move the reference point everyone else is measured against.

**RD growth reopens the gate, and that is intended.** Because RD grows with inactivity (§8, Glicko-2), a settled player who stops playing eventually climbs back over 100 and bot matches count again. That is not a leak, it is **re-placement**: if the system has not seen you in months it genuinely does not know whether you are still that good, and admitting that is the entire purpose of RD.

The numbers make it safe rather than merely defensible:

- **RD is capped at 350**, the Glicko-2 convention and the same ceiling a brand-new account starts at. It cannot grow without bound.
- From a settled **RD 80 it takes 34 days of complete inactivity** to cross back over 100 (30 days only reaches 98.3). From RD 60 it takes 59 days.
- One match brings it back down, so the farm rate is roughly **one rated bot match per month**, each worth very little because RD 100 is still fairly confident.

A month of waiting for one low-value update is not an exploit, it is a correct model doing its job.

#### Solutions — through the real judge

**The bot submits real source through the real judge.** Not a scripted outcome. Problems are chosen dynamically at mean − 120, so a recorded solve cannot cover them, and more importantly a scripted outcome means a bot match exercises a different code path from a human match — which is exactly the path that then breaks in production. A bot that goes through the judge keeps the judge honest and keeps itself honest.

Every seeded problem therefore ships a **known-correct Python 3 solution**, held in reviewed source next to the validators rather than in a database column, for the same reason. These double as executable reference implementations: a solution that does not pass its own problem's tests is a seed-data bug, and it is caught by running it rather than by reading it.

#### Solve time

A bot rated 1300 that always solves in four minutes is not rated 1300. Time is drawn in two stages so that the *win rate* is correct by construction and the *timing* is flavour on top:

1. **Whether it solves at all** comes from the Elo expectation against the problem: `E = 1 / (1 + 10^((problemRating − botRating) / 400))`. At a problem on its own rating the bot solves half the time; 400 below, about 91%.
2. **When it solves**, given that it does, is drawn from a lognormal whose median is a fraction of the match: `f = clamp(0.25 + 0.5 · (d + 400) / 800, 0.15, 0.9)` where `d = problemRating − botRating`. An easy problem lands around a quarter of the way in, one at its own rating around halfway, a hard one late. Jitter is lognormal σ ≈ 0.25 so two matches on the same problem never look identical.

Because §8 selects at mean − 120, `d` is usually negative: the bot usually solves, at a pace that is beatable but not free. That is the intended feel — a real opponent, not a wall and not a gift.

#### Losing behaviour

**When the bot draws "will not solve", it must still behave like a human who is losing.** This is not a nicety: §6.4's pulse line makes activity visible, so a bot that goes silent at 2:00 and never moves again is an obvious tell, and a player who works out mid-match that they are playing a bot has been told something we promised to tell them up front.

What a human losing actually looks like, in rough order of frequency:

1. **They keep working and never finish.** This is the common case and it is the bot's default: the typing model (§13.6) runs for the full match, with the same think / burst / edit / pause structure as a solving run. No going quiet, no flatline that lasts to the buzzer.
2. **They submit something wrong and carry on.** With moderate probability the bot makes one failed submission at a plausible time — usually later than a winning submission would land — and then resumes typing. It pays the same in-flight lock (§6.8b) a human would.
3. **They stall near the end.** A short quiet stretch in the final ~30 seconds is realistic rather than suspicious; a human who knows they have lost does stop typing. Late quiet is fine, mid-match silence is not.

The failing submission needs source that is *plausibly* wrong — ideally correct on the samples and wrong on hidden tests, which is what a human failure looks like. Perturbing the reference solution mechanically tends to fail on test 1, which is its own tell. **The problem-authoring pipeline should therefore carry an optional known-incorrect solution per problem** alongside the correct one, so the bot's failures look like near-misses instead of typos. Until that exists the bot should prefer behaviour (1) over a cheap perturbation.

#### Labelling

**The bot is disclosed in the queue-pop nameplate, before the countdown, and never revealed afterwards.** `PlayerCard.isBot` already carries the flag over the wire; the nameplate must render a `BOT` chip beside the handle so it is visible during §6.2's collision, while the player still has the accept window. Disclosure that arrives on the victory screen is worse than no disclosure at all — it converts a fair loss into a trick.

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

### The keystroke relay — decided before it was built (2C)

**Who may receive editor content, and when. This is a cheating rule, not a UI preference.**

| audience | during `LIVE` | after the match ends |
| --- | --- | --- |
| the opponent | **pulse line and status ticker only** | full source, both sides |
| spectators | both editors, live (delayed per §7) | full replay |
| the player themselves | their own editor | their own editor |

**The opponent never receives editor content while the match is live, and this is enforced at the gateway, not in the UI.** §6.4 is explicit that the pulse line exists to show "thinking pauses versus typing bursts without ever leaking a character of code", and §6.5's compile pulse, clutch state and near-miss are all *derived signals* — a count, a rate, a threshold — never content. If the gateway ever writes a delta to an opposing player's socket, a modified client simply reads it: the advantage is total, silent, and available to anyone who opens devtools. Hiding it client-side is not a control.

Spectators get the full stream because they are not competing. That asymmetry *is* the product pitch, and it costs nothing to honour.

**A player in a live match may not spectate that match.** Otherwise the spectator path becomes a trivial bypass of the rule above. §7's mandatory 45-second ranked delay does not fix this — 45-second-old source is still an enormous advantage in an eight-minute match, and on unranked matches the delay is zero. The gateway refuses by identity, and the refusal is not a UI affordance that can be skipped.

**Bandwidth is not a constraint here, and the numbers should be stated so nobody optimises against a guess.** A competitive programmer sustains roughly 4–5 characters per second while actively typing, and §6.4's whole premise is that typing is bursty — call it 40% of an eight-minute match, so ~800–1200 change events. At 50ms batching that is ~1 change per non-empty batch:

| stream | batches / match | bytes / player / match |
| --- | --- | --- |
| player deltas (50ms) | ~1000–1200 | **~130 KB** |
| 30s snapshots | 16 | ~16 KB |
| spectator (200ms) | ~300 | ~80 KB |
| spectator, ranked (500ms) | ~120 | ~50 KB |

Roughly **300 KB per match** for both editor streams, and about 1.5 MB even under frantic editing. Message *rate* is the thing that binds, not bytes, which is why §7 batches spectators rather than compressing them.

**Ordering, and recovery that never guesses.** Socket.IO is ordered and reliable *per connection*, so deltas cannot arrive out of order on a live socket. The real failure is a **gap across a reconnect**: anything sent while the socket was down is gone. So every batch carries a per-side monotonic `seq` starting at 1, and the receiver tracks the last one it applied.

- If an arriving batch is not `lastSeq + 1`, the receiver **must not apply it**. Applying a delta to the wrong base produces silent corruption, which is strictly worse than a visible gap — the viewer sees plausible code that was never written.
- Recovery is **a snapshot request, never interpolation**: the client emits `editor.resync`, the server replies with the full text as of a known `seq`, and the client replaces its buffer wholesale.
- Snapshots every 30s bound how much a late joiner or a returning client has to be sent, and they are what make replay tolerable — §10 already requires replay to be a pure function of the log.

**Paste detection: capture the data now, build the response later.** §11 wants this eventually and retrofitting a log format is expensive, so each logged delta batch carries the shape that makes a paste visible after the fact — per-change inserted length and replaced length, the batch's total inserted characters, and an `origin` of `type` / `paste` / `undo` / `other` where the editor tells us. A 400-character single-change insertion at one `offsetMs` is then unmistakable to anything reading the log. **No enforcement, no verdict, no UI**: the point is that the evidence exists when we decide what to do about it.
- Every match writes an append-only JSONL event log to disk/S3 — this file *is* the replay. Replay playback must be a pure function of that log. Do not build a separate recording system.

### Event log durability — write-behind, and why

**Apply the effect first, then append the event.** The log is a *recording*, not a recovery journal.

The alternative, write-ahead, logs intent before applying it. That is correct for a database that must recover its own state, and wrong here: a crash between the write and the apply leaves a log claiming the countdown finished when it never did. Replay would then show something that did not happen, and there is no way for a consumer to tell. Authoritative state lives in the gateway and in Postgres; the log's only job is to be *true*.

Write-behind's failure mode is losing the tail — the last few events before a crash. That is bounded, detectable, and honest.

**Buffering and worst case.** Writes go through a buffered stream and are explicitly flushed on every lifecycle transition and at match end. Worst case loss is therefore the events since the last transition — in 2B that is a handful, and in 2C it is at most one 50ms delta batch. Nothing is fsynced per event; a match-end fsync is enough, because a log that survives to `ENDED` is a complete replay.

**A log that ends mid-match is a state, not an error.** It means the match was interrupted — the gateway died, or the process was killed. A consumer must: order by `seq`, report a gap rather than silently closing it, tolerate a torn final line (normal for an append-only file caught mid-write), and render the recording as ending there. Never refuse to play a truncated log, and never fabricate a terminal event to tidy it up.
- Server is authoritative on the clock. The client's clock is display only and re-syncs on every server tick.
- Rate-limit every inbound event per socket.

---

## 11. Judge

Docker, one container per submission, from prebuilt per-language images. Judge workers pull from a Redis queue and stream per-test-case results back as they complete — **the sequential test reveal in §6.6 depends on results streaming individually, so do not batch them**. Languages: C++17, Python 3, Java, JavaScript.

Nothing is bind-mounted. The job goes in over stdin and JSONL results come back on stdout, which removes mount-based escapes from the design entirely.

### The flag set

```
--network none            --read-only
--memory 256m             --user 1000:1000
--memory-swap 256m        --cap-drop ALL
--cpus 0.5                --security-opt no-new-privileges
--pids-limit 64           --tmpfs /tmp:rw,exec,nosuid,nodev,size=64m,mode=1777
--ulimit nofile=64:64     --ulimit fsize=8388608:8388608     --ulimit core=0:0
--label com.1v1.judge=1
```

- **`--memory-swap` must equal `--memory`.** Without it Docker grants swap equal to the limit, so `256m` silently means 512m.
- **`--tmpfs /tmp` is `exec` on purpose.** A compiled binary has to run from somewhere, and the process is executing attacker code by definition; `noexec` there breaks C++ without removing any capability the attacker lacks.
- **The wall clock is enforced by the worker, not Docker.** There is no kill-after-N-seconds flag — `--stop-timeout` only affects `docker stop`. Kill the *container* by name, never the CLI process: killing the client orphans the container and it keeps burning CPU.
- **Output is capped in code**, 1 MB at the worker and 256 KB per test in the runner. Docker will not do this for you.

### Do not add `--ulimit nproc`

**This is the most important line in this section.** It looks like the natural companion to `--pids-limit` and it is not: `RLIMIT_NPROC` is enforced **per-UID and system-wide, and is not namespaced by the container**. With `--user 1000:1000` on a host whose own login user is uid 1000, the host's processes count against the container's allowance and `exec` fails with `EAGAIN` before a single instruction runs.

It was added once, as belt-and-braces, and it silently broke the entire sandbox — while the containment suite reported ten of ten passing, because "no escape was observed" is trivially true of a container that never executed anything. `--pids-limit` is the cgroup-scoped tool that actually does this job. Every other `--ulimit` above is per-process and therefore safe, but **verify rather than assume** — that distinction is the whole lesson.

### Compilation is a separate budget from execution

A compiler is an arbitrary-computation engine. Recursive template instantiation, preprocessor token explosion and `constexpr` loops are Turing-complete workloads that run *before* a single line of the program does, so the execution limit is structurally incapable of catching them.

- Compilation gets **10s wall clock and 10s of CPU**, separate from the 5s per-test execution limit. Charging build time against the execution limit would kill correct heavy-template C++ for being slow to compile.
- Distinct verdicts: **`COMPILE_ERROR`, `COMPILE_TIMEOUT`, `COMPILE_MEMORY`.** Resource exhaustion is not a syntax error, and reporting it as one tells a player their correct code is malformed.
- Memory is bounded by the container cgroup, **not** by `RLIMIT_AS`, for the compiler specifically. `RLIMIT_AS` caps virtual address space and g++ reserves vastly more VA than it resides — a 208 MB AS ceiling rejected a plain `#include <bits/stdc++.h>`. Any AS limit tight enough to bound real memory rejects correct programs. The execution path still uses `RLIMIT_AS`, where user programs have no such appetite.
- `g++` is a driver: when the cgroup kills `cc1plus`, the driver survives and prints *"Killed signal terminated program cc1plus"*. Map that to `COMPILE_MEMORY` or the most effective compile bomb in existence reads as a syntax error.
- Never raise a hard rlimit inside the container. `--ulimit` has already pinned several, and a non-root process asking for more gets `ValueError` inside `preexec_fn` — which surfaces as an opaque *"Exception occurred in preexec_fn"* and kills the job before it starts. Clamp; only ever lower.

### Time discipline — a system-wide rule, not a judge detail

`Date.now()` is not monotonic. On the WSL2 development host the system clock was measured **stepping backward 2514ms inside a 20-second window**, which made a container that ran for 6.4 real seconds report 3.8 and produced a test result that was arithmetically impossible.

**The rule: every duration, ordering decision, and timeout in the product comes from a monotonic clock. The wall clock is only ever used for a timestamp a human reads.**

That means `process.hrtime.bigint()` on the server and `performance.now()` in the browser — never `Date.now()`, never `new Date()`. It applies to:

- the server-authoritative match clock (§10) and the §6.3 countdown
- rate-limit windows and reconnect grace periods
- queue-time band widening (§6.1) and the adaptive difficulty spread (§8)
- submission receipt order and the elapsed-time tiebreak (§6.9)
- every timeout anywhere in the gateway

**The event log is where this matters most.** Replay is a pure function of the log (§10), so ordering has to be recoverable from the log alone and must never depend on a timestamp that can move backward. Every event carries three fields and they have distinct jobs:

- **`seq`** — a monotonic integer assigned at ingest, gapless per match. **Replay orders by this and only this.**
- **`offsetMs`** — monotonic milliseconds since match start, for scrubbing and for the replay timeline.
- **`wallMs`** — wall-clock milliseconds, **for display only**. Never sort by it, never diff it, never compare it across processes.

A replay that sorts by timestamp is a replay that reorders itself when the host clock drifts. Sort by `seq`.

### Resilience and capacity

- **No single submission may take down the worker.** Parse defensively: a `JSON.parse` throw that reaches the generic handler makes the worker sleep before retrying, so anyone able to push to the queue can throttle it to one job per second with garbage. Malformed payloads are rejected and logged in-loop.
- **An orphan reaper runs as its own process**, killing any container labelled `com.1v1.judge=1` older than 30s. It deliberately does not import or depend on the worker: the case it exists for is the worker dying, and a reaper that dies with it is decoration.
- **Concurrency is a straight multiplier on worst-case memory** — 256 MB × slots. Default 4 (1 GB), hard ceiling 16. Size it against measured free memory, not core count: these jobs are memory-bound long before they are CPU-bound, and each container is already pinned to half a core.
- **Rate-limit submissions per user**, not just per connection. The pool is small by design and therefore cheap to saturate; a single `while true` around a submit call is enough to make the queue unbounded for everyone.
- **Rate-limit per IP as well as per user, before public deployment.** Registration is free, so a per-user limit alone is bypassed by registering again — it throttles honest users and nobody else. Per-IP is imperfect (shared NAT, mobile carriers, VPNs) so it must be looser than the per-user limit and must never be the only control; the two together are what actually holds.

### Abuse expectations once this is public

**Someone will try to mine cryptocurrency on the judge.** The reasoning that it is worthless holds, but for one specific reason, and it is worth being precise about which:

- **`--network none` is what kills it**, not the CPU cap. Mining requires a pool connection to fetch work and submit shares; with no network there is nowhere to send a share, so the work has no value even if it completes. Solo mining anything real inside 5 seconds at half a core is not a strategy.
- The 5s wall clock and `--cpus 0.5` reduce the yield, but on their own they would only make mining *slow*, not pointless. If network access is ever granted to any language runtime — a package manager, a fetch API, a DNS-based side channel — this protection evaporates and the CPU caps alone will not save us.

**What that reasoning misses**, and what we should actually plan for:

- **The attacker does not need to profit, only to cost us money.** Sustained submission of CPU-maximal jobs is a straightforward resource-exhaustion attack. It is bounded by the rate limits and the concurrency cap, not by the sandbox — the sandbox contains each job perfectly while the fleet still burns.
- **Compilation is the cheaper attack surface**, because the compile budget is 10s of CPU against 5s for execution, and a compile bomb reaches it with a five-line file.
- **The judge is a free compute oracle.** Someone can farm out a brute-force search in 5-second chunks across many submissions and read the answers back through verdicts, or through timing. Rate limiting is the only control here; the sandbox is not designed to stop it and cannot.
- **Egress via verdict is a real if low-bandwidth channel.** A submission can encode a few bits per test case in which tests pass. Nothing to do about it, worth knowing it exists.

### The containment suite is not optional, and it needs a positive control

Every claim above gets a test that **actually attempts the escape** — and two rules that were learned by getting them wrong:

1. **Positive control first.** A canary program with known output runs before anything else, per language image. If it fails the suite reports **VOID** and refuses to continue, because every containment result after a dead canary is meaningless. A green tick on meaningless results is worse than a red one.
2. **Assert the mechanism, not the absence.** "The fork bomb did not escape" is satisfied by a container that never forked. Assert the pid ceiling was *reached*, that the exit code was *137*, that the verdict was *`OUTPUT_LIMIT`*. Absence of a bad outcome is not evidence of containment.

Pair every containment test with its counterpart — the compile bomb next to a legitimate heavy `#include`, the nofile cap next to a program that must still open files. A limit that rejects correct programs is a worse bug than the one it prevents.

### `INTERNAL_ERROR` is unreachable from user code — a standing invariant

**No input, however malformed, may cause the judge to report `INTERNAL_ERROR`. Every judge failure must resolve to a verdict attributable to the submission.**

This sits alongside the positive control as a permanent test class, not as a note. §6.9 makes a lost verdict a no-contest — `VOID`, no rating change — which means a submission that can provoke `INTERNAL_ERROR` is a submission that **annuls any match its author is about to lose**. That is a cheat code, and it is invisible: the player looks like a victim of our infrastructure.

**Any newly discovered path from user code to `INTERNAL_ERROR` is a security bug, not a robustness bug, and is fixed at that priority.**

The test class aims at the *judge*, not the sandbox — the sandbox tests above assume the runner works, and these assume it is under attack:

- binary garbage as source; source containing null bytes; **source containing lone surrogates**
- enormous single-line files, in both languages, near the 256 KB protocol cap
- output that is valid but gigantic; compiler diagnostics that are themselves gigantic
- a program that closes its own stdout, or kills its own process group
- empty source, and source that is nothing but a null byte
- **every input that has ever produced `INTERNAL_ERROR`**, kept as a regression forever

The lone-surrogate case found a live exploit the first time it ran: source arrives as JSON and may contain unencodable sequences, and writing them naively raised `UnicodeEncodeError` inside the runner, which surfaced as an internal error. Encoding is now total — unencodable characters become U+FFFD and the source then fails compilation on its own merits, which is a verdict the submission has earned.

### Cost accounting — request counts do not measure the attack

**Compilation is an amplification attack.** Five lines of preprocessor macros buy ten seconds of CPU. A request-counting rate limiter cannot see that: it counts one request while the attacker spends ten CPU-seconds, so the limiter and the resource being consumed are in different units.

**Bill CPU-seconds, not requests.** The runner measures actual CPU via `getrusage(RUSAGE_CHILDREN)` for both the compile step and every test, and reports `cpuMs` per phase and a total. Wall time is not a substitute: a process sleeping for five seconds costs nothing, and one spinning for five seconds costs a core.

Rolling ten-minute budgets:

| scope | budget | sustained equivalent |
| --- | --- | --- |
| per user | **120 CPU-seconds / 10 min** | ~30 C++ submissions |
| per IP | **240 CPU-seconds / 10 min** | 0.4 of a core, ~20% of a 4-slot pool |

**A legitimate heavy user must never hit this**, and does not: a full C++ submission costs roughly 4 CPU-seconds (≈3.5s compiling, the rest running), and the §6.8b in-flight lock caps a player at about one submission per 5.5s. A fast iterator makes 10–25 submissions in an eight-minute match — call it 100 CPU-seconds against a 120 budget. Someone mashing submit hits the lock long before the budget.

Per-IP is deliberately looser than double the per-user budget because shared NAT is real, and it **applies only to accounts younger than 24 hours**. Established accounts are governed by the per-user budget alone, so a university or an office does not throttle itself; new and anonymous accounts, which are the actual abuse vector because registration is free, carry both.

When a budget is exhausted the response is a 429 naming the CPU budget rather than a request count, so the message is true.

---

## 12. Build phases

Do exactly one phase per session. Each phase ends fully designed, fully animated, and demoable.

**Phase 0 — Foundation.** Monorepo, Tailwind v4 with the full token set, `motion.ts`, typography loaded, and `packages/ui` primitives: Button, Card, Nameplate, RankBadge, TestBar, Clock, StatusTicker. Plus a `/dev/kitchen-sink` route showing every primitive in every state.

**Phase 1 — The Moment Simulator.** Before any networking, build `/dev/hud`: the complete match HUD with buttons that fire every cinematic on demand — queue pop, countdown, test pass, test fail, clutch state, submit pass, submit fail, victory, rank-up. *You are building this alone and will not have two humans to test with. This route is how you tune the feel, and it is the highest-leverage thing in the whole build.* Do not skip it, do not build it last.

**Phase 2 — Real 1v1.** Six systems, so it splits in two. One phase per session still holds (§13.4) — 2A and 2B are separate sessions.

**Phase 2A — Persistence and execution.** Postgres + Prisma (users, problems, test cases, validators, submissions, matches, ratings, replay index). Auth, email/password only, no OAuth yet. The problem model carries a Glicko-scale difficulty rating (§8) **and a validator (§6.8) — the validator lands here, not retrofitted in Phase 4**. 20 seeded problems across DP, graphs, greedy, strings and math, rated 800–2000. The Docker judge: a worker pulling from Redis, executing in a container, streaming per-test-case results back individually. C++17 and Python 3 only; Java and JavaScript later. Plus `/dev/judge` — paste code, pick a problem, watch verdicts stream — for the same reason `/dev/hud` exists: see the judge work before it is buried under networking.

Judge security is verified, never assumed. Every containment claim in §11 gets a test that actually attempts the escape — network call, fork bomb, memory exhaustion, infinite loop, unbounded stdout, filesystem write — and proves it is contained.

**Phase 2B — A real match, no keystroke relay.** `packages/proto` carrying zod schemas for every socket event, imported by both client and server. Socket.IO gateway with presence and reconnection. Redis matchmaking with the §6.1 band widening and §8's mean − 120 difficulty with adaptive spread. An **explicit match lifecycle state machine** — `QUEUED · MATCHED · ACCEPTING · COUNTDOWN · LIVE · JUDGING · ENDED · ABANDONED` — with named states rather than ad-hoc booleans, and every transition logged. The append-only **JSONL event log written from the first commit, not retrofitted**: replay is a pure function of that log, so the log has to be complete before anything reads it. Auth finished end to end — registration UI, login, session cookie round-trip, a real user in the database. Submission rows actually persisted. The real match screen wired to Phase 1's animations, with Monaco local-only. The bot opponent from §13.6, reusing the four-state typing model so its pulse line looks human. Glicko-2 with real rating updates.

Four things to design deliberately rather than improvise, because each one is a state machine hole that only shows up in production: **reconnection** (grace period, what the opponent sees, how state resyncs, when it becomes a forfeit); **abandonment** (tab closed, no reconnect — forfeit rules and rating consequence); **nobody solves** (a dead match still needs an ending and a screen); and **idempotency on accept and submit** (the server must never start a match twice or double-count a submission).

On **Glicko-2**: it is defined over rating *periods*, not per-game updates. Applying it per match is acceptable, but **RD must grow with time elapsed since a player's last match** or inactive players keep artificially confident ratings and the ladder stops self-correcting.

**Phase 2C — Keystroke relay.** Monaco delta streaming, ~50ms batching, sequence numbers, and periodic full snapshots so late-joining spectators can catch up. The visibility rule, bandwidth figures, gap-recovery contract and paste-detection data shape are settled in §10 under *The keystroke relay*.

**It splits, and the seam is load versus behaviour.**

- **2C-1 — the relay.** Deltas, batching, per-side `seq`, 30s snapshots, gap recovery by snapshot request, delta records in the JSONL log, the gateway-enforced visibility rule, the paste-detection data shape, and the §6.4 pulse line finally driven by real keystrokes instead of the simulator. Plus a dev route showing both editors side by side, which is what makes any of it verifiable by eye. Deliverable: two windows in a live match, each reading the other's real pulse, with a delta log on disk that replay could consume.
- **2C-2 — SPLIT AGAIN, and the load half is DEFERRED.**
  - **The late-joiner path shipped with the watch link**, because a shared link is opened mid-match *by definition* — that is the normal case for the feature, not an edge case. A viewer arriving at minute four lands from a snapshot, never from replayed deltas. It is a correctness property, it needs no harness, and it is verified by joining repeatedly and diffing the spectator's document against the gateway's authoritative text.
  - **The load work is deferred until a real match has real viewers.** Tiered fanout (200ms, 500ms on ranked), saturation measurement and capacity instrumentation all target thousands of viewers; the estimate says 500–1000 works with no batching at all, and we will have single digits. A saturation number measured on a WSL2 dev box is not production's number, and a figure that *sounds* measured but is not is worse than an honest estimate, because nobody re-checks a number that has a figure next to it. Revisit with real traffic.

The seam is real rather than convenient: everything in 2C-2 is a *load* optimisation whose behaviour is unobservable at one viewer, and §7 ties it to the spectator feature proper. Shipping it against a dev route with a single consumer would be tuning a ceiling nobody is near, and the batching interacts with the delay badge and the late-joiner path that Phase 3 owns. Splitting keeps 2C-1's deliverable honest — a real pulse line and a complete log — instead of half a fanout tier nothing exercises.

**Phase 2D — Challenge links and clip export.** *Moved up from Phase 4, because the launch plan changed.* Challenge link generation and redemption, guest play, one-click rematch, and clip export — all specced in §7.

The reasoning for the move: **ranked matchmaking needs a population we will not have on day one, and a challenge link does not.** A link needs exactly two people who already know each other, so it carries its own audience into an empty product. Shipping ranked first means shipping a queue that never pops. This phase is what makes the deployment worth doing, so it comes before the features that assume a crowd.

**Phase 2E — Deployment.** A single VM running docker-compose: Postgres, Redis, the gateway, the web app, and the judge worker.

**The judge is why this cannot be serverless.** It runs one container per submission, so the host must be able to run containers — nested containers rule out Fargate and equivalents, and Docker-in-Docker would be a security downgrade on the single component whose entire job is executing untrusted code. A plain VM with a Docker socket is both simpler and safer here.

Scope: TLS termination, environment separation (a real staging database, never a shared one), automated Postgres backups with a restore that has actually been tested, log retention, and **the Socket.IO Redis adapter** — not because we need a second gateway on day one, but because §7's spectator fanout ceiling is a single process and retrofitting the adapter after state has spread across handlers is exactly the kind of change that goes wrong. Per-IP rate limiting (§11) lands here too.

**Phase 3 — Alive.** Spectator mode, replay from the event log, the Hub, profiles with topic radar, XP/quests/streaks, draft pick-ban, **league color on handles (§4)**.

## Phase 4 — DEFERRED IN FULL

**Everything in this phase is deferred. It is not upcoming work, and no session should plan against it.** The design stays in this document because the design work is done and worth keeping; the *scheduling* is what has changed.

Deferred: **Bo3 · Blitz · Debug Duel · Optimization Duel · Code Golf · Blind Mode · Mystery Mode · the hack phase (§6.8) · team modes · Battle Royale · tournaments · the full sound library · cosmetics · battle pass · guilds.**

**The reasoning is depth before breadth.** Make ranked 1v1 excellent, then add modes one at a time. Every additional mode multiplies the surface that has to be polished — its own HUD states, its own cinematics, its own edge cases in the state machine, its own balance questions — and **eight half-finished modes are worth less than one that feels incredible.** §2 says the product exists because a match should feel like a match; that is a claim about quality, and breadth is the fastest way to stop being able to make it.

This supersedes the earlier framing of §6.8 as "if scope ever has to be cut, cut elsewhere first". That sentence was about cutting the hack phase *relative to other Phase 4 modes*, and it still holds inside Phase 4 — the hack phase is the best of them. It was never an argument for shipping Phase 4 before ranked 1v1 is excellent.

### The road to launch

Only these, in order:

1. **The shareable spectator link** — `/watch/<code>`, including the late-joiner path.
2. **Challenge links** (Phase 2D) — the launch feature, because it brings its own audience.
3. **Deployment** (Phase 2E).

**Deferred out of the road to launch:** 2C-2's tiered fanout and capacity work — see the note in §12 above. Ghost Races stays deferred but is the first thing to reconsider after launch: it would be the first consumer the replay log has ever had, and would therefore test §10's "replay is a pure function of the log" claim while the format is still cheap to change.

Nothing else.

### Ghost Races — flagged, not scheduled

**The one deferred item with a real argument for promotion, and it is deliberately left undecided here.** Racing a stored replay makes the site feel populated when nobody is online, which is the *actual* risk for a competitive product at launch — not missing modes. It also reuses the replay log rather than adding a system. See the assessment in `PROGRESS.md`; it is not in the road to launch above until that decision is made explicitly.

---

### The problem bank — a parallel workstream, and a launch blocker

**This runs alongside the phases rather than inside one**, because it is the only deliverable measured in weeks of writing rather than sessions of building, and blocking a phase on it would stall everything.

**20 problems will not survive two friends playing a weekend.** Worse, §8 selects at mean − 120 with an adaptive spread, and that selection is only meaningful if there is real choice at every rating — a thin band means the same problem repeatedly, which is the fastest way to make a competitive product feel small. **Target 60+ before any public launch**, spread so that every 100-point bucket from 800 to 2000 has at least three problems.

**Do not scrape Codeforces, LeetCode, AtCoder, HackerRank or Project Euler.** Their statements and test data are copyrighted and using them violates their terms. This is not a risk to manage, it is a line not to cross.

What *is* usable:

- **Original problems we write.** The primary source, and the only unambiguous one.
- **The classic task, restated.** An *algorithmic idea* — longest increasing subsequence, minimum spanning tree, edit distance — is not copyrightable; the specific prose of somebody's statement and their specific test data are. Implementing a well-known task with our own statement, our own constraints and our own generated tests is exactly how the first 20 were made and is entirely legitimate.
- **Properly licensed sets**, where the licence permits commercial use and derivative works (CC-BY, CC-BY-SA, public domain). Each one checked individually rather than assumed from a general impression that a site is "open".
- **Commissioned problems** under work-for-hire, if we ever pay setters.

**Nothing enters the bank without passing the pipeline**, which already exists and is the thing that makes bulk authoring safe: statement, constraints, test cases, a **validator** enforcing those constraints (§6.8), a **known-correct reference solution**, and mechanical verification that the reference passes every test and that the tests agree with it. That check caught five bad expected outputs in the first 20 — including a problem whose own test data violated its stated constraint, which would have made the hack phase police a promise the problem broke. Reading does not catch those; running does.

**Each problem may also carry one known-incorrect solution**, and the bot's losing behaviour (§8) depends on it.

It must be *plausibly* wrong — the kind of wrong a human actually is. A solution that fails on test 1 is a typo, and a bot that submits typos is as obvious a tell as a bot that goes silent. What we want is a solution that passes the samples and fails on an edge case: an unhandled empty input, an off-by-one at the boundary, an `int` that overflows only at the stated maximum, a greedy choice that is right until it is not. Those are the failures a real player has, and they are also the ones §6.8's hack phase is about.

**It is optional, deliberately**, so that authoring is never blocked on inventing a good wrong answer — which is genuinely harder than writing a right one. Verification treats it the same way as the reference: if a wrong solution is supplied it must actually be *rejected* by the judge, because a "wrong" solution that quietly passes is worse than none.

**For problems without one, the bot does not submit at all when it draws a losing plan** — it falls back to §8's behaviour (1), keeping up plausible typing for the full match and simply never finishing. That is the most common way a human loses anyway, so the fallback is not a degradation, just a narrower repertoire.

**Realistic effort per problem**, for planning how many to write by hand versus draft and verify:

| difficulty | statement + tests + validator + solution | notes |
| --- | --- | --- |
| 800–1200 | **45–90 min** | few edge cases, small test set |
| 1200–1700 | **1.5–3 h** | needs tests that defeat plausible wrong approaches |
| 1700–2200 | **3–6 h** | anti-heuristic cases and performance tests dominate |

Sixty problems at a ~2 hour average is roughly **120 hours of authoring** — a real project, not a side task. Drafting with assistance and then verifying mechanically cuts it to perhaps **30–45 minutes each**, because verification is the bottleneck and verification is already automated. Budget around **30–40 hours** for 60 problems that way, and spend the hand-written effort on the top of the range, where test design is the actual work and a weak test set silently accepts wrong solutions.

---

## 13. Rules for you, Claude Code

1. **Never build logic-first with placeholder styling.** A screen ships designed or it doesn't ship.
2. **Never hardcode a color, duration, or easing.** Tokens only. If you need a new one, add it to the token file and say why.
3. **Ask before adding a dependency.** The approved list is in §3.
4. **Vertical slices, not layers.** One feature working end to end beats four half-built systems.
5. **Every socket event is typed in `packages/proto` before it is used.**
6. **You cannot judge what you cannot reproduce.** This is why `/dev/hud` exists, and it is why `/dev/sparring` exists.

   The bot was the original answer to solo development and is **held as of 2B-4** — that phase is human vs human. Its foundations stay built and unused (§8, *The bot*): the solve model, the RD > 100 rating gate, and the 20 known-correct solutions verified through the real judge. Do not rebuild them and do not delete them.

   In its place, `/dev/sparring` drives a second player **on command**. It is deliberately not a bot: no solve model, no rating integrity rules, no labelling, no human-like typing. It takes one identity per tab, mints its socket ticket through a route that 404s in production, and gives you queue / accept / submit-correct / submit-wrong / submit-timeout / drop-socket. The reference-solution button pulls the same reviewed source `pnpm db:solutions` verifies, so a sparring win is a real win.

   **It is what makes the §6.7b hold reproducible.** That screen needs two submissions outstanding with verdicts returning in a different order to their receipts, which is close to impossible to stage by hand: submit *Time limit* from the sparring tab first and a correct solution from your own window second, and the first receipt gets the last verdict.
7. **Screenshot your work and critique it against §2 before telling me a screen is done.** If it looks like a generic dark dashboard with neon accents, it has failed the brief — say so and fix it.
8. Test at 1280px and at mobile widths. Mobile is spectate-and-browse only; the editor is desktop-only and should say so gracefully rather than degrade.
9. Keyboard focus must be visible everywhere. `prefers-reduced-motion` must be honored in every animation you write, in the same commit that writes it.
10. When a phase is done, write what changed to `PROGRESS.md` and stop. Do not roll into the next phase.

**First task:** read this file, confirm the stack in §3, list anything you think is underspecified, then execute **Phase 0 only**.