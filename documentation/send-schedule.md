# Send schedule — when cold outreach can actually start

Written 2026-08-20 (AEST). Sources: `documentation/sessions/32-outreach-email-authentication-setup.md`
(the warm-up plan), `documentation/warmup-batches.md` (what has actually been sent),
and live Supabase counts taken while writing this.

## Where the clock actually started

`outreach@apmgmaintenance.com.au` has sent **34 emails, ever**:

| When | What | Volume |
|---|---|---|
| 17–18 Aug | test sends through the app (`outreach-2026`) | 4 |
| Wed 19 Aug ~08:56 | warm-up batch 1, hand-sent from Gmail web | 15 |
| Thu 20 Aug ~08:04 | warm-up batch 2, hand-sent from Gmail web | 15 |

The 2,337 emails sent 15–28 July did **not** come from this mailbox — it wasn't
provisioned until 29 July. Those went from whichever Google account the n8n
credential held at the time. So this domain/mailbox has no inherited reputation,
good or bad: **warm-up day 1 is Wed 19 Aug 2026.**

## The ramp

Weekdays only — no weekend sends. Business inboxes (childcare admin, aged-care
facility managers) don't read them, and weekend bursts from a new domain look
like a list blast.

| Phase | Dates | Per weekday | How it's sent | Emails |
|---|---|---|---|---|
| Week 1 — seed | Wed 19 – Fri 21 Aug | 15 | Gmail web, by hand | 45 |
| Week 2 — hold | Mon 24 – Fri 28 Aug | 25 | Gmail web, by hand | 125 |
| Week 3 — first automated | Mon 31 Aug – Fri 4 Sep | 40 | app → n8n, paced | 200 |
| Week 4 — scale | Mon 7 – Fri 11 Sep | 60 | app → n8n | 300 |
| Full volume | **Mon 14 Sep onward** | 80–100 | app → n8n | — |

**The two dates that matter: first automated send Mon 31 Aug. Full volume Mon 14 Sep.**

That's the 3–4 week ramp doc 32 called for, counted from the 19 Aug start. Google's
hard ceiling (2,000 messages/day per user, 3,000 external recipients) is nowhere
near binding — the constraint is reputation, not quota.

Two notes on where we already deviate from doc 32, deliberately:

- Doc 32 prescribed 5–10/day of *seeded, replies-first* mail — real humans who
  reply, not prospects. We are running 15/day of cold prospects instead. It has
  held for two days (no bounces, no complaints observed), so keep going, but this
  is the riskier version of the plan and the reason week 2 holds at 25 rather than
  jumping to 40.
- Doc 32 said no links for the first few days. Every warm-up email carries a
  tracked link. Again: it has held, but it's why the ramp shouldn't be compressed.

**Stop rules.** Roll back one week's step and hold for three days if any of these
show up: a bounce rate above ~2% in a batch, any spam complaint at all, a hard
bounce on a domain we've mailed before, or Gmail starting to defer/queue sends.

## Two engineering gates before week 3

Automated sending is not usable today. Both of these are code, not deliverability,
and both must land before **Mon 31 Aug**:

1. **Batches under 50 get padded upward.** `MIN_SEND_EMAILS = 50` in
   [lib/pipeline/campaign.ts:90](../lib/pipeline/campaign.ts#L90) tops a small
   recipient list up with the *alternate* addresses of the same leads. Ask for a
   40-lead batch and the app sends ~50 emails, several of them second and third
   addresses at orgs we just emailed. A controlled 40/day batch is impossible
   until this is overridable.
2. **Nothing paces the send.** The workflow in
   [references/APMG Campaign Send (clean).json](../references/APMG%20Campaign%20Send%20(clean).json)
   is webhook → Split Messages → Gmail → Aggregate → Respond. There is no Wait or
   Loop node, and no chunking in
   [app/api/pipeline/campaigns/send/route.ts](../app/api/pipeline/campaigns/send/route.ts)
   (`MAX_RECIPIENTS = 1000`). 40 emails would leave in one burst. Needs a Wait node
   at roughly one email every 20–40 seconds, so a day's batch spreads over hours.

## The real constraint is the list, not the warm-up

This is the part that actually decides when returns arrive:

| | Count |
|---|---|
| Leads in the database | 8,077 |
| …that have any email address | 1,758 |
| …already emailed at least once (July) | 1,638 |
| **Never emailed + has email + VIC address** | **35** |
| …of those, in-sector (aged care / schools / childcare) | ~24 |
| Never emailed but interstate (Sydney / Brisbane) — out of area | 95 |

So when the mailbox is warm on 14 Sep, there are roughly **25 new VIC prospects
left to send to**. `documentation/warmup-batches.md` already says it: "the clean
fresh-VIC pool is exhausted; future batches are re-touches until new leads are
scraped."

Weeks 3 and 4 need 500 emails. There are two sources, and both need work started
**now**, in parallel with the warm-up:

- **Re-scrape VIC** — Email Finder over suburbs and categories we haven't covered.
  This is the long pole for ROI and it has no dependency on the warm-up at all.
  Start this week.
- **Re-touch the ~830 VIC leads emailed in July.** Legitimate (none of them
  closed) and the only pool big enough to fund weeks 3–4. Different angle and
  copy, not a resend.

## Client-list exclusion is still manual

Zac's customer list has no home in the system — there is no clients table and no
suppression import; `email_suppression` holds exactly **1** row. Each warm-up batch
is hand-checked against the list. That works at 15/day and will not survive 60/day
through the app, where a single mis-send goes to an existing customer. **Import the
customer list as suppressions before week 3** — it's the one gate with contractual
consequences rather than deliverability ones.

## What we've actually earned so far

All time, across 2,371 sends:

- **1 genuine cold-outreach enquiry** — Croydon North Kindergarten, 22 July: clicked
  7 days after the July send, used the chat, opened a service card, accepted consent,
  submitted the form, came back 80 minutes later. **It was never answered.** Batch 2
  re-approached them this morning.
- 5 other enquiry submissions (13–17 Aug) are internal/test traffic.
- 17 sales handoffs, none of which produced an enquiry.
- Click counts are bot-inflated: gateway scanners detonated 14/15 batch-1 links and
  12/15 batch-2 links within seconds of sending. Discount "Engaged"/"Warm" badges.

Read plainly: 2,337 emails went out in July and produced one real enquiry that sat
unanswered for four weeks. Warm-up is not what's holding returns back. Reply speed
and a fresh VIC list are.
