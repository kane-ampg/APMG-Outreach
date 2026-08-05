"use client";

import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * Mount reveal using the house ease (§14.1). Under reduced motion the entrance
 * is disabled (initial={false}) so the element simply appears (§14.5).
 */
export function Reveal({
  delay = 0,
  y = 10,
  children,
  ...rest
}: { delay?: number; y?: number } & HTMLMotionProps<"div">) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduce ? 0 : 0.34, ease: EASE, delay: reduce ? 0 : delay }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
