import { useEffect, useState } from "react";
import type { AppSettings } from "../../../preload";
import { Button, Field, Input, Modal, Select } from "./ui";
import { useKeeper } from "../store";

export function SettingsModal(): JSX.Element {
  const setModal = useKeeper((s) => s.setModal);
  const setNotice = useKeeper((s) => s.setNotice);
  const home = useKeeper((s) => s.home);

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [judge, setJudge] = useState<{ modelLocked: boolean; keyLocked: boolean; configured: boolean } | null>(null);
  const [tab, setTab] = useState<"general" | "ai">("general");

  useEffect(() => {
    void window.api?.getSettings().then((res) => res?.ok && res.settings && setSettings(res.settings));
    void window.api?.judgeInfo().then((info) => {
      if (info?.ok) setJudge({ modelLocked: info.modelLocked, keyLocked: info.keyLocked, configured: info.configured });
    });
  }, []);

  const patch = async (p: Partial<AppSettings>) => {
    const res = await window.api?.setSettings(p);
    if (res?.ok && res.settings) setSettings(res.settings);
  };

  const pickLibrary = async () => {
    const res = await window.api?.pickLibrary();
    if (res?.ok && res.dir) {
      setNotice({ kind: "info", text: `Library set to ${res.dir}. Restart Keeper to apply.` });
    }
  };

  return (
    <Modal
      title="Settings"
      onClose={() => setModal(null)}
      width={480}
      footer={
        <Button variant="primary" onClick={() => setModal(null)}>
          Done
        </Button>
      }
    >
      <div className="settings-tabs">
        <button className={`review-tab ${tab === "general" ? "active" : ""}`} onClick={() => setTab("general")}>
          General
        </button>
        <button className={`review-tab ${tab === "ai" ? "active" : ""}`} onClick={() => setTab("ai")}>
          AI
        </button>
      </div>

      {!settings ? (
        <p>Loading…</p>
      ) : tab === "general" ? (
        <>
          <Field label="Library location">
            <div className="settings-row">
              <code className="settings-path">{home ?? "…"}</code>
              <Button size="sm" variant="secondary" onClick={() => void pickLibrary()}>
                Change…
              </Button>
            </div>
          </Field>
          <p className="modal-hint">
            Originals are copied into <code>library/YYYY/YYYY-MM-DD/</code>; Keeper's own data lives in{" "}
            <code>.keeper/</code>. Changing the location applies after a restart.
          </p>
          <Field label="Playback">
            <label className="radio-option">
              <input
                type="checkbox"
                checked={settings.hwDecode}
                onChange={(e) => void patch({ hwDecode: e.target.checked })}
              />
              Hardware video decode (HEVC playback; needs restart)
            </label>
          </Field>
        </>
      ) : (
        <>
          <Field label="Model">
            <Input
              value={settings.agentModel}
              disabled={judge?.modelLocked}
              onChange={(e) => void patch({ agentModel: e.target.value })}
              placeholder="gpt-5.5"
            />
          </Field>
          <Field label="API key">
            <Input
              type="password"
              value={settings.agentApiKey ?? ""}
              disabled={judge?.keyLocked}
              onChange={(e) => void patch({ agentApiKey: e.target.value })}
              placeholder={judge?.keyLocked ? "set via .env.local (locked)" : "sk-…"}
            />
          </Field>
          <Field label="Reasoning effort">
            <Select
              value={settings.reasoningEffort}
              onChange={(e) => void patch({ reasoningEffort: e.target.value as AppSettings["reasoningEffort"] })}
            >
              <option value="low">Low (fast, cheap)</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </Select>
          </Field>
          <Field label="AI budget per run">
            <Input
              type="number"
              min={1}
              max={5000}
              value={settings.aiBudget}
              onChange={(e) => void patch({ aiBudget: Number(e.target.value) })}
            />
          </Field>
          <Field label="After import">
            <label className="radio-option">
              <input
                type="checkbox"
                checked={settings.autoJudge}
                onChange={(e) => void patch({ autoJudge: e.target.checked })}
              />
              Automatically run AI review on borderline items
            </label>
          </Field>
          <p className="modal-hint">
            What leaves your machine: only downscaled thumbnails of borderline items, capped by the budget above.
            Culling metrics, grouping, and search embeddings run entirely locally. With no key set, everything
            still works offline — you just review the borderline items yourself.
          </p>
        </>
      )}
    </Modal>
  );
}
