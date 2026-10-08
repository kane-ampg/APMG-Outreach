import { toRange } from "@/lib/data/performance";
import { requireLiveSupabase, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import {
  PERFORMANCE_EVENTS,
  readSince,
  safePerformanceZone,
  tallyPerformance,
  type PerfEventRow,
  type PerfInquiryRow,
} from "@/lib/portal/performance";
import {
  performanceCacheKey,
  readCachedPerformance,
  writeCachedPerformance,
} from "@/lib/portal/performanceCache";
import { isMissingColumn, isMissingPortalTable, readAllRows, type RowsRead } from "@/lib/portal/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// GET /api/performance?days=28&tz=Australia/Melbourne[&fresh=1] — the
// Performance tab: the customer portal's clicks by day, by kind and by
// service, over the last `days` days and the same span before it. The tally
// lives in lib/portal/performance.ts; this route reads the rows and answers.
//
// Not under /api/portal/ on purpose: that prefix is served on the customer
// host, and this is an admin view. Here it sits behind the session gate in
// proxy.ts, and behind telemetry.view below.
//
// CACHED, NOT POLLED. A finished tally is kept for five minutes in Vercel's
// Runtime Cache (lib/portal/performanceCache.ts), so opening the tab again, or
// another admin opening it, doesn't page through months of events a second
// time. `fresh=1` (the page's Refresh button) skips the read and stores the new
// tally for everyone. The permission check runs first either way. The page
// never asks on a timer (the free-tier transfer budget is the constraint).
//
// The RESPONSE is never cacheable: `private, no-store` keeps an admin payload
// out of the CDN and the browser's HTTP cache. The page keeps its own copy.
export const runtime = "nodejs";

/** Total order for the paged reads; see readAllRows for why ascending. */
const PAGED_ORDER = "order=created_at.asc,id.asc";

/** HIT / MISS / BYPASS, for whoever is reading the network tab. */
type CacheState = "HIT" | "MISS" | "BYPASS";

function json(body: unknown, init: { status?: number; cache?: CacheState } = {}): Response {
  const headers: Record<string, string> = { "Cache-Control": "private, no-store" };
  if (init.cache) headers["X-Performance-Cache"] = init.cache;
  return Response.json(body, { status: init.status ?? 200, headers });
}

function emptyBody(days: number, tz: string) {
  return tallyPerformance({ events: [], inquiries: [], days: toRange(days), tz, now: new Date() });
}

/** A read that failed: the migration banner when the portal tables are
 *  missing, a 502 otherwise. Neither is cached. */
function storageFailure(status: number, detail: string, days: number, tz: string): Response {
  console.error(`[performance] Supabase ${status}:`, detail.slice(0, 1000));
  if (isMissingPortalTable(status, detail)) {
    return json({ ok: true, mode: "demo", needsMigration: true, ...emptyBody(days, tz) });
  }
  return json(
    { ok: false, mode: "live", ...emptyBody(days, tz), error: "Couldn't read the portal tables." },
    { status: 502 },
  );
}

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return json({ ok: false, error: "Forbidden." }, { status: 403 });
  }
  const guard = await requirePermission(req, "telemetry.view");
  if (!guard.ok) {
    const denied = guardResponse(guard);
    return json(await denied.json(), { status: denied.status });
  }

  const params = new URL(req.url).searchParams;
  const days = toRange(params.get("days"));
  const tz = safePerformanceZone(params.get("tz"));
  const fresh = params.get("fresh") === "1";

  const target = supabaseTarget();
  const blocked = requireLiveSupabase("performance");
  if (blocked) return json(await blocked.json(), { status: blocked.status });
  if (target.state === "demo") {
    return json({ ok: true, mode: "demo", ...emptyBody(days, tz) });
  }
  if (target.state === "misconfigured") {
    console.error("[performance] SUPABASE_URL is not a valid URL.");
    return json(
      { ok: false, mode: "live", ...emptyBody(days, tz), error: "Portal storage is misconfigured." },
      { status: 500 },
    );
  }

  const now = new Date();
  const key = performanceCacheKey(days, tz, now);
  if (!fresh) {
    const hit = await readCachedPerformance(key);
    if (hit) return json({ ok: true, mode: "live", ...hit.tally, computedAt: hit.computedAt }, { cache: "HIT" });
  }

  const since = encodeURIComponent(readSince(days, now));
  const eventsQuery =
    `portal_events?select=event,created_at,lead_id,visitor_id,ua,service:props->>service,source:props->>source` +
    `&event=in.(${PERFORMANCE_EVENTS.join(",")})&created_at=gte.${since}&${PAGED_ORDER}`;
  const inquiriesQuery = (cols: string) =>
    `portal_inquiries?select=${cols}&created_at=gte.${since}&${PAGED_ORDER}`;

  let events: RowsRead;
  let inquiries: RowsRead;
  try {
    [events, inquiries] = await Promise.all([
      readAllRows(target.base, target.key, eventsQuery),
      readAllRows(target.base, target.key, inquiriesQuery("service_slug,lead_id,source,created_at")),
    ]);
    // `source` not migrated in yet: count enquiries without it (they fall
    // back to outreach/direct) rather than failing the tab.
    if (!inquiries.ok && isMissingColumn(inquiries.detail)) {
      inquiries = await readAllRows(target.base, target.key, inquiriesQuery("service_slug,lead_id,created_at"));
    }
  } catch (e) {
    console.error("[performance] fetch to Supabase failed:", e);
    return json(
      { ok: false, mode: "live", ...emptyBody(days, tz), error: "Could not reach the database." },
      { status: 502 },
    );
  }
  if (!events.ok) return storageFailure(events.status, events.detail, days, tz);
  if (!inquiries.ok) return storageFailure(inquiries.status, inquiries.detail, days, tz);

  const tally = tallyPerformance({
    events: events.rows as PerfEventRow[],
    inquiries: inquiries.rows as PerfInquiryRow[],
    days,
    tz,
    now,
  });
  const computedAt = now.toISOString();
  await writeCachedPerformance(key, { tally, computedAt });
  return json({ ok: true, mode: "live", ...tally, computedAt }, { cache: fresh ? "BYPASS" : "MISS" });
}
