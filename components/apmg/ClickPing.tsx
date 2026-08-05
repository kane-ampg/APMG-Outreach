"use client";

import { useEffect, useState } from "react";
import { useReducedMotion } from "motion/react";

interface Ping {
  id: number;
  x: number;
  y: number;
}

/**
 * Signature element: every tracked click ([data-track]) blooms a brief red
 * "signal ping" at the cursor — the click telemetry made visible. Fully
 * suppressed under reduced motion (the counter still records via telemetry).
 */
export function ClickPing() {
  const reduce = useReducedMotion();
  const [pings, setPings] = useState<Ping[]>([]);

  useEffect(() => {
    if (reduce) return;
    let seq = 0;
    function onClick(e: MouseEvent) {
      // Skip synthetic clicks (keyboard Enter/Space, programmatic .click()):
      // they report clientX/Y 0,0 and detail 0, which would bloom at the corner.
      // Telemetry still records them via its own listener.
      if (e.detail === 0) return;
      const el = (e.target as HTMLElement | null)?.closest("[data-track]");
      if (!el) return;
      const id = ++seq;
      setPings((prev) => [...prev, { id, x: e.clientX, y: e.clientY }]);
      window.setTimeout(() => {
        setPings((prev) => prev.filter((p) => p.id !== id));
      }, 520);
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [reduce]);

  if (reduce) return null;

  return (
    <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden>
      {pings.map((p) => (
        <span key={p.id} className="apmg-ping" style={{ left: p.x, top: p.y }} />
      ))}
    </div>
  );
}
