// Client-safe audit vocabulary: the action catalog, the row shape the API
// returns, and display labels. Imported by route handlers AND by the Audit
// tab, so it must never import `server-only` — same rule as lib/sales/queue.ts.

/** Actions that move a lead through the Sales desk. Replayed into a status. */
export const LEAD_ACTIONS = [
  "handoff",
  "contacted",
  "uncontacted",
  "closed_won",
  "closed_lost",
  "reopened",
  "returned",
] as const;

/** Actions recorded for the trail but which never change a lead's status. */
export const ADMIN_ACTIONS = [
  "campaign_send",
  "role_change",
  "invite",
  "force_logout",
  "view_as",
] as const;

export type LeadAction = (typeof LEAD_ACTIONS)[number];
export type AdminAction = (typeof ADMIN_ACTIONS)[number];
export type AuditAction = LeadAction | AdminAction;

export function isLeadAction(v: unknown): v is LeadAction {
  return typeof v === "string" && (LEAD_ACTIONS as readonly string[]).includes(v);
}

/**
 * Whether a human asserted the action or the server observed it.
 *
 * This is the honest answer to "is this proof?". Marking a lead contacted is a
 * claim a named person stakes their account on; a send the automation accepted
 * is something the server actually saw. The Audit tab badges them differently
 * so an admin never mistakes one for the other.
 */
export type AuditSource = "claimed" | "witnessed";

/** One audit row as the API returns it (camelCase; the table is snake_case). */
export interface AuditRow {
  id: string;
  action: AuditAction;
  actorEmail: string;
  actorRole: string;
  /** set only when an admin acted while previewing another role */
  actingAs: string | null;
  source: AuditSource;
  leadId: string | null;
  targetEmail: string | null;
  note: string | null;
  /** AUD cents */
  valueCents: number | null;
  createdAt: string;
}

export const ACTION_LABEL: Record<AuditAction, string> = {
  handoff: "Handed to Sales",
  contacted: "Marked contacted",
  uncontacted: "Undid contacted",
  closed_won: "Closed won",
  closed_lost: "Closed lost",
  reopened: "Reopened",
  returned: "Returned to admin",
  campaign_send: "Sent campaign",
  role_change: "Changed role",
  invite: "Invited user",
  force_logout: "Forced sign-out",
  view_as: "Viewed as another role",
};

/**
 * Minimum closing-note length. Shared with CloseDealModal rather than
 * redeclared there — the server rule and the button's enable rule must be the
 * same number, or the UI enables a submit the API then rejects.
 */
export const MIN_NOTE_LEN = 3;
