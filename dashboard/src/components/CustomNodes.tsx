import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

interface VizNodeData {
  label: string;
  filePath: string | null;
  layer: string;
  layerLabel: string;
  color: string;
  routes: string[];
  apiCalls: string[];
  importCount: number;
  isGroup: boolean;
  active?: boolean;
  highlighted?: boolean;
  dimmed?: boolean;
}

export const VizNode = memo(function VizNode({
  data,
  selected,
}: NodeProps & { data: VizNodeData }) {
  const d = data as VizNodeData;
  const isHl = d.highlighted || d.active;
  const isDim = d.dimmed && !d.active;

  return (
    <div
      className={[
        "viz-node",
        isHl && "viz-node--highlighted",
        isDim && "viz-node--dimmed",
        d.active && "viz-node--active",
        selected && "viz-node--selected",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {/* Colored left accent bar */}
      <div className="viz-node__accent" style={{ background: d.color }} />

      <Handle
        type="target"
        position={Position.Top}
        style={{ background: d.color, width: 8, height: 8, border: "2px solid #0f172a" }}
      />

      <div className="viz-node__body">
        <div className="viz-node__header">
          <span className="viz-node__label">{d.label}</span>
          <span
            className="viz-node__badge"
            style={{ background: `${d.color}1A`, color: d.color, borderColor: `${d.color}33` }}
          >
            {d.layerLabel}
          </span>
        </div>
        {d.filePath && <div className="viz-node__path">{d.filePath}</div>}
        {d.routes.length > 0 && (
          <div className="viz-node__routes">
            {d.routes.map((r, i) => (
              <span key={i} className="viz-node__route">{r}</span>
            ))}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: d.color, width: 8, height: 8, border: "2px solid #0f172a" }}
      />
    </div>
  );
});
