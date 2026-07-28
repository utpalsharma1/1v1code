/** Which corner a thing belongs to. Drives every color decision in the UI. */
export type Side = "p1" | "p2";

export const TIERS = [
  "iron",
  "bronze",
  "silver",
  "gold",
  "platinum",
  "diamond",
  "master",
  "grandmaster",
  "legend",
] as const;

export type Tier = (typeof TIERS)[number];

/** Divisions run IV → I inside every tier except Legend, which has none (§8). */
export const DIVISIONS = ["IV", "III", "II", "I"] as const;
export type Division = (typeof DIVISIONS)[number];

/** State of a single test case in a TestBar. */
export type CellState = "idle" | "pass" | "fail";
