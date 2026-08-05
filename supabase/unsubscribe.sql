-- Unsubscribe / suppression list for outreach email (Spam Act 2003 compliance).
--
-- Run this ONCE in the Supabase SQL editor (the app's service-role key is
-- REST-only and cannot run DDL). Until it exists, the unsubscribe endpoint and
-- the send-route suppression filter degrade to "needs migration" / no-op
-- instead of erroring.
--
-- Keyed by EMAIL (lowercased), not lead id: a lead's uuid changes when a CSV is
-- re-imported, but a person's opt-out must persist. lead_id/campaign are kept
-- for context only. One opt-out per address (upsert on the unique email).

create table if not exists public.email_suppression (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  lead_id     uuid,
  campaign    text,
  reason      text not null default 'unsubscribe',
  created_at  timestamptz not null default now()
);

-- One row per address; the endpoint upserts on this. Store addresses lowercased.
create unique index if not exists email_suppression_email_key
  on public.email_suppression (lower(email));

-- The send route filters recipients against this list; index the lookup key.
create index if not exists email_suppression_email_idx
  on public.email_suppression (lower(email));

-- No RLS policy is added: like the other pipeline/portal tables this is reached
-- only via the server-side service-role key, never the anon client.
