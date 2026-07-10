import { type DragEvent, useEffect, useRef, useState } from "react";
import { useEditor } from "../store";
import { addAssets } from "../lib/edl-edit";
import { SettingsButton } from "./SettingsModal";
import { Badge, Button, Field, Icon, IconButton, Input, Modal, TextArea } from "./ui";
import type { ProjectSummary } from "../../../preload";

export function Home(): JSX.Element {
  const projects = useEditor((s) => s.projects);
  const setProjects = useEditor((s) => s.setProjects);
  const openProject = useEditor((s) => s.openProject);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const refresh = () => {
    window.api
      ?.listProjects()
      .then((list) => setProjects(list))
      .catch(() => setProjects([]))
      .finally(() => setLoading(false));
  };

  useEffect(refresh, [setProjects]);

  return (
    <div className="home">
      <header className="home-header">
        <div className="brand">
          <Icon name="aperture-logomark" size={20} />
          <span className="home-wordmark">Keeper</span>
        </div>
        <div className="home-header-actions">
          <SettingsButton />
          <Button variant="primary" size="sm" icon="clapboard-wide" onClick={() => setCreating(true)}>
            New project
          </Button>
        </div>
      </header>

      <main className="home-content">
        <div className="home-hero">
          <h1>Welcome to Keeper</h1>
          <p>
            Drop in your clips, describe in natural language, let our creative agent assemble a first cut,
            refine to your needs and export to your socials.
          </p>
        </div>

        {loading ? (
          <p className="home-loading">Loading projects…</p>
        ) : (
          <div className="project-grid">
            {projects.map((p) => (
              <ProjectCard key={p.slug} project={p} onOpen={() => openProject(p.slug)} onDeleted={refresh} />
            ))}
            <button className="project-card project-card--new" onClick={() => setCreating(true)}>
              <Icon name="clapboard-wide" size={16} />
              <span>New project</span>
            </button>
          </div>
        )}
      </main>

      {creating && (
        <NewProjectModal
          onClose={() => setCreating(false)}
          onCreated={(slug) => {
            setCreating(false);
            refresh();
            openProject(slug);
          }}
        />
      )}
    </div>
  );
}

function statusBadge(status: string): { label: string; variant: "neutral" | "accent" } {
  switch (status) {
    case "exported":
      return { label: "Published", variant: "accent" };
    case "generated":
      return { label: "Generated", variant: "neutral" };
    case "critiqued":
      return { label: "Critiqued", variant: "neutral" };
    default:
      return { label: "Draft", variant: "neutral" };
  }
}

function relativeTime(iso?: string): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const min = Math.floor(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

function ProjectCard({
  project,
  onOpen,
  onDeleted,
}: {
  project: ProjectSummary;
  onOpen: () => void;
  onDeleted: () => void;
}): JSX.Element {
  const [thumb, setThumb] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    window.api
      ?.projectThumbnail(project.slug)
      .then((url) => alive && setThumb(url))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [project.slug]);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const onDelete = async () => {
    setMenuOpen(false);
    if (!window.confirm(`Delete "${project.title}"? This permanently removes the project folder.`)) return;
    const res = await window.api.deleteProject(project.slug);
    if (res.ok) onDeleted();
  };

  const badge = statusBadge(project.status);
  const when = relativeTime(project.updatedAt);
  const meta = [`${project.durationSec.toFixed(1)}s`, when].filter(Boolean).join(" ⋅ ");

  return (
    <div className="project-card" onClick={onOpen} role="button" tabIndex={0}>
      <div className="project-card-media">
        {thumb ? <img src={thumb} alt="" /> : <div className="project-card-placeholder">No clips yet</div>}
      </div>
      <Badge variant={badge.variant} className="project-card-badge">
        {badge.label}
      </Badge>
      <div className="project-card-footer">
        <div className="project-card-info">
          <div className="project-card-title">{project.title}</div>
          <div className="project-card-meta">{meta}</div>
        </div>
        <div className="project-card-menu" ref={menuRef}>
          <IconButton
            icon="ellipsis"
            size={12}
            label="Project options"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen((v) => !v);
            }}
          />
          {menuOpen && (
            <div className="card-menu">
              <button
                className="card-menu-item danger"
                onClick={(e) => {
                  e.stopPropagation();
                  void onDelete();
                }}
              >
                Delete project
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface StagedFile {
  path: string;
  name: string;
}

function NewProjectModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (slug: string) => void;
}): JSX.Element {
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [files, setFiles] = useState<StagedFile[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const stage = (list: FileList | File[]) => {
    // Snapshot synchronously: a FileList is LIVE, and the caller resets the
    // input right after this call — by the time React runs a deferred state
    // updater the list would already be empty.
    const picked: StagedFile[] = [];
    for (const f of Array.from(list)) {
      try {
        const path = window.api.getPathForFile(f);
        if (path) picked.push({ path, name: f.name });
      } catch {
        // not a disk-backed file; skip
      }
    }
    if (picked.length === 0) return;
    setFiles((prev) => {
      const next = [...prev];
      for (const p of picked) {
        if (!next.some((s) => s.path === p.path)) next.push(p);
      }
      return next;
    });
  };

  const create = async () => {
    if (!title.trim() || busy) return;
    setBusy("Creating project…");
    setError(null);
    try {
      const res = await window.api.createProject({ title, prompt });
      if (!res.ok || !res.slug) {
        setError(res.error ?? "Could not create project");
        return;
      }
      // Import the staged clips and register them in the fresh project's EDL
      // so the editor opens with everything already in place.
      if (files.length > 0) {
        setBusy(`Importing ${files.length} clip${files.length === 1 ? "" : "s"}…`);
        const imp = await window.api.importAssets(res.slug, files.map((f) => f.path));
        if (imp.ok && imp.assets.length > 0) {
          const proj = await window.api.loadProject(res.slug);
          if (proj.ok && proj.edl) {
            addAssets(proj.edl, imp.assets);
            await window.api.saveEdl(res.slug, proj.edl);
          }
        }
      }
      onCreated(res.slug);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      title="New project"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={!!busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={create} disabled={!!busy || !title.trim()}>
            {busy ?? "Create"}
          </Button>
        </>
      }
    >
      <Field label="Title">
        <Input
          autoFocus
          value={title}
          placeholder="e.g. Day in the life of startup engineer"
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && create()}
        />
      </Field>
      <Field label="Clips">
        <div
          className={`upload-area ${dragOver ? "drag" : ""}`}
          style={{ height: 96 }}
          onClick={() => fileInput.current?.click()}
          onDragOver={(e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e: DragEvent<HTMLDivElement>) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files.length) stage(e.dataTransfer.files);
          }}
        >
          <span className="upload-title">
            <Icon name="arrow-out-of-box" size={16} />
            Upload clips
          </span>
          <span className="upload-sub">Drag and drop files here or click to upload</span>
          <span className="upload-formats">MP4, MOV, HEIC, WebM, JPEGs, PNGs</span>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="video/*,image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) stage(e.target.files);
            e.target.value = "";
          }}
        />
        {files.length > 0 && (
          <div className="clip-list clip-list-capped" style={{ marginTop: 6 }}>
            {files.map((f) => (
              <div key={f.path} className="clip-row" title={f.path}>
                <Icon name="multi-media" size={14} />
                <span className="name">{f.name}</span>
                <button
                  className="clip-row-remove"
                  title="Remove"
                  aria-label={`Remove ${f.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFiles((prev) => prev.filter((s) => s.path !== f.path));
                  }}
                >
                  <Icon name="trash-can" size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
      </Field>
      <Field label="What do you want to make?">
        <TextArea
          rows={4}
          value={prompt}
          placeholder="Describe the vibe, beats, hook, length, and any music or captions you want."
          onChange={(e) => setPrompt(e.target.value)}
        />
      </Field>
      {error && <p className="ui-form-error">{error}</p>}
    </Modal>
  );
}
