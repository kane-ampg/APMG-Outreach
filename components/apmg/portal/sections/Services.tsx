"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/cn";
import { track } from "@/lib/telemetry";
import { COMPANY } from "@/lib/legal/company";
import { PortalButton, portalFrame } from "../kit";
import { useEnquiry } from "../PortalShell";
import { GENERAL_SERVICE, SERVICES, PARAGRAPH_BREAK, type Service } from "../data";
import heroBg from "@/app/apmgbg.jpg";

/**
 * Sector line for the hero (message-match with the outreach email). The lead's
 * category arrives from /api/portal/context (resolved from the httpOnly
 * attribution cookie — category only, nothing identifying). The copy is a
 * template over the category so new sectors need no code change; the sectors we
 * target are all in the KB's "Sectors served" list, so the claim is grounded.
 * Null (no cookie / direct visit / demo) → no line, generic hero.
 */
function sectorLine(category: string): string {
  const c = category.trim();
  if (!c) return "";
  return `We support ${c.charAt(0).toLowerCase()}${c.slice(1)} sites across Melbourne — with minimal disruption to your daily operations.`;
}

/**
 * The portal's first page: a compact hero over the yard photograph, and the
 * eight trades as a grid that fills whatever height is left.
 *
 * THE SHAPE. Twelve cells, four columns by three rows. The spotlight takes a
 * 2×2 block in the top-left, the other seven trades take one cell each, and the
 * twelfth is the enquiry CTA. That arithmetic is the reason for the CTA tile:
 * eight services in a four-column grid leaves a hole, and a hole in a grid that
 * is supposed to fill the viewport reads as a rendering fault. Filling it with
 * the one thing the page wants the visitor to do is better than padding.
 *
 * WHY THE SPOTLIGHT MOVES BUT THE HOLE DOES NOT. `spotlight` selects which
 * SERVICE is featured, never where the feature sits. A grid whose large cell
 * jumped between corners on each load would look broken rather than fresh; a
 * grid whose large cell always sits top-left and shows a different trade each
 * time reads as editorial. It also means the CSS is static — only the array
 * order changes.
 *
 * The index is chosen on the SERVER (app/portal/page.tsx) and passed in, not
 * rolled here: a client-side random would render index 0 on the server, swap
 * after hydration, and visibly reflow the largest element on the one screen
 * that has to land instantly.
 */
export function ServicesSection({
  spotlight = 0,
  /** Stretch to the parent's height (the locked portal page). Off for the
   *  internal dashboard tab, which scrolls and wants natural heights. */
  fill = false,
  /** Contract funnel events fire ONLY on the customer-facing host; internal
   *  opens get a non-contract name the Enquiries summary ignores. */
  standalone = false,
}: {
  spotlight?: number;
  fill?: boolean;
  standalone?: boolean;
}) {
  // `openEvent` comes from the host's provider, not from `standalone`: the
  // shell knows it is the customer host, the dashboard tab knows it is not, and
  // neither this component nor any CTA inside it has to remember the rule.
  const { open: openEnquiry, openEvent } = useEnquiry();
  const [sector, setSector] = useState<string | null>(null);

  // One `portal_view` per mount of the CUSTOMER host — the funnel step between
  // the outreach redirect (attribution_click, recorded server-side by /t/[id])
  // and the first portal_service_open.
  //
  // IT FIRES HERE, NOT IN THE SHELL. The shell wraps all five routes, so a
  // `portal_view` there would fire again on every page the visitor opened and
  // multiply the funnel's top-of-funnel count by up to five — every conversion
  // ratio on the Enquiries tab would silently fall through the floor. The
  // landing page is the visit; the other four pages are depth.
  useEffect(() => {
    if (standalone) track("portal_view");
  }, [standalone]);

  // Message-match: resolve the visitor's attributed sector (customer host
  // only). The outreach email spoke their sector's language — the landing page
  // greeting the same sector is what makes the email feel personal instead of
  // templated. Best-effort: any miss just leaves the generic hero.
  useEffect(() => {
    if (!standalone) return;
    let cancelled = false;
    fetch("/api/portal/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; category?: string | null } | null) => {
        if (cancelled || !j?.ok) return;
        if (typeof j.category === "string" && j.category.trim()) {
          setSector(j.category.trim());
        }
      })
      .catch(() => {
        /* no attribution / offline — generic hero */
      });
    return () => {
      cancelled = true;
    };
  }, [standalone]);

  // Featured trade first, the rest in their authored order. Modulo rather than a
  // bounds check so an out-of-range index from anywhere can never blank the grid.
  const featuredIndex = ((spotlight % SERVICES.length) + SERVICES.length) % SERVICES.length;
  const featured = SERVICES[featuredIndex];
  const rest = SERVICES.filter((_, i) => i !== featuredIndex);

  return (
    <div
      className={cn(
        portalFrame,
        "flex flex-col gap-3 py-4 sm:gap-4 sm:py-5 short:gap-3 short:py-3",
        fill && "lg:h-full",
      )}
    >
      {/* ── Hero panel ────────────────────────────────────────────────
          A framed photograph rather than a full-bleed band. It shares the
          grid's column, so the headline, the CTA and the eight trades all
          start and stop on the same two edges. */}
      <section className="relative isolate shrink-0 overflow-hidden rounded-lg bg-ink text-white shadow-[0_1px_2px_rgba(15,17,19,0.1),0_12px_32px_-12px_rgba(15,17,19,0.45)]">
        <Image
          src={heroBg}
          alt=""
          fill
          priority
          placeholder="blur"
          sizes="(min-width: 1152px) 1152px, 100vw"
          className="-z-10 object-cover object-[50%_55%]"
        />
        {/* The scrim, in two parts. Horizontal carries the type: ink at 95%
            under the headline, thinning toward the right edge so the yard
            photograph keeps its own contrast. Vertical darkens the foot so the
            panel has a floor. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-r from-ink/95 via-ink/80 to-ink/40 lg:via-ink/70 lg:to-ink/25"
        />
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-b from-ink/30 via-transparent to-ink/60"
        />
        {/* The cut line — the brand's red rule, drawn along the panel's foot. */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[3px] bg-gradient-to-r from-brand-600 via-brand-600/70 to-transparent"
        />

        <div className="flex flex-col gap-5 px-5 py-7 sm:px-8 sm:py-8 lg:flex-row lg:items-end lg:justify-between lg:gap-10 lg:px-10 lg:py-6 tall:lg:py-9 short:py-5">
          <div className="min-w-0">
            <h1 className="text-balance font-display text-[2rem] leading-[1.02] tracking-tight [text-shadow:0_2px_28px_rgba(15,17,19,0.65)] sm:text-[2.6rem] lg:text-[2.6rem] tall:lg:text-[3rem] short:text-[2rem]">
              Every trade, <span className="text-brand-400">one partner</span>
            </h1>
            <p className="mt-3 max-w-[34rem] text-sm leading-relaxed text-white/80 [text-shadow:0_1px_16px_rgba(15,17,19,0.75)] sm:text-[0.95rem] short:mt-2">
              Electrical, plumbing, painting, carpentry, flooring, grounds, handyman and
              make-safe work across Melbourne and Victoria — run by one team, from the first
              call to the job done.
            </p>
            {/* Sector message-match — only when the visitor arrived from a
                sector-targeted outreach link. */}
            {sector && (
              <p className="mt-2 max-w-[34rem] text-sm text-brand-100 [text-shadow:0_1px_16px_rgba(15,17,19,0.75)]">
                {sectorLine(sector)}
              </p>
            )}
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-3">
            <PortalButton
              variant="accent"
              onClick={() => openEnquiry(GENERAL_SERVICE)}
              data-track={openEvent}
              data-track-service="general"
              className="shadow-[0_2px_4px_rgba(15,17,19,0.3),0_8px_24px_-6px_rgba(200,16,46,0.6)]"
            >
              Tell us what needs doing
              <ArrowRight aria-hidden className="h-4 w-4" />
            </PortalButton>
            <a
              href={COMPANY.phoneHref}
              data-track="portal_phone_click"
              className="rounded text-sm font-semibold text-white/85 underline decoration-brand-500 decoration-2 underline-offset-4 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <span className="sr-only">Call </span>
              {COMPANY.phone}
            </a>
          </div>
        </div>
      </section>

      {/* ── The grid ──────────────────────────────────────────────────
          `min-h-0` lets this row shrink inside the flex column; without it a
          flex child refuses to go below its content height and the last row of
          tiles would be pushed under the footer strip. */}
      <div className={cn(fill && "lg:min-h-0 lg:flex-1")}>
        <ul
          className={cn(
            "grid gap-3 sm:grid-cols-2 lg:grid-cols-4",
            fill ? "lg:h-full lg:grid-rows-3" : "lg:auto-rows-[13rem]",
          )}
        >
          <ServiceTile
            service={featured}
            featured
            openEvent={openEvent}
            onOpen={openEnquiry}
          />
          {rest.map((service) => (
            <ServiceTile
              key={service.slug}
              service={service}
              openEvent={openEvent}
              onOpen={openEnquiry}
            />
          ))}

          {/* The twelfth cell. */}
          <li className="min-h-0">
            <div className="relative isolate flex h-full min-h-[8rem] flex-col justify-between overflow-hidden rounded-lg bg-ink p-4 text-white ring-1 ring-inset ring-white/10 sm:p-5">
              {/* One pool of red light in the corner the button sits in — the
                  tile reads as the place to act without shouting it. */}
              <div
                aria-hidden
                className="absolute -bottom-16 -right-10 -z-10 h-48 w-48 rounded-full bg-brand-600/35 blur-3xl"
              />
              <div aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-brand-600" />
              <div>
                <p className="font-display text-lg leading-tight tracking-tight lg:text-xl">
                  Not sure which trade you need?
                </p>
                <p className="mt-1.5 hidden text-xs leading-relaxed text-white/65 sm:block lg:hidden tall:lg:block">
                  A photo and a sentence is enough to start.
                </p>
              </div>
              <button
                type="button"
                onClick={() => openEnquiry(GENERAL_SERVICE)}
                data-track={openEvent}
                data-track-service="general"
                className="mt-3 inline-flex items-center gap-2 self-start rounded-md bg-brand-600 px-3.5 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 focus-visible:ring-offset-2 focus-visible:ring-offset-ink"
              >
                Send an enquiry
                <ArrowRight aria-hidden className="h-4 w-4" />
              </button>
            </div>
          </li>
        </ul>
      </div>
    </div>
  );
}

/**
 * One trade.
 *
 * SC 1.3.1 / 4.1.2: the trade name is a real `h3` and the control is a separate
 * `button` stretched over the whole tile, rather than a button wrapping the
 * card. ARIA gives buttons presentational children, so a card that IS a button
 * strips its own service name out of the document's heading outline and reads
 * the entire tile as one run-on accessible name. The stretched overlay keeps
 * the whole tile clickable — which at this size is the only sane target — while
 * the heading stays in the outline, and the button carries its own `aria-label`
 * because its visible text ("Tell me more") does not say which trade it means.
 */
function ServiceTile({
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
    <li className={cn("min-h-0", featured && "sm:col-span-2 lg:row-span-2")}>
      {/* `data-service` / `data-featured` are test hooks, not styling: the
          spotlight is rolled per request on the server, so the only way to
          assert that it actually varies — and that exactly one tile is ever
          featured — is to be able to name the tiles from outside. */}
      <article
        data-service={service.slug}
        data-featured={featured ? "true" : undefined}
        className={cn(
          // `isolate` is load-bearing, not decoration. The photograph and the
          // scrim below sit at `-z-10` so the tile's text can stay in normal
          // flow above them; without a stacking context here, a negative
          // z-index escapes this element entirely and paints behind the
          // nearest ancestor that has one — which is the white page. The tiles
          // rendered as eight solid black rectangles until this was added.
          "group relative isolate flex h-full min-h-[8rem] flex-col overflow-hidden rounded-lg bg-ink",
          "shadow-[0_1px_2px_rgba(15,17,19,0.08),0_4px_14px_-6px_rgba(15,17,19,0.3)] transition-[transform,box-shadow] duration-500 ease-out",
          "hover:-translate-y-0.5 hover:shadow-[0_2px_4px_rgba(15,17,19,0.1),0_16px_32px_-12px_rgba(15,17,19,0.45)]",
          "motion-reduce:transition-none motion-reduce:hover:translate-y-0",
          featured && "min-h-[14rem]",
        )}
      >
        {service.photo && (
          <Image
            src={service.photo}
            alt=""
            fill
            loading={featured ? "eager" : "lazy"}
            placeholder="blur"
            sizes={featured ? "(min-width: 1152px) 560px, (min-width: 1024px) 50vw, 100vw" : "(min-width: 1152px) 280px, (min-width: 1024px) 25vw, 50vw"}
            className={cn(
              "absolute inset-0 -z-10 h-full w-full object-cover transition-transform duration-700 ease-out",
              "group-hover:scale-[1.04] group-focus-within:scale-[1.04]",
              "motion-reduce:transform-none motion-reduce:transition-none",
            )}
          />
        )}
        {/* Type sits on the photograph, so the photograph gets a floor to be
            measured against rather than a hope. Heavier at the bottom where the
            name is. */}
        <div
          aria-hidden
          className="absolute inset-0 -z-10 bg-gradient-to-t from-ink/95 via-ink/50 to-ink/5"
        />

        <div className="mt-auto flex flex-col gap-1.5 p-3.5 text-white sm:p-4">
          <h3
            className={cn(
              "font-display leading-tight tracking-tight",
              featured ? "text-2xl lg:text-3xl" : "text-base lg:text-lg",
            )}
          >
            {service.name}
          </h3>

          {featured && (
            <>
              <p className="max-w-prose text-sm text-white/85">{service.blurb}</p>
              <p className="hidden max-w-prose text-sm leading-relaxed text-white/70 lg:line-clamp-2">
                {service.description?.split(PARAGRAPH_BREAK)[0]}
              </p>
              {service.includes && (
                <ul className="mt-1 hidden flex-wrap gap-1.5 lg:flex">
                  {service.includes.slice(0, 3).map((item, i) => (
                    <li
                      key={item}
                      // The third only where the screen is tall enough for a
                      // second row of chips without crowding the name.
                      className={cn(
                        "rounded-full bg-white/10 px-2.5 py-1 text-xs font-medium text-white/90 ring-1 ring-inset ring-white/15",
                        i === 2 && "hidden tall:block",
                      )}
                    >
                      {item}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}

          <span
            className={cn(
              "mt-1 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-400 transition-colors group-hover:text-brand-300",
              featured && "text-sm",
            )}
          >
            Tell me more
            <ArrowRight
              aria-hidden
              className="h-3.5 w-3.5 transition-transform duration-300 ease-out group-hover:translate-x-0.5 motion-reduce:transform-none motion-reduce:transition-none"
            />
          </span>
        </div>

        {/* The stretched control. `absolute inset-0` over the whole tile; the
            ring is drawn on the tile's own edge via `ring-inset` so a keyboard
            focus is visible against the photograph. */}
        <button
          type="button"
          onClick={() => onOpen(service)}
          data-track={openEvent}
          data-track-service={service.slug}
          aria-label={`${service.name} — tell me more`}
          className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-400"
        />
      </article>
    </li>
  );
}
