import { clientGuardData } from "@/lib/clients/server";
import { sameOrigin } from "@/lib/pipeline/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

/**
 * The compact index the send flow matches its audience against, so the warning
 * "these are already clients" can be shown while the operator is still picking
 * recipients rather than after the emails have gone.
 *
 * A separate route from /api/clients on purpose: the full list is ~1,400 sites
 * with addresses and contact names, and the send flow needs none of it — only
 * the addresses, domains and names to compare against. One fetch per console
 * session (ETag'd like the list), then every match is decided in the browser
 * with no further requests.
 *
 * This is the ADVISORY copy. The authoritative check runs server-side in
 * /api/pipeline/campaigns/send, which drops blocked recipients whatever the
 * browser did — a stale index or a hand-rolled POST cannot get a client mailed.
 *
 * Gated on `campaigns.view`: it exists to serve the campaign flow, and it lists
 * client contact addresses, so it is not for a role that can't run a campaign.
 */
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "campaigns.view");
  if (!guard.ok) return guardResponse(guard);

  const data = clientGuardData();
  const etag = `W/"client-guard-${data.clients.length}-${Object.keys(data.emails).length}-${Object.keys(data.domains).length}"`;
  const cache = {
    ETag: etag,
    "Cache-Control": "private, no-cache, must-revalidate",
  };
  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: cache });
  }

  return Response.json({ ok: true, guard: data }, { headers: cache });
}
