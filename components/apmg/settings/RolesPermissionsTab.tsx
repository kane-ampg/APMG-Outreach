"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, ShieldAlert, UserCog } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/cn";
import type { AppUserRow } from "@/lib/auth/userStore";
import { ROLES, type Role } from "@/lib/rbac/roles";
import { Reveal } from "../Reveal";
import { PermissionMatrix } from "./PermissionMatrix";

/**
 * Grant and revoke console access.
 *
 * Every rule shown here is mirrored FROM the server, never invented locally:
 * the acting admin and the protected main-admin address both arrive in the GET
 * payload, so this component disables the right controls without hardcoding an
 * email address that could drift from `MAIN_ADMIN_EMAIL`. A disabled dropdown
 * is a courtesy; /api/admin/users is what actually refuses.
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
  assignableRoles: Role[];
  users: AppUserRow[];
  usersError?: boolean;
}
type Load =
  | { status: "loading" }
  | { status: "error"; error: string }
  | ({ status: "ready" } & ApiState);

function initialsFor(u: AppUserRow): string {
  const source = (u.name ?? u.email.split("@")[0]).trim();
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function whenLast(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export function RolesPermissionsTab({
  onPendingCountChange,
}: {
  onPendingCountChange?: (n: number) => void;
}) {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  // A set, not a single email: a scalar "the row that's saving" would
  // un-disable the FIRST row the instant a SECOND row's change begins (the
  // scalar moves to the new email), letting an admin double-submit a PATCH
  // for a user whose first request is still in flight. Each entry tracks one
  // row's own in-flight save independently.
  const [saving, setSaving] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setLoad({ status: "error", error: body.error ?? `Couldn't load users (${res.status}).` });
        return;
      }
      const data = (await res.json()) as ApiState;
      setLoad({ status: "ready", ...data });
    } catch {
      setLoad({ status: "error", error: "Couldn't reach the server." });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const pendingCount = useMemo(
    () => (load.status === "ready" ? load.users.filter((u) => u.role === "pending").length : 0),
    [load],
  );

  useEffect(() => {
    onPendingCountChange?.(pendingCount);
  }, [pendingCount, onPendingCountChange]);

  async function changeRole(email: string, role: Role) {
    // Functional updates so two overlapping changeRole calls each add/remove
    // their own email without clobbering the other's entry — reading `saving`
    // directly here (instead of via the updater) could lose one of two
    // concurrent adds/removes to a stale closure.
    setSaving((prev) => {
      const next = new Set(prev);
      next.add(email);
      return next;
    });
    setNotice(null);
    try {
      const res = await fetch("/api/admin/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setNotice({ kind: "err", text: body.error ?? `Couldn't save (${res.status}).` });
      } else {
        setNotice({ kind: "ok", text: `${email} is now ${ROLES[role].label}.` });
        await refresh();
      }
    } catch {
      setNotice({ kind: "err", text: "Couldn't reach the server." });
    } finally {
      setSaving((prev) => {
        const next = new Set(prev);
        next.delete(email);
        return next;
      });
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
    <div className="flex flex-col gap-6">
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
        <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <UserCog className="h-4 w-4 text-muted-foreground" aria-hidden />
              <span className="text-[13px] font-medium text-foreground">Console users</span>
              <span className="tnum rounded-full bg-muted px-1.5 py-px font-mono text-[10px] font-semibold text-muted-foreground">
                {load.users.length}
              </span>
            </div>
            <Button variant="outline" size="sm" onClick={() => void refresh()} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
              Refresh
            </Button>
          </div>

          {load.usersError ? (
            <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
              <p className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                The user list couldn&rsquo;t be read.
              </p>
              <p className="max-w-md text-xs text-muted-foreground">
                This isn&rsquo;t &ldquo;nobody has signed in yet&rdquo; — the query
                against Supabase failed, so the roster below may be missing real
                users. If this is a new deployment, check that the{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">
                  supabase/app-users.sql
                </code>{" "}
                migration has been applied and that the{" "}
                <code className="rounded bg-muted px-1 py-0.5 font-mono">app_users</code>{" "}
                table exists.
              </p>
              <Button variant="outline" size="sm" onClick={() => void refresh()} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                Retry
              </Button>
            </div>
          ) : load.users.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted-foreground">
              Nobody has signed in yet. A user appears here the first time they
              sign in with Google, starting on Pending.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Last sign-in</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {load.users.map((u) => {
                    const isMain = u.email === load.mainAdminEmail;
                    const isSelf = u.email === load.actorEmail;
                    // No `!load.canPersist` branch here: listUsers() returns
                    // [] whenever Supabase is unconfigured, so canPersist is
                    // only ever false when this table is empty and this row
                    // can't exist — the demo-mode banner above already
                    // explains that state.
                    const locked = isMain || isSelf;
                    const reason = isMain
                      ? "The protected main admin can't be changed."
                      : isSelf
                        ? "You can't change your own role."
                        : undefined;
                    return (
                      <TableRow key={u.email}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-solid text-[11px] font-semibold text-primary-foreground">
                              {initialsFor(u)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="truncate text-[13px] font-medium text-foreground">
                                  {u.name ?? u.email.split("@")[0]}
                                </span>
                                {isMain && <Badge variant="secondary">Main admin</Badge>}
                                {isSelf && <Badge variant="outline">You</Badge>}
                                {u.role === "pending" && (
                                  <span className="rounded-full bg-amber-500/20 px-1.5 py-px text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                                    Needs a role
                                  </span>
                                )}
                              </div>
                              <div className="mt-px truncate font-mono text-[11px] text-muted-foreground">
                                {u.email}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <select
                            aria-label={`Role for ${u.email}`}
                            value={u.role}
                            disabled={locked || saving.has(u.email)}
                            title={reason}
                            data-track="settings_role_change"
                            onChange={(e) => void changeRole(u.email, e.target.value as Role)}
                            className="h-8 rounded-lg border border-border bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {load.assignableRoles.map((r) => (
                              <option key={r} value={r}>
                                {ROLES[r].label}
                              </option>
                            ))}
                          </select>
                          {saving.has(u.email) && (
                            <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden />
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {whenLast(u.last_login_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="border-t border-border px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
            Setting someone to <strong className="font-semibold text-foreground">Pending</strong>{" "}
            revokes their access while keeping their sign-in history. They can still
            sign in and will see an &ldquo;access pending&rdquo; screen — to stop
            them signing in at all, suspend their Google account.
          </p>
        </div>
      </Reveal>

      <PermissionMatrix />
    </div>
  );
}
