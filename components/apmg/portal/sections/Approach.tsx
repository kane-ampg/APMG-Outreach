"use client";

import { cn } from "@/lib/cn";
import { microLabel } from "../kit";
import { APPROACH, portalFacts } from "../data";
import { PageBlock } from "./PageBlock";

/**
 * /portal/approach — how the work is actually run, and the four facts.
 *
 * The facts band moved here when the one-viewport rebuild reflowed the tall
 * footer into a strip. It had been the footer's top third, which meant the
 * page's substantiated numbers were the last thing on the longest page and
 * were reached by almost nobody. On a page about method they are the evidence
 * for the method, and they are above the fold because there is no other fold.
 *
 * It is NOT the kit's FactsBand. That component is authored for the footer's
 * ink ground (white-on-ink at `py-12`), so on paper it renders invisible, and
 * its height alone is a fifth of this page's budget. This is the same four
 * facts, same copy, on a dark panel sized for a viewport. PortalFooter still
 * renders the tall original on the internal dashboard tab, and both read the
 * same `portalFacts()`, so the two can never disagree.
 */
export function ApproachSection({ fill = false }: { fill?: boolean }) {
  const facts = portalFacts();

  return (
    <PageBlock
      fill={fill}
      eyebrow="How we work"
      heading="What actually makes the difference"
      lede="Almost nobody picks a maintenance contractor on the trade work itself. These are the things that separate a job that lands on time from one that doesn't."
      cta="Every one of these is something you can hold us to."
    >
      <div className="flex h-full flex-col gap-4">
        {/* Plain heading-and-body cards. No icons — nothing here is decorative. */}
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 tall:lg:gap-4">
          {APPROACH.map((item) => (
            <li
              key={item.heading}
              className="group relative rounded-lg bg-white p-4 shadow-[0_1px_2px_rgba(15,17,19,0.05),0_6px_18px_-10px_rgba(15,17,19,0.2)] ring-1 ring-paper-edge/80 transition-shadow duration-300 hover:shadow-[0_2px_4px_rgba(15,17,19,0.06),0_14px_28px_-14px_rgba(15,17,19,0.3)] tall:lg:p-5"
            >
              {/* A short red cut along the top edge that runs out to full width
                  on hover — the brand's rule, used as the card's one mark. */}
              <span
                aria-hidden
                className="absolute left-5 right-auto top-0 h-0.5 w-8 bg-brand-600 transition-all duration-500 ease-out group-hover:left-0 group-hover:w-full motion-reduce:transition-none"
              />
              <h2 className="font-display text-[1.05rem] leading-snug tracking-tight">{item.heading}</h2>
              <p className="mt-1 text-sm leading-snug text-ink-soft tall:mt-1.5 tall:leading-relaxed">{item.body}</p>
            </li>
          ))}
        </ul>

        <dl className="relative isolate grid gap-x-8 gap-y-4 overflow-hidden rounded-lg bg-ink px-5 py-5 shadow-[0_12px_32px_-14px_rgba(15,17,19,0.5)] sm:grid-cols-2 lg:grid-cols-4 lg:px-7 lg:py-4 tall:lg:py-5 before:absolute before:inset-x-0 before:top-0 before:h-[3px] before:bg-brand-600">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt className={cn(microLabel, "text-white/60")}>{fact.label}</dt>
              <dd className="mt-1">
                <span className="font-display text-xl font-semibold leading-none tracking-tight text-brand-400">
                  {fact.figure}
                </span>
                <span className="mt-1 block text-xs leading-relaxed text-white/70">
                  {fact.detail}
                </span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </PageBlock>
  );
}
