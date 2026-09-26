import { describe, expect, it } from "vitest";
import { isInternalRequest } from "@/lib/portal/server";
import { GET } from "./route";

/**
 * The staff marker for the CUSTOMER host. proxy.ts marks a browser internal
 * when it loads an admin page — but cookies are per host, so that mark never
 * reached customer.apmgservices.com.au or the vercel.app portal, and every
 * portal visit the team made landed in the "Anonymous portal visitors" card as
 * a customer. On 2026-09-26, 26 of the card's 27 service opens were ours.
 */

function get(url = "https://customer.apmgservices.com.au/api/portal/staff"): Response {
  return GET(new Request(url));
}

describe("GET /api/portal/staff", () => {
  it("sets the same cookie every telemetry writer checks", () => {
    const cookie = get().headers.get("set-cookie") ?? "";

    expect(cookie).toMatch(/^apmg_internal=1;/);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).toMatch(/Max-Age=31536000/);
    expect(cookie).toMatch(/HttpOnly/i);
    // Round trip: the browser sends it back and the writers drop the batch.
    const sent = cookie.split(";")[0];
    expect(isInternalRequest(new Request("https://x.test/api/portal/events", { headers: { cookie: sent } }))).toBe(
      true,
    );
  });

  it("is never cached — a CDN copy would hand the mark to strangers", () => {
    expect(get().headers.get("cache-control")).toContain("no-store");
  });

  it("keeps itself out of search results", () => {
    expect(get().headers.get("x-robots-tag")).toContain("noindex");
  });

  it("offers to mark the OTHER customer hosts, since the mark can't cross domains", async () => {
    const html = await get().text();

    expect(html).toContain("https://customers-apmg-services.vercel.app/api/portal/staff");
    expect(html).not.toContain("https://customer.apmgservices.com.au/api/portal/staff");
  });
});
