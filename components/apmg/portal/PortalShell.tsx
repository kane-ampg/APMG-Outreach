"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { useClickTelemetry } from "@/lib/telemetry";
import { COMPANY } from "@/lib/legal/company";
import { cn } from "@/lib/cn";
import { PortalButton, portalFrame } from "./kit";
import { PortalNav } from "./PortalNav";
import { PortalStrip } from "./PortalStrip";
import { GENERAL_SERVICE, type Service } from "./data";
import { PortalChat } from "../PortalChat";
import { ServiceInquiryModal } from "../ServiceInquiryModal";
// The portal's design layer — square corners, the display face's real weight,
// the scroll reveal and the process rail, all scoped to `.portal-world`. The
// shell owns the import now that it owns the `.portal-world` element; the
// internal dashboard tab (ServicesPortal.tsx) imports it separately because it
// renders its own scope without this shell.
import "@/app/portal/portal-world.css";

/* ------------------------------------------------------------------ */
/* Enquiry modal, shared across all five pages                          */
/* ------------------------------------------------------------------ */

/**
 * How a page opens the enquiry modal, and what to call the event when it does.
 *
 * The modal used to be local state inside the one page component. With five
 * routes it has to outlive a navigation — the shell is the only thing that
 * does, so it holds the state and hands the opener down. Any page's CTA calls
 * `useEnquiry()` rather than declaring its own copy of the modal, which is also
 * what keeps a single `ServiceInquiryModal` mounted (two would fight over the
 * consent record).
 *
 * `openEvent` RIDES ALONG BECAUSE IT MUST. The contract funnel event
 * `portal_service_open` may only be emitted by the customer-facing host. The
 * same section components also render inside the dashboard's "Our Services"
 * tab, and if their CTAs hardcoded the contract name, an admin demoing that tab
 * would inject opens no customer made straight into the Enquiries funnel and
 * inflate every conversion ratio built on it. The host that provides the opener
 * is the host that knows which name is honest, so it supplies both together
 * rather than leaving each CTA to remember.
 *
 * The default is an inert pair rather than a throw: a section rendered outside
 * any provider should be dead, not crash the page it is previewed on.
 */
interface EnquiryApi {
  open: (service: Service) => void;
  openEvent: string;
}

const EnquiryContext = createContext<EnquiryApi>({
  open: () => {},
  openEvent: "services_card_open",
});

export function useEnquiry(): EnquiryApi {
  return useContext(EnquiryContext);
}

/** Provider only — used by the internal dashboard tab, which owns its own modal. */
export function EnquiryProvider({
  open,
  openEvent,
  children,
}: {
  open: (service: Service) => void;
  openEvent: string;
  children: ReactNode;
}) {
  const value = useMemo(() => ({ open, openEvent }), [open, openEvent]);
  return <EnquiryContext.Provider value={value}>{children}</EnquiryContext.Provider>;
}

/* ------------------------------------------------------------------ */
/* Shell                                                                */
/* ------------------------------------------------------------------ */

/**
 * Chrome for every page of the customer portal.
 *
 * Mounted from app/portal/layout.tsx, so all five routes share one header, one
 * nav, one footer strip, one chat launcher and one enquiry modal. It replaces
 * PortalStandalone, whose job (telemetry listener, light-mode enforcement, the
 * skip link and the viewport-owning landmark) it absorbs wholesale.
 *
 * THE VIEWPORT LOCK. The shell is a three-row flex column exactly one dynamic
 * viewport tall: header, content, footer strip. The middle row is the only one
 * that can grow, and from `lg` up it clips instead of scrolling, which is what
 * makes each page one screen and no more. `min-h-0` on that row is load-bearing
 * — a flex child defaults to `min-height: auto`, which refuses to shrink below
 * its content and would push the footer strip off the bottom of the screen.
 *
 * Below `lg` it scrolls normally. Eight service tiles cannot be made legible on
 * a phone screen at once, and a locked viewport there would mean either
 * unreadable type or hidden services; the lock is a desktop composition, not a
 * promise to shrink content to nothing.
 */
export function PortalShell({ children }: { children: ReactNode }) {
  const [active, setActive] = useState<Service | null>(null);
  const open = useCallback((service: Service) => setActive(service), []);
  // This shell only ever renders on the customer host (app/portal/(site)), so
  // the contract funnel name is always the honest one here.
  const enquiry = useMemo<EnquiryApi>(() => ({ open, openEvent: "portal_service_open" }), [open]);

  // Delegated click telemetry for the whole portal — the same listener
  // DashboardShell runs for internal tabs. Mounted once here rather than per
  // page, so a client-side navigation between the five routes does not tear it
  // down and rebuild it.
  useClickTelemetry("portal");

  // Belt-and-braces LIGHT enforcement. The pre-paint script in
  // app/portal/layout.tsx already strips `dark` before first paint; this
  // re-asserts it on mount so the page stays light after a client-side
  // navigation, where that inline script does not re-run. localStorage is
  // deliberately untouched — a staff member's dark preference for the internal
  // console survives a detour through the portal.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  }, []);

  return (
    <EnquiryContext.Provider value={enquiry}>
      {/* SC 2.4.1 (Bypass Blocks) — first focusable thing on the page, hidden
          until focused. `focus:fixed` is what pins it to the viewport corner:
          Tailwind emits the position utilities AFTER the accessibility ones, so
          it wins over `not-sr-only`'s `position: static`. The solid background
          and ring are load-bearing on the services page, where the link lands
          over the hero photograph. It sits outside main on purpose — a skip
          link inside the region it skips to is pointless. */}
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-ink focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-brand-600"
      >
        Skip to main content
      </a>

      {/* `portal-world` is the scope every rule in portal-world.css hangs off.
          Without it this renders as a palette-only port: right colours, wrong
          character. */}
      <div className="portal-world portal-ground portal-lock flex h-dvh max-h-dvh flex-col overflow-hidden text-ink">
        <PortalHeader />

        {/* SC 1.3.1: the page's ONE landmark, and the row that absorbs the
            leftover height. tabIndex -1 makes it a valid target for the skip
            link's programmatic focus in every browser. */}
        <main
          id="portal-main"
          tabIndex={-1}
          className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden outline-none lg:overflow-hidden"
        >
          {children}
        </main>

        <PortalStrip standalone />
      </div>

      <PortalChat />
      {/* `standalone` marks this as the CUSTOMER host — the enquiry recorded
          here belongs in the Enquiries funnel. */}
      <ServiceInquiryModal service={active} onClose={() => setActive(null)} standalone />
    </EnquiryContext.Provider>
  );
}

/**
 * The white bar: mark, navigation, phone, quote.
 *
 * Not sticky, and it does not need to be — it is a flex row of a
 * viewport-height column, so it is permanently on screen.
 *
 * Exported for the dashboard's "Our Services" preview, which renders this exact
 * bar with the nav in controlled mode (`nav`), so the two hosts cannot drift.
 *
 * On phones the nav drops to its own full-width row under the mark: squeezed
 * between the logo and the quote button it had room for two and a half of its
 * five words.
 */
export function PortalHeader({ nav }: { nav?: ComponentProps<typeof PortalNav> }) {
  const { open, openEvent } = useEnquiry();
  const mark = (
    <Image
      src="/images/brand/apmg-logo-ink.webp"
      alt="APMG Services"
      width={378}
      height={285}
      priority
      className="h-10 w-auto sm:h-14 sm:py-2 short:h-11"
    />
  );

  return (
    <header className="z-30 shrink-0 border-b border-paper-edge/80 bg-white/95">
      <div className={cn(portalFrame, "flex flex-wrap items-center gap-x-4 gap-y-2 py-2 sm:flex-nowrap sm:py-0")}>
        {/* In the dashboard preview the mark goes home within the preview; a
            real link to /portal there would leave the dashboard. */}
        {nav?.onSelect ? (
          <button
            type="button"
            onClick={() => nav.onSelect?.("/portal")}
            className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            {mark}
          </button>
        ) : (
          <Link
            href="/portal"
            className="shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
          >
            {mark}
          </Link>
        )}

        <PortalNav
          {...nav}
          className="order-last flex w-full min-w-0 justify-center sm:order-none sm:flex-1"
        />

        <div className="ml-auto flex shrink-0 items-center gap-1 sm:ml-0 sm:gap-2">
          <a
            href={COMPANY.phoneHref}
            data-track="portal_phone_click"
            className="hidden rounded-md px-3 py-2 text-sm font-semibold text-ink-soft transition-colors hover:text-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 lg:inline-block"
          >
            <span className="sr-only">Call </span>
            {COMPANY.phone}
          </a>
          <PortalButton
            variant="primary"
            onClick={() => open(GENERAL_SERVICE)}
            data-track={openEvent}
            data-track-service="general"
            className="px-3.5 py-2 text-xs shadow-[0_1px_2px_rgba(165,12,37,0.25),0_4px_12px_-4px_rgba(165,12,37,0.45)] sm:px-4 sm:py-2.5 sm:text-sm"
          >
            Get a quote
          </PortalButton>
        </div>
      </div>
    </header>
  );
}
