# Session 06 — Pipeline "Send Campaigns (Automation)" sub-tab (tracked outreach → Sales)

> **Session ID:** `63731537-6960-4f79-ac38-8dcc6905171e`
> **Date:** 2026-06-30 local
> **Status:** Shipped. Feature compiles clean (`tsc --noEmit` exit 0). Delivery runs in **demo mode** (simulated send) until `N8N_CAMPAIGN_WEBHOOK_URL` is set; real auth on the send route is an explicit pre-production TODO, consistent with the sibling pipeline routes.
> **Primary tools used:** Read, Glob, Grep, Edit, Write, Bash, Workflow (background adversarial review)
> **Related sessions:** [01-ui-foundation-dashboard.md](./01-ui-foundation-dashboard.md) · [02-integrations-tab-n8n.md](./02-integrations-tab-n8n.md) · [03-api-search-integration.md](./03-api-search-integration.md)

## Objective

> Admin → Pipeline → "lets add another tab asides from leads and call it — Send Campaigns (Automation)".

The Pipeline surface was a single CSV-importer page titled "Leads". The ask: turn it into a two-tab surface and add a **Send Campaigns (Automation)** tab — the natural next step in the established flow (scrape → import → **email outreach** → tracked click → email-gated Sales queue).

## TL;DR

Refactored [PipelinePage.tsx](../../components/apmg/PipelinePage.tsx) into a shell with a sliding-indicator sub-tab bar (ui-standards §11.1, recoloured to the signal accent): **Leads** (the existing importer, now an internal `PipelineLeads`) and **Send Campaigns (Automation)** (new, gated on a new `campaigns.send` permission). The new tab ([SendCampaigns.tsx](../../components/apmg/pipeline/SendCampaigns.tsx)) reuses the importer's n8n step-rail grammar across three nodes — **Audience** (pick stored leads that have an email), **Compose** (subject + HTML body with `{{business}}`/`{{link}}` merge tokens + a live sandboxed `iframe` preview), **Review & send** (animated send with success/error states). A send route ([app/api/pipeline/campaigns/send/route.ts](../../app/api/pipeline/campaigns/send/route.ts)) validates input, rewrites each recipient's CTA to the existing `/t/<leadId>?c=<campaign>` attribution hook, and POSTs to an n8n webhook (or simulates in demo mode). A shared, framework-free module ([lib/pipeline/campaign.ts](../../lib/pipeline/campaign.ts)) renders the email identically on the client preview and the server. A 5-dimension background adversarial review surfaced 26 findings; 3 (all low-severity correctness) survived verification and were fixed.

## What happened

1. **Studied the surface before writing.** Read the importer, `DashboardShell`, `lib/nav.ts`, `Sidebar`, the RBAC model (`permissions.ts`/`roles.ts`/`RbacProvider`/`Can`), the pipeline API routes + `lib/pipeline/server.ts`, the CSV parser, `StoredLeads`/`LeadsTable`/`StepRail`, the `/t/[id]` attribution route, the AI lead-summary, the seed Sales data, and the n8n reference (`references/Leadgen Automation.json`). Confirmed the intended flow: the n8n "Send a message" Gmail node mails a short HTML email whose CTA links to `/t/<best_contact_email>?c=outreach-2026`, and the Sales queue is **`emailSent`-gated** with an `engaged` (clicked) flag.
2. **Read the design grammar.** ui-standards §11/§11.1 (sliding-indicator pills via a shared `layoutId`), §14 (allowed eases + reduced motion), §15/§17.8 (signal-red discipline, **no green**, red text never on a `bg-*/10` tint, white-on-red uses `--primary-solid`). Plus the documentation/session convention in `documentation/README.md`.
3. **Built it.** Shared `lib/pipeline/campaign.ts`; `campaignWebhook()` in `lib/pipeline/server.ts`; the `campaigns.send` permission; the send route; the `SendCampaigns` tab; the `PipelinePage` shell + `SubTabPill`; documented the env vars.
4. **Verified.** `tsc --noEmit` → exit 0. (No ESLint config exists — `next lint` was removed in Next 16 — so `tsc` is the authority.)
5. **Adversarial review (background Workflow).** 5 dimensions (correctness, security, ui-standards, consistency, integration), each finding independently verified. 31 agents, 26 raw findings, **3 confirmed** — all low-severity correctness issues in the new component. Fixed all three; re-ran `tsc` green.

## Files created / modified

| File | Type | Purpose |
|---|---|---|
| [lib/pipeline/campaign.ts](../../lib/pipeline/campaign.ts) | created | Framework-free template + helpers shared by the client preview and the server render: `DEFAULT_*` copy (from the n8n email), `bestEmail()` (prefers info@/contact@/sales@), `safeCampaignTag()`/`slugifyCampaign()`, `trackedLink()`, `renderBody()` (escapes the business name), `renderSubject()`, `MAX_RECIPIENTS`. |
| [app/api/pipeline/campaigns/send/route.ts](../../app/api/pipeline/campaigns/send/route.ts) | created | Node-runtime POST: same-origin floor, validates campaign/subject/body/recipients, sanitizes + de-dupes recipients by address, renders each personalized message with a tracked CTA, then POSTs `{campaign, messages:[{to,subject,html,leadId}]}` to the n8n webhook — or simulates a send in demo mode. |
| [components/apmg/pipeline/SendCampaigns.tsx](../../components/apmg/pipeline/SendCampaigns.tsx) | created | The tab UI: a 3-node step rail (Audience → Compose → Review & send) reusing `LeadsTableView`/`StepRail`/`Reveal`/`Footer`; folder + search filtering of emailable leads; a sandboxed `iframe` email preview; an eased send-progress count-up with success/error panels. |
| [components/apmg/PipelinePage.tsx](../../components/apmg/PipelinePage.tsx) | modified | Refactored into a shell: the importer became internal `PipelineLeads`; added the sliding-indicator `SubTabPill` row and the `AnimatePresence` swap between the two sub-views. Campaign tab gated on `campaigns.send`. The importer body (incl. the user's live-edited stats header) was left untouched. |
| [lib/pipeline/server.ts](../../lib/pipeline/server.ts) | modified | Added `campaignWebhook()` — resolves `N8N_CAMPAIGN_WEBHOOK_URL` or returns demo, mirroring `supabaseTarget()`. |
| [lib/rbac/permissions.ts](../../lib/rbac/permissions.ts) | modified | Added the `campaigns.send` permission (admin holds it via `ALL_PERMISSIONS`; future roles can be granted it without touching enforcement). |
| [.env.local.example](../../.env.local.example) | modified | Documented `N8N_CAMPAIGN_WEBHOOK_URL` (delivery webhook; unset = demo mode) and optional `NEXT_PUBLIC_TRACK_BASE` (host the tracked links point at). |

## Key decisions & rationale

- **Sub-tab inside Pipeline, not a new top-level tab.** The request was explicit ("another tab asides from leads"), and Pipeline is already admin-gated (`pipeline.view`), so the campaign tool inherits that gate.
- **Permission-first gating.** Added a dedicated `campaigns.send` permission rather than reusing the existing `campaigns.view`. Sending is a stronger capability than viewing, and the codebase's RBAC philosophy is to check a permission, never a role — so the new capability is pure data. The sub-tab pill and the send button both gate on it.
- **Single source of truth for the email.** `campaign.ts` is pure and runs in both places, so the live preview is byte-for-byte what the server sends. The business name is HTML-escaped; the tracked link is built (not user-supplied) and inserted verbatim.
- **Attribution reuses the existing `/t/<id>` hook.** Recipients carry the DB `uuid` as the tracked id (better attribution than the email the n8n sheet path used), so a click flips the lead's engaged state and feeds the email-gated Sales queue — closing the scrape → email → Sales loop.
- **Demo mode parity with the importer.** No webhook configured ⇒ simulated success, exactly like the CSV importer without Supabase creds, so the whole flow is exercisable before n8n is wired.
- **Sandboxed `iframe` preview.** The body is admin-authored HTML; rendering it in `sandbox=""` `srcDoc` isolates it from the app DOM and reads like a real email client.
- **Left the importer header alone.** The user was live-editing it (added `useLeadStats` stats). The shell only renames + wraps the importer; zero churn to their in-flight work.

## Problems encountered & resolutions

- **No linter.** `next lint` is removed in Next 16 and the repo has no flat ESLint config, so verification leans on `tsc --noEmit` (green) plus the adversarial review.
- **`React.X` type references.** The first draft used `React.ReactNode`/`React.MutableRefObject`; switched to importing the types from `"react"` to match the codebase convention (every sibling file imports `type ReactNode`).
- **Adversarial review — 3 confirmed low-severity fixes (all in `SendCampaigns.tsx`):**
  - **Progress bar could stall below 100%.** The bar filled toward the client's optimistic count while the count-up targeted the server's actual `sent` (which de-dupes by address). Added a `sendTotal` denominator that snaps to the response, so the bar reaches 100%.
  - **Step rail was clickable mid-send.** A user could navigate off the sending panel and edit the selection, diverging the live counts from what was actually sent (the send itself was always correct — `recipients` is captured at call time). Locked navigation to the send node while `sending`.
  - **`MAX_RECIPIENTS` imported but unused.** Turned the dead import into a real client-side guard: the Audience "Compose" button and the Review "Send" button disable (with a warning) when the selection exceeds the cap, so the user is told before the server would 413.
- **Review noise vs. signal.** 26 raw findings → 3 confirmed; nothing in security, ui-standards, or integration survived verification.

## Outcome & final state

- **Shipped and compiling.** Pipeline is now a two-tab surface; the **Send Campaigns (Automation)** tab runs a full Audience → Compose → Review & send flow in the house n8n grammar.
- **Wiring is sound end-to-end:** client payload matches the route contract; preview and server render share one module; tracked links match `/t/[id]`; demo mode returns success without a webhook.
- **Runs in demo mode by default** — set `N8N_CAMPAIGN_WEBHOOK_URL` (and optionally `NEXT_PUBLIC_TRACK_BASE`) to deliver for real.
- **Unverified:** the live n8n webhook delivery path has not been exercised end-to-end (no webhook in-session), and persisting `email_sent`/`engaged` to Supabase remains a documented TODO (the seed Sales data is still mock).

## Follow-ups / open items

- **Add real auth to the send route** before exposing it — currently a same-origin floor only, like the sibling pipeline routes. The UI gates on `campaigns.send`; enforce it server-side once auth lands.
- **Persist attribution.** Wire the `/t/[id]` click and a live send to set `leads.email_sent`/`engaged` so the Sales-queue gate is real, not seed data (TODOs are in both routes).
- **Point `N8N_CAMPAIGN_WEBHOOK_URL`** at a Webhook-trigger node fronting the "Send a message" Gmail node in `references/Leadgen Automation.json`, then verify a real send.

## Verbatim user request

> Admin - Pipeline - lets add another tab asides from leads and call it - Send Campaigns (Automation)
