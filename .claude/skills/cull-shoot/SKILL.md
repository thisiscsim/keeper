---
name: cull-shoot
description: Import a folder of photos/videos into the Keeper library (or work on what's already there) and cull it — confirm the pipeline's verdicts, visually review the borderline items, pick the best frame of each burst, and leave a clean picks/rejects split. Use when the user wants a shoot, trip, or SD-card dump culled.
---

# Cull a shoot

You are culling for a real person: the goal is that their **picks are postable/editable keepers** and their **rejects are safely discardable junk**. You can look at images directly — use that superpower where the local heuristics can't decide.

## Ground rules

- The library home is `~/Pictures/Keeper` unless `KEEPER_LIBRARY_DIR` is set. Pass `--library <home>` to every script if the user gave a custom location.
- **Never delete or move media files.** Verdicts are flags; the user empties rejects themselves in the app.
- Every CLI below prints JSON. Scripts live in `app/scripts/`.

## Workflow

1. **Import** (skip if the media is already in the library):

   ```bash
   node app/scripts/import.mjs --source /path/to/dump
   ```

   This copies (checksummed, deduped), extracts metadata, generates thumbnails, measures quality, suggests verdicts, groups bursts, and builds the search index. Resume an interrupted run with `node app/scripts/reprocess.mjs`.

2. **Read the queues**:

   ```bash
   node app/scripts/query.mjs --review --limit 100
   ```

   Three buckets: `sure-reject` (high-confidence junk), `sure-keep`, `needs-eye` (borderline). Each item includes `thumbPath` — an absolute path to its thumbnail.

3. **Spot-check the sure queues.** View a handful of `sure-reject` thumbnails with the Read tool. If they are genuinely junk (blur, black frames, misfires), confirm the whole queue:

   ```bash
   node app/scripts/verdict.mjs --ids <comma-separated-ids> --flag reject
   ```

   Same for `sure-keep` with `--flag pick`. If a spot-check reveals a wrong call, DO NOT bulk-confirm — review that queue item by item.

4. **Review `needs-eye` visually.** Read each thumbnail. Judge like a photo editor: moment > technical perfection. A soft photo of a real moment (laughter, a kiss, the peak of action) is a **pick**; a tack-sharp photo of nothing is not automatically one. Set verdicts in batches.

5. **Resolve bursts.** Items sharing a `groupId` are one moment. View all frames of a group, pick the best (eyes open, expression, framing), then:

   ```bash
   node app/scripts/verdict.mjs --group <groupId> --best <assetId>
   node app/scripts/verdict.mjs --ids <bestId> --flag pick
   node app/scripts/verdict.mjs --ids <otherIds> --flag reject
   ```

6. **Report.** Summarize honestly: counts per verdict, anything you were unsure about (leave those unrated rather than guessing), and any pattern worth adding as a taste rule.

## Taste

Your verdicts feed `taste.json` exactly like the user's own (contradictions of AI suggestions become learning exemplars). Read the profile first if it exists — `<home>/taste.json` — and respect its `rules`.
