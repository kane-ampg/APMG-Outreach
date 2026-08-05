"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { useRbac } from "@/lib/rbac/RbacProvider";
import { requestViewAs } from "@/lib/rbac/viewAs";
import { ROLES, type Role } from "@/lib/rbac/roles";

// Sales is the role checked most often when previewing, so it's listed
// first. Admin is deliberately excluded from the options: the only audience
// who can ever see this switcher (roleCan(trueRole, "roles.viewas")) IS
// admin, so offering it as a preview target would just be a no-op button —
// ViewAsBanner's Exit is the way back to the real Admin view.
const PREVIEW_ROLES: readonly Role[] = ["sales", "client", "pending"];

/**
 * Lets an admin preview the console as another role. Rendering here is a UI
 * convenience only — POST /api/auth/view-as re-checks roleCan(trueRole,
 * "roles.viewas") itself, so a forged request from a non-admin is refused
 * regardless of what this component does or doesn't show.
 */
export function RoleSwitcher() {
  const { role, canViewAs } = useRbac();
  const [pending, setPending] = useState(false);

  if (!canViewAs) return null;

  async function selectRole(next: Role) {
    setPending(true);
    const ok = await requestViewAs(next);
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
          const isActive = r === role;
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
