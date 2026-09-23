"use client";

import { Globe, Mail, Phone } from "lucide-react";
import { cn } from "@/lib/cn";
import { COMPANY } from "@/lib/legal/company";
import { portalFrame } from "./kit";
import { LegalLink } from "../LegalDocModal";
import { SocialLinks } from "../SocialLinks";
import { WhatsAppIcon } from "../WhatsAppIcon";
import { PortalUnsubscribe } from "../PortalUnsubscribe";

/**
 * The portal's footer, as one strip.
 *
 * WHY IT IS NOT PortalFooter. That component is an ink slab roughly 600px tall —
 * a figures band, four columns and a legal line. On a site where every page is
 * exactly one viewport, a 600px footer is most of the screen, so on the five
 * portal routes it would leave almost nothing for the content it sits under.
 *
 * So the footer was reflowed rather than dropped, and nothing load-bearing was
 * lost in the move:
 *
 *  - Every contact link keeps its `data-track` name, so the click telemetry
 *    counts exactly what it counted before: `portal_phone_click`,
 *    `portal_email_click`, `portal_website_click`, `portal_whatsapp_click`.
 *  - The legal links stay modals (checking the fine print should not cost the
 *    visitor their place), and /portal/terms and /portal/privacy stay live and
 *    linked from inside the modal.
 *  - PortalUnsubscribe stays. It is the one-click opt-out an outreach recipient
 *    is entitled to, and it must be reachable from every page they can land on.
 *  - The social links stay — checkable third-party profiles are part of the
 *    same "is this business real?" scan as the ABN.
 *
 * What did move rather than survive: the four-fact figures band, which is now
 * on /portal/approach where there is room to state each fact at length, and the
 * postal address, which is on /portal/team beside the people at it.
 *
 * PortalFooter itself is NOT deleted — the internal dashboard tab still renders
 * the full slab, where the page scrolls and the height is free.
 *
 * `pr-16 lg:pr-20` clears the chat launcher, which is fixed at `bottom-5
 * right-5` at 56px square and would otherwise sit squarely on top of the
 * unsubscribe link. A legal opt-out is the last thing on the page that may be
 * covered by furniture.
 */
export function PortalStrip({
  /** Customer host only. The dashboard preview renders this same strip, and an
   *  opt-out there would unsubscribe nobody — PortalFooter drew the same line. */
  standalone = false,
}: {
  standalone?: boolean;
}) {
  const year = new Date().getFullYear();

  return (
    <footer className="shrink-0 border-t-2 border-brand-600 bg-ink text-white">
      <div className={cn(portalFrame, "flex flex-col gap-2 py-2.5 pr-16 text-xs sm:pr-16 lg:flex-row lg:items-center lg:justify-between lg:gap-6 lg:py-2.5 xl:pr-8")}>
        {/* Identity. The ABN is the cheapest verifiable fact on the page. */}
        <p className="shrink-0 text-white/60">
          © {year} {COMPANY.tradingName}
          {COMPANY.abn ? ` · ABN ${COMPANY.abn}` : ""}
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 lg:justify-end">
          {/* Contact. Same four `data-track` names the tall footer carried. */}
          <a
            href={COMPANY.phoneHref}
            data-track="portal_phone_click"
            className="flex items-center gap-1.5 rounded font-semibold text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <Phone aria-hidden className="h-3.5 w-3.5 shrink-0 text-brand-400" />
            {COMPANY.phone}
          </a>
          <a
            href={`mailto:${COMPANY.contactEmail}`}
            data-track="portal_email_click"
            className="flex items-center gap-1.5 rounded text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <Mail aria-hidden className="h-3.5 w-3.5 shrink-0 text-brand-400" />
            <span className="sr-only sm:not-sr-only">{COMPANY.contactEmail}</span>
            <span className="sm:hidden">Email</span>
          </a>
          <a
            href={COMPANY.website}
            data-track="portal_website_click"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden items-center gap-1.5 rounded text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 xl:flex"
          >
            <Globe aria-hidden className="h-3.5 w-3.5 shrink-0 text-brand-400" />
            apmgservices.com.au
          </a>
          <a
            href={COMPANY.whatsappHref}
            data-track="portal_whatsapp_click"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 rounded text-white/70 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
          >
            <WhatsAppIcon className="h-3.5 w-3.5 shrink-0" />
            WhatsApp
          </a>

          <span aria-hidden className="hidden h-3.5 w-px bg-white/20 lg:block" />

          {/* Circular on purpose: these are the portal's one genuine set of
              circles, and the square-corner reset in portal-world.css exempts
              `rounded-full`. */}
          <SocialLinks
            linkClassName="rounded-full border border-white/25 p-1 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            iconClassName="h-3.5 w-3.5"
          />

          <span aria-hidden className="hidden h-3.5 w-px bg-white/20 lg:block" />

          <LegalLink doc="terms" className="rounded text-white/60 transition-colors hover:text-white">
            Terms
          </LegalLink>
          <LegalLink doc="privacy" className="rounded text-white/60 transition-colors hover:text-white">
            Privacy
          </LegalLink>
          {standalone && <PortalUnsubscribe />}
        </div>
      </div>
    </footer>
  );
}
