-- Hot-Lead Follow-Up pipeline (docs/superpowers/specs/2026-09-25-hot-lead-follow-up-design.md).
-- One row per lead per touch. Hand-run in the Supabase SQL editor; idempotent.
-- Server-only: RLS on with no policies, so only the service role can read/write.
--
-- `sending` is the claim a send request takes on a draft BEFORE it goes to n8n,
-- so two overlapping sends can't both deliver it. A row stuck in `sending` means
-- a send died mid-request: check the outreach mailbox's Sent folder, then set it
-- to 'sent' or back to 'draft' by hand.

create table if not exists public.follow_ups (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  touch         smallint not null check (touch in (1, 2)),
  -- inline and unnamed on purpose: Postgres names it follow_ups_status_check,
  -- which is the constraint the two statements below replace on a re-run
  status        text not null default 'draft'
                check (status in ('draft', 'sending', 'sent', 'skipped', 'blocked', 'replied')),
  subject       text,
  body_html     text,
  service_slug  text,
  model         text,
  note          text,
  drafted_at    timestamptz,
  sent_at       timestamptz,
  sent_by       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (lead_id, touch)
);

-- A table created by an earlier copy of this script has the old status list.
alter table public.follow_ups drop constraint if exists follow_ups_status_check;
alter table public.follow_ups add constraint follow_ups_status_check
  check (status in ('draft', 'sending', 'sent', 'skipped', 'blocked', 'replied'));

create index if not exists follow_ups_status_idx on public.follow_ups (status);

alter table public.follow_ups enable row level security;
