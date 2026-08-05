import {
  isMissingBatchColumn,
  isUuid,
  safeBatchName,
  sameOrigin,
  supabaseTarget,
  UNGROUPED,
} from "@/lib/pipeline/server";
import { countEmailsSentByLead } from "@/lib/portal/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// Reads back (GET) and deletes (DELETE) stored leads for the Pipeline view.
// Server-side (keeps the service role key off the browser).
export const runtime = "nodejs";

const TABLE = "leads";
// PostgREST silently caps every response at its max-rows setting (1000 by
// default), so the flat read pages through the table instead of trusting one
// big fetch. LIMIT bounds the total rows we'll return in one response.
const PAGE = 1000;
const LIMIT = 10000;
// the flat listing doesn't need the later-added columns; full reads add them on
const COLS_BASE =
  "id,name,address,featured_image,bing_maps_url,rating,website,phone,emails,social_medias,facebook,instagram,twitter,created_at";
const COLS = `${COLS_BASE},batch,category`;

type Target = { base: string; key: string };

/** Build a PostgREST filter for a batch ("folder") query param, or null. */
function batchFilter(value: string | null): string | null {
  if (!value) return null;
  if (value === UNGROUPED) return "batch=is.null";
  const safe = safeBatchName(value);
  return safe ? `batch=eq.${encodeURIComponent(safe)}` : null;
}

function fetchLeads(target: Target, cols: string, filter: string | null, offset = 0): Promise<Response> {
  // `id` tiebreaker: created_at ties (bulk imports) make the sort unstable
  // across page requests, which duplicates/drops rows at page boundaries.
  const url =
    `${target.base}/rest/v1/${TABLE}?select=${cols}&order=created_at.desc,id.asc&limit=${PAGE}&offset=${offset}` +
    (filter ? `&${filter}` : "");
  return fetch(url, {
    headers: { apikey: target.key, Authorization: `Bearer ${target.key}`, Prefer: "count=exact" },
    cache: "no-store",
  });
}

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, mode: "live", rows: [], total: 0, error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "leads.view");
  if (!guard.ok) return guardResponse(guard);

  const target = supabaseTarget();
  if (target.state === "demo") {
    return Response.json({ ok: true, mode: "demo", rows: [], total: 0 });
  }
  if (target.state === "misconfigured") {
    console.error("[pipeline/leads] SUPABASE_URL is not a valid URL.");
    return Response.json({ ok: false, mode: "live", rows: [], total: 0, error: "Importer is misconfigured." }, { status: 500 });
  }

  const filter = batchFilter(new URL(req.url).searchParams.get("batch"));

  // Track the column set that succeeds so follow-up pages request the same one.
  let cols = COLS;
  let res: Response;
  try {
    res = await fetchLeads(target, cols, filter);
  } catch (e) {
    console.error("[pipeline/leads] fetch to Supabase failed:", e);
    return Response.json({ ok: false, mode: "live", rows: [], total: 0, error: "Could not reach the database." }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[pipeline/leads] Supabase ${res.status}:`, detail.slice(0, 1000));

    if (isMissingBatchColumn(detail)) {
      // A folder filter genuinely needs `batch`; `category` is optional. Only
      // prompt the migration when the column the read actually depends on is
      // missing — otherwise degrade and retry without the optional column.
      const batchMissing = /batch/i.test(detail);
      if (filter && batchMissing) {
        return Response.json({ ok: false, mode: "live", rows: [], total: 0, needsMigration: true, error: "Folders need a one-time migration." }, { status: 422 });
      }
      // Filtered read with only `category` missing → keep the filter, drop
      // `category`. Flat listing → drop both optional columns.
      cols = filter ? `${COLS_BASE},batch` : COLS_BASE;
      try {
        res = await fetchLeads(target, cols, filter);
      } catch (e) {
        console.error("[pipeline/leads] degraded fetch failed:", e);
        return Response.json({ ok: false, mode: "live", rows: [], total: 0, error: "Could not reach the database." }, { status: 502 });
      }
      if (!res.ok) {
        const detail2 = await res.text().catch(() => "");
        console.error(`[pipeline/leads] degraded ${res.status}:`, detail2.slice(0, 500));
        // batch column missing on the degraded filtered retry → migration needed
        if (filter && isMissingBatchColumn(detail2)) {
          return Response.json({ ok: false, mode: "live", rows: [], total: 0, needsMigration: true, error: "Folders need a one-time migration." }, { status: 422 });
        }
        return Response.json({ ok: false, mode: "live", rows: [], total: 0, error: "Couldn't read the leads table." }, { status: 502 });
      }
      // fall through to the success path with the degraded response
    } else {
      const missingTable = res.status === 404 || /find the table|PGRST205/i.test(detail);
      return Response.json(
        {
          ok: false,
          mode: "live",
          rows: [],
          total: 0,
          error: missingTable
            ? "The leads table doesn't exist yet — run supabase/schema.sql in Supabase."
            : "Couldn't read the leads table.",
        },
        { status: 502 },
      );
    }
  }

  const rows = await res.json().catch(() => []);
  const range = res.headers.get("content-range") ?? "";
  const fromHeader = range.includes("/") ? Number(range.split("/")[1]) : NaN;
  const total = Number.isFinite(fromHeader) ? fromHeader : Array.isArray(rows) ? rows.length : 0;

  const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];

  // Page through the rest (PostgREST caps each response at max-rows; `total`
  // comes from the count=exact header). A failed later page just truncates the
  // listing rather than failing the whole read.
  while (list.length > 0 && list.length < Math.min(total, LIMIT)) {
    let pageRes: Response;
    try {
      pageRes = await fetchLeads(target, cols, filter, list.length);
    } catch (e) {
      console.error("[pipeline/leads] page fetch failed:", e);
      break;
    }
    if (!pageRes.ok) {
      const detail = await pageRes.text().catch(() => "");
      console.error(`[pipeline/leads] page ${pageRes.status}:`, detail.slice(0, 500));
      break;
    }
    const page = (await pageRes.json().catch(() => [])) as Array<Record<string, unknown>>;
    if (!Array.isArray(page) || page.length === 0) break;
    // rows written mid-pagination can still shift the offset window; never let
    // a lead appear twice in the merged listing (dup React keys client-side)
    const seen = new Set(list.map((r) => r.id));
    const fresh = page.filter((r) => !seen.has(r.id));
    if (fresh.length === 0) break;
    list.push(...fresh);
  }

  // Enrich each lead with how many outreach emails it has been sent (from the
  // email_sent ledger in portal_events). Best-effort: a failed/absent tally
  // just leaves the count at 0, never fails the leads read.
  const ids = list.map((r) => (typeof r.id === "string" ? r.id : "")).filter(Boolean);
  const sentByLead = await countEmailsSentByLead(target.base, target.key, ids);
  for (const r of list) {
    const id = typeof r.id === "string" ? r.id : "";
    r.emails_sent = id ? sentByLead.get(id) ?? 0 : 0;
  }

  return Response.json({ ok: true, mode: "live", rows: list, total });
}

/**
 * Rename a folder: set `batch` = newBatch on every row currently in oldBatch.
 * Body: { batch: <current folder>, newBatch: <new name> }. The Ungrouped
 * bucket (null batch) can't be renamed — it's the "no folder" bucket.
 */
export async function PATCH(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, mode: "live", error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "pipeline.import");
  if (!guard.ok) return guardResponse(guard);

  const body = (await req.json().catch(() => null)) as
    | { batch?: unknown; newBatch?: unknown }
    | null;

  // The Ungrouped bucket is `batch IS NULL` and has no real name to rename.
  const oldBatch = safeBatchName(body?.batch);
  const newBatch = safeBatchName(body?.newBatch);
  if (!oldBatch || !newBatch) {
    return Response.json(
      { ok: false, mode: "live", error: "A valid current and new folder name are required (letters, numbers, . _ -; up to 80 chars)." },
      { status: 400 },
    );
  }
  if (oldBatch === newBatch) {
    return Response.json({ ok: true, mode: "live", updated: 0 });
  }

  const target = supabaseTarget();
  if (target.state === "demo") {
    return Response.json({ ok: true, mode: "demo", updated: 0 });
  }
  if (target.state === "misconfigured") {
    console.error("[pipeline/leads] SUPABASE_URL is not a valid URL.");
    return Response.json({ ok: false, mode: "live", error: "Importer is misconfigured." }, { status: 500 });
  }

  // Guard against merging into an existing folder unless the caller opts in.
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (!force) {
    try {
      const check = await fetch(
        `${target.base}/rest/v1/${TABLE}?select=id&batch=eq.${encodeURIComponent(newBatch)}&limit=1`,
        {
          headers: { apikey: target.key, Authorization: `Bearer ${target.key}` },
          cache: "no-store",
        },
      );
      if (check.ok) {
        const existing = (await check.json().catch(() => [])) as unknown[];
        if (Array.isArray(existing) && existing.length > 0) {
          return Response.json(
            { ok: false, mode: "live", conflict: true, error: `A folder named “${newBatch}” already exists.` },
            { status: 409 },
          );
        }
      }
    } catch (e) {
      console.error("[pipeline/leads] rename conflict check failed:", e);
      // fall through — the rename below is still safe (just may merge)
    }
  }

  let res: Response;
  try {
    res = await fetch(
      `${target.base}/rest/v1/${TABLE}?batch=eq.${encodeURIComponent(oldBatch)}&select=id`,
      {
        method: "PATCH",
        headers: {
          apikey: target.key,
          Authorization: `Bearer ${target.key}`,
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ batch: newBatch }),
      },
    );
  } catch (e) {
    console.error("[pipeline/leads] rename fetch failed:", e);
    return Response.json({ ok: false, mode: "live", error: "Could not reach the database." }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[pipeline/leads] Supabase PATCH ${res.status}:`, detail.slice(0, 1000));
    if (isMissingBatchColumn(detail)) {
      return Response.json({ ok: false, mode: "live", needsMigration: true, error: "Folders need a one-time migration." }, { status: 422 });
    }
    return Response.json({ ok: false, mode: "live", error: "The database rejected the rename." }, { status: 502 });
  }

  const updatedRows = await res.json().catch(() => []);
  const updated = Array.isArray(updatedRows) ? updatedRows.length : 0;
  return Response.json({ ok: true, mode: "live", updated, batch: newBatch });
}

export async function DELETE(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, deleted: 0, mode: "live", error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "pipeline.import");
  if (!guard.ok) return guardResponse(guard);

  const params = new URL(req.url).searchParams;
  const idsParam = params.get("ids");
  const batchParam = params.get("batch");

  // Build EXACTLY one filter. Never issue an unfiltered DELETE (would wipe the table).
  let filter: string;
  if (idsParam) {
    const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
    if (ids.length === 0 || !ids.every(isUuid)) {
      return Response.json({ ok: false, deleted: 0, mode: "live", error: "Invalid row ids." }, { status: 400 });
    }
    filter = `id=in.(${ids.join(",")})`;
  } else {
    const bf = batchFilter(batchParam);
    if (!bf) {
      return Response.json({ ok: false, deleted: 0, mode: "live", error: "Nothing selected to delete." }, { status: 400 });
    }
    filter = bf;
  }

  const target = supabaseTarget();
  if (target.state === "demo") {
    return Response.json({ ok: true, deleted: 0, mode: "demo" });
  }
  if (target.state === "misconfigured") {
    console.error("[pipeline/leads] SUPABASE_URL is not a valid URL.");
    return Response.json({ ok: false, deleted: 0, mode: "live", error: "Importer is misconfigured." }, { status: 500 });
  }

  let res: Response;
  try {
    res = await fetch(`${target.base}/rest/v1/${TABLE}?${filter}&select=id`, {
      method: "DELETE",
      headers: {
        apikey: target.key,
        Authorization: `Bearer ${target.key}`,
        Prefer: "return=representation",
      },
    });
  } catch (e) {
    console.error("[pipeline/leads] delete fetch failed:", e);
    return Response.json({ ok: false, deleted: 0, mode: "live", error: "Could not reach the database." }, { status: 502 });
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[pipeline/leads] Supabase DELETE ${res.status}:`, detail.slice(0, 1000));
    if (isMissingBatchColumn(detail)) {
      return Response.json({ ok: false, deleted: 0, mode: "live", needsMigration: true, error: "Folders need a one-time migration." }, { status: 422 });
    }
    return Response.json({ ok: false, deleted: 0, mode: "live", error: "The database rejected the delete." }, { status: 502 });
  }

  const deletedRows = await res.json().catch(() => []);
  const deleted = Array.isArray(deletedRows) ? deletedRows.length : 0;
  return Response.json({ ok: true, deleted, mode: "live" });
}
