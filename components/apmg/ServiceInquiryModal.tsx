"use client";

import { useEffect, useRef, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, CircleCheck, Loader2, Send, X, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { track } from "@/lib/telemetry";
import { COMPANY } from "@/lib/legal/company";

const EASE = [0.22, 1, 0.36, 1] as const;
/** The message must say *something* before the send button enables — a bare
 *  email address gives the team nothing to quote against. */
const MIN_MESSAGE = 10;
/** Matches the server-side check in /api/portal/inquiries — validate the same
 *  way on both sides so a value that passes here never 400s there. Rejects
 *  `?&=#` (never valid in real addresses) so a crafted "email" can't smuggle
 *  mailto query params into anyone's mail compose. */
const EMAIL_RE = /^[^\s@?&=#]+@[^\s@?&=#]+\.[^\s@?&=#]+$/;
/** Fallback inbox when the API is unreachable — an enquiry must never be lost
 *  just because our storage had a bad moment. Single source of truth in
 *  lib/legal/company.ts so the contact never drifts across surfaces. */
const CONTACT_EMAIL = COMPANY.contactEmail;

/** Shape shared with ServicesPortal's SERVICES entries and its `general`
 *  pseudo-service (hero / closing CTAs) — structurally identical on purpose. */
export interface InquiryService {
  slug: string;
  name: string;
  blurb: string;
  icon: LucideIcon;
  /** Job-site photo shown as the modal's right-hand "book" panel (desktop).
   *  Optional: the `general` enquiry path has no single trade photo, so it
   *  falls back to a form-only modal. */
  photo?: StaticImageData;
  /** Full service description carried verbatim from the public site's service
   *  detail page (see SERVICES in ServicesPortal.tsx). Rendered under the
   *  photo on the desktop book panel, and above the form on mobile — so the
   *  visitor sees what the trade covers at the point of enquiry. "\n\n"
   *  separates paragraphs. Optional: `general` has no site page. */
  description?: string;
  /** The site page's "what's included" bullets, shown after the description. */
  includes?: string[];
}

type Status = "idle" | "sending" | "sent" | "error";

/** Shape of GET /api/portal/legal — the current published policy the customer
 *  agrees to. `placeholder` is true until lawyer-reviewed wording is set. */
interface LegalInfo {
  version: string;
  termsHtml: string;
  privacyHtml: string;
  placeholder: boolean;
}

/**
 * Customer-facing enquiry modal for the services portal. Mirrors the
 * CloseDealModal grammar exactly (AnimatePresence, z-[80]/[81] backdrop +
 * dialog, focus trap with restore, Escape closes, header icon + title + X,
 * footer Buttons) so both surfaces feel like the same product.
 *
 * The lead-safety contract: a network or server failure NEVER discards what
 * the visitor typed — the form stays populated, an inline error explains what
 * happened, and a prefilled mailto: link offers a second path to the team.
 * Demo mode (no Supabase configured) still resolves to the thank-you state so
 * the portal never looks broken to a customer.
 *
 * Telemetry: the successful submit is tracked manually (`portal_inquiry_submit`)
 * because only the API response tells us it landed; the Cancel button is
 * declaratively tracked via data-track like every other element.
 */
export function ServiceInquiryModal({
  service,
  onClose,
  standalone = false,
}: {
  service: InquiryService | null;
  onClose: () => void;
  /** True on the public /portal host. Gates the customer-facing consent
   *  requirement + the `consent_accept` funnel event (the internal "Our
   *  Services" demo tab must not require consent nor pollute the funnel). */
  standalone?: boolean;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  /** Success-panel Done button — focused when the form unmounts on send. */
  const doneRef = useRef<HTMLButtonElement>(null);
  /** Inline error region — focused when a failed send disables the submit. */
  const errorRef = useRef<HTMLDivElement>(null);

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [message, setMessage] = useState("");
  /** Honeypot — see the hidden field below. Humans never touch it. */
  const [website, setWebsite] = useState("");
  const [emailTouched, setEmailTouched] = useState(false);
  /** Consent gate (customer host only): the enquirer must actively tick this
   *  before we collect their details. Unticked by default (active consent, per
   *  OAIC guidance) and re-armed per enquiry. */
  const [consentChecked, setConsentChecked] = useState(false);
  /** Current published legal docs, fetched on open so we show the exact text +
   *  version the customer agrees to and pin that version onto the submission. */
  const [legal, setLegal] = useState<LegalInfo | null>(null);
  /** Which doc is expanded inline (T&C / Privacy), or null. */
  const [openDoc, setOpenDoc] = useState<"terms" | "privacy" | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  /** Mirror of `status` readable inside the open-effect without adding it to
   *  the deps (which would re-run the reset mid-flow). */
  const statusRef = useRef<Status>("idle");
  function setStatusBoth(next: Status) {
    statusRef.current = next;
    setStatus(next);
  }

  useFocusTrap(!!service, ref);

  useEffect(() => {
    if (!service) return;
    // Only wipe the form after a *successful* send — if the visitor closed on
    // an error (or just changed their mind mid-typing) their words are still
    // here when they reopen. Losing a typed-out enquiry loses the lead.
    if (statusRef.current === "sent") {
      setName("");
      setEmail("");
      setPhone("");
      setMessage("");
    }
    setStatusBoth("idle");
    setWebsite("");
    setEmailTouched(false);
    // Re-arm consent per enquiry — an earlier acceptance must never silently
    // carry over to a new submission (or a new terms version).
    setConsentChecked(false);
    setOpenDoc(null);
    // Focus the first field after the trap's initial focus + paint — EXCEPT
    // when the in-form description block opens the body (below-sm with a
    // description, or any width without a photo panel): focusing the Name
    // input would scroll the body straight past the copy the modal exists to
    // surface, and pop a phone keyboard over it. There the trap's default
    // focus (the header's Close button) is the right resting place.
    const descriptionLeadsForm =
      !!service.description &&
      !(service.photo && window.matchMedia("(min-width: 640px)").matches);
    if (!descriptionLeadsForm) {
      requestAnimationFrame(() => nameRef.current?.focus());
    }
  }, [service]);

  // Fetch the current published legal docs when the modal opens (customer host
  // only — the internal demo tab neither gates nor records consent). We pin the
  // returned `version` onto the submission; the server re-validates it against
  // the live version, so a stale fetch can't smuggle bad consent through.
  useEffect(() => {
    if (!service || !standalone) return;
    let cancelled = false;
    fetch("/api/portal/legal", { headers: { "Content-Type": "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: (LegalInfo & { ok?: boolean }) | null) => {
        if (cancelled || !j || j.ok === false) return;
        setLegal({
          version: String(j.version ?? ""),
          termsHtml: String(j.termsHtml ?? ""),
          privacyHtml: String(j.privacyHtml ?? ""),
          placeholder: Boolean(j.placeholder),
        });
      })
      .catch(() => {
        /* leave legal null → the consent block shows a soft "unavailable" note
           and the submit stays gated (fail-closed) on the customer host */
      });
    return () => {
      cancelled = true;
    };
  }, [service, standalone]);

  useEffect(() => {
    if (!service) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [service, onClose]);

  // Keep keyboard focus inside the dialog across the submit transitions: when
  // the send lands the whole form (including the focused, now-disabled submit
  // button) unmounts for the success panel, and on failure the focused button
  // is disabled — either way the browser drops focus to <body>, where the
  // container-scoped focus trap can't recover it and the next Tab would land
  // on obscured page content behind the modal. Refocus explicitly.
  useEffect(() => {
    if (status === "sent") {
      requestAnimationFrame(() => doneRef.current?.focus());
    } else if (status === "error") {
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  }, [status]);

  const emailValid = EMAIL_RE.test(email.trim());
  const showEmailError = emailTouched && email.trim() !== "" && !emailValid;
  const messageLength = message.trim().length;
  /** Started typing but under the minimum — surface WHY Send is disabled
   *  instead of leaving a silently-dead button on a conversion-critical form. */
  const showMessageHint = messageLength > 0 && messageLength < MIN_MESSAGE;
  /** On the customer host consent is mandatory: a real (non-placeholder) policy
   *  must be loaded AND the box ticked. On the internal demo tab it's not
   *  required. If the policy fetch failed or is a placeholder, consent can't be
   *  validly given, so the gate stays closed (matches the server's fail-closed
   *  rule) — the customer sees why. */
  const consentReady = !!legal && !legal.placeholder;
  const consentSatisfied = !standalone || (consentReady && consentChecked);
  const valid = emailValid && messageLength >= MIN_MESSAGE && consentSatisfied;

  async function submit() {
    if (!service || !valid || status === "sending") return;
    setStatusBoth("sending");
    try {
      const res = await fetch("/api/portal/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: service.slug,
          serviceName: service.name,
          name: name.trim() || undefined,
          email: email.trim(),
          phone: phone.trim() || undefined,
          message: message.trim(),
          // The pinned legal version the customer ticked (customer host only).
          // The server re-validates it against the live published version and
          // refuses to store PII without a valid, current match.
          consentVersion: standalone ? legal?.version : undefined,
          // The honeypot rides along untouched; the server silently drops
          // any submission where a "visitor" filled it in.
          website,
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (res.ok && json?.ok) {
        // Success is tracked manually — a raw click on the submit button says
        // nothing about whether the enquiry actually landed. Demo mode
        // (`mode:"demo"`) counts too: the visitor saw a thank-you.
        track("portal_inquiry_submit", { service: service.slug });
        // Behavioural consent log (customer host only, per the funnel's host
        // discrimination). The AUTHORITATIVE consent record is the server-side
        // consent_version on the stored enquiry row; this event is complementary
        // — a timestamped, attributed "they ticked it" signal for the admin
        // telemetry. Never fired from the internal demo tab.
        if (standalone && legal?.version) {
          track("consent_accept", { version: legal.version, scope: "enquiry", service: service.slug });
        }
        setStatusBoth("sent");
      } else {
        setStatusBoth("error");
      }
    } catch {
      /* network down / blocked — the form keeps everything they typed */
      setStatusBoth("error");
    }
  }

  const mailtoFallback = service
    ? `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
        `APMG Services enquiry — ${service.name}`,
      )}&body=${encodeURIComponent(message)}`
    : "#";

  return (
    <AnimatePresence>
      {service && (
        <>
          <motion.div
            className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            onClick={onClose}
            aria-hidden
          />
          {/* This full-viewport wrapper sits ABOVE the z-[80] backdrop, so it —
              not the backdrop — receives every click outside the dialog card.
              Close on those (currentTarget check keeps clicks inside the card,
              which bubble up here, from dismissing) — the spec's backdrop-close. */}
          <div
            className="fixed inset-0 z-[81] flex items-center justify-center p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget) onClose();
            }}
          >
            <motion.div
              ref={ref}
              role="dialog"
              aria-modal="true"
              aria-label={`Enquire about ${service.name}`}
              tabIndex={-1}
              className={cn(
                // max-h caps the dialog to the viewport (minus the wrapper's
                // p-4) so header + footer stay reachable on short viewports —
                // e.g. landscape phones — with the body shrinking + scrolling
                // via the flex chain below instead of clipping.
                "flex max-h-[calc(100dvh-2rem)] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none",
                // "Book split in half": with a trade photo, the dialog widens on
                // desktop into a two-panel spread — form on the left, photo card
                // on the right. Without one (the `general` enquiry), it stays the
                // original single narrow column. Mobile is always single-column
                // (a book can't open on a phone) — the photo panel hides below sm.
                service.photo ? "w-[min(94vw,460px)] sm:w-[min(94vw,860px)]" : "w-[min(94vw,460px)]",
              )}
              initial={reduce ? false : { opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
              transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
            >
              {/* ── Left page: header + form/success (the whole existing dialog
                  body). min-w-0 lets it shrink beside the photo panel; on desktop
                  with a photo it takes the left half, else the full width. ── */}
              <div className="flex min-w-0 flex-1 flex-col">
              {/* header */}
              <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-solid text-primary-foreground">
                  <service.icon className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-heading text-base font-semibold text-foreground">
                    Enquire — {service.name}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Tell us a bit about what you need and our team will take it from there.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {status === "sent" ? (
                /* success state — the body swaps wholesale, no lingering form */
                <div role="status" className="flex flex-col items-center px-5 py-10 text-center">
                  <motion.div
                    initial={reduce ? false : { scale: 0.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
                    className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-solid text-primary-foreground shadow-lg"
                  >
                    <CircleCheck className="h-6 w-6" aria-hidden />
                  </motion.div>
                  <h3 className="mt-3 font-heading text-base font-semibold text-foreground">
                    Enquiry received
                  </h3>
                  {/* Copy rule (Company-Brief): never promise a response time
                      without an agreement in place. Instead: name the process
                      and give an urgent path that doesn't depend on our queue. */}
                  <p className="mt-1 max-w-sm text-xs leading-relaxed text-muted-foreground">
                    Thanks — one of our team will be in touch to understand the
                    job and arrange a quote. If it&rsquo;s urgent, call us on{" "}
                    <a
                      href={COMPANY.phoneHref}
                      className="font-semibold text-primary underline underline-offset-2"
                    >
                      {COMPANY.phone}
                    </a>
                    .
                  </p>
                  <Button
                    ref={doneRef}
                    size="sm"
                    onClick={onClose}
                    data-track="portal_inquiry_done"
                    data-track-service={service.slug}
                    className="mt-5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
                  >
                    Done
                  </Button>
                </div>
              ) : (
                /* noValidate: our inline validation gates the submit button, so
                   the browser's native bubbles never fight the styled states */
                <form
                  noValidate
                  // flex chain (dialog max-h → form → body): under a squeezed
                  // viewport the body is what shrinks and scrolls, keeping the
                  // footer's Send button on screen.
                  className="flex min-h-0 flex-1 flex-col"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void submit();
                  }}
                >
                  {/* body — capped height so the modal survives short viewports */}
                  <div className="max-h-[min(62vh,540px)] min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    {/* Service description — the site detail-page copy, so the
                        enquiry opens on what the trade actually covers. On
                        desktop the book's photo panel carries it (hidden here);
                        this in-form block is the mobile surface, and the only
                        surface when there's no photo panel. */}
                    {service.description && (
                      <div
                        className={cn(
                          "space-y-2.5 rounded-lg bg-muted/40 p-3",
                          service.photo && "sm:hidden",
                        )}
                      >
                        <ServiceDescription service={service} />
                      </div>
                    )}

                    {/* What happens next — a form is an anxious hand-off to a
                        stranger; naming the process (Company-Brief: "poor
                        follow-up after quoting" is a top client pain point)
                        turns it into a known one. No response-time promises. */}
                    <ol className="flex flex-col gap-1 rounded-lg bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground sm:flex-row sm:gap-4">
                      {[
                        "We call or email to understand the job",
                        "We arrange a time to inspect and quote",
                        "One point of contact through to completion",
                      ].map((step, i) => (
                        <li key={step} className="flex items-start gap-1.5 sm:flex-1">
                          <span className="mt-px font-mono text-[10px] font-semibold text-primary">
                            {i + 1}.
                          </span>
                          {step}
                        </li>
                      ))}
                    </ol>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="enquiry-name"
                        className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                      >
                        Name
                      </label>
                      <input
                        id="enquiry-name"
                        ref={nameRef}
                        type="text"
                        autoComplete="name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Your name"
                        className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="enquiry-email"
                        className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                      >
                        Work email <span className="text-primary">*</span>
                      </label>
                      <input
                        id="enquiry-email"
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => setEmailTouched(true)}
                        aria-invalid={showEmailError || undefined}
                        aria-describedby={showEmailError ? "enquiry-email-error" : undefined}
                        placeholder="you@company.com.au"
                        className={`h-9 w-full rounded-lg border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                          showEmailError ? "border-destructive" : "border-input"
                        }`}
                      />
                      {showEmailError && (
                        /* --primary is the AA-safe short-red-text state (§15).
                           id wires it to the input via aria-describedby so
                           screen readers announce the REASON, not just
                           aria-invalid's bare "invalid entry". */
                        <p id="enquiry-email-error" className="text-[11px] text-primary">
                          That email doesn&rsquo;t look right — please check it.
                        </p>
                      )}
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="enquiry-phone"
                        className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                      >
                        Phone
                      </label>
                      <input
                        id="enquiry-phone"
                        type="tel"
                        autoComplete="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="Optional — if you'd prefer a call"
                        className="h-9 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label
                        htmlFor="enquiry-message"
                        className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                      >
                        What do you need done? <span className="text-primary">*</span>
                      </label>
                      <textarea
                        id="enquiry-message"
                        required
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        rows={4}
                        aria-describedby="enquiry-message-hint"
                        placeholder="A little about the job — the site or property, what needs doing, and when you'd like it done…"
                        className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                      />
                      {/* One wired hint slot: while the message is under the
                          minimum it says exactly why Send is still disabled
                          (no silently-dead button); otherwise the friendly
                          detail nudge. --primary = AA-safe short red text. */}
                      <p
                        id="enquiry-message-hint"
                        className={`text-[11px] ${showMessageHint ? "text-primary" : "text-muted-foreground"}`}
                      >
                        {showMessageHint
                          ? `A few more words, please — at least ${MIN_MESSAGE} characters so we can point the right tradesperson at it.`
                          : "The more detail the better — it helps us send the right tradesperson."}
                      </p>
                    </div>

                    {/* Consent gate — customer host only. Mandatory active
                        opt-in to the current Terms & Privacy Policy before any
                        PII is collected. The links expand the exact published
                        text inline so consent is informed; the version is
                        pinned onto the submission and re-checked server-side. */}
                    {standalone && (
                      <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                        {consentReady ? (
                          <>
                            <label className="flex cursor-pointer items-start gap-2.5">
                              <input
                                type="checkbox"
                                checked={consentChecked}
                                onChange={(e) => setConsentChecked(e.target.checked)}
                                className="mt-0.5 h-4 w-4 shrink-0 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
                              />
                              <span className="text-[12px] leading-relaxed text-foreground">
                                I agree to {COMPANY.tradingName}&rsquo;{" "}
                                <button
                                  type="button"
                                  onClick={() => setOpenDoc(openDoc === "terms" ? null : "terms")}
                                  className="font-medium text-primary underline underline-offset-2"
                                >
                                  Terms &amp; Conditions
                                </button>{" "}
                                and{" "}
                                <button
                                  type="button"
                                  onClick={() => setOpenDoc(openDoc === "privacy" ? null : "privacy")}
                                  className="font-medium text-primary underline underline-offset-2"
                                >
                                  Privacy Policy
                                </button>
                                , and to APMG contacting me about my enquiry. Please don&rsquo;t
                                include sensitive personal information in your message.
                              </span>
                            </label>
                            {openDoc && legal && (
                              <div
                                className="max-h-72 overflow-y-auto rounded-md border border-border bg-background p-3.5 text-[12px] leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-foreground [&_h2:first-child]:mt-0 [&_p]:mb-2.5 [&_strong]:text-foreground"
                                // Operator-authored, lawyer-reviewed policy text
                                // from the Legal Documents tab (trusted source).
                                dangerouslySetInnerHTML={{
                                  __html: openDoc === "terms" ? legal.termsHtml : legal.privacyHtml,
                                }}
                              />
                            )}
                          </>
                        ) : (
                          /* No published policy (or fetch failed): we cannot
                             validly collect consent, so we say so and the submit
                             stays disabled (fail-closed, matches the server). */
                          <p className="text-[12px] leading-relaxed text-muted-foreground">
                            Our enquiry form is briefly unavailable. Please email us at{" "}
                            <a
                              href={mailtoFallback}
                              className="font-medium text-primary underline underline-offset-2"
                            >
                              {CONTACT_EMAIL}
                            </a>{" "}
                            and we&rsquo;ll help you directly.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Honeypot. Visually hidden and out of the tab order —
                        real visitors never see it, automated form-fillers do,
                        and the server silently drops any submission that
                        carries a value here. Never referenced in visible copy. */}
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute -left-[9999px] top-0 h-px w-px overflow-hidden"
                    >
                      <label htmlFor="enquiry-website">Website</label>
                      <input
                        id="enquiry-website"
                        name="website"
                        type="text"
                        tabIndex={-1}
                        autoComplete="off"
                        value={website}
                        onChange={(e) => setWebsite(e.target.value)}
                      />
                    </div>

                    {status === "error" && (
                      /* Red discipline (§15): red icon + solid-surface text,
                         never red text on a /10 tint. The typed values are
                         untouched — this panel only adds a second path out. */
                      <div
                        ref={errorRef}
                        tabIndex={-1}
                        role="alert"
                        className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-background p-3 outline-none"
                      >
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
                        <div className="min-w-0 text-xs leading-relaxed text-foreground">
                          We couldn&rsquo;t send your enquiry just now. Everything you typed is
                          still here — please try again, or{" "}
                          <a
                            href={mailtoFallback}
                            data-track="portal_inquiry_mailto"
                            data-track-service={service.slug}
                            className="font-medium text-primary underline underline-offset-2"
                          >
                            email us directly
                          </a>{" "}
                          and we&rsquo;ll pick it up from there.
                        </div>
                      </div>
                    )}
                  </div>

                  {/* footer */}
                  <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onClose}
                      data-track="portal_inquiry_cancel"
                      data-track-service={service.slug}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!valid || status === "sending"}
                      className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
                    >
                      {status === "sending" ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                      ) : (
                        <Send className="h-4 w-4" aria-hidden />
                      )}
                      {status === "sending" ? "Sending…" : "Send enquiry"}
                    </Button>
                  </div>
                </form>
              )}
              </div>

              {/* ── Right page: the trade photo + the service's site description,
                  like the facing page of an open book. Desktop-only (hidden below
                  sm so the mobile modal stays a clean single column — the form
                  body carries the description there). A thin left border is the
                  book's spine; the bottom gradient + service name caption seat
                  the image and name the trade the enquiry is about.
                  Decorative → alt="". ── */}
              {service.photo && (
                // rounded-r-2xl matches the dialog's own radius on THIS panel so
                // the corner is clipped here too — Safari/WebKit can leak a
                // child's square corner past a parent's `overflow-hidden` +
                // rounded corners when the child forms its own stacking context,
                // and the belt-and-braces radius closes that gap.
                <div className="relative hidden w-[46%] shrink-0 self-stretch overflow-hidden rounded-r-2xl border-l border-border bg-muted sm:block">
                  {/* absolute inset-0 so the panel contributes ZERO intrinsic
                      height: the form column keeps governing the dialog height
                      (exactly as it did when this page was photo-only), and
                      description copy that doesn't fit scrolls instead of
                      stretching the dialog past the viewport. */}
                  <div className="absolute inset-0 flex flex-col">
                    {/* photo box: fixed height when the description shares the
                        page, the whole page when there's none (legacy layout) */}
                    <div
                      className={cn(
                        "relative shrink-0",
                        service.description ? "h-44 lg:h-52" : "flex-1",
                      )}
                    >
                      <Image
                        src={service.photo}
                        alt=""
                        fill
                        placeholder="blur"
                        sizes="400px"
                        // object-COVER fills the book's right page edge-to-edge —
                        // matte bars around a letterboxed photo read as placeholder
                        // content, matching the card banners and the hero.
                        className="object-cover object-center"
                      />
                      {/* bottom scrim so the caption stays legible over any photo */}
                      <span
                        aria-hidden
                        className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-black/70 via-black/20 to-transparent"
                      />
                      <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 p-4">
                        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/15 text-white backdrop-blur-sm ring-1 ring-white/25">
                          <service.icon className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="font-heading text-sm font-semibold text-white drop-shadow-[0_1px_6px_rgba(0,0,0,0.8)]">
                          {service.name}
                        </span>
                      </div>
                    </div>
                    {/* the site detail-page copy for this trade — what "Enquire"
                        is actually about. min-h-0 + overflow-y-auto keeps a long
                        description scrolling inside the page rather than
                        stretching the dialog past the form column. */}
                    {service.description && (
                      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto border-t border-border bg-card p-4">
                        <ServiceDescription service={service} />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

/**
 * The service's site detail-page copy: description paragraphs plus the
 * "What's included" bullets. One body, two hosts — the desktop book panel and
 * the mobile in-form block — so the two surfaces can never drift apart.
 * Renders nothing without a description (the `general` enquiry path).
 */
function ServiceDescription({ service }: { service: InquiryService }) {
  if (!service.description) return null;
  return (
    <>
      {service.description.split("\n\n").map((para) => (
        <p key={para.slice(0, 32)} className="text-xs leading-relaxed text-muted-foreground">
          {para}
        </p>
      ))}
      {service.includes && service.includes.length > 0 && (
        <div>
          <h3 className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            What&rsquo;s included
          </h3>
          <ul className="mt-1.5 space-y-1">
            {service.includes.map((item) => (
              <li
                key={item}
                className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground"
              >
                <CircleCheck className="mt-0.5 h-3 w-3 shrink-0 text-primary" aria-hidden />
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
