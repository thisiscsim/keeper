import type { AssetRecord, ReasonCode } from "@keeper/schema";

/** URL for a library-relative path via the streaming keeper-asset protocol. */
export function assetUrl(rel: string | undefined): string | undefined {
  if (!rel) return undefined;
  return `keeper-asset://home/${rel.split("/").map(encodeURIComponent).join("/")}`;
}

export function thumbUrl(asset: AssetRecord): string | undefined {
  return assetUrl(asset.thumbRel);
}

/** Best available large image for the loupe (photos: preview; videos: poster). */
export function previewUrl(asset: AssetRecord): string | undefined {
  return assetUrl(asset.previewRel ?? asset.posterRel ?? asset.thumbRel);
}

/** Original file URL — used for <video> playback. */
export function originalUrl(asset: AssetRecord): string {
  return assetUrl(asset.relPath) as string;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = "B";
  for (const u of units) {
    if (value < 1024) break;
    value /= 1024;
    unit = u;
  }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${unit}`;
}

export function formatDay(day: string): string {
  if (day === "unknown") return "Unknown date";
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatDuration(sec: number | undefined): string {
  if (!sec || !Number.isFinite(sec)) return "";
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, "0")}` : `0:${String(s).padStart(2, "0")}`;
}

const REASON_LABELS: Record<ReasonCode, string> = {
  blurry: "Blurry",
  "soft-focus": "Soft focus",
  underexposed: "Underexposed",
  overexposed: "Overexposed",
  "black-frame": "Black frame",
  "flat-frame": "Blank frame",
  corrupt: "Corrupt file",
  "tiny-file": "Tiny file",
  "accidental-clip": "Accidental clip",
  screenshot: "Screenshot",
  "screen-recording": "Screen recording",
  "duplicate-worse": "Worse duplicate",
  "burst-not-pick": "Burst frame",
  "eyes-closed": "Eyes closed",
  "bad-framing": "Bad framing",
  "sharpest-of-burst": "Sharpest of burst",
  "well-exposed": "Looks good",
  "important-moment": "Important moment",
  "llm-quality": "AI quality call",
  other: "Other",
};

export function reasonLabel(code: ReasonCode): string {
  return REASON_LABELS[code] ?? code;
}

/** Compact camera line for the info panel: "Canon R5 · 35mm · f/1.8 · 1/250 · ISO 100". */
export function cameraLine(asset: AssetRecord): string {
  const e = asset.exif;
  const parts: string[] = [];
  if (e.model) parts.push(e.model);
  if (e.focalMm) parts.push(`${Math.round(e.focalMm)}mm`);
  if (e.fNumber) parts.push(`f/${e.fNumber}`);
  if (e.exposureSec) {
    parts.push(e.exposureSec >= 1 ? `${e.exposureSec}s` : `1/${Math.round(1 / e.exposureSec)}`);
  }
  if (e.iso) parts.push(`ISO ${e.iso}`);
  return parts.join(" · ");
}
