// Extract structural features from the creator's uploaded high-performing
// videos (projects/<slug>/benchmarks/) so the critic can score the current cut
// against what actually works for THIS creator, not generic heuristics.
//
// Run: `node app/scripts/analyze-benchmarks.mjs --slug <slug>`
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const round = (n) => Math.round(n * 100) / 100;

function durationSec(file) {
  const res = spawnSync(ffmpegPath, ["-i", file], { encoding: "utf8" });
  const m = (res.stderr || "").match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

// Scene-change timestamps (seconds) via ffmpeg detection.
function sceneTimes(file) {
  const res = spawnSync(
    ffmpegPath,
    ["-i", file, "-vf", "select='gt(scene,0.4)',showinfo", "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  return [...(res.stderr || "").matchAll(/pts_time:(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
}

// Integrated loudness (LUFS) via ebur128.
function loudnessLufs(file) {
  const res = spawnSync(ffmpegPath, ["-i", file, "-af", "ebur128", "-f", "null", "-"], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
  const matches = [...(res.stderr || "").matchAll(/I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/g)];
  return matches.length ? Number(matches[matches.length - 1][1]) : undefined;
}

function stats(xs) {
  const vals = xs.filter((x) => typeof x === "number" && Number.isFinite(x));
  if (vals.length === 0) return undefined;
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  return { mean: round(mean), std: round(Math.sqrt(variance)), min: round(Math.min(...vals)), max: round(Math.max(...vals)) };
}

async function main() {
  const slug = arg("slug");
  if (!slug) throw new Error("missing --slug");

  const projectDir = path.join(process.env.APERTURE_PROJECTS_DIR || path.join(repoRoot, "projects"), slug);
  const benchDir = path.join(projectDir, "benchmarks");
  const metaPath = path.join(benchDir, "benchmarks.meta.json");
  const metrics = fs.existsSync(metaPath) ? JSON.parse(fs.readFileSync(metaPath, "utf8")) : {};

  const files = (fs.existsSync(benchDir) ? fs.readdirSync(benchDir) : []).filter((f) =>
    VIDEO_EXT.has(path.extname(f).toLowerCase()),
  );
  if (files.length === 0) throw new Error("no benchmark videos in benchmarks/");

  console.log(`PHASE analyzing ${files.length} benchmark clips`);
  const videos = [];
  let done = 0;
  for (const f of files) {
    const file = path.join(benchDir, f);
    const dur = durationSec(file);
    const scenes = sceneTimes(file);
    const cuts = scenes.length;
    videos.push({
      file: f,
      durationSec: round(dur),
      cutsPer10s: dur > 0 ? round((cuts / dur) * 10) : undefined,
      hookSec: scenes.length ? round(scenes[0]) : undefined,
      loudnessLufs: loudnessLufs(file),
      views: metrics[f]?.views,
      likes: metrics[f]?.likes,
    });
    done++;
    console.log(`PROGRESS ${Math.round((done / files.length) * 100)}`);
  }

  const distribution = {};
  for (const key of ["durationSec", "cutsPer10s", "hookSec", "loudnessLufs"]) {
    const s = stats(videos.map((v) => v[key]));
    if (s) distribution[key] = s;
  }

  const out = {
    generatedAt: new Date().toISOString(),
    count: videos.length,
    videos,
    distribution,
  };
  fs.writeFileSync(path.join(projectDir, "benchmarks.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(`DONE ${videos.length} benchmarks analyzed`);
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack || err}`);
  process.exit(1);
});
