// Shared contract for /api/sales/handoff — the operator decisions behind the
// Hot Leads tab. Client-safe (types + event names only): imported by the route
// (server), the Sales queue route (server) and the Hot Leads store (client),
// so none of them can drift apart.
//
// A hot lead is DERIVED (intent score > 50 from portal_events), so the list
// itself needs no storage. What needs storing is what the operator DID with it:
//
//   handoff  — "passed to Sales". This is the gate on the Sales queue: reps see
//              a lead because an admin sent it, never because it was emailed.
//   archived — "done with this one on Hot Leads". Purely a Hot Leads view
//              state: it hides the lead from the working lists (and from the
//              badge) without touching the lead, its trail, or its hand-off.
//   returned — "Sales is sending this one back", optionally with a note (the
//              common one being "we already work with them"). Returning also
//              CLEARS the hand-off, so the lead leaves the rep queue by the
//              normal gate and reappears on Hot Leads for admin — with the
//              rep's note attached. That's the feedback channel from Sales
//              back to admin.
//
// Each is one row per lead in portal_events — the same ledger pattern
// `email_sent` already uses — so both ship on the existing portal-telemetry.sql
// schema with no new table.

/** portal_events event name for one admin → Sales hand-off. */
export const HANDOFF_EVENT = "sales_handoff";

/** portal_events event name for "hidden from the Hot Leads working lists". */
export const ARCHIVE_EVENT = "hot_lead_archived";

/** portal_events event name for "Sales handed this back to admin". */
export const RETURN_EVENT = "sales_returned";

/** Which ledger a request is talking about. */
export type MarkerKind = "handoff" | "archived" | "returned";

export const MARKER_EVENT: Record<MarkerKind, string> = {
  handoff: HANDOFF_EVENT,
  archived: ARCHIVE_EVENT,
  returned: RETURN_EVENT,
};

export function isMarkerKind(v: unknown): v is MarkerKind {
  return v === "handoff" || v === "archived" || v === "returned";
}

/** Longest note we'll store on a marker (portal_events props are capped too). */
export const MAX_NOTE_LEN = 500;

/** One marked lead: the uuid, when the mark was first made, and — for returns
 *  — whatever the rep wrote when sending it back. */
export interface LeadMarker {
  leadId: string;
  /** ISO stamp of the earliest row, so a re-mark can't make it look fresh */
  at: string;
  /** the rep's reason, on `returned` markers. Null when they didn't give one. */
  note?: string | null;
}

/** Every GET/POST/DELETE answers with BOTH ledgers, so the client only ever
 *  needs one round trip to know the full state of the tab. */
export interface SalesHandoffResponse {
  ok: boolean;
  mode: "live" | "demo";
  /** portal_events doesn't exist yet — run supabase/portal-telemetry.sql */
  needsMigration?: boolean;
  handoffs: LeadMarker[];
  archived: LeadMarker[];
  /** leads Sales sent back, newest first, each carrying the rep's note */
  returned: LeadMarker[];
  error?: string;
}
