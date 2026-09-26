# Hot-Lead Follow-Up Pipeline — Design

**Date:** 2026-09-25
**Status:** Implemented 2026-09-26 — pending supabase/follow-ups.sql and a live test send
**Scope:** Phase 1 of "Automated Lead Follow-Up". The broader Email Marketing
request (newsletters, templates, nurture, promos, reactivation) is a separate,
later spec.

## 1. Intent

Leads who have shown real interest — opened at least one service on the portal
— should get a personal follow-up email about *that* service, written uniquely
for them by Claude, instead of waiting in Hot Leads or getting another generic
cold email. A human approves every email before it leaves.

**Success:** a hot lead appears in a Follow-Ups queue with a ready-to-approve,
service-specific draft; one click sends it through the same guards as a cold
send; a second, different touch comes due 5 business days later; the lead then
moves to Sales.

### What Kane decided (2026-09-24/25)
- Hot-lead follow-up first; Email Marketing gets its own spec later.
- **Claude drafts, a human approves.** No unattended sending.
- **Up to 2 touches** per lead.
- **Approach A:** on-demand queue — no scheduler, no cron.
- **Email first, then Sales:** leads already handed to Sales are skipped; a lead
  that finishes the sequence is flagged "Ready for Sales".

### Out of scope (phase 1)
- SMS, calls, tasks — no provider exists (would need e.g. Twilio).
- Customer reactivation — conflicts with the "never email an existing customer"
  rule from the 2026-07-29 client call.
- Reply detection — mail goes out through Gmail via n8n and nothing reads the
  inbox. Replies are marked by hand ("Replied — stop").
- Pre-drafting on a schedule (approach B) — can be layered on later.

## 2. Who enters the pipeline

**Trigger:** `leadScore(lead) >= 66` ([lib/data/leadScore.ts](../../../lib/data/leadScore.ts)).
66 is exactly what one service open scores (`60 + 29·(1−e^(−1/4)) ≈ 66.4`), so
the trigger means "opened at least one service". Scores come from the existing
`/api/portal/lead-activity` read — no new scoring, nothing stored.

**Excluded** (checked when the queue loads, and again at send time):
| Reason | Source |
|---|---|
| Enquired (score ≥ 90) | `portal_inquiry` events — Sales already owns them |
| Handed to Sales | `sales_handoff` events (`/api/sales/handoff`) |
| Archived | same hand-off store |
| Opted out, by address or organisation domain | `fetchSuppressedEmails` / `fetchSuppressedDomains` |
| On the Master Client List (`blocked` match) | `partitionByClientGuard(…, clientGuardData())` |
| No valid email | `bestEmail(lead.emails)` |
| Sequence finished | `follow_ups` rows (touch 2 sent, or any touch skipped/replied) |

## 3. Data model

New hand-run script `supabase/follow-ups.sql` (idempotent, like the other
`supabase/*.sql` files):

```sql
create table if not exists follow_ups (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references leads(id) on delete cascade,
  touch         smallint not null check (touch in (1, 2)),
  status        text not null default 'draft'
                check (status in ('draft','sent','skipped','blocked','replied')),
  subject       text,
  body_html     text,
  service_slug  text,          -- the service this email leads with
  model         text,
  note          text,          -- skip/block reason, draft error
  drafted_at    timestamptz,
  sent_at       timestamptz,
  sent_by       text,          -- console user email
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (lead_id, touch)
);
create index if not exists follow_ups_status_idx on follow_ups (status);
alter table follow_ups enable row level security;  -- service-role only
```

**Lead state is derived, not stored:**
- **Ready to draft (touch 1):** eligible, no `follow_ups` row.
- **Ready to draft (touch 2):** touch 1 `sent`, at least **5 business days**
  since `sent_at` (Mon–Fri, `Australia/Melbourne`), still eligible, no touch 2 row.
- **Awaiting approval:** a row with `status = 'draft'`.
- **In sequence:** touch 1 sent, touch 2 not yet due — show the due date.
- **Done → Ready for Sales:** touch 2 sent, or any row `skipped` / `replied`.
  A `blocked` row (the guard dropped it) is also terminal and shows its reason.

**Send ledger:** each sent follow-up also writes the normal `email_sent` row to
`portal_events` with `campaign = 'hot-followup'` and
`props = { kind: 'follow_up', touch }`. This is required, not optional:
- Telemetry counts it, and follow-up clicks get their own tag.
- `readLeadHistories` sees it, so a later cold compose knows the lead was emailed.
- `isKnownCampaign` checks the ledger, so the unsubscribe links inside follow-ups
  are only accepted once the tag has ledger rows.

## 4. Drafting

- **Same writer, same live prompt.** `draftEmail()` ([lib/ai/composeEmail.ts](../../../lib/ai/composeEmail.ts))
  with the **live `compose_prompt` row** (`loadComposePrompt()` / `resolveModel()`)
  and the cached sector KB system block. The DB row stays in charge and is never
  overwritten.
- **New pure module `lib/ai/hotFollowUpPrompt.ts`**, exporting
  `buildHotFollowUpPrompt(history, touch)`. Its output is appended to the user
  message, the same way `serviceFocusPrompt` and `buildFollowUpPrompt` are, so
  the cacheable system prefix stays byte-identical.
  - **Touch 1:** starts from `buildFollowUpPrompt(history)`, which already refers
    honestly to the gap since the last email and leads with the opened services.
    It adds that the most-opened service is *the* subject of the email and asks
    for one concrete, relevant next step.
  - **Touch 2:** also starts from `buildFollowUpPrompt(history)`, where history
    now includes touch 1. It takes an angle from `FOLLOW_UP_ANGLES`, deterministic
    per lead so a redraft doesn't flip-flop, and differs from touch 1. It's
    shorter, still about the same service, and gives an easy, low-pressure
    "not right now?" way out.
  - **Both touches keep the rule** that the email never mentions or hints that we
    saw what the lead viewed or clicked.
- **Service steer:** `service_slug` is the lead's most-opened service
  (`LeadHistory.services[0]`). Its hero image and alt text come from
  `serviceBySlug()` ([lib/pipeline/services.ts](../../../lib/pipeline/services.ts)).
- **Endpoint:** `POST /api/followups/draft { leadIds: string[] }`, max 20 per
  request, drafted in order like the compose route. It re-checks eligibility,
  reads `readLeadHistories(…, 'followups')`, then upserts the `draft` row. A
  redraft only overwrites a row that is still `draft`.
- **Failure:** a failed draft writes nothing, or keeps the previous draft, and
  returns the per-lead error. The UI shows it on the card.

### Scanner flag
The click trail is bot-inflated: mail-gateway scanners open tracked links and
have even opened the chat. Each card therefore shows its evidence: the service
opened, its count, and the time from the last `email_sent` to the first service
open. If that first open came **less than 60 seconds** after delivery, the card
carries a **"likely scanner"** badge. It's informational only; the human
decides.

## 5. Sending

- **Extract `lib/pipeline/deliver.ts`** from
  [app/api/pipeline/campaigns/send/route.ts](../../../app/api/pipeline/campaigns/send/route.ts):
  `deliverCampaign({ campaign, recipients, base, playbooks, ledgerProps? })`.
  It runs, in the existing order:
  1. client guard
  2. address suppression
  3. domain suppression
  4. render with `trackedLink`, then `htmlToText`
  5. refuse if the webhook is paused or unconfigured
  6. n8n POST with `webhookAuthHeaders()`
  7. `email_sent` ledger insert

  It returns the same result shape the route returns today. **The cold send
  route's behaviour must not change**: its existing tests guard the refactor.
  - Adds a **per-recipient hero** (`hero` / `hero_alt` on each recipient,
    falling back to the send-level service), because each follow-up can pitch a
    different service. The n8n payload shape is unchanged, since `hero` was
    already per message.
- **`POST /api/followups/send { ids: string[] }`:**
  - Loads the `draft` rows by id from the DB and never trusts the body's copy.
    Edits go through `PATCH /api/followups/:id { subject, body_html }` first.
  - Re-checks eligibility. If the lead enquired, was handed off or was archived
    since drafting, the row becomes `skipped` with a note.
  - Calls `deliverCampaign` with `campaign: 'hot-followup'` and
    `ledgerProps: { kind: 'follow_up', touch }`.
  - Marks delivered rows `sent` (with `sent_at` and `sent_by`). Guard-dropped
    rows become `blocked`, with `note` set to the reason, for example "existing
    client (Hive Strata)" or "organisation opted out".
  - If the webhook is paused or unconfigured, rows stay `draft` and the error is
    reported. We never report a send that didn't happen.
- **Other row actions:** `POST /api/followups/:id/skip { note? }` and
  `POST /api/followups/:id/replied`.
- **Permissions** (`lib/rbac/permissions.ts`):
  - `followups.view`: view the follow-up queue
  - `followups.send`: draft, edit and send follow-ups

  Admin gets both (via `ALL_PERMISSIONS`). Sales gets neither in phase 1.
- All routes are `sameOrigin` plus `requirePermission`, the same as the existing
  send route.

## 6. UI

- **New tab `followups` ("Follow-Ups")** under the "Sell" nav section, with its
  own icon, component `components/apmg/FollowUpsPage.tsx`, and permission
  `followups.view`.
- **Three lists:**
  1. **Ready to draft:** lead, business, service chip, touch number, score and
     scanner badge, **Draft**, and **Draft all** (up to 20).
  2. **Awaiting approval:** editable subject and body (plain-text preview as
     sent), service chip, trail summary, scanner badge, **Skip**, **Redraft**,
     **Approve & send**, and a bulk **Send all approved**.
  3. **In sequence / done:** touch 1 sent with the touch 2 due date, **Mark
     replied**, the finished/blocked leads with their reasons, and a "Ready for
     Sales" state.
- **No polling.** The tab loads when opened and has a Refresh button, because of
  the Vercel free-tier transfer budget.
- **Hot Leads rows** gain a chip: "Following up · touch N sent" or "Ready for
  Sales". The hand-off action itself is unchanged.
- Follows `ui-standards.md` and the `components/ui` primitives.

## 7. Errors and degraded modes
- **Missing Supabase or table:** the tab shows "run `supabase/follow-ups.sql`",
  the same pattern Telemetry and Enquiries use.
- **Lead-activity read fails:** the tab shows an error and offers no actions.
  Nothing can be sent without a known-eligible lead and a saved draft.
- **Guard lookups fail:** suppression fails open, which is today's behaviour and
  is kept for consistency. The client guard is bundled, so it can't fail on a
  network error.

## 8. Testing
Vitest:
- **Eligibility:** each exclusion in §2, the touch 2 due date across a weekend,
  and the Melbourne timezone boundary.
- **`buildHotFollowUpPrompt`:** touch 1 vs touch 2 content, a stable angle per
  lead, and never producing "I saw", "you viewed" or similar.
- **Scanner flag:** the 60s threshold, and a lead with no send row.
- **`deliverCampaign`:** mocked fetch, covering client, address and domain drops,
  paused webhook, ledger props, and per-recipient hero. The existing
  send-route tests still pass unchanged.
- **Follow-up routes:** a stale draft (the lead enquired since drafting) gets
  skipped, sending uses DB copy and not body copy, and blocked rows get
  reasons.

Gate: `npx tsc --noEmit`, `npx vitest run` and `npx next build`. There is no
working lint.

## 9. Manual steps (Kane)
1. Run `supabase/follow-ups.sql` in the Supabase SQL editor.
2. Nothing in n8n: the Campaign Send payload is unchanged.
3. After the first real follow-up, check that its unsubscribe link and tracked
   CTA both work under the `hot-followup` tag.
