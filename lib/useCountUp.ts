"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { formatKpi, type KpiFormat } from "@/lib/format";

/**
 * Odometer-style count-up for KPI readouts (ui-standards §14.5 CountUp).
 * Renders `fallback` (the final string) for SSR / no-JS / reduced motion,
 * then ticks from 0 → target on mount. Snaps instantly under reduced motion.
 */
export function useCountUp(
  target: number,
  format: KpiFormat,
  fallback: string,
  duration = 0.8,
): string {
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(fallback);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    if (reduce) {
      setDisplay(formatKpi(target, format));
      return;
    }
    let start: number | null = null;
    const ms = duration * 1000;
    const step = (t: number) => {
      if (start === null) start = t;
      const p = Math.min((t - start) / ms, 1);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic — settles, no bounce
      setDisplay(formatKpi(target * eased, format));
      if (p < 1) raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [target, format, duration, reduce]);

  return display;
}
