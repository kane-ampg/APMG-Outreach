"use client";

import { GoogleReviewsPanel } from "../../GoogleReviewsPanel";
import { PageBlock } from "./PageBlock";

/**
 * /portal/reviews — Google reviews, unedited.
 *
 * `scrollContent`: this is the ONE page whose content length is not ours to
 * decide. The panel renders whatever Google returns, so a fixed budget would
 * either clip reviews on a good month or leave a hole on a quiet one. The page
 * frame stays locked to the viewport and the reviews list scrolls inside it,
 * which keeps the promise (the page is one screen) without the site quietly
 * dropping social proof to keep it.
 *
 * `heading={false}`: the panel is SHARED with the internal console, where it
 * renders its own eyebrow and h2 in the console's font-mono / font-heading
 * voice. Directly under the portal's Fraunces heading that read as two headings
 * saying the same thing in two typefaces, so the portal supplies the header and
 * the panel supplies only the reviews. The prop defaults to true, so the
 * console is unchanged.
 */
export function ReviewsSection({ fill = false }: { fill?: boolean }) {
  return (
    <PageBlock
      fill={fill}
      scrollContent
      eyebrow="In their words"
      heading="What clients say"
      lede="Straight from Google, unedited. Don't take our word for it — read what the people we work for say."
      cta="Happy to put you in touch with a site like yours."
    >
      <GoogleReviewsPanel heading={false} />
    </PageBlock>
  );
}
