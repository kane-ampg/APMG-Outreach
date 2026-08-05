"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FileText, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { COMPANY } from "@/lib/legal/company";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Shape of GET /api/portal/legal — same contract ServiceInquiryModal uses. */
interface LegalInfo {
  version: string;
  termsHtml: string;
  privacyHtml: string;
  placeholder: boolean;
}

const TITLES = { terms: "Terms & Conditions", privacy: "Privacy Policy" } as const;

/**
 * Footer link that opens the published policy in a modal instead of navigating
 * away — a visitor mid-way down the portal shouldn't lose their place to check
 * the fine print. Mirrors the ServiceInquiryModal dialog grammar (AnimatePresence,
 * z-[80]/[81] backdrop + card, focus trap, Escape closes, header + X) so both
 * surfaces feel like the same product.
 *
 * The text is fetched from /api/portal/legal on first open — the same single
 * source the enquiry consent pins — so the modal can never drift from the text
 * consented to. The standalone /portal/terms + /portal/privacy pages stay live
 * for shareable/bookmarkable URLs; a "full page" link in the modal points there.
 */
export function LegalLink({
  doc,
  className,
  children,
}: {
  doc: "terms" | "privacy";
  className?: string;
  children: React.ReactNode;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  /** null = not fetched yet; `placeholder: true` still renders (honest copy). */
  const [legal, setLegal] = useState<LegalInfo | null>(null);
  const [failed, setFailed] = useState(false);

  useFocusTrap(open, ref);

  // Fetch once, on first open — footer renders on every portal view and the
  // policy text is only needed if someone actually looks.
  useEffect(() => {
    if (!open || legal || failed) return;
    let cancelled = false;
    fetch("/api/portal/legal", { headers: { "Content-Type": "application/json" } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: (LegalInfo & { ok?: boolean }) | null) => {
        if (cancelled) return;
        if (!j || j.ok === false) {
          setFailed(true);
          return;
        }
        setLegal({
          version: String(j.version ?? ""),
          termsHtml: String(j.termsHtml ?? ""),
          privacyHtml: String(j.privacyHtml ?? ""),
          placeholder: Boolean(j.placeholder),
        });
      })
      .catch(() => setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [open, legal, failed]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const title = TITLES[doc];
  const html = legal ? (doc === "terms" ? legal.termsHtml : legal.privacyHtml) : "";
  const showPlaceholder = failed || (legal !== null && legal.placeholder);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-track="portal_legal_open"
        data-track-doc={doc}
        className={className}
      >
        {children}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-[1px]"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce ? 0 : 0.18 }}
              aria-hidden
            />
            {/* Full-viewport wrapper above the backdrop receives outside
                clicks; the currentTarget check keeps card clicks from
                dismissing (same backdrop-close pattern as the enquiry modal). */}
            <div
              className="fixed inset-0 z-[81] flex items-center justify-center p-4"
              onClick={(e) => {
                if (e.target === e.currentTarget) setOpen(false);
              }}
            >
              <motion.div
                ref={ref}
                role="dialog"
                aria-modal="true"
                aria-label={title}
                tabIndex={-1}
                className="flex max-h-[calc(100dvh-2rem)] w-[min(94vw,640px)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none"
                initial={reduce ? false : { opacity: 0, scale: 0.96, y: 8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
                transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
              >
                {/* header */}
                <div className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-solid text-primary-foreground">
                    <FileText className="h-5 w-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-heading text-base font-semibold text-foreground">{title}</h2>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {COMPANY.tradingName}
                      {legal && !legal.placeholder && legal.version
                        ? ` · Version ${legal.version}`
                        : ""}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {/* body — the scrolling region, shrinks on short viewports */}
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  {showPlaceholder ? (
                    /* No published policy yet (or the fetch failed): honest
                       fallback with a direct contact path — never boilerplate
                       presented as a real policy (same rule as LegalDocPage). */
                    <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
                      This document is being finalised. If you have any questions about
                      how we handle your information in the meantime, contact us at{" "}
                      <a
                        href={`mailto:${COMPANY.contactEmail}`}
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        {COMPANY.contactEmail}
                      </a>{" "}
                      or call{" "}
                      <a
                        href={COMPANY.phoneHref}
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        {COMPANY.phone}
                      </a>
                      .
                    </p>
                  ) : legal ? (
                    <div
                      className={cn(
                        "text-sm leading-relaxed text-muted-foreground",
                        "[&_a]:text-primary [&_a]:underline [&_h1]:mb-2 [&_h1]:mt-6 [&_h1]:font-heading [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-foreground [&_h1:first-child]:mt-0 [&_h2]:mb-1.5 [&_h2]:mt-5 [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h2:first-child]:mt-0 [&_li]:mb-1 [&_p]:mb-3 [&_strong]:text-foreground [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5",
                      )}
                      // Operator-authored, lawyer-reviewed policy text from the
                      // Legal Documents store (trusted source — same as the
                      // enquiry modal and the /portal/terms page).
                      dangerouslySetInnerHTML={{ __html: html }}
                    />
                  ) : (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  )}
                </div>

                {/* footer: the shareable page stays one click away, so opening
                    in a modal never costs anyone the bookmarkable URL */}
                <div className="shrink-0 border-t border-border px-5 py-3 text-right">
                  <a
                    href={`/portal/${doc}`}
                    target="_blank"
                    rel="noopener"
                    className="text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
                  >
                    Open as full page ↗
                  </a>
                </div>
              </motion.div>
            </div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
