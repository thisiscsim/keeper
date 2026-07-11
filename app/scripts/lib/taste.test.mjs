import { describe, expect, it } from "vitest";
import { parseTasteProfile } from "@keeper/schema";
import { recordVerdict, tasteForPrompt, tunedThresholds } from "./taste.mjs";

const blank = () => parseTasteProfile({});

const rejectedAsset = (id = "a1") => ({
  id,
  thumbRel: `.keeper/thumbs/${id}.jpg`,
  ai: {
    suggestion: "reject",
    confidence: 0.88,
    reasons: [{ code: "blurry" }],
    source: "cv",
  },
});

describe("recordVerdict", () => {
  it("turns contradictions into exemplars + kept stats", () => {
    const taste = recordVerdict(blank(), { asset: rejectedAsset(), userFlag: "pick" });
    expect(taste.exemplars).toHaveLength(1);
    expect(taste.exemplars[0].aiReason).toBe("blurry");
    expect(taste.exemplars[0].userFlag).toBe("pick");
    expect(taste.stats.blurry.kept).toBe(1);
  });

  it("counts confirmations without exemplars", () => {
    const taste = recordVerdict(blank(), { asset: rejectedAsset(), userFlag: "reject" });
    expect(taste.exemplars).toHaveLength(0);
    expect(taste.stats.blurry.confirmed).toBe(1);
  });

  it("ignores verdicts on assets without AI suggestions", () => {
    const taste = recordVerdict(blank(), { asset: { id: "x", ai: undefined }, userFlag: "pick" });
    expect(taste.exemplars).toHaveLength(0);
    expect(Object.keys(taste.stats)).toHaveLength(0);
  });

  it("caps the exemplar list", () => {
    let taste = blank();
    for (let i = 0; i < 250; i++) {
      taste = recordVerdict(taste, { asset: rejectedAsset(`a${i}`), userFlag: "pick" });
    }
    expect(taste.exemplars.length).toBeLessThanOrEqual(200);
    expect(parseTasteProfile(taste).exemplars.length).toBeLessThanOrEqual(200);
  });
});

describe("tunedThresholds", () => {
  it("keeps defaults with no overrides", () => {
    const t = tunedThresholds(blank());
    expect(t.blurReject).toBe(blank().thresholds.blurReject);
  });

  it("loosens the blur bar after repeated overrides", () => {
    let taste = blank();
    for (let i = 0; i < 12; i++) {
      taste = recordVerdict(taste, { asset: rejectedAsset(`a${i}`), userFlag: "pick" });
    }
    const t = tunedThresholds(taste);
    expect(t.blurReject).toBeLessThan(blank().thresholds.blurReject);
    expect(t.blurReject).toBeGreaterThanOrEqual(4); // bounded, never zero
  });

  it("confirmations offset overrides", () => {
    let taste = blank();
    for (let i = 0; i < 6; i++) taste = recordVerdict(taste, { asset: rejectedAsset(`k${i}`), userFlag: "pick" });
    for (let i = 0; i < 24; i++) taste = recordVerdict(taste, { asset: rejectedAsset(`c${i}`), userFlag: "reject" });
    const t = tunedThresholds(taste);
    expect(t.blurReject).toBe(blank().thresholds.blurReject);
  });
});

describe("tasteForPrompt", () => {
  it("renders rules and recent corrections", () => {
    let taste = blank();
    taste = { ...taste, rules: [{ id: "r1", text: "Never reject photos of my kids" }] };
    taste = recordVerdict(taste, { asset: rejectedAsset(), userFlag: "pick" });
    const prompt = tasteForPrompt(taste);
    expect(prompt).toContain("Never reject photos of my kids");
    expect(prompt).toContain("AI said reject (blurry), user chose pick");
  });

  it("is empty for a blank profile", () => {
    expect(tasteForPrompt(blank())).toBe("");
  });
});
