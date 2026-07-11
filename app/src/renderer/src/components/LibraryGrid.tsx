import { useEffect, useRef } from "react";
import { AssetCard } from "./AssetCard";
import { Icon } from "./ui";
import { useKeeper } from "../store";
import { formatDay } from "../lib/format";

/**
 * The date-sectioned library grid. Sections are lazy: a day's assets are only
 * fetched when its section scrolls near the viewport (IntersectionObserver),
 * so a 50k library opens instantly.
 */
export function LibraryGrid(): JSX.Element {
  const days = useKeeper((s) => s.days);
  const summary = useKeeper((s) => s.summary);
  const searchResults = useKeeper((s) => s.searchResults);
  const clearSelection = useKeeper((s) => s.clearSelection);

  if (searchResults) return <SearchResults />;

  if (days.length === 0) {
    return (
      <main className="library-grid empty">
        <div className="empty-state">
          <Icon name="clapboard-sparkle" size={40} />
          <h2>{summary && summary.counts.total > 0 ? "Nothing matches this filter" : "Your library is empty"}</h2>
          <p>
            {summary && summary.counts.total > 0
              ? "Try a different filter on the left."
              : "Import a folder, SD card, or a batch of files — Keeper copies them into your library, sorts them by date, and flags the junk for you."}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="library-grid" onClick={(e) => e.target === e.currentTarget && clearSelection()}>
      {days.map((bucket) => (
        <DaySection key={bucket.day} day={bucket.day} count={bucket.count} />
      ))}
    </main>
  );
}

function DaySection({ day, count }: { day: string; count: number }): JSX.Element {
  const ids = useKeeper((s) => s.dayIds[day]);
  const loadDay = useKeeper((s) => s.loadDay);
  const setVerdict = useKeeper((s) => s.setVerdict);
  const records = useKeeper((s) => s.records);
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || ids) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadDay(day);
      },
      { rootMargin: "600px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [day, ids, loadDay]);

  const assets = ids?.map((id) => records.get(id)).filter(Boolean) ?? [];
  // Reserve approximate space before load so the scrollbar doesn't jump.
  const estimatedRows = Math.ceil(count / 8);

  return (
    <section ref={ref} className="day-section">
      <header className="day-header">
        <h3>{formatDay(day)}</h3>
        <span className="day-count">{count.toLocaleString()}</span>
        {ids && ids.length > 0 && (
          <button
            className="day-select-all"
            onClick={() => setVerdictAll(ids, setVerdict)}
            title="Keep everything in this day"
          >
            Keep all
          </button>
        )}
      </header>
      {ids ? (
        <div className="day-grid">
          {assets.map((asset) => asset && <AssetCard key={asset.id} asset={asset} />)}
        </div>
      ) : (
        <div className="day-grid placeholder" style={{ minHeight: estimatedRows * 132 }}>
          <span className="day-loading">Loading…</span>
        </div>
      )}
    </section>
  );
}

function setVerdictAll(
  ids: string[],
  setVerdict: (ids: string[], patch: { flag: "pick" }) => Promise<void>,
): void {
  void setVerdict(ids, { flag: "pick" });
}

function SearchResults(): JSX.Element {
  const searchResults = useKeeper((s) => s.searchResults);
  const searchMode = useKeeper((s) => s.searchMode);
  const searchQuery = useKeeper((s) => s.searchQuery);
  const records = useKeeper((s) => s.records);
  const clearSearch = useKeeper((s) => s.clearSearch);

  const results = searchResults ?? [];

  return (
    <main className="library-grid">
      <section className="day-section">
        <header className="day-header">
          <h3>
            {results.length > 0
              ? `${results.length} result${results.length === 1 ? "" : "s"} for “${searchQuery.trim()}”`
              : `No results for “${searchQuery.trim()}”`}
          </h3>
          {searchMode === "metadata" && <span className="day-count">name/tag match</span>}
          <button className="day-select-all" onClick={clearSearch}>
            Back to library
          </button>
        </header>
        <div className="day-grid">
          {results.map((r) => {
            const asset = records.get(r.assetId);
            return asset ? <AssetCard key={r.assetId} asset={asset} /> : null;
          })}
        </div>
      </section>
    </main>
  );
}
