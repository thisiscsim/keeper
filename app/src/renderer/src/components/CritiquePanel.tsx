import { useEffect, useRef, useState } from "react";
import type { Benchmarks } from "@reel/edl";
import { useEditor } from "../store";
import { critiqueEdl, type Critique } from "../lib/critique";
import { Button, Icon } from "./ui";

interface BenchItem {
  file: string;
  views?: number;
  likes?: number;
}

/**
 * Critique tab (Figma 13:1063): benchmarks section + score card; clicking the
 * card opens a Back-headed detail subflow (17:1412) with subscores, fixes, and
 * Auto-improve (purple trajectory).
 */
export function CritiquePanel(): JSX.Element {
  const edl = useEditor((s) => s.edl);
  const slug = useEditor((s) => s.slug);
  const [result, setResult] = useState<Critique | null>(null);
  const [source, setSource] = useState<"agent" | "heuristic">("heuristic");
  const [benchmarks, setBenchmarks] = useState<Benchmarks | null>(null);
  const [benchList, setBenchList] = useState<BenchItem[]>([]);
  const [phase, setPhase] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [trajectory, setTrajectory] = useState<{ iter: number; score: number; delta: string; change: string }[]>([]);
  const [aiMode, setAiMode] = useState<"llm" | "baseline">("baseline");
  const [critPhase, setCritPhase] = useState<string | null>(null);
  const [detail, setDetail] = useState(false);
  const benchInput = useRef<HTMLInputElement>(null);
  const autotuning = useEditor((s) => s.autotuning);
  const setAutotuning = useEditor((s) => s.setAutotuning);
  const reloadProject = useEditor((s) => s.reloadProject);
  const setNotice = useEditor((s) => s.setNotice);

  useEffect(() => {
    window.api?.generateMode().then((m) => setAiMode(m.mode)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!slug) return;
    window.api?.loadCritique(slug).then((c) => {
      if (c && typeof c === "object" && "score" in c) {
        setResult(c as Critique);
        setSource("agent");
      }
    });
    window.api?.loadBenchmarks(slug).then(setBenchmarks).catch(() => {});
    window.api?.listBenchmarks(slug).then(setBenchList).catch(() => {});
    window.api?.autoTuneResults(slug).then(setTrajectory).catch(() => {});
  }, [slug]);

  // Refresh trajectory + critique when an auto-improve run finishes.
  useEffect(() => {
    if (!slug || autotuning) return;
    window.api?.autoTuneResults(slug).then(setTrajectory).catch(() => {});
  }, [slug, autotuning]);

  if (!edl) return <div />;

  const pathsFrom = (files: FileList): string[] =>
    Array.from(files)
      .map((f) => {
        try {
          return window.api.getPathForFile(f);
        } catch {
          return "";
        }
      })
      .filter(Boolean);

  const addBenchmarks = async (files: FileList) => {
    if (!slug) return;
    await window.api.importBenchmarks(slug, pathsFrom(files));
    window.api.listBenchmarks(slug).then(setBenchList);
    // Re-analyze in the background so the distribution reflects the new set.
    void analyze();
  };

  const analyze = async () => {
    if (!slug || phase) return;
    setProgress(0);
    setPhase("starting");
    const offPhase = window.api.onPhase("benchmarks", setPhase);
    const offProgress = window.api.onProgress("benchmarks", setProgress);
    try {
      await window.api.analyzeBenchmarks(slug);
      const b = await window.api.loadBenchmarks(slug);
      setBenchmarks(b);
    } finally {
      offPhase();
      offProgress();
      setPhase(null);
    }
  };

  const runHeuristic = () => {
    setResult(critiqueEdl(edl, benchmarks));
    setSource("heuristic");
  };

  const runAiCritique = async () => {
    if (!slug || critPhase) return;
    setCritPhase("starting");
    const offPhase = window.api.onPhase("critique", setCritPhase);
    try {
      const res = await window.api.runCritique(slug);
      if (res.ok) {
        const c = await window.api.loadCritique(slug);
        if (c && typeof c === "object" && "score" in c) {
          setResult(c as Critique);
          setSource("agent");
        }
      } else {
        setNotice({ kind: "error", text: `Critique failed: ${res.error ?? "unknown error"}` });
      }
    } finally {
      offPhase();
      setCritPhase(null);
    }
  };

  const onAutoTune = async () => {
    if (!slug || autotuning) return;
    setAutotuning(true);
    setNotice(null);
    try {
      const res = await window.api.autoTune(slug);
      await reloadProject();
      if (!res.ok) setNotice({ kind: "error", text: `Auto-improve failed: ${res.error ?? "unknown error"}` });
    } catch (err) {
      setNotice({ kind: "error", text: `Auto-improve failed: ${String(err)}` });
    } finally {
      setAutotuning(false);
    }
  };

  /* ---------- detail subflow ---------- */
  if (detail && result) {
    const lastScore = trajectory.length ? trajectory[trajectory.length - 1].score : result.score;
    return (
      <div>
        <div className="subflow-head">
          <Button variant="secondary" size="sm" onClick={() => setDetail(false)}>
            Back
          </Button>
        </div>
        <div className="rail-body" style={{ gap: 12, paddingTop: 8 }}>
          <ScoreCard result={result} benchmarks={benchmarks} source={source} />
          <div className="crit-trajectory" title="Auto-improve trajectory">
            <div className="crit-trajectory-fill" style={{ width: `${Math.min(100, lastScore)}%` }} />
          </div>

          <div className="subscores">
            {result.subscores.map((s) => (
              <div key={s.key} className="subscore">
                <div className="subscore-top">
                  <span>{s.label}</span>
                  <span className="muted">
                    {s.score}/{s.max}
                  </span>
                </div>
                <div className="bar">
                  <div className="bar-fill" style={{ width: `${(s.score / s.max) * 100}%` }} />
                </div>
                {s.benchmark && (
                  <div className="bench-compare">
                    you {s.benchmark.yours} · your best {s.benchmark.theirs} {s.benchmark.unit}
                  </div>
                )}
              </div>
            ))}
          </div>

          {result.fixes.length > 0 && (
            <div className="fixes">
              <div className="section-h">Top fixes</div>
              <ul>
                {result.fixes.map((f, i) => (
                  <li key={i}>
                    <strong>{f.issue}.</strong> {f.fix}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Button variant="primary" size="sm" onClick={onAutoTune} disabled={autotuning} style={{ width: "100%" }}>
            {autotuning ? "Improving…" : "Auto-improve"}
          </Button>

          {trajectory.length > 0 && (
            <div className="fixes">
              <div className="section-h">Improvement history</div>
              <ul>
                {trajectory.map((t) => (
                  <li key={t.iter}>
                    <strong>{t.score}</strong> {t.delta !== "0" && <span className="muted">({t.delta})</span>} —{" "}
                    {t.change}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ---------- main tab ---------- */
  return (
    <div>
      <div className="rail-section">
        <div className="rail-head">Benchmarks</div>
        <div className="rail-body" style={{ gap: 8 }}>
          <p className="crit-summary" style={{ margin: 0 }}>
            Upload or search high-performing videos. Our critique agent scores this cut against what actually
            works for you.
          </p>
          <div className="upload-area" style={{ height: 72 }} onClick={() => benchInput.current?.click()}>
            <span className="upload-title">
              <Icon name="arrow-out-of-box" size={16} />
              Upload benchmark video(s)
            </span>
            <span className="upload-sub">Drag and drop here or click to upload</span>
          </div>
          <input
            ref={benchInput}
            type="file"
            accept="video/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addBenchmarks(e.target.files);
              e.target.value = "";
            }}
          />
          {benchList.length > 0 && (
            <div className="clip-row" title={benchList.map((b) => b.file).join(", ")}>
              <Icon name="folder-alt" size={14} />
              <span className="name">
                {benchList.length} benchmark{benchList.length === 1 ? "" : "s"}
              </span>
            </div>
          )}
          {phase && (
            <div className="crit-trajectory">
              <div className="crit-trajectory-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
          {aiMode === "llm" ? (
            <>
              <Button
                variant="primary"
                size="sm"
                onClick={runAiCritique}
                disabled={!!critPhase}
                style={{ width: "100%" }}
              >
                {critPhase ? `Critiquing… ${critPhase}` : "AI critique"}
              </Button>
              <Button variant="secondary" size="sm" onClick={runHeuristic} style={{ width: "100%" }}>
                Run heuristic
              </Button>
            </>
          ) : (
            <Button variant="primary" size="sm" onClick={runHeuristic} style={{ width: "100%" }}>
              Run heuristic
            </Button>
          )}
        </div>
      </div>

      {result && (
        <div className="rail-section">
          <div className="rail-body" style={{ paddingTop: 12 }}>
            <div
              className="crit-score-card"
              onClick={() => setDetail(true)}
              role="button"
              title="Open critique details"
            >
              <ScoreCard result={result} benchmarks={benchmarks} source={source} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ScoreCard({
  result,
  benchmarks,
  source,
}: {
  result: Critique;
  benchmarks: Benchmarks | null;
  source: "agent" | "heuristic";
}): JSX.Element {
  const compared =
    benchmarks && benchmarks.count > 0
      ? `Compared with ${benchmarks.count} video${benchmarks.count === 1 ? "" : "s"}`
      : source === "agent"
        ? "AI critique"
        : "Heuristic";
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
      <Ring score={result.score} />
      <div style={{ minWidth: 0 }}>
        <div className="crit-score-title">{verdict(result.score)}</div>
        <div className="crit-score-sub">{compared}</div>
        {result.summary && (
          <p className="crit-summary" style={{ marginTop: 6, marginBottom: 0 }}>
            {result.summary}
          </p>
        )}
      </div>
    </div>
  );
}

function verdict(score: number): string {
  if (score >= 85) return "Strong — ship it";
  if (score >= 70) return "Solid, a few tweaks";
  if (score >= 50) return "Needs improvements";
  return "Early draft";
}

function Ring({ score }: { score: number }): JSX.Element {
  const r = 24;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.max(0, Math.min(100, score)) / 100);
  return (
    <svg width={60} height={60} viewBox="0 0 60 60" className="ring" style={{ flex: "none" }}>
      <circle cx={30} cy={30} r={r} className="ring-bg" />
      <circle
        cx={30}
        cy={30}
        r={r}
        className="ring-fg"
        strokeDasharray={c}
        strokeDashoffset={offset}
        transform="rotate(-90 30 30)"
      />
      <text x={30} y={35} textAnchor="middle" className="ring-num">
        {score}
      </text>
    </svg>
  );
}
