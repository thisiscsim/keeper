import { describe, expect, it } from "vitest";
import { extractJson, parseJudgeResponse, sanitizeJudge } from "./llm-util.mjs";

describe("extractJson", () => {
  it("parses bare JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses fenced JSON with chatter", () => {
    expect(extractJson('Sure!\n```json\n{"a":1}\n```\nDone.')).toEqual({ a: 1 });
  });

  it("throws when no object exists", () => {
    expect(() => extractJson("no json here")).toThrow();
  });
});

describe("sanitizeJudge", () => {
  it("drops items for unknown asset ids", () => {
    const out = sanitizeJudge(
      { items: [{ assetId: "known", suggestion: "keep", confidence: 0.9 }, { assetId: "hallucinated", suggestion: "keep", confidence: 0.9 }] },
      ["known"],
    );
    expect(out.items).toHaveLength(1);
  });

  it("clamps bad enum values and confidences", () => {
    const out = sanitizeJudge(
      { items: [{ assetId: "a", suggestion: "delete", confidence: 42, reason: "made-up" }] },
      ["a"],
    );
    expect(out.items[0].suggestion).toBe("review");
    expect(out.items[0].confidence).toBe(1);
    expect(out.items[0].reason).toBe("llm-quality");
  });

  it("filters bestPicks to known ids", () => {
    const out = sanitizeJudge({ items: [], bestPicks: { g1: "a", g2: "nope" } }, ["a"]);
    expect(out.bestPicks).toEqual({ g1: "a" });
  });

  it("lowercases and caps tags", () => {
    const out = sanitizeJudge(
      { items: [{ assetId: "a", suggestion: "keep", confidence: 0.5, tags: ["OCEAN", 7, "Sunset"] }] },
      ["a"],
    );
    expect(out.items[0].tags).toEqual(["ocean", "sunset"]);
  });
});

describe("parseJudgeResponse", () => {
  it("end-to-end repairs a chatty response", () => {
    const text = 'Here you go:\n```json\n{"items":[{"assetId":"a","suggestion":"keep","confidence":0.7,"caption":"beach at dusk"}],"bestPicks":{}}\n```';
    const result = parseJudgeResponse(text, ["a"]);
    expect(result.items[0].caption).toBe("beach at dusk");
  });

  it("throws on unrepairable output", () => {
    expect(() => parseJudgeResponse("total nonsense", ["a"])).toThrow();
  });
});
