"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Briefcase,
  ChevronDown,
  Clock,
  Loader2,
  MousePointerClick,
  PhoneCall,
  Plus,
  ShieldCheck,
  UserCog,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ROLES, type Role } from "@/lib/rbac/roles";
import { sectionGrantsForRole } from "@/lib/rbac/sections";
import {
  DORMANT_AFTER_DAYS,
  SIGN_IN_LABEL,
  exactTime,
  lastSignIn,
  signInStatus,
  type SignInStatus,
} from "@/lib/auth/signIn";
import type { Person } from "./types";
import { displayName, initialsFor } from "./types";

/**
 * The right pane: what the selected person holds, and what each role unlocks.
 *
 * Roles here are single-select — `app_users.role` is one column — so this is a
 * radio, not a checkbox list, despite looking like the multi-role reference it
 * is modelled on. "Revoke" therefore means "set to pending", which is the
 * documented way to withdraw access while keeping sign-in history.
 *
 * `pending` gets no card of its own. As a card it would read as a fourth thing
 * to grant, when it is really the absence of the other three, so it surfaces as
 * the revoked banner instead.
 */

const ROLE_ICON: Record<Role, LucideIcon> = {
  admin: ShieldCheck,
  sales: PhoneCall,
  client: Briefcase,
  pending: Clock,
};

export function RoleAssignments({
  person,
  actorEmail,
  mainAdminEmail,
  assignableRoles,
  defaultRoleOnSignIn,
  savingRole,
  onAssign,
}: {
  person: Person | null;
  actorEmail: string;
  mainAdminEmail: string;
  assignableRoles: readonly Role[];
  defaultRoleOnSignIn: Role;
  /** The role currently being written, so only its own button spins. */
  savingRole: Role | null;
  onAssign: (person: Person, role: Role) => void;
}) {
  const grantableRoles = useMemo(
    () => assignableRoles.filter((r) => r !== "pending"),
    [assignableRoles],
  );

  const [expanded, setExpanded] = useState<ReadonlySet<Role>>(new Set());

  // Re-open on the newly selected person's active role. Keyed on the email so
  // switching people resets the accordion; without this, expanding Admin for
  // one person would leave Admin open for the next, which reads as if the next
  // person held it.
  const activeRole = person?.role ?? null;
  useEffect(() => {
    setExpanded(activeRole && activeRole !== "pending" ? new Set([activeRole]) : new Set());
  }, [person?.email, activeRole]);

  if (!person) {
    return (
      <div className="flex min-h-[20rem] flex-col items-center justify-center gap-3 rounded-xl bg-card p-8 text-center ring-1 ring-foreground/10">
        <MousePointerClick className="h-6 w-6 text-muted-foreground" aria-hidden />
        <p className="text-sm font-medium text-foreground">Pick someone to manage</p>
        <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
          Choose a person on the left to see the role they hold and what it
          unlocks.
        </p>
      </div>
    );
  }

  const isMain = person.email === mainAdminEmail;
  const isSelf = person.email === actorEmail;
  const lockReason = isMain
    ? "The protected main admin can't be changed."
    : isSelf
      ? "You can't change your own role."
      : null;

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <UserCog className="h-4 w-4 text-muted-foreground" aria-hidden />
        <span className="text-[13px] font-medium text-foreground">Role assignments</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/30 px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary-solid text-xs font-semibold text-primary-foreground">
          {initialsFor(person)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-foreground">
              {displayName(person)}
            </span>
            {isMain && <Badge variant="secondary">Main admin</Badge>}
            {isSelf && <Badge variant="outline">You</Badge>}
          </div>
          <div className="mt-px truncate font-mono text-[11px] text-muted-foreground">
            {person.email}
          </div>
        </div>
      </div>

      <SignInDetail person={person} />

      {lockReason && (
        <p className="border-b border-border bg-background/60 px-4 py-2 text-[11px] text-muted-foreground">
          {lockReason} The buttons below are disabled to match what the server
          would answer.
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Roles
        </p>
        <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
          One role per person. Assigning a new one replaces the current role.
        </p>

        <StatusStrip person={person} defaultRoleOnSignIn={defaultRoleOnSignIn} />

        <div className="mt-3 flex flex-col gap-2">
          {grantableRoles.map((role) => (
            <RoleCard
              key={role}
              role={role}
              active={person.role === role}
              locked={lockReason !== null}
              saving={savingRole === role}
              anySaving={savingRole !== null}
              expanded={expanded.has(role)}
              onToggle={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(role)) next.delete(role);
                  else next.add(role);
                  return next;
                })
              }
              onAssign={() => onAssign(person, role)}
              onRevoke={() => onAssign(person, "pending")}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The sign-in record: status, the exact last sign-in, and when the account
 * first appeared.
 *
 * Absolute timestamps here, relative ones in the list. The list is for
 * scanning ("who has gone quiet?"); this pane is where an admin decides
 * whether to revoke someone, and "47d ago" is not a defensible basis for that
 * while "23 Jun 2026, 4:12 pm" is.
 *
 * Every line is derived from `app_users.last_login_at` / `created_at`. Nothing
 * here reports a live session, because nothing in this app tracks one.
 */
function SignInDetail({ person }: { person: Person }) {
  const status = signInStatus(person.lastLoginAt);
  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-4 py-3">
      <div className="grid grid-cols-[5.5rem_1fr] items-start gap-2">
        <span className="pt-px text-[11px] font-medium text-muted-foreground">Sign-in</span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <SignInPill status={status} />
          {person.lastLoginAt && (
            <span className="text-[11px] text-muted-foreground">
              last {lastSignIn(person.lastLoginAt)}
            </span>
          )}
        </span>
      </div>
      <div className="grid grid-cols-[5.5rem_1fr] items-start gap-2">
        <span className="pt-px text-[11px] font-medium text-muted-foreground">Last sign-in</span>
        <span className="tnum text-[11px] text-foreground">
          {person.lastLoginAt ? (
            exactTime(person.lastLoginAt)
          ) : (
            <span className="text-muted-foreground">
              Never — no sign-in has been recorded for this address.
            </span>
          )}
        </span>
      </div>
      <div className="grid grid-cols-[5.5rem_1fr] items-start gap-2">
        <span className="pt-px text-[11px] font-medium text-muted-foreground">First seen</span>
        <span className="tnum text-[11px] text-foreground">
          {person.createdAt ? (
            <>
              {exactTime(person.createdAt)}
              {person.invitedBy && (
                <span className="text-muted-foreground"> · added by {person.invitedBy}</span>
              )}
            </>
          ) : (
            // No app_users row at all: a colleague the Workspace directory
            // knows about who has never signed in. Saying "unknown" would
            // imply a record we failed to read, when there is simply none yet.
            <span className="text-muted-foreground">
              Not in the console yet — from the Workspace directory.
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

const SIGN_IN_PILL: Record<SignInStatus, string> = {
  active: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  dormant: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  never: "border border-dashed border-border text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
};

function SignInPill({ status }: { status: SignInStatus }) {
  return (
    <span
      title={
        status === "dormant"
          ? `No sign-in in the last ${DORMANT_AFTER_DAYS} days. Their access is unchanged — this is a usage note, not a restriction.`
          : status === "active"
            ? `Signed in within the last ${DORMANT_AFTER_DAYS} days.`
            : status === "unknown"
              ? "This row carries a sign-in timestamp the console couldn't read."
              : undefined
      }
      className={cn(
        "rounded-full px-2 py-0.5 text-[11px] font-semibold",
        SIGN_IN_PILL[status],
      )}
    >
      {SIGN_IN_LABEL[status]}
    </span>
  );
}

/** The two states that are not "holds one of the grantable roles". */
function StatusStrip({
  person,
  defaultRoleOnSignIn,
}: {
  person: Person;
  defaultRoleOnSignIn: Role;
}) {
  if (person.role === "pending") {
    return (
      <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
        <span className="font-semibold">Access revoked.</span> They can still
        sign in and will see the &ldquo;access pending&rdquo; screen. To stop
        them signing in at all, suspend their Google account.
      </p>
    );
  }
  if (!person.role) {
    return (
      <p className="mt-3 rounded-lg border border-dashed border-border bg-background/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        No stored role yet. Signing in with Google would make them{" "}
        <span className="font-semibold text-foreground">
          {ROLES[defaultRoleOnSignIn].label}
        </span>{" "}
        automatically — assign a role below to decide now instead.
      </p>
    );
  }
  return null;
}

function RoleCard({
  role,
  active,
  locked,
  saving,
  anySaving,
  expanded,
  onToggle,
  onAssign,
  onRevoke,
}: {
  role: Role;
  active: boolean;
  locked: boolean;
  saving: boolean;
  anySaving: boolean;
  expanded: boolean;
  onToggle: () => void;
  onAssign: () => void;
  onRevoke: () => void;
}) {
  const def = ROLES[role];
  const Icon = ROLE_ICON[role];
  const grants = sectionGrantsForRole(role);
  const panelId = `role-grants-${role}`;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border transition-colors",
        active ? "border-primary/40 bg-primary/5" : "border-border bg-background/60",
      )}
    >
      <div className="flex flex-wrap items-start gap-3 p-3">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            active ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {active ? (
            <BadgeCheck className="h-4 w-4" aria-hidden />
          ) : (
            <Icon className="h-4 w-4" aria-hidden />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[13px] font-semibold text-foreground">{def.label}</span>
            {active && (
              <span className="rounded-full bg-primary/15 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-primary">
                Active
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {def.description}
          </p>
          <code className="mt-1 block font-mono text-[10px] text-muted-foreground/70">
            {role}
          </code>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {active ? (
            <Button
              variant="destructive"
              size="sm"
              // `anySaving`, not just `saving`: while any write for this person
              // is in flight the whole card set is stale, and a second PATCH
              // would race the first to decide their single role column.
              disabled={locked || anySaving}
              onClick={onRevoke}
              data-track="settings_role_revoke"
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <X className="h-3.5 w-3.5" aria-hidden />
              )}
              Revoke
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={locked || anySaving}
              onClick={onAssign}
              data-track="settings_role_assign"
              className="gap-1.5"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-3.5 w-3.5" aria-hidden />
              )}
              Assign
            </Button>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 border-t border-border/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground"
      >
        What this unlocks
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")}
          aria-hidden
        />
      </button>

      {expanded && (
        <div id={panelId} className="flex flex-col gap-2 border-t border-border/60 px-3 py-2.5">
          {grants.map(({ section, granted, empty }) => (
            <div key={section.key} className="grid grid-cols-[5.5rem_1fr] items-start gap-2">
              <span className="pt-0.5 text-[11px] font-medium text-muted-foreground">
                {section.label}
              </span>
              {empty ? (
                <span className="pt-0.5 text-[11px] text-muted-foreground/60">No access</span>
              ) : (
                <span className="flex flex-wrap gap-1">
                  {granted.map((p) => (
                    <span
                      key={p.perm}
                      title={p.perm}
                      className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground"
                    >
                      {p.short}
                    </span>
                  ))}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
