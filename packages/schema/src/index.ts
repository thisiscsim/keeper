import type { z } from "zod";
import {
  AssetRecordSchema,
  GroupSchema,
  ImportManifestSchema,
  JudgeBatchResultSchema,
  TasteProfileSchema,
} from "./schema.js";
import type {
  AiSuggestion,
  AssetRecord,
  Group,
  ImportManifest,
  JudgeBatchResult,
  TasteProfile,
  UserFlag,
} from "./types.js";

export * from "./schema.js";
export * from "./types.js";

export interface ParseResult<T> {
  ok: boolean;
  value?: T;
  errors?: string[];
}

interface SafeParseable<T> {
  safeParse: (v: unknown) => z.SafeParseReturnType<unknown, T>;
}

function safeParseWith<T>(schema: SafeParseable<T>, input: unknown): ParseResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
  };
}

/** Parse + validate unknown JSON into a typed, defaulted asset record. */
export function parseAssetRecord(input: unknown): ParseResult<AssetRecord> {
  return safeParseWith(AssetRecordSchema, input);
}

/** Throwing variant — use where an invalid record is a programmer error. */
export function parseAssetRecordOrThrow(input: unknown): AssetRecord {
  return AssetRecordSchema.parse(input);
}

export function parseGroup(input: unknown): ParseResult<Group> {
  return safeParseWith(GroupSchema, input);
}

/** Parse + validate (with defaults) a taste.json profile. */
export function parseTasteProfile(input: unknown): TasteProfile {
  return TasteProfileSchema.parse(input ?? {});
}

/** Parse + validate (with defaults) an import manifest. */
export function parseImportManifest(input: unknown): ImportManifest {
  return ImportManifestSchema.parse(input);
}

/** Parse an LLM judge batch response (after sanitizing). */
export function parseJudgeBatch(input: unknown): ParseResult<JudgeBatchResult> {
  return safeParseWith(JudgeBatchResultSchema, input);
}

/**
 * The flag an asset is effectively in. The user's explicit verdict always
 * wins; AI suggestions never count as decisions (nothing is discarded until
 * a human confirms it).
 */
export function effectiveFlag(asset: Pick<AssetRecord, "ai" | "user">): UserFlag {
  return asset.user.flag;
}

/** Which review queue an asset belongs to, given the sure-confidence bar. */
export function reviewQueue(
  asset: Pick<AssetRecord, "ai" | "user">,
  sureConfidence: number,
): "sure-reject" | "sure-keep" | "needs-eye" | "decided" | "none" {
  if (asset.user.flag !== "unrated") return "decided";
  const ai = asset.ai;
  if (!ai) return "none";
  const sure = ai.confidence >= sureConfidence;
  if (ai.suggestion === "reject" && sure) return "sure-reject";
  if (ai.suggestion === "keep" && sure) return "sure-keep";
  return "needs-eye";
}

/** Does the user verdict contradict what the AI suggested? (taste signal) */
export function isOverride(aiSuggestion: AiSuggestion, userFlag: UserFlag): boolean {
  if (userFlag === "unrated") return false;
  if (aiSuggestion === "reject" && userFlag === "pick") return true;
  if (aiSuggestion === "keep" && userFlag === "reject") return true;
  return false;
}
