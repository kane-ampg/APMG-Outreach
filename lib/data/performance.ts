import { SERVICE_NAME } from "./leadActivity";
import { GENERAL_SERVICE_SLUG } from "./serviceClicks";

/**
 * The Performance tab: how the customer portal is doing, laid out the way
 * Google Business Profile's Performance screen is. One headline count of
 * interactions over a chosen period, a chart of it by day, the same count split
 * by kind (calls, quote clicks, enquiries…), and a table of clicks per service.
 *
 * NO IMPRESSIONS. Google can count everyone who saw a listing in a search
 * result. The portal only ever sees people who arrived, so every number here
 * starts at a visit or a click.
 *
 * This module is shared: GET /api/performance builds the payload with the
 * constants below, and the page re-validates it with toPerformance.
 */

export const PERFORMANCE_RANGES = [7, 28, 90, 180] as const;
export type PerformanceRange = (typeof PERFORMANCE_RANGES)[number];
export const DEFAULT_RANGE: PerformanceRange = 28;

export const RANGE_LABEL: Record<PerformanceRange, string> = {
  7: "7 days",
  28: "28 days",
  90: "3 months",
  180: "6 months",
};

/** A `?days=` value → a range this tab offers; anything else is the default. */
export function toRange(raw: unknown): PerformanceRange {
  const n = typeof raw === "string" ? Number(raw) : raw;
  return (PERFORMANCE_RANGES as readonly unknown[]).includes(n) ? (n as PerformanceRange) : DEFAULT_RANGE;
}

export type InteractionId =
  | "services"
  | "quotes"
  | "calls"
  | "enquiries"
  | "chats"
  | "website"
  | "email"
  | "whatsapp"
  | "reviews";

export interface InteractionMeta {
  id: InteractionId;
  label: string;
  /** what one count is, for the chart readout */
  unit: string;
  /** one line on what is being counted */
  hint: string;
  /** the portal_events names that count toward it. Enquiries are read from
   *  portal_inquiries instead, the canonical store, so they list none. */
  events: readonly string[];
}

/** Every kind of interaction, in the order the breakdown lists them. */
export const INTERACTIONS: readonly InteractionMeta[] = [
  {
    id: "services",
    label: "Service clicks",
    unit: "clicks",
    hint: "A trade's card opened",
    events: ["portal_service_open"],
  },
  {
    id: "quotes",
    label: "Quote clicks",
    unit: "clicks",
    hint: "“Get a quote” or “Tell us what needs doing”",
    events: ["portal_quote_click"],
  },
  { id: "calls", label: "Calls", unit: "calls", hint: "Phone number tapped", events: ["portal_phone_click"] },
  { id: "enquiries", label: "Enquiries", unit: "enquiries", hint: "Enquiry form sent", events: [] },
  { id: "chats", label: "Chats", unit: "chats", hint: "Chat assistant opened", events: ["portal_chat_open"] },
  {
    id: "website",
    label: "Website clicks",
    unit: "clicks",
    hint: "Out to an APMG website",
    events: ["portal_website_click", "portal_main_website_click"],
  },
  { id: "email", label: "Email clicks", unit: "clicks", hint: "Email address clicked", events: ["portal_email_click"] },
  { id: "whatsapp", label: "WhatsApp", unit: "clicks", hint: "WhatsApp link clicked", events: ["portal_whatsapp_click"] },
  {
    id: "reviews",
    label: "Reviews clicks",
    unit: "clicks",
    hint: "Google reviews opened",
    events: ["portal_google_reviews_click"],
  },
];

/** A page load of the portal. Context for the clicks, never one of them. */
export const VISIT_EVENT = "portal_view";

/** The portal's trades in their authored order, the tie-breaker when two
 *  services have the same number of clicks. */
export const TRADE_ORDER: readonly string[] = Object.keys(SERVICE_NAME).filter(
  (s) => s !== GENERAL_SERVICE_SLUG,
);

export interface PerfSeries {
  /** one count per day in `dates`, oldest first */
  daily: number[];
  /** the sum of `daily` */
  total: number;
  /** the same count over the period just before this one */
  previous: number;
  /** this period's count per channel (outreach / direct / facebook / …) */
  bySource: Record<string, number>;
}

export interface ServicePerf extends PerfSeries {
  service: string;
  /** enquiries sent for this service this period */
  enquiries: number;
}

export interface Performance {
  mode: "live" | "demo";
  needsMigration: boolean;
  days: PerformanceRange;
  /** the zone the days were cut in */
  tz: string;
  /** YYYY-MM-DD, oldest first, `days` long */
  dates: string[];
  interactions: Record<InteractionId, PerfSeries>;
  /** every trade, zero-click ones included, most-clicked first */
  services: ServicePerf[];
  /** the enquiry form opened without a trade picked. Not a trade, so it stays
   *  out of the ranking (lib/data/serviceClicks has the same rule). */
  general: ServicePerf;
  visits: PerfSeries;
  /** distinct browsers that loaded the portal this period */
  visitors: number;
  /** this period's events dropped because their browser string is one only a
   *  mail scanner sends (lib/portal/scannerUa) */
  scannerEventsExcluded: number;
  /** when the server computed these figures (ISO). Up to five minutes old on
   *  a cache hit; null in demo mode. */
  computedAt: string | null;
}

export function emptySeries(days: number): PerfSeries {
  return { daily: Array.from({ length: days }, () => 0), total: 0, previous: 0, bySource: {} };
}

const count = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;

function toSeries(raw: unknown, days: number): PerfSeries {
  const o = (raw ?? {}) as Partial<Record<keyof PerfSeries, unknown>>;
  const given = Array.isArray(o.daily) ? o.daily : [];
  const daily = Array.from({ length: days }, (_, i) => count(given[i]));
  const bySource: Record<string, number> = {};
  if (o.bySource && typeof o.bySource === "object" && !Array.isArray(o.bySource)) {
    for (const [source, n] of Object.entries(o.bySource as Record<string, unknown>)) {
      if (source && count(n) > 0) bySource[source] = count(n);
    }
  }
  return { daily, total: daily.reduce((a, b) => a + b, 0), previous: count(o.previous), bySource };
}

function toServicePerf(service: string, raw: unknown, days: number): ServicePerf {
  const o = (raw ?? {}) as { enquiries?: unknown };
  return { service, ...toSeries(raw, days), enquiries: count(o.enquiries) };
}

/** Re-validate the route's payload field by field, like every other payload
 *  the console reads. Every trade is listed whether or not it was clicked:
 *  "nobody opened Carpentry" is an answer too. */
export function toPerformance(payload: unknown): Performance {
  const p = (payload ?? {}) as Record<string, unknown>;
  const days = toRange(p.days);
  const given = Array.isArray(p.dates) ? p.dates.filter((d): d is string => typeof d === "string") : [];
  const dates = given.length === days ? given : Array.from({ length: days }, (_, i) => given[i] ?? "");

  const rawInteractions = (p.interactions ?? {}) as Record<string, unknown>;
  const interactions = Object.fromEntries(
    INTERACTIONS.map((m) => [m.id, toSeries(rawInteractions[m.id], days)]),
  ) as Record<InteractionId, PerfSeries>;

  const rawServices =
    p.services && typeof p.services === "object" && !Array.isArray(p.services)
      ? (p.services as Record<string, unknown>)
      : {};
  // Known trades first in portal order, then anything the portal has added
  // since this list was written; its clicks still count.
  const slugs = [
    ...TRADE_ORDER,
    ...Object.keys(rawServices).filter((s) => s && s !== GENERAL_SERVICE_SLUG && !TRADE_ORDER.includes(s)),
  ];
  const services = slugs
    .map((s, i) => ({ row: toServicePerf(s, rawServices[s], days), i }))
    .sort((a, b) => b.row.total - a.row.total || a.i - b.i)
    .map(({ row }) => row);

  return {
    mode: p.mode === "live" ? "live" : "demo",
    needsMigration: p.needsMigration === true,
    days,
    tz: typeof p.tz === "string" && p.tz ? p.tz : "",
    dates,
    interactions,
    services,
    general: toServicePerf(GENERAL_SERVICE_SLUG, rawServices[GENERAL_SERVICE_SLUG], days),
    visits: toSeries(p.visits, days),
    visitors: count(p.visitors),
    scannerEventsExcluded: count(p.scannerEventsExcluded),
    computedAt:
      typeof p.computedAt === "string" && Number.isFinite(Date.parse(p.computedAt)) ? p.computedAt : null,
  };
}

/** Several series added together, day by day and channel by channel. */
export function sumSeries(list: readonly PerfSeries[], days: number): PerfSeries {
  const out = emptySeries(days);
  for (const s of list) {
    for (let i = 0; i < days; i++) out.daily[i] += s.daily[i] ?? 0;
    out.total += s.total;
    out.previous += s.previous;
    for (const [source, n] of Object.entries(s.bySource)) out.bySource[source] = (out.bySource[source] ?? 0) + n;
  }
  return out;
}

/** Change against the previous period as a fraction (0.25 = up 25%). Null when
 *  the previous period had nothing to compare against. */
export function pctChange(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

export interface ChartBucket {
  /** first and last day it covers, YYYY-MM-DD */
  start: string;
  end: string;
  value: number;
}

/** Days up to this many chart one bar per day; longer ranges chart a week a bar. */
export const DAILY_BAR_LIMIT = 31;

/**
 * The chart's bars. Up to a month, one bar per day. Past that, a bar per seven
 * days counted back from today, so the newest bar is always a full week and
 * only the oldest can be short.
 */
export function chartBuckets(dates: readonly string[], daily: readonly number[]): ChartBucket[] {
  if (dates.length <= DAILY_BAR_LIMIT) {
    return dates.map((d, i) => ({ start: d, end: d, value: daily[i] ?? 0 }));
  }
  const out: ChartBucket[] = [];
  for (let end = dates.length; end > 0; end -= 7) {
    const start = Math.max(0, end - 7);
    let value = 0;
    for (let i = start; i < end; i++) value += daily[i] ?? 0;
    out.unshift({ start: dates[start], end: dates[end - 1], value });
  }
  return out;
}
