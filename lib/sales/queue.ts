// Shared contract for GET /api/sales/queue — the paginated Sales-queue read.
// Client-safe (types only): imported by the route (server) and SalesProvider
// (client), so the two can never drift apart.

/** One lead in the Sales queue, newest hand-off first. A lead is in the queue
 *  because an ADMIN passed it over from Hot Leads — never because it was merely
 *  emailed. Contact fields are null when the scraped lead doesn't have them. */
export interface SalesQueueRow {
  id: string;
  business: string;
  category: string | null;
  /** the lead's scraped address, shown as the card's location line */
  location: string | null;
  /** hostname/path only — the UI prepends https:// */
  website: string | null;
  phone: string | null;
  /** best contact address (same picker the campaign send uses) */
  email: string | null;
  rating: number | null;
  /** lead clicked the tracked /t/<id> link (attribution confirmed) */
  engaged: boolean;
  engagedAt: string | null;
  /** when admin handed this lead to Sales — the queue's ordering key, ISO */
  handedOffAt: string;
  /** most recent email_sent ledger row for this lead, ISO ("" if never sent) */
  lastSentAt: string;
  /** total outreach emails sent to this lead (ledger tally) */
  emailsSent: number;
  /** campaign tag of the most recent send */
  campaign: string | null;
}

/** One entry in the queue's hand-off roll: which lead, and when it was sent. */
export interface SalesHandoffStamp {
  leadId: string;
  /** ISO stamp of the ORIGINAL hand-off */
  at: string;
}

export interface SalesQueueResponse {
  ok: boolean;
  mode: "live" | "demo";
  rows: SalesQueueRow[];
  /** leads handed over, across ALL pages */
  total: number;
  /**
   * The most recent hand-off stamp in the WHOLE queue, ISO ("" when empty).
   *
   * Page-independent on purpose: it's how the Sales desk notices admin has sent
   * something new without having to be sitting on page 1. A poll compares this
   * against the last value the rep acknowledged — if it has moved forward,
   * there are arrivals.
   */
  latestHandoffAt: string;
  /** how many of those have clicked the tracked link */
  engagedTotal: number;
  /**
   * Every lead in the queue with its hand-off stamp, newest first —
   * page-independent, like `total`.
   *
   * This is the roll of what admin actually sent the desk, and it's what keeps
   * the rep's surfaces off admin-wide data: the stamps let the Sales overview
   * chart its own volume and 24h arrivals without reading the leads table, and
   * the ids let the Enquiries tab keep to enquiries from ITS leads. Bucketing is
   * left to the client so the bars are cut in the viewer's timezone.
   */
  handoffs: SalesHandoffStamp[];
  /**
   * The newest hand-offs, page-independent — the Sales overview's recent panel.
   * Separate from `rows` on purpose: `rows` follows whatever page the rep is
   * paged to on the Sales tab, and "latest" must not.
   */
  recent: SalesQueueRow[];
  /** 1-based page this response covers */
  page: number;
  pageSize: number;
  /** portal_events doesn't exist yet — run supabase/portal-telemetry.sql */
  needsMigration?: boolean;
  error?: string;
}
