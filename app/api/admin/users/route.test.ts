import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listUsers = vi.fn();
const setUserRole = vi.fn();
const requirePermission = vi.fn();
const assignableRoles = vi.fn();

vi.mock("@/lib/auth/userStore", () => ({
  listUsers: (...a: unknown[]) => listUsers(...a),
  setUserRole: (...a: unknown[]) => setUserRole(...a),
}));

vi.mock("@/lib/rbac/server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requirePermission: (...a: unknown[]) => requirePermission(...a),
  };
});

// isRole (and everything else) stays the real implementation -- the
// "constructor" test below depends on the real own-property check. Only
// assignableRoles is overridable, and only so the dormant-catalog test can
// simulate a role that would fail assignableRoles() without one existing yet.
vi.mock("@/lib/rbac/roles", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    assignableRoles: (...a: unknown[]) => assignableRoles(...a),
  };
});

import { MAIN_ADMIN_EMAIL } from "@/lib/auth/policy";
import { GET, PATCH } from "./route";

const ACTOR = "boss@apmgservices.com.au";

/** A PATCH request the sameOrigin floor will accept (no Origin header). */
function patch(body: unknown): Request {
  return new Request("http://local/api/admin/users", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A GET request the sameOrigin floor will accept (no Origin header). */
function get(): Request {
  return new Request("http://local/api/admin/users", { method: "GET" });
}

function row(email: string, role: string) {
  return { email, name: null, picture_url: null, role, created_at: "", last_login_at: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ ok: true, role: "admin", email: ACTOR });
  setUserRole.mockResolvedValue("ok");
  // Matches the real catalog today (every role in lib/rbac/roles.ts is
  // enabled: true) so existing PATCH behavior is unchanged by this mock.
  assignableRoles.mockReturnValue(["admin", "client", "sales", "pending"]);
});

describe("GET /api/admin/users", () => {
  it("refuses a caller without users.manage", async () => {
    requirePermission.mockResolvedValue({ ok: false, status: 403, error: "nope" });
    const res = await GET(get());
    expect(res.status).toBe(403);
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("returns the roster and the acting admin's own email for a permitted caller", async () => {
    const users = [row(MAIN_ADMIN_EMAIL, "admin"), row(ACTOR, "admin")];
    listUsers.mockResolvedValue(users);
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = await res.json();
    // actorEmail is what the UI uses to disable the acting admin's own row --
    // it must come from the session (the guard), not be invented by the route.
    expect(body.actorEmail).toBe(ACTOR);
    expect(body.mainAdminEmail).toBe(MAIN_ADMIN_EMAIL);
    expect(body.assignableRoles).toEqual(["admin", "client", "sales", "pending"]);
    expect(body.users).toEqual(users);
    // Deliberately not asserting on `mode`/`canPersist`: those come from the
    // real (unmocked) supabaseTarget(), which resolves to demo in this test
    // environment. Mocking lib/pipeline/server just to pin those two fields
    // would weaken the test for no real coverage gain, so they're left alone.
  });

  it("returns 200 with an empty roster rather than treating it as an error", async () => {
    listUsers.mockResolvedValue([]);
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toEqual([]);
    expect(body.usersError).toBeFalsy();
  });

  it("returns 200 with usersError: true when the query itself failed, not a 500", async () => {
    // A failed query against a *configured* Supabase must not be reported as
    // "nobody has signed in yet" -- the page still has to render and explain
    // itself, so this stays a 200 with an explicit flag rather than an error
    // status or a silently empty roster.
    listUsers.mockResolvedValue("error");
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.users).toEqual([]);
    expect(body.usersError).toBe(true);
  });
});

describe("PATCH /api/admin/users — authorization", () => {
  it("refuses a caller without users.manage", async () => {
    requirePermission.mockResolvedValue({ ok: false, status: 403, error: "nope" });
    const res = await PATCH(patch({ email: "x@apmgservices.com.au", role: "sales" }));
    expect(res.status).toBe(403);
    expect(setUserRole).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/users — user list read failure", () => {
  it("503s and never calls setUserRole when listUsers() can't be read, instead of 404ing as an unknown user", async () => {
    // The important pin: a read failure must not fall through to the
    // "not a console user yet" 404 -- that would misreport a broken backend
    // as an unknown address. This is checked before the existence check.
    listUsers.mockResolvedValue("error");
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", role: "sales" }));
    expect(res.status).toBe(503);
    expect(setUserRole).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/users — lockout protections", () => {
  it("refuses to demote the main admin", async () => {
    listUsers.mockResolvedValue([row(MAIN_ADMIN_EMAIL, "admin"), row(ACTOR, "admin")]);
    const res = await PATCH(patch({ email: MAIN_ADMIN_EMAIL, role: "sales" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "main-admin" });
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("refuses to change your own role", async () => {
    listUsers.mockResolvedValue([row(MAIN_ADMIN_EMAIL, "admin"), row(ACTOR, "admin")]);
    const res = await PATCH(patch({ email: ACTOR, role: "sales" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "self" });
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("refuses to demote the last remaining admin", async () => {
    const solo = "solo@apmgservices.com.au";
    listUsers.mockResolvedValue([row(solo, "admin")]);
    requirePermission.mockResolvedValue({ ok: true, role: "admin", email: "other@apmgservices.com.au" });
    const res = await PATCH(patch({ email: solo, role: "sales" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "last-admin" });
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("allows a normal change and lowercases the email", async () => {
    listUsers.mockResolvedValue([
      row(MAIN_ADMIN_EMAIL, "admin"),
      row(ACTOR, "admin"),
      row("nicole@apmgservices.com.au", "pending"),
    ]);
    const res = await PATCH(patch({ email: "Nicole@APMGServices.com.au", role: "sales" }));
    expect(res.status).toBe(200);
    expect(setUserRole).toHaveBeenCalledWith("nicole@apmgservices.com.au", "sales");
  });
});

describe("PATCH /api/admin/users — validation", () => {
  beforeEach(() => {
    listUsers.mockResolvedValue([
      row(MAIN_ADMIN_EMAIL, "admin"),
      row(ACTOR, "admin"),
      row("nicole@apmgservices.com.au", "pending"),
    ]);
  });

  it("rejects a role outside the catalog", async () => {
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", role: "superuser" }));
    expect(res.status).toBe(400);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("rejects a role that is an inherited object property", async () => {
    // isRole must be an own-property check; "constructor" must not pass.
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", role: "constructor" }));
    expect(res.status).toBe(400);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("rejects a role that isRole() accepts but assignableRoles() excludes", async () => {
    // Every role in lib/rbac/roles.ts is enabled: true today, so this branch
    // is currently unreachable through the real catalog -- there is no role
    // that passes isRole() and fails assignableRoles(). This test forces that
    // combination via the assignableRoles mock (see module setup above) so
    // the route's own enforcement of the business rule -- not just the type
    // check -- is locked in for the day a role is disabled, rather than
    // pretending the real catalog can exercise it yet.
    assignableRoles.mockReturnValue(["admin", "client", "pending"]); // "sales" excluded
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", role: "sales" }));
    expect(res.status).toBe(400);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("rejects a missing or non-string email", async () => {
    expect((await PATCH(patch({ role: "sales" }))).status).toBe(400);
    expect((await PATCH(patch({ email: 42, role: "sales" }))).status).toBe(400);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("404s an address that is not a known user", async () => {
    const res = await PATCH(patch({ email: "ghost@apmgservices.com.au", role: "sales" }));
    expect(res.status).toBe(404);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON body", async () => {
    const req = new Request("http://local/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect((await PATCH(req)).status).toBe(400);
  });
});

describe("PATCH /api/admin/users — store outcomes", () => {
  beforeEach(() => {
    listUsers.mockResolvedValue([
      row(MAIN_ADMIN_EMAIL, "admin"),
      row(ACTOR, "admin"),
      row("nicole@apmgservices.com.au", "pending"),
    ]);
  });

  it("reports a row that vanished between read and write", async () => {
    setUserRole.mockResolvedValue("missing");
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", role: "sales" }));
    expect(res.status).toBe(404);
  });

  it("reports a store error", async () => {
    setUserRole.mockResolvedValue("error");
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", role: "sales" }));
    expect(res.status).toBe(500);
  });

  it("reports demo mode rather than pretending to persist", async () => {
    setUserRole.mockResolvedValue("demo");
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", role: "sales" }));
    expect(res.status).toBe(503);
  });
});
