// Which source a lead came from.
//
// For the maps scrapers the source is DERIVED, never stored: every scraped
// lead carries its own provenance in the maps URL it was scraped from, so the
// source is a pure function of a column we already store.
//
//   Bing Maps Scraper   → bing.com/maps/...        → "bing"
//   Google Maps scraper → google.com/maps/place/... → "google"
//   Hand-added / no URL →                           → "unknown"
//
// That works retroactively on every row already in the table and cannot drift
// out of sync with the data the way a hand-set flag can.
//
// A LinkedIn contact has no maps URL, so it is the one source that IS stored:
// `leads.source = 'linkedin'` (supabase/linkedin-source.sql). The rule is that
// `source` is written only for sources the URL cannot identify — Google and
// Bing rows keep it null and stay derived, so no legacy row needs a backfill.
// A known stored value wins; anything else falls back to the URL.
//
// (The column is still named `bing_maps_url` — renaming it to `maps_url` is a
// migration. It holds either maps provider's URL, and is null for LinkedIn.)

export type LeadSource = "google" | "bing" | "linkedin" | "unknown";

export const LEAD_SOURCES: readonly LeadSource[] = ["google", "bing", "linkedin", "unknown"] as const;

export const SOURCE_LABEL: Record<LeadSource, string> = {
  google: "Google",
  bing: "Bing",
  linkedin: "LinkedIn",
  unknown: "Unknown",
};

/** Sources written to `leads.source` — the ones a maps URL cannot identify. */
export const STORED_SOURCES = ["linkedin"] as const;
export type StoredSource = (typeof STORED_SOURCES)[number];

/** Normalise a `leads.source` value, or null when it isn't one we store. */
export function storedSource(v: unknown): StoredSource | null {
  if (typeof v !== "string") return null;
  const t = v.trim().toLowerCase();
  return (STORED_SOURCES as readonly string[]).includes(t) ? (t as StoredSource) : null;
}

/**
 * Classify one lead: a known stored `source` wins, else its maps URL.
 * Tolerates junk, partial URLs and null.
 */
export function leadSource(mapsUrl: string | null | undefined, stored?: string | null): LeadSource {
  const kept = storedSource(stored);
  if (kept) return kept;
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
 * Google/Bing match on the URL alone — a LinkedIn row never carries a maps URL.
 * "unknown" is everything that is none of them — including a NULL URL, which
 * `not.ilike` would drop on its own (NULL fails every LIKE), hence the explicit
 * or-branch — and, once the column exists, no stored source either.
 *
 * `legacy`: the `source` column isn't there yet (linkedin-source.sql not run),
 * so the filters may not name it. LinkedIn then has no filter — callers skip it.
 */
export function sourceFilter(source: LeadSource, opts: { legacy?: boolean } = {}): string {
  if (source === "linkedin") return "source=eq.linkedin";
  const col = "bing_maps_url";
  // `*` is PostgREST's LIKE wildcard. Both providers' listing URLs carry the
  // host and "/maps" (Bing's is /maps?ss=…, Google's /maps/place/…).
  const g = "*google.*/maps*";
  const b = "*bing.*/maps*";
  if (source === "google") return `${col}=ilike.${g}`;
  if (source === "bing") return `${col}=ilike.${b}`;
  // NULL fails every LIKE, so it needs its own branch rather than relying on
  // the negations to catch it.
  const noMapsUrl = `${col}.is.null,and(${col}.not.ilike.${g},${col}.not.ilike.${b})`;
  if (opts.legacy) return `or=(${noMapsUrl})`;
  return `and=(source.is.null,or(${noMapsUrl}))`;
}
