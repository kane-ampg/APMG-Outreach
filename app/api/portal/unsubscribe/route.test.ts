import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const recordUnsubscribe = vi.fn();
const isKnownRecipient = vi.fn();

vi.mock("@/lib/portal/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portal/server")>();
  return {
    ...actual,
    lookupLead: async () => null,
    isKnownRecipient: (...a: unknown[]) => isKnownRecipient(...a),
    recordUnsubscribe: (...a: unknown[]) => recordUnsubscribe(...a),
  };
});

vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return {
    ...actual,
    supabaseTarget: () => ({ state: "ok", base: "https://db.test", key: "k" }),
  };
});

import { GET } from "./route";

const LEAD = "d7603044-7482-403f-b9cc-8fb582fc6eb4";
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";

function req(email: string, ua: string): Request {
  return new Request(
    `https://customer.apmgservices.com.au/api/portal/unsubscribe?e=${encodeURIComponent(email)}&lead=${LEAD}&c=warmup-manual`,
    { headers: { "user-agent": ua } },
  );
}

beforeEach(() => {
  recordUnsubscribe.mockReset().mockResolvedValue("ok");
  isKnownRecipient.mockReset().mockResolvedValue(true);
});

describe("GET /api/portal/unsubscribe — scanner detonation", () => {
  it("records the opt-out for a real browser", async () => {
    const res = await GET(req("coburg@pelicanchildcare.com.au", BROWSER_UA));
    expect(res.status).toBe(200);
    expect(recordUnsubscribe).toHaveBeenCalledOnce();
  });

  it("does NOT record when the request is automated, but still answers 200", async () => {
    // The shape that took email_suppression from 2 rows to 44 on 2026-08-25/26.
    const res = await GET(req("vaab@windsorccc.org.au", "Mozilla/5.0 (compatible; bingbot/2.0)"));
    expect(res.status).toBe(200);
    expect(recordUnsubscribe).not.toHaveBeenCalled();
  });

  it("treats a request with no user-agent as automated", async () => {
    const res = await GET(
      new Request(
        `https://customer.apmgservices.com.au/api/portal/unsubscribe?e=x%40y.com&lead=${LEAD}`,
      ),
    );
    expect(res.status).toBe(200);
    expect(recordUnsubscribe).not.toHaveBeenCalled();
  });

  it("still records a human opt-out when the address is not held on any lead", async () => {
    // Direction of error: failing to record a real opt-out is the Spam Act
    // problem. An unverifiable address from a real browser is suppressed anyway.
    isKnownRecipient.mockResolvedValue(false);
    const res = await GET(req("someone@unknown-domain.com.au", BROWSER_UA));
    expect(res.status).toBe(200);
    expect(recordUnsubscribe).toHaveBeenCalledOnce();
  });

  it("returns the same page whether or not the write happened", async () => {
    const human = await (await GET(req("a@b.com.au", BROWSER_UA))).text();
    const bot = await (await GET(req("a@b.com.au", "curl/8.4.0"))).text();
    expect(bot).toBe(human);
  });
});
