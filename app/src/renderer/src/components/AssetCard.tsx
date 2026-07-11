import type { AssetRecord } from "@keeper/schema";
import { Icon } from "./ui";
import { formatDuration, reasonLabel, thumbUrl } from "../lib/format";
import { useKeeper } from "../store";

/**
 * One cell in the grid: thumbnail + verdict/AI badges. Click selects
 * (shift = range, cmd = toggle), double-click opens the loupe.
 */
export function AssetCard({ asset }: { asset: AssetRecord }): JSX.Element {
  const selected = useKeeper((s) => s.selected.has(asset.id));
  const select = useKeeper((s) => s.select);
  const openLoupe = useKeeper((s) => s.openLoupe);

  const flag = asset.user.flag;
  const ai = asset.ai;
  const aiChip =
    flag === "unrated" && ai && ai.suggestion !== "review"
      ? { kind: ai.suggestion, label: reasonLabel(ai.reasons[0]?.code ?? "other") }
      : null;

  return (
    <div
      className={`asset-card ${selected ? "selected" : ""} flag-${flag}`}
      onClick={(e) => select(asset.id, { shift: e.shiftKey, toggle: e.metaKey || e.ctrlKey })}
      onDoubleClick={() => openLoupe(asset.id)}
      title={asset.fileName}
    >
      <div className="asset-thumb">
        {asset.thumbRel ? (
          <img src={thumbUrl(asset)} alt="" loading="lazy" draggable={false} />
        ) : (
          <div className="asset-thumb-placeholder">
            <Icon name="multi-media" size={20} />
          </div>
        )}
        {asset.mediaType === "video" && (
          <span className="asset-video-badge">
            <Icon name="play-circle" size={12} />
            {formatDuration(asset.durationSec)}
          </span>
        )}
        {asset.format === "raw" && <span className="asset-format-badge">RAW</span>}
        {asset.groupId && <span className="asset-group-badge" title="Part of a burst group">≡</span>}
        {flag !== "unrated" && (
          <span className={`asset-flag asset-flag-${flag}`}>{flag === "pick" ? "✓" : "✕"}</span>
        )}
        {aiChip && (
          <span className={`asset-ai-chip ai-${aiChip.kind}`} title={`AI suggests ${aiChip.kind}: ${aiChip.label}`}>
            {aiChip.kind === "keep" ? "AI ✓" : "AI ✕"}
          </span>
        )}
      </div>
      {asset.user.rating > 0 && (
        <div className="asset-stars">{"★".repeat(asset.user.rating)}</div>
      )}
    </div>
  );
}
