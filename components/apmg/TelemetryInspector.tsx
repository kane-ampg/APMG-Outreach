"use client";

import { useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useFocusTrap } from "@/lib/useFocusTrap";
import {
  clearEvents,
  isEndpointConfigured,
  useTelemetryCount,
  useTelemetryLog,
} from "@/lib/telemetry";
import { SignalLed } from "./SignalLed";

const EASE = [0.16, 1, 0.3, 1] as const;

function eventTime(ts: number) {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

/**
 * Slide-in inspector that proves the click telemetry is live: it lists the most
 * recent tracked events with their props, the lifetime ping count, and whether
 * events are shipping to a configured endpoint or buffering locally (preview).
 */
export function TelemetryInspector({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reduce = useReducedMotion();
  const log = useTelemetryLog();
  const total = useTelemetryCount();
  const recent = [...log].reverse();
  const panelRef = useRef<HTMLElement>(null);
  // Focus into the panel on open, trap Tab, restore focus to the trigger on close.
  useFocusTrap(open, panelRef);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.2 }}
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            ref={panelRef}
            tabIndex={-1}
            className="fixed inset-y-0 right-0 z-[71] flex w-[min(92vw,380px)] flex-col border-l border-border bg-card shadow-2xl outline-none"
            initial={{ x: reduce ? 0 : "100%" }}
            animate={{ x: 0 }}
            exit={{ x: reduce ? 0 : "100%" }}
            transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
            role="dialog"
            aria-modal="true"
            aria-label="Telemetry inspector"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <SignalLed />
                <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
                  Telemetry
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close telemetry inspector"
                className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 py-3">
              <div>
                <div className="tnum font-mono text-xl font-semibold text-foreground">
                  {total.toLocaleString("en-US")}
                </div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  clicks tracked
                </div>
              </div>
              <div className="text-right">
                <div
                  className={
                    isEndpointConfigured()
                      ? "font-mono text-[11px] text-primary"
                      : "font-mono text-[11px] text-muted-foreground"
                  }
                >
                  {isEndpointConfigured() ? "endpoint live" : "local preview"}
                </div>
                <div className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {isEndpointConfigured() ? "sendBeacon" : "no endpoint set"}
                </div>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {recent.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <SignalLed live={false} />
                  <p className="text-sm font-medium text-foreground">No clicks yet</p>
                  <p className="text-xs text-muted-foreground">
                    Interact with the dashboard — every tracked click lands here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-border">
                  {recent.map((e) => (
                    <li key={e.id} className="px-4 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate font-mono text-[12px] font-medium text-foreground">
                          {e.name}
                        </span>
                        <span className="tnum shrink-0 font-mono text-[10px] text-muted-foreground">
                          {eventTime(e.ts)}
                        </span>
                      </div>
                      {e.target && (
                        <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {e.target}
                        </div>
                      )}
                      {Object.keys(e.props).length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {Object.entries(e.props).map(([k, v]) => (
                            <span
                              key={k}
                              className="rounded border border-border bg-muted px-1.5 py-px font-mono text-[10px] text-muted-foreground"
                            >
                              {k}=<span className="text-foreground">{v}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border px-4 py-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                last {Math.min(recent.length, 100)} events
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => clearEvents()}
                data-track="telemetry_clear"
                className="gap-1.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Clear
              </Button>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
