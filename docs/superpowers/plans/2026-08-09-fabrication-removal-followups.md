# Fabrication removal — residual findings

Companion to `2026-08-09-fabrication-removal.md`. That plan is complete and merged into
`feat/console-audit-trail` across nine commits. This file records what the work surfaced but
did **not** fix, so none of it is lost with the scratch workspace.

Verified at completion: `npm test` 235/235 across 20 files, `npx tsc --noEmit` clean,
`npm run build` succeeds. `npm run lint` fails repo-wide with "Invalid project directory" —
pre-existing and unrelated, confirmed by stashing on a clean tree.

## 1. Manual verification still outstanding

The plan called for a visual pass with Supabase unset. It was never performed: subagents were
barred from starting a blocking dev server. A reviewer substituted static checks where it could
(every `ratio()` guards `total > 0`, every `reduce` has an initial value, no bare `[0]` deref on
the not-connected paths, `tsc` clean proves no dangling preset import), so crash risk is low.
Four things still want a human's eyes:

1. **Sales with Supabase unset** — the header renders a `demo mode` chip *and* the "Not connected
   to the database" error card. Check they don't double-message. Then with Supabase live, confirm
   the signed-in name renders at `components/apmg/SalesPage.tsx:1030` — not blank, not `undefined`.
2. **Telemetry and Enquiries with Supabase live but `supabase/portal-telemetry.sql` not run** —
   the `needsMigration` path. This is the only route to finding #2 below in the wild.
3. **Hot Leads and the sidebar badge** — the badge previously counted `DEMO_LEAD_ACTIVITY`.
   Confirm it shows `0`, not `NaN`.
4. **Export PDF with Telemetry live** — button enabled, report carries no not-connected banner.

## 2. Pre-existing bugs found on the way (not caused by this plan, not fixed)

**Hot Leads markers vanish when a hand-off delete's re-read fails.**
`app/api/sales/handoff/route.ts:345` returns `json({ok: true})` when the DELETE landed but the
re-read failed. The shared `json()` then fills `handoffs`, `archived` and `returned` as `[]`,
and `lib/data/hotLeads.ts:391` treats them as authoritative. Every "Sent to Sales" / "Archived" /
"Returned" badge disappears until the next 20-second poll, and `handOffToSales`
(`lib/data/hotLeads.ts:408`) filters on `snapshot.handedOff`, so during that window it can
re-POST leads already sitting in the rep queue. Server-side idempotency protects the data; the
UI still lies. The `mark()` path at `:367` uses the same shape but is safe, because its POST
always returns either the re-read or the reconstructed pre-write state.

**A batch of unusable rows reports "no database configured".**
`app/api/pipeline/upload/route.ts:101` answers `mode: "noop"` when every row sanitises away for
want of a business name. `components/apmg/PipelinePage.tsx:415-432` branches only on
`"unconfigured"` and `"live"` and defaults everything else to `"unconfigured"`, so the operator is
told Supabase is missing when it is fine and the rows were simply unusable. `UploadMode` at `:34`
already includes `"noop"`; nothing branches on it.

**Two pipeline routes disagree about the same state.** For an unconfigured Supabase,
`upload` answers `mode: "unconfigured"` while `batches` and `leads` still answer `mode: "demo"`.
Each client happens to match its own route, so nothing is broken today — but this is exactly the
divergence that produced the drift bugs below, and it makes a shared-looking field non-shared.

**Stale preset module.** `lib/data/leads.ts` still holds `KPIS`, `LEADS_BY_MONTH`,
`LEADS_BY_SOURCE` and `RECENT_LEADS` (e.g. "Priya Nadar / Helix Robotics", value 48000). All five
importers are `import type` only, so nothing renders — but the header still reads "Realistic seed
values so the dashboard reads as a populated instrument", which is an invitation to re-import it.
Deleting it is the natural sequel to this plan.

## 3. Deliberately deferred

- `components/apmg/EnquiryActivityModal.tsx:104` — a stale "Demo data —" prefix on an AI-summary
  provenance string. The substantive claim after it ("counted-facts summary, written without a
  model call") stays true. The last such string in `components/`.
- `app/api/pipeline/upload/route.ts:115-118` — the dedicated 500 branch is unreachable in
  production, since `requireLiveSupabase` also intercepts `misconfigured`. Fails safe.
- `components/apmg/pipeline/SendCampaigns.tsx:412` — a response-cast union still names `"demo"`.
  Inert: it is a type assertion over untyped JSON and its only reader is a strict `=== "live"`.
- The same file folds `"paused"` into `"unconfigured"`, so the "automation is paused" distinction
  is unrecoverable on that tab (it *is* preserved on the Stored Leads tab).
- `app/api/pipeline/campaigns/send/route.ts` emits a `suppressed` count that no client reads —
  operators never learn how many recipients were dropped for unsubscribes.
- `app/t/[id]/route.ts:82` — the operator trace logs `verdict: "record"` for an unconfigured
  Supabase or a non-uuid id, though nothing was written. Logging accuracy only.
- `lib/portal/server.ts:596` hardcodes `"email_sent"` rather than reusing the file's private
  `SENT_EVENT` constant of the same value.
- The not-connected Sales error card offers a Retry button that cannot fix missing configuration.

## 4. A real limit of the new scanner filter

`classifyClick`'s `too-fast` rule measures from the lead's most recent `email_sent` row — but
that row is written when the campaign is handed to n8n (`app/api/pipeline/campaigns/send/route.ts`),
not when the message is delivered. Delivery is asynchronous, so a scanner opening the mail two
seconds after it lands may be *minutes* after `lastSentMs`, and will classify as `record`. The
10-second window therefore catches less than its tests imply, and the 60-second dedupe rule is
doing most of the real work. Closing this properly needs a delivery timestamp from the automation.

## 5. Still fabricated, by design

Sales lifecycle state. `markContacted`, `markLost`, `closeDeal` and `revertStatus` still mutate
React state only, and a reload still resets every lead to `new`. Deletion cannot fix it — it needs
the `console_audit` table and the replay reducer from the audit-trail plan, which was being built
concurrently on this same branch.

## 6. The lesson worth keeping

Renaming a route's response value broke a client **three times** in this effort — `PipelinePage`,
then `SendCampaigns`, then `StoredLeads` — because each time only the obvious caller was checked.
Two were caught by task review; the third only by a dedicated drift sweep at the end, after the
final review had already passed the work. If a route changes what it puts on the wire, enumerate
every client of that route exhaustively before calling it done.
