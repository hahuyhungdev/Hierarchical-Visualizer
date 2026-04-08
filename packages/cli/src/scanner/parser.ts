/**
 * File parsing: extract imports, API calls, routes from source files.
 */

import * as fs from "fs";
import {
  IMPORT_RE,
  API_CALL_RE,
  OPENAPI_FETCH_RE,
  OPENAPI_RQ_RE,
  ROUTE_RE,
  normalizeApiEndpoint,
} from "./patterns.js";

export interface FileData {
  imports: string[];
  api_calls: string[];
  routes: string[];
  export_default: boolean;
  is_barrel: boolean;
  line_count: number;
}

export function scanFile(filepath: string): FileData {
  let content: string;
  try {
    content = fs.readFileSync(filepath, "utf-8");
  } catch {
    return {
      imports: [],
      api_calls: [],
      routes: [],
      export_default: false,
      is_barrel: false,
      line_count: 0,
    };
  }

  // Imports
  const imports: string[] = [];
  for (const m of content.matchAll(new RegExp(IMPORT_RE.source, "gm"))) {
    const imp = m[1] || m[2] || m[3] || m[4];
    if (imp) imports.push(imp);
  }

  // API calls — normalize template literals
  const apiCallsRaw: string[] = [];
  for (const m of content.matchAll(new RegExp(API_CALL_RE.source, "gi"))) {
    if (m[1]) apiCallsRaw.push(m[1]);
  }
  for (const m of content.matchAll(new RegExp(OPENAPI_FETCH_RE.source, "g"))) {
    if (m[1]) apiCallsRaw.push(m[1]);
  }
  for (const m of content.matchAll(new RegExp(OPENAPI_RQ_RE.source, "g"))) {
    if (m[1]) apiCallsRaw.push(m[1]);
  }
  const apiCalls = [
    ...new Map(
      apiCallsRaw
        .map(normalizeApiEndpoint)
        .filter(Boolean)
        .map((ep) => [ep, ep])
    ).values(),
  ];

  // Route definitions
  const routes: string[] = [];
  for (const m of content.matchAll(new RegExp(ROUTE_RE.source, "gm"))) {
    const r = m[1] || m[2] || m[3];
    if (r) routes.push(r);
  }

  const hasDefault = /export\s+default/.test(content);

  // Detect barrel files (index.ts that only re-exports)
  let isBarrel = false;
  const basename = filepath.split("/").pop() ?? "";
  const stem = basename.replace(/\.\w+$/, "");
  if (stem === "index") {
    const lines = content
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("//"));
    if (lines.length > 0 && lines.every((l) => l.startsWith("export "))) {
      isBarrel = true;
    }
  }

  const lineCount = content.split("\n").length;

  return {
    imports,
    api_calls: apiCalls,
    routes,
    export_default: hasDefault,
    is_barrel: isBarrel,
    line_count: lineCount,
  };
}
