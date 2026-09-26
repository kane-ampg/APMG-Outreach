import "server-only";
import { matchReason, partitionByClientGuard } from "@/lib/clients/guard";
import { clientGuardData } from "@/lib/clients/server";
import { htmlToText, renderBody, renderSubject, trackedLink } from "@/lib/pipeline/campaign";
import { campaignWebhook, isUuid, supabaseTarget, webhookAuthHeaders } from "@/lib/pipeline/server";
import { loadPlaybooks, playbookPdfUrl } from "@/lib/pipeline/sectorStore";
import { resolveSectorForCategory } from "@/lib/pipeline/sectors";
import {
  fetchSuppressedDomains,
  fetchSuppressedEmails,
  insertPortalEvents,
  organisationDomain,
} from "@/lib/portal/server";

/**
 * The ONE path an outreach email takes out of this app: client guard →
 * address opt-outs → organisation opt-outs → render with the tracked link →
 * refuse when the automation is paused/unconfigured → n8n webhook → the
 * `email_sent` ledger. Extracted from /api/pipeline/campaigns/send so the cold
 * send and the Follow-Ups send can never disagree about who may be emailed.
 *
 * Returns the exact SendResult + HTTP status the cold route has always
 * answered with, plus which recipients were delivered and which were dropped
 * (by id, with a human reason) so a caller can mark its own rows.
 */

/** The send-ledger event name (portal_events). Keep in sync with
 *  /api/portal/report, which aggregates it per period. */
export const SENT_EVENT = "email_sent";

/** How many client matches to name in the response. Enough for the send flow to
 *  show who was dropped and why; not so many that a 500-recipient batch of
 *  clients returns a 500-row payload. */
const MAX_REPORTED_CLIENTS = 25;

export type SendMode = "live" | "unconfigured" | "paused" | "noop";

export interface SendResult {
  ok: boolean;
  sent: number;
  mode: SendMode;
  campaign?: string;
  error?: string;
  /** how many recipients were dropped because they had unsubscribed */
  suppressed?: number;
  /** how many recipients were dropped for already being APMG clients */
  clients?: number;
  /** who they were, so the operator is told rather than left to notice the
   *  count not adding up (capped — the message is a report, not a dump) */
  clientMatches?: Array<{ business: string; email: string; client: string; reason: string }>;
  /** how many recipients were dropped because ANOTHER address at the same
   *  organisation has unsubscribed — the address picked was not itself on the
   *  list, so this needs saying out loud */
  suppressedDomains?: number;
  /** who they were, and which colleague's opt-out covered them (capped) */
  domainMatches?: Array<{ business: string; email: string; optedOut: string }>;
}

export interface CleanRecipient {
  id: string;
  email: string;
  business?: string;
  /** the lead's website, used only by the client guard */
  website?: string;
  /** per-lead AI draft overrides — fall back to the shared template */
  subject?: string;
  html?: string;
  /** the lead's CSV Category — resolved to a Sector Playbook whose PDF the email links to */
  category?: string | null;
  /** per-recipient hero image (Follow-Ups: each lead's own service photo) */
  hero?: { url: string; alt?: string };
  /** extra props for THIS recipient's email_sent ledger row */
  ledgerProps?: Record<string, string>;
}

export interface DeliverInput {
  campaign: string;
  /** origin the tracked /t/ links are built on */
  base: string;
  recipients: CleanRecipient[];
  /** shared template, for recipients without their own draft */
  subject?: string;
  bodyHtml?: string;
  /** send-level hero (the Step 2 service template) */
  hero?: { url: string; alt?: string } | null;
  /** props written on every email_sent row of this send */
  ledgerProps?: Record<string, string>;
  /** log prefix */
  label?: string;
}

export interface DeliverOutcome {
  status: number;
  result: SendResult;
  /** ids of recipients the automation accepted (empty unless result.ok) */
  deliveredIds: string[];
  /** recipients dropped by a guard, with why */
  drops: Array<{ id: string; reason: string }>;
}

export async function deliverCampaign(input: DeliverInput): Promise<DeliverOutcome> {
  const { campaign, base } = input;
  const label = input.label ?? "pipeline/campaigns";
  const subject = input.subject ?? "";
  const bodyHtml = input.bodyHtml ?? "";
  const recipients = [...input.recipients];
  const drops: Array<{ id: string; reason: string }> = [];
  const done = (result: SendResult, status = 200, deliveredIds: string[] = []): DeliverOutcome => ({
    status,
    result,
    deliveredIds,
    drops,
  });

  // NEVER EMAIL AN EXISTING CUSTOMER. The client rule from the 2026-07-29 call
  // is absolute, so it is enforced here rather than only warned about in the
  // send flow's UI: the browser's copy of the guard index could be stale, and a
  // hand-rolled POST wouldn't consult it at all. Runs before the suppression
  // lookup because it needs no network — the folded client list is a bundled
  // export (lib/clients/server.ts), memoised per instance.
  //
  // Only `blocked` matches are dropped: an exact address, a client's mail
  // domain, a client's own website, or the same business name. Resemblance
  // matches ("reads like Hive Strata") are a judgement call and stay in the
  // send — the flow surfaces those for a human before this point.
  const clientCheck = partitionByClientGuard(recipients, clientGuardData());
  const clientMatches = clientCheck.blocked.map(({ prospect, match }) => ({
    business: prospect.business ?? prospect.email,
    email: prospect.email,
    client: match.clientName,
    reason: matchReason(match),
  }));
  if (clientMatches.length > 0) {
    console.warn(
      `[${label}] dropped ${clientMatches.length} recipient(s) already on the client list:`,
      clientMatches.map((m) => `${m.email} (${m.reason})`).join("; ").slice(0, 1000),
    );
  }
  for (const { prospect, match } of clientCheck.blocked) {
    drops.push({ id: prospect.id, reason: `Existing client (${match.clientName})` });
  }
  // Remove them in place, the same way the suppression pass below does, so the
  // send order the operator reviewed is otherwise preserved.
  if (clientCheck.blocked.length > 0) {
    const drop = new Set(clientCheck.blocked.map(({ prospect }) => prospect));
    for (let i = recipients.length - 1; i >= 0; i--) {
      if (drop.has(recipients[i])) recipients.splice(i, 1);
    }
  }
  if (recipients.length === 0) {
    return done(
      {
        ok: false,
        sent: 0,
        mode: "noop",
        clients: clientMatches.length,
        clientMatches: clientMatches.slice(0, MAX_REPORTED_CLIENTS),
        error:
          clientMatches.length === 1
            ? "The only recipient is already an APMG client, so nothing was sent."
            : "Every recipient is already an APMG client, so nothing was sent.",
      },
      400,
    );
  }

  // Honour unsubscribes (Spam Act 2003): drop any recipient whose address is on
  // the suppression list before we build/send anything. fetchSuppressedEmails
  // fails OPEN (empty set) if the table is missing or the lookup errors, so a
  // broken lookup never blocks a legitimate send — but that also means the
  // opt-out list is only enforced once supabase/unsubscribe.sql has been run.
  // We only bother when a real DB is configured (demo mode has no list).
  let suppressedCount = 0;
  /** recipients dropped because ANOTHER address at their organisation opted out */
  const domainMatches: Array<{ business: string; email: string; optedOut: string }> = [];
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
        if (suppressed.has(recipients[i].email.toLowerCase())) {
          drops.push({ id: recipients[i].id, reason: "Opted out" });
          recipients.splice(i, 1);
        }
      }
      suppressedCount = before - recipients.length;
    }

    // An opt-out belongs to the business, not to the one string it arrived
    // from. fetchSuppressedDomains rolls the list up to ORGANISATION domains
    // (public providers like gmail.com excluded), so a second address at a
    // business that already unsubscribed is dropped too. Same fail-open
    // contract as above. Reported separately from `suppressed` because it is
    // the surprising one: the operator picked an address that is not itself on
    // the list.
    const optedOutDomains = await fetchSuppressedDomains(
      sb.base,
      sb.key,
      recipients.map((r) => r.email),
    );
    if (optedOutDomains.size > 0) {
      for (let i = recipients.length - 1; i >= 0; i--) {
        const domain = organisationDomain(recipients[i].email.toLowerCase());
        const optedOut = domain ? optedOutDomains.get(domain) : undefined;
        if (!optedOut) continue;
        domainMatches.push({
          business: recipients[i].business ?? recipients[i].email,
          email: recipients[i].email,
          optedOut,
        });
        drops.push({ id: recipients[i].id, reason: `Organisation opted out (${optedOut})` });
        recipients.splice(i, 1);
      }
      if (domainMatches.length > 0) {
        domainMatches.reverse(); // restore the operator's send order
        console.warn(
          `[${label}] dropped ${domainMatches.length} recipient(s) whose organisation has unsubscribed:`,
          domainMatches.map((m) => `${m.email} (${m.optedOut} opted out)`).join("; ").slice(0, 1000),
        );
      }
    }
  }
  if (recipients.length === 0) {
    return done(
      {
        ok: false,
        sent: 0,
        mode: "noop",
        suppressed: suppressedCount,
        clients: clientMatches.length || undefined,
        clientMatches: clientMatches.length ? clientMatches.slice(0, MAX_REPORTED_CLIENTS) : undefined,
        suppressedDomains: domainMatches.length || undefined,
        domainMatches: domainMatches.length ? domainMatches.slice(0, MAX_REPORTED_CLIENTS) : undefined,
        error:
          domainMatches.length > 0 && suppressedCount === 0
            ? "Every recipient's organisation has already unsubscribed, so nothing was sent."
            : "Every recipient has unsubscribed.",
      },
      400,
    );
  }

  // Require the shared subject/body only when some recipient lacks its own
  // per-lead draft (in a pure AI send every recipient carries both).
  if (!subject && recipients.some((r) => !r.subject)) {
    return done({ ok: false, sent: 0, mode: "noop", error: "A subject line is required." }, 400);
  }
  if (!bodyHtml && recipients.some((r) => !r.html)) {
    return done({ ok: false, sent: 0, mode: "noop", error: "An email body is required." }, 400);
  }

  // Build the tracked, personalized message for each recipient. A reviewed AI
  // draft (per-recipient subject/html) wins over the shared template; both go
  // through the same merge render, so the tracked {{link}} lands either way.
  // Resolve each recipient's Category to a Sector Playbook so the matching
  // portfolio PDF (Sector Playbooks tab) can be offered. It is LINKED, never
  // attached: n8n renders `attachment` as a tracked link card in the email body
  // and never downloads the file, so no email has ever carried an attachment.
  // Unmatched categories / sectors without a PDF simply send without the card.
  const playbooks = await loadPlaybooks();
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
      // The PDF to link (not attach). Omitted (undefined → dropped by
      // JSON.stringify) when no PDF applies.
      attachment: attachmentUrl && sector?.pdf ? { url: attachmentUrl, filename: sector.pdf.name } : undefined,
      // Omitted when no service template was picked — n8n keeps its default hero.
      hero: (r.hero ?? input.hero)?.url,
      hero_alt: (r.hero ?? input.hero)?.alt,
    };
  });

  const target = await campaignWebhook();
  if (target.state !== "ok") {
    // NEVER report a send that did not happen. "paused" is called out
    // separately from "unconfigured" because it is the dangerous one: the
    // operator configured n8n, later switched the Integrations toggle off,
    // and would otherwise be told the whole campaign went out.
    const error =
      target.state === "paused"
        ? "The campaign automation is paused. Switch it back on under Integrations to send."
        : "No campaign automation is configured, so nothing can be sent.";
    console.error(`[${label}] refusing to send: webhook is ${target.state}.`);
    return done({ ok: false, sent: 0, mode: target.state, campaign, error }, 503);
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
    console.error(`[${label}] fetch to n8n webhook failed:`, e);
    return done({ ok: false, sent: 0, mode: "live", error: "Could not reach the campaign automation." }, 502);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error(`[${label}] n8n webhook ${res.status}:`, detail.slice(0, 1000));
    return done({ ok: false, sent: 0, mode: "live", error: "The automation rejected the campaign." }, 502);
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
        props: { ...(input.ledgerProps ?? {}), ...(r.ledgerProps ?? {}) },
        lead_id: isUuid(r.id) ? r.id : null,
        campaign,
        category: r.category,
      })),
    );
  }

  // The client drops are reported on a SUCCESSFUL send too. A campaign that
  // quietly went to 48 of the 50 leads the operator picked would look like a
  // clean run; the count and the reasons are what make the difference visible.
  return done(
    {
      ok: true,
      sent: messages.length,
      mode: "live",
      campaign,
      suppressed: suppressedCount,
      clients: clientMatches.length || undefined,
      clientMatches: clientMatches.length ? clientMatches.slice(0, MAX_REPORTED_CLIENTS) : undefined,
      suppressedDomains: domainMatches.length || undefined,
      domainMatches: domainMatches.length ? domainMatches.slice(0, MAX_REPORTED_CLIENTS) : undefined,
    },
    200,
    recipients.map((r) => r.id),
  );
}
