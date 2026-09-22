"use client";

import { useCallback, useState } from "react";
import { EnquiryProvider } from "./portal/PortalShell";
import { ServicesSection } from "./portal/sections/Services";
import { ProcessSection } from "./portal/sections/Process";
import { ApproachSection } from "./portal/sections/Approach";
import { ReviewsSection } from "./portal/sections/Reviews";
import { TeamPageSection } from "./portal/sections/Team";
import { portalFacts, type Service } from "./portal/data";
import { PortalFooter } from "./PortalFooter";
import { PortalChat } from "./PortalChat";
import { ServiceInquiryModal } from "./ServiceInquiryModal";
// The portal's design layer — square corners, the display face's real weight,
// the scroll reveal and the process rail, all scoped to `.portal-world`.
// Imported here as well as in PortalShell because this host renders its own
// `.portal-world` scope without that shell.
import "@/app/portal/portal-world.css";

/**
 * The "Our Services" tab inside the internal dashboard.
 *
 * WHAT THIS IS NOW. Until 2026-09-22 this file WAS the portal: a 926-line
 * component holding the copy, every section and both hosts. The customer portal
 * has since been rebuilt as five one-viewport routes under app/portal/(site),
 * and the sections it is made of live in portal/sections. This file is what is
 * left — the operator's preview, and nothing else.
 *
 * It renders the SAME section components the customer sees, stacked, so the
 * preview cannot drift from the real thing. What it does not do is lock them to
 * a viewport (`fill` stays off): inside the dashboard this is a panel in a shell
 * that has its own chrome, the panel scrolls, and a one-screen composition sized
 * against the browser window rather than the panel would be wrong in both
 * directions. The operator wants to read the whole portal in one pass anyway.
 *
 * It also keeps the TALL footer. PortalFooter is ~600px of figures band and
 * columns — impossible on a one-viewport page, which is why the customer routes
 * get PortalStrip instead — but here the page scrolls and the height is free, so
 * the operator can still check the footer's full contents. Both read the same
 * `portalFacts()`, so the two surfaces can never quote different numbers.
 *
 * HOST DISCRIMINATION, unchanged. Every enquiry open from this tab is tagged
 * `services_card_open`, never the `portal_service_open` contract name, and
 * `portal_view` is not emitted at all. Letting an admin demoing this tab fire
 * the contract names would inflate every Enquiries-tab conversion ratio with
 * visits no customer made. The section components take the name from the
 * provider below rather than deciding it themselves.
 */
export function ServicesPortal({ standalone = false }: { standalone?: boolean }) {
  /** The service the enquiry modal is open for; null = closed. */
  const [active, setActive] = useState<Service | null>(null);
  const open = useCallback((service: Service) => setActive(service), []);

  return (
    <EnquiryProvider open={open} openEvent="services_card_open">
      <div className="portal-world bg-white text-ink">
        <ServicesSection standalone={standalone} />
        <div className="bg-paper-sunken">
          <ProcessSection />
        </div>
        <ApproachSection />
        <div className="bg-paper-sunken">
          <ReviewsSection />
        </div>
        <TeamPageSection />

        <PortalFooter standalone={standalone} facts={portalFacts()} />
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
