import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requirePermission = vi.fn();
vi.mock("@/lib/rbac/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac/server")>();
  return { ...actual, requirePermission: (...a: unknown[]) => requirePermission(...a) };
});

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ ok: true, role: "admin", email: "kane@apmgservices.com.au" });
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function uploadReq(rows: unknown[]): Request {
  return new Request("http://local/api/pipeline/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows, batch: "test-batch" }),
  });
}

const ROW = { name: "Acme Childcare", email: "a@acme.test", category: "childcare" };

describe("POST /api/pipeline/upload — never reports an import that did not happen", () => {
  it("503s with inserted: 0 when Supabase is unconfigured on a deployed runtime", async () => {
    const res = await POST(uploadReq([ROW, ROW]));
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data.ok).toBe(false);
    // requireLiveSupabase()'s 503 body is generic ({ ok, error }) and carries no
    // route-specific `inserted` field; treat absent the same as 0 — the point
    // under test is that it is never a truthy positive count.
    expect(data.inserted ?? 0).toBe(0);
  });

  it("still allows the local demo path off a deployed runtime", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await POST(uploadReq([ROW]));
    expect(res.status).toBe(200);
  });
});
