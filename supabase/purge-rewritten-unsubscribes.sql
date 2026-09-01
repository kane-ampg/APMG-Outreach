-- Remove opt-outs that no human ever made.
--
-- A link-rewriting mail gateway walks every URL in a message, including the
-- unsubscribe link, and returns the query string with the LOCAL PART of the
-- address ROT13'd — the domain untouched. Every such fetch was written to
-- email_suppression as a genuine opt-out. `avgmeblabegu.faebyzfagf@saints.vic.edu.au`
-- is one: ROT13 of a real enrolments desk at a school that clicked nothing.
--
-- Since the organisation rollup landed (fetchSuppressedDomains, 2026-08-30)
-- these rows are no longer merely cosmetic. The rollup keys on the domain, and
-- the domain in a rewritten row is REAL — so one fake opt-out silently removes
-- every address at that organisation from every future send. That is the reason
-- to purge them rather than leave them sitting there miscounting a KPI.
--
-- The route no longer writes them (see rewrittenRecipient in lib/portal/server.ts);
-- this clears what was recorded before that landed. Run it ONCE in the Supabase
-- SQL editor — the app's service-role key is REST-only.
--
-- THE TEST IS DELIBERATELY NARROW. A row is only removed when its address is
-- held on NO lead AND its ROT13 IS held on one. A genuine opt-out from an
-- address our data has gone stale on fails the second half and survives; the
-- only way to satisfy both is for the decoded form to name a real recipient,
-- which nothing but a rewrite produces. Failing to purge one costs a prospect;
-- purging a real opt-out is a Spam Act breach, so the error runs the safe way.

begin;

-- ROT13 the local part, leave the domain alone — the same transform the
-- gateway applied, which is its own inverse.
create or replace function pg_temp.rot13_local(addr text) returns text as $$
  select translate(split_part($1, '@', 1),
                   'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ',
                   'nopqrstuvwxyzabcdefghijklmNOPQRSTUVWXYZABCDEFGHIJKLM')
         || '@' || split_part($1, '@', 2);
$$ language sql immutable;

-- Is this address one we actually hold on a lead? (case-insensitive: stored
-- casing varies, the suppression list is lowercased)
create or replace function pg_temp.held_on_lead(addr text) returns boolean as $$
  select exists (
    select 1 from public.leads l, unnest(coalesce(l.emails, '{}')) e
    where lower(e) = lower($1)
  );
$$ language sql stable;

-- ── 1. LOOK FIRST. Run this on its own and read the list before deleting. ──
select s.email                        as recorded,
       pg_temp.rot13_local(s.email)   as decodes_to,
       s.campaign,
       s.created_at
from public.email_suppression s
where not pg_temp.held_on_lead(s.email)
  and pg_temp.held_on_lead(pg_temp.rot13_local(s.email))
order by s.created_at desc;

-- ── 2. Then delete exactly those rows. ────────────────────────────────────
delete from public.email_suppression s
where not pg_temp.held_on_lead(s.email)
  and pg_temp.held_on_lead(pg_temp.rot13_local(s.email));

commit;

-- Anything left that still looks like nonsense on a real prospect domain was
-- NOT matched by the test above, which means the decoded address is on no lead
-- either. Check those by hand rather than widening the rule — a guess here
-- deletes someone's opt-out:
--
--   select email, campaign, created_at from public.email_suppression
--   order by created_at desc;
