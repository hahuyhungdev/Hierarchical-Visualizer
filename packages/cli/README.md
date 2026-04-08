# StructDecipher

Instantly visualize the architecture of any React/TypeScript project. Zero config — just run `npx structdecipher` and get an interactive dependency graph in your browser.

## Quick Start

```bash
npx structdecipher
```

That's it. Opens a dashboard showing your project's dependency graph, layer classification, API endpoints, and circular dependencies.

## Features

- **Dependency Graph** — Interactive React Flow visualization with drag, zoom, and pan
- **Layer Classification** — Automatically groups files into Pages, Components, Hooks, Services, Utils, Store, Types, Config
- **Circular Dependency Detection** — Highlights cycles with DFS + Tarjan's SCC
- **API Endpoint Tracking** — Detects fetch/axios/openapi-fetch/openapi-ts calls
- **Dead Code Detection** — Finds unreachable files via BFS tree-shaking
- **Impact Analysis** — Click any node to see what depends on it

### Framework Support

| Framework | Detection | File-based Routing |
|---|---|---|
| React (CRA / Vite) | ✅ | — |
| Next.js (pages & app) | ✅ | ✅ |
| Remix | ✅ | ✅ |
| TanStack Router | ✅ | ✅ |
| Gatsby | ✅ | ✅ |
| Feature-Sliced Design | ✅ | ✅ (violations) |

### Monorepo Support

Automatically detects npm/yarn/pnpm workspaces and scans all packages.

## Usage

```bash
# Scan current directory, open dashboard
npx structdecipher

# Scan a specific project
npx structdecipher ./my-react-app

# Output JSON to stdout (no server)
npx structdecipher . --json

# Save structure to file
npx structdecipher . -o structure.json

# Custom port
npx structdecipher . --port 4000

# Don't auto-open browser
npx structdecipher . --no-open
```

## Options

| Flag | Short | Description |
|---|---|---|
| `--json` | `-j` | Output JSON to stdout, no server |
| `--output <file>` | `-o` | Write JSON to file |
| `--port <port>` | `-p` | Server port (default: 5173) |
| `--no-open` | | Don't open browser automatically |
| `--help` | `-h` | Show help |

## Programmatic API

```typescript
import { scanRepository } from "structdecipher";

const result = scanRepository("./my-project");

console.log(result.nodes);       // File nodes with layer info
console.log(result.edges);       // Import relationships
console.log(result.analytics);   // Circular deps, dead files, dependents
console.log(result.metadata);    // Framework, scan time, file counts
```

## Output Structure

```json
{
  "nodes": [
    {
      "id": "src/App.tsx",
      "label": "App",
      "layer": "component",
      "filePath": "src/App.tsx",
      "lineCount": 42,
      "hasDefaultExport": true,
      "apiCalls": ["/api/users"],
      "routes": ["/dashboard"]
    }
  ],
  "edges": [
    { "source": "src/App.tsx", "target": "src/hooks/useAuth.ts" }
  ],
  "analytics": {
    "circularDeps": [],
    "deadFiles": ["src/utils/deprecated.ts"],
    "scc": [],
    "dependents": {}
  },
  "metadata": {
    "framework": "nextjs",
    "analyzedFiles": 85,
    "totalEdges": 142,
    "scanTimeMs": 12
  }
}
```

## Requirements

- Node.js >= 18

## License

MIT
