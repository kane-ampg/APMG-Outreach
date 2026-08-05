import { sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { isMissingPortalTable, portalAdminAuthorized } from "@/lib/portal/server";

// GET /api/portal/report?from=<ISO>&to=<ISO> — the numbers behind the
// Telemetry tab's "Export PDF" period report. Everything is scoped to the
// half-open window [from, to):
//
//   leads      — imported in the period, split by email reachability (a lead
//                with at least one address is "reachable"), plus all-time
//                context totals
//   outreach   — emails sent (the email_sent ledger the campaign send route
//                writes to portal_events), unique leads emailed, per-campaign
//                breakdown joined with that campaign's attribution clicks,
//                and unsubscribes recorded in the period
//   engagement — the portal funnel inside the period: attribution clicks,
//                portal views, service opens, enquiries, top services
//   inquiries  — the newest enquiries of the period (bounded), for the
//                report's detail table
//
// Aggregated in-route from bounded PostgREST windows (the repo's standing
// trade-off — see /api/portal/summary). True totals come from PostgREST
// count=exact even when a window caps the rows fetched for breakdowns.
//
// SECURITY — the report names businesses (enquiry rows) and quantifies the
// operator's outreach, so it sits behind the same PORTAL_ADMIN_KEY shared
// secret as /api/portal/lead-activity, on top of the sameOrigin (CSRF) floor.
export const runtime = "nodejs";

/** Widest report window we'll compute (guards runaway/garbage params). */
const MAX_RANGE_MS = 400 * 24 * 60 * 60 * 1000;
/** Row window per breakdown query — matched to send volumes (MAX_RECIPIENTS
 *  per campaign is far below this); count=exact keeps totals honest anyway. */
const ROWS_LIMIT = 10000;
/** Enquiry rows returned for the report's detail table. */
const INQUIRIES_LIMIT = 25;
const TOP_SERVICES_LIMIT = 8;

/** Must match SENT_EVENT in /api/pipeline/campaigns/send. */
const SENT_EVENT = "email_sent";

const FUNNEL_EVENTS = ["attribution_click", "portal_view", "portal_service_open", "portal_inquiry"] as const;

const EMPTY = {
  leads: { added: 0, withEmail: 0, withoutEmail: 0, totalAllTime: 0, withEmailAllTime: 0 },
  outreach: {
    emailsSent: 0,
    uniqueLeadsEmailed: 0,
    unsubscribes: 0,
    campaigns: [] as { campaign: string; sent: number; clicks: number }[],
  },
  engagement: {
    emailClicks: 0,
    uniqueLeadsClicked: 0,
    portalViews: 0,
    serviceOpens: 0,
    inquiries: 0,
    topServices: [] as { service: string; opens: number }[],
  },
  inquiries: [] as {
    business: string | null;
    name: string | null;
    service: string | null;
    category: string | null;
    ts: string;
  }[],
};

const UNAUTHORIZED = {
  ok: false as const,
  error: process.env.PORTAL_ADMIN_KEY
    ? "Unauthorised — a valid access key is required."
    : "Unauthorised — set PORTAL_ADMIN_KEY on the server to enable reports.",
};

/** Bounded GET returning the FIRST page plus an exact total (Content-Range). */
function restGet(base: string, key: string, pathAndQuery: string): Promise<Response> {
  return fetch(`${base}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
    cache: "no-store",
  });
}

/** Exact row total from a count=exact response ("0-24/137" → 137). */
function totalOf(res: Response): number {
  const range = res.headers.get("content-range") ?? "";
  const total = Number(range.split("/")[1]);
  return Number.isFinite(total) && total >= 0 ? total : 0;
}

function propStr(props: unknown, key: string): string | null {
  if (!props || typeof props !== "object") return null;
  const v = (props as Record<string, unknown>)[key];
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
  if (!portalAdminAuthorized(req)) {
    return Response.json({ ...UNAUTHORIZED, mode: "live", ...EMPTY }, { status: 401 });
  }
  if (target.state === "misconfigured") {
    console.error("[portal/report] SUPABASE_URL is not a valid URL.");
    return Response.json(
      { ok: false, mode: "live", ...EMPTY, error: "Portal storage is misconfigured." },
      { status: 500 },
    );
  }

  const url = new URL(req.url);
  const fromMs = Date.parse(url.searchParams.get("from") ?? "");
  const toMs = Date.parse(url.searchParams.get("to") ?? "");
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs || toMs - fromMs > MAX_RANGE_MS) {
    return Response.json(
      { ok: false, mode: "live", ...EMPTY, error: "A valid from/to date range is required." },
      { status: 400 },
    );
  }
  const from = new Date(fromMs).toISOString();
  const to = new Date(toMs).toISOString();
  /** Half-open window filter, ANDed into each query. */
  const win = `created_at=gte.${encodeURIComponent(from)}&created_at=lt.${encodeURIComponent(to)}`;

  let leadsAddedRes: Response;
  let leadsReachableRes: Response;
  let leadsAllRes: Response;
  let leadsAllReachableRes: Response;
  let sentRes: Response;
  let funnelRes: Response;
  let inquiriesRes: Response;
  let unsubRes: Response;
  try {
    [
      leadsAddedRes,
      leadsReachableRes,
      leadsAllRes,
      leadsAllReachableRes,
      sentRes,
      funnelRes,
      inquiriesRes,
      unsubRes,
    ] = await Promise.all([
      restGet(target.base, target.key, `leads?select=id&${win}&limit=1`),
      restGet(target.base, target.key, `leads?select=id&${win}&emails=neq.{}&limit=1`),
      restGet(target.base, target.key, `leads?select=id&limit=1`),
      restGet(target.base, target.key, `leads?select=id&emails=neq.{}&limit=1`),
      restGet(
        target.base,
        target.key,
        `portal_events?select=lead_id,campaign&event=eq.${SENT_EVENT}&${win}&limit=${ROWS_LIMIT}`,
      ),
      restGet(
        target.base,
        target.key,
        `portal_events?select=event,lead_id,campaign,props&event=in.(${FUNNEL_EVENTS.join(",")})&${win}&limit=${ROWS_LIMIT}`,
      ),
      restGet(
        target.base,
        target.key,
        `portal_inquiries?select=business,name,service_name,service_slug,category,created_at&${win}&order=created_at.desc&limit=${INQUIRIES_LIMIT}`,
      ),
      restGet(target.base, target.key, `email_suppression?select=id&${win}&limit=1`),
    ]);
  } catch (e) {
    console.error("[portal/report] fetch to Supabase failed:", e);
    return Response.json(
      { ok: false, mode: "live", ...EMPTY, error: "Could not reach the database." },
      { status: 502 },
    );
  }

  // The portal tables gate the whole report; email_suppression is optional
  // (its migration is separate) and degrades to zero unsubscribes.
  for (const res of [leadsAddedRes, leadsReachableRes, leadsAllRes, leadsAllReachableRes, sentRes, funnelRes, inquiriesRes]) {
    if (res.ok) continue;
    const detail = await res.text().catch(() => "");
    console.error(`[portal/report] Supabase ${res.status}:`, detail.slice(0, 1000));
    if (isMissingPortalTable(res.status, detail)) {
      return Response.json({ ok: true, mode: "demo", needsMigration: true, ...EMPTY });
    }
    return Response.json(
      { ok: false, mode: "live", ...EMPTY, error: "Couldn't read the report tables." },
      { status: 502 },
    );
  }

  // ── leads / reachability (exact counts; row bodies are ignored) ──────────
  const added = totalOf(leadsAddedRes);
  const withEmail = Math.min(totalOf(leadsReachableRes), added);
  const totalAllTime = totalOf(leadsAllRes);
  const withEmailAllTime = Math.min(totalOf(leadsAllReachableRes), totalAllTime);

  // ── outreach: the email_sent ledger ───────────────────────────────────────
  const sentRows = (await sentRes.json().catch(() => [])) as { lead_id?: unknown; campaign?: unknown }[];
  const emailsSent = totalOf(sentRes);
  const sentLeads = new Set<string>();
  const sentByCampaign = new Map<string, number>();
  for (const row of Array.isArray(sentRows) ? sentRows : []) {
    if (typeof row?.lead_id === "string" && row.lead_id) sentLeads.add(row.lead_id);
    const c = typeof row?.campaign === "string" && row.campaign ? row.campaign : "(untagged)";
    sentByCampaign.set(c, (sentByCampaign.get(c) ?? 0) + 1);
  }

  // ── engagement funnel inside the window ───────────────────────────────────
  const funnelRows = (await funnelRes.json().catch(() => [])) as {
    event?: unknown;
    lead_id?: unknown;
    campaign?: unknown;
    props?: unknown;
  }[];
  let emailClicks = 0;
  let portalViews = 0;
  let serviceOpens = 0;
  let inquiryEvents = 0;
  const clickedLeads = new Set<string>();
  const clicksByCampaign = new Map<string, number>();
  const opensByService = new Map<string, number>();
  for (const row of Array.isArray(funnelRows) ? funnelRows : []) {
    if (typeof row?.event !== "string") continue;
    if (row.event === "attribution_click") {
      emailClicks += 1;
      if (typeof row.lead_id === "string" && row.lead_id) clickedLeads.add(row.lead_id);
      const c = typeof row.campaign === "string" && row.campaign ? row.campaign : "(untagged)";
      clicksByCampaign.set(c, (clicksByCampaign.get(c) ?? 0) + 1);
    } else if (row.event === "portal_view") {
      portalViews += 1;
    } else if (row.event === "portal_service_open") {
      serviceOpens += 1;
      const service = propStr(row.props, "service");
      if (service) opensByService.set(service, (opensByService.get(service) ?? 0) + 1);
    } else if (row.event === "portal_inquiry") {
      inquiryEvents += 1;
    }
  }

  const campaigns = [...sentByCampaign.entries()]
    .map(([campaign, sent]) => ({ campaign, sent, clicks: clicksByCampaign.get(campaign) ?? 0 }))
    .sort((a, b) => b.sent - a.sent);
  // Clicks on campaigns whose sends fall OUTSIDE the window (e.g. sent last
  // month, clicked this week) still belong in the report — list them too.
  for (const [campaign, clicks] of clicksByCampaign) {
    if (!sentByCampaign.has(campaign)) campaigns.push({ campaign, sent: 0, clicks });
  }

  const topServices = [...opensByService.entries()]
    .map(([service, opens]) => ({ service, opens }))
    .sort((a, b) => b.opens - a.opens)
    .slice(0, TOP_SERVICES_LIMIT);

  // ── enquiries (server-canonical table, newest first) ─────────────────────
  const inquiryRows = (await inquiriesRes.json().catch(() => [])) as {
    business?: unknown;
    name?: unknown;
    service_name?: unknown;
    service_slug?: unknown;
    category?: unknown;
    created_at?: unknown;
  }[];
  const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
  const inquiries = (Array.isArray(inquiryRows) ? inquiryRows : [])
    .filter((r) => typeof r?.created_at === "string")
    .map((r) => ({
      business: str(r.business),
      name: str(r.name),
      service: str(r.service_name) ?? str(r.service_slug),
      category: str(r.category),
      ts: r.created_at as string,
    }));
  // Prefer the canonical table's exact count; the event tally is the fallback
  // for windows before the table existed.
  const inquiriesTotal = Math.max(totalOf(inquiriesRes), inquiryEvents);

  // Optional table — missing migration (or any error) just reads as zero.
  const unsubscribes = unsubRes.ok ? totalOf(unsubRes) : 0;

  return Response.json({
    ok: true,
    mode: "live",
    range: { from, to },
    leads: {
      added,
      withEmail,
      withoutEmail: added - withEmail,
      totalAllTime,
      withEmailAllTime,
    },
    outreach: {
      emailsSent,
      uniqueLeadsEmailed: sentLeads.size,
      unsubscribes,
      campaigns,
    },
    engagement: {
      emailClicks,
      uniqueLeadsClicked: clickedLeads.size,
      portalViews,
      serviceOpens,
      inquiries: inquiriesTotal,
      topServices,
    },
    inquiries,
  });
}
