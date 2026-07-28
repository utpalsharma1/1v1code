"use client";

import { useEffect, useState } from "react";
import {
  ALL_STATUSES,
  Button,
  Card,
  Clock,
  DIVISIONS,
  Nameplate,
  RankBadge,
  StatusTicker,
  TIERS,
  cn,
  useMotionPref,
  type CellState,
  type MotionPref,
  type NameplateState,
  type Side,
} from "@1v1/ui";
import { TestBar } from "@1v1/ui";

const SECTIONS = [
  ["color", "Color"],
  ["type", "Type"],
  ["geometry", "Geometry"],
  ["button", "Button"],
  ["card", "Card"],
  ["nameplate", "Nameplate"],
  ["rank", "RankBadge"],
  ["testbar", "TestBar"],
  ["clock", "Clock"],
  ["ticker", "StatusTicker"],
] as const;

export default function KitchenSink() {
  return (
    <div className="mx-auto flex max-w-[1280px] gap-10 px-6 py-10 max-lg:flex-col">
      <Rail />
      <main className="flex min-w-0 flex-1 flex-col gap-14">
        <Header />
        <ColorSection />
        <TypeSection />
        <GeometrySection />
        <ButtonSection />
        <CardSection />
        <NameplateSection />
        <RankSection />
        <TestBarSection />
        <ClockSection />
        <TickerSection />
        <footer className="text-fg-faint border-line border-t pt-6 text-12">
          Phase 0 ends here. The HUD, the cinematics, and the moment simulator are Phase 1.
        </footer>
      </main>
    </div>
  );
}

/* ── Chrome ──────────────────────────────────────────────────────────────── */

function Rail() {
  return (
    <nav className="w-44 shrink-0 max-lg:w-full">
      <div className="sticky top-10 flex flex-col gap-1 max-lg:static max-lg:flex-row max-lg:flex-wrap">
        {SECTIONS.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            // Player color in a *variant* has to use the arbitrary-value form:
            // Tailwind can't generate hover: on the hand-written .text-player.
            className="font-display text-fg-faint border-line border-l px-3 py-1.5 text-12 font-bold tracking-[var(--track-hud)] uppercase transition-colors duration-[160ms] hover:border-[var(--player)] hover:text-[var(--player)] max-lg:border-l-0"
          >
            {label}
          </a>
        ))}
      </div>
    </nav>
  );
}

function Header() {
  const { pref, setPref } = useMotionPref();
  const options: MotionPref[] = ["auto", "full", "reduced"];

  return (
    <header className="flex items-end justify-between gap-6 max-md:flex-col max-md:items-start">
      <div>
        <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
          Phase 0 · packages/ui
        </p>
        <h1 className="font-display text-fg mt-2 text-34 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
          Kitchen sink
        </h1>
      </div>

      <div>
        <p className="font-display text-fg-faint mb-2 text-12 font-bold tracking-[var(--track-hud)] uppercase">
          Motion
        </p>
        <div className="flex gap-1">
          {options.map((option) => (
            <Button
              key={option}
              size="sm"
              variant={pref === option ? "solid" : "outline"}
              tone={pref === option ? "player" : "neutral"}
              onClick={() => setPref(option)}
              aria-pressed={pref === option}
            >
              {option}
            </Button>
          ))}
        </div>
      </div>
    </header>
  );
}

function Section({
  id,
  title,
  note,
  children,
}: {
  id: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-10">
      <div className="border-line mb-5 flex items-baseline gap-3 border-b pb-2">
        <h2 className="font-display text-fg text-20 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
          {title}
        </h2>
        {note && <p className="text-fg-faint text-12">{note}</p>}
      </div>
      <div className="flex flex-col gap-6">{children}</div>
    </section>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
      {children}
    </p>
  );
}

/* ── Color ───────────────────────────────────────────────────────────────── */

function Swatch({ name, token }: { name: string; token: string }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="clip-p1 border-line size-11 shrink-0 border"
        style={{ background: `var(${token})` }}
      />
      <div className="min-w-0">
        <div className="text-fg truncate text-13">{name}</div>
        <div className="tabular text-fg-faint truncate text-12">{token}</div>
      </div>
    </div>
  );
}

function SwatchGrid({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-4 gap-4 max-xl:grid-cols-3 max-md:grid-cols-2">
      {items.map(([name, token]) => (
        <Swatch key={token} name={name} token={token} />
      ))}
    </div>
  );
}

function ColorSection() {
  return (
    <Section id="color" title="Color" note="Every value lives in packages/ui/tokens.css">
      <Label>Base</Label>
      <SwatchGrid
        items={[
          ["Ink", "--ink"],
          ["Surface", "--surface"],
          ["Elevated", "--elevated"],
          ["Line", "--line"],
          ["Line hot", "--line-hot"],
        ]}
      />

      <Label>Text</Label>
      <SwatchGrid
        items={[
          ["Text", "--text"],
          ["Text dim", "--text-dim"],
          ["Text faint", "--text-faint"],
        ]}
      />

      <Label>Player identity</Label>
      <SwatchGrid
        items={[
          ["P1 jade", "--p1"],
          ["P1 glow", "--p1-glow"],
          ["P2 magenta", "--p2"],
          ["P2 glow", "--p2-glow"],
        ]}
      />

      <Label>State — each has exactly one job</Label>
      <SwatchGrid
        items={[
          ["Clock — time pressure only", "--clock"],
          ["Fail — failed tests only", "--fail"],
          ["Info — system messages", "--info"],
        ]}
      />

      <Label>Rank tiers</Label>
      <SwatchGrid items={TIERS.map((tier) => [tier, `--${tier}`] as [string, string])} />

      <Card title="Colorblind check" tone="surface">
        <p className="text-fg-dim mb-4 text-13 leading-relaxed">
          Player identity never rests on hue. Four independent carriers: side of the screen, the
          literal P1/P2 label, a solid fill for P1 versus a 45° hatch for P2, and the mirrored corner
          cut.
        </p>
        <div className="flex items-center gap-6 max-md:flex-col max-md:items-stretch">
          <div data-side="p1" className="flex flex-1 items-center gap-3">
            <span className="clip-lean-sm bg-player font-display text-ink px-1.5 py-0.5 text-12 leading-none font-extrabold tracking-[var(--track-hud)]">
              P1
            </span>
            <div className="fill-player clip-lean h-5 flex-1" />
          </div>
          <div data-side="p2" className="flex flex-1 items-center gap-3">
            <div className="fill-player clip-lean h-5 flex-1" />
            <span className="clip-lean-sm bg-player font-display text-ink px-1.5 py-0.5 text-12 leading-none font-extrabold tracking-[var(--track-hud)]">
              P2
            </span>
          </div>
        </div>
      </Card>
    </Section>
  );
}

/* ── Type ────────────────────────────────────────────────────────────────── */

const SCALE: [string, string][] = [
  ["12", "text-12"],
  ["13", "text-13"],
  ["14", "text-14"],
  ["16", "text-16"],
  ["20", "text-20"],
  ["26", "text-26"],
  ["34", "text-34"],
  ["48", "text-48"],
  ["72", "text-72"],
];

function TypeSection() {
  return (
    <Section id="type" title="Type" note="Display · Body · Code">
      <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
        <Card title="Display — Martian Mono">
          <p className="font-display text-fg text-20 font-extrabold tracking-[var(--track-display)] uppercase">
            Sudden Death
          </p>
          <p className="text-fg-faint mt-2 text-12">Headings, HUD, buttons. Used with restraint.</p>
        </Card>
        <Card title="Body — Geist Sans">
          <p className="font-body text-fg text-16">Return the k-th smallest element.</p>
          <p className="text-fg-faint mt-2 text-12">Prose, labels, problem statements.</p>
        </Card>
        <Card title="Code — JetBrains Mono">
          <p className="tabular text-fg text-16">1442 → 1458 · 07:42</p>
          <p className="text-fg-faint mt-2 text-12">
            Code and every numeral, with tabular figures so digits never jitter.
          </p>
        </Card>
      </div>

      <Label>Scale — 12 / 13 / 14 / 16 / 20 / 26 / 34 / 48 / 72</Label>
      <div className="border-line flex flex-col gap-2 border-l pl-4">
        {SCALE.map(([size, cls]) => (
          <div key={size} className="flex items-baseline gap-4">
            <span className="tabular text-fg-faint w-8 shrink-0 text-12">{size}</span>
            <span
              className={cn(
                "font-display text-fg truncate font-extrabold tracking-[var(--track-display)] uppercase",
                cls,
              )}
            >
              {size === "72" ? "07:42" : "Clutch"}
            </span>
            {size === "72" && (
              <span className="text-fg-faint text-12">match clock only</span>
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ── Geometry ────────────────────────────────────────────────────────────── */

function GeometrySection() {
  return (
    <Section id="geometry" title="Geometry" note="One corner cut, mirrored per side">
      <div className="grid grid-cols-4 gap-4 max-md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div
            data-side="p1"
            className="clip-lean border-player glow-player grid h-24 place-items-center border bg-surface"
          >
            <span className="font-display text-player text-13 font-bold uppercase">P1 lean</span>
          </div>
          <p className="text-fg-faint text-12">top-left / bottom-right, 12px</p>
        </div>
        <div className="flex flex-col gap-2">
          <div
            data-side="p2"
            className="clip-lean border-player glow-player grid h-24 place-items-center border bg-surface"
          >
            <span className="font-display text-player text-13 font-bold uppercase">P2 lean</span>
          </div>
          <p className="text-fg-faint text-12">mirrored — they lean into each other</p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="border-line grid h-24 place-items-center rounded-card border bg-surface">
            <span className="font-display text-fg-dim text-13 font-bold uppercase">Card</span>
          </div>
          <p className="text-fg-faint text-12">8px radius</p>
        </div>
        <div className="flex flex-col gap-2">
          <div className="border-line grid h-24 place-items-center rounded-sm border bg-surface">
            <span className="font-display text-fg-dim text-13 font-bold uppercase">Small</span>
          </div>
          <p className="text-fg-faint text-12">4px radius — never pill</p>
        </div>
      </div>
    </Section>
  );
}

/* ── Button ──────────────────────────────────────────────────────────────── */

function ButtonSection() {
  return (
    <Section id="button" title="Button" note="rest · hover · press · focus · disabled">
      <div className="flex flex-col gap-5">
        <div>
          <Label>Solid</Label>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button variant="solid" tone="player" size="lg">
              Play
            </Button>
            <Button variant="solid" tone="player">
              Ready
            </Button>
            <Button variant="solid" tone="player" size="sm">
              Accept
            </Button>
            <Button variant="solid" tone="fail">
              Forfeit
            </Button>
            <Button variant="solid" tone="player" disabled>
              Disabled
            </Button>
          </div>
        </div>

        <div>
          <Label>Outline</Label>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button variant="outline" tone="player" size="lg">
              Rematch
            </Button>
            <Button variant="outline" tone="neutral">
              Queue again
            </Button>
            <Button variant="outline" tone="neutral" size="sm">
              Watch replay
            </Button>
            <Button variant="outline" tone="fail">
              Leave
            </Button>
            <Button variant="outline" tone="neutral" disabled>
              Disabled
            </Button>
          </div>
        </div>

        <div>
          <Label>Ghost</Label>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button variant="ghost">Back to hub</Button>
            <Button variant="ghost" size="sm">
              Settings
            </Button>
            <Button variant="ghost" disabled>
              Disabled
            </Button>
          </div>
        </div>

        <div>
          <Label>Owned by P2 — tone follows the side, not a brand accent</Label>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Button variant="solid" tone="player" side="p2">
              P2 ready
            </Button>
            <Button variant="outline" tone="player" side="p2">
              P2 outline
            </Button>
          </div>
        </div>

        <p className="text-fg-faint text-12">
          Tab to a button to see the focus ring — it is drawn inside the clip path, because
          clip-path crops an outline.
        </p>
      </div>
    </Section>
  );
}

/* ── Card ────────────────────────────────────────────────────────────────── */

function CardSection() {
  return (
    <Section id="card" title="Card">
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
        <Card title="Surface" aside={<span className="tabular text-fg-faint text-12">01</span>}>
          <p className="text-fg-dim text-13">Default panel. 1px line border, clipped corners.</p>
        </Card>
        <Card tone="elevated" title="Elevated">
          <p className="text-fg-dim text-13">Modals, popovers, hovered rows.</p>
        </Card>
        <Card owned side="p1" title="Owned by P1">
          <p className="text-fg-dim text-13">Player border plus a 24px outer glow.</p>
        </Card>
        <Card owned side="p2" title="Owned by P2">
          <p className="text-fg-dim text-13">Same rule, mirrored lean, magenta glow.</p>
        </Card>
        <Card clip={false} title="Unclipped">
          <p className="text-fg-dim text-13">8px radius, for secondary chrome.</p>
        </Card>
        <Card>
          <p className="text-fg-dim text-13">No header.</p>
        </Card>
      </div>
    </Section>
  );
}

/* ── Nameplate ───────────────────────────────────────────────────────────── */

const NAMEPLATE_STATES: NameplateState[] = ["idle", "active", "winner", "loser"];

function NameplateSection() {
  const [flashKey, setFlashKey] = useState(0);

  return (
    <Section id="nameplate" title="Nameplate" note="idle · active · winner · loser">
      <div className="flex flex-col gap-3">
        {NAMEPLATE_STATES.map((state) => (
          <div key={state} className="flex items-center gap-4 max-md:flex-col max-md:items-stretch">
            <span className="font-display text-fg-faint w-16 shrink-0 text-12 font-bold tracking-[var(--track-hud)] uppercase">
              {state}
            </span>
            <div className="flex flex-1 items-center justify-between gap-4 max-md:flex-col max-md:items-stretch">
              <Nameplate
                side="p1"
                handle="arjun_dev"
                rating={1442}
                tier="gold"
                division="II"
                state={state}
                flashKey={flashKey}
              />
              <Nameplate
                side="p2"
                handle="rohan_x"
                rating={1478}
                tier="platinum"
                division="IV"
                state={state === "winner" ? "loser" : state === "loser" ? "winner" : state}
                flashKey={flashKey}
              />
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4">
        <Button size="sm" variant="outline" onClick={() => setFlashKey((k) => k + 1)}>
          Fire impact flash
        </Button>
        <p className="text-fg-faint text-12">
          The 60ms white flash from the queue-pop collision. The full cinematic is Phase 1.
        </p>
      </div>

      <div>
        <Label>Large</Label>
        <div className="mt-2 flex gap-4 max-md:flex-col">
          <Nameplate
            side="p1"
            handle="arjun_dev"
            rating={1442}
            tier="gold"
            division="II"
            state="active"
            size="lg"
          />
          <Nameplate
            side="p2"
            handle="rohan_x"
            rating={1478}
            tier="platinum"
            division="IV"
            state="active"
            size="lg"
          />
        </div>
      </div>
    </Section>
  );
}

/* ── RankBadge ───────────────────────────────────────────────────────────── */

function RankSection() {
  return (
    <Section id="rank" title="RankBadge" note="Iron → Legend, divisions IV → I">
      <div className="flex flex-wrap gap-6">
        {TIERS.map((tier) => (
          <RankBadge
            key={tier}
            tier={tier}
            division={tier === "legend" ? undefined : "II"}
            size="lg"
            showLabel
          />
        ))}
      </div>

      <div>
        <Label>Divisions</Label>
        <div className="mt-2 flex flex-wrap gap-5">
          {DIVISIONS.map((division) => (
            <RankBadge key={division} tier="diamond" division={division} size="md" showLabel />
          ))}
        </div>
      </div>

      <div>
        <Label>Progress arc to next tier</Label>
        <div className="mt-2 flex flex-wrap items-center gap-6">
          {[0, 0.25, 0.6, 0.92].map((progress) => (
            <RankBadge key={progress} tier="gold" division="I" size="lg" progress={progress} />
          ))}
        </div>
      </div>

      <div>
        <Label>Sizes</Label>
        <div className="mt-2 flex flex-wrap items-end gap-5">
          <RankBadge tier="master" division="III" size="sm" />
          <RankBadge tier="master" division="III" size="md" />
          <RankBadge tier="master" division="III" size="lg" />
        </div>
      </div>
    </Section>
  );
}

/* ── TestBar ─────────────────────────────────────────────────────────────── */

const TOTAL = 10;

function TestBarSection() {
  const [p1, setP1] = useState<CellState[]>(() => Array<CellState>(TOTAL).fill("idle"));
  const [p2, setP2] = useState<CellState[]>(() => Array<CellState>(TOTAL).fill("idle"));

  const advance = (setter: typeof setP1, state: CellState) => {
    setter((cells) => {
      const next = [...cells];
      const index = next.findIndex((cell) => cell === "idle");
      if (index === -1) return next;
      next[index] = state;
      return next;
    });
  };

  const reset = () => {
    setP1(Array<CellState>(TOTAL).fill("idle"));
    setP2(Array<CellState>(TOTAL).fill("idle"));
  };

  return (
    <Section id="testbar" title="TestBar" note="Cells race toward the center">
      <div className="grid grid-cols-2 gap-8 max-md:grid-cols-1">
        <div className="flex flex-col gap-3">
          <Label>P1 — fills rightward, solid</Label>
          <TestBar side="p1" total={TOTAL} cells={p1} />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" tone="player" onClick={() => advance(setP1, "pass")}>
              Pass
            </Button>
            <Button size="sm" variant="outline" tone="fail" onClick={() => advance(setP1, "fail")}>
              Fail
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <Label>P2 — fills leftward, hatched</Label>
          <TestBar side="p2" total={TOTAL} cells={p2} />
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="outline"
              tone="player"
              side="p2"
              onClick={() => advance(setP2, "pass")}
            >
              Pass
            </Button>
            <Button size="sm" variant="outline" tone="fail" onClick={() => advance(setP2, "fail")}>
              Fail
            </Button>
          </div>
        </div>
      </div>

      <Button size="sm" variant="ghost" onClick={reset} className="self-start">
        Reset both
      </Button>

      <div className="grid grid-cols-2 gap-8 max-md:grid-cols-1">
        <div className="flex flex-col gap-3">
          <Label>Static states</Label>
          <TestBar side="p1" total={TOTAL} passed={0} />
          <TestBar side="p1" total={TOTAL} passed={7} />
          <TestBar
            side="p1"
            total={TOTAL}
            cells={["pass", "pass", "pass", "fail", "idle", "idle", "idle", "idle", "idle", "idle"]}
          />
          <TestBar side="p1" total={TOTAL} passed={TOTAL} />
        </div>
        <div className="flex flex-col gap-3">
          <Label>Small · and the &gt;20 case</Label>
          <TestBar side="p2" total={TOTAL} passed={4} size="sm" />
          <TestBar side="p2" total={TOTAL} passed={9} size="sm" />
          <p className="text-fg-faint text-12">
            Above 20 tests the segmented bar degrades to a continuous fill — cells would be
            sub-pixel. It still grows toward the center.
          </p>
          <TestBar side="p1" total={64} passed={41} />
          <TestBar side="p2" total={64} passed={23} />
        </div>
      </div>
    </Section>
  );
}

/* ── Clock ───────────────────────────────────────────────────────────────── */

function ClockSection() {
  const [ms, setMs] = useState(462_000);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => setMs((v) => Math.max(0, v - 1000)), 1000);
    return () => window.clearInterval(id);
  }, [running]);

  return (
    <Section id="clock" title="Clock" note="Server-authoritative; this only draws it">
      <div className="flex items-end gap-10 max-md:flex-col max-md:items-start">
        <div>
          <Label>HUD — 72px, the only 72px in the product</Label>
          <Clock ms={ms} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setRunning((r) => !r)}>
            {running ? "Pause" : "Run"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMs(462_000)}>
            07:42
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMs(45_000)}>
            00:45
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setMs(8_000)}>
            00:08
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-10">
        <div>
          <Label>Pending — before the reveal completes</Label>
          <Clock ms={600_000} pending size="sm" />
        </div>
        <div>
          <Label>Normal</Label>
          <Clock ms={462_000} size="sm" />
        </div>
        <div>
          <Label>Warning — under 60s</Label>
          <Clock ms={45_000} size="sm" />
        </div>
        <div>
          <Label>Critical — under 10s</Label>
          <Clock ms={8_000} size="sm" />
        </div>
      </div>
      <p className="text-fg-faint text-12">
        Under 10 seconds each tick gets one 90ms pop — a discrete change, not an ambient loop. Press
        Run at 00:08 to see it.
      </p>
    </Section>
  );
}

/* ── StatusTicker ────────────────────────────────────────────────────────── */

function TickerSection() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => setIndex((i) => (i + 1) % ALL_STATUSES.length), 1400);
    return () => window.clearInterval(id);
  }, []);

  const sides: Side[] = ["p1", "p2"];

  return (
    <Section id="ticker" title="StatusTicker" note="Activity only — never content">
      <div className="grid grid-cols-2 gap-8 max-md:grid-cols-1">
        {sides.map((side) => (
          <div key={side} className="flex flex-col gap-3">
            <Label>{side === "p1" ? "P1 — cross-fading" : "P2 — cross-fading, right aligned"}</Label>
            <div className="border-line clip-lean border bg-surface p-4" data-side={side}>
              <StatusTicker
                status={ALL_STATUSES[index]!}
                side={side}
                align={side === "p2" ? "end" : "start"}
              />
            </div>
          </div>
        ))}
      </div>

      <div>
        <Label>All states</Label>
        <div className="mt-2 grid grid-cols-4 gap-3 max-md:grid-cols-2" data-side="p1">
          {ALL_STATUSES.map((status) => (
            <div key={status.kind} className="border-line clip-lean border bg-surface px-3 py-2.5">
              <StatusTicker status={status} />
            </div>
          ))}
        </div>
      </div>
    </Section>
  );
}
