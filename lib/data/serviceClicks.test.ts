import { describe, expect, it } from "vitest";
import { toServiceClicks } from "./serviceClicks";

const TRADES = ["electrical", "painting", "plumbing", "carpentry", "flooring", "gardening", "handyman", "make-safe"];

describe("toServiceClicks", () => {
  it("lists all eight trades even before anyone has clicked one", () => {
    const out = toServiceClicks([]);

    expect(out.trades.map((t) => t.service)).toEqual(TRADES);
    expect(out.trades.every((t) => t.opens === 0)).toBe(true);
    expect(out.general).toMatchObject({ service: "general", opens: 0 });
    expect(out.total).toBe(0);
  });

  it("ranks trades by clicks, with ties kept in the portal's own order", () => {
    const out = toServiceClicks([
      { service: "flooring", opens: 1, inquiries: 0 },
      { service: "make-safe", opens: 6, inquiries: 0 },
      { service: "electrical", opens: 8, inquiries: 0 },
      { service: "plumbing", opens: 1, inquiries: 0 },
    ]);

    expect(out.trades.map((t) => [t.service, t.opens])).toEqual([
      ["electrical", 8],
      ["make-safe", 6],
      ["plumbing", 1],
      ["flooring", 1],
      ["painting", 0],
      ["carpentry", 0],
      ["gardening", 0],
      ["handyman", 0],
    ]);
  });

  it("counts the quote buttons in the total but keeps them out of the trade ranking", () => {
    const out = toServiceClicks([
      { service: "general", opens: 69, inquiries: 0 },
      { service: "painting", opens: 3, inquiries: 0 },
    ]);

    expect(out.trades.some((t) => t.service === "general")).toBe(false);
    expect(out.general.opens).toBe(69);
    expect(out.total).toBe(72);
  });

  it("keeps a service the portal doesn't list yet, rather than dropping its clicks", () => {
    const out = toServiceClicks([{ service: "roofing", opens: 2, inquiries: 0 }]);

    expect(out.trades[0]).toMatchObject({ service: "roofing", opens: 2 });
    expect(out.trades).toHaveLength(9);
  });

  it("splits each row by channel, biggest share first", () => {
    const out = toServiceClicks([
      { service: "painting", opens: 4, inquiries: 1, opensBySource: { direct: 1, outreach: 2, facebook: 1 } },
    ]);

    expect(out.trades[0]).toEqual({
      service: "painting",
      opens: 4,
      inquiries: 1,
      bySource: [
        { source: "outreach", opens: 2 },
        { source: "direct", opens: 1 },
        { source: "facebook", opens: 1 },
      ],
    });
  });

  it("survives a malformed payload", () => {
    const out = toServiceClicks([null, 7, { service: "" }, { service: "painting", opens: "3", opensBySource: [1] }]);

    expect(out.trades.find((t) => t.service === "painting")).toMatchObject({ opens: 0, bySource: [] });
    expect(out.total).toBe(0);
    expect(toServiceClicks(undefined).trades).toHaveLength(8);
  });
});
