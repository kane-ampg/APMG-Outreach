import { requireLiveSupabase, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { isMissingColumn, isMissingPortalTable, readAllRows, type RowsRead } from "@/lib/portal/server";
import { DIRECT_SOURCE, OUTREACH_SOURCE } from "@/lib/portal/source";

// GET /api/portal/summary — the aggregation behind the admin Enquiries tab and
// the Telemetry KPI row: funnel totals (email click → portal visit → service
// open → enquiry), the per-service, per-sector and per-source breakdowns (the
// "direct" source is the anonymous visitors), and a short recent-events feed.
// Aggregated here in the route rather than in SQL so every read stays a plain
// PostgREST GET like the rest of this repo.
//
// ALL-TIME, ONE READ PER FUNNEL STEP. This used to tally "the newest 2000
// portal_events rows". PostgREST caps a response at 1000, and that window held
// every row in the table — the send ledger, chat pings, dashboard clicks — so
// one outreach send pushed a week of portal visits out of it. Each step is now
// read on its own, carrying only the columns its tally needs, and paged to the
// end (readAllRows). Same bytes per poll as the old single read (~250 KB at
// 2026-09 volumes), and every visit counts.
// Server-side (keeps the service role key off the browser).
export const runtime = "nodejs";

const INQUIRIES_LIMIT = 500;
const RECENT_LIMIT = 30;

/** The five contract event names that belong to the portal funnel. Everything
 *  else in portal_events (admin-dashboard data-track clicks etc.) is noise for
 *  this summary and is ignored. */
const PORTAL_EVENT_NAMES = new Set([
  "attribution_click",
  "portal_view",
  "portal_service_open",
  "portal_inquiry_submit",
  "portal_inquiry",
]);

/** Total order for the paged reads — see readAllRows for why ascending. */
const PAGED_ORDER = "order=created_at.asc,id.asc";
const CLICKS_QUERY = `portal_events?select=category,lead_id&event=eq.attribution_click&${PAGED_ORDER}`;
const VIEWS_QUERY =
  `portal_events?select=lead_id,category,visitor_id,source:props->>source` +
  `&event=eq.portal_view&${PAGED_ORDER}`;
const OPENS_QUERY =
  `portal_events?select=lead_id,service:props->>service,source:props->>source` +
  `&event=eq.portal_service_open&${PAGED_ORDER}`;
const RECENT_QUERY =
  `portal_events?select=event,props,campaign,category,created_at` +
  `&event=in.(${[...PORTAL_EVENT_NAMES].join(",")})&order=created_at.desc,id.desc&limit=${RECENT_LIMIT}`;

/** Bucket label for visitors with no attributed lead (typed the URL, forwarded
 *  link, cookie expired…). */
const DIRECT = "Direct / unknown";

type ClickRow = { category: string | null; lead_id: string | null };
type ViewRow = { lead_id: string | null; category: string | null; visitor_id: string | null; source: string | null };
type OpenRow = { lead_id: string | null; service: string | null; source: string | null };
type RecentRow = {
  event: string;
  props: Record<string, unknown> | null;
  campaign: string | null;
  category: string | null;
  created_at: string;
};

type InquiryRow = {
  service_slug: string | null;
  category: string | null;
  campaign: string | null;
  lead_id: string | null;
  source: string | null;
  created_at: string;
  status: string | null;
};

/** portal_inquiries select — and its fallback while the `source` column
 *  migration (supabase/portal-telemetry.sql) hasn't been run yet. */
const INQUIRY_COLS = "service_slug,category,campaign,lead_id,source,created_at,status";
const LEGACY_INQUIRY_COLS = INQUIRY_COLS.replace(",source", "");

const EMPTY_SUMMARY = {
  totals: {
    attributionClicks: 0,
    portalViews: 0,
    serviceOpens: 0,
    inquiries: 0,
    uniqueVisitors: 0,
    engagedLeads: 0,
    enquiredLeads: 0,
    attributedInquiries: 0,
  },
  byService: [] as Array<{
    service: string;
    opens: number;
    inquiries: number;
    /** channel slug (outreach / direct / facebook / …) → opens */
    opensBySource: Record<string, number>;
  }>,
  byCategory: [] as Array<{ category: string; clicks: number; views: number; inquiries: number }>,
  bySource: [] as Array<{ source: string; visitors: number; views: number; inquiries: number }>,
  recentEvents: [] as Array<{
    event: string;
    service: string | null;
    category: string | null;
    campaign: string | null;
    source: string | null;
    createdAt: string;
  }>,
};

function restGet(base: string, key: string, pathAndQuery: string): Promise<Response> {
  return fetch(`${base}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
}

/** A read that failed: the migration banner when the portal tables are
 *  missing, a 502 otherwise. */
function storageFailure(status: number, detail: string): Response {
  console.error(`[portal/summary] Supabase ${status}:`, detail.slice(0, 1000));
  if (isMissingPortalTable(status, detail)) {
    // Migration not run yet → answer demo so the admin tab shows the "run
    // supabase/portal-telemetry.sql" banner instead of a hard error.
    return Response.json({ ok: true, mode: "demo", needsMigration: true, ...EMPTY_SUMMARY });
  }
  return Response.json({ ok: false, mode: "live", ...EMPTY_SUMMARY, error: "Couldn't read the portal tables." }, { status: 502 });
}

/** Non-string / empty → null, so a row's column reads the same whether
 *  PostgREST sent null, "" or nothing. */
function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, mode: "live", ...EMPTY_SUMMARY, error: "Forbidden." }, { status: 403 });
  }

  const target = supabaseTarget();
  const blocked = requireLiveSupabase("portal/summary");
  if (blocked) return blocked;
  if (target.state === "demo") {
    return Response.json({ ok: true, mode: "demo", ...EMPTY_SUMMARY });
  }
  if (target.state === "misconfigured") {
    console.error("[portal/summary] SUPABASE_URL is not a valid URL.");
    return Response.json({ ok: false, mode: "live", ...EMPTY_SUMMARY, error: "Portal storage is misconfigured." }, { status: 500 });
  }

  const listInquiries = (cols: string) =>
    restGet(
      target.base,
      target.key,
      `portal_inquiries?select=${cols}&order=created_at.desc&limit=${INQUIRIES_LIMIT}`,
    );

  let clicks: RowsRead;
  let views: RowsRead;
  let opens: RowsRead;
  let recentRes: Response;
  let inquiriesRes: Response;
  try {
    [clicks, views, opens, recentRes, inquiriesRes] = await Promise.all([
      readAllRows(target.base, target.key, CLICKS_QUERY),
      readAllRows(target.base, target.key, VIEWS_QUERY),
      readAllRows(target.base, target.key, OPENS_QUERY),
      restGet(target.base, target.key, RECENT_QUERY),
      listInquiries(INQUIRY_COLS),
    ]);
    // `source` column not migrated in yet — aggregate without it (source
    // buckets fall back to outreach/direct) rather than failing the tab.
    if (!inquiriesRes.ok) {
      const detail = await inquiriesRes.clone().text().catch(() => "");
      if (isMissingColumn(detail)) {
        console.error(
          "[portal/summary] portal_inquiries.source column missing — run supabase/portal-telemetry.sql; aggregating without source.",
        );
        inquiriesRes = await listInquiries(LEGACY_INQUIRY_COLS);
      }
    }
  } catch (e) {
    console.error("[portal/summary] fetch to Supabase failed:", e);
    return Response.json({ ok: false, mode: "live", ...EMPTY_SUMMARY, error: "Could not reach the database." }, { status: 502 });
  }

  if (!clicks.ok) return storageFailure(clicks.status, clicks.detail);
  if (!views.ok) return storageFailure(views.status, views.detail);
  if (!opens.ok) return storageFailure(opens.status, opens.detail);
  for (const res of [recentRes, inquiriesRes]) {
    if (!res.ok) return storageFailure(res.status, await res.text().catch(() => ""));
  }

  const recentRowsRaw = (await recentRes.json().catch(() => [])) as RecentRow[];
  const inquiryRowsRaw = (await inquiriesRes.json().catch(() => [])) as InquiryRow[];
  const recentRows = Array.isArray(recentRowsRaw) ? recentRowsRaw : [];
  const inquiryRows = Array.isArray(inquiryRowsRaw) ? inquiryRowsRaw : [];

  // ── aggregate ──────────────────────────────────────────────────────────────
  const totals = { ...EMPTY_SUMMARY.totals };
  const visitors = new Set<string>();
  /** Every lead that ever clicked a tracked email link — the Leads engaged
   *  card. Counted here, over every click, because the Telemetry table's lead
   *  list is capped at the newest 100 and the card used to count THAT. */
  const clickedLeads = new Set<string>();
  const byServiceMap = new Map<
    string,
    { opens: number; inquiries: number; opensBySource: Record<string, number> }
  >();
  const byCategoryMap = new Map<string, { clicks: number; views: number; inquiries: number }>();
  const bySourceMap = new Map<string, { visitors: Set<string>; views: number; inquiries: number }>();
  const recentEvents: typeof EMPTY_SUMMARY.recentEvents = [];

  const serviceBucket = (service: string) => {
    let b = byServiceMap.get(service);
    if (!b) byServiceMap.set(service, (b = { opens: 0, inquiries: 0, opensBySource: {} }));
    return b;
  };
  const categoryBucket = (category: string) => {
    let b = byCategoryMap.get(category);
    if (!b) byCategoryMap.set(category, (b = { clicks: 0, views: 0, inquiries: 0 }));
    return b;
  };
  const sourceBucket = (source: string) => {
    let b = bySourceMap.get(source);
    if (!b) bySourceMap.set(source, (b = { visitors: new Set(), views: 0, inquiries: 0 }));
    return b;
  };
  /** Which traffic channel a row belongs to: an explicit source (the apmg_src
   *  cookie — TikTok/Facebook/Instagram promotion) wins; otherwise an
   *  outreach-attributed row files under "outreach", the rest under "direct". */
  const channelOf = (source: string | null, leadId: string | null) =>
    source ?? (leadId ? OUTREACH_SOURCE : DIRECT_SOURCE);

  for (const row of clicks.rows as ClickRow[]) {
    if (!row) continue;
    totals.attributionClicks += 1;
    categoryBucket(str(row.category) ?? DIRECT).clicks += 1;
    const lead = str(row.lead_id);
    if (lead) clickedLeads.add(lead);
  }
  for (const row of views.rows as ViewRow[]) {
    if (!row) continue;
    const visitor = str(row.visitor_id);
    totals.portalViews += 1;
    categoryBucket(str(row.category) ?? DIRECT).views += 1;
    if (visitor) visitors.add(visitor);
    const src = sourceBucket(channelOf(str(row.source), str(row.lead_id)));
    src.views += 1;
    if (visitor) src.visitors.add(visitor);
  }
  for (const row of opens.rows as OpenRow[]) {
    if (!row) continue;
    totals.serviceOpens += 1;
    const service = str(row.service);
    if (!service) continue;
    const b = serviceBucket(service);
    b.opens += 1;
    // Which door the clicker came through — the Telemetry "Services clicked"
    // panel shows it per service, so scanner-heavy outreach clicks can be
    // told apart from Facebook / anonymous interest.
    const channel = channelOf(str(row.source), str(row.lead_id));
    b.opensBySource[channel] = (b.opensBySource[channel] ?? 0) + 1;
  }

  // The recent read is already the newest RECENT_LIMIT funnel rows, newest first.
  for (const row of recentRows) {
    if (!row || typeof row.event !== "string") continue;
    recentEvents.push({
      event: row.event,
      service: str(row.props?.service),
      category: row.category ?? null,
      campaign: row.campaign ?? null,
      source: str(row.props?.source),
      createdAt: row.created_at,
    });
  }

  // Enquiry counts come from portal_inquiries — the canonical store — rather
  // than the (best-effort, client-influenced) telemetry events.
  totals.inquiries = inquiryRows.length;
  totals.uniqueVisitors = visitors.size;
  totals.engagedLeads = clickedLeads.size;
  const enquiredLeads = new Set<string>();
  for (const row of inquiryRows) {
    if (!row) continue;
    const lead = str(row.lead_id);
    if (lead) {
      totals.attributedInquiries += 1;
      // "went on to enquire" — only a lead that clicked counts toward the
      // engaged card's ratio, so it can never pass 100%.
      if (clickedLeads.has(lead)) enquiredLeads.add(lead);
    }
    serviceBucket(row.service_slug || "general").inquiries += 1;
    categoryBucket(row.category ?? DIRECT).inquiries += 1;
    sourceBucket(channelOf(row.source ?? null, row.lead_id ?? null)).inquiries += 1;
  }
  totals.enquiredLeads = enquiredLeads.size;

  const byService = [...byServiceMap.entries()]
    .map(([service, counts]) => ({ service, ...counts }))
    .sort((a, b) => b.opens + b.inquiries - (a.opens + a.inquiries));
  const byCategory = [...byCategoryMap.entries()]
    .map(([category, counts]) => ({ category, ...counts }))
    .sort((a, b) => b.clicks + b.views + b.inquiries - (a.clicks + a.views + a.inquiries));
  const bySource = [...bySourceMap.entries()]
    .map(([source, b]) => ({ source, visitors: b.visitors.size, views: b.views, inquiries: b.inquiries }))
    .sort((a, b) => b.views + b.inquiries - (a.views + a.inquiries));

  return Response.json({ ok: true, mode: "live", totals, byService, byCategory, bySource, recentEvents });
}
