import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "./permissions";
import {
  ROLES,
  ROLE_ORDER,
  assignableRoles,
  isRole,
  parseRoles,
  permissionsForRole,
  permissionsForRoles,
  primaryRole,
  roleCan,
  rolesCan,
} from "./roles";

/**
 * A user holds a SET of roles, and the empty set is the revoked state. These
 * tests exist mostly to pin the two directions that matter: the union must
 * actually add up, and nothing must be reachable from no roles at all.
 */

describe("the catalog", () => {
  it("is exactly the three real jobs — there is no pending role", () => {
    expect(Object.keys(ROLES).sort()).toEqual(["admin", "client", "sales"]);
    expect(isRole("pending")).toBe(false);
  });

  it("offers all three for assignment", () => {
    expect(assignableRoles().sort()).toEqual(["admin", "client", "sales"]);
  });
});

describe("no roles is the revoked state", () => {
  it("grants nothing whatsoever", () => {
    for (const perm of ALL_PERMISSIONS) {
      expect(rolesCan([], perm)).toBe(false);
    }
    expect(permissionsForRoles([])).toEqual([]);
  });

  it("has no primary role to speak of", () => {
    expect(primaryRole([])).toBeNull();
  });
});

describe("rolesCan — the union", () => {
  it("holds a permission if ANY held role grants it", () => {
    // Sales alone cannot see the whole lead database; admin can. Holding both
    // must resolve to the more capable answer, or granting a second role would
    // silently take something away.
    expect(rolesCan(["sales"], "leads.view")).toBe(false);
    expect(rolesCan(["sales", "admin"], "leads.view")).toBe(true);
  });

  it("adds up two partial roles without either one alone sufficing", () => {
    // client has leads.view, sales has sales.view; neither has both.
    expect(rolesCan(["client"], "sales.view")).toBe(false);
    expect(rolesCan(["sales"], "leads.view")).toBe(false);
    expect(rolesCan(["client", "sales"], "sales.view")).toBe(true);
    expect(rolesCan(["client", "sales"], "leads.view")).toBe(true);
  });

  it("never invents a permission no held role grants", () => {
    // The union may only ever be the sum of its parts. If this ever passes for
    // a permission absent from both catalogs, the union has grown a bug that
    // hands out access nobody assigned.
    for (const perm of ALL_PERMISSIONS) {
      const union = rolesCan(["client", "sales"], perm);
      expect(union).toBe(roleCan("client", perm) || roleCan("sales", perm));
    }
  });

  it("agrees with roleCan for a single role", () => {
    for (const role of ROLE_ORDER) {
      for (const perm of ALL_PERMISSIONS) {
        expect(rolesCan([role], perm)).toBe(roleCan(role, perm));
      }
    }
  });
});

describe("permissionsForRoles", () => {
  it("deduplicates permissions two roles share", () => {
    const union = permissionsForRoles(["client", "sales"]);
    expect(new Set(union).size).toBe(union.length);
    // Both grant leads.export — it must appear exactly once.
    expect(union.filter((p) => p === "leads.export")).toHaveLength(1);
  });

  it("gives admin the whole catalog, with or without company", () => {
    expect(new Set(permissionsForRoles(["admin"]))).toEqual(new Set(ALL_PERMISSIONS));
    expect(new Set(permissionsForRoles(["sales", "admin", "client"]))).toEqual(
      new Set(ALL_PERMISSIONS),
    );
  });
});

describe("primaryRole — for the surfaces that can only pick one", () => {
  it("prefers the most capable role held", () => {
    expect(primaryRole(["sales", "admin"])).toBe("admin");
    expect(primaryRole(["client", "sales"])).toBe("sales");
    expect(primaryRole(["client"])).toBe("client");
  });

  it("does not depend on the order they were stored in", () => {
    expect(primaryRole(["admin", "sales"])).toBe(primaryRole(["sales", "admin"]));
  });
});

describe("parseRoles — the boundary between the database and enforcement", () => {
  it("keeps only real roles, dropping anything else", () => {
    expect(parseRoles(["admin", "wizard", 7, null, "sales"])).toEqual(["admin", "sales"]);
  });

  it("drops the retired pending value rather than treating it as access", () => {
    // Rows written before roles existed could still carry it. It must read as
    // "no role", never as a role that happens to be unknown.
    expect(parseRoles(["pending"])).toEqual([]);
  });

  it("deduplicates", () => {
    expect(parseRoles(["sales", "sales", "admin", "admin"])).toEqual(["admin", "sales"]);
  });

  it("returns canonical order regardless of input order", () => {
    expect(parseRoles(["client", "sales", "admin"])).toEqual(ROLE_ORDER.slice());
  });

  it("fails closed on anything that is not an array", () => {
    for (const bogus of [null, undefined, "admin", 42, {}]) {
      expect(parseRoles(bogus)).toEqual([]);
    }
  });

  it("rejects inherited Object.prototype members", () => {
    // The same prototype-chain hazard isRole guards: these must never survive
    // parsing into an enforced role set.
    expect(parseRoles(["constructor", "toString", "__proto__", "valueOf"])).toEqual([]);
  });
});

describe("roles.viewas", () => {
  it("is held by admin only", () => {
    expect(rolesCan(["admin"], "roles.viewas")).toBe(true);
    expect(rolesCan(["sales"], "roles.viewas")).toBe(false);
    expect(rolesCan(["client"], "roles.viewas")).toBe(false);
    expect(rolesCan(["client", "sales"], "roles.viewas")).toBe(false);
    expect(rolesCan([], "roles.viewas")).toBe(false);
  });
});

describe("isRole", () => {
  it("rejects inherited Object.prototype members", () => {
    // `in` walks the prototype chain, so these all look like keys of ROLES
    // even though none of them was ever assigned as one. A signed JWT's
    // viewAs claim is attacker-controlled, so this guard must use an
    // own-property check, not `in`.
    for (const bogus of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
      expect(isRole(bogus)).toBe(false);
    }
  });

  it("still accepts every real role", () => {
    for (const role of ["admin", "client", "sales"] as const) {
      expect(isRole(role)).toBe(true);
    }
  });

  it("accepts exactly what permissionsForRole can answer for", () => {
    for (const role of ROLE_ORDER) {
      expect(isRole(role)).toBe(true);
      expect(permissionsForRole(role).length).toBeGreaterThan(0);
    }
  });
});
