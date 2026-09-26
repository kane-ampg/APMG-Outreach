import { loadQueue, patchFollowUps, writeFollowUp } from "@/lib/followups/server";
import { MAX_FOLLOW_UP_NOTE, type FollowUpMutationResponse } from "@/lib/followups/types";
import { isUuid, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// POST /api/followups/mark { leadId, status: "skipped" | "replied", note? } —
// end a lead's sequence by hand. "replied" exists because nothing reads the
// outreach inbox: a person who answers by email must be stopped manually.
// The touch is decided here from the queue, never by the client.
//
// When a draft is already waiting (stage "awaiting"), mark PATCHES that exact
// row with the same onlyStatus="draft" optimistic guard the send route uses —
// never an unconditional upsert — so a mark racing a send can't clobber a row
// the send route just moved to "sent" for the same touch. Only when NO row
// exists yet for the current touch (ready/waiting) does mark fall back to
// writeFollowUp, and then INSERT-ONLY: if a row appeared for that touch in the
// meantime (a draft, or a send's claim) it is left alone and the answer is 409.
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const m = (body: FollowUpMutationResponse, status = 200) => Response.json(body, { status });
  if (!sameOrigin(req)) return m({ ok: false, error: "Forbidden." }, 403);
  const guard = await requirePermission(req, "followups.send");
  if (!guard.ok) return guardResponse(guard);

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const leadId = b?.leadId;
  const status = b?.status;
  const note = typeof b?.note === "string" && b.note.trim() ? b.note.trim().slice(0, MAX_FOLLOW_UP_NOTE) : null;
  if (!isUuid(leadId)) return m({ ok: false, error: "Invalid lead id." }, 400);
  if (status !== "skipped" && status !== "replied") return m({ ok: false, error: "Status must be skipped or replied." }, 400);

  const sb = supabaseTarget();
  if (sb.state !== "ok") return m({ ok: false, error: "Supabase isn't configured." }, 503);
  const queue = await loadQueue(sb, { leadIds: [leadId] });
  if (!queue.ok) return m({ ok: false, error: "Couldn't read the queue." }, 502);
  const item = queue.items.find((i) => i.leadId === leadId);
  if (!item || item.touch === null || item.stage === "done" || item.stage === "excluded") {
    return m({ ok: false, error: "This lead isn't in an active follow-up." }, 409);
  }

  if (item.stage === "awaiting" && item.draft) {
    const rows = await patchFollowUps(sb, [item.draft.id], { status, note }, "draft");
    if (rows === null) return m({ ok: false, error: "Couldn't save that." }, 502);
    if (rows.length === 0) return m({ ok: false, error: "This draft was already sent or closed. Refresh." }, 409);
    return m({ ok: true, row: rows[0] });
  }

  const row = await writeFollowUp(sb, { lead_id: leadId, touch: item.touch, status, note }, { insertOnly: true });
  if (row === "conflict") return m({ ok: false, error: "Something changed for this lead — refresh." }, 409);
  if (!row) return m({ ok: false, error: "Couldn't save that." }, 502);
  return m({ ok: true, row });
}
