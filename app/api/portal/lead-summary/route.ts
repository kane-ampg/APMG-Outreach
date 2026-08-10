import { bestEmail } from "@/lib/pipeline/campaign";
import { isUuid, requireLiveSupabase, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import {
  CUSTOMER_JOURNEY_EVENTS,
  isMissingColumn,
  isMissingPortalTable,
  portalAdminAuthorized,
} from "@/lib/portal/server";
import {
  buildEngagementFacts,
  buildLeadFacts,
  fallbackSummary,
  type EngagementFacts,
  type LeadSubject,
} from "@/lib/data/enquiryActivity";
import { INQUIRY_STATUSES, type InquiryStatus, type PortalInquiry } from "@/lib/data/enquiries";
import type { LeadActivity, LeadActivityEvent } from "@/lib/data/leadActivity";
import { HANDOFF_EVENT } from "@/lib/sales/handoff";
import { isEnquirySummaryConfigured, summariseEngagement } from "@/lib/ai/enquirySummary";

// POST /api/portal/lead-summary — the "AI Summary" button behind the per-row
// "View" modal, on BOTH desks.
//
//   { inquiryId } → Enquiries. Re-reads that enquiry and (when the enquirer
//                   arrived through a tracked outreach link) their whole portal
//                   click trail.
//   { leadId }    → Sales. Re-reads the LEAD row and its trail. Handed-over
//                   leads have usually never enquired, so the trail is the whole
//                   brief — see lib/data/enquiryActivity for the two subjects.
//
// Either way the rows are reduced to the counted facts the modal itself renders
// (lib/data/enquiryActivity), and Claude writes the short brief a rep reads
// before ringing them (lib/ai/enquirySummary).
//
// WHY THE SERVER RE-READS instead of summarising what the client already has:
// the client's copy is fine for rendering, but a summary is a claim about a
// customer that a rep will repeat on a phone call. Reading the rows here means
// the brief is grounded in the database, not in whatever a request body says —
// a crafted POST can't fabricate a lead's history, and it can't smuggle its own
// text into the prompt (the ONLY untrusted string that reaches the model is the
// enquiry message, straight out of the row, fenced as data — see the module).
//
// SECURITY: same gates as the sibling PII endpoints (/api/portal/inquiries,
// /api/portal/lead-activity) — the sameOrigin (CSRF) floor plus the shared
// PORTAL_ADMIN_KEY secret, deny-by-default when unset. It is also a SPEND
// surface, so the model call sits behind its own key
// (ENQUIRY_SUMMARY_ANTHROPIC_KEY), a per-instance daily cap and a per-lead memo,
// all in lib/ai/enquirySummary. Replace the shared secret with real per-user
// auth when a session lands.
export const runtime = "nodejs";

const TABLE = "portal_inquiries";
const COLS =
  "id,service_slug,service_name,name,email,phone,message,lead_id,business,campaign,category,source,status,created_at";
/** COLS minus `source` — for deploys where the column migration
 *  (supabase/portal-telemetry.sql) hasn't been run yet. Mirrors the listing. */
const LEGACY_COLS = COLS.replace(",source", "");

/** The scraped lead row behind a Sales-queue brief. Same columns
 *  /api/sales/queue reads, minus the ones only the queue card needs. */
const LEAD_TABLE = "leads";
const LEAD_COLS = "id,name,category,website,phone,emails";

/** The one customer-journey allowlist (lib/portal/server), shared with
 *  /api/portal/lead-activity so the modal's trail and the summary's grounding
 *  facts can never disagree with the Telemetry tab. */
const TRAIL_EVENTS = CUSTOMER_JOURNEY_EVENTS;

/** One lead's trail is small; this is a generous ceiling, not a page size. */
const EVENTS_LIMIT = 300;

const UNAUTHORIZED = {
  ok: false as const,
  error: process.env.PORTAL_ADMIN_KEY
    ? "Unauthorised — a valid access key is required."
    : "Unauthorised — set PORTAL_ADMIN_KEY on the server to enable AI summaries.",
};

function restGet(base: string, key: string, pathAndQuery: string): Promise<Response> {
  return fetch(`${base}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
}

/** Lift one string prop out of the raw jsonb (null for absent/non-string). */
function propStr(props: Record<string, unknown> | null, key: string): string | null {
  const v = props ? props[key] : undefined;
  return typeof v === "string" && v ? v : null;
}

/** DB row (snake_case) → the camelCase client shape the facts builder reads. */
function toInquiry(row: Record<string, unknown>): PortalInquiry {
  const status = INQUIRY_STATUSES.includes(row.status as InquiryStatus)
    ? (row.status as InquiryStatus)
    : "new";
  return {
    id: String(row.id ?? ""),
    serviceSlug: String(row.service_slug ?? ""),
    serviceName: typeof row.service_name === "string" ? row.service_name : null,
    name: typeof row.name === "string" ? row.name : null,
    email: String(row.email ?? ""),
    phone: typeof row.phone === "string" ? row.phone : null,
    message: typeof row.message === "string" ? row.message : null,
    leadId: typeof row.lead_id === "string" ? row.lead_id : null,
    business: typeof row.business === "string" ? row.business : null,
    campaign: typeof row.campaign === "string" ? row.campaign : null,
    category: typeof row.category === "string" ? row.category : null,
    source: typeof row.source === "string" && row.source ? row.source : null,
    status,
    createdAt: String(row.created_at ?? ""),
  };
}

type EventRow = {
  event?: unknown;
  props?: Record<string, unknown> | null;
  campaign?: unknown;
  category?: unknown;
  created_at?: unknown;
};

/**
 * Read one lead's trail and shape it exactly like a /api/portal/lead-activity
 * entry, so `buildEngagementFacts` sees the same thing on both paths. Rows
 * arrive newest-first (the index order) and are reversed once at the end —
 * that's what makes firstSeen/lastSeen a plain first/last read.
 *
 * Best-effort: a trail that can't be read yields null, and the summary is
 * written from the enquiry alone rather than the whole call failing.
 */
async function readTrail(
  base: string,
  key: string,
  leadId: string,
  business: string | null,
  category: string | null,
): Promise<LeadActivity | null> {
  const query =
    `portal_events?select=event,props,campaign,category,created_at&lead_id=eq.${leadId}` +
    `&event=in.(${TRAIL_EVENTS.join(",")})&order=created_at.desc&limit=${EVENTS_LIMIT}`;

  let res: Response;
  try {
    res = await restGet(base, key, query);
  } catch (e) {
    console.error("[portal/lead-summary] trail fetch failed:", e);
    return null;
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[portal/lead-summary] trail read ${res.status}:`, detail.slice(0, 500));
    return null;
  }

  const raw = (await res.json().catch(() => [])) as EventRow[];
  const rows = Array.isArray(raw) ? raw : [];

  const newestFirst: LeadActivityEvent[] = [];
  const counts = { emailClicks: 0, portalViews: 0, serviceOpens: 0, inquiries: 0, chatPrompts: 0 };
  let campaign: string | null = null;
  let sector: string | null = category;

  for (const row of rows) {
    if (typeof row?.event !== "string" || typeof row.created_at !== "string") continue;
    if (!(TRAIL_EVENTS as readonly string[]).includes(row.event)) continue;

    if (campaign === null && typeof row.campaign === "string" && row.campaign) campaign = row.campaign;
    if (sector === null && typeof row.category === "string" && row.category) sector = row.category;

    if (row.event === "attribution_click") counts.emailClicks += 1;
    else if (row.event === "portal_view") counts.portalViews += 1;
    else if (row.event === "portal_service_open") counts.serviceOpens += 1;
    else if (row.event === "portal_inquiry") counts.inquiries += 1;
    else if (row.event === "chat_prompt") counts.chatPrompts += 1;

    newestFirst.push({
      event: row.event,
      service: propStr(row.props ?? null, "service"),
      destination: propStr(row.props ?? null, "destination"),
      version:
        propStr(row.props ?? null, "consent_version") ?? propStr(row.props ?? null, "version"),
      ts: row.created_at,
    });
  }

  if (newestFirst.length === 0) return null;

  return {
    leadId,
    business,
    category: sector,
    campaign,
    firstSeen: newestFirst[newestFirst.length - 1].ts,
    lastSeen: newestFirst[0].ts,
    events: newestFirst.reverse(), // → chronological ASC
    counts,
  };
}

/**
 * The Sales-queue subject: the scraped lead row, plus the stamp of when admin
 * handed it to the desk.
 *
 * Deliberately NOT gated on that hand-off existing. This endpoint already sits
 * behind the same shared secret as the sibling PII reads, and admin views leads
 * that were never handed over (Hot Leads) — so a missing stamp just means the
 * "handed over" line is omitted from the brief, not that the read is refused.
 */
async function readLeadSubject(
  base: string,
  key: string,
  leadId: string,
): Promise<LeadSubject | "missing" | "error"> {
  let res: Response;
  try {
    res = await restGet(base, key, `${LEAD_TABLE}?select=${LEAD_COLS}&id=eq.${leadId}&limit=1`);
  } catch (e) {
    console.error("[portal/lead-summary] lead fetch failed:", e);
    return "error";
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[portal/lead-summary] lead read ${res.status}:`, detail.slice(0, 500));
    return "error";
  }
  const rows = (await res.json().catch(() => [])) as Record<string, unknown>[];
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) return "missing";

  // The hand-off stamp is context, not the record — a failed read costs the
  // brief one line rather than the whole summary.
  let handedOverAt: string | null = null;
  try {
    const stampRes = await restGet(
      base,
      key,
      `portal_events?select=created_at&event=eq.${HANDOFF_EVENT}&lead_id=eq.${leadId}` +
        `&order=created_at.asc&limit=1`,
    );
    if (stampRes.ok) {
      const stamps = (await stampRes.json().catch(() => [])) as Array<{ created_at?: unknown }>;
      const at = Array.isArray(stamps) ? stamps[0]?.created_at : null;
      if (typeof at === "string" && at) handedOverAt = at;
    }
  } catch {
    /* best effort — the brief reads fine without it */
  }

  const emails = Array.isArray(row.emails) ? (row.emails as unknown[]).filter((e): e is string => typeof e === "string") : [];
  const site = typeof row.website === "string" ? row.website : null;
  return {
    leadId,
    business: typeof row.name === "string" && row.name ? row.name : null,
    contactName: null,
    email: bestEmail(emails),
    phone: typeof row.phone === "string" && row.phone ? row.phone : null,
    website: site ? site.replace(/^https?:\/\//i, "").replace(/\/+$/, "") || null : null,
    sector: typeof row.category === "string" && row.category ? row.category : null,
    campaign: null,
    handedOverAt,
  };
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const raw = (body as Record<string, unknown> | null) ?? {};
  const inquiryId = raw.inquiryId;
  const leadId = raw.leadId;
  // isUuid also makes the eq. interpolation safe (uuids never need quoting).
  // An enquiry wins when both are sent: it's the richer subject.
  const subject: "enquiry" | "lead" | null = isUuid(inquiryId)
    ? "enquiry"
    : isUuid(leadId)
      ? "lead"
      : null;
  if (!subject) {
    return Response.json(
      { ok: false, error: "A valid enquiry id or lead id is required." },
      { status: 400 },
    );
  }

  const target = supabaseTarget();
  const blocked = requireLiveSupabase("portal/lead-summary");
  if (blocked) return blocked;
  if (target.state === "demo") {
    // Nothing to read (and the demo enquiry ids aren't uuids anyway) — the modal
    // renders its own deterministic summary from the preset instead.
    return Response.json({ ok: true, mode: "demo" });
  }
  if (!portalAdminAuthorized(req)) {
    return Response.json({ ...UNAUTHORIZED, mode: "live" }, { status: 401 });
  }
  if (target.state === "misconfigured") {
    console.error("[portal/lead-summary] SUPABASE_URL is not a valid URL.");
    return Response.json(
      { ok: false, mode: "live", error: "Portal storage is misconfigured." },
      { status: 500 },
    );
  }

  // ── the Sales-queue path: a lead, usually with no enquiry behind it ───────
  if (subject === "lead") {
    const lead = await readLeadSubject(target.base, target.key, leadId as string);
    if (lead === "error") {
      return Response.json(
        { ok: false, mode: "live", error: "Couldn't read the lead." },
        { status: 502 },
      );
    }
    if (lead === "missing") {
      return Response.json(
        { ok: false, mode: "live", error: "That lead no longer exists." },
        { status: 404 },
      );
    }
    const trail = await readTrail(
      target.base,
      target.key,
      lead.leadId,
      lead.business,
      lead.sector,
    );
    const leadFacts = buildLeadFacts(lead, trail);
    const leadResult = await summariseEngagement(leadFacts);
    return Response.json({
      ok: true,
      mode: "live",
      configured: isEnquirySummaryConfigured(),
      summary: leadResult.summary || fallbackSummary(leadFacts),
      source: leadResult.source,
      reason: leadResult.reason,
      cached: leadResult.cached === true,
    });
  }

  // ── the enquiry ───────────────────────────────────────────────────────────
  const one = (cols: string) =>
    restGet(target.base, target.key, `${TABLE}?select=${cols}&id=eq.${inquiryId}&limit=1`);

  let res: Response;
  try {
    res = await one(COLS);
    // Pre-migration deploys have no `source` column — retry without it rather
    // than failing the summary over a field it barely uses.
    if (!res.ok) {
      const detail = await res.clone().text().catch(() => "");
      if (isMissingColumn(detail)) res = await one(LEGACY_COLS);
    }
  } catch (e) {
    console.error("[portal/lead-summary] enquiry fetch failed:", e);
    return Response.json(
      { ok: false, mode: "live", error: "Could not reach the database." },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[portal/lead-summary] Supabase ${res.status}:`, detail.slice(0, 1000));
    if (isMissingPortalTable(res.status, detail)) {
      return Response.json({ ok: true, mode: "demo", needsMigration: true });
    }
    return Response.json(
      { ok: false, mode: "live", error: "Couldn't read the enquiry." },
      { status: 502 },
    );
  }

  const rows = (await res.json().catch(() => [])) as Record<string, unknown>[];
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    return Response.json(
      { ok: false, mode: "live", error: "That enquiry no longer exists." },
      { status: 404 },
    );
  }
  const inquiry = toInquiry(row);

  // ── the trail (attributed enquirers only) ────────────────────────────────
  const activity = isUuid(inquiry.leadId)
    ? await readTrail(target.base, target.key, inquiry.leadId, inquiry.business, inquiry.category)
    : null;

  const facts: EngagementFacts = buildEngagementFacts(inquiry, activity);

  // ── the brief ─────────────────────────────────────────────────────────────
  // With no key configured this returns the deterministic summary rather than an
  // error, so the button is never a dead end on a deploy that hasn't set one.
  const result = await summariseEngagement(facts);

  return Response.json({
    ok: true,
    mode: "live",
    configured: isEnquirySummaryConfigured(),
    summary: result.summary || fallbackSummary(facts),
    source: result.source,
    reason: result.reason,
    cached: result.cached === true,
  });
}
