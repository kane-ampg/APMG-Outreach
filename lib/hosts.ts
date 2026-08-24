/**
 * Which hostnames belong to the CUSTOMER portal deployment.
 *
 * One codebase ships two Vercel projects (see proxy.ts): the admin console on
 * its own domain, and the customer services portal bound to a customer host.
 * Several surfaces need the same host answer, and they must never disagree:
 *
 *   • proxy.ts  — the wall: customer hosts see ONLY the portal surface.
 *   • robots.ts — the customer host invites crawlers; the admin host bans them.
 *   • sitemap.ts — only the customer host publishes URLs.
 *
 * Hence one source of truth. A host added to the wall is automatically covered
 * by robots.txt, instead of quietly serving an unlisted, crawlable portal.
 */

// Exact customer hostnames (comma-separated env override wins). The Vercel
// project URL plus the customer-facing custom domain are the defaults; a host
// missing from this list is treated as an admin host, so the auth gate would
// bounce a client to /login instead of the portal — add every hostname a
// client is ever given, not just the one Vercel generated.
export const CUSTOMER_HOSTS = (process.env.CUSTOMER_PORTAL_HOSTS ||
  "customers-apmg-services.vercel.app,customer.apmgservices.com.au")
  .split(",")
  .map((h) => h.trim().toLowerCase())
  .filter(Boolean);

// Optional suffix match so Vercel preview deploys of the customer project
// (…-git-….vercel.app) are also locked down. Set to the project slug prefix.
export const CUSTOMER_HOST_SUFFIX = (process.env.CUSTOMER_PORTAL_HOST_SUFFIX || "")
  .trim()
  .toLowerCase();

/**
 * The portal's ONE public origin — what canonical tags and the sitemap point
 * at. Deliberately a fixed value rather than the request's own host: the same
 * page is reachable on the Vercel project URL and on every preview deploy, and
 * a canonical that echoes the requested host would tell Google each of those is
 * a distinct page. Only the branded domain should ever rank.
 */
export const PORTAL_ORIGIN = (
  process.env.PUBLIC_PORTAL_ORIGIN || "https://customer.apmgservices.com.au"
).replace(/\/+$/, "");

export function isCustomerHost(host: string): boolean {
  const h = host.toLowerCase().split(":")[0]; // strip any port
  if (CUSTOMER_HOSTS.includes(h)) return true;
  if (CUSTOMER_HOST_SUFFIX && h.endsWith(CUSTOMER_HOST_SUFFIX)) return true;
  return false;
}
