-- APMG Lead Gen — the console audit trail.
--
-- One append-only row per operator action: who did it (their verified Google
-- SSO address), what they did, to which lead or user, and the note and value
-- they entered. A lead's Sales status is REPLAYED from these rows rather than
-- stored anywhere, and that is the point: a closed deal cannot exist without
-- the row naming the person who closed it.
--
-- Deliberately NOT a foreign key on lead_id or target_email: the log must
-- outlive the row it describes, or reimporting a lead (which happens on every
-- scrape) or deleting a user would erase exactly the history an audit log
-- exists to keep. portal_events already follows this rule for lead_id.

create table if not exists public.console_audit (
  id           uuid primary key default gen_random_uuid(),
  action       text not null,
  -- The verified session identity. Never accepted from a request body.
  actor_email  text not null,
  actor_role   text not null,
  -- Non-null ONLY when an admin performed this while previewing another role,
  -- so "was this impersonated?" is a null check rather than a join. Without
  -- it, an admin acting in a rep's seat is indistinguishable in the record
  -- from the rep themselves.
  acting_as    text,
  -- 'claimed'   — a human asserted it (marked contacted, closed a deal)
  -- 'witnessed' — the server observed it (a send the automation accepted)
  --
  -- Marking a lead contacted is a claim someone stakes their account on, not
  -- proof a call happened. Keeping the two apart is what stops the trail from
  -- overstating what it knows.
  source       text not null default 'claimed'
               check (source in ('claimed', 'witnessed')),
  lead_id      uuid,
  target_email text,
  note         text,
  -- AUD cents. Integers only — money never round-trips through a float.
  value_cents  bigint,
  -- Action-specific detail: from_role/to_role, campaign, recipient count,
  -- resolved webhook mode. Kept out of columns so adding an action never
  -- needs a migration.
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- The replay read: every row for a set of leads, in fold order.
create index if not exists console_audit_lead_idx
  on public.console_audit (lead_id, created_at);
-- The Audit tab's default view.
create index if not exists console_audit_created_idx
  on public.console_audit (created_at desc);
-- "What did this person do?"
create index if not exists console_audit_actor_idx
  on public.console_audit (actor_email);

-- RLS on with NO policies: the service role bypasses it, so the app is
-- unaffected, but an anon key could never read the trail if one is ever
-- introduced client-side.
alter table public.console_audit enable row level security;

-- Supersedes role_change_log (formerly in app-users.sql), which declared a
-- writer that was never built and therefore only ever held zero rows. Access
-- changes are recorded here now, as action in ('role_change','invite',
-- 'force_logout') with target_email set. Two audit logs is worse than one.
drop table if exists public.role_change_log;

-- NOTE ON EXISTING HISTORY: every row that predates this table carries no
-- actor, and none is invented. The 4 sales_handoff rows of 2026-08-01 and the
-- 2,338 email_sent rows of 2026-07-15..28 in portal_events were all written
-- before Google SSO existed (the first app_users row is 2026-08-04), so the
-- console reports them as "pre-SSO — actor not recorded" rather than guessing.
