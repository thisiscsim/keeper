/**
 * Provider registry for "add audio from URL". Everything downloads through
 * yt-dlp (which handles extraction for thousands of sites plus plain media
 * URLs), so supporting a new platform is usually just a new matcher here —
 * the registry exists to keep an explicit allowlist instead of accepting any
 * link the extractor happens to know.
 *
 * Deliberately NOT supportable: DRM-protected sources (Spotify, Apple Music).
 */

export interface AudioSource {
  id: string;
  label: string;
  matches: (url: URL) => boolean;
}

const SOURCES: AudioSource[] = [
  {
    id: "soundcloud",
    label: "SoundCloud",
    matches: (u) => /(^|\.)soundcloud\.com$|(^|\.)snd\.sc$/.test(u.hostname),
  },
  {
    id: "direct",
    label: "Direct audio URL",
    matches: (u) => /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(u.pathname),
  },
  // Future: { id: "youtube", matches: hostname youtube.com/youtu.be } — the
  // download path already handles it; add the matcher when we decide to.
];

export type ResolvedAudioSource =
  | { ok: true; id: string; label: string; url: string }
  | { ok: false; error: string };

export function resolveAudioSource(raw: string): ResolvedAudioSource {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, error: "That doesn't look like a URL." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, error: "Only http(s) links are supported." };
  }
  const source = SOURCES.find((s) => s.matches(url));
  if (!source) {
    return {
      ok: false,
      error: "Unsupported source — paste a SoundCloud link or a direct audio file URL.",
    };
  }
  return { ok: true, id: source.id, label: source.label, url: url.toString() };
}
