"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useClickTelemetry } from "@/lib/telemetry";
import { portalFontClass } from "./fonts";
import { SiteHeader } from "./SiteHeader";
import { SiteFooter } from "./SiteFooter";
import type { Service } from "./data";
import { PortalChat } from "../PortalChat";
import { ServiceInquiryModal } from "../ServiceInquiryModal";
// The portal's whole visual layer, scoped to `.portal-world`. See the file.
import "@/app/portal/portal-world.css";

/* ------------------------------------------------------------------ */
/* Which host is rendering, and how enquiries open                      */
/* ------------------------------------------------------------------ */

/**
 * How a section opens the enquiry modal, what to call the event when it does,
 * and whether this is the customer host at all.
 *
 * `openEvent` RIDES ALONG BECAUSE IT MUST. The contract funnel event
 * `portal_service_open` may only be emitted by the customer-facing host. The
 * same page also renders inside the console's "Our Services" preview, and if
 * its CTAs hardcoded the contract name, an admin demoing that tab would inject
 * opens no customer made straight into the Enquiries funnel and inflate every
 * conversion ratio built on it. The shell knows which host it is, so it
 * supplies the honest name and no CTA has to remember the rule.
 *
 * The default is an inert preview-shaped value rather than a throw: a section
 * rendered outside any shell should be dead, not crash the page.
 */
interface EnquiryApi {
  open: (service: Service) => void;
  openEvent: string;
  /** True only on the customer host (`customer.apmgservices.com.au/portal`). */
  standalone: boolean;
}

const EnquiryContext = createContext<EnquiryApi>({
  open: () => {},
  openEvent: "services_card_open",
  standalone: false,
});

export function useEnquiry(): EnquiryApi {
  return useContext(EnquiryContext);
}

/* ------------------------------------------------------------------ */
/* Shell                                                                */
/* ------------------------------------------------------------------ */

/**
 * Chrome for the customer portal: utility bar, sticky header, footer, the chat
 * launcher and the one enquiry modal every section shares.
 *
 * ONE SHELL, TWO HOSTS.
 *  - `customer`: app/portal/page.tsx. Mounts the delegated click telemetry,
 *    re-asserts light mode after client navigations, renders the skip link and
 *    the page's one `<main>` landmark, and shows the footer's one-click
 *    unsubscribe.
 *  - `preview`: the console's "Our Services" tab (ServicesPortal). The same page
 *    inside the dashboard's scrolling pane, with none of the above: the
 *    dashboard owns the landmark and the telemetry listener, and an opt-out
 *    there would unsubscribe nobody.
 *
 * The page scrolls as a document now. The 2026-09-22 one-screen-per-route
 * lock was retired with the 2026-09-29 rebuild into one long page.
 *
 * The modal and the chat sit OUTSIDE `.portal-world` but inside the font
 * wrapper. Outside, so the portal's scoped rules can never repaint their
 * Tailwind styling; inside the font wrapper, so they still set in Bitter and
 * Archivo rather than the console's faces.
 */
export function PortalShell({
  host,
  children,
}: {
  host: "customer" | "preview";
  children: ReactNode;
}) {
  const standalone = host === "customer";
  const [active, setActive] = useState<Service | null>(null);
  const open = useCallback((service: Service) => setActive(service), []);
  const enquiry = useMemo<EnquiryApi>(
    () => ({
      open,
      openEvent: standalone ? "portal_service_open" : "services_card_open",
      standalone,
    }),
    [open, standalone],
  );

  // A <main> inside the dashboard's own <main> would be a second landmark.
  const Main = standalone ? "main" : "div";

  return (
    <EnquiryContext.Provider value={enquiry}>
      {standalone && <CustomerHostEffects />}
      <div className={portalFontClass}>
        {/* `portal-snap` opts the document into section-to-section snapping
            (portal-world.css). Customer host only: the console preview scrolls
            inside the dashboard's pane, which is not the document. */}
        <div className={standalone ? "portal-world portal-snap" : "portal-world"}>
          {/* SC 2.4.1 (Bypass Blocks): the first focusable thing on the page,
              off screen until focused. Outside <main> on purpose. */}
          {standalone && (
            <a className="skip" href="#portal-main">
              Skip to main content
            </a>
          )}

          <SiteHeader />

          <Main
            id={standalone ? "portal-main" : undefined}
            tabIndex={standalone ? -1 : undefined}
            className="portal-main"
          >
            {children}
          </Main>

          <SiteFooter />
        </div>

        <PortalChat />
        {/* `standalone` marks the CUSTOMER host: the enquiry recorded here
            belongs in the Enquiries funnel, and consent_accept fires. */}
        <ServiceInquiryModal
          service={active}
          onClose={() => setActive(null)}
          standalone={standalone}
        />
      </div>
    </EnquiryContext.Provider>
  );
}

/**
 * What only the customer host does. Its own component because hooks cannot be
 * called conditionally, and the preview must not run either of these.
 */
function CustomerHostEffects() {
  // Delegated click telemetry for the whole portal: every `data-track` element
  // on the page reports through this one listener.
  useClickTelemetry("portal");

  // Belt-and-braces LIGHT enforcement. The pre-paint script in
  // app/portal/layout.tsx strips `dark` before first paint; this re-asserts it
  // after a client-side navigation, where that inline script does not re-run.
  // localStorage is deliberately untouched, so a staff member's dark
  // preference for the console survives a detour through the portal.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  }, []);

  return null;
}
