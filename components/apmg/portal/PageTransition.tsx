"use client";

import { motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * The movement between portal pages: the incoming page rises 10px and sharpens
 * in over ~0.4s, on the same decelerating curve the scroll reveal uses.
 *
 * THE FIRST PAGE IS NOT ANIMATED. A visitor arriving from an outreach email must
 * see the services grid at once — fading the landing page in would delay the
 * largest paint on the one screen that has to land instantly. `hasShown` is
 * module state, so it survives the remount a route `template.tsx` performs on
 * every navigation: the first mount renders still, every later one moves.
 *
 * Reduced motion gets a plain cut.
 */
let hasShown = false;

export function PageTransition({
  children,
  className,
  animateFirst = false,
}: {
  children: ReactNode;
  className?: string;
  /** The dashboard preview switches pages in place and has no landing paint to protect. */
  animateFirst?: boolean;
}) {
  const reduce = useReducedMotion();
  // Decided once per mount, and the flag is only set after commit — writing it
  // during render would let Strict Mode's second render see `true` and animate
  // the landing page after all.
  const [first] = useState(() => !hasShown && !animateFirst);
  useEffect(() => {
    hasShown = true;
  }, []);
  const still = reduce || first;

  return (
    <motion.div
      className={cn("w-full", className)}
      initial={still ? false : { opacity: 0, y: 10, filter: "blur(4px)" }}
      // `filter: none` at rest, not `blur(0px)`. Any filter value — even a zero
      // blur — makes this wrapper a containing block, and the reviews page's
      // inner scroller then leaks its full height into <main>'s scrollHeight,
      // which is exactly what the one-viewport test measures. The blur is for
      // the entrance only.
      animate={{ opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none", transform: "none" } }}
      transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
    >
      {children}
    </motion.div>
  );
}
