// Export selects out of the library — the handoff to Lightroom, Capture One,
// Aperture, or a plain folder.
//
//   node app/scripts/export.mjs --dest <dir> [--ids a,b,c | --picks] [--xmp]
//                               [--in-place-xmp] [--library <home>]
//
// Copies originals (plus RAW siblings and Live Photo videos), optionally
// writing .xmp sidecars with ratings/flags/keywords next to the copies.
// --in-place-xmp instead writes sidecars beside the originals inside the
// library (for apps pointed straight at the library folder).
import fs from "node:fs";
import path from "node:path";
import { openCatalog } from "./lib/catalog.mjs";
import { ensureLayout, resolveHome, safeJoin } from "./lib/paths.mjs";
import { buildXmp, sidecarPath } from "./lib/xmp.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name) => process.argv.includes(`--${name}`);

const phase = (name) => console.log(`PHASE ${name}`);
const progress = (pct) => console.log(`PROGRESS ${Math.round(pct)}`);

function siblingsOf(catalog, primary) {
  return catalog.listAssets({ includePaired: true, pairPrimaryId: primary.id, limit: 100 });
}

async function main() {
  const home = ensureLayout(resolveHome(arg("library")));
  const catalog = openCatalog(home, { stampOnWrite: false });
  const inPlace = has("in-place-xmp");
  const writeXmpSidecars = has("xmp") || inPlace;
  const dest = arg("dest");
  if (!inPlace && !dest) throw new Error("missing --dest");

  try {
    const ids = arg("ids")?.split(",").filter(Boolean);
    const assets = ids ? catalog.getAssets(ids) : catalog.listAssets({ flag: "pick", limit: 100_000 });
    if (assets.length === 0) {
      console.log(`DONE ${JSON.stringify({ exported: 0, sidecars: 0 })}`);
      return;
    }

    phase(inPlace ? `writing sidecars for ${assets.length}` : `exporting ${assets.length} selects`);
    if (!inPlace) fs.mkdirSync(dest, { recursive: true });

    let exported = 0;
    let sidecars = 0;

    for (const [index, asset] of assets.entries()) {
      const files = [asset, ...siblingsOf(catalog, asset)];
      for (const file of files) {
        const src = safeJoin(home, file.relPath);
        if (!fs.existsSync(src)) {
          console.error(`ERROR original offline: ${file.relPath}`);
          continue;
        }
        if (inPlace) {
          if (file.id === asset.id && writeXmpSidecars) {
            fs.writeFileSync(
              sidecarPath(src),
              buildXmp({
                rating: asset.user.rating,
                flag: asset.user.flag,
                tags: asset.tags,
                caption: asset.caption,
              }),
            );
            sidecars++;
          }
        } else {
          const out = path.join(dest, file.fileName);
          fs.copyFileSync(src, out);
          exported++;
          if (file.id === asset.id && writeXmpSidecars) {
            fs.writeFileSync(
              sidecarPath(out),
              buildXmp({
                rating: asset.user.rating,
                flag: asset.user.flag,
                tags: asset.tags,
                caption: asset.caption,
              }),
            );
            sidecars++;
          }
        }
      }
      progress(((index + 1) / assets.length) * 100);
    }

    console.log(`DONE ${JSON.stringify({ exported, sidecars, dest: inPlace ? home : dest })}`);
  } finally {
    catalog.close();
  }
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack ?? err}`);
  process.exit(1);
});
