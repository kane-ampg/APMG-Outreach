import type { LeadImportRow } from "@/lib/pipeline/csv";
import {
  isMissingBatchColumn,
  safeBatchName,
  sameOrigin,
  supabaseTarget,
} from "@/lib/pipeline/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// Receives a batch of parsed leads from the Pipeline tool and inserts them into
// Supabase via the PostgREST endpoint. Runs on Node (keeps the service role key
// server-side — it is never shipped to the browser).
export const runtime = "nodejs";

const TABLE = "leads";
const MAX_BATCH = 1000;

type UploadMode = "live" | "demo" | "noop";

interface UploadResult {
  ok: boolean;
  inserted: number;
  mode: UploadMode;
  batch?: string | null;
  needsMigration?: boolean;
  error?: string;
}

/**
 * Whitelist a client row down to the 13 stored columns. `id`/`created_at`/`batch`
 * are never taken from the row (the DB defaults / the request's top-level batch
 * win), so a caller can't forge them. Returns null for rows without a name.
 */
function sanitizeRow(input: unknown): LeadImportRow | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;

  const name = typeof o.name === "string" ? o.name.trim() : "";
  if (!name) return null;

  const str = (v: unknown): string | null =>
    typeof v === "string" && v.trim() ? v.trim() : null;
  const strArr = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim())
      : [];
  const num = (v: unknown): number | null => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };

  return {
    name,
    address: str(o.address),
    featured_image: str(o.featured_image),
    bing_maps_url: str(o.bing_maps_url),
    rating: num(o.rating),
    category: str(o.category),
    website: str(o.website),
    phone: str(o.phone),
    emails: strArr(o.emails),
    social_medias: strArr(o.social_medias),
    facebook: str(o.facebook),
    instagram: str(o.instagram),
    twitter: str(o.twitter),
  };
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return json({ ok: false, inserted: 0, mode: "noop", error: "Forbidden." }, 403);
  }

  const guard = await requirePermission(req, "pipeline.import");
  if (!guard.ok) return guardResponse(guard);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, inserted: 0, mode: "noop", error: "Invalid JSON body." }, 400);
  }

  const raw = (body as { rows?: unknown })?.rows;
  if (!Array.isArray(raw)) {
    return json({ ok: false, inserted: 0, mode: "noop", error: "Expected { rows: [...] }." }, 400);
  }
  if (raw.length > MAX_BATCH) {
    return json(
      { ok: false, inserted: 0, mode: "noop", error: `Batch too large (max ${MAX_BATCH} rows).` },
      413,
    );
  }

  // the import "folder" this batch belongs to (server-applied to every row)
  const batch = safeBatchName((body as { batch?: unknown })?.batch);

  const sanitized = raw.map(sanitizeRow).filter((r): r is LeadImportRow => r !== null);
  if (sanitized.length === 0) {
    return json({ ok: true, inserted: 0, mode: "noop", batch });
  }
  const rows = sanitized.map((r) => ({ ...r, batch }));

  const target = supabaseTarget();
  // Demo mode — credentials not configured yet. Simulate a successful write so
  // the pipeline UI is fully exercisable before Supabase is wired up.
  if (target.state === "demo") {
    return json({ ok: true, inserted: rows.length, mode: "demo", batch });
  }
  if (target.state === "misconfigured") {
    console.error("[pipeline/upload] SUPABASE_URL is not a valid URL.");
    return json({ ok: false, inserted: 0, mode: "live", error: "Importer is misconfigured." }, 500);
  }

  let res: Response;
  try {
    res = await fetch(`${target.base}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: {
        apikey: target.key,
        Authorization: `Bearer ${target.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    });
  } catch (e) {
    console.error("[pipeline/upload] fetch to Supabase failed:", e);
    return json({ ok: false, inserted: 0, mode: "live", error: "Could not reach the database." }, 502);
  }

  if (!res.ok) {
    // Log upstream detail server-side only — never leak PostgREST schema internals.
    const detail = await res.text().catch(() => "");
    console.error(`[pipeline/upload] Supabase ${res.status}:`, detail.slice(0, 1000));
    if (isMissingBatchColumn(detail)) {
      return json(
        { ok: false, inserted: 0, mode: "live", needsMigration: true, error: "Folders need a one-time migration." },
        422,
      );
    }
    return json(
      { ok: false, inserted: 0, mode: "live", error: "The database rejected the import." },
      502,
    );
  }

  return json({ ok: true, inserted: rows.length, mode: "live", batch });
}

function json(result: UploadResult, status = 200): Response {
  return Response.json(result, { status });
}
