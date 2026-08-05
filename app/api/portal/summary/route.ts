import { sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { isMissingColumn, isMissingPortalTable } from "@/lib/portal/server";
import { DIRECT_SOURCE, OUTREACH_SOURCE } from "@/lib/portal/source";

// GET /api/portal/summary — the aggregation behind the admin Enquiries tab:
// funnel totals (email click → portal visit → service open → enquiry), the
// per-service and per-sector breakdowns, and a short recent-events feed.
// Aggregated here in the route (last 2000 events / 500 enquiries) rather than
// in SQL so the read stays one pair of plain PostgREST GETs like every other
// route in this repo — at portal traffic volumes that's plenty.
// Server-side (keeps the service role key off the browser).
export const runtime = "nodejs";

const EVENTS_LIMIT = 2000;
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

/** Bucket label for visitors with no attributed lead (typed the URL, forwarded
 *  link, cookie expired…). */
const DIRECT = "Direct / unknown";

type EventRow = {
  event: string;
  props: Record<string, unknown> | null;
  lead_id: string | null;
  campaign: string | null;
  category: string | null;
  visitor_id: string | null;
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
  totals: { attributionClicks: 0, portalViews: 0, serviceOpens: 0, inquiries: 0, uniqueVisitors: 0 },
  byService: [] as Array<{ service: string; opens: number; inquiries: number }>,
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

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, mode: "live", ...EMPTY_SUMMARY, error: "Forbidden." }, { status: 403 });
  }

  const target = supabaseTarget();
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

  let eventsRes: Response;
  let inquiriesRes: Response;
  try {
    [eventsRes, inquiriesRes] = await Promise.all([
      restGet(
        target.base,
        target.key,
        `portal_events?select=event,props,lead_id,campaign,category,visitor_id,created_at&order=created_at.desc&limit=${EVENTS_LIMIT}`,
      ),
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

  for (const res of [eventsRes, inquiriesRes]) {
    if (res.ok) continue;
    const detail = await res.text().catch(() => "");
    console.error(`[portal/summary] Supabase ${res.status}:`, detail.slice(0, 1000));
    if (isMissingPortalTable(res.status, detail)) {
      // Migration not run yet → answer demo so the admin tab shows the "run
      // supabase/portal-telemetry.sql" banner instead of a hard error.
      return Response.json({ ok: true, mode: "demo", needsMigration: true, ...EMPTY_SUMMARY });
    }
    return Response.json({ ok: false, mode: "live", ...EMPTY_SUMMARY, error: "Couldn't read the portal tables." }, { status: 502 });
  }

  const eventRowsRaw = (await eventsRes.json().catch(() => [])) as EventRow[];
  const inquiryRowsRaw = (await inquiriesRes.json().catch(() => [])) as InquiryRow[];
  const eventRows = Array.isArray(eventRowsRaw) ? eventRowsRaw : [];
  const inquiryRows = Array.isArray(inquiryRowsRaw) ? inquiryRowsRaw : [];

  // ── aggregate ──────────────────────────────────────────────────────────────
  const totals = { attributionClicks: 0, portalViews: 0, serviceOpens: 0, inquiries: 0, uniqueVisitors: 0 };
  const visitors = new Set<string>();
  const byServiceMap = new Map<string, { opens: number; inquiries: number }>();
  const byCategoryMap = new Map<string, { clicks: number; views: number; inquiries: number }>();
  const bySourceMap = new Map<string, { visitors: Set<string>; views: number; inquiries: number }>();
  const recentEvents: typeof EMPTY_SUMMARY.recentEvents = [];

  const serviceBucket = (service: string) => {
    let b = byServiceMap.get(service);
    if (!b) byServiceMap.set(service, (b = { opens: 0, inquiries: 0 }));
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

  for (const row of eventRows) {
    if (!row || !PORTAL_EVENT_NAMES.has(row.event)) continue;
    const rawService = row.props?.service;
    const service = typeof rawService === "string" && rawService ? rawService : null;
    const rawSource = row.props?.source;
    const source = typeof rawSource === "string" && rawSource ? rawSource : null;

    if (row.event === "attribution_click") {
      totals.attributionClicks += 1;
      categoryBucket(row.category ?? DIRECT).clicks += 1;
    } else if (row.event === "portal_view") {
      totals.portalViews += 1;
      categoryBucket(row.category ?? DIRECT).views += 1;
      if (row.visitor_id) visitors.add(row.visitor_id);
      const src = sourceBucket(channelOf(source, row.lead_id));
      src.views += 1;
      if (row.visitor_id) src.visitors.add(row.visitor_id);
    } else if (row.event === "portal_service_open") {
      totals.serviceOpens += 1;
      if (service) serviceBucket(service).opens += 1;
    }

    // rows arrive newest-first, so the first 30 portal-relevant ones = recent feed
    if (recentEvents.length < RECENT_LIMIT) {
      recentEvents.push({
        event: row.event,
        service,
        category: row.category ?? null,
        campaign: row.campaign ?? null,
        source,
        createdAt: row.created_at,
      });
    }
  }

  // Enquiry counts come from portal_inquiries — the canonical store — rather
  // than the (best-effort, client-influenced) telemetry events.
  totals.inquiries = inquiryRows.length;
  totals.uniqueVisitors = visitors.size;
  for (const row of inquiryRows) {
    if (!row) continue;
    serviceBucket(row.service_slug || "general").inquiries += 1;
    categoryBucket(row.category ?? DIRECT).inquiries += 1;
    sourceBucket(channelOf(row.source ?? null, row.lead_id ?? null)).inquiries += 1;
  }

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
