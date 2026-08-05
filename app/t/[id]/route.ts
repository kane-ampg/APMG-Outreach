import { NextResponse, type NextRequest } from "next/server";
import { isUuid, supabaseTarget } from "@/lib/pipeline/server";
import { insertPortalEvents, isBotRequest, isInternalRequest, lookupLead } from "@/lib/portal/server";

/**
 * Email attribution hook. The automation's outreach email links its CTA to
 * /t/<leadId>?c=<campaign> (see references/Leadgen Automation.json). When the
 * lead clicks, we:
 *   1. record the click (proof the automation worked + that this lead is ours):
 *      an `attribution_click` row in portal_events (enriched with the lead's
 *      denormalized category) + leads.engaged/engaged_at — the write that flips
 *      the "Engaged" badge in the Sales queue,
 *   2. drop a first-party `apmg_ref` cookie so later pageviews stay attributed,
 *   3. 302-redirect the lead on to the real destination.
 *
 * Both writes are best-effort (Promise.allSettled): a Supabase hiccup must
 * never cost the customer their redirect. Demo mode (no SUPABASE_URL) → the
 * console.info trace only, as before.
 */

const DEFAULT_DESTINATION = process.env.NEXT_PUBLIC_TRACK_DESTINATION || "/";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 90; // 90 days

/**
 * Only destinations we vouch for are honoured — this URL ships in outreach
 * emails, so an unvalidated `?to=` would let anyone mint a trusted-domain
 * link that 302s victims to an attacker page (open redirect / phishing
 * amplifier). Allowed: same-origin paths, and our own Supabase project —
 * the email's sector-PDF "file card" routes its download through this hook
 * (`…&to=<public sector-assets URL>`) so downloads are recorded like CTA
 * clicks. Every other origin (including protocol-relative `//evil.example`
 * forms) falls back to the operator-configured default.
 */
function safeDestination(requested: string | null, origin: string): string {
  if (!requested) return DEFAULT_DESTINATION;
  try {
    const resolved = new URL(requested, origin);
    if (resolved.origin === origin) return requested;
    const supa = supabaseTarget();
    if (supa.state === "ok" && resolved.origin === supa.base) return requested;
  } catch {
    /* unparsable → default */
  }
  return DEFAULT_DESTINATION;
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const campaign = url.searchParams.get("c") ?? "outreach";
  const destination = safeDestination(url.searchParams.get("to"), url.origin);

  // Traffic that is NOT a real prospect clicking: skip it entirely. Two kinds:
  //  • internal — a browser marked by the admin dashboard (middleware.ts), i.e.
  //    the operator test-clicking their own link.
  //  • bot — an email link-scanner (Microsoft Defender/Safe Links, Proofpoint,
  //    Barracuda…) or a scripted fetch (curl, python-requests, headless). These
  //    auto-open every link in an outreach email BEFORE the recipient sees it.
  // For either: redirect as normal so the link stays working, but record NOTHING
  // and clear any attribution the browser already carries. Otherwise one such
  // hit writes a fake attribution_click, falsely flips the lead's "Engaged"
  // badge, and stamps apmg_ref so every later hit lands in that lead's trail.
  const internal = isInternalRequest(req);
  const bot = isBotRequest(req);
  const skip = internal || bot;

  // Always-on operator trace (and the only record in demo mode).
  console.info("[attribution] lead click", {
    lead: id,
    campaign,
    internal,
    bot,
    ts: new Date().toISOString(),
    ua: req.headers.get("user-agent") ?? undefined,
  });

  const target = supabaseTarget();
  if (!skip && target.state === "ok" && isUuid(id)) {
    // Persist before redirecting — serverless runtimes can kill work left
    // pending after the response, and a click is a one-shot signal.
    await Promise.allSettled([
      recordAttributionClick(target.base, target.key, req, id, campaign, destination),
      markLeadEngaged(target.base, target.key, id),
    ]);
  }

  const res = NextResponse.redirect(new URL(destination, url.origin), { status: 302 });
  if (skip) {
    // Don't attribute a scanner/operator browser (a pre-fix hit may have already
    // stamped these) instead of refreshing the 90-day attribution window. A real
    // later click from the human recipient will set the cookie fresh.
    res.cookies.delete("apmg_ref");
    res.cookies.delete("apmg_ref_campaign");
    return res;
  }
  res.cookies.set("apmg_ref", id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  res.cookies.set("apmg_ref_campaign", campaign, {
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}

/** Insert the canonical `attribution_click` portal_events row, snapshotting
 *  the lead's CSV category (leads get reimported/deleted — no join later). */
async function recordAttributionClick(
  base: string,
  key: string,
  req: NextRequest,
  leadId: string,
  campaign: string,
  destination: string,
): Promise<void> {
  const lead = await lookupLead(base, key, leadId);
  await insertPortalEvents(base, key, [
    {
      event: "attribution_click",
      props: { destination: destination.slice(0, 300) },
      lead_id: leadId,
      campaign: campaign.slice(0, 120),
      category: lead?.category ?? null,
      ua: req.headers.get("user-agent")?.slice(0, 400) ?? null,
      referer: req.headers.get("referer")?.slice(0, 600) ?? null,
    },
  ]);
}

/** Flip leads.engaged — the write the Sales queue's "Engaged" badge reads. */
async function markLeadEngaged(base: string, key: string, leadId: string): Promise<void> {
  try {
    const res = await fetch(`${base}/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}`, {
      method: "PATCH",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({ engaged: true, engaged_at: new Date().toISOString() }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // engaged/engaged_at come from supabase/portal-telemetry.sql. Until that
      // migration runs, PostgREST rejects the PATCH on every click — expected,
      // so stay silent rather than spam the log.
      const missingColumns =
        /engaged/i.test(detail) && /(does not exist|could not find|PGRST204)/i.test(detail);
      if (!missingColumns) {
        console.error(`[attribution] leads engaged PATCH ${res.status}:`, detail.slice(0, 500));
      }
    }
  } catch (e) {
    console.error("[attribution] leads engaged PATCH failed:", e);
  }
}
