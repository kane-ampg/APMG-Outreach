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
insert into public.app_users (email, name, role)
values ('kane@apmgservices.com.au', 'Kane Reroma', 'admin')
on conflict (email) do update set role = 'admin';
