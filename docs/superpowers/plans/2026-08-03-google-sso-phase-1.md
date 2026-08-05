# Google SSO + RBAC — Phase 1 (The Door and Enforcement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Google Workspace the only door into the APMG admin console, with roles stored in Supabase and enforced server-side on every admin API route.

**Architecture:** A hand-rolled OAuth 2.0 authorization-code flow (PKCE + `state`) exchanges a Google sign-in for a `jose`-signed, `HttpOnly` session cookie carrying **identity only**. Middleware verifies that cookie's signature to prove *authentication* (no DB reads, Edge-safe). *Authorization* happens per request in route handlers, which read the user's role from a new `app_users` table so role changes take effect immediately.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, `jose` (new), Supabase via raw REST + service-role key, `vitest` (new devDep), Playwright (already present).

**Source spec:** [`docs/superpowers/specs/2026-08-03-google-sso-rbac-design.md`](../specs/2026-08-03-google-sso-rbac-design.md)

## Global Constraints

- **Never alter customer-portal behaviour.** `/portal`, `/t/*`, and `/api/portal/*` stay public and unauthenticated. Every middleware change must be checked against the existing customer-host branch in `middleware.ts`.
- **`lib/auth/session.ts` must stay Edge-compatible** — `middleware.ts` imports it. No `import "server-only"`, no Node built-ins, no DB access in that file.
- **Middleware performs no database reads.** It proves authentication only.
- **The old `apmg-role` / `apmg-user` cookies must be deleted, not superseded.** While any code path still reads `apmg-role`, a hand-set cookie is a full authorization bypass.
- Emails are **lowercased** before every read and write.
- Session TTL is **12 hours**. Cookie: `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`. `Lax` is required — `Strict` would strip the cookie on the OAuth callback's cross-site top-level navigation.
- `GOOGLE_ALLOWED_DOMAIN` defaults to `apmgservices.com.au`.
- Main admin is `kane@apmgservices.com.au` and cannot be demoted or deleted.
- The project has **no ESLint config**; the gates are `npx tsc --noEmit`, `npx next build`, and `npx vitest run`.

## Prerequisite (manual, before Task 5 can be verified end-to-end)

In Google Cloud Console under the APMG Workspace tenancy: create an **OAuth 2.0 Client ID** (Web application) with the consent screen set to **Internal**, and register `http://localhost:3000/api/auth/google/callback` plus the production origin's equivalent as Authorized redirect URIs. Then set in `.env.local`:

```
GOOGLE_OAUTH_CLIENT_ID=...
GOOGLE_OAUTH_CLIENT_SECRET=...
AUTH_SECRET=<32+ random bytes, e.g. `openssl rand -base64 32`>
GOOGLE_ALLOWED_DOMAIN=apmgservices.com.au
```

Tasks 1–4 and 6–8 are fully testable without this. Task 5's routes need it for a live sign-in.

## File Structure

| File | Responsibility |
|---|---|
| `vitest.config.ts` | **Create.** Test runner config with the `@/` alias |
| `lib/rbac/permissions.ts` | **Modify.** Add `roles.viewas` |
| `lib/rbac/roles.ts` | **Modify.** Add `pending` role; `DEFAULT_ROLE` → `pending`; fix stale comment |
| `lib/auth/policy.ts` | **Create.** Pure, dependency-free security decisions |
| `supabase/app-users.sql` | **Create.** `app_users` table + main-admin seed |
| `lib/auth/userStore.ts` | **Create.** All `app_users` reads/writes, with demo-mode fallback |
| `lib/auth/session.ts` | **Rewrite.** Sign/verify the session cookie (Edge-safe) |
| `lib/auth/google.ts` | **Create.** Google endpoints, token exchange, `id_token` verification |
| `app/api/auth/google/start/route.ts` | **Create.** Begin the OAuth flow |
| `app/api/auth/google/callback/route.ts` | **Create.** Complete it, mint the session |
| `app/api/auth/signout/route.ts` | **Create.** Clear the session server-side |
| `lib/rbac/server.ts` | **Rewrite.** Async, DB-backed permission guard |
| `middleware.ts` | **Modify.** Authentication gate on the admin host |
| 14 admin route files | **Modify.** Add permission guards |
| `app/login/page.tsx` | **Modify.** Google becomes the primary action |
| `lib/auth/users.ts` | **Delete.** Hardcoded users + shared password |
| `components/apmg/PendingAccess.tsx` | **Create.** "Access pending" screen |
| `app/page.tsx` | **Modify.** Resolve session, route to pending or dashboard |
| `app/layout.tsx` | **Modify.** Read the theme-seed cookie |
| `components/apmg/Sidebar.tsx` | **Modify.** Sign-out POSTs instead of clearing cookies |
| `playwright.config.ts`, `tests/e2e/auth.spec.ts` | **Create.** Gate regression tests |

---

### Task 1: Test infrastructure + RBAC catalog changes

**Files:**
- Create: `vitest.config.ts`
- Modify: `package.json`
- Modify: `lib/rbac/permissions.ts:37`
- Modify: `lib/rbac/roles.ts:1-58`
- Test: `lib/rbac/roles.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: `Role` now includes `"pending"`; `PERMISSIONS` includes `"roles.viewas"`; `DEFAULT_ROLE === "pending"`; `npx vitest run` works with the `@/` alias

- [ ] **Step 1: Install vitest**

```bash
npm install --save-dev vitest
```

- [ ] **Step 2: Create the vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
```

- [ ] **Step 3: Add the test script**

In `package.json`, add to `"scripts"`:

```json
"test": "vitest run"
```

- [ ] **Step 4: Write the failing test**

Create `lib/rbac/roles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ALL_PERMISSIONS } from "./permissions";
import { DEFAULT_ROLE, ROLES, permissionsForRole, roleCan } from "./roles";

describe("pending role", () => {
  it("exists and grants nothing", () => {
    expect(ROLES.pending).toBeDefined();
    expect(permissionsForRole("pending")).toEqual([]);
  });

  it("cannot reach any permission in the catalog", () => {
    for (const perm of ALL_PERMISSIONS) {
      expect(roleCan("pending", perm)).toBe(false);
    }
  });

  it("is assignable, so revoking access means setting it", () => {
    expect(ROLES.pending.enabled).toBe(true);
  });
});

describe("fail-closed default", () => {
  it("defaults to pending, never admin", () => {
    expect(DEFAULT_ROLE).toBe("pending");
  });
});

describe("roles.viewas", () => {
  it("is held by admin only", () => {
    expect(roleCan("admin", "roles.viewas")).toBe(true);
    expect(roleCan("sales", "roles.viewas")).toBe(false);
    expect(roleCan("client", "roles.viewas")).toBe(false);
    expect(roleCan("pending", "roles.viewas")).toBe(false);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `npx vitest run lib/rbac/roles.test.ts`
Expected: FAIL — `ROLES.pending` is undefined and `"roles.viewas"` is not a valid `Permission`.

- [ ] **Step 6: Add the `roles.viewas` permission**

In `lib/rbac/permissions.ts`, add after the `"users.manage"` line (currently line 37):

```ts
  "roles.viewas": "View the console as another role",
```

- [ ] **Step 7: Add the pending role and fix the fail-open default**

In `lib/rbac/roles.ts`, change the `Role` union (line 10):

```ts
export type Role = "admin" | "client" | "sales" | "pending";
```

Add this entry inside the `ROLES` object, after `sales`:

```ts
  pending: {
    label: "Pending",
    description:
      "Signed in, but no access yet — an admin must grant a role. This is where every auto-admitted Workspace account lands.",
    enabled: true,
    permissions: [],
  },
```

Change `DEFAULT_ROLE` (line 54) so any fallback path fails closed:

```ts
/** Fallback role when no session is present. Deliberately powerless: a code
 *  path that cannot resolve a role must grant nothing, not everything. */
export const DEFAULT_ROLE: Role = "pending";
```

Replace the stale block comment at the top of the file (lines 3-9), which claims `sales` is `enabled: false` while the code says `true`:

```ts
/**
 * A role is a named bundle of permissions — nothing more. Enforcement checks
 * permissions, so new roles are pure data and need no logic changes.
 */
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run lib/rbac/roles.test.ts`
Expected: PASS (6 assertions across 5 tests)

- [ ] **Step 9: Typecheck**

Run: `npx tsc --noEmit`

This **will** error: `ROLE_LANDING_TAB` in `lib/nav.ts:118` is typed `Record<Role, TabId>`, so widening `Role` leaves the key missing. Add it:

```ts
  pending: "overview",
```

A pending user never reaches the nav (they get the Access pending screen instead), but the exhaustive `Record` demands the key. Re-run `npx tsc --noEmit` and expect clean.

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json vitest.config.ts lib/rbac/
git commit -m "Add pending role, roles.viewas permission, and vitest

DEFAULT_ROLE flips from admin to pending so any fallback path fails
closed. Also drops the stale comment claiming sales is disabled."
```

---

### Task 2: Pure security policy functions

**Files:**
- Create: `lib/auth/policy.ts`
- Test: `lib/auth/policy.test.ts`

**Interfaces:**
- Consumes: `Role`, `roleCan` from `lib/rbac/roles.ts` (Task 1)
- Produces:
  - `MAIN_ADMIN_EMAIL: string`
  - `assertWorkspaceIdentity(claims, allowedDomain): { ok: true; email: string } | { ok: false; reason: string }`
  - `effectiveRole(trueRole: Role, viewAs: Role | null | undefined): Role`
  - `denyRoleChange(args): RoleChangeDenial`
  - `isSafeNextPath(next: string | null | undefined): boolean`

- [ ] **Step 1: Write the failing test**

Create `lib/auth/policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MAIN_ADMIN_EMAIL,
  assertWorkspaceIdentity,
  denyRoleChange,
  effectiveRole,
  isSafeNextPath,
} from "./policy";

const DOMAIN = "apmgservices.com.au";

describe("assertWorkspaceIdentity", () => {
  it("accepts a verified address on the allowed domain", () => {
    const r = assertWorkspaceIdentity(
      { email: "simon@apmgservices.com.au", email_verified: true },
      DOMAIN,
    );
    expect(r).toEqual({ ok: true, email: "simon@apmgservices.com.au" });
  });

  it("lowercases the address so identity cannot fork on case", () => {
    const r = assertWorkspaceIdentity(
      { email: "Simon@APMGServices.com.au", email_verified: true },
      DOMAIN,
    );
    expect(r).toEqual({ ok: true, email: "simon@apmgservices.com.au" });
  });

  it("rejects another domain", () => {
    const r = assertWorkspaceIdentity(
      { email: "attacker@gmail.com", email_verified: true },
      DOMAIN,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects an unverified address", () => {
    const r = assertWorkspaceIdentity(
      { email: "simon@apmgservices.com.au", email_verified: false },
      DOMAIN,
    );
    expect(r.ok).toBe(false);
  });

  it("rejects a missing address", () => {
    expect(assertWorkspaceIdentity({ email_verified: true }, DOMAIN).ok).toBe(false);
  });

  it("rejects a mismatched hd claim even when the address looks right", () => {
    const r = assertWorkspaceIdentity(
      { email: "simon@apmgservices.com.au", email_verified: true, hd: "elsewhere.com" },
      DOMAIN,
    );
    expect(r.ok).toBe(false);
  });
});

describe("effectiveRole", () => {
  it("returns the true role when not viewing as anything", () => {
    expect(effectiveRole("admin", null)).toBe("admin");
  });

  it("honours viewAs for a role that may impersonate", () => {
    expect(effectiveRole("admin", "sales")).toBe("sales");
  });

  it("IGNORES a forged viewAs from a role that may not impersonate", () => {
    expect(effectiveRole("sales", "admin")).toBe("sales");
    expect(effectiveRole("pending", "admin")).toBe("pending");
  });

  it("is a no-op when viewAs equals the true role", () => {
    expect(effectiveRole("admin", "admin")).toBe("admin");
  });
});

describe("denyRoleChange", () => {
  const base = { actorEmail: "other@apmgservices.com.au", adminEmails: [MAIN_ADMIN_EMAIL, "other@apmgservices.com.au"] };

  it("blocks demoting the main admin", () => {
    expect(
      denyRoleChange({ ...base, targetEmail: MAIN_ADMIN_EMAIL, nextRole: "sales" }),
    ).toBe("main-admin");
  });

  it("blocks changing your own role", () => {
    expect(
      denyRoleChange({ ...base, targetEmail: "other@apmgservices.com.au", nextRole: "sales" }),
    ).toBe("self");
  });

  it("blocks demoting the last remaining admin", () => {
    expect(
      denyRoleChange({
        actorEmail: "someone@apmgservices.com.au",
        targetEmail: "solo@apmgservices.com.au",
        nextRole: "sales",
        adminEmails: ["solo@apmgservices.com.au"],
      }),
    ).toBe("last-admin");
  });

  it("allows a normal promotion", () => {
    expect(
      denyRoleChange({ ...base, targetEmail: "nicole@apmgservices.com.au", nextRole: "sales" }),
    ).toBeNull();
  });

  it("allows setting the main admin to admin (a no-op change)", () => {
    expect(
      denyRoleChange({ ...base, targetEmail: MAIN_ADMIN_EMAIL, nextRole: "admin" }),
    ).toBeNull();
  });

  it("compares case-insensitively", () => {
    expect(
      denyRoleChange({ ...base, targetEmail: MAIN_ADMIN_EMAIL.toUpperCase(), nextRole: "client" }),
    ).toBe("main-admin");
  });
});

describe("isSafeNextPath", () => {
  it("accepts a same-origin relative path", () => {
    expect(isSafeNextPath("/leads")).toBe(true);
    expect(isSafeNextPath("/")).toBe(true);
    expect(isSafeNextPath("/a?b=c")).toBe(true);
  });

  it("rejects a protocol-relative URL (the open-redirect vector)", () => {
    expect(isSafeNextPath("//evil.example")).toBe(false);
  });

  it("rejects an absolute URL", () => {
    expect(isSafeNextPath("https://evil.example")).toBe(false);
    expect(isSafeNextPath("javascript:alert(1)")).toBe(false);
  });

  it("rejects a backslash-prefixed path some browsers normalise to //", () => {
    expect(isSafeNextPath("/\\evil.example")).toBe(false);
  });

  it("rejects control characters a URL parser would strip", () => {
    // Every browser and Node strip TAB/CR/LF from anywhere in the string
    // BEFORE reading its structure, so these parse as //evil.example.
    expect(isSafeNextPath("/\t/evil.example")).toBe(false);
    expect(isSafeNextPath("/\n/evil.example")).toBe(false);
    expect(isSafeNextPath("/\r/evil.example")).toBe(false);
    expect(isSafeNextPath("/\t\\evil.example")).toBe(false);
  });

  it("rejects empty and missing values", () => {
    expect(isSafeNextPath("")).toBe(false);
    expect(isSafeNextPath(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/auth/policy.test.ts`
Expected: FAIL — cannot resolve `./policy`.

- [ ] **Step 3: Write the implementation**

Create `lib/auth/policy.ts`:

```ts
import { roleCan, type Role } from "@/lib/rbac/roles";

/**
 * Pure security decisions, deliberately free of Next, cookies and the network
 * so they can be exhaustively unit-tested. Everything here is the difference
 * between "looks secure" and "is secure" — change nothing without a test.
 */

/** The protected main admin. Cannot be demoted or deleted by anyone. */
export const MAIN_ADMIN_EMAIL = "kane@apmgservices.com.au";

export type IdentityResult =
  | { ok: true; email: string }
  | { ok: false; reason: "no-email" | "unverified-email" | "wrong-domain" };

/**
 * Gate Google's id_token claims down to "a real, verified account on OUR
 * Workspace domain". The `hd` claim is checked when present but is never
 * sufficient alone — the address itself is what we key identity on.
 */
export function assertWorkspaceIdentity(
  claims: { email?: string; email_verified?: boolean; hd?: string },
  allowedDomain: string,
): IdentityResult {
  const email = claims.email?.trim().toLowerCase();
  if (!email) return { ok: false, reason: "no-email" };
  if (claims.email_verified !== true) return { ok: false, reason: "unverified-email" };

  const domain = allowedDomain.trim().toLowerCase();
  if (!email.endsWith(`@${domain}`)) return { ok: false, reason: "wrong-domain" };
  if (claims.hd && claims.hd.trim().toLowerCase() !== domain) {
    return { ok: false, reason: "wrong-domain" };
  }
  return { ok: true, email };
}

/**
 * The role enforcement should use. `trueRole` comes from the database; `viewAs`
 * comes from the (signed) session cookie. The roleCan check — NOT the signature
 * — is the real gate: a rep who forged viewAs:"admin" still resolves to their
 * own role, because their true role lacks roles.viewas.
 */
export function effectiveRole(trueRole: Role, viewAs: Role | null | undefined): Role {
  if (!viewAs || viewAs === trueRole) return trueRole;
  return roleCan(trueRole, "roles.viewas") ? viewAs : trueRole;
}

export type RoleChangeDenial = "main-admin" | "self" | "last-admin" | null;

/**
 * Three ways to lock everyone out of the console, all refused here rather than
 * in the UI — the UI merely mirrors these answers.
 */
export function denyRoleChange(args: {
  actorEmail: string;
  targetEmail: string;
  nextRole: Role;
  adminEmails: readonly string[];
}): RoleChangeDenial {
  const actor = args.actorEmail.trim().toLowerCase();
  const target = args.targetEmail.trim().toLowerCase();
  const admins = args.adminEmails.map((e) => e.trim().toLowerCase());

  if (target === MAIN_ADMIN_EMAIL && args.nextRole !== "admin") return "main-admin";
  if (actor === target) return "self";
  if (args.nextRole !== "admin" && admins.length === 1 && admins[0] === target) {
    return "last-admin";
  }
  return null;
}

/**
 * Open-redirect guard for the post-login `next` path.
 *
 * Unvalidated, `next` lets an attacker send a staff member a link that
 * completes a GENUINE Google sign-in and then bounces them to a look-alike
 * host — arriving with all the credibility of a real login. Only same-origin
 * relative paths are allowed.
 */
export function isSafeNextPath(next: string | null | undefined): boolean {
  if (!next) return false;
  // Reject control characters outright instead of trying to emulate them.
  // WHATWG URL parsers — every browser, and Node's URL — strip TAB, CR and LF
  // from ANYWHERE in a string before reading its structure. So "/\t/evil.host"
  // survives a naive leading-"//" check and then parses as //evil.host, which
  // is a working open redirect off the back of a genuine sign-in. Refusing the
  // whole character class is safer than matching each parser's strip-list,
  // because a quirk we failed to anticipate cannot reopen the hole.
  if (/[\u0000-\u001f\u007f]/.test(next)) return false;
  if (!next.startsWith("/")) return false;
  // "//host" is protocol-relative; "/\host" is normalised to it by some browsers.
  if (next.startsWith("//") || next.startsWith("/\\")) return false;
  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/auth/policy.test.ts`
Expected: PASS — 21 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/auth/policy.ts lib/auth/policy.test.ts
git commit -m "Add pure security policy functions with tests

Domain assertion, effective-role resolution, the three lockout guards,
and an open-redirect guard for the post-login next path."
```

---

### Task 3: app_users table and store

**Files:**
- Create: `supabase/app-users.sql`
- Create: `lib/auth/userStore.ts`

**Interfaces:**
- Consumes: `supabaseTarget` from `lib/pipeline/server.ts`; `MAIN_ADMIN_EMAIL` from `lib/auth/policy.ts`; `Role`, `isRole` from `lib/rbac/roles.ts`
- Produces:
  - `getUserRole(email: string): Promise<Role>`
  - `upsertOnLogin(u: { email: string; name?: string; picture?: string }): Promise<Role>`

> **Scope:** ship only these two. `listUsers()` and `setUserRole()` belong to the
> Phase 2 admin tab and have no caller in Phase 1 — adding them here would mean
> shipping exported, untested, uncalled code. They go in with the UI that uses
> them.

- [ ] **Step 1: Write the migration**

Create `supabase/app-users.sql`:

```sql
-- Console users and their roles. Populated automatically on first Google
-- sign-in (at role 'pending'); roles are then granted from the Roles &
-- Permissions tab. Every read/write goes through the service role.

create table if not exists public.app_users (
  email         text primary key check (email = lower(email)),
  name          text,
  picture_url   text,
  role          text not null default 'pending'
                check (role in ('admin', 'sales', 'client', 'pending')),
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- RLS on with NO policies: the service role bypasses it, so the app is
-- unaffected, but the anon key can never read this table if one is ever
-- introduced client-side.
alter table public.app_users enable row level security;

-- The protected main admin. Re-running this file always restores admin, which
-- is the intended recovery path if the role is ever lost.
insert into public.app_users (email, name, role)
values ('kane@apmgservices.com.au', 'Kane Reroma', 'admin')
on conflict (email) do update set role = 'admin';
```

- [ ] **Step 2: Apply the migration**

Run this file in the Supabase SQL editor for the project. Verify with:

```sql
select email, role from public.app_users;
```

Expected: one row, `kane@apmgservices.com.au | admin`.

- [ ] **Step 3: Write the store**

Create `lib/auth/userStore.ts`:

```ts
import { supabaseTarget } from "@/lib/pipeline/server";
import { MAIN_ADMIN_EMAIL } from "@/lib/auth/policy";
import { isRole, type Role } from "@/lib/rbac/roles";

/**
 * All app_users access. Server-only (uses the service-role key).
 *
 * DEMO MODE: local development frequently runs without Supabase configured
 * (supabaseTarget() -> "demo"), and auth must not hard-fail there or the app
 * becomes undevelopable. In demo mode the main admin resolves to admin and
 * every other authenticated address to pending, with no persistence.
 */

const TABLE = "app_users";

function authHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

function demoRole(email: string): Role {
  return email.trim().toLowerCase() === MAIN_ADMIN_EMAIL ? "admin" : "pending";
}

/** The user's stored role. Unknown or unreadable resolves to `pending` — the
 *  failure direction must be "no access", never "admin". */
export async function getUserRole(email: string): Promise<Role> {
  const key = email.trim().toLowerCase();
  const target = supabaseTarget();
  if (target.state !== "ok") return demoRole(key);
  try {
    const res = await fetch(
      `${target.base}/rest/v1/${TABLE}?email=eq.${encodeURIComponent(key)}&select=role&limit=1`,
      { headers: authHeaders(target.key), cache: "no-store" },
    );
    if (!res.ok) return "pending";
    const rows = (await res.json().catch(() => [])) as Array<{ role: string }>;
    const role = rows[0]?.role;
    return isRole(role) ? role : "pending";
  } catch {
    return "pending";
  }
}

/**
 * Record a sign-in: create the row on first sight (at the column's `pending`
 * default), refresh the profile fields, stamp `last_login_at`.
 *
 * `role` is NEVER written here, and that is structural, not incidental.
 * `getUserRole` collapses every failure — 5xx, rate limit, schema-cache reload,
 * a dropped connection — into `"pending"`, which is indistinguishable from a
 * genuinely pending user. Reading the role and writing it back through an
 * upsert would therefore demote a real admin to `pending` on a transient blip
 * during their own sign-in, locking out the very account that must never be
 * lockable. Splitting this into an insert that ignores conflicts plus a PATCH
 * that omits `role` makes that class of bug impossible rather than guarded
 * against: no code path here can write the column at all. Roles change only by
 * explicit admin action.
 */
export async function upsertOnLogin(u: {
  email: string;
  name?: string;
  picture?: string;
}): Promise<Role> {
  const email = u.email.trim().toLowerCase();
  const target = supabaseTarget();
  if (target.state !== "ok") return demoRole(email);

  // First sight only. `ignore-duplicates` leaves an existing row untouched, so
  // a returning user's stored role is never in the write path.
  try {
    const res = await fetch(`${target.base}/rest/v1/${TABLE}?on_conflict=email`, {
      method: "POST",
      headers: {
        ...authHeaders(target.key),
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify([{ email }]),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[auth] app_users insert ${res.status}:`, detail.slice(0, 500));
    }
  } catch (e) {
    console.error("[auth] app_users insert failed:", e);
  }

  // Profile refresh — deliberately no `role` key in this body.
  try {
    const res = await fetch(
      `${target.base}/rest/v1/${TABLE}?email=eq.${encodeURIComponent(email)}`,
      {
        method: "PATCH",
        headers: {
          ...authHeaders(target.key),
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          name: u.name ?? null,
          picture_url: u.picture ?? null,
          last_login_at: new Date().toISOString(),
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[auth] app_users profile refresh ${res.status}:`, detail.slice(0, 500));
    }
  } catch (e) {
    console.error("[auth] app_users profile refresh failed:", e);
  }

  // Read the role back rather than assuming it. A failure here returns
  // "pending", which is only used to seed the starting theme — never persisted
  // — so a blip costs a dark theme, not an account.
  return getUserRole(email);
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add supabase/app-users.sql lib/auth/userStore.ts
git commit -m "Add app_users table and store

Roles resolve to pending on any failure so the app fails closed. Demo
mode keeps local development working without Supabase configured."
```

---

### Task 4: Session cookie (sign and verify)

**Files:**
- Modify (full rewrite): `lib/auth/session.ts`
- Test: `lib/auth/session.test.ts`

**Interfaces:**
- Consumes: `isRole`, `Role` from `lib/rbac/roles.ts`
- Produces:
  - `SESSION_COOKIE = "apmg_session"`, `THEME_SEED_COOKIE = "apmg-theme-seed"`, `SESSION_TTL_SECONDS = 43200`
  - `interface SessionClaims { email: string; name?: string; picture?: string; viewAs?: Role | null }`
  - `signSession(claims: SessionClaims): Promise<string>`
  - `verifySession(token: string | undefined): Promise<SessionClaims | null>`
  - `sessionCookieOptions(): { httpOnly: true; secure: boolean; sameSite: "lax"; path: "/"; maxAge: number }`

**CRITICAL:** this file is imported by `middleware.ts` (Edge runtime). It must not import `server-only`, Node built-ins, or `userStore.ts`.

- [ ] **Step 1: Install jose**

```bash
npm install jose
```

- [ ] **Step 2: Write the failing test**

Create `lib/auth/session.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import { signSession, verifySession } from "./session";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-value-at-least-32-bytes-long!!";
});

describe("session cookie", () => {
  it("round-trips the claims it was given", async () => {
    const token = await signSession({
      email: "simon@apmgservices.com.au",
      name: "Simon",
      viewAs: null,
    });
    const claims = await verifySession(token);
    expect(claims?.email).toBe("simon@apmgservices.com.au");
    expect(claims?.name).toBe("Simon");
    expect(claims?.viewAs).toBeNull();
  });

  it("preserves a valid viewAs role", async () => {
    const token = await signSession({ email: "kane@apmgservices.com.au", viewAs: "sales" });
    expect((await verifySession(token))?.viewAs).toBe("sales");
  });

  it("drops a viewAs value that is not a real role", async () => {
    const token = await signSession({
      email: "kane@apmgservices.com.au",
      // @ts-expect-error deliberately invalid, simulating a tampered payload
      viewAs: "superuser",
    });
    expect((await verifySession(token))?.viewAs).toBeNull();
  });

  it("rejects a tampered token", async () => {
    const token = await signSession({ email: "simon@apmgservices.com.au" });
    const tampered = `${token.slice(0, -4)}AAAA`;
    expect(await verifySession(tampered)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession({ email: "simon@apmgservices.com.au" });
    process.env.AUTH_SECRET = "a-completely-different-secret-value-32b!!";
    const result = await verifySession(token);
    process.env.AUTH_SECRET = "test-secret-value-at-least-32-bytes-long!!";
    expect(result).toBeNull();
  });

  it("rejects undefined and garbage", async () => {
    expect(await verifySession(undefined)).toBeNull();
    expect(await verifySession("not-a-jwt")).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run lib/auth/session.test.ts`
Expected: FAIL — `signSession` is not exported.

- [ ] **Step 4: Rewrite the session module**

Replace the entire contents of `lib/auth/session.ts`:

```ts
import { SignJWT, jwtVerify } from "jose";
import { isRole, type Role } from "@/lib/rbac/roles";

/**
 * The session cookie: a signed JWT carrying IDENTITY ONLY.
 *
 * The role is deliberately NOT in here — it is read from app_users per request
 * so that changing someone's role in the admin UI takes effect immediately
 * rather than whenever their cookie happens to expire.
 *
 * EDGE-SAFE BY CONTRACT: middleware.ts imports this module, so it must never
 * import `server-only`, Node built-ins, or anything that touches the database.
 */

export const SESSION_COOKIE = "apmg_session";
/** Read by the root layout to pick the pre-paint theme for a role. */
export const THEME_SEED_COOKIE = "apmg-theme-seed";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

export interface SessionClaims {
  email: string;
  name?: string;
  picture?: string;
  /** Role being previewed. Authority still comes from the DB — see policy.ts. */
  viewAs?: Role | null;
}

const encoder = new TextEncoder();

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set — cannot sign or verify sessions");
  return encoder.encode(value);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({
    name: claims.name,
    picture: claims.picture,
    viewAs: claims.viewAs ?? undefined,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.email.trim().toLowerCase())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

/** Verify signature and expiry. Any failure is a null session — never a throw,
 *  so callers can treat "no session" and "bad session" identically. */
export async function verifySession(
  token: string | undefined,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const email = typeof payload.sub === "string" ? payload.sub : null;
    if (!email) return null;
    return {
      email,
      name: typeof payload.name === "string" ? payload.name : undefined,
      picture: typeof payload.picture === "string" ? payload.picture : undefined,
      viewAs: isRole(payload.viewAs) ? payload.viewAs : null,
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax, NOT Strict: the OAuth callback is a top-level cross-site navigation
    // and Strict would strip the cookie from it.
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  } as const;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run lib/auth/session.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json lib/auth/session.ts lib/auth/session.test.ts
git commit -m "Replace client-set cookies with a signed session cookie

Identity only, no role, so role changes apply immediately. Kept
Edge-safe because middleware imports it."
```

---

### Task 5: Google OAuth flow

**Files:**
- Create: `lib/auth/google.ts`
- Create: `app/api/auth/google/start/route.ts`
- Create: `app/api/auth/google/callback/route.ts`
- Create: `app/api/auth/signout/route.ts`

**Interfaces:**
- Consumes: `assertWorkspaceIdentity`, `isSafeNextPath` (Task 2); `upsertOnLogin` (Task 3); `signSession`, `sessionCookieOptions`, `SESSION_COOKIE`, `THEME_SEED_COOKIE` (Task 4)
- Produces: `GET /api/auth/google/start`, `GET /api/auth/google/callback`, `POST /api/auth/signout`; from `lib/auth/google.ts`: `allowedDomain()`, `exchangeCode()`, `verifyIdToken()`, `OAUTH_STATE_COOKIE`, `OAUTH_VERIFIER_COOKIE`, `OAUTH_NEXT_COOKIE`

- [ ] **Step 1: Write the Google helper module**

Create `lib/auth/google.ts`:

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

/** Google OAuth 2.0 / OpenID Connect wiring. Sign-in only — we request no
 *  offline access and store no refresh token. */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const OAUTH_STATE_COOKIE = "apmg_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "apmg_oauth_verifier";
export const OAUTH_NEXT_COOKIE = "apmg_oauth_next";
/** The OAuth handshake is a single round trip; 10 minutes is generous. */
export const OAUTH_COOKIE_MAX_AGE = 600;

export function clientId(): string {
  const v = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!v) throw new Error("GOOGLE_OAUTH_CLIENT_ID is not set");
  return v;
}

function clientSecret(): string {
  const v = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!v) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is not set");
  return v;
}

export function allowedDomain(): string {
  return (process.env.GOOGLE_ALLOWED_DOMAIN || "apmgservices.com.au").trim().toLowerCase();
}

/** Derived from the request so dev, preview and production each work — every
 *  origin must be registered as an Authorized redirect URI in Google Cloud. */
export function redirectUri(req: Request): string {
  return new URL("/api/auth/google/callback", req.url).toString();
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizeUrl(args: {
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  // Sign-in only: no refresh token is wanted, so nothing long-lived to leak.
  url.searchParams.set("access_type", "online");
  url.searchParams.set("state", args.state);
  url.searchParams.set("code_challenge", args.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  // Hints Google to the right domain; our own check is what enforces it.
  url.searchParams.set("hd", allowedDomain());
  return url.toString();
}

export async function exchangeCode(args: {
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<{ id_token?: string } | null> {
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: args.code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: args.redirectUri,
        grant_type: "authorization_code",
        code_verifier: args.verifier,
      }),
    });
    if (!res.ok) {
      console.error("[auth] token exchange failed:", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    return (await res.json()) as { id_token?: string };
  } catch (e) {
    console.error("[auth] token exchange threw:", e);
    return null;
  }
}

export interface GoogleClaims {
  email?: string;
  email_verified?: boolean;
  hd?: string;
  name?: string;
  picture?: string;
}

/** Verify the id_token's signature, issuer and audience against Google's JWKS. */
export async function verifyIdToken(idToken: string): Promise<GoogleClaims | null> {
  try {
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId(),
    });
    return payload as GoogleClaims;
  } catch (e) {
    console.error("[auth] id_token verification failed:", e);
    return null;
  }
}
```

- [ ] **Step 2: Write the start route**

Create `app/api/auth/google/start/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  OAUTH_COOKIE_MAX_AGE,
  OAUTH_NEXT_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  authorizeUrl,
  pkceChallenge,
  randomToken,
  redirectUri,
} from "@/lib/auth/google";
import { isSafeNextPath } from "@/lib/auth/policy";

export const runtime = "nodejs";

/** Begin the Google sign-in. Stashes the CSRF state, the PKCE verifier and the
 *  post-login destination in short-lived HttpOnly cookies. */
export async function GET(req: Request): Promise<Response> {
  const state = randomToken();
  const verifier = randomToken();
  const challenge = await pkceChallenge(verifier);

  const requested = new URL(req.url).searchParams.get("next");
  const next = isSafeNextPath(requested) ? (requested as string) : "/";

  const res = NextResponse.redirect(
    authorizeUrl({ redirectUri: redirectUri(req), state, challenge }),
  );
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_COOKIE_MAX_AGE,
  } as const;
  res.cookies.set(OAUTH_STATE_COOKIE, state, opts);
  res.cookies.set(OAUTH_VERIFIER_COOKIE, verifier, opts);
  res.cookies.set(OAUTH_NEXT_COOKIE, next, opts);
  return res;
}
```

- [ ] **Step 3: Write the callback route**

Create `app/api/auth/google/callback/route.ts`:

```ts
import { NextResponse, type NextRequest } from "next/server";
import {
  OAUTH_NEXT_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  allowedDomain,
  exchangeCode,
  redirectUri,
  verifyIdToken,
} from "@/lib/auth/google";
import { assertWorkspaceIdentity, isSafeNextPath } from "@/lib/auth/policy";
import {
  SESSION_COOKIE,
  THEME_SEED_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/session";
import { upsertOnLogin } from "@/lib/auth/userStore";

export const runtime = "nodejs";

/**
 * Everything that must not outlive a sign-in attempt: the three handshake
 * cookies, plus the two pre-migration cookies the old browser-set session used.
 * Cleared on EVERY exit path — success and failure alike. A failed attempt that
 * leaves `apmg-role` in place is exactly the authorization bypass this migration
 * exists to close, and a denied consent should not strand handshake state in the
 * browser of a shared machine.
 */
const STALE_COOKIES = [
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  OAUTH_NEXT_COOKIE,
  "apmg-role",
  "apmg-user",
] as const;

function clearStale(res: NextResponse): NextResponse {
  for (const name of STALE_COOKIES) res.cookies.set(name, "", { path: "/", maxAge: 0 });
  return res;
}

function fail(req: NextRequest, reason: string): Response {
  return clearStale(
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(reason)}`, req.url)),
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // Read through NextRequest's cookie jar, NOT a hand-rolled Cookie-header
  // regex. `ResponseCookies.set()` percent-encodes on the way out and only
  // `RequestCookies.get()` decodes on the way back, so hand-parsing returns
  // "%2Fleads" for a stored next of "/leads" — which then fails isSafeNextPath
  // and silently kills return-to-page for every destination except "/". Letting
  // the framework own both sides removes the mismatch entirely.
  const expectedState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const verifier = req.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  const storedNext = req.cookies.get(OAUTH_NEXT_COOKIE)?.value;

  if (url.searchParams.get("error")) return fail(req, "google-denied");
  if (!code || !state || !expectedState || state !== expectedState) return fail(req, "bad-state");
  if (!verifier) return fail(req, "bad-state");

  const tokens = await exchangeCode({ code, verifier, redirectUri: redirectUri(req) });
  if (!tokens?.id_token) return fail(req, "exchange-failed");

  const claims = await verifyIdToken(tokens.id_token);
  if (!claims) return fail(req, "invalid-token");

  const identity = assertWorkspaceIdentity(claims, allowedDomain());
  if (!identity.ok) return fail(req, identity.reason);

  const role = await upsertOnLogin({
    email: identity.email,
    name: claims.name,
    picture: claims.picture,
  });

  const next = isSafeNextPath(storedNext) ? (storedNext as string) : "/";
  const res = NextResponse.redirect(new URL(next, req.url));

  res.cookies.set(
    SESSION_COOKIE,
    await signSession({ email: identity.email, name: claims.name, picture: claims.picture }),
    sessionCookieOptions(),
  );
  // Pre-paint theme for this role — reps work in daylight and get light.
  res.cookies.set(THEME_SEED_COOKIE, role === "sales" ? "light" : "dark", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  // Same clearing as every failure path — handshake cookies plus the old
  // client-set ones, which are an authorization bypass while any browser holds
  // them and any code still reads them.
  return clearStale(res);
}
```

- [ ] **Step 4: Write the sign-out route**

Create `app/api/auth/signout/route.ts`:

```ts
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth/session";

export const runtime = "nodejs";

/** An HttpOnly cookie cannot be cleared from JavaScript, so sign-out is a POST. */
export async function POST(): Promise<Response> {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { path: "/", maxAge: 0 });
  res.cookies.set("apmg-role", "", { path: "/", maxAge: 0 });
  res.cookies.set("apmg-user", "", { path: "/", maxAge: 0 });
  return res;
}
```

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit && npx next build`
Expected: both clean.

- [ ] **Step 6: Verify a live sign-in**

Requires the Google Cloud prerequisite. Run `npm run dev`, visit
`http://localhost:3000/api/auth/google/start`, sign in with a
`@apmgservices.com.au` account.

Expected: redirected to `/`, and `document.cookie` in devtools shows **no**
`apmg_session` (proving `HttpOnly`), while the Application → Cookies panel does
show it. Confirm the `app_users` row appeared:

```sql
select email, role, last_login_at from public.app_users;
```

Then verify rejection: sign in with a personal Gmail account. Expected: redirect
to `/login?error=wrong-domain`, no session cookie set.

- [ ] **Step 7: Commit**

```bash
git add lib/auth/google.ts app/api/auth/
git commit -m "Add Google OAuth sign-in, callback and sign-out routes

PKCE + state CSRF, id_token verified against Google's JWKS, and the
Workspace domain enforced on our side rather than trusting hd."
```

---

### Task 6: Async, DB-backed authorization

**Files:**
- Modify (full rewrite): `lib/rbac/server.ts`
- Modify: `app/api/sales/summary/route.ts:14`

**Interfaces:**
- Consumes: `verifySession`, `SESSION_COOKIE` (Task 4); `getUserRole` (Task 3); `effectiveRole` (Task 2)
- Produces:
  - `resolveSession(req: Request): Promise<{ email: string; trueRole: Role; role: Role } | null>`
  - `requirePermission(req: Request, perm: Permission): Promise<GuardResult>` — **now async**
  - `guardResponse(guard)` unchanged

- [ ] **Step 1: Rewrite the guard**

Replace the entire contents of `lib/rbac/server.ts`:

```ts
import "server-only";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { effectiveRole } from "@/lib/auth/policy";
import { getUserRole } from "@/lib/auth/userStore";
import { type Permission } from "./permissions";
import { roleCan, type Role } from "./roles";

/**
 * Server-side permission guard for Route Handlers.
 *
 * The role is read from app_users on every call rather than trusted from the
 * cookie, so an admin's role change takes effect on the very next request.
 * The previous implementation read a CLIENT-SET `apmg-role` cookie, which was
 * a complete authorization bypass — that cookie is now ignored entirely.
 */

export interface ResolvedSession {
  email: string;
  /** What the database says they are. */
  trueRole: Role;
  /** What enforcement should use — differs only during an authorised view-as. */
  role: Role;
}

export async function resolveSession(req: Request): Promise<ResolvedSession | null> {
  const cookie = req.headers.get("cookie") ?? "";
  const raw = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  // Decode defensively. Next's ResponseCookies.set() percent-encodes on write
  // and only RequestCookies.get() decodes on read, and hand-parsing the raw
  // header is exactly what silently broke the OAuth `next` cookie earlier in
  // this plan. It happens to be a no-op today — a compact JWT is base64url plus
  // dots, every character of which encodeURIComponent leaves alone — but that
  // is a property of the payload, not of the parsing, and it would stop holding
  // the moment the cookie carries anything else.
  // The decode must not be able to throw. decodeURIComponent raises URIError on
  // a malformed percent-sequence ("%", "%zz", a truncated "%E0"), any of which
  // an attacker can set from devtools. Unhandled, that rejects out through
  // requirePermission and 500s the authorization primitive — a denial of
  // service strictly worse than the encoding bug the decode exists to prevent.
  // A cookie we cannot decode is a cookie we cannot verify, so fall through to
  // "no session" and let the existing path answer 401.
  let token: string | undefined;
  try {
    token = raw ? decodeURIComponent(raw) : undefined;
  } catch {
    token = undefined;
  }
  const claims = await verifySession(token);
  if (!claims) return null;

  const trueRole = await getUserRole(claims.email);
  return {
    email: claims.email,
    trueRole,
    role: effectiveRole(trueRole, claims.viewAs ?? null),
  };
}

export type GuardResult =
  | { ok: true; role: Role; email: string }
  | { ok: false; status: 401 | 403; error: string };

export async function requirePermission(
  req: Request,
  perm: Permission,
): Promise<GuardResult> {
  const session = await resolveSession(req);
  if (!session) return { ok: false, status: 401, error: "Not authenticated" };
  if (!roleCan(session.role, perm)) {
    return { ok: false, status: 403, error: `Forbidden — missing permission: ${perm}` };
  }
  return { ok: true, role: session.role, email: session.email };
}

/**
 * Convenience for Route Handlers:
 *
 *   const guard = await requirePermission(req, "pipeline.import");
 *   if (!guard.ok) return guardResponse(guard);
 */
export function guardResponse(guard: Extract<GuardResult, { ok: false }>): Response {
  return Response.json({ error: guard.error }, { status: guard.status });
}
```

- [ ] **Step 2: Update the one existing call site**

In `app/api/sales/summary/route.ts`, change line 14 to await the guard, and delete the now-wrong NOTE comment above it (lines 9-10) that describes cookie-based resolution:

```ts
  const guard = await requirePermission(req, "sales.view");
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add lib/rbac/server.ts app/api/sales/summary/route.ts
git commit -m "Make permission checks async and DB-backed

Stops trusting the client-set apmg-role cookie, which was a complete
authorization bypass. Role now comes from app_users per request."
```

---

### Task 7: Middleware authentication gate

**Files:**
- Modify: `middleware.ts:99-142`

**Interfaces:**
- Consumes: `SESSION_COOKIE`, `verifySession` (Task 4)
- Produces: unauthenticated page requests redirect to `/login?next=…`; unauthenticated `/api/*` requests get `401` JSON

- [ ] **Step 1: Add the imports and helpers**

At the top of `middleware.ts`, add:

```ts
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
```

Below the existing `isPortalPath` function, add:

```ts
/** Paths reachable on the admin host WITHOUT a session. Everything else needs one. */
function isPublicAdminPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  return isPortalPath(pathname);
}
```

- [ ] **Step 2: Insert the gate**

`middleware` becomes `async`. Inside the `if (!isCustomerHost(host))` branch, the gate runs **first** — before the `apmg_internal` cookie block — so an unauthenticated visitor is redirected without being marked as an operator:

```ts
export async function middleware(req: NextRequest) {
  const host = req.headers.get("host") || "";
  const { pathname } = req.nextUrl;

  // Not a customer host -> full app (admin project, local dev).
  if (!isCustomerHost(host)) {
    // ── Authentication gate ──────────────────────────────────────────────
    // Signature + expiry only: proving WHO you are. What you may DO needs the
    // role, which lives in the database — resolved in route handlers, never
    // here, because a DB round trip per navigation on the Edge is the wrong
    // place to pay for it.
    if (!isPublicAdminPath(pathname)) {
      const token = req.cookies.get(SESSION_COOKIE)?.value;
      if (!(await verifySession(token))) {
        if (pathname.startsWith("/api/")) {
          // Deliberately not a redirect: a fetch() that follows a 302 to an
          // HTML login page fails with a confusing parse error instead of a
          // clear 401.
          return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
        }
        const url = req.nextUrl.clone();
        url.pathname = "/login";
        url.search = `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
        return NextResponse.redirect(url);
      }
    }

    // ... existing apmg_internal block and `return withPortalSource(...)`
    // continue here UNCHANGED ...
  }

  // ... the entire customer-host branch below continues UNCHANGED ...
}
```

**Do not touch the customer-host branch.** The portal must keep working with no session.

- [ ] **Step 3: Verify the gate**

Run `npm run dev`, then in a browser with no session (use a private window):

- Visit `http://localhost:3000/` → expect a redirect to `/login?next=%2F`
- Visit `http://localhost:3000/portal` → expect the portal to load normally, **no** redirect
- Run `curl -i http://localhost:3000/api/pipeline/leads` → expect `HTTP/1.1 401` and `{"error":"Not authenticated"}`, **not** lead data

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npx next build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add middleware.ts
git commit -m "Gate the admin host behind a valid session

Portal paths, /login and /api/auth/* stay public. API routes get 401
JSON rather than a redirect a fetch() would choke on."
```

---

### Task 8: Permission guards on the 14 unguarded admin routes

**Files (all Modify):** `app/api/pipeline/leads/route.ts`, `app/api/pipeline/upload/route.ts`, `app/api/pipeline/batches/route.ts`, `app/api/pipeline/campaigns/compose/route.ts`, `app/api/pipeline/campaigns/send/route.ts`, `app/api/pipeline/campaigns/find-emails/route.ts`, `app/api/sales/queue/route.ts`, `app/api/sales/handoff/route.ts`, `app/api/integrations/route.ts`, `app/api/legal/route.ts`, `app/api/compose-prompt/route.ts`, `app/api/sector-playbooks/route.ts`, `app/api/sector-playbooks/kb/route.ts`, `app/api/sector-playbooks/pdf/route.ts`

**Interfaces:**
- Consumes: `requirePermission`, `guardResponse` (Task 6)
- Produces: every admin route returns 401 unauthenticated / 403 without permission

- [ ] **Step 1: Apply the guard to each exported handler**

For **every** exported HTTP method in each file, add the guard as the first statement after the existing `sameOrigin` check (keep `sameOrigin` — it remains a useful CSRF floor):

```ts
import { guardResponse, requirePermission } from "@/lib/rbac/server";

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return Response.json({ error: "Bad origin" }, { status: 403 });

  const guard = await requirePermission(req, "leads.view");
  if (!guard.ok) return guardResponse(guard);

  // ... existing body unchanged ...
}
```

Use this permission per route and method. **Open each file and check which methods it actually exports** — this table is intent, not a substitute for reading the code:

| Route | Read methods | Write methods |
|---|---|---|
| `pipeline/leads` | `leads.view` | `pipeline.import` |
| `pipeline/upload` | — | `pipeline.import` |
| `pipeline/batches` | `pipeline.view` | `pipeline.import` |
| `pipeline/campaigns/compose` | `campaigns.send` | `campaigns.send` |
| `pipeline/campaigns/send` | — | `campaigns.send` |
| `pipeline/campaigns/find-emails` | `campaigns.send` | `campaigns.send` |
| `sales/queue` | `sales.view` | `sales.view` |
| `sales/handoff` | see note below | **depends on `kind`** — see note below |
| `integrations` | `integrations.view` | `integrations.manage` |
| `legal` | `legal.view` | `legal.manage` |
| `compose-prompt` | `composer.view` | `composer.view` |
| `sector-playbooks` | `playbooks.view` | `playbooks.manage` |
| `sector-playbooks/kb` | `playbooks.manage` | `playbooks.manage` |
| `sector-playbooks/pdf` | `playbooks.manage` | `playbooks.manage` |

> **`sales/handoff` serves two audiences, and one permission breaks one of them.**
> The first draft of this plan guarded the whole route with `hotleads.handoff`,
> which only `admin` holds. But `POST { kind: "returned" }` is the **rep-facing**
> "Return to admin" action — `SalesProvider.tsx`'s `returnLeads()` calls it from
> the Sales tab, and the bulk button there is already gated on `leads.contact`,
> which `sales` does hold. An admin-only permission 403s every rep on every
> click: the feature is completely broken for the role it exists for, on deploy.
>
> The permission therefore depends on `kind`:
>
> - `kind === "returned"` → **`leads.contact`** (held by `sales` and `admin`, and
>   the same gate the UI already applies, so client and server agree)
> - `kind` of `"handoff"` / `"archived"` → **`hotleads.handoff`** (admin-only
>   staging actions, driven from the Hot Leads page)
>
> This means POST must parse its body **before** authorising, since `kind` is in
> the body. That is safe — body parsing has no side effect, and the guard still
> runs before `gate()` and before any database read or write. `DELETE` takes the
> same `kind` as a query parameter and needs the same branching, or a rep can
> return a lead but not undo it.
>
> Check `GET` as well: `lib/data/hotLeads.ts` reads it, and the Sidebar (which
> renders for reps) imports `useHotLeadsWaiting` from that module — if any
> rep-reachable path polls it, an admin-only permission means a 403 per poll.

Delete the now-obsolete `SECURITY — TODO before exposing publicly` comment in `app/api/integrations/route.ts:19-21`, since this task is what it was waiting for.

**Do not touch any `app/api/portal/*` route** — those are customer-facing and must stay public.

- [ ] **Step 2: Verify each route rejects an anonymous caller**

With the dev server running and no session:

```bash
for p in pipeline/leads pipeline/batches sales/queue integrations legal compose-prompt sector-playbooks; do
  printf '%s -> ' "$p"
  curl -s -o /dev/null -w '%{http_code}\n' "http://localhost:3000/api/$p"
done
```

Expected: every line prints `401`. (Middleware catches these before the route
guard even runs — belt and braces is intentional, since middleware matcher
changes are easy to get wrong.)

- [ ] **Step 3: Verify the portal still works anonymously**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/portal
```

Expected: `200`.

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npx next build`
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
git add app/api/
git commit -m "Guard all 14 unguarded admin API routes

Previously only sameOrigin() stood between an anonymous caller and the
lead database, and that passes when the Origin header is absent."
```

---

### Task 9: Google-only login and the session-aware shell

> **Why these are one task:** deleting `lib/auth/users.ts` breaks every file that
> imported `AppUser` (`app/page.tsx`, `components/apmg/Sidebar.tsx`). Splitting
> the deletion from the repair would leave a task boundary — and a commit — where
> the build does not compile. Do the whole swap in one reviewable unit.

**Files:**
- Modify: `app/login/page.tsx:171-328`
- Delete: `lib/auth/users.ts`
- Create: `components/apmg/PendingAccess.tsx`
- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`
- Modify: `components/apmg/Sidebar.tsx:17-18,31-32,286-328`
- Modify: `components/apmg/DashboardShell.tsx` (user prop type only)
- Modify: `components/apmg/OverviewPage.tsx:11,161,294,305,384` (user prop type only)
- Create: `lib/themeBootstrap.ts` — the pure bootstrap builder, outside the `"use client"` boundary
- Modify: `lib/theme.ts` — import the shared key/type from the new module; drop the now-dead `THEME_BOOTSTRAP`

**Interfaces:**
- Consumes: `/api/auth/google/start` (Task 5); `resolveSession` (Task 6); `THEME_SEED_COOKIE` (Task 4); `themeBootstrap` from `lib/theme.ts`
- Produces: a login page with no password path; `AppUser` no longer exists, replaced by `SessionUser` (`{ email: string; name: string; initials: string }`) exported from `components/apmg/Sidebar.tsx` and consumed by `DashboardShell`

- [ ] **Step 1: Delete the credential directory**

```bash
git rm lib/auth/users.ts
```

- [ ] **Step 2: Rewrite the login form**

In `app/login/page.tsx`, delete the imports of `authenticate`, `setSessionCookies`, `Eye`, `EyeOff`, and `Loader2`, plus the `inputClass` constant and the `MicrosoftMark` component. Replace the `LoginPage` component's body (the `React.useState` block, `handleSubmit`, and the entire `<form>`) with:

```tsx
export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = React.use(searchParams);
  const next = params.next ? `?next=${encodeURIComponent(params.next)}` : "";

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-10">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-xl border border-border bg-card shadow-sm lg:grid-cols-[24rem_minmax(0,1fr)]">
        <div className="flex min-h-[38rem] flex-col justify-center p-6 sm:px-10 sm:py-12">
          <div className="mb-8 flex flex-col items-center gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary-solid">
              <Image src={brandLogo} alt="APMG" width={36} height={28} priority className="object-contain" />
            </div>
            <div>
              <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">
                Sign in to APMG
              </h1>
              <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Lead generation
              </p>
            </div>
          </div>

          {params.error && (
            <p role="alert" className="mb-5 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {LOGIN_ERRORS[params.error] ?? "Sign-in failed. Please try again."}
            </p>
          )}

          {/* A plain <a>, not <Button>: Button renders a <button> and has no
              asChild escape hatch, and sign-in must work without JS anyway.
              Classes are Button's base + default variant + lg size, copied
              from components/ui/button.tsx. */}
          <a
            href={`/api/auth/google/start${next}`}
            data-track="sso_google"
            className="inline-flex h-9 w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-primary-solid px-4 text-sm font-medium text-primary-foreground shadow-sm shadow-signal-900/30 transition-colors hover:bg-primary-solid/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px"
          >
            <GoogleMark />
            Continue with Google
          </a>

          <p className="mt-5 text-center text-[11px] leading-relaxed text-muted-foreground">
            Use your APMG Google account. Access is granted by an administrator —
            if this is your first sign-in, someone will need to approve you.
          </p>
        </div>

        <ServiceSlideshow />
      </div>
    </main>
  );
}
```

Add this constant above the component:

```tsx
/** Maps the callback route's `?error=` reasons to something a human can act on. */
const LOGIN_ERRORS: Record<string, string> = {
  "wrong-domain": "That account isn't on the APMG domain. Sign in with your @apmgservices.com.au account.",
  "unverified-email": "That Google account's email address isn't verified.",
  "no-email": "Google didn't return an email address for that account.",
  "bad-state": "The sign-in link expired or was already used. Please try again.",
  "exchange-failed": "Google sign-in didn't complete. Please try again.",
  "invalid-token": "Google sign-in couldn't be verified. Please try again.",
  "google-denied": "Sign-in was cancelled.",
};
```

Because the rewritten page no longer renders a `<Button>`, remove the now-unused `import { Button } from "@/components/ui/button";` too.

At this point the build is intentionally broken — `app/page.tsx` and
`components/apmg/Sidebar.tsx` still import the deleted `AppUser`. Do **not**
commit here; the remaining steps repair it, and the single commit lands at the
end.

- [ ] **Step 3: Create the pending screen**

Create `components/apmg/PendingAccess.tsx`:

```tsx
"use client";

import { ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Where every auto-admitted Workspace account lands until an admin grants a
 *  role. Signing in succeeded; authorisation simply hasn't happened yet. */
export function PendingAccess({ email }: { email: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <ShieldQuestion className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">
          Access pending
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          You&rsquo;re signed in as{" "}
          <span className="font-mono text-[13px] text-foreground">{email}</span>, but an
          administrator needs to grant you a role before you can use the console.
        </p>
        <Button
          variant="outline"
          className="mt-6 w-full"
          onClick={async () => {
            await fetch("/api/auth/signout", { method: "POST" });
            window.location.assign("/login");
          }}
        >
          Sign out
        </Button>
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Wire the session into the page**

Replace the contents of `app/page.tsx`:

```tsx
import { headers } from "next/headers";
import { DashboardShell } from "@/components/apmg/DashboardShell";
import { PendingAccess } from "@/components/apmg/PendingAccess";
import { RbacProvider } from "@/lib/rbac/RbacProvider";
import { SalesProvider } from "@/components/apmg/SalesProvider";
import { resolveSession } from "@/lib/rbac/server";

function initialsFor(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s.@]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

export default async function Page() {
  // Middleware guarantees a valid session before this renders, so a null here
  // means the cookie expired between the two — send them back to the door.
  const session = await resolveSession(new Request("http://local/", { headers: await headers() }));
  if (!session) return <PendingAccess email="unknown" />;
  if (session.role === "pending") return <PendingAccess email={session.email} />;

  const name = session.email.split("@")[0].replace(/[._]/g, " ");
  const user = {
    email: session.email,
    name: name.charAt(0).toUpperCase() + name.slice(1),
    initials: initialsFor(name, session.email),
  };

  return (
    <RbacProvider initialRole={session.role} locked>
      <SalesProvider>
        <DashboardShell user={user} />
      </SalesProvider>
    </RbacProvider>
  );
}
```

- [ ] **Step 5: Replace the deleted AppUser type**

In `components/apmg/Sidebar.tsx`, delete the two imports from the removed modules (lines 17-18):

```ts
import { type AppUser } from "@/lib/auth/users";
import { clearSessionCookies } from "@/lib/auth/session";
```

Replace the `user?: AppUser` prop type (line 32) with a locally declared shape:

```ts
export interface SessionUser {
  email: string;
  name: string;
  initials: string;
}
```

…and change the prop to `user?: SessionUser`.

Then update **both** downstream consumers to import `SessionUser` from `./Sidebar` in place of the deleted `AppUser`:

- `components/apmg/DashboardShell.tsx` — the import at line 8 and the `user?: AppUser` prop at line 34.
- `components/apmg/OverviewPage.tsx` — the import at line 11 and **four** usages: line 161 (`OverviewHeader`'s `user?:`), line 294 (`OverviewPage`), line 305 (`PipelineOverview`), line 384 (`SalesOverview`).

> `OverviewPage.tsx` is easy to miss — it was absent from the first draft of this
> plan. Nobody traced `DashboardShell`'s `user` prop down into the component it
> renders, so the file typechecks today only because `lib/auth/users.ts` still
> exists. Deleting that file in Step 1 makes this a fourth broken consumer, and
> Step 8 cannot reach zero `tsc` errors without it. Verify with
> `grep -rn "AppUser" app lib components` that no consumer remains before Step 8.

- [ ] **Step 6: Make sign-out server-side**

In `components/apmg/Sidebar.tsx`, replace the sign-out button's `onClick` (line 320-323):

```tsx
          onClick={async () => {
            // HttpOnly cookies can't be cleared from JS — the server does it.
            await fetch("/api/auth/signout", { method: "POST" });
            window.location.assign("/login");
          }}
```

Also remove the hardcoded `?? "KR"` / `?? "Kane Reroma"` / `?? "kane@apmgservices.com.au"` fallbacks on lines 288, 293 and 300 — with a real session the user is always present, and a stale personal default appearing for someone else is a genuine confusion:

```tsx
{user?.initials ?? "—"}
...
{user?.name ?? "Signed in"}
...
{user?.email ?? ""}
```

- [ ] **Step 7: Seed the theme from the cookie**

> **Read this before editing `app/layout.tsx`.** `lib/theme.ts` begins with
> `"use client"`. `RootLayout` is a Server Component, and a Server Component may
> not call a function that lives behind a client boundary — doing so throws at
> request time on **every route**, a total site outage. Neither `tsc --noEmit`
> nor `next build` catches it, because these routes are server-rendered on
> demand and the build never executes them; only a real HTTP request does. So
> the pure part of the theme module has to come out from behind that boundary
> first.

**7a — extract the pure bootstrap.** Create `lib/themeBootstrap.ts` with **no**
`"use client"` directive, holding only the pure string builder and the key it
references — no hooks, no DOM access, importable from both sides:

```ts
/**
 * Deliberately NOT a client module. The root layout is a Server Component and
 * cannot call into a `"use client"` file, so the pure bootstrap builder lives
 * here while the hooks that genuinely need the browser stay in lib/theme.ts.
 */

export type Theme = "dark" | "light";

/** localStorage key holding the user's explicit choice, which always wins. */
export const THEME_STORAGE_KEY = "apmg-theme";

/**
 * Inline script string injected before paint so the persisted theme (or the
 * given fallback) is applied with no flash of the wrong one.
 *
 * The operator console defaults to dark (ui-standards §4.2). The Sales desk
 * defaults to LIGHT — reps work it in daylight, often on a phone, and dark
 * chrome under glare is the first thing to cost legibility. Either way an
 * explicit choice from the toggle is stored and always wins from then on, so
 * the fallback only ever decides the very first visit.
 */
export function themeBootstrap(fallback: Theme = "dark"): string {
  return (
    `(function(){try{` +
    `var t=localStorage.getItem('${THEME_STORAGE_KEY}');` +
    `if(t!=='light'&&t!=='dark'){t='${fallback}';}` +
    `var r=document.documentElement;` +
    `r.classList.toggle('dark',t==='dark');r.style.colorScheme=t;` +
    `}catch(e){` +
    `document.documentElement.classList.toggle('dark','${fallback}'==='dark');` +
    `}})();`
  );
}
```

**7b — slim `lib/theme.ts` down.** Delete its local `STORAGE_KEY`, its `Theme`
type, its `themeBootstrap` function and the now-dead `THEME_BOOTSTRAP` constant
(nothing imports it once the layout calls `themeBootstrap(seed)` — verify with
`grep -rn "THEME_BOOTSTRAP" app lib components`). Import what it still needs
instead, keeping the `"use client"` directive and the hooks:

```ts
import { THEME_STORAGE_KEY, type Theme } from "@/lib/themeBootstrap";
```

Replace the remaining `STORAGE_KEY` references in `useTheme` and
`seedThemeForRole` with `THEME_STORAGE_KEY`, and re-export the type for existing
consumers if any rely on it: `export type { Theme };`

`app/portal/layout.tsx:5` mentions `THEME_BOOTSTRAP` in a comment — update that
prose to say `themeBootstrap` so the reference is not left dangling.

**7c — wire the layout.** `app/layout.tsx` currently imports `THEME_BOOTSTRAP` (line 3), is a **synchronous** component (line 27), and hardcodes `dark` in the `<html>` className (line 35). All three change.

Replace the import on line 3:

```tsx
import { cookies } from "next/headers";
import { themeBootstrap } from "@/lib/themeBootstrap";
import { THEME_SEED_COOKIE } from "@/lib/auth/session";
```

Make the component `async` and resolve the seed before returning:

```tsx
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Set by the OAuth callback from the signed-in user's role — reps get light,
  // everyone else dark. localStorage still wins once the toggle has been used.
  const seed = (await cookies()).get(THEME_SEED_COOKIE)?.value === "light" ? "light" : "dark";
```

Make the `<html>` className follow the seed instead of always saying `dark`, so
the server-rendered markup matches what the bootstrap script is about to apply:

```tsx
      className={`${sans.variable} ${heading.variable} ${seed === "dark" ? "dark" : ""}`}
```

And use the seeded bootstrap in the inline script, leaving the long comment above it untouched:

```tsx
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap(seed) }} />
```

- [ ] **Step 8: Typecheck, build, AND actually serve a request**

Run: `npx tsc --noEmit && npx next build`
Expected: both clean — this is the point at which all the fallout from deleting `lib/auth/users.ts` is resolved. If either fails, the task is not done; fix before committing.

**A green build is not sufficient evidence here, and this step is where that was
learned the hard way.** The client-boundary violation described in Step 7 passes
both `tsc` and `next build` and still 500s every route, because these pages are
server-rendered on demand and the build never executes them. So also start the
dev server and fetch real pages before you believe it:

```bash
npm run dev &
# wait for "Ready", then:
curl -s -o /dev/null -w '%{http_code} /\n'       http://localhost:3000/
curl -s -o /dev/null -w '%{http_code} /login\n'  http://localhost:3000/login
curl -s -o /dev/null -w '%{http_code} /portal\n' http://localhost:3000/portal
```

All three must be `200` (or a `3xx` for `/` once the Task 7 gate exists). Any
`500` means a runtime boundary or import error the static gates cannot see. Check
the dev-server output for the stack trace, and stop the server when done.

> Port note: another project on this machine may already hold port 3000. If Next
> reports it is using a different port, use that port in the curls rather than
> assuming 3000 — and do not kill the other process.

- [ ] **Step 9: Verify end to end**

With the dev server running:

1. Private window → `http://localhost:3000/` → redirected to `/login`
2. Click "Continue with Google", sign in as `kane@apmgservices.com.au` → the full admin console loads
3. Click Sign out → back at `/login`; visiting `/` redirects again
4. In Supabase, set another signed-in user's role to `pending` and reload their session → they see the Access pending screen

- [ ] **Step 10: Commit**

One commit for the whole swap — the tree never compiles without both halves.

```bash
git add app/login/page.tsx lib/auth/users.ts app/page.tsx app/layout.tsx \
        components/apmg/PendingAccess.tsx components/apmg/Sidebar.tsx \
        components/apmg/DashboardShell.tsx components/apmg/OverviewPage.tsx \
        lib/theme.ts lib/themeBootstrap.ts
git commit -m "Make Google the only sign-in path and wire the session in

Deletes the hardcoded user list and the shared plaintext password,
which stayed a valid door bypassing SSO entirely, and removes the inert
Microsoft button rather than leaving a control that never works.

Same commit carries the repair, because deleting AppUser breaks its
importers: the pending-access screen, server-side sign-out (HttpOnly
cookies can't be cleared from JS), and theme seeding from a cookie set
at callback time so there's no flash."
```

---

### Task 10: Playwright regression tests for the gate

**Files:**
- Create: `playwright.config.ts`
- Create: `tests/e2e/auth.spec.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: the running app
- Produces: `npm run test:e2e`

- [ ] **Step 1: Create the Playwright config**

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: { baseURL: "http://localhost:3000" },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000/login",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
```

If `@playwright/test` is absent (only `playwright` is currently a devDependency), install it:

```bash
npm install --save-dev @playwright/test
```

- [ ] **Step 2: Add the script**

In `package.json` `"scripts"`:

```json
"test:e2e": "playwright test"
```

- [ ] **Step 3: Write the tests**

Create `tests/e2e/auth.spec.ts`:

```ts
import { expect, test } from "@playwright/test";

/**
 * These guard the two failure modes that matter most: the console being
 * reachable without signing in, and the lead database being reachable by a
 * caller that sends no Origin header. Both were true before Phase 1.
 */

test("an unauthenticated visitor is sent to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("link", { name: /continue with google/i })).toBeVisible();
});

test("the lead database is not readable without a session", async ({ request }) => {
  // No Origin header, exactly like curl — the case sameOrigin() lets through.
  const res = await request.get("/api/pipeline/leads");
  expect(res.status()).toBe(401);
  expect(await res.text()).not.toContain("email");
});

test("admin API routes reject anonymous callers", async ({ request }) => {
  for (const path of [
    "/api/pipeline/batches",
    "/api/sales/queue",
    "/api/integrations",
    "/api/legal",
    "/api/compose-prompt",
    "/api/sector-playbooks",
  ]) {
    const res = await request.get(path);
    expect(res.status(), `${path} should require auth`).toBe(401);
  }
});

test("the customer portal still loads with no session", async ({ page }) => {
  // The guard against this whole change breaking the customer-facing surface.
  const res = await page.goto("/portal");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/portal/);
});

test("the login page renders a domain error legibly", async ({ page }) => {
  await page.goto("/login?error=wrong-domain");
  await expect(page.getByRole("alert")).toContainText("apmgservices.com.au");
});
```

- [ ] **Step 4: Run the tests**

Run: `npx playwright test`
Expected: 5 passed.

- [ ] **Step 5: Run the full gate**

Run: `npx vitest run && npx tsc --noEmit && npx next build`
Expected: all clean — 32 unit tests, no type errors, successful build.

- [ ] **Step 6: Commit**

```bash
git add playwright.config.ts tests/e2e/auth.spec.ts package.json package-lock.json
git commit -m "Add E2E tests for the auth gate

Covers the two holes Phase 1 closes -- an open console and an
Origin-less request reaching the lead database -- plus a regression
test that the customer portal still loads anonymously."
```

---

## Done when

- [ ] `npx vitest run` — all unit tests pass
- [ ] `npx playwright test` — all E2E tests pass
- [ ] `npx tsc --noEmit` — clean
- [ ] `npx next build` — clean
- [ ] Signing in with a `@apmgservices.com.au` Google account reaches the console
- [ ] Signing in with a personal Gmail account is refused with a legible message
- [ ] A user whose `app_users.role` is `pending` sees the Access pending screen
- [ ] `curl http://localhost:3000/api/pipeline/leads` returns `401`
- [ ] `http://localhost:3000/portal` loads with no session
- [ ] No code path reads `apmg-role` or `apmg-user` any more (`grep -rn "apmg-role\|apmg-user" app lib components middleware.ts` returns only the cookie-clearing lines)

## Follow-on phases (separate plans)

- **Phase 2 — Roles and Permissions tab.** `SettingsPage` with sub-tabs, the user table, the permission matrix, and `app/api/admin/users/route.ts` applying `denyRoleChange` (already built and tested in Task 2). Phase 2 also adds `listUsers()` and `setUserRole()` to `lib/auth/userStore.ts` — deliberately deferred out of Phase 1, which has no caller for them.
- **Phase 3 — View-as switcher.** `/api/auth/view-as`, `RbacProvider` carrying both `role` and `trueRole`, and the exit banner that must render off the **true** role or an admin gets stranded in a role they can't leave. `effectiveRole` (Task 2) already implements the server side.
