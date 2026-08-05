# Google SSO + RBAC — Phase 2 (Roles and Permissions tab) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins a Settings → Roles and Permissions tab that grants and revokes console access, so roles stop requiring hand-written SQL.

**Architecture:** A new `SettingsPage` with a sub-tab bar hosts a user table backed by a new `/api/admin/users` route (GET list, PATCH change role), both guarded on `users.manage`. The three lockout protections are enforced **server-side** by `denyRoleChange` — already built and unit-tested in Phase 1 — and mirrored in the UI so the operator sees why a control is disabled rather than discovering it through a 409. A read-only permission matrix is generated from the RBAC catalog so it cannot drift.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, `motion` for the tab pill, Supabase via raw REST + service-role key, vitest, Playwright.

**Source spec:** [`docs/superpowers/specs/2026-08-03-google-sso-rbac-design.md`](../specs/2026-08-03-google-sso-rbac-design.md) §7

**Phase 1 (merged, 28 commits) is a hard prerequisite** and supplies everything this phase composes.

## Why this phase matters more than it looks

Phase 1 deliberately shipped no way to grant a role. Combined with `getUserRole` failing closed to `pending`, that means **today the only route to a working account is running SQL by hand** — and if `supabase/app-users.sql` has not been applied, every user including the protected main admin lands on the Access Pending screen with no self-service exit. This phase is what removes that dependency. Build it as the operator's recovery tool, not as a nicety.

## Global Constraints

- **Every mutation is authorised server-side.** The UI mirrors server rules for clarity; it is never the enforcement point. A disabled dropdown is a courtesy, not a control.
- **The three lockout protections are non-negotiable** and all live in `denyRoleChange` (`lib/auth/policy.ts`, already tested): the main admin `kane@apmgservices.com.au` can never be demoted; nobody can change their own role; the last remaining admin cannot be demoted.
- Emails are **lowercased** before every read and write.
- `users.manage` gates both the API route and the tab. It already exists in the catalog and is held by `admin` only.
- **Never alter customer-portal behaviour** (`/portal`, `/t/*`, `/api/portal/*`).
- **Never weaken Phase 1's guards.** Nothing under `middleware.ts`, `lib/auth/session.ts`, `lib/auth/policy.ts` or `lib/rbac/server.ts` should need changing. If you think it does, stop and ask.
- Revoking access = setting the user to `pending`. It preserves login history. Note in UI copy that `pending` still permits sign-in (they see the pending screen); **absolute lockout is suspending the Google account.**
- The repo has **no ESLint**. Gates are `npx tsc --noEmit`, `npx next build`, `npx vitest run`, `npx playwright test`.
- **A green build is not sufficient evidence on this codebase.** Nine defects in Phase 1 passed every static gate, including one total site outage. Every task that touches a rendered surface or a route must be verified with a real HTTP request.
- Playwright's config pins port **3100**. Ports 3000/3001 are held by unrelated projects — never kill them.
- `requirePermission` is **async**. Always `const guard = await requirePermission(req, "…"); if (!guard.ok) return guardResponse(guard);`. An un-awaited call in a boolean context compiles silently and permits everything; there is no lint rule to catch it.

## What Phase 1 already provides

| Thing | Where | Note |
|---|---|---|
| `denyRoleChange({actorEmail, targetEmail, nextRole, adminEmails})` | `lib/auth/policy.ts` | Returns `"main-admin" \| "self" \| "last-admin" \| null`. Fully unit-tested. **Do not reimplement any of these rules in the route or the UI.** |
| `MAIN_ADMIN_EMAIL` | `lib/auth/policy.ts` | `kane@apmgservices.com.au` |
| `requirePermission` / `guardResponse` | `lib/rbac/server.ts` | Guard returns `{ok:true, role, email}` — the `email` is the acting admin, needed for the self-demotion check |
| `getUserRole`, `upsertOnLogin` | `lib/auth/userStore.ts` | This phase adds `listUsers` and `setUserRole`, deliberately deferred from Phase 1 |
| `ROLES`, `PERMISSIONS`, `assignableRoles()`, `permissionLabel()`, `isRole()` | `lib/rbac/*` | The matrix is generated from these |
| `supabaseTarget()` | `lib/pipeline/server.ts` | Returns `{state:"demo"}` when Supabase is unconfigured |
| Animated tablist pattern (`LanePill`) | `components/apmg/HotLeadsPage.tsx:179` | Reuse its shape for the sub-tab bar |
| `Can` | `components/rbac/Can.tsx` | Permission-gated rendering |
| `Table`/`TableHeader`/`TableBody`/`TableRow`/`TableHead`/`TableCell`, `Badge`, `Button` | `components/ui/` | No other UI primitives exist — no Select, no Dialog. Use a native `<select>` styled to match. |
| `mode`/`canPersist` API convention | `components/apmg/LegalDocsPage.tsx` | Follow it so demo mode degrades legibly |

## File Structure

| File | Responsibility |
|---|---|
| `lib/auth/userStore.ts` | **Modify.** Add `AppUserRow`, `listUsers()`, `setUserRole()` |
| `app/api/admin/users/route.ts` | **Create.** GET list + PATCH role change, both `users.manage`; PATCH applies `denyRoleChange` |
| `app/api/admin/users/route.test.ts` | **Create.** The lockout protections, at the route layer |
| `components/apmg/SettingsPage.tsx` | **Create.** Sub-tab shell; hosts the tab below |
| `components/apmg/settings/RolesPermissionsTab.tsx` | **Create.** User table + role dropdown + protections surfaced |
| `components/apmg/settings/PermissionMatrix.tsx` | **Create.** Read-only role × permission grid |
| `components/apmg/DashboardShell.tsx` | **Modify.** Route `settings` to `SettingsPage` instead of `ComingSoon` |
| `tests/e2e/admin-users.spec.ts` | **Create.** Route is unreachable anonymously; tab absent for non-admins |

---

### Task 1: userStore — list and update

**Files:**
- Modify: `lib/auth/userStore.ts`

**Interfaces:**
- Consumes: `supabaseTarget` (`lib/pipeline/server.ts`), `isRole`/`Role` (`lib/rbac/roles.ts`), `MAIN_ADMIN_EMAIL` (`lib/auth/policy.ts`) — all already imported there
- Produces:
  - `interface AppUserRow { email: string; name: string | null; picture_url: string | null; role: Role; created_at: string; last_login_at: string | null }`
  - `listUsers(): Promise<AppUserRow[]>`
  - `setUserRole(email: string, role: Role): Promise<"ok" | "demo" | "missing" | "error">`

- [ ] **Step 1: Add the row type and the two functions**

Append to `lib/auth/userStore.ts`, after `upsertOnLogin`:

```ts
export interface AppUserRow {
  email: string;
  name: string | null;
  picture_url: string | null;
  role: Role;
  created_at: string;
  last_login_at: string | null;
}

/**
 * Every console user, most-recent sign-in first. Rows whose stored role is not
 * in the catalog are coerced to `pending` rather than dropped — an operator
 * needs to SEE a row with a bad role in order to fix it, and hiding it would
 * make the account invisible while it still exists.
 */
export async function listUsers(): Promise<AppUserRow[]> {
  const target = supabaseTarget();
  if (target.state !== "ok") return [];
  try {
    const res = await fetch(
      `${target.base}/rest/v1/${TABLE}?select=email,name,picture_url,role,created_at,last_login_at&order=last_login_at.desc.nullslast`,
      { headers: authHeaders(target.key), cache: "no-store" },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[auth] app_users list ${res.status}:`, detail.slice(0, 500));
      return [];
    }
    const rows = (await res.json().catch(() => [])) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        email: typeof row.email === "string" ? row.email : "",
        name: typeof row.name === "string" ? row.name : null,
        picture_url: typeof row.picture_url === "string" ? row.picture_url : null,
        role: isRole(row.role) ? row.role : "pending",
        created_at: typeof row.created_at === "string" ? row.created_at : "",
        last_login_at: typeof row.last_login_at === "string" ? row.last_login_at : null,
      };
    }).filter((r) => r.email !== "");
  } catch (e) {
    console.error("[auth] app_users list failed:", e);
    return [];
  }
}

/**
 * Change one user's role.
 *
 * Callers MUST have run `denyRoleChange` first — this function deliberately
 * enforces nothing, so that every lockout rule lives in exactly one tested
 * place instead of being half-checked in two.
 *
 * Returns "missing" when the filter matched no row, which is why the PATCH uses
 * `return=representation`: a silent no-op on a typo'd address would otherwise
 * look identical to success.
 */
export async function setUserRole(
  email: string,
  role: Role,
): Promise<"ok" | "demo" | "missing" | "error"> {
  const target = supabaseTarget();
  if (target.state !== "ok") return "demo";
  try {
    const res = await fetch(
      `${target.base}/rest/v1/${TABLE}?email=eq.${encodeURIComponent(email.trim().toLowerCase())}`,
      {
        method: "PATCH",
        headers: {
          ...authHeaders(target.key),
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ role }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[auth] app_users role update ${res.status}:`, detail.slice(0, 500));
      return "error";
    }
    const rows = (await res.json().catch(() => [])) as unknown;
    return Array.isArray(rows) && rows.length > 0 ? "ok" : "missing";
  } catch (e) {
    console.error("[auth] app_users role update failed:", e);
    return "error";
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: 0 errors. If `isRole` or `Role` is reported unused-or-missing, check the existing import block at the top of the file — both are already imported for `getUserRole`.

- [ ] **Step 3: Commit**

```bash
git add lib/auth/userStore.ts
git commit -m "Add listUsers and setUserRole to the user store

Deferred out of Phase 1 deliberately, because nothing called them then.
setUserRole enforces no rules of its own -- every lockout rule stays in
denyRoleChange, which is already unit-tested -- and uses
return=representation so a typo'd address reports \"missing\" instead of
looking like a successful no-op."
```

---

### Task 2: The admin users API route

**Files:**
- Create: `app/api/admin/users/route.ts`
- Test: `app/api/admin/users/route.test.ts`

**Interfaces:**
- Consumes: `requirePermission`/`guardResponse` (`lib/rbac/server.ts`), `listUsers`/`setUserRole` (Task 1 — the `AppUserRow` type is inferred, not imported), `denyRoleChange`/`MAIN_ADMIN_EMAIL`/`RoleChangeDenial` (`lib/auth/policy.ts`), `isRole`/`assignableRoles` (`lib/rbac/roles.ts`), `sameOrigin`/`supabaseTarget` (`lib/pipeline/server.ts`)
- Produces: `GET /api/admin/users` → `{ mode, canPersist, actorEmail, mainAdminEmail, assignableRoles, users }`; `PATCH /api/admin/users` → `{ ok: true }` or an error with 400/404/409/500

**Note on `vitest.config.ts`:** its `include` is `["lib/**/*.test.ts"]`, so a test under `app/` will NOT run. Widen it to `["lib/**/*.test.ts", "app/**/*.test.ts"]` as part of this task, and confirm `npx vitest run` picks the new file up.

- [ ] **Step 1: Write the failing test**

Create `app/api/admin/users/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const listUsers = vi.fn();
const setUserRole = vi.fn();
const requirePermission = vi.fn();

vi.mock("@/lib/auth/userStore", () => ({
  listUsers: (...a: unknown[]) => listUsers(...a),
  setUserRole: (...a: unknown[]) => setUserRole(...a),
}));

vi.mock("@/lib/rbac/server", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requirePermission: (...a: unknown[]) => requirePermission(...a),
  };
});

import { MAIN_ADMIN_EMAIL } from "@/lib/auth/policy";
import { PATCH } from "./route";

const ACTOR = "boss@apmgservices.com.au";

/** A PATCH request the sameOrigin floor will accept (no Origin header). */
function patch(body: unknown): Request {
  return new Request("http://local/api/admin/users", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function row(email: string, role: string) {
  return { email, name: null, picture_url: null, role, created_at: "", last_login_at: null };
}

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ ok: true, role: "admin", email: ACTOR });
  setUserRole.mockResolvedValue("ok");
});

describe("PATCH /api/admin/users — authorization", () => {
  it("refuses a caller without users.manage", async () => {
    requirePermission.mockResolvedValue({ ok: false, status: 403, error: "nope" });
    const res = await PATCH(patch({ email: "x@apmgservices.com.au", role: "sales" }));
    expect(res.status).toBe(403);
    expect(setUserRole).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/admin/users — lockout protections", () => {
  it("refuses to demote the main admin", async () => {
    listUsers.mockResolvedValue([row(MAIN_ADMIN_EMAIL, "admin"), row(ACTOR, "admin")]);
    const res = await PATCH(patch({ email: MAIN_ADMIN_EMAIL, role: "sales" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "main-admin" });
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("refuses to change your own role", async () => {
    listUsers.mockResolvedValue([row(MAIN_ADMIN_EMAIL, "admin"), row(ACTOR, "admin")]);
    const res = await PATCH(patch({ email: ACTOR, role: "sales" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "self" });
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("refuses to demote the last remaining admin", async () => {
    const solo = "solo@apmgservices.com.au";
    listUsers.mockResolvedValue([row(solo, "admin")]);
    requirePermission.mockResolvedValue({ ok: true, role: "admin", email: "other@apmgservices.com.au" });
    const res = await PATCH(patch({ email: solo, role: "sales" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ reason: "last-admin" });
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("allows a normal change and lowercases the email", async () => {
    listUsers.mockResolvedValue([
      row(MAIN_ADMIN_EMAIL, "admin"),
      row(ACTOR, "admin"),
      row("nicole@apmgservices.com.au", "pending"),
    ]);
    const res = await PATCH(patch({ email: "Nicole@APMGServices.com.au", role: "sales" }));
    expect(res.status).toBe(200);
    expect(setUserRole).toHaveBeenCalledWith("nicole@apmgservices.com.au", "sales");
  });
});

describe("PATCH /api/admin/users — validation", () => {
  beforeEach(() => {
    listUsers.mockResolvedValue([
      row(MAIN_ADMIN_EMAIL, "admin"),
      row(ACTOR, "admin"),
      row("nicole@apmgservices.com.au", "pending"),
    ]);
  });

  it("rejects a role outside the catalog", async () => {
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", role: "superuser" }));
    expect(res.status).toBe(400);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("rejects a role that is an inherited object property", async () => {
    // isRole must be an own-property check; "constructor" must not pass.
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", role: "constructor" }));
    expect(res.status).toBe(400);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("rejects a missing or non-string email", async () => {
    expect((await PATCH(patch({ role: "sales" }))).status).toBe(400);
    expect((await PATCH(patch({ email: 42, role: "sales" }))).status).toBe(400);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("404s an address that is not a known user", async () => {
    const res = await PATCH(patch({ email: "ghost@apmgservices.com.au", role: "sales" }));
    expect(res.status).toBe(404);
    expect(setUserRole).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON body", async () => {
    const req = new Request("http://local/api/admin/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    expect((await PATCH(req)).status).toBe(400);
  });
});

describe("PATCH /api/admin/users — store outcomes", () => {
  beforeEach(() => {
    listUsers.mockResolvedValue([
      row(MAIN_ADMIN_EMAIL, "admin"),
      row(ACTOR, "admin"),
      row("nicole@apmgservices.com.au", "pending"),
    ]);
  });

  it("reports a row that vanished between read and write", async () => {
    setUserRole.mockResolvedValue("missing");
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", role: "sales" }));
    expect(res.status).toBe(404);
  });

  it("reports a store error", async () => {
    setUserRole.mockResolvedValue("error");
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", role: "sales" }));
    expect(res.status).toBe(500);
  });

  it("reports demo mode rather than pretending to persist", async () => {
    setUserRole.mockResolvedValue("demo");
    const res = await PATCH(patch({ email: "nicole@apmgservices.com.au", role: "sales" }));
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: Widen the vitest include, then run the test to see it fail**

In `vitest.config.ts`, change `include` to:

```ts
    include: ["lib/**/*.test.ts", "app/**/*.test.ts"],
```

Run: `npx vitest run app/api/admin/users/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write the route**

Create `app/api/admin/users/route.ts`:

```ts
import { guardResponse, requirePermission } from "@/lib/rbac/server";
import { MAIN_ADMIN_EMAIL, denyRoleChange, type RoleChangeDenial } from "@/lib/auth/policy";
import { listUsers, setUserRole } from "@/lib/auth/userStore";
import { assignableRoles, isRole } from "@/lib/rbac/roles";
import { sameOrigin, supabaseTarget } from "@/lib/pipeline/server";

/**
 * Console user administration for the Settings → Roles and Permissions tab.
 *
 *   GET   → every user, plus the facts the UI needs to disable the right
 *           controls (who is acting, who the protected main admin is).
 *   PATCH → change one user's role.
 *
 * Both require `users.manage` (admin only). The three lockout protections are
 * applied by `denyRoleChange` — the single tested implementation — and are NOT
 * re-derived here or in the UI. The UI disables controls purely as a courtesy;
 * this route is the enforcement point.
 */
export const runtime = "nodejs";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** Operator-facing copy for each refusal. Keyed so the UI can style by reason. */
const DENIAL: Record<Exclude<RoleChangeDenial, null>, string> = {
  "main-admin": `${MAIN_ADMIN_EMAIL} is the protected main admin and cannot be changed. This is deliberate — it is the account that can always recover access.`,
  self: "You can't change your own role. Ask another admin, so nobody can lock themselves out.",
  "last-admin": "This is the only admin left. Promote someone else to admin first, or there would be no way back in.",
};

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: "Bad origin" }, 403);

  const guard = await requirePermission(req, "users.manage");
  if (!guard.ok) return guardResponse(guard);

  const users = await listUsers();
  const configured = supabaseTarget().state === "ok";
  return json({
    // Mirrors the convention in LegalDocsPage: say plainly when nothing can be
    // saved, rather than showing an empty table that looks like "no users".
    mode: configured ? "live" : "demo",
    canPersist: configured,
    actorEmail: guard.email,
    mainAdminEmail: MAIN_ADMIN_EMAIL,
    assignableRoles: assignableRoles(),
    users,
  });
}

export async function PATCH(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: "Bad origin" }, 403);

  const guard = await requirePermission(req, "users.manage");
  if (!guard.ok) return guardResponse(guard);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const raw = (body ?? {}) as { email?: unknown; role?: unknown };

  if (typeof raw.email !== "string" || !raw.email.trim()) {
    return json({ error: "An email address is required." }, 400);
  }
  // isRole is an own-property check, so inherited names like "constructor"
  // cannot slip through as a role here.
  if (!isRole(raw.role)) {
    return json({ error: "Unknown role." }, 400);
  }
  const email = raw.email.trim().toLowerCase();
  const nextRole = raw.role;

  // One read serves both the existence check and the admin census that
  // denyRoleChange needs, so the two can never disagree with each other.
  const users = await listUsers();
  if (!users.some((u) => u.email === email)) {
    return json({ error: "That address is not a console user yet. They must sign in once first." }, 404);
  }

  const denial = denyRoleChange({
    actorEmail: guard.email,
    targetEmail: email,
    nextRole,
    adminEmails: users.filter((u) => u.role === "admin").map((u) => u.email),
  });
  if (denial) return json({ error: DENIAL[denial], reason: denial }, 409);

  const result = await setUserRole(email, nextRole);
  if (result === "demo") {
    return json({ error: "Supabase isn't configured, so this can't be saved." }, 503);
  }
  if (result === "missing") {
    return json({ error: "That user no longer exists." }, 404);
  }
  if (result === "error") {
    return json({ error: "Couldn't save the change. Please try again." }, 500);
  }
  return json({ ok: true, email, role: nextRole });
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run app/api/admin/users/route.test.ts`
Expected: PASS — 13 tests.

Then `npx vitest run` and confirm the total is **82** (69 from Phase 1 + 13 new) and that 6 files are collected.

- [ ] **Step 5: Confirm the route rejects anonymous callers for real**

Run `npx next build`, then `npm run dev` and (using the port Next reports):

```bash
curl -s -o /dev/null -w 'GET  %{http_code}\n' http://localhost:<port>/api/admin/users
curl -s -o /dev/null -w 'PATCH %{http_code}\n' -X PATCH -H 'Content-Type: application/json' \
  -d '{"email":"x@apmgservices.com.au","role":"admin"}' http://localhost:<port>/api/admin/users
```

Expected: both **401** (middleware catches them before the route guard — belt and braces is intentional). Stop the server.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/users/ vitest.config.ts
git commit -m "Add the admin users API with lockout protections

GET lists users plus the facts the UI needs to disable the right controls;
PATCH changes a role. Both require users.manage.

All three lockout rules come from denyRoleChange, the single already-tested
implementation -- the route re-derives none of them. One listUsers read
serves both the existence check and the admin census so they cannot
disagree. Widened the vitest include so route tests under app/ run."
```

---

### Task 3: Settings page shell

**Files:**
- Create: `components/apmg/SettingsPage.tsx`
- Modify: `components/apmg/DashboardShell.tsx`

**Interfaces:**
- Consumes: `useRbac` (`lib/rbac/RbacProvider.tsx`), `Reveal`, `Footer`
- Produces: `<SettingsPage />`, rendered for `activeTab === "settings"`

- [ ] **Step 1: Create the shell with its sub-tab bar**

Create `components/apmg/SettingsPage.tsx`:

```tsx
"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ShieldCheck, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useRbac } from "@/lib/rbac/RbacProvider";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";
import { RolesPermissionsTab } from "./settings/RolesPermissionsTab";

/**
 * Settings. One sub-tab today (Roles and Permissions); the tablist exists so
 * adding the next one is a data change rather than a restructure.
 *
 * The tab is gated on `users.manage`, so a non-admin who somehow reaches
 * Settings sees an explanation rather than an empty frame. Enforcement is on
 * the API route — this is presentation.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

type SubTab = "roles";

export function SettingsPage() {
  const { can } = useRbac();
  const [tab, setTab] = useState<SubTab>("roles");
  const reduce = useReducedMotion() ?? false;
  const [pendingCount, setPendingCount] = useState(0);

  if (!can("users.manage")) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6">
        <Reveal>
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <ShieldCheck className="mx-auto mb-3 h-6 w-6 text-muted-foreground" aria-hidden />
            <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">
              Settings
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Managing users and roles needs administrator access. Ask an admin if
              you need something changed here.
            </p>
          </div>
        </Reveal>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <Reveal>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <SettingsIcon className="h-4 w-4 text-primary" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">
              Settings
            </h1>
            <p className="text-xs text-muted-foreground">
              Who can sign in to this console, and what each role may do.
            </p>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.04}>
        <div
          role="tablist"
          aria-label="Settings sections"
          className="inline-flex gap-1 rounded-lg bg-background/60 p-1 ring-1 ring-foreground/10"
        >
          <SubTabPill
            active={tab === "roles"}
            reduce={reduce}
            label="Roles and Permissions"
            count={pendingCount}
            onSelect={() => setTab("roles")}
          />
        </div>
      </Reveal>

      {tab === "roles" && <RolesPermissionsTab onPendingCountChange={setPendingCount} />}

      <Footer />
    </div>
  );
}

/**
 * Same animated pill as the Hot Leads lane tabs (HotLeadsPage's `LanePill`),
 * with the count shown only when there is something to act on — a permanent
 * "0" reads as a tally rather than a to-do.
 */
function SubTabPill({
  active,
  reduce,
  label,
  count,
  onSelect,
}: {
  active: boolean;
  reduce: boolean;
  label: string;
  count: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      data-track="settings_subtab"
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
        active ? "text-white" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active && (
        <motion.span
          layoutId="settings-subtab-pill"
          className="absolute inset-0 rounded-md bg-gradient-to-r from-primary to-primary-solid shadow-sm shadow-primary/25"
          transition={{ duration: reduce ? 0 : 0.28, ease: EASE }}
        />
      )}
      <span className="relative z-10">{label}</span>
      {count > 0 && (
        <span
          className={cn(
            "tnum relative z-10 rounded-full px-1.5 py-px font-mono text-[10px] font-semibold",
            active ? "bg-white/20 text-white" : "bg-amber-500/20 text-amber-600 dark:text-amber-400",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Wire it into the shell**

In `components/apmg/DashboardShell.tsx`, add the import alongside the other page imports:

```tsx
import { SettingsPage } from "./SettingsPage";
```

Then, in the `activeTab` chain, add a `settings` branch **before** the final `<ComingSoon />` fallback:

```tsx
                ) : activeTab === "settings" ? (
                  <SettingsPage />
```

Leave the `ComingSoon` fallback in place — other tabs may still use it.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npx next build`
Expected: both clean. It will fail until Task 4 creates `RolesPermissionsTab` — so create that file first if you are doing these in one pass, or accept the single unresolved-import error and complete Task 4 before committing. **Do not commit a non-compiling tree.**

- [ ] **Step 4: Commit (together with Task 4)**

Because the shell imports the tab, these two tasks share one commit. See Task 4 Step 5.

---

### Task 4: Roles and Permissions tab

**Files:**
- Create: `components/apmg/settings/RolesPermissionsTab.tsx`

**Interfaces:**
- Consumes: `GET`/`PATCH /api/admin/users` (Task 2); `ROLES` (`lib/rbac/roles.ts`); `Table*`, `Badge`, `Button`
- Produces: `<RolesPermissionsTab onPendingCountChange={(n:number)=>void} />`

- [ ] **Step 1: Create the tab**

Create `components/apmg/settings/RolesPermissionsTab.tsx`:

```tsx
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
 */

interface ApiUser {
  email: string;
  name: string | null;
  picture_url: string | null;
  role: Role;
  created_at: string;
  last_login_at: string | null;
}
interface ApiState {
  mode: "live" | "demo";
  canPersist: boolean;
  actorEmail: string;
  mainAdminEmail: string;
  assignableRoles: Role[];
  users: ApiUser[];
}
type Load =
  | { status: "loading" }
  | { status: "error"; error: string }
  | ({ status: "ready" } & ApiState);

function initialsFor(u: ApiUser): string {
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
  const [savingEmail, setSavingEmail] = useState<string | null>(null);
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
    setSavingEmail(email);
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
      setSavingEmail(null);
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

          {load.users.length === 0 ? (
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
                    const locked = isMain || isSelf || !load.canPersist;
                    const reason = isMain
                      ? "The protected main admin can't be changed."
                      : isSelf
                        ? "You can't change your own role."
                        : !load.canPersist
                          ? "Supabase isn't configured."
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
                            disabled={locked || savingEmail === u.email}
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
                          {savingEmail === u.email && (
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
```

- [ ] **Step 2: Typecheck and build**

Run: `npx tsc --noEmit && npx next build`
Expected: clean once Task 5's `PermissionMatrix` exists. Create Task 5's file before this passes.

- [ ] **Step 3: Verify it renders for real**

`npm run dev`, then confirm `/` still redirects to `/login` unauthenticated and `/portal` is 200. Rendering the tab itself needs an admin session — if you cannot obtain one (Supabase `app_users` may be unprovisioned), say so plainly rather than claiming you saw it.

- [ ] **Step 4: Commit Tasks 3, 4 and 5 together**

They form one compiling unit (shell imports tab imports matrix).

```bash
git add components/apmg/SettingsPage.tsx components/apmg/settings/ components/apmg/DashboardShell.tsx
git commit -m "Add Settings with a Roles and Permissions tab

Grants and revokes console access from the UI, so roles no longer need
hand-written SQL -- which until now was the only way to escape the
fail-closed pending state.

Every rule the UI shows is mirrored from the server payload rather than
reinvented: the acting admin and the protected main-admin address both
arrive in the GET, so no email is hardcoded here. Disabled controls are a
courtesy; /api/admin/users is the enforcement point."
```

---

### Task 5: Permission matrix

**Files:**
- Create: `components/apmg/settings/PermissionMatrix.tsx`

**Interfaces:**
- Consumes: `ROLES`, `assignableRoles`, `roleCan` (`lib/rbac/roles.ts`), `ALL_PERMISSIONS`, `permissionLabel` (`lib/rbac/permissions.ts`)
- Produces: `<PermissionMatrix />`

- [ ] **Step 1: Create it**

Create `components/apmg/settings/PermissionMatrix.tsx`:

```tsx
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
```

- [ ] **Step 2: Verify the four gates**

Run: `npx tsc --noEmit && npx next build && npx vitest run && npx playwright test`
Expected: 0 type errors; build clean; **82** vitest tests; **5** Playwright tests.

- [ ] **Step 3: Commit**

Committed together with Tasks 3 and 4 (see Task 4 Step 4).

---

### Task 6: E2E coverage for the admin surface

**Files:**
- Create: `tests/e2e/admin-users.spec.ts`

**Interfaces:**
- Consumes: the running app via Playwright's `request` fixture
- Produces: `npx playwright test` covering the new route

- [ ] **Step 1: Write the spec**

Create `tests/e2e/admin-users.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

/**
 * The admin user-administration surface is the one that can grant access, so
 * an unauthenticated caller must never reach it — by any method.
 */

test("GET /api/admin/users is unreachable without a session", async ({ request }) => {
  // Playwright's request fixture sends no Origin header, exactly like curl —
  // the case sameOrigin() lets through, and therefore the case that matters.
  const res = await request.get("/api/admin/users");
  expect(res.status()).toBe(401);
  const body = await res.text();
  expect(body).not.toContain("@apmgservices.com.au");
});

test("PATCH /api/admin/users cannot grant a role without a session", async ({ request }) => {
  const res = await request.patch("/api/admin/users", {
    data: { email: "attacker@apmgservices.com.au", role: "admin" },
  });
  expect(res.status()).toBe(401);
});

test("an unknown method on the admin route is not a way in", async ({ request }) => {
  // POST and DELETE are not exported; neither may fall through to a handler.
  for (const res of [
    await request.post("/api/admin/users", { data: {} }),
    await request.delete("/api/admin/users"),
  ]) {
    expect([401, 404, 405]).toContain(res.status());
    expect(await res.text()).not.toContain("@apmgservices.com.au");
  }
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test`
Expected: **8** passing (5 from Phase 1 + 3 new).

- [ ] **Step 3: Full gate run**

Run: `npx tsc --noEmit && npx next build && npx vitest run && npx playwright test`
Expected: clean; 82 vitest; 8 Playwright.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/admin-users.spec.ts
git commit -m "Add E2E coverage for the admin users route

The surface that can grant admin must be unreachable anonymously by any
method, including ones it does not export. Uses the no-Origin request
fixture, since that is the case sameOrigin() permits."
```

---

## Done when

- [ ] `npx tsc --noEmit` clean
- [ ] `npx next build` clean
- [ ] `npx vitest run` — 82 passing
- [ ] `npx playwright test` — 8 passing
- [ ] `GET`/`PATCH /api/admin/users` return 401 with no session
- [ ] Settings → Roles and Permissions lists users, and changing a role persists
- [ ] The main admin's row is badged and its dropdown disabled
- [ ] The acting admin's own row is disabled
- [ ] Demoting the last admin is refused with a readable message, not a stack trace
- [ ] A `pending` user is visually distinct and drives the sub-tab count
- [ ] The permission matrix matches `ROLES` (spot-check `sales` has no `leads.view`)
- [ ] `/portal` still loads with no session

## Explicitly out of scope

- **The view-as switcher** — Phase 3. `effectiveRole` and `roles.viewas` already exist and are tested; nothing here should touch them.
- **Changing what any role may do.** The matrix is read-only by design; permissions are a code change.
- **Deleting users.** Revocation is `pending`; hard deletion would lose sign-in history and the row returns on next login anyway.
- **Inviting users.** A user appears after their first Google sign-in; there is no invite flow and Phase 2 does not add one.
