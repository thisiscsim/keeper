import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetRecord } from "@keeper/schema";
import { useKeeper } from "./store";

function asset(id: string, extra: Partial<AssetRecord> = {}): AssetRecord {
  return {
    id,
    relPath: `library/2026/2026-07-04/${id}.jpg`,
    fileName: `${id}.jpg`,
    byteSize: 1000,
    contentHash: `hash-${id}`,
    mediaType: "photo",
    format: "jpeg",
    dateSource: "exif",
    exif: {},
    pairRole: "primary",
    offline: false,
    quality: {},
    user: { flag: "unrated", rating: 0 },
    tags: [],
    stages: {},
    ...extra,
  } as AssetRecord;
}

function seed(assets: AssetRecord[]): void {
  useKeeper.setState({
    records: new Map(assets.map((a) => [a.id, a])),
    days: [{ day: "2026-07-04", count: assets.length }],
    dayIds: { "2026-07-04": assets.map((a) => a.id) },
    undoPast: [],
    undoFuture: [],
    selected: new Set(),
    anchorId: null,
    activeId: null,
    searchResults: null,
    searchQuery: "",
  });
}

beforeEach(() => {
  seed([asset("a"), asset("b"), asset("c")]);
  vi.clearAllMocks();
});

describe("selection", () => {
  it("selects single, toggles with meta, ranges with shift", () => {
    const s = useKeeper.getState();
    s.select("a");
    expect([...useKeeper.getState().selected]).toEqual(["a"]);
    useKeeper.getState().select("c", { shift: true });
    expect([...useKeeper.getState().selected].sort()).toEqual(["a", "b", "c"]);
    useKeeper.getState().select("b", { toggle: true });
    expect(useKeeper.getState().selected.has("b")).toBe(false);
  });

  it("selectionOr prefers explicit id, then selection, then loupe", () => {
    useKeeper.getState().select("a");
    expect(useKeeper.getState().selectionOr("b")).toEqual(["b"]);
    expect(useKeeper.getState().selectionOr(null)).toEqual(["a"]);
    useKeeper.getState().clearSelection();
    useKeeper.getState().openLoupe("c");
    expect(useKeeper.getState().selectionOr(null)).toEqual(["c"]);
  });
});

describe("verdicts + undo", () => {
  it("applies optimistically and records an undo entry", async () => {
    await useKeeper.getState().setVerdict(["a", "b"], { flag: "reject" });
    expect(useKeeper.getState().records.get("a")?.user.flag).toBe("reject");
    expect(useKeeper.getState().records.get("b")?.user.flag).toBe("reject");
    expect(useKeeper.getState().undoPast).toHaveLength(1);
    expect(window.api.setVerdict).toHaveBeenCalledWith({ ids: ["a", "b"], flag: "reject", rating: undefined });
  });

  it("undo restores prior state and enables redo", async () => {
    await useKeeper.getState().setVerdict(["a"], { flag: "pick" });
    await useKeeper.getState().undo();
    expect(useKeeper.getState().records.get("a")?.user.flag).toBe("unrated");
    expect(useKeeper.getState().undoFuture).toHaveLength(1);
    expect(window.api.restoreVerdicts).toHaveBeenCalled();
    await useKeeper.getState().redo();
    expect(useKeeper.getState().records.get("a")?.user.flag).toBe("pick");
  });

  it("reverts the optimistic update when the write fails", async () => {
    vi.mocked(window.api.setVerdict).mockResolvedValueOnce({ ok: false, error: "boom" });
    await useKeeper.getState().setVerdict(["a"], { flag: "reject" });
    expect(useKeeper.getState().records.get("a")?.user.flag).toBe("unrated");
    expect(useKeeper.getState().undoPast).toHaveLength(0);
    expect(useKeeper.getState().notice?.kind).toBe("error");
  });

  it("rating-only verdicts keep the flag", async () => {
    await useKeeper.getState().setVerdict(["a"], { rating: 4 });
    const a = useKeeper.getState().records.get("a");
    expect(a?.user.rating).toBe(4);
    expect(a?.user.flag).toBe("unrated");
  });
});

describe("loupe navigation", () => {
  it("walks the flat order of loaded sections", () => {
    useKeeper.getState().openLoupe("a");
    useKeeper.getState().navLoupe(1);
    expect(useKeeper.getState().activeId).toBe("b");
    useKeeper.getState().navLoupe(1);
    expect(useKeeper.getState().activeId).toBe("c");
    useKeeper.getState().navLoupe(1);
    expect(useKeeper.getState().activeId).toBe("c"); // clamped at the end
  });

  it("follows search results order when a search is active", () => {
    useKeeper.setState({
      searchResults: [
        { assetId: "c", score: 0.9, matched: [] },
        { assetId: "a", score: 0.5, matched: [] },
      ],
    });
    useKeeper.getState().openLoupe("c");
    useKeeper.getState().navLoupe(1);
    expect(useKeeper.getState().activeId).toBe("a");
  });
});

describe("theme", () => {
  it("toggles and persists the data attribute", () => {
    const before = useKeeper.getState().theme;
    useKeeper.getState().toggleTheme();
    const after = useKeeper.getState().theme;
    expect(after).not.toBe(before);
    expect(document.documentElement.dataset.theme).toBe(after);
  });
});
