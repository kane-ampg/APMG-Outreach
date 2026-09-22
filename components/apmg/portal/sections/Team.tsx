"use client";

import { MapPin } from "lucide-react";
import { COMPANY } from "@/lib/legal/company";
import { TeamSection as TeamGrid } from "../../TeamSection";
import { PageBlock } from "./PageBlock";

/**
 * /portal/team — who'll actually turn up.
 *
 * The postal address moved here when the tall footer was reflowed into a strip.
 * It is a "is this business real?" fact, and it reads better beside the people
 * who work at it than stranded in a column of links — a named address under
 * named faces is a stronger signal than either on its own.
 *
 * `heading={false}` for the same reason as the reviews panel: the grid is
 * shared with the internal console and renders its own console-voice header
 * there. The prop defaults to true, so the console is unchanged.
 */
export function TeamPageSection({ fill = false }: { fill?: boolean }) {
  return (
    <PageBlock
      fill={fill}
      scrollContent
      eyebrow="The team"
      heading="Who'll actually turn up"
      lede="The same people from the first call to the job done — not a call centre and a subcontractor you've never met."
      cta="Ask for whoever you spoke to last time."
    >
      <div className="flex h-full flex-col gap-5">
        <TeamGrid heading={false} />

        <address className="flex items-start gap-2.5 text-sm not-italic leading-relaxed text-ink-soft">
          <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand-600" />
          <span>
            {COMPANY.address}
            <span className="block text-ink-muted">Working across Melbourne &amp; regional Victoria.</span>
          </span>
        </address>
      </div>
    </PageBlock>
  );
}
