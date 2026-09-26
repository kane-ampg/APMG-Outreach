import { NextResponse } from "next/server";
import { CUSTOMER_HOSTS } from "@/lib/hosts";
import { INTERNAL_COOKIE } from "@/lib/portal/server";

// GET /api/portal/staff — mark THIS browser as APMG staff on THIS host.
//
// proxy.ts already marks a browser internal when it loads an admin dashboard
// page, and every telemetry writer (/api/portal/events, /t/[id], the enquiry
// event) drops internal traffic. But a cookie belongs to one host: the mark set
// on the admin domain never reaches customer.apmgservices.com.au or the
// vercel.app portal, so the team's own portal visits were filed as anonymous
// customers. On 2026-09-26, 26 of the Anonymous card's 27 service opens were
// ours. A staff member opens this link once per browser, per customer host.
//
// No auth, on purpose: the mark can only ever REMOVE the holder's own activity
// from telemetry (it unlocks nothing — the chat quota demotes it to the
// anonymous path), so a stranger who finds the link can only hide themselves.
// It lives under /api/portal/ because that is what the customer-host wall
// lets through.
export const runtime = "nodejs";

/** One year — the same lifetime proxy.ts gives the admin-host mark. */
const MAX_AGE = 60 * 60 * 24 * 365;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function page(host: string, others: string[]): string {
  const more = others.length
    ? `<p>The mark only covers <b>${escapeHtml(host)}</b>. Also mark this browser on:</p><ul>${others
        .map((h) => {
          const url = escapeHtml(`https://${h}/api/portal/staff`);
          return `<li><a href="${url}">${escapeHtml(h)}</a></li>`;
        })
        .join("")}</ul>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Marked as staff — APMG Services</title>
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:34rem;margin:3rem auto;padding:0 1rem;color:#0f1113;background:#fff}
h1{font-size:1.35rem}a{color:#a50c25}</style></head><body>
<h1>This browser is marked as APMG staff</h1>
<p>Your visits to the portal on <b>${escapeHtml(host)}</b> will no longer be counted in the Telemetry tab, so it shows customers only.</p>
<p>To test the portal <i>as a customer</i> and see it recorded, use a private window — it doesn't carry this mark.</p>
${more}
<p><a href="/portal">Open the portal &rarr;</a></p>
</body></html>`;
}

export function GET(req: Request): Response {
  const host = new URL(req.url).hostname.toLowerCase();
  const others = CUSTOMER_HOSTS.filter((h) => h !== host);

  const res = new NextResponse(page(host, others), {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Set-Cookie on a cached response would mark every later visitor.
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
  res.cookies.set(INTERNAL_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
  return res;
}
