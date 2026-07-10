import { useEditor } from "../store";
import { useEscapeKey } from "./ui/useEscapeKey";

const PHASE_LABELS: Record<string, string> = {
  preparing: "Preparing renderer…",
  bundling: "Bundling composition…",
  composition: "Resolving composition…",
  rendering: "Rendering frames…",
};

export function ExportModal(): JSX.Element | null {
  const exporting = useEditor((s) => s.exporting);
  const progress = useEditor((s) => s.exportProgress);
  const phase = useEditor((s) => s.exportPhase);
  const result = useEditor((s) => s.exportResult);
  const close = useEditor((s) => s.closeExport);

  // Escape dismisses only once a result is shown — an in-flight export is not
  // cancellable from this modal, so it must not be dismissable mid-render.
  useEscapeKey(result ? close : null);

  if (!exporting && !result) return null;

  return (
    <div className="modal-overlay">
      <div className="modal">
        {exporting && (
          <>
            <div className="modal-title">Exporting video</div>
            <div className="modal-phase">{PHASE_LABELS[phase] ?? "Working…"}</div>
            <div className="bar lg">
              <div className="bar-fill" style={{ width: `${progress}%` }} />
            </div>
            <div className="muted small">{progress}%</div>
          </>
        )}

        {result?.ok && (
          <>
            <div className="modal-title">Export complete</div>
            <div className="muted small break">{result.output}</div>
            <div className="modal-actions">
              <button className="btn" onClick={close}>
                Close
              </button>
              <button
                className="btn btn-primary"
                onClick={() => result.output && window.api.revealItem(result.output)}
              >
                Reveal in Finder
              </button>
            </div>
          </>
        )}

        {result && !result.ok && (
          <>
            <div className="modal-title">Export failed</div>
            <div className="muted small break">{result.error}</div>
            <div className="modal-actions">
              <button className="btn" onClick={close}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
