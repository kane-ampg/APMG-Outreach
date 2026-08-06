# Enquiry Notification Emails Tag-Input Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single comma-separated text field for enquiry-notification recipients with a chip-based "add one, press Enter" input, so an operator never has to type a comma correctly to add a recipient.

**Architecture:** `lib/pipeline/notifyEmails.ts` gains one new pure function, `commitNotifyDraft`, that composes the existing `parseNotifyEmails` to fold a not-yet-confirmed draft string onto an already-canonical committed list. `NotifyEmailPanel` in `components/apmg/IntegrationsPage.tsx` is rewritten to hold `committed` (confirmed chips, canonical string) and `draft` (in-progress text) instead of one `value` string, calling `commitNotifyDraft` on Enter, on a typed/pasted separator, and before Save. No other file changes — the API route and n8n workflow are untouched.

**Tech Stack:** Next.js (React 19, "use client" component), TypeScript, Vitest for the lib-level unit test.

## Global Constraints

- Validation stays centralized in `lib/pipeline/notifyEmails.ts` — no email-shape or cap-checking logic is duplicated in the component. (Spec: "State & validation")
- `MAX_NOTIFY_EMAILS` (10) and the canonical `"a@b.com, c@d.com"` storage format are unchanged. (Spec: "Out of scope")
- Removal stays ✕-click only — no backspace-to-pop-last-chip. (Spec: "Interaction model")
- No new automated test infra for the component — this repo has no React component test setup (`vitest.config.ts` only includes `lib/**/*.test.ts` and `app/**/*.test.ts`, `environment: "node"`, no jsdom). Task 2 is verified manually in the browser per the spec's test list.

---

### Task 1: `commitNotifyDraft` helper in `lib/pipeline/notifyEmails.ts`

**Files:**
- Modify: `lib/pipeline/notifyEmails.ts:35` (export the separator regex), `lib/pipeline/notifyEmails.ts:58` (use the exported name), end of file (new function)
- Test: `lib/pipeline/notifyEmails.test.ts` (new)

**Interfaces:**
- Consumes: existing `parseNotifyEmails`, `NotifyEmailsParse`, `MAX_NOTIFY_EMAILS` (all already in this file).
- Produces: `export const NOTIFY_SEPARATOR_RE: RegExp` and `export function commitNotifyDraft(committed: string, draft: string): NotifyEmailsParse` — Task 2 imports both by these exact names from `@/lib/pipeline/notifyEmails`.

- [ ] **Step 1: Write the failing tests**

Create `lib/pipeline/notifyEmails.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { MAX_NOTIFY_EMAILS, commitNotifyDraft } from "./notifyEmails";

describe("commitNotifyDraft", () => {
  it("adds the first address to an empty committed list", () => {
    const r = commitNotifyDraft("", "a@b.com");
    expect(r).toEqual({ ok: true, emails: ["a@b.com"], value: "a@b.com" });
  });

  it("appends a second address onto an existing committed list", () => {
    const r = commitNotifyDraft("a@b.com", "c@d.com");
    expect(r).toEqual({ ok: true, emails: ["a@b.com", "c@d.com"], value: "a@b.com, c@d.com" });
  });

  it("is a no-op success when the draft is blank", () => {
    const r = commitNotifyDraft("a@b.com", "   ");
    expect(r).toEqual({ ok: true, emails: ["a@b.com"], value: "a@b.com" });
  });

  it("is a no-op success on an empty committed list and blank draft", () => {
    const r = commitNotifyDraft("", "");
    expect(r).toEqual({ ok: true, emails: [], value: "" });
  });

  it("splits a pasted comma-separated draft into multiple addresses at once", () => {
    const r = commitNotifyDraft("", "a@b.com, c@d.com");
    expect(r).toEqual({ ok: true, emails: ["a@b.com", "c@d.com"], value: "a@b.com, c@d.com" });
  });

  it("rejects a malformed draft address without touching the committed list", () => {
    const r = commitNotifyDraft("a@b.com", "not-an-email");
    expect(r.ok).toBe(false);
  });

  it("rejects a draft that would push the list past the cap", () => {
    const committed = Array.from({ length: MAX_NOTIFY_EMAILS }, (_, i) => `a${i}@b.com`).join(", ");
    const r = commitNotifyDraft(committed, "one-too-many@b.com");
    expect(r.ok).toBe(false);
  });

  it("dedupes case-differing addresses silently, same as parseNotifyEmails", () => {
    const r = commitNotifyDraft("a@b.com", "A@B.com");
    expect(r).toEqual({ ok: true, emails: ["a@b.com"], value: "a@b.com" });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/pipeline/notifyEmails.test.ts`
Expected: FAIL — `commitNotifyDraft` is not exported from `./notifyEmails`.

- [ ] **Step 3: Export the separator regex**

In `lib/pipeline/notifyEmails.ts`, find:

```typescript
/** Commas, semicolons and newlines all separate — operators paste from Outlook
 *  (semicolons) and from spreadsheet columns (newlines). */
const SEPARATORS = /[,;\r\n]+/;
```

Replace with:

```typescript
/** Commas, semicolons and newlines all separate — operators paste from Outlook
 *  (semicolons) and from spreadsheet columns (newlines). Exported so the
 *  Integrations panel can detect "a separator was just typed/pasted" and
 *  commit the in-progress draft immediately, without re-deriving what counts
 *  as a separator. */
export const NOTIFY_SEPARATOR_RE = /[,;\r\n]+/;
```

Then find the one usage inside `parseNotifyEmails`:

```typescript
  for (const part of raw.split(SEPARATORS)) {
```

Replace with:

```typescript
  for (const part of raw.split(NOTIFY_SEPARATOR_RE)) {
```

- [ ] **Step 4: Add `commitNotifyDraft`**

At the end of `lib/pipeline/notifyEmails.ts`, after the closing brace of `parseNotifyEmails`, add:

```typescript

/** Fold a not-yet-confirmed draft string onto an already-canonical
 *  `committed` list, producing the next canonical list. Used by the
 *  Integrations panel's add-one-recipient field: `committed` is the
 *  confirmed chips, `draft` is whatever the operator is currently typing —
 *  one address, or a pasted separator-delimited list.
 *
 *  A blank draft is a no-op success (`committed` re-validated and returned
 *  unchanged), so callers like Save can call this unconditionally without
 *  special-casing "nothing to commit". */
export function commitNotifyDraft(committed: string, draft: string): NotifyEmailsParse {
  if (!draft.trim()) return parseNotifyEmails(committed);
  const separator = committed.trim() ? ", " : "";
  return parseNotifyEmails(committed + separator + draft);
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run lib/pipeline/notifyEmails.test.ts`
Expected: PASS — all 8 tests green.

- [ ] **Step 6: Run the full test suite to check for regressions**

Run: `npx vitest run`
Expected: PASS — the `SEPARATORS` → `NOTIFY_SEPARATOR_RE` rename has exactly one call site inside this file (Step 3), and every other export (`parseNotifyEmails`, `serializeNotifyEmails`, `MAX_NOTIFY_EMAILS`, `MAX_NOTIFY_EMAIL_LEN`) is untouched, so `app/api/integrations/route.ts` (the only other consumer) is unaffected.

- [ ] **Step 7: Commit**

```bash
git add lib/pipeline/notifyEmails.ts lib/pipeline/notifyEmails.test.ts
git commit -m "feat: add commitNotifyDraft helper for tag-input recipient entry"
```

---

### Task 2: Rewrite `NotifyEmailPanel` as a tag input

**Files:**
- Modify: `components/apmg/IntegrationsPage.tsx:20-24` (imports), `components/apmg/IntegrationsPage.tsx:295-447` (the whole `NotifyEmailPanel` function)

**Interfaces:**
- Consumes: `commitNotifyDraft`, `NOTIFY_SEPARATOR_RE`, `MAX_NOTIFY_EMAILS`, `parseNotifyEmails`, `serializeNotifyEmails` from `@/lib/pipeline/notifyEmails` (Task 1). `NotifyEmailPanel`'s own props (`initial`, `canPersist`, `onSaved`) are unchanged — this task does not touch its caller at line 263.
- Produces: nothing new consumed elsewhere — `NotifyEmailPanel` is only rendered once, at `components/apmg/IntegrationsPage.tsx:263`, and its external contract (props in, nothing out besides calling `onSaved()`) is unchanged.

There is no unit-testable pure logic left in this component after Task 1 (all validation composition is now in `commitNotifyDraft`) — this task is verified manually per the checklist in Step 3.

- [ ] **Step 1: Update the panel's imports**

In `components/apmg/IntegrationsPage.tsx`, find:

```typescript
import {
  MAX_NOTIFY_EMAILS,
  parseNotifyEmails,
  serializeNotifyEmails,
} from "@/lib/pipeline/notifyEmails";
```

Replace with:

```typescript
import {
  MAX_NOTIFY_EMAILS,
  NOTIFY_SEPARATOR_RE,
  commitNotifyDraft,
  parseNotifyEmails,
  serializeNotifyEmails,
} from "@/lib/pipeline/notifyEmails";
```

- [ ] **Step 2: Replace the `NotifyEmailPanel` function body**

Find the whole function (from the doc comment starting `/** Where portal enquiries are emailed to.` through the closing `}` right before `function AutomationCard({`, i.e. lines 288–447) and replace it with:

```typescript
/** Where portal enquiries are emailed to. One global setting (app_settings key
 *  `enquiry_notify_email`) holding one address or a comma-separated list —
 *  EVERY listed address is notified, via a single Gmail send addressed to all of
 *  them. Consumed by the enquiry route + the Enquiry Notification n8n workflow.
 *  Blank clears it (no notifications sent). Parsing lives in
 *  lib/pipeline/notifyEmails.ts, shared with the API route so the validation
 *  shown here is exactly the validation enforced on save.
 *
 *  UI is a tag input: `committed` holds the confirmed recipients as a
 *  canonical string (rendered as removable chips below), `draft` holds
 *  whatever's currently being typed in the small add field. Pressing Enter,
 *  typing/pasting a separator, or clicking Add folds `draft` onto `committed`
 *  via commitNotifyDraft — the same validation Save and the API route already
 *  enforce, so a bad add attempt can never corrupt the confirmed list. */
function NotifyEmailPanel({
  initial,
  canPersist,
  onSaved,
}: {
  initial: string;
  canPersist: boolean;
  onSaved: () => void;
}) {
  const [committed, setCommitted] = useState(initial);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialRef = useRef(initial);

  // Re-seed from a poll ONLY while the field still shows the last known saved
  // value. The page polls every 15s, and clobbering a part-typed list of
  // addresses is real data loss (one short address was survivable).
  useEffect(() => {
    const prev = initialRef.current;
    initialRef.current = initial;
    if (prev === initial) return;
    setCommitted((cur) => (cur.trim() === prev.trim() ? initial : cur));
  }, [initial]);
  useEffect(() => () => {
    if (flashRef.current) clearTimeout(flashRef.current);
  }, []);

  const parsed = useMemo(() => parseNotifyEmails(committed), [committed]);
  // Compare canonical-to-canonical: saving normalises ("A@b.com ,c@d.com" →
  // "a@b.com, c@d.com"), so a raw comparison would leave the field permanently
  // dirty after every save.
  const initialCanonical = useMemo(() => {
    const p = parseNotifyEmails(initial);
    return p.ok ? p.value : initial.trim();
  }, [initial]);
  const canonical = parsed.ok ? parsed.value : null;
  const emails = parsed.ok ? parsed.emails : [];
  const atCap = emails.length >= MAX_NOTIFY_EMAILS;

  // What Save would actually persist, accounting for a non-empty draft that
  // hasn't been explicitly committed yet — otherwise typing an address and
  // clicking Save straight away (without pressing Enter first) would look
  // like a no-op because `committed` hasn't changed.
  const draftPreview = useMemo(
    () => (draft.trim() ? commitNotifyDraft(committed, draft) : null),
    [committed, draft],
  );
  const effectiveCanonical = draftPreview ? (draftPreview.ok ? draftPreview.value : null) : canonical;
  const dirty = effectiveCanonical !== null && effectiveCanonical !== initialCanonical;
  const validish = draftPreview ? draftPreview.ok : parsed.ok;

  /** Fold `rawDraft` onto `committed`. On success, clears the draft field and
   *  the committed list grows by one chip (or more, for a pasted list). On
   *  failure, the draft text is preserved so the operator can fix the exact
   *  problem — the committed chips are never touched by a bad attempt. */
  function tryCommit(rawDraft: string) {
    const result = commitNotifyDraft(committed, rawDraft);
    if (!result.ok) {
      setAddError(result.error);
      setDraft(rawDraft);
      return;
    }
    setAddError(null);
    setCommitted(result.value);
    setDraft("");
  }

  async function save() {
    setError(null);
    let toSave = canonical;
    if (draft.trim()) {
      const result = commitNotifyDraft(committed, draft);
      if (!result.ok) {
        setAddError(result.error);
        return;
      }
      setAddError(null);
      setCommitted(result.value);
      setDraft("");
      toSave = result.value;
    }
    // Save is gated on `validish`, so `toSave` is non-null whenever save()
    // can fire; the guard is defensive only.
    if (toSave === null) return;
    setBusy(true);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyEmail: toSave }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Save failed (${res.status}).`);
        return;
      }
      setSavedFlash(true);
      if (flashRef.current) clearTimeout(flashRef.current);
      flashRef.current = setTimeout(() => setSavedFlash(false), 1800);
      onSaved();
    } catch {
      setError("Network error — couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary ring-1 ring-primary/15">
          <Mail className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-sm font-semibold text-foreground">
            Enquiry notification emails
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Every portal enquiry is emailed to all of these addresses (via the Enquiry Notification
            automation below). Add up to {MAX_NOTIFY_EMAILS} — type one and press Enter, or paste a
            list. They arrive as one email, so each recipient can see the others. Leave blank to send
            no notifications.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={draft}
              onChange={(e) => {
                const next = e.target.value;
                if (NOTIFY_SEPARATOR_RE.test(next)) {
                  tryCommit(next);
                } else {
                  setDraft(next);
                  setAddError(null);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  tryCommit(draft);
                }
              }}
              placeholder={
                atCap
                  ? `${MAX_NOTIFY_EMAILS} of ${MAX_NOTIFY_EMAILS} — remove one to add another.`
                  : "you@company.com.au"
              }
              disabled={busy || !canPersist || atCap}
              data-track="notify_email_input"
              className="h-9 w-full flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => tryCommit(draft)}
              disabled={busy || !canPersist || atCap || !draft.trim()}
              data-track="notify_email_add"
            >
              Add
            </Button>
            <Button
              size="sm"
              onClick={save}
              disabled={busy || !canPersist || !dirty || !validish}
              data-track="notify_email_save"
              className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
            >
              {savedFlash ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
              {savedFlash ? "Saved" : busy ? "Saving…" : "Save"}
            </Button>
          </div>
          {/* Parsed recipients — the chips ARE the committed list, so this is
              exactly who Save will persist (plus whatever's in the add field,
              covered by the dirty/validish check above). */}
          {emails.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {emails.map((addr) => (
                <span
                  key={addr}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground"
                >
                  {addr}
                  <button
                    type="button"
                    onClick={() => setCommitted(serializeNotifyEmails(emails.filter((a) => a !== addr)))}
                    aria-label={`Remove ${addr}`}
                    disabled={busy || !canPersist}
                    className="text-muted-foreground transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
              <span className="tnum ml-0.5 font-mono text-[10px] text-muted-foreground">
                {emails.length} of {MAX_NOTIFY_EMAILS}
              </span>
            </div>
          )}
          {!canPersist && (
            <p className="mt-2 text-[11px] text-amber-500">
              Connect Supabase to save this here.
            </p>
          )}
          {addError && <p className="mt-2 text-[11px] text-primary">{addError}</p>}
          {error && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-destructive">
              <AlertTriangle className="h-3 w-3" aria-hidden /> {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify in the browser**

Run: `npm run dev`, sign in, open Admin → Integrations, and work through the spec's test list against the "Enquiry notification emails" panel:

1. Type an address and press **Enter** → it becomes a chip, the add field clears, focus stays in the field.
2. Type a second address and click **Add** → second chip appears.
3. Type an address followed by a trailing `,` inline (no Enter) → it commits into a chip immediately.
4. Paste `a@x.com, b@x.com, c@x.com` into the empty add field in one paste → all three become chips at once.
5. With 10 chips present, confirm the add field and Add button are disabled and the placeholder reads "10 of 10 — remove one to add another."
6. Type a malformed address (e.g. `not-an-email`) and press Enter → red error appears below, the malformed text stays in the field, existing chips are untouched.
7. Type a valid new address but do **not** press Enter, then click **Save** → the address is committed into a chip AND persisted (reload the page or wait for the 15s poll to confirm the saved value includes it).
8. Remove a chip via its ✕ → Save enables/disables correctly relative to the original saved value (dirty check), same as before this change.
9. Confirm `!canPersist` (no Supabase connection) still shows "Connect Supabase to save this here." and disables the add field, Add button, and Save button.

Expected: all nine behaviors match; no console errors.

- [ ] **Step 4: Run the full test suite**

Run: `npx vitest run`
Expected: PASS — this task is a client component with no automated coverage (see Global Constraints); this confirms Task 1's lib change still passes and nothing else broke.

- [ ] **Step 5: Commit**

```bash
git add components/apmg/IntegrationsPage.tsx
git commit -m "feat: turn enquiry-notification recipients into a tag input"
```
