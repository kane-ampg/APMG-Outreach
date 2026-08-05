import { expect, test } from "@playwright/test";

/**
 * These guard the two failure modes that matter most: the console being
 * reachable without signing in, and the lead database being reachable by a
 * caller that sends no Origin header. Both were true before Phase 1.
 */

test("an unauthenticated visitor is sent to the login page", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByRole("link", { name: /continue with google/i })).toBeVisible();
});

test("the lead database is not readable without a session", async ({ request }) => {
  // No Origin header, exactly like curl — the case sameOrigin() lets through.
  const res = await request.get("/api/pipeline/leads");
  expect(res.status()).toBe(401);
  expect(await res.text()).not.toContain("email");
});

test("admin API routes reject anonymous callers", async ({ request }) => {
  for (const path of [
    "/api/pipeline/batches",
    "/api/sales/queue",
    "/api/integrations",
    "/api/legal",
    "/api/compose-prompt",
    "/api/sector-playbooks",
  ]) {
    const res = await request.get(path);
    expect(res.status(), `${path} should require auth`).toBe(401);
  }
});

test("the view-as endpoint rejects anonymous callers", async ({ request }) => {
  const res = await request.post("/api/auth/view-as", { data: { role: "sales" } });
  expect(res.status()).toBe(401);
});

test("the customer portal still loads with no session", async ({ page }) => {
  // The guard against this whole change breaking the customer-facing surface.
  const res = await page.goto("/portal");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveURL(/\/portal/);
});

test("the login page renders a domain error legibly", async ({ page }) => {
  await page.goto("/login?error=wrong-domain");
  await expect(page.getByRole("alert")).toContainText("apmgservices.com.au");
});
