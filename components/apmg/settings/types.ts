import type { AppUserRow } from "@/lib/auth/userStore";
import type { Role } from "@/lib/rbac/roles";

/**
 * One row of the People pane.
 *
 * Deliberately wider than `AppUserRow`, because the pane shows people who have
 * no `app_users` row at all — colleagues pulled from the Workspace directory
 * who have never signed in, and addresses an admin typed into "Add by email"
 * this session. `role: null` means exactly that: no stored row, so no stored
 * role. It is NOT the same as `role: "pending"`, which is a deliberate
 * revocation an admin performed.
 */
export interface Person {
  email: string;
  name: string | null;
  /** `null` when this person has no app_users row yet. */
  role: Role | null;
  department: string | null;
  lastLoginAt: string | null;
  invitedBy: string | null;
  /**
   * `console`  — has an app_users row (signed in, or pre-assigned).
   * `directory`— from the Workspace directory, never signed in.
   * `custom`   — typed into "Add by email" this session; unsaved until a role
   *              is assigned, which is why it vanishes on refresh if left.
   */
  source: "console" | "directory" | "custom";
}

export function personFromAppUser(row: AppUserRow): Person {
  return {
    email: row.email,
    name: row.name,
    role: row.role,
    department: null,
    lastLoginAt: row.last_login_at,
    invitedBy: row.invited_by,
    source: "console",
  };
}

export function displayName(person: Pick<Person, "name" | "email">): string {
  return person.name?.trim() || person.email.split("@")[0];
}

export function initialsFor(person: Pick<Person, "name" | "email">): string {
  const source = displayName(person);
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

/** Compact "how long ago", for timestamps that always exist. */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "just now";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Relative "last seen", or the reason there isn't one. */
export function whenLast(iso: string | null): string {
  if (!iso) return "Never signed in";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}
