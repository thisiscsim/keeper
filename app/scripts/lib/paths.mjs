// Library location resolution shared by every script, the catalog service,
// and the CLI tools. The Electron main process resolves the same way and
// re-exports KEEPER_LIBRARY_DIR into the environment of spawned scripts, so
// everyone agrees on one home.
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** Resolve the library home: env override, else ~/Pictures/Keeper. */
export function resolveHome(explicit) {
  return (
    explicit ||
    process.env.KEEPER_LIBRARY_DIR ||
    process.env.KEEPER_HOME ||
    path.join(os.homedir(), "Pictures", "Keeper")
  );
}

/** Where originals live: <home>/library/YYYY/YYYY-MM-DD/<file>. */
export function libraryRoot(home) {
  return path.join(home, "library");
}

/** Keeper's own data: catalog, thumbs, previews, models. */
export function keeperDir(home) {
  return path.join(home, ".keeper");
}

export function catalogPath(home) {
  return path.join(keeperDir(home), "catalog.db");
}

export function tastePath(home) {
  return path.join(home, "taste.json");
}

/** Touched after CLI/pipeline writes so the app knows to refresh. */
export function stampPath(home) {
  return path.join(keeperDir(home), ".stamp");
}

export function thumbsDir(home) {
  return path.join(keeperDir(home), "thumbs");
}

export function previewsDir(home) {
  return path.join(keeperDir(home), "previews");
}

export function modelsDir(home) {
  return path.join(keeperDir(home), "models");
}

/** Create the whole on-disk layout (idempotent). */
export function ensureLayout(home) {
  for (const dir of [home, libraryRoot(home), keeperDir(home), thumbsDir(home), previewsDir(home), modelsDir(home)]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return home;
}

/**
 * Join + confine: the resolved path must stay inside root. Guards every path
 * that came from a catalog row or an IPC/CLI argument.
 */
export function safeJoin(root, ...rel) {
  const resolved = path.normalize(path.join(root, ...rel));
  const base = path.resolve(root);
  if (resolved !== base && !resolved.startsWith(base + path.sep)) {
    throw new Error(`path escapes ${base}: ${rel.join("/")}`);
  }
  return resolved;
}

export function touchStamp(home) {
  try {
    fs.mkdirSync(keeperDir(home), { recursive: true });
    fs.writeFileSync(stampPath(home), String(Date.now()));
  } catch {
    // stamp is best-effort; a missed refresh is harmless
  }
}
