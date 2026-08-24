-- Bounce suppressions — addresses that hard-bounced or were rejected by the
-- recipient's mail gateway. Running this stops /api/pipeline/campaigns/send
-- from ever mailing them again (the route calls fetchSuppressedEmails before
-- it builds a batch), and keeps a record of WHY.
--
-- Idempotent — safe to re-run, and safe to append new rows to over time.
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- `reason` is free text; keep to these so the log stays greppable:
--   bounce-policy   550 5.7.x — recipient gateway policy/reputation rejection
--   bounce-unknown  550 5.1.1 — no such user (list-quality problem)
--   bounce-full     552 / 5.2.2 — mailbox full
--   unsubscribe     the default, written by /api/portal/unsubscribe

insert into public.email_suppression (email, lead_id, campaign, reason)
values
  -- 2026-08-20, warm-up batch 3. Blue Mountains International Hotel Management
  -- School (Torrens University Group), lead 6c3314cd-…, Melbourne VIC campus.
  -- "550 #5.7.1 Your access to submit messages to this e-mail system has been
  -- rejected" — stock Barracuda Email Security Gateway block. A recruitment
  -- alias behind a corporate gateway; rejected at SMTP time, never delivered.
  -- Previously mailed 2026-07-20 with no bounce recorded, because nothing in
  -- the n8n path reads DSNs. Reach this one via their web form, not email.
  ('enquiry@bluemountains.edu.au', '6c3314cd-39b9-48fd-9d8e-bdb06a72cebf', 'warmup-manual', 'bounce-policy')
on conflict (email) do nothing;

-- Check what landed:
--   select email, reason, campaign, created_at
--     from public.email_suppression order by created_at desc;
