"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "@/lib/cn";
import { PORTAL_PAGES } from "./pages";

export type PortalHref = (typeof PORTAL_PAGES)[number]["href"];

/**
 * Primary navigation for the customer portal.
 *
 * A segmented control: the five pages sit in one sunken track and the active
 * page is a white pill that SLIDES to the next item rather than blinking out in
 * one place and in at another. The slide is a shared-layout animation
 * (`layoutId`), so the pill measures its own start and end and needs no
 * hand-kept offsets — and under reduced motion it simply jumps.
 *
 * TWO HOSTS, ONE CONTROL. On the customer host each item is a real route
 * (`next/link`, so the pages prefetch and the URL is shareable). The internal
 * "Our Services" tab renders the same portal inside the dashboard, where the
 * five pages are local state rather than routes — pass `onSelect` and `active`
 * and the items become buttons that drive that state. Same markup, same pill,
 * same motion, so the preview cannot drift from what a customer sees.
 *
 * Horizontally scrollable on phones rather than collapsed behind a hamburger:
 * five short words fit a phone's width, and a menu button would put the other
 * four pages behind an extra tap on a site whose whole point is that everything
 * is one screen away. `scrollbar-none` hides the bar without disabling the
 * scroll.
 */
export function PortalNav({
  className,
  active: activeProp,
  onSelect,
}: {
  className?: string;
  /** Controlled mode (dashboard preview): the page currently shown. */
  active?: PortalHref;
  /** Controlled mode: called instead of navigating. */
  onSelect?: (href: PortalHref) => void;
}) {
  const pathname = usePathname();
  const reduce = useReducedMotion();
  // Exact match only: "/portal" is a prefix of every other route, so a
  // startsWith test would light Services on all five pages.
  const current = activeProp ?? pathname;
  // One layout group per host. Two navs sharing a `layoutId` would try to
  // animate a single pill between them.
  const pillId = onSelect ? "portal-nav-pill-preview" : "portal-nav-pill";

  return (
    <nav aria-label="Portal sections" className={className}>
      <ul className="scrollbar-none isolate flex w-max max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-paper-sunken p-1 ring-1 ring-inset ring-paper-edge/70">
        {PORTAL_PAGES.map((page) => {
          const active = current === page.href;
          const itemClass = cn(
            "relative block whitespace-nowrap rounded-full px-2 py-1.5 text-[0.8125rem] font-semibold transition-colors duration-300 min-[400px]:px-2.5 sm:px-3.5 sm:text-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600",
            active ? "text-ink" : "text-ink-muted hover:text-ink",
          );
          const inner = (
            <>
              {active && (
                <motion.span
                  layoutId={pillId}
                  aria-hidden
                  className="absolute inset-0 -z-10 rounded-full bg-white shadow-[0_1px_2px_rgba(15,17,19,0.08),0_2px_8px_-2px_rgba(15,17,19,0.12)] ring-1 ring-paper-edge/80"
                  transition={
                    reduce ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 36, mass: 0.8 }
                  }
                />
              )}
              {page.label}
            </>
          );

          return (
            // The track (`isolate` on the <ul>) is the pill's stacking context,
            // so its -z-10 puts it above the track's fill and under EVERY label
            // — including the ones it passes over mid-slide.
            <li key={page.href}>
              {onSelect ? (
                <button
                  type="button"
                  onClick={() => onSelect(page.href)}
                  aria-current={active ? "page" : undefined}
                  className={itemClass}
                >
                  {inner}
                </button>
              ) : (
                <Link
                  href={page.href}
                  aria-current={active ? "page" : undefined}
                  className={itemClass}
                >
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
