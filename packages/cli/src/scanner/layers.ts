/**
 * Layer classification, display name computation, and route extraction.
 */

import * as path from "path";
import { FSD_LAYERS, classifyFsdLayer, computeFsdDisplayName } from "./fsd.js";
import type { FileData } from "./parser.js";

export function classifyLayer(
  relPath: string,
  framework: string,
  fileData: FileData,
  isFsd = false
): string {
  const p = relPath.toLowerCase().replace(/\\/g, "/");
  const name = path.basename(relPath).toLowerCase();
  const stem = name.replace(/\.\w+$/, "");

  if (isFsd) return classifyFsdLayer(p);

  // Next.js
  if (framework === "nextjs") {
    if (p.includes("/app/") && p.includes("/api/") && ["route", "route.ts", "route.js"].includes(stem)) return "api_route";
    if (stem === "route") return "api_route";
    if (stem === "page") return "page";
    if (stem === "layout" && p.includes("/app/")) return "layout";
    if (["loading", "error", "not-found", "global-error", "template"].includes(stem)) return "shared";
    if (stem === "middleware") return "middleware";
    if (p.includes("/pages/") && !["_app", "_document"].includes(stem)) {
      return p.includes("/api/") ? "api_route" : "page";
    }
    if (["_app", "_document"].includes(stem)) return "layout";
  } else if (framework === "tanstack-router") {
    if (p.includes("/routes/")) {
      if (stem === "__root" || stem === "__root.tsx") return "layout";
      if (stem.startsWith("_")) return "layout";
      return "page";
    }
  } else if (framework === "remix") {
    if (p.includes("/routes/")) {
      return stem.startsWith("_") ? "layout" : "page";
    }
    if (p.includes("/app/root")) return "layout";
  } else if (framework === "gatsby") {
    if (p.includes("/pages/")) return "page";
    if (p.includes("/templates/")) return "page";
  }

  // Generic
  if (["/pages/", "/views/", "/screens/"].some((s) => p.includes(s))) return "page";
  if (p.includes("/routes/")) {
    return ["index", "__root"].includes(stem) ? "layout" : "page";
  }

  if (["/services/", "/api/", "/lib/api", "/utils/api", "/queries/", "/mutations/"].some((s) => p.includes(s)))
    return "api_service";
  if (p.includes("/hooks/") && stem.startsWith("use")) {
    return fileData.api_calls?.length ? "api_service" : "shared";
  }

  if (["/features/", "/modules/", "/containers/", "/sections/", "/domains/"].some((s) => p.includes(s)))
    return "feature";

  if (["/components/", "/ui/", "/shared/", "/common/", "/elements/", "/atoms/", "/molecules/", "/organisms/", "/primitives/"].some((s) => p.includes(s)))
    return "shared";
  if (["/store/", "/stores/", "/state/", "/redux/", "/zustand/", "/context/"].some((s) => p.includes(s)))
    return "shared";
  if (["/lib/", "/utils/", "/helpers/", "/config/"].some((s) => p.includes(s)))
    return "shared";

  return "shared";
}

export const LAYER_ORDER: Record<string, number> = {
  page: 0, layout: 0, feature: 1, shared: 2, api_service: 3, api_route: 3, middleware: 2,
  fsd_app: 0, fsd_processes: 1, fsd_pages: 2, fsd_widgets: 3, fsd_features: 4, fsd_entities: 5, fsd_shared: 6,
};

export const LAYER_LABELS: Record<string, string> = {
  page: "Pages", layout: "Layouts", feature: "Features", shared: "Shared / UI",
  api_service: "API Services", api_route: "API Routes", middleware: "Middleware",
  fsd_app: "App", fsd_processes: "Processes", fsd_pages: "Pages", fsd_widgets: "Widgets",
  fsd_features: "Features", fsd_entities: "Entities", fsd_shared: "Shared",
};

export function computeDisplayName(
  fp: string,
  root: string,
  framework: string,
  isFsd = false
): string {
  const rel = path.relative(root, fp);
  const parts = rel.split(path.sep);
  const stem = path.basename(fp).replace(/\.\w+$/, "");

  if (isFsd) return computeFsdDisplayName(parts, stem);

  // Next.js App Router
  if (framework === "nextjs" && parts.includes("app")) {
    const appIdx = parts.indexOf("app");
    let routeParts = parts.slice(appIdx + 1);
    if (["page", "layout", "loading", "error", "route", "not-found", "template"].includes(stem)) {
      routeParts = routeParts.slice(0, -1);
      routeParts = routeParts.filter((p) => !(p.startsWith("(") && p.endsWith(")")));
      const route = routeParts.length ? "/" + routeParts.join("/") : "/";
      if (stem === "page") return route;
      return `${route} (${stem[0].toUpperCase() + stem.slice(1)})`;
    }
  }

  // Next.js Pages Router
  if (framework === "nextjs" && parts.includes("pages")) {
    const pIdx = parts.indexOf("pages");
    const routeParts = parts.slice(pIdx + 1);
    routeParts[routeParts.length - 1] = stem;
    if (stem.startsWith("_")) return stem;
    if (stem === "index") routeParts.pop();
    return routeParts.length ? "/" + routeParts.join("/") : "/";
  }

  // TanStack Router
  if (framework === "tanstack-router" && parts.includes("routes")) {
    const rIdx = parts.indexOf("routes");
    const routeParts = parts.slice(rIdx + 1);
    routeParts[routeParts.length - 1] = stem;
    let routeStr = routeParts.join("/").replace(/\./g, "/");
    if (routeStr === "index" || routeStr === "__root") return routeStr === "index" ? "/" : "__root";
    return "/" + routeStr;
  }

  // Remix
  if (framework === "remix" && parts.includes("routes")) {
    const rIdx = parts.indexOf("routes");
    const routeParts = parts.slice(rIdx + 1);
    routeParts[routeParts.length - 1] = stem;
    let routeStr = routeParts.join("/").replace(/\./g, "/");
    return routeStr.startsWith("_") ? routeStr : "/" + routeStr;
  }

  // Folder-based component: Button/index.tsx → "Button"
  if (stem === "index" && parts.length >= 2) return parts[parts.length - 2];

  // Folder-based: PostFeed/PostFeed.tsx → "PostFeed"
  if (parts.length >= 2 && stem.toLowerCase() === parts[parts.length - 2].toLowerCase()) return stem;

  return stem;
}

export function extractFileRoute(
  fp: string,
  root: string,
  framework: string
): string | null {
  const rel = path.relative(root, fp);
  const parts = rel.split(path.sep);
  const stem = path.basename(fp).replace(/\.\w+$/, "");

  if (framework === "nextjs") {
    if (parts.includes("app")) {
      const appIdx = parts.indexOf("app");
      let routeParts = parts.slice(appIdx + 1);
      if (["page", "route"].includes(stem)) {
        routeParts = routeParts.slice(0, -1);
        routeParts = routeParts.filter((p) => !(p.startsWith("(") && p.endsWith(")")));
        return routeParts.length ? "/" + routeParts.join("/") : "/";
      }
    }
    if (parts.includes("pages")) {
      const pIdx = parts.indexOf("pages");
      const routeParts = parts.slice(pIdx + 1);
      routeParts[routeParts.length - 1] = stem;
      if (stem === "index") routeParts.pop();
      if (stem.startsWith("_")) return null;
      return routeParts.length ? "/" + routeParts.join("/") : "/";
    }
  }

  if (framework === "tanstack-router" && parts.includes("routes")) {
    const rIdx = parts.indexOf("routes");
    const routeParts = parts.slice(rIdx + 1);
    routeParts[routeParts.length - 1] = stem;
    const r = routeParts.join("/").replace(/\./g, "/");
    if (r === "index") return "/";
    if (r === "__root") return null;
    return "/" + r;
  }

  if (framework === "remix" && parts.includes("routes")) {
    const rIdx = parts.indexOf("routes");
    const routeParts = parts.slice(rIdx + 1);
    routeParts[routeParts.length - 1] = stem;
    const r = routeParts.join("/").replace(/\./g, "/");
    return r.startsWith("_") ? null : "/" + r;
  }

  return null;
}
