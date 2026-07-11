// Agent/CLI verdict setter — the write half of query.mjs. Records taste
// signals exactly like the app does (contradictions become exemplars).
//
//   node app/scripts/verdict.mjs --ids a,b,c --flag pick|reject|unrated [--rating 0..5]
//   node app/scripts/verdict.mjs --group <groupId> --best <assetId>
// All accept --library <home>.
import { openCatalog } from "./lib/catalog.mjs";
import { ensureLayout, resolveHome } from "./lib/paths.mjs";
import { readTaste, recordVerdict, writeTaste } from "./lib/taste.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const home = ensureLayout(resolveHome(arg("library")));
  const catalog = openCatalog(home, { stampOnWrite: true });

  try {
    if (arg("group") && arg("best")) {
      catalog.setGroupPick(arg("group"), arg("best"), "user");
      console.log(JSON.stringify({ ok: true, group: arg("group"), best: arg("best") }));
      return;
    }

    const ids = (arg("ids") ?? "").split(",").filter(Boolean);
    if (ids.length === 0) throw new Error("missing --ids or --group/--best");
    const flag = arg("flag");
    const rating = arg("rating") !== undefined ? Number(arg("rating")) : undefined;
    if (!flag && rating === undefined) throw new Error("missing --flag or --rating");
    if (flag && !["pick", "reject", "unrated"].includes(flag)) throw new Error(`bad flag: ${flag}`);
    if (rating !== undefined && !(Number.isInteger(rating) && rating >= 0 && rating <= 5)) {
      throw new Error(`bad rating: ${arg("rating")}`);
    }

    const before = catalog.setUserVerdict(ids, { flag, rating });
    if (flag) {
      let taste = readTaste(home);
      let changed = false;
      for (const prior of before) {
        if (prior.ai && prior.user.flag === "unrated") {
          taste = recordVerdict(taste, { asset: prior, userFlag: flag });
          changed = true;
        }
      }
      if (changed) writeTaste(home, taste);
    }
    console.log(JSON.stringify({ ok: true, updated: ids.length }));
  } finally {
    catalog.close();
  }
}

main().catch((err) => {
  console.error(`ERROR ${err?.stack ?? err}`);
  process.exit(1);
});
