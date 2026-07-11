import { useEffect, useState } from "react";
import { Button, Modal } from "./ui";
import { useKeeper } from "../store";
import { formatBytes } from "../lib/format";

/**
 * The only destructive flow in the app, deliberately two-step: review the
 * count + size, arm the button, then confirm. Originals go to the OS trash
 * (recoverable), never straight to deletion. The AI cannot reach this path.
 */
export function RejectsModal(): JSX.Element {
  const setModal = useKeeper((s) => s.setModal);
  const setNotice = useKeeper((s) => s.setNotice);
  const refreshLibrary = useKeeper((s) => s.refreshLibrary);

  const [summary, setSummary] = useState<{ count: number; bytes: number; ids: string[] } | null>(null);
  const [armed, setArmed] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    void window.api?.rejectsSummary().then((res) => {
      if (res?.ok && res.result) setSummary(res.result);
    });
  }, []);

  const empty = async () => {
    if (!summary || summary.ids.length === 0) return;
    setWorking(true);
    const result = await window.api?.emptyRejects(summary.ids);
    setWorking(false);
    if (result?.ok) {
      setNotice({ kind: "info", text: `Moved ${result.trashed ?? 0} files to the system Trash.` });
      setModal(null);
      await refreshLibrary();
    } else {
      setNotice({ kind: "error", text: result?.error ?? "Could not empty rejects" });
    }
  };

  return (
    <Modal
      title="Empty rejects"
      onClose={() => !working && setModal(null)}
      width={420}
      footer={
        <>
          <Button variant="ghost" onClick={() => setModal(null)} disabled={working}>
            Cancel
          </Button>
          {!armed ? (
            <Button variant="secondary" onClick={() => setArmed(true)} disabled={!summary || summary.count === 0}>
              Continue…
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void empty()} disabled={working}>
              {working ? "Moving to Trash…" : `Move ${summary?.count.toLocaleString()} files to Trash`}
            </Button>
          )}
        </>
      }
    >
      {!summary ? (
        <p>Checking rejects…</p>
      ) : summary.count === 0 ? (
        <p>No rejected files. Reject photos with X (or accept the AI's sure rejects in Review) first.</p>
      ) : (
        <>
          <p>
            <strong>{summary.count.toLocaleString()} rejected files</strong> ({formatBytes(summary.bytes)}) will be
            moved to the system Trash, along with their RAW/Live Photo siblings and sidecars.
          </p>
          <p className="modal-hint">
            Nothing is permanently deleted — you can restore from the Trash. Keeper never deletes anything on its
            own; only files you rejected are listed here.
          </p>
        </>
      )}
    </Modal>
  );
}
