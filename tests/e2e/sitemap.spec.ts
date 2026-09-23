import { test, expect } from "@playwright/test";

import { PORTAL_PAGES } from "@/components/apmg/portal/pages";

/**
 * sitemap.xml actually answers, on the host that publishes it.
 *
 * This exists because it already broke once, silently. PORTAL_PAGES was moved
 * into PortalNav -- a client component -- and the server-rendered sitemap then
 * received a client-reference proxy instead of the array, so sitemap.xml
 * returned 500 in production while robots.txt went on pointing crawlers at it.
 * Nothing caught it: it builds, it typechecks, and a unit test importing the
 * same module passes, because vitest has no server/client boundary to cross.
 * Only a real request over HTTP shows it.
 *
 * So this is deliberately an e2e test rather than a unit test, and it asserts
 * on the body rather than the status -- the empty-but-valid sitemap the admin
 * host returns is also a 200, and that is the wrong answer here.
 *
 * The Host header is what selects the customer branch; see lib/hosts.ts.
 */
const CUSTOMER_HOST = "customer.apmgservices.com.au";

test("sitemap.xml lists every portal page on the customer host", async ({ request }) => {
  const res = await request.get("/sitemap.xml", { headers: { Host: CUSTOMER_HOST } });

  expect(res.status()).toBe(200);
  const xml = await res.text();

  for (const page of PORTAL_PAGES) {
    expect(xml).toContain(`https://${CUSTOMER_HOST}${page.href}</loc>`);
  }
  // The legal pages are hand-listed in sitemap.ts and are not in PORTAL_PAGES.
  expect(xml).toContain(`https://${CUSTOMER_HOST}/portal/privacy</loc>`);
  expect(xml).toContain(`https://${CUSTOMER_HOST}/portal/terms</loc>`);
});

test("robots.txt points at a sitemap that resolves", async ({ request }) => {
  const robots = await request.get("/robots.txt", { headers: { Host: CUSTOMER_HOST } });
  const sitemapUrl = (await robots.text()).match(/^Sitemap:\s*(\S+)$/m)?.[1];
  expect(sitemapUrl, "robots.txt should advertise a sitemap").toBeTruthy();

  const res = await request.get(new URL(sitemapUrl!).pathname, { headers: { Host: CUSTOMER_HOST } });
  expect(res.status()).toBe(200);
});
