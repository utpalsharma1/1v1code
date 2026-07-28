"use client";

import { cn } from "../../lib/cn";
import type { CellState, Division, Side, Tier } from "../../lib/types";
import { Clock } from "../Clock";
import { Nameplate, type NameplateState } from "../Nameplate";
import { StatusTicker, type Status } from "../StatusTicker";
import { TestBar } from "../TestBar";
import { CompilePulse } from "./effects";
import { PulseLine } from "./PulseLine";

/**
 * The signature element (§6.4). Fixed to the top of the match screen, always
 * visible, never scrolls away.
 *
 *   P1 nameplate  |      clock      |  nameplate P2
 *   test bar      |  round · mode   |      test bar
 *   pulse line    |    ● ○ ○        |    pulse line
 */

export interface HUDPlayer {
  handle: string;
  rating: number;
  tier: Tier;
  division?: Division;
  cells: CellState[];
  status: Status;
  pulse: number[];
  plate: NameplateState;
  /** Bump to fire the compile shockwave across this player's half. */
  compileKey: number;
  /** Bump to fire the nameplate impact flash. */
  flashKey: number;
}

export interface MatchHUDProps {
  p1: HUDPlayer;
  p2: HUDPlayer;
  totalTests: number;
  clockMs: number;
  clockPending?: boolean;
  round?: number;
  bestOf?: number;
  /** Rounds already won, per side. */
  won?: { p1: number; p2: number };
  mode?: string;
  className?: string;
}

export function MatchHUD({
  p1,
  p2,
  totalTests,
  clockMs,
  clockPending = false,
  round = 1,
  bestOf = 3,
  won = { p1: 0, p2: 0 },
  mode = "RANKED",
  className,
}: MatchHUDProps) {
  return (
    <header
      className={cn(
        "border-line relative z-20 grid w-full items-center gap-6 overflow-hidden border-b bg-surface px-6 py-3",
        "grid-cols-[1fr_auto_1fr] max-md:grid-cols-1 max-md:gap-3",
        className,
      )}
    >
      <CompilePulse side="p1" fireKey={p1.compileKey} />
      <CompilePulse side="p2" fireKey={p2.compileKey} />

      <PlayerColumn side="p1" player={p1} total={totalTests} />

      <div className="flex flex-col items-center gap-1.5 max-md:order-first">
        <Clock ms={clockMs} pending={clockPending} />
        <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
          Round {round} · Bo{bestOf}
        </p>
        <RoundPips bestOf={bestOf} won={won} />
        <p className="font-display text-fg-faint text-12 font-bold tracking-[var(--track-hud)] uppercase">
          {mode}
        </p>
      </div>

      <PlayerColumn side="p2" player={p2} total={totalTests} />
    </header>
  );
}

function PlayerColumn({
  side,
  player,
  total,
}: {
  side: Side;
  player: HUDPlayer;
  total: number;
}) {
  const isP2 = side === "p2";
  return (
    <div data-side={side} className="relative flex min-w-0 flex-col gap-2">
      <div className={cn("flex", isP2 ? "justify-end" : "justify-start")}>
        <Nameplate
          side={side}
          handle={player.handle}
          rating={player.rating}
          tier={player.tier}
          division={player.division}
          state={player.plate}
          flashKey={player.flashKey}
        />
      </div>
      <TestBar side={side} total={total} cells={player.cells} />
      <PulseLine side={side} samples={player.pulse} />
      <StatusTicker status={player.status} side={side} align={isP2 ? "end" : "start"} />
    </div>
  );
}

function RoundPips({ bestOf, won }: { bestOf: number; won: { p1: number; p2: number } }) {
  const pips = Array.from({ length: bestOf }, (_, i) => {
    if (i < won.p1) return "p1" as const;
    if (i >= bestOf - won.p2) return "p2" as const;
    return null;
  });
  return (
    <div className="flex items-center gap-1.5" aria-label="Round score">
      {pips.map((owner, i) => (
        <span
          key={i}
          data-side={owner ?? undefined}
          className={cn(
            "size-2",
            owner ? "bg-player" : "border-line border bg-transparent",
          )}
        />
      ))}
    </div>
  );
}
