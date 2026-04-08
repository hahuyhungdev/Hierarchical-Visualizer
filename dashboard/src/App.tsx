import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { VizNode } from "./components/CustomNodes";
import { useWebSocket } from "./hooks/useWebSocket";
import { buildFlowElements, LAYER_COLORS, type LayerBand, type VizNodeData } from "./layout";
import type { StructureData } from "./types";

const API_BASE = "/api";

const nodeTypes = { vizNode: VizNode };

export default function App() {
  const [repoPath, setRepoPath] = useState("");
  const [structure, setStructure] = useState<StructureData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [layerBands, setLayerBands] = useState<LayerBand[]>([]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const { connected, activeNodes, events, structureUpdate } = useWebSocket();

  // ─── Load initial structure ───
  useEffect(() => {
    fetch(`${API_BASE}/structure`)
      .then((r) => {
        if (r.ok) return r.json();
        throw new Error("No data");
      })
      .then((d: StructureData) => {
        setStructure(d);
        setRepoPath(d.repoPath);
      })
      .catch(() => {});
  }, []);

  // ─── Live structure update from WebSocket ───
  useEffect(() => {
    if (structureUpdate) setStructure(structureUpdate as StructureData);
  }, [structureUpdate]);

  // ─── Recalculate layout ───
  useEffect(() => {
    if (!structure) return;
    const result = buildFlowElements(structure, collapsedGroups, selectedNodeId);
    setNodes(result.nodes);
    setEdges(result.edges);
    setLayerBands(result.layerBands);
  }, [structure, collapsedGroups, selectedNodeId, setNodes, setEdges]);

  // ─── Runtime active-node glow ───
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const d = n.data as VizNodeData;
        const isActive = activeNodes.some(
          (an) =>
            n.id.toLowerCase().includes(an.toLowerCase()) ||
            an.toLowerCase().includes(d.label.replace(/ [▸▾]$/, "").toLowerCase())
        );
        if (d.active === isActive) return n;
        return { ...n, data: { ...d, active: isActive } };
      })
    );
  }, [activeNodes, setNodes]);

  // ─── Scan handler ───
  const handleScan = useCallback(async () => {
    if (!repoPath.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoPath: repoPath.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      const struct = await fetch(`${API_BASE}/structure`).then((r) => r.json());
      setStructure(struct);
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [repoPath]);

  // ─── Node click → highlight subgraph; click background → clear ───
  const onNodeClick: NodeMouseHandler = useCallback((_event, node) => {
    setSelectedNodeId((prev) => (prev === node.id ? null : node.id));
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  // ─── Double-click → collapse/expand ───
  const onNodeDoubleClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      if (!structure) return;
      const isGroupParent = structure.groups.some(
        (g) => g.parentId === node.id && g.childIds.length > 0
      );
      if (isGroupParent) {
        setCollapsedGroups((prev) => {
          const next = new Set(prev);
          if (next.has(node.id)) next.delete(node.id);
          else next.add(node.id);
          return next;
        });
      }
    },
    [structure]
  );

  // ─── Legend ───
  const legendItems = useMemo(
    () => [
      { color: LAYER_COLORS.page, label: "Pages" },
      { color: LAYER_COLORS.feature, label: "Features" },
      { color: LAYER_COLORS.shared, label: "Shared / UI" },
      { color: LAYER_COLORS.api_service, label: "API Services" },
      { color: LAYER_COLORS.api_endpoint, label: "Endpoints" },
    ],
    []
  );

  return (
    <div className="app-layout">
      {/* ─── Toolbar ─── */}
      <div className="toolbar">
        <h1>⬡ Repo Visualizer</h1>
        <input
          type="text"
          placeholder="Absolute path to React repository..."
          value={repoPath}
          onChange={(e) => setRepoPath(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleScan()}
        />
        <button onClick={handleScan} disabled={loading || !repoPath.trim()}>
          {loading ? "Scanning…" : "⟳ Sync"}
        </button>
        <span className="status">
          <span className={`ws-dot ${connected ? "connected" : "disconnected"}`} />
          {connected ? "Live" : "Offline"}
        </span>
        {error && <span style={{ color: "var(--danger)", fontSize: 12 }}>{error}</span>}
      </div>

      {/* ─── Metadata bar ─── */}
      {structure && (
        <div className="metadata-bar">
          <span>Files: <strong>{structure.metadata.analyzedFiles}</strong> / {structure.metadata.totalFiles}</span>
          <span>Tree-shaked: <strong>{structure.metadata.treeShakedFiles}</strong></span>
          <span>Edges: <strong>{structure.metadata.totalEdges}</strong></span>
          <span>Endpoints: <strong>{structure.metadata.apiEndpoints}</strong></span>
          <span>Active: <strong>{activeNodes.length}</strong></span>
        </div>
      )}

      {/* ─── Diagram ─── */}
      <div className="diagram-container" style={{ flex: 1 }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onNodeDoubleClick={onNodeDoubleClick}
          onPaneClick={onPaneClick}
          fitView
          minZoom={0.1}
          maxZoom={3}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="#1e293b" gap={24} size={1} />
          <Controls position="bottom-right" />
          <MiniMap
            nodeColor={(n) => (n.data as VizNodeData).color || "#475569"}
            maskColor="rgba(15,23,42,0.85)"
            style={{ background: "#0f172a", borderRadius: 8 }}
          />
        </ReactFlow>

        {/* ─── Legend ─── */}
        <div className="legend">
          {legendItems.map((item) => (
            <div className="legend-item" key={item.label}>
              <div className="legend-dot" style={{ background: item.color }} />
              {item.label}
            </div>
          ))}
          <div className="legend-hint">Click node to highlight · Double-click to collapse</div>
        </div>

        {/* ─── Event Log ─── */}
        {events.length > 0 && (
          <div className="event-log">
            <div className="event-log-header">
              <span>Runtime Events</span>
              <span style={{ color: "var(--text-muted)" }}>{events.length}</span>
            </div>
            <div className="event-log-body">
              {[...events].reverse().map((ev, i) => (
                <div className="event-entry" key={i}>
                  <span
                    className="event-type"
                    style={{
                      color:
                        ev.eventType === "mount"
                          ? "var(--success)"
                          : ev.eventType === "click"
                          ? "var(--warning)"
                          : ev.eventType === "unmount"
                          ? "var(--danger)"
                          : "var(--accent)",
                    }}
                  >
                    {ev.eventType}
                  </span>
                  <span className="event-component">{ev.componentName}</span>
                  <span className="event-time">
                    {new Date(ev.timestamp).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
