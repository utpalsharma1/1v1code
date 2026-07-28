"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../lib/cn";
import type { Side } from "../lib/types";

export interface CardProps extends ComponentPropsWithoutRef<"div"> {
  tone?: "surface" | "elevated";
  /** Owned cards take the player's border + glow (§4). */
  owned?: boolean;
  side?: Side;
  /** Clipped corners for primary containers; plain 8px radius for the rest. */
  clip?: boolean;
  title?: string;
  /** Right-hand slot in the header rule. */
  aside?: ReactNode;
}

export function Card({
  tone = "surface",
  owned = false,
  side,
  clip = true,
  title,
  aside,
  className,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      data-side={side}
      className={cn(
        "relative border",
        clip ? "clip-lean" : "rounded-card",
        tone === "surface" ? "bg-surface" : "bg-elevated",
        owned
          ? "border-player shadow-[0_0_var(--glow-r)_var(--player-glow)]"
          : "border-line",
        className,
      )}
      {...rest}
    >
      {(title ?? aside) && (
        <header className="border-line flex items-center justify-between gap-3 border-b px-4 py-2.5">
          {title && (
            <h3 className="font-display text-fg-dim text-12 font-bold tracking-[var(--track-hud)] uppercase">
              {title}
            </h3>
          )}
          {aside}
        </header>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
