"use client";

import Image from "next/image";
import { COMPANY } from "@/lib/legal/company";
import { useEnquiry } from "../PortalShell";
import { FEATURABLE, MAKE_SAFE, type Service } from "../data";

/**
 * The eight trades on one screen: a 4x2 grid of photo tiles, every trade with
 * its own job-site photograph.
 *
 * THE SHAPE. The featured trade takes the first tile and carries the
 * "Featured trade" tag, the other six follow in their authored order, and
 * make-safe closes the grid as the one charcoal tile, with a direct call. Make-
 * safe never rotates into the featured tile (see FEATURABLE), which is what
 * keeps the grid at exactly eight cells whichever trade is featured.
 *
 * On laptops and desktops the grid fills whatever height the screen leaves
 * under the heading: the photographs flex, the text does not
 * (portal-world.css, "One screen per section"). Below that the tiles stack at
 * their natural height.
 *
 * THE FEATURED TRADE IS ROLLED ON THE SERVER. `spotlight` is chosen per request
 * in app/portal/page.tsx and passed in. A client-side roll would render one
 * trade on the server, swap after hydration, and visibly reflow the first tile
 * on the page a cold-email visitor lands on.
 *
 * `data-service` / `data-featured` are test hooks, not styling: they are how
 * the e2e suite asserts all eight trades render and exactly one is featured.
 */
export function ServicesSection({ spotlight = 0 }: { spotlight?: number }) {
  const { open, openEvent } = useEnquiry();

  // Modulo rather than a bounds check, so an out-of-range index from anywhere
  // can never blank the tile.
  const index = ((spotlight % FEATURABLE.length) + FEATURABLE.length) % FEATURABLE.length;
  const featured = FEATURABLE[index];
  const rest = FEATURABLE.filter((_, i) => i !== index);

  return (
    <section
      id="services"
      className="section screen wrap"
      tabIndex={-1}
      aria-labelledby="services-title"
    >
      <div className="sec-head">
        <div className="stack">
          <span className="eyebrow">What needs doing</span>
          <h2 id="services-title" className="serif h2">
            Pick the trade, or let us work it out for you.
          </h2>
        </div>
        <p className="lede sec-lede">
          Most jobs touch more than one trade. Tell us the problem and we&rsquo;ll scope every
          trade it needs before we quote.
        </p>
      </div>

      <ul className="tiles">
        <li>
          <TradeTile service={featured} featured openEvent={openEvent} onOpen={open} />
        </li>
        {rest.map((service) => (
          <li key={service.slug}>
            <TradeTile service={service} openEvent={openEvent} onOpen={open} />
          </li>
        ))}
        <li>
          <article className="tile tile-dark" data-service={MAKE_SAFE.slug}>
            <div className="tile-photo">
              {MAKE_SAFE.photo && (
                <Image
                  src={MAKE_SAFE.photo}
                  alt=""
                  fill
                  placeholder="blur"
                  sizes="(min-width: 1181px) 320px, (min-width: 721px) 50vw, 100vw"
                  className="fill-img"
                />
              )}
            </div>
            <div className="tile-body">
              <span className="eyebrow tile-eyebrow">24/7 emergency</span>
              <h3 className="serif tile-title">{MAKE_SAFE.short}</h3>
              <div className="tile-actions">
                <a className="tile-call" href={COMPANY.phoneHref} data-track="portal_phone_click">
                  Call {COMPANY.phone}
                </a>
                <button
                  type="button"
                  className="tile-more"
                  onClick={() => open(MAKE_SAFE)}
                  data-track={openEvent}
                  data-track-service={MAKE_SAFE.slug}
                >
                  What we cover{" "}
                  <span className="arrow" aria-hidden>
                    →
                  </span>
                </button>
              </div>
            </div>
          </article>
        </li>
      </ul>
    </section>
  );
}

/**
 * One trade. The name is a real `h3` and the control is a separate button
 * whose ::after stretches over the whole tile (portal-world.css, `.card-cta`).
 * A tile that WAS a button would strip its own heading out of the outline,
 * because ARIA gives buttons presentational children; the button carries its
 * own label because "Tell me more" alone does not say which trade.
 */
function TradeTile({
  service,
  featured = false,
  openEvent,
  onOpen,
}: {
  service: Service;
  featured?: boolean;
  openEvent: string;
  onOpen: (service: Service) => void;
}) {
  return (
    <article
      className="tile"
      data-service={service.slug}
      data-featured={featured ? "true" : undefined}
    >
      <div className="tile-photo">
        {service.photo && (
          <Image
            src={service.photo}
            alt=""
            fill
            placeholder="blur"
            // The featured tile is the first thing under the fold's edge.
            loading={featured ? "eager" : "lazy"}
            sizes="(min-width: 1181px) 320px, (min-width: 721px) 50vw, 100vw"
            className="fill-img"
          />
        )}
        {featured && <span className="tag tile-tag">Featured trade</span>}
      </div>
      <div className="tile-body">
        <h3 className="serif tile-title">{service.short}</h3>
        <p className="tile-copy">{service.blurb}</p>
        <button
          type="button"
          className="card-cta"
          onClick={() => onOpen(service)}
          data-track={openEvent}
          data-track-service={service.slug}
          aria-label={`${service.short}: tell me more`}
        >
          Tell me more{" "}
          <span className="arrow" aria-hidden>
            →
          </span>
        </button>
      </div>
    </article>
  );
}
