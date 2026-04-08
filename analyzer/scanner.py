#!/usr/bin/env python3
"""
Static Analyzer for React/TypeScript repositories.
Handles real-world project structures including:

  - Folder-based components: Button/index.tsx, PostFeed/PostFeed.tsx
  - Next.js App Router: app/(group)/page.tsx, app/api/route.ts, [slug], [...catchAll]
  - Next.js Pages Router: pages/blog/[id].tsx
  - TanStack Router: routes/__root.tsx, routes/posts.$postId.tsx
  - Remix: routes/_layout.tsx, routes/posts.$slug.tsx
  - Feature-Sliced Design (FSD): app/, pages/, widgets/, features/, entities/, shared/
  - Barrel exports: components/index.ts re-exporting
  - Path aliases: @/, ~/, #/, src/
  - tsconfig paths (basic support)
"""

import json
import os
import re
import sys
from pathlib import Path
from typing import Optional


# ───────────────────────── Constants ─────────────────────────

EXTENSIONS = {".tsx", ".ts", ".jsx", ".js", ".mjs"}
INDEX_NAMES = {f"index{e}" for e in EXTENSIONS}
IGNORE_DIRS = {
    "node_modules", ".git", "dist", "build", ".next", ".output",
    "__pycache__", ".cache", ".turbo", ".vercel", "coverage", ".nuxt",
}

# ───────────────────────── Regex Patterns ─────────────────────────

# import ... from 'path' | require('path') | dynamic import('path') | export ... from 'path'
IMPORT_RE = re.compile(
    r"""(?:import\s+(?:(?:type\s+)?(?:[\w*\s{},]+)\s+from\s+)?['"]([^'"]+)['"])|"""
    r"""(?:require\s*\(\s*['"]([^'"]+)['"]\s*\))|"""
    r"""(?:import\s*\(\s*['"]([^'"]+)['"]\s*\))|"""
    r"""(?:export\s+(?:(?:type\s+)?(?:[\w*\s{},]+)\s+from\s+)?['"]([^'"]+)['"])""",
    re.MULTILINE,
)

# API calls: axios.get('/api/...'), fetch('/api/...'), useFetch, $fetch, ky, etc.
API_CALL_RE = re.compile(
    r"""(?:"""
    r"""(?:axios(?:\.(?:get|post|put|patch|delete|request|head|options))?)|"""
    r"""fetch|"""
    r"""\$fetch|"""
    r"""useFetch|"""
    r"""(?:api|http|request|client)(?:\.(?:get|post|put|patch|delete|request))?|"""
    r"""ky(?:\.(?:get|post|put|patch|delete))?"""
    r""")\s*[.(]\s*['"`]([^'"`\s]+)['"`]""",
    re.IGNORECASE,
)

# openapi-fetch: anyVar.GET("/path"), fetchClient.POST("/path"), etc.
OPENAPI_FETCH_RE = re.compile(
    r"""[\w$]+\.(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(\s*['"`]([^'"`\s]+)['"`]"""
)

# openapi-react-query: $api.useQuery("get", "/path"), $api.useMutation("post", "/path"), etc.
OPENAPI_RQ_RE = re.compile(
    r"""[\w$]+\.(?:useQuery|useSuspenseQuery|useMutation|useInfiniteQuery|queryOptions|prefetchQuery)"""
    r"""\s*\(\s*['"`]\w+['"`]\s*,\s*['"`]([^'"`\s]+)['"`]"""
)

# Route definitions for classic React Router, TanStack, etc.
ROUTE_RE = re.compile(
    r"""(?:path\s*[:=]\s*['"]([^'"]+)['"])|"""
    r"""(?:<Route[^>]*path\s*=\s*[{'"](/?[^'"}\s]+)[}'"]\s*[^>]*>)|"""
    r"""(?:createRoute\s*\(\s*\{[^}]*path\s*:\s*['"]([^'"]+)['"])""",
    re.MULTILINE,
)


# Normalize template-literal API endpoints: ${BASE_URL}/users → /users
TEMPLATE_VAR_RE = re.compile(r"\$\{[^}]+\}")

def normalize_api_endpoint(raw: str) -> str:
    """Strip JS template variables and clean up API endpoint strings."""
    cleaned = TEMPLATE_VAR_RE.sub("", raw)
    # Remove leading empty segments from stripped vars: e.g. "/users" stays
    cleaned = re.sub(r"^/+", "/", cleaned)
    # Remove trailing ? from query params left behind
    cleaned = cleaned.rstrip("?&")
    # If stripping template vars left nothing meaningful, skip entirely
    if not cleaned or cleaned == "/" or cleaned == raw.replace("${", "").replace("}", ""):
        # Check if the raw string is entirely made of template vars
        fully_template = TEMPLATE_VAR_RE.sub("", raw).strip("/").strip()
        if not fully_template:
            return ""  # signal to skip
    return cleaned


# ───────────────────────── Framework Detection ─────────────────────────

def detect_framework(root: Path) -> str:
    """Detect the framework from package.json dependencies."""
    pkg_json = root / "package.json"
    if not pkg_json.exists():
        return "react"

    try:
        import json as _json
        pkg = _json.loads(pkg_json.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return "react"

    all_deps = {}
    for key in ("dependencies", "devDependencies", "peerDependencies"):
        all_deps.update(pkg.get(key, {}))

    if "next" in all_deps:
        return "nextjs"
    if "@tanstack/react-router" in all_deps or "@tanstack/router" in all_deps:
        return "tanstack-router"
    if "@remix-run/react" in all_deps or "remix" in all_deps:
        return "remix"
    if "gatsby" in all_deps:
        return "gatsby"
    return "react"


def detect_alias_paths(root: Path) -> dict[str, Path]:
    """Read tsconfig.json / jsconfig.json to resolve path aliases."""
    aliases: dict[str, Path] = {}
    for config_name in ("tsconfig.json", "jsconfig.json"):
        config_path = root / config_name
        if not config_path.exists():
            continue
        try:
            # Strip comments (// and /* */) for JSON parsing
            raw = config_path.read_text(encoding="utf-8", errors="ignore")
            raw = re.sub(r"//[^\n]*", "", raw)
            raw = re.sub(r"/\*.*?\*/", "", raw, flags=re.DOTALL)
            cfg = json.loads(raw)
            paths = cfg.get("compilerOptions", {}).get("paths", {})
            base_url = cfg.get("compilerOptions", {}).get("baseUrl", ".")
            base = (root / base_url).resolve()

            for alias_pattern, targets in paths.items():
                if not targets:
                    continue
                # "@/*" -> ["src/*"]
                target = targets[0]
                alias_prefix = alias_pattern.replace("/*", "").replace("*", "")
                target_prefix = target.replace("/*", "").replace("*", "")
                resolved_target = (base / target_prefix).resolve()
                if alias_prefix:
                    aliases[alias_prefix] = resolved_target
        except Exception:
            pass
    return aliases


# ───────────────────────── FSD Detection ─────────────────────────

# FSD canonical layer names (top → bottom, highest index = lowest layer)
FSD_LAYERS = ("app", "processes", "pages", "widgets", "features", "entities", "shared")

# FSD layer hierarchy index — lower number = higher layer (more authority)
FSD_LAYER_HIERARCHY: dict[str, int] = {
    "app": 0,
    "processes": 1,
    "pages": 2,
    "widgets": 3,
    "features": 4,
    "entities": 5,
    "shared": 6,
}

# Common FSD segments inside slices
FSD_SEGMENTS = {"ui", "api", "model", "lib", "config", "routes", "store", "styles", "i18n", "types", "consts"}


def detect_fsd(root: Path) -> bool:
    """
    Detect if a project follows Feature-Sliced Design architecture.
    Looks for at least 2 FSD-specific layer folders (entities, widgets, features)
    at the src/ or root level, with segment-like sub-structure.
    """
    src_root = root / "src" if (root / "src").is_dir() else root

    # FSD-specific folders that don't overlap with other patterns
    # (pages/, features/ exist in non-FSD too, but entities/ and widgets/ are strong signals)
    strong_signals = 0
    weak_signals = 0

    for layer_name in FSD_LAYERS:
        layer_dir = src_root / layer_name
        if not layer_dir.is_dir():
            continue

        if layer_name in ("entities", "widgets"):
            # Strong FSD signals — these folders are rare outside FSD
            strong_signals += 1
        elif layer_name in ("features", "shared"):
            # Check if they contain slices with segments (FSD pattern)
            has_fsd_structure = False
            try:
                for child in layer_dir.iterdir():
                    if child.is_dir() and not child.name.startswith("."):
                        # Check for FSD segments inside slice
                        child_dirs = {c.name for c in child.iterdir() if c.is_dir()}
                        if child_dirs & FSD_SEGMENTS:
                            has_fsd_structure = True
                            break
            except OSError:
                pass
            if has_fsd_structure:
                weak_signals += 1
        elif layer_name == "app":
            # Check if app/ has segments, not Next.js routes
            try:
                child_dirs = {c.name for c in layer_dir.iterdir() if c.is_dir()}
                if child_dirs & {"routes", "styles", "store", "providers", "entrypoint"}:
                    weak_signals += 1
            except OSError:
                pass

    # Need at least one strong signal or 2+ weak signals alongside features/shared
    return strong_signals >= 1 or (weak_signals >= 2 and strong_signals >= 0)


# ───────────────────────── Import Resolution ─────────────────────────

# Per-scan import resolution cache to avoid O(n²) repeated disk lookups
_resolve_cache: dict[tuple[str, str], Optional[Path]] = {}


def resolve_import_path(
    source_file: Path,
    import_path: str,
    src_root: Path,
    aliases: dict[str, Path],
) -> Optional[Path]:
    """Resolve a relative or alias import to an actual file path (cached)."""
    cache_key = (str(source_file.parent), import_path)
    if cache_key in _resolve_cache:
        return _resolve_cache[cache_key]

    result = _resolve_import_path_uncached(source_file, import_path, src_root, aliases)
    _resolve_cache[cache_key] = result
    return result


def _resolve_import_path_uncached(
    source_file: Path,
    import_path: str,
    src_root: Path,
    aliases: dict[str, Path],
) -> Optional[Path]:
    """Resolve a relative or alias import to an actual file path."""
    resolved: Optional[Path] = None

    if import_path.startswith("."):
        # Relative import
        resolved = (source_file.parent / import_path).resolve()
    else:
        # Try aliases first (from tsconfig paths)
        for prefix, target_dir in aliases.items():
            if import_path == prefix or import_path.startswith(prefix + "/"):
                remainder = import_path[len(prefix):].lstrip("/")
                resolved = (target_dir / remainder).resolve()
                break

        if resolved is None:
            # Common hard-coded aliases
            for alias_prefix, rel_target in [
                ("@/", "src/"), ("~/", "src/"), ("#/", "src/"),
                ("@components/", "src/components/"),
                ("@features/", "src/features/"),
                ("@hooks/", "src/hooks/"),
                ("@services/", "src/services/"),
                ("@utils/", "src/utils/"),
                ("@lib/", "src/lib/"),
                ("@app/", "src/app/"),
                ("src/", "src/"),
            ]:
                if import_path.startswith(alias_prefix):
                    remainder = import_path[len(alias_prefix):]
                    # The rel_target is relative to root, not src_root
                    resolved = (src_root.parent / rel_target / remainder).resolve()
                    break

        if resolved is None:
            # External package — skip
            return None

    # Try resolving: exact → +ext → /index.ext → /Name.ext (folder component)
    candidates = [resolved]
    for ext in EXTENSIONS:
        candidates.append(resolved.with_suffix(ext))
    for ext in EXTENSIONS:
        candidates.append(resolved / f"index{ext}")
    # Folder-based component: PostFeed/PostFeed.tsx
    if resolved.name:
        folder_name = resolved.name
        for ext in EXTENSIONS:
            candidates.append(resolved / f"{folder_name}{ext}")

    for c in candidates:
        if c.is_file():
            return c
    return None


# ───────────────────────── File Parsing ─────────────────────────

def scan_file(filepath: Path) -> dict:
    """Parse a single file for imports, API calls, and route definitions."""
    try:
        content = filepath.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return {"imports": [], "api_calls": [], "routes": [], "export_default": False, "is_barrel": False}

    # Imports
    imports = []
    for m in IMPORT_RE.finditer(content):
        imp = m.group(1) or m.group(2) or m.group(3) or m.group(4)
        if imp:
            imports.append(imp)

    # API calls — normalize template literals
    api_calls_raw = [m.group(1) for m in API_CALL_RE.finditer(content)]
    # openapi-fetch: client.GET("/path"), fetchClient.POST("/path"), etc.
    api_calls_raw += [m.group(1) for m in OPENAPI_FETCH_RE.finditer(content)]
    # openapi-react-query: $api.useQuery("get", "/path"), $api.useMutation("post", "/path"), etc.
    api_calls_raw += [m.group(1) for m in OPENAPI_RQ_RE.finditer(content)]
    # Deduplicate & normalize (filter out empty results from pure template vars)
    api_calls = list(dict.fromkeys(
        ep for ep in (normalize_api_endpoint(c) for c in api_calls_raw) if ep
    ))

    # Route definitions
    routes = []
    for m in ROUTE_RE.finditer(content):
        r = m.group(1) or m.group(2) or m.group(3)
        if r:
            routes.append(r)

    has_default = bool(re.search(r"export\s+default", content))

    # Detect barrel files (index.ts that only re-exports)
    is_barrel = False
    if filepath.stem == "index":
        lines = [l.strip() for l in content.split("\n") if l.strip() and not l.strip().startswith("//")]
        if lines and all(l.startswith("export ") for l in lines):
            is_barrel = True

    line_count = len(content.split("\n"))

    return {
        "imports": imports,
        "api_calls": api_calls,
        "routes": routes,
        "export_default": has_default,
        "is_barrel": is_barrel,
        "line_count": line_count,
    }


# ───────────────────────── Layer Classification ─────────────────────────

def classify_layer(rel_path: str, framework: str, file_data: dict, is_fsd: bool = False) -> str:
    """
    Classify a file into a layer based on its path and the framework.
    Returns: 'page', 'feature', 'shared', 'api_service', 'api_route', 'layout', 'middleware'
    Or for FSD: 'fsd_app', 'fsd_processes', 'fsd_pages', 'fsd_widgets', 'fsd_features', 'fsd_entities', 'fsd_shared'
    """
    p = rel_path.lower().replace("\\", "/")
    name = os.path.basename(rel_path).lower()
    stem = os.path.splitext(name)[0]

    # ── Feature-Sliced Design ──
    if is_fsd:
        return _classify_fsd_layer(p, rel_path, file_data)


    # ── Next.js App Router ──
    if framework == "nextjs":
        # app/api/**/route.ts → backend API route
        if "/app/" in p and "/api/" in p and stem in ("route", "route.ts", "route.js"):
            return "api_route"
        if stem == "route":
            return "api_route"
        # app/**/page.tsx → page
        if stem == "page":
            return "page"
        # app/**/layout.tsx → layout (treated as page-level)
        if stem == "layout" and "/app/" in p:
            return "layout"
        # app/**/loading.tsx, error.tsx, not-found.tsx → shared
        if stem in ("loading", "error", "not-found", "global-error", "template"):
            return "shared"
        # middleware.ts at root
        if stem == "middleware":
            return "middleware"
        # pages/ directory (Pages Router co-existing)
        if "/pages/" in p and stem not in ("_app", "_document"):
            if "/api/" in p:
                return "api_route"
            return "page"
        if stem in ("_app", "_document"):
            return "layout"

    # ── TanStack Router ──
    elif framework == "tanstack-router":
        if "/routes/" in p:
            if stem == "__root" or stem == "__root.tsx":
                return "layout"
            if stem.startswith("_"):
                return "layout"  # layout routes
            return "page"

    # ── Remix ──
    elif framework == "remix":
        if "/routes/" in p:
            if stem.startswith("_"):
                return "layout"
            return "page"
        if "/app/root" in p:
            return "layout"

    # ── Gatsby ──
    elif framework == "gatsby":
        if "/pages/" in p:
            return "page"
        if "/templates/" in p:
            return "page"

    # ── Generic / Classic React ──
    # Pages
    if any(seg in p for seg in ["/pages/", "/views/", "/screens/"]):
        return "page"
    # Route files
    if any(seg in p for seg in ["/routes/"]):
        if stem in ("index", "__root"):
            return "layout"
        return "page"

    # API services / hooks with API
    if any(seg in p for seg in [
        "/services/", "/api/", "/lib/api", "/utils/api",
        "/queries/", "/mutations/",
    ]):
        return "api_service"
    # Hooks that do data fetching
    if "/hooks/" in p and stem.startswith("use"):
        # Check if it makes API calls
        if file_data.get("api_calls"):
            return "api_service"
        return "shared"

    # Features / modules
    if any(seg in p for seg in ["/features/", "/modules/", "/containers/", "/sections/", "/domains/"]):
        return "feature"

    # Shared / UI components
    if any(seg in p for seg in [
        "/components/", "/ui/", "/shared/", "/common/", "/elements/",
        "/atoms/", "/molecules/", "/organisms/",  # atomic design
        "/primitives/",
    ]):
        return "shared"

    # Store / state
    if any(seg in p for seg in ["/store/", "/stores/", "/state/", "/redux/", "/zustand/", "/context/"]):
        return "shared"

    # Lib / utils
    if any(seg in p for seg in ["/lib/", "/utils/", "/helpers/", "/config/"]):
        return "shared"

    return "shared"


def _classify_fsd_layer(p: str, rel_path: str, file_data: dict) -> str:
    """Classify a file into an FSD layer based on its path within src/."""
    # Normalize: strip leading src/ if present
    normalized = p
    if normalized.startswith("src/"):
        normalized = normalized[4:]

    # Match the first path segment to an FSD layer
    for fsd_layer in FSD_LAYERS:
        if normalized == fsd_layer or normalized.startswith(fsd_layer + "/"):
            return f"fsd_{fsd_layer}"

    # Files at src root (e.g., main.tsx, index.tsx) → fsd_app
    return "fsd_app"


LAYER_ORDER = {
    "page": 0,
    "layout": 0,
    "feature": 1,
    "shared": 2,
    "api_service": 3,
    "api_route": 3,
    "middleware": 2,
    # FSD layers (ordered top → bottom)
    "fsd_app": 0,
    "fsd_processes": 1,
    "fsd_pages": 2,
    "fsd_widgets": 3,
    "fsd_features": 4,
    "fsd_entities": 5,
    "fsd_shared": 6,
}
LAYER_LABELS = {
    "page": "Pages",
    "layout": "Layouts",
    "feature": "Features",
    "shared": "Shared / UI",
    "api_service": "API Services",
    "api_route": "API Routes",
    "middleware": "Middleware",
    # FSD layers
    "fsd_app": "App",
    "fsd_processes": "Processes",
    "fsd_pages": "Pages",
    "fsd_widgets": "Widgets",
    "fsd_features": "Features",
    "fsd_entities": "Entities",
    "fsd_shared": "Shared",
}


# ───────────────────────── Display Name ─────────────────────────

def compute_display_name(fp: Path, root: Path, framework: str, is_fsd: bool = False) -> str:
    """
    Compute a human-friendly display name for a file.
    - Button/index.tsx → "Button"
    - app/blog/[slug]/page.tsx → "/blog/[slug]"
    - routes/posts.$postId.tsx → "/posts/$postId"
    - FSD: features/auth/ui/LoginForm.tsx → "auth/LoginForm"
    - FSD: entities/user/model/types.ts → "user/types"
    - FSD: shared/ui/Button.tsx → "ui/Button"
    """
    rel = fp.relative_to(root)
    parts = list(rel.parts)
    stem = fp.stem
    name = fp.name

    # ── FSD display names ──
    if is_fsd:
        return _compute_fsd_display_name(parts, stem)


    # ── Next.js App Router: app/blog/[id]/page.tsx → "/blog/[id]" ──
    if framework == "nextjs" and "app" in parts:
        app_idx = parts.index("app")
        route_parts = parts[app_idx + 1:]
        # Remove the filename, use parent path as route
        if stem in ("page", "layout", "loading", "error", "route", "not-found", "template"):
            route_parts = route_parts[:-1]  # drop filename
            # Remove route groups (xxx)
            route_parts = [p for p in route_parts if not (p.startswith("(") and p.endswith(")"))]
            route = "/" + "/".join(route_parts) if route_parts else "/"
            label = stem.capitalize()
            if stem == "page":
                return route
            return f"{route} ({label})"

        # pages/ router
        if "pages" in parts:
            pages_idx = parts.index("pages")
            route_parts = parts[pages_idx + 1:-1]   # drop filename
            base = fp.stem
            if base == "index":
                return "/" + "/".join(route_parts) if route_parts else "/"
            route_parts.append(base)
            return "/" + "/".join(route_parts)

    # ── Next.js Pages Router ──
    if framework == "nextjs" and "pages" in parts:
        pages_idx = parts.index("pages")
        route_parts = parts[pages_idx + 1:]
        # Drop filename extension part handled by parts
        route_parts[-1] = stem  # use stem instead of full name
        # Remove _app, _document prefix
        if stem.startswith("_"):
            return stem
        if stem == "index":
            route_parts = route_parts[:-1]
        return "/" + "/".join(route_parts) if route_parts else "/"

    # ── TanStack Router: routes/posts.$postId.tsx → "/posts/$postId" ──
    if framework == "tanstack-router" and "routes" in parts:
        routes_idx = parts.index("routes")
        route_parts = parts[routes_idx + 1:]
        route_parts[-1] = stem
        route_str = "/".join(route_parts)
        # Convert dots to slashes, $ stays as param
        route_str = route_str.replace(".", "/")
        if route_str == "index" or route_str == "__root":
            return "/" if route_str == "index" else "__root"
        return "/" + route_str

    # ── Remix: routes/posts.$slug.tsx → "/posts/$slug" ──
    if framework == "remix" and "routes" in parts:
        routes_idx = parts.index("routes")
        route_parts = parts[routes_idx + 1:]
        route_parts[-1] = stem
        route_str = "/".join(route_parts)
        route_str = route_str.replace(".", "/")
        if route_str.startswith("_"):
            return route_str  # layout
        return "/" + route_str

    # ── Folder-based component: Button/index.tsx → "Button" ──
    if stem == "index" and len(parts) >= 2:
        return parts[-2]  # Use folder name

    # ── Folder-based: PostFeed/PostFeed.tsx → "PostFeed" ──
    if len(parts) >= 2 and stem.lower() == parts[-2].lower():
        return stem

    return stem


def _compute_fsd_display_name(parts: list[str], stem: str) -> str:
    """
    Compute display name for FSD files.
    Structure: src/<layer>/<slice>/<segment>/<file>
    - features/auth/ui/LoginForm.tsx → "auth/LoginForm"
    - entities/user/model/types.ts → "user/types"
    - shared/ui/Button.tsx → "ui/Button"
    - shared/api/client.ts → "api/client"
    - app/routes/index.ts → "routes/index"
    - pages/home/ui/HomePage.tsx → "home/HomePage"
    """
    # Strip leading 'src' if present
    if parts and parts[0] == "src":
        parts = parts[1:]

    if not parts:
        return stem

    fsd_layers_set = set(FSD_LAYERS)

    # First part should be the FSD layer name
    if parts[0] in fsd_layers_set:
        layer_name = parts[0]
        rest = parts[1:]  # everything after the layer

        if not rest:
            return stem

        # For app/ and shared/ — no slices, just segments
        if layer_name in ("app", "shared"):
            # rest = [segment, ..., file]
            # Show: segment/file or just file
            rest[-1] = stem  # replace filename with stem
            # Folder-based index: shared/ui/Button/index.tsx → "ui/Button"
            if stem == "index" and len(rest) >= 2:
                rest = rest[:-1]  # drop index, use folder name
            elif len(rest) >= 2 and rest[-1].lower() == rest[-2].lower():
                rest = rest[:-1]  # SameName/SameName.tsx → SameName
            return "/".join(rest)

        # For entities, features, widgets, pages, processes — slices then segments
        # rest = [slice, segment?, ..., file]
        slice_name = rest[0]
        inner = rest[1:]  # everything after the slice

        if not inner:
            return slice_name

        inner[-1] = stem  # replace filename with stem

        # Folder-based index: features/auth/ui/AuthForm/index.tsx → "auth/AuthForm"
        if stem == "index" and len(inner) >= 2:
            inner = inner[:-1]  # drop index, use folder name

        # Ignore the segment name if it's a standard FSD segment - show slice/file
        if len(inner) >= 2 and inner[0] in FSD_SEGMENTS:
            # features/auth/ui/LoginForm.tsx → "auth/LoginForm"
            return f"{slice_name}/{'/'.join(inner[1:])}"

        # features/auth/index.ts → "auth"
        if len(inner) == 1 and inner[0] == "index":
            return slice_name

        # features/auth/SomeName.tsx → "auth/SomeName"
        # Same-name: features/auth/ui/AuthForm/AuthForm.tsx → "auth/AuthForm"
        if len(inner) >= 2 and inner[-1].lower() == inner[-2].lower():
            inner = inner[:-1]
            if inner[0] in FSD_SEGMENTS and len(inner) >= 2:
                return f"{slice_name}/{'/'.join(inner[1:])}"
            return f"{slice_name}/{'/'.join(inner)}"

        return f"{slice_name}/{'/'.join(inner)}"

    # Fallback: not inside an FSD layer folder
    if stem == "index" and len(parts) >= 2:
        return parts[-2]
    return stem

def extract_file_route(fp: Path, root: Path, framework: str) -> Optional[str]:
    """Extract the URL route from file path for file-based routing frameworks."""
    rel = fp.relative_to(root)
    parts = list(rel.parts)
    stem = fp.stem

    if framework == "nextjs":
        if "app" in parts:
            app_idx = parts.index("app")
            route_parts = parts[app_idx + 1:]
            if stem in ("page", "route"):
                route_parts = route_parts[:-1]
                route_parts = [p for p in route_parts if not (p.startswith("(") and p.endswith(")"))]
                return "/" + "/".join(route_parts) if route_parts else "/"
        if "pages" in parts:
            pages_idx = parts.index("pages")
            route_parts = parts[pages_idx + 1:]
            route_parts[-1] = stem
            if stem == "index":
                route_parts = route_parts[:-1]
            if stem.startswith("_"):
                return None
            return "/" + "/".join(route_parts) if route_parts else "/"

    if framework == "tanstack-router" and "routes" in parts:
        routes_idx = parts.index("routes")
        route_parts = parts[routes_idx + 1:]
        route_parts[-1] = stem
        route_str = "/".join(route_parts).replace(".", "/")
        if route_str in ("index", "__root"):
            return "/" if route_str == "index" else None
        return "/" + route_str

    if framework == "remix" and "routes" in parts:
        routes_idx = parts.index("routes")
        route_parts = parts[routes_idx + 1:]
        route_parts[-1] = stem
        route_str = "/".join(route_parts).replace(".", "/")
        if route_str.startswith("_"):
            return None
        return "/" + route_str

    return None


# ───────────────────────── Tree-shaking ─────────────────────────

def find_used_files(entry_files: set[Path], all_imports: dict[Path, list[Path]]) -> set[Path]:
    """BFS from entry files to find all transitively used files."""
    visited: set[Path] = set()
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

def detect_workspaces(root: Path) -> list[Path]:
    """Detect monorepo workspace packages from package.json."""
    pkg_json = root / "package.json"
    if not pkg_json.exists():
        return []
    try:
        pkg = json.loads(pkg_json.read_text(encoding="utf-8", errors="ignore"))
    except Exception:
        return []

    workspace_globs = pkg.get("workspaces", [])
    # Yarn/npm format: "workspaces": ["packages/*", "apps/*"]
    # pnpm uses pnpm-workspace.yaml but also supports this
    if isinstance(workspace_globs, dict):
        workspace_globs = workspace_globs.get("packages", [])
    if not isinstance(workspace_globs, list):
        return []

    # Also check for pnpm-workspace.yaml
    pnpm_ws = root / "pnpm-workspace.yaml"
    if pnpm_ws.exists():
        try:
            content = pnpm_ws.read_text(encoding="utf-8", errors="ignore")
            # Simple YAML parsing for packages list
            in_packages = False
            for line in content.split("\n"):
                stripped = line.strip()
                if stripped == "packages:":
                    in_packages = True
                    continue
                if in_packages and stripped.startswith("- "):
                    glob_pattern = stripped[2:].strip().strip("'\"")
                    if glob_pattern not in workspace_globs:
                        workspace_globs.append(glob_pattern)
                elif in_packages and stripped and not stripped.startswith("#"):
                    in_packages = False
        except Exception:
            pass

    # Resolve glob patterns to actual directories
    import glob as glob_mod
    packages: list[Path] = []
    for pattern in workspace_globs:
        if not isinstance(pattern, str):
            continue
        # Expand glob
        matches = glob_mod.glob(str(root / pattern))
        for m in matches:
            mp = Path(m).resolve()
            if mp.is_dir() and (mp / "package.json").exists():
                packages.append(mp)
    return packages


def scan_repository(repo_path: str) -> dict:
    """Scan a React/Next.js/TanStack/Remix repository and produce a hierarchical structure."""
    root = Path(repo_path).resolve()

    if not root.is_dir():
        raise ValueError(f"'{repo_path}' is not a valid directory")

    # Clear import resolution cache for fresh scan
    _resolve_cache.clear()

    # Detect monorepo workspaces
    workspace_packages = detect_workspaces(root)
    if workspace_packages:
        return _scan_monorepo(root, workspace_packages)

    return _scan_single_repo(root)


def _scan_monorepo(root: Path, packages: list[Path]) -> dict:
    """Scan a monorepo by scanning each workspace package and merging results."""
    all_nodes: list[dict] = []
    all_edges: list[dict] = []
    all_groups: list[dict] = []
    all_circular_deps: list[list[str]] = []
    all_dead_files: list[dict] = []
    all_dependents: dict[str, list[str]] = {}
    total_files = 0
    analyzed_files = 0
    tree_shaked = 0
    barrel_count = 0
    api_endpoints = 0
    frameworks: set[str] = set()

    for pkg_dir in packages:
        try:
            result = _scan_single_repo(pkg_dir)
        except Exception:
            continue
        pkg_name = pkg_dir.name
        # Prefix node IDs to avoid collisions
        id_map: dict[str, str] = {}
        for node in result["nodes"]:
            old_id = node["id"]
            new_id = f"{pkg_name}__{old_id}"
            id_map[old_id] = new_id
            node["id"] = new_id
            node["label"] = f"{pkg_name}/{node['label']}"
            if node["filePath"]:
                # Make path relative to monorepo root
                try:
                    abs_path = (pkg_dir / node["filePath"]).resolve()
                    node["filePath"] = str(abs_path.relative_to(root))
                except ValueError:
                    node["filePath"] = f"{pkg_name}/{node['filePath']}"
            all_nodes.append(node)

        for edge in result["edges"]:
            edge["source"] = id_map.get(edge["source"], edge["source"])
            edge["target"] = id_map.get(edge["target"], edge["target"])
            edge["id"] = f"{pkg_name}__{edge['id']}"
            all_edges.append(edge)

        for group in result["groups"]:
            group["parentId"] = id_map.get(group["parentId"], group["parentId"])
            group["childIds"] = [id_map.get(c, c) for c in group["childIds"]]
            all_groups.append(group)

        # Merge analytics
        pkg_analytics = result.get("analytics", {})
        for cycle in pkg_analytics.get("circularDeps", []):
            all_circular_deps.append([id_map.get(c, c) for c in cycle])
        for df in pkg_analytics.get("deadFiles", []):
            df_copy = dict(df)
            df_copy["filePath"] = f"{pkg_name}/{df_copy['filePath']}"
            all_dead_files.append(df_copy)
        for tgt, srcs in pkg_analytics.get("dependents", {}).items():
            mapped_tgt = id_map.get(tgt, tgt)
            mapped_srcs = [id_map.get(s, s) for s in srcs]
            all_dependents.setdefault(mapped_tgt, []).extend(mapped_srcs)

        meta = result["metadata"]
        total_files += meta["totalFiles"]
        analyzed_files += meta["analyzedFiles"]
        tree_shaked += meta["treeShakedFiles"]
        barrel_count += meta["barrelFiles"]
        api_endpoints += meta["apiEndpoints"]
        frameworks.add(meta["framework"])

    layers = [
        {"id": "page", "index": 0, "label": "Pages", "color": "#818cf8"},
        {"id": "layout", "index": 0, "label": "Layouts", "color": "#a78bfa"},
        {"id": "feature", "index": 1, "label": "Features", "color": "#22d3ee"},
        {"id": "shared", "index": 2, "label": "Shared / UI", "color": "#34d399"},
        {"id": "api_service", "index": 3, "label": "API Services", "color": "#fbbf24"},
        {"id": "api_route", "index": 3, "label": "API Routes", "color": "#fb923c"},
        {"id": "api_endpoint", "index": 4, "label": "Backend Endpoints", "color": "#f87171"},
        {"id": "middleware", "index": 2, "label": "Middleware", "color": "#c084fc"},
    ]

    return {
        "repoPath": str(root),
        "srcRoot": str(root),
        "framework": ", ".join(sorted(frameworks)),
        "layers": layers,
        "nodes": all_nodes,
        "edges": all_edges,
        "groups": all_groups,
        "metadata": {
            "totalFiles": total_files,
            "analyzedFiles": analyzed_files,
            "treeShakedFiles": tree_shaked,
            "barrelFiles": barrel_count,
            "totalEdges": len(all_edges),
            "apiEndpoints": api_endpoints,
            "framework": ", ".join(sorted(frameworks)),
            "workspaces": len(packages),
        },
        "analytics": {
            "circularDeps": all_circular_deps,
            "deadFiles": all_dead_files,
            "dependents": all_dependents,
        },
    }


def _detect_circular_deps(
    resolved_imports: dict[Path, list[Path]],
    node_id_map: dict[Path, str],
) -> list[list[str]]:
    """Detect circular dependency cycles via DFS (coloring)."""
    cycles: list[list[str]] = []
    seen: set[frozenset[str]] = set()
    WHITE, GRAY, BLACK = 0, 1, 2
    color: dict[Path, int] = {fp: WHITE for fp in resolved_imports}
    path: list[Path] = []

    def dfs(fp: Path) -> None:
        color[fp] = GRAY
        path.append(fp)
        for dep in resolved_imports.get(fp, []):
            if dep not in color:
                continue
            if color[dep] == GRAY:
                try:
                    idx = path.index(dep)
                except ValueError:
                    continue
                cycle_ids = [node_id_map[f] for f in path[idx:] if f in node_id_map]
                if len(cycle_ids) >= 2:
                    key = frozenset(cycle_ids)
                    if key not in seen:
                        seen.add(key)
                        cycles.append(cycle_ids)
            elif color[dep] == WHITE:
                dfs(dep)
        path.pop()
        color[fp] = BLACK

    for fp in resolved_imports:
        if color.get(fp, WHITE) == WHITE:
            dfs(fp)
    return cycles


def _detect_fsd_violations(
    display_files: list[Path],
    file_layers: dict[Path, str],
    resolved_imports: dict[Path, list[Path]],
    node_id_map: dict[Path, str],
    resolve_through_barrels,
) -> list[dict]:
    """
    Detect FSD import rule violations.
    Rule: A module in a layer can only import from layers STRICTLY BELOW (higher index).
    Same-layer cross-slice imports are also violations (except within app/ and shared/).
    Imports within the same slice are always allowed.
    """
    violations: list[dict] = []
    seen: set[tuple[str, str]] = set()

    def _get_fsd_slice(fp: Path) -> Optional[str]:
        """Extract the FSD slice name from a file path.
        e.g., .../entities/comment/api/commentApi.ts → 'comment'
              .../shared/ui/Button.tsx → None (no slices in shared)
        """
        parts = list(fp.parts)
        # Find the FSD layer folder
        for i, part in enumerate(parts):
            if part in set(FSD_LAYERS) and i + 1 < len(parts):
                if part in ("app", "shared"):
                    return None  # no slices in app/shared
                return parts[i + 1]  # slice name
        return None

    for fp in display_files:
        src_layer = file_layers.get(fp, "")
        if not src_layer.startswith("fsd_"):
            continue
        src_layer_name = src_layer[4:]  # strip "fsd_"
        src_hierarchy = FSD_LAYER_HIERARCHY.get(src_layer_name)
        if src_hierarchy is None:
            continue
        src_id = node_id_map.get(fp)
        if not src_id:
            continue
        src_slice = _get_fsd_slice(fp)

        for dep in resolved_imports.get(fp, []):
            targets = resolve_through_barrels(dep)
            for actual_target in targets:
                tgt_layer = file_layers.get(actual_target, "")
                if not tgt_layer.startswith("fsd_"):
                    continue
                tgt_layer_name = tgt_layer[4:]
                tgt_hierarchy = FSD_LAYER_HIERARCHY.get(tgt_layer_name)
                if tgt_hierarchy is None:
                    continue
                tgt_id = node_id_map.get(actual_target)
                if not tgt_id or src_id == tgt_id:
                    continue

                # Importing from a HIGHER layer (lower index) = violation
                if tgt_hierarchy < src_hierarchy:
                    key = (src_id, tgt_id)
                    if key not in seen:
                        seen.add(key)
                        violations.append({
                            "source": src_id,
                            "target": tgt_id,
                            "sourceLayer": src_layer_name,
                            "targetLayer": tgt_layer_name,
                            "type": "upward",
                        })

                # Same-layer cross-slice import = violation
                # (except app and shared which don't have slices)
                elif tgt_hierarchy == src_hierarchy and src_layer_name not in ("app", "shared"):
                    tgt_slice = _get_fsd_slice(actual_target)
                    # Only a violation if they're in DIFFERENT slices
                    if src_slice != tgt_slice:
                        key = (src_id, tgt_id)
                        if key not in seen:
                            seen.add(key)
                            violations.append({
                                "source": src_id,
                                "target": tgt_id,
                                "sourceLayer": src_layer_name,
                                "targetLayer": tgt_layer_name,
                                "type": "cross-slice",
                            })

    return violations


def _scan_single_repo(root: Path) -> dict:
    """Scan a single React/Next.js/TanStack/Remix/FSD repository."""
    # Detect framework and aliases
    framework = detect_framework(root)
    aliases = detect_alias_paths(root)

    # Detect FSD architecture
    is_fsd = detect_fsd(root)

    # Detect source root
    src_root = root / "src" if (root / "src").is_dir() else root
    # For Next.js, also scan app/ and pages/ at root level
    scan_roots = [src_root]
    if framework == "nextjs":
        for d in ("app", "pages"):
            candidate = root / d
            if candidate.is_dir() and candidate != src_root / d:
                scan_roots.append(candidate)

    # 1. Discover all source files
    all_files: list[Path] = []
    seen_paths: set[Path] = set()
    for scan_dir in scan_roots:
        for dirpath, dirnames, filenames in os.walk(scan_dir):
            dirnames[:] = [d for d in dirnames if d not in IGNORE_DIRS]
            for fn in filenames:
                fp = (Path(dirpath) / fn).resolve()
                if fp.suffix in EXTENSIONS and fp not in seen_paths:
                    all_files.append(fp)
                    seen_paths.add(fp)

    # 2. Parse every file
    file_data: dict[Path, dict] = {}
    for fp in all_files:
        file_data[fp] = scan_file(fp)

    # 3. Resolve imports to actual file paths
    resolved_imports: dict[Path, list[Path]] = {}
    for fp, data in file_data.items():
        deps = []
        for imp in data["imports"]:
            resolved = resolve_import_path(fp, imp, src_root, aliases)
            if resolved and resolved in file_data:
                deps.append(resolved)
        resolved_imports[fp] = deps

    # 4. Classify each file into a layer
    file_layers: dict[Path, str] = {}
    for fp in all_files:
        rel = str(fp.relative_to(root))
        file_layers[fp] = classify_layer(rel, framework, file_data[fp], is_fsd=is_fsd)

    # 5. Tree-shaking: find entry points
    entry_files: set[Path] = set()
    if is_fsd:
        # FSD: app layer and pages layer are entry points
        for fp, layer in file_layers.items():
            if layer in ("fsd_app", "fsd_pages"):
                entry_files.add(fp)
    else:
        for fp, layer in file_layers.items():
            if layer in ("page", "layout", "api_route"):
                entry_files.add(fp)

    # If no pages detected, treat files with routes as pages
    if not entry_files:
        for fp, data in file_data.items():
            if data["routes"]:
                file_layers[fp] = "page"
                entry_files.add(fp)

    # Also include app-level entry files
    for fp in all_files:
        name = fp.stem.lower()
        if name in ("app", "main", "index", "_app", "_document", "root"):
            entry_files.add(fp)

    if entry_files:
        used = find_used_files(entry_files, resolved_imports)
    else:
        used = set(all_files)

    # 6. Skip barrel files from display (but keep connections)
    barrel_files = {fp for fp in used if file_data[fp].get("is_barrel")}

    # 7. Collect API endpoints
    all_api_endpoints: set[str] = set()
    for fp in used:
        for call in file_data[fp].get("api_calls", []):
            all_api_endpoints.add(call)

    # Also extract file-based API routes as endpoints
    for fp in used:
        if file_layers.get(fp) == "api_route":
            route = extract_file_route(fp, root, framework)
            if route:
                all_api_endpoints.add(route)

    # 8. Build output structure
    nodes = []
    edges = []
    node_id_map: dict[Path, str] = {}
    import_count: dict[Path, int] = {}

    for fp in used:
        for dep in resolved_imports.get(fp, []):
            if dep in used:
                import_count[dep] = import_count.get(dep, 0) + 1

    display_files = sorted(used - barrel_files)

    for fp in display_files:
        rel = str(fp.relative_to(root))
        nid = re.sub(r"[^a-zA-Z0-9]", "_", rel)
        node_id_map[fp] = nid
        layer = file_layers[fp]
        display_name = compute_display_name(fp, root, framework, is_fsd=is_fsd)

        # Extract route for pages
        file_route = extract_file_route(fp, root, framework)
        routes = file_data[fp].get("routes", [])
        if file_route and file_route not in routes:
            routes = [file_route] + routes

        nodes.append({
            "id": nid,
            "label": display_name,
            "filePath": rel,
            "layer": layer,
            "layerIndex": LAYER_ORDER.get(layer, 2),
            "layerLabel": LAYER_LABELS.get(layer, "Shared / UI"),
            "apiCalls": file_data[fp].get("api_calls", []),
            "routes": routes,
            "importCount": import_count.get(fp, 0),
            "lineCount": file_data[fp].get("line_count", 0),
        })

    # Edges — skip barrel files, connect through them
    def resolve_through_barrels(target: Path) -> list[Path]:
        """If target is a barrel file, resolve to what the barrel re-exports."""
        if target not in barrel_files:
            return [target] if target in node_id_map else []
        # Follow barrel's imports
        results = []
        for dep in resolved_imports.get(target, []):
            results.extend(resolve_through_barrels(dep))
        return results

    edge_set: set[tuple[str, str]] = set()
    for fp in display_files:
        src_id = node_id_map.get(fp)
        if not src_id:
            continue
        for dep in resolved_imports.get(fp, []):
            targets = resolve_through_barrels(dep)
            for actual_target in targets:
                tgt_id = node_id_map.get(actual_target)
                if tgt_id and src_id != tgt_id and (src_id, tgt_id) not in edge_set:
                    edge_set.add((src_id, tgt_id))
                    edges.append({
                        "id": f"e_{src_id}__{tgt_id}",
                        "source": src_id,
                        "target": tgt_id,
                    })

    # API endpoint nodes
    api_layer_index = 7 if is_fsd else 4
    for i, endpoint in enumerate(sorted(all_api_endpoints)):
        api_id = f"api_ep_{i}"
        nodes.append({
            "id": api_id,
            "label": endpoint,
            "filePath": None,
            "layer": "api_endpoint",
            "layerIndex": api_layer_index,
            "layerLabel": "Backend API Endpoints",
            "apiCalls": [],
            "routes": [],
            "importCount": 0,
            "lineCount": 0,
        })
        for fp in display_files:
            if endpoint in file_data[fp].get("api_calls", []):
                src_id = node_id_map[fp]
                if (src_id, api_id) not in edge_set:
                    edge_set.add((src_id, api_id))
                    edges.append({
                        "id": f"e_{src_id}__{api_id}",
                        "source": src_id,
                        "target": api_id,
                    })

    # Groups (pages contain their direct features)
    groups = []
    for fp in display_files:
        if file_layers[fp] in ("page", "layout"):
            page_id = node_id_map[fp]
            children = []
            for dep in resolved_imports.get(fp, []):
                for actual in resolve_through_barrels(dep):
                    if actual in node_id_map and file_layers.get(actual) == "feature":
                        children.append(node_id_map[actual])
            groups.append({"parentId": page_id, "childIds": children})

    if is_fsd:
        # FSD-specific layers
        layers = [
            {"id": "fsd_app", "index": 0, "label": "App", "color": "#818cf8"},
            {"id": "fsd_processes", "index": 1, "label": "Processes", "color": "#a78bfa"},
            {"id": "fsd_pages", "index": 2, "label": "Pages", "color": "#c084fc"},
            {"id": "fsd_widgets", "index": 3, "label": "Widgets", "color": "#22d3ee"},
            {"id": "fsd_features", "index": 4, "label": "Features", "color": "#2dd4bf"},
            {"id": "fsd_entities", "index": 5, "label": "Entities", "color": "#fbbf24"},
            {"id": "fsd_shared", "index": 6, "label": "Shared", "color": "#34d399"},
            {"id": "api_endpoint", "index": 7, "label": "Backend Endpoints", "color": "#f87171"},
        ]
        # FSD groups: pages contain their widgets
        groups = []
        for fp in display_files:
            if file_layers[fp] == "fsd_pages":
                page_id = node_id_map[fp]
                children = []
                for dep in resolved_imports.get(fp, []):
                    for actual in resolve_through_barrels(dep):
                        dep_layer = file_layers.get(actual)
                        if actual in node_id_map and dep_layer in ("fsd_widgets", "fsd_features"):
                            children.append(node_id_map[actual])
                groups.append({"parentId": page_id, "childIds": children})
    else:
        layers = [
            {"id": "page", "index": 0, "label": "Pages", "color": "#818cf8"},
            {"id": "layout", "index": 0, "label": "Layouts", "color": "#a78bfa"},
            {"id": "feature", "index": 1, "label": "Features", "color": "#22d3ee"},
            {"id": "shared", "index": 2, "label": "Shared / UI", "color": "#34d399"},
            {"id": "api_service", "index": 3, "label": "API Services", "color": "#fbbf24"},
            {"id": "api_route", "index": 3, "label": "API Routes", "color": "#fb923c"},
            {"id": "api_endpoint", "index": 4, "label": "Backend Endpoints", "color": "#f87171"},
            {"id": "middleware", "index": 2, "label": "Middleware", "color": "#c084fc"},
        ]

    # ── Analytics ──
    circular_deps = _detect_circular_deps(resolved_imports, node_id_map)

    dead_files = []
    for fp in sorted(set(all_files) - used):
        rel_dead = str(fp.relative_to(root))
        dead_files.append({
            "filePath": rel_dead,
            "label": compute_display_name(fp, root, framework, is_fsd=is_fsd),
            "layer": classify_layer(rel_dead, framework, file_data.get(fp, {}), is_fsd=is_fsd),
        })

    dependents: dict[str, list[str]] = {}
    for src_id, tgt_id in edge_set:
        dependents.setdefault(tgt_id, []).append(src_id)

    # FSD import rule violations: a module can only import from strictly lower layers
    fsd_violations: list[dict] = []
    if is_fsd:
        fsd_violations = _detect_fsd_violations(
            display_files, file_layers, resolved_imports, node_id_map, resolve_through_barrels
        )

    analytics: dict = {
        "circularDeps": circular_deps,
        "deadFiles": dead_files,
        "dependents": dependents,
    }
    if is_fsd:
        analytics["fsdViolations"] = fsd_violations

    return {
        "repoPath": str(root),
        "srcRoot": str(src_root),
        "framework": framework,
        "isFsd": is_fsd,
        "layers": layers,
        "nodes": nodes,
        "edges": edges,
        "groups": groups,
        "metadata": {
            "totalFiles": len(all_files),
            "analyzedFiles": len(used),
            "treeShakedFiles": len(all_files) - len(used),
            "barrelFiles": len(barrel_files),
            "totalEdges": len(edges),
            "apiEndpoints": len(all_api_endpoints),
            "framework": framework,
            "isFsd": is_fsd,
        },
        "analytics": analytics,
    }


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
    print(f"Framework: {meta['framework']}")
    if meta.get("isFsd"):
        print("Architecture: Feature-Sliced Design (FSD)")
    print(f"Done! Analyzed {meta['analyzedFiles']}/{meta['totalFiles']} files "
          f"({meta['treeShakedFiles']} tree-shaked, {meta['barrelFiles']} barrels)")
    print(f"Nodes: {len(structure['nodes'])}, Edges: {meta['totalEdges']}, "
          f"API Endpoints: {meta['apiEndpoints']}")
    if structure.get("analytics", {}).get("fsdViolations"):
        violations = structure["analytics"]["fsdViolations"]
        print(f"FSD Import Violations: {len(violations)}")
    print(f"Output: {output_path}")


if __name__ == "__main__":
    main()
