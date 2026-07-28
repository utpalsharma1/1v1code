"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "../lib/cn";
import { useInteractive } from "../lib/interactive";
import type { Side } from "../lib/types";

type Variant = "solid" | "outline" | "ghost";
/** `player` inherits the nearest [data-side]; the local player is P1 by default. */
type Tone = "player" | "neutral" | "fail";
type Size = "sm" | "md" | "lg";

// Extends the Framer props rather than React's: on a motion element the drag
// and animation handlers have Framer's signatures, not the DOM's.
// `children` is narrowed back to ReactNode — Framer widens it to accept a
// MotionValue, which a button label never is.
export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  children?: ReactNode;
  variant?: Variant;
  tone?: Tone;
  size?: Size;
  side?: Side;
  full?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
}

// Small controls take the 8px cut — 12px would eat into the label. Large ones
// take the full 12px so the signature silhouette reads at PLAY-button scale.
const SIZE: Record<Size, string> = {
  sm: "h-8 px-3 text-12 gap-1.5 clip-lean-sm",
  md: "h-10 px-5 text-13 gap-2 clip-lean-sm",
  lg: "h-14 px-8 text-16 gap-2.5 clip-lean",
};

// Each tone resolves to one CSS variable so the variant styles below stay
// tone-agnostic. --tone-glow only exists for the player tone; neutral and fail
// don't glow, because glow means "this belongs to someone" (§4).
const TONE: Record<Tone, string> = {
  player: "[--tone:var(--player)] [--tone-glow:var(--player-glow)]",
  neutral: "[--tone:var(--line-hot)] [--tone-glow:transparent]",
  fail: "[--tone:var(--fail)] [--tone-glow:transparent]",
};

const VARIANT: Record<Variant, string> = {
  solid: cn(
    "bg-[var(--tone)] text-ink border border-[var(--tone)]",
    "hover:shadow-[0_0_24px_var(--tone-glow)]",
  ),
  outline: cn(
    "bg-transparent text-fg border border-line",
    "hover:border-[var(--tone)] hover:text-[var(--tone)]",
    "hover:shadow-[0_0_24px_var(--tone-glow)]",
  ),
  ghost: cn(
    "bg-transparent text-fg-dim border border-transparent",
    "hover:bg-elevated hover:text-fg",
  ),
};

export function Button({
  variant = "outline",
  tone = "neutral",
  size = "md",
  side,
  full = false,
  leading,
  trailing,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const press = useInteractive(disabled);

  return (
    <motion.button
      data-side={side}
      disabled={disabled}
      className={cn(
        "focus-ring relative inline-flex items-center justify-center",
        "font-display font-bold uppercase tracking-[var(--track-display)] whitespace-nowrap",
        "transition-colors duration-[160ms] select-none",
        "disabled:pointer-events-none disabled:opacity-40",
        SIZE[size],
        TONE[tone],
        VARIANT[variant],
        full && "w-full",
        className,
      )}
      {...press}
      {...rest}
    >
      {leading}
      {children}
      {trailing}
    </motion.button>
  );
}
