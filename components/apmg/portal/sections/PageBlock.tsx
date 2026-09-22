"use client";

import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { COMPANY } from "@/lib/legal/company";
import { Eyebrow, SectionHeading } from "../kit";
import { useEnquiry } from "../PortalShell";
import { GENERAL_SERVICE } from "../data";

/**
 * The frame every inner portal page shares: eyebrow, heading, lede, content,
 * and a closing CTA row.
 *
 * It exists because the kit's ContentBlock cannot be used here. That component
 * wraps PortalSection, whose `py-14 sm:py-20` is correct for sections stacked
 * down a long scrolling page and is roughly a fifth of the screen on a page
 * that has exactly one screen to spend. This is the same composition on a
 * viewport budget: tighter rhythm, the content row allowed to absorb whatever
 * height is left, and a CTA that is one line rather than a slab.
 *
 * THE CTA IS A ROW, NOT A BAND. The kit's CtaBand is a full ink section with a
 * heading and a paragraph. On the one-viewport portal the header's "Get a
 * quote" button is permanently on screen — it is a flex row of a viewport-height
 * shell, so it never scrolls away — which means a repeated full-height band
 * would be the third copy of the same call to action on a single screen. One
 * quiet line at the foot of the content is enough, and it keeps the enquiry
 * within reach without spending a fifth of the page restating it.
 */
export function PageBlock({
  eyebrow,
  heading,
  lede,
  children,
  /** Stretch to the parent's height (the locked portal page). Off for the
   *  internal dashboard tab, which scrolls and wants natural heights. */
  fill = false,
  /** Lets the content row scroll on its own when it genuinely cannot fit —
   *  the reviews list, whose length is whatever Google returns. */
  scrollContent = false,
  cta,
}: {
  eyebrow: string;
  heading: string;
  lede?: string;
  children: ReactNode;
  fill?: boolean;
  scrollContent?: boolean;
  cta?: string;
}) {
  const { open: openEnquiry, openEvent } = useEnquiry();

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-7xl flex-col px-5 py-8 sm:px-8 sm:py-10 short:py-6",
        fill && "lg:h-full lg:py-6",
      )}
    >
      <div className="shrink-0">
        <Eyebrow className="mb-2">{eyebrow}</Eyebrow>
        <SectionHeading as="h1" className="text-3xl sm:text-4xl">
          {heading}
        </SectionHeading>
        {lede && <p className="mt-2.5 max-w-prose text-ink-soft">{lede}</p>}
      </div>

      <div
        className={cn(
          "mt-7 sm:mt-8 short:mt-5 lg:mt-6",
          fill && "lg:flex lg:min-h-0 lg:flex-1 lg:flex-col",
          // `overflow-y-auto` only where it was asked for: an inner scroller
          // that appears by accident on a one-viewport page is worse than
          // content that was trimmed to fit on purpose.
          scrollContent && fill && "lg:overflow-y-auto",
        )}
      >
        {/*
         * `my-auto` is what stops a short page from stranding its content
         * against the heading with a field of white beneath it — the process
         * rail is about 300px inside a 500px row, and top-aligned it read as a
         * page that had failed to finish loading.
         *
         * An auto margin rather than `justify-center` because the two differ
         * exactly where it matters. `justify-center` on a row whose content is
         * TALLER than the box overflows it equally in both directions, and
         * since the document is locked (see portal-world.css) the part that
         * goes off the top is unreachable — the page would quietly lose its
         * first line. A flex auto margin only ever distributes FREE space, so
         * when there is none it resolves to zero and the content stays put.
         *
         * Not applied to the scrolling pages: there the row is a scroll
         * container that its content is meant to fill from the top.
         */}
        <div className={cn("w-full", fill && !scrollContent && "lg:my-auto")}>{children}</div>
      </div>

      {cta && (
        <div className="mt-6 flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3 border-t border-paper-edge pt-5 short:mt-4 short:pt-4">
          <p className="text-sm text-ink-soft">{cta}</p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => openEnquiry(GENERAL_SERVICE)}
              data-track={openEvent}
              data-track-service="general"
              className="inline-flex items-center gap-2 rounded-md bg-brand-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2"
            >
              Send an enquiry
              <ArrowRight aria-hidden className="h-4 w-4" />
            </button>
            <a
              href={COMPANY.phoneHref}
              data-track="portal_phone_click"
              className="rounded text-sm font-semibold text-brand-700 underline decoration-brand-600/40 decoration-2 underline-offset-4 hover:text-brand-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
            >
              <span className="sr-only">Call </span>
              {COMPANY.phone}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
