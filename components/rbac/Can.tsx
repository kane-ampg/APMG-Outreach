"use client";

import { type ReactNode } from "react";
import { useRbac } from "@/lib/rbac/RbacProvider";
import { type Permission } from "@/lib/rbac/permissions";

/**
 * Renders children only when the current role holds `perm`. Optional `fallback`
 * shows when access is denied.
 *
 *   <Can perm="pipeline.import"><ImportButton /></Can>
 */
export function Can({
  perm,
  children,
  fallback = null,
}: {
  perm: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return <>{useRbac().can(perm) ? children : fallback}</>;
}
