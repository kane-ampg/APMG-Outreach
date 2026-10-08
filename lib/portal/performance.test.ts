import { describe, expect, it } from "vitest";
import { localDay, periodDays, safePerformanceZone, tallyPerformance, type PerfEventRow } from "./performance";

/**
 * The Performance tab's tally: portal clicks by day, by kind and by service,
 * against the period before. A day is a calendar day in the reader's zone,
 * not a UTC day — an evening click in Melbourne is already tomorrow in UTC.
 */

const TZ = "Australia/Melbourne";
// 13:00 on Thursday 8 October 2026 in Melbourne (AEDT, UTC+11 since 4 Oct).
const NOW = new Date("2026-10-08T02:00:00Z");

/** A real Chrome on Windows 10/11 — reduced UA, nothing forged about it. */
const HUMAN_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
/** A mail-gateway sandbox: desktop Chrome with an unreduced build number. */
const SCANNER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.175 Safari/537.36";

function ev(event: string, createdAt: string, extra: Partial<PerfEventRow> = {}): PerfEventRow {
  return {
    event,
    created_at: createdAt,
    lead_id: null,
    visitor_id: null,
    service: null,
    source: null,
    ua: HUMAN_UA,
    ...extra,
  };
}

function tally(events: PerfEventRow[], inquiries: Parameters<typeof tallyPerformance>[0]["inquiries"] = []) {
  return tallyPerformance({ events, inquiries, days: 7, tz: TZ, now: NOW });
}

describe("periodDays", () => {
  it("ends on today in the zone and runs back the full span, then the span before", () => {
    const { current, previous } = periodDays(7, TZ, NOW);
    expect(current).toEqual([
      "2026-10-02",
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
      "2026-10-07",
      "2026-10-08",
    ]);
    expect(previous[0]).toBe("2026-09-25");
    expect(previous[6]).toBe("2026-10-01");
  });

  it("doesn't drop or repeat a day across the daylight-saving change", () => {
    // Melbourne moved its clocks forward on 4 October 2026.
    const { current } = periodDays(28, TZ, NOW);
    expect(new Set(current).size).toBe(28);
    expect(current).toContain("2026-10-04");
  });
});

describe("localDay", () => {
  it("cuts days at midnight in the zone, not in UTC", () => {
    expect(localDay("2026-10-07T14:30:00Z", TZ)).toBe("2026-10-08");
    expect(localDay("2026-10-07T12:30:00Z", TZ)).toBe("2026-10-07");
  });

  it("is null for a missing or unreadable timestamp", () => {
    expect(localDay(null, TZ)).toBeNull();
    expect(localDay("not a date", TZ)).toBeNull();
  });
});

describe("safePerformanceZone", () => {
  it("keeps a real zone and falls back to Melbourne for anything else", () => {
    expect(safePerformanceZone("Australia/Brisbane")).toBe("Australia/Brisbane");
    expect(safePerformanceZone("Mars/Olympus_Mons")).toBe(TZ);
    expect(safePerformanceZone("x'); drop table")).toBe(TZ);
    expect(safePerformanceZone(null)).toBe(TZ);
  });
});

describe("tallyPerformance", () => {
  it("puts each click on its local day, and earlier clicks into the previous period", () => {
    const t = tally([
      ev("portal_phone_click", "2026-10-07T14:30:00Z"), // 8 Oct in Melbourne
      ev("portal_phone_click", "2026-10-02T01:00:00Z"), // 2 Oct, first day
      ev("portal_phone_click", "2026-09-28T01:00:00Z"), // previous period
      ev("portal_phone_click", "2026-09-01T01:00:00Z"), // before both: ignored
    ]);

    expect(t.dates[6]).toBe("2026-10-08");
    expect(t.interactions.calls.daily).toEqual([1, 0, 0, 0, 0, 0, 1]);
    expect(t.interactions.calls.total).toBe(2);
    expect(t.interactions.calls.previous).toBe(1);
  });

  it("counts clicks per service, and keeps the enquiry form out of service clicks", () => {
    const day = "2026-10-06T01:00:00Z";
    const t = tally([
      ev("portal_service_open", day, { service: "plumbing" }),
      ev("portal_service_open", day, { service: "plumbing" }),
      ev("portal_service_open", day, { service: "electrical" }),
      ev("portal_service_open", day, { service: "general" }),
      ev("portal_service_open", day, { service: null }),
    ]);

    expect(t.services.plumbing.total).toBe(2);
    expect(t.services.electrical.total).toBe(1);
    expect(t.services.general.total).toBe(1);
    expect(t.interactions.services.total).toBe(3);
  });

  it("files every portal link under its interaction", () => {
    const day = "2026-10-06T01:00:00Z";
    const t = tally([
      ev("portal_quote_click", day),
      ev("portal_chat_open", day),
      ev("portal_website_click", day),
      ev("portal_main_website_click", day),
      ev("portal_email_click", day),
      ev("portal_whatsapp_click", day),
      ev("portal_google_reviews_click", day),
      ev("portal_reviews_next", day), // a carousel arrow, not an interaction
    ]);

    expect(t.interactions.quotes.total).toBe(1);
    expect(t.interactions.chats.total).toBe(1);
    expect(t.interactions.website.total).toBe(2);
    expect(t.interactions.email.total).toBe(1);
    expect(t.interactions.whatsapp.total).toBe(1);
    expect(t.interactions.reviews.total).toBe(1);
  });

  it("leaves out mail-scanner browsers, and says how many", () => {
    const day = "2026-10-06T01:00:00Z";
    const t = tally([
      ev("portal_service_open", day, { service: "painting", ua: SCANNER_UA }),
      ev("portal_view", day, { visitor_id: "bot", ua: SCANNER_UA }),
      ev("portal_service_open", day, { service: "painting" }),
      ev("portal_service_open", "2026-09-28T01:00:00Z", { service: "painting", ua: SCANNER_UA }),
    ]);

    expect(t.services.painting.total).toBe(1);
    expect(t.services.painting.previous).toBe(0);
    expect(t.visits.total).toBe(0);
    // Only this period's are reported — that's the period on screen.
    expect(t.scannerEventsExcluded).toBe(2);
  });

  it("splits clicks by the channel the visitor came through", () => {
    const day = "2026-10-06T01:00:00Z";
    const t = tally([
      ev("portal_service_open", day, { service: "painting", lead_id: "lead-1" }),
      ev("portal_service_open", day, { service: "painting", source: "facebook" }),
      ev("portal_service_open", day, { service: "painting", source: "facebook", lead_id: "lead-2" }),
      ev("portal_service_open", day, { service: "painting" }),
    ]);

    expect(t.services.painting.bySource).toEqual({ outreach: 1, facebook: 2, direct: 1 });
  });

  it("counts visits and distinct visitors", () => {
    const day = "2026-10-06T01:00:00Z";
    const t = tally([
      ev("portal_view", day, { visitor_id: "a" }),
      ev("portal_view", day, { visitor_id: "a" }),
      ev("portal_view", day, { visitor_id: "b" }),
      ev("portal_view", "2026-09-28T01:00:00Z", { visitor_id: "c" }),
    ]);

    expect(t.visits.total).toBe(3);
    expect(t.visits.previous).toBe(1);
    expect(t.visitors).toBe(2);
  });

  it("counts enquiries from the enquiry table, per service", () => {
    const t = tally(
      [],
      [
        { service_slug: "plumbing", lead_id: null, source: "google", created_at: "2026-10-06T01:00:00Z" },
        { service_slug: null, lead_id: "lead-1", created_at: "2026-10-07T01:00:00Z" },
        { service_slug: "plumbing", lead_id: null, created_at: "2026-09-27T01:00:00Z" },
      ],
    );

    expect(t.interactions.enquiries.total).toBe(2);
    expect(t.interactions.enquiries.previous).toBe(1);
    expect(t.interactions.enquiries.bySource).toEqual({ google: 1, outreach: 1 });
    expect(t.services.plumbing.enquiries).toBe(1);
    expect(t.services.general.enquiries).toBe(1);
  });
});
