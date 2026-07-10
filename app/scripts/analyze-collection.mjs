// Analyze a COLLECTION of reference videos into one rich, reusable style profile.
// Works on either the global library (--styleDir <abs>) or a project's own
// references (--slug <slug>). Samples frames, computes deterministic editing
// metrics, then (when an LLM is configured) distills frames + metrics into a
// prose style guide + per-reference exemplars the generator imitates. Without a
// model it still writes a solid deterministic profile.
//
// Run: node app/scripts/analyze-collection.mjs --styleDir /abs/styles/<id>
//      node app/scripts/analyze-collection.mjs --slug <slug>
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { generateText } from "ai";
import { isLlmConfigured, llmConfig, resolveModel, reasoningEffort } from "./llm.mjs";
import { extractJson } from "./edl-util.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const FRAMES_PER_CLIP = 6;
const MAX_VISION_FRAMES = 12;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const round = (n) => Math.round(n * 100) / 100;
const median = (xs) => {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const toHex = (r, g, b) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

function durationSec(file) {
  const res = spawnSync(ffmpegPath, ["-i", file], { encoding: "utf8" });
  const m = (res.stderr || "").match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
function sceneTimes(file) {
  const res = spawnSync(ffmpegPath, ["-i", file, "-vf", "select='gt(scene,0.4)',showinfo", "-f", "null", "-"], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  return [...(res.stderr || "").matchAll(/pts_time:(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
}
function paletteFor(file, atSec) {
  try {
    const res = spawnSync(
      ffmpegPath,
      ["-ss", String(atSec), "-i", file, "-frames:v", "1", "-vf", "scale=4:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { maxBuffer: 1 << 20 },
    );
    const buf = res.stdout;
    if (!buf || buf.length < 12) return [];
    return [0, 3, 6, 9].map((o) => toHex(buf[o], buf[o + 1], buf[o + 2]));
  } catch {
    return [];
  }
}
function avgPalette(palettes) {
  const valid = palettes.filter((p) => p.length >= 3);
  if (valid.length === 0) return [];
  const slots = Math.min(...valid.map((p) => p.length), 4);
  const acc = Array.from({ length: slots }, () => [0, 0, 0]);
  for (const p of valid) {
    for (let i = 0; i < slots; i++) {
      const n = parseInt(p[i].slice(1), 16);
      acc[i][0] += (n >> 16) & 255;
      acc[i][1] += (n >> 8) & 255;
      acc[i][2] += n & 255;
    }
  }
  return acc.map(([r, g, b]) => toHex(r / valid.length, g / valid.length, b / valid.length));
}

function sampleFrames(file, framesDir, base) {
  execFileSync(
    ffmpegPath,
    ["-y", "-i", file, "-vf", "fps=1/2,scale=512:-1", "-frames:v", String(FRAMES_PER_CLIP), path.join(framesDir, `${base}-%02d.jpg`)],
    { stdio: "ignore" },
  );
}

function resolvePaths() {
  const styleDir = arg("styleDir");
  const slug = arg("slug");
  if (styleDir) {
    return { sourcesDir: path.join(styleDir, "sources"), outDir: styleDir, profileName: "profile.json" };
  }
  if (slug) {
    const projectDir = path.join(process.env.APERTURE_PROJECTS_DIR || path.join(repoRoot, "projects"), slug);
    return { sourcesDir: path.join(projectDir, "references"), outDir: projectDir, profileName: "style.json" };
  }
  throw new Error("missing --styleDir or --slug");
}

function buildVisionPrompt(metricsJson) {
  return [
    "You are a senior short-form (vertical 9:16) video editor reverse-engineering a creator's aesthetic from sample frames of their past videos.",
    "Study the frames and the measured editing metrics, then output ONE reusable STYLE PROFILE as JSON.",
    "",
    "Return ONLY this JSON (no prose, no code fences):",
    `{
  "palette": ["#hex","#hex","#hex"],            // [text, background, accent] that matches the look
  "fontFamily": "a CSS font stack matching the vibe",
  "captionStyle": "karaoke|block|word|none",
  "grade": { "brightness": 1.0, "contrast": 1.0, "saturation": 1.0, "temperature": 0, "vignette": 0 },
  "hookPattern": "one sentence on how their opens grab attention",
  "textTreatment": "how on-screen text looks/behaves (size, position, weight, motion)",
  "transitions": ["fade|slide|wipe|whip|cut", "..."],
  "energy": 0.0,                                  // 0 calm .. 1 frenetic
  "musicEnergy": 0.0,                             // 0 none .. 1 tightly beat-synced
  "styleGuide": "2-4 paragraph guide a stranger could follow to reproduce the look/feel",
  "exemplars": [ { "source": "<filename>", "hook": "...", "beats": "...", "captionStyle": "...", "textTreatment": "...", "transitions": ["..."], "gradeNote": "..." } ],
  "do": ["3-6 concrete, transferable rules"],
  "avoid": ["3-6 things that would break the vibe"]
}`,
    "",
    "Learn GENERAL, transferable principles, not the literal contents of any one clip.",
    "",
    "=== MEASURED METRICS (ground truth for pacing/length) ===",
    metricsJson,
  ].join("\n");
}

async function main() {
  const { sourcesDir, outDir, profileName } = resolvePaths();
  const framesDir = path.join(outDir, ".frames");
  fs.mkdirSync(framesDir, { recursive: true });

  const videos = (fs.existsSync(sourcesDir) ? fs.readdirSync(sourcesDir) : []).filter((f) =>
    VIDEO_EXT.has(path.extname(f).toLowerCase()),
  );
  if (videos.length === 0) throw new Error(`no reference videos in ${sourcesDir}`);

  console.log(`PHASE analyzing ${videos.length} reference clips`);
  const perVideo = [];
  let done = 0;
  for (const f of videos) {
    const file = path.join(sourcesDir, f);
    const base = path.basename(f, path.extname(f)).replace(/[^a-zA-Z0-9_-]+/g, "-");
    const dur = durationSec(file);
    const scenes = sceneTimes(file);
    try {
      sampleFrames(file, framesDir, base);
    } catch {
      // frame sampling best-effort
    }
    perVideo.push({
      file: f,
      base,
      durationSec: round(dur),
      cutsPer10s: dur > 0 ? round((scenes.length / dur) * 10) : 0,
      hookSec: scenes.length ? round(scenes[0]) : undefined,
      palette: paletteFor(file, Math.max(0.5, dur / 2)),
    });
    done++;
    console.log(`PROGRESS ${Math.round((done / videos.length) * 60)}`);
  }

  const cuts = perVideo.map((v) => v.cutsPer10s).filter(Boolean);
  const lengths = perVideo.map((v) => v.durationSec).filter(Boolean);
  const medianCuts = median(cuts) ?? 0;
  const metrics = {
    clips: videos.length,
    palette: avgPalette(perVideo.map((v) => v.palette)),
    pacing: {
      cutsPer10s: round(medianCuts),
      avgShotSec: round(median(perVideo.map((v) => (v.cutsPer10s ? 10 / v.cutsPer10s : 0)).filter(Boolean)) ?? 0),
    },
    hookSec: round(median(perVideo.map((v) => v.hookSec).filter((x) => x != null)) ?? 0),
    targetLengthSec: round(median(lengths) ?? 0),
    energy: Math.max(0, Math.min(1, round((medianCuts - 1) / 11))),
    perVideo: perVideo.map(({ file, durationSec, cutsPer10s, hookSec }) => ({ file, durationSec, cutsPer10s, hookSec })),
  };

  const existing = (() => {
    try {
      return JSON.parse(fs.readFileSync(path.join(outDir, profileName), "utf8"));
    } catch {
      return {};
    }
  })();

  let profile = {
    id: existing.id ?? "learned",
    name: existing.name ?? "My Style",
    palette: metrics.palette,
    captionStyle: existing.captionStyle ?? "karaoke",
    pacing: metrics.pacing,
    hookSec: metrics.hookSec,
    energy: metrics.energy,
    targetLengthSec: metrics.targetLengthSec,
    exemplars: [],
    do: [],
    avoid: [],
    notes: "Deterministic baseline (no model). Configure an LLM for a richer style guide.",
    source: { clips: videos.length, generatedAt: new Date().toISOString() },
  };

  if (isLlmConfigured()) {
    const { provider, model } = llmConfig();
    console.log(`PHASE distilling style with ${provider}/${model}`);
    // Gather a capped, spread-out set of frames across videos for vision.
    const frameFiles = fs.readdirSync(framesDir).filter((f) => f.endsWith(".jpg")).sort();
    const step = Math.max(1, Math.floor(frameFiles.length / MAX_VISION_FRAMES));
    const chosen = frameFiles.filter((_, i) => i % step === 0).slice(0, MAX_VISION_FRAMES);
    const images = chosen.map((f) => ({ type: "image", image: fs.readFileSync(path.join(framesDir, f)) }));

    try {
      const { text } = await generateText({
        model: resolveModel(),
        maxOutputTokens: 4000,
        providerOptions: { openai: { reasoningEffort: reasoningEffort() } },
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: buildVisionPrompt(JSON.stringify(metrics, null, 2)) }, ...images],
          },
        ],
      });
      console.log("PROGRESS 90");
      const llm = extractJson(text);
      // LLM owns look/feel + guide + exemplars; deterministic metrics win for pacing/length.
      profile = {
        ...profile,
        palette: Array.isArray(llm.palette) && llm.palette.length ? llm.palette : profile.palette,
        fontFamily: llm.fontFamily ?? existing.fontFamily,
        captionStyle: llm.captionStyle ?? profile.captionStyle,
        grade: llm.grade ?? undefined,
        hookPattern: llm.hookPattern,
        textTreatment: llm.textTreatment,
        transitions: Array.isArray(llm.transitions) ? llm.transitions : [],
        energy: typeof llm.energy === "number" ? llm.energy : profile.energy,
        musicEnergy: typeof llm.musicEnergy === "number" ? llm.musicEnergy : undefined,
        styleGuide: llm.styleGuide,
        exemplars: Array.isArray(llm.exemplars) ? llm.exemplars : [],
        do: Array.isArray(llm.do) ? llm.do : [],
        avoid: Array.isArray(llm.avoid) ? llm.avoid : [],
        notes: "Distilled from frames + metrics by the LLM.",
      };
    } catch (err) {
      console.error(`ERROR LLM distillation failed, keeping deterministic profile: ${err}`);
    }
  }

  fs.writeFileSync(path.join(outDir, profileName), `${JSON.stringify(profile, null, 2)}\n`);
  if (profile.styleGuide) fs.writeFileSync(path.join(outDir, "style-guide.md"), `${profile.styleGuide}\n`);
  console.log("PROGRESS 100");
  console.log(`DONE ${path.join(outDir, profileName)}`);
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack || err}`);
  process.exit(1);
});
