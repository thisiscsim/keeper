// Agent/CLI window into the catalog. Prints JSON to stdout.
//
//   node app/scripts/query.mjs --counts
//   node app/scripts/query.mjs --search "ocean at sunset" [--limit 20]
//   node app/scripts/query.mjs --list unrated|pick|reject [--limit 50]
//   node app/scripts/query.mjs --review            (the three confidence queues)
//   node app/scripts/query.mjs --asset <id>        (full record incl. thumb path)
//   node app/scripts/query.mjs --imports
// All accept --library <home>.
import { reviewQueue } from "@keeper/schema";
import { openCatalog } from "./lib/catalog.mjs";
import { embedText, modelCached, rankBySimilarity } from "./lib/embeddings.mjs";
import { ensureLayout, resolveHome, safeJoin } from "./lib/paths.mjs";
import { readTaste } from "./lib/taste.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(`--${name}`);

function brief(home, asset) {
  return {
    id: asset.id,
    fileName: asset.fileName,
    mediaType: asset.mediaType,
    capturedAt: asset.capturedAt,
    flag: asset.user.flag,
    rating: asset.user.rating,
    ai: asset.ai ? { suggestion: asset.ai.suggestion, confidence: asset.ai.confidence, reasons: asset.ai.reasons.map((r) => r.code) } : null,
    groupId: asset.groupId,
    tags: asset.tags,
    caption: asset.caption,
    thumbPath: asset.thumbRel ? safeJoin(home, asset.thumbRel) : null,
    originalPath: safeJoin(home, asset.relPath),
  };
}

async function main() {
  const home = ensureLayout(resolveHome(arg("library")));
  const catalog = openCatalog(home, { stampOnWrite: false });
  const limit = Math.min(500, Number(arg("limit")) || 50);

  try {
    if (has("counts")) {
      console.log(JSON.stringify({ counts: catalog.countsSummary(), days: catalog.listDays().length }, null, 2));
      return;
    }

    if (has("imports")) {
      console.log(JSON.stringify(catalog.listImports(20), null, 2));
      return;
    }

    if (arg("asset")) {
      const asset = catalog.getAsset(arg("asset"));
      console.log(JSON.stringify(asset ? brief(home, asset) : null, null, 2));
      return;
    }

    if (arg("list")) {
      const flag = arg("list");
      const assets = catalog.listAssets({ flag, limit });
      console.log(JSON.stringify(assets.map((a) => brief(home, a)), null, 2));
      return;
    }

    if (has("review")) {
      const sure = readTaste(home).thresholds.sureConfidence;
      const unrated = catalog.listAssets({ flag: "unrated", hasAi: true, limit: 50_000 });
      const queues = { "sure-reject": [], "sure-keep": [], "needs-eye": [] };
      for (const asset of unrated) {
        const q = reviewQueue(asset, sure);
        if (q in queues && queues[q].length < limit) queues[q].push(brief(home, asset));
      }
      console.log(JSON.stringify(queues, null, 2));
      return;
    }

    if (arg("search")) {
      const query = arg("search");
      const matrix = catalog.allEmbeddings();
      if (matrix.length > 0 && modelCached(home)) {
        const vec = await embedText(home, query);
        const ranked = rankBySimilarity(vec, matrix, limit);
        const records = catalog.getAssets(ranked.map((r) => r.id));
        const byId = new Map(records.map((r) => [r.id, r]));
        console.log(
          JSON.stringify(
            ranked
              .filter((r) => byId.has(r.id))
              .map((r) => ({ score: Math.round(r.score * 1000) / 1000, ...brief(home, byId.get(r.id)) })),
            null,
            2,
          ),
        );
      } else {
        console.log(JSON.stringify({ error: "no embeddings yet — run reprocess.mjs --stage embed" }, null, 2));
      }
      return;
    }

    console.log(
      JSON.stringify(
        { usage: "--counts | --imports | --asset <id> | --list <flag> | --review | --search <query>" },
        null,
        2,
      ),
    );
  } finally {
    catalog.close();
  }
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack ?? err}`);
  process.exit(1);
});
