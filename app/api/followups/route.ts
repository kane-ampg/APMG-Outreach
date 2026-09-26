import { loadQueue, patchFollowUps } from "@/lib/followups/server";
import {
  MAX_FOLLOW_UP_HTML,
  MAX_FOLLOW_UP_SUBJECT,
  type FollowUpMutationResponse,
  type FollowUpQueueResponse,
} from "@/lib/followups/types";
import { ensureLinkToken } from "@/lib/pipeline/campaign";
import { isUuid, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// GET /api/followups — the judged Follow-Ups queue (lib/followups/server
// loadQueue). Read on tab open and on Refresh only — never polled.
// PATCH /api/followups { id, subject, body_html } — save an edit to a draft;
// refused (409) once the row has left `draft`.
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const q = (body: FollowUpQueueResponse, status = 200) => Response.json(body, { status });
  if (!sameOrigin(req)) return q({ ok: false, mode: "live", error: "Forbidden.", items: [] }, 403);
  const guard = await requirePermission(req, "followups.view");
  if (!guard.ok) return guardResponse(guard);

  const sb = supabaseTarget();
  if (sb.state !== "ok") return q({ ok: true, mode: "demo", items: [] });
  const queue = await loadQueue(sb);
  if (!queue.ok) {
    return queue.reason === "missing"
      ? q({ ok: true, mode: "demo", needsMigration: true, items: [] })
      : q({ ok: false, mode: "live", error: "Couldn't read the follow-up queue.", items: [] }, 502);
  }
  return q({ ok: true, mode: "live", items: queue.items });
}

export async function PATCH(req: Request): Promise<Response> {
  const m = (body: FollowUpMutationResponse, status = 200) => Response.json(body, { status });
  if (!sameOrigin(req)) return m({ ok: false, error: "Forbidden." }, 403);
  const guard = await requirePermission(req, "followups.send");
  if (!guard.ok) return guardResponse(guard);

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = b?.id;
  const subject = typeof b?.subject === "string" ? b.subject.trim() : "";
  const bodyHtml = typeof b?.body_html === "string" ? b.body_html.trim() : "";
  if (!isUuid(id)) return m({ ok: false, error: "Invalid draft id." }, 400);
  if (!subject || !bodyHtml) return m({ ok: false, error: "Subject and body are both required." }, 400);
  if (subject.length > MAX_FOLLOW_UP_SUBJECT || bodyHtml.length > MAX_FOLLOW_UP_HTML) {
    return m({ ok: false, error: "That draft is too long." }, 400);
  }
  const sb = supabaseTarget();
  if (sb.state !== "ok") return m({ ok: false, error: "Supabase isn't configured." }, 503);

  const rows = await patchFollowUps(sb, [id], { subject, body_html: ensureLinkToken(bodyHtml) }, "draft");
  if (rows === null) return m({ ok: false, error: "Couldn't save the draft." }, 502);
  if (rows.length === 0) return m({ ok: false, error: "This draft was already sent or closed." }, 409);
  return m({ ok: true, row: rows[0] });
}
