# Keeper

AI-assisted culling for photos and videos. Dump in an SD card, a phone folder, or two weeks of vacation chaos — Keeper copies everything into a local, date-sorted library, flags the junk with reasons you can check, groups bursts and picks the best frame, lets you search your whole library in plain English, and learns your taste from every call you overrule. When you're done, your keepers flow out to Lightroom, Capture One, or any folder — with your ratings attached.

Keeper is **local-first, not local-only**: importing, quality analysis, burst grouping, semantic search, preview, and export all run on your machine. The one optional cloud step is the AI judge (GPT-5.5 by default, provider-configurable), which only ever sees downscaled thumbnails of the borderline items, capped by a budget you set. With no API key, everything still works — you just review the borderline pile yourself.

## The flow

1. **Import** — pick files or a whole folder. Keeper copies (checksum-verified, deduplicated against your whole library) into `library/YYYY/YYYY-MM-DD/`, reads EXIF, and generates thumbnails and previews — including RAW (embedded previews), HEIC, and video posters with hover-scrub strips.
2. **Auto-cull** — a local pass measures sharpness and exposure, catches black frames, corrupt files, sub-second accidental clips, and screenshots; bursts and near-duplicates are grouped (perceptual hash + capture time) with the sharpest frame suggested as the pick; RAW+JPEG pairs and Live Photos are treated as one photo. Every suggestion carries a reason and a confidence.
3. **AI review** (optional) — the configured model looks at just the borderline items and judges what heuristics can't: eyes closed, bad framing, or the opposite — a technically imperfect shot of a moment that matters. Your standing rules and past corrections ride along in the prompt.
4. **Review** — three queues: *sure rejects* (spot-check, confirm in bulk), *sure keeps*, and *needs your eye*. Evidence is attached — a 3× focus crop, the sharper twin side-by-side. Keyboard-first: P/K keep, X/R reject, 0–5 stars, Space for the loupe, arrows to move. Everything is undoable (Cmd+Z).
5. **Search** — "ocean at sunset", "the kids at dinner" — a local CLIP index answers instantly and offline; month/year words narrow the range. AI captions and tags (when the judge has run) make results explainable.
6. **Taste** — every override becomes a labeled example: thresholds adapt (keep overriding blur rejects and the blur bar loosens), and recent corrections + your standing rules ("never auto-reject photos of my kids") steer future AI runs. Inspect it all under *Taste profile* — it's just `taste.json` in your library.
7. **Export** — copy picks to a folder with `.xmp` sidecars (rating, reject flag, keywords) that Lightroom, Capture One, and Bridge read on import — or write sidecars in place and point your editor at the library. RAW twins and Live Photo videos travel with their picks.
8. **Empty rejects** — the only destructive action in the app: explicit, two-step, shows count and size, and moves originals to the OS Trash (recoverable). The AI can never delete anything.

## Architecture

Three layers around one contract:

- **Electron app** (`app/`) — the library grid, review queues, loupe, search, and settings. The main process owns IPC, a streaming `keeper-asset://` protocol for media, and spawns everything else.
- **Engine scripts** (`app/scripts/`) — plain Node: the import pipeline (copy → derive → CV → group → embed), the LLM judge, search, export, and CLI tools for agents. A long-lived catalog service brokers SQLite access for the app.
- **Agent skills** (`.claude/skills/`) — `/cull-shoot`, `/find-media`, `/organize-library`: an agent harness (Claude/Cursor) works the same catalog through the same CLIs, and can actually look at your photos when judgment is needed.

**The contract:** the catalog (`.keeper/catalog.db`, SQLite) plus `taste.json`, both validated by the zod schemas in `packages/schema`. Every "smart" step has three tiers — deterministic local pass → single budgeted LLM call → agent skill — and the app uses the best one available.

```
keeper/
  app/
    src/                  Electron main + preload + React renderer
    scripts/              import, reprocess, judge-llm, export,
                          query, verdict, catalog-service, llm
                          + lib/ (catalog, media, quality, phash,
                            grouping, embeddings, taste, xmp)
  packages/schema/        Shared zod contracts (assets, verdicts,
                          groups, taste, imports, judge I/O)
  .claude/skills/         cull-shoot, find-media, organize-library
  AGENTS.md               Agent operating manual
```

## Where your media lives

The library is **user data, never the repo**: `~/Pictures/Keeper` by default (change it in Settings; dev override `KEEPER_LIBRARY_DIR`).

```
~/Pictures/Keeper/
  library/2026/2026-07-04/   your originals, immutable, date-sorted
  .keeper/                   catalog.db, thumbs, previews, models
  taste.json                 your learned culling profile
```

## AI configuration

The judge and search enrichment use the Vercel AI SDK behind a provider-agnostic layer (`app/scripts/llm.mjs`). Add a key in **Settings → AI**, or copy `app/.env.local.example` to `app/.env.local`:

```bash
OPENAI_API_KEY=sk-...
```

Escape hatch — rotate models/providers with no code change:

```bash
KEEPER_LLM_PROVIDER=openai            # openai | anthropic | openai-compatible
KEEPER_LLM_MODEL=gpt-5.5
KEEPER_LLM_BASE_URL=                  # e.g. http://localhost:11434/v1 for a local model
KEEPER_LLM_API_KEY=                   # generic; overrides the provider-specific key
```

Env vars always win over Settings (the UI shows locked fields).

### What leaves your machine

With no key configured: **nothing**. With a key: only downscaled thumbnails of the borderline items the judge analyzes (capped by *AI budget per run*), plus your standing rules and recent corrections as text. Originals, previews, embeddings, and quality metrics never leave your machine. The CLIP search model (~100 MB) downloads once into `.keeper/models/` and runs offline thereafter.

## RAW / HEIC / video notes

- RAW support in v1 means metadata + the embedded JPEG preview (fast, no demosaic); the RAW file itself is treated as the sidecar of its JPEG twin when both exist, and always travels with exports.
- HEIC decodes via `sips` on macOS (ffmpeg fallback elsewhere); Live Photos (HEIC+MOV) are paired into one logical photo.
- Videos are first-class in the pipeline: posters, scrub strips, junk detection (sub-second misfires, screen recordings), embedding of the poster frame for search, and playback in the loupe.

## Develop

```bash
npm install        # workspaces (Node >= 22.13 required — node:sqlite)
npm run dev        # launch the Electron app (electron-vite)
npm run typecheck  # type-check all workspaces
npm test           # vitest (schema, pipeline libs, catalog, renderer store)
npm run build      # production build
```

Engine scripts run standalone too — see `AGENTS.md` for the CLI surface (`import.mjs`, `query.mjs`, `verdict.mjs`, …).

## Status

V1. The full loop — import → auto-cull → AI review → human review → taste learning → search → export/XMP → trash-with-consent — is implemented, with the AI tier optional and budgeted, and offline deterministic behavior as the baseline.
