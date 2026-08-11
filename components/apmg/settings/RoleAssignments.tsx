"use client";

import { useEffect, useMemo, useState } from "react";
import {
  BadgeCheck,
  Briefcase,
  ChevronDown,
  Loader2,
  MousePointerClick,
  PhoneCall,
  ShieldCheck,
  UserCog,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { ROLES, type Role } from "@/lib/rbac/roles";
import { sectionGrantsForRole } from "@/lib/rbac/sections";
import {
  DORMANT_AFTER_DAYS,
  PRESENCE_WINDOW_MS,
  SIGN_IN_LABEL,
  agoText,
  exactTime,
  signInStatus,
  type SignInStatus,
} from "@/lib/auth/signIn";
import type { Person } from "./types";
import { displayName, initialsFor } from "./types";

/**
 * The right pane: what the selected person holds, and what each role unlocks.
 *
 * Roles are MULTI-SELECT. Each card toggles one role on or off independently,
 * and their access is the union of everything ticked — so adding a role can
 * only ever widen it. Untick the last one and they are revoked; there is no
 * separate "revoked" role to assign, because the empty set is that state.
 *
 * Every toggle submits the WHOLE resulting set rather than a delta, matching
 * what the API accepts: what the admin sees ticked is exactly what gets saved,
 * with no room for the two to disagree.
 */

const ROLE_ICON: Record<Role, LucideIcon> = {
  admin: ShieldCheck,
  sales: PhoneCall,
  client: Briefcase,
};

export function RoleAssignments({
  person,
  now,
  actorEmail,
  mainAdminEmail,
  assignableRoles,
  defaultRolesOnSignIn,
  savingRole,
  onToggleRole,
}: {
  person: Person | null;
  /** Server-frame clock — see useServerClock. */
  now: number;
  actorEmail: string;
  mainAdminEmail: string;
  assignableRoles: readonly Role[];
  defaultRolesOnSignIn: readonly Role[];
  /** The role currently being written, so only its own control spins. */
  savingRole: Role | null;
  /** Turn one role on or off. The caller builds and submits the whole set. */
  onToggleRole: (person: Person, role: Role, next: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<ReadonlySet<Role>>(new Set());

  // Re-open on the roles this person actually holds. Keyed on the email so
  // switching people resets the accordion; without this, expanding Admin for
  // one person would leave Admin open for the next, which reads as if the next
  // person held it.
  const heldKey = (person?.roles ?? []).join(",");
  useEffect(() => {
    setExpanded(new Set(person?.roles ?? []));
    // `heldKey` rather than the array itself: a fresh array arrives on every
    // poll, and depending on its identity would slam the accordion shut every
    // 60 seconds while an admin was reading it.
  }, [person?.email, heldKey]);

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

  const held = person.roles ?? [];
  const isMain = person.email === mainAdminEmail;
  const isSelf = person.email === actorEmail;
  const lockReason = isMain
    ? "The protected main admin must keep the Admin role."
    : isSelf
      ? "You can't change your own roles."
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

      <SignInDetail person={person} now={now} />

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
          Tick every role this person should have. They can do anything any
          ticked role allows, so adding one only ever widens their access.
        </p>

        <StatusStrip person={person} defaultRolesOnSignIn={defaultRolesOnSignIn} />

        <div className="mt-3 flex flex-col gap-2">
          {assignableRoles.map((role) => (
            <RoleCard
              key={role}
              role={role}
              active={held.includes(role)}
              // The last admin keeps Admin, and so does the main admin. Mirrors
              // denyRoleChange rather than re-deriving it — the server is what
              // refuses; this only avoids offering a control that would fail.
              locked={lockReason !== null}
              saving={savingRole === role}
              anySaving={savingRole !== null}
              expanded={expanded.has(role)}
              onExpand={() =>
                setExpanded((prev) => {
                  const next = new Set(prev);
                  if (next.has(role)) next.delete(role);
                  else next.add(role);
                  return next;
                })
              }
              onToggle={(next) => onToggleRole(person, role, next)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The access record: are they here now, when did they last sign in, and when
 * did the account first appear.
 *
 * The three lines are deliberately separate facts, because conflating them is
 * the whole failure mode this pane guards against. "Status" is presence and
 * comes only from a heartbeat; "Last sign-in" is an event in the past and can
 * never colour the status green; "First seen" is provenance.
 *
 * Absolute timestamps here, relative ones in the list. The list is for
 * scanning ("who has gone quiet?"); this pane is where an admin decides
 * whether to revoke someone, and "47d ago" is not a defensible basis for that
 * while "23 Jun 2026, 4:12 pm" is.
 */
function SignInDetail({ person, now }: { person: Person; now: number }) {
  const status = signInStatus(person, now);
  return (
    <div className="flex flex-col gap-1.5 border-b border-border px-4 py-3">
      <div className="grid grid-cols-[5.5rem_1fr] items-start gap-2">
        <span className="pt-px text-[11px] font-medium text-muted-foreground">Status</span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
          <SignInPill status={status} />
          {status === "online" ? (
            <span className="text-[11px] text-muted-foreground">
              console open, beat {agoText(person.lastSeenAt, now)}
            </span>
          ) : (
            person.lastSeenAt && (
              <span className="text-[11px] text-muted-foreground">
                last had the console open {agoText(person.lastSeenAt, now)}
              </span>
            )
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

/** Green belongs to `online` alone — see the DOT map in PeopleList for the
 *  same rule stated on the list side. */
const SIGN_IN_PILL: Record<SignInStatus, string> = {
  online: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  recent: "bg-muted text-foreground",
  dormant: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  never: "border border-dashed border-border text-muted-foreground",
  unknown: "bg-muted text-muted-foreground",
};

const PILL_TITLE: Record<SignInStatus, string | undefined> = {
  online: `A console tab reported in within the last ${Math.round(PRESENCE_WINDOW_MS / 1000)} seconds. Closing the tab clears this on its own — no sign-out needed.`,
  recent: `Signed in within the last ${DORMANT_AFTER_DAYS} days, but not on the console right now.`,
  dormant: `Nothing seen in the last ${DORMANT_AFTER_DAYS} days. Their access is unchanged — this is a usage note, not a restriction.`,
  never: undefined,
  unknown: "This row carries a timestamp the console couldn't read.",
};

function SignInPill({ status }: { status: SignInStatus }) {
  return (
    <span
      title={PILL_TITLE[status]}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
        SIGN_IN_PILL[status],
      )}
    >
      {status === "online" && (
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500" aria-hidden />
      )}
      {SIGN_IN_LABEL[status]}
    </span>
  );
}

/**
 * The two states that are not "holds at least one role".
 *
 * Revoked and never-decided look similar and mean opposite things, so each
 * says which it is. `roles === null` is "no stored row"; `roles === []` is "an
 * admin cleared this".
 */
function StatusStrip({
  person,
  defaultRolesOnSignIn,
}: {
  person: Person;
  defaultRolesOnSignIn: readonly Role[];
}) {
  if (person.roles !== null && person.roles.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
        <span className="font-semibold">Access revoked.</span> They hold no
        roles, so they can still sign in but will see the &ldquo;access
        pending&rdquo; screen. To stop them signing in at all, suspend their
        Google account.
      </p>
    );
  }
  if (person.roles === null) {
    return (
      <p className="mt-3 rounded-lg border border-dashed border-border bg-background/60 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        No stored roles yet. Signing in with Google would make them{" "}
        <span className="font-semibold text-foreground">
          {defaultRolesOnSignIn.map((r) => ROLES[r].label).join(" + ") || "nothing"}
        </span>{" "}
        automatically — tick roles below to decide now instead.
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
  onExpand,
  onToggle,
}: {
  role: Role;
  active: boolean;
  locked: boolean;
  saving: boolean;
  anySaving: boolean;
  expanded: boolean;
  onExpand: () => void;
  onToggle: (next: boolean) => void;
}) {
  const def = ROLES[role];
  const Icon = ROLE_ICON[role];
  const grants = sectionGrantsForRole(role);
  const panelId = `role-grants-${role}`;
  const toggleId = `role-toggle-${role}`;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border transition-colors",
        active ? "border-primary/40 bg-primary/5" : "border-border bg-background/60",
      )}
    >
      {/* The whole header is the label for the switch, so the generous click
          target an admin naturally aims at does the obvious thing. */}
      <label
        htmlFor={toggleId}
        className={cn(
          "flex flex-wrap items-start gap-3 p-3",
          locked || anySaving ? "cursor-not-allowed" : "cursor-pointer",
        )}
      >
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
                Held
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

        <span className="flex shrink-0 items-center gap-2">
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />}
          <input
            id={toggleId}
            type="checkbox"
            role="switch"
            checked={active}
            // `anySaving`, not just `saving`: while any write for this person is
            // in flight every card is stale, and a second PATCH would race the
            // first — each one submits a WHOLE set, so the loser silently
            // reverts the winner's change.
            disabled={locked || anySaving}
            onChange={(e) => onToggle(e.target.checked)}
            data-track={active ? "settings_role_remove" : "settings_role_add"}
            data-track-role={role}
            aria-label={`${def.label} role`}
            className="h-4 w-4 shrink-0 cursor-pointer accent-[var(--primary-solid)] disabled:cursor-not-allowed disabled:opacity-50"
          />
        </span>
      </label>

      <button
        type="button"
        onClick={onExpand}
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
