import type { Metadata } from "next";
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
};

export default function PortalPage() {
  return <PortalStandalone />;
}
