# Session 07 — Role-Based Access Control (permission-first)

> **Session ID:** `c954dda6-aca5-469e-a4f7-970fb907d272` *(continuation — same session as [Session 01](01-ui-foundation-dashboard.md), after the UI-foundation work)*
> **Date:** 2026-06-29, ~03:00 onward local (the session ran 01:19–08:49 local in total; RBAC was built after the KPI/greeting work in doc 01)
> **Status:** ✅ Built and build-verified. Enforcement is real (permission checks), but the **server-side role resolution is an explicit placeholder** — not production-safe until a verified Supabase session replaces it.
> **Primary tools used:** Write, Edit, Read, Bash (`next build`, Playwright via `_shot.mjs`), Workflow (earlier in session)
> **Related sessions:** [01-ui-foundation-dashboard.md](01-ui-foundation-dashboard.md) · [08-sales-pipeline-attribution.md](08-sales-pipeline-attribution.md) · [12-overview-role-aware-redesign.md](12-overview-role-aware-redesign.md)

## Objective

> "alright lets implement RBAC on this and make ssure the Role is a collection of permission. We will have admin, client and sales but lets hold on for sales for now"

Add role-based access control to the dashboard so the surface a user sees is driven by **permissions**, with **admin** and **client** active immediately and **sales** defined-but-reserved for later.

## TL;DR

Built a **permission-first** RBAC layer: roles are bundles of atomic `resource.action` permissions, and every gate in the app checks a *permission*, never a role string — so adding or changing a role is pure data (this is exactly why enabling `sales` later, in [Session 08](08-sales-pipeline-attribution.md), required no enforcement changes). The nav, the dashboard shell, the sidebar, and the telemetry button all gate on permissions; a dev-only role switcher previews any role. The server guard exists but resolves the role from a client-set cookie/header as a **temporary placeholder**, clearly flagged as not trustworthy until a real Supabase session is wired in.

## What happened

1. **Designed the catalog.** Created [lib/rbac/permissions.ts](../../lib/rbac/permissions.ts) — an atomic permission catalog using `resource.action` naming (e.g. `overview.view`, `telemetry.view`, `pipeline.view`), with `ALL_PERMISSIONS` and a `permissionLabel` helper.
2. **Defined roles as bundles.** [lib/rbac/roles.ts](../../lib/rbac/roles.ts) — each role is a set of permissions; `roleCan()`, `assignableRoles()`, `DEFAULT_ROLE = admin`. Per the user's "hold on for sales", `sales` was fully defined but `enabled: false`.
3. **Client context.** [lib/rbac/RbacProvider.tsx](../../lib/rbac/RbacProvider.tsx) — provides `useRbac()` / `useCan()`, with a **dev-only** role override persisted to `localStorage` under `apmg-role` (so a developer can preview a role). In production the role comes from `RbacProvider.initialRole`.
4. **Server guard (placeholder).** [lib/rbac/server.ts](../../lib/rbac/server.ts) — `requirePermission()` / `guardResponse()` that, **temporarily**, resolve the role from an `apmg-role` cookie or `x-apmg-role` header. A prominent comment marks this as NOT trustworthy and to be replaced by a verified session.
5. **Gate components.** [components/rbac/Can.tsx](../../components/rbac/Can.tsx) (declarative permission gate) and [components/rbac/RoleSwitcher.tsx](../../components/rbac/RoleSwitcher.tsx) (dev-only preview switcher).
6. **Wired enforcement across the app.** Added a `perm` field to every nav item in [lib/nav.ts](../../lib/nav.ts); added `TAB_PERMISSION` and `firstAllowedTab`; [Sidebar.tsx](../../components/apmg/Sidebar.tsx) now filters the nav by permission and shows the role pill + switcher; [DashboardShell.tsx](../../components/apmg/DashboardShell.tsx) redirects to the first allowed tab if the active one isn't permitted; the telemetry button in [CommandBar.tsx](../../components/apmg/CommandBar.tsx) is wrapped in `<Can perm="telemetry.view">`; mounted `RbacProvider` in [app/page.tsx](../../app/page.tsx).

## Files created / modified

| File | Type | Purpose |
|---|---|---|
| [lib/rbac/permissions.ts](../../lib/rbac/permissions.ts) | created | Atomic permission catalog (`resource.action`); `ALL_PERMISSIONS`, `permissionLabel`. |
| [lib/rbac/roles.ts](../../lib/rbac/roles.ts) | created | Roles as permission bundles; `roleCan`, `assignableRoles`, `DEFAULT_ROLE`. `sales` defined but `enabled:false` initially. |
| [lib/rbac/RbacProvider.tsx](../../lib/rbac/RbacProvider.tsx) | created | Client context; `useRbac`/`useCan`; dev-only role override (`apmg-role` localStorage). |
| [lib/rbac/server.ts](../../lib/rbac/server.ts) | created | Server guard `requirePermission`/`guardResponse`; **TEMP** cookie/header role resolution (placeholder). |
| [components/rbac/Can.tsx](../../components/rbac/Can.tsx) | created | Declarative permission gate. |
| [components/rbac/RoleSwitcher.tsx](../../components/rbac/RoleSwitcher.tsx) | created | Dev-only role preview switcher. |
| [lib/nav.ts](../../lib/nav.ts) | modified | Added `perm` per nav item; `TAB_PERMISSION`, `firstAllowedTab`. |
| [app/page.tsx](../../app/page.tsx) | modified | Mounts `RbacProvider` around the shell. |
| [components/apmg/DashboardShell.tsx](../../components/apmg/DashboardShell.tsx) | modified | Redirects to first allowed tab when the active tab isn't permitted. |
| [components/apmg/Sidebar.tsx](../../components/apmg/Sidebar.tsx) | modified | Permission-filtered nav + role pill + role switcher. |
| [components/apmg/CommandBar.tsx](../../components/apmg/CommandBar.tsx) | modified | Telemetry button wrapped in `<Can perm="telemetry.view">`. |

## Key decisions & rationale

- **Check a permission, never a role.** Enforcement everywhere keys off a permission. Roles are just named bundles of permissions, so role changes are data, not code — the central design choice and the reason `sales` could be enabled later without touching any gate.
- **Define `sales` but disable it.** Honoured "hold on for sales for now": the role was fully specified with `enabled: false`, then flipped on when the Sales tab was built in [Session 08](08-sales-pipeline-attribution.md).
- **Dev role override is dev-only.** The switcher / `localStorage` override is gated to `NODE_ENV !== "production"`. In production the role comes from the (future Supabase) session via `RbacProvider.initialRole`. This is why RBAC had to be screenshot under `next dev`, not `next start`.
- **Server guard is honestly a placeholder.** `server.ts` reads the role from a client-set cookie/header with a loud comment that this is spoofable and must be replaced by a verified session before any real enforcement.

## Problems encountered & resolutions

- **Edit failed to match in `DashboardShell`** ("string to replace not found") because the user was live-editing the file. Resolved by re-reading the current file and re-placing the guard.
- **Transient mid-edit TypeScript diagnostics** during multi-edit sequences (unused imports, a tab id not yet in `TAB_LABEL`) — expected churn, resolved by the following edits; the build confirmed clean.
- **RBAC isn't provable under `next start`** (dev override disabled in production). Resolved by capturing screenshots from `next dev` on port `:3211`.

## Verification done

- **`next build` (Next 16.2.9, Turbopack):** clean after the RBAC wiring (TypeScript passed).
- **Playwright screenshots** (temporary `_shot.mjs`, deleted after use) via `next dev` :3211: `rbac-admin` (full nav + telemetry button + ADMIN pill) and `rbac-client` (Overview only, no telemetry button, CLIENT pill, SALES shown disabled).
- No automated tests; no API gate was exercised at runtime (build + visual only).

## Outcome & final state

A working permission-first RBAC layer with **admin** and **client** active and **sales** reserved. The nav, shell, sidebar, and telemetry button all honour permissions; a dev switcher previews roles. Build green; admin and client states visually confirmed.

## Follow-ups / open items

- **Replace the placeholder server role resolution** with a verified Supabase session. `lib/rbac/server.ts` currently trusts a client-set cookie/header (spoofable); `RbacProvider.initialRole` is the wiring point for the real session role.
- `sales` was enabled later in [Session 08](08-sales-pipeline-attribution.md); the Overview gained a role-aware treatment in [Session 12](12-overview-role-aware-redesign.md), which also granted `sales` the `overview.view` permission.

## Verbatim user request

> alright lets implement RBAC on this and make ssure the Role is a collection of permission. We will have admin, client and sales but lets hold on for sales for now
