import { useMemo, useState } from "react";
import type { AssetRecord } from "@keeper/schema";
import { Button, Icon } from "./ui";
import { useKeeper } from "../store";
import { reasonLabel, thumbUrl } from "../lib/format";

type QueueKey = "needs-eye" | "sure-reject" | "sure-keep";

const QUEUE_META: Record<QueueKey, { title: string; blurb: string }> = {
  "needs-eye": {
    title: "Needs your eye",
    blurb: "The AI wasn't sure. Decide each one — every choice teaches your taste profile.",
  },
  "sure-reject": {
    title: "Sure rejects",
    blurb: "High-confidence junk: misfires, black frames, hopeless blur. Spot-check, then confirm in bulk.",
  },
  "sure-keep": {
    title: "Sure keeps",
    blurb: "High-confidence keepers. Confirm in bulk or pull anything out.",
  },
};

/**
 * Review mode: verify the AI's pass queue by queue. The user only has to
 * really look at the uncertain middle; the confident ends are bulk-confirmable
 * (with everything undoable and nothing deleted).
 */
export function ReviewMode(): JSX.Element {
  const queues = useKeeper((s) => s.queues);
  const loading = useKeeper((s) => s.loadingQueues);
  const records = useKeeper((s) => s.records);
  const setVerdict = useKeeper((s) => s.setVerdict);
  const loadQueues = useKeeper((s) => s.loadQueues);
  const openLoupe = useKeeper((s) => s.openLoupe);
  const [tab, setTab] = useState<QueueKey>("needs-eye");

  // Live queue membership: an asset leaves its queue the moment it's decided.
  const lists = useMemo(() => {
    const result: Record<QueueKey, AssetRecord[]> = { "needs-eye": [], "sure-reject": [], "sure-keep": [] };
    if (!queues) return result;
    for (const key of Object.keys(result) as QueueKey[]) {
      result[key] = queues[key]
        .map((a) => records.get(a.id) ?? a)
        .filter((a) => a.user.flag === "unrated");
    }
    return result;
  }, [queues, records]);

  const total = lists["needs-eye"].length + lists["sure-reject"].length + lists["sure-keep"].length;

  if (loading && !queues) {
    return (
      <main className="review-mode empty">
        <div className="empty-state">Loading review queues…</div>
      </main>
    );
  }

  if (total === 0) {
    return (
      <main className="review-mode empty">
        <div className="empty-state">
          <Icon name="magic-wand" size={40} />
          <h2>All caught up</h2>
          <p>
            No AI suggestions waiting for review. Import media (and run AI review for the borderline calls) and
            the queues fill up here.
          </p>
          <Button variant="secondary" size="sm" icon="arrow-rotate" onClick={() => void loadQueues()}>
            Refresh
          </Button>
        </div>
      </main>
    );
  }

  const list = lists[tab];
  const meta = QUEUE_META[tab];

  const confirmAll = (key: QueueKey) => {
    const ids = lists[key].map((a) => a.id);
    if (ids.length === 0) return;
    void setVerdict(ids, { flag: key === "sure-reject" ? "reject" : "pick" });
  };

  return (
    <main className="review-mode">
      <div className="review-tabs">
        {(Object.keys(QUEUE_META) as QueueKey[]).map((key) => (
          <button key={key} className={`review-tab ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>
            {QUEUE_META[key].title}
            <span className="review-tab-count">{lists[key].length.toLocaleString()}</span>
          </button>
        ))}
        <div className="review-tabs-spacer" />
        {tab !== "needs-eye" && list.length > 0 && (
          <Button
            variant={tab === "sure-reject" ? "secondary" : "primary"}
            size="sm"
            onClick={() => confirmAll(tab)}
          >
            {tab === "sure-reject" ? `Confirm ${list.length} rejects` : `Confirm ${list.length} keeps`}
          </Button>
        )}
      </div>
      <p className="review-blurb">{meta.blurb}</p>

      <div className="review-list">
        {list.length === 0 ? (
          <div className="empty-state small">Queue clear.</div>
        ) : (
          list.map((asset) => (
            <ReviewCard key={asset.id} asset={asset} onOpen={() => openLoupe(asset.id)} />
          ))
        )}
      </div>
    </main>
  );
}

/** One reviewable item: evidence left (zoom crop / twin), verdict right. */
function ReviewCard({ asset, onOpen }: { asset: AssetRecord; onOpen: () => void }): JSX.Element {
  const records = useKeeper((s) => s.records);
  const setVerdict = useKeeper((s) => s.setVerdict);
  const ai = asset.ai;
  const reason = ai?.reasons[0];
  const twin = reason?.refAssetId ? records.get(reason.refAssetId) : undefined;
  const isBlurReason = reason?.code === "blurry" || reason?.code === "soft-focus";

  return (
    <div className="review-card">
      <button className="review-thumb" onClick={onOpen} title="Open full size">
        <img src={thumbUrl(asset)} alt="" loading="lazy" draggable={false} />
      </button>

      {isBlurReason && asset.thumbRel && (
        <div className="review-evidence" title="Center crop, 3x — judge the focus">
          <div className="evidence-zoom">
            <img src={thumbUrl(asset)} alt="" loading="lazy" draggable={false} />
          </div>
          <span className="evidence-label">3× crop</span>
        </div>
      )}

      {twin && (
        <button
          className="review-evidence"
          onClick={() => useKeeper.getState().openLoupe(twin.id)}
          title={`The sharper twin: ${twin.fileName}`}
        >
          <img src={thumbUrl(twin)} alt="" loading="lazy" draggable={false} />
          <span className="evidence-label">vs. pick</span>
        </button>
      )}

      <div className="review-meta">
        <div className="review-filename">{asset.fileName}</div>
        <div className="review-reasons">
          {ai?.reasons.map((r, i) => (
            <span key={i} className="reason-chip" title={r.detail}>
              {reasonLabel(r.code)}
            </span>
          ))}
          {ai && <span className="review-conf">{Math.round(ai.confidence * 100)}% · {ai.source}</span>}
        </div>
        {reason?.detail && <div className="review-detail">{reason.detail}</div>}
      </div>

      <div className="review-actions">
        <Button
          size="sm"
          variant={ai?.suggestion === "keep" ? "primary" : "secondary"}
          onClick={() => void setVerdict([asset.id], { flag: "pick" })}
        >
          ✓ Keep
        </Button>
        <Button
          size="sm"
          variant={ai?.suggestion === "reject" ? "primary" : "secondary"}
          onClick={() => void setVerdict([asset.id], { flag: "reject" })}
        >
          ✕ Reject
        </Button>
      </div>
    </div>
  );
}
