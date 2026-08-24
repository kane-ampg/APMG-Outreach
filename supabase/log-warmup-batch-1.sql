-- Warm-up batch 1: 15 manual sends from outreach@apmgmaintenance.com.au on
-- 2026-08-19 AEST (Kane, Gmail, one email per lead — the "Warm-up Fifteen"
-- sheet). Each row is backdated ~60s before that lead's first scanner click,
-- so click-after-send deltas read true; Rose Garden Epping (no scanner fetch
-- observed) gets the middle of the send window. NOT idempotent — run ONCE.
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
insert into public.portal_events (event, props, lead_id, campaign, category, created_at)
values
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, '47393330-08ea-407f-9180-06838fca3b6d', 'warmup-manual', 'Senior citizen services', '2026-08-18T22:56:49Z'),  -- Arcare Aged Care The Lodge Knox
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, '64f88b35-8e05-482d-a18f-9b8c2e3e7485', 'warmup-manual', 'Senior citizen services', '2026-08-18T22:57:22Z'),  -- Assisi Centre Aged Care
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, 'a82927df-4815-4f00-8322-140f493f2e3b', 'warmup-manual', 'Senior citizen services', '2026-08-18T22:57:27Z'),  -- Calvary Viewhills Manor
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, '5695ce98-497c-42a5-9ac4-05c7ce47ff0f', 'warmup-manual', 'Senior citizen services', '2026-08-18T22:57:34Z'),  -- Homestyle Aged Care Point Cook Manor
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, 'a4486673-b402-4a01-864c-8f4538961241', 'warmup-manual', 'Child care & day care',    '2026-08-18T22:57:36Z'),  -- Guardian Childcare South Melbourne
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, 'd9d40f3d-1303-4751-b296-cfa1943ab676', 'warmup-manual', 'Preschool',                '2026-08-18T22:58:21Z'),  -- Lancaster Preschool
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, 'f11d3330-5457-43db-96e7-d1bad182fe69', 'warmup-manual', 'Child care & day care',    '2026-08-18T22:58:30Z'),  -- Rose Garden Epping ELC (no scanner fetch; window midpoint)
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, '4f77a8e6-f0ce-411c-bb01-a94bfc9f0e4e', 'warmup-manual', 'Senior citizen services', '2026-08-18T22:58:31Z'),  -- Uniting AgeWell Strathdon
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, 'f1d8e69d-35a6-4325-b794-204e5532cd54', 'warmup-manual', 'Senior citizen services', '2026-08-18T22:58:35Z'),  -- Lynden Aged Care
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, '8c21301f-db3a-47bb-a513-f3095415d0ae', 'warmup-manual', 'Child care & day care',    '2026-08-18T22:58:44Z'),  -- Nido Early School Bayswater North
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, 'f7ec2dfd-0131-4d88-a4ce-f0aaf9ef2fd6', 'warmup-manual', 'Child care & day care',    '2026-08-18T22:59:16Z'),  -- Community Kids Chirnside Park
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, 'c0c65399-6c36-4b08-b49a-73360e55682f', 'warmup-manual', 'Education',                '2026-08-18T22:59:30Z'),  -- Indie School Ringwood
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, 'da694a83-d632-4c7f-b6f0-6161b3c6c067', 'warmup-manual', 'Education',                '2026-08-18T23:00:10Z'),  -- Kaplan Business School Melbourne
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, '4d9713e6-94ea-4b96-9adb-c9b2c2e5b35c', 'warmup-manual', 'School',                   '2026-08-18T23:00:11Z'),  -- Mount Evelyn Christian School
  ('email_sent', '{"manual": true, "batch": "warmup-batch-1"}'::jsonb, 'cb7768ae-d6a3-4265-8c75-6067ddf7d237', 'warmup-manual', 'Child care & day care',    '2026-08-18T23:00:19Z');  -- The Learning Sanctuary Park Orchards
