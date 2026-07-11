// Long-lived catalog service. The Electron main process spawns one of these
// per library and speaks line-delimited JSON over stdio:
//
//   -> {"id":1,"method":"librarySummary","params":{}}
//   <- {"id":1,"ok":true,"result":{...}}
//
// Why a child process: the catalog driver (node:sqlite) runs against the
// system Node ABI, keeping the Electron main process free of native/module
// version concerns, and heavy queries stay off the UI event loop. Search's
// text-embedding model is lazy-loaded here on first use.
import fs from "node:fs";
import readline from "node:readline";
import { reviewQueue } from "@keeper/schema";
import { openCatalog } from "./lib/catalog.mjs";
import { embedText, modelCached, rankBySimilarity } from "./lib/embeddings.mjs";
import { ensureLayout, resolveHome, safeJoin } from "./lib/paths.mjs";
import { readTaste, recordVerdict, writeTaste } from "./lib/taste.mjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const home = ensureLayout(resolveHome(arg("library")));
// The app's own service must not stamp, or the stamp-watcher would loop.
const catalog = openCatalog(home, { stampOnWrite: false });

let embeddingMatrix = null;
function embeddings() {
  if (!embeddingMatrix) embeddingMatrix = catalog.allEmbeddings();
  return embeddingMatrix;
}
function invalidateEmbeddings() {
  embeddingMatrix = null;
}

/** Naive date-range extraction so "june photos" narrows without an LLM. */
function parseDateHints(query) {
  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
  ];
  const lower = query.toLowerCase();
  const yearMatch = lower.match(/\b(20\d{2})\b/);
  const monthIdx = months.findIndex((m) => lower.includes(m));
  if (monthIdx < 0 && !yearMatch) return {};
  const year = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
  if (monthIdx >= 0) {
    const from = `${year}-${String(monthIdx + 1).padStart(2, "0")}-01`;
    const to = `${year}-${String(monthIdx + 1).padStart(2, "0")}-31`;
    return { from, to };
  }
  return { from: `${year}-01-01`, to: `${year}-12-31` };
}

function metadataSearch(query, limit = 120) {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 2);
  if (terms.length === 0) return [];
  const all = catalog.listAssets({ limit: 50_000 });
  const results = [];
  for (const asset of all) {
    const haystack = [asset.fileName, asset.caption ?? "", ...asset.tags, asset.exif.make ?? "", asset.exif.model ?? ""]
      .join(" ")
      .toLowerCase();
    const matched = terms.filter((t) => haystack.includes(t));
    if (matched.length > 0) {
      results.push({ assetId: asset.id, score: Math.min(1, matched.length / terms.length), matched });
    }
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

const methods = {
  ping: () => "pong",

  librarySummary() {
    return {
      home,
      counts: catalog.countsSummary(),
      imports: catalog.listImports(10),
      embeddings: catalog.embeddingCount(),
      modelCached: modelCached(home),
    };
  },

  listDays: (p) => catalog.listDays(p ?? {}),

  listAssets: (p) => catalog.listAssets(p ?? {}),

  getAssets: (p) => catalog.getAssets(p.ids ?? []),

  getGroup: (p) => catalog.getGroup(p.id),

  /**
   * Set a user verdict on assets. Also folds the decision into taste.json —
   * contradictions become exemplars, confirmations bump stats. Returns the
   * prior records so the renderer can build undo entries.
   */
  setVerdict(p) {
    const ids = (p.ids ?? []).slice(0, 5000);
    const before = catalog.setUserVerdict(ids, { flag: p.flag, rating: p.rating });
    if (p.flag && p.recordTaste !== false) {
      let taste = readTaste(home);
      let changed = false;
      for (const prior of before) {
        if (prior.ai && prior.user.flag === "unrated") {
          taste = recordVerdict(taste, { asset: prior, userFlag: p.flag });
          changed = true;
        }
      }
      if (changed) writeTaste(home, taste);
    }
    return { before: before.map((b) => ({ id: b.id, user: b.user })) };
  },

  /** Direct restore for undo — no taste side effects. */
  restoreVerdicts(p) {
    for (const entry of (p.entries ?? []).slice(0, 5000)) {
      catalog.setUserVerdict([entry.id], { flag: entry.user.flag, rating: entry.user.rating });
    }
    return { restored: (p.entries ?? []).length };
  },

  setGroupPick(p) {
    catalog.setGroupPick(p.groupId, p.assetId, "user");
    return { ok: true };
  },

  reviewQueues(p) {
    const sure = p?.sureConfidence ?? readTaste(home).thresholds.sureConfidence;
    const unrated = catalog.listAssets({ flag: "unrated", hasAi: true, limit: 50_000 });
    const queues = { "sure-reject": [], "sure-keep": [], "needs-eye": [] };
    for (const asset of unrated) {
      const queue = reviewQueue(asset, sure);
      if (queue in queues) queues[queue].push(asset);
    }
    return queues;
  },

  async search(p) {
    const query = String(p.query ?? "").slice(0, 500);
    const filters = { ...parseDateHints(query), ...(p.filters ?? {}) };
    const matrix = embeddings();
    if (matrix.length > 0 && modelCached(home)) {
      try {
        const queryVec = await embedText(home, query);
        let ranked = rankBySimilarity(queryVec, matrix, p.limit ?? 80);
        if (filters.from || filters.to || filters.mediaType) {
          const records = catalog.getAssets(ranked.map((r) => r.id));
          const byId = new Map(records.map((r) => [r.id, r]));
          ranked = ranked.filter((r) => {
            const a = byId.get(r.id);
            if (!a) return false;
            const day = (a.capturedAt ?? a.importedAt ?? "").slice(0, 10);
            if (filters.from && day && day < filters.from) return false;
            if (filters.to && day && day > filters.to) return false;
            if (filters.mediaType && a.mediaType !== filters.mediaType) return false;
            return true;
          });
        }
        return {
          query,
          mode: "semantic",
          results: ranked.map((r) => ({ assetId: r.id, score: Math.max(-1, Math.min(1, r.score)), matched: ["semantic"] })),
        };
      } catch (err) {
        console.error(`ERROR semantic search failed: ${err?.message ?? err}`);
      }
    }
    return { query, mode: "metadata", results: metadataSearch(query, p.limit ?? 80) };
  },

  refreshEmbeddings() {
    invalidateEmbeddings();
    return { count: embeddings().length };
  },

  taste() {
    return readTaste(home);
  },

  addTasteRule(p) {
    const taste = readTaste(home);
    const rule = {
      id: `rule-${Date.now().toString(36)}`,
      text: String(p.text ?? "").slice(0, 500),
      createdAt: new Date().toISOString(),
    };
    taste.rules = [...taste.rules.slice(-63), rule];
    writeTaste(home, taste);
    return rule;
  },

  removeTasteRule(p) {
    const taste = readTaste(home);
    taste.rules = taste.rules.filter((r) => r.id !== p.id);
    writeTaste(home, taste);
    return { ok: true };
  },

  /** Rejected assets + total size — the "empty rejects" confirmation payload. */
  rejectsSummary() {
    const rejects = catalog.listAssets({ flag: "reject", limit: 100_000 });
    return {
      count: rejects.length,
      bytes: rejects.reduce((sum, a) => sum + a.byteSize, 0),
      ids: rejects.map((a) => a.id),
    };
  },

  /** Paths for assets about to be trashed (main does the actual shell.trashItem). */
  assetPaths(p) {
    const out = [];
    for (const asset of catalog.getAssets((p.ids ?? []).slice(0, 100_000))) {
      out.push({ id: asset.id, relPath: asset.relPath });
      for (const sibling of catalog.listAssets({ includePaired: true, pairPrimaryId: asset.id, limit: 10 })) {
        out.push({ id: sibling.id, relPath: sibling.relPath });
      }
    }
    return out;
  },

  /** Remove catalog rows + regenerable derived files after originals were trashed. */
  forgetAssets(p) {
    const ids = (p.ids ?? []).slice(0, 100_000);
    for (const id of ids) {
      const members = [
        catalog.getAsset(id),
        ...catalog.listAssets({ includePaired: true, pairPrimaryId: id, limit: 10 }),
      ].filter(Boolean);
      for (const member of members) {
        for (const rel of [member.thumbRel, member.previewRel, member.posterRel, member.scrubRel]) {
          if (!rel) continue;
          try {
            fs.rmSync(safeJoin(home, rel), { force: true });
          } catch {
            // derived files are regenerable; ignore
          }
        }
      }
      catalog.db.prepare("DELETE FROM assets WHERE id = ? OR pair_primary_id = ?").run(id, id);
    }
    invalidateEmbeddings();
    return { removed: ids.length };
  },
};

const rl = readline.createInterface({ input: process.stdin, terminal: false });
rl.on("line", async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  const { id, method, params } = msg;
  const fn = methods[method];
  if (!fn) {
    process.stdout.write(`${JSON.stringify({ id, ok: false, error: `unknown method ${method}` })}\n`);
    return;
  }
  try {
    const result = await fn(params ?? {});
    process.stdout.write(`${JSON.stringify({ id, ok: true, result })}\n`);
  } catch (err) {
    process.stdout.write(`${JSON.stringify({ id, ok: false, error: String(err?.message ?? err) })}\n`);
  }
});

rl.on("close", () => {
  catalog.close();
  process.exit(0);
});

process.stdout.write(`${JSON.stringify({ ready: true, home })}\n`);
