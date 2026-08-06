import { describe, expect, it } from "vitest";
import { NAV } from "@/lib/nav";
import { ALL_PERMISSIONS, type Permission } from "./permissions";
import { PERMISSION_SECTIONS, sectionGrantsForRole } from "./sections";
import { assignableRoles, permissionsForRole, roleCan } from "./roles";

const sectioned = PERMISSION_SECTIONS.flatMap((s) => s.permissions.map((p) => p.perm));

describe("permission sections cover the catalog", () => {
  // The "nothing is missing" half of this is a compile error in sections.ts.
  // This is the half a type cannot express: a permission listed TWICE would
  // render in two role-card sections and be double-counted in any tally.
  it("lists every permission exactly once", () => {
    const seen = new Map<Permission, number>();
    for (const perm of sectioned) seen.set(perm, (seen.get(perm) ?? 0) + 1);

    const duplicates = [...seen].filter(([, n]) => n > 1).map(([perm]) => perm);
    expect(duplicates).toEqual([]);
    expect([...seen.keys()].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it("has no empty sections", () => {
    for (const section of PERMISSION_SECTIONS) {
      expect(section.permissions.length).toBeGreaterThan(0);
    }
  });

  it("gives every permission a chip label distinct from its key", () => {
    for (const section of PERMISSION_SECTIONS) {
      for (const { perm, short } of section.permissions) {
        expect(short.trim()).not.toBe("");
        // A short label that is just the raw key means someone added a
        // permission and skipped writing the human-facing half.
        expect(short).not.toBe(perm);
      }
    }
  });
});

describe("section captions track the sidebar", () => {
  // sections.ts duplicates these captions rather than importing NAV (which
  // pulls in lucide icons). That duplication is only safe while this passes:
  // renaming a nav section must fail here, not silently leave Settings
  // describing the app with words the sidebar no longer uses.
  it("matches NAV's captions exactly, in order", () => {
    expect(PERMISSION_SECTIONS.map((s) => s.label)).toEqual(NAV.map((s) => s.caption));
  });
});

describe("sectionGrantsForRole", () => {
  it("agrees with roleCan for every role and permission", () => {
    for (const role of assignableRoles()) {
      const granted = new Set(
        sectionGrantsForRole(role).flatMap((g) => g.granted.map((p) => p.perm)),
      );
      for (const perm of ALL_PERMISSIONS) {
        expect(granted.has(perm)).toBe(roleCan(role, perm));
      }
    }
  });

  it("loses nothing: grants sum to the role's permission count", () => {
    for (const role of assignableRoles()) {
      const total = sectionGrantsForRole(role).reduce((n, g) => n + g.granted.length, 0);
      expect(total).toBe(permissionsForRole(role).length);
    }
  });

  it("marks pending as empty in every section", () => {
    for (const grant of sectionGrantsForRole("pending")) {
      expect(grant.empty).toBe(true);
      expect(grant.granted).toEqual([]);
    }
  });

  it("marks no section empty for admin, which holds everything", () => {
    for (const grant of sectionGrantsForRole("admin")) {
      expect(grant.empty).toBe(false);
    }
  });
});
