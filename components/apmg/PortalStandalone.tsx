"use client";

import { useEffect } from "react";
import { useClickTelemetry } from "@/lib/telemetry";
import { ServicesPortal } from "./ServicesPortal";

/**
 * Client shell for the public /portal route — where tracked outreach links
 * (/t/<leadId>) land after the attribution redirect. No sidebar, no RBAC:
 * this is the customer-facing surface, so it only mounts the delegated
 * click-telemetry listener (view "portal", the same listener DashboardShell
 * runs for internal tabs) and the shared ServicesPortal.
 *
 * The root layout leaves <body> unconstrained, so this shell owns the
 * viewport (`h-dvh`) and scrolls internally — the document itself never
 * scrolls, matching the app's shell rule (ui-standards §1.1). The background
 * and text tokens are restated explicitly so the page reads correctly even
 * though <body> already carries them via globals.css.
 *
 * Accessibility: that viewport-owning element is the <main> landmark itself
 * (SC 1.3.1 — /portal previously had NO landmark of any kind, leaving every
 * content node unlandmarked and giving screen-reader users no way to jump to
 * the content), preceded by a skip link (SC 2.4.1 — the page opens on a
 * 300px+ hero, a logo/social row and a tab bar, all of which a keyboard
 * visitor arriving from an outreach link would otherwise have to Tab past
 * before reaching a single service). The landmark IS the scroll container
 * rather than a wrapper inside it, so ServicesPortal keeps a definite-height
 * parent for its `min-h-full` column and the scroll behaviour is byte-for-byte
 * what it was.
 */
export function PortalStandalone() {
  useClickTelemetry("portal");

  // Belt-and-braces LIGHT enforcement for the public portal. The pre-paint
  // script in app/portal/layout.tsx already strips `dark` before first paint;
  // this re-asserts it on mount so the page is light even after a client-side
  // navigation (where the inline <script> may not re-run) or if anything
  // re-applies the dark class. Runs only on this customer host — the internal
  // dashboard keeps its dark default. localStorage is deliberately untouched.
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("dark");
    root.style.colorScheme = "light";
  }, []);

  return (
    <>
      {/* SC 2.4.1 (Bypass Blocks) — first focusable thing on the page, hidden
          until focused. `focus:fixed` is what pins it to the viewport corner:
          Tailwind emits the position utilities AFTER the accessibility ones, so
          it wins over `not-sr-only`'s `position: static` and the link can't be
          dragged into the layout. The solid card background, ring and z-[100]
          are load-bearing too — the link lands over the hero PHOTO, and unstyled
          dark text on that image would be illegible (and would itself fail SC
          1.4.3). It sits outside <main> on purpose: a skip link inside the
          region it skips to is pointless, and axe exempts same-page skip links
          from its unlandmarked-content rule. */}
      <a
        href="#portal-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background"
      >
        Skip to main content
      </a>
      {/* NO entry gate: a cold visitor arriving from an outreach email must see
          the services page immediately — a full-screen legal modal before any
          value is shown reads as a dark pattern and kills trust. The policies are
          one click away (footer → /portal/terms, /portal/privacy), and the
          authoritative, fail-closed consent is still recorded at enquiry time by
          ServiceInquiryModal (PortalConsentGate is kept in the repo, unmounted,
          should an acknowledge-to-view gate ever be required contractually).

          SC 1.3.1: this is the page's ONE landmark. It stays the
          viewport-owning scroll container (same classes as before) instead of
          nesting a <main> inside it — ServicesPortal's root column is
          `min-h-full`, and a percentage min-height resolves against an
          auto-height parent as nothing, so an extra wrapper here would quietly
          collapse that column. tabIndex -1 makes it a valid target for the skip
          link's programmatic focus in every browser (and, as a bonus, gives the
          arrow keys a focused scroll container to drive after the skip); the UA
          only paints a ring on :focus-visible, and `outline-none` matches how
          the app's other -1 focus targets are handled. */}
      <main
        id="portal-main"
        tabIndex={-1}
        className="h-dvh max-h-dvh overflow-y-auto overflow-x-hidden bg-background text-foreground outline-none"
      >
        {/* `standalone` marks this as the CUSTOMER host: only here do the
            portal_view / portal_service_open contract events fire (the internal
            Our Services tab must not pollute the Enquiries funnel). */}
        <ServicesPortal standalone />
      </main>
    </>
  );
}
