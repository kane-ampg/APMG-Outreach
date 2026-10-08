import {
  emptySeries,
  INTERACTIONS,
  VISIT_EVENT,
  type InteractionId,
  type PerfSeries,
  type PerformanceRange,
} from "@/lib/data/performance";
import { GENERAL_SERVICE_SLUG } from "@/lib/data/serviceClicks";
import { isForgedBrowserUa } from "./scannerUa";
import { DIRECT_SOURCE, OUTREACH_SOURCE } from "./source";

/**
 * The tally behind GET /api/performance, kept out of the route so it can be
 * tested without a database. Rows go in, day-by-day counts come out: per kind
 * of interaction, per service, and portal visits, each against the period
 * just before.
 */

/** The zone the days are cut in when the browser doesn't say. APMG works in
 *  Victoria, so a day is a Melbourne day. */
export const DEFAULT_PERFORMANCE_TZ = "Australia/Melbourne";

const SERVICE_OPEN = "portal_service_open";

/** event name → the interaction it counts toward */
const EVENT_INTERACTION = new Map<string, InteractionId>(
  INTERACTIONS.flatMap((m) => m.events.map((e) => [e, m.id] as const)),
);

/** Every portal_events name this tally reads. */
export const PERFORMANCE_EVENTS: readonly string[] = [VISIT_EVENT, ...EVENT_INTERACTION.keys()];

export interface PerfEventRow {
  event: string | null;
  created_at: string | null;
  lead_id: string | null;
  visitor_id: string | null;
  service: string | null;
  source: string | null;
  ua: string | null;
}

export interface PerfInquiryRow {
  service_slug: string | null;
  lead_id: string | null;
  source?: string | null;
  created_at: string | null;
}

/** A browser-supplied zone if it's one this runtime knows, otherwise
 *  Melbourne. Only `/_+-` and alphanumerics get as far as Intl. */
export function safePerformanceZone(raw: string | null | undefined): string {
  if (!raw || raw.length > 64 || !/^[A-Za-z0-9/_+-]+$/.test(raw)) return DEFAULT_PERFORMANCE_TZ;
  try {
    new Intl.DateTimeFormat("en-AU", { timeZone: raw });
    return raw;
  } catch {
    return DEFAULT_PERFORMANCE_TZ;
  }
}

const dayFormats = new Map<string, Intl.DateTimeFormat>();

/** An instant → its calendar day (YYYY-MM-DD) in `tz`, or null if unreadable. */
export function localDay(iso: string | null | undefined, tz: string): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  let fmt = dayFormats.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-AU", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormats.set(tz, fmt);
  }
  const parts = Object.fromEntries(fmt.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** YYYY-MM-DD moved by `delta` calendar days. Plain calendar arithmetic, so
 *  daylight-saving changes in the zone can't skip or repeat a day. */
function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

/** The period being reported (the last `days` days, today included) and the
 *  one just before it, oldest day first. */
export function periodDays(days: number, tz: string, now: Date): { current: string[]; previous: string[] } {
  const today = localDay(now.toISOString(), tz) ?? now.toISOString().slice(0, 10);
  const current = Array.from({ length: days }, (_, i) => shiftDay(today, i - days + 1));
  const previous = Array.from({ length: days }, (_, i) => shiftDay(today, i - 2 * days + 1));
  return { current, previous };
}

/** The earliest instant the reads need, with two days spare so no zone's
 *  midnight can fall before it. */
export function readSince(days: number, now: Date): string {
  return new Date(now.getTime() - (2 * days + 2) * 86_400_000).toISOString();
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Which door a row came through. An explicit source (a tagged social link, a
 *  referring site) wins; an outreach-attributed row is the email; the rest
 *  are direct. Same rule as /api/portal/summary. */
function channelOf(source: string | null, leadId: string | null): string {
  return source ?? (leadId ? OUTREACH_SOURCE : DIRECT_SOURCE);
}

type Slot = { period: "current"; index: number } | { period: "previous" } | null;

function bump(series: PerfSeries, slot: Exclude<Slot, null>, channel: string): void {
  if (slot.period === "previous") {
    series.previous += 1;
    return;
  }
  series.daily[slot.index] += 1;
  series.total += 1;
  series.bySource[channel] = (series.bySource[channel] ?? 0) + 1;
}

export interface PerformanceTally {
  days: PerformanceRange;
  tz: string;
  dates: string[];
  interactions: Record<InteractionId, PerfSeries>;
  /** keyed by service slug; `general` is the enquiry form with no trade picked */
  services: Record<string, PerfSeries & { enquiries: number }>;
  visits: PerfSeries;
  visitors: number;
  scannerEventsExcluded: number;
}

export function tallyPerformance(opts: {
  events: readonly PerfEventRow[];
  inquiries: readonly PerfInquiryRow[];
  days: PerformanceRange;
  tz: string;
  now: Date;
}): PerformanceTally {
  const { days, tz } = opts;
  const { current, previous } = periodDays(days, tz, opts.now);
  const currentIndex = new Map(current.map((d, i) => [d, i]));
  const previousDays = new Set(previous);

  const slotOf = (iso: string | null): Slot => {
    const day = localDay(iso, tz);
    if (!day) return null;
    const index = currentIndex.get(day);
    if (index !== undefined) return { period: "current", index };
    return previousDays.has(day) ? { period: "previous" } : null;
  };

  const interactions = Object.fromEntries(INTERACTIONS.map((m) => [m.id, emptySeries(days)])) as Record<
    InteractionId,
    PerfSeries
  >;
  const services: PerformanceTally["services"] = {};
  const service = (slug: string) => (services[slug] ??= { ...emptySeries(days), enquiries: 0 });
  const visits = emptySeries(days);
  const visitors = new Set<string>();
  let scannerEventsExcluded = 0;

  for (const row of opts.events) {
    if (!row) continue;
    const event = str(row.event);
    if (!event) continue;
    const slot = slotOf(row.created_at);
    if (!slot) continue;
    // A mail gateway's sandbox runs the portal's JS and clicks like a person
    // would, but under a browser string no real browser sends. Leaving those
    // in would credit the services an outreach email happened to link to.
    if (isForgedBrowserUa(row.ua)) {
      if (slot.period === "current") scannerEventsExcluded += 1;
      continue;
    }
    const channel = channelOf(str(row.source), str(row.lead_id));

    if (event === VISIT_EVENT) {
      bump(visits, slot, channel);
      const visitor = str(row.visitor_id);
      if (visitor && slot.period === "current") visitors.add(visitor);
      continue;
    }
    if (event === SERVICE_OPEN) {
      const slug = str(row.service);
      if (!slug) continue;
      bump(service(slug), slot, channel);
      // The enquiry form opening isn't a trade's card being clicked.
      if (slug !== GENERAL_SERVICE_SLUG) bump(interactions.services, slot, channel);
      continue;
    }
    const id = EVENT_INTERACTION.get(event);
    if (id) bump(interactions[id], slot, channel);
  }

  for (const row of opts.inquiries) {
    if (!row) continue;
    const slot = slotOf(row.created_at);
    if (!slot) continue;
    bump(interactions.enquiries, slot, channelOf(str(row.source), str(row.lead_id)));
    if (slot.period === "current") service(str(row.service_slug) ?? GENERAL_SERVICE_SLUG).enquiries += 1;
  }

  return {
    days,
    tz,
    dates: current,
    interactions,
    services,
    visits,
    visitors: visitors.size,
    scannerEventsExcluded,
  };
}
