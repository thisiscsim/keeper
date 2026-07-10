// Shared helpers for the LLM-backed scripts (generate / critique / autotune):
// JSON extraction, schema-deviation repair, and a deterministic metrics summary
// used to ground the model so it scores/edit against real numbers.
import { durationSeconds } from "@reel/edl";

export const ANIM_NAMES = [
  "soft-blur-in",
  "per-character-rise",
  "per-word-crossfade",
  "spring-scale-in",
  "mask-reveal-up",
  "blur-out-up",
  "scale-down-fade",
  "typewriter",
];

const round = (n) => Math.round(n * 100) / 100;

/** Pull the first {...} JSON object out of a model response (handles code fences). */
export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object in model output");
  return JSON.parse(body.slice(start, end + 1));
}

const MAX_SEC = 14_400; // mirrors MAX_TIMELINE_SEC in the EDL schema
const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|(rgb|rgba|hsl|hsla)\(\s*[\d.,%\s/-]*\)|[a-zA-Z]+)$/;

function clampSec(v, fallback) {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.min(Math.max(v, 0), MAX_SEC);
}

/** Repair common harmless model deviations before strict EdlSchema validation. */
export function sanitizeEdl(obj) {
  if (!obj || !Array.isArray(obj.tracks)) return obj;
  if (Array.isArray(obj.theme?.palette)) {
    // Colors reach inline CSS; anything not a plain color literal is unsafe.
    obj.theme.palette = obj.theme.palette.filter((c) => typeof c === "string" && SAFE_COLOR.test(c));
    if (obj.theme.palette.length === 0) delete obj.theme.palette;
  }
  for (const track of obj.tracks) {
    if (!Array.isArray(track?.clips)) continue;
    for (const clip of track.clips) {
      if (!clip) continue;
      // Non-finite / absurd timings hang the timeline and player.
      if ("start" in clip) clip.start = clampSec(clip.start, 0);
      if ("in" in clip) clip.in = clampSec(clip.in, 0);
      if ("out" in clip) clip.out = clampSec(clip.out, 1) || 1;
      if ("end" in clip) clip.end = clampSec(clip.end, 1) || 1;
      if (track.type === "text") {
        if (typeof clip.text === "string" && clip.text.length > 2000) clip.text = clip.text.slice(0, 2000);
        if (clip.anim != null) {
          if (typeof clip.anim !== "object") {
            delete clip.anim;
          } else if (typeof clip.anim.name !== "string" || !clip.anim.name) {
            clip.anim.name = "soft-blur-in";
            clip.anim.from = clip.anim.from ?? "animate-text";
          }
        }
        if (clip.style && clip.style !== "title" && clip.style !== "subtitle") {
          clip.style = "subtitle";
        }
      }
    }
  }
  return obj;
}

/**
 * Re-attach audio the model dropped. LLM refine/improve passes return a whole
 * EDL and routinely omit the audio tracks the baseline laid down (music bed,
 * voiceover). For every baseline audio track that is missing or emptied in
 * the new cut, restore the baseline clips — re-capping music beds to the new
 * cut's video length. Deterministic insurance, same philosophy as enforceStyle.
 */
export function restoreAudioTracks(edl, baseline) {
  if (!edl?.tracks || !Array.isArray(edl.tracks)) return edl;
  if (!baseline?.tracks || !Array.isArray(baseline.tracks)) return edl;

  const videoLen = round(
    edl.tracks
      .filter((t) => t?.type === "video")
      .flatMap((t) => t.clips ?? [])
      .reduce((m, c) => Math.max(m, (c.start ?? 0) + (c.out ?? 0) - (c.in ?? 0)), 0),
  );

  for (const baseTrack of baseline.tracks) {
    if (baseTrack?.type !== "audio" || (baseTrack.clips?.length ?? 0) === 0) continue;
    let track = edl.tracks.find((t) => t?.type === "audio" && t.id === baseTrack.id);
    if (!track) {
      track = { id: baseTrack.id, type: "audio", clips: [] };
      if (baseTrack.name) track.name = baseTrack.name;
      edl.tracks.push(track);
    }
    if ((track.clips?.length ?? 0) > 0) continue; // the model kept this track's audio
    track.clips = baseTrack.clips.map((c) => {
      const clip = { ...c };
      if ((clip.role ?? "music") === "music" && videoLen > 0) {
        const maxOut = round((clip.in ?? 0) + Math.max(0.1, videoLen - (clip.start ?? 0)));
        clip.out = Math.min(clip.out ?? maxOut, maxOut);
      }
      return clip;
    });
  }
  return edl;
}

/**
 * Deterministically stamp the measurable look from a style profile onto an EDL,
 * so the style shows even when the model under-applies it.
 */
export function enforceStyle(edl, profile) {
  if (!profile || !edl?.theme) return edl;
  if (profile.palette?.length) edl.theme.palette = profile.palette.slice(0, 3);
  if (profile.fontFamily) edl.theme.fontFamily = profile.fontFamily;
  if (profile.captionStyle) edl.theme.captionStyle = profile.captionStyle;
  if (profile.grade) edl.theme.grade = profile.grade;
  if (profile.id) edl.theme.stylePreset = profile.id;
  return edl;
}

/** Deterministic structural metrics for grounding the LLM critic/editor. */
export function metrics(edl) {
  const vids = edl.tracks.filter((t) => t.type === "video").flatMap((t) => t.clips ?? []);
  const txt = edl.tracks.filter((t) => t.type === "text").flatMap((t) => t.clips ?? []);
  const dur = durationSeconds(edl);
  return {
    durationSec: round(dur),
    videoClips: vids.length,
    textClips: txt.length,
    cutsPer10s: dur > 0 ? round((vids.length / dur) * 10) : 0,
    hasCaptions: edl.tracks.some((t) => t.type === "caption" && (t.source || (t.words?.length ?? 0) > 0)),
    hasAudio: edl.tracks.some((t) => t.type === "audio" && (t.clips?.length ?? 0) > 0),
    hasMargins: (edl.theme?.safeMargins?.top ?? 0) > 0 && (edl.theme?.safeMargins?.bottom ?? 0) > 0,
    hookPresent: vids.some((c) => c.start <= 0.1) || txt.some((c) => c.start <= 2),
  };
}
