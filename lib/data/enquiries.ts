/**
 * Client-side types + demo dataset for the admin Enquiries tab.
 *
 * The types mirror the portal-telemetry API contract EXACTLY (see
 * app/api/portal/summary + app/api/portal/inquiries): the server aggregates
 * raw `portal_events` / `portal_inquiries` rows into these camelCase shapes,
 * so the page never touches Supabase column names directly.
 *
 * The DEMO_* constants render when the API answers `mode: "demo"` (no
 * SUPABASE_URL) so the tab reads as a populated instrument instead of an empty
 * shell — same convention as lib/data/leads.ts. The dataset tells the real
 * story: Melbourne businesses from the Company-Brief priority sectors
 * (childcare, aged care, commercial property management, schools, body
 * corporate) clicking an outreach email, browsing the services portal, and
 * enquiring about one of the eight APMG services.
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

/* ───────────────────────────  demo dataset  ─────────────────────────── */

/** Demo timestamps are anchored to "now" so relative times always read fresh
 *  (the page only renders after a client-side fetch, so no SSR mismatch). */
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

export const DEMO_SUMMARY: PortalSummary = {
  mode: "demo",
  totals: {
    attributionClicks: 132,
    portalViews: 118,
    serviceOpens: 78,
    inquiries: 8,
    uniqueVisitors: 61,
  },
  // desc by opens + inquiries — painting leads (APMG's founding trade)
  byService: [
    { service: "painting", opens: 21, inquiries: 2 },
    { service: "electrical", opens: 14, inquiries: 1 },
    { service: "plumbing", opens: 12, inquiries: 1 },
    { service: "handyman", opens: 9, inquiries: 0 },
    { service: "make-safe", opens: 7, inquiries: 1 },
    { service: "gardening", opens: 6, inquiries: 1 },
    { service: "general", opens: 4, inquiries: 1 },
    { service: "flooring", opens: 3, inquiries: 1 },
    { service: "carpentry", opens: 2, inquiries: 0 },
  ],
  // Company-Brief priority sectors; one Direct bucket for untracked traffic
  byCategory: [
    { category: "Childcare & early learning", clicks: 38, views: 34, inquiries: 2 },
    { category: "Aged care & retirement living", clicks: 29, views: 26, inquiries: 2 },
    { category: "Commercial property management", clicks: 24, views: 21, inquiries: 1 },
    { category: "Body corporate & strata", clicks: 22, views: 18, inquiries: 1 },
    { category: "Schools & education", clicks: 19, views: 14, inquiries: 1 },
    { category: DIRECT_CATEGORY, clicks: 0, views: 5, inquiries: 1 },
  ],
  // Traffic channels — outreach email still dominates, the social links are
  // starting to move (reconciles with totals: 61 visitors / 118 views / 8 enq)
  bySource: [
    { source: OUTREACH_SOURCE, visitors: 38, views: 74, inquiries: 7 },
    { source: "tiktok", visitors: 10, views: 19, inquiries: 1 },
    { source: "facebook", visitors: 6, views: 12, inquiries: 0 },
    { source: "instagram", visitors: 4, views: 8, inquiries: 0 },
    { source: DIRECT_SOURCE, visitors: 3, views: 5, inquiries: 0 },
  ],
  recentEvents: [
    { event: "portal_inquiry", service: "painting", category: "Childcare & early learning", campaign: "childcare-melb-jul", source: null, createdAt: hoursAgo(1) },
    { event: "portal_service_open", service: "painting", category: "Childcare & early learning", campaign: "childcare-melb-jul", source: null, createdAt: hoursAgo(1.1) },
    { event: "portal_view", service: null, category: "Childcare & early learning", campaign: "childcare-melb-jul", source: null, createdAt: hoursAgo(1.2) },
    { event: "attribution_click", service: null, category: "Childcare & early learning", campaign: "childcare-melb-jul", source: null, createdAt: hoursAgo(1.2) },
    { event: "portal_view", service: null, category: null, campaign: null, source: "instagram", createdAt: hoursAgo(3) },
    { event: "portal_service_open", service: "make-safe", category: "Aged care & retirement living", campaign: "aged-care-melb-jul", source: null, createdAt: hoursAgo(4) },
    { event: "portal_view", service: null, category: null, campaign: null, source: "tiktok", createdAt: hoursAgo(6) },
    { event: "portal_service_open", service: "plumbing", category: "Body corporate & strata", campaign: "strata-melb-jun", source: null, createdAt: hoursAgo(9) },
    { event: "attribution_click", service: null, category: "Schools & education", campaign: "schools-melb-jul", source: null, createdAt: hoursAgo(12) },
  ],
};

/**
 * Believable Melbourne enquiries — newest first, like the API returns.
 *
 * The `leadId`s deliberately line up with DEMO_LEAD_ACTIVITY in
 * lib/data/leadActivity.ts, business for business, so a row's "View" modal shows
 * the trail that belongs to it. The two rows whose businesses have no demo trail
 * (Horizon Body Corporate, Wattle Grove) carry ids that match nothing on
 * purpose: they exercise the "no tracked trail" state the modal has to handle
 * for real direct enquirers.
 */
export const DEMO_INQUIRIES: PortalInquiry[] = [
  {
    id: "demo-enq-01",
    serviceSlug: "painting",
    serviceName: "Painting Services",
    name: "Melissa Nguyen",
    email: "director@littlesproutselc.com.au",
    phone: "(03) 9380 4127",
    message:
      "We're an early learning centre in Brunswick and need our two toddler rooms repainted over the September holidays — low-VOC paint is a must and work has to happen outside operating hours. Could we get a quote and a copy of your compliance and insurance docs?",
    leadId: "demo-lead-01",
    business: "Little Sprouts Early Learning",
    campaign: "childcare-melb-jul",
    category: "Childcare & early learning",
    source: null,
    status: "new",
    createdAt: hoursAgo(1),
  },
  {
    id: "demo-enq-02",
    serviceSlug: "make-safe",
    serviceName: "Property Make Safe Services",
    name: "Rob Calloway",
    email: "facilities@banksiagardens.com.au",
    phone: "0412 883 902",
    message:
      "Saturday's storm brought a branch down on the pergola at our Doncaster facility and part of the walkway is roped off. We need a make-safe this week and a repair quote to follow — residents use that path daily.",
    leadId: "demo-lead-02",
    business: "Banksia Gardens Aged Care",
    campaign: "aged-care-melb-jul",
    category: "Aged care & retirement living",
    source: null,
    status: "contacted",
    createdAt: hoursAgo(5),
  },
  {
    id: "demo-enq-03",
    serviceSlug: "plumbing",
    serviceName: "Plumbing Services",
    name: "Priya Sharma",
    email: "psharma@horizonbodycorp.com.au",
    phone: "(03) 8610 4455",
    message:
      "We manage a 48-lot complex in Docklands with a recurring leak in the basement carpark riser. After a plumber who can do a camera inspection and provide a written report for the owners corporation meeting on the 24th.",
    leadId: "demo-lead-06",
    business: "Horizon Body Corporate Services",
    campaign: "strata-melb-jun",
    category: "Body corporate & strata",
    source: null,
    status: "new",
    createdAt: hoursAgo(11),
  },
  {
    id: "demo-enq-04",
    serviceSlug: "electrical",
    serviceName: "Electrical Services",
    name: "Greg Anastasiou",
    email: "maintenance@merricreekps.vic.edu.au",
    phone: "(03) 9482 7731",
    message:
      "Our primary school in Northcote needs the emergency exit lighting tested and tagged before the compliance audit in August, plus four new external sensor lights by the gym. Do you carry Working with Children checks for on-site staff?",
    leadId: "demo-lead-03",
    business: "Merri Creek Primary School",
    campaign: "schools-melb-jul",
    category: "Schools & education",
    source: null,
    status: "contacted",
    createdAt: hoursAgo(26),
  },
  {
    id: "demo-enq-05",
    serviceSlug: "flooring",
    serviceName: "Flooring Services",
    name: "Janine Whitfield",
    email: "j.whitfield@collinsstpg.com.au",
    phone: "0433 217 660",
    message:
      "Level 3 tenancy in our Collins Street building is being refit — roughly 240 sqm of carpet tiles to replace, ideally over two weekends. After a supply-and-install quote with lead times.",
    leadId: "demo-lead-04",
    business: "Collins Street Property Group",
    campaign: "commercial-pm-jun",
    category: "Commercial property management",
    source: null,
    status: "new",
    createdAt: hoursAgo(31),
  },
  {
    id: "demo-enq-06",
    serviceSlug: "gardening",
    serviceName: "Gardening & Grounds Maintenance",
    name: "Tom Papadakis",
    email: "tom.p@claytonparkoffices.com.au",
    phone: null,
    message:
      "Hi, just after regular fortnightly grounds maintenance for a small office park in Clayton — lawns, edges and the front garden beds. What would your rates look like on an ongoing arrangement?",
    leadId: null,
    business: null,
    campaign: null,
    category: null,
    source: "tiktok",
    status: "new",
    createdAt: hoursAgo(50),
  },
  {
    id: "demo-enq-07",
    serviceSlug: "general",
    serviceName: "General enquiry",
    name: "Sandra Liu",
    email: "admin@brightbeginningsgw.com.au",
    phone: "(03) 9560 2218",
    message:
      "We run a childcare centre in Glen Waverley and are looking to consolidate our trades under one provider — painting touch-ups, a sticking gate, and a leaking tap for starters. Keen to understand how your one-call arrangement works.",
    leadId: "demo-lead-05",
    business: "Bright Beginnings Childcare",
    campaign: "childcare-melb-jul",
    category: "Childcare & early learning",
    source: null,
    status: "contacted",
    createdAt: hoursAgo(74),
  },
  {
    id: "demo-enq-08",
    serviceSlug: "painting",
    serviceName: "Painting Services",
    name: "Karen O'Brien",
    email: "manager@wattlegrovevillage.com.au",
    phone: "(03) 9707 5583",
    message:
      "Our Berwick retirement village needs the community hall and two corridors repainted before our spring open day. Residents are on site all day, so we'd need dust and odour kept to a minimum.",
    leadId: "demo-lead-08",
    business: "Wattle Grove Retirement Village",
    campaign: "aged-care-melb-jul",
    category: "Aged care & retirement living",
    source: null,
    status: "closed",
    createdAt: hoursAgo(96),
  },
];
