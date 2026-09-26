import {
  bestEmail,
  ensureLinkToken,
  isEmail,
  MAX_RECIPIENTS,
  safeCampaignTag,
} from "@/lib/pipeline/campaign";
import { deliverCampaign, type CleanRecipient, type SendResult } from "@/lib/pipeline/deliver";
import { publicObjectUrl, sameOrigin, SECTOR_ASSETS_BUCKET } from "@/lib/pipeline/server";
import { serviceBySlug } from "@/lib/pipeline/services";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// Sends an outreach email campaign to a set of stored leads. Each message's CTA
// is rewritten to the attribution hook /t/<leadId>?c=<campaign> (app/t/[id]),
// so a click flips the lead's "Engaged" badge in the Sales queue. Runs on Node.
//
// Delivery: POSTs the messages to the n8n campaign webhook (the "Send a
// message" Gmail node) resolved by campaignWebhook() — configured on the
// Integrations tab or via N8N_CAMPAIGN_WEBHOOK_URL. When that automation is
// unconfigured, or configured but paused via its Integrations toggle, the
// send refuses to run and reports sent: 0 rather than claiming success.
//
// Webhook payload: { campaign, messages: [{ to, leadId, subject, text, attachment?, hero?, hero_alt? }] }.
// `text` is the PLAIN-TEXT body (HTML flattened via htmlToText) — the Gmail node
// owns all formatting. The tracked CTA link is kept inline as "label (url)" so a
// click still hits /t/<lead> and attributes to the campaign. `hero`/`hero_alt`
// (present when a service template was picked on Step 2) swap the branded
// email's hero image to that service's photo; absent, n8n keeps its default
// team photo.
//
// After a live send, one `email_sent` row per recipient is recorded in
// portal_events (lead_id + campaign + category) — that's what the Telemetry
// report's "emails sent in period" numbers are built from, AND the gate that
// puts a lead into the Sales queue (/api/sales/queue reads this ledger
// directly, so no leads column needs stamping). Best-effort: a failed insert
// never fails the send, but a lost row also keeps that lead out of the Sales
// queue until a later send lands. The telemetry reads are allowlist-based
// (attribution_click/portal_view/…), so these rows never pollute lead trails
// or funnel totals.
//
// The delivery chain itself lives in lib/pipeline/deliver.ts.
export const runtime = "nodejs";

const MAX_SUBJECT = 300;
const MAX_HTML = 20_000;

/** Whitelist a client recipient → {id, email, business, subject?, html?}.
 *  Accepts an explicit `email`, or derives the best contact from an `emails`
 *  array. Optional per-lead `subject`/`html` (the reviewed AI drafts) override
 *  the shared template; both still render through the same merge helpers, so
 *  {{business}}/{{link}} substitute as usual. Drops anything without a stable
 *  id or a valid address. */
function sanitizeRecipient(input: unknown): CleanRecipient | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id.trim() : "";
  if (!id) return null;

  const explicit = typeof o.email === "string" ? o.email.trim() : "";
  const derived = Array.isArray(o.emails)
    ? bestEmail(o.emails.filter((x): x is string => typeof x === "string"))
    : null;
  const email = explicit || derived || "";
  if (!isEmail(email)) return null;

  const business = typeof o.business === "string" && o.business.trim() ? o.business.trim() : undefined;
  const website = typeof o.website === "string" && o.website.trim() ? o.website.trim().slice(0, 300) : undefined;

  const subjectRaw = typeof o.subject === "string" ? o.subject.trim() : "";
  const subject = subjectRaw ? subjectRaw.slice(0, MAX_SUBJECT) : undefined;
  const htmlRaw = typeof o.html === "string" ? o.html.trim() : "";
  const html = htmlRaw ? ensureLinkToken(htmlRaw.slice(0, MAX_HTML)) : undefined;

  const category = typeof o.category === "string" && o.category.trim() ? o.category.trim().slice(0, 120) : null;

  return { id, email, business, website, subject, html, category };
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return json({ ok: false, sent: 0, mode: "noop", error: "Forbidden." }, 403);
  }

  const guard = await requirePermission(req, "campaigns.send");
  if (!guard.ok) return guardResponse(guard);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, sent: 0, mode: "noop", error: "Invalid JSON body." }, 400);
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const campaign = safeCampaignTag(b.campaign);
  if (!campaign) {
    return json({ ok: false, sent: 0, mode: "noop", error: "Invalid campaign tag — use letters, numbers, and dashes." }, 400);
  }

  // The shared template is only a fallback for recipients without their own AI
  // draft. Validate length here; requiredness is deferred until we know whether
  // any recipient actually relies on it (below).
  const subject = typeof b.subject === "string" ? b.subject.trim() : "";
  if (subject.length > MAX_SUBJECT) {
    return json({ ok: false, sent: 0, mode: "noop", error: `Subject is too long (max ${MAX_SUBJECT} characters).` }, 400);
  }

  const bodyHtmlRaw = typeof b.bodyHtml === "string" ? b.bodyHtml.trim() : "";
  if (bodyHtmlRaw.length > MAX_HTML) {
    return json({ ok: false, sent: 0, mode: "noop", error: `Email body is too long (max ${MAX_HTML.toLocaleString("en-US")} characters).` }, 400);
  }
  // Guarantee the shared body carries the tracked CTA token too (per-recipient
  // html is normalized in sanitizeRecipient) — otherwise a template send could
  // go out with no /t/<lead> link and nothing would ever be attributed.
  const bodyHtml = bodyHtmlRaw ? ensureLinkToken(bodyHtmlRaw) : "";

  const rawRecipients = b.recipients;
  if (!Array.isArray(rawRecipients)) {
    return json({ ok: false, sent: 0, mode: "noop", error: "Expected { recipients: [...] }." }, 400);
  }
  if (rawRecipients.length > MAX_RECIPIENTS) {
    return json({ ok: false, sent: 0, mode: "noop", error: `Too many recipients (max ${MAX_RECIPIENTS}).` }, 413);
  }

  // sanitize + dedupe by address (a lead listed twice is mailed once)
  const seen = new Set<string>();
  const recipients: CleanRecipient[] = [];
  for (const r of rawRecipients) {
    const clean = sanitizeRecipient(r);
    if (!clean) continue;
    const key = clean.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push(clean);
  }
  if (recipients.length === 0) {
    return json({ ok: false, sent: 0, mode: "noop", error: "No recipients with a valid email address." }, 400);
  }

  // Everything from here on — client guard, opt-outs, render, webhook, ledger —
  // is the shared delivery path (lib/pipeline/deliver.ts), so the Follow-Ups
  // send can never apply a weaker guard than this one.
  const base = process.env.NEXT_PUBLIC_TRACK_BASE || new URL(req.url).origin;
  // Service template picked on Step 2 (one per send) — resolves to the public
  // Storage URL of that service's photo, sent as the branded email's hero.
  const service = serviceBySlug(typeof b.service === "string" ? b.service : null);
  const heroUrl = service ? publicObjectUrl(SECTOR_ASSETS_BUCKET, service.image) : null;
  const out = await deliverCampaign({
    campaign,
    base,
    recipients,
    subject,
    bodyHtml,
    hero: heroUrl && service ? { url: heroUrl, alt: service.imageAlt } : null,
  });
  return json(out.result, out.status);
}

function json(result: SendResult, status = 200): Response {
  return Response.json(result, { status });
}
