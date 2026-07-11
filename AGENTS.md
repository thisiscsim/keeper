# Keeper

AI-assisted culling for photos and videos. The user dumps an SD card / phone folder in; Keeper copies it into a local library, flags the junk with explainable verdicts, groups bursts, indexes everything for natural-language search, and learns the user's taste from every override. You (the agent) are the richest tier of that pipeline: you can see images, so you can judge what heuristics can't.

## How it works

1. **Import** — `import.mjs` copies files into `<home>/library/YYYY/YYYY-MM-DD/` (SHA-256 checksummed, deduped against the whole library), reads EXIF via exiftool, generates thumbnails/previews (RAW via embedded preview, HEIC via sips, videos get posters + scrub strips), measures quality (blur/exposure via ffmpeg-piped grayscale + pure-JS math), suggests verdicts, clusters bursts (pHash + capture time), pairs RAW+JPEG / Live Photos, and embeds everything with local CLIP for search.
2. **Review** — the Electron app shows three confidence queues (sure rejects / sure keeps / needs your eye) with reason chips and evidence; the user (or you) confirms or overrides. User verdicts are separate from AI suggestions; the AI never decides destructively.
3. **Learn** — every override of an AI suggestion becomes an exemplar in `taste.json` (+ threshold tuning); standing rules and recent corrections are injected into future LLM judgments.
4. **Search** — CLIP embeddings, fully local; the LLM judge adds captions/tags for borderline items when configured.
5. **Export** — picks copy out with `.xmp` sidecars (rating/flag/keywords) that Lightroom/Capture One/Bridge read natively; rejected originals are only ever moved to the OS trash after explicit user confirmation.

## The contract

- **Catalog**: `<home>/.keeper/catalog.db` (SQLite). All access goes through `app/scripts/lib/catalog.mjs`; every row is validated against the zod schemas in `packages/schema` on read and write. Never write the DB directly.
- **Taste**: `<home>/taste.json` (`TasteProfileSchema`) — thresholds, standing rules, exemplars, override stats.
- Library home: `KEEPER_LIBRARY_DIR` env, else `~/Pictures/Keeper`. CLI writes touch `<home>/.keeper/.stamp`, which live-refreshes the running app.

## Skills

- `/cull-shoot` — import + confirm/override verdicts + resolve bursts, visually.
- `/find-media` — semantic search + visual verification of a half-remembered shot.
- `/organize-library` — captions/tags/events, dedupe report, library health.

## CLI surface (`app/scripts/`)

`import.mjs` (full pipeline), `reprocess.mjs` (resume/re-run stages), `query.mjs` (counts / lists / review queues / semantic search — JSON out), `verdict.mjs` (set flags/ratings/group picks — records taste like the app), `judge-llm.mjs` (budgeted GPT-5.5 vision pass over borderline items), `export.mjs` (copy + XMP sidecars), `catalog-service.mjs` (the app's own DB broker — not for direct use).

## Scoped conventions

Area rules live in `.cursor/rules/` (IPC/main process, renderer design system, engine scripts, schema package, delivery workflow). They activate by file glob in Cursor; other agents should skim the relevant file before working in that area.

## Boundaries

- **Never delete, move, or rewrite media files.** Verdicts are flags. The only deletion path is the app's user-confirmed "empty rejects" (OS trash).
- Media stays local. The LLM judge sends downscaled thumbnails only, capped by an explicit budget; embeddings and quality metrics never leave the machine.
- Requires Node >= 22.13 (`node:sqlite`). Scripts are spawned with the system `node`.
- Don't write outside the library home except code changes you were explicitly asked to make.
