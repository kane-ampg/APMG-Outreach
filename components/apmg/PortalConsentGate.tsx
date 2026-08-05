"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FileText, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { track } from "@/lib/telemetry";

const EASE = [0.22, 1, 0.36, 1] as const;

/** sessionStorage key holding the legal version acknowledged at the page-entry
 *  gate. Namespaced like the app's other portal-side keys (apmg-*). We use
 *  SESSION storage (not localStorage) on purpose: the gate must re-appear every
 *  time the visitor opens the portal link fresh (new tab / browser), while not
 *  re-prompting on in-session re-renders or same-tab navigation. Storing the
 *  VERSION (not a bare boolean) also means bumping the published legal version
 *  re-prompts within a session too — the same re-consent rule the enquiry form
 *  uses. */
const ACK_STORAGE_KEY = "apmg-legal-ack-version";

/** Shape of GET /api/portal/legal (public, no PII — operator-authored policy
 *  text only). Mirrors the fetch in ServiceInquiryModal so the gate shows the
 *  exact same current text/version the enquiry consent pins. */
interface LegalInfo {
  version: string;
  termsHtml: string;
  privacyHtml: string;
  updatedAt: string;
  /** True until lawyer-reviewed wording is published (version === "unset"). */
  placeholder: boolean;
}

/**
 * Page-entry consent gate for the PUBLIC portal.
 *
 * Shows a modal on first visit presenting the current Terms & Conditions and
 * Privacy Policy; the visitor must click "I Accept & Continue" before the
 * portal is revealed. Acceptance is remembered in localStorage keyed by the
 * published legal VERSION, so a returning visitor is not re-prompted unless the
 * wording (and therefore the version) changes.
 *
 * This is an "acknowledge to view" gate — informational and non-blocking on
 * repeat visits — NOT the legally-recorded consent. The authoritative consent
 * record is still the server-side `consent_version` pinned onto each enquiry by
 * ServiceInquiryModal / the inquiries route; this gate simply makes the policy
 * unmissable before the customer explores the page.
 *
 * Fail-open by design: if the policy fetch fails, or no real wording is
 * published yet (placeholder), we do NOT trap the visitor behind a dead modal —
 * a services showcase must never be bricked by a legal-doc hiccup. The
 * mandatory, fail-CLOSED consent still happens at enquiry time.
 */
export function PortalConsentGate({ children }: { children: React.ReactNode }) {
  /** null = still deciding (fetching / reading storage); false = reveal portal;
   *  true = show the gate. Starts null so we never flash the modal for a
   *  visitor who has already accepted the current version. */
  const [gated, setGated] = useState<boolean | null>(null);
  const [legal, setLegal] = useState<LegalInfo | null>(null);
  const [openDoc, setOpenDoc] = useState<"terms" | "privacy">("privacy");
  const reduceMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(gated === true, dialogRef);

  useEffect(() => {
    let cancelled = false;

    // Read the version acknowledged EARLIER IN THIS SESSION; if the fetch
    // confirms it still matches the live version, we don't re-show the gate for
    // the rest of this session. A fresh visit (new tab/browser) has empty
    // sessionStorage, so the gate shows again — as intended.
    let acked = "";
    try {
      acked = sessionStorage.getItem(ACK_STORAGE_KEY) ?? "";
    } catch {
      /* private mode / storage disabled — treat as not-yet-acknowledged */
    }

    fetch("/api/portal/legal", { headers: { "Content-Type": "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        if (!j || !j.ok) {
          // Fetch failed → fail-open (reveal the portal; enquiry-time consent
          // remains the hard gate).
          setGated(false);
          return;
        }
        const info: LegalInfo = {
          version: String(j.version ?? ""),
          termsHtml: String(j.termsHtml ?? ""),
          privacyHtml: String(j.privacyHtml ?? ""),
          updatedAt: String(j.updatedAt ?? ""),
          placeholder: !!j.placeholder,
        };
        setLegal(info);
        // No published wording yet → don't gate on a placeholder.
        if (info.placeholder) {
          setGated(false);
          return;
        }
        setGated(acked !== info.version);
      })
      .catch(() => {
        if (!cancelled) setGated(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  function accept() {
    if (legal) {
      try {
        sessionStorage.setItem(ACK_STORAGE_KEY, legal.version);
      } catch {
        /* storage unavailable — acceptance still applies for this render */
      }
      // Complementary behavioural signal (the enquiry `consent_accept` event is
      // the one tied to a stored record; this marks the page-entry ack).
      track("legal_ack", { version: legal.version, scope: "gate" });
    }
    setGated(false);
  }

  return (
    <>
      {children}
      <AnimatePresence>
        {gated === true && legal && (
          <motion.div
            className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-background/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.2 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-gate-title"
          >
            <motion.div
              ref={dialogRef}
              className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-border bg-card shadow-2xl sm:rounded-2xl"
              initial={{ opacity: 0, y: reduceMotion ? 0 : 24, scale: reduceMotion ? 1 : 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: reduceMotion ? 0 : 24, scale: reduceMotion ? 1 : 0.98 }}
              transition={{ duration: reduceMotion ? 0 : 0.3, ease: EASE }}
            >
              {/* Header */}
              <div className="flex items-start gap-3 border-b border-border p-5">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 id="legal-gate-title" className="text-base font-semibold text-foreground">
                    Before you continue
                  </h2>
                  <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">
                    Please review our Terms &amp; Conditions and Privacy Policy. They explain how we
                    handle your information. Continuing means you acknowledge them.
                  </p>
                </div>
              </div>

              {/* Doc switcher */}
              <div className="flex gap-1 border-b border-border px-5 pt-3">
                {(["privacy", "terms"] as const).map((doc) => (
                  <button
                    key={doc}
                    type="button"
                    onClick={() => setOpenDoc(doc)}
                    className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors ${
                      openDoc === doc
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                    {doc === "privacy" ? "Privacy Policy" : "Terms & Conditions"}
                  </button>
                ))}
              </div>

              {/* Doc body — operator-authored, lawyer-reviewed HTML from the
                  Legal Documents store (trusted source, same as the enquiry
                  modal renders). */}
              <div
                className="min-h-0 flex-1 overflow-y-auto p-5 text-[13px] leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline [&_h1]:mb-2 [&_h1]:text-[15px] [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mb-1 [&_h2]:mt-4 [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:mb-1 [&_p]:mb-2.5 [&_strong]:text-foreground [&_ul]:mb-2.5 [&_ul]:list-disc [&_ul]:pl-5"
                dangerouslySetInnerHTML={{
                  __html: openDoc === "terms" ? legal.termsHtml : legal.privacyHtml,
                }}
              />

              {/* Footer / action */}
              <div className="flex flex-col gap-2 border-t border-border p-5">
                <Button type="button" onClick={accept} className="w-full">
                  I Accept &amp; Continue
                </Button>
                <p className="text-center text-[11px] text-muted-foreground">
                  Version {legal.version}
                  {legal.updatedAt ? ` · updated ${legal.updatedAt}` : ""}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
