/**
 * Time-bucketing for the volume histograms.
 *
 * Shared so every surface buckets identically: the admin/client Overview groups
 * lead `created_at`, the Sales overview groups hand-off stamps, and both want
 * the same day/week/month grammar.
 *
 * Deliberately client-side: buckets are cut in the VIEWER'S local timezone. If
 * an API route bucketed instead, a Vercel (UTC) server would shift ~10 hours of
 * every AU day into the previous bar.
 */

import type { Bar } from "./leads";

/** One volume series in the three grains the histogram cycles through. */
export interface VolumeSeries {
  /** oldest → newest, last ≤ 14 active days */
  byDay: Bar[];
  /** Monday-anchored, oldest → newest, last ≤ 12 active weeks */
  byWeek: Bar[];
  /** oldest → newest, last ≤ 12 active months */
  byMonth: Bar[];
}

export const EMPTY_SERIES: VolumeSeries = { byDay: [], byWeek: [], byMonth: [] };

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Monday-anchored start of the week containing `d`. */
function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const offset = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - offset);
  return x;
}

const monthDay = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
const monthOnly = (d: Date) => d.toLocaleDateString("en-US", { month: "long", year: "numeric" });

/** A date carrying a count, so a bucket can be built either from individual
 *  events (count 1 each) or from counts already grouped by day upstream. */
interface Weighted {
  date: Date;
  count: number;
}

/**
 * Groups weighted dates by a period key, keeps the most recent `cap` buckets
 * oldest → newest, and marks the newest as `current`.
 */
function bucketWeighted(
  entries: Weighted[],
  startOf: (d: Date) => Date,
  label: (d: Date) => string,
  cap: number,
): Bar[] {
  const map = new Map<number, Weighted>();
  for (const e of entries) {
    const start = startOf(e.date);
    const key = start.getTime();
    const cur = map.get(key);
    if (cur) cur.count += e.count;
    else map.set(key, { date: start, count: e.count });
  }
  const tail = [...map.values()].sort((a, b) => a.date.getTime() - b.date.getTime()).slice(-cap);
  return tail.map((e, i) => ({
    label: label(e.date),
    value: e.count,
    current: i === tail.length - 1,
  }));
}

/** ISO stamps → Date objects, dropping the absent and the unparseable. */
export function parseStamps(stamps: Iterable<string | null | undefined>): Date[] {
  const out: Date[] = [];
  for (const s of stamps) {
    if (!s) continue;
    const d = new Date(s);
    if (!Number.isNaN(d.getTime())) out.push(d);
  }
  return out;
}

const startOfMonth = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);

/** All three grains from one set of event dates. */
export function volumeSeries(dates: Date[]): VolumeSeries {
  const entries = dates.map((date) => ({ date, count: 1 }));
  return {
    byDay: bucketWeighted(entries, startOfDay, monthDay, 14),
    byWeek: bucketWeighted(entries, startOfWeek, monthDay, 12),
    byMonth: bucketWeighted(entries, startOfMonth, monthOnly, 12),
  };
}

/** One day's total, as `pipeline_lead_stats` returns it: a `YYYY-MM-DD` calendar
 *  day already cut at local midnight in the VIEWER's zone. */
export interface DayCount {
  d: string;
  n: number;
}

/**
 * `YYYY-MM-DD` → that calendar day at LOCAL midnight.
 *
 * Built from parts on purpose. `new Date("2026-07-15")` parses as UTC midnight,
 * which in any negative-offset zone lands on the 14th — so the day the server
 * cut in the viewer's zone would be relabelled a day earlier, and week/month
 * rollups would inherit the slip. Returns null for anything unparseable.
 */
function localDay(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * All three grains from day-grain counts computed in the database.
 *
 * The equivalent of volumeSeries() for data that never reaches the browser as
 * individual rows — the aggregate KPI path (/api/pipeline/stats). Because the
 * days were cut in the viewer's own zone, rolling them up into Monday-anchored
 * weeks and calendar months here is the same operation on the same boundaries
 * that volumeSeries would have performed over the raw rows.
 */
export function volumeSeriesFromDayCounts(days: Iterable<DayCount>): VolumeSeries {
  const entries: Weighted[] = [];
  for (const { d, n } of days) {
    const date = localDay(d);
    if (date && Number.isFinite(n) && n > 0) entries.push({ date, count: n });
  }
  return {
    byDay: bucketWeighted(entries, startOfDay, monthDay, 14),
    byWeek: bucketWeighted(entries, startOfWeek, monthDay, 12),
    byMonth: bucketWeighted(entries, startOfMonth, monthOnly, 12),
  };
}

/** How many of `dates` fall inside the last 24 hours. */
export function countLast24h(dates: Date[], now = Date.now()): number {
  let n = 0;
  for (const d of dates) if (now - d.getTime() <= DAY_MS) n += 1;
  return n;
}
