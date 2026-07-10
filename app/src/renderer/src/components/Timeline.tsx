import { type DragEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import { durationFrames, durationSeconds, MAX_TIMELINE_SEC, type Edl, type Track } from "@reel/edl";
import { useEditor } from "../store";
import { addAssets, addTrack, renameTrack } from "../lib/edl-edit";
import { Icon, IconButton, useEscapeKey, type IconName } from "./ui";

const LABEL_W = 150;
const PX_PER_SEC = 60;
const MIN_DUR = 0.2;
export const ASSET_MIME = "application/x-aperture-asset";

type DragMode = "move" | "left" | "right";
/** Timeline lanes render clip-bearing tracks only (captions burn in via preview). */
type LaneTrack = Extract<Track, { type: "video" | "text" | "audio" }>;
interface Preview {
  start: number;
  end?: number;
  in?: number;
  out?: number;
}
interface DragState {
  clipId: string;
  trackType: Track["type"];
  preview: Preview;
}

export function Timeline(): JSX.Element {
  const edl = useEditor((s) => s.edl);
  const slug = useEditor((s) => s.slug);
  const currentFrame = useEditor((s) => s.currentFrame);
  const seek = useEditor((s) => s.seek);
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const select = useEditor((s) => s.select);
  const updateEdl = useEditor((s) => s.updateEdl);
  const playing = useEditor((s) => s.playing);
  const muted = useEditor((s) => s.muted);
  const playerCtl = useEditor((s) => s.playerCtl);
  const toggleMuted = useEditor((s) => s.toggleMuted);

  const [drag, setDrag] = useState<DragState | null>(null);
  const [ghost, setGhost] = useState<{ trackId: string; start: number; dur: number } | null>(null);
  const dragging = useRef(false);
  const videoInput = useRef<HTMLInputElement>(null);
  const audioInput = useRef<HTMLInputElement>(null);
  const pendingSec = useRef<{ trackId: string; sec: number } | null>(null);

  // NOTE: the Space play/pause shortcut lives in App.tsx (editor-level), not
  // here — this component unmounts in Cmd+\ focus mode.

  if (!edl) return <section className="tl" />;

  const fps = edl.format.fps;
  // Clamp so a corrupt/hostile EDL can never drive the tick loop or lane width
  // unbounded (schema bounds timings too; this is belt-and-braces).
  const dur = Math.min(Math.max(durationSeconds(edl), 6), MAX_TIMELINE_SEC);
  const currentSec = currentFrame / fps;
  const lanePx = dur * PX_PER_SEC;
  const tracks = edl.tracks.filter((t): t is LaneTrack => t.type !== "caption");

  /* ---------- scrub / drag (unchanged mechanics) ---------- */

  const startScrub = (e: MouseEvent<HTMLDivElement>) => {
    if (dragging.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const seekAt = (clientX: number) => {
      const x = clientX - rect.left - LABEL_W;
      const sec = Math.min(dur, Math.max(0, x / PX_PER_SEC));
      seek(Math.round(sec * fps));
    };
    seekAt(e.clientX);
    let raf = 0;
    let lastX = e.clientX;
    const onMove = (ev: globalThis.MouseEvent) => {
      lastX = ev.clientX;
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          seekAt(lastX);
        });
      }
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (raf) cancelAnimationFrame(raf);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startDrag = (e: MouseEvent<HTMLDivElement>, clip: AnyClip, track: Track, mode: DragMode) => {
    e.stopPropagation();
    select(clip.id);
    dragging.current = true;
    const startX = e.clientX;
    const assetDur = assetDurationFor(edl, clip);
    const orig: Preview =
      track.type === "text"
        ? { start: clip.start, end: (clip as TextLike).end }
        : { start: clip.start, in: (clip as MediaLike).in, out: (clip as MediaLike).out };
    let preview = orig;

    const onMove = (ev: globalThis.MouseEvent) => {
      const dSec = (ev.clientX - startX) / PX_PER_SEC;
      preview = computePreview(track.type, mode, orig, dSec, assetDur);
      setDrag({ clipId: clip.id, trackType: track.type, preview });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      commit(updateEdl, clip.id, track.type, preview);
      setDrag(null);
      setTimeout(() => (dragging.current = false), 0);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /* ---------- empty-lane + drop interactions ---------- */

  const laneSec = (e: { clientX: number; currentTarget: EventTarget & HTMLElement }): number => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, (e.clientX - rect.left) / PX_PER_SEC);
  };

  // Drag on an empty text lane sketches a new text clip.
  const sketchText = (e: MouseEvent<HTMLDivElement>, track: LaneTrack) => {
    if (dragging.current || e.button !== 0) return;
    if ((e.target as HTMLElement).closest(".tl-chip")) return;
    e.stopPropagation();
    dragging.current = true;
    const lane = e.currentTarget;
    const anchor = laneSec({ clientX: e.clientX, currentTarget: lane });
    let a = anchor;
    let b = anchor;
    setGhost({ trackId: track.id, start: anchor, dur: 0 });
    const onMove = (ev: globalThis.MouseEvent) => {
      const sec = laneSec({ clientX: ev.clientX, currentTarget: lane });
      a = Math.min(anchor, sec);
      b = Math.max(anchor, sec);
      setGhost({ trackId: track.id, start: a, dur: b - a });
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      setGhost(null);
      // A plain click (no meaningful drag) just clears the selection.
      if ((b - a) * PX_PER_SEC < 4) {
        select(null);
        setTimeout(() => (dragging.current = false), 0);
        return;
      }
      const start = round(a);
      const end = round(Math.max(b, a + 1));
      const id = `t-${Date.now().toString(36)}`;
      updateEdl((d) => {
        const target = d.tracks.find((t) => t.id === track.id);
        if (target?.type === "text") {
          target.clips.push({ id, start, end, text: "New text", style: "subtitle" });
        }
      });
      select(id);
      setTimeout(() => (dragging.current = false), 0);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Click on an empty media lane opens the right picker; the file lands there.
  // Clicking blank space in a populated lane just clears the selection.
  const pickForLane = (e: MouseEvent<HTMLDivElement>, track: LaneTrack) => {
    if (dragging.current) return;
    if ((e.target as HTMLElement).closest(".tl-chip")) return;
    if (track.clips.length > 0) {
      select(null);
      return;
    }
    pendingSec.current = { trackId: track.id, sec: round(laneSec(e)) };
    (track.type === "video" ? videoInput : audioInput).current?.click();
  };

  const importAt = async (files: FileList, kind: "video" | "audio") => {
    const target = pendingSec.current;
    pendingSec.current = null;
    if (!slug || !target) return;
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
    const res = await window.api.importAssets(slug, paths);
    if (!res.ok || res.assets.length === 0) return;
    updateEdl((d) => {
      addAssets(d, res.assets);
      let at = target.sec;
      for (const asset of res.assets) {
        if (kind === "video" && asset.kind === "video") {
          const track = d.tracks.find((t) => t.id === target.trackId);
          if (track?.type === "video") {
            const len = asset.durationSec ?? 3;
            track.clips.push({
              id: `c-${asset.id}`,
              assetId: asset.id,
              start: round(at),
              in: 0,
              out: round(len),
              volume: 1,
            });
            at += len;
          }
        } else if (kind === "audio" && asset.kind === "audio") {
          placeAudioOnTrack(d, target.trackId, asset.id, asset.durationSec, at);
          at += asset.durationSec ?? 1;
        }
      }
    });
  };

  // Drops from the left rail (existing assets).
  const onAssetDrop = (e: DragEvent<HTMLDivElement>, track: LaneTrack) => {
    const raw = e.dataTransfer.getData(ASSET_MIME);
    if (!raw) return;
    e.preventDefault();
    const { assetId, kind } = JSON.parse(raw) as { assetId: string; kind: string };
    const asset = edl.assets.find((a) => a.id === assetId);
    if (!asset) return;
    const at = round(laneSec(e));
    if (track.type === "video" && kind === "video") {
      updateEdl((d) => {
        const t = d.tracks.find((x) => x.id === track.id);
        if (t?.type === "video") {
          t.clips.push({
            id: `c-${assetId}-${Date.now().toString(36)}`,
            assetId,
            start: at,
            in: 0,
            out: round(asset.durationSec ?? 3),
            volume: 1,
          });
        }
      });
    } else if (track.type === "audio" && kind === "audio") {
      updateEdl((d) => placeAudioOnTrack(d, track.id, assetId, asset.durationSec, at));
    }
  };

  const totalFrames = durationFrames(edl);
  const ticks: number[] = [];
  for (let s = 0; s <= Math.ceil(dur); s += 5) ticks.push(s);

  return (
    <section className="tl">
      <div className="tl-bar">
        <div className="tl-bar-side">
          <LayerButton
            onAdd={(type) => updateEdl((d) => addTrack(d, type, undefined))}
          />
        </div>
        <div className="tl-bar-center">
          <IconButton icon="skip" label="Jump to start" onClick={() => seek(0)} style={{ transform: "scaleX(-1)" }} />
          <button
            className="ui-icon-btn"
            onClick={() => playerCtl?.toggle()}
            title={playing ? "Pause (Space)" : "Play (Space)"}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <PauseGlyph /> : <Icon name="play-circle" size={16} />}
          </button>
          <IconButton icon="skip" label="Jump to end" onClick={() => seek(Math.max(0, totalFrames - 1))} />
          <IconButton
            icon="volume-full"
            label={muted ? "Unmute" : "Mute"}
            onClick={toggleMuted}
            style={muted ? { opacity: 0.35 } : undefined}
          />
        </div>
        <div className="tl-bar-side tl-time">
          {currentSec.toFixed(2)}s <span className="muted">/ {dur.toFixed(1)}s</span>
        </div>
      </div>

      <div className="tl-scroll">
        <div className="tl-content" style={{ width: LABEL_W + lanePx }}>
          <div className="tl-ruler" onMouseDown={startScrub}>
            <div className="tl-ruler-gutter" />
            <div className="tl-ruler-ticks" style={{ width: lanePx }}>
              {ticks.map((s) => (
                <div key={s} className="tl-tick" style={{ left: s * PX_PER_SEC }}>
                  <span>{s}s</span>
                </div>
              ))}
            </div>
          </div>

          {tracks.map((track) => (
            <div key={track.id} className="tl-row">
              <TrackLabel
                track={track}
                onRename={(name) => updateEdl((d) => renameTrack(d, track.id, name))}
                onDelete={
                  track.clips.length === 0 && tracks.length > 1
                    ? () => updateEdl((d) => (d.tracks = d.tracks.filter((t) => t.id !== track.id)))
                    : undefined
                }
              />
              <div
                className={`tl-lane tl-lane-${track.type}`}
                style={{ width: lanePx }}
                onMouseDown={(e) => {
                  if (track.type === "text") sketchText(e, track);
                }}
                onClick={(e) => {
                  if (track.type !== "text") pickForLane(e, track);
                }}
                onDragOver={(e) => {
                  if (e.dataTransfer.types.includes(ASSET_MIME)) e.preventDefault();
                }}
                onDrop={(e) => onAssetDrop(e, track)}
              >
                {clipsOf(track).map((clip) => {
                  const geom = geomFor(track.type, clip, drag);
                  const selected = selectedClipId === clip.id;
                  return (
                    <div
                      key={clip.id}
                      className={`tl-chip tl-chip-${track.type} ${selected ? "selected" : ""}`}
                      style={{ left: geom.start * PX_PER_SEC, width: Math.max(14, geom.dur * PX_PER_SEC) }}
                      onMouseDown={(e) => startDrag(e, clip, track, "move")}
                      title={labelOf(track.type, clip)}
                    >
                      <div className="tl-chip-handle left" onMouseDown={(e) => startDrag(e, clip, track, "left")} />
                      <Icon name={chipIcon(track.type)} size={12} />
                      <span className="tl-chip-label">{labelOf(track.type, clip)}</span>
                      <div className="tl-chip-handle right" onMouseDown={(e) => startDrag(e, clip, track, "right")} />
                    </div>
                  );
                })}
                {ghost && ghost.trackId === track.id && (
                  <div
                    className="tl-chip tl-chip-text ghost"
                    style={{ left: ghost.start * PX_PER_SEC, width: Math.max(8, ghost.dur * PX_PER_SEC) }}
                  />
                )}
                {track.clips.length === 0 && !ghost && <div className="tl-lane-hint">{emptyHint(track.type)}</div>}
              </div>
            </div>
          ))}

          <div className="tl-playhead" style={{ left: LABEL_W + currentSec * PX_PER_SEC }}>
            <div className="tl-playhead-head" />
          </div>
        </div>
      </div>

      <input
        ref={videoInput}
        type="file"
        accept="video/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void importAt(e.target.files, "video");
          e.target.value = "";
        }}
      />
      <input
        ref={audioInput}
        type="file"
        accept="audio/*"
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files) void importAt(e.target.files, "audio");
          e.target.value = "";
        }}
      />
    </section>
  );
}

/**
 * Place an audio asset on the exact lane the user targeted (unlike the left
 * rail's role-routed add). Role is inferred from the lane; a music drop while
 * a voiceover exists ducks by default.
 */
function placeAudioOnTrack(edl: Edl, trackId: string, assetId: string, durationSec: number | undefined, at: number): void {
  const track = edl.tracks.find((t) => t.id === trackId);
  if (track?.type !== "audio") return;
  const role = track.id === "vo" || track.name?.toLowerCase().includes("voice") ? "voiceover" : "music";
  const hasVoice = edl.tracks.some(
    (t) => t.type === "audio" && t.clips.some((c) => c.role === "voiceover"),
  );
  track.clips = track.clips.filter((c) => c.assetId !== assetId);
  track.clips.push({
    id: `a-${assetId}-${Date.now().toString(36)}`,
    assetId,
    start: round(at),
    in: 0,
    out: round(Math.max(0.1, durationSec ?? 1)),
    gain: role === "music" ? -12 : 0,
    duckUnderVoice: role === "music" && hasVoice,
    role,
  });
}

/* ---------- layer button ---------- */

function LayerButton({ onAdd }: { onAdd: (type: "video" | "text" | "audio") => void }): JSX.Element {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEscapeKey(open ? () => setOpen(false) : null);
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: globalThis.MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const items: { type: "video" | "text" | "audio"; icon: IconName; label: string }[] = [
    { type: "video", icon: "clapboard-wide", label: "Video layer" },
    { type: "text", icon: "text-motion", label: "Text layer" },
    { type: "audio", icon: "voice-high", label: "Audio layer" },
  ];

  return (
    <div className="presets-wrap" ref={wrapRef}>
      <button className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setOpen((v) => !v)}>
        <Icon name="form-square" size={16} />
        Layer
      </button>
      {open && (
        <div className="presets-menu tl-layer-menu" role="menu">
          {items.map((i) => (
            <button
              key={i.type}
              className="presets-item row"
              onClick={() => {
                onAdd(i.type);
                setOpen(false);
              }}
            >
              <Icon name={i.icon} size={14} />
              <span className="name">{i.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- track label ---------- */

function TrackLabel({
  track,
  onRename,
  onDelete,
}: {
  track: Track;
  onRename: (name: string) => void;
  onDelete?: () => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const name = track.name ?? defaultName(track);

  const commitName = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== name) onRename(draft.trim());
  };

  return (
    <div className="tl-row-label" onDoubleClick={() => {
      setDraft(name);
      setEditing(true);
    }}>
      <Icon name={chipIcon(track.type)} size={14} />
      {editing ? (
        <input
          className="tl-rename"
          value={draft}
          autoFocus
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitName();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span className="name" title="Double-click to rename">
          {name}
        </span>
      )}
      {onDelete && !editing && (
        <button className="tl-row-delete" onClick={onDelete} title="Remove empty layer" aria-label="Remove layer">
          <Icon name="trash-can" size={12} />
        </button>
      )}
    </div>
  );
}

function defaultName(track: Track): string {
  if (track.type === "video") return "Video";
  if (track.type === "text") return "Text";
  if (track.type === "audio") return track.id === "vo" ? "Voiceover" : "Music";
  return "Captions";
}

function chipIcon(type: Track["type"]): IconName {
  if (type === "video") return "clapboard-wide";
  if (type === "text") return "text-motion";
  return "voice-high";
}

function PauseGlyph(): JSX.Element {
  return (
    <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor" />
      <rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor" />
    </svg>
  );
}

/* ---------- clip helpers (unchanged mechanics) ---------- */

interface MediaLike {
  id: string;
  start: number;
  in: number;
  out: number;
  assetId: string;
}
interface TextLike {
  id: string;
  start: number;
  end: number;
  text: string;
}
type AnyClip = (MediaLike | TextLike) & { id: string; start: number };

function clipsOf(track: Track): AnyClip[] {
  if (track.type === "caption") return [];
  return track.clips as AnyClip[];
}

function labelOf(type: Track["type"], clip: AnyClip): string {
  if (type === "text") return (clip as TextLike).text;
  return (clip as MediaLike).assetId;
}

function assetDurationFor(edl: Edl, clip: AnyClip): number | undefined {
  const assetId = (clip as MediaLike).assetId;
  if (!assetId) return undefined;
  return edl.assets.find((a) => a.id === assetId)?.durationSec;
}

function geomFor(type: Track["type"], clip: AnyClip, drag: DragState | null): { start: number; dur: number } {
  const p = drag && drag.clipId === clip.id ? drag.preview : null;
  if (type === "text") {
    const start = p?.start ?? clip.start;
    const end = p?.end ?? (clip as TextLike).end;
    return { start, dur: Math.max(MIN_DUR, end - start) };
  }
  const start = p?.start ?? clip.start;
  const inP = p?.in ?? (clip as MediaLike).in;
  const outP = p?.out ?? (clip as MediaLike).out;
  return { start, dur: Math.max(MIN_DUR, outP - inP) };
}

function computePreview(
  type: Track["type"],
  mode: DragMode,
  orig: Preview,
  dSec: number,
  assetDur: number | undefined,
): Preview {
  if (type === "text") {
    const end = orig.end ?? orig.start + 1;
    if (mode === "move") {
      const start = Math.max(0, orig.start + dSec);
      return { start, end: end + (start - orig.start) };
    }
    if (mode === "left") {
      return { start: clamp(orig.start + dSec, 0, end - MIN_DUR), end };
    }
    return { start: orig.start, end: Math.max(orig.start + MIN_DUR, end + dSec) };
  }

  const inV = orig.in ?? 0;
  const outV = orig.out ?? 1;
  if (mode === "move") {
    return { start: Math.max(0, orig.start + dSec), in: inV, out: outV };
  }
  if (mode === "left") {
    const newIn = clamp(inV + dSec, 0, outV - MIN_DUR);
    return { start: Math.max(0, orig.start + (newIn - inV)), in: newIn, out: outV };
  }
  const maxOut = assetDur ?? Number.POSITIVE_INFINITY;
  return { start: orig.start, in: inV, out: clamp(outV + dSec, inV + MIN_DUR, maxOut) };
}

function commit(updateEdl: (fn: (edl: Edl) => void) => void, id: string, type: Track["type"], preview: Preview): void {
  updateEdl((d) => {
    for (const track of d.tracks) {
      if (track.type === "caption") continue;
      const clip = track.clips.find((c) => c.id === id);
      if (!clip) continue;
      clip.start = round(preview.start);
      if (track.type === "text" && preview.end != null) {
        (clip as TextLike).end = round(preview.end);
      } else if (track.type !== "text") {
        if (preview.in != null) (clip as MediaLike).in = round(preview.in);
        if (preview.out != null) (clip as MediaLike).out = round(preview.out);
      }
      return;
    }
  });
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (n: number) => Math.round(n * 100) / 100;

function emptyHint(type: Track["type"]): string {
  switch (type) {
    case "video":
      return "Click to add video, or drag a clip from the left";
    case "text":
      return "Drag to sketch a text overlay";
    case "audio":
      return "Click to add audio, or drag from the left";
    default:
      return "";
  }
}
