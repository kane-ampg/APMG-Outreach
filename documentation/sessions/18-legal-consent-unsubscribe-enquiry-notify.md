# Session 18 — Legal consent gate, unsubscribe suppression, enquiry notification & host-wall

> **Session ID:** `f3d79704-a60d-44a1-b530-4b20b82b03a1`
> **Date:** 2026-07-12
> **Status:** Shipped (code + live tests), with several manual/ops steps still on the user

## Objective
Turn the customer-facing portal (`customers-apmg-services.vercel.app`) into something that can safely take real cold-outreach traffic and abide by Australian law. Across a long, multi-day thread this meant: sorting the sending domain / deliverability story, walling the admin panel off the customer host, adding a Spam Act-compliant unsubscribe flow, adding a Privacy Act / APP-shaped consent gate on enquiries, tailoring the email CTA per lead, and emailing each new enquiry to a configurable notification address.

## TL;DR
- **Domain / deliverability** was advisory only — no DNS or provider access from here. Landed on: register `apmgmaintenance.com.au`, go straight to **Google Workspace** (skip Microsoft, since a 2-month migration is coming and reputation can't transfer), warm up slowly, SPF/DKIM/DMARC with Zac/IT. Several boss/Zac/IT message drafts were written. **Nothing was set up** — it's sitting with IT.
- **Host-wall middleware** (`middleware.ts`) was written and typechecked to lock the customer host to portal-only. A live probe confirmed the hole was **real** — `/` served the full admin dashboard and `/api/pipeline/leads` returned 200 unauthenticated on the public customer domain. The fix is **in code but only protects once deployed** to that Vercel project.
- **Unsubscribe** flow built end-to-end (SQL suppression table, `/api/portal/unsubscribe` GET + confirmation page, send-route filtering, n8n footer link). It went through a painful multi-round debug: the footer link kept not appearing because (a) n8n runs its *saved* copy so the file had to be re-pasted, and (b) a **brittle regex** derived the unsubscribe host by scraping a `/t/` link out of the body — fixed by falling back to a configured `portalBase`. Later restyled from a text link into a proper button.
- **Consent gate** built at enquiry-time, **fail-closed and server-authoritative**: PII is only stored when a real published policy exists and the *current* version is accepted. Versioned docs live in `app_settings`, editable via a new admin **Legal Documents** tab with a live preview. Verified live with four branch tests (valid / no-consent / stale-version / honeypot) — only the valid one stored a row, stamped with `consent_version`.
- **Enquiry notification email** — configurable address on the Integrations page, fires fire-and-forget to an n8n "Enquiry Notification" webhook after a stored enquiry. Stored in `app_settings` (**no migration**, by deliberate decision). **Tested live** end to end.
- **Tailored Aussie CTA** — per-category button labels (Healthcare → "Healthcare property, sorted") in both the AI compose path and the deterministic template fallback.
- Also: an **Aussie-slang UserPromptSubmit hook** wired into `~/.claude/settings.json` for Zac/PM messages, and outreach drafts against real (law-firm) leads pulled from Supabase.

## Narrative
The session opened on "Zac has the domain, what's next?" The one live-loop placeholder was the tracked-link host (`apmg-app.vercel.app`); the real domain surfaced as `apmgmaintenance.com.au`. The env var `NEXT_PUBLIC_TRACK_BASE` is the single source of truth, so only docs/examples and the n8n workflow JSON carried the placeholder — those were updated; the company's real `apmgservices.com.au` brand surfaces (logo, footer, contacts) were deliberately left alone.

A long deliverability advisory followed. The user oscillated Microsoft → Google → "migration takes 2 months," and the settled answer was: skip Microsoft entirely, stand the outreach domain up on Google Workspace, warm slowly, and get SPF/DKIM/DMARC done with Zac/IT. Multiple message drafts (to the boss, to Zac, to IT) were produced in progressively more informal Aussie tone. This part is **advisory** — no infra was touched. A `UserPromptSubmit` hook was added so future "message to Zac/the PM" requests auto-apply Australian tone; `jq` wasn't available in Git Bash so the prompt extraction fell back to `sed`.

The user then wanted to start emailing leads. Real leads were pulled from Supabase — first 6 test rows, then a 53-row batch of **Melbourne law firms** (only ~13 with emails, many of those junk addresses the scraper had hoovered up). The plan shifted several times: personal-email-by-hand → in-app Compose → full n8n automation. A paste-ready campaign-send workflow was regenerated (clean JSON, no baked credentials/pinData), and the app→n8n→Gmail chain was eventually confirmed working via the Integrations-tab webhook path.

Attention turned to the customer portal's safety. A live probe **confirmed** the admin dashboard and lead API were wide open on the public customer domain. `middleware.ts` was written to wall the customer host to portal-only, verified by unit-testing the decision functions and typechecking under the project config — but it only protects once deployed.

The compliance block was the heart of the session. The generic CTA was replaced with per-category Aussie labels. Then the **Spam Act 2003** unsubscribe requirement drove a full opt-out flow. Then the user asked for an **Australian-law consent prompt** tied to "our progress in here, not some generic message," detectable in telemetry "in case of a lawyer suing us" (the prospects being lawyers). The design landed on a **soft, enquiry-time, fail-closed, server-authoritative** gate with versioned docs in `app_settings`, an admin editor tab, a live preview, and version pinning / re-consent. It was verified with a live four-branch test. Company identity was centralised into `lib/legal/company.ts` with ABN held back as an explicit `null`/"TBC" (never invented).

The unsubscribe link then became a multi-round debugging saga — the link kept not appearing in delivered emails. Root causes, owned honestly: n8n runs its saved copy (file edits require a re-paste), and the unsubscribe URL was derived by a fragile regex scraping a `(https://.../t/...)` link from the body; when the CTA wasn't in that exact shape it silently dropped. Fixed with a `portalBase` fallback so it always renders, then restyled into a muted secondary button.

Finally, the enquiry-notification email: after a stored enquiry, the route fires (fire-and-forget, bounded timeout, all errors swallowed) to a configurable n8n notify webhook that emails the enquiry to an address set on the Integrations page. The user had asked for a migration; the honest answer was none is needed (it's one `app_settings` key), which was flagged deliberately in a code comment. Tested live — enquiry → stored with consent → notification email arrived.

The session closed by reconciling memory: the user had built an overlapping page-entry `PortalConsentGate.tsx` + real AU Privacy-Act seed **in parallel**, so two divergent memory files were merged into one accurate `portal-consent-compliance.md` (correcting that the *live* seeded version was the `test-full-2026-07-12` placeholder, not the user's `2026-07-12` real docs).

## Files touched
| File | Change | Why |
|------|--------|-----|
| `middleware.ts` | New host-wall: customer host → portal-only, admin paths redirect to `/portal`, `/api/pipeline/*` & `/api/sales/*` → 404 | Close the confirmed open-admin-panel hole on the public customer domain |
| `lib/legal/legalDocs.ts` | New: shared consent types, version rules, parse, `DEFAULT_LEGAL_DOCS` placeholder | Client+server-safe legal-doc model (no `server-only`) |
| `lib/legal/legalStore.ts` | New: server accessor for versioned legal docs (mirrors sectorStore) | Read/write `legal_docs` in `app_settings` |
| `lib/legal/company.ts` | New: single source of truth for company identity (name, contact, address, `abn: null`) | Consistent sender identity; ABN never fabricated |
| `app/api/portal/legal/route.ts` | New: public GET of current terms/privacy + version (customer-host allowed) | Modal fetches the exact text/version being agreed to |
| `app/api/legal/route.ts` | New: admin PUT to publish/bump legal docs (server-stamped `updatedAt`) | Legal Documents editor save path |
| `app/api/portal/inquiries/route.ts` | Server-side fail-closed consent enforcement; store `consent_version` on row + `portal_inquiry` event; fire enquiry notification | Legal crux — only store PII with valid current consent; ping notify address |
| `app/api/portal/unsubscribe/route.ts` | New: GET opt-out by email + confirmation page; sender-identity footer | Spam Act functional unsubscribe |
| `components/apmg/ServiceInquiryModal.tsx` | Consent checkbox (unticked, gates submit), inline expandable T&C/Privacy, `consent_accept` telemetry (standalone-only), threads `consentVersion`; raised expander cap for long docs; company-identity copy | Customer-facing consent capture |
| `components/apmg/ServicesPortal.tsx` | Thread `standalone` into the modal | Host-discrimination rule for the consent telemetry event |
| `components/apmg/LegalDocsPage.tsx` | New admin editor: version + terms/privacy textareas, dirty/save, placeholder-refused warning, live consent-modal preview | Paste lawyer-reviewed wording + bump version |
| `components/apmg/IntegrationsPage.tsx` | New "Enquiry Notification email" field/panel + notify webhook card | Configure where enquiries get emailed |
| `components/apmg/DashboardShell.tsx` | Wire Legal Documents tab into the render switch | Surface the new admin page |
| `lib/nav.ts` | Add Legal Documents nav entry (+ `ScrollText` icon) | Navigation for the editor |
| `lib/rbac/permissions.ts` | Add `legal.view` / `legal.manage` (admin auto-granted via `ALL_PERMISSIONS`) | Gate the editor |
| `lib/pipeline/server.ts` | Notify setting keys + `enquiryNotifyWebhook()` resolver | Resolve enquiry-notify config |
| `lib/pipeline/campaign.ts` | New `ctaLabel()` (Aussie per-category), replace hardcoded CTA text in `demoDraft` + `ensureLinkToken` | Tailored CTA (template/fallback path) |
| `lib/ai/composePrompt.ts` | New CTA-label instruction with per-category examples | Tailored CTA (AI path) |
| `lib/data/integrations.ts` | Register Enquiry Notification integration; fix stale campaign-workflow filename reference | Integrations registry |
| `app/api/integrations/route.ts` | Handle `notifyEmail` save; expose it in GET | Persist notify address to `app_settings` |
| `lib/portal/server.ts` | Suppression helpers (record opt-out, batch-check emails); `consentVersion` on `PortalInquiry` + mapper | Unsubscribe filtering + expose consent version to admin |
| `supabase/consent.sql` | New: `ADD COLUMN IF NOT EXISTS consent_version` on `portal_inquiries` | Store agreed version (user runs it) |
| `supabase/unsubscribe.sql` | New: `email_suppression` table | Suppression store (user runs it) |
| `email.html` | Update sample email domain to the real one | Avoid a stale link if pasted into n8n |
| `references/Leadgen Automation.json` | Swap placeholder domain in Gmail-node email HTML | Remove baked placeholder |
| `references/APMG-SplitMessages-node.js` | Extracted/updated Split Messages code: unsubscribe link with `portalBase` fallback, then styled as a button | Paste-source for n8n node fix |
| `.env.local` | Add `NEXT_PUBLIC_TRACK_BASE=https://customers-apmg-services.vercel.app` | Point tracked links at the live portal (local dev) |
| `.env.local.example` | Update documented placeholder domain | Docs |
| `~/.claude/settings.json` | Add second `UserPromptSubmit` hook (Aussie tone for Zac/PM messages), merged with existing GitKraken hook | Automatic behaviour on prompt submit |
| `~/.claude/hooks/aussie-message-tone.sh` | New hook script (sed-based prompt parse, gated on verb + Zac/PM mention) | Hook implementation (`jq` unavailable) |
| `~/.claude/.../memory/portal-consent-compliance.md` | New merged compliance memory (folds in user's parallel page-entry gate) | Accurate cross-session record |
| `~/.claude/.../memory/MEMORY.md` | Replace stale `portal-legal-consent` index line | Point at merged memory |
| scratchpad: `apmg-outreach-drafts.md`, `build_notify_wf.py`, `condense.py`, `seed_legal_full.py` | Working files (drafts, workflow build, seeding) | Intermediate artefacts, not repo product |

> Note: the digest's FILES TOUCHED list also shows the two new paste-ready workflow JSONs (`APMG Campaign Send (clean).json`, `APMG Enquiry Notification.json`) being produced/edited under `references/`; they were built and validated in-session. The user's parallel `PortalConsentGate.tsx` and `supabase/legal-docs-seed.sql` were **written by the user**, not this session, and are noted here only because the compliance memory folds them in.

## Key decisions
- **Skip Microsoft, go straight to Google Workspace** for the outreach domain — reputation can't transfer across providers and a full Google migration is ~2 months out, so M365 setup would be thrown away.
- **Sending domain ≠ hosting domain.** `apmgmaintenance.com.au` = the `From:`/auth domain (IT/Google, later). The CTA/tracking link only needs the **hosting** URL, which the Vercel portal already provides today.
- **Soft gate at enquiry, not a hard page-entry gate** — consent captured at the moment PII is collected, keeping the portal viewable so cold-outreach conversion isn't killed. (The user separately added a page-entry ack gate in parallel.)
- **Server-authoritative, fail-closed consent.** The server re-validates the submitted version against the live published one and refuses to store PII on any mismatch/absence — the client checkbox is not trusted as proof.
- **ABN held back deliberately** — rendered as "TBC"/`null`, never invented, because a wrong ABN on a legal surface is worse than none.
- **Notification email stored in `app_settings`, no migration** — one config value in an existing key-value table; a dedicated table/column would be dead weight. Flagged in a code comment because the user had asked for a migration.
- **Unsubscribe must not depend on scraping the body** — derive the host from a configured `portalBase` fallback so it always renders.
- **Integrations tab is the preferred webhook source** — `campaignWebhook()` resolves app_settings → env → demo, so runtime config beats env vars (no restart).

## Problems hit
- **Confirmed security hole:** `/` served the full admin dashboard and `/api/pipeline/leads` returned 200 unauthenticated on the public customer domain (auth still defaults everyone to admin). Fixed in `middleware.ts` — but **only protects once deployed** to the customer Vercel project.
- **Unsubscribe link kept not appearing** across multiple screenshots. Two compounding causes: n8n runs its **saved** copy (file edits need a re-paste into the Split Messages node), and a **brittle regex** that scraped the unsubscribe host from a `(…/t/…)` link in the body silently dropped when the CTA wasn't in that exact shape. Self-critique owned: the original "verified" test used a hand-built happy-path payload; adversarial cases (no `/t/`, unwrapped URL, raw HTML) only ran after the third pushback.
- **Gmail node missing `emailType: html`** in the user's live n8n export — worked by Gmail auto-detection but latent; flagged for a one-dropdown fix.
- **App send was in demo mode** for much of the session — `N8N_CAMPAIGN_WEBHOOK_URL` unset, so app "sent" was simulated; test emails the user saw came from running n8n directly.
- **Broad test-cleanup delete** owned honestly: an events DELETE filtered on date + service rather than a unique test marker; happened to be safe (no real electrical enquiries that day) but could have deleted a genuine event.
- **`jq` unavailable** in Git Bash broke the first hook script; fell back to `sed`.
- **Scraper data quality** — only ~13/53 law-firm leads had emails, many of those junk (Brazilian addresses, unrelated Gmails); dropped from drafting.
- **Parallel edits / duplicate memory** — the user was co-editing the same feature; two overlapping memory files were merged and the stale one deleted.

## Outcome
Consent gate, unsubscribe flow, enquiry notification, tailored CTA, host-wall middleware, and centralised company identity are all **built, typecheck clean, and pass a production build**. The consent fail-closed logic and the enquiry-notification path were **tested live** against the running app + Supabase + n8n, with test data cleaned up. The unsubscribe button renders in all body shapes after the `portalBase` fix.

Still **not done** (on the user / ops): deploy `middleware.ts` to the customer Vercel project (the live hole is still open until then); set env vars on that Vercel project and redeploy; run any not-yet-run SQL; re-paste the latest Split Messages code into n8n and set `emailType: html`; replace the seeded **placeholder** legal docs (`test-full-2026-07-12`) with lawyer-reviewed wording and supply the real legal entity + ABN; and complete the domain/deliverability setup with IT/Google. The whole scrape→email→portal→enquiry→notify loop was demonstrated working, but real sends were explicitly gated on the domain and warm-up being sorted.

## Follow-ups
- **Deploy the middleware** to `customers-apmg-services.vercel.app` and re-probe (`/` should redirect, `/api/pipeline/leads` should 404). Until then the admin panel is open on a public URL.
- Set `NEXT_PUBLIC_TRACK_BASE`, `NEXT_PUBLIC_TRACK_DESTINATION=/portal`, Supabase vars, telemetry endpoint, `PORTAL_ADMIN_KEY`, and `CUSTOMER_PORTAL_HOSTS` on the customer Vercel project, then redeploy.
- Replace placeholder legal docs with lawyer-reviewed T&C + Privacy Policy; supply the registered entity name + ABN so `company.ts` and every legal surface drop the "TBC".
- Re-paste the current `APMG-SplitMessages-node.js` into n8n and set the Gmail node's `emailType` to HTML.
- Finish the sending-domain setup on Google Workspace (SPF/DKIM/DMARC) with Zac/IT; warm up slowly before real volume.
- Decide whether the CTA/link domain should ultimately be on a company domain (subdomain of `apmgmaintenance.com.au`) rather than the `*.vercel.app` host, which reads as less legitimate to cautious recipients.
- Consider deleting the redundant `references/Campaign Send Automation.json` in favour of the clean workflow file.

### Where these follow-ups went
*(Added 2026-07-30. This doc is the origin of most of the project's standing ops debt and had no forward pointers; two of its paths have also gone stale.)*

| Follow-up | Status now | Doc |
|---|---|---|
| Deploy the middleware to the customer host and re-probe | **Still unverified.** No session has ever observed a green production build on the customer project. `middleware.ts` is committed and its `CUSTOMER_HOSTS` default already hardcodes `customers-apmg-services.vercel.app`, so no env var is needed for that hostname — but nothing proves the deployed build carries it | [24](24-portal-social-source-attribution.md), [25](25-portal-socials-legal-modal.md), [26](26-vercel-build-failure-fix.md), [27](27-status-report-for-stakeholders.md) |
| Env vars incl. `CUSTOMER_PORTAL_HOSTS` on the customer project | Still open — and now **load-bearing for a security hole**: the host wall fails *open* for unrecognised hosts, so a branded customer domain attached without being added here would expose the admin console | [31](31-vercel-custom-domains.md) |
| Lawyer-reviewed T&C + Privacy; registered entity + ABN | **Still open.** `COMPANY.legalEntity` and `COMPANY.abn` are both still `null` in `lib/legal/company.ts`. Consequence verified in code: while the published legal row is a placeholder, the enquiry route refuses to store PII at all | [19](19-portal-trust-cro-overhaul.md), [25](25-portal-socials-legal-modal.md), [27](27-status-report-for-stakeholders.md) |
| Re-paste the Split Messages node; Gmail `emailType` HTML | **Still open, and the path in this row is stale.** `references/APMG-SplitMessages-node.js` was renamed to **`references/split-messages.node.js`**. `emailType: "html"` is set on the `Send Plain` node in the committed workflow. The paste is still owed — the per-service hero swap added later is inert until it happens, and it must go to **`apmgau.app.n8n.cloud`**, not the dead `apmg.app.n8n.cloud` in `N8N_BASE_URL` | [30](30-service-campaign-templates.md), [32](32-outreach-email-authentication-setup.md) |
| SPF/DKIM/DMARC on Google Workspace + warm-up | **Largely done.** The `outreach@apmgmaintenance.com.au` mailbox was provisioned 2026-07-29; SPF, DKIM (2048-bit) and DMARC (`p=none`) are verified live against two resolvers. Outstanding: no DMARC `rua=`, no confirmation Google is actually *signing* (no test-send header check), and the ~3–4 week warm-up ramp has not started | [29](29-outreach-mailbox-provisioned.md), [32](32-outreach-email-authentication-setup.md) |
| Move the CTA/link domain off `*.vercel.app` | **Attempted and failed.** Nothing is live: the records landed on the wrong zone and the verify TXT was malformed. Note the target also silently changed — this doc named a subdomain of `apmgmaintenance.com.au`; the attempt used `apmgservices.com.au`, which is already on a *different* Vercel account. `NEXT_PUBLIC_TRACK_BASE` is unchanged | [31](31-vercel-custom-domains.md), [32](32-outreach-email-authentication-setup.md) |
| Delete the redundant `references/Campaign Send Automation.json` | **Done.** The file is gone; `references/` now holds `APMG Campaign Send (clean).json`, `APMG Email Finder.json`, `APMG Enquiry Notification.json` and `Leadgen Automation.json`. (That last one is a stale workflow that may still be **active on an unknown Gmail credential** — a new item, not this doc's) | [32](32-outreach-email-authentication-setup.md) |
| The enquiry-notification address | Extended into a **recipient list** (`MAX_NOTIFY_EMAILS = 10`, one comma-joined send), same `app_settings` key, still no migration — consistent with this doc's decision. The old single-address regex here turned out to make *any* two-address value unsaveable | [29](29-outreach-mailbox-provisioned.md) |
| The entry-time consent gate built here | **Unmounted** on trust/CRO grounds; `PortalConsentGate.tsx` is kept in the repo, unreferenced. The enquiry-time, fail-closed, server-authoritative gate this doc built was left exactly as-is | [19](19-portal-trust-cro-overhaul.md) |
| `N8N_WEBHOOK_SECRET` / webhook auth | **Still unset**, so the live campaign webhook is anonymous — anyone who learns the URL can trigger a send. Nothing paces the send either (`MAX_RECIPIENTS = 1000`, no Wait/Loop node) | [32](32-outreach-email-authentication-setup.md) |

## Verbatim user requests
- "Zac already has the domain we need already so whats next?"
- "the thing is that I wanna measure the reputation so we dont get spammed how do I connect that to the WTKDTJGT"
- "what if we have Microsoft Environment first?"
- "can we change soon to Google?"
- "can you write this is as if I was telling my boss? - apmgmaintenance.com.au"
- "make it very ssmall please"
- "No AI em dashes please -"
- "make it informal please"
- "they are migrating and its gonna take 2 months though"
- "so like if there is a message we can send to the IT Team to hurry it up or like prioritize it where we just setup the domain first and migrate later?"
- "okay structure it like Im telling this to Zac but zac should inform the IT Team that this is separate"
- "add a skill where when I ask to give me e message to Zac or the PM we should use Australiaan slang please"
- "Okay now we wait"
- "Okay good but how about I start emailing someone using my corporate email first?"
- "I have 54 leads"
- "Now I want the UI we created to create the emails not you lol I want the pipeline to do it"
- "give me a new n8n automation I can copy paste to the canvass"
- "This is now the customer facing portals link - customers-apmg-services.vercel.app I created it on vercel so lets do that"
- "The thing is that I dont want them to have access to the ADMIN Panel and get smart about it"
- "change the button please depending on their business make it tailored something like - their Category then it goes like this \"Healthcare construction needs here\" something like that make the AI claude do that in the background as part of the tailoring. See a bit more about what we do is abit off. I want it in aussie accent as well but make it short and crisp"
- "For the customer facing portal I want to make sure that we abide by the Australian Laws so make sure that when the clients reach their they will agree to a terms and conditions prompt in there and privacy policy that is dependent on our progress in here and not some generic message also make sure that we detect that in the telemetry so we would know that they have clicked there and in case of a lawyer suing us"
- "the legal business name is there already however for the ABN lets not put it yet"
- "fuck this I want the long one! fucker"
- "make the modal preview long as well"
- "Now lets test?"
- "the payload did not send the unsubscribe link -"
- "so i f I send I new one this will send it properly ?"
- "do we need to update the integrations tab?"
- "so I will now see an unsubscribe button on the email payload we send?"
- "I want the enquire services modal when the buttons send enquiry we will send it an email set from the Integrations page where I can set my email in there and all the enquiries will be sent to that email where I set it make sure we have an SQL migration for this"
- "I want the button to be a button please -  not that link stuff"
- "Fully working we did it brother!"
- "now I want you to do record the past 10 claude sessions and document everything"
