---
name: auto-tune
description: Iteratively improve a short-form cut by looping generate/adjust -> critique -> apply fixes -> re-critique, logging each iteration's score to results.tsv. Use when the user wants the agent to "auto-improve" or "keep iterating until it's good".
---

# Auto-Tune

A critique-in-the-loop optimizer for a single video, modeled on the design `auto-skills` pattern. It treats the `critique-video` score as the fitness function and stops when it plateaus or hits the target.

Operates on one project: `projects/<slug>/edl.json`, scored against `benchmarks.json` when present.

## Loop

1. Baseline: run the `critique-video` skill, record the score. Append a header row to `projects/<slug>/results.tsv` if missing (`iter\tscore\tdelta\tchange`), then log iteration 0.
2. Pick the lowest subscore with a concrete, safe fix. Prefer fixes that move a metric toward the creator's `benchmarks.json` distribution (pacing toward `cutsPer10s.mean`, length toward `durationSec.mean`).
3. Apply exactly one change to `edl.json` (e.g. tighten pacing by trimming/reordering clips, add a stronger hook in the first 2s, enable/fix captions, set safe margins, add or duck a music bed, sharpen the ending). Keep it schema-valid (`EdlSchema`).
4. Re-run `critique-video`. If the score improved, keep the change and log the iteration (`i  score  +delta  change`); if it regressed, revert.
5. Repeat until: the target score is reached, the score plateaus (no improving change), or you hit the iteration cap (default 4-6).

## Rules

- One change per iteration so each delta is attributable.
- Never emit an `edl.json` that fails `EdlSchema`; never reference assets that don't exist.
- Learn toward general principles, not one-off hacks; the goal is a genuinely better cut, not a gamed score.
- Always leave `results.tsv` and `edl.json` in a consistent, valid state (the editor live-reloads `edl.json`).
- Be honest in the final summary: report the start score, end score, and what changed.
