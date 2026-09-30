-- Saved hot leads: a permanent copy of every lead that scores 60+ (the Hot and
-- Hottest bands of lib/data/leadScore.ts), kept OUT of the leads table so a
-- folder delete can't take it with it. Hand-run in the Supabase SQL editor;
-- idempotent (safe to re-run — the backfill at the bottom just refreshes).
--
-- Why a separate table: leads turns over every few days (folders are deleted
-- and re-imported with fresh uuids), and portal_events deliberately has no FK
-- to it, so a deleted lead's click trail survives but its name, emails and
-- phone don't — Telemetry shows "Unattributed lead" and nothing in Supabase
-- can say who it was. This is that missing copy, for the leads worth keeping.
--
-- How rows get here — nothing in the app has to remember to call it:
--   1. portal_events insert trigger — the moment a lead's service open or
--      enquiry lands, it is re-scored and, at 60+, saved (or refreshed).
--   2. leads BEFORE DELETE trigger — a lead is re-scored and saved on its way
--      out, whether the delete came from a Pipeline folder delete, a row
--      delete, or the Supabase table editor.
--   3. the backfill at the bottom — every lead that is 60+ today. Leads whose
--      row was deleted before this ran are saved with their score and trail
--      but no name (that's already gone — only n8n's execution history has it).
--
-- 60+ in practice: one service-card open already scores 66, an enquiry 90+.
-- No FK to leads, on purpose: the row must outlive its lead. Server-only: RLS
-- on with no policies, so only the service role can read or write.

create table if not exists public.saved_hot_leads (
  lead_id         uuid primary key,   -- the leads.id it had; NO foreign key
  score           smallint not null,  -- latest intent score, 60–100
  name            text,
  category        text,
  emails          text[],
  phone           text,
  website         text,
  address         text,
  contact_name    text,
  contact_title   text,
  source          text,
  bing_maps_url   text,
  batch           text,               -- the import folder it came from
  campaign        text,               -- most recent campaign tag on its trail
  email_clicks    integer not null default 0,
  portal_views    integer not null default 0,
  service_opens   integer not null default 0,
  inquiries       integer not null default 0,
  first_seen      timestamptz,
  last_seen       timestamptz,
  lead_row        jsonb,              -- the whole leads row as last seen, every column
  lead_deleted_at timestamptz,        -- when its leads row was deleted (null = still there, or gone before this table existed)
  saved_at        timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists saved_hot_leads_score_idx on public.saved_hot_leads (score desc);

alter table public.saved_hot_leads enable row level security;

-- lib/data/leadScore.ts's leadScore(), in SQL — keep the two in step. Banded,
-- not additive: an enquiry always outranks any amount of browsing.
create or replace function public.lead_intent_score(
  inquiries integer,
  service_opens integer,
  portal_views integer,
  email_clicks integer
) returns smallint
language sql
immutable
as $$
  select (case
    when inquiries     > 0 then round(90 + 10 * (1 - exp(-inquiries     / 2.0)))
    when service_opens > 0 then round(60 + 29 * (1 - exp(-service_opens / 4.0)))
    when portal_views  > 0 then round(35 + 24 * (1 - exp(-portal_views  / 4.0)))
    when email_clicks  > 0 then round(10 + 24 * (1 - exp(-email_clicks  / 4.0)))
    else 0
  end)::smallint
$$;

-- Score one lead off its whole trail and, at 60+, save it. p_deleting is set by
-- the leads delete trigger, which stamps lead_deleted_at.
create or replace function public.save_hot_lead(p_lead_id uuid, p_deleting boolean default false)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t        record;
  v_score  smallint;
  v_lead   jsonb;
  v_emails text[];
begin
  if p_lead_id is null then
    return;
  end if;

  -- The same event allowlist and counters as app/api/portal/lead-activity:
  -- first/last seen and the tags run over the whole customer journey, the
  -- score over the four funnel events.
  select
    (count(*) filter (where e.event = 'attribution_click'))::int   as email_clicks,
    (count(*) filter (where e.event = 'portal_view'))::int         as portal_views,
    (count(*) filter (where e.event = 'portal_service_open'))::int as service_opens,
    (count(*) filter (where e.event = 'portal_inquiry'))::int      as inquiries,
    min(e.created_at) as first_seen,
    max(e.created_at) as last_seen,
    (array_agg(e.campaign order by e.created_at desc) filter (where e.campaign is not null))[1] as campaign,
    (array_agg(e.category order by e.created_at desc) filter (where e.category is not null))[1] as category
  into t
  from public.portal_events e
  where e.lead_id = p_lead_id
    and e.event in ('attribution_click', 'portal_view', 'portal_service_open', 'portal_inquiry',
                    'legal_ack', 'portal_consent_accept', 'chat_prompt');

  v_score := public.lead_intent_score(t.inquiries, t.service_opens, t.portal_views, t.email_clicks);

  if v_score < 60 then
    -- Not hot (or its trail has been cleared since it was saved). A row we
    -- already hold is kept as it is — this table only ever grows — and just
    -- notes the delete.
    if p_deleting then
      update public.saved_hot_leads
         set lead_deleted_at = coalesce(lead_deleted_at, now()), updated_at = now()
       where lead_id = p_lead_id;
    end if;
    return;
  end if;

  -- Read as jsonb so an optional column that isn't there yet (a migration
  -- not run) can only come back null, never fail the save.
  select to_jsonb(l) into v_lead from public.leads l where l.id = p_lead_id;
  if jsonb_typeof(v_lead -> 'emails') = 'array' then
    select array_agg(x) into v_emails from jsonb_array_elements_text(v_lead -> 'emails') x;
  end if;

  insert into public.saved_hot_leads as h (
    lead_id, score, name, category, emails, phone, website, address,
    contact_name, contact_title, source, bing_maps_url, batch, campaign,
    email_clicks, portal_views, service_opens, inquiries, first_seen, last_seen,
    lead_row, lead_deleted_at
  ) values (
    p_lead_id, v_score,
    v_lead ->> 'name',
    coalesce(v_lead ->> 'category', t.category),
    v_emails,
    v_lead ->> 'phone',
    v_lead ->> 'website',
    v_lead ->> 'address',
    v_lead ->> 'contact_name',
    v_lead ->> 'contact_title',
    v_lead ->> 'source',
    v_lead ->> 'bing_maps_url',
    v_lead ->> 'batch',
    t.campaign,
    t.email_clicks, t.portal_views, t.service_opens, t.inquiries, t.first_seen, t.last_seen,
    v_lead,
    case when p_deleting then now() end
  )
  on conflict (lead_id) do update set
    score         = excluded.score,
    -- Identity only ever fills in: an already-deleted lead re-scores with no
    -- leads row, and that must not blank the copy saved while it existed.
    name          = coalesce(excluded.name, h.name),
    category      = coalesce(excluded.category, h.category),
    emails        = coalesce(excluded.emails, h.emails),
    phone         = coalesce(excluded.phone, h.phone),
    website       = coalesce(excluded.website, h.website),
    address       = coalesce(excluded.address, h.address),
    contact_name  = coalesce(excluded.contact_name, h.contact_name),
    contact_title = coalesce(excluded.contact_title, h.contact_title),
    source        = coalesce(excluded.source, h.source),
    bing_maps_url = coalesce(excluded.bing_maps_url, h.bing_maps_url),
    batch         = coalesce(excluded.batch, h.batch),
    campaign      = coalesce(excluded.campaign, h.campaign),
    lead_row      = coalesce(excluded.lead_row, h.lead_row),
    email_clicks  = excluded.email_clicks,
    portal_views  = excluded.portal_views,
    service_opens = excluded.service_opens,
    inquiries     = excluded.inquiries,
    first_seen    = excluded.first_seen,
    last_seen     = excluded.last_seen,
    lead_deleted_at = coalesce(h.lead_deleted_at, excluded.lead_deleted_at),
    updated_at    = now();
end;
$$;

-- Not callable over the public API; the triggers run it as its owner.
revoke all on function public.save_hot_lead(uuid, boolean) from public, anon, authenticated;
revoke all on function public.lead_intent_score(integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.save_hot_lead(uuid, boolean) to service_role;

-- 1. Save on the events that can push a lead to 60+.
create or replace function public.portal_events_save_hot_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Never let the copy cost the click: a failure is logged and the event still
  -- lands. The leads delete trigger saves the lead again on its way out.
  begin
    perform public.save_hot_lead(new.lead_id);
  exception when others then
    raise warning 'save_hot_lead(%) failed: %', new.lead_id, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists portal_events_save_hot_lead on public.portal_events;
create trigger portal_events_save_hot_lead
  after insert on public.portal_events
  for each row
  when (new.lead_id is not null and new.event in ('portal_service_open', 'portal_inquiry'))
  execute function public.portal_events_save_hot_lead();

-- 2. Save on the way out of leads. No exception guard, on purpose: if a hot
--    lead can't be copied, the delete fails rather than losing it.
create or replace function public.leads_save_hot_lead()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.save_hot_lead(old.id, true);
  return old;
end;
$$;

drop trigger if exists leads_save_hot_lead on public.leads;
create trigger leads_save_hot_lead
  before delete on public.leads
  for each row
  execute function public.leads_save_hot_lead();

-- 3. Backfill every lead that is 60+ today.
select public.save_hot_lead(hot.lead_id)
from (
  select distinct lead_id
  from public.portal_events
  where lead_id is not null and event in ('portal_service_open', 'portal_inquiry')
) hot;

-- PostgREST caches the schema; without this the new table 404s until it reloads.
notify pgrst, 'reload schema';

-- What was saved: `saved` is every 60+ lead; `name_already_lost` are the ones
-- whose leads row was deleted before this table existed.
select count(*) as saved,
       count(*) filter (where name is null) as name_already_lost
from public.saved_hot_leads;
