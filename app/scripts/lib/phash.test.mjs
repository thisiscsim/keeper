import { describe, expect, it } from "vitest";
import { downsampleGray, hamming, phash, phashFromHex, phashToHex } from "./phash.mjs";

function pattern(size, fn) {
  const g = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) g[y * size + x] = fn(x, y);
  return g;
}

const circle = (cx, cy, r) => (x, y) => (Math.hypot(x - cx, y - cy) < r ? 220 : 30);

describe("phash", () => {
  it("is identical for identical images", () => {
    const a = phash(pattern(32, circle(16, 16, 8)));
    const b = phash(pattern(32, circle(16, 16, 8)));
    expect(hamming(a, b)).toBe(0);
  });

  it("is close for slightly shifted content", () => {
    const a = phash(pattern(32, circle(16, 16, 8)));
    const b = phash(pattern(32, circle(17, 16, 8)));
    expect(hamming(a, b)).toBeLessThanOrEqual(10);
  });

  it("is far for structurally different content", () => {
    const a = phash(pattern(32, circle(16, 16, 8)));
    const b = phash(pattern(32, (x, y) => ((x * 13 + y * 31) % 7 < 3 ? 240 : 10)));
    expect(hamming(a, b)).toBeGreaterThan(16);
  });

  it("round-trips through hex", () => {
    const a = phash(pattern(32, circle(10, 20, 6)));
    expect(phashFromHex(phashToHex(a))).toBe(a);
  });

  it("rejects wrong-size buffers", () => {
    expect(() => phash(new Uint8Array(100))).toThrow();
  });
});

describe("downsampleGray", () => {
  it("preserves mean brightness", () => {
    const src = pattern(128, (x) => (x < 64 ? 0 : 255));
    const out = downsampleGray(src, 128, 32);
    expect(out.length).toBe(32 * 32);
    const mean = out.reduce((s, v) => s + v, 0) / out.length;
    expect(mean).toBeGreaterThan(115);
    expect(mean).toBeLessThan(140);
  });
});
