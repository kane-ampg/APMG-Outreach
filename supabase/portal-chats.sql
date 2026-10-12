-- Portal chat transcripts: what visitors ask the "APMG Assistant" chat bubble
-- on /portal, and what it answered. Read by the Telemetry tab's Chats view
-- (GET /api/portal/chats). Hand-run in the Supabase SQL editor; idempotent.
--
-- One row per EXCHANGE — the visitor's question and the reply they got — not
-- per message, so a question is never stored without its answer. Rows that
-- share a conversation_id are one chat (one opening of the bubble on one page
-- load); the read route groups them.
--
-- Deliberately NOT portal_events. That table is content-free behavioural
-- telemetry (the `chat_prompt` quota ledger stores the message LENGTH only);
-- transcripts are what people typed, so they live here, behind the same
-- PORTAL_ADMIN_KEY gate as enquiries.
--
-- Who is written: real visitors only. Bots/scanners never reach the model,
-- and browsers marked as staff (apmg_internal — the admin console, or
-- /api/portal/staff on a customer host) are skipped, same rule as every
-- telemetry writer. Test as a customer from a private window.
--
-- Attribution is snapshotted at chat time, because leads turn over every few
-- days: lead_id/business/category come from a VALIDATED apmg_ref cookie (the
-- visitor clicked an outreach email), source from the apmg_src cookie
-- (facebook / google / linkedin / … — lib/portal/source.ts). source null +
-- lead_id null = came straight to the link (direct / unknown).
--
-- No FK to leads, on purpose. Server-only: RLS on with no policies, so only
-- the service role can read or write.

create extension if not exists pgcrypto;

create table if not exists public.portal_chats (
  id              uuid primary key default gen_random_uuid(),
  conversation_id text not null,       -- client-minted per chat session (uuid)
  visitor_id      text,                -- localStorage id, same as portal_events.visitor_id
  lead_id         uuid,                -- validated outreach lead; NO foreign key
  business        text,                -- leads.name at chat time (school / business)
  category        text,                -- leads.category at chat time (sector)
  campaign        text,                -- apmg_ref_campaign cookie
  source          text,                -- apmg_src traffic source; null = untagged
  question        text not null,       -- what the visitor typed
  reply           text not null,       -- what the assistant answered
  outcome         text not null default 'answered',  -- answered | fallback | limit
  ua              text,
  created_at      timestamptz not null default now()
);

create index if not exists portal_chats_created_idx      on public.portal_chats (created_at desc);
create index if not exists portal_chats_conversation_idx on public.portal_chats (conversation_id);
create index if not exists portal_chats_lead_idx         on public.portal_chats (lead_id);

alter table public.portal_chats enable row level security;  -- no policies: service role only
