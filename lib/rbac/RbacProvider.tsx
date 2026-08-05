"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { type Permission } from "./permissions";
import { ROLES, roleCan, type Role } from "./roles";

interface RbacValue {
  /** Effective role: trueRole, or an authorised view-as override. */
  role: Role;
  roleLabel: string;
  can: (perm: Permission) => boolean;
  /** What app_users actually says this user is. The view-as switcher and
   *  banner key off THIS, never off `role` — otherwise an admin previewing a
   *  role that itself lacks roles.viewas (every non-admin role) would have
   *  no way back to their own console. */
  trueRole: Role;
  /** Whether this user may preview the console as another role. */
  canViewAs: boolean;
}

const RbacContext = createContext<RbacValue | null>(null);

/**
 * Provides the current user's role + permission checks. Both `role` and
 * `trueRole` come straight from the server-resolved session (see
 * lib/rbac/server.ts's resolveSession) — middleware guarantees a valid
 * session exists before this ever mounts, so there is no unauthenticated or
 * client-editable state here. (Earlier revisions of this file had a
 * dev-only, unauthenticated role preview; app/page.tsx has unconditionally
 * passed a real, server-resolved role since Phase 1, which made that
 * mechanism permanently unreachable. It's gone — this is the real thing.)
 */
export function RbacProvider({
  role,
  trueRole,
  children,
}: {
  role: Role;
  trueRole: Role;
  children: ReactNode;
}) {
  const value = useMemo<RbacValue>(
    () => ({
      role,
      roleLabel: ROLES[role].label,
      can: (perm: Permission) => roleCan(role, perm),
      trueRole,
      canViewAs: roleCan(trueRole, "roles.viewas"),
    }),
    [role, trueRole],
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
