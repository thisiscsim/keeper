// The catalog: one SQLite database per library (<home>/.keeper/catalog.db)
// holding every asset record, burst group, and import manifest, plus the
// embedding vectors for semantic search. Uses node:sqlite (Node >= 22.13) so
// there is no native build step; WAL mode + busy_timeout make it safe for the
// app's catalog service and pipeline scripts to write concurrently.
//
// Rows are stored as hot columns (everything we filter/sort on) plus JSON
// side-columns for the rest. Every row is re-validated through
// AssetRecordSchema on read — catalog rows can be written by CLI tools and
// agents, so they are treated as untrusted input.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import {
  AssetRecordSchema,
  GroupSchema,
  ImportManifestSchema,
} from "@keeper/schema";
import { catalogPath, keeperDir, touchStamp } from "./paths.mjs";

const SCHEMA_VERSION = 1;

const CREATE_SQL = `
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE,
  rel_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  media_type TEXT NOT NULL,
  format TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  duration_sec REAL,
  captured_at TEXT,
  date_source TEXT NOT NULL DEFAULT 'unknown',
  import_id TEXT,
  imported_at TEXT,
  group_id TEXT,
  pair_role TEXT NOT NULL DEFAULT 'primary',
  pair_primary_id TEXT,
  offline INTEGER NOT NULL DEFAULT 0,
  thumb_rel TEXT,
  preview_rel TEXT,
  poster_rel TEXT,
  scrub_rel TEXT,
  exif_json TEXT NOT NULL DEFAULT '{}',
  quality_json TEXT NOT NULL DEFAULT '{}',
  ai_json TEXT,
  user_flag TEXT NOT NULL DEFAULT 'unrated',
  user_rating INTEGER NOT NULL DEFAULT 0,
  user_at TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  caption TEXT,
  stages_json TEXT NOT NULL DEFAULT '{}',
  embedding BLOB,
  embed_model TEXT
);
CREATE INDEX IF NOT EXISTS idx_assets_captured ON assets(captured_at);
CREATE INDEX IF NOT EXISTS idx_assets_flag ON assets(user_flag);
CREATE INDEX IF NOT EXISTS idx_assets_group ON assets(group_id);
CREATE INDEX IF NOT EXISTS idx_assets_import ON assets(import_id);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  best_pick_id TEXT,
  pick_source TEXT
);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  manifest_json TEXT NOT NULL
);
`;

function rowToAsset(row) {
  const record = {
    id: row.id,
    relPath: row.rel_path,
    fileName: row.file_name,
    byteSize: row.byte_size,
    contentHash: row.content_hash,
    mediaType: row.media_type,
    format: row.format,
    width: row.width ?? undefined,
    height: row.height ?? undefined,
    durationSec: row.duration_sec ?? undefined,
    capturedAt: row.captured_at ?? undefined,
    dateSource: row.date_source,
    exif: JSON.parse(row.exif_json || "{}"),
    importId: row.import_id ?? undefined,
    importedAt: row.imported_at ?? undefined,
    groupId: row.group_id ?? undefined,
    pairRole: row.pair_role,
    pairPrimaryId: row.pair_primary_id ?? undefined,
    offline: Boolean(row.offline),
    thumbRel: row.thumb_rel ?? undefined,
    previewRel: row.preview_rel ?? undefined,
    posterRel: row.poster_rel ?? undefined,
    scrubRel: row.scrub_rel ?? undefined,
    quality: JSON.parse(row.quality_json || "{}"),
    ai: row.ai_json ? JSON.parse(row.ai_json) : undefined,
    user: { flag: row.user_flag, rating: row.user_rating, at: row.user_at ?? undefined },
    tags: JSON.parse(row.tags_json || "[]"),
    caption: row.caption ?? undefined,
    stages: JSON.parse(row.stages_json || "{}"),
  };
  return AssetRecordSchema.parse(record);
}

function assetToParams(asset) {
  const a = AssetRecordSchema.parse(asset);
  return {
    id: a.id,
    content_hash: a.contentHash,
    rel_path: a.relPath,
    file_name: a.fileName,
    media_type: a.mediaType,
    format: a.format,
    byte_size: a.byteSize,
    width: a.width ?? null,
    height: a.height ?? null,
    duration_sec: a.durationSec ?? null,
    captured_at: a.capturedAt ?? null,
    date_source: a.dateSource,
    import_id: a.importId ?? null,
    imported_at: a.importedAt ?? null,
    group_id: a.groupId ?? null,
    pair_role: a.pairRole,
    pair_primary_id: a.pairPrimaryId ?? null,
    offline: a.offline ? 1 : 0,
    thumb_rel: a.thumbRel ?? null,
    preview_rel: a.previewRel ?? null,
    poster_rel: a.posterRel ?? null,
    scrub_rel: a.scrubRel ?? null,
    exif_json: JSON.stringify(a.exif),
    quality_json: JSON.stringify(a.quality),
    ai_json: a.ai ? JSON.stringify(a.ai) : null,
    user_flag: a.user.flag,
    user_rating: a.user.rating,
    user_at: a.user.at ?? null,
    tags_json: JSON.stringify(a.tags),
    caption: a.caption ?? null,
    stages_json: JSON.stringify(a.stages),
  };
}

const UPSERT_COLS = [
  "id", "content_hash", "rel_path", "file_name", "media_type", "format", "byte_size",
  "width", "height", "duration_sec", "captured_at", "date_source", "import_id", "imported_at",
  "group_id", "pair_role", "pair_primary_id", "offline", "thumb_rel", "preview_rel",
  "poster_rel", "scrub_rel", "exif_json", "quality_json", "ai_json", "user_flag",
  "user_rating", "user_at", "tags_json", "caption", "stages_json",
];

/**
 * Open (creating if needed) the catalog for a library home.
 * Options: { stampOnWrite } — CLI/pipeline contexts touch the stamp file after
 * writes so the running app knows to refresh; the app's own service must NOT
 * stamp or it would refresh itself in a loop.
 */
export function openCatalog(home, { stampOnWrite = false } = {}) {
  fs.mkdirSync(keeperDir(home), { recursive: true });
  const db = new DatabaseSync(catalogPath(home));
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA synchronous = NORMAL");

  const version = db.prepare("PRAGMA user_version").get().user_version;
  if (version < SCHEMA_VERSION) {
    db.exec(CREATE_SQL);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  }

  const stamp = () => {
    if (stampOnWrite) touchStamp(home);
  };

  const upsertStmt = db.prepare(`
    INSERT INTO assets (${UPSERT_COLS.join(", ")})
    VALUES (${UPSERT_COLS.map((c) => `:${c}`).join(", ")})
    ON CONFLICT(id) DO UPDATE SET ${UPSERT_COLS.filter((c) => c !== "id")
      .map((c) => `${c} = :${c}`)
      .join(", ")}
  `);

  const getStmt = db.prepare("SELECT * FROM assets WHERE id = ?");

  const api = {
    db,
    home,

    close() {
      db.close();
    },

    upsertAsset(asset) {
      upsertStmt.run(assetToParams(asset));
      stamp();
    },

    upsertAssets(assets) {
      db.exec("BEGIN");
      try {
        for (const asset of assets) upsertStmt.run(assetToParams(asset));
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      stamp();
    },

    getAsset(id) {
      const row = getStmt.get(id);
      return row ? rowToAsset(row) : null;
    },

    getAssets(ids) {
      const out = [];
      for (const id of ids) {
        const row = getStmt.get(id);
        if (row) out.push(rowToAsset(row));
      }
      return out;
    },

    /** Content-hash dedupe across the whole library. Returns existing id or null. */
    findByHash(contentHash) {
      const row = db.prepare("SELECT id FROM assets WHERE content_hash = ?").get(contentHash);
      return row ? row.id : null;
    },

    /**
     * List assets with the filters the UI actually uses. Non-primary pair
     * members (RAW siblings, Live Photo videos) are hidden unless includePaired.
     */
    listAssets({
      flag,
      mediaType,
      minRating,
      importId,
      groupId,
      pairPrimaryId,
      day,
      ids,
      includePaired = false,
      hasAi,
      limit = 100_000,
      offset = 0,
      order = "captured_desc",
    } = {}) {
      const where = [];
      const params = {};
      if (!includePaired) where.push("pair_role = 'primary'");
      if (flag) {
        where.push("user_flag = :flag");
        params.flag = flag;
      }
      if (mediaType) {
        where.push("media_type = :mediaType");
        params.mediaType = mediaType;
      }
      if (typeof minRating === "number" && minRating > 0) {
        where.push("user_rating >= :minRating");
        params.minRating = minRating;
      }
      if (importId) {
        where.push("import_id = :importId");
        params.importId = importId;
      }
      if (groupId) {
        where.push("group_id = :groupId");
        params.groupId = groupId;
      }
      if (pairPrimaryId) {
        where.push("pair_primary_id = :pairPrimaryId");
        params.pairPrimaryId = pairPrimaryId;
      }
      if (day) {
        where.push("substr(coalesce(captured_at, imported_at, ''), 1, 10) = :day");
        params.day = day;
      }
      if (hasAi === true) where.push("ai_json IS NOT NULL");
      if (hasAi === false) where.push("ai_json IS NULL");
      if (ids && ids.length > 0) {
        // ids come from our own search results; still cap and inline safely.
        const list = ids.slice(0, 2000).map((_, i) => `:id${i}`);
        ids.slice(0, 2000).forEach((id, i) => {
          params[`id${i}`] = id;
        });
        where.push(`id IN (${list.join(",")})`);
      }
      const orderSql =
        order === "captured_asc"
          ? "ORDER BY coalesce(captured_at, imported_at) ASC, file_name ASC"
          : "ORDER BY coalesce(captured_at, imported_at) DESC, file_name DESC";
      const sql = `SELECT * FROM assets ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ${orderSql} LIMIT :limit OFFSET :offset`;
      params.limit = Math.min(limit, 100_000);
      params.offset = offset;
      return db.prepare(sql).all(params).map(rowToAsset);
    },

    /** Date buckets (YYYY-MM-DD) with counts, newest first — the grid skeleton. */
    listDays({ flag, mediaType } = {}) {
      const where = ["pair_role = 'primary'"];
      const params = {};
      if (flag) {
        where.push("user_flag = :flag");
        params.flag = flag;
      }
      if (mediaType) {
        where.push("media_type = :mediaType");
        params.mediaType = mediaType;
      }
      const sql = `
        SELECT substr(coalesce(captured_at, imported_at, 'unknown'), 1, 10) AS day, COUNT(*) AS n
        FROM assets WHERE ${where.join(" AND ")}
        GROUP BY day ORDER BY day DESC
      `;
      return db.prepare(sql).all(params).map((r) => ({ day: r.day || "unknown", count: r.n }));
    },

    countsSummary() {
      const row = db
        .prepare(
          `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN media_type = 'photo' THEN 1 ELSE 0 END) AS photos,
            SUM(CASE WHEN media_type = 'video' THEN 1 ELSE 0 END) AS videos,
            SUM(CASE WHEN user_flag = 'pick' THEN 1 ELSE 0 END) AS picks,
            SUM(CASE WHEN user_flag = 'reject' THEN 1 ELSE 0 END) AS rejects,
            SUM(CASE WHEN user_flag = 'unrated' THEN 1 ELSE 0 END) AS unrated,
            SUM(CASE WHEN user_flag = 'unrated' AND ai_json IS NOT NULL THEN 1 ELSE 0 END) AS suggested,
            SUM(byte_size) AS bytes
          FROM assets WHERE pair_role = 'primary'`,
        )
        .get();
      return {
        total: row.total ?? 0,
        photos: row.photos ?? 0,
        videos: row.videos ?? 0,
        picks: row.picks ?? 0,
        rejects: row.rejects ?? 0,
        unrated: row.unrated ?? 0,
        suggested: row.suggested ?? 0,
        bytes: row.bytes ?? 0,
      };
    },

    /**
     * Set the user verdict on a set of assets. Returns the prior state of each
     * affected asset so the caller can detect AI overrides (the taste signal)
     * and build undo entries.
     */
    setUserVerdict(ids, { flag, rating }) {
      const before = api.getAssets(ids);
      const at = new Date().toISOString();
      db.exec("BEGIN");
      try {
        for (const id of ids) {
          if (flag !== undefined && rating !== undefined) {
            db.prepare("UPDATE assets SET user_flag = ?, user_rating = ?, user_at = ? WHERE id = ?").run(
              flag,
              rating,
              at,
              id,
            );
          } else if (flag !== undefined) {
            db.prepare("UPDATE assets SET user_flag = ?, user_at = ? WHERE id = ?").run(flag, at, id);
          } else if (rating !== undefined) {
            db.prepare("UPDATE assets SET user_rating = ?, user_at = ? WHERE id = ?").run(rating, at, id);
          }
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      stamp();
      return before;
    },

    setAiVerdict(id, ai) {
      db.prepare("UPDATE assets SET ai_json = ? WHERE id = ?").run(JSON.stringify(ai), id);
      stamp();
    },

    /** Patch derived-artifact paths and media dimensions after a stage runs. */
    patchAsset(id, fields) {
      const allowed = {
        thumbRel: "thumb_rel",
        previewRel: "preview_rel",
        posterRel: "poster_rel",
        scrubRel: "scrub_rel",
        caption: "caption",
        width: "width",
        height: "height",
        durationSec: "duration_sec",
        groupId: "group_id",
        offline: "offline",
      };
      const sets = [];
      const params = { id };
      for (const [key, col] of Object.entries(allowed)) {
        if (fields[key] !== undefined) {
          sets.push(`${col} = :${key}`);
          params[key] = key === "offline" ? (fields[key] ? 1 : 0) : fields[key];
        }
      }
      if (fields.quality !== undefined) {
        sets.push("quality_json = :quality");
        params.quality = JSON.stringify(fields.quality);
      }
      if (fields.tags !== undefined) {
        sets.push("tags_json = :tags");
        params.tags = JSON.stringify(fields.tags.slice(0, 128));
      }
      if (sets.length === 0) return;
      db.prepare(`UPDATE assets SET ${sets.join(", ")} WHERE id = :id`).run(params);
      stamp();
    },

    setPairing(id, pairRole, pairPrimaryId) {
      db.prepare("UPDATE assets SET pair_role = ?, pair_primary_id = ? WHERE id = ?").run(
        pairRole,
        pairPrimaryId ?? null,
        id,
      );
      stamp();
    },

    markStage(id, stage) {
      const row = getStmt.get(id);
      if (!row) return;
      const stages = JSON.parse(row.stages_json || "{}");
      stages[stage] = new Date().toISOString();
      db.prepare("UPDATE assets SET stages_json = ? WHERE id = ?").run(JSON.stringify(stages), id);
    },

    /** Assets that have not completed a pipeline stage (resume/reprocess). */
    assetsMissingStage(stage, limit = 10_000) {
      const rows = db
        .prepare(
          `SELECT * FROM assets WHERE json_extract(stages_json, '$.' || ?) IS NULL
           ORDER BY coalesce(captured_at, imported_at) DESC LIMIT ?`,
        )
        .all(stage, limit);
      return rows.map(rowToAsset);
    },

    setEmbedding(id, vector, model) {
      const buf = Buffer.from(new Float32Array(vector).buffer);
      db.prepare("UPDATE assets SET embedding = ?, embed_model = ? WHERE id = ?").run(buf, model, id);
    },

    /** All embeddings for brute-force search: [{ id, vec: Float32Array }]. */
    allEmbeddings() {
      const rows = db
        .prepare("SELECT id, embedding FROM assets WHERE embedding IS NOT NULL AND pair_role = 'primary'")
        .all();
      return rows.map((r) => ({
        id: r.id,
        vec: new Float32Array(r.embedding.buffer, r.embedding.byteOffset, r.embedding.byteLength / 4),
      }));
    },

    embeddingCount() {
      return db.prepare("SELECT COUNT(*) AS n FROM assets WHERE embedding IS NOT NULL").get().n;
    },

    upsertGroup(group) {
      const g = GroupSchema.parse(group);
      db.exec("BEGIN");
      try {
        db.prepare(
          `INSERT INTO groups (id, kind, best_pick_id, pick_source) VALUES (?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, best_pick_id = excluded.best_pick_id, pick_source = excluded.pick_source`,
        ).run(g.id, g.kind, g.bestPickId ?? null, g.pickSource ?? null);
        for (const assetId of g.assetIds) {
          db.prepare("UPDATE assets SET group_id = ? WHERE id = ?").run(g.id, assetId);
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      stamp();
    },

    getGroup(id) {
      const row = db.prepare("SELECT * FROM groups WHERE id = ?").get(id);
      if (!row) return null;
      const members = db.prepare("SELECT id FROM assets WHERE group_id = ? ORDER BY file_name").all(id);
      return GroupSchema.parse({
        id: row.id,
        kind: row.kind,
        assetIds: members.map((m) => m.id),
        bestPickId: row.best_pick_id ?? undefined,
        pickSource: row.pick_source ?? undefined,
      });
    },

    setGroupPick(groupId, bestPickId, source) {
      db.prepare("UPDATE groups SET best_pick_id = ?, pick_source = ? WHERE id = ?").run(
        bestPickId,
        source,
        groupId,
      );
      stamp();
    },

    saveImport(manifest) {
      const m = ImportManifestSchema.parse(manifest);
      db.prepare(
        `INSERT INTO imports (id, started_at, manifest_json) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET manifest_json = excluded.manifest_json`,
      ).run(m.id, m.startedAt, JSON.stringify(m));
      return m;
    },

    getImport(id) {
      const row = db.prepare("SELECT manifest_json FROM imports WHERE id = ?").get(id);
      return row ? ImportManifestSchema.parse(JSON.parse(row.manifest_json)) : null;
    },

    listImports(limit = 20) {
      return db
        .prepare("SELECT manifest_json FROM imports ORDER BY started_at DESC LIMIT ?")
        .all(limit)
        .map((r) => ImportManifestSchema.parse(JSON.parse(r.manifest_json)));
    },
  };

  return api;
}
