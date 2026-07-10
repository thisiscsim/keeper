// Clip ingest + deterministic first-cut assembly.
// Run directly: `node app/scripts/analyze.mjs --slug <slug>`
// or via the Electron main process (the Generate button).
//
// Probes every clip in projects/<slug>/assets with @remotion/media-parser,
// then writes a baseline edl.json: clips laid end-to-end (each capped), with
// existing theme + text overlays preserved. The prompt-aware "smart" assembly
// is done by the agent (the /create-social-video skill) on top of this.
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { parseMedia } from "@remotion/media-parser";
import { nodeReader } from "@remotion/media-parser/node";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
// .webm is ambiguous (recorded voiceovers are audio-only .webm); those files
// are classified by probing for video dimensions instead of by extension.
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg"]);
const AMBIGUOUS_EXT = new Set([".webm"]);
const CAP_SEC = 4;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const round = (n) => Math.round(n * 100) / 100;

async function main() {
  const slug = arg("slug");
  if (!slug) throw new Error("missing --slug");

  const projectDir = path.join(process.env.APERTURE_PROJECTS_DIR || path.join(repoRoot, "projects"), slug);
  const assetsDir = path.join(projectDir, "assets");
  const edlPath = path.join(projectDir, "edl.json");
  const edl = JSON.parse(fs.readFileSync(edlPath, "utf8"));

  const all = fs.readdirSync(assetsDir).filter((f) => !f.startsWith(".")).sort();
  const videoFiles = all.filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()));
  const audioFiles = all.filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()));
  for (const f of all.filter((x) => AMBIGUOUS_EXT.has(path.extname(x).toLowerCase()))) {
    try {
      const meta = await parseMedia({
        src: path.join(assetsDir, f),
        fields: { dimensions: true },
        reader: nodeReader,
        acknowledgeRemotionLicense: true,
      });
      (meta.dimensions ? videoFiles : audioFiles).push(f);
    } catch {
      // unreadable file: skip
    }
  }

  console.log(`PHASE probing ${videoFiles.length} clips`);
  const assets = [];
  const probes = [];
  for (const f of videoFiles) {
    const full = path.join(assetsDir, f);
    const meta = await parseMedia({
      src: full,
      fields: { durationInSeconds: true, dimensions: true, fps: true },
      reader: nodeReader,
      acknowledgeRemotionLicense: true,
    });
    const id = path.basename(f, path.extname(f));
    assets.push({
      id,
      kind: "video",
      src: `assets/${f}`,
      durationSec: meta.durationInSeconds ?? undefined,
      width: meta.dimensions?.width,
      height: meta.dimensions?.height,
    });
    probes.push({ file: f, ...meta });
    console.log(`CLIP ${f} ${round(meta.durationInSeconds ?? 0)}s ${meta.dimensions?.width}x${meta.dimensions?.height}`);
  }

  // Deterministic assembly: clips on one absolute timeline, overlapping by the
  // transition duration so crossfades stay in sync with text/captions. Muted
  // (music comes later).
  const TRANS = 0.3;
  let cursor = 0;
  const clips = assets.map((a, i) => {
    const len = Math.min(a.durationSec ?? CAP_SEC, CAP_SEC);
    const start = round(cursor);
    const clip = {
      id: `v-${a.id}`,
      assetId: a.id,
      start,
      in: 0,
      out: round(len),
      volume: 0,
    };
    if (i > 0) clip.transitionIn = { preset: "fade", duration: TRANS };
    if (i < assets.length - 1) clip.transitionOut = { preset: "fade", duration: TRANS };
    cursor = start + len - (i < assets.length - 1 ? TRANS : 0);
    return clip;
  });

  // Music bed: first audio file, spanning the video duration.
  for (const f of audioFiles) {
    const meta = await parseMedia({
      src: path.join(assetsDir, f),
      fields: { durationInSeconds: true },
      reader: nodeReader,
      acknowledgeRemotionLicense: true,
    });
    assets.push({
      id: path.basename(f, path.extname(f)),
      kind: "audio",
      src: `assets/${f}`,
      durationSec: meta.durationInSeconds ?? undefined,
    });
  }

  // Merge probed assets with the existing list: probes win on fresh metadata,
  // but keep fields only the app knows (proxySrc) and keep entries this scan
  // doesn't cover (images, previously imported files).
  const byId = new Map(edl.assets?.map((a) => [a.id, a]) ?? []);
  for (const probed of assets) {
    const prev = byId.get(probed.id);
    byId.set(probed.id, prev ? { ...prev, ...probed, proxySrc: prev.proxySrc } : probed);
  }
  edl.assets = [...byId.values()];

  const videoTrack = edl.tracks.find((tr) => tr.type === "video");
  if (videoTrack) videoTrack.clips = clips;
  else edl.tracks.unshift({ id: "v", type: "video", clips });

  // Music bed on the dedicated music track ("aud"). Voiceover tracks/clips are
  // preserved untouched, and a voiceover's own audio file never becomes music.
  const voAssetIds = new Set(
    edl.tracks
      .flatMap((tr) => (tr.type === "audio" ? tr.clips ?? [] : []))
      .filter((c) => c.role === "voiceover")
      .map((c) => c.assetId),
  );
  const videoDur = round(cursor);
  const music = edl.assets.find((a) => a.kind === "audio" && !voAssetIds.has(a.id));
  if (music) {
    const span = videoDur > 0 ? videoDur : (music.durationSec ?? 1);
    const out = round(Math.min(music.durationSec ?? span, span)) || 1;
    const duckUnderVoice = voAssetIds.size > 0;
    const audioClips = [
      { id: `a-${music.id}`, assetId: music.id, start: 0, in: 0, out, gain: -12, duckUnderVoice, role: "music" },
    ];
    const audioTrack = edl.tracks.find((tr) => tr.type === "audio" && tr.id !== "vo");
    if (audioTrack) audioTrack.clips = audioClips;
    else edl.tracks.push({ id: "aud", type: "audio", clips: audioClips });
  }

  fs.writeFileSync(edlPath, `${JSON.stringify(edl, null, 2)}\n`);
  fs.writeFileSync(
    path.join(projectDir, "analysis.json"),
    `${JSON.stringify({ slug, generatedAt: new Date().toISOString(), probes }, null, 2)}\n`,
  );
  console.log(`DONE assembled ${clips.length} clips, ${round(cursor)}s of video`);
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack || err}`);
  process.exit(1);
});
