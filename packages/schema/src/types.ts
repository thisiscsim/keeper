import type { z } from "zod";
import type {
  AiVerdictSchema,
  AiSuggestionSchema,
  AssetRecordSchema,
  DateSourceSchema,
  ExifSummarySchema,
  GpsSchema,
  GroupSchema,
  ImportManifestSchema,
  ImportStageSchema,
  JudgeBatchResultSchema,
  JudgeItemResultSchema,
  MediaFormatSchema,
  MediaTypeSchema,
  PairRoleSchema,
  QualitySchema,
  ReasonCodeSchema,
  SearchFiltersSchema,
  SearchResponseSchema,
  SearchResultSchema,
  TasteExemplarSchema,
  TasteProfileSchema,
  TasteRuleSchema,
  TasteThresholdsSchema,
  UserFlagSchema,
  UserVerdictSchema,
  VerdictReasonSchema,
} from "./schema.js";

export type MediaType = z.infer<typeof MediaTypeSchema>;
export type MediaFormat = z.infer<typeof MediaFormatSchema>;
export type DateSource = z.infer<typeof DateSourceSchema>;
export type PairRole = z.infer<typeof PairRoleSchema>;
export type Gps = z.infer<typeof GpsSchema>;
export type ExifSummary = z.infer<typeof ExifSummarySchema>;

export type ReasonCode = z.infer<typeof ReasonCodeSchema>;
export type Quality = z.infer<typeof QualitySchema>;
export type AiSuggestion = z.infer<typeof AiSuggestionSchema>;
export type VerdictReason = z.infer<typeof VerdictReasonSchema>;
export type AiVerdict = z.infer<typeof AiVerdictSchema>;
export type UserFlag = z.infer<typeof UserFlagSchema>;
export type UserVerdict = z.infer<typeof UserVerdictSchema>;

export type AssetRecord = z.infer<typeof AssetRecordSchema>;
export type Group = z.infer<typeof GroupSchema>;

export type ImportStage = z.infer<typeof ImportStageSchema>;
export type ImportManifest = z.infer<typeof ImportManifestSchema>;

export type TasteThresholds = z.infer<typeof TasteThresholdsSchema>;
export type TasteRule = z.infer<typeof TasteRuleSchema>;
export type TasteExemplar = z.infer<typeof TasteExemplarSchema>;
export type TasteProfile = z.infer<typeof TasteProfileSchema>;

export type SearchFilters = z.infer<typeof SearchFiltersSchema>;
export type SearchResult = z.infer<typeof SearchResultSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export type JudgeItemResult = z.infer<typeof JudgeItemResultSchema>;
export type JudgeBatchResult = z.infer<typeof JudgeBatchResultSchema>;
