// Resume/re-run pipeline stages for assets that missed them (interrupted
// import, model that wasn't downloaded yet, threshold changes).
//
//   node app/scripts/reprocess.mjs [--library <home>] [--stage derive|cv|group|embed|all]
import { openCatalog } from "./lib/catalog.mjs";
import { closeMetadataReader } from "./lib/media.mjs";
import { ensureLayout, resolveHome } from "./lib/paths.mjs";
import { stageCv, stageDerive, stageEmbed, stageGroup } from "./lib/pipeline.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const phase = (name) => console.log(`PHASE ${name}`);
const progress = (pct) => console.log(`PROGRESS ${Math.round(pct)}`);
const span = (from, to) => (frac) => progress(from + (to - from) * Math.min(1, Math.max(0, frac)));

async function main() {
  const home = ensureLayout(resolveHome(arg("library")));
  const which = arg("stage") ?? "all";
  const catalog = openCatalog(home, { stampOnWrite: true });
  const summary = {};

  try {
    if (which === "derive" || which === "all") {
      const missing = catalog.assetsMissingStage("derive");
      phase(`deriving ${missing.length}`);
      await stageDerive(catalog, missing, { onProgress: span(0, 30) });
      summary.derived = missing.length;
    }

    let hashes = new Map();
    if (which === "cv" || which === "group" || which === "all") {
      const missing = catalog.assetsMissingStage("cv");
      phase(`measuring ${missing.length}`);
      ({ hashes } = await stageCv(catalog, missing, { onProgress: span(30, 60) }));
      summary.measured = missing.length;
    }

    if (which === "group" || which === "all") {
      const missing = catalog.assetsMissingStage("group");
      phase(`grouping ${missing.length}`);
      if (missing.length > 0) {
        const stats = stageGroup(catalog, missing, hashes);
        summary.groups = stats.groups;
      }
      span(60, 70)(1);
    }

    if (which === "embed" || which === "all") {
      const missing = catalog.assetsMissingStage("embed");
      phase(`indexing ${missing.length}`);
      const stats = await stageEmbed(catalog, missing, { onProgress: span(70, 100) });
      summary.embedded = stats.embedded;
      summary.embedSkipped = stats.skipped;
    }

    progress(100);
    console.log(`DONE ${JSON.stringify(summary)}`);
  } finally {
    await closeMetadataReader();
    catalog.close();
  }
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack ?? err}`);
  process.exit(1);
});
