import { test, expect } from "@playwright/test";

/**
 * The one-viewport contract.
 *
 * "Every page is one screen" is the kind of claim that looks true in a
 * screenshot and is false on the machine that matters. This holds the portal to
 * it by measuring the rendered document at real desktop sizes.
 *
 * HOW IT MEASURES, AND WHY NOT scrollHeight. The obvious assertion —
 * `documentElement.scrollHeight <= clientHeight` — is wrong here, and was wrong
 * in both directions while this was being built. An element with `overflow-x:
 * clip` and the vertical axis left `visible` inflates the root's reported
 * scrollHeight even when every ancestor clips it, so the check failed on a page
 * that was fine; and `overflow: hidden` on the root still permits programmatic
 * `scrollTo`, so a check built on that passed on a page that was not. Both
 * measure the DOM's bookkeeping rather than what a visitor can do.
 *
 * So this drives the real input. Wheel over the page and assert it did not
 * move, and assert the document never grew a scrollbar. That is the promise in
 * the words a visitor would use.
 *
 * The lock is a `lg:` composition (see PortalShell), so these run at desktop
 * widths only. Below `lg` the portal scrolls on purpose — eight service tiles
 * cannot be made legible on a phone at once, and pretending otherwise would
 * mean either unreadable type or hidden trades.
 */

const ROUTES = ["/portal", "/portal/process", "/portal/approach", "/portal/reviews", "/portal/team"];

/** Two real laptop sizes rather than one generous one. 1280x800 is the tighter
 *  of the two and is where a page that "just fits" stops fitting. */
const SIZES = [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
];

for (const viewport of SIZES) {
  test.describe(`${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });

    for (const route of ROUTES) {
      test(`${route} does not scroll`, async ({ page }) => {
        await page.goto(route);
        // The grid and the reviews list both settle after their images and
        // fetches land; measuring before that passes for the wrong reason.
        await page.waitForLoadState("networkidle");

        // Wheel near the top of the page, over the header — away from the inner
        // scrollers that /portal/reviews and /portal/team are allowed to have.
        await page.mouse.move(viewport.width / 2, 40);
        await page.mouse.wheel(0, 1200);
        await page.waitForTimeout(250);

        const state = await page.evaluate(() => ({
          scrollY: Math.round(window.scrollY),
          hasScrollbar: window.innerWidth > document.documentElement.clientWidth,
          // `<main>` is the shell's content row. It clips rather than scrolls at
          // `lg`, so anything taller than it is content a visitor can never see.
          // A page is allowed to put a scroller INSIDE main (reviews, team) —
          // main itself overflowing means something was silently cut off.
          mainScrollH: document.getElementById("portal-main")?.scrollHeight ?? 0,
          mainClientH: document.getElementById("portal-main")?.clientHeight ?? 0,
        }));

        expect(state.scrollY, `${route} scrolled ${state.scrollY}px under the wheel`).toBe(0);
        expect(state.hasScrollbar, `${route} grew a document scrollbar`).toBe(false);
        expect(
          state.mainScrollH,
          `${route} clips ${state.mainScrollH - state.mainClientH}px of content that nothing can scroll to`,
        ).toBeLessThanOrEqual(state.mainClientH + 2);
      });
    }
  });
}

test.describe("phones scroll on purpose", () => {
  // iPhone-class viewport. The lock is a `lg:` composition and deliberately
  // does NOT apply here: eight service tiles cannot be made legible on a phone
  // screen at once, so the choice is between a page that scrolls and one that
  // hides trades. This asserts we picked scrolling — a future change that
  // extended the lock downwards would silently hide six of the eight services
  // on the device most outreach email is opened on.
  test.use({ viewport: { width: 390, height: 844 } });

  test("/portal scrolls and shows every trade on a phone", async ({ page }) => {
    await page.goto("/portal");
    await page.waitForLoadState("networkidle");

    // All eight are in the document...
    await expect(page.locator("article[data-service]")).toHaveCount(8);

    // ...and the last one can actually be reached.
    const last = page.locator("article[data-service]").last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });
});

test.describe("chrome is present on every page", () => {
  test.use({ viewport: SIZES[1] });

  for (const route of ROUTES) {
    test(`${route} carries the nav, the landmark and the footer strip`, async ({ page }) => {
      await page.goto(route);

      // SC 1.3.1 — the portal's one landmark, and the skip link's target.
      await expect(page.locator("main#portal-main")).toHaveCount(1);

      // All five pages reachable from all five pages: the whole point of the
      // split is that nothing is more than one click away.
      const nav = page.getByRole("navigation", { name: "Portal sections" });
      await expect(nav).toBeVisible();
      await expect(nav.getByRole("link")).toHaveCount(ROUTES.length);

      // The legal opt-out an outreach recipient is entitled to. It moved from a
      // 600px footer into a strip, and the thing that must not regress is that
      // it is still on every page they can land on.
      await expect(page.getByRole("contentinfo").getByText(/unsubscribe/i)).toBeVisible();
    });
  }
});

test.describe("services grid", () => {
  test.use({ viewport: SIZES[1] });

  test("shows all eight trades and exactly one spotlight", async ({ page }) => {
    await page.goto("/portal");
    await page.waitForLoadState("networkidle");

    await expect(page.locator("article[data-service]")).toHaveCount(8);
    await expect(page.locator('article[data-featured="true"]')).toHaveCount(1);
  });

  test("the spotlight is randomised per request", async ({ page }) => {
    const seen = new Set<string>();

    // Twelve loads. If the spotlight were pinned (a static prerender, or a
    // client-side roll that always starts from index 0) this set stays at one
    // entry. With a fair roll over eight trades, twelve loads landing on the
    // same one has probability 8^-11 — small enough that a failure here means
    // the randomisation broke, not that the test was unlucky.
    for (let i = 0; i < 12; i += 1) {
      await page.goto("/portal");
      const slug = await page.locator('article[data-featured="true"]').getAttribute("data-service");
      if (slug) seen.add(slug);
    }

    expect(seen.size, `spotlight never moved — always "${[...seen]}"`).toBeGreaterThan(1);
  });
});

test.describe("the reviews page keeps its content reachable", () => {
  test.use({ viewport: SIZES[0] });

  /**
   * The reviews list is the one block whose length is not ours to decide, so it
   * is allowed an inner scroller. "Allowed a scroller" has to mean the reviews
   * are actually reachable — the failure this guards against is the one that
   * shipped briefly during the rebuild, where the panel's `overflow-x: clip`
   * left the list hanging outside every scroll container: nothing scrolled to
   * it, and nothing reported it as hidden either.
   */
  test("the reviews list scrolls inside the locked frame", async ({ page }) => {
    await page.goto("/portal/reviews");
    await page.waitForLoadState("networkidle");

    const reach = await page.evaluate(() => {
      const scroller = Array.from(document.querySelectorAll<HTMLElement>("div")).find((d) =>
        d.className.includes("lg:overflow-y-auto"),
      );
      if (!scroller) return null;
      scroller.scrollTop = 5000;
      const reached = scroller.scrollTop;
      scroller.scrollTop = 0;
      return { reached, hidden: scroller.scrollHeight - scroller.clientHeight };
    });

    expect(reach, "no inner scroller on the reviews page").not.toBeNull();
    // Everything below the frame must be reachable by scrolling it.
    expect(reach!.reached).toBe(reach!.hidden);
  });
});
