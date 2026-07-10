import { useCallback, useEffect, useRef, useState } from "react";
import type { StyleProfile } from "@reel/edl";
import { useEditor } from "../store";
import { Button, Icon } from "./ui";
import type { StyleSummary } from "../../../preload";

/**
 * Style tab (Figma 11:854): reference library upload, active library chip,
 * reference mode (literal vs inspired), and the read-only LLM-distilled style
 * guide. Analysis runs automatically on Generate; Re-analyze is manual.
 */
export function StylePanel(): JSX.Element {
  const slug = useEditor((s) => s.slug);
  const [styles, setStyles] = useState<StyleSummary[]>([]);
  const [projectRefs, setProjectRefs] = useState<string[]>([]);
  const [activeId, setActiveId] = useState<string | undefined>(undefined);
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [isProjectProfile, setIsProjectProfile] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [phase, setPhase] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const refInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(() => {
    window.api?.listStyles().then(setStyles).catch(() => {});
    if (!slug) return;
    window.api?.listReferences(slug).then(setProjectRefs).catch(() => {});
    window.api?.loadMeta(slug).then((m) => setActiveId(m.styleProfileId)).catch(() => {});
    window.api?.loadStyle(slug).then((p) => {
      setIsProjectProfile(Boolean(p));
      if (p) setProfile(p);
    });
  }, [slug]);

  useEffect(refresh, [refresh]);

  // Resolve the effective library profile when the project has no override.
  const effectiveId = activeId ?? (styles.length === 1 ? styles[0].id : undefined);
  useEffect(() => {
    if (isProjectProfile || !effectiveId) return;
    window.api?.getStyle(effectiveId).then((p) => p && setProfile(p)).catch(() => {});
  }, [effectiveId, isProjectProfile]);

  const newStyleFromFolder = async () => {
    setBusy("Choose a folder…");
    try {
      await window.api.newStyleFromDialog("folder");
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const addToLibrary = async (files: FileList) => {
    if (!slug) return;
    // Files dropped here become project-level references (override).
    const paths = Array.from(files)
      .map((f) => {
        try {
          return window.api.getPathForFile(f);
        } catch {
          return "";
        }
      })
      .filter(Boolean);
    if (paths.length === 0) return;
    setBusy("Importing references…");
    try {
      await window.api.importReferences(slug, paths);
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const reanalyze = async () => {
    if (phase) return;
    setProgress(0);
    setPhase("starting");
    const channel = isProjectProfile || !effectiveId ? "style" : "styles";
    const offPhase = window.api.onPhase(channel, setPhase);
    const offProgress = window.api.onProgress(channel, setProgress);
    try {
      if (isProjectProfile || !effectiveId) await window.api.learnStyle(slug!);
      else await window.api.analyzeStyle(effectiveId);
      refresh();
    } finally {
      offPhase();
      offProgress();
      setPhase(null);
    }
  };

  const setMode = async (mode: "literal" | "inspired") => {
    if (!slug) return;
    setProfile((p) => (p ? { ...p, referenceMode: mode } : p));
    await window.api.patchStyle(slug, { referenceMode: mode });
  };

  const setActive = async (id: string) => {
    if (!slug) return;
    await window.api.saveMeta(slug, { styleProfileId: id || undefined });
    setActiveId(id || undefined);
  };

  return (
    <div>
      <div className="rail-section">
        <div className="rail-head">Reference library</div>
        <div className="rail-body" style={{ gap: 8 }}>
          <p className="crit-summary" style={{ margin: 0 }}>
            Build a reusable look from a repository of videos.
          </p>
          <div className="upload-area" style={{ height: 72 }} onClick={() => refInput.current?.click()}>
            <span className="upload-title">
              <Icon name="arrow-out-of-box" size={16} />
              Upload reference video(s)
            </span>
            <span className="upload-sub">{busy ?? "Drag and drop here or click to upload"}</span>
          </div>
          <input
            ref={refInput}
            type="file"
            accept="video/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) void addToLibrary(e.target.files);
              e.target.value = "";
            }}
          />
          {/* Videos uploaded here live in this project's references/ and
              override the global library for this project. */}
          {projectRefs.length > 0 && (
            <div className="clip-list clip-list-capped">
              {projectRefs.map((file) => (
                <div key={file} className="clip-row" title={file}>
                  <Icon name="multi-media" size={14} />
                  <span className="name">{file}</span>
                  <button
                    className="clip-row-remove"
                    title="Remove reference"
                    aria-label={`Remove ${file}`}
                    onClick={async () => {
                      await window.api.removeReference(slug!, file);
                      refresh();
                    }}
                  >
                    <Icon name="trash-can" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {styles.map((s) => (
            <div key={s.id} className="clip-row" title={`${s.clips} clips`}>
              <Icon name="folder-alt" size={14} />
              <span className="name">{s.name}</span>
            </div>
          ))}
          <Button variant="ghost" size="sm" onClick={newStyleFromFolder} disabled={!!busy}>
            New library from folder…
          </Button>
          {styles.length > 1 && (
            <div className="insp-group" style={{ width: "100%" }}>
              <span className="insp-label">Active library</span>
              <span className="insp-select">
                <select value={effectiveId ?? ""} onChange={(e) => void setActive(e.target.value)}>
                  <option value="">Auto</option>
                  {styles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <Icon name="chevron-top" size={16} style={{ transform: "rotate(180deg)" }} />
              </span>
            </div>
          )}
          <div className="insp-group" style={{ width: "100%" }}>
            <span className="insp-label">Reference</span>
            <span className="insp-select">
              <select
                value={profile?.referenceMode ?? "literal"}
                onChange={(e) => void setMode(e.target.value as "literal" | "inspired")}
              >
                <option value="literal">Literal</option>
                <option value="inspired">Inspired</option>
              </select>
              <Icon name="chevron-top" size={16} style={{ transform: "rotate(180deg)" }} />
            </span>
          </div>
        </div>
      </div>

      <div className="rail-section">
        <div className="rail-head">Prompt</div>
        <div className="rail-body" style={{ gap: 8 }}>
          {profile?.styleGuide ? (
            <p className="crit-summary" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
              {profile.styleGuide}
            </p>
          ) : (
            <p className="crit-summary" style={{ margin: 0 }}>
              No style guide yet — it&apos;s distilled from your references automatically the first time you
              Generate, or run analysis now.
            </p>
          )}
          <Button variant="secondary" size="sm" onClick={reanalyze} disabled={!!phase} style={{ width: "100%" }}>
            {phase ? `Analyzing… ${phase}` : profile?.styleGuide ? "Re-analyze references" : "Analyze references"}
          </Button>
          {phase && (
            <div className="crit-trajectory">
              <div className="crit-trajectory-fill" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
