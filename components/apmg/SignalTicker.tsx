"use client";

import { useEffect, useState } from "react";
import { useTelemetryCount } from "@/lib/telemetry";
import { formatClock } from "@/lib/format";
import { SignalLed } from "./SignalLed";

/**
 * The signature "proof of liveness" readout. A persistent mono status strip
 * that asserts the dashboard is reading off a live pipeline, and surfaces the
 * lifetime click-telemetry count ("pings") so the instrumentation is visible.
 */
export function SignalTicker() {
  const count = useTelemetryCount();
  const [clock, setClock] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setClock(formatClock(new Date()));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground"
      role="status"
      aria-label={`Signal live, ${count} clicks tracked`}
    >
      <SignalLed />
      <span className="text-foreground/80">Signal live</span>
      <span aria-hidden className="text-border">
        ·
      </span>
      <span className="hidden tnum sm:inline">sync {clock ?? "--:--"}</span>
      <span aria-hidden className="hidden text-border sm:inline">
        ·
      </span>
      <span className="tnum font-semibold text-foreground">
        {count.toLocaleString("en-US")} <span className="text-muted-foreground">pings</span>
      </span>
    </div>
  );
}
