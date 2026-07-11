import { useEffect, useState } from "react";
import type { AssetRecord, Group } from "@keeper/schema";
import { Button, Icon, IconButton } from "./ui";
import { useKeeper } from "../store";
import { cameraLine, formatBytes, originalUrl, previewUrl, reasonLabel, thumbUrl } from "../lib/format";

/** Full-size viewer overlay: media + verdict bar + info + burst-group strip. */
export function Loupe(): JSX.Element | null {
  const activeId = useKeeper((s) => s.activeId);
  const records = useKeeper((s) => s.records);
  const closeLoupe = useKeeper((s) => s.closeLoupe);
  const navLoupe = useKeeper((s) => s.navLoupe);
  const setVerdict = useKeeper((s) => s.setVerdict);
  const openLoupe = useKeeper((s) => s.openLoupe);
  const mergeRecords = useKeeper((s) => s.mergeRecords);
  const flatIds = useKeeper((s) => s.flatIds);

  const asset = activeId ? records.get(activeId) : undefined;
  const [zoomed, setZoomed] = useState(false);
  const [group, setGroup] = useState<Group | null>(null);

  useEffect(() => {
    setZoomed(false);
    setGroup(null);
    if (!asset?.groupId) return;
    let cancelled = false;
    void window.api?.getGroup(asset.groupId).then(async (res) => {
      if (cancelled || !res?.ok || !res.result) return;
      setGroup(res.result);
      const missing = res.result.assetIds.filter((id) => !useKeeper.getState().records.has(id));
      if (missing.length > 0) {
        const fetched = await window.api?.getAssets(missing);
        if (!cancelled && fetched?.ok && fetched.result) mergeRecords(fetched.result);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [asset?.id, asset?.groupId, mergeRecords]);

  if (!asset) return null;

  const flat = flatIds();
  const idx = flat.indexOf(asset.id);
  const ai = asset.ai;

  return (
    <div className="loupe-overlay" onClick={closeLoupe}>
      <div className="loupe" onClick={(e) => e.stopPropagation()}>
        <div className="loupe-stage">
          <button className="loupe-nav prev" onClick={() => navLoupe(-1)} disabled={idx <= 0} aria-label="Previous">
            ‹
          </button>
          <div className={`loupe-media ${zoomed ? "zoomed" : ""}`} onClick={() => setZoomed(!zoomed)}>
            {asset.mediaType === "video" ? (
              <video key={asset.id} src={originalUrl(asset)} poster={previewUrl(asset)} controls autoPlay={false} />
            ) : (
              <img key={asset.id} src={previewUrl(asset)} alt={asset.fileName} draggable={false} />
            )}
          </div>
          <button
            className="loupe-nav next"
            onClick={() => navLoupe(1)}
            disabled={idx < 0 || idx >= flat.length - 1}
            aria-label="Next"
          >
            ›
          </button>
        </div>

        <aside className="loupe-side">
          <div className="loupe-side-header">
            <span className="loupe-filename" title={asset.fileName}>
              {asset.fileName}
            </span>
            <IconButton icon="finder" label="Reveal original" onClick={() => void window.api?.revealAsset(asset.id)} />
            <IconButton icon="chevron-top" label="Close (Esc)" onClick={closeLoupe} />
          </div>

          <VerdictBar asset={asset} />

          {ai && asset.user.flag === "unrated" && (
            <div className={`loupe-ai ai-${ai.suggestion}`}>
              <div className="loupe-ai-title">
                <Icon name="magic-wand" size={13} />
                AI suggests <strong>{ai.suggestion}</strong>
                <span className="loupe-ai-conf">{Math.round(ai.confidence * 100)}%</span>
              </div>
              <div className="loupe-ai-reasons">
                {ai.reasons.map((r, i) => (
                  <span key={i} className="reason-chip" title={r.detail}>
                    {reasonLabel(r.code)}
                  </span>
                ))}
              </div>
              <div className="loupe-ai-actions">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void setVerdict([asset.id], { flag: ai.suggestion === "reject" ? "reject" : "pick" })}
                >
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void setVerdict([asset.id], { flag: ai.suggestion === "reject" ? "pick" : "reject" })}
                >
                  Override
                </Button>
              </div>
            </div>
          )}

          {group && <GroupStrip group={group} current={asset} onOpen={openLoupe} />}

          <div className="loupe-info">
            {asset.caption && <p className="loupe-caption">{asset.caption}</p>}
            <InfoRow label="Captured" value={asset.capturedAt ? new Date(asset.capturedAt).toLocaleString() : "unknown"} />
            <InfoRow label="Camera" value={cameraLine(asset) || "—"} />
            <InfoRow
              label="Size"
              value={`${asset.width ?? "?"}×${asset.height ?? "?"} · ${formatBytes(asset.byteSize)}`}
            />
            <InfoRow label="Format" value={asset.format.toUpperCase()} />
            {asset.quality.blurScore !== undefined && (
              <InfoRow label="Sharpness" value={String(Math.round(asset.quality.blurScore))} />
            )}
            {asset.tags.length > 0 && (
              <div className="loupe-tags">
                {asset.tags.slice(0, 12).map((tag) => (
                  <span key={tag} className="reason-chip">
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="info-row">
      <span className="info-label">{label}</span>
      <span className="info-value">{value}</span>
    </div>
  );
}

export function VerdictBar({ asset }: { asset: AssetRecord }): JSX.Element {
  const setVerdict = useKeeper((s) => s.setVerdict);
  const flag = asset.user.flag;
  return (
    <div className="verdict-bar">
      <button
        className={`verdict-btn keep ${flag === "pick" ? "active" : ""}`}
        onClick={() => void setVerdict([asset.id], { flag: flag === "pick" ? "unrated" : "pick" })}
        title="Keep (P)"
      >
        ✓ Keep
      </button>
      <button
        className={`verdict-btn reject ${flag === "reject" ? "active" : ""}`}
        onClick={() => void setVerdict([asset.id], { flag: flag === "reject" ? "unrated" : "reject" })}
        title="Reject (X)"
      >
        ✕ Reject
      </button>
      <span className="verdict-stars">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            className={`star ${asset.user.rating >= n ? "on" : ""}`}
            onClick={() => void setVerdict([asset.id], { rating: asset.user.rating === n ? 0 : n })}
            title={`${n} star${n > 1 ? "s" : ""} (${n})`}
          >
            ★
          </button>
        ))}
      </span>
    </div>
  );
}

/** Burst-group compare strip: every frame, the pick highlighted. */
function GroupStrip({
  group,
  current,
  onOpen,
}: {
  group: Group;
  current: AssetRecord;
  onOpen: (id: string) => void;
}): JSX.Element {
  const records = useKeeper((s) => s.records);
  return (
    <div className="group-strip">
      <div className="loupe-ai-title">
        <Icon name="multi-media" size={13} />
        Burst group · {group.assetIds.length} frames
      </div>
      <div className="group-thumbs">
        {group.assetIds.map((id) => {
          const member = records.get(id);
          if (!member) return null;
          const isPick = group.bestPickId === id;
          return (
            <button
              key={id}
              className={`group-thumb ${id === current.id ? "current" : ""} ${isPick ? "pick" : ""}`}
              onClick={() => onOpen(id)}
              title={`${member.fileName}${isPick ? " — AI pick" : ""}${
                member.quality.blurScore !== undefined ? ` · sharpness ${Math.round(member.quality.blurScore)}` : ""
              }`}
            >
              <img src={thumbUrl(member)} alt="" loading="lazy" draggable={false} />
              {isPick && <span className="group-pick-badge">pick</span>}
            </button>
          );
        })}
      </div>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          void window.api?.setGroupPick({ groupId: group.id, assetId: current.id });
        }}
        disabled={group.bestPickId === current.id}
      >
        Make this the pick
      </Button>
    </div>
  );
}
