/**
 * Lightweight Express server that serves the dashboard static files
 * and provides the scan/analytics API.
 */

import * as fs from "fs";
import * as path from "path";
import * as http from "http";
import { fileURLToPath } from "url";
import { scanRepository, type ScanResult } from "./scanner/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let currentStructure: ScanResult | null = null;

function jsonResponse(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

const MIME_TYPES: Record<string, string> = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function serveStatic(res: http.ServerResponse, filePath: string) {
  if (!fs.existsSync(filePath)) {
    // SPA fallback
    const dashboardDir = path.join(__dirname, "..", "dashboard");
    const indexPath = path.join(dashboardDir, "index.html");
    if (fs.existsSync(indexPath)) {
      res.writeHead(200, { "Content-Type": "text/html" });
      fs.createReadStream(indexPath).pipe(res);
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
    return;
  }

  const ext = path.extname(filePath);
  const mime = MIME_TYPES[ext] || "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  fs.createReadStream(filePath).pipe(res);
}

export function createServer(repoPath: string, port: number): http.Server {
  // Initial scan
  try {
    currentStructure = scanRepository(repoPath);
  } catch (err) {
    console.error("Initial scan failed:", err);
  }

  const dashboardDir = path.join(__dirname, "..", "dashboard");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    // API routes
    if (url.pathname === "/api/health") {
      return jsonResponse(res, 200, { status: "ok" });
    }

    if (url.pathname === "/api/structure" && req.method === "GET") {
      if (!currentStructure) {
        return jsonResponse(res, 404, { error: "No structure data. Trigger a scan first." });
      }
      return jsonResponse(res, 200, currentStructure);
    }

    if (url.pathname === "/api/scan" && req.method === "POST") {
      try {
        const body = JSON.parse(await readBody(req));
        const scanPath = body.repoPath;
        if (!scanPath || typeof scanPath !== "string") {
          return jsonResponse(res, 400, { error: "repoPath is required" });
        }
        const resolved = path.resolve(scanPath);
        if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
          return jsonResponse(res, 400, { error: `'${scanPath}' is not a directory` });
        }
        currentStructure = scanRepository(resolved);
        return jsonResponse(res, 200, { status: "ok", metadata: currentStructure.metadata });
      } catch (err) {
        return jsonResponse(res, 500, { error: `Scan failed: ${err}` });
      }
    }

    if (url.pathname === "/api/analytics" && req.method === "GET") {
      if (!currentStructure) return jsonResponse(res, 200, { circularDeps: [], deadFiles: [], dependents: {} });
      return jsonResponse(res, 200, currentStructure.analytics);
    }

    if (url.pathname === "/api/analytics/impact" && req.method === "GET") {
      const nodeId = url.searchParams.get("nodeId");
      if (!nodeId) return jsonResponse(res, 400, { error: "nodeId is required" });
      if (!currentStructure) return jsonResponse(res, 200, { nodeId, impacted: [] });
      const dependents = (currentStructure.analytics.dependents ?? {}) as Record<string, string[]>;
      const visited = new Set<string>();
      const queue = [nodeId];
      while (queue.length > 0) {
        const n = queue.shift()!;
        if (visited.has(n)) continue;
        visited.add(n);
        for (const parent of dependents[n] ?? []) {
          if (!visited.has(parent)) queue.push(parent);
        }
      }
      visited.delete(nodeId);
      return jsonResponse(res, 200, { nodeId, impacted: [...visited] });
    }

    // Serve dashboard static files
    if (fs.existsSync(dashboardDir)) {
      const filePath = path.join(dashboardDir, url.pathname === "/" ? "index.html" : url.pathname);
      // Prevent path traversal
      const resolved = path.resolve(filePath);
      if (!resolved.startsWith(path.resolve(dashboardDir))) {
        res.writeHead(403);
        res.end("Forbidden");
        return;
      }
      return serveStatic(res, resolved);
    }

    res.writeHead(404);
    res.end("Not Found");
  });

  return server;
}
