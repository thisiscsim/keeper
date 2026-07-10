// Draft voiceover narration for a project's current cut (Claudia-style: the
// LLM writes, the human reviews in the VO dialog before any TTS credits burn).
// Reads prompt.md + edl.json (+ style.json when present), sizes the script to
// the cut (~2.5 spoken words/sec), and writes projects/<slug>/narration.md.
//
// Run: OPENAI_API_KEY=... node app/scripts/write-narration.mjs --slug <slug>
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { generateText } from "ai";
import { isLlmConfigured, llmConfig, resolveModel, reasoningEffort } from "./llm.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const WORDS_PER_SEC = 2.5;

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

function videoLengthSec(edl) {
  return (edl.tracks ?? [])
    .filter((t) => t.type === "video")
    .flatMap((t) => t.clips ?? [])
    .reduce((m, c) => Math.max(m, (c.start ?? 0) + (c.out ?? 0) - (c.in ?? 0)), 0);
}

async function main() {
  const slug = arg("slug");
  if (!slug) throw new Error("missing --slug");
  if (!isLlmConfigured()) {
    console.error("ERROR no LLM credentials configured (set OPENAI_API_KEY in app/.env.local).");
    process.exit(3);
  }

  const projectDir = path.join(process.env.APERTURE_PROJECTS_DIR || path.join(repoRoot, "projects"), slug);
  const edl = JSON.parse(readMaybe(path.join(projectDir, "edl.json")) || "{}");
  const promptMd = readMaybe(path.join(projectDir, "prompt.md"));
  const style = readMaybe(path.join(projectDir, "style.json"));

  const lenSec = Math.max(videoLengthSec(edl), 6);
  const targetWords = Math.round(lenSec * WORDS_PER_SEC);
  const overlays = (edl.tracks ?? [])
    .filter((t) => t.type === "text")
    .flatMap((t) => t.clips ?? [])
    .map((c) => `${c.start}s: "${c.text}"`)
    .join("\n");

  const { provider, model } = llmConfig();
  console.log(`PHASE drafting narration with ${provider}/${model}`);

  const { text } = await generateText({
    model: resolveModel(),
    maxOutputTokens: 2000,
    providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
    prompt: [
      "You write spoken voiceover narration for a short-form vertical social video.",
      `The cut is ${lenSec.toFixed(1)} seconds long. Write about ${targetWords} words (spoken pace ~2.5 words/sec) — never more than ${Math.round(targetWords * 1.15)}.`,
      "Rules:",
      "- Return ONLY the narration text. No headings, no quotes, no stage directions, no markdown.",
      "- Short, spoken-language sentences. Contractions are good. No em-dash pivots, no 'stop X, start Y' patterns.",
      "- Separate beats with a blank line (paragraph = beat).",
      "- Open with a hook line that lands in the first two seconds.",
      "- Don't read the on-screen text verbatim; complement it.",
      "",
      "=== CREATOR PROMPT ===",
      promptMd || "(none)",
      "",
      "=== ON-SCREEN TEXT OVERLAYS ===",
      overlays || "(none)",
      "",
      "=== STYLE PROFILE (may be empty) ===",
      style || "(none)",
    ].join("\n"),
  });

  const narration = text.trim();
  if (!narration) {
    console.error("ERROR model returned an empty narration");
    process.exit(2);
  }
  fs.writeFileSync(path.join(projectDir, "narration.md"), `${narration}\n`);
  console.log(`DONE ${narration.split(/\s+/).length} words for ${lenSec.toFixed(1)}s`);
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack || err}`);
  process.exit(1);
});
