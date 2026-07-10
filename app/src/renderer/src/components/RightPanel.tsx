import { useEditor, type RightTab } from "../store";
import { InspectorPanel } from "./InspectorPanel";
import { StylePanel } from "./StylePanel";
import { CritiquePanel } from "./CritiquePanel";

const TABS: { id: RightTab; label: string }[] = [
  { id: "inspector", label: "Inspector" },
  { id: "style", label: "Style" },
  { id: "critique", label: "Critique" },
];

export function RightPanel(): JSX.Element {
  const tab = useEditor((s) => s.rightTab);
  const setTab = useEditor((s) => s.setRightTab);

  return (
    <aside className="right-panel">
      <div className="rp-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`rp-tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="rp-body">
        {tab === "inspector" && <InspectorPanel />}
        {tab === "style" && <StylePanel />}
        {tab === "critique" && <CritiquePanel />}
      </div>
    </aside>
  );
}
