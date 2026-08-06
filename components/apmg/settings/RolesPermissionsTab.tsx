"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, CloudOff, Loader2, RefreshCw, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { AppUserRow } from "@/lib/auth/userStore";
import { ROLES, type Role } from "@/lib/rbac/roles";
import { Reveal } from "../Reveal";
import { PeopleList } from "./PeopleList";
import { PermissionMatrix } from "./PermissionMatrix";
import { RoleAssignments } from "./RoleAssignments";
import type { Person } from "./types";
import { personFromAppUser } from "./types";

/**
 * Grant and revoke console access.
 *
 * Every rule shown here is mirrored FROM the server, never invented locally:
 * the acting admin, the protected main-admin address, the allowed Workspace
 * domain and the role a first sign-in lands on all arrive in the GET payload,
 * so this component disables the right controls without hardcoding values that
 * could drift from `MAIN_ADMIN_EMAIL`, `GOOGLE_ALLOWED_DOMAIN` or the column
 * default in app-users.sql. Disabled buttons are a courtesy;
 * /api/admin/users is what actually refuses.
 *
 * The GET response shape (`ApiState`) reuses `AppUserRow` via a type-only
 * import rather than hand-duplicating the field list: `import type` is erased
 * at build time, so it pulls no runtime code — and none of the service-role
 * fetch logic in userStore.ts — into this client bundle.
 */

interface ApiState {
  mode: "live" | "demo";
  canPersist: boolean;
  actorEmail: string;
  mainAdminEmail: string;
  allowedDomain: string;
  defaultRoleOnSignIn: Role;
  assignableRoles: Role[];
  users: AppUserRow[];
  usersError?: boolean;
  directory: DirectoryPayload;
}

/** Mirrors `DirectoryResult` in lib/google/directory.ts. Declared rather than
 *  imported: that module is `server-only` and importing its types would be
 *  fine, but importing the module itself from a client component would not —
 *  keeping the shape local removes the chance of that mistake being made
 *  later by autocompletion. */
type DirectoryPayload =
  | { state: "unconfigured"; reason: string }
  | { state: "error"; reason: string }
  | {
      state: "synced";
      people: { email: string; name: string | null; department: string | null }[];
      suspendedHidden: number;
      fetchedAt: string;
    };
type Load =
  | { status: "loading" }
  | { status: "error"; error: string }
  | ({ status: "ready" } & ApiState);

export interface RosterStats {
  directory: number;
  withRoles: number;
  pending: number;
}

export function RolesPermissionsTab({
  onStatsChange,
}: {
  onStatsChange?: (stats: RosterStats) => void;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [selectedEmail, setSelectedEmail] = useState<string | null>(null);
  // Addresses typed into "Add by email" this session. Client-only on purpose:
  // nothing is written until a role is assigned, so an admin who opens the box,
  // mistypes and walks away leaves no half-created row behind. Anyone who DOES
  // get a role comes back from the server on the next refresh as a real row,
  // at which point the merge below stops treating them as custom.
  const [customEmails, setCustomEmails] = useState<ReadonlySet<string>>(new Set());
  const [saving, setSaving] = useState<{ email: string; role: Role } | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async (force = false) => {
    if (force) setRefreshing(true);
    try {
      const res = await fetch(force ? "/api/admin/users?refresh=1" : "/api/admin/users", {
        cache: "no-store",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setLoad({ status: "error", error: body.error ?? `Couldn't load users (${res.status}).` });
        return;
      }
      const data = (await res.json()) as ApiState;
      setLoad({ status: "ready", ...data });
    } catch {
      setLoad({ status: "error", error: "Couldn't reach the server." });
    } finally {
      if (force) setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const people = useMemo<Person[]>(() => {
    if (load.status !== "ready") return [];
    // Precedence is deliberate. app_users first, because a stored role is the
    // fact that matters and must never be shadowed. The directory then fills in
    // colleagues with no row, and enriches the ones that have one with the
    // name and department Google knows and we don't.
    const merged = new Map<string, Person>();
    for (const u of load.users) merged.set(u.email, personFromAppUser(u));

    if (load.directory.state === "synced") {
      for (const d of load.directory.people) {
        const existing = merged.get(d.email);
        if (existing) {
          merged.set(d.email, {
            ...existing,
            name: existing.name ?? d.name,
            department: d.department,
          });
          continue;
        }
        merged.set(d.email, {
          email: d.email,
          name: d.name,
          role: null,
          department: d.department,
          lastLoginAt: null,
          invitedBy: null,
          source: "directory",
        });
      }
    }

    for (const email of customEmails) {
      if (merged.has(email)) continue;
      merged.set(email, {
        email,
        name: null,
        role: null,
        department: null,
        lastLoginAt: null,
        invitedBy: null,
        source: "custom",
      });
    }
    return [...merged.values()];
  }, [load, customEmails]);

  const stats = useMemo<RosterStats>(
    () => ({
      directory: people.length,
      // "With roles" counts real access, so pending — a revocation — is not one.
      withRoles: people.filter((p) => p.role && p.role !== "pending").length,
      pending: people.filter((p) => p.role === "pending").length,
    }),
    [people],
  );

  useEffect(() => {
    onStatsChange?.(stats);
  }, [stats, onStatsChange]);

  // Derived, never stored: after a save the selected person must show their NEW
  // role, and holding a copy of the Person object here would keep rendering the
  // old one until something happened to replace it.
  const selectedPerson = useMemo(
    () => people.find((p) => p.email === selectedEmail) ?? null,
    [people, selectedEmail],
  );

  const addEmail = useCallback(
    (raw: string): string | null => {
      if (load.status !== "ready") return "Still loading.";
      const email = raw.trim().toLowerCase();
      if (!email) return "Enter an email address.";
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return "That doesn't look like an email address.";
      if (!email.endsWith(`@${load.allowedDomain}`)) {
        return `Only @${load.allowedDomain} addresses can be given a role — anyone else is refused at sign-in.`;
      }
      if (people.some((p) => p.email === email)) {
        setSelectedEmail(email);
        return null;
      }
      setCustomEmails((prev) => new Set(prev).add(email));
      setSelectedEmail(email);
      return null;
    },
    [load, people],
  );

  async function assignRole(person: Person, role: Role) {
    setSaving({ email: person.email, role });
    setNotice(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: person.email, role }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; created?: boolean };
      if (!res.ok) {
        setNotice({ kind: "err", text: body.error ?? `Couldn't save (${res.status}).` });
        return;
      }
      setNotice({
        kind: "ok",
        text: body.created
          ? `${person.email} will be ${ROLES[role].label} — the role is waiting for their first sign-in.`
          : `${person.email} is now ${ROLES[role].label}.`,
      });
      await refresh();
    } catch {
      setNotice({ kind: "err", text: "Couldn't reach the server." });
    } finally {
      setSaving(null);
    }
  }

  if (load.status === "loading") {
    return (
      <Reveal delay={0.08}>
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card p-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Loading users…
        </div>
      </Reveal>
    );
  }

  if (load.status === "error") {
    return (
      <Reveal delay={0.08}>
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-6">
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" aria-hidden />
            {load.error}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refresh()} className="mt-4 gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Retry
          </Button>
        </div>
      </Reveal>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {load.mode === "demo" && (
        <Reveal delay={0.06}>
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            <ShieldAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            Supabase isn&rsquo;t configured, so there are no users to show and nothing
            can be saved. This is a local-development state, not a problem with
            anyone&rsquo;s access.
          </p>
        </Reveal>
      )}

      {load.usersError && (
        <Reveal delay={0.06}>
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5">
            <p className="flex items-center gap-2 text-xs font-medium text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              The user list couldn&rsquo;t be read.
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              This isn&rsquo;t &ldquo;nobody has signed in yet&rdquo; — the query against
              Supabase failed, so the roster may be missing real users. If this is a new
              deployment, check that the{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono">
                supabase/app-users.sql
              </code>{" "}
              migration has been applied.
            </p>
          </div>
        </Reveal>
      )}

      {load.directory.state !== "synced" && (
        <Reveal delay={0.06}>
          <div
            className={cn(
              "rounded-lg border px-3 py-2.5",
              load.directory.state === "error"
                ? "border-amber-500/30 bg-amber-500/10"
                : "border-border bg-background/60",
            )}
          >
            <p
              className={cn(
                "flex items-center gap-2 text-xs font-medium",
                load.directory.state === "error"
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-foreground",
              )}
            >
              <CloudOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {load.directory.state === "error"
                ? "The Workspace directory couldn't be read"
                : "Workspace directory sync isn't set up"}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
              This list shows people who have signed in, plus anyone you add by
              email. Colleagues who have never signed in won&rsquo;t appear until
              sync is working. Everything else on this screen works normally.
            </p>
            <code className="mt-1.5 block break-words rounded bg-muted px-1.5 py-1 font-mono text-[10px] text-muted-foreground">
              {load.directory.reason}
            </code>
          </div>
        </Reveal>
      )}

      {notice && (
        <Reveal delay={0.06}>
          <p
            role="status"
            className={cn(
              "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
              notice.kind === "ok"
                ? "border-border bg-background/60 text-foreground"
                : "border-destructive/30 bg-destructive/10 text-destructive",
            )}
          >
            {notice.kind === "ok" ? (
              <Check className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            ) : (
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
            )}
            {notice.text}
          </p>
        </Reveal>
      )}

      <Reveal delay={0.08}>
        {/* Single column until there is room for two full panes side by side.
            Below that the right pane would be too narrow for a role card's
            description plus its buttons, and it stacks instead. */}
        <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2">
          <PeopleList
            people={people}
            selectedEmail={selectedEmail}
            assignableRoles={load.assignableRoles}
            allowedDomain={load.allowedDomain}
            defaultRoleOnSignIn={load.defaultRoleOnSignIn}
            suspendedHidden={
              load.directory.state === "synced" ? load.directory.suspendedHidden : 0
            }
            syncedAt={load.directory.state === "synced" ? load.directory.fetchedAt : null}
            refreshing={refreshing}
            onRefresh={() => void refresh(true)}
            onSelect={(p) => setSelectedEmail(p.email)}
            onAddEmail={addEmail}
          />
          <RoleAssignments
            person={selectedPerson}
            actorEmail={load.actorEmail}
            mainAdminEmail={load.mainAdminEmail}
            assignableRoles={load.assignableRoles}
            defaultRoleOnSignIn={load.defaultRoleOnSignIn}
            savingRole={saving?.email === selectedPerson?.email ? (saving?.role ?? null) : null}
            onAssign={(p, role) => void assignRole(p, role)}
          />
        </div>
      </Reveal>

      <PermissionMatrix />
    </div>
  );
}
