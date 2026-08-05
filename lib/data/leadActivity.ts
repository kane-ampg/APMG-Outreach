/**
 * Client-side types + friendly-label mapping + demo dataset for the System →
 * Telemetry tab (per-lead click activity).
 *
 * The types mirror the GET /api/portal/lead-activity contract EXACTLY: the
 * route groups raw `portal_events` rows by lead_id into these camelCase
 * shapes, so the page never touches Supabase column names. Redeclared here
 * (rather than imported from lib/portal/server.ts) because that module is
 * server-only — it pulls in node:crypto and the service-role plumbing.
 *
 * The friendly-label helpers live here, next to the types, because they're
 * pure data → string mappings the page shouldn't own: every consumer of a
 * LeadActivityEvent should read the same story ("Clicked the email link",
 * "Sent an enquiry — Painting Services"), not re-derive it.
 *
 * The DEMO_* constants render when the API answers `mode: "demo"` (no
 * Supabase, or the portal tables haven't been migrated yet) so the tab reads
 * as a populated instrument instead of an empty shell — same convention as
 * lib/data/enquiries.ts. The dataset tells the real story: Melbourne
 * businesses from the Company-Brief priority sectors (childcare, aged care,
 * commercial property, schools) clicking an outreach email, browsing the
 * services portal, and one or two of them enquiring.
 */

/* ───────────────────────────  API contract types  ─────────────────────────── */

/** One click in a lead's trail, chronological ASC within LeadActivity.events.
 *  `service` is the ServicesPortal slug (portal_service_open / portal_inquiry);
 *  `destination` is where the tracked /t/ link redirected (attribution_click). */
export interface LeadActivityEvent {
  event: string;
  service: string | null;
  destination: string | null;
  /** accepted legal version (portal_consent_accept / legal_ack only) */
  version?: string | null;
  ts: string;
}

/** Everything one attributed lead did, as returned by /api/portal/lead-activity.
 *  `business` is null when the lead row was deleted/reimported since the click
 *  — the events survive because portal_events has no FK to leads. */
export interface LeadActivity {
  leadId: string;
  business: string | null;
  category: string | null;
  campaign: string | null;
  firstSeen: string;
  lastSeen: string;
  /** chronological ASC, capped to the most recent 50 by the route */
  events: LeadActivityEvent[];
  counts: {
    emailClicks: number;
    portalViews: number;
    serviceOpens: number;
    /** canonical `portal_inquiry` count (the client dup is excluded) */
    inquiries: number;
    /** questions asked of the portal assistant (`chat_prompt` ledger rows) */
    chatPrompts: number;
  };
}

/** The aggregate card for portal visitors with no attribution cookie. */
export interface AnonymousActivity {
  visitors: number;
  events: number;
  /** top 6 by opens */
  topServices: Array<{ service: string; opens: number }>;
}

/** Full GET /api/portal/lead-activity response shape. */
export interface LeadActivityResponse {
  ok: boolean;
  mode: "live" | "demo";
  /** portal tables missing (migration not run) — demo mode + this flag */
  needsMigration?: boolean;
  /** sorted lastSeen DESC, capped at 100 */
  leads: LeadActivity[];
  anonymous: AnonymousActivity;
}

/** The four KPI-row totals the page reads off GET /api/portal/summary. */
export interface ActivityTotals {
  attributionClicks: number;
  portalViews: number;
  serviceOpens: number;
  inquiries: number;
}

/* ───────────────────────────  friendly labels  ─────────────────────────── */

/** Full display names, mirroring the SERVICES array in ServicesPortal.tsx
 *  (which isn't exported — and importing the component would drag its icons
 *  and hero image into this data module). `general` is the hero/footer CTA
 *  pseudo-service. Keep in sync with ServicesPortal if services change. */
export const SERVICE_NAME: Record<string, string> = {
  electrical: "Electrical Services",
  painting: "Painting Services",
  plumbing: "Plumbing Services",
  carpentry: "Carpentry & Joinery",
  flooring: "Flooring Services",
  gardening: "Gardening & Grounds Maintenance",
  handyman: "Handyman Services",
  "make-safe": "Property Make Safe Services",
  general: "General enquiry",
};

/** Display name for a service slug; unknown slugs are humanised rather than
 *  leaked raw so a new portal card never renders as `make-good` in the UI. */
export function serviceName(slug: string | null): string {
  if (!slug) return "General enquiry";
  return SERVICE_NAME[slug] ?? humanise(slug.replace(/-/g, "_"));
}

/** Unknown event names → readable text ("composer_open" → "Composer open"). */
export function humanise(event: string): string {
  const s = event.replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : event;
}

/** `portal_inquiry_submit` is the client-side duplicate of the canonical
 *  server `portal_inquiry` event — showing both would double every enquiry
 *  in the trail, so timelines hide it. */
export function isHiddenEvent(event: string): boolean {
  return event === "portal_inquiry_submit";
}

/** Visual/semantic bucket for an event — drives the trail-chip icon + tone.
 *  "download" vs "email" splits attribution_click on its destination: the
 *  tracked /t/ link either forwarded to the portal (an email click) or to the
 *  sector info-pack PDF in Supabase Storage (a download). */
export type LeadEventKind =
  | "email"
  | "download"
  | "view"
  | "service"
  | "chat"
  | "enquiry"
  | "website"
  | "consent"
  | "other";

function isPackDownload(destination: string | null): boolean {
  if (!destination) return false;
  const d = destination.toLowerCase();
  return d.includes(".pdf") || d.includes("/storage/");
}

export function eventKind(ev: Pick<LeadActivityEvent, "event" | "destination">): LeadEventKind {
  switch (ev.event) {
    case "attribution_click":
      return isPackDownload(ev.destination) ? "download" : "email";
    case "portal_view":
      return "view";
    case "portal_service_open":
      return "service";
    // The portal assistant's durable quota ledger (lib/portal/chatQuota) — one
    // row per question a lead asked. Content-free by design (chars only), so
    // it tells the desk THAT they were researching, never what they typed.
    case "chat_prompt":
      return "chat";
    case "portal_inquiry":
      return "enquiry";
    case "portal_website_click":
      return "website";
    // Consent trail: the page-entry gate ack (legal_ack) and the validated
    // enquiry-form consent (server-emitted portal_consent_accept).
    case "legal_ack":
    case "portal_consent_accept":
      return "consent";
    default:
      return "other";
  }
}

/** The one sentence a human reads for this event — the spec's mapping table. */
export function eventLabel(
  ev: Pick<LeadActivityEvent, "event" | "service" | "destination" | "version">,
): string {
  switch (eventKind(ev)) {
    case "download":
      return "Downloaded the info pack";
    case "email":
      return "Clicked the email link";
    case "view":
      return "Viewed the services portal";
    case "service":
      // `general` = the hero/footer CTA, which opens the enquiry modal rather
      // than a trade card — "Viewed General enquiry" would misread.
      return ev.service === "general"
        ? "Opened the general enquiry form"
        : `Viewed ${serviceName(ev.service)}`;
    case "chat":
      return "Asked the portal assistant a question";
    case "enquiry":
      return ev.service ? `Sent an enquiry — ${serviceName(ev.service)}` : "Sent an enquiry";
    case "website":
      return "Opened apmgservices.com.au";
    case "consent": {
      // The version tag matters for compliance reads ("which wording did they
      // agree to?"), so it rides in the label when the event carried one.
      const version = ev.version ? ` · v${ev.version}` : "";
      return ev.event === "legal_ack"
        ? `Accepted the Terms & Privacy Policy — portal entry${version}`
        : `Accepted the Terms & Privacy Policy — enquiry consent${version}`;
    }
    default:
      return humanise(ev.event);
  }
}

/* ───────────────────────────  demo dataset  ─────────────────────────── */

/** Demo timestamps are anchored to "now" so relative times always read fresh
 *  (the page only renders after a client-side fetch, so no SSR mismatch). */
const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** Where the demo tracked links "redirected" — only the .pdf/.storage shape
 *  matters (it flips the label to "Downloaded the info pack"). */
const DEMO_PORTAL_URL = "https://apmg-leadgen.vercel.app/portal";
const DEMO_PACK_URL =
  "https://demo.supabase.co/storage/v1/object/public/sector-assets/childcare-sector-pack.pdf";

/**
 * Four sectors, five Melbourne leads, five believable journeys:
 *  1. Little Sprouts — the full funnel, ending in a painting enquiry.
 *  2. Banksia Gardens — browsed, left, came back, enquired about make-safe.
 *  3. Merri Creek PS — grabbed the info pack, browsed electrical, went quiet.
 *  4. Collins Street PG — browsed flooring, opened the enquiry form, bailed.
 *  5. Bright Beginnings — clicked through and bounced straight off the portal.
 * Sorted lastSeen DESC (like the API); events chronological ASC; counts match
 * the events exactly so the row chips and the expanded timeline agree.
 */
export const DEMO_LEAD_ACTIVITY: LeadActivity[] = [
  {
    leadId: "demo-lead-01",
    business: "Little Sprouts Early Learning",
    category: "Childcare & early learning",
    campaign: "childcare-melb-jul",
    firstSeen: hoursAgo(1.5),
    lastSeen: hoursAgo(1),
    events: [
      { event: "attribution_click", service: null, destination: DEMO_PORTAL_URL, ts: hoursAgo(1.5) },
      { event: "legal_ack", service: null, destination: null, version: "1.0", ts: hoursAgo(1.47) },
      { event: "portal_view", service: null, destination: null, ts: hoursAgo(1.45) },
      { event: "portal_service_open", service: "painting", destination: null, ts: hoursAgo(1.35) },
      { event: "portal_service_open", service: "handyman", destination: null, ts: hoursAgo(1.25) },
      { event: "attribution_click", service: null, destination: DEMO_PACK_URL, ts: hoursAgo(1.15) },
      { event: "chat_prompt", service: null, destination: null, ts: hoursAgo(1.1) },
      { event: "chat_prompt", service: null, destination: null, ts: hoursAgo(1.07) },
      { event: "portal_consent_accept", service: "painting", destination: null, version: "1.0", ts: hoursAgo(1.01) },
      { event: "portal_inquiry", service: "painting", destination: null, ts: hoursAgo(1) },
    ],
    counts: { emailClicks: 2, portalViews: 1, serviceOpens: 2, inquiries: 1, chatPrompts: 2 },
  },
  {
    leadId: "demo-lead-02",
    business: "Banksia Gardens Aged Care",
    category: "Aged care & retirement living",
    campaign: "aged-care-melb-jul",
    firstSeen: hoursAgo(6),
    lastSeen: hoursAgo(5),
    events: [
      { event: "attribution_click", service: null, destination: DEMO_PORTAL_URL, ts: hoursAgo(6) },
      { event: "portal_view", service: null, destination: null, ts: hoursAgo(5.9) },
      { event: "portal_service_open", service: "make-safe", destination: null, ts: hoursAgo(5.75) },
      { event: "portal_service_open", service: "plumbing", destination: null, ts: hoursAgo(5.6) },
      { event: "portal_website_click", service: null, destination: null, ts: hoursAgo(5.5) },
      { event: "portal_view", service: null, destination: null, ts: hoursAgo(5.2) },
      { event: "portal_service_open", service: "make-safe", destination: null, ts: hoursAgo(5.1) },
      { event: "portal_inquiry", service: "make-safe", destination: null, ts: hoursAgo(5) },
    ],
    counts: { emailClicks: 1, portalViews: 2, serviceOpens: 3, inquiries: 1, chatPrompts: 0 },
  },
  {
    leadId: "demo-lead-03",
    business: "Merri Creek Primary School",
    category: "Schools & education",
    campaign: "schools-melb-jul",
    firstSeen: hoursAgo(27),
    lastSeen: hoursAgo(26.3),
    events: [
      { event: "attribution_click", service: null, destination: DEMO_PACK_URL, ts: hoursAgo(27) },
      { event: "attribution_click", service: null, destination: DEMO_PORTAL_URL, ts: hoursAgo(26.6) },
      { event: "portal_view", service: null, destination: null, ts: hoursAgo(26.5) },
      { event: "chat_prompt", service: null, destination: null, ts: hoursAgo(26.4) },
      { event: "portal_service_open", service: "electrical", destination: null, ts: hoursAgo(26.3) },
    ],
    counts: { emailClicks: 2, portalViews: 1, serviceOpens: 1, inquiries: 0, chatPrompts: 1 },
  },
  {
    leadId: "demo-lead-04",
    business: "Collins Street Property Group",
    category: "Commercial property management",
    campaign: "commercial-pm-jun",
    firstSeen: hoursAgo(49),
    lastSeen: hoursAgo(48.4),
    events: [
      { event: "attribution_click", service: null, destination: DEMO_PORTAL_URL, ts: hoursAgo(49) },
      { event: "portal_view", service: null, destination: null, ts: hoursAgo(48.9) },
      { event: "portal_service_open", service: "flooring", destination: null, ts: hoursAgo(48.7) },
      { event: "portal_service_open", service: "general", destination: null, ts: hoursAgo(48.4) },
    ],
    counts: { emailClicks: 1, portalViews: 1, serviceOpens: 2, inquiries: 0, chatPrompts: 0 },
  },
  {
    leadId: "demo-lead-05",
    business: "Bright Beginnings Childcare",
    category: "Childcare & early learning",
    campaign: "childcare-melb-jul",
    firstSeen: hoursAgo(97),
    lastSeen: hoursAgo(96.9),
    events: [
      { event: "attribution_click", service: null, destination: DEMO_PORTAL_URL, ts: hoursAgo(97) },
      { event: "portal_view", service: null, destination: null, ts: hoursAgo(96.9) },
    ],
    counts: { emailClicks: 1, portalViews: 1, serviceOpens: 0, inquiries: 0, chatPrompts: 0 },
  },
];

/** Portal browsing with no attribution cookie — direct traffic, forwarded
 *  links, or leads who cleared cookies. 18 views + 29 card opens. */
export const DEMO_ANONYMOUS: AnonymousActivity = {
  visitors: 14,
  events: 47,
  topServices: [
    { service: "painting", opens: 9 },
    { service: "electrical", opens: 6 },
    { service: "plumbing", opens: 5 },
    { service: "handyman", opens: 4 },
    { service: "gardening", opens: 3 },
    { service: "make-safe", opens: 2 },
  ],
};

/**
 * KPI-row totals for demo mode. Deliberately NOT lib/data/enquiries'
 * DEMO_SUMMARY (132 clicks / 118 views): this page shows five demo trails, so
 * headline numbers must cohere with what's visible below them. Derived from
 * the datasets above: 7 attributed email clicks; 6 attributed + 18 anonymous
 * portal views; 8 attributed + 29 anonymous card opens; 2 attributed
 * enquiries + 1 direct one.
 */
export const DEMO_ACTIVITY_TOTALS: ActivityTotals = {
  attributionClicks: 7,
  portalViews: 24,
  serviceOpens: 37,
  inquiries: 3,
};
