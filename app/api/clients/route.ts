import { clientListEtag, masterClientList } from "@/lib/clients/server";
import { sameOrigin } from "@/lib/pipeline/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

/**
 * The Master Client List: every customer APMG already services, folded out of
 * the duplicate spellings in the site export, with their branches and sites.
 *
 * Served from a bundled export rather than from Supabase (see
 * lib/clients/siteExport.ts) — it is a periodic dump from the job-management
 * system, not console-editable state, so a table and a migration would buy
 * nothing and cost an egress round trip per view. The fold is memoised per
 * server instance and the answer is ETag'd, so a console tab that already holds
 * the list revalidates to an empty 304.
 *
 * Gated on `clients.view`, the same permission the tab is gated on.
 */
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "clients.view");
  if (!guard.ok) return guardResponse(guard);

  const etag = clientListEtag();
  const cache = {
    ETag: etag,
    // `no-cache`, not `no-store`: the browser keeps the body and revalidates,
    // which is what lets this answer 304 with no body at all.
    "Cache-Control": "private, no-cache, must-revalidate",
  };
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: cache });
  }

  const { groups, stats } = masterClientList();
  return Response.json({ ok: true, groups, stats }, { headers: cache });
}
