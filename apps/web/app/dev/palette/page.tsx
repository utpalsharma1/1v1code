"use client";

import { useEffect, useState } from "react";
import { Button, Card, cn } from "@1v1/ui";
import { chroma, contrast, simulate } from "./color";
import "../palettes.css";

type PaletteId = "current" | "riso" | "oxide" | "cabinet";
type Grain = "off" | "grain" | "dither";

const PALETTES: { id: PaletteId; name: string; ref: string; note: string }[] = [
  {
    id: "current",
    name: "Current",
    ref: "Phase 0 — generated",
    note: "Here for comparison. Full-chroma jade and hot pink on blue-black.",
  },
  {
    id: "riso",
    name: "A · Riso",
    ref: "Risograph spot inks — Hunter Green #407060 / Wine #914E72",
    note: "Soy ink on uncoated stock. Flattest and warmest. Physically incapable of neon.",
  },
  {
    id: "oxide",
    name: "B · Oxide",
    ref: "Hyper Light Drifter — aubergine ground, oxidized copper",
    note: "Most chroma of the three. Reads most obviously as a game.",
  },
  {
    id: "cabinet",
    name: "C · Cabinet",
    ref: "Sun-faded arcade cabinet sideart",
    note: "Lowest chroma. Chalky sage and faded rose on warm neutral grey.",
  },
];

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

type Resolved = Record<PaletteId, Record<string, string>>;

export default function PalettePage() {
  const [grain, setGrain] = useState<Grain>("grain");
  const [zoom, setZoom] = useState(0.5);
  const [solo, setSolo] = useState<PaletteId | null>(null);
  const [resolved, setResolved] = useState<Resolved | null>(null);

  // Read the palettes back out of CSS rather than duplicating hex in TS.
  // palettes.css stays the single source of truth for the candidates.
  useEffect(() => {
    const out = {} as Resolved;
    for (const p of PALETTES) {
      const el = document.querySelector<HTMLElement>(`[data-probe="${p.id}"]`);
      if (!el) continue;
      const cs = getComputedStyle(el);
      out[p.id] = Object.fromEntries(
        SWATCHES.map((token) => [token, cs.getPropertyValue(token).trim()]),
      );
    }
    setResolved(out);
  }, []);

  const shown = solo ? PALETTES.filter((p) => p.id === solo) : PALETTES;

  return (
    <div className="mx-auto flex max-w-[1440px] flex-col gap-10 px-6 py-10">
      {/* Hidden probes: each carries a palette so getComputedStyle can read it. */}
      <div className="hidden">
        {PALETTES.map((p) => (
          <div
            key={p.id}
            data-probe={p.id}
            {...(p.id === "current" ? {} : { "data-palette": p.id })}
          />
        ))}
      </div>

      <header className="flex flex-col gap-4">
        <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
          Palette pass · proposal
        </p>
        <h1 className="font-display text-fg text-34 leading-none font-extrabold tracking-[var(--track-display)] uppercase">
          Pick a palette
        </h1>
        <p className="text-fg-dim max-w-3xl text-14 leading-relaxed">
          Three candidates, each grounded in a named reference rather than generated. All of them
          halve the glow radius (24px → 12px), pull chroma down by roughly half to three-quarters,
          warm the base off blue, and swap blue-white text for bone. Nothing here is applied yet —
          <span className="text-fg"> tokens.css is untouched</span>. These are scoped overrides in{" "}
          <span className="tabular text-fg">app/dev/palettes.css</span>.
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
            All
          </Button>
          {PALETTES.map((p) => (
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
      </div>

      {/* ── Swatches ──────────────────────────────────────────────────────── */}
      <section>
        <SectionTitle>Swatches</SectionTitle>
        <div className="overflow-x-auto">
          <div className="grid min-w-[720px] grid-cols-[160px_repeat(4,1fr)] gap-x-4">
            <div />
            {PALETTES.map((p) => (
              <div key={p.id} className="pb-3">
                <p className="font-display text-fg text-13 font-bold tracking-[var(--track-hud)] uppercase">
                  {p.name}
                </p>
                <p className="text-fg-faint mt-1 text-12 leading-snug">{p.ref}</p>
              </div>
            ))}

            {SWATCHES.map((token) => (
              <Row key={token} token={token} resolved={resolved} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Contrast + CVD ────────────────────────────────────────────────── */}
      <section>
        <SectionTitle>Contrast &amp; colorblind separation</SectionTitle>
        <p className="text-fg-dim mb-4 max-w-3xl text-13 leading-relaxed">
          Computed live from the CSS above. Muting both players to the same lightness collapses
          their separation under deuteranopia, so P1 is deliberately kept lighter than P2 in every
          candidate. §4&apos;s other three carriers — side, label, hatch — still do most of the work.
        </p>
        <div className="overflow-x-auto">
          <div className="grid min-w-[720px] grid-cols-[220px_repeat(4,1fr)] gap-x-4 gap-y-1">
            <div />
            {PALETTES.map((p) => (
              <p
                key={p.id}
                className="font-display text-fg-dim pb-2 text-12 font-bold tracking-[var(--track-hud)] uppercase"
              >
                {p.name}
              </p>
            ))}

            {CHECKS.map((check) => (
              <CheckRow key={check.label} check={check} resolved={resolved} />
            ))}

            <MetricRow
              label="P1/P2 sep — normal"
              resolved={resolved}
              compute={(t) => contrast(t["--p1"] ?? "", t["--p2"] ?? "")}
            />
            <MetricRow
              label="P1/P2 sep — deuteranopia"
              resolved={resolved}
              compute={(t) =>
                contrast(
                  simulate(t["--p1"] ?? "", "deut") ?? "",
                  simulate(t["--p2"] ?? "", "deut") ?? "",
                )
              }
            />
            <MetricRow
              label="P1/P2 sep — protanopia"
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
              resolved={resolved}
              compute={(t) => chroma(t["--p1"] ?? "")}
              digits={3}
            />
            <MetricRow
              label="chroma — P2"
              resolved={resolved}
              compute={(t) => chroma(t["--p2"] ?? "")}
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

      <Card title="What happens next" className="max-w-3xl">
        <p className="text-fg-dim text-13 leading-relaxed">
          Tell me which one — and whether you want grain, dither, or neither. I&apos;ll fold the
          winner into <span className="tabular text-fg">packages/ui/tokens.css</span>, update
          CLAUDE.md §4 to match, delete{" "}
          <span className="tabular text-fg">app/dev/palettes.css</span> and this route, and stop.
          Still no Phase 1.
        </p>
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

function Row({ token, resolved }: { token: string; resolved: Resolved | null }) {
  return (
    <>
      <div className="tabular text-fg-faint flex items-center py-1 text-12">{token}</div>
      {PALETTES.map((p) => {
        const value = resolved?.[p.id]?.[token] ?? "";
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
  resolved,
}: {
  check: (typeof CHECKS)[number];
  resolved: Resolved | null;
}) {
  return (
    <>
      <div className="text-fg-dim py-0.5 text-12">{check.label}</div>
      {PALETTES.map((p) => {
        const tokens = resolved?.[p.id];
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
  resolved,
  compute,
  digits = 2,
}: {
  label: string;
  resolved: Resolved | null;
  compute: (tokens: Record<string, string>) => number | null;
  digits?: number;
}) {
  return (
    <>
      <div className="text-fg-faint border-line mt-1 border-t pt-1 text-12">{label}</div>
      {PALETTES.map((p) => {
        const tokens = resolved?.[p.id];
        const value = tokens ? compute(tokens) : null;
        return (
          <div
            key={p.id}
            className="tabular text-fg-dim border-line mt-1 border-t pt-1 text-12"
          >
            {value === null ? "—" : value.toFixed(digits)}
          </div>
        );
      })}
    </>
  );
}
