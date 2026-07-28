"use client";

import { useEffect, useRef } from "react";
import { cn } from "../../lib/cn";
import type { Side } from "../../lib/types";

/**
 * Opponent keystroke rate over the last 60 seconds (§6.4).
 *
 * The most original thing in the product: it shows thinking pauses versus
 * typing bursts without ever leaking a character of code. Canvas only — this
 * redraws several times a second for the whole match and must never touch
 * layout.
 *
 * Time runs toward the center of the HUD: left-to-right for P1, right-to-left
 * for P2, so the newest sample on both sides is the innermost one.
 */
export interface PulseLineProps {
  side: Side;
  /** Normalised 0–1 samples, oldest first. */
  samples: number[];
  className?: string;
  height?: number;
}

export function PulseLine({ side, samples, className, height = 22 }: PulseLineProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Canvas can't read CSS variables, so pull the resolved player color off
    // the element — it inherits [data-side] like everything else.
    const styles = getComputedStyle(canvas);
    const player = styles.getPropertyValue("--player").trim() || "#3ddc97";
    const line = styles.getPropertyValue("--line").trim() || "#232e42";

    // Baseline
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, h - 0.5);
    ctx.lineTo(w, h - 0.5);
    ctx.stroke();

    if (samples.length < 2) return;

    const n = samples.length;
    const stepX = w / (n - 1);
    const xAt = (i: number) => (side === "p2" ? w - i * stepX : i * stepX);
    const yAt = (v: number) => h - 1 - Math.max(0, Math.min(1, v)) * (h - 3);

    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(samples[0]!));
    for (let i = 1; i < n; i++) ctx.lineTo(xAt(i), yAt(samples[i]!));

    // Faint fill under the trace, then the trace itself.
    ctx.save();
    ctx.lineTo(xAt(n - 1), h);
    ctx.lineTo(xAt(0), h);
    ctx.closePath();
    ctx.globalAlpha = 0.14;
    ctx.fillStyle = player;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(samples[0]!));
    for (let i = 1; i < n; i++) ctx.lineTo(xAt(i), yAt(samples[i]!));
    ctx.strokeStyle = player;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Leading dot on the newest sample, so a burst is readable at a glance.
    const lastX = xAt(n - 1);
    const lastY = yAt(samples[n - 1]!);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 1.8, 0, Math.PI * 2);
    ctx.fillStyle = player;
    ctx.fill();
  }, [samples, side]);

  return (
    <canvas
      ref={ref}
      data-side={side}
      style={{ height }}
      className={cn("block w-full", className)}
      aria-hidden
    />
  );
}
