import type { ReactNode } from "react";
import { useEditor } from "../store";
import {
  findAudioClip,
  findTextClip,
  findVideoClip,
  mutateAudioClip,
  mutateTextClip,
  mutateVideoClip,
} from "../lib/edl-edit";
import { Button, Icon, type IconName } from "./ui";

const FONTS = [
  { label: "Editorial serif", value: "ui-serif, Georgia, serif" },
  { label: "Playfair Display", value: "'Playfair Display', ui-serif, Georgia, serif" },
  { label: "Inter (sans)", value: "Inter, system-ui, sans-serif" },
  { label: "System sans", value: "system-ui, -apple-system, sans-serif" },
  { label: "Mono", value: "'SF Mono', ui-monospace, monospace" },
];

const CAPTION_STYLES = ["karaoke", "block", "word", "none"];
const ANIMS = [
  "soft-blur-in",
  "per-character-rise",
  "per-word-crossfade",
  "spring-scale-in",
  "mask-reveal-up",
  "blur-out-up",
  "scale-down-fade",
  "typewriter",
];
const TRANSITIONS = ["none", "fade", "slide", "wipe"];

const ASPECTS: { id: string; label: string; ratio: string; resolutions: [number, number][] }[] = [
  { id: "9:16", label: "Vertical", ratio: "9:16", resolutions: [[1080, 1920], [720, 1280]] },
  { id: "16:9", label: "Landscape", ratio: "16:9", resolutions: [[1920, 1080], [1280, 720]] },
  { id: "1:1", label: "Square", ratio: "1:1", resolutions: [[1080, 1080], [720, 720]] },
];

function aspectOf(width: number, height: number): (typeof ASPECTS)[number] {
  const r = width / height;
  return ASPECTS.find((a) => {
    const [w, h] = a.ratio.split(":").map(Number);
    return Math.abs(r - w / h) < 0.01;
  }) ?? ASPECTS[0];
}

/**
 * Combined Inspector tab: project Design + Format by default; a Back-headed
 * subflow for the selected clip.
 */
export function InspectorPanel(): JSX.Element {
  const edl = useEditor((s) => s.edl);
  const selectedClipId = useEditor((s) => s.selectedClipId);

  if (!edl) return <div />;
  if (selectedClipId) return <ClipSubflow />;
  return <ProjectDesign />;
}

/* ---------------- project design + format ---------------- */

const DEFAULT_ALIGN = { horizontal: "center", vertical: "center" } as const;

function ProjectDesign(): JSX.Element {
  const edl = useEditor((s) => s.edl)!;
  const updateEdl = useEditor((s) => s.updateEdl);

  // Tolerate EDLs parsed before theme.textAlignment existed (e.g. a main
  // process still running the previous schema) instead of crashing.
  const align = edl.theme.textAlignment ?? DEFAULT_ALIGN;
  const m = edl.theme.safeMargins;
  const aspect = aspectOf(edl.format.width, edl.format.height);

  const setAlign = (patch: Partial<typeof align>) =>
    updateEdl((d) => {
      d.theme.textAlignment = { ...DEFAULT_ALIGN, ...d.theme.textAlignment, ...patch };
    });

  const setMargin = (side: "top" | "bottom" | "left" | "right", value: number) =>
    updateEdl((d) => {
      d.theme.safeMargins[side] = Math.max(0, value || 0);
    });

  const setAspect = (id: string) => {
    const next = ASPECTS.find((a) => a.id === id);
    if (!next) return;
    updateEdl((d) => {
      [d.format.width, d.format.height] = next.resolutions[0];
    });
  };

  const setResolution = (value: string) => {
    const [w, h] = value.split("x").map(Number);
    if (!w || !h) return;
    updateEdl((d) => {
      d.format.width = w;
      d.format.height = h;
    });
  };

  return (
    <div>
      <Section title="Design">
        <div className="insp-group">
          <span className="insp-label">Alignment</span>
          <div className="insp-row">
            <SegGroup
              options={[
                { id: "left", icon: "vertical-align-left" },
                { id: "center", icon: "vertical-align-center" },
                { id: "right", icon: "vertical-align-right" },
              ]}
              value={align.horizontal}
              onChange={(v) => setAlign({ horizontal: v as typeof align.horizontal })}
            />
            <SegGroup
              options={[
                { id: "top", icon: "horizontal-align-top" },
                { id: "center", icon: "horizontal-align-center" },
                { id: "bottom", icon: "horizontal-align-bottom" },
              ]}
              value={align.vertical}
              onChange={(v) => setAlign({ vertical: v as typeof align.vertical })}
            />
          </div>
        </div>

        <div className="insp-group">
          <span className="insp-label">Padding</span>
          <div className="insp-row">
            <PaddingChip rotation={0} value={m.left} onChange={(v) => setMargin("left", v)} />
            <PaddingChip rotation={90} value={m.top} onChange={(v) => setMargin("top", v)} />
            <PaddingChip rotation={180} value={m.right} onChange={(v) => setMargin("right", v)} />
            <PaddingChip rotation={-90} value={m.bottom} onChange={(v) => setMargin("bottom", v)} />
          </div>
        </div>

        <div className="insp-group" style={{ width: "100%" }}>
          <span className="insp-label">Typography</span>
          <InspSelect
            value={edl.theme.fontFamily}
            onChange={(v) => updateEdl((d) => (d.theme.fontFamily = v))}
            options={[
              ...FONTS.map((f) => ({ value: f.value, label: f.label })),
              ...(FONTS.some((f) => f.value === edl.theme.fontFamily)
                ? []
                : [{ value: edl.theme.fontFamily, label: edl.theme.fontFamily }]),
            ]}
          />
        </div>

        <div className="insp-grid">
          <ColorChip
            label="Text color"
            value={edl.theme.palette[0] ?? "#FFFFFF"}
            onChange={(v) => updateEdl((d) => (d.theme.palette[0] = v))}
          />
          <ColorChip
            label="Background color"
            value={edl.theme.palette[1] ?? "#0F0E0D"}
            onChange={(v) => updateEdl((d) => (d.theme.palette[1] = v))}
          />
          <ColorChip
            label="Accent color"
            value={edl.theme.palette[2] ?? "#FEAF00"}
            onChange={(v) => updateEdl((d) => (d.theme.palette[2] = v))}
          />
        </div>

        <div className="insp-group" style={{ width: "100%" }}>
          <span className="insp-label">Captions</span>
          <InspSelect
            value={edl.theme.captionStyle}
            onChange={(v) => updateEdl((d) => (d.theme.captionStyle = v as typeof d.theme.captionStyle))}
            options={CAPTION_STYLES.map((s) => ({ value: s, label: s }))}
          />
        </div>
      </Section>

      <Section title="Format">
        <div className="insp-group" style={{ width: "100%" }}>
          <span className="insp-label">Frame rate</span>
          <InspSelect
            value={String(edl.format.fps)}
            onChange={(v) => updateEdl((d) => (d.format.fps = Number(v)))}
            options={[24, 30, 60].map((f) => ({ value: String(f), label: `${f} fps` }))}
          />
        </div>
        <div className="insp-group" style={{ width: "100%" }}>
          <span className="insp-label">Aspect ratio</span>
          <InspSelect
            icon="form-rectangle"
            value={aspect.id}
            onChange={setAspect}
            options={ASPECTS.map((a) => ({ value: a.id, label: `${a.label} ${a.ratio}` }))}
          />
        </div>
        <div className="insp-group" style={{ width: "100%" }}>
          <span className="insp-label">Resolution</span>
          <InspSelect
            value={`${edl.format.width}x${edl.format.height}`}
            onChange={setResolution}
            options={aspect.resolutions.map(([w, h]) => ({ value: `${w}x${h}`, label: `${w}x${h}` }))}
          />
        </div>
      </Section>
    </div>
  );
}

/* ---------------- clip subflow ---------------- */

function ClipSubflow(): JSX.Element {
  const edl = useEditor((s) => s.edl)!;
  const selectedClipId = useEditor((s) => s.selectedClipId);
  const select = useEditor((s) => s.select);
  const updateEdl = useEditor((s) => s.updateEdl);

  const textClip = findTextClip(edl, selectedClipId);
  const videoClip = findVideoClip(edl, selectedClipId);
  const audioClip = findAudioClip(edl, selectedClipId);

  const back = (
    <div className="subflow-head">
      <Button variant="secondary" size="sm" onClick={() => select(null)}>
        Back
      </Button>
    </div>
  );

  if (textClip) {
    const id = textClip.id;
    return (
      <div>
        {back}
        <Section title="Text">
          <div className="insp-group" style={{ width: "100%" }}>
            <span className="insp-label">Content</span>
            <textarea
              className="rail-textarea"
              style={{ height: 56 }}
              value={textClip.text}
              onChange={(e) => updateEdl((d) => mutateTextClip(d, id, (c) => (c.text = e.target.value)))}
            />
          </div>
          <div className="insp-group" style={{ width: "100%" }}>
            <span className="insp-label">Style</span>
            <InspSelect
              value={textClip.style}
              onChange={(v) => updateEdl((d) => mutateTextClip(d, id, (c) => (c.style = v)))}
              options={["title", "subtitle"].map((s) => ({ value: s, label: s }))}
            />
          </div>
          <div className="insp-group" style={{ width: "100%" }}>
            <span className="insp-label">Animation</span>
            <InspSelect
              value={textClip.anim?.name ?? "soft-blur-in"}
              onChange={(v) =>
                updateEdl((d) => mutateTextClip(d, id, (c) => (c.anim = { name: v, from: "animate-text" })))
              }
              options={ANIMS.map((a) => ({ value: a, label: a }))}
            />
          </div>
          <div className="insp-row">
            <NumberChip
              label="Start (s)"
              value={textClip.start}
              onChange={(v) => updateEdl((d) => mutateTextClip(d, id, (c) => (c.start = v)))}
            />
            <NumberChip
              label="End (s)"
              value={textClip.end}
              onChange={(v) => updateEdl((d) => mutateTextClip(d, id, (c) => (c.end = v)))}
            />
          </div>
        </Section>
      </div>
    );
  }

  if (videoClip) {
    const id = videoClip.id;
    const setTransition = (edge: "transitionIn" | "transitionOut", preset: string) =>
      updateEdl((d) =>
        mutateVideoClip(d, id, (c) => {
          if (preset === "none") delete c[edge];
          else c[edge] = { preset, duration: c[edge]?.duration ?? 0.4 };
        }),
      );
    return (
      <div>
        {back}
        <Section title={`Video · ${videoClip.assetId}`}>
          <div className="insp-row">
            <NumberChip
              label="In (s)"
              value={videoClip.in}
              onChange={(v) => updateEdl((d) => mutateVideoClip(d, id, (c) => (c.in = v)))}
            />
            <NumberChip
              label="Out (s)"
              value={videoClip.out}
              onChange={(v) => updateEdl((d) => mutateVideoClip(d, id, (c) => (c.out = v)))}
            />
          </div>
          <div className="insp-group" style={{ width: "100%" }}>
            <span className="insp-label">Volume {Math.round((videoClip.volume ?? 1) * 100)}%</span>
            <input
              className="insp-slider"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={videoClip.volume ?? 1}
              onChange={(e) => updateEdl((d) => mutateVideoClip(d, id, (c) => (c.volume = Number(e.target.value))))}
            />
          </div>
          <div className="insp-group" style={{ width: "100%" }}>
            <span className="insp-label">Transition in</span>
            <InspSelect
              value={videoClip.transitionIn?.preset ?? "none"}
              onChange={(v) => setTransition("transitionIn", v)}
              options={TRANSITIONS.map((t) => ({ value: t, label: t }))}
            />
          </div>
          <div className="insp-group" style={{ width: "100%" }}>
            <span className="insp-label">Transition out</span>
            <InspSelect
              value={videoClip.transitionOut?.preset ?? "none"}
              onChange={(v) => setTransition("transitionOut", v)}
              options={TRANSITIONS.map((t) => ({ value: t, label: t }))}
            />
          </div>
        </Section>
      </div>
    );
  }

  if (audioClip) {
    const id = audioClip.id;
    return (
      <div>
        {back}
        <Section title={`Audio · ${audioClip.assetId}`}>
          <div className="insp-group" style={{ width: "100%" }}>
            <span className="insp-label">Role</span>
            <InspSelect
              value={audioClip.role}
              onChange={(v) => updateEdl((d) => mutateAudioClip(d, id, (c) => (c.role = v as typeof c.role)))}
              options={["music", "voiceover", "sfx"].map((r) => ({ value: r, label: r }))}
            />
          </div>
          <div className="insp-group" style={{ width: "100%" }}>
            <span className="insp-label">Gain {audioClip.gain} dB</span>
            <input
              className="insp-slider"
              type="range"
              min={-24}
              max={6}
              step={1}
              value={audioClip.gain}
              onChange={(e) => updateEdl((d) => mutateAudioClip(d, id, (c) => (c.gain = Number(e.target.value))))}
            />
          </div>
          <label className="insp-check">
            <input
              type="checkbox"
              checked={audioClip.duckUnderVoice}
              onChange={(e) => updateEdl((d) => mutateAudioClip(d, id, (c) => (c.duckUnderVoice = e.target.checked)))}
            />
            Duck under voice
          </label>
        </Section>
      </div>
    );
  }

  return (
    <div>
      {back}
      <p className="pad muted small">This clip type isn&apos;t editable yet.</p>
    </div>
  );
}

/* ---------------- shared bits ---------------- */

function Section({ title, children }: { title: string; children: ReactNode }): JSX.Element {
  return (
    <div className="rail-section">
      <div className="rail-head">{title}</div>
      <div className="rail-body" style={{ gap: 12 }}>
        {children}
      </div>
    </div>
  );
}

function SegGroup({
  options,
  value,
  onChange,
}: {
  options: { id: string; icon: IconName }[];
  value: string;
  onChange: (id: string) => void;
}): JSX.Element {
  return (
    <div className="seg-group">
      {options.map((o) => (
        <button
          key={o.id}
          className={`seg-btn ${value === o.id ? "active" : ""}`}
          onClick={() => onChange(o.id)}
          title={o.id}
          aria-label={o.id}
        >
          <Icon name={o.icon} size={16} />
        </button>
      ))}
    </div>
  );
}

function PaddingChip({
  rotation,
  value,
  onChange,
}: {
  rotation: number;
  value: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <span className="chip-field">
      <Icon name="layout-align-left" size={16} style={{ transform: `rotate(${rotation}deg)` }} />
      <input type="number" min={0} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </span>
  );
}

function NumberChip({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <span className="insp-group">
      <span className="insp-label">{label}</span>
      <span className="chip-field">
        <input type="number" step={0.1} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      </span>
    </span>
  );
}

function ColorChip({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}): JSX.Element {
  return (
    <span className="insp-group">
      <span className="insp-label">{label}</span>
      <span className="chip-field">
        <input
          className="chip-swatch"
          type="color"
          value={normalizeHex(value)}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
        />
        <input
          type="text"
          value={value.toUpperCase()}
          onChange={(e) => {
            const v = e.target.value.trim();
            if (/^#[0-9a-fA-F]{6}$/.test(v) || /^#[0-9a-fA-F]{3}$/.test(v)) onChange(v.toUpperCase());
          }}
        />
      </span>
    </span>
  );
}

function InspSelect({
  value,
  onChange,
  options,
  icon,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  icon?: IconName;
}): JSX.Element {
  return (
    <span className="insp-select">
      {icon && <Icon name={icon} size={16} style={{ transform: "rotate(90deg)" }} />}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-top" size={16} style={{ transform: "rotate(180deg)", color: "var(--foreground-secondary)" }} />
    </span>
  );
}

function normalizeHex(c: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(c)) return c;
  if (/^#[0-9a-fA-F]{3}$/.test(c)) {
    return "#" + c.slice(1).split("").map((x) => x + x).join("");
  }
  return "#000000";
}
