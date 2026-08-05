# Session 03 — Pipeline CSV Importer (Bing Scraper → Supabase) with n8n-style stepped flow

> **Session ID:** `5fc1ceac-1c3f-435d-bccd-18126f7538f5`
> **Date:** 2026-06-29, 02:28–03:04 local (~36 min)
> **Status:** Shipped. Feature compiles clean (typecheck + production build green) and the CSV parser is empirically verified against the real reference export. Live Supabase write is unverified end-to-end (runs in **demo mode** until credentials are added). Auth gate is an explicit pre-production TODO.
> **Primary tools used:** Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion, Workflow (background adversarial review)
> **Related sessions:** [01-ui-foundation-dashboard.md](./01-ui-foundation-dashboard.md) · [02-integrations-tab-n8n.md](./02-integrations-tab-n8n.md) · [04-dev-server-enoent-fix.md](./04-dev-server-enoent-fix.md) · [05-session-documentation.md](./05-session-documentation.md) · [09-pipeline-supabase-live.md](./09-pipeline-supabase-live.md)

> ⏩ **This session continued well past this doc.** This write-up covers the importer in **demo mode** only. The same session (`5fc1ceac`, which ran into 2026-06-30) then went **live** on a real Supabase instance and added the stored-leads viewer, per-upload folders, and a standalone Leads tab — documented separately in **[Session 09 — Pipeline goes live on Supabase](./09-pipeline-supabase-live.md)**.

## Objective

The user started by asking whether a specific Bing Maps URL could be used as an HTTP data source — feed a search query (e.g. "child care services center") into a UI text field + button and render the business listings it returns. The investigation reframed the real goal: the user already runs an external **Bing Maps Scraper** that exports a CSV of leads, and what they actually wanted was an in-app **Pipeline** tool to upload that CSV and push it into Supabase — built with an **n8n-style stepped flow** (upload → an animated "reading the CSV" phase → an animated "uploading to Supabase" phase), plus the Supabase `CREATE TABLE` SQL for their chosen columns.

## TL;DR

The Bing Maps URL was proven (not assumed) to be a render-only HTML app shell with zero business data, so it can't serve as an API. After scoping with the user, the work pivoted to a **CSV-import Pipeline** under the existing `pipeline` sidebar tab: a server route ([app/api/pipeline/upload/route.ts](../../app/api/pipeline/upload/route.ts)) that inserts via Supabase PostgREST, a pure CSV parser/mapper ([lib/pipeline/csv.ts](../../lib/pipeline/csv.ts)), a Supabase schema for the 12 chosen columns ([supabase/schema.sql](../../supabase/schema.sql)), and an n8n-style 3-node animated flow UI ([components/apmg/PipelinePage.tsx](../../components/apmg/PipelinePage.tsx) + [components/apmg/pipeline/StepRail.tsx](../../components/apmg/pipeline/StepRail.tsx)). The parser was verified against the real 46-row scraper CSV; typecheck and production build are green. A background adversarial review surfaced 13 findings and the genuine security/correctness/a11y ones were fixed before the session ended.

## What happened

1. **Grounding the question.** Read `package.json` and globbed the repo to anchor the answer in the real stack (Next.js 16 / React 19, `motion`, Tailwind, `lucide-react`). Initial answer laid out the real options (Google Places Text Search, Azure Maps POI, scraper APIs like Outscraper/SerpApi/Apify) and the correct architecture: the browser never holds API keys — text field → `app/api/search` route (server) → provider → JSON → render.

2. **The user pushed back: "how about the website I just gave you?"** Rather than re-asserting, the URL was tested empirically with `curl`:
   - It returns **HTTP 200, `text/html`, ~79 KB** — a Bing Maps app shell.
   - Grepping the body showed the only "restaurant" matches were the echoed query in a link, ad-config flags (`enableRestaurantTextAds`), and the raw request URL — **zero real listings**. The "Name" fields were JS telemetry config (`CI.Warning`), not data.
   - The decoded params (`cp=12.066716~124.596863`, `lvl=11`, `style=r`) were just a map view of Northern Samar, Philippines — no query to "send".
   - Located the page's internal data endpoint (`overlaybfpr?q=...` under `REST/v1/...`), noted it's undocumented, token-gated, and against ToS.

3. **Decoded the user's actual workflow from a reference CSV.** A `Bing_Maps_Scraper_46` export was read in full (47 lines). It revealed two column groups from two sources: **Group 1** (Name, Address, image, Bing Maps URL, lat/lng, Rating, Category, Open Hours, Website, Phone) comes from the maps search; **Group 2** (Emails, Social Medias, Facebook, Instagram, Twitter) is *website-enrichment* the scraper crawls per-site afterward — which is why rows 14–47 still showed `### In progress ###` in those columns at export time. Critically, **every row already had a populated `Website`**, so the core data was intact.

4. **Scoping with the user (AskUserQuestion).** The user clarified: they don't want the scraper rebuilt — they keep using it, and just need its CSV into Supabase. They also chose **"Plan first, then I confirm."** A plan was written (a `leads` table, in-import cleaning of `### In progress ###` → NULL and comma-cells → arrays, an upload page).

5. **The user asked "is there no way we can do this from the UI?"** Explained that a browser-extension scraper can't be driven over HTTP, so the CSV bridge is the right pattern unless they swap the engine for a scraper API — but for now, the in-UI **CSV upload** flow delivers it.

6. **Final spec from the user.** Build the **Upload CSV tool under Pipeline**, keeping only 12 columns (Name, Address, Featured Image, Bing Maps URL, Rating, Website, Phone, Emails, Social Medias, Facebook, Instagram, Twitter/X), provide the Supabase SQL, and design it n8n-style: upload → animated CSV-reading phase → animated Supabase-upload phase. "stop there pull that off and Ill continue the next."

7. **Studied the existing design language before writing a line.** Read `tailwind.config.ts`, the borrowed `ui-standards.md` (the "SIGNAL/RAIL" telemetry-console grammar), `globals.css` tokens, `lib/nav.ts`, `DashboardShell.tsx`, `Sidebar.tsx`, `ComingSoon.tsx`, `IntegrationsPage.tsx` (the prior n8n tab), `Reveal.tsx`, `RecentLeadsTable.tsx`, `OverviewPage.tsx`, `SignalLed.tsx`, `Footer.tsx`, the `Button` API, and `tsconfig.json` (the `@/*` alias). Key finding: **`pipeline` already existed as a `TabId`** under the "Monitor" nav section but rendered `<ComingSoon>` — so "under Pipeline" meant wiring that existing tab to a real page.

8. **Built the feature.** Wrote, in order: `supabase/schema.sql`, `.env.local.example`, `lib/pipeline/csv.ts`, `app/api/pipeline/upload/route.ts`, `components/apmg/pipeline/StepRail.tsx` (the connected-node flow canvas), and `components/apmg/PipelinePage.tsx` (the centerpiece with drop-to-upload, animated "reading" phase with row counter / progress / scanline, and animated batched "push to Supabase" phase with a live `written/total` counter and a success+preview table). Then edited `DashboardShell.tsx` to import `PipelinePage` and route `activeTab === "pipeline"` to it.

9. **Verified before claiming done.** `tsc --noEmit` → exit 0. `next build` → compiled successfully, `/api/pipeline/upload` registered. Then the strongest check: compiled the parser and **ran it against the real reference CSV** — 46/46 rows kept, embedded commas in business names handled, multi-email/social cells split into arrays, `### In progress ###` → empty arrays / null, `+` in image URLs preserved, empty ratings → null.

10. **Adversarial review (background Workflow).** Launched a 5-dimension review (security, SQL, design fidelity, a11y, state-machine correctness), cleaned temp test artifacts while it ran, and delivered the SQL + feature summary to the user in the meantime. Review returned **13 findings (2 high, 3 medium, 2 low, 6 nit)**. After triage, the real ones were fixed (see below) and two were consciously skipped with documented reasoning. The session ended re-running typecheck/build to confirm the fixes still compile (transcript cut off mid-command; verified post-hoc as clean).

## Files created / modified

| File | Type | Purpose |
|---|---|---|
| [supabase/schema.sql](../../supabase/schema.sql) | created | `leads` table for the 12 chosen columns: `uuid` PK + `created_at`, `emails`/`social_medias` as `text[]`, name/website indexes, and a commented optional RLS block. Run in Supabase SQL Editor. |
| [.env.local.example](../../.env.local.example) | created | Documents `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (server-side only; never `NEXT_PUBLIC_`). Notes that unset creds = demo mode. |
| [lib/pipeline/csv.ts](../../lib/pipeline/csv.ts) | created | Pure, framework-free RFC-4180-ish CSV tokenizer + header-name-based mapper to the 12 `LeadImportRow` columns. Handles quoted fields, embedded commas/newlines, BOM, `### In progress ###` → null, comma-cells → de-duped arrays. |
| [app/api/pipeline/upload/route.ts](../../app/api/pipeline/upload/route.ts) | created | Node-runtime POST handler that sanitizes/whitelists rows and inserts via Supabase PostgREST with the service-role key. Demo mode when creds absent. |
| [components/apmg/pipeline/StepRail.tsx](../../components/apmg/pipeline/StepRail.tsx) | created | n8n-style connected-node flow canvas; connectors fill as data flows downstream. |
| [components/apmg/PipelinePage.tsx](../../components/apmg/PipelinePage.tsx) | created | The Pipeline page: drag-and-drop upload → animated "Read & parse" phase (counter + scanline) → animated "Push to Supabase" phase + success/preview table. |
| [components/apmg/DashboardShell.tsx](../../components/apmg/DashboardShell.tsx) | modified | Imports `PipelinePage`; routes the `pipeline` tab to it instead of `ComingSoon`. |

## Key decisions & rationale

- **Proved the URL empirically instead of asserting.** When the user pushed back, `curl` + grep showed the response is a render-only HTML shell with zero listings — concrete evidence, not a generic "scraping is bad" claim.
- **Don't rebuild the scraper; bridge via CSV.** A browser-extension scraper has no HTTP API to "drive" from the app, so the CSV → Supabase bridge is the correct pattern given the user's existing tooling. (A scraper-API engine was offered as the alternative path but not chosen for this session.)
- **Reuse the existing `pipeline` tab.** It was already a `TabId` rendering `ComingSoon`, so the feature wires into established nav/shell rather than bolting on new routing.
- **12 columns, exactly as the user specified.** Dropped the scraper's `ID/ypid`, lat/long, Rating Info, Category, Open Hours. Added a `uuid` PK + `created_at` for a clean key and audit timestamp.
- **`text[]` for emails/social_medias.** The scraper joins multiples in one comma-separated cell; splitting into Postgres arrays makes them queryable rather than a blob.
- **Service-role key stays server-side; demo mode when unconfigured.** The route holds the key (never shipped to browser); without creds it simulates the write so the entire animated UI is exercisable before Supabase is wired.
- **Study the design grammar first.** Read ui-standards "SIGNAL/RAIL" conventions, tokens, and sibling components so the Pipeline tool matches the house style (Reveal mounts, mono/`tnum` numerals, signal-red accent, cards as `rounded-xl bg-card ring-1 ring-foreground/10`, house ease curves).
- **Verify with the real artifact.** Ran the parser against the actual 46-row scraper CSV rather than trusting the typecheck alone — the messy-quoting/array-splitting/`### In progress ###` behavior is exactly what production data looks like.

## Problems encountered & resolutions

- **User's premise (URL = API) was wrong.** Resolved by testing it and showing the proof (HTML shell, telemetry/ad-config only), then redirecting to the CSV pipeline.
- **`### In progress ###` placeholder rows.** The scraper exports mid-enrichment, leaving that literal in email/social cells. Parser maps it to null/empty arrays; verified websites are still fully present, so core leads are intact.
- **Adversarial review found 2 HIGH issues — both fixed:**
  - **Unauthenticated public write proxy** using a service-role key that bypasses RLS. The app has no auth system yet, so a **same-origin (CSRF) floor** was added (`sameOrigin()` rejects cross-origin browser writes with 403) and proper auth was flagged as the #1 pre-production task, with a `SECURITY — TODO` comment in the route. **Caveat: this is a floor, not real authentication — the endpoint must not be exposed publicly as-is.**
  - **No per-row runtime validation** (`rows as LeadImportRow[]` is compile-time only). Added `sanitizeRow()`: requires a non-empty `name`, coerces/whitelists the 12 known columns into a fresh object literal, validates `rating` as finite-or-null and `emails`/`social_medias` as string arrays, and **strips `id`/`created_at` so DB defaults always win** (caller can't forge them).
- **MEDIUM/LOW fixes applied:** stopped leaking raw PostgREST error bodies to the client (log server-side, return a generic message); added rAF + async unmount guards so switching tabs mid-import doesn't `setState` after unmount; added `aria-live` status region + `role="alert"` on the error panel + missing `aria-hidden` on the X icon; `SUPABASE_URL` validity check; demo-mode downgrade messaging; clarifying comments.
- **Two findings consciously skipped (with reasons):** the `linear` ease on infinite-loop animations is the idiomatic correct choice (a house cubic would stutter at the loop seam) — kept with a clarifying comment; the DonePanel chip `tracking-[0.08em]` actually **matches** the existing status-pill tracking in `RecentLeadsTable`/`IntegrationsPage`, so it was kept for consistency.
- **Transcript cut off mid-build.** The session's final `tsc`/`next build` after the fixes was the last action recorded. Verified post-session: `tsc --noEmit` exits 0 and both Pipeline components are present on disk.

## Outcome & final state

- **Shipped and compiling.** The `pipeline` sidebar tab now renders a real n8n-style 3-node flow (`Upload CSV → Read & parse → Push to Supabase`). Typecheck and production build are green; `/api/pipeline/upload` is a registered route.
- **Parser is production-verified** against the real Bing scraper CSV (46/46 rows, all edge cases handled).
- **Security hardened** within the constraints of an app that has no auth yet: row sanitization, `id`/`created_at` stripping, same-origin floor, no error-body leakage, input size cap (`MAX_BATCH = 1000`).
- **Runs in demo mode by default.** It parses + animates the full flow but simulates the write until `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set in `.env.local` and `next dev` is restarted.
- **Unverified:** the live PostgREST insert path has not been exercised end-to-end (no creds in-session), and the SQL has not been confirmed run against an actual Supabase project. The user said they'll "continue the next" from here.

## Follow-ups / open items

- **Add real authentication before exposing the importer.** The same-origin check is a CSRF floor only; the service-role write path needs a session/role gate (the route's `SECURITY — TODO` and schema notes call this out).
- **Run [supabase/schema.sql](../../supabase/schema.sql)** in the Supabase SQL Editor, then populate `.env.local` from [.env.local.example](../../.env.local.example) and restart dev to switch from demo → live.
- **Verify the live write end-to-end** once creds exist (confirm rows land, arrays populate, defaults apply).
- **(User-owned next step)** the table/query view over `leads`, and optionally swapping the CSV bridge for a scraper-API engine (Outscraper/Apify) to search directly from the UI — both discussed but explicitly deferred.
- **Optional:** enable RLS + a read policy (commented in the schema) once a browser-side table view reads via the anon key.

## Verbatim user requests

> is there some HTTP Requesst we can enter in this website so for example in our UI we can put this on to a button and a text field when Entered a search query will be sent and we will get the data that it returns? - https://www.bing.com/maps?...

> how about the website I just gave you?

> The thing is I want this bing scraper's search bar to search for businesses for example child care services center its mapss scrapper will produce that list it will load the data 1 by 1. So all I need is their website. and then We will put the CSV File into SUpabase thats all  *(— AskUserQuestion response; also chose "Plan first, then I confirm")*

> I know the mechanism you wanted but is there no way we can do this from the UI?

> Alright lets prepare the Upload CSV Tool then but I only want the Name, Address, Featured Image, Bing Maps URL, Rating, Website, Phone, Emails, Social Medias, Facebook, Instagram, Twitter/X. give me an SQL Query for SUPABASE where we can upload this on to the UI. This should be under Pipeline. I need a very good design for this similar to n8n where we have steps on this where we first upload the CSV then it will have an animation that its reading the csv file and also after its reading the next phase will come where it will be uploaded to supabase and another animation does that. and lets ssstop there pull that off and Ill continue the next
