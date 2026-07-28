# PROGRESS

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
