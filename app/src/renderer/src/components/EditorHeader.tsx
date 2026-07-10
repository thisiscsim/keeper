import { useEffect, useRef, useState } from "react";
import { useEditor } from "../store";
import { SettingsButton } from "./SettingsModal";
import { Button, Icon, IconButton, useEscapeKey } from "./ui";
import { VISUAL_STYLES, getVisualStyle } from "../styles/visual-styles";

export function EditorHeader(): JSX.Element {
  const edl = useEditor((s) => s.edl);
  const slug = useEditor((s) => s.slug);
  const meta = useEditor((s) => s.meta);
  const exporting = useEditor((s) => s.exporting);
  const startExport = useEditor((s) => s.startExport);
  const setExportProgress = useEditor((s) => s.setExportProgress);
  const setExportPhase = useEditor((s) => s.setExportPhase);
  const finishExport = useEditor((s) => s.finishExport);
  const goHome = useEditor((s) => s.goHome);
  const canUndo = useEditor((s) => s.edlPast.length > 0);
  const canRedo = useEditor((s) => s.edlFuture.length > 0);
  const undoEdl = useEditor((s) => s.undoEdl);
  const redoEdl = useEditor((s) => s.redoEdl);

  const onExport = async () => {
    if (!slug || exporting) return;
    startExport();
    const offProgress = window.api.onExportProgress(setExportProgress);
    const offPhase = window.api.onExportPhase(setExportPhase);
    try {
      const res = await window.api.exportProject(slug);
      finishExport(res);
    } finally {
      offProgress();
      offPhase();
    }
  };

  const title = meta?.title || slug || "Untitled";

  return (
    <header className="editor-header">
      <div className="editor-header-left">
        <button className="brand" onClick={goHome} title="Back to projects">
          <Icon name="aperture-logomark" size={20} />
          <span className="home-wordmark">Keeper</span>
        </button>
      </div>

      <div className="editor-header-title">
        <span>
          {title}
          <span className="ext">.keeper</span>
        </span>
      </div>

      <div className="editor-header-actions">
        <IconButton icon="step-back" label="Undo (⌘Z)" disabled={!canUndo} onClick={undoEdl} />
        <IconButton icon="step-forwards" label="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redoEdl} />
        <span className="editor-divider" />
        <SettingsButton />
        <span className="editor-divider" />
        <PresetsMenu />
        <span className="editor-divider" />
        <Button variant="primary" size="sm" icon="share-os" onClick={onExport} disabled={exporting || !edl}>
          {exporting ? "Exporting…" : "Export"}
        </Button>
      </div>
    </header>
  );
}

function PresetsMenu(): JSX.Element {
  const updateEdl = useEditor((s) => s.updateEdl);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEscapeKey(open ? () => setOpen(false) : null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const apply = (id: string) => {
    const preset = getVisualStyle(id);
    if (!preset) return;
    updateEdl((d) => {
      d.theme.stylePreset = preset.id;
      d.theme.fontFamily = preset.fontFamily;
      d.theme.palette = [...preset.palette];
      d.theme.captionStyle = preset.captionStyle;
    });
    setOpen(false);
  };

  return (
    <div className="presets-wrap" ref={wrapRef}>
      <Button variant="ghost" size="sm" icon="magic-wand" onClick={() => setOpen((v) => !v)}>
        Presets
      </Button>
      {open && (
        <div className="presets-menu" role="menu">
          {VISUAL_STYLES.map((s) => (
            <button key={s.id} className="presets-item" onClick={() => apply(s.id)}>
              <span className="name">{s.name}</span>
              <span className="hint">{s.inspiration}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
