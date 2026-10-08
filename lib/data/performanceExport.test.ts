import { describe, expect, it } from "vitest";
import { toPerformance } from "./performance";
import { changeText, performanceCsv, performanceCsvFilename } from "./performanceExport";

const PORTAL = "https://customer.apmgservices.com.au/portal";
const NOW = new Date("2026-10-08T02:00:00Z");
const DATES = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];

function data(extra: Record<string, unknown> = {}) {
  return toPerformance({
    mode: "live",
    days: 7,
    tz: "Australia/Melbourne",
    dates: DATES,
    computedAt: "2026-10-08T01:58:00Z",
    interactions: {
      calls: { daily: [0, 0, 0, 0, 0, 1, 2], previous: 2, bySource: { direct: 3 } },
      services: { daily: [0, 0, 0, 0, 1, 0, 3], previous: 2, bySource: { outreach: 3, facebook: 1 } },
    },
    services: {
      plumbing: { daily: [0, 0, 0, 0, 1, 0, 2], previous: 2, enquiries: 1, bySource: { outreach: 3 } },
      painting: { daily: [0, 0, 0, 0, 0, 0, 1], bySource: { facebook: 1 } },
      general: { daily: [0, 0, 0, 0, 0, 0, 4] },
    },
    visits: { daily: [1, 1, 1, 1, 1, 1, 4], previous: 5, bySource: { outreach: 6, facebook: 4 } },
    visitors: 8,
    scannerEventsExcluded: 12,
    ...extra,
  });
}

const lines = (csv: string) => csv.split("\r\n");

describe("performanceCsv", () => {
  it("names the customer portal page and the period at the top", () => {
    const out = lines(performanceCsv(data(), { portalUrl: PORTAL, generatedAt: NOW }));

    expect(out[0]).toBe("APMG Services: customer portal performance");
    expect(out[1]).toBe(`Customer portal,${PORTAL}`);
    expect(out[2]).toBe("Period,Last 7 days: 2 Oct 2026 to 8 Oct 2026");
    expect(out[3]).toBe("Compared with,Previous 7 days: 25 Sept 2026 to 1 Oct 2026");
    expect(out).toContain("Days counted in,Australia/Melbourne");
    expect(out.some((l) => l.startsWith("Note,\"12 events from email scanners"))).toBe(true);
  });

  it("summarises the period against the one before", () => {
    const out = lines(performanceCsv(data(), { portalUrl: PORTAL, generatedAt: NOW }));

    expect(out).toContain("Portal interactions,7,4,Up 75%");
    expect(out).toContain("Visits,10,5,Up 100%");
    expect(out).toContain("Unique visitors,8,,");
  });

  it("lists every trade with its clicks, and the enquiry form apart", () => {
    const out = lines(performanceCsv(data(), { portalUrl: PORTAL, generatedAt: NOW }));

    expect(out).toContain("Plumbing Services,3,2,Up 50%,75%,1,Outreach email 3");
    expect(out).toContain("Painting Services,1,0,New,25%,0,Facebook 1");
    expect(out).toContain("Carpentry & Joinery,0,0,,0%,0,");
    expect(out).toContain("Enquiry form (opened with no trade picked),4,0,New,,0,");
  });

  it("ends with one row per day", () => {
    const out = lines(performanceCsv(data(), { portalUrl: PORTAL, generatedAt: NOW }));
    const start = out.indexOf("Day by day");

    expect(out[start + 1].startsWith("Date,Visits,All interactions,Service clicks,")).toBe(true);
    expect(out.slice(start + 2)).toHaveLength(7);
    expect(out.at(-1)!.startsWith("2026-10-08,4,5,3,0,2,")).toBe(true);
  });

  it("can't be made to run a formula in Excel", () => {
    const csv = performanceCsv(
      data({
        services: { "=HYPERLINK(\"http://evil\",\"x\")": { daily: [0, 0, 0, 0, 0, 0, 1] } },
        visits: { daily: [0, 0, 0, 0, 0, 0, 1], bySource: { "+cmd": 1, "@sum": 1 } },
      }),
      { portalUrl: PORTAL, generatedAt: NOW },
    );

    for (const cell of csv.split(/[\r\n,]+/)) {
      expect(cell.replace(/^"/, "")).not.toMatch(/^[=+\-@]/);
    }
  });
});

describe("changeText", () => {
  it("says which way and by how much, in words", () => {
    expect(changeText(15, 10)).toBe("Up 50%");
    expect(changeText(0, 4)).toBe("Down 100%");
    expect(changeText(10, 10)).toBe("No change");
    expect(changeText(3, 0)).toBe("New");
    expect(changeText(0, 0)).toBe("");
  });
});

describe("performanceCsvFilename", () => {
  it("says what it is, which period, and when", () => {
    expect(performanceCsvFilename(data(), new Date(2026, 9, 8))).toBe("apmg-portal-performance-7-days-20261008.csv");
  });
});
