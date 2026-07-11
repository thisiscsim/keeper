import { useEffect, useRef, useState } from "react";
import { Button, Icon, IconButton } from "./ui";
import { useKeeper } from "../store";

export function Header(): JSX.Element {
  const view = useKeeper((s) => s.view);
  const setView = useKeeper((s) => s.setView);
  const summary = useKeeper((s) => s.summary);
  const searchQuery = useKeeper((s) => s.searchQuery);
  const runSearch = useKeeper((s) => s.runSearch);
  const clearSearch = useKeeper((s) => s.clearSearch);
  const searching = useKeeper((s) => s.searching);
  const searchMode = useKeeper((s) => s.searchMode);
  const setModal = useKeeper((s) => s.setModal);
  const toggleTheme = useKeeper((s) => s.toggleTheme);
  const importTask = useKeeper((s) => s.tasks.import);
  const importSources = useKeeper((s) => s.importSources);

  const [draft, setDraft] = useState(searchQuery);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setDraft(searchQuery);
  }, [searchQuery]);

  const onSearchChange = (value: string) => {
    setDraft(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(() => void runSearch(value), 350);
  };

  const startImport = async (mode: "files" | "folder") => {
    const picked = await window.api?.pickImportPaths(mode);
    if (!picked?.ok || !picked.paths || picked.paths.length === 0) return;
    await importSources(picked.paths);
  };

  const suggested = summary?.counts.suggested ?? 0;

  return (
    <header className="app-header">
      <div className="header-left">
        <Icon name="aperture-logomark" size={20} className="header-logo" />
        <span className="header-title">Keeper</span>
        <nav className="header-tabs">
          <button className={`header-tab ${view === "library" ? "active" : ""}`} onClick={() => setView("library")}>
            Library
          </button>
          <button className={`header-tab ${view === "review" ? "active" : ""}`} onClick={() => setView("review")}>
            Review
            {suggested > 0 && <span className="header-tab-count">{suggested.toLocaleString()}</span>}
          </button>
        </nav>
      </div>

      <div className="header-center">
        <div className={`search-box ${searching ? "busy" : ""}`}>
          <Icon name="circle-questionmark" size={14} className="search-icon" />
          <input
            className="search-input"
            placeholder="Search your library — “ocean at sunset”, “kids at dinner”…"
            value={draft}
            onChange={(e) => onSearchChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft("");
                clearSearch();
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === "Enter") void runSearch(draft);
            }}
          />
          {searchQuery && (
            <button
              className="search-clear"
              onClick={() => {
                setDraft("");
                clearSearch();
              }}
            >
              ×
            </button>
          )}
        </div>
        {searchMode === "metadata" && (
          <span className="search-mode-hint" title="Semantic index not built yet — matching names and tags only">
            basic match
          </span>
        )}
      </div>

      <div className="header-right">
        {importTask.running && (
          <span className="header-progress">
            <span className="header-progress-label">{importTask.phase || "importing"}</span>
            <span className="header-progress-track">
              <span className="header-progress-fill" style={{ width: `${importTask.progress}%` }} />
            </span>
          </span>
        )}
        <Button variant="secondary" size="sm" icon="folder" onClick={() => void startImport("folder")}>
          Import folder
        </Button>
        <Button variant="primary" size="sm" icon="square-arrow-down" onClick={() => void startImport("files")}>
          Import
        </Button>
        <IconButton icon="arrow-out-of-box" label="Export selects" onClick={() => setModal("export")} />
        <IconButton icon="form-square" label="Toggle theme (T)" onClick={toggleTheme} />
        <IconButton icon="settings-gear" label="Settings" onClick={() => setModal("settings")} />
      </div>
    </header>
  );
}
