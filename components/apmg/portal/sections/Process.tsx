"use client";

import { ProcessSteps } from "../kit";
import { PROCESS } from "../data";
import { PageBlock } from "./PageBlock";

/**
 * /portal/process — what happens after an enquiry.
 *
 * The rail is unchanged from the scrolling page: five stages on one rule with a
 * red line running its length. It is the one section where the ORDER is the
 * content, which is why it is drawn rather than tiled, and it happens to be the
 * section that suits a page of its own best — on the old page it sat between
 * the services grid and the approach cards, where a visitor scrolling for
 * trades passed straight over it.
 */
export function ProcessSection({ fill = false }: { fill?: boolean }) {
  return (
    <PageBlock
      fill={fill}
      eyebrow="How it works"
      heading="What happens after you enquire"
      lede="The same five stages whether it's one dripping tap or a maintenance programme across a campus."
      cta="That first step costs you nothing."
    >
      <ProcessSteps steps={PROCESS} />
    </PageBlock>
  );
}
