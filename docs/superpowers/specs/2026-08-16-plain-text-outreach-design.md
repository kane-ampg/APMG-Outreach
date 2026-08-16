# Plain-text outreach emails — design

> **Date:** 2026-08-16
> **Status:** Approved, not yet implemented
> **Scope:** Repo changes + a paste-ready n8n node. The n8n paste is the user's step.

## Goal

Cold outreach emails should read as if a person typed them: a greeting line, two or
three short paragraphs, the tracked link, and a plain-text sign-off. No hero image,
no CTA button graphic, no HTML signature card. The sector playbook stays reachable
where one exists.

The driver is deliverability, not taste. The sending domain
(`apmgmaintenance.com.au`) has no warm-up history and no confirmed test send, and
the current email is a textbook template-blast fingerprint: hosted logo, 600px hero
photo, red CTA button, nested-table layout.

## Verified starting state

Findings established by reading the code and probing the live system on 2026-08-16.
Several contradict the assumptions the work was requested under, so they are
recorded here rather than left implicit.

### The app already sends plain text

`app/api/pipeline/campaigns/send/route.ts` posts
`{ to, leadId, subject, text, attachment?, hero?, hero_alt? }` where
`text = htmlToText(renderBody(...))`. No branded HTML is built in this repo.

The repo is not neutral about formatting, though: `htmlToText()` emits `label (url)`,
and that exact shape is a parsing contract the n8n node depends on.

### The branding is added in n8n, and the repo copy has drifted from live

`buildHtml()` in `references/split-messages.node.js` is the entire branded email:
black header + hosted logo, red rule, hero photo (always on — it defaults to the team
photo), body blocks, PDF card, signature card, sender-identity footer, unsubscribe
button.

Drift, established by diff:

| Copy | `canonicalUrl` | George Collins `SIG` |
|---|---|---|
| Working tree `.js` | yes | yes |
| Working tree JSON `jsCode` | yes | yes — byte-identical to the `.js` |
| **Git HEAD JSON `jsCode`** | yes | **no** |
| Git HEAD `.js` | **no** | no |

Both reference files are uncommitted. Two committed copies already disagreed with
each other — the `.js` at HEAD is a generation older than the JSON at HEAD. The live
node is most likely the HEAD JSON state: `canonicalUrl` yes, signature card no. This
could not be confirmed from here (no n8n API credential in the repo); only the n8n UI
proves it. **The repo copy is not what is sending.**

### The sector playbook PDF is linked, not attached

The workflow has six nodes. The Gmail node is:

```
Send Plain | n8n-nodes-base.gmail
  emailType = "html"   message = {{ $json.html }}   options = { appendAttribution: false }
```

No `attachmentsUi`, no `binaryPropertyName` — a grep for every attachment/binary key
across the workflow returns zero. There is no HTTP Request node, so nothing ever
fetches `attachment.url`.

`pdfCard()` renders a clickable card whose href is
`<base>/t/<leadId>?c=<campaign>&to=<supabase pdf url>` — a tracked link.
`safeDestination()` in `app/t/[id]/route.ts` whitelists the Supabase origin
specifically to serve it.

The comment at `send/route.ts:222-225` — "n8n downloads `attachment.url` and attaches
it as `attachment.filename`" — is false and must be corrected as part of this work.

### Attribution survives plain text; the button and host-scrape do not

Probed directly. With a bare URL in the body:

- the CTA regex `^(.*?)\s*\((https?://[^\s)]+)\)\s*$` does not match → no red button;
- the host-scrape `\((https?://…/t/…)\)` does not match → `trackBase` empty → falls
  back to `BRAND.portalBase`;
- **attribution still works** — the tracked URL is in the body, and
  `/t/<leadId>?c=<campaign>` is all `app/t/[id]/route.ts` needs.

`label (url)` is required for the button and the host-scrape, not for attribution.

Link resolution confirmed: `proxy.ts` lists `/t/` as an allowed customer-host prefix
and `customer.apmgservices.com.au` in `CUSTOMER_HOSTS`, so the link resolves both
before and after `canonicalUrl()` rewrites it.

### The saved prompt row overrides the code, and has itself drifted

`public.compose_prompt` has a row, `updated_at = 2026-07-15T01:45:02Z`. It forces
`<p>` structure, so editing `composePrompt.ts` alone changes nothing.

It has also drifted from the code default: 5,539 chars vs 4,618. The row carries a
different opening ("read like a real person… NOT a marketing campaign or an
AI-written pitch"), an extra "What the email should cover" section, and an
anti-fabrication rule about client names that the code lacks. Overwriting the row
with the code default would lose good copy rules.

### HTML assumptions in the merge helpers

- `renderBody()` HTML-escapes the business name. On a plain-text template this
  produces `Hi Acme HVAC &amp; Plumbing,`. It also escapes apostrophes, so
  `O'Brien's Aged Care` becomes `O&#39;Brien&#39;s` — more common than `&`.
- `stripDashes()` is worse than cosmetic. Its line-opening rule is anchored `(^|>)`.
  In HTML every paragraph starts after `>`, so it works. In plain text only the first
  line qualifies, so `"Hi there\n— George"` becomes `"Hi there, George"` — the
  sign-off is joined onto the paragraph above.

### There are no stored AI drafts

Drafts live in React state in `SendCampaigns.tsx`, are never written to Supabase (the
compose route returns `saved: 0`), and no drafts table exists in any
`supabase/*.sql`. Nothing to migrate; the question is retired.

### The existing tests prove nothing about the payload

All three tests in `send/route.test.ts` cover "never report an unsent campaign as
sent". They mock the playbook helpers and never assert on the message body, so they
would pass through this change unchanged.

### Sign-off conflict

The prompt mandates a final `<p>The APMG Services team</p>`; n8n then appends a
George Collins signature card. The email currently signs off twice, from two
different identities.

## Decisions

| # | Decision | Chosen |
|---|---|---|
| 1 | How far the de-branding goes | **True plain text.** Gmail node switches to `text`; `buildHtml()` is retired for cold sends. |
| 2 | The sector playbook PDF | **Stays linked** (the status quo), rendered as a plain-text line. No attachment. |
| 3 | Signature | **As proposed below**, signing once as George Collins. `The APMG Services team` is dropped. |
| 4 | Per-service copy | **Copy kept verbatim, markup dropped.** |
| 5 | Scope | Repo + paste-ready n8n node. The user does the paste. |
| 6 | Unsubscribe ownership | **The app builds it; the send route asserts it.** |

### Deliverability reasoning, as accepted

Plain text is the right first touch from an un-warmed domain. Two corrections to the
premise the work was requested under, recorded so they are not re-litigated:

1. **No attachment is being removed** — there isn't one. On that axis the current
   setup is already the low-risk choice.
2. **The larger residual liability is link topology, not images.** Every link points
   at `customer.apmgservices.com.au` while the `From:` domain is
   `apmgmaintenance.com.au`, and the PDF link is a redirector carrying a URL in its
   query string. Sender/link-domain mismatch and open-redirect-shaped URLs are weighed
   by filters. Plain text does not fix this, and it remains afterwards.

Plain text also costs click-through quality — a naked tracking URL reads as one. That
is a conversion cost, not a spam cost.

## Architecture

### The app owns the whole body; n8n becomes a dumb sender

Today n8n parses the body with two regexes to recover the CTA and derive the
unsubscribe host. That scrape caused the session-18 unsubscribe debugging saga. It is
deleted.

The send route already knows `base`, `leadId`, `campaign` and `r.email` — everything
the unsubscribe URL needs. It builds the complete text body: greeting, paragraphs,
tracked link, playbook line, signature, sender identity, unsubscribe.

n8n keeps only `canonicalUrl()` — still required, because `NEXT_PUBLIC_TRACK_BASE` is
still the stale `customers-apmg-services.vercel.app` and Next.js inlines it at build
time — and hands `text` to Gmail.

**Risk swap.** Today n8n guarantees the unsubscribe link via a `portalBase` fallback.
Moving ownership into the app means an app bug could drop it. The mitigation is
stronger than the fallback it replaces: the send route asserts every message carries
an unsubscribe line and **refuses the entire send** if any does not, under test.

Consequence: the Step 2 preview becomes exactly what is sent, restoring the design
promise stated at the top of `campaign.ts`.

### Email shape

```
Hi {{business}},

<paragraph>

<paragraph, ending in the "who's the best person" ask>

<short lead-in line>
<tracked link, bare, on its own line>

Our <sector> playbook: <tracked pdf link>      ← only when a sector PDF resolves

George Collins
Managing Director, APMG Services
1300 97 97 40
outreach@apmgmaintenance.com.au
www.apmgservices.com.au

--
APMG Services · 1 Tesmar Cct, Chirnside Park, VIC, Australia
You're receiving this because APMG Services provides property maintenance in your area.
Unsubscribe: <unsubscribe url>
```

All signature values come from the existing `SIG` block. Nothing is invented. The ABN
stays absent, consistent with the standing rule that a wrong ABN on a legal surface is
worse than none.

The tracked link is bare, on its own line, after a human lead-in. The n8n host-scrape
regex drops its parenthesis requirement (`/https?:\/\/[^\s)]+\/t\/[^\s)]+/`) — that
dependency only ever existed because `htmlToText` invented the `label (url)` shape.

**The lead-in line.** `ctaLabel(category)` currently returns a button label
("Aged care upkeep, sorted"). A bare label above a URL reads like machine output in
plain text, so `ctaLabel()` is **kept and repurposed**: it becomes the source of a
short sentence a person would actually type before pasting a link — e.g.
`A bit about how we keep aged care sites sorted:`. One function, one per-sector
mapping, still mirrored by the prompt rule so AI drafts and the deterministic
fallback stay consistent. The per-sector phrasing survives; only its grammatical
shape changes from a label to a sentence. The prompt's CTA-label rule is rewritten to
match.

### Format contract

Clean rename, no compatibility shim — drafts are never persisted and the API is
same-origin only, so there is nothing to migrate.

| Before | After |
|---|---|
| `ComposeDraft.html` | `ComposeDraft.text` |
| `DEFAULT_BODY_HTML` | `DEFAULT_BODY_TEXT` |
| `ServiceTemplate.html` | `ServiceTemplate.text` |
| request field `bodyHtml` | `bodyText` |
| `MAX_HTML` | `MAX_BODY` |
| recipient field `html` | `text` |

### Helper changes (`lib/pipeline/campaign.ts`)

- **`renderText()`** replaces `renderBody()`. No HTML escaping — fixes `&amp;` and
  `O&#39;Brien&#39;s`.
- **`stripDashes()`** anchor becomes `(^|\n|>)`, so a line-leading dash is dropped
  rather than joining the sign-off onto the paragraph above.
- **`htmlToText()` stays.** It becomes the engine of a new `normalizeToText()`, which
  flattens anything HTML-shaped so a model that ignores instructions degrades to clean
  text instead of shipping tags to a prospect.
- **`ensureLinkToken()`** appends a plain-text link line instead of an anchor.
- `escapeHtml()` is retained only for the preview wrapper.

### AI path — three coupled changes that must land together

1. **Prompt.** Format clauses become plain text: `\n\n` between paragraphs, `{{link}}`
   alone on its line, no tags. The DB row's superior copy rules (human-voice framing,
   anti-fabrication rule) are preserved; only the format clauses change.
2. **Output schema.** `html` → `text`. **This is the trap in the whole change**: the
   schema is stored in the DB row. If code reads `o.text` while the row still declares
   `html`, the model returns `{subject, html}`, every draft fails validation, and the
   entire batch silently ships as the deterministic template with no error surfaced.
   Code accepts either key; the row is updated in the same change.
3. **Stub guard.** `composeEmail.ts` line 120's `!html.includes("<p")` becomes a
   plain-text validity check. `forceTrackedCta()` (which rewrites `href=`) is
   meaningless in text and is replaced by a normaliser that strips any real URL and
   forces the `{{link}}` token.

### Per-service templates

All eight keep their copy verbatim. Only the markup is removed: `<p>…</p>` becomes
paragraph breaks, and the `<a href="{{link}}">Label</a>` CTA becomes a lead-in line
plus the bare `{{link}}` token. The `focus`, `image` and `imageAlt` fields are
untouched — `focus` still steers the AI. `image`/`imageAlt` become dead for cold
sends once the hero is gone; they are left in place rather than deleted, since the
service definitions are shared with other surfaces.

### Preview (`components/apmg/pipeline/SendCampaigns.tsx`)

Three preview sites currently call `emailPreviewDoc(renderBody(...))`. They render the
exact text body instead, in a monospace/preserved-whitespace block including the
signature, sender identity and unsubscribe line — because the app now builds all of
it, the preview is truthful without duplicating anything into n8n.

### n8n — two edits, not one

This is where the change silently half-ships. Both are required:

1. Paste the new **Split Messages** code.
2. Change the **Send Plain** Gmail node: `emailType` `"html"` → `"text"`, and
   `message` `{{ $json.html }}` → `{{ $json.text }}`.

Paste #1 without #2 and Gmail sends an HTML email whose source is plain text — it
renders as one unbroken wall with no line breaks.

The new node keeps `canonicalUrl()` and the blanket URL normalisation pass, drops
`buildHtml()`, `bodyBlocks()`, `pdfCard()`, `signature()`, the `SIG`/hero constants
and both parsing regexes.

## Testing

`app/api/pipeline/campaigns/send/route.test.ts` — keep the three existing tests
passing and add:

- the webhook payload carries `text`, not `html`;
- the body contains no tags and no HTML entities;
- the tracked `/t/<id>?c=<campaign>` URL appears verbatim;
- an unsubscribe line is present in every message;
- **the send is refused when the unsubscribe line is missing** (the compliance gate);
- `&` and `'` in a business name survive unescaped;
- the playbook line appears when a sector PDF resolves, and is absent when it does not.

Unit tests for `renderText()` and for the `stripDashes()` line-leading-dash fix.

Note: `npm run lint` and `npx eslint` are both broken in this project; verification is
`tsc` + `vitest` + `next build`.

## Out of scope

- Attaching the PDF as a real attachment (would need an HTTP Request node plus Gmail
  binary config).
- A `List-Unsubscribe` header — a genuine deliverability win, but n8n Gmail node
  support is unconfirmed. Flagged, not promised.
- The sender/link domain mismatch and the `?to=` redirector shape noted above.
- A live test send. There has still never been a confirmed send from this mailbox.

## Follow-ups this work does not close

- The live n8n node state is inferred, not confirmed. The George Collins signature
  block was already pending a paste before this change; that paste is now superseded
  by this one.
- `NEXT_PUBLIC_TRACK_BASE` is still the legacy vercel.app host. `canonicalUrl()` masks
  it. Fixing the env var and redeploying would let the masking be removed later.
