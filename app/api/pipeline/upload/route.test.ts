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

describe("POST /api/pipeline/upload — LinkedIn leads", () => {
  let sent: Array<Record<string, unknown>> = [];
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.SUPABASE_URL = "https://db.example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
    sent = [];
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(null, { status: 201 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const LINKEDIN = {
    name: "Harbour Care",
    emails: ["ada@harbourcare.com.au"],
    category: "Community & Home Healthcare Services",
    contact_name: "Ada Brook",
    contact_title: "Director",
    source: "linkedin",
  };

  it("stores the contact and the linkedin source", async () => {
    const res = await POST(uploadReq([LINKEDIN]));
    expect(res.status).toBe(200);
    expect(sent[0]).toMatchObject({
      name: "Harbour Care",
      contact_name: "Ada Brook",
      contact_title: "Director",
      source: "linkedin",
      batch: "test-batch",
    });
  });

  it("sends no new columns for a maps import, so it works before the migration", async () => {
    await POST(uploadReq([ROW]));
    expect(sent[0]).not.toHaveProperty("contact_name");
    expect(sent[0]).not.toHaveProperty("contact_title");
    expect(sent[0]).not.toHaveProperty("source");
  });

  it("gives every row the same keys when a batch mixes kinds (PostgREST bulk insert)", async () => {
    await POST(uploadReq([LINKEDIN, ROW]));
    expect(Object.keys(sent[0]).sort()).toEqual(Object.keys(sent[1]).sort());
    expect(sent[1]).toMatchObject({ source: null, contact_name: null });
  });

  it("drops a source value the app doesn't store", async () => {
    await POST(uploadReq([{ ...ROW, source: "google" }, { ...ROW, source: "admin" }]));
    expect(sent[0]).not.toHaveProperty("source");
    expect(sent[1]).not.toHaveProperty("source");
  });

  it("asks for the LinkedIn migration when the columns aren't there yet", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: "PGRST204", message: "Could not find the 'contact_name' column of 'leads' in the schema cache" }),
        { status: 400 },
      ),
    );
    const res = await POST(uploadReq([LINKEDIN]));
    const data = await res.json();
    expect(res.status).toBe(422);
    expect(data).toMatchObject({ ok: false, inserted: 0, needsMigration: true, migration: "linkedin" });
    expect(data.error).toContain("linkedin-source.sql");
  });
});
