// Synthesize the project's narration (narration.md) with an ElevenLabs voice
// and land it on the timeline: audio on the "vo" track, word-level captions on
// the caption track, music ducked. One API call via /with-timestamps returns
// both audio and word timings (no STT pass needed — unlike Claudia, which
// derives timings via scribe_v1 STT).
//
// Pipeline: preprocess (breaks + substitutions) -> TTS -> two-pass ffmpeg
// loudnorm to -14 LUFS / -1.5 dBTP (raw ElevenLabs lands ~-36 LUFS) -> write
// assets/voiceover-<hash>.mp3 -> update edl.json. Synthesis is cached by
// hash(voice+model+text) so an unchanged script never re-burns credits.
//
// Run: ELEVENLABS_API_KEY=... node app/scripts/tts.mjs --slug <slug> --voice <voiceId>
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import ffmpegPath from "ffmpeg-static";
import { alignmentToWords, preprocessForTts, synthesisHash } from "./tts-util.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const MODEL_ID = "eleven_multilingual_v2";
const TARGET_LUFS = -14;
const TARGET_TP = -1.5;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// Two-pass loudnorm (ported from Claudia's normalize-audio.mjs): pass 1
// measures, pass 2 applies with linear=true so it's gain-only and word
// timings don't shift.
function normalizeLoudness(file) {
  const measure = spawnSync(
    ffmpegPath,
    ["-hide_banner", "-i", file, "-af", `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=11:print_format=json`, "-f", "null", "-"],
    { encoding: "utf8" },
  );
  const m = measure.stderr.match(/\{[\s\S]*\}/);
  if (!m) return false;
  let stats;
  try {
    stats = JSON.parse(m[0]);
  } catch {
    return false;
  }
  if (Math.abs(Number(stats.input_i) - TARGET_LUFS) <= 1) return true; // already at target
  const out = `${file}.norm.mp3`;
  const apply = spawnSync(ffmpegPath, [
    "-y", "-hide_banner", "-i", file,
    "-af",
    `loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TP}:LRA=11:linear=true:measured_I=${stats.input_i}:measured_TP=${stats.input_tp}:measured_LRA=${stats.input_lra}:measured_thresh=${stats.input_thresh}`,
    "-b:a", "192k",
    out,
  ]);
  if (apply.status !== 0 || !fs.existsSync(out)) return false;
  fs.renameSync(out, file);
  return true;
}

async function main() {
  const slug = arg("slug");
  const voiceId = arg("voice");
  if (!slug) throw new Error("missing --slug");
  if (!voiceId) throw new Error("missing --voice");
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    console.error("ERROR no ElevenLabs API key configured (Settings -> Voices).");
    process.exit(3);
  }

  const projectDir = path.join(process.env.APERTURE_PROJECTS_DIR || path.join(repoRoot, "projects"), slug);
  const narration = fs.readFileSync(path.join(projectDir, "narration.md"), "utf8").trim();
  if (!narration) {
    console.error("ERROR narration.md is empty — write or draft a script first.");
    process.exit(2);
  }

  console.log("PHASE preprocessing");
  const processed = preprocessForTts(narration);
  const hash = await synthesisHash(voiceId, MODEL_ID, processed);
  const rel = `assets/voiceover-${hash}.mp3`;
  const audioFile = path.join(projectDir, rel);
  const timingsFile = path.join(projectDir, "transcripts", `voiceover-${hash}.words.json`);
  fs.mkdirSync(path.dirname(audioFile), { recursive: true });
  fs.mkdirSync(path.dirname(timingsFile), { recursive: true });

  let words;
  if (fs.existsSync(audioFile) && fs.existsSync(timingsFile)) {
    console.log("PHASE reusing cached synthesis");
    words = JSON.parse(fs.readFileSync(timingsFile, "utf8"));
  } else {
    console.log("PHASE synthesizing");
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: processed,
          model_id: MODEL_ID,
          voice_settings: { stability: 0.5 },
        }),
      },
    );
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        detail = typeof body.detail === "string" ? body.detail : (body.detail?.message ?? detail);
      } catch {
        // keep the status text
      }
      console.error(`ERROR ElevenLabs synthesis failed: ${detail}`);
      process.exit(2);
    }
    console.log("PROGRESS 60");
    const data = await res.json();
    fs.writeFileSync(audioFile, Buffer.from(data.audio_base64, "base64"));
    words = alignmentToWords(data.alignment);
    fs.writeFileSync(timingsFile, `${JSON.stringify(words)}\n`);

    console.log("PHASE normalizing loudness");
    if (!normalizeLoudness(audioFile)) {
      console.error("WARN loudness normalization skipped (measurement failed)");
    }
  }
  console.log("PROGRESS 85");

  console.log("PHASE updating timeline");
  const edlPath = path.join(projectDir, "edl.json");
  const edl = JSON.parse(fs.readFileSync(edlPath, "utf8"));
  const durationSec = words.length > 0 ? Math.max(words[words.length - 1].end, 1) : 1;
  const assetId = `vo-${hash}`;

  // Asset entry (replace any prior generated-VO assets no longer referenced).
  edl.assets = (edl.assets ?? []).filter((a) => !(a.id.startsWith("vo-") && a.id !== assetId));
  if (!edl.assets.some((a) => a.id === assetId)) {
    edl.assets.push({ id: assetId, kind: "audio", src: rel, durationSec });
  }

  // Voiceover clip: replace previous *generated* VOs, keep mic recordings.
  let vo = edl.tracks.find((t) => t.type === "audio" && t.id === "vo");
  if (!vo) {
    vo = { id: "vo", type: "audio", name: "Voiceover", clips: [] };
    edl.tracks.push(vo);
  }
  vo.clips = (vo.clips ?? []).filter((c) => !String(c.assetId).startsWith("vo-"));
  vo.clips.push({
    id: `a-${assetId}`,
    assetId,
    start: 0,
    in: 0,
    out: durationSec,
    gain: 0,
    duckUnderVoice: false,
    role: "voiceover",
  });

  // Duck every music bed under the new narration.
  for (const track of edl.tracks) {
    if (track.type !== "audio") continue;
    for (const clip of track.clips ?? []) {
      if (clip.role === "music") clip.duckUnderVoice = true;
    }
  }

  // Captions from the synthesis alignment (no whisper pass needed).
  const cap = edl.tracks.find((t) => t.type === "caption");
  if (cap) cap.words = words;
  else edl.tracks.push({ id: "cap", type: "caption", style: "karaoke", words });

  fs.writeFileSync(edlPath, `${JSON.stringify(edl, null, 2)}\n`);
  console.log(`DONE voiceover ${rel} (${words.length} caption words, ${durationSec.toFixed(1)}s)`);
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack || err}`);
  process.exit(1);
});
