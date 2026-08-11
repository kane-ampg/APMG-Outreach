-- Console users and their roles. Populated automatically on first Google
-- sign-in (at role 'sales'); roles are then adjusted from the Roles &
-- Permissions tab. Every read/write goes through the service role.
--
-- A user holds a SET of roles (`roles text[]`), and their access is the union
-- of what those roles grant -- see lib/rbac/roles.ts. The empty set means
-- revoked. The singular `role` column this table started with is superseded
-- below.

create table if not exists public.app_users (
  email         text primary key check (email = lower(email)),
  name          text,
  picture_url   text,
  role          text not null default 'sales'
                check (role in ('admin', 'sales', 'client', 'pending')),
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- New accounts land on Sales. The OAuth domain gate (GOOGLE_ALLOWED_DOMAIN,
-- enforced in lib/auth/policy.ts) already means only verified
-- @apmgservices.com.au Workspace accounts ever reach this table, so an admin
-- promotion per colleague gated staff behind a human step without adding a
-- security boundary.

-- MULTIPLE ROLES PER USER.
--
-- Replaces the singular `role` column. Somebody can be Sales and Admin at
-- once, and their permissions are the UNION of both bundles, so adding a role
-- can only ever widen access — never narrow it.
--
-- There is no 'pending' member. It used to be a role doing two jobs at once —
-- "not triaged yet" and "an admin revoked this" — and inside a SET it would
-- have been incoherent: {pending, admin} would read as revoked while granting
-- the whole console. Revocation is now the EMPTY SET, which nothing held
-- alongside it can contradict.
alter table public.app_users
  add column if not exists roles text[] not null default array['sales'];

-- Backfill from the old column, once, for rows that predate `roles`. The
-- `roles = array['sales']` guard means this only touches rows still sitting on
-- the column default, so re-running this file can never overwrite a real
-- assignment an admin has since made.
--
-- 'pending' maps to the empty set: that is what it always meant, and it is the
-- only mapping that keeps a revoked account revoked.
update public.app_users
   set roles = case
                 when role = 'pending' then array[]::text[]
                 else array[role]
               end
 where roles = array['sales']
   and role is distinct from 'sales';

-- Only real roles, and no duplicates. Enforcement already fails closed on
-- anything it does not recognise (`parseRoles` in lib/rbac/roles.ts), so this
-- is the second of two locks rather than the only one.
--
-- The no-duplicates half is spelled out one role at a time because a CHECK
-- constraint may not contain a subquery — the obvious
-- `array_length(array(select distinct unnest(roles)), 1)` is rejected outright
-- by Postgres. `array_positions` returns every index at which a value occurs,
-- so a cardinality above 1 IS the duplicate. Enumerating the three roles is
-- fine precisely because the first condition already bounds the domain to
-- them; adding a fourth role means adding a line here, which the `<@` list
-- above will remind you of.
alter table public.app_users drop constraint if exists app_users_roles_valid;
alter table public.app_users add constraint app_users_roles_valid check (
  roles <@ array['admin', 'sales', 'client']::text[]
  and cardinality(array_positions(roles, 'admin')) <= 1
  and cardinality(array_positions(roles, 'sales')) <= 1
  and cardinality(array_positions(roles, 'client')) <= 1
);

-- The old singular column is now VESTIGIAL: nothing reads or writes it.
--
-- Deliberately NOT dropped in the same migration that adds `roles`. Dropping
-- it would break any serverless instance still running the previous deploy
-- mid-rollout — their reads would 400, and role resolution fails closed, so
-- every one of them would lock its users out for the length of the rollout.
-- Left in place it simply goes stale, which costs nothing because no code
-- consults it. Drop it in a follow-up once the deploy has settled:
--
--   alter table public.app_users drop column role;
--
-- Until then its NOT NULL default keeps working for inserts that omit it.

-- Who pre-assigned this person's role from Settings before they had ever
-- signed in ("Add by email"). Attribution only -- no code branches on it.
-- "Never signed in" is `last_login_at is null`, which needs no new column.
alter table public.app_users add column if not exists invited_by text;

-- Presence. Stamped by POST /api/auth/heartbeat, which the console shell calls
-- every 30 seconds while a tab is OPEN AND VISIBLE, and never otherwise.
--
-- This column is what lets Settings say "Online now" in green. It is
-- deliberately separate from last_login_at: a sign-in is a single moment hours
-- or days in the past, and rendering it as presence is exactly the lie this
-- column exists to avoid. Someone is shown online only while their beat is
-- fresher than PRESENCE_WINDOW_MS (lib/auth/signIn.ts) — close the tab and the
-- green expires on its own, with no sign-out required.
--
-- Nullable forever: every row predating this column has no presence history,
-- and "we have never observed this person online" is the honest reading of
-- null. No backfill from last_login_at — that would invent presence we never
-- saw.
alter table public.app_users add column if not exists last_seen_at timestamptz;

-- Session kill switch. Every session cookie is a signed JWT carrying `iat`;
-- resolveSession() refuses any token issued strictly before this instant, so
-- stamping it terminates that person's live sessions on their very next
-- request -- page load or API call alike.
--
-- Cleared on every completed Google sign-in (see upsertOnLogin). That is what
-- makes the comparison unambiguous despite `iat` having only second
-- resolution: the stamp exists to kill EXISTING tokens, never to block future
-- logins. Locking someone out is clearing `roles`, a separate lever.
alter table public.app_users add column if not exists sessions_valid_from timestamptz;

-- RLS on with NO policies: the service role bypasses it, so the app is
-- unaffected, but the anon key can never read this table if one is ever
-- introduced client-side.
alter table public.app_users enable row level security;

-- Access changes are recorded in console_audit (supabase/console-audit.sql),
-- not here.
--
-- This file used to declare a role_change_log table with the same intent, but
-- the writer it described was never built, so it only ever held zero rows.
-- console-audit.sql drops it and records role changes, invitations and forced
-- sign-outs alongside every other operator action -- one trail an admin reads
-- in one place, rather than two that each tell half the story.

-- The protected main admin. Re-running this file always restores admin, which
-- is the intended recovery path if the role is ever lost.
--
-- Adds admin to whatever they already hold rather than replacing the set, so
-- running this recovery never silently strips a second role they were given.
-- The `= any` guard keeps it idempotent: appending unconditionally would build
-- {admin,admin} on the second run and trip the no-duplicates constraint above.
insert into public.app_users (email, name, roles)
values ('kane@apmgservices.com.au', 'Kane Reroma', array['admin'])
on conflict (email) do update
  set roles = case
                when 'admin' = any(public.app_users.roles) then public.app_users.roles
                else public.app_users.roles || 'admin'
              end;
