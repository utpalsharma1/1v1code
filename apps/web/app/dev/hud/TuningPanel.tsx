"use client";

import { useState } from "react";
import {
  Button,
  DEFAULT_VALUES,
  cn,
  sound,
  toMotionSource,
  useMotionPref,
  useMotionTuning,
  type Cubic,
  type DurKey,
  type EaseKey,
  type SpringKey,
} from "@1v1/ui";

/* ============================================================================
   The tuning surface.

   The point of Phase 1 is not playback, it is *feel*. Every number in motion.ts
   is editable here; when it feels right, "Copy motion.ts" emits the values as
   source ready to paste back. motion.ts stays the source of truth for defaults.
   ========================================================================= */

const DUR_KEYS: DurKey[] = ["instant", "fast", "base", "slow", "cine", "flash", "decay"];
const EASE_KEYS: EaseKey[] = ["out", "inOut", "snap"];
const SPRING_KEYS: SpringKey[] = ["ui", "bar", "heavy"];

const EASE_NOTE: Record<EaseKey, string> = {
  out: "entrances",
  inOut: "moves & transforms",
  snap: "overshoot — buttons, pops",
};
const SPRING_NOTE: Record<SpringKey, string> = {
  ui: "small UI",
  bar: "test bars",
  heavy: "cinematic panels",
};

export function TuningPanel() {
  const { values, setValues, speed, setSpeed, reset } = useMotionTuning();
  const { pref, setPref } = useMotionPref();
  const [copied, setCopied] = useState(false);
  const [muted, setMuted] = useState(sound.muted);
  const [volume, setVolume] = useState(sound.volume);

  const patch = (fn: (draft: typeof values) => void) => {
    const next = structuredClone(values);
    fn(next);
    setValues(next);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(toMotionSource(values));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const dirty = JSON.stringify(values) !== JSON.stringify(DEFAULT_VALUES);

  return (
    <div className="flex flex-col gap-6">
      <Group title="Playback">
        <Slider
          label="Speed"
          value={speed}
          min={0.25}
          max={2}
          step={0.05}
          suffix="×"
          decimals={2}
          onChange={setSpeed}
        />
        <p className="text-fg-faint text-12 leading-snug">
          Scales time properly: durations by 1/speed, spring stiffness by speed² and damping by
          speed, so the damping ratio holds and you change tempo without changing bounce.
        </p>
        <div className="flex flex-wrap gap-1 pt-1">
          {(["auto", "full", "reduced"] as const).map((option) => (
            <Button
              key={option}
              size="sm"
              variant={pref === option ? "solid" : "outline"}
              tone={pref === option ? "player" : "neutral"}
              onClick={() => setPref(option)}
            >
              {option}
            </Button>
          ))}
        </div>
        <p className="text-fg-faint text-12 leading-snug">
          Reduced motion replaces every movement with a 120ms fade, disables particles and screen
          shake, and stops the radar and clutch loops.
        </p>
      </Group>

      <Group title="Sound (placeholder)">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={muted ? "outline" : "solid"}
            tone={muted ? "neutral" : "player"}
            onClick={() => {
              const next = !muted;
              setMuted(next);
              sound.setMuted(next);
            }}
          >
            {muted ? "Muted" : "On"}
          </Button>
        </div>
        <Slider
          label="volume"
          value={volume}
          min={0}
          max={1}
          step={0.05}
          decimals={2}
          onChange={(v) => {
            setVolume(v);
            sound.setVolume(v);
          }}
        />
        <p className="text-fg-faint text-12 leading-snug">
          Six crude Web Audio oscillator tones, no asset files — countdown tick, final tick, test
          pass (pitch rises per consecutive pass), test fail, submit, victory. Pulled forward from
          Phase 4 only because §6.3 and §6.6 are timed to rhythm. The real library is still Phase 4.
        </p>
      </Group>

      <Group title="Durations (ms)">
        {DUR_KEYS.map((key) => (
          <Slider
            key={key}
            label={key}
            value={values.dur[key]}
            min={20}
            max={key === "cine" ? 2400 : 1200}
            step={10}
            onChange={(v) => patch((d) => void (d.dur[key] = v))}
          />
        ))}
      </Group>

      <Group title="Easing (cubic-bezier)">
        {EASE_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-fg text-12 font-bold tracking-[var(--track-hud)] uppercase">
                {key}
              </span>
              <span className="text-fg-faint text-12">{EASE_NOTE[key]}</span>
            </div>
            <div className="grid grid-cols-4 gap-1">
              {values.ease[key].map((n, i) => (
                <input
                  key={i}
                  type="number"
                  step={0.01}
                  value={n}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isNaN(v)) return;
                    patch((d) => {
                      const next = [...d.ease[key]] as Cubic;
                      next[i] = v;
                      d.ease[key] = next;
                    });
                  }}
                  className="focus-ring tabular border-line text-fg min-w-0 border bg-elevated px-1.5 py-1 text-12"
                />
              ))}
            </div>
            <BezierPreview curve={values.ease[key]} />
          </div>
        ))}
      </Group>

      <Group title="Springs">
        {SPRING_KEYS.map((key) => (
          <div key={key} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between">
              <span className="font-display text-fg text-12 font-bold tracking-[var(--track-hud)] uppercase">
                {key}
              </span>
              <span className="text-fg-faint text-12">{SPRING_NOTE[key]}</span>
            </div>
            <Slider
              label="stiffness"
              value={values.spring[key].stiffness}
              min={20}
              max={600}
              step={5}
              onChange={(v) => patch((d) => void (d.spring[key].stiffness = v))}
            />
            <Slider
              label="damping"
              value={values.spring[key].damping}
              min={4}
              max={60}
              step={1}
              onChange={(v) => patch((d) => void (d.spring[key].damping = v))}
            />
            {values.spring[key].mass !== undefined && (
              <Slider
                label="mass"
                value={values.spring[key].mass!}
                min={0.2}
                max={3}
                step={0.05}
                decimals={2}
                onChange={(v) => patch((d) => void (d.spring[key].mass = v))}
              />
            )}
          </div>
        ))}
      </Group>

      <Group title="Stagger & shake">
        <Slider
          label="stagger step (ms)"
          value={values.staggerStep}
          min={0}
          max={200}
          step={5}
          onChange={(v) => patch((d) => void (d.staggerStep = v))}
        />
        <Slider
          label="stagger cap (items)"
          value={values.staggerCap}
          min={1}
          max={24}
          step={1}
          onChange={(v) => patch((d) => void (d.staggerCap = v))}
        />
        <Slider
          label="shake light (px)"
          value={values.shake.light}
          min={0}
          max={16}
          step={0.5}
          decimals={1}
          onChange={(v) => patch((d) => void (d.shake.light = v))}
        />
        <Slider
          label="shake hard (px)"
          value={values.shake.hard}
          min={0}
          max={24}
          step={0.5}
          decimals={1}
          onChange={(v) => patch((d) => void (d.shake.hard = v))}
        />
      </Group>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <Button size="sm" variant="solid" tone="player" onClick={copy} full>
            {copied ? "Copied" : "Copy motion.ts"}
          </Button>
          <Button size="sm" variant="outline" onClick={reset} disabled={!dirty && speed === 1}>
            Reset
          </Button>
        </div>
        <details className="border-line border bg-surface">
          <summary className="font-display text-fg-dim cursor-pointer px-3 py-2 text-12 font-bold tracking-[var(--track-hud)] uppercase">
            Show source {dirty && <span className="text-player">· edited</span>}
          </summary>
          <pre className="tabular text-fg-dim overflow-x-auto px-3 pb-3 text-12 leading-relaxed">
            {toMotionSource(values)}
          </pre>
        </details>
      </div>
    </div>
  );
}

/* ── Bits ────────────────────────────────────────────────────────────────── */

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="font-display text-fg border-line border-b pb-1.5 text-12 font-extrabold tracking-[var(--track-hud)] uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  decimals = 0,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  decimals?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-fg-dim text-12">{label}</span>
        <span className="tabular text-fg text-12">
          {value.toFixed(decimals)}
          {suffix}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="focus-ring accent-[var(--player)]"
      />
    </label>
  );
}

/** A 48px curve preview, so an easing edit is legible without firing a beat. */
function BezierPreview({ curve }: { curve: Cubic }) {
  const [x1, y1, x2, y2] = curve;
  const s = 48;
  const path = `M0,${s} C${x1 * s},${s - y1 * s} ${x2 * s},${s - y2 * s} ${s},0`;
  return (
    <svg width={s} height={s} className={cn("border-line border bg-surface")} aria-hidden>
      <path d={path} fill="none" stroke="var(--player)" strokeWidth={1.5} />
    </svg>
  );
}
