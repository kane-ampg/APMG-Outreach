# Reply Detection — Design

**Date:** 2026-09-28
**Status:** Spec approved 2026-09-28 — implementation plan: docs/superpowers/plans/2026-09-28-reply-detection.md
**Scope:** Read the outreach@ inbox, sort every inbound message, act on it, and
report human replies on the Telemetry PDF.

## 1. Intent

Nothing reads `outreach@apmgmaintenance.com.au`. The system cannot tell whether
anyone replied to 2,000+ cold emails, cannot stop a follow-up to someone who
already answered, and silently drops the opt-out requests that the emails' own
`List-Unsubscribe: <mailto:…?subject=unsubscribe>` header invites.

**Success:**
- The Telemetry → Export PDF period report shows how many **human** replies
  arrived, from how many leads, the reply rate, replies per campaign, and who
  replied with a snippet of what they said.
- Automated mail (out-of-office, ticket acknowledgements, bounces) is recognised
  and **not counted**.
- A human reply stops that lead's follow-ups and keeps it out of later cold
  campaigns, and the enquiry notification list is alerted within minutes.
- Emailed unsubscribes and hard bounces are suppressed automatically.

### What Kane decided (2026-09-28)
- **Automatic actions:** stop follow-ups on a human reply; honour emailed
  unsubscribes; suppress hard bounces.
- **Alert** the enquiry notification list on every human reply.
- **Human vs automated only** — no AI sentiment tagging. Opt-out requests are
  caught by rules.
- **Backfill** everything in the outreach@ inbox since 17 Aug 2026, alerts off.
- **Approach A:** n8n reads the inbox and forwards each message; the app sorts,
  matches, stores and acts.
- **Cold sends also skip leads who replied** (not just follow-ups).

### Out of scope
- **July replies.** The 2,337 emails of 15–28 July went from a different Google
  account; replies to them are unreachable unless that account is connected.
- **AI intent tagging** (interested / not interested) — rejected above.
- **Replies that land in Gmail's spam folder** — the trigger watches the inbox.
- **A Replies screen in the console, or a Replied badge on Sales/Telemetry** —
  the PDF, the alert and the follow-up exclusion are the surfaces for now.
- **Manually re-classifying a row** — fix in SQL if the classifier is wrong;
  the `rule` column says why it decided what it did.
- **The per-lead activity PDF** (`lib/data/leadActivity.ts`) — unchanged.

## 2. Architecture

```
Gmail inbox (outreach@)
   │  n8n "APMG Reply Capture": Gmail Trigger, every 5 min, INBOX only
   │  → GET message (full)  → GET thread (metadata: first SENT message's To/Date)
   ▼
POST /api/inbound/replies        (admin host, x-apmg-secret)
   │  lib/replies/classify.ts   pure: 7 kinds, first rule wins
   │  lib/replies/match.ts      pure: lead + campaign from candidates
   │  lib/replies/server.ts     Supabase reads/writes
   ▼
email_replies (one row per Gmail message)  ──► actions:
   human        → alert payload in the response (n8n sends it via Gmail)
   unsubscribe  → email_suppression reason 'unsubscribe-email'
   hard bounce  → email_suppression reason 'bounce-unknown'
   ▼
Readers: /api/portal/report (PDF) · follow-up eligibility · deliverCampaign guard
```

Why this approach: the n8n credential `APMG - Official Lead Gen Mail` already
holds the mailbox (it sends through `gmail.users.messages.send`), so there is no
new Google OAuth grant; the app is only invoked when mail arrives (Vercel free
tier); every rule lives in the repo under Vitest. Rejected: the app polling
Gmail itself (restricted-scope OAuth on a second Workspace, Hobby cron is daily),
and doing the logic inside n8n (untested, outside the `deliver.ts` guard).

## 3. The n8n workflow — `references/APMG Reply Capture.json`

Two entry points feeding one processing chain:

1. **Live:** Gmail Trigger (credential `APMG - Official Lead Gen Mail`), poll
   every 5 minutes, label `INBOX`, spam/trash excluded.
2. **Backfill:** Manual Trigger → HTTP `GET users/me/messages?q=in:inbox after:2026/08/17`
   paged via `nextPageToken`.

Processing chain, per message (HTTP Request nodes against the Gmail API, the
same way `Send Email (raw)` works):
- `GET users/me/messages/{id}?format=full` → headers, plain text (decoded
  `text/plain` part; `text/html` flattened if there is no plain part), labelIds.
- `GET users/me/threads/{threadId}?format=metadata&metadataHeaders=To&metadataHeaders=Date`
  → the earliest message carrying the `SENT` label: its `To` address and date.
- Code node builds the payload (§4) with `backfill: true|false`.
- HTTP `POST {APP_URL}/api/inbound/replies` with Header Auth `x-apmg-secret`
  (same secret as `N8N_WEBHOOK_SECRET`), retry on failure ×3.
- IF `response.alert` is present → Gmail node sends `alert.subject` /
  `alert.text` to `alert.to` (same credential as the other notifications).

The workflow's sticky note documents: the admin host URL (the customer host
hard-404s non-portal APIs), the secret, the backfill branch, and the spam-folder
blind spot.

## 4. Ingest endpoint — `POST /api/inbound/replies`

**Auth.** Header `x-apmg-secret` compared in constant time against
`N8N_WEBHOOK_SECRET`. Unset secret → `503` for every request (fail closed). No
`sameOrigin` (server-to-server). `proxy.ts` `isPublicAdminPath` gains exactly
`/api/inbound/replies` so the session gate lets n8n through; the customer host
still 404s it.

**Request body** (caps enforced; anything else → `400`):
```ts
{
  gmailId: string;            // required, unique key
  threadId: string | null;
  receivedAt: string;         // ISO; from internalDate
  from: string;               // raw From header ("Name <addr>")
  subject: string;            // ≤ 1,000 chars
  headers: Record<string, string>;  // ≤ 100 entries, values ≤ 2,000 chars; names lowercased
  text: string;               // ≤ 20,000 chars
  originalTo: string | null;  // To of the thread's first SENT message
  originalSentAt: string | null;
  backfill: boolean;
}
```

**Response:**
```ts
{ ok: true; kind: ReplyKind; duplicate: boolean;
  alert: null | { to: string; subject: string; text: string } }
| { ok: false; error: string; needsMigration?: true }
```

**Processing order:**
1. Validate → `classify()` → read match candidates → `match()`.
2. Insert the row with `processed_at = null` (`on_conflict=gmail_id`, ignore
   duplicates). If the row already existed **and** `processed_at` is set →
   respond `duplicate: true, alert: null`. If it existed unprocessed → resume.
3. Run the kind's actions (§6). Suppression upserts are idempotent.
4. Patch `actions` and `processed_at`. Only after that succeeds does the
   response carry an `alert` — a retry of an unprocessed row can at worst repeat
   an alert whose patch failed, never skip a suppression.
5. Any action failure → `500` with the reason; n8n retries.

Missing table → `503 { needsMigration: true }`. Supabase unconfigured → `503`.

## 5. Classification — `lib/replies/classify.ts`

Pure: `classify(input) → { kind, rule, bounce?: { type, code, recipient } , newText }`.
First matching rule wins; `rule` is a stable string such as
`header:auto-submitted` or `subject:out-of-office` for auditing.

**New text.** Every wording rule reads only `newText`: the body cut at the first
quote marker — a line starting `>`, `On … wrote:`, `-----Original Message-----`,
an Outlook `From:` / `Sent:` header block, or `________________`. Our own email
contains an unsubscribe link, so a quoted original must never be read as an
opt-out.

| # | Kind | Rules |
|---|---|---|
| 1 | `internal` | Sender domain is `apmgservices.com.au` or `apmgmaintenance.com.au`. |
| 2 | `bounce` | Sender local part `mailer-daemon` / `postmaster`; or header `x-failed-recipients`; or `content-type` `multipart/report` with `report-type=delivery-status`; or subject `Delivery Status Notification (Failure)`, `Undeliverable:`, `Undelivered Mail Returned`, `Mail delivery failed`, `Returned mail`. Sub-type from the first enhanced status code in the text: `5.1.x` / "address not found" / "user unknown" / "does not exist" / "no such user" → **hard**; `5.7.x` / "blocked" / "rejected" / "access denied" → **policy**; `4.x.x` / `5.2.2` / "mailbox full" / "temporar" → **soft**; no code → **soft**. Recipient: `x-failed-recipients` → `Final-Recipient` / "wasn't delivered to X" in the text → `originalTo`. |
| 3 | `unsubscribe` (subject) | Subject, trimmed, is exactly `unsubscribe` — what our `List-Unsubscribe` mailto produces. |
| 4 | `auto_reply` (headers) | `auto-submitted` present and not `no`; any of `x-autoreply`, `x-autorespond`, `x-autoresponder`; `precedence` ∈ `auto_reply`, `bulk`, `junk`, `list`; `list-id` or `list-unsubscribe` present (newsletters, not replies). |
| 5 | `auto_reply` (sender / subject) | Sender local part `noreply`, `no-reply`, `donotreply`, `do-not-reply`; subject starts `Automatic reply`, `Auto-reply`, `Autoreply`, `Auto:`, `Out of office`, `OOO`, `Away:`, `On leave`, `Annual leave`, or contains `Thank you for (your email\|contacting\|your enquiry\|your message)`, `We have received your`, `[Ticket`, `Ticket #`, `Case #`, `Request received`. |
| 6 | `unsubscribe` (wording) | `newText` matches `unsubscribe`, `remove (me\|us\|my/our/this email\|address)`, `take (me\|us) off`, `stop (emailing\|sending\|contacting)`, `do not / don't (email\|contact)`, `opt(ed)? out`, `no longer (wish\|want) to receive`. |
| 7 | `auto_reply` (body wording) | `newText` says, in the first person, `I am / I'm / I will be (currently) out of the office`, `away from the office/my desk`, or `on (annual\|parental\|maternity\|paternity\|sick\|long service) leave`; or `limited access to (my )?email`, `this (mailbox\|inbox\|email address) is (not\|no longer) monitored`, `this is an automated (message\|response\|reply\|email)`. |
| 8 | `human` | Anything else **that matched a lead** (§7). |
| 9 | `unmatched` | Anything else with no lead match. |

Rule 3 runs before the automated rules: a mail client's unsubscribe button may
stamp `Auto-Submitted` on the message it sends, and an opt-out must never be
lost to that. Rule 5 runs before rule 6 so a helpdesk acknowledgement whose body
says "to unsubscribe from these notifications" is read as automated, not as an
opt-out. Rule 7 runs after rule 6 so "I'm out of the office — please remove us
anyway" is honoured as an opt-out. Rule 7 needs first-person wording so a human
reply like "I was out of the office last week, but yes please" still counts.

`x-auto-response-suppress` is deliberately **not** a rule: it can ride on
ordinary Outlook mail, and a human reply misfiled as automated is the costliest
mistake this classifier can make. Outlook out-of-office replies are still caught
by `auto-submitted` (rule 4) or their `Automatic reply:` subject (rule 5).

`kind` is final after matching: a rule-8 message without a lead becomes
`unmatched`. Every other kind keeps its kind whether or not a lead matched (a
bounce's lead is still recorded for the report).

## 6. Actions

| Kind | Action |
|---|---|
| `human` | Build `alert` (skipped when `backfill`): to = `readSetting(SETTING_ENQUIRY_NOTIFY_EMAIL)`; subject `Reply from {business or sender} — {campaign}`; text = business, sender name + address, campaign, received time, the new text (≤ 1,000 chars), and "Reply from the outreach@ mailbox". No alert when the setting is empty (logged). Follow-up stop and cold-send skip need no write — both read `email_replies` (§8). |
| `unsubscribe` | Upsert the **sender** address into `email_suppression` with reason `unsubscribe-email`, lead + campaign when matched. The domain rollup then covers the organisation. |
| `bounce` hard | Upsert the **failed recipient** with reason `bounce-unknown`. |
| `bounce` policy / soft | None. Recorded and reported only — a broken DKIM/DMARC on our side would 5.7.x every recipient, and suppressing those would erase the list. |
| `auto_reply`, `internal`, `unmatched` | None. |

`recordUnsubscribe()` in `lib/portal/server.ts` gains an optional `reason`
(default `unsubscribe`, so the portal path is unchanged). A portal `unsubscribe`
keeps its merge-on-conflict upsert; every other reason inserts with
ignore-on-conflict, so a bounce can never overwrite an existing opt-out (which
would silently drop that organisation out of the domain rollup). The reasons stay on
the greppable list in `supabase/suppress-bounces.sql` — `bounce-unknown` and
`bounce-policy` already exist there; `unsubscribe-email` is added to it.

## 7. Matching — `lib/replies/match.ts`

Pure over candidates the server reads first.

1. **Thread:** `originalTo` → leads whose `emails` contain it (exact case, then
   lowercased — the To header carries the stored casing).
2. **Sender:** if no thread match, the sender address the same way.
3. **Domain:** if still none, `organisationDomain(sender)` → leads holding any
   address at that domain, via the `leads_by_email_domain` function (§10) —
   PostgREST cannot filter a `text[]` by suffix. `organisationDomain` already
   returns null for shared providers and whole-of-government school domains, so
   those never match.
4. **Tie-break:** several leads → the one with the latest `email_sent` at or
   before `receivedAt`. A **thread** hit with no send on record still matches
   (the Gmail thread itself proves we wrote to that address; campaign null).
   **Sender** and **domain** hits need a send on record, or any vendor sharing a
   prospect's domain would count as a reply.
   Bounces and internal mail skip the sender and domain tiers.
5. **Campaign:** the chosen lead's latest `email_sent.campaign` at or before
   `receivedAt`.

Rows record `match_via` ∈ `thread`, `sender`, `domain`, or null.

## 8. Changes to existing code

- **Opt-out domain rollup ignores bounces.** `fetchSuppressedDomains` adds
  `reason=in.(unsubscribe,unsubscribe-email)` (`OPT_OUT_REASONS`). Bounce rows (`bounce-unknown`, and the hand-entered
  `bounce-policy` row for `enquiry@bluemountains.edu.au`) block only their exact
  address. Exact-address suppression (`fetchSuppressedEmails`) is unchanged.
- **Follow-ups.** `LeadSignals` gains `repliedAt: string | null`, read in
  `readSignals` from `email_replies` (kind `human`, lead in the list; a missing
  table reads as no replies). `classifyLead` checks it right after `inquiries`:
  `finish("excluded", "Replied by email — answer them directly")`. The send route
  already re-runs eligibility before sending, so an earlier draft is refused.
- **Cold sends.** `deliverCampaign` drops recipients whose lead id has a
  `human` reply, alongside the client and opt-out drops, and reports them:
  `SendResult.replied?: number` and `repliedMatches?: {business, email}[]`
  (capped at 25 like `clientMatches`). A missing table fails open (no drops),
  matching the suppression helpers. The send screen shows the new drop line
  where it shows client drops.
- **`proxy.ts`:** `isPublicAdminPath` allows `/api/inbound/replies`.

## 9. Report — `/api/portal/report` + `TelemetryReportExport.tsx`

Window: replies by `received_at` in `[from, to)`, read with `readAllRows`.

New payload block:
```ts
replies: {
  available: boolean;          // false when email_replies is missing
  human: number;
  uniqueLeads: number;
  autoReplies: number;
  bounces: { hard: number; policy: number; soft: number };
  internal: number;
  unmatched: number;
  list: { receivedAt: string; business: string | null; from: string;
          campaign: string | null; snippet: string }[];   // newest 25 human
}
```
`outreach.campaigns[]` gains `replies` (human replies in the window attributed
to that campaign; a reply with no campaign counts under `(untagged)`).
`outreach.unsubscribes` counts only the two opt-out reasons and gains
`unsubscribesByLink` (`unsubscribe`) / `unsubscribesByEmail` (`unsubscribe-email`).
Emailed opt-outs are reported there, not in the `replies` block. `business` in
the list is the lead's `leads.name`.

PDF:
- **KPI card "Replies"** after "Email clicks": value `human`, note
  `{uniqueLeads} leads · {pct(uniqueLeads, uniqueLeadsEmailed)} of leads emailed`.
- **Section "Replies this period"** after the engagement funnel: table
  When · Business · From · Campaign · What they said (snippet ≤ 140 chars, via
  `esc()`); then a note — *"Not counted: N automatic replies, N bounces (N hard —
  suppressed, N blocked, N soft), N internal, N unlinked. Bounce rate: X% of
  emails sent."* Empty → "No human replies this period." Unavailable → "Reply
  tracking isn't set up yet — run supabase/email-replies.sql."
- **Campaign table** gains Replies and Reply rate (`replies / sent`) columns.
- **Unsubscribe note:** "N unsubscribes (N via link, N by email)".
- Funnel unchanged — a reply is not a step after a click.
- A reply counts in the period it **arrives**.

## 10. Data model — `supabase/email-replies.sql`

Hand-run, idempotent, RLS on with no policies (service role only).

```sql
create table if not exists public.email_replies (
  id               uuid primary key default gen_random_uuid(),
  gmail_id         text not null unique,
  thread_id        text,
  received_at      timestamptz not null,
  from_email       text not null,
  from_name        text,
  subject          text,
  snippet          text,          -- new text only, ≤ 500 chars
  kind             text not null
                   check (kind in ('human','auto_reply','bounce','unsubscribe','internal','unmatched')),
  rule             text not null,
  bounce_type      text check (bounce_type in ('hard','policy','soft')),
  bounce_code      text,
  bounce_recipient text,
  lead_id          uuid references public.leads(id) on delete set null,
  campaign         text,
  match_via        text check (match_via in ('thread','sender','domain')),
  original_to      text,
  backfill         boolean not null default false,
  actions          text[] not null default '{}',
  processed_at     timestamptz,
  created_at       timestamptz not null default now()
);
create index if not exists email_replies_received_idx on public.email_replies (received_at);
create index if not exists email_replies_lead_kind_idx on public.email_replies (lead_id, kind);
alter table public.email_replies enable row level security;

-- Domain-tier matching (§7): leads holding any address at an organisation domain.
create or replace function public.leads_by_email_domain(p_domain text)
returns table (id uuid, name text)
language sql stable
as $$
  select l.id, l.name
    from public.leads l
   where exists (select 1 from unnest(l.emails) e where lower(e) like '%@' || lower(p_domain))
   limit 50
$$;
revoke execute on function public.leads_by_email_domain(text) from public, anon, authenticated;
```

`on delete set null` keeps a reply counted after its lead's folder is deleted.
The function is revoked from the public roles so the anon key can never use it
to enumerate leads; the service role keeps its grant. The business name lives
in `leads.name` (there is no `business` column).

## 11. Files

New:
- `lib/replies/types.ts` — `ReplyKind`, payload/response contracts, caps, suppression reasons.
- `lib/replies/address.ts` (+ `.test.ts`) — `"Name" <addr>` parsing.
- `lib/replies/payload.ts` (+ `.test.ts`) — ingest body validation (§4).
- `lib/replies/classify.ts` (+ `.test.ts`) — §5.
- `lib/replies/match.ts` (+ `.test.ts`) — §7.
- `lib/replies/alert.ts` (+ `.test.ts`) — alert subject/text (§6).
- `lib/replies/server.ts` (+ `.test.ts`) — candidate reads, claim/finish, human-reply reads.
- `lib/replies/report.ts` (+ `.test.ts`) — the report's reply tallies (§9).
- `lib/replies/reportHtml.ts` (+ `.test.ts`) — the PDF's Replies section (§9).
- `lib/html.ts` — `escapeHtml`, moved out of the report component so the section builder can share it.
- `app/api/inbound/replies/route.ts` (+ `route.test.ts`) — §4.
- `supabase/email-replies.sql` — §10.
- `references/APMG Reply Capture.json` — §3.

Changed:
- `proxy.ts` — public path.
- `lib/portal/server.ts` (+ test) — `recordUnsubscribe` reason; `OPT_OUT_REASONS`; `fetchSuppressedDomains` reason filter.
- `supabase/suppress-bounces.sql` — reason list comment.
- `lib/followups/eligibility.ts`, `lib/followups/server.ts` (+ tests) — `repliedAt`.
- `lib/pipeline/deliver.ts` (+ test), `app/api/pipeline/campaigns/send/route.test.ts` (mock), `components/apmg/pipeline/SendCampaigns.tsx` — replied drop.
- `app/api/portal/report/route.ts` (+ test), `components/apmg/TelemetryReportExport.tsx` — §9.

## 12. Errors and degraded modes

| Situation | Behaviour |
|---|---|
| `N8N_WEBHOOK_SECRET` unset | Endpoint `503` for everything. |
| Bad/missing secret | `401`. |
| Malformed or oversized payload | `400` naming the field; visible in n8n executions. |
| `email_replies` missing | Endpoint `503 needsMigration`; report shows "not set up"; follow-ups and cold sends read no replies (fail open). |
| Action fails mid-way | Row stays unprocessed, `500`; n8n retry resumes it. |
| Notification list empty | Reply stored, no alert, warning logged. |
| Same message posted twice | `duplicate: true`, no repeated actions or alert. |

## 13. Testing

Vitest, fixtures as small literal objects in the test files:
- **classify:** Outlook OOO (`Automatic reply:` + `auto-submitted`), Outlook OOO with only `x-auto-response-suppress` (caught by subject, not the header),
  Gmail vacation (`auto-submitted: auto-replied`), Google DSN 5.1.1, Microsoft NDR
  550 5.1.10, 5.7.1 Barracuda policy block, 5.2.2 mailbox full, Outlook mailto
  unsubscribe (subject `unsubscribe`, empty body), human "please remove us",
  helpdesk ack (`[Ticket #…]`), staff sender, newsletter (`list-id`), **human
  reply quoting our footer's unsubscribe link → `human`**, human reply with a
  `>`-quoted OOO phrase → `human`.
- **match:** thread hit, sender fallback, domain fallback, shared-domain refusal,
  duplicate leads tie-break, lead never emailed → no match, campaign pick.
- **route:** secret unset/wrong, validation, duplicate processed/unprocessed,
  each kind's actions, backfill suppresses alerts, action failure → 500.
- **existing:** eligibility `repliedAt` exclusion; deliver drops + reports replied
  leads and fails open; domain rollup ignores bounce rows; report totals,
  unsubscribe split, campaign replies.

Gate: `tsc --noEmit` + `vitest run` + `next build` (lint is unavailable).

## 14. Manual steps (Kane)

1. Run `supabase/email-replies.sql` in the Supabase SQL editor.
2. In n8n, confirm `APMG - Official Lead Gen Mail` can **read** mail (a Gmail
   "Get many messages" test on the credential).
3. Import `references/APMG Reply Capture.json`; set the app URL (admin host)
   and a Header Auth credential `x-apmg-secret` = `N8N_WEBHOOK_SECRET`.
4. Deploy the app (push when told).
5. Run the backfill branch once (alerts off). Check the counts look sane.
6. Activate the live trigger. Confirm empty polls don't consume n8n executions
   on the current plan.
7. Reply to an outreach email from an outside address; confirm an alert arrives
   and the reply appears on a Telemetry PDF for today.
