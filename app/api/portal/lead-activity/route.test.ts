import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakePostgrest, type Row } from "@/lib/portal/fakePostgrest";

/**
 * The opt-out half of the Telemetry payload.
 *
 * `email_suppression` is the list the send route filters against — the people
 * who asked us to stop. It ships alongside the click trails so the tab can
 * count and name them, but it carries a trap the click trails don't: its
 * migration (supabase/unsubscribe.sql) is SEPARATE from the portal tables. A
 * console that has never run it must not read as "nobody has unsubscribed",
 * and must not lose the rest of the page either. That distinction —
 * `unsubscribesAvailable` — is what most of this file pins.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return {
    ...actual,
    supabaseTarget: () => ({ state: "ok", base: "https://db.test", key: "k" }),
    requireLiveSupabase: () => null,
  };
});

import { GET } from "./route";

const LEAD_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_LEAD = "22222222-2222-4222-8222-222222222222";

function req(): Request {
  return new Request("http://localhost/api/portal/lead-activity", {
    headers: {
      origin: "http://localhost",
      host: "localhost",
      "x-portal-admin-key": "secret",
    },
  });
}

/** Every URL the handler asked Supabase for, in call order. */
let calls: string[] = [];

type Suppression = { rows: unknown[]; total: number } | "missing" | "error";

/**
 * Stands in for PostgREST. The two portal_events windows always answer empty
 * (the trails have their own coverage) so each test speaks only about the
 * suppression list and the leads lookups it triggers.
 */
function stubSupabase(opts: { suppression: Suppression; leads?: unknown[] }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);

      if (url.includes("email_suppression")) {
        if (opts.suppression === "missing") {
          return new Response(JSON.stringify({ code: "PGRST205", message: "Could not find the table" }), {
            status: 404,
          });
        }
        if (opts.suppression === "error") {
          return new Response("boom", { status: 500 });
        }
        return new Response(JSON.stringify(opts.suppression.rows), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "content-range": `0-${Math.max(opts.suppression.rows.length - 1, 0)}/${opts.suppression.total}`,
          },
        });
      }
      if (url.includes("/leads?")) return Response.json(opts.leads ?? []);
      return Response.json([]); // both portal_events windows
    }),
  );
}

beforeEach(() => {
  calls = [];
  vi.restoreAllMocks();
  process.env.PORTAL_ADMIN_KEY = "secret";
});

describe("GET /api/portal/lead-activity — the opt-out list", () => {
  it("names the person behind an opt-out through the lead the link carried", async () => {
    stubSupabase({
      suppression: {
        rows: [
          {
            email: "maidengully@jennyselc.com.au",
            lead_id: LEAD_ID,
            campaign: "vic-childcare-1",
            reason: "unsubscribe",
            created_at: "2026-08-25T03:00:00Z",
          },
        ],
        total: 1,
      },
      leads: [{ id: LEAD_ID, name: "Jenny's ELC", category: "Childcare" }],
    });

    const body = await (await GET(req())).json();

    expect(body.unsubscribesAvailable).toBe(true);
    expect(body.unsubscribes).toEqual([
      {
        email: "maidengully@jennyselc.com.au",
        business: "Jenny's ELC",
        category: "Childcare",
        leadId: LEAD_ID,
        campaign: "vic-childcare-1",
        reason: "unsubscribe",
        createdAt: "2026-08-25T03:00:00Z",
      },
    ]);
  });

  it("keeps a bare-address opt-out, unnamed rather than dropped", async () => {
    stubSupabase({
      suppression: {
        rows: [
          { email: "someone@example.com", lead_id: null, campaign: null, reason: "unsubscribe", created_at: "2026-08-25T03:00:00Z" },
          // No address = no person to show; the row is the address.
          { email: null, lead_id: LEAD_ID, created_at: "2026-08-25T03:00:00Z" },
        ],
        total: 2,
      },
    });

    const body = await (await GET(req())).json();

    expect(body.unsubscribes).toHaveLength(1);
    expect(body.unsubscribes[0]).toMatchObject({ email: "someone@example.com", business: null, leadId: null });
  });

  it("reports the EXACT total, not the number of rows it could fit", async () => {
    stubSupabase({
      suppression: {
        rows: [{ email: "a@b.com", lead_id: null, reason: "unsubscribe", created_at: "2026-08-25T03:00:00Z" }],
        total: 137,
      },
    });

    const body = await (await GET(req())).json();

    expect(body.unsubscribesTotal).toBe(137);
    expect(body.unsubscribes).toHaveLength(1);
  });

  it("resolves opt-out names in a SEPARATE lookup from the trails", async () => {
    // Both id sets in one in.() filter would grow the URL without bound as the
    // caps rise; two bounded queries is the shape this route commits to.
    stubSupabase({
      suppression: {
        rows: [{ email: "a@b.com", lead_id: OTHER_LEAD, reason: "unsubscribe", created_at: "2026-08-25T03:00:00Z" }],
        total: 1,
      },
      leads: [{ id: OTHER_LEAD, name: "Second Lead", category: null }],
    });

    const body = await (await GET(req())).json();

    const lookups = calls.filter((u) => u.includes("/leads?"));
    expect(lookups).toHaveLength(1); // no trails in this fixture ⇒ only the opt-out ids
    expect(lookups[0]).toContain(OTHER_LEAD);
    expect(body.unsubscribes[0].business).toBe("Second Lead");
  });
});

describe("GET /api/portal/lead-activity — an unreadable opt-out list", () => {
  it("says the list is unavailable rather than reporting zero opt-outs", async () => {
    stubSupabase({ suppression: "missing" });

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.unsubscribesAvailable).toBe(false);
    expect(body.unsubscribesTotal).toBe(0);
    expect(body.unsubscribes).toEqual([]);
  });

  it("does not drag the rest of the tab into demo mode", async () => {
    // supabase/unsubscribe.sql is a different migration from the portal
    // tables: missing it costs the opt-out list and nothing else.
    stubSupabase({ suppression: "missing" });

    const body = await (await GET(req())).json();

    expect(body.mode).toBe("live");
    expect(body.needsMigration).toBeUndefined();
    expect(body.ok).toBe(true);
  });

  it("treats a database error the same way — unknown, never empty", async () => {
    stubSupabase({ suppression: "error" });

    const body = await (await GET(req())).json();

    expect(body.mode).toBe("live");
    expect(body.unsubscribesAvailable).toBe(false);
  });
});

/**
 * The anonymous half of the payload: the "Anonymous portal visitors" card and
 * the source-tagged visitor trails (the Facebook / Google rows in the table).
 * PostgREST answers at most 1000 rows per read however large the `limit`, so
 * these pin counts past that cap against a stub that enforces it.
 */
describe("GET /api/portal/lead-activity — anonymous visitors past the 1000-row cap", () => {
  let seq = 0;
  /** One portal_events row; created_at rises with every call (oldest first). */
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

  function serve(events: Row[]) {
    const pg = fakePostgrest({ portal_events: events, email_suppression: [], leads: [] });
    vi.stubGlobal("fetch", vi.fn(pg.handler));
  }

  beforeEach(() => {
    seq = 0;
  });

  it("counts every anonymous visitor, not just the newest 1000 rows", async () => {
    serve(Array.from({ length: 1200 }, (_, i) => ev("portal_view", { visitor_id: `v${i}` })));

    const body = await (await GET(req())).json();

    expect(body.anonymous).toMatchObject({ visitors: 1200, events: 1200 });
  });

  it("keeps a tagged visitor's trail when newer untagged traffic would have pushed it out", async () => {
    serve([
      ev("portal_view", { visitor_id: "fb1", props: { source: "facebook" } }),
      ev("portal_service_open", { visitor_id: "fb1", view: "portal", props: { source: "facebook", service: "plumbing" } }),
      ...Array.from({ length: 1000 }, (_, i) => ev("portal_view", { visitor_id: `v${i}` })),
    ]);

    const body = await (await GET(req())).json();

    expect(body.visitors).toHaveLength(1);
    expect(body.visitors[0]).toMatchObject({
      visitorId: "fb1",
      source: "facebook",
      counts: { portalViews: 1, serviceOpens: 1 },
    });
    // The trail reads chronologically: the visit, then the card they opened.
    expect(body.visitors[0].events.map((e: { event: string }) => e.event)).toEqual([
      "portal_view",
      "portal_service_open",
    ]);
    expect(body.anonymous.visitors).toBe(1000);
  });

  it("lists every service anonymous visitors opened, not just the top few", async () => {
    const slugs = ["electrical", "painting", "plumbing", "carpentry", "flooring", "gardening", "handyman", "make-safe"];
    serve(slugs.map((service) => ev("portal_service_open", { visitor_id: "a", view: "portal", props: { service } })));

    const body = await (await GET(req())).json();

    expect(body.anonymous.topServices).toHaveLength(8);
  });

  it("files a visitor under their LATEST source — last touch wins", async () => {
    serve([
      ev("portal_view", { visitor_id: "x", props: { source: "google" } }),
      ev("portal_view", { visitor_id: "x", props: { source: "facebook" } }),
    ]);

    const body = await (await GET(req())).json();

    expect(body.visitors[0]).toMatchObject({ visitorId: "x", source: "facebook" });
    expect(body.visitors[0].firstSeen < body.visitors[0].lastSeen).toBe(true);
  });
});

describe("GET /api/portal/lead-activity — access", () => {
  it("never returns opt-out addresses without the admin key", async () => {
    stubSupabase({
      suppression: {
        rows: [{ email: "a@b.com", lead_id: null, reason: "unsubscribe", created_at: "2026-08-25T03:00:00Z" }],
        total: 1,
      },
    });

    const res = await GET(
      new Request("http://localhost/api/portal/lead-activity", {
        headers: { origin: "http://localhost", host: "localhost" },
      }),
    );
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.unsubscribes).toEqual([]);
    expect(body.unsubscribesAvailable).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
