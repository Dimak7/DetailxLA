const canonicalOrigin = "https://westloopceramics.com";
const publicAliases = new Set([
  "www.westloopceramics.com",
  "detailxla-production.up.railway.app",
]);
const publicPaths = new Set([
  "/", "/services", "/contact", "/gallery", "/booking",
  "/privacy-notice", "/service-rules", "/sitemap.xml",
]);

/** Consolidate public aliases without moving sessions, payment returns, or API calls. */
export function canonicalRedirectUrl(url: string, method: string, preview = false): string | null {
  if (preview || !["GET", "HEAD"].includes(method)) return null;
  const parsed = new URL(url);
  if (!publicAliases.has(parsed.hostname)) return null;
  const pathname = parsed.pathname.replace(/\/$/, "") || "/";
  if (!publicPaths.has(pathname) && !/^\/services\/[^/]+$/.test(pathname)) return null;
  const destination = new URL(canonicalOrigin);
  destination.pathname = pathname;
  destination.search = parsed.search;
  return destination.href;
}
