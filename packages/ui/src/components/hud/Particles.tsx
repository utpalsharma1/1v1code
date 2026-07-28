"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "../../lib/motion-pref";
import { useMotion } from "../../lib/motion-tuning";

/**
 * Gravity-affected particle burst on canvas (§6.6, §6.7). The only canvas 2D in
 * the product besides the pulse line, and the only place particles are allowed.
 *
 * Disabled outright under reduced motion — §5 says disable particles, not
 * shorten them.
 */
export interface ParticlesProps {
  /** Bump to fire. 0 never fires. */
  fireKey: number;
  count?: number;
  /** CSS color, or a var() reference resolved against this canvas. */
  color?: string;
  /** Fraction of canvas width/height for the origin. */
  originX?: number;
  originY?: number;
  /** Milliseconds the burst lives. */
  life?: number;
  spread?: number;
  className?: string;
}

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  born: number;
}

export function Particles({
  fireKey,
  count = 200,
  color = "var(--player)",
  originX = 0.5,
  originY = 0.5,
  life = 1600,
  spread = 1,
  className,
}: ParticlesProps) {
  const ref = useRef<HTMLCanvasElement>(null);
  const raf = useRef<number>(0);
  const reduced = useReducedMotion();
  const m = useMotion();
  const speed = m.speed;

  useEffect(() => {
    if (fireKey === 0 || reduced) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const resolved = color.startsWith("var(")
      ? getComputedStyle(canvas).getPropertyValue(color.slice(4, -1)).trim() || "#3ddc97"
      : color;

    const ox = w * originX;
    const oy = h * originY;
    const start = performance.now();
    const duration = life / speed;

    const parts: P[] = Array.from({ length: count }, () => {
      const angle = Math.random() * Math.PI * 2;
      const power = (2.5 + Math.random() * 7) * spread;
      return {
        x: ox,
        y: oy,
        vx: Math.cos(angle) * power,
        vy: Math.sin(angle) * power - 2,
        r: 1 + Math.random() * 2.2,
        born: Math.random() * 120,
      };
    });

    const gravity = 0.16;
    let last = start;

    const frame = (now: number) => {
      const elapsed = now - start;
      // Normalise to 60fps steps so the burst looks the same on any display,
      // and so the global speed control actually changes the tempo.
      const dt = Math.min(3, ((now - last) / 16.67) * speed);
      last = now;

      ctx.clearRect(0, 0, w, h);
      const t = elapsed / duration;
      if (t >= 1) {
        raf.current = 0;
        return;
      }

      for (const p of parts) {
        if (elapsed < p.born) continue;
        p.vy += gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        ctx.globalAlpha = Math.max(0, 1 - t) ** 1.6;
        ctx.fillStyle = resolved;
        ctx.fillRect(p.x, p.y, p.r, p.r);
      }
      ctx.globalAlpha = 1;
      raf.current = requestAnimationFrame(frame);
    };

    raf.current = requestAnimationFrame(frame);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      ctx.clearRect(0, 0, w, h);
    };
  }, [fireKey, reduced, count, color, originX, originY, life, spread, speed]);

  return <canvas ref={ref} aria-hidden className={className} />;
}
