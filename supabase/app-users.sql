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
