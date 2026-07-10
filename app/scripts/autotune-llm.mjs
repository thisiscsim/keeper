// LLM-backed auto-improve loop (the Claudia auto-skills pattern): each iteration
// the model critiques the current cut and returns an improved edl.json plus a
// 0-100 score and a one-line change note. We validate, write, log the score
// trajectory to results.tsv, and stop on target/plateau/iteration cap.
// Provider-agnostic (default GPT-5.5; see llm.mjs).
//
// Run: `OPENAI_API_KEY=... node app/scripts/autotune-llm.mjs --slug <slug> [--iterations 3] [--target 88]`
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { generateText } from "ai";
import { parseEdl } from "@reel/edl";
import { isLlmConfigured, llmConfig, resolveModel, reasoningEffort } from "./llm.mjs";
import { ANIM_NAMES, extractJson, metrics, restoreAudioTracks, sanitizeEdl } from "./edl-util.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function readMaybe(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function buildPrompt({ edlJson, metricsJson, promptMd, styleJson, benchmarksJson }) {
  return [
    "You are an expert short-form (vertical 9:16) video editor improving a cut, one focused pass at a time.",
    "Critique the CURRENT edit, then return an IMPROVED version that fixes the 1-2 highest-impact problems",
    "(weakest of: hook in first 2s, pacing/cuts, captions, safe margins, length, audio, ending).",
    "If a benchmarks distribution is given, move pacing/length toward its means.",
    "",
    "Return ONLY this JSON (no prose, no code fences):",
    '{ "score": <your 0-100 estimate of the IMPROVED cut>, "change": "<one line: what you changed and why>", "edl": <the COMPLETE improved edl.json object> }',
    "",
    "Constraints for `edl`:",
    "- Same shape/keys as the input; only use assets already present (same id/src).",
    `- Every text clip's anim, if present, must be {"name":"<one of ${ANIM_NAMES.join("|")}>","from":"animate-text"} (name REQUIRED) — or omit anim.`,
    "- Keep it schema-valid; respect theme.safeMargins.",
    "",
    "=== DETERMINISTIC METRICS (ground truth) ===",
    metricsJson,
    "",
    "=== CREATOR PROMPT ===",
    promptMd || "(none)",
    "",
    "=== STYLE PROFILE ===",
    styleJson || "(none)",
    "",
    "=== BENCHMARKS ===",
    benchmarksJson || "(none)",
    "",
    "=== CURRENT edl.json ===",
    edlJson,
  ].join("\n");
}

async function main() {
  const slug = arg("slug");
  if (!slug) throw new Error("missing --slug");
  if (!isLlmConfigured()) {
    console.error("ERROR no LLM credentials configured (set OPENAI_API_KEY or APERTURE_LLM_API_KEY).");
    process.exit(3);
  }
  const maxIterations = Number(arg("iterations") ?? 3);
  const target = Number(arg("target") ?? 88);

  const projectDir = path.join(process.env.APERTURE_PROJECTS_DIR || path.join(repoRoot, "projects"), slug);
  const edlPath = path.join(projectDir, "edl.json");
  if (!fs.existsSync(edlPath)) {
    console.error("ERROR no edl.json to improve");
    process.exit(2);
  }
  const promptMd = readMaybe(path.join(projectDir, "prompt.md"));
  const styleJson = readMaybe(path.join(projectDir, "style.json"));
  const benchmarksJson = readMaybe(path.join(projectDir, "benchmarks.json")) || "(none)";

  const resultsPath = path.join(projectDir, "results.tsv");
  if (!fs.existsSync(resultsPath)) fs.writeFileSync(resultsPath, "iter\tscore\tdelta\tchange\n");

  const { provider, model } = llmConfig();
  const llm = resolveModel();
  let edl = JSON.parse(readMaybe(edlPath));
  let prev = null;
  let stagnant = 0;

  for (let i = 1; i <= maxIterations; i++) {
    console.log(`PHASE iteration ${i}/${maxIterations} (${provider}/${model})`);
    const prompt = buildPrompt({
      edlJson: JSON.stringify(edl, null, 2),
      metricsJson: JSON.stringify(metrics(edl), null, 2),
      promptMd,
      styleJson,
      benchmarksJson,
    });

    let out;
    try {
      const { text } = await generateText({
        model: llm,
        prompt,
        maxOutputTokens: 16000,
        providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
      });
      out = extractJson(text);
    } catch (err) {
      console.error(`ERROR iteration ${i} model call failed: ${err}`);
      break;
    }

    const candidate = sanitizeEdl(out.edl);
    const parsed = parseEdl(candidate);
    if (!parsed.ok || !parsed.edl) {
      console.log(`PHASE iteration ${i} produced invalid edl, stopping`);
      break;
    }
    const score = typeof out.score === "number" ? Math.round(out.score) : prev ?? 0;
    const change = typeof out.change === "string" ? out.change.slice(0, 120) : "revised edit";

    // Never let an improvement pass silently drop the music bed / voiceover.
    edl = restoreAudioTracks(parsed.edl, edl);
    fs.writeFileSync(edlPath, `${JSON.stringify(edl, null, 2)}\n`);
    const delta = prev == null ? 0 : score - prev;
    fs.appendFileSync(resultsPath, `${i}\t${score}\t${delta >= 0 ? "+" : ""}${delta}\t${change}\n`);
    console.log(`PHASE ${change} -> ${score}`);
    console.log(`PROGRESS ${Math.round((i / maxIterations) * 100)}`);

    if (score >= target) {
      console.log("PHASE target reached");
      prev = score;
      break;
    }
    if (prev != null && delta < 2) {
      stagnant++;
      if (stagnant >= 2) {
        console.log("PHASE score plateaued");
        prev = score;
        break;
      }
    } else {
      stagnant = 0;
    }
    prev = score;
  }

  console.log(`DONE final score ${prev ?? "n/a"}`);
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack || err}`);
  process.exit(1);
});
