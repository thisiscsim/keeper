import { z } from "zod";

/**
 * Keeper's shared contracts. Everything that crosses a process boundary —
 * renderer <-> main IPC, main <-> catalog service, pipeline scripts, agent
 * skills, and the LLM judge — validates against these schemas.
 *
 * Catalog rows and taste.json are an interchange format (agent- and
 * LLM-authored), so treat every field as untrusted: numerics are finite and
 * bounded, paths must stay inside the library, strings and arrays are capped.
 */

/** Upper bound for any media duration, in seconds (24 hours). */
export const MAX_DURATION_SEC = 86_400;

/** Finite, non-negative number with a sane ceiling. */
const bounded = (max: number) => z.number().finite().nonnegative().max(max);

/**
 * A path that must stay inside the library folder: relative, no `..`
 * segments, no drive letters / UNC prefixes / NUL.
 */
export const RelativePathSchema = z
  .string()
  .min(1)
  .max(1024)
  .refine(
    (p) =>
      !p.startsWith("/") &&
      !/^[A-Za-z]:[\\/]/.test(p) &&
      !p.startsWith("\\\\") &&
      !p.includes("\0") &&
      !p.split(/[\\/]/).some((seg) => seg === ".."),
    { message: "must be a library-relative path without .. segments" },
  );

/** Opaque ids we mint ourselves (content-hash prefixes, slugs, ULIDs). */
export const IdSchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/);

// ---------------------------------------------------------------------------
// Media identity + metadata
// ---------------------------------------------------------------------------

export const MediaTypeSchema = z.enum(["photo", "video"]);

/** Container/format family, used for pairing and decode routing. */
export const MediaFormatSchema = z.enum([
  "jpeg",
  "png",
  "heic",
  "webp",
  "gif",
  "tiff",
  "raw",
  "mp4",
  "mov",
  "avi",
  "mkv",
  "webm",
  "other",
]);

/** Where the capture timestamp came from (EXIF is trusted more than mtime). */
export const DateSourceSchema = z.enum(["exif", "filename", "mtime", "unknown"]);

/** How a file relates to its logical asset (RAW+JPEG and Live Photo pairing). */
export const PairRoleSchema = z.enum(["primary", "raw-sibling", "live-video"]);

export const GpsSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lon: z.number().finite().min(-180).max(180),
});

export const ExifSummarySchema = z.object({
  make: z.string().max(128).optional(),
  model: z.string().max(128).optional(),
  lens: z.string().max(256).optional(),
  iso: z.number().finite().nonnegative().max(10_000_000).optional(),
  /** Exposure time in seconds (e.g. 0.004 for 1/250). */
  exposureSec: z.number().finite().nonnegative().max(86_400).optional(),
  fNumber: z.number().finite().nonnegative().max(1024).optional(),
  focalMm: z.number().finite().nonnegative().max(100_000).optional(),
  gps: GpsSchema.optional(),
  /** Apple Live Photo pairing id when present (MediaGroupUUID / ContentIdentifier). */
  contentId: z.string().max(128).optional(),
});

// ---------------------------------------------------------------------------
// Quality + verdicts
// ---------------------------------------------------------------------------

/** Machine-readable reasons attached to AI verdicts; UI maps these to chips. */
export const ReasonCodeSchema = z.enum([
  "blurry",
  "soft-focus",
  "underexposed",
  "overexposed",
  "black-frame",
  "flat-frame",
  "corrupt",
  "tiny-file",
  "accidental-clip",
  "screenshot",
  "screen-recording",
  "duplicate-worse",
  "burst-not-pick",
  "eyes-closed",
  "bad-framing",
  "sharpest-of-burst",
  "well-exposed",
  "important-moment",
  "llm-quality",
  "other",
]);

/** Measured technical quality (local CV pass, deterministic + explainable). */
export const QualitySchema = z.object({
  /** Variance of Laplacian on a normalized grayscale thumb; higher = sharper. */
  blurScore: bounded(1_000_000).optional(),
  /** Mean luma 0..255 of the thumb. */
  meanLuma: bounded(255).optional(),
  /** Fraction of pixels clipped at the highlight end (>= 250). */
  clippedHighlights: z.number().finite().min(0).max(1).optional(),
  /** Fraction of pixels clipped at the shadow end (<= 5). */
  clippedShadows: z.number().finite().min(0).max(1).optional(),
  /** Luma standard deviation — near zero means a flat/blank frame. */
  lumaStdDev: bounded(255).optional(),
});

export const AiSuggestionSchema = z.enum(["keep", "reject", "review"]);

export const VerdictReasonSchema = z.object({
  code: ReasonCodeSchema,
  /** Short human-readable elaboration ("1/15s at 85mm", "twin of IMG_0231"). */
  detail: z.string().max(512).optional(),
  /** Asset id this reason references (e.g. the sharper twin). */
  refAssetId: IdSchema.optional(),
});

export const AiVerdictSchema = z.object({
  suggestion: AiSuggestionSchema,
  /** 0 = wild guess, 1 = certain. Queue routing thresholds live in taste.json. */
  confidence: z.number().finite().min(0).max(1),
  reasons: z.array(VerdictReasonSchema).max(16).default([]),
  source: z.enum(["cv", "llm"]),
  model: z.string().max(128).optional(),
  at: z.string().max(64).optional(),
});

export const UserFlagSchema = z.enum(["pick", "reject", "unrated"]);

export const UserVerdictSchema = z.object({
  flag: UserFlagSchema.default("unrated"),
  rating: z.number().int().min(0).max(5).default(0),
  at: z.string().max(64).optional(),
});

// ---------------------------------------------------------------------------
// Asset record — one logical media file in the library
// ---------------------------------------------------------------------------

export const AssetRecordSchema = z.object({
  id: IdSchema,
  /** Path of the original, relative to the library root. */
  relPath: RelativePathSchema,
  fileName: z.string().min(1).max(512),
  byteSize: bounded(1e15),
  /** SHA-256 of the file contents (dedupe identity across imports). */
  contentHash: z.string().min(16).max(128),
  mediaType: MediaTypeSchema,
  format: MediaFormatSchema,
  width: z.number().int().positive().max(1_000_000).optional(),
  height: z.number().int().positive().max(1_000_000).optional(),
  durationSec: z.number().finite().positive().max(MAX_DURATION_SEC).optional(),
  capturedAt: z.string().max(64).optional(),
  dateSource: DateSourceSchema.default("unknown"),
  exif: ExifSummarySchema.default({}),
  importId: IdSchema.optional(),
  importedAt: z.string().max(64).optional(),

  /** Burst / near-duplicate group membership. */
  groupId: IdSchema.optional(),
  /** RAW+JPEG / Live Photo pairing. Non-primary files hide behind the primary. */
  pairRole: PairRoleSchema.default("primary"),
  pairPrimaryId: IdSchema.optional(),

  /** Original volume unmounted (thumbnails still browsable). */
  offline: z.boolean().default(false),

  // Derived artifacts, relative to <library>/.keeper/
  thumbRel: RelativePathSchema.optional(),
  previewRel: RelativePathSchema.optional(),
  posterRel: RelativePathSchema.optional(),
  scrubRel: RelativePathSchema.optional(),

  quality: QualitySchema.default({}),
  ai: AiVerdictSchema.optional(),
  user: UserVerdictSchema.default({}),

  /** Zero-shot / LLM tags, lowercase. */
  tags: z.array(z.string().max(64)).max(128).default([]),
  /** One-line LLM caption (search explainability + event naming input). */
  caption: z.string().max(1024).optional(),

  /** Pipeline checkpoints: stage name -> ISO timestamp when completed. */
  stages: z.record(z.string().max(32), z.string().max(64)).default({}),
});

// ---------------------------------------------------------------------------
// Groups (bursts / near-duplicates)
// ---------------------------------------------------------------------------

export const GroupSchema = z.object({
  id: IdSchema,
  kind: z.enum(["burst", "similar"]),
  assetIds: z.array(IdSchema).min(1).max(1000),
  bestPickId: IdSchema.optional(),
  pickSource: z.enum(["cv", "llm", "user"]).optional(),
});

// ---------------------------------------------------------------------------
// Import manifest — one import run, checkpointed for resume
// ---------------------------------------------------------------------------

export const ImportStageSchema = z.enum([
  "scan",
  "copy",
  "metadata",
  "derive",
  "cv",
  "group",
  "embed",
  "verdict",
  "done",
]);

export const ImportManifestSchema = z.object({
  id: IdSchema,
  /** Absolute source paths as picked by the user (display only, never trusted as output paths). */
  sources: z.array(z.string().max(4096)).max(64).default([]),
  startedAt: z.string().max(64),
  finishedAt: z.string().max(64).optional(),
  stage: ImportStageSchema.default("scan"),
  status: z.enum(["running", "done", "failed", "cancelled"]).default("running"),
  error: z.string().max(4096).optional(),
  counts: z
    .object({
      found: bounded(1e9).default(0),
      copied: bounded(1e9).default(0),
      duplicates: bounded(1e9).default(0),
      failed: bounded(1e9).default(0),
    })
    .default({}),
});

// ---------------------------------------------------------------------------
// Taste profile — the learned culling preferences (taste.json)
// ---------------------------------------------------------------------------

export const TasteThresholdsSchema = z.object({
  /** Below this blur score the CV pass suggests reject (conservative default). */
  blurReject: bounded(1_000_000).default(18),
  /** Below this it suggests review rather than keep. */
  blurReview: bounded(1_000_000).default(60),
  /** Clipped-fraction above which exposure is flagged. */
  clipReject: z.number().min(0).max(1).default(0.55),
  clipReview: z.number().min(0).max(1).default(0.3),
  /** Videos shorter than this are suggested accidental clips. */
  accidentalClipSec: bounded(60).default(1.2),
  /** AI suggestions with confidence >= this land in the "sure" queues. */
  sureConfidence: z.number().min(0).max(1).default(0.85),
});

export const TasteRuleSchema = z.object({
  id: IdSchema,
  /** Natural-language standing rule, injected into LLM judge prompts. */
  text: z.string().min(1).max(512),
  createdAt: z.string().max(64).optional(),
});

/** One user override of an AI verdict — a labeled example for future passes. */
export const TasteExemplarSchema = z.object({
  assetId: IdSchema.optional(),
  thumbRel: RelativePathSchema.optional(),
  aiSuggestion: AiSuggestionSchema,
  aiReason: ReasonCodeSchema.optional(),
  userFlag: UserFlagSchema,
  note: z.string().max(512).optional(),
  at: z.string().max(64).optional(),
});

export const TasteProfileSchema = z.object({
  version: z.literal(1).default(1),
  thresholds: TasteThresholdsSchema.default({}),
  rules: z.array(TasteRuleSchema).max(64).default([]),
  exemplars: z.array(TasteExemplarSchema).max(200).default([]),
  /** Override tallies per reason code: { blurry: { kept: 4, confirmed: 21 } } */
  stats: z
    .record(
      z.string().max(64),
      z.object({
        kept: bounded(1e9).default(0),
        confirmed: bounded(1e9).default(0),
      }),
    )
    .default({}),
  updatedAt: z.string().max(64).optional(),
});

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export const SearchFiltersSchema = z.object({
  mediaType: MediaTypeSchema.optional(),
  flag: UserFlagSchema.optional(),
  minRating: z.number().int().min(0).max(5).optional(),
  /** ISO date bounds (inclusive) on capturedAt. */
  from: z.string().max(64).optional(),
  to: z.string().max(64).optional(),
});

export const SearchResultSchema = z.object({
  assetId: IdSchema,
  /** Cosine similarity (semantic) or 0..1 heuristic score for metadata hits. */
  score: z.number().finite().min(-1).max(1),
  /** Why it matched: "semantic", tag names, caption fragment. */
  matched: z.array(z.string().max(128)).max(8).default([]),
});

export const SearchResponseSchema = z.object({
  query: z.string().max(512),
  mode: z.enum(["semantic", "metadata"]),
  results: z.array(SearchResultSchema).max(1000).default([]),
});

// ---------------------------------------------------------------------------
// LLM judge I/O — the shape the model must return, repaired then validated
// ---------------------------------------------------------------------------

export const JudgeItemResultSchema = z.object({
  assetId: IdSchema,
  suggestion: AiSuggestionSchema,
  confidence: z.number().finite().min(0).max(1),
  reason: ReasonCodeSchema.default("llm-quality"),
  detail: z.string().max(512).optional(),
  caption: z.string().max(1024).optional(),
  tags: z.array(z.string().max(64)).max(32).default([]),
});

export const JudgeBatchResultSchema = z.object({
  items: z.array(JudgeItemResultSchema).max(64).default([]),
  /** For burst groups included in the batch: groupId -> best asset id. */
  bestPicks: z.record(z.string().max(128), IdSchema).default({}),
});
