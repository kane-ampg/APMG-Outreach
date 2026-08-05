-- Persist the n8n webhook URLs so they "stick" — stored in Supabase instead of
-- relying on environment variables (which reset on redeploy). These are the
-- exact rows the app reads: a saved app_settings value WINS over the env var,
-- and the matching *_enabled flag toggles the automation on/off (default on;
-- set 'false' to pause without losing the URL). See lib/pipeline/server.ts.
--
-- HOW TO RUN
--   1. In n8n, open each webhook node and copy its **Production URL**
--      (looks like https://<your-n8n-host>/webhook/<path>).
--   2. Paste them below in place of the placeholders.
--   3. Supabase dashboard → SQL Editor → paste this → Run. Re-running is safe.

-- Ensure the table exists (no-op if supabase/schema.sql already created it).
create table if not exists public.app_settings (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, value, updated_at) values
  -- Campaign SEND webhook — references/APMG Campaign Send (clean).json (path: campaign-send)
  ('n8n_campaign_webhook_url',         'https://YOUR-N8N-HOST/webhook/campaign-send', now()),
  ('n8n_campaign_webhook_enabled',     'true',                                        now()),

  -- Email FINDER webhook — references/APMG Email Finder.json (path: email-finder)
  ('n8n_email_finder_webhook_url',     'https://YOUR-N8N-HOST/webhook/email-finder',  now()),
  ('n8n_email_finder_webhook_enabled', 'true',                                        now())
on conflict (key) do update
  set value      = excluded.value,
      updated_at = now();

-- Verify:
--   select key, value, updated_at from public.app_settings
--   where key like 'n8n\_%' escape '\' order by key;
