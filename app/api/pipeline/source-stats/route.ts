import { requireLiveSupabase, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { LEAD_SOURCES, sourceFilter, type LeadSource } from "@/lib/pipeline/source";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

/**
 * Lead inventory split by where it came from — Google Maps, Bing Maps or
 * LinkedIn — so the sources can be compared on the thing that actually decides
 * their worth: how many of their leads are contactable at all.
 *
 * Each figure is a `count=exact` HEAD probe (see lib/pipeline/source.ts).
 * Google/Bing are an ilike on `bing_maps_url`, so their split works
 * retroactively on every row ever imported; LinkedIn is the stored
 * `source = 'linkedin'` (supabase/linkedin-source.sql), since a contact has no
 * maps URL to read.
 *
 * DELIBERATELY NOT POLLED. This is its own route rather than extra fields on
 * /api/pipeline/stats because that one is polled by three mounted components;
 * adding 15 probes to every poll is how the Fast Origin Transfer allowance got
 * exhausted the last time. The Sources panel fetches this once, on demand.
 *
 * WHAT IT CANNOT ANSWER YET: send outcomes per source (sent / clicked / replied).
 * Those live in `portal_events`, which has no foreign key to `leads` by design
 * (leads get reimported and deleted), so PostgREST cannot embed or join it.
 * That comparison needs a SQL view — i.e. a migration — and is not faked here.
 */
export const runtime = "nodejs";

const TABLE = "leads";

/** Per-source counts. Every field is a row count, never an estimate. */
export interface SourceStat {
  source: LeadSource;
  total: number;
  withEmail: number;
  withWebsite: number;
  withPhone: number;
  engaged: number;
}

export interface SourceStatsPayload {
  ok: true;
  mode: "live" | "demo";
  sources: SourceStat[];
  /** `leads.engaged` is absent until supabase/portal-telemetry.sql is applied */
  engagedAvailable: boolean;
}

type Target = { base: string; key: string };

/** One `count=exact` HEAD probe → the row count, or null if the probe failed.
 *  HEAD means PostgREST answers with the Content-Range header and no body. */
async function countWhere(target: Target, filters: string[]): Promise<number | null> {
  const qs = filters.filter(Boolean).join("&");
  try {
    const res = await fetch(`${target.base}/rest/v1/${TABLE}?select=id&limit=1${qs ? `&${qs}` : ""}`, {
      method: "HEAD",
      headers: { apikey: target.key, Authorization: `Bearer ${target.key}`, Prefer: "count=exact" },
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

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "leads.view");
  if (!guard.ok) return guardResponse(guard);

  const blocked = requireLiveSupabase("pipeline/source-stats");
  if (blocked) return blocked;

  const target = supabaseTarget();
  if (target.state === "demo") {
    return Response.json({ ok: true, mode: "demo", sources: [], engagedAvailable: false });
  }
  if (target.state === "misconfigured") {
    console.error("[pipeline/source-stats] SUPABASE_URL is not a valid URL.");
    return Response.json({ ok: false, error: "Importer is misconfigured." }, { status: 500 });
  }

  // `emails` is `text[] not null default '{}'`, so "has an email" is a
  // non-empty array rather than a non-null column.
  const HAS_EMAIL = "emails=neq.%7B%7D";
  const HAS_WEBSITE = "and=(website.not.is.null,website.neq.)";
  const HAS_PHONE = "and=(phone.not.is.null,phone.neq.)";

  // A null from the engaged probe means the column isn't there yet (the portal
  // telemetry migration hasn't run). Report that rather than showing a zero
  // that reads as "nobody ever engaged".
  let engagedAvailable = true;

  // Before supabase/linkedin-source.sql there is no `source` column: the
  // LinkedIn probe errors (null), so LinkedIn is left out and the Unknown
  // filter must not name the column either.
  const legacy = (await countWhere(target, [sourceFilter("linkedin")])) === null;

  const sources = await Promise.all(
    LEAD_SOURCES.filter((s) => !(legacy && s === "linkedin")).map(async (source): Promise<SourceStat> => {
      const where = sourceFilter(source, { legacy });
      const [total, withEmail, withWebsite, withPhone, engaged] = await Promise.all([
        countWhere(target, [where]),
        countWhere(target, [where, HAS_EMAIL]),
        countWhere(target, [where, HAS_WEBSITE]),
        countWhere(target, [where, HAS_PHONE]),
        countWhere(target, [where, "engaged=is.true"]),
      ]);
      if (engaged === null) engagedAvailable = false;
      return {
        source,
        total: total ?? 0,
        withEmail: withEmail ?? 0,
        withWebsite: withWebsite ?? 0,
        withPhone: withPhone ?? 0,
        engaged: engaged ?? 0,
      };
    }),
  );

  const payload: SourceStatsPayload = { ok: true, mode: "live", sources, engagedAvailable };
  return Response.json(payload, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
