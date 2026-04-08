/**
 * Framework and alias detection for React/Next.js/TanStack/Remix/Gatsby projects.
 */

import * as fs from "fs";
import * as path from "path";

export function detectFramework(root: string): string {
  const pkgPath = path.join(root, "package.json");
  if (!fs.existsSync(pkgPath)) return "react";

  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    const allDeps: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
      ...pkg.peerDependencies,
    };

    if ("next" in allDeps) return "nextjs";
    if ("@tanstack/react-router" in allDeps || "@tanstack/router" in allDeps)
      return "tanstack-router";
    if ("@remix-run/react" in allDeps || "remix" in allDeps) return "remix";
    if ("gatsby" in allDeps) return "gatsby";
  } catch {
    // ignore
  }
  return "react";
}

export function detectAliasPaths(root: string): Map<string, string> {
  const aliases = new Map<string, string>();

  for (const configName of ["tsconfig.json", "jsconfig.json"]) {
    const configPath = path.join(root, configName);
    if (!fs.existsSync(configPath)) continue;

    try {
      let raw = fs.readFileSync(configPath, "utf-8");
      // Strip comments
      raw = raw.replace(/\/\/[^\n]*/g, "");
      raw = raw.replace(/\/\*[\s\S]*?\*\//g, "");
      const cfg = JSON.parse(raw);

      const paths: Record<string, string[]> =
        cfg?.compilerOptions?.paths ?? {};
      const baseUrl: string = cfg?.compilerOptions?.baseUrl ?? ".";
      const base = path.resolve(root, baseUrl);

      for (const [aliasPattern, targets] of Object.entries(paths)) {
        if (!targets?.length) continue;
        const target = targets[0];
        const aliasPrefix = aliasPattern.replace("/*", "").replace("*", "");
        const targetPrefix = target.replace("/*", "").replace("*", "");
        const resolvedTarget = path.resolve(base, targetPrefix);
        if (aliasPrefix) {
          aliases.set(aliasPrefix, resolvedTarget);
        }
      }
    } catch {
      // ignore
    }
  }
  return aliases;
}
