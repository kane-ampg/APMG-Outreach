import { test, expect } from "@playwright/test";

/**
 * The customer portal: one long page since 2026-09-29.
 *
 * These hold the page to the things that are easy to break without noticing:
 * every trade still renders with its photo, the featured trade is really rolled
 * per request on the server (and never lands on make-safe, which has its own
 * band), the four old sub-page URLs still lead somewhere, and the legal
 * opt-out is still on the page an outreach recipient lands on.
 */

const DESKTOP = { width: 1440, height: 900 };

// Mark the test browser as the operator's. The dev server writes to the live
// Supabase project, and every load below would otherwise land in the funnel as
// a real portal_view: the telemetry writers drop rows from a browser carrying
// this cookie (lib/portal/server.ts, isInternalRequest).
test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([{ name: "apmg_internal", value: "e2e", url: baseURL! }]);
});
const PHONE = { width: 390, height: 844 };

test.describe("services", () => {
  test.use({ viewport: DESKTOP });

  test("shows all eight trades, each with a photo, and exactly one featured", async ({ page }) => {
    await page.goto("/portal");

    const trades = page.locator("article[data-service]");
    await expect(trades).toHaveCount(8);
    await expect(page.locator('article[data-featured="true"]')).toHaveCount(1);

    // Every trade carries its own job-site photograph.
    for (const article of await trades.all()) {
      await expect(article.locator("img")).toHaveCount(1);
    }
  });

  test("the featured trade is rolled per request, and is never make-safe", async ({ page }) => {
    const seen = new Set<string>();

    // Twelve loads over a pool of seven. A pinned pick (a static prerender, or
    // a client roll that always starts from index 0) keeps this set at one
    // entry; twelve fair rolls all landing on the same trade has probability
    // 7^-11, so a failure means the randomisation broke, not bad luck.
    for (let i = 0; i < 12; i += 1) {
      await page.goto("/portal");
      const slug = await page.locator('article[data-featured="true"]').getAttribute("data-service");
      if (slug) seen.add(slug);
    }

    expect(seen.size, `featured trade never moved — always "${[...seen]}"`).toBeGreaterThan(1);
    expect(seen.has("make-safe"), "make-safe rotated into the featured card").toBe(false);
  });
});

test.describe("the retired sub-pages redirect into the one page", () => {
  for (const [route, anchor] of [
    ["/portal/process", "process"],
    ["/portal/approach", "approach"],
    ["/portal/reviews", "reviews"],
    ["/portal/team", "team"],
  ] as const) {
    test(`${route} → /portal#${anchor}`, async ({ request, page }) => {
      const res = await request.get(route, { maxRedirects: 0 });
      expect(res.status()).toBe(308);
      expect(res.headers()["location"]).toMatch(new RegExp(`/portal#${anchor}$`));

      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(`/portal#${anchor}$`));
      await expect(page.locator(`#${anchor}`)).toBeVisible();
    });
  }
});

test.describe("chrome", () => {
  test.use({ viewport: DESKTOP });

  test("nav, landmark, main website link and opt-out are all present", async ({ page }) => {
    await page.goto("/portal");

    // SC 1.3.1: the page's one landmark, and the skip link's target.
    await expect(page.locator("main#portal-main")).toHaveCount(1);

    const nav = page.getByRole("navigation", { name: "Portal sections" });
    await expect(nav.getByRole("link")).toHaveCount(4);

    // The group's main website, linked from the utility bar and the footer.
    await expect(page.locator('a[href="https://www.commercialpaintersau.com.au/"]')).toHaveCount(2);

    // The legal opt-out an outreach recipient is entitled to.
    await expect(page.getByRole("contentinfo").getByText(/unsubscribe/i)).toBeVisible();
  });

  test("the nav marks the section being read", async ({ page }) => {
    await page.goto("/portal");
    const nav = page.getByRole("navigation", { name: "Portal sections" });

    await nav.getByRole("link", { name: "Reviews" }).click();
    await expect(nav.getByRole("link", { name: "Reviews" })).toHaveAttribute("aria-current", "true");
  });
});

/**
 * One screen per section, from 1181px wide and 700px tall. Two real laptop
 * sizes, the tighter first: 1280x800 is where a section that "just fits"
 * stops fitting. Content must fit the screen rather than grow it, so each
 * section's height is compared with the viewport under the sticky header.
 */
for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test.describe(`one screen per section at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    test("the first screen and every section are exactly one screen tall", async ({ page }) => {
      await page.goto("/portal");

      const m = await page.evaluate(() => {
        const h = (el: Element | null) => Math.round(el?.getBoundingClientRect().height ?? -1);
        const hdr = h(document.querySelector(".hdr"));
        return {
          screen: innerHeight - hdr,
          first: h(document.querySelector(".util")) + hdr + h(document.querySelector(".first-screen")),
          sections: ["services", "process", "reviews", "team", "enquiry"].map((id) => ({
            id,
            height: h(document.getElementById(id)),
          })),
        };
      });

      expect(m.first, "the first screen is not the viewport").toBe(viewport.height);
      for (const s of m.sections) {
        expect(s.height, `#${s.id} is ${s.height}px, not one ${m.screen}px screen`).toBe(m.screen);
      }
    });

    test("the down button lands on the trades", async ({ page }) => {
      await page.goto("/portal");
      await page.getByRole("link", { name: /see all eight trades/i }).click();
      await expect(page.locator("#services")).toBeInViewport({ ratio: 0.9 });
    });
  });
}

test.describe("hero reel and reviews track", () => {
  test.use({ viewport: DESKTOP });

  test("the reel is the hero's whole background, with no placeholder image", async ({ page }) => {
    await page.goto("/portal");
    await expect(page.locator(".hero img")).toHaveCount(0);
    await expect(page.locator(".hero > .hero-reel video.reel-video source")).toHaveAttribute(
      "src",
      "/video/hero-720.mp4",
    );
    // The reel covers the whole section, edge to edge.
    const [hero, reel] = await Promise.all([
      page.locator(".hero").boundingBox(),
      page.locator(".hero-reel").boundingBox(),
    ]);
    expect(reel?.width).toBe(hero?.width);
    expect(reel?.height).toBe(hero?.height);
    // It decodes a first frame and fades in (the pause control appears with it).
    await expect(page.locator("video.reel-video.is-ready")).toHaveCount(1);
    await expect(page.getByRole("button", { name: /pause the video/i })).toBeVisible();
  });

  test("the next arrow moves the reviews along", async ({ page }) => {
    await page.goto("/portal");
    const count = page.locator(".reviews-count");
    await expect(count).toContainText("Showing 1–3 of");
    await page.getByRole("button", { name: "Next reviews" }).click();
    await expect(count).toContainText("Showing 4–6 of");
  });
});

test.describe("phones", () => {
  test.use({ viewport: PHONE });

  test("no sideways scroll, and the last trade is reachable", async ({ page }) => {
    await page.goto("/portal");

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow, "the page scrolls sideways on a phone").toBeLessThanOrEqual(0);

    const last = page.locator("article[data-service]").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });
});
