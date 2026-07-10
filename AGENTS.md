# Keeper

> NOTE: scaffolded from Aperture — the conventions below describe the inherited codebase; update as Keeper diverges.

AI-assisted short-form video studio. You (the agent) turn a prompt + raw clips into a finished vertical social video by writing a declarative timeline (`edl.json`), which a local Electron editor previews and exports via Remotion.

## How it works

The full creator journey (front to back):

1. The user opens the editor on a project **homepage** and creates a project under `projects/<slug>/` (scaffolds `meta.json`, `prompt.md`, an empty `edl.json`, and `assets/ references/ benchmarks/ transcripts/ renders/`).
2. In the editor they provide input: upload clips into `assets/`, write intent in `prompt.md`, attach music, and add or record a voiceover (which auto-transcribes to word-level captions).
3. Optionally they teach the agent their look: upload their own past videos into `references/` and run aesthetic learning, which writes a reusable `style.json` profile (+ `aesthetic.md`).
4. You generate the first cut by writing `projects/<slug>/edl.json` — the single source of truth — conditioned on `prompt.md` and `style.json`.
5. The Electron editor live-previews `edl.json` and live-reloads it when you (or the user) change it. The user refines on the timeline; their edits autosave back to `edl.json`.
6. You critique the cut into `critique.json`, calibrated against the creator's own high-performers in `benchmarks.json` when present. The `auto-tune` loop iterates generate -> critique -> fix, logging `results.tsv`.

## The contract: edl.json (+ sidecar files)

`edl.json` is validated by the zod schema in `packages/edl` (`packages/edl/src/schema.ts`). Never write an `edl.json` that fails `EdlSchema`.

Shape: `format` (vertical 1080x1920, fps), `theme` (font, palette, captionStyle, safeMargins, optional `stylePreset`), `assets[]`, `tracks[]` where each track is `video | text | caption | audio`. Audio clips carry a `role` (`music | voiceover | sfx`); music with `duckUnderVoice` is attenuated under voiceover.

Per-project sidecar files (each has its own schema + `parse*` helper in `packages/edl`):

- `meta.json` (`MetaSchema`) — title, platform, status, `styleProfileId`.
- `style.json` (`StyleProfileSchema`) — learned/selected aesthetic: palette, font, captions, pacing, hook, energy, do/avoid.
- `benchmarks.json` (`BenchmarksSchema`) — feature distribution of the creator's high-performers, for benchmark-relative critique.

## Skills

- `/create-social-video <slug>` — analyze clips + prompt (+ `style.json`), write `edl.json` (first cut).
- `/learn-aesthetic <slug>` — study the creator's `references/`, write `style.json` + `aesthetic.md`.
- `/critique-video <slug>` — score the cut (vs `benchmarks.json` when present), write `critique.json`.
- `/auto-tune <slug>` — loop generate/adjust -> critique -> fix, logging `results.tsv`.

## Helper scripts (`app/scripts/`)

`analyze.mjs` (baseline assembly), `transcribe.mjs` (captions, prefers the voiceover clip), `render.mjs` (export), `extract-frames.mjs` + `analyze-style.mjs` (aesthetic baseline), `analyze-benchmarks.mjs` (benchmark features), `autotune.mjs` (deterministic auto-improve).

## Scoped conventions

Area-specific rules live in `.cursor/rules/` (IPC/main-process, renderer design system, engine scripts, EDL schema, delivery workflow). They activate by file glob in Cursor; other agents should skim the relevant file before working in that area.

## Boundaries

- Generated artifacts live under `projects/<slug>/`. In the app these resolve to the user's Aperture home (`~/Documents/Aperture/projects/`, configurable); the scripts honor `APERTURE_PROJECTS_DIR` and fall back to the repo's `projects/` in dev. Don't write outside a project folder except code changes you were explicitly asked to make.
- Vertical 1080x1920 @ 30fps is the default format.
- Keep the design system lightweight: font, palette, caption style, simple overlays — all driven by `theme`. Don't hardcode styling that belongs in `theme`.
- Only reference assets that actually exist in the project's `assets/` and are listed in `edl.assets`.
