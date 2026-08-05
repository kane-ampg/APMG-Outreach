import { isUuid, supabaseTarget } from "@/lib/pipeline/server";
import { lookupLead, recordUnsubscribe } from "@/lib/portal/server";
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

  const result = await recordUnsubscribe(target.base, target.key, email, { leadId, campaign });
  if (result === "needs_migration") {
    console.error("[unsubscribe] email_suppression table missing — run supabase/unsubscribe.sql");
  }

  // Always show success to the customer: their intent is recorded/logged, and a
  // failed DB write is our problem to fix, not a reason to tell them it failed.
  return page(
    "Sorry to see you go",
    `<p>You're all set — we've removed <strong>${email.replace(/[<>&"]/g, "")}</strong> from APMG Services outreach, and you won't hear from us again.</p>
     <p>Thanks for the time you gave us. If you ever need a hand with electrical, plumbing, painting, carpentry, flooring, gardening or general property maintenance around Melbourne, we'd love to help — we're not going anywhere.</p>
     <p style="margin-top:20px;"><a href="${portalHref}" style="display:inline-block;background:#c8102e;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">Explore our services</a></p>
     <p style="color:#6b7280;font-size:13px;margin-top:22px;">Changed your mind, or didn't mean to unsubscribe? You can always <a href="${portalHref}" style="color:#c8102e;text-decoration:underline;">get back in touch through our services portal</a> — or just reply to any of our emails and we'll add you straight back.</p>`,
  );
}
