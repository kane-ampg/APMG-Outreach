/**
 * Turns the raw client-site export into the Master Client List: one row per
 * real customer, with every branch and site folded underneath it.
 *
 * WHY THIS EXISTS
 * The export is a job-management dump, not a customer list. The same customer
 * appears under several spellings because whoever raised the job typed what
 * they had in front of them:
 *
 *   Ace Body Corp - Aspendale / ACE Body Corp - Brighton /
 *   Ace Body Corporate Management - Collingwood /
 *   Ace Body Corporate Management Croydon & Dandenong    → ONE customer, 9 branches
 *
 *   MBCM / MBCM - Mitcham / MBCM Mordialloc / MBCM Strata Specialists
 *                                                        → ONE customer, 15 branches
 *
 * Counting the raw `Customer` column therefore over-states how many clients
 * APMG has, and — the part that actually costs money — it means a cold-outreach
 * guard keyed on the raw spelling misses the other spellings of a customer we
 * already hold. Everything here exists to produce ONE key per customer.
 *
 * DESIGN RULES
 *  · Deterministic, never fuzzy. Two spellings merge because a documented rule
 *    says so, not because a similarity score crossed a threshold. A wrong merge
 *    would hide a real client behind another client's name.
 *  · No data is dropped. Test rows, "DO NOT USE" records and APMG's own
 *    internal jobs are FLAGGED (`flag`), never deleted — they are still names
 *    an operator needs to recognise, and still addresses outreach must avoid.
 *  · Every fold is auditable. `aliases` carries the raw spellings that landed
 *    in a group, so the tab can show its work.
 *
 * Pure and framework-free: no fetch, no fs, no React. Runs in the API route
 * and in vitest identically.
 */

import { parseCsv } from "@/lib/pipeline/csv";

/* ─────────────────────────────  public shapes  ───────────────────────────── */

/** A named business, or a person APMG invoices directly (an owner-occupier). */
export type ClientKind = "organisation" | "individual";

/**
 * Why a group is or isn't a live customer.
 *  · `active`     — a real client.
 *  · `internal`   — APMG's own jobs (APMG Painting, Performance Asset
 *                   Management Melbourne). Not a customer, and its addresses
 *                   must never be treated as one.
 *  · `do-not-use` — the export's own marker: test records ("Carly Test") and
 *                   rows someone tagged "DO NOT USE" / "(DONT USE)".
 */
export type ClientFlag = "active" | "internal" | "do-not-use";

/** One row of the export: a single site APMG services. */
export interface ClientSite {
  /** stable within a build — `${groupKey}#${n}` */
  id: string;
  /** the site as the export names it */
  siteName: string;
  /** branch/office the site sits under, when the customer has branches */
  branch: string | null;
  contact: string | null;
  phone: string | null;
  emails: string[];
  street: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  /** archived in the source system (a closed site, kept for history) */
  archived: boolean;
  /** the raw `Customer` spelling this row arrived under */
  sourceCustomer: string;
}

/** One real customer, with every spelling, branch and site folded in. */
export interface ClientGroup {
  /** normalized identity — the join key everything else uses */
  key: string;
  /** canonical display name */
  name: string;
  kind: ClientKind;
  flag: ClientFlag;
  /** raw `Customer` spellings folded into this group, alphabetical */
  aliases: string[];
  /** branch/office names under this customer, alphabetical */
  branches: string[];
  sites: ClientSite[];
  siteCount: number;
  archivedSites: number;
  /** every address on file for this customer, lowercased and deduped */
  emails: string[];
  /** email domains that identify this customer (free providers, shared
   *  government domains and APMG's own domains are excluded — see
   *  {@link NON_IDENTIFYING_DOMAINS}) */
  domains: string[];
  contacts: string[];
  phones: string[];
  suburbs: string[];
  states: string[];
}

export interface MasterClientListStats {
  /** rows read from the export */
  rows: number;
  /** distinct raw `Customer` spellings before normalization */
  rawCustomers: number;
  /** real customers after folding — the headline number */
  clients: number;
  /** spellings removed by folding (rawCustomers − clients) */
  duplicatesFolded: number;
  /** live customers (`flag: "active"`) */
  active: number;
  /** groups held back from the client count: internal + do-not-use */
  excluded: number;
  organisations: number;
  individuals: number;
  sites: number;
  archivedSites: number;
  /** total branch/office names across all customers */
  branches: number;
  /** customers with more than one site */
  multiSite: number;
  /** customers with at least one branch name */
  branched: number;
  /** sites sitting under one of those branch networks */
  branchedSites: number;
  /** customers with at least one address on file */
  withEmail: number;
  /** distinct addresses locked out of outreach */
  emails: number;
  /** distinct identifying domains locked out of outreach */
  domains: number;
  suburbs: number;
}

export interface MasterClientList {
  groups: ClientGroup[];
  stats: MasterClientListStats;
}

/* ──────────────────────────────  text hygiene  ───────────────────────────── */

/**
 * Zero-width characters: U+200B ZERO WIDTH SPACE, U+200C/U+200D the
 * non-joiner/joiner, and U+FEFF. The export carries a U+200B in the middle of
 * at least one address (a Guardian row), which would otherwise make that
 * address un-matchable. Built from code points so no invisible character has to
 * sit in this file where nobody reviewing it can see it.
 */
const ZERO_WIDTH = new RegExp(`[${String.fromCharCode(0x200b, 0x200c, 0x200d, 0xfeff)}]`, "g");

/** Collapse whitespace, strip zero-width junk, and fold the en/em dashes the
 *  export mixes with plain hyphens ("Inspira Kids ELC – Archer St") so one
 *  separator rule covers both. */
function tidy(value: string | undefined): string {
  return (value ?? "")
    .replace(ZERO_WIDTH, "")
    .replace(/[‐-―]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function cell(value: string | undefined): string | null {
  const t = tidy(value);
  return t || null;
}

/** Comparison key: lowercase, letters and digits only. "ACE Body Corp" and
 *  "Ace  Body   Corp." collapse to the same thing. */
export function squash(value: string): string {
  return tidy(value).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/** Word-level key, used where token structure matters (partial name matching). */
export function nameTokens(value: string): string[] {
  return tidy(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
}

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Every address in a cell. The export puts two in one cell in places
 *  ("aamax@bigpond.com, capewrath@ymail.com") and hides others in the Custom
 *  columns, so this scrapes rather than parses. */
function emailsIn(value: string | undefined): string[] {
  const matches = tidy(value).match(EMAIL_RE);
  return matches ? matches.map((e) => e.toLowerCase()) : [];
}

export function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

/**
 * Domains that do NOT identify a customer, so they must never be used to match
 * a prospect against this list:
 *  · free/consumer providers — thousands of unrelated businesses share them;
 *  · APMG's own domains — they appear on 71 rows because an APMG address was
 *    the billing contact for someone else's site;
 *  · shared government domains, added by rule below (`*.gov.au`) rather than by
 *    name: kindergarten.vic.gov.au sits on rows for several different kinders.
 */
export const NON_IDENTIFYING_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "hotmail.com",
  "hotmail.com.au",
  "outlook.com",
  "outlook.com.au",
  "live.com",
  "live.com.au",
  "msn.com",
  "yahoo.com",
  "yahoo.com.au",
  "ymail.com",
  "icloud.com",
  "me.com",
  "mac.com",
  "bigpond.com",
  "bigpond.net.au",
  "optusnet.com.au",
  "iinet.net.au",
  "internode.on.net",
  "tpg.com.au",
  "dodo.com.au",
  "aapt.net.au",
  "netspace.net.au",
  "westnet.com.au",
  "aol.com",
  "protonmail.com",
  "apmgservices.com.au",
  "apmgmaintenance.com.au",
  "apmgpainting.com.au",
]);

/** True when a domain can stand in for a customer's identity. */
export function isIdentifyingDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  if (NON_IDENTIFYING_DOMAINS.has(d)) return false;
  // Shared public-sector domains (kindergarten.vic.gov.au and friends) sit on
  // rows belonging to different customers — matching on them would exclude
  // every government-adjacent prospect at once.
  if (d.endsWith(".gov.au") || d.endsWith(".gov")) return false;
  return d.includes(".");
}

/* ───────────────────────────  customer name rules  ───────────────────────── */

/** Legal/administrative noise that is never part of a customer's identity. */
function stripLegalNoise(name: string): string {
  return tidy(
    name
      // "…, Care of:/ Noble Knight Real Estate Pty Ltd" — a managing agent
      // appended to the customer's own name.
      .replace(/,?\s*care of:?\/?.*$/i, "")
      // "ACN 608 039 112", "ABN 12 345 678 901"
      .replace(/\b(?:acn|abn)\s*[\d\s]{9,}$/i, "")
      .replace(/\bpty\.?\s*ltd\.?\b/gi, "")
      .replace(/\b(?:ltd|limited|pty)\.?\b/gi, "")
      // a bare disambiguating counter the source system appended: "… (1)"
      .replace(/\s*\(\d+\)\s*$/, "")
      .replace(/[\s,.\-–]+$/, ""),
  );
}

/** Markers the export itself uses to retire a record. */
const DO_NOT_USE_RE = /(?:^|\s)(?:do\s*not\s*use|don'?t\s*use)(?:\s|$)|\((?:do\s*not\s*use|don'?t\s*use)\)/i;
/** Obvious test records — "Carly Test", "Craig Test". */
const TEST_RECORD_RE = /\btest\b\s*$/i;
/** APMG's own jobs. "Performance Asset Management Melbourne" is APMG's
 *  registered name, so it is the same internal entity as "APMG Painting". */
const INTERNAL_RE = /^apmg\b|^performance asset management\b/i;

function flagFor(rawName: string): ClientFlag {
  if (INTERNAL_RE.test(rawName)) return "internal";
  if (DO_NOT_USE_RE.test(rawName) || TEST_RECORD_RE.test(rawName)) return "do-not-use";
  return "active";
}

function stripFlagMarkers(name: string): string {
  return tidy(
    name
      .replace(/\((?:do\s*not\s*use|don'?t\s*use)\)/gi, "")
      .replace(/(?:^|\s)(?:do\s*not\s*use|don'?t\s*use)(?:\s|$)/gi, " ")
      .replace(/^\[old\]\s*/i, ""),
  );
}

/**
 * Customer families the export spells more than one way. Each entry says: any
 * raw `Customer` starting with `re` belongs to `group`, and whatever follows
 * the match is that row's branch.
 *
 * These are hand-verified against the export — a shared email domain plus a
 * shared trading name, not a guess. Add to this list when a new export
 * introduces another split brand; the generic rule below handles the ordinary
 * "Brand - Suburb" case on its own.
 */
const FAMILIES: ReadonlyArray<{ re: RegExp; group: string; note: string }> = [
  {
    // acebodycorp.com.au + acebcm.com.au + acebodycorporate.com.au
    re: /^ace\s+body\s+corp(?:orate)?(?:\s+management)?\b/i,
    group: "Ace Body Corporate Management",
    note: "Ace Body Corp / Ace Body Corporate Management, 9 branch spellings",
  },
  {
    // mbcm.com.au, plus the per-office mitcham.mbcm.com.au / mbcmmitcham.com.au
    re: /^mbcm\b/i,
    group: "MBCM Strata Specialists",
    note: "MBCM, its 14 hyphenated offices, and MBCM Mordialloc",
  },
  {
    // whittles.com.au on all three spellings
    re: /^whittles\b/i,
    group: "Whittles",
    note: "Whittles Aus / Whittles Bayswater / Whittles Management Services",
  },
  {
    re: /^noel\s+jones\b/i,
    group: "Noel Jones Real Estate",
    note: "Noel Jones Real Estate + the Mitcham and Ringwood offices",
  },
  {
    // nobleknight.com.au. Deliberately NOT merged with "The Knight" — they read
    // like the same brand but the export gives them different sites and no
    // shared address, and a wrong merge would bury one client under the other.
    re: /^noble\s+knight\b/i,
    group: "Noble Knight Real Estate",
    note: "Noble Knight Real Estate + the record tagged (DONT USE)",
  },
  {
    re: /^the\s+knight\b/i,
    group: "The Knight",
    note: "The Knight / The Knight Body Corporate",
  },
  {
    re: /^green\s+leaves\b/i,
    group: "Green Leaves Early Learning",
    note: "Green Leaves Early Learning + the ACN-suffixed VIC3 entity",
  },
  {
    // mayfield.com.au on both
    re: /^mayfield\b/i,
    group: "Mayfield Childcare",
    note: "Mayfield Childcare Ltd / Mayfield Early Education Accounts",
  },
  {
    // "Yarra Rangers Kinders" is a typo for "Yarra Ranges Kinders". Anchored on
    // "kinders" so Yarra Ranges Council is left alone.
    re: /^yarra\s+range(?:r)?s\s+kinders?\b/i,
    group: "Yarra Ranges Kinders",
    note: "Yarra Ranges Kinders / Yarra Rangers Kinders (typo)",
  },
  {
    re: /^woodlands?\b(?=.*(?:child|kinder|long\s*day|early))/i,
    group: "Woodlands Childcare & Education",
    note: "Woodlands Childcare & Education / Woodlands Long Day Care And Kindergarten",
  },
  {
    // The export misspells it "Indepedence" on both rows; the pattern is loose
    // enough to catch the correct spelling too, so a fixed re-export still folds.
    re: /^residential\s+indep\w*\b/i,
    group: "Residential Independence",
    note: "both Residential Indepedence records (source misspells 'Independence')",
  },
  {
    re: INTERNAL_RE,
    group: "APMG (internal)",
    note: "APMG Painting / APMG Painting Services / Performance Asset Management Melbourne",
  },
];

/**
 * Remainders that name a division or a legal form rather than a place, so they
 * are head office rather than a branch. Without this, "Whittles Management
 * Services" would show up as a Whittles *branch* called "Management Services".
 */
const NOT_A_BRANCH = new Set([
  "",
  "aus",
  "au",
  "australia",
  "vic",
  "victoria",
  "group",
  "accounts",
  "head office",
  "management services",
  "strata specialists",
  "real estate",
  "real estate agency",
  "body corporate",
  "body corporate management",
  "childcare",
  "childcare & education",
  "early learning",
  "early learning centres",
  "early education accounts",
  "painting",
  "painting services",
]);

function branchFrom(remainder: string): string | null {
  const t = tidy(remainder.replace(/^[-–—:,\s]+/, ""));
  if (NOT_A_BRANCH.has(t.toLowerCase())) return null;
  return t || null;
}

/**
 * People APMG invoices directly, rather than businesses. Curated by reading the
 * export, and deliberately NOT inferred, because the shape of a name cannot
 * decide this: "Barry Plant", "Nelson Alexander", "Noel Jones", "Jellis Craig",
 * "Woodards Camberwell", "Oscar Wylee" and "Brant - John Deere" are all
 * companies named after people, while "Air Control", "All Smiles", "Sound Bay",
 * "Outside Ideas" and "Care Park" are companies with no business vocabulary in
 * them at all. A two-plain-words heuristic was tried first and mislabelled
 * about thirty real companies (Explorers Early Learning and Choklits Child Care
 * among them) as private individuals, so it was dropped.
 *
 * A name that is not in here is an organisation. That is the safe default: a
 * newcomer in a future export reads as a business until somebody curates it,
 * which understates the individual count rather than misnaming a company.
 */
const INDIVIDUALS = new Set(
  [
    "Adam Saad",
    "Adam Sorrell",
    "Adrian Doensen",
    "Adrian Moran",
    "Anthony Raso",
    "Anthony Ziehl",
    "Aruna Rajakaruna",
    "Blair Hudson",
    "Brian Price",
    "Bronwen Conway",
    "Cam Ryan",
    "Carly Test",
    "Carmel Spano",
    "Carol Marriott",
    "Catherine Loft",
    "Chris Brooke",
    "Chris Norbury",
    "Christine Durham",
    "Craig Billing",
    "Craig Test",
    "Daniel Klarnet",
    "David Meadows",
    "David Tennant",
    "Farbod Mollaei",
    "Fiona Robinson",
    "Fiona Solomon",
    "Jagon Babu",
    "Jessica Angland",
    "Jim - Hampton",
    "Joe Giaccotto",
    "Joe Sibley",
    "John Gialelis",
    "Kathy Leitch",
    "Kathy Wilton",
    "Lee (Builder)",
    "Lisa Bird",
    "Lorraine Wylie",
    "Louise Clancy",
    "Luke Kingston",
    "Margaret Higgins",
    "Mark Beshay",
    "Matthew Botros",
    "Morris Agostini",
    "Nathan Robbins",
    "Odette Maalous",
    "Oliver",
    "Peter and Sandy",
    "Rosin Smyth",
    "Sagar Bulagannawar",
    "Stuart Neil",
    "Tom Forbes - ATG",
    "Xiang Wang",
  ].map(squash),
);

function kindFor(canonicalName: string, rawName: string): ClientKind {
  const individual = INDIVIDUALS.has(squash(rawName)) || INDIVIDUALS.has(squash(canonicalName));
  return individual ? "individual" : "organisation";
}

/* ───────────────────────────────  the fold  ──────────────────────────────── */

interface Resolved {
  key: string;
  name: string;
  branch: string | null;
}

/**
 * Split a raw `Customer` into { customer, branch }.
 *
 * Two rules, in order:
 *  1. a hand-verified family (FAMILIES) — covers brands the export spells
 *     several ways, where the prefix alone can't be trusted;
 *  2. the generic "Brand - Suburb" rule, applied ONLY to prefixes the export
 *     itself proves are a family: the same prefix carries two different
 *     suffixes, or it also appears on its own as a whole customer name. That
 *     proof requirement is what stops one-off names like "Brant - John Deere"
 *     or "Vemi - Vandaag & Morgan" being cut in half.
 */
function resolveCustomer(raw: string, familyPrefixes: ReadonlySet<string>): Resolved {
  const cleaned = stripLegalNoise(stripFlagMarkers(tidy(raw)));

  for (const family of FAMILIES) {
    const m = cleaned.match(family.re);
    if (m) {
      return {
        key: squash(family.group),
        name: family.group,
        branch: branchFrom(cleaned.slice(m[0].length)),
      };
    }
  }

  const cut = cleaned.indexOf(" - ");
  if (cut > 0) {
    const prefix = tidy(cleaned.slice(0, cut));
    if (familyPrefixes.has(squash(prefix))) {
      return { key: squash(prefix), name: prefix, branch: branchFrom(cleaned.slice(cut + 3)) };
    }
  }

  const name = cleaned || tidy(raw);
  return { key: squash(name), name, branch: null };
}

/** Which " - " prefixes the export proves are families (see rule 2 above). */
function familyPrefixesIn(customers: readonly string[]): Set<string> {
  const suffixes = new Map<string, Set<string>>();
  const standalone = new Set<string>();

  for (const raw of customers) {
    const cleaned = stripLegalNoise(stripFlagMarkers(tidy(raw)));
    const cut = cleaned.indexOf(" - ");
    if (cut > 0) {
      const key = squash(cleaned.slice(0, cut));
      const set = suffixes.get(key) ?? new Set<string>();
      set.add(squash(cleaned.slice(cut + 3)));
      suffixes.set(key, set);
    } else {
      standalone.add(squash(cleaned));
    }
  }

  const families = new Set<string>();
  for (const [prefix, seen] of suffixes) {
    if (seen.size >= 2 || standalone.has(prefix)) families.add(prefix);
  }
  return families;
}

/**
 * Status markers an operator typed into the front of a site name to retire it
 * without deleting the row: "[OLD] Carlton", "[CLOSED] St Kilda North". They
 * mean the same thing as the Archived column, which those rows don't always
 * carry, so they're read as archived and then dropped from the label.
 */
const SITE_RETIRED_RE = /^\[\s*(?:old|closed|inactive|ceased|ex)\s*\]\s*/i;

export function siteIsRetired(siteName: string): boolean {
  return SITE_RETIRED_RE.test(tidy(siteName));
}

/**
 * Australian state names, so the same state can't appear twice in a facet
 * because one row said "VIC" and the next said "Victoria".
 */
const STATES: Record<string, string> = {
  vic: "Victoria",
  victoria: "Victoria",
  nsw: "New South Wales",
  newsouthwales: "New South Wales",
  qld: "Queensland",
  queensland: "Queensland",
  sa: "South Australia",
  southaustralia: "South Australia",
  wa: "Western Australia",
  westernaustralia: "Western Australia",
  tas: "Tasmania",
  tasmania: "Tasmania",
  nt: "Northern Territory",
  northernterritory: "Northern Territory",
  act: "Australian Capital Territory",
  australiancapitalterritory: "Australian Capital Territory",
};

function normalizeState(value: string | null): string | null {
  if (!value) return null;
  return STATES[squash(value)] ?? value;
}

/** Drop the customer's own name off the front of a site label, so
 *  "Guardian Childcare & Education Caulfield" reads as "Caulfield". */
function siteLabel(siteName: string, groupName: string): string {
  const site = tidy(siteName).replace(SITE_RETIRED_RE, "");
  if (!site) return "";
  const squashedGroup = squash(groupName);
  if (!squashedGroup) return site;
  const tokens = nameTokens(groupName);
  const siteTokens = nameTokens(site);
  if (siteTokens.length <= tokens.length) return site;
  const prefixMatches = tokens.every((t, i) => siteTokens[i] === t);
  if (!prefixMatches) return site;
  // rebuild from the original text so casing and punctuation survive
  let cursor = 0;
  for (let i = 0; i < tokens.length; i++) {
    const at = site.toLowerCase().indexOf(tokens[i], cursor);
    if (at < 0) return site;
    cursor = at + tokens[i].length;
  }
  const rest = tidy(site.slice(cursor).replace(/^[-–—:,\s]+/, ""));
  return rest || site;
}

const sortText = (a: string, b: string) => a.localeCompare(b, "en-AU", { sensitivity: "base" });

function pushUnique(into: string[], seen: Set<string>, value: string | null) {
  if (!value) return;
  const key = value.toLowerCase();
  if (seen.has(key)) return;
  seen.add(key);
  into.push(value);
}

/* ─────────────────────────────  entry point  ─────────────────────────────── */

/**
 * Build the Master Client List from the raw export text.
 *
 * Column names are read from the header, so a re-export that reorders or adds
 * columns still works. Rows without a `Customer` are skipped — there is nothing
 * to attribute them to.
 */
export function buildMasterClientList(csvText: string): MasterClientList {
  const grid = parseCsv(csvText);
  if (grid.length === 0) return { groups: [], stats: emptyStats() };

  const headers = grid[0].map((h) => tidy(h));
  const at = (name: string) => headers.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const col = {
    customer: at("Customer"),
    site: at("Site Name"),
    contact: at("Contact Name"),
    phone: at("Phone Number"),
    mobile: at("Mobile Number"),
    email: at("Email Address"),
    street: at("Address Street"),
    city: at("Address City"),
    region: at("Address Region"),
    postcode: at("Address Postal Code"),
    archived: at("Archived"),
  };

  const body = grid.slice(1).filter((row) => row.some((c) => tidy(c) !== ""));
  const get = (row: string[], i: number) => (i >= 0 ? row[i] : undefined);

  const rawCustomers = body.map((row) => tidy(get(row, col.customer) ?? "")).filter(Boolean);
  const familyPrefixes = familyPrefixesIn(rawCustomers);

  interface Draft {
    key: string;
    name: string;
    kind: ClientKind;
    /** most permissive flag seen — one retired duplicate must not retire a
     *  live customer (Noble Knight has both a live record and a "(DONT USE)"
     *  one) */
    flag: ClientFlag;
    aliases: string[];
    aliasSeen: Set<string>;
    branches: string[];
    branchSeen: Set<string>;
    sites: ClientSite[];
    emails: string[];
    emailSeen: Set<string>;
    contacts: string[];
    contactSeen: Set<string>;
    phones: string[];
    phoneSeen: Set<string>;
    suburbs: string[];
    suburbSeen: Set<string>;
    states: string[];
    stateSeen: Set<string>;
  }

  const drafts = new Map<string, Draft>();
  const rawSeen = new Set<string>();
  let rows = 0;

  for (const row of body) {
    const rawCustomer = tidy(get(row, col.customer) ?? "");
    if (!rawCustomer) continue;
    rows++;
    rawSeen.add(squash(rawCustomer));

    const resolved = resolveCustomer(rawCustomer, familyPrefixes);
    const flag = flagFor(rawCustomer);

    let draft = drafts.get(resolved.key);
    if (!draft) {
      draft = {
        key: resolved.key,
        name: resolved.name,
        kind: kindFor(resolved.name, rawCustomer),
        flag,
        aliases: [],
        aliasSeen: new Set(),
        branches: [],
        branchSeen: new Set(),
        sites: [],
        emails: [],
        emailSeen: new Set(),
        contacts: [],
        contactSeen: new Set(),
        phones: [],
        phoneSeen: new Set(),
        suburbs: [],
        suburbSeen: new Set(),
        states: [],
        stateSeen: new Set(),
      };
      drafts.set(resolved.key, draft);
    } else if (flag === "active") {
      // a live record anywhere in the family wins over a retired duplicate
      draft.flag = draft.flag === "internal" ? "internal" : "active";
    }

    pushUnique(draft.aliases, draft.aliasSeen, rawCustomer);
    pushUnique(draft.branches, draft.branchSeen, resolved.branch);

    // Addresses hide in the Custom columns too (an operator pasted the billing
    // contact there), and those are exactly the addresses outreach must avoid —
    // so every cell in the row is scraped, not just Email Address.
    const rowEmails = new Set<string>();
    for (const value of row) for (const email of emailsIn(value)) rowEmails.add(email);
    const siteEmails = [...rowEmails].sort();
    for (const email of siteEmails) pushUnique(draft.emails, draft.emailSeen, email);

    const contact = cell(get(row, col.contact));
    const phone = cell(get(row, col.phone)) ?? cell(get(row, col.mobile));
    const suburb = cell(get(row, col.city));
    const state = normalizeState(cell(get(row, col.region)));
    pushUnique(draft.contacts, draft.contactSeen, contact);
    pushUnique(draft.phones, draft.phoneSeen, phone);
    pushUnique(draft.suburbs, draft.suburbSeen, suburb);
    pushUnique(draft.states, draft.stateSeen, state);

    const rawSite = tidy(get(row, col.site) ?? "");
    draft.sites.push({
      id: `${draft.key}#${draft.sites.length}`,
      siteName: siteLabel(rawSite, resolved.name) || rawSite || "(unnamed site)",
      branch: resolved.branch,
      contact,
      phone,
      emails: siteEmails,
      street: cell(get(row, col.street)),
      suburb,
      state,
      postcode: cell(get(row, col.postcode)),
      archived: /^y/i.test(tidy(get(row, col.archived) ?? "")) || siteIsRetired(rawSite),
      sourceCustomer: rawCustomer,
    });
  }

  const groups: ClientGroup[] = [...drafts.values()]
    .map((d) => {
      const domainSeen = new Set<string>();
      const domains: string[] = [];
      for (const email of d.emails) {
        const domain = domainOf(email);
        if (!domain || !isIdentifyingDomain(domain) || domainSeen.has(domain)) continue;
        domainSeen.add(domain);
        domains.push(domain);
      }
      return {
        key: d.key,
        name: d.name,
        kind: d.kind,
        flag: d.flag,
        aliases: [...d.aliases].sort(sortText),
        branches: [...d.branches].sort(sortText),
        sites: [...d.sites].sort((a, b) => sortText(a.siteName, b.siteName)),
        siteCount: d.sites.length,
        archivedSites: d.sites.filter((s) => s.archived).length,
        emails: d.emails,
        domains: domains.sort(sortText),
        contacts: [...d.contacts].sort(sortText),
        phones: d.phones,
        suburbs: [...d.suburbs].sort(sortText),
        states: [...d.states].sort(sortText),
      } satisfies ClientGroup;
    })
    // biggest customers first — the list is read to answer "who do we hold",
    // and 364 sites matters more than alphabetical order
    .sort((a, b) => b.siteCount - a.siteCount || sortText(a.name, b.name));

  const suburbs = new Set<string>();
  const emails = new Set<string>();
  const domains = new Set<string>();
  for (const g of groups) {
    for (const s of g.suburbs) suburbs.add(s.toLowerCase());
    for (const e of g.emails) emails.add(e);
    for (const d of g.domains) domains.add(d);
  }

  return {
    groups,
    stats: {
      rows,
      rawCustomers: rawSeen.size,
      clients: groups.length,
      duplicatesFolded: Math.max(0, rawSeen.size - groups.length),
      active: groups.filter((g) => g.flag === "active").length,
      excluded: groups.filter((g) => g.flag !== "active").length,
      organisations: groups.filter((g) => g.kind === "organisation").length,
      individuals: groups.filter((g) => g.kind === "individual").length,
      sites: groups.reduce((n, g) => n + g.siteCount, 0),
      archivedSites: groups.reduce((n, g) => n + g.archivedSites, 0),
      branches: groups.reduce((n, g) => n + g.branches.length, 0),
      multiSite: groups.filter((g) => g.siteCount > 1).length,
      branched: groups.filter((g) => g.branches.length > 0).length,
      branchedSites: groups.reduce((n, g) => n + (g.branches.length > 0 ? g.siteCount : 0), 0),
      withEmail: groups.filter((g) => g.emails.length > 0).length,
      emails: emails.size,
      domains: domains.size,
      suburbs: suburbs.size,
    },
  };
}

function emptyStats(): MasterClientListStats {
  return {
    rows: 0,
    rawCustomers: 0,
    clients: 0,
    duplicatesFolded: 0,
    active: 0,
    excluded: 0,
    organisations: 0,
    individuals: 0,
    sites: 0,
    archivedSites: 0,
    branches: 0,
    multiSite: 0,
    branched: 0,
    branchedSites: 0,
    withEmail: 0,
    emails: 0,
    domains: 0,
    suburbs: 0,
  };
}
