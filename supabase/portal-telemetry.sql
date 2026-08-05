-- APMG Lead Gen — client-portal telemetry: `portal_events` + `portal_inquiries`,
-- plus the leads.engaged columns that light the Sales-queue "Engaged" badge.
--
-- HOW TO RUN
--   Supabase dashboard → SQL Editor → New query → paste this → Run.
--   Idempotent: safe to run on a fresh or existing database.
--
-- WHAT THIS IS
--   Outreach email → tracked link /t/<leadId>?c=<campaign> → services portal.
--   Every attribution click, portal visit, service-card open and enquiry lands
--   in these tables via the /api/portal/* routes, written server-side with the
--   SERVICE ROLE key (bypasses RLS) — same as public.leads and app_settings.
--   Rows are enriched with the lead's identity + CSV category via the httpOnly
--   `apmg_ref` cookie, so the admin Enquiries tab (/api/portal/summary and
--   /api/portal/inquiries) can answer "which sectors click, what services do
--   they want, and who asked us to call them back".

create extension if not exists pgcrypto;

create table if not exists public.portal_events (
  id         uuid primary key default gen_random_uuid(),
  event      text not null,
  props      jsonb not null default '{}'::jsonb,
  view       text,
  lead_id    uuid,            -- from apmg_ref cookie; NO foreign key (leads get reimported/deleted)
  campaign   text,
  category   text,            -- denormalized leads.category at insert time (sector the lead was scraped under)
  visitor_id text,            -- anonymous localStorage id from the client
  ua         text,
  referer    text,
  client_ts  timestamptz,     -- browser time of the event
  created_at timestamptz not null default now()
);
create index if not exists portal_events_event_idx   on public.portal_events (event);
create index if not exists portal_events_lead_idx    on public.portal_events (lead_id);
create index if not exists portal_events_created_idx on public.portal_events (created_at desc);
alter table public.portal_events enable row level security;  -- no policies: service role only

create table if not exists public.portal_inquiries (
  id           uuid primary key default gen_random_uuid(),
  service_slug text not null,
  service_name text,
  name         text,
  email        text not null,
  phone        text,
  message      text,
  lead_id      uuid,          -- attribution: which outreach lead this visitor is
  business     text,          -- denormalized leads.name
  campaign     text,
  category     text,          -- denormalized leads.category (what sector they were from)
  source       text,          -- traffic source (apmg_src cookie): tiktok | facebook | instagram | … (null = untagged)
  status       text not null default 'new',   -- new | contacted | closed
  created_at   timestamptz not null default now()
);
create index if not exists portal_inquiries_created_idx on public.portal_inquiries (created_at desc);
create index if not exists portal_inquiries_status_idx  on public.portal_inquiries (status);
alter table public.portal_inquiries enable row level security;

-- Traffic-source attribution (social promotion: ?utm_source=tiktok|facebook|
-- instagram on the promoted portal link, or a recognised social Referer).
-- Upgrades tables created before the column existed; portal_events needs no
-- change — the source rides in its props jsonb (props.source), stamped
-- server-side from the same apmg_src cookie.
alter table public.portal_inquiries add column if not exists source text;

alter table public.leads add column if not exists engaged    boolean not null default false;
alter table public.leads add column if not exists engaged_at timestamptz;
