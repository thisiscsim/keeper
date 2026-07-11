import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { openCatalog } from "./catalog.mjs";

let home;
let catalog;

const asset = (id, extra = {}) => ({
  id,
  relPath: `library/2026/2026-07-04/${id}.jpg`,
  fileName: `${id}.jpg`,
  byteSize: 1000,
  contentHash: `hash-${id}-0123456789abcdef`,
  mediaType: "photo",
  format: "jpeg",
  capturedAt: "2026-07-04T12:00:00.000Z",
  ...extra,
});

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "keeper-test-"));
  catalog = openCatalog(home);
});

afterEach(() => {
  catalog.close();
  fs.rmSync(home, { recursive: true, force: true });
});

describe("catalog", () => {
  it("round-trips asset records through upsert/get", () => {
    catalog.upsertAsset(asset("a1", { tags: ["ocean"], quality: { blurScore: 12 } }));
    const got = catalog.getAsset("a1");
    expect(got?.fileName).toBe("a1.jpg");
    expect(got?.tags).toEqual(["ocean"]);
    expect(got?.quality.blurScore).toBe(12);
    expect(got?.user.flag).toBe("unrated");
  });

  it("dedupes by content hash", () => {
    catalog.upsertAsset(asset("a1"));
    expect(catalog.findByHash("hash-a1-0123456789abcdef")).toBe("a1");
    expect(catalog.findByHash("hash-zz-0123456789abcdef")).toBeNull();
  });

  it("rejects hostile rows on write (schema boundary)", () => {
    expect(() => catalog.upsertAsset(asset("a1", { relPath: "../../etc/passwd" }))).toThrow();
    expect(() => catalog.upsertAsset(asset("a1", { byteSize: Infinity }))).toThrow();
  });

  it("filters and hides paired siblings", () => {
    catalog.upsertAssets([
      asset("jpg1"),
      asset("raw1", { format: "raw", pairRole: "raw-sibling", pairPrimaryId: "jpg1" }),
      asset("v1", { mediaType: "video", format: "mp4", durationSec: 5 }),
    ]);
    const all = catalog.listAssets({});
    expect(all.map((a) => a.id).sort()).toEqual(["jpg1", "v1"]);
    const videos = catalog.listAssets({ mediaType: "video" });
    expect(videos.map((a) => a.id)).toEqual(["v1"]);
    const withPaired = catalog.listAssets({ includePaired: true });
    expect(withPaired).toHaveLength(3);
  });

  it("buckets by day", () => {
    catalog.upsertAssets([
      asset("a", { capturedAt: "2026-07-04T10:00:00.000Z" }),
      asset("b", { capturedAt: "2026-07-04T11:00:00.000Z" }),
      asset("c", { capturedAt: "2026-07-05T09:00:00.000Z" }),
    ]);
    const days = catalog.listDays();
    expect(days).toEqual([
      { day: "2026-07-05", count: 1 },
      { day: "2026-07-04", count: 2 },
    ]);
  });

  it("sets verdicts and returns prior state for undo", () => {
    catalog.upsertAssets([asset("a"), asset("b")]);
    const before = catalog.setUserVerdict(["a", "b"], { flag: "reject" });
    expect(before.map((b) => b.user.flag)).toEqual(["unrated", "unrated"]);
    expect(catalog.getAsset("a")?.user.flag).toBe("reject");
    const summary = catalog.countsSummary();
    expect(summary.rejects).toBe(2);
  });

  it("stores groups and updates members", () => {
    catalog.upsertAssets([asset("a"), asset("b")]);
    catalog.upsertGroup({ id: "g1", kind: "burst", assetIds: ["a", "b"], bestPickId: "a", pickSource: "cv" });
    const group = catalog.getGroup("g1");
    expect(group?.assetIds.sort()).toEqual(["a", "b"]);
    expect(catalog.getAsset("b")?.groupId).toBe("g1");
    catalog.setGroupPick("g1", "b", "user");
    expect(catalog.getGroup("g1")?.bestPickId).toBe("b");
  });

  it("tracks pipeline stages for resume", () => {
    catalog.upsertAssets([asset("a"), asset("b")]);
    catalog.markStage("a", "derive");
    const missing = catalog.assetsMissingStage("derive");
    expect(missing.map((m) => m.id)).toEqual(["b"]);
  });

  it("stores and retrieves embeddings", () => {
    catalog.upsertAsset(asset("a"));
    const vec = new Array(8).fill(0).map((_, i) => i / 10);
    catalog.setEmbedding("a", vec, "test-model");
    const all = catalog.allEmbeddings();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe("a");
    expect(all[0].vec[3]).toBeCloseTo(0.3, 5);
    expect(catalog.embeddingCount()).toBe(1);
  });

  it("persists import manifests", () => {
    catalog.saveImport({ id: "imp1", startedAt: "2026-07-10T00:00:00Z", stage: "copy", counts: { found: 10 } });
    catalog.saveImport({ id: "imp1", startedAt: "2026-07-10T00:00:00Z", stage: "done", status: "done", counts: { found: 10, copied: 9 } });
    const imp = catalog.getImport("imp1");
    expect(imp?.stage).toBe("done");
    expect(imp?.counts.copied).toBe(9);
    expect(catalog.listImports()).toHaveLength(1);
  });

  it("touches the stamp file only when asked", () => {
    const stamped = openCatalog(home, { stampOnWrite: true });
    stamped.upsertAsset(asset("s1"));
    expect(fs.existsSync(path.join(home, ".keeper", ".stamp"))).toBe(true);
    stamped.close();
  });
});
