import { isUuid, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import {
  CUSTOMER_JOURNEY_EVENTS,
  isMissingPortalTable,
  portalAdminAuthorized,
  type AnonymousPortalActivity,
  type LeadActivity,
  type LeadActivityCounts,
  type LeadActivityEvent,
} from "@/lib/portal/server";

// GET /api/portal/lead-activity — the per-lead click stream behind the admin
// Telemetry tab: for every ATTRIBUTED lead (someone who clicked the tracked
// outreach link, so their portal_events rows carry lead_id) the chronological
// trail of what they did — email click → PDF download → portal view → service
// opens → enquiry — plus one aggregate block for anonymous portal visitors.
// Grouped here in the route (two bounded PostgREST GETs + one leads lookup)
// rather than in SQL, the same trade-off as /api/portal/summary — at portal
// traffic volumes that's plenty, and it keeps every read in this repo a plain
// PostgREST fetch. Server-side (keeps the service role key off the browser).
//
// SECURITY — unlike /api/portal/summary (pure aggregates), this response names
// leads: each row carries the lead's uuid, which is exactly the token /t/[id]
// accepts, plus the business name and its behavioural click trail. The portal
// deliberately sends external strangers to this origin, so per-lead reads must
// NOT ship publicly behind the sameOrigin (CSRF-only) floor — on top of it,
// live mode requires the PORTAL_ADMIN_KEY shared secret (x-portal-admin-key
// header, same key the admin Enquiries tab uses), deny-by-default when unset.
// Replace with real per-user auth when a session lands.
export const runtime = "nodejs";

/** Event window per query — matches /api/portal/summary. */
const EVENTS_LIMIT = 2000;
/** Response caps: the tab is a review surface, not an export. */
const MAX_LEADS = 100;
const MAX_EVENTS_PER_LEAD = 50;
const TOP_SERVICES_LIMIT = 6;

/** The client-side duplicate of the server-canonical `portal_inquiry` row
 *  (ServiceInquiryModal fires both for one submission). Hidden from timelines
 *  AND counts, or every enquiry would read as two events. */
const INQUIRY_DUP_EVENT = "portal_inquiry_submit";

/** Contract names that are portal-relevant even without `view = "portal"`:
 *  `portal_view` is a manual track() call with no view meta, and the
 *  server-emitted `portal_inquiry` row has no view at all. Together with
 *  `view = "portal"` (delegated data-track clicks on /portal) this predicate
 *  picks anonymous PORTAL rows out of lead_id-null traffic — which otherwise
 *  includes internal dashboard click noise that must NOT leak into this page. */
const ANON_PORTAL_EVENT_NAMES = new Set([
  "portal_view",
  "portal_service_open",
  "portal_inquiry",
  "legal_ack",
  "portal_consent_accept",
]);

/** The one customer-journey allowlist (lib/portal/server) — an operator who
 *  test-clicked a tracked link carries that lead's cookie, so their dashboard
 *  clicks would otherwise land in the trail. Shared with the per-enquiry
 *  summary route so both readers see the same trail. */
const ATTRIBUTED_EVENT_NAMES = new Set<string>(CUSTOMER_JOURNEY_EVENTS);
const ATTRIBUTED_QUERY =
  `portal_events?select=event,props,lead_id,campaign,category,created_at` +
  `&lead_id=not.is.null&event=in.(${[...ATTRIBUTED_EVENT_NAMES].join(",")})` +
  `&order=created_at.desc&limit=${EVENTS_LIMIT}`;

const ANON_SELECT = "select=event,props,view,visitor_id,created_at";
/** Standard PostgREST boolean group — ANDed with the sibling query-string
 *  filters. The identical predicate is re-applied in-route (belt & braces,
 *  and it's what the 400 fallback below relies on). */
const ANON_OR_FILTER =
  "or=(view.eq.portal,event.in.(portal_view,portal_service_open,portal_inquiry,legal_ack,portal_consent_accept))";
const ANON_QUERY =
  `portal_events?${ANON_SELECT}&lead_id=is.null&${ANON_OR_FILTER}` +
  `&order=created_at.desc&limit=${EVENTS_LIMIT}`;
/** Plain window fetch for the (unexpected) case PostgREST rejects the or=
 *  group — the in-route predicate then does all the work on a wider net. */
const ANON_FALLBACK_QUERY =
  `portal_events?${ANON_SELECT}&lead_id=is.null&order=created_at.desc&limit=${EVENTS_LIMIT}`;

type AttributedRow = {
  event: string;
  props: Record<string, unknown> | null;
  lead_id: string | null;
  campaign: string | null;
  category: string | null;
  created_at: string;
};

type AnonymousRow = {
  event: string;
  props: Record<string, unknown> | null;
  view: string | null;
  visitor_id: string | null;
  created_at: string;
};

type LeadRow = { id?: unknown; name?: unknown; category?: unknown };

/** Mutable per-lead accumulator. Events are collected newest-first (the fetch
 *  order) and reversed once at the end — that's what makes "keep the MOST
 *  RECENT 50" a plain length check instead of a shift-and-drop. */
type LeadBucket = {
  category: string | null;
  campaign: string | null;
  firstSeen: string;
  lastSeen: string;
  newestFirst: LeadActivityEvent[];
  counts: LeadActivityCounts;
};

/** Empty payload spread into every non-happy-path response so the client
 *  always gets the full shape (never mutated, so sharing it is safe). */
const EMPTY = {
  leads: [] as LeadActivity[],
  anonymous: { visitors: 0, events: 0, topServices: [] } as AnonymousPortalActivity,
};

/** 401 body — same grammar as the enquiries route's shared-secret gate. */
const UNAUTHORIZED = {
  ok: false as const,
  error: process.env.PORTAL_ADMIN_KEY
    ? "Unauthorised — a valid access key is required."
    : "Unauthorised — set PORTAL_ADMIN_KEY on the server to enable lead activity.",
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

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, mode: "live", ...EMPTY, error: "Forbidden." }, { status: 403 });
  }

  const target = supabaseTarget();
  if (target.state === "demo") {
    return Response.json({ ok: true, mode: "demo", ...EMPTY });
  }
  // Live mode names leads (uuid = the /t/[id] token, business, click trail) —
  // require the admin access key, exactly like the enquiries listing.
  if (!portalAdminAuthorized(req)) {
    return Response.json({ ...UNAUTHORIZED, mode: "live", ...EMPTY }, { status: 401 });
  }
  if (target.state === "misconfigured") {
    console.error("[portal/lead-activity] SUPABASE_URL is not a valid URL.");
    return Response.json(
      { ok: false, mode: "live", ...EMPTY, error: "Portal storage is misconfigured." },
      { status: 500 },
    );
  }

  let attributedRes: Response;
  let anonRes: Response;
  try {
    [attributedRes, anonRes] = await Promise.all([
      restGet(target.base, target.key, ATTRIBUTED_QUERY),
      restGet(target.base, target.key, ANON_QUERY),
    ]);
  } catch (e) {
    console.error("[portal/lead-activity] fetch to Supabase failed:", e);
    return Response.json(
      { ok: false, mode: "live", ...EMPTY, error: "Could not reach the database." },
      { status: 502 },
    );
  }

  // Safety net for the or= group: a 400 means PostgREST rejected the filter
  // shape (version drift etc.) rather than the table being absent — refetch
  // the plain lead_id-null window and let the in-route predicate (applied
  // unconditionally below) do the filtering. Missing-table 404s are NOT 400s,
  // so they fall through to the shared migration check.
  if (anonRes.status === 400) {
    const detail = await anonRes.text().catch(() => "");
    console.error(
      "[portal/lead-activity] anonymous or= filter rejected, falling back to in-route filtering:",
      detail.slice(0, 500),
    );
    try {
      anonRes = await restGet(target.base, target.key, ANON_FALLBACK_QUERY);
    } catch (e) {
      console.error("[portal/lead-activity] fallback fetch to Supabase failed:", e);
      return Response.json(
        { ok: false, mode: "live", ...EMPTY, error: "Could not reach the database." },
        { status: 502 },
      );
    }
  }

  for (const res of [attributedRes, anonRes]) {
    if (res.ok) continue;
    const detail = await res.text().catch(() => "");
    console.error(`[portal/lead-activity] Supabase ${res.status}:`, detail.slice(0, 1000));
    if (isMissingPortalTable(res.status, detail)) {
      // Migration not run yet → answer demo so the Telemetry tab shows the
      // "run supabase/portal-telemetry.sql" banner instead of a hard error.
      return Response.json({ ok: true, mode: "demo", needsMigration: true, ...EMPTY });
    }
    return Response.json(
      { ok: false, mode: "live", ...EMPTY, error: "Couldn't read the portal tables." },
      { status: 502 },
    );
  }

  const attributedRaw = (await attributedRes.json().catch(() => [])) as AttributedRow[];
  const anonRaw = (await anonRes.json().catch(() => [])) as AnonymousRow[];
  const attributedRows = Array.isArray(attributedRaw) ? attributedRaw : [];
  const anonRows = Array.isArray(anonRaw) ? anonRaw : [];

  // ── group the attributed stream per lead ──────────────────────────────────
  // The whole pass leans on rows arriving newest-first: the first row seen for
  // a lead IS its lastSeen, every later row pushes firstSeen back, "most
  // recent non-null campaign/category" is just first-non-null, and the event
  // cap keeps the most recent 50 by construction.
  const byLead = new Map<string, LeadBucket>();
  for (const row of attributedRows) {
    if (!row || typeof row.event !== "string" || typeof row.created_at !== "string") continue;
    // Defensive: lead_id is what we group by AND later interpolate into the
    // leads in.() filter — only well-formed uuids get in.
    if (!isUuid(row.lead_id)) continue;
    // Allowlist re-applied in-route (the DB in.() filter is the first line):
    // drops internal dashboard click noise from cookie-carrying operators AND
    // the client duplicate of portal_inquiry — timeline and counts alike.
    if (!ATTRIBUTED_EVENT_NAMES.has(row.event)) continue;

    let bucket = byLead.get(row.lead_id);
    if (!bucket) {
      bucket = {
        category: null,
        campaign: null,
        firstSeen: row.created_at,
        lastSeen: row.created_at,
        newestFirst: [],
        counts: { emailClicks: 0, portalViews: 0, serviceOpens: 0, inquiries: 0, chatPrompts: 0 },
      };
      byLead.set(row.lead_id, bucket);
    }
    bucket.firstSeen = row.created_at; // desc order ⇒ the last row seen is the oldest

    if (bucket.campaign === null && row.campaign) bucket.campaign = row.campaign;
    if (bucket.category === null && row.category) bucket.category = row.category;

    // Counts run over the whole fetched window — only the visible timeline is
    // capped, so a busy lead's funnel numbers stay honest.
    if (row.event === "attribution_click") bucket.counts.emailClicks += 1;
    else if (row.event === "portal_view") bucket.counts.portalViews += 1;
    else if (row.event === "portal_service_open") bucket.counts.serviceOpens += 1;
    else if (row.event === "portal_inquiry") bucket.counts.inquiries += 1;
    else if (row.event === "chat_prompt") bucket.counts.chatPrompts += 1;

    if (bucket.newestFirst.length < MAX_EVENTS_PER_LEAD) {
      bucket.newestFirst.push({
        event: row.event,
        service: propStr(row.props, "service"),
        destination: propStr(row.props, "destination"),
        // Accepted legal version: portal_consent_accept carries it as
        // consent_version, the gate's legal_ack as version.
        version: propStr(row.props, "consent_version") ?? propStr(row.props, "version"),
        ts: row.created_at,
      });
    }
  }

  // Map insertion order is already lastSeen-desc (the source rows are), but
  // sort explicitly so the response contract doesn't hinge on that accident.
  // PostgREST timestamps are uniform ISO-8601 UTC → string compare orders them.
  const keptLeads = [...byLead.entries()]
    .sort((a, b) => (a[1].lastSeen < b[1].lastSeen ? 1 : a[1].lastSeen > b[1].lastSeen ? -1 : 0))
    .slice(0, MAX_LEADS);

  // ── ONE leads lookup for business names (+ category fallback) ────────────
  // Best-effort: leads get reimported/deleted, so a miss just means business
  // stays null — the timeline itself must never depend on the leads table.
  const leadInfo = new Map<string, { name: string | null; category: string | null }>();
  if (keptLeads.length > 0) {
    // Every key passed isUuid above, so comma-joined interpolation into the
    // in.() filter is safe (uuids never need PostgREST value quoting).
    const ids = keptLeads.map(([leadId]) => leadId).join(",");
    try {
      const res = await restGet(target.base, target.key, `leads?select=id,name,category&id=in.(${ids})`);
      if (res.ok) {
        const rows = (await res.json().catch(() => [])) as LeadRow[];
        for (const row of Array.isArray(rows) ? rows : []) {
          if (!row || !isUuid(row.id)) continue;
          leadInfo.set(row.id, {
            name: typeof row.name === "string" && row.name ? row.name : null,
            category: typeof row.category === "string" && row.category ? row.category : null,
          });
        }
      } else {
        const detail = await res.text().catch(() => "");
        console.error(`[portal/lead-activity] leads lookup ${res.status}:`, detail.slice(0, 500));
      }
    } catch (e) {
      console.error("[portal/lead-activity] leads lookup failed:", e);
    }
  }

  const leads: LeadActivity[] = keptLeads.map(([leadId, bucket]) => {
    const info = leadInfo.get(leadId);
    return {
      leadId,
      business: info?.name ?? null,
      // The events carried the sector at insert time (survives lead deletion);
      // the live leads row is only the fallback.
      category: bucket.category ?? info?.category ?? null,
      campaign: bucket.campaign,
      firstSeen: bucket.firstSeen,
      lastSeen: bucket.lastSeen,
      events: bucket.newestFirst.reverse(), // → chronological ASC for the timeline
      counts: bucket.counts,
    };
  });

  // ── anonymous portal visitors ─────────────────────────────────────────────
  // Same predicate as the DB or= filter, re-applied so the 400 fallback path
  // (and anything a future filter drift lets through) can't leak internal
  // dashboard click noise into the visitor numbers.
  const visitorIds = new Set<string>();
  let anonEvents = 0;
  const opensByService = new Map<string, number>();
  for (const row of anonRows) {
    if (!row || typeof row.event !== "string") continue;
    if (row.view !== "portal" && !ANON_PORTAL_EVENT_NAMES.has(row.event)) continue;
    // Today the dup ships without a view so the predicate above already drops
    // it, but a view-tagged variant would double-count enquiries — keep the
    // exclusion explicit rather than incidental.
    if (row.event === INQUIRY_DUP_EVENT) continue;

    anonEvents += 1;
    if (typeof row.visitor_id === "string" && row.visitor_id) visitorIds.add(row.visitor_id);
    if (row.event === "portal_service_open") {
      const service = propStr(row.props, "service");
      if (service) opensByService.set(service, (opensByService.get(service) ?? 0) + 1);
    }
  }
  const topServices = [...opensByService.entries()]
    .map(([service, opens]) => ({ service, opens }))
    .sort((a, b) => b.opens - a.opens)
    .slice(0, TOP_SERVICES_LIMIT);

  const anonymous: AnonymousPortalActivity = {
    visitors: visitorIds.size,
    events: anonEvents,
    topServices,
  };

  return Response.json({ ok: true, mode: "live", leads, anonymous });
}

// DELETE /api/portal/lead-activity?leadId=<uuid> — remove ONE lead's click
// trail from the Telemetry tab. Deletes every portal_events row carrying that
// lead_id (customer-journey events AND any cookie-stamped dashboard noise), so
// the lead drops out of this page and out of /api/portal/summary's attributed
// totals alike. The leads table itself is untouched — this erases activity,
// not the lead. Same gates as the GET: sameOrigin floor + PORTAL_ADMIN_KEY
// shared secret (a delete is at least as sensitive as the per-lead read).
export async function DELETE(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, deleted: 0, mode: "live", error: "Forbidden." }, { status: 403 });
  }

  const target = supabaseTarget();
  if (target.state === "demo") {
    // Demo rows are a client-side constant (and their ids aren't uuids) —
    // nothing to delete server-side; the page drops the row locally.
    return Response.json({ ok: true, deleted: 0, mode: "demo" });
  }

  const leadId = new URL(req.url).searchParams.get("leadId");
  // isUuid also makes the eq. interpolation safe (uuids never need quoting).
  if (!isUuid(leadId)) {
    return Response.json(
      { ok: false, deleted: 0, mode: "live", error: "A valid lead id is required." },
      { status: 400 },
    );
  }
  if (!portalAdminAuthorized(req)) {
    return Response.json({ ...UNAUTHORIZED, deleted: 0, mode: "live" }, { status: 401 });
  }
  if (target.state === "misconfigured") {
    console.error("[portal/lead-activity] SUPABASE_URL is not a valid URL.");
    return Response.json(
      { ok: false, deleted: 0, mode: "live", error: "Portal storage is misconfigured." },
      { status: 500 },
    );
  }

  let res: Response;
  try {
    res = await fetch(`${target.base}/rest/v1/portal_events?lead_id=eq.${leadId}&select=id`, {
      method: "DELETE",
      headers: {
        apikey: target.key,
        Authorization: `Bearer ${target.key}`,
        Prefer: "return=representation",
      },
    });
  } catch (e) {
    console.error("[portal/lead-activity] delete fetch failed:", e);
    return Response.json(
      { ok: false, deleted: 0, mode: "live", error: "Could not reach the database." },
      { status: 502 },
    );
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[portal/lead-activity] Supabase DELETE ${res.status}:`, detail.slice(0, 1000));
    if (isMissingPortalTable(res.status, detail)) {
      return Response.json({ ok: true, deleted: 0, mode: "demo", needsMigration: true });
    }
    return Response.json(
      { ok: false, deleted: 0, mode: "live", error: "The database rejected the delete." },
      { status: 502 },
    );
  }

  const deletedRows = await res.json().catch(() => []);
  const deleted = Array.isArray(deletedRows) ? deletedRows.length : 0;
  return Response.json({ ok: true, deleted, mode: "live" });
}
