#!/usr/bin/env node

/**
 * StructDecipher CLI
 * Usage:
 *   npx structdecipher              # scan current directory, open dashboard
 *   npx structdecipher ./my-app     # scan specific project
 *   npx structdecipher --json       # output JSON only, no server
 *   npx structdecipher --port 4000  # custom port
 */

import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import { scanRepository } from "./scanner/index.js";
import { createServer } from "./server.js";

const args = process.argv.slice(2);

let repoPath = ".";
let jsonOnly = false;
let outputFile: string | null = null;
let port = 5173;
let noOpen = false;

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--json" || arg === "-j") {
    jsonOnly = true;
  } else if (arg === "--output" || arg === "-o") {
    outputFile = args[++i];
  } else if (arg === "--port" || arg === "-p") {
    port = parseInt(args[++i], 10) || 5173;
  } else if (arg === "--no-open") {
    noOpen = true;
  } else if (arg === "--help" || arg === "-h") {
    console.log(`
  StructDecipher — Visualize React/TypeScript project architecture

  Usage:
    structdecipher [path] [options]

  Options:
    --json, -j          Output JSON to stdout (no server)
    --output, -o <file> Write JSON to file
    --port, -p <port>   Server port (default: 5173)
    --no-open           Don't open browser automatically
    --help, -h          Show this help

  Examples:
    structdecipher                      # scan current dir, open dashboard
    structdecipher ./my-react-app       # scan specific project
    structdecipher . --json             # print structure JSON
    structdecipher . -o structure.json  # save to file
    structdecipher . --port 4000        # custom port
`);
    process.exit(0);
  } else if (!arg.startsWith("-")) {
    repoPath = arg;
  }
}

const resolvedPath = path.resolve(repoPath);
if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isDirectory()) {
  console.error(`Error: '${repoPath}' is not a valid directory`);
  process.exit(1);
}

// ── JSON-only mode ──
if (jsonOnly || outputFile) {
  try {
    const result = scanRepository(resolvedPath);
    const json = JSON.stringify(result, null, 2);
    if (outputFile) {
      fs.writeFileSync(outputFile, json, "utf-8");
      console.log(`✓ Structure written to ${outputFile}`);
      const meta = result.metadata;
      console.log(`  ${meta.analyzedFiles} files analyzed, ${meta.totalEdges} edges, ${meta.scanTimeMs}ms`);
    } else {
      process.stdout.write(json + "\n");
    }
  } catch (err) {
    console.error("Scan failed:", err);
    process.exit(1);
  }
  process.exit(0);
}

// ── Server mode ──
console.log(`
  ╔═══════════════════════════════════════════════╗
  ║          StructDecipher                       ║
  ╚═══════════════════════════════════════════════╝
`);
console.log(`  Scanning: ${resolvedPath}`);

const server = createServer(resolvedPath, port);

server.listen(port, () => {
  console.log(`  Dashboard: http://localhost:${port}`);
  console.log(`  API:       http://localhost:${port}/api/structure`);
  console.log(`\n  Press Ctrl+C to stop.\n`);

  if (!noOpen) {
    // Open browser
    const url = `http://localhost:${port}`;
    const cmd =
      process.platform === "darwin"
        ? `open "${url}"`
        : process.platform === "win32"
          ? `start "${url}"`
          : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});

process.on("SIGINT", () => {
  console.log("\n  Shutting down...");
  server.close();
  process.exit(0);
});
