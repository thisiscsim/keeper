// The LLM judge: GPT-5.5 vision over downscaled thumbs, only where local CV
// couldn't decide — borderline verdicts and burst best-pick ties. Budgeted
// (--budget N, default from KEEPER_AI_BUDGET or 200 items), batched, and its
// output is repaired-then-validated before a single row changes.
//
//   node app/scripts/judge-llm.mjs [--library <home>] [--budget 200] [--import <id>]
import fs from "node:fs";
import { generateText } from "ai";
import { openCatalog } from "./lib/catalog.mjs";
import { ensureLayout, resolveHome, safeJoin } from "./lib/paths.mjs";
import { readTaste, tasteForPrompt } from "./lib/taste.mjs";
import { parseJudgeResponse } from "./lib/llm-util.mjs";
import { isLlmConfigured, llmConfig, resolveModel, reasoningEffort } from "./llm.mjs";

const BATCH_SIZE = 8;
const MAX_OUTPUT_TOKENS = 4000;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const phase = (name) => console.log(`PHASE ${name}`);
const progress = (pct) => console.log(`PROGRESS ${Math.round(pct)}`);

/** Borderline = the confidence band where a second opinion changes routing. */
function isBorderline(asset) {
  if (!asset.ai) return true;
  if (asset.ai.source === "llm") return false; // already judged
  return asset.ai.confidence >= 0.3 && asset.ai.confidence <= 0.8;
}

function systemPrompt(taste) {
  const tasteBlock = tasteForPrompt(taste);
  return [
    "You are a photo culling assistant inside Keeper. You see downscaled previews of a photographer's shots that the local heuristics could not confidently sort.",
    "For each image decide: keep (worth reviewing/editing), reject (junk: blurry, misfire, badly exposed, meaningless), or review (genuinely ambiguous).",
    "IMPORTANT judgment calls:",
    "- A technically imperfect photo of a meaningful moment (people, emotion, once-in-a-lifetime scenes) is a KEEP with reason important-moment. Never reject for sharpness alone when the content clearly matters.",
    "- Duplicates/burst frames: prefer open eyes, natural expressions, better framing.",
    "- Be honest about confidence: 0.9+ only when unmistakable.",
    tasteBlock ? `\n${tasteBlock}` : "",
    "\nRespond with ONLY a JSON object:",
    '{"items":[{"assetId":"...","suggestion":"keep|reject|review","confidence":0.0,"reason":"blurry|eyes-closed|bad-framing|important-moment|llm-quality|other","detail":"short why","caption":"one-line description","tags":["lowercase","keywords"]}],"bestPicks":{"<groupId>":"<assetId>"}}',
  ].join("\n");
}

async function judgeBatch(model, taste, batch, groupsInBatch) {
  const content = [];
  for (const asset of batch) {
    const label = [
      `assetId: ${asset.id}`,
      asset.groupId ? `group: ${asset.groupId}` : null,
      asset.ai ? `local verdict: ${asset.ai.suggestion} (${asset.ai.reasons.map((r) => r.code).join(", ")})` : null,
      asset.mediaType === "video" ? `video poster frame, ${asset.durationSec ?? "?"}s` : null,
    ]
      .filter(Boolean)
      .join(" | ");
    content.push({ type: "text", text: label });
    content.push({ type: "image", image: asset.imageBytes });
  }
  if (groupsInBatch.length > 0) {
    content.push({
      type: "text",
      text: `Burst groups present: ${groupsInBatch.join(", ")} — pick the best frame per group in bestPicks.`,
    });
  }

  const { text } = await generateText({
    model,
    system: systemPrompt(taste),
    messages: [{ role: "user", content }],
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
  });

  const ids = batch.map((a) => a.id);
  try {
    return parseJudgeResponse(text, ids);
  } catch (err) {
    // One repair retry, carrying the validation error back to the model.
    const { text: retryText } = await generateText({
      model,
      system: systemPrompt(taste),
      messages: [
        { role: "user", content },
        { role: "assistant", content: text },
        {
          role: "user",
          content: `Your response failed validation: ${err.message}. Reply again with ONLY the corrected JSON object.`,
        },
      ],
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
    });
    return parseJudgeResponse(retryText, ids);
  }
}

async function main() {
  if (!isLlmConfigured()) {
    throw new Error("no model configured — add an API key in Settings or app/.env.local");
  }
  const home = ensureLayout(resolveHome(arg("library")));
  const catalog = openCatalog(home, { stampOnWrite: true });
  const budget = Math.max(1, Number(arg("budget")) || Number(process.env.KEEPER_AI_BUDGET) || 200);
  const importId = arg("import");
  const taste = readTaste(home);
  const { model: modelId } = llmConfig();

  try {
    phase("selecting borderline items");
    const candidates = catalog
      .listAssets({ importId, flag: "unrated", limit: 20_000 })
      .filter((a) => isBorderline(a) && a.thumbRel)
      .slice(0, budget);

    if (candidates.length === 0) {
      console.log(`DONE ${JSON.stringify({ judged: 0, batches: 0 })}`);
      return;
    }

    phase(`judging ${candidates.length} items with ${modelId}`);
    const model = resolveModel();
    let judged = 0;
    let batches = 0;

    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const slice = candidates.slice(i, i + BATCH_SIZE);
      const batch = [];
      for (const asset of slice) {
        try {
          batch.push({ ...asset, imageBytes: fs.readFileSync(safeJoin(home, asset.thumbRel)) });
        } catch {
          // unreadable thumb — skip this asset
        }
      }
      if (batch.length === 0) continue;
      const groupsInBatch = [...new Set(batch.map((a) => a.groupId).filter(Boolean))];

      try {
        const result = await judgeBatch(model, taste, batch, groupsInBatch);
        for (const item of result.items) {
          catalog.setAiVerdict(item.assetId, {
            suggestion: item.suggestion,
            confidence: item.confidence,
            reasons: [{ code: item.reason, detail: item.detail }],
            source: "llm",
            model: modelId,
            at: new Date().toISOString(),
          });
          const patch = {};
          if (item.caption) patch.caption = item.caption;
          if (item.tags && item.tags.length > 0) {
            const existing = catalog.getAsset(item.assetId)?.tags ?? [];
            patch.tags = [...new Set([...existing, ...item.tags])];
          }
          if (Object.keys(patch).length > 0) catalog.patchAsset(item.assetId, patch);
          catalog.markStage(item.assetId, "judge");
          judged++;
        }
        for (const [groupId, assetId] of Object.entries(result.bestPicks)) {
          if (catalog.getGroup(groupId)) catalog.setGroupPick(groupId, assetId, "llm");
        }
        batches++;
      } catch (err) {
        console.error(`ERROR batch failed: ${err?.message ?? err}`);
      }
      progress(Math.min(99, ((i + BATCH_SIZE) / candidates.length) * 100));
    }

    progress(100);
    console.log(`DONE ${JSON.stringify({ judged, batches, model: modelId })}`);
  } finally {
    catalog.close();
  }
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack ?? err}`);
  process.exit(1);
});
