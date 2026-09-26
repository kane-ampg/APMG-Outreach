import { FOLLOW_UP_TZ, TOUCH2_BUSINESS_DAYS } from "./types";

/**
 * Melbourne business-day maths for touch 2. Pure and dependency-free.
 *
 * Days are counted on Melbourne CALENDAR dates, not 24-hour spans: an email
 * sent at 11pm Thursday is a Thursday send, and touch 2 comes due at local
 * midnight on its due date — matching the no-weekends send schedule
 * (documentation/send-schedule.md). Public holidays are not modelled.
 */

const YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: FOLLOW_UP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Melbourne calendar date of an instant, as YYYY-MM-DD. */
export function melbourneYmd(ms: number): string {
  const p: Record<string, string> = {};
  for (const part of YMD.formatToParts(new Date(ms))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function isWeekday(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/** A year of days is far past any follow-up window; bounds the loop. */
const MAX_SCAN_DAYS = 400;

/** Weekdays strictly after the send's local date, up to and including today's. */
export function businessDaysSince(sentIso: string, nowMs: number): number {
  const sent = Date.parse(sentIso);
  if (!Number.isFinite(sent)) return 0;
  const today = melbourneYmd(nowMs);
  let day = melbourneYmd(sent);
  let n = 0;
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    day = addDays(day, 1);
    if (day > today) break;
    if (isWeekday(day)) n++;
  }
  return n;
}

/** The Melbourne date touch 2 comes due, or null for an unreadable timestamp. */
export function touch2DueOn(sentIso: string): string | null {
  const sent = Date.parse(sentIso);
  if (!Number.isFinite(sent)) return null;
  let day = melbourneYmd(sent);
  let n = 0;
  while (n < TOUCH2_BUSINESS_DAYS) {
    day = addDays(day, 1);
    if (isWeekday(day)) n++;
  }
  return day;
}

export function isTouch2Due(sentIso: string, nowMs: number): boolean {
  return businessDaysSince(sentIso, nowMs) >= TOUCH2_BUSINESS_DAYS;
}
