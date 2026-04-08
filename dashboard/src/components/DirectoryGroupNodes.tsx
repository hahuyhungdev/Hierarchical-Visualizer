import { memo, useState, useRef, useCallback } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

interface DirGroupData {
  label: string;
  color: string;
  layerLabel: string;
  fileCount?: number;
  directoryPath?: string;
  highlighted?: boolean;
  dimmed?: boolean;
  active?: boolean;
  isExpanded?: boolean;
  searchMatch?: boolean;
  inCycle?: boolean;
  impacted?: boolean;
  apiMatch?: boolean;
  [key: string]: unknown;
}

/**
 * Collapsed directory group node — shows folder name + file count badge.
 * Double-click to expand.
 */
export const DirectoryGroupNode = memo(function DirectoryGroupNode({
  data,
  selected,
}: NodeProps & { data: DirGroupData }) {
  const d = data as DirGroupData;
  const isHl = d.highlighted || d.active;
  const isDim = d.dimmed && !d.active;
  const [showTooltip, setShowTooltip] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>();

  const onEnter = useCallback(() => {
    hoverTimer.current = setTimeout(() => setShowTooltip(true), 400);
  }, []);
  const onLeave = useCallback(() => {
    clearTimeout(hoverTimer.current);
    setShowTooltip(false);
  }, []);

  return (
    <div
      className={[
        "viz-node",
        "viz-node--directory",
        isHl && "viz-node--highlighted",
        isDim && "viz-node--dimmed",
        selected && "viz-node--selected",
        d.searchMatch && "viz-node--search-match",
        d.inCycle && "viz-node--cycle",
        d.impacted && "viz-node--impacted",
      ]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className="viz-node__accent viz-node__accent--dir" style={{ background: d.color }} />
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: d.color, width: 8, height: 8, border: "2px solid #0f172a" }}
      />
      <div className="viz-node__body">
        <div className="viz-node__header">
          <span className="viz-node__label">{d.label}</span>
          <span
            className="viz-node__badge viz-node__badge--count"
            style={{ background: `${d.color}33`, color: d.color, borderColor: `${d.color}55` }}
          >
            ×{d.fileCount}
          </span>
        </div>
        <div className="viz-node__path" style={{ opacity: 0.7 }}>
          {d.layerLabel} · dbl-click to expand
        </div>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: d.color, width: 8, height: 8, border: "2px solid #0f172a" }}
      />
      {showTooltip && (
        <div className="viz-tooltip">
          <div className="viz-tooltip__title">{d.label}</div>
          <div className="viz-tooltip__row">
            <span className="viz-tooltip__key">Files</span>
            {d.fileCount}
          </div>
          <div className="viz-tooltip__row">
            <span className="viz-tooltip__key">Layer</span>
            {d.layerLabel}
          </div>
          <div className="viz-tooltip__row" style={{ opacity: 0.6, fontSize: 11 }}>
            Double-click to expand
          </div>
        </div>
      )}
    </div>
  );
});

/**
 * Expanded directory group — container with title bar.
 * Children are rendered inside by React Flow's parent-child system.
 */
export const DirectoryGroupExpandedNode = memo(function DirectoryGroupExpandedNode({
  data,
  selected,
}: NodeProps & { data: DirGroupData }) {
  const d = data as DirGroupData;
  const isHl = d.highlighted || d.active;
  const isDim = d.dimmed && !d.active;

  return (
    <div
      className={[
        "viz-group-expanded",
        isHl && "viz-group-expanded--highlighted",
        isDim && "viz-group-expanded--dimmed",
        selected && "viz-group-expanded--selected",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{ width: "100%", height: "100%", borderColor: `${d.color}55` }}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: d.color, width: 8, height: 8, border: "2px solid #0f172a" }}
      />
      <div className="viz-group-expanded__header" style={{ borderBottomColor: `${d.color}33` }}>
        <span className="viz-group-expanded__label">{d.label}</span>
        <span
          className="viz-node__badge"
          style={{ background: `${d.color}33`, color: d.color, borderColor: `${d.color}55` }}
        >
          {d.fileCount} files
        </span>
        <span className="viz-group-expanded__hint">dbl-click to collapse</span>
      </div>
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: d.color, width: 8, height: 8, border: "2px solid #0f172a" }}
      />
    </div>
  );
});
