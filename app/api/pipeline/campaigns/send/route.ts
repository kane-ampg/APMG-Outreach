import {
  bestEmail,
  ensureLinkToken,
  htmlToText,
  isEmail,
  MAX_RECIPIENTS,
  renderBody,
  renderSubject,
  safeCampaignTag,
  trackedLink,
} from "@/lib/pipeline/campaign";
import {
  campaignWebhook,
  isUuid,
  publicObjectUrl,
  sameOrigin,
  SECTOR_ASSETS_BUCKET,
  supabaseTarget,
  webhookAuthHeaders,
} from "@/lib/pipeline/server";
import { serviceBySlug } from "@/lib/pipeline/services";
import { loadPlaybooks, playbookPdfUrl } from "@/lib/pipeline/sectorStore";
import { resolveSectorForCategory } from "@/lib/pipeline/sectors";
import { fetchSuppressedEmails, insertPortalEvents } from "@/lib/portal/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// Sends an outreach email campaign to a set of stored leads. Each message's CTA
// is rewritten to the attribution hook /t/<leadId>?c=<campaign> (app/t/[id]),
// so a click flips the lead's "Engaged" badge in the Sales queue. Runs on Node.
//
// Delivery: when N8N_CAMPAIGN_WEBHOOK_URL is set we POST the messages to that
// n8n webhook (the "Send a message" Gmail node); otherwise we simulate a
// successful send (demo mode), mirroring the CSV importer.
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
export const runtime = "nodejs";

/** The send-ledger event name (portal_events). Keep in sync with
 *  /api/portal/report, which aggregates it per period. */
const SENT_EVENT = "email_sent";

const MAX_SUBJECT = 300;
const MAX_HTML = 20_000;

type SendMode = "live" | "demo" | "noop";

interface SendResult {
  ok: boolean;
  sent: number;
  mode: SendMode;
  campaign?: string;
  error?: string;
  /** how many recipients were dropped because they had unsubscribed */
  suppressed?: number;
}

interface CleanRecipient {
  id: string;
  email: string;
  business?: string;
  /** per-lead AI draft overrides (Compose email) — fall back to the shared template */
  subject?: string;
  html?: string;
  /** the lead's CSV Category — resolved to a Sector Playbook to attach its PDF */
  category?: string | null;
}

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

  const subjectRaw = typeof o.subject === "string" ? o.subject.trim() : "";
  const subject = subjectRaw ? subjectRaw.slice(0, MAX_SUBJECT) : undefined;
  const htmlRaw = typeof o.html === "string" ? o.html.trim() : "";
  const html = htmlRaw ? ensureLinkToken(htmlRaw.slice(0, MAX_HTML)) : undefined;

  const category = typeof o.category === "string" && o.category.trim() ? o.category.trim().slice(0, 120) : null;

  return { id, email, business, subject, html, category };
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

  // Honour unsubscribes (Spam Act 2003): drop any recipient whose address is on
  // the suppression list before we build/send anything. fetchSuppressedEmails
  // fails OPEN (empty set) if the table is missing or the lookup errors, so a
  // broken lookup never blocks a legitimate send — but that also means the
  // opt-out list is only enforced once supabase/unsubscribe.sql has been run.
  // We only bother when a real DB is configured (demo mode has no list).
  let suppressedCount = 0;
  const sb = supabaseTarget();
  if (sb.state === "ok") {
    const suppressed = await fetchSuppressedEmails(
      sb.base,
      sb.key,
      recipients.map((r) => r.email),
    );
    if (suppressed.size > 0) {
      const before = recipients.length;
      for (let i = recipients.length - 1; i >= 0; i--) {
        if (suppressed.has(recipients[i].email.toLowerCase())) recipients.splice(i, 1);
      }
      suppressedCount = before - recipients.length;
    }
  }
  if (recipients.length === 0) {
    return json(
      { ok: false, sent: 0, mode: "noop", suppressed: suppressedCount, error: "Every recipient has unsubscribed." },
      400,
    );
  }

  // Require the shared subject/body only when some recipient lacks its own
  // per-lead draft (in a pure AI send every recipient carries both).
  if (!subject && recipients.some((r) => !r.subject)) {
    return json({ ok: false, sent: 0, mode: "noop", error: "A subject line is required." }, 400);
  }
  if (!bodyHtml && recipients.some((r) => !r.html)) {
    return json({ ok: false, sent: 0, mode: "noop", error: "An email body is required." }, 400);
  }

  // Build the tracked, personalized message for each recipient. A reviewed AI
  // draft (per-recipient subject/html) wins over the shared template; both go
  // through the same merge render, so the tracked {{link}} lands either way.
  // NEXT_PUBLIC_TRACK_BASE pins the link host (e.g. the deployed domain);
  // otherwise we use this request's origin.
  const base = process.env.NEXT_PUBLIC_TRACK_BASE || new URL(req.url).origin;
  // Resolve each recipient's Category to a Sector Playbook so the matching
  // portfolio PDF is attached (Sector Playbooks tab). Unmatched categories /
  // sectors without a PDF simply send with no attachment. n8n downloads
  // `attachment.url` and attaches it as `attachment.filename`.
  const playbooks = await loadPlaybooks();
  // Service template picked on Step 2 (one per send) — resolves to the public
  // Storage URL of that service's photo, sent as the branded email's hero so
  // the image always matches the service being pitched. Unknown slug / no
  // Supabase → no hero field → n8n falls back to its default team photo.
  const service = serviceBySlug(typeof b.service === "string" ? b.service : null);
  const heroUrl = service ? publicObjectUrl(SECTOR_ASSETS_BUCKET, service.image) : null;
  const messages = recipients.map((r) => {
    const sector = resolveSectorForCategory(r.category, playbooks);
    const attachmentUrl = sector?.pdf ? playbookPdfUrl(sector) : null;
    // Render the merged body, then flatten to plain text for the webhook — the
    // n8n Gmail node owns formatting. The tracked CTA link survives inline as
    // "label (url)" so a click is still attributed to /t/<lead>.
    const html = renderBody(r.html ?? bodyHtml, { business: r.business, link: trackedLink(base, r.id, campaign) });
    return {
      to: r.email,
      leadId: r.id,
      subject: renderSubject(r.subject ?? subject, { business: r.business }),
      text: htmlToText(html),
      // Omitted (undefined → dropped by JSON.stringify) when no PDF applies.
      attachment: attachmentUrl && sector?.pdf ? { url: attachmentUrl, filename: sector.pdf.name } : undefined,
      // Omitted when no service template was picked — n8n keeps its default hero.
      hero: heroUrl ?? undefined,
      hero_alt: heroUrl && service ? service.imageAlt : undefined,
    };
  });

  const target = await campaignWebhook();
  if (target.state === "demo") {
    // Demo mode — no webhook configured. Simulate a successful send so the tab
    // is fully exercisable before n8n is wired up.
    return json({ ok: true, sent: messages.length, mode: "demo", campaign, suppressed: suppressedCount });
  }

  let res: Response;
  try {
    res = await fetch(target.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...webhookAuthHeaders() },
      body: JSON.stringify({ campaign, messages }),
      signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    console.error("[pipeline/campaigns] fetch to n8n webhook failed:", e);
    return json({ ok: false, sent: 0, mode: "live", error: "Could not reach the campaign automation." }, 502);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[pipeline/campaigns] n8n webhook ${res.status}:`, detail.slice(0, 1000));
    return json({ ok: false, sent: 0, mode: "live", error: "The automation rejected the campaign." }, 502);
  }

  // Send ledger: one email_sent row per delivered recipient, so period reports
  // can answer "how many emails went out this week/month". Best-effort — the
  // campaign was already accepted by the automation, so a ledger hiccup only
  // logs; it never turns a successful send into an error.
  if (sb.state === "ok") {
    await insertPortalEvents(
      sb.base,
      sb.key,
      recipients.map((r) => ({
        event: SENT_EVENT,
        props: {},
        lead_id: isUuid(r.id) ? r.id : null,
        campaign,
        category: r.category,
      })),
    );
  }

  return json({ ok: true, sent: messages.length, mode: "live", campaign, suppressed: suppressedCount });
}

function json(result: SendResult, status = 200): Response {
  return Response.json(result, { status });
}
