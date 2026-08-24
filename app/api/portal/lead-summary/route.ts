import { isUuid, requireLiveSupabase, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import {
  isMissingColumn,
  isMissingPortalTable,
  portalAdminAuthorized,
} from "@/lib/portal/server";
import { readLeadSubject, readTrail, restGet } from "@/lib/portal/leadBrief";
import {
  buildEngagementFacts,
  buildLeadFacts,
  fallbackSummary,
  type EngagementFacts,
} from "@/lib/data/enquiryActivity";
import { INQUIRY_STATUSES, type InquiryStatus, type PortalInquiry } from "@/lib/data/enquiries";
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

/** Log prefix for this route, passed to the shared brief readers. */
const LOG = "portal/lead-summary";

const TABLE = "portal_inquiries";
const COLS =
  "id,service_slug,service_name,name,email,phone,message,lead_id,business,campaign,category,source,status,created_at";
/** COLS minus `source` — for deploys where the column migration
 *  (supabase/portal-telemetry.sql) hasn't been run yet. Mirrors the listing. */
const LEGACY_COLS = COLS.replace(",source", "");

const UNAUTHORIZED = {
  ok: false as const,
  error: process.env.PORTAL_ADMIN_KEY
    ? "Unauthorised — a valid access key is required."
    : "Unauthorised — set PORTAL_ADMIN_KEY on the server to enable AI summaries.",
};

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
    // Nothing to read (and the demo enquiry ids aren't uuids anyway). The modal
    // already renders fallbackSummary() locally from the facts it has and never
    // calls this route while `demo` is true — this response only matters if
    // something hits the route directly.
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
    const lead = await readLeadSubject(target.base, target.key, leadId as string, LOG);
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
      LOG,
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
    ? await readTrail(
        target.base,
        target.key,
        inquiry.leadId,
        inquiry.business,
        inquiry.category,
        LOG,
      )
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
