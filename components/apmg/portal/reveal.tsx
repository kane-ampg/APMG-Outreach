"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Motion primitives for the customer portal.
 *
 * Ported in behaviour — not in dependency — from the APMG Painting site's
 * components/motion/. That site drives its reveal with GSAP ScrollTrigger; this
 * project has no GSAP, and ScrollTrigger would need its `scroller` pointed at
 * the portal's <main> because /portal is not the document scroller (see
 * PortalStandalone). An IntersectionObserver plus the CSS in
 * app/portal/portal-world.css produces the same movement with neither problem.
 */

/* ------------------------------------------------------------------ */
/* Scroll reveal                                                        */
/* ------------------------------------------------------------------ */

/**
 * Reveals every `[data-reveal]` element as it enters the viewport: it rises 24px
 * and fades in. Sections carry the attribute by default (see PortalSection), so
 * the page reveals a BLOCK at a time rather than element by element —
 * deliberately quieter than a per-card cascade, which on a page this long reads
 * as fidgety by the third screen.
 *
 * Mount once, near the root of the portal. Renders nothing.
 *
 * Four things this is careful about, in order of how badly they would hurt:
 *
 *  1. **No stylesheet ever hides anything.** The hidden start state needs both
 *     `data-reveal` (in the markup) and `data-reveal-armed="out"` (written only
 *     here, only after this component has run). If the bundle fails, is blocked,
 *     throws, or simply has not hydrated yet, every section renders normally. On
 *     a page whose entire job is converting a visitor who arrived from a cold
 *     email, a stylesheet that sets `opacity: 0` and waits on JS is a way to
 *     lose the page.
 *
 *  2. **Only what is below the fold is touched.** Anything already on screen
 *     when this runs is left exactly as it is — hiding it in order to animate it
 *     back would be a visible flash, and there is nothing to reveal on a scroll
 *     that has not happened. The partition is measured once, before a single
 *     attribute is written, so it is honest.
 *
 *  3. **Reduced motion means no motion.** The whole hidden/transition pair lives
 *     inside `(prefers-reduced-motion: no-preference)` in the stylesheet, so
 *     under `reduce` the attributes are inert: nothing is hidden and nothing
 *     moves. The attribute is still written, which costs nothing and keeps this
 *     component from having to duplicate the media query in JS.
 *
 *  4. **It fires once per element.** `unobserve` on entry, so a reader scrolling
 *     back up does not replay the page.
 */
export function PortalReveal() {
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;

    const targets = Array.from(
      document.querySelectorAll<HTMLElement>("[data-reveal]"),
    ).filter((el) => el.getBoundingClientRect().top > window.innerHeight);

    if (targets.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          el.dataset.revealArmed = "in";
          observer.unobserve(el);
        }
      },
      // Slightly inside the fold, so a section is settling by the time it is
      // properly readable rather than animating under the reader's nose. The
      // reference's ScrollTrigger `start: 'top 88%'`, expressed as a margin.
      { rootMargin: "0px 0px -12% 0px", threshold: 0 },
    );

    // Arm and observe in one pass, AFTER the measurement above — so nothing is
    // hidden that was not already off screen when we looked.
    for (const el of targets) {
      el.dataset.revealArmed = "out";
      observer.observe(el);
    }

    return () => {
      observer.disconnect();
      // A section must never be left hidden by a teardown. Strict-mode's
      // double-invoke, a route change, an unmount mid-scroll — all of them come
      // through here, and the safe end state is visible.
      for (const el of targets) delete el.dataset.revealArmed;
    };
  }, []);

  return null;
}

/* ------------------------------------------------------------------ */
/* In-view gate for looping animations                                  */
/* ------------------------------------------------------------------ */

/**
 * Runs a looping CSS animation only while its subject is on screen.
 *
 * Writes `data-inview="false"` when the element it wraps is out of the viewport
 * and `"true"` when it is not. Stylesheets pause on the false case (see
 * `.process-rail` in app/portal/portal-world.css). Nothing here knows or cares
 * what the animation is.
 *
 * Three things it is careful about:
 *
 *  1. **Absent, not false, until measured.** The attribute is omitted on the
 *     server and for the first client frame, and the CSS treats *absent* as
 *     running. A loop must never be left paused by a bundle that failed, an
 *     `IntersectionObserver` that does not exist, or the gap before hydration —
 *     the same rule the reveal above follows.
 *
 *  2. **Paused, not reset.** `animation-play-state` freezes the loop where it
 *     stands, so a section scrolled away mid-cycle picks up rather than jumps.
 *     Because it is always paused *off* screen, the first sight of a section is
 *     reliably the start of the cycle.
 *
 *  3. **Off screen costs nothing.** A paused animation is not composited and not
 *     sampled, so the loop is free for however long the reader spends on the
 *     rest of the page.
 */
export function InView({
  children,
  className,
  /** Fraction of the subject that must be showing before it counts as seen. */
  threshold = 0.15,
}: {
  children: ReactNode;
  className?: string;
  threshold?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState<boolean | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => setSeen(entries[entries.length - 1]?.isIntersecting ?? false),
      // A tall rail on a short viewport can never show 15% of itself and 100% of
      // the fold at once; `rootMargin` keeps it counted while it is the thing
      // being read.
      { threshold, rootMargin: "0px 0px -5% 0px" },
    );
    observer.observe(el);

    return () => observer.disconnect();
  }, [threshold]);

  return (
    <div
      ref={ref}
      className={className}
      data-inview={seen === null ? undefined : String(seen)}
    >
      {children}
    </div>
  );
}
