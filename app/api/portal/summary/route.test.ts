import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakePostgrest, type Row } from "@/lib/portal/fakePostgrest";

/**
 * The funnel totals behind the Telemetry KPI row and the Enquiries tab's
 * by-source list — including the "direct" (anonymous) and "facebook" buckets.
 *
 * These used to be tallied over "the newest 2000 portal_events rows". PostgREST
 * caps a response at 1000, and that window counted every row in the table —
 * the send ledger, chat pings, dashboard clicks — so a single outreach send
 * pushed a week of visits out of it. On 2026-09-26 the window reached back
 * 3.3 days: it showed 9 of 160 anonymous portal views and 3 of 33 Facebook
 * visitors. Every test here pins a count past that cap.
 */

vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return {
    ...actual,
    supabaseTarget: () => ({ state: "ok", base: "https://db.test", key: "k" }),
    requireLiveSupabase: () => null,
  };
});

import { GET } from "./route";

const LEAD = "11111111-1111-4111-8111-111111111111";

function req(): Request {
  return new Request("http://localhost/api/portal/summary", {
    headers: { origin: "http://localhost", host: "localhost" },
  });
}

let seq = 0;

/** One portal_events row. created_at rises with every call, so a fixture
 *  built top to bottom reads oldest-first. */
function ev(event: string, extra: Row = {}): Row {
  seq += 1;
  return {
    id: `e${String(seq).padStart(6, "0")}`,
    event,
    props: {},
    view: null,
    lead_id: null,
    campaign: null,
    category: null,
    visitor_id: null,
    created_at: new Date(Date.UTC(2026, 6, 1) + seq * 1000).toISOString(),
    ...extra,
  };
}

function serve(tables: Record<string, Row[]>) {
  const pg = fakePostgrest(tables);
  vi.stubGlobal("fetch", vi.fn(pg.handler));
  return pg;
}

async function summary() {
  return (await GET(req())).json();
}

beforeEach(() => {
  seq = 0;
  vi.unstubAllGlobals();
});

describe("GET /api/portal/summary — counts past PostgREST's 1000-row cap", () => {
  it("counts every anonymous portal view, however much newer traffic sits on top", async () => {
    const views = Array.from({ length: 1500 }, (_, i) => ev("portal_view", { visitor_id: `v${i}` }));
    // One send's ledger, every row newer than every visit — "the newest N rows"
    // saw none of the visits at all.
    const sends = Array.from({ length: 1200 }, () => ev("email_sent", { lead_id: LEAD }));
    serve({ portal_events: [...views, ...sends], portal_inquiries: [] });

    const body = await summary();

    expect(body.totals.portalViews).toBe(1500);
    expect(body.totals.uniqueVisitors).toBe(1500);
    expect(body.bySource).toContainEqual({ source: "direct", visitors: 1500, views: 1500, inquiries: 0 });
  });

  it("keeps Facebook visitors that scanner clicks would have pushed out of the window", async () => {
    const fb = Array.from({ length: 40 }, (_, i) =>
      ev("portal_view", { visitor_id: `fb${i % 20}`, props: { source: "facebook" } }),
    );
    const clicks = Array.from({ length: 1100 }, () =>
      ev("attribution_click", { lead_id: LEAD, category: "Childcare" }),
    );
    serve({ portal_events: [...fb, ...clicks], portal_inquiries: [] });

    const body = await summary();

    expect(body.bySource).toContainEqual({ source: "facebook", visitors: 20, views: 40, inquiries: 0 });
    expect(body.totals.attributionClicks).toBe(1100);
    expect(body.byCategory).toContainEqual({ category: "Childcare", clicks: 1100, views: 0, inquiries: 0 });
  });

  it("counts service opens past the cap, per service", async () => {
    const opens = Array.from({ length: 1001 }, (_, i) =>
      ev("portal_service_open", { view: "portal", props: { service: i % 2 ? "plumbing" : "painting" } }),
    );
    serve({ portal_events: opens, portal_inquiries: [] });

    const body = await summary();

    expect(body.totals.serviceOpens).toBe(1001);
    expect(body.byService).toContainEqual(expect.objectContaining({ service: "painting", opens: 501 }));
    expect(body.byService).toContainEqual(expect.objectContaining({ service: "plumbing", opens: 500 }));
  });

  it("splits each service's clicks by the channel the visitor came through", async () => {
    serve({
      portal_events: [
        ev("portal_service_open", { lead_id: LEAD, props: { service: "painting" } }),
        ev("portal_service_open", { lead_id: LEAD, props: { service: "painting" } }),
        ev("portal_service_open", { visitor_id: "fb", props: { service: "painting", source: "facebook" } }),
        ev("portal_service_open", { visitor_id: "anon", props: { service: "painting" } }),
        ev("portal_service_open", { visitor_id: "anon", props: { service: "flooring" } }),
      ],
      portal_inquiries: [],
    });

    const body = await summary();

    expect(body.byService).toContainEqual({
      service: "painting",
      opens: 4,
      inquiries: 0,
      opensBySource: { outreach: 2, facebook: 1, direct: 1 },
    });
    expect(body.byService).toContainEqual({
      service: "flooring",
      opens: 1,
      inquiries: 0,
      opensBySource: { direct: 1 },
    });
  });

  it("files an outreach visitor's view under outreach, not direct", async () => {
    serve({
      portal_events: [ev("portal_view", { visitor_id: "a", lead_id: LEAD }), ev("portal_view", { visitor_id: "b" })],
      portal_inquiries: [],
    });

    const body = await summary();

    expect(body.bySource).toContainEqual({ source: "outreach", visitors: 1, views: 1, inquiries: 0 });
    expect(body.bySource).toContainEqual({ source: "direct", visitors: 1, views: 1, inquiries: 0 });
  });
});

describe("GET /api/portal/summary — the Leads engaged card", () => {
  // The card used to count the Telemetry table's rows, which the lead-activity
  // route caps at the newest 100 — so it read 100 for weeks while 1,238 leads
  // had clicked (2026-09-26).
  it("counts every lead that ever clicked, once each, past the row cap", async () => {
    const leads = Array.from({ length: 1200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    serve({
      portal_events: [
        ...leads.map((lead_id) => ev("attribution_click", { lead_id })),
        ev("attribution_click", { lead_id: leads[0] }), // a second click is still one lead
      ],
      portal_inquiries: [
        { lead_id: leads[5], created_at: "2026-09-01T00:00:00Z", service_slug: "painting" },
        { lead_id: leads[5], created_at: "2026-09-02T00:00:00Z", service_slug: "painting" },
        { lead_id: null, created_at: "2026-09-03T00:00:00Z", service_slug: "general" },
      ],
    });

    const body = await summary();

    expect(body.totals.attributionClicks).toBe(1201);
    expect(body.totals.engagedLeads).toBe(1200);
    // one lead enquired twice: one lead went on to enquire, two enquiries tracked
    expect(body.totals.enquiredLeads).toBe(1);
    expect(body.totals.attributedInquiries).toBe(2);
    expect(body.totals.inquiries).toBe(3);
  });
});

describe("GET /api/portal/summary — the recent feed", () => {
  it("is the newest 30 funnel events, newest first, with the send ledger left out", async () => {
    const older = Array.from({ length: 50 }, (_, i) => ev("portal_view", { visitor_id: `v${i}` }));
    const newest = ev("portal_service_open", { view: "portal", props: { service: "plumbing", source: "facebook" } });
    const noise = ev("email_sent", { lead_id: LEAD });
    serve({ portal_events: [...older, newest, noise], portal_inquiries: [] });

    const body = await summary();

    expect(body.recentEvents).toHaveLength(30);
    expect(body.recentEvents[0]).toMatchObject({ event: "portal_service_open", service: "plumbing", source: "facebook" });
    expect(body.recentEvents.every((e: { event: string }) => e.event !== "email_sent")).toBe(true);
  });
});

describe("GET /api/portal/summary — storage not there yet", () => {
  it("answers demo with needsMigration when the portal tables are missing", async () => {
    serve({});

    const body = await summary();

    expect(body).toMatchObject({ ok: true, mode: "demo", needsMigration: true });
  });
});
