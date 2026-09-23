/**
 * The portal's five public pages, in reading order.
 *
 * Deliberately its own module, with no imports and no "use client".
 *
 * This list is read from BOTH sides of the server/client boundary: PortalNav
 * renders it, and app/sitemap.ts publishes it. It used to live in PortalNav
 * itself, which is a client component -- and a plain value exported from a
 * "use client" module does not reach server code as itself. Next replaces it
 * with a client-reference proxy, so the sitemap got an object with no .map and
 * sitemap.xml answered 500 on the customer host while robots.txt kept pointing
 * crawlers at it. Nothing in the type system objects: the proxy is typed as the
 * array it stands in for, so this only ever shows up at runtime, in production.
 *
 * Hence a plain module both sides import. Do not add "use client" here, and do
 * not re-export this from a client component -- either one puts the boundary
 * back in the way.
 *
 * `/portal` leads because the services grid is the page outreach links land on.
 */
export const PORTAL_PAGES = [
  { href: "/portal", label: "Services" },
  { href: "/portal/process", label: "Process" },
  { href: "/portal/approach", label: "Approach" },
  { href: "/portal/reviews", label: "Reviews" },
  { href: "/portal/team", label: "Team" },
] as const;
