"use client";

import Image from "next/image";
import { Globe, Mail, MapPin, Phone } from "lucide-react";
import { cn } from "@/lib/cn";
import { COMPANY } from "@/lib/legal/company";
import { Container, FactsBand, microLabel } from "./portal/kit";
import { LegalLink } from "./LegalDocModal";
import { SocialLinks } from "./SocialLinks";
import { WhatsAppIcon } from "./WhatsAppIcon";
import { PortalUnsubscribe } from "./PortalUnsubscribe";

/**
 * Customer-portal footer.
 *
 * One ink slab under a 4px red rule, in the reference's shape: the figures band,
 * then columns, then a legal line. It replaces two things that used to sit here —
 * a white "Get in touch" section and, below it, the console's own thin
 * `<Footer consoleTag={false}>` strip in 11px muted grey. Between them the page
 * ended on two footers in two different visual languages, the second of which
 * was the console's chrome leaking onto a customer surface, and the chat
 * launcher sat on top of its right-hand end.
 *
 * WHAT IS DELIBERATELY NOT HERE. The reference's footer carries a taped wall of
 * accreditation logos — MPA, Dulux Accredited Painter, a 5-year workmanship
 * warranty, Cm3, Haymes — and it is the strongest trust signal on that site.
 * None of them is ported, because none is substantiated for APMG Services:
 * knowledgebase/business.md claims only "licensed, multi-trade professionals",
 * and ServicesPortal's own TODO(trust) records that insurance, licence numbers
 * and screening policy are all still waiting on documentation. Company-Brief's
 * rule is no unsupported claims, and a borrowed credential is the worst possible
 * one to break it with. The masking-tape CSS is not ported either — there is
 * nothing honest to tape up yet. Add the wall the day the certificates are in
 * hand; the design for it is one file away in the painting repo.
 *
 * Everything a cold outreach recipient scans a footer for is here: who you are,
 * where you are, how to reach you, checkable third-party profiles, and the
 * privacy terms. The "Developed by APMG AI Team" credit is deliberately absent —
 * on a page reached from unsolicited email, volunteering "AI" confirms the
 * visitor's exact suspicion.
 */
export function PortalFooter({
  facts,
  /** Only the customer host may offer an unsubscribe — inside the dashboard the
   *  operator is not the recipient of anything. */
  standalone = false,
}: {
  facts: readonly { figure: string; label: string; detail: string }[];
  standalone?: boolean;
}) {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t-4 border-brand-600 bg-ink text-white">
      <Container width="wide">
        <FactsBand facts={facts} />

        <div className="grid gap-10 py-14 sm:grid-cols-2 lg:grid-cols-4">
          {/* Identity. The white original of the mark, on the ink ground it was
              drawn for. */}
          <div className="sm:col-span-2 lg:col-span-1">
            <Image
              src="/images/brand/apmg-logo-white.webp"
              alt="APMG Services"
              width={378}
              height={285}
              className="mb-5 h-14 w-auto"
            />
            <address className="text-sm not-italic leading-relaxed text-white/85">
              {COMPANY.address}
            </address>
          </div>

          {/* Contact. `data-track` names are unchanged from the block this
              replaces, so the click telemetry keeps counting the same things. */}
          <div>
            <h2 className={cn(microLabel, "mb-4 text-white/60")}>Get in touch</h2>
            <ul className="space-y-3 text-sm text-white/85">
              <li className="flex items-center gap-2.5">
                <Phone aria-hidden className="h-4 w-4 shrink-0 text-brand-400" />
                <a
                  href={COMPANY.phoneHref}
                  data-track="portal_phone_click"
                  className="rounded font-semibold text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  {COMPANY.phone}
                </a>
              </li>
              <li className="flex items-center gap-2.5">
                <Mail aria-hidden className="h-4 w-4 shrink-0 text-brand-400" />
                <a
                  href={`mailto:${COMPANY.contactEmail}`}
                  data-track="portal_email_click"
                  className="rounded break-all hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  {COMPANY.contactEmail}
                </a>
              </li>
              <li className="flex items-center gap-2.5">
                <Globe aria-hidden className="h-4 w-4 shrink-0 text-brand-400" />
                <a
                  href={COMPANY.website}
                  data-track="portal_website_click"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
                >
                  apmgservices.com.au
                </a>
              </li>
              <li className="flex items-start gap-2.5">
                <MapPin aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                <span>Melbourne &amp; regional Victoria</span>
              </li>
            </ul>
          </div>

          {/* The two ways to start a conversation that are not a form. */}
          <div>
            <h2 className={cn(microLabel, "mb-4 text-white/60")}>Message us</h2>
            <a
              href={COMPANY.whatsappHref}
              data-track="portal_whatsapp_click"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded border border-white/30 px-3.5 py-2.5 text-sm font-semibold text-white hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
            >
              <WhatsAppIcon className="h-4 w-4" />
              WhatsApp
            </a>

            <h2 className={cn(microLabel, "mb-4 mt-8 text-white/60")}>Follow</h2>
            {/* Checkable third-party pages — the same "is this business real?"
                scan as the address and the phone number. Circular on purpose:
                these are the portal's one genuine set of circles, and the
                square-corner reset in portal-world.css exempts `rounded-full`. */}
            <SocialLinks
              linkClassName="rounded-full border border-white/25 p-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              iconClassName="h-4 w-4"
            />
          </div>
        </div>

        {/* `pb-24` on phones clears the chat launcher. It is fixed at
            `bottom-5 right-5` at 56px square, and on a narrow viewport this row
            stacks — which put the launcher squarely over "Terms & Conditions"
            and the ABN line. A legal identity line is the last thing on the page
            that may be covered by furniture. From `sm` the row is a single
            baseline with the links pulled left of the launcher, so the normal
            padding is enough. */}
        <div className="flex flex-col gap-3 border-t border-white/15 pb-24 pt-6 text-xs text-white/60 sm:flex-row sm:items-center sm:justify-between sm:pb-6">
          <p>
            © {year} {COMPANY.tradingName}
            {COMPANY.abn ? ` · ABN ${COMPANY.abn}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {/* Modal, not navigation: checking the fine print should not cost the
                visitor their place on the page. The shareable /portal/terms and
                /portal/privacy URLs stay live, linked from inside the modal. */}
            <LegalLink doc="terms" className="rounded py-1 transition-colors hover:text-white">
              Terms &amp; Conditions
            </LegalLink>
            <LegalLink doc="privacy" className="rounded py-1 transition-colors hover:text-white">
              Privacy Policy
            </LegalLink>
            {standalone && <PortalUnsubscribe />}
          </div>
        </div>
      </Container>
    </footer>
  );
}
