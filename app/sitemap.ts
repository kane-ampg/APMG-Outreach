import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isCustomerHost, PORTAL_ORIGIN } from "@/lib/hosts";
import { PORTAL_PAGES } from "@/components/apmg/portal/pages";

/**
 * sitemap.xml — the portal's public pages, and nothing else.
 *
 * The content pages are read from PORTAL_PAGES, the same list the navigation
 * renders from, so a page added to the portal cannot be added to the nav and
 * quietly left out of the sitemap. That list lives in its own plain module
 * rather than in PortalNav: PortalNav is a client component, and importing a
 * value across that boundary hands server code a proxy instead of the array
 * (see components/apmg/portal/pages.ts). The two legal pages are hand-listed
 * below because they are deliberately NOT in the nav — they are footer modals
 * with shareable URLs, not destinations.
 *
 * Every URL uses PORTAL_ORIGIN, not the requested host, so the Vercel project
 * URL and preview deploys never advertise themselves as the canonical home.
 *
 * The admin host returns an empty sitemap to match its blanket robots.txt.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("host") ?? "";
  if (!isCustomerHost(host)) return [];

  return [
    // The landing page outranks its own sub-pages: it is what outreach links
    // land on and the only one carrying the full services list.
    ...PORTAL_PAGES.map((page) => ({
      url: `${PORTAL_ORIGIN}${page.href}`,
      changeFrequency: "monthly" as const,
      priority: page.href === "/portal" ? 1 : 0.7,
    })),
    { url: `${PORTAL_ORIGIN}/portal/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${PORTAL_ORIGIN}/portal/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
