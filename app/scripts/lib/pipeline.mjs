// The derivation pipeline stages shared by import.mjs (fresh imports) and
// reprocess.mjs (resume / re-run). Each stage is checkpointed per asset in
// stages_json, so a crash or quit resumes where it left off.
import fs from "node:fs";
import path from "node:path";
import { libraryRoot, previewsDir, safeJoin, thumbsDir } from "./paths.mjs";
import {
  ensureDecodableStill,
  extractGray,
  makePoster,
  makeScrubStrip,
  makeThumb,
  makeTmpDir,
} from "./media.mjs";
import { cvVerdict, exposureStats, laplacianVariance } from "./quality.mjs";
import { clusterBursts, pairSiblings, pickBest } from "./grouping.mjs";
import { downsampleGray, phash } from "./phash.mjs";
import { embedImage, EMBED_MODEL_ID } from "./embeddings.mjs";
import { readTaste, tunedThresholds } from "./taste.mjs";

/** Run tasks over items with bounded concurrency; onDone fires per item. */
export async function pool(items, worker, { concurrency = 4, onDone } = {}) {
  const queue = [...items];
  let done = 0;
  const errors = [];
  const runners = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      try {
        await worker(item);
      } catch (err) {
        errors.push({ item, error: err });
        console.error(`ERROR ${err?.message ?? err}`);
      }
      done++;
      onDone?.(done);
    }
  });
  await Promise.all(runners);
  return errors;
}

function absOriginal(home, asset) {
  return safeJoin(home, asset.relPath);
}

/**
 * Stage: derive — thumbs for photos, poster + scrub strip for videos.
 * Derivatives land in .keeper/{thumbs,previews}/<id>.jpg.
 */
export async function stageDerive(catalog, assets, { onProgress } = {}) {
  const home = catalog.home;
  const tmpDir = makeTmpDir("keeper-derive-");
  fs.mkdirSync(thumbsDir(home), { recursive: true });
  fs.mkdirSync(previewsDir(home), { recursive: true });

  await pool(
    assets,
    async (asset) => {
      const src = absOriginal(home, asset);
      if (!fs.existsSync(src)) {
        catalog.patchAsset(asset.id, { offline: true });
        return;
      }
      if (asset.mediaType === "photo") {
        const decodable = await ensureDecodableStill(src, asset.format, tmpDir);
        if (!decodable) throw new Error(`cannot decode ${asset.fileName}`);
        const thumbAbs = path.join(thumbsDir(home), `${asset.id}.jpg`);
        await makeThumb(decodable, thumbAbs, 512);
        const previewAbs = path.join(previewsDir(home), `${asset.id}.jpg`);
        await makeThumb(decodable, previewAbs, 2048);
        catalog.patchAsset(asset.id, {
          thumbRel: path.relative(home, thumbAbs),
          previewRel: path.relative(home, previewAbs),
        });
      } else {
        const posterAbs = path.join(thumbsDir(home), `${asset.id}.jpg`);
        await makePoster(src, posterAbs, asset.durationSec);
        const scrubAbs = path.join(previewsDir(home), `${asset.id}.scrub.jpg`);
        const scrub = await makeScrubStrip(src, scrubAbs, asset.durationSec);
        catalog.patchAsset(asset.id, {
          thumbRel: path.relative(home, posterAbs),
          posterRel: path.relative(home, posterAbs),
          ...(scrub ? { scrubRel: path.relative(home, scrub) } : {}),
        });
      }
      catalog.markStage(asset.id, "derive");
    },
    { concurrency: 4, onDone: (n) => onProgress?.(n / assets.length) },
  );

  fs.rmSync(tmpDir, { recursive: true, force: true });
}

/**
 * Stage: cv — grayscale metrics + pHash from the thumb, then the
 * deterministic verdict using taste-tuned thresholds.
 * Returns { hashes: Map<assetId, BigInt> } for the grouping stage.
 */
export async function stageCv(catalog, assets, { onProgress } = {}) {
  const home = catalog.home;
  const thresholds = tunedThresholds(readTaste(home));
  const hashes = new Map();

  await pool(
    assets,
    async (asset) => {
      const fresh = catalog.getAsset(asset.id);
      if (!fresh?.thumbRel) return;
      const thumbAbs = safeJoin(home, fresh.thumbRel);
      if (!fs.existsSync(thumbAbs)) return;

      const gray = await extractGray(thumbAbs, 128);
      const quality = {
        blurScore: Math.round(laplacianVariance(gray, 128, 128) * 100) / 100,
        ...exposureStats(gray),
      };
      hashes.set(asset.id, phash(downsampleGray(gray, 128, 32)));

      const ai = cvVerdict(
        {
          quality,
          mediaType: fresh.mediaType,
          durationSec: fresh.durationSec,
          format: fresh.format,
          exif: fresh.exif,
          fileName: fresh.fileName,
          byteSize: fresh.byteSize,
        },
        thresholds,
      );
      catalog.patchAsset(asset.id, { quality });
      catalog.setAiVerdict(asset.id, ai);
      catalog.markStage(asset.id, "cv");
    },
    { concurrency: 4, onDone: (n) => onProgress?.(n / assets.length) },
  );

  return { hashes };
}

/**
 * Stage: group — pair RAW+JPEG / Live Photos, then cluster bursts and pick a
 * best frame per group. Non-picks get a "duplicate-worse" review suggestion
 * pointing at the pick (never a sure reject — bursts go to the needs-eye queue).
 */
export function stageGroup(catalog, assets, hashes) {
  const fresh = catalog.getAssets(assets.map((a) => a.id));

  const pairPatches = pairSiblings(
    fresh.map((a) => ({
      id: a.id,
      fileName: a.fileName,
      format: a.format,
      mediaType: a.mediaType,
      contentId: a.exif.contentId,
      dirRel: path.dirname(a.relPath),
    })),
  );
  for (const patch of pairPatches) {
    catalog.setPairing(patch.id, patch.pairRole, patch.pairPrimaryId);
  }
  const hidden = new Set(pairPatches.map((p) => p.id));

  const photos = fresh.filter((a) => a.mediaType === "photo" && !hidden.has(a.id));
  const clusters = clusterBursts(
    photos.map((a) => ({ id: a.id, capturedAt: a.capturedAt, hash: hashes.get(a.id) ?? null })),
  );

  for (const cluster of clusters) {
    const members = catalog.getAssets(cluster.assetIds);
    const bestId = pickBest(members);
    const groupId = `grp-${cluster.assetIds[0]}`;
    catalog.upsertGroup({
      id: groupId,
      kind: cluster.kind,
      assetIds: cluster.assetIds,
      bestPickId: bestId,
      pickSource: "cv",
    });
    for (const member of members) {
      if (member.id === bestId) {
        const ai = member.ai ?? { suggestion: "keep", confidence: 0.6, reasons: [], source: "cv" };
        catalog.setAiVerdict(member.id, {
          ...ai,
          suggestion: ai.suggestion === "reject" ? ai.suggestion : "keep",
          reasons: [{ code: "sharpest-of-burst" }, ...ai.reasons.slice(0, 4)],
        });
      } else if (member.ai?.suggestion !== "reject") {
        catalog.setAiVerdict(member.id, {
          suggestion: "reject",
          confidence: 0.7,
          reasons: [
            { code: "duplicate-worse", detail: "burst frame", refAssetId: bestId },
            ...(member.ai?.reasons.slice(0, 3) ?? []),
          ],
          source: "cv",
          at: new Date().toISOString(),
        });
      }
    }
  }

  for (const asset of fresh) catalog.markStage(asset.id, "group");
  return { groups: clusters.length, paired: pairPatches.length };
}

/**
 * Stage: embed — CLIP vectors from thumbs/posters. Soft-fails when the model
 * can't load (offline, first run without network): search then degrades to
 * metadata matching until reprocess runs.
 */
export async function stageEmbed(catalog, assets, { onProgress } = {}) {
  const home = catalog.home;
  let failed = false;

  // Probe the model once; if it can't load, skip the stage quietly.
  try {
    const probe = assets.find((a) => catalog.getAsset(a.id)?.thumbRel);
    if (!probe) return { embedded: 0, skipped: assets.length };
    const rec = catalog.getAsset(probe.id);
    const vec = await embedImage(home, safeJoin(home, rec.thumbRel));
    catalog.setEmbedding(probe.id, vec, EMBED_MODEL_ID);
    catalog.markStage(probe.id, "embed");
  } catch (err) {
    console.error(`ERROR embed model unavailable: ${err?.message ?? err}`);
    return { embedded: 0, skipped: assets.length };
  }

  let embedded = 1;
  await pool(
    assets,
    async (asset) => {
      const fresh = catalog.getAsset(asset.id);
      if (!fresh?.thumbRel || fresh.stages.embed) return;
      try {
        const vec = await embedImage(home, safeJoin(home, fresh.thumbRel));
        catalog.setEmbedding(asset.id, vec, EMBED_MODEL_ID);
        catalog.markStage(asset.id, "embed");
        embedded++;
      } catch (err) {
        failed = true;
        throw err;
      }
    },
    { concurrency: 1, onDone: (n) => onProgress?.(n / assets.length) },
  );
  return { embedded, skipped: failed ? assets.length - embedded : 0 };
}
