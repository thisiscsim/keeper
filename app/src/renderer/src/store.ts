import { create } from "zustand";
import type { AssetRecord, SearchResult, UserFlag } from "@keeper/schema";
import type { DayBucket, LibrarySummary, ReviewQueues } from "../../preload";

export type Theme = "dark" | "light";
export type View = "library" | "review";
export type ModalId = "settings" | "export" | "rejects" | "taste" | null;

const THEME_KEY = "keeper:theme";

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // localStorage unavailable; fall through to system preference
  }
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return "dark";
}

function applyTheme(theme: Theme, persist = true): void {
  if (typeof document !== "undefined") document.documentElement.dataset.theme = theme;
  if (!persist) return;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // persistence is best-effort
  }
}

// Animate theme switches with the View Transitions API (Chromium); falls back
// to an instant switch (e.g. jsdom).
function withViewTransition(mutate: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition === "function") doc.startViewTransition(mutate);
  else mutate();
}

export interface Filter {
  flag?: UserFlag;
  mediaType?: "photo" | "video";
  minRating?: number;
}

/** One undoable verdict operation: the prior user state of every touched asset. */
interface UndoEntry {
  entries: { id: string; user: { flag: UserFlag; rating: number } }[];
}

interface TaskState {
  running: boolean;
  phase: string;
  progress: number;
}

const idleTask: TaskState = { running: false, phase: "", progress: 0 };

interface KeeperState {
  view: View;
  theme: Theme;
  home: string | null;
  summary: LibrarySummary | null;
  days: DayBucket[];
  /** Normalized asset records for everything currently known to the UI. */
  records: Map<string, AssetRecord>;
  /** day -> ordered asset ids, loaded lazily as sections scroll into view. */
  dayIds: Record<string, string[]>;
  loadingDays: Record<string, boolean>;
  filter: Filter;

  selected: Set<string>;
  anchorId: string | null;
  /** Loupe (full-size viewer). */
  activeId: string | null;

  searchQuery: string;
  searchResults: SearchResult[] | null;
  searchMode: "semantic" | "metadata" | null;
  searching: boolean;

  queues: ReviewQueues | null;
  loadingQueues: boolean;

  undoPast: UndoEntry[];
  undoFuture: UndoEntry[];

  tasks: Record<"import" | "judge" | "export" | "reprocess", TaskState>;
  notice: { kind: "error" | "info"; text: string } | null;
  modal: ModalId;

  // -- actions --------------------------------------------------------------
  setView: (view: View) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setModal: (modal: ModalId) => void;
  setNotice: (notice: { kind: "error" | "info"; text: string } | null) => void;

  refreshLibrary: () => Promise<void>;
  loadDay: (day: string) => Promise<void>;
  setFilter: (patch: Partial<Filter>) => void;

  select: (id: string, opts?: { shift?: boolean; toggle?: boolean }) => void;
  clearSelection: () => void;
  selectionOr: (id?: string | null) => string[];

  openLoupe: (id: string) => void;
  closeLoupe: () => void;
  navLoupe: (dir: 1 | -1) => void;

  /** All asset ids in current display order (search results or loaded sections). */
  flatIds: () => string[];

  setVerdict: (ids: string[], patch: { flag?: UserFlag; rating?: number }) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;

  runSearch: (query: string) => Promise<void>;
  clearSearch: () => void;

  loadQueues: () => Promise<void>;

  setTask: (name: keyof KeeperState["tasks"], patch: Partial<TaskState>) => void;

  mergeRecords: (assets: AssetRecord[]) => void;

  /** Run an import (from dialogs or drag-drop) with progress + notices. */
  importSources: (paths: string[]) => Promise<void>;
}

function mergeIntoMap(map: Map<string, AssetRecord>, assets: AssetRecord[]): Map<string, AssetRecord> {
  const next = new Map(map);
  for (const asset of assets) next.set(asset.id, asset);
  return next;
}

export const useKeeper = create<KeeperState>()((set, get) => ({
  view: "library",
  theme: initialTheme(),
  home: null,
  summary: null,
  days: [],
  records: new Map(),
  dayIds: {},
  loadingDays: {},
  filter: {},

  selected: new Set(),
  anchorId: null,
  activeId: null,

  searchQuery: "",
  searchResults: null,
  searchMode: null,
  searching: false,

  queues: null,
  loadingQueues: false,

  undoPast: [],
  undoFuture: [],

  tasks: { import: idleTask, judge: idleTask, export: idleTask, reprocess: idleTask },
  notice: null,
  modal: null,

  setView: (view) => {
    set({ view });
    if (view === "review") void get().loadQueues();
  },
  setTheme: (theme) => {
    withViewTransition(() => {
      applyTheme(theme);
      set({ theme });
    });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),
  setModal: (modal) => set({ modal }),
  setNotice: (notice) => set({ notice }),

  refreshLibrary: async () => {
    const { filter } = get();
    const [info, summaryRes, daysRes] = await Promise.all([
      window.api?.getLibrary(),
      window.api?.librarySummary(),
      window.api?.listDays({ flag: filter.flag, mediaType: filter.mediaType }),
    ]);
    set({
      home: info?.home ?? null,
      summary: summaryRes?.ok ? (summaryRes.result ?? null) : get().summary,
      days: daysRes?.ok ? (daysRes.result ?? []) : [],
      // Section contents may be stale after imports/agent writes; drop caches
      // and let visible sections re-request.
      dayIds: {},
      loadingDays: {},
    });
  },

  loadDay: async (day) => {
    const { loadingDays, dayIds, filter } = get();
    if (loadingDays[day] || dayIds[day]) return;
    set({ loadingDays: { ...get().loadingDays, [day]: true } });
    const res = await window.api?.listAssets({
      day,
      flag: filter.flag,
      mediaType: filter.mediaType,
      minRating: filter.minRating,
      order: "captured_asc",
    });
    if (res?.ok && res.result) {
      set((s) => ({
        records: mergeIntoMap(s.records, res.result ?? []),
        dayIds: { ...s.dayIds, [day]: (res.result ?? []).map((a) => a.id) },
        loadingDays: { ...s.loadingDays, [day]: false },
      }));
    } else {
      set((s) => ({ loadingDays: { ...s.loadingDays, [day]: false } }));
    }
  },

  setFilter: (patch) => {
    set({ filter: { ...get().filter, ...patch }, selected: new Set(), anchorId: null });
    void get().refreshLibrary();
  },

  select: (id, opts) => {
    const { selected, anchorId } = get();
    const flat = get().flatIds();
    if (opts?.shift && anchorId && flat.includes(anchorId) && flat.includes(id)) {
      const a = flat.indexOf(anchorId);
      const b = flat.indexOf(id);
      const range = flat.slice(Math.min(a, b), Math.max(a, b) + 1);
      set({ selected: new Set([...selected, ...range]) });
      return;
    }
    if (opts?.toggle) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      set({ selected: next, anchorId: id });
      return;
    }
    set({ selected: new Set([id]), anchorId: id });
  },
  clearSelection: () => set({ selected: new Set(), anchorId: null }),

  /** The ids an action applies to: explicit target, else selection, else loupe. */
  selectionOr: (id) => {
    if (id) {
      const { selected } = get();
      return selected.has(id) && selected.size > 1 ? [...selected] : [id];
    }
    const { selected, activeId } = get();
    if (selected.size > 0) return [...selected];
    if (activeId) return [activeId];
    return [];
  },

  openLoupe: (id) => set({ activeId: id }),
  closeLoupe: () => set({ activeId: null }),
  navLoupe: (dir) => {
    const { activeId } = get();
    if (!activeId) return;
    const flat = get().flatIds();
    const idx = flat.indexOf(activeId);
    if (idx < 0) return;
    const next = flat[idx + dir];
    if (next) set({ activeId: next, anchorId: next });
  },

  flatIds: () => {
    const { searchResults, days, dayIds } = get();
    if (searchResults) return searchResults.map((r) => r.assetId);
    const out: string[] = [];
    for (const bucket of days) {
      const ids = dayIds[bucket.day];
      if (ids) out.push(...ids);
    }
    return out;
  },

  setVerdict: async (ids, patch) => {
    if (ids.length === 0) return;
    const { records } = get();
    const entries = ids
      .map((id) => records.get(id))
      .filter((a): a is AssetRecord => Boolean(a))
      .map((a) => ({ id: a.id, user: { flag: a.user.flag, rating: a.user.rating } }));

    // Optimistic: culling has to feel instant under keyboard fire.
    const at = new Date().toISOString();
    const updated = ids
      .map((id) => records.get(id))
      .filter((a): a is AssetRecord => Boolean(a))
      .map((a) => ({
        ...a,
        user: {
          flag: patch.flag ?? a.user.flag,
          rating: patch.rating ?? a.user.rating,
          at,
        },
      }));
    set((s) => ({
      records: mergeIntoMap(s.records, updated),
      undoPast: [...s.undoPast.slice(-49), { entries }],
      undoFuture: [],
    }));

    const res = await window.api?.setVerdict({ ids, flag: patch.flag, rating: patch.rating });
    if (!res?.ok) {
      // Revert the optimistic update.
      const reverted = entries
        .map((e) => {
          const current = get().records.get(e.id);
          return current ? { ...current, user: { ...e.user } } : null;
        })
        .filter((a): a is AssetRecord => Boolean(a));
      set((s) => ({
        records: mergeIntoMap(s.records, reverted),
        undoPast: s.undoPast.slice(0, -1),
        notice: { kind: "error", text: res?.error ?? "Could not save verdict" },
      }));
    }
  },

  undo: async () => {
    const { undoPast, records } = get();
    const entry = undoPast[undoPast.length - 1];
    if (!entry) return;
    const redoEntry: UndoEntry = {
      entries: entry.entries
        .map((e) => records.get(e.id))
        .filter((a): a is AssetRecord => Boolean(a))
        .map((a) => ({ id: a.id, user: { flag: a.user.flag, rating: a.user.rating } })),
    };
    const restored = entry.entries
      .map((e): AssetRecord | null => {
        const current = records.get(e.id);
        return current ? { ...current, user: { ...e.user, at: new Date().toISOString() } } : null;
      })
      .filter((a): a is AssetRecord => a !== null);
    set((s) => ({
      records: mergeIntoMap(s.records, restored),
      undoPast: s.undoPast.slice(0, -1),
      undoFuture: [redoEntry, ...s.undoFuture.slice(0, 49)],
    }));
    await window.api?.restoreVerdicts(entry.entries);
  },

  redo: async () => {
    const { undoFuture, records } = get();
    const entry = undoFuture[0];
    if (!entry) return;
    const undoEntry: UndoEntry = {
      entries: entry.entries
        .map((e) => records.get(e.id))
        .filter((a): a is AssetRecord => Boolean(a))
        .map((a) => ({ id: a.id, user: { flag: a.user.flag, rating: a.user.rating } })),
    };
    const restored = entry.entries
      .map((e): AssetRecord | null => {
        const current = records.get(e.id);
        return current ? { ...current, user: { ...e.user, at: new Date().toISOString() } } : null;
      })
      .filter((a): a is AssetRecord => a !== null);
    set((s) => ({
      records: mergeIntoMap(s.records, restored),
      undoFuture: s.undoFuture.slice(1),
      undoPast: [...s.undoPast.slice(-49), undoEntry],
    }));
    await window.api?.restoreVerdicts(entry.entries);
  },

  runSearch: async (query) => {
    const q = query.trim();
    set({ searchQuery: query });
    if (!q) {
      set({ searchResults: null, searchMode: null, searching: false });
      return;
    }
    set({ searching: true });
    const res = await window.api?.search({ query: q });
    if (get().searchQuery.trim() !== q) return; // stale response
    if (res?.ok && res.result) {
      const ids = res.result.results.map((r) => r.assetId);
      const recordsRes = ids.length > 0 ? await window.api?.getAssets(ids) : undefined;
      set((s) => ({
        searchResults: res.result?.results ?? [],
        searchMode: res.result?.mode ?? null,
        searching: false,
        records: recordsRes?.ok && recordsRes.result ? mergeIntoMap(s.records, recordsRes.result) : s.records,
        selected: new Set(),
      }));
    } else {
      set({ searching: false, notice: { kind: "error", text: res?.error ?? "Search failed" } });
    }
  },
  clearSearch: () => set({ searchQuery: "", searchResults: null, searchMode: null, searching: false }),

  loadQueues: async () => {
    set({ loadingQueues: true });
    const res = await window.api?.reviewQueues();
    if (res?.ok && res.result) {
      const queues = res.result;
      set((s) => ({
        queues,
        loadingQueues: false,
        records: mergeIntoMap(s.records, [
          ...queues["sure-reject"],
          ...queues["sure-keep"],
          ...queues["needs-eye"],
        ]),
      }));
    } else {
      set({ loadingQueues: false });
    }
  },

  setTask: (name, patch) =>
    set((s) => ({ tasks: { ...s.tasks, [name]: { ...s.tasks[name], ...patch } } })),

  mergeRecords: (assets) => set((s) => ({ records: mergeIntoMap(s.records, assets) })),

  importSources: async (paths) => {
    if (paths.length === 0 || get().tasks.import.running) return;
    get().setTask("import", { running: true, phase: "starting", progress: 0 });
    const result = await window.api?.startImport(paths);
    get().setTask("import", { running: false, phase: "", progress: 0 });
    if (result?.ok) {
      let text = "Import finished.";
      try {
        const stats = JSON.parse(result.output ?? "{}");
        text = `Imported ${stats.copied ?? 0} files${
          stats.duplicates ? ` (${stats.duplicates} already in library)` : ""
        }${stats.failed ? `, ${stats.failed} failed` : ""}.`;
      } catch {
        // banner text is best-effort
      }
      set({ notice: { kind: "info", text } });
    } else {
      set({ notice: { kind: "error", text: result?.error ?? "Import failed" } });
    }
    await get().refreshLibrary();
  },
}));

// Apply the persisted/system theme to <html> before the first paint. Don't
// persist here, so a system-derived default keeps following the OS until the
// user makes an explicit choice via the toggle.
applyTheme(useKeeper.getState().theme, false);
