"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { CircleCheck, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { type SalesLead } from "@/lib/data/sales";
import type { CloseDealInput } from "./SalesProvider";

const EASE = [0.22, 1, 0.36, 1] as const;
const MIN_NOTE = 3;

/**
 * Confirmation modal for closing a deal. The rep must enter a note before the
 * confirm button enables — this guarantees every closed deal carries context
 * the team can refer back to. Follows ui-standards §10 (icon + side-effect
 * description + two buttons) and traps focus / restores it on close.
 */
export function CloseDealModal({
  lead,
  onCancel,
  onConfirm,
}: {
  lead: SalesLead | null;
  onCancel: () => void;
  onConfirm: (input: CloseDealInput) => void;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const [note, setNote] = useState("");
  const [value, setValue] = useState(0);

  useFocusTrap(!!lead, ref);

  useEffect(() => {
    if (lead) {
      setNote("");
      setValue(lead.dealValue ?? 0);
      // focus the note field after the trap's initial focus + paint
      requestAnimationFrame(() => noteRef.current?.focus());
    }
  }, [lead]);

  useEffect(() => {
    if (!lead) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [lead, onCancel]);

  const valid = note.trim().length >= MIN_NOTE;

  return (
    <AnimatePresence>
      {lead && (
        <>
          <motion.div
            className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            onClick={onCancel}
            aria-hidden
          />
          <div className="fixed inset-0 z-[81] flex items-center justify-center p-4">
            <motion.div
              ref={ref}
              role="dialog"
              aria-modal="true"
              aria-label={`Close deal with ${lead.business}`}
              tabIndex={-1}
              className="w-[min(94vw,460px)] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none"
              initial={reduce ? false : { opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
              transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
            >
              {/* header */}
              <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-solid text-primary-foreground">
                  <CircleCheck className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-heading text-base font-semibold text-foreground">Close deal</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{lead.business}</span> moves to your
                    Closed deals. Add a note so the team has the context.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onCancel}
                  aria-label="Cancel"
                  className="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* body */}
              <div className="space-y-4 px-5 py-4">
                <div className="space-y-1.5">
                  <label
                    htmlFor="close-value"
                    className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                  >
                    Closed value (USD)
                  </label>
                  <input
                    id="close-value"
                    type="number"
                    min={0}
                    step={500}
                    value={value}
                    onChange={(e) => setValue(Math.max(0, Number(e.target.value) || 0))}
                    className="tnum h-9 w-full rounded-lg border border-input bg-background px-3 font-mono text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  />
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="close-note"
                    className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                  >
                    Closing note <span className="text-primary">*</span>
                  </label>
                  <textarea
                    id="close-note"
                    ref={noteRef}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={4}
                    placeholder="Decision-maker, what was agreed, next steps, and anything the team should remember about this lead…"
                    className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    Required — this is what we&rsquo;ll see on the lead in Closed deals.
                  </p>
                </div>
              </div>

              {/* footer */}
              <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
                <Button variant="outline" size="sm" onClick={onCancel} data-track="close_deal_cancel">
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={!valid}
                  data-track="close_deal_confirm"
                  data-track-lead={lead.id}
                  onClick={() => onConfirm({ note: note.trim(), value })}
                  className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
                >
                  <CircleCheck className="h-4 w-4" aria-hidden />
                  Close deal
                </Button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
