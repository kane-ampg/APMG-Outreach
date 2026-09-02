import { isUuid, requireLiveSupabase, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import {
  CUSTOMER_JOURNEY_EVENTS,
  isMissingPortalTable,
  portalAdminAuthorized,
  type AnonymousPortalActivity,
  type LeadActivity,
  type LeadActivityCounts,
  type LeadActivityEvent,
  type SourcedVisitorActivity,
  type UnsubscribedPerson,
} from "@/lib/portal/server";

// GET /api/portal/lead-activity — the per-lead click stream behind the admin
// Telemetry tab: for every ATTRIBUTED lead (someone who clicked the tracked
// outreach link, so their portal_events rows carry lead_id) the chronological
// trail of what they did — email click → PDF download → portal view → service
// opens → enquiry — plus per-visitor trails for SOURCE-TAGGED anonymous
// visitors (came via the promoted ?utm_source= link: facebook, tiktok, …),
// one aggregate block for the remaining anonymous portal visitors, and the
// recorded opt-out list (who unsubscribed, and when).
// Grouped here in the route (three bounded PostgREST GETs + the leads lookups)
// rather than in SQL, the same trade-off as /api/portal/summary — at portal
// traffic volumes that's plenty, and it keeps every read in this repo a plain
// PostgREST fetch. Server-side (keeps the service role key off the browser).
//
// SECURITY — unlike /api/portal/summary (pure aggregates), this response names
// leads: each row carries the lead's uuid, which is exactly the token /t/[id]
// accepts, plus the business name and its behavioural click trail, and the
// opt-out list carries recipients' email addresses outright. The portal
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
const MAX_VISITORS = 50;
const MAX_EVENTS_PER_LEAD = 50;
const TOP_SERVICES_LIMIT = 6;
/** Opt-out rows returned. The KPI count comes from count=exact, so the cap
 *  only limits what the table can page through, never the number shown. */
const MAX_UNSUBSCRIBES = 100;

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
 *  and it's what the 400 fallback below relies on). portal_inquiry_submit is
 *  fetched ONLY for the sourced-visitor trails: the canonical portal_inquiry
 *  row is server-emitted without a visitor_id, so the client dup is the one
 *  record that ties an anonymous enquiry to its visitor — the aggregate
 *  rollup below still excludes it, exactly as before. */
const ANON_OR_FILTER =
  "or=(view.eq.portal,event.in.(portal_view,portal_service_open,portal_inquiry,legal_ack,portal_consent_accept,portal_inquiry_submit))";
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

/** The opt-out list, newest first. A separate table with a separate migration
 *  (supabase/unsubscribe.sql) — deliberately NOT part of the portal-tables
 *  migration check below, so a console that has never run it still renders
 *  every other panel. */
const UNSUBSCRIBE_QUERY =
  `email_suppression?select=email,lead_id,campaign,reason,created_at` +
  `&order=created_at.desc&limit=${MAX_UNSUBSCRIBES}`;

type LeadRow = { id?: unknown; name?: unknown; category?: unknown };

type SuppressionRow = {
  email?: unknown;
  lead_id?: unknown;
  campaign?: unknown;
  reason?: unknown;
  created_at?: unknown;
};

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
  visitors: [] as SourcedVisitorActivity[],
  anonymous: { visitors: 0, events: 0, topServices: [] } as AnonymousPortalActivity,
  unsubscribes: [] as UnsubscribedPerson[],
  unsubscribesTotal: 0,
  // "we couldn't read the list", not "nobody has opted out" — every early
  // return here is a state where we genuinely don't know.
  unsubscribesAvailable: false,
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

/** As restGet, but asks for the exact row total in Content-Range — a capped
 *  window can then still report an honest count (the report route's trick). */
function countingGet(base: string, key: string, pathAndQuery: string): Promise<Response> {
  return fetch(`${base}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
    cache: "no-store",
  });
}

/** Exact row total from a count=exact response ("0-24/137" → 137). */
function totalOf(res: Response): number {
  const total = Number((res.headers.get("content-range") ?? "").split("/")[1]);
  return Number.isFinite(total) && total >= 0 ? total : 0;
}

/**
 * ONE bounded leads lookup for display names (+ category fallback).
 * Best-effort by contract: leads get reimported/deleted, so a miss just means
 * `business` stays null — nothing this route renders may depend on the leads
 * table still holding the row.
 *
 * Callers pass at most MAX_LEADS / MAX_UNSUBSCRIBES ids, and each id has been
 * through isUuid, so comma-joining them into the in.() filter is both safe
 * (uuids never need PostgREST quoting) and bounded well inside URL limits.
 */
async function lookupLeadNames(
  base: string,
  key: string,
  ids: string[],
): Promise<Map<string, { name: string | null; category: string | null }>> {
  const out = new Map<string, { name: string | null; category: string | null }>();
  if (ids.length === 0) return out;
  try {
    const res = await restGet(base, key, `leads?select=id,name,category&id=in.(${ids.join(",")})`);
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[portal/lead-activity] leads lookup ${res.status}:`, detail.slice(0, 500));
      return out;
    }
    const rows = (await res.json().catch(() => [])) as LeadRow[];
    for (const row of Array.isArray(rows) ? rows : []) {
      if (!row || !isUuid(row.id)) continue;
      out.set(row.id, {
        name: typeof row.name === "string" && row.name ? row.name : null,
        category: typeof row.category === "string" && row.category ? row.category : null,
      });
    }
  } catch (e) {
    console.error("[portal/lead-activity] leads lookup failed:", e);
  }
  return out;
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
  const blocked = requireLiveSupabase("portal/lead-activity");
  if (blocked) return blocked;
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
  let unsubRes: Response;
  try {
    [attributedRes, anonRes, unsubRes] = await Promise.all([
      restGet(target.base, target.key, ATTRIBUTED_QUERY),
      restGet(target.base, target.key, ANON_QUERY),
      countingGet(target.base, target.key, UNSUBSCRIBE_QUERY),
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

  // ── the opt-out list ──────────────────────────────────────────────────────
  // email_suppression has its OWN migration (supabase/unsubscribe.sql), so it
  // is read outside the portal-tables gate above: a console missing it still
  // gets every other panel. It also can't fall back to zero — "no rows" and
  // "no table" are different facts, and the second one must not render as
  // "nobody has unsubscribed" on a KPI card. `unsubscribesAvailable` carries
  // that distinction to the UI.
  const unsubscribesAvailable = unsubRes.ok;
  const unsubRows: SuppressionRow[] = [];
  if (unsubRes.ok) {
    const raw = await unsubRes.json().catch(() => []);
    if (Array.isArray(raw)) unsubRows.push(...(raw as SuppressionRow[]));
  } else {
    const detail = await unsubRes.text().catch(() => "");
    console.error(
      isMissingPortalTable(unsubRes.status, detail)
        ? "[portal/lead-activity] email_suppression missing — run supabase/unsubscribe.sql"
        : `[portal/lead-activity] suppression read ${unsubRes.status}: ${detail.slice(0, 500)}`,
    );
  }
  const unsubscribesTotal = unsubscribesAvailable ? Math.max(totalOf(unsubRes), unsubRows.length) : 0;

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

  // ── leads lookups for business names (+ category fallback) ───────────────
  // Two id sets — the trails and the opt-outs — resolved as two parallel
  // bounded queries rather than one union, so neither in.() filter can grow
  // past a comfortable URL length as the caps rise.
  const trailIds = keptLeads.map(([leadId]) => leadId);
  const trailIdSet = new Set(trailIds);
  const unsubIds = [
    ...new Set(
      unsubRows
        .map((r) => (isUuid(r.lead_id) ? (r.lead_id as string) : null))
        .filter((id): id is string => id !== null && !trailIdSet.has(id)),
    ),
  ];
  const [trailInfo, unsubInfo] = await Promise.all([
    lookupLeadNames(target.base, target.key, trailIds),
    lookupLeadNames(target.base, target.key, unsubIds),
  ]);
  const leadInfo = new Map([...trailInfo, ...unsubInfo]);

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

  // ── sourced visitor trails (the social-promotion loop) ───────────────────
  // Anonymous rows whose props carry a traffic source (the apmg_src cookie —
  // ?utm_source=facebook on the promoted portal link, or a recognised social
  // Referer) are grouped per visitor_id into the same trail shape as an
  // attributed lead: there is no lead identity to pin the visit to, but "came
  // from Facebook, browsed Plumbing, enquired" is exactly what the Telemetry
  // table exists to show. Rows arrive newest-first, so the same accumulator
  // tricks as byLead apply — and the first non-null source seen is the LATEST
  // one, matching the apmg_src cookie's last-touch-wins semantics.
  type VisitorBucket = {
    source: string | null;
    firstSeen: string;
    lastSeen: string;
    newestFirst: LeadActivityEvent[];
    counts: LeadActivityCounts;
    /** client-dup enquiries — the stand-in count when no canonical row ties
     *  to this visitor (see the ANON_OR_FILTER note) */
    dupInquiries: number;
  };
  const byVisitor = new Map<string, VisitorBucket>();
  for (const row of anonRows) {
    if (!row || typeof row.event !== "string" || typeof row.created_at !== "string") continue;
    if (typeof row.visitor_id !== "string" || !row.visitor_id) continue;
    const isDup = row.event === INQUIRY_DUP_EVENT;
    if (row.view !== "portal" && !ANON_PORTAL_EVENT_NAMES.has(row.event) && !isDup) continue;

    let bucket = byVisitor.get(row.visitor_id);
    if (!bucket) {
      bucket = {
        source: null,
        firstSeen: row.created_at,
        lastSeen: row.created_at,
        newestFirst: [],
        counts: { emailClicks: 0, portalViews: 0, serviceOpens: 0, inquiries: 0, chatPrompts: 0 },
        dupInquiries: 0,
      };
      byVisitor.set(row.visitor_id, bucket);
    }
    bucket.firstSeen = row.created_at; // desc order ⇒ the last row seen is the oldest
    if (bucket.source === null) bucket.source = propStr(row.props, "source");

    if (row.event === "portal_view") bucket.counts.portalViews += 1;
    else if (row.event === "portal_service_open") bucket.counts.serviceOpens += 1;
    else if (row.event === "portal_inquiry") bucket.counts.inquiries += 1;
    else if (isDup) bucket.dupInquiries += 1;

    if (bucket.newestFirst.length < MAX_EVENTS_PER_LEAD) {
      bucket.newestFirst.push({
        event: row.event,
        service: propStr(row.props, "service"),
        destination: propStr(row.props, "destination"),
        version: propStr(row.props, "consent_version") ?? propStr(row.props, "version"),
        ts: row.created_at,
      });
    }
  }

  // Only tagged visitors get a trail row — the rest stay in the aggregate
  // block below, so the table never fills with unattributable direct traffic.
  const sourcedVisitorIds = new Set(
    [...byVisitor.entries()].filter(([, b]) => b.source !== null).map(([id]) => id),
  );
  const visitors: SourcedVisitorActivity[] = [...byVisitor.entries()]
    .filter(([, b]) => b.source !== null)
    .sort((a, b) => (a[1].lastSeen < b[1].lastSeen ? 1 : a[1].lastSeen > b[1].lastSeen ? -1 : 0))
    .slice(0, MAX_VISITORS)
    .map(([visitorId, bucket]) => {
      // The canonical portal_inquiry row can't reach an anonymous trail (it is
      // server-emitted with no visitor_id), so the client dup stands in for it
      // — counted, and RENAMED in the timeline so the UI's dup-hiding (built
      // for attributed trails, where both rows appear) doesn't erase the
      // visitor's one enquiry record. If a canonical row ever does carry the
      // visitor_id, it wins and the dups drop out, exactly like a lead trail.
      const useDup = bucket.counts.inquiries === 0 && bucket.dupInquiries > 0;
      if (useDup) bucket.counts.inquiries = bucket.dupInquiries;
      const events = bucket.newestFirst
        .filter((e) => e.event !== INQUIRY_DUP_EVENT || useDup)
        .map((e) => (e.event === INQUIRY_DUP_EVENT ? { ...e, event: "portal_inquiry" } : e));
      return {
        visitorId,
        source: bucket.source as string,
        firstSeen: bucket.firstSeen,
        lastSeen: bucket.lastSeen,
        events: events.reverse(), // → chronological ASC for the timeline
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
    // Tagged visitors have their own trail rows above — counting them here
    // too would show the same person twice on one page.
    if (typeof row.visitor_id === "string" && sourcedVisitorIds.has(row.visitor_id)) continue;

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

  // Rebuilt field-by-field (the address is the row's whole point, so a row
  // without one is dropped rather than rendered as a blank person). The name
  // resolves through the lead id the unsubscribe link carried — an opt-out sent
  // from an address we hold on no lead simply reads as the address.
  const unsubscribes: UnsubscribedPerson[] = [];
  for (const row of unsubRows) {
    if (!row || typeof row.email !== "string" || !row.email) continue;
    if (typeof row.created_at !== "string" || !row.created_at) continue;
    const leadId = isUuid(row.lead_id) ? (row.lead_id as string) : null;
    const info = leadId ? leadInfo.get(leadId) : undefined;
    unsubscribes.push({
      email: row.email,
      business: info?.name ?? null,
      category: info?.category ?? null,
      leadId,
      campaign: typeof row.campaign === "string" && row.campaign ? row.campaign : null,
      reason: typeof row.reason === "string" && row.reason ? row.reason : "unsubscribe",
      createdAt: row.created_at,
    });
  }

  return Response.json({
    ok: true,
    mode: "live",
    leads,
    visitors,
    anonymous,
    unsubscribes,
    unsubscribesTotal,
    unsubscribesAvailable,
  });
}

// DELETE /api/portal/lead-activity — two scopes, one per thing this page shows:
//   ?leadId=<uuid>  — remove ONE lead's click trail. Deletes every portal_events
//                     row carrying that lead_id (customer-journey events AND any
//                     cookie-stamped dashboard noise) AND the lead's
//                     portal_inquiries rows, so the lead drops out of this page,
//                     the Enquiries tab, and /api/portal/summary's KPI totals
//                     alike — a delete here must never leave a ghost count on
//                     the KPI cards. The leads table itself is untouched — this
//                     erases activity, not the lead.
//   ?anonymous=1    — clear the anonymous-visitors block: every lead_id-null
//                     portal_events row the portal emits (the panel's display
//                     predicate plus the enquiry-submission companions), which
//                     otherwise keep feeding the summary's views/opens KPIs
//                     forever with no way to remove them. Anonymous
//                     portal_inquiries rows are deliberately NOT touched — an
//                     unattributed enquiry is still a real person's contact
//                     request, deletable only per-row on the Enquiries tab.
// Same gates as the GET: sameOrigin floor + PORTAL_ADMIN_KEY shared secret
// (a delete is at least as sensitive as the per-lead read).

/** Everything the portal emits without a lead — the anonymous panel's display
 *  predicate (ANON_OR_FILTER) widened with the enquiry-submission companion
 *  events (client dup, consent echo, done/cancel, chat open/close, tab nav)
 *  that ride the same visit but carry no `view` meta. `view.eq.portal` keeps
 *  catching any view-tagged stragglers (whatsapp/linkedin clicks etc.). */
const ANON_PURGE_FILTER =
  "lead_id=is.null&or=(view.eq.portal,event.in.(portal_view,portal_service_open," +
  "portal_inquiry,legal_ack,portal_consent_accept,portal_inquiry_submit,consent_accept," +
  "portal_inquiry_done,portal_inquiry_cancel,portal_chat_open,portal_chat_close,portal_tab))";

function restDelete(base: string, key: string, pathAndQuery: string): Promise<Response> {
  return fetch(`${base}/rest/v1/${pathAndQuery}`, {
    method: "DELETE",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=representation", // deleted rows back → an honest count
    },
  });
}

export async function DELETE(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, deleted: 0, mode: "live", error: "Forbidden." }, { status: 403 });
  }

  const target = supabaseTarget();
  const blocked = requireLiveSupabase("portal/lead-activity");
  if (blocked) return blocked;
  if (target.state === "demo") {
    // Demo rows are a client-side constant (and their ids aren't uuids) —
    // nothing to delete server-side; the page drops the row locally.
    return Response.json({ ok: true, deleted: 0, mode: "demo" });
  }

  const url = new URL(req.url);
  const anonymous = url.searchParams.get("anonymous") === "1";
  const leadId = url.searchParams.get("leadId");
  // isUuid also makes the eq. interpolation safe (uuids never need quoting).
  if (!anonymous && !isUuid(leadId)) {
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

  const eventsQuery = anonymous
    ? `portal_events?${ANON_PURGE_FILTER}&select=id`
    : `portal_events?lead_id=eq.${leadId}&select=id`;

  let res: Response;
  try {
    res = await restDelete(target.base, target.key, eventsQuery);
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

  // Anonymous scope stops at events — enquiry rows stay (see the contract above).
  if (anonymous) {
    return Response.json({ ok: true, deleted, mode: "live" });
  }

  // Lead scope: cascade into the lead's enquiry rows so the summary's
  // enquiries KPI (counted off portal_inquiries, the canonical store) drops
  // with the trail instead of ghosting. Ordered events-first so a failure here
  // leaves a retryable state: the retry deletes 0 events, then the enquiries.
  let inqRes: Response;
  try {
    inqRes = await restDelete(target.base, target.key, `portal_inquiries?lead_id=eq.${leadId}&select=id`);
  } catch (e) {
    console.error("[portal/lead-activity] enquiries delete fetch failed:", e);
    return Response.json(
      {
        ok: false,
        deleted,
        mode: "live",
        error: "Deleted the click trail, but couldn't reach the database for the lead's enquiries — retry to finish.",
      },
      { status: 502 },
    );
  }
  if (!inqRes.ok) {
    const detail = await inqRes.text().catch(() => "");
    console.error(`[portal/lead-activity] Supabase enquiries DELETE ${inqRes.status}:`, detail.slice(0, 1000));
    // Enquiries table not migrated in yet = nothing there to delete — the
    // trail delete above already succeeded, so this is a completed delete.
    if (isMissingPortalTable(inqRes.status, detail)) {
      return Response.json({ ok: true, deleted, inquiriesDeleted: 0, mode: "live" });
    }
    return Response.json(
      {
        ok: false,
        deleted,
        mode: "live",
        error: "Deleted the click trail, but the lead's enquiries couldn't be deleted — retry to finish.",
      },
      { status: 502 },
    );
  }
  const inqRows = await inqRes.json().catch(() => []);
  const inquiriesDeleted = Array.isArray(inqRows) ? inqRows.length : 0;
  return Response.json({ ok: true, deleted, inquiriesDeleted, mode: "live" });
}
