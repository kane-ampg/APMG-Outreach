// CSV parsing + mapping for the lead-scraper exports the Pipeline imports.
//
// Pure and framework-free so it runs in the browser during the "Read & parse"
// phase of the Pipeline tool. We keep only the 13 columns the importer cares
// about and drop the rest (review counts, lat/long, opening hours, review
// snippets). "Category" is kept — the compose automation tailors each
// AI-drafted email to it.
//
// TWO SCRAPERS, ONE MAPPER
// ────────────────────────
// The Bing Maps Scraper writes friendly headers (Name, Address, Website …).
// The Google Maps scraper writes the DOM class names it harvested instead
// ("xxVWCe", "W4Efsd 3", "lcr4fd href"), puts the same field in a different
// column depending on what that listing happened to show, and repeats the
// same business several times as the results list re-renders during scroll.
//
// So mapping runs in two layers:
//
//   1. BY HEADER NAME  — any header we recognise (including the current
//      Google class names) claims its column outright. Order-agnostic.
//   2. BY CONTENT      — every field still empty afterwards is filled by
//      scanning the row's remaining cells for that field's SHAPE: an email
//      looks like an email, a phone like a phone, a website like a URL that
//      isn't a maps link, an ad redirect, a social profile or an image.
//
// Layer 2 is what makes an unfamiliar export work: extra, renamed or
// re-ordered columns still surrender their emails, websites, phones and
// socials, because nothing about finding them depends on the header. Layer 1
// is only a fast path — if Google renames its CSS classes tomorrow, layer 2
// still lands every field except the business name.

import { leadSource, type LeadSource } from "@/lib/pipeline/source";

export interface LeadImportRow {
  name: string;
  address: string | null;
  featured_image: string | null;
  /** The listing's maps URL — Bing's or Google's. Keeps its original column
   *  name because renaming it in Supabase would be a migration; it doubles as
   *  the lead's source discriminator (see lib/pipeline/source.ts). */
  bing_maps_url: string | null;
  rating: number | null;
  category: string | null;
  website: string | null;
  phone: string | null;
  emails: string[];
  social_medias: string[];
  facebook: string | null;
  instagram: string | null;
  twitter: string | null;
}

export interface ParsedCsv {
  rows: LeadImportRow[];
  /** data rows seen in the file (excludes the header + blank trailing lines) */
  totalRows: number;
  /** rows dropped because they had no Name */
  skipped: number;
  /** rows dropped because an earlier row in the same file described the same
   *  business (the Google scraper repeats listings as the list re-renders) */
  duplicates: number;
  /** header names found, in file order */
  headers: string[];
  /** how many kept rows came from each scraper, by their maps URL */
  sources: Record<LeadSource, number>;
  /** kept rows carrying at least one email address (i.e. sendable today) */
  withEmail: number;
}

// The scraper writes this placeholder into cells it hadn't enriched yet
// (e.g. emails/socials still crawling). Treat it as "no value".
const IN_PROGRESS = "### in progress ###";

/**
 * RFC-4180-ish tokenizer. Handles quoted fields, `""` escapes, commas and
 * newlines embedded inside quotes, and both CRLF / LF line endings.
 */
export function parseCsv(input: string): string[][] {
  let text = input;
  // strip a leading UTF-8 BOM if present
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\r") {
      // ignore — the following \n closes the line
    } else {
      field += c;
    }
  }
  // flush the trailing field/row if the file didn't end with a newline
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

// ── layer 1: header names ────────────────────────────────────────────────────

type Field =
  | "name"
  | "address"
  | "featured_image"
  | "maps_url"
  | "rating"
  | "category"
  | "website"
  | "phone"
  | "emails"
  | "social_medias"
  | "facebook"
  | "instagram"
  | "twitter";

/** Headers are compared with punctuation and case removed, so "Bing Maps URL",
 *  "bing_maps_url" and "BingMapsURL" are the same header. */
function normHeader(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Recognised header spellings per field. Includes the Google scraper's current
 * DOM class names as a fast path — they are an optimisation, not a dependency:
 * everything except `name` is also recoverable by content (layer 2).
 */
const FIELD_ALIASES: Record<Field, readonly string[]> = {
  name: ["name", "businessname", "business", "title", "company", "companyname", "xxvwce"],
  address: ["address", "fulladdress", "streetaddress", "street", "location"],
  featured_image: ["featuredimage", "image", "imageurl", "photo", "thumbnail", "jn12kesrc"],
  maps_url: ["bingmapsurl", "googlemapsurl", "mapsurl", "mapurl", "maplink", "hfpxzchref"],
  rating: ["rating", "stars", "score", "mw4etd"],
  category: ["category", "type", "businesstype", "industry", "primarycategory"],
  website: ["website", "websiteurl", "siteurl", "webpage", "domain", "lcr4fdhref"],
  phone: ["phone", "phonenumber", "telephone", "tel", "mobile", "contactnumber", "usdlk"],
  emails: ["emails", "email", "emailaddress", "emailaddresses", "contactemail"],
  social_medias: ["socialmedias", "socialmedia", "socials", "sociallinks"],
  facebook: ["facebook", "facebookurl", "facebookpage"],
  instagram: ["instagram", "instagramurl"],
  twitter: ["twitter", "twitterx", "xtwitter", "twitterurl"],
};

/** Known columns we deliberately do not store. Listing them keeps their values
 *  out of the address/category text scan; the shape filters there would reject
 *  most of them anyway, so this is belt-and-braces. */
const DISCARD_HEADERS = new Set([
  "uy7f9", // Google: review count, "(40)"
  "cw1rxd", "cw1rxd2", "cw1rxd3", // Google: button icon glyphs
  "r8c4qb", "r8c4qb2", "r8c4qb3", // Google: button labels, "Website" / "Directions"
  "dojozc", // Google: hours icon glyph
  "ah5ghc", "ah5ghc2", "ah5ghc3", // Google: review snippet fragments
  "reviews", "reviewcount", "ratinginfo", "openhours", "hours", "latitude", "longitude", "lat", "lng",
]);

type ColMap = Partial<Record<Field, number>>;

/** Claim one column per field, first matching header wins, no column twice. */
function resolveColumns(headers: string[]): { col: ColMap; claimed: Set<number> } {
  const norm = headers.map(normHeader);
  const col: ColMap = {};
  const claimed = new Set<number>();

  for (const [field, aliases] of Object.entries(FIELD_ALIASES) as [Field, readonly string[]][]) {
    for (let i = 0; i < norm.length; i++) {
      if (claimed.has(i)) continue;
      if (aliases.includes(norm[i])) {
        col[field] = i;
        claimed.add(i);
        break;
      }
    }
  }
  // discards are "claimed" too — they must not feed the content scan
  norm.forEach((h, i) => {
    if (DISCARD_HEADERS.has(h)) claimed.add(i);
  });
  return { col, claimed };
}

// ── layer 2: value shapes ────────────────────────────────────────────────────

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Parse a cell as an http(s) URL, tolerating a bare `www.` prefix. */
function asUrl(v: string): URL | null {
  const t = v.trim();
  // A URL cell never contains whitespace. Bailing here keeps street addresses
  // ("1 Waverley Avenue") away from the URL parser, which would happily
  // percent-encode the spaces and call it a URL.
  if (!t || /\s/.test(t)) return null;
  const withScheme = /^https?:\/\//i.test(t) ? t : /^www\.[^\s]+\.[a-z]{2,}/i.test(t) ? `https://${t}` : "";
  if (!withScheme) return null;
  try {
    return new URL(withScheme);
  } catch {
    return null;
  }
}

function isMapsUrl(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  if (!/(^|\.)(google|bing)\.[a-z.]+$/.test(host)) return false;
  return /(^|\/)maps(\/|$|\?)/.test(u.pathname) || u.pathname === "/maps" || /[?&]maps/.test(u.search);
}

/**
 * A sponsored-result redirect, not the business's site. Google puts these in
 * the same column as a real website for ads, so keeping them would hand the
 * email-enrichment crawler a Google ad URL to scrape instead of the business.
 */
function isAdRedirect(u: URL): boolean {
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();
  if (/(^|\.)google\.[a-z.]+$/.test(host)) {
    return path.startsWith("/aclk") || path.startsWith("/url") || path.startsWith("/searchads") || u.searchParams.has("adurl");
  }
  if (/(^|\.)bing\.[a-z.]+$/.test(host)) return path.startsWith("/aclick") || path.startsWith("/aclk");
  return false;
}

const SOCIAL_HOSTS: ReadonlyArray<[key: "facebook" | "instagram" | "twitter" | "other", re: RegExp]> = [
  ["facebook", /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i],
  ["instagram", /(^|\.)instagram\.com$/i],
  ["twitter", /(^|\.)(twitter\.com|x\.com)$/i],
  ["other", /(^|\.)(linkedin\.com|youtube\.com|youtu\.be|tiktok\.com|pinterest\.[a-z.]+)$/i],
];

function socialKind(u: URL): "facebook" | "instagram" | "twitter" | "other" | null {
  const host = u.hostname.toLowerCase();
  for (const [key, re] of SOCIAL_HOSTS) if (re.test(host)) return key;
  return null;
}

function isImageUrl(u: URL): boolean {
  if (/\.(jpe?g|png|webp|gif|avif|svg)($|\?)/i.test(u.pathname)) return true;
  return /(^|\.)(gstatic\.com|googleusercontent\.com|ggpht\.com|th\.bing\.com)$/i.test(u.hostname);
}

/** Google's grey silhouette shown when a listing has no photo — not a photo. */
function isPlaceholderImage(u: URL): boolean {
  return /default_user|servicebusiness\/default/i.test(u.pathname);
}

/**
 * Australian-shaped phone number. Requires a leading `+`/`0`, or 9+ digits, so
 * a street range like "1113-1121" is not mistaken for a number.
 */
function isPhoneLike(v: string): boolean {
  const t = v.trim();
  if (!t || /[A-Za-z]/.test(t)) return false;
  if (!/^[+()\d\s.\-/]+$/.test(t)) return false;
  const digits = t.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return false;
  return /^\+/.test(t) || /^\(?0/.test(t) || digits.length >= 9;
}

/** Opening-hours chatter the maps listing shows next to the address. */
function isHoursLike(v: string): boolean {
  const t = v.replace(/^[·•\s]+/, "").trim();
  if (!t) return true;
  if (/^(open|opens|closed|closes|24\s*hours|temporarily closed|permanently closed)\b/i.test(t)) return true;
  return /^\d{1,2}(:\d{2})?\s*(am|pm)$/i.test(t);
}

/** Button captions and other UI furniture the scraper swept up as columns. */
const JUNK_LABELS = new Set([
  "website", "directions", "call", "menu", "share", "save", "order online", "book online",
  "onsite services", "onsite services not available", "reserve a table", "learn more",
]);

/** No letters and no digits — separators ("·") and private-use icon glyphs. */
function isGlyphOnly(v: string): boolean {
  return !/[\p{L}\p{N}]/u.test(v);
}

/** "(40)", "4.7", "1,204" — counts and scores, never an address or category. */
function isNumericLike(v: string): boolean {
  return /^\(?\s*[\d.,]+\s*\)?$/.test(v.trim());
}

const STREET_SUFFIX =
  /\b(st|street|rd|road|ave|av|avenue|ln|lane|pde|parade|hwy|highway|ct|court|cres|crescent|dr|drive|tce|terrace|pl|place|blvd|boulevard|way|esplanade|esp|cct|circuit|close|grove|gr|mews|strand|square|sq)\.?$/i;

/**
 * Does this read as a street address rather than a business category? Google
 * puts both in the same anonymous column family, and getting it wrong matters:
 * `category` drives the AI email tailoring, so an address landing there would
 * poison the copy.
 */
function isAddressLike(v: string): boolean {
  const t = v.trim();
  if (/^\d/.test(t)) return true; // "179 Napier St", "2/58 Newmarket St"
  if (/\b(level|suite|ste|unit|shop|floor|basement|lot|g0?\d)\b/i.test(t)) return true;
  const lastWord = t.split(/[\s,]+/).pop() ?? "";
  return STREET_SUFFIX.test(lastWord);
}

// ── mapping ──────────────────────────────────────────────────────────────────

function clean(v: string | undefined): string | null {
  if (v == null) return null;
  const t = v.trim();
  if (!t || t.toLowerCase() === IN_PROGRESS) return null;
  return t;
}

/** Split a comma-joined cell into a de-duplicated, trimmed list. */
function cleanList(v: string | undefined): string[] {
  const t = clean(v);
  if (!t) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of t.split(",")) {
    const p = part.trim();
    if (!p) continue;
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
}

function cleanRating(v: string | undefined): number | null {
  const t = clean(v);
  if (!t) return null;
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n)) return null;
  // maps ratings are 0–5; anything else is a different number in that column
  return n >= 0 && n <= 5 ? n : null;
}

function pushUnique(list: string[], value: string): void {
  if (!list.some((v) => v.toLowerCase() === value.toLowerCase())) list.push(value);
}

/**
 * Where the row's free-text run ends: at the first URL or button caption after
 * the name. Everything past it (review snippets, hours, image URLs) is out of
 * bounds for the address/category scan.
 */
function textZoneEnd(cells: string[], nameIdx: number): number {
  for (let i = Math.max(nameIdx, -1) + 1; i < cells.length; i++) {
    const v = cells[i]?.trim();
    if (!v) continue;
    if (asUrl(v) || JUNK_LABELS.has(v.toLowerCase())) return i;
  }
  return cells.length;
}

function extractRow(cells: string[], col: ColMap, claimed: Set<number>): LeadImportRow | null {
  const at = (i: number | undefined) => (i != null && i >= 0 ? cells[i] : undefined);

  // ── name ──
  let name = clean(at(col.name));
  // Which column the name came from, so the address/category scan below can
  // skip it. Without this, a file with no recognised name header files its
  // business name as the category.
  let nameIdx = name != null ? (col.name ?? -1) : -1;
  if (!name) {
    // No name column resolved (or it was blank): the first cell that is plain
    // text — not a URL, number, phone, glyph or button caption.
    for (let i = 0; i < cells.length; i++) {
      const v = clean(cells[i]);
      if (!v || asUrl(v) || isGlyphOnly(v) || isNumericLike(v) || isPhoneLike(v)) continue;
      if (JUNK_LABELS.has(v.toLowerCase()) || isHoursLike(v)) continue;
      name = v;
      nameIdx = i;
      break;
    }
  }
  if (!name) return null;

  const emails: string[] = [];
  const socials: string[] = [];
  let facebook = clean(at(col.facebook));
  let instagram = clean(at(col.instagram));
  let twitter = clean(at(col.twitter));
  let website: string | null = null;
  let mapsUrl: string | null = null;
  let image: string | null = null;
  let phone: string | null = null;

  // ── named columns first ──
  for (const e of cleanList(at(col.emails))) pushUnique(emails, e);
  for (const s of cleanList(at(col.social_medias))) pushUnique(socials, s);

  const namedSite = clean(at(col.website));
  if (namedSite) {
    const u = asUrl(namedSite);
    if (u && !isMapsUrl(u) && !isAdRedirect(u) && !socialKind(u) && !isImageUrl(u)) website = namedSite;
    else if (u && isMapsUrl(u)) mapsUrl = namedSite; // some exports swap the two
  }

  const namedMaps = clean(at(col.maps_url));
  if (namedMaps && !mapsUrl) {
    const u = asUrl(namedMaps);
    if (u && isMapsUrl(u)) mapsUrl = namedMaps;
  }

  const namedPhone = clean(at(col.phone));
  if (namedPhone && isPhoneLike(namedPhone)) phone = namedPhone;

  const namedImage = clean(at(col.featured_image));
  if (namedImage) {
    const u = asUrl(namedImage);
    if (u && !isPlaceholderImage(u)) image = namedImage;
  }

  // ── content scan: every cell, claimed or not, fills what's still missing ──
  for (let i = 0; i < cells.length; i++) {
    const v = clean(cells[i]);
    if (!v) continue;

    // Emails and socials are collected from ANYWHERE — an unrecognised extra
    // column is exactly where a scraper's enrichment output tends to land.
    const found = v.match(EMAIL_RE);
    if (found) for (const e of found) pushUnique(emails, e.toLowerCase());

    const u = asUrl(v);
    if (u) {
      const kind = socialKind(u);
      if (kind) {
        pushUnique(socials, v);
        if (kind === "facebook" && !facebook) facebook = v;
        if (kind === "instagram" && !instagram) instagram = v;
        if (kind === "twitter" && !twitter) twitter = v;
        continue;
      }
      if (isMapsUrl(u)) {
        if (!mapsUrl) mapsUrl = v;
        continue;
      }
      if (isAdRedirect(u)) continue; // sponsored redirect — never a website
      if (isImageUrl(u)) {
        if (!image && !isPlaceholderImage(u)) image = v;
        continue;
      }
      if (!website) website = v;
      continue;
    }

    if (!phone && !claimed.has(i) && isPhoneLike(v)) phone = v;
  }

  // ── address + category ──
  let address = clean(at(col.address));
  let category = clean(at(col.category));

  if (!address || !category) {
    const zoneEnd = textZoneEnd(cells, nameIdx);
    const candidates: string[] = [];
    for (let i = 0; i < zoneEnd; i++) {
      if (claimed.has(i) || i === nameIdx) continue;
      const v = clean(cells[i]);
      if (!v) continue;
      if (isGlyphOnly(v) || isNumericLike(v) || isHoursLike(v) || isPhoneLike(v)) continue;
      if (JUNK_LABELS.has(v.toLowerCase()) || asUrl(v)) continue;
      candidates.push(v);
    }
    // The address is the last address-shaped candidate; the category is the
    // first candidate that isn't it and doesn't read as an address either.
    const addressPick = [...candidates].reverse().find(isAddressLike) ?? null;
    if (!address) address = addressPick;
    if (!category) category = candidates.find((c) => c !== addressPick && !isAddressLike(c)) ?? null;
  }

  return {
    name,
    address,
    featured_image: image,
    bing_maps_url: mapsUrl,
    rating: cleanRating(at(col.rating)),
    category,
    website,
    phone,
    emails,
    social_medias: socials,
    facebook,
    instagram,
    twitter,
  };
}

/**
 * Identity of the business a row describes, for in-file de-duplication.
 * Returns null when the row carries nothing strong enough to match on — better
 * to import a possible duplicate than to silently drop a distinct business.
 */
function identityKey(row: LeadImportRow): string | null {
  // Google embeds a stable place id in the maps URL: !1s0x<hex>:0x<hex>
  const place = row.bing_maps_url?.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i);
  if (place) return `place:${place[1].toLowerCase()}`;
  if (row.bing_maps_url) return `maps:${row.bing_maps_url.toLowerCase()}`;
  if (row.website) return `site:${row.website.toLowerCase().replace(/\/+$/, "")}`;
  if (row.address) return `na:${row.name.toLowerCase()}|${row.address.toLowerCase()}`;
  return null;
}

/**
 * Map a parsed grid → the 13 kept columns. Rows without a business name are
 * dropped (header junk / blank lines), as are repeats of a business an earlier
 * row already described.
 *
 * First occurrence wins on a duplicate. That ordering is deliberate: in the
 * Google export the repeated rows appear at the tail after the results list
 * has re-rendered, and they arrive scrambled — a listing's website column
 * carrying the *next* business's URL. The first copy of a row is the intact one.
 */
export function mapLeads(grid: string[][]): ParsedCsv {
  const empty: ParsedCsv = {
    rows: [],
    totalRows: 0,
    skipped: 0,
    duplicates: 0,
    headers: [],
    sources: { google: 0, bing: 0, unknown: 0 },
    withEmail: 0,
  };
  if (grid.length === 0) return empty;

  const headers = grid[0].map((h) => h.trim());
  const { col, claimed } = resolveColumns(headers);

  const rows: LeadImportRow[] = [];
  const seen = new Set<string>();
  const sources: Record<LeadSource, number> = { google: 0, bing: 0, unknown: 0 };
  let totalRows = 0;
  let skipped = 0;
  let duplicates = 0;
  let withEmail = 0;

  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    // skip a blank trailing line, and rows that are entirely empty cells
    if (cells.every((c) => c.trim() === "")) continue;
    totalRows++;

    const row = extractRow(cells, col, claimed);
    if (!row) {
      skipped++;
      continue;
    }

    const key = identityKey(row);
    if (key) {
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
    }

    rows.push(row);
    sources[leadSource(row.bing_maps_url)]++;
    if (row.emails.length) withEmail++;
  }

  return { rows, totalRows, skipped, duplicates, headers, sources, withEmail };
}

export function parseLeadsCsv(text: string): ParsedCsv {
  return mapLeads(parseCsv(text));
}
