/**
 * Graph analytics: SCC detection (Tarjan), cycle detection (O(V+E)), tree-shaking BFS.
 */

export function detectCircularDeps(
  resolvedImports: Map<string, string[]>,
  nodeIdMap: Map<string, string>
): string[][] {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const fp of resolvedImports.keys()) color.set(fp, WHITE);

  const pathStack: string[] = [];
  const pathPos = new Map<string, number>();

  function dfs(fp: string): void {
    color.set(fp, GRAY);
    const pos = pathStack.length;
    pathStack.push(fp);
    pathPos.set(fp, pos);

    for (const dep of resolvedImports.get(fp) ?? []) {
      if (!color.has(dep)) continue;
      if (color.get(dep) === GRAY) {
        const idx = pathPos.get(dep);
        if (idx !== undefined) {
          const cycleIds = pathStack
            .slice(idx)
            .filter((f) => nodeIdMap.has(f))
            .map((f) => nodeIdMap.get(f)!);
          if (cycleIds.length >= 2) {
            const key = [...cycleIds].sort().join("|");
            if (!seen.has(key)) {
              seen.add(key);
              cycles.push(cycleIds);
            }
          }
        }
      } else if (color.get(dep) === WHITE) {
        dfs(dep);
      }
    }

    pathStack.pop();
    pathPos.delete(fp);
    color.set(fp, BLACK);
  }

  for (const fp of resolvedImports.keys()) {
    if (color.get(fp) === WHITE) dfs(fp);
  }
  return cycles;
}

export function findStronglyConnectedComponents(
  graph: Map<string, string[]>
): string[][] {
  let indexCounter = 0;
  const stack: string[] = [];
  const onStack = new Set<string>();
  const nodeIndex = new Map<string, number>();
  const lowlink = new Map<string, number>();
  const sccs: string[][] = [];

  function strongconnect(v: string): void {
    nodeIndex.set(v, indexCounter);
    lowlink.set(v, indexCounter);
    indexCounter++;
    stack.push(v);
    onStack.add(v);

    for (const w of graph.get(v) ?? []) {
      if (!nodeIndex.has(w)) {
        if (graph.has(w)) {
          strongconnect(w);
          lowlink.set(v, Math.min(lowlink.get(v)!, lowlink.get(w)!));
        }
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v)!, nodeIndex.get(w)!));
      }
    }

    if (lowlink.get(v) === nodeIndex.get(v)) {
      const scc: string[] = [];
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        scc.push(w);
      } while (w !== v);
      if (scc.length >= 2) sccs.push(scc);
    }
  }

  for (const v of graph.keys()) {
    if (!nodeIndex.has(v)) strongconnect(v);
  }
  return sccs;
}

export function findUsedFiles(
  entryFiles: Set<string>,
  allImports: Map<string, string[]>
): Set<string> {
  const visited = new Set<string>();
  const queue = [...entryFiles];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    for (const dep of allImports.get(current) ?? []) {
      if (!visited.has(dep)) queue.push(dep);
    }
  }
  return visited;
}
