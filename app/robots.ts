import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isCustomerHost, PORTAL_ORIGIN } from "@/lib/hosts";

/**
 * robots.txt, answered per host.
 *
 * Both Vercel projects build from this one file, and they need OPPOSITE
 * answers, so the host decides:
 *
 *   • customer host — crawl the portal. This is the public trust surface; we
 *     want it in the index. /api/ and /t/ are still off limits: /t/<leadId>
 *     links are per-recipient tracked redirects, and a crawler walking them
 *     would put lead ids in Google's index.
 *   • every other host (admin console, previews) — disallow everything. The
 *     console is auth-gated anyway, so this only stops crawlers wasting hits
 *     on /login, but a stray public admin route must never be crawlable by
 *     default.
 *
 * `headers()` makes this dynamic, which is required: a build-time static
 * robots.txt would bake ONE host's answer into both projects.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host") ?? "";

  if (!isCustomerHost(host)) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/t/"] }],
    sitemap: `${PORTAL_ORIGIN}/sitemap.xml`,
  };
}
