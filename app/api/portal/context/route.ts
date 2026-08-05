import { type NextRequest } from "next/server";
import { sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { readAttribution, lookupLead } from "@/lib/portal/server";

// GET /api/portal/context — tiny, PUBLIC sector hint for the customer portal.
//
// A visitor arriving via a tracked outreach link (/t/<leadId>) already carries
// the httpOnly `apmg_ref` attribution cookie. This route resolves that cookie
// to the lead's CATEGORY ONLY (e.g. "Childcare & early learning") so the hero
// can greet the visitor in their own sector's language — the message-match
// between the sector-tailored email and the landing page.
//
// Privacy posture: deliberately returns NOTHING identifying — no lead id, no
// name, no email — just the sector bucket, which is the same generic string
// shown to thousands of leads. Misses (no cookie, demo mode, deleted lead)
// return { category: null } and the portal shows its generic copy. Best-effort
// by design: this must never break the page.
//
// Path starts with /api/portal/ so the customer-host middleware allows it.
export const runtime = "nodejs";

export async function GET(req: NextRequest): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const { leadId } = readAttribution(req);
  const target = supabaseTarget();
  let category: string | null = null;

  if (leadId && target.state === "ok") {
    const lead = await lookupLead(target.base, target.key, leadId);
    category = lead?.category ?? null;
  }

  // Private: the answer depends on the visitor's own cookie — never cache it
  // at a shared layer.
  return Response.json(
    { ok: true, category },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
