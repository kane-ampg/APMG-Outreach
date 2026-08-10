import { replay } from "@/lib/audit/replay";
import { isLeadAction, MIN_NOTE_LEN, type AuditRow } from "@/lib/audit/types";
import { actorFromGuard, recordAudit } from "@/lib/audit/write";
import { isUuid, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";
import { type SalesStatusResponse } from "@/lib/sales/status";

// The Sales desk's single write endpoint.
//
// THE WRITE IS THE ACTION. There is no separate status store to update — the
// audit row IS the state change, so a request that cannot be recorded is a
// request that did not happen. That is what makes the trail trustworthy: no
// code path can move a deal without leaving the name of whoever moved it.
//
// The response carries the replayed state so the client renders what the
// server believes rather than a local guess, which also means two reps working
// the same lead converge instead of diverging.
//
// `handoff` and `returned` are deliberately NOT accepted here: they live on
// /api/sales/handoff, which owns the portal_events row that gates queue
// membership. Two write paths for one action is how ledgers drift apart.
export const runtime = "nodejs";

/** Actions this route accepts, and the permission each one demands. */
const PERMISSION = {
  contacted: "leads.contact",
  uncontacted: "leads.contact",
  closed_won: "leads.close",
  closed_lost: "leads.close",
  reopened: "leads.close",
} as const;

type Accepted = keyof typeof PERMISSION;

function isAccepted(v: unknown): v is Accepted {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PERMISSION, v);
}

function json(body: SalesStatusResponse, status = 200): Response {
  return Response.json(body, { status });
}

const AUDIT_COLS =
  "id,action,actor_email,actor_role,acting_as,source,lead_id,target_email,note,value_cents,created_at";

/** Map one PostgREST row onto the camelCase shape the reducer consumes. */
function toAuditRow(r: Record<string, unknown>): AuditRow {
  return {
    id: String(r.id),
    action: r.action as AuditRow["action"],
    actorEmail: String(r.actor_email ?? ""),
    actorRole: String(r.actor_role ?? ""),
    actingAs: typeof r.acting_as === "string" ? r.acting_as : null,
    source: r.source === "witnessed" ? "witnessed" : "claimed",
    leadId: typeof r.lead_id === "string" ? r.lead_id : null,
    targetEmail: typeof r.target_email === "string" ? r.target_email : null,
    note: typeof r.note === "string" ? r.note : null,
    valueCents: typeof r.value_cents === "number" ? r.value_cents : null,
    createdAt: String(r.created_at ?? ""),
  };
}

/** Read this lead's whole trail back, so the response is the server's truth
 *  rather than an assumption about what the write produced. */
async function stateAfterWrite(leadId: string) {
  const target = supabaseTarget();
  if (target.state !== "ok") return null;
  try {
    const res = await fetch(
      `${target.base}/rest/v1/console_audit?select=${AUDIT_COLS}` +
        `&lead_id=eq.${leadId}&order=created_at.asc,id.asc`,
      {
        headers: { apikey: target.key, Authorization: `Bearer ${target.key}` },
        cache: "no-store",
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[sales/status] state re-read ${res.status}:`, detail.slice(0, 500));
      return null;
    }
    const raw = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
    return replay((Array.isArray(raw) ? raw : []).map(toAuditRow));
  } catch (e) {
    console.error("[sales/status] state re-read failed:", e);
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ ok: false, error: "Forbidden." }, 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  const raw = (body ?? {}) as Record<string, unknown>;

  // Parsed before authorising because the permission DEPENDS on the action —
  // the same ordering /api/sales/handoff uses for `kind`. Parsing has no side
  // effect, and the guard still runs before any read or write.
  const action = raw.action;
  if (!isAccepted(action)) {
    return json(
      {
        ok: false,
        error: isLeadAction(action)
          ? "That action is recorded by the hand-off endpoint, not here."
          : "Unknown action.",
      },
      400,
    );
  }

  const guard = await requirePermission(req, PERMISSION[action]);
  if (!guard.ok) return guardResponse(guard);

  const leadId = typeof raw.leadId === "string" ? raw.leadId : "";
  // isUuid also makes the eq. interpolation below safe (uuids never need
  // quoting), the same guarantee the hand-off route relies on.
  if (!isUuid(leadId)) return json({ ok: false, error: "A valid lead id is required." }, 400);

  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  // BOTH closes demand a note. A loss without one is how leads used to
  // disappear from the desk with no record of why.
  const closing = action === "closed_won" || action === "closed_lost";
  if (closing && note.length < MIN_NOTE_LEN) {
    return json(
      { ok: false, error: `A closing note of at least ${MIN_NOTE_LEN} characters is required.` },
      400,
    );
  }

  let valueCents: number | null = null;
  if (action === "closed_won") {
    const v = raw.valueCents;
    if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
      return json({ ok: false, error: "A closed value in whole cents is required." }, 400);
    }
    valueCents = v;
  }

  // Identity comes from the verified session, never the body — whatever
  // actorEmail the client sent is simply never read.
  const written = await recordAudit(actorFromGuard(guard), {
    action,
    leadId,
    note: note || null,
    valueCents,
  });
  if (!written.ok) {
    if (written.reason === "missing_table") {
      return json(
        { ok: false, error: "Run supabase/console-audit.sql before working the queue." },
        409,
      );
    }
    return json({ ok: false, error: "Couldn't record that — nothing was changed." }, 502);
  }

  const state = await stateAfterWrite(leadId);
  return json({ ok: true, state: state ?? undefined });
}
