/**
 * Traffic-source attribution for the customer portal — answers "did this
 * visitor come from TikTok, Facebook, Instagram, …?".
 *
 * How a source is captured (middleware.ts): a /portal request carrying
 * `?utm_source=` (or a social-network Referer as fallback) gets the `apmg_src`
 * cookie. From then on every telemetry event the visitor fires and any enquiry
 * they submit is stamped with that source server-side (readAttribution in
 * lib/portal/server.ts), the same way outreach attribution rides `apmg_ref`.
 *
 * PURE STRING HELPERS ONLY. This module is imported by the Edge-runtime
 * middleware, the node API routes AND client components (label maps live in
 * lib/data/enquiries.ts) — keep it free of node/next imports.
 */

export const SOURCE_COOKIE = "apmg_src";
/** 30 days — long enough that "saw the TikTok, enquired from the couch a week
 *  later" still attributes, short enough not to claim unrelated visits. */
export const SOURCE_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

/** Reporting bucket for visitors attributed to an outreach lead (apmg_ref
 *  cookie) with no explicit social source — they came via a tracked email. */
export const OUTREACH_SOURCE = "outreach";
/** Reporting bucket for visitors with neither a source nor an outreach cookie
 *  (typed the URL, forwarded link, expired cookie…). */
export const DIRECT_SOURCE = "direct";

const MAX_SOURCE_LEN = 40;

/** Common shorthand people put in utm_source, folded onto one canonical slug
 *  so "fb", "FB" and "facebook" don't split the report three ways. */
const SOURCE_ALIASES: Record<string, string> = {
  fb: "facebook",
  meta: "facebook",
  ig: "instagram",
  insta: "instagram",
  tt: "tiktok",
  "tik-tok": "tiktok",
  twitter: "x",
  yt: "youtube",
  li: "linkedin",
};

/**
 * Fold a raw utm_source / cookie value onto a canonical slug: lowercased,
 * whitespace → "-", limited to [a-z0-9_.-], capped, alias-mapped. Null when
 * nothing usable remains — callers treat that as "no source".
 */
export function normalizeSource(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9_.-]/g, "")
    .slice(0, MAX_SOURCE_LEN)
    .replace(/^[-_.]+|[-_.]+$/g, "");
  if (!slug) return null;
  return SOURCE_ALIASES[slug] ?? slug;
}

/** Referring hosts that identify a platform even WITHOUT utm tagging — catches
 *  bio links and shares the social manager can't tag (e.g. Instagram's
 *  l.instagram.com wrapper, TikTok's vm.tiktok.com short links). Matched on
 *  the hostname only; same-origin/internal navigation never matches. */
const REFERER_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.(com|me|watch)$|(^|\.)messenger\.com$/, "facebook"],
  [/(^|\.)instagram\.com$|(^|\.)instagr\.am$/, "instagram"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(twitter|x)\.com$|^t\.co$/, "x"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "linkedin"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "youtube"],
  [/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/, "google"],
];

/** Platform slug for a Referer header, or null when it isn't a recognised
 *  external platform (unparseable, same-origin, unknown site). */
export function sourceFromReferer(referer: string | null | undefined): string | null {
  if (!referer) return null;
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [re, source] of REFERER_HOSTS) {
    if (re.test(host)) return source;
  }
  return null;
}

/** Query params checked for an explicit source tag, in priority order —
 *  `?utm_source=tiktok` is what the social posts carry. */
const SOURCE_PARAMS = ["utm_source", "source", "src", "ref"];

/** Resolve a request's traffic source: an explicit ?utm_source= (or alias
 *  param) wins; otherwise fall back to the social-platform Referer map. */
export function resolveSource(
  searchParams: URLSearchParams,
  referer?: string | null,
): string | null {
  for (const param of SOURCE_PARAMS) {
    const source = normalizeSource(searchParams.get(param));
    if (source) return source;
  }
  return sourceFromReferer(referer);
}
