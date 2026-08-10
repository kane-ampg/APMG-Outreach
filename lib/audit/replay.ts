import { isLeadAction, type AuditRow } from "./types";

/**
 * Deriving a lead's Sales status by folding its audit rows.
 *
 * Status is NOT stored anywhere, and that is deliberate: the fold makes it
 * impossible for a closed deal to exist without the row naming who closed it,
 * which is the guarantee the whole audit trail exists to provide. Pure and
 * dependency-free, so it can be unit-tested without a database and reused on
 * both sides of the wire.
 */

export type SalesStatus = "new" | "contacted" | "closed_won" | "closed_lost";

export interface LeadState {
  status: SalesStatus;
  closedNote: string | null;
  /** AUD cents; null on a loss or an open lead */
  closedValueCents: number | null;
  closedAt: string | null;
  /** the SSO address that closed it */
  closedBy: string | null;
}

export const INITIAL_LEAD_STATE: LeadState = {
  status: "new",
  closedNote: null,
  closedValueCents: null,
  closedAt: null,
  closedBy: null,
};

/** Fold order. The id tiebreaker is required for determinism when two rows
 *  share a timestamp, and matches the ordering the queue route already uses. */
function inFoldOrder(rows: AuditRow[]): AuditRow[] {
  return [...rows].sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.createdAt < b.createdAt
        ? -1
        : 1,
  );
}

export function replay(rows: AuditRow[]): LeadState {
  let state: LeadState = { ...INITIAL_LEAD_STATE };
  // Whether a contact was claimed in the CURRENT desk cycle. That is what a
  // reopen falls back to, so reopening a worked deal doesn't pretend the calls
  // never happened, and reopening one closed straight from new doesn't invent
  // a contact nobody ever claimed.
  let contactedThisCycle = false;

  for (const r of inFoldOrder(rows)) {
    if (!isLeadAction(r.action)) continue;
    switch (r.action) {
      // A hand-off starts a fresh cycle and a return ends one. Both reset:
      // without this, a lead returned to admin and later handed over again
      // would replay its previous outcome forever.
      case "handoff":
      case "returned":
        state = { ...INITIAL_LEAD_STATE };
        contactedThisCycle = false;
        break;
      case "contacted":
        state = { ...INITIAL_LEAD_STATE, status: "contacted" };
        contactedThisCycle = true;
        break;
      case "uncontacted":
        state = { ...INITIAL_LEAD_STATE };
        contactedThisCycle = false;
        break;
      case "closed_won":
        state = {
          status: "closed_won",
          closedNote: r.note,
          closedValueCents: r.valueCents,
          closedAt: r.createdAt,
          closedBy: r.actorEmail,
        };
        break;
      case "closed_lost":
        state = {
          status: "closed_lost",
          closedNote: r.note,
          closedValueCents: null,
          closedAt: r.createdAt,
          closedBy: r.actorEmail,
        };
        break;
      case "reopened":
        state = {
          ...INITIAL_LEAD_STATE,
          status: contactedThisCycle ? "contacted" : "new",
        };
        break;
    }
  }
  return state;
}

/** Replay many leads at once. Rows with no lead id (role changes, view-as)
 *  are skipped — they belong to the trail, not to any lead's status. */
export function replayByLead(rows: AuditRow[]): Map<string, LeadState> {
  const grouped = new Map<string, AuditRow[]>();
  for (const r of rows) {
    if (!r.leadId) continue;
    const list = grouped.get(r.leadId);
    if (list) list.push(r);
    else grouped.set(r.leadId, [r]);
  }
  const out = new Map<string, LeadState>();
  for (const [leadId, leadRows] of grouped) out.set(leadId, replay(leadRows));
  return out;
}
