"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRbac } from "@/lib/rbac/RbacProvider";
import { requestViewAs } from "@/lib/rbac/viewAs";
import { ROLES } from "@/lib/rbac/roles";

/**
 * Keyed off trueRole, not the effective role — an admin previewing any
 * non-admin role (every role but their own) would otherwise have no way
 * back, since none of those roles hold roles.viewas themselves.
 */
export function ViewAsBanner() {
  const { role, trueRole, canViewAs } = useRbac();
  const [exiting, setExiting] = useState(false);

  if (!canViewAs || role === trueRole) return null;

  async function exit() {
    setExiting(true);
    const ok = await requestViewAs(null);
    if (!ok) setExiting(false);
  }

  return (
    <div
      role="status"
      className="relative z-[60] flex shrink-0 items-center justify-center gap-3 bg-primary-solid px-3 py-1.5 text-xs font-medium text-primary-foreground"
    >
      <span>
        Viewing as <span className="font-semibold">{ROLES[role].label}</span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={exiting}
        onClick={exit}
        className="text-primary-foreground hover:bg-primary-foreground/10"
      >
        Exit
      </Button>
    </div>
  );
}
