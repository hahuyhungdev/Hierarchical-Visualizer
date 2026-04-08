#!/usr/bin/env python3
"""
Static Analyzer for React/TypeScript repositories.
Scans import statements to build a hierarchical dependency graph
organized into layers: Pages -> Features -> Shared/UI -> API Services.
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import Optional


# ───────────────────────── Import Parser ─────────────────────────

# Matches: import X from './path' | import { X } from './path' | import './path'
IMPORT_RE = re.compile(
    r"""(?:import\s+(?:(?:type\s+)?(?:[\w*\s{},]+)\s+from\s+)?['\"]([^'\"]+)['\"])|"""
    r"""(?:require\s*\(\s*['\"]([^'\"]+)['\"]\s*\))""",
    re.MULTILINE,
)

# Matches API calls: axios.get('/api/...'), fetch('/api/...'), etc.
API_CALL_RE = re.compile(
    r"""(?:axios|fetch|api|http|request)\s*[\.(]\s*['\"`]([^'\"` ]+)['\"`]""",
    re.IGNORECASE,
)

# Matches route definitions: path: '/...', <Route path="..." />
ROUTE_RE = re.compile(
    r"""(?:path\s*[:=]\s*['\"]([^'\"]+)['\"])|"""
    r"""(?:<Route[^>]*path\s*=\s*[{'\"]([^'\"} ]+)[}'\"][^>]*>)""",
    re.MULTILINE,
)

# File extensions to scan
EXTENSIONS = {".tsx", ".ts", ".jsx", ".js"}

# Directories to ignore
IGNORE_DIRS = {"node_modules", ".git", "dist", "build", ".next", "__pycache__", ".cache"}


def resolve_import_path(
    source_file: Path, import_path: str, src_root: Path
) -> Optional[Path]:
    """Resolve a relative or alias import to an absolute file path."""
    if import_path.startswith("."):
        base = source_file.parent
        resolved = (base / import_path).resolve()
    elif import_path.startswith("@/") or import_path.startswith("~/"):
        resolved = (src_root / import_path[2:]).resolve()
    elif import_path.startswith("src/"):
        resolved = (src_root / import_path[4:]).resolve()
    else:
        # External package — skip
        return None

    # Try exact match, then with extensions, then /index
    candidates = [resolved]
    for ext in EXTENSIONS:
        candidates.append(resolved.with_suffix(ext))
    for ext in EXTENSIONS:
        candidates.append(resolved / f"index{ext}")

    for c in candidates:
        if c.is_file():
            return c
    return None


def scan_file(filepath: Path) -> dict:
    """Parse a single file for imports and API calls."""
    try:
        content = filepath.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return {"imports": [], "api_calls": [], "routes": [], "export_default": False}

    imports = []
    for m in IMPORT_RE.finditer(content):
        imp = m.group(1) or m.group(2)
        if imp:
            imports.append(imp)

    api_calls = [m.group(1) for m in API_CALL_RE.finditer(content)]
    routes = [m.group(1) or m.group(2) for m in ROUTE_RE.finditer(content) if m.group(1) or m.group(2)]
    has_default = bool(re.search(r"export\s+default", content))

    return {
        "imports": imports,
        "api_calls": api_calls,
        "routes": routes,
        "export_default": has_default,
    }


# ───────────────────────── Layer Classification ─────────────────────────


def classify_layer(rel_path: str) -> str:
    """Classify a file into a layer based on its path."""
    parts = rel_path.lower().replace("\\", "/")

    if any(p in parts for p in ["/pages/", "/views/", "/routes/", "/app/page", "/app/layout"]):
        return "page"
    if any(p in parts for p in ["/features/", "/modules/", "/containers/", "/sections/"]):
        return "feature"
    if any(p in parts for p in ["/services/", "/api/", "/hooks/use", "/lib/api", "/utils/api"]):
        return "api_service"
    if any(p in parts for p in ["/components/", "/ui/", "/shared/", "/common/", "/elements/"]):
        return "shared"

    # Fallback heuristic
    return "shared"


LAYER_ORDER = {"page": 0, "feature": 1, "shared": 2, "api_service": 3}
LAYER_LABELS = {"page": "Pages", "feature": "Features", "shared": "Shared / UI", "api_service": "API Services"}


# ───────────────────────── Tree-shaking ─────────────────────────


def find_used_files(entry_files: set[Path], all_imports: dict[Path, list[Path]]) -> set[Path]:
    """BFS from entry files (pages) to find all transitively used files."""
    visited = set()
    queue = list(entry_files)
    while queue:
        current = queue.pop(0)
        if current in visited:
            continue
        visited.add(current)
        for dep in all_imports.get(current, []):
            if dep not in visited:
                queue.append(dep)
    return visited


# ───────────────────────── Main Scanner ─────────────────────────


def scan_repository(repo_path: str) -> dict:
    """Scan a React repository and produce a hierarchical structure."""
    root = Path(repo_path).resolve()

    # Detect src root
    src_root = root / "src" if (root / "src").is_dir() else root

    # 1. Discover all source files
    all_files: list[Path] = []
    for dirpath, dirnames, filenames in os.walk(src_root):
        dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
        for fn in filenames:
            fp = Path(dirpath) / fn
            if fp.suffix in EXTENSIONS:
                all_files.append(fp)

    # 2. Parse every file
    file_data: dict[Path, dict] = {}
    for fp in all_files:
        file_data[fp] = scan_file(fp)

    # 3. Resolve imports to actual file paths
    resolved_imports: dict[Path, list[Path]] = {}
    for fp, data in file_data.items():
        deps = []
        for imp in data["imports"]:
            resolved = resolve_import_path(fp, imp, src_root)
            if resolved and resolved in file_data:
                deps.append(resolved)
        resolved_imports[fp] = deps

    # 4. Classify each file into a layer
    file_layers: dict[Path, str] = {}
    for fp in all_files:
        rel = str(fp.relative_to(root))
        file_layers[fp] = classify_layer(rel)

    # 5. Tree-shaking: only keep files reachable from pages
    page_files = {fp for fp, layer in file_layers.items() if layer == "page"}

    # If no pages detected, treat files with routes as pages
    if not page_files:
        for fp, data in file_data.items():
            if data["routes"]:
                file_layers[fp] = "page"
                page_files.add(fp)

    # If still no pages, use all files (no tree-shaking)
    if page_files:
        used = find_used_files(page_files, resolved_imports)
    else:
        used = set(all_files)

    # 6. Collect API endpoints from api_call patterns
    all_api_endpoints: set[str] = set()
    for fp in used:
        for call in file_data[fp].get("api_calls", []):
            all_api_endpoints.add(call)

    # 7. Build the output structure
    nodes = []
    edges = []
    node_id_map: dict[Path, str] = {}
    import_count: dict[Path, int] = {}

    # Count how many times each file is imported (for sizing)
    for fp in used:
        for dep in resolved_imports.get(fp, []):
            if dep in used:
                import_count[dep] = import_count.get(dep, 0) + 1

    # Create nodes
    for fp in sorted(used):
        rel = str(fp.relative_to(root))
        nid = rel.replace("/", "__").replace(".", "_")
        node_id_map[fp] = nid
        layer = file_layers[fp]

        nodes.append({
            "id": nid,
            "label": fp.stem,
            "filePath": rel,
            "layer": layer,
            "layerIndex": LAYER_ORDER.get(layer, 2),
            "layerLabel": LAYER_LABELS.get(layer, "Shared / UI"),
            "apiCalls": file_data[fp].get("api_calls", []),
            "routes": file_data[fp].get("routes", []),
            "importCount": import_count.get(fp, 0),
        })

    # Create edges
    edge_set = set()
    for fp in used:
        src_id = node_id_map.get(fp)
        if not src_id:
            continue
        for dep in resolved_imports.get(fp, []):
            tgt_id = node_id_map.get(dep)
            if tgt_id and (src_id, tgt_id) not in edge_set:
                edge_set.add((src_id, tgt_id))
                edges.append({
                    "id": f"e_{src_id}__{tgt_id}",
                    "source": src_id,
                    "target": tgt_id,
                })

    # Create API endpoint nodes
    for i, endpoint in enumerate(sorted(all_api_endpoints)):
        api_id = f"api_endpoint_{i}"
        nodes.append({
            "id": api_id,
            "label": endpoint,
            "filePath": None,
            "layer": "api_endpoint",
            "layerIndex": 4,
            "layerLabel": "Backend API Endpoints",
            "apiCalls": [],
            "routes": [],
            "importCount": 0,
        })
        # Connect service files to their endpoints
        for fp in used:
            if file_layers.get(fp) in ("api_service", "shared", "feature", "page"):
                if endpoint in file_data[fp].get("api_calls", []):
                    src_id = node_id_map[fp]
                    eid = f"e_{src_id}__{api_id}"
                    if (src_id, api_id) not in edge_set:
                        edge_set.add((src_id, api_id))
                        edges.append({
                            "id": eid,
                            "source": src_id,
                            "target": api_id,
                        })

    # Build parent-child groupings (pages contain their direct features)
    groups = []
    for fp in used:
        if file_layers[fp] == "page":
            page_id = node_id_map[fp]
            children = []
            for dep in resolved_imports.get(fp, []):
                if dep in used and file_layers.get(dep) == "feature":
                    children.append(node_id_map[dep])
            groups.append({
                "parentId": page_id,
                "childIds": children,
            })

    # Layer definitions for the frontend
    layers = [
        {"id": "page", "index": 0, "label": "Pages", "color": "#4F46E5"},
        {"id": "feature", "index": 1, "label": "Features", "color": "#0891B2"},
        {"id": "shared", "index": 2, "label": "Shared / UI", "color": "#059669"},
        {"id": "api_service", "index": 3, "label": "API Services", "color": "#D97706"},
        {"id": "api_endpoint", "index": 4, "label": "Backend Endpoints", "color": "#DC2626"},
    ]

    structure = {
        "repoPath": str(root),
        "srcRoot": str(src_root),
        "layers": layers,
        "nodes": nodes,
        "edges": edges,
        "groups": groups,
        "metadata": {
            "totalFiles": len(all_files),
            "analyzedFiles": len(used),
            "treeShakedFiles": len(all_files) - len(used),
            "totalEdges": len(edges),
            "apiEndpoints": len(all_api_endpoints),
        },
    }

    return structure


def main():
    if len(sys.argv) < 2:
        print("Usage: python scanner.py <repo_path> [output_path]")
        sys.exit(1)

    repo_path = sys.argv[1]
    output_path = sys.argv[2] if len(sys.argv) > 2 else "structure.json"

    if not os.path.isdir(repo_path):
        print(f"Error: '{repo_path}' is not a directory")
        sys.exit(1)

    print(f"Scanning repository: {repo_path}")
    structure = scan_repository(repo_path)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(structure, f, indent=2)

    meta = structure["metadata"]
    print(f"Done! Analyzed {meta['analyzedFiles']}/{meta['totalFiles']} files "
          f"({meta['treeShakedFiles']} tree-shaked)")
    print(f"Nodes: {len(structure['nodes'])}, Edges: {meta['totalEdges']}, "
          f"API Endpoints: {meta['apiEndpoints']}")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
