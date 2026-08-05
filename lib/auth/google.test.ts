import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { OAUTH_NEXT_COOKIE, pkceChallenge, randomToken } from "./google";
import { isSafeNextPath } from "./policy";

/**
 * Only the pure, input->output helpers are covered here. Everything else in
 * google.ts either talks to the network (exchangeCode, verifyIdToken) or
 * reads process.env for secrets (clientId, clientSecret, authorizeUrl) — this
 * file deliberately does not mock Google or build an HTTP harness for those.
 */

describe("randomToken", () => {
  it("returns a base64url string (no +, /, = or padding)", () => {
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("encodes 32 random bytes to the expected unpadded length", () => {
    // 32 bytes = 256 bits; base64url without padding is ceil(256 / 6) = 43 chars.
    expect(randomToken()).toHaveLength(43);
  });

  it("is not the same value on successive calls", () => {
    expect(randomToken()).not.toBe(randomToken());
  });
});

describe("pkceChallenge", () => {
  // RFC 7636 Appendix B ("Example for the S256 code_challenge_method") gives
  // this exact code_verifier / code_challenge pair as the spec's own worked
  // example — used here as ground truth instead of re-deriving the SHA-256
  // digest by hand. Independently re-verified against Node's `crypto` module
  // outside this test file before committing to it.
  it("matches the RFC 7636 Appendix B worked example", async () => {
    const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
    await expect(pkceChallenge(verifier)).resolves.toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("returns a base64url string of the length a SHA-256 digest produces", async () => {
    const challenge = await pkceChallenge(randomToken());
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);
    // SHA-256 is always 32 bytes -> 43 unpadded base64url characters, same as
    // randomToken's own 32-byte input.
    expect(challenge).toHaveLength(43);
  });

  it("is deterministic for the same verifier", async () => {
    const verifier = randomToken();
    expect(await pkceChallenge(verifier)).toBe(await pkceChallenge(verifier));
  });
});

describe("OAUTH_NEXT_COOKIE encode/decode round trip (regression, fix round 1)", () => {
  // Fix-round Important 1: ResponseCookies.set() percent-encodes a cookie
  // value on write; only RequestCookies.get() decodes it back on read. The
  // callback route used to read the raw Cookie header with a hand-rolled
  // regex, which never decodes — so a stored "/leads" round-tripped as the
  // literal string "%2Fleads", which isSafeNextPath rejects outright (it
  // doesn't start with "/"), silently killing return-to-page for every
  // destination. This test exercises the real next/server classes end to
  // end — no mocked Google, no HTTP server — to pin down both halves of
  // that behavior so a future regression back to a hand-rolled reader would
  // be caught here rather than discovered live in Task 7.
  it("NextResponse encodes the cookie value on write (the trigger for the bug)", () => {
    const res = NextResponse.redirect("http://localhost:3000/");
    res.cookies.set(OAUTH_NEXT_COOKIE, "/leads", { path: "/", httpOnly: true });

    // What a browser actually stores and echoes back on the next request is
    // this raw Set-Cookie name=value pair — already percent-encoded.
    const setCookie = res.headers.get("set-cookie") ?? "";
    const echoedPair = setCookie.split(";")[0];
    expect(echoedPair).toBe(`${OAUTH_NEXT_COOKIE}=%2Fleads`);

    // A hand-rolled reader of the raw header (the old, buggy approach) would
    // extract this still-encoded value and hand it straight to
    // isSafeNextPath, which rejects it — reproducing the exact silent
    // failure Important 1 described.
    const rawValue = echoedPair.split("=")[1];
    expect(isSafeNextPath(rawValue)).toBe(false);
  });

  it("NextRequest decodes the cookie value back on read (the fix)", () => {
    const res = NextResponse.redirect("http://localhost:3000/");
    res.cookies.set(OAUTH_NEXT_COOKIE, "/leads", { path: "/", httpOnly: true });
    const echoedPair = (res.headers.get("set-cookie") ?? "").split(";")[0];

    // Simulates the browser sending that exact Set-Cookie pair back as the
    // Cookie header on the callback request.
    const req = new NextRequest("http://localhost:3000/api/auth/google/callback", {
      headers: { cookie: echoedPair },
    });
    const decoded = req.cookies.get(OAUTH_NEXT_COOKIE)?.value;

    expect(decoded).toBe("/leads");
    expect(isSafeNextPath(decoded)).toBe(true);
  });
});
