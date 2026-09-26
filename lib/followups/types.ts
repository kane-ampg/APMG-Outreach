/**
 * Client-safe contract for the Hot-Lead Follow-Up pipeline — constants, the
 * `follow_ups` row shape, the derived queue item, and every API response.
 * Imported by the pure modules, the server routes AND the client hook, so none
 * of them can drift apart. See docs/superpowers/specs/2026-09-25-hot-lead-follow-up-design.md.
 */

/** Campaign tag on every follow-up send (and its `email_sent` ledger rows). */
export const FOLLOW_UP_CAMPAIGN = "hot-followup";

/** Touch 2 comes due this many Mon–Fri days after touch 1 was sent. */
export const TOUCH2_BUSINESS_DAYS = 5;

/** A first service open this soon after delivery is probably a mail scanner. */
export const SCANNER_GAP_MS = 60_000;

/** Business days are counted on Melbourne calendar dates. */
export const FOLLOW_UP_TZ = "Australia/Melbourne";

/** Leads per draft REQUEST (one Claude call each, paced under COMPOSE_RATE). */
export const MAX_DRAFT_PER_REQUEST = 8;

/** Leads one "Draft all" click drafts (the client sends it in request-size chunks). */
export const MAX_DRAFT_ALL = 20;

/** Drafts per send request. */
export const MAX_SEND_PER_REQUEST = 50;

export const MAX_FOLLOW_UP_SUBJECT = 300;
export const MAX_FOLLOW_UP_HTML = 20_000;
export const MAX_FOLLOW_UP_NOTE = 500;

/** `sending` is the claim a send request takes on a draft BEFORE handing it to
 *  n8n, so two overlapping sends can't both deliver it. It settles to sent,
 *  blocked or (automation refused) back to draft. */
export const FOLLOW_UP_STATUSES = ["draft", "sending", "sent", "skipped", "blocked", "replied"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export type Touch = 1 | 2;

/** One row of the `follow_ups` table (supabase/follow-ups.sql). */
export interface FollowUpRow {
  id: string;
  lead_id: string;
  touch: Touch;
  status: FollowUpStatus;
  subject: string | null;
  body_html: string | null;
  service_slug: string | null;
  model: string | null;
  note: string | null;
  drafted_at: string | null;
  sent_at: string | null;
  sent_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Where a lead sits in the pipeline:
 *   ready     — needs a draft for `touch`
 *   awaiting  — a draft for `touch` is waiting for approval
 *   sending   — a send request holds the row for `touch`; outcome not settled yet
 *   waiting   — touch 1 sent, touch 2 not due until `touch2DueOn`
 *   done      — sequence over (touch 2 sent, skipped, replied or blocked) → Ready for Sales
 *   excluded  — not eligible (enquired, with Sales, archived, client, opted out, no email)
 */
export type FollowUpStage = "ready" | "awaiting" | "sending" | "waiting" | "done" | "excluded";

export interface FollowUpQueueItem {
  leadId: string;
  business: string | null;
  category: string | null;
  website: string | null;
  email: string | null;
  score: number;
  /** most-opened service slug — the one the email leads with */
  service: string | null;
  /** every opened service slug, most-opened first */
  services: string[];
  stage: FollowUpStage;
  /** the touch in play (ready/awaiting/sending/waiting); null when done/excluded */
  touch: Touch | null;
  /** why sending/done/excluded */
  reason: string | null;
  /** the draft row when stage = awaiting */
  draft: FollowUpRow | null;
  touch1SentAt: string | null;
  /** Melbourne calendar date (YYYY-MM-DD) touch 2 comes due */
  touch2DueOn: string | null;
  likelyScanner: boolean;
  /** seconds from the last prior send to the first service open */
  scannerGapSeconds: number | null;
  /** client name when the lead only RESEMBLES a client (a warning, not an exclusion) */
  clientWarning: string | null;
}

export interface FollowUpQueueResponse {
  ok: boolean;
  mode: "live" | "demo";
  /** the follow_ups table is missing — run supabase/follow-ups.sql */
  needsMigration?: boolean;
  error?: string;
  items: FollowUpQueueItem[];
}

export interface FollowUpDraftResponse {
  ok: boolean;
  error?: string;
  /** lead ids drafted and saved */
  drafted: string[];
  failed: Array<{ leadId: string; error: string }>;
  /** lead ids not attempted before the time budget ran out — resubmit them */
  remaining: string[];
}

export interface FollowUpSendResponse {
  ok: boolean;
  error?: string;
  mode?: string;
  sent: number;
  blocked: Array<{ leadId: string; reason: string }>;
  skipped: Array<{ leadId: string; reason: string }>;
  /** set when the emails went out but the rows couldn't all be marked sent */
  warning?: string;
}

export interface FollowUpMutationResponse {
  ok: boolean;
  error?: string;
  row?: FollowUpRow;
}
