// Whisper auto-captions. Extracts audio with ffmpeg, runs whisper.cpp locally,
// and writes word-level caption timings into the project's edl.json caption track.
// Run: `node app/scripts/transcribe.mjs --slug <slug>`
//
// NOTE: needs real speech audio to produce meaningful output (the bundled test
// clips are tone-only). Whisper binary + model download on first run.
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import {
  downloadWhisperModel,
  installWhisperCpp,
  toCaptions,
  transcribe as whisperTranscribe,
} from "@remotion/install-whisper-cpp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const WHISPER_DIR = path.join(repoRoot, ".whisper");
const MODEL = "base.en";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const round = (n) => Math.round(n * 100) / 100;

async function main() {
  const slug = arg("slug");
  if (!slug) throw new Error("missing --slug");

  const projectDir = path.join(process.env.APERTURE_PROJECTS_DIR || path.join(repoRoot, "projects"), slug);
  const edlPath = path.join(projectDir, "edl.json");
  const edl = JSON.parse(fs.readFileSync(edlPath, "utf8"));

  // Prefer the voiceover clip's asset (that's the speech we want captioned),
  // then any audio asset, then fall back to the video's own audio.
  const voClip = edl.tracks
    .flatMap((t) => (t.type === "audio" ? t.clips : []))
    .find((c) => c.role === "voiceover");
  const voAsset = voClip ? edl.assets.find((a) => a.id === voClip.assetId) : undefined;
  const asset =
    voAsset ??
    edl.assets.find((a) => a.kind === "audio") ??
    edl.assets.find((a) => a.kind === "video");
  if (!asset) throw new Error("no audio/video asset to transcribe");

  // edl.json is untrusted (shareable project file): the transcode input must
  // stay inside the project folder, mirroring the app's safeProjectPath guard.
  const input = path.resolve(projectDir, asset.src);
  if (!input.startsWith(path.resolve(projectDir) + path.sep)) {
    throw new Error(`asset src escapes the project folder: ${asset.src}`);
  }
  const wavDir = path.join(projectDir, "transcripts");
  fs.mkdirSync(wavDir, { recursive: true });
  const wav = path.join(wavDir, `${slug}-16k.wav`);

  console.log("PHASE extracting-audio");
  execFileSync(ffmpegPath, ["-y", "-i", input, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wav], {
    stdio: "ignore",
  });

  console.log("PHASE installing-whisper");
  await installWhisperCpp({ to: WHISPER_DIR, version: "1.5.5" });
  await downloadWhisperModel({ model: MODEL, folder: WHISPER_DIR });

  console.log("PHASE transcribing");
  const whisperCppOutput = await whisperTranscribe({
    inputPath: wav,
    whisperPath: WHISPER_DIR,
    model: MODEL,
    tokenLevelTimestamps: true,
  });
  const { captions } = toCaptions({ whisperCppOutput });
  const words = captions
    .map((c) => ({ text: String(c.text).trim(), start: round(c.startMs / 1000), end: round(c.endMs / 1000) }))
    .filter((w) => w.text);

  const capTrack = edl.tracks.find((t) => t.type === "caption");
  if (capTrack) capTrack.words = words;
  else edl.tracks.push({ id: "cap", type: "caption", style: "karaoke", words });

  fs.writeFileSync(edlPath, `${JSON.stringify(edl, null, 2)}\n`);
  console.log(`DONE ${words.length} caption words`);
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack || err}`);
  process.exit(1);
});
