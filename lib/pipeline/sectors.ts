// Sector Playbooks — per-sector config that maps a lead's free-text CSV Category
// to a sector and its knowledge-base markdown. The KB grounds the AI outreach
// email. Pure and framework-free so the client page (SectorPlaybooksPage) and
// the server routes (api/sector-playbooks, campaigns/compose) share the same
// types + matching logic.
//
// Persisted as JSON in app_settings under SETTING_SECTOR_PLAYBOOKS. An uploaded
// KB markdown (kb.content) is stored inline and overrides the repo file
// (components/knowledgebase/<slug>.md); with no upload the repo file is used.

/** Uploaded knowledge-base markdown for a sector. When present it overrides the
 *  repo file (components/knowledgebase/<slug>.md) as the KB grounding the email. */
export interface SectorKb {
  /** uploaded filename, shown in the UI */
  name: string;
  size: number;
  uploadedAt: string;
  /** the markdown content */
  content: string;
}

/** The attachment PDF for a sector (an object in the `sector-assets` Storage
 *  bucket). Separate from the KB markdown: the KB grounds the email copy; the
 *  PDF rides along as the outgoing email's attachment (matched by Category and
 *  attached by the n8n Gmail node). */
export interface SectorPdf {
  /** object path within the sector-assets bucket, e.g. "aged-care.pdf" */
  path: string;
  /** original filename, shown in the UI and used as the email attachment name */
  name: string;
  size: number;
  uploadedAt: string;
}

export interface SectorPlaybook {
  /** stable id — also the repo KB filename base (components/knowledgebase/<slug>.md) */
  slug: string;
  /** display name */
  name: string;
  /** lowercased keyword fragments matched against a lead's free-text Category */
  categories: string[];
  /** uploaded KB markdown that overrides the repo file, or null to use the repo file */
  kb: SectorKb | null;
  /** attachment PDF (Storage), or null when none uploaded — attached per Category on send */
  pdf: SectorPdf | null;
}

export const SECTOR_SLUGS = ["aged-care", "early-childhood", "education"] as const;

/** Seed config — the three APMG sectors with sensible category keywords. Stored
 *  overrides (name/categories/pdf) win; see mergePlaybooks. */
export const DEFAULT_PLAYBOOKS: readonly SectorPlaybook[] = [
  {
    slug: "aged-care",
    name: "Aged Care & Health",
    categories: [
      "aged care", "aged-care", "nursing home", "retirement", "aged living",
      "retirement village", "health", "healthcare", "hospital", "medical centre",
      "disability", "ndis",
    ],
    kb: null,
    pdf: null,
  },
  {
    slug: "early-childhood",
    name: "Early Childhood / Early Learning",
    categories: [
      "early childhood", "early learning", "childcare", "child care", "child-care",
      "day care", "daycare", "kindergarten", "kindy", "preschool", "pre-school",
      "nursery", "oshc", "long day care",
    ],
    kb: null,
    pdf: null,
  },
  {
    slug: "education",
    name: "Education / Schools",
    categories: [
      "education", "school", "primary school", "secondary school", "high school",
      "college", "university", "campus", "tafe", "academy", "grammar",
    ],
    kb: null,
    pdf: null,
  },
];

const SLUG_RE = /^[a-z0-9-]{1,40}$/;
export function isSectorSlug(v: unknown): v is string {
  return typeof v === "string" && SLUG_RE.test(v);
}

/** The KB markdown path (repo-relative) for a sector — the source of truth for
 *  the doc that grounds email copy (components/knowledgebase/<slug>.md). */
export function kbFileName(slug: string): string {
  return `${slug}.md`;
}

/**
 * Resolve a lead's free-text Category to a playbook by keyword match. Longest
 * matching keyword wins, so "aged care" beats an incidental "care", and a
 * lead categorised "Primary school" maps to Education. Returns null when
 * nothing matches (the send flow then attaches no PDF).
 */
export function resolveSectorForCategory(
  category: string | null | undefined,
  playbooks: readonly SectorPlaybook[],
): SectorPlaybook | null {
  const c = (category ?? "").toLowerCase().trim();
  if (!c) return null;
  let best: { pb: SectorPlaybook; len: number } | null = null;
  for (const pb of playbooks) {
    for (const kw of pb.categories) {
      const k = kw.toLowerCase().trim();
      if (k && c.includes(k) && (!best || k.length > best.len)) best = { pb, len: k.length };
    }
  }
  return best?.pb ?? null;
}

const MAX_CATEGORIES = 40;
const MAX_KEYWORD_LEN = 60;
const MAX_NAME_LEN = 80;
/** Cap on stored KB markdown (matches the upload route's limit). */
export const MAX_KB_CONTENT = 200_000;

/** Defensively coerce one stored/posted entry into a clean SectorPlaybook,
 *  keyed to a known default (so slug + identity can't be spoofed/renamed). */
function sanitizeOne(base: SectorPlaybook, raw: unknown): SectorPlaybook {
  if (!raw || typeof raw !== "object") return { ...base };
  const o = raw as Record<string, unknown>;

  const name =
    typeof o.name === "string" && o.name.trim()
      ? o.name.trim().slice(0, MAX_NAME_LEN)
      : base.name;

  const categories = Array.isArray(o.categories)
    ? [
        ...new Set(
          o.categories
            .filter((x): x is string => typeof x === "string")
            .map((x) => x.toLowerCase().trim())
            .filter((x) => x.length > 0 && x.length <= MAX_KEYWORD_LEN),
        ),
      ].slice(0, MAX_CATEGORIES)
    : [...base.categories];

  let kb: SectorKb | null = null;
  const k = o.kb;
  if (k && typeof k === "object") {
    const ko = k as Record<string, unknown>;
    const content = typeof ko.content === "string" ? ko.content : "";
    if (content.trim()) {
      kb = {
        name: (typeof ko.name === "string" && ko.name.trim() ? ko.name.trim() : `${base.slug}.md`).slice(0, 200),
        size: typeof ko.size === "number" && ko.size >= 0 ? ko.size : content.length,
        uploadedAt: typeof ko.uploadedAt === "string" && ko.uploadedAt ? ko.uploadedAt : "",
        content: content.slice(0, MAX_KB_CONTENT),
      };
    }
  }

  let pdf: SectorPdf | null = null;
  const p = o.pdf;
  if (p && typeof p === "object") {
    const po = p as Record<string, unknown>;
    const path = typeof po.path === "string" ? po.path.trim() : "";
    const pname = typeof po.name === "string" ? po.name.trim() : "";
    if (path && pname) {
      pdf = {
        path: path.slice(0, 200),
        name: pname.slice(0, 200),
        size: typeof po.size === "number" && po.size >= 0 ? po.size : 0,
        uploadedAt: typeof po.uploadedAt === "string" && po.uploadedAt ? po.uploadedAt : "",
      };
    }
  }

  return { slug: base.slug, name, categories: categories.length ? categories : [...base.categories], kb, pdf };
}

/**
 * Merge stored config over DEFAULT_PLAYBOOKS: the sector set is fixed by the
 * defaults (so new default sectors appear automatically and unknown stored
 * slugs are dropped), while a matching stored entry's name/categories/pdf win.
 */
export function mergePlaybooks(stored: unknown): SectorPlaybook[] {
  const bySlug = new Map<string, unknown>();
  if (Array.isArray(stored)) {
    for (const e of stored) {
      if (e && typeof e === "object" && isSectorSlug((e as Record<string, unknown>).slug)) {
        bySlug.set((e as Record<string, unknown>).slug as string, e);
      }
    }
  }
  return DEFAULT_PLAYBOOKS.map((base) => sanitizeOne(base, bySlug.get(base.slug)));
}

/** Parse the raw app_settings JSON string into playbooks (defaults on any miss). */
export function parsePlaybooks(raw: string | null): SectorPlaybook[] {
  if (!raw) return mergePlaybooks(null);
  try {
    return mergePlaybooks(JSON.parse(raw));
  } catch {
    return mergePlaybooks(null);
  }
}
