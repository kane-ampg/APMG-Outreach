import { describe, expect, it } from "vitest";
import { parseStamps, volumeSeries, volumeSeriesFromDayCounts, type DayCount } from "./buckets";

/**
 * The KPI histogram moved from "fold every lead row in the browser" to "read
 * day-grain counts the database already grouped" — the change that stopped the
 * console pulling the whole leads table every 15 seconds.
 *
 * Both paths must produce the SAME bars, because the aggregate path is only
 * legitimate if it's the same operation on the same boundaries. The pinned
 * guarantee is that day → week/month rollup happens on LOCAL calendar days: the
 * database cut each day at local midnight in the viewer's zone, so a browser that
 * re-parsed "2026-07-15" as UTC would relabel days (and slip week/month buckets)
 * in every negative-offset zone.
 */

/** A local-midnight Date, the way the histogram thinks about a calendar day. */
const day = (y: number, m: number, d: number, hour = 12) => new Date(y, m - 1, d, hour);

describe("volumeSeriesFromDayCounts", () => {
  it("matches the row-folding path bar for bar", () => {
    // Three leads on 15 Jul, one on 16 Jul, two on 17 Jul.
    const rows = [
      day(2026, 7, 15, 1),
      day(2026, 7, 15, 9),
      day(2026, 7, 15, 23),
      day(2026, 7, 16, 6),
      day(2026, 7, 17, 8),
      day(2026, 7, 17, 20),
    ];
    const counts: DayCount[] = [
      { d: "2026-07-15", n: 3 },
      { d: "2026-07-16", n: 1 },
      { d: "2026-07-17", n: 2 },
    ];

    expect(volumeSeriesFromDayCounts(counts)).toEqual(volumeSeries(rows));
  });

  it("keeps each day on its own local calendar date", () => {
    const { byDay } = volumeSeriesFromDayCounts([{ d: "2026-07-15", n: 4 }]);
    expect(byDay).toHaveLength(1);
    // Label comes from a local-midnight Date; parsing the string as UTC would
    // render "Jul 14" anywhere west of Greenwich.
    expect(byDay[0]).toEqual({ label: day(2026, 7, 15).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }), value: 4, current: true });
  });

  it("rolls days up into Monday-anchored weeks", () => {
    // 2026-07-13 is a Monday; the 19th is the Sunday that closes that week, and
    // the 20th opens the next one.
    const series = volumeSeriesFromDayCounts([
      { d: "2026-07-13", n: 1 },
      { d: "2026-07-16", n: 2 },
      { d: "2026-07-19", n: 3 },
      { d: "2026-07-20", n: 4 },
    ]);
    expect(series.byWeek.map((b) => b.value)).toEqual([6, 4]);
    expect(series.byWeek.at(-1)?.current).toBe(true);
  });

  it("rolls days up into calendar months", () => {
    const series = volumeSeriesFromDayCounts([
      { d: "2026-06-30", n: 5 },
      { d: "2026-07-01", n: 7 },
      { d: "2026-07-31", n: 2 },
    ]);
    expect(series.byMonth.map((b) => b.value)).toEqual([5, 9]);
  });

  it("orders bars oldest → newest however the counts arrive", () => {
    const series = volumeSeriesFromDayCounts([
      { d: "2026-07-17", n: 2 },
      { d: "2026-07-15", n: 3 },
      { d: "2026-07-16", n: 1 },
    ]);
    expect(series.byDay.map((b) => b.value)).toEqual([3, 1, 2]);
    expect(series.byDay.filter((b) => b.current)).toHaveLength(1);
  });

  it("caps at the last 14 days", () => {
    const counts: DayCount[] = Array.from({ length: 20 }, (_, i) => ({
      d: `2026-07-${String(i + 1).padStart(2, "0")}`,
      n: i + 1,
    }));
    const { byDay } = volumeSeriesFromDayCounts(counts);
    expect(byDay).toHaveLength(14);
    // The tail, not the head: bars 7..20 by value.
    expect(byDay[0].value).toBe(7);
    expect(byDay.at(-1)?.value).toBe(20);
  });

  it("drops unusable rows instead of poisoning the series", () => {
    const { byDay } = volumeSeriesFromDayCounts([
      { d: "2026-07-15", n: 3 },
      { d: "15/07/2026", n: 99 }, // wrong format
      { d: "not-a-date", n: 99 },
      { d: "2026-07-16", n: 0 }, // a day with nothing in it isn't a bar
      { d: "2026-07-17", n: Number.NaN },
    ]);
    expect(byDay.map((b) => b.value)).toEqual([3]);
  });

  it("returns empty series for no data", () => {
    expect(volumeSeriesFromDayCounts([])).toEqual({ byDay: [], byWeek: [], byMonth: [] });
  });
});

describe("volumeSeries (row path, still used for hand-off stamps)", () => {
  it("ignores absent and unparseable stamps", () => {
    const dates = parseStamps([
      day(2026, 7, 15).toISOString(),
      null,
      undefined,
      "",
      "definitely not a date",
    ]);
    expect(dates).toHaveLength(1);
    expect(volumeSeries(dates).byDay.map((b) => b.value)).toEqual([1]);
  });
});
