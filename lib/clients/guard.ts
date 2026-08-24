/**
 * The outreach guard: given a prospect, decide whether APMG already holds them
 * as a client.
 *
 * WHY IT MATTERS
 * The client rule from the 2026-07-29 call is absolute — an existing customer
 * must never receive a cold-outreach email. The lead database is scrape output
 * covering the same Melbourne trades and body-corporate market the client list
 * is drawn from, so overlap is not hypothetical: a strata manager APMG already
 * services will absolutely turn up in a scraped VIC list under a slightly
 * different trading name.
 *
 * TWO TIERS, DELIBERATELY
 *  · `blocked` — certainty. The prospect's address, its email domain, its
 *    website host, or its exact business name is one this client list already
 *    carries. The send route DROPS these recipients, the way it drops
 *    unsubscribes: an operator cannot click past it.
 *  · `warn` — resemblance. The client's distinctive words all appear in the
 *    prospect's name ("Hive" in "Hive Strata Group"). Shown in the send flow so
 *    it can be judged, never dropped silently, because a rule loose enough to
 *    catch every relative is also loose enough to bin real prospects.
 *
 * The direction of caution is not symmetric and the tiers reflect that: a false
 * block costs one prospect out of thousands, a false pass costs a customer
 * relationship.
 *
 * Pure. The same function decides the browser's warning and the server's drop,
 * so the two can never disagree about who is a client.
 */

import {
  domainOf,
  isIdentifyingDomain,
  nameTokens,
  squash,
  type ClientFlag,
  type MasterClientList,
} from "./normalize";

/* ────────────────────────────────  the wire  ─────────────────────────────── */

/**
 * The compact index the send flow downloads once. Clients are held in one array
 * and every lookup stores an index into it, so a customer with forty addresses
 * costs forty numbers rather than forty copies of its name.
 */
export interface ClientGuardData {
  /** one entry per client: [key, display name, flag] */
  clients: Array<[string, string, ClientFlag]>;
  /** exact address → client index */
  emails: Record<string, number>;
  /** identifying email/website domain → client index */
  domains: Record<string, number>;
  /** exact normalized business name → client index */
  names: Record<string, number>;
  /** distinctive words per client, for the resemblance tier: [words, index] */
  signatures: Array<[string[], number]>;
}

export type ClientMatchBasis = "email" | "domain" | "website" | "name" | "resemblance";

export interface ClientMatch {
  clientKey: string;
  clientName: string;
  clientFlag: ClientFlag;
  /** what identified them */
  basis: ClientMatchBasis;
  /** the value in the prospect's record that matched, for the operator to read */
  evidence: string;
  /** true = must not be emailed. false = worth a human look before sending. */
  blocked: boolean;
}

/** The prospect fields the guard reads. Shaped to accept a `leads` row, a
 *  campaign recipient, or an AI draft without any of them converting first. */
export interface GuardProspect {
  name?: string | null;
  website?: string | null;
  email?: string | null;
  emails?: readonly string[] | null;
}

/* ───────────────────────────  building the index  ────────────────────────── */

/**
 * Words too common in this market to identify anybody. "Strata Management" is
 * half the client list and most of the prospect list; matching on it would warn
 * about everything, which is the same as warning about nothing.
 */
const GENERIC_WORDS = new Set([
  "the", "and", "of", "for", "at", "in", "on", "a", "an",
  "pty", "ltd", "limited", "inc", "co", "company", "australia", "australian",
  "aus", "vic", "victoria", "nsw", "melbourne", "group", "groups", "holdings",
  "service", "services", "solution", "solutions", "management", "managements",
  "manager", "managers", "property", "properties", "real", "estate", "agents",
  "agency", "strata", "body", "corporate", "corp", "specialist", "specialists",
  "consulting", "consultants", "consultancy", "community", "communities",
  "care", "childcare", "child", "kinder", "kindergarten", "early", "learning",
  "education", "educational", "centre", "centres", "center", "centers", "elc",
  "building", "buildings", "builders", "construction", "constructions",
  "constructors", "projects", "project", "developments", "homes", "home",
  "living", "retirement", "village", "villages", "aged", "clinic", "medical",
  "health", "facilities", "maintenance", "park", "parking", "commercial",
  "industrial", "national", "global", "pl", "trust", "partners", "associates",
]);

/** The distinctive words in a client's name — what's left once the market's
 *  shared vocabulary and one/two/three-letter fragments are removed. */
function signatureWords(name: string): string[] {
  return nameTokens(name).filter((t) => t.length >= 4 && !GENERIC_WORDS.has(t));
}

/**
 * Fold the Master Client List into the lookup index.
 *
 * The exact tiers (`emails` / `domains` / `names`) take EVERY group, including
 * the internal and retired ones — an address APMG has a relationship with is
 * still an address cold outreach must skip, whatever the record's status.
 *
 * The resemblance tier takes only named organisations. A person's name is not a
 * business name, so "Chris Brooke" must never make the guard warn about a
 * prospect whose owner happens to be called Brooke.
 */
export function buildClientGuard(list: Pick<MasterClientList, "groups">): ClientGuardData {
  const clients: ClientGuardData["clients"] = [];
  const emails: Record<string, number> = {};
  const domains: Record<string, number> = {};
  const names: Record<string, number> = {};
  const signatures: ClientGuardData["signatures"] = [];

  // Biggest customers first (the list is already in that order), so where two
  // clients share a signal the more significant relationship is the one named.
  list.groups.forEach((group) => {
    const i = clients.length;
    clients.push([group.key, group.name, group.flag]);

    for (const email of group.emails) if (!(email in emails)) emails[email] = i;
    for (const domain of group.domains) if (!(domain in domains)) domains[domain] = i;

    // Exact-name keys need no length floor: "accor" === "accor" is that client,
    // however short the word is. Both the canonical name and every raw spelling
    // are indexed, so a prospect scraped as "MBCM - Mitcham" is caught too.
    for (const spelling of [group.name, ...group.aliases]) {
      const key = squash(spelling);
      if (key && !(key in names)) names[key] = i;
    }

    if (group.kind !== "organisation") return;
    const words = signatureWords(group.name);
    if (words.length > 0) signatures.push([words, i]);
  });

  return { clients, emails, domains, names, signatures };
}

/* ─────────────────────────────  matching a lead  ─────────────────────────── */

/** The registrable-ish host of a website cell, which arrives in every shape the
 *  scraper found it in: "https://x.com/au/", "www.x.com", "x.com". */
export function websiteDomain(website: string | null | undefined): string | null {
  const raw = (website ?? "").trim();
  if (!raw) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/^www\./, "");
  return host.includes(".") ? host : null;
}

function hit(
  data: ClientGuardData,
  index: number,
  basis: ClientMatchBasis,
  evidence: string,
  blocked: boolean,
): ClientMatch | null {
  const client = data.clients[index];
  if (!client) return null;
  return {
    clientKey: client[0],
    clientName: client[1],
    clientFlag: client[2],
    basis,
    evidence,
    blocked,
  };
}

/**
 * The one decision. Returns the strongest match, or null when the prospect is
 * genuinely new.
 *
 * Order is most-certain-first and stops at the first hit, so the reason an
 * operator reads is the reason that actually settled it.
 */
export function matchClient(prospect: GuardProspect, data: ClientGuardData): ClientMatch | null {
  const addresses: string[] = [];
  if (prospect.email) addresses.push(prospect.email);
  if (prospect.emails) addresses.push(...prospect.emails);

  // 1 — the same mailbox. Nothing is more certain than this.
  for (const raw of addresses) {
    const email = raw.trim().toLowerCase();
    if (!email) continue;
    const i = data.emails[email];
    if (i !== undefined) return hit(data, i, "email", email, true);
  }

  // 2 — the same mail domain. Free providers and APMG's own domains were left
  // out of the index when it was built, so this can't fire on "gmail.com".
  for (const raw of addresses) {
    const domain = domainOf(raw.trim().toLowerCase());
    if (!domain || !isIdentifyingDomain(domain)) continue;
    const i = data.domains[domain];
    if (i !== undefined) return hit(data, i, "domain", domain, true);
  }

  // 3 — the prospect's website is a client's mail domain.
  const site = websiteDomain(prospect.website);
  if (site && isIdentifyingDomain(site)) {
    const i = data.domains[site];
    if (i !== undefined) return hit(data, i, "website", site, true);
  }

  // 4 — the same business name, exactly.
  const name = (prospect.name ?? "").trim();
  const nameKey = squash(name);
  if (nameKey) {
    const i = data.names[nameKey];
    if (i !== undefined) return hit(data, i, "name", name, true);
  }

  // 5 — resemblance. Every distinctive word of a client's name appears in the
  //     prospect's. A warning only: "Hive Strata Group" reads like the client
  //     "Hive Strata", but so would an unrelated "Hive Fitness".
  if (nameKey) {
    const words = new Set(nameTokens(name));
    if (words.size > 0) {
      for (const [signature, index] of data.signatures) {
        if (signature.every((w) => words.has(w))) {
          return hit(data, index, "resemblance", name, false);
        }
      }
    }
  }

  return null;
}

/** Plain-English reason, used in the send warning and in the server log. */
export function matchReason(match: ClientMatch): string {
  switch (match.basis) {
    case "email":
      return `${match.evidence} is on file for ${match.clientName}`;
    case "domain":
      return `@${match.evidence} is ${match.clientName}'s mail domain`;
    case "website":
      return `${match.evidence} is ${match.clientName}'s domain`;
    case "name":
      return `already on the client list as ${match.clientName}`;
    case "resemblance":
      return `reads like the client ${match.clientName}`;
  }
}

/** One prospect's verdict, carrying whatever identified it. */
export interface GuardedProspect<T> {
  prospect: T;
  match: ClientMatch;
}

/**
 * Split a batch into what may be emailed and what may not.
 *
 * `blocked` is what the send route removes; `warned` stays in the send but is
 * surfaced for a decision. `clear` is everything the guard had nothing to say
 * about.
 */
export function partitionByClientGuard<T extends GuardProspect>(
  prospects: readonly T[],
  data: ClientGuardData,
): { clear: T[]; blocked: Array<GuardedProspect<T>>; warned: Array<GuardedProspect<T>> } {
  const clear: T[] = [];
  const blocked: Array<GuardedProspect<T>> = [];
  const warned: Array<GuardedProspect<T>> = [];

  for (const prospect of prospects) {
    const match = matchClient(prospect, data);
    if (!match) clear.push(prospect);
    else if (match.blocked) blocked.push({ prospect, match });
    else warned.push({ prospect, match });
  }

  return { clear, blocked, warned };
}
