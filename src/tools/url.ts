const TRACKING_PARAM = /^utm_|^(fbclid|gclid|mc_eid|igshid|ref|ref_src)$/i;

/**
 * Normalize a URL into a stable dedup key with *light* normalization: lowercase
 * host, drop the fragment and a trailing slash, and strip common tracking params
 * (utm_*, fbclid, gclid, ...). Deliberately conservative — it does not touch the
 * path or remaining query, so genuinely distinct pages (e.g. `?page=2`) stay
 * distinct. Returns null for non-http(s) or unparseable URLs so callers can drop
 * them. Pure.
 */
export function normalizeUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }

  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAM.test(key)) {
      parsed.searchParams.delete(key);
    }
  }

  const host = parsed.host.toLowerCase();
  const path =
    parsed.pathname !== "/" && parsed.pathname.endsWith("/")
      ? parsed.pathname.slice(0, -1)
      : parsed.pathname;
  const query = parsed.searchParams.toString();
  return `${parsed.protocol}//${host}${path}${query ? `?${query}` : ""}`;
}
