# Session 21 — Pipeline leads: a separate "No email" tab

> **Session ID:** `3a360ba7-a1c3-487a-a22a-956834cbe3b7`
> **Date:** 2026-07-25, 13:47–13:51 UTC (transcript timestamps; ≈09:47–09:51 local at UTC−4, consistent with the 10:21 −0400 commit that carries the work)
> **Status:** Shipped — typecheck clean, committed and pushed (`135ed0a`, on `origin/main`). No browser check, no `next build`, no Find-emails run; the project has no working lint path at all (pre-existing).

## Objective
One request, one sitting. In the user's words:

> "Pipeline - Add a separate tab for the leads with no email please so when I click find email and their emails pop up they get transferred to the leads with emails"

The shared leads table already split rows into a **With email** group and a **No email** group, but as two *stacked sections* on one scrolling page. The user wanted them to be real **tabs**, and wanted the transfer to be visible: run **Find emails** on the no-email tab, and any lead that gets an address should end up under **With email**.

## TL;DR
- **Replaced the stacked sections with a §11.1 sliding-pill tab row** inside `SelectableLeads` (`components/apmg/pipeline/StoredLeads.tsx`) — a single gradient indicator that glides between two pills, each with a live count badge. Confirmed present in the working tree at `StoredLeads.tsx:698-723`.
- **New module-level `EmailTabPill` component + `TAB_PANEL_VARIANTS`** for the directional panel slide, wrapped in `overflow-x-clip` so the slide can't spawn a page scrollbar.
- **The "transfer" needed no new bookkeeping.** The find-emails route already persists found addresses onto the lead row server-side; `onChanged()` refetches and the with/without split is re-derived from the data, so counts on both pills move on their own. This is verified **by reading the code path only**: `app/api/pipeline/campaigns/find-emails/route.ts` does PATCH the `emails` column per lead, but that route was never opened during the session (it only appeared in the opening grep's file list), and no Find-emails run was ever executed, so the transfer has never been observed at runtime.
- **The `Find emails` button moved onto the No email tab**, alongside a note that found leads move to the With email tab. The finder flow itself was not touched — same route, same `MAX_FIND_LEADS` cap, same checked-rows-else-whole-tab targeting.
- **Search can no longer collapse the tab row.** The old code decided whether to split based on the *filtered* rows; the new `split` flag reads the *unfiltered* `rows`, and each tab carries its own "no matches" hint.
- **One-line copy change** in `FindEmailsResult.tsx` — "moved up into the With email **list**" → "moved to the With email **tab**". Contrary to a first impression, this component was **not created** in this session; it already existed and only that string changed (confirmed: `git show 0932656:components/apmg/pipeline/FindEmailsResult.tsx` already carries the older "moved up into the With email list" wording at the same line).
- **`npx tsc --noEmit` passed.** `npx eslint` and `npm run lint` both failed for reasons unrelated to the change — the repo has **no ESLint setup at all** (see gotchas).

## Narrative
The assistant opened by grepping for the find-email flow and the Pipeline surface, which pointed at `components/apmg/pipeline/StoredLeads.tsx`, `SendCampaigns.tsx`, `FindEmailsResult.tsx` and `app/api/pipeline/campaigns/find-emails/route.ts`. It read `StoredLeads.tsx` in full (~62 KB) and `FindEmailsResult.tsx`, and found the pre-existing shape: a `SelectableLeads` component that computed `withEmail` / `noEmail` from `filtered`, then rendered — when `noEmail.length !== 0` — a `With email · N` mono header over one table, a `No email · N` header plus the "left out of campaigns until an address is found" note and the **Find emails** button over a second table. So the split already existed; what didn't exist was tabbing.

Before writing anything it went looking for the house tab grammar. `role="tab"`/`aria-selected` grepped to only two files (`ServicesPortal.tsx`, `SendCampaigns.tsx` — and the SendCampaigns hit turned out to be `aria-selected` on folder select buttons, not a tab row; a follow-up grep for `role="tab"` in that file found nothing) and `role="tablist"` to exactly one (`ServicesPortal.tsx:446`). It then read `ui-standards.md` §11 / §11.1, pulled the `TabPill` body out of `ServicesPortal.tsx` with a targeted grep (`ServicesPortal.tsx:523`) — the same sliding-pill pattern session 16 used for the portal's Our Services / Our Team tabs — and copied that anatomy. Note that `components/ui/tabs.tsx` was never an alternative on the table: **it does not exist in this repo** (`components/ui/` holds only `badge`, `button`, `card`, `scroll-area`, `table`, and `@base-ui/react` is not a dependency). §11 of `ui-standards.md` documents that primitive because the standards file is carried over from the HRIS project — its §11.1 canonical references point at `src/components/hr/`, which also isn't here.

The build-out was six edits to `StoredLeads.tsx`:

1. Imports — added `useId` from React and `Mail` / `MailX` from lucide.
2. Reworded the split comment to describe tabs and the automatic transfer.
3. Added `const [tab, setTab] = useState<"with" | "no">("with")`, a `tabLayoutId = useId()`, and a `reduce` flag from `useReducedMotion()`. The `useId` is there so the shared `layoutId` stays unique if two lead tables ever mount at once — a real possibility, since `SelectableLeads` is rendered from three separate places.
4. Reworded the `findEmails` comment too — "the whole section" → "the whole tab".
5. Swapped the render gate from `noEmail.length === 0` to `!split`, where `split = rows.some((r) => (r.emails?.length ?? 0) === 0)` — the unfiltered check — and replaced the two stacked sections with a `role="tablist"` pill row plus an `AnimatePresence mode="wait"` panel.
6. Added `EmailTabPill` and `TAB_PANEL_VARIANTS` at module level, just below the `selectable table (shared)` divider.

Then the one copy edit in `FindEmailsResult.tsx` so the success modal's language matched the new UI.

Verification was thin but honest. `npx tsc --noEmit` returned clean. Lint did not: `npx eslint <files>` failed with ESLint 10.8.0 complaining there is no `eslint.config.*` file, and `npm run lint` failed with `Invalid project directory provided, no such directory: …\leadgen\lint` — the `package.json` script is still `"lint": "next lint"`, which Next 16 no longer recognises, so it reads `lint` as a positional directory argument. Both are pre-existing repo issues; the assistant said so rather than papering over it. Nothing was run in a browser and no production build was attempted.

**Post-session check against the live repo:** both edits are present and are committed — commit `135ed0a` ("push", 2026-07-25 10:21 −0400, i.e. shortly after the session closed) contains `EmailTabPill` and the "moved to the With email tab" string — `git log -S` confirms both strings enter the history at exactly that commit. The only uncommitted work in `StoredLeads.tsx` today is unrelated (an `exportRows` prop threading a `LeadsExportMenu` into `FoldersView`, from later work), so this session's tab code is intact.

## Files touched
| File | Change | Why |
|------|--------|-----|
| `components/apmg/pipeline/StoredLeads.tsx` | Replaced the stacked With email / No email sections in `SelectableLeads` with a §11.1 sliding-pill tab row + `AnimatePresence` panel; added module-level `EmailTabPill` and `TAB_PANEL_VARIANTS`; added `tab` / `tabLayoutId` / `reduce` state; imported `useId`, `Mail`, `MailX`; split gate moved from filtered `noEmail.length` to unfiltered `rows.some(...)`; per-tab empty hints; moved the `Find emails` button + note onto the No email tab | The actual request — a separate tab for no-email leads, with the found leads visibly moving across |
| `components/apmg/pipeline/FindEmailsResult.tsx` | One string: "moved up into the With email list." → "moved to the With email tab." | Success-modal copy had to match the new tab language. **Pre-existing file — not created here** |

No API routes, no data layer, no SQL, no env vars, no n8n workflow JSON, and no agent-memory files were touched. The find-emails endpoint and `lib/pipeline/campaign.ts` were never even opened in-session — they only surfaced as hits in the opening `find email|findEmail|Find Email` grep; their behaviour (`MAX_FIND_LEADS = 50`, the per-lead `emails` PATCH) was taken from the existing comments in `StoredLeads.tsx` and confirmed afterwards while writing this doc.

## Decisions
- **Hand-rolled `EmailTabPill`, because there is no `components/ui/tabs` to reach for.** `ui-standards.md` §11.1 explicitly reserves the sliding-indicator pill row for "dense in-page tab/filter rows" and §11 notes the base-ui `<Tabs>` variant CSS misbehaves in this Tailwind config — but §11's `components/ui/tabs.tsx` and its `@base-ui/react/tabs` dependency don't exist in this project at all, so the pill row was the only in-repo option regardless. Copying `ServicesPortal.tsx`'s `TabPill` also means the Pipeline tabs and the customer-portal tabs read as the same component family.
- **`role="tab"` / `aria-selected` rather than §11.1's documented `aria-pressed`.** The standard's canonical HRIS snippet uses `aria-pressed`; this pill follows the in-repo `ServicesPortal` precedent (`role="tab"` inside a `role="tablist"`) instead, which is the correct ARIA for a tab set. A deliberate divergence from the written standard in favour of the local one.
- **Derive the transfer, don't orchestrate it.** No optimistic row moves, no local "recently found" list. The server persists the address, `onChanged()` refetches, the split recomputes. Fewer moving parts and no chance of the UI disagreeing with Supabase.
- **`split` reads unfiltered `rows`, counts read `filtered`.** So the tab row is stable while you type, but each pill's badge still reflects what the search actually matched.
- **Collapse to a single plain list when nothing lacks an email.** `!split` keeps the old single-table render, so a fully-addressed folder doesn't get a pointless one-sided tab row.
- **`useId()` for the `layoutId`.** Framer's shared-element transition keys on `layoutId`; a hardcoded string would let two concurrently-mounted lead tables fight over one indicator.
- **Finder behaviour left exactly as-is.** The button relocated; the payload, the `MAX_FIND_LEADS` slice, the "checked rows if any, else everything visible in this tab" rule, and the demo/error/success outcomes were untouched.

## Problems / gotchas
- **`npm run lint` is broken repo-wide.** `"lint": "next lint"` in `package.json` fails immediately under Next 16 with `Invalid project directory provided, no such directory: …\leadgen\lint`. It never reaches any file, so it reports nothing about this change — and it will keep failing for every future session until the script is replaced.
- **`npx eslint` is also unusable as-is** — ESLint 10.8.0 refuses to run without an `eslint.config.(js|mjs|cjs)`. The reason isn't a stale legacy config: the repo has **no** ESLint config of any kind (neither `eslint.config.*` nor any `.eslintrc*`) and ESLint isn't in `package.json` either — `npx` fetched 10.8.0 on the fly. Neither lint path was made to work; only `tsc` gave a real signal.
- **No visual verification.** The sliding indicator, the directional panel slide, and the reduced-motion path were never seen rendered — the session ended four minutes after it began, on a typecheck.
- **Checkbox selection is shared across both tabs** (unchanged from the stacked layout, but more consequential now). `selected` is one `Set` for the whole component: `toggleAllOf` is per-section, but rows checked on the No email tab stay checked after switching to With email, and the "Delete N selected" bar sits *above* the tab row. With nothing checked, `exportRows` falls back to `filtered` — i.e. **both** tabs' rows, not just the visible one. Not addressed in this session.
- **The tab does not follow the leads.** After a successful find the user stays on the No email tab and watches the counts change; nothing auto-switches them to With email. The success modal tells them where the leads went, which is the whole reason its copy was updated.
- **The assistant's closing summary cites `StoredLeads.tsx:762-786` for the tab row.** Those line numbers were correct at the time but have since drifted; the tab row is at `698-723` in the current file.

## Final state
**Works (in code, typecheck-clean, committed in `135ed0a`, which is on `origin/main`):** the shared leads table renders a two-pill **With email / No email** tab row with live counts wherever `SelectableLeads` mounts — inside an open folder (`FolderDetail`), in the cross-folder search results view (`AllLeadsView`), and in the `FlatLeads` fallback. **Find emails** lives on the No email tab; the route persists addresses to the `emails` column and the refetch re-derives the split, so found leads should leave No email and appear under With email with both badges updating. A fully-addressed list collapses back to one plain table.

**Not done, and nobody has picked it up:** nothing here was checked in a browser or against a production build, so the animation, the a11y behaviour **and the transfer itself** are unverified in practice — the transfer claim rests on reading `SelectableLeads`' `onChanged()` plus the route's per-lead `emails` PATCH, not on a single observed Find-emails run. Both lint entry points remain dead (`package.json`'s `next lint` script under Next 16, and the total absence of an ESLint config or dependency) — that's a repo-maintenance item on the user, independent of this feature. The cross-tab checkbox-selection behaviour described above is a known rough edge that was neither raised by the user nor fixed. And because this session touched only presentation, none of the outstanding Pipeline/outreach ops items from earlier sessions moved.
