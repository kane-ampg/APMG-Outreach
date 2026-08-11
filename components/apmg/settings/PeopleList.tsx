"use client";

import { useMemo, useState } from "react";
import {
  AtSign,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Search,
  UserPlus,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ROLES, type Role } from "@/lib/rbac/roles";
import {
  PRESENCE_WINDOW_MS,
  SIGN_IN_LABEL,
  agoText,
  exactTime,
  lastSeenIso,
  signInStatus,
  type SignInStatus,
} from "@/lib/auth/signIn";
import type { Person } from "./types";
import { displayName, initialsFor, relativeTime } from "./types";

/**
 * The left pane: who exists, and what they currently hold.
 *
 * Selection is the only thing this owns. Every mutation lives in the right
 * pane, so this component stays a pure filter-and-pick surface — which is what
 * lets the whole list re-render from one `people` prop after a save without
 * needing to reconcile any local copy of a role.
 */

const PAGE_SIZE = 10;

/** Holds at least one role. `null` (no stored row) and `[]` (revoked) are both
 *  "no roles" for filtering purposes, even though they read differently. */
function hasAnyRole(person: Person): boolean {
  return (person.roles?.length ?? 0) > 0;
}

export function PeopleList({
  people,
  now,
  selectedEmail,
  assignableRoles,
  allowedDomain,
  defaultRolesOnSignIn,
  suspendedHidden,
  syncedAt,
  refreshing,
  onRefresh,
  onSelect,
  onAddEmail,
}: {
  people: readonly Person[];
  /** Server-frame clock (see useServerClock). Every presence decision on this
   *  screen is made against it, never against Date.now(). */
  now: number;
  selectedEmail: string | null;
  assignableRoles: readonly Role[];
  allowedDomain: string;
  /** What a first sign-in lands on — mirrored from the server, never assumed. */
  defaultRolesOnSignIn: readonly Role[];
  /** Suspended/archived domain accounts the directory left out. */
  suspendedHidden: number;
  /** When the Workspace directory was last read, or null if it wasn't. */
  syncedAt: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  onSelect: (person: Person) => void;
  /** Returns an error message to display, or null when the address was added. */
  onAddEmail: (email: string) => string | null;
}) {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role | "none">("all");
  const [signInFilter, setSignInFilter] = useState<"all" | SignInStatus>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [withRolesOnly, setWithRolesOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [addValue, setAddValue] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  // Only offered when the directory actually populated departments — an empty
  // "All departments" dropdown is a dead control that implies missing data.
  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const p of people) if (p.department) set.add(p.department);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [people]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return people.filter((p) => {
      // `roleFilter` asks "does this person HOLD role X?", which for a set is
      // membership rather than equality — an admin who is also Sales must
      // appear under both.
      if (withRolesOnly && !hasAnyRole(p)) return false;
      if (roleFilter === "none" && hasAnyRole(p)) return false;
      if (roleFilter !== "all" && roleFilter !== "none" && !(p.roles ?? []).includes(roleFilter)) {
        return false;
      }
      if (signInFilter !== "all" && signInStatus(p, now) !== signInFilter) return false;
      if (deptFilter !== "all" && p.department !== deptFilter) return false;
      if (!q) return true;
      return (
        p.email.toLowerCase().includes(q) ||
        (p.name ?? "").toLowerCase().includes(q) ||
        (p.department ?? "").toLowerCase().includes(q)
      );
    });
  }, [people, now, search, roleFilter, signInFilter, deptFilter, withRolesOnly]);

  // Clamp rather than reset: an admin who filters a 4-page list down to 1 page
  // while sitting on page 3 should land on the last page that still has rows,
  // not be silently bounced to the top of an unrelated result set.
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const customCount = people.filter((p) => p.source === "custom").length;
  const withRoles = people.filter(hasAnyRole).length;

  // Counted across the whole roster rather than the current page, because the
  // question these answer — "how many of these accounts is nobody using?" —
  // is asked before any filter is applied, not after.
  const signInCounts = useMemo(() => {
    const counts: Record<SignInStatus, number> = {
      online: 0,
      recent: 0,
      dormant: 0,
      never: 0,
      unknown: 0,
    };
    for (const p of people) counts[signInStatus(p, now)] += 1;
    return counts;
  }, [people, now]);

  function resetToFirstPage<T>(apply: (value: T) => void) {
    return (value: T) => {
      apply(value);
      setPage(1);
    };
  }

  function submitAdd() {
    const error = onAddEmail(addValue);
    if (error) {
      setAddError(error);
      return;
    }
    setAddValue("");
    setAddError(null);
    setAddOpen(false);
    setSearch("");
    setRoleFilter("all");
    setWithRolesOnly(false);
    setPage(1);
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13px] font-medium text-foreground">People</span>
          <span className="tnum rounded-full bg-muted px-1.5 py-px font-mono text-[10px] font-semibold text-muted-foreground">
            {filtered.length} shown
          </span>
          {customCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-1.5 py-px font-mono text-[10px] font-semibold text-primary">
              <AtSign className="h-2.5 w-2.5" aria-hidden />
              {customCount} added
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {syncedAt && (
            <span className="hidden text-[10px] text-muted-foreground sm:inline">
              Synced {relativeTime(syncedAt)}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={refreshing}
            data-track="settings_refresh_directory"
            className="gap-1.5"
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5", refreshing && "animate-spin")}
              aria-hidden
            />
            Refresh
          </Button>
          <Button
            variant={addOpen ? "secondary" : "outline"}
            size="sm"
            onClick={() => setAddOpen((v) => !v)}
            data-track="settings_add_by_email"
            className="gap-1.5"
          >
            <UserPlus className="h-3.5 w-3.5" aria-hidden />
            Add by email
          </Button>
        </div>
      </div>

      {addOpen && (
        <div className="border-b border-border bg-muted/40 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              autoFocus
              value={addValue}
              onChange={(e) => {
                setAddValue(e.target.value);
                setAddError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitAdd();
                if (e.key === "Escape") setAddOpen(false);
              }}
              placeholder={`name@${allowedDomain}`}
              aria-label="Email address to add"
              aria-invalid={addError ? true : undefined}
              className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button size="sm" onClick={submitAdd} disabled={!addValue.trim()}>
              Add
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setAddOpen(false)}
              aria-label="Cancel adding an email"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </div>
          <p
            className={cn(
              "mt-1.5 text-[11px]",
              addError ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {addError ??
              `Adds someone to this list so you can give them a role. Nothing is saved until you assign one.`}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <div className="relative min-w-[10rem] flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            value={search}
            onChange={(e) => resetToFirstPage(setSearch)(e.target.value)}
            placeholder="Search name, email, department…"
            aria-label="Search people"
            className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-2 text-xs text-foreground placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => resetToFirstPage(setRoleFilter)(e.target.value as Role | "all" | "none")}
          aria-label="Filter by role"
          className="h-8 shrink-0 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="all">All roles</option>
          {assignableRoles.map((r) => (
            <option key={r} value={r}>
              {ROLES[r].label}
            </option>
          ))}
          <option value="none">No roles</option>
        </select>
        <select
          value={signInFilter}
          onChange={(e) => resetToFirstPage(setSignInFilter)(e.target.value as "all" | SignInStatus)}
          aria-label="Filter by online and sign-in status"
          className="h-8 shrink-0 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="all">Any status</option>
          <option value="online">Online now ({signInCounts.online})</option>
          <option value="recent">Signed in recently ({signInCounts.recent})</option>
          <option value="dormant">Dormant ({signInCounts.dormant})</option>
          <option value="never">Never signed in ({signInCounts.never})</option>
          {/* Only offered when such a row exists — an option that can only ever
              return nothing reads as a broken filter. */}
          {signInCounts.unknown > 0 && (
            <option value="unknown">Unreadable stamp ({signInCounts.unknown})</option>
          )}
        </select>
        {departments.length > 0 && (
          <select
            value={deptFilter}
            onChange={(e) => resetToFirstPage(setDeptFilter)(e.target.value)}
            aria-label="Filter by department"
            className="h-8 max-w-[9rem] shrink-0 truncate rounded-lg border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="all">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          onClick={() => resetToFirstPage(setWithRolesOnly)(!withRolesOnly)}
          aria-pressed={withRolesOnly}
          className={cn(
            "h-8 shrink-0 rounded-lg border px-2.5 text-xs font-medium transition-colors",
            withRolesOnly
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground hover:text-foreground",
          )}
        >
          With roles {withRoles}
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {pageRows.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted-foreground">
            {people.length === 0
              ? "Nobody has signed in yet. A colleague appears here the first time they sign in with Google — or add them by email to give them a role now."
              : "Nobody matches those filters."}
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5 p-2">
            {pageRows.map((p) => (
              <PersonRow
                key={p.email}
                person={p}
                now={now}
                selected={p.email === selectedEmail}
                defaultRolesOnSignIn={defaultRolesOnSignIn}
                onSelect={() => onSelect(p)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2.5">
        <span className="tnum text-[11px] text-muted-foreground">
          {filtered.length === 0
            ? "No results"
            : `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filtered.length)} of ${filtered.length}`}
          {suspendedHidden > 0 && (
            // Stated rather than silently dropped: an admin looking for someone
            // who has left needs to know the list is filtered, not broken.
            <span className="text-muted-foreground/70">
              {" · "}
              {suspendedHidden} suspended hidden
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon-sm"
            disabled={safePage <= 1}
            onClick={() => setPage(safePage - 1)}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
          </Button>
          <span className="tnum px-1 font-mono text-[11px] text-muted-foreground">
            {safePage} / {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={safePage >= pageCount}
            onClick={() => setPage(safePage + 1)}
            aria-label="Next page"
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

function PersonRow({
  person,
  now,
  selected,
  defaultRolesOnSignIn,
  onSelect,
}: {
  person: Person;
  now: number;
  selected: boolean;
  defaultRolesOnSignIn: readonly Role[];
  onSelect: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected ? "true" : undefined}
        data-track="settings_select_person"
        className={cn(
          "flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
          selected
            ? "border-primary/40 bg-primary/5"
            : "border-transparent bg-background/60 hover:border-border hover:bg-muted/60",
        )}
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-solid text-[11px] font-semibold text-primary-foreground">
          {initialsFor(person)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-foreground">
              {displayName(person)}
            </span>
            {person.source === "custom" && (
              <span className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-primary">
                Added
              </span>
            )}
          </span>
          <span className="mt-px block truncate font-mono text-[11px] text-muted-foreground">
            {person.email}
          </span>
          {person.department && (
            <span className="mt-px block truncate text-[10px] text-muted-foreground/80">
              {person.department}
            </span>
          )}
          <SignInLine person={person} now={now} />
        </span>
        <RoleChips person={person} defaultRolesOnSignIn={defaultRolesOnSignIn} />
      </button>
    </li>
  );
}

/**
 * Dot colours.
 *
 * GREEN IS RESERVED FOR `online` AND NOTHING ELSE. Every other state is a
 * statement about the past and is coloured like one — someone who signed in an
 * hour ago is grey, not green, because they are not here now. `never` is
 * hollow rather than grey-filled: an account nobody has ever used is an
 * absence, not a quieter grade of activity.
 */
const DOT: Record<SignInStatus, string> = {
  online: "bg-emerald-500",
  recent: "bg-muted-foreground/50",
  dormant: "bg-amber-500",
  never: "border border-muted-foreground/50",
  unknown: "bg-muted-foreground/50",
};

/** Seconds, for the tooltip that explains what green actually promises. */
const PRESENCE_WINDOW_SECONDS = Math.round(PRESENCE_WINDOW_MS / 1000);

/**
 * The status line under each row: "Online now", or "Signed in · 2h ago".
 *
 * `Online now` comes from a heartbeat sent by an open console tab within the
 * last PRESENCE_WINDOW_SECONDS, and from nothing else — a sign-in five seconds
 * ago still reads grey. The tooltip states the window out loud so the claim
 * can be checked rather than trusted.
 */
function SignInLine({ person, now }: { person: Person; now: number }) {
  const status = signInStatus(person, now);
  const online = status === "online";
  const seen = lastSeenIso(person);
  return (
    <span
      className={cn(
        "mt-1 flex items-center gap-1.5 text-[10px]",
        online ? "font-medium text-emerald-700 dark:text-emerald-400" : "text-muted-foreground",
      )}
      title={
        online
          ? `Has the console open — last heartbeat ${exactTime(person.lastSeenAt)}. Goes grey within ${PRESENCE_WINDOW_SECONDS}s of the tab closing.`
          : seen
            ? `Last seen ${exactTime(seen)}. Not on the console now.`
            : "No sign-in has ever been recorded for this address."
      }
    >
      <span
        className={cn(
          "h-1.5 w-1.5 shrink-0 rounded-full",
          DOT[status],
          // Only the live state moves. A pulsing dot reads as "happening now",
          // so anything else wearing it would be the same lie as the colour.
          online && "animate-pulse",
        )}
        aria-hidden
      />
      <span className="truncate">
        {SIGN_IN_LABEL[status]}
        {status !== "never" && !online && ` · ${agoText(seen, now)}`}
      </span>
    </span>
  );
}

/**
 * The roles column, and the one place this screen has to be careful about
 * telling the truth.
 *
 * THREE STATES, NOT TWO. Somebody with no `app_users` row has no roles, but
 * they are NOT revoked: `roles` defaults to Sales, so the moment they sign in
 * with Google they become a rep. Somebody whose row exists with an EMPTY set
 * is the opposite — an admin took their access away. Rendering both as "No
 * roles" would be a lie an admin could reasonably act on, so each says what it
 * actually means.
 */
function RoleChips({
  person,
  defaultRolesOnSignIn,
}: {
  person: Person;
  defaultRolesOnSignIn: readonly Role[];
}) {
  if (person.roles === null) {
    return (
      <span className="shrink-0 whitespace-nowrap rounded-full border border-dashed border-border px-1.5 py-px text-[10px] font-medium text-muted-foreground">
        {defaultRolesOnSignIn.map((r) => ROLES[r].label).join(" + ") || "No roles"} on first sign-in
      </span>
    );
  }
  if (person.roles.length === 0) {
    return (
      <span className="shrink-0 whitespace-nowrap rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
        No access
      </span>
    );
  }
  return (
    <span className="flex shrink-0 flex-wrap justify-end gap-1">
      {person.roles.map((r) => (
        <span
          key={r}
          className="whitespace-nowrap rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-foreground"
        >
          {ROLES[r].label}
        </span>
      ))}
    </span>
  );
}
