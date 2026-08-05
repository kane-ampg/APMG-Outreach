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

/**
 * Groups dates by a period key, keeps the most recent `cap` buckets
 * oldest → newest, and marks the newest as `current`.
 */
function bucketBy(
  dates: Date[],
  startOf: (d: Date) => Date,
  label: (d: Date) => string,
  cap: number,
): Bar[] {
  const map = new Map<number, { date: Date; count: number }>();
  for (const d of dates) {
    const start = startOf(d);
    const key = start.getTime();
    const cur = map.get(key);
    if (cur) cur.count += 1;
    else map.set(key, { date: start, count: 1 });
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

/** All three grains from one set of event dates. */
export function volumeSeries(dates: Date[]): VolumeSeries {
  return {
    byDay: bucketBy(dates, startOfDay, monthDay, 14),
    byWeek: bucketBy(dates, startOfWeek, monthDay, 12),
    byMonth: bucketBy(dates, (d) => new Date(d.getFullYear(), d.getMonth(), 1), monthOnly, 12),
  };
}

/** How many of `dates` fall inside the last 24 hours. */
export function countLast24h(dates: Date[], now = Date.now()): number {
  let n = 0;
  for (const d of dates) if (now - d.getTime() <= DAY_MS) n += 1;
  return n;
}
