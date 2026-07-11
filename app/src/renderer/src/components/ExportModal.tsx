import { useState } from "react";
import { Button, Field, Modal } from "./ui";
import { useKeeper } from "../store";

/**
 * Export selects: copy picks (or the current selection) to a folder with XMP
 * sidecars Lightroom/Capture One read natively, or write sidecars in place.
 */
export function ExportModal(): JSX.Element {
  const setModal = useKeeper((s) => s.setModal);
  const selected = useKeeper((s) => s.selected);
  const summary = useKeeper((s) => s.summary);
  const setNotice = useKeeper((s) => s.setNotice);
  const exportTask = useKeeper((s) => s.tasks.export);
  const setTask = useKeeper((s) => s.setTask);

  const [scope, setScope] = useState<"picks" | "selection">(selected.size > 0 ? "selection" : "picks");
  const [xmp, setXmp] = useState(true);
  const [running, setRunning] = useState(false);

  const picksCount = summary?.counts.picks ?? 0;
  const count = scope === "selection" ? selected.size : picksCount;

  const run = async (inPlace: boolean) => {
    let dest: string | undefined;
    if (!inPlace) {
      const picked = await window.api?.pickExportDest();
      if (!picked?.ok || picked.canceled || !picked.dest) return;
      dest = picked.dest;
    }
    setRunning(true);
    setTask("export", { running: true, phase: "starting", progress: 0 });
    const result = await window.api?.runExport({
      dest,
      inPlace,
      xmp,
      ids: scope === "selection" ? [...selected] : undefined,
    });
    setTask("export", { running: false, phase: "", progress: 0 });
    setRunning(false);
    if (result?.ok) {
      let text = "Export finished.";
      try {
        const stats = JSON.parse(result.output ?? "{}");
        text = inPlace
          ? `Wrote ${stats.sidecars ?? 0} XMP sidecars into the library.`
          : `Exported ${stats.exported ?? 0} files${stats.sidecars ? ` + ${stats.sidecars} sidecars` : ""}.`;
      } catch {
        // banner is best-effort
      }
      setNotice({ kind: "info", text });
      if (dest) void window.api?.openExportDest(dest);
      setModal(null);
    } else {
      setNotice({ kind: "error", text: result?.error ?? "Export failed" });
    }
  };

  return (
    <Modal
      title="Export selects"
      onClose={() => !running && setModal(null)}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={() => setModal(null)} disabled={running}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => void run(true)} disabled={running || count === 0}>
            Write XMP in place
          </Button>
          <Button variant="primary" onClick={() => void run(false)} disabled={running || count === 0}>
            {running ? exportTask.phase || "Exporting…" : `Export ${count.toLocaleString()} to folder…`}
          </Button>
        </>
      }
    >
      <Field label="What to export">
        <div className="radio-row">
          <label className="radio-option">
            <input type="radio" checked={scope === "picks"} onChange={() => setScope("picks")} />
            All picks ({picksCount.toLocaleString()})
          </label>
          <label className="radio-option">
            <input
              type="radio"
              checked={scope === "selection"}
              onChange={() => setScope("selection")}
              disabled={selected.size === 0}
            />
            Current selection ({selected.size.toLocaleString()})
          </label>
        </div>
      </Field>
      <Field label="Metadata">
        <label className="radio-option">
          <input type="checkbox" checked={xmp} onChange={(e) => setXmp(e.target.checked)} />
          Write .xmp sidecars (ratings, flags, keywords — read by Lightroom, Capture One, Bridge)
        </label>
      </Field>
      <p className="modal-hint">
        RAW originals travel with their JPEG twins, and Live Photos bring their video halves. “Write XMP in
        place” adds sidecars next to the originals inside your library instead of copying — point Lightroom at
        the library folder (or an Aperture project's assets folder as the export target) and your verdicts come
        along.
      </p>
    </Modal>
  );
}
