/* Contrast + dichromat math for the palette comparison. Dev-tool only —
   nothing here ships in a product surface. */

export function parseHex(hex: string): [number, number, number] | null {
  const h = hex.trim().replace("#", "");
  if (h.length < 6) return null;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  if ([r, g, b].some((v) => Number.isNaN(v))) return null;
  return [r!, g!, b!];
}

const lin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]: [number, number, number]) =>
  0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);

export function contrast(a: string, b: string): number | null {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return null;
  const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
  return (hi! + 0.05) / (lo! + 0.05);
}

/** Perceptual-ish chroma, 0–1. The number that proves "muted" is real. */
export function chroma(hex: string): number | null {
  const c = parseHex(hex);
  if (!c) return null;
  return (Math.max(...c) - Math.min(...c)) / 255;
}

/** Viénot–Brettel–Mollon dichromat simulation. */
export function simulate(hex: string, kind: "prot" | "deut"): string | null {
  const c = parseHex(hex);
  if (!c) return null;
  const [R, G, B] = c;
  let L = 17.8824 * R + 43.5161 * G + 4.11935 * B;
  let M = 3.45565 * R + 27.1554 * G + 3.86714 * B;
  const S = 0.0299566 * R + 0.184309 * G + 1.46709 * B;
  if (kind === "prot") L = 2.02344 * M - 2.52581 * S;
  else M = 0.494207 * L + 1.24827 * S;

  const out = [
    0.080944 * L - 0.130504 * M + 0.116721 * S,
    -0.0102485 * L + 0.0540194 * M - 0.113615 * S,
    -0.000365294 * L - 0.00412163 * M + 0.693513 * S,
  ].map((v) => Math.round(Math.max(0, Math.min(255, v))));

  return "#" + out.map((v) => v.toString(16).padStart(2, "0")).join("");
}
