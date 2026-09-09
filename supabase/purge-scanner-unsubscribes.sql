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
--
-- ═══ IT HAPPENED AGAIN. 2026-08-26 → 2026-09-03: 129 MORE ROWS. ═══════════
--
-- Same tag, `bhgefbdu-5359`, every row landing AFTER the fix above. Two holes:
--
--   1. isBotRequest reads the User-Agent, and this gateway presents a browser
--      string. The ROT13 tell (rewrittenRecipient) was meant to catch that,
--      but the transform is only NEARLY ROT13 — `cevtugba.cf` decodes to
--      `prighton.ps`, one letter off the real `brighton.ps` — so the decoded
--      address matched no lead and the check passed. It fired on 1 of 130.
--   2. The one-click POST path applied no link test at all, on the reasoning
--      that "a POST is never speculative".
--
-- Blast radius, which is the part that matters: fetchSuppressedDomains rolls an
-- opt-out up to its DOMAIN, and the domain in a rewritten row is real. Junk
-- rows on education.vic.gov.au, edumail.vic.gov.au and eq.edu.au had therefore
-- muted EVERY VIC and QLD state school. 89 organisations in total.
--
-- FIXED IN CODE 2026-09-08, three ways:
--   * isKnownCampaign (lib/portal/server.ts) — the campaign tag is a value WE
--     mint and a real mail client returns unchanged, so a tag with no
--     `email_sent` ledger row behind it means the URL was mangled in transit.
--     `outreach-2026` is the only tag that has ever sent mail. Both the GET and
--     the POST path now skip the write when the tag is foreign AND the address
--     is held on no lead. Both halves are required: a person opting out from an
--     old campaign still has an address we hold.
--   * fetchSuppressedDomains now widens to a domain only for a row whose
--     address is held on a lead. Exact-address suppression is untouched and
--     stays unconditional — that is the Spam Act promise.
--   * The whole-of-government school domains are in SHARED_MAIL_DOMAINS, so no
--     single request can ever mute a state's schools again.
--
-- RUN 2026-09-08: deleted 129 rows, left 7 (5 real opt-outs, 1 bounce, 1 test
-- probe). The section-2 and section-4 expectations below are the ORIGINAL
-- 2026-08-26 numbers; read them as "3 rows plus whatever has legitimately
-- arrived since".

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

-- ── 4. CONFIRM. Only genuine rows left (3 as at 2026-08-26; 7 at 2026-09-08).
select count(*) as remaining,
       count(*) filter (where reason = 'unsubscribe')   as real_optouts,
       count(*) filter (where reason like 'bounce%')    as bounces
  from public.email_suppression;

-- NOTE ON THE ONE THAT MATTERS. maidengully@jennyselc.com.au is a genuine
-- opt-out from the 2026-08-25 send and MUST remain. The send route reads this
-- table before building any batch, so leaving it is what keeps that promise.
