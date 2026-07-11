import { useEffect, useState } from "react";
import type { UserFlag } from "@keeper/schema";
import { Button, Icon } from "./ui";
import { useKeeper } from "../store";
import { formatBytes } from "../lib/format";

const FLAG_FILTERS: { key: UserFlag | "all"; label: string }[] = [
  { key: "all", label: "All media" },
  { key: "unrated", label: "Unrated" },
  { key: "pick", label: "Picks" },
  { key: "reject", label: "Rejected" },
];

export function LeftRail(): JSX.Element {
  const summary = useKeeper((s) => s.summary);
  const filter = useKeeper((s) => s.filter);
  const setFilter = useKeeper((s) => s.setFilter);
  const setModal = useKeeper((s) => s.setModal);
  const setView = useKeeper((s) => s.setView);
  const setNotice = useKeeper((s) => s.setNotice);
  const judgeTask = useKeeper((s) => s.tasks.judge);
  const reprocessTask = useKeeper((s) => s.tasks.reprocess);
  const setTask = useKeeper((s) => s.setTask);
  const refreshLibrary = useKeeper((s) => s.refreshLibrary);

  const [judgeInfo, setJudgeInfo] = useState<{ configured: boolean; model: string } | null>(null);
  useEffect(() => {
    void window.api?.judgeInfo().then((info) => {
      if (info?.ok) setJudgeInfo({ configured: info.configured, model: info.model });
    });
  }, []);

  const counts = summary?.counts;

  const countFor = (key: UserFlag | "all"): number => {
    if (!counts) return 0;
    switch (key) {
      case "all":
        return counts.total;
      case "unrated":
        return counts.unrated;
      case "pick":
        return counts.picks;
      case "reject":
        return counts.rejects;
      default: {
        const exhaustive: never = key;
        return exhaustive;
      }
    }
  };

  const runJudge = async () => {
    setTask("judge", { running: true, phase: "starting", progress: 0 });
    const result = await window.api?.startJudge();
    setTask("judge", { running: false, phase: "", progress: 0 });
    if (result?.ok) {
      let text = "AI review finished.";
      try {
        const stats = JSON.parse(result.output ?? "{}");
        text = `AI reviewed ${stats.judged ?? 0} borderline items.`;
      } catch {
        // banner is best-effort
      }
      setNotice({ kind: "info", text });
      await refreshLibrary();
      setView("review");
    } else {
      setNotice({ kind: "error", text: result?.error ?? "AI review failed" });
    }
  };

  const runReprocess = async () => {
    setTask("reprocess", { running: true, phase: "starting", progress: 0 });
    const result = await window.api?.startReprocess("all");
    setTask("reprocess", { running: false, phase: "", progress: 0 });
    setNotice(
      result?.ok
        ? { kind: "info", text: "Reprocess finished." }
        : { kind: "error", text: result?.error ?? "Reprocess failed" },
    );
    await refreshLibrary();
  };

  return (
    <aside className="left-rail">
      <div className="rail-section">
        <div className="rail-heading">Filter</div>
        {FLAG_FILTERS.map(({ key, label }) => (
          <button
            key={key}
            className={`rail-item ${(filter.flag ?? "all") === key ? "active" : ""}`}
            onClick={() => setFilter({ flag: key === "all" ? undefined : key })}
          >
            <span>{label}</span>
            <span className="rail-count">{countFor(key).toLocaleString()}</span>
          </button>
        ))}
      </div>

      <div className="rail-section">
        <div className="rail-heading">Type</div>
        {(
          [
            { key: undefined, label: "Everything", icon: "multi-media" },
            { key: "photo", label: "Photos", icon: "form-square" },
            { key: "video", label: "Videos", icon: "play-circle" },
          ] as const
        ).map(({ key, label, icon }) => (
          <button
            key={label}
            className={`rail-item ${filter.mediaType === key ? "active" : ""}`}
            onClick={() => setFilter({ mediaType: key })}
          >
            <Icon name={icon} size={14} />
            <span>{label}</span>
          </button>
        ))}
      </div>

      <div className="rail-section">
        <div className="rail-heading">AI</div>
        <Button
          variant="secondary"
          size="sm"
          icon="magic-wand"
          disabled={!judgeInfo?.configured || judgeTask.running}
          onClick={() => void runJudge()}
          title={judgeInfo?.configured ? `Judge borderline items with ${judgeInfo.model}` : "Add an API key in Settings → AI"}
        >
          {judgeTask.running ? judgeTask.phase || "Reviewing…" : "AI review"}
        </Button>
        {judgeTask.running && (
          <div className="rail-progress">
            <span className="rail-progress-fill" style={{ width: `${judgeTask.progress}%` }} />
          </div>
        )}
        {!judgeInfo?.configured && (
          <div className="rail-hint">Runs fully offline today. Add a key in Settings to enable AI judgment.</div>
        )}
        <button className="rail-item" onClick={() => setModal("taste")}>
          <Icon name="prompt" size={14} />
          <span>Taste profile</span>
        </button>
        <button className="rail-item" onClick={() => void runReprocess()} disabled={reprocessTask.running}>
          <Icon name="arrow-rotate" size={14} />
          <span>{reprocessTask.running ? reprocessTask.phase || "Reprocessing…" : "Reprocess library"}</span>
        </button>
      </div>

      <div className="rail-section rail-bottom">
        <button className="rail-item danger" onClick={() => setModal("rejects")}>
          <Icon name="trash-can" size={14} />
          <span>Empty rejects…</span>
        </button>
        {counts && (
          <div className="rail-hint">
            {counts.total.toLocaleString()} items · {formatBytes(counts.bytes)}
            {summary && !summary.modelCached && counts.total > 0 && (
              <>
                <br />
                Search index: {summary.embeddings}/{counts.total}
              </>
            )}
          </div>
        )}
        <button className="rail-item" onClick={() => void window.api?.revealLibrary()}>
          <Icon name="finder" size={14} />
          <span>Show library in Finder</span>
        </button>
      </div>
    </aside>
  );
}
