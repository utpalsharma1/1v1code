"use client";

/* ============================================================================
   Placeholder sound (pulled forward from Phase 4)

   §6.3's countdown and §6.6's sequential test reveal are timed to rhythm, and
   rhythm cannot be tuned in silence — tuning them mute would only mean retuning
   everything when real sound lands.

   These are crude Web Audio oscillator tones, generated at runtime. No asset
   files, no <audio> tags. The real library in §9 is still Phase 4 and will use
   a preloaded buffer pool; this is scaffolding for the tuning surface, not the
   sound design.
   ========================================================================= */

export type Cue =
  | "countdown_tick"
  | "countdown_final"
  | "test_pass"
  | "test_fail"
  | "submit"
  | "victory";

/** Cue names the simulator emits that have no placeholder tone yet. */
const SILENT = new Set(["queue_pop", "compile", "clutch_ambient", "emote", "defeat", "rank_up"]);

const PASS_STREAK_RESET_MS = 4000;
const PASS_BASE_HZ = 520;
const PASS_STEP = 1.0595; // one semitone per consecutive pass

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private passStreak = 0;
  private lastPassAt = 0;

  muted = false;
  volume = 0.4;

  /** Lazily built; browsers refuse an AudioContext before a user gesture. */
  private ensure(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
    return this.ctx;
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master) this.master.gain.value = this.muted ? 0 : v;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  /** One enveloped oscillator. `glideTo` sweeps the pitch over the tone. */
  private tone(opts: {
    freq: number;
    type?: OscillatorType;
    ms: number;
    gain?: number;
    glideTo?: number;
    delay?: number;
  }) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const { freq, type = "triangle", ms, gain = 0.5, glideTo, delay = 0 } = opts;
    const t0 = ctx.currentTime + delay / 1000;
    const dur = ms / 1000;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (glideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);

    // Fast attack, exponential decay — reads as percussive rather than as a beep.
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    osc.connect(env);
    env.connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  /** Band-passed white noise, for the submit whoosh. Buffer built once. */
  private whoosh(ms: number) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    if (!this.noise) {
      const len = ctx.sampleRate * 1;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    const t0 = ctx.currentTime;
    const dur = ms / 1000;

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.2;
    filter.frequency.setValueAtTime(320, t0);
    filter.frequency.exponentialRampToValueAtTime(2600, t0 + dur);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.35, t0 + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    src.connect(filter);
    filter.connect(env);
    env.connect(this.master);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  play(cue: string) {
    if (this.muted || SILENT.has(cue)) return;
    switch (cue as Cue) {
      case "countdown_tick":
        this.tone({ freq: 440, type: "square", ms: 80, gain: 0.28 });
        break;

      case "countdown_final":
        // §6.3 — the final beat is pitched higher.
        this.tone({ freq: 700, type: "square", ms: 150, gain: 0.34 });
        break;

      case "test_pass": {
        // §9 — pitch rises with each consecutive pass. The streak is what makes
        // a clean sweep feel like a run rather than ten identical ticks.
        const now = performance.now();
        if (now - this.lastPassAt > PASS_STREAK_RESET_MS) this.passStreak = 0;
        this.lastPassAt = now;
        const freq = PASS_BASE_HZ * PASS_STEP ** Math.min(this.passStreak, 14);
        this.passStreak += 1;
        this.tone({ freq, type: "sine", ms: 70, gain: 0.3 });
        break;
      }

      case "test_fail":
        // Dull thud: low, fast, no glide.
        this.passStreak = 0;
        this.tone({ freq: 130, type: "sine", ms: 180, gain: 0.42, glideTo: 70 });
        break;

      case "submit":
        this.whoosh(420);
        break;

      case "victory":
        // Rising sting — a three-note arpeggio.
        this.tone({ freq: 392, type: "triangle", ms: 160, gain: 0.32 });
        this.tone({ freq: 523, type: "triangle", ms: 180, gain: 0.32, delay: 110 });
        this.tone({ freq: 784, type: "triangle", ms: 420, gain: 0.36, delay: 230 });
        break;

      default:
        break;
    }
  }
}

export const sound = new SoundEngine();

/** Cue names the simulator emits, mapped onto the placeholder tones. */
export const CUE_ALIASES: Record<string, string> = {
  countdown_tick_final: "countdown_final",
  victory_sting: "victory",
};

export function playCue(name: string) {
  sound.play(CUE_ALIASES[name] ?? name);
}
