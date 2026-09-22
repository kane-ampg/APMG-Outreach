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
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {APPROACH.map((item) => (
            <li
              key={item.heading}
              className="rounded-lg border border-paper-edge bg-white p-3.5"
            >
              <h2 className="font-display text-base leading-snug tracking-tight">{item.heading}</h2>
              <p className="mt-1 text-sm leading-snug text-ink-soft">{item.body}</p>
            </li>
          ))}
        </ul>

        <dl className="grid gap-x-8 gap-y-4 rounded-lg bg-ink px-5 py-4 sm:grid-cols-2 lg:grid-cols-4">
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
