"use client";

import type { CSSProperties } from "react";
import { cn } from "../lib/cn";
import type { Division, Tier } from "../lib/types";

export interface RankBadgeProps {
  tier: Tier;
  /** Legend has no divisions (§8). Passing one is ignored. */
  division?: Division;
  size?: "sm" | "md" | "lg";
  /** 0–1 progress toward the next tier. Renders the arc from §7. Ignored at sm. */
  progress?: number;
  /** Tier name beneath the plate. */
  showLabel?: boolean;
  className?: string;
}

// Every tier resolves to --tier (a flat color, for borders/text/glow) and
// --tier-bg (the plate fill). The fill is a heavy mix toward --surface because
// the resting UI stays muted — saturation is a reward (§2 rule 2). Legend is
// the exception: it is the top of the ladder and it gets the real gradient.
const TIER: Record<Tier, string> = {
  iron: "[--tier:var(--iron)]",
  bronze: "[--tier:var(--bronze)]",
  silver: "[--tier:var(--silver)]",
  gold: "[--tier:var(--gold)]",
  platinum: "[--tier:var(--platinum)]",
  diamond: "[--tier:var(--diamond)]",
  master: "[--tier:var(--master)]",
  grandmaster: "[--tier:var(--grandmaster)]",
  legend: "[--tier:var(--legend-flat)]",
};

const SIZE = {
  sm: { box: "size-7", pad: "p-[3px]", text: "text-12", label: "text-12" },
  md: { box: "size-10", pad: "p-[3px]", text: "text-13", label: "text-12" },
  lg: { box: "size-16", pad: "p-[4px]", text: "text-20", label: "text-13" },
} as const;

export function RankBadge({
  tier,
  division,
  size = "md",
  progress,
  showLabel = false,
  className,
}: RankBadgeProps) {
  const s = SIZE[size];
  const isLegend = tier === "legend";
  const showArc = progress !== undefined && size !== "sm";
  const pct = Math.max(0, Math.min(1, progress ?? 0));

  const label = isLegend
    ? "Legend"
    : `${tier[0]!.toUpperCase()}${tier.slice(1)}${division ? ` ${division}` : ""}`;

  // The arc follows the badge silhouette rather than being a circle around it.
  // A circular ring would leave the plate's corners poking through (a 64px
  // square has a 90px diagonal), and §4 rules out fully-rounded shapes anyway.
  // The gradient sits on a clipped parent and the plate covers its middle, so
  // the visible remainder is an angular ring — no mask needed.
  const ringStyle: CSSProperties = {
    background: `conic-gradient(var(--tier) ${pct * 360}deg, var(--line) 0)`,
  };

  return (
    <div
      className={cn("inline-flex flex-col items-center gap-1.5", TIER[tier], className)}
      aria-label={showArc ? `${label}, ${Math.round(pct * 100)}% to next tier` : label}
      role="img"
    >
      <div
        className={cn("clip-lean grid place-items-center", showArc && s.pad)}
        style={showArc ? ringStyle : undefined}
      >
        {/* Plate: leans with whichever side owns it, like every other container. */}
        <div
          className={cn(
            "clip-lean grid place-items-center border border-[var(--tier)]",
            s.box,
            isLegend
              ? "bg-legend"
              : "bg-[color-mix(in_oklab,var(--tier)_20%,var(--surface))]",
          )}
        >
          <span
            className={cn(
              "font-display font-extrabold tracking-[var(--track-display)] tabular-nums",
              s.text,
              isLegend ? "text-ink" : "text-[var(--tier)]",
            )}
          >
            {isLegend ? "◆" : (division ?? "—")}
          </span>
        </div>
      </div>

      {showLabel && (
        <span
          className={cn(
            "font-display text-fg-dim font-bold tracking-[var(--track-hud)] uppercase",
            s.label,
          )}
        >
          {label}
        </span>
      )}
    </div>
  );
}
