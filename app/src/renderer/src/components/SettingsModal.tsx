import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useEditor } from "../store";
import { Button, Icon, IconButton } from "./ui";
import { useEscapeKey } from "./ui/useEscapeKey";
import type { AppSettings, VoiceSummary } from "../../../preload";

type SettingsTab = "general" | "export" | "agent" | "voices";

const TABS: { id: SettingsTab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "export", label: "Export Settings" },
  { id: "agent", label: "Agent Preferences" },
  { id: "voices", label: "Voices" },
];

const MODELS = ["gpt-5.5", "gpt-5.5-mini", "claude-fable-5", "claude-sonnet-5"];

const DEFAULTS: AppSettings = {
  hwDecode: false,
  hwEncode: false,
  exportFps: "project",
  exportResolution: "project",
  exportCompression: "social",
  agentModel: "gpt-5.5",
  reasoningEffort: "low",
};

/** Settings dialog (Figma 14:1597 / 17:652 / 17:1812). */
export function SettingsModal({ onClose }: { onClose: () => void }): JSX.Element {
  const theme = useEditor((s) => s.theme);
  const setTheme = useEditor((s) => s.setTheme);
  const [tab, setTab] = useState<SettingsTab>("general");
  const [settings, setSettings] = useState<AppSettings>(DEFAULTS);
  const [projectsDir, setProjectsDir] = useState<string>("");
  const [locks, setLocks] = useState({ modelLocked: false, keyLocked: false });
  const [keyDraft, setKeyDraft] = useState("");
  const [keySaved, setKeySaved] = useState(false);

  useEscapeKey(onClose);

  useEffect(() => {
    window.api?.getSettings().then(setSettings).catch(() => {});
    window.api?.getProjectsDir().then(setProjectsDir).catch(() => {});
    window.api
      ?.generateMode()
      .then((m) => setLocks({ modelLocked: m.modelLocked, keyLocked: m.keyLocked }))
      .catch(() => {});
  }, []);

  const update = async (patch: Partial<AppSettings>) => {
    const next = await window.api.setSettings(patch);
    setSettings(next);
  };

  const changeFolder = async () => {
    await window.api.pickProjectsDir();
  };

  const connectKey = async () => {
    if (!keyDraft.trim()) return;
    await update({ agentApiKey: keyDraft.trim() });
    setKeyDraft("");
    setKeySaved(true);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-tabs-row">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`settings-tab ${tab === t.id ? "active" : ""}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="settings-body">
          {tab === "general" && (
            <>
              <SettingRow title="Appearance" sub="Select your interface color scheme">
                <SettingSelect
                  value={theme}
                  onChange={(v) => setTheme(v as "light" | "dark")}
                  options={[
                    { value: "light", label: "Light" },
                    { value: "dark", label: "Dark" },
                  ]}
                />
              </SettingRow>
              <Divider />
              <SettingRow
                title="Hardware-accelerated playback"
                sub="Use GPU to decode video in the editor. Restart required"
              >
                <Toggle on={settings.hwDecode} onChange={(v) => void update({ hwDecode: v })} />
              </SettingRow>
              <Divider />
              <SettingRow title="Hardware-accelerated export" sub="Use GPU encoder when rendering the final MP4">
                <Toggle on={settings.hwEncode} onChange={(v) => void update({ hwEncode: v })} />
              </SettingRow>
              <Divider />
              <SettingRow
                title="Save all projects to"
                sub={projectsDir || "…"}
                subTitle="Click to reveal in Finder"
                onSubClick={() => void window.api.revealProjectsDir()}
              >
                <button className="settings-select-btn" onClick={changeFolder}>
                  Change directory
                </button>
              </SettingRow>
            </>
          )}

          {tab === "export" && (
            <>
              <SettingRow title="Frame rate" sub="Output frame rate for the exported video">
                <SettingSelect
                  value={settings.exportFps}
                  onChange={(v) => void update({ exportFps: v as AppSettings["exportFps"] })}
                  options={[
                    { value: "project", label: "Project" },
                    { value: "24", label: "24 FPS" },
                    { value: "30", label: "30 FPS" },
                    { value: "60", label: "60 FPS" },
                  ]}
                />
              </SettingRow>
              <Divider />
              <SettingRow title="Resolution" sub="Rendered size; Project keeps the format set in the editor">
                <SettingSelect
                  value={settings.exportResolution}
                  onChange={(v) => void update({ exportResolution: v as AppSettings["exportResolution"] })}
                  options={[
                    { value: "project", label: "Project" },
                    { value: "1080", label: "1080p" },
                    { value: "720", label: "720p" },
                  ]}
                />
              </SettingRow>
              <Divider />
              <SettingRow title="Compression" sub="Trade file size against visual quality">
                <SettingSelect
                  value={settings.exportCompression}
                  onChange={(v) => void update({ exportCompression: v as AppSettings["exportCompression"] })}
                  options={[
                    { value: "social", label: "Social Media" },
                    { value: "high", label: "High Quality" },
                    { value: "max", label: "Smallest File" },
                  ]}
                />
              </SettingRow>
            </>
          )}

          {tab === "agent" && (
            <>
              <SettingRow
                title="Model"
                sub={
                  locks.modelLocked
                    ? "Pinned by APERTURE_LLM_MODEL in .env.local"
                    : "Model used for generation, critique and auto-improve"
                }
              >
                <SettingSelect
                  value={settings.agentModel}
                  onChange={(v) => void update({ agentModel: v })}
                  disabled={locks.modelLocked}
                  options={MODELS.map((m) => ({ value: m, label: modelLabel(m) }))}
                />
              </SettingRow>
              <div className="settings-key-row">
                <input
                  className="settings-key-input"
                  type="password"
                  placeholder={
                    locks.keyLocked
                      ? "API key configured via .env.local"
                      : keySaved || settings.agentApiKey
                        ? "API key saved — enter a new key to replace it"
                        : "Enter your OpenAI API Key"
                  }
                  value={keyDraft}
                  disabled={locks.keyLocked}
                  onChange={(e) => setKeyDraft(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void connectKey()}
                />
                <button
                  className="settings-select-btn"
                  onClick={() => void connectKey()}
                  disabled={locks.keyLocked || !keyDraft.trim()}
                >
                  {keySaved ? "Saved" : "Connect"}
                </button>
              </div>
              <Divider />
              <SettingRow title="Reasoning effort" sub="Higher effort thinks longer and costs more per run">
                <SettingSelect
                  value={settings.reasoningEffort}
                  onChange={(v) => void update({ reasoningEffort: v as AppSettings["reasoningEffort"] })}
                  options={[
                    { value: "low", label: "Low" },
                    { value: "medium", label: "Medium" },
                    { value: "high", label: "High" },
                  ]}
                />
              </SettingRow>
            </>
          )}

          {tab === "voices" && <VoicesTab settings={settings} update={update} />}
        </div>

        <div className="settings-footer">
          <Button variant="primary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Voices tab: ElevenLabs key, the account's voice list (default-voice picker,
 * delete for cloned ones), and an in-app Instant Voice Clone flow — record a
 * mic sample and/or upload files, with an explicit consent gate.
 */
function VoicesTab({
  settings,
  update,
}: {
  settings: AppSettings;
  update: (patch: Partial<AppSettings>) => Promise<void>;
}): JSX.Element {
  const [status, setStatus] = useState({ configured: false, keyLocked: false });
  const [voices, setVoices] = useState<VoiceSummary[]>([]);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");
  const [cloneName, setCloneName] = useState("");
  const [samplePaths, setSamplePaths] = useState<string[]>([]);
  const [recording, setRecording] = useState<{ name: string; data: Uint8Array } | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [cloneError, setCloneError] = useState<string | null>(null);
  const sampleInput = useRef<HTMLInputElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);

  const refresh = useCallback(() => {
    window.api?.voicesStatus().then(setStatus).catch(() => {});
    window.api
      ?.listVoices()
      .then((r) => {
        setVoices(r.voices);
        setVoicesError(r.ok ? null : (r.error ?? null));
      })
      .catch(() => {});
  }, []);

  useEffect(refresh, [refresh]);

  const connectKey = async () => {
    if (!keyDraft.trim()) return;
    await update({ elevenLabsApiKey: keyDraft.trim() });
    setKeyDraft("");
    refresh();
  };

  const toggleRecord = async () => {
    if (isRecording) {
      recorder.current?.stop();
      recorder.current = null;
      setIsRecording(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      chunks.current = [];
      mr.ondataavailable = (e) => e.data.size > 0 && chunks.current.push(e.data);
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks.current, { type: "audio/webm" });
        setRecording({ name: `sample-${Date.now()}.webm`, data: new Uint8Array(await blob.arrayBuffer()) });
      };
      mr.start();
      recorder.current = mr;
      setIsRecording(true);
    } catch {
      setCloneError("Microphone unavailable.");
    }
  };

  const stageSamples = (files: FileList) => {
    const next = [...samplePaths];
    for (const f of Array.from(files)) {
      try {
        const p = window.api.getPathForFile(f);
        if (p && !next.includes(p)) next.push(p);
      } catch {
        // skip
      }
    }
    setSamplePaths(next);
  };

  const createVoice = async () => {
    if (busy) return;
    setBusy("Cloning voice…");
    setCloneError(null);
    try {
      const res = await window.api.cloneVoice({
        name: cloneName,
        paths: samplePaths,
        recording: recording ?? undefined,
        consent,
      });
      if (res.ok && res.voiceId) {
        setCloneName("");
        setSamplePaths([]);
        setRecording(null);
        setConsent(false);
        await update({ defaultVoiceId: res.voiceId });
        refresh();
      } else {
        setCloneError(res.error ?? "Cloning failed.");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="settings-key-row">
        <input
          className="settings-key-input"
          type="password"
          placeholder={
            status.keyLocked
              ? "API key configured via .env.local"
              : status.configured
                ? "Key saved — enter a new key to replace it"
                : "Enter your ElevenLabs API Key"
          }
          value={keyDraft}
          disabled={status.keyLocked}
          onChange={(e) => setKeyDraft(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void connectKey()}
        />
        <button
          className="settings-select-btn"
          onClick={() => void connectKey()}
          disabled={status.keyLocked || !keyDraft.trim()}
        >
          Connect
        </button>
      </div>

      {status.configured && (
        <>
          <SettingRow title="Narration voice" sub="Default voice for generated voiceovers">
            <SettingSelect
              value={settings.defaultVoiceId ?? ""}
              onChange={(v) => void update({ defaultVoiceId: v || undefined })}
              options={[
                { value: "", label: "Pick a voice" },
                ...voices.map((v) => ({ value: v.id, label: `${v.name}${v.category === "cloned" ? " (cloned)" : ""}` })),
              ]}
            />
          </SettingRow>
          {voicesError && <p className="settings-row-sub">{voicesError}</p>}
          {voices.filter((v) => v.category === "cloned").length > 0 && (
            <div className="clip-list clip-list-capped">
              {voices
                .filter((v) => v.category === "cloned")
                .map((v) => (
                  <div key={v.id} className="clip-row" title={v.id}>
                    <Icon name="voice-high" size={14} />
                    <span className="name">{v.name}</span>
                    <button
                      className="clip-row-remove"
                      title="Delete this cloned voice from your ElevenLabs account"
                      aria-label={`Delete ${v.name}`}
                      onClick={async () => {
                        await window.api.deleteVoice(v.id);
                        refresh();
                      }}
                    >
                      <Icon name="trash-can" size={12} />
                    </button>
                  </div>
                ))}
            </div>
          )}
          <Divider />

          <SettingRow title="Clone a voice" sub="1-5 minutes of clean speech. Requires a paid ElevenLabs plan.">
            <span />
          </SettingRow>
          <div className="settings-key-row">
            <input
              className="settings-key-input"
              type="text"
              placeholder="Voice name (e.g. Chris)"
              value={cloneName}
              onChange={(e) => setCloneName(e.target.value)}
            />
            <button className="settings-select-btn" onClick={() => void toggleRecord()}>
              {isRecording ? "Stop" : recording ? "Re-record" : "Record"}
            </button>
            <button className="settings-select-btn" onClick={() => sampleInput.current?.click()}>
              Upload
            </button>
          </div>
          <input
            ref={sampleInput}
            type="file"
            accept="audio/*"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files) stageSamples(e.target.files);
              e.target.value = "";
            }}
          />
          {(samplePaths.length > 0 || recording) && (
            <div className="clip-list clip-list-capped">
              {recording && (
                <div className="clip-row">
                  <Icon name="record" size={14} />
                  <span className="name">Mic recording</span>
                  <button
                    className="clip-row-remove"
                    aria-label="Remove recording"
                    onClick={() => setRecording(null)}
                  >
                    <Icon name="trash-can" size={12} />
                  </button>
                </div>
              )}
              {samplePaths.map((p) => (
                <div key={p} className="clip-row" title={p}>
                  <Icon name="voice-high" size={14} />
                  <span className="name">{p.split("/").pop()}</span>
                  <button
                    className="clip-row-remove"
                    aria-label={`Remove ${p}`}
                    onClick={() => setSamplePaths((prev) => prev.filter((x) => x !== p))}
                  >
                    <Icon name="trash-can" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <label className="insp-check">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            I have the person&apos;s consent (or it&apos;s my own voice) and the rights to clone it.
          </label>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void createVoice()}
            disabled={!!busy || !consent || !cloneName.trim() || (samplePaths.length === 0 && !recording)}
          >
            {busy ?? "Create voice"}
          </Button>
          {cloneError && <p className="settings-row-sub">{cloneError}</p>}
        </>
      )}
    </>
  );
}

function modelLabel(id: string): string {
  return id
    .replace(/^gpt-/, "GPT ")
    .replace(/^claude-/, "Claude ")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace("Gpt", "GPT");
}

function SettingRow({
  title,
  sub,
  subTitle,
  onSubClick,
  children,
}: {
  title: string;
  sub: string;
  subTitle?: string;
  onSubClick?: () => void;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="settings-row">
      <div className="settings-row-text">
        <div className="settings-row-title">{title}</div>
        <div
          className={`settings-row-sub ${onSubClick ? "clickable" : ""}`}
          title={subTitle}
          onClick={onSubClick}
        >
          {sub}
        </div>
      </div>
      {children}
    </div>
  );
}

function Divider(): JSX.Element {
  return <div className="settings-divider" />;
}

function SettingSelect({
  value,
  onChange,
  options,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  disabled?: boolean;
}): JSX.Element {
  return (
    <span className={`settings-select-btn ${disabled ? "disabled" : ""}`}>
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon name="chevron-top" size={16} style={{ transform: "rotate(180deg)" }} />
    </span>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }): JSX.Element {
  return (
    <button
      className={`switch ${on ? "on" : ""}`}
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      <span className="switch-knob" />
    </button>
  );
}

/** Gear button + modal in one — drop it into any bar (Home, editor header). */
export function SettingsButton(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton icon="settings-gear" label="Settings" onClick={() => setOpen(true)} />
      {open && <SettingsModal onClose={() => setOpen(false)} />}
    </>
  );
}
