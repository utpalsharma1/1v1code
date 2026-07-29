import assert from "node:assert/strict";
import test, { describe } from "node:test";
import { CODE_ALPHABET, CODE_LENGTH, formatCode, generateCode, normaliseCode } from "./codes.ts";

describe("shareable codes", () => {
  test("uses only the unambiguous alphabet", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateCode();
      assert.equal(code.length, CODE_LENGTH);
      for (const c of code) assert.ok(CODE_ALPHABET.includes(c), `stray character ${c}`);
      assert.doesNotMatch(code, /[ILOU]/, "confusable letters must be excluded");
    }
  });

  test("is not enumerable — no shared prefix, no visible counter", () => {
    // A cuid would fail this: it embeds a timestamp, so consecutive ids share a
    // long prefix and the space is walkable.
    const codes = Array.from({ length: 200 }, () => generateCode());
    assert.equal(new Set(codes).size, 200, "collision in 200 draws is impossible-ish");
    const firstChars = new Set(codes.map((c) => c[0]));
    assert.ok(firstChars.size > 10, "first character must not cluster");
  });

  test("byte mapping is unbiased across the alphabet", () => {
    // 256 is a multiple of 32, so every symbol must appear about equally.
    const counts = new Map<string, number>();
    for (let i = 0; i < 3200; i++) {
      for (const c of generateCode()) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    assert.equal(counts.size, 32, "every symbol should occur");
    const values = [...counts.values()];
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    for (const v of values) {
      assert.ok(Math.abs(v - mean) / mean < 0.25, `symbol frequency skewed: ${v} vs ${mean}`);
    }
  });

  test("round-trips through the spoken form", () => {
    const code = generateCode();
    assert.equal(formatCode(code), `${code.slice(0, 5)}-${code.slice(5)}`);
    assert.equal(normaliseCode(formatCode(code)), code);
    assert.equal(normaliseCode(code.toLowerCase()), code);
  });

  test("forgives the characters people actually mistype", () => {
    const code = normaliseCode("il0ou-12345");
    assert.equal(code, "1100V12345", "I/L->1, O->0, U->V");
  });

  test("rejects wrong lengths and stray characters", () => {
    assert.equal(normaliseCode("TOOSHORT"), null);
    assert.equal(normaliseCode("WAYTOOLONGCODE"), null);
    assert.equal(normaliseCode("ABCDE-FGH!J"), null);
  });
});
