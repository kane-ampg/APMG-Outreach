# Newsletter Tab — Design

**Date:** 2026-09-30
**Status:** Design approved in chat 2026-09-30; awaiting spec review
**Scope:** The first slice of the "Email Marketing" request that the follow-up
spec ([2026-09-25-hot-lead-follow-up-design.md](2026-09-25-hot-lead-follow-up-design.md))
set aside: a photo newsletter of recent work, sent to hot leads.

## 1. Intent

APMG does work worth showing off. The operator photographs a finished job,
writes a line about what the job was and what was done, and wants that turned
into a proper newsletter. Claude writes the words that sell APMG; the app lays
out the photos and words as an email; n8n sends it to the leads who have
already shown real interest.

**Success:** the operator uploads 2–6 photos with a note each; Claude writes a
headline, caption and alt text per photo; the operator edits them, previews
the finished email, sends a test to themself, then sends it to every Hot 60+
lead, and each send appears on that lead's history and in the send reports.

### What Kane decided (2026-09-30)
- A **Newsletter** tab inside **Follow-Ups**.
- **Several job stories per issue** (a "recent work" roundup), each one a photo,
  the operator's note, and Claude's caption.
- **The app picks the recipients, n8n sends.** No copying HTML into another tool.
- **Audience: Hot 60+ leads only.** Warm (35–59) was rejected: nearly every
  tracked click lands on the portal and scores 35+, gateway scanners included,
  so Warm is mostly bots.
- **Captions never name the client** or site, even when the note does.
- **A new n8n "Newsletter Send" workflow** (approach 1). The live Campaign Send
  workflow is not touched.

### Assumed (stated in chat, not contradicted)
- A human approves every issue before it sends; there is a test send.
- Every guard the cold and follow-up sends apply still applies.

### Out of scope
- Scheduled or recurring sends.
- Open tracking. As everywhere else in the app, only clicks are tracked.
- Other audiences (Warm leads, folders, everyone emailed, hand-picked lists,
  existing clients). Clients also fall foul of the "never email an existing
  customer" rule.
- Posting to LinkedIn or Facebook.
- A/B subject lines.

## 2. Who receives it

**Source: `saved_hot_leads`** (from [supabase/saved-hot-leads.sql](../../../supabase/saved-hot-leads.sql)).
Its triggers hold every lead that has ever scored 60+, with its current score
and its addresses, and a folder delete doesn't remove it. That makes it
exactly the Hot 60+ list, and the only place the addresses survive: on
2026-09-30 there were 77 leads at 60+, and only 17 still had a `leads` row. The
tab depends on that SQL having been run and says so with a banner until it has.

**Eligible:** `score >= 60` and at least one address. The address is picked
with `bestEmail()` (lib/pipeline/campaign.ts), so a lead gets the same address
its follow-ups would.

**Recipient checklist.** Everyone eligible is ticked by default. Some rows are
labelled so the operator can choose to untick them:
- **With Sales**: the lead has been handed off (the hand-off ledger).
- **Likely scanner**: its first service open came within `SCANNER_GAP_MS` of
  a delivery (the follow-ups heuristic, `scannerGap()`).
- **Reads like client X**: a resemblance match from the client guard.
- **Already received this issue**: the lead is in the issue's `sent_to`. It is
  unticked and can't be re-ticked.

The **Won't be sent** rows can't be overridden. They are enforced server-side
by the shared guards whatever the browser sends:
- existing clients (exact matches);
- address opt-outs;
- organisation opt-outs.

## 3. Data model

New hand-run SQL file **`supabase/newsletters.sql`**. It is idempotent, and like
the other server-only tables it has RLS on with no policies.

```sql
create table if not exists public.newsletters (
  id            uuid primary key default gen_random_uuid(),
  label         text,            -- the header's issue label, e.g. "Recent work · October 2026"
  subject       text,
  intro         text,            -- plain text; paragraphs split on blank lines
  cta_label     text not null default 'Get in touch',
  stories       jsonb not null default '[]',  -- see below, max 6
  status        text not null default 'draft'
                check (status in ('draft', 'sending', 'sent')),
  campaign      text unique,     -- set when first sent: newsletter-YYYY-MM-<first 6 of id>
  sent_to       uuid[] not null default '{}', -- lead ids n8n accepted
  sent_at       timestamptz,
  sent_by       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
```

Each entry in `stories`:
`{ id, image_path, image_url, width, height, note, headline, caption, alt }`.
`image_path` is the storage object key (used to delete it) and `image_url` is its
public URL.

The same file creates the **`newsletter-images`** bucket: public, with
`file_size_limit` 2 MB and `allowed_mime_types` of `image/jpeg`, `image/png` and
`image/webp`. It follows the `sector-assets` insert in schema.sql.

**Photo lifecycle.**
- Removing a story from a draft deletes its object.
- Deleting a draft deletes all of its objects.
- A **sent** issue can't be deleted, and its objects are never deleted,
  because the emails already in inboxes load the photos from those URLs.

## 4. Photos

- **Resized in the browser before upload.** The long edge goes to 1200px and
  the file is re-encoded as JPEG at quality 0.82 on a canvas. This keeps the
  upload well under Vercel's 4.5 MB request limit and under the bucket's 2 MB
  cap, and it strips EXIF, including the GPS position of the client's site.
- Accepted inputs are JPEG, PNG and WebP. For HEIC, or any file the browser
  can't decode, the operator is told to save it as JPEG first; it doesn't fail
  silently.
- **`POST /api/newsletters/image`** (multipart; `followups.send`) checks the type
  and size again on the server, stores the file at `<issueId>/<random>.jpg`, and
  returns `{ path, url, width, height }`.
- The email renders each photo at 600px wide. The 1200px source is the retina
  version.

## 5. Captions (Claude)

**`POST /api/newsletters/caption`** takes `{ issueId, storyId }` (`followups.send`)
and reads the story's photo and note from the saved issue. **Write caption**
saves the story first, so Claude always works from what's on screen. Claude
gets **both the photo and the note**, and returns strict JSON:
`{ headline, caption, alt }`. The result is written back to the story and
returned for the card to show.

Rules, held in `lib/ai/newsletterPrompt.ts`:
- **Facts come only from the note**, plus APMG's four confirmed claims: 24/7
  make-safe, Mon–Sat 7–5, reply within one business day, no call-out fee. The
  photo may only be used to describe what's visible. No prices, timeframes,
  warranties, licence numbers, awards or client counts.
- **Never name the client, business, brand, person or street address.**
  Describe the site generically, at most by sector and region ("a childcare
  centre in Melbourne's east").
- Headline: at most 8 words. Caption: 2–3 sentences, about 40–70 words,
  finishing with how APMG helps sites like this one. Alt: at most 15 words,
  a literal description of the photo.
- Australian English, plain and practical, no exclamation marks, no emoji.
- Grounded by the general APMG knowledge base (the same `buildComposeKb`
  source the follow-ups use), so services are described the way APMG describes
  them.

**Model:** the one the follow-up drafts use, `resolveModel(loadComposePrompt().model)`,
so there is one setting to change.

**Subject and intro:** `POST /api/newsletters/intro` takes `{ issueId }` and
writes a subject line (at most 60 characters) and a 1–2 sentence intro from the
issue's headlines and captions, under the same rules.

**Safety net:** every headline and caption is checked against the Master
Client List (lib/clients). A hit flags the story with *"Mentions <client>,
check before sending"*. It is a warning, not a block, because the match can be
a false positive on a common word.

**No fallback copy.** If Claude isn't available (no `ANTHROPIC_API_KEY`, or an
API or parse error), nothing is written and the story says *"Claude couldn't
write this one, try again or write it yourself."* The operator may always type
their own copy.

## 6. The email

**`lib/newsletter/render.ts`** is a pure function,
`renderNewsletter(issue, ctx) → { html, text }`. The preview and the send both
call it, so what is approved is exactly what is sent. `ctx` is
`{ link, unsubscribe, test }`.

**Look.** A designed newsletter, deliberately unlike the cold emails' "typed
email" style:
- one centred 600px column, table-based, all styles inline;
- web-safe fonts, with a background colour on every cell so dark-mode clients
  don't invert it into something unreadable;
- no background images and no CSS the major clients drop.

**Order, top to bottom:**
1. **Header:** the APMG logo (a new PNG, `public/images/brand/apmg-logo-email.png`,
   because Outlook desktop can't show the existing WebP) and the issue label.
2. **Intro:** plain-text paragraphs.
3. **Stories, in order:** the photo (600px, `alt`, explicit width and height),
   then the headline, then the caption.
4. **One button:** `cta_label`, linking to `ctx.link`.
5. **Sign-off:** George Collins, Sales Representative, the same signature the
   cold emails use.
6. **Footer:**
   - trading name, address, phone and ABN, all from `lib/legal/company.ts`;
   - *"You're receiving this because you've looked at APMG's services."*;
   - an **Unsubscribe** link to `ctx.unsubscribe`.

**Escaping.** Every piece of text is HTML-escaped. A `<` or `&` in a note or
caption can't break the layout or inject markup. URLs are attribute-escaped.

**Plain text.** `text` is the same content in reading order: headlines,
captions, "Get in touch: <link>", the signature, then the footer with the
unsubscribe URL. n8n sends both parts (multipart/alternative).

**Links for a real send:**
- `ctx.link` is `trackedLink(base, leadId, campaign)`, so a click lands on the
  lead's trail under the issue's campaign and raises its score like any
  outreach click.
- `ctx.unsubscribe` is the existing
  `/api/portal/unsubscribe?e=<email>&lead=<leadId>&c=<campaign>`. The
  `email_sent` rows make the campaign a known campaign, so the endpoint's
  unknown-campaign gate (`isKnownCampaign`) accepts it.

**Links for a test send:**
- `ctx.link` is the plain portal URL.
- `ctx.unsubscribe` is `null`. The footer then says "Unsubscribe (disabled in
  tests)", so clicking around a test can't write a stray trail or opt the
  operator out.

## 7. Sending

### Shared guards
`deliverCampaign` (lib/pipeline/deliver.ts) is split so that the newsletter and
the cold/follow-up sends share **one** guard and ledger path. The guard stage
is client guard → address opt-outs → organisation opt-outs. The ledger stage
writes `email_sent` rows. Between them, each channel builds its own payload and
posts to its own webhook:

- The **campaign** channel is today's behaviour, unchanged: plain `text`,
  `hero` and `attachment`, sent to the Campaign Send webhook.
- The **newsletter** channel sends `{ to, leadId, subject, html, text, unsub }`
  to the Newsletter Send webhook.

The existing deliver tests must pass unchanged; that is the proof the cold
path didn't move.

### `POST /api/newsletters/send`
The body is `{ issueId, leadIds }`, gated by `followups.send`.
1. Load the issue. It must be a `draft`, and every story must have an image,
   headline and caption; a subject is also required.
2. Rebuild the audience server-side. `leadIds` can only *narrow* it: an id that
   isn't eligible, or is already in `sent_to`, is dropped.
3. **Claim** the issue: PATCH `status=sending` where `status=draft`. If no row
   comes back, another send got there first, and the route answers 409.
4. Set `campaign` if it isn't already set, then render one email per lead.
5. Hand over through the newsletter channel. If n8n answers non-2xx, or the
   request fails, **the claim is rolled back to `draft`** and the error is
   shown.
6. Once n8n accepts, the route:
   - writes the `email_sent` rows with `props: { newsletter: <id> }`;
   - appends the accepted ids to `sent_to`;
   - sets `status=sent`, `sent_at` and `sent_by`.
   A lead the guards dropped is reported back by name, with the reason.

A function that dies between the claim and n8n's answer leaves the issue in
`sending`. The tab shows the same guidance follow-ups do: *"check the outreach
mailbox's Sent folder, then reset it"*. It offers no re-send button.

**Re-sending a sent issue** (to leads who became hot after it went out) is done
with **Duplicate**, which makes a fresh draft with its own campaign. That keeps
"one issue, one send, one campaign" true.

### `POST /api/newsletters/test`
The body is `{ issueId }`, gated by `followups.send`. It renders the issue with
the test links (§6), puts "[TEST] " before the subject, and sends to **the
signed-in user's own email**, through the same newsletter webhook. It
**bypasses the lead guards, writes no ledger row, and doesn't change the issue.**

### Refusals
If the Newsletter Send integration isn't configured or is paused, the send and
test routes both refuse with a message that names the problem ("paused" is
worded separately from "not set up"). They never report a send that didn't
happen, which is the same rule `campaignWebhook()` follows.

### n8n workflow
The workflow file is **`references/APMG Newsletter Send.json`**, a copy of
`APMG Campaign Send (list-unsubscribe).json` with these changes:
- The webhook path is `/webhook/newsletter-send`, with the same
  `x-apmg-secret` header auth.
- The **Split Messages** node becomes a pass-through. It emits
  `{ campaign, to, leadId, subject, text, html, unsub }` exactly as the app sent
  them and does no templating.

Everything else is unchanged:
- **Build MIME:** the List-Unsubscribe and List-Unsubscribe-Post headers from
  `unsub`, and multipart text + HTML.
- **Pacing:** one email every 30 seconds.
- **Respond OK:** fires before the loop.

### Integrations entry
A new entry in `INTEGRATIONS` (lib/data/integrations.ts):
- `id: "newsletter-send"`
- setting key `n8n_newsletter_webhook_url`
- toggle `n8n_newsletter_webhook_enabled`
- env var `N8N_NEWSLETTER_WEBHOOK_URL`

A matching `newsletterWebhook()` resolver sits next to `campaignWebhook()` in
lib/pipeline/server.ts.

## 8. UI

`FollowUpsPage` gets two tabs at the top: **Follow-ups** (today's queue, unchanged)
and **Newsletter**. The selected tab is kept in the URL hash, so a refresh stays
put. The Newsletter tab is new code in `components/apmg/newsletter/`, using the
Follow-Ups page's own chips, cards and buttons so the two tabs read as one page.

- **Issue list:** drafts first, then sent issues with their date and recipient
  count. It has **New issue** and **Duplicate** buttons.
- **Editor:**
  - label, subject and intro, with **Write subject & intro** (Claude);
  - story cards, each with the photo drop/upload, a note textarea, **Write
    caption** or **Rewrite**, editable headline/caption/alt, move up/down, and
    remove;
  - an **Add story** button, disabled at 6;
  - the button label.
  Edits save on blur. Cards show the client-mention warning chip.
- **Preview:** an `iframe srcDoc` fed by `renderNewsletter`, with a 600px / 375px
  toggle.
- **Send panel:** the recipient checklist with its labels (§2), a
  **Send test to me** button, and **Send to N**, which confirms with "Send
  '<subject>' to N leads?". The panel is disabled while there are unsaved edits,
  and after a send it shows the guard report.
- **Sent issues** open read-only, showing who received them.

The Newsletter tab needs `followups.view` to see and `followups.send` to act.
The permission names aren't changed.

## 9. Errors and degraded modes

| Situation | What the operator sees |
|---|---|
| `newsletters.sql` not run | Banner: "Run supabase/newsletters.sql in the Supabase SQL editor to switch this tab on." |
| `saved-hot-leads.sql` not run | Audience panel: "Run supabase/saved-hot-leads.sql first — it holds the hot list." Test sends still work. |
| Newsletter Send not configured / paused | Send buttons are disabled with the reason and a link to Integrations. |
| Upload fails / too big / HEIC | Inline on the card, with a retry. Nothing is saved until the upload succeeds. |
| Claude unavailable | "Claude couldn't write this one, try again or write it yourself." |
| Issue stuck in `sending` | Chip with the Sent-folder guidance and no send button (§7). |
| Guards drop someone | Named in the post-send report with the reason. |
| Unsaved edits | Send is disabled: "Save your edits first." |

## 10. Testing

**Unit tests (vitest), next to the code they test:**
- `render`:
  - every story appears in order, with width, height and alt;
  - the footer carries the ABN, address and unsubscribe link;
  - `<`, `&` and quotes in the note or caption are escaped;
  - a test render has no tracked link and a disabled unsubscribe;
  - the plain text carries the unsubscribe URL.
- `newsletterPrompt`: the no-names and facts-only rules and the confirmed
  claims are present; the output schema is enforced; empty or oversize fields
  are rejected.
- Audience:
  - 60+ only; leads without an email are dropped;
  - `bestEmail` is used;
  - the labels (with Sales, likely scanner, client resemblance, already
    received) are correct;
  - `leadIds` can only narrow the list.
- Send route:
  - the claim race answers 409;
  - a rejected hand-off rolls back to `draft`;
  - it refuses when paused or unconfigured;
  - ledger rows carry `props.newsletter`;
  - `sent_to` is merged.
- Test route: it sends to the signed-in user, writes no ledger, and the issue
  is unchanged.
- Image route: it rejects the wrong type and anything over 2 MB, and the path
  is scoped to the issue.
- `deliver`: the existing tests pass unchanged, and the newsletter channel posts
  its payload to its own webhook.

**Manual, before the first real send:** send a test to a Gmail inbox and an
Outlook inbox. Check the layout, the images, the alt text with images blocked,
the button, and that Gmail shows its own Unsubscribe control.

**Build gates:** `tsc --noEmit`, `vitest run` and `next build`. There is no
working lint gate.

## 11. Manual steps (Kane)

1. Run `supabase/saved-hot-leads.sql` if it hasn't been run yet. It is the audience.
2. Run `supabase/newsletters.sql`.
3. Import `references/APMG Newsletter Send.json` into n8n, attach the same Gmail
   OAuth credential and header-auth credential as Campaign Send, and activate it.
4. Paste its production webhook URL into **Integrations → Newsletter Send**.
5. Build a first issue and send a test to Gmail and to Outlook (§10) before the
   first real send.

## 12. Files

**New:**
- `supabase/newsletters.sql`
- `lib/newsletter/types.ts`, `render.ts`, `audience.ts`, `server.ts`, plus tests
- `lib/ai/newsletterPrompt.ts`, `lib/ai/newsletterCaption.ts`, plus tests
- `app/api/newsletters/route.ts` (list, create, update, delete)
- `app/api/newsletters/image/route.ts`
- `app/api/newsletters/caption/route.ts`
- `app/api/newsletters/intro/route.ts`
- `app/api/newsletters/send/route.ts`
- `app/api/newsletters/test/route.ts`
- `components/apmg/newsletter/*`, `lib/newsletter/useNewsletters.ts`
- `public/images/brand/apmg-logo-email.png`
- `references/APMG Newsletter Send.json`

**Changed:**
- `lib/pipeline/deliver.ts` (guard/ledger split, newsletter channel)
- `lib/pipeline/server.ts` (`newsletterWebhook()`)
- `lib/data/integrations.ts` (the new entry)
- `components/apmg/FollowUpsPage.tsx` (the two tabs)
