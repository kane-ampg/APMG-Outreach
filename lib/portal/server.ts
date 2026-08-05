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
 * Operator-browser marker. middleware.ts drops this cookie on any browser that
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
 * by middleware.ts when a /portal visit carries ?utm_source= or a social
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
