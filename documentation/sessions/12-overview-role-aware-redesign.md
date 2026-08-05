# Session 12 — Role-aware Overview redesign (admin/client/sales · live data) + UI/UX Pro Max skill

> **Session ID:** `d36a821e-8c0d-4e04-acd8-f6afe327de90`
> **Date:** 2026-06-30, 01:49–02:50 local
> **Status:** ✅ Shipped and verified (`tsc` exit 0; Playwright screenshots of all 3 roles). The UI/UX Pro Max skill is installed globally but **only activates after a Claude Code restart**.
> **Primary tools used:** WebFetch, WebSearch, Bash (`npm`, `uipro`, `tsc`, Playwright), Read, Edit, Write, AskUserQuestion
> **Related sessions:** [01-ui-foundation-dashboard.md](01-ui-foundation-dashboard.md) · [07-rbac-permission-first.md](07-rbac-permission-first.md) · [09-pipeline-supabase-live.md](09-pipeline-supabase-live.md) · [08-sales-pipeline-attribution.md](08-sales-pipeline-attribution.md)

## Objective

> "Redesign the OVERVIEW section for me for all 3 dashboards admin client and sales these KPI Cards should have the exact data as the data that I upload via the pipeline"

Make the Overview **role-aware** for all three roles and have its KPI cards read the **live pipeline data** (the real Supabase `public.leads` rows), not hardcoded preset numbers. Preceded by installing and invoking the **UI/UX Pro Max** skill.

## TL;DR

Installed the UI/UX Pro Max skill globally (`uipro init --ai claude --global`, v2.10.0) and used it mid-session by loading its `SKILL.md` + running its Python engine directly. Then rebuilt the Overview as a single role-aware surface driven by one new hook, [useLeadStats.ts](../../lib/data/useLeadStats.ts), which fetches the live `public.leads` data the Pipeline writes (via `/api/pipeline/leads` + `/batches`) and derives totals, ratios, recent rows, and by-day/week/month buckets. Admin, client, and sales each get their own copy + KPI set; the histogram cycles Week/Day/Month (with a sparse-data fix); the Pipeline tab gained a realtime stats strip; and the Sidebar's hardcoded Pipeline badge was replaced with the live count. `sales` was granted `overview.view` so it has an Overview at all. `tsc` clean throughout; all three roles screenshot-verified against real data.

## What happened

1. **Installed the UI/UX Pro Max skill.** (*"install the UIUX Promax skill please – [URL]"*) The marketing page (a JS app) had no extractable install steps, so `WebSearch` found the GitHub repo and its README gave the authoritative route. `npm install -g ui-ux-pro-max-cli` hit `EEXIST` (a stale untracked `uipro` v2.2.3 binary); resolved with `@latest --force` → **v2.10.0**, then `uipro init --ai claude --global` installed it to `~/.claude/skills/ui-ux-pro-max/`. (User chose **Global** via AskUserQuestion.)
2. **Explained + invoked it.** (*"how do I invoke this skill?"* / *"invoke it"*) Skills are only scanned at Claude Code startup, so the freshly-installed one wasn't active; the assistant loaded `SKILL.md` directly and ran its Python search engine (`search.py "lead generation SaaS dashboard dark mode professional black red" --design-system`) to demonstrate it live.
3. **Redesigned the Overview.** After reading ~20 files, two findings shaped the work: the app is in **LIVE mode** (`.env.local` has Supabase creds), and the **`sales` role lacked `overview.view`**. Built the [useLeadStats](../../lib/data/useLeadStats.ts) hook, extended [format.ts](../../lib/format.ts) (`usd0`, `rating`) and the `Kpi` interface in [leads.ts](../../lib/data/leads.ts), rewrote [KpiCard.tsx](../../components/apmg/KpiCard.tsx), [LeadsHistogram.tsx](../../components/apmg/LeadsHistogram.tsx), [RecentLeadsTable.tsx](../../components/apmg/RecentLeadsTable.tsx) and [OverviewPage.tsx](../../components/apmg/OverviewPage.tsx), and granted `sales` the `overview.view` permission in [roles.ts](../../lib/rbac/roles.ts).
4. **Histogram refinements.** All 46 leads landed on one day, so a single bar stretched the panel — fixed by capping the chart width when there are `<6` buckets. Then converted the histogram to **Week / Day / Month** modes (default Week, auto-cycle every 20s, pausing on hover/focus).
5. **Month label.** (*"the month should be shown as JUNE 2026 not JUNE 26 lol its confusing"*) Changed the month formatter to `{ month: "long", year: "numeric" }` → "JUNE 2026" (day/week stay "JUN 29").
6. **Realtime Pipeline numbers.** (*"the Pipeline tab should have realtime numbers in it"*) Refactored `useLeadStats` to accept `{ pollMs }` (silent background polling — no skeleton flash, keeps last good numbers on a failed poll, refetch on window focus) and added a `PipelineStats` strip to [PipelinePage.tsx](../../components/apmg/PipelinePage.tsx) (LIVE · public.leads; In database / Folders / With email / New·24h), polling every 15s.
7. **Live Sidebar badge.** (*"that number should be zero since there is no data yet"*) The Sidebar's Pipeline badge was hardcoded "312". Removed `badge: "312"` from [nav.ts](../../lib/nav.ts) and wired [Sidebar.tsx](../../components/apmg/Sidebar.tsx) to render the live `public.leads` total via `useLeadStats({ pollMs: 15000 })`.

> The user's WIP [lib/pipeline/campaign.ts](../../lib/pipeline/campaign.ts) (the Send-Campaigns feature, [Session 06](06-pipeline-send-campaigns.md)) was open in the IDE and deliberately left untouched.

## How the role-aware Overview works now

- **Single source of truth.** `OverviewPage` reads `useRbac().role` and renders the *same* component tree for all three roles, swapping copy and KPI sets by role. All numeric data comes from one hook, `useLeadStats()`.
- **`useLeadStats` data flow.** On mount it `Promise.all`-fetches `GET /api/pipeline/leads` (`cache: "no-store"`) and `GET /api/pipeline/batches` — the same Supabase routes the Pipeline writes to. `total` is the exact DB count (from PostgREST content-range, authoritative beyond the 2000-row fetch cap); ratios (`withEmail`, `withPhone`, `withWebsite`, `avgRating`, `addedToday`) are computed over the fetched sample rows; `folders` comes from `/batches`; recent rows = `rows.slice(0,6)`. It buckets rows three ways (`byDay` ≤14, `byWeek` Monday-anchored ≤12, `byMonth` ≤12). Optional `{ pollMs }` enables silent realtime polling + refetch on window focus.
- **Per-role differences.** **Admin** ("Lead operations"): 4 KPIs — Total leads (caption: folders + new·24h; foot: byDay sparkline), With email, With phone, Avg rating. **Client** ("Delivered leads", portal framing): 3 KPIs — Delivered leads, With email, Avg rating. **Sales** ("Your overview", funnel framing): 4 KPIs — Pipeline leads (live DB total), Open in queue, Engaged, Closed·30d ($). The sales funnel numbers come from `useSales()` (the preset `SALES_LEADS`), **not** the pipeline — only "Pipeline leads" is live. Mixed source is intentional.
- **Histogram.** Generic over the `modes` it's given (Week/Day/Month, Week first). Empty modes are hidden; auto-cycle advances every 20s, pausing on hover/focus; the chart caps width when `<6` buckets so one day doesn't stretch a bar across the panel.
- **States.** Loading shows skeleton cards; an error state offers Retry; empty data renders clean zero/"—" states.

## Files created / modified

| File | Type | Purpose |
|---|---|---|
| [lib/data/useLeadStats.ts](../../lib/data/useLeadStats.ts) | created | Client hook fetching live `public.leads` via `/api/pipeline/leads` + `/batches`; derives totals, ratios, recent rows, by-day/week/month buckets; optional `pollMs` realtime polling. |
| [components/apmg/OverviewPage.tsx](../../components/apmg/OverviewPage.tsx) | rewritten | Role-aware Overview: per-role copy + KPI builders; wires `useLeadStats` + `useSales`; loading/error/empty states; supplies the histogram modes. |
| [components/apmg/KpiCard.tsx](../../components/apmg/KpiCard.tsx) | rewritten | KPI gauge with loading skeleton, optional delta, foot = sparkline or labelled ratio bar; count-up readout. |
| [components/apmg/LeadsHistogram.tsx](../../components/apmg/LeadsHistogram.tsx) | rewritten | Generic prop-driven histogram (modes), auto-cycle, sparse-data width cap, empty state. |
| [components/apmg/RecentLeadsTable.tsx](../../components/apmg/RecentLeadsTable.tsx) | rewritten | Renders real pipeline rows (Business / Rating / Emails / Phone); empty state. |
| [lib/format.ts](../../lib/format.ts) | modified | Added `usd0` and `rating` KPI formats. |
| [lib/data/leads.ts](../../lib/data/leads.ts) | modified | Extended the `Kpi` interface (`spark`, `ratio`, `loading`, `noCountUp`, `goodWhenDown`, …). Old presets remain as now-unused definitions. |
| [lib/rbac/roles.ts](../../lib/rbac/roles.ts) | modified | Granted `overview.view` to `sales` (so sales has an Overview). |
| [lib/nav.ts](../../lib/nav.ts) | modified | Removed the hardcoded `badge: "312"` from the Pipeline nav item. |
| [components/apmg/PipelinePage.tsx](../../components/apmg/PipelinePage.tsx) | modified | Added a realtime `PipelineStats` strip; `useLeadStats({pollMs:15000})`; refresh on import/delete via `refreshSignal`. |
| [components/apmg/Sidebar.tsx](../../components/apmg/Sidebar.tsx) | modified | Pipeline badge now renders the live `public.leads` total. |
| `~/.claude/skills/ui-ux-pro-max/**` | created (global, outside repo) | The installed skill (SKILL.md, scripts, CSV data). |

## Key decisions & rationale

- **A new hook, not mutated presets.** `useLeadStats` reads the same source the Pipeline writes, so "exact pipeline data" is guaranteed; the old `KPIS`/`LEADS_BY_*`/`RECENT_LEADS` presets were left as harmless dead definitions.
- **`total` from the DB count, ratios from the sample.** Exact total even past the 2000-row API cap; ratios over fetched rows (equal until that mark).
- **Grant `sales` `overview.view`.** Required for "all 3 dashboards" to have an Overview; RBAC is permission-first, so it's pure data (see [Session 07](07-rbac-permission-first.md)).
- **Sales funnel stays preset; only "Pipeline leads" is live.** Sales-stage data (open/engaged/won) isn't in `public.leads` — an intentional mixed source.
- **Default to Week + auto-cycle.** Sparse single-day data reads poorly; cycling surfaces all three granularities.
- **Single source for the Pipeline badge.** Removing the hardcoded "312" means the live count can't drift.
- **Install globally, force-reinstall, use mid-session via SKILL.md.** Global keeps the skill out of any repo; `--force` cleared the stale binary; loading `SKILL.md` + the Python engine let it be used before the restart that registers the slash command.

## Problems encountered & resolutions

| Problem | Resolution |
|---|---|
| Marketing page (JS app) gave no install info | WebSearch → GitHub README for authoritative steps. |
| `npm install -g` `EEXIST` (stale untracked `uipro` 2.2.3) | `--force` reinstall → v2.10.0, npm-tracked. |
| Slash command not registered (mid-session install) | Loaded `SKILL.md` + ran the Python engine directly. |
| Histogram rendered as one solid red block (all 46 leads on one day) | Width-cap the chart when `<6` buckets. |
| "JUN 26" read like a day | Month formatter → "JUNE 2026". |
| Month-mode screenshot timed out | Root cause: the `leads` table had been emptied to **0 rows** out-of-band (not by this code); verified the formatter via `node -e` and confirmed the empty state renders. |
| Scratchpad couldn't resolve the project's `playwright` | Set `NODE_PATH` to the project's `node_modules`. |
| Sidebar badge showed a stale "312" | Removed from nav; wired the live count. |

## Verification done

- **`npx tsc --noEmit`** → exit 0 after every change.
- **Dev server** live on :3000; **Playwright screenshots** of all 3 roles ("errors: none"). With the table at 46 rows: Total 46, With email 12 (26%), With phone 45 (98%), Avg rating 3.3; the recent table showed real scraped businesses. Sales view: Pipeline 46 → Open 5 → Engaged 5 → Closed $45,500.
- **Auto-cycle** confirmed (admin advanced Week→Day after 21s); **month label** verified via `node -e` (`JUNE 2026`); **API probes** of `/leads` and `/batches` confirmed `mode:"live"` and clean zero handling after the table was emptied.
- **No `next build`** was run — verification was `tsc` + dev-server Playwright only.

## Outcome & final state

A role-aware Overview live for admin/client/sales reading real `public.leads` data, a Week/Day/Month histogram (auto-cycle + sparse-data fix), a fixed month label, a realtime Pipeline stats strip, and a live Sidebar Pipeline badge. `tsc` clean throughout.

## Follow-ups / open items

- **The skill only activates after a Claude Code restart** (auto-trigger and `/ui-ux-pro-max` wire up at startup).
- **The `leads` table is currently empty (0 rows)** — emptied out-of-band during the session; the populated screenshots reflect an earlier 46-row state. The dashboard handles 0 correctly.
- **Remaining hardcoded sidebar badges** (Sources "6", Campaigns "4", Sales "24") are still placeholders — wiring them (or hiding the no-backend ones) was offered but not implemented.
- **Sales funnel data is still preset-backed**; only "Pipeline leads" is live.
- **Old presets** in [lib/data/leads.ts](../../lib/data/leads.ts) (`KPIS`, `LEADS_BY_*`, `RECENT_LEADS`) are dead-but-harmless — a cleanup candidate.

## Verbatim user requests

> install the UIUX Promax skill please - https://ui-ux-pro-max-skill.nextlevelbuilder.io/#how-it-works

> how do I invoke this skill?

> invoke it

> Redesign the OVERVIEW section for me for all 3 dashboards admin client and sales these KPI Cards should have the exact data as the data that I upload via the pipeline

> the month should be shown as JUNE 2026 not JUNE 26 lol its confusing

> the Pipeline tab should have realtime numbers in it

> that number should be zero since there is no data yet
