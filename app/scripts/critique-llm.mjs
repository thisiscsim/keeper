// LLM-backed critique. Reads the cut + prompt + style + benchmarks, scores it
// (grounded in deterministic metrics so numbers aren't hallucinated), and writes
// projects/<slug>/critique.json in the shape the editor's Critique panel renders.
// Provider-agnostic (default GPT-5.5; see llm.mjs).
//
// Run: `OPENAI_API_KEY=... node app/scripts/critique-llm.mjs --slug <slug>`
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { generateText } from "ai";
import { isLlmConfigured, llmConfig, resolveModel, reasoningEffort } from "./llm.mjs";
import { extractJson, metrics } from "./edl-util.mjs";

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

const SHAPE = `{
  "score": <0-100 int = sum of subscore scores>,
  "subscores": [
    { "key": "hook", "label": "Hook (first 2s)", "max": 25, "score": <int>, "note": "<short>" },
    { "key": "pacing", "label": "Pacing", "max": 15, "score": <int>, "note": "<short>", "benchmark": { "yours": <num>, "theirs": <num>, "unit": "cuts/10s" } },
    { "key": "captions", "label": "Captions", "max": 15, "score": <int>, "note": "<short>" },
    { "key": "safe", "label": "Safe areas", "max": 10, "score": <int>, "note": "<short>" },
    { "key": "length", "label": "Length", "max": 10, "score": <int>, "note": "<short>", "benchmark": { "yours": <num>, "theirs": <num>, "unit": "s" } },
    { "key": "audio", "label": "Audio", "max": 15, "score": <int>, "note": "<short>" },
    { "key": "ending", "label": "Ending", "max": 10, "score": <int>, "note": "<short>" }
  ],
  "fixes": [ { "issue": "<short>", "fix": "<concrete, actionable>" } ],
  "benchmarksUsed": <bool>,
  "summary": "<one or two sentences>"
}`;

function buildPrompt({ metricsJson, edlJson, promptMd, styleJson, benchmarksJson }) {
  const hasBench = benchmarksJson && benchmarksJson !== "(none)";
  return [
    "You are a demanding short-form (vertical 9:16) video editor critiquing a cut.",
    'Grade to the standard of "would this stop the scroll and earn a rewatch?". Most AI first cuts are 45-65; above 80 means genuinely strong. Score what is actually present, not intent.',
    "",
    "Weighting: hook 25, pacing 15, captions 15, safe-area 10, length 10, audio 15, ending 10 (sums to 100).",
    hasBench
      ? "A benchmarks distribution of the creator's own high-performers is provided. Score PACING and LENGTH relative to it (full marks within ~1 std of the mean) and fill each `benchmark` with {yours, theirs=mean, unit}. Set benchmarksUsed=true."
      : "No benchmarks provided — score on best-practice heuristics, omit the `benchmark` fields, and set benchmarksUsed=false.",
    "",
    "Return ONLY this JSON object, no prose, no code fences:",
    SHAPE,
    "",
    "=== DETERMINISTIC METRICS (ground truth — do not contradict) ===",
    metricsJson,
    "",
    "=== CREATOR PROMPT (prompt.md) ===",
    promptMd || "(none)",
    "",
    "=== STYLE PROFILE (style.json) ===",
    styleJson || "(none)",
    "",
    "=== BENCHMARKS (benchmarks.json) ===",
    hasBench ? benchmarksJson : "(none)",
    "",
    "=== edl.json ===",
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

  const projectDir = path.join(process.env.APERTURE_PROJECTS_DIR || path.join(repoRoot, "projects"), slug);
  const edlRaw = readMaybe(path.join(projectDir, "edl.json"));
  if (!edlRaw) {
    console.error("ERROR no edl.json to critique");
    process.exit(2);
  }
  const edl = JSON.parse(edlRaw);
  const metricsJson = JSON.stringify(metrics(edl), null, 2);
  const promptMd = readMaybe(path.join(projectDir, "prompt.md"));
  const styleJson = readMaybe(path.join(projectDir, "style.json"));
  const benchmarksJson = readMaybe(path.join(projectDir, "benchmarks.json")) || "(none)";

  const { provider, model } = llmConfig();
  console.log(`PHASE critiquing with ${provider}/${model}`);

  const { text } = await generateText({
    model: resolveModel(),
    prompt: buildPrompt({ metricsJson, edlJson: edlRaw, promptMd, styleJson, benchmarksJson }),
    maxOutputTokens: 6000,
    providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
  });

  let critique;
  try {
    critique = extractJson(text);
  } catch (err) {
    console.error(`ERROR could not parse critique JSON: ${err}`);
    process.exit(2);
  }
  if (typeof critique.score !== "number" || !Array.isArray(critique.subscores)) {
    console.error("ERROR critique JSON missing score/subscores");
    process.exit(2);
  }

  fs.writeFileSync(path.join(projectDir, "critique.json"), `${JSON.stringify(critique, null, 2)}\n`);
  console.log(`DONE critique score ${critique.score}`);
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack || err}`);
  process.exit(1);
});
