# Console audit trail + removal of fabricated data — design

**Date:** 2026-08-09
**Status:** approved for planning

## Why

An admin looking at the Sales desk cannot currently tell what is real. Three
separate problems produce that:

1. **Sales state is fiction.** `markContacted`, `markLost`, `closeDeal` and
   `revertStatus` (`components/apmg/SalesProvider.tsx:489-554`) mutate React
   state and nothing else. No network call, no row. Every reload resets every
   lead to `new` — `toSalesLead` hardcodes `status: "new"`
   (`SalesProvider.tsx:191`). A closed deal with a note and a value survives
   until the tab is refreshed, then never happened.

2. **Nothing records who did anything.** `portal_events`
   (`supabase/portal-telemetry.sql:20-33`) has no actor column, and both
   writers pass an empty `props`: the send ledger
   (`app/api/pipeline/campaigns/send/route.ts:282-292`) and the hand-off ledger
   (`app/api/sales/handoff/route.ts:279-283`). `requirePermission` already
   resolves the caller's verified email and discards it
   (`lib/rbac/server.ts:74-78`).

3. **Some surfaces fabricate outright.**
   - `SALES_REP = "Dana Okafor"` renders unguarded on the live Sales header
     (`components/apmg/SalesPage.tsx:947`) — an invented human name printed over
     real data.
   - The campaign send route answers `{ok: true, sent: N}` when the n8n webhook
     is unresolved (`campaigns/send/route.ts:255`). Because a configured webhook
     whose Integrations toggle is off *also* resolves to demo
     (`lib/pipeline/server.ts:112-114`), **pausing an automation makes sends
     report N delivered while sending zero.**
   - When Supabase is unconfigured the Sales queue serves an eight-record
     preset (`lib/data/sales.ts:50-272`) that reads as real leads. The
     screenshot that prompted this work came from such a deployment.

The 4 real hand-offs (2026-08-01) and 2,338 real sends (2026-07-15 → 07-28)
all predate Google SSO — the first `app_users` row is 2026-08-04 — so no
existing row can be attributed to a person, and none will be invented.

## Goals

- Every sales interaction is persisted server-side, attributed to the Google
  SSO identity that performed it, and readable by an admin with timestamp,
  note and value.
- No surface can render fabricated data. Unconfigured infrastructure produces
  an honest error, never plausible-looking rows.
- The audit trail cannot drift from the state it describes.

## Non-goals

- Proving a phone call physically occurred. Decided: **attributed intent**.
  The trail records that a named person asserted contact and stakes their
  account on it. Events the system genuinely witnesses (a delivered send, a
  tracked-link click) are labelled `witnessed` so admin can tell them from
  `claimed` at a glance, but no telephony integration is in scope.
- Backfilling actors onto pre-SSO rows. They are labelled
  `pre-SSO — actor not recorded`.

## Decisions

| Question | Decision |
|---|---|
| Scope of mock-data removal | Fail closed console-wide + real persistence in Sales |
| Audit scope | Sales lifecycle + hand-off, sends, role changes, view-as |
| Storage | One append-only table; lead state derived from it |
| Admin surface | Audit tab + per-lead decision history |
| Currency | AUD, stored as integer cents |
| Proof standard | Attributed intent, with `claimed` vs `witnessed` labelling |

## Data model

One table. `role_change_log` (`supabase/app-users.sql:61-69`) is dropped as
part of this change: it was declared with a writer that was never built and
holds **0 rows** (verified against production). Two audit logs would be worse
than one, and its purpose is subsumed here.

```sql
create table if not exists public.console_audit (
  id           uuid primary key default gen_random_uuid(),
  action       text not null,
  actor_email  text not null,
  actor_role   text not null,
  -- non-null ONLY when an admin performed this while previewing another role.
  -- A null check answers "was this impersonated?".
  acting_as    text,
  -- 'claimed'   — a human asserted it (marked contacted, closed a deal)
  -- 'witnessed' — the system observed it (send accepted, link clicked)
  source       text not null default 'claimed' check (source in ('claimed','witnessed')),
  lead_id      uuid,          -- lead-scoped actions
  target_email text,          -- user-administration actions
  note         text,
  value_cents  bigint,        -- AUD cents; integers only, never floats
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);
```

Deliberately no foreign key on `lead_id` or `target_email` — the same rule the
dropped table already articulated: the log must outlive the row it describes,
or deleting a user or reimporting a lead erases exactly the history an audit
log exists to keep. Leads are reimported routinely
(`portal-telemetry.sql:25` follows the same convention).

RLS enabled with **no policies** — service-role only, matching
`portal_events` (`portal-telemetry.sql:37`). Indexes:
`(lead_id, created_at)` for the replay read, `(created_at desc)` for the Audit
tab, `(actor_email)` for per-person filtering.

**Append-only by construction.** No UPDATE or DELETE path exists in
application code. Reopening a deal writes a `reopened` row; it never edits the
close. `meta` carries action-specific detail: `from_role`/`to_role` for role
changes, `campaign` and recipient count for sends, resolved webhook `mode` and
`source` for sends.

### Action catalog

Lead lifecycle: `contacted`, `uncontacted`, `closed_won`, `closed_lost`,
`reopened`, `handoff`, `returned`.
Admin: `campaign_send`, `role_change`, `invite`, `force_logout`, `view_as`.

`uncontacted` exists because the UI already offers "Undo contacted"
(`SalesPage.tsx:356-359`) and the current action set had nothing for it.

### State is replayed, not stored

`lib/sales/audit.ts` — a pure, client-safe module (no `server-only` import,
following `lib/sales/queue.ts` and `lib/sales/handoff.ts`) exporting the row
type, the action catalog, and the reducer:

```
replay(rows) -> { status, closedNote, closedValueCents, closedAt, closedBy, source }
```

Rules:
- Rows fold in `created_at asc, id asc` order. The `id` tiebreaker is required
  for determinism and matches the house pattern at
  `app/api/sales/queue/route.ts:81`.
- A lead with zero rows is `new` — not an error. On day one this is the
  majority case.
- `handoff` is a **cycle boundary**: it resets state to `new`. Without this, a
  lead that was returned and later handed over again would replay as
  `returned` forever.
- `reopened` and `uncontacted` clear the close snapshot.

Because the state is the fold, a close cannot exist without an author. That is
the property the whole design exists to buy.

## Write path

### Identity comes from the session, never the client

`resolveSession` already computes `email`, `trueRole` and `viewAs`
(`lib/rbac/server.ts:56-61`). `GuardResult` is widened to carry all three.
Every mutating route already calls `requirePermission`, so this single change
makes the actor available everywhere it is needed.

Any `actor_email` appearing in a request body is ignored outright.

**This breaks `lib/rbac/server.test.ts:147` and `:177`**, which assert the
guard result with exact-match `toEqual`. Updated in the same commit.

### The write is the action

`lib/audit/write.ts` (server-only) exposes `recordAudit(actor, entry)`. Its
contract is deliberately the **inverse** of `insertPortalEvents`
(`lib/portal/server.ts:339-364`), which returns `false` and lets callers treat
failure as best-effort: `recordAudit` failing fails the request. There is no
code path that changes a deal's state without writing who did it, and the UI
never optimistically renders a close that was not recorded.

### Routes

| Route | Change |
|---|---|
| `POST /api/sales/status` | **New.** `{leadId, action, note?, valueCents?}`. `leads.contact` for contacted/uncontacted; `leads.close` for closed_won/closed_lost/reopened. Returns the replayed state. |
| `GET /api/sales/queue` | Folds `console_audit` into each row's `status` and returns `statusTotals` for the whole queue. |
| `POST /api/sales/handoff` | Writes `handoff` / `returned` audit rows **before** the existing hand-off-row deletion at `route.ts:293-302`, so a return cannot erase the record that a hand-off happened. Keeps ownership of `returned`; `/api/sales/status` deliberately does **not** duplicate it. |
| `POST /api/pipeline/campaigns/send` | Hard-fails when the webhook is unresolved (see Hardening). Writes one `campaign_send` row, `source: 'witnessed'`, only after a live 2xx. |
| `PATCH /api/portal/inquiries` | Gains `requirePermission("enquiries.manage")` — the file currently has **zero** permission checks — plus an audit row. |
| `POST /api/auth/view-as` | Writes a `view_as` row on every role assumption and exit. |
| `PATCH /api/admin/users` | Writes `role_change` / `invite` / `force_logout` rows (replacing the never-built `role_change_log` writer). |
| `GET /api/admin/audit` | **New.** `audit.view` only. Filter by actor, action, date range, lead; paginated server-side. |

`/api/sales/handoff` layers `portalAdminAuthorized` on top of RBAC
(`route.ts:184-199`). `/api/sales/status` uses RBAC only: the shared secret
predates real sessions and adding it to a new rep-facing route would gate reps
on an admin key. Noted deliberately rather than by omission.

### Permission

New `audit.view`, admin only — `sales` does not receive it. Adding a
permission is a **compile error** until it is placed in `lib/rbac/sections.ts`
(the `_assertEverythingIsSectioned` exhaustiveness check at `sections.ts:113`),
and `sections.test.ts` requires a `short` label distinct from the raw key. It
goes in the System section. The Audit nav tab needs `TabId` and `NAV` entries
in `lib/nav.ts` plus the `DashboardShell` switch; it is added as an item under
the existing System caption, since `sections.test.ts:44-46` pins section
captions to NAV captions in order.

## Admin surface

**Audit tab** (admin only): reverse-chronological, filterable by person,
action, date range and lead. Each entry shows timestamp, actor email, the
`(as sales)` impersonation marker when `acting_as` is set, a `claimed` /
`witnessed` badge, the business name, the note in full, and the value in AUD.
CSV export.

**Decision history** on a lead — named to avoid colliding with the existing
"lead trail" vocabulary (`components/apmg/LeadTrail.tsx`,
`/api/portal/lead-activity`), which already means click telemetry. Admin-side.

Pre-SSO rows render as `pre-SSO — actor not recorded`, styled as absent data
rather than as a user.

## Hardening

`lib/pipeline/server.ts` gains `requireLiveSupabase()`: in production
(`NODE_ENV === "production"` or `VERCEL_ENV` set) a `demo` state is a 503, not
a fallback. Applied across the 13 route files carrying `state === "demo"`
branches, **with two deliberate carve-outs**: `/api/portal/events` and
`app/t/[id]` are public visitor endpoints, and 503-ing them would break the
tracked-link redirect for real leads. The carve-out is commented in place.

The same rule covers the campaign webhook: an unresolved or paused webhook is
a 503 in production, never `{ok: true, sent: N}`.

Client-side fabrication removed: `SALES_LEADS` and `SALES_REP` deleted from
`lib/data/sales.ts` (the `SalesLead` / `SalesStatus` **types** stay — seven
components import them); `SalesProvider`'s demo-seeding branch
(`SalesProvider.tsx:294-308`) deleted along with the `overrides` and
`statusHistory` maps, which the server now owns; the rep name in the Sales
header comes from the session. `DEMO_SUMMARY` / `DEMO_INQUIRIES`
(`lib/data/enquiries.ts`) and `DEMO_LEAD_ACTIVITY` / `DEMO_ANONYMOUS` /
`DEMO_ACTIVITY_TOTALS` (`lib/data/leadActivity.ts`) go the same way.

## Losing a deal

`closed_lost` is today a bare X button straight to `markLost`
(`SalesPage.tsx:373-382`): no note, no modal, and lost leads never reach the
Closed-deals tab, so they vanish entirely. It gains the same note-required
modal as a win, with no value field. "What are the notes" has to hold for a
loss as well as a win.

## Currency

Values are AUD integer cents in storage, converted at the UI boundary.
`formatUsd` (`lib/format.ts:18`) becomes `formatAud` and the `usd0` KPI format
becomes `aud0`; five call sites in `ClosedDealsPage`, `SalesPage` and
`OverviewPage` follow. `CloseDealModal.tsx:112` is relabelled from "Closed
value (USD)". The server shares the modal's `MIN_NOTE = 3`
(`CloseDealModal.tsx:12`) rather than redeclaring it.

## Error handling

- Audit insert fails → request fails, UI shows the error, no state change.
- Missing `console_audit` table → the same `isMissingPortalTable` treatment
  used elsewhere: a "run the migration" 409 on writes, not a silent demo
  degrade.
- Concurrent actors: append-only makes last-write-wins safe. The client
  renders the server's replayed state from the response rather than a local
  override, and the existing 20-second poll surfaces the other actor's action.

## Testing

Vitest, `environment: "node"`, and `vitest.config.ts` includes only
`lib/**/*.test.ts` and `app/**/*.test.ts` — there are no component tests, so
the reducer must carry the weight.

- `lib/sales/audit.test.ts` — the reducer: empty history → `new`; each
  transition; `handoff` as cycle boundary; reopen clearing the close snapshot;
  `created_at`-tie ordering by `id`.
- `app/api/sales/status/route.test.ts` — permission matrix per action;
  client-supplied `actor_email` ignored; note shorter than 3 chars rejected;
  audit-insert failure fails the request.
- `lib/rbac/server.test.ts` — updated for the widened `GuardResult`.
- `app/api/admin/audit/route.test.ts` — `sales` role gets 403.
- `lib/pipeline/server.test.ts` — `requireLiveSupabase()` returns 503 in
  production when Supabase or the campaign webhook is unresolved, and passes
  through in development. This is the regression guard for the fail-closed
  rule; a source-level check that no component imports a preset array is not
  expressible in this suite (it has no component tests), so the preset arrays
  are deleted outright instead of guarded.

Tests touching `lib/rbac/server.ts` need `vi.mock("server-only", () => ({}))`
(`server.test.ts:21`).

## Rollout order

1. Migration `supabase/console-audit.sql` (+ drop `role_change_log`), announced
   from `schema.sql`'s footer where `portal-telemetry.sql` is announced.
2. `lib/sales/audit.ts` reducer + tests — pure, no dependencies.
3. `GuardResult` widening + test updates.
4. `recordAudit` + `POST /api/sales/status` + queue route folding.
5. `SalesProvider` switched to server state; in-memory maps deleted.
6. Audit writes added to hand-off, send, enquiries, view-as, users routes.
7. `audit.view` + Audit tab + decision history.
8. Fail-closed sweep + preset deletion.
9. Currency conversion.

Steps 1–5 are independently shippable and already deliver "who closed this,
when, with what note and value".

## Risks

- **Step 5 has no test coverage** — `SalesProvider` is a component and the
  suite does not include components. Verify by hand against a live queue.
- The fail-closed sweep touches 13 route files; the two public carve-outs are
  the failure mode to watch, since getting them wrong breaks tracked links for
  real leads.
- Dropping `role_change_log` is safe today (0 rows) but is irreversible once
  merged; the migration drops it explicitly rather than leaving a second
  unused audit table to confuse the next reader.
