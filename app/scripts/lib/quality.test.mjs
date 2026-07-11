import { describe, expect, it } from "vitest";
import { cvVerdict, exposureStats, laplacianVariance } from "./quality.mjs";
import { parseTasteProfile } from "@keeper/schema";

const T = parseTasteProfile({}).thresholds;

function flatGray(size, value) {
  return new Uint8Array(size * size).fill(value);
}

/** Checkerboard = maximal high-frequency energy = very sharp. */
function checkerboard(size) {
  const g = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      g[y * size + x] = (x + y) % 2 === 0 ? 255 : 0;
    }
  }
  return g;
}

/** Smooth horizontal gradient = almost no second-derivative energy. */
function gradient(size) {
  const g = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      g[y * size + x] = Math.round((x / (size - 1)) * 255);
    }
  }
  return g;
}

describe("laplacianVariance", () => {
  it("scores sharp content far above smooth content", () => {
    const sharp = laplacianVariance(checkerboard(64), 64, 64);
    const smooth = laplacianVariance(gradient(64), 64, 64);
    expect(sharp).toBeGreaterThan(10_000);
    expect(smooth).toBeLessThan(50);
    expect(sharp).toBeGreaterThan(smooth * 100);
  });

  it("is zero for flat frames", () => {
    expect(laplacianVariance(flatGray(64, 128), 64, 64)).toBe(0);
  });
});

describe("exposureStats", () => {
  it("measures clipping fractions", () => {
    const g = new Uint8Array(100);
    g.fill(255, 0, 30); // 30% blown
    g.fill(0, 30, 40); // 10% crushed
    g.fill(128, 40);
    const stats = exposureStats(g);
    expect(stats.clippedHighlights).toBeCloseTo(0.3, 5);
    expect(stats.clippedShadows).toBeCloseTo(0.1, 5);
    expect(stats.meanLuma).toBeGreaterThan(80);
  });

  it("flat frames have near-zero deviation", () => {
    expect(exposureStats(flatGray(32, 7)).lumaStdDev).toBe(0);
  });
});

describe("cvVerdict", () => {
  const base = { mediaType: "photo", format: "jpeg", exif: { make: "Canon" }, fileName: "IMG_1.jpg", byteSize: 5_000_000 };

  it("hard-rejects black frames with high confidence", () => {
    const v = cvVerdict({ ...base, quality: { meanLuma: 2, lumaStdDev: 0.5 } }, T);
    expect(v.suggestion).toBe("reject");
    expect(v.confidence).toBeGreaterThanOrEqual(0.9);
    expect(v.reasons[0].code).toBe("black-frame");
  });

  it("rejects blurry photos below the taste threshold", () => {
    const v = cvVerdict({ ...base, quality: { blurScore: T.blurReject - 1, lumaStdDev: 40, meanLuma: 120 } }, T);
    expect(v.suggestion).toBe("reject");
    expect(v.reasons.map((r) => r.code)).toContain("blurry");
  });

  it("routes soft-but-not-terrible photos to review", () => {
    const v = cvVerdict(
      { ...base, quality: { blurScore: (T.blurReject + T.blurReview) / 2, lumaStdDev: 40, meanLuma: 120 } },
      T,
    );
    expect(v.suggestion).toBe("review");
  });

  it("keeps sharp, well-exposed photos", () => {
    const v = cvVerdict({ ...base, quality: { blurScore: 500, lumaStdDev: 50, meanLuma: 120, clippedHighlights: 0.01, clippedShadows: 0.01 } }, T);
    expect(v.suggestion).toBe("keep");
    expect(v.reasons[0].code).toBe("well-exposed");
  });

  it("suggests rejecting sub-second accidental videos", () => {
    const v = cvVerdict(
      { mediaType: "video", format: "mp4", exif: {}, fileName: "clip.mp4", byteSize: 1e6, durationSec: 0.6, quality: { lumaStdDev: 40, meanLuma: 100 } },
      T,
    );
    expect(v.suggestion).toBe("reject");
    expect(v.reasons[0].code).toBe("accidental-clip");
  });

  it("never blur-rejects videos", () => {
    const v = cvVerdict(
      { mediaType: "video", format: "mp4", exif: {}, fileName: "clip.mp4", byteSize: 1e8, durationSec: 12, quality: { blurScore: 1, lumaStdDev: 40, meanLuma: 100 } },
      T,
    );
    expect(v.suggestion).toBe("keep");
  });

  it("flags screenshots for review, not rejection", () => {
    const v = cvVerdict(
      { mediaType: "photo", format: "png", exif: {}, fileName: "Screenshot 2026-07-01.png", byteSize: 1e6, quality: { blurScore: 900, lumaStdDev: 60, meanLuma: 128 } },
      T,
    );
    expect(v.suggestion).toBe("review");
    expect(v.reasons.map((r) => r.code)).toContain("screenshot");
  });
});
