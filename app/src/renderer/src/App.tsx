import { type CSSProperties, useEffect } from "react";
import { EditorHeader } from "./components/EditorHeader";
import { LeftRail } from "./components/LeftRail";
import { PreviewStage } from "./components/PreviewStage";
import { RightPanel } from "./components/RightPanel";
import { Timeline } from "./components/Timeline";
import { ExportModal } from "./components/ExportModal";
import { Home } from "./components/Home";
import { useEditor, type PanelId } from "./store";

export function App(): JSX.Element {
  const view = useEditor((s) => s.view);
  const slug = useEditor((s) => s.slug);
  const edl = useEditor((s) => s.edl);
  const loadError = useEditor((s) => s.loadError);
  const notice = useEditor((s) => s.notice);
  const setNotice = useEditor((s) => s.setNotice);
  const setProject = useEditor((s) => s.setProject);
  const setLoadError = useEditor((s) => s.setLoadError);
  const setReload = useEditor((s) => s.setReload);
  const undoEdl = useEditor((s) => s.undoEdl);
  const redoEdl = useEditor((s) => s.redoEdl);
  const toggleTheme = useEditor((s) => s.toggleTheme);
  const panelSizes = useEditor((s) => s.panelSizes);
  const panelsHidden = useEditor((s) => s.panelsHidden);
  const togglePanels = useEditor((s) => s.togglePanels);
  const playerCtl = useEditor((s) => s.playerCtl);

  // Space toggles playback anywhere in the editor outside a text field —
  // including Cmd+\ focus mode, where the timeline (and its transport) is
  // unmounted.
  useEffect(() => {
    if (view !== "editor") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) return;
      e.preventDefault();
      playerCtl?.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, playerCtl]);

  // Cmd+\ — focus mode: hide rails + timeline, keep only the canvas (Figma-style).
  useEffect(() => {
    if (view !== "editor") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "\\" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        togglePanels();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, togglePanels]);

  // 'T' toggles light/dark anywhere, unless the user is typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== "t" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable) return;
      toggleTheme();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTheme]);

  // Cmd+Z / Shift+Cmd+Z for EDL history. Text fields keep their native undo.
  useEffect(() => {
    if (view !== "editor") return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      e.preventDefault();
      if (e.shiftKey) redoEdl();
      else undoEdl();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, undoEdl, redoEdl]);

  // Load (and live-reload) the active project whenever we enter the editor.
  useEffect(() => {
    if (view !== "editor" || !slug) return;

    // Returns the load promise so busy flows (Generate/Auto-improve) can keep
    // their loading state up until the fresh cut is actually in the store.
    const load = () =>
      window.api
        ?.loadProject(slug)
        .then((res) => {
          if (res.ok && res.edl) {
            setProject({ edl: res.edl, slug: res.slug, dir: res.dir, promptText: res.promptText, meta: res.meta });
          } else {
            setLoadError((res.errors ?? ["unknown error"]).join("; "));
          }
        })
        .catch((err) => setLoadError(String(err)));
    setReload(load);
    load();

    void window.api?.watchProject(slug);
    const off = window.api?.onProjectChanged((changed) => {
      if (changed === slug) load();
    });
    return () => off?.();
  }, [view, slug, setProject, setLoadError, setReload]);

  return (
    <>
      {view === "home" ? (
        <Home />
      ) : (
        <div
          className={`editor-shell ${panelsHidden ? "panels-hidden" : ""}`}
          style={
            {
              "--left-rail-w": `${panelSizes.left}px`,
              "--right-panel-w": `${panelSizes.right}px`,
              "--tl-h": `${panelSizes.timeline}px`,
            } as CSSProperties
          }
        >
          <EditorHeader />
          <div className="editor-main">
            {!panelsHidden && (
              <>
                <LeftRail />
                <PanelResizer panel="left" />
              </>
            )}
            <PreviewStage />
            {!panelsHidden && (
              <>
                <PanelResizer panel="right" />
                <RightPanel />
              </>
            )}
          </div>
          {!panelsHidden && (
            <>
              <PanelResizer panel="timeline" />
              <Timeline />
            </>
          )}
          <ExportModal />
          {!edl && (
            <div className="boot">
              {loadError ? `Could not load project: ${loadError}` : "Loading project…"}
            </div>
          )}
        </div>
      )}
      {notice && <Toast notice={notice} onClose={() => setNotice(null)} />}
    </>
  );
}

/**
 * Slim drag handle between panels. Left/right resize widths, timeline resizes
 * height; all are clamped in the store (PANEL_LIMITS) and persisted.
 */
function PanelResizer({ panel }: { panel: PanelId }): JSX.Element {
  const setPanelSize = useEditor((s) => s.setPanelSize);
  const horizontal = panel === "timeline";

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = useEditor.getState().panelSizes[panel];
    const el = e.currentTarget;
    el.classList.add("active");
    document.body.style.cursor = horizontal ? "row-resize" : "col-resize";

    const onMove = (ev: MouseEvent) => {
      if (panel === "left") setPanelSize("left", start + (ev.clientX - startX));
      else if (panel === "right") setPanelSize("right", start - (ev.clientX - startX));
      else setPanelSize("timeline", start - (ev.clientY - startY));
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      el.classList.remove("active");
      document.body.style.cursor = "";
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className={`panel-resizer ${horizontal ? "horizontal" : "vertical"}`}
      onMouseDown={onMouseDown}
      role="separator"
      aria-orientation={horizontal ? "horizontal" : "vertical"}
    />
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
