# Google SSO + Role-Based Access Control — Design

> **Date:** 2026-08-03
> **Status:** Approved design, not yet implemented
> **Scope:** Replace the placeholder login with Google Workspace SSO as the sole
> sign-in path, persist users and roles in Supabase, enforce permissions on the
> API surface, and add a Roles & Permissions admin tab plus a view-as switcher.

## 1. Why

`/login` today is decorative and the console behind it is effectively open:

- `lib/auth/users.ts` holds a hardcoded 5-person list and one shared plaintext
  password (`SHARED_PASSWORD = "apmgservices"`).
- `lib/auth/session.ts` sets `apmg-role` and `apmg-user` from the **browser**.
  `lib/rbac/server.ts` then trusts `apmg-role` verbatim, so anyone can grant
  themselves any role with one line in a devtools console.
- `DEFAULT_ROLE` is `"admin"`, and nothing gates the dashboard, so visiting `/`
  with no cookies at all yields the full admin console.
- Of 25 API routes, exactly **one** (`app/api/sales/summary/route.ts`) checks a
  permission. The other 14 admin routes rely only on `sameOrigin()`, which
  returns `true` when the `Origin` header is absent — and a plain `curl` omits
  it. `curl https://<host>/api/pipeline/leads` therefore returns the lead
  database to anyone who knows the URL.

The two SSO buttons already on the login page are inert placeholders
(`title="Single sign-on coming soon"`, no handler).

## 2. Goals / non-goals

**Goals**

1. Google Workspace is the only door into the admin console.
2. Any account on the Workspace domain can sign in, landing with **no access**
   until an admin grants a role.
3. Roles are stored in the database and manageable from the UI.
4. `kane@apmgservices.com.au` is the protected main admin.
5. Permissions are enforced server-side on every admin API route.
6. An admin can view the console as another role, with the server enforcing that
   role so the preview is truthful.

**Non-goals**

- The customer portal (`/portal`, `/t/*`, `/api/portal/*`) is unchanged and stays
  public. Nothing in this design may alter portal behaviour.
- No password auth, no magic links, no self-service signup.
- No Microsoft Entra sign-in (see §10 for why the button is being removed).
- No refresh tokens or Google API access on behalf of users — sign-in only.

## 3. Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Access model | **Auto-admit** any account on the Workspace domain | Zero provisioning friction; the default role carries the safety |
| Default role | New **`pending`** role, zero permissions | Auto-admit is only safe if a fresh account can't reach lead data or send email |
| View switcher | **Server-enforced** effective role | A preview that lies is worse than none; this doubles as a live test of enforcement |
| Auth stack | **Hand-rolled OAuth 2.0 + `jose`-signed cookie** | Matches this codebase's deliberately lean, hand-rolled style (8 runtime deps, no `supabase-js`); no Next 16 compat risk; Edge-compatible via Web Crypto |
| Role in session? | **No — identity only; role read from DB per request** | Role changes take effect immediately, which is the point of a management UI |
| Shared password | **Deleted** | A live plaintext password is a second door that bypasses SSO entirely |

### Rejected alternatives

- **Auth.js v5 (`next-auth`)** — well-tested, but v5 targeted Next 14/15 and this
  project is on Next 16. Auth breaking on a framework bump is a bad failure mode,
  and it brings opinionated conventions into an un-opinionated codebase.
- **Supabase Auth** — what the original roadmap named, but the app has no
  `supabase-js` today (raw REST + service role). Adopting it means two deps, an
  anon key client-side, session refresh inside Edge middleware, and a roles table
  anyway since `auth.users` holds no roles. Most change, least gain.

## 4. Prerequisite (manual, outside the repo)

In Google Cloud Console, under the APMG Workspace tenancy:

1. Create an **OAuth 2.0 Client ID** (type: Web application).
2. Set the consent screen to **Internal**. This matters twice: External leaves
   the app in Testing mode where refresh tokens expire every 7 days (the trap
   recorded in session doc 32), and Internal restricts consent to Workspace
   accounts — a second enforcement layer behind our own domain check.
3. Register an **Authorized redirect URI per origin** that needs to sign in.
   Google requires exact matches, so production, any preview origin, and
   `http://localhost:3000` each need their own entry:
   `<origin>/api/auth/google/callback`

New environment variables:

| Variable | Purpose |
|---|---|
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth client ID |
| `GOOGLE_OAUTH_CLIENT_SECRET` | OAuth client secret |
| `AUTH_SECRET` | 32-byte random value, base64. Signs the session cookie |
| `GOOGLE_ALLOWED_DOMAIN` | Defaults to `apmgservices.com.au` |

## 5. Data model

New migration `supabase/app-users.sql`, following the convention of the existing
migration files:

```sql
create table if not exists public.app_users (
  email         text primary key check (email = lower(email)),
  name          text,
  picture_url   text,
  role          text not null default 'pending'
                check (role in ('admin', 'sales', 'client', 'pending')),
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

alter table public.app_users enable row level security;
-- No policies: every read/write goes through the service role, which bypasses
-- RLS. Enabling it with no policies means the anon key can never read this
-- table even if it is introduced later.

insert into public.app_users (email, name, role)
values ('kane@apmgservices.com.au', 'Kane Reroma', 'admin')
on conflict (email) do update set role = 'admin';
```

Emails are lowercased by the application before every read and write; the `check`
constraint makes a mistake fail loudly rather than silently creating a duplicate
identity.

### RBAC catalog changes

- **New role `pending`** in `lib/rbac/roles.ts` — `permissions: []`, `enabled:
  true` so it is assignable (setting someone back to `pending` is how access is
  revoked).
- **New permission `roles.viewas`** in `lib/rbac/permissions.ts` — "View the
  console as another role". Granted to `admin` only. `admin` uses
  `ALL_PERMISSIONS`, so it picks this up automatically.
- **`DEFAULT_ROLE` changes from `"admin"` to `"pending"`** so any fallback path
  fails closed instead of handing out admin.
- Fix the stale comment at `lib/rbac/roles.ts:9`, which claims `sales` is
  `enabled: false` while the code says `true`.

## 6. Phase 1 — The door and enforcement

### 6.1 OAuth flow

New `lib/auth/google.ts` holding the endpoints and claim validation, plus:

**`GET /api/auth/google/start`**
- Generates a random `state` and a PKCE `code_verifier`, stores both in
  short-lived (10 min) `HttpOnly` cookies.
- Redirects to `https://accounts.google.com/o/oauth2/v2/auth` with
  `response_type=code`, `scope=openid email profile`, `access_type=online`
  (no refresh token is wanted or stored), `code_challenge_method=S256`,
  `prompt=select_account`, and `hd=<GOOGLE_ALLOWED_DOMAIN>`.
- `redirect_uri` is derived from the request origin so the same code works in
  dev, preview and production — each origin must be registered (§4).
- A `next` query param is carried through `state` so the user returns to the page
  they were trying to reach. **`next` must be validated as a same-origin relative
  path** — it has to start with a single `/` and must not start with `//` or
  contain a scheme. An unvalidated `next` is an open-redirect vector: an attacker
  could send a staff member a link that completes a genuine Google sign-in and
  then bounces them to a look-alike host, arriving with the credibility of a real
  login. Anything failing validation falls back to `/`.

  **A leading-`//` check alone is not sufficient**, and the first version of this
  spec was wrong to imply it was. WHATWG URL parsers — every browser, and Node's
  `URL` — strip TAB, CR and LF from *anywhere* in a string before interpreting
  its structure, so `/\t/evil.example` passes a naive check and then resolves to
  `//evil.example`. Verified: `new URL("/\t/evil.example", "https://good.example")
  .host === "evil.example"`, reachable through an ordinary percent-encoded query
  param. The guard therefore **rejects the entire control-character class
  (`U+0000`–`U+001F` and `U+007F`) outright** rather than stripping and re-checking:
  refusing the class cannot be reopened by a parser quirk we failed to anticipate,
  whereas an emulated strip-list can. No legitimate in-app path contains these
  characters.

**`GET /api/auth/google/callback`**
- Rejects unless the `state` query param equals the `state` cookie (CSRF).
- Exchanges `code` + `code_verifier` at `https://oauth2.googleapis.com/token`.
- Verifies the `id_token` with `jose.jwtVerify` against Google's JWKS
  (`https://www.googleapis.com/oauth2/v3/certs`), checking `issuer` is
  `https://accounts.google.com` and `audience` is our client ID.
- **Asserts `email_verified === true` and that the email's domain equals
  `GOOGLE_ALLOWED_DOMAIN`** before minting anything. A failure redirects to
  `/login?error=<reason>` and sets no session.
- Upserts `app_users` (creating the row at `role = 'pending'` on first sight,
  never downgrading an existing role), stamps `last_login_at`, refreshes
  `name`/`picture_url`.
- Sets the session cookie and the theme-seed cookie (§6.5), then redirects to
  the `next` path or `/`.

**`POST /api/auth/signout`** — clears the session cookie server-side.

### 6.2 Session cookie

`apmg_session` replaces both `apmg-role` and `apmg-user`.

- HS256 JWT signed with `AUTH_SECRET` via `jose`.
- Claims: `sub` (lowercased email), `name`, `picture`, optional `viewAs`, `iat`,
  `exp`.
- `HttpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/`, 12-hour TTL.
  `Lax` (not `Strict`) is required — the OAuth callback is a top-level
  cross-site navigation, which `Strict` would strip the cookie from.

**The old cookies must be deleted, not merely superseded.** While
`lib/rbac/server.ts` still reads `apmg-role`, a hand-set cookie remains a full
authorization bypass. `lib/auth/session.ts`'s client-side writers
(`setSessionCookies`, `clearSessionCookies`) are removed along with them —
an `HttpOnly` cookie cannot be cleared from JavaScript, so sign-out becomes the
`POST` above (see §10 for the Sidebar change).

### 6.3 Middleware gate

`middleware.ts` gains an auth gate **after** the existing host-wall logic, so the
customer-host branch and portal source capture are untouched.

- Public paths on the admin host: `/login`, `/api/auth/*`, and everything already
  treated as portal surface (`/portal`, `/t/`, `/api/portal/`).
- Everything else requires a session cookie whose signature and `exp` verify.
- Page requests without one → `302 /login?next=<pathname + search>`.
- `/api/*` requests without one → `401` JSON. Deliberately not a redirect: a
  `fetch()` that follows a 302 to an HTML login page produces a confusing parse
  error rather than a clear failure.
- **Middleware performs no database reads.** It proves *authentication* only;
  authorization needs the role, and a Supabase round-trip on every navigation in
  the Edge runtime is the wrong place to pay for it.

Ordering note: the existing non-customer-host branch sets the `apmg_internal`
telemetry cookie on dashboard page loads. The auth gate runs before that, so an
unauthenticated visitor is redirected without being marked internal — which is
the correct outcome, and the cookie lands on their first real dashboard load
after signing in instead.

### 6.4 Authorization

`lib/rbac/server.ts` is rewritten. `resolveRole` (cookie-trusting, synchronous)
is replaced by an async resolver that:

1. Verifies the session cookie → email.
2. Reads that user's role from `app_users` (service-role REST, the existing
   pattern in `lib/pipeline/server.ts`).
3. Computes the effective role (§8.1).

`requirePermission` becomes `async`. It has only one existing call site
(`app/api/sales/summary/route.ts`), so the signature change is cheap — the work
is adding it to the **14 currently unguarded admin routes**:

| Route | Intended permission |
|---|---|
| `api/pipeline/leads` | `leads.view` / mutations `pipeline.import` |
| `api/pipeline/upload` | `pipeline.import` |
| `api/pipeline/batches` | `pipeline.view` |
| `api/pipeline/campaigns/compose` | `campaigns.send` |
| `api/pipeline/campaigns/send` | `campaigns.send` |
| `api/pipeline/campaigns/find-emails` | `campaigns.send` |
| `api/sales/queue` | `sales.view` |
| `api/sales/handoff` | `hotleads.handoff` |
| `api/integrations` | `integrations.view` / writes `integrations.manage` |
| `api/legal` | `legal.view` / writes `legal.manage` |
| `api/compose-prompt` | `composer.view` |
| `api/sector-playbooks` | `playbooks.view` / writes `playbooks.manage` |
| `api/sector-playbooks/kb` | `playbooks.manage` |
| `api/sector-playbooks/pdf` | `playbooks.manage` |

Each route's actual HTTP methods must be checked during implementation so reads
and writes get the right permission; the table is intent, not a substitute for
reading the file. The 10 `/api/portal/*` routes stay public.

### 6.5 Local development without Supabase

`supabaseTarget()` returns `{ state: "demo" }` when `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` are unset, and several routes already run in that
mode. Auth must not hard-fail there or local development breaks.

**In demo mode, roles resolve in memory:** `MAIN_ADMIN_EMAIL` → `admin`, every
other authenticated email → `pending`. No persistence, no upsert. The OAuth flow
itself still runs normally.

### 6.6 Theme seeding

`seedThemeForRole` is currently called from the client at sign-in, which no
longer exists as a client-side moment. Rather than reintroduce a second
bootstrap script, the callback sets an `apmg-theme-seed=<light|dark>` cookie
(derived from the resolved role — `light` for `sales`, `dark` otherwise). The
root layout reads that cookie — a cheap cookie read, no DB — and passes it as the
`themeBootstrap(fallback)` argument. `localStorage` still wins whenever the user
has made an explicit choice, preserving today's behaviour with no flash.

### 6.7 Pending access screen

`app/page.tsx` renders a new `PendingAccess` component instead of
`DashboardShell` when the effective role is `pending`: the signed-in email, an
explanation that an admin must grant a role, and a sign-out button.

## 7. Phase 2 — Roles and Permissions tab

Settings does not exist yet — `settings` falls through to `<ComingSoon />` at
`components/apmg/DashboardShell.tsx:150`. Phase 2 creates
`components/apmg/SettingsPage.tsx` with a sub-tab bar reusing the animated
tablist pattern from `components/apmg/HotLeadsPage.tsx:766`, and wires it in.

**Roles and Permissions** is the first sub-tab, gated on `users.manage` (a
permission that already exists in the catalog, unused until now).

**User table** — one row per `app_users` record: initials avatar, name, email,
role dropdown, last login. `pending` rows carry an amber badge and drive a count
badge on the sub-tab, since they are the rows needing action.

**Lockout protections, enforced server-side and surfaced in the UI** (§8.2):
Kane's row shows a "Main admin" badge with a disabled dropdown; the acting
admin's own row is disabled ("you can't change your own role"); demoting the last
remaining admin returns `409` with a plain-language message.

Revoking access means setting the user to `pending`, which preserves their login
history. The doc notes explicitly that `pending` still permits sign-in (they see
the pending screen) — **full lockout is suspending the Google account**, which is
absolute now that Google is the only door.

**Permission matrix** — a read-only role × permission grid generated from `ROLES`
and `PERMISSIONS`, so it cannot drift from the code.

**New route `app/api/admin/users/route.ts`** — `GET` lists users, `PATCH` changes
a role. Both guarded by `users.manage`; `PATCH` additionally applies §8.2.

## 8. Pure functions (the testable core)

Isolating these keeps the security-critical logic independent of Next, cookies
and the network.

### 8.1 Effective role

```ts
export function effectiveRole(trueRole: Role, viewAs: Role | null): Role {
  if (!viewAs || viewAs === trueRole) return trueRole;
  return roleCan(trueRole, "roles.viewas") ? viewAs : trueRole;
}
```

A sales rep who forges `viewAs: "admin"` gains nothing: `trueRole` comes from the
database, and it is the `roleCan` check — not the signed cookie — that is the
real gate. Signing the claim is defence in depth.

### 8.2 Role-change guard

```ts
export const MAIN_ADMIN_EMAIL = "kane@apmgservices.com.au";

export type RoleChangeDenial = "main-admin" | "self" | "last-admin" | null;

export function denyRoleChange(args: {
  actorEmail: string;
  targetEmail: string;
  nextRole: Role;
  adminEmails: readonly string[];
}): RoleChangeDenial;
```

Returns the first applicable denial, or `null` to allow:

- `"main-admin"` — target is `MAIN_ADMIN_EMAIL` and `nextRole !== "admin"`.
- `"self"` — `actorEmail === targetEmail`.
- `"last-admin"` — target is the only entry in `adminEmails` and
  `nextRole !== "admin"`.

### 8.3 Domain assertion

```ts
export function assertWorkspaceIdentity(claims: {
  email?: string;
  email_verified?: boolean;
  hd?: string;
}, allowedDomain: string): { ok: true; email: string } | { ok: false; reason: string };
```

Requires a present email, `email_verified === true`, and a case-insensitive
domain match on the email itself (the `hd` claim is checked when present but is
not sufficient alone).

## 9. Phase 3 — View-as switcher

`components/rbac/RoleSwitcher.tsx` stops being dev-only (today
`devMode = DEV && !locked` makes it render nothing in production) and instead
renders whenever the user has `roles.viewas`.

Selecting a role `POST`s to `/api/auth/view-as`, which validates the requested
value is a known role via `isRole()` (rejecting anything else with `400`),
verifies the caller's **true** role carries `roles.viewas`, re-mints the session
cookie with `viewAs` set, and returns success; the client then does a full reload
so server components re-render under the new role. Exiting posts `{ role: null }`.

**The trap this must avoid:** while viewing as `sales`, the effective role is
`sales`, which lacks `roles.viewas` — so the switcher itself disappears and the
user is stranded in a role they cannot leave. Therefore:

- `RbacProvider` carries **both** `role` (effective) and `trueRole`.
- A persistent banner — "Viewing as Sales · Exit" — renders off `trueRole`, not
  the effective role, so the exit is always reachable.

The banner is also necessary UX: because enforcement is real, a user who forgets
they are impersonating will hit legitimate 403s and read them as bugs.

**Button order (addendum, 2026-08-04):** the switcher lists `sales` first among
the role options — it is the role checked most often when previewing — with
`client` and `pending` after. This is purely a display-order choice; sign-in is
unaffected and an admin still lands in their own `admin` view every session.
Nothing pre-selects or auto-activates a preview role — the switcher starts with
no role active (`viewAs` is `null`) until the admin clicks one.

## 10. Login page and Sidebar changes

`app/login/page.tsx`:

- The email/password form, and the `authenticate` / `setSessionCookies` calls, are
  removed. `lib/auth/users.ts` (`TEST_USERS`, `SHARED_PASSWORD`) is deleted.
- The Google button becomes the primary action, linking to
  `/api/auth/google/start` and carrying the `next` param through.
- Error states from `?error=` are rendered: domain not allowed, email
  unverified, OAuth failure.
- **The "Microsoft Entra ID" button is removed** rather than left disabled — a
  control that never works is UI debt. It can return if Entra sign-in is ever
  actually wanted. *Flagged for objection: this is the one change here the user
  has not explicitly confirmed.*
- The service slideshow and layout are untouched.

`components/apmg/Sidebar.tsx` — the sign-out button calls
`POST /api/auth/signout` then navigates, replacing `clearSessionCookies()`, which
cannot clear an `HttpOnly` cookie.

## 11. Verification

The project has **no test framework and no ESLint config** (per session doc 29,
`next lint --file` is not a valid invocation and `eslint` aborts for want of a
config), so today's only gate is `tsc --noEmit` + `next build`. That is too thin
for auth code, so two narrow additions:

**Unit tests (`vitest`, one new devDependency)** covering §8 — chosen because it
handles TypeScript and the `@/` path alias with no extra configuration. Cases:

- `effectiveRole`: no `viewAs`; `viewAs` with permission; `viewAs` **without**
  permission (must fall back to true role); `viewAs` equal to true role.
- `denyRoleChange`: main admin demotion; self-demotion; last-admin demotion;
  each allowed counterpart; precedence when several apply.
- `assertWorkspaceIdentity`: wrong domain; unverified email; missing email;
  case-insensitive match; valid identity.

**Playwright E2E** — already a devDependency, so no new cost:

- Unauthenticated `GET /` redirects to `/login`.
- A request with no `Origin` header to `/api/pipeline/leads` returns `401`, not
  the lead database. (This is the hole described in §1 and the single most
  important regression test in the suite.)
- A `pending` user sees the pending screen, not the dashboard.
- The customer portal still loads unauthenticated — the guard against this design
  breaking the portal.

Plus `tsc --noEmit` and `next build` as before.

## 12. Risks and notes

- **Google Cloud OAuth client is a hard prerequisite.** Nothing here works until
  §4 is done, and it needs the Super Admin access granted 2026-08-03.
- **Redirect URIs are per-origin.** A new Vercel preview URL will fail sign-in
  until registered; production and localhost must both be listed.
- **`AUTH_SECRET` rotation invalidates every session.** Acceptable (everyone
  re-signs in via Google) but worth knowing before rotating it casually.
- **The 12-hour session TTL means a daily sign-in.** Cheap with SSO — usually one
  click, since the Google session persists.
- **Role changes are immediate; sign-out is not revocation.** A stolen session
  cookie stays valid until `exp`. The mitigation is suspending the Workspace
  account, which blocks re-authentication outright.
- **This design must not touch the portal.** Every middleware change needs
  checking against the customer-host branch, and the Playwright portal case
  exists to catch a regression there.
