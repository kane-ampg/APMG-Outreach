"use client";

import { useEffect, useRef, useState } from "react";
import { track } from "@/lib/telemetry";

/** Same email shape the unsubscribe route + ServiceInquiryModal validate — keep
 *  the three in step so a value that passes here never bounces at the endpoint.
 *  Rejects `?&=#` so a crafted address can't smuggle query params into the GET. */
const EMAIL_RE = /^[^\s@?&=#]+@[^\s@?&=#]+\.[^\s@?&=#]+$/;

/**
 * Customer-facing unsubscribe control for the public portal footer.
 *
 * The email footer already links straight to GET /api/portal/unsubscribe?e=…
 * (it knows the recipient's address). On the PORTAL a fresh visitor has no
 * address in the URL, so this offers a small "prefer not to receive our emails?"
 * link that expands an inline email field and submits to the SAME endpoint —
 * no new backend, no n8n change. Navigating there renders the existing branded
 * "Sorry to see you go" confirmation page.
 *
 * Rendered on the customer host only (see ServicesPortal `standalone`), so the
 * internal "Our Services" demo tab never shows an opt-out control.
 */
export function PortalUnsubscribe() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  /** The expanded form's email field — focus is moved here on open, see below. */
  const emailRef = useRef<HTMLInputElement>(null);

  // SC 2.4.3 (Focus Order): expanding does not reveal the form BESIDE the
  // trigger, it REPLACES it (the early return below), so the focused button
  // unmounts and the browser drops focus to <body>. A keyboard user loses their
  // place and has to tab from the top of the document; a screen reader user
  // hears nothing at all and has no reason to think the activation worked.
  // Moving focus to the field the disclosure exists to reveal fixes both — it is
  // also where the user was headed anyway. requestAnimationFrame so the newly
  // mounted input is painted before we focus it (the focus-triggered scroll then
  // resolves against settled layout) — the pattern ServiceInquiryModal's open
  // effect uses. Declared BEFORE the `if (!open)` early return: hooks must run
  // on every render.
  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => emailRef.current?.focus());
  }, [open]);

  const valid = EMAIL_RE.test(email.trim());
  /** SC 3.3.1: the message shows for ANY invalid state once touched, EMPTY
   *  INCLUDED. It used to also require `email.trim() !== ""`, which paired with
   *  a `disabled` submit meant a visitor who activated an empty required field
   *  got no button response and no message. The submit is no longer gated (see
   *  the button), so activation on empty must report something. */
  const showError = touched && !valid;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!valid) return;
    // Complementary signal; the authoritative record is written by the route.
    track("unsubscribe_request", { scope: "portal" });
    // Hand off to the existing GET route, which records the opt-out and shows
    // the branded confirmation page. `e` is the address; no lead/campaign
    // context here (a portal visitor isn't tied to a specific send).
    window.location.href = `/api/portal/unsubscribe?e=${encodeURIComponent(email.trim())}`;
  }

  if (!open) {
    return (
      <div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          // SC 4.1.2: name the control as a disclosure, so it announces as
          // "collapsed" rather than reading like a link that will navigate.
          // Bound to `open` for honesty even though this branch only renders
          // while it is false. No aria-controls: the form it reveals does not
          // exist in the DOM yet (it replaces this button), and pointing at an
          // absent id is worse than omitting the attribute — the announced
          // identity of the revealed content comes from the form's role="group"
          // name instead.
          aria-expanded={open}
          data-track="portal_unsubscribe_open"
          className="rounded py-1 text-xs text-white/60 underline underline-offset-2 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
        >
          Prefer not to receive our emails? Unsubscribe
        </button>
      </div>
    );
  }

  return (
    <form
      onSubmit={submit}
      // noValidate: the submit is deliberately always enabled (SC 3.3.1, see the
      // button) and the field is `required` with type="email", so without this
      // the browser's own constraint validation would swallow the submit and pop
      // a native bubble — our styled, announced message would never render and
      // `touched` would never be set. Same reason ServiceInquiryModal sets it:
      // one validation authority, not two fighting each other.
      noValidate
      // SC 2.4.3 / 4.1.2: this form appears in place of the trigger, so once
      // focus lands on the input (effect above) there is nothing to tell the
      // visitor they are somewhere new — a bare field reads as though it had
      // always been there. An accessible name on the container gives the
      // revealed content an identity that is announced as focus enters it.
      // role="group" rather than letting the named <form> expose its native
      // `form` role: a named form is a LANDMARK, and a one-field opt-out in the
      // portal footer must not sit in the landmark list beside the page's
      // main/nav/contentinfo, where it would read as a major region.
      role="group"
      aria-label="Unsubscribe from our emails"
      className="flex flex-col gap-2"
    >
      <label htmlFor="portal-unsub-email" className="text-xs text-white/60">
        Enter your email and we&rsquo;ll take you off our list.
      </label>
      <div className="flex w-full max-w-xs items-center gap-2">
        <input
          id="portal-unsub-email"
          ref={emailRef}
          type="email"
          required
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched(true)}
          // SC 3.3.1: programmatically tie the failure to the field it belongs
          // to — aria-invalid marks the field, aria-describedby makes a screen
          // reader read the REASON when focus returns to it (aria-invalid alone
          // announces a bare "invalid entry"). Both are conditional so a
          // pristine field is never described by a paragraph that isn't
          // rendered — the same wiring as ServiceInquiryModal's email input.
          aria-invalid={showError || undefined}
          aria-describedby={showError ? "portal-unsub-error" : undefined}
          className="h-9 flex-1 rounded border border-white/25 bg-white/5 px-3 text-[13px] text-white outline-none placeholder:text-white/40 focus-visible:ring-2 focus-visible:ring-brand-400"
        />
        <button
          type="submit"
          // Deliberately NOT disabled. Gating this on `valid` made it a dead
          // control: a keyboard or screen reader user activating it got no
          // response and no announced reason why (SC 3.3.1), and the error path
          // below was unreachable without first blurring the field. `submit()`
          // already re-checks `valid` before it navigates and sets `touched`, so
          // an always-enabled submit cannot unsubscribe a bad address — it just
          // makes the validation message reachable by the visitor who needs it.
          // (`transition-opacity disabled:opacity-50` went with the `disabled`
          // attribute — nothing fades any more, so both are gone.)
          className="h-9 shrink-0 rounded bg-brand-600 px-3 text-[13px] font-semibold text-white transition-colors hover:bg-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
        >
          Unsubscribe
        </button>
      </div>
      {showError && (
        /* SC 3.3.1: role="alert" so the message is announced the moment it
           appears — with the submit always enabled, activation (not just blur)
           is now the usual trigger, and focus stays on the button where nothing
           else would speak. The id wires it to the input above. Empty and
           malformed get different wording: "that doesn't look valid" is
           nonsense for a required field the visitor never filled in. */
        <p id="portal-unsub-error" role="alert" className="text-xs font-semibold text-brand-400">
          {email.trim() === ""
            ? "Enter the email address you’d like removed."
            : "That doesn’t look like a valid email address."}
        </p>
      )}
    </form>
  );
}
