"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

/**
 * The portal's five pages, in reading order.
 *
 * Exported because sitemap.ts and the footer both need the same list — a route
 * added here should not have to be remembered in two other files. `/portal`
 * leads because the services grid is the page outreach links land on.
 */
export const PORTAL_PAGES = [
  { href: "/portal", label: "Services" },
  { href: "/portal/process", label: "Process" },
  { href: "/portal/approach", label: "Approach" },
  { href: "/portal/reviews", label: "Reviews" },
  { href: "/portal/team", label: "Team" },
] as const;

/**
 * Primary navigation for the customer portal.
 *
 * New with the 2026-09-22 one-viewport rebuild. The portal had NO navigation
 * before this — it was a single scrolling page whose only in-page links were a
 * hero anchor and a scroll cue — so there is no prior art to match here; the
 * treatment is the kit's own micro-label, underlined in brand red when active.
 *
 * Horizontally scrollable on phones rather than collapsed behind a hamburger:
 * five short words fit a phone's width at this size, and a menu button would
 * put the other four pages behind an extra tap on a site whose whole point is
 * that everything is one screen away. `scrollbar-none` hides the bar without
 * disabling the scroll, so the overflow is still reachable by swipe on the
 * narrowest phones.
 */
export function PortalNav({ className }: { className?: string }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Portal sections" className={className}>
      <ul className="scrollbar-none flex items-center gap-1 overflow-x-auto sm:gap-2">
        {PORTAL_PAGES.map((page) => {
          // Exact match only: "/portal" is a prefix of every other route, so a
          // startsWith test would light Services on all five pages.
          const active = pathname === page.href;
          return (
            <li key={page.href}>
              <Link
                href={page.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative block whitespace-nowrap rounded px-2.5 py-2 text-sm font-semibold transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600",
                  active ? "text-ink" : "text-ink-soft hover:text-ink",
                )}
              >
                {page.label}
                {/* The active mark is a drawn rule rather than a background
                    fill: the header is translucent over a photograph on the
                    services page, and a filled pill there reads as a button
                    the visitor has already pressed. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-brand-600 transition-opacity",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
