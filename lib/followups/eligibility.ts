import { FOLLOW_UP_MIN_SCORE, leadScore } from "@/lib/data/leadScore";
import { serviceBySlug } from "@/lib/pipeline/services";
import { isTouch2Due, touch2DueOn } from "./schedule";
import { SCANNER_GAP_MS, type FollowUpQueueItem, type FollowUpRow, type FollowUpStage } from "./types";

/**
 * Where one lead sits in the Follow-Up pipeline — pure, so the queue, the
 * draft route and the send route all make the SAME decision, and it is
 * testable without Supabase. The server (lib/followups/server.ts) gathers the
 * facts; this module only judges them.
 *
 * Exclusions are checked BEFORE the lead's follow_ups rows on purpose: a draft
 * written yesterday for a lead who enquired this morning must read as
 * excluded, so the send route refuses it.
 */

/** What portal_events says about one lead. */
export interface LeadSignals {
  leadId: string;
  /** service slug → how many times they opened it */
  serviceOpens: Record<string, number>;
  /** ISO time of their first service open */
  firstServiceOpenAt: string | null;
  inquiries: number;
  /** every email_sent timestamp for this lead (any campaign) */
  sends: string[];
  handedOff: boolean;
  /** Sales sent it back (sales_returned); `returnedNote` is the rep's reason */
  returned: boolean;
  returnedNote: string | null;
  archived: boolean;
}

/** What the leads table says (null when the lead row is gone). */
export interface LeadContact {
  business: string | null;
  category: string | null;
  website: string | null;
  /** the address a follow-up goes to (bestEmail of `emails`) */
  email: string | null;
  /** every stored address, for the client guard */
  emails: string[];
}

/** What the Master Client List and the opt-out list say. */
export interface LeadGuard {
  /** client display name when the lead is an existing customer */
  client: string | null;
  optedOut: boolean;
  /** business name (or "another lead") when a DIFFERENT lead with this address
   *  already has a draft, sending or sent follow-up */
  sharedWith: string | null;
  /** client name when the lead only resembles a client (a warning, not an exclusion) */
  clientWarning: string | null;
}

export function emptySignals(leadId: string): LeadSignals {
  return {
    leadId,
    serviceOpens: {},
    firstServiceOpenAt: null,
    inquiries: 0,
    sends: [],
    handedOff: false,
    returned: false,
    returnedNote: null,
    archived: false,
  };
}

/** Known service slugs, most-opened first (ties by slug, for stable output). */
export function rankedServices(opens: Record<string, number>): string[] {
  return Object.entries(opens)
    .filter(([slug, n]) => n > 0 && serviceBySlug(slug) !== null)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([slug]) => slug);
}

/** The shared intent score, fed only the counts that decide the top bands. */
export function signalScore(s: LeadSignals): number {
  const serviceOpens = rankedServices(s.serviceOpens).reduce((n, slug) => n + s.serviceOpens[slug], 0);
  return leadScore({
    counts: { inquiries: s.inquiries, serviceOpens, portalViews: 0, emailClicks: 0, chatPrompts: 0 },
  });
}

/** ms from the most recent send at or before the first service open, to that open. */
export function scannerGap(s: LeadSignals): number | null {
  if (!s.firstServiceOpenAt) return null;
  const open = Date.parse(s.firstServiceOpenAt);
  if (!Number.isFinite(open)) return null;
  let last = -Infinity;
  for (const iso of s.sends) {
    const t = Date.parse(iso);
    if (Number.isFinite(t) && t <= open && t > last) last = t;
  }
  return Number.isFinite(last) ? open - last : null;
}

export function classifyLead(input: {
  signals: LeadSignals;
  contact: LeadContact | null;
  guard: LeadGuard;
  rows: FollowUpRow[];
  now: number;
}): FollowUpQueueItem | null {
  const { signals, contact, guard, rows, now } = input;
  const score = signalScore(signals);
  if (score < FOLLOW_UP_MIN_SCORE) return null;

  const services = rankedServices(signals.serviceOpens);
  const gap = scannerGap(signals);
  const r1 = rows.find((r) => r.touch === 1) ?? null;
  const r2 = rows.find((r) => r.touch === 2) ?? null;

  const base: FollowUpQueueItem = {
    leadId: signals.leadId,
    business: contact?.business ?? null,
    category: contact?.category ?? null,
    website: contact?.website ?? null,
    email: contact?.email ?? null,
    score,
    service: services[0] ?? null,
    services,
    stage: "ready",
    touch: 1,
    reason: null,
    draft: null,
    touch1SentAt: r1?.status === "sent" ? r1.sent_at : null,
    touch2DueOn: null,
    likelyScanner: gap !== null && gap < SCANNER_GAP_MS,
    scannerGapSeconds: gap === null ? null : Math.round(gap / 1000),
    clientWarning: guard.clientWarning,
  };
  const finish = (stage: FollowUpStage, reason: string): FollowUpQueueItem => ({ ...base, stage, touch: null, reason });

  if (signals.inquiries > 0) return finish("excluded", "Enquired — Sales owns this lead");
  if (signals.handedOff) return finish("excluded", "Already with Sales");
  if (signals.returned) {
    return finish("excluded", `Returned by Sales${signals.returnedNote ? ": " + signals.returnedNote : ""}`);
  }
  if (signals.archived) return finish("excluded", "Archived on Hot Leads");
  if (!contact) return finish("excluded", "Lead is no longer in the leads table");
  if (!contact.email) return finish("excluded", "No email address on file");
  if (guard.client) return finish("excluded", `Existing client (${guard.client})`);
  if (guard.optedOut) return finish("excluded", "Opted out");
  if (guard.sharedWith) return finish("excluded", `Same address as ${guard.sharedWith} (already in follow-ups)`);

  // A send request has claimed this row and not settled it. Nothing may act on
  // it: if the server died mid-send the email may or may not have gone.
  const sending = rows.find((r) => r.status === "sending");
  if (sending) {
    return {
      ...base,
      stage: "sending",
      touch: sending.touch,
      reason:
        "Sending — if this stays here for more than a few minutes, check the outreach mailbox's Sent folder before doing anything",
    };
  }

  const closed = rows.find((r) => r.status === "skipped" || r.status === "replied" || r.status === "blocked");
  if (closed) {
    const reason =
      closed.status === "replied"
        ? "Replied — stopped"
        : closed.status === "skipped"
          ? closed.note ? `Skipped: ${closed.note}` : "Skipped"
          : `Blocked: ${closed.note ?? "dropped at send"}`;
    return finish("done", reason);
  }
  if (r2?.status === "sent") return finish("done", "Both follow-ups sent");

  if (!r1) return base;
  if (r1.status === "draft") return { ...base, stage: "awaiting", touch: 1, draft: r1 };

  // touch 1 has been sent
  if (r2?.status === "draft") return { ...base, stage: "awaiting", touch: 2, draft: r2 };
  const due = r1.sent_at ? touch2DueOn(r1.sent_at) : null;
  if (r1.sent_at && isTouch2Due(r1.sent_at, now)) return { ...base, stage: "ready", touch: 2, touch2DueOn: due };
  return { ...base, stage: "waiting", touch: 2, touch2DueOn: due };
}

const STAGE_ORDER: Record<FollowUpStage, number> = { awaiting: 0, sending: 1, ready: 2, waiting: 3, done: 4, excluded: 5 };

export function sortQueue(items: FollowUpQueueItem[]): FollowUpQueueItem[] {
  return [...items].sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || b.score - a.score);
}
