/**
 * ELK-based layout engine with directory grouping.
 *
 * Groups file nodes by parent directory into compound nodes.
 * - Default: collapsed (directory node with badge showing file count)
 * - Double-click: expand to show contained files in a grid
 * - Edges between collapsed groups are aggregated
 */

import ELK, {
  type ElkNode,
  type ElkExtendedEdge,
  type LayoutOptions,
} from "elkjs/lib/elk.bundled.js";
import type { Node, Edge } from "@xyflow/react";
import type { StructureData, StructureNode } from "./types";

export const LAYER_COLORS: Record<string, string> = {
  page: "#818cf8",
  feature: "#22d3ee",
  shared: "#34d399",
  api_service: "#fbbf24",
  api_endpoint: "#f87171",
};

export interface VizNodeData {
  label: string;
  filePath: string | null;
  layer: string;
  layerLabel: string;
  color: string;
  routes: string[];
  apiCalls: string[];
  importCount: number;
  lineCount: number;
  isGroup: boolean;
  highlighted: boolean;
  dimmed: boolean;
  active: boolean;
  isDirectoryGroup?: boolean;
  isExpanded?: boolean;
  fileCount?: number;
  directoryPath?: string;
  heatmapIntensity?: number;
  heatmapCount?: number;
  inCycle?: boolean;
  impacted?: boolean;
  apiMatch?: boolean;
  searchMatch?: boolean;
  [key: string]: unknown;
}

export interface LayerBand {
  label: string;
  color: string;
  y: number;
  height: number;
}

// ── Helpers ──

/** Extract parent directory from filePath: "src/hooks/useAuth.ts" → "hooks" */
function getDirectoryGroup(filePath: string | null): string | null {
  if (!filePath) return null;
  const parts = filePath.replace(/\\/g, "/").split("/");
  parts.pop(); // remove filename
  if (parts.length <= 1) return null; // top-level file → no group
  const start = parts[0] === "src" ? 1 : 0;
  if (start >= parts.length) return null;
  return parts.slice(start).join("/");
}

function groupNodeId(dir: string, layer: string): string {
  return `__group__${layer}__${dir}`;
}

// ── Connected subgraph BFS ──

export function getConnectedSubgraph(
  rootId: string,
  edges: { source: string; target: string }[],
): Set<string> {
  const downstream = new Map<string, Set<string>>();
  const upstream = new Map<string, Set<string>>();
  for (const e of edges) {
    if (!downstream.has(e.source)) downstream.set(e.source, new Set());
    downstream.get(e.source)!.add(e.target);
    if (!upstream.has(e.target)) upstream.set(e.target, new Set());
    upstream.get(e.target)!.add(e.source);
  }
  const visited = new Set<string>();
  const q1 = [rootId];
  while (q1.length) {
    const n = q1.shift()!;
    if (visited.has(n)) continue;
    visited.add(n);
    for (const c of downstream.get(n) || []) if (!visited.has(c)) q1.push(c);
  }
  const q2 = [rootId];
  while (q2.length) {
    const n = q2.shift()!;
    if (visited.has(n) && n !== rootId) continue;
    visited.add(n);
    for (const p of upstream.get(n) || []) if (!visited.has(p)) q2.push(p);
  }
  return visited;
}

// ── Directory group computation ──

interface DirGroup {
  dir: string;
  layer: string;
  layerLabel: string;
  layerIndex: number;
  nodes: StructureNode[];
}

function computeDirectoryGroups(nodes: StructureNode[]): Map<string, DirGroup> {
  const groups = new Map<string, DirGroup>();
  for (const node of nodes) {
    const dir = getDirectoryGroup(node.filePath);
    if (!dir) continue;
    const key = `${node.layer}::${dir}`;
    let group = groups.get(key);
    if (!group) {
      group = { dir, layer: node.layer, layerLabel: node.layerLabel, layerIndex: node.layerIndex, nodes: [] };
      groups.set(key, group);
    }
    group.nodes.push(node);
  }
  // Only keep groups with 2+ nodes
  for (const [key, group] of groups) {
    if (group.nodes.length < 2) groups.delete(key);
  }
  return groups;
}

// ── ELK Layout ──

const elk = new ELK();
const NODE_W = 220;
const NODE_H = 76;
const GROUP_PAD = 30;
const GROUP_PAD_TOP = 60;

export async function buildFlowElementsAsync(
  structure: StructureData,
  expandedGroups: Set<string>,
  selectedNodeId: string | null,
  nodeSpacing: number = 1,
): Promise<{ nodes: Node<VizNodeData>[]; edges: Edge[]; layerBands: LayerBand[] }> {
  const dirGroups = computeDirectoryGroups(structure.nodes);

  // nodeId → group (only for collapsed groups)
  const nodeToCollapsedGroup = new Map<string, string>();
  // nodeId → group (any group)
  const nodeToAnyGroup = new Map<string, string>();

  for (const [, group] of dirGroups) {
    const gId = groupNodeId(group.dir, group.layer);
    for (const node of group.nodes) {
      nodeToAnyGroup.set(node.id, gId);
      if (!expandedGroups.has(gId)) {
        nodeToCollapsedGroup.set(node.id, gId);
      }
    }
  }

  // ── Build ELK children ──
  const elkChildren: ElkNode[] = [];
  const nodeDataMap = new Map<string, { sn: StructureNode; isDir: boolean; group?: DirGroup }>();
  const processed = new Set<string>();

  for (const sn of structure.nodes) {
    const gId = nodeToAnyGroup.get(sn.id);

    if (!gId) {
      // Ungrouped
      elkChildren.push({ id: sn.id, width: NODE_W, height: NODE_H });
      nodeDataMap.set(sn.id, { sn, isDir: false });
    } else if (!processed.has(gId)) {
      processed.add(gId);
      const group = [...dirGroups.values()].find(g => groupNodeId(g.dir, g.layer) === gId)!;
      const isExpanded = expandedGroups.has(gId);

      if (isExpanded) {
        // Use layered top-down layout inside groups to maintain hierarchy
        const cols = Math.ceil(Math.sqrt(group.nodes.length));
        elkChildren.push({
          id: gId,
          layoutOptions: {
            "elk.algorithm": "layered",
            "elk.direction": "DOWN",
            "elk.spacing.nodeNode": "20",
            "elk.layered.spacing.nodeNodeBetweenLayers": "30",
            "elk.padding": `[top=${GROUP_PAD_TOP},left=${GROUP_PAD},bottom=${GROUP_PAD},right=${GROUP_PAD}]`,
            "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
            "elk.aspectRatio": String(Math.max(1.5, cols * 0.8)),
          },
          children: group.nodes.map(child => ({ id: child.id, width: NODE_W, height: NODE_H })),
        });
        for (const child of group.nodes) {
          nodeDataMap.set(child.id, { sn: child, isDir: false });
        }
      } else {
        elkChildren.push({ id: gId, width: NODE_W, height: NODE_H });
      }

      // Register group node data
      nodeDataMap.set(gId, {
        sn: {
          id: gId,
          label: `📁 ${group.dir}/`,
          filePath: null,
          layer: group.layer,
          layerIndex: group.layerIndex,
          layerLabel: group.layerLabel,
          apiCalls: group.nodes.flatMap(n => n.apiCalls),
          routes: group.nodes.flatMap(n => n.routes),
          importCount: group.nodes.reduce((s, n) => s + n.importCount, 0),
        },
        isDir: true,
        group,
      });
    }
  }

  // ── Build edges (aggregate for collapsed groups) ──
  const edgeSet = new Set<string>();
  const elkEdges: ElkExtendedEdge[] = [];
  const edgeMeta: { id: string; source: string; target: string }[] = [];

  for (const e of structure.edges) {
    const src = nodeToCollapsedGroup.get(e.source) || e.source;
    const tgt = nodeToCollapsedGroup.get(e.target) || e.target;
    if (src === tgt) continue;
    const key = `${src}→${tgt}`;
    if (edgeSet.has(key)) continue;
    edgeSet.add(key);
    const eid = `e_${src}_${tgt}`;
    elkEdges.push({ id: eid, sources: [src], targets: [tgt] });
    edgeMeta.push({ id: eid, source: src, target: tgt });
  }

  // ── Run ELK ──
  // nodeSpacing: 0=compact, 1=normal, 2=spacious
  const spacingFactors = [0.6, 1.0, 1.6];
  const sf = spacingFactors[Math.min(2, Math.max(0, nodeSpacing))];
  const layoutOptions: LayoutOptions = {
    "elk.algorithm": "layered",
    "elk.direction": "DOWN",
    "elk.layered.spacing.nodeNodeBetweenLayers": String(Math.round(120 * sf)),
    "elk.spacing.nodeNode": String(Math.round(50 * sf)),
    "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
    "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
    "elk.edgeRouting": "ORTHOGONAL",
    "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
  };

  const result = await elk.layout({
    id: "root",
    layoutOptions,
    children: elkChildren,
    edges: elkEdges,
  });

  // ── Extract positions ──
  const posMap = new Map<string, { x: number; y: number; w: number; h: number }>();
  function extract(node: ElkNode, ox = 0, oy = 0) {
    const x = (node.x ?? 0) + ox;
    const y = (node.y ?? 0) + oy;
    posMap.set(node.id, { x, y, w: node.width ?? NODE_W, h: node.height ?? NODE_H });
    if (node.children) {
      for (const c of node.children) extract(c, x, y);
    }
  }
  if (result.children) for (const c of result.children) extract(c);

  // ── Highlight ──
  const connectedIds = selectedNodeId ? getConnectedSubgraph(selectedNodeId, edgeMeta) : null;

  // ── Flow nodes ──
  const flowNodes: Node<VizNodeData>[] = [];

  for (const [id, { sn, isDir, group }] of nodeDataMap) {
    const pos = posMap.get(id);
    if (!pos) continue;
    const color = LAYER_COLORS[sn.layer] || "#64748b";
    const highlighted = connectedIds ? connectedIds.has(id) : false;
    const dimmed = connectedIds ? !connectedIds.has(id) : false;

    if (isDir && group) {
      const isExpanded = expandedGroups.has(id);
      flowNodes.push({
        id,
        type: isExpanded ? "directoryGroupExpanded" : "directoryGroup",
        position: { x: pos.x, y: pos.y },
        data: {
          label: `📁 ${group.dir}/`,
          filePath: null,
          layer: sn.layer,
          layerLabel: sn.layerLabel,
          color,
          routes: sn.routes,
          apiCalls: sn.apiCalls,
          importCount: sn.importCount,
          lineCount: 0,
          isGroup: true,
          highlighted,
          dimmed,
          active: false,
          isDirectoryGroup: true,
          isExpanded,
          fileCount: group.nodes.length,
          directoryPath: group.dir,
        },
        style: isExpanded ? { width: pos.w, height: pos.h } : undefined,
      });
    } else {
      const parentGId = nodeToAnyGroup.get(id);
      const isChild = parentGId ? expandedGroups.has(parentGId) : false;

      flowNodes.push({
        id,
        type: "vizNode",
        position: isChild
          ? { x: (pos.x) - (posMap.get(parentGId!)?.x ?? 0), y: (pos.y) - (posMap.get(parentGId!)?.y ?? 0) }
          : { x: pos.x, y: pos.y },
        ...(isChild ? { parentId: parentGId } : {}),
        extent: isChild ? ("parent" as const) : undefined,
        data: {
          label: sn.label,
          filePath: sn.filePath,
          layer: sn.layer,
          layerLabel: sn.layerLabel,
          color,
          routes: sn.routes ?? [],
          apiCalls: sn.apiCalls ?? [],
          importCount: sn.importCount,
          lineCount: sn.lineCount ?? 0,
          isGroup: false,
          highlighted,
          dimmed,
          active: false,
        },
      });
    }
  }

  // Parent nodes must come before children for React Flow
  flowNodes.sort((a, b) => {
    const aP = a.data.isDirectoryGroup && a.data.isExpanded ? 0 : 1;
    const bP = b.data.isDirectoryGroup && b.data.isExpanded ? 0 : 1;
    return aP - bP;
  });

  // ── Flow edges ──
  const flowEdges: Edge[] = edgeMeta.map(e => {
    const isHL = connectedIds !== null && connectedIds.has(e.source) && connectedIds.has(e.target);
    const isDim = connectedIds !== null && !isHL;
    const srcLayer = nodeDataMap.get(e.source)?.sn.layer || "shared";
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      type: "smoothstep",
      animated: isHL,
      style: {
        stroke: isHL ? LAYER_COLORS[srcLayer] || "#818cf8" : isDim ? "#334155" : "#334155",
        strokeWidth: isHL ? 2.5 : 1.2,
        opacity: isDim ? 0.45 : 1,
      },
    };
  });

  return { nodes: flowNodes, edges: flowEdges, layerBands: [] };
}

export function getHeatmapColor(intensity: number): string {
  if (intensity <= 0) return "#334155";
  const r = Math.round(51 + 204 * intensity);
  const g = Math.round(65 + 130 * Math.max(0, 1 - intensity * 2));
  const b = Math.round(85 * (1 - intensity));
  return `rgb(${r},${g},${b})`;
}
