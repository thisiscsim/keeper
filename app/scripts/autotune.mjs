// Deterministic auto-improve loop: score the cut, apply the single highest-value
// safe fix, re-score, repeat — logging each iteration's score delta to
// projects/<slug>/results.tsv. This is the in-app analogue of the agent-driven
// `auto-tune` skill (which applies smarter, content-aware fixes).
//
// Run: `node app/scripts/autotune.mjs --slug <slug> [--iterations 4]`
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const round = (n) => Math.round(n * 100) / 100;

function videoClips(edl) {
  return edl.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips);
}
function textClips(edl) {
  return edl.tracks.filter((t) => t.type === "text").flatMap((t) => t.clips);
}
function audioClips(edl) {
  return edl.tracks.filter((t) => t.type === "audio").flatMap((t) => t.clips);
}

function durationSeconds(edl) {
  let max = 0;
  for (const t of edl.tracks) {
    if (t.type === "video" || t.type === "audio") {
      for (const c of t.clips) max = Math.max(max, c.start + (c.out - c.in));
    } else if (t.type === "text") {
      for (const c of t.clips) max = Math.max(max, c.end);
    }
  }
  return max;
}

function closeness(value, mean, std, max) {
  const z = Math.abs(value - mean) / Math.max(std, 1e-6);
  return Math.round(max * Math.max(0, Math.min(1, 1 - (z - 1) / 2)));
}

function score(edl, benchmarks) {
  const dur = durationSeconds(edl);
  const vids = videoClips(edl);
  const txt = textClips(edl);
  const hasCaptions = edl.tracks.some(
    (t) => t.type === "caption" && (t.source || (t.words?.length ?? 0) > 0),
  );
  const hasAudio = audioClips(edl).length > 0;
  const margins = edl.theme.safeMargins ?? {};
  const hasMargins = (margins.top ?? 0) > 0 && (margins.bottom ?? 0) > 0;
  const hook = vids.some((c) => c.start <= 0.1) || txt.some((c) => c.start <= 2);
  const ending = vids.some((c) => c.start + (c.out - c.in) >= dur - 1.5) || txt.some((c) => c.end >= dur - 1.5);
  const cutsPer10s = dur > 0 ? (vids.length / dur) * 10 : 0;
  const dist = benchmarks?.distribution;

  const pacing =
    dist?.cutsPer10s && vids.length > 0
      ? closeness(cutsPer10s, dist.cutsPer10s.mean, dist.cutsPer10s.std, 15)
      : vids.length >= 4 && vids.length <= 12
        ? 14
        : vids.length === 0
          ? 4
          : 9;
  const length = dist?.durationSec
    ? closeness(dur, dist.durationSec.mean, dist.durationSec.std, 10)
    : dur >= 7 && dur <= 35
      ? 10
      : dur < 7
        ? 5
        : 6;

  return (
    (hook ? 22 : 6) +
    pacing +
    (hasCaptions ? 15 : 4) +
    (hasMargins ? 10 : 3) +
    length +
    (hasAudio ? 14 : 5) +
    (ending ? 9 : 4)
  );
}

// Ordered, conservative improvements. Each returns a label if it changed edl.
function improvements(edl, benchmarks) {
  return [
    () => {
      if (edl.theme.captionStyle === "none") {
        edl.theme.captionStyle = "karaoke";
        return "enable captions (karaoke)";
      }
      return null;
    },
    () => {
      const m = (edl.theme.safeMargins ??= {});
      if ((m.top ?? 0) <= 0 || (m.bottom ?? 0) <= 0) {
        m.top = m.top || 220;
        m.bottom = m.bottom || 320;
        m.left = m.left || 64;
        m.right = m.right || 64;
        return "set vertical safe margins";
      }
      return null;
    },
    () => {
      const hasAudio = audioClips(edl).length > 0;
      const audioAsset = edl.assets.find((a) => a.kind === "audio");
      if (!hasAudio && audioAsset) {
        const span = Math.max(1, round(durationSeconds(edl))) || (audioAsset.durationSec ?? 1);
        let track = edl.tracks.find((t) => t.type === "audio");
        if (!track) {
          track = { id: "aud", type: "audio", clips: [] };
          edl.tracks.push(track);
        }
        track.clips.push({
          id: `a-${audioAsset.id}`,
          assetId: audioAsset.id,
          start: 0,
          in: 0,
          out: round(Math.min(audioAsset.durationSec ?? span, span)) || 1,
          gain: -12,
          duckUnderVoice: true,
          role: "music",
        });
        return "add music bed";
      }
      return null;
    },
    () => {
      // Trim toward the creator's benchmark length when we're well over it.
      const mean = benchmarks?.distribution?.durationSec?.mean;
      const dur = durationSeconds(edl);
      const vids = videoClips(edl);
      if (mean && dur > mean * 1.25 && vids.length > 0) {
        const last = vids[vids.length - 1];
        const trim = Math.min(last.out - last.in - 0.5, dur - mean);
        if (trim > 0.2) {
          last.out = round(last.out - trim);
          return `trim to ~${round(mean)}s (benchmark length)`;
        }
      }
      return null;
    },
  ];
}

async function main() {
  const slug = arg("slug");
  if (!slug) throw new Error("missing --slug");
  const iterations = Number(arg("iterations") ?? 4);

  const projectDir = path.join(process.env.APERTURE_PROJECTS_DIR || path.join(repoRoot, "projects"), slug);
  const edlPath = path.join(projectDir, "edl.json");
  const edl = JSON.parse(fs.readFileSync(edlPath, "utf8"));
  const benchPath = path.join(projectDir, "benchmarks.json");
  const benchmarks = fs.existsSync(benchPath) ? JSON.parse(fs.readFileSync(benchPath, "utf8")) : null;

  const resultsPath = path.join(projectDir, "results.tsv");
  if (!fs.existsSync(resultsPath)) fs.writeFileSync(resultsPath, "iter\tscore\tdelta\tchange\n");

  let prev = score(edl, benchmarks);
  fs.appendFileSync(resultsPath, `0\t${prev}\t0\tbaseline\n`);
  console.log(`PHASE baseline score ${prev}`);

  for (let i = 1; i <= iterations; i++) {
    let changed = null;
    for (const improve of improvements(edl, benchmarks)) {
      const label = improve();
      if (label) {
        const next = score(edl, benchmarks);
        if (next >= prev) {
          changed = { label, next };
          break;
        }
      }
    }
    if (!changed) {
      console.log("PHASE no further improvement");
      break;
    }
    fs.writeFileSync(edlPath, `${JSON.stringify(edl, null, 2)}\n`);
    fs.appendFileSync(resultsPath, `${i}\t${changed.next}\t${changed.next - prev >= 0 ? "+" : ""}${changed.next - prev}\t${changed.label}\n`);
    console.log(`PHASE ${changed.label} -> ${changed.next}`);
    console.log(`PROGRESS ${Math.round((i / iterations) * 100)}`);
    prev = changed.next;
  }

  console.log(`DONE final score ${prev}`);
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack || err}`);
  process.exit(1);
});
