import { sameOrigin } from "@/lib/pipeline/server";
import { loadLegalDocs } from "@/lib/legal/legalStore";
import { isPlaceholderLegal } from "@/lib/legal/legalDocs";

// GET /api/portal/legal — PUBLIC read of the current Terms & Conditions +
// Privacy Policy and their version, so the customer portal can show a customer
// the exact text they are agreeing to, and pin that version onto the consent it
// records. No PII here (operator-authored policy text only), so it sits behind
// the same-origin (CSRF) floor like the other portal endpoints, and is allowed
// on the customer host by middleware (path starts with /api/portal/).
//
// Reachable on the standalone customer portal; the enquiry modal fetches it to
// render the T&C/Privacy links + the version its consent checkbox pins.
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }
  const docs = await loadLegalDocs();
  return Response.json(
    {
      ok: true,
      version: docs.version,
      termsHtml: docs.termsHtml,
      privacyHtml: docs.privacyHtml,
      updatedAt: docs.updatedAt,
      // The portal uses this to warn (and, if you choose, block) when no
      // lawyer-reviewed wording has been published yet.
      placeholder: isPlaceholderLegal(docs),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
