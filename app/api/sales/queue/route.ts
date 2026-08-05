import { bestEmail } from "@/lib/pipeline/campaign";
import { isUuid, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { isMissingPortalTable } from "@/lib/portal/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";
import { HANDOFF_EVENT } from "@/lib/sales/handoff";
import type { SalesQueueResponse, SalesQueueRow } from "@/lib/sales/queue";

// Paginated read of the Sales queue.
//
// THE GATE IS THE HAND-OFF, NOT THE SEND. A lead reaches Sales only because an
// admin passed it over from the Hot Leads tab — one `sales_handoff` row in
// portal_events per lead (/api/sales/handoff). Reps never see the raw outreach
// list: being emailed, or even clicking through, puts a lead on Hot Leads for
// ADMIN review, and nothing else. Newest hand-off first.
//
// (This used to key off the `email_sent` ledger, i.e. every lead the admin had
// emailed. That handed reps the whole outreach list, which is exactly what the
// hand-off step exists to prevent.)
//
// The send ledger is still read, but only to DECORATE each queued lead with its
// outreach history (how many emails, when, which campaign) — it can no longer
// put a lead in the queue on its own. Pagination is server-side (?page=&
// pageSize=) so the tab stays fast as the queue grows. Server-only (service
// role key).
export const runtime = "nodejs";

const SENT_EVENT = "email_sent";
// PostgREST caps each response at max-rows (1000 default) — page the ledger
// scans like /api/pipeline/leads does, bounded so a runaway table can't stall.
const EVENT_PAGE = 1000;
const EVENT_LIMIT = 20000;
const DEFAULT_PAGE_SIZE = 12;
const MAX_PAGE_SIZE = 48;
// How many of the newest hand-offs to decorate for the Sales overview's recent
// panel (independent of which page the rep is paged to).
const RECENT_ROWS = 6;
// Ceiling on the hand-off roll returned for the rep's overview + enquiry
// scoping. Well past any realistic queue; it only exists so an enormous ledger
// can't turn the response into a megabyte of ids and stamps.
const HANDOFF_LIMIT = 5000;

const LEAD_COLS = "id,name,address,rating,category,website,phone,emails,engaged,engaged_at";
// engaged/engaged_at arrive with portal-telemetry.sql; degrade without them
const LEAD_COLS_BASE = "id,name,address,rating,category,website,phone,emails";

type Target = { base: string; key: string };

function headers(key: string, extra?: Record<string, string>): HeadersInit {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Display form of a stored website: strip the scheme + trailing slash (the
 *  card links prepend https://). */
function cleanSite(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const t = s.replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return t || null;
}

/**
 * Page through one event name into rows, oldest first. Returns null when the
 * portal tables are missing (needsMigration), "error" on anything else.
 */
async function scanLedger(
  target: Target,
  event: string,
  label: string,
): Promise<Array<{ leadId: string; at: string; campaign: string | null }> | null | "error"> {
  const out: Array<{ leadId: string; at: string; campaign: string | null }> = [];
  let offset = 0;
  while (offset < EVENT_LIMIT) {
    let res: Response;
    try {
      res = await fetch(
        `${target.base}/rest/v1/portal_events?select=lead_id,campaign,created_at&event=eq.${event}` +
          `&lead_id=not.is.null&order=created_at.asc,id.asc&limit=${EVENT_PAGE}&offset=${offset}`,
        { headers: headers(target.key), cache: "no-store" },
      );
    } catch (e) {
      console.error(`[sales/queue] ${label} fetch failed:`, e);
      return "error";
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (isMissingPortalTable(res.status, detail)) return null;
      console.error(`[sales/queue] ${label} ${res.status}:`, detail.slice(0, 500));
      return "error";
    }
    const rows = (await res.json().catch(() => [])) as Array<{
      lead_id?: unknown;
      campaign?: unknown;
      created_at?: unknown;
    }>;
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      const id = typeof r.lead_id === "string" ? r.lead_id : "";
      if (!isUuid(id)) continue;
      out.push({
        leadId: id,
        at: typeof r.created_at === "string" ? r.created_at : "",
        campaign: str(r.campaign),
      });
    }
    if (rows.length < EVENT_PAGE) break;
    offset += rows.length;
  }
  return out;
}

interface SendMeta {
  sent: number;
  lastSentAt: string;
  campaign: string | null;
}

/** Tally how many of the queued leads have engaged (clicked the tracked link),
 *  via chunked count=exact reads. Best-effort — 0 on any failure. */
async function countEngaged(target: Target, ids: string[]): Promise<number> {
  const CHUNK = 200;
  let total = 0;
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      const res = await fetch(
        `${target.base}/rest/v1/leads?select=id&engaged=is.true&id=in.(${chunk.join(",")})&limit=1`,
        { headers: headers(target.key, { Prefer: "count=exact" }), cache: "no-store" },
      );
      if (!res.ok) return 0; // engaged column may not exist yet — nice-to-have only
      const range = res.headers.get("content-range") ?? "";
      const n = range.includes("/") ? Number(range.split("/")[1]) : NaN;
      if (Number.isFinite(n)) total += n;
    }
  } catch {
    return 0;
  }
  return total;
}

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return json({ ok: false, error: "Forbidden." }, 403);
  }

  const guard = await requirePermission(req, "sales.view");
  if (!guard.ok) return guardResponse(guard);

  const params = new URL(req.url).searchParams;
  const page = Math.max(1, Math.floor(Number(params.get("page")) || 1));
  const pageSize = Math.min(
    MAX_PAGE_SIZE,
    Math.max(1, Math.floor(Number(params.get("pageSize")) || DEFAULT_PAGE_SIZE)),
  );

  const target = supabaseTarget();
  if (target.state === "demo") {
    return json({ ok: true, mode: "demo", page, pageSize });
  }
  if (target.state === "misconfigured") {
    console.error("[sales/queue] SUPABASE_URL is not a valid URL.");
    return json({ ok: false, page, pageSize, error: "The importer is misconfigured." }, 500);
  }

  // ── the gate: what admin has handed over ─────────────────────────────────
  const handoffRows = await scanLedger(target, HANDOFF_EVENT, "handoff ledger");
  if (handoffRows === "error") {
    return json({ ok: false, page, pageSize, error: "Couldn't read the hand-off ledger." }, 502);
  }
  if (handoffRows === null) {
    // No portal_events table yet → nothing has ever been handed over.
    return json({ ok: true, page, pageSize, needsMigration: true });
  }

  // ASC scan ⇒ the first row per lead is its original hand-off. That stamp is
  // the queue's ordering key, so a re-hand can't jump an old lead to the top.
  const handedAt = new Map<string, string>();
  for (const r of handoffRows) if (!handedAt.has(r.leadId)) handedAt.set(r.leadId, r.at);

  const orderedIds = [...handedAt.entries()]
    .sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0)) // newest hand-off first
    .map(([id]) => id);
  const total = orderedIds.length;
  // Watermark for the Sales desk poll: the newest hand-off anywhere in the
  // queue. orderedIds is already newest-first, so it is the head.
  const latestHandoffAt = total > 0 ? handedAt.get(orderedIds[0]) ?? "" : "";
  if (total === 0) {
    return json({ ok: true, total: 0, engagedTotal: 0, latestHandoffAt, page, pageSize });
  }

  // The newest-first roll of what admin sent over: powers the rep's own volume
  // chart, 24h tally, and the enquiry scoping on the Enquiries tab.
  const handoffs = orderedIds
    .slice(0, HANDOFF_LIMIT)
    .map((id) => ({ leadId: id, at: handedAt.get(id) ?? "" }));

  const pageIds = orderedIds.slice((page - 1) * pageSize, page * pageSize);
  const engagedTotal = await countEngaged(target, orderedIds);
  if (pageIds.length === 0) {
    return json({ ok: true, total, engagedTotal, handoffs, latestHandoffAt, page, pageSize });
  }

  // The overview's "latest hand-offs" always means the head of the queue, so its
  // ids ride along with the page's in the single leads read below.
  const recentIds = orderedIds.slice(0, RECENT_ROWS);
  const fetchIds = [...new Set([...pageIds, ...recentIds])];

  // ── decoration only: outreach history for the leads already in the queue ──
  // A failure here costs the send counts, never the queue itself.
  const sendMeta = new Map<string, SendMeta>();
  const sentRows = await scanLedger(target, SENT_EVENT, "send ledger");
  if (Array.isArray(sentRows)) {
    const queued = new Set(orderedIds);
    for (const r of sentRows) {
      if (!queued.has(r.leadId)) continue;
      const cur = sendMeta.get(r.leadId);
      if (cur) {
        cur.sent += 1;
        // ASC scan ⇒ each later row is more recent than the one before.
        cur.lastSentAt = r.at;
        if (r.campaign) cur.campaign = r.campaign;
      } else {
        sendMeta.set(r.leadId, { sent: 1, lastSentAt: r.at, campaign: r.campaign });
      }
    }
  }

  // Join the fetched ids back to the leads table. Leads deleted/reimported since
  // the hand-off are silently skipped (their ledger rows outlive them by design).
  let cols = LEAD_COLS;
  let res: Response;
  try {
    res = await fetch(
      `${target.base}/rest/v1/leads?select=${cols}&id=in.(${fetchIds.join(",")})`,
      { headers: headers(target.key), cache: "no-store" },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (/engaged/i.test(detail)) {
        // pre-portal-telemetry schema — read without the engaged columns
        cols = LEAD_COLS_BASE;
        res = await fetch(
          `${target.base}/rest/v1/leads?select=${cols}&id=in.(${fetchIds.join(",")})`,
          { headers: headers(target.key), cache: "no-store" },
        );
      }
    }
  } catch (e) {
    console.error("[sales/queue] leads fetch failed:", e);
    return json({ ok: false, total, engagedTotal, page, pageSize, error: "Could not reach the database." }, 502);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[sales/queue] leads ${res.status}:`, detail.slice(0, 500));
    return json({ ok: false, total, engagedTotal, page, pageSize, error: "Couldn't read the leads table." }, 502);
  }

  const leadRows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
  const byId = new Map<string, Record<string, unknown>>();
  for (const r of Array.isArray(leadRows) ? leadRows : []) {
    if (typeof r.id === "string") byId.set(r.id, r);
  }

  /** One queued lead in card shape, or null if the lead row is gone. */
  function toRow(id: string): SalesQueueRow | null {
    const lead = byId.get(id);
    if (!lead) return null;
    const meta = sendMeta.get(id);
    const emails = Array.isArray(lead.emails)
      ? lead.emails.filter((e): e is string => typeof e === "string")
      : [];
    return {
      id,
      business: str(lead.name) ?? "Unknown business",
      category: str(lead.category),
      location: str(lead.address),
      website: cleanSite(lead.website),
      phone: str(lead.phone),
      email: bestEmail(emails),
      rating: typeof lead.rating === "number" && Number.isFinite(lead.rating) ? lead.rating : null,
      engaged: lead.engaged === true,
      engagedAt: str(lead.engaged_at),
      handedOffAt: handedAt.get(id) ?? "",
      lastSentAt: meta?.lastSentAt ?? "",
      emailsSent: meta?.sent ?? 0,
      campaign: meta?.campaign ?? null,
    };
  }

  const rows = pageIds.map(toRow).filter((r): r is SalesQueueRow => r !== null);
  const recent = recentIds.map(toRow).filter((r): r is SalesQueueRow => r !== null);

  return json({
    ok: true,
    rows,
    recent,
    total,
    engagedTotal,
    handoffs,
    latestHandoffAt,
    page,
    pageSize,
  });
}

function json(partial: Partial<SalesQueueResponse> & { ok: boolean }, status = 200): Response {
  const body: SalesQueueResponse = {
    mode: "live",
    rows: [],
    recent: [],
    total: 0,
    engagedTotal: 0,
    handoffs: [],
    latestHandoffAt: "",
    page: 1,
    pageSize: DEFAULT_PAGE_SIZE,
    ...partial,
  };
  return Response.json(body, { status });
}
