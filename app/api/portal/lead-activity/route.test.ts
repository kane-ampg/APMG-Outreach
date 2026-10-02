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

function req(query = ""): Request {
  return new Request(`http://localhost/api/portal/lead-activity${query}`, {
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

describe("GET /api/portal/lead-activity — LinkedIn-sourced leads", () => {
  /** One attributed click for LEAD_ID; the leads lookup answers via `leads`. */
  function stubTrail(leads: (url: string) => Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        calls.push(url);
        if (url.includes("/leads?")) return leads(url);
        if (url.includes("portal_events") && url.includes("lead_id=not.is.null")) {
          return Response.json([
            {
              event: "attribution_click",
              props: {},
              lead_id: LEAD_ID,
              campaign: null,
              category: null,
              created_at: "2026-09-28T01:00:00Z",
            },
          ]);
        }
        if (url.includes("email_suppression")) {
          return new Response("[]", { status: 200, headers: { "content-range": "*/0" } });
        }
        return Response.json([]);
      }),
    );
  }

  it("carries the lead's stored source and contact onto its row", async () => {
    stubTrail(() =>
      Response.json([
        {
          id: LEAD_ID,
          name: "Harbour Care",
          category: "Community & Home Healthcare Services",
          source: "linkedin",
          contact_name: "Ada Brook",
          contact_title: "Director",
        },
      ]),
    );
    const body = await (await GET(req())).json();
    expect(body.leads[0]).toMatchObject({
      leadId: LEAD_ID,
      business: "Harbour Care",
      leadSource: "linkedin",
      contactName: "Ada Brook",
      contactTitle: "Director",
    });
    expect(calls.find((u) => u.includes("/leads?"))).toContain("bing_maps_url,source,contact_name,contact_title");
  });

  it("derives Google / Bing leads off the maps URL", async () => {
    stubTrail(() =>
      Response.json([{ id: LEAD_ID, name: "Acme", category: null, bing_maps_url: "https://www.google.com/maps/place/Acme", source: null }]),
    );
    const body = await (await GET(req())).json();
    expect(body.leads[0].leadSource).toBe("google");
  });

  it("still names leads before linkedin-source.sql has been run", async () => {
    stubTrail((url) =>
      url.includes("contact_name")
        ? Response.json({ code: "42703", message: "column leads.contact_name does not exist" }, { status: 400 })
        : Response.json([
            { id: LEAD_ID, name: "Acme Childcare", category: "Childcare", bing_maps_url: "https://www.bing.com/maps?ss=ypid.YN1" },
          ]),
    );
    const body = await (await GET(req())).json();
    // the maps URL is an original column, so Bing still resolves pre-migration
    expect(body.leads[0]).toMatchObject({ business: "Acme Childcare", leadSource: "bing", contactName: null });
  });

  it("ignores a stored source value the app doesn't recognise", async () => {
    stubTrail(() => Response.json([{ id: LEAD_ID, name: "Acme", category: null, source: "made-up" }]));
    const body = await (await GET(req())).json();
    expect(body.leads[0].leadSource).toBe("unknown");
  });
});

describe("GET /api/portal/lead-activity — hot leads whose folder was deleted", () => {
  /** One service open for LEAD_ID; `leads` and `saved` answer their lookups. */
  function stubHotTrail(opts: { leads: unknown[]; saved: Response }) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        calls.push(url);
        if (url.includes("/leads?")) return Response.json(opts.leads);
        if (url.includes("saved_hot_leads?")) return opts.saved;
        if (url.includes("portal_events") && url.includes("lead_id=not.is.null")) {
          return Response.json([
            {
              event: "portal_service_open",
              props: { service: "plumbing" },
              lead_id: LEAD_ID,
              campaign: null,
              category: "Childcare",
              created_at: "2026-09-28T01:00:00Z",
            },
          ]);
        }
        if (url.includes("email_suppression")) {
          return new Response("[]", { status: 200, headers: { "content-range": "*/0" } });
        }
        return Response.json([]);
      }),
    );
  }

  it("names the lead from its saved copy once the leads row is gone", async () => {
    stubHotTrail({
      leads: [],
      saved: Response.json([
        { lead_id: LEAD_ID, name: "Jenny's ELC", category: "Childcare", bing_maps_url: "https://www.google.com/maps/place/x" },
      ]),
    });
    const body = await (await GET(req())).json();
    expect(body.leads[0]).toMatchObject({ leadId: LEAD_ID, business: "Jenny's ELC", leadSource: "google" });
    expect(calls.find((u) => u.includes("saved_hot_leads?"))).toContain(LEAD_ID);
  });

  it("prefers the live leads row over the saved copy", async () => {
    stubHotTrail({
      leads: [{ id: LEAD_ID, name: "Renamed ELC", category: "Childcare" }],
      saved: Response.json([{ lead_id: LEAD_ID, name: "Jenny's ELC", category: "Childcare" }]),
    });
    const body = await (await GET(req())).json();
    expect(body.leads[0].business).toBe("Renamed ELC");
  });

  it("still lists the trail before saved-hot-leads.sql has been run", async () => {
    stubHotTrail({
      leads: [],
      saved: Response.json({ code: "PGRST205", message: "Could not find the table" }, { status: 404 }),
    });
    const res = await GET(req());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.leads[0]).toMatchObject({ leadId: LEAD_ID, business: null, category: "Childcare" });
  });
});

describe("GET /api/portal/lead-activity — warm false positives", () => {
  const SCANNER_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.7444.175 Safari/537.36";
  const REAL_UA =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36";
  const MAC_UA =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36";
  const PDF = "https://db.test/storage/v1/object/public/sector-assets/education.pdf?v=1";
  const HOT_LEAD = "33333333-3333-4333-8333-333333333333";
  const MIXED_LEAD = "44444444-4444-4444-8444-444444444444";
  const BURST_LEAD = "55555555-5555-4555-8555-555555555555";

  type Row = ReturnType<typeof row>;
  const row = (lead_id: string, event: string, ua: string | null, created_at: string, destination?: string) => ({
    event,
    props:
      event === "portal_service_open"
        ? { service: "plumbing" }
        : event === "attribution_click"
          ? { destination: destination ?? "/portal" }
          : {},
    lead_id,
    campaign: null,
    category: null,
    ua,
    created_at,
  });

  /** Newest-first, as PostgREST answers the attributed window:
   *  LEAD_ID    — Warm, forged agent on every row        → false positive
   *  BURST_LEAD — Warm, normal agent, both links in 40ms → false positive
   *  OTHER_LEAD — Warm, a real browser                   → real
   *  HOT_LEAD   — opened a service, forged agent         → real: only Warm is flagged
   *  MIXED_LEAD — Warm, one forged visit + one real one  → real: not scanner-only */
  const TRAILS: Row[] = [
    row(LEAD_ID, "portal_view", SCANNER_UA, "2026-09-30T01:00:05Z"),
    row(LEAD_ID, "attribution_click", SCANNER_UA, "2026-09-30T01:00:01Z"),
    row(BURST_LEAD, "portal_view", MAC_UA, "2026-09-29T12:00:08Z"),
    row(BURST_LEAD, "attribution_click", MAC_UA, "2026-09-29T12:00:00.040Z", PDF),
    row(BURST_LEAD, "attribution_click", MAC_UA, "2026-09-29T12:00:00Z"),
    row(OTHER_LEAD, "portal_view", REAL_UA, "2026-09-29T01:00:05Z"),
    row(OTHER_LEAD, "attribution_click", REAL_UA, "2026-09-29T01:00:01Z"),
    row(HOT_LEAD, "portal_service_open", SCANNER_UA, "2026-09-28T01:00:09Z"),
    row(HOT_LEAD, "portal_view", SCANNER_UA, "2026-09-28T01:00:05Z"),
    row(MIXED_LEAD, "portal_view", REAL_UA, "2026-09-27T09:00:00Z"),
    row(MIXED_LEAD, "attribution_click", SCANNER_UA, "2026-09-27T01:00:01Z"),
  ];

  /** The saved tickbox as app_settings answers it: a value, absent, or down. */
  type Saved = "true" | "false" | "absent" | "error";

  function stubTrails(opts: { saved?: Saved; trails?: Row[] } = {}) {
    const saved = opts.saved ?? "absent";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        calls.push(url);
        if (url.includes("app_settings?")) {
          if (saved === "error") return new Response("boom", { status: 500 });
          return Response.json(saved === "absent" ? [] : [{ value: saved }]);
        }
        if (url.includes("portal_events") && url.includes("lead_id=not.is.null")) {
          return Response.json(opts.trails ?? TRAILS);
        }
        if (url.includes("email_suppression")) {
          return new Response("[]", { status: 200, headers: { "content-range": "*/0" } });
        }
        return Response.json([]);
      }),
    );
  }

  const ALL = [LEAD_ID, BURST_LEAD, OTHER_LEAD, HOT_LEAD, MIXED_LEAD];
  type Lead = { leadId: string; warmFalsePositive?: boolean };
  const ids = (body: { leads: Lead[] }) => body.leads.map((l) => l.leadId);
  const flagged = (body: { leads: Lead[] }) => body.leads.filter((l) => l.warmFalsePositive).map((l) => l.leadId);
  const settingsReads = () => calls.filter((u) => u.includes("app_settings?")).length;

  it("asks PostgREST for each row's agent", async () => {
    stubTrails();
    await GET(req("?view=telemetry"));
    expect(calls.find((u) => u.includes("lead_id=not.is.null"))).toContain(",ua,");
  });

  it("flags the false positives and still sends them, so the page can hide them without a fetch", async () => {
    stubTrails({ saved: "true" });
    const body = await (await GET(req("?view=telemetry"))).json();
    expect(ids(body)).toEqual(ALL);
    expect(flagged(body)).toEqual([LEAD_ID, BURST_LEAD]);
    expect(body.warmFalsePositives).toBe(2);
  });

  it("reads the saved tickbox only when the page asks for it", async () => {
    stubTrails({ saved: "true" });
    const polled = await (await GET(req("?view=telemetry"))).json();
    expect(polled).not.toHaveProperty("hideWarmFalsePositives");
    expect(settingsReads()).toBe(0);

    const first = await (await GET(req("?view=telemetry&settings=1"))).json();
    expect(first.hideWarmFalsePositives).toBe(true);
    expect(settingsReads()).toBe(1);
  });

  it("reads an absent setting as off", async () => {
    stubTrails({ saved: "absent" });
    const body = await (await GET(req("?view=telemetry&settings=1"))).json();
    expect(body.hideWarmFalsePositives).toBe(false);
  });

  it("says the setting is unknown, rather than off, when it can't be read", async () => {
    stubTrails({ saved: "error" });
    const body = await (await GET(req("?view=telemetry&settings=1"))).json();
    expect(body.hideWarmFalsePositives).toBeNull();
    expect(ids(body)).toEqual(ALL);
  });

  it("keeps a full page of real leads however many false positives are newer", async () => {
    const id = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;
    const at = (n: number) => new Date(Date.parse("2026-09-30T00:00:00Z") - n * 60_000).toISOString();
    const trails: Row[] = [];
    // 150 scanner leads, all newer than 120 real ones.
    for (let n = 0; n < 150; n++) trails.push(row(id(n), "portal_view", SCANNER_UA, at(n)));
    for (let n = 150; n < 270; n++) trails.push(row(id(n), "portal_view", REAL_UA, at(n)));
    stubTrails({ trails });
    const body = await (await GET(req("?view=telemetry"))).json();

    expect(body.leads).toHaveLength(200);
    expect(flagged(body)).toHaveLength(100);
    expect(body.warmFalsePositives).toBe(150);
    // Unticked, the page shows the first 100 of the merge: the newest 100 overall.
    expect(ids(body).slice(0, 100)).toEqual(Array.from({ length: 100 }, (_, n) => id(n)));
    // Ticked, it shows the newest 100 real leads.
    expect(body.leads.filter((l: Lead) => !l.warmFalsePositive).map((l: Lead) => l.leadId)).toEqual(
      Array.from({ length: 100 }, (_, n) => id(n + 150)),
    );
    // 200 ids go to the leads lookups in chunks, never one oversized in.() filter.
    const lookups = calls.filter((u) => u.includes("/leads?") || u.includes("saved_hot_leads?"));
    expect(lookups).toHaveLength(4);
    for (const u of lookups) expect(decodeURIComponent(u).split(",").length).toBeLessThanOrEqual(110);
  });

  it("leaves the other readers exactly as they were", async () => {
    stubTrails({ saved: "true" });
    const body = await (await GET(req("?settings=1"))).json();
    expect(ids(body)).toEqual(ALL);
    expect(flagged(body)).toEqual([]);
    expect(body).not.toHaveProperty("hideWarmFalsePositives");
    expect(body).not.toHaveProperty("warmFalsePositives");
    expect(settingsReads()).toBe(0);
  });
});
