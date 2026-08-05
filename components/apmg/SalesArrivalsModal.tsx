"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, Inbox, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { Button } from "@/components/ui/button";
import { Reveal } from "./Reveal";
import { SignalLed } from "./SignalLed";
import { useSales } from "./SalesProvider";

const EASE = [0.22, 1, 0.36, 1] as const;

/** How many of the arriving businesses to name before folding into "+N more". */
const NAMED = 4;

/**
 * "Leads just arrived" — raised over WHATEVER surface is open, so the desk
 * hears admin without having to be sitting on the Sales tab.
 *
 * Mounted once by the shell rather than by a page, which is the whole point:
 * from Overview, Enquiries, anywhere, new work announces itself.
 *
 * Two deliberate exclusions keep it from becoming noise:
 *
 *  - Not on the Sales tab. The queue there already has an inline banner and
 *    highlights the new rows; a modal would cover the very list it points at.
 *  - Not for your own hand-offs (lib/sales/selfHandoff). An admin who sends
 *    five leads over from Hot Leads should not get a popup twenty seconds later
 *    announcing their own click. Another operator's hand-offs still land.
 *
 * Dismiss and "Open Sales" both acknowledge, so it won't re-raise for the same
 * batch — only genuinely newer hand-offs bring it back.
 */
export function SalesArrivalsModal({
  suppressed,
  onOpenSales,
}: {
  /** true on the Sales tab, where the inline banner already does this job */
  suppressed?: boolean;
  onOpenSales: () => void;
}) {
  const { arrivals, recent, acknowledgeArrivals, freshIds, setPage } = useSales();
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const open = arrivals > 0 && !suppressed;

  useFocusTrap(open, ref);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") acknowledgeArrivals();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, acknowledgeArrivals]);

  // Name the businesses that actually arrived where we can — "3 new leads" is a
  // notification, "3 new leads: Bupa, Goodstart, …" is information.
  const named = recent.filter((l) => freshIds.has(l.id)).slice(0, NAMED);
  const unnamed = arrivals - named.length;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[90] bg-black/55 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            onClick={acknowledgeArrivals}
            aria-hidden
          />
          <div className="pointer-events-none fixed inset-0 z-[91] flex items-center justify-center p-4">
            <motion.div
              ref={ref}
              role="alertdialog"
              aria-modal="true"
              aria-label={`${formatInt(arrivals)} new ${arrivals === 1 ? "lead" : "leads"} from admin`}
              tabIndex={-1}
              className="pointer-events-auto w-[min(94vw,460px)] overflow-hidden rounded-2xl border border-primary/40 bg-card shadow-2xl outline-none"
              initial={reduce ? false : { opacity: 0, scale: 0.96, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
              transition={{ duration: reduce ? 0 : 0.34, ease: EASE }}
            >
              {/* header — the signal LED ties it to the desk's live indicator */}
              <div className="flex items-start gap-3 border-b border-border bg-primary/[0.06] px-5 py-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary-solid text-primary-foreground motion-safe:animate-notify-blink">
                  <Inbox className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <SignalLed />
                    <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em] text-primary">
                      From admin
                    </span>
                  </div>
                  <h2 className="mt-1 font-heading text-lg font-semibold text-foreground">
                    <span className="tnum">{formatInt(arrivals)}</span>{" "}
                    {arrivals === 1 ? "new lead" : "new leads"} just landed
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={acknowledgeArrivals}
                  aria-label="Dismiss"
                  className="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* who */}
              <div className="px-5 py-4">
                {named.length > 0 ? (
                  <ul className="flex flex-col gap-1.5">
                    {named.map((lead, i) => (
                      <Reveal key={lead.id} delay={0.04 * i}>
                        <li className="flex min-w-0 items-center gap-2.5 rounded-lg border border-border bg-background/50 px-3 py-2">
                          <span
                            aria-hidden
                            className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary-solid"
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-medium text-foreground">
                              {lead.business}
                            </span>
                            <span className="block truncate font-mono text-[11.5px] text-muted-foreground">
                              {[lead.category, lead.location].filter(Boolean).join(" · ") || "—"}
                            </span>
                          </span>
                        </li>
                      </Reveal>
                    ))}
                    {unnamed > 0 && (
                      <li className="px-3 pt-0.5 font-mono text-[11.5px] text-muted-foreground">
                        + <span className="tnum">{formatInt(unnamed)}</span> more
                      </li>
                    )}
                  </ul>
                ) : (
                  <p className="text-[14px] text-muted-foreground">
                    They&rsquo;re waiting at the top of your queue, newest first.
                  </p>
                )}
              </div>

              {/* actions */}
              <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={acknowledgeArrivals}
                  data-track="sales_arrivals_modal_dismiss"
                >
                  Later
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    // Page 1 first: the queue is ordered newest hand-off first,
                    // so that's where these leads are — landing anywhere else
                    // would show a highlighted-nothing.
                    setPage(1);
                    acknowledgeArrivals();
                    onOpenSales();
                  }}
                  data-track="sales_arrivals_modal_open"
                  className={cn(
                    "gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90",
                  )}
                >
                  Open Sales
                  <ArrowRight className="h-4 w-4" aria-hidden />
                </Button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
