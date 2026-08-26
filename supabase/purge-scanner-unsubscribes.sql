-- Purge machine-generated unsubscribes from email_suppression.
--
-- WHAT HAPPENED. Between 2026-08-25 and 2026-08-26 the suppression list went
-- from 2 rows to 44. Forty-one of them carry campaign `bhgefbdu-5359` — a tag
-- that has NEVER sent an email (portal_events holds only attribution_click and
-- portal_view rows for it, no email_sent). Their local parts are scrambled
-- strings on real prospect domains:
--
--     vaab@windsorccc.org.au          jlbzvat@firstgrammar.com.au
--     zfevb@g8education.edu.au        hccfezbhagtebibggbde@tricare.com.au
--
-- That is a mail gateway walking the tracked links in an outreach email and
-- detonating the unsubscribe behind them with mangled parameters. The endpoint
-- wrote every one, because it had no scanner test — /t/[id] has always had one
-- (isBotRequest), the unsubscribe route did not.
--
-- FIXED IN CODE 2026-08-26: app/api/portal/unsubscribe/route.ts now skips the
-- write for automated requests and answers with the identical page, so a
-- scanner learns nothing and a human still reads "you're all set". Covered by
-- app/api/portal/unsubscribe/route.test.ts. This file cleans up what already
-- landed. Run it AFTER that code is deployed, or the rows come straight back.
--
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run.

-- ── 1. REVIEW FIRST. Run this on its own and read the output. ───────────────
-- Everything about to be deleted. Expect ~41 rows, every local part obviously
-- machine-generated. If you recognise a real mailbox in here, STOP: someone
-- genuinely opted out and the predicate below needs narrowing.
select email, campaign, lead_id, created_at
  from public.email_suppression
 where reason = 'unsubscribe'
   and campaign is not null
   and campaign not in ('outreach-2026', 'outreach', 'warmup-manual', 'warmup-followup')
 order by created_at;

-- ── 2. WHAT SURVIVES. Run this too, and confirm all three are present. ──────
--   enquiry@bluemountains.edu.au   bounce-policy, warmup-manual  (real bounce)
--   maidengully@jennyselc.com.au   unsubscribe, outreach-2026    (REAL opt-out,
--                                  mailed 10:21 AEST, opted out 21 min later)
--   verifier-probe-donotuse@example.invalid                      (old test probe)
select email, reason, campaign, created_at
  from public.email_suppression
 where reason <> 'unsubscribe'
    or campaign is null
    or campaign in ('outreach-2026', 'outreach', 'warmup-manual', 'warmup-followup')
 order by created_at;

-- ── 3. DELETE. Only after 1 and 2 read correctly. ──────────────────────────
-- Predicate is on the CAMPAIGN TAG, not on how the address looks: an unknown
-- campaign cannot have sent mail, so nothing reached by it can be a genuine
-- opt-out. Matching on "looks like gibberish" would be a guess, and would risk
-- deleting a real address that happens to be an initialism.
--
-- Deliberately NOT idempotent-guarded — it is a plain delete, safe to re-run,
-- and it only ever removes rows whose campaign never sent an email.
delete from public.email_suppression
 where reason = 'unsubscribe'
   and campaign is not null
   and campaign not in ('outreach-2026', 'outreach', 'warmup-manual', 'warmup-followup');

-- ── 4. CONFIRM. Should leave 3 rows. ───────────────────────────────────────
select count(*) as remaining,
       count(*) filter (where reason = 'unsubscribe')   as real_optouts,
       count(*) filter (where reason like 'bounce%')    as bounces
  from public.email_suppression;

-- NOTE ON THE ONE THAT MATTERS. maidengully@jennyselc.com.au is a genuine
-- opt-out from the 2026-08-25 send and MUST remain. The send route reads this
-- table before building any batch, so leaving it is what keeps that promise.
