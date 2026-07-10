import type { Benchmarks, Edl } from "@reel/edl";
import { durationSeconds } from "@reel/edl";

export interface BenchmarkCompare {
  yours: number;
  theirs: number;
  unit: string;
}

export interface SubScore {
  key: string;
  label: string;
  score: number;
  max: number;
  note: string;
  benchmark?: BenchmarkCompare;
}

export interface Critique {
  score: number;
  subscores: SubScore[];
  fixes: { issue: string; fix: string }[];
  benchmarksUsed?: boolean;
  summary?: string;
}

// Closeness score: full marks within ~1 std of the benchmark mean, decaying to 0
// by ~3 std. Used so pacing/length are judged against THIS creator's winners.
function closeness(value: number, mean: number, std: number, max: number): number {
  const z = Math.abs(value - mean) / Math.max(std, 1e-6);
  return Math.round(max * Math.max(0, Math.min(1, 1 - (z - 1) / 2)));
}

/**
 * Heuristic best-practices score for a short-form cut. When a benchmarks.json
 * (the creator's own high-performers) is supplied, pacing and length are scored
 * relative to that distribution instead of fixed thresholds.
 */
export function critiqueEdl(edl: Edl, benchmarks?: Benchmarks | null): Critique {
  const dur = durationSeconds(edl);
  const videoClips = edl.tracks
    .filter((t) => t.type === "video")
    .flatMap((t) => (t.type === "video" ? t.clips : []));
  const textClips = edl.tracks
    .filter((t) => t.type === "text")
    .flatMap((t) => (t.type === "text" ? t.clips : []));
  const hasCaptions = edl.tracks.some(
    (t) => t.type === "caption" && (Boolean(t.source) || (t.words?.length ?? 0) > 0),
  );
  const hasAudio = edl.tracks.some((t) => t.type === "audio" && t.clips.length > 0);
  const hasMargins = edl.theme.safeMargins.top > 0 && edl.theme.safeMargins.bottom > 0;

  const hookPresent = videoClips.some((c) => c.start <= 0.1) || textClips.some((c) => c.start <= 2);
  const endingPresent =
    videoClips.some((c) => c.start + (c.out - c.in) >= dur - 1.5) || textClips.some((c) => c.end >= dur - 1.5);

  const cutsPer10s = dur > 0 ? (videoClips.length / dur) * 10 : 0;
  const dist = benchmarks?.distribution;
  const benchmarksUsed = Boolean(dist && benchmarks && benchmarks.count > 0);

  // Pacing: benchmark-relative when we have data, else the generic 4-12 cuts band.
  const pacingBench = dist?.cutsPer10s;
  const pacing: SubScore =
    pacingBench && videoClips.length > 0
      ? {
          key: "pacing",
          label: "Pacing",
          max: 15,
          score: closeness(cutsPer10s, pacingBench.mean, pacingBench.std, 15),
          note: `${cutsPer10s.toFixed(1)} cuts/10s vs your winners' ${pacingBench.mean.toFixed(1)}.`,
          benchmark: { yours: round1(cutsPer10s), theirs: round1(pacingBench.mean), unit: "cuts/10s" },
        }
      : {
          key: "pacing",
          label: "Pacing",
          max: 15,
          score: videoClips.length >= 4 && videoClips.length <= 12 ? 14 : videoClips.length === 0 ? 4 : 9,
          note: videoClips.length === 0 ? "No video clips yet — pacing can't be judged." : `${videoClips.length} cuts.`,
        };

  // Length: benchmark-relative when we have data, else the 7-35s sweet spot.
  const lenBench = dist?.durationSec;
  const length: SubScore =
    lenBench
      ? {
          key: "length",
          label: "Length",
          max: 10,
          score: closeness(dur, lenBench.mean, lenBench.std, 10),
          note: `${dur.toFixed(1)}s vs your winners' ${lenBench.mean.toFixed(1)}s.`,
          benchmark: { yours: round1(dur), theirs: round1(lenBench.mean), unit: "s" },
        }
      : {
          key: "length",
          label: "Length",
          max: 10,
          score: dur >= 7 && dur <= 35 ? 10 : dur < 7 ? 5 : 6,
          note: `${dur.toFixed(1)}s ${dur >= 7 && dur <= 35 ? "(in range)" : "(outside 7-35s sweet spot)"}.`,
        };

  const subscores: SubScore[] = [
    {
      key: "hook",
      label: "Hook (first 2s)",
      max: 25,
      score: hookPresent ? 22 : 6,
      note: hookPresent ? "Opens with a clear hook." : "No strong element in the first 2 seconds.",
    },
    pacing,
    {
      key: "captions",
      label: "Captions",
      max: 15,
      score: hasCaptions ? 15 : 4,
      note: hasCaptions ? "Captions present." : "Add captions — most short-form is watched muted.",
    },
    {
      key: "safe",
      label: "Safe areas",
      max: 10,
      score: hasMargins ? 10 : 3,
      note: hasMargins ? "Text respects platform UI zones." : "Set safe margins so text clears the UI.",
    },
    length,
    {
      key: "audio",
      label: "Audio",
      max: 15,
      score: hasAudio ? 14 : 5,
      note: hasAudio ? "Has an audio bed." : "Add music or voice — silence underperforms.",
    },
    {
      key: "ending",
      label: "Ending",
      max: 10,
      score: endingPresent ? 9 : 4,
      note: endingPresent ? "Has a closing beat." : "Land the ending with a payoff or CTA.",
    },
  ];

  const score = Math.round(subscores.reduce((s, x) => s + x.score, 0));
  const fixes = subscores.filter((s) => s.score / s.max < 0.7).map((s) => ({ issue: s.label, fix: s.note }));
  const summary = benchmarksUsed
    ? `Scored against ${benchmarks?.count} of your own high-performers.`
    : "Heuristic best-practices score — upload benchmark videos for a creator-calibrated read.";

  return { score, subscores, fixes, benchmarksUsed, summary };
}

const round1 = (n: number) => Math.round(n * 10) / 10;
