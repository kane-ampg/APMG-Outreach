import type { Metadata } from "next";
import { PORTAL_ORIGIN } from "@/lib/hosts";
import { FEATURABLE } from "@/components/apmg/portal/data";
import { PortalShell } from "@/components/apmg/portal/PortalShell";
import { PortalHome } from "@/components/apmg/portal/PortalHome";

/**
 * Public services portal: the page outreach recipients actually see.
 *
 * A server component so it can export `metadata` (impossible from a "use
 * client" file) and so the featured trade is chosen server-side; all
 * interactivity lives in PortalShell and PortalHome.
 *
 * One page since 2026-09-29. The four sub-pages it replaced now redirect to
 * their section here (see app/portal/process/page.tsx and its siblings).
 */
export const metadata: Metadata = {
  title: "APMG Services — Every trade, one partner | Melbourne & Victoria",
  description:
    "Electrical, plumbing, painting, carpentry, flooring, grounds, handyman and 24/7 make-safe work across Melbourne and Victoria, run by one team.",
  // The portal answers on the branded domain, the Vercel project URL, and
  // every preview host, and the bare root 308s here too. One absolute
  // canonical tells Google those are all the same page, and which address
  // should be the one that ranks.
  alternates: { canonical: `${PORTAL_ORIGIN}/portal` },
};

/**
 * The featured trade is rolled per request, so this page cannot be a
 * build-time prerender: without this it would be rendered once and every
 * visitor would see the same "random" trade until the next deploy.
 *
 * COST NOTE (this project runs on Vercel's free tier, and Fast Origin Transfer
 * has been the binding limit before): what leaves the origin per request is
 * only this document. The photographs are `next/image` URLs served and cached
 * by the CDN, and they are the transfer weight.
 */
export const dynamic = "force-dynamic";

export default function PortalPage() {
  // Chosen HERE rather than in the client on purpose. A client-side roll would
  // render one trade on the server, pick another after hydration, and visibly
  // reflow the largest card on the page someone arriving from a cold email
  // sees first.
  const spotlight = Math.floor(Math.random() * FEATURABLE.length);

  return (
    <PortalShell host="customer">
      <PortalHome spotlight={spotlight} />
    </PortalShell>
  );
}
