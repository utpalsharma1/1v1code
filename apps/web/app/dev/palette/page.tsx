"use client";

import { useEffect, useState } from "react";
import { Button, Card, cn } from "@1v1/ui";
import { chroma, contrast, simulate } from "./color";
import "../palettes.css";

type PaletteId = "current" | "final" | "riso" | "oxide" | "cabinet";
type Grain = "off" | "grain" | "dither";

interface Palette {
  id: PaletteId;
  name: string;
  ref: string;
  note: string;
}

/** The live decision: master's palette against the proposal. */
const PRIMARY: Palette[] = [
  {
    id: "current",
    name: "Current (master)",
    ref: "Phase 0 — blue-black ground, blue-white text",
    note: "Shipped palette. Same glow rules as Final, so the only variable here is color.",
  },
  {
    id: "final",
    name: "D · Final",
    ref: "Phase 0 hues at -5% lightness on a warm charcoal ground",
    note: "Electric players, quiet warm ground, restrained glow, grain.",
  },
];

/** Kept so the rejected direction stays inspectable rather than just described. */
const REJECTED: Palette[] = [
  {
    id: "riso",
    name: "A · Riso",
    ref: "Risograph spot inks — Hunter Green #407060 / Wine #914E72",
    note: "Rejected: riso is a quiet print medium, the product is a fighting game.",
  },
  {
    id: "oxide",
    name: "B · Oxide",
    ref: "Hyper Light Drifter — aubergine ground, oxidized copper",
    note: "Rejected with A — muting the players was the wrong variable.",
  },
  {
    id: "cabinet",
    name: "C · Cabinet",
    ref: "Sun-faded arcade cabinet sideart",
    note: "Rejected with A — lowest chroma, furthest from the brief.",
  },
];

const ALL = [...PRIMARY, ...REJECTED];

const SWATCHES = [
  "--ink",
  "--surface",
  "--elevated",
  "--line",
  "--text",
  "--text-dim",
  "--text-faint",
  "--p1",
  "--p2",
  "--clock",
  "--fail",
  "--info",
] as const;

const CHECKS: { label: string; fg: string; bg: string; min: number }[] = [
  { label: "text on ink", fg: "--text", bg: "--ink", min: 7 },
  { label: "text-dim on surface", fg: "--text-dim", bg: "--surface", min: 4.5 },
  { label: "text-faint on surface", fg: "--text-faint", bg: "--surface", min: 3.4 },
  { label: "P1 as text on surface", fg: "--p1", bg: "--surface", min: 4.5 },
  { label: "P2 as text on surface", fg: "--p2", bg: "--surface", min: 4.5 },
  { label: "ink on P1 (solid button)", fg: "--ink", bg: "--p1", min: 4.5 },
  { label: "ink on P2 (solid button)", fg: "--ink", bg: "--p2", min: 4.5 },
  { label: "clock on ink", fg: "--clock", bg: "--ink", min: 3 },
  { label: "fail on surface", fg: "--fail", bg: "--surface", min: 4.5 },
  { label: "info on surface", fg: "--info", bg: "--surface", min: 4.5 },
];

type Resolved = Partial<Record<PaletteId, Record<string, string>>>;

const cols = (n: number, first: string) => ({
  gridTemplateColumns: `${first} repeat(${n}, minmax(0, 1fr))`,
});

export default function PalettePage() {
  const [grain, setGrain] = useState<Grain>("grain");
  const [zoom, setZoom] = useState(0.5);
  const [solo, setSolo] = useState<PaletteId | null>(null);
  const [showRejected, setShowRejected] = useState(false);
  const [resolved, setResolved] = useState<Resolved>({});

  // Read the palettes back out of CSS rather than duplicating hex in TS.
  // palettes.css stays the single source of truth for every candidate.
  useEffect(() => {
    const out: Resolved = {};
    for (const p of ALL) {
      const el = document.querySelector<HTMLElement>(`[data-probe="${p.id}"]`);
      if (!el) continue;
      const cs = getComputedStyle(el);
      out[p.id] = Object.fromEntries(
        SWATCHES.map((token) => [token, cs.getPropertyValue(token).trim()]),
      );
    }
    setResolved(out);
  }, []);

  const listed = showRejected ? ALL : PRIMARY;
  const shown = solo ? ALL.filter((p) => p.id === solo) : listed;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-10 px-6 py-10">
      {/* Hidden probes: each carries a palette so getComputedStyle can read it. */}
      <div className="hidden">
        {ALL.map((p) => (
          <div
            key={p.id}
            data-probe={p.id}
            {...(p.id === "current" ? {} : { "data-palette": p.id })}
          />
        ))}
      </div>

      <header className="flex flex-col gap-4">
        <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
          Palette pass · revision 2
        </p>
        <h1 className="font-display text-fg text-34 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
          Current vs Final
        </h1>
        <p className="text-fg-dim max-w-3xl text-14 leading-relaxed">
          <span className="text-fg">D · Final</span> keeps the four things the first pass got right
          — warm ground, bone text, halved glow, grain — and reverts the one it got wrong: the
          players are electric again. Both frames below run the same audited glow rules, so the
          only variable between them is color. Nothing is applied yet;{" "}
          <span className="text-fg">tokens.css still holds the Phase 0 values</span>.
        </p>
      </header>

      {/* ── Controls ──────────────────────────────────────────────────────── */}
      <div className="border-line flex flex-wrap items-end gap-8 border-y py-4">
        <ControlGroup label="Texture">
          {(["off", "grain", "dither"] as Grain[]).map((g) => (
            <Button
              key={g}
              size="sm"
              variant={grain === g ? "solid" : "outline"}
              tone={grain === g ? "player" : "neutral"}
              onClick={() => setGrain(g)}
            >
              {g}
            </Button>
          ))}
        </ControlGroup>

        <ControlGroup label="Zoom">
          {[0.5, 0.75, 1].map((z) => (
            <Button
              key={z}
              size="sm"
              variant={zoom === z ? "solid" : "outline"}
              tone={zoom === z ? "player" : "neutral"}
              onClick={() => setZoom(z)}
            >
              {z * 100}%
            </Button>
          ))}
        </ControlGroup>

        <ControlGroup label="View">
          <Button
            size="sm"
            variant={solo === null ? "solid" : "outline"}
            tone={solo === null ? "player" : "neutral"}
            onClick={() => setSolo(null)}
          >
            Side by side
          </Button>
          {(showRejected ? ALL : PRIMARY).map((p) => (
            <Button
              key={p.id}
              size="sm"
              variant={solo === p.id ? "solid" : "outline"}
              tone={solo === p.id ? "player" : "neutral"}
              onClick={() => setSolo(p.id)}
            >
              {p.name}
            </Button>
          ))}
        </ControlGroup>

        <ControlGroup label="Rejected candidates">
          <Button
            size="sm"
            variant={showRejected ? "solid" : "outline"}
            tone={showRejected ? "player" : "neutral"}
            onClick={() => {
              setShowRejected((v) => !v);
              setSolo(null);
            }}
          >
            {showRejected ? "Hide A/B/C" : "Show A/B/C"}
          </Button>
        </ControlGroup>
      </div>

      {/* ── Swatches ──────────────────────────────────────────────────────── */}
      <section>
        <SectionTitle>Swatches</SectionTitle>
        <div className="overflow-x-auto">
          <div
            className="grid min-w-[560px] gap-x-4"
            style={cols(listed.length, "160px")}
          >
            <div />
            {listed.map((p) => (
              <div key={p.id} className="pb-3">
                <p className="font-display text-fg text-13 font-bold tracking-[var(--track-hud)] uppercase">
                  {p.name}
                </p>
                <p className="text-fg-faint mt-1 text-12 leading-snug">{p.ref}</p>
              </div>
            ))}

            {SWATCHES.map((token) => (
              <Row key={token} token={token} palettes={listed} resolved={resolved} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Contrast + CVD ────────────────────────────────────────────────── */}
      <section>
        <SectionTitle>Contrast &amp; colorblind separation</SectionTitle>
        <p className="text-fg-dim mb-4 max-w-3xl text-13 leading-relaxed">
          Computed live from the CSS above. The -5% lightness drop is not cosmetic: it raises
          deuteranopia separation from 1.70 to 2.02 and pulls <span className="tabular">--fail</span>{" "}
          away from P2 (1.24 to 1.60). Dropping only P1 would have landed at 1.56, under the floor.
        </p>
        <div className="overflow-x-auto">
          <div
            className="grid min-w-[560px] gap-x-4 gap-y-1"
            style={cols(listed.length, "220px")}
          >
            <div />
            {listed.map((p) => (
              <p
                key={p.id}
                className="font-display text-fg-dim pb-2 text-12 font-bold tracking-[var(--track-hud)] uppercase"
              >
                {p.name}
              </p>
            ))}

            {CHECKS.map((check) => (
              <CheckRow
                key={check.label}
                check={check}
                palettes={listed}
                resolved={resolved}
              />
            ))}

            <MetricRow
              label="P1/P2 sep — deuteranopia (floor 1.70)"
              palettes={listed}
              resolved={resolved}
              compute={(t) =>
                contrast(
                  simulate(t["--p1"] ?? "", "deut") ?? "",
                  simulate(t["--p2"] ?? "", "deut") ?? "",
                )
              }
              floor={1.7}
            />
            <MetricRow
              label="P1/P2 sep — protanopia"
              palettes={listed}
              resolved={resolved}
              compute={(t) =>
                contrast(
                  simulate(t["--p1"] ?? "", "prot") ?? "",
                  simulate(t["--p2"] ?? "", "prot") ?? "",
                )
              }
            />
            <MetricRow
              label="chroma — P1"
              palettes={listed}
              resolved={resolved}
              compute={(t) => chroma(t["--p1"] ?? "")}
              digits={3}
            />
            <MetricRow
              label="chroma — P2"
              palettes={listed}
              resolved={resolved}
              compute={(t) => chroma(t["--p2"] ?? "")}
              digits={3}
            />
            <MetricRow
              label="chroma — ground (--ink)"
              palettes={listed}
              resolved={resolved}
              compute={(t) => chroma(t["--ink"] ?? "")}
              digits={3}
            />
          </div>
        </div>
      </section>

      {/* ── Live previews ─────────────────────────────────────────────────── */}
      <section>
        <SectionTitle>The kitchen sink, rendered</SectionTitle>
        <p className="text-fg-dim mb-4 text-13">
          Each frame is a real document at 1280px, so the desktop layout is what you are judging.
          They scroll independently.
        </p>
        <div className={cn("grid gap-6", solo ? "grid-cols-1" : "grid-cols-2 max-xl:grid-cols-1")}>
          {shown.map((p) => (
            <figure key={p.id} className="flex min-w-0 flex-col gap-2">
              <figcaption className="flex items-baseline justify-between gap-3">
                <span className="font-display text-fg text-14 font-bold tracking-[var(--track-display)] uppercase">
                  {p.name}
                </span>
                <span className="text-fg-faint text-12">{p.note}</span>
              </figcaption>
              <div className="border-line overflow-hidden border bg-ink">
                <iframe
                  key={`${p.id}-${grain}`}
                  title={p.name}
                  src={`/dev/kitchen-sink?palette=${p.id}&grain=${grain}`}
                  style={{ zoom }}
                  className="block h-[1500px] w-[1280px] border-0"
                />
              </div>
            </figure>
          ))}
        </div>
      </section>

      <Card title="Glow audit" className="max-w-3xl">
        <p className="text-fg-dim text-13 leading-relaxed">
          Every glow in the codebase, after the audit — verified by reading the built CSS, not the
          source:
        </p>
        <ul className="text-fg-dim mt-3 flex flex-col gap-1.5 text-13">
          <li>
            <span className="text-player">hover</span> — Button, player tone only. Neutral and fail
            tones resolve <span className="tabular">--tone-glow</span> to transparent.
          </li>
          <li>
            <span className="text-player">event</span> — Nameplate <span className="tabular">winner</span>,
            at <span className="tabular">--glow-r-lg</span>.
          </li>
          <li>
            <span className="text-clock">10s state</span> — Clock under ten seconds, halved with
            everything else.
          </li>
          <li>
            <span className="text-fg-faint">removed</span> — Card <span className="tabular">owned</span>{" "}
            and Nameplate <span className="tabular">active</span> both glowed for the entire match.
            Ownership now reads through the player border and the lean.
          </li>
        </ul>
      </Card>
    </div>
  );
}

/* ── Bits ────────────────────────────────────────────────────────────────── */

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-display text-fg border-line mb-4 border-b pb-2 text-20 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
      {children}
    </h2>
  );
}

function ControlGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="font-display text-fg-faint mb-2 text-12 font-bold tracking-[var(--track-hud)] uppercase">
        {label}
      </p>
      <div className="flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function Row({
  token,
  palettes,
  resolved,
}: {
  token: string;
  palettes: Palette[];
  resolved: Resolved;
}) {
  return (
    <>
      <div className="tabular text-fg-faint flex items-center py-1 text-12">{token}</div>
      {palettes.map((p) => {
        const value = resolved[p.id]?.[token] ?? "";
        return (
          <div key={p.id} className="flex items-center gap-2 py-1">
            <span
              className="border-line size-6 shrink-0 border"
              style={{ background: value || "transparent" }}
            />
            <span className="tabular text-fg-dim text-12 uppercase">{value || "—"}</span>
          </div>
        );
      })}
    </>
  );
}

function CheckRow({
  check,
  palettes,
  resolved,
}: {
  check: (typeof CHECKS)[number];
  palettes: Palette[];
  resolved: Resolved;
}) {
  return (
    <>
      <div className="text-fg-dim py-0.5 text-12">{check.label}</div>
      {palettes.map((p) => {
        const tokens = resolved[p.id];
        const value = tokens ? contrast(tokens[check.fg] ?? "", tokens[check.bg] ?? "") : null;
        const pass = value !== null && value >= check.min;
        return (
          <div key={p.id} className="tabular py-0.5 text-12">
            <span className={pass ? "text-player" : "text-fail"}>
              {value === null ? "—" : value.toFixed(2)}
            </span>
            <span className="text-fg-faint"> / {check.min}</span>
          </div>
        );
      })}
    </>
  );
}

function MetricRow({
  label,
  palettes,
  resolved,
  compute,
  digits = 2,
  floor,
}: {
  label: string;
  palettes: Palette[];
  resolved: Resolved;
  compute: (tokens: Record<string, string>) => number | null;
  digits?: number;
  floor?: number;
}) {
  return (
    <>
      <div className="text-fg-faint border-line mt-1 border-t pt-1 text-12">{label}</div>
      {palettes.map((p) => {
        const tokens = resolved[p.id];
        const value = tokens ? compute(tokens) : null;
        const under = floor !== undefined && value !== null && value < floor;
        return (
          <div
            key={p.id}
            className={cn(
              "tabular border-line mt-1 border-t pt-1 text-12",
              under ? "text-fail" : "text-fg-dim",
            )}
          >
            {value === null ? "—" : value.toFixed(digits)}
          </div>
        );
      })}
    </>
  );
}
