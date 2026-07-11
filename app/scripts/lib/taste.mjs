// taste.json — the learned culling profile. Pure read/merge/update helpers so
// the feedback logic is unit-testable; disk I/O stays thin.
import fs from "node:fs";
import { parseTasteProfile } from "@keeper/schema";
import { tastePath } from "./paths.mjs";

export function readTaste(home) {
  try {
    return parseTasteProfile(JSON.parse(fs.readFileSync(tastePath(home), "utf8")));
  } catch {
    return parseTasteProfile({});
  }
}

export function writeTaste(home, taste) {
  const validated = parseTasteProfile(taste);
  validated.updatedAt = new Date().toISOString();
  fs.writeFileSync(tastePath(home), `${JSON.stringify(validated, null, 2)}\n`);
  return validated;
}

const MAX_EXEMPLARS = 200;

/**
 * Fold one user verdict into the profile. Overrides (user contradicts the AI)
 * become few-shot exemplars + stats; confirmations only bump stats. Returns
 * the updated profile (callers persist it).
 */
export function recordVerdict(taste, { asset, userFlag }) {
  const ai = asset.ai;
  if (!ai || userFlag === "unrated") return taste;
  const reason = ai.reasons[0]?.code ?? "other";
  const stats = { ...taste.stats };
  const entry = { kept: 0, confirmed: 0, ...(stats[reason] ?? {}) };

  const contradicts =
    (ai.suggestion === "reject" && userFlag === "pick") ||
    (ai.suggestion === "keep" && userFlag === "reject");

  if (contradicts) {
    entry.kept += 1;
    stats[reason] = entry;
    const exemplar = {
      assetId: asset.id,
      thumbRel: asset.thumbRel,
      aiSuggestion: ai.suggestion,
      aiReason: reason,
      userFlag,
      at: new Date().toISOString(),
    };
    return {
      ...taste,
      stats,
      exemplars: [...taste.exemplars.slice(-(MAX_EXEMPLARS - 1)), exemplar],
    };
  }

  const confirms =
    (ai.suggestion === "reject" && userFlag === "reject") ||
    (ai.suggestion === "keep" && userFlag === "pick");
  if (confirms) {
    entry.confirmed += 1;
    stats[reason] = entry;
    return { ...taste, stats };
  }
  return taste;
}

/**
 * Re-derive thresholds from override stats: repeated "you rejected this but I
 * kept it" signals loosen the matching threshold, and vice versa. Moves are
 * deliberately small and bounded so a handful of clicks can't swing the
 * pipeline wildly.
 */
export function tunedThresholds(taste) {
  const t = { ...taste.thresholds };
  const blur = taste.stats["blurry"] ?? { kept: 0, confirmed: 0 };
  // Every 5 net overrides of blur rejects lowers the reject bar ~20%, floor 4.
  const netKept = Math.max(0, blur.kept - blur.confirmed / 4);
  const steps = Math.min(5, Math.floor(netKept / 5));
  t.blurReject = Math.max(4, t.blurReject * 0.8 ** steps);

  const exposure = combineStats(taste.stats, ["underexposed", "overexposed"]);
  const expSteps = Math.min(4, Math.floor(Math.max(0, exposure.kept - exposure.confirmed / 4) / 5));
  t.clipReject = Math.min(0.95, t.clipReject + expSteps * 0.08);

  return t;
}

function combineStats(stats, codes) {
  return codes.reduce(
    (acc, code) => {
      const s = stats[code] ?? { kept: 0, confirmed: 0 };
      return { kept: acc.kept + s.kept, confirmed: acc.confirmed + s.confirmed };
    },
    { kept: 0, confirmed: 0 },
  );
}

/** Render the standing rules + recent overrides for LLM judge prompts. */
export function tasteForPrompt(taste, { maxExemplars = 12 } = {}) {
  const lines = [];
  if (taste.rules.length > 0) {
    lines.push("The user's standing rules (follow them strictly):");
    for (const rule of taste.rules) lines.push(`- ${rule.text}`);
  }
  const recent = taste.exemplars.slice(-maxExemplars);
  if (recent.length > 0) {
    lines.push("Recent corrections (the user disagreed with the AI; learn from these):");
    for (const ex of recent) {
      lines.push(
        `- AI said ${ex.aiSuggestion}${ex.aiReason ? ` (${ex.aiReason})` : ""}, user chose ${ex.userFlag}${ex.note ? ` — ${ex.note}` : ""}`,
      );
    }
  }
  return lines.join("\n");
}
