// CSV parsing + mapping for the Bing Maps Scraper export.
//
// Pure and framework-free so it runs in the browser during the "Read & parse"
// phase of the Pipeline tool. We keep only the 13 columns the importer cares
// about (mapped by header NAME, so column order doesn't matter) and drop the
// rest (ID/ypid, lat/long, Rating Info, Open Hours). "Category" is kept — the
// compose automation tailors each AI-drafted email to it.

export interface LeadImportRow {
  name: string;
  address: string | null;
  featured_image: string | null;
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
  /** header names found, in file order */
  headers: string[];
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
  return Number.isFinite(n) ? n : null;
}

/**
 * Map a parsed grid → the 13 kept columns, by header name (case-insensitive,
 * order-agnostic). Rows without a Name are dropped (header junk / blank lines).
 */
export function mapLeads(grid: string[][]): ParsedCsv {
  if (grid.length === 0) {
    return { rows: [], totalRows: 0, skipped: 0, headers: [] };
  }

  const headers = grid[0].map((h) => h.trim());
  const idx = (name: string) =>
    headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());

  const col = {
    name: idx("Name"),
    address: idx("Address"),
    featured_image: idx("Featured image"),
    bing_maps_url: idx("Bing Maps URL"),
    rating: idx("Rating"),
    category: idx("Category"),
    website: idx("Website"),
    phone: idx("Phone"),
    emails: idx("Emails"),
    social_medias: idx("Social Medias"),
    facebook: idx("Facebook"),
    instagram: idx("Instagram"),
    twitter: idx("Twitter"),
  };

  const rows: LeadImportRow[] = [];
  let totalRows = 0;
  let skipped = 0;

  for (let r = 1; r < grid.length; r++) {
    const cells = grid[r];
    // skip a blank trailing line
    if (cells.length === 1 && cells[0].trim() === "") continue;
    totalRows++;

    const get = (i: number) => (i >= 0 ? cells[i] : undefined);
    const name = clean(get(col.name));
    if (!name) {
      skipped++;
      continue;
    }

    rows.push({
      name,
      address: clean(get(col.address)),
      featured_image: clean(get(col.featured_image)),
      bing_maps_url: clean(get(col.bing_maps_url)),
      rating: cleanRating(get(col.rating)),
      category: clean(get(col.category)),
      website: clean(get(col.website)),
      phone: clean(get(col.phone)),
      emails: cleanList(get(col.emails)),
      social_medias: cleanList(get(col.social_medias)),
      facebook: clean(get(col.facebook)),
      instagram: clean(get(col.instagram)),
      twitter: clean(get(col.twitter)),
    });
  }

  return { rows, totalRows, skipped, headers };
}

export function parseLeadsCsv(text: string): ParsedCsv {
  return mapLeads(parseCsv(text));
}
