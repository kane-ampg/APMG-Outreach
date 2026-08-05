"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Undo2, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { formatInt } from "@/lib/format";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { type SalesLead } from "@/lib/data/sales";
import { MAX_NOTE_LEN } from "@/lib/sales/handoff";

const EASE = [0.22, 1, 0.36, 1] as const;

/** One-tap reasons for the overwhelmingly common cases. Tapping one fills the
 *  note (still editable) so returning a lead is a two-click job, not an essay. */
const QUICK_REASONS = [
  "We already work with them",
  "Existing client of ours",
  "Wrong contact / not the decision maker",
  "Not a fit for our services",
  "Asked not to be contacted",
];

/** How many of a batch to name before folding the rest into "+N more". */
const NAMED = 5;

/**
 * Send one lead — or a whole selection — back to admin. Unlike the close-deal
 * modal the note is OPTIONAL: the point is to make returning frictionless so
 * reps actually do it rather than sitting on leads they can't work. The quick
 * reasons cover the usual cases in one tap, and anything typed goes back to
 * admin on the Hot Leads tab.
 *
 * A batch shares ONE note, which is exactly the case it exists for — a rep
 * recognising a group they already service and saying so once.
 *
 * Follows ui-standards §10 (icon + side-effect description + two buttons) and
 * traps focus / restores it on close, same as CloseDealModal.
 */
export function ReturnLeadModal({
  leads,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  /** empty = closed. One entry is the per-row action; more is a bulk return. */
  leads: SalesLead[];
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (note: string) => void;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState("");

  const open = leads.length > 0;
  const many = leads.length > 1;
  // Stable across renders so the effects below don't re-fire on every poll.
  const key = leads.map((l) => l.id).join(",");

  useFocusTrap(open, ref);

  useEffect(() => {
    if (!key) return;
    setNote("");
    requestAnimationFrame(() => noteRef.current?.focus());
  }, [key]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            onClick={busy ? undefined : onCancel}
            aria-hidden
          />
          <div className="fixed inset-0 z-[81] flex items-center justify-center p-4">
            <motion.div
              ref={ref}
              role="dialog"
              aria-modal="true"
              aria-label={
                many
                  ? `Return ${formatInt(leads.length)} leads to admin`
                  : `Return ${leads[0].business} to admin`
              }
              tabIndex={-1}
              className="w-[min(94vw,480px)] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none"
              initial={reduce ? false : { opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
              transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
            >
              {/* header */}
              <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground">
                  <Undo2 className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-heading text-base font-semibold text-foreground">
                    Return to admin
                  </h2>
                  <p className="mt-0.5 text-[13px] text-muted-foreground">
                    {many ? (
                      <>
                        <span className="tnum font-medium text-foreground">
                          {formatInt(leads.length)} leads
                        </span>{" "}
                        leave your queue and go back to admin, all under the one reason below.
                      </>
                    ) : (
                      <>
                        <span className="font-medium text-foreground">{leads[0].business}</span>{" "}
                        leaves your queue and goes back to admin. Tell them why, so it isn&rsquo;t
                        sent again.
                      </>
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onCancel}
                  disabled={busy}
                  aria-label="Cancel"
                  className="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* body */}
              <div className="space-y-4 px-5 py-4">
                {/* A bulk return is irreversible-ish (admin has to send them
                    back), so the selection is spelled out before confirming. */}
                {many && (
                  <ul className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border bg-background/50 px-3 py-2">
                    {leads.slice(0, NAMED).map((l) => (
                      <li key={l.id} className="truncate text-[13px] text-foreground">
                        {l.business}
                      </li>
                    ))}
                    {leads.length > NAMED && (
                      <li className="font-mono text-[11.5px] text-muted-foreground">
                        + <span className="tnum">{formatInt(leads.length - NAMED)}</span> more
                      </li>
                    )}
                  </ul>
                )}

                <div className="flex flex-wrap gap-1.5">
                  {QUICK_REASONS.map((r) => (
                    <button
                      key={r}
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setNote(r);
                        noteRef.current?.focus();
                      }}
                      data-track="return_lead_reason"
                      className={cn(
                        "rounded-full border px-2.5 py-1 text-[12.5px] transition-colors disabled:opacity-50",
                        note === r
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      )}
                    >
                      {r}
                    </button>
                  ))}
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="return-note"
                    className="text-[12px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                  >
                    Note for admin
                  </label>
                  <textarea
                    id="return-note"
                    ref={noteRef}
                    value={note}
                    disabled={busy}
                    maxLength={MAX_NOTE_LEN}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder="Optional — e.g. we've been servicing this group for two years, don't contact again."
                    className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-[14px] text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-60"
                  />
                  <p className="text-[12px] text-muted-foreground">
                    Optional — but it&rsquo;s what stops admin sending this lead back to you.
                  </p>
                </div>

                {error && (
                  <p role="alert" className="font-mono text-[12px] text-destructive">
                    {error}
                  </p>
                )}
              </div>

              {/* footer */}
              <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onCancel}
                  disabled={busy}
                  data-track="return_lead_cancel"
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  data-track="return_lead_confirm"
                  data-track-lead={many ? undefined : leads[0].id}
                  data-track-count={leads.length}
                  onClick={() => onConfirm(note.trim())}
                  className="gap-1.5"
                >
                  <Undo2 className="h-4 w-4" aria-hidden />
                  {busy
                    ? "Returning…"
                    : many
                      ? `Return ${formatInt(leads.length)} leads`
                      : "Return lead"}
                </Button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
