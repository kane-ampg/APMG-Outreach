import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const recordUnsubscribe = vi.fn();
const isKnownRecipient = vi.fn();
const rewrittenRecipient = vi.fn();

vi.mock("@/lib/portal/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portal/server")>();
  return {
    ...actual,
    lookupLead: async () => null,
    isKnownRecipient: (...a: unknown[]) => isKnownRecipient(...a),
    recordUnsubscribe: (...a: unknown[]) => recordUnsubscribe(...a),
    rewrittenRecipient: (...a: unknown[]) => rewrittenRecipient(...a),
  };
});

vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return {
    ...actual,
    supabaseTarget: () => ({ state: "ok", base: "https://db.test", key: "k" }),
  };
});

import { GET, POST } from "./route";

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
  // Ordinary opt-outs are not rewrites; the tests that care say otherwise.
  rewrittenRecipient.mockReset().mockResolvedValue(null);
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

describe("POST — RFC 8058 one-click unsubscribe", () => {
  function oneClick(query: string, init: RequestInit = {}): Request {
    return new Request(`http://local/api/portal/unsubscribe${query}`, {
      method: "POST",
      // what Gmail actually sends: a form body, and no browser user-agent
      headers: { "Content-Type": "application/x-www-form-urlencoded", ...(init.headers ?? {}) },
      body: init.body ?? "List-Unsubscribe=One-Click",
    });
  }

  beforeEach(() => {
    recordUnsubscribe.mockResolvedValue("ok");
    isKnownRecipient.mockResolvedValue(true);
  });

  it("records the opt-out from the address in the URL", async () => {
    const res = await POST(oneClick(`?e=linda%404iac.com.au&lead=${LEAD}&c=outreach-2026`));
    expect(res.status).toBe(200);
    expect(recordUnsubscribe).toHaveBeenCalledWith(
      "https://db.test",
      "k",
      "linda@4iac.com.au",
      { leadId: LEAD, campaign: "outreach-2026" },
    );
  });

  it("RECORDS even with no user-agent — the bot filter must not reach a POST", async () => {
    // This is the trap: a one-click POST looks exactly like a scanner to
    // isBotRequest (no UA), and skipping it would silently discard a real
    // opt-out — the one error this endpoint may never make.
    const res = await POST(oneClick("?e=linda%404iac.com.au", { headers: { "user-agent": "" } }));
    expect(res.status).toBe(200);
    expect(recordUnsubscribe).toHaveBeenCalledOnce();
  });

  it("records when a provider posts the address in the body instead of the URL", async () => {
    const res = await POST(oneClick("", { body: "List-Unsubscribe=One-Click&email=linda%404iac.com.au" }));
    expect(res.status).toBe(200);
    expect(recordUnsubscribe).toHaveBeenCalledWith(
      "https://db.test",
      "k",
      "linda@4iac.com.au",
      { leadId: "", campaign: "" },
    );
  });

  it("still answers 200 when the write fails, so the provider never shows an error", async () => {
    recordUnsubscribe.mockResolvedValue("error");
    const res = await POST(oneClick("?e=linda%404iac.com.au"));
    expect(res.status).toBe(200);
  });

  it("answers 200 without recording when no address can be determined", async () => {
    const res = await POST(oneClick(""));
    expect(res.status).toBe(200);
    expect(recordUnsubscribe).not.toHaveBeenCalled();
  });
});

/* ── link rewriting ───────────────────────────────────────────────────────
   A gateway that presents a browser User-Agent walks past isBotRequest, and
   until 2026-08-30 whatever it fetched was written down as an opt-out. The
   address it leaves behind is the real one with a ROT13'd local part —
   `avgmeblabegu.faebyzfagf@saints.vic.edu.au` is a real example, and the school
   behind it never clicked anything. */

const SCRAMBLED = "avgmeblabegu.faebyzfagf@saints.vic.edu.au";
const REAL = "fitzroynorth.enrolments@saints.vic.edu.au";

describe("GET /api/portal/unsubscribe — rewritten links", () => {
  it("records nothing when the address is a rewrite of one we hold", async () => {
    isKnownRecipient.mockResolvedValue(false); // the scrambled form matches no lead
    rewrittenRecipient.mockResolvedValue(REAL);

    const res = await GET(req(SCRAMBLED, BROWSER_UA));

    expect(res.status).toBe(200);
    expect(recordUnsubscribe).not.toHaveBeenCalled();
  });

  it("does NOT suppress the decoded address either — a pre-fetch is not a click", async () => {
    // Recording the decoded form would let any scanner opt a real prospect out.
    isKnownRecipient.mockResolvedValue(false);
    rewrittenRecipient.mockResolvedValue(REAL);

    await GET(req(SCRAMBLED, BROWSER_UA));

    expect(recordUnsubscribe).not.toHaveBeenCalled();
  });

  it("still records an unrecognised address that is NOT a rewrite", async () => {
    // Stale data must never look like an attack: the check is narrow on purpose.
    isKnownRecipient.mockResolvedValue(false);
    rewrittenRecipient.mockResolvedValue(null);

    await GET(req("someone@newbusiness.com.au", BROWSER_UA));

    expect(recordUnsubscribe).toHaveBeenCalledOnce();
  });

  it("never runs the check on an address we already recognise", async () => {
    isKnownRecipient.mockResolvedValue(true);

    await GET(req("coburg@pelicanchildcare.com.au", BROWSER_UA));

    expect(rewrittenRecipient).not.toHaveBeenCalled();
    expect(recordUnsubscribe).toHaveBeenCalledOnce();
  });
});

describe("POST /api/portal/unsubscribe — rewritten one-click", () => {
  it("suppresses the person, not the mangled string", async () => {
    // A one-click POST is always a human, so the click is real even when the
    // List-Unsubscribe header was rewritten in transit. Writing the scrambled
    // form would suppress nobody — and would mute the whole domain on the next
    // send, via the organisation rollup.
    rewrittenRecipient.mockResolvedValue(REAL);

    const res = await POST(
      new Request(
        `https://customer.apmgservices.com.au/api/portal/unsubscribe?e=${encodeURIComponent(SCRAMBLED)}`,
        { method: "POST" },
      ),
    );

    expect(res.status).toBe(200);
    expect(recordUnsubscribe).toHaveBeenCalledOnce();
    expect(recordUnsubscribe.mock.calls[0][2]).toBe(REAL);
  });
});
