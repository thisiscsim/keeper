import { describe, expect, it } from "vitest";
import { parseEdl, type Benchmarks } from "@reel/edl";
import { critiqueEdl } from "./critique";

const edl = parseEdl({
  format: { fps: 30 },
  theme: { safeMargins: { top: 220, bottom: 320, left: 64, right: 64 } },
  tracks: [
    {
      id: "v",
      type: "video",
      clips: [
        { id: "c1", assetId: "a", start: 0, in: 0, out: 3 },
        { id: "c2", assetId: "a", start: 3, in: 0, out: 3 },
      ],
    },
    { id: "t", type: "text", clips: [{ id: "t1", start: 0.2, end: 2, text: "hook" }] },
    { id: "cap", type: "caption", words: [{ text: "hi", start: 0, end: 1 }] },
    { id: "aud", type: "audio", clips: [{ id: "a1", assetId: "m", start: 0, in: 0, out: 6 }] },
  ],
}).edl!;

describe("critiqueEdl", () => {
  it("returns a 0-100 score with 7 subscores (heuristic, no benchmarks)", () => {
    const r = critiqueEdl(edl);
    expect(r.subscores).toHaveLength(7);
    expect(r.score).toBe(r.subscores.reduce((s, x) => s + x.score, 0));
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.benchmarksUsed).toBe(false);
  });

  it("scores pacing/length relative to benchmarks when provided", () => {
    const benchmarks: Benchmarks = {
      count: 3,
      videos: [],
      distribution: {
        cutsPer10s: { mean: 3, std: 1, min: 2, max: 4 },
        durationSec: { mean: 6, std: 2, min: 4, max: 8 },
      },
    };
    const r = critiqueEdl(edl, benchmarks);
    expect(r.benchmarksUsed).toBe(true);
    const pacing = r.subscores.find((s) => s.key === "pacing");
    expect(pacing?.benchmark).toBeDefined();
    expect(pacing?.benchmark?.unit).toBe("cuts/10s");
    // ~3.3 cuts/10s vs mean 3 (within 1 std) => strong pacing score
    expect(pacing!.score).toBeGreaterThan(10);
  });
});
