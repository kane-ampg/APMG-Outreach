"use client";

import { useCallback, useState } from "react";
import { EnquiryProvider, PortalHeader } from "./portal/PortalShell";
import { PortalStrip } from "./portal/PortalStrip";
import { PageTransition } from "./portal/PageTransition";
import type { PortalHref } from "./portal/PortalNav";
import { ServicesSection } from "./portal/sections/Services";
import { ProcessSection } from "./portal/sections/Process";
import { ApproachSection } from "./portal/sections/Approach";
import { ReviewsSection } from "./portal/sections/Reviews";
import { TeamPageSection } from "./portal/sections/Team";
import type { Service } from "./portal/data";
import { PortalChat } from "./PortalChat";
import { ServiceInquiryModal } from "./ServiceInquiryModal";
// The portal's design layer — corners, the display face's real weight, the
// ground, the pinned light tokens and the process rail, all scoped to
// `.portal-world`. Imported here as well as in PortalShell because this host
// renders its own `.portal-world` scope without that shell.
import "@/app/portal/portal-world.css";

/**
 * The "Our Services" tab inside the internal dashboard.
 *
 * WHAT THIS IS. The operator's preview of the customer portal — and since
 * 2026-09-23 it is the portal, not a digest of it. Same header, same segmented
 * nav, same framed column, same footer strip, same one-screen composition from
 * `lg` up. The only difference is that the five pages are local state here
 * rather than routes: the dashboard owns the URL, and the nav is rendered in
 * controlled mode (see PortalNav) so switching pages swaps the panel in place,
 * with the same entrance the customer host plays between routes.
 *
 * It used to stack all five sections down one long scroll with the tall
 * PortalFooter under them. That preview had drifted into a different site —
 * one the customer never sees — which is the one thing a preview must not do.
 *
 * THE LOCK. From `lg` up the dashboard's content area is the full viewport
 * height (the command bar is hidden on this tab), so the same `h-dvh` column
 * PortalShell uses fits it exactly. Below `lg` it scrolls, as the customer
 * host does.
 *
 * HOST DISCRIMINATION, unchanged. Every enquiry open from this tab is tagged
 * `services_card_open`, never the `portal_service_open` contract name, and
 * `portal_view` is not emitted at all (`standalone` stays false). Letting an
 * admin demoing this tab fire the contract names would inflate every
 * Enquiries-tab conversion ratio with visits no customer made. The strip's
 * one-click unsubscribe is customer-host only for the same reason.
 */
export function ServicesPortal({ standalone = false }: { standalone?: boolean }) {
  /** The service the enquiry modal is open for; null = closed. */
  const [active, setActive] = useState<Service | null>(null);
  const open = useCallback((service: Service) => setActive(service), []);
  const [page, setPage] = useState<PortalHref>("/portal");

  return (
    <EnquiryProvider open={open} openEvent="services_card_open">
      <div className="portal-world portal-ground flex min-h-full flex-col text-ink lg:h-dvh lg:max-h-dvh lg:overflow-hidden">
        <PortalHeader nav={{ active: page, onSelect: setPage }} />

        <div className="min-h-0 flex-1 overflow-x-hidden lg:overflow-hidden">
          <PageTransition key={page} animateFirst className="lg:h-full">
            <PreviewPage page={page} standalone={standalone} />
          </PageTransition>
        </div>

        <PortalStrip standalone={standalone} />
      </div>

      <PortalChat />
      <ServiceInquiryModal
        service={active}
        onClose={() => setActive(null)}
        standalone={standalone}
      />
    </EnquiryProvider>
  );
}

function PreviewPage({ page, standalone }: { page: PortalHref; standalone: boolean }) {
  switch (page) {
    case "/portal":
      return <ServicesSection standalone={standalone} fill />;
    case "/portal/process":
      return <ProcessSection fill />;
    case "/portal/approach":
      return <ApproachSection fill />;
    case "/portal/reviews":
      return <ReviewsSection fill />;
    case "/portal/team":
      return <TeamPageSection fill />;
  }
}
