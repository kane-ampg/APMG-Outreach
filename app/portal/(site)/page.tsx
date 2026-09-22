import type { Metadata } from "next";
import { PORTAL_ORIGIN } from "@/lib/hosts";
import { SERVICES } from "@/components/apmg/portal/data";
import { ServicesSection } from "@/components/apmg/portal/sections/Services";

/**
 * Public services portal — the page outreach recipients actually see.
 *
 * A server component so it can export `metadata` (impossible from a "use
 * client" file) and so the spotlight is chosen server-side; all interactivity
 * lives in ServicesSection.
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

/**
 * The spotlight is rolled per request, so this page cannot be a build-time
 * prerender — without this it would be rendered once and every visitor would
 * see the same "random" trade until the next deploy.
 *
 * COST NOTE (this project runs on Vercel's free tier, and Fast Origin Transfer
 * has been the binding limit before): what leaves the origin per request is
 * only this document. The service photographs are `next/image` URLs served and
 * cached by the CDN exactly as they were, and they are the transfer weight —
 * so the delta here is the HTML alone, not the page.
 */
export const dynamic = "force-dynamic";

export default function PortalPage() {
  // Chosen HERE rather than in the client component on purpose. A client-side
  // roll would render index 0 on the server, pick something else after
  // hydration, and visibly reflow the largest tile on the grid — on the one
  // screen that has to land instantly for someone arriving from a cold email.
  const spotlight = Math.floor(Math.random() * SERVICES.length);

  return <ServicesSection spotlight={spotlight} fill standalone />;
}
