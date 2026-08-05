# Session 11 — Pipeline UX: "Save leads?" gate + smooth animations + folder-delete overlay

> **Session ID:** `2e78c6b2-3c7c-4695-a5f3-b9f4237cd4fb`
> **Date:** 2026-06-30, 01:43–02:29 local
> **Status:** ✅ Shipped. `tsc --noEmit` clean.
> **Primary tools used:** Read, Edit, Glob, Bash (`tsc`)
> **Related sessions:** [09-pipeline-supabase-live.md](09-pipeline-supabase-live.md) · [03-api-search-integration.md](03-api-search-integration.md) · [06-pipeline-send-campaigns.md](06-pipeline-send-campaigns.md)

## Objective

Three pipeline-UX refinements, in order:
1. > "ADMIN - Pipeline - it should have a question first before it is pushed to supabase. something like 'Save Leads?'"
2. > "add a proper loading animation please make it smooth its too fast"
3. > "when clicking the trashcan Icon it will animate smoothly showing the cancel and delete"

## TL;DR

Inserted a **"Save leads?" confirmation gate** between parsing and the Supabase write (nothing touches the DB until an explicit click), made the upload progress **animate smoothly** instead of snapping to 100%, and turned the folder-card **trash → confirm** swap into a smooth **slide-in overlay** with zero layout shift. All in the two pipeline files, following the codebase's existing inline-confirm and motion grammar; `tsc` clean throughout.

## What happened

1. **Studied the flow + grammar first** — read [PipelinePage.tsx](../../components/apmg/PipelinePage.tsx), [pipeline/StoredLeads.tsx](../../components/apmg/pipeline/StoredLeads.tsx), [StepRail.tsx](../../components/apmg/pipeline/StepRail.tsx), [CloseDealModal.tsx](../../components/apmg/CloseDealModal.tsx) (for the confirm pattern), the pipeline API routes, and `ui-standards.md` §10 (confirmation grammar).
2. **Task 1 — "Save leads?" gate.** `run()` previously parsed the CSV and **immediately** wrote to Supabase. Split it: a new `"confirm"` phase stops after parsing (nothing written), and a separate `confirmSave()` performs the batched write only on click. The parsed view now shows a "Save N leads to Supabase?" bar, and the step rail reflects the gate (Read & parse done, Push shows "Awaiting save").
3. **Task 2 — smooth upload animation.** Root cause: the *reading* phase already had an eased count-up but the *upload* step had none — in demo mode (or small CSVs) the write returns instantly, so the bar jumped to 100% and the panel flashed. Extracted the count-up into a reusable eased tween, `tweenTo()` (easeOutCubic, reduced-motion aware, cancels cleanly on unmount/re-run), and drove the upload through it so the bar fills smoothly per chunk and rests at 100% before completing.
4. **Task 3 — animated folder-delete.** Refactored `FolderCard` so the base card stays mounted (stable height) and the confirm controls **slide in over it** as an overlay (fade + a subtle slide from the right, `x: 18% → 0`, 0.24s on the house ease), with an opaque backing + a subtle red destructive wash. Because the base never unmounts, there's **zero layout shift** — the grid doesn't reflow.

## Files created / modified

| File | Type | Purpose |
|---|---|---|
| [components/apmg/PipelinePage.tsx](../../components/apmg/PipelinePage.tsx) | modified | New `"confirm"` phase + `confirmSave()` gate before the Supabase write; the "Save leads?" bar in `ParsedView`; reusable eased `tweenTo()` driving a smooth upload progress. |
| [components/apmg/pipeline/StoredLeads.tsx](../../components/apmg/pipeline/StoredLeads.tsx) | modified | `FolderCard` trash → confirm refactored to a slide-in overlay (base stays mounted; zero layout shift; reduced-motion aware). |

## Key decisions & rationale

- **Gate writes behind an explicit click.** A destructive-ish DB write shouldn't happen as a side effect of parsing; the `"confirm"` phase makes "Save leads?" a deliberate step.
- **Reusable `tweenTo()`.** One eased, reduced-motion-aware tween for both the reading and upload count-ups, so the importer animates consistently and never snaps.
- **Overlay instead of a card swap.** Keeping the base card mounted eliminates the layout-shifting jump the instant swap caused, and matches the in-place inline-confirm grammar (§10).

## Problems encountered & resolutions

- **Upload progress snapped to 100%** (no easing on the push step) → driven through the shared `tweenTo()`.
- **Card swap caused a layout jump** → overlay approach with the base card kept mounted.

## Verification done

- **`npx tsc --noEmit -p tsconfig.json`** → clean (no output) after each task. No `next build`, lint, or screenshots were run this session (`tsc` is the authority — Next 16 removed `next lint`).

## Outcome & final state

The importer now asks "Save leads?" before writing, animates its progress smoothly, and confirms folder deletes with an in-place slide-in overlay. Both files typecheck clean.

## Follow-ups / open items

- None raised in-session. (The broader pipeline open items — real auth, verifying `DELETE` live — carry over from [Session 09](09-pipeline-supabase-live.md).)

## Verbatim user requests

> ADMIN - Pipeline - it should have a question first before it is pushed to supabase. something like "Save Leads?"

> add a proper loading animation please make it smooth its too fast

> when clicking the trashcan Icon it will animate smoothly showing the cancel and delete
