/**
 * Traffic-source attribution for the customer portal — answers "did this
 * visitor come from TikTok, Facebook, Instagram, …?".
 *
 * How a source is captured (proxy.ts): a /portal request carrying
 * `?utm_source=` (or, as fallback, the Referer of any outside site) gets the `apmg_src`
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
 *  l.instagram.com wrapper, TikTok's vm.tiktok.com short links), plus the
 *  search engines and AI assistants that link out untagged. Matched on the
 *  hostname only. A site not listed here still counts — by its hostname. */
const REFERER_HOSTS: Array<[RegExp, string]> = [
  [/(^|\.)facebook\.com$|(^|\.)fb\.(com|me|watch)$|(^|\.)messenger\.com$/, "facebook"],
  [/(^|\.)instagram\.com$|(^|\.)instagr\.am$/, "instagram"],
  [/(^|\.)tiktok\.com$/, "tiktok"],
  [/(^|\.)(twitter|x)\.com$|^t\.co$/, "x"],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, "linkedin"],
  [/(^|\.)youtube\.com$|^youtu\.be$/, "youtube"],
  [/(^|\.)google\.[a-z]{2,3}(\.[a-z]{2})?$/, "google"],
  [/(^|\.)bing\.com$/, "bing"],
  [/(^|\.)duckduckgo\.com$/, "duckduckgo"],
  [/(^|\.)yahoo\.com$/, "yahoo"],
  [/(^|\.)ecosia\.org$/, "ecosia"],
  [/^search\.brave\.com$/, "brave"],
  [/(^|\.)chatgpt\.com$|^chat\.openai\.com$/, "chatgpt"],
  [/(^|\.)perplexity\.ai$/, "perplexity"],
];

/** Hosts that deliver MAIL, not a page: webmail, and the link-rewriting
 *  gateways (Microsoft Safe Links, Mimecast, Proofpoint, Barracuda) a cold
 *  email's link passes through on its way to the portal. A visit from one is
 *  an email click, not a traffic source. Checked before the platform map, or
 *  mail.google.com would read as Google search. */
const EMAIL_HOSTS: RegExp[] = [
  /^(web)?mail\./,
  /^outlook\.(live|office|office365)\.com$/,
  /(^|\.)safelinks\.protection\.outlook\.com$/,
  /(^|\.)mimecast\.com$/,
  /(^|\.)urldefense\.(com|proofpoint\.com)$/,
  /(^|\.)cudasvc\.com$/,
];

/** APMG's own hosts — a Referer from one is internal navigation or staff (the
 *  admin console opening the portal), never a source. The marketing site (www
 *  or the bare apmgservices.com.au) is NOT here on purpose: a visitor it sends
 *  is real outside traffic. */
const OWN_HOSTS: RegExp[] = [
  /^(?!www\.)[a-z0-9-]+\.apmgservices\.com\.au$/,
  /(^|\.)apmgmaintenance\.com\.au$/,
  /(^|\.)vercel\.app$/,
  /(^|\.)n8n\.cloud$/,
  /^(localhost|127\.0\.0\.1|\[::1\])$/,
];

/**
 * Source slug for a Referer header: a known platform's name, or — for any
 * other website — its hostname minus `www.` ("careforkids.com.au"). Null when
 * there's nothing to attribute: no/unparseable Referer, a non-web one (the
 * Gmail Android app sends `android-app://…`), our own hosts, `selfHost`
 * (same-origin navigation), or a mail host.
 */
export function sourceFromReferer(
  referer: string | null | undefined,
  selfHost?: string | null,
): string | null {
  if (!referer) return null;
  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase();
  if (selfHost && host === selfHost.toLowerCase().split(":")[0]) return null;
  if (OWN_HOSTS.some((re) => re.test(host))) return null;
  if (EMAIL_HOSTS.some((re) => re.test(host))) return null;
  for (const [re, source] of REFERER_HOSTS) {
    if (re.test(host)) return source;
  }
  return normalizeSource(host.replace(/^www\d*\./, ""));
}

/** Query params checked for an explicit source tag, in priority order —
 *  `?utm_source=tiktok` is what the social posts carry. */
const SOURCE_PARAMS = ["utm_source", "source", "src", "ref"];

/**
 * Resolve a request's traffic source: an explicit ?utm_source= (or alias
 * param) wins; otherwise fall back to the Referer.
 *
 * `outreach`: the visitor carries the outreach cookie (apmg_ref), so they
 * already have a channel — the email — and their Referer is the mail client
 * or a link-scanning gateway, never a source. Before this was checked, 31 of
 * the first 34 "Google" events were outreach clicks through Gmail's
 * google.com/url hop.
 */
export function resolveSource(
  searchParams: URLSearchParams,
  referer?: string | null,
  opts: { selfHost?: string | null; outreach?: boolean } = {},
): string | null {
  for (const param of SOURCE_PARAMS) {
    const source = normalizeSource(searchParams.get(param));
    if (source) return source;
  }
  if (opts.outreach) return null;
  return sourceFromReferer(referer, opts.selfHost);
}

/** Channels with a Telemetry KPI gauge of their own. Every OTHER tagged source
 *  (Instagram, TikTok, Bing, a site linking to the portal…) rolls up into the
 *  External gauge. */
export const GAUGED_SOURCES: readonly string[] = ["facebook", "google", "linkedin"];

/** True for a source the External gauge counts: a real tag that is neither a
 *  gauged platform nor the outreach / direct fallback bucket. */
export function isExternalSource(source: string): boolean {
  return source !== OUTREACH_SOURCE && source !== DIRECT_SOURCE && !GAUGED_SOURCES.includes(source);
}
