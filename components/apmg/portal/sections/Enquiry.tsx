"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { COMPANY } from "@/lib/legal/company";
import { track } from "@/lib/telemetry";
import { LegalLink } from "../../LegalDocModal";
import { useEnquiry } from "../PortalShell";
import { GENERAL_SERVICE } from "../data";

/** Same minimum and email shape as ServiceInquiryModal and the server check in
 *  /api/portal/inquiries. Keep the three in step, so a value that passes here
 *  never bounces at the endpoint. `?&=#` are rejected so a crafted "email"
 *  can't smuggle mailto query params. */
const MIN_MESSAGE = 10;
const EMAIL_RE = /^[^\s@?&=#]+@[^\s@?&=#]+\.[^\s@?&=#]+$/;

type Status = "idle" | "sending" | "sent" | "error";

/** The published policy version the consent pins to. `null` = not fetched yet. */
type Legal = { version: string; placeholder: boolean } | "failed" | null;

/**
 * The closing enquiry: the "not sure which trade" path, as a form on the page
 * rather than behind a button.
 *
 * SAME PIPELINE AS THE MODAL. It posts a `general` enquiry to
 * /api/portal/inquiries with the current consent version, and the server
 * refuses to store anything without a valid email and that version. So beyond
 * the reference's name / phone / site / job it asks for an email and the
 * consent tick. The site address has no column of its own and rides at the top
 * of the message.
 *
 * THE FUNNEL. An enquiry opened in the modal counts as `portal_service_open`
 * when the modal opens. This form has no open, so the same event (via the
 * host's `openEvent`) fires once, the first time the visitor focuses a field.
 * That is also when the policy version is fetched, so a visitor who never
 * touches the form costs no request.
 *
 * The consent wording is byte-for-byte the modal's: the stored consent_version
 * is pinned to exactly these words.
 */
export function EnquirySection() {
  const { openEvent, standalone } = useEnquiry();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [site, setSite] = useState("");
  const [job, setJob] = useState("");
  /** Honeypot. Real visitors never see it; the server drops any fill. */
  const [website, setWebsite] = useState("");
  const [consent, setConsent] = useState(false);
  const [legal, setLegal] = useState<Legal>(null);
  const [status, setStatus] = useState<Status>("idle");
  /** Set on the first submit, so every outstanding field explains itself. */
  const [tried, setTried] = useState(false);
  const [emailTouched, setEmailTouched] = useState(false);

  /** The policy fetch, started on first engagement. Held so a Send pressed
   *  before it lands can wait for it instead of silently doing nothing. */
  const legalRequest = useRef<Promise<Legal> | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const jobRef = useRef<HTMLTextAreaElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);

  function engage(): Promise<Legal> {
    if (legalRequest.current) return legalRequest.current;
    track(openEvent, { service: GENERAL_SERVICE.slug }, standalone ? { view: "portal" } : {});
    legalRequest.current = fetch("/api/portal/legal", {
      headers: { "Content-Type": "application/json" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; version?: unknown; placeholder?: unknown } | null): Legal =>
        !j || j.ok === false
          ? "failed"
          : { version: String(j.version ?? ""), placeholder: Boolean(j.placeholder) },
      )
      // Fail closed: without a published policy, consent cannot validly be
      // given, so the form says so and points at email instead.
      .catch((): Legal => "failed")
      .then((result) => {
        setLegal(result);
        return result;
      });
    return legalRequest.current;
  }

  // Keep focus somewhere sensible when the form is replaced (sent) or the
  // alert appears (error); otherwise the browser drops it to <body>.
  useEffect(() => {
    if (status === "sent") requestAnimationFrame(() => doneRef.current?.focus());
    if (status === "error") requestAnimationFrame(() => errorRef.current?.focus());
  }, [status]);

  const emailValid = EMAIL_RE.test(email.trim());
  const jobLength = job.trim().length;
  const legalReady = legal !== null && legal !== "failed" && !legal.placeholder;
  const legalUnavailable = legal === "failed" || (legal !== null && legal.placeholder);

  const emailError =
    (tried || (emailTouched && email.trim() !== "")) && !emailValid
      ? email.trim() === ""
        ? "Enter an email address so we can reply."
        : "That doesn’t look like a valid email address."
      : null;
  const jobError =
    (tried || jobLength > 0) && jobLength < MIN_MESSAGE
      ? "Tell us a little more — a sentence is enough."
      : null;
  const consentError =
    tried && legalReady && !consent
      ? "Tick the box to agree to the Terms and Privacy Policy before sending."
      : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (status === "sending") return;
    setTried(true);
    // Send is never disabled while invalid (a disabled button drops out of the
    // tab order and its reason can't be heard), so take the visitor TO the
    // first thing outstanding instead.
    if (!emailValid) return emailRef.current?.focus();
    if (jobLength < MIN_MESSAGE) return jobRef.current?.focus();
    const policy = await engage();
    if (policy === null || policy === "failed" || policy.placeholder) return;
    if (!consent) return consentRef.current?.focus();

    setStatus("sending");
    const message = site.trim() ? `Site: ${site.trim()}\n\n${job.trim()}` : job.trim();
    try {
      const res = await fetch("/api/portal/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: GENERAL_SERVICE.slug,
          serviceName: GENERAL_SERVICE.name,
          name: name.trim() || undefined,
          email: email.trim(),
          phone: phone.trim() || undefined,
          message,
          consentVersion: policy.version,
          website,
        }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (res.ok && json?.ok) {
        // Tracked on success only: a click on Send says nothing about whether
        // the enquiry landed. Mirrors the modal exactly.
        track("portal_inquiry_submit", { service: GENERAL_SERVICE.slug });
        if (standalone) {
          track("consent_accept", {
            version: policy.version,
            scope: "enquiry",
            service: GENERAL_SERVICE.slug,
          });
        }
        setStatus("sent");
      } else {
        setStatus("error");
      }
    } catch {
      // Network down or blocked: everything they typed stays in the form.
      setStatus("error");
    }
  }

  const mailto = `mailto:${COMPANY.contactEmail}?subject=${encodeURIComponent(
    "APMG Services enquiry",
  )}&body=${encodeURIComponent(site.trim() ? `Site: ${site.trim()}\n\n${job}` : job)}`;

  return (
    <section id="enquiry" className="enquiry screen wrap" tabIndex={-1} aria-labelledby="enquiry-title">
      <div className="enquiry-side">
        <h2 id="enquiry-title" className="serif enquiry-title">
          Not sure which trade you need?
        </h2>
        <p className="enquiry-copy">
          Describe the job in a sentence. We reply within one business day to tell you what&rsquo;s
          involved and book a site visit.
        </p>
        <div className="enquiry-contact">
          <span>
            Or call{" "}
            <a href={COMPANY.phoneHref} data-track="portal_phone_click">
              {COMPANY.phone}
            </a>
          </span>
          <span>
            Email{" "}
            <a href={`mailto:${COMPANY.contactEmail}`} data-track="portal_email_click">
              {COMPANY.contactEmail}
            </a>
          </span>
        </div>
      </div>

      {status === "sent" ? (
        <div ref={doneRef} tabIndex={-1} className="form-done" role="status">
          <h3 className="serif form-done-title">Thanks — your enquiry is in.</h3>
          <p className="enquiry-copy">
            We&rsquo;ll reply within one business day. For anything urgent, call{" "}
            <a className="util-link" href={COMPANY.phoneHref} data-track="portal_phone_click">
              {COMPANY.phone}
            </a>
            .
          </p>
        </div>
      ) : (
        <form
          className="form"
          onSubmit={submit}
          onFocus={() => void engage()}
          noValidate
          aria-labelledby="enquiry-title"
        >
          <div className="field">
            <label className="field-label" htmlFor="enq-name">
              Your name
            </label>
            <input
              id="enq-name"
              className="field-input"
              type="text"
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="enq-phone">
              Phone
            </label>
            <input
              id="enq-phone"
              className="field-input"
              type="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
            />
          </div>
          <div className="field wide">
            <label className="field-label" htmlFor="enq-email">
              Email <span className="req" aria-hidden>*</span>
            </label>
            <input
              id="enq-email"
              ref={emailRef}
              className="field-input"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              aria-invalid={emailError ? true : undefined}
              aria-describedby={emailError ? "enq-email-error" : undefined}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setEmailTouched(true)}
            />
            {emailError && (
              <p id="enq-email-error" className="field-hint">
                {emailError}
              </p>
            )}
          </div>
          <div className="field wide">
            <label className="field-label" htmlFor="enq-site">
              Site address or suburb
            </label>
            <input
              id="enq-site"
              className="field-input"
              type="text"
              autoComplete="street-address"
              value={site}
              onChange={(e) => setSite(e.target.value)}
            />
          </div>
          <div className="field wide">
            <label className="field-label" htmlFor="enq-job">
              What needs doing? <span className="req" aria-hidden>*</span>
            </label>
            <textarea
              id="enq-job"
              ref={jobRef}
              className="field-input"
              rows={3}
              required
              maxLength={1900}
              aria-invalid={jobError && tried ? true : undefined}
              aria-describedby={jobError ? "enq-job-error" : undefined}
              value={job}
              onChange={(e) => setJob(e.target.value)}
            />
            {jobError && (
              <p id="enq-job-error" className="field-hint">
                {jobError}
              </p>
            )}
          </div>

          {/* Off-screen honeypot: filled only by bots. */}
          <div className="honeypot" aria-hidden>
            <label htmlFor="enq-website">Website</label>
            <input
              id="enq-website"
              tabIndex={-1}
              autoComplete="off"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
            />
          </div>

          <div className="field wide">
            {legalUnavailable ? (
              <p className="form-alert">
                Our enquiry form is briefly unavailable. Please email us at{" "}
                <a href={mailto}>{COMPANY.contactEmail}</a> or call{" "}
                <a href={COMPANY.phoneHref}>{COMPANY.phone}</a> and we&rsquo;ll help you directly.
              </p>
            ) : (
              <div className="consent">
                <label className="consent-label" htmlFor="enq-consent">
                  <input
                    id="enq-consent"
                    ref={consentRef}
                    className="consent-box"
                    type="checkbox"
                    aria-required="true"
                    aria-describedby={consentError ? "enq-consent-error" : undefined}
                    checked={consent}
                    onChange={(e) => setConsent(e.target.checked)}
                  />
                  <span>
                    I agree to {COMPANY.tradingName}&rsquo; Terms &amp; Conditions and Privacy
                    Policy, and to APMG contacting me about my enquiry. Please don&rsquo;t include
                    sensitive personal information in your message.
                  </span>
                </label>
                <p className="consent-docs">
                  Read the{" "}
                  <LegalLink doc="terms" className="consent-doc-link">
                    Terms &amp; Conditions
                  </LegalLink>{" "}
                  or the{" "}
                  <LegalLink doc="privacy" className="consent-doc-link">
                    Privacy Policy
                  </LegalLink>
                  .
                </p>
                {consentError && (
                  <p id="enq-consent-error" className="field-hint">
                    {consentError}
                  </p>
                )}
              </div>
            )}
          </div>

          {status === "error" && (
            <p ref={errorRef} tabIndex={-1} role="alert" className="form-alert">
              Your enquiry didn&rsquo;t send, and nothing you typed has been lost. Try again, email{" "}
              <a href={mailto}>{COMPANY.contactEmail}</a>, or call{" "}
              <a href={COMPANY.phoneHref}>{COMPANY.phone}</a>.
            </p>
          )}

          <div className="form-foot">
            <button
              type="submit"
              className="btn btn-primary btn-lg"
              disabled={status === "sending"}
            >
              {status === "sending" ? "Sending…" : "Send enquiry"}
            </button>
            <span className="form-foot-note">We reply within one business day. No obligation.</span>
          </div>
        </form>
      )}
    </section>
  );
}
