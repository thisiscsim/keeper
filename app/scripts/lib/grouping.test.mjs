import { describe, expect, it } from "vitest";
import { clusterBursts, pairSiblings, pickBest } from "./grouping.mjs";
import { phash } from "./phash.mjs";

function pat(fn) {
  const g = new Uint8Array(32 * 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) g[y * 32 + x] = fn(x, y);
  return g;
}
const circleAt = (cx) => pat((x, y) => (Math.hypot(x - cx, y - 16) < 8 ? 220 : 30));

const t = (sec) => new Date(Date.UTC(2026, 6, 4, 12, 0, sec)).toISOString();

describe("clusterBursts", () => {
  it("chains time-adjacent, visually similar shots", () => {
    const h = phash(circleAt(16));
    const h2 = phash(circleAt(17));
    const items = [
      { id: "a", capturedAt: t(0), hash: h },
      { id: "b", capturedAt: t(1), hash: h2 },
      { id: "c", capturedAt: t(2), hash: h },
      { id: "far", capturedAt: t(60), hash: h },
    ];
    const groups = clusterBursts(items);
    expect(groups).toHaveLength(1);
    expect(groups[0].assetIds).toEqual(["a", "b", "c"]);
  });

  it("splits visually different shots even when close in time", () => {
    const different = pat((x, y) => ((x * 13 + y * 31) % 7 < 3 ? 240 : 10));
    const items = [
      { id: "a", capturedAt: t(0), hash: phash(circleAt(16)) },
      { id: "b", capturedAt: t(1), hash: phash(different) },
    ];
    expect(clusterBursts(items)).toHaveLength(0);
  });

  it("ignores items without timestamps", () => {
    expect(clusterBursts([{ id: "a", capturedAt: undefined, hash: null }])).toHaveLength(0);
  });
});

describe("pairSiblings", () => {
  it("pairs RAW+JPEG twins by stem", () => {
    const patches = pairSiblings([
      { id: "j", fileName: "IMG_0001.JPG", format: "jpeg", mediaType: "photo", dirRel: "2026/2026-07-04" },
      { id: "r", fileName: "IMG_0001.CR3", format: "raw", mediaType: "photo", dirRel: "2026/2026-07-04" },
    ]);
    expect(patches).toEqual([{ id: "r", pairRole: "raw-sibling", pairPrimaryId: "j" }]);
  });

  it("pairs Live Photos by ContentIdentifier across names", () => {
    const patches = pairSiblings([
      { id: "still", fileName: "IMG_2.HEIC", format: "heic", mediaType: "photo", contentId: "uuid-1", dirRel: "d" },
      { id: "vid", fileName: "IMG_2xx.MOV", format: "mov", mediaType: "video", contentId: "uuid-1", dirRel: "d" },
    ]);
    expect(patches).toEqual([{ id: "vid", pairRole: "live-video", pairPrimaryId: "still" }]);
  });

  it("pairs Live Photos by stem when no ContentIdentifier", () => {
    const patches = pairSiblings([
      { id: "still", fileName: "IMG_3.HEIC", format: "heic", mediaType: "photo", dirRel: "d" },
      { id: "vid", fileName: "IMG_3.MOV", format: "mov", mediaType: "video", dirRel: "d" },
    ]);
    expect(patches).toEqual([{ id: "vid", pairRole: "live-video", pairPrimaryId: "still" }]);
  });

  it("does not pair unrelated files", () => {
    expect(
      pairSiblings([
        { id: "a", fileName: "IMG_1.JPG", format: "jpeg", mediaType: "photo", dirRel: "d" },
        { id: "b", fileName: "IMG_2.JPG", format: "jpeg", mediaType: "photo", dirRel: "d" },
      ]),
    ).toEqual([]);
  });
});

describe("pickBest", () => {
  it("prefers the sharpest frame", () => {
    expect(
      pickBest([
        { id: "a", quality: { blurScore: 20 } },
        { id: "b", quality: { blurScore: 200 } },
        { id: "c", quality: { blurScore: 90 } },
      ]),
    ).toBe("b");
  });

  it("penalizes clipped exposure", () => {
    expect(
      pickBest([
        { id: "sharp-blown", quality: { blurScore: 210, clippedHighlights: 0.6 } },
        { id: "slightly-soft", quality: { blurScore: 180, clippedHighlights: 0.01 } },
      ]),
    ).toBe("slightly-soft");
  });
});
