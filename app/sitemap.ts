import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isCustomerHost, PORTAL_ORIGIN } from "@/lib/hosts";

/**
 * sitemap.xml — the portal's three public pages, and nothing else.
 *
 * Hand-listed rather than generated: the customer host serves exactly these
 * three routes (proxy.ts redirects everything else to /portal), so a crawler
 * has nothing to discover that isn't here. Every URL uses PORTAL_ORIGIN, not
 * the requested host, so the Vercel project URL and preview deploys never
 * advertise themselves as the canonical home.
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
