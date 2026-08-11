import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listUsers = vi.fn();
const setUserRoles = vi.fn();
const createUserWithRoles = vi.fn();
const requirePermission = vi.fn();
const assignableRoles = vi.fn();

vi.mock("@/lib/auth/userStore", () => ({
  listUsers: (...a: unknown[]) => listUsers(...a),
  setUserRoles: (...a: unknown[]) => setUserRoles(...a),
  createUserWithRoles: (...a: unknown[]) => createUserWithRoles(...a),
  // A literal, not a mock fn: the route only echoes it into the GET payload,
  // and pinning it here means a change to the real column default in
  // app-users.sql shows up as a failing assertion rather than a silent pass.
  DEFAULT_SIGNUP_ROLES: ["sales"],
}));

vi.mock("@/lib/rbac/server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requirePermission: (...a: unknown[]) => requirePermission(...a),
  };
});

// parseRoles (and everything else) stays the real implementation -- the
// "constructor" test below depends on its real own-property check. Only
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

function row(email: string, roles: string[]) {
  return {
    email,
    name: null,
    picture_url: null,
    roles,
    created_at: "",
    last_login_at: null,
    last_seen_at: null,
    invited_by: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({
    ok: true,
    roles: ["admin"],
    role: "admin",
    email: ACTOR,
    trueRoles: ["admin"],
    trueRole: "admin",
    actingAs: null,
  });
  setUserRoles.mockResolvedValue("ok");
  createUserWithRoles.mockResolvedValue("ok");
  // Matches the real catalog today (every role in lib/rbac/roles.ts is
  // enabled: true) so existing PATCH behavior is unchanged by this mock.
  assignableRoles.mockReturnValue(["admin", "sales", "client"]);
});

describe("GET /api/admin/users", () => {
  it("refuses a caller without users.manage", async () => {
    requirePermission.mockResolvedValue({ ok: false, status: 403, error: "nope" });
    const res = await GET(get());
    expect(res.status).toBe(403);
    expect(listUsers).not.toHaveBeenCalled();
  });

  it("returns the roster and the acting admin's own email for a permitted caller", async () => {
    const users = [row(MAIN_ADMIN_EMAIL, ["admin"]), row(ACTOR, ["admin", "sales"])];
    listUsers.mockResolvedValue(users);
    const res = await GET(get());
    expect(res.status).toBe(200);
    const body = await res.json();
    // actorEmail is what the UI uses to disable the acting admin's own row --
    // it must come from the session (the guard), not be invented by the route.
    expect(body.actorEmail).toBe(ACTOR);
    expect(body.mainAdminEmail).toBe(MAIN_ADMIN_EMAIL);
    expect(body.assignableRoles).toEqual(["admin", "sales", "client"]);
    expect(body.users).toEqual(users);
    // Both are mirrored so the client never hardcodes its own copy: the domain
    // gates "Add by email", and the default is what lets the People pane say
    // "Sales on first sign-in" instead of an untrue "no access".
    expect(body.allowedDomain).toBe("apmgservices.com.au");
    expect(body.defaultRolesOnSignIn).toEqual(["sales"]);
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
    const res = await PATCH(patch({ email: "x@apmgservices.com.au", roles: ["sales"] }));
    expect(res.status).toBe(403);
    expect(setUserRoles).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/users — user list read failure", () => {
  it("503s and never calls setUserRoles when listUsers() can't be read, instead of 404ing as an unknown user", async () => {
    // The important pin: a read failure must not fall through to the
    // "not a console user yet" 404 -- that would misreport a broken backend
    // as an unknown address. This is checked before the existence check.
    listUsers.mockResolvedValue("error");
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", roles: ["sales"] }));
    expect(res.status).toBe(503);
    expect(setUserRoles).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/users — lockout protections", () => {
  it("refuses to take Admin away from the main admin", async () => {
    listUsers.mockResolvedValue([row(MAIN_ADMIN_EMAIL, ["admin"]), row(ACTOR, ["admin"])]);
    const res = await PATCH(patch({ email: MAIN_ADMIN_EMAIL, roles: ["sales"] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "main-admin" });
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  it("lets the main admin GAIN a role, since Admin is kept", async () => {
    // The widening case a naive "did the set change?" check would refuse.
    listUsers.mockResolvedValue([row(MAIN_ADMIN_EMAIL, ["admin"]), row(ACTOR, ["admin"])]);
    const res = await PATCH(patch({ email: MAIN_ADMIN_EMAIL, roles: ["admin", "sales"] }));
    expect(res.status).toBe(200);
    expect(setUserRoles).toHaveBeenCalledWith(MAIN_ADMIN_EMAIL, ["admin", "sales"]);
  });

  it("refuses to change your own roles", async () => {
    listUsers.mockResolvedValue([row(MAIN_ADMIN_EMAIL, ["admin"]), row(ACTOR, ["admin"])]);
    const res = await PATCH(patch({ email: ACTOR, roles: ["sales"] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "self" });
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  it("refuses to take Admin from the last remaining admin", async () => {
    const solo = "solo@apmgservices.com.au";
    listUsers.mockResolvedValue([row(solo, ["admin"])]);
    requirePermission.mockResolvedValue({
      ok: true,
      roles: ["admin"],
      role: "admin",
      email: "other@apmgservices.com.au",
      trueRoles: ["admin"],
      trueRole: "admin",
      actingAs: null,
    });
    const res = await PATCH(patch({ email: solo, roles: ["sales"] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "last-admin" });
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  it("refuses to REVOKE the last remaining admin, not just to swap their role", async () => {
    // Clearing the set is the other spelling of the same lockout, and the one
    // a multi-select UI makes easy to reach by unticking.
    const solo = "solo@apmgservices.com.au";
    listUsers.mockResolvedValue([row(solo, ["admin"])]);
    requirePermission.mockResolvedValue({
      ok: true,
      roles: ["admin"],
      role: "admin",
      email: "other@apmgservices.com.au",
      trueRoles: ["admin"],
      trueRole: "admin",
      actingAs: null,
    });
    const res = await PATCH(patch({ email: solo, roles: [] }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "last-admin" });
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  it("counts admins by MEMBERSHIP, so a second admin who also sells still counts", async () => {
    // If the census asked "is their role exactly admin?", this demotion would
    // be refused as a last-admin lockout even though two admins exist.
    listUsers.mockResolvedValue([
      row(MAIN_ADMIN_EMAIL, ["admin"]),
      row("dual@apmgservices.com.au", ["admin", "sales"]),
    ]);
    const res = await PATCH(patch({ email: "dual@apmgservices.com.au", roles: ["sales"] }));
    expect(res.status).toBe(200);
    expect(setUserRoles).toHaveBeenCalledWith("dual@apmgservices.com.au", ["sales"]);
  });

  it("allows a normal change and lowercases the email", async () => {
    listUsers.mockResolvedValue([
      row(MAIN_ADMIN_EMAIL, ["admin"]),
      row(ACTOR, ["admin"]),
      row("nicole@apmgservices.com.au", []),
    ]);
    const res = await PATCH(patch({ email: "Nicole@APMGServices.com.au", roles: ["sales", "client"] }));
    expect(res.status).toBe(200);
    // Canonical order, not submission order — parseRoles normalises so two
    // callers holding the same roles can never disagree about the stored value.
    expect(setUserRoles).toHaveBeenCalledWith("nicole@apmgservices.com.au", ["sales", "client"]);
  });

  it("allows revoking somebody who is not an admin", async () => {
    listUsers.mockResolvedValue([
      row(MAIN_ADMIN_EMAIL, ["admin"]),
      row(ACTOR, ["admin"]),
      row("nicole@apmgservices.com.au", ["sales"]),
    ]);
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", roles: [] }));
    expect(res.status).toBe(200);
    expect(setUserRoles).toHaveBeenCalledWith("nicole@apmgservices.com.au", []);
  });
});

describe("PATCH /api/admin/users — validation", () => {
  beforeEach(() => {
    listUsers.mockResolvedValue([
      row(MAIN_ADMIN_EMAIL, ["admin"]),
      row(ACTOR, ["admin"]),
      row("nicole@apmgservices.com.au", []),
    ]);
  });

  it("rejects a role outside the catalog", async () => {
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", roles: ["superuser"] }));
    expect(res.status).toBe(400);
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  it("rejects the retired 'pending' value rather than silently dropping it", async () => {
    // Old clients (or an old bookmark) could still send it. Saving the rest of
    // the set would quietly grant less than the caller asked for.
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", roles: ["sales", "pending"] }));
    expect(res.status).toBe(400);
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  it("rejects junk mixed in with real roles instead of narrowing the set", async () => {
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", roles: ["admin", "wizard"] }));
    expect(res.status).toBe(400);
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  it("rejects a role that is an inherited object property", async () => {
    // parseRoles must use an own-property check; "constructor" must not pass.
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", roles: ["constructor"] }));
    expect(res.status).toBe(400);
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  it("rejects roles that is not an array at all", async () => {
    expect((await PATCH(patch({ email: "nicole@apmgservices.com.au", roles: "admin" }))).status).toBe(400);
    expect((await PATCH(patch({ email: "nicole@apmgservices.com.au" }))).status).toBe(400);
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  it("rejects a role that isRole() accepts but assignableRoles() excludes", async () => {
    // Every role in lib/rbac/roles.ts is enabled: true today, so this branch
    // is currently unreachable through the real catalog -- there is no role
    // that passes isRole() and fails assignableRoles(). This test forces that
    // combination via the assignableRoles mock (see module setup above) so
    // the route's own enforcement of the business rule -- not just the type
    // check -- is locked in for the day a role is disabled, rather than
    // pretending the real catalog can exercise it yet.
    assignableRoles.mockReturnValue(["admin", "client"]); // "sales" excluded
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", roles: ["sales"] }));
    expect(res.status).toBe(400);
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  it("rejects a missing or non-string email", async () => {
    expect((await PATCH(patch({ roles: ["sales"] }))).status).toBe(400);
    expect((await PATCH(patch({ email: 42, roles: ["sales"] }))).status).toBe(400);
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  // This route used to refuse any address without a row ("they must sign in
  // once first"). Settings now lists the whole Workspace domain, so that
  // refusal would have made most of the list unassignable -- pre-assignment is
  // the point, not an edge case.
  it("creates the row when pre-assigning an on-domain address nobody has signed in with", async () => {
    const res = await PATCH(patch({ email: "ghost@apmgservices.com.au", roles: ["sales", "client"] }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ created: true, roles: ["sales", "client"] });
    expect(createUserWithRoles).toHaveBeenCalledWith({
      email: "ghost@apmgservices.com.au",
      roles: ["sales", "client"],
      invitedBy: ACTOR,
    });
    // There was no row to update, so the update path must not also fire.
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  it("refuses to pre-assign a role to an address outside the Workspace domain", async () => {
    // assertWorkspaceIdentity means such an account can never hold a session,
    // so the row would be permanently unreachable state that reads like access.
    const res = await PATCH(patch({ email: "outsider@gmail.com", roles: ["sales"] }));
    expect(res.status).toBe(400);
    expect(createUserWithRoles).not.toHaveBeenCalled();
    expect(setUserRoles).not.toHaveBeenCalled();
  });

  it("still applies the lockout rules before creating anything", async () => {
    // A brand-new address can't trip any of today's three rules, so this pins
    // the ORDER rather than an outcome: the guard must run first, or a fourth
    // rule added later would be skipped for pre-assigned users.
    const res = await PATCH(patch({ email: ACTOR, roles: ["client"] }));
    expect(res.status).toBe(409);
    expect(createUserWithRoles).not.toHaveBeenCalled();
  });

  it("falls back to setting the roles when another admin created the row first", async () => {
    createUserWithRoles.mockResolvedValue("conflict");
    const res = await PATCH(patch({ email: "ghost@apmgservices.com.au", roles: ["sales"] }));
    expect(res.status).toBe(200);
    expect(setUserRoles).toHaveBeenCalledWith("ghost@apmgservices.com.au", ["sales"]);
  });

  it("reports a failed create rather than claiming success", async () => {
    createUserWithRoles.mockResolvedValue("error");
    const res = await PATCH(patch({ email: "ghost@apmgservices.com.au", roles: ["sales"] }));
    expect(res.status).toBe(500);
    expect(setUserRoles).not.toHaveBeenCalled();
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
      row(MAIN_ADMIN_EMAIL, ["admin"]),
      row(ACTOR, ["admin"]),
      row("nicole@apmgservices.com.au", []),
    ]);
  });

  it("reports a row that vanished between read and write", async () => {
    setUserRoles.mockResolvedValue("missing");
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", roles: ["sales"] }));
    expect(res.status).toBe(404);
  });

  it("reports a store error", async () => {
    setUserRoles.mockResolvedValue("error");
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", roles: ["sales"] }));
    expect(res.status).toBe(500);
  });

  it("reports demo mode rather than pretending to persist", async () => {
    setUserRoles.mockResolvedValue("demo");
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", roles: ["sales"] }));
    expect(res.status).toBe(503);
  });
});
