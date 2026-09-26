import { serviceBySlug } from "@/lib/pipeline/services";
import type { Touch } from "@/lib/followups/types";
import {
  buildFollowUpPrompt,
  FOLLOW_UP_ANGLES,
  joinWords,
  NO_TRACKING_RULE,
  serviceWords,
  type LeadHistory,
} from "./followUpPrompt";

/**
 * The touch-specific block for a HOT-LEAD follow-up (Follow-Ups tab), appended
 * to the user message after buildFollowUpPrompt's generic follow-up block —
 * never merged into the system prefix, so the live compose_prompt row stays in
 * charge and the cached KB prefix stays byte-identical.
 *
 * Touch 1 makes the lead's most-opened service the whole email. Touch 2 is the
 * last one: same service, a different angle, shorter, and an easy way out. It
 * is shown touch 1's email (`previous`) so it can steer away from it.
 * Both carry NO_TRACKING_RULE exactly once — the trail steers the topic and is
 * never spoken aloud (the trail is bot-inflated; see followUpPrompt.ts).
 *
 * No em dashes in any line here: prompt punctuation leaks into the copy.
 */

/** How much of touch 1's text touch 2 is shown: enough to steer away from. */
const PREVIOUS_MAX_CHARS = 1500;

/** Touch 1's own punctuation must not reintroduce em dashes into the prompt. */
const noEmDash = (s: string) => s.replace(/\s*—\s*/g, ", ");

function previousEmailBlock(previous: { subject: string; text: string }): string | null {
  const subject = noEmDash(previous.subject.trim());
  let text = noEmDash(previous.text.trim());
  if (!subject && !text) return null;
  if (text.length > PREVIOUS_MAX_CHARS) text = `${text.slice(0, PREVIOUS_MAX_CHARS).trimEnd()} …`;
  return `For reference only, this is APMG's previous email to them (do not repeat it, and do not quote it):\nSubject: ${subject}\n${text}`;
}

/** A stable angle per lead, so a redraft doesn't flip to a different one. */
export function followUpAngleFor(leadId: string): string {
  let h = 0;
  for (const ch of leadId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FOLLOW_UP_ANGLES[h % FOLLOW_UP_ANGLES.length];
}

export function buildHotFollowUpPrompt(input: {
  history: LeadHistory | null;
  services: string[];
  touch: Touch;
  leadId: string;
  /** touch 2 only: touch 1's email as saved (plain text, no {{link}}) */
  previous?: { subject: string; text: string };
}): string {
  const services = input.services.length > 0 ? input.services : (input.history?.services ?? []);
  const words = serviceWords(services);
  const primary = words[0] ?? "looking after their site";
  const svc = serviceBySlug(services[0]);
  const lines: string[] = [];

  const base = input.history ? buildFollowUpPrompt({ ...input.history, services }) : "";
  if (base) {
    lines.push(base);
  } else {
    // No email_sent row for this lead (a pre-ledger warm-up send, or a lost
    // row). We know they heard from us (they clicked a tracked link) but not
    // WHEN, so the writer must not put a date on it.
    lines.push(
      `IMPORTANT: this lead has already heard from APMG. Write this as a short, friendly follow-up, not a first introduction, but do not say when APMG last wrote.`,
    );
    if (words.length > 0) {
      lines.push(`This lead has been looking at these APMG services on our website: ${joinWords(words)}.`);
    }
  }

  if (svc) {
    lines.push(`What APMG's ${svc.name} covers (the only facts you may use about it): ${svc.focus}`);
  }

  if (input.touch === 1) {
    lines.push(
      `THIS EMAIL (follow-up 1 of 2): make ${primary} the whole subject of the email. Give one concrete, practical example of how APMG handles ${primary} for a site like theirs, then one easy next step: a quick call, or a no-obligation site visit and quote.`,
      `- The subject line must be about ${primary} for their site. Never a generic "Following up" or "Checking in".`,
    );
  } else {
    const prev = input.previous ? previousEmailBlock(input.previous) : null;
    if (prev) lines.push(prev);
    lines.push(
      `THIS EMAIL (follow-up 2 of 2, the last one for now): stay on ${primary}, but come at it from this angle: ${followUpAngleFor(input.leadId)}.`,
      `- Do not reuse the opening, the example or the call to action from APMG's previous email.`,
      `- Keep it to the greeting, one short paragraph, the call to action and the sign-off.`,
      `- End with an easy, no-pressure line: if the timing isn't right, that's completely fine, and they can get in touch whenever it suits.`,
    );
  }

  if (!lines.some((l) => l.includes(NO_TRACKING_RULE))) lines.push(NO_TRACKING_RULE);
  return lines.join("\n");
}
