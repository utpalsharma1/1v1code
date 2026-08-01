import type { Tier } from "../lib/types";

/* ============================================================================
   A player's handle, coloured by league — §4, "League color on handles".

   Outside a match a handle renders in its tier colour, so rank stops being a
   badge you click and becomes ambient identity you read at a glance. Master and
   above additionally carry the tier aura.

   INSIDE A MATCH, SIDE COLOUR ALWAYS WINS. A Grandmaster on the P1 side renders
   jade, never crimson. §4 is explicit that this is not a special case to code
   around: the component sits inside the `[data-side]` scope and inherits
   `--player` like everything else, and if you ever find yourself branching on
   tier inside the match HUD, the component is in the wrong place in the tree.
   Here that is one prop — `inMatch` — and it is checked BEFORE tier is looked at
   so the branch cannot be got wrong by adding a tier later.

   THE SEPARATION RULE (§4). Tier colour and match-state colour never share a
   screen. `--grandmaster` sits 0.101 from `--fail` in OKLab, the closest pair in
   the palette, so a crimson handle beside an orange failing test bar would read
   as a rendering bug. Anywhere a live HUD is on screen — the match screen,
   spectate, replay playback — handles are `--text-dim` with no tier colour and
   no aura, and identity comes from the P1/P2 chip instead.

   AURA IS NOT STATE GLOW. It is a `text-shadow`, which has no spread parameter,
   so it physically cannot grow into the 24px `box-shadow` §5 reserves for
   events. Most tiers get none: flat through Gold, faint at Platinum and
   Diamond, full at Master and above. A leaderboard where every handle glows is
   noise, and the restraint is what makes the top of the ladder feel earned.
   ========================================================================= */

export interface HandleProps {
  handle: string;
  /** Omit for a guest or anyone unranked — they render plain. */
  tier?: Tier | null;
  /**
   * True anywhere a live match HUD is on screen. Suppresses tier colour and
   * aura entirely, per §4's separation rule.
   */
  inMatch?: boolean;
  className?: string;
}

/** §4: flat through Gold, faint at Platinum/Diamond, full at Master and above. */
const AURA: Partial<Record<Tier, string>> = {
  platinum: "[text-shadow:var(--tier-aura-faint)]",
  diamond: "[text-shadow:var(--tier-aura-faint)]",
  master: "[text-shadow:var(--tier-aura-full)]",
  grandmaster: "[text-shadow:var(--tier-aura-full)]",
  legend: "[text-shadow:var(--tier-aura-full)]",
};

const TIER_VAR: Record<Tier, string> = {
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

export function Handle({ handle, tier, inMatch = false, className = "" }: HandleProps) {
  /* inMatch is checked FIRST and returns early, so no tier styling can be
     reached from a match context however this component is later extended. */
  if (inMatch) {
    return <span className={`text-fg-dim ${className}`}>{handle}</span>;
  }
  if (!tier) {
    return <span className={`text-fg ${className}`}>{handle}</span>;
  }
  return (
    <span
      data-tier={tier}
      className={`${TIER_VAR[tier]} ${AURA[tier] ?? ""} text-[var(--tier)] ${className}`}
    >
      {handle}
    </span>
  );
}
