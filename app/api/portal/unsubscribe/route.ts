import { isUuid, supabaseTarget } from "@/lib/pipeline/server";
import {
  isBotRequest,
  isKnownCampaign,
  isKnownRecipient,
  lookupLead,
  recordUnsubscribe,
  rewrittenRecipient,
} from "@/lib/portal/server";
import { senderIdentityLine } from "@/lib/legal/company";

// One-click unsubscribe for outreach email (Spam Act 2003: a functional opt-out
// is mandatory on commercial email). The branded footer links here as a GET so
// a single click works from any mail client, no form:
//   /api/portal/unsubscribe?e=<email>&lead=<leadId>&c=<campaign>
//
// It records the address in email_suppression (see supabase/unsubscribe.sql);
// the send route filters that list so the person is never emailed again. Always
// responds with a friendly HTML confirmation page — an opt-out must LOOK done to
// the customer even if the backend write hiccups (we log failures server-side).
//
// Deliberately unauthenticated: the recipient isn't logged in. There's no PII
// disclosure (it only writes), and the worst abuse is suppressing an address
// someone already possesses — acceptable for an unsubscribe.
export const runtime = "nodejs";

function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/png" href="/icon.png">
<link rel="apple-touch-icon" href="/icon.png">
<title>${title} — APMG Services</title></head>
<body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:48px 16px;"><tr><td align="center">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">
<tr><td style="background:#111;padding:18px 28px;color:#fff;font-size:18px;font-weight:700;">APMG <span style="color:#c8102e;">Services</span></td></tr>
<tr><td style="height:3px;background:#c8102e;font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="padding:32px 28px;color:#1a1a1a;font-size:15px;line-height:1.6;">
<h1 style="font-size:19px;margin:0 0 12px;">${title}</h1>${body}</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #ececec;background:#fafafa;color:#6b7280;font-size:11px;line-height:1.5;">${senderIdentityLine()}</td></tr>
</table></td></tr></table></body></html>`;
  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const emailParam = (url.searchParams.get("e") || url.searchParams.get("email") || "").trim();
  const leadId = (url.searchParams.get("lead") || "").trim();
  const campaign = (url.searchParams.get("c") || url.searchParams.get("campaign") || "").trim();

  // "Change your mind?" CTA points at OUR OWN customer portal, not the external
  // marketing site — the same host our tracked links use. Pin it to
  // NEXT_PUBLIC_TRACK_BASE (the deployed customer domain) and fall back to this
  // request's own origin so it stays correct across dev/preview/prod. Trailing
  // slash is trimmed so `${portalBase}/portal` never doubles up.
  const portalBase = (process.env.NEXT_PUBLIC_TRACK_BASE || url.origin).replace(/\/+$/, "");
  const portalHref = `${portalBase}/portal`;

  const target = supabaseTarget();

  // Resolve the address: an explicit ?e= wins; otherwise look it up from the
  // lead id (so a link can carry just the lead uuid). Demo mode has no DB, so
  // we can only honour an explicit address.
  let email = emailParam;
  if (!email && target.state === "ok" && isUuid(leadId)) {
    const lead = await lookupLead(target.base, target.key, leadId).catch(() => null);
    // lookupLead returns name/category only; email isn't stored there, so a
    // lead-id-only link needs the email embedded. Fall through to the guidance
    // page below when we can't determine the address.
    void lead;
  }

  if (!email) {
    return page(
      "We'd hate to keep bothering you",
      `<p>We couldn't quite read which address to remove from this link — sorry about that.</p>
       <p>Just reply to the email you received with the word <strong>unsubscribe</strong>, and we'll take you off our list within five business days. No hard feelings, and the door's always open if you need us down the track.</p>`,
    );
  }

  // FAIL-CLOSED CARVE-OUT. This is a public visitor endpoint reached from an
  // outreach email, not a console surface. 503-ing it when Supabase is
  // unconfigured would break the link for a real lead, so it degrades quietly
  // instead. It renders no data into the console, so it cannot fabricate.
  //
  // Additionally: an unsubscribe link that errors is a compliance problem, not
  // just a broken page (Spam Act 2003 (Cth) requires a functional opt-out on
  // commercial electronic messages). This endpoint must answer even when the
  // database behind it does not.
  if (target.state !== "ok") {
    // No DB configured (demo). Don't claim success we can't back up; give the
    // reply-to fallback which is itself a valid opt-out channel.
    console.warn("[unsubscribe] no Supabase target; cannot record opt-out for", email);
    return page(
      "Sorry to see you go",
      `<p>Thanks for letting us know. To finish taking <strong>${email.replace(/[<>&"]/g, "")}</strong> off our list, please reply to the email with the word <strong>unsubscribe</strong> and we'll action it within five business days.</p>
       <p style="color:#6b7280;font-size:13px;margin-top:18px;">Changed your mind? No problem at all — we're still here whenever you need a hand.</p>`,
    );
  }

  /*
   * SCANNER DETONATION. A mail gateway that pre-fetches every link in a message
   * reaches this endpoint exactly as a person would, and until 2026-08-26 the
   * write happened either way. Between 2026-08-25 and 2026-08-26 that took the
   * suppression list from 2 rows to 44, nearly all of them scrambled local
   * parts on real prospect domains under a campaign tag that has never sent an
   * email — the signature of a gateway replaying a mangled URL.
   *
   * /t/[id] has always refused to record scanner clicks for the same reason
   * (see classifyClick / isBotRequest). This endpoint now applies the same
   * test. The customer-facing page is IDENTICAL in every branch: a scanner
   * gets its 200 and learns nothing, and a human always reads "you're all set".
   *
   * DIRECTION OF ERROR IS DELIBERATE. Failing to record a real opt-out is a
   * Spam Act problem; recording one nobody asked for only costs a prospect. So
   * a bot is the ONLY case that skips the write. A human whose address we
   * cannot verify is still suppressed — the address is merely logged, because
   * an unverifiable address arriving from a real browser is more likely to be
   * our data being stale than an attack.
   */
  const bot = isBotRequest(req);
  const known = await isKnownRecipient(target.base, target.key, email, leadId);

  if (bot) {
    console.warn(
      `[unsubscribe] SKIPPED (automated request): ${email} lead=${leadId || "-"} campaign=${campaign || "-"} ua=${(req.headers.get("user-agent") || "").slice(0, 120)}`,
    );
    return successPage(email, portalHref);
  }

  /*
   * THE REWRITE TELL. isBotRequest reads the User-Agent, so a gateway that
   * presents a browser string walks straight past it — which is how
   * `avgmeblabegu.faebyzfagf@saints.vic.edu.au` (ROT13 of a real enrolments
   * desk at saints.vic.edu.au) came to sit on the suppression list as an
   * opt-out nobody made. A rotated local part cannot come from a person: their
   * mail client sends the address exactly as we wrote it into the link.
   *
   * Skipped, not decoded-and-recorded. A GET is what a gateway PRE-FETCHES;
   * treating it as a click would let every scanner suppress a real prospect.
   * The decoded address is logged so a genuine one can still be honoured by
   * hand — and the one-click POST below, which only a person can trigger, does
   * record the decoded address instead of ignoring it.
   */
  const rewrittenAs = known ? null : await rewrittenRecipient(target.base, target.key, email);
  if (rewrittenAs) {
    console.warn(
      `[unsubscribe] SKIPPED (rewritten link, no click): ${email} decodes to ${rewrittenAs} — lead=${leadId || "-"} campaign=${campaign || "-"}`,
    );
    return successPage(email, portalHref);
  }

  /*
   * THE MANGLED-URL TELL, and the one that actually holds. The rewrite check
   * above only fires when the local part decodes cleanly to a lead we hold,
   * and the gateway's transform drifts a letter off ROT13
   * (`cevtugba.cf@education.vic.gov.au` → `prighton.ps`, not `brighton.ps`),
   * so it missed 129 rows recorded between 2026-08-26 and 2026-09-03.
   *
   * The campaign tag survives where the address does not: we mint it, we write
   * it into the link, and a real mail client hands it back unchanged. All 129
   * carried `bhgefbdu-5359`, a tag that has never sent an email.
   *
   * BOTH CONDITIONS ARE REQUIRED, and the pairing is the whole safety
   * argument: the tag is foreign AND the address is on no lead of ours. A real
   * person opting out from an old or unlogged campaign still has an address we
   * hold, so `known` is true and their request is recorded. Skipping needs the
   * link to be unrecognisable in both halves at once, which is a thing only a
   * rewrite produces.
   */
  if (!known && !(await isKnownCampaign(target.base, target.key, campaign))) {
    console.warn(
      `[unsubscribe] SKIPPED (mangled link — unknown campaign, unverifiable address): ${email} lead=${leadId || "-"} campaign=${campaign || "-"}`,
    );
    return successPage(email, portalHref);
  }

  if (!known) {
    console.warn(
      `[unsubscribe] address not held on any lead, recording anyway: ${email} lead=${leadId || "-"} campaign=${campaign || "-"}`,
    );
  }

  const result = await recordUnsubscribe(target.base, target.key, email, { leadId, campaign });
  if (result === "needs_migration") {
    console.error("[unsubscribe] email_suppression table missing — run supabase/unsubscribe.sql");
  }

  // Always show success to the customer: their intent is recorded/logged, and a
  // failed DB write is our problem to fix, not a reason to tell them it failed.
  return successPage(email, portalHref);
}

/** The one confirmation page. Every branch above returns THIS — recorded,
 *  skipped as automated, or written despite an unverifiable address — so the
 *  response never tells a caller which happened. */
function successPage(email: string, portalHref: string): Response {
  return page(
    "Sorry to see you go",
    `<p>You're all set — we've removed <strong>${email.replace(/[<>&"]/g, "")}</strong> from APMG Services outreach, and you won't hear from us again.</p>
     <p>Thanks for the time you gave us. If you ever need a hand with electrical, plumbing, painting, carpentry, flooring, gardening or general property maintenance around Melbourne, we'd love to help — we're not going anywhere.</p>
     <p style="margin-top:20px;"><a href="${portalHref}" style="display:inline-block;background:#c8102e;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">Explore our services</a></p>
     <p style="color:#6b7280;font-size:13px;margin-top:22px;">Changed your mind, or didn't mean to unsubscribe? You can always <a href="${portalHref}" style="color:#c8102e;text-decoration:underline;">get back in touch through our services portal</a> — or just reply to any of our emails and we'll add you straight back.</p>`,
  );
}

/**
 * RFC 8058 one-click unsubscribe. Gmail and Yahoo POST here when the recipient
 * uses the native "Unsubscribe" control rendered next to the sender name — the
 * body is `List-Unsubscribe=One-Click` and there is no browser session behind
 * it. Paired with the `List-Unsubscribe` / `List-Unsubscribe-Post` headers set
 * on the outgoing message; a header advertising one-click MUST be backed by an
 * endpoint that accepts POST, or the provider's request 405s and the opt-out is
 * lost.
 *
 * THE BOT FILTER IS DELIBERATELY NOT APPLIED HERE. isBotRequest exists to stop
 * a mail gateway that PRE-FETCHES every link from detonating the GET version
 * (see the scanner-detonation note above). A POST is never speculative: no
 * scanner invents a form body, and the provider only issues it after a person
 * clicks. These requests also arrive with a non-browser user-agent, so running
 * them through the filter would silently discard genuine opt-outs — the one
 * error this endpoint must never make.
 *
 * Answers 200 text/plain: the provider shows its own confirmation UI, so there
 * is no page to render, and a non-2xx makes Gmail surface a failure to a person
 * who has already been told they're unsubscribed.
 */
export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  let email = (url.searchParams.get("e") || url.searchParams.get("email") || "").trim();
  const leadId = (url.searchParams.get("lead") || "").trim();
  const campaign = (url.searchParams.get("c") || url.searchParams.get("campaign") || "").trim();

  // Some providers post the address in the form body instead of the URL.
  if (!email) {
    const form = await req.formData().catch(() => null);
    const field = form?.get("email") ?? form?.get("e");
    if (typeof field === "string") email = field.trim();
  }

  const ok = () => new Response("Unsubscribed.\n", {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });

  if (!email) {
    console.error("[unsubscribe] one-click POST carried no address; nothing recorded", url.search);
    return ok(); // never hand the provider a failure — we log and fix our end
  }

  const target = supabaseTarget();
  if (target.state !== "ok") {
    console.error("[unsubscribe] one-click POST but no Supabase target; NOT recorded:", email);
    return ok();
  }

  // A one-click POST is always a person, so a rotated address here means the
  // List-Unsubscribe header itself was rewritten in transit — the click is
  // real, only the address is mangled. Suppress who they ACTUALLY are: writing
  // the rotated string would suppress nobody, while the domain rollup in the
  // send route would go on to mute their whole organisation.
  const rewrittenAs = await rewrittenRecipient(target.base, target.key, email);
  if (rewrittenAs) {
    console.warn(`[unsubscribe] one-click carried a rewritten address: ${email} → ${rewrittenAs}`);
    email = rewrittenAs;
  }

  /*
   * A POST IS STILL NOT PROOF OF A PERSON. The note above holds for the bot
   * FILTER — a provider's one-click POST carries a non-browser user-agent and
   * must never be judged on it. But a gateway that replays a mangled URL can
   * replay the method too, and the rows that landed after 2026-08-26 prove
   * something walked past the GET guard.
   *
   * So this applies the one test that reads the LINK rather than the caller:
   * an unknown campaign tag next to an address held on no lead (see the GET
   * branch for the full argument). A genuine one-click from Gmail carries our
   * own tag and a real recipient, and sails through.
   */
  if (
    !(await isKnownRecipient(target.base, target.key, email, leadId)) &&
    !(await isKnownCampaign(target.base, target.key, campaign))
  ) {
    console.warn(
      `[unsubscribe] one-click SKIPPED (mangled link — unknown campaign, unverifiable address): ${email} lead=${leadId || "-"} campaign=${campaign || "-"}`,
    );
    return ok();
  }

  const result = await recordUnsubscribe(target.base, target.key, email, { leadId, campaign });
  if (result === "needs_migration") {
    console.error("[unsubscribe] email_suppression table missing — run supabase/unsubscribe.sql");
  } else if (result !== "ok") {
    console.error("[unsubscribe] one-click POST failed to record:", email);
  } else {
    console.warn(`[unsubscribe] one-click (RFC 8058): ${email} lead=${leadId || "-"} campaign=${campaign || "-"}`);
  }
  return ok();
}
