import { describe, expect, it } from "vitest";
import {
  AssetRecordSchema,
  GroupSchema,
  ImportManifestSchema,
  isOverride,
  parseAssetRecord,
  parseJudgeBatch,
  parseTasteProfile,
  reviewQueue,
  SearchResponseSchema,
} from "./index.js";

const minimalAsset = {
  id: "a1b2c3",
  relPath: "library/2026/2026-07-04/IMG_0001.jpg",
  fileName: "IMG_0001.jpg",
  byteSize: 1024,
  contentHash: "deadbeefdeadbeef",
  mediaType: "photo",
  format: "jpeg",
};

describe("AssetRecordSchema", () => {
  it("parses a minimal record and applies defaults", () => {
    const res = parseAssetRecord(minimalAsset);
    expect(res.ok).toBe(true);
    expect(res.value?.user.flag).toBe("unrated");
    expect(res.value?.pairRole).toBe("primary");
    expect(res.value?.tags).toEqual([]);
    expect(res.value?.stages).toEqual({});
  });

  it("keeps quality/verdict fields when present", () => {
    const res = parseAssetRecord({
      ...minimalAsset,
      quality: { blurScore: 42.5, meanLuma: 128 },
      ai: { suggestion: "reject", confidence: 0.9, source: "cv", reasons: [{ code: "blurry" }] },
      user: { flag: "pick", rating: 4 },
    });
    expect(res.ok).toBe(true);
    expect(res.value?.ai?.suggestion).toBe("reject");
    expect(res.value?.user.rating).toBe(4);
  });

  describe("hostile input hardening", () => {
    it("rejects traversal and absolute media paths", () => {
      for (const relPath of ["../outside.jpg", "/etc/passwd", "C:\\x.jpg", "a/../../b.jpg", "a\0b.jpg"]) {
        expect(parseAssetRecord({ ...minimalAsset, relPath }).ok).toBe(false);
      }
    });

    it("rejects non-finite and absurd numerics", () => {
      expect(parseAssetRecord({ ...minimalAsset, byteSize: Infinity }).ok).toBe(false);
      expect(parseAssetRecord({ ...minimalAsset, durationSec: Number.POSITIVE_INFINITY }).ok).toBe(false);
      expect(parseAssetRecord({ ...minimalAsset, durationSec: 1e9 }).ok).toBe(false);
      expect(
        parseAssetRecord({ ...minimalAsset, ai: { suggestion: "keep", confidence: 7, source: "cv" } }).ok,
      ).toBe(false);
    });

    it("rejects malformed ids", () => {
      expect(parseAssetRecord({ ...minimalAsset, id: "../x" }).ok).toBe(false);
      expect(parseAssetRecord({ ...minimalAsset, id: "" }).ok).toBe(false);
    });

    it("caps tag arrays", () => {
      const tags = Array.from({ length: 200 }, (_, i) => `tag${i}`);
      expect(parseAssetRecord({ ...minimalAsset, tags }).ok).toBe(false);
    });

    it("rejects out-of-range ratings", () => {
      expect(parseAssetRecord({ ...minimalAsset, user: { flag: "pick", rating: 9 } }).ok).toBe(false);
      expect(parseAssetRecord({ ...minimalAsset, user: { flag: "pick", rating: -1 } }).ok).toBe(false);
    });
  });
});

describe("GroupSchema", () => {
  it("parses a burst group", () => {
    const g = GroupSchema.parse({ id: "g1", kind: "burst", assetIds: ["a", "b"], bestPickId: "a" });
    expect(g.assetIds).toHaveLength(2);
  });

  it("rejects empty groups", () => {
    expect(GroupSchema.safeParse({ id: "g1", kind: "burst", assetIds: [] }).success).toBe(false);
  });
});

describe("TasteProfileSchema", () => {
  it("defaults to conservative thresholds", () => {
    const taste = parseTasteProfile({});
    expect(taste.thresholds.blurReject).toBeGreaterThan(0);
    expect(taste.thresholds.sureConfidence).toBeGreaterThanOrEqual(0.5);
    expect(taste.rules).toEqual([]);
  });

  it("caps exemplars", () => {
    const exemplars = Array.from({ length: 300 }, () => ({
      aiSuggestion: "reject",
      userFlag: "pick",
    }));
    expect(() => parseTasteProfile({ exemplars })).toThrow();
  });
});

describe("ImportManifestSchema", () => {
  it("parses with defaults", () => {
    const m = ImportManifestSchema.parse({ id: "imp1", startedAt: "2026-07-10T00:00:00Z" });
    expect(m.stage).toBe("scan");
    expect(m.status).toBe("running");
    expect(m.counts.found).toBe(0);
  });
});

describe("JudgeBatchResultSchema", () => {
  it("parses a model response", () => {
    const res = parseJudgeBatch({
      items: [{ assetId: "a1", suggestion: "keep", confidence: 0.8, tags: ["ocean"] }],
      bestPicks: { g1: "a1" },
    });
    expect(res.ok).toBe(true);
    expect(res.value?.items[0]?.reason).toBe("llm-quality");
  });

  it("rejects unknown suggestions", () => {
    expect(parseJudgeBatch({ items: [{ assetId: "a1", suggestion: "delete", confidence: 0.8 }] }).ok).toBe(
      false,
    );
  });
});

describe("SearchResponseSchema", () => {
  it("bounds result scores", () => {
    expect(
      SearchResponseSchema.safeParse({
        query: "ocean",
        mode: "semantic",
        results: [{ assetId: "a1", score: 3 }],
      }).success,
    ).toBe(false);
  });
});

describe("reviewQueue", () => {
  const unrated = { flag: "unrated" as const, rating: 0 };
  it("routes by confidence", () => {
    expect(
      reviewQueue({ ai: { suggestion: "reject", confidence: 0.95, reasons: [], source: "cv" }, user: unrated }, 0.85),
    ).toBe("sure-reject");
    expect(
      reviewQueue({ ai: { suggestion: "reject", confidence: 0.5, reasons: [], source: "cv" }, user: unrated }, 0.85),
    ).toBe("needs-eye");
    expect(
      reviewQueue({ ai: { suggestion: "keep", confidence: 0.9, reasons: [], source: "llm" }, user: unrated }, 0.85),
    ).toBe("sure-keep");
  });

  it("user decisions leave the queues", () => {
    expect(
      reviewQueue(
        { ai: { suggestion: "reject", confidence: 0.95, reasons: [], source: "cv" }, user: { flag: "pick", rating: 0 } },
        0.85,
      ),
    ).toBe("decided");
  });

  it("assets without AI verdicts are unqueued", () => {
    expect(reviewQueue({ ai: undefined, user: unrated }, 0.85)).toBe("none");
  });
});

describe("isOverride", () => {
  it("detects contradictions only", () => {
    expect(isOverride("reject", "pick")).toBe(true);
    expect(isOverride("keep", "reject")).toBe(true);
    expect(isOverride("reject", "reject")).toBe(false);
    expect(isOverride("review", "pick")).toBe(false);
    expect(isOverride("keep", "unrated")).toBe(false);
  });
});
