# Session 01 — UI Foundation: Black/Red "Signal" Lead-Gen Dashboard

> **Session ID:** c954dda6-aca5-469e-a4f7-970fb907d272
> **Date:** 2026-06-29, 01:19–02:58 local (~1h39m)
> **Status:** Completed — scaffolded from empty repo, built, reviewed, fixed, and visually verified on Next.js 16
> **Primary tools used:** Write/Edit (source files), Bash (npm, builds, Playwright servers), Workflow (design panel + adversarial review subagents), Read (transcripts + screenshots), Playwright (verification screenshots), AskUserQuestion, TodoWrite
> **Related sessions:** [02-integrations-tab-n8n.md](02-integrations-tab-n8n.md) · [03-api-search-integration.md](03-api-search-integration.md) · [04-dev-server-enoent-fix.md](04-dev-server-enoent-fix.md) · [05-session-documentation.md](05-session-documentation.md) · [07-rbac-permission-first.md](07-rbac-permission-first.md) · [08-sales-pipeline-attribution.md](08-sales-pipeline-attribution.md)

> ⏩ **This session continued well past this doc.** This write-up covers only the UI-foundation work (Overview, sidebar, footer, telemetry, KPI/greeting). The same session (`c954dda6`, which ran until ~08:49 local) then went on to build the permission-first RBAC layer and the full Sales pipeline — documented separately in **[Session 07 — RBAC](07-rbac-permission-first.md)** and **[Session 08 — Sales pipeline](08-sales-pipeline-attribution.md)**.

## Objective
The user wanted a lead-generation dashboard for APMG Services with a black/red theme that defaults to dark mode but offers a light-mode toggle. The concrete brief: a sidebar with an **Overview** page containing 3 KPI cards across the top and a histogram side-by-side with a small table below, a footer reading "Developed by APMG @currentYear", and click telemetry wired in. A later request in the same session asked to clean up the KPI cards (they looked "separated like my parents") and add a personal greeting ("Hi, Kane Reroma").

## TL;DR
Starting from a near-empty repo (only `ui-standards.md` and `.claude/`), scaffolded a full Next.js (App Router + TS + Tailwind + `motion/react`) project from scratch, then designed and built a black/red "telemetry console" lead-gen dashboard. The design direction was chosen via a 3-way design-panel workflow (judged 9/10) and the implementation was put through a 32-agent adversarial review that surfaced 21 verified findings; the substantive ones (AA contrast, focus management, reduced-motion) were fixed. The app was upgraded to Next.js 16 (Turbopack), builds clean, and was visually verified across dark/light/mobile plus the Integrations tab. A follow-up edit fused the three KPI cards into one hairline-divided instrument panel and added the greeting header.

## What happened
1. **Context discovery.** The `frontend-design` skill launched with no concrete brief. The assistant scanned the working directory, found it essentially empty (only `.claude/settings.local.json` and `ui-standards.md`, no `package.json`, no commits beyond Initialize), and asked the user focused questions about what APMG sells and the page's job.
2. **Brief received.** The user specified the black/red lead-gen dashboard, dark default + light toggle, sidebar with Overview (3 KPI cards, histogram beside a small table), the "Developed by APMG @currentYear" footer, and click telemetry.
3. **Design panel.** A `Workflow` was launched in the background to generate and judge 3 independent black/red dashboard directions. While it ran, the assistant read [ui-standards.md](../../ui-standards.md) (the "Simple HRIS" house design grammar) and re-scanned the project, concluding it was an unscaffolded Next.js project that must follow the house conventions for tables, motion, KPI cards, and sidebars.
4. **Manual scaffold.** Rather than `create-next-app` (interactive prompts), config was written by hand: [package.json](../../package.json), [tsconfig.json](../../tsconfig.json), [next.config.mjs](../../next.config.mjs), [postcss.config.mjs](../../postcss.config.mjs), [.gitignore](../../.gitignore), [tailwind.config.ts](../../tailwind.config.ts). `npm install` was kicked off in the background while source files were written.
5. **Core libs.** Wrote [lib/cn.ts](../../lib/cn.ts), [lib/theme.ts](../../lib/theme.ts), [lib/telemetry.ts](../../lib/telemetry.ts) (framework-agnostic ring buffer + `sendBeacon` endpoint + a React hook delegating clicks over `[data-track]` elements), [lib/data/leads.ts](../../lib/data/leads.ts) (preset sample data), [lib/format.ts](../../lib/format.ts), [lib/useCountUp.ts](../../lib/useCountUp.ts) (reduced-motion-safe odometer numerals), and [app/globals.css](../../app/globals.css) with shadcn-style semantic color tokens that flip with the theme.
6. **Design verdict synthesized.** The panel returned **"SIGNAL/RAIL — APMG Telemetry Console" (9/10)**: the dashboard as a precision lead-signal instrument where red is a measurement state, not decoration. The assistant reconciled this with the house grammar — base layout/shell/sidebar/tables from `ui-standards.md`, identity ("live signal" telemetry) spent in one place. Locked calibrated reds: Signal `#FF2E1F` (live), Incandescent `#C8102E` (bar fills only, never text), Standby `#5A1A1F` (idle). Type: Inter + JetBrains Mono with mono tabular numerals as the hero. No green — direction encoded within the red family.
7. **UI primitives + feature components.** Built `components/ui/` (button, card, badge, table, scroll-area) following the ui-standards class hooks, then the APMG feature components under `components/apmg/`: SignalLed, ThemeToggle, SignalTicker, ClickPing, Sidebar (all 5 required slots), MobileHeader, Footer, TelemetryInspector, Reveal, KpiCard, LeadsHistogram, RecentLeadsTable, CommandBar, OverviewPage, ComingSoon, DashboardShell. Wired [app/layout.tsx](../../app/layout.tsx), [app/page.tsx](../../app/page.tsx), and [lib/nav.ts](../../lib/nav.ts).
8. **First build + visual verification.** `next build` initially failed on an unused `@ts-expect-error` directive in `lib/theme.ts` (the DOM lib now types `startViewTransition`); fixed to be version-robust. Build went green. Started the production server on port 3210, installed Playwright, and captured screenshots of dark/light/mobile and the telemetry inspector. The inspector confirmed click instrumentation end-to-end (events with props like `lead=L-4821`, `status=qualified`, `mode=source`, `bucket=Apr`). Fixed one layout issue — the histogram panel was shorter than the table, leaving dead space — by making the two panels equal height and pinning the footer.
9. **Adversarial review (background).** Launched a second `Workflow` (32 agents) to review the source across requirements/a11y/contrast/telemetry-correctness/ui-standards/code-quality, each finding independently verified. It returned **21 confirmed findings (6 major, 8 minor, 7 nit)**.
10. **Next.js 16 upgrade.** Bumped `next` to 16.2.9 (accepts React 19), reinstalled, and rebuilt on Turbopack. A Next 16 prerender step for `/_global-error` required adding [app/global-error.tsx](../../app/global-error.tsx) and a themed [app/not-found.tsx](../../app/not-found.tsx); after that the build was clean.
11. **Parallel co-editing noticed.** The user was building an **Integrations** tab live: `nav.ts` gained an `integrations` tab and `DashboardShell` imported a not-yet-existing `IntegrationsPage` (briefly breaking the build), which the user then created along with `lib/data/integrations.ts`. The assistant reconciled rather than clobbered — confirmed the new files existed and folded the review fixes into them too.
12. **Review fixes applied.** Added [lib/useFocusTrap.ts](../../lib/useFocusTrap.ts) and a darker `--primary-solid` token. Fixed AA contrast (white-on-bright-red chips/buttons and red-text-on-tinted-red pills) in both [RecentLeadsTable.tsx](../../components/apmg/RecentLeadsTable.tsx) and the user's [IntegrationsPage.tsx](../../components/apmg/IntegrationsPage.tsx); added focus trap + `inert` background + `aria-modal` for the mobile drawer and inspector; CSS reduced-motion guards and `motion-safe:` histogram rise; dynamic footer year; bounded telemetry retry queue; no stray click-bloom on keyboard activation; dead-class/dead-export cleanup. Registered the APMG surface in [ui-standards.md](../../ui-standards.md). Rebuilt clean on Next 16 and re-screenshotted all states including the new Integrations tab.
13. **Memory persisted.** Wrote project memory files (`project-apmg-leadgen.md`, `apmg-follows-ui-standards.md`, `MEMORY.md` index) under the project's `.claude` memory dir.
14. **KPI cleanup + greeting (final user request).** Reworked [KpiCard.tsx](../../components/apmg/KpiCard.tsx) so the three KPIs render as cells of one `bg-card` instrument panel divided by hairline rules (vertical on desktop, horizontal on mobile) instead of three gapped cards; added a "Hi, Kane Reroma" greeting header with a one-line lede to [OverviewPage.tsx](../../components/apmg/OverviewPage.tsx); updated [Sidebar.tsx](../../components/apmg/Sidebar.tsx) identity to "Kane Reroma" with a KR avatar on the AA-safe `primary-solid` red. Rebuilt, re-screenshotted dark/light/mobile, confirmed clean.
15. **Server resurrection.** Late in the session the production server on :3210 hit exit-127 / "Could not find a production build" issues because `.next` was invalidated when a serving process was force-killed on Windows. A single clean rebuild-then-start fixed it; the final state returned `200` at `http://localhost:3210`. The build at that point also picked up further parallel user work — a **Pipeline** tab, a `/api/pipeline/upload` API route, and an app icon — all of which compiled.

## Files created / modified
Derived from Write/Edit calls in this session. (Config + scaffold files are listed once even though some were edited multiple times.)

| File | Type | Purpose |
| --- | --- | --- |
| [package.json](../../package.json) | created | Project manifest; later bumped to Next 16.2.9, `playwright` devDep added |
| [tsconfig.json](../../tsconfig.json) | created | TypeScript config (Next 16 also auto-reconfigured it) |
| [next.config.mjs](../../next.config.mjs) | created | Next.js config |
| [postcss.config.mjs](../../postcss.config.mjs) | created | PostCSS/Tailwind pipeline |
| [.gitignore](../../.gitignore) | created | Standard Next ignores |
| [tailwind.config.ts](../../tailwind.config.ts) | created+modified | Theme tokens, calibrated `signal` red scale, `primary-solid`, `bar-rise`/`signal-ping` animations |
| [app/globals.css](../../app/globals.css) | created+modified | Semantic theme tokens, calibrated reds, click-ping CSS, reduced-motion guards |
| [app/layout.tsx](../../app/layout.tsx) | created | Fonts (Inter + JetBrains Mono) + theme bootstrap |
| [app/page.tsx](../../app/page.tsx) | created | Root page mounting the shell |
| [app/global-error.tsx](../../app/global-error.tsx) | created | Next 16 global error boundary (themed) |
| [app/not-found.tsx](../../app/not-found.tsx) | created | Themed 404 |
| [lib/cn.ts](../../lib/cn.ts) | created | `clsx`+`tailwind-merge` class helper |
| [lib/theme.ts](../../lib/theme.ts) | created+modified | Theme state + `startViewTransition` toggle (made version-robust) |
| [lib/telemetry.ts](../../lib/telemetry.ts) | created+modified | Click telemetry core: `[data-track]` delegation, ring buffer, `sendBeacon`, pings counter, bounded retry queue |
| [lib/data/leads.ts](../../lib/data/leads.ts) | created+modified | Preset leads/KPI/histogram sample data |
| [lib/data/integrations.ts](../../lib/data/integrations.ts) | created (user) | n8n automations data (built by user, contrast-fixed here) |
| [lib/nav.ts](../../lib/nav.ts) | created (then user-extended) | Sidebar nav model; `integrations` tab added by user |
| [lib/format.ts](../../lib/format.ts) | created | Number/format helpers |
| [lib/useCountUp.ts](../../lib/useCountUp.ts) | created | Reduced-motion-safe count-up hook |
| [lib/useFocusTrap.ts](../../lib/useFocusTrap.ts) | created | Focus-trap hook for drawer/inspector |
| [components/ui/button.tsx](../../components/ui/button.tsx) | created+modified | Button primitive; default variant moved to AA-safe `primary-solid` |
| [components/ui/card.tsx](../../components/ui/card.tsx) | created | Card primitive |
| [components/ui/badge.tsx](../../components/ui/badge.tsx) | created | Badge primitive |
| [components/ui/table.tsx](../../components/ui/table.tsx) | created | shadcn-style Table primitive |
| [components/ui/scroll-area.tsx](../../components/ui/scroll-area.tsx) | created | Scroll-area primitive |
| [components/apmg/SignalLed.tsx](../../components/apmg/SignalLed.tsx) | created | Pulsing status LED (reduced-motion guarded) |
| [components/apmg/ThemeToggle.tsx](../../components/apmg/ThemeToggle.tsx) | created+modified | Dark/light toggle wired to `useTheme().toggle` |
| [components/apmg/SignalTicker.tsx](../../components/apmg/SignalTicker.tsx) | created | Live signal ticker with pings counter |
| [components/apmg/ClickPing.tsx](../../components/apmg/ClickPing.tsx) | created+modified | Click-ping bloom; skips synthetic 0,0 keyboard clicks |
| [components/apmg/Sidebar.tsx](../../components/apmg/Sidebar.tsx) | created+modified | 5-slot editorial sidebar; focus-trap/`inert`; identity "Kane Reroma" / KR avatar |
| [components/apmg/MobileHeader.tsx](../../components/apmg/MobileHeader.tsx) | created | Mobile drawer header |
| [components/apmg/Footer.tsx](../../components/apmg/Footer.tsx) | created+modified | "Developed by APMG © {dynamic year}"; equal-height fix |
| [components/apmg/TelemetryInspector.tsx](../../components/apmg/TelemetryInspector.tsx) | created+modified | Live telemetry drawer; focus trap + `aria-modal` |
| [components/apmg/Reveal.tsx](../../components/apmg/Reveal.tsx) | created+modified | Reduced-motion-safe reveal wrapper |
| [components/apmg/KpiCard.tsx](../../components/apmg/KpiCard.tsx) | created+modified | KPI gauge cell; later fused into one hairline-divided panel |
| [components/apmg/LeadsHistogram.tsx](../../components/apmg/LeadsHistogram.tsx) | created+modified | Hand-rolled histogram (By month/By source); `motion-safe:` rise |
| [components/apmg/RecentLeadsTable.tsx](../../components/apmg/RecentLeadsTable.tsx) | created+modified | Recent-leads table; contrast-fixed status pills, keyboard rows |
| [components/apmg/CommandBar.tsx](../../components/apmg/CommandBar.tsx) | created+modified | Page header (breadcrumb + ticker + telemetry button); a11y name |
| [components/apmg/OverviewPage.tsx](../../components/apmg/OverviewPage.tsx) | created+modified | Overview assembly; greeting header + fused KPI panel |
| [components/apmg/ComingSoon.tsx](../../components/apmg/ComingSoon.tsx) | created | Placeholder for non-Overview tabs |
| [components/apmg/DashboardShell.tsx](../../components/apmg/DashboardShell.tsx) | created+modified | Client shell; `inert` background wiring |
| [components/apmg/IntegrationsPage.tsx](../../components/apmg/IntegrationsPage.tsx) | created (user) | n8n Integrations tab (built by user, contrast-fixed here) |
| [ui-standards.md](../../ui-standards.md) | modified | Registered the APMG surface + red accent (§1.2, §15, §17.8) |

Memory files were also written outside the repo (under `.claude/projects/.../memory/`): `project-apmg-leadgen.md`, `apmg-follows-ui-standards.md`, `MEMORY.md`. A temporary `_shot.mjs` Playwright screenshot script was written to the project root by the assistant for verification and then deleted before session end. `app/icon.png` plus `components/apmg/pipeline/`, `lib/pipeline/`, `app/api/`, `supabase/` appeared from parallel user work and later sessions.

## Key decisions & rationale
- **Follow the house grammar, spend distinctiveness on one axis.** `ui-standards.md` (Simple HRIS) explicitly sanctions per-dashboard color/density identity (§1.2). So the shell, 5-slot sidebar, stat-tile/table/motion/a11y conventions were followed faithfully, and the unique identity ("live signal" telemetry) was concentrated in the red accent — turning the requested click telemetry into the visual signature rather than a hidden feature.
- **Red as a measurement state, not decoration.** Three calibrated reds with strict rules: Incandescent `#C8102E` for bar fills only (never text), Signal `#FF2E1F` for live/large red text in dark, no green at all (direction encoded within the red family). This was the winning panel's thesis and the judge's contrast guardrail.
- **Manual scaffold over `create-next-app`.** Hand-written config is more deterministic and avoids interactive prompts.
- **Telemetry as a framework-agnostic core + thin React hook.** A ring buffer with a pluggable `sendBeacon` endpoint (`NEXT_PUBLIC_TELEMETRY_ENDPOINT`) and local persistence so it's demonstrable; one delegated `[data-track]` listener lifts `data-track-*` attributes into event props.
- **Upgrade to Next.js 16.** Latest (16.2.9) accepts React 19 and runs Turbopack builds; the assistant added the required global-error/not-found boundaries the new prerender step expects.
- **Reconcile, don't clobber, the user's live edits.** The user was co-editing files (Integrations tab, then Pipeline tab/API/icon). The assistant checked for missing imports, confirmed new files existed, and folded the same contrast/a11y fixes into the user's components rather than overwriting them.
- **Fuse the KPI cards into one panel.** The user's "separated like my parents" complaint matched the original design thesis — three divorced cards became cells of a single hairline-divided instrument panel, calmer and aligned (shared sparkline baseline via `mt-auto`).

## Problems encountered & resolutions
- **Build failure: unused `@ts-expect-error`** in `lib/theme.ts` — the DOM lib now types `startViewTransition`. Resolved by rewriting the branch to be version-robust without the directive.
- **Playwright ESM resolution.** `node shot.mjs` failed with `ERR_MODULE_NOT_FOUND` because ESM resolves relative to the script's own location, not cwd. Resolved by placing the script (`_shot.mjs`) inside the project root, running it, then deleting it.
- **Port 3210 not released after `TaskStop`.** A stopped server kept the port; resolved by finding the PID via `netstat` and force-killing it before restarting.
- **`.next` build invalidated by force-kills.** Repeatedly killing a serving process on Windows invalidated `.next`, so `next start` reported "Could not find a production build" (and exit 127/143). Resolved with a single atomic build-then-start instead of chasing the start/build race.
- **Background task reported "failed" (exit 127) — benign.** The `<task-notification>` for `bwxrjh6rp` reported failure, but the log showed the server started ("Ready in 243ms") and successfully served all screenshots; exit 127 was just the prior instance being torn down, not an app fault.
- **Briefly broken build from parallel edits.** `DashboardShell` imported `IntegrationsPage` before it existed; the user created it (and `lib/data/integrations.ts`) shortly after, restoring the build. The assistant verified existence before rebuilding.
- **Transient harness hiccups.** A mid-response "Connection closed" and a "Compaction failed: another write batch active" message occurred; neither affected the project — all files were saved and builds were clean afterward.
- **Caveat — `playwright` left as a devDependency.** Added solely for verification screenshots; the assistant offered to remove it but it remained in `package.json` at session end.

## Outcome & final state
A working black/red "signal" lead-gen dashboard for APMG Services on **Next.js 16 (App Router, TS, Tailwind, `motion/react`)**, following the `ui-standards.md` grammar:
- **Overview**: greeting header ("Hi, Kane Reroma") → one fused KPI instrument panel (3 hairline-divided cells with mono count-up numerals) → hand-rolled histogram (By month / By source) beside the recent-leads table → "Developed by APMG © {year}" footer.
- **Dark default + light toggle** ("bench-print" light reinterpretation, AA-safe darkened reds).
- **Click telemetry** end-to-end: `[data-track]` delegation, live signal ticker + pings counter, pulsing LED, ping bloom, and a working telemetry inspector drawer (verified showing 7 captured events with props).
- **Integrations tab** (user-built, n8n automations) brought in line on contrast/a11y.
- The 21-finding adversarial review's substantive items were fixed (AA contrast, focus trap + `inert` + `aria-modal`, reduced-motion completeness, dynamic year, bounded retry queue, cleanup).
- `next build` is green on Turbopack; all states visually verified via Playwright. The final production server returned `200` at `http://localhost:3210`. The build at session end also compiled parallel user work (Pipeline tab, `/api/pipeline/upload`, app icon), though those were not implemented or reviewed in this session.

## Follow-ups / open items
- Offered: review the user's new `PipelinePage.tsx` and `/api/pipeline/upload` route against the same contrast/a11y/telemetry standards (likely reuses the `bg-primary/10 text-primary` pill pattern that was moved to transparent for AA elsewhere). — addressed in later sessions.
- Offered: remove the `playwright` devDependency (added only for screenshots).
- Not built in this session: Pipeline / Sources / Campaigns tab bodies, and wiring a real telemetry endpoint.

## Verbatim user requests
> Create me a Leadgen dashboard for AMPG Services it should be Black and red theme. Always default to dark mode but have a toggle switch for Light mode - This is a lead generation dashboard so give me preset on what it looks like. Add a side bar which should have an Overview Page which would have 3 KPI Cards and Histogram below it along side with the Small table. so 3 KPI Cards at the top a side by side histogram at the bottom with the Table. Add also a footer at the bottom - Developed by APMG @current Year. I would also set this dashboard up for telemetry on the clicks.

> Improve the KPI Cards from the overview it looks so separated like my parents make sure its nice to look at and clean as well with a greeting Like Hi Kane Reroma
