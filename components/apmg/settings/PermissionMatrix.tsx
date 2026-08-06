"use client";

import { useId, useState } from "react";
import { Check, ChevronDown, Minus, Table2 } from "lucide-react";
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
 *
 * Collapsed by default now that the role cards above summarise the same facts
 * per section. This stays as the exhaustive answer — every permission by its
 * real key — for when the summary isn't specific enough.
 */
export function PermissionMatrix() {
  const roles = assignableRoles();
  const [open, setOpen] = useState(false);
  const panelId = useId();

  return (
    <Reveal delay={0.12}>
      <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          data-track="settings_permission_matrix"
          className={cn(
            "flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40",
            open && "border-b border-border",
          )}
        >
          <Table2 className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="flex-1 text-[13px] font-medium text-foreground">
            Full permission reference
          </span>
          <span className="tnum rounded-full bg-muted px-1.5 py-px font-mono text-[10px] font-semibold text-muted-foreground">
            {ALL_PERMISSIONS.length}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>

        {open && (
        <div id={panelId} className="overflow-x-auto">
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
        )}

        {open && (
          <p className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
            Generated from the permission catalog in code, so it always matches what
            the server actually enforces. Changing a role&rsquo;s permissions is a code
            change, not a setting.
          </p>
        )}
      </div>
    </Reveal>
  );
}
