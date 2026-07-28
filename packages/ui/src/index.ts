export { Button, type ButtonProps } from "./components/Button";
export { Card, type CardProps } from "./components/Card";
export { Clock, type ClockProps } from "./components/Clock";
export { Nameplate, type NameplateProps, type NameplateState } from "./components/Nameplate";
export { RankBadge, type RankBadgeProps } from "./components/RankBadge";
export { MAX_CELLS, TestBar, type TestBarProps } from "./components/TestBar";
export {
  ALL_STATUSES,
  StatusTicker,
  type Status,
  type StatusTickerProps,
} from "./components/StatusTicker";

/* ── Match HUD (Phase 1) ─────────────────────────────────────────────── */
export { MatchHUD, type HUDPlayer, type MatchHUDProps } from "./components/hud/MatchHUD";
export { PulseLine, type PulseLineProps } from "./components/hud/PulseLine";
export { Particles, type ParticlesProps } from "./components/hud/Particles";
export { ClutchEdge, CompilePulse, ShakeStage, useScreenShake } from "./components/hud/effects";
export {
  EMOTES,
  EMOTE_COOLDOWN_MS,
  EmoteStream,
  EmoteWheel,
  type Emote,
  type FloatingEmote,
} from "./components/hud/EmoteWheel";

/* ── Cinematics (Phase 1) ────────────────────────────────────────────── */
export { Countdown } from "./components/cine/Countdown";
export { ProblemPanel } from "./components/cine/ProblemPanel";
export { QueueCard } from "./components/cine/QueueCard";
export { QueuePop, type QueuePopPlayer } from "./components/cine/QueuePop";
export { VerdictPanel, type VerdictPanelProps } from "./components/cine/VerdictPanel";
export { VictoryOverlay, type VictoryOverlayProps } from "./components/cine/VictoryOverlay";

export { cn, type ClassValue } from "./lib/cn";
export { useInteractive } from "./lib/interactive";
export {
  MotionPrefProvider,
  motionPrefBootstrapScript,
  useMotionPref,
  useReducedMotion,
  type MotionPref,
} from "./lib/motion-pref";
export {
  DEFAULT_VALUES,
  MotionTuningProvider,
  toMotionSource,
  useMotion,
  useMotionTuning,
  type Cubic,
  type DurKey,
  type EaseKey,
  type Motion,
  type MotionValues,
  type SpringKey,
  type SpringValue,
} from "./lib/motion-tuning";
export { CUE_ALIASES, playCue, sound, type Cue } from "./lib/sound";
export {
  DIVISIONS,
  TIERS,
  type CellState,
  type Division,
  type Side,
  type Tier,
} from "./lib/types";
