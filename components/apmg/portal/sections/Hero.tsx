"use client";

import type { CSSProperties } from "react";
import { COMPANY } from "@/lib/legal/company";
import { GOOGLE_RATING, GOOGLE_REVIEW_COUNT } from "../../googleReviews";
import { goToSection } from "../anchors";
import { HeroReel } from "../HeroReel";
import { useEnquiry } from "../PortalShell";
import { FOUNDED, SERVICES, numberWord } from "../data";

/**
 * Sector line for the hero (message-match with the outreach email). The
 * category comes from /api/portal/context, resolved from the httpOnly
 * attribution cookie: category only, nothing identifying. Every sector we
 * target is in the knowledgebase's "Sectors served" list, so the claim holds.
 */
function sectorLine(category: string): string {
  const c = category.trim();
  return `We support ${c.charAt(0).toLowerCase()}${c.slice(1)} sites across Melbourne — with minimal disruption to your daily operations.`;
}

/** Stagger index for the hero's entrance (portal-world.css, `.rise`). */
const rise = (i: number) => ({ "--i": i }) as CSSProperties;

/**
 * The first screen: the offer over the moving reel, which fills the whole
 * charcoal section, then the four checkable facts on white. On laptops and desktops the two together are
 * exactly the screen under the utility bar and header.
 *
 * The down button sits on the seam between them. It is the first screen's
 * only hint that the page continues, so it names what is below ("eight
 * trades") instead of being a bare arrow, and it steps to the services screen.
 */
export function Hero({ sector }: { sector: string | null }) {
  const { standalone } = useEnquiry();

  return (
    <div className="first-screen">
      <section className="hero wrap" aria-labelledby="hero-title">
        {/* The reel and its wash, behind everything else in the section. */}
        <HeroReel />

        <div className="hero-col">
          <span className="eyebrow rise" style={rise(0)}>
            Commercial · Strata · Aged care · Schools
          </span>
          <h1 id="hero-title" className="serif hero-title rise" style={rise(1)}>
            Every trade,
            <br />
            one partner.
          </h1>
          <p className="hero-copy rise" style={rise(2)}>
            Electrical, plumbing, painting, carpentry, flooring, grounds, handyman and make-safe
            work across Melbourne and Victoria — run by one team, from the first call to the job
            signed off.
          </p>
          {/* Only when the visitor arrived from a sector-targeted outreach link. */}
          {sector && (
            <p className="hero-sector rise" style={rise(3)}>
              {sectorLine(sector)}
            </p>
          )}
          <div className="hero-actions rise" style={rise(3)}>
            <a
              className="btn btn-primary btn-lg"
              href="#enquiry"
              data-track="portal_quote_click"
              onClick={(e) => goToSection(e, "enquiry", standalone)}
            >
              Tell us what needs doing <span className="arrow" aria-hidden>→</span>
            </a>
            <a className="btn btn-ghost btn-lg" href={COMPANY.phoneHref} data-track="portal_phone_click">
              <span className="sr-only">Call </span>
              {COMPANY.phone}
            </a>
          </div>
          <p className="fineprint rise" style={rise(4)}>
            Quoted within one business day · No call-out fee on quoted work
          </p>
        </div>

        <a
          className="scroll-cue"
          href="#services"
          data-track="portal_scroll_cue"
          onClick={(e) => goToSection(e, "services", standalone)}
        >
          <span>See all {numberWord(SERVICES.length).toLowerCase()} trades</span>
          <span className="scroll-cue-arrow" aria-hidden>
            ↓
          </span>
        </a>
      </section>

      {/* Every figure here is derived or substantiated: the trade count is the
          length of SERVICES, the rating and count are the transcribed Google
          listing, the year is FOUNDED, and 24/7 make-safe was confirmed by Kane
          on 2026-09-29. Nothing unbacked may be added to this strip. */}
      <dl className="trust wrap">
        <div className="trust-item">
          <dt>{numberWord(SERVICES.length)} trades in-house</dt>
          <dd>One point of contact for all of them</dd>
        </div>
        <div className="trust-item">
          <dt>
            {GOOGLE_RATING.toFixed(1)} <span className="trust-star" aria-hidden>★</span>
            <span className="sr-only"> stars</span> on Google
          </dt>
          <dd>From {GOOGLE_REVIEW_COUNT} reviews</dd>
        </div>
        <div className="trust-item">
          <dt>Est. {FOUNDED}</dt>
          <dd>Licensed, multi-trade professionals</dd>
        </div>
        <div className="trust-item">
          <dt>24/7 make-safe</dt>
          <dd>Storm, break-in and impact damage</dd>
        </div>
      </dl>
    </div>
  );
}
