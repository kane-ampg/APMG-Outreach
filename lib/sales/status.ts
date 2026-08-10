import { type LeadState } from "@/lib/audit/replay";
import { type LeadAction } from "@/lib/audit/types";

// Shared contract for POST /api/sales/status. Client-safe (types only), so the
// route and SalesProvider cannot drift — same pattern as lib/sales/queue.ts.

/**
 * Actions a rep may take from the Sales desk.
 *
 * `handoff` and `returned` are deliberately absent: they belong to
 * /api/sales/handoff, which owns the portal_events row that actually gates
 * queue membership. Two write paths for one action is how ledgers drift.
 */
export type SalesStatusAction = Exclude<LeadAction, "handoff" | "returned">;

export interface SalesStatusRequest {
  leadId: string;
  action: SalesStatusAction;
  note?: string;
  /** AUD cents; required on closed_won */
  valueCents?: number;
}

export interface SalesStatusResponse {
  ok: boolean;
  /** the lead's state AFTER the write, replayed from the trail */
  state?: LeadState;
  error?: string;
}
