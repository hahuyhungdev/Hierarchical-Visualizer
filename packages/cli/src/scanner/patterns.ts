/**
 * Regex patterns and constants for the static analyzer.
 */

export const EXTENSIONS = new Set([".tsx", ".ts", ".jsx", ".js", ".mjs"]);
export const INDEX_NAMES = new Set(
  [...EXTENSIONS].map((e) => `index${e}`)
);
export const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".output",
  "__pycache__", ".cache", ".turbo", ".vercel", "coverage", ".nuxt",
]);

// import ... from 'path' | require('path') | dynamic import('path') | export ... from 'path'
export const IMPORT_RE =
  /(?:import\s+(?:(?:type\s+)?(?:[\w*\s{},]+)\s+from\s+)?['"]([^'"]+)['"])|(?:require\s*\(\s*['"]([^'"]+)['"]\s*\))|(?:import\s*\(\s*['"]([^'"]+)['"]\s*\))|(?:export\s+(?:(?:type\s+)?(?:[\w*\s{},]+)\s+from\s+)?['"]([^'"]+)['"])/gm;

// API calls: axios.get('/api/...'), fetch('/api/...'), useFetch, $fetch, ky, etc.
export const API_CALL_RE =
  /(?:(?:axios(?:\.(?:get|post|put|patch|delete|request|head|options))?)|fetch|\$fetch|useFetch|(?:api|http|request|client)(?:\.(?:get|post|put|patch|delete|request))?|ky(?:\.(?:get|post|put|patch|delete)))\s*[.(]\s*['"`]([^'"`\s]+)['"`]/gi;

// openapi-fetch: anyVar.GET("/path"), fetchClient.POST("/path"), etc.
export const OPENAPI_FETCH_RE =
  /[\w$]+\.(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(\s*['"`]([^'"`\s]+)['"`]/g;

// openapi-react-query: $api.useQuery("get", "/path"), $api.useMutation("post", "/path"), etc.
export const OPENAPI_RQ_RE =
  /[\w$]+\.(?:useQuery|useSuspenseQuery|useMutation|useInfiniteQuery|queryOptions|prefetchQuery)\s*\(\s*['"`]\w+['"`]\s*,\s*['"`]([^'"`\s]+)['"`]/g;

// Route definitions for classic React Router, TanStack, etc.
export const ROUTE_RE =
  /(?:path\s*[:=]\s*['"]([^'"]+)['"])|(?:<Route[^>]*path\s*=\s*[{'"](\/?\S+?)[}'"]\s*[^>]*>)|(?:createRoute\s*\(\s*\{[^}]*path\s*:\s*['"]([^'"]+)['"])/gm;

// Normalize template-literal API endpoints: ${BASE_URL}/users → /users
const TEMPLATE_VAR_RE = /\$\{[^}]+\}/g;

export function normalizeApiEndpoint(raw: string): string {
  let cleaned = raw.replace(TEMPLATE_VAR_RE, "");
  cleaned = cleaned.replace(/^\/+/, "/");
  cleaned = cleaned.replace(/[?&]+$/, "");
  if (!cleaned || cleaned === "/") {
    const fullyTemplate = raw.replace(TEMPLATE_VAR_RE, "").replace(/^\/+/, "").trim();
    if (!fullyTemplate) return "";
  }
  return cleaned;
}
