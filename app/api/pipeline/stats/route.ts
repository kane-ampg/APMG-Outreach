import { requireLiveSupabase, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

/**
 * Aggregate lead statistics for the Overview KPI cards, the Pipeline stat strip
 * and the sidebar's Pipeline badge.
 *
 * REPLACES a browser-side fold over `GET /api/pipeline/leads`, which returns the
 * whole table (LIMIT 10000 — 8k rows ≈ 5.7 MB of JSON). Three components mounted
 * that read and two of them polled it every 15 seconds on every page, so an open
 * console tab was pulling ~1.4 GB/hour through Vercel just to render a handful of
 * numbers. That is what exhausted the Fast Origin Transfer allowance.
 *
 * The aggregation happens in Postgres (supabase/lead-stats.sql). PostgREST cannot
 * do it: aggregate functions are disabled on this project (`select=rating.avg()`
 * answers 400) and GROUP BY is not expressible in a PostgREST query at all.
 *
 * `tz` is the viewer's IANA zone and is forwarded to the RPC, which cuts the daily
 * histogram buckets at local midnight there — see the timezone note in
 * lib/data/buckets.ts, which this preserves rather than overrides.
 *
 * Degraded mode: if the SQL has not been applied yet the RPC 404s, and we fall
 * back to plain PostgREST `count=exact` HEAD probes. Those are still cheap (empty
 * bodies), so the transfer win holds; what's lost is `avgRating`, `folders` and
 * the histogram, and `needsMigration: true` says so.
 */
export const runtime = "nodejs";

const TABLE = "leads";
/** Rows behind the Overview's "Recent leads" table. */
const RECENT_LIMIT = 6;
/** Only what RecentLeadsTable renders — deliberately NOT featured_image or
 *  bing_maps_url, the two longest columns in the table. */
const RECENT_COLS = "id,name,address,website,phone,rating,emails,created_at";
const DAY_MS = 24 * 60 * 60 * 1000;
/**
 * Granularity of the ETag's time component. `addedToday` is a rolling 24-hour
 * count, so it decays without any import — an ETag keyed only on the data would
 * let a client hold a stale "New · 24h" indefinitely between imports. Bucketing
 * wall-clock to the minute means a poll revalidates to an empty 304 for the rest
 * of the minute and the readout is never more than ~60s behind.
 */
const ETAG_BUCKET_MS = 60_000;

type Target = { base: string; key: string };

export interface LeadStatsPayload {
  ok: true;
  mode: "live" | "demo";
  /** supabase/lead-stats.sql has not been applied — avgRating/folders/byDay are absent */
  needsMigration: boolean;
  total: number;
  withEmail: number;
  withPhone: number;
  withWebsite: number;
  ratedCount: number;
  avgRating: number | null;
  folders: number;
  latestImport: string | null;
  addedToday: number;
  /** day-grain counts, ascending, cut at local midnight in `tz` */
  byDay: { d: string; n: number }[];
  /** the zone actually used (an unknown `tz` degrades to UTC server-side) */
  tz: string;
  recent: unknown[];
}

/**
 * IANA zone names are letters, digits and `/_+-` (e.g. "Australia/Sydney",
 * "Etc/GMT+10", "America/Argentina/Buenos_Aires"). Anything else is dropped here
 * rather than forwarded; the RPC validates against pg_timezone_names as well, so
 * this is only about not shipping junk over the wire.
 */
function safeZone(raw: string | null): string {
  if (!raw || raw.length > 64) return "UTC";
  return /^[A-Za-z0-9/_+-]+$/.test(raw) ? raw : "UTC";
}

function headers(target: Target): Record<string, string> {
  return { apikey: target.key, Authorization: `Bearer ${target.key}` };
}

/** One `count=exact` HEAD probe → the row count, or null if the probe failed.
 *  HEAD means PostgREST answers with the Content-Range header and no body. */
async function countWhere(target: Target, filter: string): Promise<number | null> {
  try {
    const res = await fetch(`${target.base}/rest/v1/${TABLE}?select=id&limit=1${filter ? `&${filter}` : ""}`, {
      method: "HEAD",
      headers: { ...headers(target), Prefer: "count=exact" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    // "0-0/8052" — or "*/0" for an empty match.
    const total = res.headers.get("content-range")?.split("/")[1];
    const n = total ? Number.parseInt(total, 10) : Number.NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** Newest `RECENT_LIMIT` rows for the Overview table (~1 KB, not 5.7 MB). */
async function fetchRecent(target: Target): Promise<unknown[]> {
  try {
    const res = await fetch(
      `${target.base}/rest/v1/${TABLE}?select=${RECENT_COLS}` +
        `&order=created_at.desc,id.asc&limit=${RECENT_LIMIT}`,
      { headers: headers(target), cache: "no-store" },
    );
    if (!res.ok) return [];
    const rows = (await res.json().catch(() => null)) as unknown;
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

interface RpcStats {
  total?: number;
  withEmail?: number;
  withPhone?: number;
  withWebsite?: number;
  ratedCount?: number;
  avgRating?: number | string | null;
  folders?: number;
  latestImport?: string | null;
  addedToday?: number;
  byDay?: { d?: unknown; n?: unknown }[];
  tz?: string;
}

const int = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0);

/** `numeric` crosses PostgREST as a JSON number here, but avg() of a numeric
 *  column is the one field that could arrive as a string on a future driver. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function dayCounts(raw: RpcStats["byDay"]): { d: string; n: number }[] {
  if (!Array.isArray(raw)) return [];
  const out: { d: string; n: number }[] = [];
  for (const row of raw) {
    // Guard the shape: a bad row must not poison the whole histogram.
    if (typeof row?.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(row.d)) {
      out.push({ d: row.d, n: int(row.n) });
    }
  }
  return out;
}

/** The aggregate path: one RPC round trip. Returns null when the function is
 *  absent (migration not applied) so the caller can degrade. */
async function viaRpc(target: Target, zone: string): Promise<Omit<LeadStatsPayload, "ok" | "mode" | "recent"> | null> {
  let res: Response;
  try {
    res = await fetch(`${target.base}/rest/v1/rpc/pipeline_lead_stats`, {
      method: "POST",
      headers: { ...headers(target), "Content-Type": "application/json" },
      body: JSON.stringify({ p_tz: zone }),
      cache: "no-store",
    });
  } catch (e) {
    console.error("[pipeline/stats] RPC fetch failed:", e);
    return null;
  }
  // 404 = PGRST202, the function does not exist yet.
  if (res.status === 404) {
    console.warn("[pipeline/stats] pipeline_lead_stats is missing — run supabase/lead-stats.sql.");
    return null;
  }
  if (!res.ok) {
    console.error(`[pipeline/stats] RPC answered ${res.status}: ${await res.text().catch(() => "")}`);
    return null;
  }
  const data = (await res.json().catch(() => null)) as RpcStats | null;
  if (!data || typeof data !== "object") return null;

  return {
    needsMigration: false,
    total: int(data.total),
    withEmail: int(data.withEmail),
    withPhone: int(data.withPhone),
    withWebsite: int(data.withWebsite),
    ratedCount: int(data.ratedCount),
    avgRating: num(data.avgRating),
    folders: int(data.folders),
    latestImport: typeof data.latestImport === "string" ? data.latestImport : null,
    addedToday: int(data.addedToday),
    byDay: dayCounts(data.byDay),
    tz: typeof data.tz === "string" ? data.tz : zone,
  };
}

/**
 * Degraded path — count-only, no RPC needed. Every probe is a HEAD with an empty
 * body, so this is still ~1000× cheaper than reading the table; it just cannot
 * express avg(), count(distinct) or GROUP BY.
 */
async function viaCounts(target: Target, zone: string): Promise<Omit<LeadStatsPayload, "ok" | "mode" | "recent">> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const [total, withEmail, withPhone, withWebsite, ratedCount, addedToday, latestImport] = await Promise.all([
    countWhere(target, ""),
    // `emails` is `text[] not null default '{}'`, so "has an email" is a
    // non-empty array rather than a non-null column.
    countWhere(target, "emails=neq.%7B%7D"),
    countWhere(target, "and=(phone.not.is.null,phone.neq.)"),
    countWhere(target, "and=(website.not.is.null,website.neq.)"),
    countWhere(target, "rating=not.is.null"),
    countWhere(target, `created_at=gt.${encodeURIComponent(since)}`),
    (async () => {
      try {
        const res = await fetch(
          `${target.base}/rest/v1/${TABLE}?select=created_at&order=created_at.desc&limit=1`,
          { headers: headers(target), cache: "no-store" },
        );
        if (!res.ok) return null;
        const rows = (await res.json().catch(() => null)) as { created_at?: string }[] | null;
        return rows?.[0]?.created_at ?? null;
      } catch {
        return null;
      }
    })(),
  ]);

  return {
    needsMigration: true,
    total: total ?? 0,
    withEmail: withEmail ?? 0,
    withPhone: withPhone ?? 0,
    withWebsite: withWebsite ?? 0,
    ratedCount: ratedCount ?? 0,
    // Not derivable without aggregates. Null/0 renders as "—" and an empty
    // histogram, which is the honest answer; it is never a made-up number.
    avgRating: null,
    folders: 0,
    latestImport,
    addedToday: addedToday ?? 0,
    byDay: [],
    tz: zone,
  };
}

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "leads.view");
  if (!guard.ok) return guardResponse(guard);

  const blocked = requireLiveSupabase("pipeline/stats");
  if (blocked) return blocked;

  const target = supabaseTarget();
  if (target.state === "demo") {
    return Response.json({ ok: true, mode: "demo", needsMigration: false, total: 0 });
  }
  if (target.state === "misconfigured") {
    console.error("[pipeline/stats] SUPABASE_URL is not a valid URL.");
    return Response.json({ ok: false, error: "Importer is misconfigured." }, { status: 500 });
  }

  const zone = safeZone(new URL(req.url).searchParams.get("tz"));
  const [stats, recent] = await Promise.all([
    viaRpc(target, zone).then((r) => r ?? viaCounts(target, zone)),
    fetchRecent(target),
  ]);

  // Identity of this answer: the dataset (row count + newest row), the bucketing
  // zone, and the minute — see ETAG_BUCKET_MS. A matching If-None-Match means the
  // client already holds this exact body, so send no body at all.
  const stamp = Math.floor(Date.now() / ETAG_BUCKET_MS);
  const etag = `W/"${stats.total}-${stats.latestImport ?? "none"}-${zone}-${stats.needsMigration ? "d" : "a"}-${stamp}"`;
  const cache = {
    ETag: etag,
    // `no-cache` (not `no-store`): the browser MAY keep the body but MUST
    // revalidate before reuse. That is exactly what makes the 304 possible —
    // `no-store` would forbid the cached copy and force a full body every poll.
    "Cache-Control": "private, no-cache, must-revalidate",
  };
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: cache });
  }

  const payload: LeadStatsPayload = { ok: true, mode: "live", ...stats, recent };
  return Response.json(payload, { headers: cache });
}
