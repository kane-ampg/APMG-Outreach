# Client review call — dashboard walkthrough, cost, and outreach guardrails

> **Date:** 2026-07-29, 13:30 AEST · ~29 minutes · video call, screen-shared
> **Transcript:** [transcripts/2026-07-29-1330-client-review-call.txt](transcripts/2026-07-29-1330-client-review-call.txt) — raw speech-to-text, **not proofread**
> **Recorded by:** the client side, who said they would forward the recording on
> **Status of this record:** written 2026-08-16, i.e. **18 days after the call**. Every action item below was re-checked against the repo as it stands today, so the "State on 2026-08-16" column is current, not aspirational.

## Why this file exists (and why it isn't in `sessions/`)

Everything in [`sessions/`](../sessions/) documents a *Claude Code session* — work done in this repo. This is different: it is the **client telling us what the product should do**. It is the first written record of APMG's own priorities in their own words, and several of them contradict what the code currently does. It is filed separately so it can be read as a requirements source, not as a build log.

## Who was in the room

Speaker labels in the transcript are diarisation guesses and are **unreliable** — Speakers 1 and 4 are almost certainly one person (they share the same topics, the same references to Nicole and Simon, and hand off mid-sentence). Read them as one client-side voice.

| In the transcript | Who this is | Role in the call |
|---|---|---|
| Speaker 2 | the developer / this repo's author | demoed the console, portal, chat and automations |
| Speakers 1 & 4 | the APMG stakeholder chairing the call | asked the questions, set the guardrails, owns the client list |
| Speaker 3 | background / crosstalk only | — |

Named but **not present**: **Simon** (sales — receives leads and enquiry notifications), **Nicole** (marketing — social content), **"Fargo"** (ASR-uncertain name; the person the recording was to be sent to, who was with a client that day). One further ASR artefact is unresolved: at 00:28 the stakeholder appears to address **"Max"** — no such name appears anywhere else in the project record, so treat it as a mis-hearing rather than a sixth participant.

## What was walked through, in order

1. The internal console dashboard, then the **customer portal** on its separate host — explicitly separate *"just because we don't want them accessing our admin mode"* (02:xx, ASR: "on-mode").
2. The tracked-link path: email → portal → `/t/<lead>` click recorded → shows up in telemetry. Demoed live; only **one enquiry** had ever come through.
3. The enquiry-notification wiring in **Integrations**, and who receives it.
4. The **login page and sales dashboard** — 1,634 leads visible to Sales.
5. The **lead counts** (see the numbers table below) and the email-finder automation.
6. **Anthropic spend**, and the Vercel / Supabase subscriptions.
7. The **portal chat bubble**, live-tested in the call.
8. The email finder running against a 175-lead folder (32 addresses recovered).

## Decisions and requests

Quotes are ASR verbatim, so they carry the transcript's mis-hearings; timestamps let you check them against the audio.

### 1. Drop the "family-run" positioning
> *"just a family run since 20one5. We'll take that off, because essentially now we are in a bit of a bigger platform… when we say family run, it will be, it can be like a small [company]"* — 02:44
> *"maybe put something along the lines of serving customers since [2015]"* — 03:08

The client does not want to read as a small family outfit while tendering against bigger companies. **Longevity yes, family framing no.**

### 2. Enquiry notifications must not land in one inbox
`info@apmgservices.com.au` is a general inbox used for *"jobs"* and is the first point of contact — the stakeholder's worry was that a lead sitting in a shared inbox gets missed while people are *"busy running around"* (05:18). Simon wants them; the stakeholder wants to be copied *"because I don't want it to be missed"* (05:31).

### 3. **Existing customers must never receive outreach** — the hardest requirement in the call
> *"there are customers that we have been working for about a year and also there are customers who has contracts with bigger companies like CDFM who we are a subcontractor… for example, there you will come across [leads] like Good Start. So this Good Start is a client of CDFM and we are a subcontractor for them… I don't want them to receive APMG emails"* — 25:57
> *"It's just that bit of clients that we have been working for a long time, I don't want them to be [bothered] by it."* — 26:44

The distinction the client drew is precise, and it is **not** "don't email anyone we know":
- **Fine to email:** businesses Simon has *approached* but never closed. *"This is called remarketing right, so I don't mind the people who they have already [been] arranged but not done business with… essentially that's very marketing. That's okay… even Apple does it."* (25:41)
- **Never email:** current customers, and customers held through a head contractor (CDFM) where APMG is the subcontractor. Emailing them puts a live commercial relationship at risk.

The agreed mechanic: the developer exports the full lead list, the client **highlights the accounts to exclude** and sends it back. *"Send me that list, I'll get it highlighted."* (27:01)

### 4. Put the chatbot on the real website
The stakeholder first asked why the landing page couldn't simply *be* the website (18:18). The answer was that the live CMS site is messy and doesn't answer a customer directly, so the portal stays as-is — but the **chat bubble should be embedded into apmgservices.com.au** via an iframe/snippet, because *"we already have invested in the [chatbot], so why not"* (20:03). Admin rights to the CMS exist on the client side (the site is run by an agency, ASR "a company called driver").

One condition, raised by the developer and agreed immediately: **a separate API key for the website chatbot**, so its cost is tracked apart from the portal's (20:20).

### 5. Two metrics the client asked for by name
> *"We need to know the [delivery] rates of [our] campaign, and we need to know the success of people who are coming into our website"* — 20:38

Read through the ASR: **email deliverability (bounce/delivery) per campaign**, and **conversion of site visitors**. Neither exists today.

### 6. Marketing stays separate from lead-gen
Nicole owns content and social; lead-gen is not expected to come out of the marketing platform. *"we'll keep the lead generation apart from the marketing side of it right now"* (13:14). The developer's proposal — post into sector Facebook community groups (aged care, childcare, schools) with **tracked links in the caption** so the source is attributable (11:19–12:10) — was accepted in principle, and the tracked TikTok/Instagram/Facebook links had already been emailed to Nicole. A separate marketing tool was **put on hold**, not cancelled: *"let's hold it for a [while] and see how we can best integrate it"* (23:37).

### 7. Lead volume gets disciplined
> *"I may have violated the Gmail rule just because I want to stress test it… we're not supposed to get 8000 leads in like three weeks… I think right now we're supposed to have a maximum, a 1000 lead"* — 12:16
> *"I would not expect like 8000 leads anymore because I must be much more disciplined"* — 22:48

Accepted by the client without complaint, with the observation that first runs always spike and then normalise (23:02).

### 8. Costs: keep Anthropic, cut the rest
Anthropic credit was at **$66 of $100 remaining**, which the developer considered fine given Opus writes the emails. The stated plan was to **not resubscribe to Vercel and Supabase** to save cost (21:18–21:54). See the contradictions section — this one does not survive contact with the architecture.

### 9. Cadence
Weekly catch-ups, **Wednesdays** (00:28, 22:23).

## Action items — and where each one actually stands today

| # | Item | Owner | State on 2026-08-16 |
|---|---|---|---|
| 1 | Remove "family-run / family-owned" framing; state longevity as *est. 2015* | dev | ✅ **Done.** `components/knowledgebase/business.md` now forbids the framing in so many words ("removed from this file and the portal on 2026-08-11"); the portal ships `"Australian Property Maintenance Group · Est. 2015"` and *"Operating since 2015"* |
| 2 | Add the stakeholder to the enquiry-notification recipients | dev | ⚠️ **Code ready, value unverifiable.** The list accepts up to `MAX_NOTIFY_EMAILS = 10` addresses via a tag input; whether the stakeholder's address is in the live `app_settings` row can only be checked in the running app |
| 3 | Export the full lead list for the client to mark up | dev | ✅ **Done that day** — `all-leads-leads-20260729.xlsx` / `.csv` exist in the developer's Downloads |
| 4 | Client returns the list with existing customers highlighted | **client** | ❓ **No record of it coming back.** Nothing in the repo consumes such a list |
| 5 | **Suppress existing customers from every send** | dev | 🔴 **Not built.** The only suppression is `email_suppression`, written *exclusively* by the unsubscribe route. No import path, no domain-level rule, no UI. **This is the largest open risk in the project** |
| 6 | Embed the chat widget on apmgservices.com.au | dev | 🔴 **Not built.** No embed route, snippet, or iframe host exists. (Key separation is already possible — the portal chat runs on its own `PORTAL_CHAT_ANTHROPIC_KEY`) |
| 7 | Campaign delivery / bounce reporting | dev | 🔴 **Not built.** `portal_events` records one `email_sent` row per delivered email and nothing about bounces; no Gmail delivery feedback is ingested anywhere |
| 8 | Site-visitor conversion metric | dev | ⚠️ **Partial.** The portal funnel (view → service open → enquiry) is instrumented; there is no single conversion figure surfaced to the client |
| 9 | Tracked social links for Nicole + per-source attribution | dev | ⚠️ **Shipped in code, migration still gated.** `apmg_src` capture and the "Where they came from" rollup exist, and the routes deliberately degrade if `portal_inquiries.source` is missing (`isMissingColumn`) — so an unrun migration fails silently rather than loudly |
| 10 | Dashboards/logins for Simon and Nicole | dev | ✅ **Done, and superseded.** The shared plaintext password demoed on the call is gone: Google SSO with an `@apmgservices.com.au` domain gate now populates `public.app_users`, and roles are sets granted from the Roles & Permissions tab |
| 11 | AI summary of "what this business needs" on the sales queue | dev | ⚠️ **Partial.** Per-lead enquiry-activity briefs shipped; the promised business-needs summary is not the same artefact |
| 12 | Cap scraping at ~1,000 leads/month | dev | ⚠️ **Policy only.** Nothing in the code enforces a monthly ceiling. `MAX_RECIPIENTS = 1000` is a *per-send* cap, unrelated |
| 13 | Run the email finder over the remaining leads | dev | ⚙️ **Ongoing.** 32 addresses from a 175-lead folder ≈ 18% recovery, at `MAX_FIND_LEADS = 50` per run |
| 14 | Cancel Vercel / Supabase paid plans | dev | ⚠️ **Do not action as stated** — see contradiction C1 |
| 15 | Send the recording to "Fargo" | client | ❓ unknown |

## Numbers quoted on the call

| Figure quoted | Said as | What the record says |
|---|---|---|
| Total leads | ~8,000 | 8,052 (2026-07-28 snapshot, doc 27) |
| "Contacted" | ~6,000 | Not corroborated. The send ledger shows **2,336 sends to 1,634 businesses** |
| Sales queue | 1,634 | ✅ matches exactly — this is the emailed-businesses count, not an engagement count |
| "1,600 are the hottest… a lot of activities" | 1,600+ | ⚠️ **Almost certainly the same 1,634 number reused.** Doc 27 puts genuinely *engaged* leads at **688**. Do not repeat "1,600 hot leads" to the client |
| Enquiries | 1 | ✅ one, and it had been forwarded |
| Email clicks | *"we only got one, unfortunately"* | Refers to the click that produced that enquiry, not total clicks |
| Anthropic credit | $66 left of $100 | Point-in-time |
| Email finder yield | 32 of 175 | ≈18% |
| Projected total after finder | *"could be like 9000"* | Aspirational |

## Contradictions and risks worth carrying forward

**C1 — "Cut Vercel and Supabase" contradicts itself inside 30 seconds.** At 21:18 the plan is to stop paying for both; at 21:43 the same speaker says *"this has to go online, otherwise… whatever leads come… I can't add more leads and scrape them off."* Supabase **is** the lead database and Vercel **is** where both surfaces are served — there is no version of this system that runs with those switched off. What is presumably meant is *drop from paid tiers to free*, which is a different decision with real consequences: free-tier Vercel bandwidth has already been a binding constraint on this project (short-polling blew the Fast Origin Transfer budget once), and Supabase free-tier projects pause on inactivity. **This needs an explicit re-decision before anyone cancels anything.**

**C2 — the client's exclusion requirement is architecturally harder than it sounded.** A highlighted spreadsheet gives us *business names*, but sends are keyed on *email addresses*, and `bestEmail()` picks one address per lead while `MIN_SEND_EMAILS = 50` **tops the recipient list up with alternate addresses** of leads that have several. Excluding `info@goodstart.example` therefore does not guarantee Goodstart is untouched — a second stored address for the same organisation can still be pulled in. Any real solution has to suppress at the **lead and domain** level and be enforced inside the send route, not applied to a list by hand.

**C3 — a shared password was spoken aloud on a recorded call** (06:36). Moot as of the SSO work, but it is the reason the recording should not be circulated beyond the people already named in it.

**C4 — nobody in the call knew whether anything had ever been delivered.** The whole conversation assumed emails were arriving. At that date the outreach mailbox was mid-authentication work (doc 32), had had **no warm-up and no test send**, and the sends counted in the ledger went from the *previous* sending path. The "delivery rates" ask in decision 5 is therefore not a reporting nicety — it is the missing evidence that the core loop works at all.

**C5 — "no more 8,000-lead bursts" is a promise, not a control.** Nothing prevents it recurring.

## Related session docs

- [18 — legal consent, unsubscribe & host wall](../sessions/18-legal-consent-unsubscribe-enquiry-notify.md) — the unsubscribe/suppression machinery item 5 would need to extend
- [24 — portal social source attribution](../sessions/24-portal-social-source-attribution.md) — the tracked-link plumbing behind decision 6
- [27 — stakeholder status report](../sessions/27-status-report-for-stakeholders.md) — the source of the corroborating figures above
- [28 — leads XLSX export per folder](../sessions/28-leads-xlsx-export-per-folder.md) — the exporter used for action item 3
- [29 — outreach mailbox](../sessions/29-outreach-mailbox-provisioned.md) and [32 — SPF/DKIM/DMARC & warm-up](../sessions/32-outreach-email-authentication-setup.md) — why C4 matters
- [31 — branded Vercel domains](../sessions/31-vercel-custom-domains.md) — the `customer.apmgservices.com.au` host discussed as "a different link"
