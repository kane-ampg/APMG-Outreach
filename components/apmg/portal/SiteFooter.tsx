"use client";

import { COMPANY } from "@/lib/legal/company";
import { LegalLink } from "../LegalDocModal";
import { SocialLinks } from "../SocialLinks";
import { PortalUnsubscribe } from "../PortalUnsubscribe";
import { SERVICES } from "./data";
import { displayHost } from "./SiteHeader";
import { useEnquiry } from "./PortalShell";

/**
 * The white footer: identity, the eight trades, contact, and the legal line.
 *
 * Nothing load-bearing from the old footer strip was dropped in the move:
 *  - Every contact link keeps its `data-track` name (`portal_phone_click`,
 *    `portal_email_click`, `portal_website_click`, `portal_whatsapp_click`), so
 *    click telemetry counts exactly what it counted before.
 *  - The legal links stay modals (checking the fine print should not cost the
 *    visitor their place); /portal/terms and /portal/privacy stay live.
 *  - PortalUnsubscribe is the one-click opt-out an outreach recipient is
 *    entitled to. Customer host only: in the console preview it would
 *    unsubscribe nobody.
 *
 * The trade links open that trade's enquiry modal, which carries the trade's
 * full published description. There are no per-trade pages to link to.
 */
export function SiteFooter() {
  const { open, openEvent, standalone } = useEnquiry();
  const year = new Date().getFullYear();
  const half = Math.ceil(SERVICES.length / 2);

  const tradeLinks = (list: typeof SERVICES) =>
    list.map((service) => (
      <button
        key={service.slug}
        type="button"
        className="ftr-link"
        onClick={() => open(service)}
        data-track={openEvent}
        data-track-service={service.slug}
      >
        {service.short}
      </button>
    ));

  return (
    <footer className="ftr wrap">
      <div className="ftr-cols">
        <div className="ftr-about">
          <span className="ftr-name">{COMPANY.tradingName}</span>
          <p>Property maintenance across Melbourne and regional Victoria, since 2015.</p>
          <address>
            {COMPANY.address}
            {COMPANY.abn && (
              <>
                <br />
                ABN {COMPANY.abn}
              </>
            )}
          </address>
          <SocialLinks
            className="ftr-social"
            linkClassName="ftr-social-link focusable"
            iconClassName="h-4 w-4"
          />
        </div>

        <div className="ftr-col">
          <h2 className="ftr-head">Trades</h2>
          {tradeLinks(SERVICES.slice(0, half))}
        </div>

        <div className="ftr-col">
          <h2 className="ftr-head">More</h2>
          {tradeLinks(SERVICES.slice(half))}
        </div>

        <div className="ftr-col">
          <h2 className="ftr-head">Contact</h2>
          <a className="ftr-link" href={COMPANY.phoneHref} data-track="portal_phone_click">
            {COMPANY.phone}
          </a>
          <a
            className="ftr-link"
            href={`mailto:${COMPANY.contactEmail}`}
            data-track="portal_email_click"
          >
            {COMPANY.contactEmail}
          </a>
          <a
            className="ftr-link"
            href={COMPANY.mainWebsite}
            target="_blank"
            rel="noopener noreferrer"
            data-track="portal_main_website_click"
          >
            <span className="sr-only">Our main website, </span>
            {displayHost(COMPANY.mainWebsite)}
          </a>
          <a
            className="ftr-link"
            href={COMPANY.website}
            target="_blank"
            rel="noopener noreferrer"
            data-track="portal_website_click"
          >
            {displayHost(COMPANY.website)}
          </a>
          <a
            className="ftr-link"
            href={COMPANY.whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            data-track="portal_whatsapp_click"
          >
            WhatsApp
          </a>
        </div>
      </div>

      <div className="ftr-base">
        <span>
          © {year} {COMPANY.tradingName}
        </span>
        <div className="ftr-links">
          <LegalLink doc="terms" className="ftr-small">
            Terms
          </LegalLink>
          <LegalLink doc="privacy" className="ftr-small">
            Privacy
          </LegalLink>
          {standalone && <PortalUnsubscribe />}
        </div>
      </div>
    </footer>
  );
}
