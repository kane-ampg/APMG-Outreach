/**
 * Client-side types for the admin Enquiries tab.
 *
 * The types mirror the portal-telemetry API contract EXACTLY (see
 * app/api/portal/summary + app/api/portal/inquiries): the server aggregates
 * raw `portal_events` / `portal_inquiries` rows into these camelCase shapes,
 * so the page never touches Supabase column names directly.
 *
 * There is no preset dataset. When the API answers `mode: "demo"` (no
 * SUPABASE_URL) the tab renders its real, empty structure — zeroed totals, no
 * inquiries — rather than an invented one: a believable preset is
 * indistinguishable from live telemetry in a screenshot, which is exactly the
 * failure mode this module used to have.
 */

import { DIRECT_SOURCE, OUTREACH_SOURCE } from "@/lib/portal/source";

/* ───────────────────────────  API contract types  ─────────────────────────── */

/** Enquiry triage states — mirrors INQUIRY_STATUSES in lib/portal/server.ts
 *  (redeclared here because that module is server-only). */
export const INQUIRY_STATUSES = ["new", "contacted", "closed"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

export function isInquiryStatus(v: unknown): v is InquiryStatus {
  return typeof v === "string" && (INQUIRY_STATUSES as readonly string[]).includes(v);
}

/** One portal enquiry, camelCase, as returned by GET /api/portal/inquiries.
 *  `email` is the lead-qualifying field; the attribution trio (leadId /
 *  business / category / campaign) is present only when the visitor arrived
 *  via a tracked outreach link — null means a direct visitor. */
export interface PortalInquiry {
  id: string;
  serviceSlug: string;
  serviceName: string | null;
  name: string | null;
  email: string;
  phone: string | null;
  message: string | null;
  leadId: string | null;
  business: string | null;
  campaign: string | null;
  category: string | null;
  /** Traffic source the enquirer arrived from ("tiktok" / "facebook" /
   *  "instagram" / …) — the apmg_src cookie set by a ?utm_source= tagged
   *  portal visit or a social Referer. Null = untagged (outreach or direct). */
  source: string | null;
  status: InquiryStatus;
  createdAt: string;
}

/** Aggregates from GET /api/portal/summary (server-side rollup of the last
 *  2000 portal_events + 500 portal_inquiries). */
export interface PortalSummary {
  mode: "live" | "demo";
  totals: {
    /** outreach email links opened (`attribution_click`) */
    attributionClicks: number;
    /** portal mounts (`portal_view`) */
    portalViews: number;
    /** service cards opened (`portal_service_open`) */
    serviceOpens: number;
    /** enquiries submitted (canonical server-side `portal_inquiry` count) */
    inquiries: number;
    /** distinct non-null visitor ids on portal_view */
    uniqueVisitors: number;
  };
  /** per-service interest, desc by opens + inquiries */
  byService: Array<{ service: string; opens: number; inquiries: number }>;
  /** per-sector journey (CSV category the lead was scraped under);
   *  the route maps a null category to "Direct / unknown" */
  byCategory: Array<{ category: string; clicks: number; views: number; inquiries: number }>;
  /** traffic channel rollup — where portal visitors and enquiries came from:
   *  social slugs ("tiktok" / "facebook" / "instagram" / …) from tagged links
   *  or social referers, plus the OUTREACH_SOURCE / DIRECT_SOURCE buckets */
  bySource: Array<{ source: string; visitors: number; views: number; inquiries: number }>;
  /** first 30 portal-relevant events, newest first */
  recentEvents: Array<{
    event: string;
    service: string | null;
    category: string | null;
    campaign: string | null;
    source: string | null;
    createdAt: string;
  }>;
}

/* ─────────────────────  who the Sales desk may see  ───────────────────── */

/**
 * Real inbound enquirers — people who genuinely submitted the portal form on
 * their own initiative, rather than rows the list inherits through outreach
 * attribution.
 *
 * The Sales Enquiries tab is scoped to the leads admin handed over (see
 * `salesCanSeeEnquiry`), and these names are the standing exception: a genuine
 * enquiry IS the rep's work whether or not its business was ever in the queue.
 *
 * It's an explicit list because nothing in the stored row distinguishes a real
 * enquiry from an attributed one — matched on the submitted name, normalised
 * for case and inner whitespace.
 */
export const GENUINE_ENQUIRERS: readonly string[] = ["nicole parseghian"];

function normalizeName(name: string | null): string {
  return (name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Whether a rep may see this enquiry: it belongs to one of the leads admin
 * handed the desk, or it's a genuine inbound enquirer.
 *
 * `queuedIds` is the hand-off roll from SalesProvider. Admin is never filtered —
 * only call this for the sales role.
 */
export function salesCanSeeEnquiry(q: PortalInquiry, queuedIds: ReadonlySet<string>): boolean {
  if (q.leadId && queuedIds.has(q.leadId)) return true;
  return GENUINE_ENQUIRERS.includes(normalizeName(q.name));
}

/* ───────────────────────────  display helpers  ─────────────────────────── */

/** Short display labels for the ServicesPortal slugs (+ the `general`
 *  pseudo-service the hero/footer CTAs submit under). */
export const SERVICE_LABEL: Record<string, string> = {
  electrical: "Electrical",
  painting: "Painting",
  plumbing: "Plumbing",
  carpentry: "Carpentry",
  flooring: "Flooring",
  gardening: "Gardening",
  handyman: "Handyman",
  "make-safe": "Make safe",
  general: "General",
};

export function serviceLabel(slug: string): string {
  return SERVICE_LABEL[slug] ?? slug;
}

/** Bucket name the summary route uses for unattributed traffic. */
export const DIRECT_CATEGORY = "Direct / unknown";

/** Display names for the traffic-source slugs (bySource rollup + the enquiry
 *  source chip). Slugs come from lib/portal/source.ts — utm_source values on
 *  the promoted portal link, plus the outreach/direct fallback buckets. */
export const SOURCE_LABEL: Record<string, string> = {
  tiktok: "TikTok",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X (Twitter)",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  google: "Google",
  [OUTREACH_SOURCE]: "Outreach email",
  [DIRECT_SOURCE]: DIRECT_CATEGORY,
};

export function sourceLabel(slug: string): string {
  return SOURCE_LABEL[slug] ?? slug.charAt(0).toUpperCase() + slug.slice(1);
}
