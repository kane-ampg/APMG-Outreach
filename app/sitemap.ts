import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isCustomerHost, PORTAL_ORIGIN } from "@/lib/hosts";

/**
 * sitemap.xml — the portal's public pages, and nothing else.
 *
 * /portal is one page since 2026-09-29. Its old sub-pages (/portal/process,
 * /approach, /reviews, /team) are 308 redirects to sections of it now, and a
 * redirecting URL does not belong in a sitemap: Google reports it as an error
 * and it wastes crawl budget. So the list is /portal plus the two legal pages,
 * which are footer modals with shareable URLs.
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
    { url: `${PORTAL_ORIGIN}/portal`, changeFrequency: "monthly", priority: 1 },
    { url: `${PORTAL_ORIGIN}/portal/privacy`, changeFrequency: "yearly", priority: 0.2 },
    { url: `${PORTAL_ORIGIN}/portal/terms`, changeFrequency: "yearly", priority: 0.2 },
  ];
}
