// Deterministic baseline for aesthetic learning. Probes the creator's own past
// videos in projects/<slug>/references/ and writes a baseline style.json
// (palette, pacing, length, energy). The richer, interpretive layer (hook
// patterns, do/avoid, narrative) is added by the `learn-aesthetic` agent skill
// on top of this, exactly as create-social-video builds on analyze.mjs.
//
// Run: `node app/scripts/analyze-style.mjs --slug <slug>`
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);

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
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");

function durationSec(file) {
  const res = spawnSync(ffmpegPath, ["-i", file], { encoding: "utf8" });
  const m = (res.stderr || "").match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

// Count hard cuts via ffmpeg scene-change detection.
function countCuts(file) {
  const res = spawnSync(
    ffmpegPath,
    ["-i", file, "-vf", "select='gt(scene,0.4)',showinfo", "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  const matches = (res.stderr || "").match(/pts_time:/g);
  return matches ? matches.length : 0;
}

// Crude 3-swatch palette: one mid-clip frame downscaled to 3x1 raw RGB.
function paletteFor(file, atSec) {
  try {
    const res = spawnSync(
      ffmpegPath,
      ["-ss", String(atSec), "-i", file, "-frames:v", "1", "-vf", "scale=3:1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { maxBuffer: 1 << 20 },
    );
    const buf = res.stdout;
    if (!buf || buf.length < 9) return [];
    return [0, 3, 6].map((o) => toHex(buf[o], buf[o + 1], buf[o + 2]));
  } catch {
    return [];
  }
}

function avgPalette(palettes) {
  const valid = palettes.filter((p) => p.length === 3);
  if (valid.length === 0) return [];
  const acc = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (const p of valid) {
    p.forEach((hex, i) => {
      const n = parseInt(hex.slice(1), 16);
      acc[i][0] += (n >> 16) & 255;
      acc[i][1] += (n >> 8) & 255;
      acc[i][2] += n & 255;
    });
  }
  return acc.map(([r, g, b]) => toHex(Math.round(r / valid.length), Math.round(g / valid.length), Math.round(b / valid.length)));
}

async function main() {
  const slug = arg("slug");
  if (!slug) throw new Error("missing --slug");

  const projectDir = path.join(process.env.APERTURE_PROJECTS_DIR || path.join(repoRoot, "projects"), slug);
  const refDir = path.join(projectDir, "references");
  const videos = (fs.existsSync(refDir) ? fs.readdirSync(refDir) : []).filter((f) =>
    VIDEO_EXT.has(path.extname(f).toLowerCase()),
  );
  if (videos.length === 0) throw new Error("no reference videos in references/");

  console.log(`PHASE analyzing ${videos.length} reference clips`);
  const cutsPer10s = [];
  const shotLens = [];
  const lengths = [];
  const palettes = [];

  let done = 0;
  for (const f of videos) {
    const file = path.join(refDir, f);
    const dur = durationSec(file);
    const cuts = countCuts(file);
    if (dur > 0) {
      cutsPer10s.push((cuts / dur) * 10);
      shotLens.push(dur / (cuts + 1));
      lengths.push(dur);
      palettes.push(paletteFor(file, Math.max(0.5, dur / 2)));
    }
    done++;
    console.log(`PROGRESS ${Math.round((done / videos.length) * 100)}`);
  }

  const medianCuts = median(cutsPer10s) ?? 0;
  // energy: ~0 at 1 cut / 10s, ~1 at 12 cuts / 10s.
  const energy = Math.max(0, Math.min(1, round((medianCuts - 1) / 11)));

  const stylePath = path.join(projectDir, "style.json");
  const existing = fs.existsSync(stylePath) ? JSON.parse(fs.readFileSync(stylePath, "utf8")) : {};
  const style = {
    id: existing.id ?? "learned",
    name: existing.name ?? "My Style",
    palette: avgPalette(palettes),
    fontFamily: existing.fontFamily,
    captionStyle: existing.captionStyle ?? "karaoke",
    pacing: {
      cutsPer10s: round(medianCuts),
      avgShotSec: round(median(shotLens) ?? 0),
    },
    hookPattern: existing.hookPattern,
    energy,
    targetLengthSec: round(median(lengths) ?? 0),
    do: existing.do ?? [],
    avoid: existing.avoid ?? [],
    notes: existing.notes ?? "Baseline from analyze-style.mjs — refine with the learn-aesthetic skill.",
    source: { clips: videos.length, generatedAt: new Date().toISOString() },
  };

  fs.writeFileSync(stylePath, `${JSON.stringify(style, null, 2)}\n`);
  console.log(`DONE ${stylePath}`);
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack || err}`);
  process.exit(1);
});
