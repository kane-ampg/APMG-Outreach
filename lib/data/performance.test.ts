import { describe, expect, it } from "vitest";
import { chartBuckets, pctChange, sumSeries, toPerformance, toRange, TRADE_ORDER } from "./performance";

describe("toRange", () => {
  it("accepts only the ranges the tab offers", () => {
    expect(toRange("7")).toBe(7);
    expect(toRange(90)).toBe(90);
    expect(toRange("365")).toBe(28);
    expect(toRange(null)).toBe(28);
  });
});

describe("toPerformance", () => {
  it("lists every trade, clicked or not, most-clicked first", () => {
    const p = toPerformance({
      mode: "live",
      days: 7,
      dates: ["d1", "d2", "d3", "d4", "d5", "d6", "d7"],
      services: {
        plumbing: { daily: [0, 0, 0, 0, 0, 1, 2], previous: 1, enquiries: 1 },
        painting: { daily: [1, 0, 0, 0, 0, 0, 0] },
        general: { daily: [0, 0, 0, 0, 0, 0, 5] },
      },
    });

    expect(p.services.map((s) => s.service)).toHaveLength(TRADE_ORDER.length);
    expect(p.services[0]).toMatchObject({ service: "plumbing", total: 3, previous: 1, enquiries: 1 });
    expect(p.services[1]).toMatchObject({ service: "painting", total: 1 });
    // The enquiry form is counted, but not ranked as a trade.
    expect(p.services.some((s) => s.service === "general")).toBe(false);
    expect(p.general.total).toBe(5);
  });

  it("keeps a trade the portal added after this list was written", () => {
    const p = toPerformance({ days: 7, services: { roofing: { daily: [0, 0, 0, 0, 0, 0, 4] } } });
    expect(p.services[0]).toMatchObject({ service: "roofing", total: 4 });
  });

  it("recomputes totals from the days and drops junk", () => {
    const p = toPerformance({
      days: 7,
      interactions: { calls: { daily: [1, -3, "2", 2.9, null, 0, 1], total: 999, bySource: { direct: 2, bad: "x" } } },
    });
    expect(p.interactions.calls.daily).toEqual([1, 0, 0, 2, 0, 0, 1]);
    expect(p.interactions.calls.total).toBe(4);
    expect(p.interactions.calls.bySource).toEqual({ direct: 2 });
    expect(p.interactions.quotes.total).toBe(0);
    expect(p.mode).toBe("demo");
  });
});

describe("sumSeries", () => {
  it("adds day by day and channel by channel", () => {
    const a = { daily: [1, 2], total: 3, previous: 1, bySource: { direct: 3 } };
    const b = { daily: [0, 4], total: 4, previous: 2, bySource: { direct: 1, facebook: 3 } };
    expect(sumSeries([a, b], 2)).toEqual({ daily: [1, 6], total: 7, previous: 3, bySource: { direct: 4, facebook: 3 } });
  });
});

describe("pctChange", () => {
  it("is the change as a fraction, or null with nothing to compare to", () => {
    expect(pctChange(15, 10)).toBe(0.5);
    expect(pctChange(5, 10)).toBe(-0.5);
    expect(pctChange(5, 0)).toBeNull();
  });
});

describe("chartBuckets", () => {
  it("is a bar a day up to a month", () => {
    const dates = ["a", "b", "c"];
    expect(chartBuckets(dates, [1, 2, 3])).toEqual([
      { start: "a", end: "a", value: 1 },
      { start: "b", end: "b", value: 2 },
      { start: "c", end: "c", value: 3 },
    ]);
  });

  it("is a bar a week past that, with only the oldest week short", () => {
    const dates = Array.from({ length: 90 }, (_, i) => `d${i}`);
    const daily = Array.from({ length: 90 }, () => 1);
    const bars = chartBuckets(dates, daily);

    expect(bars).toHaveLength(13);
    expect(bars[0]).toEqual({ start: "d0", end: "d5", value: 6 });
    expect(bars[12]).toEqual({ start: "d83", end: "d89", value: 7 });
    expect(bars.reduce((n, b) => n + b.value, 0)).toBe(90);
  });
});
