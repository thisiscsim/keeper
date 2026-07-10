import type { Asset, AudioClip, AudioTrack, Edl, TextClip, VideoClip } from "@reel/edl";
import { durationSeconds } from "@reel/edl";

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Append imported assets. Re-importing the same file (same id + src) is a
 * no-op; a *different* file whose stem collides with an existing id (e.g.
 * clip.mp4 then clip.mov) gets a suffixed id — mutated in place so callers
 * that read `asset.id` afterwards (to place clips) see the final id.
 */
export function addAssets(edl: Edl, assets: Asset[]): void {
  for (const a of assets) {
    const existing = edl.assets.find((x) => x.id === a.id);
    if (existing) {
      if (existing.src === a.src) continue;
      let n = 2;
      while (edl.assets.some((x) => x.id === `${a.id}-${n}`)) n++;
      a.id = `${a.id}-${n}`;
    }
    edl.assets.push(a);
  }
}

/**
 * Add (or replace) an audio clip for an asset. Music spans the whole video and
 * ducks under voice; voiceover/sfx sit at their natural length from t=0.
 * Music and voiceover live on separate audio tracks (timeline layers).
 */
export function addAudioClip(
  edl: Edl,
  assetId: string,
  role: "music" | "voiceover" | "sfx",
  durationSec?: number,
): void {
  const trackId = role === "voiceover" ? "vo" : "aud";
  const trackName = role === "voiceover" ? "Voiceover" : "Music";
  let track = edl.tracks.find((t): t is AudioTrack => t.type === "audio" && t.id === trackId);
  if (!track) {
    track = { id: trackId, type: "audio", name: trackName, clips: [] };
    edl.tracks.push(track);
  }
  const videoLen = durationSeconds(edl);
  // A music bed underlays the existing cut — cap it at the video length so a
  // 3-minute track doesn't stretch a 20s composition. Voiceover/sfx keep their
  // natural length (captions may run past the last clip intentionally).
  const natural = durationSec ?? Math.max(1, videoLen);
  const out = round(role === "music" && videoLen > 0 ? Math.min(natural, videoLen) : natural);
  const clip: AudioClip = {
    id: `a-${assetId}`,
    assetId,
    start: 0,
    in: 0,
    out: out || 1,
    gain: role === "music" ? -12 : 0,
    duckUnderVoice: role === "music",
    role,
  };
  track.clips = track.clips.filter((c) => c.assetId !== assetId);
  track.clips.push(clip);

  // A new voiceover should duck any existing music beds under it.
  if (role === "voiceover") {
    for (const t of edl.tracks) {
      if (t.type !== "audio") continue;
      for (const c of t.clips) {
        if (c.role === "music") c.duckUnderVoice = true;
      }
    }
  }
}

/** Append a new empty timeline layer of the given type. */
export function addTrack(edl: Edl, type: "video" | "text" | "audio", name?: string): void {
  const id = `${type}-${Date.now().toString(36)}`;
  if (type === "video") edl.tracks.push({ id, type, name, clips: [] });
  else if (type === "text") edl.tracks.push({ id, type, name, clips: [] });
  else edl.tracks.push({ id, type, name, clips: [] });
}

export function renameTrack(edl: Edl, trackId: string, name: string): void {
  const track = edl.tracks.find((t) => t.id === trackId);
  if (track) track.name = name.trim() || undefined;
}

export function findVideoClip(edl: Edl, id: string | null): VideoClip | undefined {
  if (!id) return undefined;
  for (const track of edl.tracks) {
    if (track.type === "video") {
      const clip = track.clips.find((c) => c.id === id);
      if (clip) return clip;
    }
  }
  return undefined;
}

export function mutateVideoClip(edl: Edl, id: string, fn: (clip: VideoClip) => void): void {
  for (const track of edl.tracks) {
    if (track.type === "video") {
      const clip = track.clips.find((c) => c.id === id);
      if (clip) {
        fn(clip);
        return;
      }
    }
  }
}

export function findAudioClip(edl: Edl, id: string | null): AudioClip | undefined {
  if (!id) return undefined;
  for (const track of edl.tracks) {
    if (track.type === "audio") {
      const clip = track.clips.find((c) => c.id === id);
      if (clip) return clip;
    }
  }
  return undefined;
}

export function mutateAudioClip(edl: Edl, id: string, fn: (clip: AudioClip) => void): void {
  for (const track of edl.tracks) {
    if (track.type === "audio") {
      const clip = track.clips.find((c) => c.id === id);
      if (clip) {
        fn(clip);
        return;
      }
    }
  }
}

export function findTextClip(edl: Edl, id: string | null): TextClip | undefined {
  if (!id) return undefined;
  for (const track of edl.tracks) {
    if (track.type === "text") {
      const clip = track.clips.find((c) => c.id === id);
      if (clip) return clip;
    }
  }
  return undefined;
}

export function mutateTextClip(edl: Edl, id: string, fn: (clip: TextClip) => void): void {
  for (const track of edl.tracks) {
    if (track.type === "text") {
      const clip = track.clips.find((c) => c.id === id);
      if (clip) {
        fn(clip);
        return;
      }
    }
  }
}
