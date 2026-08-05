# Session 26 — Vercel production build failure (TypeScript regression in the enquiry route)

> **Session ID:** `632ba3ac-696b-449c-83ab-c26d2728db84`
> **Date:** 2026-07-28, 08:15–08:17 UTC (18:15–18:17 AEST) — ~2 minutes, 1 user turn
> **Status:** Resolved ✅ — both type errors fixed and `tsc` clean in-session; the **user** committed and pushed them ~6 minutes later in `a5cc0c0`. A green redeploy was never observed from this session.
> **Primary tools used:** Read ×3, PowerShell ×3 (`npx tsc --noEmit`), Edit ×2, Grep ×1
> **Related sessions:** [24-portal-social-source-attribution.md](24-portal-social-source-attribution.md) — the source-attribution feature that created **both** of these errors, running against the *same checkout at the same time* (07:52–08:22 UTC) · [25-portal-socials-legal-modal.md](25-portal-socials-legal-modal.md) — the other concurrent session (08:08–08:18 UTC); it had already seen the `route.ts:278` error on its own `tsc` run and correctly disowned it as pre-existing · [18-legal-consent-unsubscribe-enquiry-notify.md](18-legal-consent-unsubscribe-enquiry-notify.md) — built the consent gate and the client-side `consent_accept` telemetry (2026-07-12). The *server-side* `portal_consent_accept` event whose `props` object is the site of this failure came later, in commit `55ce855` (2026-07-16), not in session 18.

## Objective
The user pasted a full Vercel production build log, nothing else. The build had failed on `main` at commit `35dcaf5`. The implicit ask: find out what broke it and fix it.

## TL;DR
- **The deploy died on type checking, not compilation.** Turbopack reported `✓ Compiled successfully in 12.8s`, then `Running TypeScript ...` → `Failed to type check.` → worker exit 1. "Compiled successfully" in that log is not a green build.
- **Root cause:** [`app/api/portal/inquiries/route.ts`](../../app/api/portal/inquiries/route.ts) had `const sourceProp = source ? { source } : {};`. TypeScript infers that as a **union** whose false branch is `{ source?: undefined; … }`, which is not assignable to the `Record<string, string>` index signature on `PortalEventRow.props` — `Type 'undefined' is not assignable to type 'string'`. The error surfaced ten lines down, at the first spread site (`route.ts:278:9`; the declaration was `route.ts:268` in that commit).
- **Fix:** annotate the declaration — `const sourceProp: Record<string, string> = source ? { source } : {};`. Types-only; zero runtime change.
- **A second, hidden error was flushed out** by running `npx tsc --noEmit` locally: [`components/apmg/EnquiriesPage.tsx`](../../components/apmg/EnquiriesPage.tsx) rebuilt the portal summary field-by-field and was missing the newly-required `bySource` field on `PortalSummary` (`TS2345`). That one was in **uncommitted** local work — it could not have broken *this* deploy, but it would have broken the next one.
- **One wrong hypothesis first:** the assistant initially suspected a demo enquiry fixture in `lib/data/enquiries.ts` was missing `source`, read and grepped that file, re-ran `tsc`, got the same error back, and only then looked at the component.
- **Nothing was committed or pushed by the session** — the working tree held in-flight source-attribution / portal-socials work (summary route, `Footer`, `ServicesPortal`, `SocialLinks`) belonging to **two other sessions running concurrently on the same checkout** (24 and 25), so the push was deliberately left to the user.
- **Verified now (2026-07-30):** both fixes are present in the working tree (`route.ts:269`, `EnquiriesPage.tsx:836`) and in commit `a5cc0c0` (where the annotation sits at `route.ts:268`); `npx tsc --noEmit` exits **0**.

## Narrative

The only user message in the session was a pasted Vercel log: build in `iad1`, 2 cores / 8 GB, cloning `github.com/kane-ampg/APMG-Leadgen` at branch `main` commit `35dcaf5`, build cache restored, Vercel CLI 56.5.0, Next.js 16.2.9 (Turbopack). The compile phase passed in 12.8s. Then:

```
18:12:31.241   Running TypeScript ...
18:12:41.153 Failed to type check.
./app/api/portal/inquiries/route.ts:278:9
Type error: Type '{ source: string; … } | { source?: undefined; … }' is not assignable to type 'Record<string, string>'.
    Property 'source' is incompatible with index signature.
      Type 'undefined' is not assignable to type 'string'.
> 278 |         props: { service, consent_version: legal.version, scope: "enquiry", ...sourceProp },
```

`Next.js build worker exited with code: 1`, `Error: Command "npm run build" exited with 1`.

Reading the route around the reported line made the cause obvious and slightly non-local: the failing line is the **spread site**, but the bad type is created ten lines above it (line 268 at `35dcaf5`), and it feeds *two* `props` objects (lines 278 and 289 — `portal_consent_accept` and `portal_inquiry`). `source` arrives from `readAttribution(req)` (or `null` on the internal/bot branch), so it is `string | null`. Writing `source ? { source } : {}` makes TypeScript normalise the two branches into a union and give the empty-object branch an explicit `source?: undefined` — and an optional-undefined property can never satisfy a `Record<string, string>` index signature. The destination type is `PortalEventRow.props` in [`lib/portal/server.ts`](../../lib/portal/server.ts) (`props: Record<string, string>`, line 22). Annotating the variable at its declaration makes both object literals get checked against `Record<string, string>` directly — `{}` is fine there — so the union never forms. One edit, no behavioural change.

Rather than push and wait on another Vercel round trip (the failed build itself only burned ~28s of machine time, but the push → queue → read cycle is minutes, and the type-check phase stops at the first error), the next step was a local `npx tsc --noEmit`. That came back exit 2 with a **different** error: `components/apmg/EnquiriesPage.tsx` `TS2345`, on the big `setLoad({ status: "ready", mode: "live", summary: { … } })` argument.

The first read of that error was wrong. Because the error text mentioned `byService` / `byCategory` / `recentEvents` object shapes, the assistant went looking in `lib/data/enquiries.ts` — read the demo enquiry fixtures around line 280 and grepped the file for `source` — on the theory that a second hard-coded enquiry list was missing the new field. The grep showed `source` was wired through the types and the fixtures, and a re-run of `tsc` produced the same `EnquiriesPage.tsx` error at the same line (both `tsc` outputs are truncated in the condensed transcript, so byte-identity isn't recorded — the error location and code are). Only then did the assistant read `EnquiriesPage.tsx` itself and find the actual gap: the `fetchAll` callback deliberately rebuilds the summary **field by field** (so a partial API payload can't leave an `undefined` array behind for the panels to `.map` over), and the new required `bySource` field on `PortalSummary` had never been added to that rebuild. Adding `bySource: Array.isArray(sum.bySource) ? sum.bySource : []` — matching the pattern already used for the sibling arrays — closed it. `npx tsc --noEmit` then exited clean.

Worth recording: the Edit on `EnquiriesPage.tsx` came back with a warning that the file had been modified on disk since it was last read. Two other sessions were live on the same checkout at that minute — session 24 (source attribution: summary route, `enquiries.ts`, `EnquiriesPage.tsx`) and session 25 (portal socials / legal modal) — so the file was moving underneath this one. That is also why the line numbers in the session's own closing message (`route.ts#L268`, `EnquiriesPage.tsx#L749`) no longer match the file — the fixes now sit at `route.ts:269` and `EnquiriesPage.tsx:836`.

The session ended with an explicit hand-back: both errors fixed, `tsc` clean, nothing committed, and a note that the working tree still contained in-progress source-tracking changes, so the user should push when that work was ready.

## Files touched

| File | Change | Why |
|------|--------|-----|
| [`app/api/portal/inquiries/route.ts`](../../app/api/portal/inquiries/route.ts) | Annotated the conditional-spread helper: `const sourceProp: Record<string, string> = source ? { source } : {};` | **The error that broke the production deploy.** Stops TS inferring a union with a `source?: undefined` branch that can't satisfy `PortalEventRow.props`'s `Record<string, string>` index signature |
| [`components/apmg/EnquiriesPage.tsx`](../../components/apmg/EnquiriesPage.tsx) | Added `bySource: Array.isArray(sum.bySource) ? sum.bySource : []` to the field-by-field summary rebuild in `fetchAll` | `PortalSummary.bySource` had become a required field in the uncommitted work of the concurrent session 24 (`lib/data/enquiries.ts:79`); the rebuild omitted it (`TS2345`). Would have failed the *next* deploy |

No other project files were modified. **No memory files were written or updated** in this session.

## Decisions

- **Annotate the variable, don't restructure the object.** Options were: annotate the declaration, spread the conditional inline at each of the two `props` sites, or cast. Annotating is the smallest diff, keeps the readable conditional-spread idiom, moves the type error to the place that actually causes it, and — importantly for a compliance-sensitive path — changes no runtime behaviour whatsoever.
- **Type-check locally before pushing, not after.** Vercel's type-check phase prints the first error and aborts the build, so "fix the one error in the log and push" is a guess, not a verification. The local `npx tsc --noEmit` is what caught the second error — and it did so *because* it covers the whole working tree, not just what was pushed.
- **Fix the uncommitted second error too**, rather than leaving it as a landmine for the next deploy, even though it was not the cause of this failure.
- **Match the file's existing defensive idiom.** `Array.isArray(sum.bySource) ? sum.bySource : []` rather than `sum.bySource ?? []`, because the surrounding lines guard against a *non-array* payload, not merely a missing one.
- **Do not commit or push.** The working tree carried the half-finished source-attribution / portal-socials work of two other live sessions; committing would have shipped it. The session fixed the build and handed the push back to the user.

## Problems / gotchas

- **`✓ Compiled successfully` is not a passing build.** Next 16 runs Turbopack compilation and the TypeScript check as separate phases; the log's success line came ~10 seconds before the failure.
- **Vercel's type-check phase reports one error and stops.** A build log names the first error regardless of how many the tree contains, so "fix what the log says and push" is never a verification. (In this particular case the second error lived only in uncommitted local work, so it could not have shown up in *that* log — the argument for checking locally holds either way.)
- **The reported line was not the broken line.** `route.ts:278` is where the bad type is *consumed*; the bad type is *created* ten lines up — line 268 at `35dcaf5`, line 269 in the tree today. Conditional spreads systematically report at the spread site.
- **The `cond ? { k: v } : {}` pattern is a recurring trap** with index-signature targets (`Record<string, string>`). The empty branch is widened to `{ k?: undefined }`, which the index signature rejects. Note this idiom shipped in commit `35dcaf5` itself, alongside the new `lib/portal/source.ts` — it was a brand-new regression, not old code rotting. Session 25 hit a *third* instance minutes earlier, at `app/api/portal/summary/route.ts(182)` in the same uncommitted work; that one was fixed by session 24 before `a5cc0c0`.
- **The wrong first suspect.** `lib/data/enquiries.ts` (types + demo fixtures) was read and grepped before `EnquiriesPage.tsx`; the re-run of `tsc` returning the same error at the same line is what corrected course. Cost was ~one tool cycle.
- **Concurrent sessions on one checkout.** The `EnquiriesPage.tsx` edit landed with a "modified on disk since you last read it" warning — sessions 24 and 25 were editing the same tree in the same minutes. The edit applied cleanly, but any follow-up edit depending on surrounding context would have been unsafe without a re-read. (Session 24's own write-up records the mirror image of this: its patch adding the same `bySource` line failed as "string not found" because *this* session had already added it — which it misattributed to a formatting hook.)
- **Unaddressed warning in the same build log:** `⚠ The "middleware" file convention is deprecated. Please use "proxy" instead.` Non-fatal, so it was not touched. [`middleware.ts`](../../middleware.ts) is still at the repo root under the deprecated convention.

## Final state

**Verified against the live repo on 2026-07-30:**

- The annotation is present at [`app/api/portal/inquiries/route.ts:269`](../../app/api/portal/inquiries/route.ts) and the `bySource` line at [`components/apmg/EnquiriesPage.tsx:836`](../../components/apmg/EnquiriesPage.tsx).
- Git confirms the story precisely: the failing commit `35dcaf5` (2026-07-28 18:12:05 +1000) contains the **un-annotated** `const sourceProp = source ? { source } : {};`, and commit `a5cc0c0` ("ada", 2026-07-28 18:23:50 +1000 — ~6 minutes after this session ended) contains the annotated version plus the `bySource` fix. `a5cc0c0` touches 8 files, and its only change to `route.ts` is that one-line annotation (`2 +-`); the rest is the two concurrent sessions' work — summary route, `EnquiriesPage`, `lib/data/enquiries.ts` (session 24) and `Footer`, `LegalDocModal`, `ServicesPortal`, `SocialLinks` (session 25). So the user pushed the fixes themselves, as intended.
- `bySource` was genuinely absent from committed code at `35dcaf5` (neither `lib/data/enquiries.ts` nor `EnquiriesPage.tsx` mentioned it there), which confirms the second error existed only in the local working tree and could not have caused this deploy failure.
- `npx tsc --noEmit` on the current working tree exits **0**.
- **The AEST mapping in the header is corroborated, not just assumed.** The build log clones `35dcaf5` at `18:12:13`, eight seconds after that commit's own author timestamp of `18:12:05 +1000` — so the log's clock is `+1000`, and the transcript's `08:15–08:17` UTC is `18:15–18:17` AEST. Session 25's doc (same afternoon, same tree) records the identical offset.
- **`a5cc0c0` reached the remote.** `origin/main` is at `a5cc0c0` (`https://github.com/kane-ampg/APMG-Leadgen.git`), so the fixes were genuinely pushed, not just committed locally.

**Not verified / still open:**

- **Nobody confirmed the redeploy went green.** No build log for `a5cc0c0` appears in the transcript, this session ended before any redeploy, and no later session doc (27–32) records a build result for it either — sessions 29 and 31 only note `a5cc0c0` as the tip of `main`. Still on the user to confirm the Vercel deployment for `a5cc0c0` succeeded (the local `tsc` pass is strong evidence, not proof — Vercel type-checks the pushed tree, which by then also included the rest of the source-attribution work).
- **Which Vercel project failed is not knowable from the log.** It names the repo (`kane-ampg/APMG-Leadgen`) and branch (`main`) but no project. Per `middleware.ts`'s own header, the admin console and the customer portal are **two separate Vercel projects built from this one codebase**, so a type error on `main` fails whichever of them deploys that branch — the fix is project-agnostic, but a green-deploy check should cover both.
- **The middleware → proxy deprecation** is untouched and will keep warning on every build until `middleware.ts` is migrated. Not urgent; not scheduled.
- **Adjacent, not this session's work:** the source-attribution feature these errors came from still needs `supabase/portal-telemetry.sql` re-run so `portal_inquiries.source` exists. The route already defends against its absence on both paths — the POST retries the insert with `source` deleted (`route.ts:229–240`) and the GET listing falls back to `LEGACY_COLS` (`COLS` minus `source`, `route.ts:389–393`), each logging *"run supabase/portal-telemetry.sql"* — so nothing breaks, but the source column stays unpopulated until the user runs it (`alter table public.portal_inquiries add column if not exists source text;`, `supabase/portal-telemetry.sql:64`).
