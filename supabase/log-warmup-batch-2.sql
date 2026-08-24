-- Warm-up batch 2: 15 manual sends from outreach@apmgmaintenance.com.au on
-- 2026-08-20 ~08:04-08:07 AEST (Kane, Gmail — "George's Second Fifteen").
-- Rows backdated ~60s before each lead's first scanner click; the three leads
-- whose links no gateway fetched (personal/gmail mailboxes don't detonate
-- links) get the middle of the send window. NOT idempotent — run ONCE.
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
insert into public.portal_events (event, props, lead_id, campaign, category, created_at)
values
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, '6a9e276b-bc2a-401c-bf15-03387bb1f6c3', 'warmup-manual', 'Senior citizen services', '2026-08-19T22:03:27Z'),  -- Wintringham Gilgunya
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, '78a4a167-7d7c-4761-988a-134c27580bd2', 'warmup-manual', 'Senior citizen services', '2026-08-19T22:03:35Z'),  -- Queens Park Aged Care Facility
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, '371da25e-dddf-438d-a8ed-93d4fd0ff802', 'warmup-manual', 'Senior citizen services', '2026-08-19T22:03:47Z'),  -- Australian Unity Rathdowne Place
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, 'c048a490-a63f-4313-9304-9c84f09749ec', 'warmup-manual', 'Senior citizen services', '2026-08-19T22:04:05Z'),  -- TLC Clifton Views
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, '67a769df-d730-4d07-a630-2b1b14d8ed03', 'warmup-manual', 'Child care & day care',    '2026-08-19T22:04:37Z'),  -- Sparrow Early Learning Bayswater
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, '22be3d5d-6019-4915-bd21-02ec2bbdcfa2', 'warmup-manual', 'Senior citizen services', '2026-08-19T22:04:42Z'),  -- Bolton Clarke Avonlea, Mentone
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, 'ddf63a3f-072e-4036-a452-e81c3b9218f2', 'warmup-manual', 'Preschool',                '2026-08-19T22:04:30Z'),  -- Croydon North Kindergarten (gmail; no scanner echo — window midpoint)
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, 'f7ca9ba8-ece2-42aa-a3de-b9901a147152', 'warmup-manual', 'Senior citizen services', '2026-08-19T22:04:30Z'),  -- St Vincent's Aged Care Hawthorn (no scanner echo — window midpoint)
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, 'bbe9bb6f-1739-4830-bc02-2c61f8401707', 'warmup-manual', 'Child care & day care',    '2026-08-19T22:04:30Z'),  -- Croydon World of Learning (no scanner echo — window midpoint)
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, 'b0af84fc-ebf9-44b2-947c-8419b86c516f', 'warmup-manual', 'Child care & day care',    '2026-08-19T22:05:14Z'),  -- Froebel Carlton
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, 'eb985201-ba77-4db9-b002-52e29d64c578', 'warmup-manual', 'Child care & day care',    '2026-08-19T22:05:48Z'),  -- Busy Bees at Doncaster East
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, '10b18d6a-7fa1-434f-93ed-6a0ee4c265fc', 'warmup-manual', 'Child care & day care',    '2026-08-19T22:05:55Z'),  -- Great Beginnings Boronia
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, 'cb6f8b85-fb27-4316-9472-1cc3909ad5e9', 'warmup-manual', 'Child care & day care',    '2026-08-19T22:05:59Z'),  -- Journey Early Learning Burwood
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, 'c059d9e0-ed80-4e47-bcef-bd00eaf76a3b', 'warmup-manual', 'College/university',       '2026-08-19T22:06:10Z'),  -- Australian College of Agriculture & Horticulture
  ('email_sent', '{"manual": true, "batch": "warmup-batch-2"}'::jsonb, '6499f0e5-54f6-44ac-8a9f-70b952042c3f', 'warmup-manual', 'College/university',       '2026-08-19T22:06:20Z');  -- Australian Institute of Higher Education
