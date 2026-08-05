import { expect, test } from "@playwright/test";

/**
 * The admin user-administration surface is the one that can grant access, so
 * an unauthenticated caller must never reach it — by any method.
 */

test("GET /api/admin/users is unreachable without a session", async ({ request }) => {
  // Playwright's request fixture sends no Origin header, exactly like curl —
  // the case sameOrigin() lets through, and therefore the case that matters.
  const res = await request.get("/api/admin/users");
  expect(res.status()).toBe(401);
  const body = await res.text();
  expect(body).not.toContain("@apmgservices.com.au");
});

test("PATCH /api/admin/users cannot grant a role without a session", async ({ request }) => {
  const res = await request.patch("/api/admin/users", {
    data: { email: "attacker@apmgservices.com.au", role: "admin" },
  });
  expect(res.status()).toBe(401);
});

test("an unknown method on the admin route is not a way in", async ({ request }) => {
  // POST and DELETE are not exported; neither may fall through to a handler.
  for (const res of [
    await request.post("/api/admin/users", { data: {} }),
    await request.delete("/api/admin/users"),
  ]) {
    expect([401, 404, 405]).toContain(res.status());
    expect(await res.text()).not.toContain("@apmgservices.com.au");
  }
});
