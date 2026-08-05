"use client";

import { useState } from "react";
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

  const valid = EMAIL_RE.test(email.trim());

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
      <div className="mt-2 text-center">
        <button
          type="button"
          onClick={() => setOpen(true)}
          data-track="portal_unsubscribe_open"
          className="font-mono text-[11px] text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
        >
          Prefer not to receive our emails? Unsubscribe
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="mt-3 flex flex-col items-center gap-2">
      <label htmlFor="portal-unsub-email" className="font-mono text-[11px] text-muted-foreground">
        Enter your email and we&rsquo;ll take you off our list.
      </label>
      <div className="flex w-full max-w-xs items-center gap-2">
        <input
          id="portal-unsub-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onBlur={() => setTouched(true)}
          className="h-9 flex-1 rounded-lg border border-input bg-background px-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        <button
          type="submit"
          disabled={!valid}
          className="h-9 shrink-0 rounded-lg bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-opacity disabled:opacity-50"
        >
          Unsubscribe
        </button>
      </div>
      {touched && !valid && email.trim() !== "" && (
        <p className="font-mono text-[11px] text-destructive">
          That doesn&rsquo;t look like a valid email address.
        </p>
      )}
    </form>
  );
}
