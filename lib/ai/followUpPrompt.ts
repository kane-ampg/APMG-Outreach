/**
 * The CONDITIONAL half of the cold-email composer: what gets appended to a
 * lead's message when we have already emailed them.
 *
 * A lead with one or more `email_sent` ledger rows should not receive a second
 * cold introduction. This module builds the extra instruction block that turns
 * the draft into a follow-up ("I wrote to you last week...") and, where the
 * lead has a click trail, points the pitch at the services they actually
 * opened on the portal.
 *
 * TWO THINGS THIS MODULE IS CAREFUL ABOUT:
 *
 * 1. It is APPENDED TO THE USER MESSAGE, never merged into the system
 *    instructions — exactly like the service focus and the batch angle
 *    (see composeEmail.ts). That keeps the saved compose_prompt row in the DB
 *    authoritative and leaves the cacheable KB system prefix byte-identical
 *    for cold and follow-up leads alike.
 *
 * 2. It forbids the email from ever REFERENCING the telemetry. The click trail
 *    is bot-inflated: mail gateway scanners detonate the tracked links within
 *    seconds of delivery and have been observed opening the portal assistant.
 *    So "I saw you were looking at gardening" is, often enough, a sentence
 *    addressed to a spam filter — and creepy even when it isn't. The trail
 *    STEERS which services the email leads with; it is never spoken aloud.
 *
 * Kept pure and framework-free (like composePrompt.ts) so the read-only "Email
 * Composer" config tab can display it and so it is testable without Supabase.
 */

/** What we know about a lead we've mailed before. Built server-side from the
 *  `email_sent` ledger + the customer-journey trail (lib/pipeline/leadHistory). */
export interface LeadHistory {
  /** how many outreach emails have gone to this lead (email_sent rows) */
  sends: number;
  /** ISO timestamp of the most recent send, or null if unreadable */
  lastSentAt: string | null;
  /** whole days between the most recent send and now */
  daysSince: number;
  /** ServicesPortal slugs they opened, most-opened first */
  services: string[];
  /** did anything at all come back (a click, a view, a question, an enquiry) */
  engaged: boolean;
}

/** How many services to name. Three is plenty to aim an email; more just
 *  dilutes the pitch and lets a scanner's scattergun trail set the agenda. */
const MAX_SERVICES = 3;

/** Slug → the words APMG actually uses for that trade, so the prompt never
 *  leaks an internal slug ("make-safe") into the copy. Mirrors the service
 *  names in lib/pipeline/services.ts, in the Australian voice of the KB. */
const SERVICE_WORDS: Record<string, string> = {
  electrical: "electrical work",
  painting: "painting",
  plumbing: "plumbing",
  carpentry: "carpentry",
  flooring: "flooring",
  gardening: "grounds and gardening",
  handyman: "general handyman repairs",
  "make-safe": "make safe works",
};

/**
 * Writing angles rotated across the follow-ups in a batch — deliberately
 * DIFFERENT from COMPOSE_ANGLES (composePrompt.ts). A second email that opens
 * on the same six shapes as the first reads as an autoresponder, which is
 * precisely what a follow-up must not read as.
 */
export const FOLLOW_UP_ANGLES = [
  "one specific, concrete thing APMG could take off their plate this month, rather than a general offer",
  "how easy it is to start small: one job, one site, no contract, and see how the crew works",
  "the jobs that are easy to put off until they become urgent, and what it costs to leave them",
  "a straightforward offer to come out, take a look at the site and give them a quote with no obligation",
  "who to talk to: a short, direct ask for the right person to speak with about maintenance",
  "seasonal timing: the upkeep worth booking in before it gets busy or the weather turns",
] as const;

/** Whole days between an ISO timestamp and now, floored at 0. Lives here, next
 *  to describeGap, because the two are one decision: how long ago the previous
 *  email went out, and what the writer is allowed to call that. */
export function daysSince(iso: string | null, nowMs = Date.now()): number {
  if (!iso) return 0;
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 0;
  return Math.max(0, Math.floor((nowMs - then) / 86_400_000));
}

/**
 * Turn a day count into the phrase the email may honestly use. The model is
 * never asked to guess this: a send from five months back that comes out as
 * "I wrote to you a few days ago" is a false statement in a cold email, and
 * the recipient is the one person guaranteed to know it's false.
 */
export function describeGap(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "about a week ago";
  if (days < 31) return `about ${Math.round(days / 7)} weeks ago`;
  if (days < 60) return "about a month ago";
  return `about ${Math.round(days / 30)} months ago`;
}

/** Map trail slugs → readable trade names, dropping anything unrecognised
 *  (the trail is written by the portal; an unknown slug is not copy). */
function serviceWords(services: string[]): string[] {
  const out: string[] = [];
  for (const slug of services) {
    const word = SERVICE_WORDS[(slug ?? "").trim().toLowerCase()];
    if (word && !out.includes(word)) out.push(word);
    if (out.length >= MAX_SERVICES) break;
  }
  return out;
}

/** Join a short list the way a person writes it: "a, b and c" — but fall back
 *  to plain commas when an item already contains "and", so a gardening lead
 *  doesn't read "grounds and gardening and painting". */
function joinWords(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  if (list.some((w) => w.includes(" and "))) return list.join(", ");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

/**
 * Build the follow-up instruction block for one lead, or "" when the lead has
 * never been emailed (in which case the composer's normal cold prompt stands
 * completely unchanged).
 */
export function buildFollowUpPrompt(history: LeadHistory | null | undefined): string {
  if (!history || history.sends < 1) return "";

  const count =
    history.sends === 1 ? "1 previous email," : `${history.sends} previous emails,`;
  const gap = describeGap(history.daysSince);
  // "recently" is simply false at five months, and the prompt must not hand the
  // writer a word the recipient can see is wrong.
  const when = history.daysSince < 31 ? "recently" : "some time ago";
  const lines: string[] = [
    `IMPORTANT: this lead has already been emailed by APMG (${count} the most recent one ${gap}). ` +
      `Write this as a FOLLOW-UP, not a first introduction:`,
    `- Open by acknowledging, briefly and without apologising, that you wrote to them ${when} (for example "I wrote to you ${gap} about looking after your site" or "Following up on my note from ${gap}"). Say it once, in a few words, then move on.`,
    `- Do not repeat the previous email. Assume they have already been told who APMG is, and lead with something new and specific instead.`,
    `- Never guilt them or imply they were rude not to reply, and never number the attempt ("my second email", "third time"). They are busy, not avoiding you.`,
    `- Keep it SHORTER than a first email: the greeting, one or two short paragraphs, the call to action, the sign-off.`,
  ];

  const words = serviceWords(history.services);
  if (words.length > 0) {
    lines.push(
      // Deliberately not "since that email": with several sends behind a lead
      // we cannot say which one drove the visit, and the prompt must not put a
      // claim in the writer's hands that the recipient could know is wrong.
      `This lead has been looking at these APMG services on our website: ${joinWords(words)}.`,
      `- Lead the email with ${words.length === 1 ? "that service" : "those services"} and make ${words.length === 1 ? "it" : "them"} the star of the pitch, still tailored to the recipient's sector and the people who use their site every day. Mention APMG's other trades only briefly, as backup.`,
      `- CRITICAL: never mention, hint at, imply or reference that we can see what they viewed, clicked, opened or downloaded. Do not write "I saw you", "I noticed you", "you had a look at", "since you were browsing", or anything of that kind. The only sign of this knowledge may be that the email happens to be about the right thing. Breaking this rule is a serious error.`,
    );
  } else {
    lines.push(
      `Nothing has come back from that email. Do not mention that, do not ask why they did not reply, and do not refer to their silence in any way.`,
      `- Write a brief, low-pressure nudge that comes at APMG from a different angle than a standard introduction would, and give them one easy, concrete reason to reply this time.`,
    );
  }

  return lines.join("\n");
}
