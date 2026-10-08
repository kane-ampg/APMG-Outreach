import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakePostgrest, type Row } from "@/lib/portal/fakePostgrest";

/**
 * GET /api/performance — the Performance tab's read. It must count past
 * PostgREST's 1000-row cap (a single read silently stops there), it is an
 * admin view (telemetry.view or nothing), and a finished tally is served from
 * the Runtime Cache for five minutes. Off Vercel, @vercel/functions falls back
 * to an in-memory cache, which is what these tests exercise.
 */

const requirePermission = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return {
    ...actual,
    supabaseTarget: () => ({ state: "ok", base: "https://db.test", key: "k" }),
    requireLiveSupabase: () => null,
  };
});

vi.mock("@/lib/rbac/server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, requirePermission: (...a: unknown[]) => requirePermission(...a) };
});

import { expirePerformanceCache } from "@/lib/portal/performanceCache";
import { GET } from "./route";

// 13:00 on 8 October 2026 in Melbourne.
const NOW = new Date("2026-10-08T02:00:00Z");

function req(query = "?days=7&tz=Australia/Melbourne"): Request {
  return new Request(`http://localhost/api/performance${query}`, {
    headers: { origin: "http://localhost", host: "localhost" },
  });
}

let seq = 0;

function ev(event: string, createdAt: string, extra: Row = {}): Row {
  seq += 1;
  return {
    id: `e${String(seq).padStart(6, "0")}`,
    event,
    props: {},
    lead_id: null,
    visitor_id: null,
    ua: null,
    created_at: createdAt,
    ...extra,
  };
}

function serve(tables: Record<string, Row[]>) {
  const pg = fakePostgrest(tables);
  vi.stubGlobal("fetch", vi.fn(pg.handler));
  return pg;
}

beforeEach(async () => {
  seq = 0;
  await expirePerformanceCache();
  vi.unstubAllGlobals();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  requirePermission.mockResolvedValue({ ok: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/performance", () => {
  it("refuses anyone without telemetry.view", async () => {
    requirePermission.mockResolvedValue({ ok: false, status: 403, error: "Forbidden — missing permission: telemetry.view" });
    serve({ portal_events: [], portal_inquiries: [] });

    const res = await GET(req());

    expect(res.status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith(expect.any(Request), "telemetry.view");
  });

  it("counts every click past the 1000-row cap", async () => {
    const opens = Array.from({ length: 1500 }, (_, i) =>
      ev("portal_service_open", "2026-10-06T01:00:00Z", {
        props: { service: i % 3 ? "plumbing" : "electrical" },
      }),
    );
    serve({ portal_events: opens, portal_inquiries: [] });

    const body = await (await GET(req())).json();

    expect(body.ok).toBe(true);
    expect(body.interactions.services.total).toBe(1500);
    expect(body.services.plumbing.total).toBe(1000);
    expect(body.services.electrical.total).toBe(500);
  });

  it("reads only the window it reports, and only the events it tallies", async () => {
    const pg = serve({
      portal_events: [
        ev("portal_phone_click", "2026-10-07T01:00:00Z"),
        ev("portal_phone_click", "2026-09-28T01:00:00Z"),
        ev("portal_phone_click", "2026-08-01T01:00:00Z"),
        ev("email_sent", "2026-10-07T01:00:00Z"),
      ],
      portal_inquiries: [],
    });

    const body = await (await GET(req())).json();

    expect(body.days).toBe(7);
    expect(body.dates).toHaveLength(7);
    expect(body.dates[6]).toBe("2026-10-08");
    expect(body.interactions.calls.total).toBe(1);
    expect(body.interactions.calls.previous).toBe(1);
    const eventsRead = pg.calls.find((u) => u.includes("/portal_events"))!;
    expect(decodeURIComponent(eventsRead)).toContain("created_at=gte.2026-09-22");
    expect(eventsRead).not.toContain("email_sent");
  });

  it("falls back to 28 days for a range it doesn't offer", async () => {
    serve({ portal_events: [], portal_inquiries: [] });

    const body = await (await GET(req("?days=9999"))).json();

    expect(body.days).toBe(28);
    expect(body.dates).toHaveLength(28);
  });

  it("shows the migration banner when the portal tables don't exist", async () => {
    serve({});

    const body = await (await GET(req())).json();

    expect(body).toMatchObject({ ok: true, mode: "demo", needsMigration: true });
  });
});

describe("GET /api/performance — the cache", () => {
  const eventReads = (pg: ReturnType<typeof serve>) => pg.calls.filter((u) => u.includes("/portal_events")).length;

  it("serves a repeat request from the cache without reading Supabase again", async () => {
    const pg = serve({ portal_events: [ev("portal_phone_click", "2026-10-07T01:00:00Z")], portal_inquiries: [] });

    const first = await GET(req());
    const reads = eventReads(pg);
    const second = await GET(req());

    expect(first.headers.get("x-performance-cache")).toBe("MISS");
    expect(second.headers.get("x-performance-cache")).toBe("HIT");
    expect(eventReads(pg)).toBe(reads);
    const [a, b] = [await first.json(), await second.json()];
    expect(b).toEqual(a);
    expect(b.computedAt).toBe(NOW.toISOString());
  });

  it("recomputes on Refresh, and the new tally is what everyone gets next", async () => {
    const rows = [ev("portal_phone_click", "2026-10-07T01:00:00Z")];
    serve({ portal_events: rows, portal_inquiries: [] });
    await GET(req());

    rows.push(ev("portal_phone_click", "2026-10-07T02:00:00Z"));
    const fresh = await GET(req("?days=7&tz=Australia/Melbourne&fresh=1"));
    const after = await GET(req());

    expect(fresh.headers.get("x-performance-cache")).toBe("BYPASS");
    expect((await fresh.json()).interactions.calls.total).toBe(2);
    expect(after.headers.get("x-performance-cache")).toBe("HIT");
    expect((await after.json()).interactions.calls.total).toBe(2);
  });

  it("computes again once the five minutes are up", async () => {
    const rows = [ev("portal_phone_click", "2026-10-07T01:00:00Z")];
    serve({ portal_events: rows, portal_inquiries: [] });
    await GET(req());

    rows.push(ev("portal_phone_click", "2026-10-07T02:00:00Z"));
    vi.setSystemTime(new Date(NOW.getTime() + 5 * 60_000 + 1000));
    const res = await GET(req());

    expect(res.headers.get("x-performance-cache")).toBe("MISS");
    expect((await res.json()).interactions.calls.total).toBe(2);
  });

  it("keeps each period and zone separate", async () => {
    const pg = serve({ portal_events: [], portal_inquiries: [] });
    await GET(req("?days=7&tz=Australia/Melbourne"));

    const other = await GET(req("?days=28&tz=Australia/Melbourne"));
    const zone = await GET(req("?days=7&tz=Australia/Perth"));

    expect(other.headers.get("x-performance-cache")).toBe("MISS");
    expect(zone.headers.get("x-performance-cache")).toBe("MISS");
    expect(eventReads(pg)).toBe(3);
  });

  it("starts a new entry at local midnight, so the last bar is always today", async () => {
    serve({ portal_events: [], portal_inquiries: [] });
    vi.setSystemTime(new Date("2026-10-08T12:58:00Z")); // 23:58 in Melbourne
    await GET(req());

    vi.setSystemTime(new Date("2026-10-08T13:01:00Z")); // 00:01 on the 9th
    const res = await GET(req());
    const body = await res.json();

    expect(res.headers.get("x-performance-cache")).toBe("MISS");
    expect(body.dates.at(-1)).toBe("2026-10-09");
  });

  it("never caches a failed read", async () => {
    serve({});
    const missing = await GET(req());
    expect((await missing.json()).needsMigration).toBe(true);

    serve({ portal_events: [ev("portal_phone_click", "2026-10-07T01:00:00Z")], portal_inquiries: [] });
    const res = await GET(req());

    expect(res.headers.get("x-performance-cache")).toBe("MISS");
    expect((await res.json()).interactions.calls.total).toBe(1);
  });

  it("still checks the permission when the answer is already cached", async () => {
    serve({ portal_events: [ev("portal_phone_click", "2026-10-07T01:00:00Z")], portal_inquiries: [] });
    await GET(req());

    requirePermission.mockResolvedValue({ ok: false, status: 403, error: "Forbidden — missing permission: telemetry.view" });
    const res = await GET(req());

    expect(res.status).toBe(403);
    expect(await res.json()).not.toHaveProperty("interactions");
  });

  it("keeps every answer out of shared and browser HTTP caches", async () => {
    serve({ portal_events: [], portal_inquiries: [] });

    const miss = await GET(req());
    const hit = await GET(req());
    requirePermission.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const denied = await GET(req());

    for (const res of [miss, hit, denied]) expect(res.headers.get("cache-control")).toBe("private, no-store");
  });
});
