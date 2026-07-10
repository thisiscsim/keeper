// Sample still frames from each reference clip so the agent (learn-aesthetic
// skill) can literally see the creator's aesthetic. Frames land in
// projects/<slug>/references/.frames/.
//
// Run: `node app/scripts/extract-frames.mjs --slug <slug>` (or --dir benchmarks)
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const FRAMES_PER_CLIP = 8;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const slug = arg("slug");
  if (!slug) throw new Error("missing --slug");
  const sub = arg("dir") ?? "references";

  const dir = path.join(process.env.APERTURE_PROJECTS_DIR || path.join(repoRoot, "projects"), slug, sub);
  const framesDir = path.join(dir, ".frames");
  fs.mkdirSync(framesDir, { recursive: true });

  const videos = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).filter((f) =>
    VIDEO_EXT.has(path.extname(f).toLowerCase()),
  );
  console.log(`PHASE sampling ${videos.length} reference clips`);

  let done = 0;
  for (const f of videos) {
    const base = path.basename(f, path.extname(f));
    // Evenly sample across the clip: 1 frame every few seconds, capped.
    execFileSync(
      ffmpegPath,
      [
        "-y",
        "-i",
        path.join(dir, f),
        "-vf",
        "fps=1/2,scale=480:-1",
        "-frames:v",
        String(FRAMES_PER_CLIP),
        path.join(framesDir, `${base}-%02d.jpg`),
      ],
      { stdio: "ignore" },
    );
    done++;
    console.log(`PROGRESS ${Math.round((done / Math.max(1, videos.length)) * 100)}`);
  }

  console.log(`DONE ${framesDir}`);
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack || err}`);
  process.exit(1);
});
