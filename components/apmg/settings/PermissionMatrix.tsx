"use client";

import { Check, Minus, Table2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { ALL_PERMISSIONS, permissionLabel } from "@/lib/rbac/permissions";
import { ROLES, assignableRoles, roleCan } from "@/lib/rbac/roles";
import { Reveal } from "../Reveal";

/**
 * Read-only role × permission grid, generated from the RBAC catalog itself.
 *
 * Deliberately derived rather than written down: a hand-maintained copy of this
 * table would drift from `ROLES` the first time a permission moved, and an
 * out-of-date permissions reference is worse than none — it gets trusted.
 */
export function PermissionMatrix() {
  const roles = assignableRoles();

  return (
    <Reveal delay={0.12}>
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Table2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-[13px] font-medium text-foreground">What each role can do</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium text-muted-foreground">
                  Permission
                </th>
                {roles.map((r) => (
                  <th
                    key={r}
                    scope="col"
                    title={ROLES[r].description}
                    className="whitespace-nowrap px-3 py-2 text-center font-medium text-muted-foreground"
                  >
                    {ROLES[r].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ALL_PERMISSIONS.map((perm) => (
                <tr key={perm} className="border-b border-border/60 last:border-0">
                  <th scope="row" className="px-4 py-1.5 font-normal text-foreground">
                    <span className="font-mono text-[11px] text-muted-foreground">{perm}</span>
                    <span className="ml-2 text-muted-foreground">— {permissionLabel(perm)}</span>
                  </th>
                  {roles.map((r) => {
                    const allowed = roleCan(r, perm);
                    return (
                      <td key={r} className="px-3 py-1.5 text-center">
                        {allowed ? (
                          <Check
                            className="mx-auto h-3.5 w-3.5 text-primary"
                            aria-label={`${ROLES[r].label} can ${perm}`}
                          />
                        ) : (
                          <Minus
                            className={cn("mx-auto h-3.5 w-3.5 text-muted-foreground/40")}
                            aria-label={`${ROLES[r].label} cannot ${perm}`}
                          />
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
          Generated from the permission catalog in code, so it always matches what
          the server actually enforces. Changing a role&rsquo;s permissions is a code
          change, not a setting.
        </p>
      </div>
    </Reveal>
  );
}
