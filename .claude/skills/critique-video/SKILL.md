---
name: critique-video
description: Score a short-form video cut against short-form best practices (and the creator's own high-performers when available) and write critique.json with a 0-100 score and specific fixes. Use after a first cut exists, when the user wants feedback or a quality read on a video.
---

# Critique Video

Reads `projects/<slug>/edl.json` (and optional rendered stills + `benchmarks.json`) and writes `projects/<slug>/critique.json`.

## Calibration

Grade to the standard of a demanding short-form editor: "would this earn a stop-scroll and a rewatch?" Score what's actually there, not the intent. Most AI-assembled first cuts land 45-65. Above 80 means you'd confidently post it. Bands: 0-39 broken, 40-59 functional, 60-74 good, 75-89 excellent, 90-100 world-class.

## Rubric (0-100, weighted)

- Hook strength (first ~2s) — 25
- Pacing / cut frequency — 15
- Caption coverage + legibility — 15
- Vertical safe-area compliance — 10
- Length vs platform norm — 10
- Audio presence / quality — 15
- Ending / payoff — 10

## Benchmark calibration (preferred)

If `projects/<slug>/benchmarks.json` exists (built by `node app/scripts/analyze-benchmarks.mjs` from the creator's uploaded high-performers), score Pacing and Length RELATIVE to that distribution, not fixed thresholds:

- Pull `distribution.cutsPer10s` and `distribution.durationSec` (each has `mean`, `std`, `min`, `max`).
- Full marks when the cut is within ~1 std of the mean; decay toward 0 by ~3 std.
- In the matching subscore, set `benchmark: { yours, theirs, unit }` (theirs = the benchmark mean) and make the fix comparative ("your top videos average ~6 cuts/10s; this has 3").

If `benchmarks.json` is absent, score on heuristics and say so in `summary`.

## Common short-form pitfalls to flag

Slow/ambiguous first second, no captions (most viewers are muted), text inside the platform UI safe zones, monotone pacing (evenly spaced cuts), dead air / no audio bed, and an ending that just stops instead of paying off.

## Output: critique.json

Write this exact shape (it powers the editor's Critique panel):

```json
{
  "score": 0,
  "subscores": [
    { "key": "hook", "label": "Hook (first 2s)", "max": 25, "score": 0, "note": "" },
    { "key": "pacing", "label": "Pacing", "max": 15, "score": 0, "note": "", "benchmark": { "yours": 0, "theirs": 0, "unit": "cuts/10s" } },
    { "key": "captions", "label": "Captions", "max": 15, "score": 0, "note": "" },
    { "key": "safe", "label": "Safe areas", "max": 10, "score": 0, "note": "" },
    { "key": "length", "label": "Length", "max": 10, "score": 0, "note": "", "benchmark": { "yours": 0, "theirs": 0, "unit": "s" } },
    { "key": "audio", "label": "Audio", "max": 15, "score": 0, "note": "" },
    { "key": "ending", "label": "Ending", "max": 10, "score": 0, "note": "" }
  ],
  "fixes": [{ "issue": "", "fix": "" }],
  "benchmarksUsed": false,
  "summary": ""
}
```

## Honesty

This is a craft + fit score, not a virality guarantee. When calibrated against `benchmarks.json`, say how many of the creator's videos it was compared to in `summary`. Otherwise state plainly that it's heuristic.
