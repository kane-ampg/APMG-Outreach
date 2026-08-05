"use client";

/**
 * Hand-offs made from THIS browser, this session.
 *
 * The Sales desk announces work arriving from admin. Without this, an admin who
 * sends five leads over from Hot Leads gets an "5 new leads arrived" modal
 * twenty seconds later — announcing their own click back at them. The console
 * and the desk share one SalesProvider, so both see the same queue.
 *
 * So the arrival check skips anything this browser is responsible for. Another
 * operator's hand-offs still notify normally, which is the case that matters.
 * Session-scoped on purpose: after a reload the queue is simply "what's there",
 * and the watermark seeds from it without announcing anything anyway.
 */

const mine = new Set<string>();

/** Record leads this browser just handed to Sales. */
export function noteSelfHandoff(leadIds: Iterable<string>): void {
  for (const id of leadIds) mine.add(id);
}

/** Did this browser hand this lead over? */
export function isSelfHandoff(leadId: string): boolean {
  return mine.has(leadId);
}

/** Forget one — a pull-back means a later re-hand should announce again. */
export function forgetSelfHandoff(leadId: string): void {
  mine.delete(leadId);
}
