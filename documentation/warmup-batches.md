# Manual warm-up batches — outreach@apmgmaintenance.com.au

Running record of the manual (Gmail, hand-sent) warm-up sends. George Collins
persona, tracked links under campaign `warmup-manual`. Vetting rules per batch:
VIC-only, junk/regulator/own-domain screens, no existing clients (Goodstart),
no suppressed or handed-over leads, no inbox repeated across batches.

## Batch 1 — SENT 2026-08-19 (AEST)

15 emails, sent ~08:56–09:01 AEST. Send ledger: `supabase/log-warmup-batch-1.sql`
(email_sent rows, campaign `warmup-manual`, props.batch = "warmup-batch-1") —
**RUN + verified in Supabase 2026-08-20**: 15/15 rows, no duplicate lead_ids,
timestamps and categories match the file.
Composition: 3 fresh (Arcare Knox, Calvary Viewhills, Guardian South Melbourne)
+ 12 re-touches of July recipients. Recipient mail gateways detonated 14 of the
15 tracked links within seconds of sending (only Rose Garden Epping's link was
never fetched — worth confirming that one left the outbox). Treat early
"Warm" badges from this batch as scanner noise.

Prospect sheet: https://claude.ai/code/artifact/1513c7eb-00d8-4cd7-8569-d84150011e1d
Email drafts:   https://claude.ai/code/artifact/bfde533a-3c71-4ace-9f96-f42a3c5d0398

## Batch 2 — SENT 2026-08-20 (~08:04–08:07 AEST)

15 emails. Send ledger: `supabase/log-warmup-batch-2.sql` — **RUN + verified in
Supabase 2026-08-20**: 15/15 rows, no duplicate lead_ids. Gateways detonated
12 of 15 links within seconds; the three without echoes (Croydon North Kinder
— gmail, St Vincent's Hawthorn — personal mailbox, Croydon World of Learning)
simply have no link-scanning gateway, which is not evidence of non-delivery.
All are July re-touches except the lead item:

1. **Croydon North Kindergarten — cnk.president@gmail.com (send FIRST).**
   This lead submitted a REAL human enquiry on 2026-07-22 (clicked 7 days after
   the July send, chatted, opened a service card, accepted consent, submitted
   the enquiry form, returned 80 minutes later) and it was never answered.
   The draft acknowledges the enquiry and offers a site visit. Address supplied
   by Kane (kinder committee president); lead id ddf63a3f-072e-4036-a452-e81c3b9218f2.
2. Queens Park Aged Care — admissions@dgas.org.au
3. Wintringham Gilgunya — admin@wintringham.org.au
4. St Vincent's Hawthorn — adam.priest@svcs.org.au (addressed to Adam)
5. Australian Unity Rathdowne Place — enquiries@australianunity.com.au
6. TLC Clifton Views — alicia.goddard@tlchealthcare.com.au (addressed to Alicia)
7. Bolton Clarke Avonlea, Mentone — hello@boltonclarke.com.au
8. Sparrow Early Learning Bayswater — admin@sparrow.edu.au
9. Croydon World of Learning — croydon@worldoflearning.com.au
10. Great Beginnings Boronia — boronia@greatbeginnings.com.au
11. Busy Bees Doncaster East — manager@doncastereast.busybees.edu.au
12. Froebel Carlton — info@froebel.com.au
13. Journey Early Learning Burwood — contact@journey.edu.au
14. ACAH — info@acah.edu.au
15. AIH — global@aih.edu.au

Note: batch 2's first pass picked sister facilities sharing batch-1 org
inboxes (Arcare Templestowe, Calvary Bayview, Guardian Lemon Tree, Homestyle
Rowville, Chirnside Park Preschool) — excluded so no mailbox hears from George
two days running. The clean fresh-VIC pool is exhausted; future batches are
re-touches until new leads are scraped.

Email drafts: https://claude.ai/code/artifact/c0ccd5ea-bfdd-4511-87e0-89164edcab08

## Batch 3 — SENT 2026-08-21 (~07:55–07:59 AEST)

15 emails. **Send ledger NOT WRITTEN** — there is no `log-warmup-batch-3.sql`, so
Supabase records 30 warm-up sends when 45 went out. Confirmed sent from telemetry,
not from a report: 12 of the 15 leads produced scanner echoes in a four-minute
burst at 2026-08-20T21:55–21:59Z (Baptcare, BASSCARE, Holmwood, Holloway, Isomer,
mecwacare, The Hive, Pelican, Alpha, Imagine, Aitken, Hotel School). Kids on
Collins and Kids & Co have no echo (likely no scanning gateway). **Blue Mountains
IHMS hard-bounced** — `550 #5.7.1`, Barracuda gateway policy block, never
delivered; suppressed via `supabase/suppress-bounces.sql`, run 2026-08-21 08:04.

Two leads clicked outside the scanner window and look like people, not gateways:
**Pelican Childcare Coburg** (09:26 AEST, 3 portal views + chat open; handed to
Sales 10:00) and **BASSCARE Samarinda Lodge** (re-clicked 2026-08-23 16:04 AEST,
two days after send — the same delayed pattern as Croydon North in July).

All July re-touches; no inbox from
batches 1–2 repeated. New angles: preventive walk-through programs, new-build
defect lists, CBD tower building-rules, school maintenance calendars,
tenant-side fit-out repairs. Two local cards: Holmwood (Healesville, 25 min
from HQ) and Baptcare The Orchards (same street as batch-2's Busy Bees).
Named contact: Nadine at Imagine Coburg.

1. Baptcare The Orchards — info@baptcare.org.au
2. BASSCARE Samarinda Lodge — reception@basscare.org.au
3. Holmwood Aged Care (Healesville) — info@holmwood.com.au
4. Holloway Aged Care — info@hollowayagedcare.com.au
5. Isomer Aged Care — info@isomer.com.au
6. mecwacare Malvern Centre — admissions@mecwacare.org.au
7. The Hive ELC Fairfield — info@thehiveelc.com.au
8. Pelican Childcare Coburg — coburg@pelicanchildcare.com.au
9. Alpha ELC Richmond — info@alphaelc.com.au
10. Imagine Childcare Coburg — nadine@imagineelc.com.au (addressed to Nadine)
11. Kids on Collins — kidsoncollins@koc.vic.edu.au
12. Kids & Co Melbourne CBD — manager@kidsandcochildcare.com.au
13. The Hotel School Melbourne — hotelschool@scu.edu.au
14. Aitken College — admin@aitkencollege.edu.au
15. Blue Mountains IHMS Melbourne — enquiry@bluemountains.edu.au

Email drafts: https://claude.ai/code/artifact/caa69dc1-37d4-4677-a97c-a8f83e3e0ee0

## Batch 4 — PREPARED 2026-08-23, due Mon 2026-08-24

**25 emails** — week 2 of `documentation/send-schedule.md` steps the ramp from 15
to 25/day. Selected from live Supabase (8,077 leads → 1,758 with an email → 864
VIC → 143 after screens → 100 with a plausible org-matching mailbox), then
hand-curated to 25. All 25 are July re-touches; the fresh-VIC pool is still
exhausted. Screens applied in code, not by eye: VIC-only (postcode/state token,
so "Victoria Rd, Sydney" no longer passes), in-sector categories, no suppressed
address, no handed-over lead, no mailbox or **domain** used in batches 1–3, the
whole Torrens group blocked after the Blue Mountains bounce, one lead per domain,
and an org↔domain affinity check that drops scrape contamination (Ambition Health
→ `monikasdrivingschool.com.au`, Belvedere → a hotel, Baptcare Brookview → a
hashed Ingeniux alias, Nido Melbourne Square → `schools.sa.edu.au`).

Composition: 9 aged care / retirement, 12 childcare & kinder, 4 schools. Weighted
to the Chirnside Park catchment (Croydon, Kilsyth, Ringwood North, Heathmont,
Boronia, Box Hill, Mooroolbark, Healesville) with aged care spread wider.
New angles, none repeated from batch 3: service-environment repair lists,
after-hours works, one-contractor-not-five, repeat-callout causes, post-winter
water ingress, ILU unit turnarounds, external presentation for touring families,
single-site trials for multi-site operators, shade/soft-fall/gates, fence lines,
tempering valves, yard drainage, sessional-hours scheduling, committee-friendly
itemised quotes, gate closers, interior wear zones, callout bundling, landlord-vs-
tenant liability, timber play equipment, pre-summer cooling service, and the
September–October holiday window for the four schools.

Run sheet + copy-paste drafts: https://claude.ai/code/artifact/09419eee-1acc-4a97-b494-e57d75f97968

Still manual before sending: the check against Zac's customer list — there is no
clients table and no suppression import, so nothing in the pipeline can catch an
existing customer.

**After sending each batch:** tell Claude — the send ledger SQL
(log-warmup-batch-N.sql) gets generated from the scanner-echo timestamps,
same as batches 1 and 2.
