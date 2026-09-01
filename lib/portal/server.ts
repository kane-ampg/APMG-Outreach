import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { isUuid } from "@/lib/pipeline/server";
import { normalizeSource, SOURCE_COOKIE } from "@/lib/portal/source";

// Server-only helpers shared by the client-portal API routes (/api/portal/*)
// and the /t/[id] attribution redirect. Same house rules as lib/pipeline/server:
// raw PostgREST fetch with the SERVICE ROLE key, server-side only, and every
// helper degrades to null/false instead of throwing so telemetry can never take
// a customer-facing surface down.

/** Enquiry workflow states, in lifecycle order. The list is the single source
 *  of truth for the PATCH validator and the admin status select. */
export const INQUIRY_STATUSES = ["new", "contacted", "closed"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

/** One row bound for public.portal_events (snake_case = the table's columns).
 *  Only `event` + `props` are required — the attribution/context columns are
 *  filled in by whichever route builds the row. */
export interface PortalEventRow {
  event: string;
  props: Record<string, string>;
  view?: string | null;
  lead_id?: string | null;
  campaign?: string | null;
  category?: string | null;
  visitor_id?: string | null;
  ua?: string | null;
  referer?: string | null;
  /** browser time of the event, ISO string (null when untrusted/absent) */
  client_ts?: string | null;
}

/** Client-facing (camelCase) shape of one portal enquiry, as returned by
 *  GET /api/portal/inquiries and consumed by the admin Enquiries tab. */
export interface PortalInquiry {
  id: string;
  serviceSlug: string;
  serviceName: string | null;
  name: string | null;
  email: string;
  phone: string | null;
  message: string | null;
  leadId: string | null;
  business: string | null;
  campaign: string | null;
  category: string | null;
  /** Traffic source the enquirer arrived from (apmg_src cookie — utm_source
   *  on the promoted portal link / social Referer): "tiktok", "facebook",
   *  "instagram", … Null = no tagged visit (outreach or direct). */
  source: string | null;
  status: InquiryStatus;
  /** The legal-docs version the enquirer agreed to when submitting (null on
   *  rows created before the consent gate / from a pre-migration schema). */
  consentVersion: string | null;
  createdAt: string;
}

/* ── Lead activity (admin Telemetry tab) — GET /api/portal/lead-activity ──
   Shared camelCase shapes so the route and the TelemetryPage UI (and its demo
   dataset in lib/data/leadActivity.ts) agree on one contract. Types only —
   client code must `import type` these (this module is server-only). */

/** One step in a lead's click trail. `service` / `destination` are lifted out
 *  of the raw props jsonb server-side so the UI never touches event props. */
export interface LeadActivityEvent {
  /** raw event name, e.g. "attribution_click", "portal_service_open" */
  event: string;
  /** service slug from props.service (portal_service_open / portal_inquiry) */
  service: string | null;
  /** redirect target from props.destination (attribution_click) — lets the UI
   *  tell a PDF download apart from a plain email-link click */
  destination: string | null;
  /** accepted legal version from props.consent_version / props.version
   *  (portal_consent_accept / legal_ack) — absent on every other event */
  version?: string | null;
  /** server-side created_at, ISO */
  ts: string;
}

/** Funnel tallies for one lead. Counted over the whole fetched event window —
 *  the visible `events` timeline is capped separately — and `inquiries` counts
 *  the server-canonical `portal_inquiry` rows only (never the client-side
 *  `portal_inquiry_submit` duplicate). */
export interface LeadActivityCounts {
  emailClicks: number;
  portalViews: number;
  serviceOpens: number;
  inquiries: number;
  /** questions asked of the portal assistant — one per `chat_prompt` ledger
   *  row (lib/portal/chatQuota). Content-free: the ledger stores the message
   *  LENGTH only, so this measures research effort, never what was typed. */
  chatPrompts: number;
}

/** Everything one attributed lead (someone who clicked the tracked outreach
 *  link) did across the portal, ready to render as a timeline row. */
export interface LeadActivity {
  leadId: string;
  /** leads.name at read time; null when the lead has been deleted/reimported */
  business: string | null;
  /** sector: denormalized event category first (survives lead deletion),
   *  falling back to the live leads row */
  category: string | null;
  /** most recent non-null campaign slug seen on this lead's events */
  campaign: string | null;
  firstSeen: string;
  lastSeen: string;
  /** chronological ASC; capped to the MOST RECENT 50 events */
  events: LeadActivityEvent[];
  counts: LeadActivityCounts;
}

/** Aggregate block for portal visitors with NO attribution cookie (typed the
 *  URL, forwarded link, cookie expired…) — too anonymous for a timeline each,
 *  still worth a headline count. */
export interface AnonymousPortalActivity {
  /** distinct non-null visitor_id values (localStorage id from the client) */
  visitors: number;
  /** portal-relevant anonymous events in the window */
  events: number;
  /** most-opened service cards, desc, top 6 */
  topServices: Array<{ service: string; opens: number }>;
}

/** One recorded opt-out (an `email_suppression` row) — the people the send
 *  route will never mail again. Keyed by address, because that's what the
 *  Spam Act opt-out attaches to; `leadId`/`business` are context the
 *  unsubscribe link happened to carry, and are null for a bare-address row. */
export interface UnsubscribedPerson {
  email: string;
  /** leads.name for `leadId` at read time; null when the link carried no lead
   *  id, or that lead has since been deleted/reimported */
  business: string | null;
  /** sector, from the same leads lookup as `business` */
  category: string | null;
  leadId: string | null;
  campaign: string | null;
  /** email_suppression.reason — "unsubscribe" for every self-service opt-out */
  reason: string;
  createdAt: string;
}

/** Full GET /api/portal/lead-activity response. `needsMigration` rides along
 *  with mode "demo" when the portal tables don't exist yet, so the UI can say
 *  "run supabase/portal-telemetry.sql" instead of showing demo data silently. */
export interface LeadActivityResponse {
  ok: boolean;
  mode: "live" | "demo";
  needsMigration?: boolean;
  error?: string;
  leads: LeadActivity[];
  anonymous: AnonymousPortalActivity;
  /** newest-first, capped — see MAX_UNSUBSCRIBES in the route */
  unsubscribes: UnsubscribedPerson[];
  /** exact row count (count=exact), so the KPI stays honest past the cap */
  unsubscribesTotal: number;
  /** false when the opt-out list couldn't be read at all — its migration
   *  (supabase/unsubscribe.sql) is separate from the portal tables, so a
   *  missing table must read as "unknown", never as "nobody opted out" */
  unsubscribesAvailable: boolean;
}

/**
 * The customer-journey contract names — the ONLY `portal_events` rows that may
 * enter an attributed lead's trail.
 *
 * Attributed rows are not customer-side by construction: the /t/[id] redirect
 * sets the long-lived apmg_ref cookie on THIS origin, so an operator who
 * test-clicks a tracked outreach link stamps that lead's uuid onto every
 * dashboard click they make from then on. Anything outside this list is internal
 * click noise, not lead activity.
 *
 * Shared by both readers — /api/portal/lead-activity (every lead, for Telemetry
 * and Hot Leads) and /api/portal/lead-summary (one lead, for the Enquiries
 * modal + its AI summary) — so the two can never drift into telling different
 * stories about the same lead. `portal_inquiry_submit` is deliberately absent:
 * it's the client-side duplicate of the server-canonical `portal_inquiry`, and
 * one submission must read as one event.
 */
export const CUSTOMER_JOURNEY_EVENTS = [
  "attribution_click",
  "portal_view",
  "portal_service_open",
  "portal_inquiry",
  // Consent trail: `legal_ack` = the page-entry gate ack (client-emitted,
  // portal-only); `portal_consent_accept` = the validated enquiry-form consent
  // (server-emitted, reserved name).
  "legal_ack",
  "portal_consent_accept",
  // Portal-assistant questions (lib/portal/chatQuota's durable quota ledger,
  // server-emitted + reserved). Content-free by design — the ledger stores the
  // message LENGTH only, so a trail gains "they were researching before they
  // enquired" and never any of what they typed.
  "chat_prompt",
] as const;

/** Header the admin Enquiries tab sends its access key in. */
export const PORTAL_ADMIN_KEY_HEADER = "x-portal-admin-key";

/**
 * Shared-secret gate for the enquiry listing/status endpoints until real auth
 * lands. The listing contains visitor names, emails and phone numbers, and the
 * portal deliberately sends external strangers to this origin — so PII reads
 * must NOT ship publicly behind the sameOrigin (CSRF-only) floor.
 *
 * Deny-by-default: when PORTAL_ADMIN_KEY is unset the gate REFUSES live-mode
 * access rather than silently opening up (demo mode has no stored PII and is
 * handled by the callers before this check). Comparison is constant-time.
 */
export function portalAdminAuthorized(req: NextRequest | Request): boolean {
  const expected = process.env.PORTAL_ADMIN_KEY;
  if (!expected) return false;
  const supplied = req.headers.get(PORTAL_ADMIN_KEY_HEADER) ?? "";
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Operator-browser marker. proxy.ts drops this cookie on any browser that
 * loads an admin dashboard page (a surface customer hosts never serve), and the
 * telemetry writers check it so the operator clicking around their OWN app —
 * including test-clicking tracked /t/ links and previewing /portal — can never
 * pollute lead trails, funnel totals, or the anonymous-visitor rollup. The
 * client-journey data must be from clients only.
 */
export const INTERNAL_COOKIE = "apmg_internal";

/** True when the request comes from a browser marked internal (see above).
 *  Parsed off the raw Cookie header, same approach as readAttribution. */
export function isInternalRequest(req: NextRequest | Request): boolean {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== INTERNAL_COOKIE) continue;
    return part.slice(eq + 1).trim() !== "";
  }
  return false;
}

/**
 * NON-HUMAN TRAFFIC IS NOT LEAD ACTIVITY. Outreach emails are auto-scanned
 * before the recipient ever sees them: Microsoft Defender / Safe Links, Google,
 * Barracuda, Proofpoint and friends fetch every link in a message to sandbox it
 * — so a tracked /t/ link (and the portal page it lands on) gets hit by a bot
 * seconds after send, with no human involved. Recording those as
 * `attribution_click` / `portal_view` falsely flips the lead's "Engaged" badge
 * and lights the Telemetry trail for a click that never happened. It also
 * catches scripted probes (curl, python-requests, headless crawlers) and the
 * scanners' own agent strings. Matched on User-Agent — coarse but exactly the
 * signal these clients advertise, and the same fingerprint that identified the
 * junk rows we purged from portal_events.
 *
 * Conservative by construction: it matches only unmistakable non-browser /
 * scanner agents, so a real Chrome/Safari/Edge/Firefox click is never dropped.
 * A missing UA is treated as a bot too — every real browser sends one, and the
 * only clients that omit it here were scripted.
 */
const BOT_UA_RE =
  /bot|crawl|spider|slurp|scan(?:ner)?|probe|preview|fetch|monitor|curl|wget|python-requests|python-urllib|okhttp|axios|node-fetch|libwww|httpclient|java\/|go-http|ruby|headless|phantom|puppeteer|playwright|selenium|lighthouse|facebookexternalhit|whatsapp|telegrambot|slackbot|discordbot|bingpreview|proofpoint|barracuda|mimecast|safelinks|microsoft|defender|forcepoint|symantec|cloudmark|antispam/i;

/** True when the request's User-Agent looks like a bot / link-scanner / script
 *  rather than a human's browser (see BOT_UA_RE). The telemetry writers skip
 *  these so automated link-fetching can never masquerade as a real prospect. */
export function isBotRequest(req: NextRequest | Request): boolean {
  const ua = req.headers.get("user-agent");
  if (!ua || !ua.trim()) return true; // no UA at all → scripted, never a browser
  return BOT_UA_RE.test(ua);
}

/** Longest campaign slug we'll store — anything beyond this is a crafted URL,
 *  not a real campaign name. */
const MAX_CAMPAIGN_LEN = 120;

/**
 * Read the visitor's attribution cookies: `apmg_ref` (the lead uuid, httpOnly)
 * and `apmg_ref_campaign` dropped by the /t/[id] outreach redirect, plus
 * `apmg_src` — the traffic source (tiktok / facebook / instagram / …) dropped
 * by proxy.ts when a /portal visit carries ?utm_source= or a social
 * Referer. Parsed straight off the Cookie header so it works for both
 * NextRequest and the plain Request the route handlers get. The lead id is
 * only trusted when it's a well-formed uuid — the cookie value ends up
 * interpolated into PostgREST filters downstream — and the source is
 * re-normalized so a hand-crafted cookie can't smuggle arbitrary text into
 * events and reports.
 */
export function readAttribution(req: NextRequest | Request): {
  leadId: string | null;
  campaign: string | null;
  source: string | null;
} {
  const header = req.headers.get("cookie") ?? "";
  let leadId: string | null = null;
  let campaign: string | null = null;
  let source: string | null = null;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name !== "apmg_ref" && name !== "apmg_ref_campaign" && name !== SOURCE_COOKIE) continue;

    let value = part.slice(eq + 1).trim();
    try {
      value = decodeURIComponent(value); // cookies.set percent-encodes values
    } catch {
      /* malformed escape — keep the raw value */
    }

    if (name === "apmg_ref") {
      if (isUuid(value)) leadId = value;
    } else if (name === SOURCE_COOKIE) {
      source = normalizeSource(value);
    } else if (value) {
      campaign = value.slice(0, MAX_CAMPAIGN_LEN);
    }
  }

  return { leadId, campaign, source };
}

/**
 * Fetch the lead a visitor was attributed to, for denormalizing name/category
 * onto telemetry rows (leads get reimported/deleted, so we snapshot at insert
 * time instead of joining). Null on ANY miss/error — attribution enrichment is
 * best-effort and must never fail a request.
 */
export async function lookupLead(
  base: string,
  key: string,
  leadId: string,
): Promise<{ name: string | null; category: string | null } | null> {
  if (!isUuid(leadId)) return null; // belt & braces: never interpolate a non-uuid
  try {
    const res = await fetch(
      `${base}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}&select=name,category&limit=1`,
      {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json().catch(() => [])) as Array<{
      name?: unknown;
      category?: unknown;
    }>;
    const row = Array.isArray(rows) ? rows[0] : undefined;
    if (!row) return null;
    return {
      name: typeof row.name === "string" && row.name ? row.name : null,
      category: typeof row.category === "string" && row.category ? row.category : null,
    };
  } catch {
    return null;
  }
}

/**
 * Insert fully-built rows into portal_events. Returns false (and logs) on any
 * failure — callers decide whether that matters (the beacon sink shrugs, the
 * enquiry route treats its canonical event as best-effort).
 */
export async function insertPortalEvents(
  base: string,
  key: string,
  rows: PortalEventRow[],
): Promise<boolean> {
  if (rows.length === 0) return true;
  try {
    const res = await fetch(`${base}/rest/v1/portal_events`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (res.ok) return true;
    const detail = await res.text().catch(() => "");
    console.error(`[portal] portal_events insert ${res.status}:`, detail.slice(0, 500));
    return false;
  } catch (e) {
    console.error("[portal] portal_events insert failed:", e);
    return false;
  }
}

/** True when a PostgREST error means a portal table doesn't exist yet — i.e.
 *  supabase/portal-telemetry.sql hasn't been run. The read routes degrade to
 *  demo mode on this so the admin page shows the "run the migration" banner
 *  instead of a hard error. */
export function isMissingPortalTable(status: number, detail: string): boolean {
  return status === 404 || /find the table|PGRST205/i.test(detail);
}

/** True when a PostgREST error means a COLUMN is missing from an existing
 *  table — i.e. the table pre-dates a migration that added one (inserts hit
 *  the schema cache as PGRST204, selects as undefined_column 42703). Callers
 *  retry without the new column so a not-yet-run migration can only ever cost
 *  the new field, never the row: an enquiry must not be lost over an
 *  analytics column. */
export function isMissingColumn(detail: string): boolean {
  return /PGRST204|42703|column .+ does not exist|Could not find the .+ column/i.test(detail);
}

/** The send-ledger event name (portal_events). Kept in sync with
 *  /api/pipeline/campaigns/send, which writes one row per delivered recipient. */
const SENT_EVENT = "email_sent";

/**
 * Count how many outreach emails have been sent to each of the given leads, by
 * tallying the `email_sent` ledger rows in portal_events (one row per delivered
 * recipient — see /api/pipeline/campaigns/send). Returns a leadId → count map;
 * leads with no sends are simply absent (treat as 0). Degrades to an EMPTY map
 * on any error / missing table — the count is a nice-to-have column and must
 * never fail the leads read. Only well-formed uuids are queried (the ids get
 * interpolated into a PostgREST filter).
 */
export async function countEmailsSentByLead(
  base: string,
  key: string,
  leadIds: string[],
): Promise<Map<string, number>> {
  const ids = [...new Set(leadIds.filter(isUuid))];
  const counts = new Map<string, number>();
  if (ids.length === 0) return counts;
  // Chunk the id list so a large folder doesn't build an over-long request URL.
  const CHUNK = 200;
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      // Fetch just the lead_id of every email_sent row for these leads, then
      // tally client-side (PostgREST has no plain GROUP BY over REST). One row
      // per send, scoped to the ids on screen.
      const inList = chunk.join(",");
      const res = await fetch(
        `${base}/rest/v1/portal_events?select=lead_id&event=eq.${SENT_EVENT}&lead_id=in.(${inList})`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" },
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        if (!isMissingPortalTable(res.status, detail)) {
          console.error(`[portal] email_sent tally ${res.status}:`, detail.slice(0, 300));
        }
        // A missing table (or any error) → give up on the whole tally; the
        // column just renders as "not sent" everywhere.
        return new Map();
      }
      const rows = (await res.json().catch(() => [])) as Array<{ lead_id?: unknown }>;
      for (const r of rows) {
        if (typeof r.lead_id === "string") {
          counts.set(r.lead_id, (counts.get(r.lead_id) ?? 0) + 1);
        }
      }
    }
    return counts;
  } catch (e) {
    console.error("[portal] email_sent tally failed:", e);
    return new Map();
  }
}

/* ── Email suppression / unsubscribe (supabase/unsubscribe.sql) ─────────────
   Keyed by lowercased email so an opt-out survives lead re-imports. The
   unsubscribe endpoint records rows; the send route filters against them so we
   never email someone who opted out (Spam Act 2003). Every helper degrades to a
   safe default rather than throwing. */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Is this address one we could plausibly have mailed?
 *
 * WHY THIS EXISTS. On 2026-08-25/26 the suppression list went from 2 rows to 44
 * in about a day. Almost all of the new rows carried scrambled local parts on
 * real prospect domains (`vaab@windsorccc.org.au`, `jlbzvat@firstgrammar.com.au`)
 * under a campaign tag — `bhgefbdu-5359` — that has never sent a single email.
 * Something was walking the tracked links and detonating the unsubscribe
 * behind them with mangled parameters, and the endpoint wrote every one.
 *
 * The `email_sent` ledger does not store the recipient address, so "did we mail
 * this?" cannot be answered directly. What CAN be answered is "is this an
 * address we hold for this lead" — every real recipient came from `leads.emails`.
 *
 * Advisory, never a gate. A false negative here must not swallow a real
 * person's opt-out, so the caller logs an unverified human request and records
 * it anyway; this only exists so a machine-generated address is recognisable.
 */
export async function isKnownRecipient(
  base: string,
  key: string,
  email: string,
  leadId?: string | null,
): Promise<boolean> {
  const addr = email.trim().toLowerCase();
  if (!EMAIL_RE.test(addr)) return false;
  const headers = { apikey: key, Authorization: `Bearer ${key}` };

  try {
    // Lead-scoped: the overwhelmingly common shape, and exact. Compared in JS
    // so stored casing ("Alicia.Goddard@…") still matches.
    if (leadId && isUuid(leadId)) {
      const res = await fetch(
        `${base}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}&select=emails&limit=1`,
        { headers, cache: "no-store" },
      );
      if (res.ok) {
        const rows = (await res.json()) as { emails: string[] | null }[];
        const held = rows[0]?.emails ?? [];
        if (held.some((e) => String(e).trim().toLowerCase() === addr)) return true;
      }
    }

    // No lead id (or the lead didn't hold it): does ANY lead hold this address?
    const res = await fetch(
      `${base}/rest/v1/leads?select=id&emails=cs.${encodeURIComponent(JSON.stringify([addr]))}&limit=1`,
      { headers, cache: "no-store" },
    );
    if (!res.ok) return false;
    return ((await res.json()) as unknown[]).length > 0;
  } catch {
    // Network/DB trouble must never make a real opt-out look forged.
    return false;
  }
}

/**
 * ROT13 the LOCAL PART of an address, leaving the domain untouched.
 *
 * Not cryptography — the exact transform a link-rewriting mail gateway applies
 * to the query string of a URL it walks. `vaab@windsorccc.org.au`,
 * `jlbzvat@firstgrammar.com.au` and
 * `avgmeblabegu.faebyzfagf@saints.vic.edu.au` are all real rows it produced;
 * the domain in each is genuine and only the local part came back rotated.
 */
export function rot13Local(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const local = email.slice(0, at);
  if (!/[a-z]/i.test(local)) return null;
  const rotated = local.replace(/[a-z]/gi, (c) => {
    const base = c <= "Z" ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
  return rotated + email.slice(at);
}

/**
 * The scanner-rewrite tell: an address held on NO lead whose ROT13 IS held on
 * one. A person's mail client sends the address exactly as we wrote it into the
 * link, so a rotated local part can only come from something rewriting the URL
 * in transit. Returns the REAL address behind the rewrite, or null when this
 * isn't one (which is every ordinary opt-out — the check costs one lookup and
 * only ever runs on an address we don't recognise).
 *
 * Deliberately narrow. It fires only when the decoded form matches a lead we
 * actually hold, so a genuine opt-out from an address our data has gone stale
 * on can never trip it.
 */
export async function rewrittenRecipient(
  base: string,
  key: string,
  email: string,
): Promise<string | null> {
  const decoded = rot13Local(email.trim().toLowerCase());
  if (!decoded || decoded === email.trim().toLowerCase()) return null;
  return (await isKnownRecipient(base, key, decoded)) ? decoded : null;
}

/** Record an opt-out (idempotent upsert on lower(email)). Returns "ok",
 *  "needs_migration" when the table is absent, or "error" on anything else —
 *  the endpoint still shows the customer a success page regardless, but a
 *  non-ok result is logged so a broken suppression list can't hide. */
export async function recordUnsubscribe(
  base: string,
  key: string,
  email: string,
  ctx?: { leadId?: string | null; campaign?: string | null },
): Promise<"ok" | "needs_migration" | "error"> {
  const addr = email.trim().toLowerCase();
  if (!EMAIL_RE.test(addr)) return "error";
  const row = {
    email: addr,
    lead_id: ctx?.leadId && isUuid(ctx.leadId) ? ctx.leadId : null,
    campaign: ctx?.campaign ? ctx.campaign.slice(0, MAX_CAMPAIGN_LEN) : null,
    reason: "unsubscribe",
  };
  try {
    // Upsert so a second click can't 409 on the unique index.
    const res = await fetch(
      `${base}/rest/v1/email_suppression?on_conflict=email`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(row),
      },
    );
    if (res.ok) return "ok";
    const detail = await res.text().catch(() => "");
    if (isMissingPortalTable(res.status, detail)) return "needs_migration";
    console.error(`[portal] suppression insert ${res.status}:`, detail.slice(0, 500));
    return "error";
  } catch (e) {
    console.error("[portal] suppression insert failed:", e);
    return "error";
  }
}

/** Return the subset of `emails` that have opted out (lowercased). On ANY error
 *  or a missing table this returns an EMPTY set — i.e. it fails OPEN so a broken
 *  lookup never silently blocks a legitimate send. The migration must therefore
 *  be run before real sends; the send route surfaces that separately. */
export async function fetchSuppressedEmails(
  base: string,
  key: string,
  emails: string[],
): Promise<Set<string>> {
  const wanted = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))];
  if (wanted.length === 0) return new Set();
  try {
    // PostgREST in.() list; emails are validated above so the interpolation is
    // limited to address characters. Quote each to be safe with '+' etc.
    const inList = wanted.map((e) => `"${e.replace(/"/g, "")}"`).join(",");
    const res = await fetch(
      `${base}/rest/v1/email_suppression?select=email&email=in.(${encodeURIComponent(inList)})`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (!isMissingPortalTable(res.status, detail)) {
        console.error(`[portal] suppression lookup ${res.status}:`, detail.slice(0, 300));
      }
      return new Set();
    }
    const rows = (await res.json().catch(() => [])) as Array<{ email?: unknown }>;
    const out = new Set<string>();
    for (const r of rows) {
      if (typeof r.email === "string") out.add(r.email.trim().toLowerCase());
    }
    return out;
  } catch (e) {
    console.error("[portal] suppression lookup failed:", e);
    return new Set();
  }
}

/**
 * Mailbox providers where an address says nothing about the organisation behind
 * it. An opt-out from `someone@gmail.com` must never mute every other Gmail
 * address in the list, so these are excluded from the domain rollup below.
 */
const SHARED_MAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "outlook.com.au", "hotmail.com",
  "hotmail.com.au", "live.com", "live.com.au", "msn.com", "yahoo.com",
  "yahoo.com.au", "y7mail.com", "icloud.com", "me.com", "mac.com", "aol.com",
  "protonmail.com", "proton.me", "gmx.com", "mail.com", "zoho.com",
  "bigpond.com", "bigpond.net.au", "optusnet.com.au", "iinet.net.au",
  "tpg.com.au", "internode.on.net", "westnet.com.au", "dodo.com.au",
  "adam.com.au", "exemail.com.au", "ozemail.com.au", "netspace.net.au",
  "aussiebroadband.com.au", "spin.net.au", "hotkey.net.au",
]);

/** Only ever `[a-z0-9.-]`, so the value is safe to splice into a PostgREST
 *  filter. Returns null for a public provider or an unparseable address. */
export function organisationDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(domain)) return null;
  if (SHARED_MAIL_DOMAINS.has(domain)) return null;
  return domain;
}

/**
 * Domain-level opt-outs: for each ORGANISATION domain in `emails`, the address
 * at that domain that has already unsubscribed, if any.
 *
 * WHY THIS EXISTS. `fetchSuppressedEmails` matches one exact address, so a
 * second address at a business that already opted out sails straight through.
 * On 2026-08-30 that was live: `maidengully@jennyselc.com.au` unsubscribed on
 * 25 Aug, and `info@jennyselc.com.au` — the same small childcare business — was
 * still the top of the never-emailed queue. The Spam Act opt-out attaches to
 * the person's request, not to the string they happened to send it from, and a
 * multi-branch prospect (aged care groups, childcare chains, school networks) is
 * exactly who this list is made of.
 *
 * Public mailbox providers are excluded (see SHARED_MAIL_DOMAINS) — one Gmail
 * opt-out must not mute every other Gmail address in the batch.
 *
 * Fails OPEN (empty map) on any error or a missing table, exactly like its
 * sibling: a broken lookup must never block a legitimate send.
 */
export async function fetchSuppressedDomains(
  base: string,
  key: string,
  emails: string[],
): Promise<Map<string, string>> {
  const domains = [...new Set(emails.map((e) => organisationDomain(e.trim().toLowerCase())).filter(Boolean) as string[])];
  if (domains.length === 0) return new Map();
  try {
    // or=(email.ilike.*@a.com,email.ilike.*@b.com) — domains are validated to
    // [a-z0-9.-] above, so neither a comma nor a paren can reach this filter.
    const or = `(${domains.map((d) => `email.ilike.*@${d}`).join(",")})`;
    const res = await fetch(
      `${base}/rest/v1/email_suppression?select=email&or=${encodeURIComponent(or)}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (!isMissingPortalTable(res.status, detail)) {
        console.error(`[portal] domain suppression lookup ${res.status}:`, detail.slice(0, 300));
      }
      return new Map();
    }
    const rows = (await res.json().catch(() => [])) as Array<{ email?: unknown }>;
    const out = new Map<string, string>();
    for (const r of rows) {
      if (typeof r.email !== "string") continue;
      const address = r.email.trim().toLowerCase();
      const domain = organisationDomain(address);
      // ilike is a suffix match, so re-check the domain is one we asked about —
      // never let "@notjennyselc.com.au" answer for "@jennyselc.com.au".
      if (domain && domains.includes(domain) && !out.has(domain)) out.set(domain, address);
    }
    return out;
  } catch (e) {
    console.error("[portal] domain suppression lookup failed:", e);
    return new Map();
  }
}


/* ── Scanner-click suppression (/t/[id]) ─────────────────────────────────
   isBotRequest (above) matches on User-Agent only, so a scanner that presents
   a normal browser string sails through it. These two signals catch what the
   UA misses without touching the UA filter itself: classifyClick is the pure
   decision (testable, never reads the clock), readClickHistory is the I/O
   that feeds it. */

/**
 * A human cannot receive an email, open it, read it and click inside this
 * window. A hit that fast is an automated scanner that got past the
 * User-Agent filter by presenting a browser string.
 */
export const SCANNER_WINDOW_MS = 10_000;

/** Repeat hits on the same tracked link inside this window are one visit —
 *  a preloading browser, a double tap, a client that retries the redirect. */
export const CLICK_DEDUPE_MS = 60_000;

/**
 * Decide whether a tracked-link hit is real lead activity. Pure: the caller
 * supplies the clock and the two timestamps, so this is fully testable and
 * the redirect path stays the only place that does I/O.
 *
 * A future-dated send is ignored rather than treated as suspicious — clock
 * skew between the automation and this app must not silently drop real clicks.
 */
export function classifyClick(opts: {
  nowMs: number;
  lastSentMs: number | null;
  lastClickMs: number | null;
}): "record" | "too-fast" | "duplicate" {
  const { nowMs, lastSentMs, lastClickMs } = opts;
  if (lastSentMs !== null && lastSentMs <= nowMs && nowMs - lastSentMs < SCANNER_WINDOW_MS) {
    return "too-fast";
  }
  if (lastClickMs !== null && lastClickMs <= nowMs && nowMs - lastClickMs < CLICK_DEDUPE_MS) {
    return "duplicate";
  }
  return "record";
}

/** Most recent email_sent and attribution_click timestamps for one lead.
 *  Both null on any failure — an unreadable history must never cost a real
 *  lead their recorded click. */
export async function readClickHistory(
  base: string,
  key: string,
  leadId: string,
): Promise<{ lastSentMs: number | null; lastClickMs: number | null }> {
  if (!isUuid(leadId)) return { lastSentMs: null, lastClickMs: null };
  const latest = async (event: string): Promise<number | null> => {
    try {
      const res = await fetch(
        `${base}/rest/v1/portal_events?select=created_at&lead_id=eq.${encodeURIComponent(leadId)}` +
          `&event=eq.${event}&order=created_at.desc&limit=1`,
        {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          cache: "no-store",
          // A hung PostgREST connection must not stall the customer's redirect
          // (this runs inline in /t/[id] before the 302). Any abort lands in the
          // catch below and reads as "unknown" — classifyClick's null,null case
          // still records the click, so a timeout never drops a real one.
          signal: AbortSignal.timeout(2_000),
        },
      );
      if (!res.ok) return null;
      const rows = (await res.json().catch(() => [])) as Array<{ created_at?: string }>;
      const ts = Array.isArray(rows) && rows[0]?.created_at ? Date.parse(rows[0].created_at) : NaN;
      return Number.isFinite(ts) ? ts : null;
    } catch {
      return null;
    }
  };
  const [lastSentMs, lastClickMs] = await Promise.all([latest("email_sent"), latest("attribution_click")]);
  return { lastSentMs, lastClickMs };
}
