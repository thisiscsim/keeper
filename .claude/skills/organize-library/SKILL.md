---
name: organize-library
description: Organize and enrich the Keeper library — caption and tag media for better search, name events, surface duplicates across imports, and produce a library health report. Use when the user wants their library "organized", "tagged", or "cleaned up".
---

# Organize the library

Keeper's catalog stores tags and captions per asset; search and export both use them. You can look at thumbnails directly and write enrichment back through the CLIs (scripts in `app/scripts/`, add `--library <home>` for non-default locations).

## Workflow

1. **Assess**:

   ```bash
   node app/scripts/query.mjs --counts
   node app/scripts/query.mjs --imports
   ```

   Report totals, unrated backlog, and how much of the search index is built (run `reprocess.mjs` for anything missing).

2. **Enrich where it pays.** Captions/tags come from the LLM judge when configured:

   ```bash
   node app/scripts/judge-llm.mjs --budget 200
   ```

   It only spends budget on borderline/unjudged items and writes captions + lowercase tags. If the user wants deeper coverage, raise the budget explicitly — never silently.

3. **Name events.** List days (`query.mjs --counts` shows the day count; `--list unrated --limit …` etc. include `capturedAt`). Cluster consecutive days with media into events, read a few thumbnails per day, and propose names ("Kyoto — days 3–5"). Write them as tags on the day's assets via the catalog CLI if the user approves.

4. **Surface cross-import duplicates.** Exact duplicates are already blocked at import (content hash). Near-duplicates across sessions show up as high-similarity search hits — flag suspicious pairs for the user rather than auto-rejecting.

5. **Report.** What was tagged, what events were named, what the user should review. Nothing in this skill deletes or moves media.
