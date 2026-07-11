// Burst / near-duplicate clustering and file pairing (RAW+JPEG, Live Photos).
// Pure functions over asset descriptors so the logic is unit-testable.
import { hamming } from "./phash.mjs";

/** Capture-time gap (seconds) beyond which shots can't be the same burst. */
const BURST_GAP_SEC = 3;
/** pHash Hamming distance at or below which frames count as near-duplicates. */
const NEAR_DUP_DISTANCE = 12;

function toTime(iso) {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t / 1000 : null;
}

/**
 * Cluster photos into burst/similar groups. Input: [{ id, capturedAt, hash }]
 * where hash is a pHash BigInt (or null when unavailable). Two passes:
 * time-adjacency chains shots into candidate runs, then visual similarity
 * confirms membership. Returns [{ kind, assetIds }] for groups of 2+.
 */
export function clusterBursts(items) {
  const sorted = items
    .filter((i) => toTime(i.capturedAt) !== null)
    .sort((a, b) => toTime(a.capturedAt) - toTime(b.capturedAt));

  const groups = [];
  let current = [];

  const flush = () => {
    if (current.length >= 2) {
      groups.push({ kind: "burst", assetIds: current.map((i) => i.id) });
    }
    current = [];
  };

  for (const item of sorted) {
    if (current.length === 0) {
      current.push(item);
      continue;
    }
    const prev = current[current.length - 1];
    const gap = toTime(item.capturedAt) - toTime(prev.capturedAt);
    const visuallyClose =
      item.hash != null && prev.hash != null
        ? hamming(item.hash, prev.hash) <= NEAR_DUP_DISTANCE
        : gap <= 1; // no hashes: only sub-second chains count
    if (gap <= BURST_GAP_SEC && visuallyClose) {
      current.push(item);
    } else {
      flush();
      current.push(item);
    }
  }
  flush();
  return groups;
}

/** Strip the extension; uppercase for case-insensitive stem matching. */
function stem(fileName) {
  const dot = fileName.lastIndexOf(".");
  return (dot > 0 ? fileName.slice(0, dot) : fileName).toUpperCase();
}

const RAW_FORMATS = new Set(["raw"]);
const JPEG_LIKE = new Set(["jpeg", "heic"]);

/**
 * Pair RAW+JPEG twins and Live Photos (HEIC still + MOV with the same stem or
 * matching ContentIdentifier). Returns patches: the sibling hides behind the
 * primary. Input: [{ id, fileName, format, mediaType, contentId, dirRel }].
 */
export function pairSiblings(items) {
  const patches = [];
  const byStem = new Map();
  for (const item of items) {
    const key = `${item.dirRel ?? ""}/${stem(item.fileName)}`;
    if (!byStem.has(key)) byStem.set(key, []);
    byStem.get(key).push(item);
  }
  const byContentId = new Map();
  for (const item of items) {
    if (!item.contentId) continue;
    if (!byContentId.has(item.contentId)) byContentId.set(item.contentId, []);
    byContentId.get(item.contentId).push(item);
  }

  const paired = new Set();

  const pair = (primary, sibling, role) => {
    if (paired.has(sibling.id) || paired.has(primary.id) || primary.id === sibling.id) return;
    paired.add(sibling.id);
    patches.push({ id: sibling.id, pairRole: role, pairPrimaryId: primary.id });
  };

  // Live Photos first (ContentIdentifier is authoritative when present).
  for (const members of byContentId.values()) {
    const still = members.find((m) => m.mediaType === "photo");
    const video = members.find((m) => m.mediaType === "video");
    if (still && video) pair(still, video, "live-video");
  }

  for (const members of byStem.values()) {
    if (members.length < 2) continue;
    const raw = members.find((m) => RAW_FORMATS.has(m.format));
    const jpegLike = members.find((m) => JPEG_LIKE.has(m.format) && m.mediaType === "photo");
    if (raw && jpegLike) pair(jpegLike, raw, "raw-sibling");

    const still = members.find((m) => m.mediaType === "photo" && m.format === "heic");
    const video = members.find((m) => m.mediaType === "video" && ["mov", "mp4"].includes(m.format));
    if (still && video) pair(still, video, "live-video");
  }

  return patches;
}

/** Deterministic best-of-burst: the sharpest, tie-broken by exposure balance. */
export function pickBest(assets) {
  let best = null;
  let bestScore = -Infinity;
  for (const asset of assets) {
    const q = asset.quality ?? {};
    const sharp = q.blurScore ?? 0;
    const clipPenalty = ((q.clippedHighlights ?? 0) + (q.clippedShadows ?? 0)) * 200;
    const score = sharp - clipPenalty;
    if (score > bestScore) {
      bestScore = score;
      best = asset;
    }
  }
  return best?.id;
}
