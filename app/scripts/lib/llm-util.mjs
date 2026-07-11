// Repair-not-trust helpers for LLM output (same discipline the video engine
// used): pull JSON out of a chatty response, clamp the fields we understand,
// and let zod do the final say.
import { parseJudgeBatch } from "@keeper/schema";

/** Pull the first {...} JSON object out of a model response (handles code fences). */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(body.slice(start, end + 1));
}

const SUGGESTIONS = new Set(["keep", "reject", "review"]);
const REASONS = new Set([
  "blurry", "soft-focus", "underexposed", "overexposed", "black-frame", "flat-frame",
  "corrupt", "tiny-file", "accidental-clip", "screenshot", "screen-recording",
  "duplicate-worse", "burst-not-pick", "eyes-closed", "bad-framing",
  "sharpest-of-burst", "well-exposed", "important-moment", "llm-quality", "other",
]);

/** Clamp common harmless deviations before strict schema validation. */
export function sanitizeJudge(obj, validAssetIds) {
  if (!obj || typeof obj !== "object") return obj;
  const valid = new Set(validAssetIds);
  const items = Array.isArray(obj.items) ? obj.items : [];
  obj.items = items
    .filter((item) => item && typeof item === "object" && valid.has(item.assetId))
    .map((item) => {
      const out = { ...item };
      if (!SUGGESTIONS.has(out.suggestion)) out.suggestion = "review";
      if (typeof out.confidence !== "number" || !Number.isFinite(out.confidence)) out.confidence = 0.5;
      out.confidence = Math.min(1, Math.max(0, out.confidence));
      if (out.reason !== undefined && !REASONS.has(out.reason)) out.reason = "llm-quality";
      if (typeof out.detail === "string") out.detail = out.detail.slice(0, 500);
      if (typeof out.caption === "string") out.caption = out.caption.slice(0, 1000);
      if (Array.isArray(out.tags)) {
        out.tags = out.tags
          .filter((t) => typeof t === "string")
          .map((t) => t.toLowerCase().slice(0, 64))
          .slice(0, 32);
      } else {
        delete out.tags;
      }
      return out;
    })
    .slice(0, 64);

  if (obj.bestPicks && typeof obj.bestPicks === "object") {
    const picks = {};
    for (const [groupId, assetId] of Object.entries(obj.bestPicks)) {
      if (typeof assetId === "string" && valid.has(assetId)) picks[groupId] = assetId;
    }
    obj.bestPicks = picks;
  } else {
    obj.bestPicks = {};
  }
  return obj;
}

/** extract -> sanitize -> validate. Throws with the validation errors joined. */
export function parseJudgeResponse(text, validAssetIds) {
  const sanitized = sanitizeJudge(extractJson(text), validAssetIds);
  const result = parseJudgeBatch(sanitized);
  if (!result.ok) throw new Error(`judge response invalid: ${result.errors?.join("; ")}`);
  return result.value;
}
