/**
 * Import resolution with caching for the static analyzer.
 * Pre-indexed file set for O(1) existence checks.
 */

import * as path from "path";
import * as fs from "fs";
import { EXTENSIONS } from "./patterns.js";

const resolveCache = new Map<string, string | null>();
let knownFiles = new Set<string>();

export function clearCache(): void {
  resolveCache.clear();
  knownFiles.clear();
}

export function setKnownFiles(files: Set<string>): void {
  knownFiles = files;
}

export function resolveImportPath(
  sourceFile: string,
  importPath: string,
  srcRoot: string,
  aliases: Map<string, string>
): string | null {
  const cacheKey = `${path.dirname(sourceFile)}|${importPath}`;
  if (resolveCache.has(cacheKey)) return resolveCache.get(cacheKey)!;

  const result = resolveImportPathUncached(
    sourceFile,
    importPath,
    srcRoot,
    aliases
  );
  resolveCache.set(cacheKey, result);
  return result;
}

const HARDCODED_ALIASES: [string, string][] = [
  ["@/", "src/"],
  ["~/", "src/"],
  ["#/", "src/"],
  ["@components/", "src/components/"],
  ["@features/", "src/features/"],
  ["@hooks/", "src/hooks/"],
  ["@services/", "src/services/"],
  ["@utils/", "src/utils/"],
  ["@lib/", "src/lib/"],
  ["@app/", "src/app/"],
  ["src/", "src/"],
];

function resolveImportPathUncached(
  sourceFile: string,
  importPath: string,
  srcRoot: string,
  aliases: Map<string, string>
): string | null {
  let resolved: string | null = null;

  if (importPath.startsWith(".")) {
    resolved = path.resolve(path.dirname(sourceFile), importPath);
  } else {
    // Try tsconfig aliases first
    for (const [prefix, targetDir] of aliases) {
      if (importPath === prefix || importPath.startsWith(prefix + "/")) {
        const remainder = importPath.slice(prefix.length).replace(/^\//, "");
        resolved = path.resolve(targetDir, remainder);
        break;
      }
    }

    if (resolved === null) {
      // Hardcoded aliases
      const rootParent = path.dirname(srcRoot);
      for (const [aliasPrefix, relTarget] of HARDCODED_ALIASES) {
        if (importPath.startsWith(aliasPrefix)) {
          const remainder = importPath.slice(aliasPrefix.length);
          resolved = path.resolve(rootParent, relTarget, remainder);
          break;
        }
      }
    }

    if (resolved === null) return null;
  }

  // Try resolving: exact → +ext → /index.ext → /Name.ext (folder component)
  const candidates: string[] = [resolved];
  for (const ext of EXTENSIONS) {
    candidates.push(resolved + ext);
  }
  for (const ext of EXTENSIONS) {
    candidates.push(path.join(resolved, `index${ext}`));
  }
  // Folder-based component: PostFeed/PostFeed.tsx
  const folderName = path.basename(resolved);
  if (folderName) {
    for (const ext of EXTENSIONS) {
      candidates.push(path.join(resolved, `${folderName}${ext}`));
    }
  }

  // O(1) set lookup against pre-indexed project files
  if (knownFiles.size > 0) {
    for (const c of candidates) {
      if (knownFiles.has(c)) return c;
    }
    return null;
  }

  // Fallback: filesystem check
  for (const c of candidates) {
    try {
      if (fs.statSync(c).isFile()) return c;
    } catch {
      // not found
    }
  }
  return null;
}
