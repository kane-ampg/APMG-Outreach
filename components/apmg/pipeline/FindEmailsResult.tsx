"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { AlertTriangle, Check, Globe, Mail, PlugZap, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { Button } from "@/components/ui/button";

const EASE = [0.16, 1, 0.3, 1] as const;

/** Outcome of a "Find emails" run, shaped for the result modal. */
export type FindEmailsOutcome =
  | { kind: "success"; found: number; total: number }
  | { kind: "demo"; message: string }
  | { kind: "error"; message: string };

/**
 * Result modal shown after a "Find emails" run over the no-email leads. Matches
 * LeadDetail's modal grammar (centered card, dimmed/blurred backdrop, scale-in)
 * and adds a smooth AnimatePresence exit so it fades + drops out on close.
 *
 * Rendered unconditionally with `open` driving AnimatePresence — that's what
 * lets the exit animation play (a bare `{x && <Modal/>}` would unmount instantly).
 */
export function FindEmailsResult({
  open,
  outcome,
  onClose,
}: {
  open: boolean;
  outcome: FindEmailsOutcome | null;
  onClose: () => void;
}) {
  const reduce = !!useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && outcome && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            onClick={onClose}
            aria-hidden
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-label="Email finder result"
            tabIndex={-1}
            initial={reduce ? false : { opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: EASE }}
            className="relative z-10 flex w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none"
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              data-track="find_emails_result_close"
              className="absolute right-3 top-3 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>

            {outcome.kind === "success" ? (
              <SuccessBody found={outcome.found} total={outcome.total} reduce={reduce} />
            ) : outcome.kind === "demo" ? (
              <NoticeBody
                tone="info"
                icon={PlugZap}
                title="Email finder not connected"
                message={outcome.message}
              />
            ) : (
              <NoticeBody
                tone="error"
                icon={AlertTriangle}
                title="Couldn’t finish the search"
                message={outcome.message}
              />
            )}

            <div className="flex justify-end gap-2 border-t border-border px-5 py-3.5">
              <Button size="sm" onClick={onClose} data-track="find_emails_result_done">
                Done
              </Button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Success readout: hero found-count over total, with a proportion bar and a
 *  line accounting for the leads that had nothing scrapable. */
function SuccessBody({
  found,
  total,
  reduce,
}: {
  found: number;
  total: number;
  reduce: boolean;
}) {
  const missed = Math.max(0, total - found);
  const pct = total > 0 ? Math.round((found / total) * 100) : 0;
  const none = found === 0;

  return (
    <div className="flex flex-col gap-4 px-5 pb-5 pt-6">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
            none
              ? "border-border bg-muted text-muted-foreground"
              : "border-primary/40 bg-primary/10 text-primary",
          )}
          aria-hidden
        >
          {none ? <Globe className="h-5 w-5" /> : <Check className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Email finder
          </div>
          <h2 className="mt-1 text-base font-semibold leading-snug tracking-tight text-foreground">
            {none ? "No addresses found" : "Addresses found"}
          </h2>
        </div>
      </div>

      {/* hero count: found / total */}
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-1.5">
          <span className="tnum font-mono text-4xl font-semibold leading-none tracking-tight text-foreground">
            {found.toLocaleString("en-US")}
          </span>
          <span className="tnum font-mono text-sm text-muted-foreground">
            / {total.toLocaleString("en-US")}
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
          <Mail className="h-3 w-3" aria-hidden />
          {pct}%
        </span>
      </div>

      {/* proportion bar (stays in the signal-red family — ui-standards §15) */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-border"
        role="img"
        aria-label={`${found} of ${total} leads got an email address`}
      >
        <motion.div
          className="h-full rounded-full bg-primary"
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: reduce ? 0 : 0.5, ease: EASE, delay: reduce ? 0 : 0.08 }}
        />
      </div>

      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        {none ? (
          <>
            None of the {total.toLocaleString("en-US")} lead{total === 1 ? "" : "s"} had a
            scrapable address on its website.
          </>
        ) : (
          <>
            Found an email for{" "}
            <span className="font-medium text-foreground">{found.toLocaleString("en-US")}</span> of{" "}
            {total.toLocaleString("en-US")} lead{total === 1 ? "" : "s"}
            {missed > 0 ? (
              <>
                {" "}
                — the other{" "}
                <span className="font-medium text-foreground">
                  {missed.toLocaleString("en-US")}
                </span>{" "}
                had nothing scrapable.
              </>
            ) : (
              "."
            )}{" "}
            The newly-addressed lead{found === 1 ? " has" : "s have"} moved to the With email
            tab.
          </>
        )}
      </p>
    </div>
  );
}

/** Info / error notice (demo-not-connected, or a failed run). */
function NoticeBody({
  tone,
  icon: Icon,
  title,
  message,
}: {
  tone: "info" | "error";
  icon: typeof AlertTriangle;
  title: string;
  message: string;
}) {
  return (
    <div className="flex flex-col gap-4 px-5 pb-5 pt-6">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
            tone === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-primary/40 bg-primary/10 text-primary",
          )}
          aria-hidden
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Email finder
          </div>
          <h2 className="mt-1 text-base font-semibold leading-snug tracking-tight text-foreground">
            {title}
          </h2>
        </div>
      </div>
      <p
        role={tone === "error" ? "alert" : undefined}
        className="text-[12.5px] leading-relaxed text-muted-foreground"
      >
        {message}
      </p>
    </div>
  );
}
