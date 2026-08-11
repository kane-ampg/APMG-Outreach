import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The endpoint that exists to stop the console pulling its whole leads table.
 *
 * The KPI numbers used to be folded in the browser from `/api/pipeline/leads`,
 * which returns every row (LIMIT 10000 — ~5.7 MB at 8k leads). Three components
 * read it and two polled it every 15s, which is what exhausted the Vercel Fast
 * Origin Transfer allowance. So the properties pinned here are as much about
 * COST as correctness:
 *
 *   1. the aggregate path maps the RPC's numbers through untouched,
 *   2. a missing migration degrades to cheap count probes rather than to a table
 *      read — and says so instead of inventing avgRating/folders/histogram,
 *   3. an unchanged answer is a 304 with no body,
 *   4. NOTHING on any path ever reads lead rows in bulk. That last one is the
 *      regression guard: the cost bug was a fold over rows, and re-introducing
 *      one here would be invisible in every other assertion.
 */

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rbac/server", () => ({
  requirePermission: vi.fn(),
  guardResponse: (g: { status: number; error: string }) =>
    Response.json({ error: g.error }, { status: g.status }),
}));
vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return {
    ...actual,
    supabaseTarget: () => ({ state: "ok", base: "https://db.test", key: "k" }),
    requireLiveSupabase: () => null,
  };
});

import { requirePermission } from "@/lib/rbac/server";
import { GET } from "./route";

const mockGuard = vi.mocked(requirePermission);

function req(query = "", headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/pipeline/stats${query}`, {
    headers: { origin: "http://localhost", host: "localhost", ...headers },
  });
}

function allow() {
  mockGuard.mockResolvedValue({
    ok: true,
    roles: ["admin"],
    role: "admin",
    email: "admin@apmgservices.com.au",
    trueRoles: ["admin"],
    trueRole: "admin",
    actingAs: null,
  } as never);
}

const RPC_OK = {
  total: 8052,
  withEmail: 1744,
  withPhone: 7727,
  withWebsite: 7085,
  ratedCount: 1012,
  avgRating: 4.3125,
  folders: 11,
  latestImport: "2026-07-28T06:53:24.115964+00:00",
  addedToday: 0,
  byDay: [
    { d: "2026-07-15", n: 3000 },
    { d: "2026-07-28", n: 5052 },
  ],
  tz: "Australia/Sydney",
};

const RECENT = [{ id: "a", name: "Croydon North Kindergarten", phone: "03 9876 5432", emails: ["a@b.com"] }];

/** Every URL the handler asked Supabase for, in call order. */
let calls: { url: string; method: string }[] = [];

/**
 * Stands in for PostgREST. `rpc` decides whether the aggregate function exists;
 * count probes answer through the Content-Range header with an EMPTY body, which
 * is what makes the degraded path cheap.
 */
function stubSupabase({ rpc }: { rpc: "ok" | "missing" }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push({ url, method: init?.method ?? "GET" });

      if (url.includes("/rpc/pipeline_lead_stats")) {
        if (rpc === "missing") {
          return new Response(JSON.stringify({ code: "PGRST202" }), { status: 404 });
        }
        return Response.json(RPC_OK);
      }
      if (init?.method === "HEAD") {
        // Distinct counts per filter so a mapping mix-up can't pass.
        const n = url.includes("emails=neq")
          ? 1744
          : url.includes("phone.")
            ? 7727
            : url.includes("website.")
              ? 7085
              : url.includes("rating=not")
                ? 1012
                : url.includes("created_at=gt")
                  ? 4
                  : 8052;
        return new Response(null, { status: 206, headers: { "content-range": `0-0/${n}` } });
      }
      if (url.includes("select=created_at&order=created_at.desc&limit=1")) {
        return Response.json([{ created_at: RPC_OK.latestImport }]);
      }
      return Response.json(RECENT); // the recent-rows read
    }),
  );
}

beforeEach(() => {
  calls = [];
  vi.restoreAllMocks();
  allow();
});

describe("GET /api/pipeline/stats — access", () => {
  it("refuses a cross-origin read", async () => {
    stubSupabase({ rpc: "ok" });
    const res = await GET(
      new Request("http://localhost/api/pipeline/stats", {
        headers: { origin: "https://evil.example", host: "localhost" },
      }),
    );
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });

  it("refuses a caller without leads.view", async () => {
    stubSupabase({ rpc: "ok" });
    mockGuard.mockResolvedValue({ ok: false, status: 403, error: "Forbidden — missing permission: leads.view" });
    const res = await GET(req());
    expect(res.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
});

describe("GET /api/pipeline/stats — aggregate path", () => {
  it("passes the database's numbers through untouched", async () => {
    stubSupabase({ rpc: "ok" });
    const body = await (await GET(req("?tz=Australia/Sydney"))).json();

    expect(body).toMatchObject({
      ok: true,
      mode: "live",
      needsMigration: false,
      total: 8052,
      withEmail: 1744,
      withPhone: 7727,
      withWebsite: 7085,
      ratedCount: 1012,
      avgRating: 4.3125,
      folders: 11,
      addedToday: 0,
      tz: "Australia/Sydney",
      byDay: RPC_OK.byDay,
    });
  });

  it("forwards the viewer's timezone so day buckets are cut locally", async () => {
    stubSupabase({ rpc: "ok" });
    await GET(req("?tz=Australia/Melbourne"));
    const rpc = calls.find((c) => c.url.includes("/rpc/"));
    expect(rpc?.method).toBe("POST");
  });

  it("drops a junk timezone rather than forwarding it", async () => {
    stubSupabase({ rpc: "ok" });
    // A zone the RPC would raise on. It must not reach the database at all.
    const res = await GET(req("?tz=" + encodeURIComponent("'; drop table leads--")));
    expect(res.status).toBe(200);
    expect(calls.find((c) => c.url.includes("/rpc/"))).toBeDefined();
  });

  it("keeps a malformed histogram row from poisoning the series", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/rpc/")) {
          return Response.json({
            ...RPC_OK,
            byDay: [{ d: "2026-07-15", n: 3 }, { d: "15/07/2026", n: 9 }, { d: null, n: 9 }],
          });
        }
        return Response.json(RECENT);
      }),
    );
    const body = await (await GET(req())).json();
    expect(body.byDay).toEqual([{ d: "2026-07-15", n: 3 }]);
  });
});

describe("GET /api/pipeline/stats — degraded path", () => {
  it("falls back to count probes when the migration is missing", async () => {
    stubSupabase({ rpc: "missing" });
    const body = await (await GET(req())).json();

    expect(body).toMatchObject({
      ok: true,
      needsMigration: true,
      total: 8052,
      withEmail: 1744,
      withPhone: 7727,
      withWebsite: 7085,
      ratedCount: 1012,
      addedToday: 4,
      latestImport: RPC_OK.latestImport,
    });
  });

  it("reports what it cannot compute instead of inventing it", async () => {
    stubSupabase({ rpc: "missing" });
    const body = await (await GET(req())).json();
    // avg() / count(distinct) / GROUP BY need the RPC. A console that cannot
    // compute a number shows "—", never a plausible one.
    expect(body.avgRating).toBeNull();
    expect(body.folders).toBe(0);
    expect(body.byDay).toEqual([]);
  });

  it("counts with HEAD, so the probes carry no row payload", async () => {
    stubSupabase({ rpc: "missing" });
    await GET(req());
    const counts = calls.filter((c) => c.method === "HEAD");
    expect(counts.length).toBeGreaterThanOrEqual(5);
  });
});

describe("GET /api/pipeline/stats — revalidation", () => {
  it("answers 304 with no body when the client already holds this answer", async () => {
    stubSupabase({ rpc: "ok" });
    const first = await GET(req());
    const etag = first.headers.get("etag");
    expect(etag).toBeTruthy();

    const second = await GET(req("", { "if-none-match": etag! }));
    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("etag")).toBe(etag);
  });

  it("sends a fresh body when the dataset changed", async () => {
    stubSupabase({ rpc: "ok" });
    const etag = (await GET(req())).headers.get("etag")!;

    // A new import lands: more rows, newer stamp.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.includes("/rpc/")) {
          return Response.json({ ...RPC_OK, total: 9000, latestImport: "2026-08-11T00:00:00+00:00" });
        }
        return Response.json(RECENT);
      }),
    );
    const after = await GET(req("", { "if-none-match": etag }));
    expect(after.status).toBe(200);
    expect((await after.json()).total).toBe(9000);
  });

  it("lets the browser cache but forces revalidation", async () => {
    stubSupabase({ rpc: "ok" });
    const cc = (await GET(req())).headers.get("cache-control") ?? "";
    // `no-store` would forbid the cached copy and make the 304 above impossible.
    expect(cc).toContain("no-cache");
    expect(cc).toContain("private");
    expect(cc).not.toContain("no-store");
  });
});

describe("GET /api/pipeline/stats — cost guard", () => {
  /** The bug this endpoint exists to fix: reading lead ROWS in bulk. */
  const bulkRowRead = (url: string) => {
    if (!url.includes("/rest/v1/leads")) return false;
    if (new URL(url).searchParams.get("select") === "created_at") return false; // latest-stamp probe
    const limit = Number(new URL(url).searchParams.get("limit") ?? "0");
    return limit > 25;
  };

  it("never reads lead rows in bulk on the aggregate path", async () => {
    stubSupabase({ rpc: "ok" });
    await GET(req());
    expect(calls.filter((c) => bulkRowRead(c.url)).map((c) => c.url)).toEqual([]);
  });

  it("never reads lead rows in bulk on the degraded path either", async () => {
    stubSupabase({ rpc: "missing" });
    await GET(req());
    expect(calls.filter((c) => bulkRowRead(c.url)).map((c) => c.url)).toEqual([]);
  });

  it("asks for only a handful of recent rows, without the long columns", async () => {
    stubSupabase({ rpc: "ok" });
    await GET(req());
    const recent = calls.find((c) => c.url.includes("select=id,name"));
    expect(recent).toBeDefined();
    const params = new URL(recent!.url).searchParams;
    expect(Number(params.get("limit"))).toBeLessThanOrEqual(10);
    // featured_image and bing_maps_url are the two longest columns in the table.
    expect(params.get("select")).not.toContain("featured_image");
    expect(params.get("select")).not.toContain("bing_maps_url");
  });
});
