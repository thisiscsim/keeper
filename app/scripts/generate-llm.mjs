// LLM-backed first cut via a single structured-output call (cost-predictable),
// provider-agnostic (default GPT-5.5; see llm.mjs for the escape hatch).
//
// Flow: run the cheap local baseline (analyze.mjs) to probe clips and produce a
// valid edl.json skeleton, then ask the model to REFINE it from prompt.md +
// style.json. One model call (with one repair retry on invalid JSON), validated
// against EdlSchema before writing.
//
// Run: `OPENAI_API_KEY=... node app/scripts/generate-llm.mjs --slug <slug>`
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { generateText } from "ai";
import { parseEdl } from "@reel/edl";
import { isLlmConfigured, llmConfig, resolveModel, reasoningEffort } from "./llm.mjs";
import { ANIM_NAMES, enforceStyle, extractJson, restoreAudioTracks, sanitizeEdl } from "./edl-util.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
// Reasoning models spend tokens on hidden reasoning before the JSON, so give
// the completion generous headroom.
const MAX_OUTPUT_TOKENS = 16000;

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
function readJsonMaybe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function stylesDir() {
  return process.env.APERTURE_STYLES_DIR || path.join(repoRoot, "styles");
}

// A profile is "analyzed" (rich) once the LLM has distilled a guide/exemplars;
// the deterministic baseline has neither.
function isAnalyzed(p) {
  return Boolean(p && (p.styleGuide || (Array.isArray(p.exemplars) && p.exemplars.length > 0)));
}

// Style ids are opaque slugs we generate ourselves (slugify). meta.json is
// part of a shareable project, so treat styleProfileId as untrusted: anything
// that could traverse out of the styles dir is ignored.
function safeStyleId(id) {
  return typeof id === "string" && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(id) ? id : undefined;
}

// Resolve the active style + where to (re)analyze it from:
//   1. project's own style.json (override)  -> analyze via --slug references
//   2. meta.styleProfileId library profile   -> analyze via --styleDir
//   3. exactly one library style exists       -> auto-select it
function resolveActiveStyle(projectDir, slug) {
  const localPath = path.join(projectDir, "style.json");
  if (fs.existsSync(localPath)) {
    return { profile: readJsonMaybe(localPath), kind: "project", analyzeArgs: ["--slug", slug], profilePath: localPath };
  }
  const meta = readJsonMaybe(path.join(projectDir, "meta.json")) ?? {};
  const dir = stylesDir();
  let id = safeStyleId(meta.styleProfileId);
  if (!id) {
    try {
      const dirs = fs
        .readdirSync(dir)
        .filter((d) => fs.existsSync(path.join(dir, d, "sources")) || fs.existsSync(path.join(dir, d, "profile.json")));
      if (dirs.length === 1) id = dirs[0];
    } catch {
      // no library
    }
  }
  if (id) {
    const styleDir = path.resolve(dir, id);
    // Belt-and-braces containment: the id regex already forbids traversal.
    if (!styleDir.startsWith(path.resolve(dir) + path.sep)) return { profile: null };
    return {
      profile: readJsonMaybe(path.join(styleDir, "profile.json")),
      kind: "library",
      analyzeArgs: ["--styleDir", styleDir],
      profilePath: path.join(styleDir, "profile.json"),
    };
  }
  return { profile: null };
}

// Turn a profile into concrete directives + retrieved exemplars for the prompt.
function styleBlock(profile) {
  if (!profile) return "(none — use the prompt and general best practices)";
  const parts = [];
  parts.push(
    profile.referenceMode === "inspired"
      ? "REFERENCE MODE: inspired — treat the references as a loose vibe; capture the mood and energy but freely depart from their exact structure."
      : "REFERENCE MODE: literal — imitate the references' edit structure closely (hook shape, pacing, caption/text treatment, transitions).",
  );
  if (profile.styleGuide) parts.push(`STYLE GUIDE:\n${profile.styleGuide}`);
  const d = [];
  if (profile.palette?.length) d.push(`palette [text,bg,accent] = ${profile.palette.slice(0, 3).join(", ")}`);
  if (profile.fontFamily) d.push(`fontFamily = ${profile.fontFamily}`);
  if (profile.captionStyle) d.push(`captionStyle = ${profile.captionStyle}`);
  if (profile.grade) d.push(`grade = ${JSON.stringify(profile.grade)}`);
  if (profile.pacing?.cutsPer10s) d.push(`pacing ~= ${profile.pacing.cutsPer10s} cuts/10s`);
  if (profile.targetLengthSec) d.push(`target length ~= ${profile.targetLengthSec}s`);
  if (profile.hookPattern) d.push(`hook = ${profile.hookPattern}`);
  if (profile.textTreatment) d.push(`text treatment = ${profile.textTreatment}`);
  if (profile.transitions?.length) d.push(`transitions = ${profile.transitions.join(", ")}`);
  if (d.length) parts.push(`DIRECTIVES:\n- ${d.join("\n- ")}`);
  if (profile.do?.length) parts.push(`DO: ${profile.do.join("; ")}`);
  if (profile.avoid?.length) parts.push(`AVOID: ${profile.avoid.join("; ")}`);
  const ex = (profile.exemplars ?? []).slice(0, 3);
  if (ex.length) parts.push(`EXEMPLARS (imitate this edit structure):\n${JSON.stringify(ex, null, 2)}`);
  return parts.join("\n\n");
}

function formatLabel(baselineJson) {
  try {
    const f = JSON.parse(baselineJson).format ?? {};
    const w = f.width ?? 1080;
    const h = f.height ?? 1920;
    const orient = w === h ? "square 1:1" : w > h ? "landscape 16:9" : "vertical 9:16";
    return `${orient}, ${w}x${h} @ ${f.fps ?? 30}fps`;
  } catch {
    return "vertical 9:16, 1080x1920 @ 30fps";
  }
}

function buildPrompt(baselineJson, promptMd, profile) {
  return [
    `You are an expert short-form (${formatLabel(baselineJson)}) video editor.`,
    "Refine the BASELINE edit decision list (edl.json) into a polished first cut that closely matches the creator's STYLE.",
    "",
    "Return ONLY a single JSON object — the complete updated edl.json. No prose, no code fences.",
    "",
    "Rules:",
    "- Keep the exact same shape/keys as the baseline (it is already schema-valid).",
    "- Only use assets that exist in the baseline `assets` array (same `id` and `src`).",
    "- Keep every audio track and its clips from the baseline (music bed, voiceover) — never remove or silence them unless the CREATOR PROMPT explicitly asks.",
    "- Make the first ~2 seconds a strong hook; reorder/trim video clips to match the target pacing.",
    "- Add a `text` track with title/subtitle overlays derived from the prompt, in the style's text treatment.",
    `- Every text clip MUST have this exact shape: {"id":"t1","start":0.2,"end":2.6,"text":"...","style":"title"|"subtitle","anim":{"name":"<one of ${ANIM_NAMES.join("|")}>","from":"animate-text"}}. The anim.name field is REQUIRED — never omit it. Or omit the whole "anim" key.`,
    "- Set theme.palette, theme.fontFamily, theme.captionStyle, and theme.grade to match the STYLE.",
    "- Respect theme.safeMargins; keep captions/text out of platform UI zones.",
    "- Mirror the STYLE's pacing, hook, transitions, and text treatment as closely as the available clips allow.",
    "",
    "=== CREATOR PROMPT (prompt.md) ===",
    promptMd || "(none)",
    "",
    "=== STYLE (learned from the creator's reference videos) ===",
    styleBlock(profile),
    "",
    "=== BASELINE edl.json ===",
    baselineJson,
  ].join("\n");
}

async function main() {
  const slug = arg("slug");
  if (!slug) throw new Error("missing --slug");
  if (!isLlmConfigured()) {
    console.error("ERROR no LLM credentials configured (set APERTURE_LLM_API_KEY or OPENAI_API_KEY).");
    process.exit(3);
  }

  const projectDir = path.join(process.env.APERTURE_PROJECTS_DIR || path.join(repoRoot, "projects"), slug);
  const edlPath = path.join(projectDir, "edl.json");

  // 1) Deterministic baseline (probes clips, writes a valid edl.json skeleton).
  console.log("PHASE assembling baseline");
  const baseline = spawnSync("node", [path.join(__dirname, "analyze.mjs"), "--slug", slug], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (baseline.status !== 0) {
    console.error(`ERROR baseline assembly failed: ${baseline.stderr || baseline.status}`);
    process.exit(2);
  }

  const baselineJson = readMaybe(edlPath);
  const promptMd = readMaybe(path.join(projectDir, "prompt.md"));

  // Resolve the active style and lazily analyze it (once, cached) so the user
  // never has to click Analyze/Use manually.
  const active = resolveActiveStyle(projectDir, slug);
  if (active.analyzeArgs && !isAnalyzed(active.profile)) {
    console.log("PHASE learning your style");
    const r = spawnSync("node", [path.join(__dirname, "analyze-collection.mjs"), ...active.analyzeArgs], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (r.status === 0) active.profile = readJsonMaybe(active.profilePath) ?? active.profile;
    // If analysis fails (e.g. no source clips), continue with whatever profile exists.
  }
  const profile = active.profile;

  const { provider, model } = llmConfig();
  console.log(`PHASE editing with ${provider}/${model}${profile ? ` (style: ${profile.name ?? profile.id})` : ""}`);

  const llm = resolveModel();
  const base = buildPrompt(baselineJson, promptMd, profile);
  let prompt = base;
  let edl = null;
  let lastError = "";

  for (let attempt = 0; attempt < 2 && !edl; attempt++) {
    const { text } = await generateText({
      model: llm,
      prompt,
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      // Reasoning models (e.g. gpt-5.5) reject `temperature`; keep effort modest
      // for latency/cost. providerOptions is ignored by non-OpenAI providers.
      providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
    });
    try {
      const candidate = sanitizeEdl(extractJson(text));
      const parsed = parseEdl(candidate);
      if (parsed.ok && parsed.edl) {
        edl = parsed.edl;
      } else {
        lastError = (parsed.errors ?? ["invalid edl"]).join("; ");
        prompt = `${base}\n\nYour previous output was invalid: ${lastError}\nReturn corrected JSON only.`;
      }
    } catch (err) {
      lastError = String(err);
      prompt = `${base}\n\nYour previous output could not be parsed: ${lastError}\nReturn a single valid JSON object only.`;
    }
  }

  if (!edl) {
    console.error(`ERROR model did not produce a valid edl.json (${lastError}). Baseline was kept.`);
    process.exit(2);
  }

  // Stamp the measurable look so the style shows even if the model under-applied it,
  // and re-attach any audio the model dropped (music bed / voiceover).
  edl = enforceStyle(edl, profile);
  try {
    edl = restoreAudioTracks(edl, JSON.parse(baselineJson));
  } catch {
    // baseline unreadable — keep the model's cut as-is
  }

  console.log("PHASE writing edl.json");
  fs.writeFileSync(edlPath, `${JSON.stringify(edl, null, 2)}\n`);
  console.log(`DONE generated ${slug}/edl.json`);
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack || err}`);
  process.exit(1);
});
