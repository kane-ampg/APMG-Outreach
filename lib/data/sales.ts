/**
 * Sales queue types. A lead reaches Sales only AFTER admin has sent the
 * automation's custom email — live, that gate is the `email_sent` ledger in
 * portal_events, read by /api/sales/queue and mapped into this shape by
 * SalesProvider. `engaged` means the lead clicked the tracked link in that
 * email (proof the automation worked + the lead is ours).
 *
 * Optional fields are simply absent on real scraped leads (no AI brief, score,
 * or deal estimate yet) until a rep sets them by hand.
 *
 * This file used to also export an eight-record demo preset and a fabricated
 * rep name ("Dana Okafor"). Both are gone: the preset rendered as a real
 * queue whenever Supabase was unconfigured, and the name printed over live
 * data on the Sales header.
 */

export type SalesStatus = "new" | "contacted" | "closed_won" | "closed_lost";

export interface SalesLead {
  id: string;
  business: string;
  category: string;
  location?: string;
  website?: string;
  phone?: string;
  email?: string;
  rating?: number;
  reviews?: number;
  /** fit / qualification score 0–100 */
  score?: number;
  /** AI-prepared brief the rep reads before the call */
  aiSummary?: string;
  talkingPoints?: string[];
  /** admin has sent the automation's custom email — gates entry to the queue */
  emailSent: boolean;
  emailSentAt: string;
  /** total outreach emails sent to this lead (email_sent ledger tally) */
  emailsSent?: number;
  /** lead clicked the tracked link in the email (attribution confirmed) */
  engaged: boolean;
  engagedAt?: string;
  status: SalesStatus;
  assignedRep?: string;
  /** estimated (open) or realised (won) deal value, USD */
  dealValue?: number;
  /** when it landed in the sales queue */
  receivedAt: string;
  /** set when the rep closes the deal via the close modal */
  closedNote?: string;
  closedAt?: string;
  closedValue?: number;
}
