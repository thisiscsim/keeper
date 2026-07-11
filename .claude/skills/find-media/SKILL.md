---
name: find-media
description: Find photos/videos in the Keeper library from a vague natural-language memory ("the ocean at sunset", "the kids at that dinner in June") using semantic search, then visually verify the hits. Use when the user is looking for specific media they half-remember.
---

# Find media

The library ships a local CLIP index — semantic search runs offline and returns ranked candidates. Your job is to turn a fuzzy memory into verified results.

## Workflow

1. **Search** (scripts in `app/scripts/`, `--library <home>` if non-default):

   ```bash
   node app/scripts/query.mjs --search "ocean at sunset" --limit 24
   ```

   Results are ranked by similarity and include `thumbPath` + `originalPath`. If it errors with "no embeddings yet", run `node app/scripts/reprocess.mjs --stage embed` first (downloads the model on first run).

2. **Vary the phrasing.** CLIP responds to concrete visual language. Try 2–3 reformulations: "waves at golden hour", "beach silhouette dusk". Merge candidates.

3. **Verify visually.** Read the top thumbnails and keep only genuine matches — semantic scores are suggestive, not proof. The user asked for a memory, not a similarity list.

4. **Narrow by metadata when the user gave constraints.** Capture dates are in each record (`capturedAt`); "second week of the trip" means filtering the date range yourself. `query.mjs --asset <id>` returns the full record.

5. **Present**: absolute original paths + one-line why-it-matches each. If the user wants them exported, set `--flag pick` via `verdict.mjs` and point them at Export in the app (or run `node app/scripts/export.mjs --dest <folder> --ids <ids> --xmp`).
