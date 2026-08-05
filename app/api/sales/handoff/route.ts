import { isUuid, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import {
  insertPortalEvents,
  isMissingPortalTable,
  portalAdminAuthorized,
  type PortalEventRow,
} from "@/lib/portal/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";
import {
  isMarkerKind,
  MARKER_EVENT,
  MAX_NOTE_LEN,
  type LeadMarker,
  type MarkerKind,
  type SalesHandoffResponse,
} from "@/lib/sales/handoff";

// The operator-decision ledgers behind the Hot Leads tab — hand-off to Sales,
// and archive-from-the-working-lists (see lib/sales/handoff.ts for what each
// means). Both are the same shape, so they share one endpoint:
//
//   GET                                → all three ledgers
//   POST   { leadIds, kind?, note? }   → mark leads ("handoff" by default)
//   DELETE ?leadId=&kind=              → unmark one
//
// Every response carries ALL THREE ledgers, so a client learns the full state
// of the flow in a single round trip.
//
// `returned` is the one kind with a side effect: sending a lead back also
// DELETES its hand-off rows. That's deliberate — the Sales queue's only gate is
// the hand-off, so clearing it is what actually removes the lead from the rep's
// list, and it means "returned" needs no special case in the queue route.
//
// Marking is IDEMPOTENT: a lead already in a ledger is skipped, never appended
// twice. That's what makes "send to Sales" un-repeatable — a second attempt
// (double-click, stale tab, retry after a flaky response) is a no-op rather
// than a duplicate hand-off, and the queue's ordering key stays the ORIGINAL
// hand-off time.
//
// SECURITY — responses name leads by the same uuid /t/[id] accepts, exactly
// like /api/portal/lead-activity, so the gates match: the sameOrigin
// (CSRF-only) floor PLUS the PORTAL_ADMIN_KEY shared secret, deny-by-default
// when unset. Server-side (service role key stays off the browser). Replace
// with real per-user auth when a session lands.
export const runtime = "nodejs";

/** Ledger scan bound — one row per marked lead, so this is generous. */
const LEDGER_LIMIT = 5000;
/** Most leads one POST may mark (the tab's page size is far below this). */
const MAX_PER_POST = 200;

const UNAUTHORIZED = {
  ok: false as const,
  error: process.env.PORTAL_ADMIN_KEY
    ? "Unauthorised — a valid access key is required."
    : "Unauthorised — set PORTAL_ADMIN_KEY on the server to manage hot leads.",
};

function json(partial: Partial<SalesHandoffResponse> & { ok: boolean }, status = 200): Response {
  const body: SalesHandoffResponse = {
    mode: "live",
    handoffs: [],
    archived: [],
    returned: [],
    ...partial,
  };
  return Response.json(body, { status });
}

function restHeaders(key: string, extra?: Record<string, string>): HeadersInit {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

/** What one ledger row means to us: when, and (returns only) why. */
type Mark = { at: string; note: string | null };
type Ledger = Map<string, Mark>;

/** Read one ledger into leadId → mark. null = table missing. */
async function readLedger(base: string, key: string, event: string): Promise<Ledger | null | "error"> {
  let res: Response;
  try {
    res = await fetch(
      `${base}/rest/v1/portal_events?select=lead_id,props,created_at&event=eq.${event}` +
        `&lead_id=not.is.null&order=created_at.asc&limit=${LEDGER_LIMIT}`,
      { headers: restHeaders(key), cache: "no-store" },
    );
  } catch (e) {
    console.error(`[sales/handoff] ${event} fetch failed:`, e);
    return "error";
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    if (isMissingPortalTable(res.status, detail)) return null;
    console.error(`[sales/handoff] ${event} ${res.status}:`, detail.slice(0, 500));
    return "error";
  }
  const rows = (await res.json().catch(() => [])) as Array<{
    lead_id?: unknown;
    props?: Record<string, unknown> | null;
    created_at?: unknown;
  }>;
  // ASC ⇒ the FIRST row seen for a lead is its original mark.
  const out: Ledger = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = typeof r.lead_id === "string" ? r.lead_id : "";
    if (!isUuid(id) || out.has(id)) continue;
    const rawNote = r.props ? r.props.note : undefined;
    out.set(id, {
      at: typeof r.created_at === "string" ? r.created_at : "",
      note: typeof rawNote === "string" && rawNote.trim() ? rawNote : null,
    });
  }
  return out;
}

function toMarkers(ledger: Ledger): LeadMarker[] {
  return [...ledger.entries()]
    .map(([leadId, m]) => ({ leadId, at: m.at, note: m.note }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)); // newest mark first
}

/** Read both ledgers at once.
 *
 *  The two failure modes are kept APART on purpose: "missing" means the table
 *  doesn't exist (run the migration) while "error" is a transient read failure.
 *  Collapsing them would tell an operator to run a migration that's already
 *  been run every time the database blips. */
type Ledgers = Record<MarkerKind, Ledger>;
type AllLedgers = { ok: true; ledgers: Ledgers } | { ok: false; reason: "missing" | "error" };

const KINDS: MarkerKind[] = ["handoff", "archived", "returned"];

async function readAll(base: string, key: string): Promise<AllLedgers> {
  const results = await Promise.all(KINDS.map((k) => readLedger(base, key, MARKER_EVENT[k])));
  if (results.some((r) => r === "error")) return { ok: false, reason: "error" };
  if (results.some((r) => r === null)) return { ok: false, reason: "missing" };
  const ledgers = {} as Ledgers;
  KINDS.forEach((k, i) => (ledgers[k] = results[i] as Ledger));
  return { ok: true, ledgers };
}

/** The response a failed read should produce on a READ path: a missing table
 *  degrades to demo (the tab shows its "run the SQL" banner), anything else is
 *  an honest 502. */
function readFailure(reason: "missing" | "error"): Response {
  return reason === "missing"
    ? json({ ok: true, mode: "demo", needsMigration: true })
    : json({ ok: false, error: "Couldn't read the hot-lead ledgers." }, 502);
}

function ledgersJson(l: Ledgers): Response {
  return json({
    ok: true,
    handoffs: toMarkers(l.handoff),
    archived: toMarkers(l.archived),
    returned: toMarkers(l.returned),
  });
}

/** Erase one lead's rows from one ledger. False on any failure (logged). */
async function deleteMarker(
  base: string,
  key: string,
  kind: MarkerKind,
  leadId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `${base}/rest/v1/portal_events?event=eq.${MARKER_EVENT[kind]}&lead_id=eq.${leadId}`,
      { method: "DELETE", headers: restHeaders(key, { Prefer: "return=minimal" }) },
    );
    if (res.ok) return true;
    const detail = await res.text().catch(() => "");
    console.error(`[sales/handoff] DELETE ${MARKER_EVENT[kind]} ${res.status}:`, detail.slice(0, 500));
    return false;
  } catch (e) {
    console.error("[sales/handoff] delete fetch failed:", e);
    return false;
  }
}

/** Shared preamble: origin floor → demo short-circuit → key gate → config
 *  check. Returns the live target, or the Response to send back instead. */
function gate(req: Request): { base: string; key: string } | Response {
  if (!sameOrigin(req)) return json({ ok: false, error: "Forbidden." }, 403);

  const target = supabaseTarget();
  if (target.state === "demo") {
    // No Supabase — the Hot Leads tab is on the demo preset and keeps its marks
    // in session state. Answer "demo" so it knows not to expect rows.
    return json({ ok: true, mode: "demo" });
  }
  if (!portalAdminAuthorized(req)) return json({ ...UNAUTHORIZED }, 401);
  if (target.state === "misconfigured") {
    console.error("[sales/handoff] SUPABASE_URL is not a valid URL.");
    return json({ ok: false, error: "Portal storage is misconfigured." }, 500);
  }
  return { base: target.base, key: target.key };
}

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ ok: false, error: "Forbidden." }, 403);

  const guard = await requirePermission(req, "hotleads.handoff");
  if (!guard.ok) return guardResponse(guard);

  const target = gate(req);
  if (target instanceof Response) return target;

  const all = await readAll(target.base, target.key);
  if (!all.ok) return readFailure(all.reason);
  return ledgersJson(all.ledgers);
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ ok: false, error: "Forbidden." }, 403);

  // Parsed before authorising: the permission this action needs DEPENDS on
  // `kind`, which only exists in the body. Safe ordering — parsing has no
  // side effect, and the guard below still runs before `gate()` and before
  // any Supabase read or write.
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  const raw = (body ?? {}) as { leadIds?: unknown; kind?: unknown; note?: unknown };
  // Two audiences, two permissions. "returned" is the REP-facing "send back to
  // admin" action (SalesProvider.tsx's returnLeads(), whose button is gated
  // client-side on `leads.contact` — which `sales` holds); "handoff" and
  // "archived" are ADMIN-only staging actions driven from the Hot Leads page.
  // An absent/invalid kind defaults to "handoff" (unchanged from before), so it
  // must fail closed to the admin-only permission, not the rep-facing one.
  const kind: MarkerKind = isMarkerKind(raw.kind) ? raw.kind : "handoff";
  const guard = await requirePermission(req, kind === "returned" ? "leads.contact" : "hotleads.handoff");
  if (!guard.ok) return guardResponse(guard);

  const target = gate(req);
  if (target instanceof Response) return target;

  // Optional, and only meaningful on a return: the rep's reason for sending the
  // lead back ("already a client of ours"). Trimmed and capped.
  const note =
    typeof raw.note === "string" && raw.note.trim()
      ? raw.note.trim().slice(0, MAX_NOTE_LEN)
      : null;
  // Only well-formed uuids get in — these are stored as lead_id and
  // interpolated into PostgREST filters.
  const wanted = [
    ...new Set((Array.isArray(raw.leadIds) ? raw.leadIds : []).filter(isUuid)),
  ].slice(0, MAX_PER_POST);
  if (wanted.length === 0) {
    return json({ ok: false, error: "No valid lead ids to mark." }, 400);
  }

  const all = await readAll(target.base, target.key);
  if (!all.ok) {
    // A WRITE can't degrade to demo — but it must still say which problem it
    // hit. A missing table is a 409 "run the migration"; a blip is a 502 the
    // client can simply retry (marking is idempotent, so retrying is safe).
    return all.reason === "missing"
      ? json(
          {
            ok: false,
            needsMigration: true,
            error: "Run supabase/portal-telemetry.sql before handing leads to Sales.",
          },
          409,
        )
      : json({ ok: false, error: "Couldn't read the hot-lead ledgers — try again." }, 502);
  }

  const ledger = all.ledgers[kind];
  // Already-marked leads are skipped, not duplicated — this is what stops a
  // lead being sent to Sales twice.
  const fresh = wanted.filter((id) => !ledger.has(id));
  if (fresh.length > 0) {
    const rows: PortalEventRow[] = fresh.map((leadId) => ({
      event: MARKER_EVENT[kind],
      props: note ? ({ note } as Record<string, string>) : {},
      lead_id: leadId,
    }));
    if (!(await insertPortalEvents(target.base, target.key, rows))) {
      return json({ ok: false, error: "Couldn't record that." }, 502);
    }
  }

  // A return also RETRACTS the hand-off — that's what actually pulls the lead
  // out of the rep queue (whose only gate is the hand-off ledger) and floats it
  // back to admin on Hot Leads with the note attached. Done AFTER the return
  // row lands, so a failure here can never lose the rep's reason.
  if (kind === "returned") {
    for (const id of wanted.filter((x) => all.ledgers.handoff.has(x))) {
      if (!(await deleteMarker(target.base, target.key, "handoff", id))) {
        return json(
          { ok: false, error: "Recorded the return, but couldn't clear the hand-off." },
          502,
        );
      }
    }
  }

  // Re-read so the client gets the authoritative sets (with real stamps).
  const after = await readAll(target.base, target.key);
  if (!after.ok) {
    // The write landed; only the confirming read failed. Report success with
    // the pre-write state plus what we just added, stamped now.
    const now = new Date().toISOString();
    for (const id of fresh) ledger.set(id, { at: now, note });
    return ledgersJson(all.ledgers);
  }
  return ledgersJson(after.ledgers);
}

export async function DELETE(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ ok: false, error: "Forbidden." }, 403);

  // Same kind-dependent permission as POST (see its comment above) — a rep
  // must be able to undo their OWN "returned" mark, but not touch the
  // admin-only handoff/archive ledgers. Query-string parsing has no side
  // effect, so this still runs before `gate()` and before any database call.
  const params = new URL(req.url).searchParams;
  const leadId = params.get("leadId");
  const kindParam = params.get("kind");
  const kind: MarkerKind = isMarkerKind(kindParam) ? kindParam : "handoff";
  const guard = await requirePermission(req, kind === "returned" ? "leads.contact" : "hotleads.handoff");
  if (!guard.ok) return guardResponse(guard);

  const target = gate(req);
  if (target instanceof Response) return target;

  // isUuid also makes the eq. interpolation safe (uuids never need quoting).
  if (!isUuid(leadId)) return json({ ok: false, error: "A valid lead id is required." }, 400);

  if (!(await deleteMarker(target.base, target.key, kind, leadId))) {
    return json({ ok: false, error: "The database rejected that." }, 502);
  }

  // Only the marker is erased — the lead and its whole click trail are
  // untouched, so it simply reappears in the Hot Leads working lists.
  const all = await readAll(target.base, target.key);
  if (!all.ok) return json({ ok: true }); // the delete landed; only the re-read failed
  return ledgersJson(all.ledgers);
}
