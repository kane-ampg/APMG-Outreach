# Session 08 — Sales pipeline: qualified-leads queue, email attribution, AI briefs & closed-deals

> **Session ID:** `c954dda6-aca5-469e-a4f7-970fb907d272` *(continuation — same session as [Session 01](01-ui-foundation-dashboard.md) / [Session 07](07-rbac-permission-first.md), built on top of the RBAC layer)*
> **Date:** 2026-06-29 local (built after RBAC, within the 01:19–08:49 local session span)
> **Status:** ✅ Built and build-verified. The flow is wired end-to-end in the UI; **the data is preset** (no backend persistence yet), the **AI brief runs on a deterministic fallback** until `ANTHROPIC_API_KEY` is set, and the attribution write to Supabase is an explicit `TODO`.
> **Primary tools used:** Read, Write, Edit, Bash (`next build`, `JSON.parse` validation, Playwright via `_shot.mjs`), Skill (`claude-api`)
> **Related sessions:** [07-rbac-permission-first.md](07-rbac-permission-first.md) · [03-api-search-integration.md](03-api-search-integration.md) · [09-pipeline-supabase-live.md](09-pipeline-supabase-live.md) · [06-pipeline-send-campaigns.md](06-pipeline-send-campaigns.md)

## Objective

> "Lets build the sales tab — the main logic about this is that the sales tab will pickup whatever the admin says that these are qualified leads that have potential… we make sure that they have everything they need like Phone Numbers and Emails… and even an AI Prepared summary on what that lead is… But this only happens once we on admin have already sent the custom email from the automation refer to @references/Leadgen Automation.json that needs editing… we attach a hook on those emails that when they click the link it will be sent to our webpage which has telemetry or cookie… so that we know that the automation worked and that the leads where from the Automation itself… then the sales reps will close the deals…"

Build the **Sales** surface and the attribution loop behind it: an admin-qualified, **email-sent-gated** queue of leads complete with contact details and an **AI-prepared brief**, where a click on the automation email's tracked link proves the lead came from the automation (engagement), and reps then close deals.

## TL;DR

Enabled the reserved `sales` role and built the rep-facing **Sales queue** ([SalesPage.tsx](../../components/apmg/SalesPage.tsx)): `emailSent`-gated qualified leads with click-to-call contacts, an AI brief + talking points, an "Engaged" badge, and gated actions. Added the **attribution endpoint** [app/t/[id]/route.ts](../../app/t/[id]/route.ts) (logs the click, sets first-party `apmg_ref` cookies, 302-redirects), edited the n8n automation ([references/Leadgen Automation.json](../../references/Leadgen%20Automation.json)) so its Gmail node sends a real HTML email whose CTA points at `https://apmg-app.vercel.app/t/{best_contact_email}?c=outreach-2026`, and wired a Claude-backed brief generator ([lib/ai/leadSummary.ts](../../lib/ai/leadSummary.ts), model `claude-opus-4-8`, with a deterministic fallback) behind a `sales.view`-gated route. A follow-up turn replaced the "Won" button with a guided **"Closed"** modal that requires a closing note, plus a **Closed-deals tab**, with a shared [SalesProvider](../../components/apmg/SalesProvider.tsx) so the queue and the Closed tab stay in sync.

## What happened

### Domain / deployment naming (precursor)
Two short advisory exchanges shaped a constant used below: the user asked for a domain strategy and confirmed "phase one would be just using .vercel.app". The recommendation — Vercel project **`apmg-app`** (`apmg-app.vercel.app`), mapping 1:1 to a future `app.apmg.com` — was then hard-coded into the tracked email link so phase-one links don't go stale.

### Sales queue + attribution + AI briefs
1. **Read the inputs first** — `references/Leadgen Automation.json` (the n8n flow) and the Bing-scraper CSV — then loaded the **`claude-api` skill** to pick the SDK + model correctly.
2. **Enabled the sales role** (`enabled: true`) and added permissions `sales.view`, `leads.contact`, `leads.close`; added a `sales` tab and a new "Sell" nav section.
3. **Built the data + UI:** [lib/data/sales.ts](../../lib/data/sales.ts) (a sales-queue preset of scraped businesses with phone/email/website/rating, an `emailSent` gate, an `engaged` flag, an AI brief, and a rep tally) and [SalesPage.tsx](../../components/apmg/SalesPage.tsx) (the queue: only `emailSent` leads, score tally for Open/Engaged/Won + value, full contact details, the AI brief + talking points, an "Engaged" badge, and permission-gated Mark-contacted / Won / Lost actions).
4. **Attribution endpoint:** [app/t/[id]/route.ts](../../app/t/[id]/route.ts) logs the click, sets first-party `apmg_ref` + `apmg_ref_campaign` cookies (90-day), and 302-redirects. It carries an explicit `TODO(supabase)` to persist the click and flip `engaged`.
5. **AI brief:** [lib/ai/leadSummary.ts](../../lib/ai/leadSummary.ts) uses `@anthropic-ai/sdk` with model `claude-opus-4-8` and a deterministic template fallback when `ANTHROPIC_API_KEY` is unset; exposed via [app/api/sales/summary/route.ts](../../app/api/sales/summary/route.ts) (POST, gated to `sales.view`).
6. **Edited the automation:** fixed the Gmail "Send a message" node (correct recipient, real subject, HTML body) and inserted the tracked CTA link.
7. Installed `@anthropic-ai/sdk` (added to `package.json`).

### "Won" → "Closed" modal + Closed-deals tab
> "Lets change the 'won' button into 'Closed' and a modal will pop up that the Lead was closed and they will have their own tab that has the deals that they closed along with the profile of the lead that was closed. Lets add a note in there as well before they can hit the close button on the Modal…"

Built [SalesProvider.tsx](../../components/apmg/SalesProvider.tsx) (shared state so the queue and the Closed tab see the same closed deals; `closeDeal` stamps a note/value/date), [CloseDealModal.tsx](../../components/apmg/CloseDealModal.tsx) (editable closed value + a **required** closing note — "Close deal" stays disabled until the note is filled; focus-trapped, Escape/backdrop cancel), and [ClosedDealsPage.tsx](../../components/apmg/ClosedDealsPage.tsx) (per-deal lead profile + closing note + tally). Rewrote `SalesPage.tsx` to consume the context and relabel "Won" → "Closed"; added a `closed` tab; mounted `SalesProvider` in `app/page.tsx`.

## Files created / modified

| File | Type | Purpose |
|---|---|---|
| [lib/data/sales.ts](../../lib/data/sales.ts) | created (then extended) | Sales-queue preset + closed-deal note/value/date fields. |
| [components/apmg/SalesPage.tsx](../../components/apmg/SalesPage.tsx) | created (then rewritten) | Rep queue: emailSent gate, tally, contacts, AI brief, Closed/Lost actions. |
| [components/apmg/SalesProvider.tsx](../../components/apmg/SalesProvider.tsx) | created | Shared sales state; `closeDeal` stamps note/value/date. |
| [components/apmg/CloseDealModal.tsx](../../components/apmg/CloseDealModal.tsx) | created | Guided close with a required note (gates the confirm button). |
| [components/apmg/ClosedDealsPage.tsx](../../components/apmg/ClosedDealsPage.tsx) | created | Closed-deals tab: lead profile + closing note + tally. |
| [app/t/[id]/route.ts](../../app/t/[id]/route.ts) | created | Email attribution hook (cookie + redirect; Supabase write is a TODO). |
| [lib/ai/leadSummary.ts](../../lib/ai/leadSummary.ts) | created | Claude (`claude-opus-4-8`) lead-brief generator with deterministic fallback. |
| [app/api/sales/summary/route.ts](../../app/api/sales/summary/route.ts) | created | POST AI-summary route, `sales.view`-gated. |
| [lib/rbac/roles.ts](../../lib/rbac/roles.ts) | modified | Enabled `sales`; added `sales.view`, `leads.contact`, `leads.close`. |
| [lib/nav.ts](../../lib/nav.ts) | modified | Added `sales` + `closed` tabs and a "Sell" nav section. |
| [components/apmg/DashboardShell.tsx](../../components/apmg/DashboardShell.tsx) | modified | Renders the Sales and Closed pages. |
| [app/page.tsx](../../app/page.tsx) | modified | Mounts `SalesProvider`. |
| [references/Leadgen Automation.json](../../references/Leadgen%20Automation.json) | modified | Fixed the Gmail node + inserted the tracked CTA link. |
| [package.json](../../package.json) | modified | Added `@anthropic-ai/sdk` (`^0.106.0`). |

## Key decisions & rationale

- **`emailSent` is the Sales pickup gate; a tracked-link click is attribution.** A lead enters the queue only after the admin's automation email is sent; the `/t/[id]` click flips "Engaged", proving the automation worked — exactly the loop the user described.
- **AI brief via `@anthropic-ai/sdk` + `claude-opus-4-8`, with a graceful fallback.** Model chosen per the `claude-api` skill (`claude-haiku-4-5` noted as a cheaper alternative). The route works without an API key by returning a deterministic template, so the UI is exercisable now.
- **Shared `SalesProvider` for closed deals.** A single context keeps the queue and the Closed tab consistent; the **required closing note** is the durable artifact surfaced on the Closed tab.
- **`apmg-app.vercel.app` baked into the tracked link.** Chosen to map 1:1 to the future `app.apmg.com`, so phase-one links survive the eventual custom-domain switch.
- **Built on permission-first RBAC.** Enabling `sales` and adding its permissions required no enforcement changes — the gates already key off permissions (see [Session 07](07-rbac-permission-first.md)).

## Problems encountered & resolutions

- **Parallel co-editing by the user** (Integrations earlier, then Leads + Pipeline) caused edit collisions; the assistant re-read files before editing and added branches alongside the user's work to avoid clobbering.
- **Transient TS diagnostics** during multi-edit sequences (e.g. a tab id not yet in `TAB_LABEL`, an unused import) — resolved by subsequent edits; the build confirmed clean.

## Verification done

- **`next build` (Next 16.2.9):** clean after the Sales/attribution/AI additions (routes `/t/[id]`, `/api/sales/summary` listed) and again after the Close-modal/Closed-tab work. TypeScript passed each time.
- **Automation JSON** re-validated as parseable (`JSON.parse` via node) after the Gmail-node edit.
- **Playwright screenshots:** `sales-dark` / `sales-light`; `close-modal` (confirm gates on the note) and `closed-tab` (2 closed · $45,500 · $22,750 avg).
- **Not exercised at runtime:** `/t/[id]` and `/api/sales/summary` were not hit live; the AI route was not run against a real Anthropic key (none set) — build/type-check only.

## Outcome & final state

A working **Sales** experience: an `emailSent`-gated queue with contacts + AI briefs, an attribution endpoint that cookies the referral, an edited n8n automation whose email links into that endpoint, and a guided **Closed** flow (required note) feeding a Closed-deals tab — all behind permission-first RBAC. Build green; surfaces verified in dark/light.

## Follow-ups / open items

- **Persist attribution:** `app/t/[id]/route.ts` has `TODO(supabase)` — it currently only logs + cookies; the DB write that flips "Engaged" isn't implemented.
- **Sales/Closed data is preset** ([lib/data/sales.ts](../../lib/data/sales.ts)) with no backend; `closeDeal` state is in-memory only.
- **AI brief** runs on the fallback template until `ANTHROPIC_API_KEY` is set; the route hasn't been exercised live.
- **Real auth** (shared with all server routes): the RBAC server guard is still the placeholder from [Session 07](07-rbac-permission-first.md).
- **Deferred by design:** Google Workspace SSO + per-rep telemetry score tally.
- The tracked link keys the lead by **email** (`{best_contact_email}`); the later [Send Campaigns tab](06-pipeline-send-campaigns.md) switched the tracked id to the Supabase `uuid` for better attribution.

## Verbatim user requests

> Lets build the sales tab - the main logic about this is that the sales tab will pickup whatever the admin says that these are qualified leads that have potential. So the sales team picks this up and we make sure that they have everything they need like Phone Numbers and Emails and all the details that they need and even an AI Prepared summary on what that lead is so when they are calling the lead they can have an idea on what their business is about and etc and so on and so forth. But this only happens once we on admin have already sent the custom email from the automation refer to @references/Leadgen Automation.json that needs editing but yes the thing is we attach a hook on those emails that when they click the link it will be sent to our webpage which has telemetry or cookie or whatever so that we know that the automation worked and that the leads where from the Automation itself. so then the sales reps will close the deals for us and that we would have telemetry setup on their sales account via SSO soon after a google workspace migration. so that we would tally the scores on the leads that they have closed

> Lets change the "won" button into "Closed" and a modal will pop up that the Lead was closed and they will have their own tab that has the deals that they closed along with the profile of the lead that was closed. Lets add a note in there as well before they can hit the close button on the Modal this will ensure that they give us an appropriate notes to remind us for us to be aware on the lead that was closed
