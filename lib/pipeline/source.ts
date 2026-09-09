// Which scraper a lead came from — derived, never stored.
//
// The `leads` table has no `source` column and we are not adding one (that
// would be a Supabase migration). It doesn't need one: every scraped lead
// carries its own provenance in the maps URL it was scraped from, so the
// source is a pure function of a column we already store.
//
//   Bing Maps Scraper   → bing.com/maps/...        → "bing"
//   Google Maps scraper → google.com/maps/place/... → "google"
//   Hand-added / no URL →                           → "unknown"
//
// This works retroactively on every row already in the table, which a new
// column would not, and it cannot drift out of sync with the data the way a
// hand-set flag can.
//
// (The column is still named `bing_maps_url` for the same reason — renaming it
// to `maps_url` is a migration. It now holds either provider's URL.)

export type LeadSource = "google" | "bing" | "unknown";

export const LEAD_SOURCES: readonly LeadSource[] = ["google", "bing", "unknown"] as const;

export const SOURCE_LABEL: Record<LeadSource, string> = {
  google: "Google",
  bing: "Bing",
  unknown: "Unknown",
};

/** Classify one maps URL. Tolerates junk, partial URLs and null. */
export function leadSource(mapsUrl: string | null | undefined): LeadSource {
  if (typeof mapsUrl !== "string") return "unknown";
  const v = mapsUrl.trim().toLowerCase();
  if (!v) return "unknown";

  // Match on the host, not "does the string contain google" — a Bing listing
  // whose URL carried a `google` query param would otherwise be misfiled.
  let host = "";
  try {
    host = new URL(v.startsWith("http") ? v : `https://${v}`).hostname;
  } catch {
    return "unknown";
  }
  if (/(^|\.)google\.[a-z.]+$/.test(host)) return "google";
  if (/(^|\.)bing\.[a-z.]+$/.test(host)) return "bing";
  return "unknown";
}

/**
 * PostgREST filter selecting the rows of one source, for `count=exact` HEAD
 * probes and filtered reads. Returns the query-string fragment only.
 *
 * "unknown" is everything that is neither — including NULL, which `not.ilike`
 * would drop on its own (NULL fails every LIKE), hence the explicit or-branch.
 */
export function sourceFilter(source: LeadSource): string {
  const col = "bing_maps_url";
  // `*` is PostgREST's LIKE wildcard. Both providers' listing URLs carry the
  // host and "/maps" (Bing's is /maps?ss=…, Google's /maps/place/…).
  const g = "*google.*/maps*";
  const b = "*bing.*/maps*";
  if (source === "google") return `${col}=ilike.${g}`;
  if (source === "bing") return `${col}=ilike.${b}`;
  // NULL fails every LIKE, so it needs its own branch rather than relying on
  // the negations to catch it.
  return `or=(${col}.is.null,and(${col}.not.ilike.${g},${col}.not.ilike.${b}))`;
}
