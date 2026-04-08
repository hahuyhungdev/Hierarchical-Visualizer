/**
 * Feature-Sliced Design (FSD) detection, classification, display names, and violation detection.
 */

import * as fs from "fs";
import * as path from "path";

export const FSD_LAYERS = [
  "app", "processes", "pages", "widgets", "features", "entities", "shared",
] as const;
export type FsdLayerName = (typeof FSD_LAYERS)[number];

export const FSD_LAYER_HIERARCHY: Record<string, number> = {
  app: 0, processes: 1, pages: 2, widgets: 3, features: 4, entities: 5, shared: 6,
};

const FSD_SEGMENTS = new Set([
  "ui", "api", "model", "lib", "config", "routes", "store", "styles", "i18n", "types", "consts",
]);

export function detectFsd(root: string): boolean {
  const srcRoot = fs.existsSync(path.join(root, "src"))
    ? path.join(root, "src")
    : root;

  let strongSignals = 0;
  let weakSignals = 0;

  for (const layerName of FSD_LAYERS) {
    const layerDir = path.join(srcRoot, layerName);
    if (!fs.existsSync(layerDir) || !fs.statSync(layerDir).isDirectory()) continue;

    if (layerName === "entities" || layerName === "widgets") {
      strongSignals++;
    } else if (layerName === "features" || layerName === "shared") {
      let hasFsdStructure = false;
      try {
        for (const child of fs.readdirSync(layerDir)) {
          const childPath = path.join(layerDir, child);
          if (child.startsWith(".") || !fs.statSync(childPath).isDirectory()) continue;
          const childDirs = new Set(
            fs.readdirSync(childPath).filter((c) => {
              try {
                return fs.statSync(path.join(childPath, c)).isDirectory();
              } catch { return false; }
            })
          );
          for (const seg of FSD_SEGMENTS) {
            if (childDirs.has(seg)) { hasFsdStructure = true; break; }
          }
          if (hasFsdStructure) break;
        }
      } catch { /* ignore */ }
      if (hasFsdStructure) weakSignals++;
    } else if (layerName === "app") {
      try {
        const childDirs = new Set(
          fs.readdirSync(layerDir).filter((c) => {
            try {
              return fs.statSync(path.join(layerDir, c)).isDirectory();
            } catch { return false; }
          })
        );
        const appSignals = new Set(["routes", "styles", "store", "providers", "entrypoint"]);
        for (const s of appSignals) {
          if (childDirs.has(s)) { weakSignals++; break; }
        }
      } catch { /* ignore */ }
    }
  }

  return strongSignals >= 1 || (weakSignals >= 2);
}

export function classifyFsdLayer(p: string): string {
  let normalized = p.toLowerCase().replace(/\\/g, "/");
  if (normalized.startsWith("src/")) normalized = normalized.slice(4);

  for (const fsdLayer of FSD_LAYERS) {
    if (normalized === fsdLayer || normalized.startsWith(fsdLayer + "/")) {
      return `fsd_${fsdLayer}`;
    }
  }
  return "fsd_app";
}

export function computeFsdDisplayName(parts: string[], stem: string): string {
  let p = [...parts];
  if (p[0] === "src") p = p.slice(1);
  if (!p.length) return stem;

  const fsdLayersSet = new Set<string>(FSD_LAYERS);
  if (!fsdLayersSet.has(p[0])) {
    return stem === "index" && p.length >= 2 ? p[p.length - 2] : stem;
  }

  const layerName = p[0];
  const rest = p.slice(1);
  if (!rest.length) return stem;

  // For app/ and shared/ — no slices, just segments
  if (layerName === "app" || layerName === "shared") {
    const r = [...rest];
    r[r.length - 1] = stem;
    if (stem === "index" && r.length >= 2) r.pop();
    else if (r.length >= 2 && r[r.length - 1].toLowerCase() === r[r.length - 2].toLowerCase()) r.pop();
    return r.join("/");
  }

  // For entities, features, widgets, pages, processes — slices then segments
  const sliceName = rest[0];
  const inner = rest.slice(1);
  if (!inner.length) return sliceName;

  inner[inner.length - 1] = stem;
  if (stem === "index" && inner.length >= 2) inner.pop();

  if (inner.length >= 2 && FSD_SEGMENTS.has(inner[0])) {
    return `${sliceName}/${inner.slice(1).join("/")}`;
  }
  if (inner.length === 1 && inner[0] === "index") return sliceName;
  if (inner.length >= 2 && inner[inner.length - 1].toLowerCase() === inner[inner.length - 2].toLowerCase()) {
    inner.pop();
    if (FSD_SEGMENTS.has(inner[0]) && inner.length >= 2) {
      return `${sliceName}/${inner.slice(1).join("/")}`;
    }
    return `${sliceName}/${inner.join("/")}`;
  }

  return `${sliceName}/${inner.join("/")}`;
}

export interface FsdViolation {
  source: string;
  target: string;
  sourceLayer: string;
  targetLayer: string;
  type: "upward" | "cross-slice";
}

export function detectFsdViolations(
  displayFiles: string[],
  fileLayers: Map<string, string>,
  resolvedImports: Map<string, string[]>,
  nodeIdMap: Map<string, string>,
  resolveThroughBarrels: (fp: string) => string[]
): FsdViolation[] {
  const violations: FsdViolation[] = [];
  const seen = new Set<string>();

  function getFsdSlice(fp: string): string | null {
    const parts = fp.split(path.sep);
    for (let i = 0; i < parts.length; i++) {
      if (FSD_LAYERS.includes(parts[i] as FsdLayerName) && i + 1 < parts.length) {
        if (parts[i] === "app" || parts[i] === "shared") return null;
        return parts[i + 1];
      }
    }
    return null;
  }

  for (const fp of displayFiles) {
    const srcLayer = fileLayers.get(fp) ?? "";
    if (!srcLayer.startsWith("fsd_")) continue;
    const srcLayerName = srcLayer.slice(4);
    const srcHierarchy = FSD_LAYER_HIERARCHY[srcLayerName];
    if (srcHierarchy === undefined) continue;
    const srcId = nodeIdMap.get(fp);
    if (!srcId) continue;
    const srcSlice = getFsdSlice(fp);

    for (const dep of resolvedImports.get(fp) ?? []) {
      const targets = resolveThroughBarrels(dep);
      for (const actual of targets) {
        const tgtLayer = fileLayers.get(actual) ?? "";
        if (!tgtLayer.startsWith("fsd_")) continue;
        const tgtLayerName = tgtLayer.slice(4);
        const tgtHierarchy = FSD_LAYER_HIERARCHY[tgtLayerName];
        if (tgtHierarchy === undefined) continue;
        const tgtId = nodeIdMap.get(actual);
        if (!tgtId || srcId === tgtId) continue;

        if (tgtHierarchy < srcHierarchy) {
          const key = `${srcId}|${tgtId}`;
          if (!seen.has(key)) {
            seen.add(key);
            violations.push({ source: srcId, target: tgtId, sourceLayer: srcLayerName, targetLayer: tgtLayerName, type: "upward" });
          }
        } else if (tgtHierarchy === srcHierarchy && srcLayerName !== "app" && srcLayerName !== "shared") {
          const tgtSlice = getFsdSlice(actual);
          if (srcSlice !== tgtSlice) {
            const key = `${srcId}|${tgtId}`;
            if (!seen.has(key)) {
              seen.add(key);
              violations.push({ source: srcId, target: tgtId, sourceLayer: srcLayerName, targetLayer: tgtLayerName, type: "cross-slice" });
            }
          }
        }
      }
    }
  }

  return violations;
}
