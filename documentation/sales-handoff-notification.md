# Sales hand-off notification — emailing the desk when a lead is sent to Sales

Written 2026-08-23. Built this session. **Not yet tested end-to-end** — the n8n
workflow has not been imported and no notification has been sent. See
[Still to do](#still-to-do).

## What it does

When an admin presses **Send to Sales** on the Hot Leads tab, the people on the
notification list get one email per hand-off saying who was sent over and *why
they were worth sending* — the intent score, the prose brief, the talking
points, and the dated trail of what the lead actually did on the portal.

The gap it fills: the hand-off is the only gate on the Sales queue, but nothing
told the desk a hand-off had happened. A rep found out by opening the console
and noticing the badge. Handed-over leads have almost never enquired (0 of the
first 4 did), so the entire signal is a click trail that goes cold in hours.

## The path

```
Hot Leads → "Send to Sales"
  POST /api/sales/handoff  { leadIds, kind: "handoff" }
    ├─ writes one `sales_handoff` row per NEWLY marked lead   (portal_events)
    └─ lib/sales/handoffNotify.ts  notifySalesHandoff(fresh ids)
         ├─ recipients ← app_settings.enquiry_notify_email
         ├─ webhook    ← app_settings.n8n_sales_notify_webhook_url
         ├─ per lead: lib/portal/leadBrief.ts  (lead row + click trail)
         │              → buildLeadFacts → fallbackSummary + talkingPoints
         │              → leadScore (the Hot Leads number)
         └─ POST { type: "sales_handoff", … } →
               n8n  /webhook/sales-handoff-notify
                 → Format Handoff (code node) → Gmail → 200 {ok:true}
```

### Decisions worth knowing

**Only newly-marked leads are notified.** Marking is idempotent, so a
double-click, a stale tab or a retry re-POSTs the same lead ids and marks
nothing new — and therefore emails nobody. A notification a rep learns to
ignore is worse than no notification.

**One email per hand-off, not per lead.** A hand-off may mark up to 200 leads.
Up to 20 are briefed in full, the rest are counted in a `+N more` line. Every
recipient rides on one `To:` header, so a list of ten addresses is one Gmail
send, not ten — the same rule the enquiry notifier follows, for the same reason
(the mailbox's daily cap).

**The facts are re-read server-side, never taken from the request.** The
notifier reads the lead row and its trail back out of Supabase through
`lib/portal/leadBrief.ts` — the same module `/api/portal/lead-summary` now uses.
That is deliberate: the email and the console brief are claims about the same
customer to the same rep, and they must not be able to disagree. Both were
copies of the same code until this session; they are now one copy.

**The prose is the deterministic summary, not the AI one.** `fallbackSummary()`
off the same facts. The AI brief (`lib/ai/enquirySummary.ts`) is a metered spend
surface with a daily cap and a per-lead memo; spending it on an admin's click,
for an email, would burn the cap the rep needs when they open the lead. The rep
gets the AI brief in the console.

**It cannot break a hand-off.** Every failure path inside the notifier is
swallowed and logged, and the marks are already durable before it runs. It is
`await`ed rather than fire-and-forget only because a serverless runtime is free
to kill the invocation the moment the response returns — which would silently
drop the notification on precisely the busiest hand-offs.

**A separate webhook from the enquiry notifier.** The two payloads are not
interchangeable, and sharing one URL would mean a not-yet-re-imported workflow
answered hand-offs with the enquiry formatter — an email with every field blank.
They *do* share the recipient list: same internal audience.

## Setup (n8n side, ~5 minutes)

1. Import `references/APMG Sales Handoff Notification.json` into
   `https://apmgau.app.n8n.cloud`.
2. Open **Send To Sales Desk** (Gmail) and confirm the credential is
   *APMG - Official Lead Gen Mail*.
3. Copy the **production** webhook URL off the **Lead Sent To Sales** node.
4. Console → **Integrations** → *Sales Hand-off Notification* → **Add webhook**,
   paste it. (Or set `N8N_SALES_NOTIFY_WEBHOOK_URL` in the app env.)
5. Confirm at least one address under **Enquiry notification emails** on the
   same tab. With none set, the app skips the send silently.
6. **Activate** the workflow.
7. Add a **Header Auth** credential (`x-apmg-secret`) on the webhook node —
   the app already sends the header whenever `N8N_WEBHOOK_SECRET` is set, and
   the endpoint is open to anonymous callers until n8n checks it. Same
   outstanding item as the enquiry notifier.

The code node's source is also kept as a readable file at
`references/format-sales-handoff.node.js` — edit that, then paste it into the
node (the same convention as `references/split-messages.node.js`).

## The payload

```jsonc
{
  "type": "sales_handoff",          // the workflow refuses anything else
  "version": 1,
  "notifyTo": "a@apmg.com.au, b@apmg.com.au",   // canonical, comma+space
  "handedOverAt": "2026-08-23T09:12:00.000Z",
  "handedOverBy": { "email": "…", "role": "admin", "actingAs": null },
  "consoleUrl": "https://admin.apmgservices.com.au",
  "totalLeads": 3,                  // leads.length may be smaller (cap of 20)
  "leads": [{
    "leadId": "uuid",
    "business": "…", "contactName": null, "email": "…", "phone": "…",
    "website": "…", "sector": "…", "campaign": "…",
    "score": 74, "band": "Hot",     // lib/data/leadScore — why it was hot
    "summary": "…",                 // fallbackSummary() prose
    "talkingPoints": ["…"],
    "activity": { "emailClicks": 2, "packDownloads": 1, "portalViews": 3,
                  "serviceOpens": 4, "chatPrompts": 1, "enquiries": 0,
                  "consented": true, "daysActive": 2, "returned": true,
                  "steps": 11, "services": [{ "service": "plumbing", "opens": 3 }],
                  "firstSeen": "…", "lastSeen": "…" },
    "timeline": [{ "ts": "…", "label": "Clicked the email link" }]
  }]
}
```

`consoleUrl` is taken from the admin's own `Origin` header (already proved
same-origin by the route), so it is correct on production, preview and
localhost with nothing to configure. The email links to the console root — tab
navigation is client state, so there is no deep link to the Sales tab; the email
says "then choose Sales in the sidebar".

## Files

| File | What |
|---|---|
| `lib/sales/handoffNotify.ts` | builds the payload, fires the webhook. New. |
| `lib/sales/handoffNotify.test.ts` | 15 tests: gating, payload, cap, never-throws. New. |
| `lib/portal/leadBrief.ts` | `readLeadSubject` + `readTrail`, extracted from `/api/portal/lead-summary` so both surfaces read the same rows. New. |
| `app/api/portal/lead-summary/route.ts` | now imports those two instead of holding its own copies. |
| `app/api/sales/handoff/route.ts` | fires the notifier for `fresh` hand-offs only. |
| `lib/pipeline/server.ts` | `SETTING_SALES_NOTIFY_WEBHOOK` / `_ENABLED` + `salesNotifyWebhook()`. |
| `lib/data/integrations.ts` | the 4th Integrations row. |
| `components/apmg/IntegrationsPage.tsx` | copy only — the recipient list now feeds two automations. |
| `references/APMG Sales Handoff Notification.json` | the n8n workflow to import. New. |
| `references/format-sales-handoff.node.js` | the code node's readable source. New. |

Verified with `tsc --noEmit`, `vitest run` (307 passing) and `next build`. The
code node was additionally run against a realistic payload outside n8n and its
rendered HTML read by eye; `npm run lint` remains broken repo-wide and was not
used.

## Still to do

- **Import + activate the workflow.** Nothing is live until step 1–6 above are
  done; the app currently resolves the webhook as *unconfigured* and logs
  `notification skipped` on every hand-off.
- **Send one real hand-off** and read the email on a phone. The HTML has only
  been checked in a browser.
- **Header Auth on the webhook node** (step 7).
- **`portal_website_click` isn't in `CUSTOMER_JOURNEY_EVENTS`**, so the
  `websiteClicks` figure the facts builder derives is always 0 — pre-existing,
  affects the console brief identically, not introduced here.
- The bot-inflation caveat applies to every number in this email: gateway
  scanners detonate tracked links, so a low-band score off `emailClicks` alone
  should be read with suspicion. The score bands themselves are unchanged.
