-- Console users and their roles. Populated automatically on first Google
-- sign-in (at role 'sales'); roles are then adjusted from the Roles &
-- Permissions tab. Every read/write goes through the service role.

create table if not exists public.app_users (
  email         text primary key check (email = lower(email)),
  name          text,
  picture_url   text,
  role          text not null default 'sales'
                check (role in ('admin', 'sales', 'client', 'pending')),
  created_at    timestamptz not null default now(),
  last_login_at timestamptz
);

-- New accounts land on 'sales', not 'pending'. The OAuth domain gate
-- (GOOGLE_ALLOWED_DOMAIN, enforced in lib/auth/policy.ts) already means only
-- verified @apmgservices.com.au Workspace accounts ever reach this table, so
-- an admin promotion per colleague gated staff behind a human step without
-- adding a security boundary.
--
-- Stated again as an ALTER because `create table if not exists` above is a
-- no-op on a database that already has the table — without this line, an
-- existing deployment keeps the old 'pending' default. Re-running this file
-- migrates it.
alter table public.app_users alter column role set default 'sales';

-- 'pending' remains a real, assignable role: an admin sets it deliberately to
-- revoke access while keeping the sign-in history (see RolesPermissionsTab).
-- Existing pending rows are therefore left alone — some may be revocations
-- rather than un-triaged newcomers. To promote the ones that aren't:
--   update public.app_users set role = 'sales' where role = 'pending';

-- Who pre-assigned this person's role from Settings before they had ever
-- signed in ("Add by email"). Attribution only -- no code branches on it.
-- "Never signed in" is `last_login_at is null`, which needs no new column.
alter table public.app_users add column if not exists invited_by text;

-- Session kill switch. Every session cookie is a signed JWT carrying `iat`;
-- resolveSession() refuses any token issued strictly before this instant, so
-- stamping it terminates that person's live sessions on their very next
-- request -- page load or API call alike.
--
-- Cleared on every completed Google sign-in (see upsertOnLogin). That is what
-- makes the comparison unambiguous despite `iat` having only second
-- resolution: the stamp exists to kill EXISTING tokens, never to block future
-- logins. Locking someone out is `role = 'pending'`, a separate lever.
alter table public.app_users add column if not exists sessions_valid_from timestamptz;

-- RLS on with NO policies: the service role bypasses it, so the app is
-- unaffected, but the anon key can never read this table if one is ever
-- introduced client-side.
alter table public.app_users enable row level security;

-- Every access change, append-only. Written by /api/admin/users on each role
-- change, pre-assignment and forced sign-out; read back by the "Recent
-- changes" list in Settings.
--
-- Deliberately NOT a foreign key to app_users(email): the log must outlive the
-- row it describes, or deleting a user would erase the record of what they
-- were granted -- exactly the history an audit log exists to keep.
create table if not exists public.role_change_log (
  id           uuid primary key default gen_random_uuid(),
  target_email text not null,
  actor_email  text not null,
  action       text not null check (action in ('invite', 'role_change', 'force_logout')),
  from_role    text,
  to_role      text,
  created_at   timestamptz not null default now()
);

create index if not exists role_change_log_created_at_idx
  on public.role_change_log (created_at desc);

alter table public.role_change_log enable row level security;

-- The protected main admin. Re-running this file always restores admin, which
-- is the intended recovery path if the role is ever lost.
insert into public.app_users (email, name, role)
values ('kane@apmgservices.com.au', 'Kane Reroma', 'admin')
on conflict (email) do update set role = 'admin';
