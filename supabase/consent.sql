-- Consent record column for portal enquiries (Privacy Act 1988 / APP 5, and a
-- defensible "who agreed to what, when" trail — the portal is aimed at lawyers).
--
-- Run this ONCE in the Supabase SQL editor (the app's service-role key is
-- REST-only and cannot run DDL). It adds the accepted legal-docs VERSION to
-- each stored enquiry. Until it is run, POST /api/portal/inquiries will 400 on
-- insert (it writes consent_version) and the admin GET selects the column — so
-- run this before enabling live enquiries with the consent gate.
--
-- The version string is validated server-side to match the CURRENTLY published
-- legal docs (app_settings 'legal_docs') before the row is stored, so a value
-- here is proof the enquirer agreed to that exact, resolvable wording.

alter table public.portal_inquiries
  add column if not exists consent_version text;

-- Optional: index if you plan to report/filter enquiries by accepted version.
create index if not exists portal_inquiries_consent_version_idx
  on public.portal_inquiries (consent_version);

-- NOTE (retention / APP 11.2): there is still no automated retention or
-- deletion policy on portal_inquiries or portal_events. If your reviewed
-- Privacy Policy commits to a retention period, add a scheduled purge (e.g. a
-- pg_cron job) — do not promise deletion the system does not perform.
