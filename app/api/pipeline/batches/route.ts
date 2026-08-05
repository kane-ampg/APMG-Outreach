import { isMissingBatchColumn, sameOrigin, supabaseTarget, UNGROUPED } from "@/lib/pipeline/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// Lists the import "folders" (distinct batch values) with a count + latest time.
// PostgREST grouping is finicky across versions, so we fetch the (small) batch
// column for all rows and group here — robust and version-independent.
export const runtime = "nodejs";

const TABLE = "leads";
// PostgREST silently caps every response at its max-rows setting (1000 by
// default) no matter how large a `limit` we ask for, so we page through the
// table instead of trusting one big fetch.
const PAGE = 1000;
const LIMIT = 50000;

interface BatchSummary {
  batch: string; // the folder name, or UNGROUPED sentinel for null
  count: number;
  created: string | null; // latest created_at in the folder
}

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, mode: "live", batches: [], error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "pipeline.view");
  if (!guard.ok) return guardResponse(guard);

  const target = supabaseTarget();
  if (target.state === "demo") {
    return Response.json({ ok: true, mode: "demo", batches: [] });
  }
  if (target.state === "misconfigured") {
    console.error("[pipeline/batches] SUPABASE_URL is not a valid URL.");
    return Response.json({ ok: false, mode: "live", batches: [], error: "Importer is misconfigured." }, { status: 500 });
  }

  const map = new Map<string, BatchSummary>();
  let offset = 0;
  while (offset < LIMIT) {
    const endpoint =
      `${target.base}/rest/v1/${TABLE}?select=batch,created_at&order=created_at.desc,id.asc` +
      `&limit=${PAGE}&offset=${offset}`;
    let res: Response;
    try {
      res = await fetch(endpoint, {
        headers: { apikey: target.key, Authorization: `Bearer ${target.key}` },
        cache: "no-store",
      });
    } catch (e) {
      console.error("[pipeline/batches] fetch to Supabase failed:", e);
      return Response.json({ ok: false, mode: "live", batches: [], error: "Could not reach the database." }, { status: 502 });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[pipeline/batches] Supabase ${res.status}:`, detail.slice(0, 1000));
      if (isMissingBatchColumn(detail)) {
        return Response.json({ ok: false, mode: "live", batches: [], needsMigration: true, error: "Folders need a one-time migration." }, { status: 422 });
      }
      const missingTable = res.status === 404 || /find the table|PGRST205/i.test(detail);
      return Response.json(
        {
          ok: false,
          mode: "live",
          batches: [],
          error: missingTable
            ? "The leads table doesn't exist yet — run supabase/schema.sql in Supabase."
            : "Couldn't read folders.",
        },
        { status: 502 },
      );
    }

    const rows = (await res.json().catch(() => [])) as Array<{ batch: string | null; created_at: string | null }>;
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      const key = r.batch ?? UNGROUPED;
      const cur = map.get(key);
      if (cur) {
        cur.count += 1;
        if (r.created_at && (!cur.created || r.created_at > cur.created)) cur.created = r.created_at;
      } else {
        map.set(key, { batch: key, count: 1, created: r.created_at ?? null });
      }
    }
    // a short page means we've read the whole table
    if (rows.length < PAGE) break;
    offset += rows.length;
  }

  // newest folder first; the Ungrouped bucket always sinks to the bottom
  const batches = [...map.values()].sort((a, b) => {
    if (a.batch === UNGROUPED) return 1;
    if (b.batch === UNGROUPED) return -1;
    return (b.created ?? "").localeCompare(a.created ?? "");
  });

  return Response.json({ ok: true, mode: "live", batches });
}
