import { useEffect, useState } from "react";
import type { ReasonCode, TasteProfile } from "@keeper/schema";
import { Button, Field, Input, Modal } from "./ui";
import { useKeeper } from "../store";
import { reasonLabel } from "../lib/format";

/**
 * The taste profile: standing rules (injected into every AI judgment), the
 * override tallies that tune CV thresholds, and the recent corrections the
 * model learns from. Fully user-inspectable — no invisible learning.
 */
export function TasteModal(): JSX.Element {
  const setModal = useKeeper((s) => s.setModal);
  const [taste, setTaste] = useState<TasteProfile | null>(null);
  const [draft, setDraft] = useState("");

  const load = async () => {
    const res = await window.api?.getTaste();
    if (res?.ok && res.result) setTaste(res.result);
  };
  useEffect(() => {
    void load();
  }, []);

  const addRule = async () => {
    if (!draft.trim()) return;
    await window.api?.addTasteRule(draft.trim());
    setDraft("");
    await load();
  };

  const removeRule = async (id: string) => {
    await window.api?.removeTasteRule(id);
    await load();
  };

  const stats = Object.entries(taste?.stats ?? {}).filter(([, s]) => s.kept + s.confirmed > 0);

  return (
    <Modal
      title="Taste profile"
      onClose={() => setModal(null)}
      width={480}
      footer={
        <Button variant="primary" onClick={() => setModal(null)}>
          Done
        </Button>
      }
    >
      <Field label="Standing rules (the AI follows these on every run)">
        <div className="settings-row">
          <Input
            value={draft}
            placeholder="e.g. Never auto-reject photos of people, even if soft"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void addRule()}
          />
          <Button size="sm" variant="secondary" onClick={() => void addRule()} disabled={!draft.trim()}>
            Add
          </Button>
        </div>
      </Field>
      {taste && taste.rules.length > 0 && (
        <ul className="taste-rules">
          {taste.rules.map((rule) => (
            <li key={rule.id}>
              <span>{rule.text}</span>
              <button className="taste-rule-remove" onClick={() => void removeRule(rule.id)} title="Remove rule">
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      {stats.length > 0 && (
        <Field label="What Keeper has learned from your overrides">
          <ul className="taste-stats">
            {stats.map(([code, s]) => (
              <li key={code}>
                <span>{reasonLabel(code as ReasonCode)}</span>
                <span className="taste-stat-numbers">
                  {s.confirmed} confirmed · {s.kept} overridden
                </span>
              </li>
            ))}
          </ul>
        </Field>
      )}

      <p className="modal-hint">
        Every time you contradict an AI suggestion, that example is remembered ({taste?.exemplars.length ?? 0} so
        far, most recent kept) and fed to future AI runs; repeated overrides also loosen or tighten the local
        blur/exposure thresholds. Stored in <code>taste.json</code> in your library — delete it to start fresh.
      </p>
    </Modal>
  );
}
