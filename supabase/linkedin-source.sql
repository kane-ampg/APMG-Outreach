-- LinkedIn as a third lead source (docs/superpowers/specs/2026-09-28-linkedin-lead-source-design.md).
-- Hand-run in the Supabase SQL editor; idempotent.
--
-- A LinkedIn lead is a person at a company: `name` stays the company (the
-- client guard, folders and send flow key on it) and the person rides along.
--
-- `source` is written ONLY for sources the maps URL can't identify — today
-- just 'linkedin'. Google/Bing rows keep it null and are still derived from
-- bing_maps_url (lib/pipeline/source.ts), so no existing row needs a backfill.
-- No check constraint: the upload route whitelists the value, and a constraint
-- would need another migration for every new source.

alter table public.leads add column if not exists contact_name  text;
alter table public.leads add column if not exists contact_title text;
alter table public.leads add column if not exists source        text;

-- PostgREST caches the schema; without this the new columns 400 until it reloads.
notify pgrst, 'reload schema';
