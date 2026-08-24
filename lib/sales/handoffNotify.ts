/**
 * "A lead just landed on your desk" — the email that goes out when an admin
 * hands a lead from Hot Leads over to Sales.
 *
 * WHY THIS EXISTS. The hand-off is the gate on the Sales queue (see
 * lib/sales/handoff.ts), but nothing used to TELL the desk a hand-off had
 * happened — a rep only found out by opening the console and noticing the badge.
 * Handed-over leads almost never enquire (they're outreach leads who clicked),
 * so the window where the interest is still warm is short, and a lead that sits
 * unnoticed for a day is usually a lead lost.
 *
 * WHAT IT SENDS. Not just "you have a new lead": the whole reason this lead was
 * worth passing over. For each handed-over lead the notifier re-reads the lead
 * row and its portal click trail, reduces them to the same `EngagementFacts`
 * the console's own brief renders (lib/data/enquiryActivity), and ships:
 *
 *   • the contact details a rep needs to ring them
 *   • the intent score + band that put them on Hot Leads in the first place
 *   • the deterministic prose summary — what they actually did
 *   • the talking points a rep skims before dialling
 *   • the dated timeline, so any of the above can be checked by eye
 *
 * GROUNDED, NOT GUESSED. Every line is read back out of the database here, not
 * taken from the request that triggered the hand-off, and it comes off the same
 * shared readers (lib/portal/leadBrief) the console's brief uses — so the email
 * and the console can never tell a rep two different stories about one lead.
 *
 * RECIPIENTS are the Integrations tab's notification address list
 * (`enquiry_notify_email`), the same internal audience as portal enquiries, sent
 * as ONE Gmail message with everyone on the To: header — never one send per
 * address, which would multiply the mailbox's daily cap.
 *
 * BEST EFFORT, ALWAYS. Every failure path here is swallowed and logged: the
 * hand-off itself is already recorded before this runs, and no notification
 * problem may ever undo or fail an admin's hand-off.
 *
 * Server-only (takes the Supabase service-role key).
 */

import { buildLeadFacts, fallbackSummary, talkingPoints } from "@/lib/data/enquiryActivity";
import { eventLabel } from "@/lib/data/leadActivity";
import { leadScore, scoreBand, SCORE_BANDS } from "@/lib/data/leadScore";
import { readLeadSubject, readTrail } from "@/lib/portal/leadBrief";
import { parseNotifyEmails } from "@/lib/pipeline/notifyEmails";
import {
  readSetting,
  salesNotifyWebhook,
  webhookAuthHeaders,
  SETTING_ENQUIRY_NOTIFY_EMAIL,
} from "@/lib/pipeline/server";

const LOG = "sales/handoff-notify";

/** How many leads get a full brief in one email. A hand-off POST may mark up to
 *  200 leads; briefing every one of them would produce a mail nobody reads and
 *  hundreds of REST reads on an admin's click. The rest are counted in a
 *  "+N more" line and are all still in the console queue. */
const MAX_BRIEFED = 20;

/** How many timeline steps ride along per lead. The counts above it are derived
 *  over the whole trail, so truncating the visible steps costs detail, never
 *  accuracy. */
const MAX_TIMELINE = 12;

/** Ceiling on the outbound webhook call. n8n answers in well under a second;
 *  this only exists so a hung endpoint can't hold an admin's click open. */
const WEBHOOK_TIMEOUT_MS = 10_000;

/** One step in the trail, ready to render. */
export interface NotifyTimelineStep {
  ts: string;
  label: string;
}

/** One handed-over lead, as the n8n workflow receives it. */
export interface NotifyLead {
  leadId: string;
  business: string | null;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  sector: string | null;
  campaign: string | null;
  /** intent score 0–100 (lib/data/leadScore) — null with no trail to score */
  score: number | null;
  /** the band that score falls in ("Hot", "Warm", …) */
  band: string | null;
  /** deterministic prose: what they did and how to open the call */
  summary: string;
  /** the skim-before-you-dial lines */
  talkingPoints: string[];
  /** the funnel tallies behind the summary, so the email can show the numbers */
  activity: {
    firstSeen: string;
    lastSeen: string;
    emailClicks: number;
    packDownloads: number;
    portalViews: number;
    serviceOpens: number;
    chatPrompts: number;
    enquiries: number;
    consented: boolean;
    daysActive: number;
    returned: boolean;
    steps: number;
    services: Array<{ service: string; opens: number }>;
  } | null;
  /** newest-last, capped at MAX_TIMELINE */
  timeline: NotifyTimelineStep[];
}

/** The body POSTed to the n8n Sales Handoff Notification webhook. */
export interface SalesHandoffNotifyPayload {
  /** discriminator — the workflow refuses anything else */
  type: "sales_handoff";
  /** bump when the shape changes in a way the workflow must notice */
  version: 1;
  /** canonical comma+space recipient list — ONE send, all recipients */
  notifyTo: string;
  handedOverAt: string;
  /** who pressed the button, for the "sent by" line */
  handedOverBy: { email: string; role: string; actingAs: string | null };
  /** the admin console origin, so the email can link back to the desk */
  consoleUrl: string | null;
  /** how many leads were handed over in this action */
  totalLeads: number;
  /** briefed leads (≤ MAX_BRIEFED); `totalLeads - leads.length` = the overflow */
  leads: NotifyLead[];
}

/** Score band id → its display label, so the email says "Hot", not "hot". */
function bandLabel(score: number): string {
  const id = scoreBand(score);
  return SCORE_BANDS.find((b) => b.id === id)?.label ?? id;
}

/**
 * Build one lead's brief. Never throws: a lead that can't be read is returned
 * with whatever is known plus an explicit summary saying so, because a rep
 * seeing "we couldn't read this one" is strictly better than a lead silently
 * missing from the email they were told lists everything.
 */
async function briefLead(base: string, key: string, leadId: string): Promise<NotifyLead> {
  const unknown: NotifyLead = {
    leadId,
    business: null,
    contactName: null,
    email: null,
    phone: null,
    website: null,
    sector: null,
    campaign: null,
    score: null,
    band: null,
    summary:
      "This lead was handed to the desk, but its record couldn't be read while the notification was being built. Open it on the Sales tab in the console for the full brief.",
    talkingPoints: [],
    activity: null,
    timeline: [],
  };

  const lead = await readLeadSubject(base, key, leadId, LOG);
  if (lead === "error" || lead === "missing") return unknown;

  const trail = await readTrail(base, key, lead.leadId, lead.business, lead.sector, LOG);
  const facts = buildLeadFacts(lead, trail);
  const score = trail ? leadScore(trail) : null;

  return {
    leadId,
    business: facts.business,
    contactName: facts.contactName,
    email: facts.email,
    phone: facts.phone,
    website: facts.website,
    sector: facts.sector,
    campaign: facts.campaign,
    score,
    band: score == null ? null : bandLabel(score),
    // The deterministic summary, not the AI one: this runs on an admin's click,
    // and the AI path is a metered spend surface with its own daily cap
    // (lib/ai/enquirySummary). The rep gets the AI brief when they open the
    // lead in the console; the email is grounded prose off the same facts.
    summary: fallbackSummary(facts),
    talkingPoints: talkingPoints(facts).map((p) => p.text),
    activity: facts.trail
      ? {
          firstSeen: facts.trail.firstSeen,
          lastSeen: facts.trail.lastSeen,
          emailClicks: facts.trail.emailClicks,
          packDownloads: facts.trail.packDownloads,
          portalViews: facts.trail.portalViews,
          serviceOpens: facts.trail.serviceOpens,
          chatPrompts: facts.trail.chatPrompts,
          enquiries: facts.trail.enquiries,
          consented: facts.trail.consented,
          daysActive: facts.trail.daysActive,
          returned: facts.trail.returned,
          steps: facts.trail.steps,
          services: facts.trail.services,
        }
      : null,
    // Chronological, newest last, tail-capped — the recent steps are the ones
    // that tell a rep how warm this is right now.
    timeline: (trail?.events ?? [])
      .slice(-MAX_TIMELINE)
      .map((ev) => ({ ts: ev.ts, label: eventLabel(ev) })),
  };
}

/**
 * Fire the Sales hand-off notification.
 *
 * Call it with the leads that were ACTUALLY newly marked (the hand-off route's
 * `fresh` set), never the requested set: marking is idempotent, so passing the
 * whole request would email the desk again on every double-click, stale tab or
 * retry — and a notification a rep learns to ignore is worse than none.
 *
 * Awaited by the caller rather than left dangling: the reads run in parallel and
 * cost one extra round trip on an admin action, and a serverless runtime is free
 * to kill the invocation the moment the response is returned — which would drop
 * a fire-and-forget notification on exactly the busy hand-offs that matter most.
 *
 * Resolves to true only when a notification was actually POSTed.
 */
export async function notifySalesHandoff(input: {
  base: string;
  key: string;
  /** the newly-marked lead ids (already uuid-validated by the route) */
  leadIds: string[];
  actor: { email: string; role: string; actingAs: string | null };
  /** admin console origin for the "open the desk" link, when known */
  consoleUrl: string | null;
}): Promise<boolean> {
  try {
    if (input.leadIds.length === 0) return false;

    // Parsed, not just truthiness-checked: a malformed stored value should skip
    // the send rather than POST junk that n8n silently drops.
    const parsed = parseNotifyEmails((await readSetting(SETTING_ENQUIRY_NOTIFY_EMAIL)) ?? "");
    if (!parsed.ok || parsed.emails.length === 0) return false; // nobody configured

    const target = await salesNotifyWebhook();
    if (target.state !== "ok") {
      // The hand-off is already recorded; the desk just won't be emailed.
      console.error(`[${LOG}] notification skipped: webhook is ${target.state}.`);
      return false;
    }

    const briefed = input.leadIds.slice(0, MAX_BRIEFED);
    if (input.leadIds.length > briefed.length) {
      console.error(
        `[${LOG}] ${input.leadIds.length} leads handed over; briefing the first ${briefed.length}.`,
      );
    }
    // In parallel: each brief is two dependent reads, so serialising the leads
    // would turn a 20-lead hand-off into 40 round trips of latency.
    const leads = await Promise.all(briefed.map((id) => briefLead(input.base, input.key, id)));

    const payload: SalesHandoffNotifyPayload = {
      type: "sales_handoff",
      version: 1,
      notifyTo: parsed.value,
      handedOverAt: new Date().toISOString(),
      handedOverBy: input.actor,
      consoleUrl: input.consoleUrl,
      totalLeads: input.leadIds.length,
      leads,
    };

    // Deliberately ONE request with every recipient joined, never one per
    // address: a single Gmail send counts once against the mailbox's daily cap.
    const res = await fetch(target.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...webhookAuthHeaders() },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[${LOG}] webhook answered ${res.status}.`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[${LOG}] notification failed (non-fatal):`, e);
    return false;
  }
}
