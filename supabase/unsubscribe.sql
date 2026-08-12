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

-- UNIQUENESS MUST BE ON THE PLAIN COLUMN, NOT lower(email).
-- `recordUnsubscribe` upserts through PostgREST with `?on_conflict=email`, a
-- bare column reference. Postgres cannot match that to an EXPRESSION index, so
-- a unique index on lower(email) makes every opt-out fail with 42P10 — and
-- because the endpoint always renders a success page and the send-route filter
-- fails open, that failure is invisible from every surface. This shipped once;
-- see unsubscribe-fix-onconflict.sql for the repair applied to the live DB.
--
-- The lowercase guarantee is a CHECK instead, matching app_users.email.
create table if not exists public.email_suppression (
  id          uuid primary key default gen_random_uuid(),
  email       text not null unique check (email = lower(email)),
  lead_id     uuid,
  campaign    text,
  reason      text not null default 'unsubscribe',
  created_at  timestamptz not null default now()
);

-- No extra index needed: the UNIQUE constraint above creates the btree that
-- serves both the upsert and the send route's `?email=in.(...)` lookup, which
-- queries the plain column.

-- No RLS policy is added: like the other pipeline/portal tables this is reached
-- only via the server-side service-role key, never the anon client.
