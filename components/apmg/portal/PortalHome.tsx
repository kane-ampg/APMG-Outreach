"use client";

import { useEffect, useState } from "react";
import { track } from "@/lib/telemetry";
import { useEnquiry } from "./PortalShell";
import { Hero } from "./sections/Hero";
import { ServicesSection } from "./sections/Services";
import { ProcessSection } from "./sections/Process";
import { ReviewsSection } from "./sections/Reviews";
import { TeamSection } from "./sections/Team";
import { EnquirySection } from "./sections/Enquiry";

/**
 * The customer portal, top to bottom: the page outreach recipients land on.
 * Rendered inside PortalShell on both hosts.
 *
 * `spotlight` picks the featured trade. The customer route rolls it on the
 * server per request; see app/portal/page.tsx.
 */
export function PortalHome({ spotlight = 0 }: { spotlight?: number }) {
  const { standalone } = useEnquiry();
  const [sector, setSector] = useState<string | null>(null);

  // One `portal_view` per landing on the CUSTOMER host: the funnel step between
  // the outreach redirect (attribution_click, recorded server-side by /t/[id])
  // and the first portal_service_open. Never from the console preview.
  useEffect(() => {
    if (standalone) track("portal_view");
  }, [standalone]);

  // Message-match: the visitor's attributed sector, customer host only. The
  // outreach email spoke their sector's language, and the hero greeting the
  // same sector is what makes the email feel personal rather than templated.
  // Best-effort: any miss leaves the generic hero.
  useEffect(() => {
    if (!standalone) return;
    let cancelled = false;
    fetch("/api/portal/context")
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { ok?: boolean; category?: string | null } | null) => {
        if (cancelled || !j?.ok) return;
        if (typeof j.category === "string" && j.category.trim()) setSector(j.category.trim());
      })
      .catch(() => {
        /* no attribution / offline: generic hero */
      });
    return () => {
      cancelled = true;
    };
  }, [standalone]);

  return (
    <>
      <Hero sector={sector} />
      <ServicesSection spotlight={spotlight} />
      <ProcessSection />
      <ReviewsSection />
      <TeamSection />
      <EnquirySection />
    </>
  );
}
