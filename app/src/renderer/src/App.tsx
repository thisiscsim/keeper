import { useEffect } from "react";
import { Header } from "./components/Header";
import { LeftRail } from "./components/LeftRail";
import { LibraryGrid } from "./components/LibraryGrid";
import { Loupe } from "./components/Loupe";
import { ReviewMode } from "./components/ReviewMode";
import { SettingsModal } from "./components/SettingsModal";
import { ExportModal } from "./components/ExportModal";
import { RejectsModal } from "./components/RejectsModal";
import { TasteModal } from "./components/TasteModal";
import { useKeeper } from "./store";

function isTypingContext(target: EventTarget | null): boolean {
  const t = target as HTMLElement | null;
  if (!t) return false;
  return t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable;
}

export function App(): JSX.Element {
  const view = useKeeper((s) => s.view);
  const activeId = useKeeper((s) => s.activeId);
  const modal = useKeeper((s) => s.modal);
  const notice = useKeeper((s) => s.notice);
  const setNotice = useKeeper((s) => s.setNotice);
  const refreshLibrary = useKeeper((s) => s.refreshLibrary);
  const setTask = useKeeper((s) => s.setTask);

  // Initial load + live refresh when scripts/agents write to the library.
  useEffect(() => {
    void refreshLibrary();
    const off = window.api?.onLibraryChanged(() => void refreshLibrary());
    return () => off?.();
  }, [refreshLibrary]);

  // Stream task progress (import/judge/export/reprocess) into the store.
  useEffect(() => {
    const offs: (() => void)[] = [];
    for (const name of ["import", "judge", "export", "reprocess"] as const) {
      const offPhase = window.api?.onPhase(name, (phase) => setTask(name, { running: true, phase }));
      const offProgress = window.api?.onProgress(name, (progress) => setTask(name, { running: true, progress }));
      if (offPhase) offs.push(offPhase);
      if (offProgress) offs.push(offProgress);
    }
    return () => offs.forEach((off) => off());
  }, [setTask]);

  // Drop files/folders anywhere in the window to import them.
  useEffect(() => {
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      const paths = files
        .map((f) => window.api?.getPathForFile(f))
        .filter((p): p is string => Boolean(p));
      if (paths.length > 0) void useKeeper.getState().importSources(paths);
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // All app-wide shortcuts live here (never inside components that unmount).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useKeeper.getState();

      // Cmd+Z / Shift+Cmd+Z — verdict history.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
        if (isTypingContext(e.target)) return;
        e.preventDefault();
        if (e.shiftKey) void s.redo();
        else void s.undo();
        return;
      }

      // Cmd+F — focus the search field.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        document.querySelector<HTMLInputElement>(".search-input")?.focus();
        return;
      }

      if (isTypingContext(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;

      // T — theme toggle.
      if (e.key.toLowerCase() === "t" && !e.shiftKey) {
        s.toggleTheme();
        return;
      }

      // Culling verdicts apply to the selection (or the loupe asset).
      const targets = s.selectionOr(null);
      const key = e.key.toLowerCase();
      if (key === "p" || key === "k") {
        if (targets.length > 0) void s.setVerdict(targets, { flag: "pick" });
        return;
      }
      if (key === "x" || key === "r") {
        if (targets.length > 0) void s.setVerdict(targets, { flag: "reject" });
        return;
      }
      if (key === "u") {
        if (targets.length > 0) void s.setVerdict(targets, { flag: "unrated" });
        return;
      }
      if (/^[0-5]$/.test(e.key)) {
        if (targets.length > 0) void s.setVerdict(targets, { rating: Number(e.key) });
        return;
      }

      // Space — open/close the loupe on the current selection.
      if (e.code === "Space") {
        e.preventDefault();
        if (s.activeId) s.closeLoupe();
        else if (targets.length > 0) s.openLoupe(targets[0]);
        return;
      }

      // Arrows — navigate the loupe (grid navigation is mouse-driven).
      if (s.activeId && (e.key === "ArrowRight" || e.key === "ArrowLeft")) {
        e.preventDefault();
        s.navLoupe(e.key === "ArrowRight" ? 1 : -1);
        return;
      }

      if (e.key === "Escape") {
        if (s.activeId) s.closeLoupe();
        else s.clearSelection();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app-shell">
      <Header />
      <div className="app-main">
        <LeftRail />
        {view === "library" ? <LibraryGrid /> : <ReviewMode />}
      </div>
      {activeId && <Loupe />}
      {modal === "settings" && <SettingsModal />}
      {modal === "export" && <ExportModal />}
      {modal === "rejects" && <RejectsModal />}
      {modal === "taste" && <TasteModal />}
      {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
    </div>
  );
}

function Toast({
  notice,
  onClose,
}: {
  notice: { kind: "error" | "info"; text: string };
  onClose: () => void;
}): JSX.Element {
  useEffect(() => {
    const t = setTimeout(onClose, 8000);
    return () => clearTimeout(t);
  }, [onClose]);
  return (
    <div className={`toast toast-${notice.kind}`} onClick={onClose}>
      {notice.text}
    </div>
  );
}
