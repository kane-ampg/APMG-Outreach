"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { useRbac } from "@/lib/rbac/RbacProvider";
import { requestViewAs } from "@/lib/rbac/viewAs";
import { ROLES, type Role } from "@/lib/rbac/roles";

// The whole catalog, admin first as the way back to the real console.
// Selecting the role you already lead with clears the preview rather than
// setting a viewAs claim (see selectRole), so it is an alternative to
// ViewAsBanner's Exit, not a no-op.
const PREVIEW_ROLES: readonly Role[] = ["admin", "sales", "client"];

/**
 * Lets an admin preview the console as ONE other role. A preview is
 * deliberately single-role even for a user who holds several: the point is to
 * see what a colleague with that one role sees.
 *
 * Rendering here is a UI convenience only — POST /api/auth/view-as re-checks
 * rolesCan(trueRoles, "roles.viewas") itself, so a forged request from a
 * non-admin is refused regardless of what this component does or doesn't show.
 */
export function RoleSwitcher() {
  const { previewing, trueRole, canViewAs } = useRbac();
  const [pending, setPending] = useState(false);

  if (!canViewAs) return null;

  async function selectRole(next: Role) {
    setPending(true);
    // Picking the role they normally lead with means "stop previewing", so
    // send null (exit) rather than a viewAs claim — which also restores every
    // OTHER role they hold, instead of pinning them to just this one.
    const ok = await requestViewAs(next === trueRole ? null : next);
    if (!ok) setPending(false);
  }

  return (
    <div className="rounded-md border border-dashed border-border bg-background/40 p-1.5">
      <div className="mb-1 px-1 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        View as
      </div>
      <div className="flex gap-1">
        {PREVIEW_ROLES.map((r) => {
          const def = ROLES[r];
          // While previewing, the previewed role is active. Otherwise the one
          // they lead with — a user holding Admin + Sales is not "in" either
          // preview, and highlighting both would suggest they were.
          const isActive = previewing ? r === previewing : r === trueRole;
          return (
            <button
              key={r}
              type="button"
              disabled={pending}
              onClick={() => selectRole(r)}
              data-track="view_as_switch"
              data-track-role={r}
              aria-pressed={isActive}
              title={def.description}
              className={cn(
                "flex-1 rounded px-1.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors",
                isActive
                  ? "bg-primary-solid text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
                pending && "cursor-not-allowed opacity-60",
              )}
            >
              {def.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
