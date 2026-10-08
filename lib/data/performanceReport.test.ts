import { describe, expect, it } from "vitest";
import { chartBuckets, toPerformance } from "./performance";
import { chartSvg, performanceReportHtml, performanceReportTitle } from "./performanceReport";

const PORTAL = "https://customer.apmgservices.com.au/portal";
const HREF = "https://customer.apmgservices.com.au/api/portal/staff?next=portal";
const NOW = new Date("2026-10-08T04:41:00Z");
const DATES = ["2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08"];

function data(extra: Record<string, unknown> = {}) {
  return toPerformance({
    mode: "live",
    days: 7,
    tz: "Australia/Melbourne",
    dates: DATES,
    interactions: {
      calls: { daily: [0, 0, 0, 0, 0, 1, 2], previous: 2, bySource: { direct: 3 } },
      services: { daily: [0, 0, 0, 0, 1, 0, 3], previous: 2, bySource: { outreach: 3, facebook: 1 } },
    },
    services: {
      plumbing: { daily: [0, 0, 0, 0, 1, 0, 2], previous: 2, enquiries: 1 },
      painting: { daily: [0, 0, 0, 0, 0, 0, 1] },
      general: { daily: [0, 0, 0, 0, 0, 0, 4] },
    },
    visits: { daily: [1, 1, 1, 1, 1, 1, 4], previous: 5, bySource: { outreach: 6, facebook: 4 } },
    visitors: 8,
    scannerEventsExcluded: 12,
    ...extra,
  });
}

const html = (d = data()) => performanceReportHtml(d, { portalUrl: PORTAL, portalHref: HREF, generatedAt: NOW });

describe("performanceReportHtml", () => {
  it("names the customer portal, linked through the staff marker", () => {
    const out = html();

    expect(out).toContain(`<a href="${HREF.replace("&", "&amp;")}">customer.apmgservices.com.au/portal</a>`);
    expect(out).toContain("Customer portal performance, last 7 days");
    expect(out).toContain("2 Oct 2026 to 8 Oct 2026");
    expect(out).toContain("Compared with 25 Sept 2026 to 1 Oct 2026");
  });

  it("gives the headline figures with their change", () => {
    const out = html();

    expect(out).toMatch(/Portal interactions<\/div><div class="v num">7<\/div>.*Up 75%/s);
    expect(out).toMatch(/Visits<\/div><div class="v num">10<\/div>.*Up 100%/s);
    expect(out).toContain("12 events from email scanners");
  });

  it("lists every trade, the unclicked ones too, and the enquiry form apart", () => {
    const out = html();

    for (const name of ["Plumbing Services", "Painting Services", "Carpentry &amp; Joinery", "Handyman Services"]) {
      expect(out).toContain(`<td>${name}</td>`);
    }
    expect(out).toContain('<tr class="sep">');
    expect(out).toContain("Enquiry form");
  });

  it("escapes anything a visitor's browser could have named", () => {
    const out = html(
      data({
        services: { "<img src=x onerror=alert(1)>": { daily: [0, 0, 0, 0, 0, 0, 1] } },
        visits: { daily: [0, 0, 0, 0, 0, 0, 1], bySource: { "evil.example\"><script>alert(1)</script>": 1 } },
      }),
    );

    expect(out).not.toContain("<img src=x");
    expect(out).not.toContain("<script>alert(1)</script>");
    // the only script is the print trigger
    expect(out.match(/<script>/g)).toHaveLength(1);
  });

  it("opens the print dialog once it has loaded", () => {
    expect(html()).toContain("window.print()");
  });

  it("says so when the console wasn't connected", () => {
    expect(html(data({ mode: "demo" }))).toContain("every figure is zero");
  });
});

describe("chartSvg", () => {
  it("draws one bar per day up to a month", () => {
    const d = data();
    const svg = chartSvg(chartBuckets(d.dates, d.visits.daily), "Visits");

    expect(svg.match(/<rect /g)).toHaveLength(7);
    expect(svg).toContain("peak 4");
    expect(svg).toContain(">8 Oct</text>");
  });

  it("draws a bar a week for longer periods", () => {
    const dates = Array.from({ length: 90 }, (_, i) => new Date(Date.UTC(2026, 6, 11 + i)).toISOString().slice(0, 10));
    const svg = chartSvg(chartBuckets(dates, dates.map(() => 1)), "Visits");

    expect(svg.match(/<rect /g)).toHaveLength(13);
    expect(svg).toContain("peak 7");
  });
});

describe("performanceReportTitle", () => {
  it("becomes a readable PDF file name", () => {
    expect(performanceReportTitle(data())).toBe("APMG customer portal performance - last 7 days to 8 Oct 2026");
  });
});
