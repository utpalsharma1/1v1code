# PROGRESS

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
