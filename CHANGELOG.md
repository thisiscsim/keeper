# Changelog

All notable changes to Keeper are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is
pre-release, so everything lives under "Unreleased" until we start tagging
versions.

## [Unreleased]

### Added

- **Keeper v1 — AI-assisted culling for photos and videos.** The repo pivots
  from the inherited Aperture video-studio scaffold to a media-culling app:
  - **Library**: one date-sorted local library (`~/Pictures/Keeper` by
    default); imports copy in checksummed + deduplicated, with EXIF via
    exiftool, thumbnails/previews for JPEG/PNG/HEIC/RAW (embedded preview),
    and posters + hover-scrub strips for video.
  - **Auto-cull pipeline**: local blur/exposure/black-frame/corrupt/accidental
    -clip/screenshot detection (ffmpeg-piped grayscale + pure-JS math), burst
    and near-duplicate grouping (pHash + capture time) with best-frame picks,
    RAW+JPEG and Live Photo pairing — every suggestion with reasons and
    confidence, checkpointed and resumable.
  - **Review mode**: three confidence queues (sure rejects / sure keeps /
    needs your eye) with evidence (3x focus crop, sharper-twin comparison),
    bulk confirm, keyboard-first culling (P/X/U, 0–5 stars, Space loupe),
    and full undo/redo.
  - **Natural-language search**: local CLIP embeddings (transformers.js /
    onnxruntime, model cached in the library), instant offline cosine search
    with date-word narrowing; metadata fallback before the index is built.
  - **LLM judge** (optional): budgeted, batched GPT-5.5 vision over borderline
    items only — downscaled thumbnails, repaired-then-validated output,
    captions + tags, burst best-pick refinement; provider-agnostic via
    `KEEPER_LLM_*` env or Settings.
  - **Taste profile**: overrides become exemplars + threshold tuning in
    `taste.json`; standing rules injected into every AI run; fully
    user-inspectable in the app.
  - **Export/interop**: copy picks (with RAW/Live siblings) to a folder with
    Lightroom-readable `.xmp` sidecars, or write sidecars in place; reveal in
    Finder; two-step "empty rejects" that only ever moves originals to the OS
    Trash.
  - **Agent tier**: `/cull-shoot`, `/find-media`, `/organize-library` skills +
    JSON CLIs (`query.mjs`, `verdict.mjs`) that read/write the same catalog
    with the same taste feedback.
- **Catalog**: SQLite (`node:sqlite`, no native build step) at
  `.keeper/catalog.db`, brokered to the app by a spawned catalog service
  (line-delimited JSON-RPC) so the Electron main process stays DB-free; all
  rows validated against the new `@keeper/schema` zod contracts on read and
  write.

### Changed

- `packages/edl` (`@reel/edl`) is now `packages/schema` (`@keeper/schema`):
  asset records, verdicts, groups, taste profile, import manifests, search and
  judge I/O — same hostile-input discipline (bounded numerics, confined
  relative paths, capped collections).
- Electron main process rebuilt around the library: `keeper-asset://` byte-range
  streaming protocol, stamp-file watcher for agent live-refresh, `KEEPER_*`
  env names, settings (library location, AI budget, auto-judge, hardware
  decode).
- Renderer rebuilt on the same design tokens + UI kit: date-sectioned lazy
  grid, loupe with burst strip, review queues, search, taste/export/rejects/
  settings modals; zustand store with optimistic verdicts and undo history.

### Removed

- The video-editor surface area: Remotion preview/export, the timeline editor,
  EDL schema and engine scripts (generate/critique/autotune/transcribe/TTS),
  style library, ElevenLabs integration, and the bundled music resources.

## [0.1.0] - Initial commit

- Scaffolded from the Aperture video studio (Electron + Vite + React editor,
  shared schema package, engine-script + skills architecture, design tokens,
  Vitest + CI).
