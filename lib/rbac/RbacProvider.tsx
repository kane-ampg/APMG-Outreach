"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { type Permission } from "./permissions";
import { ROLES, primaryRole, rolesCan, type Role } from "./roles";

interface RbacValue {
  /** Effective roles: what they hold, or the single role of an authorised
   *  view-as preview. Enforcement reads THIS, via `can`. */
  roles: Role[];
  /** Most capable effective role, for surfaces that can show only one.
   *  `null` when they hold none. Never consulted by `can`. */
  role: Role | null;
  /** "Admin", or "Admin + Sales" when they hold more than one. */
  roleLabel: string;
  can: (perm: Permission) => boolean;
  /** What app_users actually says this user holds. The view-as switcher and
   *  banner key off THESE, never off `roles` — otherwise an admin previewing a
   *  role that itself lacks roles.viewas (every non-admin role) would have
   *  no way back to their own console. */
  trueRoles: Role[];
  trueRole: Role | null;
  /** Whether this user may preview the console as another role. */
  canViewAs: boolean;
  /**
   * The role currently being previewed, or null when they are simply
   * themselves.
   *
   * Derived here rather than in each consumer, because "am I previewing?" is
   * no longer the one-line `role !== trueRole` it was when a user had exactly
   * one role — an admin who also holds Sales differs from their preview in
   * SET, not in primary role, and that comparison is easy to get subtly wrong
   * in three separate places.
   */
  previewing: Role | null;
}

/** Set equality — same members, order and duplicates irrelevant. */
function sameRoles(a: readonly Role[], b: readonly Role[]): boolean {
  return a.length === b.length && a.every((r) => b.includes(r));
}

const RbacContext = createContext<RbacValue | null>(null);

/**
 * Provides the current user's roles + permission checks. Both `roles` and
 * `trueRoles` come straight from the server-resolved session (see
 * lib/rbac/server.ts's resolveSession) — middleware guarantees a valid
 * session exists before this ever mounts, so there is no unauthenticated or
 * client-editable state here.
 *
 * A user holds a SET of roles and can do anything any of them allows, so `can`
 * is the union (`rolesCan`). `role`/`trueRole` are display derivations for the
 * places that can only render one, and are deliberately NOT what any access
 * decision reads — a component that gates on `role === "admin"` would hide
 * things from somebody who legitimately holds admin alongside another role.
 */
export function RbacProvider({
  roles,
  trueRoles,
  children,
}: {
  roles: Role[];
  trueRoles: Role[];
  children: ReactNode;
}) {
  const value = useMemo<RbacValue>(
    () => ({
      roles,
      role: primaryRole(roles),
      roleLabel: roles.length > 0 ? roles.map((r) => ROLES[r].label).join(" + ") : "No access",
      can: (perm: Permission) => rolesCan(roles, perm),
      trueRoles,
      trueRole: primaryRole(trueRoles),
      canViewAs: rolesCan(trueRoles, "roles.viewas"),
      // A preview always collapses to exactly one role (effectiveRoles), so
      // the primary of the effective set IS the previewed role.
      previewing: sameRoles(roles, trueRoles) ? null : primaryRole(roles),
    }),
    [roles, trueRoles],
  );

  return <RbacContext.Provider value={value}>{children}</RbacContext.Provider>;
}

export function useRbac(): RbacValue {
  const ctx = useContext(RbacContext);
  if (!ctx) throw new Error("useRbac must be used within <RbacProvider>");
  return ctx;
}

export function useCan(perm: Permission): boolean {
  return useRbac().can(perm);
}
