"use client";

/* ============================================================================
   §9 sound — a preloaded buffer pool over Web Audio.

   WHAT REPLACED WHAT. Six placeholder oscillator tones, built during Phase 0 so
   that §6.3's countdown and §6.6's reveal could be tuned against a rhythm
   instead of against silence, and explicit that they were scaffolding. This is
   the library they were scaffolding for: every §9 cue, rendered once into
   `AudioBuffer`s at load, played back as one `BufferSource` each.

   NO `<audio>` TAGS, per §9 — the latency of an `<audio>` element is tens of
   milliseconds and unpredictable, which would destroy the one thing these
   sounds exist to do, which is land on a frame.

   THE POOL IS GENUINELY PRELOADED, and that is a design choice with a
   consequence worth stating. `OfflineAudioContext` needs no user gesture, so
   every buffer is rendered when the provider mounts — before anything can be
   played, not on the first cue. What still needs a gesture is `resume()` on the
   live context, which browsers require and which is unrelated to the pool. The
   result is that the very first sound of a session, §6.2's queue pop, is
   sample-accurate rather than being the one that pays for the load.

   NOTHING IS FETCHED. The samples come from `sound-design.ts`, which generates
   them; see the licence note at the top of that file.

   ON BEING GENUINELY OPTIONAL. Sound is on by default and one toggle turns it
   off. Muting sets a master gain to zero and, above that, `play()` returns
   before it touches the context at all, so a muted session builds no node
   graph. NOTHING IN THIS PRODUCT IS ONLY LEGIBLE THROUGH SOUND: every cue here
   accompanies a visual state change that stands on its own, which is asserted
   for real in `sound.test.ts` rather than asserted in a comment.
   ========================================================================= */

import { CUE_SECONDS, PASS_STEPS, renderCue, type CueName } from "./sound-design";

export type { CueName };

/** Legacy alias — the placeholder's exported type name. */
export type Cue = CueName;

const STORAGE_KEY = "1v1.sound";

/**
 * A consecutive-pass streak resets after this long without a pass.
 *
 * §6.6 resolves a submission's tests at `dur.reveal` (165ms), so a gap this
 * large means the ladder is climbing across two separate submissions and
 * should start again rather than carry over.
 */
const PASS_STREAK_RESET_MS = 4000;

/**
 * How long a cue is faded when it is stopped early.
 *
 * §6.7's victory sting is 2.4s and `dur.skip` arms a skip at 700ms, so a player
 * who skips WILL interrupt the sound. Cutting a buffer mid-sample is a step
 * discontinuity and it clicks audibly, which is a worse artefact than the tail
 * it was trying to remove. 90ms is short enough to feel immediate and long
 * enough that the ramp is inaudible.
 */
const RELEASE_MS = 90;

/** A cue currently sounding, kept so it can be released rather than cut. */
interface Voice {
  source: AudioBufferSourceNode;
  gain: GainNode;
}

class SoundEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer>();
  private voices = new Map<string, Voice[]>();
  private loops = new Map<string, Voice>();
  private ready = false;
  private priming: Promise<void> | null = null;

  private passStreak = 0;
  private lastPassAt = 0;

  muted = false;
  volume = 0.5;

  /* --- Preferences ---------------------------------------------------- */

  /** Reads the stored preference. Called by the provider before anything plays. */
  loadPrefs(): { muted: boolean; volume: number } {
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { muted?: boolean; volume?: number };
          if (typeof parsed.muted === "boolean") this.muted = parsed.muted;
          if (typeof parsed.volume === "number" && parsed.volume >= 0 && parsed.volume <= 1) {
            this.volume = parsed.volume;
          }
        }
      } catch {
        /* A corrupt or unreadable preference falls back to the default rather
           than throwing on a code path that runs before anything is rendered. */
      }
    }
    this.applyGain();
    return { muted: this.muted, volume: this.volume };
  }

  private savePrefs(): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ muted: this.muted, volume: this.volume }),
      );
    } catch {
      /* Private browsing can refuse writes. Losing the preference is survivable;
         throwing on a volume slider is not. */
    }
  }

  private applyGain(): void {
    if (!this.master || !this.ctx) return;
    const target = this.muted ? 0 : this.volume;
    /* Ramped, not set: a step change in gain on a sounding voice is a click,
       and the mute button is most likely to be pressed while something plays. */
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.015);
  }

  setVolume(v: number): void {
    this.volume = Math.min(1, Math.max(0, v));
    this.applyGain();
    this.savePrefs();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyGain();
    if (m) this.stopLoops();
    this.savePrefs();
  }

  /* --- The pool ------------------------------------------------------- */

  /**
   * Renders every cue into the pool. Idempotent, and safe to call before any
   * user gesture — an `OfflineAudioContext` does not need one.
   */
  prime(): Promise<void> {
    if (this.priming) return this.priming;
    if (typeof window === "undefined") return Promise.resolve();

    this.priming = (async () => {
      const ctx = this.ensureContext();
      if (!ctx) return;
      const sr = ctx.sampleRate;

      for (const cue of Object.keys(CUE_SECONDS) as CueName[]) {
        if (cue === "test_pass") {
          /* One buffer per rung rather than one buffer replayed at a shifted
             `playbackRate`. Rate-shifting changes duration as well as pitch, so
             the twentieth tick would be 40% shorter than the first and the run
             would accelerate as it rose — which is a different sound from the
             one §9 asks for. Twenty short buffers cost under a megabyte. */
          for (let step = 0; step <= PASS_STEPS; step++) {
            this.buffers.set(`test_pass:${step}`, this.toBuffer(ctx, renderCue(cue, sr, step)));
          }
        } else {
          this.buffers.set(cue, this.toBuffer(ctx, renderCue(cue, sr)));
        }
        /* Yield between cues so priming never blocks a frame. The whole pool is
           a few tens of milliseconds of work, but it runs during page load,
           which is the worst moment to hold the main thread. */
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      this.ready = true;
    })();

    return this.priming;
  }

  private toBuffer(ctx: BaseAudioContext, samples: Float32Array): AudioBuffer {
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate);
    /* `copyToChannel` is typed against `Float32Array<ArrayBuffer>` while the
       renderer returns the generic `ArrayBufferLike` form. Writing the channel
       directly avoids the cast and is the same work. */
    buffer.getChannelData(0).set(samples);
    return buffer;
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      this.master.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  /**
   * Resumes the context. Browsers start it suspended until a user gesture, so
   * this is called from the first pointer or key event.
   */
  unlock(): void {
    const ctx = this.ensureContext();
    if (ctx && ctx.state === "suspended") void ctx.resume();
  }

  /** True once every buffer is rendered. Exposed for the dev tuning panel. */
  get primed(): boolean {
    return this.ready;
  }

  get poolSize(): number {
    return this.buffers.size;
  }

  /* --- Playback ------------------------------------------------------- */

  private start(key: string, gain: number, loop: boolean): Voice | null {
    const ctx = this.ensureContext();
    const buffer = this.buffers.get(key);
    if (!ctx || !this.master || !buffer) return null;
    if (ctx.state === "suspended") void ctx.resume();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = loop;
    const node = ctx.createGain();
    node.gain.value = gain;
    source.connect(node);
    node.connect(this.master);
    source.start();

    const voice: Voice = { source, gain: node };
    if (!loop) {
      const live = this.voices.get(key) ?? [];
      live.push(voice);
      this.voices.set(key, live);
      source.onended = () => {
        const rest = (this.voices.get(key) ?? []).filter((v) => v !== voice);
        this.voices.set(key, rest);
      };
    }
    return voice;
  }

  /** Fades a voice out over `RELEASE_MS` and stops it. Never a hard cut. */
  private release(voice: Voice): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const end = now + RELEASE_MS / 1000;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
    voice.gain.gain.linearRampToValueAtTime(0, end);
    try {
      voice.source.stop(end);
    } catch {
      /* Already stopped. */
    }
  }

  /**
   * Plays a cue.
   *
   * Returns without touching the audio context when muted, so a muted session
   * costs nothing rather than building a graph into a zeroed gain.
   */
  play(cue: string): void {
    if (this.muted) return;

    if (cue === "test_pass") {
      /* §9: the pitch rises with each consecutive pass. This is the placeholder
         behaviour that was kept deliberately — it is what makes a clean sweep
         read as a run rather than as ten identical ticks. */
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - this.lastPassAt > PASS_STREAK_RESET_MS) this.passStreak = 0;
      this.lastPassAt = now;
      const step = Math.min(this.passStreak, PASS_STEPS);
      this.passStreak += 1;
      this.start(`test_pass:${step}`, 1, false);
      return;
    }

    if (cue === "test_fail") this.passStreak = 0;

    if (cue === "clutch_ambient") {
      this.startLoop("clutch_ambient");
      return;
    }

    this.start(cue, 1, false);
  }

  /**
   * Starts a looping cue if it is not already running. Idempotent, because
   * §6.5's clutch state is a threshold that can be re-entered.
   */
  startLoop(cue: string): void {
    if (this.muted || this.loops.has(cue)) return;
    const voice = this.start(cue, 0, true);
    if (!voice || !this.ctx) return;
    /* Faded in over a second — §6.5 calls it peripheral, "you feel it before you
       consciously see it", and a sub-bass tone that arrives at full level is
       the opposite of peripheral. */
    voice.gain.gain.setValueAtTime(0, this.ctx.currentTime);
    voice.gain.gain.linearRampToValueAtTime(0.7, this.ctx.currentTime + 1);
    this.loops.set(cue, voice);
  }

  stopLoop(cue: string): void {
    const voice = this.loops.get(cue);
    if (!voice) return;
    this.loops.delete(cue);
    this.release(voice);
  }

  stopLoops(): void {
    for (const cue of [...this.loops.keys()]) this.stopLoop(cue);
  }

  /**
   * Stops everything currently sounding, with a release rather than a cut.
   *
   * Called when a cinematic is skipped (§5: `dur.skip` arms any input to drop
   * the remainder) and when a match screen unmounts. A victory sting continuing
   * over the Hub is the sound of a bug.
   */
  stopAll(): void {
    for (const [, live] of this.voices) for (const voice of live) this.release(voice);
    this.voices.clear();
    this.stopLoops();
  }
}

export const sound = new SoundEngine();

/**
 * Names the rest of the app emits, mapped onto §9's cue list.
 *
 * Kept because the HUD simulator and the match screen name some moments
 * differently from §9's library, and a rename across both is churn for nothing.
 */
export const CUE_ALIASES: Record<string, string> = {
  countdown_tick_final: "countdown_final",
  victory_sting: "victory",
};

export function playCue(name: string): void {
  sound.play(CUE_ALIASES[name] ?? name);
}
