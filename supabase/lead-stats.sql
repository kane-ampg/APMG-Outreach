-- APMG Lead Gen — server-side aggregates for the Pipeline/Overview KPIs.
--
-- HOW TO RUN
--   Supabase dashboard → SQL Editor → New query → paste this → Run.
--   Idempotent (create or replace) — safe to re-run.
--
-- WHY THIS EXISTS
--   The KPI cards, the Pipeline nav badge and the Overview volume histogram used
--   to be computed IN THE BROWSER from a full `/api/pipeline/leads` read. That
--   endpoint returns every row (LIMIT 10000), so each open console tab pulled the
--   whole table — 8k rows ≈ 5.7 MB of JSON — every 15 seconds, on every page,
--   which is what exhausted the Vercel Fast Origin Transfer allowance. One call
--   to this function returns the same numbers in well under a kilobyte.
--
--   Aggregates cannot be done over PostgREST alone: this project's Supabase has
--   `db-aggregates-enabled` off (a `select=rating.avg()` read answers 400), and
--   GROUP BY has never been expressible in a PostgREST query. Hence an RPC.
--
-- TIMEZONE — the load-bearing detail
--   `p_tz` is the VIEWER's IANA zone, forwarded from the browser by
--   /api/pipeline/stats. Daily buckets are cut at local midnight in THAT zone,
--   preserving the property lib/data/buckets.ts was written to guarantee: a
--   Vercel server bucketing on its own UTC clock would push ~10 hours of every
--   Australian day into the previous bar. An unrecognised zone name degrades to
--   UTC rather than raising, so a stats read can never 500 on a bad Intl string.
--
--   Only day-grain counts are returned. Weeks and months are rolled up from
--   those days on the client, because a week/month boundary is only meaningful
--   once the days themselves are cut in the viewer's zone.

-- Supports both the rolling-24h count and max(created_at) below, and the
-- created_at ordering /api/pipeline/leads already does.
create index if not exists leads_created_at_idx on public.leads (created_at desc);

create or replace function public.pipeline_lead_stats(p_tz text default 'UTC')
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  zone   text := 'UTC';
  agg    record;
  days   jsonb;
begin
  -- Validate against Postgres's own catalogue: `at time zone <garbage>` raises,
  -- and a KPI read must not be able to 500 on a browser-supplied string.
  if p_tz is not null and exists (select 1 from pg_timezone_names where name = p_tz) then
    zone := p_tz;
  end if;

  select
    count(*)::int                                                          as total,
    -- `emails`/`social_medias` are `text[] not null default '{}'`, so an empty
    -- import column is a zero-length array rather than null.
    count(*) filter (where cardinality(emails) > 0)::int                   as with_email,
    count(*) filter (where nullif(btrim(phone), '') is not null)::int      as with_phone,
    count(*) filter (where nullif(btrim(website), '') is not null)::int    as with_website,
    count(rating)::int                                                    as rated_count,
    avg(rating)                                                           as avg_rating,
    -- Matches the client's old fold: a null batch is the "__ungrouped__" folder,
    -- which counts as one folder alongside the named ones.
    count(distinct coalesce(batch, '__ungrouped__'))::int                  as folders,
    max(created_at)                                                       as latest_import,
    -- Rolling 24 hours, not "since local midnight" — this is the "New · 24h"
    -- readout, and a rolling window is zone-independent.
    count(*) filter (where created_at > now() - interval '24 hours')::int  as added_today
  into agg
  from public.leads;

  select coalesce(jsonb_agg(jsonb_build_object('d', d, 'n', n) order by d), '[]'::jsonb)
  into days
  from (
    select to_char(date_trunc('day', created_at at time zone zone), 'YYYY-MM-DD') as d,
           count(*)::int as n
    from public.leads
    -- The histogram shows at most 14 days / 12 weeks / 12 months, so a year and
    -- a bit is every bucket any grain can render. Bounds the payload on a table
    -- that only grows.
    where created_at > now() - interval '400 days'
    group by 1
  ) s;

  return jsonb_build_object(
    'total',        agg.total,
    'withEmail',    agg.with_email,
    'withPhone',    agg.with_phone,
    'withWebsite',  agg.with_website,
    'ratedCount',   agg.rated_count,
    'avgRating',    agg.avg_rating,   -- null when nothing is rated
    'folders',      agg.folders,
    'latestImport', agg.latest_import,
    'addedToday',   agg.added_today,
    'byDay',        days,
    'tz',           zone              -- echoed back so the caller can see the fallback
  );
end;
$$;

-- Only the app's server routes call this, with the service role key. Nothing
-- here needs to be reachable by an anon/authenticated browser token, and the
-- function reads the whole leads table, so keep the grant narrow.
revoke all on function public.pipeline_lead_stats(text) from public;
grant execute on function public.pipeline_lead_stats(text) to service_role;

-- PostgREST caches the schema; without this it answers 404 (PGRST202) for a
-- freshly created function until the next connection reload.
notify pgrst, 'reload schema';
