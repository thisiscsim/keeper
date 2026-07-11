// Media decoding + derivation helpers built on ffmpeg-static, exiftool, and
// (on macOS) sips. No native image libraries: pixel work happens by piping
// grayscale rawvideo out of ffmpeg into pure-JS math (quality.mjs, phash.mjs).
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { exiftool } from "exiftool-vendored";

const require = createRequire(import.meta.url);

const execFileP = promisify(execFile);
const MAX_BUFFER = 256 * 1024 * 1024;

export const PHOTO_EXT = {
  ".jpg": "jpeg",
  ".jpeg": "jpeg",
  ".png": "png",
  ".heic": "heic",
  ".heif": "heic",
  ".webp": "webp",
  ".gif": "gif",
  ".tif": "tiff",
  ".tiff": "tiff",
};

export const RAW_EXT = new Set([
  ".cr2", ".cr3", ".nef", ".nrw", ".arw", ".srf", ".dng", ".orf", ".rw2", ".raf", ".srw", ".pef", ".x3f",
]);

export const VIDEO_EXT = {
  ".mp4": "mp4",
  ".m4v": "mp4",
  ".mov": "mov",
  ".avi": "avi",
  ".mkv": "mkv",
  ".webm": "webm",
  ".mts": "other",
  ".m2ts": "other",
  ".3gp": "other",
};

/** Classify a file by extension. Returns { mediaType, format } or null. */
export function classifyFile(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  if (RAW_EXT.has(ext)) return { mediaType: "photo", format: "raw" };
  if (ext in PHOTO_EXT) return { mediaType: "photo", format: PHOTO_EXT[ext] };
  if (ext in VIDEO_EXT) return { mediaType: "video", format: VIDEO_EXT[ext] };
  return null;
}

export function isSupported(fileName) {
  return classifyFile(fileName) !== null;
}

async function runFfmpeg(args, { encoding } = {}) {
  return execFileP(ffmpegPath, ["-hide_banner", "-loglevel", "error", ...args], {
    maxBuffer: MAX_BUFFER,
    encoding: encoding ?? "utf8",
  });
}

const isDarwin = process.platform === "darwin";

/**
 * Read the metadata Keeper cares about. exiftool handles photos, RAW, and
 * video containers alike, and is batched behind a persistent process.
 */
export async function readMetadata(absPath) {
  const tags = await exiftool.read(absPath);
  const capturedAt = exifDate(tags.DateTimeOriginal) ?? exifDate(tags.CreateDate) ?? exifDate(tags.MediaCreateDate);
  const gps =
    typeof tags.GPSLatitude === "number" && typeof tags.GPSLongitude === "number"
      ? { lat: tags.GPSLatitude, lon: tags.GPSLongitude }
      : undefined;
  return {
    capturedAt,
    width: numberOr(tags.ImageWidth, undefined),
    height: numberOr(tags.ImageHeight, undefined),
    durationSec: parseDuration(tags.Duration),
    exif: {
      make: strOr(tags.Make),
      model: strOr(tags.Model),
      lens: strOr(tags.LensModel ?? tags.LensID),
      iso: numberOr(tags.ISO, undefined),
      exposureSec: parseExposure(tags.ExposureTime),
      fNumber: numberOr(tags.FNumber, undefined),
      focalMm: parseFocal(tags.FocalLength),
      gps,
      contentId: strOr(tags.ContentIdentifier ?? tags.MediaGroupUUID),
    },
  };
}

function exifDate(value) {
  if (!value) return undefined;
  if (typeof value === "string") {
    // exiftool string form: "2026:07:04 18:23:11"
    const m = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](.*)$/);
    const iso = m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}` : value;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
  }
  if (typeof value === "object" && typeof value.toISOString === "function") {
    try {
      return new Date(value.toISOString()).toISOString();
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function strOr(v) {
  return typeof v === "string" && v.length > 0 ? v.slice(0, 250) : undefined;
}

function numberOr(v, fallback) {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function parseExposure(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const m = v.match(/^1\/(\d+(?:\.\d+)?)$/);
    if (m) return 1 / Number(m[1]);
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseFocal(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseDuration(v) {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    // "0:00:12" or "12.4 s"
    const hms = v.match(/^(\d+):(\d{2}):(\d{2}(?:\.\d+)?)$/);
    if (hms) return Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3]);
    const secs = v.match(/^([\d.]+)\s*s$/);
    if (secs) return Number(secs[1]);
  }
  return undefined;
}

/** Shut down the persistent exiftool process (call at script exit). */
export async function closeMetadataReader() {
  try {
    await exiftool.end();
  } catch {
    // already gone
  }
}

/**
 * Produce a JPEG version of any still, for thumbnailing and CV work:
 * - jpeg/png/webp/tiff/gif: ffmpeg decodes them directly (returns input path).
 * - RAW: extract the embedded preview via exiftool; fall back to sips (macOS).
 * - HEIC: sips on macOS; try ffmpeg elsewhere (newer builds decode HEIC).
 * Returns an absolute path to a decodable still, or null when hopeless.
 */
export async function ensureDecodableStill(absPath, format, tmpDir) {
  if (format === "jpeg" || format === "png" || format === "webp" || format === "tiff" || format === "gif") {
    return absPath;
  }
  const tmpOut = path.join(tmpDir, `${path.basename(absPath)}.decoded.jpg`);

  if (format === "raw") {
    for (const tag of ["JpgFromRaw", "PreviewImage", "OtherImage", "ThumbnailImage"]) {
      try {
        const { stdout } = await execFileP(
          exiftoolBin(),
          ["-b", `-${tag}`, absPath],
          { maxBuffer: MAX_BUFFER, encoding: "buffer" },
        );
        if (stdout && stdout.length > 4096) {
          fs.writeFileSync(tmpOut, stdout);
          return tmpOut;
        }
      } catch {
        // tag missing — try the next
      }
    }
    if (isDarwin) return sipsConvert(absPath, tmpOut);
    return null;
  }

  if (format === "heic") {
    if (isDarwin) {
      const out = await sipsConvert(absPath, tmpOut);
      if (out) return out;
    }
    try {
      await runFfmpeg(["-i", absPath, "-frames:v", "1", "-y", tmpOut]);
      return fs.existsSync(tmpOut) ? tmpOut : null;
    } catch {
      return null;
    }
  }

  return null;
}

let cachedExiftoolBin = null;
function exiftoolBin() {
  if (!cachedExiftoolBin) {
    // exiftool-vendored exposes the batched API; for one-shot binary output we
    // call the vendored perl script directly.
    cachedExiftoolBin = require.resolve("exiftool-vendored.pl/bin/exiftool");
  }
  return cachedExiftoolBin;
}

async function sipsConvert(absPath, outPath, maxDim) {
  try {
    const args = ["-s", "format", "jpeg", absPath, "--out", outPath];
    if (maxDim) args.splice(0, 0, "-Z", String(maxDim));
    await execFileP("/usr/bin/sips", args, { maxBuffer: MAX_BUFFER });
    return fs.existsSync(outPath) ? outPath : null;
  } catch {
    return null;
  }
}

/** Scale a decodable still down to a JPEG thumb (maxDim on the long edge). */
export async function makeThumb(decodableStill, outPath, maxDim = 512) {
  await runFfmpeg([
    "-i", decodableStill,
    "-vf", `scale='min(${maxDim},iw)':'min(${maxDim},ih)':force_original_aspect_ratio=decrease`,
    "-frames:v", "1",
    "-q:v", "4",
    "-y", outPath,
  ]);
  return outPath;
}

/** Poster frame for a video (at ~1s in, clamped to duration). */
export async function makePoster(absVideo, outPath, durationSec, maxDim = 768) {
  const at = Math.min(1, Math.max(0, (durationSec ?? 2) / 3)).toFixed(2);
  await runFfmpeg([
    "-ss", at,
    "-i", absVideo,
    "-frames:v", "1",
    "-vf", `scale='min(${maxDim},iw)':'min(${maxDim},ih)':force_original_aspect_ratio=decrease`,
    "-q:v", "4",
    "-y", outPath,
  ]);
  return outPath;
}

/** Horizontal strip of N frames for hover-scrubbing a video. */
export async function makeScrubStrip(absVideo, outPath, durationSec, frames = 10) {
  if (!durationSec || durationSec <= 0) return null;
  const fps = Math.max(0.05, frames / durationSec);
  try {
    await runFfmpeg([
      "-i", absVideo,
      "-vf", `fps=${fps.toFixed(4)},scale=180:-2,tile=${frames}x1`,
      "-frames:v", "1",
      "-q:v", "5",
      "-y", outPath,
    ]);
    return fs.existsSync(outPath) ? outPath : null;
  } catch {
    return null;
  }
}

/**
 * Extract a size x size grayscale buffer from any ffmpeg-decodable input
 * (thumb JPEG or video frame). The fixed square keeps scores comparable.
 */
export async function extractGray(absPath, size = 128) {
  const { stdout } = await execFileP(
    ffmpegPath,
    [
      "-hide_banner", "-loglevel", "error",
      "-i", absPath,
      "-vf", `scale=${size}:${size}`,
      "-frames:v", "1",
      "-f", "rawvideo",
      "-pix_fmt", "gray",
      "-",
    ],
    { maxBuffer: MAX_BUFFER, encoding: "buffer" },
  );
  if (stdout.length < size * size) throw new Error(`gray extraction returned ${stdout.length} bytes`);
  return new Uint8Array(stdout.buffer, stdout.byteOffset, size * size);
}

/** Fallback duration probe: parse ffmpeg's stderr banner. */
export async function probeDurationSec(absPath) {
  try {
    await execFileP(ffmpegPath, ["-hide_banner", "-i", absPath], { maxBuffer: 4 * 1024 * 1024 });
  } catch (err) {
    const stderr = String(err.stderr ?? "");
    const m = stderr.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  return undefined;
}

export function makeTmpDir(prefix = "keeper-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
