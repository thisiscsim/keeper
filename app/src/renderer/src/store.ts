import { create } from "zustand";
import type { Edl, Meta } from "@reel/edl";
import type { ProjectSummary } from "../../preload";

export type RightTab = "inspector" | "style" | "critique";
export type Theme = "dark" | "light";
export type View = "home" | "editor";

const THEME_KEY = "keeper:theme";
const LAYOUT_KEY = "keeper:panel-layout";

export type PanelId = "left" | "right" | "timeline";
/** Resize clamps: [min, max] px. Left/right are widths, timeline is height. */
export const PANEL_LIMITS: Record<PanelId, [number, number]> = {
  left: [220, 440],
  right: [240, 440],
  timeline: [160, 440],
};
const PANEL_DEFAULTS: Record<PanelId, number> = { left: 300, right: 300, timeline: 240 };

function initialPanelSizes(): Record<PanelId, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? "{}") as Partial<Record<PanelId, number>>;
    const out = { ...PANEL_DEFAULTS };
    for (const id of ["left", "right", "timeline"] as PanelId[]) {
      const v = saved[id];
      if (typeof v === "number" && Number.isFinite(v)) {
        out[id] = Math.min(Math.max(v, PANEL_LIMITS[id][0]), PANEL_LIMITS[id][1]);
      }
    }
    return out;
  } catch {
    return { ...PANEL_DEFAULTS };
  }
}

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

// Animate theme switches with the View Transitions API (Chromium): the browser
// snapshots the old frame and cross-fades to the new one, so every surface
// changes in one coherent sweep. Falls back to an instant switch (e.g. jsdom).
function withViewTransition(mutate: () => void): void {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition === "function") doc.startViewTransition(mutate);
  else mutate();
}

// Debounced persistence of edits back to projects/<slug>/edl.json. Editor edits
// mutate the in-memory EDL immediately; we flush to disk shortly after so the
// agent/renderer (which re-read the file) see the same source of truth.
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleSave(slug: string | null, edl: Edl): void {
  if (!slug) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void window.api?.saveEdl(slug, edl);
  }, 400);
}

export interface ExportResult {
  ok: boolean;
  output?: string;
  error?: string;
}

interface EditorState {
  view: View;
  projects: ProjectSummary[];
  edl: Edl | null;
  slug: string | null;
  dir: string | null;
  promptText: string;
  meta: Meta | null;
  loadError: string | null;

  selectedClipId: string | null;
  currentFrame: number;
  rightTab: RightTab;
  theme: Theme;
  seek: (frame: number) => void;
  playing: boolean;
  muted: boolean;
  playerCtl: { toggle: () => void; setMuted: (m: boolean) => void } | null;
  panelSizes: Record<PanelId, number>;
  /** Cmd+\ focus mode: hide the rails + timeline, keep only the canvas. */
  panelsHidden: boolean;

  exporting: boolean;
  exportProgress: number;
  exportPhase: string;
  exportResult: ExportResult | null;

  generating: boolean;
  autotuning: boolean;
  notice: { kind: "error" | "info"; text: string } | null;
  /** Returns a promise so callers can hold busy state until the load lands. */
  reloadProject: () => void | Promise<void>;

  setView: (view: View) => void;
  setProjects: (projects: ProjectSummary[]) => void;
  openProject: (slug: string) => void;
  goHome: () => void;
  setProject: (p: {
    edl: Edl;
    slug?: string | null;
    dir?: string | null;
    promptText?: string;
    meta?: Meta | null;
  }) => void;
  setPromptText: (text: string) => void;
  setLoadError: (msg: string | null) => void;
  updateEdl: (mutate: (edl: Edl) => void) => void;
  edlPast: Edl[];
  edlFuture: Edl[];
  undoEdl: () => void;
  redoEdl: () => void;
  saveNow: () => Promise<void>;
  select: (id: string | null) => void;
  setCurrentFrame: (frame: number) => void;
  setRightTab: (tab: RightTab) => void;
  setSeek: (fn: (frame: number) => void) => void;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  setPlaying: (v: boolean) => void;
  toggleMuted: () => void;
  setPlayerCtl: (ctl: { toggle: () => void; setMuted: (m: boolean) => void } | null) => void;
  setPanelSize: (panel: PanelId, px: number) => void;
  togglePanels: () => void;

  startExport: () => void;
  setExportProgress: (pct: number) => void;
  setExportPhase: (phase: string) => void;
  finishExport: (result: ExportResult) => void;
  closeExport: () => void;

  setGenerating: (value: boolean) => void;
  setAutotuning: (value: boolean) => void;
  setNotice: (notice: { kind: "error" | "info"; text: string } | null) => void;
  setReload: (fn: () => void | Promise<void>) => void;
}

export const useEditor = create<EditorState>()((set, get) => ({
  view: "home",
  projects: [],
  edl: null,
  slug: null,
  dir: null,
  promptText: "",
  meta: null,
  loadError: null,

  selectedClipId: null,
  currentFrame: 0,
  rightTab: "inspector",
  theme: initialTheme(),
  seek: () => {},
  playing: false,
  muted: false,
  playerCtl: null,
  panelSizes: initialPanelSizes(),
  panelsHidden: false,

  exporting: false,
  exportProgress: 0,
  exportPhase: "",
  exportResult: null,

  generating: false,
  autotuning: false,
  notice: null,
  reloadProject: () => {},

  setView: (view) => set({ view }),
  setProjects: (projects) => set({ projects }),
  openProject: (slug) =>
    set({
      slug,
      view: "editor",
      edl: null,
      loadError: null,
      selectedClipId: null,
      currentFrame: 0,
      playing: false,
      notice: null,
      rightTab: "inspector",
    }),
  goHome: () => set({ view: "home", selectedClipId: null }),
  setProject: (p) =>
    set({
      edl: p.edl,
      slug: p.slug ?? null,
      dir: p.dir ?? null,
      promptText: p.promptText ?? "",
      meta: p.meta ?? null,
      loadError: null,
      // External load (open/generate/auto-improve reload) resets edit history.
      edlPast: [],
      edlFuture: [],
    }),
  setPromptText: (text) => set({ promptText: text }),
  saveNow: async () => {
    const { slug, edl } = get();
    if (slug && edl) await window.api?.saveEdl(slug, edl);
  },
  setLoadError: (msg) => set({ loadError: msg }),
  edlPast: [],
  edlFuture: [],
  updateEdl: (mutate) =>
    set((s) => {
      if (!s.edl) return {};
      // updateEdl replaces the EDL (copy-on-write), so the previous object can
      // be kept on the undo stack without cloning.
      const next = structuredClone(s.edl);
      mutate(next);
      scheduleSave(s.slug, next);
      return { edl: next, edlPast: [...s.edlPast.slice(-49), s.edl], edlFuture: [] };
    }),
  undoEdl: () =>
    set((s) => {
      const prev = s.edlPast[s.edlPast.length - 1];
      if (!prev || !s.edl) return {};
      scheduleSave(s.slug, prev);
      return {
        edl: prev,
        edlPast: s.edlPast.slice(0, -1),
        edlFuture: [s.edl, ...s.edlFuture],
        selectedClipId: clipExists(prev, s.selectedClipId) ? s.selectedClipId : null,
      };
    }),
  redoEdl: () =>
    set((s) => {
      const next = s.edlFuture[0];
      if (!next || !s.edl) return {};
      scheduleSave(s.slug, next);
      return {
        edl: next,
        edlPast: [...s.edlPast, s.edl],
        edlFuture: s.edlFuture.slice(1),
        selectedClipId: clipExists(next, s.selectedClipId) ? s.selectedClipId : null,
      };
    }),
  select: (id) => set({ selectedClipId: id, rightTab: id ? "inspector" : get().rightTab }),
  setCurrentFrame: (frame) => set({ currentFrame: frame }),
  setRightTab: (tab) => set({ rightTab: tab }),
  setSeek: (fn) => set({ seek: fn }),
  setTheme: (theme) => {
    withViewTransition(() => {
      applyTheme(theme);
      set({ theme });
    });
  },
  toggleTheme: () => get().setTheme(get().theme === "dark" ? "light" : "dark"),

  setPlaying: (v) => set({ playing: v }),
  toggleMuted: () => {
    const muted = !get().muted;
    get().playerCtl?.setMuted(muted);
    set({ muted });
  },
  setPlayerCtl: (ctl) => set({ playerCtl: ctl }),
  setPanelSize: (panel, px) => {
    const [min, max] = PANEL_LIMITS[panel];
    const next = { ...get().panelSizes, [panel]: Math.round(Math.min(Math.max(px, min), max)) };
    set({ panelSizes: next });
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      // persistence is best-effort
    }
  },
  togglePanels: () => set({ panelsHidden: !get().panelsHidden }),

  startExport: () => set({ exporting: true, exportProgress: 0, exportPhase: "preparing", exportResult: null }),
  setExportProgress: (pct) => set({ exportProgress: pct }),
  setExportPhase: (phase) => set({ exportPhase: phase }),
  finishExport: (result) => set({ exporting: false, exportResult: result }),
  closeExport: () => set({ exportResult: null, exportProgress: 0, exportPhase: "" }),

  setGenerating: (value) => set({ generating: value }),
  setAutotuning: (value) => set({ autotuning: value }),
  setNotice: (notice) => set({ notice }),
  setReload: (fn) => set({ reloadProject: fn }),
}));

function clipExists(edl: Edl, id: string | null): boolean {
  if (!id) return false;
  return edl.tracks.some((t) => t.type !== "caption" && t.clips.some((c) => c.id === id));
}

// Apply the persisted/system theme to <html> before the first paint. Don't
// persist here, so a system-derived default keeps following the OS until the
// user makes an explicit choice via the toggle.
applyTheme(useEditor.getState().theme, false);
