import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakePostgrest, type Row } from "@/lib/portal/fakePostgrest";

/**
 * The numbers behind the Telemetry tab's "Export PDF" period report.
 *
 * Its breakdown reads asked for `limit=10000` and got PostgREST's 1000: on
 * 2026-09-26 September held 1,720 funnel events and 1,113 sends, and the week
 * of 21–27 Sep alone 1,105 events, so every recent report was short. Each
 * test here pins a count past that cap, plus the Facebook / Google section
 * the report now carries.
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

const FROM = "2026-09-01T00:00:00.000Z";
const TO = "2026-10-01T00:00:00.000Z";

function req(): Request {
  return new Request(`http://localhost/api/portal/report?from=${FROM}&to=${TO}`, {
    headers: { origin: "http://localhost", host: "localhost", "x-portal-admin-key": "secret" },
  });
}

let seq = 0;
/** One portal_events row inside September; created_at rises with every call. */
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
    created_at: new Date(Date.parse(FROM) + seq * 1000).toISOString(),
    ...extra,
  };
}

const lead = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

function serve(events: Row[], inquiries: Row[] = []) {
  const pg = fakePostgrest({ leads: [], portal_events: events, portal_inquiries: inquiries, email_suppression: [] });
  vi.stubGlobal("fetch", vi.fn(pg.handler));
}

async function report() {
  return (await GET(req())).json();
}

beforeEach(() => {
  seq = 0;
  vi.unstubAllGlobals();
  process.env.PORTAL_ADMIN_KEY = "secret";
});

describe("GET /api/portal/report — complete counts for the period", () => {
  it("counts every send and funnel event past PostgREST's 1000-row cap", async () => {
    serve([
      // August — outside the window, must not count
      { ...ev("portal_view", { visitor_id: "old" }), created_at: "2026-08-31T23:59:59.000Z" },
      ...Array.from({ length: 1100 }, (_, i) => ev("email_sent", { lead_id: lead(i), campaign: "vic-1" })),
      ...Array.from({ length: 1200 }, (_, i) => ev("attribution_click", { lead_id: lead(i % 900), campaign: "vic-1" })),
      ...Array.from({ length: 1500 }, (_, i) => ev("portal_view", { visitor_id: `v${i}` })),
    ]);

    const body = await report();

    expect(body.outreach.emailsSent).toBe(1100);
    expect(body.outreach.uniqueLeadsEmailed).toBe(1100);
    expect(body.outreach.campaigns).toContainEqual({ campaign: "vic-1", sent: 1100, clicks: 1200 });
    expect(body.engagement.emailClicks).toBe(1200);
    expect(body.engagement.uniqueLeadsClicked).toBe(900);
    expect(body.engagement.portalViews).toBe(1500);
  });

  it("lists every service opened, not a top few", async () => {
    const slugs = ["electrical", "painting", "plumbing", "carpentry", "flooring", "gardening", "handyman", "make-safe", "general"];
    serve(slugs.map((service) => ev("portal_service_open", { visitor_id: "a", props: { service } })));

    const body = await report();

    expect(body.engagement.serviceOpens).toBe(9);
    expect(body.engagement.topServices).toHaveLength(9);
  });
});

describe("GET /api/portal/report — Facebook & Google engagement", () => {
  it("breaks visitors, visits, service clicks and enquiries out per channel", async () => {
    serve(
      [
        ev("portal_view", { visitor_id: "fb1", props: { source: "facebook" } }),
        ev("portal_view", { visitor_id: "fb1", props: { source: "facebook" } }),
        ev("portal_view", { visitor_id: "fb2", props: { source: "facebook" } }),
        ev("portal_service_open", { visitor_id: "fb1", props: { source: "facebook", service: "painting" } }),
        ev("portal_service_open", { visitor_id: "fb2", props: { source: "facebook", service: "painting" } }),
        ev("portal_service_open", { visitor_id: "fb2", props: { source: "facebook", service: "general" } }),
        ev("portal_view", { visitor_id: "g1", props: { source: "google" } }),
        // other channels must not leak into either
        ev("portal_view", { visitor_id: "x", lead_id: lead(1) }),
        ev("portal_view", { visitor_id: "y" }),
      ],
      [
        { lead_id: null, source: "facebook", created_at: "2026-09-10T00:00:00.000Z" },
        { lead_id: lead(1), source: null, created_at: "2026-09-11T00:00:00.000Z" },
      ],
    );

    const body = await report();
    const channel = (s: string) => body.channels.find((c: { source: string }) => c.source === s);

    expect(channel("facebook")).toEqual({
      source: "facebook",
      visitors: 2,
      views: 3,
      serviceClicks: 3,
      inquiries: 1,
      services: [
        { service: "painting", opens: 2 },
        { service: "general", opens: 1 },
      ],
    });
    expect(channel("google")).toEqual({
      source: "google",
      visitors: 1,
      views: 1,
      serviceClicks: 0,
      inquiries: 0,
      services: [],
    });
    expect(channel("outreach")).toMatchObject({ views: 1, inquiries: 1 });
    expect(channel("direct")).toMatchObject({ views: 1, inquiries: 0 });
  });
});

describe("GET /api/portal/report — storage not there yet", () => {
  it("answers demo with needsMigration when the portal tables are missing", async () => {
    vi.stubGlobal("fetch", vi.fn(fakePostgrest({ leads: [] }).handler));

    expect(await report()).toMatchObject({ ok: true, mode: "demo", needsMigration: true });
  });
});
