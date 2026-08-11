import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pipeline/server", () => ({
  supabaseTarget: () => ({ state: "ok", base: "https://db.test", key: "service-key" }),
}));

/**
 * The presence column (`last_seen_at`) ships in code before anyone runs the
 * migration, so these tests cover the window in between: a console pointed at
 * a database without the column must still render its whole roster, and must
 * not keep hammering a column that isn't there.
 *
 * The verbatim PostgREST body below was captured from the live project while
 * the column was genuinely absent — that is what makes the detection worth
 * trusting rather than guessing at.
 */
const MISSING_COLUMN = JSON.stringify({
  code: "42703",
  details: null,
  hint: null,
  message: "column app_users.last_seen_at does not exist",
});

const ROW = {
  email: "rep@apmgservices.com.au",
  name: "Rep",
  picture_url: null,
  roles: ["sales"],
  created_at: "2026-08-01T00:00:00.000Z",
  last_login_at: "2026-08-08T00:00:00.000Z",
  invited_by: null,
};

/** A fresh module per test: `presenceColumn` is module state that would
 *  otherwise carry one test's conclusion into the next. */
async function freshStore() {
  vi.resetModules();
  return import("./userStore");
}

function jsonRes(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function textRes(body: string, status: number): Response {
  return new Response(body, { status });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("listUsers — surviving a database without the presence column", () => {
  it("retries without last_seen_at and still returns the roster", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textRes(MISSING_COLUMN, 400))
      .mockResolvedValueOnce(jsonRes([ROW]));
    vi.stubGlobal("fetch", fetchMock);

    const { listUsers } = await freshStore();
    const result = await listUsers();

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
    // The roster is intact; presence simply reads as "never observed online",
    // which is the honest answer when the column does not exist.
    expect((result as Exclude<typeof result, string>)[0]).toMatchObject({
      email: ROW.email,
      roles: ["sales"],
      last_seen_at: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("last_seen_at");
    expect(String(fetchMock.mock.calls[1][0])).not.toContain("last_seen_at");
  });

  it("stops asking for the column on later reads, rather than failing twice forever", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textRes(MISSING_COLUMN, 400))
      .mockResolvedValue(jsonRes([ROW]));
    vi.stubGlobal("fetch", fetchMock);

    const { listUsers } = await freshStore();
    await listUsers();
    fetchMock.mockClear();
    await listUsers();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("last_seen_at");
  });

  it("still reports a genuine failure as an error, not as an empty roster", async () => {
    // The distinction the whole "error" return exists for: an empty list says
    // "nobody has signed in", which would send an admin chasing the wrong
    // problem when the query is what broke.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textRes("upstream exploded", 500)));
    const { listUsers } = await freshStore();
    expect(await listUsers()).toBe("error");
  });

  it("does not mistake an unrelated failure for the missing column", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        textRes(JSON.stringify({ code: "42703", message: "column app_users.nope does not exist" }), 400),
      ),
    );
    const { listUsers } = await freshStore();
    expect(await listUsers()).toBe("error");
  });

  it("carries last_seen_at through when the column is there", async () => {
    const seen = "2026-08-09T11:59:00.000Z";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonRes([{ ...ROW, last_seen_at: seen }])));
    const { listUsers } = await freshStore();
    const result = await listUsers();
    expect((result as Array<{ last_seen_at: string | null }>)[0].last_seen_at).toBe(seen);
  });
});

describe("touchLastSeen", () => {
  it("reports missing_column so the client can stop beating", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textRes(MISSING_COLUMN, 400)));
    const { touchLastSeen } = await freshStore();
    expect(await touchLastSeen("rep@apmgservices.com.au")).toBe("missing_column");
  });

  it("does not retry once it knows the column is absent", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textRes(MISSING_COLUMN, 400));
    vi.stubGlobal("fetch", fetchMock);
    const { touchLastSeen } = await freshStore();
    await touchLastSeen("rep@apmgservices.com.au");
    await touchLastSeen("rep@apmgservices.com.au");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("writes the address lowercased, and only that address", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { touchLastSeen } = await freshStore();
    expect(await touchLastSeen("  Rep@APMGservices.com.au ")).toBe("ok");

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("email=eq.rep%40apmgservices.com.au");
    expect((init as RequestInit).method).toBe("PATCH");
    // Only presence is touched. A stray `role` here would let a heartbeat
    // silently rewrite somebody's access.
    expect(Object.keys(JSON.parse(String((init as RequestInit).body)))).toEqual(["last_seen_at"]);
  });

  it("returns error, not ok, when the write fails for another reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(textRes("nope", 500)));
    const { touchLastSeen } = await freshStore();
    expect(await touchLastSeen("rep@apmgservices.com.au")).toBe("error");
  });

  it("survives a thrown network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("socket hang up")));
    const { touchLastSeen } = await freshStore();
    expect(await touchLastSeen("rep@apmgservices.com.au")).toBe("error");
  });
});

describe("listUsers / getUserRoles — surviving a database without the roles column", () => {
  const MISSING_ROLES = JSON.stringify({
    code: "42703",
    details: null,
    hint: 'Perhaps you meant to reference the column "app_users.role".',
    message: "column app_users.roles does not exist",
  });

  it("falls back to the legacy single role rather than locking everyone out", async () => {
    // The critical case: without this, deploying multi-role before running the
    // migration resolves EVERY user — including the main admin — to no roles,
    // and the person who could fix it can't open the screen that fixes it.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textRes(MISSING_ROLES, 400))
      .mockResolvedValueOnce(jsonRes([{ role: "admin" }]));
    vi.stubGlobal("fetch", fetchMock);

    const { getUserRoles } = await freshStore();
    expect(await getUserRoles("kane@apmgservices.com.au")).toEqual(["admin"]);
    expect(String(fetchMock.mock.calls[1][0])).toContain("select=role&");
  });

  it("maps a legacy 'pending' row to no roles, keeping a revocation revoked", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textRes(MISSING_ROLES, 400))
      .mockResolvedValueOnce(jsonRes([{ role: "pending" }]));
    vi.stubGlobal("fetch", fetchMock);

    const { getUserRoles } = await freshStore();
    expect(await getUserRoles("revoked@apmgservices.com.au")).toEqual([]);
  });

  it("does NOT fall back on an unrelated failure — that must stay no access", async () => {
    const fetchMock = vi.fn().mockResolvedValue(textRes("upstream exploded", 500));
    vi.stubGlobal("fetch", fetchMock);

    const { getUserRoles } = await freshStore();
    expect(await getUserRoles("rep@apmgservices.com.au")).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the roster readable, mapping the legacy column per row", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(textRes(MISSING_ROLES, 400))
      .mockResolvedValueOnce(
        jsonRes([
          { ...ROW, roles: undefined, role: "admin" },
          { ...ROW, roles: undefined, email: "gone@apmgservices.com.au", role: "pending" },
        ]),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { listUsers } = await freshStore();
    const result = (await listUsers()) as Exclude<Awaited<ReturnType<typeof listUsers>>, string>;
    expect(result.map((r) => r.roles)).toEqual([["admin"], []]);
  });
});
