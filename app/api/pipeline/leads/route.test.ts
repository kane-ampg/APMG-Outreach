import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * DELETE /api/pipeline/leads — the filter builder.
 *
 * This route holds the service-role key and deletes rows from `public.leads`,
 * so the property that actually matters is not "the happy path works" but
 * *what never happens*: a request that fails validation must not reach Supabase
 * at all, and no path may ever issue a DELETE without a filter (PostgREST would
 * read that as "every row" and wipe the table).
 *
 * The bulk-folder form (`batches=`) is the one with room to get this wrong: it
 * takes a list, the Ungrouped bucket is `batch IS NULL` and cannot sit inside
 * an `in.()`, and a single bad name in the list must reject the whole request
 * rather than quietly delete the subset that parsed.
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
vi.mock("@/lib/portal/server", () => ({ countEmailsSentByLead: async () => new Map() }));

import { requirePermission } from "@/lib/rbac/server";
import { DELETE } from "./route";

const mockGuard = vi.mocked(requirePermission);

function req(query: string): Request {
  return new Request(`http://localhost/api/pipeline/leads${query}`, {
    method: "DELETE",
    headers: { origin: "http://localhost", host: "localhost" },
  });
}

/** Stub Supabase and hand back every URL the route called. */
function captureFetch(rows: unknown[] = [{ id: "1" }]): string[] {
  const seen: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    seen.push(String(url));
    return Response.json(rows);
  });
  return seen;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  mockGuard.mockResolvedValue({
    ok: true,
    roles: ["admin"],
    role: "admin",
    email: "admin@apmgservices.com.au",
    trueRoles: ["admin"],
    trueRole: "admin",
    actingAs: null,
  } as never);
});

describe("DELETE /api/pipeline/leads", () => {
  it("deletes several folders in one filtered request", async () => {
    const seen = captureFetch([{ id: "a" }, { id: "b" }]);
    const res = await DELETE(req("?batches=leads-0001-vic,leads-0002-qld"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ ok: true, deleted: 2 });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("batch=in.(leads-0001-vic,leads-0002-qld)");
  });

  it("folds the Ungrouped bucket into an or() — IS NULL can't sit in an in() list", async () => {
    const seen = captureFetch();
    const res = await DELETE(req("?batches=leads-0001-vic,__ungrouped__"));

    expect(res.status).toBe(200);
    expect(seen[0]).toContain("or=(batch.in.(leads-0001-vic),batch.is.null)");
  });

  it("deletes the Ungrouped bucket on its own as IS NULL", async () => {
    const seen = captureFetch();
    await DELETE(req("?batches=__ungrouped__"));

    expect(seen[0]).toContain("batch=is.null");
    expect(seen[0]).not.toContain("in.(");
  });

  it("rejects the whole list when one folder name is invalid, without calling Supabase", async () => {
    const seen = captureFetch();
    const res = await DELETE(req("?batches=leads-0001-vic,%20or%20true--"));

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ ok: false, deleted: 0 });
    expect(seen).toHaveLength(0);
  });

  it("rejects an empty batches list rather than deleting everything", async () => {
    const seen = captureFetch();
    const res = await DELETE(req("?batches="));

    expect(res.status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it("prefers ids over batches when a caller sends both", async () => {
    const seen = captureFetch();
    const id = "11111111-2222-3333-4444-555555555555";
    await DELETE(req(`?ids=${id}&batches=leads-0001-vic`));

    expect(seen[0]).toContain(`id=in.(${id})`);
    expect(seen[0]).not.toContain("batch=in.");
  });

  it("still deletes a single folder via the original batch param", async () => {
    const seen = captureFetch();
    const res = await DELETE(req("?batch=leads-0001-vic"));

    expect(res.status).toBe(200);
    expect(seen[0]).toContain("batch=eq.leads-0001-vic");
  });

  it("never issues a DELETE with no filter at all", async () => {
    const seen = captureFetch();
    const res = await DELETE(req(""));

    expect(res.status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it("refuses a caller without pipeline.import", async () => {
    const seen = captureFetch();
    mockGuard.mockResolvedValue({ ok: false, status: 403, error: "Forbidden." } as never);
    const res = await DELETE(req("?batches=leads-0001-vic"));

    expect(res.status).toBe(403);
    expect(seen).toHaveLength(0);
  });
});
