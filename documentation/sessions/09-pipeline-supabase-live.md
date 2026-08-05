# Session 09 — Pipeline goes live on Supabase + stored-leads viewer & folders

> **Session ID:** `5fc1ceac-1c3f-435d-bccd-18126f7538f5` *(continuation — same session as [Session 03](03-api-search-integration.md), after the demo-mode importer shipped)*
> **Date:** 2026-06-29 → 2026-06-30 local (the session ran 02:28 Jun 29 – 01:37 Jun 30 local; this work is everything after the demo-mode hand-off)
> **Status:** ✅ **LIVE** on a real Supabase instance — real reads/writes confirmed (46 → 124 rows; real folders). `DELETE` is built + build-verified but its **live execution is unverified**; **real auth is still pending** (service-role key behind a same-origin floor only).
> **Primary tools used:** Read, Edit, Write, Bash (`tsc`, `next build`, `curl` against `/api/pipeline/*`, Playwright via `_pwshot.mjs`), AskUserQuestion (earlier in session)
> **Related sessions:** [03-api-search-integration.md](03-api-search-integration.md) · [11-pipeline-save-confirm-animations.md](11-pipeline-save-confirm-animations.md) · [12-overview-role-aware-redesign.md](12-overview-role-aware-redesign.md) · [06-pipeline-send-campaigns.md](06-pipeline-send-campaigns.md)

## Objective

Take the demo-mode CSV importer from [Session 03](03-api-search-integration.md) and make it **real**: read the leads back from Supabase, let an admin browse/delete them, group each upload into a "folder", and surface everything as a first-class **Leads** tab.

## TL;DR

The importer went genuinely **live**: real Supabase credentials were relocated into a gitignored `.env.local`, a read-back API + stored-leads viewer were added, and a real import persisted **46 rows** that were then read straight back. The session then added per-upload **"folders"** (a server-stamped `batch` column, auto-named `leads-NNNN-YYYYMMDD-HHMMSS`), a `DELETE` method (by id-list or batch, never unfiltered), and a `batches` listing API — with a guided **migration card** for the one DDL step that can't go through PostgREST. A standalone **Leads** tab (gated on `leads.view`, so clients get a read-only view without the importer tools) became a folder browser with multi-select delete and a per-lead **View** detail, finished as a centered, focus-trapped modal with a proper type hierarchy. By session end the DB held real data across real folders (`leads-0001…`, `leads-0003…`).

## What happened

1. **Going live + stored-leads viewer.** (*"I should be able to see the table that was uploaded to ssupabase"*) The user had pasted real Supabase creds into `.env.local.example` — which is **not** gitignored. Moved them into `.env.local` (covered by `.gitignore`). Created [lib/pipeline/server.ts](../../lib/pipeline/server.ts) (shared `sameOrigin`, `supabaseTarget` → `demo`/`misconfigured`/`ok`), [app/api/pipeline/leads/route.ts](../../app/api/pipeline/leads/route.ts) (GET read-back), and [LeadsTable.tsx](../../components/apmg/pipeline/LeadsTable.tsx); refactored [upload/route.ts](../../app/api/pipeline/upload/route.ts) onto the shared helpers; made the StepRail nodes **selectable** so each phase shows its own content (① upload card, ② in-memory parse of the dropped file, ③ live Supabase table). **Verified live:** a real import via the UI persisted **46 rows**, confirmed by a verification `curl` returning real businesses (`"name":"Bob's Repair AC…"`, `"total":46`).
2. **DELETE + multi-select + per-upload folders.** (*"…delete something in supabase… multiselect… autorenamed when Uploaded as leads-0001-timestamp… grouped in that folder…"*) Added a `batch text` column to [supabase/schema.sql](../../supabase/schema.sql) (idempotent `add column if not exists` + index); stamped a server-applied `batch` on every uploaded row; rewrote `leads/route.ts` to add a `?batch=` filter and a **DELETE** (by `?ids=` UUID list or `?batch=`, refusing an unfiltered delete); created [app/api/pipeline/batches/route.ts](../../app/api/pipeline/batches/route.ts) (lists folders with count + latest time, grouped in JS); rewrote [LeadsTable.tsx](../../components/apmg/pipeline/LeadsTable.tsx) and created [StoredLeads.tsx](../../components/apmg/pipeline/StoredLeads.tsx) (folder grid + folder detail + a `MigrationCard`); wired auto-naming in `PipelinePage` (sequence = max existing + 1, from `/batches`). Because the column DDL can't run through PostgREST, the app **detects** the missing column and shows a guided migration card instead of failing (HTTP 422 `needsMigration`).
3. **Standalone "Leads" tab + rename.** (*"lets add a tab called Leads… in the same section as the Pipeline. and also lets change the CSV Import to 'Leads'"*) Gated the new tab on `leads.view` (admin + client, not sales — clients get a read-only Leads view without the import tools); created [LeadsPage.tsx](../../components/apmg/LeadsPage.tsx); wired the nav + shell; renamed the Pipeline heading "CSV import" → "Leads". Made the flat leads read **degrade gracefully** past a missing `batch` column so the tab works pre-migration.
4. **Leads tab as folder browser + per-lead View.** (*"…a folder in it depending on the batch… select that batch… delete or multiselect… each lead should have a column 'view'…"*) Extended `LeadsTable` with all Supabase fields + a "View" column; created [LeadDetail.tsx](../../components/apmg/pipeline/LeadDetail.tsx) (initially a right slide-over); refactored `StoredLeads` into a reusable selectable table; pointed `LeadsPage` at the folder browser.
5. **Centered modal + font fix.** (*"the view column should be a modal which will display the data at the center and should be arranged properly also fix the fonts please"*) Rewrote `LeadDetail` as a centered, focus-trapped modal (dimmed/blurred backdrop, scale-in, Escape/backdrop close) with a 2-column key-facts grid, mailto email chips, and a readable Inter-sans hierarchy (mono reserved for tiny-caps labels + the record id).

## Files created / modified (new work only)

| File | Type | Purpose |
|---|---|---|
| [lib/pipeline/server.ts](../../lib/pipeline/server.ts) | created | Shared server helpers: `sameOrigin`, `supabaseTarget`, `UNGROUPED`, `safeBatchName`, `isUuid`, `isMissingBatchColumn`. |
| [app/api/pipeline/leads/route.ts](../../app/api/pipeline/leads/route.ts) | created | GET read-back (flat or `?batch=`, degrades past a missing `batch` column) + DELETE (by `?ids=` or `?batch=`, never unfiltered). |
| [app/api/pipeline/batches/route.ts](../../app/api/pipeline/batches/route.ts) | created | Lists import folders (distinct `batch` values) w/ count + latest time; 422 `needsMigration` when the column is missing. |
| [components/apmg/pipeline/LeadsTable.tsx](../../components/apmg/pipeline/LeadsTable.tsx) | created (rewritten ×2) | Leads table; gained row `id` + multi-select, then all Supabase fields + a "View" column. |
| [components/apmg/pipeline/StoredLeads.tsx](../../components/apmg/pipeline/StoredLeads.tsx) | created (rewritten) | Folder grid + folder detail (multi-select/delete/search/View) + `MigrationCard` + flat fallback; exports `StoredLeadsPanel`. |
| [components/apmg/pipeline/LeadDetail.tsx](../../components/apmg/pipeline/LeadDetail.tsx) | created (rewritten) | Per-lead full detail; began as a slide-over, rewritten as a centered focus-trapped modal. |
| [components/apmg/LeadsPage.tsx](../../components/apmg/LeadsPage.tsx) | created (rewritten) | The "Leads" tab; began as a flat list, rewritten to render the folder browser. |
| [components/apmg/PipelinePage.tsx](../../components/apmg/PipelinePage.tsx) | modified | Selectable phase nodes; folder auto-naming; migration handling; heading "CSV import" → "Leads". |
| [components/apmg/pipeline/StepRail.tsx](../../components/apmg/pipeline/StepRail.tsx) | modified | Nodes made selectable (`selected`/`onSelect`; `div` → `button`). |
| [app/api/pipeline/upload/route.ts](../../app/api/pipeline/upload/route.ts) | modified | Onto shared helpers; stamps server-applied `batch`; 422 `needsMigration` detection. |
| [supabase/schema.sql](../../supabase/schema.sql) | modified | Added `batch text` column (idempotent) + `leads_batch_idx`. |
| [components/apmg/DashboardShell.tsx](../../components/apmg/DashboardShell.tsx) | modified | Routes `activeTab === "leads"` to `LeadsPage`. |
| [lib/nav.ts](../../lib/nav.ts) | modified | Added the `leads` tab (Monitor section, `perm: leads.view`). |
| [.env.local](../../.env.local) | created | Real Supabase creds (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). Gitignored — confirmed not tracked. |

> A scratch `_pwshot.mjs` Playwright script was repeatedly created and deleted; it is not a persisted artifact.

## Key decisions & rationale

- **Relocate creds out of `.env.local.example`.** The example file isn't gitignored; the real `.env.local` is. Prevented committing the service-role key.
- **Two different tables in the flow.** Phase ② is the in-memory parse of the dropped file; phase ③ is data fetched back from Supabase. They coincide right after an import but diverge later.
- **Folders are a `batch` column, not separate tables.** Auto-named `leads-<4-digit seq>-<YYYYMMDD-HHMMSS>`; the `__ungrouped__` sentinel buckets pre-folder (null-batch) rows.
- **Detect, don't fail, on missing DDL.** PostgREST can't ALTER a table, so the app detects the missing `batch` column and shows a guided `MigrationCard` with copy-paste SQL (HTTP 422), while flat reads degrade past the absent column so the Leads tab still works pre-migration.
- **DELETE is always filtered.** The route refuses an unfiltered delete (it would wipe the table); it requires validated `?ids=` UUIDs or a validated `?batch=` name.
- **Gate Leads on `leads.view`, not `pipeline.view`.** `leads.view` is admin + client, so clients get a read-only Leads view without the importer tools.
- **Centered modal over slide-over** for lead detail, with Inter sans for values — a direct response to "fix the fonts".

## Problems encountered & resolutions

- **Service-role key in a committed file** → relocated to gitignored `.env.local` (verified via `git check-ignore`).
- **`batch` column missing on the live DB** → can't ALTER via REST, so added missing-column detection + the `MigrationCard` + graceful degrade; confirmed: `batches` returned `needsMigration:true` before the user ran the DDL, real folders after.
- **Concurrent live edits to `nav.ts`** (the user was adding a Sales tab in the same file) → three edits failed "modified since read"; re-read, reconciled, re-applied; build confirmed the merged result.
- **Stale dev server** after many concurrent edits broke Playwright twice → `taskkill` + a fresh `npm run dev`, then the served HTML showed the full nav.

## Verification done

- **`npx tsc --noEmit`** → exit 0 at every milestone.
- **`npm run build`** green each time; the route table grew to include `/api/pipeline/leads`, `/batches`, and (in later builds) the user's concurrently-built `/api/sales/summary` and `/t/[id]`.
- **Live Supabase round-trips (real):** `GET /api/pipeline/leads` → `mode:"live"`, `total:0` (empty), then `total:46` after a real import, then `total:124` (degrade path). `GET /api/pipeline/batches` → 422 `needsMigration` pre-DDL, then real folders `leads-0001-20260629-081437` (78) + `__ungrouped__` (46) after the user ran the migration out-of-session.
- **Playwright screenshots (live data):** the 3 selectable phases; the migration card; the Leads tab (124 leads) + renamed heading; folders + folder-detail (multi-select "Delete 2 selected", Delete folder, View column); the detail slide-over (a lead with 26 emails); the final centered modal (`Karyn's Croydon Family Day Care`, folder `leads-0003-…`).
- **`DELETE` live execution unverified** — the code is built, typechecks, and the delete UI was screenshotted, but no end-to-end delete + row-count-after check was captured.

## Outcome & final state

The Pipeline is **live**: real Supabase creds in a gitignored `.env.local`, confirmed reads/writes (46 → 124 rows, real folders), a stored-leads viewer with per-upload folders, batches/leads GET + DELETE APIs, multi-select delete, a per-lead centered detail modal, and a standalone `leads.view`-gated **Leads** tab. The Pipeline heading reads "Leads". (Row counts grew because the **user** ran further imports + the migration out-of-session — the assistant observed the resulting counts.)

## Follow-ups / open items

- **Real auth is the #1 pre-production task.** Both the write (`upload`) and read/delete (`leads`, `batches`) routes use the RLS-bypassing **service-role key** behind only a same-origin (CSRF) floor; `upload/route.ts` still carries the `SECURITY — TODO`. The instance must not be public as-is.
- **RLS** on `public.leads` remains optional/commented in the schema.
- **Verify `DELETE` end-to-end** against live Supabase (built + compiles, but not exercised in-session).
- Live dev server was left running at `http://localhost:3000` at session end.

## Verbatim user requests

> I should be able to see the table that was uploaded to ssupabase

> Now lets add another HTTP Method in there that we can delete something in supabase just so right? there should be a table where I can multiselect them but since this is a CSV Upload this should be autorenamed when Uploaded as leads-0001-timestamp. Wherein they are grouped in that folder and I can go inside the folder and manually manipulate data inside it

> lets add a tab called Leads and that all the leads are listed in here this should be in the same section as the Pipeline. and also lets change the CSV Import to "Leads"

> The leadss tab should have a folder in it depending on the batch that they were in so we can select that batch and we can go in and we will have the delete or multiselect in there and each lead should have a column "view" where we can see the full details for that lead based on supabase data

> the view column should be a modal which will display the data at the center and should be arranged properly also fix the fonts please
