"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { COMPANY } from "@/lib/legal/company";
import { PORTAL_SECTIONS, goToSection, type PortalSectionId } from "./anchors";
import { useEnquiry } from "./PortalShell";

/**
 * The charcoal utility bar and the white sticky header.
 *
 * The nav is a scroll-spy: as the visitor reads down the page, the section in
 * the middle band of the viewport is marked `aria-current="true"` (a location
 * within the page, not a separate page) and one red rule slides under its link.
 * Above the first section and inside the enquiry block, nothing is marked and
 * the rule fades out.
 *
 * The observer watches the viewport, not a scroller, so it works unchanged in
 * the console preview, where the page scrolls inside the dashboard's pane: a
 * section clipped by that pane is not intersecting the viewport either.
 */
export function SiteHeader() {
  const { standalone } = useEnquiry();
  const [current, setCurrent] = useState<PortalSectionId | null>(null);
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const ids = PORTAL_SECTIONS.map((s) => s.id);
    const targets = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") return;

    const crossing = new Map<string, boolean>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) crossing.set(entry.target.id, entry.isIntersecting);
        // Document order breaks a tie on the frame two sections share the band.
        setCurrent(ids.find((id) => crossing.get(id)) ?? null);
      },
      // A thin band just above the middle of the viewport: whichever section
      // is being read there is the current one.
      { rootMargin: "-40% 0px -55% 0px" },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, []);

  // Slide the rule under the current link. Measured rather than computed, so
  // it holds through font swaps and label-length changes; the ResizeObserver
  // re-measures when the nav reflows.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const place = () => {
      const link = current
        ? nav.querySelector<HTMLElement>(`[data-section="${current}"]`)
        : null;
      if (link) {
        nav.style.setProperty("--bar-x", `${link.offsetLeft}px`);
        nav.style.setProperty("--bar-w", `${link.offsetWidth}px`);
        nav.style.setProperty("--bar-o", "1");
      } else {
        nav.style.setProperty("--bar-o", "0");
      }
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(nav);
    return () => resize.disconnect();
  }, [current]);

  return (
    <>
      <div className="util wrap" id="portal-top">
        <span>
          <span className="util-area">Melbourne &amp; regional Victoria · </span>
          Mon–Sat, 7am–5pm
        </span>
        <div className="util-right">
          {COMPANY.abn && <span className="util-abn">ABN {COMPANY.abn}</span>}
          <a
            className="util-link focusable"
            href={COMPANY.mainWebsite}
            target="_blank"
            rel="noopener noreferrer"
            data-track="portal_main_website_click"
          >
            <span className="sr-only">Our main website, </span>
            {displayHost(COMPANY.mainWebsite)}
          </a>
          <span className="util-strong">
            24/7 make-safe:{" "}
            <a className="util-link focusable" href={COMPANY.phoneHref} data-track="portal_phone_click">
              {COMPANY.phone}
            </a>
          </span>
        </div>
      </div>

      <header className="hdr wrap">
        <a
          className="brand focusable"
          href="#portal-top"
          onClick={(e) => goToSection(e, "portal-top", false)}
        >
          <Image
            src="/images/brand/apmg-logo-ink.webp"
            alt=""
            width={378}
            height={285}
            priority
            className="brand-logo"
          />
          <span>
            <span className="brand-name">{COMPANY.tradingName}</span>
            <span className="brand-sub">Property maintenance group</span>
          </span>
        </a>

        <nav ref={navRef} className="nav" aria-label="Portal sections">
          {PORTAL_SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              data-section={section.id}
              aria-current={current === section.id ? "true" : undefined}
              className="nav-link focusable"
              onClick={(e) => goToSection(e, section.id, standalone)}
            >
              {section.label}
            </a>
          ))}
          <span aria-hidden className="nav-bar" />
        </nav>

        <div className="hdr-actions">
          <a className="tel focusable" href={COMPANY.phoneHref} data-track="portal_phone_click">
            <span className="sr-only">Call </span>
            {COMPANY.phone}
          </a>
          <a
            className="btn btn-primary"
            href="#enquiry"
            data-track="portal_quote_click"
            onClick={(e) => goToSection(e, "enquiry", standalone)}
          >
            Get a quote
          </a>
        </div>
      </header>
    </>
  );
}

/** "https://www.example.com.au/" -> "example.com.au". */
export function displayHost(url: string): string {
  return new URL(url).hostname.replace(/^www\./, "");
}
