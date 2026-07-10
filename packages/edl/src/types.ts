import type { z } from "zod";
import type {
  AssetSchema,
  AudioClipSchema,
  AudioTrackSchema,
  BenchmarkFeatureSchema,
  BenchmarksSchema,
  CaptionTrackSchema,
  CaptionWordSchema,
  EdlSchema,
  FormatSchema,
  GradeSchema,
  MetaSchema,
  StyleExemplarSchema,
  StyleProfileSchema,
  TextAlignmentSchema,
  TextAnimSchema,
  TextClipSchema,
  TextTrackSchema,
  ThemeSchema,
  TrackSchema,
  TransitionSchema,
  TransformSchema,
  VideoClipSchema,
  VideoTrackSchema,
} from "./schema.js";

export type Edl = z.infer<typeof EdlSchema>;
export type Format = z.infer<typeof FormatSchema>;
export type Theme = z.infer<typeof ThemeSchema>;
export type Transition = z.infer<typeof TransitionSchema>;
export type TextAnim = z.infer<typeof TextAnimSchema>;
export type Transform = z.infer<typeof TransformSchema>;
export type Asset = z.infer<typeof AssetSchema>;

export type Track = z.infer<typeof TrackSchema>;
export type VideoTrack = z.infer<typeof VideoTrackSchema>;
export type TextTrack = z.infer<typeof TextTrackSchema>;
export type CaptionTrack = z.infer<typeof CaptionTrackSchema>;
export type CaptionWord = z.infer<typeof CaptionWordSchema>;
export type AudioTrack = z.infer<typeof AudioTrackSchema>;

export type VideoClip = z.infer<typeof VideoClipSchema>;
export type TextClip = z.infer<typeof TextClipSchema>;
export type AudioClip = z.infer<typeof AudioClipSchema>;

export type Meta = z.infer<typeof MetaSchema>;
export type Grade = z.infer<typeof GradeSchema>;
export type TextAlignment = z.infer<typeof TextAlignmentSchema>;
export type StyleProfile = z.infer<typeof StyleProfileSchema>;
export type StyleExemplar = z.infer<typeof StyleExemplarSchema>;
export type Benchmarks = z.infer<typeof BenchmarksSchema>;
export type BenchmarkFeature = z.infer<typeof BenchmarkFeatureSchema>;
