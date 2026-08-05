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
    // NO entry gate: a cold visitor arriving from an outreach email must see
    // the services page immediately — a full-screen legal modal before any
    // value is shown reads as a dark pattern and kills trust. The policies are
    // one click away (footer → /portal/terms, /portal/privacy), and the
    // authoritative, fail-closed consent is still recorded at enquiry time by
    // ServiceInquiryModal (PortalConsentGate is kept in the repo, unmounted,
    // should an acknowledge-to-view gate ever be required contractually).
    <div className="h-dvh max-h-dvh overflow-y-auto overflow-x-hidden bg-background text-foreground">
      {/* `standalone` marks this as the CUSTOMER host: only here do the
          portal_view / portal_service_open contract events fire (the internal
          Our Services tab must not pollute the Enquiries funnel). */}
      <ServicesPortal standalone />
    </div>
  );
}
