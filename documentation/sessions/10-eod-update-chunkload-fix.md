# Session 10 — End-of-shift update + ChunkLoadError (mixed prod/dev `.next`) fix

> **Session ID:** `855d0ed5-10cc-44b9-9adc-8f7e907f7bad`
> **Date:** 2026-06-29, 03:02–07:59 local
> **Status:** ✅ Both items resolved. The EOD update was delivered (grounded in the real diff); the ChunkLoadError was diagnosed and the corrupt cache cleared. **No source/config files changed** — the only mutation was deleting the gitignored `.next` cache.
> **Primary tools used:** Bash (git status/log/diff), Read, Grep, Glob, AskUserQuestion, PowerShell (delete `.next`)
> **Related sessions:** [04-dev-server-enoent-fix.md](04-dev-server-enoent-fix.md) · [03-api-search-integration.md](03-api-search-integration.md) · [09-pipeline-supabase-live.md](09-pipeline-supabase-live.md)

## Objective

Two unrelated asks in one session:
1. > "create me an end of sshift update similar to this [pasted example EOD]"
2. > "## Error Type — Runtime ChunkLoadError — Failed to load chunk … hmr-client … Next.js version: 16.2.9 (Turbopack)"

Produce an end-of-shift report that reflects what was *actually* built that day, and fix a runtime `ChunkLoadError` in the running dev server.

## TL;DR

For the **EOD update**, rather than echoing the user's example, the assistant inspected the real state — `git status`/`diff` (no commits, working-tree changes only), the new Pipeline files, the `leads` schema, the nav changes — and wrote a grounded "Monday 29/06/2026" report covering the lead-import pipeline, the Supabase `leads` table, and the dashboard polish. For the **ChunkLoadError**, it diagnosed the cause as a **single `.next` directory holding both a production build and a dev session** (incompatible Turbopack-dev vs webpack-prod chunk artifacts), confirmed it from the directory's mixed timestamps, and — with the user's go-ahead — deleted `.next` so a clean `npm run dev` + hard refresh would resolve it.

## What happened

### 1. End-of-shift update (grounded in the real diff)
- Ran `git status` + `git diff --stat` + untracked-file listing, and `git log` (only the `Initialize` commit existed — all the day's work was uncommitted working-tree changes).
- Read the new Pipeline surface to describe it accurately: [PipelinePage.tsx](../../components/apmg/PipelinePage.tsx), [pipeline/StepRail.tsx](../../components/apmg/pipeline/StepRail.tsx), [lib/pipeline/csv.ts](../../lib/pipeline/csv.ts), [app/api/pipeline/upload/route.ts](../../app/api/pipeline/upload/route.ts), [supabase/schema.sql](../../supabase/schema.sql), [.env.local.example](../../.env.local.example), and checked the nav/telemetry wiring.
- Delivered an EOD update dated **Monday 29/06/2026** in the user's template, covering: the lead-import Pipeline screen (Upload → Read & parse → Push to Supabase), the Supabase `leads` table, and the dashboard polish (personalised greeting, fused KPI cards).

### 2. ChunkLoadError diagnosis + fix
- Recognised the failing `hmr-client.ts` chunk as a **stale `.next` cache mismatch**, not a code bug.
- Read `package.json`, found `next.config.mjs`, and listed `.next`: it contained **both** a production build (`BUILD_ID`, `build/`, `routes-manifest.json`, written by `next build` at 07:56) **and** a dev session (`dev/`, written by `next dev` at 07:57).
- Explained the root cause: Turbopack's dev HMR client and the webpack production build write **incompatible chunk artifacts to the same `.next` directory; running dev on top of a leftover production build makes the browser request chunk hashes that no longer exist → `ChunkLoadError`.
- Asked before deleting (AskUserQuestion); the user chose **"Yes, delete .next"**; deleted it via PowerShell (`Remove-Item -Recurse -Force .next`).
- Gave the restart steps (`npm run dev` + Ctrl+Shift+R) and prevention advice: don't mix `next build` and `next dev` against the same folder, or give the production build its own `distDir`.

## Files created / modified

**None in the repo.** The only filesystem change was deleting the gitignored `.next` build cache. No source or config files were edited.

## Key decisions & rationale

- **Ground the EOD report in the real diff, not the example.** The user's pasted example was a *format* to match; the content was reconstructed from `git diff` + reading the actual new files so the report reflects real work.
- **This is a different incident from [Session 04](04-dev-server-enoent-fix.md).** Session 04 was an `ENOENT` from **three servers sharing one `.next`**; here it's a **`ChunkLoadError` from one `.next` holding both a prod build and a dev session**. Same family (cache corruption from misusing `.next`), distinct trigger and symptom.
- **Confirm before deleting.** `.next` is regenerated, but the assistant still asked (and noted Windows locks files while the dev server runs).

## Problems encountered & resolutions

- The `ChunkLoadError` itself — resolved by clearing the mixed `.next` cache (see above).

## Outcome & final state

The EOD update was delivered; the corrupt cache was cleared so a clean dev server resolves the `ChunkLoadError`. The repo's tracked files were untouched.

## Follow-ups / open items

- **Optional hardening:** give the production build its own `distDir` (in [next.config.mjs](../../next.config.mjs)) so `next build` can never collide with `next dev` again — recommended, not applied.
- This was the first of two end-of-shift-report requests; a later session asked for the same report "same as yesterday".

## Verbatim user requests

> create me an end of sshift update similar to this [followed by a pasted "End of Shift update – Friday, 26/06/2026" example]

> ## Error Type — Runtime ChunkLoadError — Failed to load chunk /_next/static/chunks/…hmr-client…  — Next.js version: 16.2.9 (Turbopack)
