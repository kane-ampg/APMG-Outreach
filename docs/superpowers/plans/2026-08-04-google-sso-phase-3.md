# Google SSO + RBAC — Phase 3 (View-as switcher) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin preview the console as another role (Sales, Client, or Pending) from inside the dashboard, server-enforced, with no password and no per-person impersonation.

**Architecture:** A `POST /api/auth/view-as` route re-signs the session cookie with a `viewAs` claim after independently re-checking `roleCan(trueRole, "roles.viewas")` against the database — never against the currently-effective role, which would wrongly lock a previewing admin out of switching again. `RbacProvider` starts carrying both the effective `role` and the real `trueRole` so a `RoleSwitcher` (admin-only) and a persistent `ViewAsBanner` (keyed off `trueRole`, so it's always reachable) can render correctly. The client always does a full reload after a successful switch so server components re-render under the new role — there is no client-side role state left to fake it.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, `jose` (session signing, already a dependency), vitest, Playwright.

**Source spec:** [`docs/superpowers/specs/2026-08-03-google-sso-rbac-design.md`](../specs/2026-08-03-google-sso-rbac-design.md) §9, with the 2026-08-04 addendum (Sales listed first; nothing auto-activates; admins still land in their own view every sign-in)

**Phase 1 (36 commits) and Phase 2 are complete on this same branch (`worktree-google-sso-rbac`) and supply everything this phase composes.** Not yet merged to `main` — that merge happens once Phase 3 is done too.

## Why this phase matters more than it looks

Right now `roleCan(role, "roles.viewas")` exists in the catalog and is fully unit-tested (`lib/rbac/roles.test.ts`, `lib/auth/policy.test.ts`), but nothing calls it outside a test file. `components/rbac/RoleSwitcher.tsx` still gates on `devMode`, and `devMode = DEV && !locked` — and `app/page.tsx`, the only place that constructs `<RbacProvider>`, always passes `locked`. So today `devMode` is provably always `false`: **the switcher renders nothing, in any environment.** This phase doesn't extend a working dev feature — it replaces dead code with the real, server-enforced thing.

## Global Constraints

- **Authorization always checks `trueRole`, never the effective role.** `requirePermission` (`lib/rbac/server.ts`) is deliberately *not* used for the view-as route — it gates on the effective role, and an admin currently previewing `sales` would then fail `roleCan("sales", "roles.viewas")` and be unable to switch again or exit. The route reads `trueRole` from `app_users` directly.
- **The UI rendering a control is a courtesy, never the enforcement.** Every branch that shows or hides the switcher/banner has a server-side twin that reaches the same answer independently.
- `roles.viewas` is held by `admin` only (Phase 1 fact, unit-tested — do not re-derive it).
- **Never alter customer-portal behaviour** (`/portal`, `/t/*`, `/api/portal/*`).
- **Never weaken Phase 1/2 guards.** Nothing under `middleware.ts`, `lib/auth/session.ts`, `lib/auth/policy.ts`, or `lib/rbac/server.ts` should need changing, and this plan does not touch any of them. If you think one needs to change, stop and ask.
- `RbacProvider`'s public API changes from optional `initialRole`/`locked` to required `role`/`trueRole`. `app/page.tsx` is the **only** caller in the codebase (confirmed by grep) — if you find a second one, stop and ask; it likely means other work has landed on this branch since this plan was written.
- **`RbacProvider` and `RoleSwitcher.tsx` change atomically, in the same task.** `RoleSwitcher.tsx` is the only consumer of `RbacProvider`'s context shape beyond `role`/`can`/`roleLabel` (which are unchanged) — it currently destructures `setRole`/`devMode`, both of which this phase removes. Landing the provider change without also landing the switcher rewrite leaves `tsc --noEmit` broken in between; they are one task, not two.
- The repo has **no ESLint**. Gates are `npx tsc --noEmit`, `npx next build`, `npx vitest run`, `npx playwright test`.
- **A green build is not sufficient evidence on this codebase.** Nine defects in Phase 1 passed every static gate, including one total site outage. Every task that touches a rendered surface or a route must be verified with a real signed-in session or a real HTTP request, not just a type-check.
- Playwright's config pins port **3100**. Ports 3000/3001 are held by unrelated projects — never kill them.
- No shared password, no login-page changes, no per-user impersonation anywhere in this phase. Signing in is unchanged: Google SSO only, and every admin still lands in their own real Admin view on every sign-in.

## What Phase 1/2 already provide

| Thing | Where | Note |
|---|---|---|
| `roleCan(role, perm)`, `isRole()`, `ROLES` | `lib/rbac/roles.ts` | `roles.viewas` already in the catalog, held by `admin` only |
| `SESSION_COOKIE`, `signSession()`, `verifySession()`, `sessionCookieOptions()` | `lib/auth/session.ts` | `SessionClaims.viewAs` already exists as a field — this phase is the first thing to *write* it outside a test |
| `getUserRole(email)` | `lib/auth/userStore.ts` | Resolves to `pending` on any failure, including an unknown email |
| `sameOrigin(req)` | `lib/pipeline/server.ts` | Cheap first filter on every state-mutating admin route; not sufficient alone, always paired with a real auth check |
| `effectiveRole(trueRole, viewAs)` | `lib/auth/policy.ts` | Already fully tested, including "a forged viewAs cannot escalate" — this is the *real* defence; the route's own permission check is defence in depth |

## File Structure

| File | Responsibility |
|---|---|
| `lib/rbac/RbacProvider.tsx` | **Rewrite.** Drop the dead dev-preview mechanism; carry `role`, `trueRole`, `canViewAs` from the server |
| `app/page.tsx` | **Modify.** Pass `role`/`trueRole` instead of `initialRole`/`locked` |
| `lib/rbac/viewAs.ts` | **Create.** `requestViewAs(role)` — the one client-side fetch-and-reload, shared by both UI pieces |
| `components/rbac/RoleSwitcher.tsx` | **Rewrite.** Real, server-backed switcher; Sales/Client/Pending, Sales first |
| `app/api/auth/view-as/route.ts` | **Create.** `POST` — validates the role, checks `trueRole`, re-signs the session |
| `app/api/auth/view-as/route.test.ts` | **Create.** Authorization-uses-trueRole, validation, cookie contents |
| `components/rbac/ViewAsBanner.tsx` | **Create.** Persistent "Viewing as X · Exit", keyed off `trueRole` |
| `components/apmg/DashboardShell.tsx` | **Modify.** Mount `ViewAsBanner` above the sidebar/main row |
| `components/apmg/Sidebar.tsx` | **Modify.** One class fix so the sidebar stretches to its row instead of forcing full viewport height, now that the row can sit below a banner |
| `tests/e2e/auth.spec.ts` | **Modify.** Add the anonymous-caller case for the new route |

---

### Task 1: `RbacProvider` carries `role`/`trueRole`/`canViewAs`, and the real `RoleSwitcher`

**Note (2026-08-04, corrected during implementation):** originally drafted as two separate tasks. The first implementer attempt correctly caught that `RoleSwitcher.tsx` is the only other consumer of `RbacProvider`'s context shape, and it still destructures `setRole`/`devMode` — fields this task removes. Splitting the provider change from the switcher rewrite leaves `tsc --noEmit` broken in the gap between them, so they are merged into one task. No code below changed as a result — only the task boundary.

**Files:**
- Modify (full rewrite): `lib/rbac/RbacProvider.tsx`
- Modify: `app/page.tsx:34`
- Create: `lib/rbac/viewAs.ts`
- Modify (full rewrite): `components/rbac/RoleSwitcher.tsx`

**Interfaces:**
- Consumes: `roleCan`, `ROLES`, `isRole`, `type Role` (`lib/rbac/roles.ts`); `type Permission` (`lib/rbac/permissions.ts`); `POST /api/auth/view-as` (Task 2 — doesn't need to exist yet for this task to compile; `fetch` has no compile-time dependency on the route existing)
- Produces: `<RbacProvider role={Role} trueRole={Role}>`; `useRbac(): { role, roleLabel, can, trueRole, canViewAs }`; `useCan(perm)` (unchanged signature); `requestViewAs(role: Role | null): Promise<boolean>`; `<RoleSwitcher />` — renders nothing unless `canViewAs`

No automated test for this task — it's a React context plus presentational components with no new decision logic (the interesting logic, `effectiveRole`/`roleCan`, already lives in Phase 1's tested modules). Verified by `tsc --noEmit` plus the manual check in Step 6.

- [ ] **Step 1: Confirm `app/page.tsx` is the only `<RbacProvider>` caller**

```bash
grep -rn "RbacProvider" --include="*.tsx" .
```

Expected: exactly one JSX instantiation, in `app/page.tsx`. Everywhere else is `useRbac()`/`useCan()` calls, which this task doesn't change the shape of (`can`, `role`, `roleLabel` all stay). If you see a second instantiation, stop — this plan was written against a specific snapshot of the branch and something has changed.

- [ ] **Step 2: Rewrite `RbacProvider.tsx`**

Replace the entire contents of `lib/rbac/RbacProvider.tsx`:

```tsx
"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { type Permission } from "./permissions";
import { ROLES, roleCan, type Role } from "./roles";

interface RbacValue {
  /** Effective role: trueRole, or an authorised view-as override. */
  role: Role;
  roleLabel: string;
  can: (perm: Permission) => boolean;
  /** What app_users actually says this user is. The view-as switcher and
   *  banner key off THIS, never off `role` — otherwise an admin previewing a
   *  role that itself lacks roles.viewas (every non-admin role) would have
   *  no way back to their own console. */
  trueRole: Role;
  /** Whether this user may preview the console as another role. */
  canViewAs: boolean;
}

const RbacContext = createContext<RbacValue | null>(null);

/**
 * Provides the current user's role + permission checks. Both `role` and
 * `trueRole` come straight from the server-resolved session (see
 * lib/rbac/server.ts's resolveSession) — middleware guarantees a valid
 * session exists before this ever mounts, so there is no unauthenticated or
 * client-editable state here. (Earlier revisions of this file had a
 * dev-only, unauthenticated role preview; app/page.tsx has unconditionally
 * passed a real, server-resolved role since Phase 1, which made that
 * mechanism permanently unreachable. It's gone — this is the real thing.)
 */
export function RbacProvider({
  role,
  trueRole,
  children,
}: {
  role: Role;
  trueRole: Role;
  children: ReactNode;
}) {
  const value = useMemo<RbacValue>(
    () => ({
      role,
      roleLabel: ROLES[role].label,
      can: (perm: Permission) => roleCan(role, perm),
      trueRole,
      canViewAs: roleCan(trueRole, "roles.viewas"),
    }),
    [role, trueRole],
  );

  return <RbacContext.Provider value={value}>{children}</RbacContext.Provider>;
}

export function useRbac(): RbacValue {
  const ctx = useContext(RbacContext);
  if (!ctx) throw new Error("useRbac must be used within <RbacProvider>");
  return ctx;
}

export function useCan(perm: Permission): boolean {
  return useRbac().can(perm);
}
```

- [ ] **Step 3: Update `app/page.tsx`**

In `app/page.tsx`, change line 34 from:

```tsx
    <RbacProvider initialRole={session.role} locked>
```

to:

```tsx
    <RbacProvider role={session.role} trueRole={session.trueRole}>
```

- [ ] **Step 4: Write the shared client helper**

Create `lib/rbac/viewAs.ts`:

```ts
import type { Role } from "./roles";

/**
 * POSTs the requested preview role (or null to exit a preview) and reloads
 * the page on success so server components re-render under the new
 * effective role. The server re-checks roleCan(trueRole, "roles.viewas")
 * itself (app/api/auth/view-as/route.ts) — this is a UI convenience, never
 * the enforcement. Returns whether the request succeeded, so a caller can
 * clear its own pending/loading state on failure without reloading.
 */
export async function requestViewAs(role: Role | null): Promise<boolean> {
  const res = await fetch("/api/auth/view-as", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (res.ok) window.location.reload();
  return res.ok;
}
```

- [ ] **Step 5: Rewrite `RoleSwitcher.tsx`**

Replace the entire contents of `components/rbac/RoleSwitcher.tsx`:

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { useRbac } from "@/lib/rbac/RbacProvider";
import { requestViewAs } from "@/lib/rbac/viewAs";
import { ROLES, type Role } from "@/lib/rbac/roles";

// Sales is the role checked most often when previewing, so it's listed
// first. Admin is deliberately excluded from the options: the only audience
// who can ever see this switcher (roleCan(trueRole, "roles.viewas")) IS
// admin, so offering it as a preview target would just be a no-op button —
// ViewAsBanner's Exit is the way back to the real Admin view.
const PREVIEW_ROLES: readonly Role[] = ["sales", "client", "pending"];

/**
 * Lets an admin preview the console as another role. Rendering here is a UI
 * convenience only — POST /api/auth/view-as re-checks roleCan(trueRole,
 * "roles.viewas") itself, so a forged request from a non-admin is refused
 * regardless of what this component does or doesn't show.
 */
export function RoleSwitcher() {
  const { role, canViewAs } = useRbac();
  const [pending, setPending] = useState(false);

  if (!canViewAs) return null;

  async function selectRole(next: Role) {
    setPending(true);
    const ok = await requestViewAs(next);
    if (!ok) setPending(false);
  }

  return (
    <div className="rounded-md border border-dashed border-border bg-background/40 p-1.5">
      <div className="mb-1 px-1 font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        View as
      </div>
      <div className="flex gap-1">
        {PREVIEW_ROLES.map((r) => {
          const def = ROLES[r];
          const isActive = r === role;
          return (
            <button
              key={r}
              type="button"
              disabled={pending}
              onClick={() => selectRole(r)}
              data-track="view_as_switch"
              data-track-role={r}
              aria-pressed={isActive}
              title={def.description}
              className={cn(
                "flex-1 rounded px-1.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] transition-colors",
                isActive
                  ? "bg-primary-solid text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground",
                pending && "cursor-not-allowed opacity-60",
              )}
            >
              {def.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean. (If it isn't, the most likely cause is a second `<RbacProvider>` caller Step 1 missed, or a third file besides `RoleSwitcher.tsx` reading `setRole`/`devMode` off `useRbac()` — search again rather than patching around it.)

- [ ] **Step 7: Manual check**

Run `npm run dev`, sign in as `kane@apmgservices.com.au` (or whichever address resolves to `admin` in your environment — demo mode maps `MAIN_ADMIN_EMAIL` to `admin` when Supabase isn't configured). Confirm the dashboard loads normally, then open the sidebar. Expected: a "View as" control above the theme toggle, listing Sales, Client, Pending in that order, none active. Click "Sales" — the fetch will 404 (Task 2's route doesn't exist yet), so `requestViewAs` returns `false` and the button re-enables without reloading; that's the correct behaviour for this task's state. Sign in as a non-admin (or, in demo mode, any email other than the main admin) and confirm the control is entirely absent.

- [ ] **Step 8: Commit**

```bash
git add lib/rbac/RbacProvider.tsx app/page.tsx lib/rbac/viewAs.ts components/rbac/RoleSwitcher.tsx
git commit -m "Replace the dead dev-preview switcher with a real, server-backed one

RbacProvider now carries trueRole and canViewAs from the server —
app/page.tsx's unconditional locked=true has made the old client-side
preview mechanism unreachable since Phase 1. RoleSwitcher changes in
the same commit since it's the only other consumer of the context
shape being replaced. Sales, Client, Pending — Sales first since it's
checked most often; Admin is excluded as a target (this switcher's
only audience already is admin). The switcher POSTs to
/api/auth/view-as, added next."
```

---

### Task 2: `POST /api/auth/view-as`

**Files:**
- Create: `app/api/auth/view-as/route.ts`
- Create: `app/api/auth/view-as/route.test.ts`

**Interfaces:**
- Consumes: `SESSION_COOKIE`, `verifySession`, `signSession`, `sessionCookieOptions` (`lib/auth/session.ts`); `isRole`, `roleCan`, `type Role` (`lib/rbac/roles.ts`); `getUserRole` (`lib/auth/userStore.ts`); `sameOrigin` (`lib/pipeline/server.ts`)
- Produces: `POST /api/auth/view-as` — body `{ role: Role | null }` → `200 { ok: true, role }` and a re-signed session cookie; `401`/`403`/`400`/`403` (bad origin) on failure

This route deliberately does **not** call `resolveSession`/`requirePermission` from `lib/rbac/server.ts` — see the Global Constraints note. It also deliberately re-implements the same small defensive cookie-decode as `resolveSession`, rather than extracting a shared helper: `lib/rbac/server.test.ts` mocks `verifySession` at the module-export boundary, and a shared helper's *internal* call to it would bypass that mock silently (a same-module function call is a closure reference, not a re-import — module mocking only intercepts the latter). Duplicating ~8 well-understood lines here is cheaper than that risk.

- [ ] **Step 1: Write the failing tests**

Create `app/api/auth/view-as/route.test.ts`:

```ts
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const getUserRole = vi.fn();
vi.mock("@/lib/auth/userStore", () => ({
  getUserRole: (...a: unknown[]) => getUserRole(...a),
}));

import { SESSION_COOKIE, signSession, verifySession } from "@/lib/auth/session";
import type { Role } from "@/lib/rbac/roles";
import { POST } from "./route";

const ADMIN = "kane@apmgservices.com.au";
const REP = "rep@apmgservices.com.au";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret-value-at-least-32-bytes-long!!";
});

beforeEach(() => {
  vi.clearAllMocks();
});

function reqWith(headers: Record<string, string>, body: unknown): Request {
  return new Request("http://local/api/auth/view-as", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function reqAs(email: string, body: unknown, viewAs: Role | null = null): Promise<Request> {
  const token = await signSession({ email, viewAs });
  return reqWith({ cookie: `${SESSION_COOKIE}=${token}` }, body);
}

function setCookieValue(res: Response): string {
  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) throw new Error("no session cookie in response");
  return decodeURIComponent(match[1]);
}

describe("POST /api/auth/view-as — same-origin floor", () => {
  it("rejects a cross-origin Origin header even with a valid admin session", async () => {
    getUserRole.mockResolvedValue("admin");
    const token = await signSession({ email: ADMIN });
    const res = await POST(
      reqWith({ cookie: `${SESSION_COOKIE}=${token}`, origin: "https://evil.example" }, { role: "sales" }),
    );
    expect(res.status).toBe(403);
    expect(getUserRole).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/view-as — authentication", () => {
  it("401s with no session cookie", async () => {
    const res = await POST(reqWith({}, { role: "sales" }));
    expect(res.status).toBe(401);
    expect(getUserRole).not.toHaveBeenCalled();
  });

  it("401s a garbage cookie value", async () => {
    const res = await POST(reqWith({ cookie: `${SESSION_COOKIE}=garbage` }, { role: "sales" }));
    expect(res.status).toBe(401);
  });
});

describe("POST /api/auth/view-as — authorization uses trueRole, not the effective role", () => {
  it("403s a real 'sales' trueRole even for an otherwise-valid session", async () => {
    getUserRole.mockResolvedValue("sales");
    const res = await POST(await reqAs(REP, { role: "client" }));
    expect(res.status).toBe(403);
  });

  it("403s pending", async () => {
    getUserRole.mockResolvedValue("pending");
    const res = await POST(await reqAs(REP, { role: "sales" }));
    expect(res.status).toBe(403);
  });

  it("allows a real admin", async () => {
    getUserRole.mockResolvedValue("admin");
    const res = await POST(await reqAs(ADMIN, { role: "sales" }));
    expect(res.status).toBe(200);
  });

  it("critical: an admin CURRENTLY PREVIEWING sales can still switch again", async () => {
    // The request the client actually sends from inside an active preview:
    // the incoming cookie already carries viewAs:"sales", so the EFFECTIVE
    // role is "sales". If this route mistakenly gated on the effective role
    // (the way requirePermission does), a previewing admin could never
    // switch again or exit — exactly the trap design doc §9 warns about.
    getUserRole.mockResolvedValue("admin");
    const res = await POST(await reqAs(ADMIN, { role: "client" }, "sales"));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/auth/view-as — validation", () => {
  beforeEach(() => getUserRole.mockResolvedValue("admin"));

  it("rejects a role outside the catalog", async () => {
    const res = await POST(await reqAs(ADMIN, { role: "superuser" }));
    expect(res.status).toBe(400);
  });

  it("rejects a role that is an inherited object property", async () => {
    const res = await POST(await reqAs(ADMIN, { role: "constructor" }));
    expect(res.status).toBe(400);
  });

  it("rejects a missing role key", async () => {
    const res = await POST(await reqAs(ADMIN, {}));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed JSON body", async () => {
    const token = await signSession({ email: ADMIN });
    const res = await POST(
      new Request("http://local/api/auth/view-as", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `${SESSION_COOKIE}=${token}` },
        body: "{not json",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("accepts null to exit a preview", async () => {
    const res = await POST(await reqAs(ADMIN, { role: null }));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/auth/view-as — the re-signed session cookie", () => {
  beforeEach(() => getUserRole.mockResolvedValue("admin"));

  it("carries the requested viewAs", async () => {
    const res = await POST(await reqAs(ADMIN, { role: "sales" }));
    const claims = await verifySession(setCookieValue(res));
    expect(claims?.email).toBe(ADMIN);
    expect(claims?.viewAs).toBe("sales");
  });

  it("clears viewAs when exiting", async () => {
    const res = await POST(await reqAs(ADMIN, { role: null }, "sales"));
    const claims = await verifySession(setCookieValue(res));
    expect(claims?.viewAs).toBeNull();
  });

  it("preserves name and picture across the change", async () => {
    const token = await signSession({ email: ADMIN, name: "Kane Reroma", picture: "https://example/p.png" });
    const res = await POST(
      reqWith({ cookie: `${SESSION_COOKIE}=${token}` }, { role: "sales" }),
    );
    const claims = await verifySession(setCookieValue(res));
    expect(claims?.name).toBe("Kane Reroma");
    expect(claims?.picture).toBe("https://example/p.png");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run app/api/auth/view-as/route.test.ts`
Expected: FAIL — cannot resolve `./route`.

- [ ] **Step 3: Write the route**

Create `app/api/auth/view-as/route.ts`:

```ts
import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/pipeline/server";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  verifySession,
} from "@/lib/auth/session";
import { getUserRole } from "@/lib/auth/userStore";
import { isRole, roleCan, type Role } from "@/lib/rbac/roles";

/**
 * Lets an admin preview the console as another role.
 *
 * Deliberately does NOT use requirePermission (lib/rbac/server.ts): that
 * checks the EFFECTIVE role, which is whatever is currently being previewed.
 * An admin previewing "sales" would then be gated on
 * roleCan("sales", "roles.viewas") — false — and could never switch again or
 * exit. Authorization here always reads trueRole straight from app_users,
 * never the active viewAs claim.
 */
export const runtime = "nodejs";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * Mirrors lib/rbac/server.ts's resolveSession — see its comment for why the
 * decode must never throw. Not shared: that file's tests mock verifySession
 * at the module-export boundary, and a shared helper's internal call to it
 * would silently bypass those mocks (a same-module reference is a closure,
 * not a re-import — vi.mock only intercepts the latter).
 */
async function claimsFromCookie(req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const raw = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  let token: string | undefined;
  try {
    token = raw ? decodeURIComponent(raw) : undefined;
  } catch {
    token = undefined;
  }
  return verifySession(token);
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: "Bad origin" }, 403);

  const claims = await claimsFromCookie(req);
  if (!claims) return json({ error: "Not authenticated" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const raw = (body ?? {}) as { role?: unknown };
  if (raw.role !== null && !isRole(raw.role)) {
    return json({ error: "Role must be a known role name or null." }, 400);
  }
  const requested: Role | null = raw.role;

  // Straight from app_users, never the active viewAs on the incoming
  // cookie — see the file comment.
  const trueRole = await getUserRole(claims.email);
  if (!roleCan(trueRole, "roles.viewas")) {
    return json({ error: "Forbidden — missing permission: roles.viewas" }, 403);
  }

  const res = NextResponse.json({ ok: true, role: requested });
  res.cookies.set(
    SESSION_COOKIE,
    await signSession({
      email: claims.email,
      name: claims.name,
      picture: claims.picture,
      viewAs: requested,
    }),
    sessionCookieOptions(),
  );
  return res;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run app/api/auth/view-as/route.test.ts`
Expected: PASS — 13 tests.

- [ ] **Step 5: Typecheck and build**

Run: `npx tsc --noEmit && npx next build`
Expected: both clean.

- [ ] **Step 6: Manual check with curl**

With `npm run dev` running and signed in as an admin in the browser, copy the `apmg_session` cookie value from devtools (Application → Cookies) and:

```bash
curl -i -X POST http://localhost:3000/api/auth/view-as \
  -H "Content-Type: application/json" \
  --cookie "apmg_session=<paste value>" \
  -d '{"role":"sales"}'
```

Expected: `200`, a `Set-Cookie: apmg_session=...` header in the response, and a JSON body `{"ok":true,"role":"sales"}`. Then repeat with no `--cookie` flag at all — expected `401`.

- [ ] **Step 7: Commit**

```bash
git add app/api/auth/view-as/
git commit -m "Add POST /api/auth/view-as

Re-signs the session with a viewAs claim after checking roleCan
against trueRole — never the effective role, which would strand a
previewing admin. Mirrors, rather than shares, resolveSession's cookie
decode to avoid silently bypassing that file's existing test mocks."
```

---

### Task 3: `ViewAsBanner` and mounting it

**Files:**
- Create: `components/rbac/ViewAsBanner.tsx`
- Modify: `components/apmg/DashboardShell.tsx:76-175`
- Modify: `components/apmg/Sidebar.tsx:98`

**Interfaces:**
- Consumes: `useRbac` (`lib/rbac/RbacProvider.tsx`, Task 1); `requestViewAs` (`lib/rbac/viewAs.ts`, Task 1); `ROLES` (`lib/rbac/roles.ts`); `Button` (`components/ui/button.tsx`)
- Produces: `<ViewAsBanner />` — renders nothing unless currently previewing

- [ ] **Step 1: Write `ViewAsBanner.tsx`**

Create `components/rbac/ViewAsBanner.tsx`:

```tsx
"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useRbac } from "@/lib/rbac/RbacProvider";
import { requestViewAs } from "@/lib/rbac/viewAs";
import { ROLES } from "@/lib/rbac/roles";

/**
 * Keyed off trueRole, not the effective role — an admin previewing any
 * non-admin role (every role but their own) would otherwise have no way
 * back, since none of those roles hold roles.viewas themselves.
 */
export function ViewAsBanner() {
  const { role, trueRole, canViewAs } = useRbac();
  const [exiting, setExiting] = useState(false);

  if (!canViewAs || role === trueRole) return null;

  async function exit() {
    setExiting(true);
    const ok = await requestViewAs(null);
    if (!ok) setExiting(false);
  }

  return (
    <div
      role="status"
      className="flex shrink-0 items-center justify-center gap-3 bg-primary-solid px-3 py-1.5 text-xs font-medium text-primary-foreground"
    >
      <span>
        Viewing as <span className="font-semibold">{ROLES[role].label}</span>
      </span>
      <Button
        type="button"
        variant="ghost"
        size="xs"
        disabled={exiting}
        onClick={exit}
        className="text-primary-foreground hover:bg-primary-foreground/10"
      >
        Exit
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Mount it in `DashboardShell.tsx`**

Add the import near the other `components/rbac`/`components/apmg` imports at the top of `components/apmg/DashboardShell.tsx`:

```tsx
import { ViewAsBanner } from "@/components/rbac/ViewAsBanner";
```

Change the root `return` (currently lines 76–175) from:

```tsx
  return (
    <div className="flex h-dvh max-h-dvh w-full overflow-hidden">
      <Sidebar
        activeTab={activeTab}
        onNavigate={navigate}
        mobileOpen={navOpen}
        onClose={() => setNavOpen(false)}
        inert={inspectorOpen}
        user={user}
      />

      {/* mobile drawer backdrop */}
      {navOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] md:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}

      <main
        inert={navOpen || inspectorOpen || undefined}
        className="chassis-grain relative flex min-w-0 flex-1 flex-col overflow-hidden"
      >
        {/* ...unchanged interior... */}
      </main>

      {can("sales.view") && (
        <SalesArrivalsModal
          suppressed={activeTab === "sales"}
          onOpenSales={() => navigate("sales")}
        />
      )}

      <TelemetryInspector open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
      <ClickPing />
    </div>
  );
```

to:

```tsx
  return (
    <div className="flex h-dvh max-h-dvh w-full flex-col overflow-hidden">
      <ViewAsBanner />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          onNavigate={navigate}
          mobileOpen={navOpen}
          onClose={() => setNavOpen(false)}
          inert={inspectorOpen}
          user={user}
        />

        {/* mobile drawer backdrop */}
        {navOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] md:hidden"
            onClick={() => setNavOpen(false)}
            aria-hidden
          />
        )}

        <main
          inert={navOpen || inspectorOpen || undefined}
          className="chassis-grain relative flex min-w-0 flex-1 flex-col overflow-hidden"
        >
          {/* ...unchanged interior... */}
        </main>
      </div>

      {can("sales.view") && (
        <SalesArrivalsModal
          suppressed={activeTab === "sales"}
          onOpenSales={() => navigate("sales")}
        />
      )}

      <TelemetryInspector open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
      <ClickPing />
    </div>
  );
```

Only the wrapping structure changes — the `<Sidebar>` props, the backdrop, and everything inside `<main>` stay exactly as they were; move them as a block rather than retyping them.

- [ ] **Step 3: Fix the sidebar's height for its new row**

`Sidebar.tsx`'s `<aside>` currently hardcodes `h-dvh` at every breakpoint (line 98). On mobile that's correct — it's `fixed`, which escapes normal layout and needs an explicit height. From `md:` up it's `relative`, a flex item in the row you just added in Step 2 — forcing a full-viewport height there makes it taller than that row whenever `ViewAsBanner` is present above it (the row is now `100dvh` minus the banner's height, but the sidebar would still claim the full `100dvh`).

In `components/apmg/Sidebar.tsx`, change line 98 from:

```tsx
        "fixed inset-y-0 left-0 z-50 flex h-dvh shrink-0 flex-col border-r border-border bg-card px-5 pb-4 pt-7 outline-none [transition:width_500ms_cubic-bezier(0.16,1,0.3,1),transform_300ms_ease-out] md:relative md:z-30 md:translate-x-0",
```

to:

```tsx
        // h-dvh only up to md: fixed positioning (mobile) needs an explicit
        // height since it escapes normal layout. From md up this is a flex
        // item in DashboardShell's row and must stretch to fill it instead —
        // md:h-auto lets flex's default align-items:stretch do that, rather
        // than overflowing the row whenever ViewAsBanner adds height above it.
        "fixed inset-y-0 left-0 z-50 flex h-dvh shrink-0 flex-col border-r border-border bg-card px-5 pb-4 pt-7 outline-none [transition:width_500ms_cubic-bezier(0.16,1,0.3,1),transform_300ms_ease-out] md:relative md:h-auto md:z-30 md:translate-x-0",
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npx next build`
Expected: both clean.

- [ ] **Step 5: Manual check**

Sign in as an admin, open the sidebar, click "Sales" in the "View as" control. Expected: the page reloads; a red banner reading "Viewing as Sales" with an "Exit" button now sits above the sidebar and main content, on both desktop and mobile widths (resize the window to check); the sidebar is not visually cut off or overflowing at any width; clicking "Exit" reloads back to the real Admin view and the banner disappears.

- [ ] **Step 6: Commit**

```bash
git add components/rbac/ViewAsBanner.tsx components/apmg/DashboardShell.tsx components/apmg/Sidebar.tsx
git commit -m "Add the persistent view-as banner and exit path

Keyed off trueRole so it's reachable even while previewing a role
that itself lacks roles.viewas. Sidebar's height fix keeps it from
overflowing its row now that a banner can sit above it."
```

---

### Task 4: E2E regression test and final verification pass

**Files:**
- Modify: `tests/e2e/auth.spec.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: one additional Playwright test

- [ ] **Step 1: Add the anonymous-caller regression test**

In `tests/e2e/auth.spec.ts`, add a new test after the existing `"admin API routes reject anonymous callers"` test:

```ts
test("the view-as endpoint rejects anonymous callers", async ({ request }) => {
  const res = await request.post("/api/auth/view-as", { data: { role: "sales" } });
  expect(res.status()).toBe(401);
});
```

(Authenticated view-as scenarios — the switcher appearing, the banner, the trueRole-not-effective-role authorization case — are already covered by Task 2's unit tests, which mint real signed sessions directly rather than needing a live Google sign-in, and by the manual checks in Tasks 1 and 3. There's no way to fake a Google OAuth sign-in in Playwright without adding a test-only auth bypass to production code, which this project has deliberately avoided everywhere else.)

- [ ] **Step 2: Run it**

Run: `npx playwright test tests/e2e/auth.spec.ts`
Expected: PASS, including the new test and every pre-existing one.

- [ ] **Step 3: Full gate**

Run, in order:

```bash
npx tsc --noEmit
npx next build
npx vitest run
npx playwright test
```

Expected: all clean/passing.

- [ ] **Step 4: End-to-end manual script**

With `npm run dev` running:

1. Sign in as the main admin. Confirm you land on the real Admin Overview (not Sales, not a blank state).
2. Open the sidebar's "View as" control. Confirm it lists Sales, Client, Pending in that order, and Admin is not one of the options.
3. Click "Sales". Confirm: full reload; the "Viewing as Sales" banner appears; the sidebar now shows Sales's tabs (no Leads, a Sales tab present); an admin-only action (e.g. the Settings → Roles and Permissions tab) is gone.
4. While previewing Sales, click "View as" again and switch to "Client" without hitting Exit first. Confirm it works (this is the case Task 2's "critical" test covers — authorization must key off `trueRole`, not the currently-active preview).
5. Click "Exit" on the banner. Confirm: full reload; banner gone; back on the real Admin view with every admin-only surface visible again.
6. Sign out, sign in as a non-admin address (or, in demo mode, any address other than the main admin). Confirm the "View as" control is entirely absent from the sidebar.
7. From that non-admin session, run the curl command from Task 2 Step 6 using that session's cookie. Confirm `403`, not `200` — a forged client request cannot self-grant the preview.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/auth.spec.ts
git commit -m "Add E2E regression: view-as endpoint rejects anonymous callers"
```
