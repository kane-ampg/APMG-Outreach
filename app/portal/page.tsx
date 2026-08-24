import type { Metadata } from "next";
import { PORTAL_ORIGIN } from "@/lib/hosts";
import { PortalStandalone } from "@/components/apmg/PortalStandalone";

/**
 * Public services portal — the page outreach recipients actually see.
 * Kept as a server component purely so it can export `metadata` (which is
 * impossible from a "use client" file); all interactivity lives in
 * PortalStandalone.
 */
export const metadata: Metadata = {
  title: "Our Services — APMG Services",
  description:
    "Electrical, plumbing, painting, carpentry, flooring, gardening, handyman and make-safe services — one trusted property maintenance partner for Melbourne.",
  // The portal answers on the branded domain, the Vercel project URL, and
  // every preview host, and the bare root 308s here too. One absolute
  // canonical tells Google those are all the same page, and which address
  // should be the one that ranks.
  alternates: { canonical: `${PORTAL_ORIGIN}/portal` },
};

export default function PortalPage() {
  return <PortalStandalone />;
}
