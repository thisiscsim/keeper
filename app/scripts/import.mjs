// Import media into the Keeper library.
//
//   node app/scripts/import.mjs --source <dir-or-file> [--source ...] [--library <home>]
//
// Stages (each checkpointed so a crash resumes via reprocess.mjs):
//   scan -> copy (hash, dedupe, verify) -> derive (thumbs/posters) ->
//   cv (quality + verdict) -> group (pairs + bursts) -> embed (CLIP)
//
// Emits the PHASE / PROGRESS / DONE line protocol the app parses; errors for
// individual files go to stderr and the import continues.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { openCatalog } from "./lib/catalog.mjs";
import { classifyFile, closeMetadataReader, probeDurationSec, readMetadata } from "./lib/media.mjs";
import { ensureLayout, libraryRoot, resolveHome } from "./lib/paths.mjs";
import { pool, stageCv, stageDerive, stageEmbed, stageGroup } from "./lib/pipeline.mjs";

function args(name) {
  const out = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === `--${name}` && process.argv[i + 1]) out.push(process.argv[i + 1]);
  }
  return out;
}

const progress = (pct) => console.log(`PROGRESS ${Math.round(pct)}`);
const phase = (name) => console.log(`PHASE ${name}`);

/** Range-mapped progress: stage share of the overall bar. */
const span = (from, to) => (frac) => progress(from + (to - from) * Math.min(1, Math.max(0, frac)));

function walk(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile() && classifyFile(entry.name)) out.push(full);
  }
  return out;
}

function sha256(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(file);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function dayFolder(capturedAt, mtime) {
  const iso = capturedAt ?? new Date(mtime).toISOString();
  const day = iso.slice(0, 10);
  const year = day.slice(0, 4);
  return path.join(year, day);
}

/** Copy with a unique name if a different file already sits at the target. */
function uniqueDest(destDir, fileName) {
  let candidate = path.join(destDir, fileName);
  if (!fs.existsSync(candidate)) return candidate;
  const dot = fileName.lastIndexOf(".");
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName;
  const ext = dot > 0 ? fileName.slice(dot) : "";
  for (let i = 2; i < 10_000; i++) {
    candidate = path.join(destDir, `${stem}-${i}${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot find a unique name for ${fileName}`);
}

async function main() {
  const sources = args("source");
  if (sources.length === 0) throw new Error("missing --source");
  const home = ensureLayout(resolveHome(args("library")[0]));
  const catalog = openCatalog(home, { stampOnWrite: true });

  const importId = `imp-${Date.now().toString(36)}`;
  const manifest = catalog.saveImport({
    id: importId,
    sources: sources.slice(0, 64),
    startedAt: new Date().toISOString(),
    stage: "scan",
    status: "running",
    counts: {},
  });

  const saveManifest = (patch) => {
    Object.assign(manifest, patch, { counts: { ...manifest.counts, ...(patch.counts ?? {}) } });
    catalog.saveImport(manifest);
  };

  try {
    // -- scan ---------------------------------------------------------------
    phase("scanning");
    const files = [];
    for (const source of sources) {
      const stat = fs.statSync(source, { throwIfNoEntry: false });
      if (!stat) continue;
      if (stat.isDirectory()) walk(source, files);
      else if (stat.isFile() && classifyFile(source)) files.push(source);
    }
    saveManifest({ stage: "copy", counts: { found: files.length } });
    span(0, 5)(1);
    if (files.length === 0) {
      saveManifest({ stage: "done", status: "done", finishedAt: new Date().toISOString() });
      console.log(`DONE ${JSON.stringify({ importId, found: 0, copied: 0, duplicates: 0, failed: 0 })}`);
      return;
    }

    // -- copy + metadata ----------------------------------------------------
    phase(`copying ${files.length} files`);
    const imported = [];
    let duplicates = 0;
    let failed = 0;
    const copyProgress = span(5, 40);

    await pool(
      files,
      async (source) => {
        const fileName = path.basename(source);
        const kind = classifyFile(fileName);
        const stat = fs.statSync(source);
        const contentHash = await sha256(source);
        if (catalog.findByHash(contentHash)) {
          duplicates++;
          return;
        }

        let meta;
        try {
          meta = await readMetadata(source);
        } catch {
          meta = { exif: {} };
        }
        if (kind.mediaType === "video" && meta.durationSec === undefined) {
          meta.durationSec = await probeDurationSec(source);
        }

        // No EXIF date -> fall back to file mtime so date bucketing and burst
        // clustering still work; dateSource records the weaker provenance.
        const capturedAt = meta.capturedAt ?? new Date(stat.mtimeMs).toISOString();

        const destDir = path.join(libraryRoot(home), dayFolder(meta.capturedAt, stat.mtimeMs));
        fs.mkdirSync(destDir, { recursive: true });
        const dest = uniqueDest(destDir, fileName);
        fs.copyFileSync(source, dest);
        const copiedStat = fs.statSync(dest);
        if (copiedStat.size !== stat.size) {
          fs.rmSync(dest, { force: true });
          throw new Error(`size mismatch copying ${fileName} (card removed mid-copy?)`);
        }

        const asset = {
          id: contentHash.slice(0, 16),
          relPath: path.relative(home, dest),
          fileName: path.basename(dest),
          byteSize: copiedStat.size,
          contentHash,
          mediaType: kind.mediaType,
          format: kind.format,
          width: meta.width,
          height: meta.height,
          durationSec: meta.durationSec,
          capturedAt,
          dateSource: meta.capturedAt ? "exif" : "mtime",
          exif: meta.exif ?? {},
          importId,
          importedAt: new Date().toISOString(),
          stages: { copy: new Date().toISOString() },
        };
        catalog.upsertAsset(asset);
        imported.push(asset);
      },
      {
        concurrency: 3,
        onDone: (n) => {
          copyProgress(n / files.length);
          if (n % 25 === 0) saveManifest({ counts: { copied: imported.length, duplicates } });
        },
      },
    ).then((errors) => {
      failed = errors.length;
    });

    saveManifest({
      stage: "derive",
      counts: { copied: imported.length, duplicates, failed },
    });

    // -- derive -------------------------------------------------------------
    phase(`generating previews for ${imported.length} files`);
    await stageDerive(catalog, imported, { onProgress: span(40, 70) });

    // -- cv -----------------------------------------------------------------
    phase("measuring quality");
    saveManifest({ stage: "cv" });
    const { hashes } = await stageCv(catalog, imported, { onProgress: span(70, 84) });

    // -- group --------------------------------------------------------------
    phase("grouping bursts and pairs");
    saveManifest({ stage: "group" });
    const groupStats = stageGroup(catalog, imported, hashes);
    span(84, 88)(1);

    // -- embed --------------------------------------------------------------
    phase("indexing for search");
    saveManifest({ stage: "embed" });
    const embedStats = await stageEmbed(catalog, imported, { onProgress: span(88, 99) });

    saveManifest({ stage: "done", status: "done", finishedAt: new Date().toISOString() });
    progress(100);
    console.log(
      `DONE ${JSON.stringify({
        importId,
        found: files.length,
        copied: imported.length,
        duplicates,
        failed,
        groups: groupStats.groups,
        paired: groupStats.paired,
        embedded: embedStats.embedded,
      })}`,
    );
  } catch (err) {
    saveManifest({ status: "failed", error: String(err?.message ?? err) });
    throw err;
  } finally {
    await closeMetadataReader();
    catalog.close();
  }
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack ?? err}`);
  process.exit(1);
});
