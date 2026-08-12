-- FIX: unsubscribes were never recording (Spam Act 2003 exposure).
--
-- Run this ONCE in the Supabase SQL editor. Safe to re-run.
--
-- WHAT WAS WRONG
-- `supabase/unsubscribe.sql` created the uniqueness guarantee as an EXPRESSION
-- index on lower(email):
--
--   create unique index email_suppression_email_key on email_suppression (lower(email));
--
-- but `recordUnsubscribe` (lib/portal/server.ts) upserts through PostgREST with
-- `?on_conflict=email` — a bare COLUMN reference. Postgres cannot match a column
-- ON CONFLICT spec to an expression index, so every opt-out failed with:
--
--   42P10: there is no unique or exclusion constraint matching the
--          ON CONFLICT specification
--
-- The endpoint shows the customer a success page regardless of the write result
-- ("an opt-out must LOOK done"), and the send-route filter fails OPEN, so the
-- failure was invisible from every surface: the person saw "you won't hear from
-- us again", nothing was stored, and the next batch would have mailed them.
--
-- THE FIX
-- Move uniqueness onto the plain column so ON CONFLICT (email) matches, and make
-- the lowercase guarantee structural instead of conventional — mirroring
-- app_users.email, which is already `check (email = lower(email))`. The app
-- already lowercases before writing, so this changes no behaviour.

begin;

-- 1. Normalise any existing rows. (The old expression index made case-variant
--    duplicates impossible, so this cannot collide — it is belt-and-braces.)
update public.email_suppression
   set email = lower(email)
 where email <> lower(email);

-- 2. Drop the expression indexes. The new constraint's btree index serves both
--    the upsert and the send-route lookup (`?email=in.(...)`), which queries the
--    plain column.
drop index if exists public.email_suppression_email_key;
drop index if exists public.email_suppression_email_idx;

-- 3. Plain-column UNIQUE — this is what makes ON CONFLICT (email) resolve.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.email_suppression'::regclass
       and conname  = 'email_suppression_email_key'
  ) then
    alter table public.email_suppression
      add constraint email_suppression_email_key unique (email);
  end if;
end $$;

-- 4. Enforce lowercase at the database, so a future caller that forgets to
--    normalise cannot create a case-variant duplicate that the upsert misses.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.email_suppression'::regclass
       and conname  = 'email_suppression_email_lower'
  ) then
    alter table public.email_suppression
      add constraint email_suppression_email_lower check (email = lower(email));
  end if;
end $$;

commit;

-- VERIFY (expect one row, contype 'u', on column "email"):
--   select conname, contype, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conrelid = 'public.email_suppression'::regclass;
