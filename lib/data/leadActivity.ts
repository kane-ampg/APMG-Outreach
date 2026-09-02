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
 * There is no preset dataset. When the API answers `mode: "demo"` (no
 * Supabase, or the portal tables haven't been migrated yet) the tab renders
 * its real, empty structure — zeroed totals, no leads — rather than an
 * invented one: a believable preset is indistinguishable from live telemetry
 * in a screenshot, which is exactly the failure mode this module used to have.
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

/** One anonymous visitor whose portal events carry a traffic source (the
 *  apmg_src cookie — a ?utm_source=facebook tagged link or a social Referer),
 *  grouped into the same trail shape as an attributed lead. No lead identity
 *  exists (visitorId is the client's random localStorage id), so these rows
 *  show the channel's engagement, never who the person is. */
export interface SourcedVisitorActivity {
  visitorId: string;
  /** canonical source slug ("facebook", "tiktok", …) — lib/portal/source.ts */
  source: string;
  firstSeen: string;
  lastSeen: string;
  /** chronological ASC, capped to the most recent 50 by the route */
  events: LeadActivityEvent[];
  /** emailClicks / chatPrompts are structurally 0 — both are attributed-only */
  counts: LeadActivity["counts"];
}

/** The aggregate card for portal visitors with no attribution cookie. */
export interface AnonymousActivity {
  visitors: number;
  events: number;
  /** top 6 by opens */
  topServices: Array<{ service: string; opens: number }>;
}

/** One recorded opt-out — a row of the `email_suppression` list the send route
 *  filters against. Keyed by ADDRESS (that's what a Spam Act opt-out attaches
 *  to, and it survives lead re-imports); `business` is resolved through the
 *  lead id the unsubscribe link carried, so a bare-address opt-out has none. */
export interface UnsubscribedPerson {
  email: string;
  business: string | null;
  category: string | null;
  leadId: string | null;
  campaign: string | null;
  /** "unsubscribe" for every self-service opt-out */
  reason: string;
  createdAt: string;
}

/** Full GET /api/portal/lead-activity response shape. */
export interface LeadActivityResponse {
  ok: boolean;
  mode: "live" | "demo";
  /** portal tables missing (migration not run) — demo mode + this flag */
  needsMigration?: boolean;
  /** sorted lastSeen DESC, capped at 100 */
  leads: LeadActivity[];
  /** source-tagged anonymous trails, sorted lastSeen DESC, capped at 50 */
  visitors: SourcedVisitorActivity[];
  anonymous: AnonymousActivity;
  /** sorted createdAt DESC, capped at 100 */
  unsubscribes: UnsubscribedPerson[];
  /** exact total — the KPI count stays honest past the row cap */
  unsubscribesTotal: number;
  /** false = the opt-out list couldn't be read (its migration,
   *  supabase/unsubscribe.sql, is separate from the portal tables). Zero
   *  unsubscribes and an unreadable list are different facts. */
  unsubscribesAvailable: boolean;
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
