/**
 * Core scanner: scanRepository, monorepo detection, _scanSingleRepo.
 */

import * as fs from "fs";
import * as path from "path";
import { globSync } from "glob";
import { EXTENSIONS, IGNORE_DIRS } from "./patterns.js";
import { detectFramework, detectAliasPaths } from "./frameworks.js";
import { detectFsd, detectFsdViolations } from "./fsd.js";
import { clearCache, resolveImportPath, setKnownFiles } from "./resolver.js";
import { scanFile, type FileData } from "./parser.js";
import {
  classifyLayer,
  computeDisplayName,
  extractFileRoute,
  LAYER_ORDER,
  LAYER_LABELS,
} from "./layers.js";
import {
  detectCircularDeps,
  findStronglyConnectedComponents,
  findUsedFiles,
} from "./analytics.js";

// ── Incremental Parse Cache ──
const parseCache = new Map<string, { mtime: number; size: number; data: FileData }>();
let parseCacheRepo: string | null = null;

function parseFileIncremental(fp: string): FileData {
  try {
    const st = fs.statSync(fp);
    const cached = parseCache.get(fp);
    if (cached && cached.mtime === st.mtimeMs && cached.size === st.size) {
      return cached.data;
    }
    const data = scanFile(fp);
    parseCache.set(fp, { mtime: st.mtimeMs, size: st.size, data });
    return data;
  } catch {
    return scanFile(fp);
  }
}

// ── Monorepo Detection ──

function detectWorkspaces(root: string): string[] {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return [];

  let workspaceGlobs: string[] = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    let ws = pkg.workspaces;
    if (ws && typeof ws === "object" && !Array.isArray(ws)) ws = ws.packages;
    if (Array.isArray(ws)) workspaceGlobs = ws.filter((g: unknown) => typeof g === "string");
  } catch {
    return [];
  }

  // pnpm-workspace.yaml
  const pnpmWs = path.join(root, "pnpm-workspace.yaml");
  if (fs.existsSync(pnpmWs)) {
    try {
      const content = fs.readFileSync(pnpmWs, "utf-8");
      let inPackages = false;
      for (const line of content.split("\n")) {
        const stripped = line.trim();
        if (stripped === "packages:") { inPackages = true; continue; }
        if (inPackages && stripped.startsWith("- ")) {
          const glob = stripped.slice(2).trim().replace(/^['"]|['"]$/g, "");
          if (!workspaceGlobs.includes(glob)) workspaceGlobs.push(glob);
        } else if (inPackages && stripped && !stripped.startsWith("#")) {
          inPackages = false;
        }
      }
    } catch { /* ignore */ }
  }

  // Resolve globs to actual directories
  const packages: string[] = [];
  for (const pattern of workspaceGlobs) {
    try {
      const matches = globSync(pattern, { cwd: root, absolute: true });
      for (const m of matches) {
        const resolved = path.resolve(m);
        if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory() && fs.existsSync(path.join(resolved, "package.json"))) {
          packages.push(resolved);
        }
      }
    } catch { /* ignore */ }
  }
  return packages;
}

// ── Walk directory for source files ──

function walkDir(dir: string): string[] {
  const files: string[] = [];
  const seen = new Set<string>();

  function walk(d: string) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch { return; }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name)) walk(path.join(d, entry.name));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (EXTENSIONS.has(ext)) {
          const fp = path.resolve(d, entry.name);
          if (!seen.has(fp)) {
            seen.add(fp);
            files.push(fp);
          }
        }
      }
    }
  }

  walk(dir);
  return files;
}

// ── Public API ──

export interface ScanResult {
  repoPath: string;
  srcRoot: string;
  framework: string;
  isFsd: boolean;
  layers: Array<{ id: string; index: number; label: string; color: string }>;
  nodes: Array<Record<string, unknown>>;
  edges: Array<{ id: string; source: string; target: string }>;
  groups: Array<{ parentId: string; childIds: string[] }>;
  metadata: Record<string, unknown>;
  analytics: Record<string, unknown>;
}

export function scanRepository(repoPath: string): ScanResult {
  const root = path.resolve(repoPath);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`'${repoPath}' is not a valid directory`);
  }

  // Invalidate cache if scanning different repo
  if (parseCacheRepo !== root) {
    parseCache.clear();
    parseCacheRepo = root;
  }
  clearCache();

  const workspaces = detectWorkspaces(root);
  if (workspaces.length > 0) {
    return scanMonorepo(root, workspaces);
  }
  return scanSingleRepo(root);
}

function scanMonorepo(root: string, packages: string[]): ScanResult {
  const allNodes: Array<Record<string, unknown>> = [];
  const allEdges: Array<{ id: string; source: string; target: string }> = [];
  const allGroups: Array<{ parentId: string; childIds: string[] }> = [];
  const allCircularDeps: string[][] = [];
  const allDeadFiles: Array<Record<string, unknown>> = [];
  const allDependents: Record<string, string[]> = {};
  let totalFiles = 0, analyzedFiles = 0, treeShakedCount = 0, barrelCount = 0, apiEndpoints = 0;
  const frameworks = new Set<string>();

  for (const pkgDir of packages) {
    let result: ScanResult;
    try { result = scanSingleRepo(pkgDir); } catch { continue; }
    const pkgName = path.basename(pkgDir);
    const idMap = new Map<string, string>();

    for (const node of result.nodes) {
      const oldId = node.id as string;
      const newId = `${pkgName}__${oldId}`;
      idMap.set(oldId, newId);
      node.id = newId;
      node.label = `${pkgName}/${node.label}`;
      if (node.filePath) {
        try {
          node.filePath = path.relative(root, path.resolve(pkgDir, node.filePath as string));
        } catch {
          node.filePath = `${pkgName}/${node.filePath}`;
        }
      }
      allNodes.push(node);
    }

    for (const edge of result.edges) {
      edge.source = idMap.get(edge.source) ?? edge.source;
      edge.target = idMap.get(edge.target) ?? edge.target;
      edge.id = `${pkgName}__${edge.id}`;
      allEdges.push(edge);
    }

    for (const group of result.groups) {
      group.parentId = idMap.get(group.parentId) ?? group.parentId;
      group.childIds = group.childIds.map((c) => idMap.get(c) ?? c);
      allGroups.push(group);
    }

    const analytics = result.analytics as Record<string, unknown>;
    for (const cycle of (analytics.circularDeps as string[][]) ?? []) {
      allCircularDeps.push(cycle.map((c) => idMap.get(c) ?? c));
    }
    for (const df of (analytics.deadFiles as Array<Record<string, unknown>>) ?? []) {
      df.filePath = `${pkgName}/${df.filePath}`;
      allDeadFiles.push(df);
    }
    for (const [tgt, srcs] of Object.entries((analytics.dependents as Record<string, string[]>) ?? {})) {
      const mappedTgt = idMap.get(tgt) ?? tgt;
      const mappedSrcs = (srcs as string[]).map((s) => idMap.get(s) ?? s);
      allDependents[mappedTgt] = [...(allDependents[mappedTgt] ?? []), ...mappedSrcs];
    }

    const meta = result.metadata;
    totalFiles += meta.totalFiles as number;
    analyzedFiles += meta.analyzedFiles as number;
    treeShakedCount += meta.treeShakedFiles as number;
    barrelCount += meta.barrelFiles as number;
    apiEndpoints += meta.apiEndpoints as number;
    frameworks.add(meta.framework as string);
  }

  const fwStr = [...frameworks].sort().join(", ");
  return {
    repoPath: root,
    srcRoot: root,
    framework: fwStr,
    isFsd: false,
    layers: [
      { id: "page", index: 0, label: "Pages", color: "#818cf8" },
      { id: "layout", index: 0, label: "Layouts", color: "#a78bfa" },
      { id: "feature", index: 1, label: "Features", color: "#22d3ee" },
      { id: "shared", index: 2, label: "Shared / UI", color: "#34d399" },
      { id: "api_service", index: 3, label: "API Services", color: "#fbbf24" },
      { id: "api_route", index: 3, label: "API Routes", color: "#fb923c" },
      { id: "api_endpoint", index: 4, label: "Backend Endpoints", color: "#f87171" },
      { id: "middleware", index: 2, label: "Middleware", color: "#c084fc" },
    ],
    nodes: allNodes,
    edges: allEdges,
    groups: allGroups,
    metadata: {
      totalFiles, analyzedFiles, treeShakedFiles: treeShakedCount,
      barrelFiles: barrelCount, totalEdges: allEdges.length,
      apiEndpoints, framework: fwStr, workspaces: packages.length,
    },
    analytics: { circularDeps: allCircularDeps, deadFiles: allDeadFiles, dependents: allDependents },
  };
}

function scanSingleRepo(root: string): ScanResult {
  const t0 = performance.now();
  const framework = detectFramework(root);
  const aliases = detectAliasPaths(root);
  const isFsd = detectFsd(root);

  const srcRoot = fs.existsSync(path.join(root, "src")) ? path.join(root, "src") : root;
  const scanRoots = [srcRoot];
  if (framework === "nextjs") {
    for (const d of ["app", "pages"]) {
      const candidate = path.join(root, d);
      if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory() && candidate !== path.join(srcRoot, d)) {
        scanRoots.push(candidate);
      }
    }
  }

  // 1. Discover all source files
  const allFiles: string[] = [];
  const seenPaths = new Set<string>();
  for (const scanDir of scanRoots) {
    for (const fp of walkDir(scanDir)) {
      if (!seenPaths.has(fp)) {
        seenPaths.add(fp);
        allFiles.push(fp);
      }
    }
  }

  // 2. Parse files (incremental cache)
  const fileData = new Map<string, FileData>();
  for (const fp of allFiles) {
    fileData.set(fp, parseFileIncremental(fp));
  }

  // Register known files for O(1) resolution lookups
  setKnownFiles(new Set(fileData.keys()));

  // 3. Resolve imports
  const resolvedImports = new Map<string, string[]>();
  for (const [fp, data] of fileData) {
    const deps: string[] = [];
    for (const imp of data.imports) {
      const resolved = resolveImportPath(fp, imp, srcRoot, aliases);
      if (resolved && fileData.has(resolved)) deps.push(resolved);
    }
    resolvedImports.set(fp, deps);
  }

  // 4. Classify layers
  const fileLayers = new Map<string, string>();
  for (const fp of allFiles) {
    const rel = path.relative(root, fp);
    fileLayers.set(fp, classifyLayer(rel, framework, fileData.get(fp)!, isFsd));
  }

  // 5. Tree-shaking: find entry points
  const entryFiles = new Set<string>();
  if (isFsd) {
    for (const [fp, layer] of fileLayers) {
      if (layer === "fsd_app" || layer === "fsd_pages") entryFiles.add(fp);
    }
  } else {
    for (const [fp, layer] of fileLayers) {
      if (layer === "page" || layer === "layout" || layer === "api_route") entryFiles.add(fp);
    }
  }
  if (entryFiles.size === 0) {
    for (const [fp, data] of fileData) {
      if (data.routes.length > 0) {
        fileLayers.set(fp, "page");
        entryFiles.add(fp);
      }
    }
  }
  for (const fp of allFiles) {
    const name = path.basename(fp).replace(/\.\w+$/, "").toLowerCase();
    if (["app", "main", "index", "_app", "_document", "root"].includes(name)) entryFiles.add(fp);
  }

  const used = entryFiles.size > 0
    ? findUsedFiles(entryFiles, resolvedImports)
    : new Set(allFiles);

  // 6. Skip barrel files from display
  const barrelFiles = new Set<string>();
  for (const fp of used) {
    if (fileData.get(fp)?.is_barrel) barrelFiles.add(fp);
  }

  // 7. Collect API endpoints
  const allApiEndpoints = new Set<string>();
  for (const fp of used) {
    for (const call of fileData.get(fp)?.api_calls ?? []) {
      allApiEndpoints.add(call);
    }
    if (fileLayers.get(fp) === "api_route") {
      const route = extractFileRoute(fp, root, framework);
      if (route) allApiEndpoints.add(route);
    }
  }

  // 8. Build output structure
  const nodes: Array<Record<string, unknown>> = [];
  const edges: Array<{ id: string; source: string; target: string }> = [];
  const nodeIdMap = new Map<string, string>();
  const importCount = new Map<string, number>();

  for (const fp of used) {
    for (const dep of resolvedImports.get(fp) ?? []) {
      if (used.has(dep)) importCount.set(dep, (importCount.get(dep) ?? 0) + 1);
    }
  }

  const displayFiles = [...used].filter((fp) => !barrelFiles.has(fp)).sort();

  for (const fp of displayFiles) {
    const rel = path.relative(root, fp);
    const nid = rel.replace(/[^a-zA-Z0-9]/g, "_");
    nodeIdMap.set(fp, nid);
    const layer = fileLayers.get(fp)!;
    const displayName = computeDisplayName(fp, root, framework, isFsd);

    let fileRoute = extractFileRoute(fp, root, framework);
    let routes = [...(fileData.get(fp)?.routes ?? [])];
    if (fileRoute && !routes.includes(fileRoute)) routes = [fileRoute, ...routes];

    nodes.push({
      id: nid,
      label: displayName,
      filePath: rel,
      layer,
      layerIndex: LAYER_ORDER[layer] ?? 2,
      layerLabel: LAYER_LABELS[layer] ?? "Shared / UI",
      apiCalls: fileData.get(fp)?.api_calls ?? [],
      routes,
      importCount: importCount.get(fp) ?? 0,
      lineCount: fileData.get(fp)?.line_count ?? 0,
    });
  }

  // Edges — skip barrel files, connect through them (memoized + cycle-safe)
  const barrelCache = new Map<string, string[]>();

  function resolveThroughBarrels(target: string): string[] {
    if (barrelCache.has(target)) return barrelCache.get(target)!;
    const result = resolveBarrel(target, new Set());
    barrelCache.set(target, result);
    return result;
  }

  function resolveBarrel(target: string, visiting: Set<string>): string[] {
    if (!barrelFiles.has(target)) return nodeIdMap.has(target) ? [target] : [];
    if (visiting.has(target)) return [];
    visiting.add(target);
    const results: string[] = [];
    for (const dep of resolvedImports.get(target) ?? []) {
      results.push(...resolveBarrel(dep, visiting));
    }
    return results;
  }

  const edgeSet = new Set<string>();
  for (const fp of displayFiles) {
    const srcId = nodeIdMap.get(fp);
    if (!srcId) continue;
    for (const dep of resolvedImports.get(fp) ?? []) {
      for (const actual of resolveThroughBarrels(dep)) {
        const tgtId = nodeIdMap.get(actual);
        if (tgtId && srcId !== tgtId) {
          const key = `${srcId}|${tgtId}`;
          if (!edgeSet.has(key)) {
            edgeSet.add(key);
            edges.push({ id: `e_${srcId}__${tgtId}`, source: srcId, target: tgtId });
          }
        }
      }
    }
  }

  // API endpoint nodes — inverted index
  const endpointToFiles = new Map<string, string[]>();
  for (const fp of displayFiles) {
    for (const call of fileData.get(fp)?.api_calls ?? []) {
      if (!endpointToFiles.has(call)) endpointToFiles.set(call, []);
      endpointToFiles.get(call)!.push(fp);
    }
  }

  const apiLayerIndex = isFsd ? 7 : 4;
  const sortedEndpoints = [...allApiEndpoints].sort();
  for (let i = 0; i < sortedEndpoints.length; i++) {
    const endpoint = sortedEndpoints[i];
    const apiId = `api_ep_${i}`;
    nodes.push({
      id: apiId, label: endpoint, filePath: null,
      layer: "api_endpoint", layerIndex: apiLayerIndex,
      layerLabel: "Backend API Endpoints",
      apiCalls: [], routes: [], importCount: 0, lineCount: 0,
    });
    for (const fp of endpointToFiles.get(endpoint) ?? []) {
      const srcId = nodeIdMap.get(fp)!;
      const key = `${srcId}|${apiId}`;
      if (!edgeSet.has(key)) {
        edgeSet.add(key);
        edges.push({ id: `e_${srcId}__${apiId}`, source: srcId, target: apiId });
      }
    }
  }

  // Groups
  let groups: Array<{ parentId: string; childIds: string[] }> = [];
  if (isFsd) {
    for (const fp of displayFiles) {
      if (fileLayers.get(fp) === "fsd_pages") {
        const pageId = nodeIdMap.get(fp)!;
        const children: string[] = [];
        for (const dep of resolvedImports.get(fp) ?? []) {
          for (const actual of resolveThroughBarrels(dep)) {
            const depLayer = fileLayers.get(actual);
            if (nodeIdMap.has(actual) && (depLayer === "fsd_widgets" || depLayer === "fsd_features")) {
              children.push(nodeIdMap.get(actual)!);
            }
          }
        }
        groups.push({ parentId: pageId, childIds: children });
      }
    }
  } else {
    for (const fp of displayFiles) {
      if (fileLayers.get(fp) === "page" || fileLayers.get(fp) === "layout") {
        const pageId = nodeIdMap.get(fp)!;
        const children: string[] = [];
        for (const dep of resolvedImports.get(fp) ?? []) {
          for (const actual of resolveThroughBarrels(dep)) {
            if (nodeIdMap.has(actual) && fileLayers.get(actual) === "feature") {
              children.push(nodeIdMap.get(actual)!);
            }
          }
        }
        groups.push({ parentId: pageId, childIds: children });
      }
    }
  }

  // Layers definition
  const layers = isFsd
    ? [
        { id: "fsd_app", index: 0, label: "App", color: "#818cf8" },
        { id: "fsd_processes", index: 1, label: "Processes", color: "#a78bfa" },
        { id: "fsd_pages", index: 2, label: "Pages", color: "#c084fc" },
        { id: "fsd_widgets", index: 3, label: "Widgets", color: "#22d3ee" },
        { id: "fsd_features", index: 4, label: "Features", color: "#2dd4bf" },
        { id: "fsd_entities", index: 5, label: "Entities", color: "#fbbf24" },
        { id: "fsd_shared", index: 6, label: "Shared", color: "#34d399" },
        { id: "api_endpoint", index: 7, label: "Backend Endpoints", color: "#f87171" },
      ]
    : [
        { id: "page", index: 0, label: "Pages", color: "#818cf8" },
        { id: "layout", index: 0, label: "Layouts", color: "#a78bfa" },
        { id: "feature", index: 1, label: "Features", color: "#22d3ee" },
        { id: "shared", index: 2, label: "Shared / UI", color: "#34d399" },
        { id: "api_service", index: 3, label: "API Services", color: "#fbbf24" },
        { id: "api_route", index: 3, label: "API Routes", color: "#fb923c" },
        { id: "api_endpoint", index: 4, label: "Backend Endpoints", color: "#f87171" },
        { id: "middleware", index: 2, label: "Middleware", color: "#c084fc" },
      ];

  // Analytics
  const circularDeps = detectCircularDeps(resolvedImports, nodeIdMap);
  const sccs = findStronglyConnectedComponents(resolvedImports);
  const circularGroups = sccs
    .map((scc) => scc.filter((fp) => nodeIdMap.has(fp)).map((fp) => nodeIdMap.get(fp)!))
    .filter((g) => g.length >= 2);

  const deadFiles: Array<Record<string, unknown>> = [];
  for (const fp of allFiles.filter((f) => !used.has(f)).sort()) {
    const rel = path.relative(root, fp);
    deadFiles.push({
      filePath: rel,
      label: computeDisplayName(fp, root, framework, isFsd),
      layer: classifyLayer(rel, framework, fileData.get(fp)!, isFsd),
    });
  }

  const dependents: Record<string, string[]> = {};
  for (const key of edgeSet) {
    const [srcId, tgtId] = key.split("|");
    if (!dependents[tgtId]) dependents[tgtId] = [];
    dependents[tgtId].push(srcId);
  }

  let fsdViolations: unknown[] = [];
  if (isFsd) {
    fsdViolations = detectFsdViolations(displayFiles, fileLayers, resolvedImports, nodeIdMap, resolveThroughBarrels) as unknown[];
  }

  const analytics: Record<string, unknown> = {
    circularDeps, circularGroups, deadFiles, dependents,
    ...(isFsd ? { fsdViolations } : {}),
  };

  const scanTimeMs = Math.round(performance.now() - t0);

  return {
    repoPath: root, srcRoot, framework, isFsd, layers, nodes, edges, groups,
    metadata: {
      totalFiles: allFiles.length, analyzedFiles: used.size,
      treeShakedFiles: allFiles.length - used.size, barrelFiles: barrelFiles.size,
      totalEdges: edges.length, apiEndpoints: allApiEndpoints.size,
      framework, isFsd, scanTimeMs,
    },
    analytics,
  };
}
