import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "./permissions";
import { DEFAULT_ROLE, ROLES, isRole, permissionsForRole, roleCan } from "./roles";

describe("pending role", () => {
  it("exists and grants nothing", () => {
    expect(ROLES.pending).toBeDefined();
    expect(permissionsForRole("pending")).toEqual([]);
  });

  it("cannot reach any permission in the catalog", () => {
    for (const perm of ALL_PERMISSIONS) {
      expect(roleCan("pending", perm)).toBe(false);
    }
  });

  it("is assignable, so revoking access means setting it", () => {
    expect(ROLES.pending.enabled).toBe(true);
  });
});

describe("fail-closed default", () => {
  it("defaults to pending, never admin", () => {
    expect(DEFAULT_ROLE).toBe("pending");
  });
});

describe("roles.viewas", () => {
  it("is held by admin only", () => {
    expect(roleCan("admin", "roles.viewas")).toBe(true);
    expect(roleCan("sales", "roles.viewas")).toBe(false);
    expect(roleCan("client", "roles.viewas")).toBe(false);
    expect(roleCan("pending", "roles.viewas")).toBe(false);
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
    for (const role of ["admin", "client", "sales", "pending"] as const) {
      expect(isRole(role)).toBe(true);
    }
  });
});
