# Enquiry notification emails — tag-input design

## Problem

Admin → Integrations → Enquiry notification emails is a single free-text
input where the operator types or pastes a comma-separated list of
addresses. Adding one more recipient means editing raw text and getting the
separator right. Removal already works via chips shown below the input, but
adding does not have an equivalent affordance.

## Goal

Let an operator add a recipient without relying on typing a comma
correctly, while keeping the existing paste-a-full-list flow working for
anyone who already uses it.

## Interaction model

Replace the single input with: existing chips (unchanged) + a small
"add one" field + an Add button, styled like a Gmail `To:` field.

- Typing one address and pressing **Enter** commits it as a new chip and
  clears the field.
- Typing a separator (`,`, `;`, or newline) inline also commits the
  segment before it, so comma still works for anyone who types that way
  out of habit.
- Clicking **Add** commits the current field contents, same as Enter.
- Pasting a comma/semicolon/newline-separated list into the field commits
  all of them at once — the existing power-user paste flow keeps working.
- At `MAX_NOTIFY_EMAILS` (10) recipients, the add field and Add button
  disable, with the counter reading "10 of 10 — remove one to add
  another."
- Removal stays ✕-click only on a chip. Backspace in the add field does
  **not** pop the last chip — explicit-only removal avoids losing a
  recipient to a stray double-backspace.

## State & validation

`lib/pipeline/notifyEmails.ts` (`parseNotifyEmails` / `serializeNotifyEmails`
/ `MAX_NOTIFY_EMAILS`) stays the single source of truth for what counts as a
valid address and list — no new validation logic, no duplicated regex.

`NotifyEmailPanel` state changes from one `value: string` to:

- `committed: string` — canonical comma-joined string of confirmed chips.
  This is what gets saved, and is seeded from `initial` exactly as `value`
  is today (including the existing re-seed-from-poll effect, unchanged).
- `draft: string` — text currently being typed in the add field, not yet
  committed. Starts empty, never persisted, never sent to the server.

Committing (Enter / separator typed / Add clicked / paste): call
`parseNotifyEmails(committed + ", " + draft)`.
- On success: `committed = parsed.value` (the canonical re-join), `draft`
  clears.
- On failure (bad address shape, over cap): show the error next to the add
  field, leave `draft` untouched so the operator can fix the specific
  problem, and leave `committed` / existing chips untouched — a bad add
  attempt never touches already-confirmed recipients.

**Save button:** if `draft` is non-empty when Save is clicked, first run
the same commit step. If it succeeds, proceed to save the resulting
`committed` value (so typing an address and clicking Save without pressing
Enter first doesn't silently discard it). If it fails, show the error and
do not save — same as today's "Save is disabled while invalid" behavior,
just now also covering an uncommitted draft.

Everything downstream of `committed` (chip rendering, per-chip ✕ removal,
the `X of MAX_NOTIFY_EMAILS` counter, the dirty check against
`initialCanonical`, the actual POST to `/api/integrations`) is the existing
logic operating on a renamed variable — no behavior change there.

## Out of scope

- The 10-recipient cap, dedup-on-add, and canonical storage format
  (`"a@b.com, c@d.com"` in `app_settings`) are unchanged.
- Backspace-to-pop-last-chip — explicitly rejected, see above.
- The API route (`app/api/integrations/route.ts`) and n8n workflow — no
  server-side change; this is a client-side interaction change only, and
  `parseNotifyEmails` guarantees the value reaching the server is identical
  in shape to what it accepts today.

## Testing

Manual verification in the browser (this is a small client-only UI change
to one panel — no new automated test infra needed):
- Add via Enter, add via Add-button click, add via typing a trailing comma.
- Paste a comma-separated list of 3 addresses in one go.
- Try to add an 11th address at the cap → blocked with the counter message.
- Try to add a malformed address → error shown, draft preserved, existing
  chips untouched.
- Type an address, click Save without pressing Enter → it gets committed
  and saved.
- Remove a chip via ✕, confirm Save enables/disables correctly against
  `initialCanonical` as before.
