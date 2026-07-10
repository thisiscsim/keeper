---
name: learn-aesthetic
description: Study a creator's own past videos and write a reusable aesthetic profile (style.json) that seeds generation. Use when the user wants the agent to "learn my style/vibe" from reference clips they've uploaded into a project's references/ folder.
---

# Learn Aesthetic

Turn a creator's uploaded reference videos into a portable style profile. Input: clips in `projects/<slug>/references/`. Output: a validated `projects/<slug>/style.json` (StyleProfileSchema in `packages/edl/src/schema.ts`) plus a human-readable `projects/<slug>/aesthetic.md`.

This is the multimodal complement to the deterministic `analyze-style.mjs` script: the script measures palette + pacing; you watch the frames and capture the taste.

## Steps

1. Confirm references exist: list `projects/<slug>/references/`. If empty, ask the user to upload 2-5 of their own past videos first.
2. Run the deterministic baseline: `node app/scripts/extract-frames.mjs --slug <slug>` (samples stills into `references/.frames/`) and `node app/scripts/analyze-style.mjs --slug <slug>` (writes a baseline `style.json` with palette, pacing, length, energy).
3. Look at the sampled frames in `references/.frames/`. Read them as images. Note: dominant colors and contrast, framing/composition, on-screen text treatment (size, position, font feel, caption style), motion energy, and any recurring hook structure in the first ~2s.
4. If transcripts exist (or you run `node app/scripts/transcribe.mjs`), note verbal hook patterns and pacing of speech.
5. Refine `style.json` on top of the baseline. Keep the script's measured `palette`, `pacing`, `targetLengthSec`, and `energy` unless your eyes strongly disagree; then add the interpretive fields:
   - `fontFamily` (a CSS stack matching the vibe), `captionStyle` (`karaoke | block | word | none`).
   - `hookPattern` — one sentence describing how their strongest opens work.
   - `do` — 3-6 concrete, transferable style rules (e.g. "Open on the single most striking shot, no title card first").
   - `avoid` — 3-6 things that would break the vibe.
   - `notes` — a short paragraph a stranger could use to reproduce the look.
6. Write `aesthetic.md`: a readable narrative of the creator's style (palette, type, motion, hook, pacing, energy) for the user to skim and the generator to reference.

## Rules

- Learn GENERAL, transferable principles, not the literal contents of one clip ("warm low-key palette, fast cuts on the beat" — not "the ramen shot at 0:04").
- Never invent metrics the script measured differently; the script is the source of truth for palette/pacing/length.
- `style.json` MUST validate against `StyleProfileSchema`.
- Set `id` to something stable (e.g. `learned`) so `meta.json.styleProfileId` and generation can reference it.
